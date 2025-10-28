# Multiplayer Performance Optimization Plan

## Executive Summary

The FFA multiplayer mode (tested with `window.testMultiplayer(5)`) currently exhibits performance issues compared to single-player mode. While all functionality works correctly, the gameplay experience is not as smooth—specifically, tetrominos occasionally stop when holding movement keys.

This document outlines a comprehensive plan to diagnose and optimize multiplayer performance to match the smoothness of single-player mode.

---

## Problem Statement

### Current State
- **Single-player**: Smooth, responsive, feels exactly like Tetris should
- **Multiplayer (5 players)**: Functional but occasionally laggy
  - Tetrominos occasionally stop when holding move buttons
  - Overall responsiveness is degraded
  - All features work correctly, but the "feel" is off

### Root Causes (Hypotheses)
1. **Rendering overhead**: Multiple Phaser scenes rendering simultaneously
2. **Input processing delays**: Input system may not scale well with multiple game states
3. **Game loop inefficiencies**: Multiple independent game loops competing for resources
4. **Physics/collision detection**: Redundant calculations across multiple boards
5. **Memory pressure**: Potential garbage collection pauses
6. **Event system overhead**: Too many event listeners or inefficient event propagation

---

## Investigation Phase

### 1. Performance Profiling Setup

#### Tools to Use
- **Chrome DevTools Performance Profiler**
  - Record during single-player vs 5-player multiplayer
  - Identify frame drops and long tasks
  - Analyze JavaScript execution time

- **Phaser Debug Stats**
  - Enable FPS counter
  - Monitor draw calls
  - Track memory usage

- **Custom Timing Instrumentation**
  - Add performance markers to critical paths:
    - Game loop iterations
    - Input processing
    - Rendering updates
    - Physics calculations

#### Metrics to Track
```javascript
// Add to main.js for performance monitoring
const perfMetrics = {
  frameTime: [],
  inputLatency: [],
  renderTime: [],
  updateTime: [],
  gcPauses: []
};

// Track frame budget (60fps = 16.67ms per frame)
const FRAME_BUDGET_MS = 16.67;
```

### 2. Bottleneck Identification

#### A. Rendering Performance
**Hypothesis**: Multiple Phaser scenes are causing rendering bottlenecks

**Investigation Steps**:
1. Profile draw calls per frame in multiplayer
2. Check if scenes are unnecessarily re-rendering static content
3. Verify that only visible boards are being updated
4. Measure time spent in `BaseBoardScene.update()` per scene

**Files to Investigate**:
- [`src/rendering/phaser/base-board-scene.js`](src/rendering/phaser/base-board-scene.js) (lines 115-127)
- [`src/rendering/phaser/board-scene.js`](src/rendering/phaser/board-scene.js)
- [`src/rendering/phaser/multiplayer/board-panel.js`](src/rendering/phaser/multiplayer/board-panel.js)

**Optimization Opportunities**:
```javascript
// Option 1: Throttle update rate for opponent boards
update(time, delta) {
  // Only update at 30fps for opponent boards (not focused)
  if (!this.isFocused && time - this.lastUpdate < 33) {
    return;
  }
  // ... existing update logic
}

// Option 2: Batch draw operations
// Instead of clearing and redrawing every frame, use dirty flags
if (this.isDirty) {
  this.renderGameState();
  this.isDirty = false;
}
```

#### B. Input Processing
**Hypothesis**: Input handling doesn't scale well with multiple game states

**Investigation Steps**:
1. Measure input-to-action latency in single vs multiplayer
2. Check if DAS (Delayed Auto Shift) timers are interfering
3. Verify input events aren't being processed multiple times
4. Profile time spent in keyboard event handlers

**Files to Investigate**:
- [`src/ui/controls.js`](src/ui/controls.js) (lines 114-150)
- Input routing in multiplayer context

**Optimization Opportunities**:
```javascript
// Use requestAnimationFrame for smoother input processing
class InputController {
  constructor() {
    this.pendingInputs = [];
    this.processingRAF = null;
  }

  scheduleInput(action) {
    this.pendingInputs.push(action);
    if (!this.processingRAF) {
      this.processingRAF = requestAnimationFrame(() => {
        this.processPendingInputs();
        this.processingRAF = null;
      });
    }
  }
}
```

#### C. Game Loop Efficiency
**Hypothesis**: Multiple game loops running independently causes resource contention

**Investigation Steps**:
1. Profile CPU usage during multiplayer
2. Check if game loops are synchronized or competing
3. Measure time spent in `gameLoop()` across all players
4. Identify redundant calculations (e.g., timestamp calculations)

**Files to Investigate**:
- [`src/core/game.js`](src/core/game.js) (lines 401-445)
- [`src/core/multiplayer.js`](src/core/multiplayer.js)

**Optimization Opportunities**:
```javascript
// Unified game loop for multiplayer
class MultiplayerGameLoop {
  update(time, delta) {
    // Single timestamp calculation
    const now = performance.now();

    // Batch update all players
    this.players.forEach(player => {
      this.updatePlayer(player, now, delta);
    });

    // Single render pass
    this.renderAll();
  }
}
```

#### D. Physics and Collision Detection
**Hypothesis**: Collision detection across multiple boards is inefficient

**Investigation Steps**:
1. Profile time spent in `isValidPosition()` calls
2. Check if ghost piece calculations are optimized
3. Measure physics processing time per player

**Files to Investigate**:
- [`src/rendering/phaser/base-board-scene.js`](src/rendering/phaser/base-board-scene.js) (lines 589-617)
- Physics processing in multiplayer

**Optimization Opportunities**:
```javascript
// Cache collision checks
class CollisionCache {
  constructor() {
    this.cache = new Map();
  }

  isValidPosition(piece, x, y, lockedPieces) {
    const key = `${piece.shapeKey}-${x}-${y}-${lockedPieces.length}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const result = this._calculateCollision(piece, x, y, lockedPieces);
    this.cache.set(key, result);
    return result;
  }
}
```

#### E. Memory Management
**Hypothesis**: Frequent garbage collection causes frame drops

**Investigation Steps**:
1. Use Chrome Memory Profiler to detect GC pauses
2. Identify object allocation hotspots
3. Check for memory leaks in multiplayer
4. Monitor heap size over extended gameplay

**Optimization Opportunities**:
```javascript
// Object pooling for frequently created objects
class PiecePool {
  constructor(size = 100) {
    this.pool = [];
    this.active = [];
    for (let i = 0; i < size; i++) {
      this.pool.push(this.createPiece());
    }
  }

  acquire() {
    return this.pool.pop() || this.createPiece();
  }

  release(piece) {
    this.pool.push(piece);
  }
}
```

---

## Optimization Strategies

### Priority 1: Critical Performance Fixes

#### 1.1 Optimize Rendering Loop
**Target**: Reduce redundant draw calls

```javascript
// base-board-scene.js
update(time, delta) {
  if (!this.gameState) return;

  // Only render if game state changed (dirty flag)
  if (!this.isDirty && !this.hasActiveAnimations()) {
    return;
  }

  try {
    this.pieceGraphics?.clear();
    this.effectsGraphics?.clear();
    this.renderGameState();
    this.isDirty = false;
  } catch (error) {
    console.error('[BaseBoardScene] Error in update loop:', error);
  }
}

// Mark scene as dirty when state changes
syncFromGameState(gameState) {
  this.gameState = gameState;
  this.isDirty = true; // Flag for re-render
}
```

#### 1.2 Batch Input Processing
**Target**: Reduce input latency spikes

```javascript
// controls.js - Implement input batching
class InputController {
  constructor() {
    // ... existing properties
    this.inputQueue = [];
    this.inputRAF = null;
  }

  queueInput(action) {
    this.inputQueue.push(action);

    if (!this.inputRAF) {
      this.inputRAF = requestAnimationFrame(() => {
        this.flushInputQueue();
        this.inputRAF = null;
      });
    }
  }

  flushInputQueue() {
    // Process all pending inputs in a single frame
    while (this.inputQueue.length > 0) {
      const action = this.inputQueue.shift();
      this.processInput(action);
    }
  }
}
```

#### 1.3 Throttle Non-Critical Updates
**Target**: Reduce CPU usage on background boards

```javascript
// multiplayer/board-panel.js
class MultiplayerBoardScene extends BoardScene {
  constructor(key, config) {
    super(key, config);
    this.isFocused = false;
    this.lastUpdate = 0;
    this.updateRate = 33; // 30fps for background boards
  }

  update(time, delta) {
    // Active player: 60fps, opponents: 30fps
    const updateInterval = this.isFocused ? 16 : this.updateRate;

    if (time - this.lastUpdate < updateInterval) {
      return;
    }

    this.lastUpdate = time;
    super.update(time, delta);
  }
}
```

### Priority 2: Architecture Improvements

#### 2.1 Unified Multiplayer Game Loop
**Target**: Eliminate redundant calculations

```javascript
// Create new file: src/core/multiplayer/unified-game-loop.js
export class UnifiedMultiplayerLoop {
  constructor(players) {
    this.players = players;
    this.lastTime = performance.now();
  }

  update() {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;

    // Single timestamp calculation for all players
    this.players.forEach(player => {
      if (player.isActive && !player.isPaused) {
        this.updatePlayerLogic(player, now, delta);
      }
    });

    requestAnimationFrame(() => this.update());
  }

  updatePlayerLogic(player, time, delta) {
    // Auto-drop logic
    if (!player.isProcessingPhysics && player.currentPiece) {
      player.dropCounter += delta;
      if (player.dropCounter > player.dropInterval) {
        this.softDrop(player);
      }
    }
  }
}
```

#### 2.2 Implement Object Pooling
**Target**: Reduce GC pressure

```javascript
// Create new file: src/utils/object-pool.js
export class ObjectPool {
  constructor(factory, resetFn, initialSize = 50) {
    this.factory = factory;
    this.resetFn = resetFn;
    this.pool = [];
    this.active = new Set();

    // Pre-allocate objects
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  acquire() {
    let obj;
    if (this.pool.length > 0) {
      obj = this.pool.pop();
    } else {
      obj = this.factory();
    }
    this.active.add(obj);
    return obj;
  }

  release(obj) {
    if (this.active.has(obj)) {
      this.active.delete(obj);
      this.resetFn(obj);
      this.pool.push(obj);
    }
  }
}

// Usage in pieces.js
const piecePool = new ObjectPool(
  () => ({ shape: null, x: 0, y: 0, color: null }),
  (piece) => {
    piece.shape = null;
    piece.x = 0;
    piece.y = 0;
    piece.color = null;
  },
  100
);
```

#### 2.3 Optimize Collision Detection
**Target**: Cache collision checks

```javascript
// Add to base-board-scene.js
class CollisionCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (simple FIFO)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

// Use in isValidPosition
isValidPosition(checkX, checkY, shape) {
  const cacheKey = `${checkX}-${checkY}-${shape.length}-${this.gameState?.lockedPieces.length}`;

  if (this.collisionCache.has(cacheKey)) {
    return this.collisionCache.get(cacheKey);
  }

  const result = this._checkCollision(checkX, checkY, shape);
  this.collisionCache.set(cacheKey, result);
  return result;
}
```

### Priority 3: Fine-Tuning

#### 3.1 Graphics Optimization
```javascript
// Reduce graphics clear operations
update(time, delta) {
  // Only clear if something changed
  if (this.isDirty) {
    this.pieceGraphics?.clear();
    this.effectsGraphics?.clear();
  }

  // Only redraw changed layers
  if (this.boardDirty) {
    this.drawGrid();
    this.drawLockedPieces();
    this.boardDirty = false;
  }

  if (this.pieceDirty) {
    this.drawGhostPiece();
    this.drawCurrentPiece();
    this.pieceDirty = false;
  }
}
```

#### 3.2 Event System Optimization
```javascript
// Debounce non-critical events
import { debounce } from './utils/helpers.js';

const debouncedResize = debounce((width, height) => {
  this.resize(width, height);
}, 100);

// Use event delegation instead of multiple listeners
eventBus.on(EVENTS.GAME_STATE_CHANGED, (data) => {
  // Single listener handles all players
  if (data.playerId === this.playerId) {
    this.updateGameState(data.state);
  }
});
```

---

## Implementation Roadmap

### Phase 1: Measurement & Diagnosis (1-2 hours)
1. ✅ Set up performance profiling tools
2. ✅ Record baseline metrics (single-player vs multiplayer)
3. ✅ Identify top 3 bottlenecks
4. ✅ Document findings

**Deliverables**:
- Performance profile screenshots
- Bottleneck analysis report
- Prioritized optimization list

### Phase 2: Quick Wins (2-3 hours)
1. ✅ Implement dirty flags for rendering
2. ✅ Throttle opponent board updates to 30fps
3. ✅ Batch input processing
4. ✅ Add collision caching

**Success Criteria**:
- 20-30% improvement in frame time
- Reduced input latency spikes
- Smoother tetromino movement

### Phase 3: Architecture Improvements (3-4 hours)
1. ✅ Implement unified multiplayer game loop
2. ✅ Add object pooling for pieces
3. ✅ Optimize physics calculations
4. ✅ Refactor event system

**Success Criteria**:
- 40-50% improvement in overall performance
- Consistent 60fps in 5-player mode
- No GC pauses during gameplay

### Phase 4: Polish & Testing (2-3 hours)
1. ✅ Fine-tune update rates
2. ✅ Add performance monitoring UI
3. ✅ Test with 8+ players
4. ✅ Profile on lower-end hardware

**Success Criteria**:
- Multiplayer feels as smooth as single-player
- No visible stuttering or lag
- Scales to 8 players smoothly

---

## Testing Strategy

### Performance Benchmarks

#### Baseline (Before Optimization)
```javascript
// Run these tests to establish baseline
window.testMultiplayer(1); // Single player control
window.testMultiplayer(2); // 2 players
window.testMultiplayer(5); // 5 players (current problem case)
window.testMultiplayer(8); // Stress test

// Measure:
// - Average frame time
// - Input latency (keypress to action)
// - Memory usage over 5 minutes
// - Frame drops per minute
```

#### Target Metrics (After Optimization)
- **Frame Time**: < 16ms (60fps) consistently
- **Input Latency**: < 50ms (keypress to visual response)
- **Memory**: Stable heap size (no leaks)
- **Frame Drops**: < 1 per minute
- **5-Player Mode**: Feels identical to single-player

### Test Cases
1. **Movement Responsiveness**
   - Hold right arrow for 5 seconds
   - Verify tetromino moves smoothly without stops
   - Test in both single-player and 5-player mode

2. **Rotation Smoothness**
   - Rapid rotation inputs (spam Z/X keys)
   - Verify no input drops or delays

3. **Extended Gameplay**
   - Play for 10 minutes in 5-player mode
   - Monitor for performance degradation
   - Check for memory leaks

4. **Stress Test**
   - 8-player mode with all players active
   - Measure worst-case performance
   - Ensure no crashes or freezes

---

## Monitoring & Metrics

### Performance Dashboard (to be implemented)
```javascript
// Add to main.js for real-time monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      fps: 0,
      frameTime: 0,
      updateTime: 0,
      renderTime: 0,
      inputLatency: 0,
      memoryUsed: 0
    };
    this.samples = [];
    this.maxSamples = 60; // 1 second at 60fps
  }

  update() {
    // Collect metrics every frame
    const fps = this.calculateFPS();
    this.metrics.fps = fps;

    // Show warning if performance degrades
    if (fps < 50) {
      console.warn('[Performance] FPS dropped to', fps);
    }
  }

  render() {
    // Optional: Render stats overlay
    // FPS: 60 | Frame: 12ms | Input: 8ms
  }
}
```

### Debug Commands
```javascript
// Add to window for debugging
window.perfMonitor = {
  start: () => monitor.enable(),
  stop: () => monitor.disable(),
  report: () => monitor.generateReport(),
  reset: () => monitor.clearMetrics()
};

// Usage:
// window.perfMonitor.start()
// ... play for a while ...
// window.perfMonitor.report()
```

---

## Risk Mitigation

### Potential Issues

1. **Over-optimization**
   - Risk: Breaking existing functionality
   - Mitigation: Extensive testing after each change
   - Rollback plan: Git branches for each optimization

2. **Platform-specific issues**
   - Risk: Optimizations work on dev machine but not elsewhere
   - Mitigation: Test on multiple devices/browsers
   - Monitor: Performance varies by hardware

3. **Regression in single-player**
   - Risk: Optimizing multiplayer degrades single-player
   - Mitigation: Maintain separate code paths if needed
   - Test: Run single-player benchmarks after each change

---

## Success Criteria

### Definition of Done
- ✅ 5-player multiplayer runs at consistent 60fps
- ✅ No input lag when holding movement keys
- ✅ Tetrominos move smoothly without stuttering
- ✅ Performance matches single-player feel
- ✅ No memory leaks during extended play
- ✅ Scales to 8 players without major degradation

### Acceptance Test
```javascript
// Final validation test
async function validatePerformanceOptimization() {
  console.log('Starting performance validation...');

  // Test 1: 5-player smoothness
  window.testMultiplayer(5);
  await playAndMeasure(60000); // 1 minute

  const metrics = performanceMonitor.getMetrics();

  assert(metrics.avgFPS >= 58, 'FPS should be >= 58');
  assert(metrics.maxInputLatency < 50, 'Input latency should be < 50ms');
  assert(metrics.frameDrops < 10, 'Should have < 10 frame drops per minute');

  console.log('✅ Performance optimization validated!');
}
```

---

## Next Steps

1. **Review this plan** with the team
2. **Set up profiling tools** (Chrome DevTools, custom metrics)
3. **Run baseline tests** (establish current performance metrics)
4. **Begin Phase 1** (Measurement & Diagnosis)
5. **Iterate and refine** based on findings

---

## Related Documentation

- [FFA Multiplayer Implementation](docs/FFA_MULTIPLAYER_IMPLEMENTATION.md)
- [Phaser 4 Migration Guide](docs/PHASE_1_IMPLEMENTATION_COMPLETE.md)
- [Game Architecture Overview](docs/PHASES_1_AND_2_REVIEW.md)

---

## Appendix

### Useful Profiling Commands
```javascript
// Chrome DevTools Performance API
performance.mark('game-loop-start');
// ... game loop code ...
performance.mark('game-loop-end');
performance.measure('game-loop', 'game-loop-start', 'game-loop-end');

// Get all measurements
const measures = performance.getEntriesByType('measure');
console.table(measures.map(m => ({
  name: m.name,
  duration: m.duration.toFixed(2) + 'ms'
})));
```

### Performance Optimization Checklist
- [ ] Profiled single-player baseline
- [ ] Profiled 5-player multiplayer
- [ ] Identified top 3 bottlenecks
- [ ] Implemented dirty flag rendering
- [ ] Throttled opponent board updates
- [ ] Batched input processing
- [ ] Added collision caching
- [ ] Implemented unified game loop
- [ ] Added object pooling
- [ ] Optimized event system
- [ ] Tested with 8 players
- [ ] Validated no regressions in single-player
- [ ] Achieved 60fps in 5-player mode
- [ ] Documented findings and metrics

---

**Last Updated**: 2025-10-22
**Status**: Ready for Implementation
**Owner**: Development Team
