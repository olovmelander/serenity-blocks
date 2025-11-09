# Serenity Blocks - Performance Optimization Plan

Based on François's Phaser 3 optimization guide (2025) and comprehensive codebase analysis.

---

## Executive Summary

This document outlines a structured approach to optimize Serenity Blocks using proven Phaser optimization techniques. The game already implements several advanced optimizations (object pooling, texture caching, quality settings), but there are opportunities to improve performance further, especially for mobile and lower-end devices.

---

## Current State Analysis

### ✅ Already Implemented Optimizations

Your game already has **excellent** optimization foundations:

1. **Object Pooling** - [src/utils/object-pool.js](src/utils/object-pool.js)
   - Particle pools (100 initial, 500 max)
   - Garbage entry pools (50 initial, 200 max)
   - Piece pools (40 initial, 160 max)
   - Array pools for collision checks

2. **Asset Management** - [src/utils/asset-manager.js](src/utils/asset-manager.js)
   - LRU cache with 50 asset limit
   - Deduplication
   - Memory tracking
   - Preloading support

3. **Texture Caching** - [src/utils/texture-manager.js](src/utils/texture-manager.js)
   - WebGL texture caching
   - Buffer management
   - Procedural texture generation

4. **Dynamic Quality Settings** - [src/utils/quality.js](src/utils/quality.js)
   - 4 levels (Low, Medium, High, Ultra)
   - Adjustable particle counts
   - Shader complexity control
   - Camera shake intensity

5. **Performance Monitoring** - [src/utils/performance-monitor.js](src/utils/performance-monitor.js)
   - FPS tracking
   - Frame time analysis
   - Performance warnings

6. **Render Optimization**
   - Graphics cleared once per frame in BaseBoardScene
   - Depth-sorted layers (board, piece, effects)
   - Particle burst pooling

---

## Optimization Opportunities (Based on François's Guide)

### 🎯 Priority 1: Critical Improvements

#### 1.1 Enhanced FPS Counter & Performance Dashboard
**Current:** Basic performance monitoring exists
**Improvement:** Add user-facing FPS counter with detailed metrics

**Implementation:**
- **Location:** [src/utils/performance-monitor.js](src/utils/performance-monitor.js)
- **Actions:**
  - Add visual FPS display (top-right corner, toggle with F3)
  - Show memory usage (heap size, object counts)
  - Display frame time graph (min/max/avg)
  - Add performance mode indicator (Low/Med/High/Ultra)
  - Track draw calls per frame (if possible via Phaser 4 API)

**Benefits:**
- Real-time performance feedback
- Easier debugging on different devices
- User awareness of quality settings impact

**Files to Modify:**
- [src/utils/performance-monitor.js](src/utils/performance-monitor.js)
- [src/rendering/phaser/ui/index.js](src/rendering/phaser/ui/index.js)

---

#### 1.2 Reference Caching for Hot Paths
**Current:** Some caching exists (grid cache, texture cache)
**Improvement:** Cache frequently accessed references in critical loops

**Critical Hot Paths Identified:**

1. **Physics Loop** - [src/core/physics.js](src/core/physics.js)
   ```javascript
   // Current: Recalculates board dimensions repeatedly
   // Optimize: Cache board bounds
   const BOARD_HEIGHT = 24;
   const BOARD_WIDTH = 10;
   ```

2. **Board Rendering** - [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js)
   ```javascript
   // Cache frequently accessed properties
   this.cachedBlockSize = BLOCK_SIZE;
   this.cachedBoardWidth = BOARD_WIDTH;
   this.cachedBoardHeight = BOARD_HEIGHT;
   ```

3. **Garbage Insertion** - [src/core/garbage.js](src/core/garbage.js)
   ```javascript
   // Cache color lookups
   this.garbageColorCache = new Map();
   ```

**Implementation Steps:**
- Identify functions called >100 times per second
- Cache DOM references (if any)
- Cache constant calculations
- Use local variables for repeated property access

**Files to Modify:**
- [src/core/physics.js](src/core/physics.js)
- [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js)
- [src/core/garbage.js](src/core/garbage.js)

---

#### 1.3 Game Loop Optimization (Selective Processing)
**Current:** Update loops process everything every frame
**Improvement:** Skip unnecessary updates when state hasn't changed

**Strategy:**

1. **Board Dirty Flagging** (Already Partially Implemented)
   - [src/core/game.js](src/core/game.js) has `markBoardDirty()`
   - **Extend:** Only redraw board graphics when dirty flag is set
   - **Location:** [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js)

2. **Conditional Particle Updates**
   - Only update active particle systems
   - Skip particle updates if no particles alive
   - **Location:** [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js)

3. **Background Scene Optimization**
   - Reduce WebGL background update rate to 30fps (not 60fps)
   - Users won't notice background running at half rate
   - **Location:** [src/rendering/phaser/background-scene.js](src/rendering/phaser/background-scene.js)

4. **Multiplayer Optimization**
   - Only process active players (skip game-over boards)
   - Cache opponent state queries
   - **Location:** [src/core/multiplayer.js](src/core/multiplayer.js)

**Implementation:**
```javascript
// Example: Conditional board rendering
update(time, delta) {
  // Only redraw if board changed
  if (this.gameState.boardDirty) {
    this.renderBoard();
    this.gameState.boardDirty = false;
  }

  // Only update particles if active
  if (this.activeParticles > 0) {
    this.updateParticles(delta);
  }
}
```

**Files to Modify:**
- [src/rendering/phaser/base-board-scene.js](src/rendering/phaser/base-board-scene.js)
- [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js)
- [src/rendering/phaser/background-scene.js](src/rendering/phaser/background-scene.js)
- [src/core/multiplayer.js](src/core/multiplayer.js)

---

### 🎯 Priority 2: Asset Optimization

#### 2.1 Asset Compression & Format Optimization
**Current:** Asset management exists, but no compression pipeline
**Improvement:** Compress assets and use modern formats

**Actions:**

1. **Image Optimization**
   - Convert PNG → WebP (30-50% smaller, same quality)
   - Use AVIF where supported (even better compression)
   - Implement fallback chain: AVIF → WebP → PNG
   - Compress existing PNG files with tools (pngquant, TinyPNG)

2. **Audio Optimization**
   - Convert WAV → OGG Vorbis (much smaller)
   - Use AAC/M4A for music
   - Reduce sample rates where possible (44.1kHz → 22kHz for SFX)
   - Implement audio sprites (combine multiple SFX into one file)

3. **Build Pipeline Integration**
   - Add compression step to Vite build process
   - Auto-generate WebP/AVIF versions
   - Create asset manifest with optimal formats

**Implementation:**
- **Tool:** vite-plugin-imagemin
- **Config:** [vite.config.js](vite.config.js)
- **Asset Loader Update:** [src/utils/asset-manager.js](src/utils/asset-manager.js)

**Files to Create/Modify:**
- [vite.config.js](vite.config.js)
- [src/utils/asset-manager.js](src/utils/asset-manager.js)
- New: `scripts/optimize-assets.js`

---

#### 2.2 Lazy Loading & Code Splitting
**Current:** Appears to load all assets upfront
**Improvement:** Load assets on-demand

**Strategy:**

1. **Theme-Based Lazy Loading**
   - Currently: 45+ themes loaded at startup
   - **Optimize:** Load only active theme
   - **Location:** [src/themes/](src/themes/)
   - Dynamic imports: `const theme = await import(\`./themes/${themeName}\`)`

2. **Scene-Based Asset Loading**
   - Load multiplayer assets only when entering multiplayer mode
   - Load theme shaders on-demand
   - **Location:** Scene `preload()` methods

3. **Audio Lazy Loading**
   - Load music tracks when theme changes
   - Preload next theme in background
   - **Location:** [src/audio/music-loader.js](src/audio/music-loader.js)

4. **Code Splitting**
   - Split game modes into separate chunks
   - Split rendering engines (Canvas vs WebGL)
   - Use Vite's dynamic imports

**Implementation:**
```javascript
// Example: Dynamic theme loading
async loadTheme(themeName) {
  // Unload current theme assets
  this.unloadCurrentTheme();

  // Dynamically import theme module
  const themeModule = await import(`./themes/${themeName}/${themeName}-theme.js`);

  // Load theme assets
  await this.assetManager.preload(themeModule.assets);

  return themeModule.default;
}
```

**Files to Modify:**
- [src/themes/theme-manager.js](src/themes/theme-manager.js) (if exists)
- [src/audio/music-loader.js](src/audio/music-loader.js)
- [vite.config.js](vite.config.js)

---

### 🎯 Priority 3: Rendering Optimizations

#### 3.1 Canvas vs WebGL Testing (François's Key Finding)
**Current:** Phaser 4 WebGL-only rendering
**Improvement:** Test Canvas fallback for low-end devices

**François's Discovery:**
> "Switching from WebGL to Canvas boosted performance by 30% on older devices"

**Caveats for Your Game:**
- Phaser 4 is WebGL-only (unlike Phaser 3)
- Your custom WebGL renderer is highly optimized
- Testing needed to see if Canvas helps mobile

**Implementation Strategy:**

1. **Create Canvas Renderer Alternative**
   - Implement pure Canvas2D board renderer
   - Reuse existing Canvas renderer code: [src/rendering/canvas/](src/rendering/canvas/)
   - Make renderer swappable at runtime

2. **Quality Setting Integration**
   - Add "Canvas Mode" option in Low quality preset
   - Auto-detect slow devices (FPS < 30 for 5 seconds)
   - Prompt user to switch to Canvas mode

3. **A/B Testing**
   - Measure performance on various devices
   - Compare WebGL vs Canvas on mobile
   - Document findings

**Files to Modify:**
- [src/rendering/canvas/](src/rendering/canvas/) - Expand Canvas renderer
- [src/utils/quality.js](src/utils/quality.js) - Add Canvas mode setting
- [src/utils/performance-monitor.js](src/utils/performance-monitor.js) - Auto-detection

**Testing Devices:**
- iPhone 8/SE (older iOS devices)
- Android mid-range (Snapdragon 600 series)
- Desktop integrated graphics (Intel HD)

---

#### 3.2 Canvas Size Optimization
**Current:** Fixed block size (40px), canvas scaled via CSS
**Improvement:** Dynamically adjust canvas resolution based on quality

**Strategy:**

1. **Resolution Scaling**
   - Ultra: 1.0x (full resolution)
   - High: 1.0x
   - Medium: 0.75x (25% fewer pixels)
   - Low: 0.5x (75% fewer pixels!)

2. **Implementation:**
   ```javascript
   // src/utils/quality.js
   const QUALITY_SETTINGS = {
     low: { renderScale: 0.5, ... },
     medium: { renderScale: 0.75, ... },
     high: { renderScale: 1.0, ... },
     ultra: { renderScale: 1.0, ... }
   };
   ```

3. **Apply to:**
   - Phaser game canvas
   - WebGL background renderer
   - Particle systems

**Files to Modify:**
- [src/utils/quality.js](src/utils/quality.js)
- [src/rendering/renderer.js](src/rendering/renderer.js)
- Phaser game config initialization

---

#### 3.3 Particle System Optimization
**Current:** Particle pooling exists, but can be improved
**Improvement:** More aggressive particle reduction

**Actions:**

1. **Particle Budget Per Quality Level**
   ```javascript
   const PARTICLE_BUDGETS = {
     low: {
       maxParticles: 50,
       lineClears: 5,
       combos: 10,
       trails: 0  // Disable trails on Low
     },
     medium: {
       maxParticles: 150,
       lineClears: 15,
       combos: 30,
       trails: 20
     },
     high: {
       maxParticles: 300,
       lineClears: 30,
       combos: 60,
       trails: 50
     },
     ultra: {
       maxParticles: 600,
       lineClears: 60,
       combos: 120,
       trails: 100
     }
   };
   ```

2. **Particle Culling**
   - Kill off-screen particles immediately
   - Reduce particle lifetime on Low quality
   - Skip particle updates if invisible

3. **Simplify Particle Effects on Low**
   - Use simple circles instead of textured sprites
   - Disable particle rotation/scaling
   - Reduce blend modes (no ADD mode on Low)

**Files to Modify:**
- [src/rendering/phaser/board-scene.js](src/rendering/phaser/board-scene.js)
- [src/utils/quality.js](src/utils/quality.js)
- [src/utils/object-pool.js](src/utils/object-pool.js)

---

### 🎯 Priority 4: Code-Level Optimizations

#### 4.1 Array/Object Allocation Reduction
**Current:** Array pool exists but underutilized
**Improvement:** Reduce allocations in hot loops

**Critical Loops to Optimize:**

1. **Physics Gravity Application** - [src/core/physics.js](src/core/physics.js)
   ```javascript
   // Current: Creates new arrays every gravity step
   const connectedComponents = findConnectedComponents(lockedPieces);

   // Optimized: Reuse arrays
   this.gravityResultsPool = this.gravityResultsPool || [];
   this.gravityResultsPool.length = 0;
   findConnectedComponents(lockedPieces, this.gravityResultsPool);
   ```

2. **Board Grid Rebuilding** - [src/core/game.js](src/core/game.js)
   ```javascript
   // Current: Creates new 2D array each rebuild
   // Optimized: Reuse existing grid, clear cells
   ```

3. **Collision Detection**
   ```javascript
   // Avoid: shape.forEach((row, dy) => row.forEach((cell, dx) => ...))
   // Use: for loops with cached array.length
   ```

**Implementation:**
- Use `for` loops instead of `.forEach()` in hot paths
- Cache array lengths
- Reuse temporary arrays via ArrayPool
- Avoid object spread `{...obj}` in loops

**Files to Modify:**
- [src/core/physics.js](src/core/physics.js)
- [src/core/game.js](src/core/game.js)
- [src/utils/object-pool.js](src/utils/object-pool.js)

---

#### 4.2 Function Call Optimization
**Current:** Deep call stacks in physics
**Improvement:** Reduce function overhead

**Actions:**

1. **Inline Hot Functions**
   - Simple getters/setters in physics loop
   - Color lookups
   - Bounds checks

2. **Reduce Indirection**
   ```javascript
   // Before
   const state = this.getPlayerState(player);
   const opponent = this.getOpponentState(player);

   // After (in hot path)
   const state = player === 1 ? this.player1 : this.player2;
   const opponent = player === 1 ? this.player2 : this.player1;
   ```

3. **Batch Operations**
   - Process multiple pieces in single pass
   - Batch DOM updates (if any)

**Files to Modify:**
- [src/core/multiplayer.js](src/core/multiplayer.js)
- [src/core/physics.js](src/core/physics.js)

---

#### 4.3 Event System Optimization
**Current:** Event bus exists
**Improvement:** Reduce event overhead

**Actions:**

1. **Event Batching**
   - Batch rapid events (score updates, piece moves)
   - Flush batch at end of frame

2. **Selective Listeners**
   - Unsubscribe inactive listeners
   - Add listener priority/filtering

3. **Direct Callbacks for Critical Paths**
   - Physics callbacks (already done)
   - Use direct function calls instead of events for time-critical code

**Files to Modify:**
- [src/events/event-bus.js](src/events/event-bus.js)

---

### 🎯 Priority 5: Memory Optimization

#### 5.1 Enhanced Object Pooling
**Current:** Good pooling foundation
**Improvement:** Expand pools to cover more objects

**New Pools to Add:**

1. **Board Grid Cells Pool**
   ```javascript
   // Pool grid cell objects
   { color: string, id: string, alpha: number }
   ```

2. **Animation State Pool**
   - Piece animation objects
   - Cascade state objects

3. **Geometry Pool**
   - Temporary collision shapes
   - Grid coordinate pairs

**Files to Modify:**
- [src/utils/object-pool.js](src/utils/object-pool.js)
- [src/core/physics.js](src/core/physics.js)

---

#### 5.2 Memory Leak Prevention
**Current:** Basic cleanup exists
**Improvement:** Comprehensive leak detection

**Actions:**

1. **Add Memory Profiler**
   - Track object counts over time
   - Detect growing arrays/maps
   - Alert on memory leaks

2. **Cleanup Audit**
   - Verify all event listeners removed
   - Check particle systems destroyed
   - Ensure textures freed

3. **Weak References**
   - Use WeakMap for caches (already exists in [src/utils/weak-cache.js](src/utils/weak-cache.js))
   - Expand to more cache types

**Files to Modify:**
- [src/utils/performance-monitor.js](src/utils/performance-monitor.js)
- [src/utils/weak-cache.js](src/utils/weak-cache.js)

---

### 🎯 Priority 6: Theme-Specific Optimizations

#### 6.1 Shader Complexity Reduction
**Current:** Complex WebGL shaders
**Improvement:** Simplify shaders on Low quality

**Strategy:**

1. **Shader LOD (Level of Detail)**
   - Ultra: Full shader effects
   - High: Reduced samples
   - Medium: Simple shaders
   - Low: Solid colors (no shaders)

2. **Conditional Shader Features**
   ```javascript
   // Example: Nebula Flow shader
   if (quality === 'low') {
     // Use simple gradient instead of flow field
   } else if (quality === 'medium') {
     // Reduce octaves in noise function
   }
   ```

3. **Shader Compilation Cache**
   - Cache compiled shaders
   - Avoid recompiling on theme switch

**Files to Modify:**
- [src/rendering/renderer.js](src/rendering/renderer.js)
- Theme files with custom shaders

---

#### 6.2 Theme Particle Budget
**Current:** Each theme has particles
**Improvement:** Reduce particles per theme on Low

**Implementation:**
```javascript
// Theme config
export const theme = {
  particles: {
    ultra: { fireflies: 100, petals: 50 },
    high: { fireflies: 60, petals: 30 },
    medium: { fireflies: 30, petals: 15 },
    low: { fireflies: 10, petals: 5 }
  }
};
```

**Files to Modify:**
- All theme files in [src/themes/](src/themes/)
- [src/rendering/renderer.js](src/rendering/renderer.js)

---

## Implementation Roadmap

### Phase 1: Measurement & Infrastructure (Week 1)
- [ ] Enhance FPS counter with detailed metrics
- [ ] Add memory profiler
- [ ] Create performance testing suite
- [ ] Establish baseline metrics on test devices

**Expected Outcome:** Quantifiable performance data

---

### Phase 2: Quick Wins (Week 2)
- [ ] Implement reference caching in hot paths
- [ ] Add dirty flag checks to rendering loops
- [ ] Reduce background scene update rate to 30fps
- [ ] Optimize particle budgets per quality level
- [ ] Batch array operations in physics

**Expected Outcome:** 10-20% FPS improvement

---

### Phase 3: Asset Optimization (Week 3)
- [ ] Set up asset compression pipeline
- [ ] Convert images to WebP/AVIF
- [ ] Optimize audio formats
- [ ] Implement lazy loading for themes
- [ ] Code splitting for game modes

**Expected Outcome:** 40-60% faster load times, reduced memory

---

### Phase 4: Rendering Experiments (Week 4)
- [ ] Implement Canvas fallback renderer
- [ ] Add resolution scaling per quality level
- [ ] Test Canvas vs WebGL on mobile devices
- [ ] Optimize particle effects for Low quality
- [ ] Shader LOD system

**Expected Outcome:** 30-50% improvement on low-end devices

---

### Phase 5: Memory & Polish (Week 5)
- [ ] Expand object pooling coverage
- [ ] Memory leak detection and fixes
- [ ] Event system optimization
- [ ] Theme-specific optimizations
- [ ] Code profiling and micro-optimizations

**Expected Outcome:** Stable memory usage, no leaks

---

## Testing Strategy

### Target Devices

**High Priority:**
- iPhone SE (2020) - Representative older iOS
- Samsung Galaxy A52 - Mid-range Android
- Desktop with Intel HD Graphics - Integrated GPU

**Medium Priority:**
- iPad Air (2019)
- Google Pixel 6
- Desktop with dedicated GPU (baseline)

**Low Priority:**
- Latest flagship phones (iPhone 15, Galaxy S24)

### Performance Metrics

**Success Criteria:**

| Device Category | Target FPS | Load Time | Memory |
|----------------|-----------|-----------|--------|
| High-end Desktop | 144+ fps | <2s | <200MB |
| Mid-range Desktop | 60 fps | <3s | <300MB |
| High-end Mobile | 60 fps | <5s | <150MB |
| Mid-range Mobile | 30-60 fps | <8s | <100MB |
| Low-end Mobile | 30 fps | <10s | <80MB |

### Benchmark Scenarios

1. **Idle State:** Game paused, no animations
2. **Normal Gameplay:** Single piece falling, no cascades
3. **Heavy Cascade:** 8+ combo chain
4. **Multiplayer:** 2 players, both active
5. **Theme Transition:** Switching between complex themes

---

## Monitoring & Maintenance

### Performance Budget

Set thresholds and alerts:

```javascript
const PERFORMANCE_BUDGET = {
  maxFrameTime: 16.67, // 60fps
  maxMemory: 200 * 1024 * 1024, // 200MB
  maxLoadTime: 3000, // 3 seconds
  maxParticles: 500,
  maxDrawCalls: 100 // (if measurable)
};
```

### Continuous Monitoring

1. **CI/CD Integration**
   - Run performance tests on each commit
   - Block PRs that degrade performance >10%

2. **User Analytics** (if applicable)
   - Track average FPS
   - Device type distribution
   - Quality setting usage

3. **Regression Testing**
   - Automated performance benchmarks
   - Compare against baseline

---

## Quick Reference Checklist

### Before Optimizing Any Feature:
- [ ] Profile first (measure, don't guess)
- [ ] Identify bottleneck (CPU, GPU, memory, I/O)
- [ ] Check if it's in a hot path (>100 calls/second)
- [ ] Verify improvement with FPS counter
- [ ] Test on low-end device

### Code Review Performance Checklist:
- [ ] No object allocations in update loops
- [ ] Array lengths cached in for loops
- [ ] Event listeners cleaned up on destroy
- [ ] Textures/assets freed when unused
- [ ] Object pools used where appropriate
- [ ] Dirty flags prevent unnecessary work

---

## Expected Overall Results

Based on François's findings and the current state of Serenity Blocks:

### Conservative Estimate:
- **Desktop:** 5-10% FPS improvement
- **Mobile (mid-range):** 15-25% FPS improvement
- **Mobile (low-end):** 30-50% FPS improvement
- **Load Time:** 40-60% reduction
- **Memory Usage:** 20-30% reduction

### Aggressive Estimate (with Canvas mode on mobile):
- **Mobile (low-end):** Up to 100% FPS improvement (30fps → 60fps)

---

## Conclusion

Serenity Blocks already has a solid optimization foundation. The key opportunities are:

1. **Lazy loading themes** (biggest load time win)
2. **Selective loop processing** (dirty flags, conditional updates)
3. **Canvas fallback for mobile** (experimental, high reward)
4. **Asset compression** (easy win, big impact)
5. **Reference caching** (micro-optimizations that add up)

The phased approach allows for incremental improvements with measurable results at each stage. Start with Phase 1 (measurement) to establish baselines, then tackle quick wins in Phase 2 before larger refactors.

---

## Additional Resources

- François's Article: https://franzeus.medium.com/how-i-optimized-my-phaser-3-action-game-in-2025-5a648753f62b
- Phaser Performance Tips: https://gist.github.com/MarcL/748f29faecc6e3aa679a385bffbdf6fe
- Phaser 4 Documentation: https://phaser.io/phaser4
- WebGL Best Practices: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

---

**Document Version:** 1.0
**Last Updated:** 2025-11-09
**Author:** Claude (Performance Analysis Agent)
