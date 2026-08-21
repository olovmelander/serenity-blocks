# three.js upgrade: r181 → r185 — CLOSED 2026-08-21 (a record, not a backlog)

> **Status: CLOSED — executed in full.** Every phase below shipped on the feature branch
> between 2026-08-20 and 2026-08-21 (commits `38d91cfa` → `9af29357`): the portability
> sweep, the exact-pin bump to `three@0.185.1`, the warm-up and MRT reworks, the
> `RenderPipeline` rename, the validation matrix (browser + 61/61 Electron themes + the
> WebGL-fallback lane), the perf re-baseline on the current machine on both instruments, the
> moonshafts unblock, and the follow-ups (SharpenNode, `Info.memory` gate, r186
> pre-positioning, budgets re-targeted). Four bugs were found and fixed on the way — two
> upstream r185 defects (drafts in `UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md`), the dead
> `?shafts=1` wiring, and neon-district's black screen on every non-WebGPU machine.
> Measured outcome: load-phase freezes −62…−86 %, idle spikes −63 %, JS heap −6…−9 %, GPU time
> unchanged within quantization, startup wall-clock +4…+15 % (a documented bucket shift).
> **Decisions that escaped into governance:** ADR-0018 (exact pin + upgrade protocol) and
> ADR-0019 (gate on renderer kind, not backend).
> **Still open, none engineering:** file the two upstream issues (needs a signed-in GitHub
> session), close the stale Dependabot branch, merge to `main`, and the r186 delta when it
> ships (§13). Read §12's status block for the execution log; everything else is the plan
> as it was executed, kept verbatim as the record.

---

**Original decision (2026-08-20): upgrade to exactly `three@0.185.1`, now, as a phased
project.** This revision
replaced the 2026-08-13 research doc's "wait for r186" recommendation: as of 2026-08-20,
r186 is **still unpublished** (npm `latest` = 0.185.1; the r186 milestone sits at 61 open /
408 closed, due date 2026-08-19 shown as *overdue*, with pre-release API-rename polish
landing on dev Aug 18–19 — it will likely ship within days-to-weeks, see §13). 0.185.1 is
the newest version that exists, the original r185.0 blocker (#33890 InstancedMesh) is fixed
in the .1 patch, and every remaining "fixed only in r186" issue is either not-exposed for
this repo or carries a userland workaround (§10). Waiting longer just extends the life of
r181 teachings that this round of research proved are going stale in our own comments.

**Research method for this revision:** 19-agent verification workflow (2026-08-20) reading
the **actual `three@0.185.1` npm tarball source** side-by-side with the installed
`0.181.2`, plus live GitHub/npm/discourse queries, plus **empirical shader generation**
(driving `WGSLNodeBuilder` from both versions in Node — harness preserved as
`gen-wgsl.mjs` in the session scratchpad) where source reading could not settle emission
order. Every claim below is graded VERIFIED / REFUTED / UNCLEAR with receipts. Where this
doc contradicts its 2026-08-13 predecessor, this version is the corrected one (§1).

---

## 0. Executive summary

- **Two hard architectural items, not twenty-five scattered ones.** The real migration
  centers on (a) the **Odyssey warm-up architecture vs r185's rewritten `compileAsync`**
  (§3) and (b) the **positionNode/instance-transform ordering inversion** (§4, empirically
  verified — the old doc had this backwards). Everything else is mechanical edits, one
  MRT blend restore helper (§5), one alpha-compositing re-tune on two surfaces (§6), and a
  screenshot campaign.
- **A large fraction of the old §5 bill dissolved under verification.** Lambert/Phong IBL:
  no change. Canvas float16: no change. `updateRanges`: r181 already honored them.
  Reflector `.camera`: zero repo exposure. Normal-less geometry: zero exposed sites.
  `positionLocal` "~13-site workaround inversion": wrong direction, wolfhour survives.
  Full cleared list in §9 — do not re-litigate these.
- **What we get:** the r184 3× TSL-compile speedup + truly non-blocking `compileAsync`
  (receipts in §2) against our #1 measured pain; the r185 disposal-fix batch against
  SB-15 theme-switch leaks; and the **stillwater volumetric moonshafts unblock** — the
  r181 `null`-multiply that parked them is guarded in r185 (§11.1, root cause found).
- **Player-visible risk concentrates in three places:** MRT-theme bloom (additive
  materials now stomp the emissive buffer — §5), transparent-canvas glow over DOM (intro
  WebGPU + golden-forest — §6), and Water.js themes (fresnel floor dropped 15× — §8.2).
  All three have concrete fixes/retunes specified below, not just "recapture".

---

## 1. Corrections to the 2026-08-13 doc (read before trusting old quotes)

| Old claim | Verdict | Corrected finding |
|---|---|---|
| "r185 `positionLocal` no longer includes instance transforms in `positionNode`; inverts our ~13-site workaround class; wolfhour breaks" | **WRONG DIRECTION** | Empirically (generated WGSL, both versions): **r181** runs `positionNode` first (positionLocal = raw geometry inside it) and applies the instance matrix *after*, on the node's output; **r185** applies instance/batch/skin *first* and the `positionNode` output is final. Wolfhour **survives** (translation-only matrices ⇒ algebraically identical). The real break classes are masks/pivots read from `positionLocal` inside `positionNode` (now post-transform) and `positionGeometry`-only nodes on real matrices (instancing silently discarded). §4. |
| "Lambert/Phong now receive IBL from scene.environment (r183); neon-district envMap workaround obsolete" | REFUTED | `scene.environment` still reaches only Standard/Physical node materials in r185 (`MeshStandardNodeMaterial.js:110-112`, identical both versions). Keep the neon-district per-material envMap workaround (`neon-district-theme.js:8204-8227`). |
| "Canvas format may follow outputType to 16-bit float (r182)" | REFUTED | float16 canvas is opt-in (`outputType: HalfFloatType`) in **both** versions. The real r182 item is the `colorBufferType` → `outputBufferType` constructor-option rename (hard rename, no shim) — repo passes neither. |
| "Black-hole's hand-merged updateRanges were masked by r181 full-buffer uploads" | REFUTED | r181 already honors `updateRanges` (`WebGPUAttributeUtils.js:178-227`). r185 fixes an off-by-one only in the vec3-padding path; every repo storage attribute is itemSize 4 (one itemSize-2, stride-aligned) — not exposed. |
| "Three shadowed themes (neon-district, golden-forest, stillwater shafts)" | REFUTED | **Two** live shadow themes: neon-district + golden-forest. Stillwater never sets `renderer.shadowMap.enabled=true` anywhere and shafts are `?shafts=1`-gated; sakura-twilight's rig is explicitly disabled. §8.4. |
| "Reflector `.camera` removed — check 15 reflector files" | Exposure REFUTED | 11 real `reflector()` call sites, all using `getVirtualCamera(camera).layers` — API byte-identical in r185. The classic examples `Reflector.camera` removal is real but the sole importer (singing-bowl) never reads `.camera`. No action. |
| "r182 shadow improvements cost perf" | REFUTED | Vogel-disk PCF is **fewer** taps (5 vs 17), and r185's `textureGatherCompare` PCFSoft rewrite claims ~70% shadow bandwidth reduction (#33534). The change is *look* (softness/dither), not cost. §8.4. |
| "PCFSoftShadowMap → PCFShadowMap swap needed (2 sites)" | Deferred | In 0.185.1 PCFSoft still works silently under WebGPURenderer (`ShadowNode.js:177` filter lib). Removal is r186. Only golden-forest's **classic-WebGL fallback** sees a swap-warn today. Pre-position for r186, don't block on it. |
| "MRT emissive rework = largest visual item, ~25 pipelines" | Sharpened | Verified + worse-and-better: the dominant regression mode is additive **colorNode-only** materials stomping *black* into the emissive buffer (not just glows not summing); **Odyssey production is NOT affected** (no MRT: `useMRT ?? false`, controller never passes it); r185 ships a per-attachment mitigation (`MRTNode.setBlendMode`) — plus an upstream `merge()` bug we must patch around. §5. |
| "compileAsync warm-up may silently break" | CONFIRMED & specified | It does, mechanically, and the failure mode + the surviving mechanism + the fix shape are now known. §3. |
| atan2 "removed in r183" | Minor | Removal release unclear; verified absent from 0.185.1 exports. Six importing files confirmed, no others. |

Also stale in the old doc: the perf-hardware notes. Every committed GPU baseline came from
the dead RTX 5080 + Radeon 610M machine; the current dev machine (Legion 82JU, RTX 3070
Laptop) has neither, and Lane B (iGPU) is currently unreproducible on it
(`perf-budgets.json:4`, `reports/odyssey-perf/README.md:21-33`). §12.

---

## 2. What r185 delivers against measured pain (receipts, graded)

- **Cold start / theme switch (our #1 pain):** r184 #33120 "TSL compilation 3.0×"
  (measured: materialx example 1,550 → 515 ms; dominant win `getNodeType` caching —
  VERIFIED merged, mechanism present in 0.185.1 `Node.js:571-616`); r184 #32984 truly
  non-blocking `compileAsync` (yields per shader stage — VERIFIED, and it *restructures*
  our warm-up, §3); r184 quad caching; r185 NodeBuilder Set-based bookkeeping + fast-path
  `getDataFromNode`. Treat "3×" as measure-after-upgrade: it was measured on a
  materialx-heavy scene, and the Dawn WGSL→HLSL half of our compile cost is
  Chromium-side and does not move. Also note the acknowledged open weak spot: WebGPU
  material/pipeline init is still ~16× WebGL on a 10k-mesh stress test (#33821, open).
- **Theme-switch leaks (SB-15):** r185 disposal batch verified in source — BloomNode
  `dispose()` now frees its materials (retires our `bloom-dispose.js` helper, §7.4),
  render-target texture disposal, sampler cache scoping. Two of our surgical
  workarounds become deletable, one must be **re-mapped** (`_quad` → `_quadCache`, §7.3).
- **Steady-state CPU/GC:** the r185 #33797 audit batch (per-object-per-frame
  `getPreferredCanvasFormat()` and `matrixWorld.determinant()` eliminated, FrustumArray
  rebuild stop, render-bundle re-projection stop, update-range merging, UBO GC-churn fix)
  — all VERIFIED merged with milestone r185. Honest scaling note: the published
  regression ladder was a ~4,500-draw scene; at our 50–100 draws the per-object wins
  shrink ~50×. What still matters at our draw counts: allocation/GC reductions (fewer
  hitches — exactly our focus), `submit()` batching, and compile-time items. **No direct
  r181↔r185 A/B exists anywhere upstream** — we must measure our own (§12).
- **Unblocked feature:** stillwater volumetric moonshafts — root cause found and fixed
  upstream (§11.1).
- **New tools that map onto existing systems** (post-bump adoption ladder in §11):
  `BloomNode.setResolutionScale` (replaces two stillwater monkey-patches), `SharpenNode`
  (RCAS for DRS'd output), FSR1/TAAU upscalers, `radialBlur` (shipped equivalent of our
  hand-rolled streak godrays), render bundles (InstancedMesh replay now updates instance
  buffers), `reversedDepthBuffer` (opt-in), byte-level `Info.memory` accounting (leak-gate
  upgrade for the perf harness).

---

## 3. Architectural item #1 — warm-up vs r185 `compileAsync` (VERIFIED breaking)

r185 restructured `compileAsync` from r181's "synchronous prologue + one
`await Promise.all(pipelines)`" into "synchronous snapshot + **deferred build loop**":
`_createObjectPipeline` now only queues work items; node building + pipeline creation run
*after* the synchronous section, one object at a time, with `await yieldToMain()` between
every shader stage and every object (r185 `Renderer.js:884-1067`, `NodeBuilder.js:3265`).

**Consequence for the repo's core warm recipe** (bind post target/MRT → `compileAsync` →
restore synchronously in `finally`; `warmup/post-target-compile.js`,
`OdysseyBoardController.js:1387-1444`): only the **first object's** `NodeMaterial.setup`
(including its live `renderer.getMRT()` read) runs before the first suspension. Objects
2..N build **after the restore**, read the restored (null) MRT, and cache single-output
shaders under an MRT-agnostic builder cache key (`RenderObject.js:949-951`,
`NodeManager.js:151-153`). The live MRT pass then reuses them → the repo's own documented
"poisoned-cache black screen", now produced by the warm-up itself. Full per-assumption
verdict table (A1–A12) is in the 2026-08-20 workflow transcript; the load-bearing ones:

| Assumption | r185 verdict |
|---|---|
| A1 bind→launch→restore-in-finally is safe | **BREAKS silently** (above) — the central failure |
| A2 bare `compileAsync` binds no target ⇒ MRT bare-sweep ban | Changed but **ban stays**: bare calls now target the internal HalfFloat framebuffer; MRT poisoning mechanism unchanged. Update the ban's comment text only |
| A5 warm culls against stale frustum ⇒ `frustumCulled=false` reveal | **Obsolete + new risk**: r185 `compileAsync` updates matrices/camera and **really frustum-culls** against the passed camera. Off-camera chapter content is now consistently *excluded* from compile — force `frustumCulled=false` during prewarm or accept coverage loss |
| A6 "single await; batch overlap safe" | Partially breaks: per-object serialized pipeline creation (r181's one big parallel Dawn batch is gone) — compile barriers stretch across many yielded frames; warm timings must be re-baselined |
| A7 private-target **render-warm** (cloned RT + synchronous `renderer.render()`) | **HOLDS verbatim** — `render()` is still fully synchronous; format-based backend pipeline cache keys unchanged (`WebGPUBackend.getRenderCacheKey`). **This is the surviving warm mechanism** |
| A8 poll `.pipeline` until compileAsync resolves | Holds; pending window is much longer — keep the bounded poll, expect it to wait |
| A11 group-targeted compile | Holds; minor: a Group as `targetScene` no longer compiles `scene.background` (compiles on a live frame instead) |

**Fix shape (with-bump):**
1. **Startup path:** adopt upstream's own sanctioned pattern (r185
   `PassNode.compileAsync`, PassNode.js:749-762) — hold the post target + MRT bound
   **across the entire await**, restore after resolution. Safe only because
   `beginPostTargetCompile` already gates on the loop being idle.
2. **Background path (live loop):** there is no upstream-clean way to hold global
   target/MRT state across a multi-frame-yielding compile. **Retire background
   `compileAsync` warms; rely on the private-target synchronous render-warm (A7)**, which
   r185 leaves untouched.
3. Force `frustumCulled = false` during prewarm traversals (A5).
4. Update all pinned three line numbers in warm comments (2761→3082, 2763→3084,
   895/897→966, 861→909-911, RenderObject 691→738).
5. `effect-prewarm.js`'s bare `compileAsync` + 250 ms race now *abandons* (not cancels) a
   build loop that keeps mutating shared caches for seconds — bound or retire it.

Electron note: `yieldToMain` uses `scheduler.yield()` (Chrome ≥129; Electron 38 =
Chromium 140 ✓) and the app sets `backgroundThrottling:false` on every window incl.
capture harnesses — the rAF-fallback stall risk is not live for us. The real cost is
**wall-time**: background warms complete later; re-baseline warm timings (§12).

---

## 4. Architectural item #2 — the positionNode ordering inversion (EMPIRICALLY VERIFIED)

Generated vertex code, same material on `InstancedMesh`, both versions (harness output,
2026-08-20 — reproduced firsthand, not from changelogs):

```wgsl
// r181                                          // r185
positionLocal = position;                        positionLocal = position;
positionLocal = positionLocal + offset;   // ①   positionLocal = instMat * positionLocal;  // ②
positionLocal = instMat * positionLocal;  // ②   positionLocal = positionLocal + offset;   // ①
```

- **r181:** `positionNode` output is *re-transformed* by the instance/batch/skin matrix.
  Inside `positionNode`, `positionLocal` ≡ raw geometry.
- **r185:** transforms run first; inside `positionNode`, `positionLocal` is the
  **post-instance** position, and the node's output is final — *nothing re-applies the
  matrix*. Matches the official 184→185 migration entry. (Source reading alone cannot see
  this — `setupPosition` is textually near-identical in both; the flip comes from r185's
  class-node → Fn auto-stacking rewrite of Instance/Batch/Skinning. Two independent
  agents' source-only readings called it "no change"; the generated code proves otherwise.
  Trust emitted shaders, not `setupPosition`.)

**Break classes** (audited across `src/themes`, `src/rendering`, `src/playground`,
`src/ui` — every `positionNode` site on an Instanced/Batched/Skinned mesh classified;
zero SkinnedMesh with positionNode exists anywhere):

1. **Collapse (critical):** `positionNode` that never passes `positionLocal` through, on
   non-identity matrices → instancing silently discarded. One production site:
   `ocean-materials.js:713` (`createCoralOvergrowthNodeMaterial`,
   `positionGeometry.add(wave)`) → every coral-overgrowth instance renders at origin.
   Fix: base on `positionLocal`.
2. **NaN/garbage (critical, gameplay surface):** `level-node-manager.tsl.js:795` + hidden
   instances via **scale-0 matrices** (`LevelNodeManager.js:834-837`) — on r185 the
   additive wobble re-adds *after* the collapse, and `normalLocal` through a 0-scale
   rotation is garbage. Fix: gate displacement per-instance, or hide via translation
   (-99999) instead of scale-0.
3. **Masks/pivots/rotations computed from `positionLocal` inside `positionNode`
   (high):** masks saturate at world heights; rotations pivot in the wrong space.
   Sites: `surface-world.tsl.js` `vegetationSwayNode`(:1488) + `floraSwayNodeShared`
   (:1527) — **two function fixes cover six break rows**; sky-children-v2 `sky-birds.js`
   wing flap; koi-pond forest/fish/tails; ocean fish/reef-dwellers; golden-forest
   tree/reed wind masks; winter `framing-spruces` belt; summer trees (material injected
   from `summer-meadow.effect.js` — load-bearing playground→theme link);
   `bioluminescence-2` + `summer-meadow` playground masks.
4. **Offset-space flips (medium/low — placement preserved, sway/drift no longer rotated
   or scaled per instance):** koi-pond landscape/petals/grass, stillwater forest rows,
   ocean seaweed (its per-blade width scaling: medium-high), sky-core + verdant-hills
   grass/flowers, golden-forest passthroughs, ocean beam dust, odyssey world-renderer
   gusts (whose "gust fronts" comment finally becomes *true* on r185), mountain-peaks
   flags, vesper-chrysalis/koi-pond/summer-meadow motes. Screenshot-decide: accept the
   new (often more world-coherent) look or rotate offsets by per-instance attributes.
5. **SAFE by construction:** identity-matrix billboards (storage-driven placement —
   astral-weave, stillwater motes, tornado ribbons, intro/boot-warp UI particles,
   shifting-sands, neon-dusk/synthwave highlights); **wolfhour** (translation-only
   matrices make `positionLocal.sub(positionGeometry)` algebraically identical across the
   inversion); every `Mesh`+`InstancedBufferGeometry` custom-instancing surface (the
   shared odyssey billboard contract mandates this, `odyssey-tsl-billboard.js:23`); every
   instanced mesh whose material has no `positionNode`.

**Version-portable fix idiom** (works identically on r181 — most fixes can land
pre-bump): masks/pivots/phases from `positionGeometry` / attributes / uv; placement via
`positionLocal` passthrough (`positionLocal.add(offset)`); orientation-dependent offsets
rotated by explicit per-instance attributes; never a `positionGeometry`-only node on a
real-matrix instanced mesh; never scale-0 hiding under an additive `positionNode`.
(On r181, `positionGeometry` ≡ `positionLocal` inside `positionNode`, so mask/base swaps
are pixel-identical no-ops pre-bump.)

**Repo folklore warning:** comments assert both orderings in different files
(`ocean-materials.js:661-663` and `stillwater-forest.js:1355-1358` wrong for r181;
`summer-meadow.effect.js:18-22` right for r181, wrong after upgrade). Rewrite the
touched ones during migration; the `webgpu-threejs-tsl` skill gets the verified r185
semantics (§7.6). Test pins that match `positionNode` source text and must move with any
rewrite: `odyssey-world-lints.test.js:148-160`, `odyssey-ground-lever.test.js:72-73`,
`odyssey-clipmap.test.js:148`, `stillwater-playground-waves.test.js:236`.

---

## 5. MRT emissive blend — restore + upstream bug patch (VERIFIED)

r185 blends only the attachment named `output` with material blending; **every other MRT
attachment defaults to opaque write** (`MRTNode.js:77-79,113-117`;
`WebGPUPipelineUtils.js:127-179`). r181 applied material blending to all attachments.
Since the MRT struct forces alpha 1.0 on vec3 outputs, the dominant regression is **mode
(b): additive materials with no emissiveNode — the majority — previously added 0 to the
emissive buffer; on r185 they opaquely stomp black over any glow behind them.** Mode (a)
— overlapping additive emissive writers no longer summing — is rarer (lunara has the most).

- **Blast radius:** 26 MRT pipelines audited with per-theme additive/emissive counts.
  HIGH: stellar-drift, winter, neon-dusk, chromadelic-highway, cosmic-noir, ocean,
  synthwave-sunset (+neon-district/lunara/wolfhour/astral-weave when their gates enable
  MRT). MEDIUM: chiral-gold, stellar-velocity, ice-temple, golden-forest, black-hole,
  stillwater, starlight, shifting-sands. LOW: fluid-dreams, sky-children-v2, tornado,
  electric-dreams-v3, himalayan-peak. **Odyssey production: NOT affected** — the TSL
  pipeline defaults `useMRT ?? false` and `OdysseyBoardController` never passes it.
- **Fix-forward (r185 API):** keep the mrt node instance and call
  `mrtNode.setBlendMode('emissive', new BlendMode(MaterialBlending))`
  (`BlendMode` exported from three/webgpu; `MaterialBlending` = 6). One shared helper in
  `src/themes/shared/`, applied at all `setMRT` sites.
- **Upstream bug we must patch (verified in 0.185.1 source, re-checked by hand):**
  `MRTNode.merge()` writes the merged map to `mrtTarget.blendings` (`MRTNode.js:155`)
  while `getBlendMode` reads `this.blendModes` (:115) — so the five per-material
  `material.mrtNode` themes (ocean, chiral-gold, cosmic-noir, black-hole, stillwater) go
  through merge and **silently discard** any `setBlendMode`. Ship a tiny app-level patch
  of `MRTNode.prototype.merge` (copy into `.blendModes`) with the bump; file/point to an
  upstream issue. Minor sibling: custom `BlendMode`s must set `.premultipliedAlpha` (the
  class defines `premultiplyAlpha`, the consumer reads `premultipliedAlpha`).
- Backend divergence note: WebGPU compat mode keeps r181 behavior (material blending
  everywhere, warnOnce); the WebGL-fallback backend honors per-attachment blending only
  with `OES_draw_buffers_indexed`. Capability-gated MRT themes can look different per
  backend — capture both lanes for one HIGH theme (§12).

---

## 6. Premultiplied alpha (r185 "Compositor Contract") — two exposed surfaces

What changed: only `RenderOutputNode` — the final canvas blit now does
clamp(a) → **unpremultiply** → tone map → encode → **premultiply**
(`RenderOutputNode.js:108-141`); `unpremultiplyAlpha` maps a==0 → vec4(0). Canvas
`alphaMode`, clear-color premultiply, and all blend factors are byte-identical to r181.
Net: r181 was *too bright* at partial alpha over DOM; r185 is dimmer/correct — and
**additive glow rendered where scene alpha = 0 vanishes entirely** (r181 leaked it
through the premultiplied compositor). There is **no flag** to restore r181 output
(no `premultipliedAlpha` renderer option exists — claim refuted).

Exposure audit (all 22 `alpha:true` canvases classified):

- **EXPOSED — `src/ui/threejs-intro-renderer-webgpu.js`** (alpha:true, no clear color, no
  background, HDR bloom composite over the intro's CSS gradient): bloom/streak halos
  outside geometry disappear; nebula edges dim. **Fix options:** (A) give halo pixels real
  alpha in the outputNode (`vec4(rgb, max(sceneAlpha, luminance(bloom)))`), or (B)
  pixel-exact r181 shim — `post.outputColorTransform = false` +
  `outputNode = color.workingToColorSpace(sRGB)` (mechanism verified: the blit then skips
  the premultiply chain while the canvas stays premultiplied). The WebGL intro fallback is
  untouched → the two intros will diverge until fixed.
- **EXPOSED — golden-forest WebGPU path** (alpha:true + `scene.background=null` over the
  theme's CSS gradient): sky/fog/soft foliage edges shift. Same options; it renders
  direct (no PostProcessing), so option B needs a minimal pipeline wrapper — prefer (A)
  or an opaque background if the DOM blend isn't actually load-bearing there.
- **Conditionally exposed — playground** (`scene.background=null` effects render
  transparent over `#05060a`): every pre-upgrade screenshot baseline of such effects is
  suspect after the bump. Note in the capture protocol.
- **NOT exposed (verified):** Odyssey board (`setClearColor(0x050510, 1)` ⇒ alpha
  saturates to 1 — and the "board over chapter canvas" premise is false: one shared
  canvas); ice-temple (opaque background); every `alpha:false` WebGPU theme; every
  classic-WebGL `alpha:true` surface (the change is node-output-path only).

**Capture protocol for the two exposed surfaces:** set the backdrop loud
(`element.style.background='#ff00ff'` via devtools) before A/B screenshots — over
near-black the regression is easy to miss; over magenta it is unmissable.

---

## 7. Mechanical breaks, renames, and workaround surgery (all verified in 0.185.1 source)

1. **TSL `atan2` gone** (absent from exports; two-arg `atan(y,x)` is the drop-in,
   already the repo idiom at `lunara-materials.js:483`). Exactly 6 importers:
   `winter/rendering/aurora-volume.js:25` (**coordinate with the in-flight winter
   branch**), `tornado/TornadoGround.ts:3,74`, playground `halcyon-apex:31,214`,
   `summer-meadow:28,249,283,407`, `vesper-sky:21,76,84`, `winter-aurora:22,132`.
   `Math.atan2` and raw-WGSL `atan2` unaffected. Also the **only** thing that fails
   `npm run typecheck` on r185 (empirically probed — one TS2724 error, then green).
2. **TSL `.equals()` gone** (r181 warned; r185 TypeError). One site:
   `ice-temple-compute.js:312` → `.equal(`.
3. **Stillwater pooled-renderer surgery** (`stillwater-theme.js:98-156`): every touched
   private survives **except `renderer._quad`** — r184 replaced it with
   `renderer._quadCache` (Map keyed by output texture). The quad-geometry
   dispose-listener strip at :134 is optional-chained ⇒ **silently no-ops on r185 and
   the leak returns with no error** (highest-priority remap: get the singleton via
   `new QuadMesh().geometry`, or walk `_quadCache`). The upstream quad-listener leak is
   NOT fixed in r185 (TODO #31798 still in source). **New surgery site:** clear
   `renderer._quadCache` on pooled-renderer reset (each entry pins a QuadMesh +
   NodeMaterial chained into the node manager). NodeFrame severing, `_renderLists` /
   `_renderContexts` / `_bundles` dispose, `_animation` driver, Geometries listener map:
   all SAME and still needed. PassNode/pipeline severing in `stillwater-pipeline.js`
   :455-473: all field names survive, still needed. `_nMips` override still works;
   the `setSize` monkey-patches can move to the new public `setResolutionScale(…)`.
4. **BloomNode material-dispose leak: FIXED upstream** — r185 `dispose()` frees all three
   material groups. Retire `src/themes/shared/bloom-dispose.js` down to node-severing
   only (r185 still parks the last composite material on a module-level shared quad) and
   retire `tests/unit/bloom-dispose-contract.test.js` **deliberately** — its "fail
   loudly" tripwire has a slice bug (`indexOf('\t}')` truncates inside the first nested
   loop, verified byte-level) and would pass silently.
5. **Contract tests that fail mechanically on the bump:**
   `stillwater-webgpu-dispose-contract.test.js` — ENOENT (`common/nodes/Nodes.js` →
   `NodeManager.js`) + its "dispose omits device destruction" pin (r185 WebGPUBackend now
   destroys owned devices) — re-point + re-pin; stillwater's manual destroy becomes
   redundant-but-harmless. `composer-dispose.test.js` passes (helper still required).
6. **`backend.hasTimestamp(uid)` → `hasTimestampQuery(uid)`**; `hasTimestamp` is now a
   boolean capability *getter* — so `black-hole-theme.js:2015` throws (swallowed → GPU
   timings silently vanish) and `stellar-velocity-theme.js:938,941`'s guard passes then
   throws. Feature-detect dual-compatibly pre-bump; update the mock in
   `black-hole-lifecycle.test.js:44`.
7. **`vBatchColor` varying: vec3 → vec4** (`Batch.js:49`). The one reader,
   `ocean-materials.js:764-769`, registers a *second* same-named varying → coral tint
   goes black or WGSL struct error. r185-only fix (with-bump):
   `varyingProperty('vec4','vBatchColor').rgb` (note: `batchColor` is NOT exported from
   the flat `three/tsl` entry — only via `THREE.TSL` on three/webgpu).
8. **`PostProcessing` → `RenderPipeline`:** deprecated warn-once alias, fully functional
   in 0.185.1; the only real API delta (context keys `onBeforePostProcessing` →
   `onBeforeRenderPipeline`) has zero repo usage. 36 construction sites + 13
   `renderAsync` sites (all `renderAsync` deprecations **already exist in r181** — not
   new). **Policy: do NOT rename with-bump** — six stillwater/cosmic-noir tests pin the
   literal `new THREE.PostProcessing(` source text; rename post-bump in a dedicated
   commit with those test updates + the chiral-gold probe extension
   (`chiral-gold-theme.js:735` → `RenderPipeline ?? PostProcessing`). Accept one warnOnce
   per constructed pipeline until then (playground console-error gates key on errors, but
   verify none treat warnings as failures).
9. **`THREE.Clock` deprecated (r183):** still works; warns **once per construction** and
   the repo constructs ~60 (re-created per theme activation → recurring console noise).
   Mechanical `Clock` → `Timer` sweep (exported from both entries), or accept the noise;
   do it before the playground console gate ever starts counting warnings.
10. **`Object3D.updateWorldMatrix` honors `matrixWorldNeedsUpdate` (#33746)** — the
    change that "broke apps" in the field. **Repo audited site-by-site: zero breakage**
    (every frozen-matrix site calls `updateMatrix()` at freeze time or freezes identity;
    direct `.matrix.compose` writes only target InstancedMesh scratch dummies). Keep the
    rule in review: after direct `.matrix` writes, set `matrixWorldNeedsUpdate = true`.
11. **`renderer.waitForGPU()`** removed-with-error — repo has comment-only references;
    the `queue.onSubmittedWorkDone` path in `warm-hidden-drawables.js` remains correct.
12. **Koi-pond DepthTexture isolation:** r185 adds the first-class parameter
    (`viewportDepthTexture(uv, null, ownDepthTexture)`); the local `DepthTexture` must
    **stay** (the shared module-global default still exists) but the hand-rolled
    `viewportTexture(uv, null, depthTex)` route can move to the intended API. Keep the
    MSAA-copy gate until tested live.

### 7.6 Knowledge-base re-stamp (same commit as the bump)

The `webgpu-threejs-tsl` skill (both `.claude/` and `.agents/` copies) currently teaches
r181 rules that become wrong: "RenderPipeline does not exist", the r181 positionNode
ordering, `atan2` in the importable list, silence on the MRT blend default. Full edit
list (verified file:line): `SKILL.md` frontmatter/description, :6, :12-14, :39-40, :60,
:62, :72 + a new symptom row "additive glow stops blooming → `setBlendMode('emissive',
new BlendMode(MaterialBlending))`"; `REFERENCE.md:224, :354-360`; `docs/post-processing.md`
header + MRT section; `docs/core-concepts.md:424,432` (atan2→atan);
`docs/noise-and-utility-nodes.md:1,6,73`; `docs/performance.md:9` (+`hasTimestampQuery`);
`docs/compute-shaders.md:455,477,485`; `docs/scene-techniques.md:1`; `docs/materials.md`
:150-158 (+ordering note); `src/playground/README.md:30` "(r181+)" stamp. `CLAUDE.md` and
`docs/WEBGPU_THREEJS_WORKFLOW.md` verified clean — no edits. Drive the final sweep from a
fresh `r181|0\.181` grep at bump time.

---

## 8. Behavior changes to verify (not fix) — the recapture list

1. **`viewportTexture`/`viewportSharedTexture` FRAME → RENDER refresh.** Complete user
   list verified: stillwater (multi-pass — refraction content *and* per-frame copy count
   change), neon-dusk SSR, koi-pond (single-render — only cache keying changes). Watch
   for one extra fullscreen copy per additional pass on the low-power lane.
2. **Water.js addon rework:** fresnel base reflectance 0.3 → 0.02 (15× less head-on
   reflection), ambient floor removed, HalfFloat RT. Affects crystal-cave,
   bioluminescence, rainy-window. Golden-forest/sunset vendored forks insulated.
   If the new look loses the mood: vendoring r181's Water.js is verified viable (MIT,
   373 lines, 13 stable core imports, repo precedent ×2).
3. **UnrealBloomPass (classic WebGL lane) composite rewritten** (premultiplied additive,
   3.0 baked into rgb, max-channel alpha): brightness-vs-strength curve changes on every
   WebGL bloom surface — intro (WebGL path), blood-moon, CosmicExplorationEffect bg,
   ~20 classic composer themes + classic fallback lanes. One visual pass; retune
   `strength` where hot. (EffectComposer `clock`→`timer`: zero repo exposure.)
4. **Shadows (2 live themes):** Vogel-disk PCF + IGN dithering + `LessEqualCompare` —
   softness/dither/acne-threshold changes; re-tune the four bias values
   (neon-district `-0.0005`/nb `0.05`, golden-forest `-0.00035`/nb `0.02`) and
   revalidate neon-district's static-shadow cache (`needsUpdate`/`autoUpdate=false`).
5. **PBR drift (r182 energy conservation + DFG LUT — affects *all* Standard/Physical,
   not just env-lit):** priority screenshot list = lunara, ice-temple, neon-district
   (+ playground vesper-chrysalis, summer-meadow, lunara-crystal); second tier ~15 themes
   drift subtly under analytic lights.
6. **Adapter acquisition (r183):** r185 always requests `featureLevel: 'compatibility'`
   then derives compat from `core-features-and-limits`; **if compat: `_samples = 0`
   renderer-wide (MSAA silently off)**. `parameters.compatibilityMode` option is gone
   (repo never passed it). **Smoke test #1 after the bump:** assert
   `renderer.backend.compatibilityMode === false` and MSAA alive on an antialias theme
   (koi-pond is the canary). Electron 38/Chromium 140 should expose the feature.
7. **Owned-device destroy on dispose (new in r185):** the intro WebGPU renderer owns its
   device and hands it to boot-warp — on r185 `intro.renderer.dispose()` **destroys the
   device the warp is using**. Verify intro↔warp teardown ordering (benign on r181, live
   hazard on r185). Never pass three a hand-built narrow-features device (it would be
   flagged compat + MSAA-off).
8. **Compute → same-frame `texture()` sampling (#33795, open):** repo's only
   `textureStore` user (winter `paw-trail-gpu`, playground-only) ping-pongs `.value`
   reassignments = the safe variant; acceptance check =
   `playground.html?effect=winter-wonderland` trails don't lag. ("snow-deformation"
   exposure claim from the old doc: refuted — no such pattern exists.)
9. **Timestamp/query plumbing:** pool size (2048), single-scope-per-type, sticky
   `render.timestamp` — all **unchanged**; ADR-0016 instrument rationale stays valid;
   only the r181 labels go stale. The two `hasTimestamp` breaks are §7.6. New:
   `Info.memory` is byte-tracked — `stillwater-wave8` texture-census notes need
   re-derivation (non-gating).

---

## 9. Cleared — verified no exposure, do not re-litigate

`nodeObject`/`storageObject`/`rangeFog`/`DFGApprox`/`scriptable*`/TextureNode `.uv()`/
`modInt`/`WebGLCubeRenderTarget`(-with-WebGPU)/`CubeCamera`/`Matrix3.translate-scale-rotate`/
`TiledLighting`/`AnamorphicNode`/`SSAAPassNode.clearColor`/SSR/SSGI/GTAO nodes/
`directionToColor`/`colorToDirection`/VOX/FBX/VTK/LWO loaders: zero repo usage.
Reflector `.camera`: no reads. ImageBitmapLoader concurrency bug: requires
`Cache.enabled=true` (repo never sets it) + no direct users — add the guard rule "never
enable THREE.Cache on r184/r185". `colorBufferType`: never passed. Normal-less lit
geometry: all 17 hand-built position-only geometries use unlit materials. #33746
`updateWorldMatrix`: all 37 frozen-matrix sites verified safe. `screenDPR` multi-graph
bug (#34184): **identical defect exists in r181 — upgrade delta zero** (fix ships r186;
`PointsNodeMaterial` sites affected on both; workarounds documented in §10).
`samplerComparison` (#34081): zero usage. Boot-warp shared-device bypass: verified
bypasses acquisition on both versions (but see §8.7). Electron main/gpu-health scripts:
zero three coupling. Vite: all 10 `optimizeDeps.include` paths + all 20 addon specifiers
exist in r185; exports map identical in shape; es2020 target needs no lowering; single
three copy, `manualChunks` isolates a `three` chunk (clean A/B builds). Vitest wholesale
mocks of `three/webgpu`: shapes fine.

---

## 10. Live 0.185.1 issues we inherit (r186-fixed; carried knowingly)

| Issue | Exposure | Mitigation on 0.185.1 |
|---|---|---|
| #34184 screenDPR wrong with >1 node graph | Points/fat-line sizes at DPR≠1 — **already broken identically on r181** | Not a regression for us. If fixing ahead of r186: shared-uniform DPR pattern (the exact r186 fix shape) or the documented `screenDPR.setup` patch |
| #34241 `timestampQueryPool.timestamps` Map grows unbounded under `trackTimestamp` | Profiling/capture sessions (playground `?profile=1`, cosmic-noir/black-hole HUDs) — pre-existing in r181 too | Periodically `renderer.backend.timestampQueryPool.render?.timestamps.clear()` during long captures |
| #34301/#34168 depth-texture swap / sharing between RTs → "Destroyed texture used in a submit" | Multi-RT post pipelines | Rule: never swap `rt.depthTexture` at same size — `rt.dispose()` or resize instead |
| #34280 bind-group cache key collision → silent stale textures | Grows with runtime texture churn — theme-switch-shaped | No clean workaround; watch for stale-texture reports after switch soak tests; fixed r186 |
| #34285 dispose of still-in-use shared geometry/texture no longer auto-recovers | Teardown ordering | Dispose only after last user stops rendering (already repo policy) |
| #33795 compute→texture same-frame staleness (open, no fix) | Only the safe ping-pong variant exists in-repo | Acceptance check §8.8 |
| #33821 WebGPU material-init 16× WebGL (open) | Theme-switch compile cost | This is why the warm-up architecture stays load-bearing after the upgrade |
| **NEW (found in-repo 2026-08-20, capture matrix): `compileAsync(scene, camera, group)` TypeErrors on r185** — `Background.update` runs against the target GROUP (Renderer.js:1005-1007) and guards `=== null` while a Group's `background` is `undefined` → `background.isColor` throws; the prewarm catch swallowed it, silently voiding every Odyssey chapter warm | Every targeted compile in the repo | App-normalized in `compileGroupThroughPost` (mirror Scene's `background = null` onto object groups; pinned by the contract test). Upstream issue drafted: `docs/UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md` (Issue 1) — the public 3-arg compileAsync signature is broken for Groups on r185 |
| **NEW (found 2026-08-21, Electron theme harness): `WebGPUBackend.dispose()` fires the timestamp pools' ASYNC `dispose()` without awaiting, then destroys the owned device** — an in-flight `resolveTimestampsAsync()` rejects and the pool logs "Error resolving queries: DOMException" (once per pool; black-hole's 15 Hz render + 2 Hz compute sampling = exactly 2). r181 never destroyed the device on dispose | Any theme disposing a renderer with `trackTimestamp` sampling live (black-hole; latent for cosmic-noir/stellar-velocity/wolfhour/stillwater) | App-side in `BaseTheme.disposeRenderer`: stop queries, keep loop-stop/canvas-detach/ref-clear synchronous, defer ONLY `renderer.dispose()` until `pool.pendingResolve`s settle (300 ms bound). Pinned by `base-theme-dispose-timestamp-quiesce.test.js`; black-hole re-captured at 0 errors. Upstream issue drafted: `docs/UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md` (Issue 2 — dispose should await the pools) |

---

## 11. Opportunity ladder (exploit r185; ranked, phased)

1. **Stillwater volumetric moonshafts — DONE (acceptance passed 2026-08-20).** Root cause
   confirmed: repo never enables `shadowMap` → `AnalyticLightNode` leaves `shadowNode`
   null → r181 `VolumetricLightingModel.js:154` multiplied by null unconditionally → the
   WGSL `null` error that parked the feature. r185 guards it
   (`VolumetricLightingModel.js:183-187`). **Implemented:** new iteration harness
   `src/playground/effects/stillwater-moonshafts.effect.js` (drives the REAL theme
   module); `stillwater-shafts.js` retuned against r185's front-to-back accumulation —
   SpotLight intensity 2.4→110 (the r181-era value summed to ~0.06 through
   density×0.01×stepSize: invisible), `AdditiveBlending` set (the default
   Normal/opacity-1 painted the accumulated light as an opaque box), IGN `offsetNode`
   dither + steps 12→16, box-edge density fade (kills the slab silhouette);
   `stillwater-runtime.js` `?shafts=1` gate now enables `renderer.shadowMap` and marks
   the near/hero forest roots as shadow casters (all scoped to the opt-in — default path
   pays nothing). Playground verification: carved diagonal beams, zero console
   errors/warnings, 133 fps on the RTX 3070 (`moonshafts-final.png`). SpotLight
   workaround stays (DirectionalLight still skipped, r185 :177).
   **In-theme calibration (same day, second pass):** driving the real game to stillwater
   exposed two more findings. (1) A wiring gap — `getRuntimeParams()` deliberately
   isolates the shader graph from page params (enforced by the wave0 "no
   `window.location.search` in this method" gate), so `?shafts=1` never reached the
   runtime; fixed as an explicit sanctioned pass-through via `readBoolParam('shafts')`.
   (2) The playground calibration (110 / 40°) floods the whole valley as milky haze
   in-theme: the channel camera at z≈43 looks straight DOWN the beam axis, so there is
   no side-on beam contrast — live-tuned in the running game to **35 / 23°** (now the
   module's shipped constants), which reads as a moonlit atmospheric veil that
   preserves the theme's mood (A/B captures: `stillwater-shafts-OFF/-ingame/-tune2/
   -final-ingame.png`). Zero console errors across fresh boots.
   **Remaining: the look call proper** — judge veil-vs-off from the captures (distinct
   Bauer beam striping is geometrically unavailable from this fixed camera; getting it
   would need the light repositioned to slant ACROSS the view — an art-direction
   decision, one-line to try via `MOON_DIRECTION`), then decide default-on per quality
   tier.
2. **`BloomNode.setResolutionScale`** — replace the two stillwater `setSize`
   monkey-patches; map lunara's `bloomDownsample` tier param onto it. Trivial.
3. **`Info.memory` byte accounting as a leak gate** — assert `info.memory.total` returns
   to baseline across theme mount/unmount cycles in `odyssey-perf-baseline.mjs`; add a
   budget row (per ADR-0016: as a *tracked* number only after the instrument is checked).
4. **`SharpenNode` (RCAS)** on DRS'd output — cheapest perceived-sharpness win at the
   0.5–0.65 pixel-ratio floors; one node per pipeline. Post-bump, early.
5. **FSR1 upscaling** — real win for the low-power lane but requires re-architecting DRS
   from `setPixelRatio` to `scenePass.setResolutionScale` per pipeline + an AA'd input;
   currently unmeasurable locally (no iGPU lane on the 82JU). Post-bump project.
6. **`radialBlur`** — shipped equivalent of the hand-rolled chromadelic/synthwave radial
   streak godrays; simplification, not perf. **GodraysNode: not a drop-in anywhere**
   (needs full shadow rigs, Spot unsupported) — future shadowed scenes only.
7. **Render bundles** — matured (per-context keying, InstancedMesh replay updates
   instance buffers); candidate: odyssey static forest chunks. CPU-side win only and
   odyssey is GPU-bound; lights must stay outside bundles (#34304). A/B experiment.
8. **`reversedDepthBuffer`** — opt-in; shadow bias + depth helpers auto-adapt; repo
   z-fighting is already engineered around, so this is a cleanup enabler, not a pain
   killer. Post-bump experiment; audit raw depth comparisons (neon-dusk sun occlusion).
9. **TAAU** — best-quality upscale but needs velocity MRT (nothing outputs velocity
   today) + history RTs at output res; decide after the FSR1 verdict.
10. RenderPipeline auto-rebuild on `toneMapping`/`outputColorSpace` writes — lets 15+
    manual `needsUpdate=true` sites and chiral-gold's `postOwnsToneMapping` logic slim
    down post-rename.

---

## 12. Execution plan

> **Execution status (2026-08-20):** Phases 0 and 1 are IMPLEMENTED in the working tree.
> Phase 0 landed and was verified behavior-identical on r181 (360 files / 3,621 tests +
> typecheck, matching the pre-edit baseline). Phase 1 landed: exact pin 0.185.1, warm-up
> rework (hold-across-await + refcounted session; background compileAsync retired for the
> drain render-warm; new 13-test contract), MRT helper `src/themes/shared/mrt-blend.js`
> (+ merge() patch) at 27 sites, stillwater `_quadCache` surgery, bloom-dispose slim,
> vBatchColor vec4, koi-pond first-class depth API, knowledge-base re-stamp (+.agents
> mirror). Gates on r185: typecheck ✓, 361 files / 3,630 tests ✓, build ✓, and the §8.6
> smoke ✓ (playground renders on REVISION 185, `compatibilityMode === false`, MSAA 4,
> zero console errors). Two full-suite flakes observed once under contention
> (odyssey-forest-lever, theme-lifecycle-audit) — both pass in isolation and on rerun.
> Phase 4 item 1 also landed (same day): **PostProcessing → RenderPipeline renamed**
> repo-wide (36 construction sites, 6 capability probes with alias fallback, test pins
> inverted to require the new name, skill flipped) — gates re-verified green after it.
> Additional smokes ✓: playground `?profile=1&trackTimestamp=1` reports render+compute
> timestamps **available** (quantized on the 65.536 µs tick per ADR-0016);
> bioluminescence-2 `?mrt` renders with additive glow **accumulating** (the mrt-blend
> helper live-validated, zero errors); winter-wonderland compute paw-trail path executes
> cleanly. §8.7 boot-warp/intro shared-device teardown VERIFIED SAFE by ordering (the
> orchestrator's `finally` disposes the warp at handoff end, before any user-driven
> intro destroy; constraint now documented at the `rendererParams.device` site).
> §11.1 moonshafts acceptance PASSED (2026-08-20, post-commit `38d91cfa`): module
> retuned for r185 in the playground-first loop, `?shafts=1` gate wired with scoped
> shadow-map enable + casters — see §11.1 for the full record; only the in-theme look
> call remains. OPEN: Phase 2 visual capture matrix (theme-level MRT bloom A/B, the two
> premultiplied-alpha surfaces with loud backdrops, Water ×3, shadows ×2, PBR trio,
> fragment-stage positionLocal reads, the moonshafts in-theme look call), Phase 3 perf
> re-baseline (capture r181 numbers from the pre-bump state via git), and the
> renderAsync→render() cleanup (pre-existing warnings, 9 sites). 
>
> **Phase 2 capture matrix — first full pass DONE (2026-08-20, real game, serial theme
> switches = SB-15 soak):** stellar-drift / winter / ocean / koi-pond / golden-forest /
> lunara / crystal-cave + **Odyssey mode** all boot and render on r185 with zero console
> errors (`cap-*.png`). Verified in vivo: MRT additive bloom accumulates (stellar-drift
> nebulae, winter aurora+moon), ocean's coral tints (vec4 vBatchColor) + placement
> (collapse fix), koi-pond's viewportDepthTexture route, golden-forest incl. the §6
> loud-magenta-backdrop test (**zero bleed-through — its alpha exposure is not real in
> practice**; the intro-webgpu surface remains the only live §6 item), and the entire
> Odyssey warm architecture (all four targeted prewarms + compile pool + warm replay) —
> after the capture caught, and we fixed, the NEW upstream compileAsync-Group bug (§10
> last row; pinned by the contract test). Notes for later: stellar-drift's black
> asteroid silhouettes + its 5 "uv not found" warns (compare against pre-upgrade
> footage), crystal-cave's Water-plane look-delta needs a targeted angle, `RGBELoader`
> deprecated → `HDRLoader` (done next day, see below). Boot/console coverage of every
> remaining theme came from the Electron matrix below; still open as LOOK work (not
> correctness): shadows retune pass (neon-district/golden-forest bias), PBR drift
> close-reads, WebGL-fallback lanes, crystal-cave water angle.
>
> **Electron theme matrix — 61/61 GREEN on r185 (2026-08-21, `capture:themes`: production
> build, one fresh Electron process per theme, real GPU).** First pass: 60/61 — black-hole
> failed on 2 console errors, which exposed upstream bug #2 (§10 last row: dispose races
> in-flight timestamp resolves); fixed in `BaseTheme.disposeRenderer` + contract test, black-
> hole re-captured at 0 errors. The refreshed `docs/theme-screenshots/` (61 PNGs + per-theme
> `results/*.json`) is the **new r185 visual baseline**; the 5 previously committed captures
> were different-era theme builds (composition/resolution/menu state) so they are NOT an
> upgrade A/B — except `sky-children-v2`, **byte-identical** across the upgrade. Stellar-drift
> closed: black asteroid silhouettes are intended and present in the r181 capture; the 5 "uv
> not found" warnings were pre-existing (identical r181 AttributeNode behavior) — silenced by
> giving the three uv-less `Points` geometries a centre uv, which also makes those particle
> layers (dust ring, ambient motes, nebula bursts) **visible for the first time on WebGPU**
> (they had been masked to opacity 0 in both versions; subtle additive dots — look-call
> note, revert to uv (0,0) if pixel-parity with old footage is preferred). Cleanups landed:
> `RGBELoader`→`HDRLoader` (lunara-assets + summer-meadow effect; r185's RGBELoader is
> literally a warning shim over HDRLoader), deprecated `renderAsync()` retired at all 6
> three-facing sites with per-site `renderer.init()` ordering proofs (repo-local forwarders
> kept). Full suite 362 files / 3,636 tests green. The SwiftShader `validate:odyssey:webgpu`
> pilot lane is **environment-blocked on the 82JU**: 0/11 scenes, every one "backend did
> not initialize as WebGPU (got WebGL2 fallback)" behind Chromium's `Failed to query
> ID3D11Device from ANGLE` — Electron 38's software-WebGPU path never yields a device
> here, so the lane cannot reach three's code; not an r185 signal. Needs a machine where
> SwiftShader WebGPU works, or a real-GPU variant of the lane (the theme harness shape).
>
> **Phase 3 perf re-baseline — DONE (2026-08-21), the first numbers on the current machine.**
> An r181 worktree at `b6f46ffb` (own `npm ci`, three 0.181.2) and the r185 tree were run
> through the identical perf-session instrument, 3 repeats per cell, **draw calls identical
> in every cell** (ADR-0016 content match). Full report + raw sessions:
> `reports/odyssey-perf/rtx3070-r181-vs-r185/AGGREGATE.md`. Verdict, graded against §2's
> predictions: **load-phase freezes collapse** (frame p95 −73 %/−75 %, p99 −62 %/−86 %, worst
> warm-load frame 3.6 s → 1.7 s, long-task time −12 %/−46 %) — the r184 non-blocking
> compileAsync cashing out; **startup wall-clock slightly longer** (cold 7.0 → 8.1 s, warm
> 4.9 → 5.2 s) because the yielded compile barrier now absorbs work r181 did synchronously in
> `creates`/`post` (a bucket shift, documented — the "+189 % compiles" is not a regression);
> **idle steady-state flat on average** (p50/p95/p99 within 2–3 %, overlapping ranges) with
> **−63 % spikes** and −18 % long-task time; **JS heap −6…−9 %** everywhere. Exactly "no
> higher frame rate, less stutter, smoother load". Harness finding on the way: the committed
> `--runs N` flow cannot run on the 82JU (second WebGPU window per Electron process aborts,
> identical on r181) — replaced by a process-per-run driver kept in the report folder.
> `perf-budgets.json` values intentionally untouched (RTX 5080 targets; re-targeting for the
> 3070 is a policy call) — its `machine` note now points at the new capture. **GPU time
> (lane A timestamp lane, 23 configurations, both trees):** draw calls AND triangles identical
> in every configuration; GPU p50 same 65.536 µs bucket in 12/23, r185 one tick lower in 9,
> one tick higher in 1; baseline p50 identical (0.655 ms), p95 equal-or-better nearly
> everywhere (legacy-dioramas 4.19 → 1.51 ms), drift ≤ 1 tick — **unchanged within
> quantization**, as §7.5 predicted for fill-bound surfaces. Both lanes now prove the perf
> story on the current hardware, which closes the plan's last phase.
>
> **WebGL-fallback lane smoke (2026-08-21, `?forceWebGL`, real game):** black-hole, summer,
> moonlit-forest, bioluminescence-2 run clean on the WebGL2 backend (node materials through
> the GLSL builder, 0 errors); starlight ignores the page flag (its `forceWebGL` is an
> internal retry order — fine). **neon-district rendered BLACK** on that lane — pre-existing
> on r181 (identical NodeBuilder rejection at r181 NodeBuilder.js:2890): the theme always
> constructs a `WebGPURenderer`, yet gated ~25 material/post choices on the *backend*
> (`isWebGPU`), sending every non-WebGPU machine into classic `ShaderMaterial`/`EffectComposer`
> branches the node system rejects. Fixed by re-gating those choices on renderer kind
> (`usesNodeMaterials = renderer.isWebGPURenderer`) while MRT, timestamps and lighting
> calibration stay backend-gated; WebGL2 lane now renders the full theme with 0 errors
> (`cap-neon-district-forceWebGL-fixed.png`), WebGPU lane unchanged. Classic-only twins are
> retained but unreachable. r186 still unpublished as of 2026-08-21. Upstream issue drafts for
> the two r185 bugs: `docs/UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md`.
>
> **Follow-up round (2026-08-21, owner: "fix all five, no merge yet"):** (1) Look-calls
> decided and recorded in code — moonshafts ship OPT-IN (stillwater-runtime gate comment),
> stellar-drift particle layers stay VISIBLE (stellar-drift-theme uv comment). (2) **Perf
> budgets re-targeted to the 82JU from drift-checked pairs**: Lane A World 0.655 ms / 61
> draws, ch6 (p=0.73) 0.59 / 58, Act I ch1 (p=0.051) 1.507 / 104 — new station reports
> `gpu-split-lanea-rtx3070-r185-{ch6-p073,act1-p0051}.json`; three contradicting `max`
> values re-targeted with the same intent (Act I 1.0→1.8, its draw max 35→120, World
> 1.5→1.2 restoring the dioramas-revert tripwire); `frameP95Ms.perSurface.odyssey` 7→15
> (measured idle p95 14.0 + headroom); Stillwater's 6.0 calibration and every Lane B cell
> kept as LEDGER values (tests guard that history; no gate consumes them). Gate PASS.
> (3) Upstream issues: drafts ready; filing needs a signed-in GitHub session (the
> automation browser has none). (4) Cheap wins landed: **SharpenNode (RCAS)** on the Odyssey
> output, ramped 0→0.35 from render scale 0.95→0.65, `?odysseySharpen=0` opt-out, verified
> in-game at the 0.65 floor (engages, toggles both ways, zero validation errors, no
> ringing/speckle; a pale A/B frame turned out to be Earth Core's own progression, not the
> pipeline); **r185 byte-level `Info.memory`** recorded in the perf session, playground
> snapshot and debug overlay, with `gpuMemoryTotalMB` / `gpuMemoryScenarioGrowthMB` budget
> rows (null baselines, compare-tool rows + self-test). (5) **r186 pre-positioned**:
> `GoldenForestWater`/`MistyLakeWater` dispose chain to a future base `dispose()`,
> `PCFSoftShadowMap`→`PCFShadowMap` at both WebGPU sites (Vogel-disk PCF; neon-district +
> golden-forest re-captured clean, no acne/peter-panning), `Source`/`shadow.radius` confirmed
> zero usage. Full suite 363 files / 3,643 tests green.

### Phase 0 — pre-bump, dual-compatible, land on main now (keeps r181 green)

1. `atan2`→`atan` ×6 (coordinate `aurora-volume.js` with the winter branch) — also
   pre-clears the only r185 typecheck failure. `.equals`→`.equal` ×1.
2. Timestamp feature-detect (`hasTimestampQuery ?? hasTimestamp`, guard
   `typeof === 'function'`) in black-hole + stellar-velocity; extend the
   black-hole-lifecycle mock.
3. **positionNode portability sweep** (§4 idiom — pixel-identical no-ops on r181):
   masks/pivots to `positionGeometry` (`vegetationSwayNode`, `floraSwayNodeShared`,
   koi-pond, golden-forest, framing-spruces, sky-birds, summer-meadow/trees,
   bioluminescence-2, ocean fish/reef), coral-overgrowth base to `positionLocal`,
   LevelNodeManager hide-strategy change, folklore comment rewrites + the four test-pin
   updates.
4. Optional: `Clock`→`Timer` sweep (60 sites) to pre-silence upgrade console noise.

### Phase 1 — the bump (one commit, one revert)

- `package.json`: `"three": "0.185.1"` **exact pin** (no caret — 0.185.0 is the broken
  one and 0.x caret semantics are a trap); regenerate `package-lock.json`
  (CI runs `npm ci`).
- Warm-up rework (§3): startup hold-across-await; retire background `compileAsync` in
  favor of render-warm; `frustumCulled=false` during prewarm; ban-text/line-number
  updates; bound `effect-prewarm`'s race.
- MRT emissive blend helper at all `setMRT` sites + the `merge()` patch (§5).
- Stillwater `_quad`→`_quadCache` remap + `_quadCache` reset surgery (§7.3).
- `vBatchColor` vec4 fix (§7.7). Koi-pond `viewportDepthTexture` API move (§7.12).
- Retire `bloom-dispose` helper (slim to node-severing) + its contract test; fix the
  stillwater dispose-contract test (path + device-destroy pin).
- Knowledge-base re-stamp (§7.6) — same commit, so no future agent reads r181 teachings
  against r185.
- Gates: `npm run typecheck` green, `npm test` green, build green, playground boots.

### Phase 2 — validation matrix (surface × backend × machine)

Smoke first: `compatibilityMode===false` + MSAA alive (§8.6); boot-warp teardown order
(§8.7); one `odyssey-gpu-split --lane A` run confirming draw-count parity at a pinned
station (the content-match guard voids pairs if r185 changed pass splitting);
playground `?profile=1&trackTimestamp=1` returns render+compute available; per-pass HUDs
populate after the rename fix; `?shafts=1` acceptance (§11.1); winter-wonderland paw
trails (§8.8); `?forceWebGL=1` on neon-district (pre-existing UNCLEAR branch — verify on
r181 first).

Then captures, one small effect per session on TDR-prone hardware per ADR-0007, bulk on
the strongest available GPU: MRT HIGH themes (§5 list) with bloom A/B; the two
premultiplied-alpha surfaces with the loud-backdrop protocol (§6); positionNode fix sites
(§4 classes 1–4); Water themes ×3 (§8.2); WebGL bloom pass (§8.3); shadows ×2 + PBR trio
(§8.4–8.5); viewportTexture themes (§8.1); both backends for one capability-gated MRT
theme. Treat old playground baselines of `scene.background=null` effects as invalid.

Also verify the **fragment-stage `positionLocal` reads** the implementation agents flagged
(the §4 audit covered the vertex path; these read the varying, which is post-instance on
r185): koi-pond canopy crown gradients (`koi-pond-forest.js:195,:245` colorNode masks),
the level-node AAA shell's `varying(positionLocal)` noise + styles 6/7 post-instance
scale (`level-node-manager.tsl.js:114,:130+` — opt-in `?odysseyAAA=1` surface), and
golden-forest windPhase reads on cloned plain meshes (verified safe — no instance node —
but on the same screenshot pass).

### Phase 3 — perf re-baseline (ADR-0016 discipline)

Committed baselines are from dead hardware; **capture fresh r181 baselines on the 82JU
first** (else the r185 delta is unattributable), then re-run identical stations on r185:
theme-switch p95, odyssey warm/compile wall-time (expect longer barriers per §3-A6 —
decide budgets accordingly), steady-state hitch counts (the GC-reduction claim is the one
most worth testing), `info.memory.total` across switch cycles. Update
`perf-budgets.json` + r181-labeled prose **in the same PR** so the gate never compares
across versions; a cell without a clean measurement carries a null baseline, not a guess.
Mind #34241 (clear the timestamps map during long captures).

### Phase 4 — post-bump, separate commits

`PostProcessing`→`RenderPipeline` rename (+6 test pins + chiral-gold probe + skill
examples); opportunity ladder items 3–9 (§11); Electron bump decision stays **decoupled**
(Chromium 140 is sufficient for everything here; TRANSIENT_ATTACHMENT-class wins remain
gated on a future Electron).

---

## 13. Rollback & r186 watch

- Rollback = revert the Phase 1 commit (`package.json` + lockfile + with-bump code ride
  together; Phase 0 items are r181-compatible and stay). The `three` Vite manualChunk
  isolates the library for clean A/B builds.
- **r186 (imminent):** when it ships, verify the release notes contain #34186 (screenDPR),
  #34243 (timestamps map), #34151 (ImageBitmapLoader), #33987 (**PCFSoftShadowMap removed
  on WebGPU** — swap our 2 sites then), #34141 (**`Object3D.dispose()`** — add
  `super.dispose()` to `GoldenForestWater.dispose`; fix `MistyLakeWater`'s
  constructor-assigned `scope.dispose` shadowing the new base method), #33978 watch
  (`radius`→`softness`, still open), `Source`→`TextureSource` (zero usage), plus the
  leak batch (#33954/#34014/#34108/#34139/#34188/#33998) and `compileComputeAsync`
  (#32551 — 111 `.compute(` sites currently have no prewarm path). Take it as a normal
  minor upgrade **from r185** on our schedule — the whole point of landing 0.185.1 now is
  that r186 becomes a small delta instead of a five-release cliff.

## 14. Primary sources

- Migration guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide (r181→r186
  sections; note §1/§9 items verified **absent** from it — the guide is not a complete
  change inventory; source-diff findings govern)
- Releases: https://github.com/mrdoob/three.js/releases/tag/r182 … /r185; r186 milestone
  https://github.com/mrdoob/three.js/milestone/99 (61 open / 408 closed, overdue,
  2026-08-20)
- Key issues/PRs: #33120 (3× compile), #32984 (non-blocking compileAsync), #33797 (r185
  CPU audit batch), #32675 (r176+ regression ladder — no direct r181↔r185 A/B exists),
  #33821 (material-init gap, open), #32265 (MRT blend), #33369/#33457 (compositor
  contract), #33889 (0.185.1 InstancedMesh fix — verified in tarball), #33746
  (updateWorldMatrix), #34184/#34241/#34301/#34280/#33795 (carried issues), #33534
  (PCFSoft gather rewrite), #32953-era volumetric guard (moonshafts unblock)
- Local verification artifacts (session scratchpad, 2026-08-20): extracted
  `three-0.185.1` tarball; `gen-wgsl.mjs` ordering harness + outputs; 18 agent reports
  with full file:line receipts
- Dependabot branch `origin/dependabot/npm_and_yarn/three-0.185.1` (`8129a44b`): still
  stale/never-built — supersede it with this plan's Phase 1 commit and close it citing
  this doc
