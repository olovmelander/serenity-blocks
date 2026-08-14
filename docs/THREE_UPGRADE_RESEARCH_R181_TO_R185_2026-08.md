# three.js upgrade research: r181 → r185 (2026-08-13)

**Question:** Are we on r181, and should we move to r185?

**Answer:** Yes, we are on r181 (`three@0.181.2`, pinned via `^0.181.2` — caret on a `0.x`
version locks us to `0.181.*`). **Do not upgrade to r185 now.** r185 ships a confirmed
InstancedMesh-under-WebGPU rendering regression with the fix milestoned to the unreleased
r186 — and this codebase is instancing-heavy everywhere. The right move is to **plan the
upgrade as a scheduled project targeting r186 when it ships**, because the upgrade itself
is genuinely valuable (compile-speed and leak fixes that map directly onto our worst
measured pain). It is a project, not a version bump: ~25 deliberate r181 workaround sites,
a codebase-wide API rename, two semantics changes that invert existing workarounds, and a
visual re-verification campaign across ~30 themes + 8 Odyssey chapters.

Research method: 12-agent workflow — codebase inventory, r181-workaround sweep, per-release
changelog research (r182–r185 + migration guide), GitHub/forum regression hunt, impact
verification of 90 changes against actual repo usage, completeness critic. Key claims
(Dependabot branch, `atan2` blast radius, issue #33890) re-verified by hand.

---

## 1. Current state

- `package.json:136` — `"three": "^0.181.2"`; installed `0.181.2` (r181, released 2025-11-19).
- Pin history: three was introduced **directly at r181** on 2025-12-05 (commit `129b9d64`,
  Stellar Drift theme). No earlier version was ever used; no upgrade was ever attempted
  and reverted.
- One upgrade attempt exists: **Dependabot branch** `origin/dependabot/npm_and_yarn/three-0.185.1`
  (commit `8129a44b`, 2026-07-09). It bumps only `package.json` + lockfile, was **never
  merged and never built** — its merge base with main (`7e52668a`, 2026-06-02) predates the
  One World rewrite and the winter remake by ~10 weeks. It proves the bump was offered,
  not that it works.
- Version coupling is deliberate and deep: **99 explicit "r181" mentions across 51 src
  files**, plus the `webgpu-threejs-tsl` skill (4 on-disk copies) whose entire content is
  stamped "verified against pinned three r181".

## 2. Release timeline and the regression pattern

| Release | Date | Landing quality for us |
|---|---|---|
| r181 | 2025-11-19 | Current pin |
| r182 | 2025-12-10 | **Never land here.** Known WebGPU perf regression (#32675) + excessive per-frame bindGroups (#33005), both fixed in r183 |
| r183 | 2026-02-20 | **Never land here.** Compute StorageTexture+textureLoad WGSL codegen break (#33022), fixed in r184 |
| r184 | 2026-04-16 | Best *published* stopping point, but: Reflector `.camera` removed with no replacement until r185, ImageBitmapLoader concurrent-cache bug (#34150, fixed only in r186) |
| r185 | 2026-07-01 | **Current latest (npm 0.185.1). Blocked for us** — see §3 |
| r186 | unreleased | Fixes all three r185 regressions. **Recommended target.** |

Pattern worth internalizing: **every release r182→r185 shipped at least one WebGPU/TSL
regression that was only fixed in the following release.** The WebGPU backend is still
churning fast (architectural renames in r183, alpha-compositing overhaul in r185). For a
shipped visual product, that argues for upgrading deliberately, on our schedule, one eye
on the next release's fix list — not tracking latest.

## 3. Why not r185 today: live regressions fixed only in unreleased r186

1. **InstancedMesh renders incorrectly under WebGPURenderer in r185.0**
   ([#33890](https://github.com/mrdoob/three.js/issues/33890)).
   > **Correction (2026-08-13, same day):** deeper research showed the fix (PR #33889,
   > "restore instanced matrix buffer capacity") **already shipped in the 0.185.1 patch** —
   > verified by diffing the npm tarballs of 0.185.0 vs 0.185.1 (`src/nodes/accessors/Instance.js`
   > sizes the matrix buffer from `instanceMatrix.count` again). So current npm latest is
   > NOT broken on this. The issue's r186 milestone label misled the first research pass.
2. **TSL `samplerComparison()` emits a WGSL type-mismatch GPUValidationError**
   ([#34081](https://github.com/mrdoob/three.js/issues/34081), fixed in r186 via #34099 +
   #34121) — signals WGSL codegen churn in the shadow/depth area even where we don't call
   it directly.
3. **screenDPR/viewport wrong when multiple node graphs are built**
   ([#34184](https://github.com/mrdoob/three.js/issues/34184), fixed in r186 via #34186) —
   we run multiple post-processing graphs (board + playground + Odyssey) with
   `screenUV`-dependent TSL, so this one is real for us.
4. **ImageBitmapLoader concurrent same-URL loads resolve `undefined`**
   ([#34150](https://github.com/mrdoob/three.js/issues/34150), regression since r184,
   fixed in r186 via #34151 merged 2026-07-31).

With r186 due days away (see §7), there is no reason to land on 0.185.1 despite the
correction — but if r186 slips badly, 0.185.1 is a less-broken fallback than the original
assessment implied.

## 4. What we would gain (mapped to known project pain)

- **Cold start / compile (our #1 measured pain, ~30 s):** r184 shipped a ~3× TSL compile
  speedup (#33120), a truly non-blocking `compileAsync` (#32984), quad caching, and r185
  added NodeBuilder perf and surfaced WGSL diagnostics (#33418 — better debugging on the
  TDR-prone iGPU). r183 fixed `compileAsync` for target scenes and added
  `initRenderTarget()` — aimed at exactly the class of bug our warm-up workarounds guard.
- **Theme-switch leaks (SB-15 debt):** r185 disposal-fix bundle (render-target texture
  disposal #33511, stale binding refs #33680, PMREM internal disposal, sampler cache
  scoping); r182 already improved renderer resource disposal and fixed BloomNode leaks.
- **Deletable workarounds:** koi-pond's local DepthTexture isolation (its own comment says
  the fix "landed upstream after this repo's pinned release"); possibly the black-hole MRT
  `compileAsync` ban; stillwater's parked volumetric moonshafts exist solely because of an
  r181 bug and are explicitly waiting for this retest.
- **New toys:** godrays and retroPass display nodes (the skill's "not in r181" list),
  FSR1/TAAU upscaling nodes (iGPU relief), render bundles with full InstancedMesh support,
  reversed depth buffer, ClusteredLighting.

## 5. Migration cost inventory

### 5.1 Hard breaks (module-load failures / removed APIs)

- **TSL `atan2` removed in r183** (`atan(y, x)` is the replacement). Verified: imported from
  `three/tsl` in **6 files** — `src/themes/winter/rendering/aurora-volume.js` (**live
  winter theme, currently mid-edit on this branch**), `src/themes/tornado/TornadoGround.ts`,
  and playground effects `summer-meadow`, `winter-aurora`, `vesper-sky`, `halcyon-apex`.
  On r185 these fail at module evaluation — winter and tornado would not load at all.
  (`Math.atan2` call sites and raw WGSL `atan2` are unaffected.)
- **TSL `.equals()` → `.equal()`** — one hit: `ice-temple-compute.js:312`
  (`pos.w.equals(spawnTime)` in a compute shader).
- Otherwise the removed-identifier sweep is **clean**: zero hits for `nodeObject`,
  `storageObject`, `rangeFog`/`densityFog`, `DFGApprox`, `scriptable*`, TextureNode
  `.uv()`, `colorBufferType`, `modInt`, `WebGLCubeRenderTarget`, `Clock`.

### 5.2 High-impact behavior changes

- **MRT secondary attachments forced to opaque blend (r182, #32265).** The emissive
  attachment feeds bloom in **~25 MRT pipelines**, and those scenes are full of
  `AdditiveBlending` glow materials whose emissive writes previously blended additively.
  Overlapping glows now stomp the emissive buffer → bloom changes on essentially every MRT
  theme. Likely the single largest *visual* rework item.
- **`positionLocal` semantics change (r185).** In `material.positionNode`, `positionLocal`
  no longer includes instance/batch/skinning transforms. This *inverts* our ~13-site r181
  InstanceNode workaround class: sites that switched to `positionGeometry` stay correct
  (now redundantly), but sites that *rely* on the old ordering break —
  `wolfhour-materials.js:109-119` does **arithmetic on the r181 ordering**
  (`positionLocal.sub(positionGeometry)` to derive the instance translation), and
  `ocean-materials.js:747-750` explicitly depends on BatchedMesh transforms being applied
  first (its comment logic inverts under r185). Audit every `positionNode` on
  instanced/batched/skinned meshes (~80 files use `positionLocal`).
- **Warm-up architecture vs. reworked `compileAsync` (r183/r184/r185).** The whole Odyssey
  prewarm system (`warmup/post-target-compile.js`, `warm-hidden-drawables.js`, black-hole's
  MRT-compile ban, base-theme's compile paths) is built on undocumented r181 internals —
  the synchronous-prologue bound-target capture, "compileAsync binds no target", exact
  source line numbers. r184's `buildAsync` yields between build stages, so the capture
  assumption may silently break (loading-freeze returns) — or the upstream fixes make the
  whole trick unnecessary. Must be settled by reading r185 source, then retesting cold
  start + live-loop prewarm + MRT warm on both GPU lanes.
- **Premultiplied alpha "Compositor Contract" (r185, #33369/#33457).** Transparent-canvas-
  over-DOM blending changed. Verified exposure: golden-forest (`alpha:true` + null
  background over DOM) and the WebGPU intro renderer (`alpha:true`, no clear color).
  Mitigation is an opaque `scene.background`/`setClearColor(..., 1)` where transparency
  isn't intended; screenshot-verify where it is.
- **Shadow overhaul, cumulative r182→r185.** Vogel-disk PCF + IGN dithering (r182),
  substantial WebGPU shadow rework with explicit "reduce your bias values" guidance (r183),
  `PCFSoftShadowMap` deprecated (WebGPU removal lands r186). Our shadow users:
  neon-district (`bias -0.0005`), golden-forest (`-0.00035`), stillwater shafts
  (`-0.0006`), all tuned against r181 acne. One retune+recapture pass against r185, plus
  swap `PCFSoftShadowMap` → `PCFShadowMap` (2 sites).
- **Stillwater's underscore-internals surgery (silent-breakage risk).** r183 renamed
  internals (`Nodes`→`NodeManager`, internal `RenderPipeline`→`RenderObjectPipeline`);
  r184's quad cache restructures `renderer._quad`/`_quadMesh`. `stillwater-theme.js:104-150`
  and `stillwater-pipeline.js:455-472` operate on `_nodes`, `_renderLists`,
  `_renderContexts`, `_bundles`, `_quadMesh`, `_context` — all optional-chained, so on r185
  they **no-op silently and the theme-switch leaks return with no error**. Same trap in
  `bloom-dispose.js`: if r185 renamed BloomNode's private material fields without fixing
  the leak, the helper silently dies (its header anticipates this). Re-map every field
  against r185 source; some surgery becomes deletable.
- **PostProcessing → RenderPipeline (r183).** ~34 construction sites. The deprecated
  `PostProcessing` alias **still works in 0.185.x** (warn-once), but removal is announced,
  and the warning would pollute the playground's console-error gate. Plan the mechanical
  rename, replace the handful of deprecated `renderAsync()` calls with `render()`, and
  extend chiral-gold's capability probe.

### 5.3 Medium items (verified against repo usage; each needs a small edit or a recapture)

- Reflector: `.camera` removed r184, `getReflectionCamera()` added r185 — check any
  reflection-camera layer config (15 TSL `reflector()` files; golden water memory).
- `viewportTexture`/`viewportSharedTexture` refresh timing changed FRAME→RENDER (r183) —
  stillwater/neon-dusk/koi-pond water refraction may see different content mid-frame.
- Canvas format may follow `outputType` to 16-bit float (r182) — banding-sensitive looks
  (auroras) improve, iGPU bandwidth may regress; pin the format if it hurts.
- Post chains now re-sync with runtime `toneMapping`/`outputColorSpace` writes (r184) —
  previously-frozen chains re-grade; playground overshoot-grading calibration may shift.
- Lambert/Phong now receive IBL from `scene.environment` (r183) — neon-district buildings
  pick up lighting they never had; the per-material envMap workaround becomes obsolete.
- PBR energy-conservation + PMREM accuracy changes (r182), DFG LUT 16×16 — every env-lit
  Standard/Physical material shifts subtly; screenshot-compare PBR themes.
- Normal-less geometry now forces flat shading (r183) — audit hand-built BufferGeometries
  used with lit node materials; fix is one `computeVertexNormals()` per hit.
- Water addon reworked (r183) — crystal-cave, bioluminescence, rainy-window look changes
  (golden-forest and sunset are vendored forks, insulated). Vendor r181 Water.js if needed.
- ocean coral reads the **internal** `vBatchColor` varying (r182 "leaner BatchNode
  codegen" may rename/remove it) — switch to the public batch color node if gone.
- Black-hole compute's hand-merged `updateRanges` were masked by r181's full-buffer
  uploads; r182 honors ranges — off-by-ones become visible as stale particles.
- ImageBitmapLoader concurrency bug (r184/r185, fixed r186) — concurrent same-URL texture
  loads can resolve `undefined`.
- Compute-writes → same-frame `texture()` sampling may be one frame stale on r185
  (#33795, open) — exactly the paw-trail/snow-deformation pattern.
- Adapter acquisition reworked (r183, compat-mode→core upgrade) — benign on paper, but
  smoke-test init on the TDR-prone iGPU and confirm the RTX harness still lands on the
  discrete adapter; boot-warp's pass-a-device shortcut bypasses it (verify).
- GPU timestamp/query plumbing changed — all perf lanes (odyssey-gpu-split, budget gates,
  theme HUDs) coded against r181 internals (query pool size, single scope per render
  type, sticky `render.timestamp`) must be re-validated before their numbers are trusted.
- WebGL fallback lane: `PCFSoftShadowMap` swap, working-color-space render targets (r184),
  UnrealBloomPass alpha handling (r182) — one screenshot pass over the WebGL theme roster.

### 5.4 Non-code costs

- **Visual re-verification campaign** — the dominant cost. Shadows, IBL, PBR, water,
  MRT-bloom, alpha compositing all change look across ~30 themes + 8 chapters. Per
  CLAUDE.md every affected surface needs screenshot verification; the iGPU allows one
  small effect per session (TDR), so bulk captures belong on the RTX 5080
  (`capture:themes`, per-chapter Odyssey captures). Needs an explicit matrix
  (surface × backend × machine) before go/no-go.
- **Perf re-baseline.** `perf-budgets.json` and `reports/odyssey-perf/` baselines are all
  r181 measurements (some prose is r181-coupled). Re-validate timestamp plumbing first,
  then recapture baselines and update budgets **in the same PR as the bump** so the gate
  never compares across versions.
- **Docs/skill re-stamp.** The `webgpu-threejs-tsl` skill (×4 copies) teaches r181 rules
  that become actively wrong (e.g. "RenderPipeline doesn't exist"); ~23 r181 mentions per
  copy, plus `src/playground/README.md:30`'s "(r181+)" stamp. Drive the sweep from a fresh
  `r181|0\.181` grep at upgrade time; `docs/WEBGPU_THREEJS_WORKFLOW.md` needs nothing.
- **Electron lane.** Electron 38.8.6 embeds Chromium 140 (Sep 2025) while r185 is developed
  against mid-2026 Chrome — playground-verified effects can still differ in the packaged
  game (Dawn/Tint WGSL differences; we already have a Tint const-fold memory). Run the
  Electron validation lanes (`validate:odyssey:webgpu`, captures) as mandatory evidence,
  and decide explicitly whether an Electron bump rides along (it carries its own
  steamworks/koffi native-module risk). Note: staying on r181 forever is also a
  forward-compat risk as Electron's Chromium advances (#32563 precedent).

## 6. Recommended plan

1. **Now:** stay on r181. Don't merge the Dependabot PR (stale, never built, and r185 is
   disqualified by #33890). Optionally comment/close it citing this doc.
2. **Cheap prep that pays off regardless (can land on main now):** replace TSL `atan2`
   with two-arg `atan` in the 6 files (the repo already uses this idiom in
   `lunara-materials.js:483`) and `.equals()`→`.equal()` in ice-temple — both are
   r181-compatible today and remove the only hard module-load breaks. Coordinate the
   aurora-volume.js edit with the in-flight winter branch.
3. **When r186 ships** (milestone due **2026-08-19** — days away; see §7): confirm
   #34081/#34184/#34150 are in the release notes, then run a **1–2 day evidence spike**
   in a separate git worktree
   (own `node_modules`, own `VITE_CACHE_DIR` — vite.config.js:76 supports it; avoids the
   two-server `.vite` wedge): `npm i three@<r186>`, then build + vitest + typecheck +
   lint; enumerate failures. Read r186 source to settle: PostProcessing alias survival,
   BloomNode private fields, `compileAsync`/`buildAsync` target capture, stillwater's
   underscore fields, InstanceNode ordering.
4. **Then** scope the real migration as a phased project: mechanical renames → warm-up
   architecture re-verification → MRT/emissive bloom rework → positionLocal audit →
   shadow/alpha/IBL retune waves with the capture matrix → perf re-baseline → skill
   re-stamp. Ship behind the usual playground-first loop.

## 7. Addendum (2026-08-13): what r186 actually contains, and what it does for this game

Researched via the r186 milestone (334 closed / 57 open, **due 2026-08-19**, r187 already
scheduled for 2026-09-23), the 185→186 migration-guide section, the merged-PR list, and a
repo exposure audit. The dev branch is unusually quiet — zero open regression-labeled
issues repo-wide — so the due date looks credible (expect Aug 19–31).

### 7.1 De-risking (why r186 is the landing spot)

Fixes the remaining r185 blockers (§3 items 2–4), plus r185-era instability we'd
otherwise inherit: stale RenderObject caches causing per-frame "Vertex buffer slot N was
not set" floods (#34053) and meshes drawing at stale locations (#34063); `renderOrder`
inverted under `reversedDepthBuffer` (#33944); BatchedMesh Uint16 draw-offset bug
(#34211); remaining instancing cleanups (#34022, #34107, #34115).

### 7.2 Direct hits on our two worst standing problems

- **Theme-switch leaks (SB-15 class):** a large leak batch — cached bind-group destruction
  (#33954/#34014, fixes the NodeSampledTexture leak), `scene.background` mesh disposal
  (#34108), uniformBuffers clone leak (#34139), DepthOfFieldNode RT leak (#34188),
  `renderer.compile()` WeakMap mesh leak (#33998), shadow-related retention after GLB
  disposal (#33912/#33937). Combined with r185's disposal fixes, a real chunk of the
  stillwater/bloom-dispose surgery should become deletable (verify, don't assume).
- **Cold start / warm-up:** `compileAsync` no longer renders shadow maps during precompile
  (#33924) and preserves frameId (#33905); **new `compileComputeAsync()`** (#32551) —
  we have 111 `.compute(` call sites across 51 files and today no clean way to prewarm
  them. Caveat: the general "TSL compiles slowly" complaint (#31674) remains open
  upstream, and the r184 "3× compile" claim should be treated as
  measure-after-upgrade, not a promise.

### 7.3 Perf headroom (iGPU lane)

QuadMesh bypasses MVP transforms — every fullscreen pass gets cheaper, and our post
chains are towers of fullscreen passes (#33917); fullscreen passes skip MSAA (#33936) —
this waste existed in r181, so it's a genuine bandwidth win, biggest on the 610M;
**BloomNode faster blur** (#33923, ~halves texel fetches) — bloom is used in 52 files;
new cheaper **SSAONode + depthAwareBlur** (#33921); PMREM spiral blur (#32367).
*(Corrections from the perf deep-dive, 2026-08-13: the "V8 deopt fixes" #32400/#32405
were closed **unmerged** — don't count them; TRANSIENT_ATTACHMENT #33977 requires
Chromium ≥~149 and is a **no-op under Electron 38** (Chromium ~140) until an Electron
bump.)* Opt-in `DirectRenderPipeline`
(#34166) skips the intermediate framebuffer entirely but has documented
blending/framebuffer-sampling restrictions — likely incompatible with our MRT+bloom
chains, possibly interesting for lightweight themes.

### 7.4 New tools that map onto existing systems

- **`softParticles()`** (#33887) — depth-fade particles; direct fit for winter snow tiers
  and aurora/particle themes.
- **Gaussian-splat renderer** (addon, #33950 + SH color #34215): WebGPU/TSL
  `GaussianSplatMesh` + SPZ/SPLAT/KSPLAT/PLY/glTF loaders, ~10 KB. Pure opportunity —
  most plausible use: captured scenic backdrops (the Ch3 ~25-material compile monster
  could become a splat vista). Playground spike *after* the upgrade, not part of it.
  Note it's the least-soaked code in r186 (merged Aug 8).
- **Storage buffers + atomics in vertex/fragment stages** (#33626) — could simplify the
  paw-trail/height-field compute systems.
- **`batchIndirectIndex`** (#34111) — public batch-instance id in TSL; the clean
  replacement if ocean coral's internal `vBatchColor` varying dies in the upgrade.
- `Object3D.intersectsFrustum()` (#34065) — alternative to the `frustumCulled=false`
  hammer on per-frame InstancedMesh; `billboarding()` horizontalRotation (#34197);
  shared DepthTexture between passes (#34042) — relevant to koi-pond's depth isolation;
  `renderer.debug.onNodeBuilderCreated` + rebuild reporting (#33311) — good for hunting
  rebuild storms; WGSL reserved-word guard for `Fn` names (#33871); `toVar`-inside-`If`
  false warning fixed (#34176).

### 7.5 Performance outlook (deep-dive, 2026-08-13)

**Will r181 → r186 make the game faster? Yes on the compile-shaped surfaces, probably
slightly on steady-state, no on the fill-bound and Dawn-stall surfaces.**

Key upstream fact: **r181 is itself a degraded baseline.** The r176→r182 CPU regression
(#32675) was accumulating overhead per release — Mugen87's own ladder on one demo:
Chrome CPU load r172 ≈23%, r181 ≈45%, r182 ≈48%. The Jan-2026 recovery PRs then lifted
the same demo from 21→30 FPS (Pixel 8a) vs r182 — a gain far larger than the r181↔r182
gap, so r183+ very likely beats r181, though nobody published a direct r181 A/B, and
r183 explicitly did NOT get back to r172 levels (30 vs 34 FPS; closed into umbrella
#26673). On top of that, r185 shipped the all-items-addressed CPU audit (#33797 — e.g.
`matrixWorld.determinant()` + `getPreferredCanvasFormat()` were being called **per
object per frame**), and there are zero reported runtime regressions in the r183→r186
window. Verdict, strictly graded: vs r182 = measured faster; **vs r181 = faster with
moderate-to-high confidence**; vs the pre-regression era = only partially recovered.

Mapped to this game's *measured* surfaces (from perf-budgets.json + the audits):

| Surface | Dominant cost (documented) | Moves with r186? |
|---|---|---|
| Cold start (boot, Odyssey entry) | Main-thread TSL node-build + pipeline compile (~120–185 pipelines; a single 13.9 s long task of chapter create/compile in the RTX baseline). Asset bytes already paid down (GLB diet 43→4.2 MB). | **Yes — most likely win.** r184's #33120 measured 3.0× TSL compile (1550→515 ms). Caveat: the Dawn WGSL→HLSL half is Chromium-side and doesn't move. |
| Theme switch | Cold compile of the incoming theme's material set on a fresh renderer/device | **Yes** (same lever), plus r185/r186 leak fixes retire residual drips. Note: bloom-dispose contract tests pin r181 privates and are *designed* to fail on upgrade. |
| Theme idle gates (Stillwater cell: 45 draws yet 5–9 ms on the 610M) | Per-frame renderer CPU-submit + fullscreen post/bloom fill in a tiny scene | **Yes — best A/B detector.** Exactly the shape bind-group caching (r182/r183), event-driven bindings (r184), QuadMesh bypass / MSAA-skip / faster bloom (r186) act on. Also the gate that would catch any regression. |
| Odyssey scroll GPU p50 (ch1: 32–34 ms at 88 draws on Lane B) | GPU fill/overdraw of app-authored additive particles + per-fragment FBM noise | **No.** GPU-timestamp medians of our own content; recovery levers are content edits (sprite→instanced, haze trim), not the library. |
| Gameplay frame tail (p99 ~109 ms with zero long tasks) | Dawn-side first-use pipeline creation while the main thread sits idle | **No.** r184's main-thread compile speedup doesn't touch it; levers are app-side effect prewarm + fixed-tick. |

Watch-items that could *cost* iGPU perf and need a measurement, not an assumption:
canvas format following `outputType` to 16-bit float (r182 — pin the format if bandwidth
regresses), the shadow-overhaul cost profile on the three shadowed themes, and
`viewportTexture` FRAME→RENDER extra copies in multi-pass water scenes. The Stillwater
v5/v6 acceptance lanes + odyssey gpu-split stations are ready-made admissible A/B
harnesses — the upgrade PR should prove the perf story on both lanes, not assert it.

### 7.6 r186-specific migration cost (small — audited against the repo)

1. **`Object3D` gains `dispose()`** — two custom water Mesh subclasses collide:
   `GoldenForestWater.dispose()` needs a one-line `super.dispose()`;
   **`MistyLakeWater` assigns `scope.dispose` in its constructor**, which silently
   shadows the new base method — it must call `Mesh.prototype.dispose.call(scope)` (or be
   refactored), else the base dispose (which triggers renderer resource release) never
   runs on theme switch. SunsetOceanWater is clean. The repo-wide guarded `.dispose?.()`
   teardown pattern is safe (every Object3D-family receiver found is an InstancedMesh).
   Also: `BufferGeometry.dispose()` now deletes the geometry's own attributes (#33939) —
   don't touch `geometry.attributes` after dispose.
2. **`PCFSoftShadowMap` removed for WebGPURenderer** (#33987) — two live sites:
   `neon-district-theme.js:1710` (always WebGPURenderer) and
   `golden-forest-theme.js:814` (WebGPU path behind the compat guard). Swap to
   `PCFShadowMap` (now soft) / gate by backend, then recapture both themes.
3. Zero repo usage (verified): `Source`→`TextureSource`, GTAONode distance model,
   SimplifyModifier async, `toTrianglesDrawMode` mutation, TSL `append` removal.
4. Watch item: #33978 (`LightShadow.radius` → `softness` rename) is still open on the
   milestone and would add one more mechanical break if it lands before the cut.

Everything in §5 (the r182–r185 inherited migration) still applies unchanged — r186
removes the blockers and adds payoff; it does not shrink that bill.

## 8. Primary sources

- Migration guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide (r181→r185 sections; a 185→186 section already exists)
- Releases: https://github.com/mrdoob/three.js/releases/tag/r182 … /r185
- r185 blockers: [#33890](https://github.com/mrdoob/three.js/issues/33890) (InstancedMesh, verified), [#34081](https://github.com/mrdoob/three.js/issues/34081), [#34184](https://github.com/mrdoob/three.js/issues/34184)
- r182 WebGPU perf/shadow regression thread: https://discourse.threejs.org/t/webgpu-significant-performance-drop-and-shadow-quality-regression-in-r182-vs-webgl-r170/89322
- Dependabot branch: `origin/dependabot/npm_and_yarn/three-0.185.1` (`8129a44b`, verified never merged)
