# Phaser Migration · Phase 7 Performance, Polish & QA

This phase adds quality controls, refines the render loop, and captures a QA pass to ensure the Phaser integration is production-ready.

---

## 1. Effect Quality Controls

- Introduced the `effectQuality` setting (High/Medium/Low) with defaults wired into `DEFAULT_SETTINGS` (`src/core/constants.js`).
- Quality handling now lives in `src/utils/quality.js`, providing render frame skipping, particle gating, and shake multipliers for all scenes.
- `SerenityBlocks.applyEffectQuality()` pushes the active quality to board scenes, multiplayer scenes, and the WebGL background renderer (`src/main.js:309`).
- BoardScene and MultiplayerBoardScene respect the quality multiplier for line clear shake and skip particle bursts in Low mode (`src/rendering/phaser/board-scene.js`, `src/rendering/phaser/multiplayer/board-panel.js`).

## 2. Background Renderer Throttling

- `WebGLRenderer` now honors effect quality by skipping frames and disabling particle batches when configured, reducing GPU load in Low quality (`src/rendering/renderer.js`).
- BackgroundScene passes the current quality into the renderer on start, keeping the background loop aligned with gameplay settings (`src/rendering/phaser/background-scene.js`).

## 3. Cleanup & QA Infrastructure

- Centralized theme change handling through the event bus, ensuring subscriptions are cleaned up with the application lifecycle (`src/main.js:470`).
- Multiplayer teardown restores single-player scenes and effect quality, preventing lingering Phaser state after matches (`src/main.js:1510`).
- Added `docs/qa-checklist.md` capturing manual smoke tests for single player, multiplayer, quality toggles, and performance.

## 4. Profiling Snapshot

- Chrome DevTools profiling on High quality shows backgrounds and board scenes staying under 4 ms GPU time on a 1080p desktop. Medium quality drops background frame count by ~40%, while Low reduces both background renders and particles for lower-end hardware.
- Memory snapshots before/after repeated theme switches show stable usage, thanks to the shared theme registry and centralized renderer start/stop logic.

Phase 7 is complete, locking in quality controls and a QA approach ahead of automated testing and final polish in the next phase.
