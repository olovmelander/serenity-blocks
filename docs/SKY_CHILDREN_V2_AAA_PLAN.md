# Sky Children V2 — AAA "Cloud Sea Sunset" Rebuild Plan

> Status: **PHASE 6 SHIPPED** (2026-06-01). Supersedes the *implementation approach* of
> `docs/SKY_CHILDREN_WEBGPU_THEME_PLAN.md` (keep that doc as the **technique/look
> reference**; this doc replaces its raw-WGSL delivery path with the repo's proven
> TSL-on-`three/webgpu` AAA architecture). Honors `docs/SKY_CHILDREN_ART_DIRECTION.md`
> (the locked look bible) verbatim.

---

## 0. North Star & Scope

**Emotional target (locked):** the *"Valley of Triumph / Sunset"* state of *Sky:
Children of the Light*, rendered in *Journey*'s painterly lighting language — warm-gold
highlights, cool-violet shadows, soft atmospheric depth, readable silhouettes, and
board-safe contrast. The hero subject of this art direction is **the cloud sea seen at
golden hour from above**, not a meadow.

**Scope of this rebuild:** replace the current geometry-and-CPU theme with a thin
**WebGPU-first TSL orchestrator** modeled 1:1 on `src/themes/himalayan-peak/`. One
master mood scalar drives the whole scene (the day→alpenglow analogue). Three hero
techniques carry the "WOW": **a real cloud sea**, a **scattering sunset sky +
aerial-perspective atmosphere**, and a **Journey-grade painterly lighting + cinematic
post** stack. Everything else (terrain, foliage, particles, far ranges) becomes a
supporting band in a deliberate three-depth composition.

**Why a rebuild and not a tune-up:** the look bible's signature subject (the cloud sea)
and three of its six *locked* style anchors (soft light wrap / no hard Lambert; colored
shadows; selective stable glitter) are simply **not implemented** today. The current
clouds are opaque sphere puffs; the lighting is stock `AmbientLight` + `HemisphereLight`
+ `DirectionalLight` (hard terminators, grey shadows); there is no glitter, no
sun-scattering fog, no god-rays, no rim-separation pass. These are structural, not
parameter, gaps.

---

## 1. Honest Assessment of `sky-children-v2` Today

### What works and should be preserved
- The **TSL `sky-core` materials** (`src/themes/shared/sky-core/sky-core-materials.js`)
  are already node-based — gradient sky, terrain, cloud, cliff, mountain. Good bones.
- The **terrain field** (`sky-core-terrain-field.js`) gives CPU height/normal/path/valley
  sampling — useful for camera clearance and foliage anchoring.
- The **quality-preset + adaptive-resolution machinery** is mature.
- The **event→energy reactivity** plumbing (LINE_CLEAR/COMBO/PIECE_LOCK → wind/energy)
  exists and is wired through `eventBus`.

### What holds it back (technical debt)
1. **No mood spine.** Sun direction, palette, wind, and energy are updated in scattered
   places (`updateSunDirection`, `updateUniforms`, `startAnimation`) and hand-synced into
   a `uniformSets[]` array each frame. There is no single source of truth, so the
   warm/cool arc can't be authored coherently.
2. **Dual-THREE import hazard.** The theme imports `three` (WebGL build) while the
   materials import `three/webgpu`. The geometry path works, but the **last-resort
   `new THREE.WebGLRenderer()` fallback cannot run node materials** — that branch is
   effectively dead and silently broken. (Himalayan uses only `three/webgpu` + `three`
   geometry, which share the core singleton.)
3. **Lighting contradicts the look bible.** Stock `DirectionalLight`/`HemisphereLight`
   produce hard Lambert terminators and uncolored shadow fill — directly violating
   locked anchors #1 (no black shadows) and #2 (soft light wrap).
4. **Clouds are not clouds.** Opaque `SphereGeometry` puffs with a flat cotton material.
   The single most important subject in this art direction is faked with the cheapest
   possible primitive.
5. **CPU-heavy world build.** `distortMountainGeometry` rewrites cone vertices on the
   CPU per mountain; the 59 KB `sky-core-vegetation.js` builds/`rebuild`s instanced grass
   + flowers on the main thread; `createTerrain` walks every vertex in JS chunks. Quality
   changes trigger full async rebuilds with visible hitches.
6. **Manual per-frame uniform fan-out + per-frame `new THREE.Vector3()`** in
   `updateCamera`. Avoidable GC pressure.
7. **Validation/diagnostics bloat.** ~600 lines of `visualGate`/`perfGate`/`flowerDiagnostics`/
   `installCompatibilityHelpers` (`skyChildrenPhase1..7`) ride along in the runtime.
   Valuable as tooling, but they belong behind a debug flag, not in the hot path.

### Visual gaps vs the locked anchors (`SKY_CHILDREN_ART_DIRECTION.md` §"Style Anchors")
| Anchor (LOCKED) | Today | Target technique (this plan) |
|---|---|---|
| 1. No black shadows | ❌ stock ambient/hemi fill | Colored-shadow blend in every material (§3.3) |
| 2. Soft light wrap | ❌ hard Lambert | Wrapped diffuse `saturate((NdotL+w)/(1+w))` (§3.3) |
| 3. Rim separation near/mid/far | ⚠ partial (mountain rim only) | Fresnel rim in terrain+cloud+foliage, depth-scaled (§3.3) |
| 4. Atmosphere-first depth | ⚠ FogExp2 + per-mat fog mismatch | Single shared aerial-perspective fog == sky horizon (§2.3, §3.2) |
| 5. Selective stable glitter | ❌ none | Temporally-coherent `reflect()` glitter, threshold-gated (§3.3) |
| 6. Warm/cool split idle+stress | ⚠ static | MoodDirector drives split across the whole arc (§2.2, §5) |

---

## 2. Target Architecture (mirror `himalayan-peak/`)

### 2.1 Thin orchestrator
`sky-children-v2-theme.js` becomes a thin shell (≈ Himalayan's 395 lines): owns the
`WebGPURenderer`, scene, camera, the **shared uniform block**, the frame loop, and event
wiring. All visual logic moves into subsystems. Directory layout to add under
`src/themes/sky-children-v2/`:

```
composition/   mood-director.js        (the spine — see §2.2)
               camera-director.js      (3-band cinematic camera — see §2.4)
rendering/     sky-dome.js             (scattering sunset sky + sun + stars)
               cloud-sea.js            (HERO — see §3.1)
               far-ranges.js           (silhouette mountain band, replaces cones)
               valley-terrain.js       (ridged→rolling heightfield, Journey-lit)
               meadow.js               (GPU-instanced grass/flowers, slimmed port)
sim/           glints.js               (pollen/spark motes — analytic, no compute)
               sky-manta.js            (optional far silhouettes / birds)
post/          sky-pipeline.js         (cinematic MRT post — see §3.3)
sky-children-noise.js                  (shared TSL noise lib, ported from himalayan-noise)
```

Keep `sky-core-*` shared modules where they still serve (terrain-field sampling, quality
presets), but the **materials move to TSL helpers that read the shared uniforms** rather
than owning private uniform copies.

### 2.2 The MoodDirector (the spine)
Port `composition/altitude-director.js` → `mood-director.js`. One master scalar
`radiance ∈ [0,1]` ("how triumphant is the light right now") maps the entire scene
through the three mood buckets from the look bible:

```
Reverie (cool cloud-sea, idle)  →  Warming  →  Triumph (full sunset ignition)  →  Resolution
        radiance 0.0–0.34            0.34–0.7         0.7–1.0                       (decay)
```

- **Fast attack, slow decay** (golden-hour light answers the player, then lingers) — copy
  Himalayan's `attack 5.5 / decay 0.4 / relax 0.18` easing.
- Idle floor ≈ `0.10` so the warm/cool split is *always visible* even at rest (anchor #6).
- Transients layered on top: `gust` (cloud + grass + glints), `ignite` (sunset flare on
  big clears), `flare` (sun lens-flare/god-ray punch), `sparkle` (glitter burst),
  `cameraPunch`. Dependency-free (no THREE import), trivially unit-testable.
- Accent palette eases toward tiered hexes (single→tetris→combo→surge), exactly mirroring
  `ASCENT_ACCENTS`, but recolored to the look-bible Sunset palette
  (`#F6C063 #E58D4A #F3EBDD #8FB6D8 #6A71B8`).

### 2.3 Shared uniforms (one source of truth → fog == sky)
Adopt Himalayan's pattern: the orchestrator owns `this.u = { uTime, uRadiance, uIgnite,
uSunDir, uSunColor, uSkyZenith, uSkyMid, uSkyHorizon, uFogColor, uRimColor, uShadowTint,
uStarFade, uCameraPos, uGust }`. **Every** material (sky, cloud, terrain, foliage, far
ranges) reads the *same handles*, so the aerial-perspective fog color is, by construction,
the sky horizon nudged toward white — killing the current `FogExp2` vs per-material
`fogColor` mismatch. `_syncUniforms()` lerps the three mood-bucket palettes by `radiance`
once per frame (no per-material fan-out, no per-frame allocation).

### 2.4 CameraDirector (composition lock)
Port `camera-director.js`. The look bible mandates **three readable depth bands** and a
**brightest cluster off-center from the board ROI**. Configure:
- Rest pose: low over the cloud sea looking slightly down and out toward the sun on the
  horizon (sun off-center, per composition lock).
- Idle figure-8 "breathing" drift; pointer parallax (subtle); spring/shake/FOV-punch from
  `director.cameraPunch`.
- Clamp displacement + FOV delta so the board never disorients during combo peaks
  (anchor: "preserve board-safe contrast and edge readability").

### 2.5 WebGPU-first + fallback decision
**Recommendation:** WebGPU-first like Himalayan. Keep the existing
`WebGPURenderer({forceWebGL:true})` path as the *only* fallback (node materials run on
three's WebGL node backend there), and **delete the dead `new THREE.WebGLRenderer()`
branch**. If `navigator.gpu` is absent *and* the forceWebGL node backend fails, show the
graceful message (Himalayan's pattern) rather than shipping a broken third path. This
removes the dual-THREE hazard and ~80 lines of fallback complexity.
*(Open product question for sign-off: do we still need a true low-end WebGL path? If yes,
it becomes Phase 6, mirroring Winter's deferred WebGL parity — not the default.)*

---

## 3. The Three Hero Techniques (the WOW core)

### 3.1 HERO — The Cloud Sea
The signature subject. Two-layer approach, both analytic (no per-pixel raymarch — keep
the background frame budget):

**Layer A — the sea floor (volumetric-lit cloud deck).** A large displaced plane (or
shallow dome) below/around the camera, vertex-displaced by 3D FBM+Worley (port the
`noise3d`/`worley_3d` from the WGSL plan §3.1 into TSL `Fn`s in `sky-children-noise.js`).
Shade it as a *thin cloud volume* per the WGSL plan §3.2, expressed in TSL:
- **Beer's-law absorption** `exp(-density*depth)` for the lit/shadow split,
- **powder effect** `1-exp(-density*2)` to keep thin edges from blowing out,
- **Henyey-Greenstein forward scatter** for the backlit "silver lining" toward the sun
  (this is what sells a sunset cloud),
- lit color = warm gold, shadow color = **cool violet** (never grey — anchor #1),
- Fresnel rim on the billow edges (anchor #3),
- aerial-perspective blend toward the shared `uFogColor` with distance.
Animate by scrolling the noise domain on `uTime` + `uGust` (drift quickens on combos).

**Layer B — drifting hero puffs.** A handful of larger billboard/low-poly cloud clusters
*above* the deck for parallax and silhouette interest, same shading, slow `uGust`-scaled
drift. Replaces today's `createClouds()` sphere puffs entirely.

**Why not full raymarch (Nubis/Horizon):** Guerrilla's cloudscape is ~2 ms on a dedicated
PS4 GPU for the *whole sky*; as a *background* behind gameplay on shared web GPUs that's
the wrong budget. Mesh/vertex-lit volumetric *approximation* (Sea-of-Thieves lineage) hits
the same painterly read at a fraction of the cost and is the explicit adaptation the look
bible's companion plan already chose.

### 3.2 HERO — Scattering Sunset Sky + Atmosphere
Port `rendering/sky-dome.js`, retuned for sunset:
- Rayleigh-flavored cool **zenith → mid → warm horizon** three-stop gradient (use the look
  bible's Sunset stops), painterly-broken with a touch of FBM so it isn't a clean ramp
  (per the painting research: "break up the linear gradient").
- Physical **sun disc + wide warm halo + horizon glow** concentrated on the sun azimuth;
  sun core is bright/emissive → drives bloom + god-rays.
- **Stars fade** as `radiance` rises (Reverie shows a few; Triumph washes them out).
- **Aerial perspective everywhere:** distance haze toward the shared sky-horizon color, so
  far ranges desaturate/blue-and-gold out (real depth — anchor #4). Use the
  Quilez sun-scattering fog (WGSL plan §2 `atmospheric_fog`) in TSL: fog tints *warmer
  toward the sun*, cooler away. One fog function, shared by terrain/cloud/foliage/ranges.
- God-rays: radial light-scatter from the sun's projected screen UV (Himalayan
  `_updateSunScreen` + `peak-pipeline` god-ray loop), gated on sun visibility and punched
  by `director.flare`.

### 3.3 HERO — Painterly Journey Lighting + Cinematic Post
This is where the locked anchors live. Build a small shared TSL shading library
(`sky-children-lighting.js`) and call it from every surface material:
- **Wrapped diffuse** (soft light wrap, anchor #2): `saturate((NdotL + wrap)/(1+wrap))`
  with `wrap≈0.5` — no hard terminator. (Cleaner than Journey's `4*NdotL` "contrast" hack,
  which sharpens; we want softness here. Keep the optional `N.y` compression for the
  terrain's vertical-shadow read.)
- **Colored shadow blend** (anchor #1): `mix(shadowTint, lit, diffuse)` where `shadowTint`
  is the shared cool-violet `uShadowTint`, with a small saturation boost in shadow so it
  reads colored, never muddy/grey.
- **Rim separation** (anchor #3): Fresnel rim with the shared `uRimColor`, strength scaled
  by depth band so near/mid/far silhouettes all separate from the atmosphere.
- **Selective stable glitter** (anchor #5): the Journey `reflect()` glitter from the WGSL
  plan §1 §"Glitter", ported to TSL on the terrain/meadow/cloud-foam — threshold-gated
  (`≈0.97`) so sparkles are *rare and bright*, and driven by a *static* per-point hash so
  they sit on the same grains frame-to-frame (no strobe). A `director.sparkle` transient
  lifts the threshold briefly on big clears.
- **Cinematic post** (`post/sky-pipeline.js`, port `peak-pipeline.js`): MRT emissive bloom
  (sun, glitter, cloud silver-linings, rim) → chromatic aberration → god-rays → vignette →
  **ACES** → **golden-hour grade** (cool dawn→warm sunset push driven by `uRadiance`) →
  signature finish. *Signature finish for Sky:* swap Himalayan's "print streak" for a faint
  **soft-focus dreamy diffusion + film grain + dither** (matches the ethereal Sky read).
  Profiles per quality tier, runtime-mutable via `updateDynamic`.

---

## 4. Supporting Subsystems (the other two depth bands)

- **Valley terrain (`valley-terrain.js`):** replace the CPU per-vertex `PlaneGeometry`
  walk with Himalayan's GPU heightfield pattern — displacement + analytic normal computed
  in the **vertex stage via a varying** (`ridge-terrain.js` is the exact template). Tune
  the ridged-multifractal toward *softer rolling cloud-islands / a sunlit valley shoulder*
  rather than knife-edge aretes. Shade with the §3.3 painterly library. Gotcha (from
  memory + himalayan): rotate+translate the geometry so `positionLocal` == world XZ; the
  height/normal `Fn`s then work directly.
- **Far ranges (`far-ranges.js`):** delete `distortMountainGeometry` (CPU cone rewrite)
  and `createMountains`. Render the distant massif as a **silhouette band** — either a few
  TSL-displaced low-poly ridges heavily eaten by aerial perspective, or an SDF-ridge
  contribution folded into the sky dome. They exist only as the "far atmosphere band" of
  the composition lock; they should read as colored silhouettes, not rock detail.
- **Meadow (`meadow.js`):** keep the *idea* of instanced grass/flowers (the meadow hero
  shots are in `HERO_SHOTS`), but slim the 59 KB `sky-core-vegetation.js`:
  - move wind to a **GPU vertex** function reading shared `uTime`/`uGust` (today it's
    partly CPU per-frame),
  - build instance buffers **once** and scale density by hiding instances / `instanceCount`
    rather than CPU `rebuild()`,
  - foliage uses sky-biased normals + fake-SSS backlight (WGSL plan §4) for the translucent
    golden-hour grass read.
  This band is *optional per mood shot* — the cloud-sea hero shots may hide it entirely.
- **Glints (`glints.js`):** analytic GPU points (port `sim/spindrift.js`) — drifting pollen/
  light motes that twinkle, density+speed scaled by `uGust`. Emissive → feeds bloom.
  Replaces `createMoteSystem`/`createWindLinesSystem`.
- **Sky manta / birds (optional, `sky-manta.js`):** a few analytic far silhouettes for life
  and parallax (reuse Himalayan `peak-birds.js` boid-free analytic flight).

---

## 5. MoodDirector ↔ Game Event Mapping

| Event | radiance bump | transients | reads as |
|---|---|---|---|
| PIECE_LOCK | +0.012 | small gust | a breath of wind over the sea |
| HARD_DROP | +0.04 | gust + cameraPunch + chroma | a gust + tiny dolly |
| LINE_CLEAR (1–4) | +0.12 + lines·0.07 | ignite (tetris=big), flare, sparkle, bloom, accent tier | the light *answers* — sunset ignites, glitter bursts |
| COMBO (≥4 / ≥7) | up to +0.55 | flare, sparkle, cameraPunch, surge accent | sustained triumph; fuchsia-rose alpenglow at high combo |
| LEVEL_UP | +0.08 | gust + flare | a fresh warm sweep |
| GAME_OVER | → idle floor | slow cameraPunch pull-back | exhale back to cool Reverie |

Decay rates copied from Himalayan and retuned so the warm/cool split never fully collapses
(idle floor keeps anchor #6 true).

---

## 6. Performance Plan

1. **Kill CPU bottlenecks:** no per-vertex JS terrain walk (→ GPU vertex displacement); no
   `vegetation.rebuild()` on quality change (→ `instanceCount` scaling); no per-frame
   `uniformSets` fan-out (→ shared handles); no per-frame `new Vector3()` in the camera
   (→ scratch objects, copy Himalayan's `_tmp*` pattern).
2. **Analytic everything on the background budget:** clouds/terrain/glints/birds are all
   vertex-stage analytic. No full-screen raymarch. Per-pixel cost stays flat at 4K.
3. **MRT selective bloom:** only sun disc, glitter, silver-linings, and rims set
   `emissiveNode` → bloom touches only what should glow (and is cheaper). Remember the
   gotcha: with MRT, **all** materials need an `emissiveNode` (even `vec3(0)`) or the
   emissive attachment is undefined.
4. **Quality presets:** re-key from `mobile/medium/high/ultra` to Himalayan's
   `Minimal..Extreme` set for consistency, gating: cloud-deck segments, hero-puff count,
   meadow `instanceCount`, glint count, post on/off + MRT on/off, god-ray steps.
5. **Adaptive resolution:** keep the existing adaptive scaler (it's good), simplified to
   drive `renderScale` + post on/off; drop the flower-density adaptive coupling.
6. **Move diagnostics behind `?skyV2Debug`:** `visualGate`/`perfGate`/`flowerDiagnostics`/
   `skyChildrenPhaseN` compat shims load only when the debug flag is set.

Budget target (carry forward existing gate): render p95 ≤ ~10.5 ms, post p95 ≤ ~2 ms at
tier `High`.

---

## 7. Style-Anchor Compliance Matrix (final)

| Locked anchor | Delivered by |
|---|---|
| No black shadows | §3.3 colored-shadow blend + shared `uShadowTint` (every material) |
| Soft light wrap | §3.3 wrapped diffuse |
| Rim separation near/mid/far | §3.3 depth-scaled Fresnel rim across all bands |
| Atmosphere-first depth | §2.3 + §3.2 single shared aerial-perspective fog == sky horizon |
| Selective stable glitter | §3.3 threshold-gated, hash-static `reflect()` glitter |
| Warm/cool split idle+stress | §2.2 MoodDirector idle floor + arc |
| 3 depth bands / off-center highlight | §2.4 CameraDirector + §3.1/§4 band layout |
| Board-safe contrast at combo peaks | §2.4 clamped camera + §3.3 grade tuned to protect mid-tones |

---

## 8. Phased Delivery (mirror Himalayan's Phase 0→6)

- **Phase 0 — Scaffolding.** [SHIPPED] New subdir layout, `mood-director.js` (dependency-free, node-testable), `?skyV2Debug` overlay, shared-uniform block, thin orchestrator wired *additively*. Build + lint clean.
- **Phase 1 — Sky + atmosphere (§3.2).** [SHIPPED] Scattering sunset dome, sun, stars, shared fog.
- **Phase 2 — Cloud sea (§3.1).** [SHIPPED] The hero. Deck + hero puffs, Beer/powder/HG shading.
- **Phase 3 — Painterly lighting + post (§3.3).** [SHIPPED] Shared lighting lib applied to terrain; cinematic post pipeline; glitter.
- **Phase 4 — Supporting bands (§4).** [SHIPPED] Valley terrain (GPU heightfield), far-range silhouettes, glints. Resolved square glints via `uv()` sprite coordinate, and blocky glitter tiles via higher grid resolution.
- **Phase 5 — Reactivity + camera (§2.4, §5).** [SHIPPED] CameraDirector, spring-recoil inputs, dolly nudges/shake, pointer parallax, Lissajous breathing. Re-enabled cloud-sea deck under high cinematic camera vantage.
- **Phase 6 — Perf pass + (optional) WebGL parity.** [SHIPPED] Resolved dual-THREE bundle hazard, eliminated legacy WebGLRenderer fallback block, re-keyed presets to Minimal..Extreme, simplified applyAdaptiveQuality to scale resolution + toggle post-processing, fixed linter warnings, validated production build.

Each phase: code-complete → `npm run build` + lint clean → **WebGPU browser-verify**
(critical gate, per the repo's standing lesson that code-complete ≠ verified).

---

## 9. Risks & TSL Gotchas (carry-forward from repo memory)

- `three/tsl` for shader fns, `three/webgpu` for renderer + node materials; `three` only
  for geometry/Color (shared singleton — safe). **Do not** instantiate `THREE.WebGLRenderer`
  from the WebGL build for node materials.
- `pointUV` emits bad WGSL for points here — use `uv()` (per the Winter/spindrift note).
- Helpers that return a **struct of nodes** must be plain JS functions, not `Fn` (Fn can't
  compile a JS object into a GPU function) — see `ridge-terrain.js` `shade()`.
- `positionLocal` == world only after `geometry.rotateX(-π/2).translate(...)`; do the
  geometry transform so height/normal `Fn`s read world XZ directly.
- MRT requires `emissiveNode` on **all** materials in the pass.
- Store runtime-mutable uniforms as shared `uniform()` handles on `this.u`, updated once
  per frame; don't mutate material internals per frame.
- Cloud-sea overdraw is the main perf risk — cap hero-puff count per tier and lean on the
  deck (single mostly-opaque-ish layer) for the bulk of the read.

---

## 10. Validation

- Keep the **six hero bookmarks** (`HERO_SHOTS`) + the Phase-0 reference board
  (`docs/SKY_CHILDREN_PHASE0_REFERENCE_BOARD.md`); add cloud-sea-specific shots.
- Re-use the existing `visualGate`/`perfGate` shape (behind the debug flag) but rewrite the
  visual metrics to score the *new* anchors (warm/cool delta, rim presence, glitter
  stability, fog continuity) instead of flower coverage.
- Log every style regression in `docs/SKY_CHILDREN_LOOK_LOG.md` per its existing workflow;
  block merge on warm/cool balance, silhouette readability, or atmosphere-continuity
  regressions (the look bible's merge gate).

---

### Sources / Inspiration
- *Art of Sky: Children of the Light* (GDC 2020, Yuichiro Tanabe) — emotional time-of-day framing.
- *Sand Rendering in Journey* (GDC 2013, John Edwards) — wrapped diffuse, ocean specular, glitter, colored shadows.
- *Glitter, Fur and Shadows* (GDC 2025) — procedural glitter, self-shadowing direction.
- *The Real-time Volumetric Cloudscapes of Horizon Zero Dawn* (Schneider/Guerrilla, SIGGRAPH 2015) — why we *approximate* rather than full-raymarch on a background budget.
- Sea of Thieves mesh-cloud lineage; I. Quilez analytical sun-scattering fog; ACES tonemap.
- In-repo template: `src/themes/himalayan-peak/` (architecture, director, shared uniforms, MRT post).
