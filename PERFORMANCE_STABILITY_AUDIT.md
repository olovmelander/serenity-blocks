# Serenity Blocks — Performance & Stability Audit

Date: 2026-07-16 · Auditor: automated read-only audit (Claude Code session)
Commit: `fc0329234e38587b3f498c4b495d9bad20b4024a` (branch `claude/serenity-blocks-perf-audit-wt80kg`, clean working tree)

> **Read-only pass.** No production code was modified. Deliverables are this report plus raw
> measurement artifacts under `reports/perf-audit-2026-07-16/`.

---

## 1. Executive summary

This audit profiled the **production build** at commit `fc03292` across 14 scenario families (startup, idle, gameplay, input, restart/theme/resize/visibility cycles, WebGL fallback, Odyssey, 30-min soak, CPU profiles) in a headless Chromium 141 environment with a **software GPU (SwiftShader)** — so absolute frame times are not representative of user hardware, while trends, long tasks, allocation behavior, lifecycle leaks, and stability defects are (§3 caveats). Electron/Steam-specific behavior could not be executed here and is classified accordingly.

**What is healthy (within the tested matrix):** single-player's main thread is nearly idle (busy 5.2 % gameplay / 2.1 % menu, GC < 1 %); input applies synchronously in the keydown handler (event→sim ≈ 0 ms, visual latency = 1 render frame); heap, DOM, and timers are **flat** across menu idle, 30 s gameplay windows, sustained-input stress, 12× restart cycles, 4× resize cycles, and a **30-minute gameplay soak** (heap 35.3–37.5 MB throughout, frame p95 improving over the session, zero crashes); the WebGL fallback lane boots and plays cleanly; restart lifecycle discipline (mode caching + unsubscriber draining) holds up under measurement.

**Top reproduced problems:**
1. **SB-01 — startup is hostage to fonts.googleapis.com**: with the CDN unreachable-but-slow (≈ any offline/firewalled desktop player), menu-ready = **13.6–14.0 s**, of which the hanging font stylesheet is ~12.6 s; with the request failing fast the same build reaches menu-ready in **0.88–0.93 s** (5+5 runs). One `<link>` in `index.html` serializes the entire boot.
2. **SB-15 — theme switching leaks**: 24 in-game switches grow GC-forced heap **35 → 82.7 MB, never returning**; isolation toggles convict **lunara (+3.3 MB/visit), stellar-drift (+2.9), ocean (+2.4)**. The repo's own `audit:theme-lifecycle` gate fails today with 28 findings in 26 themes and is not in CI (SB-04/SB-09).
3. **SB-08 — GPU device loss produces a zombie app**: reproduced in Odyssey — device lost during chapter load → black scene forever at a flat "60 FPS", continuous unhandled `popErrorScope` rejections, no recovery or route-out (Odyssey has no device-loss registration; several themes' `onDeviceLost` handlers are log-only).
4. **SB-10 — 42 production console errors per boot** from the intro's tetromino instancing: three TSL `addAssign` calls built outside `Fn()` are *dropped* by three r181, so the intro's warp-scatter reaction effect silently never renders (3 × 2 materials × 7 shapes = 42, stack-attributed).
5. **SB-02/SB-03 (desktop, static evidence)**: a 60 Hz Steam P2P IPC poll is never stopped after visiting Online MP once (`shutdown()` has zero callers), and the Steam-overlay frame invalidator + `backgroundThrottling:false` + default `'continue'` mean the desktop build has **no idle state at all** — flagged `REVIEW_REQUIRED` with exact desktop repro steps (§14).

Remediation is proposed in 8 batches (§9), led by: self-hosting the two font families (R1, trivial, high impact), stopping the P2P poll on mode exit + an owner decision on idle policy (R2), and heap-snapshot-guided dispose fixes for the three convicted themes plus wiring the existing lifecycle audit into CI (R3). **No optimization is recommended anywhere without a measured basis, no numerical gains are promised, and nothing here proposes lowering visual quality or changing gameplay behavior.**

## 2. Scope and target matrix

**Product targets (verified from repo, not assumed):**

| Target | Evidence | Audited here? |
|---|---|---|
| Windows desktop (Electron 38 + Steam, NSIS installer) | `package.json build.win`, `electron/main.js`, steamworks deps | Static review only — Electron binary download is blocked by this container's egress proxy (403), so no Electron runtime |
| Linux desktop (AppImage) | `package.json build.linux` | Same limitation |
| Web (GitHub Pages) | `.github/workflows/pages.yml` deploys the Vite build | **Yes — runtime-profiled** (production `vite build` served via `vite preview`, headless Chromium 141) |
| Graphics: WebGPU primary, WebGL fallback | three r181 `WebGPURenderer` per theme; `forceWebGL`/fallback paths; ADR-0008 keeps WebGL holdouts intentional | Both lanes exercised (SwiftShader software GPU — see §3 caveats) |
| Game modes | Single Player, Infinity, Odyssey, Local MP, Online MP (Steam P2P), Serenity | Single Player (full), Odyssey (smoke), menu/theme surfaces. Online/Local MP not runtime-testable (no Steam, no second input) |
| Intended frame cap | Default 60 FPS (`src/core/frame-rate-controller.js:9`, Phaser `fps.target 60` at `src/main.js:1653`); user-settable, snaps to monitor Hz via `getNearestSupportedFrameRate` (`src/utils/desktop-performance-policy.js:104`); 120/144 Hz tiers budgeted in `perf-budgets.json` | Frame budget used here: **16.7 ms** (60 Hz headless compositor) |
| Min/recommended hardware | **Not documented anywhere in the repo** | Benchmarks below are container-specific and are not generalized |

**Meanings of "lag" separated:** rendering/frame pacing (§6.2–6.4), input latency (§6.5), asset/loading stalls (§6.1, §7 SB-01), audio stalls (not measurable here, §16), network latency (not measurable here, §16).

## 3. Commit and profiling environment

| Item | Value |
|---|---|
| Commit | `fc0329234e38587b3f498c4b495d9bad20b4024a` — "Audit follow-up: re-wire desktop helpers…" (#301), tree clean |
| Container | Linux 6.18.5, 4 × Intel Xeon vCPU @ 2.80 GHz, 15.7 GiB RAM, **no physical GPU**, no display (Xvfb available) |
| Browser | Chromium 141.0.7390.37 (Playwright build), new headless; **WebGPU via SwiftShader Vulkan** (`vendor: google`, software), WebGL2 via ANGLE→SwiftShader |
| Electron | 38.8.6 locked; **binary not installable** (postinstall download → HTTP 403 through egress proxy). `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` used |
| Node / npm | v22.22.2 / 10.9.7; three 0.181.2, phaser 4.1.0, vite 5.4.21 (all from lockfile; lockfile unmodified) |
| Build under test | `npm run build` (production, 62 s), served by `vite preview --port 4173`. Dev builds were **not** used for any measurement |
| Display/refresh | Headless compositor, nominal 60 Hz BeginFrame, devicePixelRatio 1, viewport 1280×720 |
| Power mode | N/A (server container) |

### Measurement-validity caveats (apply to every number below)

1. **SwiftShader software rasterization** means absolute frame times/FPS are far below any real user GPU and are **not representative**. What remains valid: main-thread long tasks, JS CPU profiles, allocation/GC behavior, heap/listener/DOM/context growth trends, loop-count measurements, relative comparisons between scenarios, and reproducible stability defects.
2. **No Electron runtime**: Electron-main behaviors (IPC polling, `webContents.invalidate()` loop, background throttling, Steam, monitor-Hz snap) are static-evidence only → classified `REVIEW_REQUIRED`, with exact repro commands for a desktop machine.
3. **No user gesture / no audio device**: AudioContext autoplay is blocked in the harness; audio-path runtime cost unmeasured.
4. Headless Chromium 141 ≈ Electron 38's Chromium 140 — close, not identical.

## 4. Architecture and hot-path overview (as measured/verified)

- **Boot**: `index.html` → `src/main.js` `bootstrap()` (`main.js:5048`) → startup pipeline (ident shell → app init → menu → intro). `?skipIntro=1` supported (`main.js:5134`). Startup trace ring exists (`src/ui/startup-debug.js`).
- **Simulation**: legacy variable-timestep loop is the shipping default (`fixedTick` flag default **false**, `src/core/flags.js:180`); `updateGame` (`src/core/game.js:1345`) with fixed-step gravity accumulator capped at 32 steps. A canonical 60 Hz fixed-tick path exists behind the flag (plan §5.3, ADR-0012).
- **Input**: DOM keydown handlers (`src/ui/controls.js:699`); on the default path actions apply **synchronously in the keydown handler**; DAS/ARR advanced per frame from the game loop. Gamepad polled by its own rAF loop.
- **Rendering**: N concurrent surfaces — Phaser 4 WebGL board (transparent canvas), a shared raw-WebGL1 2-D background renderer (`src/rendering/renderer.js`), plus **one `THREE.WebGPURenderer` (own device+canvas) per active 3-D theme**, torn down and rebuilt on every theme switch (`src/themes/theme-manager.js:459`), plus short-lived intro/transition renderers, plus an eager hidden breathing-indicator WebGL renderer.
- **Loops**: 7–9 independent rAF/timeout chains during single-player gameplay (game loop, Phaser internal, background renderer, theme loop, FPS monitor, gamepad poll, perf monitor, cursor, board juice). Runtime-measured: **3.35 rAF callbacks per rendered frame at menu, ~4.5 during gameplay** (§6.7). A duplicate-loop guard exists (`game.js:1326`, `MAX_CONCURRENT_LOOPS = 2`) commemorating past loop-multiplication bugs; architecture-fitness ratchet pins `core-raf-drivers = 31`.
- **Events**: single synchronous event bus (`src/events/event-bus.js`), unsubscribe-function discipline used by modes/themes.
- **Themes**: 64 registered (`src/themes/theme-registry.js`), ~45 flagged heavy-GPU; LRU cache of 2 with full dispose on evict; `BaseTheme` safety nets are convention-based (standard property names only).
- **Odyssey**: own controller (2.8k lines), windowed chapter residency with eviction, seam-aware warmup; the best lifecycle discipline in the codebase.
- **Electron**: async IPC only (no `sendSync`); `backgroundThrottling: false` (`electron/main.js:567`); Steam overlay frame invalidator = 60 Hz `setInterval` calling `webContents.invalidate()` when not painting (`electron/steam-integration.js:229-237`); renderer-side default background behavior on packaged builds is `'continue'` (`src/main.js:1354-1356`).
- **Diagnostics already present**: `window.perfMonitor` (unconditional, F3 overlay, p50/p95/p99, spikes), Odyssey Electron perf harness (`npm run perf:odyssey:baseline` / `perf:odyssey:compare`), `perf-budgets.json` (most baselines pending), architecture-fitness ratchets in CI, theme-lifecycle static audit (NOT in CI, currently failing — §12).

## 5. Reproducible scenario matrix

All browser scenarios: production build at `http://localhost:4173/?skipIntro=1`, viewport 1280×720, fresh browser profile per run, deterministic seeded input bot (LCG seed 1234567), warm-up ≥3 s before each collection window. Runner: `reports/perf-audit-2026-07-16/harness/run-scenario.mjs` (§14 for exact commands).

| # | Scenario | Runs | What it measures | Status |
|---|---|---|---|---|
| S1 | Cold startup → menu-ready (default page) | 5 | wall time, startup trace phases, resource waterfall | ✅ |
| S2 | Cold startup, font CDN unreachable-fast | 5 | same, isolates SB-01 | ✅ |
| S3 | Menu idle 30 s | 5 | frame distribution, long tasks, loops, heap | ✅ |
| S4 | Single-player gameplay 30 s (bot input) | 5 | same + score progress | ✅ |
| S5 | Rapid/sustained input (DAS holds) 20 s | 3 | input-path overhead | ✅ |
| S6 | Input latency (60 synthetic keydown→state→next-frame samples) | 1×60 | event→sim→paint latency split | ✅ |
| S7 | Restart cycle ×12 (new game each 2.5 s, forced GC between) | 1 | retained listeners/timers/heap/loops per restart | ✅ |
| S8 | Theme switch cycle — 8 themes × 3 full cycles (24 switches, forced GC) | 1 | switch wall time, heap/listener/DOM/context growth, per-theme deltas | ✅ |
| S8b | Per-theme isolation toggles (forest ↔ {lunara, stellar-drift, ocean}) × 5 | 3 | per-theme heap retention | ✅ |
| S9 | Visibility hidden/visible during gameplay | 2 | loop throttling behavior, resume correctness | ✅ |
| S10 | Resize cycles (5 sizes × 4 rounds) during gameplay | 1 | resize handling, growth | ✅ |
| S11 | WebGL fallback lane (no WebGPU) gameplay | 2 | fallback works? console errors, frame stats | ✅ |
| S12 | Odyssey mode entry + 20 s (WebGPU SwiftShader) | 1 | mode boot, chapter load, errors | ✅ |
| S13 | 30-minute gameplay soak (bot; samples every 30 s) | 1 | long-session drift: heap, listeners, DOM, frame p95 | ✅ |
| S14 | CPU profiles (menu idle, gameplay) | 1+1 | self-time attribution, GC share | ✅ |
| — | Electron cold/warm start, minimize/restore, suspend/resume, context-loss injection, local/online MP, 120/144 Hz | — | — | ❌ blocked in this environment (§12, §16) |

## 6. Baseline measurements

Frame budget 16.7 ms (60 Hz). "over budget" = delta > 1.5× budget (25 ms) unless noted. All frame stats from an rAF-delta collector injected into the page; long tasks from `PerformanceObserver('longtask')`. **All absolute values carry the §3 SwiftShader caveat.**

### 6.1 Startup to menu-ready

| Variant | n | menu-ready wall (min–max) | Notes |
|---|---|---|---|
| S1 default (font CDN blackholed by container ≈ offline user) | 5 | **13,602–13,978 ms** | `boot-started` fires at ~13.4–13.8 s; boot→menu-ready is only ~200 ms |
| S2 font request aborted at network layer (`page.route` abort ≈ instant connection-refused) | 5 | **875–933 ms** | the app's own cost: boot-started ≈ 740 ms, boot→menu-ready ≈ 190 ms |
| S2-failed variant (DNS map to 127.0.0.1) | 5 | 13,442–14,017 ms | **proxied environments ignore host-resolver rules (remote DNS)** — recorded because it shows the stall depends only on how long the OS/network lets the request dangle |

Resource waterfall (S1): `fonts.googleapis.com/css2?...` pends **12,629 ms** starting at t=20 ms; **every JS module request starts only at t≈12,795 ms**. → Finding SB-01.

### 6.2 Menu idle (S3, 5×30 s)

| Metric | Run spread |
|---|---|
| frame p50 / p95 / p99 (ms) | 33.4 / 66.6–83.3 / 83.4 |
| frames > 50 ms per 30 s | 82–104 |
| frames > 100 ms | 0–3 |
| long tasks per 30 s | 0–6 |
| avg FPS (secondary) | 23.3–24.7 |
| JS heap (before→after) | 34.7 → 33.3–33.5 MB (flat) |
| rAF callbacks per rendered frame | 3.34–3.37 |
| Live WebGL contexts / listeners / intervals | 4 / 356 / 1 (`syncFromCloud` @15 min) |

### 6.3 Gameplay (S4, 5×30 s)

| Metric | Run spread |
|---|---|
| frame p50 (ms) | 66.7 (all runs) |
| frame p95 / p99 / max (ms) | 100–133 / 133–150 / 133–183 |
| frames > 50 ms per 30 s | 360–385 (of ~404–447) |
| frames > 100 ms per 30 s | 22–40 |
| long tasks per 30 s (total ms) | 0–9 (0–525 ms) |
| avg FPS (secondary) | 13.5–14.9 |
| JS heap before→after | 36→40.3, 38.1→36.4, 38.1→35.2, 35.6→37.9, 37.7→36.2 (no monotonic growth) |
| rAF callbacks per rendered frame | 4.45–4.51 |

Key interpretation: even at 67 ms frames the main thread produces at most a handful of >50 ms *tasks* per 30 s — the page is **compositor/raster-bound (software GPU), not JS-bound**, in this environment. JS-side cost attribution is in §6.8.

### 6.4 Rapid input (S5, 3×20 s)

Frame distribution statistically identical to normal gameplay (p50 66.7, p95 116.7); heap flat; 0–1 long tasks. The DAS/input path adds no measurable main-thread cost at 60+ inputs/min.

### 6.5 Input latency (S6, 60 samples)

- **60/60 keydowns mutated game state synchronously inside the keydown handler** (legacy default path) — event→simulation latency ≈ 0 ms.
- Event→next-painted-frame: p50 **81 ms**, p95 163 ms — i.e., ~1 render frame at this environment's 67 ms frame time. On hardware meeting the 16.7 ms budget this corresponds to ≤1 frame of visual latency. No queuing/multi-frame anomalies observed.
- Note: the flag-gated fixed-tick path (`fixedTick`, default off) intentionally stamps input for the *next* tick (+≤16.7 ms) for determinism (`src/ui/controls.js:216-280`).

### 6.6 Restart / theme-switch / visibility / resize / WebGL lane (S7–S11)

**S7 restart ×12** (forced GC before each snapshot): heap 35.0→34.8 MB, DOM 1783, listeners 355, WebGL contexts 4, intervals 1 — **all flat across 12 restarts**. Restart lifecycle is clean (`GameModeManager` reuses mode instances; nothing accumulates).

**S8 theme cycle** — first attempt (at menu) was a **methodological dead end worth recording**: `switchTheme()` resolves in 2–32 ms at the menu because themes are *suspended* there (`theme-manager.js:503-507` defers activation), so nothing loads. Re-run **in-game** (8 themes × 3 cycles = 24 switches, `HeapProfiler.collectGarbage` before every reading):

| Metric | Cycle 0 end | Cycle 1 end | Cycle 2 end |
|---|---|---|---|
| GC'd JS heap (MB) | 52.0 (from 35.0 start) | 68.7 | **82.7** |
| WebGL context *creations* since boot | 6 | 8 | 12 |
| Listeners / intervals / canvases | 349 / 1 / 24 | 346 / 1 / 24 | 353 / 1 / 25 |

- **Heap grows monotonically ≈ +2 MB per switch on average and never returns to baseline despite forced GC** → retained per-activation state. Per-theme deltas repeat across cycles: **lunara ≈ +10 MB per activation** (41.2→51.5, 53.8→63.2, 72.1→82.8), **stellar-drift ≈ +4.8 MB**, **ocean ≈ +1.5–4.4 MB**; winter/forest/sunset/singing-bowl ≈ flat heap. Isolation runs in §6.6b.
- `sunset` and `singing-bowl` create **one new WebGL context on every activation** (4→5→6…→10) — consistent with the rebuild-per-switch design (§7 SB-12/SB-04 context) but a context-pool pressure vector; both are on the failing lifecycle-audit list.
- **Stability event reproduced during cycling:** ocean's WebGPU device was lost (`[Ocean] WebGPU device lost … A valid external Instance reference no longer exists`) and the app then emitted a continuous stream of **unhandled promise rejections** (`OperationError: Instance dropped in popErrorScope`) — the render/error-scope loop keeps running against a dead device (§7 SB-15). Device loss itself may be a SwiftShader artifact; the unhandled-rejection spam and absent route-out are code behavior.
- Theme-switch wall times (SwiftShader-inflated; relative ordering meaningful): lunara 2.7–3.1 s, neon-district 0.7–3.8 s, ocean 1.1–1.5 s, stellar-drift 1.3–1.4 s, sunset ≈0.3 s, winter ≈0.2 s, cached forest 3 ms.

**S8b per-theme isolation (forest ↔ X, 5 toggles each, GC-forced heap read on each forest return):**

| Theme | Heap on successive forest returns (MB) | Retained per visit |
|---|---|---|
| lunara | 35.1 → 40.2 → 43.4 → 45.8 → 49.7 | **≈ +3.3 MB net, monotonic — confirmed leak** |
| stellar-drift | 35.1 → 40.7 → 43.5 → 46.5 → 49.4 | **≈ +2.9 MB net, monotonic — confirmed leak** |
| ocean | 35.0 → 39.7 → 42.1 → 44.7 → 47.2 | **≈ +2.4 MB net, monotonic — confirmed leak** (ocean device-lost log again fired during toggling) |

(A `three` core "WebGPU Device Lost: A valid external Instance reference no longer exists" also fired during lunara toggling — in this environment device-teardown on switch is entangled with Dawn instance lifetime; see SB-15 for why the aftermath, not the trigger, is the code finding.)

**S9 visibility (synthetic `visibilitychange` + `document.hidden` override, browser lane)**: no pause/stuck-loop/resume defect — frame stats and rAF chains identical before (p50 66.7)/hidden/after (p50 66.7–66.8), sim continued (browser default is `'reduce'`, which throttles theme *work*, not rAF scheduling; rAF chains stayed 4.55–4.58). **Limitation:** synthetic hidden does not trigger Chromium's real occlusion throttling, so this validates app logic only, not the OS-level idle behavior (Electron `'continue'` + invalidator path is SB-03, untestable here).

**S10 resize (5 sizes × 4 rounds during gameplay)**: heap 35.7→34.1 MB, DOM/listeners/contexts flat, no errors. No render-target/listener accumulation on resize. (One-shot cost per resize not isolable at SwiftShader frame times.)

**S11 WebGL fallback lane (2×30 s gameplay, `navigator.gpu` absent)**: boots and plays with **zero fallback-related console errors**; frame p50 66.7 / p95 116.6–133.3 — statistically identical to the WebGPU lane on this software rasterizer. The fallback path is functional.

### 6.7 Loop concurrency (runtime)

Measured rAF callbacks scheduled per rendered frame: **3.35 (menu), ~4.5 (gameplay)** — i.e., 3–5 independent per-frame callback chains live simultaneously, corroborating the static loop inventory (7–9 potential chains; some coalesce or are idle at any given moment). Architecture-fitness pins `core-raf-drivers = 31` call sites.

### 6.8 CPU profiles (S14, 25 s each, 200 µs sampling)

| Scenario | Main-thread busy | GC share | Top named self-time entries |
|---|---|---|---|
| Gameplay | **5.2 %** | 0.71 % | SinglePlayerMode internals 0.92 %+0.54 %, `getBoundingClientRect` 0.36 %, `matchMedia` 0.10 %, cursor `updateCursorVisuals`/`syncPresentation` ~0.15 %, Phaser batch ~0.12 % |
| Menu idle | **2.1 %** | 0.77 % | `getBoundingClientRect` **0.55 %** (largest single consumer — cursor/menu layout reads), `bufferData` 0.15 %, background `renderFrame` 0.07 % |

Interpretation: in single-player the main thread is nearly idle even at 4 vCPUs — **frame times in this environment are raster/compositor-bound (software GPU), not JS-bound**. No JS function concentrates cost; GC is <1 % (consistent with the flat heaps in §6.2–6.4). The absolute shares will differ on real hardware, but nothing in the single-player JS path profiles as a hotspot. Layout reads (`getBoundingClientRect`) being the top named entry at *menu idle* corroborates SB-06's class of concern (DOM geometry reads on per-frame paths — here the custom cursor), though at this sampling it is far from a measured bottleneck.
Raw profiles: `results/cpuprofile-gameplay.cpuprofile`, `results/cpuprofile-menu-idle.cpuprofile` (loadable in Chrome DevTools Performance panel).

### 6.9 Soak (S13, 30 min continuous bot gameplay, 60 samples, GC forced before each heap read)

| Metric | Start (0.3 min) | Mid (15.4 min) | End (30 min) |
|---|---|---|---|
| GC'd heap (MB) | 35.4 | 37.1 | 36.8 (session min/max: **35.3–37.5 — flat**) |
| frame p50 / p95 (ms) | 33.4 / 66.6 | 33.3 / 50.1 | 33.3 / 50.0 |
| DOM nodes | 1783 | 1851 | 1850 (plateaued) |
| Listeners (counter) | 352 | 382 | 409 (see below) |
| Intervals | 1 | 1 | 1 |

- **No long-session degradation**: heap flat over 30 minutes of continuous play with many game-over/restart cycles; frame p95 actually *improved* from 66→50 ms during the session (consistent with warm caches and/or the adaptive-quality systems engaging); no crashes, no error spam (single pre-existing font-CDN error), no interval/DOM growth.
- **Listener-counter growth investigated (follow-up 7-min run with per-type deltas):** all growth is `click` listeners at ~2 per game-over. Attribution: `showGameOverModal` rebuilds the buttons container via `innerHTML` and binds a fresh listener each time (`src/ui/modals.js:473-491`) — the previous button is discarded with the DOM, so the counter (which only sees add/remove calls) rises while real retained memory does not (heap + DOM flat). Recorded in §8 as NP-10, with the caveat that an `{ once: true }`-style or persistent binding would make the diagnostic signal cleaner.

### 6.10 Odyssey smoke (S12)

Odyssey Mode entered successfully from the menu (HUD live, `0/168, Progress: 0%`); mode reported `isRunning` after **36.8 s** (menu-click → running; includes chapter loading on the software GPU — not representative of real hardware).

**Stability event (the important part):** during chapter load the WebGPU device was lost (`THREE.WebGPURenderer: WebGPU Device Lost … A valid external Instance reference no longer exists`), after which the app produced a continuous stream of unhandled `OperationError: Instance dropped in popErrorScope` rejections and rendered a **black scene indefinitely** — at a perfectly flat 16.7 ms/60 FPS (nothing left to render), which also illustrates why average FPS alone is a misleading health metric. **No recovery attempt and no route-out occurred — exactly the gap SB-08 identified statically** (`OdysseyBoardController` has no device-loss registration). The *loss trigger* here is likely a SwiftShader/Dawn instance-lifetime artifact and is not claimed to reproduce on real hardware; the *aftermath behavior* (no handling, error spam, zombie mode) is application code and will be the same after any real device reset (TDR — which CLAUDE.md documents has happened on the dev iGPU).
Artifacts: `results/odyssey-smoke.json`, screenshots `odyssey-1.png` / `odyssey-2.png` (black board with live HUD).

## 7. Findings

Every finding lists: classification, severity/confidence, targets & scenarios, files, reproduction, measurements, root cause, user impact, smallest safe remediation, metric expected to change, risks, validation, blockers. Findings are ordered by (measured user impact × confidence) ÷ (risk × effort).

---

### SB-01 · Startup is gated on a render-blocking Google Fonts request — offline/blocked-network machines stall the whole boot
**Classification:** `MEASURED_BOTTLENECK` (also a stability defect for offline desktop players) · **Severity: High · Confidence: High**
**Targets/scenarios:** all targets, cold & warm startup (S1/S2). Applies verbatim to the packaged Electron build (`dist/index.html` ships the same tag).
**Files:** `index.html:83-85` → `dist/index.html:84` (`<link href="https://fonts.googleapis.com/css2?family=Orbitron...&family=Space+Mono...&display=swap">`, no `media`/`preload` trick, no timeout).
**Reproduction:** load the production build with `fonts.googleapis.com` unreachable-but-slow (this container's egress proxy holds the socket ~12.6 s before reset — equivalent to a firewalled/offline/flaky-DNS user). Measure `__serenityStartupTrace`.
**Measurements:** 5/5 runs: menu-ready 13,602–13,978 ms; the font stylesheet pends **12,629 ms** (starts t=20 ms); **all JS module fetches begin only after it settles (t≈12,795 ms)**; `boot-started`→`menu-ready` is just ~200 ms. Variant with the request force-aborted at the network layer: see §6.1 S2 row — startup collapses to the app's own cost.
**Root cause:** a parser-blocking external stylesheet in `<head>` ahead of the entry module script — script execution waits for pending stylesheets, so one dead CDN serializes the entire boot. `display=swap` only helps after the CSS arrives; it does nothing for a hanging request.
**User impact:** offline Steam players / firewalled networks / captive portals / flaky DNS see a black shell for as long as the OS lets the connection dangle (12+ s here; OS-dependent, can be worse), on **every** launch. A desktop game must boot with zero network.
**Smallest safe remediation:** self-host Orbitron (400/700/900) + Space Mono (400/700) as woff2 under `public/` with `@font-face` + `font-display: swap`; delete the CDN `<link>`. Visuals unchanged (same fonts, now deterministic).
**Metric expected to change:** `timeToMenuReadyMs` on network-degraded machines: from ~13.9 s to the S2 baseline; unchanged on fast networks (minus one request).
**Risks:** none to gameplay; license note — both families are OFL, bundling is permitted; keep weights identical so text metrics don't shift.
**Validation:** before/after S1 vs S2 (commands §14); also verify packaged Electron offline launch.
**Blockers:** none.

---

### SB-02 · Steam P2P 60 Hz IPC poll is never stopped after visiting Online MP once
**Classification:** `REVIEW_REQUIRED` (strong static evidence; Electron runtime unavailable here) · **Severity: High (desktop) · Confidence: High on existence, Unmeasured on cost**
**Files:** `src/core/steam/steam-networking.js:818-843` (`startP2PPolling`, 16 ms `setInterval` → `ipcRenderer.invoke('steam:readP2PPacket')` with a drain loop), `:1179` (`shutdown()` — **zero callers repo-wide**, grep-verified); `leaveLobby()` (`:1102`) and `_resetLobbySession()` (`:1545`) do not clear the interval; `OnlineMultiplayerMode` instance is cached forever by `GameModeManager` (`GameModeManager.js:136-150`).
**Reproduction (on a desktop build):** launch with Steam, enter Online MP once, leave to menu, play single-player; observe `steam:readP2PPacket` invocations continuing at ~60 Hz (main-process profiler or IPC logging).
**Root cause:** polling lifecycle tied to `SteamNetworking.init()` but no teardown call site; mode caching makes the instance immortal.
**User impact:** ~60 cross-process IPC round-trips/s (each hitting synchronous native Steam reads in the main process, `electron/steam-integration.js:1052-1070`) for the rest of the session — constant background CPU on both processes, battery drain, and jitter risk on low-core machines, even in menus and other modes.
**Smallest safe remediation:** stop polling on `OnlineMultiplayerMode.onDeactivate` (and restart on activate) — or call `shutdown()` from the mode's cleanup; keep behavior identical while a lobby/match is live (never-pause carve-out untouched).
**Metric:** main+renderer idle CPU% at menu after visiting Online MP; IPC calls/s.
**Risks:** must not stop polling while in a lobby/mid-match or during host migration; verify reconnect paths re-arm the poll.
**Validation:** desktop run: enter/leave Online MP, count `steam:readP2PPacket` calls/s at menu before/after fix; full MP match still works.
**Blockers:** Electron+Steam runtime (not available in this container).

---

### SB-03 · Desktop build never idles: 60 Hz forced repaint + `backgroundThrottling: false` + default `'continue'` when hidden
**Classification:** `REVIEW_REQUIRED` (static; Electron unavailable) · **Severity: Medium-High (battery/thermals) · Confidence: High on existence**
**Files:** `electron/steam-integration.js:229-237` (60 Hz `setInterval`: `if (!webContents.isPainting()) webContents.invalidate()` — i.e., it specifically forces composition when the window is occluded/minimized/hidden, for Steam-overlay correctness), cleared only on window close (`:239`); `electron/main.js:567` (`backgroundThrottling: false`); `src/main.js:1354-1356` (packaged default `backgroundTabBehavior: 'continue'`).
**Reproduction (desktop):** launch with Steam, minimize the window at menu; sample process CPU/GPU — full-rate composition continues indefinitely.
**Root cause:** three deliberate anti-throttling mechanisms compose into "no idle state exists": rendering loops keep running (`'continue'`), Chromium won't throttle them (`backgroundThrottling:false`), and even if nothing paints the invalidator forces 60 Hz composition.
**User impact:** sustained CPU/GPU burn while minimized/occluded (menus, pause, alt-tabbed for hours). No `powerSaveBlocker` involvement — this is self-inflicted repaint.
**Smallest safe remediation candidates (owner decision, §13):** (a) pause the invalidator while `browserWindow.isMinimized()` unless the Steam overlay is open; (b) drop invalidator frequency when unfocused; (c) renderer-side `'reduce'` when hidden **and** no online match (the never-pause carve-out already exists, `src/main.js:1412-1426`).
**Metric:** desktop process CPU% minimized/occluded at menu; frame production rate while hidden.
**Risks:** Steam overlay must remain functional (the invalidator exists for it); online matches must never pause (ADR/plan requirement).
**Validation:** desktop before/after CPU sampling minimized, overlay open/closed, during an online match.
**Blockers:** Electron+Steam runtime.

---

### SB-04 · 26 of 64 themes fail the repo's own lifecycle audit; `BaseTheme` safety nets are name-convention-based
**Classification:** `REPRODUCED_STABILITY_DEFECT` (the audit tool reproducibly fails today) + `REVIEW_REQUIRED` for per-theme runtime impact · **Severity: Medium-High · Confidence: High that the checks fail; per-theme leak severity varies**
**Files:** `npm run audit:theme-lifecycle` → **exit 1, 28 findings across 26 theme files** (classes: `stop()` without `cleanup()` override; raw `resize` listeners outside the tracked-listener helpers) — e.g. `sunset`, `singing-bowl`, `starlight`, `swedish-forest`, `synthwave-sunset`, `rainy-window`, `sky-children-v2`, `void-ember`, `waves`, `moonlit-greenhouse`… Safety-net gap: `BaseTheme.cleanup()`/`cancelAnimationFrames()` only catch standard property names (`src/themes/base-theme.js:262-294, 530-540`).
**Runtime cross-check (S8):** 24 theme switches across 8 themes with forced GC — results in §6.6; growth trends per cycle are the ground truth for which of these are *live* leaks vs latent.
**Root cause:** per-theme discipline varies; the guardrail script exists but is not enforced in CI (`pages.yml` runs fitness/lint/tests — not this).
**User impact:** theme switching (a first-class feature incl. `autoThemeChange` every N minutes, `settings.js:24`) can accumulate listeners/GPU resources on the flagged themes; historical evidence (SMOOTHNESS_AUDIT 2026-06-04) documents whole-context leaks in this class.
**Smallest safe remediation:** fix the 28 findings (add `cleanup()` overrides calling `super.cleanup()`, route resize listeners through `registerEventListener`), then wire `audit:theme-lifecycle` into `pages.yml` as a hard gate.
**Metric:** S8 heap/listener/context deltas per full cycle → flat; audit exit 0 in CI.
**Risks:** disposal bugs can double-free — each theme fix needs a switch-in/switch-out smoke (playground protocol per CLAUDE.md).
**Blockers:** none (pure repo work).

---

### SB-05 · Per-frame allocation churn in specific theme animate loops
**Classification:** `REVIEW_REQUIRED` (verified allocation sites; GC cost not isolable under SwiftShader) · **Severity: Medium · Confidence: High that allocations exist; Medium on user-visible cost**
**Files/sites (all verified in current code):**
- `src/themes/singing-bowl/singing-bowl-theme.js:905-951` — `updateInstanceMatrices()` allocates **per instance per frame** (`new THREE.Quaternion()` + `new THREE.Vector3(0,1,0)` inside the loop); `instanceCount` = up to `maxCubes*2` (presets 2,500–6,000, `:31-40`, cap `:824`) ⇒ **up to ~12k short-lived objects per frame** on Extreme.
- `src/themes/sunset/sunset-theme.js:1055-1060` — 5 × `new THREE.Color` every frame in `updateFog()`.
- `src/themes/astral-weave/astral-weave-theme.js:1794-1795` — 2 × `new THREE.Vector3` per frame.
- `src/themes/stellar-drift/stellar-drift-theme.js:5529-5532` — 4 × `new THREE.Vector3` per meteor update.
- `src/themes/sakura-twilight/sakura-twilight-theme.js:2985,3015,3038` — per-frame `Vector3` while fox greeting runs.
- `src/rendering/odyssey/OdysseyCameraController.js:1853` — `new THREE.Vector3()` per frame during portal approach.
**Measurements:** GC share during gameplay CPU profile: §6.8; theme-cycle GC'd heap per theme: §6.6. (On this machine GC never produced >50 ms pauses in 30 s windows; the risk is hitch amplification on 120–144 Hz targets where budget is 6.9–8.3 ms.)
**Root cause:** missing scratch-object reuse (`this._tmpVec` pattern — already used correctly in neon-district/stellar-drift elsewhere).
**Smallest safe remediation:** hoist to reusable scratch objects; zero behavioral change.
**Metric:** allocation rate (heap sawtooth slope) and GC events/min while these themes are active; long-task count on high-Hz budgets.
**Risks:** trivial (mutation aliasing — keep scratch objects function-local per call chain).
**Validation:** DevTools allocation sampling before/after per theme; visual screenshot parity (CLAUDE.md WebGPU workflow).
**Blockers:** representative-GPU measurement for the "does it hitch" half.

---

### SB-06 · `lunara` forces layout reads per particle per frame; `petal` behavior spawns untracked timeouts in the update loop
**Classification:** `REVIEW_REQUIRED` · **Severity: Medium (theme-specific) · Confidence: High on existence**
**Files:** `src/rendering/renderer.js:513-519` (`spiraling-debris`: `island.raw.getBoundingClientRect()` **per particle per frame**; used by lunara with ~2 island targets, `renderer.js:1234-1258`); `renderer.js:475-484` (`petal`: `setTimeout` created inside `update()` on gust events, untracked).
**Root cause:** DOM geometry read in the per-particle hot loop instead of caching per frame (or per resize); timer created in update path without lifecycle tracking.
**User impact:** with style/layout dirty (score popups, HUD updates happen every frame during play), each rect read can force synchronous layout — scales with particle count while lunara is active.
**Smallest safe remediation:** hoist the rect read to once per island per frame (or cache and invalidate on `VIEWPORT_RESIZED`); track the gust timeout for cleanup.
**Metric:** style/layout time in a DevTools trace while lunara is active; forced-reflow warnings.
**Validation:** trace before/after with lunara + gameplay HUD updates.
**Blockers:** none.

---

### SB-07 · A hidden Three.js WebGL renderer is created eagerly at boot and can never be disposed
**Classification:** `REVIEW_REQUIRED` · **Severity: Low-Medium · Confidence: High**
**Files:** `src/main.js:941` (`initEnhancedBreathingIndicator()` during app init) → `src/ui/effects/enhanced-breathing-indicator.js:169` (constructor creates `new ThreeJSBreathingRenderer(...)` → live `THREE.WebGLRenderer`, 700×700 canvas) while the indicator is `display:none`; `ThreeJSBreathingRenderer.dispose()` exists (`threejs-breathing-renderer.js:1391-1408`) but has **zero callers**; `EnhancedBreathingIndicator.destroy()` (`:845`) skips it (and is itself never called — singleton).
**Measured:** 4 live WebGL contexts at menu (S3) — background renderer, Phaser, breathing renderer + 1; one belongs to a feature that may never be used in the session.
**User impact:** one always-resident GPU context + swapchain on every launch regardless of the breathing feature being enabled; contributes to context-pool pressure (browsers cap ~8-16 contexts) alongside per-theme contexts.
**Smallest safe remediation:** lazy-create on first `start()`; wire `dispose()` into `destroy()` for correctness.
**Metric:** live context count at menu (4 → 3); no change when breathing indicator is used.
**Risks:** first breathing activation pays a one-time init (~tens of ms) — acceptable/off critical path, but verify no visible delay.
**Blockers:** none.

---

### SB-08 · Odyssey has no WebGPU device-loss handling (known-pending), on the workload most likely to TDR — zombie-mode aftermath reproduced
**Classification:** `REPRODUCED_STABILITY_DEFECT` (the *aftermath*: S12 reproduced device loss during Odyssey load → black scene forever, continuous unhandled rejections, no route-out; the *trigger* in this environment is SwiftShader-specific, so real-hardware loss frequency remains unmeasured) · **Severity: Medium-High (desktop iGPU users) · Confidence: High**
**Files:** `src/rendering/odyssey/OdysseyBoardController.js` — no `monitorWebGPU`/`registerGpuSurface`/`device.lost` usage (grep-verified); central plumbing exists and is used by ~20 themes (`src/utils/gpu-context-resilience.js`, `src/utils/gpu-loss-coordinator.js:22-25` — whose comments say Odyssey migration is pending). CLAUDE.md documents real TDR crashes on the dev iGPU during full-journey Odyssey captures.
**User impact:** a TDR/device-reset mid-journey leaves a dead canvas with no recovery or route-out; player must kill the app.
**Smallest safe remediation:** register the Odyssey surface with the existing `gpu-loss-coordinator` route-out path (one recovery attempt → menu), matching theme behavior.
**Metric:** `gpuLossRecoveredRatio` budget (declared, baseline pending in `perf-budgets.json`).
**Validation:** desktop with real GPU: trigger device loss (e.g. TDR via debug tooling or `device.destroy()` in DevTools) during Odyssey; app routes to menu instead of freezing.
**Blockers:** needs real-GPU hardware.

---

### SB-09 · The repo's perf/lifecycle gates exist but aren't enforced: failing lifecycle audit, budget baselines pending, compare tool unwired
**Classification:** `OBSERVABILITY_GAP` · **Severity: Medium (it's how the other findings regress back in) · Confidence: High**
**Evidence:** `audit:theme-lifecycle` fails today and is not in `pages.yml`; `perf-budgets.json` has `baseline: null` for `timeToMenuReadyMs`, `frameP95Ms.perSurface`, GC/loss ratios; `scripts/odyssey-perf-compare.mjs --fail-on-regression` exists but no CI/nightly consumer; no `PerformanceObserver('longtask')`/LoAF instrumentation anywhere in `src/` despite a 1,589-line perfMonitor.
**Smallest safe remediation:** (a) wire lifecycle audit into CI once SB-04 lands; (b) capture the pending baselines with the existing Odyssey harness on the named machines and commit them; (c) run `perf:odyssey:baseline`+`compare` in the existing nightly GPU lane (`gpu-validation.yml`) with `--fail-on-regression`; (d) add a long-task/LoAF counter to perfMonitor (it already has the ring buffer and spike plumbing).
**Blockers:** the nightly lane's hardware (RTX5080 laptop per budgets file) — owner scheduling.

---

### SB-10 · Production console: 31 × `THREE.TSL: No stack defined for assign operation` at every boot
**Classification:** `REPRODUCED_STABILITY_DEFECT` (reproducible error spam; underlying TSL graph may silently no-op) · **Severity: Low-Medium · Confidence: High on reproduction**
**Evidence:** every boot **with the intro** logs these errors (42 with full intro; 31 when the intro is cut short). CDP stack attribution: **all 42 originate in `threejs-intro-renderer-webgpu` → `initTetrominoInstancing` → `createPositionNode`** — the three `worldPos.{x,y,z}.addAssign(...)` "big-combo warp scatter" lines (`src/ui/threejs-intro-renderer-webgpu.js:978-980` region) executed at node-graph construction time, outside any `Fn()`. 3 assigns × 2 materials (base+glow) × 7 tetromino shapes = **42, exactly matching the count**.
**Root cause:** TSL `assign()`/`addAssign()` outside an `Fn()` stack is **dropped** by three r181 — so beyond console spam, the intro's `uReactionScatter` warp-scatter reaction visual **silently never applies**.
**User impact:** 42 console errors every boot; one intro reaction effect is non-functional (a real, if subtle, visual regression nobody flagged).
**Smallest safe remediation:** compute the scatter offset as a pure expression (`worldPos = worldPos.add(vec3(...))`) or move the mutation into an `Fn()` per the `webgpu-threejs-tsl` skill guidance.
**Validation:** boot with clean console; intro screenshot parity plus one shot with `uReactionScatter` forced >0 to confirm the effect now fires.
**Blockers:** none.

---

### SB-11 · Audio keeps playing and the audio graph never suspends when hidden; breathwork audio teardown gaps
**Classification:** `REVIEW_REQUIRED` (may be intentional product behavior) · **Severity: Low-Medium · Confidence: High on facts**
**Files:** zero `audioContext.suspend()` calls repo-wide; `SoundManager.handleVisibilityChange` only throttles analysis (`src/audio/sound-manager.js:81-87`); `BreathworkAudioManager.destroy()` never called and `voicePendingTimeout` survives `stopAll()` (`src/ui/effects/breathwork-audio-manager.js:190,228,238`) — a scheduled voice cue can fire after the user stopped the session.
**User impact:** music audible + audio pipeline active while minimized (desktop default `'continue'` — possibly by design for a relaxation game); stray breathwork voice line after stopping (a real, if rare, correctness bug).
**Smallest safe remediation:** clear `voicePendingTimeout` in `stopAll()`; owner decides §13 whether hidden-state audio is intended (if not: `suspend()` on hidden when no online match).
**Blockers:** audio not testable in this environment.

---

### SB-12 · Loop concurrency: 3–5 live rAF chains per frame measured (7–9 statically), Phaser + game loop + background renderer + theme all render independently
**Classification:** `REVIEW_REQUIRED` (measured count; cost share not isolable on SwiftShader) · **Severity: Medium (structural) · Confidence: High on count**
**Evidence (runtime):** 3.34–3.37 rAF callbacks/frame at menu, 4.45–4.51 during gameplay (§6.7). Static inventory: game loop (`src/core/game.js:1437`), Phaser internal, background renderer (`src/rendering/renderer.js:1011`), per-theme loop (`base-theme.js:849` or `setAnimationLoop`), FPS monitor (`main.js:1988`), gamepad poll (`gamepad-controller.js:589`), perfMonitor (`performance-monitor.js:861`), cursor, board juice. The background 2-D renderer runs its loop **even when a theme registers no particle systems** (`renderer.js:1533-1537` default branch still calls `start()`); guard comments at `game.js:1445-1467` record historical loop-multiplication bugs.
**User impact:** every chain adds per-frame fixed overhead (callback dispatch, state checks, in some cases full GL clears) and one more surface for pacing jitter; on 6.9 ms (144 Hz) budgets fixed overhead matters. ADR-0012 already designates `FrameRateController` as "the sole timer owner" — the end-state is consolidation.
**Smallest safe remediation (incremental, no rewrite):** (a) don't `start()` the background renderer when it has zero layers and zero particle systems (park until `addLayer`/`loadTheme` adds content); (b) stop the FPS-monitor rAF when the F3 overlay is hidden; (c) fold gamepad polling into the existing render tick.
**Metric:** rAF callbacks/frame at menu (3.35 → ~2), CPU per frame on real hardware.
**Risks:** the background renderer must still wake for late-added particles; gamepad menu navigation must keep working when no render loop runs (menu still has loops).
**Blockers:** cost-share measurement needs real hardware.

---

### SB-13 · Media/bundle weight is far over the repo's own budgets (known breach, quantified here)
**Classification:** `MEASURED_BOTTLENECK` (against the repo's declared budgets; disk/install/startup IO, not frame time) · **Severity: Medium · Confidence: High**
**Measurements:** `dist/` = **621 MB**: music 257 MB (36 tracks ride inside app.asar per `perf-budgets.json` note), textures 86 MB, two breathwork voice WAVs 26 + 25 MB (uncompressed WAV in `dist/assets/audio/breathwork/voices/elixir/`), single 14 MB PNG albedo, 12 + 11 MB GLBs. `perf-budgets.json` already declares breaches: `installerBytes` 625.9 MB vs 450 MB max, `appAsarBytes` 677.6 MB vs 262 MB max (Phase 8.2 planned).
**Remediation:** already planned (Phase 8.2 asarUnpack + media diet); this audit adds: the two WAVs → opus/ogg (~50 MB → ~5 MB), the 14 MB PNG → KTX2 (pipeline already wired per Odyssey masterplan).
**Blockers:** none; product QA on audio/texture quality.

---

### SB-15 · Theme switching leaks JS heap (reproduced), and after a WebGPU device loss the app keeps rendering into the dead device
**Classification:** `REPRODUCED_STABILITY_DEFECT` · **Severity: High (theme cycling is a first-class feature incl. `autoThemeChange`) · Confidence: High (leak trend); Medium (device-loss aftermath severity — loss trigger may be environment-specific)**
**Targets/scenarios:** all targets; S8-ingame (24 switches), S8b isolation toggles.
**Measurements (§6.6):** GC-forced heap 35.0 → 82.7 MB over 24 switches, never returning to baseline; repeatable per-theme deltas — **lunara ≈ +10 MB, stellar-drift ≈ +4.8 MB, ocean ≈ +1.5–4.4 MB per activation** (S8b isolates per theme). During cycling, ocean's WebGPU device was lost and the page then produced a continuous stream of unhandled `OperationError: Instance dropped in popErrorScope` rejections — the render/error-scope loop keeps polling a dead device; no route-out occurred (the `gpu-loss-coordinator` route-out is wired for registered surfaces; the failure mode reproduced regardless).
**Files:** theme dispose paths of the three named themes (`src/themes/lunara/`, `src/themes/stellar-drift/stellar-drift-theme.js`, `src/themes/ocean/`) vs `BaseTheme.cleanup()` conventions (`src/themes/base-theme.js:262-294, 530-540`); loss plumbing `src/utils/gpu-context-resilience.js:80-122`, `src/utils/gpu-loss-coordinator.js:37-106`. Device-loss handler quality varies by theme: stellar-drift and cosmic-noir install a real `handleDeviceLoss` (`stellar-drift-theme.js:1567`, `cosmic-noir-theme.js:2072`) while **ocean and swedish-forest are log-only** (`ocean-theme.js:1127`, `swedish-forest-theme.js:767`).
**Reproduction:** §14 S8 commands; watch `heapMB` column climb; the loss aftermath reproduces whenever a WebGPU device dies while a theme renders (SwiftShader makes this easy; on desktop use a TDR).
**Root cause:** per-theme retained state escaping dispose (exact retainers need a heap-snapshot diff on the named themes — 30-minute follow-up each with DevTools, see validation); separately, ocean's device-loss hook is **log-only** — `this.renderer.onDeviceLost = (info) => { console.error(...) }` (`src/themes/ocean/ocean-theme.js:1127-1129`) — it neither stops the animation loop nor routes out, so three's backend keeps polling `popErrorScope()` against the dead device and every poll rejects unhandled. (Whether the loss trigger here was a SwiftShader instance-GC artifact or a disposal race, the aftermath behavior is the code's.)
**User impact:** long sessions with `autoThemeChange` (every 60 min by default when enabled) or manual theme browsing grow the heap without bound; after a GPU reset the app spins on a dead device instead of recovering/routing out.
**Smallest safe remediation:** (1) heap-snapshot diff per named theme → fix its dispose; (2) attach a `.catch` to error-scope polling and stop the theme loop on `device.lost` (coordinator already offers the route-out).
**Metric:** S8 heap trend flat after fix; no unhandled rejections after induced loss.
**Risks:** dispose fixes can double-free (same as SB-04).
**Blockers:** none for the leak; real-GPU for a realistic loss trigger.

---

### SB-14 · Fixed-tick migration status (context, not a new finding)
The shipping default is the legacy variable-timestep loop (`fixedTick: false`, `src/core/flags.js:180`); cascade animation timing is wall-clock rAF-dependent on that path (`src/core/physics.js:35-55`), and the repo's own KPI records cascade input latency p95 baseline 300 ms vs 17 ms target (`perf-budgets.json`). This is an in-flight, ADR-governed migration (plan §5, ADR-0011/0012) — **no action recommended here beyond continuing the plan**; noted so this audit's latency numbers are read in context (S6 measured the *non-cascade* path at ≈0 ms sim latency).

## 8. Investigated — not a problem

| ID | Suspicion (source) | Evidence of harmlessness |
|---|---|---|
| NP-1 | Ghost-piece landing recomputed via collision loop every frame (`AUTO_DROP_FINDINGS_SUMMARY.txt`) | **Fixed since**: `getGhostLandingY` is cached + dirty-flagged (`src/core/game.js:522-547`) and `base-board-scene.js:1033` uses it. No hot recompute remains. |
| NP-2 | Physics promise without `.catch()` → permanent freeze (SMOOTHNESS_AUDIT 2026-06-04, game.js:722) | **Fixed since**: `gameState.latestPhysicsPromise` has `.catch` with recovery spawn + board dirty-mark (`game.js:1309-1321`). |
| NP-3 | Event bus copies the listener set on every emit (`event-bus.js:189`) | Deliberate correctness measure (mutation-during-emit), commented as such; sets are small; no long tasks attributable to emits in any profile. Leave as is. |
| NP-4 | `window.perfMonitor` installed unconditionally in production | It's the repo's intended field-diagnostics surface (F3 overlay, export). Idle cost not detectable in profiles (§6.8). Its rAF loop is part of SB-12(b) only. |
| NP-5 | Menu/gameplay heap growth | None observed: menu 5×30 s flat (34.7→33.4 MB), gameplay 5×30 s flat, restart ×12 and 30-min soak: §6.6/§6.9. |
| NP-6 | Input path overhead under sustained DAS input | S5: frame distribution identical to normal gameplay, 0–1 long tasks, heap flat. |
| NP-7 | InfinityMode minimap listeners not removed (recon flag) | Attached to the minimap's own DOM container which `minimap.destroy()` removes — GC-reclaimable, not accumulating. |
| NP-8 | Unbounded network queues (recon question) | All bounded: snapshot interpolation buffer capped, jitter stats windowed, FFA batching limits, offline Steam queue coalesced + capped backoff (static verification; runtime untestable here). |
| NP-9 | Odyssey chapter disposal | Windowed residency + thorough `_freeEnvironmentResources` is exemplary; the known open item is *eviction policy breadth* (masterplan Wave 4), not missing disposal. |
| NP-10 | Listener count grows ~2/game-over during the 30-min soak | Attributed to `showGameOverModal` recreating its buttons via `innerHTML` + fresh binding (`src/ui/modals.js:473-491`); the replaced element and its listener are GC-reclaimed — heap and DOM stayed flat over 30 min. Counter artifact, not a leak. |

## 9. Ranked remediation batches

Ranked by measured user impact × confidence ÷ (risk × effort). **No numerical improvement estimates are given anywhere — only the metric that must move.**

| Batch | Contents | Impact basis | Effort | Risk |
|---|---|---|---|---|
| **R1 — Offline-safe startup** | SB-01: self-host the two font families, remove the CDN `<link>` | Measured 12.6 s of a 13.9 s boot in a blocked-network environment; affects every launch of a *desktop* game offline | Small | Very low |
| **R2 — Desktop idle burn** | SB-02 (stop P2P poll on mode exit), SB-03 (idle policy for invalidator/hidden state — after owner answers Q1/Q2) | 60 Hz IPC + forced 60 Hz composition forever; strong static evidence, cost to be measured on desktop first | Small-Medium | Medium (Steam overlay, never-pause online) |
| **R3 — Theme lifecycle debt** | **SB-15 first** (heap-snapshot diff + dispose fix for lunara / stellar-drift / ocean — the three *reproduced* leakers; `.catch` + loop-stop on device loss); then SB-04: fix all 28 `audit:theme-lifecycle` findings and wire the audit into CI | **Reproduced**: +47.7 MB over 24 switches with forced GC (§6.6); repo's own gate fails today | Medium (mechanical, but 26 files) | Low-Medium (double-dispose; per-theme playground smoke needed) |
| **R4 — Stability hardening** | SB-08 (Odyssey device-loss route-out), SB-10 (TSL assign fix), SB-11 (breathwork timeout clear), SB-07 (lazy breathing renderer + dispose wiring) | Crash/zombie-state class; each is small and independent | Small each | Low (SB-08 needs GPU-loss test on hardware) |
| **R5 — Per-frame churn** | SB-05 (scratch objects in 6 sites), SB-06 (lunara rect cache, petal timer tracking) | Verified allocation sites; up to ~12k objects/frame (singing-bowl Extreme); forced-layout in particle loop | Small (mechanical) | Very low (visual parity screenshot per CLAUDE.md) |
| **R6 — Loop consolidation (incremental)** | SB-12(a) don't start empty background renderer; (b) FPS-monitor rAF only while overlay visible; (c) gamepad poll folded into an existing tick | Measured 3.35–4.5 rAF chains/frame; ADR-0012 already targets single timer ownership | Small-Medium | Medium (menu gamepad nav, late particle registration) |
| **R7 — Observability closure** | SB-09: budget baselines captured on named machines, `perf:odyssey:compare --fail-on-regression` in the nightly GPU lane, long-task/LoAF counter in perfMonitor | Prevents regression of R1–R6; budgets currently unfalsifiable | Small-Medium | None to runtime |
| **R8 — Media diet (already-planned Phase 8.2, evidence added)** | SB-13: WAV→opus for breathwork voices, 14 MB PNG→KTX2, asarUnpack music | Repo budgets already declare the breach; this audit quantifies the top offenders | Medium | Product QA on audio/texture quality |

Explicitly **not** recommended: disabling effects/quality tiers, lowering default graphics, caching/pooling/workers anywhere evidence doesn't demand it (ADR-0005/0006 forbid speculative offload), or touching the fixed-tick migration (governed by plan §5).

### Remediation log

| Batch | Status | Validation result |
|---|---|---|
| **R1 (SB-01)** | **Implemented 2026-07-17** on this branch: Orbitron 400/700/900 + Space Mono 400/700 vendored from @fontsource (OFL 1.1, licenses included) into `public/fonts/` (124 KB total), `public/styles/fonts.css` mirrors the upstream unicode-range subsets, CDN `<link>` removed from `index.html`. | Same S1 procedure, CDN-blocked environment: menu-ready **861–1513 ms** (5 runs; was 13,602–13,978 ms), console fully clean (the font `ERR_CONNECTION_RESET` is gone), all font requests localhost-only, `document.fonts` confirms faces load, menu screenshot verified (`results/menu-selfhosted-fonts.png`, `results/startup-r1-selfhosted.json`). Gates: 2,418 tests pass, lint/fitness/IP/release gates pass. |
| **R3 first slice (SB-15)** | **Implemented 2026-07-17.** Heap-snapshot retainer analysis found the SB-15 leak is two stacked mechanisms, neither in the themes' own dispose code: **(a) an upstream three r181 defect** — `BloomNode.dispose()` (three/addons `tsl/display/BloomNode.js`) frees render targets but not its 7 internal NodeMaterials; they render through a module-level shared `QuadMesh`, so each keeps a renderer `RenderObject` dispose-listener registered on the never-disposed shared quad geometry (`Renderer.dispose()`→`RenderObjects.dispose()` merely drops chain maps, three.webgpu:29249), and each retained RenderObject's node-builder state holds the scene `PassNode` → the **entire disposed scene**; the module quad also parks the last-assigned bloom material. Fix: `src/themes/bloom-dispose.js` (`disposeBloomNodeDeep` — disposes the 7 materials + severs their node graphs), wired into lunara/ocean/stellar-drift post disposal. **(b)** `console.log('[ThemeManager] Theme loaded:', newTheme)` pinned every theme instance (scene graph included) in Chromium's console message store — retained even with DevTools closed; now logs the name only. **Follow-ups filed here:** apply `disposeBloomNodeDeep` to the other 17 bloom-using themes during the SB-04 sweep; consider reporting the BloomNode/RenderObjects gaps upstream to three.js. | S8b toggle procedure, real-user conditions (no harness neutralization): **lunara 35.0→40.6 MB over 5 toggles (was →49.7, now flat after first-visit warm)**; **ocean 35.2→38.0 (was →47.2, flat from toggle 2)**; shared-quad dispose-listener count now returns to **0** after switch-away (was +7 leaked per activation). **stellar-drift: WebGPU lane fixed by the same mechanism (listener metric), but in this SwiftShader environment the theme falls back to the WebGL lane (`isWebGPU:false`, post pipeline never built) which still retains ≈+2–3 MB/toggle via a separate three-internal parked-reference path (module `ModelNode` singleton → shared quad's parked material → TSL graph; diagnostics in `results/theme-cycle-fix3-stellar.json` + harness `heap-nodepath.mjs`) — open follow-up; not reproducible-as-fixed in this environment.** Ocean's absolute numbers carry the environment's device-loss-storm caveat (§6.10). Gameplay verified functional through all switch cycles (screenshots `results/theme-*-postfix.png`); dispose-only change, no render-path code touched — owner's playground screenshot pass on real hardware still recommended per CLAUDE.md. Gates: 2,418 tests, lint ratchet, fitness, IP/release gates pass; `audit:theme-lifecycle` count unchanged (28, pre-existing). |

## 10. Correctness and regression risks

- **Gameplay invariants** (timing, physics, scoring, RNG, input): R1/R4/R5/R7/R8 do not touch simulation code. R2 touches only when polling stops (must never stop during a live lobby/match/host-migration). R6(c) moves *when* gamepad edges are sampled — must keep per-frame cadence during gameplay to preserve DAS behavior (`advanceGameplayInput` is driven by the sim loop and is unaffected).
- **Visual parity**: R3/R5 touch theme code → CLAUDE.md WebGPU workflow applies (playground screenshot before/after, one effect per session). R1 keeps identical font families/weights.
- **Never-pause online**: R2/R6 must respect `src/main.js:1412-1426` and the unified-loop `neverPause` latch.
- **Steam overlay**: R2/SB-03 changes must be tested with the overlay open (the invalidator exists for it).
- **Save/replay compatibility**: nothing in R1–R8 changes persistence formats or sim semantics.
- **Determinism/anti-cheat**: untouched (no sim changes).

## 11. Validation plan per batch

Every batch: run `npm test`, `npm run lint:ci`, `node scripts/architecture-fitness-check.mjs`, plus:

| Batch | Before/after procedure |
|---|---|
| R1 | §14 S1+S2 commands ×5 each; assert S1≈S2 after fix; packaged Electron launch with network disabled (manual, desktop); visual diff of menu typography |
| R2 | Desktop: enter/leave Online MP, measure `steam:readP2PPacket` calls/s at menu (main-process ETW/profiler or IPC counter) before/after; play one full online match incl. host migration; overlay opens |
| R3 | `npm run audit:theme-lifecycle` → exit 0; §14 S8-ingame ×3 cycles ×8 themes — heap/listener/context deltas flat; per-theme playground screenshot parity |
| R4 | SB-08: on GPU hardware, force device loss during Odyssey → app routes to menu (no freeze); SB-10: boot console clean of TSL errors + affected surface screenshot; SB-11: stop breathwork mid-cycle → no voice fires after |
| R5 | DevTools allocation-sampling profile per touched theme (active 30 s): allocation rate and GC events/min drop; screenshot parity |
| R6 | §14 S3: rAF callbacks/frame at menu; gamepad menu navigation manual test; theme with late-registered particles still renders |
| R7 | CI: introduce a synthetic regression on a branch → nightly lane fails; budgets file gains baselines |
| R8 | Installer/asar sizes vs `perf-budgets.json` maxima; A/B listen test on re-encoded voices; KTX2 visual diff |

## 12. Pre-existing failures and environmental limitations

**Pre-existing state recorded before any measurement (rule 9):**

- `npm test` (vitest): **240 files / 2,418 tests, all pass** (39.3 s).
- `npm run build`: succeeds (62 s). Rollup prints large-chunk warnings for three (1.60 MB) / phaser (1.66 MB) chunks.
- `node scripts/architecture-fitness-check.mjs`: all ratchets at baseline (e.g. `core-raf-drivers = 31`, `resize-listeners = 52`).
- `npm run lint:ci` (lint ratchet): passes.
- `npm run audit:theme-lifecycle`: **FAILS (exit 1) with 28 findings across 26 theme files** — pre-existing, and this check is not wired into CI (§7 SB-09).
- Production console at boot with intro (headless, every run): **42 × `THREE.TSL: No stack defined for assign operation`** errors (31 when the intro is cut short) + 1 failed network request (font CDN) — pre-existing (§7 SB-10).
- `npm ci` cannot install the Electron binary in this container (egress proxy 403) — environmental, not a repo defect.

**Environmental limitations:** no real GPU (SwiftShader), no Electron/Steam runtime, no audio playback, no second player/network peer, no 120/144 Hz display, no OS suspend/resume. Affected scenarios are marked blocked in §5 and their findings capped at `REVIEW_REQUIRED`.

## 13. Owner questions

1. **(SB-03)** Is full-rate rendering while minimized/occluded intended on desktop (Steam overlay responsiveness), or should the invalidator/renderer idle when the overlay is closed and the window is minimized? Which is the product stance for battery-powered devices?
2. **(SB-11)** Is music continuing while the window is hidden a product decision (relaxation game) or an oversight? (Determines whether `audioContext.suspend()` on hidden-without-online-match is wanted.)
3. **(SB-02)** Is there any reason P2P polling must continue outside Online MP (e.g., Steam invites arriving mid-single-player)? If invites matter, a low-rate (1–2 Hz) idle poll would preserve them.
4. **(SB-01)** Any constraint against vendoring OFL fonts in the repo (repo licensing policy)?
5. **(SB-09)** Which machines are canonical for the pending `perf-budgets.json` baselines (the file names "dev-iGPU" and "RTX5080-laptop") and who schedules the nightly GPU lane?
6. **(S12)** Odyssey on lowest-end supported hardware: is there a defined minimum GPU? Nothing in the repo documents minimum hardware; several findings can't be severity-ranked for real users without that anchor.

## 14. Exact reproduction commands

Environment prep (once):

```bash
# deps (Electron binary skipped — blocked egress; remove the env var on a normal machine)
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build                       # production build under test
node_modules/.bin/vite preview --port 4173 --strictPort &   # serve dist/
# pre-existing state checks
npm test
npm run audit:theme-lifecycle       # exits 1 today (28 findings)
node scripts/architecture-fitness-check.mjs
```

Harness (copied into `reports/perf-audit-2026-07-16/harness/`; needs `playwright-core` ^1.54 in a scratch dir — **do not add it to the repo's package.json**; a Chromium ≥140 binary path is set inside):

```bash
cd reports/perf-audit-2026-07-16/harness && npm init -y && npm i playwright-core@1.54
node run-scenario.mjs startup 5                    # S1
BLOCK_FONTS=1 TAG=nofonts2 node run-scenario.mjs startup 5   # S2 (font request aborted at network layer)
node run-scenario.mjs menu-idle 5 30000            # S3
node run-scenario.mjs gameplay 5 30000             # S4
node run-scenario.mjs rapid-input 3 20000          # S5
node run-scenario.mjs input-latency 1              # S6
node run-scenario.mjs restart-cycle 1              # S7
THEMES='["forest","winter","ocean","sunset","singing-bowl","lunara","neon-district","stellar-drift"]' \
  CYCLES=3 TAG=ingame node run-scenario.mjs theme-cycle 1    # S8 (in-game)
node run-scenario.mjs visibility 2                 # S9
node run-scenario.mjs resize 1                     # S10
WEBGPU=0 node run-scenario.mjs gameplay 2 30000    # S11
node odyssey-smoke.mjs                             # S12
node soak.mjs 30                                   # S13 (30 min)
node cpu-profile.mjs gameplay 25000                # S14
node cpu-profile.mjs menu-idle 25000               # S14
```

Desktop-only reproductions this environment could not run (SB-02/03/08): use the repo's own harness on a machine with Electron+GPU:

```bash
npm run perf:odyssey:baseline      # Electron, per docs/ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06-22.md
npm run perf:odyssey:compare -- --before <dirA> --after <dirB> --fail-on-regression
# SB-02: enter/leave Online MP, then count steam:readP2PPacket IPC at menu (main-process profiler)
# SB-03: minimize at menu, sample process CPU (overlay open vs closed)
```

### Harness design (methodology note)

Frame deltas via in-page rAF collector; long tasks via `PerformanceObserver('longtask')`; listener/interval/rAF/AudioContext/context counters via init-script prototype wrapping; heap via `performance.memory` after CDP `HeapProfiler.collectGarbage` (leak scenarios only); input bot = seeded LCG (1234567), synthetic `KeyboardEvent`s verified to drive the real input path (§6.5). Each short scenario runs in a fresh browser instance/profile.

## 15. Raw artifacts and checksums

All raw measurement outputs are committed under **`reports/perf-audit-2026-07-16/`**:

- `results/` — 24 files: per-scenario JSON (`startup*.json`, `menu-idle.json`, `gameplay.json`, `gameplay-webgl.json`, `rapid-input.json`, `input-latency.json`, `restart-cycle.json`, `theme-cycle*.json` incl. the three isolation toggles, `visibility.json`, `resize.json`, `odyssey-smoke.json`, `soak.json`), two raw V8 CPU profiles (`cpuprofile-*.cpuprofile`, loadable in Chrome DevTools), and two Odyssey screenshots (`odyssey-1.png`, `odyssey-2.png`).
- `harness/` — the complete measurement harness (17 scripts, incl. the TSL/listener/font-load verification and heap-retainer analysis follow-ups) so every number is re-runnable per §14.
- `SHA256SUMS` — checksum manifest covering every file above (49 entries). SHA-256 of the manifest itself: `cb707f1d896c05b525139283a0a73f22e8f0ea49b4481894ae69a1ab37b183e7`. Verify with `cd reports/perf-audit-2026-07-16 && sha256sum -c SHA256SUMS`.

Each scenario JSON embeds its own metadata (date, base URL, WebGPU lane, viewport) in `meta`, and per-run console errors are preserved verbatim.

## 16. What was NOT measured (explicit)

- **Real-GPU frame times, GPU timings, draw calls under load, shader-compile stalls, pipeline-creation stalls** — software rasterizer only. The documented Odyssey cold-start compile explosion (masterplan 2026-06-22) was neither confirmed nor refuted here.
- **Electron runtime anything**: main-process CPU, IPC frequency/cost (SB-02/03), background throttling behavior, monitor-Hz snap, Steam overlay, packaged cold/warm start, crash recovery (`render-process-gone` — none exists, statically noted).
- **Audio runtime**: SFX node churn under high rates, music decode/underruns, audio dropouts (autoplay blocked headless).
- **Local & Online multiplayer**: network RTT/jitter/loss, desyncs, host migration, rubber-banding; per-player Phaser instance cost.
- **True OS-level hidden/occluded behavior, minimize/restore, suspend/resume** (synthetic visibility only).
- **WebGL context-loss / WebGPU device-loss recovery** (SwiftShader loss injection unreliable; static review only).
- **High-refresh (120/144 Hz) budgets**; DPI scaling >1; resolutions beyond 800×600–1920×1080.
- **Odyssey full journey / chapter transitions under load** (smoke only; CLAUDE.md TDR warning respected).
- **Long-session beyond 30 min**; multi-hour leak horizons.
- Anything in `dist/` weight affecting *download/install* times on real connections.

No claim in this report generalizes beyond the tested target/scenario matrix; in particular, nothing here asserts the game is "lag-free", "stable", "60 FPS", or leak-free on end-user hardware.
