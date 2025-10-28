# Game Mode Isolation Fix

## Problem

When running `window.testMultiplayer(2)`, single-player was still running in the background:
- Single-player effects were visible during multiplayer
- Single-player game loop was still updating
- Both modes were running simultaneously, causing confusion and performance issues

## Root Cause

The `stopSinglePlayer()` method in [game-mode-lifecycle.js](src/core/game-mode-lifecycle.js) was only **pausing** the game, not **stopping** it completely:

1. ❌ Only stopped `animationFrameId` (game loop)
2. ❌ **Did NOT stop** `renderFrameId` (render loop) - **this kept rendering**
3. ❌ Only **paused** Phaser scene (not stopped) - **scene kept processing events**

Result: Single-player kept rendering and processing in the background!

## Solution

### Fix 1: Stop BOTH Loops

**File**: [src/core/game-mode-lifecycle.js](src/core/game-mode-lifecycle.js#L95-L138)

Added code to stop the **render loop** in addition to the game loop:

```javascript
// Stop game loop (game logic updates)
if (this.app.animationFrameId) {
    cancelAnimationFrame(this.app.animationFrameId);
    this.app.animationFrameId = null;
}

// Stop render loop (canvas rendering) - NEW!
if (this.app.renderFrameId) {
    cancelAnimationFrame(this.app.renderFrameId);
    this.app.renderFrameId = null;
}
```

### Fix 2: STOP Scene (Not Just Pause)

Changed from `scene.pause()` to `scene.stop()`:

```javascript
// BEFORE (only paused - still active)
boardScene.scene.pause();

// AFTER (completely stops - shuts down scene)
boardScene.scene.stop();
```

**Why this matters**:
- `pause()` = Scene still in memory, still processes some events, quick to resume
- `stop()` = Scene completely shut down, no processing, clean isolation ✅

### Fix 3: Restart Scene When Switching Back

**File**: [src/core/game-mode-lifecycle.js](src/core/game-mode-lifecycle.js#L190-L230)

Updated `startSinglePlayer()` to **restart** the stopped scene:

```javascript
// Restart Phaser board scene (since we stopped it completely)
if (boardScene) {
    if (boardScene.scene.isPaused()) {
        boardScene.scene.resume(); // If somehow still paused
    } else if (!boardScene.scene.isActive()) {
        boardScene.scene.start(); // Restart stopped scene
    }
}

// Restart render loop if it was stopped
if (!this.app.renderFrameId && this.app.startRenderLoop) {
    this.app.startRenderLoop();
}
```

## What's Changed

### Before:
| When Switching to Multiplayer | Status |
|-------------------------------|--------|
| Game loop (`animationFrameId`) | ✅ Stopped |
| Render loop (`renderFrameId`) | ❌ **Still running** |
| Phaser board scene | ⚠️ **Paused (still processing)** |
| Canvas visibility | ✅ Hidden |
| Result | ❌ **Single-player kept rendering** |

### After:
| When Switching to Multiplayer | Status |
|-------------------------------|--------|
| Game loop (`animationFrameId`) | ✅ Stopped |
| Render loop (`renderFrameId`) | ✅ **Stopped** |
| Phaser board scene | ✅ **Completely stopped** |
| Canvas visibility | ✅ Hidden |
| Result | ✅ **Full isolation!** |

## Testing

### Test 1: Multiplayer Isolation
1. Run `window.testMultiplayer(2)`
2. Start game and play
3. **Expected**:
   - ✅ Only see multiplayer effects
   - ✅ No single-player effects visible
   - ✅ No double rendering
   - ✅ Console shows "Single-player completely stopped"

### Test 2: Mode Switching
1. Run `window.testMultiplayer(2)` (switches to multiplayer)
2. Exit multiplayer, start single-player
3. **Expected**:
   - ✅ Single-player works normally
   - ✅ Scene restarts properly
   - ✅ Render loop restarts
   - ✅ Console shows "Single-player mode started"

### Test 3: Performance
1. Run `window.testMultiplayer(2)`
2. Check FPS (should be 60)
3. **Expected**:
   - ✅ Smooth 60 FPS
   - ✅ No stuttering
   - ✅ Only one mode rendering at a time

## Console Output

### When Switching to Multiplayer:
```
🔄 Switching from single-player → online-multiplayer
  🛑 Stopping single-player mode...
    ⏹️ Cancelling game loop (animationFrameId): 12345
    ⏹️ Cancelling render loop (renderFrameId): 67890
    🛑 STOPPING Phaser board scene (complete shutdown)
    👁️ Hiding single-player canvas
    👁️ Hiding single-player container
  ✅ Single-player completely stopped
  ▶️ Starting online-multiplayer...
  ✅ Online multiplayer UI ready
✅ Now in online-multiplayer mode
```

### When Switching Back to Single-Player:
```
🔄 Switching from online-multiplayer → single-player
  ▶️ Starting single-player mode...
    👁️ Showing single-player container
    👁️ Showing single-player canvas
    🔄 Restarting stopped Phaser board scene
    🎬 Restarting canvas render loop
  ✅ Single-player mode started
```

## Files Modified

| File | Changes |
|------|---------|
| [src/core/game-mode-lifecycle.js](src/core/game-mode-lifecycle.js) | Updated `stopSinglePlayer()` and `startSinglePlayer()` |

**Lines changed**: ~60 lines (added proper cleanup and restart logic)

## Impact

### ✅ Benefits:
- Complete mode isolation - only one mode runs at a time
- Better performance - no wasted resources on hidden mode
- Clearer code - explicit stop/start instead of pause/resume
- No visual glitches - no single-player effects during multiplayer

### ⚠️ Trade-offs:
- Slightly slower mode switching (scene must restart instead of resume)
- Scene state is not preserved when switching (intentional - fresh start)

## Comparison with Other Fixes

This fix complements the camera shake fix from [FIXES_CAMERA_SHAKE_AND_MODE_ISOLATION.md](FIXES_CAMERA_SHAKE_AND_MODE_ISOLATION.md):

| Fix | Issue | Solution |
|-----|-------|----------|
| Camera Shake | Shake calculation wrong | Fixed quality multiplier math |
| **Mode Isolation** | **Single-player running behind multiplayer** | **Stop both loops + scene** |

Both fixes are **now complete**! ✅

## Next Steps

1. **Test multiplayer isolation**:
   - [ ] Run `window.testMultiplayer(2)`
   - [ ] Verify no single-player effects appear
   - [ ] Check console logs confirm complete shutdown

2. **Test mode switching**:
   - [ ] Switch between single-player and multiplayer
   - [ ] Verify both modes work correctly after switch
   - [ ] Check no errors in console

3. **Test visual effects**:
   - [ ] Camera shake works in both modes
   - [ ] Particles work in both modes
   - [ ] All effects isolated to active mode only

---

**Status**: ✅ **Fixed - Ready for Testing**

**Summary**: Single-player and multiplayer are now **completely isolated**. When you switch modes, the previous mode is **fully stopped** (not just hidden), preventing any interference!
