# FFA Visual Effects Enhancement Plan

## Executive Summary

The FFA multiplayer mode (tested with `window.testMultiplayer(5)`) currently lacks the visual polish and smooth effects present in single-player mode. While gameplay is functional, the visual feedback for line clears, combo chains, and piece locking doesn't match the satisfying feel of single-player.

This document outlines a comprehensive plan to bring the same level of visual effects, animations, and feedback to FFA multiplayer mode.

---

## Problem Statement

### Current State
- **Single-player**: Smooth effects, satisfying animations, great visual feedback
- **FFA Multiplayer (5 players)**: Effects are missing, muted, or inconsistent
  - Line clear effects not as prominent
  - Piece lock feedback less satisfying
  - Combo visuals not as impactful
  - Particle effects may be reduced/missing
  - Overall feels less polished

### Visual Effects Gap
| Effect Type | Single-Player | FFA Multiplayer | Status |
|-------------|---------------|-----------------|--------|
| Line Clear Flash | ✅ Smooth, bright | ⚠️ Missing/weak | Needs Fix |
| Piece Lock Ripple | ✅ Satisfying | ⚠️ Missing/weak | Needs Fix |
| Combo Popup | ✅ Impactful | ⚠️ Missing/weak | Needs Fix |
| Particles (trail) | ✅ Fluid | ⚠️ Reduced/off | Needs Fix |
| Camera Shake | ✅ Responsive | ⚠️ Missing/weak | Needs Fix |
| Background Pulse | ✅ Dynamic | ⚠️ Missing/weak | Needs Fix |

---

## Investigation Phase

### 1. Identify Current Effects System

**Files to Investigate**:
- [`src/rendering/phaser/board-scene.js`](src/rendering/phaser/board-scene.js) - Single-player effects
- [`src/rendering/phaser/multiplayer/board-panel.js`](src/rendering/phaser/multiplayer/board-panel.js) - Multiplayer board
- [`src/rendering/phaser/shared-effects.js`](src/rendering/phaser/shared-effects.js) - Shared effects manager
- [`src/rendering/phaser/multiplayer-effects-manager.js`](src/rendering/phaser/multiplayer-effects-manager.js) - FFA effects
- [`src/rendering/draw.js`](src/rendering/draw.js) - Drawing utilities

**Questions to Answer**:
1. What effects exist in single-player?
2. Which effects are missing in multiplayer?
3. Are effects disabled intentionally (performance)?
4. Are effect callbacks not being called?
5. Is there a quality setting reducing effects?

### 2. Effect Inventory

**Single-Player Effects** (to replicate):

#### Line Clear Effects
```javascript
// Flashing cleared lines
triggerLineClearFlash(rows, scene, color)
- Flash animation on cleared rows
- Color transitions
- Fade out effect
```

#### Piece Lock Effects
```javascript
// Ripple when piece locks
createPieceLockRipple(piece, scene)
- Expanding circle ripple
- Color based on piece
- Camera shake on lock
```

#### Combo Effects
```javascript
// Combo popup and celebration
showComboPopup(comboCount, scene)
- Large combo text
- Particle burst
- Screen shake intensity scales with combo
```

#### Particle Effects
```javascript
// Piece movement trail
addPieceTrail(piece, scene)
- Particle trail following piece
- Fade out over time
- Color matches piece
```

#### Background Effects
```javascript
// Background pulse on events
triggerBackgroundPulse(intensity, scene)
- Background color flash
- Scales with event intensity
- Smooth fade
```

---

## Root Cause Analysis

### Hypothesis 1: Effects Not Integrated
**Symptom**: No effects visible at all
**Cause**: Multiplayer board scenes don't call effect functions
**Test**: Check if effect methods exist on multiplayer scenes
**Fix**: Integrate effects manager into multiplayer boards

### Hypothesis 2: Effect Quality Reduced
**Symptom**: Effects visible but weak
**Cause**: Quality settings auto-reduce for multiplayer
**Test**: Check `effectQuality` setting in multiplayer
**Fix**: Maintain quality or make it configurable

### Hypothesis 3: Callback Not Wired
**Symptom**: Effects trigger but don't render
**Cause**: Physics callbacks missing effect triggers
**Test**: Add console logs to effect callbacks
**Fix**: Wire up physics callbacks properly

### Hypothesis 4: Viewport Isolation
**Symptom**: Effects render but not visible
**Cause**: Effects render outside viewport bounds
**Test**: Check camera bounds and viewport
**Fix**: Ensure effects render within multiplayer viewport

### Hypothesis 5: Performance Throttling
**Symptom**: Effects intermittent or skipped
**Cause**: Throttling disables effects for opponent boards
**Test**: Check if effects work on focused board only
**Fix**: Keep effects on all boards, optimize differently

---

## Enhancement Plan

### Phase 1: Effects Audit & Integration (2-3 hours)

#### Step 1: Audit Current State
**Goal**: Understand what's missing

**Tasks**:
1. Document all effects in single-player
2. Test each effect in FFA mode
3. Create checklist of missing effects
4. Identify why each is missing

**Deliverable**: Effects comparison table

#### Step 2: Integrate SharedEffects
**Goal**: Ensure all boards have effects manager

**Current Architecture** (likely):
```javascript
// Single-player board
class BoardScene {
  create() {
    this.effects = new SharedEffects(this);
  }
}

// Multiplayer board
class MultiplayerBoardScene {
  create() {
    // May be missing: this.effects = new SharedEffects(this);
  }
}
```

**Fix**:
```javascript
// Ensure multiplayer boards have effects
class MultiplayerBoardScene extends BaseBoardScene {
  create() {
    super.create();

    // Initialize effects if missing
    if (!this.effects) {
      this.effects = new SharedEffects(this);
      console.log('[MultiplayerBoard] Effects initialized');
    }
  }
}
```

#### Step 3: Wire Up Effect Callbacks
**Goal**: Connect physics events to visual effects

**Callbacks to Wire**:
```javascript
// In multiplayer physics callbacks
const physicsCallbacks = {
  onPieceLock: (piece) => {
    // Add visual feedback
    scene.effects?.createPieceLockRipple(piece);
    scene.effects?.shakeCamera(1.0);
  },

  onLineClear: (rows, color) => {
    // Add line clear flash
    scene.effects?.triggerLineClearFlash(rows, color);
  },

  onCombo: (comboCount, depth) => {
    // Show combo popup
    scene.effects?.showComboPopup(comboCount);
    // Scale shake with combo size
    scene.effects?.shakeCamera(comboCount * 0.5);
  },

  onGarbageSend: (lines) => {
    // Visual feedback for attack
    scene.effects?.triggerBackgroundPulse(lines * 0.2);
  },
};
```

---

### Phase 2: Effect System Enhancements (3-4 hours)

#### Enhancement 1: Per-Board Effect Management
**Goal**: Each board has independent effects

**Implementation**:
```javascript
class MultiplayerEffectsManager {
  constructor(boardScenes) {
    this.boards = boardScenes;
    this.effectsPerBoard = new Map();

    // Initialize effects for each board
    boardScenes.forEach((scene, index) => {
      this.effectsPerBoard.set(index, {
        scene: scene,
        effects: new SharedEffects(scene),
        particleSystems: new Set(),
      });
    });
  }

  // Trigger effect on specific board
  triggerEffect(boardIndex, effectName, ...args) {
    const board = this.effectsPerBoard.get(boardIndex);
    if (board && board.effects[effectName]) {
      board.effects[effectName](...args);
    }
  }

  // Trigger effect on all boards (for game-wide events)
  triggerGlobalEffect(effectName, ...args) {
    this.effectsPerBoard.forEach(board => {
      if (board.effects[effectName]) {
        board.effects[effectName](...args);
      }
    });
  }
}
```

#### Enhancement 2: Optimized Particle System
**Goal**: Particles work smoothly in multiplayer

**Optimization Strategy**:
- Use object pooling (from Phase 3)
- Limit max particles per board
- Cull particles outside viewport
- Reduce particle count for opponent boards

**Implementation**:
```javascript
import { particlePool } from '../utils/object-pool.js';

class OptimizedParticleSystem {
  constructor(scene, maxParticles = 100) {
    this.scene = scene;
    this.maxParticles = maxParticles;
    this.particles = [];
    this.isFocused = true; // Active player board
  }

  emit(x, y, config) {
    // Reduce particles for unfocused boards
    const count = this.isFocused ? config.count : Math.ceil(config.count / 2);

    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const particle = particlePool.acquire();
      particle.x = x;
      particle.y = y;
      particle.vx = (Math.random() - 0.5) * config.speed;
      particle.vy = (Math.random() - 0.5) * config.speed;
      particle.life = config.life;
      particle.maxLife = config.life;
      particle.color = config.color;
      particle.size = config.size;

      this.particles.push(particle);
    }
  }

  update(delta) {
    // Update and cull particles
    this.particles = this.particles.filter(p => {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.alpha = p.life / p.maxLife;

      if (p.life <= 0) {
        particlePool.release(p); // Return to pool
        return false;
      }
      return true;
    });
  }

  render(graphics) {
    this.particles.forEach(p => {
      graphics.fillStyle(p.color, p.alpha);
      graphics.fillCircle(p.x, p.y, p.size);
    });
  }
}
```

#### Enhancement 3: Viewport-Aware Effects
**Goal**: Effects render correctly within each board's viewport

**Implementation**:
```javascript
class ViewportAwareEffect {
  constructor(scene, viewport) {
    this.scene = scene;
    this.viewport = viewport; // {x, y, width, height}
  }

  // Convert world position to viewport position
  toViewportCoords(worldX, worldY) {
    return {
      x: worldX - this.viewport.x,
      y: worldY - this.viewport.y,
    };
  }

  // Check if effect is visible in viewport
  isInViewport(x, y, margin = 50) {
    return (
      x >= this.viewport.x - margin &&
      x <= this.viewport.x + this.viewport.width + margin &&
      y >= this.viewport.y - margin &&
      y <= this.viewport.y + this.viewport.height + margin
    );
  }

  // Create effect only if in viewport
  createEffect(x, y, effectFn) {
    if (this.isInViewport(x, y)) {
      const coords = this.toViewportCoords(x, y);
      effectFn(coords.x, coords.y);
    }
  }
}
```

---

### Phase 3: Visual Polish & Quality (2-3 hours)

#### Polish 1: Combo System Enhancement
**Goal**: Combos feel as satisfying as single-player

**Features**:
- Larger combo text
- More particles
- Stronger camera shake
- Color-coded by combo size
- Sound effects scale

**Implementation**:
```javascript
class ComboVisualizer {
  showCombo(comboCount, scene, viewport) {
    // Scale visual intensity with combo
    const intensity = Math.min(comboCount / 10, 1.0);

    // Combo text
    const text = scene.add.text(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
      `${comboCount}x COMBO!`,
      {
        fontSize: `${20 + comboCount * 2}px`,
        color: this.getComboColor(comboCount),
        fontStyle: 'bold',
      }
    );

    // Animate text
    scene.tweens.add({
      targets: text,
      scale: { from: 0.5, to: 1.5 },
      alpha: { from: 1, to: 0 },
      y: text.y - 50,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => text.destroy(),
    });

    // Particle burst
    this.createParticleBurst(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
      comboCount * 5,
      this.getComboColor(comboCount)
    );

    // Camera shake (scales with combo)
    scene.cameras.main.shake(200, 0.002 * intensity);
  }

  getComboColor(combo) {
    if (combo >= 10) return '#ff00ff'; // Magenta for huge combos
    if (combo >= 7) return '#ff0000';  // Red for big combos
    if (combo >= 5) return '#ffaa00';  // Orange
    if (combo >= 3) return '#ffff00';  // Yellow
    return '#ffffff'; // White for small combos
  }
}
```

#### Polish 2: Line Clear Animations
**Goal**: Line clears feel impactful

**Features**:
- Flash animation
- Row highlight
- Particle explosion
- Sound feedback
- Fade out

**Implementation**:
```javascript
class LineClearEffect {
  trigger(rows, scene, viewport) {
    rows.forEach((rowIndex, delay) => {
      setTimeout(() => {
        this.flashRow(rowIndex, scene, viewport);
        this.explodeRow(rowIndex, scene, viewport);
      }, delay * 50); // Cascade effect
    });
  }

  flashRow(rowIndex, scene, viewport) {
    const y = viewport.y + (rowIndex * blockSize);

    // Create flash rectangle
    const flash = scene.add.rectangle(
      viewport.x,
      y,
      viewport.width,
      blockSize,
      0xffffff,
      0.8
    );

    // Fade out
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => flash.destroy(),
    });
  }

  explodeRow(rowIndex, scene, viewport) {
    const y = viewport.y + (rowIndex * blockSize);
    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
      const x = viewport.x + (Math.random() * viewport.width);
      this.createParticle(x, y, scene);
    }
  }
}
```

#### Polish 3: Piece Lock Feedback
**Goal**: Locking pieces feels satisfying

**Features**:
- Ripple effect from lock point
- Camera shake
- Lock sound
- Subtle screen flash
- Particle puff

**Implementation**:
```javascript
class PieceLockEffect {
  trigger(piece, scene, viewport) {
    const centerX = viewport.x + (piece.x + piece.shape[0].length / 2) * blockSize;
    const centerY = viewport.y + (piece.y + piece.shape.length / 2) * blockSize;

    // Ripple effect
    this.createRipple(centerX, centerY, scene);

    // Camera shake
    scene.cameras.main.shake(150, 0.002);

    // Particle puff
    this.createPuff(centerX, centerY, scene, piece.color);

    // Subtle flash
    this.flash(scene, viewport);
  }

  createRipple(x, y, scene) {
    const ripple = scene.add.circle(x, y, 5, 0xffffff, 0.5);

    scene.tweens.add({
      targets: ripple,
      radius: 50,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => ripple.destroy(),
    });
  }

  createPuff(x, y, scene, color) {
    const particleCount = 10;
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const speed = 2;

      const particle = particlePool.acquire();
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.life = 500;
      particle.maxLife = 500;
      particle.color = color;
      particle.size = 3;

      particles.push(particle);
    }

    return particles;
  }
}
```

---

### Phase 4: Quality Settings & Optimization (1-2 hours)

#### Quality Levels
**Goal**: Configurable effect quality for performance

**Levels**:
```javascript
const EFFECT_QUALITY = {
  LOW: {
    particles: false,
    particleCount: 0,
    cameraShake: false,
    flashEffects: true,  // Keep flashes, they're cheap
    comboText: true,     // Keep text
    maxParticlesPerBoard: 0,
  },
  MEDIUM: {
    particles: true,
    particleCount: 0.5,  // 50% of normal
    cameraShake: true,
    flashEffects: true,
    comboText: true,
    maxParticlesPerBoard: 50,
  },
  HIGH: {
    particles: true,
    particleCount: 1.0,  // 100%
    cameraShake: true,
    flashEffects: true,
    comboText: true,
    maxParticlesPerBoard: 100,
  },
};
```

#### Auto-Quality Adjustment
**Goal**: Auto-reduce quality if FPS drops

**Implementation**:
```javascript
class AdaptiveQuality {
  constructor(performanceMonitor) {
    this.monitor = performanceMonitor;
    this.currentQuality = 'HIGH';
    this.checkInterval = 5000; // Check every 5 seconds
    this.lastCheck = 0;
  }

  update(time) {
    if (time - this.lastCheck < this.checkInterval) return;
    this.lastCheck = time;

    const metrics = this.monitor.getMetrics();

    // Reduce quality if FPS is low
    if (metrics.avgFPS < 50 && this.currentQuality === 'HIGH') {
      this.setQuality('MEDIUM');
      console.log('[AdaptiveQuality] Reduced to MEDIUM (FPS: ' + metrics.avgFPS + ')');
    } else if (metrics.avgFPS < 40 && this.currentQuality === 'MEDIUM') {
      this.setQuality('LOW');
      console.log('[AdaptiveQuality] Reduced to LOW (FPS: ' + metrics.avgFPS + ')');
    }
    // Increase quality if FPS is good
    else if (metrics.avgFPS > 57 && this.currentQuality === 'MEDIUM') {
      this.setQuality('HIGH');
      console.log('[AdaptiveQuality] Increased to HIGH (FPS: ' + metrics.avgFPS + ')');
    } else if (metrics.avgFPS > 55 && this.currentQuality === 'LOW') {
      this.setQuality('MEDIUM');
      console.log('[AdaptiveQuality] Increased to MEDIUM (FPS: ' + metrics.avgFPS + ')');
    }
  }

  setQuality(level) {
    this.currentQuality = level;
    // Apply quality settings to all effect systems
    this.applyQualitySettings(EFFECT_QUALITY[level]);
  }
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (2-3 hours)
**Goal**: Get basic effects working in FFA

1. ✅ Audit current effects in single-player
2. ✅ Audit current effects in FFA
3. ✅ Identify missing integrations
4. ✅ Wire up SharedEffects to multiplayer boards
5. ✅ Connect physics callbacks to effects
6. ✅ Test each effect type

**Success Criteria**:
- Line clear flashes visible
- Piece lock ripples working
- Combo popups appear
- Basic particles render

### Phase 2: Enhancement (3-4 hours)
**Goal**: Match single-player quality

1. ✅ Implement per-board effect management
2. ✅ Optimize particle system with pooling
3. ✅ Add viewport-aware rendering
4. ✅ Scale effects properly within viewports
5. ✅ Test with 5 players

**Success Criteria**:
- Effects isolated per board
- No viewport bleeding
- Particles perform well
- Effects scale correctly

### Phase 3: Polish (2-3 hours)
**Goal**: Exceed single-player feel

1. ✅ Enhance combo visualizations
2. ✅ Improve line clear animations
3. ✅ Polish piece lock feedback
4. ✅ Add particle variety
5. ✅ Fine-tune timing and intensity

**Success Criteria**:
- Combos feel amazing
- Line clears are satisfying
- Lock feedback is tactile
- Particles are fluid

**Implementation Notes (Nov 2025 update)**
- Canvas opponents now mirror single-player cascade timing with delayed row flashes, particle sprays, and combo badges per board.
- Main Phaser board gained per-row additive flashes to better sync with cascade gravity beats.
- Combo energy feeds both local and remote particle counts so long chains feel progressively heavier without overwhelming performance.

### Phase 4: Optimization (1-2 hours)
**Goal**: Maintain performance

1. ✅ Implement quality settings
2. ✅ Add adaptive quality
3. ✅ Profile effect overhead
4. ✅ Optimize hot paths
5. ✅ Test with 8 players

**Success Criteria**:
- 58+ FPS maintained
- Quality auto-adjusts
- Effects don't cause lag
- Smooth gameplay

---

## Testing Strategy

### Test 1: Visual Parity
**Goal**: Compare single-player vs FFA effects

**Procedure**:
1. Play single-player, do 4-line clear with combo
2. Note all visual effects that occur
3. Play FFA mode, do same 4-line clear with combo
4. Compare effects side-by-side
5. Document any differences

**Pass Criteria**: Effects are identical or better in FFA

### Test 2: Performance Impact
**Goal**: Ensure effects don't hurt FPS

**Procedure**:
```javascript
// Before effects enhancement
window.perfMonitor.reset();
window.perfMonitor.start();
window.testMultiplayer(5);
// Play for 2 minutes with combos
const beforeMetrics = window.perfMonitor.report();

// After effects enhancement
window.perfMonitor.reset();
window.perfMonitor.start();
window.testMultiplayer(5);
// Play for 2 minutes with combos
const afterMetrics = window.perfMonitor.report();

// Compare
console.log('FPS change:', afterMetrics.fps.average - beforeMetrics.fps.average);
// Target: < 3 FPS drop
```

**Pass Criteria**: FPS drop < 3

### Test 3: Multi-Board Effects
**Goal**: Effects work on all 5 boards

**Procedure**:
1. Start 5-player FFA
2. Trigger line clear on board 1 → effects visible ✅
3. Trigger line clear on board 2 → effects visible ✅
4. Trigger line clear on board 3 → effects visible ✅
5. Trigger line clear on board 4 → effects visible ✅
6. Trigger line clear on board 5 → effects visible ✅

**Pass Criteria**: All boards show effects

### Test 4: Combo Satisfaction
**Goal**: Big combos feel amazing

**Procedure**:
1. Set up 10x combo scenario
2. Trigger combo
3. Rate satisfaction 1-10

**Pass Criteria**:
- Visible combo text ✅
- Screen shake ✅
- Particles burst ✅
- Sound feedback ✅
- Overall feel: 8+/10

---

## Success Criteria

### Must Have ✅
- [ ] Line clear flashes visible on all boards
- [ ] Piece lock ripples on all boards
- [ ] Combo popups with proper text
- [ ] Camera shake on major events
- [ ] Particle effects enabled
- [ ] FPS remains 55+ with effects

### Should Have 🎯
- [ ] Viewport-aware effects (no bleeding)
- [ ] Object pooling for particles
- [ ] Quality settings (LOW/MEDIUM/HIGH)
- [ ] Adaptive quality adjustment
- [ ] Effect intensity scales with event size
- [ ] Smooth animations (no stuttering)

### Nice to Have ⭐
- [ ] Color-coded combo levels
- [ ] Cascade animations
- [ ] Background pulse effects
- [ ] Particle variety (shapes, colors)
- [ ] Custom effects per board
- [ ] Effect history/replay

---

## Files to Create/Modify

### New Files
1. **`src/rendering/phaser/multiplayer-effects-enhanced.js`**
   - Enhanced effects manager for FFA
   - Per-board effect coordination
   - Viewport-aware rendering

2. **`src/rendering/effects/combo-visualizer.js`**
   - Dedicated combo effect system
   - Scales with combo size
   - Color coding

3. **`src/rendering/effects/line-clear-animator.js`**
   - Line clear animations
   - Flash effects
   - Particle explosions

4. **`src/rendering/effects/piece-lock-feedback.js`**
   - Lock ripples
   - Particle puffs
   - Camera shake

5. **`src/utils/adaptive-quality.js`**
   - Auto quality adjustment
   - FPS monitoring
   - Quality level management

### Modified Files
1. **`src/rendering/phaser/multiplayer/board-panel.js`**
   - Integrate effects manager
   - Wire up effect callbacks
   - Viewport configuration

2. **`src/main.js`**
   - Initialize effects for all boards
   - Connect physics to effects
   - Quality settings

3. **`src/core/game.js`**
   - Add effect trigger points
   - Pass effect callbacks

---

## Performance Budget

### Effect Overhead Targets
| Effect Type | Budget per Frame | Priority |
|-------------|------------------|----------|
| Line Clear Flash | 0.5ms | High |
| Piece Lock Ripple | 0.3ms | High |
| Combo Popup | 0.5ms | High |
| Particle Update | 1.5ms | Medium |
| Particle Render | 1.0ms | Medium |
| Camera Shake | 0.2ms | High |
| **Total** | **4.0ms** | - |

**Remaining Budget**: 12ms (of 16ms frame budget)
**Acceptable**: Effects should use < 25% of frame time

---

## Risk Mitigation

### Risk 1: FPS Drop
**Risk**: Effects cause FPS to drop below 55
**Mitigation**:
- Implement adaptive quality
- Use object pooling
- Profile and optimize hot paths
**Fallback**: Disable particles for opponent boards

### Risk 2: Viewport Bleeding
**Risk**: Effects from one board appear on another
**Mitigation**:
- Viewport clipping
- Coordinate transformation
- Bounds checking
**Fallback**: Reduce effect size

### Risk 3: Memory Leaks
**Risk**: Particles/effects not cleaned up
**Mitigation**:
- Object pooling
- Proper destroy() calls
- Max particle limits
**Fallback**: Auto-clear after time limit

---

## Debug Tools

### Effect Visualizer
```javascript
window.effectDebug = {
  // Show all active effects
  showActive: () => {
    console.log('Active Effects:', {
      particles: particlePool.getActiveCount(),
      tweens: scene.tweens.getTweens().length,
      graphics: scene.children.list.filter(c => c.type === 'Graphics').length,
    });
  },

  // Test specific effect
  testEffect: (boardIndex, effectName) => {
    const board = boardScenes[boardIndex];
    if (board && board.effects && board.effects[effectName]) {
      board.effects[effectName]();
      console.log(`Tested ${effectName} on board ${boardIndex}`);
    }
  },

  // Enable/disable effects
  toggleEffects: (enabled) => {
    boardScenes.forEach(board => {
      if (board.effects) {
        board.effects.enabled = enabled;
      }
    });
    console.log(`Effects ${enabled ? 'enabled' : 'disabled'}`);
  },
};
```

---

## Expected Outcomes

### Before Enhancement
```
FFA Mode (5 players):
- FPS: 58 ✅
- Line Clear: Boring (no flash) ❌
- Piece Lock: Meh (no feedback) ❌
- Combo: Invisible (no popup) ❌
- Particles: None ❌
- Overall Feel: 4/10 ❌
```

### After Enhancement
```
FFA Mode (5 players):
- FPS: 56-58 ✅ (slight drop acceptable)
- Line Clear: Satisfying (flash + particles) ✅
- Piece Lock: Tactile (ripple + shake) ✅
- Combo: Impactful (big text + burst) ✅
- Particles: Smooth (pooled) ✅
- Overall Feel: 9/10 ✅
```

---

## Next Steps

1. **Review this plan** with the team
2. **Run Phase 1 audit** - document current state
3. **Start Phase 1 implementation** - wire up basic effects
4. **Iterate through phases** 2-4
5. **Test and validate** with performance monitoring

---

## References

- [Phase 1-3 Performance Optimizations](OPTIMIZATION_COMPLETE.md)
- [Performance Monitoring](PHASE_1_COMPLETE_SUMMARY.md)
- [Phaser 4 Effects Documentation](https://phaser.io/docs)
- [Object Pooling System](src/utils/object-pool.js)

---

**Document Version**: 1.0
**Created**: 2025-10-22
**Status**: Ready for Implementation
**Estimated Time**: 8-12 hours total
**Expected Impact**: +5 points to "overall feel" (4/10 → 9/10)

---

**Let's make FFA mode feel as amazing as single-player!** 🎨✨
