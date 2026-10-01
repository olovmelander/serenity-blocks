# Three.js r185 to r186 upgrade

**Status: Phase 1 implemented; working checkout pinned to `three@0.186.1`. Broader Phase 2 acceptance remains open.**
Started 2026-10-01 from `9c035b9e`. Exact **`three@0.186.1`** is installed and
recorded in the manifest and lockfile, with the compatibility changes below.
Preparation was verified on r185 before adoption, following
[ADR-0018](adr/0018-three-js-pinning-and-upgrade-protocol.md).

This is the executable successor to the r186 watch list in
[the closed r185 upgrade, §13](THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md#13-rollback--r186-watch).
It also carries the native compute migration required by
[ADR-0020](adr/0020-loading-surfaces-create-pipelines-async.md). Electron upgrades,
new visual effects, and performance budget changes are separate work.

## Target and evidence

The registry returned `0.186.1` as the latest r186 patch on 2026-10-01. Inspect the
package, not the moving upstream development branch:

```powershell
New-Item -ItemType Directory -Force .cache/three-r186 | Out-Null
npm pack three@0.186.1 --pack-destination .cache/three-r186 --json
tar -xf .cache/three-r186/three-0.186.1.tgz -C .cache/three-r186
```

- Tarball: `https://registry.npmjs.org/three/-/three-0.186.1.tgz`
- SHA-1: `6d50f70c2c437f844179bbb56d6f5b774e1ca38a`
- Integrity: `sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==`
- [Official r186 release notes](https://github.com/mrdoob/three.js/releases/tag/r186)
  and [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#185--186)
  are discovery aids; the source findings below are from the **0.186.1 tarball**.

The local candidate worktree is `.cache/three-r186/worktree`, detached from the
starting commit, with its own exact `0.186.1` manifest/lockfile and a copy of the
candidate package at `node_modules/three`. The preparation changes are copied into
it for comparison. Other installed dependencies are junctions to the working
checkout; do not run a general dependency install/update in this disposable tree.

Keep the candidate Three.js package physically under its `node_modules` directory:
a junction to the unpacked tarball outside `node_modules` made TypeScript infer
library JS types and bypassed Vite's `manualChunks` path check. Both artifacts went
away with a package copy. They were probe setup errors, not r186 regressions.

## Source audit and migration actions

Paths and line numbers in this table refer to the target package unless stated otherwise.

| Area | Verified r186.1 behavior | Repository action |
|---|---|---|
| Native compute | `src/renderers/common/Renderer.js:1115` adds `compileComputeAsync`. It runs `onInit`, registers disposal, builds nodes asynchronously and collects pipeline promises without dispatching. `WebGPUPipelineUtils.js:380` creates the GPU pipeline asynchronously. Its error path marks `pipelineGPU.error` and **resolves**, so promise settlement is not success. | Adopted native compilation, removed the r185 create hook, and retained actual GPU readiness checks. Guard both the node-build interval before caching and pending/failed backend dispatch; guards survive timeout until native work settles. |
| Pending/failed compute dispatch | `WebGPUBackend.js:1889` still reads the GPU slot and calls `setPipeline` without a pending/error guard. | Keep the guard, including a non-null pipeline marked invalid. Await compile before one-shot dispatches. Check boot timeout behavior because native node building can yield before a pipeline is cached. |
| Renderer teardown | `Renderer.js:2696` and `WebGPUBackend.js:3252` are **async**. `Backend.js:825` awaits timestamp pool disposal before backend/device destruction. | BaseTheme returns observed disposal completion while detaching immediately. Stillwater's owned and pooled device backstops wait for settlement. Boot warp exposes/awaits cleanup before releasing the shared intro device; intro fallback awaits disposal. Intro, Odyssey and ThemeManager direct cleanup observe rejection. |
| Loading-surface render pipelines | The async promise sink, pipeline cache-before-create, readiness gate and draw-error guard remain. Several pinned line numbers moved. `_getFrameBufferTarget` now delegates the output-conversion predicate to `needsFrameBufferTarget` (`Renderer.js:2609`). | Reverify and restamp `async-render-pipelines-contract`; preserve PMREM and final-composite exemptions. Do not remove the loading-surface wrapper just because compute has a native compiler. |
| Odyssey compile | `compileAsync(scene, camera, targetScene = null, onProgress = null)` adds an optional fourth argument. Deferred per-object compilation remains. | Adapt the parameter-order source contract without weakening the first three arguments. Retain/reverify side, call-depth and target/MRT protections. Real-game warm-up remains a validation gate. |
| MRT blending | `MRTNode.merge()` now writes `blendModes` correctly and merges clear colors. A fresh emissive attachment **still defaults to `NoBlending`**. | Removed the prototype merge patch. Kept `withEmissiveMaterialBlending` and explicit `MaterialBlending`. Real GPU readback confirms accumulation after a material MRT merge; the wider selective-bloom screenshot matrix remains pending. |
| Object disposal | `Object3D.dispose()` dispatches an event; it does not dispose shared geometry/material/texture resources. | GoldenForestWater and MistyLakeWater already chain to the optional base method. SunsetOceanWater has no overriding disposal method. Keep explicit resource ownership/disposal. |
| Shadow removal | WebGPU no longer supports PCFSoftShadowMap. | The two active sites were already changed to PCFShadowMap during r185 preparation. Remaining search hits are comments. Capture neon-district and golden-forest shadows again during acceptance. |
| TSL test doubles | `NodeBuilder` reads `renderer.debug.diagnostics.keywords`; `three/tsl` now imports the WebGPU bundle's TSL namespace, and addons use additional bundle exports. | Preparation updates three WGSL emission harnesses and the Koi Pond lifecycle mock. Generated WGSL assertions remain in place. The compute harness now exercises the actual installed renderer/backend on either version. |
| Other guide changes | Search found no active uses of renamed `Source`/LightProbeGrid, SimplifyModifier, toTrianglesDrawMode, removed Sky up uniforms, obsolete GTAO distance settings or DotScreen/RGBShift parameter mutations. TSL 3D `rotate` was not found in production shader code. | No speculative migration edits. Re-run searches if intervening work adds sites. |
| Carried fixes | `screenDPR` is a shared render-updated uniform; WebGPU timestamp maps are cleared on resolution/disposal; ImageBitmapLoader copies its options. Transient attachment usage is feature-detected. | Validate DPR, timestamp availability and texture churn in the actual runtime. Do not infer a performance gain or upgrade Electron from these source changes. |

## Phase 0 preparation (historical checkpoint)

Changes stay compatible with the installed r185:

- `BaseTheme.disposeRenderer` catches both synchronous throws and asynchronous
  disposal rejection, including a late failure after a replacement renderer is assigned.
- Native compute readiness uses actual pipeline state, rejects missing/invalid
  pipeline outcomes, and leaves r185's async creation window intact.
- The compute harness checks real Renderer/Pipelines/WebGPUBackend classes with a
  fake device, including initialization, disposal listeners, pending dispatch,
  rejection, timeouts and cache reuse. The r185-only error-log suppression test is
  skipped on r186 because native upstream logging has different behavior.
- Shader emission and Koi Pond lifecycle doubles accommodate r186 without removing
  the existing shader/lifecycle assertions.

At this checkpoint, private-API contract tests deliberately still required r185.
Phase 1 reverified/restamped them to exact r186.1; they do not accept permissive ranges.

## Phase 0 validation record

See [the machine-readable checkpoint](../reports/three-r186/preflight-summary.json)
for suite counts, remaining candidate failures and source provenance. Raw local
Vitest reports and build logs are under `.cache/three-r186/`.

- r185 full suite after preparation: **4,101 tests passed, 383 files**. The first
  unrestricted baseline run had a lifecycle CLI timing failure; that test passed
  alone, and the bounded-worker full run passed. Use `--maxWorkers=2` for these checks.
- Candidate full suite after preparation: **4,087 passed, 13 failed, 1 skipped**,
  383 files. The 13 failures are the r185-specific render/compute, Stillwater and
  Odyssey source contracts listed above. The final Koi Pond fixture also passed
  all nine lifecycle tests independently on both versions.
- Typecheck passes on both r185 and the candidate with the package in `node_modules`.
- The working checkout's lint ratchet passes at its existing 1,404-error baseline;
  the changed compute helper also passes its direct ESLint check.
- Candidate production build and `check-boot-closure` pass; the dedicated `three`
  chunk remains, with a 12 KB entry static closure. Build warnings about large chunks
  and existing mixed static/dynamic imports remain.
- One small effect only: `pulse-sphere`, fixed `t=8`, `orbit=0`, 1034×681 canvas.
  `window.__PLAYGROUND_READY__` was true for each capture. Screenshots were opened
  and inspected. All three captures had zero console warnings/errors:
  [r185 WebGPU](../reports/three-r186/pulse-sphere-r185-webgpu.png),
  [r186 WebGPU](../reports/three-r186/pulse-sphere-r186-webgpu.png),
  [r186 WebGL2](../reports/three-r186/pulse-sphere-r186-webgl.png).
- Browser WebGPU reported NVIDIA Ampere. Chrome DevTools MCP was unavailable;
  Playwright MCP captured the same readiness signal, canvas and console. These are
  browser smoke results, not the Electron theme matrix or visual parity acceptance.
- On that real r186 WebGPU renderer, a four-element compute kernel compiled through
  the prepared helper, dispatched and read back **`[3, 4, 5, 6]`**, with `created: 1`,
  `failed: 0` and no warnings/errors. This is correctness evidence, not a benchmark.

## Phase 1 dependency bump (implemented)

The working-tree upgrade contains these changes together for review and rollback:

1. Exact `three: 0.186.1` in `package.json` and regenerated lockfile. Keep the existing
   Vite `three` manual chunk. Leave Electron and unrelated dependencies alone.
2. Native-only compute helper: removed r185's descriptor-building/create hook,
   compile-window state and `syncComputePipelines` rollback. Update its flag catalog,
   intro/warp documentation and tests. The flag also controls raw-WebGPU void-ember;
   account for those call sites/tests rather than orphaning the flag.
3. Promise-aware Stillwater terminal teardown and an audit of direct
   `renderer.dispose()` callers, including intro/boot/renderer recovery paths.
4. Remove the MRT merge workaround, retain explicit emissive blending, and correct
   the helper's obsolete deletion guidance. Capture the affected bloom behavior.
5. Reverify/restamp the render/compute/Stillwater/Odyssey private contracts against
   source **and** the shipped bundle. Keep failure assertions meaningful.
6. Restamp both `.agents/skills/webgpu-threejs-tsl` and
   `.claude/skills/webgpu-threejs-tsl` only after the r186 API audit; update stale
   compute/disposal/MRT guidance rather than globally replacing historical `r185` text.

Validation on the adopted dependency (also recorded in
[the adoption summary](../reports/three-r186/adoption-summary.json)):

- `npm ls three --depth=0`: exact `three@0.186.1`; lockfile changes only Three.js.
- Full suite: **4,106 tests passed in 383 files**, zero failures/skips
  (`npm test -- --maxWorkers=2`). The candidate's 13 contract failures are resolved.
- `npm run typecheck`, `npm run build` and boot-closure check pass. The dedicated
  Three.js chunk remains; the entry's static closure is 12 KB.
- `npm run lint:ci` passes at the unchanged **1,404-error** baseline.
- Added regression coverage for compute dispatch during native node building,
  guards surviving timeout, and device destruction waiting for asynchronous disposal
  (including rejection). Boot cleanup retains its completion promise across repeat calls.
- Playwright MCP: inspected fixed-time `pulse-sphere` on actual root r186.1,
  [WebGPU](../reports/three-r186/pulse-sphere-adopted-webgpu.png) and
  [WebGL2](../reports/three-r186/pulse-sphere-adopted-webgl.png). Both ready with zero
  console warnings/errors. Chrome DevTools MCP remains unavailable.
- Real NVIDIA Ampere WebGPU: native helper compiles one kernel and readback is
  **`[3, 4, 5, 6]`**. Two additive quads with per-material MRT overrides produce
  emissive RGB **`[0.5, 0.25, 0]`**, confirming the upstream merge preserves explicit
  emissive blending. An initial probe imported a duplicate Three.js bundle and
  warned; rerunning with the page's existing Vite modules is clean.
- Isolated production Electron Stillwater capture/lifecycle: **PASS**, zero lifecycle
  failures, console errors or process failures. Screenshot inspected:
  [Stillwater](../reports/three-r186/stillwater/stillwater.png),
  [report](../reports/three-r186/stillwater/capture-report.json).
- Browser boot repeat: native compute ready, full warp handoff completed, then
  single-player ran with Stillwater's reused WebGPU renderer, critical/full readiness
  and selective MRT bloom. [State/trace](../reports/three-r186/browser-boot-state.json),
  [game screenshot](../reports/three-r186/browser-single-player.png). Zero console
  errors; warnings are Windows' ignored power preference and deprecated `THREE.Clock`.
- **Cold-start timing remains open:** the first browser boot hit the existing 9 s
  compute budget and used the fallback/watchdog; the repeat compiled successfully
  (7.54 s wrapper time) and completed its handoff. No budgets were raised. The hidden
  Electron [boot probe](../reports/three-r186/boot-stillwater.json) compiled successfully
  and started single-player, but its timed mode-entry action preceded handoff completion
  and aborted the warp. Its long frame gaps are not accepted as performance evidence.

Raw test/build/lint logs are in `.cache/three-r186/bump-*`; retained runtime
evidence is in `reports/three-r186/`. These checks establish the dependency adoption,
not the full release acceptance matrix below. No performance improvement is claimed.

### Integration with main (2026-10-01)

Rebased the upgrade onto `5c28af7a`, retaining the newer Parhelion, Chromadelic Highway
and Synthwave Sunset changes. The newly merged Parhelion shader-size test needed the
same `renderer.debug.diagnostics.keywords` mock field as the other WGSL harnesses;
its shader budgets and assertions are unchanged.

- Full combined suite: **4,308 tests passed in 394 files**.
- Build, boot closure, typecheck and lint ratchet pass; main's existing lint baseline
  is **1,336 errors** and was not changed by this upgrade.
- TS/architecture fitness ratchets, theme lifecycle audit, import boundaries,
  committed performance-budget checks, release scaffolding, IP-string gate and Pages
  artifact checks pass. Production dependency audit reports zero vulnerabilities.
- Logs: `.cache/three-r186/main-integration-*`. The Phase 2 runtime/performance
  acceptance items below remain open.

## Phase 2 acceptance and rollback

Full release acceptance remains open until ADR-0018's real-runtime gates pass:

- Real game entry, mode start, theme switching and teardown, including the supported
  forced-WebGL2 lane. Check intro/warp/loading surfaces with the boot-smoothness probe.
- Electron `capture:themes` matrix, one fresh process per theme, with targeted MRT
  bloom, water, shadows, PBR/PMREM, DPR, timestamp and texture-switch checks. Schedule
  small sessions under the repository's TDR constraint; do not run a full Odyssey
  journey capture in this session.
- Stillwater reuse/terminal disposal and Odyssey deferred warm-up on real devices.
- Content-matched r185/r186 performance measurements on the same machine, using the
  verified instruments in [ADR-0016](adr/0016-perf-claims-require-a-verified-instrument.md).
  Include `perf:budgets:gate`; change budgets only alongside measured evidence.

The dependency and Phase 1 compatibility edits are kept together in one revertible commit.
Phase 0 remains useful on r185. Keep this document
active until the runtime matrix and performance evidence are recorded; a green
build or the single playground smoke does not close the upgrade.
