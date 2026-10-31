# Three.js r186 to r187 upgrade

**Status: Phase 0 and Phase 1 on branch `perf/three-r187`; Phase 2 look sweep, full-speed A/B and the
final candidate's checks done (2026-10-31, below); merge waits for the owner. Not merged.** Started
2026-10-30 from `c52f42b0`, the day 0.187.0 was published,
following [ADR-0018](adr/0018-three-js-pinning-and-upgrade-protocol.md). Merging waits for the
Phase 2 evidence and the owner's approval of every look change; 0.187.1 (if it ships soon) should be
audited as a patch on top before the merge.

**Why upgrade:** the fleet pass (docs/THEME_FLEET_240_2026-10.md) left first-visit freezes that are
three's own node builds and pipeline compiles (Rainbark, Neon District, Solar Eclipse, Star Cradle,
Stillwater). r187 targets exactly those: TSL node builds −28–34 % CPU (#34815), node builds shared
across call depths (#35014: r186 rebuilt a compileAsync build synchronously when a pass met it at
another depth), PassNode.compileAsync with the render's sample count and size (#35168: our 4× MSAA
passes), and up to 16 pipelines compiled in parallel by compileAsync (#34816). These are claims from
upstream; the gain here is measured in Phase 2 or not claimed.

## Target and evidence

- Tarball: `https://registry.npmjs.org/three/-/three-0.187.0.tgz`
- SHA-1: `face29ee2de9bcc31a1b573a76f224e35e0b2894`
- Integrity: `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==`
- Published 2026-10-30 08:09 UTC. [Release notes](https://github.com/mrdoob/three.js/releases/tag/r187),
  [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#186--187): discovery aids
  only; every finding below is from the installed 0.187.0 `src/` and `build/`.
- Worktree `serenity-blocks-r187` has its **own** `node_modules` (`npm ci --ignore-scripts`, then
  `npm install three@0.187.0 --save-exact --ignore-scripts`): the other worktrees share the main
  checkout's through a junction and must not see r187. The lockfile changes only `three`.
- 323 files under `src/` changed between 0.186.1 and 0.187.0. New: `StandardDrawingPipeline.js`,
  `NodeMaterialInstance.js`, `ReferenceAttributeNode.js`, `BRDF_EON.js`; removed:
  `cube_uv_reflection_fragment.glsl.js`. `build/three.webgpu.js` now imports the node system,
  `QuadMesh` and `CubeRenderTarget` from `build/three.tsl.js`.

## Source audit and migration actions

| Area | Verified r187 behaviour | Repository action |
|---|---|---|
| Build budget lookup | `RenderObjects.get` files a render object drawn by an override pass (`scene.overrideMaterial`, the shadow pass; `Renderer.renderObject` sets `_currentSourceMaterial`) under **five** keys, the source material fifth. `ChainMap` keeps each key length in its own map. | The budget's four-key lookup never found such an object: every built shadow draw read as new on every frame, and once real builds had spent a frame's budget the casters after them were skipped (shadows missing in a hidden switch) and the session never read quiet. `chainKeysOf()` adds the fifth key. Phase 0; new test fails without it. |
| compileAsync drain | Each queued item carries its own `precompilationState` (queue-time target + MRT, `useFrameBufferTarget: true`). The drain runs it between `_beginPreCompile` (binds them) and `_finishPreCompile`, which binds `outputRenderTarget` / `outputMRT`: the binding of the moment compileAsync was **called**. | A caller that binds a target for the launch only (Spring's impostor atlas; Odyssey's and the breathing worlds' live-loop compile) got it bound again after every drained item, so the next frame drew into the atlas or into the post scene pass's target (the 2026-08-12 device loss). New `src/rendering/three-precompile-live-restore.js` makes `_finishPreCompile` put back what was bound when the matching `_beginPreCompile` ran; Spring and both Odyssey compile entry points install it. Upstream issue candidate. |
| Odyssey live-compile reads (item 2.11) | Upstream still holds the target across the await (`PassNode.compileAsync`), so drained builds read the live target: the instance accessors remain needed. | The accessors drop writes made inside three's precompile hooks (else the hooks leave the scene pass in the backing the live frames render with). Test: an r187-shaped drain with frames between and inside items. |
| Odyssey side capture | `_createObjectPipeline` queues `side: material.side`; `_beginPreCompile` applies it (#35016). | Our replacement queued items without `precompilationState`, which the drain reads first (a TypeError on every compile). The capture now stands aside when `_beginPreCompile` exists. |
| Odyssey call depth | `RenderContexts.get(renderTarget, mrt, callDepth, camera)` adds the camera type to the key (#35123). compileAsync resolves its context after `_beginPreCompile` raised `_callDepth` from -1 to 0. Node builds are keyed by the depth-free `context.stateKey` (#35014). | The depth patch passes the extra arguments through (an orthographic post quad must not resolve the perspective context). It still maps 0 → 1, so warm render objects and bindings are the live scene pass's; the builds would be shared anyway now. |
| Async render pipelines | The live path, cache-before-create, readiness gate and draw-error guard are unchanged; line numbers moved. The validation scope is now popped **before** the async compile is awaited (#34816), so other GPU work can no longer land in it. PMREM targets are `CubeRenderTarget`s; `CubeUVReflectionMapping` is gone. | Contract restamped to 0.187.0 against `src/` and both shipped build files. The 306-mapping check is removed (cube targets and `isPMREMTexture` cover r187's PMREMs). The scope repair in `track()` is kept: harmless, and it should no longer fire. |
| Native compute | `compileComputeAsync` builds nodes with yields (`getForComputeAsync(node, yieldCompile)`) and keeps up to 16 pipelines compiling; it resolves after all settle. Live `compute()` still creates synchronously and `WebGPUBackend.compute` still calls `setPipeline` unguarded. `compute()` starts the internal animation loop. | Guards unchanged. Contract renamed `three-r187-compute-pipeline-contract` and restamped; the behaviour harness gains an animation-loop stand-in. |
| PMREM warm (Chiral Gold) | The PMREM is rebuilt from cube targets: an equirect pass into a source cube, then GGX (sharp levels) and integration (3 rough levels) passes into the PMREM, all through `_renderCube(target, lod, material)` with the generator's box mesh and cube camera. Material uniforms are module-private. | `shared/pmrem-warm.js` rewritten: it runs the conversion with `_renderCube` recording instead of drawing, then compiles each (target, material) pair once. Whether it still pays on r187 is measured in Phase 2 (drop it if not). |
| TSL test doubles | `NodeBuilder._getBindGroup` reads `renderer._bindings.getSharedBindGroup` whenever `_bindings !== undefined`; a device-less `WebGPURenderer` has `null` there. Generated names: cached values are `nodeConstN` locals; uniform arrays are `nodeUniformN.value[i]` (WGSL) / `nodeUniformN[i]` (GLSL). | Six shader-build harnesses get a pass-through Bindings stand-in; the Stellar Velocity and chapter 7 tests accept both versions' names. All their shader assertions are unchanged and pass: those materials build cleanly on r187. |
| Migration-guide items | Struct storage always arrays; `pixelationPass` Number size; `registerNode` lights; `getProjectionDepth` → `projectionDepth`; `iridescenceThicknessRange` deprecated. TSL `range()` randomness changed. | Searched: no uses in the game (one playground effect sets `iridescenceThicknessRange`; it still works). No TSL `range()` in the repo (the hits are our own JS helpers). |
| Look changes to review | ACES Filmic fit denominator fixed (#35110); PMREM quality and roughness ramp (#34585, #34645); PCF radius for non-square shadow maps (#35018); TSL type promotion (#33695). | ACES: Black Hole, Fall, Forest, Golden Forest, Murmuration, Sakura Twilight, Summer, Verdant Hills, Wolfhour and the boot warp (Odyssey uses no tone mapping, the breathing worlds Neutral). PMREM: Chiral Gold only. Non-square shadow maps with three's filter: Summer, Forest, Sakura Twilight (Fall and Golden Forest use their own filter). Every surface is captured anyway: generated code changed everywhere. |
| Notices | No new third-party code reaches our bundle (r187 adds `libs/mikktspace.module.js`, which nothing we import loads). | `THIRD_PARTY_NOTICES.md` names r187. |

## Phase 0 (on r186): `fe9f23d6`

Build-budget key, precompile restore shim, Odyssey hook guards, test doubles. Full suite on 0.186.1
(the `serenity-blocks-perf240` worktree, which uses the main checkout's r186 `node_modules`):
**1,270 files passed, 4 failed**: the known local failures only (three sv-SE number-format tests,
tts-recorder symlink EPERM; see the memory note "Local suite known failures").

## Phase 1 (the bump commit)

`package.json` + lockfile (`three` only), contract restamps (render pipelines, compute, Odyssey
warm-up), the r187 PMREM warm, the removed CubeUV check, notices, and both copies of the
`webgpu-threejs-tsl` skill restamped to r187 with an "r187 compile, override passes and generated
code" section.

Validation on 0.187.0 (this machine, 2026-10-30):
- Full suite: **1,270 files passed, 4 failed** (23,645 tests passed): the same four known local
  failures as on r186, nothing else.
- `npm run typecheck`, `npm run build` + boot closure (entry 12 KB, main 1,270 KB; the `three` chunk
  1,674 kB), `lint:ci` at its 512-error baseline, architecture fitness, TS ratchet (the shim locked
  in), theme lifecycle audit, import boundaries, IP strings, Pages artifact, release gates,
  `perf:budgets:gate` and the production dependency audit: all pass.
- Playground smoke on the RTX, both versions served side by side (r186 = Phase 0 on 0.186.1):
  `pulse-sphere` identical to within one stray pixel; Chiral Gold renders cleanly with the r187
  PMREM, 9.6 % of pixels more than 8 levels apart (max 55): the expected reflection change.
  Zero console errors on either.

## Phase 2: look sweep (done 2026-10-30)

The owner approved minor look changes for this upgrade ("I am okey with minor changes of the look
of the themes"); anything that changes a theme's character is still to be raised.

Every theme (63 playground effects) and all 12 breathing worlds, r186 (Phase 0 on 0.186.1) and r187
served side by side, same fixed time, 2562×1601, RTX; then the changed ones again at 30 fps with a
second r186 capture as the noise floor. Zero console errors on either version.

- **Identical** (no pixel more than 2 levels apart): 56 themes and all 12 breathing worlds.
- **Spring drew a navy canvas on r187: fixed (1d9660d4).** r187's compileAsync begins the first
  drained item inside the call, before Spring's bake puts its own binding back; the precompile shim
  restored the impostor atlas after it and every frame drew into the atlas. The shim now keeps a
  binding the caller chose while the item ran. Spring on r187 then matches r186 to 1 level and
  builds its world in 2.7 s against 4.9 s.
- **Summer, Forest, Sakura Twilight grew a diamond screen-door grain on the lit leaves: fixed
  (721ff57d).** r187's PCF fix for non-square shadow maps (#35018) doubled the height of the noise-
  turned sampling disc on their 2:1 maps. `shared/width-pcf-shadow-filter.js` keeps r186's filter
  for them; they now match r186 to 1-9 levels, none more than 8 apart.
- **Chiral Gold: the one look change kept.** r187's PMREM makes the gold ribbons' reflections a
  little darker and softer (10 % of pixels more than 8 levels apart, max 65): the same scene, a
  slightly duller sheen. Within the owner's "minor".
- Sunfall's vine leaves differed as much between two r186 captures as against r187 (0.60 % vs
  0.68 %): the leaves sprout from simulated events, not an r187 change. Grainfields: a few pixels on
  a horse.
- The ACES fit fix (#35110) moves nothing visible: the ACES-toned themes match to a few levels.

**Light re-sweep with both fixes in (2026-10-30, the owner's "light GPU" mode: playground
`maxFps=30`, capture scale 1, RTX at about 50 °C / 13 W):** 125 surfaces on both versions: the 63
themes, the 12 breathing worlds and every other playground effect (50: the Odyssey chapter pieces
from the earth core to chapter 8, the one-world Act II, intro "First Light" (`intro-world`), the
opening aurora, the logo warp, Infinity's ascent sky, the charm icons). Zero console errors, every
page ready.
- Identical: 60 themes, all 12 breathing worlds, 48 of the 50 other effects.
- Chiral Gold: the reflection change above. Sunfall and `act2-tree-audition`: differ as much between
  two r186 captures (noise from simulated events). Grainfields: a few pixels.
- `earth-core-lake`: only its default `variant=split` view differs (3.6 % of pixels): it picks the
  analytic or the baked lake noise per pixel by `select(positionLocal.x < split, …)` in the fragment
  stage, and r187 evaluates that split differently. Both real paths (`variant=analytic`,
  `variant=baked`) are identical on r187, and the game builds the lake with one of them
  (`noise: 'analytic'` / the baked texture, earth-core.js), never the split: a playground comparison
  view only.

**Real game, every theme (2026-10-30, light):** the fleet bench on the r187 harness build (both fixes
in) with the game's own cap, `--target-fps=30 --scale=1 --vsync=1`: per theme a fresh Electron boots
the app, starts Single Player, loads the theme cold, switches to the anchor and back (the in-play
switch: async pipelines and the build budget live), and plays two gameplay storms. **63 of 63: no
error, both loads complete, and no console warning or error** other than Chromium's
`powerPreference is ignored on Windows` notice (on r186 too). GPU about 50 °C, 5-30 W. Not a
performance reading (capped, one sample).

**Real game, Odyssey: a third r187 break, found and fixed.** `scripts/odyssey-feel-probe.mjs`
(`--fps=30 --quality=High`, fresh profile = cold shader cache, dev servers of both trees): start,
idle, travel, an orb, a chapter jump. On r187 every Odyssey prewarm threw "Cannot destructure property
'useFrameBufferTarget' of 'this._precompilationState' as it is null", and after the start the
board's canvas presented nothing. **r187's compileAsync is not re-entrant per renderer:** one
`_precompilationState` is set while a call drains its queue and the drain awaits with it set, so a
second call draining at the same time finishes the first's items and leaves the renderer half
switched. Odyssey ran up to six calls at once (the r185 fan-out for overlapping pipeline compiles)
and several groups at once. Fix (`post-target-compile.js`): on r187 a group is ONE compileAsync
(r187 compiles its pipelines 16 at a time itself), its hidden containers shown for the prologue
(the per-object calls compiled every visible renderable whatever its containers); a pseudo-group or
a group holding a visible light keeps one call per object; every call on a renderer takes its turn
(`takeCompileTurn`). Upstream issue candidate.

| Odyssey, real game, cold cache, 30 fps | r186 | r187 before | r187 fixed |
|---|---:|---:|---:|
| Console errors | 0 | 15 | 0 |
| Sync pipeline creations at the start | 11 | 37 | 11 |
| Pipelines created during travel | 4 | 108 | 1 |
| Worst frame at the start | 191 ms | 1,072 ms | 239 ms |
| Board active after | 2.2 s | 2.9 s | 3.4 s |
| Map presents after the start | yes | no | yes |

Open: the board comes up about a second later on r187 (one cold-cache sample at a 30 fps cap): the
compiles that overlapped now take turns. To measure at full speed and, if it holds, to win back
(a drain-only turn, or one call over several groups).

**Real game, boot:** `scripts/boot-smoothness-probe.mjs` (studio ident, intro "First Light", boot warp
into the menu), both versions: same timeline (shell dismissed 15.0 s, warp handoff 27.4 s), 6 sync
pipelines each, no console problem; the boot's longest main-thread frame 1,021 ms on r187 against
1,385 ms on r186 (blocking 327 against 742 ms).

**Real game, breathing:** `scripts/breathing-stage-change-probe.mjs` (Low tier: the stage's own 30 fps
cap), Hale First Breath and Base, built ahead as shipped, both versions: all 8 stage changes adopt the
world built ahead and are back in 434-446 ms on both; no sync pipeline at any change on r187 (r186
made 12 at one).

## Phase 2: full-speed A/B (night of 2026-10-30 → 31)

Same machine, Balanced mode (GPU limit 95 W) for the whole night, harness builds served by
`vite preview`: r186 = Phase 0 on 0.186.1 (`fe9f23d6`), r187 = `c2220980`. Fleet bench at the panel's
cadence (`--vsync=1 --target-fps=240`, `ab-load.sh`): per theme a cold switch from the anchor, a warm
switch back to it, two 2 s gameplay storms; arms interleaved, two rounds each (means of 2).

**Theme switches, 20 themes (the worst freezes plus a spread):**

| Median over 20 themes | r186 | r187 |
|---|---:|---:|
| First visit: switch to shown | 930 ms | 795 ms (−15 %) |
| Return visit: switch to shown | 628 ms | 497 ms (−21 %) |
| Longest frame in a first-visit switch | 71 ms | 70 ms |
| Longest frame in a return-visit switch | 58 ms | 39 ms (−33 %) |
| Storm frame p99 / storm long tasks | 6.6 ms / 0 | 6.7 ms / 0 |

Largest gains: Rainbark first-visit freeze 126 → 77 ms and return switch 1,036 → 514 ms; Solar Eclipse
freezes 87 → 51 / 67 → 21 ms; Neon Quarter return freeze 82 → 34 ms; Spring first visit 2,190 →
1,492 ms; Stellar Drift 70 → 48 / 52 → 23 ms. Worse: High Coast first-visit freeze 71 → 83 ms (its own
build steps, a timer task), Rainbark first visit shown 1,662 → 1,805 ms. Storms: equal.

**Odyssey, built game, the owner's settings (`--fps=144 --quality=Extreme`), cold (fresh profile) and
warm (same profile), two rounds:** 0 errors on both; sync pipelines at the start 11 on both; worst frame
just after the reveal 96-104 ms on r186, 17-46 ms on r187; start p99 18-39 → 12-22 ms. Board active
after: warm 1,119-1,121 → 1,063-1,080 ms, but **cold 1,781-1,893 → 2,612-2,649 ms**: the compiles
that overlapped on r186 took turns, each waiting for the previous one's GPU work.

**Fixed (`df5ff946`): a turn ends with its call's drain, not its GPU work.** `watchCompileDrain` counts
the objects a compileAsync queues and the pipelines its drain requests; after the last item's final
`_finishPreCompile` three only awaits the pipelines and never touches `_precompilationState`, so the
next call drains while they compile. Same A/B, r187 → r187 with drain turns:

| Odyssey, Extreme, 144 fps cap | r186 | r187 (turns per call) | r187 (turns per drain) |
|---|---:|---:|---:|
| Board active, cold cache | 1,781 / 1,893 ms | 2,577 / 2,619 ms | **1,699 / 1,713 ms** |
| Board active, warm cache | 1,121 / 1,119 ms | 1,083 / 1,054 ms | **990 / 1,001 ms** |
| Worst frame after the reveal | 96-104 ms | 40-45 ms | 49-51 ms |
| Errors / sync pipelines at the start | 0 / 11 | 0 / 11 | 0 / 11 |

**Using r187 for switch freezes: sliced builds.** After r187 the worst first-visit freezes were frames
built around one large material: the build budget defers builds past a frame's share, but a task's
first build always runs whole inside the frame that meets it. r187 builds a render object's nodes
asynchronously, yielding after each shader stage of each build stage
(`NodeManager.getForRender(renderObject, yieldFn)` → `NodeBuilder.buildAsync`). With `sliceBuilds`
(the in-play switch's hidden build only; rollback `?switchSlicedBuilds=0`) the budget wrapper never
builds a new render object inside a frame: the draw creates the render object (cache keys only),
queues it and is skipped like a deferred build; a queue builds it between frames, a stage at a time,
with the render state it was met under (target, cube face, mip level, MRT, context node, render
context, tone mapping, colour space) applied for each slice and the live state put back before each
yield; built objects get their first draw a few per frame (`SLICED_FIRST_DRAWS_PER_TASK`). The first
version let every finished object draw at once: Forest's texture uploads and mip generation then
stalled the GPU process for 150 ms (its first-visit freeze 42 → 153 ms). With two first draws a frame,
12 worst themes, r187 → r187 + sliced, two rounds: median first-visit freeze 78 → 66 ms, return 51 → 48;
Rainbark 88/50 → 66/20 ms, Star Cradle 83/65 → 52/48, Solar Eclipse 51/20 → 33/12, Thermal Bloom
87/63 → 66/51, Neon Quarter 78 → 67, Murmuration 94/51 → 84/42; Forest 49 → 59 ms; return switches
until shown 520 → 642 ms (the held first draws). Shipped at four a frame with the mipmap warm below.

**The only synchronous pipelines of a theme switch: three's mipmap pipelines.** Every synchronous
pipeline the 40 first-visit switches above created was `mipmap-<format>-2d-array` (rgba8unorm ×26,
rgba16float ×6, rgba8unorm-srgb ×4, r8unorm ×2): `WebGPUTexturePassUtils.getTransferPipeline` creates
them with the synchronous `createRenderPipeline` when a texture of that format first needs mips, and
every theme starts on a fresh GPUDevice. In 11 of the 40 the switch's worst frame began at one (Blood
Moon 79-84 ms, Neon Quarter 80-82, Verdant Hills 78, Grainfields 55-60, Solar Eclipse 50-52, Ice Temple
35-39): the GPU process compiling on the thread that also draws the display, the "GPU-process task" of
Blood Moon's freeze the fleet pass could not place. `src/rendering/mipmap-pipeline-warm.js` creates the
same four pipelines with `createRenderPipelineAsync` right after a renderer's `init()` (BaseTheme, the
Odyssey board) and puts each into three's own cache unless three made one first (rollback
`?mipmapPipelineWarm=0`; contract-tested against the installed three).

## Phase 2: the final candidate (`a9e52dd7`, measured 2026-10-31)

Same machine and mode as above, full speed. r187 = `c2220980`, final = `a9e52dd7` (drain turns, sliced
builds at four first draws a frame, mipmap warm).

**Theme switches, the same 20 themes, r187 → final, two rounds each:**

| Median over 20 themes | r187 | final |
|---|---:|---:|
| Synchronous pipelines in a first-visit switch | 1 (up to 4) | **0 on all 20** |
| Longest frame in a first-visit switch | 68 ms | **61 ms** |
| Longest frame in a return-visit switch | 38 ms | **29 ms** |
| First visit: switch to shown | 795 ms | 813 ms (+2 %) |
| Return visit: switch to shown | 491 ms | 501 ms |
| Storm frame p99 / storm long tasks | 6.7 ms / 0 | 6.7 ms / 0 |

First-visit / return freezes, r187 → final: Solar Eclipse 51/19 → 20/12 ms, Starlight 46 → 23, Ice Temple
45/18 → 28/14, Aurora 41 → 26, Blood Moon 79 → 57, Rainbark 89/56 → 67/29, Sunfall 52/38 → 40/26,
Murmuration 98 → 81, Star Cradle 69/63 → 61/53. Worse: **Forest 47/17 → 67/28 ms** (below, fixed), High
Coast 79 → 84, Chiral Gold 41 → 45. Against r186 (table above) the first-visit median is 71 → 61 ms and
the return median 58 → 29 ms.

**Odyssey, final vs drain turns (`df5ff946`), Extreme, 144 fps cap, two rounds:** 0 errors on both. Board
active cold 1,757 / 1,657 ms (drain turns 1,714 / 1,738), warm 1,001 / 950 ms (992 / 973). Synchronous
pipelines at the start 11 → 9: the two mipmap pipelines are gone; the nine left are the board's bloom
chain and four of its own (`Bloom_*`, `RenderPipeline_23/98/99/100`). Worst frame after the reveal cold
47-51 ms (drain turns 50-57), warm 28 ms (29-33). Travel p99 6.6-6.7 ms on both.

**Frame rate, uncapped (`--vsync=0`), r186 → final, two rounds:** equal within the run-to-run spread.
Rest fps Summer 249 → 260, Verdant Hills 238 → 236, Thermal Bloom 272 → 270, Grainfields 230 → 229,
Spring 275 → 274, Kaleidosonic 374 → 374; worst storm within −5 … +4 %. r187 changes compile and build
cost, not the per-frame GPU cost. (Spring's first visit showed after 9.1 s on the r186 build in both
rounds and 1.5 s on final; not explained, not claimed.)

**Forest's regression: its static shadow map was drawn before its casters were built.** Forest, Fall,
Golden Forest, Halcyon Apex, Sakura Twilight, Summer and Verdant Hills draw a static shadow map
(`autoUpdate = false`) on their first 9 frames, then at a few later marks (frame 45, 150, …), so a late
caster still lands in it. three draws a shadow map only in a frame that draws a receiver
(`ShadowNode.updateBefore` runs from the receivers' render objects). Under sliced builds the first
frames draw no receivers, so the frame count ran out with the map drawn once and 11 of Forest's 28
casters built; the other 17 were built, and four shadow pipelines compiled, at the frame-45 redraw, at
the reveal. A GPU trace of that frame: the GPU process spent 50.6 ms allocating the canvas's next swap
buffer (normally 0.3-0.5 ms), with two queue submits of 35 and 26 ms before it; none of them on r187.
Forest, three cold switches per arm, full speed:

| Forest first visit (median of 3) | longest frame |
|---|---:|
| r187 | 48 ms |
| final, `?switchSlicedBuilds=0&mipmapPipelineWarm=0` | 52 ms |
| final, `?switchSlicedBuilds=0` (mipmap warm only) | 52 ms |
| final, `?mipmapPipelineWarm=0` (sliced builds only) | 63 ms |
| final | 79 ms |

Fixed: `src/themes/shared/static-shadow-draws.js` counts the first redraws as draws (three clears
`shadow.needsUpdate` when it has drawn), so they wait for the frames that draw; all seven lights use it.
With every frame drawing (no sliced build, r186) the same frames redraw as before (unit-tested against
the old rule). Checked at the light 30 fps cadence (the owner's cool-GPU rule): Forest's casters built
over 163-679 ms with a 425 ms pause on final, over 170-240 ms with at most 38 ms between two on the fix
(r187: 0-95 ms, 39 ms); last pipeline before the theme runs again (810 vs 864 ms; final 883 vs 872);
same frame. The full-speed re-measure is left for a full-speed session.

**All 63 themes in the real game on `9250a577`, light cadence** (fleet bench `--vsync=1 --target-fps=30
--scale=1 --shots=1 --build-trace=1`, 2026-10-31): every theme loaded, no console error and no message
that the 2026-10-30 r187 light run did not have, none much slower to show; the rest shots match that
run's contact sheet (only what moves with time differs). The seven static-shadow themes built their
casters early (longest pause between two 1-75 ms, the last pipeline before the theme runs).

**The first canvas upload of a fresh GPUDevice (measured, not acted on).** On a cold cache the GPU
process compiled a vertex/fragment pair synchronously for 38-44 ms right after a switch's first
canvas-sourced texture upload (`copyExternalImageToTexture`), with no renderer pipeline created then:
Dawn's internal copy pipeline. A probe in the game page (three fresh devices in a row, a 64² canvas
copied as three issues it, light cadence, two runs): the first device's first copy 50-63 ms, each later
device's first copy 12-20 ms, steady copies 3-4 ms, a new canvas on a warmed device nothing extra, other
formats nothing extra. So the full cost is once per shader cache (once per install or driver update:
the browser's cache keeps it), and each theme start pays ~10-15 ms after that. The fleet bench gives
every theme a fresh profile, so its first-visit numbers carry that once-per-install cost for every
theme that uploads a canvas texture; a player pays it once.

**The worst first-visit switch frames that were the game's own code (2026-10-31).** CPU profiles of
the first switch (bench `--profile-load=1` on an unminified harness build, light cadence) put the
worst frames of three of the five worst themes in one long task each; split without changing what is
built (same work, same order, same random draws):
- **High Coast:** the field textures' half-float conversion (61-70 ms per field, one task each: three's
  `DataUtils.toHalfFloat` per value, 4.2 M values a field) → `src/rendering/half-float.js` `halfBits`,
  three's own tables and clamp bit for bit (tested against the installed three, NaN sign included), in
  bands of 256 rows (`high-coast-field-data.js`); the mesh positions yield every 8 ms instead of every 48
  rows; the props (101 ms: the old pine 71, its needle geometry alone 41, the sign's lettering 21) build
  as steps (`createPropsSteps` / `createPineSteps` / `needleGeometrySteps`, the old functions drain them).
- **Stillwater:** the whole world in one `build()` (85 ms, its noise bake in the constructor) → a
  `buildSteps()` generator, a few parts to a step, built by `buildWorldBreathing` as Fall, Forest and
  Spring already are.
- **Thermal Bloom:** the world's build in the bake worker's message task (64-92 ms) → `buildSteps()`, a
  part to a step.

Worst first-visit switch frame, light cadence (30 fps cap, rAF at the panel's 240 Hz), two runs each:

| Theme | before | after | what is left in the worst frame |
|---|---:|---:|---|
| Stillwater | 85-87 ms (85 ms of script) | **23-27 ms** | — |
| Thermal Bloom | 62-75 ms (64-72 ms of script) | **34-36 ms** | — |
| High Coast | 73-90 ms (72-93 ms of script) | 62-65 ms | 6 ms of script: a GPU-process wait; next frames 28-33 ms |

Same pictures (rest shots side by side), unit tests for the bit-exact conversion and the band/whole
equality. Murmuration's (45-48 ms of `createScene` then the first frame in one task) and Neon Quarter's
(7 ms of script, the rest the GPU process) are left.

## Phase 2 acceptance (open)

- (Done, above.) Real-GPU captures of every theme, r186 build vs r187 build at the same frames (RTX; the playground
  for fixed-time stations), image-diffed; every visible change to the owner as before/after crops.
- Odyssey chapter stations one chapter at a time (TDR rule) and the breathing worlds, same method.
- The real game: boot warp, a mode started, in-play theme switches (async pipelines + build budget
  live), Odyssey map open and an orb, a breathing session; console clean.
- Load A/B with the fleet bench at the display's cadence (`--vsync=1`), same machine and power mode,
  r186 and r187 builds run interleaved: first-visit shown, switch freeze, the worst cases above.
  GPU fps at rest and in storms for the three GPU-bound themes. Chiral Gold with and without the
  PMREM warm. Odyssey map-open time and `pipes.syncAt`.
- `perf:budgets:gate`; budgets change only with measured evidence (ADR-0016).
