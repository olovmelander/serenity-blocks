# Phaser Architecture Reference

This document captures the Phase 8 architecture handoff for Serenity Blocks' Phaser-first runtime.

## Scene Graph

```text
SerenityBlocks (src/main.js)
├── Phaser.Game
│   ├── BoardScene (single-player gameplay board)
│   ├── BackgroundScene (drives Three.js/WebGL backgrounds)
│   └── MultiplayerBoardScene1/2 (local MP, added dynamically)
├── ThemeManager
│   └── WebGLRenderer (theme backgrounds, quality-aware external loop)
├── InputController / GamepadController
├── SoundManager / AudioManager
└── GameModeManager
```

## Frame Pipeline

```text
Core game logic update
    ↓
SerenityBlocks sync step (main.js)
    ↓
Phaser scene state sync
    ↓
BoardScene / MultiplayerBoardScene render
    ↓
BackgroundScene tick
    ↓
WebGLRenderer.renderFrame() (external loop mode)
```

## Event Pipeline

```text
Game events / Theme events
    ↓
eventBus (src/events/event-bus.js)
    ↓
Subscribers (main app, managers, scenes)
    ↓
Visual/audio reactions + cleanup handlers
```

## Asset Pipeline

```text
Theme registry metadata
    ↓
ThemeManager lazy-load (dynamic import)
    ↓
Theme instance lifecycle
    ├── start/load assets
    ├── reactive updates
    └── suspend/stop/dispose
    ↓
BackgroundScene + renderer integration
```

## Multiplayer Viewport Pipeline

```text
Game mode enters local MP
    ↓
main.js ensureMultiplayerBoardScenes()
    ↓
Add scene instances to SceneManager
    ↓
Start scenes with viewport/player config
    ↓
syncMultiplayerBoardScenes() on updates
    ↓
teardownMultiplayerBoardScenes() on exit
```

## Ownership Summary

- `main.js` owns app lifecycle and scene orchestration.
- Phaser scenes own gameplay visual rendering.
- `WebGLRenderer` owns theme background rendering.
- `ThemeManager` owns theme loading/switching and renderer handoff.
- `eventBus` owns cross-system event distribution.
