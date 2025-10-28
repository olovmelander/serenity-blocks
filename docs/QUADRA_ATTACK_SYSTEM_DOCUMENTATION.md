# Quadra Attack/Garbage System - Complete Technical Documentation

**Version:** Based on Quadra source code (net_version 24 compatible)
**Purpose:** Complete specification for recreating Quadra's attack/garbage system in Serenity Blocks
**Date:** 2025-10-10

---

## Table of Contents
1. [Overview](#overview)
2. [Core Data Structures](#core-data-structures)
3. [Attack Types](#attack-types)
4. [Line Clearing and Attack Calculation](#line-clearing-and-attack-calculation)
5. [Attack Transmission and Routing](#attack-transmission-and-routing)
6. [Garbage Queue Management](#garbage-queue-management)
7. [Garbage Insertion Algorithm](#garbage-insertion-algorithm)
8. [Handicap System](#handicap-system)
9. [Network Versioning](#network-versioning)
10. [Special Game Modes](#special-game-modes)
11. [Implementation Checklist](#implementation-checklist)

---

## 1. Overview

Quadra's attack system converts cleared lines into "garbage" (also called "bonus lines" or "attack lines") that are sent to opponents. The system supports multiple attack types (lines, blind, full-blind) and includes handicap balancing, team-based routing, and special game modes.

**Key Flow:**
```
Player clears lines → Calculate attack → Route to opponents → Queue in receiver's bonus array → Insert garbage into playfield
```

---

## 2. Core Data Structures

### 2.1 Attack Structure
**File:** `source/attack.h`

```cpp
enum Attack_type {
    ATTACK_LINES,      // Standard garbage lines
    ATTACK_NONE,       // No attack (peace mode)
    ATTACK_BLIND,      // Garbage lines + blindness effect
    ATTACK_FULLBLIND,  // Pure blindness (no lines)
    ATTACK_LAST
};

struct Attack {
    Attack_type type;
    int param;         // Blind duration (frames) for BLIND/FULLBLIND

    Attack() : type(ATTACK_LINES), param(0) {}
};
```

**Usage:**
- `game->normal_attack`: Default attack for regular line clears
- `game->clean_attack`: Attack for "clean" clears (clearing entire playfield)
- `game->potato_normal_attack`: Attack in hot potato mode (potato team only)
- `game->potato_clean_attack`: Clean attack in hot potato mode

### 2.2 Bonus Queue Structure
**File:** `source/canvas.h` (lines 102-108)

```cpp
struct {
    uint8_t x;           // Hole position (deprecated in net_version >= 23)
    uint8_t color;       // Attacker's team color
    uint8_t blind_time;  // Frames of blindness per block (0 = no blind)
    uint16_t hole_pos;   // 10-bit field encoding hole positions
    bool final;          // True if last line in packet (net_version >= 23)
} bon[20];              // Maximum 20 queued garbage lines
```

**Canvas Members:**
```cpp
uint8_t bonus;          // Number of lines currently queued (0-20)
uint8_t attacks[MAXPLAYERS];     // Attack counter from each player (0-255)
uint8_t last_attacker;           // Player number of strongest attacker (255=none)
uint8_t handicaps[MAXPLAYERS];   // Handicap stamps per opponent
uint8_t handicap_crowd;          // Crowd-based handicap stamps
```

### 2.3 Canvas Grid
**File:** `source/canvas.h` (lines 93-96)

```cpp
bool occupied[36][18];   // Block presence grid
uint8_t block[36][18];   // Block data (low 4 bits: sides, high 4 bits: color)
uint8_t blinded[36][18]; // Remaining blind frames per block (0-255)
uint8_t bflash[36][18];  // Blind flash animation counter
bool moved[36][18];      // Tracks which blocks moved this stamp
```

**Grid Layout:**
- **Total:** 36 rows × 18 columns
- **Playfield:** Rows 12-31 (20 visible rows), Columns 4-13 (10 playable columns)
- **Side walls:** Columns 0-3 and 14-17
- **Floor:** Rows 32-35
- **Spawn zone:** Rows 0-11 (above visible area)

**Coordinate System:**
```
Row  0-11:  Spawn zone (invisible)
Row 12-31:  Visible playfield (20 rows)
Row 32-35:  Floor boundary
Col  0-3:   Left wall
Col  4-13:  Playfield (10 columns)
Col 14-17:  Right wall
```

---

## 3. Attack Types

### 3.1 ATTACK_LINES (Standard Garbage)
- **Behavior:** Sends garbage lines to opponent's queue
- **Effect:** Lines inserted at bottom of playfield with holes
- **param:** Ignored (set to 0)

### 3.2 ATTACK_NONE (Peace Mode)
- **Behavior:** No attack sent, used in non-competitive modes
- **Effect:** Nothing happens
- **param:** Ignored

### 3.3 ATTACK_BLIND (Blind Garbage)
- **Behavior:** Sends garbage lines that blind existing blocks on insertion
- **Effect:** Garbage lines + blindness applied to placed blocks
- **param:** Frames of blindness per block (e.g., 300 frames = 5 seconds at 60fps)

**Blindness Mechanics:**
- When blind garbage is placed, the blocks it creates have `blinded[j][i] = blind_time`
- Each frame, if `!(overmind.framecount & 15)` (every 16 frames), decrement `blinded[j][i]`
- When `blinded[j][i]` reaches 0, trigger flash animation: `bflash[j][i] = 24`
- Blinded blocks are not drawn (background shown instead)

### 3.4 ATTACK_FULLBLIND (Pure Blindness)
- **Behavior:** Sends pure blindness with no garbage lines
- **Effect:** Blinds existing blocks on playfield (no line insertion)
- **param:** Frames of blindness per block
- **Calculation:** `nb * nc * param` frames applied to all occupied blocks

**Full Blind Application (canvas.cc:430-432):**
```cpp
if(attack.type == ATTACK_FULLBLIND) {
    blind_all(nb * nc * attack.param);
    return;
}
```

**blind_all() Implementation (canvas.cc:382-398):**
```cpp
void Canvas::blind_all(uint8_t time) {
    if(idle < 2 && !dying) {
        for(int y = 0; y < 36; y++)
            for(int x = 0; x < 18; x++) {
                int tmp = blinded[y][x];
                if(occupied[y][x]) {
                    if(!tmp && time) {
                        bflash[y][x] = 32;   // Flash animation
                        dirted[y][x] = 2;     // Mark for redraw
                    }
                    tmp = min(255, tmp + time);
                    blinded[y][x] = tmp;
                }
            }
    }
}
```

---

## 4. Line Clearing and Attack Calculation

### 4.1 Line Clear Detection
**File:** `source/player.cc` (Player_check_line::check_nb_line, lines 554-582)

**Algorithm:**
```cpp
int co = 0;  // Count of cleared lines
for(int j = 12; j < 32; j++) {  // Check visible rows
    // Check if all 10 playfield columns are occupied
    for(int i = 4; i < 14; i++)
        if(!canvas->occupied[j][i])
            break;

    if(i == 14) {  // Full line found
        if(co < 20)
            canvas->flash[co] = j;  // Store row for flash animation

        // Mark adjacent blocks for visual update
        for(int i = 4; i < 14; i++) {
            if(canvas->occupied[j-1][i] && !(canvas->block[j-1][i] & 8))
                canvas->block[j-1][i] |= 8;  // Add bottom edge to block above

            // Store hole positions for attack transmission
            hole_pos[canvas->depth + co][i] = canvas->moved[j][i];

            // Clear the line
            canvas->block[j][i] = 0;
            canvas->occupied[j][i] = false;
            canvas->blinded[j][i] = 0;
            canvas->bflash[j][i] = 0;

            if(canvas->occupied[j+1][i] && !(canvas->block[j+1][i] & 2))
                canvas->block[j+1][i] |= 2;  // Add top edge to block below
        }
        co++;
    }
}
canvas->depth += co;  // Add to current combo depth
canvas->complexity++; // Increment combo counter
```

**Block Side Bits (block[j][i] & 15):**
```
Bit 0 (1): Left edge
Bit 1 (2): Top edge
Bit 2 (4): Right edge
Bit 3 (8): Bottom edge
```

### 4.2 Clean Detection
**File:** `source/player.cc` (Player_check_line::check_clean, lines 585-595)

```cpp
void check_clean() {
    // Check if entire playfield is empty
    for(int j = 12; j < 32; j++)
        for(int i = 4; i < 14; i++)
            if(canvas->occupied[j][i])
                return;  // Not clean

    canvas->send_for_clean = true;
    if(game->net_version() < 23)
        canvas->stats[CS::SCORE].add(5000);  // Old version bonus
}
```

### 4.3 Attack Calculation
**File:** `source/canvas.cc` (Canvas::give_line, lines 477-648)

**Key Variables:**
- `depth`: Number of lines cleared in current combo (1-4+)
- `complexity`: Combo count (number of consecutive clears without piece placement)
- `send_for_clean`: Boolean, true if playfield is empty after clear
- `combo_min`: Minimum lines required to send attack (game setting)

**Attack Line Calculation:**

```cpp
int i = depth - 1;  // Base attack lines

// 1. Apply alive player penalty (net_version == 23 only)
if(game->net_version() == 23) {
    int alive_count = 0;
    for(int i = 0; i < MAXPLAYERS; i++) {
        Canvas *c = game->net_list.get(i);
        if(c && c->idle < 2)
            alive_count++;
    }
    if(alive_count > 4)
        alive_count -= 4;
    else
        alive_count = 0;
    i = max(0, depth - 1 - alive_count);
    enough = i ? true : false;  // BUG: should check >= combo_min
}

// 2. Apply crowd handicap (net_version >= 24)
if(game->net_version() >= 24) {
    if(!send_for_clean && !game->boring_rules) {
        while(i && handicap_crowd >= stamp_per_handicap) {
            handicap_crowd -= stamp_per_handicap;
            i--;
        }
    }
    if(!i)
        enough = false;
}

// 3. Check combo_min threshold
bool enough = (depth >= game->combo_min);

// 4. Calculate clean bonus
int clean_bonus = 0;
if(send_for_clean)
    clean_bonus = (1 + depth) / 2;  // Integer division
```

**Attack Line Formulas:**

| Lines Cleared | Base Attack | Clean Bonus | Total (Clean) |
|--------------|-------------|-------------|---------------|
| 1 (Single)   | 0           | 1           | 1             |
| 2 (Double)   | 1           | 1           | 2             |
| 3 (Triple)   | 2           | 2           | 4             |
| 4 (Quad)     | 3           | 2           | 5             |
| 5            | 4           | 3           | 7             |
| 6            | 5           | 3           | 8             |

**Score Calculation (canvas.cc:510-530):**
```cpp
int score_add;
switch(depth) {
    case 1: score_add = 250; break;
    case 2: score_add = 500; break;
    case 3: score_add = 1000; break;
    case 4: score_add = 2000; break;
    default: score_add = 200 * depth * depth; break;
}

int complexity_points;
if(game->net_version() >= 23)
    complexity_points = 200 * (complexity - 1) * (complexity - 1);
else
    complexity_points = 1000 * (complexity - 1);
score_add += complexity_points;

if(send_for_clean && game->net_version() >= 23) {
    int clean_points;
    if(depth <= 4)
        clean_points = depth * 1250;
    else
        clean_points = depth * depth * 500;
    score_add += clean_points;
}

score_add += (score_add / 10) * level;  // Level bonus
```

### 4.4 Hole Position Encoding
**File:** `source/net_list.cc` (Net_list::send, lines 122-133)

**⚠️ CRITICAL IMPLEMENTATION DETAIL ⚠️**

The garbage hole system is **NOT** random! It uses a sophisticated mechanism where:

1. **The position of your placed piece determines the holes in the garbage you send**
2. Cells where your current piece landed → become holes in your attack
3. Cells in cleared lines WITHOUT your piece → become solid blocks (harder garbage)

This creates deep strategic gameplay:
- Horizontal I-piece clears → 4 holes per line (easier for opponent)
- Clearing lines below your piece → 0 holes (brutal garbage!)
- T-spins and clever placements → controls garbage quality

**CRITICAL: Understanding the `moved[][]` Array**

The hole position encoding uses `canvas->moved[j][i]` which tracks **which blocks from the currently placed piece exist in each cell**. This is NOT about holes in the garbage line itself, but rather which cells of the current piece are at each position.

**When `moved[]` is Set:**
- **Location:** `source/player.cc` (Player_stamp::init, line 1504)
- **Timing:** When a piece is stamped (locked in place)
- **Purpose:** Mark which cells contain blocks from the newly placed piece

```cpp
// During piece placement
for(int j = 0; j < 4; j++)
    for(int i = 0; i < 4; i++) {
        int t = canvas->bloc->bloc[...][j][i];
        if(t) {
            // ... place the block ...
            canvas->moved[canvas->bloc->by+j][canvas->bloc->bx+i] = true;
        }
    }
```

**When `moved[]` is Read for Line Clears:**
- **Location:** `source/player.cc` (Player_check_line::check_nb_line, line 568)
- **Timing:** During line clearing, BEFORE `moved[]` is cleared
- **Purpose:** Store which positions of the cleared line had blocks from the last piece

```cpp
for(j = 12; j < 32; j++) {
    // Check if line is full
    if(all_columns_occupied) {
        for(int i = 4; i < 14; i++) {
            // CRITICAL: Store moved state for this cleared line
            hole_pos[canvas->depth+co][i] = canvas->moved[j][i];

            // Then clear the line
            canvas->block[j][i] = 0;
            canvas->occupied[j][i] = false;
        }
    }
}
```

**When `moved[]` is Cleared:**
- **Location:** `source/canvas.cc` (Canvas::clear_tmp, lines 801-803)
- **Timing:** After line clearing animation completes (Player_flash_lines) or after garbage insertion
- **Purpose:** Reset for next piece

```cpp
void Canvas::clear_tmp() {
    for(int j = 0; j < 36; j++)
        for(int i = 0; i < 18; i++)
            moved[j][i] = false;
}
```

**Complete Hole Position Flow:**

The system uses TWO arrays to track hole positions:

1. **`Player_check_line::hole_pos[36][18]`** - Local temporary array (bool)
   - Stores which cells in cleared lines had blocks from the current piece
   - Lives only during line clearing operation

2. **`Canvas::moved[36][18]`** - Canvas-persistent array (bool)
   - Receives copy of hole_pos data after line clearing
   - Used by Net_list::send() to encode holes into packets

**Step-by-Step Flow:**

```cpp
// STEP 1: Piece Placement (player.cc:1504)
// When piece is stamped, mark which cells it occupies
for(int j = 0; j < 4; j++)
    for(int i = 0; i < 4; i++) {
        if(bloc[j][i]) {
            canvas->moved[by+j][bx+i] = true;  // Mark piece location
        }
    }

// STEP 2: Line Clearing (player.cc:568)
// During line detection, copy moved state to temporary hole_pos array
for(j = 12; j < 32; j++) {
    if(line_is_full) {
        for(i = 4; i < 14; i++) {
            // Store: "did the current piece have a block here?"
            hole_pos[canvas->depth + co][i] = canvas->moved[j][i];

            // Clear the line
            canvas->occupied[j][i] = false;
        }
        co++;  // Count cleared lines
    }
}

// STEP 3: Copy to Canvas (player.cc:541-543)
// After line counting, copy hole_pos back to canvas->moved
for(j = 0; j < 36; j++)
    for(i = 0; i < 18; i++)
        canvas->moved[j][i] = hole_pos[j][i];

// STEP 4: Encode for Network (net_list.cc:128-132)
// In Net_list::send(), encode moved array into 10-bit bitfields
for(int j = 0; j < nb; j++) {  // For each line to send (j = line INDEX, not row!)
    p.hole_pos[j] = 0;

    if(clean) {
        p.hole_pos[j] = (j & 1) ? 585 : 72;  // Crappy clean holes
        continue;
    }

    // CRITICAL: j is the line INDEX (0-based), not the grid row number!
    // After step 3, canvas->moved[0][i] contains data for the FIRST cleared line,
    //              canvas->moved[1][i] contains data for the SECOND cleared line, etc.
    // Encode the 10 playfield columns into 10 bits
    for(int i = 4; i < 14; i++) {  // Columns 4-13
        p.hole_pos[j] <<= 1;               // Shift left
        if(canvas->moved[j][i])            // If piece was at column i in line j
            p.hole_pos[j] |= 1;            // Set bit (= create hole)
    }
}

// STEP 5: Clear for Next Piece (canvas.cc:803)
// After line clearing animation or garbage insertion
void Canvas::clear_tmp() {
    for(int j = 0; j < 36; j++)
        for(int i = 0; i < 18; i++)
            moved[j][i] = false;  // Reset all
}
```

**KEY INSIGHT:**
The variable name `hole_pos` in the temporary array is somewhat misleading. It actually stores **"piece positions in cleared lines"**, which then becomes **"hole positions in sent garbage"** through the inverse mapping.

**IMPORTANT CLARIFICATION:**
The `moved[][]` array creates an **inverse mapping**:
- `moved[j][i] = true` means "this cell contained a block from the current piece"
- When encoded, `moved[j][i] = true` becomes a **1 bit**, indicating a **hole** in the garbage
- When decoded, a **1 bit** means "create a hole here in the garbage line"

This is the key mechanism: **wherever your piece touched when it landed becomes a hole in the garbage you send**. This creates strategic gameplay because:
1. If you place a piece horizontally, it creates more holes in your attacks
2. If you place a piece vertically, it creates fewer holes (harder garbage)
3. The shape and position of your last piece directly affects garbage quality

**Bit Encoding (10-bit field, MSB first):**
```
Bit 9: Column 4 (leftmost)   → moved[j][4]
Bit 8: Column 5              → moved[j][5]
Bit 7: Column 6              → moved[j][6]
Bit 6: Column 7              → moved[j][7]
Bit 5: Column 8              → moved[j][8]
Bit 4: Column 9              → moved[j][9]
Bit 3: Column 10             → moved[j][10]
Bit 2: Column 11             → moved[j][11]
Bit 1: Column 12             → moved[j][12]
Bit 0: Column 13 (rightmost) → moved[j][13]
```

**Clean Holes (Alternating Pattern):**
```
Even lines (j & 1 == 0): 72  = 0b0001001000 = holes at columns 5, 8
Odd lines  (j & 1 == 1): 585 = 0b1001001001 = holes at columns 4, 7, 10, 13
```

**Detailed Example Scenario:**

Imagine a player places an I-piece (horizontal) and clears two lines:

```
Initial grid state at rows 30-31:
Row 31: [X][X][X][_][_][_][_][X][X][X]  (columns 4-13)
Row 30: [X][X][X][X][X][X][_][_][X][X]

Player places I-piece horizontally at row 31, columns 6-9:
Row 31: [X][X][X][I][I][I][I][X][X][X]  (now full!)
Row 30: [X][X][X][X][X][X][_][_][X][X]

STEP 1: Piece placement (player.cc:1504)
  moved[31][6] = true
  moved[31][7] = true
  moved[31][8] = true
  moved[31][9] = true
  (all other moved[][] = false from previous clear_tmp)

Blocks fall down, filling row 30:
Row 30: [X][X][X][X][X][X][X][X][X][X]  (now full!)

STEP 2: Line clearing check (player.cc:568)
  depth = 0 initially
  co = 0 (cleared line counter)

  j=30: Line is full!
    for i=4 to 13:
      hole_pos[depth+co][i] = moved[30][i]
      // Since no piece blocks are at row 30, all are false
      hole_pos[0][4..13] = [false, false, false, false, false, false, false, false, false, false]
    co++ → co=1
    depth stays 0

  j=31: Line is full!
    for i=4 to 13:
      hole_pos[depth+co][i] = moved[31][i]
      // I-piece blocks are at columns 6-9
      hole_pos[1][4] = false
      hole_pos[1][5] = false
      hole_pos[1][6] = true   ← I-piece
      hole_pos[1][7] = true   ← I-piece
      hole_pos[1][8] = true   ← I-piece
      hole_pos[1][9] = true   ← I-piece
      hole_pos[1][10] = false
      hole_pos[1][11] = false
      hole_pos[1][12] = false
      hole_pos[1][13] = false
    co++ → co=2

  depth += co → depth=2

STEP 3: Copy to canvas->moved (player.cc:541-543)
  for j=0 to 35:
    for i=0 to 17:
      canvas->moved[j][i] = hole_pos[j][i]

  Result:
    moved[0][4..13] = [F, F, F, F, F, F, F, F, F, F]  ← Line 0 (row 30)
    moved[1][4..13] = [F, F, T, T, T, T, F, F, F, F]  ← Line 1 (row 31)
    moved[2+][*] = all false

STEP 4: Encode for network (net_list.cc:128-132)
  nb = 2 (base attack from depth=2 is 2-1=1, but let's say it's 2 with bonuses)

  For j=0 (first cleared line, originally row 30):
    p.hole_pos[0] = 0
    for i=4 to 13:
      p.hole_pos[0] <<= 1
      if(moved[0][i]) → all false
        p.hole_pos[0] |= 1
    Result: p.hole_pos[0] = 0b0000000000 = 0

  For j=1 (second cleared line, originally row 31):
    p.hole_pos[1] = 0
    i=4:  p.hole_pos[1] = 0b0000000000, moved[1][4]=F, stays 0b0000000000
    i=5:  p.hole_pos[1] = 0b0000000000, moved[1][5]=F, stays 0b0000000000
    i=6:  p.hole_pos[1] = 0b0000000000, moved[1][6]=T, becomes 0b0000000001
    i=7:  p.hole_pos[1] = 0b0000000010, moved[1][7]=T, becomes 0b0000000011
    i=8:  p.hole_pos[1] = 0b0000000110, moved[1][8]=T, becomes 0b0000000111
    i=9:  p.hole_pos[1] = 0b0000001110, moved[1][9]=T, becomes 0b0000001111
    i=10: p.hole_pos[1] = 0b0000011110, moved[1][10]=F, stays 0b0000011110
    i=11: p.hole_pos[1] = 0b0000111100, moved[1][11]=F, stays 0b0000111100
    i=12: p.hole_pos[1] = 0b0001111000, moved[1][12]=F, stays 0b0001111000
    i=13: p.hole_pos[1] = 0b0011110000, moved[1][13]=F, stays 0b0011110000
    Result: p.hole_pos[1] = 0b0011110000 = 240

OPPONENT RECEIVES GARBAGE:
  Line 0: hole_pos=0 (0b0000000000)
    All columns 4-13 are SOLID → Very difficult garbage!
    [■][■][■][■][■][■][■][■][■][■]

  Line 1: hole_pos=240 (0b0011110000)
    Reading MSB first:
    Bit 9=0 → col 4 = SOLID
    Bit 8=0 → col 5 = SOLID
    Bit 7=1 → col 6 = HOLE
    Bit 6=1 → col 7 = HOLE
    Bit 5=1 → col 8 = HOLE
    Bit 4=1 → col 9 = HOLE
    Bit 3=0 → col 10 = SOLID
    Bit 2=0 → col 11 = SOLID
    Bit 1=0 → col 12 = SOLID
    Bit 0=0 → col 13 = SOLID
    [■][■][_][_][_][_][■][■][■][■]

KEY LESSON:
- The first line (row 30) had NO pieces from the current stamp → NO holes → BRUTAL garbage
- The second line (row 31) had the I-piece → 4 holes → EASIER garbage
- Strategic implication: Clearing lines WITHOUT your current piece creates harder garbage!
```

---

## 5. Attack Transmission and Routing

### 5.1 Attack Dispatch
**File:** `source/canvas.cc` (lines 571-614)

```cpp
Attack clean_att, normal_att;
normal_att = game->normal_attack;
clean_att = game->clean_attack;

// Hot potato override
if(game->hot_potato && color == game->potato_team) {
    normal_att = game->potato_normal_attack;
    clean_att = game->potato_clean_attack;
}

// Send clean attack
if(send_for_clean) {
    game->net_list.send(this, clean_bonus, complexity, last_x, clean_att, true);
}

// Send normal attack
if(i && enough) {
    game->net_list.send(this, i, complexity, last_x, normal_att, false);
}
```

### 5.2 Attack Routing
**File:** `source/net_list.cc` (Net_list::send, lines 112-204)

**Routing Rules:**

1. **NULL Check:** Skip null canvases
2. **Local Only:** Only send to local canvases (remote send their own packets)
3. **Team Filter:** Skip same-team members (`receiver->color == sender->color`)
4. **Hot Potato Filter:**
   - If hot potato mode active and potato team exists at stamp time
   - Attack only sent if sender OR receiver is on potato team
   - If neither is on potato team, skip

**Routing Code:**
```cpp
for(int i = 0; i < MAXPLAYERS; i++) {
    Canvas *receiver = get(i);

    // Skip null or remote canvases
    if(!receiver || !receiver->islocal())
        continue;

    // Skip same team
    if(receiver->color == sender->color)
        continue;

    // Hot potato filtering
    if(game->hot_potato) {
        uint8_t potato_team = sender->potato_team_on_last_stamp;
        if(potato_team == 255)
            continue;  // No potato team, don't send
        if(receiver->color != potato_team && sender->color != potato_team)
            continue;  // Neither on potato team
    }

    // Apply handicap and send
    // (See Handicap System section)
}
```

### 5.3 Attack Reception
**File:** `source/canvas.cc` (Canvas::add_packet, lines 400-475)

```cpp
void Canvas::add_packet(Canvas *sender, uint8_t nb, uint8_t nc,
                        uint8_t lx, Attack attack, uint16_t hole_pos[]) {
    if(!sender)
        return;

    // Log attack
    Packet_serverlog log("player_attacked");
    log.add(Packet_serverlog::Var("id", id()));
    log.add(Packet_serverlog::Var("attacker_id", sender->id()));
    log.add(Packet_serverlog::Var("type", attack.log_type()));
    log.add(Packet_serverlog::Var("size",
        attack.type == ATTACK_FULLBLIND ? nb * nc : nb));

    // Nothing if ATTACK_NONE
    if(attack.type == ATTACK_NONE)
        return;

    // Update attacker tracking
    int qui = game->net_list.canvas2player(sender);
    int temp = attacks[qui] + nb * 2;
    if(temp > 255)
        temp = 255;
    attacks[qui] = temp;

    if(last_attacker != 255) {
        if(attacks[qui] >= attacks[last_attacker])
            last_attacker = qui;
    } else {
        last_attacker = qui;
    }

    // Full blind handling
    if(attack.type == ATTACK_FULLBLIND) {
        blind_all(nb * nc * attack.param);
        return;
    }

    // Queue garbage lines
    if(bonus < 20) {
        if(nb + bonus > 20)
            nb = 20 - bonus;  // Cap at queue size

        nc--;  // Complexity decrement (legacy)
        int normal = max(nb - nc, 0);
        int fucked = nb - normal;

        // Modern version (net_version >= 23)
        if(game->net_version() >= 23) {
            for(int x = 0; x < nb; x++) {
                bon[x + bonus].x = 127;  // Magic value
                bon[x + bonus].color = sender->color;
                bon[x + bonus].blind_time =
                    (attack.type == ATTACK_BLIND) ? attack.param : 0;
                bon[x + bonus].hole_pos = hole_pos[x];
                bon[x + bonus].final = (x == nb - 1);
            }
            bonus += nb;
        }

        // Legacy version (net_version < 23)
        if(game->net_version() < 23) {
            // Uses lx (last_x) and nc for hole positioning
            // (See Legacy section below)
        }
    }
}
```

**Legacy Hole Positioning (net_version < 23):**
```cpp
int normal = max(nb - nc, 0);
int fucked = nb - normal;

// Normal lines (hole at lx)
for(int x = 0; x < normal; x++) {
    bon[x + bonus].x = lx;
    bon[x + bonus].color = sender->color;
    bon[x + bonus].blind_time = (attack.type == ATTACK_BLIND) ? attack.param : 0;
}
bonus += normal;

// "Fucked" lines (hole shifts by nc each line)
for(int x = 0; x < fucked; x++) {
    lx += nc;
    while(lx > 13)
        lx -= 10;
    bon[x + bonus].x = lx;
    bon[x + bonus].color = sender->color;
    bon[x + bonus].blind_time = (attack.type == ATTACK_BLIND) ? attack.param : 0;
}
bonus += fucked;
```

---

## 6. Garbage Queue Management

### 6.1 Queue Properties
- **Max Size:** 20 lines
- **Overflow:** Lines beyond 20 are discarded
- **Processing:** FIFO (first in, first out)
- **Insertion Timing:** After piece stamps and line clears

### 6.2 Queue Clearing
**Trigger:** Player dies, goes away, or server command

```cpp
void Player_base::remove_bonus() {
    canvas->should_remove_bonus = false;
    canvas->bonus = 0;
    if(canvas->islocal()) {
        Packet_clientremovebonus p;
        p.player = canvas->num_player;
        net->sendtcp(&p);
    }
}
```

### 6.3 Insertion Trigger
**File:** `source/player.cc` (Player_stamp::init, lines 1474-1481)

```cpp
void Player_stamp::init() {
    // First, insert one bonus line if blind
    if(addbonus) {
        call(new Player_check_line(canvas));
        call(addbonus);  // Player_add_bonus instance
    }

    // Then check for line clears
    call(new Player_check_line(canvas));
    ret();
}
```

**Blind Bonus Logic (player.cc:1441-1444):**
```cpp
if(canvas->bonus && !canvas->bon[0].blind_time)
    addbonus = new Player_add_bonus(canvas);
else
    addbonus = NULL;
```

**Key Rule:** Only one blind garbage line is inserted per piece placement. Non-blind lines are inserted after line clearing.

---

## 7. Garbage Insertion Algorithm

### 7.1 Player_add_bonus State Machine
**File:** `source/player.cc` (lines 631-725)

**Variables:**
```cpp
int anim;          // Animation frame counter (0-6)
int nb;            // Snapshot of bonus count
bool first_done;   // Tracks first line in packet
```

**Algorithm:**

```cpp
void Player_add_bonus::step() {
    if(nb && canvas->bonus) {
        if(anim == 0) {
            // STEP 1: Shift entire playfield up one row
            for(int j = 0; j < 31; j++)
                for(int i = 4; i < 14; i++) {
                    canvas->block[j][i] = canvas->block[j+1][i];
                    canvas->occupied[j][i] = canvas->occupied[j+1][i];
                    canvas->blinded[j][i] = canvas->blinded[j+1][i];
                    canvas->bflash[j][i] = canvas->bflash[j+1][i];
                    canvas->dirted[j+1][i] = 2;  // Mark for redraw
                }

            // STEP 2: Decode hole positions
            uint16_t hole_pos = canvas->bon[0].hole_pos;

            // Legacy mode: convert single hole to bitfield
            if(old_net_version)
                hole_pos = (1 << (9 - (canvas->bon[0].x - 4)));

            // STEP 3: Determine edge bits
            uint8_t top_bottom_add = 0;
            if(!first_done || old_net_version)
                top_bottom_add |= 2;  // Add top edge
            if(canvas->bon[0].final || old_net_version)
                top_bottom_add |= 8;  // Add bottom edge

            // STEP 4: Fill row 31 with garbage
            for(int i = 4; i < 14; i++) {
                canvas->block[31][i] = top_bottom_add + (color << 4);
                canvas->occupied[31][i] = true;
            }

            // STEP 5: Create holes
            for(int i = 4; i < 14; i++) {
                if(hole_pos & 512) {  // MSB first
                    canvas->block[31][i] = 0;
                    canvas->occupied[31][i] = false;

                    // Add bottom edge to block above if needed
                    if(first_done && canvas->occupied[30][i]) {
                        canvas->block[30][i] |= 8;
                    }

                    // Add side edges to adjacent blocks
                    if(i > 4) {
                        if(canvas->occupied[31][i-1])
                            canvas->block[31][i-1] |= 4;  // Right edge
                        if(canvas->occupied[31][4])
                            canvas->block[31][4] |= 1;    // Left edge
                    }
                    if(i < 14) {
                        canvas->block[31][i+1] |= 1;      // Left edge
                        canvas->block[31][14] |= 4;       // Right edge
                    }
                } else {
                    // Add top edge to block if above is hole
                    if(first_done && !canvas->occupied[30][i]) {
                        canvas->block[31][i] |= 2;
                    }
                }

                canvas->blinded[31][i] = 0;
                canvas->bflash[31][i] = 0;
                hole_pos <<= 1;  // Shift to next bit
            }

            // STEP 6: Update packet state
            first_done = true;
            if(canvas->bon[0].final)
                first_done = false;
        }

        anim++;
        if(anim == 7) {
            // Remove processed line from queue
            for(int y = 1; y < canvas->bonus; y++)
                canvas->bon[y-1] = canvas->bon[y];
            canvas->bonus--;
            nb--;
            anim = 0;
        }
    } else {
        // Queue empty, fix top edges and check for floaters
        for(int i = 4; i < 14; i++)
            if(canvas->occupied[0][i])
                canvas->block[0][i] |= 2;  // Clip top

        canvas->clear_tmp();
        call(new Player_check_link(canvas));  // Gravity check
        ret();
    }
}
```

### 7.2 Insertion Timing
- **Animation Frames:** 7 frames per garbage line (at 60fps = 0.117 seconds per line)
- **Parallelization:** Only one line animated at a time
- **Total Time:** For N lines: N × 7 frames = N × 0.117 seconds

### 7.3 Hole Position Decoding

**Bitfield Format (MSB to LSB):**
```
Bit 9 → Column 4
Bit 8 → Column 5
Bit 7 → Column 6
Bit 6 → Column 7
Bit 5 → Column 8
Bit 4 → Column 9
Bit 3 → Column 10
Bit 2 → Column 11
Bit 1 → Column 12
Bit 0 → Column 13
```

**Decoding Loop:**
```cpp
uint16_t hole_pos = canvas->bon[0].hole_pos;
for(int i = 4; i < 14; i++) {
    if(hole_pos & 512) {  // Test bit 9 (0b1000000000)
        // This column is a hole
        canvas->occupied[31][i] = false;
    } else {
        // This column is solid
        canvas->occupied[31][i] = true;
    }
    hole_pos <<= 1;  // Shift left, next bit becomes bit 9
}
```

### 7.4 Edge Bit Management

**Edge Rules:**
- **Top edge (bit 1):** Added if first line in packet OR above block is hole
- **Bottom edge (bit 3):** Added if last line in packet OR below block is hole
- **Left edge (bit 0):** Added if left neighbor is hole
- **Right edge (bit 2):** Added if right neighbor is hole

**Purpose:** Visual rendering of block connections

---

## 8. Handicap System

### 8.1 Handicap Levels
```cpp
enum Handicap {
    HANDICAP_BEGINNER = 0,      // "-"
    HANDICAP_APPRENTICE = 1,    // "A"
    HANDICAP_INTERMEDIATE = 2,  // (none, default)
    HANDICAP_MASTER = 3,        // "M"
    HANDICAP_GRANDMASTER = 4    // "+"
};
```

### 8.2 Handicap Application (net_version < 23)
**File:** `source/net_list.cc` (lines 161-173)

```cpp
int multiplier = 0;
if(receiver->handicap > sender->handicap)
    multiplier = receiver->handicap - sender->handicap;

p.nb = nb + (nb * multiplier + 1) / 2;  // Round up
p.nc = nc + (nc * multiplier + 1) / 2;
if(multiplier && p.nc > 8)
    p.nc = 8;  // Cap complexity
```

**Example:**
- Sender handicap: 2 (Intermediate)
- Receiver handicap: 4 (Grandmaster)
- Multiplier: 4 - 2 = 2
- Original attack: 3 lines
- Modified attack: 3 + (3 × 2 + 1) / 2 = 3 + 3 = 6 lines

**Rule:** Higher handicap players receive MORE lines (easier opponents get advantage).

### 8.3 Handicap Application (net_version == 23)
**File:** `source/net_list.cc` (lines 175-186)

```cpp
int diff = 0;
if(sender->handicap > receiver->handicap && !clean)
    diff = sender->handicap - receiver->handicap;

if(nb > diff)
    p.nb = nb - diff;
else
    p.nb = 0;

p.nc = nc;
```

**Example:**
- Sender handicap: 4 (Grandmaster)
- Receiver handicap: 2 (Intermediate)
- Diff: 4 - 2 = 2
- Original attack: 5 lines
- Modified attack: 5 - 2 = 3 lines

**Rule:** Higher handicap players send LESS lines (harder for skilled players).

### 8.4 Handicap Application (net_version >= 24)
**File:** `source/net_list.cc` (lines 187-198)

**Constants:**
```cpp
static const int stamp_per_handicap = 3;  // From canvas.h:121
```

**Algorithm:**
```cpp
p.nb = nb;
p.nc = nc;

if(!clean) {
    while(p.nb && sender->handicaps[receiver_index] >= stamp_per_handicap) {
        p.nb--;
        sender->handicaps[receiver_index] -= stamp_per_handicap;
    }
}
```

**Stamp Accumulation (player.cc:1454-1472):**
```cpp
// After each piece placement
for(int i = 0; i < MAXPLAYERS; i++) {
    Canvas *other_canvas = game->net_list.get(i);
    if(other_canvas) {
        int diff = 0;
        if(canvas->handicap > other_canvas->handicap)
            diff = canvas->handicap - other_canvas->handicap;

        if(canvas->handicaps[i] < diff * Canvas::stamp_per_handicap)
            canvas->handicaps[i]++;
    }
}
```

**Example:**
- Sender handicap: 4 (Grandmaster)
- Receiver handicap: 2 (Intermediate)
- Diff: 4 - 2 = 2
- Max stamps: 2 × 3 = 6
- After 6 piece placements: `handicaps[receiver] = 6`
- Sender clears 4 lines → 3 attack lines
- Stamps used: 3 lines × 1 stamp = 3 stamps
- Lines sent: 3 - 3 = 0 lines
- Remaining stamps: 6 - 3 = 3

### 8.5 Crowd Handicap (net_version >= 24)
**File:** `source/player.cc` (lines 1465-1471)

```cpp
// After each piece placement
int max_handicap_crowd = max(0, int(game->net_list.count_alive()) - 4);
max_handicap_crowd *= Canvas::stamp_per_handicap;

if(canvas->handicap_crowd < max_handicap_crowd)
    canvas->handicap_crowd++;
else
    canvas->handicap_crowd = max_handicap_crowd;
```

**Application (canvas.cc:551-559):**
```cpp
if(game->net_version() >= 24) {
    if(!send_for_clean && !game->boring_rules) {
        while(i && handicap_crowd >= stamp_per_handicap) {
            handicap_crowd -= stamp_per_handicap;
            i--;
        }
    }
    if(!i)
        enough = false;
}
```

**Example:**
- 8 players alive
- Max crowd handicap: (8 - 4) × 3 = 12 stamps
- Player clears 5 lines → 4 attack lines
- Crowd stamps: 12 ÷ 3 = 4 lines worth
- Lines sent: 4 - 4 = 0 lines

**Rule:** More players = more handicap for everyone (reduces spam in large games).

---

## 9. Network Versioning

### 9.1 Version Constants
**File:** `source/cfgfile.h`

```cpp
class Config {
public:
    static const uint8_t net_version = 24;
};
```

### 9.2 Version-Specific Behaviors

| Feature | net_version < 23 | net_version == 23 | net_version >= 24 |
|---------|------------------|-------------------|-------------------|
| Hole encoding | Single hole (lx) | 10-bit hole_pos | 10-bit hole_pos |
| Handicap | Receiver multiplier | Sender reduction | Stamp system |
| Clean score | Awarded immediately | In give_line() | In give_line() |
| Complexity score | 1000×(c-1) | 200×(c-1)² | 200×(c-1)² |
| Clean score | N/A | depth×1250 or depth²×500 | Same |
| Alive penalty | None | Bug: depth-1-alive | None |
| Crowd handicap | No | No | Yes |
| Attack counters | Decay on stamp | Decay on stamp (survivor: no decay) | Decay on stamp (survivor: no decay) |

### 9.3 Random Number Generation
**File:** `source/player.cc` (lines 268-272)

```cpp
void Player_get_next::shift_next() {
    uint8_t the_next;
    if(game->net_version() >= 23)
        the_next = canvas->rnd.rnd() % 7;
    else
        the_next = canvas->rnd.crap_rnd() % 7;
    canvas->next = new Bloc(the_next, -1, 7, 10);
}
```

**Rule:** Modern versions use better RNG (`rnd()` vs `crap_rnd()`).

---

## 10. Special Game Modes

### 10.1 Hot Potato Mode
**File:** `source/game.h` (lines 75-86)

**Mechanics:**
- One team is designated "potato team" (`game->potato_team`)
- Potato team uses special attacks (`potato_normal_attack`, `potato_clean_attack`)
- Attacks only sent between potato team and non-potato teams
- Potato team tracks lines sent (`potato_lines[]`)
- Potato rotates based on line count

**Potato Rotation (game.cc):**
```cpp
void Game::check_potato() {
    if(!hot_potato)
        return;

    // Track team potato lines
    for(int i = 0; i < MAXPLAYERS; i++) {
        Canvas *c = game->net_list.get(i);
        if(c && c->color == potato_team) {
            potato_lines[potato_team] += c->potato_lines;
            c->potato_lines = 0;
        }
    }

    // Check for rotation (threshold reached)
    // (Implementation varies)
}
```

### 10.2 Survivor Mode
**File:** `source/game.h` (line 74, 92)

**Mechanics:**
- Players start dead (`idle = 2`)
- Round-based gameplay
- Winner determined by last player/team alive
- Attack counters don't decay in survivor mode
- Special state machine: PLAYING → WAITFORWINNER → WAITFORRESTART → PLAYING

**States (canvas.h:50-55):**
```cpp
enum State {
    PLAYING,         // Normal gameplay
    WAITFORWINNER,   // Died, waiting for round end
    WAITFORRESTART,  // Round ended, waiting for restart
    LAST
};
```

### 10.3 Peace Mode (ATTACK_NONE)
**File:** `source/game.h` (line 99)

```cpp
Attack normal_attack = { ATTACK_NONE, 0 };
```

**Mechanics:**
- No attacks sent
- Lines cleared only for score
- Used for practice/training modes

---

## 11. Implementation Checklist

### Phase 1: Core Data Structures
- [ ] Implement Attack enum and struct
- [ ] Create bonus queue (bon[20])
- [ ] Add Canvas grid arrays (occupied, block, blinded, bflash, moved)
- [ ] Implement attack tracking arrays (attacks[], handicaps[], handicap_crowd)
- [ ] Set up grid coordinate system (36×18, playfield at rows 12-31, cols 4-13)

### Phase 2: Line Clearing
- [ ] Implement line detection loop (rows 12-31, cols 4-13)
- [ ] Store hole positions in moved[][] array during piece placement
- [ ] Calculate depth and complexity counters
- [ ] Detect clean (empty playfield)
- [ ] Mark adjacent blocks with edge bits

### Phase 3: Attack Calculation
- [ ] Implement base attack formula (depth - 1)
- [ ] Add clean bonus calculation ((1 + depth) / 2)
- [ ] Apply combo_min threshold
- [ ] Apply crowd handicap (net_version >= 24)
- [ ] Calculate scores (per clear and complexity)

### Phase 4: Hole Position Tracking and Encoding
- [ ] Add `moved[36][18]` boolean array to canvas/playfield structure
- [ ] During piece placement: Set `moved[row][col] = true` for each cell occupied by the newly placed piece
- [ ] Create temporary `hole_pos[36][18]` array in line clearing function
- [ ] During line clearing: Copy `moved[row][col]` to `hole_pos[line_index][col]` for each cleared line
- [ ] After line clearing: Copy entire `hole_pos[][]` back to `moved[][]` (remapping from row numbers to line indices)
- [ ] In attack sending: Encode `moved[line_index][4..13]` into 10-bit bitfield for each line
  - Bit 1 in bitfield = hole in garbage
  - Bit 0 in bitfield = solid block in garbage
- [ ] Generate crappy holes for clean attacks (72/585 alternating pattern)
- [ ] Handle MSB-first bit ordering (column 4 = bit 9, column 13 = bit 0)
- [ ] Clear `moved[][]` after line clearing animation completes

### Phase 5: Attack Routing
- [ ] Implement team-based filtering
- [ ] Apply handicap system (choose version)
- [ ] Handle hot potato routing rules
- [ ] Create Packet_lines/Packet_clientlines structures

### Phase 6: Garbage Queue
- [ ] Implement add_packet() reception
- [ ] Update attacker tracking (attacks[], last_attacker)
- [ ] Handle ATTACK_FULLBLIND (blind_all)
- [ ] Queue garbage in bon[] array (max 20)
- [ ] Handle final flag for packet boundaries

### Phase 7: Garbage Insertion
- [ ] Implement 7-frame animation state machine
- [ ] Shift playfield up one row per line
- [ ] Decode hole_pos bitfield (MSB first)
- [ ] Generate garbage blocks with correct color and edges
- [ ] Create holes and update adjacent edges
- [ ] Handle first_done and final flags for packet boundaries

### Phase 8: Blindness System
- [ ] Implement blind_all() for ATTACK_FULLBLIND
- [ ] Apply blindness on blind garbage insertion
- [ ] Decrement blinded[][] every 16 frames
- [ ] Trigger bflash animation on unblind
- [ ] Hide blinded blocks in rendering

### Phase 9: Handicap System (Choose One)
**Option A: net_version < 23 (Receiver Multiplier)**
- [ ] Multiply incoming lines for higher handicap receivers

**Option B: net_version == 23 (Sender Reduction)**
- [ ] Reduce outgoing lines for higher handicap senders

**Option C: net_version >= 24 (Stamp System)**
- [ ] Accumulate handicap stamps on each piece placement
- [ ] Consume stamps to reduce outgoing lines
- [ ] Implement crowd handicap accumulation and consumption

### Phase 10: Edge Cases and Polishing
- [ ] Cap bonus queue at 20 lines
- [ ] Handle overflow gracefully
- [ ] Clip top edges on row 0
- [ ] Implement gravity check after insertion (Player_check_link)
- [ ] Handle death/gone states (clear queue)
- [ ] Test all attack types (LINES, BLIND, FULLBLIND, NONE)

### Phase 11: Network Protocol (If Multiplayer)
- [ ] Serialize Attack struct
- [ ] Serialize Packet_lines with hole_pos[36]
- [ ] Handle Packet_clientlines from local players
- [ ] Broadcast Packet_lines to all relevant players
- [ ] Synchronize random seeds for deterministic gameplay

### Phase 12: Testing Scenarios
- [ ] Single line clear (1 line → 0 attack)
- [ ] Double clear (2 lines → 1 attack)
- [ ] Triple clear (3 lines → 2 attack)
- [ ] Quad clear (4 lines → 3 attack)
- [ ] Clean bonus (empty playfield → bonus lines)
- [ ] Multi-line combo (complexity > 1)
- [ ] Handicap differences (all versions)
- [ ] Crowd handicap (5+ players)
- [ ] Hot potato rotation
- [ ] Blind garbage placement
- [ ] Full blind attack
- [ ] Queue overflow (>20 lines)
- [ ] Team filtering
- [ ] Death queue clearing

---

## Appendix A: Key Code Locations

| Component | File | Lines | Function |
|-----------|------|-------|----------|
| Attack struct | attack.h | 25-54 | - |
| Bonus queue | canvas.h | 102-108 | - |
| Canvas grid | canvas.h | 93-96 | - |
| Line detection | player.cc | 554-582 | Player_check_line::check_nb_line |
| Clean detection | player.cc | 585-595 | Player_check_line::check_clean |
| Attack calculation | canvas.cc | 477-648 | Canvas::give_line |
| Hole encoding | net_list.cc | 122-133 | Net_list::send |
| Attack routing | net_list.cc | 134-203 | Net_list::send |
| Attack reception | canvas.cc | 400-475 | Canvas::add_packet |
| Garbage insertion | player.cc | 631-725 | Player_add_bonus::step |
| Blindness | canvas.cc | 382-398 | Canvas::blind_all |
| Handicap (v<23) | net_list.cc | 161-173 | Net_list::send |
| Handicap (v23) | net_list.cc | 175-186 | Net_list::send |
| Handicap (v>=24) | net_list.cc | 187-198 | Net_list::send |
| Handicap stamps | player.cc | 1454-1472 | Player_stamp::Player_stamp |
| Crowd handicap | player.cc | 1465-1471 | Player_stamp::Player_stamp |
| Hot potato | game.h | 75-86 | - |
| Survivor | game.h | 74, 92 | - |

---

## Appendix B: Constants Reference

```cpp
// Grid dimensions
const int GRID_HEIGHT = 36;
const int GRID_WIDTH = 18;
const int PLAYFIELD_TOP = 12;
const int PLAYFIELD_BOTTOM = 31;
const int PLAYFIELD_LEFT = 4;
const int PLAYFIELD_RIGHT = 13;
const int VISIBLE_ROWS = 20;
const int PLAYABLE_COLS = 10;

// Queue
const int MAX_BONUS = 20;

// Players
const int MAXPLAYERS = 32;  // From global.h
const int MAXTEAMS = 8;     // From global.h

// Handicap
const int STAMP_PER_HANDICAP = 3;
const int CROWD_THRESHOLD = 4;  // Alive players before crowd handicap kicks in

// Timing (at 60fps)
const int FRAMES_PER_LINE = 7;           // Garbage insertion animation
const int BLIND_DECREMENT_INTERVAL = 16; // Frames between blind decrements

// Block bits (block[j][i] & 15)
const uint8_t BLOCK_LEFT = 1;
const uint8_t BLOCK_TOP = 2;
const uint8_t BLOCK_RIGHT = 4;
const uint8_t BLOCK_BOTTOM = 8;

// Block color (block[j][i] >> 4)
// 0-6: Tetromino colors (I, J, L, O, S, T, Z)
// 7+: Team colors
```

---

## Appendix C: Algorithm Pseudocode

### Attack Calculation
```
function calculate_attack(depth, complexity, clean, alive_count):
    base_lines = depth - 1

    // Apply alive penalty (v23 only)
    if net_version == 23:
        alive_count = max(0, alive_count - 4)
        base_lines = max(0, base_lines - alive_count)

    // Apply crowd handicap (v24+)
    if net_version >= 24 and not clean:
        while base_lines > 0 and handicap_crowd >= 3:
            base_lines -= 1
            handicap_crowd -= 3

    // Check threshold
    if base_lines == 0 or depth < combo_min:
        return 0

    // Add clean bonus
    if clean:
        clean_bonus = (1 + depth) / 2
        return base_lines + clean_bonus

    return base_lines
```

### Hole Encoding
```
function encode_holes(moved_array):
    hole_pos = 0
    for col from 4 to 13:
        hole_pos = hole_pos << 1
        if moved_array[col]:
            hole_pos = hole_pos | 1
    return hole_pos
```

### Hole Decoding
```
function decode_holes(hole_pos, row):
    for col from 4 to 13:
        if (hole_pos & 512) != 0:  // Test bit 9
            occupied[row][col] = false
        else:
            occupied[row][col] = true
        hole_pos = hole_pos << 1
```

### Garbage Insertion Loop
```
function insert_garbage_line(color, hole_pos, blind_time, first, final):
    // Shift playfield up
    for row from 0 to 30:
        for col from 4 to 13:
            occupied[row][col] = occupied[row+1][col]
            block[row][col] = block[row+1][col]
            blinded[row][col] = blinded[row+1][col]

    // Determine edges
    edges = 0
    if not first:
        edges |= 2  // Top
    if final:
        edges |= 8  // Bottom

    // Fill bottom row
    for col from 4 to 13:
        block[31][col] = edges | (color << 4)
        occupied[31][col] = true

    // Create holes
    for col from 4 to 13:
        if (hole_pos & 512) != 0:
            occupied[31][col] = false
            // Fix adjacent edges
        hole_pos = hole_pos << 1
```

---

## Appendix D: Example Attack Scenarios

### Scenario 1: Simple Quad Clear
**Setup:**
- Player A (Intermediate): Clears 4 lines
- Player B (Intermediate): Receives attack
- Mode: Normal (ATTACK_LINES)
- net_version: 24

**Calculation:**
```
depth = 4
complexity = 1
clean = false
combo_min = 2

base_lines = 4 - 1 = 3
crowd_handicap = 0 (assume <5 players)
enough = (4 >= 2) = true

Attack sent: 3 lines
```

**Hole Encoding:**
```
Assume moved[4-13] = [0,1,0,0,1,0,0,1,0,0]
hole_pos = 0b0100100100 = 292
```

**Transmission:**
```
Packet_lines {
    player: B
    sender: A
    nb: 3
    nc: 1
    attack: { ATTACK_LINES, 0 }
    hole_pos: [292, 292, 292, ...]
}
```

**Reception:**
```
B.bonus = 3
B.bon[0] = { x:127, color:A.color, blind_time:0, hole_pos:292, final:false }
B.bon[1] = { x:127, color:A.color, blind_time:0, hole_pos:292, final:false }
B.bon[2] = { x:127, color:A.color, blind_time:0, hole_pos:292, final:true }
```

### Scenario 2: Clean Bonus
**Setup:**
- Player A: Clears 3 lines, playfield empty after
- Player B: Receives attack
- Mode: Normal (ATTACK_LINES)
- net_version: 24

**Calculation:**
```
depth = 3
clean = true
clean_bonus = (1 + 3) / 2 = 2

Attack sent: 2 clean lines + 2 normal lines = 4 lines total
```

**Hole Encoding:**
```
Clean holes (alternating):
Line 0: 72  = 0b0001001000
Line 1: 585 = 0b1001001001
Normal holes: (from moved array)
Line 2: 146
Line 3: 146
```

### Scenario 3: Handicap (v24)
**Setup:**
- Player A (Grandmaster, handicap=4): Clears 5 lines
- Player B (Beginner, handicap=0): Receives attack
- Handicap stamps: A.handicaps[B] = 9
- net_version: 24

**Calculation:**
```
depth = 5
base_lines = 5 - 1 = 4

Handicap stamps: 9
Lines to reduce: 4
Stamps consumed: 4 lines × 1 = 4 stamps
Lines sent: 4 - 4 = 0 lines (but max 4 can be reduced)

Actually: 4 > 3 (stamp_per_handicap), so:
  Iteration 1: lines=4, stamps=9, stamps>=3, lines=3, stamps=6
  Iteration 2: lines=3, stamps=6, stamps>=3, lines=2, stamps=3
  Iteration 3: lines=2, stamps=3, stamps>=3, lines=1, stamps=0
  Iteration 4: lines=1, stamps=0, stamps<3, stop

Lines sent: 1 line
Remaining stamps: 0
```

### Scenario 4: Full Blind Attack
**Setup:**
- Player A: Clears 4 lines
- Player B: Receives attack
- Mode: ATTACK_FULLBLIND (param=300)
- net_version: 24

**Calculation:**
```
nb = 3
nc = 1
param = 300

Blind duration = 3 × 1 × 300 = 900 frames
At 60fps: 900 / 60 = 15 seconds
At decrement rate: 900 / 16 = 56.25 decrements = 900 frames
```

**Effect:**
```
For all occupied[j][i]:
    blinded[j][i] = min(255, blinded[j][i] + 900)
    bflash[j][i] = 32

(Capped at 255 due to uint8_t)
```

---

## Appendix E: Network Packet Structures

### Packet_lines
```cpp
class Packet_lines {
    uint8_t player;      // Receiver player index (0-31)
    uint8_t sender;      // Sender player index (255=none)
    uint8_t nb;          // Number of garbage lines
    uint8_t nc;          // Complexity (legacy, mostly unused)
    uint8_t lx;          // Last X position (127=modern, 0-13=legacy)
    Attack attack;       // Attack type and params
    uint16_t hole_pos[36]; // Hole positions (10-bit each)
};
```

### Packet_clientlines
```cpp
class Packet_clientlines : public Packet_lines {
    // Same fields as Packet_lines
    // Sent by client to server
    // Server validates and broadcasts as Packet_lines
};
```

### Packet_download
```cpp
class Packet_download {
    uint8_t player;      // Player being synced
    int seed;            // RNG seed
    uint8_t bloc, next, next2, next3; // Current pieces
    uint8_t bonus;       // Queue size
    uint8_t idle, state; // Player state
    struct {
        uint8_t x, color, blind_time;
        uint16_t hole_pos;
        bool final;
    } bon[20];
    uint8_t can[32][10];     // Playfield blocks
    bool occ[32][10];        // Occupancy
    uint8_t blinded[32][10]; // Blind timers
    uint8_t attacks[MAXPLAYERS];
    uint8_t last_attacker;
};
```

---

## Conclusion

This document provides a complete specification of Quadra's attack/garbage system. Every algorithm, data structure, and edge case has been documented with exact line references to the source code. Use this as a reference implementation guide to recreate the system exactly in Serenity Blocks.

**Key Takeaways:**
1. Lines cleared → attack lines calculated → routed to opponents → queued → inserted
2. Hole positions encoded as 10-bit fields (net_version >= 23)
3. Handicap system varies significantly by version (recommend v24)
4. Garbage inserted one line at a time over 7 frames
5. Blindness is a separate effect that can overlay garbage
6. Edge bits maintain visual block connections
7. Crowd handicap reduces spam in large games
8. Hot potato and survivor modes alter routing and state machines

**Recommended Implementation Path:**
1. Start with net_version 24 for modern handicap system
2. Implement core structures and grid first
3. Add line clearing and attack calculation
4. Implement hole encoding and routing
5. Build garbage queue and insertion
6. Add handicap system last
7. Test extensively with edge cases

For questions or clarifications, refer to the exact source code locations in Appendix A.
