# Static theme audit: start cost and per-frame cost (2026-10-14)

> **Reference, kept beside [THEME_PERF_FLEET_2026-10.md](../THEME_PERF_FLEET_2026-10.md).** This was
> written by a parallel, read-only session while the fleet was measured. "The other session" and
> "the measuring session" below mean that document, which holds the measurements. Since then the
> in-play switch builds the incoming theme behind the playing one, with async pipelines and a
> per-frame node-build budget. §0.1 therefore no longer holds for a level-up: its compile and
> node build are spread over frames. The scene-build (S) findings still cost a short freeze there.

Read-only static audit of all 63 registered themes (`src/themes/theme-registry.js`) at **origin/main `072c37a6`** (`C:\Users\olov_\repos\serenity-blocks`, clean). It looks for what makes each theme slow to start and expensive per frame, from the code alone. Nothing was built, run or measured: no Vite, no tests, no Electron, no GPU lock.

**Method**
1. A regex scanner (run once in Node, read-only) resolved each theme's import closure and counted red-flag call sites.
2. Eleven read-only Explore agents (5-7 themes each) read every theme's build path, materials, shaders and frame loop.
3. The coordinator re-read the claims behind the top-10 list and the fleet patterns: the forest/fall primes, voltage-storm shocks, the pyrestorm bake, koi-pond shadow, the cinder-drift uploads, the luminous-tides glows, the high-coast cumulus, the aurora arcs, the reflector sample key, the double-pass rule, the DPR helper, and the async-pipeline rules.

**Tags**
- `[c]` = read in code.
- `[s]` = suspected. These are cost estimates, cadences that depend on runtime state, and whether DXC caches a duplicate pipeline. Measurement belongs to the other session.

**Scores** (1-5, worst = 5, calibrated across the fleet by the coordinator):
- **S** = start (main-thread work in the build)
- **K** = shader compile (pipeline count × graph size)
- **C** = per-frame CPU
- **G** = per-frame GPU

The table is ranked by S+K+C+G; ties are broken by S+K, then G. The worst themes on each single axis are listed under the patterns.

**Path shorthand in the table:** `world.js:471` means `src/themes/<theme>/<theme>-world.js:471`. `pg/` means `src/playground/effects/`. Other paths are repo-relative.

---

## 0. Context that changes how to read "start cost"

1. **Async pipeline creation covers only the mode-start overlay** [c]. `beginLoadingSurface('mode-start')` is armed only when the cinematic loading overlay shows: `src/main.js:2800`, plus `src/ui/cinematic-loading-surface.js:8`. Under it, live renders create render pipelines with `createRenderPipelineAsync` (`src/rendering/async-render-pipelines.js:142-166`). Every other switch runs `createScene()` on the main thread and creates its pipelines synchronously in the GPU process, during play:
   - the **Level background mode's level-up switch**: `src/core/game-modes/SinglePlayerMode.js:327`, `:946`, and `src/main.js:3101`, `:3345`
   - Hub › Themes (`src/ui/serenity-hub/ThemesTab.js:1100`)
   - the theme collection (`src/ui/theme-collection-integration.js:88`)
   - the music-linked switch (`src/audio/sound-manager.js:1296`)

   For those paths, every S and K below is a frame-time hitch, not a loading-screen cost.
2. **Some creates stay synchronous even under the session** [c] (`src/rendering/async-render-pipelines.js:82-102`, `159-161`):
   - the final composite quad drawn to the canvas
   - PMREM and cube bakes (chiral-gold's studio environment)
   - compute pipelines (astral-weave, murmuration, cosmic-noir)

   In a theme without FXAA, the "final composite" is the whole output pass. Examples: stillwater's 36-tap Kuwahara (`stillwater-post.js:205-233`), and the 10-16-tap ray/streak outputs in the MSAA template themes. A theme that ends in `fxaa()` (16 themes) pays only for the small FXAA quad there.
3. **Warm hooks** [c]. 41 themes return `[]` from `getWarmupRoots()`, and per the handover the manager never reads that hook anyway. Only 4 themes call `compileAsync` themselves: cosmic-noir, moonlit-forest, wolfhour, and blood-moon via `pg/blood-moon.effect.js:407`. Ten themes do a synchronous warm render inside `createScene`, which requests every pipeline in that one call: forest/summer/golden-forest (full-scene shadow prime), fall (to the canvas), sakura (terrain only), tornado and wolfhour (warm before compile), black-hole, crystal-cave and stellar-velocity's canyon quad.
4. **Corrections to standing notes**
   - **stillwater's "2.2 s water compile, materialXFlow suspect" is stale** [c]. Stillwater was rebuilt from scratch in `6698ec00` (2026-10-09), which deleted that runtime; `materialXFlow|mx_` no longer occurs in `src/themes/stillwater`. Its water graph needs a fresh per-pipeline reading (appendix, stillwater).
   - **`mx_noise` survives in exactly one theme**, moonlit-forest: 9 calls in `pg/moonlit-forest-master.effect.js` [c].
   - **No 72-step-class JS-unrolled `If` raymarch is left anywhere** [c]. The biggest JS-built `If` sets are:
     - serenity-warp: 16 (`serenity-warp-glass.js:324-332`; the outer loop repeats the same 4 tests 4×)
     - crystal-cave: 13 per bounce × 3 unrolled bounces (`crystal-cave-gems.js:132-160`, `323-391`)
     - stillwater: Kuwahara 4 × 9 taps
     - ice-temple: 4 lock slots
     - fluid-dreams: 2 × 4 group blocks (`fluid-dreams-liquid.js:364`, `465`)
   - The biggest JS-unrolled loops without `If` (straight-line WGSL mass) are:
     - high-coast cumulus: 26 (`high-coast-cumulus.js:153-162`)
     - aurora: 4 copies of a nested march (`aurora-curtains.js:182-186`)
     - luminous-tides: 27 palm fronds (`luminous-tides-land.js:120-158`)
     - aether-tides: 36 shade taps (`aether-tides-light.js:122-141`)
     - painted-ages cumulus: 16 (`painted-ages-cumulus.js:143-151`)
5. **Prior measurements, for orientation only** (memory notes; not re-measured here):
   - forest: ~6 s cold first frame, 7.2 ms CPU per frame (plan row T8)
   - pyrestorm: ~2.2 s in-switch
   - fluid-dreams: hero material ~1.7 s compile from graph size

---

## 1. Ranked table (worst first)

| # | theme | S·K·C·G | suspected start cost | pipeline drivers | compile red flags (file:line) | per-frame CPU suspects (file:line) | per-frame GPU suspects | quick wins |
|---|---|---|---|---|---|---|---|---|
| 1 | sky-children | 5·5·4·5 | `world.build()` is synchronous after the renderer await. It runs 5 uncached 512² bakes (`world.js:471-476`, `core.js:919-1287`), 1M `toHalfFloat` calls (`tsl.js:136`) and CPU-noise isles (`isles.js:2809-2976`) [c] | 13 scene materials (5 distinct stone graphs); MSAA-4, bloom, output [c] | (a) lamp loop ×10 (`isles.js:2424`), deep shelves ×2-3 (`tsl.js:1083`); (c) dome `skyColour` (`tsl.js:1137-1262`); (d) `skyBase` has no layout, ~30 copies (`tsl.js:200`) [c] | 1100 closed-form spray puffs, one `subarray` per puff in the sort (`fx.js:348-350`); full uploads (`fx.js:135`, `354`) [c] | sky dome + optics sea + 1100 spray billboards (overdraw [s]) + MSAA-4 | module-cache the bakes, as rainbark does; indexed copy + `addUpdateRange` (`fx.js:349`); `setLayout` on `skyBase` |
| 2 | forest | 5·5·4·4 | serial renderer → 14-file load (`theme.js:199`, `227`); full-scene shadow prime inside `createScene` requests ~60 pipelines at once (`post.js:103-119`); all 11 firefly figures laid out eagerly (`firefly-director.js:101`) [c] | ~37 materials: one per bark asset and one per foliage bucket (`trees.js:174`, `316`); ~24 shadow variants; godrays, blur, bloom, FXAA [c] | (a) 5-pulse `glow()` unrolled in ~20 graphs (`light.js:298-308`); `pulseShove`/`stir` ×5 (`light.js:329`, `413`) [c] | 1056-fly sim + 9216-exp light field + 3 × 38 KB uploads (`firefly-sim.js:302-447`, `light-field.js:76-81`); `getFrame` built ×2 (`theme.js:559-560`); 0.75 s gBCR poll (`stage.js:29`) [c] | godrays 26 steps; 4 mist planes running `glow()`; 16 shadow redraws in 20 s [c] | tree materials via geometry attributes, as `sakura-forest.js:141-145` (bark+foliage ~20 → 3-6); pulse `Loop` as `sakura-light.js:206`; lazy figures |
| 3 | summer | 5·4·3·5 | lake map: 196k texels × 2 `summerShores()` objects = ~393k allocations (`terrain.js:83-95`, `180-196`); meadow scatter of 55k plants with ≤8 tries each (`meadow.js:200-300`); full-scene prime (`post.js:100-116`) [c] | ~44 materials: bark/foliage per bucket, 4 mist + 5 garland materials with baked literals (`atmosphere.js:119`, `garlands.js:46`); shadow 2048×1024; reflector at 0.5 [c] | (a) `meadowWind` 6 waves (`light.js:337-346`); lake rings ×8 (`lake.js:100`); flower `answer()` ×2 (`meadow.js:247`) [c] | petal sim over 2400 + 2 full uploads (`petals.js:166-176`); `getFrame` ×2 (`theme.js:504-505`); `aimSun` every frame (`light.js:207-245`) [c] | mirror = second scene render incl. cumulus; 32k grass + 23.6k flowers with 6-wave vertex wind; shadow map re-rendered whenever the drifting sun moves 0.03° (`light.js:207-221`) [s] | allocation-free or cached `summerShores` maps; re-aim the sun only on level turns; uniform-driven mist/garland materials |
| 4 | verdant-hills | 4·4·4·5 | serial renderer → 6 GLB + 3 PNG (`theme.js:182`, `210`); synchronous terrain of 60k heights + 60k `.set([..])` (`terrain.js:392-418`); 62k-plant scatter (`meadow.js:91-92`, `composition.js:137-175`) [c] | ~22 materials (bark per asset, foliage per bucket, `trees.js:177`, `325`); cloud-march RT at 0.5; shafts RTT; shadow 2048² [c] | (c) cumulus `Loop(48)` with 3 inlined `cloudDensity` per step (`sky.js:100-143`); homestead 11-albedo uber-graph (`homestead.js:151-193`); (a) 6-ring wind in 2 materials (`light.js:508`) [c] | `getFrame` ×2 + spreads (`theme.js:504-514`, `world.js:167`); 2400-seed sim calling the analytic `groundHeight` + ~77 KB/frame unconditional upload (`seed-sim.js:244`, `seeds.js:164-174`); 0.75 s poll [c] | 48-step cloud march every frame; ~3.17M double-sided grass triangles with vertex wind; shafts 20; FXAA [c] | one `getFrame` with pooled objects; skip the seed upload when idle; march clouds every other frame or with 32 steps; prefetch assets before the renderer await |
| 5 | serenity-warp | 5·4·2·5 | `bakeGasNoise(6151,64)` ≈ 39M inner iterations, plus `bakeFbm` 1.3M, uncached, on every build (`world.js:339-340`, `tsl.js:151-412`) [c] | ~15: env + backdrop sky, 1 shared glass; env RT 768×384; MSAA-4 [c] | (a) 16 JS-unrolled `If`s; the outer `pass` loop repeats 4 tests 4× (`glass.js:324-332`); (c/d) `skyLight()` inlined into 2 materials with ≤6 3D reads each (`sky.js:87-311`) [c] | 7 interleaved buffers dirtied every frame, ~13 KB (`glass.js:439-449`) [c] | full `skyLight` env pass every frame at High (`quality.js:55`) + full-screen backdrop + MSAA-4 [c] | module-cache the gas/fbm bakes; one `Loop` over 4 centres; `envEvery` 2 |
| 6 | chiral-gold | 4·5·2·5 | studio equirect 1024 (524k px × 43 lights + 1.57M half-floats, `tsl.js:198-325`), noise 1.05M, tower geometry, canvas-2D atlas; PMREM stays synchronous even under the session [c] | 24 materials, 10 PBR. `hand`/`index` are baked as JS constants, so 6 tower + 3 band PBR+IBL pipelines (`helix.js:242-340`, `ring.js:68-78`); reflector + MSAA-4 [c] | (a) `pulseBand` ×8 in 6 materials (`helix.js:235-250`); reflector sample-count variants [s] | `cardUnion` spread + `fallbackLayout` objects every frame (`world.js:938`, `composition.js:46-129`) [c] | reflector re-renders ~20 PBR draws at 0.5 + mips; MSAA-4 PBR main pass [c] | `hand`/`index` as a uniform or attribute (−4-5 PBR pipelines); module-cache the studio data; instance the 6 torc ends |
| 7 | sunset | 5·4·3·4 | `bakeSkyNoise(512)` + `bakeSeaNoise(512)` ≈ 14M iterations, constant seeds, unsliced (`core.js:263-318`, `world.js:245`) [c] | 5 scene materials; 2 shaft RTTs; FXAA [c] | (c) ~250-line `skyColour` emitted in full in sky and sea (`tsl.js:205-453`, `sky.js:22`, `sea.js:173`); (d) `glintLobe` has no layout, ×3 (`tsl.js:456`) [c] | lamp/trail objects + sort + `getPostState` arrays (`world.js:767-845`); full lantern/bird uploads (`lanterns.js:111`, `birds.js:184`) [c] | full sky dome + mirrored sky in the sea + 14-lamp glint Loop; shafts run while off [s] | module-cache the bakes; `glintLobe.setLayout`; pool lamp records |
| 8 | thermal-bloom | 4·4·3·5 | vapour 3D noise 48³ ≈ 18M ops + 4 sorts (`bake.js:255-384`); stair bake 382k samples (`bake.js:576-699`); noise + cellular; all inside `world.build()` (`world.js:516-558`) [c] | 16 materials; vapour RTT; FXAA RTT; 2 copies of the same 1 MB layout texture (`terraces.js:129-134`) [c] | (c) vapour `Loop(32)`×`Loop(18)` with `body()` inlined 3× per step (`vapour.js:148-324`); ~650-line basin fragment with 4 Loops (`tsl.js:437-696`) [c] | ~80-120 allocations per frame: `rigFrame` (`core.js:768`), `.map` ×6 (`world.js:2856`), 5 `filter`s, string key (`world.js:2166`) [c] | vapour march at 0.5; basin over half the screen; 40 steam sheets; FXAA [c] | bake the vapour after the first frame; cache `rigFrame` and drop the per-frame `map`/`filter`; merge the sun-tap `body()` calls |
| 9 | pyrestorm | 5·4·2·4 | first visit: `bakesOnce()` (2 × 1024² lava fields + 512² billows) runs **before** the first yield, so `bakeSliceMs` never slices it (`world.js:90-93`) [c]; renderer await → `prepare` serial (`theme.js:204`, `232`) [c] | ~20; 16 MB of lava DataTextures (`tsl.js:102-108`) [c] | (c) plume `Loop(28)` with `densityAt` ×3 per step (`plume.js:280-318`); (d) `axisAt`/`nearestK` have no layout, ~14 copies (`plume.js:175-204`) [c] | smoke: 168-puff sort + 4 uploads every frame even when empty (`smoke.js:226-307`) [c] | full-res plume march; double-sided anvil [c] | `yield*` inside the bake; prepare before the renderer await; `setLayout` on the plume helpers |
| 10 | high-coast | 4·4·2·5 | renderer → prepare serial (`theme.js:199`, `227`); 3 PNGs fetched serially (`assets.js:152-170`); 1M-texel `fieldTextureData` in one slice (`world.js:76-79`); 22k-tree sites + 1.67M index writes in `build()` [c] | ~25 + 3 shadow quads; shadow fields 768/384/192 [c] | (a) cumulus 26 billows unrolled (`cumulus.js:153-162`), the largest unroll in the fleet; (c) land Fn (`land.js:371-474`); sea `Loop(26)` (`sea.js:277-305`) [c] | array literals per boat/gull (`fleet.js:380`, `life.js:193`) [c] | full-res sea march (26 × 6 taps); 558k-triangle land; shadow repaint 768² × 40 steps as the sun moves [s] | cumulus → `Loop(BILLOWS)` (the body already indexes `billows.element(...k)`); parallel PNG fetch + prepare before the renderer; `mirrorSteps` 22 → 16 |
| 11 | rainbark | 3·5·2·4 | first start only (module-cached `BAKES`, `world.js:155-190`): 512 atlases, 21k-twig lace, gap mask, unsliced [c] | 10 materials (near and far trunks are distinct graphs); MSAA-4 [c] | (a) `impostorRanks` ×3 each with a full `rbAir` (`sky.js:209-252`); (d) `rbAir` (~100+ nodes, `tsl.js:1382`) ~7× in the backdrop; huge near-trunk graph (`tsl.js:2219-2515`) [c] | curls respawn re-uploads the whole buffer (`curls.js:409-557`); Climb re-uploads the trunks (`trunks.js:366`) [c] | 4 stacked mist sheets + 600 drops + 388 curls (overdraw [s]); MSAA-4 | ranks as a TSL `Loop`; `setLayout` on `rbAirTransmittance2` (`tsl.js:1257`); `mistSheets` 4 → 2-3 |
| 12 | crystal-cave | 4·3·2·5 | renderer await → 3.77 MB `cavern.glb`, re-fetched and re-parsed every start (`theme.js:126`, `146`; `assets.js:121-131`); 655k-closure noise (`light.js:53-100`); synchronous first render in `createScene` (`theme.js:165-168`) [c] | 10 materials; reflector at 0.38 over the whole scene; viewport copy; FXAA RTT [c] | (a) 3 JS-unrolled bounces, each `traceExit` with 13 JS-built `If`s + 8 `environment` calls (`gems.js:132-160`, `323-391`) [c] | `writeSparks` dirties 3 full attributes every frame when idle (`effects.js:285-329`); 0.75 s gBCR poll (`theme.js:390-395`) [c] | 2087 ray-traced gems drawn twice (main + mirror) [c]/[s] | load the GLB alongside the renderer + session cache; gems off the mirror layer; idle early-out for sparks |
| 13 | misty-lake | 3·4·2·5 | WebGL classic: ~29 GLSL programs link synchronously on the first render, with no `compile()` (`theme.js:429-481`); unused 384² mirror RT (`water.js:147`) [c] | ~20 scene + ~9 composer programs [c] | GLSL `fbm` ≤6 octaves with `break`; mist 3 `fbm` = ≤18 snoise (`shaders.js:91-103`, `282-284`) [s]; ripple/burst materials recompile mid-play (`theme.js:2101-2199`) [c] | `onMouseMove` raycasts 30k triangles per event, ungated (`theme.js:2301-2321`) [c] | 6 stacked full-width mist planes × 12 snoise; ridges recomputed per pixel; DPR never re-applied on resize (`theme.js:2286-2299`) [c] | `compile` before the loop + keep the ripple/burst materials alive; fewer mist octaves; gate mousemove |
| 14 | fluid-dreams | 2·5·2·5 | 256² noise + ≈350k `toHalfFloat` (`tsl.js:127-198`) [c] | 3 scene materials; FXAA RTT (`post.js:267`) [c] | (a) 2 JS group loops ×4 with `If`+`Loop` (`liquid.js:364`, `465`); (c) bounce → march → group → ball nesting; (d) `skyColour` inlined ×5 (`liquid.js:675-747`) [c] | ~215 vec4 uniform rows per frame + small arrays (`choreography.js:113`, `608-714`) [c] | full-screen 2-bounce raymarch for every pixel [c] | one `skyColour` + offsets; merge the `(d,true)`/`(d,false)` calls; group loops → TSL `Loop` |
| 15 | golden-forest | 4·3·3·4 | lake map 196k × 2 shore objects (`terrain.js:40-117`); full-scene prime (`post.js:97-112`); serial awaits [c] | ~32 (8 bark + foliage per bucket; 5 mist + 3 ribbon literal materials); reflector over every group [c] | lake rings ×8 (`lake.js:108`); ribbon `path()` ×2 × 3 [c] | 2200-spark sim + 3 full uploads (`sparks.js:92-96`); `getFrame` ×2; 0.75 s poll [c] | mirror incl. sparks/birds; godrays; 5 mist banks [c] | attribute-shared tree materials; keep FX off the mirror layer (`world.js:89-90`); allocation-free lake map |
| 16 | koi-pond | 4·3·3·4 | 1024² pebble Voronoi ≈ 9.4M + 1M relief + water mask 246k, uncached (`bed.js:32-136`, `surface.js:81`); restart replays ≤720 sim steps synchronously (`theme.js:63`, `274-288`) [c] | ~19 + 9 shadow casters; shadow 2048² with autoUpdate on (`light.js:142-151`); sim RTs; FXAA [c] | none severe; sim `Loop(12/32)` (`surface.js:187`) [c] | ≤5 fixed steps per frame (O(n²) school); `spray.commit` 640×12 floats every frame, even idle (`fx.js:167-190`) [c] | 2048² shadow redrawn every frame with 6400 casting leaves (`garden.js:597`) [c] | `leaves.castShadow=false` or High 1024 (`quality.js:75`); cache the bakes; idle-skip spray |
| 17 | luminous-tides | 4·3·3·4 | sky + sea noise at 512 ≈ 19M iterations (`core.js:612-757`, `world.js:194-195`) [c] | 5 materials; FXAA [c] | 27 palm fronds unrolled (`land.js:120-158`); (c) huge shore fragment, coast terms built 2× (`shore.js:341-570`, `516-520`) [c] | glows: 47.6 KB full upload every frame (`glows.js:98-102`); 640-drop walk + spray Newton solves (`spray.js:74-147`) [c] | shore fragment eye → horizon; 992 glow + 800 rain quads [c] | `addUpdateRange(0,count*4)` in `glows.end()`; module-cache bakes or start at 256 |
| 18 | sakura-twilight | 3·3·4·4 | terrain-only prime (good) but to the canvas, so a second format [s] (`world.js:140-149`); serial awaits [c] | ~33; 4 mist literals (`spirits.js:84-113`); fox skin/fur ×2; reflector at 0.4, layer 0 only (`water.js:66`) [c] | lamp/ring `Loop`s are the model; (d) `hazeFn`/`lampsFn`/`ringsFn` inlined in 8-12 materials by design (`light.js:164-171`) [c] | 6000-petal sim + quaternion for every petal + 3 × 6000 full uploads (~240 KB/frame) (`petal-sim.js:219-402`, `petals.js:109-119`) [c] | lake with 10-lamp + 6-ring loops; 6000 petals with lamp loops per vertex; 2 × 12 fur shells [c] | skip idle petals + live ranges; one mist material |
| 19 | cinder-drift | 3·3·4·4 | bakes cached (`tsl.js:106-122`) but ~1.75M `toHalfFloat` re-run every build (`world.js:235-236`) [c] | ~20; no reflector [c] | (d) `cdRings` 6 + `cdClear` 2×4 inlined in lake and columns (`tsl.js:445-489`) [c] | ambient emits with no play: spray 0.25 s, drips 0.2 s, streams 0.5 s (`world.js:795-881`), each re-uploading 256 KB (`fx.js:169-173`); heat 36k `toHalfFloat` + upload per stamp (`heat.js:36`) [c] | MSAA-4; lake over half the screen; 4096 spatter + 26 smoke sheets [c] | ranged spatter upload; in-place writes; cache the half-float arrays |
| 20 | aurora | 4·4·1·4 | `bakeAuroraNoise(256)` ≈ 917k + 21k-vertex terrain at ~22 noise per vertex with option objects, uncached, after the renderer await (`world.js:55-61`, `landscape.js:69-120`) [c] | 8 + curtain RT at 0.5 + reflector at 0.35 (samples 0 vs MSAA-4 when AA is on) [c] | (a) 4 marchArc copies, each `Loop(17)`×`Loop(4)` with ~100-node bodies; corona compiled at gain 0 (`curtains.js:182-186`, `251-407`) [c] | clean [c] | curtain march; mirror re-renders 5200 stars + range every frame [c] | arcs in a TSL `Loop` over a `uniformArray`; cache bakes; keep stars off the mirror |
| 21 | stellar-drift | 4·4·1·4 | `bakeFbm(512,6)` ≈ 6.3M + ~1.4M `toHalfFloat` (`bake.js:51-107`, `tsl.js:111-148`) [c] | 7; MSAA-4 [c] | (a) `curtain()` ×2 × JS `k<2` with `If` (`space.js:665-691`); (c) one full-screen ray tracer of ~560 lines (`space.js:139-698`) [c] | clean [c] | full-screen analytic tracer + MSAA-4 on top of a self-AA'd pass [s] | High `msaa:0`; module-cache fbm; `Loop(2)` |
| 22 | painted-ages | 4·4·2·3 | 3 PNGs (6.2 MB) for-awaited serially (`assets.js:138-156`); `fieldTextureData` 1M × (12 reads + 4 half floats) in one slice (`world.js:80-83`); frame 1 paints all 3 shadow fields (`shadow.js:125-138`) [c] | ~18; 3 shadow quads; 9 DataTextures (18 MB) [c] | cumulus 16 billows unrolled (`cumulus.js:143-151`); (c) huge land `colorNode` (`land.js:155-325`); shadow `Loop(42)` [c] | rain motes: 4 full uploads (~131 KB/frame) though `dirtyFrom/To` exist (`motes.js:160-182`) [c] | shadow repaint as the sun moves (768² × 43 × 3 taps) [s]; shafts 14 [c] | `Promise.all` the PNGs before the renderer; slice `fieldTextureData`; dirty-range motes |
| 23 | moonlit-greenhouse | 3·4·1·5 | 512² garden noise ≈ 9M ops after the renderer await (`core.js:762-777`); allocating vector math in flora (`flora-geometry.js:221-378`) [c] | ~35 materials (identical trunk/fern graphs built separately, `flora.js:89`, `132`, `141`); MSAA-4; air RTT [c] | (d) `mgSurface` (crown+lantern+bloom-light Loops) inlined in ~15 materials (`tsl.js:601-630`); (c) air `Loop(24)` with 3 nested loops (`post.js:351-387`) [c] | clean [c] | every lit pixel runs 3 loops under MSAA-4; 24-step air march; 3×3 bilateral [c] | drop `mgCanopy` from the march; High MSAA off + FXAA; bake before the renderer await |
| 24 | stellar-velocity | 4·3·1·5 | `bakeCanyonNoise(64)` ≈ 31M + `bakeFbm` 1.3M (`tsl.js:156-471`); frame-0 `world.update` renders the canyon quad in `createScene`, outside any scene warm (`theme.js:282`) [c] | 7; canyon RT at 0.6; 2 Data3DTextures [c] | (c) canyon `Loop(40)` with nested Loops/Ifs/Break (`nebula.js:162-272`) [c] | small [c] | canyon march ≤280 fetches per pixel at 0.36 area; backdrop + 3700 streaks sampling the RT [c] | module-cache bakes; `draw:false` at frame 0; `canyonScale` 0.5 |
| 25 | voltage-storm | 4·3·2·4 | `bakeCloudNoise` 48³ cellular ≈ 9M (Ultra/Extreme 64³ ≈ 21M) + 2D noise, uncached (`world.js:252-253`, `tsl.js:226-343`) [c] | ~18; sky RT at 0.6; Data3DTexture [c] | (c) sky `Loop(14)` with 3 inlined `plan()` per step (`sky.js:162-229`); (d) bolt `frameAt` ×7 (`bolts.js:235-281`) [c] | bolt-table sort; ~200 vec4 rewritten per frame (`world.js:1123-1147`) [c] | **`shockCount` stays at 10 forever, so every water pixel loops 10 rings at rest** (`world.js:244`; `tsl.js:493`); 80 dead bolt instances still vertex-shaded (`bolts.js:372`) [c] | `shockCount` = live rows; bolt `mesh.count` = live max; memoize the 3D bake |
| 26 | stillwater | 3·4·2·4 | noise 1.3M + 350k half floats; 25.6k heights × 2 objects (`plan.js:98-139`); troll GLB fetched only after the build (`theme.js:224` vs `272`) [c] | 25; **23 HERO materials × (MSAA-4 pass + samples-0 reflector) ≈ +23 pipelines** (`post.js:65`, `water.js:74`) [c] | water ~780 ops / 22 taps incl. full `swBackdrop` (RANKS 4×2 unroll, built in sky and water, `tsl.js:534-565`); Kuwahara 4×9 + 4 `If` in the **sync** final composite (`post.js:205-233`) [c] | ~10 small allocations [c] | MSAA-4; reflector re-renders 23 parts; 36-tap Kuwahara at full res [c] | memoize noise; fetch the troll in parallel; water `swBackdrop` lite; match sample counts |
| 27 | solar-eclipse | 2·5·2·4 | noise 1.25M + ranges (`core.js:217-441`) [c] | ~11; one dome carries nearly all the shader [c] | (a) salt 3×3 ×3 hashes (`mirror.js:144-156`), ranges ×6 (`sky.js:223-264`); (c) prominence `Loop(12)` with 5-deep `If` nesting (`sun.js:251-350`) [c] | `filter`+`sort` while staged (`world.js:824-829`) [c] | lower screen evaluates the whole sky again in the reflected direction (~2× sky) [s] | salt/ranges → TSL `Loop` |
| 28 | fall | 4·2·3·4 | 8 GLB (parallel, good); bakes; **canvas `renderer.render` at post build compiles every scene pipeline for the canvas target, not the scene pass** (`post.js:48`) [c] | ~34 (bark ×7, foliage ×8 per draw, mist ×4 literals, `atmosphere.js:81-93`); ~16 shadow variants; godrays + FXAA [c] | no loops; per-literal mist variants [c] | 2600-leaf sim with trig on resting leaves + 83 KB/frame (`leaf-sim.js:341-364`, `leaves.js:128-137`); `getFrame` ×2 (`theme.js:501-502`); 0.75 s poll [c] | ~10k double-sided foliage instances; godrays; FXAA [c] | prime into a scene-pass-shaped target, as `forest-post.js:103-119` does; skip resting leaves; one mist WGSL |
| 29 | aether-tides | 3·3·3·4 | noise uncached; first frame primes 24 shade passes (`light.js:208`) [c] | ~26; **4 transparent DoubleSide materials without `forceSinglePass` = 2 pipelines + 2 draws each** (`fx.js:157-170`, `stars.js:65-76`) [c] | (c) shade `walk()` 18×2 = 36 taps unrolled (`light.js:122-141`) [c] | ≤41 `quad.render` calls per frame + 7 literals per step (`fluid.js:619-624`, `world.js:371-431`) [c] | ~30 passes; full-screen nebula [c] | `forceSinglePass=true` (4 materials); cache noise; spread the priming |
| 30 | shifting-sands | 4·3·1·4 | terrain bake 77k samples + 174k shadow heights (Extreme ≈ 1M) (`terrain.js:243-379`); rocks 36k × 5 `P()` with an array per vertex (`rocks.js:149`) [c] | ~15; MSAA-4 on Ultra/Extreme [c] | (a) `WELL_SLOTS` 4 × ~60-node `If` bodies (`terrain.js:514`); worm-sand computes 5 paths and mixes them (`fx.js:255-368`) [c] | clean [c] | 153k-triangle terrain re-evaluating pulses/wells per vertex [c] | module-cache terrain + rocks per tier; `shadowStride` 3 |
| 31 | neon-district | 2·4·1·5 | noise ("≈45 ms", re-run on every build despite its comment, `tsl.js:137`) + glyph SDF (`glyphs.js:115`); late webp atlases arrive mid-play [s] | ~21 (facades ×2); **MSAA-4 + samples-0 reflector, so variants** [c key] | `ndLockLight`/`ndClearLight` unrolled at 16 sites (`tsl.js:346-382`); (c) facade interior map ×2 (`facades.js:156-385`) [c] | tiny [c] | reflector over all of layer 0 + mips; output 26 taps; 9000 rain instances [c] | module-cache noise/glyphs; dragon/megatowers off the mirror; fewer streak/ray taps |
| 32 | halcyon-apex | 3·3·2·4 | noise + `buildPlan` occlusion (`world.js:138-139`) [c] | ~39 incl. a 12-material reflector set (samples 0 vs MSAA-4) + 3 shadow casters [c] | (c) stone fragment (2 sky expansions, pulses ×2, `stone.js:101-195`); (d) all `ha*` helpers inline [c] | `crystals.place` 60 literals + full upload per frame (`crystals.js:325-330`) [c] | reflector + per-frame mips; **2048² shadow every 2nd frame, counted in frames** (`world.js:1071-1075`) [c] | time-based shadow cadence; indexed writes; reflector without mips |
| 33 | lunara | 3·3·2·4 | noise 1.3M + `buildPlan` 37k `heightAt` with closure allocations (`layout.js:25`, `192-213`) [c] | ~36 (reflector variants) [c] | (d) `luSkyBase` ×5, `luMoonDiscs` ×4 in crystals (`crystals.js:260-366`) [c] | event re-uploads [c] | reflector + mips; MSAA-4 [c] | copy cinder's `bakedOnce`; reflector without mips |
| 34 | ice-temple | 3·3·2·4 | noise ("≈45 ms" comment) every build (`world.js:194`) [c] | ~26 (reflector variants) [c] | 4 JS-unrolled lock-slot `If`s (`floor.js:225-264`); `airLight` duplicated in 3 vertex stages [c] | `paletteRGB` 4 arrays + object per frame (`world.js:97-99`, `565`) [c] | reflector + mips; 7400 heavy-vertex particles; 18 mist sheets [c] | cache noise; precompute palettes |
| 35 | starlight | 3·3·2·4 | noise 1.25M + 30k-star rejection catalogue + object sort (`core.js:232-431`) [c] | ~17 (lake twins) [c] | dome straight-line ~13 reads; 6-ring unroll in 5 pipelines via `mirrorDir` (`tsl.js:211-227`) [c] | `forEach` + staged `filter`/`sort` (`world.js:941-973`) [c] | ≈1.66M star vertices when trailing (also on level-up swings, `world.js:970-973`); sky computes the water path for every pixel (`sky.js:82`, `242`) [c] | `If(view.y<0)` around the water path; 1-read crest texture; cache the catalogue |
| 36 | bioluminescence | 3·3·2·4 | noise + `buildPlan` 161×221 grid + pad tries (`world.js:141-142`) [c] | ~28 + reflector variants [c] | (d) `blLamps`/`blScatter` loops re-emitted per call site (`tsl.js:295-361`) [c] | `peek()` objects ×24 per frame (`mushrooms.js:482-485`) [c] | 12 lamps + 12 scatter per lit pixel, ×2 with the reflector; MSAA-4 [c] | cache noise/plan; `tier.scatter` 6 |
| 37 | ocean | 3·3·2·4 | noise re-baked every build + seabed 32k × 13 heights (`world.js:265`, `seabed.js:62-87`) [c] | ~30; 512² light RT with 9 mips [c] | shaft `Loop(16)` with a nested shade Loop (`post.js:355-366`) [c] | `Object.keys().forEach` + spreads (`world.js:933-1066`) [c] | light pass + mip regeneration every frame (`tsl.js:609`); MSAA-4; 16-step shafts [c] | cache noise; mips every 2nd frame; shafts 12 |
| 38 | chromatic-impasto | 3·3·3·3 | 4 HalfFloat paint RTs; a restart past 3.4 s replays at 9000 quads/frame (`world.js:56-57`, `1004`) [c] | ~21; **`plain()` = DoubleSide + transparent, so 3 materials double-pass** (`canvas.js:194-211`, `336`) [c] | `stampNodes` ×2; 19 unrolled relief taps (`surface.js:67-222`) [c] | 2 closures + arrays per frame [c] | 20-tap surface; stamping bursts [c] | `forceSinglePass` in `plain()`; `FRAME_BUDGET` 3000 |
| 39 | geode | 3·3·3·3 | noise 1.31M + 11k druzy + 23.5k-vertex shell with ~235k `sampleNoise` closures (`layout.js:239-265`, `shell.js:95-135`) [c] | 9; MSAA-4 [c] | small unrolls; crystal `colorNode` large; `grown()` ×3 (`crystals.js:256-407`) [c] | **every strike re-packs 476 crystals × 5 `subarray`: ~19k views per lock, ~57k per hard drop** (`crystals.js:225-235`, `651`) [c] | MSAA-4 + 594k druzy vertices [s] | write only the struck crystal + range; cache noise |
| 40 | moonrise-summit | 2·4·1·4 | WebGL classic: ~21 programs link synchronously in the first `composer.render()` (`theme.js:366-371`); imports `three/webgpu` into a WebGL theme (`compute.js:13`) [c] | ~12 scene + ~9 composer programs [c] | `fbm` with dynamic `break` (FXC unroll [s]); 30-50 snoise per pixel overlapped (`shaders.js:72-753`) [c] | trivial [c] | `pixelRatioCap` 2.0 on High (`theme.js:164`); ridges per pixel before `discard` [c] | cap ~1.25 (HiDPI only); ridge to vertex/1D texture; `compile` first |
| 41 | vesper-chrysalis | 2·4·1·4 | noise 1.31M (`world.js:121`) [c] | ~35 incl. 12 reflector variants [c] | (c) `vcBackdrop` (~14 fetches, 3 `If`s) built in sky and lake (`tsl.js:459-631`) [c] | small [c] | ~one full-screen `vcBackdrop` per frame + reflector + MSAA-4 [s] | lake `vcBackdrop(lite)`; elevation `If`s |
| 42 | nebula-flow | 2·4·1·4 | noise + relief ≈ 2M + 700k half floats, same at all tiers (`core.js:90-228`) [c] | 6 [c] | (a) light taps JS ×5 (`nebula.js:305-307`); (d) `shapeAt` has no layout, ×8 (`nebula.js:86-116`) [c] | 192 Vector4 rows per frame (`world.js:961-999`) [c] | one full-res fragment; pillars add 5 shadow taps × 8 tapers [c] | light taps → TSL `Loop`; `setLayout` `shapeAt` |
| 43 | tornado | 3·3·2·3 | noise 1.25M, constant seed; synchronous warm render at the end of `createScene` (`theme.js:290`) [c] | 16; 3 child shells bake `index`, so 3 WGSL (`funnel.js:97-98`); MSAA-4 [c] | ribbons ×6, flashes ×3, rings ×4 (no `If`) [c] | `applyPalette` 15-key array + `includes` per frame (`world.js:612-626`) [c] | stacked transparent funnel shells; 480k wheat triangles [c] | child `index` → uniform; memoize noise |
| 44 | moonlit-forest | 2·4·2·3 | small; `await compileAsync` + primed render (`moonlit-forest-theme.js:355-362`) [c] | 26; 6 ridge/forest-layer materials bake colour literals (`pg/moonlit-forest-master.effect.js:693-745`) [c] | **(b) the fleet's last `mx_noise`: 9 sites / 8 pipelines** (`pg/moonlit-forest-master.effect.js:531`, `574`, `577`, `605`, `651`, `763`, `887`, `904`, `1173`) [c] | 3 literals per frame [c] | 3-octave 3D Perlin per sky pixel; canvas MSAA at DPR 1.35 [c] | bake the moon to a texture; shared baked noise `texture()` for the rest |
| 45 | winter | 2·3·2·4 | breathed load (good); synchronous `bakeNoise` 655k + 262k half floats (`world.js:261`); fox GLB after the first frame, so a mid-run compile (`world.js:293-312`) [c] | ~11; MSAA-4; no shadow map (CPU mask) [c] | aurora curtains ×3 + ×2 mirror, ~70 nodes each (`tsl.js:416-462`) [c] | `emit()` allocations + 4 full uploads during chains (`fx.js:168-207`) [c] | MSAA-4; 3 aurora sheets per sky pixel; 14 fur shells [c] | memoize noise; ranged emit; High MSAA 0/2 |
| 46 | supernova | 3·2·3·3 | `bakeNoise3D` 64³ ≈ 3.15M, constant seed (`tsl.js:101-195`) [c] | 9 [c] | 6 impact slots in an `If`; nebula `crossing` ×2 [c] | `writeShells` ~35-110 arrays + closures per frame (`world.js:1302-1407`) [c] | 2 full-screen BackSide domes (3D reads) [c] | scalar writes in `writeShells`; cache the 3D bake |
| 47 | himalayan-peak | 4·2·1·3 | renderer await → 2.28 MB PNG + 1M-texel derivation (breathed, but 1-5M-op slices); `halves()` ~2.1M half floats in the synchronous `build()` (`tsl.js:249-268`); eagle after reveal (`world.js:297`) [c] | ~21; MSAA-4 [c] | small [c] | clean [c] | cloud fan 5 noise + 5 air taps over the lower screen [c] | prefetch massif before the renderer; move `halves` into the breaths; warm the eagle |
| 48 | wolfhour | 4·2·2·2 | 54k-vertex landscape × 25 noise + 52k `indices.set([..])` + 512² granite ≈ 4.5M hashes, unsliced (`landscape.js:149-433`); warm order inverted (`theme.js:3337-3346`); dead GLSL/compute imports parse (`theme.js:8-61`) [c] | ~14 graphs over ~21 pooled material instances [c] | `tslFbm` without layout, 16 hashes in beams (`materials.js:65-99`) [c] | gBCR + `getComputedStyle` on every lock/clear (`theme.js:2661-2665`) [c] | ≤4 full-screen additive waves [c] | `compileAsync` before the warm render; cache landscape; drop dead imports |
| 49 | black-hole | 2·3·1·4 | sky bake sliced and overlapped (model); disk bake 786k in one block (`world.js:103`); `warmEventPools` renders synchronously (`theme.js:161`) [c] | 5 [c] | (c) lens `Loop(64)` with `shadeDisk` inlined; no `setLayout` anywhere [c] | 15 Hz timestamp resolve (`theme.js:31`) [c] | full-screen geodesic march (DRS-mitigated) [c] | slice the disk bake |
| 50 | cosmic-noir | 3·2·2·3 | 7.1 MB planet PNG + 3 nebulae re-fetched every start (`theme.js:2315-2322`, `2419`); serial `compileAsync` (3 s race) (`theme.js:1988`) [c] | ~17-21; 1 compute [c] | small [c] | new rAF closure + `toFixed` per frame; no hysteresis on the adaptive scale (`theme.js:670-829`) [c] | 4 full-screen additive nebula planes; bloom threshold 0 [c] | texture cache; hysteresis; merge nebula planes |
| 51 | waves | 3·2·2·3 | `bakeWaterNoise(512)` ≈ 2.36M; restart `playTo` ≤360 synchronous steps (`theme.js:276-291`) [c] | 6 + 2 shaft RTTs + FXAA [c] | `shape.point()` inline ×7 (`tsl.js:183-215`) [c] | new post-state object per frame (`world.js:780-794`) [c] | **shaft gather+fill render every frame even with the sun off-screen** (`post.js:303-314`); `discard` on water [c] | gate the shaft RTT `autoUpdate` |
| 52 | kaleidosonic | 1·3·1·5 | trivial; 49-ray CPU march ×4 at start (`world.js:340-396`) [c] | ~9 [c] | (c) `Loop(96)` × layout'd `Loop(10)` fold (`temple.js:120-132`, `tsl.js:49-82`) [c] | trivial [c] | **full-res, full-screen 96-step fractal march at DPR 1.15** [c] | march into an RTT at 0.6-0.75 + upsample; DPR 1.0 |
| 53 | murmuration | 2·1·2·5 | 60k-mote init run twice (`fluid-particles.js:252`, `theme.js:328`) [c] | 2 render + 1 compute; MRT [c] | clean [c] | MutationObserver + gBCR per lock (`theme.js:466-555`) [c] | 60k additive bokeh quads into MRT + 20-noise nebula; **DPR cap 2** (`theme.js:201`, `389`) [c] | DPR cap 1.15-1.35 (HiDPI only); init once; nebula at low res |
| 54 | void-ember | 2·3·1·3 | fbm 1.31M + 349k half floats (`tsl.js:190-258`) [c] | 14; 3 identical rock materials (`belt.js:165`) [c] | `veWaveLight` 16 unrolled bells in 5 stages [c] | clean [c] | 266k rock vertices running ungated `veWaveLight` [c] | share the rock material; gate waves |
| 55 | galaxy | 2·2·1·3 | noise 1.31M + 84k-star plan with 168k throwaway arrays (`plan.js:141-142`) [c] | 12 [c] | small unrolls inside uniform `If`s [c] | `warm` closure [c] | sky dome every pixel (depthTest off); 84k stars [c] | direct writes; cache noise |
| 56 | astral-weave | 2·2·1·3 | noise "≈40 ms" (own comment, `tsl.js:123-192`); compute not awaited (good) [c] | ~22; 2 gimbal constant variants [c] | small [c] | separate `renderer.compute` submit per frame [s] | 14k compute + additive hoops [c] | cache noise; gimbal uniforms |
| 57 | chromadelic-highway | 2·2·2·2 | light; 5 × 2k textures decode on early frames [s] | 11 [c] | layout'd [c] | **1 Hz `setInterval` forced layout** (`theme.js:1694`); double resize listener (`theme.js:1977`, `2159`) [c] | moderate [c] | ResizeObserver instead of polling; one resize path |
| 58 | parhelion | 1·2·1·3 | small [c] | 7; implicit MSAA-4 via `renderer.samples` (`parhelion-post.js:83`) [c] | clean (34/37 Fns layout'd) [c] | zero allocations [c] | dome + snow + 4000 dust [c] | explicit `samples:0` |
| 59 | rainy-window | 1·1·1·4 | 50k-rain JS push (`:393-411`) [c] | ~10 GLSL; 512² mirror [c] | — | `new Vector3` per frame (`:941`) [c] | **mirror re-renders 50k rain + fog every frame; 200 huge 5-snoise fog sprites always on (state machine dead, `:696-701`)** [c]/[s] | rain/fog off the mirror layer or a 256² mirror; fewer/smaller fog sprites |
| 60 | synthwave-sunset | 1·1·3·2 | small [c] | ~17; palms double-pass (`palms.js:194-197`) [c] | layout'd [c] | 4 `addUpdateRange` per spark → one `writeBuffer` each, bursts ≤260 (`fx.js:53-57`); DRS RT realloc; 1 s poll [c] | light [c] | one range per burst; `forceSinglePass` palms |
| 61 | nimbus-veil | 1·1·1·3 | trivial [c] | 7; MSAA-4 [c] | layout'd [c] | DRS `resize` every 0.5 s possible; 1 Hz poll (`theme.js:275-298`, `479-505`) [c] | 16 full-res ray taps on `sceneColor`, though the header says bloom (`post.js:153`, cf. `5-7`) [c] | sample the bloom texture; DRS hysteresis |
| 62 | neon-dusk | 1·1·2·2 | ~48.5k mountain vertices × 8 Perlin (the header says ~17k) (`mountains.js:183-239`) [c] | 14 [c] | layout'd [c] | ~1160 unmerged update ranges per 4-line clear (`fx.js:50-53`); DRS realloc; 1 s poll [c] | light [c] | merged ranges; DRS hysteresis |
| 63 | blood-moon | 2·1·1·1 | serial image → bake → `compileAsync` chain (`pg/blood-moon.effect.js:398-413`) [c] | 9 [c] | — | clean [c] | light [c] | run `compileAsync` in parallel with the image waits |

---

## 2. Fleet-wide patterns (same anti-pattern in many themes)

**P1. Deterministic CPU bakes redone on every build, uncached and mostly unsliced** [c].
- 37 theme folders define their own CPU noise bake (`bakeNoise`/`bakeFbm`/`createNoiseTexture`/…). Most are the same copy-pasted 4-channel × 5-octave 256² gradient fBm: ≈1.3M inner iterations, plus ≈350k `DataUtils.toHalfFloat` for CPU mips. 27 themes call `toHalfFloat` per texel.
- Every rebuild pays it again: re-entry after a dispose, a quality change, a Level-mode return to a theme.
- Only black-hole, cinder-drift (bake only), pyrestorm, rainbark, blood-moon and verdant-hills' layout cache at module level.
- Biggest uncached bakes:
  - serenity-warp ≈ 39M (`serenity-warp-world.js:339`)
  - stellar-velocity ≈ 31M (`stellar-velocity-tsl.js:156`)
  - voltage-storm 9-21M (`voltage-storm-world.js:253`)
  - luminous-tides ≈ 19M (`luminous-tides-core.js:696`, `722`)
  - thermal-bloom ≈ 18M (`thermal-bloom-bake.js:255`)
  - sunset ≈ 14M (`sunset-core.js:263`, `290`)
  - koi-pond ≈ 10M (`koi-pond-bed.js:32-126`)
  - sky-children (5 × 512², `sky-children-world.js:471`)
  - stellar-drift ≈ 6.3M + 1.4M half floats
- Fix template: `cinder-drift-tsl.js:106-122` (`bakedOnce`) or `pyrestorm-world.js:76-88`, caching the half-float mip arrays too, since cinder re-converts them every build.
- Caveat: the forest family's 65k noise consumes the theme rng, so memoizing it shifts later layouts [s].

**P2. `await createRenderer()` before independent I/O and bakes** [c]. The device request, assets and bakes run strictly in series in ≥20 themes:
- forest family ×5, verdant-hills, high-coast, painted-ages, himalayan-peak, pyrestorm, crystal-cave (3.77 MB GLB), stillwater (troll GLB fetched only after the build), cosmic-noir (7.1 MB PNG), and the template themes that bake after the await
- The only overlap model is black-hole (`black-hole-theme.js:133-137`): start the bake/fetch promise first, await both.

**P3. Planar reflectors: a second scene render, and a pipeline doubling when the main pass is MSAA** [c].
- `reflector()` defaults to `samples: 0` (`node_modules/three/src/nodes/utils/ReflectorNode.js:230`, `416`), and the WebGPU pipeline key includes the sample count (`node_modules/three/src/renderers/webgpu/WebGPUBackend.js:2464-2466`).
- Every reflected material in an MSAA-4 theme therefore gets 2 pipelines. Affected (MSAA-4 on High + reflector): stillwater (~23), halcyon-apex (12), vesper-chrysalis (12), lunara (~13), ice-temple (6), neon-district, bioluminescence, chiral-gold, neon-dusk and aurora (when AA is on).
- 7 of the 14 reflectors also regenerate a mip chain every frame (`generateMipmaps: true`).
- Whether Dawn's shader cache absorbs the duplicate DXC work is [s]; the extra `createRenderPipeline` calls are [c].

**P4. Template post stack** [c]:
- 56 themes use `bloom()`. BloomNode = 7 pipelines, 11 RTs and 12 passes per frame.
- Most add a full-res output pass with 5 calm-rect SDFs plus 6-16 JS-unrolled ray/shaft/streak taps.
- 21 themes run an MSAA-4 HalfFloat scene pass on High: bioluminescence, chiral-gold, cinder-drift, geode, halcyon-apex, himalayan-peak, ice-temple, lunara, neon-district, neon-dusk, nimbus-veil, ocean, sky-children, stellar-drift, stillwater, synthwave-sunset, tornado, vesper-chrysalis, void-ember, voltage-storm, winter. Aurora and parhelion inherit it when AA is on.
- Without FXAA, the output pass IS the final composite, so it compiles **synchronously** even under the async session (§0.2).
- 16 themes end in `fxaa()`. That adds a full-res RTT + pass every frame (`node_modules/three/examples/jsm/tsl/display/FXAANode.js:364`), but their heavy output pass then compiles async and only the small FXAA quad is synchronous.

**P5. Uniform-reading lighting/sky helpers as plain JS, inlined per call site** (the theme headers deliberately avoid `setLayout`, see `sakura-light.js:164-171`) [c].
- Large copies per material:
  - sky-children `skyBase` ~30
  - rainbark `rbAir` ~7 in the backdrop
  - moonlit-greenhouse `mgSurface` in ~15 materials
  - halcyon `ha*`
  - vesper `vcBackdrop` ×2
  - sunset `skyColour` ×2
  - fluid-dreams `skyColour` ×5
- Pure helpers that could take a layout today:
  - pyrestorm plume axis (`pyrestorm-plume.js:175-204`)
  - sunset `glintLobe` (`sunset-tsl.js:456`)
  - nebula-flow `shapeAt` (`nebula-flow-nebula.js:86`)
- This is the theme-scale (d) pole: minor per the sweep's bisect when helpers are small, but these bodies are big.

**P6. JS-unrolled uniform-slot loops (lock slots, clear fronts, pulses, rings, waves)** [c].
- These are not raymarch-scale, but they recur in almost every theme and inflate every material that includes them:
  - `*LockLight` 4-8 slots + `*ClearLight` 2×4 in neon-district (16 sites), bioluminescence, lunara, halcyon, cinder-drift, ice-temple, geode, galaxy, void-ember
  - forest `glow()` ×5 in ~20 graphs
- Template for the TSL `Loop` form: `sakura-light.js:206-223`.

**P7. Identical graphs compiled as separate materials because a JS constant or buffer is baked in** [c]:
- forest/summer/golden-forest/fall/verdant-hills trees, one per asset or bucket (`instancedBufferAttribute` inside the graph)
- mist banks with index literals: forest 4, summer 4, golden-forest 5, sakura 4, fall 4
- summer garlands 5; golden-forest ribbons 3
- tornado children 3; chiral-gold hand/index
- moonlit-forest ridge/forest layers 6; nimbus veils 2; astral-weave gimbals 2; void-ember rocks 3; stillwater boughs 2
- Fix template: `sakura-forest.js:141-145`, `281-288` (per-instance data as geometry attributes, one material).

**P8. Whole-buffer instanced uploads with no update range, often while idle** [c].
- Per frame:
  - sky-children spray/glows
  - forest, summer, golden-forest, sakura CPU particle sims (sakura ~240 KB)
  - verdant seeds (~77 KB)
  - koi spray/pools
  - crystal-cave sparks
  - luminous glows (~48 KB)
  - pyrestorm smoke
  - painted-ages rain motes (~131 KB)
  - serenity-warp glass
  - halcyon crystals
- At ambient rate: cinder-drift 256 KB per emit.
- The opposite failure, one `writeBuffer` per range (three r186 does not merge ranges, `WebGPUAttributeUtils.js:241-262`): neon-dusk ~1160 per clear, synthwave-sunset 4 per spark.
- Model: `supernova-fx.js:285-296`.

**P9. Per-frame garbage in the frame plumbing** [c]:
- `this.post.update({ time: this.time })` literal in **37 themes**.
- `getFrame()` built twice plus `{...frame}` spreads in forest, summer, golden-forest, sakura, fall, verdant-hills.
- `palettePhase`/`paletteRGB`/`linRGB` returning fresh objects (stellar-velocity, nebula-flow, void-ember, ice-temple, neon-district).
- Each is small, but in the forest family it adds to a measured 7.2 ms/frame.

**P10. Forced layout reads on timers or events** [c]:
- 0.75 s `querySelectorAll` + gBCR + `getComputedStyle` inside rAF: forest, summer, golden-forest, sakura, fall, verdant-hills, crystal-cave.
- 1 s `setInterval`: chromadelic-highway, nimbus-veil, neon-dusk, synthwave-sunset.
- Per lock/clear: wolfhour, murmuration (plus a subtree MutationObserver).
- Template: trigger-scheduled re-reads at 0/0.5/1.5 s (winter, stillwater, koi-pond, parhelion).

**P11. DRS or adaptive scalers without hysteresis reallocate post targets** [c]: nimbus-veil (0.5 s), neon-dusk (0.5 s), synthwave-sunset, cosmic-noir (≥0.005 change), black-hole (0.75 s), chromadelic-highway.

**P12. Transparent + DoubleSide without `forceSinglePass` = 2 draws + 2 pipelines** (`node_modules/three/src/renderers/common/Renderer.js:3782-3790`) [c]:
- aether-tides (4 materials)
- chromatic-impasto (3)
- synthwave-sunset palms
- plus the double-sided transparent shells in pyrestorm (anvil) and tornado.

**Worst themes per axis** (from the scores):
- **start:** sky-children, forest, summer, serenity-warp, sunset, pyrestorm (first visit), then thermal-bloom, verdant-hills, high-coast, chiral-gold, crystal-cave, koi-pond.
- **compile:** sky-children, forest, rainbark, chiral-gold, fluid-dreams, solar-eclipse, then summer, verdant-hills, high-coast, thermal-bloom, serenity-warp, sunset, pyrestorm, aurora, moonlit-greenhouse, stillwater.
- **frame CPU:** sky-children, forest, sakura-twilight, verdant-hills, cinder-drift.
- **frame GPU:** kaleidosonic, fluid-dreams, sky-children, moonlit-greenhouse, thermal-bloom, summer, verdant-hills, high-coast, crystal-cave, neon-district, misty-lake, serenity-warp, murmuration, chiral-gold, stellar-velocity.

---

## 3. The 10 best quick wins (small change, likely big effect)

1. **Memoize the deterministic bakes at module level** (P1). Each is ~3 lines on the `bakedOnce` model (`src/themes/cinder-drift/cinder-drift-tsl.js:106-122`), with the half-float arrays cached too.
   - Start with the biggest:
     - `src/themes/serenity-warp/serenity-warp-world.js:339-340`
     - `src/themes/stellar-velocity/stellar-velocity-tsl.js:156`, `372`
     - `src/themes/luminous-tides/luminous-tides-core.js:696`, `722`
     - `src/themes/sunset/sunset-core.js:263`, `290`
     - `src/themes/voltage-storm/voltage-storm-world.js:253`
     - `src/themes/koi-pond/koi-pond-bed.js:191`
     - `src/themes/sky-children/sky-children-world.js:471-476`
   - Effect: every rebuild, re-entry and Level-mode return skips tens to hundreds of ms of main thread [s]. The first visit is unchanged.
2. **Start fetches and bakes before `await this.createRenderer()`** (P2), then await both.
   - Sites:
     - `src/themes/crystal-cave/crystal-cave-theme.js:126` → `:146` (3.77 MB GLB; also cache it per session, `crystal-cave-assets.js:121`)
     - `src/themes/painted-ages/painted-ages-theme.js:199` → `:227` (plus `Promise.all` the 3 PNGs, `painted-ages-assets.js:138-156`)
     - `src/themes/high-coast/high-coast-theme.js:199` → `:227` (`high-coast-assets.js:152-170`)
     - `src/themes/stillwater/stillwater-theme.js:224` vs `:272` (troll)
   - Effect: start wall time [s].
3. **Slice pyrestorm's first-visit bake.** `bakesOnce()` runs before the first `yield` (`src/themes/pyrestorm/pyrestorm-world.js:90-93`), so the existing `bakeSliceMs` breathing never applies to the two 1024² lava fields and the 512² billows. Make them generators and `yield*` them, and start `prepare` before the renderer await (`pyrestorm-theme.js:204`/`232`). Effect: removes one long task on first visit, a likely part of the measured 2.2 s [s].
4. **voltage-storm: count only live shocks.** `this.u.shockCount.value = SHOCK_SLOTS` (`src/themes/voltage-storm/voltage-storm-world.js:244`) is never lowered, so `vsShockRings` (`voltage-storm-tsl.js:493`) loops 10 rings on every water pixel at rest, against the file's own header (`tsl.js:12-13`). Keep live rows at the front and write the count. While there, set bolt `mesh.count` to the live maximum (`voltage-storm-bolts.js:372`). Effect: per-frame GPU at rest [c mechanism].
5. **high-coast cumulus 26× unroll → `Loop(BILLOWS)`** (`src/themes/high-coast/high-coast-cumulus.js:153-162`). The body already indexes `billows.element(id.mul(BILLOWS).add(k))`, so `k` becomes the loop index with no restructuring. Effect: compile (pole a/c, the largest unroll in the fleet) [s].
6. **Ranged uploads for idle-time particle pools** (P8). The two worst cost one line each:
   - `src/themes/cinder-drift/cinder-drift-fx.js:169-173`: 256 KB per ambient emit, several times a second with no gameplay. Use `addUpdateRange(cursor*4, n*4)`.
   - `src/themes/luminous-tides/luminous-tides-glows.js:98-102`: 47.6 KB every frame. Use `addUpdateRange(0, mesh.count*4)`.
   - Then the sims: `sakura-petals.js:109-119`, `verdant-hills-seeds.js:164-174`, `painted-ages-motes.js:176-182` (`dirtyFrom/To` already tracked).
   - Effect: CPU and bus [s size].
7. **koi-pond: stop 6400 swaying leaves casting into a 2048² shadow map that redraws every frame.** The leaves set `castShadow = true` (`src/themes/koi-pond/koi-pond-garden.js:597`), and the map has no `autoUpdate=false` (`koi-pond-light.js:142-151`). Try `castShadow=false` on the leaves, or High `shadows: 1024` (`koi-pond-quality.js:75`). Effect: GPU [s]; needs a visual check.
8. **Match the sample counts of the scene pass and the reflector** (P3). Either High `msaa: 0` (+ FXAA where wanted) or `reflector({ samples })` equal to the pass. Start with stillwater (`src/themes/stillwater/stillwater-post.js:65`, ~23 duplicate pipelines), then halcyon-apex, vesper-chrysalis, lunara. Effect: pipeline count, plus bandwidth if MSAA is dropped [c key / s time].
9. **fall: prime the shadow rig into a scene-pass-shaped target.** `src/themes/fall/fall-post.js:48` (`if (!light.sun.shadow.map) renderer.render(scene, camera);`) compiles every scene pipeline for the canvas target, which the `pass({samples:0})` scene pass never uses. Copy `src/themes/forest/forest-post.js:103-119` (a 4×4 HalfFloat target with a depth texture). Effect: start/compile, a whole wasted pipeline set [c mechanism].
10. **`forceSinglePass = true` on transparent DoubleSide materials** (P12):
    - `src/themes/aether-tides/aether-tides-fx.js:169` and `aether-tides-stars.js:76` (additive, so order-independent)
    - `src/themes/chromatic-impasto/chromatic-impasto-canvas.js:209`
    - `src/themes/synthwave-sunset/synthwave-sunset-palms.js:196`
    - Effect: −1 pipeline and −1 draw per material per frame [c mechanism]; needs a visual check on the impasto stamps.

Runners-up:
- **waves:** gate the shaft RTTs (`waves-post.js:303-314`) when the sun is off-screen.
- **forest family:** one `getFrame()` per frame (`forest-theme.js:559-560` + 4 copies).
- **murmuration and moonrise-summit:** DPR caps of 2.0 (`murmuration-theme.js:201`, `moonrise-summit-theme.js:164`); HiDPI only.
- **halcyon-apex:** time-based shadow cadence (`halcyon-apex-world.js:1074-1075`).
- **aurora:** arcs → `Loop` (`aurora-curtains.js:182`).
- **moonlit-forest:** mx → baked noise texture (pole b; the last mx in the fleet).
- **nebula-flow:** light taps → `Loop` (`nebula-flow-nebula.js:305-307`).
- **rainy-window:** keep rain and fog out of the 512² mirror (`rainy-window-theme.js:181-193`).
- **geode:** pack only the struck crystal (`geode-crystals.js:225-235`).

---

## 4. Suggested readings for the measuring session (to confirm or refute)

- **Start, S5/S4 themes:**
  - long tasks inside `createScene` (Performance trace)
  - `switchWallMs` and `firstFrameGpuDoneMs` on an **uncovered** switch (Hub › Themes, or the Level-mode level-up), against the overlay-covered mode start (§0.1)
- **Compile:**
  - per-pipeline rows for sky-children (stone/dome), rainbark (backdrop/near trunk), chiral-gold (6 tower PBR), fluid-dreams (liquid), solar-eclipse (dome), stillwater (water, post-rebuild), aurora (curtain), high-coast (cumulus, land, sea), forest (bark/foliage count)
  - for P3: count `createRenderPipeline` calls with the reflector on and off in stillwater
- **Per frame:**
  - GPU: kaleidosonic, fluid-dreams, verdant-hills (cloud march), moonlit-greenhouse, thermal-bloom, koi-pond (shadow), voltage-storm at rest (shock loop)
  - CPU: forest, sakura-twilight, verdant-hills, cinder-drift at rest (upload rate)

---

## Appendix: per-theme detail (rank order)

Each section repeats the theme's score and lists every finding with file:line and its tag. Paths are relative to the prefix stated in each section.

### 1. sky-children — S5 K5 C4 G5
Own WebGPURenderer (antialias off, depth off), RenderPipeline post, `safeAnimate`. Path prefix `src/themes/sky-children/sky-children-`.
- **Start:**
  - `world.build()` runs fully synchronously after `await createRenderer` (`theme.js:258` → `293-302`). It has no time slicing and no module cache for bakes (`world.js:471-476`) [c].
  - High-tier bakes, all at 512² (`quality.js:148-164`) [c]:
    - sky: 3 fbm + 3 Worley (`core.js:1221-1244`)
    - stone: 4 fbm + 2 Worley (`core.js:1256-1279`)
    - sea: 3 fbm, 4 cap octaves × 9 neighbours, 17-tap ×2 box blur (`core.js:1113-1210`)
    - optics LUT: 512 × 16 subsamples (`core.js:919-938`; only the fine rows are module-cached)
    - puff: 128² (`core.js:1287`)
  - `createFieldTexture` converts to half float in a JS loop: 512²×4 = 1,048,576 `DataUtils.toHalfFloat` calls (`tsl.js:136-137`) [c].
  - Isles: CPU Perlin fbm (4 oct) per vertex. The Spring massif is 112×72 radial plus 224-segment terraces, groves and satellites (`mergeVertices`, `mergeGeometries`, `computeVertexNormals`) (`isles.js:52-94`, `2809-2976`) [c]. Tens of ms [s].
  - `fitSpray` re-runs `sprayPuffs` 6× per layout solve (`world.js:2213-2214`) [c].
- **Pipelines:**
  - 13 scene materials, including 5 distinct stone graphs (`isles.js:2776-2801`) [c].
  - Post: MSAA-4 scene pass on High, BloomNode 0.45 with a custom highpass, output pass with 3 halation reads + 5 calm-rect SDFs (`post.js:111-267`) [c].
  - No MRT, shadows, compute or extra scene render [c].
- **Compile:**
  - (a) Lamp loop JS-unrolled 10× on High (12 on Ultra) inside the spring stone material (`isles.js:2424-2432`) [c].
  - (a) `deepColour` shelf loop, 2× in both dome and sea; each copy has 3 texture reads plus `tollRings`/`casterShadow` (`tsl.js:1083-1106`) [c].
  - (a) Smaller unrolls: storm shafts 6× (`tsl.js:695-699`) [c].
  - (c) Sky dome `skyColour` is the largest graph [c]:
    - 2 star layers, Milky Way, rays, cirrus, `altoDeck` (5 reads), banks
    - `stormWall` `Loop(4)`, `bowStrokes` `Loop(7)` + `Loop(5)` (`sky.js:30-44`, `tsl.js:1137-1262`)
  - (c) `optics()` is inlined in 5 materials (dome, sea `sea.js:213`, cumulus, falls `falls.js:467`, spray `fx.js:285`) [c].
  - (d) `skyBase` (~25 nodes, 5 exp) has no layout. Directly and via `horizonHaze`/`airColour`/`seaTone` it is inlined ~5-6× per stone material, ~30 copies in all (`isles.js:2385`, `2417`, `2462-2475`). The theme avoids layouts on purpose (`tsl.js:23-24`) [c].
- **Frame CPU:**
  - Up to 1100 closed-form spray puffs per frame: 4 `hash()` calls, fall evaluation and trig each (`world.js:2079-2181`) [c].
  - The sort makes one `data.subarray()` per puff plus a comparator sort (`fx.js:348-350`) [c].
  - Full-buffer uploads with no update range (`fx.js:135`, `fx.js:354`, `gliders.js:135`) [c].
  - ~30-40 small closures/arrays per frame (`world.js:2225-2240`, `2256`, `1714-1754`, `1656-1662`; `post.update({time})` at `theme.js:747`) [c].
- **Frame GPU:**
  - Sky dome (64×32 sphere) shades every sky pixel at DPR ≤1.15 [c].
  - Sea fragment: 2 deep shelves, optics, `casterShadow` Loop(8), Discard (`sea.js:130-216`) [c].
  - Up to 1100 optics-shaded premultiplied spray billboards plus 230 cumulus puffs: overdraw [s].
  - MSAA-4 + bloom [c].
- **Quick wins:**
  1. `fx.js:349`: indexed copy instead of `subarray`; `addUpdateRange(0,count*12)` at `fx.js:135`, `354` (CPU/GC) [s].
  2. Cache bakes, including the half-float arrays, at module level by (size, seed) as rainbark does (`world.js:471-476`, `tsl.js:136-137`). Every rebuild and return visit gets faster [s].
  3. `setLayout` on `skyBase` (`tsl.js:200-231`). Beware the nested-layout WebGL2 note at `src/themes/rainbark/rainbark-tsl.js:271-273` (compile) [s].
  4. Lamp loop → `Loop(lamps)` (`isles.js:2424`) (compile) [s].

### 2. forest — S5 K5 C4 G4
WebGPURenderer, own rAF loop (`src/themes/forest/forest-theme.js:599-628`). Post on High: RenderPipeline with GodraysNode, bilateral blur, BloomNode, grade and FXAA (`forest-post.js:48-94`). Prefix `src/themes/forest/forest-`. Plan row T8: measured ~6 s cold first frame and ~7.2 ms CPU/frame [prior measurement].
- **Start** (likely causes of the 6 s cold first frame, in order):
  1. `buildShadowRig()` runs inside the `ForestPost` constructor, still inside `createScene`. It does a full `renderer.setRenderTarget(4×4 HalfFloat); renderer.render(scene, camera)` (`post.js:54` → `103-119`) [c].
     - Every scene material and every shadow-caster variant requests its pipeline in this one call. Under the mode-start loading surface they go async. On an uncovered switch (Level-mode level-up, Hub) they are synchronous [c].
     - [s] This is the bulk of the 6 s.
  2. Material count is inflated by per-asset and per-bucket materials, because `instancedBufferAttribute(...)` is baked into each graph (`trees.js:84`, `207-209`, comment at `trees.js:315`) [c].
     - bark: one material per GLB, 10 in total (`trees.js:174`)
     - foliage: one per bucket, 5 kinds × 2 (`trees.js:316`)
     - Result: about 20 tree materials plus about 20 shadow variants for 3 species.
  3. Serial awaits: `await this.createRenderer()` (`theme.js:199`), then `await this.loadAssets()` (`theme.js:227`) for 14 files. The two are independent [c].
  4. `forest-firefly-director.js:101` lays out all 11 figures eagerly. Each has 560 lights on High and runs a grid of distance evaluations, rejection sampling and an O(lights × 4·lights) farthest-point loop (`figures.js:722-789`). The result is module-cached in a WeakMap (`figures.js:856`), so this costs the first start only [c]. Tens to 100+ ms [s].
  5. Smaller CPU work [c]:
     - terrain 209×186 ≈ 39k vertices, each with a `positions.set([...])` literal, plus 231k `indices.push` and `computeVertexNormals` (`terrain.js:92-116`)
     - height texture: 53k `forestGroundHeight` calls, each allocating two `{s,d}` objects (`light.js:83-89`, `plan.js:29`, `terrain.js:35`, `42`)
     - noise 65k (`light.js:42-59`)
     - foliage site loop with a 16-element spread push (`trees.js:274-302`)
     - GLB decode through dynamic getters on every start, with no cache (`assets.js:32-39`)
- **Pipelines:**
  - About 37 material instances, about 22 distinct WGSL [c]:
    - 10 bark, ~10 foliage, terrain, timber, stone, ferns ×2, grass, fungi, flowers
    - sky, 4 mist banks with index literals baked in (`sky.js:186-196`)
    - motes, far sprites, ridges, firefly lights and trails
  - Moon shadow map 2048×1024 with `autoUpdate=false`. It is redrawn on frames 0-9, 45 and 150, and at 2, 5, 10 and 20 s (`light.js:194`, `436-444`). About 24 shadow pipelines [c].
  - Post: godrays at 0.5, 2 blur passes, bloom chain, grade+FXAA. About 17 passes per frame [c].
- **Compile:**
  - (a) No `If` chains, but pulse loops are JS-unrolled 5× on High inside inlined helpers [c]:
    - `glow()` (`light.js:298-308`, ~20 nodes per pulse plus a texture lookup and `groundAt`) is inlined in ~20 graphs: `trees.js:149`, `249`; `terrain.js:157`; `understory.js:174`, `202`, `348`, `431`, `545`, `595`; `sky.js:206`; `backdrop.js:163`
    - `pulseShove()` (`light.js:413-421`) ×5 in 3 vertex graphs
    - `stir()` (`light.js:329-335`) ×5 in 2 graphs
  - (d) `haze()`, `night()` and `ambient()` are inlined into every material; `wander()` 3× (`fireflies.js:122`, `174-175`) [c].
- **Frame CPU:**
  - Firefly sim over 1056 ambient flies on High: wander (8 trig) plus `force()` (`firefly-sim.js:302-327`), and `write()` flash (4 exp) for all of them (`firefly-sim.js:384-401`) [c].
  - `shed()` splat 5×5 (`firefly-sim.js:436-447`) [c].
  - `commit()`: 9216 `Math.exp` + `round` (`light-field.js:76-81`) [c].
  - Awake forest: about 7k extra `hypot` calls (`firefly-director.js:345-362`) [c].
  - Uploads every frame: 3 × 38.4 KB (`fireflies.js:208-213`), including the 56% dark reserve, plus the R8 light field, because `commit()` always sets `dirty` (`light-field.js:80`) [c].
  - Reactions frame built twice: `this.reactions?.update(dt); const frame = this.reactions?.getFrame();` (`theme.js:559-560`). Each build spreads and does `filter().map()` (`reactions.js:554-577`); spread again at `world.js:233` [c].
  - 0.75 s board poll inside rAF: `querySelectorAll` + gBCR + `getComputedStyle` (`stage.js:29-34`, `theme.js:562-566`) [c].
- **Frame GPU:**
  - godrays 26-31 shadow steps at 0.5 + 2 blur passes [c]
  - bloom + full-res grade+FXAA at DPR 1.25 [c]
  - 4 transparent mist planes 380-1030 m wide, each pixel running 2 noise reads, `groundAt`, PCF and `glow` (`sky.js:213-214`) [c]
  - sky dome with 5 noise reads and 2 star lattices [c]
  - 2400 billboards + 2400 trail ribbons [c]
  - 16 shadow redraws in the first 20 s, including the 77k-triangle terrain [c]
- **Quick wins:**
  1. Prime the shadow map with a one-object render, as sakura does (`src/themes/sakura-twilight/sakura-world.js:140-149`), instead of the full-scene render at `post.js:103-119` (start, large) [s].
  2. Move per-tree/per-spray data onto geometry attributes, as sakura does (`sakura-forest.js:141-145`, `281-288`): bark+foliage ~20 → 3-6 materials, and the shadow variants with them (`trees.js:84`, `207-209`) (compile/start, large) [s].
  3. Turn the pulse loops into a TSL `Loop`, as sakura does (`sakura-light.js:206-217`) (`light.js:298-308`, `329`, `413`) (compile) [s].
  4. Lay figures out lazily (`firefly-director.js:101`); skip the light-field commit and upload when nothing changed (`light-field.js:80`) (start/CPU) [s].

### 3. summer — S5 K4 C3 G5
WebGPURenderer, own rAF loop. Post is the forest stack (`src/themes/summer/summer-post.js:46-91`) plus a planar reflector. Prefix `src/themes/summer/summer-`.
- **Start:**
  - Lake map: 512×384 = 196,608 texels × `summerGroundHeight` + `summerShoreDistance`. Both call `summerShores()`, which returns a fresh object holding 7 terms, so about 393k object allocations (`terrain.js:83-95`, `180-196`) [c].
  - Meadow map: 131k × path distance (`terrain.js:207-226`) [c].
  - Terrain grid: ~45k vertices with array literals, ~270k index pushes, normals (`terrain.js:268-292`) [c].
  - Meadow scatter (`meadow.js:106-107`, `200-226`, `281-300`) [c]:
    - grass: 10k + 22k plants × ≤6 attempts, each calling `summerMeadowCover` + `summerGroundHeight` (both through `summerShores`)
    - flowers: 3.6k + 20k × ≤8 attempts, each allocating a weights array
    - `plant()` allocates 2 arrays per instance
  - Serial awaits `theme.js:178` → `205` [c].
  - Full-scene prime render `post.js:52` → `100-116` [c].
- **Pipelines:**
  - About 44 material instances (34 `new *NodeMaterial` sites) [c]:
    - 9 bark (`forest.js:180`) + foliage per bucket (`forest.js:317`)
    - 4 mist banks with index literals (`atmosphere.js:119-139`)
    - 5 garland ribbons with baked constants (`garlands.js:46-97`)
    - 2 homestead variants
    - grass and flowers share one material each (good)
  - Shadow 2048×1024, ~21 caster variants (`light.js:170`) [c].
  - Reflector at 0.5 mirrors terrain, forest, backdrop, sky + mist, homestead, shore, life, garlands and petals; the meadow is excluded (`lake.js:43-45`, `world.js:101-102`) [c].
  - Post: forest stack [c].
- **Compile:**
  - (a) JS unrolls [c]:
    - `meadowWind()` 6 waves × ~12 nodes in the grass and flower vertex graphs (`light.js:337-346`)
    - `answer()` 2× in flowers, so `speciesGlow` (16 `step`) twice (`meadow.js:247-252`)
    - lake rings ×8 (`lake.js:100-110`)
    - garland `path()` 2× per ribbon × 5 (`garlands.js:65-66`)
  - (d) `haze()`, `sky()` and `wind()` are inlined in every material; cumulus `billow()` 2× (`atmosphere.js:65-71`) [c].
- **Frame CPU:**
  - Petal sim walks 2400 particles; `write()` touches all of them (`petal-sim.js:205-321`) [c].
  - Both buffers dirtied every frame (`petals.js:166-176`) [c].
  - `getFrame` built twice plus spreads (`theme.js:504-505`, `514`; `world.js:182`) [c].
  - `setHour()`/`aimSun` every frame (`light.js:207-245`) [c].
  - 0.75 s board poll (`stage.js:36-43`) [c].
- **Frame GPU:**
  - Mirror: second scene render at 0.5, including the cumulus sky (6 noise reads) and mist [c].
  - Vertex load: 32k grass clumps + 23.6k flowers, each vertex running the 6-wave wind [c].
  - The "static" shadow map is not static [s]:
    - The hour drifts all the time (`SUMMER_HOUR_SECONDS=240`, `reactions.js:604`, `hours.js:233`) [c].
    - `aimSun` re-renders the 2048×1024 map whenever the sun moves 0.03° and ≥2 frames have passed [c].
    - That means a redraw about every 1-3 s, and every other frame for ~2.4 s after each LEVEL_UP [s].
  - Godrays 26, bloom, full-res grade, 4 mist banks [c].
- **Quick wins:**
  1. Compute `summerShores` once per texel and return numbers instead of an object, or cache/bake the static maps (`terrain.js:180-196`) (start) [s].
  2. Re-aim the sun only during level turns, or with a larger step (`light.js:26`, `207-221`) (GPU spikes) [s].
  3. Share tree materials via geometry attributes (`forest.js:107`, `216-218`); one uniform-driven material for garlands and mist (`garlands.js:46-97`, `atmosphere.js:119-139`) (compile) [s].
  4. Wind loop → TSL `Loop` (`light.js:337-346`) (compile) [s].

### 4. verdant-hills — S4 K4 C4 G5
WebGPURenderer, own rAF loop. Post on Medium and up: scene pass, shaft RTT, bloom, grade, FXAA (`src/themes/verdant-hills/verdant-hills-post.js:57-95`). A cumulus raymarch pre-pass renders every frame. Prefix `src/themes/verdant-hills/verdant-hills-`.
- **Start:**
  - Serial: `createRenderer` (`theme.js:182`), then `loadAssets` (`theme.js:210`) [c].
    - 6 GLBs and 3 PNGs load in one `Promise.all` (`assets.js:235-247`), but only after the device exists.
  - `buildScene` is synchronous, with no breaths (`theme.js:282-306`) [c]:
    - terrain: 60,155 `verdantHillsGroundHeight` calls (~5 value noise + trig + terrace loop each), 59,664 `indices.set([..])` literals, normals (`terrain.js:104-205`, `392-418`)
    - meadow: High asks for 18,000 near + 40,000 far grass + 4,000 flowers (`quality.js:31`). Each plant takes ≤8 `spot()` tries, each a groundHeight plus an object allocation, plus meadowCover and path distance, plus 2 `.set([..])` (`composition.js:137-175`, `meadow.js:91-92`, `192-210`, `280-302`)
    - foliage: spread push per spray site (`trees.js:284-314`)
  - The field and far-tree layout is module-cached, which is good (`layout.js:436-445`) [c].
  - The static shadow map is re-armed on frames 0-9, 45 and 150 (`light.js:549-552`) [c].
- **Pipelines:**
  - About 22 NodeMaterials [c]:
    - bark 1 per asset ×4 (`trees.js:177-181`)
    - foliage 1 per bucket (`trees.js:325-327`)
    - homestead, life ×2, kites, ribbons, seeds ×2, ground, sky, march, grass, flowers, backdrop
  - Shadow-caster depth variants [c].
  - Render targets [c]:
    - cumulus HalfFloat at 0.5 (`sky.js:83-94`)
    - shafts at 0.5 (`post.js:63-66`)
    - scene pass samples 0
    - bloom at 0.45
    - shadow 2048² (`light.js:295-306`)
- **Compile:**
  - (c) Cumulus `Loop(48)` with nested If/Break/If; 3 inlined `cloudDensity` bodies per step, ≤5 taps each (`sky.js:100-143`, `light.js:377-406`) [c].
  - (c) Shafts `Loop(20)` (`post.js:118-126`) [c].
  - (c) Homestead paint computes all 11 albedos, then an 11-step `mix(is(code,M.x))` chain (`homestead.js:151-193`) [c].
  - (a) `meadowWind` 6 rings unrolled in the grass and flower vertex graphs (`light.js:508-517`); path loop ×6 in the terrain (`terrain.js:488-494`) [c].
  - (c) The terrain calls `cloudShadow` 2× and `light.sky` again (`terrain.js:508`, `532-533`) [c].
- **Frame CPU:**
  - Reactions frame built twice: `update()` already returns `getFrame()` (`theme.js:504-505`, `reactions.js:690`) [c].
    - Each build spreads ~25 keys and does `filter`/`map` (`reactions.js:693-731`).
    - Then `{...frame,time}` (`theme.js:514`), `{...frame,front,pool}` (`world.js:167`) and closures (`fx-director.js:615-641`).
  - Seed sim steps 2400 slots; each live seed calls the full analytic `groundHeight` (`seed-sim.js:244`) [c].
  - `write()` touches every slot and `markDirty()` flags both attributes unconditionally, ~77 KB/frame (`seed-sim.js:262-298`, `seeds.js:164-174`) [c].
  - 0.75 s board poll with forced layout (`stage.js:36-44`, `theme.js:506-511`) [c].
- **Frame GPU:**
  - Cloud march every frame at 0.5: 48 steps × ≤11 taps (`sky.js:216-235`) [c].
  - Shafts at 0.5: 20 steps [c].
  - Grass: 18k × 114 + 40k × 28 ≈ 3.17M triangles, double-sided, each vertex running the 6-ring wind (`meadow.js:111-187`, `flora.js:56-89`) [c counts / s ms].
  - FXAA + grade + bloom [c].
- **Quick wins:**
  1. Call `getFrame()` once and mutate preallocated frame objects (`theme.js:504-505`, `514`; `world.js:167`; `fx-director.js:615`) (CPU) [s].
  2. Skip `markDirty` when nothing is live, and use a height grid in the seed sim (`seeds.js:170-174`, `seed-sim.js:244`) (CPU/bus) [s].
  3. Cloud march every other frame or on movement; High `cloudSteps` 48 → ~32 (`sky.js:216-235`, `quality.js:31`) (GPU) [s].
  4. Start `loadVerdantHillsAssets()` before `await createRenderer`; module-cache terrain + scatter (`theme.js:182` → `210`) (start) [s].

### 5. serenity-warp — S5 K4 C2 G5
WebGPURenderer, `safeAnimate`. Post: MSAA-4 on High (`src/themes/serenity-warp/serenity-warp-post.js:63-65`), bloom, 10 rays, 7-tap rush blur, fringe, calm ×5. An extra env-sky pass runs outside the pipeline. Prefix `src/themes/serenity-warp/serenity-warp-`.
- **Start:**
  - `createGasTexture(bakeGasNoise(6151, 64), 64)` (`world.js:339`, `tsl.js:151-241`) [c]:
    - 8 gradient fields × 262,144 voxels × 12 `at()` closure calls ≈ 25M
    - plus 2 cellular fields × 262k × 27 ≈ 14M
    - ~14 transient 1 MB Float32Arrays
  - `bakeFbm()` 1.31M + ~350k `toHalfFloat` (`world.js:340`, `tsl.js:313-412`) [c].
  - Constant seeds and no cache, so every `createScene` and quality rebuild re-bakes synchronously after `await createRenderer` (`theme.js:211`) [c]. Largest CPU bake in its batch [s].
  - 7 `ExtrudeGeometry` (bevel 3) + `mergeVertices` + normals (`glass.js:200-219`, `371-374`) [c].
- **Pipelines:** ~7 materials + bloom (7) + output ≈ 15 [c]:
  - env material (`sky.js:303`) and backdrop (`sky.js:315`)
  - one glass material shared across 7 draws
  - env RT HalfFloat 768×384 (`sky.js:305`, `327-338`)
- **Compile:**
  - (a) `for pass<4 × for i<4` gives 16 JS-unrolled `If(s.x<=t && s.y>t){...}` (`glass.js:324-332`) [c].
    - `boxSlab` is layout'd, so each body is small.
    - The outer `pass` variable is unused: the loop just repeats the same 4 tests 4×.
  - (c/d) `skyLight()` (`sky.js:87-283`) is plain JS, inlined into both env (`sky.js:298`) and backdrop (`sky.js:311`) [c]. Each copy has:
    - ≤6 gas 3D reads
    - 2-3 JS-unrolled star layers
    - 2 TSL Loops
    - 3 nested Ifs, including the jump `If` with 2 fbm reads
- **Frame CPU:**
  - The glass commit dirties all 7 interleaved buffers, ~13 KB/frame, with no range (`glass.js:439-449`) [c].
  - 24-piece × `WAVE_SLOTS` loop (`world.js:1106-1161`); `post.update({time})` (`theme.js:621`) [c].
- **Frame GPU:**
  - The env pass shades 768×384 ≈ 295k px of full `skyLight` every frame: `envEvery:1` on High, counted in frames (`quality.js:55`, `sky.js:342-344`) [c].
  - A full-screen backdrop `skyLight` + MSAA-4 at DPR 1.15 [c].
  - Rush 7 + rays 10 taps [c].
- **Quick wins:**
  1. Module-cache `bakeGasNoise`/`bakeFbm` (constant seeds) (`world.js:339-340`) (start/rebuild, large) [s].
  2. Replace the 16-`If` unroll with a TSL `Loop` over the 4 centres, once (`glass.js:324-332`) (compile) [s].
  3. High `envEvery` 1 → 2, or a time-based cadence (`quality.js:55`, `sky.js:342`) (GPU) [s].
  4. `addUpdateRange(0, used*GLASS_STRIDE)` (`glass.js:447`) (upload) [s].

### 6. chiral-gold — S4 K5 C2 G5
WebGPURenderer, `safeAnimate`. Post: MSAA-4 on High (`src/themes/chiral-gold/chiral-gold-post.js:62`), bloom, star and ray taps. A planar `reflector()` re-renders the scene every frame (`chiral-gold-water.js:64-66`). `scene.environment` is a CPU-baked equirect that goes through PMREM (`chiral-gold-world.js:197`). Prefix `src/themes/chiral-gold/chiral-gold-`.
- **Start:** [c]
  - Noise 1.05M (`tsl.js:85-150`).
  - `createStudioEquirect(1024)`: 524k px × 9 lights + 34 pin lights + ~1.57M `toHalfFloat`; constant seed (`tsl.js:198-325`).
  - Ribbon/wire geometry with per-vertex arrays and `index.set([…])`, ~22k per tower (`helix.js:98-224`).
  - Two 520-step TubeGeometries (`helix.js:385-406`).
  - Canvas-2D tally atlas 1408×160 + `getImageData` (`fx.js:627-676`).
  - PMREM on first use, synchronous even under the async session (`src/rendering/async-render-pipelines.js:84-88`) [c].
- **Pipelines:** [c]
  - 24 scene materials, 10 of them MeshStandardNodeMaterial.
  - `hand` and `index` are baked into the graphs as JS constants (`helix.js:242`, `268`, `304`, `340`; `ring.js:68`, `78`), so the left and right towers and each band compile distinct PBR+IBL pipelines: 6 tower + 3 band.
  - Two scene renders per frame (reflector layer 0 + main).
  - Reflector RT at 0.5 with mips; MSAA-4 RT.
- **Compile:**
  - (a) `pulseBand` ×8 unrolled per vertex in 4 gold + 2 bead materials (`helix.js:235-250`) [c].
  - Ring comets ×6, water ripples ×6 + surge ×4 (`ring.js:75-85`, `water.js:106-133`) [c].
  - The reflector RT's sample count differs from MSAA-4, so variants on top [s].
- **Frame CPU:** [c]
  - `getPostState` → `cardUnion` spread every frame; `fallbackLayout` builds ~8 objects when no board is on screen (`world.js:938`, `composition.js:46-69`, `129`).
  - `ease` closure, `{time}` (`theme.js:529`, `618`).
- **Frame GPU:** [c]
  - Reflector pass (~20 draws at 0.5 + mipgen) + the main MSAA-4 pass of PBR gold with IBL.
  - 3200 bokeh motes; a 6000-quad braid always drawn.
- **Quick wins:**
  1. Drive `hand`/`index` through a uniform or attribute: ~4-5 fewer PBR pipelines (`helix.js:258`, `312`; `ring.js:60`) (compile, large) [s].
  2. Module-cache the studio half-float data (`tsl.js:198`) (start) [s].
  3. Merge the 6 torc ends into one InstancedMesh (`ring.js:131-139`) (draws in both passes) [c].

### 7. sunset — S5 K4 C3 G4
WebGPURenderer (`antialias:false`, `depth:false`), `safeAnimate`. Post: no MSAA (`src/themes/sunset/sunset-post.js:114`), bloom, two-stage shaft RTT, output, FXAA (`post.js:253`). Prefix `src/themes/sunset/sunset-`.
- **Start:** synchronous, constant seeds, no slicing [c]:
  - `bakeSkyNoise(512)`: fbm 6+6+4 ≈ 4.2M + 3 `cellField` × 262k × 9 ≈ 7.1M (`world.js:245`, `core.js:263-280`).
  - `bakeSeaNoise(512)`: ≈2.4M + a gradient pass (`core.js:290-318`).
  - Total ≈14M inner iterations, the largest CPU noise bake per build in its batch.
  - GPU mips + anisotropy 8 (`tsl.js:95-96`).
- **Pipelines:** 5 scene materials + bloom + shaft gather/fill (2 RTTs at 0.5, `post.js:289`, `302`) + output + FXAA [c].
- **Compile:**
  - (c) `skyColour` (~250 lines inline, `tsl.js:205-453`) is emitted in full 2×: the sky (`sky.js:22`) and the sea mirror (`sea.js:173`) [c].
  - (a) JS unrolls [c]:
    - deck slices 5 (sky) / 2 (sea) (`tsl.js:414-430`)
    - `MARIA.forEach` ×12 inside an `If` (`tsl.js:315-318`)
    - 8 swell trains built 2× in the sea vertex stage + 1× in the fragment (`sea.js:85-129`)
  - (d) `glintLobe` is pure but has no layout; inlined 3× in the sea, once inside a Loop (`tsl.js:456-469`; `sea.js:196`, `198`, `211`) [c].
- **Frame CPU:** [c]
  - A `lamps.push({…})` object per live lantern, ≤48 (`world.js:792-794`).
  - A `{x,y,z}` per trail point, ≤12×16 (`world.js:767`).
  - A comparator sort (`world.js:819`).
  - `getPostState` returns a new object + 3 arrays (`world.js:830-845`).
  - Whole-buffer uploads every frame (`lanterns.js:111-113`, `186-188`; `birds.js:184-185`).
- **Frame GPU:** the full sky dome (5 deck slices × 2 fetches + moon + stars + MW + cirrus); the sea with mirrored `skyColour` + 8-train slope + lamp Loop (14 `glintLobe`) [c]. Shafts run even when they are off (`world.js:739`) [s].
- **Quick wins:**
  1. Module-cache the baked bytes (constant seeds) or move them to a worker (`core.js:263`, `290`) (start, largest in its batch) [s].
  2. `Fn().setLayout` on `glintLobe` (`tsl.js:456`) (compile) [s].
  3. Pool lamp records and reuse post-state arrays (`world.js:792`, `830-845`) (CPU) [c].

### 8. thermal-bloom — S4 K4 C3 G5
WebGPURenderer; post: scene pass, bloom, vapour ray-march RTT at 0.5, output, FXAA on High; `safeAnimate`. Prefix `src/themes/thermal-bloom/thermal-bloom-`.
- **Start:** everything runs synchronously inside `world.build()` (`theme.js:253` → `world.js:516-558`) [c]. Total main-thread time: hundreds of ms [s].
  - `bakeNoise(256)`: ≈1.05M lookups plus a CPU mip chain (`bake.js:104-118`) [c].
  - `bakeCellular(256,12)`: ≈590k distance evaluations (`bake.js:124+`) [c].
  - `bakeVapourNoise(48)` (`bake.js:255-384`, `quality.js:104`) [c]:
    - 48³ = 110,592 voxels, 4 gradient passes ≈ 3.5M
    - 5 cellular passes × 27 neighbours ≈ 14.9M
    - 4 `Float32Array.sort`s of 110k values (`bake.js:375`)
    - It feeds only the post march, yet is baked before the first frame (`world.js:554`).
  - `bakeStair` on High (stairBake 512, grid 600×200): ≈382k `gen.sample()` calls, each a tier while-loop plus ~3 fbm (`terraces.js:116-119`, `bake.js:576-699`) [c].
  - Then `computeVertexNormals` on 120k vertices, and 2 DataTextures uploading the same 1 MB layout (`terraces.js:127-134`) [c].
- **Pipelines:**
  - 16 scene materials, one per part via `tbPart` (`tsl.js:759`) [c].
  - Bloom: 7 pipelines and 11 RTs [c].
  - Vapour RTT (`vapour.js:363`), output, and `fxaa(outputFn())` (`post.js:350`). FXAA adds a full-res RTT plus its own pass [c].
  - About 27 pipelines in total; no MSAA on High (`post.js:95`) [c].
- **Compile:**
  - (c) Vapour: `Loop(≤32 bodies)` → `Loop(18)`. Its `body()` closure (~40 nodes with atan/sin/cos) is inlined 3× per step (`vapour.js:236`, `276`, `279`), with 3-4 `texture3D` taps per step plus a mist `Loop(8)` (`vapour.js:148-324`) [c].
  - (c) Basin fragment is ~650 lines with 4 TSL loops: `tbPlumeShade` (`tsl.js:437`), `tbBlooms` (`tsl.js:522-669`, ~120 nodes, 7 taps), `tbFills` (`tsl.js:696`), rosettes (`basin.js:491`) [c].
  - (a) JS unrolls without `If` [c]:
    - 3 jewels × ~30 nodes (`basin.js:440-478`)
    - 3 ripple rings inside the `tbBlooms` loop (`tsl.js:653-658`)
    - 9-tap upsample (`vapour.js:397-403`)
  - (d) Inline helpers [c]:
    - `tbAerial` (`tsl.js:337-350`) 7× in the sky (`sky.js:100-154`)
    - `tbGlint` (cos^256, 3 hashes, `tsl.js:370-392`) 2× in basin and 2× in terraces
- **Frame CPU:** ~80-120 allocations per frame [c]:
  - `rigFrame` returns 1 object + 4 arrays per call (`core.js:768-776`); called at `world.js:2304` and in each `projectToScreen` (`core.js:796-805`).
  - `writeShimmer` makes 3 projections with literal arguments (`world.js:2888-2890`).
  - `eyeHeatCap` builds a 7-field template-string key every frame (`world.js:2166-2168`).
  - `[0,1,2].map` 6× (`world.js:2856`).
  - `filter()` rebuilds at `world.js:1282`, `1310`, `1490`, `1711`, `1961`.
  - `writeVapour` sorts plus an `under` array per body (`world.js:2380-2407`, `2616`, `2659`, `2786`).
  - `post.update({time})` (`theme.js:657`).
- **Frame GPU:**
  - Vapour march at 0.5: 18 steps × each live body box × (3 body evaluations + 3-4 3D taps), plus 8 mist steps [c].
  - Basin fragment with 4 loops (blooms ≤24 slots, plumes ≤14) over about half the screen [c].
  - 40 transparent steam sheets, 2400 spray quads, 420 motes [c].
  - Bloom + full-res 9-tap bilateral upsample + the FXAA RTT pass; DPR ≤1.15 [c].
- **Quick wins:**
  1. Bake the vapour 3D noise after the first frame (`vapourOn=0` until it is ready) or in a Worker (`world.js:554`) (start) [s].
  2. Cache `rigFrame` per plan; give `projectToScreen` an out array; drop the per-frame `.map`s; build the `eyeHeatCap` key only on layout change (`core.js:768`, `world.js:2304`, `2856`, `2166`) (CPU/GC) [s].
  3. Merge the two sun-tap `body()` calls, or layout `body` (`vapour.js:276-279`) (compile+GPU) [s].
  4. One layout texture instead of two; stairBake 384 on High (`terraces.js:129-134`) (start) [s].

### 9. pyrestorm — S5 K4 C2 G4
WebGPURenderer, `safeAnimate`. Post: `pass(samples:0)` + bloom + output (`src/themes/pyrestorm/pyrestorm-post.js:103-242`). Prefix `src/themes/pyrestorm/pyrestorm-`. A prior sweep measured a ~2.2 s in-switch cost [memory].
- **Start:**
  - `const bakes = bakesOnce(); yield 'bakes';` (`world.js:90-93`) [c]. The whole bake runs before the first yield, so `bakeSliceMs` (`world.js:111-113`) never slices it. `bakesOnce` (`world.js:78-88`) is module-cached, so only the first visit per page pays. It runs:
    - `buildChannels`
    - two 1024² `bakeLavaField` calls: segment raster with `Math.hypot`, 8 × 1M arrays per field, 6 box-blur passes (`bake.js:283-399`) [c]; ~10M inner iterations [s]
    - `bakeNoise` 256² and `bakeLattice`
    - `bakeBillows` 512²: 16 tiles × 16k texels × ~25 spheres plus 2 fbm calls per texel (`bake.js:517-585`) [c]
  - Serial: `await createRenderer` (`theme.js:204`), then `await PyrestormWorld.prepare` (`theme.js:232`). The two are independent [c].
  - `landSteps` is sliced, yielding every 24 rows (`land.js:73-119`). At High that is 301×251 fan posts (~24 vnoise each) plus 191×421 cone posts [c], ~5M vnoise [s]. The two `gridNormals` calls each run inside a single slice [c].
  - `build()` is synchronous (`world.js:242-278`) [c]:
    - 4 lava DataTextures, 1024² RGBA8 (16 MB) (`tsl.js:102-108`)
    - noise with GPU mips, lattice, billows
    - Uint32 index loops of 450k + 479k (`land.js:174-190`)
  - Warm roots `[]` and no compileAsync (`theme.js:695-697`) [c].
- **Pipelines:**
  - 11 scene materials, with land shared between 2 meshes [c].
  - Bloom (7) + output, ~20 in total [c].
  - No MSAA, shadows or reflector [c].
- **Compile:**
  - (c) Plume `Loop(28)` on High (40 on Extreme). `densityAt` is built 3× per step, each with 3 `noise3` reads (`plume.js:244-246`, `280-318`) [c].
  - (d) `axisAt`, `axisSlope`, `widthAt`, `alongAt` and `nearestK` are plain JS builders with no layout (`plume.js:175-204`) [c]:
    - `nearestK` is inlined 4×, giving ~14 copies of `axisAt`/`axisSlope` (2-3 `pow` + trig each), most of them inside the loop body.
    - They are pure arithmetic, so layout-eligible.
  - (c) The land `colorNode` is very large: `lavaAt` with 4 field textures, ~12 noise taps, a hits Loop and a lightning Loop (`land.js:207-338`) [c].
  - Jets `state()` is built in both the vertex and fragment stages (`fire.js:167-178`) [c].
- **Frame CPU:**
  - `Smoke.update` walks 168 puffs, insertion-sorts them and dirties 4 attributes every frame, even when none is alive (`smoke.js:226-307`) [c].
  - `updateLights` allocates 1-12 objects + closures + a sort (`world.js:901-944`) [c].
  - `post.update({time})` (`theme.js:679`) [c].
- **Frame GPU:**
  - Full-res plume raymarch over the column footprint (DPR 1.15): ≤9 lattice fetches + ~300 ALU per step [c].
  - Transparent double-sided anvil; 3200 jet streaks + 768 bombs + 640 motes [c].
- **Quick wins:**
  1. Make `bakeLavaField`/`bakeBillows` generators and `yield*` them from `prepareSteps` (`world.js:90-93`). This removes the first-visit long task (start, hundreds of ms) [s].
  2. Start `prepare` before `await createRenderer` (`theme.js:204`/`232`) (start) [s].
  3. `setLayout` on the plume axis helpers (`plume.js:175-204`) (compile, large) [s].
  4. Skip the smoke sort and upload when nothing is alive (`smoke.js:226-307`) (CPU) [s].

### 10. high-coast — S4 K4 C2 G5
WebGPURenderer, `safeAnimate`. Post: single scene pass, bloom on Medium and up, sun-shaft Loop in the output on High and up (`src/themes/high-coast/high-coast-post.js:111-269`). 3 shadow-field RTs, one stale field repainted per frame. Prefix `src/themes/high-coast/high-coast-`.
- **Start:**
  - Serial: `await createRenderer` (`theme.js:199`), then `await HighCoastWorld.prepare` (`theme.js:227`); the two are independent [c].
  - `loadCoast` fetches and decodes 3 PNGs serially (`await` inside the loop), with a JS inflate plus row filters (`assets.js:61-95`, `152-170`) [c].
  - Time-slicing exists: `setTimeout(0)` breaths between fields and every 48 fan rows (`assets.js:25`, `land.js:108`, `world.js:86-96`) [c]. Two chunks are still large [c], so long tasks [s]:
    - `fieldTextureData` (Sobel + 4× `toHalfFloat` per texel) runs as one 1M-texel task per field (`world.js:76-79`, `tsl.js:176-197`)
    - the fan is 560×500 = 280k posts with bicubic `groundHeight` (`land.js:92-111`)
  - `world.build()` is synchronous (`world.js:202-253`) [c]:
    - noise bake 256²×4×≤4 (`tsl.js:59-101`), lattice 256² (`tsl.js:126-146`)
    - fan index: 1.67M writes (`land.js:113-136`)
    - `treeSites`: 22,000 trees, ≤60 tries each, 5 `groundHeight` per accepted site, then 22k compose + `setMatrixAt` + `data.set([..])` (`forest.js:50-92`, `231-244`)
    - needle texture with a CPU mip chain and an 18-step binary search per level (`pine.js:409-552`)
    - sign SDF 512×96×2 (`sign.js:88-110`)
- **Pipelines:**
  - About 25 scene materials, plus 3 shadow QuadMesh materials (`shadow.js:76-101`) [c].
  - Shadow fields 768²/384²/192² RGBA8 on High (`quality.js:88`) [c].
  - Bloom at 0.45 [c].
  - No MRT, compute or shadow maps [c].
- **Compile:**
  - (a) Cumulus: 26 billows JS-unrolled per fragment (sqrt, length, exp, select) plus 7 `noise3` (`cumulus.js:153-186`). This is the largest JS unroll seen in the fleet [c].
  - (a) `hcCells` 3×3 `If`/`ElseIf` is mitigated: it is `.setLayout`, so it is emitted once (`land.js:142-163`) [c].
  - (c) The land colorNode is one very large Fn: `outcropDetail` inlined 3×, `cliffFace`, 6 `If` blocks (`land.js:371-474`) [c].
  - (c) Sea mirror march `Loop(26)` with an If/Else ladder; gust `Loop(8)` (`sea.js:184-208`, `277-305`) [c].
- **Frame CPU:**
  - `post.update({time})` (`theme.js:677`) [c].
  - Array literals per boat and gull (`fleet.js:380`, `386`; `life.js:193`, `222`) [c].
  - Event spikes: motes re-upload 4 attributes (`motes.js:145-163`); up to ~107 CPU `waterSite` marches per clear (`world.js:336-407`, `593-595`) [c].
- **Frame GPU:**
  - Sea at full res: 26 iterations × 6 taps, plus ~9 taps on a hit (`sea.js:277-323`) [c]. Likely the dominant cost [s].
  - Land: 557,882 triangles, 6 vertex taps, up to ~30 fragment taps near the eye [c].
  - Shadow repaint when the sun moves >0.0018 rad: near field 768² × 40 steps × 3 taps ≈ 70M taps per repaint, recurring during hour transitions (`shadow.js:121-139`, `core.js:271`) [s].
  - Shafts `Loop(14)` × 2 at full res; bloom [c].
- **Quick wins:**
  1. Cumulus 26× unroll → TSL `Loop(BILLOWS)` over a uniform array (`cumulus.js:153-162`) (compile, large) [s].
  2. Start `prepare()` before `await createRenderer`; fetch the 3 PNGs in parallel (`theme.js:199`/`227`, `assets.js:152-160`) (start) [s].
  3. Yield inside `fieldTextureData`; module-cache noise and lattice (`tsl.js:176-197`, `59-146`) (start) [s].
  4. High `mirrorSteps` 22 → 16 (`quality.js:86`) (GPU) [s].

### 11. rainbark — S3 K5 C2 G4
Own WebGPURenderer, RenderPipeline post, `safeAnimate`. Prefix `src/themes/rainbark/rainbark-`.
- **Start:**
  - Synchronous `world.build()` after `await createRenderer` (`theme.js:215` → `239-247`) [c].
  - Bakes are module-cached (`BAKES`/`CANOPY`/`FLECK_STOREYS`, `world.js:155-190`), so only the first start of the session pays [c]:
    - patch atlas 512
    - crown field 512² (`core.js:552-554`)
    - leaf lace 256² with 21,000 twigs (`core.js:543-545`)
    - gap mask 256² ×2 oversampled + `gaussianMips` (`bake.js:1364-1437`)
    - 12 `storeyFleck` calibrations
  - None of it is sliced: one long first task [s].
- **Pipelines:**
  - 10 scene materials; near and far trunks are distinct graphs (`trunks.js:323-330`) [c].
  - Post: MSAA-4 scene pass on High, bloom 0.45, output pass with 5 calm rects (`post.js:65`, `125`, `147-150`) [c].
- **Compile:**
  - (a) `impostorRanks` JS loop, 3× on High; each copy has 5 hashes, `rbBounce`, `rbSkyFill`, `rbDrown` and a full `rbAir` (`sky.js:209-252`) [c].
  - (c) Near-trunk material is very large (`trunks.js:171-279` → `rbBark` `tsl.js:2515+`) [c]:
    - `rbBarkEvents`: 4 Loops with big If bodies (`tsl.js:2219-2430`)
    - `rbFleck` pools Loop
    - `rbMoult`, `rbPatchAge` ×2
    - `rbAir` + `rbCanopy`
  - (d) `rbAir` (`tsl.js:1382-1418`, ~100+ nodes incl. `rbAirTransmittance2` `tsl.js:1257-1310`) is a plain JS function [c]:
    - ~7× in the backdrop fragment: canopy 2×, `sky.js:295`, `sky.js:153`, 3 ranks
    - 2× per trunk material, once each in curls, mist and life
- **Frame CPU:**
  - ~8 tiny objects per frame (`core.js:1053`, `core.js:1281`, `theme.js:645`) [c].
  - `curls.updateAmbient` walks 260 slots; each respawn allocates a 24-element literal and re-uploads the whole buffer (`curls.js:379-422`, `553-557`) [c].
  - During a Climb, all trunk buffers are re-uploaded every frame (`world.js:1434`, `trunks.js:366-374`) [c].
- **Frame GPU:**
  - Backdrop is a far-plane triangle drawn after the solids (`sky.js:318-328`) [c].
  - 4 stacked transparent mist sheets + 4 wisps + 600 drops + 388 curl strips: overdraw (`mist.js:183-218`, `quality.js:102`) [s].
  - MSAA-4 at DPR ≤1.15 [c].
- **Quick wins:**
  1. Impostor ranks → TSL `Loop` over a 3-row uniform table: one `rbAir` instead of three (`sky.js:209`) (compile, large) [s].
  2. `setLayout` on `rbAirTransmittance2` (`tsl.js:1257`) removes ~9 copies in the backdrop and 3 per trunk (compile) [s].
  3. High `mistSheets` 4→2-3 (`quality.js:102`) (GPU) [s].

### 12. crystal-cave — S4 K3 C2 G5
WebGPURenderer, own rAF loop with `THREE.Timer`. Post: `pass()` (samples 0) → bloom → graded Fn → `fxaa()`. The pool uses `reflector()` at 0.38 + `viewportSharedTexture`. Prefix `src/themes/crystal-cave/crystal-cave-`.
- **Start:**
  - Serial `await createRenderer` → `await loadAssets` (`theme.js:126`, `146`) [c].
  - `cavern.glb` (3.77 MB) is re-fetched and re-parsed on every start and disposed in `disposeRuntime` (`assets.js:121-131`) [c].
  - Noise: 655k `sample()` calls, each allocating a closure (`light.js:53-100`) [c].
  - Synchronous first `renderFrame()` inside `createScene` (`theme.js:165-168`) [c].
- **Pipelines:**
  - 10 materials [c].
  - The reflector re-renders the whole scene with no layer restriction (`water.js:41-45`). Its sample count matches the scene pass, so pipelines are probably shared [s].
  - Render targets: reflector at 0.38, bloom, graded RTT for FXAA, a viewport copy [c].
- **Compile:**
  - (a) The bounce loop is JS-unrolled 3× on High (`gems.js:323-391`) [c]:
    - Each bounce runs `traceExit` (layout'd, but its body is a JS `SIDES.forEach` that builds 13 sequential `If`s, `gems.js:132-160`), an inline ~45-op `gather`, `leave` and `far`.
    - Bounce 0 adds 2 `veil`, a fracture `noise3` and 3-way dispersion.
    - In total, 8 `environment` calls.
  - Water rings ×8, arithmetic only (`water.js:59-71`) [c].
  - `noise3` inlined 4× (`gems.js:253`, `337`, `351`) [c].
- **Frame CPU:**
  - `writeSparks` walks 400 slots and dirties 3 full attributes every frame, even when idle (`effects.js:285-329`, `406-470`) [c].
  - 0.75 s board poll with gBCR + `getComputedStyle` (`theme.js:29`, `390-395`; `stage.js:23-47`) [c].
- **Frame GPU:**
  - 2087 traced crystals in the main pass, drawn again in the reflector at 0.38 [c]. This is the top cost [s].
  - A framebuffer copy, bloom, graded RTT and FXAA [c].
- **Quick wins:**
  1. Run `loadAssets()` alongside `createRenderer()` and cache the parsed cavern per session (`theme.js:126`, `146`; `assets.js:121`) (start) [s].
  2. Keep the gems out of the reflector (layer), or give them a 1-bounce mirror variant (`water.js:41`) (GPU, large) [s].
  3. Return early from `writeSparks` when idle, and add `addUpdateRange` (`effects.js:320-328`) (CPU) [s].
  4. Replace the 0.75 s poll with scheduled re-reads (`theme.js:390-395`) [s].

### 13. misty-lake — S3 K4 C2 G5
Classic `WebGLRenderer` (antialias, alpha) with EffectComposer: RenderPass → UnrealBloomPass → GLSL grade (`src/themes/misty-lake/misty-lake-theme.js:494-511`, `1696-1814`). Own rAF loop, now paced (`theme.js:1848`, `1855`). Mirror reflection is opt-in, off by default. Prefix `src/themes/misty-lake/misty-lake-`.
- **Start:**
  - Synchronous `createScene`, then `startRenderLoop` with no `compile`/`compileAsync`, so about 29 programs link on the first render (`theme.js:429-481`) [c].
  - `noiseCommon` (snoise + voronoi) is injected into 10 shader sources + the water (`shaders.js:181`, `273`, `333`, `393`, `452`, `531`, `801`, `1052`, `1108`, `1173`; `water.js:47`) [c].
  - A 384² mirror RT is allocated although reflection is off (`water.js:147`) [c].
- **Pipelines:** ~20 scene programs + ~8 composer + grade. The lights at `theme.js:1563-1573` are used by no material [c].
- **Compile (GLSL):**
  - `fbm` is a ≤6-octave loop with `break` (`shaders.js:91-103`). Mist calls `fbm` 3× (5/4/3 octaves, `shaders.js:282-284`), so ≤18 snoise after an ANGLE/FXC unroll [s].
  - God rays 5 iterations × snoise; aurora `fbm(4)` + 2 [c].
  - Mid-play recompiles: each ripple and mist burst creates a new `ShaderMaterial` and disposes it on expiry. When the last user goes, three frees the program, and the next event recompiles it (`theme.js:2101-2199`; burst uses `fbm(5)`, `shaders.js:1180`) [c mechanism].
  - `lightBurst` is parked invisible and compiles on the first combo ≥4 (`theme.js:1559`, `2264`) [c].
- **Frame CPU:**
  - `onMouseMove` raycasts the 30,720-triangle water on every mousemove that doesn't create a ripple. It is not gated by `isActive`/`isPaused` (`theme.js:962`, `2301-2321`) [c].
  - ~6 `forEach` closures per frame + a `recordCounters({...})` literal (`theme.js:1898-1997`) [c].
- **Frame GPU:**
  - 6 stacked full-width mist planes at 12 snoise per fragment (`theme.js:1023-1053`, `shaders.js:282-284`) [c]: ~2 screens of fragments [s].
  - 4 mountain planes compute 4 ridge snoise per pixel that depend only on `uv.x`, then discard (`shaders.js:403-414`) [c].
  - God rays, aurora, water (3 snoise + voronoi + 4 Gerstner) [c].
  - `onWindowResize` never re-applies `setPixelRatio`, so render-scale and adaptive downscale do nothing until a restart (`theme.js:2286-2299`) [c].
- **Quick wins:**
  1. `compileAsync`/`compile` with `lightBurst` visible before `startRenderLoop()`; keep one shared ripple and one mist-burst material alive (`theme.js:481`, `2113`, `2163`) (first-frame + mid-play stalls) [s].
  2. Mist octaves 5/4/3 → 3/2/2, or a baked tiling noise texture (`shaders.js:282-284`) (GPU, largest) [s].
  3. Ridge height per vertex or from a 1D texture (`shaders.js:403-406`) (GPU) [s].
  4. Gate `onMouseMove`; `setPixelRatio` in `onWindowResize` (`theme.js:2294`, `2302-2312`) (CPU + working downscale) [c].

### 14. fluid-dreams — S2 K5 C2 G5
WebGPURenderer; post; `safeAnimate` (`src/themes/fluid-dreams/fluid-dreams-theme.js:538-601`). Prefix `src/themes/fluid-dreams/fluid-dreams-`.
- **Start:**
  - `bakeNoise` 256² fbm (≈590k inner iterations) + slope pass [c].
  - `createNoiseTexture` makes ≈350k `toHalfFloat` calls across 9 CPU mips (`world.js:133`, `tsl.js:127-198`) [c].
  - Both run synchronously; ≈10-30 ms [s].
- **Pipelines:**
  - 3 scene materials (liquid, motes, spray) [c].
  - Bloom (7) + output + `fxaa(graded)`. FXAA's `convertToTexture` adds a full-res RTT and pass (`post.js:267`) [c].
  - About 12 pipelines in total [c].
- **Compile:**
  - Prior measurement for context: the hero material compiled at ~1.7 s from graph size [memory].
  - (a) Two JS-unrolled per-group loops remain, each with GROUP_COUNT=4. Neither is the 72-step pathology [c]:
    - `liquid.js:364`: `ballTerms`, `If` + inner `Loop`. Emitted 2×, in the march (`:503`) and in shading (`:557`), so 8 If+Loop blocks.
    - `liquid.js:465`: per-group sphere test, 4 × 2 nested `If`s inside the bounce Loop.
  - (c) Loops nest three deep: bounce `Loop(2)` → march `Loop(56/24)` → 4× `If`(group) → ball `Loop` (≤36 hero balls) (`liquid.js:458`, `491`, `374`) [c].
    - `seaHeight` is inlined 3× (`:499`, `:535`, `:556`), each copy with its own wave Loop.
  - (d) Plain-JS helpers [c]:
    - `skyColour` inlined 5× at High+ (dispersion on, `quality.js:74`): `:675`, `:678` ×2, `:745`, `:747`. The `:745` copy is the full version with stars, the far-drops Loop and the prism.
    - `stemRadius` inlined 4×.
- **Frame CPU:** small but steady allocations [c]:
  - `post.update({time})` (`theme.js:594`)
  - `PALETTE_KEYS.forEach` (`world.js:459`)
  - `_updateKin`: `mix3([0,0,0]…)` ×2, a `bob` closure, a 3×5 nested array (`choreography.js:706-714`)
  - Per-satellite hue/colour arrays (`choreography.js:608-621`)
  - ~215 vec4 uniform rows rewritten every frame (`choreography.js:113-117`)
- **Frame GPU:**
  - The liquid is a full-screen BackSide shell with depthTest off; every pixel runs the bounce loop (`liquid.js:762-768`) [c].
  - During a crown the hero group grows toward 36 balls, and each march step loops over them [s].
  - Post adds a 10-tap shaft loop plus FXAA [c].
- **Quick wins:**
  1. One `skyColour` + red/blue offsets instead of 3 lens calls (`liquid.js:675-679`) (compile) [s].
  2. Merge `skyColour(d,true)`/`(d,false)` behind a runtime `If(primaryMiss)` (`liquid.js:745-747`) (compile) [s].
  3. Turn the group loops `:364`/`:465` into a TSL `Loop` over groups, with `GROUP_START`/`GROUP_BLEND` in uniform rows: 8 bodies → 2 (compile) [s].
  4. Reuse `{time}` and the choreography scratch arrays (CPU) [s].

### 15. golden-forest — S4 K3 C3 G4
WebGPURenderer, own rAF loop, forest post stack (`src/themes/golden-forest/golden-forest-post.js:45-88`) + reflector. Prefix `src/themes/golden-forest/golden-forest-`.
- **Start:**
  - Lake map: 196,608 texels × 2 calls to `goldenForestShores()`, each returning an object with 8 terms (`terrain.js:40-51`, `101-117`) [c].
  - Terrain grid at 0.45 m spacing, with array literals (`terrain.js:143-167`) [c].
  - 8 tree GLBs + foliage loop (`assets.js:15-22`) [c].
  - Serial awaits (`theme.js:173` → `200`) [c].
  - Full-scene prime (`post.js:51`, `97-112`) [c].
- **Pipelines:**
  - About 32 material instances [c]:
    - 8 bark (`forest.js:153`), foliage per bucket (`forest.js:289`)
    - 5 mist banks with literals (`atmosphere.js:89-99`)
    - 3 ribbons with baked constants (`ribbons.js:39-56`)
  - Shadow 2048×1024, ~17 caster variants [c].
  - Reflector at 0.5 over every group, including sparks, birds and ribbons (`lake.js:51`, `world.js:89-90`) [c].
  - Forest post stack [c].
- **Compile:**
  - Lake rings ×8 (`lake.js:108-118`) [c].
  - Ribbon strands ×4 with `path()` 2× × 3 materials (`ribbons.js:50-74`) [c].
  - Inlined `haze`/`wind`/`sky` [c].
- **Frame CPU:**
  - CPU spark sim over 2200 sparks (38% ambient), 3 full buffers dirtied every frame (`sparks.js:16`, `92-96`) [c].
  - `getFrame` built twice plus spreads (`theme.js:489-490`, `499`; `world.js:158`) [c].
  - Closure (`light.js:198`) [c].
  - 0.75 s DOM poll (`theme.js:495`, `stage.js:24`) [c].
- **Frame GPU:**
  - Mirror at 0.5 including 2200 additive sparks and the sky [c].
  - Godrays 26, bloom, grade, 5 mist banks [c].
  - The shadow map is static after frame 150 (`light.js:205-210`) [c].
- **Quick wins:**
  1. Attribute-shared tree materials (`forest.js:86`, `187-189`); one uniform-driven ribbon material (`ribbons.js:39-91`) (compile) [s].
  2. Keep sparks, ribbons and birds off `GOLDEN_FOREST_MIRROR_LAYER` (`world.js:89-90`) (GPU) [s].
  3. Allocation-free or cached lake map (`terrain.js:101-117`); one-object shadow prime (`post.js:97`) (start) [s].

### 16. koi-pond — S4 K3 C3 G4
WebGPURenderer, `safeAnimate`. Post: scene pass (samples 0), bloom, output, `fxaa()`. Wave sim runs as QuadMesh ping-pong passes. Prefix `src/themes/koi-pond/koi-pond-`.
- **Start:** everything is synchronous in `build()` after `await createRenderer` (`theme.js:205`, `228-233`). The seeds are fixed, but nothing is cached [c].
  - `bakePebbles(1024)` on High: 1024² × 9-cell Voronoi ≈ 9.4M evaluations plus a second 1M relief pass, both with mipmaps and anisotropy 4 (`bed.js:32-136`, `quality.js:76`) [c].
  - `bakeNoise` 256² × 10 octaves (`core.js:159-213`) [c].
  - `bakeWaterMask` 640×384 = 246k × `groundHeight` + rock loop (`surface.js:81-102`) [c].
  - `growMaples(6400)` (`garden.js:368-474`) [c].
  - On restart, `playTo(takeRestartTime)` replays up to 12 s at 1/60 s: ≤720 synchronous `world.update` calls, each running a wave step, a derive render and uploads (`theme.js:63-65`, `261`, `274-288`) [c]. The cost is large [s].
- **Pipelines:**
  - ~19 NodeMaterials plus 9 shadow-caster depth pipelines (`garden.js:300`, `515`, `597`, `696`; `flora.js:301`, `415`, `503`; `koi.js:521`; `dragon.js:220`) [c].
  - Shadow 2048², autoUpdate on (`light.js:142-151`) [c].
  - Render targets: 2 sim targets at 640×384 and derive at 1024×614 (`surface.js:117-118`), bloom, FXAA input RTT (`post.js:223`) [c].
  - `viewportSharedTexture` + depth copies (`water.js:61`, `66`) [c].
- **Compile:**
  - No JS-unrolled If and no mx [c].
  - Sim step has plunger/wake `Loop(12)`/`Loop(32)` (`surface.js:187-204`) [c].
  - (d) Light helpers are inline by design (`light.js:12-15`); `causticRGB` 3 samples, lantern 2× in the bed (`bed.js:225`, `249`) [c].
- **Frame CPU:**
  - Up to 5 fixed sim steps per frame. Each runs the O(n²) school of 22 koi, a 640-drop spray loop and a GPU pass (`world.js:897-903`, `fx.js:148-165`) [c].
  - `spray.commit()` uploads 640×12 floats every frame, even when nothing is alive (`fx.js:167-190`); `pools.commit()` uploads in full too (`air.js:250-252`) [c].
  - 8 array literals (`world.js:945-947`) [c].
  - `setMood` does ~23 `fromArray`/`set` calls per frame (`light.js:192-215`) [c].
- **Frame GPU:**
  - The 2048² shadow map is redrawn every frame with 6400 swaying leaves plus koi, pads and dragon [c]. This is the top GPU cost [s].
  - Sim and derive passes, a framebuffer copy, bloom and FXAA [c].
- **Quick wins:**
  1. Module-cache the pebble, noise and water-mask bakes (`bed.js:191`, `light.js:85`, `surface.js:125`) (start, large) [s].
  2. Leaves don't cast (`garden.js:597`), or High shadow 1024 (`quality.js:75`) (GPU) [s].
  3. Skip `spray.commit` when idle and add `addUpdateRange` (`fx.js:167-190`) (CPU) [s].
  4. During `playTo`, skip `derive` and the uploads except on the last step (`theme.js:280-285`) (restart start) [s].

### 17. luminous-tides — S4 K3 C3 G4
WebGPURenderer, `safeAnimate`. Post: pass + bloom + output + FXAA (`src/themes/luminous-tides/luminous-tides-post.js:101-227`). Prefix `src/themes/luminous-tides/luminous-tides-`.
- **Start:**
  - `createSkyNoise(512)` + `createSeaNoise(512)` on High and Medium (`world.js:194-195`, `core.js:612-757`) [c]:
    - sky: 4.2M fBm + 7.1M cell/sqrt
    - sea: 3.1M + 4.7M + pow
    - ≈19M inner iterations in total
  - Both use GPU mips + anisotropy 8 (`tsl.js:85-97`) [c].
  - Shore fan: 45.6k vertices [c].
- **Pipelines:** 5 materials + bloom + output + FXAA. Reflection is analytic: `skyColour` is evaluated along the mirror ray [c].
- **Compile:**
  - Land palms: 3 cells × 9 fronds = 27 JS-unrolled frond bodies (`land.js:120-158`) [c].
  - The sky deck unrolls 4 slices (`tsl.js:367-378`) [c].
  - (c) The shore fragment is the largest graph in its batch (`shore.js:341-570`) [c]:
    - `surfAt`, ~15 seaNoise fetches, `swashAt` ×2
    - inline `skyColour`, plus a second `coastHeight` + `coastLamps` for the same ray (`shore.js:516-520` repeats `tsl.js:388-395`)
    - `sparkField` ×3, `rainLayer` ×2
    - 2 Loops
- **Frame CPU:** [c]
  - `updateGlows` walks 640 drops (`world.js:712-736`).
  - `writeSpray`: 52 strips × ≤3 crests with a 4-step Newton solve each, ≤280 droplets (`spray.js:74-147`).
  - `glows.end()` uploads 3 × 992 × 16 B ≈ 47.6 KB every frame, with no range (`glows.js:98-102`).
  - T-spin shoal: 2 closures per fish per frame (`world.js:746-763`).
- **Frame GPU:** [c]
  - The shore fragment covers the frame from the eye to the horizon.
  - The sky dome is depth-tested after the shore.
  - ≤992 glow quads + 800 rain streaks; the streaks collapse but still cost vertex work.
  - FXAA.
- **Quick wins:**
  1. In `glows.end()`: `clearUpdateRanges` + `addUpdateRange(0, count*4)` (`glows.js:98-102`) (CPU/bus) [c].
  2. Module-cache the bakes, or start at 256 and swap in 512 after the first frame (`core.js:696`, `722`) (start, ≥100 ms [s]).
  3. Reuse `skyColour`'s coast terms (`shore.js:516-520`) (compile) [s].
  4. Frond loop → TSL `Loop` (`land.js:141-157`) (compile) [s].

### 18. sakura-twilight — S3 K3 C4 G4
WebGPURenderer, own rAF loop, forest post stack (`src/themes/sakura-twilight/sakura-post.js:43-94`) + reflector. Uses the shared fox engine (`src/themes/shared/fox-rig.js`, `fox-mind.js`). Prefix `src/themes/sakura-twilight/sakura-`.
- **Start:**
  - It is the leanest of the forest family [c]:
    - shared bark material (`forest.js:144`) and shared blossom material (`forest.js:288`)
    - `primeShadows` renders the terrain only (`world.js:140-149`, wired at `sakura-twilight-theme.js:280`)
  - The prime renders to the canvas rather than to a scene-pass-shaped target, so the terrain pipeline compiles in both formats [s].
  - terrain 221×185, bed 256², noise 65k [c]
  - serial awaits (`sakura-twilight-theme.js:160` → `187`), 12 assets, no cache [c]
- **Pipelines:**
  - About 33 materials [c]:
    - 4 mist banks with index literals (`spirits.js:84-113`)
    - foxes: skin ×2 + fur ×2 (`foxes.js:162`, `170`)
    - props and spirit sprites
  - Shadow 2048×1024 with few casters [c].
  - Reflector at 0.4, layer 0 only. Grass, petals, foxes, fireflies and mist are excluded (`water.js:66`, `world.js:126-133`) [c].
  - Godrays 24 steps [c].
- **Compile:**
  - Lamp and ring loops are already TSL `Loop`s, which is the fleet's model (`light.js:206`, `223`; `water.js:38`) [c].
  - (d) `skyFn`, `hazeFn`, `ringsFn` and `lampsFn` have no layout on purpose, because of an r186 captured-uniform issue (`light.js:164-171`). They are inlined widely [c]:
    - `hazeFn` (with `skyFn`) in ~12 materials
    - `lampsFn` (Loop 10, 2 sin each) in ~8
    - `ringsFn` (Loop 6) in ~8
    - sites: `forest.js:119-127`, `petals.js:81-92`, `garden.js:235-241`, `terrain.js:175-181`, `water.js:87`, `135-137`, `prop-material.js:51-70`, `foxes.js:140`, `155`
- **Frame CPU:**
  - Petal sim over 6000 petals, with a field loop and `surface()` per airborne petal (`petal-sim.js:219-361`) [c].
  - `write()` computes a quaternion (6 trig) for every petal, idle ones included (`petal-sim.js:380-402`) [c].
  - Three buffers × 6000 re-uploaded whole every frame (~240 KB) (`petals.js:109-119`) [c].
  - `getFrame` twice (`sakura-twilight-theme.js:477-478`), spread and closure (`world.js:223-224`) [c].
  - The fox engine is cheap: `solve` allocates nothing (`src/themes/shared/fox-rig.js:704-855`); `sakura-fox-mind.js:349` filters every frame [c].
- **Frame GPU:**
  - Mirror at 0.4 [c].
  - Lake: 3 reflection samples + 10-lamp loop + 6-ring loop + ~9 noise reads (`water.js:80-136`) [c].
  - Terrain fragment: 10-lamp loop [c].
  - 6000 petals run the lamp and ring loops per vertex [c].
  - Fur: 12 transparent shells × 2 skinned foxes (`foxes.js:33`, `252-254`) [c].
  - 10k grass tufts, godrays 24, bloom [c].
- **Quick wins:**
  1. Skip idle petals in `write()` and upload live ranges only (`petal-sim.js:378-403`, `petals.js:109-112`) (CPU) [s].
  2. One mist material with per-bank uniforms: 4 → 1 pipeline (`spirits.js:84-113`) (compile) [s].
  3. Prime into a scene-pass-shaped target (`world.js:145`) (start) [s].

### 19. cinder-drift — S3 K3 C4 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4 (`src/themes/cinder-drift/cinder-drift-post.js:63-65`), bloom, shafts 10, heat-haze tap, fringe, calm ×5. Prefix `src/themes/cinder-drift/cinder-drift-`.
- **Start:**
  - The bakes are module-cached in `bakedOnce` (`tsl.js:106-122`, `190-192`), which is good [c].
  - But `createFieldTexture` re-runs on every build: plates 512²×4 + mips ≈ 1.4M `toHalfFloat` + noise ~350k (`world.js:235-236`, `tsl.js:273-310`) [c].
  - The first-ever build runs `computePlates` (512² × 9-neighbour Voronoi) (`tsl.js:210-250`) [c].
- **Pipelines:** 12 materials (9 via `cdFxMaterial` with `forceSinglePass`) + bloom + output, ~20; no reflector [c].
- **Compile:** (d) inline helpers [c]:
  - The lake (`lake.js:62-212`) has `cdRings` 6 slots × ~25 ops inside an `If`, `cdClear` 2×4, `cdHeatColor` ×3, `cdHaze` ×2 and ~9 texture reads (`tsl.js:445-489`).
  - The columns repeat `cdRings` + `cdClear` + 6 stream veins (`rock.js:150-278`).
- **Frame CPU:**
  - Every `spatter.emit` dirties all 4 attributes: 4 × 4096 × 16 B = 256 KB (`fx.js:169-173`) [c].
  - Ambient beats emit with no gameplay at all: spray every 0.25 s, drips every 0.2 s, streams every 0.5 s per fissure (`world.js:795-881`). That is several 256 KB uploads per second at rest [c].
  - Emit allocates 4-5 arrays per drop (`fx.js:162-167`) [c].
  - Each heat stamp rescales the whole 192² field and runs 36,864 `toHalfFloat` + a full upload (`heat.js:36-42`, `world.js:960-963`, `tsl.js:330-335`) [c].
  - `rigForAspect` object every frame (`core.js:249-256`); `post.update({time})` (`theme.js:595`) [c].
- **Frame GPU:** MSAA-4; the lake fragment over the lower half; 4096 spatter + 1600 embers + 26 smoke sheets; haze + 10 shafts [c].
- **Quick wins:**
  1. Ranged spatter upload, `addUpdateRange(cursor*4, n*4)` (two ranges on wrap) (`fx.js:169-173`) (CPU/upload, large) [s].
  2. Write components in place, not via `.set([...])` (`fx.js:162-167`) [c].
  3. Cache the half-float mip arrays next to `bakedOnce` (`tsl.js:273`) (rebuild start) [s].

### 20. aurora — S4 K4 C1 G4
Own WebGPURenderer, own rAF loop gated by `shouldRenderFrame`, curtain RTT rendered before the scene (`theme.js:376`). Prefix `src/themes/aurora/aurora-`.
- **Start:** strictly serial: `await createRenderer` (`theme.js:105`), then `buildScene` (`theme.js:123`) runs every bake synchronously [c].
  - `bakeAuroraNoise(256)`: 256² × 14 octaves ≈ 917k `valueNoise2` (`world.js:55-61`). Not cached; it re-bakes on every rebuild [c].
  - Terrain: 240×88 = 21,120 vertices on High (`quality.js:62-63`) [c]:
    - ~22 `valueNoise2` calls per vertex
    - 5 option-object literals and 3 small arrays per vertex/quad (`landscape.js:69-89`, `108-120`, `282-285`)
    - then `computeVertexNormals`
  - Star catalogue: 5200 [c].
- **Pipelines:**
  - 8 scene materials [c].
  - Curtain RTT: HalfFloat at 0.5 × drawing buffer (`curtains.js:127-133`) [c].
  - `reflector` at 0.35 resolution on Medium and up (`landscape.js:387-391`) [c].
  - MSAA-4 + bloom on High when antialias is on (`post.js:47`) [c].
  - The reflector target's sample count differs from the MSAA-4 scene pass, so each scene material probably builds a second pipeline [s].
- **Compile:**
  - (a) `for (const arc of this.arcs) this.marchArc(...)` is 4 copies on High (3 arcs + corona) (`curtains.js:182-186`, `83-84`) [c]. Each copy:
    - `If` → `Loop(17)` (`curtains.js:251`)
    - 4 JS-unrolled meander terms + 2 billows
    - `Loop(4)` → `If` body of ~100 nodes with 2-3 texture reads (`curtains.js:261-407`)
    - The corona copy is compiled even though its gain is 0 at rest [c].
  - (a) Lake ripples JS-unrolled 6× (`landscape.js:423-435`), small [c].
- **Frame CPU:** `post.update({...})` literal (`theme.js:371`); otherwise allocation-free [c].
- **Frame GPU:**
  - Curtain march over ~0.39× the CSS pixel area, every frame [c].
  - Reflector: a full second scene render at 0.35 every frame (dome, 5200 stars, 21k-vertex range) [c].
  - Lake: 3 reflection reads + 3 noise reads [c].
  - MSAA-4 + bloom [c].
- **Quick wins:**
  1. March the arcs in a TSL `Loop` over a `uniformArray` arc table: 1 march copy instead of 4 (`curtains.js:182`) (compile, ~3-4× less march code) [s].
  2. Module-cache the noise bake and range geometry by (seed, size) and start them before `await createRenderer` (`world.js:55`, `landscape.js:265`, `theme.js:105`) (start) [s].
  3. Exclude stars and meteors from the mirror via layers, or use `mirrorScale` 0.25 on High (`landscape.js:388`) (GPU) [s].

### 21. stellar-drift — S4 K4 C1 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4 on High (`src/themes/stellar-drift/stellar-drift-post.js:61`), bloom, fringe. A full-screen ray-traced space pass. Prefix `src/themes/stellar-drift/stellar-drift-`.
- **Start:** [c]
  - `bakeFbm(…, 512, 6)` = 512² × 4 × 6 ≈ 6.29M samples (`world.js:288`, `bake.js:51-107`).
  - `createFbmTexture(512)`: ~1.4M `toHalfFloat` (`tsl.js:111-148`).
  - Plus the lattice, ring profile, band meta and colours (`world.js:287-295`).
- **Pipelines:** 7 scene materials, 6 DataTextures, MSAA-4 RT, bloom, output [c].
- **Compile:**
  - (a) `curtain()` is called 2× (`space.js:690-691`). Each copy has a JS `for k<2` with an `If` around 2 fbm reads (`space.js:665-687`), so 4 inlined copies [c].
  - `moon()` ×2, `starLayer` ×3 [c].
  - (c) 6 TSL Loops; sky, rings, giant, haze and aurora all live in one fragment (`space.js:139-698`), likely the largest single WGSL in its batch [s].
- **Frame CPU:** 5 `flush` closures (`world.js:958-985`); `{time}` (`theme.js:612`) [c].
- **Frame GPU:** the full-screen quad traces the giant, rings, 2 moons and aurora per pixel (≤10 fbm on the giant) [c]. MSAA-4 on top, although the pass anti-aliases itself (`space.js:15-16`) [s waste].
- **Quick wins:**
  1. High `msaa:0` (`post.js:61`) (GPU bandwidth) [s].
  2. Module-cache fbm + half-float mips, or build mips on the GPU (`bake.js:51`, `tsl.js:111`) (start, large) [s].
  3. `k<2` JS loop → `Loop(2)` (`space.js:665`) (compile) [s].

### 22. painted-ages — S4 K4 C2 G3
WebGPURenderer, `safeAnimate`. Post: scene pass (no MSAA, depth used for shafts), bloom, output (`src/themes/painted-ages/painted-ages-post.js:111-268`). 3 shadow quad pre-passes. Prefix `src/themes/painted-ages/painted-ages-`.
- **Start:**
  - Serial `await createRenderer` (`theme.js:199`) → `await prepare` (`theme.js:227`) [c].
  - `loadBadlands` for-awaits 3 PNGs (2.79 + 2.64 + 0.80 MB) in turn. Each goes through fetch, DecompressionStream, a JS unfilter over 4 MB and `decodeField` (`assets.js:71-81`, `138-156`; `field.js:34-46`) [c].
  - `fanPositionSteps`: 280k posts, sliced every 48 rows (`land.js:65-84`) [c].
  - `fieldTextureData` runs as ONE slice per field: 1024² × (12 closure reads + 4 `toHalfFloat`) for both near and mid (`world.js:80-83`, `tsl.js:250-271`) [c]. ~50-150 ms each [s].
  - `build()` is synchronous (`world.js:202-251`) [c]:
    - noise re-bake (`tsl.js:96-119`)
    - 8192-texel column texture with CPU sRGB mips (`tsl.js:142-175`)
    - 1.67M-entry index loop (`land.js:86-110`)
    - 9 DataTextures, including 18 MB of half-float fields
  - Frame 1 paints all 3 shadow fields (`shadow.js:125-138`) [c].
- **Pipelines:** 7 scene materials, 3 shadow quads, bloom (7), output: ~18. Shadow RTs at 768/384/192 [c].
- **Compile:**
  - (a) Cumulus has 16 billows JS-unrolled per fragment (`cumulus.js:143-151`) [c].
  - `paRiver` 15-segment chain and `paRills` 3×3 are inside layout'd Fns, so fine (`events.js:160-177`, `land.js:119-140`) [c].
  - (c) The land `colorNode` is the largest graph in its batch (`land.js:155-325`) [c]:
    - `landAt` over 3 fields, ~15 noise taps, 4 column taps
    - a nested record If, `shadowAt`, `riverWater` with an inline `skyColour`
    - ribbon and wave Loops, rainbow, aerial
  - (c) Shadow passes: `Loop(42)` × `heightAt` 3 taps each (`shadow.js:89-97`) [c].
  - (d) `deckDensity` inlined 3× in the sky (`sky.js:78`, `84-85`) [c].
- **Frame CPU:**
  - While it rains, each mote spawn allocates an options object + `rgb` + 4 `.set([...])` (`motes.js:151-159`) [c].
  - `update()` then re-uploads 4 full attributes, ~131 KB per frame, although `dirtyFrom`/`dirtyTo` are already tracked (`motes.js:160-161`, `176-182`) [c].
- **Frame GPU:**
  - A shadow field is repainted whenever the sun moves >0.0018 rad. The sun moves with the clock at 100 s per hour (`shadow.js:124`, `hours.js:282-284`). Near field: 768² × 43 × 3 taps [c; cadence s].
  - Shafts `Loop(14)` × 2 taps at full res; the large land fragment [c].
- **Quick wins:**
  1. Start `loadBadlands` before `await createRenderer`; `Promise.all` the 3 PNGs (`assets.js:138-156`) (start) [s].
  2. Slice `fieldTextureData` into row bands (`world.js:80-83`) (long task) [s].
  3. Module-cache noise, lattice and column (`world.js:218-221`) (start) [s].
  4. One `addUpdateRange(dirtyFrom..dirtyTo)` per attribute (`motes.js:176-182`) (CPU) [s].

### 23. moonlit-greenhouse — S3 K4 C1 G5
WebGPURenderer; RenderPipeline post: MSAA scene pass, bloom, air ray-march into a half-res RTT, output; `safeAnimate`. Prefix `src/themes/moonlit-greenhouse/moonlit-greenhouse-`.
- **Start:**
  - `build()` builds all 17 parts synchronously after `await createRenderer` (`world.js:285-335`, `theme.js:219`) [c].
  - `bakeGardenNoise(512)` on High (`core.js:762-777`, `quality.js:108`) [c]:
    - 3 fbm fields (16 passes × 262k px) plus 2 bead fields × 9 neighbours: about 9M inner operations.
    - Main-thread cost: tens of ms [s].
  - The DataTexture uses `generateMipmaps=true` and anisotropy 8 (`tsl.js:65-77`) [c].
  - Flora geometry uses functional vector math that allocates per vertex: `add`/`scale`/`sub`/`cross` each return a new array (`flora-geometry.js:221-378`) [c].
- **Pipelines:**
  - About 35 scene NodeMaterials [c]:
    - floor 3, iron 3, lanterns 3, pads 3, flora 10, air ~4, blooms+queen 5
    - Identical graphs built separately: 3 trunks (`flora.js:89`) and urn/basket ferns (`flora.js:132`, `141`) [c]
  - MSAA-4 scene pass on High (`post.js:47-48`, `138`) [c].
  - Bloom: 7 pipelines and 11 RTs [c].
  - Air RTT: HalfFloat at 0.5 (`post.js:390`) [c].
- **Compile:**
  - (d) `mgSurface` is an inline helper (`tsl.js:601-630`) that carries a lot with it [c]:
    - `mgCanopy` (Loop + If, `tsl.js:491-533`), `mgLanterns` (`tsl.js:375-390`), `mgBloomLight` (`tsl.js:397-418`)
    - It is inlined in about 15 materials: `floor.js:433`, `491`, `511`; `flora-shading.js:564`, `640`, `695`; `blooms.js:799`, `899`; `air.js:772`; `iron.js:725`, `913`; `lanterns.js:261`; `pond.js:1331`, `1381`, `1426`, `1545`.
  - (c) Air march `Loop(24)`. Each step runs `mgCanopy` (Loop ≤8 crowns), a lantern Loop and a bloom-light Loop (`post.js:351-387`) [c].
  - (a) The leaf-shape `If`/`ElseIf` chain is built by a JS loop: ≤3 branches with big cut graphs, and heart adds a nested 4-way chain (`flora-shading.js:503-505`, `436-439`) [c].
  - (d) `mgSky` is inline (~10 taps) in glass and pond (`tsl.js:296-369`; `glass.js:173`, `pond.js:994`) [c].
- **Frame CPU:** clean [c]:
  - Reused `postState` (`theme.js:632-634`).
  - `pickCrowns` sorts only after the moon moves ≥0.008 rad (`world.js:873-888`).
  - `updateProjectionMatrix` on the rest lens every frame (`world.js:822-825`); minor.
- **Frame GPU:**
  - Full-res MSAA-4 at DPR ≤1.15 [c].
  - Every opaque surface pixel runs 3 shader loops: crowns ≤8, lanterns ≤8, bloom lights [c].
  - Air march: 24 steps at 0.5 res [c].
  - 3×3 bilateral upsample: 10 depth + 9 RTT samples (`post.js:283-322`) [c].
- **Quick wins:**
  1. Drop `mgCanopy` from the air march, or cap it at 4 crowns (`post.js:360`) (GPU+compile) [s].
  2. High: MSAA off, FXAA on, as on Medium (`post.js:47-48`) (GPU) [s].
  3. Start the noise bake before `await createRenderer`, or bake at 256 first (`world.js:287`) (start) [s].
  4. Share material instances for identical graphs (`flora.js:89`, `132/141`) (JS build time) [s].

### 24. stellar-velocity — S4 K3 C1 G5
WebGPURenderer, `safeAnimate`. The canyon is painted into a 0.6-scale HalfFloat target from inside `world.update` (`src/themes/stellar-velocity/stellar-velocity-world.js:1011`, `stellar-velocity-nebula.js:416-423`). Post: pass + bloom + output. Prefix `src/themes/stellar-velocity/stellar-velocity-`.
- **Start:**
  - `bakeCanyonNoise(4177, 64)` on Medium and up (`tsl.js:156-322`, `world.js:268`) [c]:
    - 8 trilinear gradient fields on 64³ ≈ 16.8M `at()` closure calls
    - 2 cellular × 27 × 262k = 14.2M
    - a far pass on 32³
  - `bakeFbm` 1.31M + ~350k `toHalfFloat` (`tsl.js:372-471`) [c].
  - `createScene` calls `world.update(buildSim(0))`, which renders the canyon QuadMesh immediately. That pipeline compiles in `createScene`, and as an off-scene quad no scene warm covers it (`theme.js:282`) [c].
- **Pipelines:** 7 materials + bloom + output; canyon RT; 2 Data3DTextures [c].
- **Compile:**
  - (c) Canyon march `Loop(40)` (64 on Extreme) (`nebula.js:162-272`) [c]:
    - If/ElseIf/Else, 3 nested Ifs
    - 2 nested dynamic Loops, Break
  - Output: 7 rush + 10 ray taps unrolled [c].
- **Frame CPU:** `lit.sort` closure (`world.js:871`); `palettePhase` object (`core.js:338-345`); `post.update({time})` (`theme.js:622`) [c].
- **Frame GPU:**
  - Canyon march at 0.36 of the pixel count: 40 steps × ≤7 3D/fbm fetches, ≤280 fetches per pixel before the early break [c].
  - Full-res backdrop: 3 star lattices + a 4-tap tent + fbm (`nebula.js:314-392`) [c].
  - 3700 streak quads sample the canyon target in the vertex stage [c].
  - Output: up to 21 taps [c].
- **Quick wins:**
  1. Module-cache `bakeCanyonNoise` + `bakeFbm` (`tsl.js:156`, `372`) (start, ≥100 ms [s]).
  2. `draw:false` for the frame-0 `world.update` in `createScene` (`theme.js:282`; check at `world.js:1011`) (start) [s].
  3. High `canyonScale` 0.6 → 0.5 (`quality.js:25`), ~30% fewer march pixels (GPU) [s].

### 25. voltage-storm — S4 K3 C2 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4, bloom, 6×2 streak, ripple, fringe. Plus a per-frame raymarched sky pass into its own RT. Prefix `src/themes/voltage-storm/voltage-storm-`.
- **Start:** after `await createRenderer` (`theme.js:213`), `build()` is synchronous and uncached [c]:
  - 2D `bakeNoise` 655k + `createNoiseTexture` (`world.js:252`)
  - `bakeCloudNoise(9001, 48)`: 3 cellular passes × 48³ × 27 tests (~9M) + 2 gradient passes (`world.js:253`, `tsl.js:226-343`)
  - Ultra/Extreme use 64³ (~21M) (`quality.js:76`, `88`)
- **Pipelines:** 10 materials, including the sky QuadMesh (`sky.js:245-246`), + bloom + output, ~18. Sky RT HalfFloat at 0.6 (`sky.js:248-271`); Data3DTexture 48³ [c].
- **Compile:**
  - (c) Sky `Loop(14)` with an `If`, a nested `vsFlashLight` Loop per step, and `plan()`/`lobeField()` inlined 3× per step (`sky.js:77-97`, `162-229`; `tsl.js:467-481`) [c].
  - (d) Bolt vertex: `frameAt` inlined 7× (`bolts.js:235-281`) [c].
- **Frame CPU:**
  - `BoltTable.update` walks 40 slots and sorts (`bolts.js:548-585`) [c].
  - Queue sort + `shift` (`world.js:1065-1075`) [c].
  - Uniform tables (~200 vec4) rewritten every frame (`world.js:1123-1147`) [c].
- **Frame GPU:**
  - Sky pass at 0.6: 14 steps × (1 2D + ≤4 3D fetches + `plan()` ×3) [c].
  - `vsShockRings` loops over `shockCount`, which `resetState` sets to `SHOCK_SLOTS` (10) and nothing ever lowers. So 10 iterations run per water pixel at rest, contradicting the comment "an idle storm loops over nothing" (`world.js:244`; `tsl.js:12-13`, `430`, `493`) [c].
  - Bolts: 40 × ~928 verts + a 40 × ~532 mirror, with 7 `tortuosity` per vertex (56 hashes). They are drawn every frame with no live bolts (collapsed to zero width) (`bolts.js:65-75`, `337-347`, `372`) [c].
  - MSAA-4 + 12 streak samples [c].
- **Quick wins:**
  1. Keep live shock rows at the front and set `shockCount` = the live count (`world.js:244`, `622-637`) (GPU at rest) [c mechanism].
  2. Set bolt `mesh.count` to the highest live slot + 1 (`bolts.js:372`, `548`) (GPU vertex) [c mechanism].
  3. Memoize `bakeCloudNoise` per size, or ship it baked (`world.js:253`) (start, large) [s].

### 26. stillwater — S3 K4 C2 G4
WebGPURenderer, `safeAnimate`. Post: `pass()` with MSAA 4 on High (`src/themes/stillwater/stillwater-post.js:65`, `126`), bloom, one output Fn with Kuwahara (brush 2), 12 shaft taps and 2 fringe taps. Planar `reflector()` at 0.5 over HERO_LAYER. Prefix `src/themes/stillwater/stillwater-`.
- **Correction to the memory note:** the "~2.2 s water compile, materialXFlow suspect" predates the from-scratch rebuild `6698ec00` (2026-10-09), which deleted that runtime. A `materialXFlow|mx_` grep over `src/themes/stillwater` returns nothing [c]. The current water (`water.js:86-256`) is ~780 ops, 22 texture samples, 3 TSL Loops, 1 If and no JS-unrolled If [s for the op count]. It needs a fresh per-pipeline measurement.
  - It includes the full `swBackdrop` (`tsl.js:460-570`, called at `water.js:156` with `lite:false` on High): haze, stars, aurora, moon, veil, and a JS-unrolled RANKS 4×2 loop. That is ~430 ops and 12 taps, built a second time in the sky (`sky.js:31`).
- **Start:**
  - `bakeNoise` 1.31M + ~350k `toHalfFloat` + CPU mips (`world.js:148`, `tsl.js:125-225`) [c].
  - `bakeShoreMap` 65k (`plan.js:548-564`) [c].
  - Ground: 25.6k `groundHeight` calls, each allocating 2 objects (`land.js:37-69`, `plan.js:98-139`) [c].
  - Serial chain: `await createRenderer`, then the build, and only then `awaitWorldAssets` fetches the troll GLB (≤4 s; lod1 224 KB) (`theme.js:224`, `255-272`; `figures.js:451-453`) [c].
- **Pipelines:**
  - 25 materials; `createBoughs` builds the same graph twice (`world.js:295-296`) [c].
  - 23 materials on HERO_LAYER are drawn in both the MSAA-4 scene pass and the reflector target, which uses samples 0 (`water.js:74`; three `ReflectorNode.js:230`, `416`). Sample count is part of the pipeline key (three `WebGPUBackend.js:2383`, `2402`), so this costs ~23 extra pipelines [c]. Whether DXC caches the shader module across them is [s].
- **Compile:**
  - (a) Kuwahara `forEach`: 4 quadrants × 9 taps with 4 sequential `If`s, inside `If(room>0.02)` (`post.js:205-233`) [c].
    - It runs in the final composite quad, which is created synchronously even under the async session (`src/rendering/async-render-pipelines.js:100-101`, `159-161`) [c].
  - (a) RANKS 4×2 unroll in `swBackdrop`, built twice (`tsl.js:534-565`) [c].
  - Shafts 12 taps, calm rects 5 (`post.js:191-196`, `275-280`) [c].
  - (d) `swLight` (5 point lights + dapple) is inlined once in each of ~12 lit materials (`tsl.js:409-429`) [c].
- **Frame CPU:** about 10 small allocations per frame [c]:
  - `post.update({time})` (`theme.js:711`)
  - pool tuples with a `forEach` closure (`world.js:1109`, `1135-1141`)
  - `along` + `place({...})` (`world.js:966-1004`)
  - `turnBone` closure (`figures.js:521`)
- **Frame GPU:**
  - MSAA-4 HalfFloat scene pass at DPR 1.15 [c].
  - The reflector re-renders 23 parts at 0.5, including 520 reeds, 960 sparks and mist [c].
  - Full-res output pass: ≤36 Kuwahara taps + 12 shaft + 2 fringe [c].
  - 5 mist sheets in both passes [c].
- **Quick wins:**
  1. Memoize `bakeNoise(4421)` + its mips (`world.js:148`, `tsl.js:188`) (start) [s].
  2. Start the troll GLB fetch alongside `createRenderer` (`theme.js:224` vs `272`) (start) [s].
  3. Call the water's `swBackdrop` with `lite:true` on High (~150 ops and 3 taps fewer) (`water.js:156`) (compile+GPU) [s].
  4. Match the scene pass and reflector sample counts (High `msaa:0`) to drop ~23 pipelines (`post.js:65`) [s].

### 27. solar-eclipse — S2 K5 C2 G4
WebGPURenderer; post; `safeAnimate`. Prefix `src/themes/solar-eclipse/solar-eclipse-`.
- **Start:** synchronous inside `build()` (`world.js:244-259`) [c]:
  - `bakeNoise` ≈1.25M (`core.js:217-272`)
  - `bakeRanges` ≈61k (`core.js:375-441`)
  - 16k `toHalfFloat` calls (`tsl.js:66-88`)
- **Pipelines:** dome + 2 mote materials (echo bakes constants, `fx.js:133-140`) + bloom (7) + output, about 11 pipelines [c].
- **Compile:**
  - Nearly all of it is one dome fragment, `createSky` (`sky.js:89-285`) [c].
  - (a) JS unrolls without `If` [c]:
    - salt Voronoi 3×3 = 9 bodies × 3 hashes (`mirror.js:144-156`)
    - ranges 6×, each with a mist read (`sky.js:223-264`)
    - `BRIGHT_POINTS` 8× (`sky.js:127-133`)
    - swell 3× (`mirror.js:75-82`)
  - (c) Prominences `Loop(12)` → `If` → `Loop` → `If(alive)` → `If(near)` → `If`/`ElseIf`/`Else` with 1-3 noise fetches (`sun.js:251-350`) [c].
  - (c) Streamers `Loop(10)` (`sun.js:176-187`), beads (`sun.js:358`), ripples `Loop(8)` (`mirror.js:89-119`) [c].
- **Frame CPU:**
  - `post.update({time})` (`theme.js:614`) [c].
  - While staged: 2 `filter` + `sort` (`world.js:824-829`) [c].
  - 36 + 10 uniform rows rewritten every frame (`world.js:792-814`) [c].
- **Frame GPU:**
  - Full-screen dome at DPR ≤1.15 [c].
  - Below the horizon each pixel runs swell, 8 ripples, salt Voronoi (27 hashes), the glint, then the whole sky again in the reflected direction, sun included [c]. About 2× sky cost for the lower screen [s].
- **Quick wins:**
  1. Salt 3×3 unroll → nested TSL `Loop` (`mirror.js:144-156`) (compile) [s].
  2. Ranges 6× → TSL `Loop` with a constants `uniformArray` (`sky.js:223-264`) (compile) [s].

### 28. fall — S4 K2 C3 G4
WebGPURenderer (canvas `antialias: getAntialiasEnabled()`, `fall-theme.js:253`); post on High: scene, GodraysNode, bilateral blur, bloom, grade, FXAA. Own rAF loop with `THREE.Timer` (`fall-theme.js:538-567`). Prefix `src/themes/fall/fall-`.
- **Start:**
  - 8 GLBs + 1 PNG load in parallel via `Promise.all`, which is good (`assets.js:182-189`). Parsing uses `getX` loops (`assets.js:27-34`, `96-105`) [c].
  - Synchronous bakes after that [c]:
    - noise 128² RGBA (`light.js:27-46`)
    - ground map 256² with `fallPathDistance`/exp per pixel (`terrain.js:95-113`)
    - terrain 129×105 + `computeVertexNormals` (`terrain.js:148-156`)
    - foliage sites: ~32 trees, compose + `push(...matrix.elements)` (`forest.js:241-272`)
    - litter 5600 + grass 2300 `updateMatrix` loops (`understory.js:189-266`)
    - leaf-sim reset over 2600 leaves
  - `if (!light.sun.shadow.map) renderer.render(scene, camera);` draws one synchronous full frame, shadow pass included, to the canvas during `buildScene` (`post.js:48`) [c]. The canvas format and sample count differ from the scene pass target, so most of that compile is likely wasted [s].
- **Pipelines:** about 34 scene materials [c]:
  - bark 7, one per asset (`forest.js:151`)
  - foliage ≤8, one per draw (`forest.js:285`)
  - litter 4 (`understory.js:196`), mist 4 (`atmosphere.js:74-93`), plus plants, stones, mushrooms, backdrop, sky, motes, wisps, leaves, terrain
  - ~16 shadow-depth variants [c]
  - Shadow map 2048×1024 with `autoUpdate=false`, re-rendered on frames 1-9, 45 and 150 (`light.js:91-97`, `202-205`) [c]
  - Post: godrays (26 steps, 0.5), bilateral blur, bloom (7), `fxaa(graded)` with an extra full-res RTT (`post.js:49-83`) [c]
- **Compile:**
  - No loops or `If` in theme code [c].
  - (d) `light.wind()` is inlined in every bark/foliage vertex shader, and `light.haze()` in nearly every material (`light.js:150-189`) [c].
  - Graphs that are identical apart from JS constants still compile separately [c]:
    - mist ×4 bakes `index*0.0015`, `index*0.37` and a depth branch as literals: 4 WGSL programs (`atmosphere.js:81-93`)
    - bark ×7 / foliage ×8 / litter ×4 are separate node builds
- **Frame CPU:**
  - `reactions.update()` returns `getFrame()`, then `getFrame()` is called again. Each call spreads the envelopes and does `filter().map({...})` (`theme.js:501-502`, `reactions.js:388-407`) [c].
  - Spreads `{...frame,time}` (`theme.js:511`), `{...frame,front}` plus a wind object (`world.js:120-121`), and a closure (`light.js:193`) [c].
  - Leaf sim steps all 2600 leaves, and `write()` does 6 trig calls even for resting leaves (`leaf-sim.js:208-364`) [c].
  - ~83 KB/frame of full position + rotation re-uploads with no update range (`leaves.js:128-137`) [c].
  - Board poll every 0.75 s inside rAF: `querySelectorAll` + `getBoundingClientRect` + `getComputedStyle` (`theme.js:503-508`, `stage.js:21-46`) [c].
- **Frame GPU:**
  - ~10k double-sided foliage instances × 80-234 triangles, with wind and flutter per vertex (`forest.js:183-198`) [c].
  - Godrays: ~26-31 shadow taps per pixel at 0.5 [c].
  - Blur, bloom, the graded RTT + FXAA [c].
  - DPR ≤1.25 (`theme.js:27`) [c].
- **Quick wins:**
  1. Replace the canvas `renderer.render` at `post.js:48` with one pipeline render, or build godrays after the first pipeline frame (start/compile) [s].
  2. Skip `write()` for resting leaves and upload only the dirty range (`leaf-sim.js:341-364`, `leaves.js:128-137`) (CPU) [s].
  3. Pass mist constants as an attribute or uniform so 4 → 1 WGSL (`atmosphere.js:81-93`) (compile) [s].
  4. Drop the second `getFrame()` (`theme.js:501-502`); canvas `antialias:false`, since every frame goes through the pipeline (`theme.js:253`) (CPU + GPU memory) [s].

### 29. aether-tides — S3 K3 C3 G4
WebGPURenderer, `safeAnimate`. Post: samples 0, bloom. GPU fluid solver in fragment passes. Prefix `src/themes/aether-tides/aether-tides-`.
- **Start:**
  - Uncached `bakeNoise` 1.31M + half-float mips (`world.js:193`, `tsl.js:77-133`) [c].
  - The first frame runs `fluid.reset` (7 clears + dye) and then primes 24 shade passes (`fluid.js:576-584`, `light.js:208`) [c].
- **Pipelines:**
  - 7 fluid + shade + glow offscreen materials [c].
  - Stars and 3 fx materials are transparent + DoubleSide without `forceSinglePass` (`stars.js:65-76`, `fx.js:157-170`), so three r186 draws them twice and keys a pipeline per side (three `Renderer.js:3783-3791`, `WebGPUBackend.js:2464-2466`): 4 × 2 [c].
  - Bloom + output: ~26. 11 RTs [c].
- **Compile:**
  - (c) `walk()` JS-unrolls 18 steps × 2 stars = 36 dye taps (`light.js:122-141`, `quality.js:48`) [c].
  - Velocity: 13 taps + gyre (3) and well (4) unrolled (`fluid.js:300-387`) [c].
- **Frame CPU:**
  - 13 `quad.render` calls per sim step × ≤3 steps + 2 light passes (`fluid.js:619-624`, `light.js:209-222`) [c].
  - 7 object literals per step (`world.js:371-431`) [c].
  - Post params are reused (`theme.js:603`), which is good [c].
- **Frame GPU:**
  - ~13 passes per step on a ~267×150 grid; dye at 576 × ~1024; shade 36 taps [c].
  - Full-screen nebula: ~14 reads + 3 star layers + a ring Loop (`nebula.js:143-279`) [c].
  - 640 sparkles drawn twice [c].
- **Quick wins:**
  1. `forceSinglePass = true` in `additive()` and on the stars (`fx.js:169`, `stars.js:76`): −4 pipelines, half the draws [c mechanism].
  2. Module-cache `bakeNoise` (`world.js:193`) (start) [s].
  3. Spread the 24-pass first-frame priming (`light.js:208`) [s].

### 30. shifting-sands — S4 K3 C1 G4
WebGPURenderer; post; `safeAnimate`. Prefix `src/themes/shifting-sands/shifting-sands-`.
- **Start:** all synchronous in `createScene`; a quality change rebuilds in place [c].
  - `bakeTerrainGeometry` (`terrain.js:243-379`; it times itself, `theme.js:237`) [c]:
    - High: 300×256 = 76,800 `field.sample` (≈9 value-noise evaluations each)
    - Shadow sub-grid 101×86 × 20 steps = 173,720 `field.height` calls, each also running the rocks loop
    - Extreme: 161k samples + ≈896k heights
  - Rocks: ~36k vertices × 5 `P()` evaluations, each running 7 harmonics. A `[0,0,0]` allocation per vertex, then JS `push` → Float32 copies (`rocks.js:149`, `159-161`, `243-349`, `326-329`) [c].
  - Cold worm picker `idleBreach(0)`: 36 tries + bisection (`world.js:195-197`, `worm.js:659-690`) [c].
- **Pipelines:**
  - 8 scene materials [c].
  - Bloom with `_nMips=4`, so 6 pipelines (`post.js:160`) [c].
  - MSAA 4 on Ultra/Extreme only (`post.js:57-63`) [c].
  - About 15 pipelines in total [c].
- **Compile:**
  - (a) `WELL_SLOTS`=4 JS loop with an `If` per slot; each body is ~60 nodes (`terrain.js:514`) [c].
  - (a) Unrolls without `If` [c]:
    - vertex: 2 signs (`terrain.js:451`), 6 pulses (`:468`), 4 wells (`:477`)
    - fragment: 6 pulses (`:617`)
    - 8 shaft taps (`post.js:240-248`)
  - (c) The worm-sand vertex graph computes all 5 grain paths per instance and mixes them (`fx.js:255-368`) [c].
- **Frame CPU:** clean; only an `edgeFade` closure (`world.js:404`); the post params object is reused [c].
- **Frame GPU:**
  - Terrain: 153k triangles on High (321k Extreme) [c].
  - Its vertex shader re-evaluates signs, pulses and wells every frame [c].
  - Its fragment shader does `fwidth`, 4-6 fetches and glitter `pow(…,420)` [c].
  - 3000 worm-sand quads during a breach; blows 3×220 [s].
- **Quick wins:**
  1. Module-cache the terrain + rock arrays per tier (constant inputs, `world.js:134`) (start, large on Ultra/Extreme) [s].
  2. `shadowStride` 2→3 on Ultra/Extreme (`terrain.js:221-226`) (start) [s].
  3. Hoist the `[0,0,0]` scratch (`rocks.js:149`) (start/GC) [c].
  4. Wells → TSL Loop (`terrain.js:514`, `477`) (compile) [s].

### 31. neon-district — S2 K4 C1 G5
WebGPURenderer, `safeAnimate`. Post: MSAA-4 scene pass, bloom, output with 6×2 streak + 10-tap rays (`src/themes/neon-district/neon-district-post.js:62-63`, `123-291`). Planar reflector at 0.5 (`neon-district-street.js:103-105`). Prefix `src/themes/neon-district/neon-district-`.
- **Start:**
  - `createNoiseTexture` runs every build, even though its comment says "Baked once (≈ 45 ms)" (`tsl.js:137-231`, `world.js:240`) [c].
  - `bakeGlyphAtlas`: 64 × 4096 texels × segment distance, every build (`glyphs.js:115-150`, `world.js:261`) [c].
  - Two atlases (2560×2556 and 2048² webp) arrive after the scene is ready. The arrival frame pays decode, upload, GPU mips and anisotropy 8 (`theme.js:255`, `world.js:319-349`) [s].
- **Pipelines:**
  - ~21 scene materials; the facades are built 2× (rooms on/off) (`world.js:248-249`) [c].
  - Reflector RT uses samples 0 vs the MSAA-4 scene pass, giving pipeline variants for reflected materials [c key; ~+15 s].
- **Compile:**
  - No If chains or Loops [c].
  - `ndLockLight` (4 slots) and `ndClearLight` (2×4) are JS-unrolled and inlined at 16 call sites across 7 files (`tsl.js:346-382`) [c].
  - The street unrolls `LOCK_SLOTS` 2× (`street.js:183-216`) [c].
  - (c) The facade interior-mapping `colorNode` is very large and straight-line (`facades.js:156-385`), built 2× [c].
- **Frame CPU:** `applyPalette` → 2 `linRGB` arrays per frame (`world.js:628-669`); `fades` array (`world.js:712`); `post.update({time})` (`theme.js:598`) [c].
- **Frame GPU:**
  - The reflector re-renders all of layer 0 with mips [c].
  - Output: 1 + 2 + 1 + 12 + 10 taps at full res [c].
  - 9000 rain instances; 5200 dragon quads, always drawn and reflected (`fx.js:541`, `581`) [c].
- **Quick wins:**
  1. Module-cache the noise and glyph atlas (`world.js:240`, `261`) (start) [s].
  2. Move megatowers, dragon and sparks to a layer the mirror skips (`world.js:307-310`, `fx.js:581`) (GPU) [s].
  3. Reflection 0.5 → 0.4, or no mips (`street.js:104`) (GPU+pipelines) [s].
  4. Streak 12 → 4 taps and rays 10 → 6 on High (`post.js:63`) (GPU) [s].

### 32. halcyon-apex — S3 K3 C2 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4 scene pass, bloom, 10 shaft taps. Planar reflector + a directional shadow map. Prefix `src/themes/halcyon-apex/halcyon-apex-`.
- **Start:** after `await createRenderer` (`theme.js:190`), the world constructor runs synchronously [c]:
  - `bakeNoise` 1.31M (`world.js:138`, `tsl.js:108-164`)
  - `buildPlan()`: `occlusion()` over every grid point × all occluders, with literals per vertex (`world.js:139`, `plan.js:150-253`)
  - `createNoiseTexture`: ~350k `toHalfFloat` (`tsl.js:185-222`)
- **Pipelines:** ~39 in total [c]:
  - 16 materials
  - the reflector re-renders 12 layer-0 materials into its own RT, with mips (`water.js:113-118`, `world.js:386-391`)
  - 3 shadow-caster materials
  - shadow map 2048² on High (`quality.js:73`)
  - bloom
- **Compile:**
  - (c) The stone fragment is the biggest graph (`stone.js:101-195`) [c]:
    - 2 sky expansions
    - `haPulseLight` 2× (6 unrolled slots each)
    - `haClearLight` 2×4, `haLockLight` 6
    - 4 `lamp()` calls, atmosphere
  - Crystals: `haSkyBase` 3× + 3 refract lobes + pulses (`crystals.js:182-224`) [c].
  - Water: `haSkyLight` 3× + 6 rings + swells + a 5-islet loop (`water.js:240-266`) [c].
  - (d) Every `ha*` light helper is a uniform-reading inline (`tsl.js:320-449`) [c].
- **Frame CPU:**
  - `crystals.place()` every frame: `aPos.set([x,y,z,yaw])` for ~60 gems + a full upload (`world.js:1009`, `crystals.js:325-330`) [c].
  - `warm`/`plain` closures (`world.js:1040`, `1048`); `post.update({time})` (`theme.js:611`) [c].
- **Frame GPU:**
  - Reflector second render at 0.5 + per-frame mips (`water.js:114`, read at `.level(reach*1.4)` `water.js:205`) [c].
  - The shadow map is redrawn every 2nd frame on High, counted in frames, not time (`world.js:1071-1075`, `quality.js:73-74`) [c].
  - Water ~9 noise + shadow lookup over the lower screen; MSAA-4; 10 shaft taps [c].
- **Quick wins:**
  1. Time-based shadow cadence (e.g. 30 Hz), or redraw only on change (`world.js:1074-1075`) (GPU) [s].
  2. Indexed writes in `crystals.place` (`crystals.js:325`) (CPU) [c].
  3. Module-cache `bakeNoise` + `buildPlan(seed)` (`world.js:138-139`) (start) [s].
  4. Reflector without mips (`water.js:114`/`205`; visual check needed) (GPU) [s].

### 33. lunara — S3 K3 C2 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4 on High (`src/themes/lunara/lunara-post.js:59-61`), bloom, 10 shafts, fringe, calm ×5. Planar reflector on Medium and up. Prefix `src/themes/lunara/lunara-`.
- **Start:**
  - Uncached `bakeNoise` 1.31M (`world.js:132`, `tsl.js:104-160`) [c].
  - `buildPlan` (`world.js:133`, `layout.js:25`, `192-213`) [c]:
    - 36,864 `heightAt` calls, each running 3 `noiseAt` (a closure allocation each) + a 19-mound loop
    - scatter guard loops of 20k/40k
  - Half-float mips ~350k (`tsl.js:180-217`) [c].
  - The moon JPG is not awaited, which is good (`theme.js:259-263`) [c].
- **Pipelines:** 15 materials, the reflector at 0.5 with mips and samples 0 vs the MSAA-4 pass (~13 layer-0 materials get a second pipeline), bloom + output: ~36 [c key; s cost].
- **Compile:**
  - (d) The crystals fragment inlines `luSkyBase` 5× and `luMoonDiscs` 4× (dispersion) (`crystals.js:260-366`, `tsl.js:337-375`) [c].
  - (d) `luLockLight` 6 slots + `luClearLight` 2×4 appear in the crystals and flowers vertex stages, banks/ranges and water (`tsl.js:382-417`) [c].
  - Sky: 3 curtains, 6 ungated halo rings, 2 star layers (`sky.js:170-210`) [c].
- **Frame CPU:** `post.update({time})` (`theme.js:602`); `warm` closure (`world.js:888`); event re-uploads; `touch()` copies 240 crystals per strike (`crystals.js:205-214`) [c].
- **Frame GPU:** reflector second render + mips; MSAA-4; water 4-6 noise + reflector tap; 1200 motes + 512 shards [c].
- **Quick wins:**
  1. Module-cache noise + mips, copying cinder's `bakedOnce` (`src/themes/cinder-drift/cinder-drift-tsl.js:106-114`) (`world.js:132`) (start) [s].
  2. Start `createRenderer()` before the synchronous bake (`theme.js:195`) [s].
  3. Gate the halo rings (`sky.js:201`) [s].
  4. Reflector without mips (`water.js:69`, `146`) [s].

### 34. ice-temple — S3 K3 C2 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4, bloom, 10 rays + 4×2 streak, lens rime with 2 Voronoi in nested `If`s, fringe, calm ×5 (`src/themes/ice-temple/ice-temple-post.js:65-67`, `203-280`). Planar reflector on Medium and up. Prefix `src/themes/ice-temple/ice-temple-`.
- **Start:** `createNoiseTexture()` 1.31M + ~350k half floats + mips on every build. Its own comment says ≈45 ms (`world.js:194`, `tsl.js:162-254`) [c].
- **Pipelines:** 12 materials; the reflector at 0.5 with mips and samples 0 duplicates 6 layer-0 parts; bloom + output: ~26 [c].
- **Compile:**
  - (a-mild) 4 JS-unrolled `If` blocks for `LOCK_SLOTS`, each ~40 ops + noise + 2 hashes + atan (`floor.js:225-264`) [c].
  - (d) Inline helpers [c]:
    - `itSky`, `itLobes`, `itMoonShadow` (4 rows), `itLockLight`, `itClearLight` (2×4), `itAtmosphere` go into the floor and architecture (`architecture.js:369-486`)
    - The `airLight` vertex block is duplicated into snow, dust and mist (`atmosphere.js:89-103`, `117`, `152`, `201`)
- **Frame CPU:** `paletteRGB()` builds 4 `linRGB` arrays + an object every frame (`world.js:97-99`, `565`, `608`); `post.update({time})` (`theme.js:590`) [c].
- **Frame GPU:** reflector + mips; the floor runs 2 Voronoi + cracks + 3 bubble layers; 5200 snow + 2200 dust with heavy vertex shading; 18 transparent mist sheets 11-20 m wide (`atmosphere.js:183-217`); post rays + streak + rime [c].
- **Quick wins:**
  1. Module-cache the noise (`world.js:194`) (start) [s].
  2. Precompute the 4 linear palettes once (`world.js:565`) (CPU) [c].
  3. Gate the pulse terms in `airLight` with live flags, as lunara does (`atmosphere.js:99-100`) (vertex GPU) [s].

### 35. starlight — S3 K3 C2 G4
WebGPURenderer; post; `safeAnimate`. Prefix `src/themes/starlight/starlight-`.
- **Start:**
  - `bakeNoise` ≈1.25M inner iterations; texture `generateMipmaps=true` (`core.js:232-290`, `tsl.js:65`) [c].
  - `generateCatalog(30000)` on High (`core.js:366-431`) [c]:
    - A rejection `while` loop. Each candidate costs `skyToGalactic` + `bandLight` + `dustAt` (4 bilinear reads).
    - Each accepted star is a new object, then 30k objects are sorted.
    - Roughly 50-100k iterations [s]. Ultra 42k, Extreme 56k stars.
- **Pipelines:**
  - 9 scene materials: sky; field/glints/lines/streaks × sky + lake twins (`stars.js:206-207`, `319`, `427`; `fx.js:180-181`) [c].
  - Bloom (7) + output, about 17 pipelines; no MSAA [c].
- **Compile:**
  - The biggest graph is the sky dome fragment (`sky.js:68-243`), straight-line [c]:
    - ~13 texture reads, `powder` 2×
    - the `RINGS`=6 body JS-unrolled twice (`tsl.js:211`, `227`)
    - `LAMPS` 4× (`tsl.js:221-224`)
  - (a) The 6-ring unroll is also inlined into 4 mirrored vertex shaders via `mirrorDir`, so 5 pipelines carry it (`stars.js:140`, `248`, `370`; `fx.js:102`) [c].
  - (d) `ridges` (4 reads + atan) is inlined in the sky and in all 6 star vertex shaders via `aboveHills` (`stars.js:79-82`) [c].
- **Frame CPU:**
  - `post.update({time})` (`theme.js:614`) [c].
  - `setTrailing` runs `parts.forEach` every frame (`world.js:973` → `stars.js:209-214`) [c].
  - While events are staged: 2 `filter` + `sort` + closures (`world.js:941-946`) [c].
- **Frame GPU:**
  - 30k sky + 25.5k mirrored stars [c].
  - When `exposure > 1e-4` they become 30-vertex strips, ≈1.66M vertices. That happens in combos and also in level-up/T-spin swings, because `|spin|` feeds exposure (`world.js:970-973`) [c].
  - Each star vertex does 4 `ridges` fetches; mirrored ones add 2 fetches + 6 rings [c].
  - The sky computes both the water and sky paths for every pixel, via `select` (`sky.js:82`, `242`) [c].
- **Quick wins:**
  1. Gate the water path behind `If(view.y<0)` (`sky.js:73-81`, `229-241`) (GPU) [s].
  2. Pack `ridges` into a 1-read crest texture, as solar-eclipse does (`tsl.js:177-186`) (GPU per star vertex) [s].
  3. Module-cache `bakeNoise` + `generateCatalog` by seed and count (`world.js:221-223`) (start) [s].
  4. RINGS unroll → TSL Loop over the uniformArray (`tsl.js:211`, `227`) (compile, 5 pipelines) [s].

### 36. bioluminescence — S3 K3 C2 G4
WebGPURenderer (`depth:false`), `safeAnimate`. Post: MSAA-4 scene pass, bloom, 10-tap shaft output (`src/themes/bioluminescence/bioluminescence-post.js:59-60`, `120-243`). Pool reflector at 0.5 with mips (`bioluminescence-water.js:87-89`). Prefix `src/themes/bioluminescence/bioluminescence-`.
- **Start:**
  - The constructor runs `bakeNoise()` + `buildPlan()` (`world.js:141-142`) [c]:
    - `buildPlan`: 161×221 grid × 2 `floorHeight` + `shoreDistance`, plus the vault grid, plus a pad loop of ≤3000 tries with `.some` (`layout.js:159-171`, `475-484`)
  - `createNoiseTexture`: ~350k `toHalfFloat` (`tsl.js:111-148`) [c].
- **Pipelines:**
  - ~20 scene materials: cavern ×5, mushrooms ×4, … [c].
  - The reflector's samples 0 vs MSAA 4 gives variants [s].
- **Compile:**
  - JS unrolls: `blLockLight` 8 slots, `blClearLight` 2×4, 6 drips, 8 rings inside an `If` (`tsl.js:367-401`, `water.js:122-150`) [c].
  - (d) `blLamps`/`blScatter`/`blLampImage` are inline `Fn(()=>…)()` Loops re-emitted per call site; `blAtmosphere` adds `blScatter` to every material (`tsl.js:295-361`) [c].
- **Frame CPU:**
  - `peek()` allocates `{state,o4,o3}` per call, up to 24 per frame (`mushrooms.js:482-485`, `521-540`) [c].
  - `PALETTE_KEYS.forEach` (`world.js:981`); `post.update` (`theme.js:596`) [c].
- **Frame GPU:**
  - Every lit surface loops 12 lamps, and the atmosphere loops 12 scatter lamps (2 atan + sqrt + exp each) (`quality.js:83-84`) [c].
  - The reflector repeats this for layer 0 at 0.5 with mips [c].
  - MSAA 4 [c].
- **Quick wins:**
  1. Module-cache the noise + plan (`world.js:141-142`) (start) [s].
  2. High `tier.scatter` 12 → 6 (`quality.js:84`) (GPU) [s].
  3. Scratch object in `peek()` (`mushrooms.js:482-485`) (CPU) [c].
  4. Reflection 0.5 → 0.4, or no mips (`water.js:88`) (GPU) [s].

### 37. ocean — S3 K3 C2 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4 scene pass with sampled depth, shaft RTT at 0.5, bloom, output (`src/themes/ocean/ocean-post.js:145-327`). Prefix `src/themes/ocean/ocean-`.
- **Start:** the whole build is synchronous and unsliced after `await createRenderer` (`theme.js:216`, `247-252`) [c].
  - `createNoiseTexture(bakeNoise())` re-bakes on every build: 1.31M + a CPU mip chain (`world.js:265`, `tsl.js:133-220`) [c].
  - Seabed 161×201, ~13 `seabedHeight` calls per vertex, literals per vertex and quad (`seabed.js:62-87`) [c].
  - 6 reef builders + `instanceColonies` [c].
- **Pipelines:**
  - ~20 scene materials (6 colony kinds, giants ×3, …), light-pass quad, shaft RTT, bloom, output: ~30 pipelines [c].
  - 512² light RT with mips (`tsl.js:597-614`) [c].
- **Compile:**
  - Small unrolls only: `causticNet` 5× inside a layout'd Fn, 6 wave trains, 5 calm rects + 2 shocks [c].
  - Shaft `Loop(16)` with a nested `ocShade` Loop (`post.js:355-366`, `tsl.js:393-414`) [c].
  - `ocStains`/`ocRings` loops sit in every colony's vertex varyings (`reef.js:524-525`) [c].
- **Frame CPU:**
  - `ask` literal + `Object.keys().forEach` (`world.js:1056-1066`) [c].
  - Giant placement spreads and closures (`world.js:933-940`) [c].
  - `post.update({time})` (`theme.js:666`) [c].
  - Emit does full re-uploads (`fx.js:228-249`) [c].
- **Frame GPU:**
  - The 512² light pass renders every frame and regenerates its 9-level mips (`theme.js:662`, `world.js:1183-1185`, `tsl.js:609`) [c].
  - 16-step shaft march at 0.5, MSAA-4 [c].
  - Always-drawn pools: school 2200, grass 1700, motes 1500, pool 960 [c].
- **Quick wins:**
  1. Module-cache the noise (`world.js:265`) (start) [s].
  2. Light-RT mips every 2nd frame, or none (`tsl.js:609-611`) (GPU) [s].
  3. High shafts 16 → 12 (`post.js:73`) (GPU) [s].

### 38. chromatic-impasto — S3 K3 C3 G3
WebGPURenderer (`depth:false`), `safeAnimate`. Post: no MSAA, bloom, fringe, calm ×5. Offscreen paint RTs. Prefix `src/themes/chromatic-impasto/chromatic-impasto-`.
- **Start:**
  - 4 HalfFloat paint RTs, height clamped to 384-1408 (`world.js:231-237`, `canvas.js:213-230`, `424-427`) [c].
  - The first frame runs `compose()`, then `clear` + `warm()` (bake ×2 + dry) (`world.js:322-344`, `938`, `994-999`) [c].
  - The intro is time-sliced over 3.4 s. A restart past 3.4 s, or `importPainting`, replays at `FRAME_BUDGET` 9000 quads/frame (`core.js:38`; `world.js:56-57`, `1004-1006`; `theme.js:189`, `259`) [c].
- **Pipelines:**
  - `plain()` sets DoubleSide, and `overBlend`/dry are transparent (`canvas.js:194-211`, `336-337`). So pigment, relief and dry each render back + front passes: +3 pipelines and 2× draws per flush [c].
  - ~21 in total [c].
- **Compile:**
  - (c/d) `stampNodes()` is built 2× (`canvas.js:62-191`, `300-314`), each with ~13 `ciTrack` + 6 hash + 2 lobes + weave + 3 noise [c].
  - The surface has 19 JS-unrolled dependent relief samples: parallax 2, normal 4, AO 4, shadow 8, centre (`surface.js:67-222`) [c].
- **Frame CPU:** 2 closures per frame in `advance`, `into()` arrows, `mixRgb` array, `post.update({time})` (`world.js:1004-1051`, `canvas.js:517-527`, `theme.js:627`) [c].
- **Frame GPU:** a full-screen surface with 20 taps + GGX; stamping only while paint is due; dry every 0.25 s [c].
- **Quick wins:**
  1. `forceSinglePass = true`, or FrontSide, in `plain()` (`canvas.js:209`): −3 pipelines, half the stamp/dry draws [c mechanism].
  2. `FRAME_BUDGET` 9000 → ~3000 (`world.js:57`) (replay spikes) [s].

### 39. geode — S3 K3 C3 G3
WebGPURenderer (`antialias:false`, `depth:false`), `safeAnimate`. Post: MSAA-4 scene pass, bloom, output. Prefix `src/themes/geode/geode-`.
- **Start:** all synchronous in `createScene` (`theme.js:219-227`) [c]:
  - `bakeNoise()` in the constructor: 1.31M, constant seed 4409 (`world.js:130`, `tsl.js:155-211`).
  - `createNoiseTexture`: ~349k `toHalfFloat` (`tsl.js:236-237`).
  - `buildPlan` druzy: 11,000 rejection-sampled points with 3 `.set([...])` + array allocations each, and 4-5 `sampleNoise` calls that each allocate a closure (`layout.js:239-265`, `tsl.js:221`).
  - Shell: 23,541 vertices × 5 `plan.surface()` calls ≈ 235k `sampleNoise`, per-vertex arrays, and 139k JS index pushes (`shell.js:95-135`).
- **Pipelines:** 9 scene materials + bloom + output. MSAA-4 RT [c].
- **Compile:**
  - Small unrolls only [c]:
    - wave sums ×6/×6/2×4 inlined in the shell, crystal, druzy and air stages (`tsl.js:376-451`)
    - Voronoi 3×3 in an `If` (`shell.js:271-280`)
    - `crownColor` ×8 built 2× (`crystals.js:262`, `276`)
  - The crystal `colorNode` is large (~60 terms, `crystals.js:308-407`); `grown()` is rebuilt 3× (`crystals.js:256-296`) [c].
- **Frame CPU:**
  - `touch()` re-packs all 476 crystals with 5 `subarray()` views each, on every strike (`crystals.js:225-235`, `651`) [c].
    - `sendWisp` strikes 8 crystals (`world.js:466-475`), so a lock costs ~19k views.
    - A hard drop (3 wisps, `world.js:534-541`) costs ~57k.
  - 10 template-string keys every frame (`world.js:812-819`) [c].
  - `{time}` literal (`theme.js:594`) and a breath options literal (`world.js:390`) [c].
- **Frame GPU:** MSAA-4 at DPR 1.15; 11k druzy instances (~594k tiny-triangle verts, MSAA quad overshading [s]); the DoubleSide shell is ~full-screen; 10 shaft + 3 scene taps (`post.js:225-236`) [c].
- **Quick wins:**
  1. Write only the struck crystal's 19 floats + `addUpdateRange`, and call `touch` once per frame (`crystals.js:225-235`, `651`) (CPU spike per lock) [s].
  2. Module-cache `bakeNoise` + mips (`tsl.js:155`, `231`) (start) [s].
  3. `Uint32Array` index; reuse the `sampleNoise` closure (`shell.js:126-135`, `tsl.js:221`) (start) [s].

### 40. moonrise-summit — S2 K4 C1 G4
Classic `WebGLRenderer` (`alpha:true`) with GLSL `ShaderMaterial`s. EffectComposer: RenderPass + UnrealBloomPass + grade ShaderPass (`src/themes/moonrise-summit/moonrise-summit-post.js:94-112`). `safeAnimate`. Prefix `src/themes/moonrise-summit/moonrise-summit-`.
- **Start:**
  - The CPU build is cheap (`theme.js:423-437`) [c].
  - No `compileAsync` or warm: about 21 programs link synchronously in the first `composer.render()` (`theme.js:366-371`) [c].
  - Hidden aurora and god-ray programs compile when revealed (`theme.js:324-329`) [c].
  - `compute.js:13` imports `three/webgpu` into a WebGL-build theme, so both three builds are evaluated [c]; cost [s].
- **Pipelines:** about 12 scene programs + ~9 composer programs; full-res ping-pong targets + 5-mip bloom [c].
- **Compile (ANGLE → HLSL/FXC):**
  - `fbm` is `for(i<6){ if(i>=octaves) break; snoise }`, likely fully unrolled ×6 per call site (`shaders.js:72-83`) [s].
  - fbm call sites [c]:
    - cloud and mist: 2 `fbm` each, ≤12 snoise (`shaders.js:291`, `708`)
    - sky (`shaders.js:138-143`), aurora (`shaders.js:246-256`), god ray (`shaders.js:753`)
  - Heavy snoise users without fbm [c]:
    - water: 7 snoise + 3×3 Voronoi (`shaders.js:597-661`)
    - moon: 3 snoise + Voronoi (`shaders.js:399-430`)
    - mountain: 6 snoise (`shaders.js:338-363`)
- **Frame CPU:** trivial; a redundant rim loop (`theme.js:1068-1073`) [c].
- **Frame GPU:**
  - `pixelRatioCap` is 2.0 on High (`theme.js:148`, `164`), against ~1.15-1.25 fleet-wide [c].
  - 4 full-width transparent mountain planes, each running 4 snoise before the discard and 2 after (`shaders.js:338-363`) [c].
  - 3 mist layers (≤12 snoise), 3 clouds (12), 2 auroras (8) and the sky (7) all overlap [c]: about 30-50 snoise per pixel [s].
  - UnrealBloom + grade at full DPR [c].
- **Quick wins:**
  1. High `pixelRatioCap` 2.0 → ~1.25 (`theme.js:164`) (GPU, up to ~2.5× fewer fragments on HiDPI) [s].
  2. Move the ridgeline (depends on `uv.x` only) to the vertex stage or a 1D texture (`shaders.js:338-345`) (GPU+compile) [s].
  3. Fixed-count `fbm3`/`fbm4` without `break` (`shaders.js:72-83`) (compile) [s].
  4. `await renderer.compileAsync(scene,camera)` + one hidden `composer.render()` before the loop (`theme.js:366-371`) (first-frame hitch) [s].

### 41. vesper-chrysalis — S2 K4 C1 G4
WebGPURenderer, `safeAnimate`. Post: MSAA-4, bloom, 10 shafts, prism, fringe. Planar reflector of HERO_LAYER. Prefix `src/themes/vesper-chrysalis/vesper-chrysalis-`.
- **Start:** `bakeNoise` 1.31M in the constructor (`world.js:121`), plus `createNoiseTexture` ~350k `toHalfFloat` (`tsl.js:194-231`) [c].
- **Pipelines:** 15 materials, plus the reflector at 0.5 re-rendering 12 HERO_LAYER materials (`lake.js:67-68`, `world.js:268-271`, `355-363`), bloom and output: ~35 in total [c].
- **Compile:**
  - (c) `vcBackdrop` (`tsl.js:459-631`) is a very large inline graph [c]:
    - 3 `If` blocks, ~14 noise fetches
    - 2 star layers via `forEach`, 2 aurora curtains, 3 ranges × 2 noise
    - It is compiled in both the sky (`sky.js:31`) and the lake (`lake.js:150`).
  - The lake adds 12 + 3 unrolled waves (`lake.js:107-123`) [c].
  - (d) `vcSkyBase`/`vcSkyLight` are inlined 2× in petals, the shell and the spires (`blooms.js:181`, `relic.js:151-153`, `shore.js:124-126`) [c].
- **Frame CPU:** `PALETTE_KEYS.forEach` (`world.js:905`); `post.update({time})` (`theme.js:640`) [c].
- **Frame GPU:**
  - Sky + lake together run about one full-screen `vcBackdrop` per frame (`lake.js:89-150`) [s].
  - Reflector second render; MSAA-4 + 10 shafts [c].
  - 20 transparent pads, 18 lily-sizes wide (`blooms.js:218-246`) [s].
- **Quick wins:**
  1. The lake mirror calls `vcBackdrop(u, Rup, { lite:true })` (`lake.js:150`) (GPU+compile) [s].
  2. Wrap the ranges and cloud blocks in elevation `If`s (`tsl.js:589-627`) (GPU) [s].
  3. Module-cache `bakeNoise` (`world.js:121`) (start) [s].

### 42. nebula-flow — S2 K4 C1 G4
WebGPURenderer, `safeAnimate`. Post: pass + bloom + output (`src/themes/nebula-flow/nebula-flow-post.js:122-285`). Prefix `src/themes/nebula-flow/nebula-flow-`.
- **Start:** `bakeNoise` 1.31M (one `visit` closure call per texel) + `bakeRelief` 655k + ~700k `toHalfFloat`, the same at every tier (`core.js:90-228`, `tsl.js:146-163`); frame-0 `world.update` (`theme.js:291`) [c].
- **Pipelines:** 6 materials + bloom + output [c].
- **Compile:**
  - (a) The light-tap loop is JS-unrolled: 5 on High, 7 on Extreme (`nebula.js:305-307`) [c].
    - Each copy has a warp read, ≤3 relief reads (the JS octave loop in `dustAt`, `nebula.js:129-139`) and a full `shapeAt`.
  - (d) `shapeAt = Fn(...)` has no `.setLayout()` (`nebula.js:86-116`) [c].
    - Its body is a Loop over 4 pillars with 2 `nfTaper` + 2 `nfSmin` each.
    - It is inlined 8×: `shape0` (`nebula.js:270`), 5 light taps via `dustAt` (`nebula.js:140`), 2 for the normal (`nebula.js:317`).
- **Frame CPU:** `writeBirths` sets 192 Vector4 rows + lanterns every frame (`world.js:961-999`); `palettePhase` object; `post.update({time})` (`theme.js:633`) [c].
- **Frame GPU:**
  - One full-res nebula fragment: ~12 fetches in the open; near pillars add 5 shadow taps × (8 tapers + 2-4 fetches) + 2 `shapeAt` (`nebula.js:167-377`) [c].
  - 12 ray taps [c].
- **Quick wins:**
  1. Light taps → two TSL `Loop`s (2 taps at `detail` octaves, the rest at 1), removing 4-6 inlined `dustAt`+`shapeAt` copies (`nebula.js:305-307`) (compile, large) [s].
  2. `setLayout` on `shapeAt`, with the pillar rows passed in (`nebula.js:86`) (compile; needs a test) [s].
  3. Module-cache `bakeNoise`/`bakeRelief` (`core.js:157`, `192`) (start) [s].

### 43. tornado — S3 K3 C2 G3
WebGPURenderer, `safeAnimate`. Post: MSAA-4 scene pass on High, bloom, output (`src/themes/tornado/tornado-post.js:53-72`, `119-278`). Prefix `src/themes/tornado/tornado-`.
- **Start:**
  - `build()` runs synchronously after `await createRenderer` (`theme.js:218`, `241-246`) [c]:
    - `bakeNoise`: 19 octave passes × 65,536 ≈ 1.25M gradient evaluations + mipmaps; constant seed 1925 (`tsl.js:53-124`, `world.js:204`)
    - wheat 48k-instance loop (`field.js:133-145`)
  - `warmParkedDrawables` runs a full post render + settle render at the end of `createScene` (`theme.js:290`, from 83146e98), so all pipelines are requested there [c].
- **Pipelines:**
  - 16 NodeMaterials [c].
  - The 3 satellite children bake `index` as a JS constant, giving 3 distinct WGSL (`funnel.js:97-98`, `331-338`) [c].
  - MSAA-4 scene pass, bloom [c].
- **Compile:**
  - (a) No `If` in any of the unrolls [c]:
    - RIBBONS 6× (3 `tnGauss` each) (`funnel.js:163-176`)
    - FLASHES 3× in funnel, sky and ground (`funnel.js:152-156`, `sky.js:164-168`, `field.js:103-107`)
    - RINGS 4× in ground and wheat (`field.js:46-58`, `99`, `157`)
  - (c) Sky `read()`: 2 phases × 2 `deck()`, up to 12 taps (`sky.js:109-172`) [c].
  - (d) `funnelRadiusNode`/`funnelCentreNode` are inlined many times in the debris and mote vertex stages (`fx.js:81-98`) [c].
- **Frame CPU:**
  - `applyPalette()`: a closure, a 15-key array and `includes` per key every frame (`world.js:612-626`) [c].
  - `scheduled.filter` (+ `sort`) while strikes are pending (`world.js:706-711`) [c].
  - `post.update({time})` (`theme.js:649`) [c].
- **Frame GPU:**
  - MSAA-4 scene pass [c].
  - Stacked transparent funnel shells: body 96×128, veil, skirt, ≤3 children, dust, front (`funnel.js:54-261`) [c]; overdraw [s].
  - Sky ≤12 taps; wheat 480k triangles [c].
- **Quick wins:**
  1. Child `index` → uniform or attribute: 3 → 1 pipelines (`funnel.js:97-98`) (compile) [s].
  2. Memoize `bakeNoise(seed)` (`tsl.js:53-124`) (start) [s].
  3. Hoist the palette key list and set `uTime` directly (`world.js:612-626`, `theme.js:649`) (CPU) [s].
  4. High `msaa:0` (`post.js:61`) (GPU) [s].

### 44. moonlit-forest — S2 K4 C2 G3
WebGPURenderer (canvas MSAA when AA is on), `safeAnimate`. No post: direct `renderer.render` (`src/playground/effects/moonlit-forest-master.effect.js:1548-1549`). Warm is `compileAsync` plus one primed render (`src/themes/moonlit-forest/moonlit-forest-theme.js:345-363`).
- **mx sites** (the only `mx_noise` left in the fleet, all in `src/playground/effects/moonlit-forest-master.effect.js`), ranked [c]:
  1. `:531` sky: `mx_fractal_noise_float(dir×2.7, 3 oct)` over most of the screen; Medium and up.
  2. `:574` + `:577` moon: the fractal 3D overload plus the `mx_noise_float` 2D overload, so both Perlin families in one shader. The input is static UV, so it can be baked.
  3. `:904` foliage (3D)
  4. `:887` bark (3D)
  5. `:763` terrain (2D)
  6. `:1173` mist (3D; Medium and up)
  7. `:605` shaft (3D)
  8. `:651` veil (3D; hidden at rest but primed)
  - Low and Minimal still compile 5 mx pipelines. `atmosphereNoise=false` drops only sky, veil and mist (`:40-60`) [c].
- **Start:** small geometry, then `await compileAsync` + one render (`moonlit-forest-theme.js:355-362`) [c].
- **Pipelines:** 26 materials. 3 ridge and 3 forest-layer materials bake their colour as literals, giving 6 WGSL where 2 would do (`:693-701`, `719-745`) [c].
- **Frame CPU:** 3 object literals per frame (`moonlit-forest-fx-controller.js:276-287`, `moonlit-forest-theme.js:559-567`, `master.effect.js:445-448`) [c].
- **Frame GPU:**
  - Sky with 3-octave 3D Perlin per pixel [c].
  - Foliage, bark and terrain with one Perlin each [c].
  - 3 mist strips [c].
  - Canvas MSAA at DPR 1.35 (`moonlit-forest-theme.js:32`) [c].
- **Quick wins:**
  1. Bake the moon colour to a small DataTexture (`:574-579`) (compile) [s].
  2. Replace every mx site with a shared baked tileable noise `texture()`, as stillwater and koi do: 8 mx pipelines → 0 (compile, large) [s].
  3. Ridge and forest colours as uniforms: 6 → 2 pipelines (`:694-697`, `738-745`) [s].

### 45. winter — S2 K3 C2 G4
WebGPURenderer, `safeAnimate` (`src/themes/winter/winter-theme.js:598`). Post: MSAA scene pass, bloom, one big output pass (`winter-post.js:120-293`). Shared fox engine. Prefix `src/themes/winter/winter-`.
- **Start:**
  - Serial: `await createRenderer` (`theme.js:212`), then `await world.load()` (`theme.js:248`) [c].
  - `load()` uses `setTimeout(0)` breaths for planting, the ground fan and the 1024² shadow-mask bake, which is good (`world.js:241-256`). The ghost fetch still waits for the renderer [c].
  - `build()` runs `createNoiseTexture(bakeNoise())` synchronously: ≈655k gradient evaluations + 262k `toHalfFloat` + a CPU mip chain. The seed is fixed (`world.js:261`, `tsl.js:115-216`) [c].
  - Shadow mask: rasterizes 1M texels plus 4 box blurs; re-baked on aspect change with an 8-frame cooldown (`field.js:129-202`, `world.js:448-458`) [c].
  - The fox GLB loads after the first frame, so the fox, fur and spirit pipelines compile mid-run (`world.js:293-312`) [c]; hitch [s].
- **Pipelines:**
  - About 11 materials. Trees share one material across buckets (`trees.js:116`) [c].
  - No shadow-map pass: shadows come from the CPU mask [c].
  - Post: MSAA-4 at High (`post.js:62-64`, `124`), bloom, output [c].
- **Compile:**
  - (a) JS unrolls without `If` [c]:
    - `wAurora` curtains: 3 in the sky (`sky.js:96`) and 2 in the ground mirror (`ground.js:155`), each ~70 nodes with fold sins and 3 noise reads (`tsl.js:416-462`)
    - `wSkyTint` 6 slots × 2 (`tsl.js:385-393`)
    - `wRingLight` 4 (`tsl.js:493-502`), `wGust` 3 (`tsl.js:513-524`)
    - post: calm rects ×5, shaft taps ×10 (`post.js:185-190`, `226-231`)
  - (d) `wSky` lands 2× in the ground graph (`ground.js:154`, `193`) [c].
- **Frame CPU:**
  - Mostly clean: reused `_post`/`_sim`, trigger-scheduled layout reads (`theme.js:510-533`) [c].
  - `post.update({time})` (`theme.js:650`) [c].
  - `HOUR_KEYS.forEach` (`world.js:1015-1018`) [c].
  - `emit()` allocates options, a `mulberry32` closure and 4 literals per sprite, then re-uploads 4 whole buffers (`fx.js:168-207`). This runs most frames during a chain [c].
- **Frame GPU:**
  - MSAA-4 HalfFloat scene pass [c].
  - Sky: wSky, stars, moon and 3 aurora sheets per pixel [c].
  - Ground: ~12 noise reads, mirror aurora, glints, rings, gusts, 2× `wSky` [c].
  - Output: 10 shaft + 2 fringe taps [c].
  - Fox fur 14 shells; spirit 5 veils [c].
- **Quick wins:**
  1. Memoize `bakeNoise()` (fixed seed) or move it into the `load()` breaths (`world.js:261`) (start) [s].
  2. Write typed arrays directly in `emit()` with `addUpdateRange` (`fx.js:188-207`) (CPU) [s].
  3. High `msaa` 4 → 0/2 (`post.js:62-64`) (GPU) [s].
  4. Curtain parameters in a uniform array walked with `Loop`, or `count:1` for the mirror (`tsl.js:416-462`, `ground.js:155`) (compile) [s].

### 46. supernova — S3 K2 C3 G3
WebGPURenderer (`depth:false`), `safeAnimate`. Post: no MSAA on High (`src/themes/supernova/supernova-post.js:78`), bloom, rays, streak, ripple. Prefix `src/themes/supernova/supernova-`.
- **Start:** `bakeNoise3D` on every build: 64³ × 4 ch × 3 octaves ≈ 3.15M trilinear 8-gradient evaluations; constant seed 1987 (`world.js:178`, `314`; `tsl.js:101-195`) [c].
- **Pipelines:** 9 scene materials + bloom + output; one Data3DTexture [c].
- **Compile:**
  - Star impacts: 6 slots unrolled inside an `If` (`star.js:193-211`) [c].
  - Nebula `Loop(shellCount)` with the `crossing` closure inlined 2× (`nebula.js:120-169`) [c].
  - (d) `snPastStar` is inline in 5 materials (`tsl.js:310`) [c].
- **Frame CPU:** `writeShells` every frame (`world.js:1302-1407`, `1485`) [c]:
  - a `put` closure
  - per shell, `colA`/`colB` arrays + 5 literals
  - per front, 5 literals
  - during a blast, 2 `map` arrays + 2 closures per shell
  - plus `warm`/`follow` closures (`world.js:1547`, `1569`)
  - Roughly 35-110 short-lived arrays per frame [s].
  - Sparks already use `addUpdateRange` (`fx.js:285-296`), which is the model to copy [c].
- **Frame GPU:** two full-screen BackSide domes (sky 2 × 3D reads + lattices; nebula ~4 × 3D reads per shell row, ×4 at rest, ×15 in events); the star billboard spans 16 radii; 8 ray + 16 streak taps (`post.js:279-301`) [c].
- **Quick wins:**
  1. Scalar writes + scratch `colA`/`colB` in `writeShells` (`world.js:1302-1407`) (CPU/GC) [c].
  2. Module-cache `bakeNoise3D` (`tsl.js:101`) (start) [s].

### 47. himalayan-peak — S4 K2 C1 G3
WebGPURenderer, `safeAnimate`. Post: MSAA-4 scene pass, bloom with a custom highpass, output. Prefix `src/themes/himalayan-peak/himalayan-peak-`.
- **Start:**
  - Strictly serial: `await createRenderer` (`theme.js:208`), then `await world.load()` (`theme.js:240`). `loadMassif` fetches a 2.28 MB 1024² PNG, then inflates, unfilters 4 MB and decodes 1M (`assets.js:56-66`, `field.js:52-61`) [c].
  - `deriveFieldInSteps` has 4 `setTimeout(0)` breaths (`assets.js:110-128`), but each slice is one large task [c] (long tasks [s]):
    - `shadeMap` 1M px × ~25 closure reads (`field.js:67-91`)
    - `horizonMap` ~1.65M line steps (`field.js:115-158`)
    - `shadowSlices` 5M (`field.js:201-225`)
    - `buildMassifMesh` ~2.04M `sampleField` calls + 262k cells, with an `indices.set([...])` literal per cell (`field.js:270-381`)
  - `build()` is synchronous [c]:
    - `bakeNoise` + `createNoiseTexture` (`tsl.js:117`, `193`; `world.js:254`)
    - `halves()` makes ~2.1M `toHalfFloat` calls on the horizon map, plus 262k + 65k (`tsl.js:249-268`)
    - pass snow and cloud fan geometry
    - The shade texture generates a 1024² mip chain on the GPU (`tsl.js:264`).
  - The eagle GLB is fetched after `build()` and added when it arrives, so its skinned pipeline compiles after reveal. Warm roots are `[]` (`world.js:297-306`, `theme.js:649`) [c].
- **Pipelines:** 13 scene materials + bloom (7) + output, ~21. MSAA-4 scene RT (`post.js:123`) [c].
- **Compile:**
  - No If chains and no mx [c].
  - The massif fragment is the largest graph (`terrain.js:60-149`) [c]:
    - 9 noise fetches
    - `hpWaveLight` 2×4 unrolled (`tsl.js:466-478`)
    - `hpAtmosphere` with 5 air taps (`tsl.js:444-449`)
    - `hpSky`
  - Clouds inline `surface()` 2× in the fragment plus 1× in the vertex stage (`clouds.js:106-120`) [c].
  - Flags `gustAt` 6 slots per vertex (`flags.js:73-85`) [c].
- **Frame CPU:**
  - Nearly allocation-free [c].
  - `warm` closure (`world.js:929`); `post.update({time})` (`theme.js:633`) [c].
  - Eagle mixer + `updateMatrixWorld(true)` (`eagle.js:111-112`) [c].
- **Frame GPU:**
  - MSAA-4 at DPR 1.15 [c].
  - Transparent cloud fan over the lower screen: 5 noise + 5 air taps + an 8-term wave per pixel (`clouds.js:110-138`) [c].
  - 1200 spindrift billboards [s].
  - Dormant pools still run vertex work: papers 720, avalanche 220 (`fx.js:118`, `snow.js:179`) [c].
- **Quick wins:**
  1. Start `loadMassif()` before `await createRenderer` (`theme.js:208`, `world.js:239`) (start) [s].
  2. Module-cache the noise; move `halves(field.horizon)` into the breathed steps (`world.js:254`, `tsl.js:265`) (start) [s].
  3. Load the eagle alongside the massif, or `compileAsync` its pivot on arrival (`world.js:297`) (post-reveal compile) [s].

### 48. wolfhour — S4 K2 C2 G2
WebGPURenderer (WebGL2 fallback), own rAF loop with `shouldRenderFrame`. Node post (pass → bloom → grade) on Medium and up. Prefix `src/themes/wolfhour/wolfhour-`.
- **Start:**
  - `createWolfhourLandscape` on High (`landscape.js:390-433`) [c]:
    - 4 ranges, 53,804 vertices, ~25 value-noise calls per vertex (~100 hashes) (`landscape.js:250-285`, `342-379`)
    - plus a crest scan, normals and a 3×3 smoothing pass (`landscape.js:211-220`, `313-340`)
  - `indices.set([a,c,b,b,c,d])` creates 52,352 temporary arrays (`landscape.js:296-298`) [c].
  - Granite DataTexture: 512² × ~17 hashes ≈ 4.5M, plus mipmaps (`landscape.js:149-192`) [c].
  - Sky noise 128² × 6 and 6000 `setMatrixAt` (`sky.js:19-56`, `140-205`) [c].
  - None of it is sliced. The seeds are constant, so the results are cacheable (`theme.js:1687`, `landscape.js:390`) [c].
  - Warm order is inverted (`theme.js:3337-3346`) [c]:
    - `warmParkedDrawables(..., render: renderPicture)` runs a full post render plus a settle render first.
    - Only then does a fire-and-forget `compileAsync` start (`theme.js:3343`).
    - `startAnimation` renders a third time in the same tick (`theme.js:1370`, `4822`).
  - Dead imports still parse on load [c]:
    - classic `three`, EffectComposer, UnrealBloomPass, ShaderPass (`theme.js:8-13`)
    - the GLSL module (`theme.js:23-59`)
    - the compute module (`theme.js:61`); High sets every compute flag false (`theme.js:179-182`)
- **Pipelines:**
  - Sky: 5 materials; landscape: 1 material shared across 4 meshes [c].
  - Pools create a new NodeMaterial per pooled instance (`theme.js:3352-3594`, `4182-4403`) [c]:
    - ~21 instances, ~14 distinct graphs warmed on High (`theme.js:3198-3205`)
    - pools can grow to 20/4/4/4/6/1
  - Bloom at 0.29 scale (`grade.js:48-62`) [c].
  - MRT forced off (`theme.js:1047-1054`) [c].
- **Compile:**
  - Corona: `maxPulses` (4 on High) JS-unrolled, no `If` (`sky.js:72-86`) [c].
  - `tslFbm`/`tslNoise`/`tslHash` are Fns without layout, so 16 hash bodies are inlined into the beam material (`materials.js:65-99`, `796-804`) [c].
  - The scanner's `If` hits are on dead paths (`materials.js:240` and the compute module) [c].
- **Frame CPU:**
  - `forEach` closures over empty legacy arrays (`theme.js:3667`, `3686`, `4787`) [c].
  - `normalizeQuality()` every frame (`theme.js:2782`, `2859`) [c].
  - `querySelector` + `getComputedStyle` + gBCR on every PIECE_LOCK and LINE_CLEAR, i.e. forced layout during play (`theme.js:2661-2665`, via `2730` and `2766`) [c].
- **Frame GPU:**
  - Bloom at 0.29 [c].
  - Up to 4 live full-screen additive wave quads (`theme.js:3177-3183`, `3190`) [c].
  - Beams: 4000-unit additive strips with an inlined 4-octave fbm (`materials.js:796-812`) [s].
- **Quick wins:**
  1. Await `compileAsync` (with the pools revealed) before `warmParkedDrawables`, or drop the trailing compileAsync (`theme.js:3337-3346`) (start/compile) [s].
  2. Module-cache landscape geometry and granite pixels (constant seed) and drop the `indices.set([..])` literals (`landscape.js:149-192`, `237-387`, `296-298`) (start) [s].
  3. Delete the dead legacy/GLSL/compute imports (`theme.js:8-13`, `23-59`, `61`) (parse/start) [s].
  4. Cache the board rect instead of reading layout per lock and clear (`theme.js:2647-2677`) (CPU) [s].

### 49. black-hole — S2 K3 C1 G4
Own WebGPURenderer (antialias off), own rAF loop gated by `shouldRenderFrame`, GPU-timestamp DRS. Prefix `src/themes/black-hole/black-hole-`.
- **Start:**
  - The sky bake starts before `await createRenderer` and runs in 7 ms slices (`theme.js:133-137`, `world.js:76-102`). This is the fleet's model pattern [c].
  - The disk bake (512×128 × 12 `valueNoise2` ≈ 786k calls) runs as one synchronous block (`world.js:103-104` → `52-63`) [c].
  - Both bakes are module-cached (`world.js:45-49`) [c].
  - `warmEventPools()` renders one full frame synchronously inside `createScene` (`theme.js:161`, `479-490`) [c].
- **Pipelines:**
  - 5 scene materials (`lens.js:135`; `matter.js:166/229/298/344`) [c].
  - Post: samples 0, bloom 0.45, one output pass with 4 ripples, 3 dispersion samples and grain (`post.js:58-115`) [c].
- **Compile:**
  - (c) Lens `Loop(64)` on High with nested If/Break (`lens.js:324`, `quality.js:51`). It inlines `shadeDisk` (`lens.js:193-293`): `Loop(6)` hotspots, 2 JS-unrolled waves (`lens.js:256-260`) and 4 `texture().level()` reads [c].
  - (d) No `setLayout` anywhere [c]:
    - `starLayer` 2× (`lens.js:187-188`), `blackbody` 2× (`lens.js:277`, `402`)
    - `lensPoint` 2× per matter material (`matter.js:188-189`, `262-263`, `318-319`)
- **Frame CPU:**
  - `post.update({...})` literal (`theme.js:466`) [c].
  - GPU timestamp resolve at 15 Hz (`theme.js:31`, `270-294`) [c].
  - A DRS step (at most every 0.75 s) calls `setPixelRatio`/`setSize` and reallocates the render targets (`theme.js:459-463`) [c].
- **Frame GPU:**
  - Full-screen lens shell: ≤64 steps inside 11.6 Rs, closed form outside (`lens.js:418-425`); DPR 1.0, DRS floor 0.55 [c].
  - Additive streaks: 2400 dust always, plus 2800 sparks and 768 infall motes while active [c].
- **Quick wins:**
  1. Slice the disk bake like the sky (`world.js:103`) (first start only) [s].
  2. GPU timestamp sampling 15 → 2-4 Hz (`theme.js:31`) (CPU) [s].

### 50. cosmic-noir — S3 K2 C2 G3
WebGPURenderer, own rAF loop. Post: `pass()` at 0.92 → bloom (threshold 0) → inline lensing, chroma and ACES. MRT only off Windows (`src/themes/cosmic-noir/cosmic-noir-theme.js:1532-1533`). One compute node. Prefix `src/themes/cosmic-noir/cosmic-noir-`.
- **Start:**
  - Every start reloads `2k_haumea_fictional_black.png` (7.1 MB) and `nebula-noir-1..3.png` (~0.5 MB each), with no cache (`theme.js:2315-2322`, `2419-2420`) [c].
  - `await precompileSceneWithTimeout()` (3 s race) runs serially before the first frame, then `warmParkedDrawables` (`theme.js:1851-1896`, `1988`, `1996`) [c].
  - CPU fills are small: 30k stars, 26k compute init, 15k sparks [c].
  - The canvas-2D sites are dead code (`usesNodeMaterials` is always true, `theme.js:2074`) [c].
- **Pipelines:**
  - ~17-21 material instances; 4 nebula planes share one graph [c].
  - Compute runs only while a burst is alive (26k) [c].
  - Bloom at 0.65×0.5 (`post.js:46`, `61`) [c].
- **Compile:** `sampleVignettedScene` is a Fn without layout, inlined 3× at ~20 nodes each (`post.js:88-131`). Minor [c].
- **Frame CPU:**
  - A new rAF arrow closure every frame (`theme.js:3595`) [c].
  - A `toFixed` string every frame (`theme.js:670-705`) [c].
  - Adaptive thresholds have no hysteresis, so a ≥0.005 change calls `setResolutionScale` and reallocates targets (`theme.js:785-829`, `post.js:234-244`) [s].
  - `renderer.info.reset` runs only under perf instrumentation (`theme.js:3600-3602`) [c].
- **Frame GPU:**
  - 4 additive nebula planes of 11-16k units, each covering the full screen: about 4× full-screen overdraw (`theme.js:2331-2346`) [c / s].
  - Bloom threshold 0 blooms the whole scene (`post.js:56`) [c].
- **Quick wins:**
  1. Module-level texture cache or ImageBitmapLoader for the PNGs (`theme.js:2315-2322`, `2419`) (start) [s].
  2. Hysteresis or a minimum dwell before `postResolutionScale` changes (`theme.js:785-829`) [s].
  3. Merge the 4 nebula planes into 2 (`theme.js:2331-2346`) (GPU) [s].

### 51. waves — S3 K2 C2 G3
WebGPURenderer, `safeAnimate`. Post: pass + bloom + 2-stage shaft RTT + output + FXAA (`src/themes/waves/waves-post.js:113-299`). Prefix `src/themes/waves/waves-`.
- **Start:**
  - `bakeWaterNoise(512)` on High: ≈2.36M + slope/pack passes, then GPU mips + anisotropy 8 (`core.js:334-394`, `tsl.js:49-61`) [c].
  - Wave grid ~34k verts [c].
  - On a carried restart (≥6 s), `playTo()` replays up to 360 synchronous `world.update` + camera steps (`theme.js:66-68`, `276-291`; `src/themes/base-theme.js:1549`) [c].
- **Pipelines:** 6 scene materials + bloom + shaft gather/fill (2 RTTs at 0.5) + output + FXAA (full-res `convertToTexture`) [c].
- **Compile:**
  - The water fragment is the largest graph (`water.js:139-358`) [c]:
    - ~12 noise fetches
    - layout'd `tubeTrace`/`tubeEnvironment`
    - 2 TSL Loops
  - (d) `shape.point()` is inline: 3× in the water vertex stage, 2× in rain, 2× in mist (`tsl.js:183-215`) [c].
- **Frame CPU:** [c]
  - `getPostState()` returns a new object + array (`world.js:780-794`).
  - `pod.update` dirties its buffer every frame (`life.js:348`).
  - `SprayPool.put` dirties the whole 115 KB buffer on events (`spray.js:219-236`).
- **Frame GPU:**
  - The water uses `discard`, which defeats early-Z (`water.js:169`) [c].
  - The shaft gather (20 taps) and fill (5) render every frame because `rtt` autoUpdates, even with the sun off-screen (`world.js:789`) [c].
  - FXAA [c].
  - 28 mist quads near the eye [s].
- **Quick wins:**
  1. `shaftsFirst.autoUpdate = shaftsNode.autoUpdate = shafts > 0.01` in `WavesPost.update` (`post.js:303-314`) (GPU) [s].
  2. Reuse the post-state object (`world.js:780-794`) (CPU) [c].
  3. `addUpdateRange` per put; skip the pod flag when nothing is airborne (`spray.js:235`, `life.js:348`) [c].

### 52. kaleidosonic — S1 K3 C1 G5
WebGPURenderer; scene pass with no MSAA, bloom, output; `safeAnimate`. Prefix `src/themes/kaleidosonic/kaleidosonic-`.
- **Start:**
  - One PlaneGeometry and one material; `prepare()` is a no-op (`temple.js:61-505`, `world.js:67-70`) [c].
  - `placeHeart` casts 49 CPU `marchTemple` rays (140 steps × 7 folds) plus ≤25 probes, about 48k fold iterations. It runs on every `setViewport`/`setLayout`, so about 4× at start, and each ray re-poses the rest camera (`world.js:244-258`, `317-319`, `340-396`) [c]. Low ms [s].
- **Pipelines:** 1 scene material + bloom (7) + output: about 9 pipelines [c].
- **Compile:**
  - (c) March `Loop(96)` on High (`temple.js:120-132`, `quality.js:21-23`). Each step calls the layout'd `ks_temple10` (`Loop(10)` + If/Break, `tsl.js:49-82`) [c].
  - (c) After a hit: 4 normal taps + 1 AO tap, strike and harmonic loops 2× each, and a DDA `Loop(10)` with If/ElseIf/Else (`temple.js:147-155`, `259-419`) [c].
  - (a) `ICOSA.forEach` unrolls 6 `If`/`ElseIf` pairs, but the bodies are tiny (`temple.js:462-473`) [c].
- **Frame CPU:** `post.update({time})` literal (`theme.js:678`); otherwise reused tables [c].
- **Frame GPU:**
  - A full-screen fragment at full scene-pass resolution, DPR ≤1.15 (`theme.js:52`, `post.js:115`) [c].
  - ≤96 steps × 10 folds per pixel, plus 5 field evaluations, the event loops and the DDA on hits [c].
- **Quick wins:**
  1. Render the temple into an RTT at 0.6-0.75 with a bilateral upsample, as moonlit and thermal do (`temple.js:493`, `post.js:115`) (GPU) [s].
  2. High DPR cap 1.15 → 1.0 (`theme.js:52`) (GPU) [s].
  3. High march steps 96 → 72 (`quality.js:22`) (GPU) [s].
  4. Pass `steps:48` to the CPU `marchTemple`; skip `placeHeart` when the layout is unchanged (`world.js:359`) (CPU at resize) [s].

### 53. murmuration — S2 K1 C2 G5
WebGPURenderer via `src/themes/shared/node-renderer.js` (`src/themes/murmuration/murmuration-theme.js:189-193`). DPR cap 2 (`theme.js:201`, `389`), against 1.15 in the template themes [c]. Post: MRT (output + emissive) on Medium and up when on WebGPU (`post/render-pipeline.js:143`, `167-169`), bloom from emissive. One compute dispatch per frame (`theme.js:748`). `safeAnimate`.
- **Start:**
  - `_initParticleState` (60,000 motes on native High) runs in the constructor (`sim/fluid-particles.js:77-84`, `252`) and again through `fluidSim.reset()` in `_buildWorld` (`theme.js:328` → `fluid-particles.js:351-359`) [c].
  - 4 storage buffers × 960 KB [c].
- **Pipelines:** nebula + swarm render materials, 1 compute, MRT scene RT with 2 attachments, bloom, output [c].
- **Compile:** clean; nebula helpers are layout'd (`rendering/nebula-volume.js:45-125`); impulse ×8 and flow ×7 unrolls in compute are arithmetic only [c].
- **Frame CPU:**
  - Every lock runs `readBoardRect` (gBCR + `getComputedStyle`) inside the rAF flush (`theme.js:555`, `composition/board-layout.js:28-30`) [c].
  - A subtree MutationObserver on the game shells runs `querySelectorAll` + `_updateBoardZone` with layout reads per batch (`theme.js:466-487`, `651-653`) [c].
  - `setShape` loops 60k motes 2× and uploads 960 KB per formation (`fluid-particles.js:882-934`) [c].
- **Frame GPU:**
  - 60k additive bokeh quads, depth test off, into 2 MRT attachments (`rendering/fluid-particles-renderer.js:103-109`, `163-173`) [c].
  - A full-screen nebula with 20 `noise3` × 8 hashes per pixel (`nebula-volume.js:164-179`) [c].
  - All of it at DPR up to 2 [c].
- **Quick wins:**
  1. Cap DPR like the fleet (1.15-1.35 on High) (`theme.js:201`, `389`) (GPU fill, large) [s].
  2. Drop one of the two `_initParticleState` passes (`fluid-particles.js:252` / `theme.js:328`) (start) [c].
  3. Render the nebula at reduced resolution (`nebula-volume.js:146-199`) (GPU) [s].

### 54. void-ember — S2 K3 C1 G3
WebGPURenderer (`depth:false`), `safeAnimate`. Post: MSAA-4 on High (`src/themes/void-ember/void-ember-post.js:67`), bloom, rays 8, streak 6, haze, ripple. Prefix `src/themes/void-ember/void-ember-`.
- **Start:** `bakeLattice` + `bakeFbm` 1.31M + ~349k `toHalfFloat` (`world.js:271-272`, `tsl.js:190-258`) [c].
- **Pipelines:** 14 scene materials; the 3 rock classes use the same graph as separate materials (`belt.js:165`) [c].
- **Compile:**
  - `veWaveLight` (4 slots × 4 fronts, unrolled) is inlined in the rock, wind, cinder world, sky and dust ring stages (`tsl.js:392-412`; `belt.js:172`, `251`, `340`; `fx.js:135`) [c].
  - Photosphere: 6 `noise3` + `Loop(impactCount)` (`star.js:70-147`) [c].
- **Frame CPU:** nearly clean: `{time}` (`theme.js:614`), `palettePhase` object (`core.js:281`) [c].
- **Frame GPU:**
  - Rocks: ~266k vertices per frame, each running ungated `veWaveLight` (16 bells) (`belt.js:172`) [c; cost s].
  - Wind: 9000 × 4 verts with the same (`fx.js:78-150`) [c].
  - MSAA-4 [c].
- **Quick wins:**
  1. One rock material shared across the 3 classes (`belt.js:165`) (compile) [c].
  2. Gate `veWaveLight` on a "waves live" uniform (`belt.js:172`, `fx.js:135`) (vertex GPU at rest) [s].
  3. Module-cache `bakeFbm` (`tsl.js:190`) (start) [s].

### 55. galaxy — S2 K2 C1 G3
WebGPURenderer, `safeAnimate`. Post: single-sample `pass()` + bloom + output (`src/themes/galaxy/galaxy-post.js:122-147`). Prefix `src/themes/galaxy/galaxy-`.
- **Start:**
  - `bakeNoise()` 1.31M + ~350k `toHalfFloat` (`tsl.js:113-226`, `world.js:248`) [c].
  - `buildPlan`: 84,000 stars on High (190k Extreme) with ≤40-try rejection. `orbit.set([...])` and `look.set([...])` allocate 2 arrays per star, 168k in total (`plan.js:96-142`) [c].
  - Warm roots `[]` (`theme.js:613`) [c].
- **Pipelines:** 12 NodeMaterials, one per part (`world.js:254-275`), + bloom + output [c].
- **Compile:**
  - No If chains [c].
  - Small unrolls inside uniform `If`s: ripple 6 slots, wave 2×4 used 3×, ring halo 6, star lattices 3, post 8 rays + 5 calm rects (`tsl.js:313-348`; `disc.js:258-276`; `sky.js:125-128`; `post.js:182-245`) [c].
  - The disc march is a TSL `Loop(10)` (`disc.js:230-241`) [c].
- **Frame CPU:**
  - `warm` closure (`world.js:918-925`); `post.update({time})` (`theme.js:597`) [c].
  - The `release()` queue uses `splice`/`shift`, O(n²) on clears (`nurseries.js:166-226`) [c].
- **Frame GPU:**
  - Every part is transparent with depthTest off, so the sky dome shades every pixel (`sky.js:80-190`) [c].
  - 10-step disc march [c].
  - 84k star quads (336k verts) [c] — overdraw [s].
  - Output: 12 full-res taps [c].
- **Quick wins:**
  1. Direct element writes in place of `.set([...])` (`plan.js:141-142`) (start/GC) [c].
  2. Module-cache `bakeNoise` (`tsl.js:113`) (start) [s].

### 56. astral-weave — S2 K2 C1 G3
WebGPURenderer; post; `safeAnimate`; per-frame compute. Prefix `src/themes/astral-weave/astral-weave-`.
- **Start:**
  - `createNoiseTexture`: ≈1.3M inner iterations + 262k `toHalfFloat`, synchronous. The code's own comment says "≈ 40 ms" (`tsl.js:123-192`) [c].
  - `prepareCompute()` is fire-and-forget, never awaited (`theme.js:249-256`); good [c].
  - If the compute compile fails, a closed-form dust material is built mid-play (`world.js:244-250`) [c].
- **Pipelines:** about 22 [c]:
  - Sky ×2, loom ×9, dust.
  - The 2 gimbals bake different constants, so 2 pipelines (`loom.js:436-497`).
  - Compute init + step (`dust.js:127-167`).
  - Bloom (7) + output.
- **Compile:** small unrolls only; hashes and spectrum are layout'd [c]:
  - `sweepGlow` 4× (`loom.js:100-109`)
  - pluck 3× inside `curveAt` ×2 (`loom.js:144-165`)
  - warp pulses 4× (`loom.js:379-408`)
- **Frame CPU:**
  - Allocation-free apart from `timers.splice` [c].
  - `renderer.compute(stepNode)` runs every frame, separate from the pipeline render (`dust.js:233-237`) [c]. That probably means an extra submit [s].
- **Frame GPU:**
  - 14k-thread compute + 14k additive streak quads on High (60k on Extreme) [c].
  - Hoop and gimbal quads are 1.14× the ring radius, and the flares 2.3×/1.7×, all additive over the deep field [c]. Moderate overdraw [s].
- **Quick wins:**
  1. Module-cache the noise data (deterministic seed, `tsl.js:125`) (start ≈40 ms per restart) [s].
  2. Gimbal constants → uniforms, so one pipeline (`loom.js:436-445`) [s].
  3. Trim the hoop quads to the annulus (`loom.js:439-445`) (GPU) [s].

### 57. chromadelic-highway — S2 K2 C2 G2
WebGPURenderer, own rAF loop with `shouldRenderFrame`. Post: no MSAA on High, bloom at 0.325, output. Its own adaptive scaler. Prefix `src/themes/chromadelic-highway/chromadelic-highway-`.
- **Start:**
  - Synchronous `World.build()`: 3000 stars with ≤24-try rejection, a `new THREE.Color` + 3 literals per star (`sky.js:257-286`); 240 streaks [c].
  - 5 × 2k textures load through TextureLoader without being awaited, so decode, upload and mips land on early frames (`world.js:350-463`) [s].
- **Pipelines:** 11 materials + bloom + output. The adaptive scaler can call `setDrawingBufferSize` mid-play (`theme.js:429`, `557`) [c].
- **Compile:** every helper is layout'd (`tsl.js:68-237`) [c].
- **Frame CPU:**
  - 1 Hz `setInterval` → `readLayoutRects()` with gBCR + `getComputedStyle` per element (`theme.js:1694`, `1717`; `composition.js:116-139`) [c].
  - `resize()` does `setPixelRatio` + `setSize` and is reached from both its own window listener and the manager funnel (`theme.js:1976-1977`, `2159-2160`) [c].
  - Per frame: `renderer.info` read, `resolveTargetFps()`, 2× `performance.now()` (`theme.js:469-493`, `2133-2135`) [c].
- **Frame GPU:** moderate: full-screen sky (2 taps), road glitter, 3000 star quads [c].
- **Quick wins:**
  1. Replace the 1 s poll with ResizeObserver + mode events (`theme.js:1694`) (CPU) [c].
  2. A single resize path (`theme.js:1977`, `2159-2160`) [c].
  3. ImageBitmapLoader or `decode()` for the planet textures (`world.js:351`) [s].

### 58. parhelion — S1 K2 C1 G3
WebGPURenderer, `safeAnimate`; the runtime lives in `src/playground/effects/parhelion*.js`. Post: `pass()` → bloom (5 mips at 0.35) → output with a calm-rect `Loop`.
- **Start:** small synchronous build: stone geometry, 4000 dust (`parhelion-geometry.js:61-191`, `parhelion-particles.js:116-127`) [c]. No own `compileAsync`; it relies on the manager warm [c].
- **Pipelines:**
  - 7 materials [c].
  - `pass(scene,camera)` sets no `samples` (`src/themes/parhelion/parhelion-post.js:83`). With AA on, it inherits `renderer.samples`=4 (three `PassNode.js:800`), so High gets an MSAA-4 HalfFloat target at DPR 1.25 [c].
- **Compile:** clean; 34 of 37 Fns are layout'd. The dome Fn has acos/asin/atan, 3 `noise2` and `Loop(uArcCount)` (`parhelion-materials.js:299-382`) [c].
- **Frame CPU:**
  - Zero allocations; deduped uniform writes (`parhelion.effect.js:149-162`, `682-739`) [c].
  - `renderer.info.reset` runs only with `?parhelionCounters=1` [c].
- **Frame GPU:** full-screen dome behind the stone, snow with 3 `noise2`, 4000 dust sprites, implicit MSAA-4 [c].
- **Quick win:** set `samples` explicitly on the scene pass, e.g. 0 on High (`src/themes/parhelion/parhelion-post.js:83`) (GPU) [s].

### 59. rainy-window — S1 K1 C1 G4
Legacy `THREE.WebGLRenderer` with GLSL `ShaderMaterial`s and the examples `Water` mirror; no post; own rAF loop with `shouldRenderFrame` and a real dt (`rainy-window-theme.js:1061-1078`; fixed in 64d73191). No quality tiers. File `src/themes/rainy-window/rainy-window-theme.js`.
- **Start:** 50,000 rain iterations of `Math.random` + JS `push`, then copied to Float32 (`:393-411`); water normals load asynchronously (`:167-179`) [c]. Trivial overall.
- **Pipelines:**
  - ~10 GLSL programs [c].
  - Water mirror RT 512² HalfFloat (`Water.js:55`, `88`) [c].
  - The mirror pass has a different output state, so most materials probably compile a second program [s].
- **Compile:** none of (a)-(d). The fog shader inlines 5 `snoise3` (`:629-672`) [c].
- **Frame CPU:**
  - `new THREE.Vector3` look target every frame (`:941-945`) [c].
  - `calculateDipOffsets` returns a new object while dipping (`:1028-1032`) [c].
  - Every 3-10 s a lightning bolt builds 2 throwaway `LineBasicMaterial`s + a cloned geometry (`:750-768`, `838-839`) [c].
- **Frame GPU:**
  - `Water.onBeforeRender` re-renders the whole scene into the 512² mirror every frame, including 50k rain points and fog [c].
  - 200 fog point sprites sized 1200-1800 × 400/−z px (clamped to max point size), with 5 `snoise3` per fragment, normal blending (`:485-498`, `554`, `629-672`) [s].
  - The fog is always drawn: `scheduleNextFog` is never called, so its state machine is dead (`:696-701`) [c].
  - 8000² transparent double-sided cloud plane with 4-octave `snoise2` (`:251-335`) [c].
- **Quick wins:**
  1. Put rain and fog on a layer the mirror camera excludes, or set the mirror to 256² (`:184-185`) (GPU, large) [s].
  2. Cut fog sprite count or size (`:485`, `:498`) (GPU fill) [s].
  3. Scale the 50,000 particles (`:393`) by effect quality [s].
  4. Reuse one `Vector3` (`:941`) [c].

### 60. synthwave-sunset — S1 K1 C3 G2
WebGPURenderer, own rAF loop with `shouldRenderFrame`. Post: MSAA-4 on High, bloom 0.4, streak, grade. DRS 0.7-1.0. Prefix `src/themes/synthwave-sunset/synthwave-sunset-`.
- **Start:** small: mountains, ~200 city boxes, 5 palms [c].
- **Pipelines:** 8 materials; the palms are transparent + DoubleSide, so 2 passes (`palms.js:194-197`); ~17 in total [c].
- **Compile:** clean; every helper is layout'd [c].
- **Frame CPU:**
  - `spawnSpark` adds 4 `addUpdateRange` per spark, one `writeBuffer` each, in bursts of ≤260 (`fx.js:53-57`, `286-302`; `world.js:498-517`) [c].
  - A DRS step → `setSize` + RT realloc + `new Vector2` (`theme.js:483`, `498-504`) [c].
  - 1 s `setInterval` layout poll (`theme.js:296`, `world.js:143-167`) [c].
- **Frame GPU:** light [c].
- **Quick wins:**
  1. One contiguous range per burst per attribute (`fx.js:53-57`) [s].
  2. `palms.forceSinglePass = true` (`palms.js:196`) [c mechanism].
  3. Replace the 1 s poll with scheduled re-reads (`theme.js:296`) [c].

### 61. nimbus-veil — S1 K1 C1 G3
WebGPURenderer (`antialias:false`, `depth:false`); post: MSAA-4 scene pass, bloom, output with JS-unrolled rays; own rAF loop + own DRS. Prefix `src/themes/nimbus-veil/nimbus-veil-`.
- **Start:** trivial [c]:
  - 181² vertex grid with 194k indices pushed into a JS array (`cloudsea.js:48-78`)
  - 266 cumulus puffs (`cumulus.js:58-107`)
- **Pipelines:**
  - 7 scene materials; the two veils differ only in baked constants (`fx.js:186-210`) [c].
  - Bloom (7) + output; MSAA-4 on High (`post.js:52-53`, `102`) [c].
- **Compile:**
  - Everything is layout'd (`tsl.js:66-177`) [c].
  - 16 ray taps are JS-unrolled, but small (`post.js:152-157`) [c].
- **Frame CPU:**
  - `viewBasis()` returns a new object (`world.js:225-231`); `rings.forEach` closure (`world.js:304-315`) [c].
  - A DRS step (possible every 0.5 s) runs `resize()`: `setPixelRatio` + `setSize` + RT realloc + a new Vector2 (`theme.js:479-505`) [c].
  - 1 Hz `setInterval` board poll (gBCR + `checkVisibility` + `getComputedStyle`) (`theme.js:275-298`) [c].
  - Each spawned sparkle allocates 4 arrays + 4 update ranges; bursts reach 220 (`fx.js:245-259`) [c].
- **Frame GPU:**
  - Cloud sea runs `nvCloudField` (4 octaves) in both vertex (32.7k vertices) and fragment, under MSAA-4 [c].
  - 266 large transparent puffs: overdraw near the towers [c].
  - 16 full-res taps for the rays [c].
- **Quick wins:**
  1. The rays sample full-res `sceneColor` 16×, though the header says they march over bloom. Sample `bloomNode.getTextureNode()` (`post.js:153`, cf. `post.js:5-7`) (GPU) [s].
  2. DRS hysteresis/min dwell ~3 s (`theme.js:479-484`) (hitches) [s].
  3. Contiguous burst slots + one update range (`fx.js:245-259`) (CPU) [s].

### 62. neon-dusk — S1 K1 C2 G2
WebGPURenderer, own rAF loop with `shouldRenderFrame` + its own DRS (`src/themes/neon-dusk/neon-dusk-theme.js:383-486`). Post: MSAA-4 when AA is on, bloom at 0.35, VHS output. Reflector at 0.4 with mips (`neon-dusk-floor.js:95-97`). Prefix `src/themes/neon-dusk/neon-dusk-`.
- **Start:**
  - Mountains at High: ~48.5k vertices × `ridged()` (8 Perlin evaluations each). The header's "~17k" is stale (`mountains.js:5`, `163-239`) [c].
  - ~283k JS index pushes + normals [c].
- **Pipelines:** 6 scene materials + bloom (7) + output = 14; FX sit on layer 1 (`world.js:279-282`) [c].
- **Compile:** every helper is layout'd (`tsl.js:72-156`) [c].
- **Frame CPU:**
  - A DRS step can fire every 0.5 s. Each step runs `resize()`: `setPixelRatio`, `setSize` (MSAA RT + bloom + reflector realloc), `new Vector2`, a 40-step `setLayout` bisection and a layout re-schedule (`theme.js:469-507`, `world.js:314-318`) [c].
  - 1000 ms DOM poll (`theme.js:37`, `296`; `world.js:133-157`) [c].
  - `spawnPixel` adds 4 `addUpdateRange` per pixel; a 4-line clear spawns ~290 pixels, so ~1160 ranges, and three r186 issues one `writeBuffer` per range (`fx.js:50-53`, `275-282`; three `WebGPUAttributeUtils.js:241-262`) [c].
- **Frame GPU:** light [c].
- **Quick wins:**
  1. Merge spawns into one range per attribute per frame (`fx.js:50-53`) (CPU spike) [s].
  2. DRS hysteresis; don't re-layout on a DRS-only resize (`theme.js:469-507`) [s].
  3. Drop the 1 s poll (`theme.js:296`) [s].

### 63. blood-moon — S2 K1 C1 G1
WebGPURenderer, no post: a direct `renderer.render` with ACES (`src/playground/effects/blood-moon.effect.js:349-350`, `550`). `safeAnimate`. The scene lives in `src/playground/effects/blood-moon*.js`.
- **Start:**
  - Serial chain (`blood-moon-theme.js:84`, `133-134`; `effect.js:372-413`) [c]:
    - `await createRenderer`
    - `createBloodMoon`, which starts the nebula and moon loads
    - `await prepare()`, which waits for the nebula and `surface.ready` and only then runs `compileAsync`
  - `surface.ready` [c]:
    - main-thread `drawImage` + `getImageData` + 2 full loops
    - 1024×512 on High, 2048×1024 on Ultra (`blood-moon-surface.js:292-328`)
    - module-cached per size (`surface.js:339-350`)
- **Pipelines:** 9 materials, 3 of them burst slots with identical graphs (`blood-moon-bursts.js:59-129`) [c].
- **Compile:** corona 4 pulses unrolled inside an `If` (`effect.js:176-198`); minor [c].
- **Frame CPU:** allocation-free; layout read only at 0/0.5/1.5 s after a trigger [c].
- **Frame GPU:** full-screen sky (2 taps), corona quad, ≤3000 small additive sprites; the wave quad only while active [c].
- **Quick wins:**
  1. Run `compileAsync` alongside the image and bake waits; the placeholders are already bound (`effect.js:398-413`) (start) [s].
  2. Bake on an OffscreenCanvas in a worker (`surface.js:292-328`) (start at Ultra) [s].
