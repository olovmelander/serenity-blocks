# Phase 4: Scene System Migration Plan

**Date:** October 15, 2025  
**Phase:** Phase 4 - Migrate Scene System  
**Status:** 🚧 In Progress

---

## 🎯 Objective

Update all Phaser scene classes for Phaser 4 API compatibility while preserving functionality, visual effects, and performance.

---

## 📋 Scenes to Migrate

### 1. BaseBoardScene (Priority: HIGH)
**File:** `src/rendering/phaser/base-board-scene.js`  
**Size:** 458 lines  
**Role:** Shared foundation for all board scenes  
**Risk:** MEDIUM - Core infrastructure, affects all scenes

**Features:**
- Graphics layer management (board, piece, fx)
- Camera effects (shake, zoom)
- Responsive scaling
- Quality settings integration
- Particle texture utilities
- Collision detection helpers

**Changes Needed:**
- Verify Scene class inheritance
- Update lifecycle methods (preload, create, update)
- Validate Graphics API usage
- Test camera effects
- Verify particle texture creation

---

### 2. BoardScene (Priority: HIGH)
**File:** `src/rendering/phaser/board-scene.js`  
**Size:** 460 lines  
**Role:** Single-player game board rendering  
**Risk:** HIGH - Heavy Graphics API usage, particle systems

**Features:**
- Block rendering with 3D shading
- Ghost piece rendering
- Line clear effects (flash, particles, shake)
- Piece lock ripples
- Combo popups
- HUD integration (score, level, lines)
- Next piece queue

**Changes Needed:**
- Update Graphics API calls (fillRect, strokeRect, fillStyle)
- **Complete rewrite of particle systems** (HIGH PRIORITY)
- Verify camera shake integration
- Test tween animations
- Update text rendering

---

### 3. BackgroundScene (Priority: MEDIUM)
**File:** `src/rendering/phaser/background-scene.js`  
**Size:** 72 lines  
**Role:** Coordinates WebGL theme renderer  
**Risk:** LOW - Minimal Phaser API usage

**Features:**
- Bridges Phaser update loop to WebGL renderer
- Quality settings propagation
- Lifecycle management

**Changes Needed:**
- Verify Scene lifecycle
- Test WebGL renderer integration
- Validate quality settings

---

### 4. MultiplayerBoardScene (Priority: HIGH)
**File:** `src/rendering/phaser/multiplayer/board-panel.js`  
**Role:** Twin viewport system for multiplayer  
**Risk:** HIGH - Complex viewport management

**Features:**
- P1/P2 board rendering
- Garbage meter visuals
- Synchronized effects
- Viewport positioning

**Changes Needed:**
- Update multi-scene system
- Verify viewport API
- Test garbage meter rendering
- Validate scene coordination

---

## 🔧 Migration Strategy

### Step 1: Update BaseBoardScene (Foundation)
1. Add Phaser 4 compatibility checks
2. Verify Scene.constructor signature
3. Update lifecycle methods
4. Test graphics layer creation
5. Validate camera effects
6. Update particle texture utilities

### Step 2: Update BoardScene (Core Gameplay)
1. Update Graphics API calls
2. **Rewrite particle systems** (most time-consuming)
3. Test visual effects
4. Verify HUD rendering
5. Validate quality settings

### Step 3: Update BackgroundScene (Simple)
1. Quick validation pass
2. Test WebGL integration
3. Verify update loop

### Step 4: Update MultiplayerBoardScene (Complex)
1. Test multi-scene API
2. Verify viewport positioning
3. Test garbage effects
4. Validate synchronization

---

## 🚨 High-Risk Areas

### 1. Particle Systems (🔴 CRITICAL)
**Issue:** Phaser 4 completely rewrote particle system API  
**Current Usage:**
- Line clear bursts
- Piece lock ripples
- Combo effects

**Migration Approach:**
1. Read Phaser 4 particle documentation
2. Create abstraction layer
3. Reimplement effects
4. Test visual parity
5. Optimize performance

**Fallback Plan:**
- Use custom canvas particles if Phaser 4 particles unsuitable
- Simplify effects if performance issues

---

### 2. Graphics API Changes (🟡 MEDIUM)
**Concern:** Method signatures may differ

**Current Usage:**
```javascript
graphics.fillStyle(color, alpha);
graphics.fillRect(x, y, width, height);
graphics.lineStyle(width, color, alpha);
graphics.strokeRect(x, y, width, height);
```

**Phaser 4 Changes:** TBD (verify at runtime)

**Migration Approach:**
- Add defensive wrappers
- Test each graphics call
- Create compatibility layer if needed

---

### 3. Camera Shake (🟢 LOW)
**Current Usage:**
```javascript
this.cameras.main.shake(duration, intensity);
```

**Expected Phaser 4:** Likely similar with possible parameter changes

**Migration Approach:**
- Test current signature
- Add parameter validation
- Adjust if API changed

---

## 📝 Code Patterns to Update

### Pattern 1: Scene Factory Functions
**Current Pattern:**
```javascript
export function createBoardScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null
) {
    const PhaserRef = phaserLib;
    
    class BoardScene extends PhaserRef.Scene {
        // ...
    }
    
    return BoardScene;
}
```

**Phaser 4 Updates:**
- Add API validation
- Add version logging
- Add fallback checks

---

### Pattern 2: Graphics Layer Creation
**Current Pattern:**
```javascript
this.boardGraphics = this.add.graphics();
this.pieceGraphics = this.add.graphics();
this.effectsGraphics = this.add.graphics();
```

**Phaser 4 Updates:**
- Verify `this.add.graphics()` exists
- Add error handling
- Test graphics clearing

---

### Pattern 3: Particle Emitters (NEEDS REWRITE)
**Current Pattern (Phaser 3):**
```javascript
const emitter = this.add.particles(texture).createEmitter({
    speed: { min: 100, max: 300 },
    lifespan: 650,
    gravityY: 200,
    scale: { start: 1, end: 0 },
    // ...
});
emitter.explode(count, x, y);
```

**Phaser 4 Pattern:** TBD - Complete API rewrite

**Action Items:**
1. Research Phaser 4 particle API
2. Create compatibility layer
3. Reimplement all particle effects

---

## ✅ Validation Checklist

### BaseBoardScene
- [ ] Scene extends Phaser.Scene correctly
- [ ] constructor() works
- [ ] preload() executes
- [ ] create() executes
- [ ] update() called every frame
- [ ] Graphics layers created
- [ ] Camera effects work
- [ ] Particle textures generated
- [ ] Quality settings applied

### BoardScene
- [ ] Extends BaseBoardScene
- [ ] Block rendering works
- [ ] Ghost piece renders
- [ ] Line clear flash works
- [ ] Particle bursts display
- [ ] Camera shake triggers
- [ ] Combo popups appear
- [ ] HUD updates correctly
- [ ] Next queue renders

### BackgroundScene
- [ ] Scene loads
- [ ] WebGL renderer integrated
- [ ] Update loop runs
- [ ] Quality settings propagate

### MultiplayerBoardScene
- [ ] Twin scenes render
- [ ] Viewports positioned correctly
- [ ] Garbage meters display
- [ ] Effects synchronized
- [ ] Performance acceptable

---

## 🎯 Success Criteria

### Must Work
- ✅ All scenes load without errors
- ✅ Graphics render correctly
- ✅ Effects trigger appropriately
- ✅ Performance maintained (60 FPS)
- ✅ Quality settings functional

### Visual Parity
- ✅ Blocks look identical
- ✅ Particle effects match
- ✅ Camera shake feels same
- ✅ Colors accurate
- ✅ Animations smooth

---

## 📊 Estimated Timeline

| Task | Duration | Risk |
|------|----------|------|
| BaseBoardScene update | 2 hours | Medium |
| BoardScene Graphics API | 1 hour | Medium |
| BoardScene Particle rewrite | 4 hours | High |
| BoardScene testing | 1 hour | Low |
| BackgroundScene update | 30 min | Low |
| MultiplayerBoardScene update | 2 hours | Medium |
| Integration testing | 2 hours | Low |

**Total Estimated Time:** 12.5 hours (~1.5 days)

---

## 🔜 Next Actions

1. ✅ Read BaseBoardScene current implementation
2. ✅ Read BackgroundScene current implementation
3. ⏭️ Update BaseBoardScene for Phaser 4
4. ⏭️ Test BaseBoardScene in isolation
5. ⏭️ Update BoardScene Graphics API
6. ⏭️ Research Phaser 4 particle system
7. ⏭️ Rewrite particle effects
8. ⏭️ Update BackgroundScene
9. ⏭️ Update MultiplayerBoardScene
10. ⏭️ Integration testing

---

**Phase 4 Status:** Starting  
**Current Task:** Read and analyze existing scene implementations  
**Next Milestone:** BaseBoardScene migration complete

