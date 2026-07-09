# Winter — AAA WebGPU "Living Blizzard" Rebuild Plan

> **Goal**: Turn the Winter theme into a **mesmerizing, world-class WebGPU snowstorm** — a living blizzard with a dancing volumetric aurora as its heart, that delivers an immediate *WOW* and reads as a AAA-game-quality scene, not a screensaver. This plan is the winter sibling of [ELECTRIC_DREAMS_V3_AAA_PLAN.md](ELECTRIC_DREAMS_V3_AAA_PLAN.md) and supersedes the earlier [WINTER_WONDERLAND_WEBGPU_UPGRADE_PLAN.md](WINTER_WONDERLAND_WEBGPU_UPGRADE_PLAN.md) — that plan was the WebGPU *migration* (now shipped: `winter-materials.js`, `winter-compute.js`, `winter-post.js` exist). This plan is the *visual reinvention* on top of it.

> **Status**: The migration was a port. This is the leap.

---

## 0. Why This, Why Now — The Honest Critique

The current theme is a competent WebGPU port, but the live result (see reference screenshot) is **flat, dark, and static**. Concretely, grounded in the code:

| Symptom in the screenshot | Root cause in code |
|---|---|
| Snow looks like **TV static** — random white dots on near-black | Snow compute is trivial gravity advection + respawn ([winter-compute.js:85-114](../src/themes/winter/winter-compute.js#L85)); particles are additive-blended white points with no coherent motion ([winter-materials.js:214-272](../src/themes/winter/winter-materials.js#L214)). Real snow moves in **sheets and gusts**, not independent dots. |
| Aurora is a **faint green smear at the horizon** | Aurora is a flat curtain *plane* with 3-octave FBM ([createAuroraSystem](../src/themes/winter/winter-theme.js#L1514) + [createWinterAuroraNodeMaterial](../src/themes/winter/winter-materials.js#L153)). It has no volume, no vertical rays, no dance — it can't be the hero. |
| Sky is a **dead near-black gradient** | `0x00030a → 0x091222` three-stop mix ([winter-materials.js:37-53](../src/themes/winter/winter-materials.js#L37)). No atmosphere, no depth, stars barely register ([winter-materials.js:55-77](../src/themes/winter/winter-materials.js#L55)). |
| Mountains are **flat black trapezoids** | Unlit `MeshBasicNodeMaterial` with a snow-line threshold ([winter-materials.js:124-151](../src/themes/winter/winter-materials.js#L124)). No form, no moon rim-light, no real accumulation. |
| **No sense of "air"** — no depth, no weather you can feel | Fog is a couple of scrolling alpha planes ([createFogLayers](../src/themes/winter/winter-theme.js#L1987)); there is no participating medium, no light scattering, no whiteout. |
| Post is **flat** | Emissive bloom + cold vignette + a cheap 4-tap god-ray ([winter-post.js](../src/themes/winter/winter-post.js)). No tonemap, no DOF, no temporal stability, no frost. |
| **No emotional arc** | ~12 CPU update loops fire per-event, but nothing builds — the storm never *escalates* with the game. |

The architecture is also **CPU-bound**: per frame the theme runs `updateSnowParticles`, `updateCloseSnowflakes`, `updateIceBurst`, `updateVortexes`, `updateFrozenLightning`, `updateBlizzardWaves`, `updateShootingStars`, `updateIceCrystalCrashes`, `updateMoonEffects`, `updateEffectState`, `updateCameraAnimation` — a dozen JS loops animating thousands of particles ([winter-theme.js startAnimation](../src/themes/winter/winter-theme.js#L2962)). AAA targets are **GPU-orchestrated**: the CPU only conducts.

This isn't iteration. It's the version that makes someone stop and stare.

---

## 1. TL;DR — Three Game-Changing Techniques

| Technique | Proven by | Why it transforms the theme |
|---|---|---|
| **GPU Curl-Noise Storm Field** (divergence-free wind advection) | Bridson 2007 curl-noise; standard in Houdini/AAA FX | Replaces trivial gravity drift. 30K–120K snow particles ride a **divergence-free curl-noise wind field** so they move in coherent **sheets and gusts** — the single thing that separates "TV static" from "blizzard." Combos inject vortices; the whiteout is a density+visibility ramp on this one field. All on GPU. |
| **Unified Volumetric Raymarch** (aurora curtains + participating snow-haze, one pass) | Maxime Heckel cloudscapes; iq aurora; Roy Theunissen breakdown | Replaces both the flat-plane aurora *and* the dead sky/fog. **One half-res raymarch** renders a **dancing volumetric aurora** (veiny twin-noise curtains with vertical rays) *and* the **participating height-fog** the moon + aurora scatter light through. This is the **mesmerizing hero** and the **atmospheric depth** the scene completely lacks today. |
| **Cinematic Temporal Post + Frost Finish** | Three.js r181 `PostProcessing` TSL stack (same as Electric Dreams V3) | Replaces bloom+vignette. ACES filmic tonemap, **bokeh DOF** (near flakes melt out of focus), chromatic aberration, motion streak on heavy gusts, blue-noise dither, and **animated screen-edge frost** that crystallizes at peak storm. The layer that pushes "tech demo" → "AAA finish." |

These compound: better motion + better atmosphere + better finish, all GPU-side. They are not tradeoffs against each other.

---

## 2. The Cinematic Vision

### Hero composition
A wide, deep night. A **dancing aurora** owns the upper third — real volumetric curtains that ripple, fold, and flare, throwing **green-teal light down into the falling snow and onto the snowfields below**. Below it, **snow drives across the frame in wind-shaped sheets**, denser and faster near camera, hazing into a luminous fog at the horizon. A cold **moon** hangs as the key light, its glow scattering through the snow-haze as soft god-rays. Distant **snow-capped ridges** catch a thin moon rim-light. The whole frame *breathes* with a slow camera drift.

The emotional thesis: **the blizzard IS the game's intensity.** Calm starlit snowfall when you're idle; rising wind as combos build; a **full whiteout** at the peak — aurora flaring in your combo's accent color, snow surging toward white, frost crystallizing at the screen edges — then the storm exhales on game-over.

### Storm-intensity arc (3 acts)

The theme tracks one master scalar, `stormIntensity ∈ [0,1]`, smoothed from game state (extends the existing `stormEnergy`/`effectState` at [winter-theme.js:861](../src/themes/winter/winter-theme.js#L861) and [updateEffectState](../src/themes/winter/winter-theme.js#L3183)). A `StormDirector` maps it to every subsystem — the winter analogue of Electric Dreams' `fxState`.

| Act | Game state | Snow field | Aurora | Fog / Atmosphere | Camera | Post |
|---|---|---|---|---|---|---|
| **I — Still Night** | idle / early | gentle near-vertical fall, low density | faint single ribbon, slow | thin, clear, deep stars | slow 20s drift | clean, cool grade |
| **II — Rising Wind** | combos building | wind tilts snow into sheets, gusts roll through | brightens, begins to dance & fold | thickens at ground, light scatter grows | tracks gust direction | bloom +, DOF deepens |
| **III — Whiteout** | high combo / tetris | density surges toward whiteout, vortices | flares in accent color, violent ripple, vertical rays spike | glowing, near-opaque haze | gust shove + subtle shake | frost crystallizes edges, motion streak, CA + |
| **Resolution** | game over | wind dies, snow settles slowly | fades to one calm ribbon | clears, exhales | slow pull-back | frost melts off, vignette settles |

`stormIntensity` doesn't snap — it eases (attack fast on tetris, decay slow), so the storm feels like weather, not a state machine.

### Compositional depth (layers, back to front)

```
LAYER 0 — RAYMARCHED ATMOSPHERE + AURORA   (half-res, temporal, the hero)
  Volumetric aurora curtains (twin-noise veins + vertical rays + iq emission bands)
  Participating height-fog: moon + aurora light scatter (Beer–Lambert + Henyey–Greenstein)
  Deep starfield + faint milky-way band behind it
  Parallax ~0.04x

LAYER 1 — DISTANT RIDGES                    (relit)
  Snow-capped mountains, normal-based snow accumulation, thin moon rim-light
  Sub-ridge fog band ties them into the volume

LAYER 2 — MOON (key light)                  (emissive hero light)
  Cratered disc + breathing halo; drives god-ray light position + scene key light

LAYER 3 — ★ STORM SNOW FIELD               (the centerpiece motion)
  30K–120K curl-noise-advected particles, soft hexagonal sprites
  Depth-graded size + alpha; near flakes large & DOF-soft, far flakes haze
  Density / speed / tilt all driven by stormIntensity

LAYER 4 — CLOSE FLAKE BOKEH                 (foreground, parallax 1.4x)
  ~150 large near-camera flakes, motion-streaked on gusts, DOF bokeh

LAYER 5 — FROST OVERLAY                     (screen-space, peak-storm)
  Crystalline frost grows from screen edges at high stormIntensity, melts on calm

POST STACK (in order):
  → MRT emissive bloom (aurora, moon, ice glints)
  → Bokeh DOF (focus plane mid-snow)
  → Gust motion streak (cheap directional blur, gated on gust strength)
  → ACES filmic tonemap + cold cinematic grade
  → Frost-edge overlay + chromatic aberration
  → Blue-noise dither + film grain
```

---

## 3. The Three Hero Techniques — Concrete Recipes

These are grounded in the research, written to be implementable in our TSL/WebGPU stack (three.js r181, `three/webgpu` + `three/tsl`, `THREE.PostProcessing` — same toolbox Electric Dreams V3 shipped on).

### 3.1 GPU Curl-Noise Storm Field — `winter/sim/storm-field.js` + snow compute rewrite

**Why curl noise**: the curl of a vector potential is **divergence-free**, so advected particles flow like a turbulent fluid — coherent swirls and sheets, never bunching or thinning unnaturally. This is the canonical "wind/fluid look" technique (Bridson 2007).

**Field**: sample a vector potential `ψ(p, t)` (3× value-noise / `mx_noise_float` lobes) and take its analytic curl via finite differences:
```
ε = small step
curl.x = (ψz(p+dy) − ψz(p−dy)) − (ψy(p+dz) − ψy(p−dz))
curl.y = (ψx(p+dz) − ψx(p−dz)) − (ψz(p+dx) − ψz(p−dx))
curl.z = (ψy(p+dx) − ψy(p−dx)) − (ψx(p+dy) − ψx(p−dy))
wind   = baseFall + curl * turbulence * stormIntensity + globalGust(t)
```
**Snow compute** (rewrite of [winter-compute.js](../src/themes/winter/winter-compute.js)): per particle, `vel = mix(vel, wind, drag·dt)`; `pos += vel·dt`; respawn through the top when out of bounds. `turbulence`, `baseFall`, and global gust amplitude are uniforms driven by `stormIntensity` and gust events. **Vortex injection** on combos: push a swirl center into a small ring buffer the compute reads, adding tangential velocity within a radius (replaces the separate `createVortexSystem`/`updateVortexes` CPU loop at [winter-theme.js:2660](../src/themes/winter/winter-theme.js#L2660)).

**Whiteout**: at high `stormIntensity`, raise active particle count toward the preset max, raise `baseFall`+`turbulence`, and raise the snow material's alpha floor so near-camera density approaches an opaque sheet (the Last of Us 2 / RDR2 whiteout read). This single field subsumes today's snow + wind-streaks + vortex + blizzard-wave systems.

### 3.2 Unified Volumetric Raymarch — `winter/rendering/aurora-volume.js`

One fullscreen (half-res) raymarch renders the sky's **participating medium** *and* the **aurora**. Recipe (Maxime Heckel cloudscape march, ~36–48 main steps, constant step):

- **Ray setup**: reconstruct world ray from camera; march a sky shell (height band + far cap).
- **Aurora density** (Roy Theunissen veiny curtains): sample two animated noise fields on world XZ at different scales/speeds in opposite directions, `aurora = abs(nA − nB)` → curly vertical "veins"; multiply by a **vertical ray** term `pow(fract(curtainPhase), k)` and a **height falloff** (sharp bottom edge, long tail upward, à la iq's aurora). Emission color from a Y-gradient ramp (teal → green → magenta), pushed toward the **combo accent** at high `stormIntensity`.
- **Fog density**: exponential height fog + low-freq FBM wisps; thickens with `stormIntensity`.
- **Light transport**: Beer–Lambert transmittance `exp(−σ·dist)`; **Henyey–Greenstein** phase toward the moon for forward-scatter god-ray glow; aurora contributes as **emissive in-scatter** so the curtains actually light the fog and snow-haze around them.
- **Banding kill**: offset the march start by a **blue-noise + frame-index** jitter (temporal), then **bicubic upscale** half-res → full-res. This is what keeps a 40-step march cheap and clean.

Output goes to the scene behind everything (sky shell) and writes emissive for the bloom pass. This **replaces** `createAuroraSystem`, the flat aurora material, the sky-dome material, the fog layers, and the moon-ray hack — four subsystems collapse into one coherent volume.

### 3.3 Cinematic Temporal Post + Frost — `winter/post/winter-pipeline.js`

Rebuild `WinterPost` into the V3-style ordered TSL stack on `THREE.PostProcessing`:
1. **MRT emissive bloom** (keep the proven `mrt({output, emissive})` pattern from [winter-post.js:34](../src/themes/winter/winter-post.js#L34)) — only aurora/moon/ice glints bloom.
2. **Bokeh DOF** — depth-aware circle-of-confusion, focal plane on mid-snow; near close-flakes go soft (the "real lens" tell).
3. **Gust motion streak** — cheap directional blur along wind vector, amplitude gated on gust strength (no full velocity buffer needed for v1).
4. **ACES filmic tonemap** + **cold cinematic grade** (lift shadows blue, crush slightly, subtle desaturate at whiteout).
5. **Frost-edge overlay** — animated crystalline frost (Voronoi/`mx` noise) grows inward from screen edges as `stormIntensity → 1`, melts back on calm; the screen-space "you're in it" moment.
6. **Chromatic aberration** (radial, tiny, scales with storm) + **blue-noise dither + film grain** (anti-banding, filmic texture).

---

## 4. Technical Architecture

### File structure (mirrors the shipped Electric Dreams V3 layout)

V3 proved a thin orchestrator + focused modules + an `fxState` bridge. We copy that shape.

```
src/themes/winter/
├── winter-theme.js                 ~600 LOC   Thin orchestrator (was 3732)
├── sim/
│   ├── storm-field.js              ~260 LOC   Curl-noise wind + snow advection compute
│   └── storm-emitters.js           ~160 LOC   Game-event → gusts / vortices / flares
├── rendering/
│   ├── aurora-volume.js            ~360 LOC   Unified raymarch: aurora + fog + scatter
│   ├── snow-renderer.js            ~220 LOC   Storm snow points + close-flake bokeh
│   ├── moon.js                     ~160 LOC   Cratered moon + halo + key light
│   └── ridges.js                   ~180 LOC   Relit mountains + normal-based snow accum
├── post/
│   └── winter-pipeline.js          ~340 LOC   Bloom + DOF + motion + ACES + frost + grain
├── composition/
│   └── storm-director.js           ~220 LOC   stormIntensity arc + camera choreography
├── winter-materials.js             ~260 LOC   KEPT/slimmed — shared TSL material factories
├── winter-shaders.js               ~590 LOC   KEPT — WebGL2 fallback (simplified theme)
└── winter-tetrominos.js            ~60 LOC    KEPT — tetromino colors (frosted-ice tint)

NET: leaner. The dozen CPU micro-effect systems (wind streaks, vortex, blizzard
waves, ice bursts, frozen lightning, fog layers, moon rays) fold into the storm
field + volume, or become emitter pokes — removing ~10 per-frame JS update loops.
```

WebGPU is the AAA path. **WebGL2 stays as a silent fallback** (existing simplified theme via `winter-shaders.js`), gated on `this.isWebGPU` exactly as today ([winter-theme.js:1186](../src/themes/winter/winter-theme.js#L1186)). The compute storm field and the raymarch volume are WebGPU-only; the fallback keeps a CPU snow drift + the old flat aurora.

### Per-frame execution model

**Current** (CPU-bound, ~12 JS loops). **Target** (GPU-orchestrated, CPU < 1ms):
```
CPU (orchestrate only):
  stormDirector.update(delta, gameState)   // eases stormIntensity, choreographs camera
  emitters.collect(events)                 // pushes gusts/vortices/flares to GPU buffers
  push uniforms (stormIntensity, accent, moonScreenPos, gust vector)

GPU command buffer:
  1. stormField.compute()        // curl-noise wind + snow advection (30K–120K)
  2. auroraVolume render         // half-res raymarch (aurora + fog + scatter) + temporal
  3. mainScene.render()          // sky shell + ridges + moon + snow points + close flakes
  4. post: bloom → DOF → motion streak → ACES+grade → frost → CA → dither
```

### Performance budget (Ultra, 60 FPS, 16.67 ms)

| Component | Budget | Internal res | Notes |
|---|---|---|---|
| Storm field compute (60K particles) | 0.9 ms | — | curl eval + advect, one dispatch |
| Aurora + fog raymarch (40 steps) | 3.0 ms | 0.5x | + temporal reproject, biggest cost |
| Bicubic upscale of volume | 0.4 ms | 0.5x→1.0x | 16-tap |
| Main scene (snow + ridges + moon) | 2.0 ms | 1.0x | snow points fill-rate dominates |
| MRT bloom | 0.9 ms | 0.3x | 5-mip, emissive only |
| Bokeh DOF | 0.7 ms | 0.6x | hex aperture, focal mid-snow |
| Motion streak (gust-gated) | 0.3 ms | 0.6x | skipped when gust ≈ 0 |
| ACES + grade + frost + CA + grain | 0.4 ms | 1.0x | single final pass |
| CPU orchestration | 0.8 ms | — | director + emitters + uniforms |
| Headroom | 6.3 ms | — | OS jitter, GC, browser tax |
| **TOTAL** | **~9.6 ms** | | comfortable 60, headroom for 120 on High |

### Per-tier preset table (extends existing presets at [winter-theme.js:205](../src/themes/winter/winter-theme.js#L205))

| Preset | Snow particles | Aurora march steps | Volume res | DOF | Motion streak | Frost | Target |
|---|---|---|---|---|---|---|---|
| Minimal | 6K (CPU) | flat fallback | — | off | off | off | 60 mobile |
| Low | 12K | 20, no light-march | 0.4x | off | off | off | 60 iGPU |
| Medium | 25K | 28 | 0.5x | off | gust only | edge only | 60 desktop |
| High | 45K | 36 | 0.5x | bokeh | yes | yes | 120 RTX 3070 |
| Ultra | 70K | 44 | 0.5x | bokeh | yes | yes | 60 RTX 3070 |
| Extreme | 100K | 48 | 0.6x | bokeh | yes | yes | 60 RTX 4080 |
| Extreme+ | 120K | 52 | 0.6x | bokeh | yes | full | 60 high-end |

Adaptive: reuse the existing budget controller ([updatePerformance](../src/themes/winter/winter-theme.js#L3366) / [applySnowLod](../src/themes/winter/winter-theme.js#L3292)) — point it at volume internal-scale + active particle count first, before touching pixel ratio.

---

## 5. Reactivity — Event → Storm Beats

Keep every event-bus contract ([setupEventListeners](../src/themes/winter/winter-theme.js#L2765), [handleLineClear](../src/themes/winter/winter-theme.js#L2786), [handleCombo](../src/themes/winter/winter-theme.js#L2795), [handlePieceLock](../src/themes/winter/winter-theme.js#L2898), [triggerComboTierEffects](../src/themes/winter/winter-theme.js#L2837)). Rewire handlers to nudge the **storm**, not spawn isolated bursts.

| Event | Storm field | Aurora / volume | Camera | Post |
|---|---|---|---|---|
| Piece lock | small puff at lock point | — | — | — |
| Hard drop | downward gust pulse | — | tiny punch | small impact bloom |
| Single line | gust sweep along clear row | aurora brightness blip | — | — |
| Tetris | radial gust burst + vortex | full-curtain flare in accent, vertical-ray spike | dolly-push + micro-shake | bloom +0.3, CA +, 1-frame flare |
| Combo 4 | `stormIntensity` step up, swirl | curtain folds faster, hue shifts to accent | slow zoom 3° | DOF deepens |
| Combo 7+ | **whiteout ramp** + triple vortex | violent ripple, secondary curtain ignites | gust shove + shake | frost crystallizes, motion streak, desat-then-resaturate |
| Level up | wind direction reverses (gust) | color drift sweep across curtain | gentle pan | grade cross-fade |
| Game over | wind dies, snow settles | fade to one calm ribbon | slow pull-back | frost melts, vignette settles |

`stormIntensity` integrates these: a tetris spikes it, sustained combos hold it high, silence decays it. The **whiteout is earned**, not constant.

---

## 6. Implementation Phases (gated; ~12–15 working days)

Critical path: 0 → 1 → 2 → 3. Phases 4–6 parallelize. Each phase has an exit gate.

| Phase | Scope | Exit criteria | Effort |
|---|---|---|---|
| **0. Scaffold + StormDirector** | New subdir layout; `storm-director.js` with eased `stormIntensity`; thin out `winter-theme.js` to orchestrate; keep WebGL fallback intact | Theme loads, no errors, `stormIntensity` visibly tracks combos (debug overlay), lint clean | 1.5 d |
| **1. ★ Storm snow field** | Curl-noise compute + snow advection rewrite; soft hex sprites; depth-graded size/alpha | 60K particles drift in coherent sheets/gusts at 60 FPS — reads as snow, not static | 2.5 d |
| **2. ★ Aurora + fog volume** | Half-res raymarch (aurora veins + vertical rays + height fog + HG scatter); blue-noise jitter; bicubic upscale | Dancing volumetric aurora lights the snow-haze; no banding/shimmer under camera drift | 3 d |
| **3. ★ Cinematic post + frost** | Bloom + bokeh DOF + ACES + grade + frost edge + CA + grain | Side-by-side vs current shows an unmistakable quality jump | 2 d |
| **4. Relit ridges + moon** | Mountains relit w/ moon rim + normal-based snow accumulation; cratered moon + halo + scatter anchor | Ridges read as 3D snow-capped peaks; moon god-rays scatter in fog | 1.5 d |
| **5. Event → storm beats** | Emitters: gusts, vortices, whiteout ramp, aurora flares; rewire all handlers | Every event from §5 produces its distinct storm response | 1.5 d |
| **6. Presets + adaptive + polish** | 7 tiers calibrated; adaptive on volume-scale+particle count; dispose audit; 10-swap soak | Target FPS per tier; flat memory across swaps; zero console/shader warnings | 2 d |

---

## 7. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Raymarch volume too costly at full res | High | Half-res + bicubic from day one (Phase 2); steps are preset-scaled; temporal reproject |
| Curl-noise advection looks chaotic, not "snow" | Medium | Bias heavily toward `baseFall`; turbulence ramps only with `stormIntensity`; tune drag |
| Temporal reproject ghosts on fast camera/whiteout | Medium | Variance clamp + reset history on theme.start (existing pattern) and on big camera punches |
| Compute/atomics absent on mobile/Safari | Medium | Gate on `isWebGPU` (existing); Minimal/Low use CPU drift + flat aurora fallback |
| MRT emissive validation (every material needs emissive) | High | Keep the audit tool ([auditMrtMaterials](../src/themes/winter/winter-theme.js#L992)); default `emissiveNode = vec3(0)` on non-glow materials |
| Whiteout blows out / hurts readability of the board | Medium | Cap whiteout alpha; it pulses then recedes; never fully occludes center frame |
| Frost overlay reads as a bug, not a feature | Low | Only at high `stormIntensity`, edges only, slow grow/melt; user-tunable |
| Scope creep past 15 days | Medium | Phases 4–6 are independently shippable; ship 1–3 first if needed (they carry the WOW) |

---

## 8. Definition of Done

- [ ] **60 FPS sustained on Ultra** (RTX 3070 / M-series) over a 10-min soak with the full event mix
- [ ] **No frame spike > 18 ms** across idle → tetris → 10× combo → whiteout → game-over
- [ ] **First frame < 200 ms**: sky shell + a few flakes paint immediately; field+volume layer in over ~1 s
- [ ] **Side-by-side video** vs current clearly shows: (a) coherent wind-driven snow, (b) dancing volumetric aurora that lights the scene, (c) whiteout escalation, (d) AAA post finish
- [ ] **All 7 presets** hit target FPS on a representative device; WebGL2 fallback still renders cleanly
- [ ] **Flat memory** after 10 theme in/out swaps; full dispose audit passes
- [ ] **Zero console errors, zero shader-compile warnings, lint clean** on changed files
- [ ] **No regression** in event-bus contracts — every event reacts
- [ ] This plan kept current + a 1-page `src/themes/winter/README.md` pointing at the architecture

---

## 9. Out of Scope (deliberate cuts)

- No interactive snow deformation / footprints (no player walks the surface — it's a backdrop)
- No multi-camera; single perspective camera choreographed by `StormDirector`
- No editable palette picker — aurora harmony is locked, accent comes from game state
- No image/video texture deps — everything procedural (one optional blue-noise tile)
- No VR/AR path; no saved replay (every frame = f(time, stormIntensity, events))

---

## 10. What This Plan Says No To

- **No "just add more bloom."** Bloom can't fake atmosphere. The point is real volumetric scattering.
- **No "more particles = more wow."** 120K *random* dots is noise. The win is *coherent* curl-noise motion.
- **No flat-plane aurora.** A billboard can't be the hero. It must have volume and dance.
- **No constant whiteout.** The whiteout is the *peak* of an arc; if it's always on, it's wallpaper.
- **No keeping a dozen CPU loops.** Fold them into the field + volume; the CPU conducts, the GPU plays.

---

## 11. Technical References

- [Aurora Borealis: A Breakdown — Roy Theunissen](https://blog.roytheunissen.com/2022/09/17/aurora-borealis-a-breakdown/) — twin-noise `abs(nA−nB)` veins, box raymarch, Y-gradient opacity falloff. Basis for §3.2 aurora shape.
- [Real-time Cloudscapes with Volumetric Raymarching — Maxime Heckel](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) — step counts, FBM density, Beer–Lambert, Henyey–Greenstein, blue-noise jitter, half-res + bicubic. Basis for §3.2 light transport.
- [Field Guide to TSL and WebGPU — Maxime Heckel](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/) — TSL patterns, compute dispatch sizing.
- [Curl Noise for particles on GPU — kbladin](https://github.com/kbladin/Curl_Noise) & [Dissecting Curl Noise — Emil Dziewanowski](https://emildziewanowski.com/curl-noise/) — divergence-free advection (Bridson 2007). Basis for §3.1.
- [Fast Divergence-Free (Bitangent) Noise — atyuwen](https://atyuwen.github.io/posts/bitangent-noise/) — cheaper curl alternative if perf-bound.
- [Volumetric lighting in WebGPU — three.js forum](https://discourse.threejs.org/t/volumetric-lighting-in-webgpu/87959) — TSL volumetric reference for our stack.
- [Deferred Snow Deformation in Rise of the Tomb Raider — GPU Pro 36 / Code Corsair](https://www.elopezr.com/the-rendering-of-rise-of-the-tomb-raider/) — normal-based accumulation thresholding for §4 ridges.
- [Snow Accumulation in Real-Time — SIGRAD](https://ep.liu.se/ecp/007/002/ecp00702.pdf) — normal-vs-snow-direction whitening.
- [The Best Looking Snow in Games — TheGamer](https://www.thegamer.com/most-impressive-snow-physics-mechanics-in-games/) — RDR2 / Last of Us 2 whiteout as the emotional-peak reference for §2's arc.
- [ELECTRIC_DREAMS_V3_AAA_PLAN.md](ELECTRIC_DREAMS_V3_AAA_PLAN.md) — the in-repo precedent for thin-orchestrator + `fxState` + TSL post stack on r181.

---

## 12. Effort Summary

- **Total**: ~12–15 working days. **Critical path**: Phases 0–3 (~9 days) — these alone deliver the WOW.
- **Parallelizable**: Phases 4–6 (~5 days).
- **Outcome**: a theme that earns "best-in-class WebGPU" — a living blizzard with a dancing volumetric aurora, coherent wind-driven snow, an earned whiteout climax, and a cinematic finish, all at a stable 60 FPS.

---

*To start Phase 0: (1) scaffold `sim/`, `rendering/`, `post/`, `composition/` with stubs; (2) add `composition/storm-director.js` exposing eased `stormIntensity` + a debug overlay; (3) cut `winter-theme.js` to a thin orchestrator preserving the event subscriptions and quality-preset/adaptive infra; (4) leave the WebGL2 path untouched as fallback.*
