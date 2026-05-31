# Electric Dreams V3 — AAA WebGPU Rebuild Plan

> **Goal**: Rebuild Electric Dreams as the **best-in-class WebGPU theme in the game** with AAA visual fidelity, cinematic composition, real physics, and stable 60-120 FPS performance. This plan supersedes [V2](ELECTRIC_DREAMS_V2_REFACTOR_PLAN.md) — V2 was discrete metaballs + iridescent satellites; V3 leverages three game-changing techniques that have become viable in three.js WebGPU since V2 was drafted.

> **Status**: V2 was an evolution. V3 is a reinvention.

---

## TL;DR — Three Game-Changing Techniques

| Technique | Used by | Why it transforms our theme |
|---|---|---|
| **MLS-MPM fluid simulation** | Codrops 2025 WaterBall demo (100K particles on integrated AMD iGPU) | Replaces our 16 discrete blobs + 1100 ambient sparks + 480 burst sparks with **ONE unified fluid system**. Blobs become emergent fluid features. Combos = turbulence injection. No more 12 separate CPU update loops. |
| **Radiance Cascades GI** | Path of Exile 2 | Actual light bouncing between fluid clusters and the environment. No more pre-baked colors — emissive surfaces *light* their surroundings. The single technique that visually separates "tech demo" from "AAA game." Noiseless, real-time on consumer GPUs. |
| **TAAU temporal upscaling** | Three.js r183 RenderPipeline | Render at 60% internal resolution, upscale to 100% with temporal accumulation. ~40% GPU saving with imperceptible quality loss. Free DOF + motion blur via velocity buffer that TAAU already requires. |

These three together deliver: **better physics + better visuals + better performance simultaneously** — they're not tradeoffs.

---

## 1. Why a V3 Rebuild (Not Another Iteration)

V2's premise was a refined version of the current architecture: discrete iridescent blobs with raymarched metaball hero, cinematic composition layers. That premise was capped at "very polished version of the current thing."

Since V2 was drafted, three things converged:
1. **MLS-MPM proved viable on the web** ([WaterBall demo](https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/), Feb 2025) — 100K particles at 60 FPS on integrated AMD graphics, smooth even on a 6-year-old iPad Air 3
2. **Radiance Cascades shipped in production** ([Path of Exile 2](https://jason.today/rc), released Dec 2024) — proven AAA-quality real-time GI on consumer hardware
3. **Three.js r183 RenderPipeline** ([Threejs roadmap 2026](https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026)) — node-based post replaces the deprecated PostProcessing class. Built-in TAAU, motion blur, DOF, all composable.

Current implementation hits performance walls at every combo event because the architecture is **CPU-bound**: 12 update subsystems per frame, 1100 particles animated in JavaScript, blob physics in O(n²) loops. AAA targets are GPU-bound architectures where the CPU only orchestrates.

V3 isn't iteration. It's the version that was impossible 6 months ago.

---

## 2. What We Keep From The Current Implementation

Not everything needs to change. These survive V3:

- **`StageConductor`** ([electric-dreams-stage-systems.js:53](../src/themes/electric-dreams/electric-dreams-stage-systems.js#L53)) — Its `actIndex` / `phrasePhase` / `heroWindow` / `dominantAccent` / `supportAccent` channels are a genuinely musical structure for choreography. We rewrite the *visualizers* not the conductor.
- **`BLOB_COLORS`** palette — the 8 electric neon colors work; we'll just push saturation
- **Game event subscriptions** ([electric-dreams-theme.js:5720-5760](../src/themes/electric-dreams/electric-dreams-theme.js#L5720)) — the event-bus contracts stay; the handlers get rewritten to drive fluid forces instead of spawning bursts
- **Quality preset infrastructure** ([electric-dreams-theme.js:38-130](../src/themes/electric-dreams/electric-dreams-theme.js#L38)) — keep the 6-tier preset model, redefine the per-tier numbers
- **Adaptive resolution scaling** ([electric-dreams-theme.js:131-148](../src/themes/electric-dreams/electric-dreams-theme.js#L131)) — keep the budget controller, point it at TAAU's internal scale instead

Everything else is replaced.

---

## 3. The Cinematic Vision

### Hero composition
A single living fluid mass dominates the center of frame. It pulses with the music. Smaller satellite droplets orbit and rejoin it. Game events inject visible force into the fluid — line clears push outward, combos summon vortices, tetrises detonate ring-shaped waves. **The fluid IS the game's emotional state visualized.**

Light from emissive fluid regions actually bounces — the wall behind the fluid glows magenta where the magenta blob is near it. Move the blob, the magenta glow moves with it (this is radiance cascades GI). No game asset has ever done this in a Tetris background before.

The camera is choreographed:
- **Idle** — slow 18-second lazy orbit, like floating in zero-G
- **Tetris clear** — dramatic dolly-push toward the impact point, motion blur, then settle
- **Combo 7+** — dolly-zoom (Vertigo effect) over 1.2s, the entire scene saturates
- **Game over** — slow pull-back to reveal scale, fluid de-saturates and slows

### Three-act musical structure

The `StageConductor` already tracks game progression as "acts". V3 visualizes them:

| Act | Music character | Visual response |
|---|---|---|
| **I — Drift** (early game) | Sparse, ambient | Slow fluid motion, cool palette (teal/violet/indigo), gentle GI from one warm key light |
| **II — Build** (combos starting) | Building energy | Fluid agitates, palette warms (cyan/magenta dominant), rim lights snap in, particles accelerate |
| **III — Surge** (high combos, tetrises) | Peak intensity | Fluid turbulent and chaotic, full saturation, all 3 lights firing, motion blur prominent, lens flares trigger on impacts |

The conductor's `phrasePhase` (already tracks 4-bar musical phrases) drives camera breathing, fluid pulse, and bloom modulation — so the visuals feel *musical*, not just reactive.

### Compositional depth (7 layers)

```
LAYER 0 — VOLUMETRIC NEBULA SKY
  Raymarched 3D noise volume, half-res with temporal accumulation
  Indigo → violet → teal gradient, parallax 0.05x
  Modulated by stageHeat (warms in Act III)

LAYER 1 — BOKEH DUST FIELD (far)
  4000 compute-driven particles at -20 to -10 Z
  Depth-of-field blurred, parallax 0.15x
  Slow drift, no game reactivity

LAYER 2 — STAGE LIGHTING
  3-point cinematic setup (key warm, fill cool, rim white)
  Shadow casting from key light onto fluid
  Light positions choreographed by camera-director

LAYER 3 — ★ FLUID HERO (the centerpiece)
  MLS-MPM simulation, 50K-100K particles
  Screen-Space Fluid Rendering (SSFR): depth, thickness, bilateral, surface normals
  Iridescent SSS material with hue determined by per-particle accent color
  Reacts to game events via force injection

LAYER 4 — RADIANCE CASCADES GI
  4-cascade hierarchy, 0.5x resolution base
  Emissive fluid regions act as light sources
  Bounces from fluid → nebula sky → back
  Gives the scene its AAA "real lighting" feel

LAYER 5 — FOREGROUND DEBRIS
  2000 compute-driven embers, motion-blurred
  Reactive: spike on impacts, drift during idle
  Closest layer to camera, parallax 1.5x

LAYER 6 — LENS ARTIFACTS (foreground overlay)
  Barrel distortion + chromatic refraction at edges
  Lens flares anchored to bright fluid regions
  Faint CRT scanline 5% opacity

POST STACK (in order):
  → MRT bloom from emissive channel
  → Motion blur from velocity buffer
  → Bokeh DOF (focus on hero fluid mass center)
  → TAAU upscale from 60% → 100%
  → ACES filmic tonemap + LUT color grade
  → Film grain + dither
```

---

## 4. Technical Architecture

### File structure (target ~5,000 LOC across 18 files; current is 10,317 LOC across 8 files)

```
src/themes/electric-dreams/
├── electric-dreams-theme.js              ~400 LOC   Thin orchestrator
├── sim/
│   ├── fluid-mls-mpm.js                  ~600 LOC   MLS-MPM compute (P2G + grid + G2P)
│   ├── fluid-grid.js                     ~200 LOC   Background grid + atomic ops
│   ├── fluid-emitters.js                 ~250 LOC   Game-event → fluid force injection
│   └── velocity-buffer.js                ~150 LOC   Motion vectors (powers TAAU + motion blur)
├── lighting/
│   ├── radiance-cascades.js              ~500 LOC   GI compute + merge pass
│   ├── stage-lights.js                   ~180 LOC   3-point cinematic + shadow map
│   └── light-injection.js                ~120 LOC   Emissive scene → cascade input
├── rendering/
│   ├── fluid-renderer.js                 ~350 LOC   SSFR (depth+thickness+bilateral+composite)
│   ├── nebula-volume.js                  ~280 LOC   Raymarched volumetric bg, temporal accum
│   ├── bokeh-particles.js                ~200 LOC   Depth-blurred compute dust
│   └── lens-foreground.js                ~150 LOC   Glass + scanline + flare anchors
├── post/
│   ├── render-pipeline.js                ~300 LOC   Three.js r183+ RenderPipeline assembly
│   ├── taau-node.js                      ~250 LOC   Temporal upsample + sharpen
│   ├── motion-blur-node.js               ~180 LOC   8-sample velocity-based blur
│   ├── dof-node.js                       ~200 LOC   Bokeh circle-of-confusion
│   └── bloom-grading-node.js             ~220 LOC   MRT bloom + ACES + LUT
├── composition/
│   ├── camera-director.js                ~280 LOC   Choreographed camera (3 acts + transitions)
│   └── act-transitions.js                ~150 LOC   Inter-act crossfades on palette+light
├── stage-conductor.js                    ~200 LOC   KEPT — slimmed from current
└── electric-dreams-tetrominos.js         ~60 LOC    KEPT — tetromino colors

TOTAL: ~5,020 LOC (vs current 10,317 = 51% reduction)
DELETED:
  - electric-dreams-theme.js monolith (6,954 LOC current → 400 LOC orchestrator)
  - webgl-electric-dreams-renderer.js (589 LOC dead code)
  - electric-dreams-hero-particles.js (565 LOC, absorbed into fluid sim)
  - electric-dreams-compute.js (225 LOC, replaced by MLS-MPM)
  - electric-dreams-materials.js (766 LOC, split into rendering/lighting modules)
```

### Per-frame execution model

**Current model** (CPU-bound):
```
CPU: updateBlobs → updateBurstBlobs → updateStageSystems → updateSparks → updateAmbientSparkFlow
     → updateGameplaySparkBursts → updateLineWakes → updateMicroGlints → updateBackground
     → updateBoardHalo → updateCoreLight → updateCameraResponse → heroParticles.update
GPU: render or post.render
```
12+ sequential JavaScript update phases. ~1100 particles + 16 blobs animated on the CPU. The main thread is the bottleneck.

**V3 model** (GPU-orchestrated):
```
CPU (under 1ms):
  - cameraDirector.update(time, fxState)         // updates camera transform + dynamic params
  - emitters.collect(events)                     // pushes pending forces to GPU buffer
  - stageConductor.update(delta, fxState)        // unchanged
  - light director updates light positions

GPU command buffer:
  1. fluidSim.dispatch()           // MLS-MPM: P2G + grid clear + G2P, ~50K particles
  2. radianceCascades.dispatch()   // 4 cascades, computed in order
  3. shadowMap.render()            // key light shadow pass (half-res)
  4. nebulaVolume.dispatch()       // raymarched bg, half-res + temporal reproject
  5. mainScene.render()            // fluid SSFR + stage lights + bokeh particles + foreground
  6. post chain:
       motionBlur → DOF → bloom → tonemap → TAAU upscale → grain
```

GPU does all the heavy work in parallel pipelines. CPU just orchestrates. The frame budget becomes a GPU budget, which is dramatically easier to optimize.

### Performance budget (target: 60 FPS Ultra / 120 FPS High)

At 60 FPS (16.67ms/frame), Ultra preset:

| Component | Budget | Internal res | Notes |
|---|---|---|---|
| Fluid sim (MLS-MPM, 50K particles) | 2.0 ms | full | P2G + grid + G2P compute |
| Radiance Cascades GI (4 cascades) | 2.0 ms | 0.5x | Cascade 0 most expensive |
| Shadow map (key light only) | 0.4 ms | 0.5x | Fluid casts soft shadow |
| Nebula volume raymarch | 1.0 ms | 0.5x | 24 steps + temporal accum |
| Fluid SSFR rendering | 1.8 ms | 0.6x | Depth + thickness + bilateral + composite |
| Stage lights + bokeh + foreground | 1.0 ms | 0.6x | All in one main render pass |
| Bloom (MRT, emissive channel) | 0.9 ms | 0.3x | 5-mip pyramid |
| Motion blur (8 samples) | 0.5 ms | 0.6x | Cheap because pre-TAAU |
| DOF (bokeh, hex aperture) | 0.6 ms | 0.6x | Focal plane on fluid center |
| TAAU upscale to native | 1.2 ms | 0.6x → 1.0x | Catmull-Rom + variance clip |
| Tonemap + LUT + grain | 0.3 ms | 1.0x | Final 1.0x pass |
| **CPU orchestration** | 0.8 ms | — | Camera, conductor, dispatch |
| **Headroom** | 3.2 ms | — | OS jitter, GC, browser tax |
| **TOTAL** | **15.7 ms** | | ~63 FPS sustained |

**Why 60 FPS not 120 FPS as the headline target**: AAA visual fidelity requires expensive techniques (GI, SSFR, volumetrics) that can't easily fit 8.33ms. Ultra preset = 60 FPS. High preset (no GI, simpler SSFR, fewer fluid particles) targets 120 FPS. The user picks their tradeoff.

**Adaptive scaling**: The frame budget controller drives TAAU's internal scale (0.45x to 0.75x). When the budget is healthy, render at 0.7x for sharper image; when frames stretch, drop to 0.5x. TAAU + sharpening hide the resolution change perceptually.

### Per-tier preset table

| Preset | Fluid particles | Radiance cascades | TAAU scale | Bokeh dust | Foreground embers | DOF | Motion blur | Target |
|---|---|---|---|---|---|---|---|---|
| Minimal | 5K, simple emitter | OFF | 0.5x | 200 | 0 | OFF | OFF | 60 FPS mobile |
| Low | 12K | OFF | 0.6x | 600 | 200 | OFF | OFF | 60 FPS iGPU |
| Medium | 25K | 2 cascades, 0.5x | 0.6x | 1500 | 600 | OFF | 4 samples | 60 FPS desktop |
| High | 50K | 3 cascades, 0.5x | 0.65x | 3000 | 1200 | bokeh, 5 taps | 6 samples | 120 FPS RTX 3070 |
| Ultra | 75K | 4 cascades, 0.5x | 0.7x | 4000 | 2000 | bokeh, 7 taps | 8 samples | 60 FPS RTX 3070 |
| Extreme | 100K | 4 cascades, 0.6x | 0.75x | 6000 | 3000 | bokeh, 9 taps | 12 samples | 60 FPS RTX 4080 |

---

## 5. The "Story" Layer — UX & Composition Beats

The current theme is reactive but not narrative. V3 makes the theme tell a story across a play session.

### Session arc
- **First 30s** (game start): Drift act. Quiet, ambient, the camera does one slow figure-8. Establishes the world.
- **Mid-game** (combos starting): Build act. Camera takes interest, starts tracking blob motion. Lights snap from cool to warm.
- **Late game** (sustained pressure): Surge act. Camera dynamic, GI fully kicked in, palette saturated.
- **Game over**: Resolution. Slow pull-back to a wide shot. Fluid de-saturates and slows. Music fades. Camera holds for 4 seconds before next round.

### Beat-level reactivity

| Event | Camera | Fluid | GI | Post |
|---|---|---|---|---|
| Piece lock | — | small inward pulse at lock position | — | — |
| Soft drop | — | — | — | — |
| Hard drop | small punch toward board | shockwave ring outward | brief overbright | small impact bloom |
| Single line | — | wave outward along clear line | accent color cascade boost | — |
| Tetris | dolly-push 0.4u | radial detonation, 200ms vortex | full-scene flash of accent | bloom +0.3, chromatic +0.005, 1-frame lens flare |
| Combo 4 | slow zoom (3°) | swirl injection | accent color shift | chromatic pulse |
| Combo 7+ | dolly-zoom 1.2s (Vertigo) | 3 simultaneous vortices, palette desaturate-then-resaturate | full-scene secondary light burst | god-rays surge, motion blur amplified |
| Level up | sweep left to right | color drift across fluid mass | palette shift | LUT cross-fade |
| Game over | slow pull-back | freeze, slow drift | cool down to act-I palette | bloom fades, vignette darkens |

### Loading UX

Current theme takes seconds to first paint. V3 targets:
- **First frame visible: <200ms** — render an empty nebula sky immediately, no waiting on fluid/cascades
- **Fluid appears: <600ms** — sim starts with 5K particles, scales up to preset target over 1s
- **Full quality: <2s** — cascades + DOF + motion blur layer in after first 60 frames
- **No "loading" indicator** — the fade-in IS the loading state, and it feels intentional

---

## 6. Implementation Phases (~20 working days)

Phases are gated by exit criteria — no advancing until criteria met. Phases 4-7 unlock parallel work; the critical path is 0 → 1 → 2 → 3 → then 4-7 in parallel → 8 → 9 → 10.

| Phase | Scope | Exit criteria | Effort |
|---|---|---|---|
| **0. Scaffold + r183 upgrade** | New file structure; verify three.js r183+ RenderPipeline; delete dead WebGL renderer | Theme loads black screen, no errors, lint clean | 1 day |
| **1. TAAU + velocity buffer** | TSL TAAU node, velocity render target, jitter sequence, sharpening | Static nebula sky renders at 0.6x → upscaled cleanly to 1.0x | 2 days |
| **2. MLS-MPM fluid sim** | P2G + grid + G2P compute pipelines, atomic ops, single-emitter test | 50K particles drifting under gravity at 60 FPS | 3 days |
| **3. Fluid SSFR rendering** | Depth pass + thickness + bilateral filter + surface normals + composite | Fluid renders as continuous translucent surface, not discrete particles | 2 days |
| **4. ★ Radiance Cascades GI** | 4-cascade hierarchy, bilinear merge, sRGB linearization, edge-aware | Emissive fluid actually lights the nebula behind it | 3 days |
| **5. Nebula volume + temporal** | Raymarched 3D noise volume, half-res, temporal reproject | Volumetric sky with parallax, no shimmering during camera motion | 1.5 days |
| **6. Camera director + 3 acts** | Cinematic camera state machine, act transitions, beat reactions | Camera responds to all events distinctly, smooth between acts | 1.5 days |
| **7. Modern post stack** | MRT bloom + motion blur + DOF + ACES + LUT, all r183 RenderPipeline | Side-by-side vs current shows clear quality jump | 2 days |
| **8. Game event → fluid forces** | spawnLineWake/applyBlobReaction/comboHandler → fluid force injection | Every event from current theme has a fluid response | 1 day |
| **9. Quality presets + adaptive** | All 6 tiers calibrated, adaptive TAAU scale wired to budget controller | Theme runs at target FPS on each tier | 1 day |
| **10. Polish + profile + ship** | Chrome GPU profile, optimize spikes, dispose audit, theme-swap test | 60 FPS sustained on Ultra; clean memory across 10 swaps | 2 days |

---

## 7. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Radiance Cascades unproven in three.js TSL — no public reference impl | High | Phase 4 budgets 3 days specifically for this. Fallback: simpler screen-space probes (worse quality but proven). If both fail, ship with one bounce of "fake" SSGI. |
| MLS-MPM requires WebGPU compute + atomics; mobile may lack support | Medium | Detect at init (theme.js capabilities.supportsCompute). Mobile uses Minimal/Low preset with 5K-12K particles only (no MLS-MPM, simpler advection). |
| TAAU history invalidation on theme swap could ghost across themes | Medium | Reset TAAU history buffer on theme.start(). Already a pattern in the current adaptive scaling. |
| Three.js r183 RenderPipeline not yet in our dep version | Low | Check `package.json`. If <r183, upgrade as Phase 0 step — already a common upgrade path. |
| MLS-MPM atomics performance varies wildly between vendors (NVIDIA fast, Intel slow) | Medium | Provide preset auto-detect: lower particle counts on detected slow vendors. |
| 50K-particle SSFR may hit fillrate limit at high res | Medium | SSFR rendered at 0.6x internal (matches TAAU scale). Bilateral filter is single-pass to avoid edge thickening. |
| Cumulative complexity overruns 20-day estimate | High | Phase 4 (Radiance Cascades) is the variable. If at end of Phase 4 we're not at "lighting bounces visibly," ship with simpler "emissive-driven SSAO" approximation and tag GI as post-launch. |
| Camera director swings too dramatic, causes motion sickness | Low | All camera moves capped at 0.5u displacement, max 3°/s rotation. User-testable in Phase 6. |
| GI + motion blur combined ghosts on rapid combos | Medium | TAAU's variance clip should handle it. Tune in Phase 10 polish. |

---

## 8. Definition of Done

V3 ships only when ALL of these are true:

- [ ] **60 FPS sustained on Ultra** on RTX 3070 / M1 Pro, verified via `renderer.info` + Chrome perf overlay (10-minute soak test)
- [ ] **No frame-time spikes > 18ms** during a stress sequence (idle → 4-line tetris → 10x combo → game over)
- [ ] **First frame visible within 200ms** of theme.start() being called
- [ ] **Side-by-side video** vs. current implementation clearly demonstrates: (a) fluid behavior, (b) GI light bounce, (c) cinematic camera moves, (d) AAA-grade post
- [ ] **All 6 quality presets** hit their target FPS on at least one representative device
- [ ] **Memory profile flat** after 10 theme-in / theme-out cycles
- [ ] **Zero console errors**, **zero shader compile warnings**, **lint clean** on changed files
- [ ] **No regression** in event-bus contracts (every event the current theme reacts to, V3 reacts to)
- [ ] **Total LOC ≤ 5,500** across the theme directory (51% reduction from current 10,317)
- [ ] **Documented**: this plan kept up-to-date, plus a 1-page README.md in the theme directory pointing at the architecture

---

## 9. Out of Scope (Deliberate Cuts)

- No multi-camera setups (single perspective camera only)
- No fluid-blob collision with the Tetris board (board is invisible to fluid)
- No editable color picker — palette locked to harmony
- No video texture / image asset dependencies — everything procedural
- No VR / AR rendering paths
- No "story mode" with named characters — the "story" is abstract beats, not narrative
- No saved-state replay — every frame is a fresh function of (time, fxState)

---

## 10. Technical References Used

These were studied during the planning phase and inform specific architectural choices:

- [Radiance Cascades — Jason Today](https://jason.today/rc) — The canonical write-up. Used for Phase 4 cascade-count and probe-spacing formulas.
- [Building Real-Time Global Illumination — Jason Today](https://jason.today/gi) — Conceptual primer on hierarchical light sampling.
- [WebGPU Fluid Simulations — Codrops, Feb 2025](https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/) — MLS-MPM > SPH justification, SSFR pipeline.
- [Particles, Progress, and Perseverance — Codrops, Jan 2025](https://tympanus.net/codrops/2025/01/29/particles-progress-and-perseverance-a-journey-into-webgpu-fluids/) — Iteration insights for fluid sim development.
- [WebGPU-Ocean (matsuoka-601)](https://github.com/matsuoka-601/WebGPU-Ocean) — SPH reference, ~300K particles on desktop GPU.
- [WebGPU-Fluid-Simulation (LinzhouLi)](https://github.com/LinzhouLi/WebGPU-Fluid-Simulation) — Linear grid neighborhood search reference.
- [Temporal Upscaling WebGPU — three.js discourse](https://discourse.threejs.org/t/temporal-upscaling-webgpu/89989) — TAAU implementation details, jitter handling, mipmap bias warning.
- [Three.js WebGPU Motion Blur Example](https://threejs.org/examples/webgpu_postprocessing_motion_blur.html) — Velocity buffer pattern for motion blur.
- [Three.js Post-Processing Guide 2026](https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026) — r183 RenderPipeline patterns.
- [Migrate Three.js to WebGPU 2026 — Utsubo](https://www.utsubo.com/blog/webgpu-threejs-migration-guide) — General WebGPU migration checklist.
- [Field Guide to TSL and WebGPU — Maxime Heckel](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/) — TSL patterns, compute dispatch sizing (kept from V2 plan).
- [SSGI WebGPU Demo — Anderson Mancini](https://ssgi-webgpu-demo.vercel.app/) — Screen-space GI fallback option for Risk Register.
- [Surfel-based GI on the Web — Jure Triglav](https://juretriglav.si/surfel-based-global-illumination-on-the-web/) — Alternative GI approach if Radiance Cascades hits walls.

---

## 11. What This Plan Says No To

This plan deliberately rejects easier shortcuts:
- **No "just add more bloom"** — Bloom can't fake GI. The whole point is real light transport.
- **No "more particles = more wow"** — 100K particles in random motion looks like noise. The intent is *meaningful* fluid behavior.
- **No "screen-space everything"** — Some effects (GI, fluid) need world-space presence to feel grounded.
- **No "iterate on V2"** — V2 was a different premise. Mixing V2's discrete blobs with V3's fluid would be incoherent.

---

## 12. Effort Summary

- **Total estimated effort**: ~20 working days (4 weeks at 1 dev)
- **Critical path**: Phases 0-4 (~10 days)
- **Parallel-izable**: Phases 5-9 (~6 days, can compress to 3-4 with 2 devs)
- **Risk buffer**: 2 days included
- **Outcome**: A theme that genuinely justifies "best-in-class WebGPU implementation" — fluid physics, real GI, cinematic camera, modern temporal post, all running at stable 60 FPS on enthusiast hardware.

---

*End of plan. To start Phase 0, the first commits are: (1) verify three.js version supports r183 RenderPipeline; (2) scaffold the new file structure with empty stubs; (3) delete `webgl-electric-dreams-renderer.js` and `electric-dreams-hero-particles.js`; (4) cut `electric-dreams-theme.js` down to a thin orchestrator while preserving event subscriptions.*
