# Electron Windows Optimization Plan

## Overview

The Serenity Blocks Electron Windows app has 5 critical issues degrading the player experience. This document details the root causes found through codebase analysis and the specific fixes for each.

---

## Issue 1: Steam Connection Stuck at "Connecting"

### Root Cause

A race condition between the main process and renderer during startup:

1. `electron/main.js` fires `did-finish-load` which triggers `scheduleSteamCoreBootstrap()` and `emitSteamStatus()`
2. The renderer's `SteamService` is loaded via dynamic ES module imports (`entry-desktop.js` → `main.js` → `steam-service.js`), which complete **after** `did-finish-load`
3. By the time `_setupIpcListeners()` runs in the renderer, the `steam:status` IPC event has already been sent and missed
4. The existing 2000ms catchup timeout (line 2872 of `electron/main.js`) is a blind guess that may fire before or after the renderer is ready
5. The pending resolution poll (1500ms intervals, max 15s) should catch this, but has an edge case where the `readyEmitted` guard prevents re-emitting the READY event on fallback syncs

### Fixes

**`src/core/steam/steam-service.js`:**

1. **Post-listener-registration sync** — After `_setupIpcListeners()` sets `_ipcListenersInitialized = true` (line 312), use `queueMicrotask` to immediately query the main process for current Steam status. This eliminates the race entirely: listeners are registered first, then we query for any status we missed.

2. **20-second hard fallback** — After starting the pending resolution poll (line 271), set a 20s `setTimeout` that forces a final status sync. If still pending after this, fail gracefully to offline mode. Clean up this timer in `_stopPendingResolutionPoll()`.

3. **Fix `readyEmitted` guard** — In `_syncFromMainProcessStatus()`, allow re-emission of the READY event when the sync source is a fallback or post-listener path. This ensures the UI updates even if an earlier partial sync set the guard.

**`electron/main.js`:**

4. **Two-stage catchup** — Replace the single 2000ms timeout (lines 2872-2876) with re-emissions at 1500ms and 4000ms, covering both fast and slow ES module loading scenarios.

---

## Issue 2: NVIDIA Overlay Crashes/Freezes the Game

### Root Cause

Lines 110-116 of `electron/main.js`:
```js
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-direct-composition');
```

- **`in-process-gpu`** merges the GPU process into the main browser process. When the NVIDIA overlay DLL injects into the GPU compositor and causes any instability, the entire Electron process dies instead of just the sandboxed GPU child process.
- **`disable-direct-composition`** disables Windows DirectComposition, which the NVIDIA overlay hooks into for rendering. Without it, the overlay falls back to more invasive hooking methods that cause freezes.

These flags were added for Steam overlay compatibility with older `steamworks.js`, but modern versions (v0.4+) use `electronEnableSteamOverlay()` which registers a frame invalidator that works with out-of-process GPU.

### Fixes

**`electron/main.js`:**

1. **Remove both flags** — Replace the block at lines 110-116 with a log message. The Steam overlay frame invalidator (already called at line 3028) handles overlay compositing without needing in-process GPU.

2. **Add environment variable escape hatch** — `SERENITY_LEGACY_GPU_OVERLAY=1` re-enables the old flags for users on older steamworks.js versions or specific hardware that needs them.

3. **Add GPU crash recovery** — Enhance the existing `child-process-gone` handler (line 3107) to send a `gpu-process-recovered` IPC event to the renderer when a GPU process crash is detected. The renderer's `gpuResilience` module (imported in `base-theme.js`) should handle WebGL context restoration.

---

## Issue 3: Focus Loss Freezes (Alt-Tab Away and Back)

### Root Cause

Three compounding problems:

1. **Anti-throttling flags missing for shipped builds** — `disable-background-timer-throttling`, `disable-renderer-backgrounding`, and `disable-backgrounding-occluded-windows` are only applied for lab profiles (lines 612-614 of `electron/main.js`). The default shipped profile is `webParity`, so these flags are **never applied in production**. The `backgroundThrottling: false` webPreference (line 2790) only controls JS timer throttling, not Chromium compositor/GPU throttling.

2. **No BrowserWindow blur/focus handlers** — The renderer relies solely on `document.visibilitychange` (line 1301 of `src/main.js`). On Windows, clicking to another overlapping window may not trigger `visibilitychange` consistently in Electron (it fires on minimize but not always on simple focus loss).

3. **Pause/resume inconsistency** — `BaseTheme.pause()` sets `_wasPaused = true`, but `resume()` never resets it. `resumeFullRendering()` in `src/main.js` (line 1413) checks `_wasPaused` to decide whether to call `animate()`, creating a confusing state that may prevent proper RAF loop restart.

4. **Default 'reduce' behavior for webParity** — Lines 1290-1292 of `src/main.js` set the default to `'reduce'` for webParity profiles. This calls `theme.pause()` which cancels RAF loops. When combined with missing anti-throttling flags, the WebGL context may be in a degraded state when trying to resume.

### Fixes

**`electron/main.js`:**

1. **Apply anti-throttling flags for all packaged Windows builds** — Move the three flags outside the lab profile guard. Add them for all `isPackagedWindowsApp` builds.

2. **Add BrowserWindow blur/focus IPC handlers** — `mainWindow.on('blur')` and `mainWindow.on('focus')` send `window-focus-changed` events via the `desktop:runtime-event` IPC channel.

**`src/main.js`:**

3. **Handle IPC focus/blur events** — In `setupVisibilityThrottling()`, listen for `window-focus-changed` events alongside `visibilitychange`. Only apply throttling on blur if behavior is not 'continue'.

4. **Default all packaged Electron builds to 'continue'** — Change line 1290-1292 to `const defaultBehavior = isPackagedElectron ? 'continue' : 'reduce'`.

5. **Fix resume logic** — In `resumeFullRendering()`, always restart the animation loop via `requestAnimationFrame(() => theme.animate())` instead of gating on `_wasPaused`.

**`src/themes/base-theme.js`:**

6. **Reset `_wasPaused` in `resume()`** — Add `this._wasPaused = false` to the resume method.

---

## Issue 4: Severe UI/Theme Lag

### Root Cause

Multiple expensive operations running every frame:

- **CSS `backdrop-filter: blur()`** — 15+ declarations in `serenity-hub.css` (2-30px blur), plus `custom-cursor.css` with `filter: blur()` on trail, aura, and lens elements. Each blur triggers a full-screen Gaussian blur pass per frame.
- **Custom cursor** — Updates `will-change: transform` on every mousemove with 220ms transitions and multiple blur filters.
- **Particle system** — All particles recalculate position/velocity every frame regardless of quality setting. No frame-skip at lower quality.
- **Document-level capture-phase wheel handlers** — Both settings modal and SerenityHub add capture-phase wheel listeners that call `document.elementFromPoint()` (forces layout recalculation) on every wheel event.
- **42/47 themes marked heavy-gpu** — LRU cache eviction involves recursive Three.js scene disposal on the main thread.

### Fixes

**`public/styles/custom-cursor.css`:**

1. **Remove `filter: blur(0.2px) saturate(1.18)`** from trail canvas (line 28) — imperceptible but forces compositor layer redraw
2. **Replace `filter: blur(18px)`** on aura (line 71) with a larger radial gradient that approximates the glow at zero per-frame cost
3. **Remove `backdrop-filter: blur(14px) saturate(1.4)`** from lens (line 98)
4. **Replace all state-specific `filter: blur()`** (lines 177, 205, 226, 245, 265, 289, 305) with opacity adjustments

**`public/styles/serenity-hub.css`:**

5. **Extend Electron `backdrop-filter` overrides** — Add `backdrop-filter: none` + opaque backgrounds for: `.serenity-hub-backdrop`, odyssey modals, music player, right toolbar, `.now-playing-mini`. Keep only 2px blur on main hub panel.
6. **Disable `backdrop-filter` during `is-scrolling`** for the hub panel

**`src/rendering/renderer.js`:**

7. **Particle frame-skip** — In `renderFrame()`, only call `ps.update()` every Nth frame based on quality:
   - Extreme/Ultra/High: every frame (N=1)
   - Medium: every 2nd frame (N=2)
   - Low: every 3rd frame (N=3)
   - Minimal: every 4th frame (N=4)

---

## Issue 5: Menu Navigation Glitches / Settings Buttons Won't Expand

### Root Cause

1. **Capture-phase wheel listener accumulation** — `modals.js` (line 821) adds an anonymous capture-phase wheel listener every time `setupSettingsScrollPerformanceMode` runs, with no way to remove it (no stored reference). If the settings modal is destroyed and recreated, listeners accumulate.

2. **`settings-scroll-active` blocks hover transitions** — CSS at `main.css` lines 14499-14516 sets `transition: none !important` on `.setting`, `.setting-select`, etc. during scroll. If settings buttons use hover-triggered expansion, this prevents it. The 120ms debounce keeps this active too long.

3. **`elementFromPoint()` on every wheel event** — `resolveTopmostWheelTarget()` in `wheel-routing.js` (line 154) forces a layout recalculation on every wheel event. Multiple capture-phase listeners all calling this on the same event compounds the cost.

### Fixes

**`src/ui/modals.js`:**

1. **Store capture-phase handler reference** — Replace the anonymous function with a named reference stored on the modal element (`settingsModal._wheelCaptureHandler`). Check for existing handler before adding a new one.

**`public/styles/main.css`:**

2. **Exempt interactive elements from scroll transition suppression** — Add rules for `.setting-button` and `.settings-tab` to retain hover transitions and pointer-events during `settings-scroll-active`.
3. **Reduce scroll idle debounce** from 120ms to 80ms.

**`src/utils/wheel-routing.js`:**

4. **Cache `elementFromPoint` per frame** — Store the result with a millisecond timestamp. If called again within the same millisecond (same frame), return the cached result. Avoids redundant layout recalculations from multiple listeners.

---

## Testing Checklist

- [ ] Steam connects within 5 seconds on launch (Issue 1)
- [ ] Blocking `steam:status` IPC → 20s fallback resolves to offline (Issue 1)
- [ ] NVIDIA overlay (Alt+Z) opens without freeze/crash during heavy theme (Issue 2)
- [ ] Discord overlay and Windows Game Bar also work (Issue 2)
- [ ] Alt-tab away for 30s → alt-tab back → rendering resumes within 1 frame (Issue 3)
- [ ] Minimize → restore → no freeze (Issue 3)
- [ ] FPS measured before/after CSS changes with heavy theme + hub open (Issue 4)
- [ ] No drops below 50 FPS while scrolling themes in hub (Issue 4)
- [ ] Settings expandable sections respond during/after scrolling (Issue 5)
- [ ] SerenityHub theme cards clickable immediately after scrolling (Issue 5)

## Files Modified

| File | Issues Addressed |
|------|-----------------|
| `electron/main.js` | 1, 2, 3 |
| `src/core/steam/steam-service.js` | 1 |
| `src/main.js` | 3 |
| `src/themes/base-theme.js` | 3 |
| `public/styles/custom-cursor.css` | 4 |
| `public/styles/serenity-hub.css` | 4 |
| `src/rendering/renderer.js` | 4 |
| `src/ui/modals.js` | 5 |
| `src/utils/wheel-routing.js` | 5 |
| `public/styles/main.css` | 5 |
