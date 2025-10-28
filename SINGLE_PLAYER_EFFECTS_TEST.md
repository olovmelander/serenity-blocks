# Single-Player Effects Test Guide

## What Should Happen Now

When you play single-player, you should see **all the beautiful Phaser effects**:

### 1. Piece Lock Ripple 🌊
**When**: Every time a piece locks into place
**What you'll see**:
- Expanding circle from the piece center
- Circle is colored (matches the piece color)
- Smooth animation (tweens)
- Duration: ~400ms

**How to test**: Drop any piece (soft drop or hard drop with Space)

---

### 2. Line Clear Flash ⚡
**When**: Lines are cleared
**What you'll see**:
- White flash on the cleared row(s)
- Very brief (~100ms)
- Opacity: 60%

**How to test**: Clear 1 line

---

### 3. Particle Bursts 🎆
**When**: Lines are cleared
**What you'll see**:
- Small white particles flying upward from cleared rows
- Particles have gravity (arc up then fall down)
- Additive blend mode (glowing effect)
- Color changes with combo level:
  - 0-1 combo: Cyan
  - 2 combos: Green-cyan
  - 3 combos: Orange
  - 4 combos: Magenta
  - 5+ combos: Rainbow!

**How to test**:
- Clear 1 line → cyan particles
- Clear lines consecutively → see color changes

---

### 4. Camera Shake 📳
**When**: Lines are cleared
**What you'll see**:
- Subtle screen shake
- Intensity increases with line count:
  - 1 line: Subtle
  - 2 lines: Moderate
  - 3 lines: Strong
  - 4 lines (Tetris): Very strong

**How to test**: Clear different numbers of lines

---

### 5. Combo Popups 💬
**When**: Clearing lines consecutively (2+ combos)
**What you'll see**:
- Text appears in center: "2x COMBO!", "3x COMBO!", etc.
- Font: Orbitron, 32px
- Animation: Scales up (0.8→1.2), fades out, moves up
- Duration: ~800ms

**How to test**:
1. Clear a line
2. Immediately clear another line (within ~1 second)
3. Continue clearing to build combo

---

### 6. Combo Explosion Particles 💥
**When**: 2+ combos
**What you'll see**:
- 360-degree particle bursts from screen center
- Multiple bursts cascade (one every 100ms)
- Particle count and speed increase with combo level
- Colors match combo level (same as line clear particles)

**How to test**: Build a 2x, 3x, or 4x combo

---

### 7. Radial Wave Effect 🌀
**When**: 5+ combos
**What you'll see**:
- Perfect circle of particles expanding outward
- 60-80 particles in ring formation
- No gravity (clean ring expansion)
- Rainbow colors cycling around the ring
- Appears 150ms after combo popup

**How to test**: Build a 5x or higher combo

---

## Console Output to Check

### When Starting Single-Player:
```
[Phaser] Starting BoardScene (was not active)
[BoardScene] create() called for BoardScene...
[SharedEffects] Initialized for scene: BoardScene
[BoardScene] Shared effects initialized
[Phaser] BoardScene reference updated, has effects: true
🎮 Single player game started!
```

**Key Line**: `has effects: true` ← This confirms SharedEffects is initialized!

### When Effects Trigger:
Look for these in console (if logging is enabled):
```
⚡ Line clear flash: [18, 19]
🌊 Piece lock ripple: <piece object>
🎆 Combo popup: 3
```

---

## Settings to Check

Make sure these settings are enabled:
1. **Line Clear Effects**: ON
2. **Combo Popup Effect**: ON
3. **Piece Lock Ripple**: ON
4. **Quality Settings**: Medium or High (particles disabled on Low)

---

## Troubleshooting

### If you DON'T see effects:

**Check 1**: Console logs
- Look for "has effects: true"
- If false → SharedEffects didn't initialize

**Check 2**: Settings
- Open settings
- Ensure effects are enabled

**Check 3**: Quality
- Check quality isn't set to "Low"
- Low quality disables particles

**Check 4**: Console errors
- Look for any red errors
- Check for "Failed to create particles" warnings

---

## Quick Test Sequence

1. **Refresh page**
2. **Press Space** or click "Single Player"
3. **Check console** for "has effects: true"
4. **Drop a piece** → See ripple?
5. **Clear 1 line** → See flash + particles + shake?
6. **Clear 2 lines in a row** → See "2x COMBO!" popup?
7. **Clear 4 lines** → See strong shake + lots of particles?
8. **Build 5x combo** → See radial wave?

---

## What You Should See (Summary)

### Every Piece Lock:
- ✅ Colored ripple expanding from piece

### Every Line Clear:
- ✅ White flash on row
- ✅ Particles flying upward (colored)
- ✅ Screen shake

### 2+ Combos:
- ✅ "Xx COMBO!" text popup
- ✅ Particle explosions (360° bursts)
- ✅ Particles change color with combo level

### 5+ Combos:
- ✅ Everything above PLUS
- ✅ Radial wave (expanding ring)
- ✅ Rainbow particle colors

---

## Expected Performance

- **FPS**: 60 (stable)
- **No lag** when effects trigger
- **No stuttering** with multiple effects
- **Smooth animations** (tweens)

---

**If all of this works → Perfect! 🎉**

**If something is missing → Check console and settings!**
