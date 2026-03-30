# Trance State Effects - Depth/Z-Layer Fix (v2)

## Problem Identified

The trance state effects were being created successfully (as shown in console logs), but were **not visible on screen**. The issue was with **depth/z-layer ordering**.

### Root Cause

1. **Depth values were too low** (100-110) - likely being rendered behind game board graphics
2. **Particle emitters don't properly support `setDepth()` in Phaser 4** - they show `depth: 0` in logs even after calling `setDepth()`
3. **Rectangle positioning** - using centered origin instead of top-left caused misalignment

## Changes Made

### 1. Increased All Depth Values (v2 Fix)

Changed from low depths to **very high depths** to ensure trance effects render ABOVE everything:

| Effect | Old Depth | New Depth | Purpose |
|--------|-----------|-----------|---------|
| Overlay Rectangle | 100 | **1000** | Dark purple-blue background |
| Particles Layer 0-2 | 101-103 | **1001-1003** | Floating particle emitters |
| Color Waves | 105-106 | **1005-1006** | Animated wave graphics |
| Text (PAUSED) | 110 | **1010** | Text overlays |

### 2. Fixed Rectangle Positioning

**Before:**
```javascript
const overlay = this.scene.add.rectangle(
    boardWidth / 2,  // Center position
    boardHeight / 2,
    ...
);
// Default origin is (0.5, 0.5) - centered
```

**After:**
```javascript
const overlay = this.scene.add.rectangle(
    0,  // Top-left position
    0,
    ...
);
overlay.setOrigin(0, 0); // Explicit top-left origin
```

### 3. Enhanced Logging for Debugging

Added comprehensive logging to track:
- Exact positions (x, y)
- Depth values (requested vs actual)
- Visibility and alpha states
- Particle emitter creation success

### 4. Increased Opacity for Testing

Temporarily increased opacity values to make effects more obvious during debugging:
- Overlay: 30% → **50%** alpha
- Waves: 15% → **25%** alpha

### 5. Changed Overlay Blend Mode

Changed from `MULTIPLY` to `NORMAL` blend mode for easier debugging:
```javascript
overlay.setBlendMode('NORMAL'); // Was: 'MULTIPLY'
```

## What to Look For

When you pause in Infinity Mode, check the console for these new logs:

```
[TranceStateEffects] Overlay rectangle created: {
    x: 0,
    y: 0,
    width: 300,
    height: 600,
    depth: 1000,
    visible: true,
    alpha: 0
}

[TranceStateEffects] Overlay fade complete, final alpha: 0.5

[TranceStateEffects] Created floating particle layer 0 setDepth called with: 1001 actual depth: 0

[TranceStateEffects] Text overlay created: {
    pausedText: {x: 150, y: 210, depth: 1010},
    subtitleText: {x: 150, y: 252, depth: 1010}
}
```

## Expected Visual Results

You should now see:

1. ✅ **Dark purple overlay** covering the entire board (50% opacity, very obvious)
2. ✅ **"PAUSED" text** at top of board
3. ✅ **Subtitle text** below PAUSED
4. ✅ **Color waves** flowing across the board (more visible at 25% alpha)
5. ❓ **Particles** - may still have depth issues (emitters show depth: 0)

## Known Issue: Particle Emitters

Particle emitters in Phaser 4 may not properly respect `setDepth()`. The logs show:
```
setDepth called with: 1001 actual depth: 0
```

This suggests particle emitters might use a different depth system or always render at depth 0.

### Possible Workarounds for Particles

If particles still don't show:

1. **Create particles in a separate scene** with higher render priority
2. **Use sprites instead of particle emitters** for floating effects
3. **Check Phaser 4 documentation** for particle depth handling
4. **Use container objects** to group particles with explicit depth

## Testing Checklist

- [ ] Purple overlay visible and covers entire board
- [ ] Overlay fades in smoothly to 50% opacity
- [ ] "PAUSED" text visible and centered
- [ ] Subtitle text visible below PAUSED
- [ ] Color waves visible and animating
- [ ] Particles visible floating upward (may not work yet)
- [ ] Breathing/zoom effect active on camera
- [ ] All effects fade out smoothly when resuming

## Browser DevTools Inspection

To manually inspect scene objects:

```javascript
// Get the board scene
const scene = window.Phaser.Scene.getScene('BoardScene');

// List all children sorted by depth
const children = [...scene.children.list]
    .sort((a, b) => b.depth - a.depth)
    .map(c => ({
        type: c.type,
        depth: c.depth,
        visible: c.visible,
        alpha: c.alpha,
        x: c.x,
        y: c.y
    }));

console.table(children);
```

Look for objects at depth 1000-1010 - these are your trance effects!

## Next Steps if Still Not Visible

1. **Check camera bounds** - effects might be outside camera view
2. **Verify scene is active** - BoardScene might not be rendering
3. **Check for other overlays** - something else at depth > 1010 covering effects
4. **Inspect with Phaser dev tools** if available

## Reverting to Subtle Effects

Once visibility is confirmed, revert these test values:

```javascript
// Overlay
alpha: 0.5 → 0.3
blendMode: 'NORMAL' → 'MULTIPLY'

// Waves
alpha: 0.25 → 0.15
```

This will restore the subtle, trance-like aesthetic.
