# Phaser Migration · Phase 6 Systems Integration & Cleanup

Phase 6 focuses on unifying event flow, wiring the background renderer into Phaser’s lifecycle, and removing remaining legacy hooks.

---

## 1. Global Event Bus

- Introduced `src/events/event-bus.js`, providing a lightweight pub/sub API with named events.
- `ThemeManager` now emits `themeChanged` events through the bus instead of window-level `CustomEvent`s (`src/themes/theme-manager.js`).
- The main application subscribes via the bus to update theme-linked music, with subscriptions cleaned up automatically (`src/main.js:472`).

## 2. Background Renderer Ownership

- Added `BackgroundScene`, a Phaser scene that drives the existing `WebGLRenderer` every frame (`src/rendering/phaser/background-scene.js`).
- `WebGLRenderer` gained an external render loop mode (`enableExternalRenderLoop`) so Phaser can control frame timing (`src/rendering/renderer.js`).
- The Phaser bootstrap now creates the background scene alongside board scenes; the wrapper scene is started once managers are ready (`src/main.js:255`, `src/main.js:332`).

## 3. Event & Lifecycle Cleanup

- Replaced window-level theme listeners with event bus subscriptions and consolidated cleanup via `cleanupHandlers` (`src/main.js:470`).
- Multiplayer teardown now restores the single-player scene and clears Phaser UI toggles (`src/main.js:1510`).
- Redundant DOM draw paths for multiplayer renders were removed; both boards render via `MultiplayerBoardScene` while DOM stats remain only for legacy fallback (`src/main.js:1232`).

## 4. Remaining Considerations

- DOM multiplayer stats still update for fallback mode; Phase 7 can remove or gate them once Phaser UI parity is complete.
- Theme registry metadata can underpin advanced preloading in later phases.
- When bundler tooling lands (post plan), the event bus can expose typings/enum exports tailored to that pipeline.

With Phase 6 complete, the project now centralizes rendering orchestration through Phaser and a shared event model, clearing the way for final cleanup, QA, and tooling work in Phase 7.
