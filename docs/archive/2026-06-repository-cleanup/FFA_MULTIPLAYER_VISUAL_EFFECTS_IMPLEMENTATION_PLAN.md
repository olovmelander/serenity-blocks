# FFA Multiplayer Visual Effects Implementation Plan

> **Goal**: Bring all single-player visual effects (ripple, particles, shake, combos) to FFA multiplayer mode, including full particle systems and proper grid rendering.

---

## Current State Analysis

### Single-Player Mode ✅
- **Full Phaser 4 effects pipeline**:
  - Piece lock ripple (expanding colored circles)
  - Line clear flash (white flash on cleared rows)
  - Line clear particles (upward bursts with gravity)
  - Combo popups (text + explosions)
  - Camera shake (intensity scales with line count)
  - Rainbow particles for high combos (5+)
  - Radial wave effects for extreme combos
- **Canvas 2D board rendering**: Grid + pieces + locked blocks
- **Effects triggered by**: Physics callbacks in [src/main.js:2204-2291](src/main.js#L2204-L2291)

### FFA Multiplayer Mode ⚠️
- **Partial effects for main player only**:
  - Basic ripple effect implemented
  - Basic line clear flash implemented
  - **NO particle systems** (missing entirely)
  - **NO combo popups** (placeholder only)
  - **NO camera shake** (placeholder only)
  - **NO effects for opponent boards** (pure Canvas 2D only)
- **Canvas 2D board rendering**: Uses same grid utilities as single-player
- **Effects manager**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)
- **Events dispatched**: `ffa:line-clear`, `ffa:piece-lock` events exist

### Key Differences
| Feature | Single-Player | FFA Multiplayer |
|---------|--------------|-----------------|
| Ripple Effect | ✅ Full (tweens) | ⚠️ Basic (manual animation) |
| Line Clear Flash | ✅ Full | ⚠️ Basic |
| Particles | ✅ Full system | ❌ None |
| Combo Popups | ✅ Full | ❌ None |
| Camera Shake | ✅ Full | ❌ None |
| Opponent Effects | N/A | ❌ None (only main player) |
| Grid Rendering | ✅ Same | ✅ Same (already correct) |

---

## Implementation Phases

---

## Phase 1: Port Particle System to Multiplayer

**Objective**: Bring the full particle system from single-player to the multiplayer effects manager.

### Tasks

#### 1.1: Add Particle Compatibility Layer
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Import particle compatibility utilities:
  ```javascript
  import {
      createParticleEmitter,
      emitParticles,
      destroyParticleEmitter,
      logParticleSystemInfo,
  } from './utils/particle-compat.js';
  import { ensureCircleTexture } from './utils/index.js';
  ```

#### 1.2: Initialize Particle Textures in Scene
**File**: [src/rendering/phaser/multiplayer/board-panel.js](src/rendering/phaser/multiplayer/board-panel.js)

- In scene's `preload()` method:
  ```javascript
  preload() {
      super.preload();
      ensureCircleTexture(this, 'line-clear-particle', 4, 0xffffff, 1);
      logParticleSystemInfo(this);
  }
  ```

#### 1.3: Add Particle State Tracking
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Add to constructor:
  ```javascript
  this.activeParticleSystems = new Set();
  this.lineClearParticleKey = 'line-clear-particle';
  this.lastImpactIntensity = 0;
  this.currentComboCount = 0;
  ```

#### 1.4: Implement `spawnLineClearParticles()` Method
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js) or the scene

- Copy method from [src/rendering/phaser/board-scene.js:257-328](src/rendering/phaser/board-scene.js#L257-L328)
- Adapt for multiplayer scene context
- Key features to include:
  - Upward particle bursts from cleared rows
  - Combo multiplier for intensity
  - ADD blend mode for glow effect
  - Gravity and lifespan based on intensity
  - Quality settings support

**Success Criteria**:
- Line clears produce upward particle bursts
- Particles scale with combo count
- Quality settings respected

---

## Phase 2: Implement Full Ripple and Flash Effects

**Objective**: Upgrade basic ripple and flash to match single-player quality.

### Tasks

#### 2.1: Upgrade Ripple Effect to Use Tweens
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

**Current**: Manual animation loop with `delayedCall`
**Target**: Phaser tweens system (smoother, more performant)

- Replace manual animation in `createPieceLockRipple()` (lines 212-232)
- Copy tween-based approach from [src/rendering/phaser/board-scene.js:169-189](src/rendering/phaser/board-scene.js#L169-L189)
- Key features:
  - `Cubic.easeOut` easing
  - 400ms duration
  - Radius expands to `blockSize * 3`
  - Alpha fades from 0.6 to 0
  - Use piece color for ripple tint

**Code Reference**:
```javascript
this.boardScene.tweens.add({
    targets: rippleData,
    radius: this.blockSize * 3,
    alpha: 0,
    duration: 400,
    ease: 'Cubic.easeOut',
    onUpdate: () => {
        ripple.clear();
        ripple.lineStyle(3, colorInt, rippleData.alpha);
        ripple.strokeCircle(centerX, centerY, rippleData.radius);
    },
    onComplete: () => {
        ripple.destroy();
    },
});
```

#### 2.2: Enhance Line Clear Flash
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Ensure flash appears on correct rows (accounting for `HIDDEN_ROWS`)
- Match opacity and timing from single-player (0.6 alpha, 100ms duration)
- Call `spawnLineClearParticles()` after flash

**Success Criteria**:
- Ripple effects are smooth and match single-player
- Flash appears on correct rows
- Particles spawn immediately after flash

---

## Phase 3: Add Combo Popups and Explosions

**Objective**: Implement combo text popups and particle explosions.

### Tasks

#### 3.1: Implement `showComboPopup()` Method
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Copy from [src/rendering/phaser/board-scene.js:197-234](src/rendering/phaser/board-scene.js#L197-L234)
- Create text object in center of board
- Animate with tweens (scale + fade + move up)
- Store `currentComboCount` for particle effects
- Trigger combo explosions for combos >= 2

**Key Features**:
- Font: `32px Orbitron`
- Text: `${comboCount}x COMBO!`
- Tween duration: 800ms
- Ease: `Cubic.easeOut`

#### 3.2: Implement `spawnComboExplosionParticles()` Method
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Copy from [src/rendering/phaser/board-scene.js:358-431](src/rendering/phaser/board-scene.js#L358-L431)
- 360-degree particle bursts from board center
- Multiple bursts with cascade effect (100ms delay between)
- Rainbow tint colors from `getComboTint()`
- Speed and particle count scale with combo count

#### 3.3: Implement `spawnRadialWave()` Method (5+ Combos)
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Copy from [src/rendering/phaser/board-scene.js:438-490](src/rendering/phaser/board-scene.js#L438-L490)
- Creates expanding ring of particles
- 60-80 particles arranged in perfect circle
- No gravity for clean ring effect
- Rainbow colors

#### 3.4: Implement `getComboTint()` Helper
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Copy from [src/rendering/phaser/board-scene.js:336-351](src/rendering/phaser/board-scene.js#L336-L351)
- Returns particle tint based on combo count:
  - 0-1: Cyan (0x00ffff)
  - 2: Green-cyan (0x00ff88)
  - 3: Orange (0xffaa00)
  - 4: Magenta (0xff00ff)
  - 5+: Rainbow cycle (red, orange, yellow, green, cyan, blue, magenta)

**Success Criteria**:
- Combo popups appear and animate correctly
- Particle explosions trigger for combos >= 2
- Radial waves trigger for combos >= 5
- Rainbow colors cycle properly

---

## Phase 4: Implement Camera Shake

**Objective**: Add camera shake effect for line clears.

### Tasks

#### 4.1: Implement `playLineClearImpact()` Method
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

- Copy from [src/rendering/phaser/board-scene.js:240-250](src/rendering/phaser/board-scene.js#L240-L250)
- Calculate intensity based on line count (1-4 lines)
- Call `shakeCamera()` from base scene
- Store `lastImpactIntensity` for particle effects

**Constants**:
```javascript
const CAMERA_SHAKE_BASE_INTENSITY = 0.0025;
const CAMERA_SHAKE_BASE_DURATION = 120;
```

**Formula**:
```javascript
const intensity = CAMERA_SHAKE_BASE_INTENSITY * clampedLineCount * qualityMultiplier;
const duration = CAMERA_SHAKE_BASE_DURATION + clampedLineCount * 40;
```

#### 4.2: Verify Base Scene Shake Support
**File**: [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js)

- Ensure `shakeCamera()` method exists ([base-board-scene.js:212-225](src/rendering/phaser/base-board-scene.js#L212-L225))
- Verify anti-overlap protection (won't shake if recent shake < 60ms ago)
- Ensure quality settings integration

**Success Criteria**:
- Camera shakes on line clears
- Intensity scales with line count (1-4)
- Shake respects quality settings
- No overlapping shakes

---

## Phase 5: Wire Up Events and Test Integration

**Objective**: Connect all effects to game events and ensure they trigger correctly.

### Tasks

#### 5.1: Update Event Listener Setup
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

**Current listeners** (lines 794-850):
- `ffa:line-clear` → triggers flash only
- `ffa:piece-lock` → triggers ripple only

**Required updates**:
```javascript
// Line clear handler (lines 795-821)
this._lineClearHandler = (event) => {
    if (event.detail.isLocal && event.detail.linesCleared > 0) {
        const rows = event.detail.clearedRows || estimatedRows;

        // 1. Flash effect
        this.effectsManager.triggerLineClearFlash(rows);

        // 2. Camera shake + particle impact
        this.effectsManager.playLineClearImpact(event.detail.linesCleared);

        // 3. Particles spawn (automatically called by flash)
    }
};
```

#### 5.2: Add Combo Event Listener
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

**New listener** (add around line 844):
```javascript
// Combo popup handler
this._comboHandler = (event) => {
    if (event.detail.isLocal && event.detail.comboCount > 1) {
        this.effectsManager.showComboPopup(event.detail.comboCount);
    }
};

window.addEventListener('ffa:combo', this._comboHandler);
```

#### 5.3: Ensure Game State Emits Combo Events
**File**: [src/core/multiplayer/ffa-p2p-game-state.js](src/core/multiplayer/ffa-p2p-game-state.js)

**Verify combo event is dispatched**:
```javascript
// In physics processing after line clear
if (comboCount > 1) {
    window.dispatchEvent(new CustomEvent('ffa:combo', {
        detail: {
            steamId: this.localPlayerId,
            isLocal: true,
            comboCount: comboCount
        }
    }));
}
```

#### 5.4: Update Cleanup in `removeEffectEventListeners()`
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

**Add combo cleanup** (lines 856-865):
```javascript
removeEffectEventListeners() {
    if (this._lineClearHandler) {
        window.removeEventListener('ffa:line-clear', this._lineClearHandler);
        this._lineClearHandler = null;
    }
    if (this._pieceLockHandler) {
        window.removeEventListener('ffa:piece-lock', this._pieceLockHandler);
        this._pieceLockHandler = null;
    }
    // NEW: Combo cleanup
    if (this._comboHandler) {
        window.removeEventListener('ffa:combo', this._comboHandler);
        this._comboHandler = null;
    }
}
```

**Success Criteria**:
- All effects trigger on correct game events
- No duplicate or missing effects
- Cleanup prevents memory leaks

---

## Phase 6: Quality Settings and Performance

**Objective**: Ensure effects respect quality settings and perform well.

### Tasks

#### 6.1: Integrate Quality Settings
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

**Add quality config getter**:
```javascript
getQualityConfig() {
    if (this.boardScene && this.boardScene.getQualityConfig) {
        return this.boardScene.getQualityConfig();
    }
    // Fallback to medium quality
    return {
        particles: true,
        shakeMultiplier: 1.0,
        particleCount: 1.0
    };
}
```

**Update particle spawning**:
- Check `getQualityConfig().particles` before creating particles
- Scale particle counts by `getQualityConfig().particleCount`
- Scale shake intensity by `getQualityConfig().shakeMultiplier`

#### 6.2: Add Particle Cleanup
**File**: [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js)

**Track active systems**:
```javascript
this.activeParticleSystems.add(emitter);

// Cleanup after lifespan
this.time.delayedCall(lifespan, () => {
    destroyParticleEmitter(emitter);
    this.activeParticleSystems.delete(emitter);
});
```

**Cleanup on destroy**:
```javascript
destroy() {
    this.activeParticleSystems?.forEach(system => {
        destroyParticleEmitter(system);
    });
    this.activeParticleSystems?.clear();

    // ... existing cleanup
}
```

**Success Criteria**:
- Quality settings properly toggle particles on/off
- Particle count scales with quality level
- No memory leaks from particle systems
- Performance remains smooth (60 FPS target)

---

## Phase 7: Grid Rendering Verification

**Objective**: Ensure main canvas grid matches single-player appearance.

### Tasks

#### 7.1: Verify Grid Drawing Consistency
**Files**:
- [src/ui/multi-player-canvas-layout.js:1012](src/ui/multi-player-canvas-layout.js#L1012)
- [src/rendering/canvas/canvas-drawing-utils.js:37-61](src/rendering/canvas/canvas-drawing-utils.js#L37-L61)

**Current implementation**:
```javascript
// In renderPlayerCanvas() at line 1012
drawGrid(ctx, canvas.width, canvas.height, blockSize);
```

**Grid specs** (from canvas-drawing-utils.js):
- Color: `rgba(255, 255, 255, 0.08)` (subtle white)
- Line width: 0.5px
- Single-path rendering for performance
- Vertical lines + horizontal lines

**Verification steps**:
1. Test `window.testMultiplayer(2)`
2. Compare main canvas grid to single-player grid
3. Check grid opacity, line thickness, and color
4. Verify grid doesn't interfere with particle effects

**Expected result**: Grid should already be correct (uses same utilities), but verify visually.

**Success Criteria**:
- Main canvas grid matches single-player grid exactly
- Grid is visible but subtle
- Grid does not flicker or disappear during effects

---

## Phase 8: Opponent Board Effects (Optional Enhancement)

**Objective**: Add basic effects to opponent boards (not required, but nice-to-have).

### Tasks

#### 8.1: Create Lightweight Effects for Opponents
**File**: [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js)

**Approach**: Use Canvas 2D for simple effects (avoid Phaser overhead for 3+ opponents)

**Simple Canvas Effects**:
- **Ripple**: Draw expanding circle on canvas (manual animation)
- **Flash**: Overlay div with fade-out transition
- **No particles**: Too performance-intensive for multiple boards

**Implementation**:
```javascript
// In setupEffectEventListeners()
window.addEventListener('ffa:piece-lock', (event) => {
    if (!event.detail.isLocal) {
        // Opponent piece lock
        this.drawSimpleRipple(event.detail.steamId, event.detail.piece);
    }
});

window.addEventListener('ffa:line-clear', (event) => {
    if (!event.detail.isLocal) {
        // Opponent line clear
        this.drawSimpleFlash(event.detail.steamId, event.detail.linesCleared);
    }
});
```

**Simple ripple (Canvas 2D)**:
```javascript
drawSimpleRipple(steamId, piece) {
    const canvasInfo = this.canvases.get(steamId);
    if (!canvasInfo) return;

    const { ctx, blockSize } = canvasInfo;
    const centerX = (piece.x + 1) * blockSize;
    const centerY = (piece.y + 1 - HIDDEN_ROWS) * blockSize;
    const maxRadius = blockSize * 2;

    let radius = 0;
    const animate = () => {
        if (radius > maxRadius) return;

        ctx.strokeStyle = piece.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - (radius / maxRadius);
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        radius += maxRadius / 20; // 20 frames
        requestAnimationFrame(animate);
    };

    animate();
}
```

**Note**: This phase is **optional** and can be skipped if performance is a concern.

**Success Criteria**:
- Opponent boards show basic ripple and flash
- No performance degradation with 4+ players
- Effects don't interfere with board rendering

---

## Testing Plan

### Test Cases

#### Test 1: Single Line Clear
**Steps**:
1. Run `window.testMultiplayer(2)`
2. Start game
3. Clear a single line

**Expected**:
- White flash on cleared row
- Upward particle burst (cyan color)
- Subtle camera shake
- Ripple on piece lock before line clear

#### Test 2: Double Line Clear (Combo)
**Steps**:
1. Clear 2 lines consecutively (create combo)

**Expected**:
- Flash + particles for both clears
- "2x COMBO!" popup in center
- Green-cyan particles
- Combo explosion particles (360-degree burst)
- Stronger camera shake

#### Test 3: Tetris (4 Lines)
**Steps**:
1. Clear 4 lines at once

**Expected**:
- Intense flash
- Magenta/purple particles
- Strong camera shake (160ms duration)
- High particle count

#### Test 4: High Combo (5+ Lines)
**Steps**:
1. Clear 5+ lines in succession

**Expected**:
- "5x COMBO!" popup
- Rainbow particle colors
- Combo explosions + radial wave effect
- Multiple burst waves cascading

#### Test 5: Quality Settings
**Steps**:
1. Set quality to Low
2. Clear lines

**Expected**:
- Particles disabled
- Shake reduced or disabled
- Ripple still works (not quality-dependent)

#### Test 6: Grid Rendering
**Steps**:
1. Compare single-player and multiplayer grids side-by-side

**Expected**:
- Identical grid appearance
- Same color, opacity, line thickness
- Grid visible under effects

#### Test 7: Multiple Players
**Steps**:
1. Run `window.testMultiplayer(4)`
2. Play for 1 minute

**Expected**:
- All effects work for main player
- No performance issues
- 60 FPS maintained
- No memory leaks

---

## Success Metrics

### Visual Parity
- [ ] Ripple effects match single-player (smoothness, color, size)
- [ ] Line clear flash matches single-player (timing, opacity)
- [ ] Particles spawn correctly (direction, speed, gravity, color)
- [ ] Combo popups animate smoothly (scale, fade, position)
- [ ] Camera shake feels impactful but not disorienting
- [ ] Grid rendering identical between modes

### Performance
- [ ] 60 FPS maintained with effects enabled (4 players)
- [ ] No noticeable lag when multiple effects trigger simultaneously
- [ ] Quality settings properly reduce load on low-end systems
- [ ] No memory leaks after extended play (30+ minutes)

### Integration
- [ ] All effects trigger on correct game events
- [ ] Event listeners properly cleaned up on mode exit
- [ ] No console errors or warnings
- [ ] Effects sync correctly with game state

---

## File Reference Summary

### Files to Modify

| File | Lines | Changes |
|------|-------|---------|
| [src/rendering/phaser/multiplayer-effects-manager.js](src/rendering/phaser/multiplayer-effects-manager.js) | Multiple | Add all particle methods, combo popups, shake |
| [src/rendering/phaser/multiplayer/board-panel.js](src/rendering/phaser/multiplayer/board-panel.js) | `preload()` | Add particle texture initialization |
| [src/ui/multi-player-canvas-layout.js](src/ui/multi-player-canvas-layout.js) | 794-865 | Update event listeners, add combo handler |
| [src/core/multiplayer/ffa-p2p-game-state.js](src/core/multiplayer/ffa-p2p-game-state.js) | Physics | Ensure combo events dispatched |

### Files to Reference (Copy From)

| File | Lines | What to Copy |
|------|-------|--------------|
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 145-191 | Ripple effect (tweens) |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 119-139 | Line clear flash |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 257-328 | Line clear particles |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 197-234 | Combo popups |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 358-431 | Combo explosions |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 438-490 | Radial wave |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 336-351 | Combo tint helper |
| [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js) | 240-250 | Line clear impact/shake |

### Utility Files (Already Available)

| File | Purpose |
|------|---------|
| [src/rendering/phaser/utils/particle-compat.js](src/rendering/phaser/utils/particle-compat.js) | Phaser 4 particle compatibility layer |
| [src/rendering/phaser/utils/index.js](src/rendering/phaser/utils/index.js) | Texture utilities (`ensureCircleTexture`) |
| [src/rendering/canvas/canvas-drawing-utils.js](src/rendering/canvas/canvas-drawing-utils.js) | Canvas grid/piece drawing (already used) |
| [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js) | Base scene with `shakeCamera()` method |

---

## Implementation Order Recommendation

1. **Phase 1** (Particles) - Foundation for all other effects
2. **Phase 2** (Ripple/Flash) - Upgrade existing basic effects
3. **Phase 4** (Camera Shake) - Quick win, big impact
4. **Phase 3** (Combos) - Most complex, build on particles
5. **Phase 5** (Events) - Wire everything together
6. **Phase 6** (Quality) - Polish and optimization
7. **Phase 7** (Grid) - Verification only (likely already correct)
8. **Phase 8** (Opponents) - Optional, if time permits

---

## Estimated Effort

| Phase | Complexity | Time Estimate |
|-------|-----------|---------------|
| Phase 1: Particles | High | 3-4 hours |
| Phase 2: Ripple/Flash | Low | 1 hour |
| Phase 3: Combos | Medium | 2-3 hours |
| Phase 4: Shake | Low | 30 minutes |
| Phase 5: Events | Low | 1 hour |
| Phase 6: Quality | Medium | 1-2 hours |
| Phase 7: Grid | Low | 30 minutes |
| Phase 8: Opponents | Medium | 2-3 hours (optional) |
| **Total (required)** | - | **9-12 hours** |
| **Total (with optional)** | - | **11-15 hours** |

---

## Known Challenges

### Challenge 1: Particle System Compatibility
**Issue**: Phaser 4 particle API differs from Phaser 3
**Solution**: Use existing `particle-compat.js` compatibility layer
**Mitigation**: Test particles thoroughly on different browsers

### Challenge 2: Performance with Multiple Players
**Issue**: 4+ players with full effects may strain performance
**Solution**: Quality settings + efficient particle cleanup
**Mitigation**: Monitor FPS, add telemetry if needed

### Challenge 3: Event Timing and Sync
**Issue**: Effects must sync with game state changes
**Solution**: Use existing event system (`ffa:*` events)
**Mitigation**: Add debug logging during development

### Challenge 4: Combo Event Availability
**Issue**: `ffa:combo` event may not exist yet
**Solution**: Add event dispatch in physics processing
**Mitigation**: Check event is dispatched before wiring up listener

---

## Rollback Plan

If any phase fails or causes issues:

1. **Disable specific effect**: Add feature flag to toggle effect on/off
2. **Revert to basic effects**: Keep basic ripple/flash, skip particles
3. **Quality override**: Force low quality to disable problematic effects
4. **Main player only**: Skip Phase 8 (opponent effects)

**Feature flags** (add to settings or constants):
```javascript
const MULTIPLAYER_EFFECTS_CONFIG = {
    particles: true,
    combos: true,
    shake: true,
    opponentEffects: false, // Phase 8 disabled by default
};
```

---

## Future Enhancements (Post-Implementation)

- **Opponent particle effects**: Full Phaser instances for each opponent
- **Custom particle shapes**: Tetromino-shaped particles instead of circles
- **Sound-reactive effects**: Particles pulse with music/SFX
- **Configurable effect themes**: Different particle colors per player
- **Screen shake customization**: Let players adjust shake intensity
- **Effect presets**: "Minimal", "Standard", "Extreme" effect packs

---

## Conclusion

This plan provides a clear, phased approach to bringing all single-player visual effects to FFA multiplayer mode. By following the phases in order and using the existing single-player implementation as a reference, we can achieve full visual parity between modes.

**Next Steps**:
1. Review this plan with the team
2. Set up a feature branch for implementation
3. Start with Phase 1 (Particles) as the foundation
4. Test each phase before moving to the next
5. Gather user feedback after Phase 5 (core effects complete)

**Questions Before Starting**:
- Are there any performance constraints we should know about?
- Should we prioritize certain effects over others?
- Do we want opponent effects (Phase 8) in the first iteration?
- What quality settings should be the default for multiplayer?

---

**Document Version**: 1.0
**Last Updated**: 2025-10-19
**Author**: Claude Code
**Status**: Ready for Implementation
