# Online Multiplayer Improvement Plan - Version 2 (Full Implementation Plan)

**Date:** January 25, 2026
**Status:** 📋 Consolidated / Full Detail
**Goal:** Fully functional Online FFA Multiplayer (8 players) with Steam Spacewar testing support, plus team mode and Infinity LMS.
**Source:** Reorganized and unified from `docs/ONLINE_MULTIPLAYER_IMPROVEMENT_PLAN.md`.

---

## Table of Contents
- Current State Assessment
- Reference Architecture & Best Practices
- Unified Roadmap (Phases 1-8)
- Detailed Specifications
- Technical Implementation Details
- Remaining Implementation Backlog
- Notes & Decisions
- Security Considerations
- References
- Implementation Order and Plan Status

---

## 📊 Current State Assessment

### What's Working (✅)
| Component | Status | Notes |
|-----------|--------|-------|
| Steam Networking Layer | 100% | Real Steam + Mock mode both functional |
| Lobby Browser UI | 100% | Browse, create, join lobbies |
| Waiting Room UI | 90% | Player list + ready flow done; lobby chat input pending |
| Match Config Modal | 90% | Core settings done; advanced options pending |
| Game Rendering | 100% | 3-column layout + Phaser main board + opponent canvases |
| Match Results Screen | 100% | Full standings + stats + kill summary |
| In-Game Chat | 80% | Send/receive working; channels/moderation pending |
| Scoreboard + Overlay | 100% | Right panel + TAB overlay |
| Battle Log (Kill Feed) | 90% | Kills + garbage; add more event types |
| Game State Management | 90% | Authoritative host + validation; resync missing |
| Attack/Garbage System | 95% | Queue sync + prediction; attack scaling pending |
| Win Conditions | 100% | Frags, Time, Points, Lines, Never |
| Anti-Cheat Validation | 70% | Input validation present; protocol hardening pending |
| Deterministic RNG | 100% | Seeded piece generation |

### What's Missing / Needs Hardening (❌)
| Component | Status | Impact |
|-----------|--------|--------|
| Protocol envelope + seq/tick + matchId | 0% | CRITICAL - out-of-order/stray packets not rejected |
| Resync + syncpoint gating | 0% | HIGH - no safe late-join or desync recovery |
| Host migration handoff | 40% | HIGH - election only, no state transfer |
| Disconnect detection + reconnection | 0% | HIGH - no grace period or resume |
| Prediction reconciliation | 0% | HIGH - local prediction can drift |
| Snapshot compression (binary/delta) | 0% | MEDIUM - bandwidth spikes at 8 players |
| Attack scaling toggle | 0% | MEDIUM - config exists but scaling disabled |
| Chat channels + moderation | 0% | MEDIUM - no team/spectator channels, no rate limit |

### Development Progress: ~80% Complete (core gameplay) / ~55% Complete (net robustness)

---

## 🎮 Reference Architecture & Best Practices

### Quadra's Approach (Reference Implementation)
```
┌─────────────────────────────────────────────────────────┐
│ QUADRA ARCHITECTURE                                      │
├─────────────────────────────────────────────────────────┤
│ • Server-Authoritative TCP/UDP model                    │
│ • Binary packet serialization (efficient)               │
│ • Deterministic piece sequence via shared seed          │
│ • Full state download on player join                    │
│ • UDP broadcast for LAN discovery                       │
│ • Survivor mode with round-based respawns               │
│ • Attack scaling based on player count                  │
│ • Recording/replay support                              │
└─────────────────────────────────────────────────────────┘
```

### Serenity Blocks Current Approach
```
┌─────────────────────────────────────────────────────────┐
│ SERENITY BLOCKS ARCHITECTURE                            │
├─────────────────────────────────────────────────────────┤
│ • Host-Authoritative P2P via Steam                      │
│ • JSON message serialization                            │
│ • Deterministic piece sequence via shared seed ✓        │
│ • State sync at 30Hz (host → peers)                     │
│ • Steam lobby discovery (global, not LAN-only)          │
│ • FFA mode only (no Survivor yet)                       │
│ • Garbage routing to all opponents                      │
│ • Mock mode for browser testing                         │
└─────────────────────────────────────────────────────────┘
```

### Best Practices to Adopt from Quadra

| Feature | Quadra Implementation | Adoption Plan |
|---------|----------------------|---------------|
| **Deterministic Sync** | Shared seed = same pieces | ✅ Already implemented |
| **Join Sync + Full Download** | Server sends full canvas on join at safe syncpoint | 🔴 Not implemented; add in Phase 4 (resync) |
| **Syncpoints** | Server broadcasts state gates to align transitions | 🔴 Not implemented; add with resync gating |
| **Client-Side Prediction** | TCP acceptable in dial-up era, modern needs prediction | 🟡 Partial (input buffering + local prediction); add reconciliation |
| **Move Compression** | Bit-packed input stream (P_MOVES) | 🔴 Not implemented; batch inputs per tick |
| **Delta State Sync** | Only send changes | 🟡 Partial (skip broadcasts on no-change); add delta/binary |
| **Attack Balancing** | Reduce damage with many players | 🔴 Config exists; scaling disabled in router |
| **Binary Encoding** | Raw bytes for grid (320 bytes/player) | 🔴 Not implemented; target Phase 4.2 |
| **Survivor Mode** | Round-based, respawn mechanics | 📋 Phase 5+ enhancement |
| **Recording/Replay** | Packet logging for replays | 🔴 Not implemented; add passive logging + export |
| **Handicap System** | Skill-based starting levels | 🟡 Core fields exist; add UI + validation |

### Steam Spacewar P2P Architecture (Best Practice for Serenity Blocks)
- **Transport:** Steam lobbies for discovery + metadata; Steam P2P for gameplay (SDR-backed if available).
- **API choice:** Prefer SteamNetworkingSockets; if staying on `sendP2PPacket`, still use channels + reliability tiers.
- **Authority:** Host-authoritative simulation; clients send input only; host validates and broadcasts state.
- **Reliability tiers:** Reliable for lobby/config/start/end/chat; UnreliableNoDelay for 30Hz snapshots; separate channels per tier.
- **8-player throughput:** Cap snapshot size and pace per peer; degrade to 20Hz or lower-LOD snapshots if host uplink or send queues grow.
- **Message envelope:** Add `matchId`, `matchNonce`, `hostSteamId`, `seq`, `tick`, `sentAt` to every packet; drop stale/out-of-order snapshots.
- **Join/resync:** Full snapshot on join at safe syncpoint; clients wait for snapshot ack before starting.
- **Health:** Ping/RTT tracking, packet loss counters, disconnect timeouts, host migration fallbacks.
- **Security:** Rate limit input, reject impossible moves, include per-match nonce to ignore stray packets.

### Additional Best Practices to Bake Into the Plan
- **Protocol versioning:** `NET_HELLO/NET_WELCOME` handshake with version + feature flags.
- **Lobby → match state machine:** Open → Locked → In-Match → Post-Match → Rematch, with late-join rules.
- **Packet budgets:** Binary snapshots for 30Hz; JSON only for control/config.
- **Per-peer LOD:** Local board full-rate; opponents reduced; spectators lowest.
- **Adaptive snapshot rate:** 30Hz target, drop to 20Hz under loss/queue pressure.
- **Host migration handoff:** New host sends authoritative snapshot + matchId continuity.
- **QoS UX:** Show RTT, loss, relay/direct, and throttling indicators.
- **Network test harness:** Simulate latency/loss/jitter for regression testing.

### Best-in-Class Quality Gates (NEW)
- **Input latency:** < 50ms local feel; < 120ms at 150ms RTT with prediction + reconciliation.
- **Snapshot budget:** <= 4KB total per 8-player snapshot @ 30Hz; drop rate < 1%.
- **Desync recovery:** hash mismatch triggers resync within 1 second.
- **Host migration:** resume play within 2 seconds with authoritative resync.
- **Security:** reject stale/out-of-match packets; rate limit input bursts.

### 8-Player Target Constraints (NEW)
- **Host uplink:** Keep total outgoing snapshots under ~6-7 Mbps; reduce rate/LOD if exceeded.
- **Snapshot pacing:** Local board 30Hz, opponents 20Hz, spectators 10Hz (adaptive).
- **Queue protection:** If send queue > 2 snapshots, drop older snapshots and keep latest only.

### Test & Validation Harness (NEW)
- **Network simulation:** latency/loss/jitter profiles (20/50/100/200ms, 1-5% loss).
- **Soak tests:** 10-30 minute sessions with 4-8 players.
- **Regression tests:** input buffering, garbage sync, match end + rematch.

### Quadra Networking Model to Mirror (from `/quadra`)
- **Full state download on join** (Packet_download + Packet_gameserver) only when syncpoint is safe and all canvases are idle. (`quadra/source/net_server.cc`, `quadra/source/packets.h`)
- **Syncpoints for phase alignment** using server state packets (Packet_serverstate) polled by clients. (`quadra/source/net_list.cc`)
- **Bit-packed input stream** via Packet_moves/Packet_clientmoves to reduce bandwidth. (`quadra/source/packets.h`, `quadra/source/packets.cc`)
- **Server seed updates** between syncpoints (Packet_serverrandom). (`quadra/source/packets.h`)
- **Reliable gameplay transport, UDP discovery only** (TCP for packets, UDP for LAN). (`quadra/source/net.cc`)
- **Packet logging for replay/debug** (Packet_serverlog + recording). (`quadra/source/net_server.cc`, `quadra/source/recording.h`)

**Quadra → Serenity (Spacewar P2P) Mapping:**
| Quadra | Serenity Blocks (Steam P2P) |
|--------|-----------------------------|
| `Packet_download` | `GAME_STATE_RESYNC` (reliable full snapshot) |
| `Packet_serverstate` | `GAME_SYNCPOINT` (phase gating) |
| `Packet_moves` | `GAME_INPUT_BATCH` (tick-based input stream) |
| `Packet_serverrandom` | `LOBBY_MATCH_CONFIG` / match seed |
| TCP gameplay packets | Steam P2P reliable channel |
| UDP LAN discovery | Steam Lobby discovery |

---

## 🎯 Unified Roadmap (Phases 1-8)

### Completed (Phases 1-3) ✅
- Three-column online layout with Phaser main board + Canvas opponent boards.
- Match results modal + game over flow.
- Scoreboard, scoreboard overlay, Battle Log, QoS HUD.
- Input buffering + local prediction for peers.
- Garbage sync + local garbage prediction.

### Phase 1: Core Online Gameplay (HIGH) - Complete
**Goal:** Deliver the baseline online gameplay loop (rendering, input routing, sync, garbage, scoreboard).

#### 1.1 Board Rendering Strategy (Three-Column Layout)
- See **Board Layout Specification** and **Board Rendering Strategy** in Detailed Specifications for layout, renderer roles, and requirements.

#### 1.2 Connect Input Handlers

**Task:** Route local player inputs to network
**Location:** `src/core/game-modes/OnlineMultiplayerMode.js`

**Input Flow:**
```
Local Keyboard → Phaser Scene → OnlineMultiplayerMode → Network Message
                                         ↓
                              Send GAME_INPUT_* to Host
                                         ↓
                              Host validates & processes
                                         ↓
                              Host broadcasts state update
                                         ↓
                              All peers render new state
```

**Requirements:**
- [ ] Set up Phaser keyboard listeners for local player
- [ ] Intercept move/rotate/drop inputs
- [ ] Send `GAME_INPUT_BATCH` (or `GAME_INPUT_*`) with tick + sequence
- [ ] Implement local input prediction (optional, improves feel)
- [ ] Block inputs when dead or game paused
- [ ] Implement DAS (Delayed Auto-Shift) handling locally

#### 1.3 Implement State Synchronization

**Task:** Update visuals from network state
**Location:** `src/core/game-modes/OnlineMultiplayerMode.js`

**Sync Flow (30Hz from Host):**
```javascript
// In OnlineMultiplayerMode
handleStateUpdate(state) {
    // Update all player boards
    for (const playerState of state.players) {
        this.boardRenderer.updateFromState(playerState);
    }

    // Update scoreboard
    this.updateScoreboard(state.players);

    // Update local stats bar
    this.updateLocalStats(state.players.find(p => p.id === this.localPlayerId));

    // Check for game events
    this.processGameEvents(state);
}
```

**Requirements:**
- [ ] Subscribe to `GAME_STATE_FULL` messages
- [ ] Handle `GAME_STATE_RESYNC` on join/reconnect
- [ ] Update each player's board from state
- [ ] Update scoreboard rankings
- [ ] Update local player stats bar
- [ ] Drop stale snapshots by `seq`/`tick` (per-channel ordering)
- [ ] Handle `GAME_PLAYER_DIED` → show death overlay
- [ ] Handle `GAME_GARBAGE_SENT` → flash board, show attack
- [ ] Handle `GAME_MATCH_END` → transition to results

#### 1.4 Integrate Garbage System

**Task:** Connect existing garbage system to network
**Reuse:** `GarbageQueue` from `src/core/garbage.js`

**Requirements:**
- [ ] Host: Calculate garbage from line clears
- [ ] Host: Route garbage to all opponents (FFA)
- [ ] Host: Broadcast `GAME_GARBAGE_SENT` events
- [ ] Peers: Update local garbage queue from events
- [ ] Peers: Show garbage indicator on board
- [ ] Peers: Apply garbage on piece lock (host authoritative)

#### 1.5 Implement Scoreboard & Kill Feed

**Task:** Create right panel components
**Location:** `src/ui/online-scoreboard.js`, `src/ui/online-kill-feed.js`

**Scoreboard Requirements:**
- [ ] Show goal (e.g., "First to 10 frags")
- [ ] List all players sorted by frags
- [ ] Show frag count, score, status (alive/dead)
- [ ] Highlight local player
- [ ] Medal icons for top 3 (🥇🥈🥉)
- [ ] Update in real-time from state

**Kill Feed Requirements:**
- [ ] Show last 10 events
- [ ] Event types: frag, lines sent, combo, death
- [ ] Color-coded by player color
- [ ] Slide-in animation for new events
- [ ] Auto-scroll to latest

---

### Phase 2: Match Results & Game Flow (HIGH)
**Priority:** 🟠 HIGH
**Goal:** Complete game loop with proper end screen

#### 2.1 Create Match Results Modal
```
Location: src/ui/match-results-modal.js (NEW)
```

**Requirements:**
- [ ] Final standings (1st, 2nd, 3rd, etc.)
- [ ] Player stats: Frags, Deaths, Score, Lines, APM
- [ ] Kill feed summary
- [ ] Winner announcement with celebration
- [ ] "Play Again" button (restart match)
- [ ] "Return to Lobby" button
- [ ] "Exit" button (back to main menu)

**Visual Design:**
```
┌──────────────────────────────────────────────┐
│           🏆 MATCH RESULTS 🏆                │
├──────────────────────────────────────────────┤
│  1st 🥇  PlayerA     5 frags   15000 pts    │
│  2nd 🥈  PlayerB     3 frags   12000 pts    │
│  3rd 🥉  PlayerC     2 frags    8000 pts    │
│  4th     PlayerD     1 frag     5000 pts    │
├──────────────────────────────────────────────┤
│  [Play Again]  [Return to Lobby]  [Exit]    │
└──────────────────────────────────────────────┘
```

#### 2.2 Implement Game Over Detection
```
Location: src/core/multiplayer/ffa-p2p-game-state.js
```

**Requirements:**
- [ ] Detect win condition met (frags/time/points/lines)
- [ ] Broadcast `GAME_MATCH_END` with results
- [ ] Stop game loop on match end
- [ ] Transition to results screen

#### 2.3 Implement Round Restart (Optional)
```
Location: src/core/multiplayer/ffa-p2p-game-state.js
```

**Requirements:**
- [ ] Reset all player boards
- [ ] Clear garbage queues
- [ ] Generate new shared seed
- [ ] Broadcast `GAME_ROUND_RESTART`
- [ ] 3-2-1 countdown before new round

---

### Phase 3: Gameplay Polish (MEDIUM)
**Priority:** 🟡 MEDIUM
**Goal:** Smooth, responsive multiplayer experience

#### 3.1 Implement Kill Feed UI
```
Location: src/ui/kill-feed.js (NEW or enhance existing)
```

**Requirements:**
- [ ] Show recent kills (last 5-10)
- [ ] Format: "PlayerA ⚔️ PlayerB"
- [ ] Fade out after 5 seconds
- [ ] Position: Top-right corner
- [ ] Color-coded by player colors

#### 3.2 Implement Garbage Queue Visual
```
Location: Board rendering component
```

**Requirements:**
- [ ] Show incoming garbage count on left side
- [ ] Color-coded by attacker
- [ ] Warning flash when garbage about to drop
- [ ] Counter animation on attack sent

#### 3.3 Implement Death/Respawn Animation
```
Location: Board rendering component
```

**Requirements:**
- [ ] Board shake/flash on death
- [ ] "DEAD" overlay on player's board
- [ ] Grey out dead player boards
- [ ] Show killer attribution

#### 3.4 Implement Scoreboard Overlay
```
Location: src/ui/multiplayer-scoreboard.js (NEW)
```

**Requirements:**
- [ ] Toggle with TAB key
- [ ] Show all players: Frags, Score, Status
- [ ] Sort by frags descending
- [ ] Highlight local player
- [ ] Update in real-time

#### 3.5 Add Network QoS HUD
```
Location: src/ui/network-qos.js (NEW)
```

**Requirements:**
- [ ] Display RTT, packet loss, relay/direct status
- [ ] Show warning when snapshot drops exceed threshold
- [ ] Toggle via settings or small HUD icon

---

### Phase 4: Protocol & Sync Hardening (HIGH)
**Goal:** Make transport safe, ordered, and resync-capable.  
**Primary files:** `src/core/steam/steam-networking.js`, `src/core/network/message-types.js`, `src/core/multiplayer/ffa-p2p-game-state.js`

**Requirements:**
- [ ] Add message envelope fields: `matchId`, `matchNonce`, `hostSteamId`, `seq`, `tick`, `sentAt`, `protocolVersion`.
- [ ] Use 64-bit `matchNonce` + `hostSteamId` binding; reject packets with mismatched nonce/host.
- [ ] Separate reliable vs unreliable channels; use unreliable for `GAME_STATE_FULL`.
- [ ] Drop stale/out-of-order snapshots using per-peer `seq`.
- [ ] Implement `NET_HELLO/NET_WELCOME` handshake + feature flags.
- [ ] Add `GAME_STATE_RESYNC` and `GAME_SYNCPOINT` (safe join/resync).
- [ ] Add snapshot digest (hash) for desync detection + auto resync.
- [ ] Define resync chunking for large snapshots: reliable channel, 16 KB chunks (max 32 KB), window = 4 in-flight, 300 ms timeout, retry up to 5x, then fall back to spectator/rejoin.
- [ ] Add send-queue backpressure: per-peer queue cap = 2 snapshots, drop old snapshots and keep latest; throttle snapshot rate 30 → 20 → 10 Hz while queue exceeds cap, then restore.
- [ ] Enforce strict version negotiation: exact `protocolVersion` match or reject with `NET_ERROR`.

**Exit criteria:** Late-join/resync works at safe syncpoints with chunked resync + ack/retry; stale packets rejected; per-peer queues stay <= 2 snapshots and throttle under loss.

#### Phase 4.2: Binary Snapshot Encoding (MEDIUM)
- Add binary encoding for `GAME_STATE_FULL` (see **Binary Snapshot Encoding** in Detailed Specifications).
- Phase 4: Use JSON (simpler debugging).
- Phase 4.2: Add binary encoding as option.
- Phase 5+: Default to binary for `GAME_STATE_FULL`.

---

### Phase 5: Prediction, Reconciliation & Fair Play (HIGH)
**Goal:** Keep inputs responsive while preserving authoritative correctness.  
**Primary files:** `src/core/multiplayer/ffa-p2p-game-state.js`, `src/core/validation/input-validator.js`

**Requirements:**
- [ ] Add `GAME_INPUT_BATCH` with tick-based input queueing.
- [ ] Host sends input acks; clients reconcile or resim at syncpoints.
- [ ] Implement attack scaling (respect `boringRules` toggle).
- [ ] Add clock sync smoothing to improve timing-based validation.

**Exit criteria:** < 120ms feel at 150ms RTT; no visible desyncs in 10-minute soak.

---

### Phase 6: Robustness & UX (MEDIUM)
**Goal:** Graceful handling of disconnects, rejoin, and chat completeness.  
**Primary files:** `src/core/multiplayer/host-migration.js`, `src/ui/lobby-waiting-room.js`, `src/ui/online-chat.js`

**Requirements:**
- [ ] Heartbeat + disconnect detection with grace period.
- [ ] Reconnect flow + spectator fallback after grace expiry.
- [ ] Host migration handoff (freeze, elect, resync, resume).
- [ ] Lobby chat input + mute/rate-limit; add channels (all/team/spectator).

**Exit criteria:** Host migration resumes in < 2 seconds; reconnects restore state.

#### 6.1 Chat & Communication (MEDIUM)
**Goal:** Players can communicate during match

##### 6.1.1 Implement Chat UI in Waiting Room
```
Location: src/ui/lobby-waiting-room.js
```

**Requirements:**
- [ ] Chat input field
- [ ] Message display area (scrollable)
- [ ] System messages (player joined, ready, etc.)
- [ ] Player name + color prefix
- [ ] Enter to send

##### 6.1.2 Implement In-Game Chat
```
Location: src/ui/ingame-chat.js (NEW)
```

**Requirements:**
- [ ] Press Enter to open chat
- [ ] Semi-transparent overlay
- [ ] Recent messages visible
- [ ] Quick chat options (GG, Nice, etc.)
- [ ] Mute player option

#### 6.2 Robustness & Edge Cases (MEDIUM)
**Goal:** Handle disconnections and failures gracefully

##### 6.2.1 Implement Host Migration
```
Location: src/core/network/host-migration.js
```

**Requirements:**
- [ ] Detect host disconnect (heartbeat timeout)
- [ ] Elect new host (lowest Steam ID)
- [ ] Transfer game state authority
- [ ] New host sends authoritative `GAME_STATE_RESYNC` + retains `matchId`
- [ ] Notify all players
- [ ] Resume gameplay seamlessly

**Detection Mechanism:**
```
Every 2 seconds:
  Host sends HEARTBEAT to all peers
  Peers track last heartbeat time
  If no heartbeat for 6 seconds → host presumed dead
  Initiate migration protocol
```

##### 6.2.2 Implement Player Disconnect Handling
```
Location: src/core/multiplayer/ffa-p2p-game-state.js
```

**Requirements:**
- [ ] Detect peer disconnect (P2P channel closed)
- [ ] Grace period (10 seconds) for reconnection
- [ ] Mark player as "disconnected" (not dead)
- [ ] Handle reconnection during grace period
- [ ] Remove player after grace period expires

##### 6.2.3 Implement Reconnection Flow
```
Location: src/core/multiplayer/ffa-p2p-game-state.js
```

**Requirements:**
- [ ] Player can rejoin by Steam ID
- [ ] Download current game state
- [ ] Resume at last known position
- [ ] Stats preserved
- [ ] Host sends `GAME_STATE_RESYNC` at safe syncpoint before resuming

---

### Phase 7: Advanced Features (LOW)
- Spectator mode UX + watch controls.
- Team mode with team-based score/garbage routing.
- Replay logging + export; match history + stats.

#### 7.1 Survivor Mode (Quadra-Style)
- Round-based elimination
- All players respawn each round
- First team to X round wins

#### 7.2 Spectator Mode
- Join as spectator
- Watch all boards
- Switch between players
- Spectator chat

#### 7.3 Handicap System
- Skill-based starting level
- Configurable in match settings
- Helps balance new vs experienced players

#### 7.4 Recording & Replay
- Record all network messages
- Playback matches
- Share replays

#### 7.5 Statistics & Leaderboards
- Track lifetime stats
- Steam leaderboard integration
- Match history

---

### Phase 8: Infinity LMS (MEDIUM)
**Goal:** Online Infinity LMS (Last Man Standing) with row cap and Infinity UI feel.  
**Primary files:** `src/core/game-modes/OnlineMultiplayerMode.js`, `src/core/multiplayer/ffa-p2p-game-state.js`, `src/ui/match-config-modal.js`, `src/ui/lobby-waiting-room.js`, `src/ui/online-scoreboard.js`, `src/ui/infinity/InfinityMinimap.js`

**Requirements:**
- [ ] Add `mode: 'infinity-lms'` with `infinityRowCap` (100-1000, default 100) to match config + lobby metadata.
- [ ] Enable team mode for Infinity LMS (last team standing).
- [ ] Extend snapshots for Infinity fields (`isInfinityMode`, `maxRows`, `buildHeight`, `currentTopRow`) with LOD for opponents.
- [ ] Online Infinity UI: minimap for main player + distance-to-ceiling indicator; compact opponent height bars + minimaps.
- [ ] Win condition: last player or last team standing; handle simultaneous top-outs (draw or tie-break).
- [ ] Allow minimap exploration without pausing the match; keep Infinity camera smoothing and pacing.

**Exit criteria:** 2-8 player Infinity LMS matches complete with correct eliminations; row cap enforced; minimap/row cap UX matches Infinity feel; snapshot budget remains within limits.

---

## 📦 Detailed Specifications

## 🔄 Match State Machine (NEW - CRITICAL)

### Explicit State Diagram

```
                           ┌─────────────────┐
                           │   LOBBY_OPEN    │◄──────────────────────────────┐
                           │  (browsable,    │                               │
                           │   joinable)     │                               │
                           └────────┬────────┘                               │
                                    │ Host clicks "Lock Lobby"               │
                                    │ or all players ready                   │
                                    ▼                                        │
                           ┌─────────────────┐                               │
                           │  LOBBY_LOCKED   │                               │
                           │  (no new joins, │                               │
                           │   config final) │                               │
                           └────────┬────────┘                               │
                                    │ Host clicks "Start Match"              │
                                    ▼                                        │
                           ┌─────────────────┐                               │
                           │   COUNTDOWN     │                               │
                           │  (3-2-1-GO!,    │                               │
                           │   no inputs)    │                               │
                           └────────┬────────┘                               │
                                    │ Countdown complete                     │
                                    ▼                                        │
                           ┌─────────────────┐                               │
                           │    PLAYING      │◄────────────┐                 │
                           │  (game active,  │             │                 │
                           │   inputs valid) │             │ Round restart   │
                           └────────┬────────┘             │ (Survivor)      │
                                    │ Win condition met    │                 │
                                    ▼                      │                 │
                           ┌─────────────────┐             │                 │
                           │   POST_MATCH    │─────────────┘                 │
                           │  (results shown,│                               │
                           │   stats frozen) │                               │
                           └────────┬────────┘                               │
                                    │ Rematch vote or timeout                │
                                    ▼                                        │
                           ┌─────────────────┐                               │
                           │  REMATCH_VOTE   │───────────────────────────────┘
                           │  (voting period,│    Rematch declined
                           │   5s timeout)   │    or Return to Lobby
                           └────────┬────────┘
                                    │ Majority accepts
                                    ▼
                              Back to COUNTDOWN
```

### State Transition Rules

| Current State | Trigger | Next State | Allowed Actions |
|---------------|---------|------------|-----------------|
| `LOBBY_OPEN` | All ready OR host locks | `LOBBY_LOCKED` | Join, leave, ready, chat, config |
| `LOBBY_LOCKED` | Host starts | `COUNTDOWN` | Leave, chat |
| `COUNTDOWN` | Timer = 0 | `PLAYING` | None (display only) |
| `PLAYING` | Win condition | `POST_MATCH` | Inputs, chat |
| `POST_MATCH` | 5s timeout OR rematch vote | `REMATCH_VOTE` | Chat, view stats |
| `REMATCH_VOTE` | Majority yes | `COUNTDOWN` | Vote, chat |
| `REMATCH_VOTE` | Majority no OR timeout | `LOBBY_OPEN` | Vote, chat |

### Implementation Location
```
src/core/network/match-flow.js (NEW FILE)
```

```javascript
// Match state machine
const MATCH_STATE = {
    LOBBY_OPEN: 'lobby_open',
    LOBBY_LOCKED: 'lobby_locked',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    POST_MATCH: 'post_match',
    REMATCH_VOTE: 'rematch_vote'
};

class MatchFlowManager {
    constructor() {
        this.state = MATCH_STATE.LOBBY_OPEN;
        this.matchId = null;
        this.nonce = null;
    }

    canTransition(fromState, toState) {
        const validTransitions = {
            [MATCH_STATE.LOBBY_OPEN]: [MATCH_STATE.LOBBY_LOCKED],
            [MATCH_STATE.LOBBY_LOCKED]: [MATCH_STATE.COUNTDOWN, MATCH_STATE.LOBBY_OPEN],
            [MATCH_STATE.COUNTDOWN]: [MATCH_STATE.PLAYING],
            [MATCH_STATE.PLAYING]: [MATCH_STATE.POST_MATCH],
            [MATCH_STATE.POST_MATCH]: [MATCH_STATE.REMATCH_VOTE],
            [MATCH_STATE.REMATCH_VOTE]: [MATCH_STATE.COUNTDOWN, MATCH_STATE.LOBBY_OPEN]
        };
        return validTransitions[fromState]?.includes(toState) ?? false;
    }

    transition(newState) {
        if (!this.canTransition(this.state, newState)) {
            console.warn(`Invalid transition: ${this.state} → ${newState}`);
            return false;
        }
        const oldState = this.state;
        this.state = newState;
        this.onStateChange(oldState, newState);
        return true;
    }
}
```

---

## 🚪 Late-Join & Spectator Rules (NEW)

### Decision Matrix

| Match State | Time Elapsed | Win Progress | Action |
|-------------|--------------|--------------|--------|
| `LOBBY_OPEN` | N/A | N/A | ✅ Full join |
| `LOBBY_LOCKED` | N/A | N/A | ❌ Wait for next match |
| `COUNTDOWN` | N/A | N/A | ✅ Full join (resync at countdown end) |
| `PLAYING` | < 30 seconds | < 25% of goal | ✅ Full resync join |
| `PLAYING` | 30s - 2min | 25-75% of goal | 👁️ Spectate only |
| `PLAYING` | > 2 minutes | > 75% of goal | 👁️ Spectate only |
| `POST_MATCH` | N/A | 100% | 📋 Queue for next match |

### Spectator Mode Features
- View any player's board
- Switch between players freely
- Spectator chat (separate channel or visible to all)
- Cannot interact with gameplay
- Auto-promote to player on next round (if slot available)

### Rejoin Rules (Disconnected Players)
| Disconnect Duration | Action |
|---------------------|--------|
| < 10 seconds | Seamless reconnect, resume play |
| 10-60 seconds | Reconnect with full resync, keep stats |
| > 60 seconds | Treated as leave, stats preserved but marked "disconnected" |

---

## 🎮 Client-Side Prediction (NEW - CRITICAL)

### Why This is Essential
Without prediction, inputs feel delayed by **1-2 frames (33-66ms)** minimum, plus network RTT. Modern players expect near-instant response.

### Prediction Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT-SIDE PREDICTION FLOW                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LOCAL INPUT ──► PREDICT LOCALLY ──► SEND TO HOST ──► RENDER PREDICTION    │
│       │                                     │                                │
│       │                                     ▼                                │
│       │                              HOST VALIDATES                          │
│       │                                     │                                │
│       │                                     ▼                                │
│       │                           HOST BROADCASTS STATE                      │
│       ▼                                     ▼                                │
│  RECEIVE AUTHORITATIVE STATE ──────────► RECONCILE                          │
│                                              │                               │
│                                              ▼                               │
│                               ┌──────────────┴──────────────┐               │
│                               │                             │                │
│                               ▼                             ▼                │
│                         PREDICTION                    PREDICTION             │
│                          CORRECT                       WRONG                 │
│                              │                             │                 │
│                              ▼                             ▼                 │
│                        SMOOTH CONTINUE              SNAP TO SERVER           │
│                                                    (or interpolate)          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation

```javascript
// src/core/network/client-prediction.js (NEW FILE)

class ClientPrediction {
    constructor() {
        this.pendingInputs = [];      // Inputs sent but not yet confirmed
        this.localTick = 0;           // Client's predicted tick
        this.lastConfirmedTick = 0;   // Last tick confirmed by server
        this.localState = null;       // Predicted local board state
    }

    /**
     * Apply input locally IMMEDIATELY for responsive feel
     */
    handleLocalInput(input) {
        // 1. Apply optimistically to local state
        this.localState = this._applyInput(this.localState, input);
        
        // 2. Store for later reconciliation
        this.pendingInputs.push({
            tick: this.localTick,
            input: input,
            predictedState: this._cloneState(this.localState)
        });
        
        // 3. Send to host
        this.networkManager.send('GAME_INPUT_BATCH', {
            playerId: this.localPlayerId,
            tick: this.localTick,
            inputs: [input]
        });
        
        this.localTick++;
    }

    /**
     * Reconcile when server state arrives
     */
    reconcileWithServer(serverState) {
        const serverTick = serverState.tick;
        
        // Remove confirmed inputs
        this.pendingInputs = this.pendingInputs.filter(
            pending => pending.tick > serverTick
        );
        
        // Get server's version of our state
        const myServerState = serverState.players.find(
            p => p.id === this.localPlayerId
        );
        
        if (!myServerState) return;
        
        // Compare prediction vs reality
        const lastConfirmedPrediction = this.pendingInputs.length > 0 
            ? this.pendingInputs[0].predictedState 
            : this.localState;
            
        if (this._statesDiffer(lastConfirmedPrediction, myServerState)) {
            // Prediction was wrong - snap to server state
            console.log('Prediction mismatch, snapping to server');
            this.localState = this._cloneState(myServerState);
            
            // Re-apply pending inputs
            for (const pending of this.pendingInputs) {
                this.localState = this._applyInput(this.localState, pending.input);
            }
        }
        
        this.lastConfirmedTick = serverTick;
    }

    _applyInput(state, input) {
        // Apply move/rotate/drop to board state
        // Returns new state
    }

    _statesDiffer(a, b) {
        // Compare piece position, grid, etc.
        return a.currentPiece?.x !== b.currentPiece?.x ||
               a.currentPiece?.y !== b.currentPiece?.y ||
               a.currentPiece?.rotation !== b.currentPiece?.rotation;
    }

    _cloneState(state) {
        return JSON.parse(JSON.stringify(state));
    }
}
```

### Key Parameters
| Parameter | Value | Notes |
|-----------|-------|-------|
| Max pending inputs | 10 | Drop oldest if exceeded (lag compensation) |
| Reconciliation threshold | 2 ticks | Allow small drift before snapping |
| Interpolation speed | 0.3 | Blend factor for smooth corrections |

---

## ⚔️ Attack Scaling / Fair Attack Rules (NEW)

### Problem
In 5+ player FFA, a single tetris (4 lines) sends garbage to ALL opponents. Without scaling, games become chaotic instant-death scenarios.

### Quadra's Solution ("Boring Rules" toggle)
From `quadra/source/net_list.cc` lines 160-203:
- When `boring_rules = false`: Attack damage scales inversely with opponent count
- Formula approximation: `effective_lines = sent_lines / max(1, num_opponents / 2)`

### Serenity Blocks Implementation

```javascript
// Attack scaling formula
function calculateScaledGarbage(baseLinesCleared, numOpponents, fairScalingEnabled) {
    if (!fairScalingEnabled) {
        // "Boring rules" - no scaling
        return baseLinesCleared;
    }
    
    // Fair scaling: reduce damage with more players
    // 2 players: full damage (divisor = 1)
    // 4 players: 66% damage (divisor = 1.5)
    // 6 players: 50% damage (divisor = 2)
    // 8 players: 40% damage (divisor = 2.5)
    const scalingDivisor = Math.max(1, (numOpponents + 1) / 2);
    return Math.ceil(baseLinesCleared / scalingDivisor);
}
```

### Match Config UI Addition

The following settings should be added to `match-config-modal.js` to match Quadra's configuration options:

```javascript
// Add to match-config-modal.js - Quadra-compatible settings

// Fair Attack Scaling (Quadra's "Boring Rules" inverted)
{
    id: 'fairAttackScaling',
    label: 'Fair Attack Scaling',
    type: 'toggle',
    default: true,
    help: 'Reduce garbage damage with many players (prevents instant death in 5+ player games)'
}

// Starting Level (Quadra: 1-9)
{
    id: 'startingLevel',
    label: 'Starting Level',
    type: 'select',
    options: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    default: 1,
    help: 'Initial difficulty level (affects piece fall speed)'
}

// Level Progression (Quadra: every 15 lines)
{
    id: 'levelProgression',
    label: 'Level Progression',
    type: 'toggle',
    default: false,
    help: 'If enabled, level increases every 15 lines cleared'
}

// Handicap System (Quadra: skill balancing)
{
    id: 'allowHandicap',
    label: 'Allow Handicaps',
    type: 'toggle',
    default: true,
    help: 'Let players set skill handicap to balance gameplay (0-4 levels)'
}
```

### Scaling Table
| Players | Opponents | Scaling Factor | 4-Line Tetris Sends |
|---------|-----------|----------------|---------------------|
| 2 | 1 | 1.0x | 4 lines each |
| 3 | 2 | 0.75x | 3 lines each |
| 4 | 3 | 0.66x | 3 lines each |
| 5 | 4 | 0.60x | 2-3 lines each |
| 6 | 5 | 0.50x | 2 lines each |
| 7 | 6 | 0.43x | 2 lines each |
| 8 | 7 | 0.40x | 1-2 lines each |

---

## 👥 Team Mode (NEW - Optional Game Mode)

Team-based multiplayer where players are assigned to teams and attacks only target opponents on other teams.

### Game Mode Selection

```javascript
// Match config option
{
    id: 'gameMode',
    label: 'Game Mode',
    type: 'select',
    options: [
        { value: 'ffa', label: 'Free-For-All' },
        { value: 'teams', label: 'Team Battle' }
    ],
    default: 'ffa',
    help: 'FFA: every player for themselves. Teams: coordinated team play.'
}

// Team configuration (only shown when gameMode === 'teams')
{
    id: 'teamCount',
    label: 'Number of Teams',
    type: 'select',
    options: [2, 3, 4],
    default: 2,
    help: 'How many teams to divide players into'
}

{
    id: 'teamAssignment',
    label: 'Team Assignment',
    type: 'select',
    options: [
        { value: 'manual', label: 'Manual Selection' },
        { value: 'auto', label: 'Auto-Balance' },
        { value: 'random', label: 'Random' }
    ],
    default: 'manual',
    help: 'How players are assigned to teams'
}
```

### Team Colors (Quadra-Style)

| Team | Primary Color | Border Color |
|------|---------------|--------------|
| Team 1 (Red) | `#ef4444` | `#dc2626` |
| Team 2 (Blue) | `#3b82f6` | `#2563eb` |
| Team 3 (Green) | `#22c55e` | `#16a34a` |
| Team 4 (Yellow) | `#eab308` | `#ca8a04` |

### Attack Targeting Rules

```javascript
/**
 * Calculate attack targets based on game mode
 */
function getAttackTargets(attackerId, allPlayers, gameMode) {
    if (gameMode === 'ffa') {
        // FFA: attack everyone except self
        return allPlayers
            .filter(p => p.id !== attackerId && p.isAlive)
            .map(p => p.id);
    } else {
        // Team mode: attack only opponents on other teams
        const attacker = allPlayers.find(p => p.id === attackerId);
        return allPlayers
            .filter(p => p.id !== attackerId && 
                         p.isAlive && 
                         p.team !== attacker.team)
            .map(p => p.id);
    }
}
```

### Team Win Conditions

| Win Condition | FFA Behavior | Team Behavior |
|--------------|--------------|---------------|
| **Frags** | First player to X frags | First team to X total team frags |
| **Points** | First player to X points | First team to X combined points |
| **Lines** | First player to X lines | First team to X combined lines |
| **Time** | Highest scoring player | Highest scoring team (sum) |
| **Last Standing** | Last player alive | Last team with alive player(s) |

### Network Messages for Teams

```javascript
// Player data includes team assignment
LOBBY_PLAYER_JOINED: {
    playerId: string,
    name: string,
    steamId: string,
    team: number | null    // null = unassigned, 0-3 = team index
}

// Team assignment change
LOBBY_TEAM_CHANGE: {
    playerId: string,
    oldTeam: number | null,
    newTeam: number | null
}

// Auto-balance teams (host only)
LOBBY_TEAM_BALANCE: {
    assignments: [{ playerId: string, team: number }]
}

// Enhanced state includes team info
GAME_STATE_FULL: {
    players: [{
        id: string,
        team: number | null,    // Team index
        // ... other fields
    }],
    teamScores: {
        0: { frags: 0, points: 0, lines: 0, alive: 2 },
        1: { frags: 0, points: 0, lines: 0, alive: 2 },
        // ... up to 4 teams
    },
    // ... other fields
}
```

### UI Changes for Team Mode

#### Waiting Room
- Show team picker next to each player's name
- Auto-balance button (host only)
- Team roster preview

#### In-Game Layout
```
┌──────────────────────────────────────────────────────────────────────────┐
│                      TEAM BATTLE MODE LAYOUT                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────┐   ┌─────────────────────┐   ┌─────────────────────────┐ │
│  │  YOUR TEAM  │   │                     │   │  TEAM SCOREBOARD        │ │
│  │  (allies)   │   │    YOUR BOARD       │   │  ─────────────────────  │ │
│  │ ┌────┐      │   │      (BIG)          │   │  🔵 Blue Team: 5 frags  │ │
│  │ │Ally│      │   │                     │   │  🔴 Red Team:  3 frags  │ │
│  │ └────┘      │   │                     │   ├─────────────────────────┤ │
│  ├─────────────┤   │                     │   │  KILL FEED              │ │
│  │  OPPONENTS  │   │                     │   │  Blue1 ⚔️ Red2          │ │
│  │  (enemies)  │   │                     │   │  Red1 sends 4 lines     │ │
│  │ ┌────┐┌────┐│   │                     │   ├─────────────────────────┤ │
│  │ │Opp1││Opp2││   │                     │   │  TEAM CHAT + ALL CHAT   │ │
│  │ └────┘└────┘│   │                     │   │  [Team] [All] [Type...] │ │
│  └─────────────┘   └─────────────────────┘   └─────────────────────────┘ │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Left Panel Changes
- Split into "Your Team" (allies, no attacks received from them)
- And "Opponents" (enemies, their attacks target you)
- Ally boards have a friendly border color
- Enemy boards have a highlighted border (red/danger)

#### Chat Channels
```javascript
CHAT_MESSAGE: {
    // ... existing fields
    channel: 'all' | 'team',   // NEW: which channel
    teamIndex: number | null   // NEW: sender's team for filtering
}
```

### Implementation Checklist for Team Mode

- [ ] Add `gameMode` toggle to match config (FFA / Teams)
- [ ] Add `teamCount` and `teamAssignment` options
- [ ] Add team picker UI in waiting room
- [ ] Implement auto-balance algorithm
- [ ] Modify attack routing to respect team membership
- [ ] Add team-based win condition calculations
- [ ] Create team scoreboard in right panel
- [ ] Add team chat channel toggle
- [ ] Visual indicators for allies vs opponents
- [ ] Include team info in network state sync

### Priority

| Priority | Notes |
|----------|-------|
| 🟡 MEDIUM | Not blocking for MVP, but required for full Quadra parity |
| Phase 3+ | Implement after core FFA is working |

---

## Infinity LMS (NEW - Online Mode)

Infinity LMS brings the tall-board Infinity experience to online play: last player (or last team) standing wins. Uses a configurable "Infinity Row Cap" (100-1000 rows; default 100).

### Lobby + Match Config
- Add `mode: 'infinity-lms'` to online match config (host only).
- Show `Infinity Row Cap` input (100-1000, default 100) and hide standard win condition + level progression fields.
- Allow team mode selection; Infinity LMS uses last team standing when teams are enabled.
- Lobby browser + waiting room display mode + row cap (e.g., "Infinity LMS - Cap 200").
- Row cap locks on lobby lock/start; reconnect within grace window restores player, otherwise join as spectator.

### UI Layout (Online Infinity)
```
+----------------------------------------------------------------------------+
|                    INFINITY LMS ONLINE LAYOUT                              |
+----------------------------------------------------------------------------+
|  +-------------+   +-----------------------+   +-------------------------+ |
|  | Opponents   |   |     YOUR BOARD        |   |  SCOREBOARD / INFO      | |
|  | mini boards |   |     (tall)            |   |  - Survivors            | |
|  | height bars |   |                       |   |  - Row Cap              | |
|  +-------------+   |  [Minimap]            |   |  Battle Log + Chat      | |
|                    +-----------------------+   +-------------------------+ |
+----------------------------------------------------------------------------+
```
- Right panel adds an Infinity panel with row cap, survivors, distance to ceiling, and the main minimap.
- Opponent cards show mini boards + height bars + compact opponent minimaps.
- Keep the 3-column layout; prioritize vertical space for the main board.

### Minimap (Main Player)
- Reuse `src/ui/infinity/InfinityMinimap.js` with online settings.
- Show row cap marker + danger zone (last 10 rows) + viewport indicator.
- Allow minimap exploration; do not pause the match. Exploration temporarily detaches camera follow and restores it on exit.
- Update from `currentTopRow` + `visibleRows` (camera) and `buildHeight`.
- Opponent minimaps are passive (no exploration) and show height to cap.

### Gameplay Feel (Infinity)
- Preserve Infinity camera smoothing and slow-burn pacing.
- Keep attack scaling on by default for 5+ players; clamp garbage bursts near the cap.
- Add danger cues when within 10 rows of cap; clear elimination banner + survivor count updates.

### Network + State (Tall Grid)
- Extend match config + snapshots with `isInfinityLMS`, `infinityRowCap`, `buildHeight`, `currentTopRow`, and `infinityStats`.
- LOD to protect bandwidth:
  - Local player: full grid (authoritative/predicted).
  - Opponents: top 24 rows + column height map + current piece (drives compact minimaps).
  - Spectators: same as opponents, lower update rate (10Hz).
- Height map payload: 10 columns with uint16 row indices (0-1000) + optional `topRow` for viewport.
- Reuse `infinity-grid.js` helpers for top-out checks + height calculation.

### Win Condition
- Last player standing (or last team standing when team mode is enabled).
- Simultaneous top-outs: declare draw or tie-break by distance to cap, then time survived.

### Implementation Checklist
- [ ] Add Infinity LMS option + row cap to `src/ui/match-config-modal.js` + lobby metadata.
- [ ] Update `src/ui/lobby-browser.js` + `src/ui/lobby-waiting-room.js` to display mode + row cap.
- [ ] Extend `src/core/game-modes/OnlineMultiplayerMode.js` for Infinity layout + main player minimap.
- [ ] Update `src/core/multiplayer/ffa-p2p-game-state.js` for tall-grid init + last-standing logic.
- [ ] Add Infinity HUD/scoreboard elements (survivors + distance to ceiling) in `src/ui/online-scoreboard.js`.
- [ ] Add compact opponent minimaps to player cards (height-map driven).
- [ ] Add tall-grid LOD (height map / top rows) to snapshot encoding.
- [ ] Ensure team-mode flow uses last team standing + team survivor counts in Infinity LMS.

---

## 📦 Binary Snapshot Encoding (NEW - Phase 4.2)

### Problem
JSON snapshots at 30Hz for 8 players = **~4-8KB per snapshot**, potentially hitting bandwidth limits.

### Quadra's Approach
From `packets.h` lines 427-449:
- Grid: `uint8_t can[32][10]` = 320 bytes per player
- Piece queue: 4 bytes
- Bonus/garbage: 20 entries × 5 bytes = 100 bytes
- Total: ~450 bytes per player vs ~1-2KB JSON

### Serenity Blocks Binary Format

```javascript
// src/core/network/binary-encoding.js (NEW FILE)

/**
 * Binary snapshot format per player:
 * - Grid: 10 cols × 24 rows × 4 bits = 120 bytes (2 cells per byte)
 * - Current piece: 4 bytes (type, x, y, rotation)
 * - Next pieces: 3 bytes (3 piece types)
 * - Stats: 16 bytes (score, lines, level, frags as uint32)
 * - Status: 2 bytes (isAlive, garbageQueue)
 * - Total: ~145 bytes per player vs ~1500 bytes JSON
 */

const CELL_COLORS = ['empty', 'I', 'O', 'T', 'S', 'Z', 'J', 'L', 'garbage'];
// 4 bits = 16 values, plenty for 9 cell types

class BinaryEncoder {
    encodeGrid(grid) {
        // 10×24 grid, 2 cells per byte (4 bits each)
        const buffer = new ArrayBuffer(120);
        const view = new Uint8Array(buffer);
        
        let byteIndex = 0;
        for (let y = 0; y < 24; y++) {
            for (let x = 0; x < 10; x += 2) {
                const cell1 = CELL_COLORS.indexOf(grid[y][x]?.type || 'empty');
                const cell2 = CELL_COLORS.indexOf(grid[y][x+1]?.type || 'empty');
                view[byteIndex++] = (cell1 << 4) | cell2;
            }
        }
        return buffer;
    }

    decodeGrid(buffer) {
        const view = new Uint8Array(buffer);
        const grid = [];
        
        let byteIndex = 0;
        for (let y = 0; y < 24; y++) {
            grid[y] = [];
            for (let x = 0; x < 10; x += 2) {
                const byte = view[byteIndex++];
                const cell1 = (byte >> 4) & 0x0F;
                const cell2 = byte & 0x0F;
                grid[y][x] = cell1 > 0 ? { type: CELL_COLORS[cell1] } : null;
                grid[y][x+1] = cell2 > 0 ? { type: CELL_COLORS[cell2] } : null;
            }
        }
        return grid;
    }

    encodePlayerState(player) {
        const buffer = new ArrayBuffer(145);
        const view = new DataView(buffer);
        let offset = 0;

        // Grid (120 bytes)
        const gridData = new Uint8Array(this.encodeGrid(player.grid));
        new Uint8Array(buffer, 0, 120).set(gridData);
        offset += 120;

        // Current piece (4 bytes)
        view.setUint8(offset++, this._pieceTypeToInt(player.currentPiece?.type));
        view.setUint8(offset++, player.currentPiece?.x ?? 0);
        view.setUint8(offset++, player.currentPiece?.y ?? 0);
        view.setUint8(offset++, player.currentPiece?.rotation ?? 0);

        // Next pieces (3 bytes)
        for (let i = 0; i < 3; i++) {
            view.setUint8(offset++, this._pieceTypeToInt(player.nextPieces?.[i]));
        }

        // Stats (16 bytes)
        view.setUint32(offset, player.score, true); offset += 4;
        view.setUint32(offset, player.lines, true); offset += 4;
        view.setUint32(offset, player.level, true); offset += 4;
        view.setUint32(offset, player.frags, true); offset += 4;

        // Status (2 bytes)
        view.setUint8(offset++, player.isAlive ? 1 : 0);
        view.setUint8(offset++, player.garbageQueue);

        return buffer;
    }
}
```

### Bandwidth Comparison
| Format | Per Player | 8 Players | 30Hz Rate |
|--------|------------|-----------|-----------|
| JSON | ~1500 bytes | ~12KB | 360 KB/s |
| Binary | ~145 bytes | ~1.2KB | 36 KB/s |
| **Savings** | **90%** | **90%** | **90%** |

**8-player note:** At 30Hz the host may exceed 6 Mbps total outgoing; plan to drop to 20Hz or reduce LOD for opponents/spectators when needed.

### Implementation Priority
- Phase 4: Use JSON (simpler debugging)
- Phase 4.2: Add binary encoding as option
- Phase 5+: Default to binary for GAME_STATE_FULL

---

## 🔒 Syncpoint States (NEW - Quadra Model)

### Quadra's Syncpoint Mechanic
From `net_list.cc` lines 360-371:
1. Server broadcasts `P_SERVERSTATE` at safe moments (all canvases idle)
2. Clients poll every 5 frames
3. **Downloads only happen when `syncpoint == Canvas::LAST`**

### Serenity Blocks Syncpoint States

```javascript
// Explicit syncpoint states
const SYNCPOINT = {
    IDLE: 0,        // Normal gameplay, safe state
    BUSY: 1,        // Mid-piece movement, animations running
    WAITING: 2,     // Waiting for all boards to settle
    DOWNLOAD: 3,    // Safe to send full state (for join/resync)
    RESPAWN: 4      // Survivor mode respawn window
};

// Host broadcasts GAME_SYNCPOINT when state changes
{
    msgType: 'GAME_SYNCPOINT',
    syncpoint: SYNCPOINT.IDLE,
    tick: number,
    reason: 'piece_locked' | 'all_idle' | 'round_end' | 'force'
}
```

### Join/Resync Flow with Syncpoints
```
1. Player requests join
2. Host checks current syncpoint
3. IF syncpoint == IDLE or DOWNLOAD:
   a. Send LOBBY_MATCH_CONFIG
   b. Send GAME_STATE_RESYNC in reliable chunks (16 KB, max 32 KB) with
      `resyncId`, `index`, `count`, `byteOffset`, `crc32` (window = 4 in-flight)
   c. Client acks each chunk; host retries missing chunks (300 ms timeout, 5x max)
   d. Client sends RESYNC_ACK after all chunks are applied
   e. Host broadcasts GAME_SYNCPOINT to advance phase
4. ELSE:
   a. Queue join request
   b. Wait for next IDLE syncpoint
   c. Then proceed with step 3
```

---

## 💓 Heartbeat & Disconnect Detection (NEW)

### Message Format

```javascript
// Host → All peers, every 2 seconds (channel 0, reliable)
NET_HEARTBEAT: {
    matchId: string,
    hostTick: number,
    playerCount: number,
    serverTime: number      // For clock sync
}

// Peer → Host response (optional, for RTT measurement)
NET_HEARTBEAT_ACK: {
    nonce: number,
    receivedAt: number
}
```

### Timeout Rules
| Condition | Threshold | Action |
|-----------|-----------|--------|
| No heartbeat received | 6 seconds | Mark host as unresponsive |
| Host unresponsive | 8 seconds | Initiate host migration |
| Peer stops sending inputs | 10 seconds | Mark as "disconnected" |
| Peer grace period expired | 60 seconds | Remove from match |

### Host Migration Trigger
```javascript
class DisconnectDetector {
    constructor() {
        this.lastHostHeartbeat = Date.now();
        this.HEARTBEAT_TIMEOUT = 6000;  // 6 seconds
        this.MIGRATION_TIMEOUT = 8000;  // 8 seconds
    }

    checkHostStatus() {
        const elapsed = Date.now() - this.lastHostHeartbeat;
        
        if (elapsed > this.MIGRATION_TIMEOUT) {
            this.initiateHostMigration();
        } else if (elapsed > this.HEARTBEAT_TIMEOUT) {
            this.showHostUnresponsiveWarning();
        }
    }

    initiateHostMigration() {
        // 1. Elect new host (lowest Steam ID among connected peers)
        // 2. New host broadcasts GAME_STATE_RESYNC
        // 3. New host resumes heartbeat
        // 4. matchId preserved for continuity
    }
}
```

---

## ⚠️ Error Messages (NEW)

### NET_ERROR Message Type

```javascript
// Error response for invalid requests
NET_ERROR: {
    code: string,           // Error code
    message: string,        // Human-readable message
    originalMsgType: string, // What triggered the error
    originalSeq: number      // Sequence number of original message
}

// Error codes
const NET_ERROR_CODES = {
    INVALID_MATCH_ID: 'Match ID does not exist or has expired',
    PROTOCOL_MISMATCH: 'Client and host protocol versions incompatible',
    RATE_LIMITED: 'Too many requests, slow down',
    NOT_HOST: 'Only the host can perform this action',
    INVALID_STATE: 'Action not allowed in current match state',
    PLAYER_NOT_FOUND: 'Player ID not found in match',
    MATCH_FULL: 'Match has reached maximum player count',
    MATCH_LOCKED: 'Match is locked, cannot join',
    INVALID_INPUT: 'Input validation failed',
    STALE_PACKET: 'Packet sequence too old, dropping'
};
```

---

## 📼 Passive Replay Logging (NEW - Enable Now, UI Later)

### Concept
Log all significant network events during matches. Replay UI can be built later, but logging infrastructure should be in place by Phase 7 (optionally lightweight logging in Phase 4).

### What to Log

```javascript
class ReplayLogger {
    constructor(matchId) {
        this.matchId = matchId;
        this.log = [];
        this.enabled = true;  // Always on for debugging
    }

    logEvent(event) {
        if (!this.enabled) return;
        
        this.log.push({
            tick: this.currentTick,
            timestamp: Date.now(),
            type: event.type,
            data: event.data
        });
    }

    // Events to log:
    // - GAME_INPUT_BATCH (all player inputs)
    // - GAME_PIECE_LOCK (piece placements)
    // - GAME_GARBAGE_SENT (attacks)
    // - GAME_PLAYER_DIED (deaths/frags)
    // - GAME_MATCH_END (final results)
    // - Chat messages

    export() {
        return {
            matchId: this.matchId,
            recordedAt: new Date().toISOString(),
            events: this.log
        };
    }
}
```

### Storage
- Store in localStorage for debugging (last 5 matches)
- Optional: Upload to server for stat tracking
- Future: Load and playback with scrubbing UI

---

## 🎨 Board Layout Specification (Quadra-Inspired)

### Reference: Quadra Layout System
Looking at the actual Quadra screenshot - the layout is a **THREE-COLUMN** design:
- **LEFT:** Opponent watch panel (fixed 2x2 grid, max 4; selection controls for extra opponents)
- **CENTER:** Your main board (BIG, full size)
- **RIGHT:** Scoreboard + Kill feed/Chat

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ QUADRA ACTUAL LAYOUT (from screenshot)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐  ┌───────────────────────┐  ┌─────────────────────────────┐│
│  │  OPPONENTS  │  │                       │  │  Goal (frags): 15           ││
│  │  (watch 2x2)│  │                       │  ├─────────────────────────────┤│
│  │ ┌───┐ ┌───┐ │  │                       │  │  faulk           15         ││
│  │ │ 1 │ │ 2 │ │  │                       │  │  SewAtec          5         ││
│  │ │zoo│ │ozze│ │  │    YOUR BOARD        │  │  ozze             1         ││
│  │ └───┘ └───┘ │  │      (BIG)            │  │  [wiki]Henke      1         ││
│  │ ┌───┐ ┌───┐ │  │                       │  │  junior           1         ││
│  │ │ 3 │ │ 4 │ │  │   [niku]Henke         │  │  zoopork          0         ││
│  │ │   │ │   │ │  │                       │  ├─────────────────────────────┤│
│  │ └───┘ └───┘ │  │                       │  │  KILL FEED / CHAT           ││
│  │             │  │   Score: 150315       │  │  zoopork sends 6 lines      ││
│  │             │  │   Lines: 25           │  │  faulk sends 17             ││
│  │             │  │   Frags: 5            │  │  faulk fragged zoopork!     ││
│  │             │  │   Deaths: 2           │  │  ozze sends 3 lines         ││
│  │             │  │                       │  │  faulk fragged SewAtec      ││
│  └─────────────┘  └───────────────────────┘  └─────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Serenity Blocks Online Layout Design

#### Screen Layout: Three-Column System (Quadra-Style)
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  SERENITY BLOCKS ONLINE MULTIPLAYER LAYOUT                                        │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌────────────────┐  ┌─────────────────────────────┐  ┌────────────────────────┐ │
│  │   OPPONENTS    │  │                             │  │      SCOREBOARD        │ │
│  │  (watch 2x2)   │  │                             │  │  Goal: First to 10     │ │
│  │ [Auto Watch]   │  │                             │  │  ───────────────────── │ │
│  │  Watching: 4/4 │  │                             │  │  🥇 Player1    5 frags │ │
│  │  [Select ▼]    │  │                             │  │  🥈 Player2    3 frags │ │
│  │                │  │                             │  │  🥉 Player3    2 frags │ │
│  │  ┌────┐ ┌────┐ │  │      YOUR BOARD             │  │     Player4    1 frag  │ │
│  │  │ P2 │ │ P3 │ │  │        (BIG)                │  │     YOU        0 frags │ │
│  │  │    │ │    │ │  │                             │  ├────────────────────────┤ │
│  │  └────┘ └────┘ │  │                             │  │      KILL FEED         │ │
│  │  ┌────┐ ┌────┐ │  │                             │  │  Player1 ⚔️ Player4    │ │
│  │  │ P4 │ │ P5 │ │  │                             │  │  Player2 sends 4 lines │ │
│  │  │    │ │    │ │  │                             │  │  Player1 ⚔️ Player3    │ │
│  │  └────┘ └────┘ │  │   Score: 15000              │  ├────────────────────────┤ │
│  │                │  │   Lines: 25                 │  │      CHAT              │ │
│  │                │  │   Level: 5                  │  │  [Player1]: gg         │ │
│  │                │  │   Frags: 3                  │  │  [Player2]: nice!      │ │
│  │                │  │   Deaths: 1                 │  │  ─────────────────────  │ │
│  │                │  │                             │  │  [Type message...] [>] │ │
│  │                │  │   ┌────┐ ┌────┐ ┌────┐     │  │                        │ │
│  │                │  │   │Next│ │Next│ │Next│     │  │                        │ │
│  │                │  │   └────┘ └────┘ └────┘     │  │                        │ │
│  └────────────────┘  └─────────────────────────────┘  └────────────────────────┘ │
│                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### Three-Column CSS Layout
```css
/* Main three-column layout */
.online-game-area {
    display: grid;
    grid-template-columns: 200px 1fr 280px;  /* Opponents | Main Board | Right Panel */
    gap: 16px;
    height: 100vh;
    padding: 16px;
}

/* Left column: Opponent watch panel */
.opponents-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.watch-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.watch-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);  /* 2x2 grid, max 4 */
    grid-auto-rows: minmax(120px, 1fr);
    gap: 8px;
}

/* Center column: Your big board */
.main-board-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

/* Right column: Scoreboard + Kill Feed + Chat */
.right-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
```

#### Opponent Watch System (Quadra-Style)

**Key Features:**

| Feature | Description |
|---------|-------------|
| **Max 4 Visible** | Fixed 2x2 grid showing only 4 opponent boards |
| **Player Selection** | Click player names to tag/untag for watching |
| **Sliding Window** | When 5th selected, oldest is automatically removed |
| **Auto Watch** | Button to auto-select 4 opponents (alive > dead priority) |
| **Swap on Click** | Click mini board or unwatched player name to swap |

**Visual Layout:**
```
┌─────────────────────────────────────────┐
│  [Auto Watch]  Watching: 4/4  [Select ▼] │  ← Controls
├─────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐               │
│  │ Player2 │  │ Player3 │               │  ← 2x2 Grid
│  │  ┌───┐  │  │  ┌───┐  │               │    (max 4)
│  │  │   │  │  │  │   │  │               │
│  │  └───┘  │  │  └───┘  │               │
│  └─────────┘  └─────────┘               │
│  ┌─────────┐  ┌─────────┐               │
│  │ Player4 │  │ Player5 │               │
│  │  ┌───┐  │  │  ┌───┐  │               │
│  │  │   │  │  │  │   │  │               │
│  │  └───┘  │  │  └───┘  │               │
│  └─────────┘  └─────────┘               │
├─────────────────────────────────────────┤
│  Not watching: Player6, Player7         │  ← Click to swap
└─────────────────────────────────────────┘
```

**Behavior:**
- **2-4 opponents:** All visible, no selection needed
- **5-8 opponents:** Only 4 visible, user selects which 4
- **Auto Watch:** Prioritizes alive players over dead ones
- **Click interactions:** Unwatched name swaps with oldest watched; mini board opens swap menu

**Implementation:**
```javascript
// Watch state management
class OpponentWatchManager {
    constructor() {
        this.watchedPlayers = [];  // Max 4 player IDs
        this.autoWatch = false;
    }

    // Tag/untag a player for watching (sliding window when full)
    toggleWatch(playerId) {
        const index = this.watchedPlayers.indexOf(playerId);
        if (index >= 0) {
            // Already watching - remove
            this.watchedPlayers.splice(index, 1);
        } else {
            // Not watching - add (with sliding window)
            if (this.watchedPlayers.length >= 4) {
                this.watchedPlayers.shift();  // Remove oldest
            }
            this.watchedPlayers.push(playerId);
        }
        this.updateDisplay();
    }

    // Swap in an unwatched player (mini board or unwatched list click)
    swapIn(playerId) {
        if (this.watchedPlayers.includes(playerId)) {
            return;
        }
        if (this.watchedPlayers.length >= 4) {
            this.watchedPlayers.shift();  // Remove oldest
        }
        this.watchedPlayers.push(playerId);
        this.updateDisplay();
    }

    // Auto-select 4 opponents (prioritize alive players)
    autoSelectOpponents(allOpponents) {
        const alive = allOpponents.filter(p => p.isAlive);
        const dead = allOpponents.filter(p => !p.isAlive);
        this.watchedPlayers = [...alive, ...dead].slice(0, 4).map(p => p.id);
        this.updateDisplay();
    }
}
```

**UI Controls:**
- **Auto Watch Button**: Auto-selects 4 opponents (alive > dead)
- **Watching Counter**: Shows current watched count (e.g., 4/4)
- **Player Dropdown/List**: Click to tag/untag; selecting a 5th swaps out the oldest
- **Unwatched List**: Click a name to swap with the oldest watched
- **Mini Board Click**: Opens a swap menu for quick replacement

#### Opponent Board Layout
| Total Players | Opponents | Watched | Layout | Mini Board Size |
|---------------|-----------|---------|--------|-----------------|
| 2             | 1         | 1       | 1x1    | 180px wide      |
| 3             | 2         | 2       | 2x1    | 90px wide       |
| 4             | 3         | 3       | 2x2    | 90px wide       |
| 5             | 4         | 4       | 2x2    | 90px wide       |
| 6-8           | 5-7       | **4**   | 2x2    | 90px wide       |

**Note:** For 5+ opponents (6+ players), only 4 are shown. Player selects which 4.

#### Main Board (Center Panel)
| Viewport | Block Size | Board Width | Board Height |
|----------|------------|-------------|--------------|
| Large    | 32-36px    | 320-360px   | 640-720px    |
| Medium   | 28-32px    | 280-320px   | 560-640px    |
| Small    | 24-28px    | 240-280px   | 480-560px    |

**Main board is ALWAYS full size** - only opponent boards shrink with more players.

---

## 🔄 Reusable Components from Local Multiplayer

### Components to Reuse Directly

| Component | Location | Reuse Strategy |
|-----------|----------|----------------|
| `MultiPlayerCanvasLayout` | `src/ui/multi-player-canvas-layout.js` | Adapt for network state updates |
| `GarbageQueue` | `src/core/garbage.js` | Already compatible with FFA P2P |
| `CanvasBoardEffects` | `src/ui/effects/canvas-board-effects.js` | Use for opponent board visuals |
| `MULTIPLAYER_EVENTS` | `src/events/multiplayer-events.js` | Extend for network events |
| Physics callbacks | Pattern from LocalMultiplayer | Same interface for network |

### Garbage System Integration

**Existing Implementation in Local Multiplayer:**
```javascript
// Attack Types (Quadra-compatible)
ATTACK_TYPES = {
    LINES: 'lines',        // Standard garbage rows
    CLEAN: 'clean',        // Strategic hole placement
    BLIND: 'blind',        // Partial screen obscure
    FULL_BLIND: 'full_blind',
    POTATO: 'potato'       // Random holes
}

// Hole Encoding (10-bit bitfield)
// Column 0 = bit 9, Column 9 = bit 0
// Where piece touched → holes in opponent's garbage
```

**Network Integration Requirements:**
```javascript
// Host calculates garbage from cascade summary
// Host broadcasts GAME_GARBAGE_SENT to all peers
// Each peer updates their local GarbageQueue
// On piece lock, peers insert pending garbage

// Message: GAME_GARBAGE_SENT
{
    from: playerId,           // Attacker
    targets: [playerIds],     // All opponents (FFA)
    amount: number,           // Lines sent
    holes: number,            // Bitfield encoding
    color: string,            // Attacker's color
    attackId: uuid            // For dedup
}
```

### Input Handling Adaptation

**Local Multiplayer Pattern:**
- Phaser scenes handle keyboard independently
- Each player has separate Phaser game instance
- Physics callbacks trigger game state updates

**Online Multiplayer Adaptation:**
```javascript
// Local player only:
// 1. Capture Phaser keyboard events
// 2. Batch inputs per tick and send via GAME_INPUT_BATCH (or GAME_INPUT_* events)
// 3. Host validates and processes
// 4. Host broadcasts state update
// 5. All peers render from state

// For remote players:
// - No local input handling
// - Render from network state only
// - Board is "view-only" (Canvas, not Phaser)
```

### Board Rendering Strategy (Three-Column Layout)

**⚠️ ONLINE LAYOUT IS DIFFERENT FROM LOCAL:**
- **Local Multiplayer:** All boards equal size, all Phaser instances
- **Online Multiplayer:** YOUR board BIG (center), opponents SMALL (left)

**Three-Column Rendering:**

| Column | Content | Renderer | Size |
|--------|---------|----------|------|
| **LEFT** | Opponent mini boards | Canvas2D | 80x192px each |
| **CENTER** | Your main board | Phaser | 320x768px |
| **RIGHT** | Scoreboard, Kill Feed, Chat | DOM | 280px wide |

**Main Board (Phaser):**
- Full `BoardScene` with all effects
- Keyboard input handlers attached
- Sends inputs to host via network
- Full-size rendering (32px blocks)

**Opponent Mini Boards (Canvas):**
- Lightweight Canvas2D rendering
- View-only (no input handling)
- State updated from `GAME_STATE_FULL`
- Small blocks (8px) for compact display
- Basic effects (death overlay, color flash)

**Why Hybrid Approach:**
- Main board needs full Phaser for input + effects
- Opponent boards need to be small and swappable (max 4 visible, up to 7 selectable)
- Canvas is much lighter than several Phaser instances
- Matches Quadra's approach (big main board, small watchers)

**Example: Opponent Board Renderer**
```javascript
// Mini board: 10x24 grid, small block size
const MINI_BLOCK_SIZE = 8;  // Small blocks for mini boards
canvas.width = 10 * MINI_BLOCK_SIZE;
canvas.height = 24 * MINI_BLOCK_SIZE;

this.opponentCanvases.set(opponent.id, {
    canvas, ctx,
    blockSize: MINI_BLOCK_SIZE
});

// Update opponent board from network state
_renderOpponentBoard(opponentId, state) {
    const { ctx, blockSize } = this.opponentCanvases.get(opponentId);

    // Clear canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw locked blocks
    state.grid.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell) {
                ctx.fillStyle = cell.color;
                ctx.fillRect(x * blockSize, y * blockSize, blockSize - 1, blockSize - 1);
            }
        });
    });

    // Draw current piece
    if (state.currentPiece) {
        const renderPiece = this._getPieceRenderData(state.currentPiece);
        const cells = state.currentPiece.cells || renderPiece.cells;
        const color = state.currentPiece.color || renderPiece.color;
        ctx.fillStyle = color;
        cells.forEach(([px, py]) => {
            const x = state.currentPiece.x + px;
            const y = state.currentPiece.y + py;
            ctx.fillRect(x * blockSize, y * blockSize, blockSize - 1, blockSize - 1);
        });
    }

    // Draw death overlay if dead
    if (!state.isAlive) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#ff4444';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('DEAD', ctx.canvas.width / 2, ctx.canvas.height / 2);
    }
}
```

**Key Differences from Local Multiplayer:**
| Aspect | Local Multiplayer | Online Multiplayer |
|--------|-------------------|-------------------|
| Layout | Equal-sized grid | 3-column (opp \| main \| info) |
| Main board | One of many Phaser instances | Single Phaser instance (center) |
| Other boards | All Phaser instances | Canvas renderers (lightweight) |
| Input handling | Each local player | Only main board |
| State source | Local MultiPlayerState | Network sync from host |

**Requirements:**
- [ ] Create ONE Phaser instance for main board (center)
- [ ] Create Canvas renderers for opponent mini boards (left)
- [ ] Main board has full input handling (move, rotate, drop)
- [ ] Opponent boards are view-only (rendered from network state)
- [ ] Reuse `BoardScene` class for main board
- [ ] Reuse `CanvasBoardEffects` patterns for opponent boards

---

## 💬 Chat & Kill Feed Specification

### Kill Feed Component

**Location:** Right panel, above chat
**Capacity:** Last 10 events, auto-scroll

**Event Types:**
```javascript
KILL_FEED_EVENTS = {
    FRAG: '{killer} ⚔️ {victim}',
    LINES_SENT: '{player} sends {count} lines',
    COMBO: '{player} {count}x COMBO!',
    DEATH: '{player} topped out',
    JOIN: '{player} joined the match',
    LEAVE: '{player} left the match',
    DISCONNECT: '{player} disconnected'
}
```

**Visual Style:**
```css
.kill-feed-entry {
    padding: 4px 8px;
    margin: 2px 0;
    border-radius: 4px;
    font-size: 12px;
    animation: slideIn 0.3s ease;
}

.kill-feed-entry.frag {
    background: rgba(255, 100, 100, 0.3);
    border-left: 3px solid var(--killer-color);
}

.kill-feed-entry.lines {
    background: rgba(100, 200, 255, 0.3);
    border-left: 3px solid var(--player-color);
}
```

### Chat System

#### 📡 Cross-Phase Chat Support (All Phases)

Chat is available in **ALL match states** for all connected clients including spectators:

| Match State | Players Can Chat | Spectators Can Chat | Chat Visibility |
|-------------|-----------------|---------------------|-----------------|
| `LOBBY_OPEN` | ✅ Yes | N/A (no spectators yet) | All in lobby |
| `LOBBY_LOCKED` | ✅ Yes | N/A | All in lobby |
| `COUNTDOWN` | ✅ Yes | ✅ Yes | All connected |
| `PLAYING` | ✅ Yes | ✅ Yes | All connected |
| `POST_MATCH` | ✅ Yes | ✅ Yes | All connected |
| `REMATCH_VOTE` | ✅ Yes | ✅ Yes | All connected |

#### Waiting Room Chat (LOBBY_OPEN, LOBBY_LOCKED)
- Input field at bottom of chat panel
- Messages appear in scrollable area
- System messages for join/leave/ready
- Player name colored by assigned color

#### In-Game Chat (COUNTDOWN, PLAYING)
- Press Enter to open chat input
- Semi-transparent overlay (doesn't pause game)
- Recent 5 messages always visible
- Quick chat buttons: "GG", "Nice!", "Rematch?"

#### Post-Match Chat (POST_MATCH, REMATCH_VOTE)
- Full chat access continues
- Good for discussing the match
- "Rematch?" quick chat especially useful

#### Spectator Chat
- Spectators can chat at any point after joining
- Messages visible to all (players + other spectators)
- Spectator names marked with 👁️ icon
- Option: separate spectator channel (future enhancement)

#### Chat Message Types
```javascript
CHAT_MESSAGE: {
    playerId: string,
    playerName: string,
    message: string,
    timestamp: number,
    type: 'chat' | 'system' | 'quick' | 'spectator',
    isSpectator: boolean  // NEW: marks spectator messages
}
```

#### System Messages (Automated)
| Event | System Message |
|-------|----------------|
| Player joins | "{name} joined the lobby" |
| Player leaves | "{name} left" |
| Player ready | "{name} is ready" |
| Match starts | "Match starting in 3..." |
| Player dies | "{name} topped out!" |
| Match ends | "{winner} wins!" |
| Spectator joins | "👁️ {name} is spectating" |
| Host migration | "🔄 {name} is now the host" |

---

## 🎮 Gameplay Integration Checklist

### From Local Multiplayer to Online

| Feature | Local Implementation | Online Adaptation |
|---------|---------------------|-------------------|
| Board rendering | Phaser per player | Phaser (local) + Canvas (remote) |
| Input handling | Direct Phaser | Send to host → validate → broadcast |
| Garbage attacks | Direct queue update | Host routes → broadcast → local queue |
| Line clears | Local physics | Host validates → broadcast event |
| Death/frag | Local detection | Host detects → broadcast FRAG event |
| Score tracking | Local state | Host authoritative → sync to peers |
| Win condition | Local check | Host checks → broadcast MATCH_END |

### Network State Sync Structure

```javascript
// GAME_STATE_FULL (Host → All, 30Hz)
{
    timestamp: number,
    seq: number,                 // Monotonic snapshot id (drop stale)
    tick: number,                // Server simulation tick
    players: [{
        id: string,
        name: string,
        color: string,

        // Board state
        grid: number[][],          // 10x24 (includes hidden rows)
        currentPiece: {
            type: string,
            x: number,
            y: number,
            rotation: number,
            color: string,         // Optional if derived from type
            cells: number[][]      // Optional if derived from type+rotation
        },
        nextPieces: string[3],     // Next 3 pieces

        // Stats
        score: number,
        lines: number,
        level: number,
        frags: number,
        deaths: number,

        // Status
        isAlive: boolean,
        garbageQueue: number,      // Pending lines count
        lastAttackerId: string     // For kill attribution
    }],

    // Match state
    matchTime: number,
    phase: 'countdown' | 'playing' | 'finished'
}
```

**Note:** If you want smaller snapshots, omit `cells`/`color` and derive them from `type + rotation` on the client.

### Join/Resync Flow (Quadra-Style Download)
1. **Safe join gate:** Host only accepts join/resync when match is at a safe syncpoint (not mid-tick).
2. **Send config first:** Host sends match config + seed + phase to the joining client.
3. **Full snapshot download:** Host sends chunked `GAME_STATE_RESYNC` (16 KB chunks, window = 4, 300 ms timeout, 5 retries).
4. **Client ack:** Client acks each chunk, applies snapshot, then sends final `RESYNC_ACK`.
5. **Syncpoint advance:** Host broadcasts `GAME_SYNCPOINT` to move everyone into the next phase.

### Packet Budget + Encoding Strategy (Spacewar P2P)
- **Snapshot target:** <= ~4 KB total per 8-player snapshot at 30Hz.
- **Encoding:** Use binary snapshots for grids (4-bit color indices or RLE); keep control messages JSON.
- **Inputs:** Batch per tick; keep payloads tiny and frequent.
- **Compression:** Avoid per-message compression; rely on compact formats + Steam transport.


---

## 🔧 Technical Implementation Details

### 🐛 CRITICAL BUG TO FIX FIRST

**Location:** `src/core/steam/steam-networking.js`

**Issue:** Duplicate `on()` method definition (lines 325 AND 532)
- Line 325: Single handler version
- Line 532: Array-based handler version (correct for mock mode)

**Fix Required:**
```javascript
// Remove the single-handler version at line 325
// Keep ONLY the array-based version at line 532:
on(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
        this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType).push(handler);
}
```

---

### Mock Mode Testing (Browser - No Steam Required)

**How Mock Mode Works:**
- Uses `BroadcastChannel` API for cross-tab P2P communication
- Uses `localStorage` for lobby persistence (auto-cleanup after 1 hour)
- Auto-activates when: not in Electron OR greenworks unavailable

**Setup for Mock Mode Testing:**
```bash
# Option 1: Just run in browser (auto-detects mock mode)
npm run dev
# Open http://localhost:PORT in browser

# Option 2: Force mock mode via environment variable
MOCK_STEAM=true npm run dev
```

**Testing Steps:**
1. Open **Tab 1** (Host):
   - Click "Online MP"
   - Click "Create New Match"
   - Configure settings → "Create Lobby"
   - See waiting room with your player

2. Open **Tab 2** (Peer):
   - Click "Online MP"
   - Click "Refresh" to see Tab 1's lobby
   - Click "Join" on the lobby
   - See both players in waiting room

3. Both tabs:
   - Click "Ready Up" (non-host)
   - Host clicks "Start Match"
   - Should see countdown, then game boards

**Debug localStorage:**
```javascript
// In browser console:
JSON.parse(localStorage.getItem('serenity_mock_lobbies'))
```

---

### Steam Spacewar Testing (Real P2P)

```bash
# 1. Create steam_appid.txt in project root
echo "480" > steam_appid.txt

# 2. Ensure Steam is running

# 3. Start in Electron mode (NOT browser)
npm run electron

# 4. Verify Steam connection in console:
# "🎮 Steam Config:"
# "AppID: 480 (Spacewar - Testing)"
# "Mock Mode: false"
# "✅ Steam initialized: YourName (steamid)"
```

**Testing with Real Steam:**
- Lobbies are visible in Steam overlay
- Friends can join directly from Steam
- Full P2P networking through Steam relay servers

### Steam P2P Transport Envelope + Channels (Spacewar Best Practice)

**Envelope (wrap all gameplay messages):**
```javascript
{
    msgType: string,
    matchId: string,
    matchNonce: string, // 64-bit per match (hex or base64)
    hostSteamId: string,
    seq: number,       // Per-channel sequence for ordering
    tick: number,      // Server tick for inputs/snapshots
    sentAt: number,    // Epoch ms (debug/RTT)
    payload: object
}
```

**Channel/Delivery Strategy (Greenworks P2P):**
| Channel | Delivery | Use |
|---------|----------|-----|
| 0 | Reliable | Lobby, match config, start/end, chat, results |
| 1 | UnreliableNoDelay | 30Hz snapshots (`GAME_STATE_FULL`) |
| 2 | Unreliable | Ping/telemetry, typing indicators |

**Rules:**
- Drop stale snapshots by `seq` and/or `tick`
- Always ack join/resync snapshots on a reliable channel
- Keep per-channel last-seen `seq` to avoid out-of-order updates
- Reject packets with mismatched `matchNonce`, `hostSteamId`, or `protocolVersion`

### Message Protocol Reference (Target Schema)

Note: This is the target protocol schema; several fields are planned but not yet implemented.

```javascript
// Lobby Phase Messages
LOBBY_PLAYER_JOINED    { playerId, name, steamId }
LOBBY_PLAYER_LEFT      { playerId }
LOBBY_PLAYER_READY     { playerId, ready: boolean }
LOBBY_GAME_START       { seed, players[], config }
LOBBY_MATCH_CONFIG     { matchId, seed, config, phase }        // config includes mode + infinityRowCap
LOBBY_STATE            { matchId, state, locked, players[] }
LOBBY_LOCK             { matchId }                            // NEW
LOBBY_UNLOCK           { matchId }                            // NEW

// Gameplay Messages (Peer → Host)
GAME_INPUT_MOVE        { playerId, direction, timestamp }
GAME_INPUT_ROTATE      { playerId, direction, timestamp }
GAME_INPUT_DROP        { playerId, type: 'soft'|'hard', timestamp }
GAME_INPUT_BATCH       { playerId, tick, inputs[] }
GAME_STATE_RESYNC_ACK  { resyncId, chunkIndex, isFinal }

// Gameplay Messages (Host → All)
GAME_SYNCPOINT         { syncpoint, tick, reason }            // ENHANCED
GAME_STATE_FULL        { players[], tick, seq, timestamp }    // ENHANCED with tick/seq (Infinity LMS adds buildHeight/currentTopRow)
GAME_STATE_RESYNC      { resyncId, chunkIndex, chunkCount, byteOffset, crc32, data }  // Reliable chunked snapshot
GAME_PIECE_LOCK        { playerId, piece, position, lines[] }
GAME_GARBAGE_SENT      { from, targets[], amount, holes, color, attackId, scaled }  // ENHANCED
GAME_PLAYER_DIED       { playerId, killerId, method }
GAME_PLAYER_FRAG       { killerId, victimId }
GAME_MATCH_END         { winner, standings[], stats }
GAME_COUNTDOWN         { remaining }                          // NEW: 3-2-1-GO!

// Spectator Messages (NEW)
SPECTATOR_JOIN         { playerId, steamId, name }
SPECTATOR_LEAVE        { playerId }
SPECTATOR_STATE        { spectators[] }
SPECTATOR_WATCH        { spectatorId, watchingPlayerId }      // Which player to show

// Rematch Messages (NEW)
REMATCH_VOTE           { playerId, vote: boolean }
REMATCH_STATE          { votes: { [playerId]: boolean }, timeout: number }
REMATCH_RESULT         { accepted: boolean, nextAction: 'countdown' | 'lobby' }

// Transport/Health (ENHANCED)
NET_HELLO              { protocolVersion, featureFlags[], clientVersion }
NET_WELCOME            { protocolVersion, featureFlags[], matchId, matchNonce, hostSteamId, accepted, reason }
NET_PING               { nonce, sentAt }
NET_PONG               { nonce, receivedAt, sentAt }
NET_HEARTBEAT          { matchId, hostTick, playerCount, serverTime }    // NEW
NET_HEARTBEAT_ACK      { nonce, receivedAt }                              // NEW

// Error Handling (NEW)
NET_ERROR              { code, message, originalMsgType, originalSeq }

// Error codes: INVALID_MATCH_ID, PROTOCOL_MISMATCH, RATE_LIMITED, 
//              NOT_HOST, INVALID_STATE, PLAYER_NOT_FOUND, 
//              MATCH_FULL, MATCH_LOCKED, INVALID_INPUT, STALE_PACKET
```

### File Locations Reference

```
src/
├── core/
│   ├── game-modes/
│   │   ├── OnlineMultiplayerMode.js    ← Main orchestrator (COMPLETE)
│   │   └── LocalMultiplayerMode.js     ← Reference for reusable patterns
│   ├── steam/
│   │   └── steam-networking.js         ← P2P layer (COMPLETE; add envelope)
│   ├── multiplayer/
│   │   ├── ffa-p2p-game-state.js       ← Game state (COMPLETE; needs resync/reconcile)
│   │   ├── ffa-attack-router.js        ← Attack system (COMPLETE)
│   │   └── frag-tracker.js             ← Win conditions (COMPLETE)
│   ├── network/
│   │   ├── message-types.js            ← Message definitions (COMPLETE)
│   │   ├── input-validator.js          ← Anti-cheat (COMPLETE)
│   │   ├── host-migration.js           ← Failover (PARTIAL)
│   │   ├── match-flow.js               ← Match state machine (PLANNED)
│   │   ├── client-prediction.js        ← Reconciliation helpers (PLANNED)
│   │   ├── binary-encoding.js          ← Snapshot compression (PLANNED)
│   │   ├── replay-logger.js            ← Passive match logging (PLANNED)
│   │   └── disconnect-detector.js      ← Heartbeat + timeout handling (PLANNED)
│   ├── engine/
│   │   └── unified-game-loop.js        ← Game loop (COMPLETE)
│   └── garbage.js                      ← Quadra-compatible attacks (REUSE)
│
├── ui/
│   ├── lobby-browser.js                ← Browse lobbies (COMPLETE)
│   ├── lobby-waiting-room.js           ← Pre-match UI (PARTIAL - no chat input)
│   ├── match-config-modal.js           ← Match settings (COMPLETE; add advanced toggles)
│   ├── online-scoreboard.js            ← Right panel scoreboard (COMPLETE)
│   ├── online-kill-feed.js             ← Battle log feed (COMPLETE)
│   ├── online-chat.js                  ← Chat component (COMPLETE; add channels/moderation)
│   ├── match-results-modal.js          ← Results screen (COMPLETE)
│   ├── spectator-ui.js                 ← Spectator mode UI (PLANNED)
│   ├── multi-player-canvas-layout.js   ← Reference for board rendering (REUSE)
│   └── effects/
│       └── canvas-board-effects.js     ← Board effects (REUSE)
│
├── events/
│   └── multiplayer-events.js           ← Event bus (EXTEND)
│
public/
├── index.html                          ← Add online game container (MODIFY)
└── styles/
    ├── multiplayer-ui.css              ← Lobby styles (EXISTS)
    └── online-multiplayer.css          ← Game screen styles (OPTIONAL)
```

---

## 📦 Remaining Implementation Backlog

### Files to Create
| File | Purpose | Phase |
|------|---------|-------|
| `src/core/network/match-flow.js` | Match state machine + syncpoint gating | 4 |
| `src/core/network/protocol-envelope.js` | Envelope encode/decode + seq tracking | 4 |
| `src/core/network/snapshot-encoder.js` | Binary/delta snapshot encoding | 4 |
| `src/core/network/disconnect-detector.js` | Heartbeat tracking + reconnect | 6 |
| `src/core/network/replay-logger.js` | Passive replay logging | 7 |
| `src/ui/spectator-ui.js` | Spectator controls + watch UX | 7 |

### Files to Modify (Highest Impact)
| File | Focus | Phase |
|------|-------|-------|
| `src/core/steam/steam-networking.js` | Channelized send + seq drop + heartbeat hooks | 4/6 |
| `src/core/network/message-types.js` | Handshake, resync, input batch, syncpoint msgs | 4/5 |
| `src/core/multiplayer/ffa-p2p-game-state.js` | Input batching + reconciliation + resync + Infinity tall grid | 5/8 |
| `src/core/multiplayer/host-migration.js` | Freeze/elect/resync/resume | 6 |
| `src/core/multiplayer/ffa-attack-router.js` | Attack scaling toggle | 5 |
| `src/ui/lobby-waiting-room.js` | Lobby chat input + system messages | 6 |
| `src/ui/online-chat.js` | Channels + moderation | 6 |
| `src/ui/match-config-modal.js` | Infinity LMS mode + row cap | 8 |
| `src/core/game-modes/OnlineMultiplayerMode.js` | Infinity LMS layout + minimap wiring | 8 |
| `src/ui/online-scoreboard.js` | Survivors + distance to ceiling | 8 |
| `src/ui/infinity/InfinityMinimap.js` | Online mode tweaks (no pause + LOD) | 8 |
| `src/ui/lobby-browser.js` | Display Infinity LMS + row cap | 8 |

### Definition of Done (Network Robustness Release)
- [ ] Message envelope enforced (`matchId`, `matchNonce`, `hostSteamId`, `seq`, `tick`, `protocolVersion`) with stale-drop.
- [ ] Late join/resync works only at syncpoints with full snapshot.
- [ ] Input batch + reconciliation keeps local board aligned under jitter.
- [ ] Attack scaling toggle works and matches config.
- [ ] Heartbeat + disconnect + host migration resumes within 2 seconds.

### Testing Checklist (Updated)
- [ ] Mock mode: 2-8 tabs join, play, and rematch without desync.
- [ ] Simulated 100-200ms RTT and 1-3% loss: no frozen state, resync works.
- [ ] Host migration mid-round preserves state and Battle Log continuity.
- [ ] Reconnect within 10 seconds restores player state; after 60 seconds becomes spectator.
- [ ] Infinity LMS: row cap enforced (100-1000), minimap updates, last-standing logic stable at 2-8 players.

---

## 📝 Notes & Decisions

### Why JSON over Binary Packets?
- Easier debugging (readable in console)
- Sufficient performance for 30Hz sync
- Steam P2P handles compression
- Can optimize later if needed

### Why 30Hz Sync Rate?
- Balance between responsiveness and bandwidth
- Local prediction handles input latency
- Quadra used similar approach (original dial-up compatible)
- Can increase to 60Hz if needed

### Why Host-Authoritative?
- Single source of truth prevents desync
- Easier anti-cheat implementation
- Simpler state management
- Standard for competitive games

---

## 🔒 Security Considerations

### Anti-Cheat Measures (Implemented / Planned)

| Measure | Location | Status |
|---------|----------|--------|
| **Input Validation** | `src/core/validation/input-validator.js` | ✅ Complete |
| **Rate Limiting** | `src/core/validation/input-validator.js` | 🟡 Basic limits (per-input) |
| **Host-Authoritative Model** | Architecture-level | ✅ Enforced |

### Input Validation Rules

```javascript
// From existing input-validator.js
const VALIDATION_RULES = {
    maxMovesPerTick: 3,           // Prevent move spam
    maxDropsPerSecond: 5,         // Prevent drop spam  
    maxRotatesPerSecond: 10,      // Reasonable rotation limit
    minTickBetweenInputs: 16,     // ~60Hz input cap
    
    // Position validation
    validatePosition(x, y, boardWidth, boardHeight) {
        return x >= 0 && x < boardWidth && y >= 0 && y < boardHeight;
    },
    
    // Reject impossible moves
    rejectImpossibleMoves: true,  // e.g., moving through blocks
};
```

### Network Security

| Threat | Mitigation |
|--------|------------|
| **State spoofing** | Only host sends `GAME_STATE_FULL`; peers ignore state from non-host (implemented) |
| **Input replay** | Planned: tick-based inputs + seq drop (Phase 5) |
| **Match hijacking** | Planned: `matchId` + per-match `nonce` on all packets (Phase 4) |
| **Spam attacks** | Planned: per-peer rate limits + auto-drop (Phase 6) |
| **Protocol mismatch** | Planned: `NET_HELLO/NET_WELCOME` handshake (Phase 4) |

### Host Authority Enforcement

```javascript
// Only host can:
// - Broadcast GAME_STATE_FULL
// - Broadcast GAME_SYNCPOINT
// - Process and route garbage attacks
// - Determine frags/deaths
// - End the match

// Peers can only:
// - Send GAME_INPUT_* messages
// - Send chat messages
// - Request leave/rejoin
```

### Future Considerations
- Steam VAC integration (requires Valve approval)
- Server-side validation for ranked matches (requires dedicated servers)
- Replay verification for dispute resolution

---

## 🔗 References

- [Quadra Source Code](./quadra/) - Original implementation reference
- [FFA Multiplayer Plan](./docs/FFA_MULTIPLAYER_IMPLEMENTATION_PLAN.md)
- [Lobby System Docs](./docs/LOBBY_SYSTEM_IMPLEMENTATION.md)
- [Steam Networking API](https://partner.steamgames.com/doc/api/ISteamNetworkingSockets)

---

## 📋 Implementation Order (Remaining Work)

1. Phase 4: Protocol envelope + seq/tick + resync + syncpoints.
2. Phase 5: Input batching + reconciliation + attack scaling.
3. Phase 6: Heartbeat + reconnect + host migration + chat completeness.
4. Phase 7: Spectator + team mode + replay logging.
5. Phase 8: Infinity LMS mode + row cap + minimap + tall-grid LOD.

## 📊 Plan Status Snapshot

- Phases 1-3 are complete (see progress docs).
- Primary risk is network robustness (ordering, resync, migration).
- Next review after Phase 4 completion and soak tests.
- Phase 8 (Infinity LMS) scoped after Phase 7 completion.
