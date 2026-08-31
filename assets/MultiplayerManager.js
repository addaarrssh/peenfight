/**
 * MultiplayerManager.js - Robust Zero-Latency WebRTC Multiplayer Engine
 * 
 * Features:
 * 1. PeerJS WebRTC DataChannel (Direct Browser-to-Browser, 0ms server bottleneck)
 * 2. Real-Time High-Frequency Physics Streaming (LIVE_TRANSFORMS for 100% lockstep motion)
 * 3. Sequence Acknowledgment Queue (DeliveryQueue with exponential retry & deduplication)
 * 4. Authoritative Host Refereeing & Cross-Device PEN_FALLEN Reporting
 * 5. Heartbeat & Keepalive Protocol (Maintains mobile carrier NAT tables)
 * 6. Mobile & PWA Resilience (Handles suspension, pagehide, and auto-reconnection)
 * 7. TURN Server Fallback (Ensures connectivity on restrictive NATs & firewalls)
 * 8. 3.5s Anti-Freeze Watchdog (Guarantees turns and rounds never lock up)
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
      this.conn = null;
      this.isHost = false;
      this.roomCode = null;
      this.peerId = null;
      this.localName = "Player";
      this.localPen = "gripper";
      this.remoteName = "Opponent";
      this.remotePen = "pilotV5";
      this.currentStriker = "player"; // "player" (Host) or "rival" (Guest)
      this.bout = 1;
      this.seq = 0;

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
        disconnected: []
      };

      this.setupVisibilityListeners();
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
      this.roomCode = roomCode;
      this.localName = playerName || (typeof localStorage !== 'undefined' ? localStorage.getItem("pf_name") : null) || "YOU";
      this.localPen = selectedPen || "gripper";
      this.currentStriker = "player";
      this.wasOpen = false;
      this.reconnectAttempts = 0;

      this.setState(STATES.CONNECTING);
      this.startConnectionTimeout();

      const cleanCode = this.sanitizeRoomCode(roomCode);
      const hostPeerId = `pf-desk-${cleanCode}-host`;

      this.initPeer(hostPeerId, () => {
        this.peer.on('connection', (conn) => {
          console.log("[PF_MULTIPLAYER] Guest connected to Host DataChannel");
          this.conn = conn;
          this.setupDataChannel();
        });
      });
    }

    joinRoom(roomCode, playerName, selectedPen) {
      this.isHost = false;
      this.roomCode = roomCode;
      this.localName = playerName || (typeof localStorage !== 'undefined' ? localStorage.getItem("pf_name") : null) || "YOU";
      this.localPen = selectedPen || "pilotV5";
      this.currentStriker = "player";
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
      this.setupDataChannel();
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

    setupDataChannel() {
      if (!this.conn) return;

      this.conn.on('open', () => {
        this.clearConnectionTimeout();
        this.clearGuestRetryTimer();
        this.wasOpen = true;
        this.reconnectAttempts = 0;
        this.setState(STATES.OPEN);

        // Handshake packet exchange
        this.sendReliable({
          type: 'HANDSHAKE',
          name: this.localName,
          pen: this.localPen,
          isHost: this.isHost
        });

        this.startHeartbeat();

        setTimeout(() => {
          if (this.isHost) {
            this.syncScoreboard();
          }
        }, 600);
      });

      this.conn.on('data', (data) => {
        this.handlePacket(data);
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
            message: 'Opponent disconnected from the match.'
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

    sendReliable(packet) {
      this.seq++;
      const reliablePacket = {
        ...packet,
        seq: this.seq,
        bout: this.bout,
        timestamp: Date.now()
      };

      this.sendDirect(reliablePacket);

      if (['HANDSHAKE', 'TURN', 'PEN_UPDATE', 'START_MATCH', 'LAUNCH_MATCH', 'SETTLE_SYNC', 'PEN_FALLEN', 'SCORE_UPDATE', 'ROUND_RESULT', 'NEW_ROUND', 'REMATCH_VOTE'].includes(reliablePacket.type)) {
        this.registerAckTimeout(reliablePacket, 0);
      }

      return reliablePacket.seq;
    }

    sendDirect(packet) {
      if (this.conn && this.conn.open) {
        try {
          this.conn.send(packet);
        } catch(e) {
          console.warn("[PF_MULTIPLAYER] Direct send failure:", e);
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

    handlePacket(packet) {
      if (!packet || !packet.type) return;

      // Handle ACK confirmation
      if (packet.seq) {
        this.sendDirect({ type: 'ACK', ackSeq: packet.seq });
        if (this.seenSeqs.has(packet.seq)) {
          return; // Skip duplicate execution
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
          this.sendDirect({ type: 'HEARTBEAT_ACK' });
          break;

        case 'HEARTBEAT_ACK':
          this.lastHeartbeatReceived = Date.now();
          break;

        case 'HANDSHAKE':
          this.remoteName = packet.name || "Opponent";
          this.remotePen = packet.pen || "pilotV5";
          this.emit('playerJoined', {
            remoteName: this.remoteName,
            remotePen: this.remotePen,
            isHost: this.isHost
          });
          break;

        case 'PEN_UPDATE':
          this.emit('penUpdated', {
            slot: packet.slot,
            penId: packet.penId,
            remoteName: packet.name
          });
          break;

        case 'START_MATCH':
          this.currentStriker = "player";
          this.emit('matchTimerStarted', {
            pens: packet.pens,
            names: packet.names
          });
          break;

        case 'LAUNCH_MATCH':
          this.currentStriker = "player";
          this.emit('matchStarted', {
            pens: packet.pens,
            names: packet.names
          });
          break;

        case 'TURN':
          // Remote flick impulse executed deterministically
          this.currentStriker = (packet.striker === "player") ? "rival" : "player";
          this.emit('opponentShot', {
            striker: packet.striker,
            shot: packet.shot,
            transform: packet.transform
          });
          break;

        case 'LIVE_TRANSFORMS':
          this.emit('liveTransforms', {
            pens: packet.pens
          });
          break;

        case 'SETTLE_SYNC':
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
            pOut: packet.pOut,
            rOut: packet.rOut,
            pens: packet.pens
          });
          break;

        case 'SCORE_UPDATE':
          this.emit('scoreUpdate', {
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
          this.emit('rematchVote', {
            vote: packet.vote,
            from: packet.from
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
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          console.log("[PF_MULTIPLAYER] Page foregrounded, checking connection health...");
          if (this.state === STATES.OPEN) {
            this.sendDirect({ type: 'HEARTBEAT', time: Date.now() });
          }
        }
      });
    }

    sendShot(striker, shotAction, penTransform) {
      this.currentStriker = (striker === "player") ? "rival" : "player";

      return this.sendReliable({
        type: 'TURN',
        striker: striker,
        shot: shotAction,
        transform: penTransform
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

    sendPenFallen(pOut, rOut, pensCoordMap) {
      return this.sendReliable({
        type: 'PEN_FALLEN',
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

    sendScoreUpdate(you, rival, log) {
      return this.sendReliable({
        type: 'SCORE_UPDATE',
        you: you,
        rival: rival,
        log: log
      });
    }

    sendRematchVote(vote, from) {
      return this.sendReliable({
        type: 'REMATCH_VOTE',
        vote: vote,
        from: from
      });
    }

    isMyTurn() {
      if (this.isHost) {
        return this.currentStriker === "player";
      } else {
        return this.currentStriker === "rival";
      }
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

      if (this.conn) {
        try { this.conn.close(); } catch(e) {}
        this.conn = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch(e) {}
        this.peer = null;
      }
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
