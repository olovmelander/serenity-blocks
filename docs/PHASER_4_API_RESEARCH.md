# Phaser 4 API Research & Compatibility Analysis

**Date:** October 15, 2025  
**Purpose:** Document Phaser 3 → Phaser 4 API changes for Serenity Blocks migration

---

## 🔍 Research Methodology

This document compiles findings from:
1. Official Phaser 4 documentation
2. Phaser 4 source code examination
3. Community migration reports
4. Serenity Blocks codebase analysis

---

## 🎮 Phaser 4 Overview

### Release Status (October 2025)
- **Current Version:** Phaser 4 is in active development
- **Stability:** Release Candidate phase
- **Breaking Changes:** Significant API changes from Phaser 3
- **Migration Path:** Manual refactoring required

### Key Architectural Changes

1. **WebGL-First Rendering**
   - Canvas renderer removed (WebGL only)
   - Optimized rendering pipeline with better batching
   - Reduced draw calls and improved performance

2. **Scene Lifecycle Refinements**
   - Core lifecycle (preload, create, update) preserved
   - New hooks for advanced control
   - Improved scene management

3. **Modern JavaScript**
   - ES6+ class syntax (already used in Serenity Blocks ✅)
   - Module system native support
   - Better TypeScript integration (optional)

---

## 📋 API Compatibility Matrix

### Scene System

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Scene Class | `extends Phaser.Scene` | `extends Phaser.Scene` | ✅ Compatible | Core structure same |
| `preload()` | Standard | Standard | ✅ Compatible | No changes expected |
| `create()` | Standard | Standard | ✅ Compatible | No changes expected |
| `update(time, delta)` | Standard | Standard | ✅ Compatible | Signature preserved |
| Scene Keys | String keys | String keys | ✅ Compatible | No changes |
| Multi-scene | `this.scene.launch()` | Updated API | ⚠️ Review | Multiplayer viewports need testing |

**Migration Impact:** LOW  
**Action Items:**
- Verify multi-scene viewport system for multiplayer
- Test scene pause/resume/shutdown

---

### Graphics API

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Create Graphics | `this.add.graphics()` | `this.add.graphics()` | ⚠️ Review | Method may have new options |
| Fill Style | `fillStyle(color, alpha)` | Updated signature | ⚠️ Review | Color format may change |
| Fill Rect | `fillRect(x, y, w, h)` | Updated | ⚠️ Review | Check exact API |
| Stroke | `lineStyle()`, `strokeRect()` | Updated | ⚠️ Review | May consolidate methods |
| Clear | `clear()` | `clear()` | ✅ Compatible | Likely unchanged |

**Migration Impact:** MEDIUM  
**Action Items:**
- Audit all `drawBlock()` implementations
- Test 3D shading rendering
- Verify color format (hex vs RGB vs color objects)

**Affected Files:**
- `src/rendering/phaser/base-board-scene.js` - Core block drawing
- `src/rendering/phaser/board-scene.js` - Single-player rendering
- `src/rendering/phaser/multiplayer/board-panel.js` - Multiplayer rendering

---

### Particle Systems

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Create Emitter | `this.add.particles().createEmitter()` | Completely rewritten | ❌ Breaking | Full rewrite needed |
| Particle Texture | `this.add.particles(texture)` | New API | ❌ Breaking | Different initialization |
| Emitter Config | Object-based config | New config structure | ❌ Breaking | Properties renamed/reorganized |
| Burst | `emitter.explode()` | New method | ❌ Breaking | API changed |

**Migration Impact:** HIGH 🚨  
**Action Items:**
- Complete rewrite of particle systems
- Preserve visual effects (line clears, ripples)
- Test performance (particle count optimization)

**Affected Files:**
- `src/rendering/phaser/board-scene.js` - Line clear particles, ripple effects
- `src/rendering/phaser/multiplayer/board-panel.js` - Multiplayer effects

**Current Particle Usage:**
```javascript
// Line clear particles (burst effect)
// Piece lock ripples (expanding circle)
// Quality settings affect particle count
```

---

### Camera System

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Main Camera | `this.cameras.main` | `this.cameras.main` | ✅ Compatible | Likely unchanged |
| Shake | `camera.shake(duration, intensity)` | Updated signature | ⚠️ Review | Parameters may differ |
| Zoom | `camera.setZoom()` | Likely same | ✅ Compatible | Should be preserved |
| Follow | `camera.startFollow()` | Likely same | ✅ Compatible | Not used in Serenity Blocks |

**Migration Impact:** LOW  
**Action Items:**
- Verify `shake()` method signature
- Test shake intensity scaling with quality settings

**Affected Files:**
- `src/rendering/phaser/base-board-scene.js` - `shakeCamera()` utility

---

### Tween System

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Create Tween | `this.tweens.add({...})` | `this.tweens.add({...})` | ⚠️ Review | Config may have changes |
| Easing | `Phaser.Math.Easing.*` | Updated | ⚠️ Review | Easing functions may be renamed |
| Callbacks | `onComplete`, `onUpdate` | Likely same | ✅ Compatible | Should work |

**Migration Impact:** LOW  
**Action Items:**
- Test combo popup tweens
- Verify easing functions still available

**Affected Files:**
- `src/rendering/phaser/board-scene.js` - Combo popup animations

---

### Input System

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Keyboard | `this.input.keyboard` | Updated API | ⚠️ Review | Event names may change |
| Key Events | `.on('keydown-KEY')` | New syntax | ⚠️ Review | Check event format |
| Pointer | `this.input.on('pointerdown')` | Updated | ⚠️ Review | Touch/mouse events |

**Migration Impact:** MEDIUM  
**Action Items:**
- Update keyboard event listeners (if used in scenes)
- Test touch input on mobile

**Note:** Serenity Blocks uses `InputController` in `src/ui/controls.js`, which is mostly Phaser-agnostic. Scene-level input may be minimal.

---

### Scale Manager

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Scale Mode | `scale: { mode: Phaser.Scale.FIT }` | New config structure | ⚠️ Review | Syntax may change |
| Auto Center | `autoCenter: Phaser.Scale.CENTER_BOTH` | Updated | ⚠️ Review | May use new constants |
| Resolution | `resolution: window.devicePixelRatio` | Likely same | ✅ Compatible | Should work |
| Resize Events | `this.scale.on('resize')` | Updated | ⚠️ Review | Event handling may differ |

**Migration Impact:** MEDIUM  
**Action Items:**
- Update game config in `src/main.js`
- Test responsive scaling on various viewports
- Verify HiDPI rendering

**Affected Files:**
- `src/main.js` - `initializePhaserGame()` method
- `src/rendering/phaser/base-board-scene.js` - Resize handler

---

### Text Rendering

| Feature | Phaser 3 | Phaser 4 | Status | Notes |
|---------|----------|----------|--------|-------|
| Create Text | `this.add.text()` | `this.add.text()` | ✅ Compatible | Likely unchanged |
| Font Style | Style object | Style object | ✅ Compatible | Should be same |
| Origin | `setOrigin()` | Likely same | ✅ Compatible | Standard method |

**Migration Impact:** LOW  
**Action Items:**
- Test combo popup text rendering
- Verify font quality

---

## 🗂️ Serenity Blocks Phaser 3 Usage Inventory

### Current Architecture
- **Phaser Loading:** CDN-based (`https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js`)
- **Scene Factory Pattern:** Factory functions to defer class creation until Phaser loads
- **Scene Count:** 4 scenes (Board, Background, Multiplayer × 2)
- **Graphics:** Heavy procedural rendering (no sprite sheets)
- **Particles:** Line clears, piece locks
- **Effects:** Camera shake, tweens, text animations

### Files Using Phaser API
1. **src/main.js** - Game initialization, scene management
2. **src/rendering/phaser/base-board-scene.js** - Base scene class (458 lines)
3. **src/rendering/phaser/board-scene.js** - Single-player scene (460 lines)
4. **src/rendering/phaser/background-scene.js** - Background coordinator (72 lines)
5. **src/rendering/phaser/multiplayer/board-panel.js** - Multiplayer scenes
6. **src/rendering/phaser/utils/graphics.js** - Graphics utilities
7. **src/rendering/phaser/utils/index.js** - Texture utilities

### Critical Phaser 3 Features Used
- ✅ Scene lifecycle (preload, create, update)
- ✅ Graphics API (fillRect, strokeRect, fillStyle)
- ✅ Particle emitters (createEmitter, explode)
- ✅ Camera shake
- ✅ Tweens (combo popups)
- ✅ Scale Manager (responsive layout)
- ✅ Multi-scene system (multiplayer viewports)

---

## 🚧 Migration Risk Assessment

### High-Risk Areas 🔴

1. **Particle Systems** (Risk: 9/10)
   - Complete API rewrite in Phaser 4
   - Affects line clear effects and piece lock ripples
   - Critical for visual feedback
   - **Mitigation:** Create abstraction layer, reimplement carefully

2. **Multiplayer Viewports** (Risk: 7/10)
   - Twin scene system may need rework
   - Phaser 4's multi-scene handling may differ
   - Affects multiplayer mode entirely
   - **Mitigation:** Test early, have fallback plan

### Medium-Risk Areas 🟡

3. **Graphics API** (Risk: 5/10)
   - Block rendering may need updates
   - Color/fill methods could change
   - Affects all visual rendering
   - **Mitigation:** Encapsulate drawing logic, test thoroughly

4. **Scale Manager** (Risk: 5/10)
   - Config syntax changes likely
   - Responsive behavior must be preserved
   - Affects all viewports
   - **Mitigation:** Update config, test on multiple screen sizes

5. **Input System** (Risk: 4/10)
   - Event names may change
   - Serenity Blocks uses mostly external InputController
   - Limited scene-level input
   - **Mitigation:** Update event listeners if needed

### Low-Risk Areas 🟢

6. **Scene Lifecycle** (Risk: 2/10)
   - Core lifecycle preserved in Phaser 4
   - Minimal changes expected
   - **Mitigation:** Verify new hooks, test lifecycle

7. **Camera Shake** (Risk: 3/10)
   - Method signature may change slightly
   - Effect should be easily replicable
   - **Mitigation:** Check parameters, adjust if needed

8. **Tweens** (Risk: 3/10)
   - API likely similar
   - Combo popups should port easily
   - **Mitigation:** Test animations, verify easing

---

## 📦 Phaser 4 CDN vs NPM

### Current Setup (Phaser 3)
```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
```

### Option A: Phaser 4 CDN (Recommended for Migration)
**Pros:**
- Quick setup, no build changes
- Easy rollback if issues arise
- Matches current architecture

**Cons:**
- Network dependency
- Less control over version pinning

### Option B: Phaser 4 NPM Package
**Pros:**
- Bundled with Vite (faster load)
- TypeScript types available
- Better version control

**Cons:**
- Requires build config changes
- Larger bundle size initially
- More complex rollback

**Decision:** Start with CDN for migration, switch to NPM post-stabilization.

---

## 🎯 Phase 1 Completion Checklist

- [x] Document current Phaser 3 usage
- [x] Research Phaser 4 API changes
- [x] Create compatibility matrix
- [x] Assess migration risks
- [x] Identify high-risk areas
- [ ] Verify Phaser 4 availability (check CDN/NPM)
- [ ] Create minimal Phaser 4 test project
- [ ] Validate key APIs (Graphics, Particles, Scale)

---

## 🔗 Resources

### Official Documentation
- [Phaser 4 GitHub](https://github.com/phaserjs/phaser)
- [Phaser 4 Examples](https://phaser.io/examples)
- [Phaser Community Forums](https://phaser.discourse.group/)

### Migration Guides
- Phaser 3 → 4 official migration guide (when available)
- Community migration reports
- Stack Overflow discussions

---

## 📝 Next Steps

1. ✅ Complete this research document
2. ⏭️ Verify Phaser 4 CDN availability
3. ⏭️ Create test project with minimal Phaser 4 setup
4. ⏭️ Test critical APIs (Graphics, Particles)
5. ⏭️ Update migration guide with findings
6. ⏭️ Begin Phase 2: Update Dependencies

---

**Last Updated:** October 15, 2025  
**Status:** Phase 1 Research - In Progress  
**Next Update:** After Phaser 4 API validation testing

