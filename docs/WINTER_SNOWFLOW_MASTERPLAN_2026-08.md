# Winter Theme — Snowflow-Level Rebuild Masterplan (2026-08-13)

> 🔄 **COMPOSITION PIVOT (user decision, 2026-08-13):** the theme is a FULL
> remake — the snowlab's vast wind-carved field becomes the whole landscape,
> mountains (taller) are the horizon, and the **trees, treeline, frozen lake and
> foreground rocks are REMOVED**. The foxes (and their deformation trails) stay.
> §4.6 (lake reflections) is therefore **dropped**; the framing-spruce and lake
> systems remain in the repo but are no longer wired into the scene. Landed the
> same day in `winter-wonderland.effect.js`: snowlab heightfield drives the
> ground mesh AND analytic fox grounding (`heightAt`, no raycast), rig BRDF +
> sastrugi + glints on the ground, twilight band in the aurora dome, remaining
> scene lights removed. Same-day user feedback round: mist bands removed
> entirely, mountains rewritten onto the rig (Phase-4 item — opaque twilight-lit
> snow/rock, aerial-matched, feet buried), camera dropped to snow level
> (heightAt-pinned, ≈2.3 m eye). Ref: `playground-refs/winter-remake-polar-field.png`.

**Goal:** take the Winter theme's snow, lighting, trails and reflections to the visual level
of [Noniv/snowflow_demo](https://github.com/Noniv/snowflow_demo)
([live](https://snowflow-lilac.vercel.app/)) — while staying inside our stack
(three r181 WebGPU/TSL, unlit-with-analytic-lighting themes, MRT bloom, iGPU budget)
and keeping the theme's identity (aurora, moon, foxes, frozen lake, spruces).

Reference captured for split-view iteration:
`public/playground-refs/snowflow-ref-default.png` (plus the user-provided phone shots).
snowflow_demo is **MIT-licensed** — porting its math with an attribution comment is fine.
A full clone lives in the session scratchpad; re-clone with
`git clone --depth 1 https://github.com/Noniv/snowflow_demo` when needed.

---

## 1. Why snowflow looks like that — the five pillars (from source, not vibes)

snowflow is **Babylon.js + hand-written WGSL**, 100% procedural (no textures, meshes or
HDRIs), 15–19 draws, 3.22 ms GPU @1440p on a 5070 Ti. Everything below is read from its
source; file references are into the snowflow repo.

### P1. A physically-derived lighting rig with one big idea: warm key / blue ambient
- Sun at **13° elevation**, azimuth 118°, intensity 4.2 (`core/settings.js`). Below ~10°
  the air mass kills the beam; above ~20° the raking shadows die. The beam lands at
  roughly **17:13:6 RGB** — strongly warm.
- Sky is a Nishita single-scatter bake → 512×256 equirect LUT + **9 SH coefficients**,
  with an **iteratively solved snow bounce** (sky lights snow, snow bounces ~0.28 of an
  up-facing hemisphere back, re-solve). The SH ambient is *strongly blue by construction*.
- Every image decision downstream protects this warm/cool split (see P5, AO rule).

### P2. Snow shaded as a scatterer, not white paint (`shaders/snow.fragment.wgsl`, `lib/shading.wgsl`)
- **Albedo is never 1.0**: base `vec3(0.855, 0.885, 0.945)` — high, narrow, slightly blue.
  Pushing to white = clipped "untextured blob".
- **Wrapped diffuse** `w ≈ 0.62` (compressed snow → 0.15): terminator pushed far past
  geometric, soft shadow edges no filter can fake.
- **Back-scatter SSS** — the single highest-value term (their comment: "doing most of the
  work of making this read as snow at all"). Lobe `pow(dot(V, -(L + N·k)), p)` with
  thickness-dependent tint `mix((0.94,0.965,1.0), (0.55,0.72,1.0), thickness·radius)` —
  deep snow scatters bluer. Thin edges (berm lips, footprint far walls) transmit brightly
  over wide angles; deep snow narrowly. Only partly killed by shadow (×0.42 floor) so
  shadowed drift lips still glow.
- **GGX specular** (roughness 0.62 base, f0 0.028) + **ambient sky specular** at a
  roughness-selected LUT mip — one of the *bluest* things in frame.
- **SH ambient + snow bounce** term (see P1).
- **Glints**: cell-hashed world-anchored facets (2 octaves, cells 5.2 cm / 18.5 cm), one
  jittered facet per cell, 38% occupancy, disc falloff, `pow(dot(facet,H), 780..1500)`,
  **hard grazing-angle gate** (`pow(1-NdotV, 1.5..5)`) — sparkle when looking *across*
  snow toward the light, matte looking down. Faded by pixel footprint before they alias.
  Added as radiance, not modulated into the BRDF.
- **AO applied to finished radiance, with a blue shift** — their two-rule comment is
  gospel: (1) darkening only the ambient re-weights cool vs warm and turns trenches
  *brown*; scale everything. (2) wherever it darkens, tint toward `(0.55,0.72,1.0)` —
  light in a snow hollow got there through snow. Analytic AO only — SSAO on an open
  snowfield returns view-dependent garbage.

### P3. Wind-carved anisotropic landform (`lib/terrain.wgsl`)
Every layer is FBM evaluated in a **rotated + anisotropically scaled domain about one
prevailing wind bearing** (held 70–80° off the sun azimuth so the sun rakes *across*
ridges — aligned, the fine structure reads flat):
- Broad dunes (λ58 m, squashed 2.1:1 along wind, derivative-damped so crests stay smooth),
  long swell (λ210 m), medium drifts (λ13.5 m) domain-sheared by the broad height for
  lee-face asymmetry, piled into concavities (`shelter` mask), scoured off crests.
- **Sastrugi** (λ2.3 m, ridged noise, streaks *along* wind) + wind ripples (λ0.42 m,
  transverse) + grain (λ0.115 m) evaluated **live with analytic derivatives**; a slow
  **wind-veer field** (±0.42 rad @ ~120 m) breaks the "corduroy" uniformity.
- A baked curvature/`exposure` channel cross-fades sastrugi (crests) vs ripples (hollows).
- **Per-layer footprint fades** (`fwidth`-style): each wavelength fades out as it nears
  pixel size. "Fading is not a quality compromise; it *is* the filter." TAA cannot rescue
  normal-map aliasing.
- Normal composition rule (their header comment): macro + fine + deform combine **as
  heightfield slopes**, only the tiled detail map is a tangent-space normal folded in
  **last via reoriented normal mapping (RNM)**. Adding normals instead of slopes = losing
  the landform under detail.
- Detail grain map: **baked at load** (1024², 3 stacked spherical-cap grain sizes, R/G
  normal, B cavity, A height) — spheres with crevices, not noise bumps
  (`detailBake.fragment.wgsl`), consumed at 3 world scales with per-scale footprint fade.

### P4. A 4-channel deformation state buffer (`deformSim.fragment.wgsl`)
Persistent RGBA16F ping-pong (2048² over 80 m), toroidal addressing, one fullscreen pass:
- Channels: **R depression (m), G displaced berm mass (m), B compression, A ice**. The
  berm channel "is what separates a trail with raised berms from a flat footprint decal".
- Relax: 5-point Laplacian diffusion (berms slump **3× faster** than trench floors → trails
  soften edges-inward), mass-conserving berm→depression slump, **anisotropic wind infill**
  from upwind, slow exponential decay (~71%/min survives). dt is *banked* on the CPU and
  spent in ~0.4 s steps because fp16 can't represent per-frame decay (their comment is a
  masterclass — read it before touching decay constants).
- Shading response in the snow material: compression → darker/denser/tighter spec/less
  scatter; **fresh berms → brighter and *slightly bluer* than base snow** (never less
  blue — desaturating carved snow makes it read as bare ground), roughness only 0.78 so
  berms keep the blue sky specular; trench AO with the blue cave tint.
- Deform gradient step **widens with `footprintMin`** (the *narrow* pixel-footprint axis)
  so trails survive as tonal lines at distance instead of switching off — and don't
  change shape when only the camera moves.

### P5. Image pipeline that protects the look
- **AgX tonemap at exposure 0.105** — measured so sunlit snow (~12 linear) lands at AgX
  normalized ~0.79 where the curve still has slope; higher exposure = every lit slope
  resolves to the same flat white. Contrast 1.14, bloom 0.22 thresholded in *exposed*
  units (only sun disc/glints/lit spray bloom), slight DoF, volumetric shafts (fade out
  at high sun), CAS sharpen 0.55, grain 0.022.
- TAA with proper jitter (we will NOT port TAA — see §4.8).
- Aerial perspective from the same sky LUT so terrain and far range "meet at one colour";
  far mountains are a raymarched heightfield on the skybox **lit by the same material
  logic and hazed by the same atmosphere**.

---

## 2. Where the Winter theme is today (audit 2026-08-13)

The WebGPU path delegates the whole scene to
`src/playground/effects/winter-wonderland.effect.js` (~1380 lines);
`src/themes/winter/winter-theme.js` legacy scene is dead on this path.

| Area | Current state | vs snowflow |
|---|---|---|
| Lighting model | **Unlit.** Hero surfaces all `MeshBasicNodeMaterial`; `nLit` = perturbed normal → wrap-Lambert (w=0.52), up-face, hemisphere `skyAmb`, weak SSS (0.24), Fresnel rim, `pow(·,180)` sparkle (`winter-wonderland.effect.js:442-598`). 5 real lights exist but only spruces are `MeshStandardNodeMaterial` (`framing-spruces.js:59`); two conflicting moon directions (`winter-theme.js:1500` vs `MOON_POS` :72) | Right *architecture* (analytic light in shader), ~20% of the shading terms, no albedo discipline, no thickness/SSS tint, no GGX, no glint gating |
| Ground | `PlaneGeometry(12000,7000,120,70)` = **~100 units/cell**, CPU billow noise ("pillows"), vertex AO via 3× box-blurred concavity, PolyHaven snow_01 used as near-no-op luma tooth + weak normal tilt (`snow-detail.js`, strengths 0.006/0.2) | No wind anisotropy, no sastrugi/ripples, no analytic-derivative fine layers, no footprint fades, resolution far too coarse to sculpt |
| Trails | Genuinely good bones: 1024² CPU DataTexture (2.34 u/texel), signed height + hardness + age channels, capsule brushes, berm lip, storm-coupled refill, tile culling, parallax + gradient normal + contact AO in shader (`paw-trail.js`, effect :477-540) | Missing: berm *mass* shading response (loose-bright-blue), compression albedo/roughness/thickness response, footprint-widened gradients, wind infill, slump |
| Lake | Fully procedural 15-layer fake (`winter-materials.js:753-917`); no reflector, no reflection of the actual aurora | Snowflow does SSR-on-ice; we can do better *for our scene*: analytically re-evaluate the aurora/sky along the reflected ray |
| Sky/ambient | Aurora dome IS the sky (26-step raymarch, `aurora-volume.js`), gradient night sky in-shader; ambient in materials is hand-tuned constants | No SH/irradiance derived from the actual sky; ambient hue drifts per material |
| Shadows | Only trail-local contact shadow + moon-dot | No terrain self-shadow, no tree/rock cast shadows |
| Atmosphere | Simple distance fog in ground shader; mist quads | No height falloff, no in-scatter toward light, mountains not hazed by the same system |
| Post | MRT bloom from emissive ✔, in-shader **ACES @ exposure 0.82** (renderer stays `NoToneMapping`), cold grade, vignette, frost, grain (`winter-pipeline.js`) | No AgX option, exposure never *measured* against snow luminance; **`post.updateDynamic()` never called on WebGPU path** (`winter-theme.js:4011` vs :4221) — frost/CA/gust-streak storm response is shipped-but-dead |
| Perf hygiene | Pixel-ratio cap 1.25; everything unlit; **no `shouldRenderFrame` gate**; 11,512 snow quads hardcoded; most `qualityPreset` keys unconsumed on WebGPU path | Must fix as part of this work — the new shading costs real ALU |

**Assets that already help:** PolyHaven `snow_01/02` diff+nor in `public/textures/winter/`,
`playground-refs/winter-target.jpg`, Journey refs, and now `snowflow-ref-default.png`.

---

## 3. Creative direction — the one real decision

Snowflow's beauty is ~half lighting rig. Ours is a **night scene**; a 1:1 copy (golden-hour
sun) would delete the aurora, the moon and the theme's identity. Three candidate grades,
to be settled **by screenshot A/B in Phase 0**, not by argument:

| Option | Rig | Keeps identity? | Risk |
|---|---|---|---|
| **A. Moonlit night** | Moon = the key at ~13°, cool `(0.75,0.85,1.05)` beam, very blue SH ambient, aurora = secondary animated ambient | Fully | Monochrome-blue; loses the warm/cool split that sells snowflow |
| **B. Polar twilight** ⭐ recommended | Sun *just below* horizon: warm amber band hugging one horizon (weak warm directional at 6–10°, intensity ~1/3 of snowflow's), deep blue zenith, aurora fully readable, moon opposite the glow as specular/glint source | Yes — this is real Nordic Feb, 15:30 | Two key lights to balance (warm horizon key + cool moon) |
| C. Golden hour | Full snowflow rig | No (aurora/moon gone) | Becomes a different theme |

**Recommendation: B.** It imports the warm/cool split (the actual money) at night-credible
amplitude, and it is *more distinctive* than snowflow, not less. Keep A as a
`?winterGrade=night` debug preset so the comparison stays reproducible. The Phase-0
harness makes elevation/azimuth/warmth/ambient-blue live sliders exactly like snowflow's
overlay, so this is a 30-minute screenshot decision, then locked.

> ✅ **DECIDED 2026-08-13: B (polar twilight), locked by the user.** Verified in the
> Phase-0 snowlab; canonical look reference:
> `public/playground-refs/winter-polar-twilight-lock.png`.

---

## 4. Technique mapping — snowflow → three r181 TSL

Architecture rule for all of it: **stay unlit-with-analytic-lighting.** We do not adopt
three's light/shadow system (no CSM, no PCSS, no scene lights for hero surfaces — delete
or ignore the 5 current lights except the spruce pair). Everything lands in the existing
`nLit` shading block, which becomes a proper snow BRDF. This is repo-native
(`skill docs/scene-techniques.md` §IBL & fake lighting) and sidesteps snowflow's
entire cascade machinery — our composition is static, so we bake what they compute.

### 4.1 Light rig (new module `src/themes/winter/lighting/winter-light-rig.js`)
One source of truth consumed by ground, mountains, lake, rocks, fox, snow billboards:
`{ keyDir, keyRadiance, moonDir, moonRadiance, shAmbient[9], bounceScale, auroraAmbient(t) }`.
- **SH from our actual sky**: at theme load, render the aurora-dome shader (aurora
  intensity at idle floor) to a 64×32 equirect target once, read back, project to 9 SH
  coefficients — direct port of snowflow's `projectSH()` (`render/sky.js:289`, MIT). Kill
  the per-material hand-tuned ambient constants; `shIrradiance(n)` is ~10 TSL ops.
- **Snow bounce**: their iterative solve collapses for us to one extra term — port
  `shIrradiance(up) · 0.28 · bounceUp · albedo` verbatim.
- **Aurora as light**: add `auroraAmbient = teal-green · uIntensity` weighted by `n.y`
  (from above), driven by the same uniform the dome uses (`:1281,1293`) — snow visibly
  breathes with the curtain. Cheap, unique to us, snowflow can't do this.
- Fix the `winter-theme.js:1500` vs `MOON_POS` direction conflict — one exported vector.

### 4.2 Snow BRDF (rewrite of `winter-wonderland.effect.js:442-598` shading block)
Port, in this order (each is a visible step):
1. **Albedo discipline**: base `vec3(0.855,0.885,0.945)` scaled for our grade (see 4.8);
   delete the luma-tooth no-op or re-range it to ±3%.
2. Wrapped diffuse: keep, retune `w` 0.52 → 0.62, and make `w` **collapse to 0.15 with
   trail hardness** (compression = the material, not a tint).
3. **`snowSubsurface` port** (`lib/shading.wgsl:75-106`) with thickness channel:
   1.0 open field, →0.35 compacted trails, →1.0 fresh berms; deep/shallow blue tint mix;
   shadow floor ×0.42. This term is the single biggest visible upgrade — land it early.
4. GGX spec (D·Vis·F, roughness 0.62/f0 0.028) + **ambient sky specular**: sample the
   Phase-0 sky equirect at roughness-selected mip via `pmremTexture(skyTex, reflect(-V,N), rough)`.
5. SH ambient + bounce + aurora ambient (4.1).
6. **Radiance-scaling blue AO**: replace current `contactAO`-multiplies-color with
   `color *= ao · mix(white, (0.55,0.72,1.0), (1-ao)·0.95)` applied **after** all lighting.
7. **Glints**: port `snowGlints` two-octave cell-hash with grazing gate + footprint fade,
   replacing the `pow(·,180)` sparkle. World-anchored (no crawl), moon-driven at night,
   warm-key-driven in twilight.
TSL notes: `fwidth(positionWorld.xz)` for footprint; hash via `hash(vec2)`/`mx_*` or a
ported `hash22` Fn; all conditionals via `.toVar()`+`If`/`select` (skill §Control Flow);
smoothstep argument order (repo gotcha list).

### 4.3 Landform (rework `buildFacetedSnowDrifts`, effect :324-614)
- **Density**: 120×70 → **≥ 384×224** (~86k verts — trivial). Keep CPU generation
  (fox grounding + lake carve need CPU mirror; snowflow bakes-and-reads-back for the same
  reason). Establish `M` = world-units-per-metre once (calibrate against the fox GLB,
  ~60 cm body) and express every ported constant through it.
- **Re-layer heights** with wind anisotropy — port `windMat` + damped-FBM stack (broad λ58M,
  swell λ210M, drifts λ13.5M sheared by broad height, shelter mask). Wind bearing a theme
  constant held ~75° off the key-light azimuth.
- Bake `exposure` (curvature) into a vertex attribute alongside the existing `aHeight`/
  `aOcclusion` (reuse that blur pass — it's already the right shape).
- **Fine layers move to the fragment shader as analytic gradients**: port `terrainFineFiltered`
  (sastrugi ridged-noise λ2.3M with `windLocal` veer, ripples λ0.42M, grain λ0.115M, each
  with its footprint fade) as a TSL `Fn` returning `(h, dHdx, dHdz)`. Requires a
  value-noise-with-derivatives Fn (~30 lines; port `noised`/`ridgedd` from snowflow's
  `lib/noise.wgsl`). Slopes add: `grad = macroGrad + fineGrad + trailGrad`, then
  `normalFromGradient`, then detail map last via **RNM** (`blendNormalRNM` port).
- **Detail map**: two options, decide in playground — (a) consume existing PolyHaven
  `snow_01_nor` properly (3 world scales, RNM, footprint fades, cavity from diff luma), or
  (b) port `detailBake` (spherical-cap grains, 1024² bake at load — StorageTexture + one
  compute/fragment bake). Start with (a) — zero new infra; (b) if tiling artifacts show.
- Skip triplanar (no steep faces on our ground) and skip vertex-level sastrugi
  displacement initially — at our camera pitch the *normals* carry the read; revisit only
  if grazing silhouettes look flat.

### 4.4 Shadows — bake, don't cascade
Composition is static ⇒ all of snowflow's cascade/PCSS machinery collapses to:
- **Load-time shadow bake**: one orthographic depth render along `keyDir` of the static
  casters (spruces, treeline, rocks, mountains) over the visible snow rect → small RT;
  sample in the ground shader with a 4-tap soft PCF, penumbra widened with distance from
  caster (fake PCSS: blur radius ∝ stored occluder distance). Long blue tree shadows
  raking the snow are the single most "AAA lighting" pixel win available to us.
- **Analytic dune self-shadow**: soft term from `dot(macroGrad, keyDirXZ)` (slope facing
  away from a 6–13° key = shadowed), wrapped like the diffuse so it never goes black.
- Trails already self-shadow via gradient · keyDir (effect :538) — keep, retune.

### 4.5 Trails 2.0 (`paw-trail.js` + consumption block)
Keep the CPU stamping system (proven, tile-culled, 20 Hz-throttled). Upgrade:
1. **Channel semantics → snowflow material response.** We already store signed height
   (R: berm + / depression −), hardness (G), age (B). Map: berm-side height → loose
   fresh-snow response (albedo → `(0.895,0.920,0.965)`·slightly-*bluer*, roughness 0.78,
   thickness → 1, chunky granulation noise); hardness → compression response (albedo
   × `(0.62,0.665,0.755)`·0.85 strength, wrap 0.62→0.15, thickness → 0.35, glints
   suppressed); depression depth → trench AO `(1 − clamp(dep·1.9)·0.38)` with the blue
   cave tint riding the darkening.
2. **Footprint-widened gradient**: step = `max(2·texel, footprintMin·1.4)` and blend the
   4 neighbours in when a texel < pixel (their "dotted-line" fix) — trails become visible
   tonal lines across the whole field instead of vanishing at ~15 m equivalent.
3. **Sim upgrades in the existing CPU decay tick** (2.5 Hz): berm slump
   `min(berm, dep)·rate` (mass-conserving), berm diffusion 3× depression's, optional
   upwind-biased infill using the storm wind vector already passed in (`setWind`).
4. ✅ **GPU port SHIPPED 2026-08-13** (`paw-trail-gpu.js`): fp16 ping-pong state
   (dep/lip/hard/age), one compute pass = diffusion (berms 3×) + mass-conserving
   slump + upwind infill + banked-dt decay + zero-snap; CPU capsule stamping
   kept, entering as saturating deltas via a 20 Hz RGBA8 inject texture gated by
   `uInjectOn` (stale deltas can never re-apply). Ground samples through a
   repointable `textureNode`; `?trailCpu=1` falls back to the CPU original.
   Item 2's footprint-widened gradient landed in the same pass.
Fox skate-marks on the lake keep using the existing skate-streak layer; add an `ice`
write (A channel is free) if we want refrozen glassy patches that catch the moon.

### 4.6 Lake — reflect the *actual* sky
Replace the fake smear layers (keep the ice-parallax bubbles, cracks, shoreline):
- Our sky is **analytic** — so evaluate a cut-down aurora function (6–8 steps, not 26)
  along `reflect(-V, n_ice)` inside the lake shader, plus the moon disc/halo along the
  same ray, ripple-warped by the existing UV noise. True animated aurora reflection with
  zero render targets, no `reflector()` double-draw, no SSR. Nothing in snowflow can do
  this — it's our scene's unfair advantage.
- Roughness/Fresnel from the existing sheen; glitter column stays (it's good).
- Tier-gate the step count; low tiers fall back to the current smear.

### 4.7 Atmosphere & far range
- Port `applyAerial`-style **height+distance fog** (density 0.0072/M, height falloff,
  in-scatter tint pulled from the sky equirect toward the horizon-glow direction) into
  ground, mountains, treeline bands, mist quads — one shared TSL `Fn` so everything
  "meets at one colour". (Height-fog scaffold exists in skill §Fog.)
- **Mountains join the same world**: swap their hand-tuned unlit shading to the shared
  rig (wrap diffuse + SH ambient + aerial). They currently float tonally; this pins them.
- Mist quads: tint from the same fog Fn instead of constants.

### 4.8 Post & grade
- Keep the r181 pattern: renderer `NoToneMapping`, curve applied in `WinterPipeline`
  (in-shader), MRT emissive bloom intact.
- Add an **AgX option** next to ACES in the pipeline (`toneMapping(THREE.AgXToneMapping,
  uExposure, c)` — r181 ships AgX) and **measure** exposure like snowflow did: log the
  linear luminance of key-lit snow, place it just under the shoulder. A/B screenshot
  ACES-0.82 vs AgX-tuned; AgX handles the saturated aurora + white snow with less hue
  skew. Whichever wins, the scene albedos get one re-grade pass in the Phase-0 harness
  (grade emulation in playground per skill §Previewing the in-game grade —
  `outputColorTransform=false` + `renderOutput(...)` so screenshots match in-game 1:1).
- **Fix the dead storm post response**: call `post.updateDynamic(...)` on the wonderland
  branch (`winter-theme.js:4011` — currently only `updateTime`). Frost/CA/gust streaks
  return for free.
- Optional, cheap, last: CAS-style sharpen (~0.3) — snow grain reads crisper through bloom.
- **No TAA.** No jitter infra, and the footprint fades in 4.3 are the anti-aliasing
  strategy (their own framing). Revisit only if glints shimmer at 1.25 DPR.

### 4.9 Perf debt paid alongside (required, not optional)
The new shading adds real ALU; the theme currently coasts on being unlit:
- Wire `shouldRenderFrame`/frame pacer into `startAnimation` (`winter-theme.js:3992`) like
  every other optimized theme.
- Make `qualityPreset.snowCount` real: scale `SNOW_TIERS` counts (11.5k hardcoded today);
  gate aurora `STEPS` (26 → 16 → 10), glint octave B, lake reflection steps, mist layers.
- Budget: **≤ +0.8 ms GPU vs current** at Extreme/1.25 DPR on the RTX baseline, and no
  regression past 16.6 ms on the iGPU at its tier. Measure with the timestamp harness
  (close stray browsers — `gpu-timestamp-sampling-trap`); production preview :4173, not
  dev, for capture-graded numbers.

---

## 5. Phases & sessions (playground-first, one effect per capture session — TDR rule)

Each phase ends with: playground screenshot(s) (+ `?ref=/playground-refs/snowflow-ref-default.png&refMode=split`
where useful), clean console, and for in-game phases a short single-theme capture.

| Phase | Scope | New/changed files | Gate |
|---|---|---|---|
| **0. Snowlab harness** ✅ DONE 2026-08-13 | `winter-snowlab.effect.js` shipped: metre-scaled slab, polar-twilight rig (URL params `elev/azi/warm/amb/exp/tm` + `window.__SNOWLAB__` live hooks), material-level grade emulation (AgX default, exposure 2.4), carved trail w/ berm+compaction response, shared-sky aerial fog. Already includes early Phase-1/2/4 terms: wrap 0.62, SSS w/ blue thickness tint, GGX, hemisphere ambient+bounce, lee self-shadow, wind-aniso landform. Verified: clean console, 240 fps @1440p RTX. Gotcha logged: `skyColor(vec3(0,1,0))` const-folds `normalize(vec2(0,0))` → WGSL compile error; guard with manual `div(length().max(1e-4))` | `src/playground/effects/winter-snowlab.effect.js` | ✅ **Grade locked: B polar twilight** (`winter-polar-twilight-lock.png`) |
| **1. BRDF core** (1–2 sessions) | 4.2 items 1–6 in the snowlab; SH bake util + light rig module | `lighting/winter-light-rig.js`, snowlab | Slab reads as *snow* vs ref in split view; SSS on/off comparison shot |
| **2. Landform** — ✅ proven in snowlab 2026-08-13; theme port pending (Phase 6) | 4.3 landed in the snowlab: TSL port of snowflow's derivative noise (`tslNoised`, 3-octave `ridged3`), wind-veer + stretch fields, sastrugi λ2.3 m / ripples λ0.42 m / grain λ0.115 m with footprint fades (`dFdx/dFdy`), slopes-add normal composition, lee self-shadow on the fine normal. **Lesson: the exposure crossfade must be HARD** (`smoothstep(0.3,0.7)`, sas 0.15↔1.0 vs rip 1.0↔0.1) — soft crossfade weaves perpendicular layers into corduroy. GGX damped ×0.7/×0.3 — full strength on ridged normals reads as WET snow. Ref: `winter-snowlab-carved-ref.png` | snowlab first, then `buildFacetedSnowDrifts` | Raking-light screenshot shows sastrugi streaks + dune asymmetry ✅; moiré-on-sway check pending in-theme |
| **3. Glints + trails** — ✅ glints + trail material response proven in snowlab; `paw-trail.js` wiring pending | `snowGlints` two-octave cell-hash port (moon-driven, grazing-gated `pow(1-NdotV,4)`, footprint-faded, ×9 moon radiance, suppressed ×0.3 in compacted trail); berm/compaction albedo-roughness-thickness response was in the harness from Phase 0 | `paw-trail.js`, shading block | Fox run leaves bright-lipped, blue-shadowed, sparkle-suppressed trail readable across the field (in-theme gate) |
| **4. Shadows + atmosphere** (1–2 sessions) | 4.4 bake + dune self-shadow; 4.7 aerial Fn, mountains onto shared rig | `lighting/static-shadow-bake.js`, effect, `winter-materials.js` | Tree shadows rake the snow; mountains sit *in* the air; one-colour horizon |
| **5. Lake** (1 session) | 4.6 analytic aurora/moon reflection | `winter-materials.js:753-917` | Aurora visibly dances in the ice, ripple-warped; tier fallback verified |
| **6. Integrate + post + perf** (1–2 sessions) | Port snowlab-proven code into `winter-wonderland.effect.js`; AgX/exposure measure; `updateDynamic` fix; frame gate + preset wiring; timestamp capture Extreme & low tier | effect, `winter-pipeline.js`, `winter-theme.js` | In-game capture matches snowlab; budget met; presets visibly scale |

Rough order of visible payoff if time-boxed: **1 (SSS+albedo+blue AO) > 4 (shadows) >
2 (sastrugi) > 3 (trails/glints) > 5 (lake) > 6 (polish)**.

---

## 6. Risks & traps (pre-loaded from repo memory + snowflow source)

- **TDR**: one small playground effect per capture session; never full-journey. Snowlab
  is deliberately tiny.
- **r181 gotchas**: `material.opacity` is a dead write when `opacityNode` exists; TSL
  mutation needs `.toVar()/.assign()`; `smoothstep(lo,hi,x)` order; multiplying by a
  0-uniform is not dead-code elimination — tier-gate by swapping nodes/JS, not shader zeros;
  `compileAsync` + post-PassNode trap — warm by rendering once.
- **Playground vs in-game grade**: never tune colors in flat NoToneMapping — use the
  grade-emulation harness from Phase 0 for every color decision.
- **`scene.fog` trap** (4× recurring): the wonderland path nulls scene.fog — keep it
  that way; all atmosphere goes through our own aerial Fn, and any material that must
  ignore it sets `fog:false` explicitly.
- **Decay in fp16** if we do the GPU trail port: bank dt like snowflow (their comment
  explains why retuning constants otherwise does nothing).
- **SH readback** is async — do it inside the existing loading flow, never after the rAF
  loop starts (device-poison trap: no `compileAsync` against a bound post target once the
  loop runs).
- **Exposure discipline**: every albedo change must be judged through the locked grade;
  snowflow's numbers assume AgX-0.105-ish response, ours will differ by the twilight
  key's lower intensity.
- **Scope**: the fox GLB material, snow billboards and puffs should *consume* the rig's
  ambient (one mul) but do not need the full BRDF.

## 7. Success criteria

1. Side-by-side with `snowflow-ref-default.png`: our snow field reads as sculpted,
   scattering *snow* — warm/cool split, blue shadows, drift-lip glow, grazing sparkle —
   not as a grey heightmap.
2. Trails: a fox crossing leaves a berm-lipped, compression-darkened, blue-shadowed line
   readable from the far side of the field, that softens edges-inward over ~a minute.
3. The lake reflects the living aurora.
4. Identity intact: aurora, moon, spruces, foxes all still present and *better lit*.
5. Perf: ≤ +0.8 ms GPU at Extreme on RTX baseline; iGPU tier holds 60 fps; frame gate
   active; presets actually scale the new costs.
6. Every phase verified by screenshot per CLAUDE.md — no "clean build = done".
