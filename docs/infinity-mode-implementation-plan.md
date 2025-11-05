# Infinity Mode - Implementation Plan

## Overview
Infinity Mode is a new single-player game mode for Serenity Blocks that challenges players to build the largest possible combo within a massive 1000-row vertical playfield. This mode leverages the game's cascaded gravity system for spectacular chain reactions and emphasizes endurance, planning, and creativity.

---

## Core Features

### 1. Extended Playfield
- **Current:** 20 visible rows + 4 hidden rows (24 total)
- **New:** 1000 total rows, 20 visible at a time
- Dynamic camera follows player progress upward
- Playfield grows as player builds higher

### 2. Dynamic Camera System
- 20-row viewport that scrolls vertically
- Smooth camera tracking as blocks lock in higher positions
- Camera follows highest active/locked block position
- Pan controls during pause mode for strategic planning

### 3. Minimap/Overview Panel
- Compact zoomed-out view of entire build (up to 1000 rows)
- Updates in real-time as player progresses
- Clickable/scrollable during pause for navigation
- Visual indicators for:
  - Current camera viewport position
  - Density/fill level per section
  - Potential cascade chains

### 4. Goal System
- Primary objective: Create the biggest possible combo
- Track personal best combo depth and complexity
- Optional: Progressive milestones (reach row 100, 250, 500, 1000)
- Persistent statistics and achievements

---

## Technical Architecture

### Phase 1: Core Mode Structure

#### 1.1 Create Mode Class
**File:** `src/core/game-modes/InfinityMode.js`

**Structure:**
```javascript
import BaseGameMode from './BaseGameMode.js';
import { GAME_MODES } from '../constants.js';

export default class InfinityMode extends BaseGameMode {
    constructor() {
        super(GAME_MODES.INFINITY);
        this.maxRows = 1000;
        this.visibleRows = 20;
        this.currentTopRow = 0; // Tracks how high player has built
        this.gameState = null;
        this.cameraPosition = 0; // Current viewport offset
    }

    // Lifecycle methods
    onActivate() { /* Setup UI, show config modal */ }
    onStart() { /* Initialize game state, start loop */ }
    onPause() { /* Enable minimap navigation */ }
    onResume() { /* Return to game */ }
    onStop() { /* Save stats, show results */ }
    onDeactivate() { /* Cleanup */ }

    // Infinity-specific methods
    updateCameraPosition() { /* Follow highest blocks */ }
    expandPlayfield() { /* Add rows as needed */ }
    checkMilestone() { /* Track progression goals */ }
}
```

**Key Responsibilities:**
- Manage extended game state with dynamic grid
- Control camera viewport positioning
- Track combo records and milestones
- Interface with minimap component
- Handle pause-mode navigation

#### 1.2 Register Mode
**File:** `src/core/game-modes/GameModeManager.js`

**Changes:**
```javascript
import InfinityMode from './InfinityMode.js';

_registerModes() {
    this.registerMode(new SinglePlayerMode());
    this.registerMode(new LocalMultiplayerMode());
    this.registerMode(new OnlineMultiplayerMode());
    this.registerMode(new SerenityMode());
    this.registerMode(new InfinityMode()); // ADD THIS
}
```

#### 1.3 Add Mode Constant
**File:** `src/core/constants.js`

**Changes:**
```javascript
export const GAME_MODES = {
    SINGLE_PLAYER: 'single',
    LOCAL_MULTIPLAYER: 'local-multiplayer',
    ONLINE_MULTIPLAYER: 'online-multiplayer',
    SERENITY: 'serenity',
    INFINITY: 'infinity', // ADD THIS
};
```

---

### Phase 2: Dynamic Grid System

#### 2.1 Extend Game State
**File:** `src/core/game.js`

**Changes to `createGameState()`:**
```javascript
export function createGameState(options = {}) {
    const {
        cols = COLS,
        rows = ROWS,
        hiddenRows = HIDDEN_ROWS,
        isInfinityMode = false, // NEW
        maxRows = 1000,         // NEW
    } = options;

    return {
        // ... existing properties
        isInfinityMode,         // NEW
        maxRows,                // NEW
        currentTopRow: 0,       // NEW: Highest row with blocks
        cameraRow: 0,           // NEW: Current camera offset

        // Dynamic grid creation
        board: isInfinityMode
            ? createInfinityGrid(cols, rows, hiddenRows)
            : createBoardGrid(),
    };
}

function createInfinityGrid(cols, initialRows, hiddenRows) {
    // Start with standard size, expand as needed
    return Array.from({ length: initialRows + hiddenRows }, () =>
        Array(cols).fill(null)
    );
}
```

#### 2.2 Grid Expansion Logic
**New File:** `src/core/infinity-grid.js`

```javascript
/**
 * Expands the playfield upward when player reaches high rows
 * @param {GameState} gameState
 * @param {number} requiredRows - Total rows needed
 */
export function expandGridIfNeeded(gameState, requiredRows) {
    const currentLength = gameState.board.length;

    if (requiredRows <= currentLength) return false;

    // Add 20 rows at a time for efficiency
    const rowsToAdd = Math.min(
        20,
        Math.min(requiredRows - currentLength, gameState.maxRows - currentLength)
    );

    if (rowsToAdd <= 0) return false;

    // Prepend new rows at the top
    const newRows = Array.from({ length: rowsToAdd }, () =>
        Array(gameState.board[0].length).fill(null)
    );

    gameState.board = [...newRows, ...gameState.board];

    // Update piece positions to account for offset
    gameState.lockedPieces.forEach(piece => {
        piece.blocks.forEach(block => {
            block.row += rowsToAdd;
        });
    });

    if (gameState.currentPiece) {
        gameState.currentPiece.row += rowsToAdd;
    }

    return true;
}

/**
 * Calculates the highest row containing blocks
 * @param {GameState} gameState
 * @returns {number}
 */
export function calculateTopRow(gameState) {
    let topRow = gameState.board.length;

    for (let r = 0; r < gameState.board.length; r++) {
        for (let c = 0; c < gameState.board[r].length; c++) {
            if (gameState.board[r][c] !== null) {
                topRow = Math.min(topRow, r);
                break;
            }
        }
    }

    return topRow;
}
```

---

### Phase 3: Camera System

#### 3.1 Modify Base Board Scene
**File:** `src/rendering/phaser/base-board-scene.js`

**Add Camera Controls:**
```javascript
configureCamera() {
    const camera = this.cameras?.main;

    if (this.isInfinityMode) {
        // Infinity mode: camera can scroll through entire grid
        const totalHeight = this.maxRows * BLOCK_SIZE;
        camera.setBounds(0, 0, this.boardWidth, totalHeight);

        // Enable smooth scrolling
        camera.setLerp(0.1, 0.1); // Smooth follow
    } else {
        // Standard mode: fixed camera
        camera.setBounds(0, 0, this.boardWidth, this.boardHeight);
        camera.centerOn(this.boardWidth / 2, this.visibleHeight / 2);
    }
}

updateCameraPosition(targetRow) {
    if (!this.isInfinityMode) return;

    const camera = this.cameras.main;
    const blockSize = BLOCK_SIZE;

    // Center camera on target row, keeping 20 rows visible
    const targetY = targetRow * blockSize + (this.visibleRows / 2) * blockSize;

    camera.scrollY = targetY - camera.height / 2;

    // Clamp to valid range
    camera.scrollY = Math.max(0, Math.min(
        camera.scrollY,
        this.maxRows * blockSize - camera.height
    ));
}

// Add pause-mode camera controls
enableManualCameraControl() {
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
        if (this.gamePaused) {
            this.cameras.main.scrollY += deltaY * 0.5;
        }
    });

    // Keyboard controls for precision
    this.cursors = this.input.keyboard.addKeys({
        up: 'UP',
        down: 'DOWN',
        pageUp: 'PAGEUP',
        pageDown: 'PAGEDOWN'
    });
}

updateManualCamera(delta) {
    if (!this.gamePaused) return;

    const scrollSpeed = 5;
    const pageSpeed = 100;

    if (this.cursors.up.isDown) {
        this.cameras.main.scrollY -= scrollSpeed;
    }
    if (this.cursors.down.isDown) {
        this.cameras.main.scrollY += scrollSpeed;
    }
    if (this.cursors.pageUp.isDown) {
        this.cameras.main.scrollY -= pageSpeed;
    }
    if (this.cursors.pageDown.isDown) {
        this.cameras.main.scrollY += pageSpeed;
    }
}
```

#### 3.2 Camera Following Logic
**In `InfinityMode.js`:**

```javascript
_startGameLoop() {
    const loop = (currentTime) => {
        // Sync game state to scene
        boardScene.syncFromGameState(this.gameState);

        // Update camera to follow highest blocks
        const topRow = calculateTopRow(this.gameState);
        this.gameState.currentTopRow = topRow;

        // Camera follows active piece or highest block
        const targetRow = this.gameState.currentPiece
            ? this.gameState.currentPiece.row
            : topRow + 10; // Keep some space below view

        boardScene.updateCameraPosition(targetRow);

        // Run game loop
        gameLoop(currentTime, this.gameState, /*...*/);

        // Check for grid expansion
        if (topRow < 30) { // Within 30 rows of top
            expandGridIfNeeded(this.gameState, this.gameState.board.length + 20);
        }

        this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
}
```

---

### Phase 4: Minimap System

#### 4.1 Create Minimap Component
**New File:** `src/ui/infinity-minimap.js`

```javascript
export class InfinityMinimap {
    constructor(containerId = 'infinity-minimap') {
        this.container = document.getElementById(containerId);
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        // Configuration
        this.minimapWidth = 50;  // pixels
        this.minimapMaxHeight = 600; // pixels
        this.pixelsPerRow = 0.6; // Compression ratio

        this._setupCanvas();
        this._setupInteraction();
    }

    _setupCanvas() {
        this.canvas.width = this.minimapWidth;
        this.canvas.className = 'minimap-canvas';
        this.container.appendChild(this.canvas);
    }

    /**
     * Renders the minimap from game state
     * @param {GameState} gameState
     * @param {number} currentViewportRow - Current camera position
     */
    render(gameState, currentViewportRow) {
        const { board, maxRows } = gameState;
        const ctx = this.ctx;

        // Calculate actual height based on built area
        const topRow = calculateTopRow(gameState);
        const builtRows = board.length - topRow;
        this.canvas.height = Math.min(
            builtRows * this.pixelsPerRow,
            this.minimapMaxHeight
        );

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Render blocks (sample every N rows for performance)
        const sampleRate = Math.max(1, Math.floor(builtRows / this.minimapMaxHeight));

        for (let r = topRow; r < board.length; r += sampleRate) {
            for (let c = 0; c < board[r].length; c++) {
                if (board[r][c] !== null) {
                    const x = c * (this.minimapWidth / board[r].length);
                    const y = (r - topRow) * this.pixelsPerRow;
                    const blockWidth = this.minimapWidth / board[r].length;
                    const blockHeight = this.pixelsPerRow * sampleRate;

                    ctx.fillStyle = board[r][c].color || '#00ff00';
                    ctx.fillRect(x, y, blockWidth, blockHeight);
                }
            }
        }

        // Draw viewport indicator
        this._drawViewportIndicator(currentViewportRow, topRow);
    }

    _drawViewportIndicator(viewportRow, topRow) {
        const ctx = this.ctx;
        const y = (viewportRow - topRow) * this.pixelsPerRow;
        const height = 20 * this.pixelsPerRow; // 20 visible rows

        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, y, this.minimapWidth, height);
    }

    _setupInteraction() {
        // Click to jump camera to position
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clickY = e.clientY - rect.top;

            // Convert to row number
            const targetRow = Math.floor(clickY / this.pixelsPerRow);

            // Dispatch event for camera to jump
            window.dispatchEvent(new CustomEvent('minimapJumpTo', {
                detail: { row: targetRow }
            }));
        });
    }

    show() {
        this.container.style.display = 'block';
    }

    hide() {
        this.container.style.display = 'none';
    }
}
```

#### 4.2 Add Minimap Container to HTML
**File:** `index.html`

```html
<!-- Add to single-player-stage section -->
<div class="single-player-stage">
    <div id="single-player-container">
        <div id="phaser-game-container"></div>

        <!-- ADD THIS -->
        <div id="infinity-minimap-container" class="minimap-panel" style="display: none;">
            <div class="minimap-header">
                <h3>Overview</h3>
                <span class="minimap-stats"></span>
            </div>
            <div id="infinity-minimap"></div>
        </div>
        <!-- END ADD -->

        <div id="next-container"><!-- ... --></div>
    </div>
</div>
```

#### 4.3 Minimap Styling
**File:** `src/styles/components/infinity.css` (new file)

```css
.minimap-panel {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.8);
    border: 2px solid #00ff00;
    border-radius: 8px;
    padding: 10px;
    z-index: 100;
}

.minimap-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
    color: #00ff00;
    font-size: 12px;
}

.minimap-canvas {
    border: 1px solid #00ff00;
    cursor: pointer;
    display: block;
}

.minimap-canvas:hover {
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
}

.minimap-stats {
    font-size: 10px;
    opacity: 0.7;
}
```

---

### Phase 5: UI Integration

#### 5.1 Add Mode to Start Modal
**File:** `index.html`

**Add mode card to start modal:**
```html
<div id="start-modal" class="modal active">
    <div class="modal-content">
        <h1>Serenity Blocks</h1>

        <div class="mode-selection">
            <!-- Existing modes... -->

            <!-- ADD THIS -->
            <div class="mode-card" data-mode="infinity">
                <div class="mode-icon">∞</div>
                <h2>Infinity Mode</h2>
                <p>Build upward through 1000 rows and create the ultimate combo cascade</p>
                <ul class="mode-features">
                    <li>1000-row vertical playfield</li>
                    <li>Dynamic camera following</li>
                    <li>Strategic minimap view</li>
                    <li>Endless combo potential</li>
                </ul>
                <button class="mode-select-btn" data-mode="infinity">
                    Play Infinity
                </button>
            </div>
            <!-- END ADD -->
        </div>
    </div>
</div>
```

#### 5.2 Update Mode Selection Handler
**File:** `src/ui/game-mode-ui.js`

```javascript
// Should already handle any mode automatically via data-mode attribute
// Verify that infinity mode is properly registered and will be activated

selectModeAndStart(mode) {
    // This should work as-is for infinity mode
    this.selectMode(mode);

    window.dispatchEvent(new CustomEvent('startGameWithMode', {
        detail: { mode }
    }));
}
```

#### 5.3 Create Configuration Modal (Optional)
**New File:** `src/ui/infinity-config-modal.js`

```javascript
export class InfinityConfigModal {
    constructor() {
        this.modal = document.getElementById('infinity-config-modal');
        this.startButton = this.modal?.querySelector('.start-game-btn');

        this._setupEventListeners();
    }

    show() {
        this.modal?.classList.add('active');
    }

    hide() {
        this.modal?.classList.remove('active');
    }

    getConfig() {
        return {
            maxRows: 1000,
            showMinimap: this.modal?.querySelector('#show-minimap')?.checked ?? true,
            enableMilestones: this.modal?.querySelector('#enable-milestones')?.checked ?? true,
        };
    }

    _setupEventListeners() {
        this.startButton?.addEventListener('click', () => {
            const config = this.getConfig();
            window.dispatchEvent(new CustomEvent('infinityModeStart', {
                detail: config
            }));
            this.hide();
        });
    }
}
```

**Add modal HTML to `index.html`:**
```html
<div id="infinity-config-modal" class="modal">
    <div class="modal-content">
        <h2>Infinity Mode Settings</h2>

        <div class="config-section">
            <label>
                <input type="checkbox" id="show-minimap" checked>
                Show Minimap
            </label>

            <label>
                <input type="checkbox" id="enable-milestones" checked>
                Enable Milestone Notifications
            </label>
        </div>

        <div class="modal-actions">
            <button class="btn-secondary cancel-btn">Cancel</button>
            <button class="btn-primary start-game-btn">Start Game</button>
        </div>
    </div>
</div>
```

---

### Phase 6: Combo Tracking Enhancement

#### 6.1 Extended Combo Statistics
**File:** `src/core/game.js`

**Add to game state:**
```javascript
export function createGameState(options = {}) {
    return {
        // ... existing properties

        // Infinity mode combo tracking
        infinityStats: options.isInfinityMode ? {
            maxComboDepth: 0,        // Highest cascade depth achieved
            maxComboComplexity: 0,   // Most cascade stages
            totalCascades: 0,        // Total cascades triggered
            rowsReached: 0,          // Highest row built to
            blocksPlaced: 0,         // Total blocks locked
            sessionStartTime: Date.now(),
        } : null,
    };
}
```

#### 6.2 Update Combo Callback
**In `InfinityMode.js`:**

```javascript
_setupComboTracking() {
    this.gameState.triggerCombo = (cascadeCount) => {
        const combo = this.gameState.combo;

        // Update infinity stats
        if (this.gameState.infinityStats) {
            const stats = this.gameState.infinityStats;
            stats.totalCascades++;
            stats.maxComboDepth = Math.max(stats.maxComboDepth, combo.depth);
            stats.maxComboComplexity = Math.max(stats.maxComboComplexity, combo.complexity);

            // Check for milestones
            this._checkComboMilestone(combo);
        }

        // Visual effects
        this._showComboEffect(cascadeCount);
    };
}

_checkComboMilestone(combo) {
    const milestones = [10, 20, 50, 100, 200, 500];

    if (milestones.includes(combo.depth)) {
        this._showMilestoneNotification(`${combo.depth} Line Combo!`);
    }
}

_showMilestoneNotification(message) {
    // Create floating notification
    const notification = document.createElement('div');
    notification.className = 'infinity-milestone';
    notification.textContent = message;
    document.body.appendChild(notification);

    // Animate and remove
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}
```

---

### Phase 7: Performance Optimization

#### 7.1 Viewport Culling
**File:** `src/rendering/phaser/infinity-board-scene.js` (new specialized scene)

```javascript
export class InfinityBoardScene extends BaseBoardScene {
    constructor() {
        super('InfinityBoard');
        this.renderBuffer = 5; // Extra rows above/below viewport
    }

    syncFromGameState(gameState) {
        // Only render blocks within viewport + buffer
        const cameraRow = Math.floor(this.cameras.main.scrollY / BLOCK_SIZE);
        const viewportRows = Math.ceil(this.cameras.main.height / BLOCK_SIZE);

        const startRow = Math.max(0, cameraRow - this.renderBuffer);
        const endRow = Math.min(
            gameState.board.length,
            cameraRow + viewportRows + this.renderBuffer
        );

        // Render only visible portion
        this._renderVisibleBlocks(gameState, startRow, endRow);
    }

    _renderVisibleBlocks(gameState, startRow, endRow) {
        // Clear old blocks outside viewport
        this.blockSprites.forEach((sprite, key) => {
            const row = parseInt(key.split(',')[0]);
            if (row < startRow || row >= endRow) {
                sprite.destroy();
                this.blockSprites.delete(key);
            }
        });

        // Render visible blocks
        for (let r = startRow; r < endRow; r++) {
            for (let c = 0; c < gameState.board[r].length; c++) {
                const cell = gameState.board[r][c];
                if (cell !== null) {
                    this._renderBlock(r, c, cell);
                }
            }
        }
    }
}
```

#### 7.2 Minimap Update Throttling
**In `InfinityMinimap.js`:**

```javascript
constructor(containerId) {
    // ... existing code
    this.lastRenderTime = 0;
    this.renderInterval = 100; // Update every 100ms max
}

render(gameState, currentViewportRow) {
    const now = Date.now();
    if (now - this.lastRenderTime < this.renderInterval) {
        // Only update viewport indicator
        this._drawViewportIndicator(currentViewportRow, this.lastTopRow);
        return;
    }

    this.lastRenderTime = now;

    // Full render
    // ... existing render code
}
```

---

### Phase 8: Game Over and Results

#### 8.1 Infinity Game Over Screen
**File:** `src/ui/infinity-results-modal.js`

```javascript
export class InfinityResultsModal {
    constructor() {
        this.modal = document.getElementById('infinity-results-modal');
    }

    show(gameState) {
        const stats = gameState.infinityStats;
        const duration = Date.now() - stats.sessionStartTime;

        // Update modal content
        this._updateStats({
            maxCombo: stats.maxComboDepth,
            complexity: stats.maxComboComplexity,
            totalCascades: stats.totalCascades,
            rowsReached: stats.rowsReached,
            blocksPlaced: stats.blocksPlaced,
            duration: this._formatDuration(duration),
            score: gameState.score,
        });

        // Check for new records
        this._checkRecords(stats);

        this.modal.classList.add('active');
    }

    _updateStats(stats) {
        this.modal.querySelector('.max-combo').textContent = stats.maxCombo;
        this.modal.querySelector('.complexity').textContent = stats.complexity;
        this.modal.querySelector('.total-cascades').textContent = stats.totalCascades;
        this.modal.querySelector('.rows-reached').textContent = stats.rowsReached;
        this.modal.querySelector('.blocks-placed').textContent = stats.blocksPlaced;
        this.modal.querySelector('.duration').textContent = stats.duration;
        this.modal.querySelector('.final-score').textContent = stats.score.toLocaleString();
    }

    _checkRecords(stats) {
        // Load previous records
        const records = this._loadRecords();

        const newRecords = [];
        if (stats.maxComboDepth > records.maxComboDepth) {
            newRecords.push('New Combo Record!');
            records.maxComboDepth = stats.maxComboDepth;
        }
        if (stats.rowsReached > records.rowsReached) {
            newRecords.push('New Height Record!');
            records.rowsReached = stats.rowsReached;
        }

        if (newRecords.length > 0) {
            this._showRecordBadges(newRecords);
            this._saveRecords(records);
        }
    }

    _formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        return `${minutes}m ${seconds % 60}s`;
    }

    _loadRecords() {
        const stored = localStorage.getItem('infinityRecords');
        return stored ? JSON.parse(stored) : {
            maxComboDepth: 0,
            maxComboComplexity: 0,
            rowsReached: 0,
        };
    }

    _saveRecords(records) {
        localStorage.setItem('infinityRecords', JSON.stringify(records));
    }
}
```

**Add modal HTML:**
```html
<div id="infinity-results-modal" class="modal">
    <div class="modal-content">
        <h2>Infinity Mode Complete</h2>

        <div class="results-grid">
            <div class="stat-card">
                <div class="stat-label">Max Combo</div>
                <div class="stat-value max-combo">0</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Cascade Complexity</div>
                <div class="stat-value complexity">0</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Total Cascades</div>
                <div class="stat-value total-cascades">0</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Rows Reached</div>
                <div class="stat-value rows-reached">0</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Blocks Placed</div>
                <div class="stat-value blocks-placed">0</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Time Played</div>
                <div class="stat-value duration">0m 0s</div>
            </div>

            <div class="stat-card featured">
                <div class="stat-label">Final Score</div>
                <div class="stat-value final-score">0</div>
            </div>
        </div>

        <div class="record-badges"></div>

        <div class="modal-actions">
            <button class="btn-secondary menu-btn">Main Menu</button>
            <button class="btn-primary play-again-btn">Play Again</button>
        </div>
    </div>
</div>
```

---

## Implementation Checklist

### Phase 1: Foundation (2-3 hours)
- [ ] Create `InfinityMode.js` class
- [ ] Register mode in `GameModeManager.js`
- [ ] Add `INFINITY` constant to `constants.js`
- [ ] Add mode card to start modal HTML
- [ ] Test mode activation/deactivation flow

### Phase 2: Dynamic Grid (3-4 hours)
- [ ] Create `infinity-grid.js` utility functions
- [ ] Modify `createGameState()` for infinity mode
- [ ] Implement grid expansion logic
- [ ] Implement `calculateTopRow()` helper
- [ ] Test grid expansion with locked pieces
- [ ] Verify piece position updates after expansion

### Phase 3: Camera System (4-5 hours)
- [ ] Modify `BaseBoardScene.configureCamera()` for infinity mode
- [ ] Implement `updateCameraPosition()` method
- [ ] Add smooth camera following logic
- [ ] Implement pause-mode camera controls (mouse wheel, arrows)
- [ ] Test camera bounds and clamping
- [ ] Add camera smoothing/lerp

### Phase 4: Minimap (5-6 hours)
- [ ] Create `InfinityMinimap.js` component
- [ ] Add minimap container to HTML
- [ ] Style minimap panel (CSS)
- [ ] Implement minimap rendering algorithm
- [ ] Add viewport indicator overlay
- [ ] Implement click-to-jump functionality
- [ ] Add performance throttling
- [ ] Test with various grid sizes

### Phase 5: UI Integration (2-3 hours)
- [ ] Create infinity mode card styling
- [ ] Add feature descriptions and icons
- [ ] Create optional config modal
- [ ] Wire up start button event handlers
- [ ] Test mode selection flow end-to-end

### Phase 6: Combo Enhancement (2-3 hours)
- [ ] Add `infinityStats` to game state
- [ ] Implement enhanced combo tracking
- [ ] Create milestone notification system
- [ ] Add floating notification CSS animations
- [ ] Test combo callbacks with cascades

### Phase 7: Performance (3-4 hours)
- [ ] Create `InfinityBoardScene` with viewport culling
- [ ] Implement visible block rendering
- [ ] Add sprite recycling for off-screen blocks
- [ ] Throttle minimap updates
- [ ] Profile performance with 1000 rows
- [ ] Optimize if needed (web workers, object pooling)

### Phase 8: Results & Polish (3-4 hours)
- [ ] Create `InfinityResultsModal.js`
- [ ] Add results modal HTML
- [ ] Style results screen
- [ ] Implement record tracking (localStorage)
- [ ] Add "new record" badges and animations
- [ ] Test game over flow
- [ ] Add play again / menu navigation

### Phase 9: Testing & Refinement (4-5 hours)
- [ ] End-to-end gameplay testing
- [ ] Test edge cases (reaching row 1000, grid limits)
- [ ] Performance testing with full grid
- [ ] UI/UX polish (transitions, feedback)
- [ ] Bug fixes
- [ ] Accessibility review
- [ ] Documentation updates

---

## Technical Considerations

### Performance
- **Viewport Culling:** Critical for maintaining 60fps with 1000 rows
- **Minimap Rendering:** Throttle updates and use sampling
- **Memory Management:** Recycle sprite objects when blocks leave viewport
- **Physics:** Existing cascade system should handle large grids well

### Camera Behavior
- **Smooth Following:** Use lerp to avoid jarring jumps
- **Lead Distance:** Keep camera slightly ahead of falling pieces
- **Pause Mode:** Full manual control with keyboard and mouse
- **Boundary Handling:** Prevent camera from showing empty space

### Grid Management
- **Lazy Expansion:** Only add rows when player approaches top
- **Batch Allocation:** Add 20 rows at a time for efficiency
- **Position Updates:** Careful offset adjustment when expanding
- **Memory Limits:** Monitor memory usage; consider hard cap at 1000 rows

### UX Enhancements
- **Tutorial:** First-time tooltip explaining controls
- **Milestones:** Celebratory effects at key heights (100, 250, 500, 1000)
- **Progress Bar:** Visual indicator of current height
- **Combo Visualization:** Enhanced effects for mega-combos

---

## Future Enhancements (Post-MVP)

### Leaderboards
- Track global records for max combo
- Height reached competition
- Time-to-milestone rankings

### Replay System
- Save and replay best combos
- Share replays with friends
- Slow-motion cascade viewer

### Advanced Features
- Custom grid sizes (500/1500/2000 rows)
- Challenge modifiers (speed increases, special blocks)
- Co-op infinity mode (two players building together)
- Seeded runs for competition

### Analytics
- Heatmap of block placement density
- Cascade pattern analysis
- Optimal strategy suggestions

---

## Estimated Timeline

**Total Implementation Time:** 28-37 hours

**Breakdown:**
- Core functionality (Phases 1-3): 9-12 hours
- Minimap and UI (Phases 4-5): 7-9 hours
- Enhancement and optimization (Phases 6-7): 5-7 hours
- Testing and polish (Phases 8-9): 7-9 hours

**Recommended Sprint Plan:**
- **Week 1:** Phases 1-3 (foundation + grid + camera)
- **Week 2:** Phases 4-5 (minimap + UI integration)
- **Week 3:** Phases 6-8 (enhancements + results)
- **Week 4:** Phase 9 (testing + polish)

---

## Files to Create

### New Files
1. `src/core/game-modes/InfinityMode.js` - Mode implementation
2. `src/core/infinity-grid.js` - Grid utilities
3. `src/ui/infinity-minimap.js` - Minimap component
4. `src/ui/infinity-config-modal.js` - Configuration modal
5. `src/ui/infinity-results-modal.js` - Results screen
6. `src/rendering/phaser/infinity-board-scene.js` - Optimized scene
7. `src/styles/components/infinity.css` - Mode-specific styles
8. `docs/infinity-mode-user-guide.md` - Player documentation

### Modified Files
1. `src/core/game-modes/GameModeManager.js` - Register mode
2. `src/core/constants.js` - Add mode constant
3. `src/core/game.js` - Extend game state
4. `src/rendering/phaser/base-board-scene.js` - Camera enhancements
5. `index.html` - Add UI elements
6. `src/styles/main.css` - Import infinity styles

---

## Risk Mitigation

### Technical Risks
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance degradation with 1000 rows | High | Medium | Implement viewport culling early; profile frequently |
| Memory leaks from sprite creation | High | Medium | Aggressive sprite recycling; monitor with dev tools |
| Camera physics feel wrong | Medium | High | Extensive playtesting; configurable parameters |
| Cascade calculations too slow | Medium | Low | Existing system proven; limit active cascade depth if needed |

### Design Risks
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Mode not engaging enough | High | Medium | Iterative playtesting; adjust scoring/milestones |
| Minimap unclear/confusing | Medium | Medium | User testing; clear visual indicators |
| Controls feel clunky | Medium | High | Iterate on camera speed/smoothing; add settings |

---

## Success Criteria

### MVP Requirements
- [ ] Player can select Infinity Mode from start menu
- [ ] Playfield expands to at least 1000 rows
- [ ] Camera smoothly follows player progress
- [ ] Minimap displays current build and viewport
- [ ] Game tracks max combo depth
- [ ] Results screen shows comprehensive stats
- [ ] Runs at 60fps with full grid

### Quality Metrics
- [ ] No memory leaks during 30+ minute session
- [ ] Camera feels smooth and responsive
- [ ] Minimap updates without frame drops
- [ ] All cascade effects work correctly at any height
- [ ] UI is intuitive for new players

### Player Experience
- [ ] Mode feels distinct from standard single-player
- [ ] Building upward is satisfying and rewarding
- [ ] Minimap provides strategic value
- [ ] Mega-combos feel spectacular
- [ ] Progression motivates continued play

---

## Testing Strategy

### Unit Tests
- Grid expansion logic
- Camera position calculations
- Combo stat tracking
- Record persistence

### Integration Tests
- Mode activation/deactivation flow
- Camera + minimap synchronization
- Game state serialization with extended grid
- UI event handlers

### Manual Testing Scenarios
1. Build to row 1000 and verify stability
2. Trigger 100+ line combo and verify tracking
3. Test pause-mode camera navigation
4. Verify minimap click-to-jump accuracy
5. Test game over with various stats
6. Verify records save/load correctly
7. Test mode switching without memory leaks

### Performance Benchmarks
- 60fps maintained with 500+ locked pieces
- Minimap render < 16ms per frame
- Grid expansion completes < 50ms
- Memory usage < 500MB at row 1000

---

## Documentation

### User Guide
Create `docs/infinity-mode-user-guide.md` with:
- Mode overview and objectives
- Camera controls explanation
- Minimap usage guide
- Strategy tips for mega-combos
- Milestone reference

### Developer Docs
Update existing docs:
- Architecture diagrams (new mode flow)
- Game state schema updates
- Performance optimization notes
- Adding future game modes (use Infinity as example)

---

## Conclusion

Infinity Mode represents a significant expansion to Serenity Blocks, adding a new dimension of strategic depth and endurance challenge. The implementation leverages existing systems (cascaded gravity, combo tracking, Phaser rendering) while introducing new technical challenges (dynamic grids, camera following, minimap rendering).

The phased approach ensures steady progress with testable milestones, while the modular architecture allows for iterative refinement based on playtesting feedback.

**Next Steps:**
1. Review this plan with the team
2. Set up development branch: `feature/infinity-mode`
3. Begin Phase 1 implementation
4. Schedule weekly playtest sessions
5. Iterate based on feedback

---

## Additional Considerations Not in Original Plan

After analyzing the codebase in depth, here are important considerations that should be added to the implementation:

### 1. Game Over Condition Modification

**Issue:** Standard game over check (`hasBlocksAbovePlayfield()`) won't work for Infinity Mode
- Current game over: Blocks extending above row 0 (into hidden rows)
- Infinity mode: Player SHOULD build above row 0 - that's the whole point!

**Solution Required:**
- Modify game over condition in Infinity Mode
- Game over only if player can't place next piece AND camera is at top
- Or: Game over when reaching absolute row 1000 limit
- Update `hasBlocksAbovePlayfield()` to check `gameState.isInfinityMode`

**Implementation:**
```javascript
// In infinity-grid.js or game.js
export function checkInfinityGameOver(gameState) {
    // Game over only if:
    // 1. Player reached max rows (1000), OR
    // 2. Current piece can't spawn (collision at spawn position)

    if (gameState.currentTopRow <= 0) {
        return true; // Hit the absolute top limit
    }

    // Check if next piece can spawn
    const spawnX = Math.floor(COLS / 2) - 1;
    const spawnY = 0; // Top of current grid

    if (gameState.nextPiece && !canPlacePiece(gameState, gameState.nextPiece, spawnX, spawnY)) {
        return true; // Can't spawn next piece
    }

    return false;
}
```

**Files to modify:**
- `src/core/board.js` - Update `hasBlocksAbovePlayfield()`
- `src/core/game-modes/InfinityMode.js` - Use custom game over check
- `src/core/game.js` - Add infinity-specific game over logic

---

### 2. Piece Spawning Position

**Issue:** Pieces spawn at a fixed position (top-center of grid)
- In standard mode: Spawns at row 0 (above visible area)
- In Infinity mode: Spawn position must follow camera viewport

**Solution Required:**
- Spawn pieces relative to current camera position
- Always spawn ~2 rows above current viewport top
- Ensures piece is visible immediately when spawned

**Implementation:**
```javascript
// In InfinityMode.js
_getSpawnPosition() {
    const cameraRow = Math.floor(this.gameState.cameraRow);
    const spawnRow = cameraRow - 2; // 2 rows above viewport
    const spawnCol = Math.floor(COLS / 2) - 1;

    return { row: spawnRow, col: spawnCol };
}

_spawnNextPiece() {
    const { row, col } = this._getSpawnPosition();
    // Use these coordinates when creating/positioning next piece
}
```

**Files to modify:**
- `src/core/game-modes/InfinityMode.js` - Custom spawn logic
- `src/core/game.js` - Make spawn position configurable

---

### 3. Hidden Rows Concept

**Issue:** Standard game has 4 "hidden rows" above visible area for piece spawning
- Infinity mode: Entire grid is visible (via scrolling)
- Hidden rows concept doesn't make sense in this mode

**Solution Required:**
- Remove or redefine hidden rows for Infinity mode
- All rows are "visible" (just not in viewport at once)
- Spawn pieces at dynamic position as described above

**Implementation:**
```javascript
// In infinity-grid.js
export function createInfinityGrid(cols, initialRows) {
    // No hidden rows - all rows are scrollable/visible
    return Array.from({ length: initialRows }, () =>
        Array(cols).fill(null)
    );
}
```

---

### 4. Board Cache Management

**Issue:** The game uses board caching (`ensureBoardCache()`) for performance
- Standard mode: Fixed size (24x10 grid)
- Infinity mode: Dynamic size (up to 1000x10)

**Considerations:**
- Cache invalidation when grid expands
- Memory usage with large cached boards
- Performance of cache rebuild with hundreds of locked pieces

**Solution Required:**
```javascript
// In infinity-grid.js
export function expandGridAndInvalidateCache(gameState, requiredRows) {
    const expanded = expandGridIfNeeded(gameState, requiredRows);

    if (expanded) {
        // Invalidate board cache since grid size changed
        markBoardDirty(gameState);
    }

    return expanded;
}
```

**Alternative Optimization:**
- Don't cache entire board, only visible viewport region
- Lazy cache: Only build cache for viewport ± buffer rows

---

### 5. Level Progression System

**Issue:** Standard mode has level-up system affecting fall speed (`LEVEL_SPEEDS`)
- Level increases based on lines cleared
- Fall speed increases with level

**Decision Required:**
Should Infinity Mode have level progression?

**Option A: Disable levels (recommended for MVP)**
- Fixed fall speed throughout session
- Focus purely on combo building
- Simpler, more meditative experience

**Option B: Progressive difficulty**
- Speed increases at height milestones (every 100 rows)
- Adds challenge but may frustrate long sessions
- More traditional "endless" mode feel

**Implementation (Option A):**
```javascript
// In InfinityMode.js - createGameState
this.gameState = createGameState({
    isInfinityMode: true,
    maxRows: 1000,
    disableLevelProgression: true, // NEW: Lock level at 1
});
```

---

### 6. Pause Behavior During Cascades

**Issue:** Large combos in Infinity Mode could cascade for LONG periods
- 100+ line combo could take 30+ seconds to cascade
- Player might want to pause mid-cascade to review structure

**Solution Required:**
- Allow pause during cascade animation
- Freeze physics loop on pause
- Resume cascade animation on unpause

**Implementation:**
```javascript
// In InfinityMode.js
async onPause() {
    super.onPause();

    // Pause any ongoing cascade animations
    if (this.gameState.physicsInProgress) {
        this.pausedDuringCascade = true;
        // Physics loop will check isPaused flag and halt
    }

    // Enable camera navigation during pause
    this.boardScene.enableManualCameraControl();
}
```

**Files to modify:**
- `src/core/physics.js` - Check pause state during cascade loop
- `src/core/game-modes/InfinityMode.js` - Handle pause/resume

---

### 7. Visual Indicators for Height Progress

**Issue:** Player has no sense of progress without visual feedback
- How high have I built?
- Am I approaching a milestone?
- How far from row 1000?

**Solution Required:**
Add visual progress indicators:

1. **Height Counter** (HUD element)
   ```
   Height: 247 / 1000 rows
   ```

2. **Milestone Markers** (on minimap)
   - Visual lines at 100, 250, 500, 750, 1000
   - Color-coded zones (blue → green → yellow → red)

3. **Progress Bar** (optional)
   - Thin bar showing 0-1000 row progress

**Implementation:**
```javascript
// In infinity-minimap.js
_drawMilestoneMarkers() {
    const milestones = [100, 250, 500, 750, 1000];
    const ctx = this.ctx;

    milestones.forEach(row => {
        const y = row * this.pixelsPerRow;
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.minimapWidth, y);
        ctx.stroke();
    });
}
```

**New files:**
- `src/ui/infinity-hud.js` - Height counter component

---

### 8. Save/Resume Functionality

**Issue:** Long sessions (building to row 1000) could take hours
- Players may want to save progress and return later
- Browser refresh would lose all progress

**Solution (Post-MVP):**
- Auto-save game state every N seconds
- Save to localStorage or IndexedDB
- "Resume Last Session" option in mode selection
- Serialize: board state, locked pieces, stats, camera position

**Considerations:**
- Large save data (1000 rows × 10 cols + piece data)
- Compression may be needed
- Version compatibility for save format

---

### 9. Zoom Controls for Minimap

**Issue:** At 1000 rows, minimap becomes very compressed
- Hard to see detail in any single section
- Click-to-jump may not be precise enough

**Solution (Enhancement):**
- Minimap zoom levels (1x, 2x, 4x)
- When zoomed, minimap shows subset of grid centered on viewport
- Scroll minimap to pan through full height

**Implementation:**
```javascript
// In infinity-minimap.js
setZoomLevel(level) {
    this.zoomLevel = level; // 1, 2, or 4
    this.render(); // Re-render at new zoom
}

render(gameState, currentViewportRow) {
    if (this.zoomLevel > 1) {
        // Calculate visible subset based on zoom
        const rowsToShow = 1000 / this.zoomLevel;
        const centerRow = currentViewportRow;
        const startRow = centerRow - rowsToShow / 2;
        const endRow = centerRow + rowsToShow / 2;

        // Render only this range
        this._renderRange(gameState, startRow, endRow);
    } else {
        // Normal full minimap
        this._renderFull(gameState);
    }
}
```

---

### 10. Keyboard Shortcut Conflicts

**Issue:** Infinity Mode adds many keyboard shortcuts
- Camera controls (arrows, page up/down)
- These might conflict with piece movement in other contexts

**Solution Required:**
- Clear separation between gameplay and pause-mode controls
- Document all shortcuts in UI
- Consider customizable keybindings

**Shortcuts to define:**
- **During gameplay:** Arrow keys = piece movement (standard)
- **During pause:** Arrow keys = camera navigation (new)
- **Anytime:** P = pause/unpause, H = help/shortcuts

---

### 11. Mobile/Touch Support

**Issue:** Original game likely supports mobile
- Infinity mode camera controls need touch gestures
- Minimap needs tap/drag support
- On-screen controls for mobile

**Solution (Post-MVP):**
- Touch drag on minimap = scroll
- Two-finger pinch on minimap = zoom
- Touch drag on main view (when paused) = camera pan
- Virtual D-pad for piece controls remains unchanged

---

### 12. Audio Feedback for Milestones

**Issue:** Reaching height milestones should feel rewarding
- Currently only visual notifications planned
- Audio cues enhance the experience

**Solution:**
- Special sound effect at milestones (100, 250, 500, 1000)
- Escalating "achievement unlocked" sounds
- Music track change at major milestones (500, 1000)?

**Implementation:**
```javascript
// In InfinityMode.js
_checkHeightMilestone() {
    const milestones = [100, 250, 500, 750, 1000];
    const currentHeight = this.gameState.board.length - this.gameState.currentTopRow;

    if (milestones.includes(currentHeight)) {
        // Visual notification (already planned)
        this._showMilestoneNotification(`Height: ${currentHeight} rows!`);

        // Audio feedback (NEW)
        this.deps.soundManager.playEffect('milestone');
    }
}
```

**Files to modify:**
- `src/audio/sound-effects.js` - Add milestone sound

---

### 13. Spectator/Replay Mode

**Issue:** Players may want to review their epic combos
- Cascades happen fast, hard to appreciate
- Social sharing potential

**Solution (Future Enhancement):**
- Record game actions (not full state) as event log
- Replay system that can recreate session
- Export replay as shareable file
- Slow-motion playback for cascade viewing

---

### 14. Garbage/Attack System

**Issue:** Serenity Blocks has garbage (gray blocks) from multiplayer
- Does Infinity Mode include garbage?
- Probably not needed for solo endurance mode

**Decision Required:**
- **Recommended:** Disable garbage in Infinity Mode
- Keep it pure combo-building without external interference
- If wanted: Add as optional "Hard Mode" modifier

**Implementation:**
```javascript
// In InfinityMode.js - createGameState
this.gameState = createGameState({
    isInfinityMode: true,
    disableGarbage: true, // NEW: No garbage in this mode
});
```

---

### 15. Performance Profiling Targets

**Issue:** Need concrete performance benchmarks
- Current plan mentions "60fps" but what about heavy scenarios?

**Additional benchmarks to track:**
1. **Grid expansion time:** < 50ms (already in plan)
2. **Cascade with 100+ lines:** < 5 seconds total
3. **Minimap render:** < 16ms (already in plan)
4. **Camera scroll latency:** < 20ms per frame
5. **Memory usage at 500 rows:** < 250MB
6. **Memory usage at 1000 rows:** < 500MB (already in plan)
7. **Input lag:** < 50ms from keypress to piece move

**Testing methodology:**
- Use Chrome DevTools Performance profiler
- Test on mid-range hardware (not just dev machine)
- Long-duration tests (30+ minute sessions)
- Memory leak detection (heap snapshots before/after)

---

### 16. Accessibility Considerations

**Issue:** Infinity Mode UI should be accessible

**Requirements:**
- Screen reader support for stats/height
- Keyboard-only navigation (already planned)
- High contrast mode compatibility
- Pause during screen reader announcements
- ARIA labels for interactive elements

**Implementation:**
```html
<!-- In infinity-minimap.js -->
<canvas
    aria-label="Overview map showing current build height and viewport position"
    role="img"
    tabindex="0"
></canvas>
```

---

### 17. Network Considerations (If Multiplayer Ever Added)

**Issue:** Current plan is single-player only
- But codebase has multiplayer infrastructure
- Future: Co-op Infinity Mode?

**Considerations for Future:**
- Sync 1000-row grids between players (large data)
- Shared combo building (both players contribute)
- Spectator mode for friends
- Not critical for MVP, but keep architecture flexible

---

### 18. Data Analytics

**Issue:** Want to understand how players engage with mode
- How high do most players reach?
- What's the distribution of max combos?
- How long are typical sessions?

**Solution (Optional):**
- Track anonymized session data
- Store in localStorage or send to backend
- Use for balancing and feature prioritization

**Metrics to track:**
```javascript
{
    sessionId: uuid(),
    duration: 1847000, // ms
    maxHeight: 347, // rows
    maxCombo: 87, // lines
    totalLinesCleared: 1247,
    milestones: [100, 250],
    quitReason: 'game-over' | 'manual-quit',
    timestamp: Date.now()
}
```

---

## Critical Path Items for MVP

From the additional considerations above, these are **MUST-HAVE** for MVP:

1. ✅ **Game Over Condition Modification** (#1) - Core gameplay
2. ✅ **Piece Spawning Position** (#2) - Core gameplay
3. ✅ **Hidden Rows Redefinition** (#3) - Core gameplay
4. ✅ **Board Cache Management** (#4) - Performance critical
5. ⚠️ **Level Progression Decision** (#5) - Design decision needed
6. ⚠️ **Pause During Cascades** (#6) - UX quality
7. ✅ **Height Progress Indicators** (#7) - Core UX feedback

## Nice-to-Have for Launch

8. 💡 Save/Resume (#8)
9. 💡 Audio Milestones (#12)
10. 💡 Minimap Zoom (#9)

## Post-Launch Enhancements

11. 🔮 Replay System (#13)
12. 🔮 Mobile Touch Support (#11)
13. 🔮 Data Analytics (#18)
14. 🔮 Network/Co-op (#17)

---

## Updated Files List

### Additional New Files
9. `src/ui/infinity-hud.js` - Height counter and progress indicators
10. `src/core/infinity-game-over.js` - Custom game over logic

### Additional Modified Files
7. `src/core/board.js` - Update hasBlocksAbovePlayfield()
8. `src/core/physics.js` - Pause-aware cascade loop
9. `src/audio/sound-effects.js` - Milestone sounds

---

## Updated Implementation Timeline

**Revised Total:** 32-42 hours (was 28-37)

**Additional time needed:**
- Game over logic: +2 hours
- Spawn position system: +2 hours
- Height HUD component: +2 hours
- Pause handling: +1 hour
- Additional testing: +2 hours

**Revised Sprint Plan:**
- **Week 1:** Phases 1-3 + game over/spawn logic (12-15 hours)
- **Week 2:** Phases 4-5 + height HUD (9-11 hours)
- **Week 3:** Phases 6-8 (7-9 hours)
- **Week 4:** Phase 9 + additional edge case testing (6-9 hours)

---

*Document Version: 1.1*
*Last Updated: 2025-11-04*
*Author: Implementation Planning AI*
*Changelog: Added 18 additional considerations based on deep codebase analysis*
