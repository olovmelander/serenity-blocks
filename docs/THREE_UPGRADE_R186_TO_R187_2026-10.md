# Three.js r186 to r187 upgrade

**Status: Phase 0 and Phase 1 on branch `perf/three-r187`; Phase 2 (real-GPU acceptance, look
review, perf) open. Not merged.** Started 2026-10-30 from `c52f42b0`, the day 0.187.0 was published,
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
