# Effects Resize Fix

## Problem
Visual effects (particles, flashes, combos) stopped working after:
- Entering/exiting fullscreen mode
- Resizing the browser window
- Any screen size adjustment

## Root Causes
1. **Board Config Not Updated**: When the canvas resized, the `boardConfig.blockSize` was not updated, causing the camera to use old dimensions
2. **Particles Outside Camera Bounds**: Particles were being created at positions based on the NEW dimensions, but the camera was still viewing the OLD dimensions, so particles were outside the viewport
3. **Graphics Layer Depth**: Graphics layers created after resize had undefined depth, potentially covering particles

## Solution
Implemented four key fixes:

### 1. Update Board Config on Resize (`board-scene.js`)
**THE CRITICAL FIX**: Update the blockSize in boardConfig when resize occurs:
```javascript
resize(width, height) {
    // Calculate new block size based on new canvas dimensions
    const newBlockSize = width / this.cols;
    this.blockSize = newBlockSize;
    this.boardConfig.blockSize = newBlockSize; // CRITICAL!

    // Then reconfigure camera (which reads from boardConfig)
    this.configureCamera();
}
```

Without this, the camera uses old dimensions and particles spawn outside the viewport!

### 2. Graphics Layer Depth Ordering (`base-board-scene.js`)
Set explicit depth values when creating graphics to ensure particles render on top:
```javascript
createGraphicsLayers() {
    this.graphicsLayers.board = this.add.graphics();
    this.graphicsLayers.board.setDepth(0);  // Bottom layer

    this.graphicsLayers.piece = this.add.graphics();
    this.graphicsLayers.piece.setDepth(1);  // Middle layer

    this.graphicsLayers.fx = this.add.graphics();
    this.graphicsLayers.fx.setDepth(2);     // Top graphics layer

    // Particles are at depth 3-5, so they render above all graphics
}
```

### 3. Graphics Layer Recreation (`base-board-scene.js`)
Added `recreateGraphicsLayers()` method that:
- Destroys old graphics objects when resize occurs
- Creates fresh graphics layers with valid WebGL context
- Reattaches aliases for backward compatibility

The resize handler now calls this method automatically:
```javascript
registerResizeHandler() {
    if (this.scale) {
        this.scale.on('resize', (gameSize, baseSize, displaySize, resolution) => {
            // Recreate graphics layers to ensure they work after resize
            this.recreateGraphicsLayers();

            // Reconfigure camera to ensure proper rendering after resize
            this.configureCamera();
        });
    }
}
```

### 4. WebGL Context Loss/Restore Handlers (`main.js`)
Added event listeners to handle WebGL context loss:
- Prevents permanent context loss by calling `event.preventDefault()`
- Automatically recreates graphics when context is restored
- Ensures all active scenes reinitialize their graphics

```javascript
canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); // Critical: prevents permanent loss
}, false);

canvas.addEventListener('webglcontextrestored', () => {
    // Recreate graphics for all active scenes
    activeScenes.forEach(sceneKey => {
        scene.recreateGraphicsLayers();
        scene.drawGrid();
    });
}, false);
```

## Testing

### Test 1: Fullscreen Toggle
1. Start a single-player game
2. Clear some lines to see particle effects (should work)
3. Press F11 or click fullscreen button
4. Clear more lines - effects should still work ✅
5. Exit fullscreen (F11 again)
6. Clear lines - effects should still work ✅

### Test 2: Window Resize
1. Start a single-player game
2. Clear lines to verify effects work
3. Resize the browser window by dragging edges
4. Clear more lines - effects should continue working ✅

### Test 3: Extreme Combos
1. Start game and create a combo situation
2. Toggle fullscreen
3. Execute combo - particles, flashes, and camera shake should all work ✅

## Console Output
You should see these logs during resize operations:
```
[BaseBoardScene] Scale resize event: {gameSize: ..., displaySize: ...}
[BoardScene] Resize: 400 800
[BoardScene] Updating block size from 30 to 40  <-- Critical: block size updated!
[BaseBoardScene] Recreating graphics layers after resize
[BaseBoardScene] Graphics layers created successfully with depth ordering
[BaseBoardScene] Graphics layers recreated successfully
[BaseBoardScene] Configuring camera with bounds: {width: 400, height: 800, blockSize: 40, hiddenRows: 4}
[BaseBoardScene] Camera configured at position: {x: 200, y: 480, bounds: "0,0 -> 400,800"}
[BoardScene] Effects ready after resize with new block size: 40
[ParticleCompat] Attempting to emit 18 particles  <-- Particles emitting after resize!
```

If WebGL context loss occurs (rare but possible):
```
[WebGL Context] Context lost, attempting to prevent default behavior
[WebGL Context] Context restored, reinitializing graphics
[WebGL Context] Recreating graphics for BoardScene
[WebGL Context] ✅ Graphics reinitialized after context restore
```

## Files Modified
1. [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js) - Added `recreateGraphicsLayers()` method
2. [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) - Enhanced `resize()` method
3. [src/main.js](src/main.js) - Added `setupWebGLContextHandlers()` method

## Technical Details

### Why Board Config Must Be Updated
- The `boardConfig.blockSize` determines the coordinate system for all game elements
- When the canvas resizes (e.g., 300x600 → 400x800), the block size changes (30px → 40px)
- The camera uses `getBoardDimensions()` which reads from `boardConfig`
- If `boardConfig` isn't updated, the camera bounds stay at old dimensions
- Particles spawn at NEW coordinates but camera views OLD area = invisible particles!

### Why Depth Ordering Matters
- Without explicit depth, graphics layers default to creation order
- Recreating graphics can change their depth relative to particles
- Particles are created with depth 3-5
- Graphics must be explicitly set to depth 0-2 to stay below particles

### Why Graphics Need Recreation
- Phaser graphics objects hold references to WebGL buffers and state
- When canvas is resized, the WebGL rendering context may be recreated
- Old graphics objects retain references to the invalidated context
- New graphics objects must be created with fresh context references

### Why Context Loss Handlers
- Fullscreen transitions can trigger WebGL context loss in some browsers
- Context loss without restoration prevents all WebGL rendering
- Calling `preventDefault()` allows the browser to restore the context
- Our handler recreates graphics automatically when context is restored

### Performance Impact
- Graphics recreation is very fast (< 1ms typically)
- Only occurs during resize/fullscreen events (not during gameplay)
- No performance impact during normal gameplay
- Particle systems are preserved and continue working

## Future Improvements
- Could pool graphics objects to reduce allocation overhead
- Could batch multiple rapid resize events to reduce recreation calls
- Could add visual feedback during context restoration (loading spinner)
