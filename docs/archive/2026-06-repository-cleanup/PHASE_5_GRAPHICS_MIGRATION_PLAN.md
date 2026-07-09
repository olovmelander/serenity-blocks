# Phase 5: Graphics & Rendering Migration Plan

**Date:** October 15, 2025  
**Phase:** Phase 5 - Update Graphics & Rendering  
**Status:** 🚧 In Progress  
**Risk Level:** 🔴 HIGH (Particle systems completely rewritten)

---

## 🎯 Objectives

1. **Adapt Graphics API** - Update all procedural block rendering for Phaser 4
2. **Rewrite Particle Systems** - Complete reimplementation with new API (HIGH PRIORITY)
3. **Update Camera Effects** - Verify camera shake compatibility
4. **Test Visual Parity** - Ensure effects look identical to Phaser 3

---

## 📋 Migration Tasks

### Task 1: Graphics API Verification (Low Risk) ✅
**Priority:** HIGH  
**Estimated Time:** 1-2 hours

**Files:**
- `src/rendering/phaser/board-scene.js` - Block rendering methods
- `src/rendering/phaser/utils/graphics.js` - Graphics utilities

**Current Usage:**
```javascript
// Block rendering
this.boardGraphics.fillStyle(color, alpha);
this.boardGraphics.fillRect(x, y, width, height);
this.boardGraphics.lineStyle(width, color, alpha);
this.boardGraphics.strokeRect(x, y, width, height);
```

**Phaser 4 Changes to Check:**
- Method signatures (do they still exist?)
- Color format (hex string vs color objects?)
- Alpha handling (separate parameter vs color?)
- Performance characteristics

**Testing Strategy:**
1. Start game with Vite server
2. Check console for Graphics API errors
3. Verify blocks render correctly
4. Compare visual output with screenshots

---

### Task 2: Particle System Rewrite (High Risk) 🔴
**Priority:** CRITICAL  
**Estimated Time:** 4-6 hours

**Current Implementation (Phaser 3):**
```javascript
// Line clear particles
const emitter = this.add.particles(texture).createEmitter({
    speed: { min: 100, max: 300 },
    lifespan: 650,
    gravityY: 200,
    scale: { start: 1, end: 0 },
    alpha: { start: 1, end: 0 },
    blendMode: 'ADD'
});
emitter.explode(count, x, y);

// Piece lock ripples
const rippleEmitter = this.add.particles(texture).createEmitter({
    speed: { min: 50, max: 150 },
    lifespan: 650,
    scale: { start: 0.5, end: 2 },
    alpha: { start: 0.8, end: 0 }
});
```

**Phaser 4 Changes:**
- ❌ Complete API rewrite
- ❌ `add.particles()` likely changed
- ❌ `createEmitter()` structure different
- ❌ Configuration properties renamed/reorganized
- ❌ `explode()` method may be different

**Migration Strategy:**
1. **Research Phaser 4 particle API** (check docs/examples)
2. **Create abstraction layer** for easier swapping
3. **Implement new particle effects:**
   - Line clear burst particles
   - Piece lock ripple effect
   - Combo effect particles (if used)
4. **Match visual appearance** with original
5. **Optimize performance** (particle counts)

**Fallback Plan:**
If Phaser 4 particles are too different or perform poorly:
- Option A: Use custom canvas-based particles
- Option B: Simplify effects temporarily
- Option C: Use shader-based effects

---

### Task 3: Camera Effects Update (Medium Risk)
**Priority:** MEDIUM  
**Estimated Time:** 1 hour

**Current Implementation:**
```javascript
this.cameras.main.shake(duration, intensity);
```

**Phaser 4 Changes to Check:**
- Does `cameras.main` still exist?
- Is `shake()` method signature same?
- Are parameters in same order?
- Any new camera effect methods?

**Testing:**
1. Clear a line
2. Verify camera shake triggers
3. Check shake intensity matches original
4. Test with quality settings (High/Medium/Low)

---

### Task 4: Text Rendering Verification (Low Risk)
**Priority:** LOW  
**Estimated Time:** 30 minutes

**Current Implementation:**
```javascript
const text = this.add.text(x, y, content, {
    fontSize: '24px',
    fontFamily: 'Arial',
    color: '#ffffff'
});
```

**Phaser 4 Changes to Check:**
- `add.text()` still exists?
- Style object format same?
- Font rendering quality maintained?

---

## 🔍 Testing Strategy

### Incremental Testing Approach

**Step 1: Graphics API (Test First)**
1. Start Vite server: `./start-dev.sh`
2. Open http://localhost:3000/
3. Open DevTools Console (F12)
4. Start game
5. Check if blocks render
6. Look for Graphics API errors

**Step 2: Particle Systems (High Risk)**
1. Clear a line
2. Check console for particle errors
3. Verify particles appear
4. Compare with Phaser 3 version (video/screenshot)
5. Test performance (60 FPS maintained?)

**Step 3: Camera Effects**
1. Clear a line
2. Verify camera shakes
3. Check shake intensity
4. Test quality settings affect shake

**Step 4: Visual Regression**
1. Take screenshots before/after
2. Compare side-by-side
3. Note any visual differences
4. Adjust parameters to match

---

## 🚨 Known Risks & Mitigation

### Risk 1: Particle API Completely Different 🔴
**Likelihood:** HIGH  
**Impact:** HIGH  
**Mitigation:**
- Research Phaser 4 docs thoroughly before coding
- Create abstraction layer
- Have fallback rendering ready
- Test early and often

### Risk 2: Performance Regression
**Likelihood:** MEDIUM  
**Impact:** HIGH  
**Mitigation:**
- Profile before and after
- Reduce particle counts if needed
- Use quality settings to scale effects
- Monitor FPS during testing

### Risk 3: Visual Parity Issues
**Likelihood:** MEDIUM  
**Impact:** MEDIUM  
**Mitigation:**
- Take reference screenshots
- Adjust parameters carefully
- Get user feedback
- Iterate until acceptable

---

## 📊 Success Criteria

### Must Work ✅
- [ ] Blocks render correctly
- [ ] No Graphics API errors
- [ ] Line clear effects trigger
- [ ] Particles appear (even if simplified)
- [ ] Camera shake works
- [ ] 60 FPS maintained
- [ ] No console errors

### Should Match Original 🎯
- [ ] Particle effects visually similar
- [ ] Camera shake intensity matches
- [ ] Text rendering quality same
- [ ] Colors/alpha values accurate
- [ ] Timing feels right

### Nice to Have 🌟
- [ ] Effects look even better than Phaser 3
- [ ] Better performance
- [ ] Smoother animations
- [ ] New Phaser 4 features utilized

---

## 📝 Implementation Order

### Order of Operations

1. ✅ **Start Vite Server** (already running)
2. ⏭️ **Test Current State** - See what errors appear
3. ⏭️ **Fix Graphics API** - Low-hanging fruit
4. ⏭️ **Research Phaser 4 Particles** - Critical path
5. ⏭️ **Implement New Particles** - High risk
6. ⏭️ **Update Camera Effects** - Medium priority
7. ⏭️ **Visual Regression Testing** - Validation
8. ⏭️ **Performance Optimization** - Polish
9. ⏭️ **Document Changes** - Handoff

---

## 🛠️ Development Workflow

### Iterative Approach

```
1. Make small change
   ↓
2. Save file (Vite auto-reloads)
   ↓
3. Check browser console
   ↓
4. Test in game
   ↓
5. Adjust if needed
   ↓
6. Repeat
```

### Testing Checklist Per Change

After each code change:
- [ ] Check console for errors
- [ ] Reload browser if needed
- [ ] Test affected feature
- [ ] Verify no regressions
- [ ] Git commit if stable

---

## 📚 Resources Needed

### Phaser 4 Documentation
- [ ] Particle system documentation
- [ ] Graphics API reference
- [ ] Camera API reference
- [ ] Examples repository

### Tools
- ✅ Vite dev server (running)
- ✅ Browser DevTools
- ⏭️ Screenshot tool (for comparisons)
- ⏭️ Video recording (for particle effects)
- ⏭️ Performance profiler

---

## 🎯 Next Immediate Actions

1. **Read board-scene.js** - Understand current implementation
2. **Test Current State** - What errors do we get with Phaser 4?
3. **Research Phaser 4 Docs** - Find particle system docs
4. **Create Test Plan** - Specific test cases
5. **Begin Migration** - Start with Graphics API

---

**Phase 5 Status:** Starting  
**Current Task:** Examining current code  
**Next Milestone:** Graphics API working  
**Estimated Completion:** 4-8 hours of work

