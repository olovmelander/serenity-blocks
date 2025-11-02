# Serenity Blocks Performance Degradation Investigation

This document proposes a structured plan to identify and fix the FPS drop observed in single-player mode when the game is left running. Initial observation: the game boots at >120 FPS, then gradually falls over time even without user input, suggesting leaks or runaway work in the main loop.

## 1. Reproduce & Baseline Metrics
- **Reproduction script**: Start single-player, avoid input, run ≥10 minutes, record FPS via `performanceMonitor` overlay and Chrome Performance panel.
- **Collect data**: note FPS timeline, frame time distribution, memory usage (JS heap, GPU memory if available), GC activity, number of locked pieces, DOM node count, active tweens/emitters.
- **Capture artifacts**: save DevTools timeline (CPU + memory) and heap snapshots at start vs after FPS drop.

## 2. Instrumentation Enhancements
- **Enable PerformanceMonitor hooks** already in `gameLoop` to log update/render timings every N seconds when `performanceMonitor.enabled`.
- **Add optional counters** (debug flag) for:
  - Active Phaser tweens, particle emitters, Graphics objects.
  - DOM children counts for `#score-popups`, `#line-clear-flash`, `body` overlays.
  - Locked pieces array length and board cache stats.
- **Expose helper** `window.debugPerformanceReport()` to dump metrics JSON for offline comparison.

## 3. Suspected Hotspots & Diagnostics
1. **Physics/Line Clear Loop (`processPhysics`)**
   - Check for cascading setTimeout/promises that never resolve.
   - Verify we clear animations/effects (flash graphics, cascades) promptly.
2. **Phaser Scenes**
   - Inspect `BoardScene` for accumulating Graphics/tweens/emitter references.
   - Confirm pools are reused (`blockPool`, `particle` pools) and no unbounded arrays.
3. **DOM Overlays**
   - Monitor `#score-popups`, `background-pulse`, other effects for orphan nodes or timers.
4. **Object Pools & Game State**
   - Watch `lockedPieces` size, `boardCache` churn, `movedArray`, `holeMaskMatrix` for growth.
5. **FrameRateController & RAF**
   - Ensure no duplicate RAF loops (e.g., `startFPSMonitor`) compounding per frame.

## 4. Profiling Workflow
1. Run with `performanceMonitor.enable()` + overlay visible.
2. Record DevTools `Performance` (CPU) timeline for a session where FPS drops.
3. Take heap snapshot at start and after drop; diff retained size by constructor.
4. Use DevTools `Memory > Allocation sampling` during idle run to see leaks.
5. Repeat with effects disabled to isolate GPU vs CPU vs DOM.

## 5. Hypothesis Testing & Fixes
- **If memory climbs** → identify leaking objects (DOM nodes, Phaser graphics, arrays) and ensure cleanup (e.g., destroy Graphics, cancel tweens, reuse buffers, clear timeouts).
- **If CPU frame time increases** → profile JS flame chart, optimize hotspots (avoid repeated `generateBoard`, reduce logging, throttle expensive loops, ensure physics promises resolve).
- **If GPU-bound** → examine WebGL draw calls (Phaser inspector), reduce overdraw or disable unused shaders when idle.

## 6. Automation & Regression Guard
- Create a Vitest or Playwright script to run simulated gameplay for N minutes and assert FPS stays above threshold (using exported metrics or headless capture).
- Integrate optional CI job or manual test checklist to rerun whenever physics/rendering code changes.

## 7. Deliverables
- Timeline recordings + heap snapshot diff posted in `/performance-reports/`.
- Identified root cause with patches (e.g., cleanup leaks, optimize loops).
- Updated documentation describing monitoring procedure and regression test.
