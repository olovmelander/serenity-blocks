# Odyssey — One World Plan (2026-08)

**Status:** Proposed — **revision 2**, after a second research round (snowflow source read
end to end, the three.js r181 WebGPU/TSL ecosystem surveyed against `node_modules`, art
direction from nine shipped games, and an adversarial performance review). Revision 2 demoted
the raymarched far range, added band-limiting, shadows, a colour script and a two-lane budget,
and found that the frame number the whole plan was justified by is not GPU time. Supersedes
the per-chapter cohesion patching in
[ODYSSEY_CH3_CH4_POLISH_2026-08.md](ODYSSEY_CH3_CH4_POLISH_2026-08.md) (rounds 1–8), which
should be read as the evidence log that motivated this document.

**Scope:** Act II — chapters 2–6 (ocean floor → ocean → shore → hills → alpine → sky →
edge of space). Chapters 1, 7 and 8 (Earth Core, Black Hole, Urban Dreams) are genuinely
*different places* and are explicitly out of scope — see §3.0.1.

**Core idea (§3.0):** the environment stops being divided into chapters. There is one world;
the *path* is divided into chapters. Chapters own levels, board themes and colour-script
keyframes — not ground, sky, atmosphere or mountains.

**Reference:** [Noniv/snowflow_demo](https://github.com/Noniv/snowflow_demo) (MIT) —
the user-nominated visual and architectural target.

---

## 0. Verdict

Odyssey does not have a world. It has **eight independently-authored dioramas**, each
built in its own local coordinate frame at its own origin, each owning its own ground, its
own sky, its own atmosphere and its own sun — and the "journey" is an **alpha crossfade
between two dioramas at a time**.

That is the whole problem. A crossfade of two dioramas can never read as one landscape,
because at the midpoint you are literally looking at two worlds at 50% each. Every symptom
reported in-game — see-through hill bases, hills that change identity, ground that pops out
of view, rectangles hanging in the air — is a *consequence* of that, not an independent bug.
Eight rounds of local fixes have not converged because the thing being patched is the
symptom surface, not the cause.

The fix is to stop crossfading worlds and start having one.

---

## 1. Evidence

Everything in this section is measured against the current working tree, not inferred.

### 1.1 The world is eight local frames

Each chapter is one `THREE.Group` parented to `environmentGroup`, positioned at
`getChapterPathRange(id).center` — the arithmetic midpoint of the chapter's first and last
spline sample. Content inside is authored in that group's **local** frame.

| Chapter | Group origin (world) | Centre-to-centre |
|---|---|---|
| ch2 deep-ocean | (−18.3, 212.7, −15.7) | — |
| ch3 surface-world | (−93.4, 327.5, −151.5) | 193.0 u |
| ch4 mountain-peaks | (−182.7, 390.6, −379.3) | 252.7 u |
| ch5 sky-drift | (−198.2, 539.6, −544.4) | 222.9 u |
| ch6 cosmic-expanse | (−74.6, 723.3, −663.7) | 251.5 u |

Anything that must be world-locked has to be re-expressed per host
(`canonical-mountain-range.js` `toLocalPosition`). That is why chapters 3, 4 and 5 each
build a **byte-identical** copy of the same mountain chain at the same world coordinates,
and why the `rangeAuthority` / L5-dedup machinery had to be invented to stop the three
copies z-fighting each other.

### 1.2 The crossfade is broken in three independent ways

**(a) It never reaches Chapter 3 at all.** `surface-world.js` contains **zero** reads of
`group.userData.chapterOpacity` (verified: `grep -c` → 0; `mountain-peaks.js` → 1). Ch3's
alpha comes only from its own global-progress ramps. The manager's crossfade weight is
simply absent from Ch3's algebra.

Consequently the only thing that ever removes Ch3's ground is the **binary** cull at
`ChapterEnvironmentManager.js:1194-1195`:

```js
const isVisible = opacity > 0;
env.group.visible = isVisible;
```

Measured: the Ch3 foothill skirt holds alpha **1.000** across the entire 3→4 crossfade,
then stops being drawn in **one frame** at p = 0.38200. Between p = 0.38195 and 0.38205 the
rail moves **0.16 world units** and a surface covering **27.7 % of the frame** (the whole
bottom band, full width) goes from fully opaque to not drawn. Underneath it, already at
alpha 1.000, is the flat white Ch4 snow disc and its 80 conifers.

> That is exactly *"from one frame to the next in Chapter 4, the hill just pops out of view,
> the landscape abruptly changes, and we see trees and snow-covered ground."*

**(b) Most opacity writes are dead.** `_collectOpacityTargets` finds 37 uniform targets and
104 `material.opacity` targets — but **62 of those 104 materials have an authored
`opacityNode`**, which in r181 makes `material.opacity` a dead write. Chapters 1/2/7/8 wired
the `material.uniforms = { uOpacity }` bridge; chapters 3/4/5/6 have **zero** such bridges
and each invented its own private convention instead.

**(c) The ecotone band is degenerate.** `resolveEcotoneHalfWidth` computes a content-blend
band, then applies `Math.max(halfWidth, seamWidth)`. For **all seven** boundaries the
computed ecotone (0.0062–0.0163) is smaller than `seamWidth`, so the content band is exactly
equal to the fog band everywhere. The entire `ECOTONE_SPAN_FRACTION` /
`ECOTONE_MAX_HALF_WIDTH` / `ECOTONE_NEIGHBOUR_CLEARANCE` tuning is **dead code**.

### 1.3 The two grounds are different objects in different places

Ch3's ground is two baked heightfield plates:

| Surface | Geometry | World AABB |
|---|---|---|
| Ch3 meadow plate | Plane(400×400, 96×96) | x[−293, 107] y[276.5, 354.9] z[−351, 48] |
| Ch3 foothill skirt | Plane(920×880, 104×112) | x[−553, 367] y[276.7, 358.1] z[−1131, −251] |

Ch4's ground is five *unrelated* surfaces, each with its own Y datum and its own atmosphere:
a 3000-radius **flat snow disc** at y = 293.69, a 2600-radius **flat cloud deck** at
y = 303.69, three FBM apron planes, an 80-instance conifer belt, and the canonical chain.

The consequences are geometric, not stylistic:

- **86.0 %** of the Ch3 skirt sits **above** the Ch4 snow disc plane, by up to **+64.4 u**.
  Through the whole crossfade you watch green ridges emerge from, and then vanish into, a
  flat white plane.
- The 80 conifers are planted at a **constant** world y = 294.69 with **no heightfield
  sample at all**. Over the cells where the belt overlaps the skirt they sit a mean
  **−4.5 u** from the surface (range −26.3 … +15.7); **37.7 %** of cells bury a 6–17 u tree
  by more than 8 u, **18.0 %** float it by more than 4 u.

### 1.4 Why you can see through the bottom of the hills

Four stacked causes at the breach, all measured:

1. **The ground has no underwater half.** `landAlpha = smoothstep(relHeight, −2.6, 0.9)`
   with `relHeight = terrainY − 287.31`. Terrain spans world y [276.5, 354.9], so every
   fragment below y = 284.71 is alpha 0 and only y ≥ 288.21 is opaque — a **3.50 u** band,
   and **55.4 %** of the plate area is under it.
2. **Along the actual view ray from the breach eye**, `landAlpha` is **0.000 at every
   station from 50 u to 350 u** ahead; first non-zero is 0.161 at 400 u; the plate ends at
   ~430 u. There is literally no painted ground in front of you.
3. **It could not occlude anything even where opaque**: the terrain material is
   `side = FrontSide` with `depthWrite = false`, so from a sub-surface eye its up-facing
   polygons are backface-culled.
4. **The hills are solid before their ground exists.** The skirt + canonical mountains ride
   a different gate (`alpineOpacity`, no entry ramp) and reach **1.000 at p = 0.2005**,
   while the meadow's `entryOpacity` ramp does not even begin until p = 0.20104.

So at the breach the frame contains a full-opacity sky dome, full-opacity mountains and
hills, and **no ground** — you are seeing the sky dome through the place the land should be.

### 1.5 Six competing atmospheres and two suns

There is exactly one `FogExp2`, rewritten every frame — but **twelve** call sites set
`material.fog = false`, and they are precisely the large silhouette-defining surfaces: every
sky dome, the Ch3 ground, the Ch3 skirt, and the **entire** canonical mountain chain. What
still breathes the scene's air is the vegetation, water, clouds, snow floor, conifers, level
orbs and path ribbon.

Measured at the Ch3→Ch4 approach (p = 0.32, hero massif 850 u out), three surfaces that
physically touch each other recede into **three different atmospheres**:

| Surface | Haze at 850 u | Toward colour | Rel. luminance |
|---|---|---|---|
| Hero massif (own ramp) | 9.8 % | 0x7d9ec2 | 0.327 |
| Foothill skirt (own ramp) | 22.1 % | ~0x7093bc | 0.279 |
| Anything scene-fogged | 58.3 % | 0xbcd8ec | 0.659 |

A **5.9× haze mismatch toward a 2× brighter target**, between surfaces that are supposed to
be one hillside. Both ramps live in the same "ONE mountain language" module and disagree:
`mountainSkirtColorNode` uses `smoothstep(380,1400)*0.5`, `mountainColorNode` uses
`smoothstep(260,2600)*0.62`.

**Lighting is the sharpest break.** `ODYSSEY_SUN = [0.35, 0.62, −0.70]` (az +26.6°, el
+38.4°) drives the visible sun disc, the water glitter, the god-rays and the meadow key.
`MOUNTAIN_SHADING.keyDir = [0.5, 0.8, 0.5]` (az +135.0°, el +48.5°) shades **every** alpine
surface. The angle between them is **72.5°**, with **108.4°** of azimuth separation. Inside a
single hero peak the contradiction is explicit — the body shades off `keyDir` while the
summit-ignite crown directly above it keys off `ODYSSEY_SUN`.

The view-space-normal bug that was fixed on the mountains is still live on the Ch3 landscape
(`surface-world.tsl.js:912` → `:974`), the Ch3 cabin (`:3070`) and the Ch4/Ch5 cloud deck
(`mountain-peaks.tsl.js:270`) — so the meadow's terminator swings with the camera while the
skirt it merges into is world-locked.

`SEAM_34_ALPINE_BRIDGE` is now pure damage: Ch3 and Ch4 have **identical** fog and sky
colours, yet the bridge forces the fog through a **3.0× luminance dip** at **2.18× density**
over 196 u at the exact boundary, then undoes it. Left over from a dusk look that no longer
exists.

### 1.6 The performance picture

| | Odyssey today | snowflow_demo |
|---|---|---|
| Draw calls | **137** | **15–19** |
| Triangles drawn | 370,639 | ~353,000 |
| Distinct materials | **173** across 8 chapters | — |
| GPU frame | 7.0 ms p95 **@ 1280×720** | **3.22 ms @ 2560×1440** |
| Terrain | 7+ surfaces, ~10 materials, 2 chapters | **1 mesh, 1 draw call** |
| VRAM | ~192 MB JS heap | ~350 MB |

Roughly the same triangle budget buys snowflow a fully deformable, cascade-shadowed,
TAA'd, analytically-lit continuous world at **4× the pixels and half the frame time**. The
gap is not shader cleverness — it is that snowflow spends its triangles on **one continuous
surface in one draw call**, and Odyssey spends them on 313 drawables across eight dioramas.

Three more facts that shape the plan:

- **Material-object count is the startup cost.** r181 runs `NodeBuilder.build()` once per
  material *object*; measured ≈ **40–45 ms of cold pipeline compile per material** on the
  RTX. 173 materials is the startup budget.
- **69 % of every drawn frame is rail furniture** — 55 level-node orbs (190,740 tris) plus
  the path tube trio (66,560 tris) = 257,300 tris in 9 draws, entirely independent of any
  chapter rebuild. *Rebuilding the world does not by itself reduce triangles.*
- **Quality tiers are inert.** Identical material and draw counts at Minimal and Extreme for
  ch2–ch8; ch3 and ch8 are byte-identically quality-invariant because their create functions
  take no arguments. The per-chapter LOD path is dead code (it only sheds `THREE.Points`, and
  there are zero Points objects in any chapter).

---

## 2. Symptom → cause

| Reported symptom | Root cause | Structural? |
|---|---|---|
| "See straight through the bottom of the grassy hills when I come up from the water" | §1.4 — 55.4 % of the ground plate is alpha 0, `landAlpha` is 0.000 for the first 350 u of the view ray, terrain is FrontSide + `depthWrite:false`, and the hills reach opacity before their ground starts drawing | Partly local (fixable in Wave 0), fully cured by one continuous solid ground |
| "The top of the hill to the left is dark and transparent, then becomes snow-covered" | §1.5 — the skirt is shaded by a sun **72.5° away** from the one lighting everything else, and hazed toward a third colour on a different ramp; "becomes snow-covered" is the biome changing because the *chapter* changed, not because the *altitude* did | Structural |
| "From one frame to the next in Ch4 the hill pops out of view, the landscape abruptly changes, trees and snow-covered ground" | §1.2(a) — 27.7 % of frame, alpha 1.000 → not-drawn, in 0.16 world units, via a binary `group.visible` flip; plus §1.3, two grounds 64 u apart in Y | Structural |
| Hard-edged rectangle hanging in the sky | Breach veil quad whose radial feather ended at r = 1.28 while its own boundary starts at r = 1.0 — **already fixed** (commit 333c59f1); hard step 114 → 15 luma | Local, done |
| "See through the hero mountain" (previous round) | Rectangular alpha rim fade eating a circular cone — **already fixed** (333c59f1) | Local, done |

---

## 2.5 What the reference actually costs — and the measurement problem

snowflow's headline is 3.22 ms GPU at 2560×1440 on an **RTX 5070 Ti**. Scaling that to the
Radeon 610M lane, from datasheets:

| | 610M (RDNA2, 2 CU, 8 TMU, **4 ROP**, shared DDR5, 15 W) | RTX 5070 Ti | ratio |
|---|---|---|---|
| FP32 | 468–563 GFLOPS | 43.9 TFLOPS | **78×** |
| Pixel fill | 7.6–8.8 GPixel/s | 235.4 GPixel/s | **27×** |
| Texture fill | 15.2–17.6 GTexel/s | 686.6 GTexel/s | **39×** |
| Bandwidth | shared DDR5 | 896 GB/s | ~15× |

After the 4× resolution divisor (2560×1440 → 1280×720) the effective penalty is ~19.5×
ALU-bound, ~6.75× fill-bound, ~3.75× bandwidth-bound, then **×1.3–2.0 for TSL→WGSL** (no
register-level control). snowflow's 3.22 ms ports to **~20–60 ms on the 610M** if copied
literally. It only fits because most of that frame is things Odyssey does not need.

**The measurement problem, which is worse.** Odyssey's "7.0 ms p95" is a rAF-to-rAF
presentation delta from `src/core/frame-rate-controller.js:432-436`, captured on an RTX 5080
at 720p. **It is not GPU time.** It will barely move when 137 draws become 20. This repo has
already been burned by exactly this class of error (an FPS counter that inflated 2× by taking
a mean of reciprocals). Nothing below is trustworthy until the real split exists — hence
Wave −1.

The most likely 610M bottleneck has never been measured at all: **55 level-node orbs × 3
nested transparent `depthWrite:false` spheres**, which on a 4-ROP part is a large amount of
blended overdraw sitting in front of everything.

---

## 3. Target architecture — "One World"

### 3.0 The ownership model — chapters are intervals on the path, not partitions of space

**The environment should not be divided into chapters at all.** A chapter is a *progression*
concept, not a *spatial* one. Today it is both, and that conflation is the root cause in §1.

Ask what a chapter is for and it splits into three things: which levels live here; which
board theme you get; what the world looks like. Only the third is spatial, and it is exactly
the one that must not be a partition. The other two are properties of a **scalar path
position `p`**, and a scalar does not need the world cut into pieces to be read.

So invert the ownership:

| | Owns | Does **not** own |
|---|---|---|
| **The World** | one ground, one water sheet, one sky, one sun, one atmosphere; biome as a function of world position | any notion of "chapter" |
| **The Path** | the spline, arc length, `p` | geometry |
| **A Chapter** | an interval `[pStart, pEnd)`: its levels, its board theme, its colour-script keyframe, which set-pieces are active | ground, water, sky, atmosphere, mountains |

The world exposes three queries: `height(x, z)`, `biome(worldPos)`,
`aerial(worldPos, colour, medium)`. Set dressing is placed in **world space by region** and
streamed by camera distance — never parented to a chapter group.

Everything that hurts today is a consequence of the current ownership and simply ceases to
exist under this one: no chapter-local frames → no `toLocalPosition` → no duplicated mountain
chains → no `rangeAuthority`; no two worlds co-present → no crossfade → no dead `opacityNode`
writes, no binary `group.visible` pop; a continuous world has no seams, so seams survive only
as **colour-script keyframes** and **level-set boundaries**, both just data along `p`.

And the chapter identities are not lost — they become **emergent**. The rail climbs, so the
land is green low and snowy high.

### 3.0.1 Three acts, not eight chapters

| Act | Chapters | Treatment |
|---|---|---|
| **I — Earth Core** | ch1 | Separate place. Stays a diorama. |
| **II — The Ascent** | **ch2–ch6** | **ONE WORLD.** One mountain rising out of one ocean into one sky. *(Shipped as ch2–ch5: `ONE_WORLD_CHAPTERS = [2,3,4,5]` — ch6 Space keeps its own environment because the world's height field does not describe it, per the Wave 3 policy test. This table records the original intent; the implementation deliberately narrowed it. Do not "fix" suppression toward this row.)* |
| **III — Beyond** | ch7–ch8 | Separate places. Stay dioramas. |

That leaves exactly **two** act boundaries needing a real transition, and both should be
**occlusion** moments (a dive, a breach, a cloud bank), not alpha crossfades.

### 3.1 One ground clipmap + one water sheet — **two** draws, not one

A camera-following nested-ring geometry clipmap: one static mesh, one material, one draw
call, all placement / CDLOD morph / displacement in the **vertex stage**, zero CPU rebuild,
zero per-frame upload.

**Correction to the first draft:** a heightfield is single-valued, so "ocean floor + ocean
surface" is inherently **two sheets**. Pillar 1 is *two* draws — a ground clipmap and a water
clipmap. Settle it now, because §3.7 requires the Ch2→Ch3 transition to pass *through* the
water surface.

Concrete constants (the first draft's "~300 k triangles" was **1.9× oversized for zero visual
gain**):

| Lane | GRID_N | LEVELS | BASE_SPACING | HOLE_SHRINK | Triangles | Reach |
|---|---|---|---|---|---|---|
| RTX | 128 | 7 | 1.5 u | 3 | 189,008 | 6,144 u |
| 610M | 96 | 7 | 1.5 u | 2 | 107,856 | 4,608 u |

Both exceed the first draft's stated 2,500–3,000 u radius at 30–50 % of its triangle budget.

The vertex function, adopted verbatim from the reference:

```
spacing     = baseSpacing * exp2(level)
origin      = floor(camXZ / (spacing*2)) * (spacing*2)   // snap to TWICE the spacing
local       = grid * spacing
cheb        = max(|local.x|, |local.z|) / (gridHalfN * spacing)
morph       = clamp((cheb - 0.70) / 0.16, 0, 1)          // completes at 0.86
coarseLocal = (floor(grid * 0.5) * 2.0) * spacing
local       = mix(local, coarseLocal, morph)
worldXZ     = origin + local
effSpacing  = spacing * (1 + morph)    // varying: gates every band-limiting decision
```

Four non-obvious, load-bearing points:

1. **Snap to 2× spacing, not 1×** — otherwise lattice parity flips between frames and the
   surface shimmers.
2. **The morph is not distance-driven.** It morphs by normalised Chebyshev position *within
   the ring*, which is stateless and exactly reproducible in the shadow pass.
3. **HARD INVARIANT, documented nowhere, fails silently as cracks:**
   `morphEnd ≤ 1 − 4·HOLE_SHRINK / GRID_N`.
   The reference satisfies it at N=160 / shrink=3 / morphEnd=0.86 (margin 0.065). At
   N=64 / shrink=3 the ceiling is 0.8125 < 0.86 → cracks. **Assert it in the mesh builder and
   unit-test it.**
4. **`lodCenter` comes from the spline's GROUND-TRACK point at the current `p`, never from
   the camera eye** — otherwise a camera push or look-around re-samples the same ground
   between two ring spacings and visibly changes its shape. (The reference hit this and moved
   the centre off the camera for exactly this reason.) This directly protects the Ch6 hero
   framing the user has already praised.

Three three.js mesh-setup requirements, **all silent failures**: `frustumCulled = false`;
`matrixAutoUpdate = false` with an identity matrix; and a **manually assigned
`geometry.boundingSphere`** — three would otherwise compute a radius from the fake
`(i, level, j)` attribute values and use that nonsense for shadow-map culling. Read the
addressing as `attribute('position','vec3')`, **never `positionLocal`**, which the node
pipeline may already have rewritten (same trap class as the r181 `InstanceNode` /
`positionGeometry` issue already in this project's memory).

### 3.2 Height: local relief baked, the ascent analytic

**Amended.** Do **not** bake absolute world height. Half-float epsilon at 2,000 u is ~1.0 u —
unusable for a surface geometry displaces to.

- Bake only **local relief (±150 u)**, where RG16F epsilon is 0.06 u, into an **RG16F 2048²**
  texture.
- Add the large-scale ascent **analytically** as a smooth function of spline arc length.
  Odyssey already owns that function, so this is *simpler*, not harder.

RG16F is filterable everywhere with no feature request; `float32-filterable` is optional and
r181's defensive fallback covers only `DataTexture`, **not render-target textures** — a float
RT on a non-supporting adapter is a validation error, not graceful degradation. So do not
build an R32F path at all.

**AUX BAKE** — a named artefact, RGBA16F 1024², carrying `(dH/dx, dH/dz, biome mask,
curvature)`. **Derive normals by central-differencing the baked height texture, never by
re-evaluating the analytic derivative.** That guarantees lighting describes the exact surface
the vertex shader displaces to, and structurally kills the "phantom shading seam" class
already logged against Ch3/Ch4. Three lines of TSL for the highest value-per-line in the
entire reference. A wide-stencil (6-texel) Laplacian in the A channel becomes a free
curvature-derived biome selector feeding §3.6.

A CPU mirror of the height makes props seat **exactly** on the drawn surface — killing the
floating/buried conifers (§1.3) permanently.

**PROJECT RULE, lint-able:** any `texture()` reachable from `positionNode` or `geometryNode`
**must** carry `.level(0)` (or use `textureLevel()` / `textureLoad()`). WGSL forbids
`textureSample` in the vertex stage, and r181 auto-injects a level in only three places
(`EnvironmentNode` ×2, `Background.js`) — **nothing injects it for user materials**. Omitting
it is a WGSL validation error, i.e. a black chapter, not a warning.

### 3.3 The far range: **SUPERSEDED — the world simply does not end**

> **RESOLVED BY MEASUREMENT, 2026-08.** This whole pillar turned out to be unnecessary and is
> retained below only as the reasoning that led to the test.
>
> The clipmap's own structure already solves it: **each additional ring level doubles the world
> reach for a near-constant per-ring triangle cost.** Measured on the discrete lane, taking
> `LEVELS` from 7 to 10 moved reach from **6,554 u to 52,429 u — 8× further — for +41 %
> triangles and a GPU p50 of 7.012 ms both before and after, byte-identical.**
>
> So there is no LUT pipeline, no spline stations, no cross-fade, no parallax artefact and no
> extra 6 MB of textures. Shipped at `LEVELS 9` (26 km), which is past the useful range anyway
> once the camera's far plane and the aerial perspective are accounted for. The property is
> pinned by a unit test in `odyssey-clipmap.test.js`.
>
> One real consequence, found the same way: a sky dome sized off `reach` falls outside the
> camera's far plane once reach is large, and the sky renders **black**. Size the dome
> independently and widen the far plane deliberately.

<details><summary>Original reasoning (superseded)</summary>

#### The far range: pre-baked LUTs, not a per-frame raymarch

**This pillar is demoted, and it is the single biggest change from the first draft.**

Raymarching the range on the sky is beautiful and it is what the reference does — at ~240
gradient-noise evaluations per marched pixel, costing 1.2 ms of its 3.22 ms frame on an RTX
5070 Ti (37 %). On the 610M the arithmetic is:

| Resolution | Cost (610M) | Verdict |
|---|---|---|
| Full | 13.97 ms (8.38 ms with trig stripped) | reject |
| Half | 3.49 / 2.10 ms | reject |
| Quarter | 0.87 / 0.52 ms | reject — blocky hero silhouette |

All rejected. **Because Odyssey is a rail with a known camera path**, pre-bake ~12 equirect
range LUTs at spline stations ~150 u apart (12 × 512×256 RGBA16F = **6 MB**) and cross-fade
two at runtime: **~0.02 ms and zero compile risk**, with *better* parallax control than the
reference has. Do not fall back to a quarter-res per-frame march — it makes the hero
silhouette blocky, and that silhouette is the one hard edge the composition is allowed to
have.

This still deletes the canonical mountain chain, the L5 dedup, `rangeAuthority` and the entire
alpha-rim-fade bug class — the architectural win survives intact.

</details>

### 3.4 One sun, one analytic sky

Delete `MOUNTAIN_SHADING.keyDir`. **`ODYSSEY_SUN` becomes a lint rule, not a convention.**

> **Trap already paid for once this session:** `ODYSSEY_SUN` has negative Z, so keying the
> massif off it makes its camera-facing flank back-lit (measured ndl 0.00 vs 0.67). Unifying
> is right, but the sun's *direction* must be re-solved against the hero composition, not
> adopted blind. This is an art solve with a measurable constraint, not a find-and-replace.

Analytic sky (Nishita/Hillaire-style single scattering plus a multiple-scattering
approximation) baked to an equirect LUT + SH irradiance + mip-based specular, re-baked only
when the sun moves appreciably. Analytic rather than captured because *the whole look hangs on
sun elevation*: one slider must drag horizon warmth, zenith gradient, ambient tint and direct
sun colour together.

Extend the ground-bounce solve to be **biome-aware** — ocean ~0.06, sand ~0.35, grass ~0.18,
snow ~0.85 — and iterate bake → project SH → recompute bounce three times. Ambient and shadow
colour then track the ascent automatically, which is what the 12 fog opt-outs and 3 authored
ramps were standing in for.

Use `scene.backgroundNode` and three's shipped `equirectUV()` rather than a manual skybox
mesh — removes a mesh, a material and a draw call versus the reference.

### 3.5 One atmosphere, medium-parameterised

`odysseyAerial(worldPos, litColour, medium)` — applied by **every** world material, lerping
air↔water on camera Y vs sea level, with separate extinction coefficients and a separate
inscatter source below the waterline. An air-only model cannot serve Ch2 and would re-fork at
the very first seam.

**API rule, adopted verbatim:** pass the **sky LUT into the node**, never a pre-sampled
colour. The correct inscatter colour depends on the extinction the function itself computes —
and the old signature is precisely what let seven materials each decide what "the sky here"
meant (§1.5's three competing ramps).

Firewatch's device is the cheapest way to make this read as *painted*: fog colour is a **1D
gradient LUT indexed by normalised camera distance** — one texture sample, and it is what
makes a flat-shaded world look hand-painted.

Three construction details worth copying, including the two mistakes the reference documents:
the near-field lookup must be tilted **up** (`viewDir + (0, 0.42, 0)`) and read from a
**blurred mip**, so short paths get the cool dome rather than the horizon band; the far limit
must converge on the **exact mip-0 sky sample the sky itself draws**, or the clipmap's far
edge draws as a hard silhouette at a fixed radius; and the Mie forward lobe must be **inside**
the crossfade, not added on top, or the horizon becomes a hard-topped white wall.

**Migration task:** the 12 `material.fog = false` opt-outs must flip to `fog: true` with an
aerial node that is *identity at their depth* — not stay opted out. `NodeMaterial.setupFog()`
only runs when `material.fog === true`, so leaving them false makes the large
silhouette-defining surfaces the ones that never receive the new atmosphere: the same
inversion that produced the measured 5.9× mismatch. Gate with a lint asserting **zero**
`material.fog = false` and **zero** `FogExp2` under `src/rendering/odyssey/`.

> `exponentialHeightFogFactor` **does not exist in r181** (it is r182+). Hand-roll the factor
> — about 30 lines of TSL.

### 3.6 Biome from world state, not chapter index

`biome(worldY, slope, wetness, curvature) → { grass, rock, snow, sand }`, **height-blended**
(not linearly lerped — linear splat blending is what makes transitions muddy). The snowline
becomes a world altitude, so it follows terrain instead of arriving because a counter
incremented. Curvature comes free from the aux bake's A channel.

### 3.7 PILLAR 7 (NEW) — footprint band-limiting

**Multiply every procedural layer by `1 − smoothstep(lo, hi, worldPixelFootprint)`**, fade
bands at ~`[wavelength/6, wavelength/1.5]`, using `dFdx`/`dFdy` of world position (both
exported by r181 TSL) and the clipmap's `effSpacing` varying.

This is the mechanism-level fix for the already-logged **"pixelated meadow"** complaint. It is
what MSAA and TAA both *fundamentally cannot do* — the signal is already wrong before it is
sampled. And it makes the shader **faster**, because most pixels early-out of most layers.

Compute the derivatives **once at graph top in uniform control flow** and thread them into
gradient-sampled fetches; WGSL forbids implicit-derivative sampling under non-uniform flow.
Carry a second **narrow-axis** footprint (min of the two axis lengths) for anything that must
not change appearance when the camera merely tilts.

### 3.8 Shadows (absent from the first draft entirely)

| Lane | Budget |
|---|---|
| 610M | **one** 1024² cascade over the near rings (~0.12 ms) + curvature AO from the aux bake |
| RTX | at most **two** 2048² cascades |

Three 2048² cascades is 12.58 Mpixel of depth per frame — on 4 ROPs that is 1.43 ms of pure
fill before any shading. Do **not** hand-roll per-cascade depth materials the way the
reference had to: r181 derives the shadow pass from the same NodeMaterial
(`positionNode` → `positionLocal`, with `castShadowPositionNode` as an explicit override).
Use the **non-morphed nearest height fetch** in the shadow path so shadows do not swim as the
clipmap morphs.

### 3.9 The colour script (absent from the first draft — and it is what makes it beautiful)

> *"'One world' is an ownership change with no art direction in it. Without this table the
> default outcome is one uniformly grey world."*

`src/rendering/odyssey/odyssey-colour-script.js` — 6–8 keyframes on `p`, each carrying a
5-slot palette (sky zenith, sky horizon, key/sun colour, ground-lit, ground-shadow) plus
exposure, fog density, fog-LUT id and wind strength. Interpolated in **Oklab**, uploaded once
per frame.

Two unit-testable invariants:

1. The far-plane colour at `t = 1.0` of every keyframe lands within **ΔHue ≤ 8°** and
   **ΔChroma ≤ 0.02** of one declared `HORIZON_ANCHOR` — Shadow of the Colossus'
   single-hue-convergence rule, which is what makes very different biomes read as one
   continent.
2. Hue change **≤ 12° per 0.05 of `p`**, except at declared occlusion seams.

### 3.10 Art-direction contract

From the games research, as checkable rules:

- **One persistent landmark that is a TERM IN THE HEIGHT FUNCTION**, never a separate mesh,
  with a deliberate exemption from full atmospheric wash so it never sinks into the sky. Its
  angular size must grow **monotonically** across the ascent (Journey never lets the mountain
  shrink).
- **Baton pass.** The ocean floor cannot see the massif, so one anchor cannot span Act II.
  Anchors hand over **only while both are visible in the same frame**: godray shaft → shore
  massif → summit → earth.
- **Anti-bullseye** (BotW): partially occlude the landmark so the player moves *around*
  something to keep seeing it. Triangular landforms at three scales — large (global
  landmark), medium (occluders, so you can surprise), small (rhythm, and they make the large
  ones read as large by juxtaposition).
- **One wind field** across every biome (Ghost of Tsushima) — grass, cloth, spindrift and
  cloud all agreeing is the strongest continuity signal after light direction, and it costs
  almost nothing.
- **Cloud banks that conform to terrain** as the transition device (The Pathless) — fog as a
  traversable object, not a post effect. This *is* the Ch5→Ch6 occlusion moment.
- **The glitter gate** (Journey's sand; ports 1:1 to snow): sample a Gaussian-distributed
  random normal G, `R = reflect(L, G)`, and **threshold** `dot(R, V)`. The cheapest way to
  make a texture-free surface look expensive. It aliases without TAA → **hard-off on the
  610M**.

---

## 4. What survives

- **The rail, the spline and its arc length** — 1767.58 u is load-bearing.
- **The persistent light rig** — one constant light set, always. Toggling `visible` on a group
  containing lights nulls `LightsNode._lightNodes` and forces a full pipeline re-resolve.
- **The level nodes and the board handoff.**
- **Compositions the user has praised**: the far-left flank and the Ch4 hero massif silhouette
  — authored *into* the height function and A/B'd against current captures.
- Chapters 1, 7, 8.

---

## 5. Waves

### 5.0 Wave tracker (authoritative)

Checked means: every item in the wave's section is verifiably in the code, `npx vitest run`
and `npx eslint` both pass, and where the wave makes a visual claim it is capture-verified.
Percentages are from the 2026-08-12 per-wave repo audit, which checked the code rather than
this document's own prose — several waves this file described as done were not.

- [x] **Wave −1** — Measure first — DONE 2026-08-12. Both lanes published to `reports/odyssey-perf/gpu-split-lane{a,b}.json`; p50/p99-only ring (`src/utils/perf-ring.js`, 12 tests); level-node A/B run on both lanes. Headline: **Lane B is 67.7 ms p50 against a 7.0 ms budget**. Documented caveats: the split is differential rather than per-pass (three r181 exposes one timestamp scope per render type), Lane B's 8.6 ms drift exceeds its own deltas, and One World times out in this harness so it has no number yet.
- [x] **Wave 0** — Stop the bleeding — **DONE (2026-08-12)**. All five sub-items landed; 0.2 closed in two parts (see below), with the residual 115.6 deg gap recorded as a deliberate non-convergence rather than an omission. 0.1 skirt chapter-weight fold (one-sided, test-covered, verified to fail without the fix), 0.3 alpine bridge + its dead export, 0.4 ground plates write depth (`DoubleSide` half rejected with evidence as a no-op), 0.5 conifer seating verified genuinely shipped. **BLOCKED: 0.2** — fully scoped (14 edits, 3 view-space sites found, `ODYSSEY_WORLD_SUN` imported by nobody so it is a third sun in waiting) but converging moves `ODYSSEY_SUN` **115.6°**, which puts Ch3's sun disc behind the camera and inverts the backlit foliage SSS. Per CLAUDE.md that needs a screenshot. Do not land it blind; do not give the disc its own azimuth to dodge it. **RE-SEQUENCED (post-boot-fix): captures work again, but 8 of the 14 scoped edits sit in surface-world.tsl.js / mountain-peaks.tsl.js — surfaces Waves 4/6 delete after the flag flip. 0.2 moves to AFTER the flip, when the surviving edit set is exactly its durable half: one canonical sun in chapter-profile.js, the Object.is one-sun invariant test, and ch6's sites.**

  **0.2 PART 1 LANDED (2026-08-12) — the 72.5° split is closed.** The flip re-scoped this
  item more than any edit did: `MOUNTAIN_SHADING.keyDir`'s only Odyssey consumers are
  `mountain-peaks.tsl.js` (ch4) and `surface-world.tsl.js` (ch3), **both suppressed by
  default**, so the user-visible half of "two suns" was resolved by shipping the world, not by
  this edit. `keyDir` now *aliases* `ODYSSEY_SUN` (identity, not a copied literal — a copy
  re-drifts, and drift is how the split appeared). Zero default-path visual change: all three
  winter callers pass explicit overrides, and `mountain-peaks.tsl.js:387` already *documented*
  its key as "`MOUNTAIN_SHADING.keyDir` / `ODYSSEY_SUN`" — the code caught up with its comment.
  Pinned by `tests/unit/odyssey-one-sun-invariant.test.js` (4 tests; 3 verified to fail with the
  old literal, the freeze test correctly stays green as it pins a different property).

  **0.2 PART 2 LANDED (2026-08-12) — all three named sub-items done, capture-verified.**

  *Re-solve one sun against the hero composition.* Done, and the measurement settled the
  question the plan could not. Driving the REAL controller over the REAL spline at 21 points
  across ch6 and converting the hero planet's fixed VIEW-space light to world space at each
  frame: the direction it actually represents rotates **11.2° end-to-end** (the terminator
  *swam* as you flew past), and its best fit `[-0.279, 0.185, 0.942]` sits **24.3° from
  `ODYSSEY_WORLD_SUN` but 130.1° from `ODYSSEY_SUN``**. The hero was hand-tuned by eye until it
  looked right — so **the eye had already voted for the world's sun**, independently of the
  spike. That is the corroboration the 115.6° convergence was missing. `ODYSSEY_WORLD_SUN`'s
  declaration moved into the import-free leaf `chapter-profile.js` (it was in
  `odyssey-world-renderer.js`, imported by nobody), the hero now reads it in **world** space,
  and playground capture measured the lit side rotating as predicted while mean luminance held
  at 139.9 → 139.7 — i.e. it joined the canonical sun without darkening the hero.

  *Fix the 3 view-space-normal sites.* Done — plus **two the audit misfiled**. The Ch3 meadow
  (`createLandscapeTSL`), the cabin, and the cloud-sea deck are converted. The audit's claim
  that "every other `normalView` use is view-normal-vs-view-vector Fresnel and is
  self-consistent" was wrong for the spruce and great-tree rims, which dot a view normal
  against a view vector built explicitly in WORLD space from `cameraPosition`. `normalView` is
  now entirely unimported in both files. The cloud deck was the one with a predictable
  consequence — a flat disc's world normal is a constant, so its "upward-normal × sun" term
  becomes the stable offset its name always implied — and a stashed before/after measured the
  deck at mean +0.29 / stdev −0.26 out of ~43: **structure fully retained**, camera-dependence
  gone. Ch3 and Ch4 captured clean; the one console warning (`Vertex attribute "normal" not
  found`, ×5) was verified **pre-existing** by re-capturing against a stash.

  **RESIDUAL, deliberately not converged.** `ODYSSEY_SUN` and `ODYSSEY_WORLD_SUN` remain 115.6°
  apart. On the DEFAULT path this no longer puts two lights in one composition: Act II (ch2-5)
  is the world, and everything still reading `ODYSSEY_SUN` — ch1 earth core (underground), ch7
  black hole, ch8 urban — shares no sky with it. Converging further would relocate visible sun
  discs in the *fallback* chapters for no default-path gain, which is the blast radius that
  blocked this item originally. Ch6's asteroid garland keeps its view-space key **on purpose**
  (tumbling debris: "always shows form" beats "anchored"); that is now documented at the site
  as an exception rather than the house style, since its comment used to cite the hero planet
  as precedent and the hero has moved.
- [x] **Wave 1** — The spike — DONE 2026-08-12. Gate items: ≤4 draws (measured 1 draw for the ground, 3 for ground+water+sky, commit 59267c08); clean console + screenshot-verified (same commit); and the **GPU-time split on both lanes** now exists (`reports/odyssey-perf/gpu-split-lane{a,b}.json`, Wave −1) and it did what the gate asked: it **killed the §8 Lane B budget** (67.7 ms p50 vs 7.0 ms — the budget was a hypothesis and it is falsified, decisively). The in-game measurement supersedes a playground-spike split — it answers the same question about a strictly more real frame.
- [x] **Wave 2** — Height field + aux bake + colour script — DONE 2026-08-12. Height field (48 tests), Oklab colour script (23 tests, both invariants biting), aux bake with curvature in the A channel (capture-verified). The `.level(0)` lint now exists (`odyssey-world-lints.test.js`): a source-scan with one-hop dataflow through same-file `const`s — needed because the cloud billow's vertex-stage read feeds `positionNode` through an intermediate — mutation-verified to FAIL when a `.level(0)` is removed. Two spec items amended by measurement, not skipped: **relief stays 1024²/768²** because the bakes already measure ~400–416 ms against the §8 400 ms budget and 2048² quadruples exactly that work for detail the footprint gate would fade at range anyway; **the fog-LUT id is void** because Wave 4's LUT pillar was itself deleted by measurement — there is no fog LUT to identify.
- [x] **Wave 3** — Swap the ground in; re-seat every prop — **DONE 2026-08-12**. One World is the DEFAULT path for chapters 2-5; `?odysseyOneWorld=0` (or `options.oneWorld === false`) reverts to the dioramas, and the build stays inside a try/catch that undoes suppression if the world throws. Verified in-game with NO flag: ch4 boots, 7 frames. Act II capture-verified chapter by chapter (2, 3, 4, 5) plus the 5->6 seam handing off into Ch6's cosmos. Props: level orbs seated on `heightAt` (measured: zero lifts needed, the seat is a safety net), Ch2's caustics and god rays ported, cumulus/strata/cloud-sea replaced by the one deck, alpine surface language ported (snow-line FBM jitter + slope gate + alpenglow). Corridor field suppressed for Act II, world in the prewarm pool, 4 policy tests pin the default and its escape hatch.
  - **MEASURED AT LAST (2026-08-12, Lane A, 1920x1080, chapter 4 station):** One World
    **0.39 ms p50 / 53 draws** against the legacy dioramas' **1.97 ms / 132 draws** — a
    **1.57 ms saving, 5x cheaper, with baselineDrift EXACTLY 0.00 ms**. The rebuild does not
    cost frame time to buy cohesion; it is the single largest GPU saving measured in this
    plan, and against §8's 6.9 ms Lane A budget it returns 23 % of the frame.
    Two harness bugs had to be fixed to get a number that means anything, both of which had
    produced confident nonsense first: the split sampled the board where it PARKS (journey
    start, Act II off-screen, 40 draws / 0.13 ms — a delta of an empty frame), so it now seeks
    to `--seek 0.42`; and once Wave 3 made One World the default, the old `one-world`
    configuration was comparing the default against ITSELF — a guaranteed zero that would have
    read as "the rebuild is free". The comparison is now against `?odysseyOneWorld=0`.
  - CARRIED FORWARD, not silently dropped: region-based camera-distance streaming is still the single hard-coded 1,450 u forest gate, and **One World has no GPU-time number**. The gpu-split harness now boots it, but it measures the board where it PARKS — journey start, 40 draws, 0.13 ms, Act II off-screen — so the delta would be measuring nothing. Seeking the camera to Act II progress before sampling is the prerequisite, and it belongs to Wave 7.
- [ ] **Wave 4** — Delete the canonical chain and `rangeAuthority` — **RESCOPED BY AUDIT (2026-08-12): the premise was FALSE.** A 13-agent audit (4 inventories, 8 adversarial verifiers, 1 synthesis) tested this wave's core claim — "code only the `?odysseyOneWorld=0` fallback reaches" — and **all eight verification passes refuted it.** See §"Wave 4/6 deletion manifest (audited)" below for the full accounting. The headline corrections:
  - `shared/mountain-language.js` (575 LOC) is consumed by the SHIPPED **winter theme** (`winter-theme.js:70-74` imports `mountainCpuDisplacement`/`mountainColorNode`/`resolveMountainTreatment`, called at :174/:181/:195) plus three live playground effects and the one-sun invariant test. **Permanently out of scope**, independent of any hatch decision.
  - `shared/canonical-mountain-range.js` (273 LOC) is in the **production bundle** (`vite.config.js:131` registers `playground.html` as a rollup input; `dist/` contains `ch4-center-hero`). Five live playground effects reach it — `ch3-ch4-seam`, `ch4-mountain-peaks`, `ch5-sky-drift` EXECUTE the real chapter builders (so the "suppressed" chapter call sites at `surface-world.js:1502` / `mountain-peaks.js:303` / `sky-drift.js:335` are live after all), and `seam-34-landscape` / `ch3-surface-world` import it directly. The LIVE world's own guards depend on it too: `odyssey-world-height.test.js:13,22` derives the `ODYSSEY_MASSIFS` expectations from `getCanonicalMountainRangeWorldSpecs` (the only executable link between the shipped silhouette and the height field), and `odyssey-path-layout.test.js:58-84` is the repo's only rail-clearance guard. Deleting the module as scoped **breaks `vite build`**.
  - `rangeAuthority` is the one part that IS safe: sole writer `ChapterEnvironmentManager.js:1225-1263` (39 lines), sole read `surface-world.js:1812` — but only the narrow token removal there (`&& element.userData.rangeAuthority !== false`); the 13-line block :1803-1815 must stay because `ch3-ch4-seam.effect.js:124` needs the visibility write.
  - Real totals: as-planned engine code **495 lines**; with the playground/test churn the plan omitted, **681 lines across 13 files** — of which only ~44 are deletable today.
  - Path forward (Tranche 2 of the manifest): flip the spec authority — move the 4 canonical peak specs into `world/` as the world's own frozen table, rewrite the two live tests against it, THEN the TSL builder half of the module is deletable once the playground effects' fate is decided (owner call).
- [x] **Wave 5** — One atmosphere + one sky — **DONE (2026-08-12)**, and the remaining item turned out to be hiding a LIVE bug. (~50 % before: fog ownership and the one sky landed early; **the fog lint now exists** — `odyssey-world-lints.test.js` pins the opt-out list to the material constructor list, mutation-verified, so a sixth world material cannot ship half-fogged. Remaining: migrate the 12 legacy chapter fog opt-outs to the one-atmosphere scheme — blocked on captures, i.e. on the reboot.)

  **Closed by extending the lint instead of doing the migration — because the migration's
  premise had gone stale and an audit found a real defect.** The remaining task read "migrate
  the 12 legacy chapter fog opt-outs to the one-atmosphere scheme". Auditing them first: ch2-5
  are suppressed (fallback-only, same category as Waves 4/6), ch1 Earth Core is an enclosed
  magma cavern at fogDensity 0.014 where the fog IS the look, and ch7/ch8 already opt out at
  environment level. So the migration would have refactored correct or dead code.

  What was actually missing was the guard. `odyssey-world-lints.test.js` pins fog opt-out for
  the WORLD's five materials by matching the opt-out list to the constructor list; nothing
  covered the chapters that still draw. Those opt out by bulk `group.traverse`, which is a
  different failure shape — a traverse only covers what is parented WHEN IT RUNS — so the
  guard has to walk the built environment, not the source. `tests/unit/odyssey-chapter-fog-optout.test.js`
  does that for ch6/7/8, plus a non-vacuity check so a broken traversal cannot pass silently.

  **It failed on first run: ch6 Space, 17 far-range surfaces still fogged.** The summit-earth
  fix had disabled fog on the planet ANCHOR and stopped there. Everything else in the chapter
  kept scene fog on, including the chapter's hero: the accretion disk and lensing shell sit
  2020 u out, which FogExp2 saturates **77 % at Space's own density 0.0006** — and the
  early-ignite path deliberately makes this chapter drawable across the Ch5 summit, where
  density 0.0022 saturates the same distance to **100 %**. Ch6's fog colour is near-black
  (0x05060f), so the symptom was a hero rendering at roughly a quarter of its authored
  brightness rather than a pale wash — which is likely why it survived a capture review, and
  is consistent with the standing "green aurora carry washes early Ch6" note.

  Verified by reproducing the in-game condition rather than trusting the arithmetic: the
  playground has no `scene.fog` at all (exactly why this class of bug hides there), so the
  board's FogExp2 was injected into the live playground scene and the 37 materials toggled.
  Scene mean luminance **29.08 fogged → 37.96 opted out, +30.6 %**, while p99 moved only
  +1.8 % — the distance-weighted signature: far nebula, dust, galaxy and void stars were
  losing a third of their light while the near/additive core was unaffected.

  Residual: the ad-hoc opt-outs inside the suppressed ch2-5 modules stay as they are, tied to
  the same hatch-retirement decision as Waves 4 and 6.
- [ ] **Wave 6** — Transitions become occlusion — **RESCOPED BY AUDIT (2026-08-12): "delete the ecotone machinery" would break three LIVE chapters.** Same 13-agent audit as Wave 4; both verification lenses refuted the "fallback-only" claim. The corrections:
  - **The count was counting the wrong thing.** "46" is the occurrence count of the *comment string* "ecotone crossfade bridge" (two are prose, four real bridges are uncommented). The actual construct — `material.uniforms = { uOpacity }` — appears **48 times in 8 files, and 34 of the 48 (71 %) are in chapters that still draw**: ch1 earth-core ×17, ch7 black-hole ×7, ch8 urban-dreams ×10. Only ch2 deep-ocean's 13 (+1 shared-water, which the live `odyssey-unified-water` effect drives itself) are fallback-only.
  - Deleting the live bridges would make ch1/ch7/ch8 **snap on and off** at the 1-2, 6-7 and 7-8 boundaries — r181 makes `material.opacity` a dead write on any material with an authored `opacityNode` (this repo's 4×-recurring trap); the bridge IS the crossfade. Guarded by `earth-core-environment.test.js:100-119` and `urban-dreams-environment.test.js:20-21`, which stay.
  - The consumer machinery is live **every frame**, not fallback code: `_collectOpacityTargets` (`ChapterEnvironmentManager.js:581`), `setGroupOpacity` (:1307), the ecotone apply block :1112-1144 with its ch6 fade-in special case (`boundaryId === '5-6'`), and the director-side colour lerps — the director is unconditional (`OdysseyBoardController.js:864/:1750`; `?odysseyAAA=1` gates only diagnostics).
  - `SEAM_56_AURORA_BRIDGE` (`seam-bridges.js:37-43`) is live **and visible**: the One World fog handoff weight is zero at the act edges (`OdysseyBoardController.js:2434-2437`), so at 5→6 the bridged fog/clear colour is exactly what the player sees. The 3-4 and 4-5 colour windows are the genuinely stale part (overridden mid-act where the world's fog weight is 1) and can go alone — with one capture at those progress bands, since they still write `scene.fog`.
  - Deletable today without any owner decision: **~50 lines** (ch2's 13 bridges, the dead `ECOTONE_*` tuning constants + `resolveEcotoneHalfWidth` clamp arithmetic — computed half-widths 0.00616–0.01628 all lose to `seamWidth` at :201 at all seven boundaries — and the ch2 test block). The other ~585 inventoried lines belong to chapters One World never replaced and are **permanently out of scope**.
  - The constructive half (the occlusion moments: the ch1→ch2 dive, the ch5→ch6 cloud bank) remains unbuilt; deleting bridges before building them would leave the two real act boundaries with nothing.
- [ ] **Wave 7** — Perf, tiers, residency, rail furniture — **20 %, and the headline question is ANSWERED (2026-08-12).** Lane A: One World 0.39 ms vs dioramas 1.97 ms at **zero drift** — 5x cheaper, 23 % of the frame budget returned. Lane B (Radeon 610M, 1280x720, Medium, ch4 station): **One World 4.19 ms p50 vs the dioramas 39.52 ms** — the rebuild is worth roughly **30–35 ms on the iGPU**, which is the difference between ~25 fps and unplayable.
  - **READ THE DRIFT BEFORE CELEBRATING.** Lane B's bracketing baselines disagree by **5.44 ms** (4.19 -> 9.63 for the identical configuration), so the iGPU is thermally unstable across a 3-configuration run. The SAVING survives that easily — 35 ms of signal against 5 ms of drift — but the absolute figure does not: **it is NOT established that One World is inside §8's 7.0 ms p95 budget.** The second baseline's p95 was 9.83 ms, above it. The honest claim is "between 4 and 10 ms p50, versus 40 ms before", and pinning it down needs a cooled machine and repeats.
  - **§8 IS NOW IN THE GATE (2026-08-12).** `perf-budgets.json` carries three world cells and `perf-budgets-gate` exits 0 on them: `odysseyWorldGpuP50LaneAMs` (baseline 0.39, max 1.5 — a real baseline because Lane A drifted 0.00 ms, and a max set BELOW the dioramas' 1.97 ms at the same station so the gate also fails if the rebuild is ever reverted by accident), `odysseyWorldDrawCallsLaneA` (53 against the dioramas' 124 — the structural claim of the rebuild, which regresses in exactly one way: chapter environments creeping back into Act II), and `odysseyWorldGpuP50LaneBMs` with a **deliberately null baseline** and max 7.0, because a 4.19 pinned from a run that then measured 9.63 would be exactly the false precision this file exists to prevent. The lint was mutation-checked: a `"TBD"` in any budget cell fails it.
  - Still owed for the wave proper: ribbon streaming, the rail-furniture re-budget (55 orbs x 3 nested transparent shells), real quality tiers for the shipped chapters, per-tier Lane B prohibitions, and MSAA per lane.


### Wave −1 — Measure first (blocking; nothing else is trustworthy without it)

Instrument the **current** scene with `renderer.trackTimestamp = true` and
`await renderer.resolveTimestampsAsync('render')`; publish a GPU-time split (scene / shadow /
post / bloom) for **both lanes** into `reports/odyssey-perf/`. Include a **hidden-vs-shown A/B
of the level-node group** — 55 × 3 nested transparent spheres is the most likely 610M
bottleneck and has never been measured.

Measurement discipline as an exit criterion: **median and p99 only, never mean**; fixed-size
ring buffer, recompute throttled to ~4 Hz, zero allocation in the render loop; draw calls
latched once per frame from `renderer.info.render.drawCalls`.

#### What Wave −1 actually found (2026-08-12, Lane A)

The instrument: `src/utils/perf-ring.js` (fixed ring, p50/p95/p99, **no mean**, 12 tests),
`?odysseyGpuProfile=1` on the board so a measurement run no longer has to enable the debug
overlay and then measure a frame with the overlay in it, `?odysseyHideLevelNodes=1` +
`LevelNodeManager.setAllVisible()` for the A/B, and `scripts/odyssey-gpu-split.mjs` publishing
into `reports/odyssey-perf/`. The perf session and its comparison now report
`drawCalls.p50/max` instead of `drawCalls.avg`, and `summarizeValues` gained p99.

**The split is differential, not per-pass, and the plan should stop asking for per-pass.**
three r181's WebGPU backend exposes one timestamp scope per render type and `PostProcessing`
renders its whole graph in a single call, so there is nowhere to hang a scene/shadow/post/bloom
query without forking the renderer. Each configuration removes one system instead.

**Measure the lane the budget is written against.** The first runs used 1280×720 and every
configuration's p50 landed within one tick of each other — because the GPU timer quantises to
**65.536 µs** and the whole scene was ~1.0 ms, so the entire split sat inside the noise floor
and `baselineDriftMs` equalled every "finding". At the specified 1920×1080 the same
measurements separate cleanly.

| configuration | p50 | p99 | draws |
|---|---|---|---|
| baseline | 2.88 ms | 4.59 ms | 140 |
| no-bloom | 2.10 ms | 2.88 ms | 132 |
| no-level-nodes | 2.16 ms | 3.28 ms | 132 |
| baseline-repeat | 2.95 ms | 3.60 ms | 126 |

`baselineDriftMs` is **−0.066 ms — exactly one timer tick**, so this run's deltas are signal:

- **bloom ≈ 0.79 ms (27 % of frame GPU time)**
- **level-node group ≈ 0.72 ms (25 %)** — the plan's "most likely 610M bottleneck", measured
  at last, and on Lane A it is the second-largest single item in the frame.

An earlier 1080p run put both at ~1.70 ms and showed them as *identical*, which suggested the
orbs were simply what bloom was working on. This cleaner run does not support that: 0.786 and
0.721 are close but distinct, and that run's `no-bloom` p99 had risen *above* baseline, which a
shed pass should never do. The tidier hypothesis was an artefact of a bad run; two systems,
two costs.

Not measured: the two One World configurations timed out waiting for `boardController.isActive`
in this harness, on every attempt. The world boots fine under the chapter-capture harness, so
this is a harness readiness bug rather than a boot failure, and it means **One World has no
GPU-time number yet** — the earlier 720p run's −0.13 ms was inside the noise floor and should
not be quoted.

Still owed: the Radeon 610M lane. #### Lane B (AMD Radeon 610M, rdna-2, 1280×720, Medium) — the number that changes the plan

| configuration | p50 | p99 | draws |
|---|---|---|---|
| baseline | 67.70 ms | 88.21 ms | 122 |
| no-level-nodes | 71.70 ms | 83.49 ms | 114 |
| baseline-repeat | 76.28 ms | 87.16 ms | 122 |

**§8's Lane B frame budget is 7.0 ms p95. The measured baseline is 67.7 ms p50 — an order of
magnitude over, at ~14 fps.** The entire Lane B column of §8 was datasheet arithmetic; the plan
called it "a hypothesis to falsify in Wave 1". It is now falsified, and not marginally.

Two disciplines this run enforces on itself:

- **No per-system attribution is possible from it.** `baselineDriftMs` is 8.6 ms — baseline
  drifted from 67.7 to 76.3 across the run — which is *larger* than the level-node delta
  (−4.0 ms, itself negative). On this part, under this load, nothing smaller than ~9 ms can be
  told from thermal drift. The level-node A/B is therefore conclusive on Lane A (0.72 ms, 25 %
  of frame) and **inconclusive on Lane B**, which is the lane the question was asked about.
- Only three configurations were run, and deliberately: CLAUDE.md records that long WebGPU
  sessions have TDR-crashed this machine's iGPU, so `--only` bounds the exposure.

What this means for the waves after it: Wave 7 cannot be a tuning pass. A 10× gap is not closed
by shedding a cascade or an octave — it is closed by the Act II draw/material collapse this
whole rebuild is for, plus a genuinely reduced Lane B tier, and it must be re-measured here
rather than reasoned about. It also means **One World's own Lane B cost is now the single most
valuable unknown in the plan**, and the harness cannot currently measure it (below).

#### RESOLVED (2026-08-12, 09:5x): the boot stall was a three r181 codegen bomb in the world's own shaders

The night's three root-cause theories (commit regression, hardware degradation, GPU selection)
were each disproven by their own experiment; the real mechanism was found by bisecting the
playground's frozen load per mesh with the new `?worldOnly=` lever: **sky 0.02 s, clouds
0.03 s, forest 0.02 s, ground 26.8 s, water 129.3 s** — ~156 s of synchronous main-thread
JavaScript on EVERY load, while the emitted WGSL stayed ~6 KB. three r181's node builder
re-walks shared subexpressions once per reference, straight through Var and Varying nodes
(measured: `.toVar()` inside the fold changed nothing), so the massif smooth-max fold
expressed in TSL and referenced five ways from the water fragment multiplied into minutes.

Fix: `bakeMacroTexture()` — [macro, weight, dMacro/dx, dMacro/dz] in one 512² RGBA16F
texture; the analytic `tslMacro`/`tslWeight` are deleted with a tombstone. Full world:
**first render 155.5 s → 0.05 s; page to ready 1.1 s.** Captures visually identical.

In-game validation (the command below): **One World boots — `ready`, 7 frames, High/WebGPU.**
The stall grew past the harness readiness windows as the graph gained references commit by
commit, which is why the "last known-good commit" also stalled and every environmental theory
half-fit. The elimination table below is kept as a record of how three wrong theories were
each falsified by measurement.

**First post-fix Act II sweep (in-game, One World on): ALL FOUR CHAPTERS BOOT.** Ch4 verified
good. Ch2 boots — the underwater body reads correctly and the breach-to-shore frame (beach,
forest, massif in mist) is the continuity payoff in one image; the water volume is sparse
until the god-ray/caustic port the prop inventory scoped. **PORTED and in-game-verified later
the same day (65124e46):** caustics as a zero-draw term on the submerged shelf, god rays as
one InstancedMesh seated from caller-supplied railSamples, leaning 23° toward the canonical
sun's azimuth (full alignment laid them sideways — refraction keeps real shafts steep; no
private azimuth was invented). The hard shaft edges the first in-game run showed are FIXED and
re-verified: the ported `abs(uv.x - 0.5)` feather was on the wrong axis — a cone's `uv.x` runs
around the CIRCUMFERENCE, so it lit one side and left a seam, which the grade turned into solid
triangular wedges. Replaced with a FACING fade (a shell standing in for a volume must dim where
it is seen edge-on, because the grazing angle *is* the silhouette) plus a 14–85 u near fade,
and slimmer/more numerous cones. Now soft columns with caustic shimmer, in both playground and
in-game captures. Ch3 verified this morning. Ch5 boots (the
first time ever) and the continuity payoff is visible — valley, shore and forest far below the
climb — but the **cloud deck is broken at eye height in-game**: ragged navy shards instead of
white strata (sky luma 178.8 vs 129.4 target). The rail crosses the deck's altitude through
Ch5, so the camera sees paper-thin billowed geometry edge-on, and the in-game grade drives the
deck's base colour toward saturated navy that the playground (no post stack) never showed.
Deck fixes landed and capture-verified (three iterations, each against a real Ch5 run):
horizon-leaning base colour (the shadow-tint-dominated base graded to NAVY in-game — same
lesson as the ground palette: the world hands the grade a brighter, flatter colour than it
wants on screen), a 60–240 u eye-distance near fade (underfoot the deck now reads as mist with
the valley through gaps), and a 40–200 u altitude-band fade (a horizontal corridor through the
layer while floors above/below stay solid). Sky luma 178.8 → 98.7 against the 129.4 target.

Both remaining levers landed: the billow is now multiplied by a vertex-stage estimate of the
same coarse density that decides where the holes are, so the surface sinks back to the flat
deck plane exactly where it is about to go transparent (edges dissolve instead of tearing);
and the alpha edge is footprint-widened — but only a LITTLE. The first attempt lifted the band
to 0.22 at range, which stopped anti-aliasing the edge and started *making* it: partial
coverage everywhere turned distant broken cumulus into a translucent overcast veil across the
whole sky. 0.06 + up to 0.05 keeps the cumulus discrete.

**NaN TRAP, third occurrence in this repo:** the ported Ch2 caustic used `pow(x, 4.0)` where
`x = (noiseA + noiseB) * 0.5 + 0.5` — two summed gradient noises CAN dip below −0.5, and
`pow()` with a negative base and non-integer exponent is UNDEFINED in WGSL. The result was
black blobs scattered across the terrain, including ABOVE the waterline where the term is
gated off, because `NaN × 0` is still NaN. Clamped before the pow, and the same guard applied
to the god-ray shimmer, which had the identical shape. Watch for this in every ported noise
term.

**LESSON, plan-wide:** CPU-expressible terrain math goes in BAKES, not TSL graphs. A TSL
expression with high fan-out referenced through varyings is a build-time bomb in r181, and
`.toVar()` does not defuse it.

#### Known harness limitation

**One World still has no GPU-time measurement on either lane, and the harness — not the world —
is why.** Two hypotheses were tried and both were wrong in an instructive way:

1. *Readiness window too short.* Without `odysseyCaptureChapters` the board creates and warms
   all EIGHT chapters before `isActive` flips, and One World is the heaviest boot, so it was
   plausibly losing that race against a cold shader cache. Fixed: every configuration now loads
   only the Act II window (3,4,5) and waits 240 s. The baseline got faster and still measures
   (p50 1.11 ms, 131 draws). **One World still never reports.**
2. *It just needs longer.* No. With a 320 s per-configuration `Promise.race` guard in place, the
   run blew through that too without printing the timeout row — so the Electron MAIN process is
   blocking, not merely the page. Most likely the abandoned `executeJavaScript` from the losing
   promise keeps the window alive and wedges the loop. Electron stays alive burning ~140 s of
   CPU throughout, so the renderer is grinding rather than crashed.

The world boots fine under `odyssey-chapter-capture.mjs`, which is the evidence that this is a
harness defect. **Next attempt should drive the measurement from the capture harness** (which
already knows how to bring One World up) rather than adding a fourth timeout to this one.

The 720p run's −0.13 ms sat inside a 0.066 ms noise floor and must not be quoted as a result.

### Wave 0 — Stop the bleeding (ship first, unconditionally)

| # | Change | Fixes |
|---|---|---|
| 0.1 | Fold `chapterOpacity` into Ch3's alpine/skirt alpha | the 27.7 %-of-frame one-frame pop |
| 0.2 | Delete `MOUNTAIN_SHADING.keyDir`; re-solve one sun against the hero composition; fix the 3 view-space-normal sites | the 72.5° sun split |
| 0.3 | Delete `SEAM_34_ALPINE_BRIDGE` | a 3.0× luminance dip between identical endpoints |
| 0.4 | `depthWrite: true` unconditionally; `DoubleSide` **only below the waterline** | "see through the bottom of the hills" |
| 0.5 | Seat the conifer belt on the heightfield | trees buried 26 u / floating 16 u |

> 0.4 amended: `DoubleSide` on the whole plate doubles rasterised fragments on a 4-ROP GPU,
> on a surface Wave 3 deletes. `depthWrite: true` is free and is most of the fix.

**0.2 SCOPED, NOT APPLIED (2026-08-12) — blocked on a capture, deliberately.**

Confirmed numerically: `MOUNTAIN_SHADING.keyDir = [0.5, 0.8, 0.5]` and
`ODYSSEY_SUN = [0.35, 0.62, −0.70]` are **72.48° apart** (elevation 48.5 vs 38.4, azimuth
45.0 vs 153.4). Every alpine surface keys off the first, everything else off the second.

The 3 view-space sites are identified — a view-space normal dotted against a WORLD light, so
the lighting swims as the camera yaws: `surface-world.tsl.js` `createLandscapeTSL` (the Ch3
meadow, largest by screen area), `surface-world.tsl.js` `createCabinTSL`, and
`mountain-peaks.tsl.js`'s cloud-sea deck (a flat disc, so its view normal is a single
per-frame value and the whole deck re-lights globally as you turn). Four sibling sites were
already converted to `normalWorld`; these three were missed. Every other `normalView` use
under `src/rendering/odyssey/` is view-normal-vs-view-vector Fresnel and is self-consistent.

Also found: `ODYSSEY_WORLD_SUN` is exported and imported by **nobody** — today it is a third
sun in waiting. Convergence means moving the declaration into the import-free leaf
`chapter-profile.js` and aliasing `ODYSSEY_SUN` to the same frozen array, so
`Object.is(ODYSSEY_SUN, ODYSSEY_WORLD_SUN)` becomes a testable one-sun invariant.

**Why it is not applied yet.** Converging moves `ODYSSEY_SUN` by **115.6°**, and that is not a
shading tweak — it relocates every visible sun artefact. Ch3's sun-disc billboard sits at
`sunDir * 900` and would move to world (−414, 324, 549): *behind* a camera looking down −Z. The
sky-dome sun core, the Mountains sun disc and Ch5's sun-glow group all follow it out of frame.
The backlit foliage SSS inverts (it is `pow(clamp(dot(sunDirN, viewDir)))`, which collapses
toward 0 with the sun behind the camera), taking the authored golden Midsommar rim with it. The
alpine key itself drops from 48.5° to 25.2° elevation, so snow darkens and alpenglow weakens.

That is a real trade the spike made consciously — relief that casts beats a visible disc — but
it must be seen, not reasoned about, and CLAUDE.md is explicit that WebGPU/TSL work is not done
without a screenshot. Tonight's capture harness is wedging on Odyssey boots, so applying 14
edits with that blast radius and no verified frame would be exactly the mistake this plan was
written to stop. **The tempting shortcut — giving the sun disc its own azimuth — is the disease
coming back.**

One gap worth closing regardless: no test anywhere asserts a sun value. Grepping `tests/` for
`lightDir`, `ODYSSEY_SUN` or `sunDir` returns nothing, which is why two suns could ship at all.

**0.4 DONE (2026-08-12) — and the symptom it was written for has a different cause.**

Applied: the Ch3 meadow plate (`surface-world.tsl.js`) and the Ch4 snow-floor apron
(`mountain-peaks.tsl.js`) now write depth, each paired with `alphaTest = 0.04`; and the Ch3
foothill skirt's per-frame `depthWrite = false` override (`surface-world.js`) is gone — it was
switched off whenever `surfaceOpacity < 0.98`, and that expression is
`smoothstep(probeY, waterSurfaceY − 12, waterSurfaceY + 2)`, i.e. off for exactly the window
in which the camera rises through the waterline. The one surface carrying the eye out of the
lake stopped occluding at precisely the moment the report describes.

The `alphaTest` is not decoration. `opacityNode` is exactly zero across the whole submerged
shelf and the outer rim melt, so a depth-writing plate without a discard would stamp an
unseeable depth mask over the lake bed and cull the shoreline props behind it.

**The `DoubleSide` half was rejected with evidence, not skipped.** After the `alphaTest`, it
is a strict no-op: the only camera-facing terrain backface is the submerged shelf underside,
where every fragment is already discarded, and a heightfield has no overhangs.

**And the honest part: none of this restores the hill bottoms.** They are deleted on purpose by
`landAlpha` — `smoothstep(waterShelfFadeMin = −2.6, waterShelfFadeMax = 0.9, worldY − waterLevel)`
(`surface-world.tsl.js`, constants ~:213-215). Every terrain fragment more than 2.6 u below the
waterline is alpha ZERO. No depth or face-culling change can bring back geometry that the
shader is discarding. If "the hills no longer end at the waterline" is the acceptance criterion,
the lever is `waterShelfFadeMin/Max`; the only test on them pins their SIGNS
(`surface-world-environment.test.js:127-128`), so e.g. −6.0/−1.5 is free — but it is a visual
change and needs a capture, so it is its own line rather than smuggled in here.

### Wave 1 — The spike (playground; zero repo risk; falsifies the budget)

`src/playground/effects/odyssey-clipmap.effect.js`. **Proof gate:** ≤ 4 draws for
ground + water + sky + range; clean console; screenshot-verified; and a **GPU-time split on
both lanes** that either confirms or kills the §8 budget.

### Wave 2 — Height field + aux bake + **2a: the colour script**
### Wave 3 — Swap the ground in; re-seat every prop on the CPU mirror
### Wave 4 — Baked range LUTs; delete the canonical chain and `rangeAuthority`
### Wave 5 — One atmosphere + one sky; migrate the 12 fog opt-outs; add the lint

**Landed early, because nothing downstream could be judged without it.** The world looked
right in the playground and pale-grey in-game, and the cause was not the palette, the
exposure or the post stack: the board sets `scene.fog = FogExp2(...)` and
`ChapterEnvironmentManager` rewrites its colour and density **every frame from the chapter
profile**. FogExp2 is `1 − exp(−(d·z)²)`; the world's sky dome sits 3,600 u out, which is
~100 % saturated at every density the chapters use. The colour script had never once been
visible in-game, and the ground was being fogged twice — by `applyAerial` and again by a
chapter that no longer draws anything.

Two halves, and both are needed:

- The world's four materials set `fog = false`. They carry their own aerial perspective.
- The world **drives** `scene.fog.color`/`.density` and the clear colour for everything it
  does *not* draw — path ribbon, level orbs, traveller — ramped over the first and last 6 %
  of Act II so chapters 1 and 6 still hand over without a step. `applyAerial` is
  `1 − exp(−K·z)` and FogExp2 is `1 − exp(−(d·z)²)`; they are made equal at
  `FOG_MATCH_DISTANCE = 1200` via `d = sqrt(K / 1200)`, so one curve describes the whole frame.

This is the third time this trap has cost a session (the painterly-ascent sky dome, the Ch6
summit earth, and now this), which is what the planned lint is for: a material drawn beyond
~1 km in the Odyssey scene that has not opted out of scene fog is almost always a bug.

### Wave 6 — Transitions become occlusion; delete the ecotone machinery

### Wave 4/6 deletion manifest (audited 2026-08-12)

A 13-agent audit (4 parallel inventories → 8 adversarial verifiers, two independent lenses
per target, instructed to REFUTE → 1 synthesis) established what these waves would actually
delete. **All eight verification passes returned `refuted`**: every target has consumers on
the default path. The tracker entries above carry the per-wave corrections; this section
records the combined accounting and the decision structure.

**Combined as-planned cost** (hatch retirement + both waves, de-duplicated): **12 files
deleted, 42 edited, ≈2,994 lines** — of which the engine-code core is exact (Wave 4 = 495,
Wave 6 = 635, together 1,130) and the ~547 doc/report lines are reference-hit counts, not
measured removals.

**The safety finding that changes the decision.** The fallback has TWO entrances, and the
plan only ever knew about one. Besides `?odysseyOneWorld=0` there is a **flagless runtime
crash-catch** (`OdysseyBoardController.js:655-660`): if `createOdysseyWorld()` throws — a
TSL compile failure on some driver, a bad asset — the catch clears `suppressedChapters`
BEFORE the chapter-creation loop at :714-716, so a completely default boot still gets a full
world via the dioramas. The ordering was verified, and `createOdysseyWorld` is synchronous so
the throw is genuinely caught. After retirement + deletion, that failure becomes a **silent,
self-consistent void**: `this.oneWorld` stays null, every consumer is null-guarded
(:796/:1787/:2345/:2410/:2434), boot completes, the ribbon/orbs/traveller/atmosphere-dome
still draw — and chapters 2–5 have no ground and no sky for two thirds of the journey. Orbs
revert to raw spline positions, so nothing even looks broken in a smoke test. (The catch is
also narrower than its comment claims: deferred work — asset loads, `compileAsync` — already
escapes it.)

**Hard contract blocker:** `chapter-registry-consistency.test.js:29,33,48,60-63` +
`odyssey-gpu-gate-coverage.test.js:39-49` chain the registry → `odyssey-webgpu-validation.mjs`
→ the pilot. The four diorama modules must survive at least as export-shaped stubs, or four
tests and two harnesses are reworked in one commit. Also lost with the hatch: the
`legacy-dioramas` configurations in `scripts/odyssey-gpu-split.mjs:60-74`, which make the
1.97 ms / 39.52 ms diorama baselines behind three `perf-budgets.json` cells reproducible.

**Tranche 1 — DONE (2026-08-12, commit `77d19fba`).** `rangeAuthority` deleted (manager
block + the narrow token edit only — the surrounding visibility write stays, the
`ch3-ch4-seam` playground effect drives it every frame). The `ECOTONE_*` tuning deleted
after verifying against the LIVE registry layout that its span-derived half-width loses to
the `seamWidth` floor at all seven boundaries (computed 0.00616–0.01628 vs seams
0.018–0.06) — the window has always been exactly the seam, so the function now says so.
The 3-4/4-5 colour windows deleted from the MANAGER only, where every write is a proven
dead store (fog overwritten the same frame by the One World drive at mid-act weight 1;
sky/ambient skipped wholesale by the `atmosphereOwned` early-return, and nothing in `src/`
passes `cinematicJourneyActive:false`). **Scope divergence, recorded not papered over:**
the DIRECTOR's copies were KEPT — the audit's own table marks the director LIVE (it feeds
the OdysseyAtmosphere rig), and the capture the manifest asked for does not exist yet (the
gpu-split harness has `--seek` but no frame capture). Ch2's 13 bridges deferred with them.

**Tranche 2.1 + 2.2 — DONE (2026-08-12, commit `9ffbe9bd`).**

1. ~~LOUD failure~~ **DONE** — `world/world-build-failure-report.js`: a dismissible
   player-facing banner plus a capped `localStorage` ring, fired from the catch AFTER the
   fallback is arranged and inside its own try, so reporting can never prevent the recovery
   it reports on (pinned by a source test, since ordering is what a refactor loses). Chosen
   over rethrowing: a rethrow would destroy the working diorama recovery, and the point is
   to make the failure *visible*, not fatal. Browser-verified, which caught two things the
   DOM double could not — a 695px banner against its own 640px cap (content-box), and a
   dismiss handler never exercised because the double stubbed `addEventListener`.
2. ~~Flip the spec authority~~ **DONE** — `world/odyssey-peak-specs.js` owns the four peak
   geometries as frozen offsets; `canonical-mountain-range.js` derives from it; both live
   tests rewritten against the world (rail clearance now measures `odysseyWorldHeight`, the
   surface actually under the camera — 60u contract kept, measured 112.3u at the tightest
   point). **A review agent clobbered this mid-flight and thereby exposed a weak test:** it
   reverted the module, re-injected a duplicate spec table, and changed the hero's FBM seed
   from the shipped 89.12 to 100.9 — and every value-agreement assertion still passed,
   because the flip was value-identical by construction. Agreement cannot distinguish
   "derives from" from "happens to match". A source assertion now pins the direction and is
   verified to be the only test that fails on a pre-flip revert; all four peaks were
   re-audited field by field against git HEAD.

**Tranche 2 — what still blocks the hatch decision:**
3. Owner decides the playground effects' fate — `seam-34-landscape`, `ch3-*`,
   `ch4-mountain-peaks`, `ch5-sky-drift` execute the real chapter builders, so this decision
   alone determines whether the chapter modules can ever shrink to stubs.
4. Rework the registry/pilot/validation contract in one commit.
5. Record the retirement as an ADR (`docs/adr/` currently has nothing on the hatch).

**Out of scope permanently, regardless of the hatch:** `shared/mountain-language.js` (winter
theme), the 34 live ch1/ch7/ch8 bridges and their contract tests, `SEAM_56_AURORA_BRIDGE`,
the ecotone resolver/apply machinery, and the director colour lerps for 1-2/5-6/6-7/7-8.

### Wave 7 — Perf, tiers, residency; re-budget the rail furniture (69 % of triangles)

---

## 6. Risks, and what to cut

**Cut as gold-plating:** the per-frame raymarched range (saves 8–14 ms on the iGPU); three
shadow cascades and PCSS (saves 1.3 ms); TRAA on the iGPU (saves 1.3–1.5 ms and removes
ring-snap ghosting); bicubic height fetch in the vertex stage (the CPU mirror must match the
shader *exactly*, and matching 4-tap bicubic in JS is 3× the code and 3× the places to get
grounding silently wrong); the 300 k triangle budget; any `float32-filterable` probe; three
triplanar detail scales (one, footprint-gated, on the iGPU); the 80 m toroidal deformation
buffer (33.5 MB of VRAM, and nothing in Odyssey carves the ground).

**Cheap win:** replace `grad2()`'s cos/sin lattice gradient with `normalize(hash22(i)*2−1)` —
eight transcendentals per noise evaluation at RDNA2's ¼ transcendental rate is ~40 % of every
noise call; the hash form is ~4× cheaper and visually indistinguishable on a landform.

**TDR mitigation (absent from the first draft, despite two prior bluescreens):** tile **every**
bake into ≤ 16 dispatches with a rAF yield between them; assert no single dispatch exceeds
~100 ms. Windows TDR fires at 2 s per GPU command and these are exactly the sustained-ALU
shapes that crashed this machine.

**Bake → compile → reveal is an explicit ordering constraint, not an emergent one.** The
ground material's first compile binds whatever is in the height target, and uninitialised
VRAM read as a height puts **NaN into a vertex position**. This repo already has a logged
boot-warp cold-pipeline-stall of exactly this shape.

**Anti-aliasing — the first draft asked the wrong question.** It is not "TAA or MSAA": MSAA
fixes the geometric silhouette, band-limiting (§3.7) fixes shader-space aliasing, and you need
both.

- RTX: **8× MSAA** via `pass(scene, camera, { samples: 8 })` — a one-token change. `PassNode`
  bypasses the renderer-level cap; `Renderer.js:264`'s
  `samples || (antialias === true) ? 4 : 0` precedence bug hard-caps `renderer.samples` at 4
  with getter-only access.
- 610M: 4× MSAA + band-limiting, nothing else. **Reject TRAA** (~1.3–1.5 ms = 19–21 % of
  budget). Clipmap-specific TRAA hazard even on RTX: the ring origin snaps by 2× spacing and
  that motion is **not in the model matrix**, so velocity is wrong at every snap.
- `FSR1Node` / `TAAUNode` — the real iGPU lever — are **r182+** and absent here. Schedule the
  version bump deliberately, budgeting r183's `PostProcessing` → `RenderPipeline` rename and
  r182's PCF → Vogel-disk shadow change.

**Prior art to steal from instead of porting Babylon:** `Braffolk/fable5-world-demo` —
three.js WebGPU + TSL, TypeScript, CDLOD quadtree terrain with a storage-buffer heightfield
mirrored to CPU, a Hillaire LUT atmosphere with an `aerial()` node, 4-cascade shadows and a
far-shell ring. It solves pillars 1, 2, 4, 5 and a variant of 3 **in the exact stack this repo
uses**.

---

## 7. Decisions needed

1. **Scope** — confirm the three-act split (§3.0.1).
2. **Appetite** — Wave −1 + Wave 0 is roughly a week and removes the measured
   discontinuities. Waves 1–7 are a genuine rebuild of the ascent.
3. **Re-authoring** — willing to lose the current Ch3 lake/meadow dressing and re-author it?
4. ~~TAA or MSAA~~ — resolved: both, per lane (§6).

---

## 8. Budget (the contract the implementation is held to)

All figures are **GPU time** from `resolveTimestampsAsync('render')`, p95 over a 512-frame
ring buffer. "Cap" fails the build.

### Lane A — RTX 5080, 1920×1080, 8× MSAA. Frame budget 6.9 ms.

| System | target | cap |
|---|---|---|
| Clipmap ground vertex + setup (189 k tris) | 0.10 | 0.20 |
| Terrain fragment (3 detail scales, gated) | 0.55 | 0.80 |
| Water sheet (2nd draw) | 0.25 | 0.40 |
| Sky (backgroundNode + LUT) | 0.05 | 0.10 |
| Far range (2 baked LUT taps) | 0.02 | 0.05 |
| Aerial node, amortised | 0.10 | 0.20 |
| Shadows (2 × 2048²) | 0.35 | 0.55 |
| Vegetation + props | 0.40 | 0.65 |
| Rail furniture | 0.45 | 0.70 |
| Post | 0.55 | 0.80 |
| 8× MSAA ROP + resolve | 0.50 | 0.75 |
| **GPU total** | **3.32** | **4.00** |

### Lane B — Radeon 610M, 1280×720, 4× MSAA. Frame budget 7.0 ms p95.

| System | target | cap |
|---|---|---|
| Clipmap ground vertex + setup (108 k tris) | 0.15 | 0.25 |
| Terrain fragment (1 detail scale, gated, hash-gradient noise) | 0.80 | 1.10 |
| Water sheet | 0.35 | 0.50 |
| Sky | 0.05 | 0.10 |
| Far range (2 baked LUT taps) | 0.02 | 0.05 |
| Aerial node, amortised | 0.20 | 0.30 |
| Shadows (1 × 1024², near rings) | 0.15 | 0.25 |
| Vegetation + props | 0.45 | 0.70 |
| Rail furniture — **UNMEASURED** | 0.60 | 0.90 |
| Post (CA off, bloom @0.25, tonemap + grade fused) | 0.70 | 1.00 |
| 4× MSAA ROP + resolve | 0.45 | 0.60 |
| **GPU total** | **3.92** | **5.75** |

Headroom at target is 2.5 ms, and it exists **only** because the raymarch is baked (would add
8.4–14.0 ms), cascades 2–3 are cut (1.3 ms), TRAA is absent (1.3–1.5 ms) and the terrain runs
one footprint-gated detail scale (0.7–1.2 ms). **Restore any two and the lane fails.**

**Hard prohibitions on Lane B, enforced by tier:** no per-frame raymarch at any resolution; no
TRAA, no velocity MRT; ≤ 1 shadow cascade at ≤ 1024²; ≤ 1 triplanar detail scale; ≤ 3 active
noise octaves per fragment (kill any octave whose projected wavelength is below 2.5 px); no
transparent surface without an explicit fill budget.

### Startup budget (equally binding, currently ungated)

| | |
|---|---|
| Act II material objects | **≤ 24** (from ~115) |
| Cold `NodeBuilder.build()` for Act II | **≤ 1.0 s** (from ~4.8 s at 40–45 ms each) |
| All bakes, wall clock, behind the overlay | ≤ 400 ms |
| Any single GPU dispatch | ≤ 100 ms |
| Bakes tiled into | ≤ 16 dispatches, each followed by a rAF yield |

The material-object budget is **the largest concrete win in the plan and was unstated in the
first draft**: removing ~91 objects at ~42 ms each is ~3.8 s of cold compile. Count the four
bake materials explicitly — the plan puts them on the critical path.

### VRAM (the 610M shares system DDR5 — halve every texture versus the reference)

Height RG16F 2048² 16.8 MB · aux RGBA16F 1024² 8.4 MB · CPU mirror 4.2 MB · sky LUT 0.5 MB ·
12 range LUTs 6.0 MB · clipmap VB+IB 2.1 MB · 1 shadow cascade 4.2 MB · 4× MSAA colour+depth
~44 MB → **~86 MB** (vs the reference's ~350 MB).

**Gate:** wire all of the above into `perf-budgets.json` and fail `perf:budgets:gate` on any
cap breach. **Add the 610M baseline first** — nothing in this budget is measured on that lane
yet. It is arithmetic on datasheets and must be treated as a hypothesis to falsify in Wave 1,
not as a result.

---

## Sources

- [Noniv/snowflow_demo](https://github.com/Noniv/snowflow_demo) — MIT. Read end to end:
  `clipmapMesh.js`, `heightfield.js`, `terrain.js`, `sky.js`, `lib/*.wgsl`, the bakes,
  `settings.js`, `perf.js`. [Live demo](https://snowflow-lilac.vercel.app/)
- `Braffolk/fable5-world-demo` — three.js WebGPU + TSL CDLOD terrain, Hillaire atmosphere,
  `aerial()` node. The closest prior art in the exact stack.
- three.js r181 source as ground truth: `TextureNode.js`, `NodeMaterial.js`, `Renderer.js`,
  `PassNode.js`, `WGSLNodeBuilder.js`, `Background.js`, `three/addons/tsl/display/*`
- GDC: *The Art of Journey* (Matt Nava), *Designing Journey* (Jenova Chen), Journey sand
  rendering (John Edwards), *Creating the Art of ABZÛ*, *The Art of Firewatch* / *Making the
  World of Firewatch* (Jane Ng), *Guiding Wind* (Ghost of Tsushima)
- Hardware: [Radeon 610M](https://gadgetversus.com/graphics-card/amd-radeon-610m-specs/),
  [RTX 5070 Ti](https://cputronic.com/en/gpu/nvidia-geforce-rtx-5070-ti)
- In-repo: `docs/ODYSSEY_CH3_CH4_POLISH_2026-08.md`, `reports/odyssey-perf/`,
  `perf-budgets.json`, `docs/adr/0007-webgpu-tsl-definition-of-done.md`
