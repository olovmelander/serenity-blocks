# Odyssey — AAA WebGPU Cinematic Overhaul · MASTER PLAN

> **The one ambition:** turn the Odyssey level-select into a single, continuous, technically-outstanding cinematic ascent — *Tetris Effect: Connected — Journey Mode* rendered in **WebGPU/TSL** like the rest of the game's themes, where the camera flies one unbroken take up a path that threads through eight worlds, every world is a GPU-driven showpiece, the seams between worlds are designed "wow" beats quantized to the music, and the whole journey breathes. No menu cuts. No flat backdrops. No WebGL holdout.
>
> **This is the master plan.** It unifies and supersedes the framing of two siblings, which remain the detailed references:
> - [ODYSSEY_CINEMATIC_JOURNEY_PLAN.md](ODYSSEY_CINEMATIC_JOURNEY_PLAN.md) — the deep **cohesion** design for path · camera · travel · themes · transitions and the cross-dimension **alignment matrix**. *Authority for §5 here.*
> - [ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md](ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md) — the original director/atmosphere/diegetic-path spine (P0–P4 shipped). *Its WebGPU deferral is now lifted (see §3).*
>
> **Method:** work from **screenshots** and from **researched AAA technique**, plan before changing, and convert/redesign one slice at a time with before/after captures. Every technique below is grounded either in the actual code (file:line) or in a real, fetched source (cited in Appendix A).

---

## 0. Orientation — what's true today (verified in code)

The build is far past the old checklist. Grounded survey of the current tree found:

- **The conductor exists** (`OdysseyDirector`) and blends per-act camera + atmosphere + audio energy — but it's **dark by default**, gated behind `?odysseyAAA=1`. ([OdysseyBoardController.js:1129](../src/rendering/odyssey/OdysseyBoardController.js#L1129))
- **The board is the WebGL holdout.** `new THREE.WebGLRenderer` ([OdysseyBoardController.js:567](../src/rendering/odyssey/OdysseyBoardController.js#L567)) + a legacy `EffectComposer`/`UnrealBloomPass`/GLSL-`ShaderPass` post chain. **63 raw GLSL `ShaderMaterial`s** across 14 files. Every in-game theme is already WebGPU/TSL.
- **Transitions are built but split across clocks**; the threshold breach (`ChapterThresholdDirector`) fires, but the env crossfade, music cut, path band, and post flash all run on different timebases (detailed in the cohesion plan §4).
- **Three chapters are vertically detached** from the path (Ch1/Ch5/Ch6), and the heroes of most worlds sit at z=−600…−900 as flat backdrops with empty foreground.
- **Travel is node-to-node hops + scrub** — there's no continuous flight, and pace never adapts per world.

**The verdict that unlocks everything:** converting the board GLSL→TSL is a **clean single-codebase migration** (§3) — and once the board runs through the conductor on WebGPU, every visual/cohesion upgrade in this plan becomes possible.

---

## 1. The experience we're building

One scalar — **journey progress `t ∈ [0,1]`** (camera arc-length up the spline) — drives **one continuous film**:

| Act | Worlds | Time-of-day / air | Camera | Hero spectacle |
|----|--------|-------------------|--------|----------------|
| **I — Origin** | Earth Core · Deep Ocean | pre-dawn underground glow → blue filtered depth | close, enclosed, banked | magma vault + GPU embers · god-ray light-shaft + **real caustics** |
| **II — Living World** | Surface · Mountains | morning → midday, aerial haze | open, grounded | volumetric clouds + pollen · alpenglow summit + **volumetric aurora** |
| **III — Beyond** | Sky · Space | golden afternoon → no-air starfield | vast, slow, wide FOV | cloud-sea + crepuscular rays · **raymarched nebula** + hero planet |
| **IV — Transcendence** | Black Hole · Neon City | eclipse (emissive-only) → night, artificial light | abstract → kinetic, **dolly-zoom** | **ray-bent gravitational lensing + accretion disk** · neon megastructure + wet reflections |

The light, fog, exposure, and grade **ease continuously** along `t` (one moving sky), while **audio energy** layers a faster pulse on top (bloom swell, particle bursts, path flow, gentle forward drift) so the climb **grooves with the music** — the synesthetic coupling at the heart of Tetris Effect (Appendix A1).

Three things make it read as AAA rather than a tech demo, and they compound:
1. **A world-class rendering core** (WebGPU/TSL, selective HDR bloom, ACES, volumetrics, GPU-compute particles) — §3.
2. **Eight worlds that envelop the path** with real parallax and a signature hero effect each — §4.
3. **One authored, continuous journey** — path, camera, travel, transitions, atmosphere all conducted from the same spine — §5.

---

## 2. The three workstreams (and how they stack)

```
   ┌─────────────────────────────────────────────────────────────┐
   │  C. THE COHESIVE JOURNEY (§5)  path·camera·travel·seams·grade │  ← authored film
   ├─────────────────────────────────────────────────────────────┤
   │  B. PER-CHAPTER AAA VISUALS (§4)  hero effects · composition  │  ← eight showpieces
   ├─────────────────────────────────────────────────────────────┤
   │  A. WEBGPU/TSL RENDERING CORE (§3)  one renderer · TSL · MRT  │  ← the foundation
   └─────────────────────────────────────────────────────────────┘
```

A is the precondition: compute particles, selective bloom, raymarched volumetrics, and the TSL post graph that B and C rely on **only exist on WebGPU/TSL**. So the migration goes first (it's also a clean single-path conversion), the per-chapter showpieces are authored as TSL from the start, and the cohesion layer is tuned on top.

---

## 3. Part A — WebGPU/TSL rendering core (the foundation)

### 3.1 Verdict: a clean single-codebase migration (not a dual path)

**Confirmed from three.js 0.181.2 source and from shipped themes:** `WebGPURenderer` auto-installs a **WebGL2 fallback backend** (`getFallback → new WebGLBackend`), and **TSL `NodeMaterial`s run on both backends** through the same `Nodes` code-generator (WGSL on WebGPU, GLSL on WebGL2). The cleanest themes (`shifting-sands`, `stellar-drift`, `pyrestorm-v2`, `sky-children-v2`, `electric-dreams-v3`) ship **TSL-only with zero `ShaderMaterial`** and still run on WebGL2. ([survey: three.webgpu.js `getFallback`; shifting-sands-theme.js:404; stellar-drift 0/69 ShaderMaterials])

→ **We convert each board material to TSL exactly once and retire the GLSL path entirely.** The old plan's "swapping the renderer would break every board shader" is *true for the board as-is* (WebGPURenderer refuses raw `ShaderMaterial` + the jsm `EffectComposer` chain) but is an argument *for* converting, not for a dual path. Target the `shifting-sands`/`pyrestorm-v2` model, **not** winter's legacy `isWebGPU ? node : ShaderMaterial` fork.

### 3.2 Renderer strategy

Swap one line and make init async (the call site already is — `initialize()` is `async`, `initRenderer()` is called at [OdysseyBoardController.js:299](../src/rendering/odyssey/OdysseyBoardController.js#L299)):

```js
// import * as THREE from 'three/webgpu';   (was 'three')
this.renderer = new THREE.WebGPURenderer({ antialias, alpha, forceWebGL: hasFlag('forceWebGL') });
await this.renderer.init();                         // ← MUST await or the canvas is silently blank
this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
this.isWebGL  = this.renderer.backend?.isWebGLBackend  === true;
this.renderer.toneMapping = THREE.NoToneMapping;    // ACES is applied in the TSL post graph
this.renderer.outputColorSpace = THREE.SRGBColorSpace;
```

The `?forceWebGL=1` URL flag (already a project convention) flips to the WebGL2 backend with no code change — the QA lever for testing the fallback.

### 3.3 The conversion recipe (one material → one node graph)

Every `new THREE.ShaderMaterial({uniforms, vertexShader, fragmentShader})` becomes one TSL `NodeMaterial`:

| GLSL | TSL |
|---|---|
| `fragmentShader` body | `material.colorNode = Fn(() => …)()` |
| vertex displacement | `material.positionNode` (reuse `valley-terrain.js` / `ridge-terrain.js` template: FBM heightfield + analytic normal via `varying`) |
| alpha / discard | `material.opacityNode` (+ `alphaTest`) |
| **bloom-eligible** surface | `material.emissiveNode` **+** `material.userData.emitsBloom = true` |
| `uniform float uTime` | `const uTime = uniform(0)`, tick `uTime.value` from JS (unchanged plumbing) |
| `a*b`, `1.0-x`, `mix/clamp/smoothstep` | `a.mul(b)`, `oneMinus(x)`, free fns from `three/tsl` |
| per-instance/vertex attrs | `attribute('aNodeColor','vec3')` |
| `AdditiveBlending`, `transparent`, `side` | pass straight through the `NodeMaterial` constructor |

**Two non-negotiable rules** (both already documented in the codebase):
- **MRT discipline:** every bloom-eligible material (path, nodes, breaches, lava, neon, accretion, god-rays, aurora, corona) sets `emissiveNode`; atmosphere/sky-dome/mid-env/fog must **NOT**, or selective bloom washes the frame.
- **No top-level `.assign()`** in plain-JS struct-returning shade helpers (throws *"No stack defined"*) — compose with fresh `const` + `.add()` chains; `.toVar()`/`.assign()` is only legal **inside** an `Fn(() => {…})` closure.

### 3.4 Shared TSL noise — build first, ~zero net-new work

`odyssey-noise.js` (hash/value/fbm2/fbm3/ridged3/curl3) already has TSL twins in-repo: **`lunara-noise.js` is a superset** (hash31/33, valueNoise3, fbm3, warpFbm3, ridged3, voronoi3, **curl3**), plus `tsl-fire-lib.js` (worley2), `electric-dreams-v3/materials/tsl-noise-lib.js`, and three's **built-in `mx_fractal_noise_*` / `mx_worley_noise_*`** from `three/tsl`. → Lift one self-contained **`chapter-environments/shared/odyssey-tsl-noise.js`** (mirroring how `intro-noise-lib.js` copies rather than depends on a theme). Match the octave count/lacunarity (od_fbm3 = 5 octaves, 2.03) so the look doesn't shift. This single file **unblocks the 4 chapters** that import `ODYSSEY_NOISE_GLSL` (sky-drift, cosmic-expanse, black-hole, urban).

### 3.5 Post-processing — the TSL graph (the big separate chunk)

Replace `PostProcessingStack` + `odyssey-post-fallback` (EffectComposer/UnrealBloom/GLSL ShaderPass) with a **TSL `PostProcessing` node graph** (copy `winter-pipeline.js` / `sky-pipeline.js`):

```
pass(scene,camera) → MRT { output, emissive }
   → bloom( emissivePass, strength, radius, threshold )   // TRUE selective bloom (not full-frame)
   → godrays( depthNode, camera, light )                  // gated by sun screen-validity
   → dof( color, focus=activeNode, … )                    // racks onto the held level node
   → ACES tonemap  → per-chapter LUT / lift-gamma-gain  → CA · vignette · film-grain
post.outputNode = composite
```

- **Selective bloom is an upgrade, not a port:** today bloom is full-frame `UnrealBloomPass` keyed on brightness. MRT lets the path/nodes/neon/lava glow while sky gradients and fog stay crisp (Appendix A3). Wrap `bloom` in `gaussianBlur` to kill the known BloomNode motion-grain (relevant to a constantly-moving camera).
- All director-driven boosts (seam bloom, grade, fog) become **`uniform()` nodes**, so transitions crossfade post parameters instead of writing pass properties.

### 3.6 GPU-compute particles (the density that screams AAA)

Odyssey's particles are currently CPU `THREE.Points` (~7040 summed across chapters at High). On WebGPU, consolidate into **TSL compute** (`instancedArray` storage buffers + `computeAsync`, copy `black-hole-compute.js` / `stellar-drift` nebula-burst): an init kernel seeds from `instanceIndex`, an update kernel advects each particle by a **curl-noise** flow field (divergence-free, fluid-like), and the render material's `positionNode` reads the same buffer. Gate compute behind `if (this.isWebGPU)` with a CPU/instanced fallback (scale count ~0.72× like stellar-drift) so WebGL2 still has particles. Scale `COUNT` by the existing 6-tier quality ladder. (Appendix A6.)

### 3.7 Validation (this machine *can* validate WebGPU headless)

Build **`scripts/odyssey-webgpu-validation.mjs`** from `cosmic-noir-phase6-validation.mjs`: run `webgpu_high` + `webgl_high (forceWebGL=1)` + `no-compute` scenarios, `capturePage()` per chapter (reuse `panToChapter`), and **fail on WGSL/RenderPipeline console errors** (`"THREE.Error while parsing WGSL"`, `"Invalid ShaderModule/RenderPipeline"`). `enable-unsafe-swiftshader` lets WebGPU validate even on a software adapter. *(Caveat: software-adapter green proves correctness, not frame rate — measure real-GPU perf separately.)*

### 3.8 The conversion work-list (the 63 materials)

Full inventory in **Appendix B**. Sequencing by leverage and risk:

1. **`odyssey-tsl-noise.js`** (unblocks 4 chapters) — *delete dead `rim-shaders.js`.*
2. **Warm-up:** `OdysseyAtmosphere` sky-dome (1 material, the canonical *must-NOT-bloom* case).
3. **Pilot chapter: `deep-ocean`** — only 3 materials but the **full vocabulary** (gradient sky + animated surface + additive volumetrics + 3 Points systems); self-contained.
4. **Remaining chapters**, easy→hard: `mountain-peaks`, `black-hole-transcendence` (M) → `earth-core`, `cosmic-expanse`, `urban-dreams`, `sky-drift` (L) → **`surface-world`** (XL: 10 mats + instancing + terrain).
5. **`OdysseyPathRenderer`** (3 tubes, dual-mode injected GLSL — branch-heavy) + **`ChapterThresholdDirector`** breaches.
6. **`LevelNodeManager`** (XL — instanced attrs + 7040-particle Points; **the hardest single migration — do last**).
7. **Renderer swap** (1 line) + **TSL post graph** (the big chunk) + **validation harness**.

Effort: large but bounded and well-precedented — *single-path, each material written once.* Noise ≈ copy; procedural materials 1–3h each; terrain chapters ~0.5–1 day each; post + node manager are the two big lifts.

---

## 4. Part B — Per-chapter AAA visual redesign + composition

### 4.1 The composition law: worlds **envelop** the path

The crux of "fit *into* the journey, not sit behind it." For every chapter, in priority order:
1. **Path-anchor it** to the real spline (`getChapterPathRange()`) — *first* fix Ch1/Ch5/Ch6's vertical detachment.
2. **Add a path-hugging mid-layer** — corridor geometry within ~30–80u either side of the route (built on the spline frame), so there's **real parallax on both sides**, not just a distant skyline. Keep the far hero as the silhouette backdrop.
3. **Depth-sorted strata** around the spline so the banked forward motion yields automatic parallax (Ori's painterly-depth trick, Appendix A5).

### 4.2 The eight worlds — each gets ONE signature GPU hero effect

Authored directly in TSL (so they only ever exist on the new core). Techniques are research-backed (Appendix A6/A4):

| Ch | World | Hero effect (technique) | Composition / mid-layer | GPU particles |
|----|-------|------------------------|--------------------------|---------------|
| **1** | Earth Core | **Magma vault** — FBM lava with displaced `positionNode`, HDR emissive into bloom; heat-shimmer | Lava arches the path passes **under**; crater ring envelops (already gold-standard) | curl-advected **embers** + smoke |
| **2** | Deep Ocean | **Real caustics** (refracted light-mesh Jacobian area) + god-ray light-shafts (analytic height-fog) | Kelp & light-shafts the path **weaves between**; surface ceiling tracks the spline | bioluminescent plankton/bubbles (compute) |
| **3** | Surface | **Volumetric clouds** (raymarch: Beer-Lambert + Henyey-Greenstein, blue-noise/half-res) | Rolling hills + foothill bridge that pre-echoes Ch4 (keep — it's the model seam) | pollen / petals / butterflies |
| **4** | Mountains | **Volumetric aurora** (folded `abs(noiseA−noiseB)` curtains, altitude color) + alpenglow summit | **Switchback** ridge corridor with cairns either side (not a far proscenium) | drifting snow (compute) |
| **5** | Sky & Drift | **Cloud-sea + crepuscular god-rays** through cloud breaks (GPU Gems radial-blur, sun-gated) | Cloud banks the path **threads between**; re-anchor env to path (fix +185u) | cloud motes / rain veils |
| **6** | Space | **Raymarched nebula** (FBM density, HG phase) + banded hero planet | Asteroid/lens-gate **gauntlet** the path curves through; re-anchor env (fix −231u); **kill aerial perspective** (no air) | star/dust field (compute, 100k+) |
| **7** | Black Hole | **Ray-bent gravitational lensing + accretion disk** (inverse-square ray nudge, Doppler beaming, Einstein ring) — the *Interstellar* look in ~400 lines of TSL | Spiral the path **inward** toward the horizon; emissive-only, no sun | infalling accretion sparks |
| **8** | Neon City | **Procedural lit-window facades** + neon megastructure + **wet-reflection** plane; night fog catching neon | Promote neon rings to **path-straddling gates**; building faces line the route; lengthen the world | neon rain (compute) |

### 4.3 Consistency across the eight

- **Unify the fidelity bar:** the migration *forces* this — all 8 use the shared TSL noise + the same `directorState` reactivity hooks (today Ch1–4 ignore the director, Ch5–8 react). After migration the whole ascent breathes with music, not just the back half.
- **One atmosphere ledger:** collapse `chapters.js environment{}` and `chapter-profile.atmosphere{}` into one source (cohesion plan A2), so a world is recolored in one place.

---

## 5. Part C — The cohesive journey (path · camera · travel · transitions · grade)

The detailed cohesion design + the 15-row cross-dimension **alignment matrix** live in [ODYSSEY_CINEMATIC_JOURNEY_PLAN.md](ODYSSEY_CINEMATIC_JOURNEY_PLAN.md). The research upgrades it with specific, citable technique:

### 5.1 Path
Re-author the spline into **8 deliberate gestures** with a climb that never flatlines (`tangent.y ≥ ~0.30` through the mids; lengthen the too-short Urban world). Use **centripetal/chordal Catmull-Rom** (not uniform) to avoid cusps where node density varies. Per-world `widthScale` + **authored banking** (wire the dead data). (Appendix A7, A2.)

### 5.2 Camera — researched rig
- **Dual-spline:** a position curve + a **separate look-at curve sampled ahead** (`getPointAt(t + ~0.04–0.08)`) so the camera *leads* into each world. Arc-length sampling = constant velocity. (DEPT, Appendix A7.)
- **Frenet-frame orientation + curvature-proportional banking** (sign from `cross(prevTangent, currTangent)`, damped ~0.06) so the camera **banks into the spiral** — verify against twist with a rotation-minimizing frame.
- **Pitch↔distance↔FOV coupling**; **slide along the binormal** (don't yaw) to off-center a node; pull out + pitch down over drops.
- **Held vista reveals** at each world entry: thread a tight occluder → pull back + rise + widen FOV (60→85°) as the hero landmark lands; hold ~1.5–3s for the music to crest.
- **One dolly-zoom per act** reserved for the biggest beats (Black Hole gateway = dread; Space emergence = awe).
- Per-chapter camera params (tension, look-ahead, smoothing, FOV, bank gain) authored on chapter data; **un-gate from `?odysseyAAA=1`**.

### 5.3 Travel — a living current
A `TravelModel` with **momentum + idle auto-drift** (the journey moves on its own), **per-act world-unit speed** (slow & vast in Space, tight & quick in the Core), **FOV-coupled speed** (widen >85° on launches for visceral rush, narrow ~50° on held shots), **seam ritardando** (ease down into a seam, push through, settle out), **beat-synced forward drift**, and retuned friction. (Cohesion plan §3.3 + Appendix A7.)

### 5.4 Transitions — 7 designed seam archetypes, beat-quantized (never reuse twice)
A `SeamDirector` owns each seam as data keyed off **camera arc-length** (deterministic, scrubbable), with everything on **one position-driven `seamPhase`** (cohesion plan A6). Per the research (Appendix A2), assign distinct archetypes:

| Seam | Archetype (technique) |
|------|------------------------|
| 1→2 Core→Ocean | **Magma-crust dissolve** — noise 3-zone shader, glowing orange edge band "cools" into water; motes peel off the frontier |
| 2→3 Ocean→Surface | **Camera RISE through the caustic surface** — break the waterline, no mask |
| 3→4 Surface→Mountains | **God-of-War throat** — route the spline into an occluding canyon; slow → stream mountains behind → accelerate out |
| 4→5 Mountains→Sky | **Render-target noise cross-dissolve** — peaks morph into cloud-sea (two live RTs, Perlin-masked `mix`, screen-space sampled) |
| 5→6 Sky→Space | **Whiteout breach veil** (Rift Apart) — ramp HDR white over ~0.3s; **swap the env on the peak frame** under max luminance (pre-warm one beat early) |
| 6→7 Space→Black Hole | **Lensing portal** — render-to-texture window; the black hole visible through the tear before you fall in; hand off camera/velocity continuously at plane-crossing |
| 7→8 Black Hole→Neon | **Portal + RT morph** — singularity inverts into the city, hard beat-synced stinger on emergence (highest contrast) |

**Audio bridge** (Appendix A2/A1): quantize every visual trigger to the next **bar/beat** (schedule off the audio clock, not rAF); crossfade chapter loops at the bar boundary; strip incoming music to a drone on approach, layer stems back in on emergence; fire a matched stinger on the breach. Replace the current **hard music cut** with this.

### 5.5 Atmosphere & grade — one moving sky
- **One master sun vector** from `t` drives a time-of-day curve (pre-dawn core → blue dawn ocean → morning → midday → golden afternoon → no-air space → eclipse → neon night).
- **Lightweight Hillaire atmosphere** (precompute Transmittance 256×64 + Multiple-Scattering 32×32 once; recompute the small Sky-View LUT only when the sun moves; 32×32×16 aerial-perspective froxel) OR the **cheap IQ analytic fog** node as baseline (sun-tinted inscatter, closed-form height fog). Sample the froxel by depth so distant geometry **desaturates toward the sky** (correct aerial perspective, not flat fog). (Appendix A4.)
- **HDR pipeline order:** linear → exposure → **bloom → ACES → per-chapter LUT** (lift/gamma/gain cross-faded along arc-length). Let emissive sources push >1.0 so the filmic shoulder makes them glow, not clip. Consider **AgX** for the neon/black-hole chapters (ACES skews saturated hues).
- **Histogram auto-exposure** with `tau`-based eye adaptation (≈1.1, slower ≈0.7 for dramatic reveals) — the camera eye-adjusts breaching the ocean surface, blinding into Space, adapting into the Black Hole. Exclude luminance percentiles so a lone sun/void doesn't pump the frame.
- **Space & Black Hole: explicitly disable aerial perspective + height fog** — the *absence of air* becomes the narrative signal of altitude.

---

## 6. Audio-visual synergy — the Tetris Effect coupling

The north star is synesthesia: vision : audio : (haptic) at ~1:1:1 (Appendix A1). Concretely, drive the new TSL uniforms (`emissiveIntensity`, `bloomStrength`, `fogDensity`, `particleEmission`, `curlSpeed`, travel-drift) from `OdysseyAudioReactor`/`OdysseyDirector` (already present): **bass → path head-glow + particle bursts + forward surge; beat → node focal pulse + bloom tick; sustained energy → exposure/grade warming + drift speed.** Use the browser-proven recipe (one `AnalyserNode`, FFT split into smoothed/clamped bass/mid/treble, beat detection off-thread). Adopt the **excitation/relaxation curve**: ramp density/bloom/speed to a crescendo approaching each chapter node, then **drop into a euphoric trough** at the node (the breathe/level-select moment). Quantize seam breaches to the downbeat (§5.4). Gate audio behind a user gesture (autoplay policy).

---

## 7. Screenshot methodology — work from what we see

**Reality check (honest):** the capture harness is correct and ready, and I confirmed its invocation + **repaired the missing Electron binary** in the tree — but capture **could not run in this sandboxed tool environment** (Electron's network service crashes, so the Vite dev server is unreachable). **It must be run in your real desktop session.** It's pure WebGL today and renders identically in Chrome, so this is purely an environment limitation, not a harness one.

**To capture (on your machine):**
```powershell
# baseline (chapter starts + mids + seams, ?odysseyAAA=1):
$env:ODYSSEY_CAPTURE_MODE="positions"; $env:ODYSSEY_CAPTURE_VARIANT="baseline"; npm run capture:odyssey
# seam reels across each of the 7 transitions:
$env:ODYSSEY_CAPTURE_MODE="seams"; npm run capture:odyssey
# whole-climb travel reel:
$env:ODYSSEY_CAPTURE_MODE="climb"; npm run capture:odyssey
```
The harness already supports `positions`/`seams`/`climb` modes, drives `panToPosition(any 0..1)`, and bakes the exact targets (chapter mids `0.046,0.148,0.278,0.426,0.574,0.731,0.879,0.972`; starts/seams `0,0.093,0.204,0.352,0.500,0.648,0.815,0.944`). The `?odysseyAAA=1` overlay stamps chapter/seam/progress/FOV into each frame. *(If Electron's binary is missing on a fresh clone, `node node_modules/electron/install.js`; if a sandbox blocks the download, extract the cached zip under `%LOCALAPPDATA%\electron\Cache\…` into `node_modules/electron/dist`.)*

**Storage:** committed curated sets under `docs/odyssey-screenshots/{baseline,<phase>}/` + a jimp contact sheet (`jimp@0.16` is a dependency); raw reels in `artifacts/odyssey/` (gitignored). **Every WebGPU conversion and every visual change is bracketed by before/after captures** — and for WebGPU, by a `webgpu` **and** `forceWebGL` capture to prove backend parity.

---

## 8. Integrated phased roadmap

Each phase is independently shippable and **opens/closes with screenshots**. WebGPU migration, cohesion, and visuals are interleaved so each phase is visible.

| Phase | Goal | Work | Acceptance / screenshots |
|---|---|---|---|
| **P0 — Baseline & harness** | Evidence base; zero behavior change. | Run the §7 reels on the real desktop; commit `docs/odyssey-screenshots/baseline/`. Add the `odyssey-webgpu-validation.mjs` skeleton. | Committed baseline contact sheet (8 chapters + 7 seams), fully loaded. |
| **P1 — Conductor default-on + one source of truth** | Make the journey run through the spine by default; end ledger drift. | Un-gate `?odysseyAAA=1` → overlay only; collapse atmosphere + seam ledgers into `chapter-profile.js`; compute blendState once. *(Still WebGL.)* | Default build shows path styles, breaches, grade, reactivity. No regression. |
| **P2 — WebGPU foundation** | The renderer + TSL spine, proven on a pilot. | `odyssey-tsl-noise.js`; renderer swap (`three/webgpu`, async init, `forceWebGL` flag); TSL post graph (MRT selective bloom + ACES + grade); **warm-up dome**; **pilot = deep-ocean** in TSL. Validation harness (webgpu + forceWebGL). | Deep-ocean renders identically on **both** backends; validation green (no WGSL errors); selective bloom verified. |
| **P3 — Convert the eight worlds** | Whole board on TSL; retire GLSL. | Convert chapters M→L→XL (mountain/black-hole → earth/cosmic/urban/sky → surface); path tubes; threshold breaches; **`LevelNodeManager` last**. Delete `rim-shaders.js` + the GLSL post stack. | All 8 chapters + path + nodes render on WebGPU **and** WebGL2; per-chapter before/after parity captures. |
| **P4 — Per-chapter hero effects + composition** | Eight showpieces that envelop the path. | Path-anchor Ch1/5/6; path-hugging mid-layers; author the §4.2 hero effects (caustics, volumetric clouds, aurora, nebula, lensing, neon); GPU-compute particles (WebGPU) + CPU fallback. | Chapter mids show parallax both sides + a signature hero each; 60fps at High on real GPU. |
| **P5 — Atmosphere, grade & exposure** | One moving sky across the climb. | Master sun curve; IQ/Hillaire atmosphere + froxel aerial perspective; HDR→bloom→ACES→per-chapter LUT; histogram auto-exposure; disable air in Space/Black-Hole. | Horizon montage reads as one continuous time-of-day; eye-adapt beats land at boundaries. |
| **P6 — Camera & travel rig** | The piloted, living journey. | Dual-spline + look-ahead; Frenet banking; FOV-speed coupling; vista reveals; one dolly-zoom/act; `TravelModel` (momentum, per-act pace, idle drift, ritardando, beat drift). | Whole-climb reel: camera leads + banks, pace breathes per act, never freezes. |
| **P7 — Seam director & audio bridge** | Seven seams as designed, beat-locked beats. | `SeamDirector` on `seamPhase`; the 7 archetypes (dissolve/rise/throat/RT-morph/whiteout/portal/portal+morph); music crossfade + drone/stem layering + downbeat-quantized stingers. | Slow-scrub vs fast-hop seam reels: breach + crossfade + path band + music **peak together** on the downbeat; no black-frame gap. |
| **P8 — Polish, perf & accessibility** | Lock it. | Quality-ladder calibration (compute counts, volumetric steps, DOF/godray on/off); reduce-motion toggle (cap banking/FOV/flash/dolly-zoom, photosensitivity); final grade tuning; real-GPU 60fps pass. | Final contact sheet vs baseline; locked 60fps at High; accessibility toggles verified. |

**Critical path:** P0 → P1 → **P2 → P3** (the migration is load-bearing) → P4 → P5/P6/P7 (parallelizable once on TSL) → P8.

---

## 9. Risks & gotchas

- **`await renderer.init()` is mandatory** — omit it and the canvas is silently blank. The board's `initialize()` is already async, so the change is localized.
- **MRT selective bloom + transparency** has known three.js issues — audit every blended/transparent VFX (fog, water, glass, breaches) when wiring the emissive channel. Wrap `bloom` in `gaussianBlur` for the moving-camera grain bug (fixed ~r170; we're on 0.181).
- **TSL `.assign()` "No stack defined"** in plain-JS helpers — fresh `const` + `.add()` chains in struct returns; `.toVar()` only inside an `Fn`.
- **Noise look-shift:** match the chosen TSL lib's octave count/lacunarity to each chapter's original; some private-noise chapters (earth-core, deep-ocean, mountain-peaks, surface-world) may need bespoke porting to avoid drift.
- **Volumetrics & compute are the expensive bits** — half-res + blue-noise jitter + temporal accumulation for raymarching; gate volumetrics/compute behind the quality ladder + `isWebGPU`; CPU/instanced particle fallback for WebGL2 so particles don't vanish.
- **God-rays flicker** when the sun is off-screen — gate by sun screen-validity; disable in Space/Black-Hole.
- **Beat-quantization adds up to ~1 bar latency** — schedule visual triggers off the **audio clock**, lead the spline so the camera doesn't stall waiting for the downbeat.
- **No-cut continuous shot constrains streaming** — every seam swap must hide behind an occluder/portal/whiteout with the next chapter pre-warmed; keep the seam camera on-rails through throats.
- **Software-adapter validation ≠ perf** — green headless run proves correctness, not frame rate; profile on the real GPU, and confirm the `forceWebGL=1` fallback stays acceptable on low-end devices.
- **Don't destabilize level entry** — the `OrbPortalTransitionDirector` warp + `OdysseyLayoutEditor` (2266 lines) consume the path/renderer; keep `odyssey-path-layout.test.js` green; note any noise unit tests that imported the THREE-free `odyssey-noise.js` must change.
- **`LevelNodeManager` is the hardest convert** (instanced attrs + 7040-particle Points + async per-node textures) — pilot a chapter first, do this last.
- **Photosensitivity:** cap luminance ramp on whiteouts/edge bands, honor `prefers-reduced-motion`, offer a reduce-camera-effects toggle.

---

## 10. Open decisions to confirm

Recommended defaults in **bold**; these shape the work.

1. **Ship WebGPU TSL-only (retire the GLSL board), like the newest themes?** **Yes** — clean single path; `forceWebGL=1` covers non-WebGPU. *(Alternative: keep a winter-style GLSL fallback for specific effects — more surface, not recommended.)*
2. **Conductor default-on (P1) — demote `?odysseyAAA=1` to debug overlay?** **Yes** — precondition for everything cohesive.
3. **Tonemap: ACES everywhere, or AgX for neon/black-hole?** **ACES baseline + AgX for the saturated neon/lensing chapters** (ACES hue-skews saturated emissive).
4. **Atmosphere: full Hillaire LUTs or cheap IQ analytic fog first?** **IQ analytic baseline now, Hillaire froxel as a P5 upgrade** where it pays (Surface/Mountains/Sky depth).
5. **Travel: continuous auto-ascent or momentum-on-scroll?** **A living current** (idle drift + momentum + music drift, wheel/stick nudges speed).
6. **Particle budget per chapter** — set the High-tier compute counts (e.g. Space 100k+, others 10–50k) and the WebGL2 fallback scale (~0.72×) — confirm against a real-GPU profile.

---

## Appendix A — Researched techniques & sources (the inspiration corpus)

Fetched and synthesized from real sources; full notes in the research run.

**A1 — Tetris Effect / Enhance (the north star).** 1:1:1 synesthesia (every event = visual pulse + beat-quantized note + haptic); excitation/relaxation flow oscillation (crescendo → euphoric trough); additive vertical music stems tied to progress; seams as multi-sensory "travel events" (morph + downbeat + jolt); the Zone time-stop climax. → drives §1, §5.4, §6.
· Codrops Web-Audio→shader-uniform recipe (FFT bands → smoothed uniforms → curl-noise particles).

**A2 — Seamless transitions.** Noise-driven **dissolve** with glowing HDR edge band + frontier particles (tympanus.net/codrops 2025-02-17; danielilett.com 2020-04-15-tut5-4). **Whiteout breach as load-mask** (Rift Apart, digitaltrends.com Fitzgerald interview). **Render-target cross-dissolve/morph** (blog.maximeheckel.com render-targets). **Stencil/RT portals** (discourse.threejs.org/t/22425). **God-of-War throat masking** (pushsquare.com / playstationlifestyle.net). **Beat-synced audio bridge** — horizontal re-sequencing + vertical layering + stingers (ollybradbury.wordpress.com). → §5.4.

**A3 — WebGPU/TSL core.** Field guide to TSL & WebGPU (blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu) — `Fn`/`uniform`/node hooks, `instancedArray`+`computeAsync`, `pass()`/`PostProcessing.outputNode`. WebGL→WebGPU migration (utsubo.com). TSL wiki (github.com/mrdoob/three.js/wiki). **Selective MRT bloom** (discourse.threejs.org/t/72711 — `mrt`+`getTextureNode('emissive')`, `gaussianBlur` grain fix). → §3.

**A4 — Atmosphere & grade.** Hillaire 4-LUT sky (readkong.com Hillaire 2020). IQ analytic fog (iquilezles.org/articles/fog). Aerial perspective color theory (blog.runevision.com 2025-06). ACES filmic curve (knarkowicz.wordpress.com 2016-01-06). Histogram auto-exposure (bruop.github.io/exposure; alextardif.com/HistogramLuminance) — `tau≈1.1`. GPU Gems 3 god-rays (developer.nvidia.com gpugems3 ch13). three.js TSL nodes confirmed: `acesFilmicToneMapping`, `agxToneMapping`, `bloom`, `godrays`, `lut3D`, `dof`, `exponentialHeightFogFactor`, `linearDepth` (threejs.org/docs TSL). → §5.5.

**A5 — Painterly depth.** Ori — sprites/quads at real depth for parallax, baked motion-blur/DOF for 60fps (zyzyz.github.io GDC2015 Animating Ori). → §4.1.

**A6 — Particles, volumetrics, hero effects.** GPU-compute particles (1M+, curl-noise advection). Raymarched clouds/nebulae (Beer-Lambert + Henyey-Greenstein + light-march; blue-noise/half-res/temporal for perf; github CK42BB/procedural-clouds-threejs, arXiv cloudscape). **Black-hole ray-bend lensing + accretion + Doppler** (~400 lines). Volumetric aurora (`abs(noiseA−noiseB)` folds + altitude color). **Water caustics** via refracted light-mesh Jacobian (Evan Wallace). → §4.2.

**A7 — Cinematic camera.** Dual-spline position + look-ahead look-at (deptagency.com coding-a-cinematic-camera-path). Frenet frames + curvature banking (threejs.org CatmullRomCurve3 — `computeFrenetFrames`, `getPointAt`, centripetal). Nesky's 50 camera mistakes — pitch↔distance↔FOV, slide-don't-rotate (gameanim.com). Dolly-zoom (en.wikipedia.org). Vista reveals (medium.com/nyc-design vistas). God-of-War no-cut shot (playstationlifestyle.net). Damped slerp smoothing (etodd.io poor-mans-3d-camera). → §5.2. *(Caveat: GDC "Designing Journey" + Nesky slides are login-gated; some rules are from third-party transcripts — treat as paraphrase.)*

---

## Appendix B — WebGPU conversion inventory (the 63-material work-list)

Per-file `ShaderMaterial` count · complexity · notes (file refs in the survey):

| File | # | Rating | Notes |
|---|---|---|---|
| `chapter-environments/surface-world.js` | 10 | **XL** | only InstancedMesh chapter; CPU `getTerrainHeight()` shared with shader → reproduce in `positionNode`; imports `mountain-aurora` |
| `chapter-environments/sky-drift.js` | 9 | L/XL | uses `odyssey-noise`; highest blend/transparency count |
| `chapter-environments/cosmic-expanse.js` | 7 | L | uses `odyssey-noise`; black-hole + gas-giant heroes |
| `chapter-environments/urban-dreams.js` | 7 | L | uses `odyssey-noise`; wet-reflection plane trickiest |
| `chapter-environments/earth-core.js` | 6 | L | **private inline noise**; lava `positionNode` displacement |
| `chapter-environments/black-hole-transcendence.js` | 5 | M/L | uses `odyssey-noise`; lensing hero |
| `LevelNodeManager.js` | 4 | **XL** | InstancedMesh per-instance attrs + **7040-particle Points** + async per-node textures — **do last** |
| `chapter-environments/deep-ocean.js` | 3 | S/M | **PILOT** — full vocabulary, self-contained, private noise |
| `chapter-environments/mountain-peaks.js` | 3 | M | private noise; FBM-displaced peaks |
| `OdysseyPathRenderer.js` | 3 | L | dual-mode injected GLSL (`PATH_CHAPTER_GLSL`) — branch-heavy; must emit `emissiveNode` |
| `transitions/ChapterThresholdDirector.js` | 3 | M/L | veil/ring/particle breaches; must emit `emissiveNode` |
| `composition/OdysseyAtmosphere.js` | 1 | **S** | **WARM-UP** — sky-dome, the canonical *must-NOT-bloom* case |
| `chapter-environments/shared/mountain-aurora.js` | 1 | M | Ashima snoise → fold into shared TSL noise |
| `OdysseyBoardController.js` | 1 | S | nebula plane (trivial); **+ the `WebGLRenderer` to swap** |
| **`chapter-environments/rim-shaders.js`** | (2) | — | **DEAD CODE — delete, don't convert** |
| Post passes | ~4 | L | CA/Vignette/FilmGrain/ToneGrade(ACES) → rebuild as TSL `PostProcessing` |

**Shared GLSL → one TSL lib first:** `odyssey-noise.js` (+ `mountain-aurora` snoise) → `odyssey-tsl-noise.js` (copy `lunara-noise.js`/`tsl-fire-lib.js` or use built-in `mx_fractal_noise_*`). **Total: 63 `ShaderMaterial`s, single-path, written once.**
