# Phase 1 Quick Start Guide

## 🎯 Goal
Measure and diagnose performance issues in multiplayer mode to identify optimization targets.

---

## ⚡ Quick Start (5 minutes)

### 1. Start the Dev Server
```bash
npm run dev
```

### 2. Open Browser Console (F12)

### 3. Run Performance Test
```javascript
// Start monitoring with visual overlay
window.perfMonitor.start()

// Test 5-player mode (the problematic case)
window.testMultiplayer(5)

// Play for 1-2 minutes, try:
// - Hold right arrow for 5+ seconds
// - Rapid rotations
// - Move pieces continuously

// Get performance report
window.perfMonitor.report()
```

### 4. Check Results
Look at the overlay in the top-right corner:
- **FPS**: Should be 60, if < 55 → problem
- **Frame Time**: Should be ~16ms, if > 20ms → problem
- **Input Latency**: Should be < 30ms, if > 50ms → problem

---

## 📊 What You Should See

### Good Performance (Target)
```
FPS: 60.0 (avg: 59.8)
Frame: 16.2ms / 16.67ms
Update: 4.2ms
Render: 6.8ms
Input: 18.3ms
Drops: 0
```

### Current Problem (5-Player)
```
FPS: 48.3 (avg: 47.5) ⚠️
Frame: 23.5ms / 16.67ms ⚠️
Update: 12.1ms ⚠️
Render: 8.4ms
Input: 45.2ms ⚠️
Drops: 15 ⚠️
```

---

## 🔍 Quick Diagnosis

### If you see LOW FPS (< 55):
**Problem**: Frame budget exceeded
**Likely Cause**: Too much work per frame
**Next**: Check Update Time and Render Time

### If UPDATE TIME is HIGH (> 8ms):
**Problem**: Game logic bottleneck
**Likely Cause**: Collision detection or game state updates
**Fix Priority**: Phase 2 - Optimize collision detection

### If RENDER TIME is HIGH (> 10ms):
**Problem**: Rendering bottleneck
**Likely Cause**: Multiple scenes redrawing every frame
**Fix Priority**: Phase 2 - Add dirty flags

### If INPUT LATENCY is HIGH (> 50ms):
**Problem**: Input processing delay
**Likely Cause**: Synchronous input handling
**Fix Priority**: Phase 2 - Batch input processing

---

## 🛠️ Available Commands

```javascript
// Start monitoring
window.perfMonitor.start()

// Stop monitoring
window.perfMonitor.stop()

// Show/hide overlay
window.perfMonitor.show()
window.perfMonitor.hide()

// Get detailed report
window.perfMonitor.report()

// Export metrics to JSON
window.perfMonitor.export()

// Reset metrics
window.perfMonitor.reset()

// Get raw metrics object
window.perfMonitor.getMetrics()
```

---

## 📈 Chrome DevTools Profiling

### Quick Profile (30 seconds)
1. Open DevTools (F12) → **Performance** tab
2. Click record (⚫)
3. Start `window.testMultiplayer(5)`
4. Play for 30 seconds
5. Stop recording
6. Look for long frames (yellow/red bars)
7. Check "Bottom-Up" tab → Sort by "Total Time"
8. Note the top 3 slowest functions

---

## 🎯 What to Look For

### Critical Issues (Must Fix)
- ❌ FPS < 50 consistently
- ❌ Frame time > 25ms frequently
- ❌ Input latency > 70ms
- ❌ Tetromino stops when holding movement keys

### Performance Issues (Should Fix)
- ⚠️ FPS 50-55 (occasional drops)
- ⚠️ Frame time 20-25ms
- ⚠️ Input latency 50-70ms
- ⚠️ Occasional stuttering

### Acceptable (Monitor)
- ✅ FPS 55-60
- ✅ Frame time 16-20ms
- ✅ Input latency < 50ms
- ✅ Smooth movement

---

## 📝 Quick Test Checklist

- [ ] Run single-player test (baseline)
- [ ] Run 5-player test (problem case)
- [ ] Note FPS difference
- [ ] Note input latency difference
- [ ] Test holding right arrow for 5 seconds
- [ ] Does the piece stop moving? (Yes = Problem)
- [ ] Export metrics
- [ ] Take Chrome profile
- [ ] Note top 3 slow functions

---

## 🚀 Next Steps

After you complete the quick test:

1. **Fill out the results table** in [`PHASE_1_PERFORMANCE_TESTING_GUIDE.md`](PHASE_1_PERFORMANCE_TESTING_GUIDE.md)

2. **Identify the main bottleneck**:
   - Update time? → Game logic issue
   - Render time? → Graphics issue
   - Input latency? → Input system issue

3. **Ready for Phase 2?**
   - If bottleneck identified → Yes, proceed
   - If need more data → Run full Phase 1 tests

---

## 🐛 Troubleshooting

### Overlay not showing?
```javascript
window.perfMonitor.start()
window.perfMonitor.show()
```

### testMultiplayer not defined?
- Check if the function exists: `typeof window.testMultiplayer`
- You may need to implement or use a different multiplayer start method

### Performance seems normal?
- Try with more players: `window.testMultiplayer(8)`
- Play longer (2-3 minutes)
- Try rapid inputs and gameplay

---

## 💡 Pro Tips

1. **Disable browser extensions** during testing (they add overhead)
2. **Close other tabs** for accurate measurements
3. **Test in incognito mode** for clean environment
4. **Run multiple tests** and average results
5. **Compare before/after** when optimizing

---

## 📊 Example Report

```markdown
## My Phase 1 Results

**Setup**: Chrome 120, i7-9700K, RTX 3060
**Date**: 2025-10-22

### Single-Player
- FPS: 60 avg (60 min, 60 max)
- Frame Time: 16.3ms avg (16.7ms max)
- Input Latency: 12ms

### 5-Player
- FPS: 47 avg (42 min, 52 max) ⚠️
- Frame Time: 24.1ms avg (31.2ms max) ⚠️
- Input Latency: 58ms ⚠️

### Bottleneck Identified
**Primary**: High update time (11.5ms)
**Secondary**: Input latency spikes

### Top 3 Slow Functions (from profiler)
1. `isValidPosition` - 18.3% of frame time
2. `multiplayerGameLoop` - 14.2% of frame time
3. `syncMultiplayerBoardScenes` - 9.7% of frame time

### Recommendation
Proceed to Phase 2 with focus on:
1. Collision detection caching
2. Rendering optimization
3. Input batching
```

---

**Time to Complete**: ~10 minutes
**Output**: Performance baseline and bottleneck identification
**Next**: Phase 2 - Quick Wins Implementation

Ready to test? Run `npm run dev` and start profiling! 🚀
