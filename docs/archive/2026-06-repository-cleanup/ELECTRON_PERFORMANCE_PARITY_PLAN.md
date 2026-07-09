# Electron Performance Parity Plan

## Context

The packaged Electron app (`npm run build:win:wsl`) has significant performance and interaction regressions compared to the browser dev server (`npm run dev`). Issues include: icons not appearing immediately, broken scroll in menus, unresponsive settings buttons, lower FPS, and general UI sluggishness. This plan systematically addresses each root cause to bring the Electron app to full parity with the browser experience.

---

## Phase 1: Fix Broken Interactions (Scroll + Click Blocking)

**Priority: CRITICAL — these are broken features, not optimizations.**

### 1.1 Wheel Event Target Resolution Fix

**Root cause:** `OdysseyBoardController` registers a wheel handler on `document` with `{ capture: true, passive: false }` (line 734). In the capture phase, `event.target` should be the topmost DOM element. The `shouldRouteOdysseyWheel` function (line 131) correctly checks `shouldCaptureWheelInput` which walks `event.target` ancestors for `data-wheel-lock`. However, in Electron's Chromium compositor, when a WebGL canvas sits beneath the hub panel, `event.target` can resolve to the canvas rather than the overlay due to compositor z-index hit-testing differences.

**Fix:** In `shouldRouteOdysseyWheel`, add a `document.elementFromPoint()` fallback to resolve the actual topmost element:

**File:** `src/rendering/odyssey/OdysseyBoardController.js` (lines 131-157)
```js
// After isPointInsideRect check passes, verify the topmost element
const topElement = document.elementFromPoint(clientX, clientY);
if (topElement && topElement !== target) {
    if (!shouldCaptureWheelInput({ target: topElement, styleResolver, attributeNames })) {
        return false;
    }
}
```

### 1.2 InfinityMode Wheel Handler Guard

**Root cause:** `InfinityMode._onWheelScroll` (line 1701) checks `shouldCaptureWheelInput` at line 1704 and returns if false — this is correct. But the check at line 1710 (`if (!isInExplorationMode && !isScrollBuffering && isPaused) return`) exits BEFORE `preventDefault()` only when paused. If the game is NOT paused when the hub opens (e.g., Serenity Mode background), `preventDefault()` at line 1713 fires and kills scrolling.

**Fix:** Move the `shouldCaptureWheelInput` check to be truly the first guard, and also add `elementFromPoint` fallback:

**File:** `src/core/game-modes/InfinityMode.js` (line 1701)

### 1.3 Settings Modal Z-Index / Click-Through Fix

**Root cause:** The `.modal` has `z-index: 1000` (main.css:14218). The hub backdrop is `z-index: 1999` and hub panel is `z-index: 2000` (serenity-hub.css). When the hub is open, the backdrop covers the settings button (`z-index: 1000`), blocking clicks. The settings button also sits behind the hub panel.

**Fix:** Two-part approach:
1. When the hub is open, hide the global settings button (it's redundant — hub has its own settings access)
2. In the settings modal CSS, ensure `z-index` is above the hub (`z-index: 2100`) so the modal always appears on top when opened

**Files:**
- `src/ui/serenity-hub/SerenityHub.js` — hide/show `#settings-btn-global` on hub open/close
- `public/styles/main.css` — add `#settings-modal.visible { z-index: 2100; }`

### 1.4 Settings Scroll Container Fix

**Root cause:** `#settings-modal .modal-content` has `overflow: hidden` (main.css:14364) and delegates scrolling to `.settings-scroll-container` with `overflow-y: auto`. If the scroll container doesn't get proper height constraints in Electron (due to `max-height: 85vh` + flexbox), content may not scroll. Additionally, the modal itself has `overflow-y: auto` but the content div blocks it with `overflow: hidden`.

**Fix:** Ensure `.settings-scroll-container` has explicit `max-height` and the wheel event can reach it:
- Add `data-wheel-lock="true"` to the settings modal element
- Verify flexbox height chain works in Electron's Chromium version

**File:** `public/styles/main.css` (line 14360-14432), `src/ui/modals.js`

---

## Phase 2: Icon Loading Performance

**Priority: HIGH — most visible issue after interactions.**

### 2.1 Batched Icon Loading for Electron

**Root cause:** When `isElectron` is true, ALL 47+ icons (280KB-1.4MB PNGs) load simultaneously via `icons.forEach(loadIcon)` (ThemesTab.js:669). Even from `file://`, decoding and GPU-uploading 50+ large images simultaneously saturates the image decode thread pool and causes the main thread to stall.

**Fix:** Replace immediate bulk loading with batched RAF-paced loading:

**File:** `src/ui/serenity-hub/ThemesTab.js` (lines 664-671)
```js
if (isElectron || typeof IntersectionObserver !== 'function') {
    const BATCH_SIZE = 6;
    let idx = 0;
    const loadBatch = () => {
        const end = Math.min(idx + BATCH_SIZE, icons.length);
        for (let i = idx; i < end; i++) loadIcon(icons[i]);
        idx = end;
        if (idx < icons.length) requestAnimationFrame(loadBatch);
    };
    loadBatch();
    return;
}
```

### 2.2 Remove `fetchpriority="high"` for Electron

**Root cause:** Setting `fetchpriority="high"` on ALL icons (ThemesTab.js:251) tells the browser to prioritize everything equally, which means nothing is prioritized.

**Fix:** Change to `fetchpriority="auto"` for Electron, or omit the attribute entirely.

**File:** `src/ui/serenity-hub/ThemesTab.js` (line 251)

### 2.3 Add Visual Placeholder While Loading

**Fix:** Add a subtle background/shimmer to `.theme-icon-img:not(.is-ready)` so the UI looks intentional while icons decode:

**File:** `public/styles/serenity-hub.css`

---

## Phase 3: GPU Profile & Renderer Optimization

**Priority: HIGH — directly impacts FPS.**

### 3.1 Add `in-process-gpu` to Current/Aggressive Profiles

**Root cause:** WSL2 dev mode uses `in-process-gpu` which eliminates GPU process IPC overhead. The packaged Windows `current` profile does not have this flag. For a game, the tradeoff (GPU crash = renderer crash) is acceptable.

**Fix:** Add `in-process-gpu` to the `current` and `aggressive` profiles.

**File:** `electron/main.js` (lines 430-441)

### 3.2 ANGLE Backend Alignment

**Root cause:** WSL2 dev uses `use-angle=default`, packaged Windows uses `use-angle=d3d11`. The D3D11 backend may have different performance characteristics. Consider testing with `d3d11on12` or `gl` as alternatives for specific GPU vendors.

**Fix:** Add a diagnostic log comparing ANGLE backends and allow runtime override via environment variable. Keep `d3d11` as default but document how to switch.

**File:** `electron/main.js` (line 439)

### 3.3 Frame Rate and VSync Tuning

**Root cause:** VSync in Electron has higher latency than in a browser due to multi-process architecture. The frame rate controller detects monitor refresh rate, but in Electron the detection sampling may be less accurate.

**Fix:** When `in-process-gpu` is enabled, consider also adding `disable-frame-rate-limit` to let the app's own `FrameRateController` handle all timing instead of Chromium's compositor.

**File:** `electron/main.js` (lines 725-746)

---

## Phase 4: CSS Performance for Electron

**Priority: MEDIUM — reduces jank and improves perceived performance.**

### 4.1 Reduce `backdrop-filter` in Electron

**Root cause:** 18+ `backdrop-filter: blur()` declarations in serenity-hub.css (blur values 4px to 30px). Each requires a separate readback-blur-composite cycle. Stacking multiple blurs is extremely expensive in Electron's compositor.

**Fix:** Add `body.electron-app` class (set in `src/main.js` on startup) and provide reduced blur or solid fallbacks:

**Files:**
- `src/main.js` — add `document.body.classList.add('electron-app')` when Electron detected
- `public/styles/serenity-hub.css` — add overrides:
```css
body.electron-app .serenity-hub-backdrop {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.7);
}
body.electron-app .serenity-hub-panel {
    backdrop-filter: blur(4px);  /* reduced from var(--hub-backdrop-blur) */
}
```

### 4.2 Pause Invisible CSS Animations

**Root cause:** The `scanLine` animation on `.modal-content::after` (main.css:14281) runs perpetually even when the modal is hidden, consuming compositor resources.

**Fix:**
```css
.modal:not(.visible) .modal-content::after {
    animation-play-state: paused;
}
```

**File:** `public/styles/main.css` (after line 14317)

### 4.3 Remove Permanent `will-change`

**Root cause:** `will-change: transform, opacity` on the hub panel creates a permanent compositing layer consuming GPU memory even when closed.

**Fix:** Only apply `will-change` during the open/close transition, remove after `transitionend`.

**File:** `public/styles/serenity-hub.css`

---

## Phase 5: Build & Asset Optimization

**Priority: MEDIUM — improves startup and memory usage.**

### 5.1 Optimize Theme Icon Sizes

**Root cause:** Theme icon PNGs are 280KB-1.4MB but display at ~80x80px. This wastes memory and decode time.

**Fix:** Add a build-time step to generate optimized WebP thumbnails (160x160px, quality 80) for the packaged build. Keep original PNGs for the browser dev path.

**File:** `scripts/build-win.mjs` — add image optimization step after Vite build

### 5.2 Electron-Specific `body` Class for Feature Detection

**Fix:** Centralize Electron detection by adding `body.electron-app` class early in startup. This allows CSS-only optimizations without JS runtime checks.

**File:** `src/main.js` (after desktop runtime config resolution)

---

## Phase 6: Diagnostics & Verification

**Priority: MEDIUM — needed to verify fixes work.**

### 6.1 Icon Loading Metrics

Add `performance.mark/measure` around icon loading to track time-to-first-icon and time-to-all-icons.

**File:** `src/ui/serenity-hub/ThemesTab.js`

### 6.2 Wheel Event Debug Mode

Add a debug flag that logs wheel event routing decisions (which handler captured, wheel-lock status, preventDefault calls).

**File:** `src/utils/wheel-routing.js`

---

## Implementation Order

| Order | Fix | Impact | Risk |
|-------|-----|--------|------|
| 1 | 1.1 + 1.2: Wheel event `elementFromPoint` guard | Fixes scroll in all menus | Low |
| 2 | 1.3 + 1.4: Settings z-index + scroll container | Fixes settings interaction | Low |
| 3 | 2.1 + 2.2: Batched icon loading | Fixes icon appearance delay | Low |
| 4 | 4.1: Reduce backdrop-filter + add electron-app class | Reduces UI jank | Low |
| 5 | 3.1: Add in-process-gpu flag | Improves FPS | Medium |
| 6 | 2.3 + 4.2 + 4.3: Visual polish + animation cleanup | Polish | Low |
| 7 | 3.2 + 3.3: ANGLE + VSync tuning | FPS fine-tuning | Medium |
| 8 | 5.1: Icon size optimization | Startup performance | Low |
| 9 | 6.1 + 6.2: Diagnostics | Verification | Low |

## Critical Files

- `src/rendering/odyssey/OdysseyBoardController.js` — wheel capture handler
- `src/core/game-modes/InfinityMode.js` — wheel scroll handler
- `src/ui/serenity-hub/ThemesTab.js` — icon loading strategy
- `src/ui/serenity-hub/SerenityHub.js` — hub open/close, settings button
- `src/ui/modals.js` — modal show/hide, wheel-lock
- `src/utils/wheel-routing.js` — wheel event routing utilities
- `electron/main.js` — GPU profiles, Chromium flags
- `src/main.js` — app init, Electron detection
- `public/styles/serenity-hub.css` — backdrop-filter, will-change, scroll styles
- `public/styles/main.css` — modal z-index, settings scroll, animations

---

## Phase 7: F11 Fullscreen Freeze Fix (IMPLEMENTED)

### 7.1 Debounce Main Resize Handler

**Root cause:** 30+ unthrottled `window.addEventListener('resize')` fire simultaneously on F11, each doing sync GPU framebuffer reallocation.

**Fix:** Debounced main `handleResize()` in `src/main.js` with 150ms delay. Also debounced `OdysseyBoardController.onResize()`.

**Files:** `src/main.js`, `src/rendering/odyssey/OdysseyBoardController.js`

---

## Phase 8: Custom app:// Protocol (IMPLEMENTED)

### 8.1 Replace file:// with app:// Protocol

**Root cause:** `file://` has no HTTP caching, no pipelining. Custom protocols support Chromium caching and streaming.

**Fix:** Registered `app://` scheme with `protocol.registerSchemesAsPrivileged()` and `protocol.handle()` in `electron/main.js`. Falls back to `file://` if custom protocol fails.

**File:** `electron/main.js`

---

## Phase 9: Icon Loading with IntersectionObserver (IMPLEMENTED)

### 9.1 Use IntersectionObserver in Electron

**Root cause:** IntersectionObserver was disabled for Electron, forcing all 172 icons to load at once.

**Fix:** Removed the `isElectron` bypass so Electron uses the same lazy loading path as browsers (first 8 immediate, rest on scroll). Also added `loading="lazy"` and `fetchpriority="low"` for all platforms.

**File:** `src/ui/serenity-hub/ThemesTab.js`

---

## Phase 10: Electron Stability Flags (IMPLEMENTED)

### 10.1 V8 Heap + Canvas OOP Rasterization

- `--max-old-space-size=2048` for Three.js + Phaser memory
- `CanvasOopRasterization` to reduce main-thread GPU contention
- Background throttling disabled on all platforms (not just Windows)

**File:** `electron/main.js`

---

## Verification Checklist

1. Build with `npm run build:win:wsl` and test on Windows
2. Open Serenity Hub — verify icons appear progressively (not all at once, no blank period)
3. Scroll theme list — verify smooth scrolling, no event blocking
4. Open settings from hub — verify modal appears above hub, all buttons clickable
5. Scroll settings content — verify scroll works within settings modal
6. Check FPS counter — compare against browser dev server baseline
7. Toggle between themes — verify no additional jank vs browser
8. Run `chrome://gpu` in Electron DevTools — verify GPU flags are active
9. Press F11 rapidly multiple times — should not freeze
10. Monitor memory in Task Manager — should stay stable under 1GB
