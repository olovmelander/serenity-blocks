# Resize Effects Investigation

## Problem
Particle effects work initially but disappear after window resize or fullscreen toggle.

## What We Know

### Evidence from Console Logs
1. ✅ Particles ARE being created: `[ParticleCompat] Particle emitter created successfully`
2. ✅ Particles ARE being emitted: `[ParticleCompat] Calling explode(18)`
3. ✅ Particle objects exist: `Explode result: Particle2 {x: 207, y: 23, ...}`
4. ❌ Particles are NOT visible on screen
5. ❌ Particle count stays at 0: `[WebGLRenderer] render() called (frame 1380), particles: 0`

### Current Hypothesis
The particles are spawning **outside the camera's visible area** or **behind another canvas**.

## Possible Causes

### 1. Camera/Viewport Mismatch ✅ LIKELY
- Phaser game resized to 400x800
- Camera configured for 400x960 (includes hidden rows)
- Particles spawn at Y=23 but camera is centered at Y=560
- **Particles are above the camera's view!**

### 2. Canvas Layering Issue ✅ LIKELY
Two canvases exist:
- `single-player-game-canvas` (z-index: 1) - game rendering
- Phaser canvas (z-index: 10) - effects

If they don't align after resize, Phaser canvas might be positioned incorrectly.

### 3. Coordinate System Mismatch ✅ POSSIBLE
- Game uses visible rows only (20 rows * 40px = 800px)
- Phaser scene uses total rows (24 rows * 40px = 960px)
- Particle Y coordinates calculated for 960px world
- But canvas is only 800px tall

## Debug Steps

### Step 1: Check Console Logs After Resize
Look for these sequences:

```
[resizePhaserGame] Called with dimensions: {width: 400, height: 800}
[BoardScene] Resize called with canvas dimensions: 400 800
[BoardScene] Calculation: 800 (canvas height) / 20 (visible rows) = 40
[BaseBoardScene] Configuring camera with bounds: {width: 400, height: 960, blockSize: 40}
```

**Problem**: Camera height (960) doesn't match canvas height (800)!

### Step 2: Check Particle Spawn Position
After clearing a line:

```
[SharedEffects] Spawning particles for row 23 {
  hiddenRows: 4,
  blockSize: 40,
  zoneY: 760,  // (23 - 4) * 40 = 760
}
[ParticleCompat] Particle emitter created successfully at position: {x: 0, y: 760}
```

**Check**: Is Y=760 within the camera's visible range?
- Camera is centered at Y=560 (for 960px world)
- If canvas is only 800px, visible range is roughly Y=160 to Y=960
- Y=760 should be visible... unless there's another issue

### Step 3: Run Canvas Position Debug
Use the script in `DEBUG_CANVAS_POSITIONS.md` to check:
- Are both canvases the same size?
- Are they positioned at the same location (overlapping)?
- Is Phaser canvas actually visible (not display:none)?

## Potential Fixes

### Fix A: Match Camera to Canvas Size
Instead of camera using full board height (960px), make it match canvas height (800px):

```javascript
// In configureCamera()
const canvasHeight = this.scene.sys.game.canvas.height; // Use actual canvas height
camera.setBounds(0, 0, width, canvasHeight);
```

### Fix B: Adjust Particle Coordinates
Particles currently use world coordinates. They should use camera-relative coordinates:

```javascript
// In spawnLineClearParticles()
const cameraY = this.scene.cameras.main.scrollY;
const zoneY = (row - this.scene.hiddenRows) * this.scene.blockSize - cameraY;
```

### Fix C: Resize Scene World to Match Canvas
When resizing, update the scene's internal world size:

```javascript
// In BoardScene.resize()
const worldHeight = height; // Use canvas height, not (rows + hiddenRows) * blockSize
this.cameras.main.setBounds(0, 0, width, worldHeight);
```

## Next Steps

1. ✅ Add comprehensive logging (DONE)
2. ⏳ Run game, resize, clear line, check logs
3. ⏳ Identify which dimensions are mismatched
4. ⏳ Apply appropriate fix
5. ⏳ Test particles visible after resize

## Test Checklist

After applying fix:
- [ ] Start game, clear line → particles visible
- [ ] Resize window, clear line → particles visible
- [ ] Enter fullscreen, clear line → particles visible
- [ ] Exit fullscreen, clear line → particles visible
- [ ] Rapid multiple resizes, clear lines → particles always visible
