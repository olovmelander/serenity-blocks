# Quick Test Guide: Resize Effects Fix

## What Was Fixed
Visual effects (particles, flashes, camera shake) now work correctly after resizing the window or toggling fullscreen.

## How to Test

### Test 1: Basic Resize
1. Open the game in your browser
2. Start a single-player game
3. Clear a line - you should see particle effects ✓
4. **Resize the browser window** by dragging the edges
5. Clear another line - particles should still appear ✓

**Expected Console Logs:**
```
[BoardScene] Updating block size from 30 to 40
[BaseBoardScene] Configuring camera with bounds: {width: 400, height: 800, blockSize: 40}
[ParticleCompat] Attempting to emit 18 particles
```

### Test 2: Fullscreen Toggle
1. Start a single-player game
2. Clear a line to verify effects work
3. **Press F11** to enter fullscreen
4. Clear a line - effects should work ✓
5. **Press F11** again to exit fullscreen
6. Clear a line - effects should still work ✓

### Test 3: Combo After Resize
1. Start a game and build up for a combo (stack some garbage)
2. **Resize the window**
3. Execute the combo
4. You should see:
   - Particle bursts from cleared lines
   - Combo popup text
   - Camera shake
   - All effects working perfectly ✓

## What to Look For

### ✅ Success Indicators:
- Particles visible after every resize
- Flash effects on cleared lines
- Combo popups appearing
- Camera shake working
- Console shows: `[ParticleCompat] Attempting to emit X particles`

### ❌ Failure Indicators (if fix didn't work):
- No particles after resize
- Console shows: `particles: 0` continuously
- Camera bounds don't update
- Block size stays the same after resize

## Debug Console Commands

If effects aren't working, check these in the console:

```javascript
// Check current block size
window.game.boardScene.blockSize

// Check board config
window.game.boardScene.boardConfig

// Check camera bounds
window.game.boardScene.cameras.main.worldView

// Manually trigger effect (after clearing a line)
window.game.boardScene.effects.triggerLineClearFlash([19])
```

## Common Issues

### Issue: Particles still not visible
**Check:** Camera bounds in console logs
```
[BaseBoardScene] Camera configured at position: {x: 200, y: 480, bounds: "0,0 -> 400,800"}
```
The bounds should match the new canvas size!

### Issue: Effects work before resize but not after
**Check:** Block size update in console
```
[BoardScene] Updating block size from 30 to 40
```
If you don't see this log, the fix isn't applied correctly.

### Issue: Graphics covering particles
**Check:** Depth ordering logs
```
[BaseBoardScene] Graphics layers created successfully with depth ordering
```
Graphics should be at depth 0-2, particles at 3-5.

## Advanced Test: Rapid Resizing

1. Start a game
2. Rapidly resize the window multiple times
3. Clear lines between resizes
4. Effects should continue working throughout

This tests that:
- Graphics layers are properly recreated each time
- Camera updates correctly
- No memory leaks from old graphics objects
