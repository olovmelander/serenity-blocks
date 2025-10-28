# Free-For-All (FFA) Multiplayer Implementation Guide

## Overview

This document provides a comprehensive guide to implementing a Free-For-All (FFA) multiplayer mode in a Tetris-style game, based on the implementation in the Quadra game engine. This mode is the classic competitive multiplayer where every player fights independently against all others.

---

## Table of Contents

1. [Core Game Architecture](#core-game-architecture)
2. [Game Mode Configuration](#game-mode-configuration)
3. [Garbage Line System](#garbage-line-system)
4. [Attack System](#attack-system)
5. [Networking Architecture](#networking-architecture)
6. [Player State Management](#player-state-management)
7. [Scoring and Win Conditions](#scoring-and-win-conditions)
8. [Implementation Checklist](#implementation-checklist)

---

## Core Game Architecture

### 1. Game Class Structure

The FFA mode is defined by the `Game` class which manages:

```cpp
class Game {
    bool single;          // False for multiplayer
    bool network;         // True for networked games
    bool survivor;        // False for FFA (true for survivor mode)
    bool hot_potato;      // False for FFA (different mode)

    Attack normal_attack; // Attack sent for normal line clears
    Attack clean_attack;  // Attack sent for "clean" (full board clear)

    uint8_t combo_min;    // Minimum combo size to send attacks (default: 2)
    End_type game_end;    // How the game ends (frags, time, points, lines)
    int game_end_value;   // Target value for ending
};
```

**Key Points:**
- FFA mode has `survivor=false` and `hot_potato=false`
- The game manages all players through a `Net_list` object
- Attack types determine how garbage lines are sent

### 2. Game Preset Configuration

FFA mode is set using the `PRESET_FFA` preset:

```cpp
void Game_params::set_preset(Game_preset preset) {
    switch(preset) {
        case PRESET_FFA:
            survivor = false;
            hot_potato = false;
            // Uses default attack settings (lines attack)
            break;
    }
}
```

---

## Game Mode Configuration

### Default FFA Settings

```cpp
Game_params::Game_params() {
    name = "[No name]";
    single = false;
    level_up = false;
    level_start = 1;
    allow_handicap = true;
    game_end = END_NEVER;      // Or END_FRAG for frag limit
    game_end_value = 0;
    game_public = 0;
    network = true;
    survivor = false;
    hot_potato = false;
    boring_rules = false;
    set_preset(PRESET_FFA);
}
```

### Game End Conditions

FFA games can end in different ways:

| End Type | Description | Example Value |
|----------|-------------|---------------|
| `END_NEVER` | Game never auto-ends | 0 |
| `END_FRAG` | First to X frags wins | 20 frags |
| `END_TIME` | Most frags in X minutes | 5 minutes |
| `END_POINTS` | First to X points | 100,000 points |
| `END_LINES` | First to X lines | 200 lines |

**Implementation:** Values are in centiseconds (1/100 second) for time, and actual count for others.

---

## Garbage Line System

### Overview

The garbage line system is the core of competitive play. When you clear multiple lines, you send "garbage lines" (also called "bonus lines" or "attacks") to opponents.

### Line Calculation Formula

When a player clears lines, the number of garbage lines sent is calculated in `Canvas::give_line()`:

```cpp
// Located in canvas.cc:532-559
i = depth - 1;  // depth = number of lines cleared
bool enough = (depth >= game->combo_min);  // Must meet minimum combo

// Version 23 adjustment (if 5+ alive players)
if (game->net_version() == 23) {
    int alive_count = count_alive_players();
    if (alive_count > 4)
        alive_count -= 4;
    else
        alive_count = 0;
    i = max(0, depth - 1 - alive_count);
}

// Version 24+ handicap adjustment
if (game->net_version() >= 24) {
    if (!send_for_clean && !game->boring_rules) {
        while (i && handicap_crowd >= stamp_per_handicap) {
            handicap_crowd -= stamp_per_handicap;
            --i;
        }
    }
    if (!i)
        enough = false;
}
```

**Base Rules:**
- Clear 1 line: Send 0 garbage lines
- Clear 2 lines: Send 1 garbage line
- Clear 3 lines: Send 2 garbage lines
- Clear 4 lines: Send 3 garbage lines

**Important:** Lines are only sent if `depth >= combo_min` (default: 2 lines minimum)

### Clean Bonus

"Clean" refers to clearing lines when your board has no garbage lines waiting. This gives a bonus:

```cpp
int clean_bonus = 0;
if (send_for_clean) {
    clean_bonus = (1 + depth) / 2;  // Half the lines cleared, rounded down
}
```

**Example:** Clear 4 lines with a clean board = 3 (normal) + 2 (clean bonus) = 5 garbage lines sent

### Garbage Line Distribution

Garbage lines are distributed to ALL opponents on different teams in `Net_list::send()`:

```cpp
// Located in net_list.cc:111-203
void Net_list::send(Canvas *sender, uint8_t nb, uint8_t nc,
                     uint8_t lx, Attack attack, bool clean) {
    // For each player in the game
    for (int i = 0; i < MAXPLAYERS; i++) {
        Canvas *receiver = get(i);

        // Skip if:
        if (!receiver) continue;           // No player in slot
        if (!receiver->islocal()) continue; // Remote player (sends own)
        if (receiver->color == sender->color) continue; // Same team

        // Send the lines
        p.player = i;
        p.nb = nb;  // Number of lines
        p.nc = nc;  // Complexity/combo count
        sendlines(&p);
        net->sendtcp(&p);
    }
}
```

**Key Points:**
- Lines are broadcast to ALL opponents (different teams)
- Each local player receives and processes their own garbage
- Remote players receive packets over the network

### Hole Position Encoding

For version 23+, garbage lines include hole position data:

```cpp
// Encode where blocks were when lines were cleared
for (int j = 0; j < nb; j++) {
    p.hole_pos[j] = 0;
    if (clean) {
        // Clean attacks get intentionally bad holes
        p.hole_pos[j] = (j & 1) ? 585 : 72;
        continue;
    }

    // Encode the moved blocks (10 bits for 10 columns)
    for (int i = 4; i < 14; i++) {
        p.hole_pos[j] <<= 1;
        if (c->moved[j][i])
            p.hole_pos[j] |= 1;
    }
}
```

### Receiving Garbage Lines

When a player receives garbage, it's queued in `Canvas::add_packet()`:

```cpp
// Located in canvas.cc:400-475
void Canvas::add_packet(Canvas *sender, uint8_t nb, uint8_t nc,
                         uint8_t lx, Attack attack, uint16_t hole_pos[]) {
    // Update last attacker tracking
    int qui = game->net_list.canvas2player(sender);
    int temp = attacks[qui] + nb * 2;
    if (temp > 255) temp = 255;
    attacks[qui] = temp;

    if (last_attacker != 255) {
        if (attacks[qui] >= attacks[last_attacker])
            last_attacker = qui;
    } else {
        last_attacker = qui;
    }

    // Add to bonus queue (max 20 lines)
    if (bonus < 20) {
        if (nb + bonus > 20)
            nb = 20 - bonus;

        for (int x = 0; x < nb; x++) {
            bon[x + bonus].x = 127;
            bon[x + bonus].color = sender->color;
            bon[x + bonus].hole_pos = hole_pos[x];
            if (x == nb - 1)
                bon[x + bonus].final = true;
            else
                bon[x + bonus].final = false;
        }
        bonus += nb;
    }
}
```

**Important Details:**
- Maximum 20 garbage lines can be queued
- Lines are colored by attacker's team color
- `last_attacker` tracks who sent the most recent/largest attack

---

## Attack System

### Attack Types

The attack system supports multiple attack modes:

```cpp
enum Attack_type {
    ATTACK_LINES,      // Send garbage lines (default FFA)
    ATTACK_NONE,       // Peace mode - no attacks
    ATTACK_BLIND,      // Temporarily blind opponent's blocks
    ATTACK_FULLBLIND,  // Fully blind opponent
    ATTACK_LAST
};

struct Attack {
    Attack_type type;
    int param;  // Blind duration or other parameters
};
```

**FFA Default:** Uses `ATTACK_LINES` for both normal and clean attacks.

### Attack Application

Different attack types are handled differently:

```cpp
if (attack.type == ATTACK_FULLBLIND) {
    // Blind all blocks for (nb * nc * param) frames
    blind_all(nb * nc * attack.param);
    return;
}

if (attack.type == ATTACK_BLIND) {
    // Blind individual garbage lines
    bon[x + bonus].blind_time = attack.param;
}

if (attack.type == ATTACK_LINES) {
    // Normal garbage line attack (FFA default)
    // Lines are added to bonus queue
}
```

---

## Networking Architecture

### Client-Server Model

Quadra uses a deterministic client-server architecture:

**Server Responsibilities:**
- Maintains authoritative game state
- Broadcasts all game events
- Handles player connections/disconnections
- Validates moves (in some modes)

**Client Responsibilities:**
- Send player inputs to server
- Process server packets
- Render local game state
- Handle local player controls

### Network Communication

#### TCP-Based Packet System

```cpp
class Net_connection {
    bool packet_based;      // True for game packets
    bool joined;            // Has joined the game
    uint32_t incoming_inactive;  // Frames since last packet
    uint32_t outgoing_inactive;  // Frames since sent packet

    virtual void sendtcp(Packet *p);
    virtual void receivetcp(Net_buf *p);
    virtual void commit();  // Flush buffered packets
};
```

**Key Packets for FFA:**

1. **P_LINES** - Garbage line packet
2. **P_STAT** - Player statistics update
3. **P_DEAD** - Player death notification
4. **P_RESPAWN** - Player respawn (survivor mode)
5. **P_DROPPLAYER** - Player disconnect
6. **P_SERVERSTATE** - Game state synchronization
7. **P_ENDGAME** - Game over signal

### Synchronization

The game uses a sync point system for determinism:

```cpp
uint8_t syncpoint;  // Current game state sync point

enum Canvas_State {
    PLAYING,
    WAITFORWINNER,
    WAITFORRESTART,
    LAST
};
```

**Server broadcasts state changes:**
```cpp
void Net_list::syncto(uint8_t syncpoint) {
    if (!game->server) return;
    if (this->syncpoint == syncpoint) return;

    this->syncpoint = syncpoint;
    Packet_serverstate ps;
    ps.state = syncpoint;
    net->dispatch(&ps, P_SERVERSTATE, loopback_connection);
}
```

### Lag Handling

The server monitors connection quality:

```cpp
// Drop laggy connections
if (game->server && lag_limit) {
    for (int i = 0; i < net->connections.size(); i++) {
        Net_connection *nc = net->connections[i];
        if (nc->incoming_inactive > lag_limit &&
            nc != game->loopback_connection &&
            nc->packet_based && nc->joined && !nc->trusted) {
            send_msg(nc, "Your connection has been dropped for exceeding the lag limit");
            nc->disconnect();
        }
    }
}
```

**Default lag_limit:** 3000 frames (50 seconds at 60 FPS)

---

## Player State Management

### Canvas (Player) Class

Each player is represented by a `Canvas` object:

```cpp
class Canvas {
    int player;           // Local player index
    int num_player;       // Network player index
    uint8_t color;        // Team color (0-5)
    int idle;             // Player state (0=playing, 1=waiting, 2=dead, 3=gone)
    bool dying;           // Currently dying animation
    bool local_player;    // Is this a local player?
    Net_connection *remote_adr;  // Remote connection (if remote)

    // Game board state
    bool occupied[36][18];   // Block occupancy
    uint8_t block[36][18];   // Block colors/sides
    uint8_t blinded[36][18]; // Blind timers
    uint8_t bflash[36][18];  // Flash animation timers

    // Garbage queue
    int bonus;            // Number of queued garbage lines
    Bonus bon[20];        // Garbage line data

    // Attack tracking
    uint8_t attacks[MAXPLAYERS];  // Attack amounts from each player
    uint8_t last_attacker;        // Most recent attacker

    // Game stats
    int level;
    int depth;            // Lines being cleared this move
    int complexity;       // Combo count
    CS stats[];           // Player statistics
};
```

### Player Idle States

```cpp
enum Idle_State {
    PLAYING = 0,    // Actively playing
    WAITING = 1,    // Waiting to start
    DEAD = 2,       // Dead (out of game)
    GONE = 3        // Disconnected but not dropped
};
```

### Frag Tracking

When a player dies, the last attacker gets a frag:

```cpp
// The player who sent the most recent/largest attack
// gets credit for the kill (frag)
if (last_attacker != 255) {
    Canvas *attacker = net_list.get(last_attacker);
    if (attacker) {
        attacker->stats[CS::FRAG].add(1);
    }
}

// Victim gets a death
victim->stats[CS::DEATH].add(1);
```

---

## Scoring and Win Conditions

### Score Calculation

Points are awarded based on lines cleared and combos:

```cpp
// Base score for lines cleared
switch (depth) {
    case 1: score_add = 250; break;
    case 2: score_add = 500; break;
    case 3: score_add = 1000; break;
    case 4: score_add = 2000; break;
    default: score_add = 200 * depth * depth; break;
}

// Combo bonus (version 23+)
int complexity_points = 200 * (complexity - 1) * (complexity - 1);
score_add += complexity_points;

// Clean bonus (version 23+)
if (send_for_clean && game->net_version() >= 23) {
    int clean_points;
    if (depth <= 4)
        clean_points = depth * 1250;
    else
        clean_points = depth * depth * 500;
    score_add += clean_points;
}

// Level multiplier
score_add += (score_add / 10) * level;
```

### Win Condition Checking

The game checks for winners in `Net_list::check_end_game()`:

```cpp
// Check frag-based win
if (game->game_end == END_FRAG) {
    uint8_t leading_team = score.team_order[0];
    int leading_total = score.team_stats[leading_team].stats[CS::FRAG].get_value();

    if (leading_total >= game->game_end_value) {
        // Check for draws
        uint8_t second_team = score.team_order[1];
        int second_total = score.team_stats[second_team].stats[CS::FRAG].get_value();

        if (leading_total == second_total) {
            message(-1, "Game tied!");
        } else {
            send_end_signal(true);  // End the game
        }
    }
}
```

### Objective Announcements

The game announces progress toward goals:

```cpp
static int frag_objectives[] = {
    20, 10, 5, 4, 3, 2, 1, 0  // Announce at these remaining counts
};

int Net_list::check_goals(uint8_t team, int remain) {
    for (int *i = objectives; *i && remain <= *i; i++) {
        if (!reached[i - objectives][team]) {
            reached[i - objectives][team] = true;
            return *i;  // Announce this goal
        }
    }
    return 0;
}
```

**Example:** "Red team: 5 frags remaining!"

---

## Implementation Checklist

### Core Systems

- [ ] **Game State Manager**
  - [ ] Game modes (FFA, Survivor, Peace, etc.)
  - [ ] Game end conditions (frags, time, points, lines)
  - [ ] Pause/unpause functionality
  - [ ] Game restart capability

- [ ] **Player/Canvas System**
  - [ ] Player state management (playing, waiting, dead, gone)
  - [ ] Tetris board (10x20 playfield)
  - [ ] Block placement and collision detection
  - [ ] Line clearing detection
  - [ ] Statistics tracking (frags, deaths, score, lines)

### Garbage Line System

- [ ] **Line Calculation**
  - [ ] Base formula: `garbage_lines = lines_cleared - 1`
  - [ ] Minimum combo check (default: 2 lines)
  - [ ] Clean bonus calculation
  - [ ] Combo multiplier support

- [ ] **Garbage Queue**
  - [ ] Bonus array (max 20 lines)
  - [ ] Hole position encoding (10-bit per line)
  - [ ] Color-coded by attacker
  - [ ] FIFO queue processing

- [ ] **Garbage Application**
  - [ ] Push board up when adding lines
  - [ ] Apply hole pattern from encoded data
  - [ ] Handle overflow (game over)

### Attack System

- [ ] **Attack Types**
  - [ ] ATTACK_LINES (standard garbage)
  - [ ] ATTACK_NONE (peace mode)
  - [ ] ATTACK_BLIND (optional)
  - [ ] ATTACK_FULLBLIND (optional)

- [ ] **Attack Tracking**
  - [ ] Track attacks from each opponent
  - [ ] Last attacker determination
  - [ ] Frag attribution on death

### Networking

- [ ] **Client-Server Architecture**
  - [ ] TCP-based packet system
  - [ ] Connection management
  - [ ] Join/leave handling
  - [ ] Lag monitoring

- [ ] **Packet Types**
  - [ ] P_LINES (garbage lines)
  - [ ] P_STAT (statistics sync)
  - [ ] P_DEAD (death notification)
  - [ ] P_DROPPLAYER (disconnect)
  - [ ] P_SERVERSTATE (sync points)
  - [ ] P_ENDGAME (game over)

- [ ] **Synchronization**
  - [ ] Deterministic game logic
  - [ ] Input prediction (optional)
  - [ ] State reconciliation
  - [ ] Sync point system

### Scoring & Win Conditions

- [ ] **Score Calculation**
  - [ ] Base line clear scores
  - [ ] Combo bonuses
  - [ ] Clean bonuses
  - [ ] Level multipliers

- [ ] **Statistics**
  - [ ] Frags (kills)
  - [ ] Deaths
  - [ ] Total score
  - [ ] Lines cleared
  - [ ] Playing time

- [ ] **Win Detection**
  - [ ] Frag limit
  - [ ] Time limit
  - [ ] Points limit
  - [ ] Lines limit
  - [ ] Draw detection

### UI & Feedback

- [ ] **Visual Feedback**
  - [ ] Garbage line color coding
  - [ ] Attack indicators
  - [ ] Score popups
  - [ ] Combo displays

- [ ] **Audio Feedback**
  - [ ] Line clear sounds
  - [ ] Attack sent sounds
  - [ ] Garbage received sounds
  - [ ] Victory/defeat sounds

- [ ] **HUD Elements**
  - [ ] Score display
  - [ ] Frag count
  - [ ] Game timer
  - [ ] Objective progress

---

## Advanced Features

### Handicap System (Version 24+)

```cpp
// Reduce garbage sent based on skill difference
while (p.nb && sender->handicaps[receiver_id] >= stamp_per_handicap) {
    p.nb--;
    sender->handicaps[receiver_id] -= stamp_per_handicap;
}
```

**Handicap Levels:**
- 0: Beginner (-)
- 1: Apprentice (A)
- 2: Intermediate (I) - Default
- 3: Master (M)
- 4: Grand Master (+)

### PPM (Points Per Minute) Limiting

```cpp
// Drop players exceeding skill limit
if (c->stats[CS::PLAYING_TIME].get_value() >= 24000) {  // 4 minutes
    uint32_t ppm = c->stats[CS::SCORE].get_value();
    if (ppm > 4 * ppm_limit) {
        server_drop_player(i, DROP_AUTO);
    }
}
```

### Recording & Playback

The game supports demo recording:

```cpp
void Game::prepare_recording(const char *filename) {
    recording = new Recording();
    recording->create(filename);

    Packet_gameserver p;
    Net_pendingjoin::load_packet_gameserver(&p);
    recording->start_for_multi(&p);
}
```

**Logged Events:**
- Player joins/leaves
- Line clears
- Attacks sent/received
- Deaths
- Game state changes

---

## Implementation Tips

### 1. Start Simple
Begin with:
- Single local multiplayer (2-4 players on same machine)
- Basic garbage line system (lines - 1)
- Simple scoring
- Manual game end

### 2. Add Networking Incrementally
- Implement packet system
- Add client-server architecture
- Implement state synchronization
- Add lag compensation

### 3. Balance Gameplay
- Adjust `combo_min` (minimum lines to attack)
- Tune clean bonus multiplier
- Consider player count adjustments (v23 style)
- Implement handicap system for mixed skill levels

### 4. Optimize for Responsiveness
- Predict local player moves
- Buffer network packets
- Use delta compression for updates
- Implement interpolation for remote players

### 5. Testing Considerations
- Test with various latencies (50ms, 100ms, 200ms+)
- Test with packet loss
- Test with different player counts (2, 4, 6, 8)
- Test all win conditions
- Test reconnection scenarios

---

## Critical Implementation Details

### 1. Determinism

**Why:** Client and server must compute identical results

**How:**
- Use same RNG seed for all clients
- Process inputs in same order
- Use fixed-point math (avoid floating point)
- Sync critical events (line clears, garbage)

### 2. Input Buffering

**Why:** Network delay requires buffering inputs

**How:**
```cpp
void Canvas::start_moves() {
    if (game->wants_moves) {
        moves = new Packet_clientmoves();
        moves->player = num_player;
    }
}

void Canvas::send_p_moves() {
    if (game->wants_moves && moves) {
        net->sendtcp(moves);
        delete moves;
        moves = NULL;
    }
}
```

### 3. Attack Attribution

**Why:** Must correctly credit frags to attackers

**How:**
```cpp
// Track cumulative attacks
int temp = attacks[qui] + nb * 2;
if (temp > 255) temp = 255;
attacks[qui] = temp;

// Update most dangerous attacker
if (attacks[qui] >= attacks[last_attacker])
    last_attacker = qui;

// On death, award frag to last_attacker
```

### 4. Team vs FFA

**Key Difference:** Team mode only sends garbage to OTHER teams

```cpp
// Skip same-team attacks
if (receiver->color == sender->color) continue;
```

FFA: Each player is their own team (different colors)

---

## Performance Considerations

### Network Bandwidth

**Typical packet sizes:**
- P_LINES: ~40 bytes
- P_STAT: 20-100 bytes (variable)
- P_SERVERSTATE: ~10 bytes

**Optimization:**
- Batch stat updates (every 1500 frames)
- Delta-compress statistics
- Use bit packing for moves

### Server Load

**Per-player overhead:**
- State tracking: ~4KB
- Network buffering: ~8KB
- Statistics: ~1KB

**8-player game:** ~104KB total state

---

## Common Pitfalls

### 1. Desync Issues
- Not using consistent RNG seeds
- Floating-point arithmetic differences
- Different packet processing order
- Client-side prediction errors

### 2. Attack Attribution Bugs
- Not clearing attack counters properly
- Race conditions on death packets
- Multiple attackers edge cases

### 3. Network Issues
- Not handling disconnections gracefully
- Memory leaks in packet buffers
- Unbounded queue growth
- No lag compensation

### 4. Gameplay Balance
- Too easy to send garbage (low combo_min)
- Too hard to clear garbage
- Unfair clean bonuses
- Snowballing (rich get richer)

---

## Conclusion

Implementing FFA multiplayer for a Tetris game requires:

1. **Solid core Tetris mechanics** (block placement, line clearing)
2. **Robust garbage line system** (calculation, queuing, application)
3. **Reliable networking** (client-server, packets, sync)
4. **Fair attack attribution** (tracking, frag awarding)
5. **Flexible win conditions** (frags, time, points, lines)

The Quadra implementation demonstrates a complete, battle-tested system that has supported competitive online play. Use this guide as a reference for the critical systems, but adapt the specific formulas and values to match your game's intended feel and balance.

**Key Takeaway:** Start with the garbage line calculation and attack distribution system first. Get that working locally with 2-4 players before adding networking complexity. Once the core gameplay feels right, layer on the client-server architecture.

Good luck with your implementation!
