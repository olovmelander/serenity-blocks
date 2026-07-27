# Serenity Blocks — Performance Remediation Log

Companion to `PERFORMANCE_STABILITY_AUDIT.md`. The audit's Part B is the frozen
baseline record at `fc0329234e38587b3f498c4b495d9bad20b4024a`; this file tracks
what has been changed since, with per-batch validation evidence and honest
status. Statuses below incorporate the owner review of 2026-07-17.

This is a dated batch log, not a current-tree release report. Test counts, gate outcomes,
and phrases such as "current tree" below refer to the specifically tested 2026-07-17
batch state unless a later row says otherwise; they must not be reused as current
Stillwater acceptance evidence.

**Status legend** — *resolved (tested env)*: reproduced fix with before/after
measurement in the audit environment; *implemented, target-hardware validation
pending*: code + unit/contract tests landed, but the user-visible effect needs
real hardware (or Electron+Steam) to demonstrate; *partial*: some of the
finding remains open.

## Stillwater immutable v6 acceptance and historical v5 matrix (2026-07-26)

This addendum records Stillwater-specific acceptance only; it does not restate or update
the repository-wide gate and test counts in the dated 2026-07-17 batches below.

### Current v6 authority

The current immutable distribution is
`artifacts/themes/stillwater/wave8/immutable-build-final-20260726-1800-v6`, with
local-build fingerprint
`267e6556dc09a9f1df8ad92612de20ad945c6798704348da84f83edbe42c1e70`.
The
[comprehensive RTX 5080 WebGPU High run](artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-wave8-summary.json)
is overall `PASS`:

| Current immutable lane | Idle total p95 / p99 | Reaction total p95 / p99 | Incremental CPU / GPU p95 | Status |
|---|---:|---:|---:|---|
| WebGPU High, 1920×1080, 60 Hz | 2.031 / 2.262 ms | 1.997 / 2.297 ms | -0.100 / +0.066 ms | Pass |

Both primary workloads contain 1,200 samples after a stationary, cross-comparable
target-paced warmup. Lock stress is 2.063 ms p95 and the mixed-event stress lane is
2.097 ms p95. These are `isolated-manual-production-frame`
CPU-submission-plus-GPU-timestamp workloads, not observed display FPS or whole-app
scheduler pacing.

The current High idle graph is 45 draws / 85,739 triangles, initially
28 renderer geometries / 18 textures. After one-time pool, post, and resize warmup, the
11 production event captures hold renderer memory at 31 geometries / 24 textures, span
45–48 draws and 85,739–87,211 triangles, preserve every fixed-resource identity, and
create zero resources per event. Coverage is lock, hard drop, line clear, Tetris,
combo 4/7/10, T-spin, back-to-back, perfect clear, and level up: 11/11 pass on the real
production board with strict board-readiness checks. Atmosphere buffers are fixed to the
constructed tier instead of one maximum-size allocation:
Minimal/Low/Medium/High/Ultra/Extreme = 40/90/180/280/540/700 motes.

Lifecycle ownership is explicit. Normal eviction releases the runtime scene but retains
one drained, detached Stillwater renderer/device for warm switch reuse.
`ThemeManager.cleanup()` owns terminal disposal through the registered
`StillwaterTheme.disposeSharedResources()` callback. Three's private renderer
`_animation` scheduler is stopped while pooled, application-paused/hidden, and while the
manual validation driver owns frames; it is restarted exactly once on claim/resume or
manual-driver exit. The comprehensive artifact passes 20 pause/resume cycles with
20 matching internal-animation pause/resume counter increments. Its
`backgroundThrottling:false` hidden lane invokes the application pause policy explicitly
and records zero update/render delta.

The separate
[direct Electron Page Visibility run](artifacts/themes/stillwater/wave8/v6-page-visibility-direct-smoke2/stillwater-wave8-summary.json)
also passes on the exact v6 fingerprint. BrowserWindow visibility is
true→false→true; `document.hidden` and rendering pause remain true for the hidden
interval; explicit pause/resume hooks are both false; update/render deltas are zero; one
Stillwater canvas remains after resume; and console, shader/pipeline, and renderer-process
failures are zero.

Forced WebGL2 remains the same-TSL-graph compatibility backend for the Three theme. It is
not a Phaser Canvas fallback: the production Phaser 4 board is WebGL-only and no Canvas
board renderer exists, so that fallback is explicitly unsupported unless a new board
renderer is built. No unlisted current-v6 adapter/backend lane is inferred from these
artifacts.

Current-source gates for this closeout are 183/183 Stillwater-focused tests,
236/236 affected tests, and 45/45 lifecycle/terminal-ownership tests.
`npm run typecheck`, `npm run lint:ci`, `npm run check:boundaries`, and
`npm run audit:theme-lifecycle` pass. `lint:ci` is a ratchet result, not a clean raw-lint
claim; these focused records are not presented as a current full-repository test result.

### Frozen historical v5 matrix

The broader immutable v5 hardware/lifecycle matrix remains valid only for its captured
bytes under fingerprint
`6c91dad8fe2144b02b9dc6aab5b7135a23394f814bd0690792760e7baafb200c`;
it is not current-source v6 acceptance:

| Historical immutable lane | Isolated total p95, idle / reaction | Incremental CPU / GPU p95 | Status |
|---|---:|---:|---|
| [AMD WebGPU Minimal, 1080p60](artifacts/themes/stillwater/wave8/final-v5-amd-minimal-1080p60/stillwater-wave8-summary.json) | 4.667 / 4.698 ms | 0 / 0.066 ms | Pass |
| [AMD WebGPU Medium, 1080p60](artifacts/themes/stillwater/wave8/final-v5-amd-medium-1080p60/stillwater-wave8-summary.json) | 5.219 / 5.743 ms | 1.2e-7 / 0.524 ms | Pass |
| [AMD WebGPU High, 1080p60](artifacts/themes/stillwater/wave8/final-v5-amd-high-1080p60-r2/stillwater-wave8-summary.json) | 9.202 / 9.961 ms | 0 / 0.590 ms | Pass |
| [Forced WebGL2 Medium, 1080p60](artifacts/themes/stillwater/wave8/final-v5-webgl2-medium-1080p60/stillwater-wave8-summary.json) | 5.496 / 5.677 ms | 0 / 0.124 ms | Pass |
| [RTX WebGPU High, 1080p120](artifacts/themes/stillwater/wave8/final-v5-rtx-high-1080p120/stillwater-wave8-summary.json) | 1.497 / 1.597 ms | 0.100 / 0 ms | Pass |
| [RTX WebGPU Extreme, 1440p144](artifacts/themes/stillwater/wave8/final-v5-rtx-extreme-1440p144/stillwater-wave8-summary.json) | 1.724 / 1.759 ms | 0 / 0.066 ms | Pass |

That frozen fingerprint also passed
[30 WebGPU High switch cycles](artifacts/themes/stillwater/wave8/final-v5-webgpu-high-switch30/stillwater-wave8-summary.json)
with the selected forced-GC/native constructor census stable,
[injected WebGPU device-loss recovery](artifacts/themes/stillwater/wave8/final-v5-device-loss/stillwater-wave8-summary.json),
and production-path [2P duo](artifacts/themes/stillwater/wave8/final-v5-live-local-2p/stillwater-live-local-2p.json) /
[4P quad](artifacts/themes/stillwater/wave8/final-v5-live-local-4p/stillwater-live-local-4p.json)
layouts. The 1→1 renderer/device switch result demonstrates intentional pool reuse; it
does not demonstrate terminal-zero cleanup.

Both v5 and v6 fingerprints are local-build content identities, not cryptographic
attestations or proof of bytes served by preview; recorded Git context is excluded.
Hero GLTF telemetry combines load, parse, and attach without measuring GPU upload
separately; warm-render completion is CPU call return and canvas reveal is a DOM opacity
write, not presentation. LongTask telemetry is bounded to its declared observation
window and cannot exclude 16.6–50 ms hitches, GC, GPU stalls, or compositor delay.
`renderer.info.programs` is unavailable, and the selected lifecycle/resource censuses are
not proof that every JavaScript, browser-internal, driver, or native class is unretained.

| Batch | Status | Validation result |
|---|---|---|
| **R1 (SB-01)** | **Implemented 2026-07-17** on this branch: Orbitron 400/700/900 + Space Mono 400/700 vendored from @fontsource (OFL 1.1, licenses included) into `public/fonts/` (124 KB total), `public/styles/fonts.css` mirrors the upstream unicode-range subsets, CDN `<link>` removed from `index.html`. | Same S1 procedure, CDN-blocked environment: menu-ready **861–1513 ms** (5 runs; was 13,602–13,978 ms), console fully clean (the font `ERR_CONNECTION_RESET` is gone), all font requests localhost-only, `document.fonts` confirms faces load, menu screenshot verified (`results/menu-selfhosted-fonts.png`, `results/startup-r1-selfhosted.json`). Gates: 2,418 tests pass, lint/fitness/IP/release gates pass. |
| **R3 first slice (SB-15)** | **Implemented 2026-07-17.** Heap-snapshot retainer analysis found the SB-15 leak is two stacked mechanisms, neither in the themes' own dispose code: **(a) an upstream three r181 defect** — `BloomNode.dispose()` (three/addons `tsl/display/BloomNode.js`) frees render targets but not its 7 internal NodeMaterials; they render through a module-level shared `QuadMesh`, so each keeps a renderer `RenderObject` dispose-listener registered on the never-disposed shared quad geometry (`Renderer.dispose()`→`RenderObjects.dispose()` merely drops chain maps, three.webgpu:29249), and each retained RenderObject's node-builder state holds the scene `PassNode` → the **entire disposed scene**; the module quad also parks the last-assigned bloom material. Fix: `src/themes/bloom-dispose.js` (`disposeBloomNodeDeep` — disposes the 7 materials + severs their node graphs), wired into lunara/ocean/stellar-drift post disposal. **(b)** `console.log('[ThemeManager] Theme loaded:', newTheme)` pinned every theme instance (scene graph included) in Chromium's console message store — retained even with DevTools closed; now logs the name only. **Follow-ups filed here:** apply `disposeBloomNodeDeep` to the other 17 bloom-using themes during the SB-04 sweep; consider reporting the BloomNode/RenderObjects gaps upstream to three.js. | S8b toggle procedure, real-user conditions (no harness neutralization): **lunara 35.0→40.6 MB over 5 toggles (was →49.7, now flat after first-visit warm)**; **ocean 35.2→38.0 (was →47.2, flat from toggle 2)**; shared-quad dispose-listener count now returns to **0** after switch-away (was +7 leaked per activation). **stellar-drift: WebGPU lane fixed by the same mechanism (listener metric), but in this SwiftShader environment the theme falls back to the WebGL lane (`isWebGPU:false`, post pipeline never built) which still retains ≈+2–3 MB/toggle via a separate three-internal parked-reference path (module `ModelNode` singleton → shared quad's parked material → TSL graph; diagnostics in `results/theme-cycle-fix3-stellar.json` + harness `heap-nodepath.mjs`) — open follow-up; not reproducible-as-fixed in this environment.** Ocean's absolute numbers carry the environment's device-loss-storm caveat (§6.10). Gameplay verified functional through all switch cycles (screenshots `results/theme-*-postfix.png`); dispose-only change, no render-path code touched — owner's playground screenshot pass on real hardware still recommended per CLAUDE.md. Gates: 2,418 tests, lint ratchet, fitness, IP/release gates pass; `audit:theme-lifecycle` count unchanged (28, pre-existing). |
| **R3 sweep completion (SB-15 → SB-04)** | **Implemented 2026-07-17.** `disposeBloomNodeDeep` extended to sever the disposed materials' node graphs (the module-level shared QuadMesh parks the last-assigned material), relocated to the boundary-sanctioned `src/themes/shared/bloom-dispose.js`, and applied to **every** `BloomNode` user in the repo — 21 further theme post pipelines, the Odyssey TSL pipeline, the intro renderer (including its mid-session rebuild path), and 8 playground effects (31 files, one agent per file + independent coverage/safety review of every hunk). Two sites had bloom nodes that were **never disposed at all** (shifting-sands, intro renderer) — now tracked and disposed. Upstream bug report drafted at `docs/UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md` (BloomNode.dispose material leak + RenderObjects.dispose gap + shared-quad parking), ready to file against three.js r181. | Coverage: 0 BloomNode importers without the helper (grep-verified). Gates: 2,418 tests, lint ratchet, typecheck (incl. TornadoPost.ts), dependency-cruiser boundaries, production build all pass. Runtime toggles (4 cycles each, GC-forced): **winter 35.2→35.8 MB (flat)**, **synthwave-sunset flat after first-visit warm (38.3→38.8)**, **neon-district non-monotonic (48.4→37.8→48.4** — environment device-loss noise, no leak signature). Intro-enabled boot reaches the menu with no new error classes (only the known SwiftShader device-loss pattern). Per-theme visual parity on real hardware remains the owner's playground screenshot pass (dispose-only changes). |
| **R4 stability quick-wins (SB-07/08/10/11)** | **Implemented 2026-07-17** (4 independent fixes): **SB-10** — the intro's warp-scatter `addAssign` mutations rebuilt as a pure TSL expression (mathematically identical, now actually applied); **SB-08** — `OdysseyBoardController` registered with the existing GPU-loss plumbing (`monitorWebGPU` + `registerGpuSurface('odyssey-board')`; loss pauses the render loop and routes out through the coordinator, per plan §4.2); **SB-07** — the breathing indicator's `THREE.WebGLRenderer` is now lazy-created on first `start()` and `dispose()` is wired into `destroy()`; **SB-11** — `BreathworkAudioManager.stopAll()` clears `voicePendingTimeout` and resets voice flags. | **TSL boot errors 42 → 0** (`tsl-attrib2.mjs`); **live WebGL contexts at menu 4 → 3** (menu-idle scenario); **Odyssey device loss now routes out to a working main menu** — reproduced live in this environment (`[GpuLossCoordinator] recovery for "odyssey-board"` fired, screenshot `results/odyssey-routeout-menu.png` shows the recovered menu (`odyssey-2.png` is the pre-fix black state); previously a permanent black scene). Gates: 2,418 tests, lint ratchet, typecheck, boundaries, build all pass. Intro visual parity on real hardware (scatter effect firing on big combos) remains a recommended owner check — the effect was silently dropped before, so any change is strictly the *intended* look. |
| **SB-04 closure (lifecycle gate)** | **Implemented 2026-07-17.** Analysis reclassified all 28 `audit:theme-lifecycle` findings as false positives of stale heuristics (see the SB-04 resolution note in §7): the dispose chain runs every `stop()` override, all 22 flagged themes chain to `super.stop()`, and all 4 flagged resize listeners have removal paths the old regex missed. Shipped instead: `scripts/theme-lifecycle-audit.mjs` rewritten to enforce the real contract (super-chaining for `stop()`/`cleanup()`, no inline `bind(this)` listeners, resize removal paths), analyzer exported and covered by 10 unit tests (`tests/unit/theme-lifecycle-audit.test.js`), and the audit wired into `pages.yml` as a hard CI gate. | `npm run audit:theme-lifecycle` → **exit 0** on the 2026-07-17 tested tree (was exit 1 / 28 findings); mutation cases covered by the new unit tests (missing `super.stop()`, missing `super.cleanup()`, inline `bind(this)`, unremoved resize listener all flagged; the three legitimate tracked-removal patterns all pass). Full suite: **2,428 tests / 241 files** pass for that batch; lint ratchet + fitness ratchets were at baseline. |
| **R5 per-frame allocation hoists (SB-05/SB-06)** | **Implemented 2026-07-17** across all 7 verified sites: singing-bowl `updateInstanceMatrices` (the repo's worst site — previously ~4 + 2×instanceCount allocations per frame, up to ~12k at Extreme; now zero steady-state), sunset `updateFog` (5 Colors → module constants + scratch), astral-weave `updateCompute`, stellar-drift `updateCrashMeteors`, sakura-twilight fox-greeting vectors, `OdysseyCameraController.updatePortalApproach`, and `renderer.js`: spiraling-debris now reads each island's `getBoundingClientRect()` **once per frame instead of once per particle** (layout semantics preserved — refreshed every frame), and the petal wind-gust `setTimeout` is tracked and cleared via a new `ParticleSystem.dispose()` wired into both renderer teardown paths. Every hoist shipped with a per-site aliasing analysis (full-overwrite-before-read, no escape); generateTreeData's escaping allocations were deliberately left alone. | Math is byte-identical by construction (diff-reviewed per hunk). Gates: 2,428 tests, lint/fitness/lifecycle ratchets, typecheck, boundaries, build all pass; sunset + singing-bowl render correctly in-game post-fix (screenshots committed). **Honest caveat:** allocation-rate deltas were below this environment's noise floor (~2.6 fps software rendering puts these per-frame sites at single-KB/s; pre/post sampling profiles committed) — the reduction is provable statically but only measurable on real hardware at real frame rates, per the audit's validation plan (DevTools allocation sampling per theme). |
| **R6(a) + R7(d) — empty-loop parking & stall observability (SB-12/SB-09)** | **Implemented 2026-07-17.** (a) The shared 2-D background renderer now parks its rAF loop when a theme registers no layers and no particle systems, instead of running an empty clear+rAF chain forever; `addLayer()` and every particle-creating path restart it the moment content appears (`src/rendering/renderer.js`). (b) `PerformanceMonitor` gains push-based `longtask` + `long-animation-frame` observers (zero idle cost — they only fire on stalls) with a 100-entry ring, LoAF script attribution, and a `window.perfMonitor.getLongTaskSummary()` accessor — closing the audit's "no long-task instrumentation anywhere in src/" gap. | Runtime-verified: with a no-particle theme active (electric-dreams) the background loop is parked (`animationFrameId: null`); switching to content-bearing paths restarts it structurally (`addLayer`/`loadTheme` branches call `start()`); menu return renders correctly (screenshot-checked; the backdrop-less return state predates this change — zero registered systems either way). `getLongTaskSummary()` live-captured 33 boot stalls (2,909 ms total, max 192 ms) with both entry kinds. Gates: 2,428 tests, lint ratchet, build pass. Remaining R6 items (FPS-monitor rAF gating, gamepad poll fold-in) deliberately left to the ADR-0012-governed loop-consolidation work. |
| **R2 (recommended defaults) — SB-02 poll lifecycle, SB-03 minimized idle, SB-11 audio decision** | **Implemented 2026-07-17** with the audit's recommended options (proceeding per owner's blanket approval; per-question sign-off was offered and declined). **SB-02**: `SteamNetworking.stopP2PPolling()` added; `OnlineMultiplayerMode.onDeactivate` stops the 60 Hz P2P IPC poll after leaving the lobby, `onActivate` re-arms it (instance is cached across visits; `startP2PPolling` was already double-arm-guarded). **SB-03 (minimized case)**: the Steam-overlay frame invalidator now skips `webContents.invalidate()` while `isMinimized()` — the overlay cannot be used on a minimized window — resuming automatically on restore; the occluded-but-visible case and the renderer-side `'continue'` default are left as-is pending real product testing. **SB-11 (audio half)**: keeping music playing while hidden is closed as **by-design** for a relaxation title. Shrink-on-touch: the god-file ratchet forced net line reduction — one-shot mode-switch console noise removed, `OnlineMultiplayerMode` baseline lowered 3271→3268. | Unit-tested where this environment allows: `tests/unit/steam-p2p-poll-lifecycle.test.js` (poll arms/clears/re-arms, idempotent stop, mock-mode no-op, plus source-contract ordering: stop *after* `leaveLobby`, re-arm in activate) and `tests/unit/electron-steam-invalidator-idle.test.js` (isMinimized guard precedes the forced invalidate), following the repo's existing Electron source-contract test pattern. Full suite 2,434 tests / 243 files, lint + fitness ratchets, typecheck, boundaries, build all pass. **Desktop integration validation remains owner work** (this container cannot run Electron+Steam): enter/leave Online MP and count `steam:readP2PPacket` IPC at menu; minimize at menu and sample process CPU with overlay closed/open; play one full online match incl. host migration. |

## Post-review addendum (2026-07-17, after PR #302 merged as `48e94fc`)

| Change | Detail | Validation |
|---|---|---|
| SB-15 addendum — ocean & swedish-forest device-loss handlers | Their `onDeviceLost` hooks were log-only (flagged in the owner review); both now halt the theme's render loop on loss so three's error-scope polling stops. Gameplay is unaffected — the backdrop freezes until the theme switches. Route-out is deliberately NOT triggered for background themes (losing a live game over a backdrop failure would be wrong). | Code-reviewed against each theme's loop mechanics (`animationLoopStarted`/`animationFrameId`, `animationFrame`); loss-injection validation needs real hardware. |
| SB-08 addendum — asserted route-out run | The Odyssey smoke harness now asserts recovery instead of eyeballing it: final mode, menu usable, route-out latency, error-stream stabilization. A fresh run against `48e94fc`+review-fixes reproduced a live device loss with `menuUsable: true`, `modeAfterLoss: null`, `errorsDuringSettleWindow: 0`, `errorStreamStabilized: true` (`results/odyssey-smoke-routeout-asserted.json`). Route-out latency measured 63 s in this software-GPU environment — expected to be far shorter on real hardware (the latency is dominated by SwiftShader-speed disposal of the half-built scene, not by the route-out logic). | Harness assertions committed (`harness/odyssey-smoke.mjs`); artifact checksummed. |
| Bloom workaround pinned-version contract test | `disposeBloomNodeDeep` reads private three fields and would silently no-op if a three upgrade renamed them. `tests/unit/bloom-dispose-contract.test.js` pins the field names against the installed three source AND fails loudly if upstream's `BloomNode.dispose()` starts disposing materials (signal to retire the workaround). | 5/5 tests pass on three 0.181.2. |
| Harness reproducibility fixes | All committed harness scripts accept `CHROMIUM_PATH` (falling back to the container default); `run-scenario.mjs` now stamps `meta.commit` (SHA + dirty flag) into every result file. Note: artifacts produced before this change carry no commit stamp and several represent intermediate branch states between `fc03292` and `48e94fc` — their filenames/tags (`fix2-`, `fix3-`, `sweep-`, `postfix`) indicate the stage. This older SHA/dirty stamp is distinct from Stillwater's later v5/v6 local-build content identities; neither mechanism is a cryptographic attestation or proof of bytes actually served by preview. | Syntax-checked; next runs self-document. |

### Corrections applied to earlier rows (owner review)
- **R5 status is "implemented, performance effect unverified"** — the allocation
  deltas were below this environment's noise floor; they are static-provable
  hoists, not validated performance wins.
- **R1's 0.86–1.5 s figure is the `?skipIntro=1` path** (the harness default),
  not a full-intro launch. The defensible claim: the font request added
  ~12.6 s in the tested slow-failing network environment, and self-hosting
  removes the network dependence entirely. Offline impact varies by OS/network
  stack — many offline setups fail the request quickly.
- **SB-15 is NOT fully closed**: stellar-drift's WebGL-lane run still grew
  ~35.2 → 49.5 MB over 5 toggles post-fix; open, with diagnostics committed.
  *(2026-07-25: one real contributor found + fixed, A/B-measured, but a larger
  global per-switch leak remains — see the addendum below. Still partial.)*

## Addendum (2026-07-25) — SB-15 WebGL-lane: one leak fixed, residual characterized (small)

| Change | Detail | Validation (measured A/B) |
|---|---|---|
| SB-15 WebGL-lane — `EffectComposer` passes never disposed (partial fix) | Found a concrete, source-provable leak on the theme's **WebGL-fallback lane** — separate from, and smaller than, the three-internal TSL/`ModelNode` path the R3 row guessed at. `EffectComposer.dispose()` (three r181, `three/addons/postprocessing/EffectComposer.js`) frees only `renderTarget1`, `renderTarget2`, and its internal `copyPass` — it **never iterates `this.passes`**. stellar-drift's `disposePostProcessingStack()` called `composer.dispose()` then merely **nulled** `bloomPass`/`vignettePass`/`chromaticPass`/`radialSpeedPass`/`colorGradePass`, so every added pass leaked on each rebuild (`setupPostProcessing()` rebuilds the composer on the persistent renderer during adaptive/quality changes). `UnrealBloomPass.dispose()` alone frees 11 render targets + 5 separable-blur materials + composite/blend/basic materials + a fullscreen quad — none ran. Fix: new shared helper `src/themes/shared/composer-dispose.js` (`disposeComposerPasses`, disposes every `composer.passes[i]` before `composer.dispose()`), wired into `disposePostProcessingStack()`. Passes and `copyPass` are disjoint → no double-disposal. Mirrors the existing `moonrise-summit-post.js` precedent. | **Runtime A/B done** (system Chrome, `?forceWebGL` → confirmed WebGL lane, `isWebGPU:false`, composer with 6 passes; CDP forced-GC JS heap; 12 forest↔stellar toggles). **Before fix: stellar 32.8 → 36.0 MB (+3.2).** **After fix: stellar 32.9 → 35.2 MB (+2.3).** So the fix removes ~0.9 MB / 12 toggles of stellar-specific growth (~28% of stellar's excess), consistent with the 5-toggle run (+1.7 → +1.0). Unit tests `tests/unit/composer-dispose.test.js` (6): pass disposal, throwing pass, dispose-less/null passes, null-safe, **pinned three-source contract** (fails loudly if upstream starts iterating `this.passes`), and a wiring assertion. Full suite **2,672 tests / 271 files** pass; lint-clean; build resolves the import. |
| **Remaining WebGL-lane residual — characterized, small, three-internal** | Heap-snapshot **retainer analysis** (comparison of two forest-active snapshots across N switch cycles) plus an **idle-vs-toggle** control run resolve what the earlier "big global leak" reading actually was. Two corrections: **(1) measurement artifact** — the first retainer pass was dominated by `(Global handles) / DevTools console` roots (Chromium retains objects passed to `console.*` while a CDP session is attached — the same trap R3 fixed for `ThemeManager`, and which the audit's own `heap-nodepath.mjs` neutralizes). Re-running with console args stringified removed most of the apparent growth. **(2) gameplay-time vs switch-time** — an idle control (stay on forest, game running, same wall-time as 10 toggles) grew **+0.6 MB / 10 = 0.06 MB/cycle**, vs toggling **+2.2 MB / 10 = 0.22 MB/cycle**. So the **genuine theme-switch-attributable leak is ~0.16 MB/toggle** (small); the idle 0.06 MB/cycle is gameplay accumulation — heap-snapshots convict `demoRecorder.demo.checkpoints[]` retaining full board snapshots via `singlePlayerCommandDispatcher` (a *separate*, non-theme finding; verify whether `checkpoints` is bounded — potential long-session item, not SB-15). **Mechanism of the switch-time leak (confirmed):** with console neutralized, the switch-attributable retainers funnel through `object._listeners.dispose[]` on a **module-level shared geometry** — three's `Pass.js` (`three/addons/postprocessing/Pass.js:123`) declares `const _geometry = new FullscreenTriangleGeometry()`, shared by every `FullScreenQuad` of every pass across all renderer instances. Each per-activation `WebGLRenderer` registers an `onGeometryDispose` listener on it (via `WebGLGeometries`), and `WebGLRenderer.dispose()` never removes it, so listeners stack one-per-activation, each closure pinning a slice of the disposed renderer (programs/context). **This is the classic-renderer analog of the documented `docs/UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md` (RenderObjects/shared-quad) gap** — genuinely three-internal; a safe app-side fix is not obvious (the shared `_geometry` is private to `Pass.js`; disposing it is global-side-effecting), so it is left as an upstream item rather than a speculative patch. Net: SB-15's WebGL lane on **real hardware** is a ~0.16 MB/toggle three-internal listener drip, not the 35→49.5 MB seen under **SwiftShader/WebGPU** (that environment's much larger figure was never reproduced here). | Retainer harness + idle/toggle control run on system Chrome, `?forceWebGL`, console-neutralized, CDP forced GC. **Follow-ups: (a) DONE** — `docs/UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md` extended with a "Related manifestation" section for the classic `WebGLRenderer` + `Pass.js` shared-`_geometry` / `WebGLGeometries.onGeometryDispose` accumulation (source-verified: `WebGLRenderer.dispose()` disposes `objects`/`bindingStates`/`programCache` but never removes geometry dispose-listeners; `WebGLGeometries` has no dispose that iterates tracked geometries). **(b) DONE (verified NOT bounded)** — `DemoRecorder.recordCheckpoint()` (`src/core/demo/DemoRecorder.js:166`) pushes a full `captureGameStateSnapshot()` to `demo.checkpoints[]` every `DEMO_CHECKPOINT_INTERVAL_FRAMES = 300` frames (~5 s) plus on commands, with **no cap/ring/eviction**; `demo.inputs[]` grows per accepted command. Both reset only in `startRecording()` (new game), so single-player memory grows O(session length) — inherent to full-game demo recording (the `inputs` log is the deterministic-replay source of truth and cannot be capped without breaking replay). Modest magnitude (~single-digit MB/hour) but unbounded for very long sessions → a **design question** (should SP always record a demo? stream to disk? cap seek-only checkpoints?), not a bug to patch here; filed as a separate long-session item (SB-13 family), NOT SB-15. **(c) still owed** — WebGPU-lane heap re-measure on real-iGPU hardware (the true-HW number; this session avoided heavy real-WebGPU toggling per the CLAUDE.md iGPU-TDR constraint; a SwiftShader-WebGPU software check is the safe proxy). |

**Systemic follow-up (unchanged):** 33 other files call `new EffectComposer`; every one that adds passes and relies on `composer.dispose()` has the same latent pass leak on its WebGL lane — candidate for a `disposeComposerPasses` sweep (SB-04-style), tracked but not done here.

## Addendum (2026-07-26) — SB-15 DOMINANT leak found & fixed: WebGPU lane `device.lost.then()`

The 2026-07-25 work fixed the **WebGL-fallback** lane and (correctly) noted its real leak was
small (~0.16 MB/toggle). It did **not** measure the **WebGPU lane** — the lane real users
actually run — because of the iGPU-TDR constraint. Doing that measurement safely, via
**SwiftShader (software) WebGPU** (zero iGPU risk, same lane the audit's 35→49.5 MB came from),
finally located the audit's big number.

| Change | Detail | Validation (measured A/B, software WebGPU) |
|---|---|---|
| SB-15 **dominant** leak — redundant `device.lost.then()` pinned the whole theme | Heap-snapshot retainer analysis of the WebGPU lane (`isWebGPU:true`, `StellarDriftPost`/BloomNode active) showed **every** large grower funneling through one path: `GPUDevice.lost` (a promise that never settles under normal play) → `PromiseReaction` → a closure capturing `this` → the full disposed stellar scene (`Ri.rimLight/hemisphereLight/…`). Cause: `setupRendererResilience()` registered its **own** `this.renderer.backend.device.lost.then((info) => this.handleDeviceLoss(info))` **in addition to** setting `this.renderer.onDeviceLost`. A `.then()` reaction **cannot be detached**, and `device.lost` never resolves, so each activation's closure pinned that activation's entire theme instance + scene on the never-resolving promise forever. It was **fully redundant**: three's `WebGPUBackend` already does `device.lost.then(() => renderer.onDeviceLost(info))` (`three/src/renderers/webgpu/WebGPUBackend.js:205`), and `disposeRendererResources()` nulls `renderer.onDeviceLost` on teardown — so `onDeviceLost` alone covers recovery **and** releases cleanly. Fix: delete the app-side `device.lost.then()` block; rely on `onDeviceLost`. Device-loss recovery (`requestWebGLFallback`) is unchanged. **This — not the BloomNode materials (`disposeBloomNodeDeep`) and not the `EffectComposer` passes — was the audit's 35→49.5 MB / 5-toggle leak.** | **Software-WebGPU A/B, 10 forest↔stellar toggles, console-neutralized, CDP forced GC. Before: forest heap 35.0 → 64.3 MB (+29.3, ~2.93 MB/toggle). After: 34.7 → 36.8 MB (+2.1, ~0.21 MB/toggle) — ~93% eliminated,** baseline now flat. The ~0.21 residual matches the gameplay-time `demoRecorder` (~0.06/cycle, idle-measured) + the small three-internal shared-object drip. Regression test `tests/unit/stellar-drift-device-loss-leak.test.js` (3, source-contract): `onDeviceLost` still wired, **no** raw `device.lost.then` reintroduced, `onDeviceLost` nulled on teardown. Full suite green except 2 **pre-existing** failures in `stillwater-wave6.test.js` (unrelated parallel work, zero stellar refs); lint-clean; build passes. **Real-hardware note:** JS-heap retention is environment-independent, so this fix applies equally on the real iGPU; the true real-HW *absolute* number still wants an owner desktop-app pass, but the leak's cause and removal are confirmed. |

**SB-15 status after this:** both lanes' dominant **app-side** leaks are now fixed and A/B-measured
(WebGPU `device.lost.then` ~93%↓; WebGL `EffectComposer` passes). Remaining are small and either
three-internal (the `Pass.js`/`RenderObjects` shared-object listener drips, filed upstream in
`docs/UPSTREAM_THREE_BLOOMNODE_DISPOSE_ISSUE.md`) or the separate gameplay-time `demoRecorder`
accumulation (design question, not a theme leak).

## Addendum (2026-07-26) — SB-09 closed: budget gate in CI + nightly compare lane wired

| Change | Detail | Validation |
|---|---|---|
| SB-09 (R7 remainder) — budgets falsifiable in CI, nightly lane one-command | Building on the owner's committed real-GPU baselines (`reports/odyssey-perf/baseline-rtx5080-*`, RTX 5080 WebGPU) and the existing `odyssey-perf-compare --fail-on-regression`: **(a)** new `scripts/perf-budgets-gate.mjs` (`npm run perf:budgets:gate`), wired into `pages.yml` after `npm test` — runs the compare tool's `--self-test`, structurally lints `perf-budgets.json` (baseline/max/min must be finite-number-or-null; strings allowed only under prose keys — a `"TBD"` budget value fails), and re-checks every committed steady-state cell (`baseline-*-idle.json` only; load cells are startup diagnostics) against the declared budgets. Catches budget/baseline drift at PR time (tightening a budget below committed evidence, or committing a regressed baseline) with **zero measurement on hosted runners** (which cannot render meaningfully — `gpu-validation.yml` header). No idle cells → honest SKIP, exit 0. **(b)** new `scripts/odyssey-perf-nightly.mjs` (`npm run perf:odyssey:nightly`) — captures a fresh pinned cold/idle cell via the existing orchestrator into gitignored `artifacts/odyssey/perf-nightly/<stamp>/`, then gates it vs the newest committed idle baseline + budgets; exit code is the verdict. Scheduler command (`schtasks`) documented in `reports/odyssey-perf/README.md`, with the `--hide`-throttles-to-1fps and per-app-GPU-preference gotchas. | Gate run end-to-end on the current tree: committed idle cell 7.00 ms vs budget 7 → **PASS**, exit 0. **Failure injection:** budget tightened to 5 → breach detected, exit 1. Nightly with no/missing baseline → guidance + exit 1. `--self-test` proves both exit behaviors. 7 unit tests (`tests/unit/perf-budgets-gate.test.js`) on the exported shape-lint + idle-cell selection (incl. the real committed budgets file). Lint clean. **Owner step remaining:** register the `schtasks` job on the capture machine (CI cannot schedule the RTX laptop). |
