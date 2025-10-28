# Visual Effects Testing Guide

Quick guide to test the newly implemented shared effects system for both single-player and FFA multiplayer modes.

---

## Quick Test Commands

### Single-Player Mode
1. Launch the game normally
2. Select single-player mode
3. Play for 2-3 minutes, clearing lines and creating combos

### FFA Multiplayer Mode
1. Open browser console (F12)
2. Run: `window.testMultiplayer(2)`
3. Click "Start Game" when ready
4. Play for 2-3 minutes

---

## What to Look For

### ✅ Piece Lock Ripple
**When**: Every time a piece locks into place
**Expected**:
- Expanding colored circle from piece center
- Smooth animation (400ms duration)
- Circle matches piece color
- Fades out as it expands

**How to Test**:
- Drop a piece naturally
- Use hard drop (Space bar)
- Lock piece with soft drop

---

### ✅ Line Clear Flash
**When**: Lines are cleared
**Expected**:
- White flash on cleared row(s)
- 60% opacity
- Lasts ~100ms
- Particles spawn immediately after

**How to Test**:
- Clear 1 line (Single)
- Clear 2 lines (Double)
- Clear 4 lines (Tetris)

---

### ✅ Line Clear Particles
**When**: Lines are cleared
**Expected**:
- Small white particles fly upward from cleared rows
- Upward angle (-110° to -70°)
- Particles have gravity (fall back down eventually)
- Additive blend mode (glowing effect)
- More particles for combos

**How to Test**:
- Clear single line (18 particles)
- Create 2x combo (more particles, faster)
- Create 5x combo (rainbow colors!)

---

### ✅ Camera Shake
**When**: Lines are cleared
**Expected**:
- Subtle screen shake
- Intensity scales with line count (1-4)
- Duration: 120ms + (40ms per line)
- Won't shake again if recent shake (<60ms ago)

**How to Test**:
- Clear 1 line (subtle shake)
- Clear 4 lines (strong shake)

---

### ✅ Combo Popups
**When**: Clearing lines consecutively (2+ combo)
**Expected**:
- Text appears: "2x COMBO!", "3x COMBO!", etc.
- Center of screen
- Scales from 0.8 to 1.2
- Fades out while moving upward
- 800ms duration

**How to Test**:
1. Clear a line
2. Immediately clear another line (within ~1 second)
3. Continue clearing to build combo

---

### ✅ Combo Explosion Particles
**When**: 2+ combo
**Expected**:
- 360-degree particle burst from screen center
- Multiple bursts for higher combos (cascade effect)
- Burst every 100ms
- Colors match combo level:
  - 2x: Green-cyan (0x00ff88)
  - 3x: Orange (0xffaa00)
  - 4x: Magenta (0xff00ff)
  - 5x+: Rainbow cycle

**How to Test**:
- Create 2x combo (1 burst)
- Create 4x combo (2 bursts)
- Create 6x combo (3 bursts + radial wave)

---

### ✅ Radial Wave (High Combos)
**When**: 5+ combo
**Expected**:
- Perfect circle of particles expanding outward
- 60-80 particles in ring formation
- No gravity (clean expansion)
- Rainbow colors
- Appears 150ms after combo popup

**How to Test**:
- Build a 5x or higher combo
- Watch for expanding particle ring

---

### ✅ Grid Rendering
**When**: Always visible
**Expected**:
- Subtle white grid lines (rgba(255, 255, 255, 0.08))
- 0.5px line width
- Should match single-player grid exactly
- Visible but not distracting

**How to Test**:
- Compare single-player and multiplayer grids side-by-side
- Grid should look identical

---

## FFA Multiplayer Specific Tests

### Main Player (You)
- [ ] All effects appear normally
- [ ] Particles spawn correctly
- [ ] Ripples appear on piece lock
- [ ] Combo popups visible
- [ ] Camera shakes

### Opponent Boards (Other Players)
- [ ] Can see their boards clearly
- [ ] Grids render correctly
- [ ] **Effects may not appear** (this is expected for now)
- [ ] No performance issues

### Performance
- [ ] 60 FPS maintained with 2 players
- [ ] 60 FPS maintained with 4 players
- [ ] No stuttering when multiple effects trigger
- [ ] No memory leaks after 5+ minutes

---

## Expected Behavior Summary

| Effect | Single-Player | FFA Multiplayer (Main Player) |
|--------|--------------|------------------------------|
| Ripple | ✅ Should work | ✅ Should work |
| Flash | ✅ Should work | ✅ Should work |
| Particles | ✅ Should work | ✅ Should work |
| Shake | ✅ Should work | ✅ Should work |
| Combo Popup | ✅ Should work | ✅ Should work |
| Explosions | ✅ Should work | ✅ Should work |
| Radial Wave | ✅ Should work | ✅ Should work |

---

## Known Issues to Check

### 1. Particle Textures Not Loaded
**Symptom**: Console warns "texture not found" and no particles appear
**Fix**: Check that `ensureCircleTexture()` is called in scene's `preload()`

### 2. Ripples Appear Off-Screen
**Symptom**: Ripples don't appear where pieces lock
**Cause**: Hidden rows offset not accounted for
**Check**: Look for ripples appearing at Y position matching piece

### 3. No Combo Events in FFA
**Symptom**: Combos work but no popup appears in multiplayer
**Cause**: `ffa:combo` event not dispatched
**Check**: Look for console errors or missing event listeners

### 4. Camera Doesn't Shake
**Symptom**: No screen movement on line clears
**Cause**: `shakeCamera()` method missing or not wired up
**Check**: Console for warnings about missing shake method

---

## Performance Benchmarks

### Target Performance
- **FPS**: 60 (stable)
- **Frame time**: ~16.67ms
- **Memory**: No leaks over time

### With All Effects Enabled
| Players | Expected FPS | Max Particles | Notes |
|---------|-------------|---------------|-------|
| 1 (Single) | 60 | ~100 | Baseline |
| 2 (FFA) | 60 | ~100 | Main player only |
| 4 (FFA) | 55-60 | ~100 | Main player only |

---

## Quality Settings Test

### Low Quality
- [ ] Particles disabled
- [ ] Shake disabled or minimal
- [ ] Ripples still work (not quality-dependent)
- [ ] Flash still works

### Medium Quality (Default)
- [ ] All effects enabled
- [ ] Normal particle count
- [ ] Normal shake intensity

### High Quality
- [ ] All effects enabled
- [ ] Maximum particle count
- [ ] Maximum shake intensity

---

## Debug Console Commands

### Check if effects are initialized
```javascript
// Single-player
window.game.boardScene.effects

// Multiplayer
window.gameInstance.ffaGameState.multiPlayerLayout.effectsManager.boardScene.effects
```

### Manually trigger effects (for testing)
```javascript
// Get effects reference
const effects = window.game.boardScene.effects;

// Test ripple
effects.createPieceLockRipple({
    x: 5, y: 18,
    color: '#00ffff',
    shape: [[1,1],[1,1]]
});

// Test flash
effects.triggerLineClearFlash([18, 19]);

// Test combo
effects.showComboPopup(5);

// Test shake
effects.playLineClearImpact(4);
```

---

## Reporting Issues

If you find bugs, please include:
1. **Mode**: Single-player or FFA multiplayer
2. **Effect**: Which effect is broken
3. **Expected**: What should happen
4. **Actual**: What actually happened
5. **Console errors**: Any red errors in console (F12)
6. **Steps to reproduce**: How to recreate the bug

---

## Success Criteria

### ✅ Refactoring Successful If:
- [ ] Single-player mode works exactly as before
- [ ] FFA multiplayer now has all effects (was missing most before)
- [ ] No console errors
- [ ] Performance is smooth (60 FPS)
- [ ] Effects look identical between modes

### ⚠️ Issues to Fix If:
- Console shows errors
- Effects don't appear in multiplayer
- Performance drops below 55 FPS
- Effects appear in wrong position
- Particles don't spawn

---

**Quick Start**:
1. Launch game
2. Test single-player for 2 minutes
3. Run `window.testMultiplayer(2)` and test for 2 minutes
4. Report any issues found

**Expected Result**: All effects should work in both modes! 🎉
