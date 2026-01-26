# Online Multiplayer Performance Optimization Plan

**Date:** January 26, 2026
**Status:** Investigation Complete / Ready for Implementation
**Problem:** FPS drops from ~160 (single-player) to ~100 (6-player online multiplayer)
**Target:** Achieve ~140+ FPS in online multiplayer (< 15% overhead vs single-player)

---

## Executive Summary

After thorough analysis of the online multiplayer code, I've identified **7 major performance bottlenecks** causing the ~40% FPS regression. The primary issues are:

1. **Excessive object allocations in hot render path** (~500+ allocations/second)
2. **Redundant canvas redraws** (all boards redrawn every frame regardless of changes)
3. **Unoptimized event emission** (RENDER_FRAME event not using available optimization)
4. **Array method chaining** (filter/map/find creating garbage every frame)
5. **Synchronous state transformation** (O(n) operations repeated 60x/second)
6. **No dirty-checking** (renders even when state hasn't changed)
7. **Color/style recalculations** (CSS colors computed per-cell per-frame)

---

## Detailed Performance Analysis

### 1. Hot Path: `renderAllPlayers()`
**File:** `src/core/multiplayer/ffa-p2p-game-state.js:2165-2179`
**Frequency:** 60 calls/second
**Issue:** Creates new objects every frame

```javascript
// CURRENT (BAD): Creates 6+ new objects per frame = 360+ allocations/sec
players: Array.from(this.players.entries()).map(([steamId, player]) => ({
    steamId,
    name: player.name,
    gameState: player.gameState,  // Reference copy is fine
    // ... more properties
}))
```

**Impact:** ~360 object allocations/second causing GC pressure

---

### 2. Hot Path: `_handleRenderFrame()`
**File:** `src/core/game-modes/OnlineMultiplayerMode.js:1136-1209`
**Frequency:** 60 calls/second
**Issues:**
- `players.find()` - O(n) search every frame
- `players.filter().map()` - 2 array allocations + n object allocations
- `Date.now()` called multiple times
- New object created for each opponent

```javascript
// CURRENT (BAD): Multiple allocations per frame
const opponents = players
    .filter(p => p.steamId !== localId)           // New array #1
    .map(p => {                                    // New array #2
        const result = { id, steamId, name, ... }; // New object × 5 opponents
        return result;
    });
```

**Impact:** ~300+ object allocations/second

---

### 3. Hot Path: `_renderMiniBoard()`
**File:** `src/ui/opponent-watch-manager.js:977-1000`
**Frequency:** 240 calls/second (4 visible boards × 60 fps)
**Issues:**
- Creates new `Map()` for colorCache every call
- No dirty-checking (redraws even if board unchanged)
- Full canvas clear + redraw every frame
- Iterates all 200 cells regardless of occupancy

```javascript
// CURRENT (BAD): New Map every frame
const colorCache = new Map();  // 240 allocations/second!
this._drawLockedCells(ctx, grid, blockSize, colorCache);
```

**Impact:** 240 Map allocations/second + 48,000 cell iterations/second

---

### 4. Hot Path: `_drawLockedCells()`
**File:** `src/ui/opponent-watch-manager.js:1002-1022`
**Frequency:** 240 calls/second
**Issue:** Iterates ALL cells even when most are empty

```javascript
// CURRENT (BAD): Always iterates 200 cells
for (let row = 4; row < 24; row++) {
    for (let col = 0; col < 10; col++) {
        const cell = gridRow[col];
        if (!cell || cell === 0) continue;  // Most cells are empty!
    }
}
```

**Impact:** 48,000 cell checks/second (most wasted on empty cells)

---

### 5. Event System: RENDER_FRAME Not Optimized
**File:** `src/core/multiplayer/ffa-p2p-game-state.js:2167`
**Issue:** Event emitter has optimization capabilities (throttle, batch, RAF) but RENDER_FRAME doesn't use them

```javascript
// CURRENT: Direct emit without optimization
emitMultiplayerEvent(MULTIPLAYER_EVENTS.RENDER_FRAME, { players: ... });

// OptimizedEventEmitter supports: { rafThrottle: true, batched: true }
// But these options aren't used!
```

---

### 6. Synchronous Color Lookups
**File:** `src/ui/opponent-watch-manager.js:1010`
**Issue:** Color lookup for every non-empty cell, every frame

```javascript
const color = this._getCellColor(cell, colorCache);
```

With 4 boards × ~50 occupied cells × 60 fps = 12,000 color lookups/second

---

## Optimization Strategies

### Phase 1: Zero-Allocation Hot Path (HIGH IMPACT)

#### 1.1 Pre-allocate Reusable Objects
```javascript
// In constructor
this._renderPayload = {
    players: new Array(8).fill(null).map(() => ({
        steamId: null,
        name: null,
        gameState: null,
        // ... other fields
    }))
};

// In renderAllPlayers()
renderAllPlayers() {
    let i = 0;
    this.players.forEach((player, steamId) => {
        const slot = this._renderPayload.players[i++];
        slot.steamId = steamId;
        slot.name = player.name;
        slot.gameState = player.gameState;
        // ... assign other fields
    });
    this._renderPayload.playerCount = i;
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.RENDER_FRAME, this._renderPayload);
}
```

#### 1.2 Cache Player Lookups
```javascript
// Cache local player reference (changes rarely)
this._cachedLocalPlayer = null;
this._cachedLocalId = null;

_handleRenderFrame(detail) {
    // Cache local player lookup
    if (this._cachedLocalId !== this.steamNetworking?.steamId) {
        this._cachedLocalId = this.steamNetworking?.steamId;
        this._cachedLocalPlayer = null;  // Invalidate
    }

    const localPlayer = this._cachedLocalPlayer ??
        (this._cachedLocalPlayer = players.find(p => p.steamId === this._cachedLocalId));
}
```

#### 1.3 Reuse Opponent Array
```javascript
// Pre-allocate opponent slots
this._opponentSlots = new Array(7).fill(null).map(() => ({
    id: null, steamId: null, name: null, color: null,
    isAlive: true, frags: 0, grid: null, currentPiece: null, nextPieces: null
}));

// Reuse instead of filter().map()
let opponentCount = 0;
for (const p of players) {
    if (p.steamId === localId) continue;
    const slot = this._opponentSlots[opponentCount++];
    slot.id = slot.steamId = p.steamId;
    slot.name = p.name;
    // ... assign other fields in-place
}
this._activeOpponentCount = opponentCount;
```

**Expected Impact:** Eliminate ~600 allocations/second

---

### Phase 2: Dirty-Checking & Conditional Rendering (HIGH IMPACT)

#### 2.1 Board State Hashing
```javascript
class OpponentWatchManager {
    constructor() {
        this._boardHashes = new Map();  // steamId → hash
        this._pieceHashes = new Map();  // steamId → piece signature
    }

    _computeBoardHash(grid) {
        // Fast hash: XOR all non-zero cells
        let hash = 0;
        for (let row = 4; row < 24; row++) {
            const gridRow = grid[row];
            if (!gridRow) continue;
            for (let col = 0; col < 10; col++) {
                if (gridRow[col]) hash ^= (row << 16) | (col << 8) | gridRow[col];
            }
        }
        return hash;
    }

    _computePieceHash(piece) {
        if (!piece) return 0;
        return (piece.type << 24) | (piece.x << 16) | (piece.y << 8) | piece.rotation;
    }

    updateFromState(playerStates) {
        playerStates.forEach(state => {
            const boardHash = this._computeBoardHash(state.grid);
            const pieceHash = this._computePieceHash(state.currentPiece);

            const prevBoardHash = this._boardHashes.get(state.id);
            const prevPieceHash = this._pieceHashes.get(state.id);

            // Only redraw if something changed
            if (boardHash !== prevBoardHash || pieceHash !== prevPieceHash) {
                this._renderMiniBoard(board.ctx, state.grid, state.currentPiece);
                this._boardHashes.set(state.id, boardHash);
                this._pieceHashes.set(state.id, pieceHash);
            }
        });
    }
}
```

#### 2.2 Separate Static vs Dynamic Rendering
```javascript
// Board background rarely changes - only redraw on lock events
_renderStaticBoard(ctx, grid) {
    // Only called when pieces lock or lines clear
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this._drawLockedCells(ctx, grid, blockSize);
}

// Current piece changes every frame - render to overlay canvas
_renderDynamicPiece(overlayCtx, currentPiece, ghostY) {
    overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
    this._drawGhostPiece(overlayCtx, currentPiece, ghostY, blockSize);
    this._drawCurrentPiece(overlayCtx, currentPiece, blockSize);
}
```

**Expected Impact:** Reduce canvas operations by 70-80%

---

### Phase 3: Optimized Data Structures (MEDIUM IMPACT)

#### 3.1 Persistent Color Cache
```javascript
// Move to class level - persistent across frames
class OpponentWatchManager {
    constructor() {
        this._colorCache = new Map();  // Reused across all renders
    }

    _renderMiniBoard(ctx, grid, currentPiece) {
        // Don't create new Map!
        // this._colorCache is already available
        this._drawLockedCells(ctx, grid, blockSize, this._colorCache);
    }
}
```

#### 3.2 Sparse Cell Iteration
```javascript
// Instead of iterating all 200 cells, track occupied cells
// Updated when pieces lock
_drawLockedCells(ctx, grid, blockSize) {
    // Option A: Use occupiedCells list if available
    if (this._occupiedCells) {
        for (const { row, col, cell } of this._occupiedCells) {
            const color = this._getCellColor(cell);
            ctx.fillStyle = color;
            ctx.fillRect(col * blockSize, (row - 4) * blockSize, blockSize, blockSize);
        }
        return;
    }

    // Option B: Early exit on empty rows
    for (let row = 4; row < 24; row++) {
        const gridRow = grid[row];
        if (!gridRow || gridRow.every(c => !c)) continue;  // Skip empty rows
        // ... draw cells
    }
}
```

---

### Phase 4: Event System Optimization (MEDIUM IMPACT)

#### 4.1 Use RAF Throttle for RENDER_FRAME
```javascript
// In OnlineMultiplayerMode constructor or setup
this.renderFrameUnsub = onMultiplayerEvent(
    MULTIPLAYER_EVENTS.RENDER_FRAME,
    (detail) => this._handleRenderFrame(detail),
    { rafThrottle: true }  // Use built-in RAF throttle!
);
```

#### 4.2 Batch Scoreboard Updates
```javascript
// Scoreboard updates don't need 60fps
this.scoreboardUpdateUnsub = onMultiplayerEvent(
    MULTIPLAYER_EVENTS.RENDER_FRAME,
    (detail) => this._updateScoreboard(detail),
    { throttle: 250 }  // 4 updates/second is plenty
);
```

---

### Phase 5: WebGL/OffscreenCanvas (ADVANCED - OPTIONAL)

#### 5.1 OffscreenCanvas for Opponent Boards
```javascript
// Move canvas rendering to Web Worker
const offscreen = canvas.transferControlToOffscreen();
const worker = new Worker('opponent-renderer-worker.js');
worker.postMessage({ canvas: offscreen }, [offscreen]);

// In worker: render without blocking main thread
self.onmessage = (e) => {
    const { grid, currentPiece } = e.data;
    renderToCanvas(grid, currentPiece);
};
```

#### 5.2 WebGL Batch Rendering
```javascript
// Render all opponent boards in single WebGL draw call
// Using instanced rendering for blocks
```

---

## Implementation Priority

| Phase | Optimization | Impact | Effort | Priority |
|-------|-------------|--------|--------|----------|
| 1.1 | Pre-allocate render payload | HIGH | LOW | P0 |
| 1.2 | Cache player lookups | MEDIUM | LOW | P0 |
| 1.3 | Reuse opponent array | HIGH | MEDIUM | P0 |
| 2.1 | Dirty-checking with hashing | HIGH | MEDIUM | P1 |
| 2.2 | Static/dynamic canvas split | HIGH | HIGH | P1 |
| 3.1 | Persistent color cache | MEDIUM | LOW | P0 |
| 3.2 | Sparse cell iteration | LOW | MEDIUM | P2 |
| 4.1 | RAF throttle for events | MEDIUM | LOW | P0 |
| 4.2 | Batch scoreboard updates | LOW | LOW | P1 |
| 5.x | WebGL/OffscreenCanvas | HIGH | VERY HIGH | P3 |

---

## Profiling & Validation

### Before Starting
```javascript
// Add FPS counter to debug
window.multiplayerPerf = {
    frameCount: 0,
    lastFps: 0,
    allocations: 0
};

// Use Chrome DevTools:
// 1. Performance tab → Record during gameplay
// 2. Memory tab → Allocation timeline
// 3. Look for:
//    - Yellow (scripting) time in flame chart
//    - Frequent minor GC events
//    - Hot functions in Bottom-Up view
```

### Key Metrics to Track
1. **FPS** - Target: 140+ (currently ~100)
2. **Frame time** - Target: <7ms (currently ~10ms)
3. **GC frequency** - Target: <1 minor GC/second
4. **Memory growth** - Target: Stable (no steady increase)

### Validation Tests
```javascript
// Run these before/after each optimization:
window.testMultiplayer(6);

// After 60 seconds, check:
// 1. FPS counter (should be higher)
// 2. Memory tab in DevTools (should be stable)
// 3. Performance recording (fewer GC events)
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/core/multiplayer/ffa-p2p-game-state.js` | Pre-allocate render payload |
| `src/core/game-modes/OnlineMultiplayerMode.js` | Cache lookups, reuse arrays, event options |
| `src/ui/opponent-watch-manager.js` | Dirty-checking, persistent cache, sparse iteration |
| `src/events/multiplayer-events.js` | (No changes needed - already has optimization support) |

---

## Success Criteria

- [ ] FPS in 6-player multiplayer: **140+** (from ~100)
- [ ] Frame time: **<7ms** (from ~10ms)
- [ ] Object allocations: **<100/sec** (from ~600/sec)
- [ ] No visible GC pauses during gameplay
- [ ] Memory stable after 5 minutes of play

---

## References

- [Chrome DevTools Performance Analysis](https://developer.chrome.com/docs/devtools/performance/)
- [Avoiding Layout Thrashing](https://developers.google.com/web/fundamentals/performance/rendering/avoid-large-complex-layouts-and-layout-thrashing)
- [Canvas Performance Optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [Memory Management in JS](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_Management)
