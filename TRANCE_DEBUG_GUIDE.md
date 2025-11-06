# Trance State Effects - Debugging Guide

## What Should Happen

When you press **P** to pause in Infinity Mode, you should see:

1. **Purple overlay** - A dark purple-blue tint covering the board (30% opacity)
2. **Floating particles** - Small dots gently rising from bottom to top
3. **Color waves** - Flowing sine wave patterns in purple/blue tones
4. **Text overlay** - "PAUSED" text with subtitle
5. **Breathing effect** - Very subtle camera zoom in/out

## How to Debug

### Step 1: Check the Browser Console

Open browser dev tools (F12) and look for these logs when you pause:

```
[Infinity] Game paused
[Infinity] Camera controls enabled...
[Infinity] Trance state effects activated
[TranceStateEffects] Starting trance state...
[TranceStateEffects] Creating text overlay
[TranceStateEffects] Creating overlay with dimensions: {boardWidth: 300, boardHeight: 600}
[TranceStateEffects] Overlay rectangle created at depth 100
[TranceStateEffects] Found particle texture: line-clear-particle (or common-circle-4px)
[TranceStateEffects] Created floating particle layer 0 at depth 101
[TranceStateEffects] Creating color waves with dimensions: {boardWidth: 300, boardHeight: 600}
[TranceStateEffects] Wave graphics 0 created at depth 105
```

### Step 2: Check for Errors

Look for these potential errors:

#### Particle Texture Not Found
```
[TranceStateEffects] No particle texture found. Tried: ['line-clear-particle', 'common-circle-4px', 'particle']
```
**Fix**: The BoardScene should create the `line-clear-particle` texture in its preload. Make sure Infinity Mode is using BoardScene correctly.

#### Phaser Not Available
```
[TranceStateEffects] Phaser.Geom.Rectangle not available
```
**Fix**: Check that `window.Phaser` is properly loaded.

#### Board Dimensions Wrong
```
[TranceStateEffects] Board dimensions: {boardWidth: 300, boardHeight: 600}
```
**Expected**: For standard Tetris board: 300px width (10 cols × 30px), 600px height (20 rows × 30px)

### Step 3: Inspect Scene Objects

In console, inspect the scene:
```javascript
// Get the board scene
const boardScene = window.Phaser.Scene.getScene('BoardScene');

// Check if trance effects are active
console.log('Scene children count:', boardScene.children.list.length);

// Find trance effect objects (should see rectangles, text, particles at depths 100-110)
boardScene.children.list.forEach(child => {
    console.log(child.type, 'depth:', child.depth, 'alpha:', child.alpha);
});
```

Expected objects during trance state:
- `Rectangle` at depth 100 (overlay)
- `ParticleEmitter` at depths 101-103 (floating particles)
- `Graphics` at depths 105-106 (color waves)
- `Text` at depth 110 (PAUSED text)

### Step 4: Check Depth Sorting

The BoardScene might have objects at higher depths that cover our effects. Check:

```javascript
const boardScene = window.Phaser.Scene.getScene('BoardScene');
const sortedByDepth = [...boardScene.children.list].sort((a,b) => a.depth - b.depth);
console.table(sortedByDepth.map(c => ({type: c.type, depth: c.depth, visible: c.visible, alpha: c.alpha})));
```

Our effects should be at depths 100-110. If the game board is at depth > 110, it will cover our effects.

### Step 5: Verify Update Loop is Running

Check that the update loop is active:

```javascript
// In InfinityMode, check if tranceEffects exists
console.log('Trance effects active:', this.tranceEffects?.isActive);
console.log('Update loop:', this.tranceEffects?.updateLoop);
```

### Step 6: Force Create Effects Manually

Try creating effects manually in console:

```javascript
const boardScene = window.Phaser.Scene.getScene('BoardScene');

// Create a test rectangle
const testRect = boardScene.add.rectangle(150, 300, 300, 600, 0xff0000, 0.5);
testRect.setDepth(200);
testRect.setScrollFactor(0);

// If you see the red rectangle, the effects system works
// If not, there's a deeper issue with the scene rendering
```

## Common Issues & Solutions

### Issue: Only Text Shows, No Other Effects

**Cause**: Particle textures or Phaser.Geom not available

**Solution**:
1. Check console for warnings about missing textures
2. Verify BoardScene's preload creates `line-clear-particle` texture
3. Check that Phaser 4 is fully loaded

### Issue: Nothing Shows At All

**Cause**: Scene update loop clearing graphics, or depth issues

**Solution**:
1. We use Rectangle shapes (not Graphics) for overlay - they persist
2. Check depth sorting - our effects are at 100-110
3. Verify scrollFactor is set to 0 on all effects

### Issue: Effects Show But Disappear Immediately

**Cause**: Update loop or pause state issue

**Solution**:
1. Check `isActive` flag in TranceStateEffects
2. Verify update loop is created and running
3. Check that `isPaused` is true in gameState

### Issue: Particles Don't Move

**Cause**: Emitters not started or frequency too low

**Solution**:
1. Check that `emitter.start()` is called
2. Verify particle config has `frequency` set
3. Check console for particle emission logs

## Architecture Notes

### Why We Use Different Object Types

1. **Rectangle** for overlay: Persists across frames, simple to fade
2. **Graphics** for waves: Redrawn each frame in update loop with animated patterns
3. **ParticleEmitter** for particles: Self-managed, Phaser handles lifecycle
4. **Text** for labels: Persists across frames, simple to animate

### Scene Update Loop Behavior

The BoardScene clears its Graphics layers every frame:
```javascript
update(time, delta) {
    this.boardGraphics?.clear();
    this.pieceGraphics?.clear();
    this.effectsGraphics?.clear();
    // ...
}
```

This is why we:
- Use Rectangle/Text/Particles (not Graphics) for static effects
- Redraw Graphics objects in our own update loop for animated effects

## Testing Checklist

- [ ] Press P in Infinity Mode
- [ ] Console shows trance state activation logs
- [ ] See purple overlay fade in
- [ ] See "PAUSED" text appear
- [ ] See particles floating upward
- [ ] See color waves flowing
- [ ] See subtle breathing/zoom effect
- [ ] Press P again - effects fade out smoothly
- [ ] No console errors

## Performance Notes

- Update loop runs at ~60fps (16ms delay)
- 3 particle emitters active
- 2 graphics objects redrawn each frame
- Minimal CPU impact due to small board size (300×600px)
