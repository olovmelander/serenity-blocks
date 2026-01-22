# Online Multiplayer Improvement Plan

**Date:** January 22, 2026
**Status:** 📋 Planning Complete
**Goal:** Fully functional Online FFA Multiplayer with Steam Spacewar testing support

---

## 📊 Current State Assessment

### What's Working (✅)
| Component | Status | Notes |
|-----------|--------|-------|
| Steam Networking Layer | 100% | Real Steam + Mock mode both functional |
| Lobby Browser UI | 100% | Browse, create, join lobbies |
| Waiting Room UI | 100% | Player list, ready states, host controls |
| Match Config Modal | 100% | Name, players, win condition |
| Game State Management | 95% | Player sync, attacks, frags |
| Attack/Garbage System | 100% | FFA routing, kill attribution |
| Win Conditions | 100% | Frags, Time, Points, Lines, Never |
| Anti-Cheat Validation | 100% | Rate limiting, input validation |
| Deterministic RNG | 100% | Seeded piece generation |

### What's Missing (❌)
| Component | Status | Impact |
|-----------|--------|--------|
| **Game Rendering** | 0% | CRITICAL - Can't play the game |
| Match Results Screen | 0% | HIGH - No end game feedback |
| Chat UI | 10% | MEDIUM - Infrastructure ready |
| Host Migration | 20% | MEDIUM - Framework only |
| Disconnect Handling | 0% | MEDIUM - No grace period |

### Development Progress: ~70% Complete

---

## 🎮 Comparison: Quadra vs Serenity Blocks

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
| **Join Sync + Full Download** | Server sends full canvas on join at safe syncpoint | 🔴 Add in Phase 1.4/5 (snapshot/resync) |
| **Syncpoints** | Server broadcasts state gates to align transitions | 🔴 Add match phase syncpoints |
| **Client-Side Prediction** | TCP acceptable in dial-up era, modern needs prediction | 🔴 Add in Phase 1.3 (CRITICAL for game feel) |
| **Move Compression** | Bit-packed input stream (P_MOVES) | 🔶 Batch inputs per tick |
| **Delta State Sync** | Only send changes | 🔶 Optimize later (30Hz acceptable) |
| **Attack Balancing** | Reduce damage with many players | 🔴 Add "Fair Attack Scaling" toggle to match config |
| **Binary Encoding** | Raw bytes for grid (320 bytes/player) | 🔶 Add in Phase 1.4 (reduces bandwidth 5-10x) |
| **Survivor Mode** | Round-based, respawn mechanics | 📋 Phase 5+ enhancement |
| **Recording/Replay** | Packet logging for replays | 🔴 Add passive logging now (Phase 1), replay UI later |
| **Handicap System** | Skill-based starting levels | 📋 Add to match config |

### Steam Spacewar P2P Architecture (Best Practice for Serenity Blocks)
- **Transport:** Steam lobbies for discovery + metadata; Steam P2P for gameplay (SDR-backed if available).
- **API choice:** Prefer SteamNetworkingSockets; if staying on `sendP2PPacket`, still use channels + reliability tiers.
- **Authority:** Host-authoritative simulation; clients send input only; host validates and broadcasts state.
- **Reliability tiers:** Reliable for lobby/config/start/end/chat; UnreliableNoDelay for 30Hz snapshots; separate channels per tier.
- **Message envelope:** Add `matchId`, `seq`, `tick`, `sentAt` to every packet; drop stale/out-of-order snapshots.
- **Join/resync:** Full snapshot on join at safe syncpoint; clients wait for snapshot ack before starting.
- **Health:** Ping/RTT tracking, packet loss counters, disconnect timeouts, host migration fallbacks.
- **Security:** Rate limit input, reject impossible moves, include per-match nonce to ignore stray packets.

### Additional Best Practices to Bake Into the Plan
- **Protocol versioning:** `NET_HELLO/NET_WELCOME` handshake with version + feature flags.
- **Lobby → match state machine:** Open → Locked → In-Match → Post-Match → Rematch, with late-join rules.
- **Packet budgets:** Binary snapshots for 30Hz; JSON only for control/config.
- **Host migration handoff:** New host sends authoritative snapshot + matchId continuity.
- **QoS UX:** Show RTT, loss, relay/direct, and throttling indicators.
- **Network test harness:** Simulate latency/loss/jitter for regression testing.

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
│       │                                     │                                │
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

## 📦 Binary Snapshot Encoding (NEW - Phase 1.4)

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

### Implementation Priority
- Phase 1: Use JSON (simpler debugging)
- Phase 1.4: Add binary encoding as option
- Phase 2+: Default to binary for GAME_STATE_FULL

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
   b. Send GAME_STATE_RESYNC (full snapshot for each player)
   c. Client acknowledges
   d. Host broadcasts GAME_SYNCPOINT to advance phase
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
Log all significant network events during matches. Replay UI can be built later, but logging infrastructure should be in place from Phase 1.

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
3. **Full snapshot download:** Host sends a full snapshot for each player (grid, piece queue, attacks, last attacker, stats).
4. **Client ack:** Client applies snapshot, then acknowledges readiness.
5. **Syncpoint advance:** Host broadcasts `GAME_SYNCPOINT` to move everyone into the next phase.

### Packet Budget + Encoding Strategy (Spacewar P2P)
- **Snapshot target:** <= ~4 KB total per 8-player snapshot at 30Hz.
- **Encoding:** Use binary snapshots for grids (4-bit color indices or RLE); keep control messages JSON.
- **Inputs:** Batch per tick; keep payloads tiny and frequent.
- **Compression:** Avoid per-message compression; rely on compact formats + Steam transport.

---

## 🎯 Improvement Phases

### Phase 1: Game Rendering Integration (CRITICAL)
**Priority:** 🔴 HIGHEST
**Goal:** Players can see and play the game after match starts

#### 1.0 Steam P2P Transport Layer (Spacewar Best Practice)
**Task:** Add reliability tiers + message envelope to the P2P layer  
**Location:** `src/core/steam/steam-networking.js`

**Requirements:**
- [ ] Add `sendReliable()` and `sendUnreliable()` helpers (channel + send type)
- [ ] Wrap all messages in the envelope (`matchId`, `seq`, `tick`, `sentAt`)
- [ ] Track last-seen `seq` per channel; drop stale snapshots
- [ ] Implement `NET_PING/NET_PONG` and expose RTT/packet loss
- [ ] Add host-only broadcast for unreliable snapshots
- [ ] Poll channels 0/1/2 in `startP2PPolling()`

#### 1.0a Protocol + Match Flow Hardening
**Task:** Versioned protocol handshake + lobby/match state machine  
**Location:** `src/core/network/message-types.js`, `src/core/network/match-flow.js` (new)

**Requirements:**
- [ ] `NET_HELLO/NET_WELCOME` handshake (protocolVersion + featureFlags)
- [ ] `matchId` + per-match nonce on all gameplay traffic
- [ ] Lobby state machine: Open → Locked → In-Match → Post-Match → Rematch
- [ ] Late-join rules (spectate vs resync) + rejoin gating
- [ ] Packet budget guardrails for snapshots vs control messages

#### 1.1 Create Online-Specific Three-Column Layout

**⚠️ KEY LAYOUT DIFFERENCE:**
- **Local Multiplayer:** Equal-sized boards in a grid (all players local)
- **Online Multiplayer:** YOUR board BIG in center, opponents SMALL on left (Quadra-style)

**New HTML Structure Needed (different from local multiplayer):**
```html
<!-- Add to public/index.html -->
<div id="online-multiplayer-container" class="online-game-area" style="display: none;">

    <!-- LEFT: Opponent Watch Panel (Max 4 visible, Quadra-style) -->
    <div class="opponents-panel">
        <!-- Watch Controls -->
        <div class="watch-controls">
            <button id="auto-watch-btn" class="watch-btn">Auto Watch</button>
            <div class="player-selector">
                <span>Watching: <span id="watch-count">0</span>/4</span>
                <button id="select-players-btn" class="watch-btn">Select ▼</button>
            </div>
        </div>

        <!-- Player Selection Dropdown (hidden by default) -->
        <div id="player-select-dropdown" class="player-dropdown" style="display: none;">
            <!-- Dynamically populated with all opponents -->
            <!-- Watched players highlighted, click to toggle -->
        </div>

        <!-- 2x2 Grid of Mini Boards (max 4) -->
        <div class="watch-grid">
            <div class="opponent-board" id="opponent-slot-0">
                <div class="opponent-header">
                    <span class="opponent-color"></span>
                    <span class="opponent-name">-</span>
                </div>
                <div class="opponent-canvas-container">
                    <canvas id="opponent-0-canvas"></canvas>
                </div>
                <div class="opponent-stats">
                    <span class="opponent-frags">0</span> frags
                </div>
            </div>
            <div class="opponent-board" id="opponent-slot-1">
                <!-- Same structure -->
            </div>
            <div class="opponent-board" id="opponent-slot-2">
                <!-- Same structure -->
            </div>
            <div class="opponent-board" id="opponent-slot-3">
                <!-- Same structure -->
            </div>
        </div>

        <!-- Unwatched Players List (when >4 opponents) -->
        <div class="unwatched-players" id="unwatched-list">
            <!-- Shows names of opponents not currently being watched -->
            <!-- Click to swap with a watched player -->
        </div>
    </div>

    <!-- CENTER: Your Big Board -->
    <div class="main-board-panel">
        <div class="main-board-header">
            <span class="your-name">YOU</span>
        </div>
        
        <!-- Next Pieces Section -->
        <div class="main-next-section">
            <div class="main-next-pieces">
                <canvas id="main-next-0" width="88" height="88"></canvas>
                <canvas id="main-next-1" width="76" height="76"></canvas>
                <canvas id="main-next-2" width="76" height="76"></canvas>
            </div>
        </div>
        
        <!-- Board Section with Garbage Indicator (MATCHING LOCAL MP) -->
        <div class="player-board-wrapper">
            <!-- Garbage Meter Bar (reuse local MP CSS) -->
            <div class="garbage-indicator" id="main-garbage-bar">
                <div class="garbage-fill"></div>
                <div class="garbage-glow"></div>
            </div>
            
            <!-- Phaser Board Container -->
            <div class="player-board-section">
                <div id="main-phaser-container" class="main-board-container"></div>
                <div class="board-border-overlay" id="main-border">
                    <div class="corner-bracket top-left"></div>
                    <div class="corner-bracket top-right"></div>
                    <div class="corner-bracket bottom-left"></div>
                    <div class="corner-bracket bottom-right"></div>
                </div>
            </div>
        </div>
        
        <!-- Stats Bar -->
        <div class="main-stats-bar player-stats-bar">
            <div class="stat-item stat-frags">
                <span class="stat-icon">⚔️</span>
                <span class="stat-label">Frags</span>
                <span class="stat-value" id="main-frags">0</span>
            </div>
            <div class="stat-item stat-deaths">
                <span class="stat-icon">💀</span>
                <span class="stat-label">Deaths</span>
                <span class="stat-value" id="main-deaths">0</span>
            </div>
            <div class="stat-item stat-score">
                <span class="stat-icon">🏆</span>
                <span class="stat-label">Score</span>
                <span class="stat-value" id="main-score">0</span>
            </div>
            <div class="stat-item stat-lines">
                <span class="stat-icon">📊</span>
                <span class="stat-label">Lines</span>
                <span class="stat-value" id="main-lines">0</span>
            </div>
            <div class="stat-item stat-level">
                <span class="stat-icon">⬆️</span>
                <span class="stat-label">Level</span>
                <span class="stat-value" id="main-level">1</span>
            </div>
            <div class="stat-item stat-garbage">
                <span class="stat-icon">💥</span>
                <span class="stat-label">Incoming</span>
                <span class="stat-value" id="main-garbage-value">0</span>
            </div>
        </div>
    </div>

    <!-- RIGHT: Scoreboard + Kill Feed + Chat -->
    <div class="right-panel">
        <div class="online-scoreboard">
            <h3>Scoreboard</h3>
            <div class="goal-display">First to <span id="goal-value">10</span> frags</div>
            <div class="player-standings" id="player-standings"></div>
        </div>

        <div class="online-kill-feed">
            <h4>Activity</h4>
            <div class="kill-feed-entries" id="kill-feed"></div>
        </div>

        <div class="online-chat">
            <div class="chat-messages" id="chat-messages"></div>
            <div class="chat-input-area">
                <input type="text" id="chat-input" placeholder="Type message..." />
                <button id="chat-send">Send</button>
            </div>
        </div>
    </div>
</div>
```

**CSS for Three-Column Layout** (add to `multiplayer-ui.css` or new file):
```css
/* Three-column layout: Opponents | Main Board | Right Panel */
.online-game-area {
    display: grid;
    grid-template-columns: 220px 1fr 280px;
    gap: 16px;
    height: 100vh;
    padding: 16px;
    background: var(--game-bg);
}

/* LEFT: Opponents panel with watch system */
.opponents-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding: 8px;
}

/* Watch controls (Auto Watch + Select buttons) */
.watch-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
}

.watch-btn {
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
}

.watch-btn.active {
    background: #4ade80;  /* Green when auto-watch active */
}

/* 2x2 grid for mini boards (max 4) */
.watch-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 8px;
}

.opponent-board {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    padding: 4px;
    cursor: pointer;  /* Click to swap */
}

.opponent-board:hover {
    background: rgba(100, 100, 255, 0.3);
}

.opponent-board.empty {
    opacity: 0.5;
}

.opponent-canvas-container canvas {
    width: 100%;
    height: auto;
    image-rendering: pixelated;
}

/* Unwatched players list */
.unwatched-players {
    padding: 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    font-size: 12px;
}

.unwatched-player {
    display: inline-block;
    padding: 2px 6px;
    margin: 2px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
}

.unwatched-player:hover {
    background: rgba(100, 100, 255, 0.3);
}

/* Player selection dropdown */
.player-dropdown {
    position: absolute;
    background: rgba(30, 30, 50, 0.95);
    border-radius: 8px;
    padding: 8px;
    z-index: 100;
}

.player-dropdown-item {
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
}

.player-dropdown-item.watched {
    background: rgba(100, 255, 100, 0.3);
}

.player-dropdown-item:hover {
    background: rgba(100, 100, 255, 0.3);
}

/* CENTER: Your main board - BIG */
.main-board-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.main-board-container {
    /* Full size Phaser board */
    width: 100%;
    max-width: 400px;
    aspect-ratio: 10 / 24;
}

/* RIGHT: Scoreboard + Kill Feed + Chat */
.right-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
}

.online-scoreboard,
.online-kill-feed,
.online-chat {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    padding: 12px;
}
```

---

### 📊 Garbage Meter / Incoming Garbage Indicator (REUSE FROM LOCAL MP)

The local multiplayer already has a beautiful, animated garbage indicator bar that shows pending incoming garbage lines. This should be **reused directly** for online multiplayer on the main board.

#### Existing Local Multiplayer Implementation

**HTML Structure** (from `index.html` lines 552-556):
```html
<!-- Board Section with Garbage Indicator -->
<div class="player-board-wrapper">
    <div class="garbage-indicator" id="main-garbage-bar">
        <div class="garbage-fill"></div>
        <div class="garbage-glow"></div>
    </div>
    <div class="player-board-section">
        <div id="main-phaser-container" class="main-board-container"></div>
    </div>
</div>
```

**CSS Styling** (from `main.css` lines 22151-22186):
```css
/* Garbage Indicator Bar */
.garbage-indicator {
    position: relative;
    width: 8px;
    height: var(--board-height, 200px);
    background: rgba(0, 0, 0, 0.5);
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
}

.garbage-indicator .garbage-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 0%;
    background: linear-gradient(to top,
            #ef4444 0%,      /* Red at bottom (danger) */
            #f97316 30%,     /* Orange */
            #fbbf24 60%,     /* Yellow */
            #a3e635 100%);   /* Green at top (safe) */
    border-radius: 0 0 3px 3px;
    transition: height 0.3s ease-out;
}

.garbage-indicator .garbage-glow {
    position: absolute;
    bottom: 0;
    left: -4px;
    right: -4px;
    height: 0%;
    background: radial-gradient(ellipse at bottom, rgba(239, 68, 68, 0.6), transparent);
    filter: blur(4px);
    pointer-events: none;
    transition: height 0.3s ease-out;
}
```

**JavaScript Update Logic** (to add to `OnlineMultiplayerMode.js`):
```javascript
/**
 * Update the garbage meter visual based on pending garbage lines
 * Reuses the exact same approach from local multiplayer
 */
updateGarbageMeter(garbageQueue) {
    const totalLines = garbageQueue?.getTotalLines?.() ?? 0;
    
    // Calculate percentage (board height is 20-24 rows depending on mode)
    const maxVisibleLines = 20;  // Max lines before "full danger"
    const percentage = Math.min(100, (totalLines / maxVisibleLines) * 100);
    
    // Update the garbage bar fill and glow
    const garbageIndicator = document.getElementById('main-garbage-bar');
    if (garbageIndicator) {
        const fill = garbageIndicator.querySelector('.garbage-fill');
        const glow = garbageIndicator.querySelector('.garbage-glow');
        
        if (fill) fill.style.height = `${percentage}%`;
        if (glow) glow.style.height = `${percentage}%`;
    }
    
    // Also update the numeric value in the stats bar
    const garbageStat = document.getElementById('main-garbage-value');
    if (garbageStat) {
        garbageStat.textContent = totalLines;
        
        // Pulse animation on change
        if (garbageStat.prevValue !== totalLines) {
            garbageStat.classList.add('pulse');
            setTimeout(() => garbageStat.classList.remove('pulse'), 300);
            garbageStat.prevValue = totalLines;
        }
    }
}
```

#### Integration with Network State

The garbage queue is included in network state updates. On each `GAME_STATE_FULL` received:

```javascript
// In OnlineMultiplayerMode.js handleNetworkStateUpdate()
handleNetworkStateUpdate(state) {
    // Find local player's data
    const myPlayerState = state.players.find(p => p.id === this.localPlayerId);
    
    if (myPlayerState) {
        // Update garbage meter with incoming garbage count
        this.updateGarbageMeter({
            getTotalLines: () => myPlayerState.pendingGarbage || 0
        });
        
        // Also update the GarbageQueue object if needed for piece lock timing
        if (this.localGarbageQueue) {
            this.localGarbageQueue.syncFromNetwork(myPlayerState.garbageEntries);
        }
    }
}
```

#### Garbage Data in Network Messages

**In `GAME_STATE_FULL` player data:**
```javascript
players: [{
    id: 'steam_123456',
    // ... other fields ...
    pendingGarbage: 6,          // Total lines pending
    garbageEntries: [           // Detailed entries for hole positions
        { lines: 4, holeColumn: 3, attackerId: 'steam_789' },
        { lines: 2, holeColumn: 7, attackerId: 'steam_456' }
    ]
}, ...]
```

**In `GAME_GARBAGE_SENT` message:**
```javascript
GAME_GARBAGE_SENT: {
    from: 'steam_123456',           // Attacker
    targets: ['steam_789', ...],    // All opponents in FFA
    amount: 4,                      // Lines cleared / sent
    holes: [3, 3, 7, 7],            // Hole columns for each line
    color: 'garbage',               // Garbage block color
    attackId: 'atk_12345',          // Unique attack ID
    scaled: true                    // Whether attack scaling was applied
}
```

#### Garbage Meter on Opponent Mini-Boards (Optional Enhancement)

For the small opponent boards on the left panel, show a simplified garbage indicator:

```javascript
/**
 * Draw a mini garbage bar on the side of a Canvas opponent board
 */
drawMiniGarbageBar(ctx, pendingGarbage, boardWidth, boardHeight) {
    const barWidth = 4;
    const barHeight = boardHeight;
    const x = boardWidth - barWidth;
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, 0, barWidth, barHeight);
    
    // Fill based on garbage amount
    const percentage = Math.min(1, pendingGarbage / 20);
    const fillHeight = barHeight * percentage;
    
    // Gradient from green (top) to red (bottom of fill)
    const gradient = ctx.createLinearGradient(x, barHeight - fillHeight, x, barHeight);
    gradient.addColorStop(0, '#a3e635');  // Green at top of fill
    gradient.addColorStop(1, '#ef4444');  // Red at bottom
    
    ctx.fillStyle = gradient;
    ctx.fillRect(x, barHeight - fillHeight, barWidth, fillHeight);
}
```

#### Implementation Checklist

- [ ] Add garbage indicator HTML to `#online-multiplayer-container` main board section
- [ ] Reuse CSS from local multiplayer (already exists in `main.css`)
- [ ] Add `updateGarbageMeter()` method to `OnlineMultiplayerMode.js`
- [ ] Call `updateGarbageMeter()` on each `GAME_STATE_FULL` receive
- [ ] Include `pendingGarbage` and `garbageEntries` in network state sync
- [ ] (Optional) Add mini garbage bars to opponent Canvas boards

---

**Requirements:**
- [ ] Create new HTML container `#online-multiplayer-container` with three-column layout
- [ ] Create CSS for three-column grid (opponents | main board | right panel)
- [ ] Opponent boards use Canvas (lightweight, view-only)
- [ ] Main board uses Phaser (full features, input handling)
- [ ] **Main board includes garbage indicator bar** (reuse local MP CSS/HTML)
- [ ] Right panel has scoreboard, kill feed, and chat sections

#### 1.2 Create Board Renderers (Phaser for Main, Canvas for Opponents)

**⚠️ THREE-COLUMN RENDERING STRATEGY:**

| Panel | Renderer | Why |
|-------|----------|-----|
| **CENTER (Your Board)** | Phaser | Full features, input handling, effects |
| **LEFT (Opponents)** | Canvas | Lightweight, view-only, many small boards |
| **RIGHT (Info Panel)** | DOM | Scoreboard, kill feed, chat |

**Main Board (Phaser) - Copy LocalMultiplayerMode pattern:**
```javascript
// Create ONE Phaser instance for local player's main board
_createMainBoard() {
    const BLOCK_SIZE = 32;  // Full size for main board

    const config = {
        width: 10 * BLOCK_SIZE,
        height: 24 * BLOCK_SIZE,
        parent: 'main-phaser-container',
        type: Phaser.WEBGL,
        transparent: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    };

    this.mainPhaserGame = new Phaser.Game(config);
    this.mainBoardScene = new BoardScene('MainBoard', { blockSize: BLOCK_SIZE });
    this.mainPhaserGame.scene.add('MainBoard', this.mainBoardScene, true);

    // Set up input handlers for local player
    this._setupInputHandlers(this.mainBoardScene);
}
```

**Opponent Boards (Canvas) - Lightweight rendering:**
```javascript
// Create Canvas renderers for opponent mini boards
_createOpponentBoards(opponents) {
    this.opponentCanvases = new Map();

    opponents.forEach((opponent, index) => {
        const canvas = document.getElementById(`opponent-${index + 1}-canvas`);
        const ctx = canvas.getContext('2d');

        // Mini board: 10x24 grid, small block size
        const MINI_BLOCK_SIZE = 8;  // Small blocks for mini boards
        canvas.width = 10 * MINI_BLOCK_SIZE;
        canvas.height = 24 * MINI_BLOCK_SIZE;

        this.opponentCanvases.set(opponent.id, {
            canvas, ctx,
            blockSize: MINI_BLOCK_SIZE
        });
    });
}

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

#### 1.3 Connect Input Handlers

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

#### 1.4 Implement State Synchronization

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

#### 1.5 Integrate Garbage System

**Task:** Connect existing garbage system to network
**Reuse:** `GarbageQueue` from `src/core/garbage.js`

**Requirements:**
- [ ] Host: Calculate garbage from line clears
- [ ] Host: Route garbage to all opponents (FFA)
- [ ] Host: Broadcast `GAME_GARBAGE_SENT` events
- [ ] Peers: Update local garbage queue from events
- [ ] Peers: Show garbage indicator on board
- [ ] Peers: Apply garbage on piece lock (host authoritative)

#### 1.6 Implement Scoreboard & Kill Feed

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

### Phase 4: Chat & Communication (MEDIUM)
**Priority:** 🟡 MEDIUM
**Goal:** Players can communicate during match

#### 4.1 Implement Chat UI in Waiting Room
```
Location: src/ui/lobby-waiting-room.js
```

**Requirements:**
- [ ] Chat input field
- [ ] Message display area (scrollable)
- [ ] System messages (player joined, ready, etc.)
- [ ] Player name + color prefix
- [ ] Enter to send

#### 4.2 Implement In-Game Chat
```
Location: src/ui/ingame-chat.js (NEW)
```

**Requirements:**
- [ ] Press Enter to open chat
- [ ] Semi-transparent overlay
- [ ] Recent messages visible
- [ ] Quick chat options (GG, Nice, etc.)
- [ ] Mute player option

---

### Phase 5: Robustness & Edge Cases (MEDIUM)
**Priority:** 🟡 MEDIUM
**Goal:** Handle disconnections and failures gracefully

#### 5.1 Implement Host Migration
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

#### 5.2 Implement Player Disconnect Handling
```
Location: src/core/multiplayer/ffa-p2p-game-state.js
```

**Requirements:**
- [ ] Detect peer disconnect (P2P channel closed)
- [ ] Grace period (10 seconds) for reconnection
- [ ] Mark player as "disconnected" (not dead)
- [ ] Handle reconnection during grace period
- [ ] Remove player after grace period expires

#### 5.3 Implement Reconnection Flow
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

### Phase 6: Advanced Features (LOW)
**Priority:** 🟢 LOW (Future Enhancements)

#### 6.1 Survivor Mode (Quadra-Style)
- Round-based elimination
- All players respawn each round
- First team to X round wins

#### 6.2 Spectator Mode
- Join as spectator
- Watch all boards
- Switch between players
- Spectator chat

#### 6.3 Handicap System
- Skill-based starting level
- Configurable in match settings
- Helps balance new vs experienced players

#### 6.4 Recording & Replay
- Record all network messages
- Playback matches
- Share replays

#### 6.5 Statistics & Leaderboards
- Track lifetime stats
- Steam leaderboard integration
- Match history

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

### Message Protocol Reference

```javascript
// Lobby Phase Messages
LOBBY_PLAYER_JOINED    { playerId, name, steamId }
LOBBY_PLAYER_LEFT      { playerId }
LOBBY_PLAYER_READY     { playerId, ready: boolean }
LOBBY_GAME_START       { seed, players[], config }
LOBBY_MATCH_CONFIG     { matchId, seed, config, phase }
LOBBY_STATE            { matchId, state, locked, players[] }
LOBBY_LOCK             { matchId }                            // NEW
LOBBY_UNLOCK           { matchId }                            // NEW

// Gameplay Messages (Peer → Host)
GAME_INPUT_MOVE        { playerId, direction, timestamp }
GAME_INPUT_ROTATE      { playerId, direction, timestamp }
GAME_INPUT_DROP        { playerId, type: 'soft'|'hard', timestamp }
GAME_INPUT_BATCH       { playerId, tick, inputs[] }

// Gameplay Messages (Host → All)
GAME_SYNCPOINT         { syncpoint, tick, reason }            // ENHANCED
GAME_STATE_FULL        { players[], tick, seq, timestamp }    // ENHANCED with tick/seq
GAME_STATE_RESYNC      { players[], tick, timestamp }         // Reliable full snapshot (join/resync)
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
NET_WELCOME            { protocolVersion, featureFlags[], matchId, accepted, reason }
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
│   │   ├── OnlineMultiplayerMode.js    ← Main orchestrator (NEEDS RENDERING)
│   │   └── LocalMultiplayerMode.js     ← Reference for reusable patterns
│   ├── steam/
│   │   └── steam-networking.js         ← P2P layer (COMPLETE)
│   ├── multiplayer/
│   │   ├── ffa-p2p-game-state.js       ← Game state (MOSTLY COMPLETE)
│   │   ├── ffa-attack-router.js        ← Attack system (COMPLETE)
│   │   └── frag-tracker.js             ← Win conditions (COMPLETE)
│   ├── network/
│   │   ├── message-types.js            ← Message definitions (COMPLETE)
│   │   ├── input-validator.js          ← Anti-cheat (COMPLETE)
│   │   ├── host-migration.js           ← Failover (NEEDS WORK)
│   │   ├── match-flow.js               ← Match state machine (NEW - CRITICAL)
│   │   ├── client-prediction.js        ← Input prediction + reconciliation (NEW - CRITICAL)
│   │   ├── binary-encoding.js          ← Snapshot compression (NEW - Phase 1.4)
│   │   ├── replay-logger.js            ← Passive match logging (NEW)
│   │   └── disconnect-detector.js      ← Heartbeat + timeout handling (NEW)
│   ├── engine/
│   │   └── unified-game-loop.js        ← Game loop (COMPLETE)
│   └── garbage.js                      ← Quadra-compatible attacks (REUSE)
│
├── ui/
│   ├── lobby-browser.js                ← Browse lobbies (COMPLETE)
│   ├── lobby-waiting-room.js           ← Pre-match UI (COMPLETE)
│   ├── match-config-modal.js           ← Match settings (COMPLETE + add fairAttackScaling toggle)
│   ├── online-board-renderer.js        ← Board rendering (TO CREATE)
│   ├── online-scoreboard.js            ← Right panel scoreboard (TO CREATE)
│   ├── online-kill-feed.js             ← Kill/event feed (TO CREATE)
│   ├── online-chat.js                  ← Chat component (TO CREATE)
│   ├── match-results-modal.js          ← Results screen (TO CREATE)
│   ├── spectator-ui.js                 ← Spectator mode UI (NEW)
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
    └── online-multiplayer.css          ← Game screen styles (TO CREATE)
```

### Files to Create (Phase 1) - UPDATED

| File | Purpose | Priority |
|------|---------|----------|
| `src/core/network/match-flow.js` | Match state machine + protocol gating | 🔴 CRITICAL |
| `src/core/network/client-prediction.js` | Input prediction + server reconciliation | 🔴 CRITICAL |
| `src/core/network/disconnect-detector.js` | Heartbeat tracking + timeout handling | 🔴 High |
| `src/core/network/replay-logger.js` | Passive match event logging | 🟠 Medium |
| `src/core/network/binary-encoding.js` | Snapshot compression (Phase 1.4) | 🟡 Later |
| `src/ui/online-scoreboard.js` | Right panel scoreboard | 🟠 Second |
| `src/ui/online-kill-feed.js` | Activity/kill feed | 🟠 Second |
| `src/ui/online-chat.js` | Chat component | 🟡 Third |
| `src/ui/match-results-modal.js` | End game results | 🟠 Second |
| `src/ui/spectator-ui.js` | Spectator mode controls | 🟡 Third |

### Files to Modify (Phase 1)

| File | Changes | Priority |
|------|---------|----------|
| `src/core/steam/steam-networking.js` | **FIX BUG:** Remove duplicate `on()` method + add envelope + channelized send helpers | 🔴 FIRST |
| `src/core/network/message-types.js` | Add protocol handshake + match state messages | 🔴 First |
| `src/core/game-modes/OnlineMultiplayerMode.js` | Add `_createPhaserGamesForOnline()`, implement `handleMatchStart()` | 🔴 First |
| `public/styles/multiplayer-ui.css` | Extend grid layouts for 5-8 players, add right panel styles | 🔴 First |
| `public/index.html` | Add right panel (scoreboard, kill feed, chat) for online mode | 🟠 Second |
| `src/events/multiplayer-events.js` | Add network-specific events if needed | 🟡 Third |

### Key Insight: REUSE, Don't Recreate

**From LocalMultiplayerMode, copy these patterns:**
- `_createSeparatePhaserGames()` → `_createPhaserGamesForOnline()`
- `_startGameLoop()` → adapt for network sync instead of local physics
- `_syncBoardScenes()` → same, but data comes from network
- `_updateMultiplayerStats()` → reuse directly
- `_handleGameOver()` → adapt for network broadcast

---

## 📅 Implementation Priority Matrix - UPDATED

| Phase | Item | Priority | Effort | Impact | Dependencies |
|-------|------|----------|--------|--------|--------------|
| **1.0** | Fix duplicate `on()` bug | 🔴 CRITICAL | LOW | BLOCKING | None |
| **1.0** | Steam P2P Transport + Envelope | 🔴 CRITICAL | MEDIUM | HIGH | Bug fix |
| **1.0a** | Match State Machine | 🔴 CRITICAL | MEDIUM | HIGH | None |
| **1.1** | Three-Column Layout HTML/CSS | 🔴 CRITICAL | MEDIUM | BLOCKING | None |
| **1.2** | Board Renderers (Phaser + Canvas) | 🔴 CRITICAL | HIGH | BLOCKING | 1.1 |
| **1.3** | **Client-Side Prediction** | 🔴 CRITICAL | HIGH | HIGH (game feel) | 1.2 |
| **1.3** | Input Handlers + Network Send | 🔴 CRITICAL | MEDIUM | HIGH | 1.2 |
| **1.4** | State Synchronization | 🔴 CRITICAL | MEDIUM | HIGH | 1.3 |
| **1.4** | Binary Encoding (optional) | 🟡 MEDIUM | LOW | MEDIUM (bandwidth) | 1.4 |
| **1.5** | Garbage System Integration | 🔴 CRITICAL | MEDIUM | HIGH | 1.4 |
| **1.5** | **Attack Scaling Toggle** | 🟠 HIGH | LOW | MEDIUM (balance) | 1.5 |
| **1.6** | Scoreboard + Kill Feed | 🟠 HIGH | MEDIUM | MEDIUM | 1.4 |
| **2.1** | Match Results Modal | 🟠 HIGH | MEDIUM | HIGH | Phase 1 |
| **2.2** | Game Over Detection | 🟠 HIGH | LOW | HIGH | Phase 1 |
| **2.3** | Round Restart (optional) | 🟡 MEDIUM | MEDIUM | MEDIUM | 2.2 |
| **3.x** | Gameplay Polish (animations, visuals) | 🟡 MEDIUM | MEDIUM | MEDIUM | Phase 1 |
| **3.5** | **Network QoS HUD** | 🟡 MEDIUM | LOW | MEDIUM (debugging) | 1.0 |
| **4.x** | Chat System | 🟡 MEDIUM | LOW | MEDIUM | Phase 1 |
| **5.1** | Host Migration | 🟡 MEDIUM | HIGH | HIGH (robustness) | Phase 1 |
| **5.1** | **Heartbeat + Disconnect Detection** | 🟠 HIGH | MEDIUM | HIGH | 1.0 |
| **5.2** | Player Disconnect Handling | 🟡 MEDIUM | MEDIUM | HIGH | 5.1 |
| **5.3** | Reconnection Flow | 🟡 MEDIUM | HIGH | HIGH | 5.2 |
| **6.x** | **Late-Join Spectator Mode** | 🟡 MEDIUM | MEDIUM | MEDIUM | 5.x |
| **6.x** | **Team Mode** | 🟡 MEDIUM | HIGH | HIGH (Quadra parity) | Phase 3 |
| **6.x** | Survivor Mode | 🟢 LOW | HIGH | MEDIUM | Team Mode |
| **6.x** | Recording/Replay UI | 🟢 LOW | HIGH | LOW | Passive logging |

### Phase 1 Critical Path (Must Complete)
```
Bug Fix → Transport Layer → State Machine → Layout → Renderers → 
Prediction → Input → Sync → Garbage → Scoreboard
```

---

## ✅ Definition of Done - UPDATED

### Minimum Viable Multiplayer (MVM)
- [ ] Players can create/join lobbies via Steam Spacewar
- [ ] Waiting room shows all players and ready states
- [ ] Host can start match when all ready
- [ ] All players see game boards rendered
- [ ] **Local inputs feel responsive (client-side prediction)**
- [ ] Garbage attacks work (clear lines → send garbage)
- [ ] **Attack scaling works for 5+ player games**
- [ ] Deaths and frags tracked correctly
- [ ] Win condition triggers match end
- [ ] Results screen shows winner and stats
- [ ] "Play Again" returns to waiting room

### Full Feature Multiplayer
- [ ] All MVM features
- [ ] Chat in waiting room and in-game
- [ ] Kill feed overlay
- [ ] Scoreboard overlay (TAB)
- [ ] Host migration on disconnect
- [ ] Player reconnection support
- [ ] Garbage queue visual indicators
- [ ] Death/respawn animations
- [ ] **Spectator mode for late joiners**
- [ ] **Network QoS HUD (RTT, packet loss)**
- [ ] **Passive replay logging enabled**

---

## 🧪 Testing Checklist

### Mock Mode (Browser) - Basic Flow
- [ ] Create lobby in Window 1
- [ ] Join lobby in Window 2
- [ ] Both players see each other
- [ ] Ready up works
- [ ] Start match shows game boards
- [ ] Inputs work in both windows
- [ ] Attacks cross between players
- [ ] Win condition ends match
- [ ] Results screen appears

### Mock Mode - Edge Cases
- [ ] 3+ tabs can join the same lobby
- [ ] Closing tab removes player from lobby
- [ ] Host leaving promotes new host
- [ ] Late join during countdown works
- [ ] Rematch cycle works correctly
- [ ] Chat messages appear in all tabs

### Steam Spacewar (Real P2P)
- [ ] Launch two Steam clients (different accounts or Steam Family Sharing)
- [ ] Create lobby visible in Steam overlay
- [ ] Friend can join via Steam invite
- [ ] P2P connection established
- [ ] Full gameplay works
- [ ] No significant lag (<100ms)
- [ ] Host disconnect triggers migration
- [ ] Reconnection within grace period works

### Network Simulation (Regression Harness)
- [ ] Simulate 80-150ms latency and 1-3% packet loss
- [ ] Verify join/resync works under jitter
- [ ] Confirm snapshot drops do not freeze the UI
- [ ] Client-side prediction masks latency up to 150ms
- [ ] Attack scaling formula produces expected results

### Stress Testing
- [ ] 8-player FFA runs smoothly
- [ ] Rapid line clears (T-spin + tetris combos) don't desync
- [ ] 60+ minute session has no memory leaks
- [ ] Browser tab sleep/wake doesn't break connection

### Quality Gates (Must Pass Before Release)
| Test | Criteria | Pass? |
|------|----------|-------|
| Join Flow | Player can join and play within 5 seconds | [ ] |
| Input Latency | Local prediction masks up to 100ms RTT | [ ] |
| Garbage Accuracy | Garbage lines match sender's line clears | [ ] |
| Frag Attribution | Correct killer attributed for all deaths | [ ] |
| State Consistency | No visual desync after 100 piece locks | [ ] |
| Disconnect Grace | 10s reconnect window works | [ ] |
| Host Migration | New host takes over within 3s | [ ] |

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

### Anti-Cheat Measures (Already Implemented ✅)

| Measure | Location | Status |
|---------|----------|--------|
| **Input Validation** | `src/core/network/input-validator.js` | ✅ Complete |
| **Rate Limiting** | `steam-networking.js` | ✅ Complete |
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
| **State spoofing** | Only host sends `GAME_STATE_FULL`; peers ignore state from non-host |
| **Input replay** | Tick-based inputs; host drops inputs for past ticks |
| **Match hijacking** | `matchId` + per-match `nonce` on all packets; ignore stray packets |
| **Spam attacks** | Rate limiting per player; auto-drop after threshold |
| **Protocol mismatch** | `NET_HELLO/NET_WELCOME` handshake validates version |

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

## 📋 Implementation Order (Step by Step)

### Step 0: Fix Critical Bug ⚠️
```bash
# FIRST: Fix duplicate on() method in steam-networking.js
# Location: src/core/steam/steam-networking.js
# Remove line 325 version, keep line 532 array-based version
```

### Step 1: Upgrade Steam P2P Transport (Spacewar Best Practice)
```bash
# In: src/core/steam/steam-networking.js
# - Add sendReliable/sendUnreliable helpers (channels + send type)
# - Wrap messages in envelope (matchId, seq, tick, sentAt)
# - Track per-channel seq and drop stale snapshots
# - Add NET_PING/NET_PONG and expose RTT/packet loss
```

### Step 2: Define Protocol + Match Flow (Handshake + State Machine)
```bash
# In: src/core/network/message-types.js, src/core/network/match-flow.js
# - NET_HELLO/NET_WELCOME (version + feature flags)
# - Lobby -> match state machine (open/locked/in-match/post-match/rematch)
# - matchId + nonce enforced on gameplay messages
# - Packet budget rules (binary snapshots, JSON control)
```

### Step 3: Create Three-Column HTML Container
```bash
# Add to: public/index.html
# Create: #online-multiplayer-container with:
#   - .opponents-panel (left) - watch controls + 2x2 mini boards + unwatched list
#   - .main-board-panel (center) - your big board
#   - .right-panel (right) - scoreboard, kill feed, chat
```

### Step 4: Create Three-Column CSS Layout
```bash
# Add to: public/styles/multiplayer-ui.css (or new online-multiplayer.css)
# - .online-game-area { grid-template-columns: 220px 1fr 280px; }
# - .opponents-panel { column layout: watch controls + grid }
# - .watch-grid { 2x2 grid for mini boards (max 4) }
# - .main-board-panel { centered, full-size Phaser board }
# - .right-panel { vertical stack: scoreboard, kill feed, chat }
```

### Step 5: Create Main Board (Phaser)
```bash
# In: src/core/game-modes/OnlineMultiplayerMode.js
# Create: _createMainBoard()
# - ONE Phaser.Game for local player's main board
# - Full-size (32px blocks)
# - Set up input handlers (move, rotate, drop)
# - Send inputs to host via network
```

### Step 6: Create Opponent Watch System (Max 4 Visible)
```bash
# In: src/core/game-modes/OnlineMultiplayerMode.js
# Create: OpponentWatchManager class
# - watchedPlayers[] array (max 4 player IDs)
# - toggleWatch(playerId) - tag/untag with sliding window
# - autoSelectOpponents() - auto-pick 4 (alive first)
# - updateDisplay() - refresh 2x2 grid

# Create: _createOpponentBoards()
# - Fixed 2x2 grid with 4 Canvas slots
# - Canvas2D for lightweight rendering (8px blocks)
# - View-only (no input)
# - Update from GAME_STATE_FULL for watched players only

# UI Controls:
# - "Auto Watch" button (auto-selects 4 opponents, alive > dead)
# - "Watching" counter (e.g., 4/4)
# - "Select" dropdown/list (tag/untag; 5th swaps oldest)
# - Click unwatched name to swap with oldest watched
# - Click mini board to open swap menu
# - Unwatched players list at bottom (clickable)
```

### Step 7: Implement handleMatchStart()
```bash
# In: src/core/game-modes/OnlineMultiplayerMode.js
# handleMatchStart() should:
# 1. Hide waiting room
# 2. Show #online-multiplayer-container
# 3. Create opponent mini boards (left panel)
# 4. Create main Phaser board (center panel)
# 5. Initialize right panel (scoreboard, kill feed)
# 6. Start game loop
# 7. Subscribe to GAME_STATE_FULL for updates
```

### Step 8: Implement Game Loop with Network Sync
```bash
# In: src/core/game-modes/OnlineMultiplayerMode.js
# Game loop handles:
# - Host: runs physics, broadcasts state at 30Hz
# - Peer: receives state, updates all boards
# - All: render main board (Phaser), opponent boards (Canvas)
```

### Step 9: Test Mock Mode
```bash
# Test in browser (mock mode auto-activates):
npm run dev

# Open 2 browser tabs
# Tab 1: Create lobby, wait
# Tab 2: Join lobby, ready up
# Tab 1: Start match
# VERIFY:
#   - Your board BIG in center
#   - Opponent board SMALL on left
#   - Scoreboard + chat on right
```

### Step 10: Test with Steam Spacewar (Optional)
```bash
# Only if you have Electron + greenworks set up:
echo "480" > steam_appid.txt
npm run electron
# Test real P2P with another Steam user
```

---

**Next Action:** Begin Phase 1 - Game Rendering Integration

**⚠️ CORRECTED Layout (Quadra-Style Three-Column):**

```
┌────────────────┬─────────────────────────┬──────────────────┐
│   OPPONENTS    │      YOUR BOARD         │   SCOREBOARD     │
│   (small)      │        (BIG)            │   + KILL FEED    │
│   Canvas       │        Phaser           │   + CHAT         │
└────────────────┴─────────────────────────┴──────────────────┘
```

**Implementation Order (UPDATED):**

1. **Step 0:** Fix `steam-networking.js` duplicate `on()` method bug
2. **Step 1:** Upgrade Steam P2P transport (envelope + channels)
3. **Step 2:** Define protocol + match flow (handshake + state machine)
4. **Step 2a:** Create `match-flow.js` with state machine
5. **Step 2b:** Create `disconnect-detector.js` with heartbeat tracking
6. **Step 2c:** Create `replay-logger.js` for passive logging
7. **Step 3:** Create three-column HTML container in `index.html`
8. **Step 4:** Create three-column CSS layout
9. **Step 5:** Create main board (Phaser, center, full-size)
10. **Step 6:** Create opponent mini boards (Canvas, left, small)
11. **Step 6a:** **Create `client-prediction.js`** (CRITICAL for game feel)
12. **Step 7:** Implement `handleMatchStart()` to wire everything
13. **Step 8:** Implement game loop with network sync + prediction reconciliation
14. **Step 8a:** Add attack scaling formula to garbage system
15. **Step 8b:** Add `fairAttackScaling` toggle to match config
16. **Step 9:** Test in mock mode (2 browser tabs)
17. **Step 10:** Test with Steam Spacewar (optional)

**Primary Focus Files (UPDATED):**
- `src/core/steam/steam-networking.js` (fix duplicate `on()`, add envelope + channelized send)
- `src/core/network/message-types.js` (protocol handshake + match state + error messages)
- `src/core/network/match-flow.js` (NEW: match state machine + lobby lock)
- `src/core/network/client-prediction.js` (NEW: input prediction + server reconciliation)
- `src/core/network/disconnect-detector.js` (NEW: heartbeat + timeout handling)
- `src/core/network/replay-logger.js` (NEW: passive match logging)
- `public/index.html` (ADD `#online-multiplayer-container` with 3 columns)
- `public/styles/multiplayer-ui.css` (ADD three-column CSS)
- `src/core/game-modes/OnlineMultiplayerMode.js` (IMPLEMENT board creation + handleMatchStart)
- `src/ui/match-config-modal.js` (ADD `fairAttackScaling` toggle)
- `src/core/multiplayer/ffa-attack-router.js` (ADD attack scaling formula)

**Key Differences from Local Multiplayer:**
| Aspect | Local MP | Online MP |
|--------|----------|-----------|
| Layout | Equal-sized grid | 3-column (opp \| main \| info) |
| Your board | One of many | BIG in center |
| Other boards | All Phaser | Canvas mini boards |
| Data source | Local state | Network state from host |
| Input handling | Direct | Predicted locally, validated by host |
| State authority | Shared | Host-authoritative |

**The main work is in OnlineMultiplayerMode.js:**
- `_createMainBoard()` → Phaser board for local player (center)
- `_createOpponentBoards()` → Canvas boards for opponents (left)
- `_updateScoreboard()` → Update right panel
- `handleMatchStart()` → Wire everything together
- **`_setupClientPrediction()`** → Wire input prediction + reconciliation

---

## 📊 Summary of Improvements Made to This Plan

| Category | Added Items |
|----------|-------------|
| **Architecture** | Match state machine, syncpoint states, late-join rules |
| **Game Feel** | Client-side prediction with reconciliation |
| **Balance** | Attack scaling formula + toggle for 5+ players |
| **Robustness** | Heartbeat detection, disconnect handling, error messages |
| **Debugging** | Passive replay logging, Network QoS HUD |
| **Optimization** | Binary snapshot encoding specification |
| **Protocol** | 15+ new message types (spectator, rematch, errors) |
| **Files** | 5 new source files to create |
| **Visual** | Garbage meter integrated with network state |
| **Security** | Comprehensive anti-cheat and validation rules |
| **Testing** | Quality gates, edge cases, stress tests |

---

## ✅ Final Audit Status

**Plan Completeness Checklist:**

| Section | Status | Notes |
|---------|--------|-------|
| Current State Assessment | ✅ Complete | 70% done, clear gap analysis |
| Quadra Comparison | ✅ Complete | Best practices mapped and adopted |
| Match State Machine | ✅ Complete | 6-state diagram with transitions |
| Late-Join Rules | ✅ Complete | Decision matrix for all scenarios |
| Client-Side Prediction | ✅ Complete | Full implementation spec |
| Attack Scaling | ✅ Complete | Formula + scaling table |
| Binary Encoding | ✅ Complete | 90% bandwidth reduction spec |
| Syncpoints | ✅ Complete | Quadra-style join/resync flow |
| Heartbeat Detection | ✅ Complete | Timeout rules + migration triggers |
| Error Handling | ✅ Complete | 10 error codes defined |
| Replay Logging | ✅ Complete | Passive logging infrastructure |
| Three-Column Layout | ✅ Complete | HTML + CSS + component specs |
| Garbage Meter | ✅ Complete | Network-integrated, reuses local MP |
| Message Protocol | ✅ Complete | 30+ message types documented |
| Implementation Phases | ✅ Complete | 6 phases with priorities |
| Testing Coverage | ✅ Complete | Quality gates + edge cases |
| Security Considerations | ✅ Complete | Anti-cheat measures documented |

**Industry Best Practices Coverage:**

| Best Practice | Implemented |
|---------------|-------------|
| Deterministic simulation | ✅ Shared seed |
| Host-authoritative model | ✅ Single source of truth |
| Client-side prediction | ✅ Input prediction + reconciliation |
| Reliable/unreliable channels | ✅ Multi-channel transport |
| Protocol versioning | ✅ NET_HELLO/NET_WELCOME handshake |
| State machine for match flow | ✅ 6-state machine |
| Attack scaling for balance | ✅ Fair attack toggle |
| Disconnect handling | ✅ Grace period + migration |
| Input validation | ✅ Rate limiting + rejection |
| Replay/debug support | ✅ Passive logging |

**🎯 Plan is COMPLETE and industry-standard ready!**

The implementation can now proceed with confidence that all edge cases, best practices, and quality requirements have been specified. The plan draws from proven implementations (Quadra), modern networking practices (Steam P2P), and includes comprehensive testing criteria.

**Total Document Size:** ~2900 lines
**Estimated Implementation Time:** 4-6 weeks for Phase 1 (MVP), 2-3 months for full feature set

