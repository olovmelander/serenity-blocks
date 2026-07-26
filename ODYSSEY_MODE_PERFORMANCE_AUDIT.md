# Odyssey Mode — Performance, Stability, and Player-Experience Audit

**Date:** 2026-07-17 · **Commit:** `c086471660c557bba5390402e95070efa6cebf89` (== `origin/main`, working tree clean) · **Branch:** `claude/odyssey-performance-audit-1mfr9x`
**Author:** automated audit session (investigation + planning pass only — no production code changed)
**Status of this document:** evidence-based audit. Every conclusion carries one of the evidence labels defined in §1.3. Runtime numbers gathered in this pass come from a **software-GPU (SwiftShader) container** and are functional/ordering evidence only — they are never presented as real-hardware performance.

---

## 1. Executive verdict and claim limitations

### 1.1 Verdict

**The "Odyssey takes 30–60 s" symptom is not one duration and, at this commit, is no longer primarily a pre-reveal loading problem in code structure — it is (a) an unverified post-reveal background-streaming tail, and (b) a measurement vacuum.** Specifically:

1. **The code's default startup path is already "fast-start":** the board reveals after creating + compiling only the focus chapter ±1 (not all 8), warming a single sample point, behind a loading overlay with a hard-coded ≥2.0 s + 0.8 s fade floor. All of this is verified in code (§6, §10). The historical full pre-reveal warm ("~21–22 s warm / ~38 s board-visible") survives only behind opt-out flags (`?odysseyFastStartOff=1`, `?odysseyEagerWindowOff=1`).
2. **After reveal, the remaining ~5 chapters stream on the main thread** (dynamic import → synchronous `create()` bake → async `compileAsync` → **synchronous offscreen render-warm**), serialized by `setTimeout` steps and gated by an interaction/camera/frame-health backpressure gate. The July masterplan attributes the original "30+ s" complaint to exactly this window and claims four specific defects in it were fixed (warm/compile race, probe storm, missing frame-health gate, eviction re-warm race). **All four fixes are present in code — none has a committed runtime measurement demonstrating the post-fix experience on real hardware** (§5, §10).
3. **The single most important deficiency found by this audit is evidentiary, not algorithmic:** the repo's own perf lane (`npm run perf:odyssey:baseline`) has never produced a committed artifact, does not pin adaptive quality or pixel ratio by default (violating `perf-budgets.json`'s own capture rule), runs one iteration per cell, and is enforced by no CI gate. Every committed Odyssey runtime number comes from a different, software-rasterized harness whose absolute frame times are explicitly non-representative (§4).
4. **Fresh runtime evidence gathered in this pass (software GPU, functional only):** at c086471, app boot→menu-ready is **~0.8–0.9 s** (5/5 runs — the 13.6–14 s regression in the committed 2026-07-16 artifacts was the font/offline stall fixed by #302 and is gone). Under SwiftShader the WebGPU device is reliably lost during Odyssey chapter load; the new device-loss hardening **works as designed** (routes out to a usable menu, error stream stabilizes, mode deactivates — versus the pre-fix permanent black scene), but route-out took **~80 s**, and Odyssey **cannot start at all** in this environment — which also means the only harness that ever measured Odyssey end-to-end can no longer produce Odyssey frame data (§12, §15).

### 1.2 The smallest safe sequence to an excellent high-end experience

Measurement first, levers second, code third (full batches in §16):

- **Batch 0 (measurement, no product behavior change):** pin adaptive-quality + pixel ratio in the perf lane, collect the long-task/memory/input data `perfMonitor` already gathers, run ≥5 iterations per cell, record machine identity, commit a canonical real-GPU baseline, wire `perf-budgets.json` into `perf:odyssey:compare`. Until this exists, no optimization claim about Odyssey — past or future — is falsifiable.
- **Batch 1 (existing flagged levers, A/B on the fixed lane):** `?odysseyLightsFirst=1` cold-boot A/B; `?odysseyChapterEvict=1` residency soak; fast-start vs full-warm matrix by save state.
- **Batch 2+ (targeted code changes, each gated by a capture):** GLB decode off the reveal-critical path, overlay floor made load-aware, per-frame allocation hygiene, CanvasTexture disposal (prerequisite for eviction default-on).

### 1.3 Claim limitations

- "AAA", "lag-free", "best in class" appear in repo planning docs as aspirations. This audit translates them into the explicit targets in §17 and makes **no** comparative "best in class" claim — no competitor data was measured.
- **No real-GPU, no packaged-Electron, and no display measurements were possible in this audit's environment** (no GPU device, no Electron binary, WebGPU unavailable in the container's Chromium — §3, §15). All real-hardware cells of the test matrix are `NOT_MEASURED_OR_BLOCKED` with exact rerun recipes (§18).
- Evidence labels used throughout: `MEASURED_FACT` (measured in this pass or verifiable committed artifact), `REPRODUCED_DEFECT`, `CODE_SUPPORTED_HYPOTHESIS`, `NOT_REPRODUCED`, `NOT_MEASURED_OR_BLOCKED`, `HISTORICAL_DOCUMENT_CLAIM`.
- Plan-claim classifications (§5): `SHIPPED_AND_DEFAULT_ON`, `SHIPPED_BUT_UNVERIFIED`, `BEHIND_FLAG_OR_DEFAULT_OFF`, `OPEN_AND_MEASURED`, `OPEN_BUT_UNMEASURED`, `STALE_OR_SUPERSEDED`, `CONTRADICTED_BY_CURRENT_CODE`, `CONTRADICTED_BY_RUNTIME_EVIDENCE`.

---

## 2. Scope, exact commit, and readiness definition

### 2.1 Scope

Odyssey mode end-to-end: entry from menu, board startup, all 8 registered chapter environments (`earth-core`, `deep-ocean`, `surface-world`, `mountain-peaks`, `sky-drift`, `cosmic-expanse`, `black-hole-transcendence`, `urban-dreams` — `src/rendering/odyssey/chapter-environments/registry.js:28-37`), all 7 seams, level entry/return, suspend/resume, device loss, memory/residency, and the measurement harness itself. Gameplay data: 8 chapters / 55 level entries (`src/core/odyssey/data/chapters.js`, `levels.js`; chapter 8 is "Urban Dreams Encore"). Note: menu copy says "56 levels across 7 chapters" — stale product copy, tracked in §19.

### 2.2 Ground truth

| Item | Value |
|---|---|
| Commit / branch | `c086471` on `claude/odyssey-performance-audit-1mfr9x` (== `origin/main` at audit time), working tree clean |
| Date of audit | 2026-07-17 (UTC) |
| Declared deps | three `^0.181.2`, phaser `^4.1.0`, electron `^38.8.6`, vite `^5.4.11` (`package.json`) |
| Installed (this pass) | three **0.181.2** (`node_modules/three/package.json`), Node 22.22.2, npm 10.9.7; Electron binary **not installed** (skipped download; no display/GPU in container) |
| Electron 38.8.6 runtime (from primary sources) | Chromium **140.0.7339.249**, Node 22.22.0, V8 14.0 ([releases.electronjs.org/release/v38.8.6](https://releases.electronjs.org/release/v38.8.6)) |
| Unit tests | `npx vitest run src/rendering/odyssey` → **20 files, 99 tests, all pass** (`MEASURED_FACT`, this container) |
| Production build | `npx vite build` succeeds. Odyssey chunks: `mode-OdysseyMode` **532 KB**, per-chapter lazy chunks 15–61 KB each (`earth-core` 43.7 KB, `surface-world` 60.6 KB, …), `three` chunk 1.6 MB, `phaser` 1.6 MB (`MEASURED_FACT`) |
| Odyssey 3D assets | **4.2 MB total** on disk; 7 GLBs, largest 844 KB (`src/rendering/odyssey/assets/`) (`MEASURED_FACT`) |

### 2.3 Startup milestone model (the 16 milestones, mapped to code)

"Startup" is measured as a waterfall, not one number. Code anchor for each milestone at this commit:

| # | Milestone | Code anchor | Currently instrumented? |
|---|---|---|---|
| 1 | Odyssey selected | `game-mode-ui.js:142` click → `startGameWithMode` event | no mark |
| 2 | First visual response | cinematic overlay shown, `OdysseyMode.js:3136` (`_showOdysseyUI`, before board build) | `[OdysseyPerf]` marks |
| 3 | Odyssey module loaded | dynamic `import('./OdysseyMode.js')` resolves, `GameModeManager.js:82,138` | no mark |
| 4 | Renderer + GPU device ready | `await this.renderer.init()`, `OdysseyBoardController.js:1395` | trace segment `renderer` |
| 5 | Focused-chapter assets fetched | chapter module dynamic import (`registry.js`); GLBs are **fire-and-forget after reveal** (§10.4) | partial (`creates` segment) |
| 6 | Assets decoded → scene objects | synchronous `def.create()`, `ChapterEnvironmentManager.js:696` | outliers >150 ms logged |
| 7 | GPU resources uploaded | first `compileAsync`/render of each env | not separately marked |
| 8 | Focused chapter created | end of eager-window loop, `OdysseyBoardController.js:609-628` | trace segment `creates` |
| 9 | Materials/pipelines compiled | `await Promise.all(compilePool)`, `OdysseyBoardController.js:759-762` | trace segment `compiles` |
| 10 | Focused chapter render-warmed | `await _warmUpJourney()`, `OdysseyBoardController.js:767-769` | trace segment `warmup` |
| 11 | First meaningful board frame | `_revealOdysseyBoard` + overlay dismissal, `OdysseyMode.js:3322-3339` | `[OdysseyStartup] board visible Nms` |
| 12 | Controls accepted | `isActive = true`, `OdysseyBoardController.js:771` (before reveal; wheel gated on `isActive`, `:243`) | no mark |
| 13 | First input reflected | first `renderFrame` after input | **not instrumented** (gap G-1, §15) |
| 14 | Stable-playable point | definition §2.4 | **not instrumented** (gap G-1) |
| 15 | Next chapter ready before reachable | `_ensureBoundaryAssets` prewarm, `OdysseyBoardController.js:2702-2718` | not instrumented per-seam |
| 16 | Background queue quiescent | last of: deferred creation (`ChapterEnvironmentManager.js:889-939`), prewarm drain (`:987`), bg render-warm sweep (`OdysseyBoardController.js:1047-1151`) | completion logged, not summarized |

### 2.4 "Stable playable" definition (adopted for all future gates)

Earliest rolling 5 s window after milestone 12 in which **all** hold:

- p95 frame time ≤ the refresh-tier budget (`perf-budgets.json`: 16.6 ms @60 Hz, 8.3 ms @120 Hz, 6.9 ms @144 Hz);
- no startup-attributable main-thread/animation-frame stall ≥ 50 ms (measure via `perfMonitor` long-task/LoAF observers, `performance-monitor.js:986-1025`);
- no visible shader-compile / upload / chapter-creation hitch;
- inputs continue to update simulation+render promptly;
- adaptive quality has **not** reduced renderScale/pixel ratio below the locked manifest (verifiable: renderScale is frozen until `_bgRenderWarmComplete`, `OdysseyBoardController.js:442,1879-1880`).

Background completion (milestone 16) is a diagnostic, **not** part of playability. All 8 chapters resident is explicitly not a goal; zero foreground compile stalls + predictive readiness + bounded residency is.

---

## 3. Environment and locked-quality manifest

### 3.1 This audit's runtime environment (diagnostic only — not a performance reference)

| Item | Value |
|---|---|
| Host | Linux 6.18.5 container, 4 CPU cores, 15 GiB RAM, **no GPU** (`/dev/dri` absent), no display |
| Browser used for functional smoke | Playwright Chromium build 1194 (`/opt/pw-browsers/chromium-1194`), headless; **WebGPU via SwiftShader flags** as in the committed harness |
| WebGPU availability probe | `navigator.gpu` **absent** in this container's Chromium under all flag combinations tried, including raw launch with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-features=Vulkan --enable-unsafe-swiftshader` — *except* when launched exactly as the committed harness does (Playwright `ignoreDefaultArgs: ['--disable-gpu']`), which does yield a SwiftShader WebGPU adapter that **loses its device during Odyssey chapter load** (§12.1) |
| Server | `npx vite preview` on `:4173` serving the fresh `dist` build of c086471 |
| Electron | not runnable here (binary skipped; no display). Packaged-player path `NOT_MEASURED_OR_BLOCKED` |

### 3.2 Locked-quality manifest (what comparable captures must record)

`perf-budgets.json` prescribes: *"Pin adaptive systems (tier + effectScale=1 + fixed pixelRatio) in every capture."* The full lock list for any comparable Odyssey capture:

window + render resolution; devicePixelRatio; `?odysseyPixelRatio=` override; quality tier; `?odysseyDisableAdaptiveQuality=1`; AA state (scene pass is `antialias:false` by default, `OdysseyBoardController.js:1385`); bloom config (3 mips, 0.25 scale, threshold 0.85 — `odyssey-tsl-pipeline.js:262-292`); post quality (`?odysseyPerfPostQuality`, `?odysseyPerfBloomScale`, `?odysseyPerfDisableBloom`); dome cull state (`?odysseyDomeCullOff`); draw-distance/culling defaults; chapter + save state + camera position + traversal path; warmup mode (`?odysseyWarmupMode`); background loading state (`?odysseyDisableBackgroundLoading`); eviction state (`?odysseyChapterEvict`).

**Current harness compliance: non-compliant by default.** `scripts/odyssey-perf-session.mjs` pins quality tier (Extreme) and target frame rate (240) but leaves adaptive quality and pixel ratio unpinned unless flags are passed (`odyssey-perf-session.mjs:65-85`); the screenshot harness `odyssey-chapter-capture.mjs:113-126` **does** pin all three and is the pattern to copy. (`MEASURED_FACT` from script inspection; finding OD-02.)

> **Status 2026-07-18:** remediated — the session harness now pins `odysseyDisableAdaptiveQuality=1` and `odysseyPixelRatio=1` **by default** (opt out via `--allow-adaptive` / `--pixel-ratio <v>`) and records the effective pins in its manifest. Background loading remains deliberately unpinned (it is measured, not locked; pin with `--disable-background-loading`).

---

## 4. Test protocol and benchmark-harness assessment

### 4.1 Protocol used in this pass

1. Static inspection of the full Odyssey startup path, all 8 chapter environments, post pipeline, lifecycle manager, and both trace systems (four parallel read-only investigations; all line references re-verified by spot-check).
2. Reconciliation of 10 planning/audit documents against current code (§5).
3. Harness source audit of all 6 perf/validation scripts + `perfMonitor` (§4.2).
4. Runtime (this container, software GPU, functional only): production build; 99 unit tests; 5 × startup scenario reruns; 1 × Odyssey smoke re-run using the **committed** harness (`reports/perf-audit-2026-07-16/harness/`) against the fresh build, outputs kept out of the repo.
5. Targeted primary-source research: Electron 38.8.6 → Chromium 140 mapping; Chromium Dawn disk caches (`DawnWebGPUCache`/`DawnGraphiteCache`); three r181 `compileAsync` contract (verified in installed source: lighting/environment must be configured before compile or pipelines re-specialize at first render — `node_modules/three/src/renderers/common/Renderer.js:830-841`).

### 4.2 Benchmark-harness assessment (audit the ruler before the measurement)

| Script | Path it measures | Trust caveats |
|---|---|---|
| `perf:odyssey:baseline` (`scripts/odyssey-perf-baseline.mjs` + `odyssey-perf-session.mjs`) | **Vite dev server** in an Electron window, host's real GPU | ⚠ dev-mode module graph (~74 unbundled modules historically), **not** packaged player; **1 run per cell**; adaptive quality + pixel ratio unpinned by default; manifest records no machine/GPU/refresh-rate identity; output goes to gitignored `artifacts/` — **no committed baseline has ever existed** |
| `perf:odyssey:compare` | two session JSONs | compares run-vs-run only; **never reads `perf-budgets.json`**; called by no CI |
| `validate:odyssey:webgpu` | dev server + `odyssey-webgpu-pilot.html`, **SwiftShader forced** | render-correctness lane, not perf; the only perf-adjacent CI lane (nightly, non-blocking) |
| `capture:odyssey:chapter` | screenshots + small seam rAF sampler | pins DPR=1, adaptive off, bg loading off (the model citizen); seam sampler reports max/avg/over-33/over-50 ms but SwiftShader in CI |
| `reports/perf-audit-2026-07-16/harness/` | **built `dist` preview**, Playwright Chromium + SwiftShader | absolute frame times non-representative (software raster); good for: ordering, long tasks, allocation/leak trends, stability defects, wall-clock regressions within-environment |
| `window.perfMonitor` (`src/utils/performance-monitor.js`, 1661 lines) | in-app | collects p50/95/99, >33 ms spikes with context, long tasks/LoAF with attribution, 1 Hz heap, draw/triangle counters, input-latency API — **but the Odyssey session harness discards long-task, memory, and input data** (`odyssey-perf-session.mjs:328-356` never calls them), and nothing in the Odyssey path calls `recordInput()` |

**Budget enforcement: none.** No file in code/CI reads `perf-budgets.json` (grep verified; also documented in `PERFORMANCE_STABILITY_AUDIT.md:402`). The budgets are declarative only. Frame-time gates (p95 16.6/8.3/6.9 ms) are sound as gates **once** the lane pins quality and runs on defined hardware; the `<3 s warm / <6 s cold` startup targets are provisional until §19's hardware tiers exist.

**GPU timing: absent.** `render.timestamp` is read by the capture script but is null without WebGPU timestamp-query wiring; `trackTimestamp` is debug-gated (`?odysseyAAA`). CPU/GPU split budgets in `perf-budgets.json` (6 ms/9 ms) are currently unmeasurable. (Gap G-8.)

### 4.3 Committed runtime-artifact inventory (what actually exists)

- `reports/perf-audit-2026-07-16/results/` (SwiftShader, built dist, 1280×720, commits fc03292→c086471 era): startup 5-run sets (13.6–14.0 s with the font stall; **0.88–0.93 s** after the offline-safe fix, `startup-nofonts2.json`; 0.86–1.5 s selfhosted); `odyssey-smoke.json` boot **36.8 s** to `isRunning` at fc03292 with device-lost + 60 fps-flat black-scene zombie; `odyssey-smoke-routeout-asserted.json` post-hardening: loss → route-out to usable menu in **63.0 s**, error stream stabilized; 30-min soak heap flat 35.4→36.8 MB; theme-cycle stellar-drift leak 35→52 MB (non-Odyssey); input-latency 60 samples (block game, median ~80 ms — **not Odyssey**); 2 CPU profiles.
- `artifacts/` (the official perf lane's output dir): **gitignored, empty in repo**.
- `docs/perf-captures/`: **does not exist** (BIC masterplan item A7 unfulfilled — the "~6 s board visible" claim has no committed capture).

---

## 5. Existing-plan reconciliation table

Docs: **BIC** = `ODYSSEY_BEST_IN_CLASS_MASTERPLAN_2026-07.md` (live umbrella), **MP-0622** = `ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06-22.md` (standing perf reference), **MP-06** (superseded by MP-0622), **LOAD** = `ODYSSEY_LOADING_OPTIMIZATION_PLAN.md` (stale, flagged by BIC §10), **OPT** = `ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md` (superseded), **CHP** = `ODYSSEY_CHAPTER_PERF_PLAN.md` (superseded), **STAB** = `PERFORMANCE_STABILITY_AUDIT.md` + `PERF_REMEDIATION_LOG.md`.

### 5.1 Key claims, classified against code at c086471

| Claim (doc) | Classification | Code evidence |
|---|---|---|
| Fast-start: reveal after focus-chapter warm only; default ON (BIC §1) | `SHIPPED_AND_DEFAULT_ON` | `OdysseyBoardController.js:295-304`; default `'current'` in `odyssey-performance-utils.js:19-26` (renamed from `odyssey-performance-flags.js` 2026-07-18, OD-15) |
| Focus-centered eager window `focus±1` replaces prefix `1..furthest+1` (BIC A1) | `SHIPPED_AND_DEFAULT_ON` | `OdysseyMode.js:3363-3387` |
| Board parked, not disposed, on level entry (keep-alive) (BIC §1) | `SHIPPED_AND_DEFAULT_ON` | `odysseyKeepBoard` default-true, `OdysseyMode.js:127`; `_parkOdysseyBoard`/`_revealOdysseyBoard` `:3673/:3585` |
| 17-sample seam-aware warm plan (BIC §1) | `SHIPPED_AND_DEFAULT_ON` (used only when fast-start off) | `odyssey-warmup-plan.js:26-46` |
| compileAsync bound through live post PassNode target (canvas-format trap fix) | `SHIPPED_AND_DEFAULT_ON` | `warmup/post-target-compile.js:25-71` |
| Persistent light rig → no per-seam LightsNode recompile (QW4) | `SHIPPED_AND_DEFAULT_ON` | `ChapterEnvironmentManager.js:403-413,705` |
| §0.0 fix 1: render-warm vs compileAsync `setPipeline` race → gate on `env.prewarmed` + ≤6 s grace | `SHIPPED_AND_DEFAULT_ON` / `SHIPPED_BUT_UNVERIFIED` at runtime | `OdysseyBoardController.js:1132-1140,1293` |
| §0.0 fix 2: probe storm (~138 stray full-scene renders) gated to debug overlay | `SHIPPED_AND_DEFAULT_ON` | `:1203,1227` (only under `debugOverlayActive`) |
| §0.0 fix 3: frame-health EMA backpressure on all background work | `SHIPPED_AND_DEFAULT_ON` | `:400-401,939-962` (33 ms budget, 8 s starvation escape) |
| §0.0 fix 4: eviction `onRecreated` re-warm race | `SHIPPED` (parent feature default-off) | `ChapterEnvironmentManager.js:513`; `OdysseyBoardController.js:661-662` |
| Adaptive-quality renderScale frozen until bg render-warm completes (fixes "low-res at 222 fps") | `SHIPPED_AND_DEFAULT_ON` | `:442,1879-1880` |
| Instanced level-node cores (55→1 draw; −54 pipelines) (L6) | `SHIPPED_AND_DEFAULT_ON` | `LevelNodeManager.js:40-54,352` |
| Global-dome cull (L8) | `SHIPPED_AND_DEFAULT_ON` | `OdysseyBoardController.js:326,2080` |
| Bloom 3 mips + quarter-res; scene-pass `antialias:false` (QW13/QW1) | `SHIPPED_AND_DEFAULT_ON` | `odyssey-tsl-pipeline.js:276,182`; `OdysseyBoardController.js:1385` |
| GLB diet to 7 meshopt GLBs ≈4.2 MB (BIC §1) | `SHIPPED_AND_DEFAULT_ON` | verified on disk (§2.2) |
| Lights-before-compile reorder (A2 — "single biggest cold-start lever") | `BEHIND_FLAG_OR_DEFAULT_OFF` | `?odysseyLightsFirst`, `OdysseyBoardController.js:603-641` |
| Chapter LRU eviction + shared-GLB-safe disposal (A6) | `BEHIND_FLAG_OR_DEFAULT_OFF` | `?odysseyChapterEvict=1`, `:309-316`; `ChapterEnvironmentManager.js:834-878` |
| Split compile barrier: await focus±1 only, drain rest (A3) | `OPEN_BUT_UNMEASURED` | barrier still `Promise.all(compilePool)` `:759-762` |
| Committed post-fast-start cold baselines in `docs/perf-captures/` (A7) | `OPEN_BUT_UNMEASURED` — **directory absent** | — |
| Selective emissive-MRT bloom (B5; proposed in ≥5 docs) | `OPEN_BUT_UNMEASURED` (plumbed, inert) | `odyssey-tsl-pipeline.js:177` `useMRT ?? false`, never true |
| Path shader evaluates all 8 chapter styles per fragment (B1) | `OPEN_AND_MEASURED` (counted in code) | `odyssey-path-renderer.tsl.js:347-348` |
| Ch6 dome/starfield cubemap bake (B2); Ch5 layer collapse (B4); ch7 two-dome fold (B3, attempted+reverted) | `OPEN_AND_MEASURED` (counts) / B3 revert recorded | per BIC §4 |
| LOAD plan's diagnosis ("board fully disposed 1.2 s after transition") | `STALE_OR_SUPERSEDED` (BIC §10 says so; keep-alive shipped) | — |
| MP-0622 "NOT STARTED" rows for L6/L8/eviction | `CONTRADICTED_BY_CURRENT_CODE` (all three exist; two default-on) | above |
| OPT QW3 "lower pixel-ratio caps" | `CONTRADICTED_BY_CURRENT_CODE` — July pass **raised** caps to theme parity (Extreme 1.5) | `desktop-performance-policy.js:50-71`; `ODYSSEY_MAX_PIXEL_RATIO=1.5` |
| STAB SB-08 "Odyssey has no device-loss handling" (at fc03292) | `CONTRADICTED_BY_CURRENT_CODE` (fixed since) + `MEASURED_FACT` that the fix routes out (SwiftShader, this pass §12.1) | `OdysseyBoardController.js:1413-1426` |
| BIC: "board visible in ~6 s (`total 5052ms / board visible 5921ms`), 30+s = post-reveal jank" | `HISTORICAL_DOCUMENT_CLAIM` — no committed capture; warm-cache RTX-5080 prose only | must be re-measured (Batch 0) |
| In-code comment "the (currently ~22s) warm-up" | `STALE_OR_SUPERSEDED` comment (fast-start default) | `OdysseyBoardController.js:2306` |

### 5.2 The 30–60 s symptom: historical attribution

- LOAD (2026-06-17): cold start ~8–13 s; split: compileAsync barrier 2.5–5 s · 8× chapter create 0.6–1.2 s · renderer.init 0.5–1.2 s · 17-sample warm 0.5–1.2 s · GLB 0.3–1.2 s (then-current heavy GLBs).
- MP-06/MP-0622: full-journey warm-up = "the 16–22 s pre-reveal cost"; cold-start tail p95 3406 ms / p99 8281 ms.
- BIC (2026-07-05) re-attribution: board visible ~6 s; then chapters 3–8 stream module-load + cold compile + render-warm **on the main thread for ~45 s** → visible board stutters; amplified by dev-mode module graph, no persistent Dawn cache in the browser profile used, and adaptive quality collapsing renderScale to 0.6 with ~84 s recovery.
- Only committed end-to-end number: **36.8 s** menu-click→`isRunning` at fc03292 — SwiftShader, explicitly non-representative (`MEASURED_FACT` of the artifact; `HISTORICAL_DOCUMENT_CLAIM` for real hardware).

All of §0.0's four defect fixes are in the tree; the **post-fix** experience has never been measured on real hardware. That is the central open question this audit hands to Batch 0.

---

## 6. Startup milestone waterfalls by cache, entry, and save state

### 6.1 Code-derived waterfall at default flags (`CODE_SUPPORTED_HYPOTHESIS`, ordering is `MEASURED_FACT` from instrumentation design)

```
click Odyssey (M1)
├─ dynamic import mode-OdysseyMode chunk [532 KB] + static renderer stack      (M3)
├─ onActivate: suspend theme loop; SHOW OVERLAY (M2)  [overlay floor ≥2.0s+0.8s fade starts]
└─ await _showBoardView → await OdysseyBoardController.initialize():
   ├─ await renderer.init()          ← WebGPU device creation (own device)     (M4)
   ├─ scene/camera/starfield/post-graph setup (sync)
   ├─ for ch in [focus-1, focus, focus+1]:                                    (M5,M6,M8)
   │    dynamic import chapter chunk → SYNC def.create() bake → push compileAsync
   │    (+ double-rAF yield between chapters)
   ├─ path build → 55 level nodes (instanced) → camera/lights/director
   │    (+ corridor-field & threshold-breach compiles pushed)
   ├─ await Promise.all(compilePool)  ← COMPILE BARRIER                        (M9)
   ├─ await _warmUpJourney()          ← fast-start: ONE render @focus          (M10)
   └─ isActive=true; animate()        ← CONTROLS LIVE (under overlay)          (M12)
├─ reveal: _focusBoardLevelForLaunch (awaits travelToLevel camera animation
│           if saved chapter ≠ start) → overlay min-visible+fade               (M11)
└─ post-reveal background (M16 tail): +900ms bg render-warm sweep; +1800ms deferred
   creation of remaining ~5 chapters (setTimeout 60ms spacing, backpressured);
   prewarm drain (80/60/160ms); GLB parses land mid-stream; warp preinit +5000ms
```

Key structural facts, each verified at the cited lines:

- **The reveal barrier is all-or-nothing** over the eager window's compile pool (`Promise.all`, `OdysseyBoardController.js:759-762`) — masterplan A3 (await focus only, drain neighbors in background) remains open.
- **Controls are live before reveal** (M12 precedes M11): `isActive=true` at `:771`, wheel routing gated on it (`:243`). The user-perceived "controls active" is the overlay dismissal.
- **Overlay floor:** `dismissCinematicLoadingOverlay(800)` uses the number-argument form → `minVisibleMs = GLOBAL_MIN_VISIBLE_MS = 2000` + 800 ms fade (`src/ui/cinematic-loading-overlay.js:8,204-242`). The `OdysseyMode.js:3280` `minOverlayDisplayMs=800` (masterplan A9) is **not** the effective floor; every overlay-shown entry pays ≥ ~2.8 s to M11 even if the board is instantly ready. Finding OD-07.
- **Progressed saves add awaited camera travel before reveal:** `_focusBoardLevelForLaunch(settle:true)` awaits `travelToLevel` (`OdysseyBoardController.js:1936,1962-1968`) — seconds of animation on late-progress saves, serialized before M11. Finding OD-08.
- **The 8 chapter environments are per-chapter lazy chunks** (`registry.js:28-37`) — module cost scales with the window, not with 8. (Vite `manualChunks` has no odyssey rule; the code-splitting comes from the registry's dynamic imports.)

### 6.2 Measured waterfall cells (this pass — software GPU, functional evidence only)

| Cell | Result | Label |
|---|---|---|
| App boot → menu-ready, built dist, 5 runs, fonts blocked, SwiftShader flags | **777 / 801 / 815 / 836 / 858 ms** (median 815 ms) | `MEASURED_FACT` (this container; not real-hardware perf) |
| Same, committed 2026-07-16 pre-#302 | 13.6–14.0 s (5 runs) — font/offline stall since fixed; post-fix committed runs 0.86–1.5 s | `MEASURED_FACT` (artifact) + regression **resolved** at c086471 |
| Menu → Odyssey `isRunning`, this pass | **never** — WebGPU device lost during chapter load; route-out to usable menu in ~80 s (§12.1) | `REPRODUCED_DEFECT` (environment-specific trigger; aftermath handling verified working) |
| Menu → Odyssey `isRunning`, committed fc03292 | 36.8 s (SwiftShader; pre-hardening zombie afterwards) | `MEASURED_FACT` (artifact, non-representative absolute) |
| All real-GPU cells (cold/warm Dawn cache × first-entry/re-entry/restart × fresh/late saves) | — | `NOT_MEASURED_OR_BLOCKED` — recipes in §18 |

### 6.3 Cache-state definitions (to be used by all future waterfalls)

Never say "cold" unqualified; the layers age independently:

| Layer | Cold means | Warm means | How to control |
|---|---|---|---|
| HTTP/app resources | first load of `dist` hash in profile | repeat load | fresh vs reused Chromium/Electron `userData` dir |
| Chromium code cache (V8) | new profile | second run same profile | same as above |
| **Dawn pipeline/shader cache** (`DawnWebGPUCache`/`DawnGraphiteCache` in the profile's GPUCache dirs; Chromium 140 ships Tint IR for faster WGSL→HLSL — [developer.chrome.com/blog/new-in-webgpu-136](https://developer.chrome.com/blog/new-in-webgpu-136)) | delete GPUCache dirs / new profile | prior Odyssey session in same profile | the baseline lane's `cold/warm/degraded` userData profiles already model this (`odyssey-perf-baseline.mjs:225-241`) |
| OS filesystem cache | reboot / first read | re-read | reboot or drop-caches between cold runs |
| In-process module + `g_OdysseyGltfCache` | first Odyssey entry this process | re-entry same process | app restart vs return-to-map |
| Parked board (`odysseyKeepBoard`) | first entry | return from level (resume path) | enter level and return |

---

## 7. Eight-chapter performance scorecard

Runtime per-chapter frame data does not exist yet (no real-GPU captures; SwiftShader smoke can't reach chapters here). This scorecard is **static-analysis** (`CODE_SUPPORTED_HYPOTHESIS`) with per-cell code evidence, to be replaced by measured columns in Batch 1.

| Ch | Env | create() cost profile | Assets | Per-frame CPU risk | Fill/overdraw risk | Dispose completeness |
|---|---|---|---|---|---|---|
| 1 | earth-core | **Highest** — ~450-line sync monolith (`earth-core.js:708-1160`); ~2 500+ GPU-quad particles across ~8 systems; heaviest single material graph (~28 snoise3/frag obsidian columns `:1051-1053`, shared 12→1) | none | Low (GPU particles, delta-correct) | Med | traverse-based; **3 node-graph CanvasTextures leak** (OD-11) |
| 2 | deep-ocean | High (`deep-ocean.js:165-367`) | manta+whale GLB 1.6 MB, parallel async | **Med** — ~128 CPU bubbles w/ full instanced-buffer re-upload/frame (`:993-1003`, visible-gated); god-ray matrix recompose ×6 (`:973-980`); 2 anim mixers | Med | traverse; canvas textures leak |
| 3 | surface-world | **Highest file** (147 KB TSL); 1 400 flowers + 220 reeds + 170 conifers + 600 pollen + terrain + 120-sample foreground loop (`surface-world.js:897-1160`) | 2 bird GLBs 1.6 MB + 3 conifer GLBs (shared) | **Highest** — many uniform forEach loops; **1 `Vector3` alloc/frame** via `getOdysseyPathPointAt().y` (`:1537`; `path-utils.js:81-85` no target param); 20 butterflies + birds CPU (`:1497-1779`) | Med | traverse; canvas leak |
| 4 | mountain-peaks | Med | conifer GLBs (cached, shared) | Low (GPU snow; small array alloc/frame `:1001`) | Med (cloud sea + aurora) | traverse |
| 5 | sky-drift | **Lowest** (25 KB) | none | Low | Med (6 strata + ribbons — collapse candidates B4) | traverse |
| 6 | cosmic-expanse | High — ~3 100 void stars + nebula/dust layers + 1 000 debris (`cosmic-expanse.js:206-444`) | none | Low (module scratch, no allocs) | **High** (additive stack; B2 cubemap bake open) | tsl `dispose()` exists **unwired** (`cosmic-expanse.tsl.js:336,604,653`) |
| 7 | black-hole | High — 720 dust + 520 embers + lensing starfield + streams (`black-hole-transcendence.js:549-657`) | none | Low (scratch vectors) | **Highest** (additive overdraw + lens post variant; B3 fold attempted+reverted) | tsl `dispose()` unwired (`…tsl.js:349-355,957`) |
| 8 | urban-dreams | Med — ~240 towers in **one** InstancedMesh (`urban-dreams.tsl.js:512-527`) | none | Low (rain GPU; procedural wet-reflection, no RT) | Med | traverse |

Cross-chapter facts: offscreen chapters **do not update or render** (`ChapterEnvironmentManager.js:1069-1078,1215-1219` — update gated on `group.visible`, visibility on blend weight > 0); no chapter fetches textures/HDRI (all procedural TSL); no real reflection render targets anywhere; frame-rate-dependent motion has been migrated to delta/uTime (spot-checked `urban-dreams.js:159`, `mountain-peaks.js:796`; rAF delta clamped at 0.05 s, `OdysseyBoardController.js:2207`).

---

## 8. Seven-seam traversal scorecard

Mechanism (verified in code): approach within `transition.preloadDistance` → `_ensureBoundaryAssets` requests source & target envs (create if missing + queue async prewarm) (`OdysseyBoardController.js:2702-2750`); seam crossing edge-triggers `_handleChapterSeam` (camera beat, director cross, post seam FX, threshold breach, path transition, music bridge — `:2537-2631`); corridor-field + breach pipelines are compiled pre-reveal (`:1565-1568`); seam co-presence pipeline state is covered by the warm plan **only when full warm runs** (fast-start defers it to background render-warm).

Per-seam runtime measurements: `NOT_MEASURED_OR_BLOCKED` in this environment (SwiftShader cannot reach the board). The committed seam sampler (`odyssey-chapter-capture.mjs:455-509`, reports max/avg/over-33/over-50 ms per seam) is the right tool; run per §18 on real hardware.

| Seam | Static risk assessment (`CODE_SUPPORTED_HYPOTHESIS`) |
|---|---|
| 1→2 earth-core→deep-ocean | first GLB parses (manta/whale) can land near this seam if traversal begins immediately after reveal (OD-06) |
| 2→3 →surface-world | **highest combined risk**: largest create() bake + 2 bird GLB parses + heaviest per-frame update turning on |
| 3→4 →mountain-peaks | shared-conifer cache hit (cheap if 3 loaded them); canonical-range merged geo |
| 4→5 →sky-drift | low (lightest chapter) |
| 5→6 →cosmic-expanse | large additive stack becomes visible; fill-rate step-up |
| 6→7 →black-hole | post pipeline **lens variant** attach (edge-triggered w/ hysteresis `odyssey-tsl-pipeline.js:849-862`; all variants prewarmed at startup only in full-warm mode `:388-410`) — under fast-start, first ch7 approach may pay the variant's first-use unless bg warm reached it (OD-04) |
| 7→8 →urban-dreams | moderate; tower InstancedMesh is one pipeline |
| Outrun case (all seams) | if the player outruns background warming, first visible frame of an unwarmed chapter compiles synchronously = hitch; bounded-grace warn-and-warm-anyway after ~6 s (`:1125-1140`). Backpressure gate cannot starve prewarm forever (8 s escape `:956-960`) but **can** delay it behind sustained interaction — exactly the "outrun" scenario. Needs the seam sampler + fast-scroll script (§18) |

Required traversal scenarios (stationary / normal / fast / outrun / stop-at-seam / reverse / repeated ping-pong / evict-and-reconstruct / level-in-and-out) are all currently unmeasured — matrix in §15.

---

## 9. CPU/GPU frame-pacing analysis

**What is measurable today:** CPU-side rAF frame-time distributions (p50/95/99/max, over-budget %, >33 ms spikes with context, long tasks/LoAF with script attribution) via `perfMonitor`; draw/triangle counters via `renderer.info` polling (`OdysseyBoardController.js:826-837`).

**What is not:** GPU frame time (timestamp queries debug-gated and null in captures); input-to-photon (nothing calls `perfMonitor.recordInput()` in Odyssey); anything on real hardware at this commit.

Committed distributions (SwiftShader, therefore **shape not scale**): menu-idle p50 33.3 / p95 49.9 ms; block-gameplay p50 66.7 / p95 116.6 ms; the fc03292 Odyssey smoke's *flat 16.7 ms while rendering a dead black scene* is the canonical in-repo demonstration of why average FPS is rejected as a health metric (§12.1).

Frame-pacing design facts in code (all `MEASURED_FACT` by inspection):

- Position-derived work throttled to ~30 Hz when camera settled (`positionWorkIntervalMs=33`, `OdysseyBoardController.js:451,2099-2136`); time-driven uniforms at full rate.
- Adaptive quality: renderScale frozen until background render-warm completes (`:442,1879-1880`) — prevents the historical "loading jank read as GPU pressure → 0.6 renderScale for ~84 s" failure; skipped while hidden.
- Background work admission requires interaction-idle AND camera-settled AND frameMsEma ≤ 33 ms (`:939-962`) — post-reveal streaming should never stack onto an already-slow frame, **by design; unverified by runtime trace on real HW** (Batch 1 must capture a post-reveal LoAF trace).
- Known per-frame allocation sites (GC pressure, small but real): surface-world Vector3/frame (OD-10); deep-ocean full-buffer re-upload/frame while visible (OD-12); manta/whale `{x,y,z}` literals ×4/frame; mountain-peaks array spread/frame. No allocation found in the post pipeline's `update()` (scratch-vector discipline throughout, `odyssey-tsl-pipeline.js:701-882`).

---

## 10. Loading, compilation, and streaming analysis

### 10.1 Module loading
Odyssey mode chunk 532 KB + three 1.6 MB (parse cost on first entry); chapters lazy per-registry. In packaged Electron, `modulePreload` is deliberately disabled (`vite.config.js:73`) — file:// loads, no preload indirection. Dev mode's ~74-module graph is a dev-only amplifier (historically misattributed as product slowness — treat dev traces as diagnostic only).

### 10.2 Compilation
One dedicated `WebGPURenderer` per board (not shared with themes; themes suspended on entry — `OdysseyMode.js:384-386`); device init awaited at `OdysseyBoardController.js:1395`. Pipelines compile via `compileAsync` **through the live post target** (`warmup/post-target-compile.js`) so the compiled variants are the ones actually used. three r181's contract (verified in installed source): compile captures current lighting/environment — the persistent light rig (QW4) exists precisely to keep that state stable across seams. The `?odysseyLightsFirst` experiment (compile after full light rig) is the plan's highest-leverage untested lever (A2) — **cold-boot A/B required** before considering default-on.

### 10.3 Streaming and warming (default path)
Post-reveal pipeline, in order (all constants verified): bg render-warm sweep starts +900 ms (steps 120 ms, per-chapter prewarm-wait ≤6 s grace, frame-health-gated, warns-and-warms on grace expiry — `OdysseyBoardController.js:1047-1151`); deferred creation of non-window chapters starts +1800 ms (`setTimeout` 500 ms initial, 60 ms spacing — deliberate: rAF starves `requestIdleCallback`, `ChapterEnvironmentManager.js:903-909,938`); prewarm drain 80/60/160 ms cadence (`:976`). Worst-case tail if the gate never blocks: ~5 chapters × (import + sync create + compile + sync offscreen render) — the code's own comments budget the sweep at "~30×300ms=9s"/"~30×200ms=6s" classes (`:1117,1135`). With repeated 8 s starvation escapes under continuous interaction, **a player who scrolls constantly can stretch M16 into the tens of seconds** — consistent with the "feels fully loaded at 30–60 s" perception even when M11/M14 are early. `REPRODUCED` only in historical doc prose; **needs one real-GPU trace to close (Batch 1, T-2)**.

### 10.4 Asset decode
GLB loads are **fire-and-forget inside `create()`** (e.g. `snow-conifer-belt.js:59-107` detached `loadPromise`), so fetch+parse+`SkeletonUtils.clone` land on the main thread **after reveal**, uninstrumented, at unpredictable times relative to traversal. KTX2 wiring exists but is a **no-op** (current GLBs ship uncompressed textures — `odyssey-gltf-loader.js:38-53`); no Draco; Meshopt inline. Total payload is small (4.2 MB), so this is a **hitch** source, not a bandwidth problem (OD-06).

### 10.5 Dawn/GPU pipeline cache
Chromium 140 (Electron 38.8.6) persists compiled WebGPU pipelines/shaders in per-profile `DawnWebGPUCache`/`DawnGraphiteCache`; Tint IR (Chrome 136+) cut WGSL→HLSL translation up to ~10× ([source](https://developer.chrome.com/blog/new-in-webgpu-136)). Consequences: (a) packaged Electron with a stable `userData` gets warm-compile benefits across sessions — first-ever launch is the true worst case; (b) any benchmark not controlling the profile directory silently mixes cold/warm compile states (the baseline lane's 3-profile design already models this — keep it); (c) dev-browser sessions with throwaway profiles overstate compile cost. `CODE_SUPPORTED_HYPOTHESIS` for this app (cache behavior itself is platform fact; its magnitude here is unmeasured — Batch 0 must A/B cold-vs-warm GPUCache explicitly).

---

## 11. Memory, resource lifetime, eviction, and re-entry analysis

- **Residency policy (default):** eager window pre-reveal, then background creation of the rest → **steady state = all 8 chapters resident**; eviction is opt-in (`?odysseyChapterEvict=1`, window N=2, caps 1 evict+1 create per tick — `ChapterEnvironmentManager.js:834-878`) and mutually exclusive with the bg loader/warm (`OdysseyBoardController.js:1052`). Bounded-residency goal is therefore **not met by default today**; it is designed, gated, and unsoaked. GPU-memory residency numbers: `NOT_MEASURED_OR_BLOCKED` (no real GPU; no VRAM observability — gap G-8).
- **Disposal:** centralized traverse frees geometry/materials/material textures/uniform textures/userData render targets (`ChapterEnvironmentManager.js:743-804`); shared-GLB-cache meshes correctly skipped (`fromSharedGltfCache`). **Blind spot:** textures bound only inside TSL node graphs (`texture(map, uv())`) are invisible to the traverse — at least 7 CanvasTextures across ch1/ch2/ch3 leak on dispose/evict (OD-11). Harmless while eviction is off and the board is parked-not-disposed; **must be fixed before eviction graduates**. Two chapters ship never-wired tsl `dispose()` methods — the natural home for the fix.
- **Re-entry:** `odysseyKeepBoard` default-on parks the board (renderer + scenes alive, loop stopped) on level entry; return is a resume, not a rebuild. Full app restart = full cold path (module + device + compile, minus Dawn disk cache).
- **Heap evidence (SwiftShader artifacts, trends valid):** Odyssey session heap 70.9 MB vs menu ~35 MB; 30-min soak flat (35.4→36.8 MB — no global leak); 12× restart-cycle flat; the 35→52 MB theme-cycle growth is the stellar-drift **theme** issue (SB-15), not Odyssey. Odyssey-specific repeated entry/exit/traversal heap + listener trend: not yet captured (add to Batch 1 matrix).

---

## 12. Stability, input, timing, device-loss, and visual-parity findings

### 12.1 Device loss (fresh runtime evidence, this pass)

Re-ran the committed smoke harness (`reports/perf-audit-2026-07-16/harness/odyssey-smoke.mjs`, unmodified, output redirected outside the repo) against the fresh `dist` of c086471, SwiftShader WebGPU:

- Menu loads; Odyssey entry begins; during chapter load Dawn reports **`Device Lost: A valid external Instance reference no longer exists`** (a known SwiftShader/Dawn instance-lifetime artifact in this harness family — the *trigger* is environment-specific and **not claimed** to reproduce on real hardware).
- **Post-hardening behavior verified working:** `[GpuLossCoordinator] recovery for "odyssey-board" failed: Odyssey WebGPU device loss is terminal — routing out` (by design, `OdysseyBoardController.js:1413-1426`); mode deactivated (`modeAfterLoss:null`); menu **usable** (screenshot verified); error stream **stabilized** (0 errors in settle window — vs the fc03292 zombie's endless `popErrorScope` spam + black scene at a flat 60 fps).
- **But:** `routeOutLatencyMs` ≈ **79.8 s** this run (63.0 s in the committed assert run). Route-out latency of 60–80 s between loss and usable menu is a real player-experience number to re-verify on real hardware TDR (label: `REPRODUCED_DEFECT` for latency magnitude under SwiftShader; `NOT_MEASURED_OR_BLOCKED` on real HW). Finding OD-09.
- Consequence for measurement: **Odyssey cannot start under SwiftShader at this commit** (loss always precedes `isRunning`), so the only harness that ever produced an Odyssey end-to-end number is now blind for Odyssey frame/startup data. The functional CI lane (`validate:odyssey:webgpu`) still works because the pilot page renders chapters individually. Finding OD-03/G-9.

### 12.2 Input
No input-latency measurement exists for Odyssey (API present in `perfMonitor:521-540`, zero call sites on this path; the committed 60-sample ~80 ms median is the block game). `cascadeInputLatencyP95Ms` budget (max 17 ms) is currently unfalsifiable for Odyssey. Gap G-1.

### 12.3 Timing correctness
rAF delta clamped (0.05 s); fixed-tick sim; per-frame motion delta/uTime-based (spot-checked across chapters); no frame-rate-dependent gameplay logic found in the Odyssey board path (`NOT_REPRODUCED` for the "frame-rate-dependent logic" hypothesis, within static-analysis limits).

### 12.4 Visual parity guardrails
Shipped: renderScale freeze until bg warm completes; dome cull restored at seams; variant hysteresis prevents bloom/lens flapping. Missing: any automated parity check that a "fast" run didn't ship reduced fidelity — captures must record the §3.2 manifest (Batch 0 adds it to the session output; `odyssey-chapter-capture` already pins its inputs).

---

## 13. Ranked findings register

Severity: ▲ high (blocks the product goal), ● medium, ○ low. Every finding: evidence label · affected stage · evidence · smallest safe remediation · acceptance test · revert condition. "Repro" = exact command in §18.

| ID | Sev | Finding |
|---|---|---|
| **OD-01** | ▲ | **No trustworthy Odyssey performance measurement exists.** `MEASURED_FACT` (harness audit §4). Affects: every milestone. Evidence: `odyssey-perf-session.mjs:65-85,328-356`; gitignored `artifacts/`; absent `docs/perf-captures/`; no budget consumer. Remediation (smallest): 6 edits to the existing lane — default-pin adaptive+DPR; collect `getLongTaskSummary()`/memory/`getReleaseGateSnapshot()` in `collectResult`; `--runs 5` aggregation; machine manifest fields; committed output dir; budget check in `odyssey-perf-compare`. Acceptance: one committed real-GPU baseline (cold+warm Dawn cache × fresh/late save), rerunnable ±10%. Revert: n/a (tooling). **Status 2026-07-18: harness landed — baseline capture pending (owner, RTX + iGPU machines).** All 6 edits shipped: default pins (OD-02); `collectResult` now harvests `getLongTaskSummary()` / `performance.memory` / release gates (null when absent, never throws); `--runs N` with per-metric median/p95/min/max aggregate; machine manifest (OS/CPU/RAM/GPU adapter/commit/effective URL/pins); committed output dir `reports/odyssey-perf/` (README documents the four baseline cells); `odyssey-perf-compare.mjs --fail-on-regression` consumes `perf-budgets.json` (max exceeded or >10% over baseline fails; null baselines report SKIPPED — proven by `--self-test`). |
| **OD-02** | ▲ | **Perf lane violates its own pinning rule** — adaptive quality + pixel ratio float by default, so p95/p99 tails are contaminated by the adaptive controller. `MEASURED_FACT`. Files: `odyssey-perf-session.mjs:77,82`. Remediation: copy `odyssey-chapter-capture.mjs:113-126` pins. Acceptance: session manifest records `adaptive:disabled, dpr:<fixed>`. **Status 2026-07-18: landed** — pins are default-on (`--allow-adaptive` / `--pixel-ratio <v>` opt out) and the manifest records `pins.adaptive` / `pins.dpr`. Background loading intentionally NOT pinned (part of what the lane measures). |
| **OD-03** | ▲ | **The 30–60 s symptom is unverifiable at this commit on any committed evidence path**: real-GPU baseline absent (A7 open), SwiftShader lane now device-loses before Odyssey starts (§12.1). `MEASURED_FACT` + `REPRODUCED_DEFECT`. Remediation: Batch 0 then a 5-run cold/warm waterfall on the dev RTX + iGPU machines; separately, pilot-page-based Odyssey board smoke for CI (board via `odyssey-webgpu-pilot.html?chapter=` renders without full app, avoiding the loss-prone path) to restore an automated functional lane. Acceptance: committed waterfall with all 16 milestones. |
| **OD-04** | ▲ | **Post-reveal streaming tail is the prime suspect for "feels loaded at 30–60 s", and can be stretched by the player.** `CODE_SUPPORTED_HYPOTHESIS` + `HISTORICAL_DOCUMENT_CLAIM` (BIC §0.0). Stage: M11→M16. Evidence: §10.3 constants; 8 s starvation escapes under continuous interaction; sync offscreen `renderer.render()` per chapter (`OdysseyBoardController.js:1194`); ch7 lens-variant first-use under fast-start (§8). Remediation (after Batch 0 measures it): implement A3 barrier split + emit an `M16 background-quiescent` summary event; consider per-chapter compile-only (no sync render) warm when frame health is marginal. Acceptance: p95 ≤ tier budget and zero ≥50 ms startup-attributable stalls during the first 60 s of play on min-spec, while fast-traversing. Revert: flags exist (`?odysseyBgWarm=0`, `?odysseyDisableBackgroundLoading=1`). |
| **OD-05** | ● | **Reveal barrier is all-or-nothing over focus±1 compiles** (A3 open): one slow neighbor compile delays M11. `CODE_SUPPORTED_HYPOTHESIS`; `OdysseyBoardController.js:759-762`. Remediation: await focus-chapter pool only; drain ±1 into the bg queue with priority. Acceptance: cold M11 improves with no first-scroll hitch regression (seam sampler). Revert: `?odysseySerialInit=1` insurance path retained. |
| **OD-06** | ● | **GLB decode/parse is fire-and-forget on the main thread post-reveal** (ch2/ch3/ch4 assets; uninstrumented hitches; KTX2 wired but no-op with uncompressed textures). `CODE_SUPPORTED_HYPOTHESIS`; `snow-conifer-belt.js:59-107`, `odyssey-gltf-loader.js:38-53,69-78`. Remediation (staged): (i) instrument parse duration; (ii) schedule loads through the same backpressure gate; (iii) evaluate KTX2-compressing the 4 textures'd GLBs (product-visual tradeoff → §19). Acceptance: no ≥50 ms parse task while board visible. |
| **OD-07** | ● | **Warm re-entry reveal is floored at ~2.8 s by the overlay** (2000 ms `GLOBAL_MIN_VISIBLE_MS` + 800 ms fade), defeating the parked-board resume; masterplan A9's 800 ms floor is not the effective one. `MEASURED_FACT` (code). `cinematic-loading-overlay.js:8,204-242`; `OdysseyMode.js:3324-3339`. Remediation: pass `{fadeOutMs:800, minVisibleMs:800}` (or 0 on parked-resume path). Product decision on feel → §19. Acceptance: parked-board return M11 < 1.5 s; no flash-of-unstyled-scene. **Status 2026-07-26: landed** (a29c27f) — wrapper uses the options form; `_showBoardView` threads `minOverlayDisplayMs` (parked passes 0). Overlay-shown warm re-entry drops ~2800ms → ~860ms fade + readiness. Adversarial review clean: board awaited before dismiss (no flash), fade always runs, mode-wait + overlay floor never stack. 5 tests (`odyssey-reveal-latency.test.js`). |
| **OD-08** | ● | **Late saves pay an awaited camera travel before reveal** (`travelToLevel` under the overlay). `CODE_SUPPORTED_HYPOTHESIS`; `OdysseyBoardController.js:1936-1968`, `OdysseyMode.js:3301`. Remediation: snap-place camera pre-reveal (travel only when distance small), or reveal first and travel visibly (nicer). Acceptance: late-save M11 ≈ fresh-save M11 ±0.5 s. **Status 2026-07-26: landed** (a29c27f) — startup focus uses `settle:false`. NUANCE (adversarial review corrected the hypothesis): the cold late-save travel penalty does NOT occur — at startup `focusLevelId=selectedLevelId` is null → focus branch skipped → `travelToLevel` never awaited; the restore path (`:1262`) already used `settle:false`. Real benefit = return-to-board paths (post-play/fail) skip the awaited ~800ms `focusOnNode`. Safe (all 4 review refutations); interactive nav keeps `settle:true`. |
| **OD-09** | ● | **Device-loss route-out latency 63–80 s** (SwiftShader runs; mechanism serialized behind timers/loops rather than immediate). `REPRODUCED_DEFECT` (this env) / `NOT_MEASURED_OR_BLOCKED` (real TDR). Remediation: instrument the route-out path stages; cap loss→menu at ≤5 s. Acceptance: simulated `device.destroy()` → usable menu ≤5 s, error stream stable. |
| **OD-10** | ● | **surface-world allocates a `Vector3` every frame** (`getOdysseyPathPointAt` has no target param — `path-utils.js:81-85`, call `surface-world.js:1537`) and runs the heaviest CPU `update()`. `CODE_SUPPORTED_HYPOTHESIS`. Remediation: add optional target param; hoist scratch. Acceptance: zero allocs/frame in ch3 update under DevTools allocation sampling. |
| **OD-11** | ● | **TSL node-graph CanvasTextures leak on dispose/evict** (≥7 across ch1/2/3 — bound via `texture()` nodes, invisible to the disposal traverse). `CODE_SUPPORTED_HYPOTHESIS`; `earth-core.js:179-190,1345,1693,1718`; `ChapterEnvironmentManager.js:771-783`. **Blocks eviction default-on.** Remediation: chapters register owned textures in `userData.ownedTextures` (or wire the existing unwired tsl `dispose()`s); traverse frees them. Acceptance: create→evict×8 shows flat texture count in `renderer.info`. |
| **OD-12** | ○ | deep-ocean re-uploads the full ~128-bubble instanced buffer every visible frame + god-ray matrix recompose ×6 (`deep-ocean.js:973-1003`). Remediation: move rise integration to GPU (uTime) like other chapters, or partial update. Acceptance: no per-frame `needsUpdate` uploads in ch2. |
| **OD-13** | ○ | Minor per-frame allocs: manta/whale `{x,y,z}` literals ×4 (`deep-ocean-manta.js:263-266`); mountain-peaks array spread (`mountain-peaks.js:1001`). Fix with OD-10 pattern. |
| **OD-14** | ○ | **Flags-registry defaults are documentation-only for Odyssey** — all `odyssey*` flags are read from URL/localStorage at hardcoded-default call sites, never via `readFlag()`; `flags.js:139-172` defaults could silently drift from code. `MEASURED_FACT` (grep). Remediation: route reads through `readFlag()` or add a unit test asserting registry-default == call-site default. **Status 2026-07-18: landed (test-only remediation)** — `tests/unit/odyssey-flag-registry-drift.test.js` pins registry default == call-site default for all 10 `odyssey*` flags and fails on either side drifting (or on a new `odyssey*` flag landing uncovered). Reads deliberately NOT rerouted through `readFlag()` (startup-path behavior change, out of scope). |
| **OD-15** | ○ | Dead/stale code confusing future work: `ChapterEnvironmentManager.initialize()` (awaits ALL chapters) uncalled; `transitionToChapter()` unreferenced on render path; `setCinematicLoadingOverlayBuilding` never invoked on Odyssey path; stale "~22s warm-up" comment (`OdysseyBoardController.js:2306`); `odyssey-performance-flags.js` misnamed (contains no flags). Remediation: delete/rename/correct in a docs-hygiene commit. **Status 2026-07-18: landed.** Deleted: `ChapterEnvironmentManager.initialize()` + `transitionToChapter()` (grep-verified uncalled at HEAD, incl. dynamic-call patterns and tests). Rewrote the "~22s" comment (historical figure; re-measure via `scripts/odyssey-perf-session.mjs`). Renamed `odyssey-performance-flags.js` → `odyssey-performance-utils.js` (+ its test + importer; boundaries check green). SKIPPED with reason: `setCinematicLoadingOverlayBuilding` is NOT dead — live callers at `src/main.js:2991,3012` (non-Odyssey cold-build calm-hold path); "never invoked on the Odyssey path" stands, but the export must stay. |
| **OD-16** | ○ | No progress feedback: overlay is time-based starfield + dots; "ready" is wall-clock, not load-state; no percent/stage display despite rich trace segments existing. Player-experience item → §19 (product). |

---

## 14. Rejected hypotheses

| Hypothesis | Verdict | Basis |
|---|---|---|
| Asset I/O (bytes) dominates startup | **Rejected as primary** | 4.2 MB total GLB, no HDRI/texture fetches in chapters (`MEASURED_FACT` on disk; §10.4) — decode *hitches* remain (OD-06), bandwidth does not |
| A readiness barrier awaits all 8 chapters at default flags | **Rejected** | eager window focus±1 (`OdysseyMode.js:3363-3387`); the only await-all method is dead code (OD-15) |
| Offscreen chapters keep updating/rendering | **Rejected** | update gated on `group.visible`; visibility on blend weight (`ChapterEnvironmentManager.js:1069-1078,1215-1219`) |
| Menu/app boot contributes to the 30–60 s at this commit | **Rejected (this environment)** | 0.78–0.86 s menu-ready ×5 fresh runs; committed post-#302 runs agree (§6.2). Packaged-Electron confirmation pending |
| Frame-rate-dependent gameplay/animation logic | **Not reproduced** | delta/uTime migration verified at sampled sites; delta clamp present (§12.3) |
| Adaptive quality still masks loading jank by downscaling | **Rejected at code level** | renderScale frozen until bg warm complete (`:442,1879-1880`); runtime confirmation folded into Batch 1 captures |
| Bloom/post is unbounded (5-mip, full-res) | **Rejected** | 3 mips, 0.25 scale, threshold 0.85, Minimal-tier drop (`odyssey-tsl-pipeline.js:243-292`) — remaining post costs are the ch7 lens variant + MRT-selective-bloom opportunity (open B5) |
| Draw-call explosion from per-node meshes | **Rejected** | 55 cores instanced default-on; towers/asteroids/god-rays/flora instanced (§7) |

---

## 15. Blocked or unmeasured tests

| Test | Status | Blocker | Recipe |
|---|---|---|---|
| Packaged production Electron startup/frame captures (the primary evidence path) | `NOT_MEASURED_OR_BLOCKED` | no display/GPU/Electron binary in container | §18 R-1 on target hardware |
| Real-GPU cold vs warm Dawn-cache waterfalls; 5 runs × {first-entry, re-entry, restart} × {fresh, ch-7 save} | blocked | same | §18 R-1/R-2 |
| 120 Hz / 144 Hz tiers; min/typical/high-end hardware matrix | blocked + **no hardware contract defined** → `REVIEW_REQUIRED` | §19 D-1 | — |
| Per-chapter + per-seam frame captures incl. outrun/reverse/ping-pong | blocked here | §18 R-3 (tool exists) |
| WebGPU in this container (for local reruns) | **probed and failed** — `navigator.gpu` absent under raw launch + flags; only the harness's exact Playwright launch yields an adapter that then loses its device | environment | probe script preserved in §18 R-6 |
| Input latency in Odyssey | unimplemented (G-1) | Batch 0 item | — |
| GPU frame time / VRAM residency (G-8) | unimplemented | timestamp-query + diagnostics wiring | — |
| Recoverable device loss on real TDR; suspend/resume; monitor DPR changes | blocked here | §18 R-5 |
| Soak: repeated Odyssey entry/exit ×20, traversal ping-pong ×10, evict-flag soak | not run (no board under SwiftShader) | §18 R-4 |

Observability gaps register: **G-1** input latency (API exists, unwired) · **G-2** long-task/memory discarded by session collector · **G-3** no machine/refresh-rate manifest · **G-4** single-run cells · **G-5** no committed baseline dir · **G-6** budgets unenforced · **G-7** GLB parse uninstrumented · **G-8** GPU timing/VRAM absent · **G-9** no CI-safe Odyssey board functional smoke (post-hardening SwiftShader loss) · **G-10** no M13/M14 (input-reflected / stable-playable) marks.

---

## 16. Ranked implementation batches (dependency-ordered; each small, benchmarked, revertible)

> Implementation is explicitly out of scope for this pass. Batches reference finding IDs; approve by ID.

**Batch 0 — Make the ruler honest (OD-01, OD-02, G-1..G-7, G-10).** Perf-lane edits only, no product behavior: pin adaptive+DPR; collect long-task/memory/input; ≥5 runs with median/IQR; machine+quality manifest; committed `reports/odyssey-perf/` baseline dir; budget check in compare; `recordInput()` wiring in scroll/transition scenarios; M13/M14 marks + M16 summary event in the startup trace (a few `trace.event()` calls). *Acceptance:* committed baseline from the RTX + iGPU machines, cold+warm Dawn profiles, fresh+late saves. *Rollback:* n/a.

**Batch 1 — Measure the two shipped-but-off levers + the streaming tail (OD-04 evidence, A2, A6).** No code changes: A/B `?odysseyLightsFirst=1` cold boots ×5; `?odysseyChapterEvict=1` residency soak (blocked from default-on by OD-11); fast-start vs `?odysseyFastStartOff=1` matrix; post-reveal 60 s LoAF/long-task trace while fast-traversing (the OD-04 verdict). *Acceptance:* each lever gets `OPEN_AND_MEASURED` → ship/kill decision with numbers.

**Batch 2 — Reveal-path latency (OD-05, OD-07, OD-08).** Three independent small diffs: barrier split (await focus only); overlay `minVisibleMs` option honored on parked-resume; snap-or-visible-travel for late saves. Each behind its own capture before/after; visual-parity manifest identical. *Rollback:* revert individual diff; `?odysseySerialInit=1` remains as insurance.

**Batch 3 — Streaming robustness (OD-04 remediation, OD-06).** Backpressured GLB scheduling + parse instrumentation; compile-only warm under marginal frame health; M16 quiescence event. *Acceptance:* outrun scenario on min-spec shows zero ≥50 ms stalls.

**Batch 4 — Frame hygiene (OD-10, OD-12, OD-13).** Target-param `getOdysseyPathPointAt`, ch2 GPU bubbles, literal/spread fixes. *Acceptance:* allocation-sampling zero-alloc frames in ch2/ch3; no visual diff in captures.

**Batch 5 — Residency graduation (OD-11 then A6 default).** Owned-texture disposal fix → evict/create ×8 leak test → eviction soak → flip default with `?odysseyChapterEvictOff` escape. *Acceptance:* bounded VRAM on min-spec with no seam hitch regression.

**Batch 6 — Fidelity-cost options requiring product sign-off (§19):** B5 selective-MRT bloom, B2 cubemap bake, B4 layer collapse, KTX2 texture compression, OD-16 overlay progress UI.

---

## 17. Acceptance, regression, and rollback criteria (mode-wide)

- **Startup (provisional until D-1 hardware tiers):** warm (same-process re-entry / parked resume) M11 ≤ 1.5 s, M14 ≤ 3 s; cold app-restart M11 ≤ 6 s, M14 ≤ 8 s on the recommended tier; first-ever-launch (cold Dawn) documented separately, target M14 ≤ 12 s.
- **Frame pacing (from `perf-budgets.json`, now enforced):** p95 ≤ 16.6/8.3/6.9 ms per tier; zero ≥50 ms startup-attributable stalls after M12; worst consecutive-slow-frame run ≤ 3 frames during traversal; seam crossings add no over-50 ms frame (seam sampler).
- **Input:** Odyssey input-to-next-frame p95 ≤ 1 frame at tier rate (measured via the newly wired probe; the 17 ms budget line applies to cascades in block gameplay).
- **Memory:** heap flat over 30-min Odyssey soak (±5%); with eviction on, texture/geometry counts return to baseline after evict×8.
- **Stability:** device-loss → usable menu ≤ 5 s, zero unhandled rejections after settle; entry/exit ×20 leak-free.
- **Visual parity:** every gate capture carries the §3.2 manifest; any fidelity-reducing change is a §19 product decision, never an optimization side effect.
- **Regression protocol:** every batch = before/after on the Batch-0 lane, ≥5 runs, medians compared, `--fail-on-regression` + budget gate; rollback = revert the single batch diff (each batch is one revertible unit; flags retained for the risky ones).

---

## 18. Raw artifact index and exact rerun commands

**Committed artifacts (in-repo):** `reports/perf-audit-2026-07-16/results/*.json` (see §4.3 inventory), harness in `reports/perf-audit-2026-07-16/harness/`, SHA256SUMS present. Historical docs with numbers: BIC §0.0/§1, MP-0622, `PERFORMANCE_STABILITY_AUDIT.md` §6.10, `PERF_REMEDIATION_LOG.md`.

**This pass's fresh artifacts** (generated in the session scratchpad, intentionally **not** committed to keep the audit doc the only tracked deliverable; key numbers embedded in §6.2/§12.1): `startup-rerun-c086471.json` (5 runs: 777/801/815/836/858 ms menu-ready), `odyssey-smoke.json` rerun (`started:false, bootMs:110268, routeOut:{lossDetected:true, menuUsable:true, routeOutLatencyMs:79811, errorsDuringSettleWindow:0, errorStreamStabilized:true}`, heap 55.3 MB, 3 unique error signatures), route-out menu screenshot.

**Rerun recipes:**

- **R-1 (primary, real hardware):** packaged build → `npm run build:win` (or `build:linux`), install, launch with `--user-data-dir` pointed at (a) fresh dir = cold Dawn, (b) reused dir = warm; capture `[OdysseyStartup]`/`[OdysseyPerf]` console lines + a Performance-panel trace of the first 60 s; 5 runs per cell × {fresh save, ch-7 save} × {first entry, level-return, app restart}.
- **R-2 (dev lane, after Batch 0):** `npm run perf:odyssey:baseline -- --runs 5 --disable-adaptive-quality --pixel-ratio 1` then `npm run perf:odyssey:compare -- <before> <after> --fail-on-regression`.
- **R-3 (chapters/seams):** `npm run capture:odyssey:chapter -- --chapter <1..8>` and seam mode per script header; SwiftShader in CI = functional; real GPU for timings.
- **R-4 (soak/cycles):** `node reports/perf-audit-2026-07-16/harness/run-scenario.mjs restart-cycle 12`; Odyssey variant after G-9 fix.
- **R-5 (device loss, real HW):** in DevTools on the board: `const d = await navigator.gpu.requestAdapter().then(a=>a.requestDevice()); …` — or use the app's own device via `window.serenityBlocks` debug handle and call `device.destroy()`; assert menu ≤ 5 s.
- **R-6 (this container's WebGPU probe, for reference):** launch `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --no-sandbox --enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-features=Vulkan --enable-unsafe-swiftshader` → `navigator.gpu` undefined; the committed harness's Playwright launch (`ignoreDefaultArgs: ['--disable-gpu']`) is the only working form here.
- **Fresh smoke rerun used in §12.1:** `npx vite build && npx vite preview --port 4173 &` then run a copy of `reports/perf-audit-2026-07-16/harness/odyssey-smoke.mjs` from a directory containing `playwright-core` (results write to that copy's `./results/`; keep outside the repo).

---

## 19. Open product decisions (blocking full sign-off)

| ID | Decision needed |
|---|---|
| D-1 | **Target hardware contract** (min + recommended GPU/CPU, refresh tiers). Blocks severity-ranking for real users, the §17 numbers, and any "excellent high-end experience" claim. Proposal: min = the dev iGPU (already TDR-documented in CLAUDE.md), recommended = mid-range discrete (e.g. RTX-4060-class), nightly lane = RTX-5080 laptop (already named in `perf-budgets.json`). `REVIEW_REQUIRED` |
| D-2 | **Overlay feel:** keep the 2.0 s cinematic floor on cold entry? Reduce/remove on parked-resume (OD-07)? Add progress stages (OD-16)? |
| D-3 | **Reveal-vs-travel:** snap camera for late saves, or visible post-reveal travel (OD-08)? |
| D-4 | **Residency policy:** graduate eviction (bounded VRAM) as default after OD-11 + soak, or keep all-8-resident on ≥recommended tier and evict only on low tier? |
| D-5 | **Fidelity-cost items** (Batch 6): selective-MRT bloom scope, ch6 cubemap bake, ch5 layer collapse, KTX2 texture compression — each changes pixels; each needs a before/after capture approval. |
| D-6 | Stale product copy: menu says "56 levels across 7 chapters"; data has 8 chapters (ch-8 "Urban Dreams Encore") / 55 level entries. Decide the canonical copy. |
| D-7 | Startup targets ratification: adopt §17's provisional numbers (or amend) once D-1 lands. |

---

## Working-tree confirmation

This audit adds exactly one tracked file: `ODYSSEY_MODE_PERFORMANCE_AUDIT.md`. No production source, config, dependency, or script was modified. Diagnostic runs used copies of committed harness scripts executed from an out-of-repo scratchpad with outputs kept out of the repo; `git status` at commit time shows only this document.
