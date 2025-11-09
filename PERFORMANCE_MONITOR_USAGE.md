# Enhanced Performance Monitor - Usage Guide

## Overview

The enhanced performance monitor provides real-time performance metrics with a visual overlay, helping you track FPS, frame time, memory usage, and more during gameplay.

## Features

### Visual Dashboard
- **Real-time FPS Display**: Current, average, min, and max FPS
- **Frame Time Graph**: Visual 60-frame history showing performance over time
- **Memory Tracking**: Current memory usage, total heap, and limit
- **Update/Render Time**: Breakdown of frame time into update and render phases
- **Frame Drops**: Count of frames that exceeded the 16.67ms budget (60fps)
- **Quality Mode Indicator**: Shows current graphics quality setting

### Color-Coded Metrics
- **Green**: Good performance (FPS ≥ 55, Frame time ≤ 16.67ms, Memory < 50%)
- **Yellow**: Acceptable performance (FPS ≥ 45, Frame time ≤ 20ms, Memory < 75%)
- **Red**: Poor performance (FPS < 45, Frame time > 20ms, Memory ≥ 75%)

## How to Use

### Method 1: Settings Panel
1. Open the game settings
2. Enable "Show FPS Counter"
3. The performance overlay will appear in the top-right corner

### Method 2: Keyboard Shortcut
- Press **F3** to toggle the performance overlay on/off
- Works when performance monitoring is enabled

### Method 3: Browser Console
Open the browser console (F12) and use these commands:

```javascript
// Start monitoring with overlay
window.perfMonitor.start()

// Stop monitoring
window.perfMonitor.stop()

// Toggle overlay visibility (press F3 also works)
window.perfMonitor.toggle()

// Set quality mode display (Low, Medium, High, Ultra)
window.perfMonitor.setQuality('High')

// Generate detailed performance report
window.perfMonitor.report()

// Reset metrics
window.perfMonitor.reset()

// Export metrics to JSON file
window.perfMonitor.export()

// Get current metrics as object
window.perfMonitor.getMetrics()
```

## Understanding the Metrics

### FPS (Frames Per Second)
- **Current**: Instantaneous FPS
- **Average**: Rolling average over the last 60 frames
- **Min/Max**: Lowest and highest FPS recorded

### Frame Time
- **Current**: Time to complete the current frame
- **Budget**: 16.67ms target for 60fps
- Yellow line on graph shows the 60fps budget

### Memory
- **Memory Used**: Current JavaScript heap usage
- **Total**: Total allocated heap
- **Limit**: Maximum heap size available
- **Percentage**: Used/Limit ratio

### Update/Render Time
- **Update**: Time spent in game logic
- **Render**: Time spent drawing graphics

### Frame Drops
- Count of frames that took longer than 25ms (1.5x the 60fps budget)

## Performance Targets

| Quality    | Target FPS | Max Frame Time | Expected Memory |
|------------|------------|----------------|-----------------|
| Low        | 30 fps     | 33ms           | < 80MB          |
| Medium     | 60 fps     | 16.67ms        | < 100MB         |
| High       | 60 fps     | 16.67ms        | < 150MB         |
| Ultra      | 60+ fps    | 16.67ms        | < 200MB         |

## Tips for Best Performance

1. **Monitor While Playing**: Enable the overlay during gameplay to see real-time impact
2. **Adjust Quality Settings**: If you see consistent red metrics, lower your graphics quality
3. **Check Frame Drops**: Occasional drops are normal, but frequent drops indicate issues
4. **Memory Trends**: Watch for steadily increasing memory (potential memory leak)
5. **Export Data**: Use `window.perfMonitor.export()` to save metrics for analysis

## Graph Interpretation

The frame time graph shows the last 60 frames:
- **Green line**: Frame completed within budget (good!)
- **Yellow line**: Frame slightly over budget (acceptable)
- **Red line**: Frame significantly over budget (problem)
- **Yellow horizontal line**: 60fps budget (16.67ms)

The graph scrolls left to right, with the rightmost point being the most recent frame.

## Integration with Quality Settings

When you change the **Graphics Quality** setting:
- The performance monitor automatically updates to show the new quality mode
- You can see the immediate impact on FPS and frame time
- This helps you find the optimal quality setting for your device

## Next Steps

After implementing Phase 1 (this update), the following phases from the optimization plan will add:
- **Phase 2**: Reference caching and selective processing
- **Phase 3**: Asset optimization and lazy loading
- **Phase 4**: Rendering experiments (Canvas fallback, resolution scaling)
- **Phase 5**: Memory optimization and leak detection

The performance monitor will help track improvements across all these phases!

---

**Last Updated**: 2025-11-09
**Related Files**:
- [src/utils/performance-monitor.js](src/utils/performance-monitor.js) - Core implementation
- [PERFORMANCE_OPTIMIZATION_PLAN.md](PERFORMANCE_OPTIMIZATION_PLAN.md) - Full optimization roadmap
