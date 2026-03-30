# Phaser Migration · Phase 4 Multiplayer Migration

Phase 4 moves multiplayer rendering off the legacy canvas stack and onto Phaser, delivering a consistent pipeline across single and multi-board play.

---

## 1. Twin Phaser Board Scenes

- Introduced `MultiplayerBoardScene`, a viewport-aware subclass of the shared `BaseBoardScene`, capable of rendering a player board, HUD, and FX inside a configurable viewport (`src/rendering/phaser/multiplayer/board-panel.js`).
- Added helper infrastructure in `SerenityBlocks` to launch/stop the two multiplayer scenes and to keep them in sync with the multiplayer game state (`src/main.js:274`). Each scene maintains its own scoreboard (score, lines, pending garbage) and reuses the same block rendering logic as single player.
- `BoardScene` now uses a viewport centered within the wider canvas, preparing the game for the expanded multiplayer aspect ratio (`src/rendering/phaser/board-scene.js:36`).

## 2. Game Loop Integration

- Multiplayer callbacks no longer paint to DOM canvases; physics events now sync the Phaser scenes directly (`src/main.js:1202`). Line flashes, ripple effects, and combo popups are routed through the new scene methods mirroring the single-player experience.
- Multiplayer launch flow pauses the single-player scene, starts both board scenes with the correct viewports, and toggles body classes to hide legacy DOM boards (`src/main.js:1108`). Return to single player tears down the Phaser multiplayer scenes and resumes the single-player renderer.
- The shared base scene (`src/rendering/phaser/base-board-scene.js`) now owns the generic rendering implementation (grid, blocks, ghost, etc.), letting both single and multiplayer variants share the same code path.

## 3. Styling & Layout Adjustments

- `#phaser-game-container` now reflects the wider multiplayer canvas (aspect ratio 23:20, width cap 720 px) (`public/styles/main.css:4740`).
- DOM-based multiplayer board areas are hidden whenever Phaser handles rendering, while countdown overlays remain available (`public/styles/main.css:4760`).

## 4. Follow-Up / Open Items

- Next-piece queues for multiplayer currently remain hidden; consider adding a Phaser-based queue component similar to single player.
- DOM multiplayer stats are still updated for fallback purposes; once Phaser HUDs are expanded (e.g., garbage meters), we can remove the remaining DOM dependencies.
- Evaluate performance after extended matches to ensure the dual-scene setup scales well with heavy FX (profile before enabling more particles).

Multiplayer now runs entirely on Phaser, completing Phase 4 and paving the way for theme/audio refinements in subsequent phases.
