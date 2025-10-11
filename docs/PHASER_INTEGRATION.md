# Phaser v4 Integration Guide

## Overview

Serenity Blocks has been successfully integrated with **Phaser v4** (version 0.2.2) for rendering. This document outlines the integration architecture, what was changed, and how to work with the new system.

## Architecture

### Before Integration
- **Canvas 2D Rendering**: Direct `CanvasRenderingContext2D` drawing in `src/rendering/draw.js`
- **WebGL Background**: Separate `WebGLRenderer` for background themes
- **Manual Game Loop**: Custom `requestAnimationFrame` loop

### After Integration
- **Phaser Scene**: `BoardScene` in `src/rendering/phaser/board-scene.js` handles all game board rendering
- **WebGL Background**: Still uses `WebGLRenderer` for theme backgrounds (runs alongside Phaser)
- **Hybrid Game Loop**: Core game logic runs separately, syncs state to Phaser scene each frame
- **Canvas Fallback**: Original canvas rendering still available as fallback

## File Structure

```
src/
├── rendering/
│   ├── phaser/
│   │   └── board-scene.js    # New Phaser scene for game board
│   ├── draw.js                # Original canvas rendering (fallback)
│   ├── canvas-utils.js        # Canvas utilities
│   └── renderer.js            # WebGL renderer for backgrounds
├── main.js                    # Updated to initialize Phaser
└── ...
```

## Key Changes

### 1. HTML Structure ([public/index.html](../public/index.html))

**Added:**
- Phaser v4 CDN script tag
- New container `<div id="phaser-game-container">` for Phaser canvas
- Hidden original `<canvas id="game-canvas">` for fallback

```html
<!-- Phaser 4 Framework -->
<script src="https://cdn.jsdelivr.net/npm/@phaserjs/phaser@0.2.2/umd/Phaser.js"></script>

<div id="phaser-game-container"></div>
<canvas id="game-canvas" style="display: none;"></canvas>
```

### 2. Main Application ([src/main.js](../src/main.js))

**Added:**
- `initializePhaserGame()` method to create Phaser game instance
- `phaserGame` and `boardScene` properties
- Scene state synchronization in `gameLoop()`
- Phaser cleanup in `cleanup()` method
- `onLineClearImpact` callback to funnel line clear intensity data to Phaser

**Modified:**
- Physics callbacks now route to Phaser scene effects (line clears, combos, ripples)
- Fallback to canvas rendering if Phaser scene not available

### 3. Phaser Board Scene ([src/rendering/phaser/board-scene.js](../src/rendering/phaser/board-scene.js))

**Created new Phaser scene with:**
- `syncFromGameState(gameState)` - Update scene with current game state
- `renderGameState()` - Render locked pieces, ghost piece, current piece
- `drawBlock()` - Render individual blocks with 3D effect
- `triggerLineClearFlash()` - Flash effect for cleared lines
- `createPieceLockRipple()` - Ripple effect when piece locks
- `showComboPopup()` - Display combo text with animation

## How It Works

### Game Loop Flow

1. **Core Game Loop** (`src/core/game.js`)
   - Updates game state (piece movement, physics, scoring)
   - Remains unchanged, no Phaser dependencies

2. **Main Loop** (`src/main.js` → `gameLoop()`)
   - Syncs game state to Phaser scene: `this.boardScene.syncFromGameState(this.gameState)`
   - Phaser scene automatically renders in its own update loop

3. **Phaser Scene Update** (`board-scene.js` → `update()`)
   - Called automatically by Phaser every frame
   - Reads game state and renders board, pieces, effects

### Rendering Pipeline

```
GameState (data)
    ↓
syncFromGameState()
    ↓
BoardScene.update()
    ↓
renderGameState()
    ↓
- drawLockedPieces()
- drawGhostPiece()
- drawCurrentPiece()
    ↓
Phaser Graphics API
```

## Features Ported to Phaser

✅ **Core Rendering**
- Grid background
- Locked pieces (board state)
- Current falling piece
- Ghost piece (drop preview)

✅ **Visual Effects**
- Line clear flash
- Piece lock ripple
- Combo popups with tweens
- 3D block shading
- Particle bursts & camera shake tied to line clears

✅ **Game Integration**
- State synchronization
- Input events (via existing InputController)
- Audio (via existing SoundManager)

## What's Still Canvas-Based

⚠️ **Multiplayer Mode**
- Currently uses original canvas rendering
- TODO: Create separate Phaser scenes for P1 and P2 boards

⚠️ **Next Pieces Preview**
- Small canvas elements for next piece display
- Could be migrated to Phaser scenes if needed

⚠️ **Background Themes**
- Uses separate WebGL renderer
- Intentionally kept separate (runs behind Phaser canvas)

## Configuration

### Phaser Config (in `main.js`)

```javascript
{
    type: window.Phaser.WEBGL,
    width: COLS * BLOCK_SIZE,
    height: (ROWS - HIDDEN_ROWS) * BLOCK_SIZE,
    parent: 'phaser-game-container',
    transparent: true,              // Shows themes behind
    scene: [BoardScene],
    physics: { default: false },    // No Phaser physics needed
    render: {
        antialias: true,
        pixelArt: false
    }
}
```

## Performance Considerations

### Benefits of Phaser
- **Hardware Acceleration**: WebGL rendering via Phaser
- **Optimized Graphics API**: Efficient batching and rendering
- **Built-in Tweens**: Smooth animations for effects
- **Scene Management**: Clean separation of rendering logic

### Memory Usage
- Phaser adds ~200KB to bundle (via CDN)
- Scene graphics cleared each frame, minimal memory growth
- Original canvas kept hidden as fallback (~10KB overhead)

## Future Enhancements

### Potential Improvements
1. **Particle Systems**: Theme-aware particles & debris textures
2. **Sprite Assets**: Load actual sprite sheets for blocks instead of procedural graphics
3. **Advanced Effects**:
   - Cinematic camera choreography (zoom/pan on big plays)
   - Themed particle palettes & debris sprites
   - Post-processing shaders
4. **Multiplayer Scenes**: Separate BoardScene instances for each player
5. **Audio via Phaser**: Migrate SoundManager to Phaser's audio system

### Optional: ES Module Build

Currently using CDN. To use ES modules:

```bash
npm init -y
npm install @phaserjs/phaser vite
```

**vite.config.js:**
```javascript
export default {
    optimizeDeps: {
        include: ['@phaserjs/phaser']
    }
}
```

**main.js:**
```javascript
import * as Phaser from '@phaserjs/phaser';
// Remove window.Phaser references
```

## Troubleshooting

### Phaser Not Loading
- Check browser console for CDN errors
- Verify `window.Phaser` is defined before init
- Script tag must be before `main.js`

### Canvas Not Showing
- Ensure `#phaser-game-container` div exists
- Check CSS z-index (should be above background, below UI)
- Verify Phaser config `transparent: true`

### Performance Issues
- Monitor framerate in browser DevTools
- Check for memory leaks (scene cleanup)
- Reduce particle/effect complexity if needed

### Fallback Not Working
- Ensure original `draw.js` still imported
- Check `if (!this.boardScene)` condition in gameLoop
- Canvas element should not be removed from DOM

## Testing

### Manual Testing Steps
1. Open game in browser
2. Check browser console for "✅ Phaser game initialized"
3. Start game, verify pieces render correctly
4. Clear lines, verify flash effect
5. Check combo popup appears
6. Verify piece lock ripple effect

### Known Issues
- Multiplayer still uses canvas (not migrated yet)
- Scene resize on window resize needs testing
- Mobile touch controls not tested with Phaser

## References

- [Phaser 4 Documentation](https://newdocs.phaser.io/docs/)
- [Phaser Graphics API](https://newdocs.phaser.io/docs/3.55.2/Phaser.GameObjects.Graphics)
- [Phaser Tweens](https://newdocs.phaser.io/docs/3.55.2/Phaser.Tweens.Tween)

## Migration Checklist

- [x] Load Phaser 4 CDN
- [x] Create BoardScene wrapper
- [x] Initialize Phaser game instance
- [x] Sync game state to scene
- [x] Port block rendering
- [x] Port ghost piece rendering
- [x] Port line clear effects
- [x] Port piece lock ripple
- [x] Port combo popups
- [x] Update input handling
- [x] Update game loop integration
- [ ] Migrate multiplayer to Phaser
- [ ] Add particle effects
- [ ] Load sprite assets (optional)
- [ ] Bundle with Vite/Rollup (optional)

---

**Last Updated**: 2025-10-11
**Phaser Version**: 0.2.2
**Integration Status**: ✅ Complete (Single Player)
