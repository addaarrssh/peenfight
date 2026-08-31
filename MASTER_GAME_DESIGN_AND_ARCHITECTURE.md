# 🖊️ PEN FIGHT — MASTER ARCHITECTURE, GAME DESIGN & DEVELOPER BIBLE

> **CRITICAL DEVELOPER DIRECTIVE:**  
> Read this document thoroughly before modifying, adding features, or debugging any part of the Pen Fight codebase.  
> This file is the single source of truth for networking architecture, physics simulation, game flow, pen stats, and multiplayer synchronization.

---

## 1. PROJECT VISION & CORE IDENTITY

**Pen Fight** is an authentic, physics-driven, nostalgic 3D tribute to the classic 90s/2000s Indian classroom desk battle.

- **Engine:** Three.js + Rapier 3D Physics (WebAssembly).
- **Art Style:** Classroom desk setting, comic-book handwritten chit paper cards, notebook ink dots, starburst badges.
- **Networking:** Peer-to-Peer WebRTC DataChannels (0ms server bottleneck, $0 hosting cost, browser-to-browser direct connection).
- **Platform:** Responsive Web & PWA (optimized for iOS Safari, Android Chrome, and Desktop).

---

## 2. END-TO-END GAME FLOW & USER JOURNEY

```
                                  ┌────────────────────────┐
                                  │   🏠 MAIN ARCADE HUB   │
                                  │  (Arsenal, Rules, PWA) │
                                  └───────────┬────────────┘
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
        ┌─────────────────────────┐                       ┌─────────────────────────┐
        │  🕹️ 1P SOLO CAMPAIGN    │                       │  👥 REAL-TIME 2P-8P     │
        │     (Classroom Desks)   │                       │      MULTIPLAYER        │
        └────────────┬────────────┘                       └────────────┬────────────┘
                     │                                                 │
   ┌─────────────────┴─────────────────┐              ┌────────────────┴────────────────┐
   ▼                 ▼                 ▼              ▼                                 ▼
Class 9B         Class 9C          Lab Wings      👑 Host Creates Room           📱 Friend Joins Room
(11 Rivals)    (Pencils/Erasers)   (Wet Sinks)    (Code & Share Link)            (via WhatsApp / URL)
   │                 │                 │              │                                 │
   └─────────────────┼─────────────────┘              └────────────────┬────────────────┘
                     │                                                 │
                     ▼                                                 ▼
        ┌─────────────────────────┐                       ┌─────────────────────────┐
        │    🏆 PROGRESSION       │                       │  ⚡ PRE-MATCH CHIT       │
        │ Unlock 12 Indian Pens   │                       │  8s Pen Pick & Sync     │
        └─────────────────────────┘                       └────────────┬────────────┘
                                                                       │
                                                                       ▼
                                                          ┌─────────────────────────┐
                                                          │  ⚔️ 3D BATTLE ARENA     │
                                                          │  • Turn-based Aim & Cue │
                                                          │  • Deterministic Physics│
                                                          │  • 0ms Lag Impulse      │
                                                          │  • Live Scoreboard (BO5)│
                                                          └─────────────────────────┘
```

---

## 3. NETWORKING & REAL-TIME MULTIPLAYER ARCHITECTURE

### 3.1 Why WebRTC DataChannels (PeerJS) is Used:
1. **Zero Server Dependency & $0 Cost:** Vercel is serverless; it cannot maintain persistent WebSocket state.
2. **Zero Input Latency:** Directly connects Player 1 (Host) and Player 2 (Guest) browser-to-browser with 10–30ms physical ping.
3. **No External Token Rejections:** Bypasses legacy Supabase / PostgreSQL RPC limits.

### 3.2 Network Module: `assets/MultiplayerManager.js`
The singleton `window.PF_MULTIPLAYER` manages all P2P states, ACKs, and packets.

```
[Device A (Host)]                                                    [Device B (Guest)]
       │                                                                      │
       │ 1. Local drag & aim (0ms input latency)                              │
       │ 2. Physics impulse calculated locally                                │
       │                                                                      │
       │ 3. Compact TURN Packet: { striker, shot, transform, seq }            │
       ├─────────────────── Direct WebRTC DataChannel ───────────────────────►│
       │                     (PeerJS + Google/Twilio STUN)                    │ 4. Receive TURN
       │                                                                      │ 5. Snap start pos & replay impulse
       │◄─────────────────────────── [ACK (seq)] ─────────────────────────────┤
```

### 3.3 Strict Packet Protocol:
| Packet Type | Trigger / Description | Payload Structure |
|---|---|---|
| `HANDSHAKE` | Sent immediately upon WebRTC DataChannel `open` | `{ type: 'HANDSHAKE', name, pen, isHost, seq }` |
| `ACK` | Sent back to sender for every reliable packet | `{ type: 'ACK', ackSeq: number }` |
| `PEN_UPDATE` | Triggered when player changes pen or clicks 🎲 Random | `{ type: 'PEN_UPDATE', slot: 0\|1, penId: string, name: string, seq }` |
| `LAUNCH_MATCH` | Host clicks "ENTER ARENA" or 8s timer elapses | `{ type: 'LAUNCH_MATCH', pens: [p1Pen, p2Pen], seq }` |
| `TURN` | Player releases flick shot | `{ type: 'TURN', striker: 'player'\|'rival', shot: { strikeT, dir, power }, transform: { p:[x,y,z], q:[x,y,z,w] }, seq }` |
| `SETTLE_SYNC` | Triggered when physics rests (`isSettled`) on shooter's screen | `{ type: 'SETTLE_SYNC', pens: { player: {p, q}, rival: {p, q} }, seq }` |
| `HEARTBEAT` | Ping sent every 10 seconds to keep 4G/5G mobile NAT routes open | `{ type: 'HEARTBEAT', time: number }` |

### 3.4 Golden Rules for Multiplayer Bug Prevention:
1. **Never Stream Continuous 60fps Coordinates:** Streaming 60fps causes severe jitter on mobile cellular connections. Transmit **only 1 packet per turn** containing the launch vector and starting transform.
2. **Echo-Loop Guard (`isHandlingRemoteShot`):** When executing an incoming remote shot on the receiving device, `isHandlingRemoteShot = true` MUST be set so the receiving client does not re-broadcast the shot back.
3. **Turn-Based Aim Permission (`canAim`):**
   - Host device can only drag & aim `player` (`currentStriker === 'player'`).
   - Guest device can only drag & aim `rival` (`currentStriker === 'rival'`).
   - Computer Bot AI auto-shooting MUST be disabled during multiplayer.
4. **Reliability Queue (`DeliveryQueue`):** Every turn, pen selection, and match launch packet must be acknowledged with an `ACK`. If no ACK within 350ms, auto-retry with backoff `[350, 700, 1400, 2500]ms`.
5. **Sequence Deduplication (`seenSeqs`):** Maintain a set of the last 200 sequence IDs to prevent duplicate shot triggers.

---

## 4. THE 12 ICONIC INDIAN PENS & PHYSICAL PROFILES

All pens are modeled with precise Rapier 3D rigid body dynamics:

| # | Pen ID | Display Name | Shape / Tip | Mass & Balance | Friction | In-Game Trait & Behavior |
|---|--------|--------------|-------------|----------------|----------|--------------------------|
| 1 | `reynolds045` | **Reynolds 045** | Hexagonal Fine | Light (Balanced) | 0.36 | Standard all-rounder; sharp precise ricochets. |
| 2 | `gripper` | **Cello Gripper** | Soft Rubber Grip | Medium (Low Center) | 0.48 | High desk friction; resistant to being pushed off. |
| 3 | `butterflow` | **Cello Butterflow** | Round Metallic | Heavy Brass Tip | 0.30 | Smooth gliding with forward momentum. |
| 4 | `pilotV5` | **Pilot V5** | Narrow Liquid Ink | Light (Precision) | 0.22 | Ultra-low friction; fast long-distance snipes. |
| 5 | `hauserXO` | **Hauser XO** | Matte Polygon | Uniform Medium | 0.38 | Clean predictable rebound angles off edges. |
| 6 | `natarajClassic`| **Nataraj Classic** | Slim Plastic | Ultra-Lightweight | 0.40 | Agile snaps; high edge-recovery potential. |
| 7 | `montexMegaTop`| **Montex Mega Top**| Wide Clip Cap | Top-Heavy | 0.34 | Spin-heavy hits; flips opponents on glancing blows. |
| 8 | `lincOceanGel` | **Linc Ocean Gel** | Smooth Barrel | Balanced Gel | 0.32 | High-speed straight trajectories. |
| 9 | `parkerVector` | **Parker Vector** | Stainless Steel | Heavy Weight Tank | 0.28 | Massive kinetic impact; knocks lighter pens off. |
| 10 | `reynoldsRacer` | **Reynolds Racer Gel**| Aerodynamic | Medium-Light | 0.35 | Curve-flick mastery; rapid acceleration. |
| 11 | `roritoFlymax` | **Rorito Flymax** | Ergonomic | Stable Wide Body | 0.44 | Anti-roll stability; anchors near the rim. |
| 12 | `trimax` | **Reynolds Trimax** | Heavy Cartridge| Maximum Mass | 0.42 | The Boss Pen; unstoppable heavy force. |

---

## 5. SINGLE-PLAYER CAMPAIGN & ARENAS

### 5.1 Class 9B (The 11 Classroom Desk Rivals):
Progression ladder where winning matches lets you claim opponent pens:
1. **Bunty** (Reynolds 045)
2. **Rinkesh** (Cello Gripper)
3. **Pooja** (Nataraj Classic)
4. **Sameer** (Hauser XO)
5. **Divya** (Linc Ocean Gel)
6. **Vikram** (Cello Butterflow)
7. **Ananya** (Pilot V5)
8. **Rohan** (Reynolds Racer Gel)
9. **Kavita** (Montex Mega Top)
10. **Kabir** (Parker Vector)
11. **Aarav & Zoya** (Reynolds Trimax Champions)

### 5.2 Special Class Wings:
- **Class 9C (Pencils Only):** Wooden pencils with graphite cores; spending erasers lets you undo accidental slips.
- **Chemistry Lab:** Wet tiled sinks with realistic water spills and slippery physics.
- **Physics Lab:** Broken sloped desks with incline gravity and wooden obstacle blocks.

---

## 6. UI, SOUND & VISUAL POLISH STANDARDS

1. **Classroom Chit Aesthetic:**
   - Use CSS variables (`--pf-paper`, `--pf-orange`, `--pf-teal`, `--pf-border-thick`, `--pf-font-display`).
   - Handwritten card borders, drop shadows (`box-shadow: 3px 3px 0 var(--pf-ink)`), and comic badges.
2. **Live Desk-Mounted Scoreboard:**
   - Mounted seamlessly on the front edge of the 3D table.
   - Shows active striker indicator, player avatars, equipped pen thumbnails, and best-of-5 round dots (`.score-pip.active`).
3. **3D Audio System (Web Audio API):**
   - Plastic pen collisions (`snap`, `clack`), desk knocks (`deskTap`), floor drops (`floorThud`), classroom ambient hubbub, and school bell triggers.
4. **Isolated Arena View:**
   - All background classroom desks and benches are automatically cleaned/hidden (`cleanBackgroundFurniture`) to focus 100% on the battle desk.

---

## 7. DEVELOPER CHECKLIST (BEFORE COMMITTING / DEPLOYING)

- [ ] **No External CDN Dependencies:** All critical libraries (PeerJS, Rapier, Three.js) must be bundled in `/assets/` so adblockers or slow networks don't break functionality.
- [ ] **Multiplayer Synchronization Verified:**
  - [ ] Pre-match pen selection updates on both screens in real time (`PEN_UPDATE`).
  - [ ] Match launches synchronously on both devices (`LAUNCH_MATCH`).
  - [ ] Local shots execute with 0ms lag; remote shots replay accurately without echo loops.
  - [ ] Resting coordinates lock into place after settle (`SETTLE_SYNC`).
  - [ ] Active player turn indicator updates correctly on both screens.
- [ ] **Vercel Build Verified:** Run `./node_modules/.bin/vercel --prod --yes` and verify production alias `https://peenfight.vercel.app`.

---

*Last Updated & Verified: August 31, 2026*  
*Author: Google Antigravity & DeepMind Advanced Agentic Coding Team*
