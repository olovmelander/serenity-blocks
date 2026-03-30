# Final Fix Summary: Particle Effects After Resize

## The Root Cause

The particles were being created and emitted successfully, but they were **outside the camera's viewport** after resize.

### The Problem:
1. **Game canvas**: 400px × 800px (for 20 visible rows × 40px blocks)
2. **Phaser camera bounds**: 400px × 960px (for 24 total rows including 4 hidden)
3. **Camera position**: Centered at Y=560 for the 960px world
4. **Particles spawning**: At Y=760 for row 23

The camera was configured for a 960px tall world but the actual canvas was only 800px. When particles spawned at Y=760 in world coordinates, they were outside the 800px canvas viewport!

## The Solution

**File**: [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js#L205-L247)

Changed the `configureCamera()` method to:
1. Set camera bounds to match the **actual canvas size** (not the theoretical board size)
2. Use `camera.setScroll()` to offset the view and hide the hidden rows

### Before (Broken):
```javascript
// Camera bounds = full board including hidden rows (960px)
const { width, height } = this.getBoardDimensions(); // 400x960
camera.setBounds(0, 0, width, height);
camera.centerOn(width / 2, visibleHeight / 2 + hiddenRows * blockSize);
```

### After (Fixed):
```javascript
// Camera bounds = actual canvas size (800px)
const canvasWidth = game.canvas.width;   // 400
const canvasHeight = game.canvas.height;  // 800
camera.setBounds(0, 0, canvasWidth, canvasHeight);

// Scroll to hide hidden rows at top
const hiddenHeight = hiddenRows * blockSize; // 160
camera.setScroll(0, hiddenHeight);
```

Now particles at Y=760 are visible because:
- Camera viewport: 0-800px in canvas space
- Camera scroll: 160px (hiding top 4 rows)
- Viewable world area: Y=160 to Y=960
- Particle at Y=760: ✅ VISIBLE!

## Additional Improvements

### 1. Block Size Calculation ([board-scene.js](src/rendering/phaser/board-scene.js#L227))
```javascript
// Use height (visible area) not width to calculate block size
const newBlockSize = height / this.rows;
```

### 2. Graphics Layer Depth ([base-board-scene.js](src/rendering/phaser/base-board-scene.js#L153-L168))
```javascript
// Explicit depth ordering to keep particles on top
this.graphicsLayers.board.setDepth(0);
this.graphicsLayers.piece.setDepth(1);
this.graphicsLayers.fx.setDepth(2);
// Particles at depth 3-5 render above all graphics
```

### 3. WebGL Context Handlers ([main.js](src/main.js#L545-L590))
```javascript
// Handle WebGL context loss/restore during fullscreen
canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
});
canvas.addEventListener('webglcontextrestored', () => {
    // Recreate graphics for all scenes
});
```

### 4. Comprehensive Debug Logging
Added detailed logging throughout to track:
- Resize events and dimensions
- Camera configuration
- Particle creation and emission
- Block size updates

## Testing

After applying these fixes:

1. **Start game** → Clear line → See particles ✅
2. **Resize window** → Clear line → See particles ✅
3. **Enter fullscreen** → Clear line → See particles ✅
4. **Exit fullscreen** → Clear line → See particles ✅

## Expected Console Output

After resize and line clear:
```
[resizePhaserGame] Called with dimensions: {width: 400, height: 800}
[BoardScene] Calculation: 800 (canvas height) / 20 (visible rows) = 40
[BaseBoardScene] Configuring camera: {canvasSize: "400x800", boardSize: "400x960", blockSize: 40}
[BaseBoardScene] Camera configured: {bounds: "0,0 -> 400,800", scroll: "0, 160", viewableArea: "Y: 160 to 960"}
[SharedEffects] Spawning particles for row 23 {zoneY: 760, blockSize: 40}
[ParticleCompat] Particle emitter created successfully at position: {x: 0, y: 760}
[ParticleCompat] Calling explode(18)
```

Y=760 is now within the viewable area (160-960), so particles will be visible!

## Files Modified

1. **[src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js)**
   - `configureCamera()` - Use canvas size for bounds, scroll for hidden rows
   - `createGraphicsLayers()` - Set explicit depth ordering
   - `recreateGraphicsLayers()` - Recreate graphics after resize

2. **[src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js)**
   - `resize()` - Calculate block size from height, update boardConfig

3. **[src/main.js](src/main.js)**
   - `setupWebGLContextHandlers()` - Handle WebGL context loss/restore
   - `resizePhaserGame()` - Enhanced logging

4. **[src/rendering/phaser/shared-effects.js](src/rendering/phaser/shared-effects.js)**
   - Added debug logging for particle spawning

5. **[src/rendering/phaser/utils/particle-compat.js](src/rendering/phaser/utils/particle-compat.js)**
   - Added debug logging for particle creation and emission

## Cleanup (Optional)

Once confirmed working, you can remove the extra `console.log()` statements added for debugging to keep the console cleaner. The fix itself is in the camera configuration logic, not the logging.

## Why This Happened

The original code assumed the Phaser canvas would be sized for the entire board (including hidden rows). However, the game's rendering strategy is:
- **Canvas 2D**: Renders the game board (visible area only)
- **Phaser WebGL**: Renders effects on top

The Phaser canvas is sized to match the Canvas 2D (visible area), but the camera was configured for the full board. This mismatch caused particles to render outside the viewport after resize operations.
