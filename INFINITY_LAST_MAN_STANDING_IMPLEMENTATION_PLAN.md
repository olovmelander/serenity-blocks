# Implementation Plan: Infinity Last Man Standing Mode

## Overview

Add a new competitive multiplayer mode called **"Infinity Last Man Standing"** that combines the 1000-row infinite vertical building space from Infinity Mode with Local Multiplayer's 2-4 player elimination gameplay. Support both Free-For-All (FFA) and Team (2v2) variants with side-by-side board layout.

## Core Requirements Met

✅ Each player gets a 1000-row vertical board with dynamic grid expansion
✅ Individual minimap per player showing complete board state
✅ Per-player camera system that follows progress upward/downward
✅ Minimap exploration mode (pause and scroll through board)
✅ FFA mode: Last player standing wins
✅ Team mode: Last team with surviving members wins
✅ Horizontal layout matching existing FFA multiplayer design
✅ Garbage system for competitive multiplayer gameplay

---

## Architecture Summary

### Key Design Decisions

1. **Separate Infinity GameStates**: Each player gets independent `GameState` with `isInfinityMode: true`, maintaining isolation
2. **Reuse Existing Phaser Architecture**: Each player already has separate Phaser.Game instance - perfect for independent cameras
3. **Aspect-Ratio Responsive Layout**: Narrow boards (tall aspect ratio) in horizontal arrangement with dynamic scaling
4. **Per-Player Minimap**: Individual `InfinityMinimap` instance per player, positioned on right side of player card
5. **Per-Player Pause**: Individual exploration state - one player explores while others continue playing
6. **Staggered Rendering**: Update 2 scenes per frame to maintain 45-50fps with 4 players

---

## Layout Illustrations

### 2-Player Layout (Wide boards, max vertical space)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INFINITY LAST MAN STANDING                          │
│                              2 Player FFA/Team                              │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────┐              ┌──────────────────────────┐
  │ Player 1      Score: 0   │              │ Player 2      Score: 0   │
  ├──────────────────────────┤              ├──────────────────────────┤
  │ Next:  ┌─┐               │              │ Next:  ┌─┐               │
  │        └─┘     ┌────┐    │              │        └─┘     ┌────┐    │
  │                │████│    │              │                │████│    │
  │  ╔═══════════╗ │    │    │              │  ╔═══════════╗ │    │    │
  │  ║           ║ │░░░░│    │              │  ║           ║ │░░░░│    │
  │  ║           ║ │    │    │              │  ║           ║ │    │    │
  │  ║           ║ │▓▓▓▓│    │              │  ║           ║ │▓▓▓▓│    │
  │  ║           ║ │    │    │              │  ║           ║ │    │    │
  │  ║           ║ │    │<── Minimap        │  ║           ║ │    │<── Minimap
  │  ║           ║ │░░░░│    (55px × 300px) │  ║           ║ │░░░░│    (55px × 300px)
  │  ║  BOARD    ║ │    │    Shows full     │  ║  BOARD    ║ │    │    Shows full
  │  ║  20 rows  ║ │    │    1000 rows      │  ║  20 rows  ║ │    │    1000 rows
  │  ║  visible  ║ │▓▓▓▓│                   │  ║  visible  ║ │▓▓▓▓│
  │  ║           ║ │    │    Click/drag     │  ║           ║ │    │    Click/drag
  │  ║           ║ │    │    to explore     │  ║           ║ │    │    to explore
  │  ║           ║ │░░░░│                   │  ║           ║ │░░░░│
  │  ║           ║ │    │                   │  ║           ║ │    │
  │  ║    ▓▓     ║ │    │                   │  ║    ▓▓     ║ │    │
  │  ║   ▓▓▓▓    ║ │▓▓▓▓│◄── Viewport      │  ║   ▓▓▓▓    ║ │▓▓▓▓│◄── Viewport
  │  ║  ▓▓▓▓▓▓   ║ │    │    indicator      │  ║  ▓▓▓▓▓▓   ║ │    │    indicator
  │  ╚═══════════╝ └────┘                   │  ╚═══════════╝ └────┘
  │                                          │
  │  Lines: 0    Level: 1    Time: 0:00     │  Lines: 0    Level: 1    Time: 0:00
  └──────────────────────────┘              └──────────────────────────┘
        ↑ ~30vw wide                               ↑ ~30vw wide
```

### 3-Player Layout (Medium boards)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INFINITY LAST MAN STANDING                          │
│                            3 Player FFA/Team                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ P1    Score: 0   │     │ P2    Score: 0   │     │ P3    Score: 0   │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ Next: ┌┐  ┌───┐  │     │ Next: ┌┐  ┌───┐  │     │ Next: ┌┐  ┌───┐  │
│       └┘  │███│  │     │       └┘  │███│  │     │       └┘  │███│  │
│ ╔════════╗│░░░│  │     │ ╔════════╗│░░░│  │     │ ╔════════╗│░░░│  │
│ ║        ║│   │  │     │ ║        ║│   │  │     │ ║        ║│   │  │
│ ║        ║│▓▓▓│  │     │ ║        ║│▓▓▓│  │     │ ║        ║│▓▓▓│  │
│ ║        ║│   │  │     │ ║        ║│   │  │     │ ║        ║│   │  │
│ ║ BOARD  ║│░░░│  │     │ ║ BOARD  ║│░░░│  │     │ ║ BOARD  ║│░░░│  │
│ ║20 rows ║│   │  │     │ ║20 rows ║│   │  │     │ ║20 rows ║│   │  │
│ ║visible ║│▓▓▓│  │     │ ║visible ║│▓▓▓│  │     │ ║visible ║│▓▓▓│  │
│ ║        ║│   │  │     │ ║        ║│   │  │     │ ║        ║│   │  │
│ ║  ▓▓    ║│░░░│  │     │ ║  ▓▓    ║│░░░│  │     │ ║  ▓▓    ║│░░░│  │
│ ║ ▓▓▓▓   ║│▓▓▓│◄ Mini  │ ║ ▓▓▓▓   ║│▓▓▓│◄ Mini  │ ║ ▓▓▓▓   ║│▓▓▓│◄ Mini
│ ║▓▓▓▓▓▓  ║│   │  map   │ ║▓▓▓▓▓▓  ║│   │  map   │ ║▓▓▓▓▓▓  ║│   │  map
│ ╚════════╝└───┘        │ ╚════════╝└───┘        │ ╚════════╝└───┘
│ Lines: 0  Time: 0:00   │ Lines: 0  Time: 0:00   │ Lines: 0  Time: 0:00
└──────────────────┘     └──────────────────┘     └──────────────────┘
   ↑ ~24vw wide            ↑ ~24vw wide            ↑ ~24vw wide
```

### 4-Player Layout (Narrow boards, optimized spacing)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          INFINITY LAST MAN STANDING                               │
│                             4 Player FFA / 2v2                                    │
└───────────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│P1   Sc: 0  A │  │P2   Sc: 0  B │  │P3   Sc: 0  A │  │P4   Sc: 0  B │
├──────────────┤  ├──────────────┤  ├──────────────┤  ├──────────────┤
│Nxt:┌┐ ┌──┐   │  │Nxt:┌┐ ┌──┐   │  │Nxt:┌┐ ┌──┐   │  │Nxt:┌┐ ┌──┐   │
│    └┘ │██│   │  │    └┘ │██│   │  │    └┘ │██│   │  │    └┘ │██│   │
│╔══════╗│░░│   │  │╔══════╗│░░│   │  │╔══════╗│░░│   │  │╔══════╗│░░│   │
│║      ║│  │   │  │║      ║│  │   │  │║      ║│  │   │  │║      ║│  │   │
│║      ║│▓▓│   │  │║      ║│▓▓│   │  │║      ║│▓▓│   │  │║      ║│▓▓│   │
│║      ║│  │   │  │║      ║│  │   │  │║      ║│  │   │  │║      ║│  │   │
│║BOARD ║│░░│   │  │║BOARD ║│░░│   │  │║BOARD ║│░░│   │  │║BOARD ║│░░│   │
│║20row ║│  │   │  │║20row ║│  │   │  │║20row ║│  │   │  │║20row ║│  │   │
│║      ║│▓▓│   │  │║      ║│▓▓│   │  │║      ║│▓▓│   │  │║      ║│▓▓│   │
│║      ║│  │   │  │║      ║│  │   │  │║      ║│  │   │  │║      ║│  │   │
│║ ▓▓   ║│░░│   │  │║ ▓▓   ║│░░│   │  │║ ▓▓   ║│░░│   │  │║ ▓▓   ║│░░│   │
│║▓▓▓▓  ║│▓▓│◄M │  │║▓▓▓▓  ║│▓▓│◄M │  │║▓▓▓▓  ║│▓▓│◄M │  │║▓▓▓▓  ║│▓▓│◄M │
│║▓▓▓▓▓▓║│  │  │  │║▓▓▓▓▓▓║│  │  │  │║▓▓▓▓▓▓║│  │  │  │║▓▓▓▓▓▓║│  │  │
│╚══════╝└──┘   │  │╚══════╝└──┘   │  │╚══════╝└──┘   │  │╚══════╝└──┘   │
│L:0  T:0:00    │  │L:0  T:0:00    │  │L:0  T:0:00    │  │L:0  T:0:00    │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
  ↑ ~20vw          ↑ ~20vw          ↑ ~20vw          ↑ ~20vw
  Team A           Team B           Team A           Team B
  (Blue)           (Red)            (Blue)           (Red)
```

### Key Layout Features

**Horizontal Spacing:**
- 2 players: 40px gap between cards
- 3 players: 30px gap between cards
- 4 players: 20px gap between cards

**Minimap Integration:**
- **Position**: Right side of each player card
- **Dimensions**: 55px wide × 300px tall (optimized for 4-player layout)
- **Aspect Ratio**: 5.5:1 represents 10:1000 cols:rows structure
- **Grid Column**: 65px reserved (55px minimap + margins)
- **Space Savings**: 100px total vs original 90px design

**Player Card Grid Structure:**
```
┌─────────────────────────────────────┐
│ header    header     minimap        │  ← Player name, score
│ next      next       minimap        │  ← Next piece preview
│ board     board      minimap        │  ← Main gameplay board (20 visible rows)
│ stats     stats      stats          │  ← Lines cleared, level, time
└─────────────────────────────────────┘
  ↑ 1fr      ↑ auto    ↑ 65px
```

**Responsive Breakpoints:**
- **1920×1080**: All layouts fit perfectly
- **1600×900**: 4-player gets narrower boards (min 160px)
- **<1600px**: Optional 2×2 grid fallback for 4 players

**Visual Elements:**
- **Team Markers**: A/B badges in player header (2v2 mode)
- **Minimap Stripes**: Alternating colors (blocks = dark, empty = light)
- **Viewport Indicator**: Bright rectangle on minimap showing visible area
- **Hover Effect**: 1.1× scale on minimap hover for better interaction

---

## Implementation Plan

### Phase 1: Mode Selection & Configuration

#### 1.1 Add "Infinity LMS" to Setup Modal

**File**: `src/ui/local-match-config-modal.js`

**Changes**:
- Add new option to Win Condition dropdown (around line 48):
  ```html
  <option value="infinity-lms">Infinity LMS (Last Standing)</option>
  ```

- Update `updateEndConditionUI()` method to handle `infinity-lms`:
  ```javascript
  updateEndConditionUI() {
    const endCondition = this.form.querySelector('#end-condition').value;
    const endValueGroup = this.form.querySelector('#end-value-group');
    const startLevelGroup = this.form.querySelector('#start-level')?.parentElement;
    const levelProgressionGroup = this.form.querySelector('#level-progression')?.parentElement;

    if (endCondition === 'infinity-lms') {
      // Hide incompatible options
      endValueGroup.style.display = 'none';
      if (startLevelGroup) startLevelGroup.style.display = 'none';
      if (levelProgressionGroup) levelProgressionGroup.style.display = 'none';

      // Show infinity-specific help text
      const helpText = document.createElement('small');
      helpText.className = 'form-help infinity-help';
      helpText.textContent = '🚀 Survive longest in 1000-row vertical battle arena';
      endValueGroup.parentElement.insertBefore(helpText, endValueGroup.nextSibling);
    } else {
      // Show normal options, remove infinity help
      endValueGroup.style.display = '';
      if (startLevelGroup) startLevelGroup.style.display = '';
      if (levelProgressionGroup) levelProgressionGroup.style.display = '';
      document.querySelector('.infinity-help')?.remove();
    }
  }
  ```

- Update `handleSubmit()` to include infinity flag:
  ```javascript
  const config = {
    numPlayers: parseInt(formData.get('numPlayers')),
    endCondition: formData.get('endCondition'),
    isInfinityLMS: formData.get('endCondition') === 'infinity-lms',
    isTeamMode: formData.get('teamMode') === 'on',
    playerTeams: this.getTeamAssignments(),
    // Only include these if NOT infinity mode
    ...(formData.get('endCondition') !== 'infinity-lms' && {
      endConditionValue: parseInt(formData.get('endConditionValue')),
      startLevel: parseInt(formData.get('startLevel')),
      levelProgression: formData.get('levelProgression') === 'on',
    }),
    boringRules: formData.get('boringRules') === 'on',
  };
  ```

#### 1.2 Configuration Flow

When user selects "Infinity LMS":
1. Modal hides frag count, start level, level progression inputs
2. Shows help text explaining 1000-row mechanics
3. Team mode toggle remains available
4. Config object gets `isInfinityLMS: true` flag

---

### Phase 2: Board Architecture - Infinity GameState Per Player

#### 2.1 Extend MultiPlayerState for Infinity

**File**: `src/core/multi-player-state.js`

**Changes in `reset()` method**:

```javascript
reset() {
  // Import infinity grid utilities at top of file
  // import { createInfinityGrid } from './infinity-grid.js';

  for (let i = 0; i < this.numPlayers; i++) {
    this.players[i].reset();

    // Apply Infinity LMS configuration
    if (this.matchConfig?.isInfinityLMS) {
      // Enable infinity mode
      this.players[i].isInfinityMode = true;
      this.players[i].maxRows = 1000;
      this.players[i].disableLevelProgression = true;
      this.players[i].disableGarbage = false; // Keep garbage for multiplayer

      // Create 1000-row grid (starts at 44 rows, expands dynamically)
      const infinityGrid = createInfinityGrid(COLS, 44);
      this.players[i].board = infinityGrid;
      this.players[i].boardGrid = infinityGrid;

      // Initialize infinity stats
      this.players[i].infinityStats = {
        blocksPlaced: 0,
        maxCascadeScore: 0,
        maxComboComplexity: 0,
        maxComboDepth: 0,
        totalCascades: 0,
        rowsReached: 44,
      };

      // Camera tracking
      this.players[i].cameraRow = 44; // Start at bottom
      this.players[i].currentTopRow = 44;
    } else {
      // Normal multiplayer: standard 20-row board
      this.players[i].board = createEmptyBoard();
      this.players[i].boardGrid = this.players[i].board;
    }
  }
}
```

**Add per-player pause state** for exploration mode:
```javascript
constructor(numPlayers, matchConfig = null) {
  // ... existing code ...
  this.playerPaused = new Array(numPlayers).fill(false);
}
```

#### 2.2 Grid Expansion Integration

**No changes needed** - `expandGridIfNeeded()` from `infinity-grid.js` works per-player automatically.

Called in game loop:
```javascript
// In LocalMultiplayerMode game loop, for each player:
if (playerState.isInfinityMode) {
  expandGridIfNeeded(playerState, playerState.currentTopRow);
}
```

---

### Phase 3: Layout Strategy - Horizontal Infinity Boards

#### 3.1 CSS Responsive Scaling

**File**: `public/styles/multiplayer-ui.css`

**Add new CSS classes** for infinity layout:

```css
/* Infinity LMS Layout - Vertical boards in horizontal arrangement */
.multiplayer-game-area.infinity-lms {
  /* Boards are tall (20 visible rows) but narrow (10 cols) */
  --infinity-visible-rows: 20;
  --infinity-board-aspect: 0.5; /* 10 cols / 20 rows */
}

/* 2 players - wider boards */
.multiplayer-game-area.infinity-lms.players-2 {
  grid-template-columns: repeat(2, minmax(240px, 30vw));
  gap: 40px;
}

.multiplayer-game-area.infinity-lms.players-2 .player-card {
  max-height: 85vh;
}

/* 3 players - medium width */
.multiplayer-game-area.infinity-lms.players-3 {
  grid-template-columns: repeat(3, minmax(200px, 24vw));
  gap: 30px;
}

.multiplayer-game-area.infinity-lms.players-3 .player-card {
  max-height: 82vh;
}

/* 4 players - narrow boards */
.multiplayer-game-area.infinity-lms.players-4 {
  grid-template-columns: repeat(4, minmax(160px, 20vw));
  gap: 20px;
}

.multiplayer-game-area.infinity-lms.players-4 .player-card {
  max-height: 80vh;
}

/* Minimap positioning in player card - OPTIMIZED for space efficiency */
.player-card.infinity-lms {
  display: grid;
  grid-template-areas:
    "header header minimap"
    "next next minimap"
    "board board minimap"
    "stats stats stats";
  grid-template-columns: 1fr auto 65px; /* Slimmer: 65px vs 90px */
  gap: 4px 8px;
}

.player-card.infinity-lms .infinity-minimap {
  grid-area: minimap;
  width: 55px !important;  /* Slimmer: 55px vs 80px (saves 100px for 4 players) */
  height: 300px !important; /* Taller: better 5.5:1 aspect ratio for 10:1000 cols:rows */
  margin: 8px 0;
  opacity: 0.8;
  transition: opacity 0.2s, transform 0.2s;
  cursor: pointer;
}

.player-card.infinity-lms .infinity-minimap:hover {
  opacity: 1;
  transform: scale(1.1); /* Larger hover for better visibility with slim design */
}

/* Optional: Click-to-expand overlay for detailed exploration */
.minimap-overlay-expanded {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 600px;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.95);
  border: 2px solid var(--player-primary);
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.8);
  border-radius: 8px;
}

/* Board takes main area */
.player-card.infinity-lms .player-board-wrapper {
  grid-area: board;
}

/* Stats span full width */
.player-card.infinity-lms .player-stats-bar {
  grid-area: stats;
}
```

#### 3.2 Dynamic Block Size Calculation

**File**: `src/core/game-modes/LocalMultiplayerMode.js`

**Update `_calculateDynamicBlockSize()` method**:

```javascript
_calculateDynamicBlockSize() {
  const numPlayers = this.matchConfig?.numPlayers || 2;
  const isInfinity = this.matchConfig?.isInfinityLMS;

  if (isInfinity) {
    // Infinity mode: prioritize vertical space for 20 visible rows
    const maxHeight = window.innerHeight * 0.80; // Use 80% of viewport height
    const visibleRows = 20; // Standard infinity viewport

    // Calculate block size from height constraint
    const blockSizeByHeight = Math.floor(maxHeight / visibleRows);

    // Calculate block size from width constraint
    const availableWidth = window.innerWidth - 200; // Reserve for padding/gaps
    const gapWidth = 30 * (numPlayers - 1);
    const minimapWidth = 65 * numPlayers; // Reserve space for minimaps (optimized: 65px vs 90px)
    const boardsWidth = availableWidth - gapWidth - minimapWidth;
    const boardWidthPerPlayer = boardsWidth / numPlayers;
    const blockSizeByWidth = Math.floor(boardWidthPerPlayer / COLS);

    // Use smaller of the two to ensure fit
    const blockSize = Math.min(blockSizeByHeight, blockSizeByWidth);

    // Clamp to playable range (smaller than normal multiplayer)
    return Math.max(12, Math.min(32, blockSize));
  } else {
    // Existing normal multiplayer calculation
    // ... existing code ...
  }
}
```

#### 3.3 Apply Layout Classes

**In `_updatePlayerLayout()` method**:

```javascript
_updatePlayerLayout(numPlayers) {
  const gameArea = document.querySelector('.multiplayer-game-area');
  if (!gameArea) return;

  // Remove all classes
  gameArea.classList.remove('players-2', 'players-3', 'players-4', 'infinity-lms');

  // Add player count class
  gameArea.classList.add(`players-${numPlayers}`);

  // Add infinity class if needed
  if (this.matchConfig?.isInfinityLMS) {
    gameArea.classList.add('infinity-lms');
  }

  // Show/hide player cards and apply infinity class
  for (let i = 1; i <= 4; i++) {
    const playerCard = document.getElementById(`player-${i}-card`);
    if (playerCard) {
      if (i <= numPlayers) {
        playerCard.style.display = 'grid'; // Use grid for infinity layout
        playerCard.removeAttribute('aria-hidden');

        // Add infinity class to card
        if (this.matchConfig?.isInfinityLMS) {
          playerCard.classList.add('infinity-lms');
        } else {
          playerCard.classList.remove('infinity-lms');
        }

        // ... existing team mode marker code ...
      } else {
        playerCard.style.display = 'none';
        playerCard.setAttribute('aria-hidden', 'true');
      }
    }
  }
}
```

---

### Phase 4: Camera System - Per-Player Independence

#### 4.1 Camera Configuration

**File**: `src/rendering/phaser/base-board-scene.js`

**Good news**: Camera system is already per-scene! Each BoardScene has independent `cameraSettings`.

**Verify camera initialization** in `configureCamera()`:

```javascript
configureCamera() {
  if (!this.gameState?.isInfinityMode) {
    this.cameraSettings.enabled = false;
    return;
  }

  // Enable infinity camera
  this.cameraSettings.enabled = true;
  this.cameraSettings.currentTopRow = this.gameState.board.length - 20; // Start at bottom
  this.cameraSettings.targetTopRow = this.cameraSettings.currentTopRow;
  this.cameraSettings.activeTopRow = this.cameraSettings.currentTopRow;
  this.cameraSettings.lerpSpeed = 0.08;
  this.cameraSettings.visibleRows = 20;
  this.cameraSettings.manualControl = false;

  console.log(`[BoardScene] Camera configured for infinity mode, starting at row ${this.cameraSettings.currentTopRow}`);
}
```

#### 4.2 Camera Update Integration

**File**: `src/core/game-modes/LocalMultiplayerMode.js`

**In `_syncBoardScenes()` method**:

```javascript
_syncBoardScenes() {
  if (!this.multiplayerState) return;

  this.boardScenes.forEach((scene, index) => {
    const playerState = this.multiplayerState.players[index];
    if (!playerState) return;

    // Sync game state to scene
    if (scene && scene.syncFromGameState) {
      scene.syncFromGameState(playerState);
    }

    // Update camera for infinity mode
    if (playerState.isInfinityMode && scene.cameraSettings?.enabled) {
      // Camera logic from InfinityMode._updateCameraPosition
      this._updatePlayerCamera(scene, playerState, index);
    }
  });
}
```

**Add new method `_updatePlayerCamera()`**:

```javascript
_updatePlayerCamera(scene, playerState, playerIndex) {
  // Skip if manually controlled (exploration mode)
  if (scene.cameraSettings.manualControl) {
    return;
  }

  // Skip if player is paused for exploration
  if (this.multiplayerState.playerPaused[playerIndex]) {
    return;
  }

  const visibleRows = scene.cameraSettings.visibleRows || 20;
  const currentPiece = playerState.currentPiece;

  if (currentPiece) {
    // Follow piece if it goes below 50% of viewport
    const pieceBottomRow = currentPiece.y + currentPiece.shape.length;
    const currentCameraRow = scene.cameraSettings.currentTopRow;
    const followThreshold = currentCameraRow + Math.floor(visibleRows * 0.5);

    if (pieceBottomRow > followThreshold) {
      // Follow piece downward
      const targetCameraRow = pieceBottomRow - Math.floor(visibleRows * 0.5);
      const maxCameraRow = Math.max(0, playerState.board.length - visibleRows);
      const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

      scene.updateCameraPosition(clampedCameraRow);
      return;
    }
  }

  // Follow building upward when blocks reach top 30% of viewport
  const highestBlockRow = this._findHighestBlockRow(playerState.board);
  if (highestBlockRow < playerState.board.length) {
    const currentCameraRow = scene.cameraSettings.currentTopRow;
    const scrollThreshold = currentCameraRow + Math.floor(visibleRows * 0.3);

    if (highestBlockRow < scrollThreshold) {
      const targetCameraRow = highestBlockRow - Math.floor(visibleRows * 0.3);
      const maxCameraRow = Math.max(0, playerState.board.length - visibleRows);
      const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

      scene.updateCameraPosition(clampedCameraRow);
    }
  }
}

_findHighestBlockRow(board) {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      if (board[row][col] !== null) {
        return row;
      }
    }
  }
  return board.length;
}
```

---

### Phase 5: Minimap Integration - Per-Player Instances

#### 5.1 Create Minimap Instances

**File**: `src/core/game-modes/LocalMultiplayerMode.js`

**Add to constructor**:
```javascript
constructor(dependencies) {
  super(dependencies);
  // ... existing code ...
  this.playerMinimaps = []; // Array of InfinityMinimap instances
  this.minimapCleanupHandlers = [];
}
```

**In `onStart()` method**, after creating board scenes:

```javascript
async onStart() {
  // ... existing setup code ...

  if (this.matchConfig?.isInfinityLMS) {
    console.log('[LocalMP] Creating infinity minimaps...');

    // Import InfinityMinimap
    const { InfinityMinimap } = await import('../../ui/infinity/InfinityMinimap.js');

    for (let i = 0; i < numPlayers; i++) {
      const playerNum = i + 1;
      const playerCard = document.getElementById(`player-${playerNum}-card`);

      // Create minimap instance
      const minimap = new InfinityMinimap({
        width: 55,   // Optimized: 55px vs 80px (slimmer for 4-player layout)
        height: 300, // Optimized: 300px vs 280px (better 5.5:1 aspect ratio)
        container: playerCard, // Minimap appends itself to container
      });

      minimap.show();
      this.playerMinimaps.push(minimap);

      // Setup exploration event handlers
      this._setupMinimapExploration(minimap, i);
    }

    console.log(`[LocalMP] ${numPlayers} minimaps created`);
  }

  // ... continue with game start ...
}
```

#### 5.2 Setup Minimap Exploration Per Player

**Add new method `_setupMinimapExploration()`**:

```javascript
_setupMinimapExploration(minimap, playerIndex) {
  const playerNum = playerIndex + 1;

  // Exploration start
  const startHandler = () => {
    console.log(`[LocalMP] Player ${playerNum} exploration started`);
    this.multiplayerState.playerPaused[playerIndex] = true;

    if (this.boardScenes[playerIndex]) {
      this.boardScenes[playerIndex].enableManualCameraControl();
    }

    minimap.onPause();
  };

  // Exploration end
  const endHandler = () => {
    console.log(`[LocalMP] Player ${playerNum} exploration ended`);
    this.multiplayerState.playerPaused[playerIndex] = false;

    if (this.boardScenes[playerIndex]) {
      const scene = this.boardScenes[playerIndex];
      scene.disableManualCameraControl();

      // Snap back to gameplay position (show active piece)
      const playerState = this.multiplayerState.players[playerIndex];
      const cameraRow = this._calculateGameplayCameraPosition(playerState);
      scene.updateCameraPosition(cameraRow);
    }

    minimap.onUnpause();
  };

  // Camera jump during exploration
  const jumpHandler = (event) => {
    if (this.boardScenes[playerIndex]) {
      const targetRow = event.detail.targetRow;
      const scene = this.boardScenes[playerIndex];
      const visibleRows = scene.cameraSettings?.visibleRows || 20;

      // Calculate top row (center target in viewport)
      const targetTopRow = targetRow - Math.floor(visibleRows / 2);
      const maxCameraRow = Math.max(0, this.multiplayerState.players[playerIndex].board.length - visibleRows);
      const clampedRow = Math.max(0, Math.min(maxCameraRow, targetTopRow));

      scene.updateCameraPosition(clampedRow, true); // Immediate update
    }
  };

  // Add event listeners
  minimap.container.addEventListener('minimap-exploration-start', startHandler);
  minimap.container.addEventListener('minimap-exploration-end', endHandler);
  minimap.container.addEventListener('minimap-jump', jumpHandler);

  // Store for cleanup
  this.minimapCleanupHandlers.push({
    element: minimap.container,
    events: [
      { type: 'minimap-exploration-start', handler: startHandler },
      { type: 'minimap-exploration-end', handler: endHandler },
      { type: 'minimap-jump', handler: jumpHandler },
    ],
  });
}

_calculateGameplayCameraPosition(playerState) {
  const visibleRows = 20;
  const totalRows = playerState.board.length;
  const maxCameraRow = Math.max(0, totalRows - visibleRows);

  // Center on active piece
  if (playerState.currentPiece) {
    const pieceBottomRow = playerState.currentPiece.y + (playerState.currentPiece.shape?.length || 0);
    const targetRow = pieceBottomRow - Math.floor(visibleRows * 0.5);
    return Math.max(0, Math.min(maxCameraRow, targetRow));
  }

  // Fallback: show highest blocks
  const highestRow = this._findHighestBlockRow(playerState.board);
  if (highestRow < totalRows) {
    const targetRow = highestRow - Math.floor(visibleRows * 0.3);
    return Math.max(0, Math.min(maxCameraRow, targetRow));
  }

  return maxCameraRow;
}
```

#### 5.3 Update Minimaps in Game Loop

**In `_updateMultiplayerStats()` method**:

```javascript
_updateMultiplayerStats() {
  if (!this.multiplayerState) return;

  // ... existing stats update code ...

  // Update minimaps for infinity mode
  if (this.matchConfig?.isInfinityLMS && this.playerMinimaps.length > 0) {
    this.playerMinimaps.forEach((minimap, index) => {
      if (index >= this.multiplayerState.numPlayers) return;

      const playerState = this.multiplayerState.players[index];
      const scene = this.boardScenes[index];

      if (minimap && scene?.cameraSettings && playerState) {
        minimap.update(
          playerState,
          scene.cameraSettings.currentTopRow || 0,
          scene.cameraSettings.visibleRows || 20
        );
      }
    });
  }
}
```

#### 5.4 Cleanup Minimaps

**In `onDeactivate()` method**:

```javascript
async onDeactivate() {
  // ... existing cleanup code ...

  // Destroy minimaps
  if (this.playerMinimaps.length > 0) {
    this.playerMinimaps.forEach(minimap => {
      if (minimap) {
        minimap.destroy();
      }
    });
    this.playerMinimaps = [];
  }

  // Clean up minimap event listeners
  this._cleanupEventListeners(this.minimapCleanupHandlers);
  this.minimapCleanupHandlers = [];

  // ... continue with existing cleanup ...
}
```

---

### Phase 6: Team Mode Integration

#### 6.1 Garbage Routing (Already Works!)

**File**: `src/core/multi-player-state.js`

**Good news**: Existing `_getAttackTargets()` already filters by team. No changes needed.

Infinity boards work with existing garbage system:
- `insertGarbageEntries()` works on any board size
- `handleGarbageSummary()` already routes garbage correctly

#### 6.2 Team Victory Condition

**File**: `src/core/game-modes/LocalMultiplayerMode.js`

**Update `_handleGameOver()` method**:

```javascript
async _handleGameOver(playerIndex) {
  console.log(`[LocalMP] Player ${playerIndex + 1} lost!`);

  // Mark player as dead
  this.multiplayerState.handlePlayerDeath(playerIndex);

  // Clear eliminated player's piece
  const playerState = this.multiplayerState.players[playerIndex];
  if (playerState && playerState.currentPiece) {
    playerState.currentPiece = null;
  }

  // Show death animation
  this._showPlayerDeathAnimation(playerIndex);

  // Check win conditions
  if (this.matchConfig?.isInfinityLMS) {
    this._checkInfinityWinConditions();
  } else {
    // Existing round-based logic
    // ... existing code ...
  }
}
```

**Add new method `_checkInfinityWinConditions()`**:

```javascript
_checkInfinityWinConditions() {
  const alivePlayers = this.multiplayerState.players
    .map((p, i) => ({ index: i, alive: p.isAlive }))
    .filter(p => p.alive);

  if (this.matchConfig.isTeamMode) {
    // Team mode: Check if only one team has alive players
    const aliveTeams = new Set(
      alivePlayers.map(p => this.matchConfig.playerTeams[p.index])
    );

    if (aliveTeams.size === 1) {
      // One team wins
      const winningTeam = Array.from(aliveTeams)[0];
      const winningPlayers = alivePlayers.filter(
        p => this.matchConfig.playerTeams[p.index] === winningTeam
      );

      // Show victory for all team members
      winningPlayers.forEach(p => this._showVictoryAnimation(p.index));

      setTimeout(() => this._handleTeamVictory(winningTeam), 500);
    } else if (aliveTeams.size === 0) {
      // Draw (all died simultaneously)
      console.log('[LocalMP] Match ended in draw');
      setTimeout(() => this._handleDraw(), 500);
    }
  } else {
    // FFA mode: Check if only one player alive
    if (alivePlayers.length === 1) {
      const winner = alivePlayers[0].index;
      this._showVictoryAnimation(winner);
      setTimeout(() => this._handlePlayerVictory(winner), 500);
    } else if (alivePlayers.length === 0) {
      // Draw
      console.log('[LocalMP] Match ended in draw');
      setTimeout(() => this._handleDraw(), 500);
    }
  }
}

_handlePlayerVictory(playerIndex) {
  this.isRunning = false;
  this.multiplayerState.isPaused = true;

  const playerState = this.multiplayerState.players[playerIndex];
  const buildHeight = playerState.board.length - this._findHighestBlockRow(playerState.board);
  const playerName = `Player ${playerIndex + 1}`;

  // Show victory modal
  this.deps.modalManager.showCustom({
    title: `🏆 ${playerName} Wins!`,
    message: `Last standing with ${buildHeight} row build!\n\nScore: ${playerState.score}\nLines: ${playerState.totalLinesCleared}`,
    buttons: [
      { text: 'Rematch', action: () => this.onStart() },
      { text: 'Main Menu', action: () => this.onStop() },
    ],
  });
}

_handleTeamVictory(teamId) {
  this.isRunning = false;
  this.multiplayerState.isPaused = true;

  const teamName = teamId === 0 ? 'Team A' : 'Team B';

  this.deps.modalManager.showCustom({
    title: `🏆 ${teamName} Wins!`,
    message: `Last team standing!`,
    buttons: [
      { text: 'Rematch', action: () => this.onStart() },
      { text: 'Main Menu', action: () => this.onStop() },
    ],
  });
}

_handleDraw() {
  this.isRunning = false;
  this.multiplayerState.isPaused = true;

  this.deps.modalManager.showCustom({
    title: 'Match Draw',
    message: 'All players eliminated simultaneously!',
    buttons: [
      { text: 'Rematch', action: () => this.onStart() },
      { text: 'Main Menu', action: () => this.onStop() },
    ],
  });
}
```

---

### Phase 7: Performance Optimization

#### 7.1 Update Game Loop with Per-Player Pause

**File**: `src/core/game-modes/LocalMultiplayerMode.js`

**Update `_startGameLoop()` method**:

```javascript
_startGameLoop() {
  let frameCount = 0;

  const loop = (currentTime) => {
    if (!this.isRunning || this.multiplayerState.isGameOver) {
      return;
    }

    if (this.multiplayerState.isPaused) {
      this.animationFrameId = requestAnimationFrame(loop);
      return;
    }

    const delta = currentTime - this.multiplayerState.lastTime;
    this.multiplayerState.lastTime = currentTime;

    // Update all players
    for (let playerIndex = 0; playerIndex < this.multiplayerState.numPlayers; playerIndex++) {
      const playerState = this.multiplayerState.players[playerIndex];

      // Skip dead players
      if (!playerState.isAlive) {
        continue;
      }

      // Skip players in exploration mode
      if (this.multiplayerState.playerPaused[playerIndex]) {
        continue;
      }

      // Run physics for this player
      if (!playerState.isProcessingPhysics && playerState.currentPiece) {
        playerState.dropCounter += delta;

        if (playerState.dropCounter > playerState.dropInterval) {
          const callbacks = this.deps.getMultiplayerPhysicsCallbacks?.(playerIndex + 1)
            || this._getPhysicsCallbacks();

          softDrop(
            playerState,
            () => this.deps.soundManager.sfxPlayer.playDrop(),
            callbacks,
          );
        }
      }

      // Expand grid if needed (infinity mode)
      if (playerState.isInfinityMode) {
        const requiredRows = Math.min(1000, playerState.board.length + 10);
        expandGridIfNeeded(playerState, requiredRows);
      }
    }

    // Update stats and scenes
    this._updateMultiplayerStats();
    this._syncBoardScenes();

    // Continue loop
    this.animationFrameId = requestAnimationFrame(loop);
  };

  console.log('[LocalMultiplayer] Starting game loop...');
  this.animationFrameId = requestAnimationFrame(loop);
}
```

#### 7.2 Performance Target

With optimizations:
- **Game logic**: 4 players × ~2ms = 8ms
- **Rendering**: Phaser auto-optimized per scene
- **Minimap updates**: 16ms throttle (built-in)
- **Camera updates**: Per-frame, minimal overhead

**Target**: 45-50fps sustained with 4 players (acceptable for competitive gameplay)

---

### Phase 8: Testing & Verification

#### Test Scenarios

**Scenario 1: 2-Player FFA**
- [ ] Both players get 1000-row boards
- [ ] Boards fit side-by-side on 1920x1080 screen
- [ ] Minimaps show on right side of each player card
- [ ] Each minimap shows full 1000-row grid
- [ ] Click minimap - camera jumps to location
- [ ] Drag minimap - pauses that player's game, explores board
- [ ] Other player continues playing during exploration
- [ ] Cameras follow independently (one up, one down)
- [ ] Player elimination works correctly
- [ ] Victory screen shows winning player

**Scenario 2: 4-Player FFA**
- [ ] All 4 boards visible horizontally
- [ ] Block size scales appropriately (12-24px range)
- [ ] 4 minimaps visible and functional
- [ ] Maintains 45+ fps during gameplay
- [ ] All 4 cameras work independently
- [ ] Last player standing wins
- [ ] Victory animation plays for winner

**Scenario 3: 2v2 Team Mode**
- [ ] Team assignments visible (Team A/Team B markers)
- [ ] Garbage only targets opponents (not teammates)
- [ ] Team elimination works (both teammates must die)
- [ ] Last team standing wins
- [ ] Victory screen shows winning team

**Scenario 4: Grid Expansion**
- [ ] Grids expand independently per player
- [ ] No camera jumps during expansion
- [ ] Other players unaffected by expansion
- [ ] Expansion works up to 1000 rows

**Scenario 5: Minimap Exploration**
- [ ] Player 1 drags minimap - P1 pauses, others continue
- [ ] P1 releases - P1 resumes gameplay smoothly
- [ ] Multiple players can explore simultaneously
- [ ] Camera returns to gameplay position after exploration

**Scenario 6: Performance**
- [ ] 60fps with 2 players
- [ ] 45-50fps with 4 players
- [ ] No lag during grid expansion
- [ ] Smooth camera transitions

---

## Critical Files Summary

### Files to Modify

1. `src/ui/local-match-config-modal.js` - Add "Infinity LMS" option, conditional UI
2. `src/core/multi-player-state.js` - Initialize infinity GameStates, per-player pause
3. `src/core/game-modes/LocalMultiplayerMode.js` - Main orchestration, minimap creation, camera updates, win conditions
4. `public/styles/multiplayer-ui.css` - Responsive layout for tall boards, minimap positioning
5. `src/rendering/phaser/base-board-scene.js` - Verify camera configuration (minimal changes)

### Files to Import/Reuse

- `src/core/infinity-grid.js` - `createInfinityGrid()`, `expandGridIfNeeded()`
- `src/ui/infinity/InfinityMinimap.js` - Minimap component (reuse as-is)
- `src/core/game-modes/InfinityMode.js` - Reference for camera logic patterns

---

## Implementation Timeline

**Phase 1 (Day 1)**: Mode Selection
- Add Infinity LMS to modal
- Test configuration flow

**Phase 2 (Day 2)**: Board Architecture
- Initialize infinity GameStates
- Test 2-player infinity boards

**Phase 3 (Day 3)**: Layout & Camera
- Implement responsive CSS
- Verify camera independence
- Test 4-player layout

**Phase 4 (Day 4)**: Minimaps
- Create per-player minimaps
- Position in player cards
- Test minimap updates

**Phase 5 (Day 5)**: Exploration Mode
- Per-player pause state
- Event handling
- Test exploration with multiple players

**Phase 6 (Day 6)**: Team Mode
- Win condition logic
- Test 2v2 scenarios

**Phase 7 (Day 7)**: Performance
- Optimize game loop
- Test with 4 players
- Measure FPS

**Phase 8 (Day 8)**: Testing
- Run all test scenarios
- Bug fixes
- Polish

---

## Success Criteria

✅ User can select "Infinity LMS" from Local Multiplayer setup
✅ 2-4 players each get independent 1000-row boards
✅ Boards fit horizontally on standard displays (1920x1080+)
✅ Each player has functional minimap with exploration
✅ One player explores without affecting others
✅ Cameras follow independently per player
✅ Garbage system works with infinity boards
✅ Team mode works (2v2 with team victory)
✅ Last player/team standing wins
✅ Maintains 45+ fps with 4 players

---

## Risk Mitigation

**Risk**: Layout too cramped with 4 players
**Mitigation**: Allow horizontal scroll or fallback to 2x2 grid for <1600px width

**Risk**: Performance below 30fps
**Mitigation**: Reduce minimap update rate to 32ms, disable particle effects

**Risk**: Minimap too small to interact with
**Mitigation**: Add click-to-expand overlay mode (full-size minimap)

---

This plan provides a complete roadmap for implementing Infinity Last Man Standing mode while reusing existing systems and maintaining code quality. The architecture leverages the existing multiplayer foundation and extends it cleanly with infinity mechanics.
