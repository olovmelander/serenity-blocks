# Local Multiplayer Layout Restructure Plan

**Date:** October 30, 2025
**Status:** 📋 Planning Phase
**Goal:** Redesign local multiplayer layout to support 2-4 players with individual stats and next pieces

---

## Current State Analysis

### Current Layout (2-Player Only)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [P1 Sidebar]     [Game Area]              [P2 Sidebar]            │
│                                                                     │
│  ┌───────────┐   ┌─────────┐  ┌─────────┐   ┌───────────┐        │
│  │ PLAYER 1  │   │   P1    │  │   P2    │   │ PLAYER 2  │        │
│  │           │   │ [Board] │  │ [Board] │   │           │        │
│  │ Stats:    │   │         │  │         │   │ Stats:    │        │
│  │ - Frags   │   │         │  │         │   │ - Frags   │        │
│  │ - Score   │   │         │  │         │   │ - Score   │        │
│  │ - Lines   │   │         │  │         │   │ - Lines   │        │
│  │ - Level   │   │         │  │         │   │ - Level   │        │
│  │ - Garbage │   │         │  │         │   │ - Garbage │        │
│  │           │   │         │  │         │   │           │        │
│  │ Next:     │   │         │  │         │   │ Next:     │        │
│  │ [■■]      │   │         │  │         │   │ [■■]      │        │
│  │ [■■]      │   │         │  │         │   │ [■■]      │        │
│  │ [■■]      │   │         │  │         │   │ [■■]      │        │
│  └───────────┘   └─────────┘  └─────────┘   └───────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

### Problems with Current Layout

1. **Space Inefficient** - Large sidebars take up ~30-40% of horizontal space
2. **Doesn't Scale** - No room for Players 3 and 4
3. **Unbalanced** - P1 and P2 get prominent stats, P3/P4 get none
4. **Information Distance** - Stats far from boards (eye travel distance)
5. **Asymmetric** - Layout changes dramatically with 3-4 players

---

## Proposed Layout (2-4 Players)

### Design Philosophy
- **Player-Centric** - Each player has their own complete "zone"
- **Scalable** - Works identically for 2, 3, or 4 players
- **Compact** - Boards remain large, stats integrated
- **Consistent** - Same layout structure for all player counts

### New Layout Structure

```
Each player gets a self-contained "player card":

┌──────────────────────┐
│   Next Pieces (Top)  │
│   [■■] [■■] [■■]     │
├──────────────────────┤
│                      │
│      P1 (Label)      │
│    ┌────────────┐    │
│    │   Board    │    │
│    │            │    │
│    │            │    │
│    └────────────┘    │
│                      │
├──────────────────────┤
│   Stats (Bottom)     │
│  F:7 S:12k L:45 G:3  │
└──────────────────────┘
```

### 2-Player Layout (Horizontal)

```
┌─────────────────────────────────────────────────────────────┐
│                     Game Container                          │
│                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐     │
│  │ Next: [■] [■] [■]   │      │ Next: [■] [■] [■]   │     │
│  ├─────────────────────┤      ├─────────────────────┤     │
│  │      P1 (Blue)      │      │      P2 (Red)       │     │
│  │   ┌─────────────┐   │      │   ┌─────────────┐   │     │
│  │   │             │   │      │   │             │   │     │
│  │   │   300x600   │   │      │   │   300x600   │   │     │
│  │   │    Board    │   │      │   │    Board    │   │     │
│  │   │             │   │      │   │             │   │     │
│  │   └─────────────┘   │      │   └─────────────┘   │     │
│  ├─────────────────────┤      ├─────────────────────┤     │
│  │ F:3 S:8.5k L:12 G:2 │      │ F:5 S:11k L:15 G:0  │     │
│  └─────────────────────┘      └─────────────────────┘     │
│                                                             │
│                   [Settings ⚙️]                             │
└─────────────────────────────────────────────────────────────┘
```

**Spacing:** ~80-100px gap between player cards

---

### 3-Player Layout (Horizontal Row)

```
┌────────────────────────────────────────────────────────────────────┐
│                        Game Container                              │
│                                                                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐     │
│  │ Next:[■][■][■] │  │ Next:[■][■][■] │  │ Next:[■][■][■] │     │
│  ├────────────────┤  ├────────────────┤  ├────────────────┤     │
│  │   P1 (Blue)    │  │   P2 (Red)     │  │  P3 (Green)    │     │
│  │  ┌──────────┐  │  │  ┌──────────┐  │  │  ┌──────────┐  │     │
│  │  │          │  │  │  │          │  │  │  │          │  │     │
│  │  │ 260x520  │  │  │  │ 260x520  │  │  │  │ 260x520  │  │     │
│  │  │  Board   │  │  │  │  Board   │  │  │  │  Board   │  │     │
│  │  │          │  │  │  │          │  │  │  │          │  │     │
│  │  └──────────┘  │  │  └──────────┘  │  │  └──────────┘  │     │
│  ├────────────────┤  ├────────────────┤  ├────────────────┤     │
│  │ F:2 S:7k L:9   │  │ F:4 S:9k L:11  │  │ F:1 S:5k L:7   │     │
│  └────────────────┘  └────────────────┘  └────────────────┘     │
│                                                                    │
│                       [Settings ⚙️]                                │
└────────────────────────────────────────────────────────────────────┘
```

**Board Size:** 260x520 (scaled down ~87%)
**Spacing:** ~40-50px gap between player cards

---

### 4-Player Layout (2x2 Grid)

```
┌──────────────────────────────────────────────────────────┐
│                   Game Container                         │
│                                                          │
│  ┌──────────────────┐      ┌──────────────────┐        │
│  │ Next: [■][■][■]  │      │ Next: [■][■][■]  │        │
│  ├──────────────────┤      ├──────────────────┤        │
│  │   P1 (Blue)      │      │   P2 (Red)       │        │
│  │  ┌────────────┐  │      │  ┌────────────┐  │        │
│  │  │            │  │      │  │            │  │        │
│  │  │  240x480   │  │      │  │  240x480   │  │        │
│  │  │   Board    │  │      │  │   Board    │  │        │
│  │  └────────────┘  │      │  └────────────┘  │        │
│  ├──────────────────┤      ├──────────────────┤        │
│  │ F:2 S:6k L:8     │      │ F:3 S:7k L:10    │        │
│  └──────────────────┘      └──────────────────┘        │
│                                                          │
│  ┌──────────────────┐      ┌──────────────────┐        │
│  │ Next: [■][■][■]  │      │ Next: [■][■][■]  │        │
│  ├──────────────────┤      ├──────────────────┤        │
│  │  P3 (Green)      │      │  P4 (Amber)      │        │
│  │  ┌────────────┐  │      │  ┌────────────┐  │        │
│  │  │            │  │      │  │            │  │        │
│  │  │  240x480   │  │      │  │  240x480   │  │        │
│  │  │   Board    │  │      │  │   Board    │  │        │
│  │  └────────────┘  │      │  └────────────┘  │        │
│  ├──────────────────┤      ├──────────────────┤        │
│  │ F:1 S:5k L:6     │      │ F:4 S:8k L:11    │        │
│  └──────────────────┘      └──────────────────┘        │
│                                                          │
│                  [Settings ⚙️]                           │
└──────────────────────────────────────────────────────────┘
```

**Board Size:** 240x480 (scaled down ~80%)
**Layout:** CSS Grid with 2 columns
**Spacing:** ~30px gap between cards

---

## Detailed Component Breakdown

### Player Card Structure

Each player card contains three sections:

#### 1. Next Pieces Section (Top)
```html
<div class="player-next-pieces">
    <canvas id="p1-next-0" width="60" height="50"></canvas>
    <canvas id="p1-next-1" width="50" height="40"></canvas>
    <canvas id="p1-next-2" width="50" height="40"></canvas>
</div>
```

**Design:**
- Horizontal row of 3 next pieces
- Small, compact canvases
- Minimal padding/margin
- Player color indicator (optional border/glow)

**Dimensions:**
- Main next: 60x50px
- Secondary next: 50x40px each
- Total height: ~60-70px

---

#### 2. Board Section (Middle)
```html
<div class="player-board-section">
    <div class="player-board-label">P1</div>
    <div class="phaser-board-container">
        <canvas id="p1-board"></canvas>
    </div>
    <div class="board-border-overlay"></div>
</div>
```

**Design:**
- Phaser canvas for game board
- Player label (P1, P2, P3, P4) with color
- Colored border with glow effect
- Maintains aspect ratio on resize

**Dimensions (responsive):**
- 2 players: 300x600px per board
- 3 players: 260x520px per board
- 4 players: 240x480px per board

---

#### 3. Stats Section (Bottom)
```html
<div class="player-stats-compact">
    <span class="stat-item">
        <span class="stat-label">F</span>
        <span class="stat-value" id="p1-frags">0</span>
    </span>
    <span class="stat-item">
        <span class="stat-label">S</span>
        <span class="stat-value" id="p1-score">0</span>
    </span>
    <span class="stat-item">
        <span class="stat-label">L</span>
        <span class="stat-value" id="p1-lines">0</span>
    </span>
    <span class="stat-item">
        <span class="stat-label">LV</span>
        <span class="stat-value" id="p1-level">1</span>
    </span>
    <span class="stat-item">
        <span class="stat-label">G</span>
        <span class="stat-value" id="p1-garbage">0</span>
    </span>
</div>
```

**Design:**
- Horizontal row of stats (compact)
- Abbreviated labels (F, S, L, LV, G)
- Small font size but readable
- Player color accent

**Dimensions:**
- Height: ~40-50px
- Full width of player card
- Font size: 12-14px for labels, 14-16px for values

**Stats Displayed:**
- **F** - Frags (kills)
- **S** - Score
- **L** - Lines cleared
- **LV** - Level
- **G** - Garbage (pending)

---

## CSS Architecture

### Container Structure

```css
/* Main multiplayer container */
.multiplayer-container {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: 100vh;
    padding: 20px;
}

/* Game area wrapper */
.multiplayer-game-area {
    display: grid;
    gap: 30px;
    max-width: 1400px;
}

/* 2 players - horizontal row */
.multiplayer-game-area.players-2 {
    grid-template-columns: repeat(2, 1fr);
    gap: 80px;
}

/* 3 players - horizontal row */
.multiplayer-game-area.players-3 {
    grid-template-columns: repeat(3, 1fr);
    gap: 50px;
}

/* 4 players - 2x2 grid */
.multiplayer-game-area.players-4 {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 30px;
}
```

---

### Player Card Styling

```css
/* Individual player card */
.player-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 15px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 16px;
    backdrop-filter: blur(10px);
}

/* Next pieces section */
.player-next-pieces {
    display: flex;
    flex-direction: row;
    gap: 8px;
    padding: 10px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 8px;
}

/* Board section */
.player-board-section {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
}

/* Stats section */
.player-stats-compact {
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    width: 100%;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 8px;
    font-family: 'Space Mono', monospace;
}

.stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}

.stat-label {
    font-size: 10px;
    opacity: 0.7;
    text-transform: uppercase;
}

.stat-value {
    font-size: 14px;
    font-weight: bold;
}
```

---

### Responsive Breakpoints

```css
/* Large Desktop (1920px+) */
@media (min-width: 1920px) {
    .multiplayer-game-area.players-2 {
        gap: 100px;
    }

    .player-card {
        /* Full size boards: 300x600 */
    }
}

/* Desktop (1440px - 1920px) */
@media (min-width: 1440px) and (max-width: 1919px) {
    .multiplayer-game-area.players-3 {
        gap: 60px;
    }

    .multiplayer-game-area.players-4 {
        gap: 40px;
    }
}

/* Laptop (1024px - 1440px) */
@media (min-width: 1024px) and (max-width: 1439px) {
    .multiplayer-game-area.players-2 {
        gap: 60px;
    }

    .multiplayer-game-area.players-3 {
        gap: 40px;
    }

    .multiplayer-game-area.players-4 {
        gap: 30px;
        /* Boards scale to 220x440 */
    }
}

/* Tablet/Small Laptop (768px - 1024px) */
@media (min-width: 768px) and (max-width: 1023px) {
    /* 3-4 players: vertical scroll or smaller boards */
    .multiplayer-game-area.players-3,
    .multiplayer-game-area.players-4 {
        overflow-y: auto;
        max-height: 90vh;
    }
}

/* Mobile (< 768px) */
@media (max-width: 767px) {
    /* Stack all players vertically */
    .multiplayer-game-area {
        grid-template-columns: 1fr !important;
        gap: 20px;
    }

    /* Smaller boards for mobile */
    .player-board-section canvas {
        width: 200px !important;
        height: 400px !important;
    }
}
```

---

## Board Sizing Matrix

| Player Count | Desktop Size | Tablet Size | Mobile Size | Aspect Ratio |
|--------------|--------------|-------------|-------------|--------------|
| 2 Players    | 300x600      | 280x560     | 200x400     | 1:2          |
| 3 Players    | 260x520      | 240x480     | 200x400     | 1:2          |
| 4 Players    | 240x480      | 220x440     | 180x360     | 1:2          |

**Scaling Strategy:**
- Maintain 1:2 aspect ratio (COLS:ROWS = 10:20)
- Scale down proportionally based on available space
- Minimum size: 180x360px (still playable)

---

## HTML Structure Changes

### Before (Current)
```html
<div class="multiplayer-container">
    <div class="player-sidebar"><!-- P1 stats --></div>
    <div class="multiplayer-game-area">
        <div class="multiplayer-board-wrapper" id="p1-wrapper">...</div>
        <div class="multiplayer-board-wrapper" id="p2-wrapper">...</div>
        <div class="multiplayer-board-wrapper" id="p3-wrapper">...</div>
        <div class="multiplayer-board-wrapper" id="p4-wrapper">...</div>
    </div>
    <div class="player-sidebar"><!-- P2 stats --></div>
</div>
```

### After (New)
```html
<div class="multiplayer-container">
    <div class="multiplayer-game-area players-2"> <!-- or players-3, players-4 -->

        <!-- Player 1 Card -->
        <div class="player-card" id="player-1-card" data-player="1">
            <!-- Next Pieces -->
            <div class="player-next-pieces">
                <canvas id="p1-next-0" width="60" height="50"></canvas>
                <canvas id="p1-next-1" width="50" height="40"></canvas>
                <canvas id="p1-next-2" width="50" height="40"></canvas>
            </div>

            <!-- Board -->
            <div class="player-board-section">
                <div class="player-board-label">P1</div>
                <div id="p1-phaser-container" class="phaser-board-container"></div>
                <div class="board-border-overlay" id="p1-border"></div>
            </div>

            <!-- Stats -->
            <div class="player-stats-compact">
                <span class="stat-item">
                    <span class="stat-label">F</span>
                    <span class="stat-value" id="p1-frags">0</span>
                </span>
                <span class="stat-item">
                    <span class="stat-label">S</span>
                    <span class="stat-value" id="p1-score">0</span>
                </span>
                <span class="stat-item">
                    <span class="stat-label">L</span>
                    <span class="stat-value" id="p1-lines">0</span>
                </span>
                <span class="stat-item">
                    <span class="stat-label">LV</span>
                    <span class="stat-value" id="p1-level">1</span>
                </span>
                <span class="stat-item">
                    <span class="stat-label">G</span>
                    <span class="stat-value" id="p1-garbage">0</span>
                </span>
            </div>
        </div>

        <!-- Player 2 Card -->
        <div class="player-card" id="player-2-card" data-player="2">
            <!-- Same structure as Player 1 -->
        </div>

        <!-- Player 3 Card (hidden by default) -->
        <div class="player-card" id="player-3-card" data-player="3" style="display: none;">
            <!-- Same structure -->
        </div>

        <!-- Player 4 Card (hidden by default) -->
        <div class="player-card" id="player-4-card" data-player="4" style="display: none;">
            <!-- Same structure -->
        </div>

    </div>

    <!-- Floating settings button -->
    <button id="settings-btn-mp" class="floating-settings-btn">⚙️</button>
</div>
```

---

## JavaScript Changes

### Update Stats Function

```javascript
// OLD: Separate functions for each sidebar
updatePlayer1Stats(player1State);
updatePlayer2Stats(player2State);

// NEW: Generic function for all players
function updatePlayerStats(playerIndex, playerState) {
    const statsMap = {
        frags: `p${playerIndex + 1}-frags`,
        score: `p${playerIndex + 1}-score`,
        lines: `p${playerIndex + 1}-lines`,
        level: `p${playerIndex + 1}-level`,
        garbage: `p${playerIndex + 1}-garbage`
    };

    // Update all stats
    document.getElementById(statsMap.frags).textContent =
        multiplayerState.frags[playerIndex];
    document.getElementById(statsMap.score).textContent =
        formatScore(playerState.score);
    document.getElementById(statsMap.lines).textContent =
        playerState.linesCleared;
    document.getElementById(statsMap.level).textContent =
        playerState.level;
    document.getElementById(statsMap.garbage).textContent =
        multiplayerState.garbageQueues[playerIndex].getTotalLines();
}

// Update all players in game loop
for (let i = 0; i < numPlayers; i++) {
    updatePlayerStats(i, multiplayerState.players[i]);
}
```

---

### Show/Hide Player Cards

```javascript
function setupPlayerCards(numPlayers) {
    // Hide all cards first
    for (let i = 1; i <= 4; i++) {
        const card = document.getElementById(`player-${i}-card`);
        if (card) {
            card.style.display = 'none';
        }
    }

    // Show active player cards
    for (let i = 1; i <= numPlayers; i++) {
        const card = document.getElementById(`player-${i}-card`);
        if (card) {
            card.style.display = 'flex';
        }
    }

    // Update game area class
    const gameArea = document.querySelector('.multiplayer-game-area');
    gameArea.className = `multiplayer-game-area players-${numPlayers}`;
}
```

---

### Apply Player Colors to Cards

```javascript
function applyPlayerColorsToCards() {
    const numPlayers = multiplayerState.numPlayers;

    for (let i = 0; i < numPlayers; i++) {
        const playerNum = i + 1;
        const playerColor = multiplayerState.getPlayerColor(i);

        if (!playerColor) continue;

        // Apply to player card
        const card = document.getElementById(`player-${playerNum}-card`);
        if (card) {
            card.style.borderColor = playerColor.primary;
            card.style.boxShadow = `0 0 20px ${playerColor.glow}`;
        }

        // Apply to label
        const label = card.querySelector('.player-board-label');
        if (label) {
            label.style.color = playerColor.primary;
            label.style.textShadow = `0 0 10px ${playerColor.glow}`;
        }

        // Apply to border overlay
        const border = document.getElementById(`p${playerNum}-border`);
        if (border) {
            border.style.borderColor = playerColor.primary;
            border.style.boxShadow = `
                0 0 30px ${playerColor.glow},
                inset 0 0 20px ${playerColor.glow}
            `;
        }
    }
}
```

---

## Implementation Phases

### Phase 1: HTML Restructure ✅ Planning
**Goal:** Update HTML to new player card structure

**Tasks:**
1. Create new `.player-card` structure in HTML
2. Move next pieces canvases into player cards
3. Create new `.player-stats-compact` sections
4. Remove old `.player-sidebar` elements
5. Update IDs to match new structure

**Files:**
- `index.html` - Main restructure

**Time Estimate:** 1-2 hours

---

### Phase 2: CSS Styling ✅ Planning
**Goal:** Style new layout with grid system

**Tasks:**
1. Create `.player-card` base styles
2. Implement CSS Grid for `.multiplayer-game-area`
3. Style `.player-next-pieces` horizontal layout
4. Style `.player-stats-compact` horizontal layout
5. Add player color styling (borders, glows)
6. Implement responsive breakpoints
7. Test board scaling for 2/3/4 players

**Files:**
- `public/styles/main.css` - New styles
- `public/styles/multiplayer-ui.css` - Multiplayer-specific styles

**Time Estimate:** 2-3 hours

---

### Phase 3: JavaScript Integration ✅ Planning
**Goal:** Update JS to work with new layout

**Tasks:**
1. Update `updatePlayerStats()` to use new stat IDs
2. Implement `setupPlayerCards()` show/hide logic
3. Update `_applyPlayerColors()` for player cards
4. Update next piece drawing to use new canvas IDs
5. Test stat updates in game loop
6. Verify all 2-4 player modes work

**Files:**
- `src/core/game-modes/LocalMultiplayerMode.js` - Main updates
- `src/main.js` - Stat update functions

**Time Estimate:** 2-3 hours

---

### Phase 4: Testing & Polish ✅ Planning
**Goal:** Ensure everything works smoothly

**Tasks:**
1. Test 2-player mode (should look best)
2. Test 3-player mode (horizontal fit)
3. Test 4-player mode (2x2 grid)
4. Test responsive layouts on different screens
5. Test color system on all players
6. Test stat updates during gameplay
7. Test next piece display
8. Fix any visual bugs or alignment issues

**Time Estimate:** 1-2 hours

---

## Visual Design Details

### Color Theme Integration

Each player card should integrate with player colors:

```css
/* Player 1 - Blue Card */
.player-card[data-player="1"] {
    border: 2px solid #3B82F6;
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
}

.player-card[data-player="1"] .player-board-label {
    color: #3B82F6;
    text-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
}

/* Repeat for P2 (Red), P3 (Green), P4 (Amber) */
```

---

### Typography & Iconography

**Player Labels:**
- Font: Space Mono, monospace
- Size: 24px (desktop), 20px (mobile)
- Weight: Bold
- Transform: Uppercase

**Stat Labels:**
- Font: Space Mono, monospace
- Size: 10px
- Weight: Normal
- Transform: Uppercase
- Opacity: 0.7

**Stat Values:**
- Font: Space Mono, monospace
- Size: 14px
- Weight: Bold
- Color: White (default) or player color (frags)

---

### Spacing & Padding

**Player Card:**
- Padding: 15px
- Gap between sections: 10px
- Border radius: 16px

**Next Pieces Section:**
- Padding: 10px
- Gap between canvases: 8px
- Border radius: 8px

**Stats Section:**
- Padding: 8px 12px
- Gap between stat items: 16px
- Border radius: 8px

**Game Area:**
- 2 players: 80-100px gap
- 3 players: 50-60px gap
- 4 players: 30-40px gap

---

## Accessibility Considerations

### Screen Reader Support
```html
<div class="player-card"
     id="player-1-card"
     data-player="1"
     aria-label="Player 1 Game Board"
     role="region">

    <div class="player-stats-compact"
         aria-live="polite"
         aria-atomic="true">
        <!-- Stats update announced to screen readers -->
    </div>
</div>
```

### Keyboard Navigation
- Tab order: P1 → P2 → P3 → P4 → Settings
- Focus indicators on player cards
- Keyboard shortcuts work regardless of layout

### High Contrast Mode
- Ensure borders visible in high contrast
- Stat labels readable without color
- Player labels distinguishable by position

---

## Migration Strategy

### Backward Compatibility

To avoid breaking existing games:

1. **Feature Flag:** Add `USE_NEW_LAYOUT` constant
```javascript
const USE_NEW_LAYOUT = true; // Toggle to enable/disable

if (USE_NEW_LAYOUT) {
    // Use new player card layout
} else {
    // Use old sidebar layout
}
```

2. **Gradual Rollout:**
   - Phase 1: Deploy with flag OFF (test in production)
   - Phase 2: Enable flag for internal testing
   - Phase 3: Enable for all users
   - Phase 4: Remove old layout code

3. **Fallback:**
   - If new layout fails, automatically revert to old layout
   - Log error for debugging

---

## Performance Considerations

### Rendering Performance
- **No impact:** Same number of canvases
- **Slightly better:** Less DOM traversal (stats closer to boards)
- **CSS Grid:** Hardware-accelerated, very performant

### Memory Usage
- **Neutral:** Same number of elements
- **Slightly less:** Removed duplicate sidebar structures

### Responsiveness
- **Better:** CSS Grid handles resizing efficiently
- **Smoother:** Fewer layout recalculations

---

## Testing Checklist

### Visual Tests
- [ ] 2-player layout looks balanced
- [ ] 3-player layout fits on screen
- [ ] 4-player layout uses grid correctly
- [ ] Player colors applied to all elements
- [ ] Next pieces visible and colored correctly
- [ ] Stats display in compact format
- [ ] Board borders have correct glow effects
- [ ] Spacing looks consistent

### Functional Tests
- [ ] Stats update correctly for all players
- [ ] Next pieces update when pieces spawn
- [ ] Frags increment on player death
- [ ] Garbage counter shows queued garbage
- [ ] Player cards show/hide based on player count
- [ ] Colors persist across rounds
- [ ] Settings button accessible

### Responsive Tests
- [ ] Desktop (1920px): Full size boards
- [ ] Laptop (1440px): Scaled boards
- [ ] Tablet (1024px): Compact layout
- [ ] Mobile (768px): Vertical stack

### Edge Cases
- [ ] Player eliminated: Stats still visible
- [ ] Round restart: Cards reset properly
- [ ] Match end: Winner highlight works
- [ ] Theme change: Colors update correctly

---

## Files to Modify

### Critical Files
1. **`index.html`** - HTML restructure (Phase 1)
2. **`public/styles/main.css`** - CSS styling (Phase 2)
3. **`src/core/game-modes/LocalMultiplayerMode.js`** - JS integration (Phase 3)

### Supporting Files
4. **`public/styles/multiplayer-ui.css`** - Additional multiplayer styles
5. **`src/main.js`** - Stat update helpers
6. **`src/rendering/draw.js`** - Next piece drawing (if needed)

---

## Rollback Plan

If the new layout causes issues:

1. **Immediate Rollback:**
   ```javascript
   const USE_NEW_LAYOUT = false; // Disable new layout
   ```

2. **Revert HTML:**
   ```bash
   git checkout HEAD~1 index.html
   ```

3. **Revert CSS:**
   ```bash
   git checkout HEAD~1 public/styles/main.css
   ```

4. **Revert JS:**
   ```bash
   git checkout HEAD~1 src/core/game-modes/LocalMultiplayerMode.js
   ```

---

## Success Metrics

### User Experience
- ✅ All 4 players have equal prominence
- ✅ Stats visible at a glance
- ✅ Next pieces easy to see
- ✅ Layout scales smoothly 2→3→4 players
- ✅ No horizontal scrolling (desktop)

### Technical
- ✅ No performance regression
- ✅ All stats update correctly
- ✅ No visual bugs
- ✅ Responsive on all screen sizes
- ✅ Clean, maintainable code

### Design
- ✅ Consistent spacing
- ✅ Player colors prominent
- ✅ Professional appearance
- ✅ Intuitive information hierarchy

---

## Future Enhancements

### V2 Features (After Initial Release)

1. **Garbage Counter Visual**
   - Show colored bars for pending garbage
   - Indicate source player by color

2. **Player Avatars**
   - Optional player icons/avatars
   - Display above board or in stats section

3. **Live Attack Indicators**
   - Pulse effect when player sends garbage
   - Arrow showing attack direction

4. **Combo Display**
   - Show current combo count near board
   - Combo multiplier indicator

5. **Victory Animation**
   - Highlight winning player card
   - Celebration effect on win

6. **Spectator Mode**
   - Zoom in on individual player
   - Picture-in-picture view

---

## Summary

### Key Changes
1. **Remove side panels** - No more P1/P2 sidebars
2. **Self-contained player cards** - Each player has next/board/stats
3. **CSS Grid layout** - Scales from 2→4 players
4. **Compact stats** - Horizontal row with abbreviations
5. **Consistent structure** - Same layout for all player counts

### Benefits
✅ Supports 2-4 players equally
✅ More screen space for boards
✅ Better information locality (stats near board)
✅ Scalable and responsive
✅ Cleaner, more modern design

### Implementation Time
- **Total Estimate:** 6-10 hours
- **Phase 1 (HTML):** 1-2 hours
- **Phase 2 (CSS):** 2-3 hours
- **Phase 3 (JS):** 2-3 hours
- **Phase 4 (Testing):** 1-2 hours

---

**Status:** 📋 Plan Complete - Ready for Implementation
**Next Step:** Begin Phase 1 - HTML Restructure
