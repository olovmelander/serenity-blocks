# Electron Packaging Overhaul Plan

## Context

The Windows Electron build of Serenity Blocks is severely degraded compared to the web/dev experience. `electron/main.js` has grown to **4543 lines** with GPU profiling, structured JSONL logging, managed DevTools host windows, a custom C GPU-preference launcher, 4 Windows runtime profiles, 62 IPC handlers, and a startup reveal gate that waits up to 8 seconds (3s Steam timeout + 5s reveal fallback). These layers interact poorly with the renderer, causing broken dropdowns, flickering scroll, slow icon loading, and inaccessible DevTools. The plan is to strip back to a minimal wrapper, fix the UI bugs independently, then incrementally re-add features.

---

## Phase 0: Minimal Electron Wrapper (Baseline Test)

**Goal:** A ~60-line `electron/main-minimal.js` that just loads the web app to prove Electron itself is not the problem.

**Create:**
- `electron/main-minimal.js` — BrowserWindow with `{ width: 1280, height: 720, contextIsolation: true, nodeIntegration: false, sandbox: true }`, loads `localhost:5173` (dev) or `dist/index.html` (prod), shows immediately, F12 opens DevTools
- `electron/preload-minimal.mjs` — stubs `window.electronAPI = { isElectron: true }`, `window.electronDisplay = {}`, `window.steamworks = null` so renderer code doesn't crash on missing globals
- New script in `package.json`: `"electron:minimal": "electron electron/main-minimal.js"`

**Verification:**
- App loads main menu
- All `<select>` dropdowns in settings expand and work
- Serenity Hub icons appear within 2 seconds
- Settings scrolling is smooth (no flickering/resizing)
- F12 opens DevTools
- Gameplay works (load a theme, play)

**Outcome:** If bugs persist here, they're in the web layer (Phase 1 fixes needed). If bugs disappear, they're caused by main.js complexity (Phase 2 removes them).

---

## Phase 1: Fix Web-Layer UI Bugs

These fixes apply regardless of which Electron main process is used.

### 1a. Dropdown menus not expanding

**Root cause:** The capture-phase wheel handler in `src/ui/modals.js:827-859` calls `event.preventDefault()` and `event.stopPropagation()` on wheel events over the settings modal. This can suppress click/interaction on native `<select>` popups in Electron's Chromium. Additionally, `pointer-events: none !important` from the `settings-scroll-active` class (`public/styles/main.css:14504-14508`) may not clear fast enough.

**Fix:**
- In `modals.js` capture-phase wheel handler, add an early return if `event.target` is or is inside a `<select>` element
- Ensure `settings-scroll-active` class is removed on `pointerdown`/`click`, not just on scroll idle timeout
- If native selects still fail in Electron, replace with custom `<div>`-based dropdowns

**Files:** `src/ui/modals.js`, `public/styles/main.css`

### 1b. Serenity Hub icons slow to load

**Root cause:** `resolveDesktopHubThemeThumbnailUrl()` in `src/ui/serenity-hub/theme-thumbnail-manifest.js:32-39` constructs URLs via `new URL('assets/theme-thumbnails/...', baseUrl)` where `baseUrl` is `window.location.href`. On `file://` protocol in packaged Electron, this URL construction can produce malformed paths. Each failed icon triggers a fallback load attempt, cascading delays.

**Fix:**
- Simplify: always use the bundled Vite-resolved icon path (`resolveHubThemeThumbnailUrl`) — in a packaged build, bundled assets are already local files, so the "desktop optimization" path adds no benefit
- In `ThemesTab.js`, make `shouldUseDesktopThemeThumbnails()` return `false`, or remove the desktop thumbnail code path entirely

**Files:** `src/ui/serenity-hub/theme-thumbnail-manifest.js`, `src/ui/serenity-hub/ThemesTab.js`

### 1c. Scroll flickering and resizing in settings

**Root cause:** The scroll performance controller in `src/ui/modals.js:735-860` toggles `is-scrolling` and `settings-scroll-active` CSS classes every ~80ms during scroll. These classes apply `contain: strict` (`public/styles/main.css:14532-14533`) which changes the containing block and forces layout recalculation, and `pointer-events: none !important` (`public/styles/main.css:14504-14508`). The rapid toggling + layout recalc causes the visual flickering/resizing. The manual `scrollTop` assignment in the capture-phase wheel handler also fights native scrolling.

**Fix:**
- Remove `contain: strict` from `.settings-scroll-container` during scroll — replace with `will-change: scroll-position` permanently on the scroll container
- Remove `pointer-events: none !important` from `settings-scroll-active` — it's overaggressive and breaks interaction
- Increase scroll idle delay from 80ms to 200ms or remove the class-toggling mechanism entirely
- Remove the capture-phase wheel handler's manual `scrollTop` assignment — let the browser handle native scrolling
- Keep the Electron-specific CSS in `public/styles/serenity-hub.css:3314-3360` (reduced backdrop-filter) as a sensible optimization

**Files:** `src/ui/modals.js`, `public/styles/main.css`, `public/styles/serenity-hub.css`

---

## Phase 2: Slim Down main.js (~500 lines)

**Goal:** Replace the 4543-line `electron/main.js` with a clean, maintainable version.

### Keep:
- BrowserWindow creation (simplified, ~20 lines)
- Single-instance enforcement (5 lines)
- 2 GPU switches: `enable-gpu-rasterization`, `enable-webgl`
- `force-high-performance-gpu` switch (replaces the C launcher entirely)
- Dev/prod URL loading
- Native DevTools via F12/Ctrl+Shift+I (let Electron handle it, no managed host window)
- Preload with context-isolated bridge for `electronDisplay` + `electronAPI`
- `window-all-closed`, `activate` handlers
- Power monitor events (pause/resume rendering)
- `backgroundThrottling: false`

### Remove permanently:
| Component | ~Lines | Why |
|---|---|---|
| GPU preference launcher (`gpu-preference-launcher.c`, `afterPack.cjs` rename) | 300+ | `force-high-performance-gpu` switch does the same thing |
| 4 Windows runtime profiles | ~200 | One sensible default is enough |
| Managed DevTools host window system | ~300 | Native DevTools works fine |
| Startup reveal gate | ~50 | Show window immediately with black bg |
| Structured JSONL logging | ~150 | Use standard console.log |
| GPU health monitoring (`gpu-health.js`) | 111 | Diagnostics, not core functionality |
| DevTools shortcut deduplication | ~90 | Over-engineering |
| Console method hijacking in preload | ~80 | Adds overhead, hides real errors |
| Legacy `preload.js` (CJS) | 149 | Dead code — only `preload.mjs` is used |
| Crash reporter | ~15 | Not needed until Steam release |

### Simplified preload.mjs (~50 lines):
- `window.electronDisplay`: `getDisplays`, `setFullscreen`, `setBorderless`, `setWindowed`, `setResolution`, `getWindowBounds`, `isFullscreen`, `setVSync` (8 IPC channels)
- `window.electronAPI`: `{ isElectron: true, isPackaged: boolean }` + `onRuntimeEvent` listener
- `window.steamworks`: `null` stub

### Files to modify:
- `electron/main.js` — rewrite to ~500 lines
- `electron/preload.mjs` — simplify to ~50 lines
- `scripts/afterPack.cjs` — remove exe rename logic
- `scripts/build-win.mjs` — remove GPU launcher compilation
- `package.json` — update build config, remove launcher references

---

## Phase 3: Re-add Steam as Isolated Module

**Goal:** Steam integration as a lazy-loaded, separate module — not blocking startup.

**Create:** `electron/steam-integration.js` exporting `{ initSteam, createSteamIPCHandlers, cleanupSteam }`

**Key change:** Call `initSteam()` AFTER window is shown and renderer has loaded (not before window creation). This eliminates the 3-second startup delay.

**Add back to preload.mjs:** Full `window.steamworks` API surface via IPC invoke (restore the ~40 steam IPC channels)

**Verification:** App starts without Steam running (no crash, no delay). With Steam running, overlay + lobbies + P2P work.

---

## Phase 4: Optional Diagnostics (Behind Flags)

Re-add as opt-in only:
- GPU diagnostics → `SERENITY_ENABLE_DIAGNOSTICS=1`
- Structured logging → `SERENITY_ENABLE_LOGGING=1`
- Performance reports → same diagnostics flag

**Stays removed permanently:** GPU preference launcher C exe, 4 runtime profiles, managed DevTools host, preload console hijacking.

---

## Verification Strategy

After each phase, test on a **packaged Windows build** (not just dev):

1. `npm run build:win` (or `build:win:wsl`)
2. Install/run from `release/` output
3. Checklist per phase:
   - Settings dropdowns expand and select values
   - Serenity Hub icons load within 2 seconds
   - Scrolling settings is smooth — panel stays same size/shape
   - F12 opens DevTools
   - Startup time < 3 seconds to first visible frame
   - Gameplay works (load theme, play a game)
   - No console errors about missing IPC channels

---

## Implementation Order

1. **Phase 0** first — creates `main-minimal.js` + `preload-minimal.mjs` (new files, no existing code touched)
2. **Phase 1** second — fixes UI bugs in web layer (safe, affects both web and Electron)
3. **Phase 2** third — rewrites `main.js` (biggest change, benefits from Phase 0/1 validation)
4. **Phase 3** fourth — re-adds Steam (isolated module)
5. **Phase 4** last — optional diagnostics
