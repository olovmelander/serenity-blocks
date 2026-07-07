# Web/Desktop GPU Rendering Architecture — Research Report

**Scope:** Three.js WebGPURenderer + TSL practices, WebGPU device-loss handling, GPU testing in CI without hardware, frame-time budgeting + perf gates, canvas/context management, VRAM residency + LRU eviction, adaptive resolution / quality tiers.

**Game context applied throughout:** Serenity Blocks — Three.js WebGPU/TSL, 61 themes, heavy post-processing, Electron desktop, hardware range iGPU→RTX, existing 6-tier quality policy, per-surface pixelRatio caps, TDR-prone dev iGPU (CI must use software rasterizers).

---

## 1. Three.js WebGPURenderer + TSL best practices

### The practice

- **Imports are a hard boundary.** Import from `three/webgpu` (renderer, node materials) and `three/tsl` (TSL functions). Never mix `three` and `three/webgpu` import paths in one bundle — duplicated class identities cause subtle breakage (utsubo migration guide).
- **Initialization is async.** `WebGPURenderer` requires `await renderer.init()` before first render, or use `renderer.setAnimationLoop(render)` which handles init automatically (official three.js manual). The utsubo guide calls out the classic failure: *"Forgetting `await renderer.init()`. Your scene will render nothing with no error message."*
- **`ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()`, and legacy `EffectComposer` are NOT supported** under WebGPURenderer. All custom shading must be ported to NodeMaterial + TSL. New post effects (SSGI, SSS, improved DoF) are WebGPURenderer-exclusive (three.js manual).
- **One TSL source, two backends.** TSL lowers to WGSL (WebGPU) or GLSL (WebGL2 fallback) via `WGSLNodeBuilder`/`GLSLNodeBuilder`, with automatic backend workarounds (e.g. `pow()` negative-base fix on DirectX). `forceWebGL: true` lets you test the fallback path deliberately (official TSL wiki, three.js manual).
- **Uniform update frequencies matter.** Prefer `.onFrameUpdate()` (once/frame), `.onRenderUpdate()` (once/render pass), `.onObjectUpdate()` (per object) over manual `.value` writes; this is the sanctioned way to avoid hidden recompiles and redundant GPU state changes (TSL wiki).
- **Hoist to vertex stage.** `vertexStage(expr)` moves computation from per-pixel to per-vertex; TSL only materializes a varying when a node is actually consumed in the fragment stage (TSL wiki).
- **Build-time conditionals instead of #defines.** TSL `Fn`s are evaluated at shader-build time with access to `material`/`geometry`/`object`/`camera`, so plain JS `if`s produce shader variants without preprocessor strings (TSL wiki).
- **Node reuse dedupes.** Sharing node instances (e.g. one `uniform()` across materials) deduplicates the generated code; TSL also auto-caches repeated sub-expressions in temporaries (TSL wiki).
- **Hybrid escape hatch.** `wgslFn()` / `glslFn()` wrap native shader code inside the node graph; the official transpiler example converts existing GLSL to TSL (Maxime Heckel field guide; three.js transpiler example).
- **Compute:** `Fn(...)().compute(count)`, default workgroup `[64,1,1]`, max 256 threads/workgroup, `.computeKernel([x,y,z])` for manual sizing; atomics and barriers available (TSL wiki, Heckel).

### Why

The three.js project's development focus has shifted to WebGPURenderer; WebGLRenderer is maintenance-only for new features. TSL is the abstraction that keeps 61 themes' worth of shader code portable across WGSL/GLSL and across future three.js versions ("benefit from bug fixes in new versions without rewriting shader code" — TSL wiki).

### Application to this game

- The codebase is already WebGPU/TSL for its heavy themes. The architecture plan should make **`three/webgpu` + `three/tsl` the only sanctioned import surface** and lint against `import * from 'three'` in theme code.
- With 61 themes, **shader permutation count is the scaling risk**. Use the TSL build-time-conditional pattern to bake the 6-tier quality policy into shader variants (tier as a JS constant at material build, not a runtime uniform branch) — dead code is eliminated at build, unlike a `×0` uniform which the project has already observed is NOT dead-code-eliminated (chromadelic-highway finding).
- Standardize a **shared TSL node library** (noise, fog profiles, tone ramps, storm scalars) so themes share node instances and the generated-code deduplication actually fires.
- Uniform hygiene: the project's per-frame `THREE.Color` scratch-reuse work (stellar-drift) aligns with the wiki guidance; note the observed gotcha that **in-place Color mutation still uploads** — treat uniform writes as dirty-marking, and prefer `.onFrameUpdate()` callbacks.
- **Warm-up policy:** first use of each pipeline compiles shaders on the main thread. The project has measured that awaiting `compileAsync()` can regress entry time on this machine (loading-screen finding); the plan should treat warm-up as a per-theme scheduled activity (warm before intro, calm-hold overlay) rather than a blanket `await`.

### Pitfalls

- `texture()` vs `uniform()` confusion: `uniform()` only accepts scalar/vector/matrix/Color types; textures go through `texture()` (Heckel).
- MRT post-processing: `setMRT()` must be called before `getTexture()` or it silently fails (Heckel). Relevant because several themes run non-MRT bloom deliberately.
- TSL `Switch/Case` has implicit break (no fallthrough); dynamic array indexing needs `.element(i)`, not `a[i]` (TSL wiki).
- Some node semantics differ by pipeline stage (`instanceIndex` in vertex vs compute) (Heckel).
- Known project-level TSL instancing gotcha: `positionNode` runs before `instanceMatrix` application (summer-midsummer finding) — document it in the shared TSL library.
- Explicit disposal is still required for geometry/materials/textures under WebGPU (utsubo).

**Sources**
- three.js manual — WebGPURenderer: https://threejs.org/manual/en/webgpurenderer.html
- Official TSL wiki: https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language
- Field Guide to TSL and WebGPU (Maxime Heckel): https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
- WebGPU + Three.js Migration Guide (Utsubo, 2026): https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- three.js forum — WebGL→WebGPU migration thread: https://discourse.threejs.org/t/is-there-a-migration-guide-on-webglrenderer-to-webgpurenderer/69005
- TSL transpiler example: https://threejs.org/examples/webgpu_tsl_transpiler.html

---

## 2. WebGPU device-loss handling

### The practice

- **Always attach a `device.lost.then(...)` handler immediately after device creation. Never `await device.lost`** — in the happy path it never resolves and you block forever (toji.dev best practices).
- **Branch on `info.reason`:** `'destroyed'` = intentional (`device.destroy()`) → do not auto-recover; anything else (`'unknown'`) → attempt recovery. **Do not parse `info.message`** — it is implementation-specific and unstable (toji.dev, MDN `GPUDeviceLostInfo`).
- **Recovery ladder** (toji.dev):
  1. Bare minimum: user-facing "graphics failed — reload" message.
  2. Restart GPU content only: re-run the full init path (`requestAdapter` → `requestDevice` → `context.configure` → recreate ALL buffers/textures/pipelines) without reloading the page.
  3. State-preserving recovery: keep authoritative game state in JS (never GPU-only), so recreation is lossless.
- **Request a fresh adapter every time.** Adapters "expire" after `requestDevice()`; a stored adapter cannot mint a second device (toji.dev).
- **Loss causes:** OS TDR (Windows default ~2s GPU hang → driver reset), VRAM exhaustion, driver bugs, GPU process crash. Loss is *expected* in production at fleet scale — "fires multiple times per day across the user base" for apps with many users on mixed hardware.
- **Testing:** `device.destroy()` simulates the API surface (with caveats — buffers aren't unmapped, new devices always succeed); Chrome `about:gpucrash` produces a realistic crash, and repeated crashes escalate: eventually `requestAdapter()` returns `null`, at which point the correct advice is "restart the browser/app", not "reload" (toji.dev, Chrome troubleshooting). For dev/test sessions, bypass Chromium's progressive 3D-API domain blocking with `--disable-domain-blocking-for-3d-apis --disable-gpu-process-crash-limit` (toji.dev) — CI/dev only, never shipped.

### Why

The WebGPU error model (spec §device-loss; gpuweb ErrorHandling design doc) deliberately makes loss non-exceptional: all API calls remain valid no-ops on a lost device, so an unprepared app doesn't crash — it just silently renders nothing. Only the `lost` promise tells you. On this project's hardware range (TDR-prone iGPU at the low end), device loss is a *when*, not an *if*.

### Application to this game

- Create **one central `GpuHost`/renderer-owner module** that: owns `WebGPURenderer` creation, attaches the `lost` handler, exposes a `deviceGeneration` counter, and orchestrates teardown/recreate. Theme `createScene()` contracts already rebuild from pure JS state — formalize that as a requirement: *every theme must be disposable and re-creatable from CPU-side state* (board state, combo scalars, storm director S, settings).
- On loss with `reason !== 'destroyed'`: freeze gameplay sim (it's CPU-side), show the existing calm-hold overlay, recreate renderer + current theme only (not all 61), replay warm-up for the active theme, resume. Cap retries (e.g. 2); if `requestAdapter()` returns null, show "restart the game" (Electron: offer `app.relaunch()`).
- **Electron specifics:** the renderer-side `device.lost` promise may never fire if the whole GPU *process* dies — in the main process listen to `app.on('child-process-gone', (e, details) => details.type === 'GPU')` (successor to the deprecated `gpu-crashed` event; `details.reason` says crashed/killed/oom) and signal renderers to run the same recovery path. Consider `app.disableDomainBlockingFor3DAPIs()` so repeated crashes don't permanently kill 3D APIs for the session — but pair it with your own backoff (e.g. 3 losses in 5 min → persist a one-tier quality demotion before reinit) to avoid crash loops. The packaged app can also fall back to the WebGL2 backend (`forceWebGL`) as a degraded-but-running mode after repeated WebGPU losses.
- **WebGL fallback path needs the parallel mechanism:** `webglcontextlost` (call `event.preventDefault()` to permit restore) + `webglcontextrestored` re-init.
- **TDR prevention on iGPU tiers:** long compute passes are the classic trigger. The 6-tier policy should cap per-frame compute dispatch sizes on low tiers (snow-sim, particle sims), and never run "full-journey" style mega-frames — mirroring the dev-machine TDR lesson.

### Pitfalls

- Awaiting `device.lost` (blocks forever).
- Reusing the old adapter for recovery (fails).
- Assuming Chrome will recover for you — the app must recreate every GPU resource itself.
- Confusing initial unavailability (no WebGPU support → use WebGL fallback) with post-loss failure (restart advice).
- Testing only with `device.destroy()` — it under-approximates real loss; use `about:gpucrash` in Chrome sessions too.

**Sources**
- WebGPU Device Loss best practices (Brandon Jones / toji.dev): https://toji.dev/webgpu-best-practices/device-loss.html
- MDN `GPUDevice.lost`: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost
- MDN `GPUDeviceLostInfo`: https://developer.mozilla.org/en-US/docs/Web/API/GPUDeviceLostInfo
- gpuweb error-handling design doc: https://github.com/gpuweb/gpuweb/blob/main/design/ErrorHandling.md
- Chrome WebGPU troubleshooting tips: https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- Bevy issue tracking engine-level recovery (survey of the problem space): https://github.com/bevyengine/bevy/issues/10456
- Electron `app` API (`child-process-gone`, `disableDomainBlockingFor3DAPIs`, `relaunch`): https://www.electronjs.org/docs/latest/api/app
- Microsoft — WDDM Timeout Detection and Recovery (TDR, ~2 s default): https://learn.microsoft.com/en-us/windows-hardware/drivers/display/timeout-detection-and-recovery

---

## 3. GPU testing in CI without hardware

### The practice

GitHub-hosted runners are CPU-only VMs — no GPU, no vendor drivers. Real projects test GPU code there with **software rasterizers**:

- **WebGPU via SwiftShader (Vulkan on CPU):** launch Chrome/Chromium with
  `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --headless=new --no-sandbox`.
  All CPU adapters (including SwiftShader) are blocklisted by default; `--enable-unsafe-webgpu` (or `--disable-dawn-features=adapter_blocklist`) is required to get one (Chromium issue 40057808, Chrome troubleshooting).
- **`forceFallbackAdapter: true`** in `requestAdapter()` requests a software adapter per spec, but plain Chrome returns `null` for it because of the blocklist — it only works with the flags above (Chromium issue 40057808).
- **WebGL on CPU:** SwiftShader *automatic* fallback is deprecated/removed in Chromium; explicit opt-in is now `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` (Chromium swiftshader.md; "Intent to Remove: SwiftShader Fallback"). Chromium's stated direction is **Mesa lavapipe** for Linux software rasterization.
- **Lavapipe (Mesa's CPU Vulkan):** install Mesa on the Linux runner and point Vulkan at it with `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json`; Chrome then does WebGPU→Dawn→Vulkan→lavapipe. On Windows runners, `jakoch/install-vulkan-sdk-action` + prebuilt lavapipe/SwiftShader binaries (jakoch/rasterizers) is a maintained path.
- **Reference precedent:** the wgpu project runs the WebGPU CTS in CI on **D3D12 WARP** (Microsoft's software adapter) on Windows runners, with lavapipe/llvmpipe planned for Linux (gfx-rs blog). Dawn's own CI works the same way.
- **If you do have a GPU runner** (self-hosted / cloud T4): the Chrome team's documented headless flags are `--headless=new --no-sandbox --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --enable-unsafe-webgpu` (Chrome "Supercharge Web AI testing" blog).

### Why

The alternative — no GPU tests at all — is how WebGPU validation errors, black-screen init bugs, and per-theme regressions reach users. A software adapter executes the *same Dawn validation layer and WGSL compiler* as real hardware, so it catches: pipeline/bind-group validation errors, missing `await renderer.init()`, broken TSL that only fails at WGSL lowering, resource leaks, and device-facing API misuse. This matters doubly here because **the dev machine's iGPU TDR-crashes under heavy capture work** — CI on software rasterizers moves that risk off the developer's hardware entirely.

### Application to this game

- **CI job "webgpu-smoke" (Linux, ubuntu-latest):** Playwright/Puppeteer + Chrome with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --headless=new`. For each of the 61 themes: load the playground page (`playground.html?effect=<id>&t=<fixed>`), wait for `window.__PLAYGROUND_READY__`, render N frames, assert zero console/WebGPU validation errors, screenshot.
- **Field gotcha — headless vs xvfb:** practitioners report Chrome's WebGPU/Dawn adapter creation failing under `--headless=new` on driverless Linux while succeeding as a headed Chrome under `xvfb-run -a` (install `xvfb` + `google-chrome-stable` in the workflow). If the smoke job gets `requestAdapter() === null`, switch to the xvfb recipe before debugging anything else; retest on Chrome upgrades since headless GPU support improves release-by-release (zenn field notes; electron#38189 for the Electron-in-Docker variant).
- **Assert the adapter you think you're testing:** in-page, check `adapter.info?.architecture === 'swiftshader'` (or log `adapter.info` wholesale) so the suite fails loudly if CI silently landed on a different adapter — and tag telemetry/goldens with it so software-rendered runs never mix with hardware baselines.
- **Golden-image comparison with tolerance** (pixelmatch/SSIM, per-theme thresholds): software rasterization differs slightly from hardware, and the playground's `?t=<seconds>` phase-locking (already built) is exactly what makes goldens reproducible.
- **Second job "webgl-fallback":** same suite with `forceWebGL: true` (three.js flag) — this is cheaper than SwiftShader-WebGPU and validates the mandatory fallback path.
- **Budget the suite:** SwiftShader/lavapipe is 10–100× slower than hardware; keep CI frames-per-theme small (2–5 frames), disable top quality tiers in CI (run Tier-Low + Tier-Extreme-structural-only), raise test timeouts, and shard themes across runners.
- **Never gate on FPS in these jobs** — software-rasterizer timings are meaningless as performance data (see §4 for the perf lane).
- **Electron parity:** Electron passes the same Chromium switches via `app.commandLine.appendSwitch('enable-unsafe-webgpu')` etc.; a small Electron smoke job (xvfb on Linux) validates the packaged-app rendering path, including the relative-asset-path class of bug already hit in production.

### Pitfalls

- SwiftShader flags are named "unsafe" for a reason (JIT in the GPU process) — CI-only, never in shipped Electron flags.
- Fallback adapters have **lower WebGPU limits** than hardware adapters; don't let CI-passing limits mask hardware-required limits (query `adapter.limits` in the smoke test and log them).
- Chromium is actively removing WebGL-SwiftShader fallback; pin Chrome versions in CI and prefer the lavapipe route for longevity.
- Headless + `--no-sandbox` interacts with root containers; use the documented flag set rather than ad-hoc combos.
- A green software-rasterizer run proves *correctness*, not *TDR-safety* on real iGPUs — keep a manual desktop-session capture lane for that (already project practice).

**Sources**
- Chromium docs — Using Chromium with SwiftShader: https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- Chromium issue — Support WebGPU Software Adapters (blocklist + flags): https://issues.chromium.org/issues/40057808
- Chrome for Developers — Supercharge Web AI model testing (headless GPU flags): https://developer.chrome.com/blog/supercharge-web-ai-testing
- Chrome WebGPU troubleshooting tips: https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- Intent to Remove: SwiftShader fallback (blink-dev): https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
- gfx-rs blog — wgpu CI runs CTS on WARP: https://gfx-rs.github.io/2021/09/16/deno-webgpu.html
- Prebuilt Windows software rasterizers for CI: https://github.com/jakoch/rasterizers and https://github.com/marketplace/actions/install-vulkan-sdk-and-runtime
- GitHub Actions runner-images request for lavapipe: https://github.com/actions/runner-images/issues/2998
- Headless Chrome + NVIDIA T4 reference setup: https://github.com/jasonmayes/headless-chrome-nvidia-t4-gpu-support
- Field notes — chrome-headless + WebGL/WebGPU on Linux (xvfb + swiftshader adapter + GitHub Actions YAML): https://zenn.dev/syoyo/articles/4f084b2288428f
- Electron + SwiftShader WebGPU in Docker (open issues): https://github.com/electron/electron/issues/38189

---

## 4. Frame-time budgeting + automated perf regression gates

### The practice

- **Budget in milliseconds of frame time, not FPS.** FPS is non-linear and averages lie; the industry standard is percentile frame times — p50 for typical feel, **p95/p99 for hitches** — because "regressions in the tail are almost always caused by a specific change, not by general drift" (percentile-metrics literature; Aerospike/OneUptime explainers).
- **Mind the frame-metrics fine print** (CapFrameX): the 99th percentile of *frame times* equals the 1st percentile of *FPS* — pick one domain (frame-time ms) and standardize all tooling on it, since mislabeled "P99 FPS" numbers are endemic. Percentiles count *frames*, not *time*: a P1 of 45 fps means 99% of frames were faster, not 99% of playtime. Time-weighted "x% low integral" metrics reflect perceived smoothness better than count-based percentiles, and the p1–p99 *span* is a useful consistency signal; medians resist outliers better than averages. p99 needs long captures (thousands of frames) to be stable — gate on p95, dashboard p99.
- **Split the budget CPU vs GPU.** CPU frame time comes from `requestAnimationFrame` deltas / `performance.now()`; GPU time needs **timestamp queries**. Three.js exposes this directly: construct the renderer with `trackTimestamp: true`, then `await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)` (and `.COMPUTE`) to get per-pass GPU milliseconds (threejsroadmap profiling guide; three.js PR #30299). Note the resolved number is the *sum of passes since last resolve*.
- **Game-industry gate structure** (visible in tools like PerfGuard for UE): scripted deterministic scenarios → timeline + histogram + delta table + percentiles per scenario → a fast "quick capture" as PR smoke test and a full scenario suite as the **ship gate**; nightly runs across key scenes logged to a dashboard.
- **CI benchmarking on hosted runners is noisy** — shared VMs show high variance, and the practical consensus (Quansight measurement work; Bencher docs; github-action-benchmark) is:
  - Use **relative benchmarking**: measure baseline and candidate in the *same job on the same runner*, or compare against the rolling main-branch baseline with a generous threshold.
  - On hosted runners, thresholds of **~1.5–2×** are what you can reliably detect without false-positive fatigue; tools default to alerting at 200% (github-action-benchmark).
  - For finer gates (5–10%), use **dedicated/self-hosted runners with fixed hardware** — for a GPU game this means a real-hardware perf lane, not GitHub-hosted VMs.
- Tooling: `github-action-benchmark` (threshold alerts, commit comments, historical charts on gh-pages), Bencher (statistical thresholds, relative mode).

### Why

A 61-theme game accretes per-theme regressions silently — the project's own history (per-theme perf review campaigns recovering 30–100+ fps) is evidence. Percentile gates catch the *hitch* class of regression (GC spikes, shader recompiles mid-game, streaming stalls) that average-FPS checks structurally cannot.

### Application to this game

- **Define the budget table per tier:** e.g. 60 Hz tiers → 16.6 ms total (CPU ≤ 6 ms, GPU ≤ 9 ms, 1.6 ms headroom); 120 Hz Extreme → 8.3 ms GPU. Encode it in one module the perf harness and the adaptive system (§7) both read.
- **In-game perf HUD/harness:** the playground already phase-locks time; add a `?perf=1` mode that runs a fixed 20-second scripted loop (spawn pieces, trigger a combo storm, theme transition), records frame-time series + `renderer.info` (draw calls, textures, geometries) + resolved GPU pass times, and emits JSON `{p50, p95, p99, gpuRender, gpuCompute, drawCalls, vram-proxy}` per theme.
- **Three lanes:**
  1. **PR lane (hosted CI, SwiftShader):** correctness only — no timing gates (see §3).
  2. **Nightly lane (self-hosted runner on the RTX machine, real window, `--noDrs` + pinned `effectScale=1` + fixed pixelRatio):** run the perf harness across a rotating subset of themes; gate at p95 frame time > budget × 1.25 vs the stored baseline; alert, don't hard-fail, for the first weeks to calibrate noise.
  3. **Release lane:** full 61-theme sweep + the Odyssey scripted scroll, ship-gate style.
- **Pin the adaptive systems during measurement.** The project has already learned this the hard way (MCP throttles `effectScale` < 0.64; quality reads `window.settings.graphicsQuality`): DRS and tier auto-demotion *mask* regressions — every perf capture must force tier + resolution.
- **Discard warm-up**: first N seconds include pipeline compiles and JIT; standard practice is to drop them before computing percentiles.

### Pitfalls

- Gating on averages (hides hitches) or on FPS (non-linear, vsync-quantized).
- Trusting hosted-runner timings — variance swamps <50% regressions (Quansight/Bencher guidance).
- Timestamp-query granularity: `resolveTimestampsAsync` sums passes since last resolve — resolve per pass group if you want attribution.
- Thermal throttling on the laptop runner: fix power profile, cool-down gaps between themes, and record GPU clock context if possible.
- Alert fatigue: "noisy benchmarks train engineers to ignore alerts" — start with wide thresholds and tighten.

**Sources**
- Profiling WebGPU in three.js (`trackTimestamp`, `resolveTimestampsAsync`): https://threejsroadmap.com/blog/profiling-webgpu
- three.js PR — WebGPU timestamp query fix: https://github.com/mrdoob/three.js/pull/30299
- WebGPU timing lesson (raw timestamp queries): https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html
- github-action-benchmark (threshold alerts, baselines): https://github.com/benchmark-action/github-action-benchmark
- Bencher — continuous benchmarking, relative mode + statistical thresholds: https://github.com/bencherdev/bencher and https://bencher.dev/docs/how-to/track-benchmarks/
- Quansight Labs — Is GitHub Actions suitable for running benchmarks?: https://labs.quansight.org/blog/github-actions-benchmarks
- PerfGuard (UE perf-regression product; scenario/percentile/gate structure): https://getperfguard.com/
- Percentile explainers (p50/p95/p99 for CI gates): https://oneuptime.com/blog/post/2025-09-15-p50-vs-p95-vs-p99-latency-percentiles/view and https://aerospike.com/blog/what-is-p99-latency/
- CapFrameX — Explanation of performance metrics (frame-time percentiles, x% low integral, P99↔P1 inversion): https://www.capframex.com/blog/post/Explanation%20of%20different%20performance%20metrics

---

## 5. Multiple canvas / context management (browser + Electron)

### The practice

- **WebGL contexts are hard-capped per page** (~8–16 depending on browser; creating one more silently kills the oldest — `webglcontextlost` on it). Resources (textures, compiled programs) **cannot be shared across contexts** (three.js multiple-scenes manual; webglfundamentals).
- The canonical pattern is **one full-viewport canvas + one renderer**, with per-view rendering via `renderer.setScissorTest(true)` + `setScissor(...)` + `setViewport(...)`, driven by placeholder DOM elements whose `getBoundingClientRect()` defines each view; skip views that are off-screen (three.js manual "Multiple Canvases, Multiple Scenes").
  - Scroll-sync trick: `position: absolute` canvas + `translateY(window.scrollY)` per frame so slow rendering lags gracefully instead of visually detaching.
  - Alternative for complex layouts: render once to the shared canvas, then `drawImage` copy into per-element 2D canvases (slower; 2D canvases are cheap and uncapped).
- **WebGPU changes the economics:** one `GPUDevice` can drive **many canvases** — each canvas does `getContext('webgpu')` + `context.configure({ device, format })` and all GPU resources are shared. There is no documented small context ceiling, but each configured canvas owns swapchain textures (memory), and the webgpufundamentals multi-canvas lesson demonstrates that rendering all of them is what kills you — use **IntersectionObserver** to maintain a visible-set and render only those.
- **Electron:** each `BrowserWindow` is its own Chromium renderer process with its own context budget; within one window the browser rules above apply unchanged. Keep the game in one window/one canvas; avoid `<webview>`/iframe-per-surface designs which multiply GPU process pressure.

### Why

Context loss from ceiling-eviction looks exactly like a GPU crash but is self-inflicted and only happens in the field (users with more panels open). Sharing one device/renderer also shares compiled pipelines — with 61 themes, recompiling shaders per-context would be catastrophic for theme-switch latency.

### Application to this game

- **Theme gallery / preview grid is the danger zone.** 61 live previews must not be 61 contexts. Options, in order of preference:
  1. **Static thumbnails:** render each theme once to the shared renderer, snapshot to `ImageBitmap`/blob, cache to disk (Electron) — zero live GPU cost in the gallery.
  2. **One live "hero" preview** (hovered/selected theme) rendered via the shared renderer into a scissored viewport or a render target composited into the UI.
  3. If multiple live previews are truly wanted on WebGPU: single device + per-canvas configure + IntersectionObserver visible-set, hard-capped (e.g. 4 live).
- **Board + background + playground:** keep the existing single-canvas architecture; per-surface pixelRatio caps map cleanly onto per-view `setViewport` sizes or offscreen render-target resolutions rather than separate canvases.
- **Spectator/multiplayer boards** (FFA watch mode): same scissor pattern — one renderer, one scene graph per opponent viewport, render only on snapshot updates (pairs with the existing frozen-tetromino spectator RAF fix).
- Because the game must also run the **WebGL2 fallback backend**, design all multi-view features to the *WebGL* constraint (single canvas + scissor), which automatically works on WebGPU too.

### Pitfalls

- Scissor rect Y-flip: DOM rects are top-left origin, GL viewport is bottom-left (`positiveYUpBottom = canvasHeight - rect.bottom`).
- Forgetting per-view `camera.aspect` + `updateProjectionMatrix()`.
- Clearing: disable scissor test before full-canvas clear, re-enable for views.
- WebGPU multi-canvas memory: every configured canvas holds swapchain buffers at its own resolution × DPR — cap preview DPR hard.
- Don't assume the WebGL context ceiling away in Electron just because it's desktop — same Chromium.

**Sources**
- three.js manual — Multiple Canvases, Multiple Scenes: https://threejs.org/manual/en/multiple-scenes.html
- WebGL Fundamentals — Multiple Views, Multiple Canvases: https://webglfundamentals.org/webgl/lessons/webgl-multiple-views.html
- WebGPU Fundamentals — Multiple Canvases (one device, IntersectionObserver): https://webgpufundamentals.org/webgpu/lessons/webgpu-multiple-canvases.html
- r3f discussion — Safari "too many active WebGL contexts": https://github.com/pmndrs/react-three-fiber/discussions/2457
- three.js forum — sharing one context across canvases: https://discourse.threejs.org/t/sharing-the-same-webgl-context-for-different-canvases/73034

---

## 6. VRAM / asset residency + LRU eviction for many-theme games

### The practice

- **Engines treat GPU-resident assets as a strict-budget LRU cache.** Unreal's virtual-texture pools are the reference model: fixed-size pools; when a new tile is needed and the pool is full, "the page containing the **least recently seen** tile is evicted"; when the streaming pool goes over budget the system degrades by **dropping mip levels** (blur) rather than failing (UE docs; techarthub).
- **Residency ≠ loaded.** Only what the current frame needs must be GPU-resident; everything else can live as CPU-side source data (or on disk) and be re-uploaded on demand (PLAYERUNKNOWN Productions virtual-texturing writeup).
- **three.js gives you manual memory management, not streaming.** GPU resources are never garbage-collected — you must call `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, `renderTarget.dispose()`; for GLTF/ImageBitmap textures also `texture.source.data.close?.()`. `renderer.info.memory` (geometries/textures counts) is the built-in leak telemetry — "if geometries and textures keep growing, you have a leak" (three.js docs/forum; utsubo tips).
- **Dispose at natural boundaries** — the canonical guidance is level switches: traverse the outgoing scene and dispose everything not shared (three.js forum "when to dispose").
- Compressed GPU formats (KTX2/Basis) cut VRAM 4–8× vs RGBA8 and shrink upload stalls — the standard mitigation before eviction even matters.

### Why

61 themes × (textures + GLBs + compiled pipelines + render targets) cannot all be resident on an iGPU with shared system memory. VRAM exhaustion is one of the documented *causes of WebGPU device loss* (§2), so residency management is not just perf hygiene — it is crash prevention on the low-end tier. The project's own Odyssey audit already names "the flaw is the residency model" (43 MB GLBs, no eviction).

### Application to this game

- **Build one `AssetResidency` service:** ref-counted registry keyed by asset URL/hash with three states — *disk*, *CPU-decoded*, *GPU-resident* — and an LRU list over GPU-resident entries. Theme `createScene()` acquires refs; theme dispose releases them; eviction actually calls the three.js `dispose()` chain and closes ImageBitmaps.
- **Budgets by tier:** WebGPU doesn't expose real VRAM; budget by proxy — e.g. Tier 1–2 (iGPU): ≤ 256–384 MB estimated texture+geometry bytes; Tier 5–6 (RTX): ≤ 1.5–2 GB. Track estimated bytes at upload time (width×height×bpp×mips; attribute byteLengths) since `renderer.info` only gives counts.
- **Residency policy for themes:** resident = current theme + previous theme (fast undo/switch-back) + next Odyssey chapter (prefetch); everything else evicted on switch. Keep *compiled-pipeline warmth* separate from *asset residency* — pipelines are cheap to keep, textures are not.
- **Odyssey corridor:** replace "render all 8 chapters" residency with a sliding window (current ± 1) + LRU for GLBs — directly implements the masterplan's open L-items.
- **Pressure valve:** on budget breach (or on `device.lost` with VRAM suspicion), first drop mip level on the largest textures (half resolution = ¼ memory, UE-style graceful blur), then evict least-recently-used non-active-theme assets, then demote quality tier.
- **Leak gate in CI:** the §3 smoke suite should assert `renderer.info.memory` returns to baseline after N theme switch cycles — this catches the dispose-forgotten class of bug mechanically.

### Pitfalls

- Shared resources: geometries/materials/textures shared across meshes or themes must be ref-counted, not blindly disposed on scene teardown.
- Disposing a texture still referenced by a live compiled material → black/broken rendering on next use.
- Eviction thrash: too-small budgets cause re-upload hitches every switch; the LRU must include a minimum-resident floor (current theme is never evicted).
- `renderer.info` counts objects, not bytes — byte accounting must be your own.
- Render targets (bloom chains, post buffers) are VRAM too, and scale with DPR² — per-surface pixelRatio caps are part of the memory budget, not just perf.

**Sources**
- Unreal Engine — Virtual Texture Memory Pools (LRU eviction model): https://dev.epicgames.com/documentation/en-us/unreal-engine/virtual-texture-memory-pools-in-unreal-engine
- PLAYERUNKNOWN Productions — Virtual Texturing (residency concept): https://playerunknownproductions.net/news/virtual-texturing
- techarthub — Fixing 'Texture Streaming Pool Over Budget' (budget/mip-drop behavior): https://techarthub.com/fixing-texture-streaming-pool-over-budget-in-unreal/
- three.js forum — When to dispose / full scene cleanup: https://discourse.threejs.org/t/when-to-dispose-how-to-completely-clean-up-a-three-js-scene/1549
- three.js `Material.dispose` docs: https://threejs.org/docs/#api/en/materials/Material.dispose
- Utsubo — 100 Three.js performance tips (dispose + `renderer.info` monitoring): https://www.utsubo.com/blog/threejs-best-practices-100-tips

---

## 7. Adaptive resolution / quality tier systems

### The practice

- **Dynamic resolution scaling (DRS), engine-grade (Unreal's documented heuristic):** measure **GPU frame time vs a budget** (`r.DynamicRes.FrameTimeBudget`, default 33.3 ms) with a target *headroom* buffer; scale screen percentage within bounds (`MinScreenPercentage` 50 → `MaxScreenPercentage` 100); rate-limit changes (`MinResolutionChangePeriod`, `ChangePercentageThreshold`) over a timing history window; and keep a **panic switch** — N consecutive over-budget GPU frames → immediate large drop + history reset. Crucially, **DRS only helps GPU-bound frames**; CPU-bound platforms get a fixed lower screen percentage instead (`CPUBoundScreenPercentage`) (UE Dynamic Resolution docs).
- **Implementation details from shipped-console practice (Martin Fuller, ex-Xbox ATG):** measure GPU time with a start/end-of-frame **timestamp query** (only the critical path when async compute overlaps); target *slightly below* the true budget (e.g. 16.0 ms inside a 16.6 ms window) to preserve presentation-pipeline margin; keep a **per-resolution GPU-cost history table** so the controller jumps near the right scale instead of oscillating toward it (age-weight old samples); scale **one axis first** (horizontal) in ~2-pixel increments with a floor at multiples of 2; respond **asymmetrically** (drop aggressively, raise conservatively); **never scale the UI** — HUD/board UI renders at fixed resolution; consider "dual DRS" — run blurring post (bloom/DoF) at a lower *output* resolution than the scene, often better quality-per-ms than scaling everything (this is exactly the bloom-downsample-0.65 trick already shipped per-theme); and build the debug tooling — a live graph of scale/GPU-time/dropped-frames plus a **stress mode that changes resolution every frame** to flush out shaders with resolution assumptions.
- **Freeze DRS when CPU-bound:** if CPU frame time exceeds budget while GPU doesn't, don't let DRS raise resolution to "fill" the gap in dev builds — it misleads content optimizers (Fuller; matches UE's `CPUBoundScreenPercentage` design).
- **Web equivalent:** scale `renderer.setPixelRatio()` / render-target sizes. The mature web pattern is drei's `PerformanceMonitor`: average FPS over a window, `onDecline`/`onIncline` callbacks with **separate upper/lower bounds (hysteresis)** to prevent oscillation, a `flipflops` counter that, when exhausted, drops to a permanent low baseline (`onFallback`), and a 0–1 factor for continuous scaling (e.g. DPR between 1 and 2) (R3F scaling-performance docs).
- **Movement regression:** temporarily degrade (lower DPR, skip effects) *during interaction*, restore after a debounce (~200 ms) — cheap perceived-quality win (R3F docs).
- **Scale the expensive passes, not just the canvas.** Downsampling post-chain targets (bloom at 0.65×) or specific effects preserves UI/text sharpness while cutting most fill cost — the pattern three.js forum threads converge on, and what this project already ships per-theme.
- Consensus from three.js forum on FPS-driven pixelRatio: workable, but use frame-time (not FPS), average over windows, and rate-limit — naive per-frame adjustment oscillates (discourse thread).

### Why

A fixed 6-tier policy handles *static* device diversity (iGPU→RTX) but cannot absorb *transient* spikes: combo storms, theme transitions, background Electron compositing, thermal throttling. DRS is the shock absorber between tiers; tiers are the suspension. Engines that ship on consoles (fixed hardware!) still run DRS for exactly this reason.

### Application to this game

- **Two-layer control system, explicitly separated:**
  1. **Tier layer (existing 6-tier policy):** structural quality decided at load/persisted — particle counts, aurora layer counts, effect toggles, MRT on/off, per-surface pixelRatio caps. Changes are expensive (rebuild materials/targets) → rare.
  2. **DRS layer:** continuous render-scale within the current tier, driven by **GPU frame time from `trackTimestamp`** (§4) against the tier's budget with ~10–15% headroom; bounds e.g. 0.6–1.0× of the tier's pixelRatio cap; min change period ~0.5–1 s; panic drop after ~3 consecutive over-budget frames (combo storms are the predictable trigger — the storm director's eased scalar S could even *hint* the DRS, mirroring UE's replaceable-heuristic design).
- **Tier demotion as escalation:** if DRS sits pinned at its floor for a sustained window (drei's `flipflops`→`onFallback` pattern), demote one tier and persist; offer a toast so the player understands. Never auto-promote mid-session — re-test promotion on next launch.
- **CPU-bound guard:** compare CPU frame time vs GPU pass time before reacting — dropping resolution when the sim/GC is the bottleneck just blurs the game for nothing (UE's explicit lesson).
- **Respect existing caps:** DRS multiplies *under* the per-surface pixelRatio caps; background scene targets can scale more aggressively than the board surface (gameplay readability first).
- **Perf-test interlock:** every DRS/tier system must have a kill switch (`?noDrs`, forced `effectScale=1`) — already partially in place — and the §4 harness always runs with it.

### Pitfalls

- Oscillation without hysteresis/min-change-period (single-threshold designs flip-flop at the boundary).
- Using FPS instead of frame time: vsync quantizes FPS (60→30 cliffs) and hides headroom.
- `setPixelRatio` changes reallocate the canvas and every dependent render target — this itself causes a hitch; rate-limit and prefer scaling offscreen targets where possible.
- Rendering-scale changes alter bloom/DoF kernel footprints — clamp DRS floor per theme so signature effects don't visibly fall apart (the ice-temple "adaptively layer-gated aurora" lesson: adaptive systems can silently change intended looks).
- DRS masks perf regressions in testing (§4) and interferes with screenshot A/B validation — pin it during captures.
- Backgrounded windows: DRS is not the tool — the `shouldRenderFrame` gate (already shipped across themes) is; keep them independent.

**Sources**
- Unreal Engine — Dynamic Resolution (heuristic, budget, panic switch, cvars): https://dev.epicgames.com/documentation/en-us/unreal-engine/dynamic-resolution-in-unreal-engine
- Martin Fuller — Dynamic Resolution Scaling implementation best practice: https://martinfullerblog.wordpress.com/2023/10/11/dynamic-resolution-scaling-drs-implementation-best-practice/
- web.dev — Adaptive loading (deviceMemory/hardwareConcurrency tier bucketing for the initial tier guess): https://web.dev/articles/adaptive-loading-cds-2019
- detect-gpu (benchmark-derived GPU tiering from the renderer string): https://github.com/pmndrs/detect-gpu
- React Three Fiber — Scaling performance (PerformanceMonitor, adaptive DPR, regression): https://r3f.docs.pmnd.rs/advanced/scaling-performance
- three.js forum — Changing pixelRatio based on FPS: https://discourse.threejs.org/t/changing-pixelratio-based-on-fps-good-or-bad-idea/34563
- three.js `WebGLRenderer.setPixelRatio` docs: https://threejs.org/docs/#api/en/renderers/WebGLRenderer.setPixelRatio
- Discover three.js — responsive design / device pixel ratio: https://discoverthreejs.com/book/first-steps/responsive-design/

---

## Cross-cutting synthesis for the architecture plan

1. **One GPU host module** owns: renderer creation (`three/webgpu`), backend selection (WebGPU→WebGL2 `forceWebGL` fallback), device-loss recovery ladder, timestamp-query plumbing, DRS controller, and the asset-residency LRU. Themes are pure `createScene()` factories over CPU-side state — already largely true; make it a contract.
2. **Three test lanes:** PR = SwiftShader/lavapipe correctness + golden screenshots + leak assertions (no timing); nightly = self-hosted RTX perf harness with pinned tier/resolution and p95 gates; manual = TDR-sensitive desktop captures, per-chapter/theme short sessions only.
3. **Budgets are one table:** per-tier ms budgets feed both the CI gates and the runtime DRS — a single source of truth prevents the gate and the shock absorber from disagreeing.
4. **Residency is crash-prevention:** VRAM exhaustion → device loss on iGPUs; the LRU + mip-drop pressure valve is part of the reliability story, not just perf.
