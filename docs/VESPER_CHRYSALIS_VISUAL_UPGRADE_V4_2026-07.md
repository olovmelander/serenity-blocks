# Vesper Chrysalis — V4 "Next-Level" Visual Upgrade Plan

*Closing the last quality gap to hatom.com — **atmosphere, colored lighting/bounce, material & reflection fidelity, fluidity**, not just more elements.*

> **Provenance & method.** Deep-inspected hatom.com's phase-1 hero at high detail (its scroll timeline is fully
> encapsulated — Lenis/GSAP inaccessible to synthetic input — so phases 2–5 are read from the original 5 phase
> screenshots + the asset manifest). Then a 19-agent orchestrated workflow: **2 research agents** (hatom's visual
> qualities + WebGPU/TSL techniques) → **8 quality-dimension designs** grounded in our real code → **8 adversarial
> verifications** (each design attacked for invented APIs, perf/TDR traps, board-safety, value-contrast violations)
> → **1 synthesis**. All 8 dimensions survived as *revise* (corrections folded in); **7 sub-proposals were dropped**
> with reasons (§5). Author: 2026-07-07. Builds on M0–M3 + masterpiece-upgrade + V3 Wave A/B (already shipped).

**Target file:** [src/playground/effects/vesper-chrysalis.effect.js](../src/playground/effects/vesper-chrysalis.effect.js)
— this file **is** the scene; the theme wrapper
[src/themes/vesper-chrysalis/vesper-chrysalis-theme.js](../src/themes/vesper-chrysalis/vesper-chrysalis-theme.js)
imports `create()` from it, so an edit here flows to both the playground *and* the in-game theme. Line refs below
were adversarially confirmed against the source. (Note: `Fn` is **not** currently imported at L16–21 — item 1.1
must add it.)

---

## 1. The verdict — the gaps that matter most vs hatom

The scene is competent and correctly staged, but four things separate it from hatom's "expensive twilight" read, in priority order:

1. **Lighting & colored bounce (the biggest gap).** The scene is ~100% unlit `MeshBasicNodeMaterial` with pure near-black bodies. Shadows crush to *grey-black*, not the plum/indigo **colored fill** hatom bakes into every dark. The glowing relic floats in a world it fails to illuminate — no radial bounce onto terrain. Result: flat cutouts, not modeled forms.
2. **Atmosphere & aerial perspective.** One flat `THREE.Fog` + 2–4 identical additive veils. No **height fog** pooling in the valleys / on the lake, no **directional crepuscular tint** toward the magenta band, and the fog color is too *dark* so far peaks fade to black instead of *lifting* toward the horizon hue. Far ridge ≈ near ridge in value → "flat diorama."
3. **Material & reflection fidelity ("low-res reflections") + color grade.** The `scene.environment` PMREM is a bare gradient dome with no composition — reflective surfaces mirror a generic blur that doesn't match the sky. The lake is a **hard mirror** (single-tap `screenUV.flipX()`, flat 0.26 reflectivity floor). And the grade is a single *linear* split-tone — it mathematically cannot do the non-linear per-region shaping (crushed-but-colored blacks, hue-rotated magenta mids, cyan highs held off clip) that gives hatom its film look.
4. **Fluidity / "alive-liquid" feel.** Motion exists but breaks hatom's two laws: **nothing static** (crystals are frozen; egg surface & crack *pattern* have no time term) and **no two motions sync** (one global `pulse` L39 drives core veins AND shell cracks in lockstep). Flow fields are straight conveyor-belt scrolls; particles swing on bounded sines. No domain-warp or curl noise anywhere.

---

## 2. Wave 1 — highest impact / lowest risk

*All four are pure analytic ALU or CPU, board-safe, all-tier, zero new passes, zero TDR class. They convert flat cutouts into modeled, atmospheric, living forms before we touch a single render target.*

### 1.1 Twilight fill rig + egg-as-practical-light (lighting P1+P2, corrected)
**Change:** Add a shared `twilightFill()` Fn used by `peakMat` (L146), `boulderMat` (L453) and `moundMat` (L499): hemispheric ambient (cool indigo above → warm plum below, keyed on `normalWorld.y`) + a soft warm-magenta key toward the horizon azimuth. Layer a second **egg-bounce** term: warm amber falling off radially from the relic, `uS`-gated + core-pulse-modulated, so the hero finally lights its world.
**TSL (corrected):**
- **Add `Fn` to the `three/tsl` import** (currently absent — throws without it). Declare `twilightFill` + uniforms at `create()` scope *before* L145. Use **`pow(x,1.6)` function-form** (matches the file), not `.pow()`.
- **`moundGeo.computeVertexNormals()` after L511 is REQUIRED** (its plane normals are uniform → flat hemi otherwise). For `boulderGeo` it's optional (icosa normals are already valid) — do NOT bill it as "repairing broken fresnel"; that claim was refuted.
- Peaks get a vertical `positionWorld.y` duotone (plum at waterline → faint indigo up-ridge), not hemi (they're vertical curtains).
- Egg bounce: `const toEgg=RELIC.sub(positionWorld); falloff=1/(1+d²·0.0016); facing=clamp(dot(N,dir),0,1)*0.7+0.3; eggBounce=uEggCol.mul(falloff).mul(facing).mul(uS.mul(0.9).add(0.08)).mul(pulse.mul(0.25).add(0.85))`. **Update `RELIC` from `relic.position` each frame** (it bobs 19±1.2). Keep the innermost crystals `[±24,-40]` at the lowest amber gain.
**Tier:** all tiers (pure ALU). Drop `.pow` key to linear on Minimal/Low if desired.
**Perf/board:** ~10–14 ALU on 3 bounded meshes, ×2 via reflector = trivial. Fills capped ≤0.13, colors kept deep plum/indigo so the post black-crush re-seats them as colored near-black; egg emissive (1.0–1.8) still dominates. Falloff is near-zero by the center water; crystals/boulders are all off-center.
**Payoff:** high (bounce is **escalation-gated** — Dormant tableau barely changes; it blooms in Spill→Ascension). **Effort:** S.

### 1.2 Analytic height-fog + azimuthal crepuscular tint in peakMat (atmosphere P1, corrected)
**Change:** Set `peakMat.fog=false` and author aerial perspective in `peakMat.colorNode`: (a) height pooling (dense at waterline base, thin at crests) so bases melt into haze while tips stay silhouette; (b) an azimuthal warm lift toward the magenta band; (c) lift the fog target from near-black `0.038,0.022,0.058` to a mid-plum `~0.055,0.030,0.075` with a magenta warm pole `~0.30,0.09,0.16` so ranges recede by *lifting*, not blacking out.
**TSL (corrected):** `distF=smoothstep(160,820,dist); heightF=Pw.y.mul(-0.045).exp().clamp(0,1)` (`.exp()` proven in halcyon-apex). **Do NOT switch `scene.fog` to FogExp2** (refuted — it would newly haze the hero relic/crystals/boulders that currently sit inside the linear near=260). Once `peakMat.fog=false`, the existing `THREE.Fog(260,900)` is a harmless no-op — leave it or set `scene.fog=null`. **Guard the azimuth against a zero-length `Vxz`** — key it off `smoothstep` of `(Pw.z - cameraPosition.z)` sign instead of `normalize`. Keep `mix≤0.92` and the ~0.12-luma warm pole (stays under the 0.40 bloom threshold).
**Tier:** all tiers incl. WebGL fallback; optionally drop the azimuth term below Medium.
**Perf/board:** ~8–12 ALU on 3 ridge meshes, ×2 reflector. Warm lift pools LOW at the waterline behind the board; tips stay near-black. Value-contrast intact.
**Payoff:** high. **Effort:** S.

### 1.3 Wet-mirror soft reflection + Fresnel remap + shared centerMask (water P1, corrected)
**Change:** In the water block (L268–311) replace the single-tap `reflection.sample(reflUV)` with a small vertically-weighted (downward-smear) kernel whose spread grows at grazing, and replace the flat 0.26 reflectivity floor with a sharper Fresnel that goes near-mirror only at grazing and drops toward the viewer. Introduce the **shared `centerMask`** here that later water items reuse.
**TSL (corrected):** kernel weights sum to 1.0 (energy-preserving → lowers peak luminance, never lifts). `centerMask=smoothstep(16,44,abs(positionWorld.x))` (0 in board strip → 1 in flanks). `reflectivity=clamp(fres.mul(0.9).add(0.08.mul(centerMask)),0,1)`. **Fix the prose only:** `smoothstep(0.55,0.0,abs(V.y))` is 1 at *grazing*, not straight-down — so blur grows at the far/horizon band and the near center stays sharp+dark (the board-positive read; keep the math).
**Tier:** JS-branch the tap count — Minimal/Low 1 tap (today's look), Medium/High 3 taps, Ultra/Extreme 5 taps. Fresnel remap + centerMask are free everywhere.
**Perf/board:** +2–4 cache-hot taps on the downsampled reflector RT over the lower ~40% of frame; <0.2ms High/RTX. Strongly board-positive — `centerMask` drives center reflectivity toward ~0, so the board strip reads as flat dark calm water.
**Payoff:** high (revised down from "transformative" — at `rippleBase=0.0009` it's a subtle smear). **Effort:** S.

### 1.4 Desynced multi-rate "breath": wake crystals + split the relic throb (fluidity P1, corrected)
**Change:** The crystal `InstancedMesh` (L418–441) is the largest frozen mass in frame — give each spire a desynced emissive breath + micro top-sway. Split the single `pulse` (L39) into independent-rate oscillators (slow body swell ~0.35Hz, vein flicker ~1.1Hz phase-offset, crack pulse ~0.7Hz) so the hero breathes instead of blinking as one LED.
**TSL (corrected — this is the load-bearing fix):** **Do NOT use `instanceIndex`-hashing in `emissiveNode`.** `instanceIndex` is a vertex builtin, isn't imported, and its fragment varying is unreliable on the WebGL2 fallback (`gl_InstanceID` doesn't exist in the fragment stage). Use the codebase-proven pattern: build per-instance `aPhase`/`aRate` `InstancedBufferAttribute`s in the existing crystal loop (`crnd()` already yields per-instance randoms there), read via `attribute('aPhase','float')` — works in both `positionNode` (sway) and `emissiveNode` (breath) and is genuinely WebGL-safe (deep-ocean/summer-meadow pattern). **Sway mask fix:** cones are centered `ConeGeometry`, so `positionLocal.y∈[-0.5,+0.5]`; use `swayMask=positionLocal.y.add(0.5).clamp(0,1)` (base→0, tip→1), not `clamp(positionLocal.y,0,1)` (which seams at y=0 and halves amplitude).
**Tier:** all tiers (~6 ALU + 2 attr reads/instance, ≤50 instances).
**Perf/board:** negligible; no new draws. Crystals live at `|x|≥24` (center protected). Watch: breath raises the crystal accent peak from 0.30 → ~0.47 near x=±24 — verify no bloom bleed toward center in the screenshot.
**Payoff:** high. **Effort:** S.

---

## 3. Wave 2 — structural quality

*Adds the two render-target-touching wins (env PMREM, LUT) plus the layered atmosphere and cinematic camera. Ship after Wave 1 is screenshot-verified.*

### 2.1 Composition-matched high-detail twilight PMREM (material P1, corrected)
**Change:** Rebuild the env scene (L206–244) so the prefiltered radiance is a miniature of *this* world: (a) drive the env dome with the same sky gradient+band math as `skyMat`; (b) add a near-black jagged ridge-ring at the env horizon so reflections break on mountain shapes; (c) reposition emissive pins to the real azimuths (ember key toward the relic, cyan L/R crystal pins, cool moon dot, a few sharp stars); (d) drop bake sigma 0.04→~0.02.
**Corrections (blockers folded in):**
- **Per-material `envMapIntensity` is a NO-OP here** (materials have no per-material `envMap`; the node returns `scene.environmentIntensity`). Either **assign the PMREM per material** (`shellMat.envMap = envTexture; shellMat.envMapIntensity = 1.15`) to make the lever real, **or** drop every per-material line and use the single global `scene.environmentIntensity`. Do not ship the dead numbers.
- **Delete the `WEBGPU.PMREMGenerator` branch** — invented symbol. `new THREE.PMREMGenerator(renderer)` from `three/webgpu` already handles the fallback backend.
- Stop billing this as the standalone fix for *mirror* softness — that's the reflector (item 1.3), a separate system. This fixes what the *glass/metal* reflect.
- Guard against IBL-bake failure (the try/catch can leave `scene.environment` null); log if the bake throws, and keep emissive floors on any future metal so nothing renders pure black.
**Tier:** one-time bake, full content all tiers; skip ridge-ring geo + star pins on Minimal/Low.
**Perf/board:** one-time bake, **zero per-frame cost**, no geometry in-scene. Enriched reflection concentrates on the hero egg — where light should pool.
**Payoff:** high. **Effort:** M. *(Ship together with 1.3 — env + mirror are the two halves of "low-res reflections.")*

### 2.2 Procedural 3D-LUT hatom grade (sky-grade P3, corrected)
**Change:** Advance the never-shipped V3 item 7. Bake a `Data3DTexture` at scene-create encoding the measured hatom grade (crushed-but-*colored* violet blacks → magenta mids toward #F76CFE → amber #ff8a3c highs → cyan held off clip), apply via `lut3D()` as the **final op AFTER ACES** in the post graph (L707–729). Simplify the inline linear split-tone (the LUT now carries the duotone).
**TSL (crash fix — mandatory):** `lut3D()` expects a **TextureNode**, and `getValueType()` has no `isTexture` branch → passing a raw `Data3DTexture` throws at runtime. Import `{ texture3D } from 'three/tsl'` and call `lut3D(gradedSDR, texture3D(lutTex), N, uLutMix)`. Keep `lutTex.colorSpace` at default `NoColorSpace`; `UnsignedByteType + LinearFilter` is core WebGL2 (fallback-safe). Keep the tap strictly on the clamped 0..1 SDR value.
**Tier:** N=33 High+, N=16 Medium/Low (trilinear stays smooth), Minimal keeps today's inline split-tone. `uLutMix` animatable by S (push harder at Cosmos). Behind `?gradeV2` for A/B vs a captured hatom frame.
**Perf/board:** sub-ms one-time bake; per-frame = one trilinear tap (net cost-neutral vs today's removed ALU). Global tone only — deepens the low-key blacks rather than lifting them.
**Payoff:** high (the one thing our linear split-tone mathematically can't do). **Effort:** M.

### 2.3 Graded receding veil stack + lake-surface valley mist (atmosphere P2, corrected)
**Change:** Break the shared `veilMat`: per-veil baked depth index → far veils warmer/denser toward the band, near veils cool/dim, plus a bottom-heavy pooling gradient + desynced drift. Add ONE wide low mist band hugging the waterline across the mountain bases (softens the mountain-lake seam; the reflector doubles it for free).
**Corrections:** set `blending=THREE.AdditiveBlending` **explicitly** on the mist material (prose said "additive" only). **Narrow the x-taper to `smoothstep(0.0,0.06,|u-0.5|)` (~±180 world units)** so the mist actually reaches the mid-field seam behind the relic while still zeroing dead-center over the board wedge (the original ±540 taper left the seam un-softened where it mattered).
**Tier:** veils already 4/2/0; mist tier≥2; mist fbm octaves 2 High+/1 Medium (JS-branch, not ×0).
**Perf/board:** same veil draw count + 1 additive mist draw ×2 reflector; capped ≤0.14 veils / ≤0.08 mist, depthWrite=false. Stays cool/dim, below bloom.
**Payoff:** high. **Effort:** M.

### 2.4 S-driven cinematic camera + board-wedge negative-space dead-zone (composition P1 + P4a)
**Change:** Rewrite `camera(time,cam)` (L812–833) to consume the in-scope eased `sEased`: as S 0→1, dolly base z 44→~34, crane y 15.5→~20, migrate `lookAt.y` 14.5→~22, plus one very-slow ±3u lateral orbit with counter-rotated lookAt so depth planes shear. Add a feathered lower-center luminance dead-zone in post (~12% knock) so the egg's mirror + band reflection never competes with the playfield UI.
**Corrections:** `sEased` is a live `let` the method closes over — valid, zero GPU. `lookAt.x` pinned ≈0; orbit ±3u; scale push+orbit by the existing `camMotion` (reduced-motion), but keep a small non-zero floor so the narrative reframe still reads at `camMotion=0.28`. fov 58→56 nudge is **optional** (dolly already compresses). The dead-zone y-orientation is correct as written (`viewportUV` is y-up on both backends) — `smoothstep(0.60,0.0,uvp.y)` darkens the lower 60% and protects the upper-third egg.
**Tier:** identical all tiers (CPU math + ~6 ALU post). **Perf/board:** zero GPU for the rig; the dead-zone strictly improves board readability. **MUST screenshot-verify the board wedge + egg lake-reflection across S=0→1 in the REAL theme** (the playground has no board).
**Payoff:** transformative (biggest distinctly-hatom composition gap). **Effort:** S.

### 2.5 Domain-warp flow fields + curl-drift particles + directional flow-normal ripple (fluidity P2 + water P2, **merged**)
**Change (deduped):** Convert mechanical scrolls to organic flow in one pass: (a) domain-warp the straight-scroll fbm fields — water bioluminescence (L287), molten core churn (L320) *[implement the core-warp ONCE — see Wave 3 hero surface]*, mound veins (L495); (b) replace bounded-sine particle drift (embers/fireflies/dust) with a cheap **curl-noise** velocity field; (c) replace the isotropic `rip` scalar with a 2-axis flow normal driving `reflUV` directionally + feeding Fresnel.
**Corrections:** curl2 — **call once per point** and reuse the vec2 for x/z (the snippet invoked it twice = 8 noise/vert). Flow-normal ripple was near-invisible as written (the `6.0` flat-plane bias neutered `N.xz`) — **use the raw noise for the UV offset** (`reflUV = screenUV.flipX().add(vec2(nx,nz).mul(rippleAmt.mul(6.0)))`) and reserve the normalized `N` only for Fresnel; **define `rippleAmt`** (it's deleted with L272). Bio advection — **use a constant `flowDir=vec2(0.10,-0.55)`**, not a per-pixel time×noise direction (that's an unbounded spatial shear that degrades over a long session).
**Tier:** gate warp + flow-normal to High+ (JS-branch, not ×0). Curl reuses today's sine-wander fallback below High. `flowOctaves` already 0 on Low.
**Perf/board:** water warp is the only fill-sensitive piece (2 extra noise/px on the lake, single pass — reflector likely clips the water plane from its own RT). Curl is 4 noise/vert on ≤1000 points (vertex, trivial). Bio stays shore-masked + centerMask'd.
**Payoff:** high (the specific "liquid" primitive the brief names as absent). **Effort:** M.

### 2.6 Real soft lights for the two PBR heroes (lighting P3, corrected)
**Change:** Add a low `HemisphereLight` (violet sky / plum ground) + a dim warm `DirectionalLight` aimed at the relic. Only `shardMat` (MeshStandard) + `shellMat` (MeshPhysical) respond — every MeshBasic ignores them, so cost is confined to the heroes. Gives the crystals/egg a colored (never-black) fill + a wet-glass specular glint.
**Corrections:** **Drop the "warm-grade the env dome" sub-step** — `envDomeMat` (L216) is *already* a violet→plum gradient with a magenta band; that "fix" was refuted. Keep `castShadow=false` on both. **Track/dispose both lights AND `key.target`** on theme-switch. **Verify the egg's clearcoat (roughness 0.05, clearcoat 1.0) specular from the 0.45 directional stays under bloom 0.40** on a center-x hero — roughen/tilt or accept one small deliberate wet-glass glint, but confirm it doesn't hotspot over the board line.
**Tier:** both lights High+; hemi-only Medium; skip Low/Minimal (branch out — don't ship zero-intensity lights).
**Perf/board:** no shadow maps, no new draws; a few ALU on 2 materials ×2 reflector. Only touches flanked crystals + the above-wedge egg.
**Payoff:** high. **Effort:** M.

### 2.7 Nebula sky + twinkling two-layer stars (sky-grade P1, corrected)
**Change:** Rewrite `skyMat.colorNode` (L62–86): 3-stop vertical gradient (indigo zenith → violet mid → deep-plum near-horizon), a low-key domain-warped fbm nebula lobe in the upper-side sky, and split the single star field into a coarse bloom-eligible layer + a fine dim layer, both with per-star twinkle + slight color temperature.
**Corrections:** use the existing `.oneMinus()` **method** (avoid touching the import). Nebula ALU is paid over the **whole sky sphere ×2 (reflector)** — the `sideMask`/`elev` only zero the *color*, not the noise. **Gate the domain-warp + fractal to Ultra/Extreme** (or cap ≤3 octaves + 1 warp iter); this is the one item to A/B on the dev iGPU per the TDR caution. Nebula capped 0.11 (below the **0.40** bloom threshold — note the real threshold is 0.40, not 0.74).
**Tier:** JS-branch — Minimal/Low keep the 2-stop path; Medium 2 oct no-warp; High 3 oct; Ultra/Extreme 4 oct + warp. Twinkle all tiers.
**Payoff:** high (biggest "less empty" jump; the LUT then unifies it into the duotone). **Effort:** S–M.

---

## 4. Wave 3 — refinement

*Ship individually, screenshot-verified, after Waves 1–2 read right. Grouped by dimension; all corrections folded.*

- **Crystal + egg glass fidelity (material P2, corrected):** egg `roughnessNode` breakup for panel-line reflections + anisotropy sheen (High+/Ultra+). Crystal transmission gems — build a **separate small `MeshPhysicalNodeMaterial` mesh** (`FrontSide` + `forceSinglePass=true`), do NOT mutate the shared instanced `shardMat`; gate Ultra/Extreme on **fill** grounds (transmission samples one shared backdrop, not N passes). **Do NOT raise egg thickness blind** — at ~10× mesh scale, thickness 2.0 may already be correct; to deepen tint, *lower `attenuationDistance`* and re-check it doesn't go opaque. Requires the item-2.1 `envMap` assignment to control intensity.
- **Textured riverbed + procedural caustics (terrain P1 = water caustics, deduped):** blend a dim triplanar fbm lakebed + scrolling caustic veins into the near-shore water. **Inject into `bodyCol` BEFORE `mix(bodyCol,reflColor,reflectivity)` (L280)**, not the post-fresnel `water`. **Clamp before pow** (`pow(clamp(c1+c2)*0.5+0.5,0,1),4)`) — pow(neg,4)=NaN, pow(1.5,4)=5 blows past bloom. Cap peak ≤0.25. Reuses `centerMask`. Verify the reflector clips the water plane before budgeting (likely ~1× not 2×). Gate High+.
- **Triplanar-fbm rock + colored-fill relief on boulders/mound (terrain P2, corrected):** shared hand-rolled triplanar (no import), hand-done `dot()` relief keeping shadows *colored* (indigo→plum), materials stay MeshBasic (value-contrast preserved). **Do NOT run 3-axis + micro at rockOct=4 on foreground boulders** (~18 taps/px ×2) — use biplanar or a single `fbm(positionWorld)` ≤3 octaves, reserve the micro layer for the small/far mound. `computeVertexNormals()` **once after final displacement** (turns the boulder rim faceted — verify the look change).
- **Near-foreground parallax anchors (composition P3, corrected):** re-stage 2–4 boulder instances into the lower corners (no new draws). **Cap near-anchor z ≤ ~+16** so they stay ≥~16–18u from the lens even at the full 2.4 dolly-in (they were costed against the static camera and would balloon/near-clip). **Pin x as a fraction of the per-aspect HORIZONTAL frustum half-width** (fov is vertical in three.js — a fixed ±11 drifts toward center at 16:9). Keep the existing base scale 5..18 (the "×2.5–4" would *shrink* them).
- **Living hero surface (fluidity P3, corrected):** animate egg-shell displacement (**keep amplitude ~0.02–0.03 local**, not 0.05–0.07 — normals aren't recomputed, so larger amplitude makes the hero glass visibly "swim"); traveling crack-energy wave along `crackField`; **roiling molten core — implement the domain-warp ONCE here** (deduped from item 2.5).
- **Planet upgrade (sky-grade P2):** soft terminator + limb-darkening (free); additive corona billboards (**`depthTest=false` + `depthWrite=false`** so the halo reads beyond the silhouette; add ≤5 meshes to `update()` for quaternion billboarding); Cassini gap + inner/outer ring color + shadow arc. Low ROI on-screen (planets are tiny, Cosmos-gated S>0.85) — **skip the Saturn-ring PBR-metal conversion** (marginal).
- **Inertial spring eases + micro-orbit + sky twinkle (fluidity P4):** critically-damped `smoothDamp` for cursor parallax + `sEased` (**compute `dt` inside `camera()` via a `prevCamTime` closure**; per-channel velocity refs). Micro-orbit folds into item 2.4. Sky shimmer/twinkle is the one fill item — gate High+, A/B it.
- **Crystal→terrain integration (terrain P3):** cyan ground-bounce halos baked into the mound (all tiers) + masked water (High+) via the existing ring-loop; fbm-fracture crystal interiors (**use `positionWorld` or a per-instance seed, not `positionLocal`** — else all crystals share one pattern); Extreme-only base-scree instances. All `centerMask`'d.
- **Riverbed vein richness (terrain P4, corrected):** domain-warped crevice-pooled veins + wet-shoreline rim + mirrored second mound (Ultra+). **Compile-blocking fix: `const p2 = positionLocal.xy.mul(0.05)`** (must be vec2 — the vec3 form makes `vec3(p2,0)` a 4-component error). Scale vein color ×0.5 to match today's ~0.45 peak (or accept as intentional off-center climax bloom at `|x|≥40`).
- **Anisotropic specular glitter path (water P4, corrected):** replace the crude single glint with a reflected horizon-band + crystal specular. **Fix `grazeBoost` — drop `.oneMinus()`** (current form zeroes glitter exactly at the horizon where the light-path belongs). **`horizonKey` needs a −z component** (front band is toward −z; +z points behind camera). Cap gain ≤0.44 (peak `specH*0.95*0.7≈0.665` > 0.40 bloom) or intend the sparkle bloom. Adds `reflect` import.

---

## 5. Dropped / not worth it

| Proposal | Adversarial reason it's dropped/refuted |
|---|---|
| **Per-material `envMapIntensity` as a standalone lever** | No-op: materials have no per-material `envMap`, so the node returns `scene.environmentIntensity`. Every tuning number is silently ignored. (Rescued only by assigning `envMap` per material — item 2.1.) |
| **`WEBGPU.PMREMGenerator` backend branch** | Invented symbol — `three/webgpu` ships exactly one `PMREMGenerator`; the existing `new THREE.PMREMGenerator(renderer)` already handles the fallback. |
| **Bloom-as-DOF term** (`mix(baseCol, bloomNode.rgb, fogAmt)`) | Conceptually broken: `bloomNode` is thresholded+blurred *highlights*, not a blurred frame. Far peaks are near-black → ~zero bloom → this *darkens* them toward black (inverse of the intended horizon-lift) and blurs nothing. |
| **`dof()` bokeh node as the DOF default** | Not "one ~1ms pass" — `DepthOfFieldNode` runs **7 RT passes/frame** incl. two 64-tap loops, stacked on the reflector double-draw + bloom. Real TDR risk on the dev iGPU. Use the analytic 4-tap far-blend as default; reserve `dof()` for Ultra/Extreme behind a hard A/B (with corrected args: positive `focusDistance≈139`, `focalLength≈25–40`, `bokehScale≈1.5–3`). Also can't keep crystals/additive FX sharp — they're `depthWrite:false` and inherit far depth. |
| **Egg-glow pool in the lake** (lighting P4) | Self-defeating: `centerKeep=smoothstep(18,46,|x|)` is 0 at x=0 where the egg sits, so the mask *zeroes the pool exactly where it should be brightest* and leaks light to the board flanks. Both its smoothsteps were reversed-edge too. |
| **Warm-grade the PMREM env dome** (lighting P3 sub-step) | Refuted — `envDomeMat` (L216) is *already* a violet→plum gradient + magenta band. Not a fix; pure taste at best. |
| **Saturn-ring PBR-metal conversion** (material P3) | Lowest ROI: ~20u sphere 680u away, upper sky, visible only at the Cosmos beat. Keep it MeshBasic with the emissive fallback. |
| **Depth-aware POST aerial-perspective** (atmosphere P3) | The tint half survives (fold into the composition dead-zone / grade if wanted), but it double-fogs the fog-exempt sky dome (`depthWrite:false` → far-plane depth → `fogAmt=1`) unless masked, and its headline DOF half is the dropped bloom-as-DOF bug. Not worth a dedicated item over per-material height fog (1.2) + LUT (2.2). |

---

## 6. Recommended first batch on GO

Ship **Wave 1's four pure-ALU/CPU items together** — they are mutually independent, all board-safe, all-tier, zero new passes, and together they flip the scene from "flat cutouts that wobble" to "modeled, atmospheric, breathing forms" before any render-target risk:

1. **1.1 Twilight fill + egg-as-practical-light** — the single biggest gap (colored bounce). *Prereq: add `Fn` import, `moundGeo.computeVertexNormals()`, track `RELIC`.*
2. **1.2 Height-fog + azimuthal tint in `peakMat`** — mountains finally read with aerial-perspective depth. *`scene.fog` untouched/null; guard the azimuth.*
3. **1.3 Wet reflector + `centerMask`** — kills the hard-mirror read and establishes the shared `centerMask` the later water items build on.
4. **1.4 Desynced crystal breath + split relic throb** — wakes the largest frozen mass + breaks the lockstep hero LED. *Per-instance `aPhase`/`aRate` attributes, not `instanceIndex`; corrected sway mask.*

**Verification workflow (per CLAUDE.md, non-negotiable):** iterate each in
[src/playground/effects/vesper-chrysalis.effect.js](../src/playground/effects/vesper-chrysalis.effect.js) →
`http://localhost:5173/playground.html?effect=vesper-chrysalis`; wait for `window.__PLAYGROUND_READY__ === true`;
capture with the chrome-devtools MCP and read the console for WebGPU validation errors. Shoot the **Dormant state
(`?t=6`, S≈0)** *and* a **waking state (S≈0.6)** — confirm (a) the colored fill deepens the darks without lifting
the low-key floor (egg emissive 1.0–1.8 still dominates fill ≤0.13), (b) nothing new crosses the 0.40 bloom
threshold in the center wedge, (c) the per-instance breath resolves on-device (attribute path, not the refuted
`instanceIndex` varying). One effect per capture session — do NOT stack these into a single screenshot (TDR caution
on the iGPU). Because the theme wrapper imports this same effect file, the proven changes are *already* live in the
in-game theme — but the playground has **no board**, so after a clean playground capture, re-verify the **board
wedge + egg lake-reflection across S=0→1 in-game** (Serenity mode).

**Then, in order:** 2.1 PMREM + 1.3 (already shipped) = the "low-res reflection" pair → 2.2 LUT grade (behind `?gradeV2`) → 2.4 cinematic camera + dead-zone → 2.3 veils+mist → 2.5 domain-warp/curl → 2.6 hero lights → 2.7 nebula sky (A/B on the iGPU). Wave 3 items ship one at a time as polish.
