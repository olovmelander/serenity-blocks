# Phaser Integration Guide

## Overview

Serenity Blocks now runs on a Phaser-first rendering architecture:

- Phaser handles board rendering for single-player and multiplayer.
- A Three.js/WebGL background renderer is orchestrated by a dedicated Phaser background scene.
- Core game logic remains engine-agnostic and syncs state into Phaser scenes.

Current Phaser dependency:
- `phaser@4.0.0-rc.5` (`package.json`)

## Runtime Composition

### Rendering Layers

1. **Gameplay layer (Phaser)**
   - `BoardScene` for single player.
   - `MultiplayerBoardScene` instances for local multiplayer viewports.
2. **Background layer (Three.js)**
   - Driven by `BackgroundScene`.
   - Uses the existing `WebGLRenderer` path and theme manager.
3. **UI/manager layer**
   - Game state, input, audio, theme switching, and mode lifecycle in `src/main.js`.

## Source Map

- Bootstrap and lifecycle: `src/main.js`
- Base scene utilities: `src/rendering/phaser/base-board-scene.js`
- Single-player scene: `src/rendering/phaser/board-scene.js`
- Multiplayer scene: `src/rendering/phaser/multiplayer/board-panel.js`
- Background bridge scene: `src/rendering/phaser/background-scene.js`
- Shared effects: `src/rendering/phaser/shared-effects.js`
- Event bus: `src/events/event-bus.js`

## Phaser Boot Flow

`src/main.js` performs the integration in this order:

1. Build scene classes using factory helpers:
   - `createBoardScene(Phaser)`
   - `createBackgroundScene(Phaser)`
   - `createMultiplayerBoardScene(Phaser)`
2. Create a Phaser game instance with:
   - `type: Phaser.WEBGL`
   - transparent canvas
   - configured scale settings
3. Register startup scenes:
   - `BoardScene`
   - `BackgroundScene`
4. Capture scene references and sync quality settings.
5. In multiplayer modes, dynamically add/start two `MultiplayerBoardScene` instances with per-player viewports.

## Data and Event Flow

### Board State Sync

- Core logic updates game state.
- `main.js` pushes snapshots into active Phaser board scene(s).
- Scene update methods render board cells, active piece, ghost piece, effects, and HUD overlays.

### Theme and Reactive Events

- Theme changes are emitted through `eventBus` (`EVENTS.THEME_CHANGED`).
- Consumers (e.g., audio manager, scene systems) subscribe/unsubscribe via cleanup handlers.
- Background rendering is lifecycle-controlled by Phaser scene start/stop to avoid duplicate RAF loops.

## Quality Controls

Quality profile support (High/Medium/Low) is applied across:

- Single-player scene
- Multiplayer scenes
- Background WebGL renderer

Quality settings propagate from `main.js` via `applyEffectQuality(...)`, and scenes read normalized quality config through shared utilities.

## Fallback and Compatibility Notes

- Legacy canvas paths remain as guarded fallback paths.
- Phaser is bundled via npm/Vite (no CDN global required).
- The architecture is designed to preserve gameplay behavior while isolating rendering concerns into scene classes.

## Validation Checklist

When modifying Phaser integration, verify:

1. Boot succeeds and scenes are available.
2. Single-player board renders and updates correctly.
3. Multiplayer scenes start/teardown cleanly.
4. Theme switches do not break background rendering.
5. Quality level changes propagate to all active scenes.

For broader QA coverage, use `docs/qa-checklist.md`.
