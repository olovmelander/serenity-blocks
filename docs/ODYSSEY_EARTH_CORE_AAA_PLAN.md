# Odyssey — Earth Core (Chapter 1) AAA Implementation Plan

> The Molten Cathedral the camera falls through. three.js ~r0.181 `WebGPURenderer` +
> TSL `NodeMaterial`s only (no GLSL `ShaderMaterial`). Builds on the recent
> `moltenRockField` lava polish; targets the three user-reported issues
> (asset disconnection, holey/non-solid meshes, weak composition/scale) plus AAA
> VFX/atmosphere.
>
> Primary files:
> - `src/rendering/odyssey/chapter-environments/earth-core.tsl.js` (materials/geometry)
> - `src/rendering/odyssey/chapter-environments/earth-core.js` (scene assembly/placement/lighting)
> - `src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js` (post: bloom/CA/grade — hook point for god-rays + heat-shimmer)
> - Shared TSL libs: `chapter-environments/shared/odyssey-tsl-noise.js` (snoise3/fbm3/ridged3/curl3), `chapter-environments/shared/odyssey-tsl-billboard.js` (billboardWorld / billboardVerticalWorld / makeQuadInstancedGeometry)
> - Reference theme: `src/themes/pyrestorm/pyrestorm-shaders.js` (lava ramp + heat distortion + embers)

---

## 1. Vision & Current-State Diagnosis

### 1.1 Vision

Earth Core is the journey's **opening** chapter: a grand, oppressive **molten cathedral**
the on-rails camera dollies DOWN through. The payoff read is:

- a **calm, opaque lava LAKE** far below that the camera looks **ACROSS** (a readable
  horizontal floor that unifies the scene, ~70% dark charred crust / ~30% glowing rivers);
- a single **LAVA-FALL hero** pouring into the lake as the brightest focal mass;
- **ember-storm + god-ray shafts** punching down through ash;
- framed by **near-black charred repoussoir columns** that bracket the descent and give scale;
- everything tied to the lava as the scene's **single key light** (warm near it, dark far from it).

Value discipline: ~70% near-black rock, ~30% molten; emissive capped < 1.0 so the ACES +
threshold bloom in `odyssey-tsl-pipeline.js` gild the molten rather than clip it.

### 1.2 The three issues, grounded in the code (root causes)

| # | Issue | Root cause (file:line) |
|---|-------|------------------------|
| **1** | **Asset disconnection** — geodes/columns/spheres float in orange haze with no grounding | (a) **No grounding pipeline at all**: the only lights (`lavaLight`, `lavaGlow`) cast no shadows; nothing draws a contact shadow/AO halo — `earth-core.js:922-932`, `setupVolcanicLighting` 904-937. (b) **Assets do not sit on the lake**: lake at `y=-14` (`earth-core.tsl.js:257`, `LAVA_LAKE_Y` `earth-core.js:71`); columns are centred at the lake so their bottom half passes *through* it with no waterline/splash/bleed — `earth-core.js:558`; background geodes float 10-40u *above* the lake on a far ring with no surface beneath — `earth-core.js:756-757`. (c) **No light/atmo blend**: geodes are unlit `MeshBasicNodeMaterial` (`earth-core.tsl.js:443`) so they receive zero scene light and cannot fall into shadow with distance; the only haze sits at `renderOrder -10` BEHIND the assets (`earth-core.js:383`) so nothing composites in front to fade them; there is no scene fog. |
| **2** | **Holey / non-solid meshes** — magma geodes show dark cracks reading as see-through HOLES + thin angular SLIVERS | **NOT transparency** (geode is opaque: `transparent=false`, `FrontSide`, default `depthWrite=true`, `NormalBlending` — `earth-core.tsl.js:443-447`). Three real causes: **(2a) displacement without normal recompute** — geode is displaced per-vertex via `positionNode` (`earth-core.tsl.js:413-414,444`) but `normalLocal` is never recomputed, so adjacent triangles shade inconsistently → angular slivers/creases; **(2b) near-black crust punches visual holes** — `moltenRockField` collapses patches toward `uCrust = vec3(0.045,0.018,0.008)` in two stacked mixes (`earth-core.tsl.js:91,126-128`); where `crustFactor` is high and `riverIntensity` low the fragment hits ~`0x0b0502`, *darker than the lit haze behind it*, so crust patches read as voids; **(2c) fresnel on stale normals** — rim uses a fixed `+Z` reference on the un-recomputed normal (`earth-core.tsl.js:437`), banding the silhouette into crack-like stripes that also break as the camera dollies. |
| **3** | **Weak composition / no scale** — a radial cluster of rocks-in-haze | (a) **The unifying lake is out of frame** — flat plane at `y=-14`, camera dollies down (`yStart -52.5 → yEnd -7.5`, `earth-core.js:58`) looking roughly forward/down, so the floor is seen at a grazing angle or off-screen for most of the descent (`earth-core.tsl.js:255-257`). (b) **Layout is a Fibonacci RING, not staged depth** — geodes on one far ring (`earth-core.js:754-763`), columns 4 near + 4 mid (`earth-core.js:538-549`); with the lake gone everything sits at similar apparent depth. (c) **No oppressive walls/ceiling** — only a smooth `r=250` `BackSide` dome (`earth-core.tsl.js:389-396`); nothing presses the frame. (d) **Weak focal hierarchy** — hero lava-fall is far off-centre/small (`earth-core.js:508-511`); the value cut to ≤3 geodes removed clutter but left little readable structure. |

---

## 2. Research Distilled

### 2.1 Floating magma / lava techniques (TSL/WebGPU)

| Technique | What it is | Why it helps (issue) | How in TSL/WebGPU |
|-----------|-----------|----------------------|-------------------|
| **Recompute normals after displacement** | Sample the displacement field at two tangential ε-offsets, rebuild neighbour positions, `normalize(cross(pT−p0, pB−p0))` for the new normal | #2 — the slivers are a SHADING bug (stale normals fighting the displaced surface), not topology | After the same `snoise3` displacement, compute `disp(p)`, `disp(p+tangent*ε)`, `disp(p+bitangent*ε)`; set `material.normalNode = normalize(cross(...))`. Nodes (`cross`, `normalize`, `snoise3`) exist. [maximeheckel TSL field guide; three discourse "recalculate normals after vertex transformation using TSL"; catlikecoding surface displacement] |
| **Solid = opaque NormalBlending + depthWrite, lit body + emissive cracks** | A dark lit albedo gives a real silhouette and OCCLUDES; glow comes from an `emissiveNode` confined to crack masks — never additive on the body | #2 — a solid opaque body can't show background through it | Geode → `MeshStandardNodeMaterial` (like columns): `colorNode` = dark charred albedo, `emissiveNode` = `uHot.mul(pow(crackHeat,3))`. Keep `transparent:false`, `depthWrite:true`, `FrontSide`. Reserve `AdditiveBlending` strictly for non-occluding glow layers. [ICS Media magma; NCL transparency-and-depth PDF] |
| **Fake contact shadow / radial-AO decal** | Soft dark radial gradient on the ground under each prop fakes ambient occlusion at contact | #1 — the #1 grounding cue | A flat quad rotated `-π/2` on X with a feathered `MeshBasicNodeMaterial` toward near-black, `opacityNode = pow(1−dist,2)`, `depthWrite:false`, `NormalBlending`, renderOrder just above the lake; OR paint occlusion into the lake `colorNode` per-prop. [fxphd fake ground shadows; Sketchfab ground shadows; PMC shadow-perception] |
| **Atmospheric perspective (TSL fog + emissive bounce)** | Tint/lower-contrast distant geometry toward the medium color; add a warm "bounce" on lake-facing faces | #1, #3 — props share the medium's light; depth layering | `scene.fogNode = fog(hazeColor, rangeFogFactor(near,far))` (lit `NodeMaterial`s get it free); for `MeshBasic` mix manually with `cameraPosition` distance. Add up-biased warm emissive floor. [three fog manual; D5 atmospheric perspective] |
| **Domain-warped FBM flow + crust/vein temperature shading** | Low-freq fbm whose lookup is offset by a 2nd fbm (rivers), high-freq crust threshold, ridged veins, temperature ramp; flow-map ping-pong to kill smear | #1, #3 — keeps molten alive, non-tiling | **Already present** in `moltenRockField` + `createLavaFloorTSL`. Add ping-pong: sample at `uv−flowDir*fract(t)` and `+0.5` phase, cross-fade `abs(fract(t)−0.5)*2`. [danielilett voronoi lava; 80.lv lava; threejs webgl_shader_lava] |
| **Volumetric / raymarched god-ray shafts** | Screen-space march: in-scatter = phase·density·transmittance, Beer `exp(−σ·ds)`, Henyey-Greenstein forward scatter, blue-noise jitter, clamp at scene depth | #3 — oppressive scale/atmosphere | A `PostProcessing` pass using `pass()`/`getTextureNode('depth')` (depth constraint) + `viewportUV` + inverse-projection to reconstruct the world ray; HG+Beer in an `Fn`, blue-noise jitter. Fallback: keep additive cones + depth-fade. [maximeheckel volumetric lighting/cloudscapes; Codrops volumetric light rays; three-good-godrays] |
| **GPU compute ember/ash storm** | Persistent `instancedArray` buffers + a `compute(count)` kernel (advect up + curl turbulence + recycle), rendered with `SpriteNodeMaterial` life→temperature ramp | #1, #3 — motion, scale, warms dead-red gaps | `instancedArray(count,'vec3')` for pos/vel/seed; `compute()` keyed by `instanceIndex` with `curl3()`; sprite `colorNode` = `mix()` temperature ramp. (Current embers are CPU-animated instanced quads — a valid cheaper base.) [wawasensei TSL GPGPU; pyrestorm ember shader] |
| **Soft particles (depth edge-fade)** | Fade alpha where a particle intersects opaque geometry: `alpha *= saturate((sceneDepth − particleDepth)/fade)` | #1 — removes the hard billboard-cut "detached" tell | Read scene depth via the pass depth texture / `viewportDepthTexture` vs the fragment `positionView.z`; multiply `opacityNode`. [research.ncl transparency PDF; three TSL depth] |
| **Screen-space heat-haze refraction** | Sample the rendered scene at noise-offset UVs, masked to the hot lower frame, scrolled up | #1, #3 — signature "this is HOT" cue; couples fg/bg | A `PostProcessing` pass sampling the scene pass texture at `viewportUV.add(distortion)`; `distortion` = fbm offset × `heatMask` (lower-third). Keep strength ~0.005-0.01. [pyrestorm HEAT_DISTORTION; Kyle Halladay screen-space distortion; Wolfire] |
| **View-correct Fresnel rim** | `pow(1 − abs(dot(viewDir, normal)), k)` in VIEW space tints the grazing edge warm | #1, #3 — carves silhouette out of the haze | Use `positionViewDirection` + `normalView` (not a fixed `+Z`): `pow(oneMinus(abs(dot(normalView, positionViewDirection))), 3)`. [ICS Media fresnel] |
| **Layered depth + value hierarchy + single focal** | Repoussoir fg → midground heroes → hazy far, ~70% dark / one bright focal | #3 — turns a prop cluster into a cathedral | Stage `createObsidianColumnTSL` (frame edges), `createLavaFallTSL` (off-centre hero), `createMagmaHorizonTSL` (far line), `createVolcanoBackgroundTSL` (vault); scale geodes by depth. [Level Design Book; Magnopus; Tuts+ views & vistas] |
| **Bloom discipline (cap < 1.0, selective MRT)** | Keep displayed emissive just under 1.0; isolate bloom to flagged emissive via MRT | all three — kills orange-soup blowout | Already `min(color, vec3(0.92,...))` + `userData.emitsBloom`; the pipeline supports `setMRT(mrt({output,emissive}))` selective bloom (`odyssey-tsl-pipeline.js:236-252`). [casual-effects WBOIT context] |

### 2.2 AAA volcanic design pillars

| Pillar | How AAA does it | How we apply it (file) |
|--------|-----------------|------------------------|
| **Lava IS the key light** | Doom Eternal Hell / GoW Muspelheim: molten is the dominant source; light pools on it, everything else falls into controlled shadow (the ~70/30 value split) | Make light FALLOFF the grounding: add a distance-to-lake term to the lit material (`createMoltenPocketMaterialTSL`, `earth-core.tsl.js:569`) lerping the baked warm floor DOWN with distance; feed a `uLakeDistance` heatBias into `moltenRockField` for unlit geodes; keep shadows cool-tinted (`AmbientLight 0x1a0600` + a faint cool counter-fill) [Fanboy Planet Doom; Aenok Muspelheim] |
| **Warm/cool complementary contrast** | Muspelheim layers cool into shadows (never pure black); warm lava framed by cool clouds turning purple at the meet — pure orange-on-orange reads flat | Add a cool rim term on the shadow side of geode/column fresnel (mix small `0x0a1a26`); tint the dome's upper hemisphere slightly cool-purple; keep molten on the warm ramp [Aenok Muspelheim; Rookies GoW study] |
| **Canonical lava ramp, emissive-driven** | cooled-black crust → deep red → orange → yellow-white; EMISSIVE is a copy where only the hottest band survives so bloom takes the crack shape; crust height-blends over flow | Bias emissive harder to the bright veins: `emissive = pow(crackHeat, 2-3) * hotColor` so dark crust contributes ZERO bloom; drop cooled crust onto up-faces (`vNormal.y > 0`) as a skin (`moltenRockField`, `earth-core.tsl.js:90-144`) [80.lv Nature Manufacture; Minions Art] |
| **Solid-rock topology** | Crust is a height-blended SKIN with AO in crevices; displacement kept gentle, detail carried by shading not extreme vertex push | Recompute geode normals OR drop the `positionNode` push and let the color field carry detail on a clean sphere; add fake-AO darkening in crevices (multiply base down where the crust map is deepest); keep displacement ≤ ~3-5% of radius (`earth-core.tsl.js:412-414,437,444`) [80.lv Nature Manufacture] |
| **Grounding: contact shadow + emissive bleed** | Cloud Retouch 3-layer: contact shadow + AO pool + cast shadow; where a prop sits IN lava the emissive BLEEDS up onto its base | Add a dark radial AO decal under each column/shelf/geode + boost warm emissive on the LOWEST band near `LAVA_LAKE_Y` so the base glows as if lava licks it (`earth-core.js:550-562,775-794`) [Cloud Retouch; Babylon.js forum AO] |
| **Depth layering / atmospheric perspective** | Distant objects lose contrast, lighten toward haze, soften; clear fore/mid/background separated by haze (GoW layers clouds between vistas) | Distance-grade the haze (warmer/denser far) in `createMoltenHazeMaterialTSL` (`earth-core.tsl.js:528`); add exponential warm fog; lift far-prop bodies toward haze, keep near columns near-black [D5 atmospheric perspective; iRendering UE5 fog] |
| **Repoussoir framing** | Near-black foreground silhouettes frame the vista, amplify depth, prevent merging | Force the NEAREST columns to true near-black (`heatBias≈0`, low `uBakedBounce`); bracket each side of frame ACROSS the descent (sample path points). Odyssey is a cinematic on-rails camera, so painterly framing is legitimate — verify from the MOVING camera [Magnopus; Level Design Book caveat] |
| **Oppressive scale** | Vast vertical drops, ceiling lost in fog/dark, a small human-scale element for comparison | Vary column heights aggressively (a couple of 150+ giants among 70-tall) disappearing UP into ceiling haze; lose ceiling/far-shore in fog; keep tiny sharp embers near the camera as a scale cue; widen the cavern as `uDescent` rises [composition massing; DRG caves] |
| **Heat-haze shimmer** | A surface above the heat perturbs sampled screen UVs by scrolling noise | Post pass masked to the lower frame, scroll noise up; or cheap fallback: wobble haze/lava-fall `uv()` by `sin(uTime+worldY)*small` (`earth-core.tsl.js`) [pyrestorm; Real Time VFX heat distortion] |
| **Environmental storytelling** | Cooling states, flow direction, ash accumulation, structure consumed by heat | Bias lake flow FROM the fall toward camera; push crust % up at the lake rim (cools at edges); add ash on up-faces; let cracks crawl UP the nearest columns from the lake line (`moltenRockField` + `createLavaFloorTSL`) [Muspelheim; Hades Asphodel; Nature Manufacture] |

---

## 3. Composition Strategy

The fix is to convert the **radial ring** into a **staged depth composition** built around a
**readable lava-lake floor** and a **single bright hero**, with near-black repoussoir columns
framing the descent and every asset grounded into the lake.

### 3.1 The readable floor (the single highest-impact change)

The lake must be visible ACROSS the whole descent. In `earth-core.tsl.js:254-258` /
`earth-core.js:71`:

- **Widen + tilt the read, not just the plane.** Keep `y=-14` but extend the plane to
  `~360×360` and add a **bright horizon RIM** where the lake meets the far wall so a
  continuous molten floor + a crisp hot/dark LINE reads under the assets through the descent.
  The horizon line is what gives the floor its far edge and the cavern its size.
- **Tie the existing 3 magma-horizon bands** (`earth-core.js:479-493`) to the lake's far edge
  (align their Y to the lake horizon) so they read as the lake's far shore, not floating bands.
- **Open the chamber on descent**: drive `uDescent` to lift the horizon/haze ceiling as the
  camera nears the lake so the bottom of the chapter is the payoff "vast chamber" reveal
  (uniform already plumbed, `earth-core.js:953-959`).

### 3.2 Depth layers (fore / mid / far)

| Layer | Content | Placement approach (file) | Treatment |
|-------|---------|---------------------------|-----------|
| **Foreground (repoussoir)** | 2-3 near-black columns bracketing each frame edge | `columnConfigs` near-corner tuples `earth-core.js:538-549`; sample 2-3 path points (`getOdysseyPathPointAt`) so a vertical element holds each frame edge ACROSS the descent | True near-black (`heatBias≈0`, low `uBakedBounce`); a couple TALLER than frame so the top is lost in ceiling haze (implied height) |
| **Midground (heroes)** | Lava-fall + grounded geode boulders + node shelves | Lava-fall `earth-core.js:508-511` brought toward the look-direction + scaled up; geodes re-seated ON the lake/islets (`earth-core.js:752-768`) in near/mid clusters | Brightest focal value = lava-fall; geodes lit/grounded, mid value |
| **Far** | Lake horizon line + magma-horizon bands + dark vault dome | `earth-core.js:479-493`, `createVolcanoBackgroundTSL` | Low contrast, warm haze, lifted toward haze color; ceiling near-black cool-purple |

### 3.3 Focal hierarchy & scale

- **Hero**: enlarge the lava-fall and keep it on a rule-of-thirds line in the moving frame;
  add its splash glow + a rising ember column through a god-ray (`earth-core.js:516-530`).
- **Value hierarchy**: lava-bright (focal) > haze-mid > rock-dark. Hold ~70/30; cap molten
  emissive < 1.0; keep the vault near-black so selective bloom gilds only the focal molten.
- **Scale cues**: a few tiny SHARP embers near the camera + small crust chunks on the lake
  surface give the eye a known small size to measure the lake/columns against.
- **Oppressive walls/ceiling**: add a few large near-black wall slabs / stalactite columns
  pressing the top and sides of the corridor (reuse `createObsidianColumnTSL` inverted /
  a wall variant) so the camera falls THROUGH a tight cathedral (`earth-core.js:533-563`).

### 3.4 How each asset GROUNDS into the lava

| Asset | Grounding (file) |
|-------|------------------|
| **Obsidian columns** | (a) Contact-shadow AO decal at the lake line; (b) emissive BLEED on the lowest band (`smoothstep` on `positionWorld.y` near `LAVA_LAKE_Y`) so the base glows; (c) re-seat so the base rests at the surface, not centred through it (`earth-core.js:558`) |
| **Background geodes** | Re-seat base tangent to `y=-14` (center y = `-14 + size`) or on small obsidian islets; pull off the single far ring into near/mid/far clusters; switch to lit/standard material so they take the lake bounce + distance falloff (`earth-core.js:752-768`, `earth-core.tsl.js:404-451`) |
| **Node shelves (pockets)** | Nest each geode's contact decal on the shelf; keep the warm up-face/baked bounce (already present `earth-core.tsl.js:606-618`); ensure the shelf reads as resting on the lake/ledge (`earth-core.js:849-881`) |
| **Lava-fall** | A bright splash pool at the lake line (already in `createLavaFallTSL` `earth-core.tsl.js:288-293`); add a soft additive contact glow on the lake where it lands |
| **All** | A forward haze/fog layer so distant assets fade into the medium (`earth-core.js:379-385`) + scene fog so lit bodies desaturate with distance |

---

## 4. Technical Fixes — repair the non-solid / holey surfaces

These are the concrete, file:line repairs for **issue #2** (and the lit-material grounding that
issue #1 depends on). Order is impact-first.

### 4.1 (2b) Raise the crust floor so "crust" is dark warm ROCK, never near-black — *the holey-mesh root cause, fastest win*

The dark cracks read as see-through because crust patches collapse below the lit background.
In `earth-core.tsl.js`:

- `:91` lift `uCrust` from `vec3(0.045,0.018,0.008)` toward `~vec3(0.07,0.03,0.012)`.
- `:126` reduce the first mix strength `crustFactor.mul(0.72)` → `~0.55` (crust *mottles*, doesn't punch).
- `:128` keep more base color in the second mix: `riverIntensity.mul(0.85).add(0.15)` → `~.mul(0.7).add(0.3)`.
- After compositing, clamp a minimum luminance floor: `color = max(color, vec3(0.05,0.02,0.01))`.
- **Fake AO instead of voids**: where the crust map is deepest, MULTIPLY the body DOWN
  (`color = color.mul(mix(1.0, 0.65, crustFactor))`) so dark = recessed/shadowed rock, not absence.

### 4.2 (2a) Fix displacement normals on the geode — *the slivers/creases*

In `earth-core.tsl.js:412-414,444` the geode displaces in `positionNode` but never recomputes
normals. Two options (pick one):

- **Option A (preferred, keeps surface relief)**: recompute the normal analytically. Build
  the displacement as an `Fn(p => p.add(normalLocal.mul(snoise3(p.mul(2.0).add(uTime.mul(1.5))).mul(0.04))))`;
  evaluate it at `positionLocal`, `positionLocal + tangent*ε`, `positionLocal + bitangent*ε`
  (ε ≈ 0.01), then `material.normalNode = normalize(cross(pT.sub(p0), pB.sub(p0)))`. Feed THIS
  normal to the fresnel/lighting, not `normalLocal`.
- **Option B (cheapest)**: drop the `positionNode` push entirely; let `moltenRockField` carry
  the detail on a clean smooth `SphereGeometry`. The body will read solid because the silhouette
  is a clean sphere and the color does the work.

Keep displacement amplitude low (≤ ~3-5% of radius; current `0.04` is fine) so high-frequency
displacement never folds triangles into slivers. `SphereGeometry(size,48,48)` is adequate.

### 4.3 (2c) View-correct the geode Fresnel — *stops the silhouette banding*

In `earth-core.tsl.js:437` the rim uses a fixed `+Z` reference on the stale normal. Replace with
a view-space rim: `pow(oneMinus(abs(dot(normalView, positionViewDirection))), 3)`, tinted by how
molten the rim already is (`uHot` × local glow) plus a small COOL term (`~0x0a1a26`) on the
shadow side (warm/cool edge separation). Apply the same view-correct rim to columns/shelves for
consistency. (`normalView`/`positionViewDirection` are TSL built-ins.)

### 4.4 Make the geode a real lit SOLID (also closes issue #1's blend)

Convert `createRockClusterMaterialTSL` (`earth-core.tsl.js:443-449`) from
`MeshBasicNodeMaterial` to `MeshStandardNodeMaterial` (the columns' path):

- `colorNode` = dark charred albedo from `moltenRockField` (keep `transparent:false`,
  `depthWrite:true`, `NormalBlending`, `FrontSide`);
- `emissiveNode` = `uHot.mul(pow(crackHeat, 3.0))` — only the hottest veins emit/bloom (dark
  crust contributes ZERO bloom, holding the value hierarchy);
- `roughness ≈ 0.85`, `metalness ≈ 0.05`;
- add the up-biased warm emissive floor + lake-distance falloff (§5.2) so geodes pick up the
  lake's key light and fall dark with distance — the same bounce the columns already bake
  (`earth-core.tsl.js:606-618`).

> Note: this adds the geodes to the per-fragment light loop. Keep the chapter at the TWO key
> lights (`earth-core.js:920-932`); rely on the baked bounce + emissive, not more PointLights
> (the QW9 perf budget). Consider a lit-vs-baked toggle on `uBakedBounce` if profiling demands.

### 4.5 Geometry sanity on shelves/columns

`createMoltenPocketTSL`/`createObsidianColumnTSL` already `computeVertexNormals()` after CPU
jitter (`earth-core.tsl.js:646,673`) — good. If any slivers appear there, tighten the jitter
range (pocket `0.92-1.08` → `0.95-1.05` at `:640`; column `0.85-1.15` → `0.9-1.1` at `:669`) so
no triangle inverts.

---

## 5. Visual Enhancements — VFX / post / shader breakdown

For each: the approach, the file to touch, and whether it **BUILDS ON** the recent
`moltenRockField`/lava polish or is **NEW**.

### 5.1 Contact shadows + emissive bleed (grounding) — NEW

- A small radial-feathered dark decal quad per column/shelf/geode at the lake/ledge line
  (`MeshBasicNodeMaterial`, `NormalBlending` toward `0x0a0301`, `opacityNode = pow(1−dist,2)`,
  `depthWrite:false`, renderOrder just above the lake). Reuse `createGlowTexture` inverted to
  dark, or a procedural radial via `uv()`. Files: helper in `earth-core.tsl.js`; placement in
  `earth-core.js:550-562,775-794,849-881`.
- Emissive BLEED: in `createMoltenPocketMaterialTSL`/geode, boost warm emissive on the LOWEST
  band via `smoothstep(LAVA_LAKE_Y, LAVA_LAKE_Y+H, positionWorld.y)` so the base glows.

### 5.2 Emissive lava as a real light source + distance bounce — BUILDS ON

- Lit material (`createMoltenPocketMaterialTSL`, `earth-core.tsl.js:569`): add
  `uLakeDistance`-style term `length(positionWorld.xz − lakeCenter)`; lerp `bakedWarm` DOWN with
  distance so near-lake rock glows, far rock goes charred (the grounding GRADIENT).
- Keep the two PointLights as the literal key (`earth-core.js:920-932`); add a faint cool
  counter-fill so charred rock isn't dead flat black (extend the `uColorReflect` idea).

### 5.3 GPU/instanced ember + ash storm through the shafts — BUILDS ON (GPU = NEW)

- Now: CPU-animated instanced quads (`createRisingEmbers`, `earth-core.js:271-340`) seeded in
  3 columns at the splash + shelves — a valid base. Keep, but:
  - color by life via a temperature ramp `mix(white-hot, orange, red, ash)`;
  - tag brightest sparks `emitsBloom`; cap < 1.0;
  - tighten a few embers SMALL + sharp near the camera (scale cue, §3.3).
- Upgrade path (NEW): a GPU compute system — `instancedArray(count,'vec3')` pos/vel/seed, a
  `compute(count)` kernel buoying up with `curl3()` (shared lib) and respawning at the lake,
  `SpriteNodeMaterial` reading the buffer. New helper file or extend `earth-core.js`.

### 5.4 God-ray shafts — BUILDS ON (raymarch = NEW)

- Now: additive `ConeGeometry` cones (`createGodRayConeTSL`, `earth-core.tsl.js:328-359`), 4
  placed in `earth-core.js:516-530`. Keep as the cheap base but add **depth-fade** (§5.7) so
  they don't pop through the geodes, and composite through the selective-bloom path.
- AAA (NEW): a raymarched shaft pass in `odyssey-tsl-pipeline.js` (it already exposes
  `pass()`, `setMRT`, `getTextureNode('depth')`, `viewportUV`, inverse-projection access).
  Implement HG (`(1−g²)/pow(1+g²−2g·mu,1.5)`) + Beer `exp(−σ·ds)` accumulation in an `Fn`,
  blue-noise jitter the ray start, `break` when `t > sceneDepth`. Gate to chapter 1 only.

### 5.5 Heat-shimmer / refraction — NEW

- AAA: a `PostProcessing` pass in `odyssey-tsl-pipeline.js` sampling the scene pass texture at
  `viewportUV.add(distortion)`, `distortion` = fbm offset × `heatMask` (lower-third, biased to
  the lake/lava-fall), scrolled up by `uTime`, strength ~0.005-0.01, chapter-1 gated.
- Cheap fallback: perturb `uv()` on the haze puffs + lava-fall by `sin(uTime + worldY)*small`
  directly (`createMoltenHazeMaterialTSL` `earth-core.tsl.js:528`, `createLavaFallTSL` :268) for
  a shimmer read with no extra pass.

### 5.6 Atmospheric depth haze + scene fog — BUILDS ON

- Add `scene.fogNode` (warm `~0x1a0602`, exponential) so lit bodies (columns/shelves/now-lit
  geodes) desaturate toward haze automatically — the single biggest near-free depth win. Set in
  `createEarthCoreEnvironment` (`earth-core.js:394`); MeshBasic layers (lake/horizon/haze) get a
  manual `cameraPosition`-distance mix toward the fog color.
- Distance-grade the molten haze (warmer/denser far, thinner/cooler near) in
  `createMoltenHazeMaterialTSL` (`earth-core.tsl.js:551-554`).
- Add a forward haze layer (not only the `renderOrder -10` backfill) so distant assets fade
  (`earth-core.js:379-385,496-500`).

### 5.7 Soft particles (depth edge-fade) — NEW

- Multiply the `opacityNode` of `createMoltenHazeMaterialTSL`, `createGodRayConeTSL`, and the
  lava-fall splash by a depth-fade `saturate((sceneDepth − fragDepth)/fade)` using the pass
  depth texture vs the fragment depth (fade ~ a few world units). Removes the
  billboard-cutting-the-geode seams (a major "detached props" tell). Files:
  `earth-core.tsl.js:528,328,268`.

### 5.8 Flow-map ping-pong on lake + lava-fall rivers — BUILDS ON

- `moltenRockField` + `createLavaFloorTSL` already domain-warp + crust + veins. Add ping-pong:
  `flowDir = vec2(snoise3(p*0.01+t), snoise3(p*0.01+100+t))`; sample at `uv−flowDir*fract(t)` and
  `+0.5` phase; blend `abs(fract(t)−0.5)*2`. Removes smear at high flow. All nodes exist.
  Files: `earth-core.tsl.js:90-144` (field), `:184-224` (lake), `:279-282` (fall). Bias the lake
  flow direction FROM the fall toward camera (environmental storytelling, §2.2).

### 5.9 Bloom discipline (keep) — BUILDS ON

- Keep `min(color, vec3(0.92,...))` caps + `userData.emitsBloom` on every NEW layer (embers,
  decals adjacent glows). The pipeline supports selective bloom via
  `setMRT(mrt({output, emissive}))` (`odyssey-tsl-pipeline.js:236-252`); ensure every
  bloom-eligible material sets an `emissiveNode` so the near-black vault/rock bodies stay OUT of
  the bloom mask and the dark 70% holds.

---

## 6. Phased Roadmap (impact-to-effort) + Verification

### Phase 1 — Solidity & grounding (highest impact / lowest effort) — **do first**
1. **§4.1** raise crust floor + fake-AO (fixes holey read) — `earth-core.tsl.js:91,126-128`.
2. **§4.2/§4.3** geode normals + view-correct fresnel (fixes slivers) — `earth-core.tsl.js:412-414,437,444`.
3. **§5.1** contact-shadow decals + emissive bleed (grounds props) — `earth-core.js:550-562,775-794`.
4. **§4.4 + §5.2** lit geode + lake-distance bounce (props share key light) — `earth-core.tsl.js:404-451,569`.

### Phase 2 — Composition & scale (high impact / medium effort)
5. **§3.1** widen lake + horizon rim + align magma-horizons (readable floor) — `earth-core.tsl.js:254-258`, `earth-core.js:479-493`.
6. **§3.4** re-seat geodes ON the lake + cluster into near/mid/far — `earth-core.js:752-768`.
7. **§3.3** enlarge/re-frame the lava-fall hero + repoussoir columns across the descent — `earth-core.js:508-511,538-549`.
8. **§5.6** scene fog + distance-graded haze (depth layering) — `earth-core.js:394,496-500`, `earth-core.tsl.js:551-554`.
9. **§3.3** oppressive walls/ceiling slabs — `earth-core.js:533-563`.

### Phase 3 — AAA VFX polish (medium/high effort)
10. **§5.7** soft-particle depth-fade — `earth-core.tsl.js:528,328,268`.
11. **§5.8** flow-map ping-pong + directional lake flow — `earth-core.tsl.js:90-144,184-224,279-282`.
12. **§5.3** temperature-ramp embers (then GPU compute upgrade) — `earth-core.js:271-340`.
13. **§5.5** heat-shimmer (cheap fallback first, then post pass) — `earth-core.tsl.js`/`odyssey-tsl-pipeline.js`.
14. **§5.4** raymarched god-rays (cone base + depth-fade first) — `odyssey-tsl-pipeline.js`.

### Verification note
There is **no headless capture** of the WebGPU board — the user captures Earth Core frames in
their **desktop session**. Therefore: **batch each phase's code changes**, keep them behind the
existing spine (chapter-1 gating / `uBakedBounce` / `uDescent`), confirm the build passes lint
+ existing tests (e.g. `LevelNodeManager.test.js`), then ask the user for a re-capture of the
Earth Core journey frames per phase. Compare against `artifacts/odyssey/journey` Earth Core
frames for the three issues. Do not assume a fix landed visually until the user's capture
confirms it; keep changes reversible (uniform-gated) so a regression can be dialed back without
a rebuild.

---

### Appendix — Confirmed TSL/WebGPU capabilities (so the plan is buildable)
- Shared noise lib exposes `snoise3`, `fbm3`, `ridged3`, **`curl3`** (for ember turbulence) —
  `shared/odyssey-tsl-noise.js`.
- Billboard helpers: `billboardWorld`, `billboardVerticalWorld`, `makeQuadInstancedGeometry`
  (instanced quad particles) — `shared/odyssey-tsl-billboard.js`.
- Post pipeline already uses `pass()`, `setMRT(mrt({output,emissive}))`,
  `getTextureNode('output'/'emissive')`, threshold `bloom`, `viewportUV`, inverse-projection —
  so god-rays, heat-shimmer, and soft-particle depth all have a real hook
  (`odyssey-tsl-pipeline.js`).
- `uDescent` (0 vault-top → 1 lake) and `uBakedBounce` are already plumbed and ticked
  (`earth-core.js:411-421,953-959`) — reuse them for the descent reveal and lit/baked toggles.
