# Performance Monitoring Quick Reference

## 🚀 Quick Commands

```javascript
// START MONITORING (shows overlay)
window.perfMonitor.start()

// STOP MONITORING
window.perfMonitor.stop()

// GET REPORT (detailed metrics)
window.perfMonitor.report()

// EXPORT TO FILE (for analysis)
window.perfMonitor.export()

// RESET METRICS (start fresh)
window.perfMonitor.reset()
```

---

## 📊 Performance Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| **FPS** | ≥ 58 | < 55 | < 50 |
| **Frame Time** | ≤ 16.67ms | > 20ms | > 25ms |
| **Update Time** | ≤ 8ms | > 10ms | > 12ms |
| **Render Time** | ≤ 8ms | > 10ms | > 15ms |
| **Input Latency** | ≤ 30ms | > 50ms | > 70ms |

---

## 🔍 Quick Diagnosis

### Symptom → Likely Cause → Fix

| If you see... | Problem is... | Priority Fix |
|---------------|---------------|--------------|
| **FPS < 50** | Overall performance | Start with highest time |
| **Update Time > 10ms** | Game logic | Collision caching |
| **Render Time > 10ms** | Graphics | Dirty flags |
| **Input Latency > 50ms** | Input system | Input batching |
| **Frame Drops > 20/min** | Inconsistent perf | Multiple issues |

---

## 🧪 Standard Test Procedure

```javascript
// 1. Start monitoring
window.perfMonitor.start()

// 2. Run test
window.testMultiplayer(5)  // or start single-player

// 3. Play for 2 minutes
// Try: Hold right arrow, rapid rotations, clear lines

// 4. Get results
window.perfMonitor.report()

// 5. Export data
window.perfMonitor.export()
```

---

## 📈 Interpreting the Overlay

```
┌─────────────────────────────┐
│ Performance Monitor         │
│ FPS: 48.3 (avg: 47.5) ⚠️   │  ← Red if < 50
│ Frame: 23.5ms / 16.67ms ⚠️ │  ← Red if > 20ms
│ Update: 12.1ms              │
│ Render: 8.4ms               │
│ Input: 45.2ms ⚠️            │  ← Yellow if > 50ms
│ Drops: 15                   │
│ Memory: 145.23MB            │
└─────────────────────────────┘
```

**Colors**:
- 🟢 Green = Good
- 🟡 Yellow = Warning
- 🔴 Red = Critical

---

## 🎯 Testing Checklist

### Quick Test (5 min)
- [ ] Run `window.perfMonitor.start()`
- [ ] Test 5-player mode
- [ ] Note FPS and frame time
- [ ] Export metrics

### Full Test (30 min)
- [ ] Test single-player (baseline)
- [ ] Test 2-player
- [ ] Test 5-player (problem case)
- [ ] Test 8-player (stress)
- [ ] Chrome DevTools profile
- [ ] Export all metrics
- [ ] Fill results table

---

## 🐛 Common Issues

### "window.perfMonitor is undefined"
**Fix**: Refresh page, wait for load

### Overlay not visible
```javascript
window.perfMonitor.show()
```

### Metrics seem wrong
```javascript
window.perfMonitor.stop()
window.perfMonitor.reset()
window.perfMonitor.start()
```

### Can't export file
- Check pop-up blocker
- Try `window.perfMonitor.getMetrics()` instead

---

## 📁 Documentation

- **Master Plan**: [`MULTIPLAYER_PERFORMANCE_OPTIMIZATION_PLAN.md`](MULTIPLAYER_PERFORMANCE_OPTIMIZATION_PLAN.md)
- **Full Testing Guide**: [`PHASE_1_PERFORMANCE_TESTING_GUIDE.md`](PHASE_1_PERFORMANCE_TESTING_GUIDE.md)
- **Quick Start**: [`PHASE_1_QUICK_START.md`](PHASE_1_QUICK_START.md)
- **Implementation Summary**: [`PHASE_1_COMPLETE_SUMMARY.md`](PHASE_1_COMPLETE_SUMMARY.md)

---

## 💡 Tips

1. **Always baseline** - Test single-player first
2. **Run multiple tests** - Average 3+ runs
3. **Close other tabs** - Reduce interference
4. **Use incognito** - Clean environment
5. **Note hardware** - Results vary by machine

---

## 🎓 Understanding Results

### Example Good Performance
```
Single-Player:
  FPS: 60 avg, Frame: 16.2ms, Input: 12ms ✅

5-Player:
  FPS: 58 avg, Frame: 17.8ms, Input: 25ms ✅

Verdict: Excellent! No optimization needed.
```

### Example Poor Performance
```
Single-Player:
  FPS: 60 avg, Frame: 16.3ms, Input: 13ms ✅

5-Player:
  FPS: 47 avg, Frame: 24.1ms, Input: 58ms ⚠️

Verdict: Needs optimization!
- FPS drop: 22% ❌
- Frame time: +48% ❌
- Input latency: +346% ❌
```

---

## 🚀 Quick Start for First-Time Users

```bash
# 1. Start dev server
npm run dev

# 2. Open browser console (F12)

# 3. Run quick test
window.perfMonitor.start()
window.testMultiplayer(5)

# 4. Play for 1 minute

# 5. Check results
window.perfMonitor.report()
```

**That's it!** You now have performance data.

---

## 📞 Need More Help?

1. Check the troubleshooting section in [`PHASE_1_QUICK_START.md`](PHASE_1_QUICK_START.md)
2. Review full guide: [`PHASE_1_PERFORMANCE_TESTING_GUIDE.md`](PHASE_1_PERFORMANCE_TESTING_GUIDE.md)
3. Check implementation: [`PHASE_1_COMPLETE_SUMMARY.md`](PHASE_1_COMPLETE_SUMMARY.md)

---

**Remember**: Phase 1 is about **measurement**, not optimization. Get good data first, then optimize! 📊
