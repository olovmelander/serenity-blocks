# Summer Theme — "Midsommar Solstice" Masterpiece Plan

**Status:** v1 BUILT & screenshot-verified (2026-06-17). The from-scratch WebGPU/TSL rebuild is live:
golden-hour sky + low sun, instanced wind-animated wildflower meadow (vertex-shader wind, the perf
crux), reflector lake with sunset wash + reflections, Falu-red cottage, maypole (cross + two rings),
pine/birch framing — composed in `src/playground/effects/summer-meadow.effect.js`, mounted by the thin
`src/themes/summer/summer-theme.js` wrapper. Verified in the playground on WebGPU, **no console errors,
~144 fps** (vs. the old 250k×48-tri WebGL grass). Captures: `docs/_captures/summer-meadow-w*.jpeg`.

**Polish waves DONE (2026-06-17):** drifting faceted clouds + analytic sun-shafts (god rays) on the sky
dome; deeper-green pines; a warm low **lake-mist** band along the far shore; drifting **pollen/petal
motes** (in-shader animation); and the maypole **studded with flower flecks** (which also bloom on the
raise beat). Final capture: `docs/_captures/summer-meadow-w6.jpeg`.

**Birds added (2026-06-17, revised decision):** the v1 "no wildlife" call was reversed — the theme now
reuses **Chapter 3's skinned songbirds** (`goldfinch-flying.glb` + `swallow-flying.glb`, the same
species the old summer theme used) via the shared `loadOdysseyGltfCached` + `chapter-03-bird-assets.js`.
Three birds fly lazy banked circles over the lake/meadow with their baked vertex colours + skeletal
"Flap" clip (advanced by an AnimationMixer in `update`). The old `rendering/summer-birds.js` +
`assets/{swallow,goldfinch}.glb` were deleted; the Ch3 bird GLBs were **git-tracked** (they were
untracked) so the theme survives clean checkouts. Capture: `docs/_captures/summer-meadow-w8-birds.jpeg`.

**MRT emissive bloom — DONE (2026-06-17).** Added a `THREE.PostProcessing` MRT pass in the effect:
`pass(scene,camera).setMRT(mrt({output, emissive}))` → `bloom(emissiveTex, 0.45, 0.66, 0.0)` + a gentle
vignette + dither, `outputNode = sceneColor + bloom`. Only materials with an `emissiveNode` glow (sun,
sun-shafts, water sun-glitter, cottage window, maypole flecks) — art-directed, not a luminance
threshold; the rest of the look is preserved (no re-grade). To make it **playground-verifiable** (the
playground rendered the scene directly), the effect now returns `render()` / `renderAsync()` and both
hosts call them if present — a small backward-compatible hook added to `src/playground/main.js` and the
wrapper's loop. Verified ~104 fps, no errors. Guard: `?noBloom`. Capture: `docs/_captures/summer-meadow-w10-bloom.jpeg`.

**Bird flight + A2C — DONE (2026-06-17).** Birds pushed further out (4 of them, centres z≈-78…-104,
smaller scale) and given a **natural meandering flight**: a slow loop perturbed by faster offset loops
(non-circular), with velocity-derived heading (`atan2(dx,dz)+yawOffset`, `rotation.order='YXZ'`), pitch
from climb/dive, and roll **banked into each turn** (from the heading-rate). `yawOffset` (per flight) is
the single knob to flip a tail-first bird. **A2C flower anti-shimmer**: the petal coverage mask is
`fwidth`-sharpened to ~pixel width with `alphaToCoverage=true` (+ a crisp `alphaTest=0.5` fallback) so
dense flowers stop crawling in motion. Captures: `summer-meadow-w11-birds.jpeg`.

**Still later (diminishing returns):** module extraction (`rendering/* · post/* · sim/*` — note a
`rendering/summer-trees.js` GLB-tree module is being added in parallel); and in-game verification (the
effect — the heavy part — is verified; the wrapper mirrors the proven halcyon one).

**Original status:** Planning (0% built). Plan-first per project convention.
**Date:** 2026-06-17
**Author:** Claude (Opus 4.8), from an 8-agent research/investigation sweep.
**Goal:** Delete the current heavyweight WebGL summer theme and rebuild it from scratch as a
beautiful, performant, WebGPU/TSL **Swedish midsummer** theme — golden-hour meadow + lake +
Falu-red cottage + maypole, framed by birch and pine — matching the user's moodboard + reference photo.

> Reference photo lives at `public/playground-refs/summer-midsummer-reference.jpg` (drop the
> supplied reference there). Iterate the effect against it with
> `?ref=/playground-refs/summer-midsummer-reference.jpg&refMode=split`.

---

## 0. TL;DR

- The current `src/themes/summer/` is a **WebGL/GLSL outlier** that renders **250,000 grass blades
  at 48 triangles each (≈12M tris, DoubleSide, no culling)** — multiplicatively over-built. It is
  the *only* major theme not on the project's WebGPU/TSL standard. **Rebuild, don't patch.**
- Adopt the **halcyon-apex pattern**: the scene lives in a playground effect
  (`src/playground/effects/summer-meadow.effect.js`), and a **thin `BaseTheme` wrapper** imports its
  `create()`. "Improve the effect = improve the theme."
- Adopt the **winter modular layout** (`materials/ post/ rendering/ sim/ composition/`) and its
  hard-won discipline: `useMRT:true` + **emissive-tagged bloom**, `targetFps:60`,
  `{material, uniforms}` factories, a pure dependency-free **director** scalar driving reactivity.
- The **meadow is the crux.** Replace 250k 24-segment blades with **GPU-instanced low-segment
  blades + instanced flower cards, all wind-animated in the vertex shader**, concentrated in the
  visible foreground wedge with distance-faded LOD; the distant meadow is a textured ground plane.
  Target: **~30–60k instances, a handful of draw calls, <2M tris, 60 fps on an integrated GPU.**
- Hero moments, ranked: **(1)** maypole against the golden horizon, **(2)** the endless-golden-hour
  sky, **(3)** the wildflower meadow, **(4)** the Falu-red lake cottage, **(5)** the calm lake with a
  sun-glitter reflection + dock + rowboat, **(6)** birch/pine framing with aerial-perspective hills,
  **(7)** golden ground-fog + faceted low-poly clouds, **(8)** drifting petals / a floating flower crown.

---

## 1. Vision & concept — "Midsommar Solstice"

A **warm, endless-summer-evening calm.** The longest day of the year in southern Sweden: the sun
grazes the horizon for hours and never truly sets, bathing a lakeside meadow in golden rim-light.
The mood is **serene · nostalgic · warm · festive-but-calm · luminous** — celebratory and alive with
wildflowers and the maypole, yet hushed and a little wistful, like the last golden hour of the year's
longest day. The darkest value in the scene is a **luminous dusky blue-violet, never black.**

This replaces the current theme's flat midday "dense green field under a blue sky" with a
**composed, art-directed golden-hour postcard** that reads as unmistakably Swedish at a glance.

### Emotional north star
The player should feel they've stepped onto a wooden dock at a Swedish *sommarstuga* at 22:30 on
Midsummer's Eve — flowers swaying, water still and gold, a red cottage glowing, a flower-decked
maypole on the far shore. Calm enough to play Tetris in front of for an hour.

---

## 2. The reference — scene layers (from moodboard + photo)

Composed back-to-front, the target image decomposes into depth layers we will build as discrete,
individually-tunable systems:

| Layer | Contents | System |
|---|---|---|
| **Sky dome** | Tall gradient: cool blue zenith → peach band → coral horizon; large low warm sun; faceted pink-orange low-poly clouds; analytic sun-shafts | `rendering/summer-sky.js` (analytic BackSide dome, emissive sun) |
| **Far hills** | Rolling green hills receding into dusty blue-violet haze (aerial perspective) | silhouette ridge layers + fog |
| **Forest wall** | Dark blue-green pine/spruce treeline framing left & background | instanced low-poly conifers + silhouette tree-line |
| **Birch framing** | White-trunked birches with bright-green canopies framing the sides, rim-lit | a few hero birch (geometry) + instanced background birch |
| **Cottage** | Falu-red *stuga*, white trim, red geranium in the window, on the right bank | low-poly building (geometry), emissive window |
| **Lake** | Calm blue water, warm sun-glitter streak, reflections of sky/cottage/trees; dock + rowboat | `rendering/summer-water.js` (reflector, guarded) |
| **Shoreline** | Cattails/reeds, dock posts, contact shadows | instanced reeds + dock geometry |
| **Meadow (hero foreground)** | Dense wildflower meadow: oxeye daisies, cornflowers, lupines, buttercups, red poppies in lush swaying grass | `rendering/summer-meadow.js` (instanced blades + flower cards, vertex-shader wind) — **the crux** |
| **Maypole** | *Midsommarstång*: cross + two hanging wreath rings, birch-leaf sleeved, flower-studded, backlit | hero geometry, mid-distance on the far bank/meadow |
| **Atmosphere** | Golden ground-fog over meadow + lake mist; drifting pollen/petals; a floating flower crown | `sim/` curl-noise particle field + fog |

The play area (the 2D Tetris board) sits in front of this; the composition must keep the **center
clear and the action at the periphery** (halcyon does this deliberately) so the board stays readable.

---

## 3. Why the current theme must be rebuilt (perf teardown)

From a full read of `src/themes/summer/summer-theme.js` (1448 lines):

1. **Wrong renderer.** It uses `THREE.WebGLRenderer` + three inline raw-GLSL `ShaderMaterial`s +
   legacy `EffectComposer`/`UnrealBloomPass` + 8× MSAA. It is the **only** major visual surface not
   on the project's **WebGPU/TSL** standard (CLAUDE.md). It cannot share the project's TSL helpers,
   perf policy, MRT-bloom discipline, or resilience.
2. **The grass is multiplicatively over-built** (`summer-theme.js:568+`):
   - `grassInstances: 250000`, **hardcoded to the High preset on every device** (`:293`).
   - `PlaneGeometry(w,h,1,24)` = **48 triangles / 50 verts per blade** (24 segments for a smooth bend
     that needs 3–5). → **12.0M triangles, 12.5M vertex-shader runs/frame**, drawn `DoubleSide`
     (≈24M rasterized faces), with `frustumCulled = false` (always submitted off-screen too).
   - Severe **overdraw** (250k blades in a 120×100 field) feeding a per-fragment ACES+gamma+translucency shader.
3. **Bugs are per-mesh, not instanced.** Each butterfly (~18 meshes) and bumblebee (~20 meshes,
   incl. 6 `TubeGeometry` legs) is a `Group` of individual meshes with **cloned per-instance
   materials/textures**, and `update()` does a full `.traverse()` **per bug, per frame** to find wings
   by name. ~300 draw calls + ~16 unique canvas textures.
4. **Per-frame CPU churn:** pollen rewrites 180 floats + `needsUpdate=true` every frame; bug
   traversals; CPU hill displacement + 8000/6000-stroke canvas-texture loops cause a **multi-hundred-ms
   create-time hitch**.
5. **Marginal post payoff:** 8× MSAA over a 12M-tri overdrawn scene + bloom strength 0.1.

**Keepers (ideas, not code):** the single instanced draw call *concept* for grass (just not 250k×48),
the GLB-bird flight behaviour (track assets in git!), the sky-gradient + additive sun-glow look, the
butterfly/bee *motion* state machines, and `summer-tetrominos.js` (pure data — keep nearly as-is).

> **Git hygiene:** the current `assets/swallow.glb`, `assets/goldfinch.glb`, `rendering/summer-birds.js`,
> and `assets/ATTRIBUTION.md` are **untracked** (same failure mode as the Odyssey assets). Whatever we
> keep must be explicitly `git add`ed or it vanishes on clean checkouts/CI.

---

## 4. Architecture decision

**Pattern: playground-effect-as-theme (halcyon-apex), modular layout (winter).**

```
src/themes/summer/
  summer-theme.js          # THIN BaseTheme wrapper: WebGPU renderer (+WebGL2 fallback),
                           #   mount the effect, own RAF loop + resize + resilience,
                           #   eventBus→pulse() bridge, getTetrominoConfig(). NO inline shaders.
  summer-tetrominos.js     # pure data (kept, re-tinted to the midsummer palette)
  summer-materials.js      # TSL {material, uniforms} factories only
  summer-theme-icon.png    # picker icon (regenerate to a midsummer thumbnail)
  composition/
    season-director.js     # pure, dependency-free intensity scalar + event pokes (clone StormDirector)
  post/
    summer-pipeline.js     # THREE.PostProcessing TSL stack: MRT emissive bloom → warm grade → vignette → grain
  rendering/
    summer-sky.js          # analytic gradient dome + emissive sun + sun-shafts + faceted clouds
    summer-meadow.js       # instanced blades + flower cards, vertex-shader wind, LOD  ← CRUX
    summer-water.js        # reflector lake (guarded), fresnel sky-tint, sun-glitter, reeds
    summer-flora.js        # instanced pine/birch/conifer treelines; hero birch
    summer-props.js        # maypole, cottage, dock, rowboat (low-poly geometry + emissive windows)
  sim/
    pollen-field.js        # curl-noise GPU compute for pollen/petals/ground-fog motes (winter StormField surface)
  assets/                  # any GLBs — git add explicitly

src/playground/effects/
  summer-meadow.effect.js  # THE composed scene; exports meta + create(ctx) → controller. Theme imports create().
```

**Why this split:** winter proved the modular folders + a director spine + emissive-bloom discipline
produce a maintainable AAA theme, while its *monolith* `winter-theme.js` (4847 lines, dual WebGL path,
a dozen CPU `update*()` systems) is the anti-pattern to avoid. Summer ships **WebGPU-only, no legacy
fallback path, no inline GLSL.** Halcyon proved the thin-wrapper effect pattern keeps the scene
iterable in the playground (screenshot-verifiable per CLAUDE.md) while still getting a full theme
lifecycle.

**Controller contract** the effect's `create(ctx)` returns (consumed by both the playground and the
thin wrapper — identical shape to halcyon):
```js
return {
  camera(time, cam) { ... },        // drive camera deterministically (parallax + slow drift)
  update(time, dt) { ... },         // push time into uniforms, advance sim, decay reactive state
  pulse(kind, payload) { ... },     // combo/lock reactivity (see §10)
  setIntensity(mult) { ... },       // reduced-motion / disable scaling
  resize(w, h) { ... },
  dispose() { ... },                // required: remove from scene + dispose geo/mat/reflector/post
};
```

`ctx = { THREE, scene, camera, renderer, sizes:{width,height}, params }` — same object the playground
(`src/playground/main.js:110`) and the wrapper (`halcyon-apex-theme.js:65`) construct.

---

## 5. Palette — "Midsommar Solstice" (authoritative hex)

```
SKY        zenith #5B8FB0 · upper #7FB0C4 · mid #A9C9D6 · peach #F4C9A1/#F6B98A
           horizon #F39C6B → #EE7E5B → #E5673E   (optional violet dusk wash #9D7CB8/#6E5E97)
SUN        disc #FFE3A3 · core #FFF4D6 · sunlight tint #FFD27A/#FBC56B · golden haze #F7B95C
GRASS      sunlit #7DA84B/#8FB861 · mid #5E8C3C · shadow #3F6B2E
FOREST     pine #274D33/#1F3A2A · birch leaf #A7C957
BIRCH      bark #EDE9D8/#E8E4D8 · lit bark #F3E9C8 · lenticels #3A3A38/#2C2A26
WATER      sky-blue #5C93B0 → #3E7390 · sun streak reuse #FFD27A/#F39C6B as specular
COTTAGE    Falu red #801818 (anchor; facade variants #7C3030–#8B2E2E) · white trim #F4EFE3
FLOWERS    daisy petal #FCFBF5 / center #F2C53D · cornflower #5A7BD4/#6495ED
           lupine #7C6BB0/#8E7CC3 (pink #C98FB8) · buttercup #F6C324/#FBC02D
           poppy #D7352B/#E04030 · red clover #C9508A · forget-me-not #9FC7E8 (eye #F2C53D)
           cattail #6E4B2A · geranium bloom #E23B33 / leaf #2F6B33
```

White + blue dominate the meadow; **yellow and red are the accent pops**. Warm gold key light vs.
cool blue-violet shadow fill is what sells "Nordic twilight" rather than generic sunset.

---

## 6. Composition & camera

- **Framing:** rule-of-thirds horizon low (~lower third), meadow filling the foreground bottom,
  lake as the calm mid-band leading the eye, cottage at a thirds intersection (right), maypole as a
  vertical anchor (left/mid), birches framing the verticals. Center-screen kept calm for the board.
- **Camera:** mostly static hero composition with **gentle mouse-parallax** (clone halcyon's
  critically-damped pointer offset) + a slow sinusoidal drift/dolly, so it breathes without distracting.
  `PerspectiveCamera(55, …, 0.1, 20000)`.
- **Aerial perspective:** linear fog tuned warm-gold near ground, pushing distant hills toward dusty
  blue-violet — the cheapest, highest-impact depth cue.

---

## 7. Technique deep-dives

> Sections **7.2 (meadow)**, **7.1 (sky)** and **7.3 (water)** are the load-bearing ones. The numbers
> and named TSL example references here are a first pass from the halcyon/winter codebase + general
> technique; the in-flight web-research pass (low-poly landscape, meadow-perf, stylized-water) will
> refine instance budgets, cite specific Three.js TSL grass/reflector examples, and validate the
> anti-shimmer approach. Marked **[refine]** where research will tighten.

### 7.1 Sky, sun & light (analytic, no raymarch — iGPU-safe)
- **Dome:** `SphereGeometry(8000)`, `BackSide`, `MeshBasicNodeMaterial`, `depthWrite=false`,
  `fog=false`, `toneMapped=false`, `frustumCulled=false` (exactly halcyon's discipline).
- **Gradient:** `colorNode` = vertical mix over `rd.y` through the §5 sky stops; warm horizon band.
- **Sun:** large, low; `emissiveNode` carries ONLY the sun disc + halo so **only the sun seeds bloom**
  (MRT emissive path). Warm 2700–3200 K directional key + faint cool blue-violet ambient fill.
- **Sun-shafts:** analytic angular streaks via the sun tangent-basis + `atan2` trick (halcyon
  `:196–203`) on the dome — no raymarch.
- **Clouds:** **faceted low-poly** pink-orange clouds — flat-shaded low-segment geometry drifting
  slowly, OR analytic cloud bands on the dome. **[refine: pick geometry vs analytic from research.]**
- **Long soft shadows:** raking directional light; consider a single low-res shadow map for the
  cottage/maypole/birch contact only (budget permitting), else baked AO discs.

### 7.2 The meadow — THE CRUX (replace 250k×48 with a smart instanced system)
Design goals: lush, swaying, golden-rim-lit wildflower meadow that reads as dense **only where the
camera looks**, at <2M tris and a handful of draw calls on an iGPU.

> **⚠️ LOAD-BEARING TSL GOTCHA (from research):** in three r181 WebGPU, a material's
> `positionNode`/`vertexNode` run **before** `InstanceNode` applies `instanceMatrix`, and
> `instanceMatrixNode` is **not exposed** to materials. So you **cannot** read an instance's world
> position inside the vertex hook. **Solution:** keep wind bend **in local blade space** (bend amount
> from `positionLocal.y` = height up the blade), and feed anything world-dependent (the gust-noise
> sample position, per-blade phase, color/height variation) as **per-instance `InstancedBufferAttribute`s**
> we compute on the CPU at build time (we already know each blade's world XZ when we place it). This
> composes correctly: local bend → then `instanceMatrix` places/rotates the whole bent blade. (Alt:
> drive everything from a `storage()` buffer via `instanceIndex`, winter's snow pattern — also fine.)
> Source: three.js forum "Post-instanceMatrix vertex transformation hook" proposal.

**Wind = three layered frequencies, all in the vertex shader (zero per-frame JS):** global sway (low
freq, whole field), gust waves (mid freq, rolling fronts — sampled from a noise at the per-instance
world-XZ attribute + time), turbulence (high freq, per-blade flutter via per-instance phase). Tip
displacement >> base (anchor at root). **Shading:** AO darkening toward the blade base (by
`positionLocal.y`), two-tone tip color mixed by noise, and **subsurface backlight** = a separate warm
color scaled by the angle between view and sun dirs (the golden-hour glow — Ghost-of-Tsushima trick).
**Clumping** via cellular/Voronoi noise grouping per-blade height/color/lean.

- **Grass blades:** `InstancedMesh` (or TSL instanced/storage) of a **3–5 segment** blade (not 24).
  Wind is **100% in the vertex shader** (`positionNode`): root-anchored bend = layered `sin` sway +
  a low-frequency gust wave + **per-instance phase** (instance attribute / hashed instanceIndex). No
  per-frame CPU. `FrontSide` with a normal-flip trick (not `DoubleSide`). `frustumCulled` **on**.
- **Concentration, not carpet:** scatter blades in the **visible foreground wedge** with density
  falloff, not a uniform 120×100 field. The **distant meadow is a textured ground plane** (painted
  grass + flower-color noise), so we pay geometry only where it matters.
- **Flowers:** a small atlas of **cross-quad / billboard flower cards** (daisy, cornflower, lupine,
  buttercup, poppy) instanced with **per-instance type + color + scale + phase**; alpha-tested with
  **alpha-to-coverage** so they need no depth sorting. Hero clusters near camera = small geometry;
  far flowers = the ground-texture pops. **[refine: card atlas vs tiny low-poly meshes; exact counts.]**
- **Golden-hour translucency:** cheap backlight/SSS rim term on grass+petals from `dot(sunDir, …)`
  so blades glow when between camera and sun — this is the single biggest "premium" tell.
- **LOD & stability:** distance-fade instance scale to 0; **alpha-to-coverage / MSAA + slight blade
  thickness + mip bias** to kill thin-geometry shimmer. **[refine from anti-shimmer research.]**
- **Budget target:** **~30–60k total instances** (blades + cards), **≤6 draw calls**, **<2M tris**,
  60 fps iGPU. (vs. the old 250k×48 ≈ 12M tris.) Device-adaptive count tied to the perf policy /
  `targetFps:60`, **never** a hardcoded High preset. **[refine exact tiers.]**

### 7.3 The lake (reflector, guarded)
- **Reflector:** reuse halcyon's exact `reflector({ resolutionScale: 0.3–0.4 })` pattern, target
  rotated so its normal points up, guarded behind `?summerNoReflect` for fragile drivers.
- **Look:** flat plane, **fresnel sky-tint** (deep blue at normal → warm peach at grazing), gentle
  `positionNode` ripple from scrolling noise, **sun-glitter specular streak** toward the low sun,
  soft shoreline foam. Reflects sky + cottage + trees + maypole "for free."
- **Integration:** dock posts + rowboat sit on the water with contact shadows + faint reflection;
  cattails/reeds (instanced) at the shoreline. **[refine reflection cadence/res from research.]**

### 7.4 Trees & framing flora
- **Pines/spruce:** low-poly stacked-cone conifers, **instanced**, flat-shaded; a silhouette
  tree-line on the hills for the forest wall (cheap depth).
- **Birch:** a few hero birches (cylinder trunk with lenticel texture + low-poly canopy), rim-lit;
  background birch instanced. **[refine: billboard impostors for distance.]**

### 7.5 Hero props (geometry, low-poly, flat-shaded)
- **Maypole (*midsommarstång*):** the identity object, **mid-distance on the meadow/far bank** (locked,
  §14.3). Get the **cross + two hanging wreath rings** silhouette exactly right; birch-leaf-sleeved
  pole, flower-studded wreaths; **backlit/rim-lit** by the low sun; subtle emissive flower glints.
  **Reacts on big clears:** a subtle **"raise & glow" beat on Tetris / Perfect Clear** (§9) — the pole
  lifts slightly and the wreaths bloom-glow, then settle.
- **Cottage:** Falu-red box + gabled roof, **white trim**, an **emissive window** with a red
  geranium; warm interior glow at dusk.
- **Dock + rowboat:** weathered wood, simple geometry, on the water.

### 7.6 Atmosphere & ambient life
- **Ground-fog / lake mist:** soft warm `Fog` + a low translucent fog card band; sells the "thick
  light."
- **Particles:** one **curl-noise GPU compute** field (winter `StormField` surface:
  `getPositionBuffer/count/computeNode/update/setActiveCount/dispose`) driving **pollen motes +
  drifting petals**; optionally a single floating **flower crown** on the water.
- **Wildlife: CUT for v1** (locked, §14.1). No birds/butterflies/bees — the ambient life is carried
  entirely by the meadow sway, drifting petals/pollen, water shimmer, and slow cloud drift. (A cheap
  *instanced* bird flock or butterflies can be a post-v1 wave.)

### 7.7 Post-processing (`post/summer-pipeline.js`)
Clone `winter-pipeline.js` shape on `THREE.PostProcessing`:
1. **MRT emissive bloom** — `scenePass.setMRT(mrt({ output, emissive }))`; **only** sun/window/
   flower-glint/sun-glitter emissive blooms (art-directed, not luminance threshold). Keep `useMRT:true`.
2. Warm **ACES** tonemap + golden-hour grade (lift warm, cool the shadows, gentle sat/contrast).
3. Soft **vignette** + subtle **film grain/dither** (anti-banding on the big sky gradient).
   Non-bloom scenic materials set `emissiveNode = vec3(0)` so they never bloom.

---

## 8. Performance budget & LOD

| Knob | Old (broken) | New target |
|---|---|---|
| Renderer | WebGLRenderer | WebGPURenderer (+WebGL2 fallback) |
| Grass blade segments | 24 (48 tris) | 3–5 (6–8 tris) |
| Grass/flower instances | 250k fixed High | ~30–60k device-adaptive **[refine]** |
| Grass triangles | ~12M (DoubleSide ≈24M faces) | <2M |
| Sides | DoubleSide + `frustumCulled=false` | FrontSide + culling on |
| Bugs | ~300 meshes, per-frame traverse | instanced / capped / cut |
| Particles | CPU pollen re-upload/frame | 1 GPU curl-noise compute |
| Post | 8× MSAA + UnrealBloom 0.1 | MRT emissive bloom + warm grade |
| `targetFps` | uncapped | 60 (unless high-refresh detected) |
| Pixel ratio | base globals | perf-policy `theme` cap (1.35) |

LOD: single distance-driven scalar (winter-style) fading distant instances + dropping particle count
via `setActiveCount`; keep it **simpler** than winter's WebGL governor (the wonderland path proves the
heavy governor is unnecessary when the preset + emissive-bloom-scale are sane).

---

## 9. Reactivity — `SeasonDirector` + combo/lock `pulse()`

- **`composition/season-director.js`** — a pure, dependency-free scalar `warmth/festivity ∈ [0,1]`
  (clone `StormDirector`: fast attack, slow decay — "a glow, not a switch"), with transient pokes
  (`bloom`, `breeze`, `sparkle`) decaying independently. Drives uniforms via multiply-adds that are
  **0 at rest** so the TSL graph compiles once (halcyon discipline — no combo recompiles).
- **Wrapper bridge** (clone `halcyon-apex-theme.js:86`): subscribe to `EVENTS.{PIECE_LOCK, COMBO,
  LINE_CLEAR, TSPIN, B2B, PERFECT_CLEAR, HARD_DROP, LEVEL_UP}` → `runtime.pulse(kind, payload)`,
  gated by `window.settings?.backgroundComboEffects` and reduced-motion via `setIntensity`.
- **Proposed mappings (midsummer-flavoured, additive billboards only — never custom beam geometry):**
  | Event | Effect |
  |---|---|
  | `PIECE_LOCK` | a few petals puff up from the meadow at the piece's column |
  | `COMBO` (tiered) | breeze gust ripples the meadow + water rings; warmth ticks up; fireflies rise |
  | `LINE_CLEAR` | a band of flowers bloom-flash + dandelion-seed burst; one water ring per line |
  | `TETRIS`/`PERFECT_CLEAR` | maypole "raise & glow" beat + golden bloom swell + flower-crown launch |
  | `B2B` | sustained warmth floor (sky pushes more golden) |
  | `LEVEL_UP` | sun nudges lower/warmer (deeper into the golden hour) |

---

## 10. Tetromino palette (`summer-tetrominos.js`)

Keep the existing schema (`renderMode:'glow'`, glow/outline/pulse/shimmer/trails), **re-tinted to the
Midsommar Solstice palette**: e.g. I = cornflower `#6495ED`, O = buttercup `#FBC02D`, T = lupine
`#8E7CC3`, S = sunlit-grass `#8FB861`, Z = poppy `#E04030`, J = lake `#3E7390`, L = sunset `#F39C6B`,
GARBAGE = weathered birch/grey; warm glow color `#FFE3A3`. Cheap, unrelated to the grass cost.

---

## 11. Implementation roadmap (playground-first, screenshot-gated)

Per CLAUDE.md: **one small effect per session**, iterate in the playground, **screenshot-verify with
chrome-devtools MCP (clean canvas + no WebGPU console errors) before "done"**, then port. Use a
free port; reference-driven via `?ref=…&refMode=split`.

- **Wave 0 — Scaffold.** Create `summer-meadow.effect.js` (sky dome + ground plane + camera + fog) and
  the thin `summer-theme.js` wrapper; register in `theme-registry.js` (+`HEAVY_GPU_THEME_IDS`); drop the
  reference into `public/playground-refs/`. Screenshot the empty golden-hour stage vs. reference.
- **Wave 1 — Sky & light** (§7.1). Gradient dome + low warm sun + sun-shafts + warm/cool light split +
  faceted clouds. Screenshot-match the sky band.
- **Wave 2 — The meadow** (§7.2, **the crux**). Instanced low-segment blades + vertex-shader wind +
  density-falloff foreground wedge + golden-rim translucency. Profile instance count vs fps. Then
  flower cards. Screenshot + a chrome-devtools performance trace to confirm the budget.
- **Wave 3 — The lake** (§7.3). Reflector + fresnel tint + sun-glitter + reeds + dock + rowboat.
- **Wave 4 — Props** (§7.5). Maypole (silhouette-correct), cottage (emissive window), birch + pine
  framing, far hills + aerial haze.
- **Wave 5 — Atmosphere & post** (§7.6–7.7). Curl-noise pollen/petals, ground-fog, MRT emissive bloom +
  warm grade + vignette/grain. Final composition pass vs. reference.
- **Wave 6 — Reactivity** (§9). `SeasonDirector` + `pulse()` mappings + wrapper eventBus bridge +
  reduced-motion. Verify combos don't recompile shaders or hitch.
- **Wave 7 — Polish & perf gate.** Device-adaptive LOD, tetromino re-tint, icon regen, git-add assets,
  remove old summer theme, final iGPU 60 fps check.

Each wave = one screenshot-verified playground session before porting into the theme.

---

## 12. Integration & registration

1. `src/themes/theme-registry.js`: keep the `summer` entry (or re-id) `{ id:'summer', displayName,
   module:'./summer/summer-theme.js', group:'biomes', icon }`; ensure `summer ∈ HEAVY_GPU_THEME_IDS`.
2. `src/core/constants.js` `THEMES`: ensure `summer` stays in rotation/level progression.
3. `index.html`: confirm `<div id="summer-theme" class="theme-container">` exists.
4. Effect auto-registers in the playground via the `*.effect.js` glob — no wiring.
5. Name the wrapper's disposable fields conventionally (`scene/renderer/post/runtime`) for free
   `releaseManagedGpuResources()` disposal; `resourceProfile='heavy-gpu'`.

---

## 13. Risks & gotchas (load-bearing)

- **Custom dynamic/transformed BufferGeometry won't render under the WebGPU node path** — every
  reactive/glow visual must be an **additive billboard** (halcyon `:1493`). Use instanced static
  geometry for the meadow; never per-frame-rebuilt geometry.
- **`toneMapped=false` on all pre-graded unlit surfaces** (sky, sun, clouds, glows) because the
  pipeline is `NoToneMapping` until the post grade — forgetting it is a silent over-bright bug.
- **`fog=false` on sky/atmosphere** so the scene fog doesn't wash the sky out.
- **Emissive routed ONLY from genuinely glowing elements**; scenic materials set `emissiveNode=vec3(0)`
  or bloom floods the whole sky.
- **No raymarch loops** (TDR-safe on the dev iGPU) — sky/sun/shafts/clouds analytic on the view ray.
- **WebGPU captures TDR-crash the dev iGPU on heavy/full-journey loads** — keep capture sessions to one
  small effect; the chrome-devtools MCP tab can throttle WebGPU.
- **Untracked assets vanish on clean checkouts** — `git add` every GLB/texture/sub-module explicitly.
- **Reflector is a real offscreen pass** — guard behind a `?summerNoReflect` flag, low `resolutionScale`.
- **Keep `targetFps:60`** unless a high-refresh display is detected (winter's 120 parked LOD at min).

---

## 14. Locked decisions (confirmed by user, 2026-06-17)

1. **Wildlife: CUT for v1.** No birds, butterflies, or bees in the first version — ship the
   landscape + meadow + atmosphere first. The old `summer-birds.js` + GLBs are *not* carried over.
   Cheap instanced creatures can be a later wave. (Removes the ~300-mesh / per-frame-traverse cost
   entirely; also removes the untracked-GLB liability.)
2. **Day phase: LOCKED golden hour.** The "endless evening" Nordic golden-hour mood, matching the
   reference photo. No day→dusk drift in v1 — one controlled, beautiful, always-on lighting state.
3. **Maypole: mid-distance hero that reacts on big clears.** Placed on the meadow / far bank, backlit
   by the low sun, with a subtle **"raise & glow" beat on Tetris / Perfect Clear** (see §9).
4. **Theme id stays `summer`** (preserves settings/rotation); displayName becomes "Midsommar".

---

## Appendix A — refined technique numbers (from web research)

- **Blade budget tiers** (instanced, single draw call each): mobile ~50–100k @ 3-seg blades; desktop
  ~200–500k @ 5-seg + LOD rings. **Our iGPU target: ~40–80k geometry blades in the foreground wedge +
  flower cards**, distant meadow as ground texture; chunk into a few InstancedMeshes for frustum cull.
  Safe total-triangle "sweet spot" ≈ **3M** (we aim well under). Blade geom: tapered, **3–5 segments
  (7–15 verts)**, quadratic/cubic Bézier bend; near=15 verts, far=7, very-far→texture.
- **Flowers / distant grass = alpha cards** (2 tris) — multiple intersecting quads per clump for
  all-angle read; far cheaper than 3D blade models. **Anti-shimmer = Alpha-to-Coverage + `fwidth`
  alpha-sharpen**: `a = (a - cutoff)/max(fwidth(a),1e-4) + 0.5` with MSAA≥4×, + mip-coverage
  preservation / mip-bias ~0.25 so distant cards don't dissolve.
- **Water:** `reflector({ resolutionScale: 0.4 })` (ReflectorNode), `.target` added to scene + rotated
  normal-up (halcyon pattern). Fresnel bright/deep split + sky-tint + `sparkle = pow(dot(N,sunDir),8)`;
  **sun-glitter** = thresholded specular `dot(sunDir, reflect(-V, perturbedN))` toward the low sun
  (long+reddish at low elevation), discrete sparkles that bloom. Monument-Valley **shore foam** via
  depth-difference mask + animated sine lines; flat normals for the faceted look. (`WaterMesh` from
  `three/addons` is the built-in WebGPU alternative; ReflectorNode gives more art control.)
- **Sky:** zenith→horizon exponential gradient (extra-bright warm horizon band, Rayleigh twilight),
  `MeshBasicNodeMaterial` BackSide dome. **Clouds:** faceted low-poly = merged low-seg spheres
  (`SphereGeometry(r,7,8)`) + vertex jitter + flat-bottom chop + `flatShading` + pinkish sunset light;
  or analytic bands on the dome. **Aerial perspective:** fog color = sky color; contrast compresses +
  hue cools with distance **except** it warms toward the sun at sunset — push distant hills dusty
  blue-violet but keep a warm rim.
- **Trees:** low-poly = cylinder trunk + 3 stacked cones (increasing radius) merged → 1 draw call;
  **instanced forest** = InstancedMesh bark + leaf quads (2 draw calls for hundreds of trees),
  vertex-shader LOD (distant leaves → degenerate `gl_Position`; sway cutoff beyond ~50u; bark
  green-tint at distance to mask culled leaves). 2,800 trees in 8 draw calls @ 60fps is documented.
- **Grade:** ACES filmic + warm golden-hour split-tone (lift warm highlights, cool shadows), gentle
  sat/contrast, vignette, dither to kill sky banding. Flat-shaded facets pop with ambient + a strong
  side directional key.

## Appendix B — sources

**Meadow / grass:** Ghost of Tsushima GDC "Procedural Grass" (Eric Wohllaib) — [GDC Vault](https://gdcvault.com/play/1027033/Advanced-Graphics-Summit-Procedural-Grass) · [icon-era analysis](https://icon-era.com/threads/gdc-procedural-grass-in-ghost-of-tsushima.460/) · [tigerabrodi breakdown](https://tigerabrodi.blog/grass-in-ghost-of-tsushima); SimonDev ["How do Major Video Games Render Grass?"](https://www.youtube.com/watch?v=bp7REZBV4P4) + [Quick_Grass](https://github.com/simondevyoutube/Quick_Grass); [GarrettGunnell/Grass (Acerola)](https://github.com/GarrettGunnell/Grass); [Cyanilux GPU instanced grass](https://www.cyanilux.com/tutorials/gpu-instanced-grass-breakdown/); [Codrops "Fluffiest Grass with Three.js"](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/); [CK42BB/procedural-grass-threejs (WebGPU+TSL)](https://github.com/CK42BB/procedural-grass-threejs); [2Retr0/GodotGrass](https://github.com/2Retr0/GodotGrass); [three.js forum — 3M instanced grass perf](https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286).
**TSL instancing gotcha:** [three.js forum — Post-instanceMatrix vertex hook proposal](https://discourse.threejs.org/t/proposal-post-instancematrix-vertex-transformation-hook-for-instancedmesh-batchmesh/88362); [TSL docs](https://threejs.org/docs/pages/TSL.html).
**Anti-shimmer:** [bgolus — Anti-Aliased Alpha Test / A2C](https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f); [Alpha to coverage — Wikipedia](https://en.wikipedia.org/wiki/Alpha_to_coverage).
**Water:** [ReflectorNode docs](https://threejs.org/docs/pages/ReflectorNode.html) · [WaterMesh docs](https://threejs.org/docs/pages/Water.html) · [three.js webgpu_water example](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_water.html); [Maxime Heckel "Field Guide to TSL and WebGPU"](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/); [AG stylized water (TSL)](https://aleksandargjoreski.dev/blog/stylized-water-shader/); [danielzeller Lowpoly-Water (Monument Valley)](https://github.com/danielzeller/Lowpoly-Water-Unity); [Harry Alisavakis stylized water](https://halisavakis.com/my-take-on-shaders-stylized-water-shader/); [Sun glitter shader (Unity)](https://unitywatershader.wordpress.com/2018/05/17/sun-glitter/) · [Sun glitter — Wikipedia](https://en.wikipedia.org/wiki/Sun_glitter).
**Low-poly landscape:** [Josh Marinacci — Low Poly Clouds](https://medium.com/@joshmarinacci/procedural-geometry-low-poly-clouds-b86a0e66bcad) + [Trees](https://medium.com/@joshmarinacci/procedural-geometry-trees-896cc06f54ce); [three.js forum — Procedural Instanced Forest](https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610); [PolyworldJs](https://github.com/eliemichel/PolyworldJs); [Material.flatShading docs](https://threejs.org/docs/#api/en/materials/Material.flatShading); [Aerial perspective — Wikipedia](https://en.wikipedia.org/wiki/Aerial_perspective) · [Draw Paint Academy — Atmospheric Perspective](https://drawpaintacademy.com/atmospheric-perspective/); [three.js sky example](https://threejs.org/examples/webgl_shaders_sky.html); [ACES filmic tonemapping — Narkowicz](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/).
**Midsummer aesthetic sources:** see the body of §1/§5 (Nordiska museet maypole, the seven flowers, Falu red `#801818`, Nordic midnight-sun light) — full list in the research notes.

