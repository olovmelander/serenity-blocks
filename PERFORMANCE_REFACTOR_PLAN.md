# Single-Player FPS Stabilisation Plan

The FPS drop in single-player mode stems from per-frame work that grows with time: locked piece snapshots accumulate, full board matrices are rebuilt repeatedly, and rendering redraws every historical block each frame. The following roadmap focuses on stabilising CPU/GPU cost regardless of game duration.

---

## 1. Objectives
- Keep frame time stable (<16 ms for 60 FPS) even after thousands of pieces.
- Eliminate avoidable allocations and repeated heavy loops.
- Preserve existing gameplay / physics behaviour.

---

## 2. Investigation Recap
- `gameState.lockedPieces` retains every tetromino snapshot (deep copy of shapes).
- `generateBoard()` builds a fresh `ROWS + HIDDEN_ROWS × COLS` matrix for almost every physics/render call (`src/core/board.js`).
- `BoardScene.drawLockedPieces()` redraws all blocks every frame.
- Result: per-frame work & GC volume grow with stack height.

---

## 3. Refactor Phases

### Phase 1 – Core Board Representation
1. **Introduce a persistent grid** structure (e.g., `boardState[y][x] = { color, id }`) stored on `gameState`.
2. Rewrite mutation paths (`lockPiece`, line clear, gravity) to update this grid in place rather than regenerating via `generateBoard`.
3. Maintain a lightweight `lockedPieces` list only if still needed for physics metadata; otherwise store metadata per cell or via pooled structs.
4. Provide helper functions:
   - `setCell(x, y, value)` / `clearCell(x, y)`
   - `forEachFilledCell(callback)` for physics and rendering.

### Phase 2 – Physics Pipeline Optimisation
1. **Refactor `processPhysics()`** to consume the new grid:
   - Detect full lines by scanning row arrays directly.
   - Derive hole masks using incremental data (avoid cloning matrices).
   - Track movement using boolean grids reused across cascades.
2. Replace promise & `setTimeout` animations with Phaser timeline or requestAnimationFrame-based scheduling to minimise idle waits.
3. Ensure garbage hole calculations rely on constant-size buffers (reuse arrays).

### Phase 3 – Rendering Changes
1. Update `BoardScene.renderGameState()` to iterate over the in-place grid (or cache dirty rectangles) instead of every historical piece.
2. Consider batching draws: use a tilemap/texture atlas or copy board cells into a Phaser texture once per update.
3. Ensure ghost piece rendering & outlines still work with the new representation.

### Phase 4 – Memory Management & Pools
1. Audit object pools (`piecePool`, `particlePool`) to ensure they remain effective with the new pipeline.
2. Remove unused piece snapshots or convert them to pooled lightweight structs.
3. Revisit DOM overlays (`score-popups`, `background-pulse`) to verify they clean up properly; migrate to Phaser overlays if needed.

### Phase 5 – Instrumentation & Validation
1. Extend `PerformanceMonitor` to record grid mutations, draw calls, and board size to confirm constancy.
2. Add automated soak test: run simulated drops for N minutes and assert FPS never falls below a threshold.
3. Profile before/after (Chrome Performance + Memory) and document improvements.

---

## 4. Risks & Mitigations
- **Behavioural regressions**: physics logic is intertwined with the old representation. Mitigate via unit tests for line clearing, cascades, garbage insertion.
- **Rendering differences**: ensure the new grid produces identical visuals (add screenshot diff or pixel tests if possible).
- **Migration complexity**: plan incremental commits (Phase 1 grid foundation -> Phase 2 physics -> Phase 3 rendering).

---

## 5. Deliverables
- In-place board implementation + updated physics/rendering.
- Performance report demonstrating stable FPS over extended play.
- Updated developer docs describing the new board API and profiling workflow.
