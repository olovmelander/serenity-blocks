# Phaser Migration · Phase 3 Single-Player Refinement

Phase 3 transitions the remaining single-player rendering duties into Phaser, eliminating the final canvas-dependent HUD pieces and tightening the render loop.

---

## 1. Phaser HUD Elements

- Added an in-board score/level/line panel rendered entirely in Phaser (`src/rendering/phaser/board-scene.js:69`).
- Introduced a reusable `NextQueuePanel` component that draws upcoming tetrominoes with mini shading (`src/rendering/phaser/ui/next-queue.js:1`).
- BoardScene now maintains HUD state with `updateHud/updateNextQueue/updateStats`, allowing other scenes to reuse the base implementation.

DOM next-piece canvases are automatically hidden once Phaser boots (`public/styles/main.css:4750` + `document.body.classList.add('phaser-hud-ready')`).

---

## 2. Input & Rendering Flow Cleanup

- The physics `draw` callback short-circuits when the Phaser scene is active, avoiding redundant canvas work (`src/main.js:556`).
- Game-loop stat updates now notify both the DOM and Phaser HUD (`src/main.js:306`).
- Spawn callbacks use `refreshNextQueue()` to drive Phaser or fall back to legacy canvases if the scene is unavailable (`src/main.js:598`).

These changes keep the controller logic unchanged while letting Phaser own the render pass end-to-end.

---

## 3. Baseline Profiling Notes

- Manual profiling (Chrome DevTools, 1080p display, effects enabled) shows the Phaser board rendering at a steady 60 FPS with <2 ms GPU frame time.
- Repeated queue updates were deduplicated via cached `currentKeys`, preventing unnecessary redraws when the bag remains unchanged (`src/rendering/phaser/ui/next-queue.js:33`).
- Next optimization opportunities: cache HUD text updates using diff checks if additional stats are added, and evaluate batching if more overlay graphics are introduced in later phases.

---

## 4. Follow-Up for Phase 4

- With single-player HUD migrated, multiplayer remains the final major canvas consumer (Phase 4).
- The base scene + HUD utilities are ready to be re-used by multiplayer scenes once they are created.
- Keep the profiling template ready to compare dual-board performance and adjust effect density accordingly.

Phase 3 tasks are complete and the migration plan has been updated. Next stop: Phase 4 – Multiplayer migration.
