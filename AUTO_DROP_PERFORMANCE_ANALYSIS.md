# AUTO-DROP PERFORMANCE ANALYSIS: Heavy Computation During Single-Player Falling

## SUMMARY
Every automatic piece drop (every 100-1000ms depending on level) triggers multiple collision detection passes and full render cycles that are **computationally expensive and largely redundant**.

---

## 1. AUTO-DROP LOGIC (Game Loop)

### Location: `/home/melolo/serenity-blocks/src/core/game.js` lines 579-585

```javascript
// Auto drop
if (!gameState.isProcessingPhysics && gameState.currentPiece) {
    gameState.dropCounter += delta;
    if (gameState.dropCounter > gameState.dropInterval) {
        softDrop(gameState, playDropCallback, physicsCallbacks);  // TRIGGERS HERE
    }
}
```

**Frequency:** Every 100-1000ms (varies by level - level 1 = 1000ms, level 20 = 50ms)

**What softDrop does:** (lines 411-427)
```javascript
export function softDrop(gameState, playDropCallback, physicsCallbacks) {
    if (!gameState.currentPiece || gameState.isProcessingPhysics) return false;

    if (canPlacePiece(  // ← COLLISION CHECK #1
        gameState,
        gameState.currentPiece,
        gameState.currentPiece.x,
        gameState.currentPiece.y + 1,  // Only checking one row down
    )) {
        gameState.currentPiece.y++;
        gameState.score += gameState.level;
        gameState.dropCounter = 0;
        return true;
    }
    lockPiece(gameState, playDropCallback, physicsCallbacks);
    return false;
}
```

---

## 2. COLLISION DETECTION DURING FALLING

### Location: `/home/melolo/serenity-blocks/src/core/game.js` lines 42-65

#### Function: `isValidPositionCached()`
```javascript
function isValidPositionCached(gameState, piece, checkX, checkY) {
    if (!piece) return false;

    const boardData = ensureBoardCache(gameState);  // ← BOARD REBUILD CACHED

    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x] > 0) {
                const boardX = checkX + x;
                const boardY = checkY + y;

                if (boardX < 0 || boardX >= COLS || boardY >= boardData.length) {
                    return false;
                }

                if (boardY >= 0 && boardData[boardY] && boardData[boardY][boardX] !== null) {
                    return false;
                }
            }
        }
    }

    return true;
}
```

### Location: `/home/melolo/serenity-blocks/src/core/game.js` lines 29-40

#### Function: `ensureBoardCache()`
```javascript
function ensureBoardCache(gameState) {
    if (!gameState) return null;

    if (!gameState.boardCache || gameState.boardCacheDirty) {
        gameState.boardCache = generateBoard(gameState.lockedPieces, {
            boardGrid: gameState.boardGrid,
        });
        gameState.boardCacheDirty = false;
    }

    return gameState.boardCache;
}
```

**Key Issue:** The board cache is marked dirty in `lockPiece()` only, so during normal falling it SHOULD be cached. However, if `boardCacheDirty` is set, this triggers a full board regeneration.

**What generateBoard() does:** Iterates through ALL locked pieces to build collision data.

---

## 3. GHOST PIECE CALCULATION (Rendering)

### Location: `/home/melolo/serenity-blocks/src/rendering/phaser/base-board-scene.js` lines 605-638

```javascript
drawGhostPiece() {
    const piece = this.gameState?.currentPiece;
    if (!piece) return;

    // Calculate ghost position (where piece will land)
    let ghostY = piece.y;
    while (this.isValidPosition(piece.x, ghostY + 1, piece.shape)) {  // ← LOOP EVERY FRAME
        ghostY++;
    }
    // Then draws each block of the ghost piece
}
```

**Heavy Computation:**
- Calls `isValidPosition()` **repeatedly** in a loop to find where piece lands
- For a piece falling from top to bottom (20+ rows): **20+ collision checks per frame**
- This happens **EVERY FRAME** (60fps), regardless of piece movement

### Location: `/home/melolo/serenity-blocks/src/rendering/phaser/base-board-scene.js` lines 774-817

#### Function: `isValidPosition()` - Expensive Duplicate
```javascript
isValidPosition(checkX, checkY, shape) {
    const boardGrid = this.gameState?.boardGrid;
    const totalRows = boardGrid?.length ?? (this.rows + this.hiddenRows);

    for (let row = 0; row < shape.length; row++) {
        for (let col = 0; col < shape[row].length; col++) {
            if (shape[row][col] <= 0) continue;

            const newX = checkX + col;
            const newY = checkY + row;

            if (newX < 0 || newX >= this.cols) {
                return false;
            }

            if (newY >= totalRows) {
                return false;
            }

            if (newY >= 0) {
                if (boardGrid) {
                    const cell = boardGrid[newY]?.[newX];
                    if (cell) {
                        return false;
                    }
                } else if (this.gameState?.lockedPieces) {
                    // FALLBACK: Iterate through all locked pieces
                    for (const locked of this.gameState.lockedPieces) {
                        for (let ly = 0; ly < locked.shape.length; ly++) {
                            for (let lx = 0; lx < locked.shape[ly].length; lx++) {
                                if (locked.shape[ly][lx] > 0) {
                                    if (locked.x + lx === newX && locked.y + ly === newY) {
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return true;
}
```

**Critical Issue:** This is a DUPLICATE of `isValidPositionCached()` in game.js, but **uses a different approach**:
- In game.js: Uses pre-built board grid (O(1) lookup per cell)
- In base-board-scene.js: Falls back to iterating through all locked pieces (O(n) lookup)

**The rendering version is SLOWER and runs EVERY FRAME for ghost piece calculation.**

---

## 4. FULL RENDER CYCLE (Every Frame)

### Location: `/home/melolo/serenity-blocks/src/rendering/phaser/base-board-scene.js` lines 124-157

```javascript
update(time, delta) {
    performanceMonitor.updateStart();

    if (!this.gameState) return;

    // Frame counting for cleanup
    this.frameCount++;
    if (this.frameCount >= this.cleanupInterval) {
        this.frameCount = 0;
        this._performPeriodicCleanup();
    }

    // Clear graphics EVERY frame
    this.boardGraphics?.clear();
    this.pieceGraphics?.clear();
    this.effectsGraphics?.clear();

    performanceMonitor.updateEnd();
    performanceMonitor.renderStart();

    // RENDER EVERYTHING
    this.renderGameState();

    performanceMonitor.renderEnd();
}
```

### Location: `/home/melolo/serenity-blocks/src/rendering/phaser/base-board-scene.js` lines 459-476

```javascript
renderGameState() {
    if (!this.gameState) return;

    this.drawGrid();
    this.drawBoardFromGrid();           // ← EVERY FRAME: 200-240 cells drawn (visible rows)
    this.drawLockedPieceOutlines();     // ← EVERY FRAME: Outline all edge blocks
    if (this.gameState.currentPiece) {
        this.drawGhostPiece();          // ← EVERY FRAME: 20+ collision checks to calc ghost
    }
    this.drawAnimatedPieces();
    if (this.gameState.currentPiece) {
        this.drawCurrentPiece();
    }
}
```

**What gets called every frame (60fps):**

1. **drawBoardFromGrid()** (lines 491-513)
   - Iterates visible rows: ~20 rows × 10 columns = ~200 cell accesses per frame
   - Looks up color values, draws to canvas

2. **drawLockedPieceOutlines()** (lines 515-581)
   - Checks every visible cell (200 cells)
   - For each cell, checks 4 adjacent neighbors to draw piece boundaries
   - ~800 boundary checks per frame

3. **drawGhostPiece()** (lines 605-638)
   - **Calculates ghost Y position from scratch**
   - Calls `isValidPosition()` in a loop: 20+ times per frame on average
   - Each call checks piece cells against board grid
   - Then draws ghost piece (4-16 cells × pulsation calculation)

---

## 5. PERFORMANCE BOTTLENECK SUMMARY

### During a Single Auto-Drop Event (happens every 100-1000ms):

1. **Game Loop** (1 time per drop interval):
   - `softDrop()` → `canPlacePiece()` → `isValidPositionCached()` → checks board cache
   - **1 collision check** (but triggers board rebuild if dirty)

2. **Rendering Loop** (60 times per second):
   - **Per-frame cost during falling:**
     - 200 board cells drawn
     - 800 boundary checks
     - **20+ ghost position calculations** (including collision checks)
     - 4-16 ghost cells drawn with pulsation

### The Real Problem:

**Ghost piece calculation is the culprit:**
- Calculates where piece will land **every single frame** (60fps)
- Uses expensive collision detection (20+ checks per piece per frame)
- Happens even if piece hasn't moved since last frame
- No caching or optimization for unchanged piece position

**Example at Level 20 (50ms drop interval):**
- Auto-drop triggers every 50ms
- Ghost piece recalculated 1200 times (every 50ms for 60 second play)
- Each calculation = 20 collision checks = **24,000 collision checks per 60 seconds**

---

## 6. DUPLICATE CODE ISSUE

**Critical Finding:** Two different collision detection implementations:

1. **game.js** - `isValidPositionCached()`:
   - Uses board grid cache
   - Fast lookup: O(1) per cell check
   - Called by softDrop during gravity

2. **base-board-scene.js** - `isValidPosition()`:
   - Falls back to iterating locked pieces if no board grid
   - Slow fallback: O(n) per cell check
   - Called every frame for ghost piece calculation
   - **Never caches result**

This means **every frame** for 60 fps:
- Ghost piece calculation runs
- Calls `isValidPosition()` in a loop 20+ times
- Each call does full collision detection against board grid
- **No optimization: position is recalculated even if piece hasn't moved**

---

## 7. CALCULATIONS PER SECOND (During Normal Falling)

### Worst Case: Level 20 (50ms auto-drop interval)

**Per 60 frames (1 second):**
- Frame 1-59: Piece falling, no input
  - 200 board cells rendered
  - 800 boundary checks
  - 1200 ghost position lookups (20 checks each)
  - **= 24,000 collision checks per second**

- Frame 60: Auto-drop triggers
  - 1 collision check (already happening above)
  - Physics processing (if piece locks)

**Total per second:** ~24,000 collision detection operations

**Comparison to input-driven drops:** Same overhead happens even if player never touches the game!

---

## RECOMMENDATIONS

1. **Cache ghost piece position** - Only recalculate when piece moves
2. **Use unified collision detection** - Remove duplicate `isValidPosition()` implementations
3. **Throttle ghost piece rendering** - Update every 16-33ms instead of every frame
4. **Profile rendering time** - Graphics clearing/drawing may also be expensive with outline calculations

