# Phase 1: Performance Testing Guide

## Overview
This guide will help you measure and diagnose performance issues in multiplayer mode using the newly integrated performance monitoring system.

---

## Setup Complete ✅

The following has been implemented:

1. **Performance Monitor Module** ([`src/utils/performance-monitor.js`](src/utils/performance-monitor.js))
   - Tracks FPS, frame time, update time, render time, input latency
   - Memory usage monitoring
   - Real-time overlay display
   - Export metrics to JSON

2. **Integration Points**:
   - Game loop (single-player) - [`src/main.js:3122-3160`](src/main.js#L3122-L3160)
   - Multiplayer game loop - [`src/main.js:3165-3205`](src/main.js#L3165-L3205)
   - Input handling - [`src/ui/controls.js:115-248`](src/ui/controls.js#L115-L248)

3. **Debug Commands** (available in browser console):
   ```javascript
   window.perfMonitor.start()   // Start monitoring with overlay
   window.perfMonitor.stop()    // Stop monitoring
   window.perfMonitor.show()    // Show overlay
   window.perfMonitor.hide()    // Hide overlay
   window.perfMonitor.report()  // Generate detailed report
   window.perfMonitor.export()  // Export metrics to JSON file
   window.perfMonitor.reset()   // Reset all metrics
   ```

---

## Testing Procedure

### Test 1: Single-Player Baseline

**Purpose**: Establish baseline performance metrics for comparison

**Steps**:
1. Start the game in development mode:
   ```bash
   npm run dev
   ```

2. Open browser DevTools (F12)

3. Enable performance monitoring:
   ```javascript
   window.perfMonitor.start()
   ```

4. Start a single-player game

5. Play for 2 minutes, performing various actions:
   - Move pieces left/right continuously
   - Rotate pieces rapidly
   - Use hard drop frequently
   - Clear lines and progress through levels

6. Generate report:
   ```javascript
   const singlePlayerMetrics = window.perfMonitor.report()
   ```

7. Export metrics:
   ```javascript
   window.perfMonitor.export()  // Saves as performance-{timestamp}.json
   ```

8. **Record baseline metrics** in the table below

---

### Test 2: 2-Player Multiplayer

**Purpose**: Measure performance with minimal multiplayer overhead

**Steps**:
1. Reset metrics:
   ```javascript
   window.perfMonitor.reset()
   ```

2. Start 2-player game (if available) OR use test command:
   ```javascript
   // If testMultiplayer is available for 2 players
   window.testMultiplayer(2)
   ```

3. Play for 2 minutes with active gameplay

4. Generate report:
   ```javascript
   const twoPlayerMetrics = window.perfMonitor.report()
   ```

5. Export metrics:
   ```javascript
   window.perfMonitor.export()
   ```

6. **Record metrics** in the table below

---

### Test 3: 5-Player Multiplayer (Problem Case)

**Purpose**: Identify performance bottlenecks in 5-player mode

**Steps**:
1. Reset metrics:
   ```javascript
   window.perfMonitor.reset()
   ```

2. Start 5-player test:
   ```javascript
   window.testMultiplayer(5)
   ```

3. Play for 2 minutes, focusing on:
   - Holding movement keys (right arrow for 5+ seconds)
   - Observe any stuttering or stops
   - Try rapid rotations
   - Monitor the performance overlay

4. Generate detailed report:
   ```javascript
   const fivePlayerMetrics = window.perfMonitor.report()
   console.log('5-Player Metrics:', fivePlayerMetrics)
   ```

5. Export metrics:
   ```javascript
   window.perfMonitor.export()
   ```

6. **Record metrics** in the table below

---

### Test 4: 8-Player Stress Test

**Purpose**: Test worst-case scenario

**Steps**:
1. Reset metrics:
   ```javascript
   window.perfMonitor.reset()
   ```

2. Start 8-player test:
   ```javascript
   window.testMultiplayer(8)
   ```

3. Play for 2 minutes

4. Generate report and export:
   ```javascript
   const eightPlayerMetrics = window.perfMonitor.report()
   window.perfMonitor.export()
   ```

5. **Record metrics** in the table below

---

## Results Table

Fill in this table after completing each test:

| Metric | Single-Player | 2-Player | 5-Player | 8-Player | Target |
|--------|---------------|----------|----------|----------|--------|
| **Average FPS** | | | | | ≥ 58 |
| **Min FPS** | | | | | ≥ 45 |
| **Avg Frame Time (ms)** | | | | | ≤ 16.67 |
| **Max Frame Time (ms)** | | | | | ≤ 25 |
| **Update Time (ms)** | | | | | ≤ 5 |
| **Render Time (ms)** | | | | | ≤ 8 |
| **Input Latency (ms)** | | | | | ≤ 50 |
| **Frame Drops/min** | | | | | < 10 |
| **Memory Usage (MB)** | | | | | Stable |

### Example (fill with your actual results):
```
Single-Player: FPS: 60 avg, Frame: 16.2ms, Input: 12ms
5-Player:      FPS: 48 avg, Frame: 23.8ms, Input: 45ms ⚠️
```

---

## Chrome DevTools Performance Profiling

### Recording a Profile

1. Open Chrome DevTools (F12)
2. Go to the **Performance** tab
3. Click the record button (⚫)
4. Start your test (e.g., `window.testMultiplayer(5)`)
5. Play for 30-60 seconds
6. Stop recording

### What to Look For

**1. Frame Rate (FPS Chart)**
- Look for yellow/red bars (long frames)
- Identify patterns: Do drops happen during specific actions?

**2. Main Thread Activity**
- Long yellow bars = JavaScript execution
- Look for:
  - `gameLoop` / `multiplayerGameLoop` duration
  - `update` calls from Phaser scenes
  - Input event handlers
  - Rendering calls

**3. Bottom-Up Tab**
- Sort by "Total Time"
- Identify top 5 slowest functions
- Look for:
  - Repeated expensive operations
  - Unnecessary loops
  - Collision detection calls

**4. Call Tree Tab**
- Shows hierarchical execution
- Find which parent function triggers slow child functions

**5. Event Log Tab**
- Filter by category (Input, Rendering, Painting)
- Look for event spam or expensive events

---

## Memory Profiling

### Take Heap Snapshots

1. Go to **Memory** tab in DevTools
2. Select "Heap snapshot"
3. Click "Take snapshot" at game start
4. Play for 2 minutes
5. Take another snapshot
6. Compare snapshots

### What to Look For

- **Retained Size Growth**: Should be stable
- **Detached DOM Nodes**: Memory leaks
- **Array/Object Growth**: Check if collections grow unbounded
- **Event Listener Count**: Should not increase over time

---

## Analysis Checklist

After completing all tests, analyze the data:

### Performance Degradation Analysis
- [ ] Calculate FPS drop: `(Single FPS - Multiplayer FPS) / Single FPS * 100%`
- [ ] Identify if degradation is linear with player count
- [ ] Check if frame time exceeds budget (16.67ms) consistently

### Bottleneck Identification
- [ ] **Update Time > 8ms?** → Game logic bottleneck
- [ ] **Render Time > 10ms?** → Rendering bottleneck
- [ ] **Input Latency > 50ms?** → Input processing issue
- [ ] **Frame Drops > 20/min?** → General performance problem

### Memory Issues
- [ ] Memory grows continuously? → Memory leak
- [ ] Memory spikes periodically? → Garbage collection pressure
- [ ] Memory stable but high? → High but acceptable

---

## Diagnostic Questions

Answer these questions based on your testing:

### 1. Frame Rate Pattern
- **Question**: Does FPS drop consistently or in spikes?
- **Answer**: _[Your observation]_

### 2. Input Responsiveness
- **Question**: When holding the right arrow, how often does the piece stop moving?
- **Answer**: _[Your observation]_

### 3. Rendering Performance
- **Question**: Is render time higher in multiplayer than single-player?
- **Answer**: _[Your observation]_

### 4. Update Time
- **Question**: How does update time scale with player count?
- **Answer**: _[Your observation]_

### 5. Chrome DevTools Findings
- **Question**: What are the top 3 slowest functions in the profiler?
- **Answer**:
  1. _[Function name and time]_
  2. _[Function name and time]_
  3. _[Function name and time]_

### 6. Memory Behavior
- **Question**: Does memory usage grow over time?
- **Answer**: _[Your observation]_

---

## Expected Bottlenecks (Hypotheses)

Based on the architecture, here are the most likely bottlenecks:

### Hypothesis 1: Rendering Overhead
**Symptom**: High render time in multiplayer
**Cause**: Multiple Phaser scenes rendering every frame
**File**: [`src/rendering/phaser/base-board-scene.js:115-127`](src/rendering/phaser/base-board-scene.js#L115-L127)
**Test**: Compare render time single vs multiplayer

### Hypothesis 2: Collision Detection
**Symptom**: High update time
**Cause**: `isValidPosition()` called repeatedly for each player
**File**: [`src/rendering/phaser/base-board-scene.js:589-617`](src/rendering/phaser/base-board-scene.js#L589-L617)
**Test**: Profile `isValidPosition` call count

### Hypothesis 3: Game Loop Contention
**Symptom**: Inconsistent frame times
**Cause**: Multiple game loops running independently
**File**: [`src/main.js:3165-3205`](src/main.js#L3165-L3205)
**Test**: Check if frame times are erratic

### Hypothesis 4: Input Processing Delay
**Symptom**: High input latency
**Cause**: Input events processed synchronously
**File**: [`src/ui/controls.js:115-248`](src/ui/controls.js#L115-L248)
**Test**: Measure time between keydown and action

### Hypothesis 5: Graphics Operations
**Symptom**: High render time
**Cause**: Excessive `clear()` and `draw()` calls
**File**: [`src/rendering/phaser/base-board-scene.js:120-123`](src/rendering/phaser/base-board-scene.js#L120-L123)
**Test**: Count draw calls per frame

---

## Next Steps After Testing

Once you complete Phase 1 testing, determine priority:

### If FPS < 50 in 5-player mode:
→ **Priority 1**: Implement rendering optimizations (dirty flags)

### If Update Time > 8ms:
→ **Priority 1**: Optimize collision detection (caching)

### If Input Latency > 50ms:
→ **Priority 1**: Batch input processing

### If Render Time > 10ms:
→ **Priority 2**: Throttle non-critical rendering

### If Memory grows continuously:
→ **Priority 2**: Add object pooling

---

## Reporting Your Findings

After completing all tests, create a summary:

```markdown
## Phase 1 Results Summary

**Test Date**: [Date]
**Browser**: Chrome/Firefox/etc
**Hardware**: [CPU, GPU, RAM]

### Key Findings:
1. **Primary Bottleneck**: [Rendering/Update/Input/Memory]
2. **FPS Degradation**: [X%] drop from single to 5-player
3. **Input Latency**: [Acceptable/Too High/Inconsistent]
4. **Memory Behavior**: [Stable/Leaking/High GC]

### Top 3 Performance Issues:
1. [Issue description] - Impact: [High/Medium/Low]
2. [Issue description] - Impact: [High/Medium/Low]
3. [Issue description] - Impact: [High/Medium/Low]

### Recommended Optimizations (Priority Order):
1. [Optimization name] - Expected improvement: [X%]
2. [Optimization name] - Expected improvement: [X%]
3. [Optimization name] - Expected improvement: [X%]

### Proceed to Phase 2?
[Yes/No] - Rationale: [Brief explanation]
```

---

## Troubleshooting

### Performance overlay not showing
```javascript
// Ensure it's enabled and visible
window.perfMonitor.start()
window.perfMonitor.show()
```

### Metrics seem inaccurate
```javascript
// Reset and restart monitoring
window.perfMonitor.stop()
window.perfMonitor.reset()
window.perfMonitor.start()
```

### Can't export metrics
- Check browser console for errors
- Ensure pop-ups are not blocked
- Try `window.perfMonitor.getMetrics()` to view in console

### Chrome DevTools profiler impact
- The profiler itself adds overhead (~5-10%)
- Take note of baseline FPS with profiler OFF
- Compare profiler results relatively, not absolutely

---

## Support Files

After testing, you'll have:
- `performance-{timestamp}.json` files (one per test)
- Chrome DevTools profiles (`.json` files)
- Screenshots of performance overlay
- Notes on observed behavior

Keep these for Phase 2 implementation!

---

**Phase 1 Complete When**:
- ✅ All 4 tests completed
- ✅ Metrics table filled out
- ✅ Chrome DevTools profiles captured
- ✅ Top 3 bottlenecks identified
- ✅ Summary report written

**Ready to proceed to Phase 2**: Quick Wins Implementation 🚀
