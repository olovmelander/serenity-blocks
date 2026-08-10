# Odyssey Heavy-Chapter Remake — Material Consolidation + Clutter Cut + Polish (2026-08)

Governing roadmap for the visual-upgrade + perf remake of the heaviest Odyssey chapters.
Derived from a 7-agent code-grounded analysis (workflow `wf_3fc2fbd9-054`). Ch3 first.

## Why (the measured root cause)

Two costs, one symptom (the transition-into-chapter hitch):

- **Unique material count = first-visit GPU pipeline compiles.** In three r181, `NodeBuilder.build()`
  runs **once per material object**, even when two objects compile byte-identical WGSL. Each heavy
  chapter mints a fresh `*NodeMaterial` per mesh/species/tier/side instead of reusing one cached
  object. This is GPU BeginFrame starvation while cold pipelines compile — not a JS longtask. Device
  instrumentation this session: ~49 sync `createRenderPipeline` calls on the first live journey pass;
  the transition spikes were 60–311ms on the test iGPU, much smaller on the RTX 5080.
- **Tris/instances = first-draw upload cost** (VBO/instance-buffer upload). Over-tessellated
  backgrounds + clutter fields inflate this for zero on-screen gain.

Runtime weight measured (unique materials / tris): **Ch8 55/30k, Ch3 39/226k (heaviest geom 3×),
Ch1 35/25k, Ch7 31/53k**, Ch5 25, Ch4 23/69k, Ch6 23, Ch2 14.

### Consolidation playbook (every heavy chapter)

1. **One shared material object per visual family**, cached at builder/module scope — build once, reuse
   across meshes; per-mesh variation goes to uniforms/attributes. Removes N−1 compiles for free.
2. **Instanced props with per-instance attrs** (`aTint` color, `aPhase` desync, `aType` shape/palette).
   Collapse N meshes → 1 `InstancedMesh`: removes N−1 compiles AND N−1 draws. Use the shared
   billboard helper for particle fields (never `THREE.Points` — WebGPU renders those 1px).
3. **Bake noise** where the graph is `snoise3`-heavy (`buildTileableNoise3D`, `shared/odyssey-baked-noise.js`).
4. **Cut/redesign clutter** — invisible (opacity≈0.05) layers, duplicate domes, redundant tree
   vocabularies; right-size background tessellation; halve fields that read identically at journey distance.
5. **Never break the `group.userData.*` contract** the `*-environment.test.js` files pin — share the
   material under the mesh; don't rename/remove the mesh. Repoint or deliberately edit tests when a
   named group is genuinely cut.

r181 gotcha: per-instance local-space height masks for sway read `positionGeometry.y`, NOT
`positionLocal` (InstanceNode reassigns `positionLocal` before `positionNode`).

Targets: **Ch3 39→~14, Ch7 31→~14, Ch8 55→~15, Ch1 35→~14.**

## Ch3 surface-world — DO FIRST (compile monster + richest prototype reuse)

Bones are AAA (BotW frame baked into `getTerrainHeight`). Problems are material sprawl, foliage
overload, and mountain/seam continuity — not layout. Reuse the four screenshot-proven hero prototypes.

### Art
- **Reuse prototypes:** `surface-world-hero-meadow` (`makeMeadowMaterial` — grass blade OR flower from
  ONE instanced material via `aType`/`aTint`/`aPhase`), `surface-world-hero-trees` (`makeFoliageMaterial`
  instanced canopy + `makeBarkMaterial`), `surface-world-hero-lake` (real `reflector()` mirror, layer-2
  silhouettes, tamed glint), `surface-world-hero-mist` (`makeMistMaterial` fog cards), `surface-world-emergence`
  (foundation ~3 materials).
- **Mountain↔terrain continuity (biggest art fix):** (1) decouple landscape far-edge + foothill-bridge
  seam fades from `uSnowBlend` → drive off a season-independent distance fade so the ground is one
  continuous meadow→bridge→peak plane from frame 1; (2) close the ~340u gap — pull the 3 canonical peaks
  forward so bases sit behind the baked far ridgeline (`getTerrainHeight` ridgeline term); (3) reveal peaks
  on the bridge ramp (not the late `alpineRamp`); conifer belt = the ladder up the seam to the snow line.
- **Reduced, intentional foliage:** two tree languages only (procedural deciduous + hero Great Tree; ONE
  GLB conifer belt as the only tree-line). **Cut procedural spruces (12) + procedural tree-line (30).**
  Wildflowers 1400→~700 (concentrated hero drifts), GLB conifers 260→~140, reeds 220→~120, pollen 600→300,
  **cut 20 butterflies**.
- **Commit the hero lake:** `reflector()` default-on (near-LOD, half-res, one pass); delete the `uv.y`-sine
  copper-sheet fake. Hand ACES to renderer so glint reads gold not white.
- **Delete dead builders** (confirm unwired first): `createMeadowFlowersTSL` (3600), `createFluffyGrassTSL`,
  `createGrassTuftsTSL`, `createWaterfallTSL`, `createCabinTSL`.

### Perf consolidation 39 → ~14

| # | Action | Method | Δ mats | Δ tris |
|---|--------|--------|--------|--------|
| 1 | Cut conifer vocabulary + share belt | cut procedural spruces + tree-line; GLB conifers 260→140; `snow-conifer-belt` `maxY`→uniform, build `createConiferMaterial` once, reuse both belt calls | −7 | −52k |
| 2 | Wildflowers 5 species→1 material + halve | move `floraSwayNode` params to per-instance `aSway`/uniform; keep 5 geometries, one material; 1400→700 | −4 | −19k |
| 3 | Sea/river + lake → one golden-water material | promote `useRadialEdge`+`rippleAmp` to uniform select in `buildGoldenWaterMaterial`; reflector = flag variant | −1 | 0 |
| 4 | 3 canonical peaks → one shared material | build `createFBMMountainTSL` material once (all use `MAIN_PEAK_TREATMENT`), reuse 3 meshes | −2 | 0 |
| 5 | Seasonal particles + birds + pollen | one `uSeason`-gated billboard for falling-leaves+snow-motes; cut butterflies; birds→one vertex-color mat; pollen 600→300 | −3 | −1k |
| 6 | Canopy 3→1 (optional) | port `makeFoliageMaterial` so deciduous + Great-Tree canopy share one instanced material | — | ~0 |
| 7 | Trim terrain tessellation | foothill-bridge 104×112→80×80; landscape 96×96→80×80 | 0 | −16k |

**Net: 39→~14 mats, ≈−88k tris.**

### Playground-first sessions (one effect per session — TDR safety)
- **A — Meadow keystone** (biggest material cut): finalize `surface-world-hero-meadow`, screenshot at `?t=2`,
  port (replace wildflowers+grass+meadow-flower wiring with the one instanced material).
- **B — Trees + conifer collapse**: finalize `surface-world-hero-trees` + shared conifer material; port.
- **C — Hero lake mirror**: finalize `surface-world-hero-lake`; flip `readCh3HeroMirrorFlag` default, delete
  `uv.y`-sine branch, merge water material (#3).
- **D — Mist + continuity + particles**: `surface-world-hero-mist` + peak-forward continuity + seasonal-particle
  merge (#5) + tessellation trim (#7); delete dead builders.

### Tests that must keep passing (`surface-world-environment.test.js`)
`ocean.name==='ocean-surface'`; `sea.name==='surface-chapter-02-water-foreground'`, `river.name==='…-river'`;
`sea.material.userData.emitsBloom===true`; `sea/river.renderOrder < landscape.renderOrder`;
`ocean.userData.readability` (sourceChapter 2, `createWaterSurfaceTSL`, deepColor b>g>r, extents);
`landscape.material.userData.waterShelfFade.min===readability.waterShelfFadeMin`;
**`spruces.name==='spruce-trees'`** (repoint to a GLB conifer stand or edit test if cut);
**`snowMotes.name==='snow-motes'`** (name the merged seasonal-particle mesh this);
`foregroundLayer.name==='foreground-pass-by'`; `cabin===undefined`;
`distantMountains.userData.canonicalMountainRange` (3 meshes MUST stay — share only material #4);
`quaterniusNatureLayer` (assetRecords≥12, `pigeon-animated`); `greatTree.scale.x>1.3`; `fallingLeaves`;
`birds.children.length===flockCount`; all `resolveSurfaceWorld*RampState` resolvers unchanged.

## Follow-on chapters

### Ch8 urban-dreams 55→~15 (art fine; additive-glow "zoo")
9 neon rail gates→1 InstancedMesh (torus tubular 96→28, `aTint`); spire 4 cores→1 InstancedMesh + fold
torus frames/crown/shock into shared neon-ring; sky-traffic 18→2 shared mats (TRAIL_COUNT 16→10); uniformize
2 curtain-wall + 2 skyline dupes; 4 hologram signs→1 InstancedMesh. Preserve `userData.spire`/`shockRing`/
`beacon`, `skyline` (2 meshes, per-card `uOpacity`), `traffic`, `signs` names.

### Ch1 earth-core 35→~14 (fixes boot-reveal compositor freeze)
Heaviest graph `moltenRockField` (~21 snoise3) compiled 8×. Share `isColumn=false` pocket material across
6 molten pockets + selenite pocket (−6); share `isColumn=true` column material across columns/slabs/colonnade/
selenite (−2, TOP boot saver); cut invisible `crater-rim-cloud` + `magma-cloud-deck`, fold embers (−3); 5
corona sprites→1 shared (−4, keep 5 objects for `glows.length===5`); merge static decals/columns geometry;
retessellate geodes/lava/canopy. Keep pockets+geodes as individual meshes (seam-sink tests); every shared
material MUST set `uniforms.uOpacity`. Flip `buildTileableNoise3D` ON.

### Ch7 black-hole 31→~14 (heaviest fill + redundant programs)
All soft additive props→ONE vertex-colored additive material (bake hue×opacity into vertex color) (−11, update
sheath test + `children.length`); one accretion-disk + one lens-shell via baked `aRadial` (−2); 7 event-horizon
spheres→1 shared black material (−2); 2 full-screen domes→1 camera-enveloping void dome (−1, keep
`ambientWash.userData.readability` stub); merge shards+starfield twinkle (−1); cut motif tessellation (−19k tris).

### Shared-layer (amplifies Ch3/4/5)
Cache 2 mountain treatments in `createFBMMountainTSL`; `createMountainAuroraBackdrop` 4 curtains→1 shared
material; promote `snow-conifer-belt` to a `makeInstancedTintedMesh` helper; extend `buildTileableNoise3D`
to the 4 other snoise3 chapters; right-size shared geometry.

## Sequencing + verification
Order: **Ch3 (A→D) → Ch1 column/pocket share → Ch7 additive-VC collapse → Ch8 neon instancing → shared-layer.**
Mostly reversible (share object/keep meshes, tessellation trims, clutter cuts, count halving). Medium-risk
(screenshot + maybe a test): water merge, seasonal-particle merge, shared conifer (also used by Ch4 — verify),
Ch7 additive-VC/aRadial/void-dome, Ch1 merged-column transforms.

Verify each step: (1) playground screenshot `?effect=<id>&t=<s>`, `__PLAYGROUND_READY__`, console clean;
(2) re-measure unique-material count via a traverse probe (assert ≤ target); (3) chapter `*-environment.test.js`
green; (4) in-game per-chapter transition confirmation is user-side (headless board capture blocked; full-journey
capture TDR-risks the iGPU). Success per chapter: material count ≤ target, clean screenshot, tests green,
identity visually unchanged-or-better.
