# Void Ember — AAA WebGPU Rebuild Plan

> **Goal**: Turn Void Ember into a **best-in-class, mesmerizing WebGPU theme** — a single dying ember/star adrift in the infinite dark, so alive and cinematic it produces an instant *WOW*. We keep the elegant low-level architecture that already makes this theme special (raw WGSL compute + raymarch, **no three.js**), and rebuild the *visuals* around three game-changing techniques plus a reactive "life-state" conductor — mirroring the process that produced [Electric Dreams V3](ELECTRIC_DREAMS_V3_AAA_PLAN.md) and the [Winter "Living Blizzard"](WINTER_AAA_PLAN.md) rebuilds.

> **Status**: Planning. Current Void Ember is a competent screen-space procedural scene. This plan is the reinvention that takes it from "nice bloom blob" to "a living star you could fall into."

---

## TL;DR — Three Hero Techniques (+ one conductor)

| Technique | Used by / proven in | Why it transforms Void Ember |
|---|---|---|
| **★ Living Star Volumetric** — a true 3D bounded raymarch of a plasma star: granulation convection cells, domain-warped filaments, sunspots, churning chromosphere + corona | Sangil Lee's realistic-sun shaders; Inigo Quilez volumetric clouds | Replaces today's flat 2D radial glow ([scene.wgsl:257-300](../src/themes/void-ember/wgsl/scene.wgsl#L257)) with a star that *boils and breathes*. This is the single biggest WOW upgrade — depth, surface, and motion where there is currently a gradient. |
| **Physically-grounded light** — Beer–Lambert absorption + Henyey–Greenstein phase scattering for the volume, and a **black-body / Planckian-locus** temperature ramp driving every emissive surface | Maxime Heckel volumetric cloudscapes; the Planckian locus | Separates "orange gradient" from *real incandescent matter*. The star glows by temperature (deep-red shell → amber → white-hot core → blue when raging), so colour is physical, not hand-keyed. Temperature is gameplay-driven. |
| **Cinematic optics stack** — anamorphic lens-flare composite (ghosts + halo + horizontal streak + diffraction starburst), dual-filter bloom pyramid, screen-space heat-haze refraction, gravitational lensing of the background, ACES + chromatic aberration + film grain | Froyok/Bart Wronski lens-flare work; Kawase/dual-filter bloom | Makes the whole frame feel *shot through a real anamorphic cine lens*. Replaces the single-pass tap bloom + uniform starburst ([post.wgsl:107-151](../src/themes/void-ember/wgsl/post.wgsl#L107)) that currently reads as a default lens-flare star. |
| **Stellar Conductor** (the choreography layer) | mirrors `StormDirector` (Winter) / `StageConductor` (Electric Dreams) | The star *is* the game's emotional state. Idle = a calm, slow-breathing ember; combos agitate the surface; line clears fire coronal-mass-ejection rings; tetris/level-up detonate a flare-nova; sustained pressure drives the colour temperature up and the corona wild. |

These compound: better physics **and** better visuals **and** a clearer identity at once — they are not trade-offs against each other.

---

## 1. Why Rebuild The Visuals (Not Replace The Architecture)

Void Ember is **architecturally unusual and good**: it is a standalone, three.js-free WebGPU pipeline ([void-ember-theme.js](../src/themes/void-ember/void-ember-theme.js)) — its own `device`/`context`, hand-rolled compute + render + post passes, raw WGSL, HDR `rgba16float` intermediates, timestamp-query performance governor, and a clean Canvas2D fallback. This is the *correct* foundation for a screen-space procedural cosmic scene, and converting it to three.js/TSL would be a regression in control and a pointless rewrite. **We keep the pipeline shape and rebuild what it draws.**

What the current frame gets wrong (diagnosis from the screenshots + code):

1. **The star reads as 2D.** The volumetric march is capped at 40 steps with a 3-octave coarse + single fine `noise3` ([scene.wgsl:69-80, 257-300](../src/themes/void-ember/wgsl/scene.wgsl#L257)). The result is a soft radial glow with a few sinusoidal filaments — a bloom blob, not a surface. There is no granulation, no limb, no sense the core is a churning body.
2. **The god-rays starburst is uniform and garish.** The 6-sample radial march ([post.wgsl:144-151](../src/themes/void-ember/wgsl/post.wgsl#L144)) plus undifferentiated taps produces an even, hard "default lens-flare" star rather than cinematic, occluded shafts and real flare ghosts.
3. **The nebula is nearly invisible.** `nebula_clouds` ([scene.wgsl:140-160](../src/themes/void-ember/wgsl/scene.wgsl#L140)) is a thin 2-octave 2D function multiplied to near-zero — the background is mostly flat black, so there is no depth or scale.
4. **The blue dot looks like an artifact.** It is the bright tier of `star_field` ([scene.wgsl:128-133](../src/themes/void-ember/wgsl/scene.wgsl#L128)) — a lone over-bright blue-white point with no companion structure, so it reads as a bug, not a star.
5. **Composition wanders aimlessly.** The Lissajous drift ([void-ember-theme.js:1049](../src/themes/void-ember/void-ember-theme.js#L1049)) sends the ember roaming the whole screen with no compositional intent, no parallax, no sense of a camera.
6. **Colour is hand-keyed, not physical.** `COLOR_STOPS` ([void-ember-theme.js:48-55](../src/themes/void-ember/void-ember-theme.js#L48)) is a pretty but ad-hoc 5-stop cycle; it lacks the deep-red→white-blue black-body range and the white-hot core punch that sells "incandescent."
7. **Bloom is single-pass.** Nine hand-placed taps + a few streak taps ([post.wgsl:107-132](../src/themes/void-ember/wgsl/post.wgsl#L107)) cannot produce the soft, wide, layered HDR bloom that AAA frames rely on.

What we **keep**:

- The whole **pipeline contract**: compute → scene → particles → post → present, HDR intermediates, premultiplied present.
- **Quality-tier infrastructure** ([void-ember-presets.js](../src/themes/void-ember/void-ember-presets.js)) + the **timestamp-query adaptive downshift** ([void-ember-theme.js:1466](../src/themes/void-ember/void-ember-theme.js#L1466)) — redefine the numbers, keep the governor.
- **Event-bus subscriptions** ([void-ember-theme.js:959-1016](../src/themes/void-ember/void-ember-theme.js#L959)) — same contracts; handlers get rewritten to drive the Stellar Conductor instead of poking raw runtime channels.
- The **Canvas2D fallback** ([void-ember-theme.js:1490](../src/themes/void-ember/void-ember-theme.js#L1490)) — upgraded lightly, kept as the no-WebGPU path.
- **Device-lost resilience + teardown** plumbing — untouched.

---

## 2. The Cinematic Vision

### Hero composition
A single **living star/ember** anchored off-centre on a rule-of-thirds point (not roaming the full screen). It is a believable body: a churning granulated surface, a soft chromospheric limb, plasma filaments arcing off it, dark drifting sunspots, and a turbulent corona that licks outward. It **breathes** — a slow, ~6-second pulse at idle — and its colour is set by temperature, deep-red-cool at rest. Around it, the deep-space environment recedes with real depth; in front of it, cinders and dust drift past the "camera" with parallax. Game events are felt *in the star's body*: it boils faster, throws coronal mass ejections, flares to white-blue, and detonates.

### Compositional depth (parallax layers, virtual camera)
Even though this is a 2D screen-space pipeline, we fake a camera: a slow virtual-camera drift + event-driven push offsets each layer by a parallax factor, giving real depth.

```
LAYER 0 — DEEP-SPACE GRADIENT + MILKY-WAY BAND        parallax 0.02x
  Rich night gradient (indigo→violet→near-black), a faint diagonal
  galactic dust band, large-scale colour variation. Never pure black.

LAYER 1 — VOLUMETRIC NEBULA                            parallax 0.06x
  Beer's-law + HG-phase raymarched 3D noise volume, domain-warped wisps,
  emission-lit by the star's colour. Half-res + temporal accumulation.
  Gives the void scale and a sense of "weather."

LAYER 2 — MULTI-LAYER STARFIELD                        parallax 0.05–0.20x
  3–4 depth layers, per-star black-body colour + size + twinkle, a few
  hero stars with diffraction spikes, distant galaxy smudges. No lone
  blue artifact — stars come in believable distributions.

LAYER 3 — ★ HERO STAR VOLUMETRIC (the centerpiece)     parallax 0.0x (anchor)
  Bounded 3D raymarch: granulation cells, domain-warped filaments,
  sunspots, chromosphere limb, corona + prominences. Black-body colour
  by temperature. Self-illuminating, HG-scattered, emissive→bloom.

LAYER 4 — EMBER / SPARK / CINDER FIELDS                parallax 0.3–1.5x
  GPU curl-noise particles in classes: rising sparks (hot, short-lived,
  trailed), drifting cinders (cooler, tumbling), and far dust motes that
  catch the star's light. Black-body colour by per-particle heat.

LAYER 5 — HEAT-HAZE + GRAVITATIONAL LENS (screen-space) overlay
  Refractive UV distortion sourced from volume density near the star;
  subtle lensing warp of the background ring around the core.

LAYER 6 — CINEMATIC OPTICS (foreground overlay)         overlay
  Anamorphic lens flare (ghosts along the optical axis, halo, horizontal
  streak, diffraction starburst), barrel + chromatic refraction at edges,
  faint film grain.

POST STACK (in order):
  → dual-filter bloom pyramid (downsample/upsample, soft & wide)
  → lens-flare composite (anamorphic + ghosts + starburst)
  → heat-haze + lensing refraction
  → temporal accumulation (history clamp; suppressed on flares)
  → ACES filmic tonemap + subtle LUT-style grade
  → chromatic aberration (edge-weighted) + vignette + film grain + dither
```

### The star, in detail (Layer 3 — the WOW)
This is where the budget goes. Built from techniques proven in real-time sun shaders and volumetric cloud rendering:

- **Granulation**: FBM (5–6 octaves, lacunarity ~2.02, gain ~0.5) with **per-octave rotation** to kill axis-aligned artifacts, plus a Worley/Voronoi term for convection-cell boundaries. Animated by slow 3D noise time-evolution (`floor`/`fract` blend on scaled time) so cells boil rather than slide.
- **Domain warping**: warp the sample position by two offset FBM calls before the final density read — this produces the swirling plasma filaments and sunspot tendrils instead of the current single sinusoid.
- **Sunspots**: low-frequency noise threshold carves cooler (darker, lower-temperature) patches that drift across the surface.
- **Limb / chromosphere**: a Fresnel-style limb term (`pow(1+dot,2)` outer + `pow(0.2-0.7·dot,5)` inner) gives the bright rim and centre-to-edge falloff of a real disc.
- **Corona + prominences**: the existing arc system ([scene.wgsl:166-201](../src/themes/void-ember/wgsl/scene.wgsl#L166)) is reworked into temperature-coloured looped filaments that follow the flow field and whip on flares; corona uses an outward HG-scattered march.
- **Black-body colour**: a Planckian-locus ramp maps local temperature → RGB. Core white-hot, shell deep-red, sunspots cooler. The whole ramp shifts hotter with gameplay intensity.
- **Scattering**: Beer–Lambert transmittance accumulation + Henyey–Greenstein phase so the corona/filaments have believable forward-scatter glow rather than flat additive haze.

### Identity
"Void Ember" = *warmth against the infinite dark; a fragile, dying heart of fire that flares to life when you play.* Loneliness and awe. Calm and red at rest, blinding and blue-white at peak. The dark is never empty — it's deep space, with weather.

---

## 3. The Reactive Layer — Stellar Conductor

A pure-JS, dependency-free choreographer (`composition/stellar-conductor.js`) that owns the star's **life-state** and exposes smooth channels the shaders read. It mirrors `StormDirector`/`StageConductor`: gameplay events raise targets; the conductor integrates them into eased, physically-plausible state and writes them into the uniform block. **No GPU dependency → shippable and node-testable on day one** (this is the Winter Phase-0 pattern that landed cleanly).

Channels (superset of today's runtime in [void-ember-theme.js:139-162](../src/themes/void-ember/void-ember-theme.js#L139)):
- `temperature` — drives the black-body ramp (idle ~3000K-feel red → peak ~9000K-feel blue-white)
- `agitation` — surface boil speed + filament turbulence
- `coronaEnergy` — corona reach + prominence whip
- `breath` — slow idle pulse (always on)
- `cmePulse` — coronal-mass-ejection ring (line clears)
- `novaFlash` — full flare-nova (tetris / level-up)
- `cameraPush` / `parallax` — virtual-camera shove on impacts
- plus the existing shock/flare/flash/intensity/pulse, repurposed

### Three-act life arc (driven by intensity, like Electric Dreams' acts)

| Act | When | Star | Environment | Optics |
|---|---|---|---|---|
| **I — Ember** | early / idle | slow breath, deep-red, calm granulation, short prominences | cool indigo nebula, sparse sparks | gentle bloom, faint flare |
| **II — Kindling** | combos building | surface boils faster, amber, longer filaments, more sparks | nebula warms toward orange, dust accelerates | bloom widens, streak appears |
| **III — Inferno** | sustained pressure | white-hot→blue, violent corona, CMEs frequent, dense embers | nebula glows hot, heat-haze strong | full anamorphic flare, CA pulses, god-rays surge |

### Beat-level reactivity (rewrites the handlers at [void-ember-theme.js:959-1016](../src/themes/void-ember/void-ember-theme.js#L959))

| Event | Star body | Particles | Optics / camera |
|---|---|---|---|
| Piece lock | tiny inward pulse, brief heat tick | small spark puff | — |
| Hard drop | core flash + downward heat jolt | radial spark burst | small impact bloom, micro camera punch |
| Single/double line | CME ring expands from core, temp tick | wave of embers along ring | brief flare ghost |
| Tetris | flare-nova: white-blue flash, corona detonation, 250ms surface storm | radial detonation + trails | bloom +, starburst spike, 1-frame anamorphic flare, CA pulse |
| Combo 4 | agitation ramp, filaments whip | sparks accelerate | streak intensifies |
| Combo 7+ | sustained inferno: temp climbs, 3 prominences whip, corona max | dense ember storm | god-rays surge, camera dolly-push + parallax, saturation up |
| Level up | temperature step + colour drift sweep | ember colour shift | LUT-style grade cross-fade |
| Game over / exit | collapse: corona retracts, temp cools to red, surface slows, dims | embers settle and fade | bloom fades, vignette darkens, slow settle |

---

## 4. Technical Architecture

### Pipeline passes (per frame)

```
CPU (target < 0.7 ms):
  - stellarConductor.update(delta, events)   // integrate life-state, write uniforms
  - virtualCamera.update(time, fxState)      // parallax + push offsets
  - updateUniformBuffer()                    // single uniform block (grow to ~64 floats)

GPU command buffer:
  1. flow.compute        // curl-noise velocity/density/heat grid (upgraded)
  2. particles.compute   // multi-class embers + trails (upgraded)
  3. environment.render  // nebula volume (half-res) + starfield + milky way → env target
  4. star.render         // ★ hero volumetric star → scene target (composites env behind)
  5. particles.render    // additive embers/sparks with black-body colour
  6. bloom.down × N      // dual-filter downsample pyramid (bright-pass at mip 0)
  7. bloom.up × N        // upsample + combine → soft wide bloom
  8. lensflare.render    // ghosts/halo/streak/starburst from bright-pass
  9. composite.render    // base + bloom + flare + heat-haze + lensing + temporal
 10. grade.render        // ACES + CA + vignette + grain + dither (can fold into 9)
 11. present.render      // blit to swapchain
```

This keeps today's structure and inserts the bloom pyramid + dedicated environment/lens-flare passes. Most passes are full-screen `rgba16float`; the nebula volume and bloom mips run at reduced resolution.

### File structure (modularize the 1,607-LOC monolith)

Mirror the house style (Winter / Electric Dreams V3 use `sim/ rendering/ post/ composition/`). For a raw-WGSL theme the JS modules are thin pass-builders; the heavy logic lives in WGSL.

```
src/themes/void-ember/
├── void-ember-theme.js              ~550 LOC  Thin orchestrator (device, frame loop, fallback)
├── void-ember-presets.js            ~160 LOC  Quality tiers (expanded)
├── void-ember-gpu.js                ~250 LOC  Pipeline/bindgroup/texture builders (extracted)
├── composition/
│   └── stellar-conductor.js         ~260 LOC  Life-state arc + beat reactions (pure JS) ← Phase 0
├── sim/
│   ├── flow-field.js                ~120 LOC  Curl-noise flow pass wiring
│   └── ember-particles.js           ~160 LOC  Multi-class particle seeding + wiring
├── rendering/
│   ├── environment.js               ~140 LOC  Nebula volume + starfield pass wiring
│   └── star-volume.js               ~160 LOC  Hero star pass wiring
├── post/
│   └── post-pipeline.js             ~280 LOC  Bloom pyramid + lens flare + composite wiring
└── wgsl/
    ├── flow.wgsl                    Curl-noise upgrade (divergence-free field)
    ├── particles.wgsl               Multi-class embers + trail history
    ├── environment.wgsl             ★ Nebula raymarch (Beer+HG) + starfield + milky way
    ├── star.wgsl                    ★ Hero star volumetric (granulation+warp+corona+blackbody)
    ├── bloom-down.wgsl              Dual-filter downsample (bright-pass at level 0)
    ├── bloom-up.wgsl                Dual-filter upsample/combine
    ├── lens-flare.wgsl              ★ Ghosts + halo + anamorphic streak + starburst
    ├── composite.wgsl              ★ Base+bloom+flare+heat-haze+lensing+temporal+grade
    └── present.wgsl                 Blit (unchanged)
```

A shared `void-ember-common.wgsl` snippet (hashing, value noise, FBM, rotation, black-body ramp, HG phase, Beer's law) is concatenated into each module to avoid duplication.

### Black-body colour (shared helper)
A compact Planckian-locus approximation (polynomial fit, temperature in a normalized 0..1 "heat" range mapped to ~1000K–12000K) returns linear RGB. Used by the star ramp, sparks, prominences, and CME rings so all incandescent matter shares one physical colour model. Replaces `COLOR_STOPS` ([void-ember-theme.js:48-55](../src/themes/void-ember/void-ember-theme.js#L48)); the slow evolution cycle becomes a slow drift along temperature instead of a hand-keyed RGB loop.

---

## 5. Performance Budget

This is a **fill-rate-bound** pipeline (cost ∝ resolution × march steps), not particle-count-bound. The hero star raymarch and the nebula volume are the two big line items; we control them with step counts, half-res, and temporal accumulation. Targets are for the **Ultra** tier at 1080p internal.

| Component | Budget | Internal res | Notes |
|---|---|---|---|
| Flow compute (curl-noise grid) | 0.2 ms | grid | unchanged order of magnitude |
| Particle compute (multi-class + trails) | 0.4 ms | — | a few thousand particles max |
| Environment (nebula volume + stars) | 2.0 ms | 0.5x + temporal | 16–24 steps, blue-noise jitter, reproject |
| ★ Hero star raymarch | 4.0 ms | full | 48–64 steps, bounded march, early-out on transmittance |
| Particle render (additive) | 0.4 ms | full | trailed quads |
| Bloom pyramid (down+up, 5–6 mips) | 1.2 ms | ≤0.5x | dual-filter, cheap and soft |
| Lens-flare composite | 0.5 ms | 0.5x | ghosts/halo/streak from bright-pass |
| Composite (heat-haze+lensing+temporal+grade) | 1.3 ms | full | single big pass |
| Present | 0.1 ms | native | blit |
| **CPU orchestration** | 0.7 ms | — | conductor + camera + uniforms |
| **Headroom** | 5.5 ms | — | OS jitter, GC, browser tax |
| **TOTAL** | **~16.3 ms** | | ~60 FPS sustained at Ultra |

**Adaptive scaling**: keep the timestamp-query governor ([void-ember-theme.js:1466](../src/themes/void-ember/void-ember-theme.js#L1466)). When frames stretch, it first lowers star/nebula step counts and bloom mips, then `renderScale`, then drops a tier — so quality degrades gracefully before resolution does.

### Per-tier presets (expand [void-ember-presets.js](../src/themes/void-ember/void-ember-presets.js))

| Preset | renderScale | Star steps | Nebula steps / res | Bloom mips | Lens flare | Heat-haze | Temporal | Particles | Target |
|---|---|---|---|---|---|---|---|---|---|
| Minimal | 0.55 | 20 | off | 3 | off | off | off | 200 | 60 FPS mobile |
| Low | 0.68 | 28 | 10 / 0.4x | 4 | streak only | off | off | 400 | 60 FPS iGPU |
| Medium | 0.85 | 40 | 16 / 0.5x | 5 | streak+halo | subtle | off | 900 | 60 FPS desktop |
| High | 1.0 | 52 | 20 / 0.5x | 5 | full | yes | yes | 1600 | 120 FPS RTX 3070 |
| Ultra | 1.1 | 64 | 24 / 0.5x | 6 | full+ghosts | yes | yes | 2400 | 60 FPS RTX 3070 |
| Extreme | 1.2 | 80 | 32 / 0.6x | 6 | full+ghosts | strong | yes | 3600 | 60 FPS RTX 4080 |

---

## 6. Implementation Phases (~12–15 working days)

Gated by exit criteria; nothing advances until criteria are met. Critical path: 0 → 1 → 2 → 3 → (4,5,6 parallel) → 7 → 8.

| Phase | Scope | Exit criteria | Effort |
|---|---|---|---|
| **0. Conductor + scaffold** | `stellar-conductor.js` (pure JS life-state + beat reactions, node-testable); extract `void-ember-gpu.js`; create subdirs + `void-ember-common.wgsl`; wire conductor into the uniform block behind a `?voidStorm=1`-style debug flag. **No visual change yet, WGSL untouched.** | Theme builds + lints clean; conductor unit-verifiable; temperature/agitation visibly track combos in the debug overlay | 1.5 d |
| **1. ★ Hero star volumetric** | Rebuild `star.wgsl`: bounded 3D march, FBM+per-octave rotation granulation, domain warp, sunspots, Fresnel limb, Beer+HG corona, black-body ramp | Star reads as a churning 3D body with a limb and boiling surface, not a radial gradient | 2.5 d |
| **2. Black-body colour + environment** | Shared Planckian ramp; rebuild `environment.wgsl`: proper volumetric nebula (Beer+HG, domain warp, half-res+temporal), rich gradient + milky-way band, believable starfield (no lone blue artifact) | Background has depth/scale/colour; star + sparks share one physical colour model | 1.5 d |
| **3. Dual-filter bloom pyramid** | `bloom-down.wgsl`/`bloom-up.wgsl`; replace single-pass taps; bright-pass at mip 0 | Soft, wide, layered HDR bloom; no tap-pattern artifacts | 1 d |
| **4. Cinematic optics** | `lens-flare.wgsl` (ghosts/halo/anamorphic streak/diffraction starburst) + heat-haze + gravitational lensing + CA + grain in `composite.wgsl` | Anamorphic flare + heat shimmer visible; frame feels lens-shot | 2 d |
| **5. Particles + curl-noise flow** | Upgrade `flow.wgsl` to divergence-free curl noise; multi-class embers + trails in `particles.wgsl`; black-body per-particle colour | Sparks rise/trail, cinders tumble, dust catches light; all heat-coloured | 1.5 d |
| **6. Virtual camera + parallax** | Layer parallax offsets + event-driven camera push/dolly in the conductor & uniforms | Background, nebula, embers parallax believably; impacts shove the camera | 1 d |
| **7. Presets + adaptive + reactivity wiring** | Calibrate all 6 tiers; point the governor at star/nebula steps → bloom → renderScale → tier; wire every event to a distinct conductor beat | Hits target FPS per tier; every gameplay event has a visible, distinct response | 1.5 d |
| **8. Fallback + polish + profile + ship** | Refresh Canvas2D fallback; Chrome GPU profile; spike hunt; dispose/teardown audit; 10× theme-swap memory check; browser-verify on WebGPU **and** WebGL/2D | 60 FPS sustained Ultra; no spikes > 18 ms over an idle→tetris→10×combo→game-over run; flat memory across swaps | 1.5 d |

---

## 7. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Hero star raymarch is fill-rate heavy at 4K | High | Bounded march (skip empty space outside the star's screen radius); early-out on transmittance; step count is the first adaptive lever; render star at `renderScale`, not above |
| Nebula volume shimmers under camera/parallax motion | Medium | Half-res + temporal reproject with history clamp + blue-noise jitter (Heckel pattern); clamp reprojection on big flares |
| Black-body ramp looks "wrong" / too saturated | Medium | Tune in linear space against reference images; expose a single warmth bias; keep core white-hot, avoid neon |
| Anamorphic flare overpowers the frame | Medium | Drive flare intensity from bright-pass luminance with a soft knee; cap; only ghosts on High+; user-testable in Phase 4 |
| Temporal accumulation ghosts on rapid combos | Medium | Suppress temporal mix on flare/flash/shock (already done at [post.wgsl:155-161](../src/themes/void-ember/wgsl/post.wgsl#L155)); keep variance/neighbourhood clamp |
| WGSL include/concat duplication drifts | Low | Single `void-ember-common.wgsl`, concatenated at module build; one source of truth for noise/blackbody/phase |
| Scope overrun on optics polish | Medium | Phases 4 & 6 are the soft variables; ship core (star + colour + bloom) first, layer optics, defer ghost/lensing nicety if needed |
| Mobile/iGPU can't afford volumetrics | Medium | Minimal/Low tiers cut nebula volume + flare + heat-haze and lower star steps; Canvas2D fallback unchanged |

---

## 8. Definition of Done

Ships only when ALL are true:

- [ ] **60 FPS sustained on Ultra** (1080p) on RTX 3070 / M-class, verified via the timestamp-query governor + Chrome perf overlay over a 5-minute soak.
- [ ] **No frame-time spikes > 18 ms** during idle → hard-drop → tetris → 10× combo → level-up → game-over.
- [ ] **The star reads as a living 3D body** — granulated, limbed, boiling — in a side-by-side vs. the current build.
- [ ] **The void has depth** — nebula + multi-layer starfield + parallax; the lone-blue-dot artifact is gone.
- [ ] **All incandescent matter shares the black-body model** (star, sparks, prominences, CME rings).
- [ ] **Every event from the current theme has a distinct, visible response** (no regression in event-bus contracts).
- [ ] **All 6 quality tiers** hit their target on at least one representative device.
- [ ] **Canvas2D fallback** still renders a tasteful ember (no WebGPU path required).
- [ ] **Memory flat** across 10 theme-in/out cycles; **zero console errors**, **zero shader-compile warnings**, **lint clean** on changed files.
- [ ] **Browser-verified** on WebGPU and on the WebGL/2D fallback; this doc kept current with what shipped.

---

## 9. Out of Scope (deliberate cuts)

- No three.js / TSL migration — the raw-WGSL pipeline stays.
- No real orbital mechanics or N-body — the "physics" is plasma/scattering aesthetics, not a simulator.
- No image/video texture or HDRI asset dependencies — everything stays procedural (matches the theme's `init()` no-assets contract).
- No editable colour picker — palette is locked to the black-body harmony.
- No VR/AR path; single screen-space "camera."
- No saved-state replay — every frame remains a pure function of (time, fxState).

---

## 10. Technical References

Studied during planning; each informs a specific choice above.

- [Create a Realistic Sun with Shaders — Sangil Lee](https://sangillee.com/2024-06-29-create-realistic-sun-with-shaders/) — granulation via 6-octave fBm + per-octave rotation, domain warp, Fresnel limb/glow, orange→white temperature mix. Drives the **hero star** (Phase 1).
- [Real-time Cloudscapes with Volumetric Raymarching — Maxime Heckel](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) — Beer's law, Henyey–Greenstein phase, light-march self-shadowing, blue-noise jitter, half-res + bicubic upscale. Drives the **nebula volume + corona scattering** (Phases 1–2).
- [Planckian locus — Wikipedia](https://en.wikipedia.org/wiki/Planckian_locus) and [Black Body color — pIXELsHAM](https://www.pixelsham.com/2013/03/14/black-body-color/) — temperature→RGB for the **black-body ramp** (Phase 2).
- [Blackbody — Scratchapixel](https://www.scratchapixel.com/lessons/cg-gems/blackbody/blackbody.html) — Planck's-law spectrum background for the ramp fit.
- [Custom Lens-Flare Post-Process in Unreal — Froyok](https://www.froyok.fr/blog/2021-09-ue4-custom-lens-flare/) and [Anamorphic lens flares — Bart Wronski](https://bartwronski.com/2015/03/09/anamorphic-lens-flares-and-visual-effects/) — ghosts/halo/streak structure for the **lens-flare composite** (Phase 4).
- [Sun Beams / God Rays Breakdown — Cyanilux](https://www.cyanilux.com/tutorials/god-rays-shader-breakdown/) — radial occlusion shafts for cinematic **god rays** (Phase 4).
- [Rendering volume aurorae and nebulae — Toni Sagristà](https://tonisagrista.com/blog/2024/rendering-aurorae-nebulae/) — domain-warp wisps + emission for the **nebula** (Phase 2).
- [Volumetric Raymarching — Xor (GM Shaders)](https://mini.gmshaders.com/p/volumetric) — compact march/accumulation patterns; cross-check for the **star + nebula** loops.
- [Inigo Quilez — Clouds / al-ro — Starry Night / Suyoku — Volumetric sample (Shadertoy)] — canonical volumetric references for self-shadowed march tuning.

---

## 11. What This Plan Says No To

- **No "just crank the bloom."** Bloom can't fake a surface; the star has to actually be volumetric.
- **No "more particles = more wow."** Embers are meaningful (rise, trail, cool), not confetti.
- **No throwing away the architecture.** The raw-WGSL screen-space pipeline is a strength; we rebuild what it draws, not how it draws.
- **No hand-keyed colour cycle.** Colour comes from temperature, physically, so it's coherent everywhere and reactive for free.

---

*End of plan. First commits (Phase 0): (1) add `composition/stellar-conductor.js` as a dependency-free life-state + beat module with a debug overlay flag; (2) extract `void-ember-gpu.js` pipeline/bindgroup builders out of the theme monolith; (3) scaffold `sim/ rendering/ post/` dirs + `wgsl/void-ember-common.wgsl`; (4) wire the conductor into the uniform block additively, WGSL visuals untouched, build + lint clean.*
