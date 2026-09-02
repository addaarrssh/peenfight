/**
 * MultiplayerManager.js - Robust Zero-Latency WebRTC Multiplayer Engine
 * 
 * Features:
 * 1. Star-Topology Multi-Peer WebRTC DataChannels (Host Star Relay for 2 to 8 players)
 * 2. Ultra-Low Bandwidth Usage (Optimized for Mobile/Cellular Networks)
 * 3. Dynamic Slot & Pen Assignment (0: Host/player, 1: Guest1/rival, 2: Guest2/bot3, ..., 7: Guest7/bot8)
 * 4. High-Frequency Live Transform Streaming (LIVE_TRANSFORMS)
 * 5. Sequence Acknowledgment Delivery Queue (Exponential Retry & Deduplication)
 * 6. Authoritative Host Refereeing & Progressive Elimination (Battle Royale)
 * 7. Heartbeat & Keepalive Protocol with Anti-Freeze Turn Watchdog
 * 8. TURN Server Fallback for Restrictive NATs
 */

(function(global) {
  'use strict';

  const STATES = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    OPEN: 'OPEN',
    RECONNECTING: 'RECONNECTING',
    ERROR: 'ERROR'
  };

  const ROSTER_IDS = ["player", "rival", "bot3", "bot4", "bot5", "bot6", "bot7", "bot8"];

  // STUN + free public TURN servers for restrictive network fallback
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  const GUEST_RETRY_INTERVAL_MS = 2000;
  const GUEST_MAX_RETRIES = 8;
  const CONNECTION_TIMEOUT_MS = 30000;
  const RECONNECT_MAX_ATTEMPTS = 3;
  const RECONNECT_INTERVAL_MS = 5000;

  class MultiplayerManager {
    constructor() {
      this.state = STATES.DISCONNECTED;
      this.peer = null;
      this.conn = null; // For guest: connection to host. For host: primary connection alias
      this.conns = new Map(); // For host: Map<peerId, { conn, slot, penId, name, pen }>
      this.isHost = false;
      this.mySlot = 0; // 0 for host, 1..7 for guests
      this.myPenId = "player"; // "player", "rival", "bot3", ...
      this.rosterIds = ROSTER_IDS.slice();
      this.roomCode = null;
      this.peerId = null;
      this.localName = "Player";
      this.localPen = "gripper";
      this.remoteName = "Opponent";
      this.remotePen = "pilotV5";
      this.currentStriker = "player";
      this.bout = 1;
      this.seq = 0;
      this.players = []; // [{ slot, penId, name, pen, isHost, peerId }]

      // Delivery Queue for guaranteed delivery
      this.pendingAcks = new Map();
      this.seenSeqs = new Set();
      this.retryDelays = [350, 700, 1400, 2500];

      // Heartbeat
      this.heartbeatTimer = null;
      this.lastHeartbeatReceived = Date.now();

      // Connection timeout
      this.connectionTimeoutId = null;

      // Guest retry state
      this.guestRetryCount = 0;
      this.guestRetryTimerId = null;

      // Reconnection state
      this.reconnectAttempts = 0;
      this.reconnectTimerId = null;
      this.wasOpen = false;

      // Callbacks
      this.callbacks = {
        stateChange: [],
        playerJoined: [],
        playerLeft: [],
        lobbyUpdate: [],
        penUpdated: [],
        matchStarted: [],
        opponentShot: [],
        liveTransforms: [],
        settleSync: [],
        penFallen: [],
        scoreUpdate: [],
        roundResult: [],
        newRound: [],
        matchTimerStarted: [],
        rematchVote: [],
        voiceStateChanged: [],
        voiceSpeaking: [],
        disconnected: []
      };

      // Voice Chat (WebRTC Audio Stream)
      this.isVoiceConnected = false;
      this.isMicMuted = true;
      this.isSpeakerMuted = false;
      this.isSpeakingLocal = false;
      this.isSpeakingRemote = false;
      this.localVoiceStream = null;
      this.remoteVoiceStream = null;
      this.silentVoiceStream = null;
      this.voiceCall = null;
      this.voiceAudioEl = null;
      this.voiceMeterRunning = false;
      this.remotePeerId = null;

      this.setupVisibilityListeners();
    }

    getMyPenId() {
      return this.myPenId || (this.isHost ? "player" : "rival");
    }

    setState(newState) {
      if (this.state === newState) return;
      console.log(`[PF_MULTIPLAYER] State: ${this.state} -> ${newState}`);
      this.state = newState;
      this.emit('stateChange', {
        state: newState,
        roomCode: this.roomCode,
        isHost: this.isHost
      });
    }

    on(event, cb) {
      if (this.callbacks[event]) {
        this.callbacks[event].push(cb);
      }
    }

    emit(event, data) {
      if (this.callbacks[event]) {
        for (const cb of this.callbacks[event]) {
          try {
            cb(data);
          } catch(e) {
            console.error(`[PF_MULTIPLAYER] Callback error for ${event}:`, e);
          }
        }
      }
    }

    startConnectionTimeout() {
      this.clearConnectionTimeout();
      this.connectionTimeoutId = setTimeout(() => {
        if (this.state === STATES.CONNECTING || this.state === STATES.RECONNECTING) {
          console.warn(`[PF_MULTIPLAYER] Connection timeout after ${CONNECTION_TIMEOUT_MS}ms`);
          this.setState(STATES.ERROR);
          this.emit('disconnected', {
            reason: 'timeout',
            message: 'Connection timed out. Your friend might have left or the room code was expired.'
          });
        }
      }, CONNECTION_TIMEOUT_MS);
    }

    clearConnectionTimeout() {
      if (this.connectionTimeoutId) {
        clearTimeout(this.connectionTimeoutId);
        this.connectionTimeoutId = null;
      }
    }

    sanitizeRoomCode(code) {
      return (code || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    }

    createRoom(roomCode, playerName, selectedPen) {
      this.isHost = true;
      this.mySlot = 0;
      this.myPenId = "player";
      this.roomCode = roomCode;
      this.localName = playerName || (typeof localStorage !== 'undefined' ? localStorage.getItem("pf_name") : null) || "YOU";
      this.localPen = selectedPen || "gripper";
      this.currentStriker = "player";
      this.wasOpen = false;
      this.reconnectAttempts = 0;
      this.conns.clear();
      this.players = [{
        slot: 0,
        penId: "player",
        name: this.localName,
        pen: this.localPen,
        isHost: true
      }];

      this.setState(STATES.CONNECTING);
      this.startConnectionTimeout();

      const cleanCode = this.sanitizeRoomCode(roomCode);
      const hostPeerId = `pf-desk-${cleanCode}-host`;

      this.initPeer(hostPeerId, () => {
        this.clearConnectionTimeout();
        this.setState(STATES.OPEN);
        this.peer.on('connection', (conn) => {
          this.handleIncomingGuest(conn);
        });
      });
    }

    handleIncomingGuest(conn) {
      console.log(`[PF_MULTIPLAYER] Incoming guest connection from: ${conn.peer}`);

      // Determine available slot (1 to 7)
      const usedSlots = new Set(this.players.map(p => p.slot));
      let assignedSlot = -1;
      const maxSlots = Math.max(2, Math.min(8, window.roomPlayerCount || 8));
      for (let s = 1; s < maxSlots; s++) {
        if (!usedSlots.has(s)) {
          assignedSlot = s;
          break;
        }
      }

      if (assignedSlot === -1) {
        console.warn(`[PF_MULTIPLAYER] Room is full (max ${maxSlots} players). Refusing: ${conn.peer}`);
        conn.on('open', () => {
          conn.send({ type: 'ROOM_FULL', max: maxSlots });
          setTimeout(() => conn.close(), 500);
        });
        return;
      }

      const assignedPenId = this.rosterIds[assignedSlot] || `bot${assignedSlot + 1}`;
      const guestInfo = {
        conn: conn,
        slot: assignedSlot,
        penId: assignedPenId,
        name: `Player ${assignedSlot + 1}`,
        pen: (window.currentChosenPens && window.currentChosenPens[assignedSlot]) || "pilotV5",
        isHost: false,
        peerId: conn.peer
      };

      this.conns.set(conn.peer, guestInfo);
      if (!this.conn) this.conn = conn;
      if (!this.remotePeerId) this.remotePeerId = conn.peer;

      conn.on('open', () => {
        console.log(`[PF_MULTIPLAYER] Guest connected on DataChannel. Assigned slot: ${assignedSlot}`);
        this.wasOpen = true;

        conn.send({
          type: 'WELCOME',
          slot: assignedSlot,
          myPenId: assignedPenId,
          roomPlayerCount: window.roomPlayerCount || 2,
          currentChosenPens: window.currentChosenPens || [],
          players: this.players
        });

        this.startHeartbeat();
      });

      conn.on('data', (data) => {
        this.handlePacket(data, conn);
      });

      conn.on('close', () => {
        console.log(`[PF_MULTIPLAYER] Guest ${conn.peer} disconnected`);
        const info = this.conns.get(conn.peer);
        this.conns.delete(conn.peer);
        if (this.conn === conn) {
          const firstLeft = this.conns.values().next().value;
          this.conn = firstLeft ? firstLeft.conn : null;
        }

        if (info) {
          this.players = this.players.filter(p => p.slot !== info.slot);
          this.emit('playerLeft', { slot: info.slot, name: info.name });
          this.broadcastToAll({
            type: 'LOBBY_UPDATE',
            players: this.players
          });
        }
      });

      conn.on('error', (err) => {
        console.warn(`[PF_MULTIPLAYER] DataChannel error with ${conn.peer}:`, err);
      });
    }

    joinRoom(roomCode, playerName, selectedPen) {
      this.isHost = false;
      this.roomCode = roomCode;
      this.localName = playerName || (typeof localStorage !== 'undefined' ? localStorage.getItem("pf_name") : null) || "YOU";
      this.localPen = selectedPen || "pilotV5";
      this.currentStriker = "player";
      this.mySlot = 1;
      this.myPenId = "rival";
      this.guestRetryCount = 0;
      this.wasOpen = false;
      this.reconnectAttempts = 0;

      this.setState(STATES.CONNECTING);
      this.startConnectionTimeout();

      const cleanCode = this.sanitizeRoomCode(roomCode);
      const hostPeerId = `pf-desk-${cleanCode}-host`;
      const guestPeerId = `pf-desk-${cleanCode}-guest-${Math.floor(Math.random() * 100000)}`;

      this.initPeer(guestPeerId, () => {
        this.attemptHostConnect(hostPeerId);
      });
    }

    attemptHostConnect(hostPeerId) {
      if (this.state !== STATES.CONNECTING && this.state !== STATES.RECONNECTING) return;
      console.log(`[PF_MULTIPLAYER] Connecting to host: ${hostPeerId} (Attempt ${this.guestRetryCount + 1}/${GUEST_MAX_RETRIES})`);
      const conn = this.peer.connect(hostPeerId, {
        reliable: true,
        serialization: 'json'
      });
      this.conn = conn;
      this.setupGuestDataChannel();
    }

    initPeer(peerId, onOpenCallback) {
      if (this.peer) {
        try { this.peer.destroy(); } catch(e) {}
      }

      try {
        this.peer = new Peer(peerId, {
          debug: 1,
          config: {
            iceServers: ICE_SERVERS
          }
        });

        this.setupVoiceMediaListeners();

        this.peer.on('open', (id) => {
          this.peerId = id;
          console.log(`[PF_MULTIPLAYER] Peer online with ID: ${id}`);
          if (onOpenCallback) onOpenCallback();
        });

        this.peer.on('error', (err) => {
          console.warn("[PF_MULTIPLAYER] PeerJS error:", err);

          if (err.type === 'peer-unavailable' && !this.isHost) {
            this.guestRetryCount++;
            if (this.guestRetryCount < GUEST_MAX_RETRIES && (this.state === STATES.CONNECTING || this.state === STATES.RECONNECTING)) {
              console.log(`[PF_MULTIPLAYER] Host not found yet, retrying in ${GUEST_RETRY_INTERVAL_MS}ms... (${this.guestRetryCount}/${GUEST_MAX_RETRIES})`);
              this.clearGuestRetryTimer();
              this.guestRetryTimerId = setTimeout(() => {
                const cleanCode = this.sanitizeRoomCode(this.roomCode);
                const hostPeerId = `pf-desk-${cleanCode}-host`;
                this.attemptHostConnect(hostPeerId);
              }, GUEST_RETRY_INTERVAL_MS);
            } else if (this.guestRetryCount >= GUEST_MAX_RETRIES) {
              console.warn("[PF_MULTIPLAYER] Host connection failed after all retries");
              this.clearConnectionTimeout();
              this.setState(STATES.ERROR);
              this.emit('disconnected', {
                reason: 'host-unavailable',
                message: 'Could not connect to Host. Please verify the room code and try again.'
              });
            }
          } else if (err.type === 'unavailable-id') {
            console.warn("[PF_MULTIPLAYER] Peer ID already taken. Room code in use.");
            this.clearConnectionTimeout();
            this.setState(STATES.ERROR);
            this.emit('disconnected', {
              reason: 'id-conflict',
              message: 'Room code is already active. Please try creating a new room code.'
            });
          }
        });

        this.peer.on('disconnected', () => {
          console.log("[PF_MULTIPLAYER] Peer disconnected from signalling server, auto-reconnecting...");
          if (this.peer && !this.peer.destroyed) {
            try { this.peer.reconnect(); } catch(e) {}
          }
        });

      } catch(e) {
        console.error("[PF_MULTIPLAYER] Peer initialization exception:", e);
        this.clearConnectionTimeout();
        this.setState(STATES.ERROR);
      }
    }

    clearGuestRetryTimer() {
      if (this.guestRetryTimerId) {
        clearTimeout(this.guestRetryTimerId);
        this.guestRetryTimerId = null;
      }
    }

    setupGuestDataChannel() {
      if (!this.conn) return;

      this.conn.on('open', () => {
        this.clearConnectionTimeout();
        this.clearGuestRetryTimer();
        this.wasOpen = true;
        this.reconnectAttempts = 0;
        this.setState(STATES.OPEN);

        this.sendReliable({
          type: 'HANDSHAKE',
          name: this.localName,
          pen: this.localPen,
          isHost: false
        });

        this.remotePeerId = this.conn.peer;
        this.initiateVoiceCall();

        this.startHeartbeat();
      });

      this.conn.on('data', (data) => {
        this.handlePacket(data, this.conn);
      });

      this.conn.on('close', () => {
        console.log("[PF_MULTIPLAYER] WebRTC DataChannel connection closed");
        this.stopHeartbeat();

        if (this.wasOpen && this.reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
          this.attemptReconnect();
        } else {
          this.setState(STATES.DISCONNECTED);
          this.emit('disconnected', {
            reason: 'peer-closed',
            message: 'Connection to Host closed.'
          });
        }
      });

      this.conn.on('error', (err) => {
        console.warn("[PF_MULTIPLAYER] DataChannel error:", err);
      });
    }

    attemptReconnect() {
      this.reconnectAttempts++;
      console.log(`[PF_MULTIPLAYER] Attempting reconnection ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}...`);
      this.setState(STATES.RECONNECTING);
      this.clearReconnectTimer();

      this.reconnectTimerId = setTimeout(() => {
        if (this.state !== STATES.RECONNECTING) return;
        if (!this.isHost && this.peer && !this.peer.destroyed) {
          const cleanCode = this.sanitizeRoomCode(this.roomCode);
          const hostPeerId = `pf-desk-${cleanCode}-host`;
          this.attemptHostConnect(hostPeerId);
        } else if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
          this.setState(STATES.DISCONNECTED);
          this.emit('disconnected', {
            reason: 'reconnect-failed',
            message: 'Connection lost. Match disconnected.'
          });
        } else {
          this.attemptReconnect();
        }
      }, RECONNECT_INTERVAL_MS);
    }

    clearReconnectTimer() {
      if (this.reconnectTimerId) {
        clearTimeout(this.reconnectTimerId);
        this.reconnectTimerId = null;
      }
    }

    broadcastToAll(packet, excludePeerId = null) {
      for (const [peerId, info] of this.conns) {
        if (excludePeerId && peerId === excludePeerId) continue;
        if (info.conn && info.conn.open) {
          try {
            info.conn.send(packet);
          } catch(e) {
            console.warn(`[PF_MULTIPLAYER] Broadcast error to ${peerId}:`, e);
          }
        }
      }
    }

    sendReliable(packet) {
      this.seq++;
      const reliablePacket = {
        ...packet,
        seq: this.seq,
        bout: this.bout,
        timestamp: Date.now()
      };

      this.sendDirect(reliablePacket);

      if (['HANDSHAKE', 'WELCOME', 'LOBBY_UPDATE', 'TURN', 'PEN_UPDATE', 'START_MATCH', 'LAUNCH_MATCH', 'SETTLE_SYNC', 'PEN_FALLEN', 'SCORE_UPDATE', 'ROUND_RESULT', 'NEW_ROUND', 'REMATCH_VOTE'].includes(reliablePacket.type)) {
        this.registerAckTimeout(reliablePacket, 0);
      }

      return reliablePacket.seq;
    }

    sendDirect(packet) {
      if (this.isHost) {
        this.broadcastToAll(packet);
      } else {
        if (this.conn && this.conn.open) {
          try {
            this.conn.send(packet);
          } catch(e) {
            console.warn("[PF_MULTIPLAYER] Direct send to host failed:", e);
          }
        }
      }
    }

    registerAckTimeout(packet, retryIndex) {
      const delay = this.retryDelays[retryIndex] || 2500;
      const timeoutId = setTimeout(() => {
        if (!this.pendingAcks.has(packet.seq)) return;
        if (retryIndex < this.retryDelays.length) {
          console.log(`[PF_MULTIPLAYER] Re-sending packet seq=${packet.seq} (${packet.type}), attempt=${retryIndex + 1}`);
          this.sendDirect(packet);
          this.registerAckTimeout(packet, retryIndex + 1);
        } else {
          console.warn(`[PF_MULTIPLAYER] Packet seq=${packet.seq} dropped after all retries.`);
          this.pendingAcks.delete(packet.seq);
        }
      }, delay);

      this.pendingAcks.set(packet.seq, { packet, timeoutId, retryIndex });
    }

    handleAck(seq) {
      if (this.pendingAcks.has(seq)) {
        const item = this.pendingAcks.get(seq);
        clearTimeout(item.timeoutId);
        this.pendingAcks.delete(seq);
      }
    }

    handlePacket(packet, fromConn) {
      if (!packet || !packet.type) return;

      if (packet.seq) {
        if (fromConn && fromConn.open) {
          try { fromConn.send({ type: 'ACK', ackSeq: packet.seq }); } catch(e) {}
        }
        if (this.seenSeqs.has(packet.seq)) {
          return;
        }
        this.seenSeqs.add(packet.seq);
        if (this.seenSeqs.size > 200) {
          const oldest = this.seenSeqs.values().next().value;
          this.seenSeqs.delete(oldest);
        }
      }

      switch(packet.type) {
        case 'ACK':
          this.handleAck(packet.ackSeq);
          break;

        case 'HEARTBEAT':
          this.lastHeartbeatReceived = Date.now();
          if (fromConn && fromConn.open) {
            try { fromConn.send({ type: 'HEARTBEAT_ACK' }); } catch(e) {}
          }
          break;

        case 'HEARTBEAT_ACK':
          this.lastHeartbeatReceived = Date.now();
          break;

        case 'WELCOME':
          this.mySlot = packet.slot;
          this.myPenId = packet.myPenId || this.rosterIds[packet.slot] || "rival";
          if (packet.roomPlayerCount) {
            window.roomPlayerCount = packet.roomPlayerCount;
          }
          if (packet.currentChosenPens && Array.isArray(packet.currentChosenPens)) {
            window.currentChosenPens = packet.currentChosenPens;
          }
          this.players = packet.players || [];
          console.log(`[PF_MULTIPLAYER] Welcomed by Host! My slot: ${this.mySlot}, pen: ${this.myPenId}`);
          this.emit('lobbyUpdate', { players: this.players, mySlot: this.mySlot });
          break;

        case 'HANDSHAKE':
          if (this.isHost && fromConn) {
            const guestInfo = this.conns.get(fromConn.peer);
            if (guestInfo) {
              guestInfo.name = packet.name || guestInfo.name;
              guestInfo.pen = packet.pen || guestInfo.pen;

              const existingIdx = this.players.findIndex(p => p.slot === guestInfo.slot);
              const pData = {
                slot: guestInfo.slot,
                penId: guestInfo.penId,
                name: guestInfo.name,
                pen: guestInfo.pen,
                isHost: false,
                peerId: fromConn.peer
              };
              if (existingIdx >= 0) this.players[existingIdx] = pData;
              else this.players.push(pData);

              this.players.sort((a, b) => a.slot - b.slot);

              if (guestInfo.slot === 1) {
                this.remoteName = guestInfo.name;
                this.remotePen = guestInfo.pen;
              }

              this.emit('playerJoined', {
                slot: guestInfo.slot,
                penId: guestInfo.penId,
                remoteName: guestInfo.name,
                remotePen: guestInfo.pen,
                isHost: false,
                players: this.players
              });

              this.broadcastToAll({
                type: 'LOBBY_UPDATE',
                players: this.players
              });
            }
          }
          break;

        case 'LOBBY_UPDATE':
          this.players = packet.players || [];
          if (this.players.length > 0 && !this.isHost) {
            const hostP = this.players.find(p => p.isHost);
            if (hostP) {
              this.remoteName = hostP.name;
              this.remotePen = hostP.pen;
            }
          }
          this.emit('lobbyUpdate', { players: this.players, mySlot: this.mySlot });
          break;

        case 'PEN_UPDATE':
          if (typeof packet.slot === 'number') {
            const p = this.players.find(x => x.slot === packet.slot);
            if (p) p.pen = packet.penId;
            if (packet.slot === 1) this.remotePen = packet.penId;

            if (this.isHost && fromConn) {
              this.broadcastToAll(packet, fromConn.peer);
            }

            this.emit('penUpdated', {
              slot: packet.slot,
              penId: packet.penId,
              remoteName: packet.name
            });
          }
          break;

        case 'START_MATCH':
          this.currentStriker = "player";
          this.emit('matchTimerStarted', {
            pens: packet.pens,
            names: packet.names,
            playerCount: packet.playerCount
          });
          break;

        case 'LAUNCH_MATCH':
          this.currentStriker = "player";
          this.emit('matchStarted', {
            pens: packet.pens,
            names: packet.names,
            playerCount: packet.playerCount
          });
          break;

        case 'TURN':
          if (this.isHost && fromConn) {
            this.broadcastToAll(packet, fromConn.peer);
          }

          this.currentStriker = packet.nextStriker || packet.striker;
          this.emit('opponentShot', {
            striker: packet.striker,
            shot: packet.shot,
            transform: packet.transform
          });
          break;

        case 'LIVE_TRANSFORMS':
          if (this.isHost && fromConn) {
            this.broadcastToAll(packet, fromConn.peer);
          }

          this.emit('liveTransforms', {
            pens: packet.pens
          });
          break;

        case 'SETTLE_SYNC':
          if (this.isHost && fromConn) {
            this.broadcastToAll(packet, fromConn.peer);
          }

          if (packet.striker) {
            this.currentStriker = packet.striker;
          }
          this.emit('settleSync', {
            pens: packet.pens,
            striker: packet.striker
          });
          break;

        case 'PEN_FALLEN':
          this.emit('penFallen', {
            penId: packet.penId,
            pOut: packet.pOut,
            rOut: packet.rOut,
            pens: packet.pens
          });
          break;

        case 'SCORE_UPDATE':
          this.emit('scoreUpdate', {
            scores: packet.scores,
            you: packet.you,
            rival: packet.rival,
            log: packet.log
          });
          break;

        case 'ROUND_RESULT':
          if (packet.striker) {
            this.currentStriker = packet.striker;
          }
          this.emit('roundResult', {
            scores: packet.scores,
            finishedRound: packet.finishedRound || packet.round || 1,
            nextRound: packet.nextRound || ((packet.round || 1) + 1),
            winner: packet.winner,
            matchWinner: packet.matchWinner,
            striker: packet.striker
          });
          break;

        case 'NEW_ROUND':
          if (packet.striker) {
            this.currentStriker = packet.striker;
          }
          this.emit('newRound', {
            scores: packet.scores,
            round: packet.round,
            striker: packet.striker,
            pens: packet.pens
          });
          break;

        case 'REMATCH_VOTE':
          if (this.isHost && fromConn) {
            this.broadcastToAll(packet, fromConn.peer);
          }
          this.emit('rematchVote', {
            vote: packet.vote,
            from: packet.from,
            slot: packet.slot
          });
          break;
      }
    }

    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (this.state === STATES.OPEN) {
          this.sendDirect({ type: 'HEARTBEAT', time: Date.now() });

          if (Date.now() - this.lastHeartbeatReceived > 30000) {
            console.warn("[PF_MULTIPLAYER] No heartbeat response in 30s, connection may be dead");
          }
        }
      }, 10000);
    }

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    setupVisibilityListeners() {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            console.log("[PF_MULTIPLAYER] Page foregrounded, checking connection health...");
            if (this.state === STATES.OPEN) {
              this.sendDirect({ type: 'HEARTBEAT', time: Date.now() });
            }
          }
        });
      }
    }

    sendShot(striker, shotAction, penTransform, nextStriker = null) {
      if (nextStriker) {
        this.currentStriker = nextStriker;
      }

      return this.sendReliable({
        type: 'TURN',
        striker: striker,
        shot: shotAction,
        transform: penTransform,
        nextStriker: nextStriker
      });
    }

    sendLiveTransforms(pensCoordMap) {
      this.sendDirect({
        type: 'LIVE_TRANSFORMS',
        pens: pensCoordMap
      });
    }

    sendSettleCoordinates(pensCoordMap, striker) {
      return this.sendReliable({
        type: 'SETTLE_SYNC',
        pens: pensCoordMap,
        striker: striker || this.currentStriker
      });
    }

    sendPenFallen(pOut, rOut, pensCoordMap, penId = null) {
      return this.sendReliable({
        type: 'PEN_FALLEN',
        penId: penId,
        pOut: pOut,
        rOut: rOut,
        pens: pensCoordMap
      });
    }

    sendNewRound(round, scores, striker, pensPayload) {
      this.currentStriker = striker;
      return this.sendReliable({
        type: 'NEW_ROUND',
        round: round,
        scores: scores,
        striker: striker,
        pens: pensPayload
      });
    }

    sendScoreUpdate(scores, you, rival, log) {
      return this.sendReliable({
        type: 'SCORE_UPDATE',
        scores: scores,
        you: you,
        rival: rival,
        log: log
      });
    }

    sendRematchVote(vote, from, slot = 0) {
      return this.sendReliable({
        type: 'REMATCH_VOTE',
        vote: vote,
        from: from,
        slot: slot
      });
    }

    isMyTurn() {
      return this.currentStriker === this.getMyPenId();
    }

    // =========================================================================
    // REAL-TIME P2P VOICE CHAT ENGINE (WebRTC Audio)
    // =========================================================================
    getAudioElement() {
      if (!this.voiceAudioEl) {
        this.voiceAudioEl = document.getElementById('pf-remote-voice-audio');
      }
      if (!this.voiceAudioEl) {
        this.voiceAudioEl = document.createElement('audio');
        this.voiceAudioEl.id = 'pf-remote-voice-audio';
        this.voiceAudioEl.autoplay = true;
        this.voiceAudioEl.playsInline = true;
        this.voiceAudioEl.setAttribute('playsinline', '');
        this.voiceAudioEl.setAttribute('webkit-playsinline', '');
        document.body.appendChild(this.voiceAudioEl);
      }
      return this.voiceAudioEl;
    }

    createSilentVoiceStream() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        const track = dst.stream.getAudioTracks()[0];
        if (track) track.enabled = false;
        this.silentVoiceStream = dst.stream;
        return dst.stream;
      } catch(e) {
        return null;
      }
    }

    setupVoiceMediaListeners() {
      if (!this.peer) return;

      this.peer.on('call', (incomingCall) => {
        console.log('[PF_VOICE] Incoming voice call from peer...');
        this.voiceCall = incomingCall;
        const streamToSend = this.localVoiceStream || this.silentVoiceStream || this.createSilentVoiceStream();
        incomingCall.answer(streamToSend);

        incomingCall.on('stream', (remoteStream) => {
          console.log('[PF_VOICE] Received remote voice stream!');
          this.handleRemoteVoiceStream(remoteStream);
        });

        incomingCall.on('close', () => {
          console.log('[PF_VOICE] Remote voice call closed');
          this.isVoiceConnected = false;
          this.emit('voiceStateChanged', this.getVoiceState());
        });

        incomingCall.on('error', (err) => {
          console.warn('[PF_VOICE] Voice call error:', err);
        });
      });
    }

    initiateVoiceCall() {
      if (!this.peer || !this.remotePeerId || this.voiceCall) return;
      const streamToSend = this.localVoiceStream || this.silentVoiceStream || this.createSilentVoiceStream();
      if (!streamToSend) return;

      try {
        console.log(`[PF_VOICE] Initiating voice call to ${this.remotePeerId}...`);
        const call = this.peer.call(this.remotePeerId, streamToSend);
        this.voiceCall = call;

        call.on('stream', (remoteStream) => {
          console.log('[PF_VOICE] Remote stream connected from outgoing call!');
          this.handleRemoteVoiceStream(remoteStream);
        });

        call.on('close', () => {
          console.log('[PF_VOICE] Outgoing voice call closed');
          this.isVoiceConnected = false;
          this.emit('voiceStateChanged', this.getVoiceState());
        });

        call.on('error', (err) => {
          console.warn('[PF_VOICE] Outgoing voice call error:', err);
        });
      } catch(e) {
        console.warn('[PF_VOICE] Could not initiate call:', e);
      }
    }

    handleRemoteVoiceStream(remoteStream) {
      this.remoteVoiceStream = remoteStream;
      this.isVoiceConnected = true;
      const audioEl = this.getAudioElement();
      if (audioEl) {
        audioEl.srcObject = remoteStream;
        audioEl.muted = this.isSpeakerMuted;
        audioEl.play().catch(e => {
          console.log('[PF_VOICE] Audio playback waiting for mobile user interaction:', e);
        });
      }
      this.startVoiceVolumeMonitoring();
      this.emit('voiceStateChanged', this.getVoiceState());
    }

    async toggleMic() {
      try {
        if (this.isMicMuted) {
          // Unmute Microphone
          if (!this.localVoiceStream) {
            console.log('[PF_VOICE] Requesting microphone access for mobile...');
            this.localVoiceStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              },
              video: false
            });
          }
          const audioTrack = this.localVoiceStream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = true;
          }
          this.isMicMuted = false;

          // Replace track in active WebRTC stream if connected
          if (this.voiceCall && this.voiceCall.peerConnection) {
            const senders = this.voiceCall.peerConnection.getSenders();
            const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
            if (audioSender && audioTrack) {
              await audioSender.replaceTrack(audioTrack);
            }
          } else if (this.state === STATES.OPEN && this.remotePeerId) {
            this.initiateVoiceCall();
          }
        } else {
          // Mute Microphone
          if (this.localVoiceStream) {
            const audioTrack = this.localVoiceStream.getAudioTracks()[0];
            if (audioTrack) {
              audioTrack.enabled = false;
            }
          }
          this.isMicMuted = true;
        }
        this.emit('voiceStateChanged', this.getVoiceState());
        return !this.isMicMuted;
      } catch(err) {
        console.error('[PF_VOICE] Microphone permission error:', err);
        alert('Microphone access is required for voice chat. Please allow mic permissions in your browser.');
        this.isMicMuted = true;
        this.emit('voiceStateChanged', this.getVoiceState());
        return false;
      }
    }

    toggleSpeaker() {
      this.isSpeakerMuted = !this.isSpeakerMuted;
      const audioEl = this.getAudioElement();
      if (audioEl) {
        audioEl.muted = this.isSpeakerMuted;
        if (!this.isSpeakerMuted && audioEl.paused && audioEl.srcObject) {
          audioEl.play().catch(() => {});
        }
      }
      this.emit('voiceStateChanged', this.getVoiceState());
      return !this.isSpeakerMuted;
    }

    getVoiceState() {
      return {
        micMuted: this.isMicMuted,
        speakerMuted: this.isSpeakerMuted,
        connected: this.isVoiceConnected,
        speakingLocal: this.isSpeakingLocal,
        speakingRemote: this.isSpeakingRemote
      };
    }

    startVoiceVolumeMonitoring() {
      if (this.voiceMeterRunning) return;
      this.voiceMeterRunning = true;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        let localAnalyser = null, remoteAnalyser = null;

        if (this.localVoiceStream) {
          const src = ctx.createMediaStreamSource(this.localVoiceStream);
          localAnalyser = ctx.createAnalyser();
          localAnalyser.fftSize = 64;
          src.connect(localAnalyser);
        }
        if (this.remoteVoiceStream) {
          const src = ctx.createMediaStreamSource(this.remoteVoiceStream);
          remoteAnalyser = ctx.createAnalyser();
          remoteAnalyser.fftSize = 64;
          src.connect(remoteAnalyser);
        }

        const buf = new Uint8Array(32);
        const checkVol = () => {
          if (!this.voiceMeterRunning) return;
          if (localAnalyser && !this.isMicMuted) {
            localAnalyser.getByteFrequencyData(buf);
            const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
            const speaking = avg > 14;
            if (speaking !== this.isSpeakingLocal) {
              this.isSpeakingLocal = speaking;
              this.emit('voiceSpeaking', { who: 'local', speaking });
            }
          }
          if (remoteAnalyser && !this.isSpeakerMuted) {
            remoteAnalyser.getByteFrequencyData(buf);
            const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
            const speaking = avg > 14;
            if (speaking !== this.isSpeakingRemote) {
              this.isSpeakingRemote = speaking;
              this.emit('voiceSpeaking', { who: 'remote', speaking });
            }
          }
          requestAnimationFrame(checkVol);
        };
        requestAnimationFrame(checkVol);
      } catch(e) {}
    }

    disconnect() {
      this.stopHeartbeat();
      this.clearConnectionTimeout();
      this.clearGuestRetryTimer();
      this.clearReconnectTimer();

      for (const [seq, item] of this.pendingAcks) {
        clearTimeout(item.timeoutId);
      }
      this.pendingAcks.clear();

      for (const [, info] of this.conns) {
        try { info.conn.close(); } catch(e) {}
      }
      this.conns.clear();

      if (this.conn) {
        try { this.conn.close(); } catch(e) {}
        this.conn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch(e) {}
        this.peer = null;
      }

      // Clean up Voice Chat
      this.isVoiceConnected = false;
      this.voiceMeterRunning = false;
      if (this.voiceCall) {
        try { this.voiceCall.close(); } catch(e) {}
        this.voiceCall = null;
      }
      if (this.localVoiceStream) {
        try { this.localVoiceStream.getTracks().forEach(t => t.stop()); } catch(e) {}
        this.localVoiceStream = null;
      }
      if (this.silentVoiceStream) {
        try { this.silentVoiceStream.getTracks().forEach(t => t.stop()); } catch(e) {}
        this.silentVoiceStream = null;
      }
      this.isMicMuted = true;
      this.emit('voiceStateChanged', this.getVoiceState());

      this.wasOpen = false;
      this.reconnectAttempts = 0;
      this.guestRetryCount = 0;
      this.setState(STATES.DISCONNECTED);
    }
  }

  // Export singleton instance
  global.PF_MULTIPLAYER = new MultiplayerManager();
  global.MultiplayerManager = MultiplayerManager;

})(typeof window !== 'undefined' ? window : this);
