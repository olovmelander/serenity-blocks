# Odyssey — One World Plan (2026-08)

**Status:** Proposed. Supersedes the per-chapter cohesion patching in
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

## 3. Target architecture — "One World"

### 3.0 The ownership model — chapters are intervals on the path, not partitions of space

**The environment should not be divided into chapters at all.** A chapter is a *progression*
concept, not a *spatial* one. Today it is both, and that conflation is the root cause in §1.

Ask what a chapter is actually for, and it splits into three things:

1. **Progression** — which levels live here, star totals, unlocks, the difficulty curve.
   This is data (`levels.js`, `chapters.js`).
2. **Presentation** — which board theme you get when you enter a level here.
3. **Environment** — what the world looks like here.

Only (3) is spatial, and it is precisely the one that must *not* be a partition. (1) and (2)
are properties of a **scalar path position `p`**, and a scalar does not need the world cut
into pieces to be read.

So invert the ownership:

| | Owns | Does **not** own |
|---|---|---|
| **The World** | one ground, one sky, one sun, one atmosphere, biome as a function of world position | any notion of "chapter" |
| **The Path** | the spline, arc length, `p` | geometry |
| **A Chapter** | an interval `[pStart, pEnd)`: its levels, its board theme, its colour-script keyframe, which set-pieces are active | ground, sky, atmosphere, mountains |

The world exposes three queries and nothing else: `height(x, z)`, `biome(worldPos)`,
`aerial(worldPos, colour)`. Set dressing is placed in **world space by region** and streamed
by distance from the camera — not parented to a chapter group.

Everything that hurts today is a consequence of the current ownership, and simply ceases to
exist under this one:

- no chapter-local frames → no `toLocalPosition` → **no duplicated mountain chains** → no
  `rangeAuthority`, no L5 dedup
- no two worlds co-present → **no crossfade** → no double-exposure, no dead `opacityNode`
  writes, no binary `group.visible` pop
- no environment "seam" — a continuous world has no seams. Seams survive only as
  **colour-script keyframes** and **level-set boundaries**, both of which are just data
  interpolated along `p`
- residency becomes **distance-based streaming along arc length**, which is what actually
  matters for memory, instead of chapter create/evict

And the chapter identities the user likes are *not* lost — they become **emergent**. The rail
climbs, so the land around it is green low and snowy high. "Chapter 3 is green, Chapter 4 is
alpine" stops being a fact you assert with a chapter counter and becomes a fact you observe
because you gained 600 units of altitude. That is the difference between ascending a mountain
and watching two dioramas swap.

### 3.0.1 Three acts, not eight chapters

One world for *everything* would be wrong too — some chapters are genuinely different places:

| Act | Chapters | Treatment |
|---|---|---|
| **I — Earth Core** | ch1 | A separate place (inside the earth). Stays a diorama. |
| **II — The Ascent** | **ch2–ch6** | **ONE WORLD.** Ocean floor → ocean → shore → hills → alpine → cloud → edge of space. Literally one mountain rising out of one ocean into one sky. |
| **III — Beyond** | ch7–ch8 | Separate places (black hole, city). Stay dioramas. |

This is why the cohesion failure is so visible in ch3–ch5 and invisible in ch7–ch8: Act II is
the only stretch that is *supposed* to be one continuous place, and it is the only stretch
built as if it were not.

That leaves exactly **two** act boundaries needing a real transition — and both should be
occlusion moments (a dive, a breach, a whiteout), not alpha crossfades. Two authored moments
instead of seven crossfades that can never look right.

---

Six changes implement Act II. Each deletes a whole category of bug rather than patching
instances.

### 3.1 One ground: a camera-following geometry clipmap

Replace **all** of it — Ch3's meadow plate and foothill skirt, Ch4's snow disc, cloud deck
and three apron planes, Ch5's cloud deck, Ch2's (degenerate, zero-area) seabed — with a
single nested-ring geometry clipmap centred on the camera, exactly as snowflow does it:

- ~8 nested rings, **one static mesh, one material, one draw call**
- vertices carry only `(gridIndex, ringLevel)`; **all** world placement, CDLOD morphing and
  displacement happen in the vertex stage
- no CPU geometry rebuilds, no per-frame uploads, no plates, no welds

The weld problem, the plate-mismatch problem and the "two grounds at different heights"
problem all cease to exist **by construction** — there is only ever one surface.

Sizing for Odyssey (world units ≈ metres; spline arc length 1767.58 u; hero massif 1340 u
wide at ~850 u out): a radius of ~2500–3000 u with ~1.5 u inner spacing. Budget ~300 k
triangles — roughly what the Ch3 plates + Ch4 surfaces already cost, but in **one draw**.

### 3.2 One height function, baked once, mirrored to CPU

A single `odysseyWorldHeight(x, z)` continuous over the whole terrestrial act: coastal
shelf → lake basin → green hills → the massif → the summit. Baked once into an **RG16F**
texture (height + packed derivative) and mirrored back to the CPU.

> **Format note:** snowflow uses RG32F. In WebGPU `float32-filterable` is an *optional*
> feature that must be explicitly requested; **half-float is core-filterable**. Use RG16F
> unless a spike proves precision is insufficient (this repo already hit this exact wall
> when baking the Ch3 shore heightmap).

The CPU mirror is what makes props seat **exactly** on the surface that is drawn — killing
the floating/buried conifers (§1.3) permanently, and giving level-node placement a real
ground to sit on.

### 3.3 The distant range is raymarched on the sky — no geometry at all

This is the single highest-leverage idea for Odyssey specifically. snowflow's far range is
*"a heightfield raymarched on the skybox — no geometry, behind everything by construction,
with analytic normals, ridges occluding ridges, and a second short march toward the sun for
its own cast shadows"* at ~1.2 ms.

Adopting it deletes, in one move:

- the canonical mountain chain (4 meshes, a 4,225-vertex hero, shared across 3 chapters)
- the entire `rangeAuthority` / L5-dedup system
- the alpha rim-fade class of bug — **this whole session's battle**
- the far-range `renderOrder` juggling (−3/−2/−1) and every ghost-ridge-through-the-massif
  artefact

A raymarched range is *behind everything by construction*. It cannot z-fight, cannot be
seen through, cannot crossfade wrong, and costs one fullscreen-ish pass instead of four
transparent meshes.

### 3.4 One sun and one analytic sky

Delete `MOUNTAIN_SHADING.keyDir`. Everything keys off a single sun vector that is a function
of journey progress — so the sun *moving* as you ascend becomes the colour script rather
than a discontinuity. Fix the three surviving view-space-normal sites.

Follow snowflow's reasoning for going analytic rather than captured: *"the whole look hangs
on a sun 10–15° up: with a model, the elevation slider correctly drags the horizon warmth,
the zenith gradient, the ambient tint and the direct sun colour along with it."* One sky
model, baked to a small equirect LUT + SH irradiance, re-baked only when the sun moves
appreciably. That single control is what makes an ascent read as one day in one place.

### 3.5 One atmosphere, applied by everything

A shared TSL node `odysseyAerial(worldPos, litColor)` that every world material calls.
Deletes: the scene `FogExp2`, all twelve `material.fog = false` opt-outs, the three
competing authored haze ramps, and all three seam bridges (`SEAM_34/45/56`).

Aerial perspective is the classic unifier — it is what makes a multi-biome world read as one
planet. Today it is the thing most responsible for the world reading as separate layers.

### 3.6 Biome is a function of the world, not of the chapter index

```
biome(worldY, slope, wetness, distanceFromWater) → { grass, rock, snow, sand }
```

Height-blended (not linearly lerped — linear blending of splat weights is what makes
transitions look muddy). The snowline becomes a **world altitude**, so it follows the
terrain instead of arriving because a chapter counter incremented.

"Chapter 3 is green, Chapter 4 is alpine" then becomes **emergent**: the rail climbs, so the
land around it is greener low and snowier high. That is the difference between *ascending a
mountain* and *watching two dioramas swap*.

Chapters keep their identity through **props and colour script**, not through owning a
world: fish, birds, flowers, aurora, the space act. Those crossfade fine — they are small,
sparse and rarely silhouette-defining.

### 3.7 Where a real change is needed, use occlusion — not alpha

On a rail you always know what the camera can see, which makes occlusion-driven transitions
both cheap and bulletproof. Ch5→Ch6 (leaving the planet) should happen **through** the cloud
deck, with the deck as the occluder. Ch2→Ch3 should happen through the water surface — which
requires the terrain to be solid underwater, which today it is not (§1.4).

---

## 4. What survives

Non-negotiable, and explicitly preserved:

- **The rail, the spline and its arc length.** 1767.58 u is load-bearing — path positions
  are arc-length parameterised over the whole curve, so changing the total re-maps every
  chapter's p → world position (a prior 74 u shortening shifted ch1–ch5 by up to 54 u).
- **The persistent light rig.** Lights are reparented out of chapter groups into one
  never-hidden rig; toggling `visible` on a group containing lights nulls
  `LightsNode._lightNodes` and forces a full pipeline re-resolve. One constant light set,
  always.
- **The level nodes and the board handoff.** Untouched.
- **Compositions the user has explicitly praised**: the far-left flank mountain, and the
  Ch4 hero massif silhouette. These must be *authored into* the height function and A/B'd
  against the current captures, not left to noise.
- Chapters 1, 7, 8 — out of scope entirely.

---

## 5. Waves

Each wave ships something visible and has a proof gate. Wave 0 is independent of the
rebuild and can ship immediately.

### Wave 0 — Stop the bleeding (small, high confidence)

| # | Change | Fixes |
|---|---|---|
| 0.1 | Fold `chapterOpacity` into Ch3's alpine/skirt alpha | The 27.7 %-of-frame, one-frame pop → a 106 u ramp |
| 0.2 | Delete `MOUNTAIN_SHADING.keyDir`; key everything off `ODYSSEY_SUN`. Fix the 3 view-space-normal sites | The 72.5° sun split; the camera-swinging terminator |
| 0.3 | Delete `SEAM_34_ALPINE_BRIDGE` | A 3.0× luminance dip to nowhere between two identical endpoints |
| 0.4 | Terrain solid underwater: widen `landAlpha` below the waterline, `DoubleSide`, `depthWrite: true` | "See through the bottom of the grassy hills" |
| 0.5 | Seat the conifer belt on the heightfield | Trees buried 26 u / floating 16 u |

**Proof gate:** seam 2-3 and seam 3-4 captures; a numeric guard asserting no per-frame alpha
delta above a threshold for any surface covering >5 % of frame.

### Wave 1 — The spike (playground only, zero repo risk)

Build `src/playground/effects/odyssey-clipmap.effect.js`: one clipmap mesh, one material,
height from one baked RG16F function, CDLOD morph in the vertex stage, height-blended biome
splat, analytic sky, shared aerial node.

**Proof gate:** ≤ 3 draw calls for ground + sky; clean console (zero WebGPU validation
errors); screenshot-verified against the snowflow reference; frame time measured on **both**
the RTX lane and the iGPU lane. **This wave decides whether the rest of the plan is real.**

Open spike questions to answer here, not before:
- vertex-stage texture sampling in TSL — `texture(map, uv)` inside `positionNode` (three
  emits an explicit-LOD sample in the vertex stage); `textureLoad` is the unfiltered fallback
- CDLOD morph factor without per-frame CPU work
- whether RG16F precision is sufficient over the full height range

### Wave 2 — Author the world height field

One continuous `odysseyWorldHeight` from the ocean shelf to the summit, with the hero massif
and the left flank authored in deliberately. Verify the rail never intersects terrain and
that the praised compositions still frame correctly at 4:3 → 21:9.

### Wave 3 — Swap the ground in

Delete the Ch3 plates, Ch4 disc/deck/apron, Ch5 deck, Ch2 seabed. Clipmap in. Re-seat every
prop on the CPU height mirror.

### Wave 4 — Raymarched far range

Delete the canonical chain and the entire `rangeAuthority` / L5-dedup system.

### Wave 5 — One atmosphere, one sky

Shared aerial node everywhere; delete the twelve fog opt-outs, the three competing ramps and
all three seam bridges.

### Wave 6 — Transitions become occlusion

Delete the ecotone machinery (§1.2(c) — it is already dead code). Ch5→Ch6 through the cloud
deck; Ch2→Ch3 through the water.

### Wave 7 — Perf, tiers, residency

Chunked ribbon streaming by arc length with hysteresis. Rebuild quality tiers so they
actually gate something. Separately (and independently of this plan): re-budget the rail
furniture, which is 69 % of drawn triangles.

---

## 6. Risks and honest unknowns

- **The clipmap is unproven in this repo.** Wave 1 exists solely to de-risk it. If the spike
  fails, Wave 0 still stands on its own and the fallback is a single large displaced plane
  with distance-based tessellation — less elegant, same cohesion benefit.
- **snowflow is Babylon + hand-written WGSL, not three.js + TSL.** The *architecture*
  transfers completely; **none** of the code does. Treat every snowflow number as a target,
  not a promise.
- **Triangles do not go down.** ~300 k of clipmap replaces ~300 k of plates. The win is
  draws, materials, compile time and — above all — cohesion. Anyone expecting a triangle
  win will be disappointed; the triangles are in the rail furniture.
- **Aliasing.** A continuous terrain silhouette aliases badly. snowflow solves it with TAA
  (Halton jitter written into the projection, depth reprojection, variance clipping).
  Odyssey currently has an uncommitted 4× MSAA at High+. TAA is the better answer and is a
  substantial build in its own right — scope it explicitly or accept MSAA.
- **Losing what works.** The current Ch3 lake, meadow dressing and the specific hero
  composition are liked. They must be re-authored deliberately and A/B'd against captures,
  not regenerated and hoped for.
- **No iGPU baseline exists.** `reports/odyssey-perf/` contains only RTX 5080 files. The
  weak lane's entire evidence base is "transition spikes 60–311 ms" plus two TDR bluescreens.
  A fresh baseline on both lanes is a prerequisite for claiming any win.

---

## 7. Decisions needed

1. **Scope** — confirm the three-act split (§3.0.1): Act II (Ch2–Ch6) becomes one world;
   Ch1/Ch7/Ch8 stay dioramas.
2. **Appetite** — Wave 0 alone is a few days and removes the three worst discontinuities.
   Waves 1–7 are a genuine rebuild of the terrestrial act. Which are we committing to now?
3. **Re-authoring** — are we willing to lose the current Ch3 lake/meadow set dressing and
   re-author it on the new ground?
4. **Anti-aliasing** — TAA (correct, expensive) or keep MSAA (cheap, worse on terrain
   silhouettes)?

---

## Sources

- [Noniv/snowflow_demo](https://github.com/Noniv/snowflow_demo) — MIT; WebGPU + Babylon.js +
  hand-written WGSL. 8-ring clipmap, ~870 m radius, 333 k tris, one draw call; heightfield
  baked to 4096² RG32F and mirrored to CPU; far range raymarched on the skybox; Nishita
  single-scattering baked to an equirect LUT + SH irradiance; 3 world-space PCSS cascades;
  TAA + bloom + light shafts + DoF + SSR + AgX. 3.22 ms GPU @ 2560×1440, 15–19 draws.
- [Live demo](https://snowflow-lilac.vercel.app/)
- [three.js WebGPU TSL procedural terrain example](https://threejs.org/examples/webgpu_tsl_procedural_terrain.html)
- [TSL specification](https://threejs.org/docs/pages/TSL.html)
- In-repo: `docs/ODYSSEY_CH3_CH4_POLISH_2026-08.md`, `reports/odyssey-perf/baseline-rtx5080-*.json`,
  `perf-budgets.json`, `docs/adr/0007-webgpu-tsl-definition-of-done.md`
