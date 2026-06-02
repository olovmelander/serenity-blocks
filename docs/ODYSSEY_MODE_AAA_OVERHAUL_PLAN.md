# Odyssey Mode — AAA "Cosmic Ascent" Visual Overhaul Master Plan

> **Goal**: Turn Odyssey Mode from a *competent but uneven* glowing-tube-through-space level map into a **single, breathtaking, continuous cinematic ascent** — Earth's molten core → ocean → living surface → mountains → sky → cosmos → black-hole abstraction → neon encore — where the **path is part of each world**, every **world-to-world threshold is a designed "wow" moment**, the **rendering is world-class and consistent across all 8 chapters**, and the **whole journey breathes with the music**. The level-select screen should make people stop and stare, then want to climb.
>
> This is the Odyssey sibling of [HIMALAYAN_PEAK_AAA_PLAN.md](HIMALAYAN_PEAK_AAA_PLAN.md), [ELECTRIC_DREAMS_V3_AAA_PLAN.md](ELECTRIC_DREAMS_V3_AAA_PLAN.md), [WINTER_AAA_PLAN.md](WINTER_AAA_PLAN.md), and [NEON_DISTRICT_AAA_PLAN.md](NEON_DISTRICT_AAA_PLAN.md). It reuses their proven architecture: **thin orchestrator + GPU subsystems + one director that maps progress/audio to the entire scene**, WebGPU-first with a real WebGL fallback.

> **Status**: IN PROGRESS. **Phases 0–3 + P3b SHIPPED** (2026-06-02; P3b validation: focused Odyssey lint clean, 24 targeted Odyssey tests green, production build green). Art direction below is still a proposal; lock the per-chapter bible (§5) and transition designs (§6) with the user before Phase 4.
>
> **Phase 0 shipped** — additive spine, no visual change: `chapter-environments/shared/chapter-profile.js` (8 per-world profiles: act/palette/atmosphere/path/node/camera, grounded in today's `chapters.js` env values), `composition/OdysseyDirector.js` (conductor — blends atmosphere/camera by seam, smooths audio energy + beat pulse, records nav events), `composition/OdysseyAudioReactor.js` (wraps `soundManager.getAudioAnalysis`, degrades to zeros), `composition/odyssey-debug-overlay.js` (`?odysseyAAA=1` live HUD). Wired into `OdysseyBoardController` (`setupDirector()` + `renderFrame` update + dispose); `soundManager` now passed from `OdysseyMode`. Unit coverage in `composition/OdysseyDirector.test.js` (10 tests).
>
> **Phase 1 shipped** — cinematic post on WebGL, director-wired, gated behind `?odysseyAAA=1`: `odyssey-post/odyssey-post-fallback.js` (`OdysseyFallbackPipeline extends PostProcessingStack`) inserts an **exposure → ACES tonemap → per-chapter grade** pass after bloom, driven by `OdysseyDirector` state (`atmosphere.exposure`, `post.grade/bloom`, `atmosphere.lightColor` tint). Board chooses pipeline by flag (default = untouched `PostProcessingStack`, **byte-for-byte unchanged**). Verified via new `scripts/odyssey-aaa-board-capture.mjs` (Electron offscreen board capture): on Earth Core the ACES rolloff recovers blown-out lava detail; in Space it lifts shadows and enriches the path glow — better at both ends of the range, no crushing/washout.
>
> **Phase 2 shipped** — `OdysseyAtmosphere` as the board's single director-driven *global* atmosphere, gated behind `?odysseyAAA=1`: a graded GLSL **sky-dome** backstop (zenith=sky colour, horizon=fog colour, camera-followed), **fog == horizon** (aerial perspective) + matched clear colour, and a **shared light rig** (per-chapter director-driven key + ambient + cool fill) that *replaces* the board's former static white globals — so the key is consistent across the climb with no board-side double-lighting. Energy-reactive (ambient lifts with energy, key ticks with beats). `ChapterEnvironmentManager.updateGlobalEnvironment` gains a `setAtmosphereOwned(true)` guard: it still detects chapter changes (FOV pulse) but yields fog/clear/ambient to the atmosphere. **Per-chapter content (their own skies + local lights) left intact** — the dome is a backstop behind them; stripping per-chapter sky/lights is deferred to a later increment once the rig is validated against all 8. Board-captured: Earth Core + Space render coherently, no breakage/darkening. *Visible delta is intentionally subtle* (the director's atmosphere values match the prior global-env values by construction; the win is architectural — one director-owned source of truth + consistent key + energy reactivity that reads with music).
>
> **Phase 3 shipped** — diegetic path + node focal hierarchy, gated behind `?odysseyAAA=1`:
> - **Diegetic path** (`OdysseyPathRenderer`): the fixed orange→purple rainbow is replaced by a per-chapter colour/style driven by the chapter profiles. The shader maps `vUv.x` (arc-length along the path) → chapter via `uChapterBounds[9]` and reads `uChapterBase/Emissive[8]` + a per-style surface pattern (`stylePattern`: lavaCrust cracks / causticCurrent stripes / leyLine dashes / cairnRidge veins / jetStream streaks / stellarStream sparkle / horizonFilament lensing / neonDataLine scanlines), with a director-driven flow pulse travelling toward the head + beat reactivity. **Board-captured: the path now unmistakably belongs to each world** — Earth Core dark lava-crust, Surface green ley-line, Space violet stellar-stream, Urban brilliant cyan neon-data-line. This is the literal answer to "perfectly integrate the path with each environment."
> - **Node focal hierarchy** (`LevelNodeManager`): the instanced glow gains an `aState.z` "current" flag (+ `uBeatPulse`); the player's next-to-play node (lowest unlocked, not completed) **blazes and beat-pulses** so it's unmistakable. Default look unchanged (z=0 unless `focalHierarchy` on). Verified non-breaking (the vec2→vec3 attribute change renders cleanly).
> - Both flag-gated; zero default regression; focused Odyssey lint clean; 24 targeted Odyssey tests green.
> - **P3b shipped** — per-world node **shells** (`LevelNodeManager`): each node now carries per-instance shell metadata (`aNodeStyle`, `aNodeColor`, `aNodeAccentColor`, `aNodeSeed`) from the chapter profiles. The AAA shell shader adds distinct material/silhouette language for magma geode, bubble pearl, seed lantern, cairn lantern, cloud wisp, starlit orb, lensed shard, and neon sign, while the default non-AAA board keeps the original white glass.
>
> **⚠️ Renderer-swap deferral (important correction to the plan-as-written):** the board's content is **42 raw GLSL `ShaderMaterial`s** (path + nodes + all 8 envs). A `three/webgpu` `WebGPURenderer` renders **only TSL node materials**, so swapping the renderer now would break every board shader. The WebGPU renderer migration + the TSL `OdysseyPipeline` (MRT selective bloom / god-rays / DOF) are therefore **deferred until those materials are converted to TSL** (a coordinated later effort). P1–P3 deliver the filmic finish + unified atmosphere + diegetic path on WebGL in the meantime — which is also the permanent fallback path the plan requires.

> **North star reference**: **Tetris Effect: Connected — Journey Mode.** It is literally a block game whose levels are themed worlds that flow seamlessly into one another and pulse with the music. That is exactly what Odyssey is reaching for. Everything below is in service of that bar.

---

## 0. The Honest Critique — Where Odyssey Is Today

Odyssey already has a *strong skeleton*: a real 3D Catmull-Rom ascent spline ([odyssey-layout.js:13-42](../src/core/odyssey/data/odyssey-layout.js#L13)), eight dynamically-loaded chapter environments ([ChapterEnvironmentManager.js:24-33](../src/rendering/odyssey/ChapterEnvironmentManager.js#L24)), instanced glass level-orbs ([LevelNodeManager.js:187-440](../src/rendering/odyssey/LevelNodeManager.js#L187)), a sophisticated camera with breathing/FOV-pulse/portal-approach ([OdysseyCameraController.js](../src/rendering/odyssey/OdysseyCameraController.js)), and a real level-entry warp state machine ([OrbPortalTransitionDirector.js](../src/core/odyssey/OrbPortalTransitionDirector.js)). The bones are good. The *finish* is not yet AAA, and it is not yet **consistent**.

| Symptom | Root cause in code |
|---|---|
| **The board is the lowest-fidelity 3D surface in the whole app.** Every in-game theme is WebGPU/TSL AAA (black-hole, neon-district, winter, …) but the level map you stare at the most is plain WebGL with a basic post stack. | The board builds its **own** `THREE.WebGLRenderer` with no tone-mapping / color-management config ([OdysseyBoardController.js:521-549](../src/rendering/odyssey/OdysseyBoardController.js#L521)). Post = `EffectComposer` → `UnrealBloom` + a hand-rolled CA/vignette/grain `ShaderPass` chain ([PostProcessingStack.js:288-334](../src/rendering/odyssey/effects/PostProcessingStack.js#L288)). No ACES, no HDR/linear pipeline, no god-rays, no DOF, no selective bloom. |
| **Chapter quality is wildly uneven — immersion breaks mid-journey.** | earth-core (1268 lines, ~45 shader/material constructs) and surface-world (1557 lines) are rich; **cosmic-expanse renders its black hole as a flat billboard plane** ([cosmic-expanse.js:251-265](../src/rendering/odyssey/chapter-environments/cosmic-expanse.js#L251)), **urban-dreams is 199 lines** and **black-hole-transcendence is 225 lines** of `SphereGeometry` + `PointsMaterial`. You ascend from a detailed volcano into a cardboard cut-out cosmos. |
| **The path doesn't belong to any world.** It's the same three nested tubes (outer/core/glow) with a fixed orange→purple rainbow gradient running through lava, ocean, forest, and the void identically. | One `OdysseyPathRenderer` builds 3 `TubeGeometry` meshes with hard-coded `uColorStart=0xff6600`/`uColorEnd=0x6600ff` ([OdysseyPathRenderer.js:54-202](../src/rendering/odyssey/OdysseyPathRenderer.js#L54)). It never adopts the chapter's material language (lava crust, caustic current, ley-line, accretion stream). |
| **Level nodes are generic regardless of world.** A glass marble in the magma reads the same as a glass marble in the nebula. | One `createGlassNode` for all 55 ([LevelNodeManager.js:451-505](../src/rendering/odyssey/LevelNodeManager.js#L451)); only the rim/glow *tint* changes by chapter ([:743-758](../src/rendering/odyssey/LevelNodeManager.js#L743)). |
| **Chapter "transitions" are a cross-fade, not a moment.** | Scrolling across a seam = opacity blend of two groups ([ChapterEnvironmentManager.js:449-490](../src/rendering/odyssey/ChapterEnvironmentManager.js#L449)) + a color lerp of sky/fog/ambient ([:626-715](../src/rendering/odyssey/ChapterEnvironmentManager.js#L626)) + a path color band + an FOV pulse. The narrative beats *exist as text* ("Light spills down from above…the sea lifts you toward land") ([chapters.js:79](../src/core/odyssey/data/chapters.js#L79)) but nothing dramatizes breaching the ocean surface or punching through the cloud deck. |
| **Zero audio-visual synergy, despite an audio engine that's right there.** | All 8 chapters set `music.track: 'Ambient'` — *the same placeholder* ([chapters.js:38,73,111,…](../src/core/odyssey/data/chapters.js#L38)). The board never touches [`AudioAnalyzer`](../src/audio/audio-analyzer.js) (which already gives smoothed bass/mid/treble energy + beat detection and is consumed by themes like electric-dreams-v3). Nothing on the board pulses, swells, or flows with sound. |
| **Uniform camera language — every world feels the same distance away.** | One `followOffset = (0,-1,18)`, one breathing profile, one FOV for all chapters ([OdysseyCameraController.js:80-128](../src/rendering/odyssey/OdysseyCameraController.js#L80)). The claustrophobic core and the infinite void are framed identically. |
| **Per-chapter duplication instead of one coherent world.** | Each environment ships its *own* ambient/point/directional lights, its own starfield, its own fog intent ([cosmic-expanse.js:331-344](../src/rendering/odyssey/chapter-environments/cosmic-expanse.js#L331)), on top of the board's global lights ([OdysseyBoardController.js:585-600](../src/rendering/odyssey/OdysseyBoardController.js#L585)) and global starfield ([:624-670](../src/rendering/odyssey/OdysseyBoardController.js#L624)). Nothing arbitrates a single consistent key-light/exposure across the ascent. |

**Thesis:** Odyssey doesn't need a rewrite — it needs a **finish pass + a unifying spine**. We keep the spline, the orb instancing, the camera rig, and the warp state machine. We add (1) a **WebGPU rendering core** with one consistent cinematic post stack, (2) a **single director** that owns atmosphere/light/audio across the whole ascent, (3) **diegetic path + node identities** per world, (4) **designed threshold transitions**, and (5) we **level up the four placeholder chapters** to match the two strong ones.

---

## 1. TL;DR — The Five Pillars

| # | Pillar | What it replaces | Why it transforms Odyssey |
|---|---|---|---|
| **1** | **WebGPU rendering core + one cinematic post pipeline** (TSL `PostProcessing`: MRT selective bloom, god-rays, DOF, ACES, per-chapter grade, lens flare, refined grain) with a real WebGL fallback | The board's bespoke WebGLRenderer + `UnrealBloom`/CA/vignette `ShaderPass` chain | Brings the **most-looked-at screen** up to the same bar as the in-game themes, and unifies the look so all 8 chapters share one exposure/tonemap/grade language. This is the single biggest visual jump. |
| **2** | **`OdysseyDirector`** — one conductor mapping *journey progress + audio energy + game events* → atmosphere, light, path, nodes, camera, post | Per-chapter duplicated lights/fog/stars; static FOV; no audio | The "spine." Every subsystem reads one source of truth, so the ascent feels *authored* and *alive*, not assembled. Mirrors `StormDirector`/`AltitudeDirector`/`fxState`. |
| **3** | **Diegetic path & per-world level-node identity** — the path *becomes* each world (lava-crust river → luminous current → forest ley-line → ridge cairn-line → jet-stream ribbon → stellar stream → event-horizon filament → neon data-line); orbs adopt each world's material | One rainbow triple-tube; one glass marble for all 55 | Makes progression feel **deliberate and integrated** instead of "a glowing pipe floating in front of a backdrop." This is the literal answer to "perfectly integrate the level paths with each environment." |
| **4** | **Threshold Transition Director** — each of the 7 boundaries is a staged, high-impact *breach* (surface, cloud-deck, atmosphere-edge, event-horizon, …) | An opacity crossfade + color lerp | The "wow moment" between worlds. The narrative outros finally *happen on screen*. |
| **5** | **Audio-visual synergy layer** — board subscribes to `AudioAnalyzer`; per-chapter signature tracks + transition stingers; path/nodes/atmosphere pulse and flow to bass/beat | Identical `'Ambient'` placeholder; silent visuals | Turns the map into a **Tetris-Effect-grade audio-reactive instrument**. The journey *grooves*. |

These compound: a consistent world-class finish (1), driven by one living spine (2), where the path and nodes belong to each world (3), the worlds breach into each other cinematically (4), all of it breathing to music (5).

---

## 2. Industry Best-Practice Research (genre: cinematic overworld / rhythm map)

What world-class progression maps and audio-visual games do, and the concrete lesson for Odyssey:

| Reference | Technique | Apply to Odyssey |
|---|---|---|
| **Tetris Effect: Connected — Journey Mode** (the direct analogue) | Each level is a themed world; particles, terrain, and lighting **pulse and flow with the music**; zones **dissolve seamlessly** into the next; a constellation/ribbon connects the journey. | The whole plan's north star: per-chapter signature audio (§5), beat-reactive path/nodes/atmosphere (Pillar 5), seamless threshold breaches (§6). |
| **Journey (thatgamecompany)** | **Establishing vista beats** (the held reveal of the mountain); **aerial perspective** for vastness; **light as the goal**; near-zero UI. | Add a **chapter-arrival vista beat** (camera pulls back, holds the new world, title card) before settling into follow. Drive depth with fog/aerial-perspective tied to the director. |
| **Ori / Gris** | The traversal path is **diegetic** (spirit trails, ascending color); **color/light is progress**; painterly parallax depth. | Diegetic path per world (Pillar 3); the ascent **warms/cools and saturates** with progress and combo (director grade). |
| **Super Mario Galaxy / Sky: Children of the Light — overworld** | Nodes sit **in** the world geometry, not floating on a HUD plane; the map is a **place** with weather and life; selected node has unmistakable focal pop. | Node redesign reads focal hierarchy (current = blazing, completed = settled, locked = dormant) and seats orbs into world materials. |
| **God of War (2018) — "one-shot" camera** | No hard cuts; the camera **flows continuously** through space and transitions; motion communicates geography. | Keep the continuous-spline camera; make transitions *camera-led breaches* (a move + FOV + roll), never a fade-to-black. |
| **Ratchet & Clank: Rift Apart — rift jumps** | Instant world swaps sold as a **rip/portal** with a burst, suction, and arrival pop. | The level-entry orb-portal (already a state machine) gets the AAA finish; chapter breaches borrow its suction/arrival language at lower intensity. |
| **Destiny / Horizon skyboxes** | **Hero celestial/landmark anchors** (a planet, a peak, a megastructure) give each zone an unmistakable silhouette and a sense of scale. | Each chapter gets **one hero anchor** (the magma vault, the leviathan light shaft, the hero summit, the accretion disk, the city spire) — see §5. |
| **Cinematic real-time post (ACES, bloom, DOF, god-rays, grain)** | A consistent filmic pipeline is what reads as "AAA" vs "tech demo." | Pillar 1 — one TSL post stack across the whole board, per-chapter grade only as a *parameter*, not a new pipeline. |

**Genre principles distilled:** (a) the path is part of the world; (b) depth is sold by atmosphere; (c) light/color *is* the emotional arc; (d) transitions are continuous and camera-led; (e) one hero anchor per world for scale and silhouette; (f) the soundtrack drives the visuals, not the reverse; (g) one consistent filmic finish unifies everything.

---

## 3. The Cinematic Vision

### 3.1 One continuous ascent, four acts

Odyssey is **one unbroken vertical journey** from `y=-30` (the core) to `y=960` (transcendence), already authored as a single spline. We treat it as a film in four acts, governed by one scalar **`ascentProgress ∈ [0,1]`** (= camera path position) and one reactive scalar **`energy ∈ [0,1]`** (smoothed audio + recent game events):

| Act | Chapters | Mood | Light / Air | Camera language |
|---|---|---|---|---|
| **I — Origin** | 1 Earth Core, 2 Deep Ocean | Pressure → release; warm dark → cool depth | Tight volumetric fog, low warm key, caustic cool fill | **Close & enclosed** — short follow distance, low ceiling, gentle claustrophobic roll |
| **II — Living World** | 3 Surface, 4 Mountains | Daylight, life, ascent, thinning air | Sky-dome scattering, high warm sun, aerial haze on far ridges | **Open & grounded** — medium distance, horizon visible, steadier |
| **III — Beyond** | 5 Sky, 6 Space | Drift → vastness | Atmosphere edge → starfield, exposure opens up | **Vast & slow** — long distance, wide FOV, languid drift |
| **IV — Transcendence** | 7 Black Hole, 8 Urban encore | Abstraction → electric coda | Lensing dark → neon | **Abstract → kinetic** — distortion, then snappy neon energy |

The light, fog color, exposure, and camera distance **ease continuously** along `ascentProgress` so the whole climb feels like *one moving time-of-day*, not eight stitched scenes. `energy` layers a faster pulse on top (bloom swell, path brightening, node shimmer, subtle dolly) so the map **grooves with the music**.

### 3.2 Compositional depth (shared layer stack, every chapter)

```
LAYER 0 — SKY / VOID DOME            one shared dome material, per-chapter palette + features
LAYER 1 — HERO ANCHOR                the one landmark that gives the chapter scale (§5)
LAYER 2 — MID ENVIRONMENT            ridges / reefs / city / accretion — the body of the world
LAYER 3 — ATMOSPHERE VOLUME          fog + god-rays + aerial perspective (depth is felt)
LAYER 4 — THE PATH                   diegetic, made of this world's material (Pillar 3)
LAYER 5 — LEVEL NODES                seated into the path, world-flavored, focal hierarchy
LAYER 6 — NEAR PARTICLES / LIFE      embers / bubbles / pollen / snow / debris / sparks
LAYER 7 — POST                       ACES + bloom + god-rays + DOF + grade + grain (Pillar 1)
```

Every chapter fills the **same** slots so the journey is coherent and the director can drive all of them through one interface — but the *content* of each slot is unmistakably that world (§5).

---

## 4. Target Architecture

Keep the working spine; add a rendering core, a director, and per-world content interfaces. New/changed module layout under `src/rendering/odyssey/`:

```
OdysseyBoardController.js        (KEEP as orchestrator; swap renderer init + post + add director)
composition/
  OdysseyDirector.js             (NEW — the conductor; §4.2)
  OdysseyAtmosphere.js           (NEW — one shared sky-dome + fog + light rig; §4.3)
  OdysseyAudioReactor.js         (NEW — wraps AudioAnalyzer → board signals; §4.7)
rendering/
  OdysseyPathRenderer.js         (UPGRADE — diegetic, per-chapter material profiles; §4.4)
  LevelNodeManager.js            (UPGRADE — per-world node identity + focal hierarchy; §4.5)
  odyssey-post/
    OdysseyPipeline.js           (NEW — TSL PostProcessing stack, WebGPU; §4.1)
    odyssey-post-fallback.js     (NEW — EffectComposer fallback, reuses today's stack; §4.1)
transitions/
  ChapterThresholdDirector.js    (NEW — the 7 breach moments; §4.6)
chapter-environments/
  shared/
    odyssey-noise.js             (NEW — shared TSL/GLSL fbm/curl/ridged helpers)
    chapter-profile.js           (NEW — per-chapter param schema: palette, anchor, path style, audio)
  earth-core.js  …  urban-dreams.js   (REFACTOR all 8 to the shared profile + level up the thin 4)
```

`OdysseyMode.js` is largely untouched (it owns flow/level-entry); it gains a few hooks to feed game events and the active track to the new director.

### 4.1 Rendering Core — WebGPU pipeline + WebGL fallback (Pillar 1)

**Decision:** migrate the board to the same WebGPU/TSL pattern as the hero themes, with a true WebGL fallback so nothing regresses on machines/contexts without WebGPU.

- **Renderer:** in `initRenderer()` ([OdysseyBoardController.js:521](../src/rendering/odyssey/OdysseyBoardController.js#L521)), prefer `import * as THREE from 'three/webgpu'`, `new THREE.WebGPURenderer({ antialias, alpha })`, `await renderer.init()`, detect `renderer.backend?.isWebGPUBackend`. Set `renderer.toneMapping = THREE.NoToneMapping` (we tonemap in post, manual ACES — see the intro/winter precedent) and correct `outputColorSpace`. If WebGPU init fails or is unavailable, fall back to today's `WebGLRenderer`.
- **Post (WebGPU):** `OdysseyPipeline.js` builds a TSL `THREE.PostProcessing` graph: **MRT selective bloom** (emissive-tagged path/nodes/anchors bloom, the rest doesn't — fixes today's blown-out full-screen bloom), **god-rays** from the chapter's key light/anchor, **bokeh DOF** (focus on the current node), **manual ACES** tonemap, a **per-chapter color grade** (one `gradeLut`/`gradeParams` uniform driven by the director, *not* a new pass per chapter), **lens flare** on the hero anchor, and a **refined animated grain** (keep the signature, move it into the graph). All strengths are director-driven uniforms.
- **Post (WebGL fallback):** `odyssey-post-fallback.js` keeps today's `EffectComposer` chain ([PostProcessingStack.js](../src/rendering/odyssey/effects/PostProcessingStack.js)) but adds an ACES `ShaderPass` + a grade `ShaderPass` so the *look* matches at lower cost. The existing chapter-seam FX-boost API ([:401-415](../src/rendering/odyssey/effects/PostProcessingStack.js#L401)) is preserved on both paths.
- **MRT requirement:** every board material that should bloom must set an `emissiveNode` (per the project's MRT gotcha). The atmosphere/mid-environment must *not*, or they wash out. This is the discipline that makes selective bloom read as AAA.

> ⚠️ **Validation reality (from project memory):** this WSL/Electron box cannot validate WebGPU. WebGPU visuals must be verified by the user on Windows Chrome; never claim WebGPU verification from this environment. The WebGL fallback *can* be verified locally and must always be shippable on its own.

### 4.2 `OdysseyDirector` — the conductor (Pillar 2)

One class, updated once per frame from `OdysseyBoardController.renderFrame()` ([:1026](../src/rendering/odyssey/OdysseyBoardController.js#L1026)), owning the journey's continuous state and broadcasting it to every subsystem.

Inputs: `ascentProgress` (camera position), `blendState` (from [`resolveChapterBlendState`](../src/rendering/odyssey/ChapterEnvironmentManager.js#L133)), `energy`/`beat` (from `OdysseyAudioReactor`), and discrete events (`onChapterEnter`, `onNodeFocus`, `onLevelSelect`, `onBoundaryCross`).

Outputs (smoothed, allocation-free): the blended **atmosphere params** (sky/fog/ambient — moves the logic out of [`updateGlobalEnvironment`](../src/rendering/odyssey/ChapterEnvironmentManager.js#L626) into the director so light is centralized), the **key-light direction/color/intensity**, **exposure**, **post params** (bloom/grade/DOF/god-ray strength), **path emphasis** (head glow, flow speed, beat pulse), **node emphasis** (focal pulse), and a **camera profile** (distance/FOV/breathing) handed to the camera controller.

This replaces scattered per-chapter lights and the static camera config with one authored, audio-reactive arc. It's the difference between "8 scenes" and "one film."

### 4.3 `OdysseyAtmosphere` — one shared sky + fog + light rig (Pillar 1/2)

A single sky-dome mesh (TSL node material, GLSL fallback) + the scene fog + **one** key/fill/rim light set, all driven by the director's blended params. Per-chapter *features* (a sun disc, caustics, a star field density, aurora, lensing) are toggled/parameterized via `chapter-profile.js`, not by spawning new lights and domes in each environment. This:
- removes the per-chapter ambient/point/directional duplication (e.g. [cosmic-expanse.js:331-344](../src/rendering/odyssey/chapter-environments/cosmic-expanse.js#L331));
- guarantees `fog color == sky horizon` (true aerial perspective, the depth cue the worlds lack);
- gives the whole ascent one consistent exposure/key-light so crossing a seam changes *content*, not *render rules*.

Chapter environment modules keep ownership of **Layer 1–2 + Layer 6** (hero anchor, mid environment, near life) and stop owning sky/fog/lights.

### 4.4 Diegetic Path System (Pillar 3)

Generalize `OdysseyPathRenderer` so the tube's **material is a per-chapter profile** rather than a fixed rainbow. Same `TubeGeometry` + progress/transition uniforms it already has ([OdysseyPathRenderer.js:54-202](../src/rendering/odyssey/OdysseyPathRenderer.js#L54)), but:
- the path is segmented by `chapterPositions`, and each segment samples its chapter's `pathProfile` from `chapter-profile.js`: `{ baseColor, emissiveColor, materialStyle, flowSpeed, widthScale, features[] }`;
- `materialStyle` ∈ `lavaCrust | causticCurrent | leyLine | cairnRidge | jetStream | stellarStream | horizonFilament | neonDataLine` — each a small TSL/GLSL variant (cracked-glowing crust, refractive caustic flow, dotted living trail, stone-with-light-veins, wind-streaked ribbon, particle river, lensed filament, scanline data-line);
- **flow** runs *toward* the player's current target (energy- and beat-reactive head pulse using the audio reactor) so the path reads as *current*, not decoration;
- transition bands at seams (already supported via `uTransition*`) become the breach handoff (§6);
- emissive on the path feeds MRT bloom (§4.1).

The path now visibly **threads through** each world — a lava river in the core, a luminous current in the ocean, a ley-line across the meadow, a stellar stream in space — which is the core of "perfectly integrate the path with each environment."

### 4.5 Level-Node Identity & Focal Hierarchy (Pillar 3)

Keep the instanced architecture and 7040-particle system ([LevelNodeManager.js:187-440](../src/rendering/odyssey/LevelNodeManager.js#L187)) — it's performant — but:
- add a **per-chapter node profile** (shell material, particle look, idle motion): magma geode, bubble/pearl, seed-pod/leaf-lantern, ice-crystal/cairn-lantern, cloud-wisp lantern, starlit orb, lensed shard, neon sign. The inner theme-icon sphere stays (great touch), the *shell* changes per world.
- **Focal hierarchy** the genre demands, driven by director state: **current/next** node = blazing, haloed, beat-pulsing, slightly scaled; **completed** = settled, calm, warm, stars seated; **locked** = dormant, desaturated, dim (today's locked styling is close — extend it). The node you can play must be unmistakable at a glance.
- seat the orb *into* the path (anchor it on the tube, add a small base/socket of the path material) so it reads as "a station on the route," not a marble hovering nearby.

### 4.6 Chapter Threshold Director — the 7 "wow" moments (Pillar 4)

New `ChapterThresholdDirector` listens for boundary crossings (already detected: [`getCrossedBoundaryIds`](../src/rendering/odyssey/OdysseyCameraController.js#L1156), seam beats, [`_handleChapterSeam`](../src/rendering/odyssey/OdysseyBoardController.js#L1234)). At each of the 7 seams it sequences a short, **camera-led, never-cut** breach using existing levers (camera seam-beat/FOV-pulse, path transition band, post FX boost, atmosphere blend) plus a per-boundary signature effect. The narrative outros ([chapters.js](../src/core/odyssey/data/chapters.js)) finally play on screen. Full per-boundary designs in §6.

### 4.7 Audio-Visual Synergy (Pillar 5)

`OdysseyAudioReactor` wraps the existing [`AudioAnalyzer`](../src/audio/audio-analyzer.js) (smoothed bass/mid/treble + beat detection, already used by themes) bound to the board's active music element, exposing `{ energy, bass, beat, sinceBeat }` to the director. Then:
- **Per-chapter signature tracks + transition stingers.** Replace the eight identical `'Ambient'` entries ([chapters.js:38…321](../src/core/odyssey/data/chapters.js#L38)) with per-chapter tracks via [music-manifest.js](../src/audio/music-manifest.js), plus a short stinger at each breach. Keep the existing `crossfadeDuration` per chapter.
- **Reactive visuals:** bass → path head-glow + atmosphere fog density breath; beat → node focal pulse + subtle star twinkle + a gentle bloom tick; sustained energy → exposure/grade warming + camera drift speed. All clamped and eased so it *grooves* without strobing.
- **Transition cues already exist** (`orbCharge`, `breach`, `warpRush`, `arrivalHit` in [OrbPortalTransitionDirector.js](../src/core/odyssey/OrbPortalTransitionDirector.js)) — extend the cue map with chapter-breach stingers.

This is what elevates Odyssey from "pretty map" to "Tetris-Effect-grade instrument."

---

## 5. Per-Chapter Art Direction Bible

For each chapter: the **hero anchor** (Layer 1), the **path style**, the **node identity**, and the **upgrade priority** (the four thin chapters are 🔴 *level-up required*, the two rich ones are 🟢 *refit to shared spine*).

| Ch | World | Hero anchor (Layer 1) | Mid environment (Layer 2) | Path style | Node identity | Key light / palette | Priority |
|----|-------|----------------------|---------------------------|------------|---------------|---------------------|----------|
| **1** | Earth Core | A vast **magma vault / glowing fissure** overhead, light leaking down | Volcanic rock clusters, lava floor, ember fields (already strong) | **lavaCrust** — cracked obsidian with molten glow in the seams | Magma geode orbs | Low warm key from below, deep red-black, tight fog | 🟢 refit |
| **2** | Deep Ocean | A **leviathan light shaft / sunken cathedral** with god-rays from the surface far above | Kelp, coral, drifting particulate, caustics | **causticCurrent** — refractive flowing current, cool bioluminescent | Bubble/pearl orbs | Cool blue key from above, caustic dapple, soft fog | 🟢 refit |
| **3** | Surface World | The **sun + a distant mountain range** rising at the chapter's end (foreshadows Ch4) | Hills, grass, clouds, petals, butterflies (already rich) | **leyLine** — dotted living trail through grass, warm green-gold | Seed-pod / leaf-lantern orbs | High warm sun, sky-dome scatter, aerial haze | 🟢 refit |
| **4** | Mountains | The **hero summit** with alpenglow + snow-plume (can borrow Himalayan AAA work) | Ridge ranges fading into haze, snowfields | **cairnRidge** — stone path with glowing veins + cairn markers | Ice-crystal / cairn-lantern orbs | Low raking sun → alpenglow, cool→rose, thin air | 🔴 level-up |
| **5** | Sky & Drift | A **break in the cloud deck** revealing sky above + a low sun; aurora ribbon | Layered cloud decks, rain veils, drifting vapor | **jetStream** — wind-streaked luminous ribbon | Cloud-wisp lantern orbs | Soft high sun, pastel→aurora, open exposure | 🔴 level-up |
| **6** | Space | A **hero planet/nebula + distant accretion glow** (foreshadows Ch7) | Dense starfield, nebula volumes, debris | **stellarStream** — particle river of light | Starlit orbs with constellation rims | Rim-only starlight, deep indigo, wide-open exposure | 🔴 level-up (currently flat-plane black hole) |
| **7** | Black Hole | The **accretion disk + lensed event horizon** as the dominant anchor | Gravitational-lens distortion field, infalling matter | **horizonFilament** — lensed, stretching filament | Lensed-shard orbs | No key, accretion glow only, lensing post | 🔴 level-up |
| **8** | Urban Encore | A **neon megastructure / city spire** with sign-glow | Building silhouettes, lit windows, wet reflections | **neonDataLine** — scanline data-conduit | Neon-sign orbs | Magenta/cyan neon key, electric grade | 🔴 level-up (currently 199 lines) |

Each chapter writes one `chapter-profile.js` entry: `{ palette, anchor, pathStyle, nodeStyle, audioTrack, atmosphere: { fogColor, skyFeatures, lightDir, exposure }, transitionOut }`. The director and all subsystems read from it — **one source of truth per world.**

---

## 6. Chapter Transition Designs — the 7 Breaches (Pillar 4)

Each is a 0.8–1.4s camera-led beat at the seam (durations already authored per chapter in [`boardTransition`](../src/core/odyssey/data/chapters.js#L8)). All reuse: camera seam-beat/FOV-pulse ([OdysseyCameraController.js:740](../src/rendering/odyssey/OdysseyCameraController.js#L740)), path transition band, post FX boost ([PostProcessingStack.js:401](../src/rendering/odyssey/effects/PostProcessingStack.js#L401)), atmosphere blend, + a per-seam signature + a music stinger.

| Seam | Narrative beat (exists as text today) | The breach moment |
|------|---------------------------------------|-------------------|
| **1→2** Core→Ocean | "You emerge from molten depths… vast liquid worlds waiting" | Camera rises through a **steam/quench veil**; lava glow gives way to a **falling-into-water shimmer**; fog flips warm→cool; a bubble burst stinger. |
| **2→3** Ocean→Surface | "Light spills down from above… toward land, color, seasons" | **Breach the surface** — a bright caustic bloom flare as the camera pierces the waterline; god-rays invert to open sky; spray particles; warm sun stinger. |
| **3→4** Surface→Mountains | "The earth begins to rise… a climb toward colder air" | Camera **tilts up to the rising ridgeline**; aerial haze thickens; palette cools; wind rises; a low horn stinger. |
| **4→5** Mountains→Sky | "Stone gives way to light… outward into sky" | Camera **lifts off the summit into open air**; ground drops away; cloud deck parts; exposure opens; airy stinger. |
| **5→6** Sky→Space | "The last breath of atmosphere fades… pure distance, cold logic of space" | **Punch through the atmosphere edge** — a thin blue rim flares and falls behind; stars resolve from black; fog → vacuum; deep swell stinger. |
| **6→7** Space→Black Hole | "A darkness grows ahead… the event horizon awaits" | The accretion disk **looms and the lensing engages** — subtle screen-space distortion ramps via post; path stretches; low sub-bass stinger. |
| **7→8** Black Hole→Urban | "Beyond the singularity… the pulse of these electric nights" | **Whiteout → neon snap** — a brief bloom whiteout resolves into a neon cityscape; grade flips electric; a synth-stab stinger. (Encore = highest contrast.) |

Design rule (from the God-of-War one-shot principle): **never fade to black.** Every breach is a continuous camera move + a physical phenomenon you pass *through*. The board-snapshot/compositor machinery from level-entry ([OrbPortalCompositor](../src/rendering/transitions)) can supply a frozen underlay if a heavier breach (5→6, 7→8) needs it.

---

## 7. Performance Budget & Strategy

Target: **60 fps** at High on a mid-range discrete GPU; graceful down to **Low** on integrated. The board is interactive (scroll/hover), so frame consistency matters more than peak fidelity.

- **One atmosphere, not eight.** Folding per-chapter lights/sky/stars into `OdysseyAtmosphere` removes duplicate lights and dome draws — a net *reduction* vs today even before fidelity gains.
- **Keep instancing.** Nodes (4 instanced meshes + 1 instanced particle system) and the proximity culling (`UPDATE_PROXIMITY_THRESHOLD`, [LevelNodeManager.js:1017-1035](../src/rendering/odyssey/LevelNodeManager.js#L1017)) stay. Extend the same culling to chapter mid-environment detail (only the active ± neighbor chapters run full update; today they're all eagerly *loaded* — keep that, but *update* only the visible ones, which the env manager already gates by `group.visible` [:603-607](../src/rendering/odyssey/ChapterEnvironmentManager.js#L603)).
- **Selective MRT bloom** is cheaper and cleaner than today's full-screen `UnrealBloom`. DOF/god-rays are the new costs — gate them by quality preset (off at Low/Minimal, matching the existing [`QUALITY_PRESETS`](../src/rendering/odyssey/OdysseyBoardController.js#L38) ladder).
- **Quality ladder maps to subsystems**, not just bloom strength: particle counts, god-ray samples, DOF on/off, grain on/off, audio-reactivity richness, env detail LOD — all read from the preset. Reuse `getEffectivePixelRatio()`/`computeScenePixelRatio` already in play.
- **Audio reactor** is one analyser, ~one `getByteFrequencyData` per frame — negligible (themes already run it in-game).
- **Transitions** are short and reuse existing render targets/compositor; the breach signature effects must not allocate per-frame (pre-build geometry/uniforms).
- **Shader prewarm** already exists ([`_prewarmChapterEnvironment`](../src/rendering/odyssey/OdysseyBoardController.js#L482)) — extend it to the new path/node profile variants so first-cross of a seam doesn't hitch.

Per-frame allocation discipline (scratch vectors/colors) is already the codebase norm ([ChapterEnvironmentManager.js:253-258](../src/rendering/odyssey/ChapterEnvironmentManager.js#L253)) — hold the line in all new modules.

---

## 8. Phased Implementation Roadmap

Each phase is independently shippable and verifiable (WebGL path locally; WebGPU by the user on Windows Chrome). Ship behind a `?odysseyAAA=1` flag until P1–P3 land, then default on.

| Phase | Scope | Key files | Acceptance |
|-------|-------|-----------|------------|
| **P0 — Spine scaffolding** ✅ **SHIPPED** | `OdysseyDirector`, `chapter-profile.js` schema, `OdysseyAudioReactor` (read-only, no visual change yet), debug overlay `?odysseyAAA=1`. Wire director into `renderFrame` additively. | new `composition/*`, `chapter-environments/shared/chapter-profile.js` | ✅ Build + lint clean; overlay shows live `ascentProgress`/`energy`/`blendState`; **zero visual regression**; 21 tests green. |
| **P1 — Rendering core** ✅ **WebGL half SHIPPED** (WebGPU deferred — see status note) | WebGL pipeline (`odyssey-post-fallback` = today's stack + exposure→ACES→director-grade) **done & verified**. WebGPU renderer init + TSL `OdysseyPipeline` (MRT selective bloom/god-rays/DOF) **deferred to post-TSL-conversion** (P2–P4) because board content is 42 GLSL `ShaderMaterial`s. | `OdysseyBoardController.setupPostProcessing`, `rendering/odyssey-post/odyssey-post-fallback.js`, `scripts/odyssey-aaa-board-capture.mjs` | ✅ Board renders better on WebGL behind `?odysseyAAA=1`; highlights tamed (not blown out); default path unchanged. WebGPU path pending material conversion. |
| **P2 — Unified atmosphere** ✅ **global rig SHIPPED** (per-chapter strip deferred) | `OdysseyAtmosphere` = director-driven shared dome + fog + light rig **done**, replacing the board's static globals. Stripping per-chapter sky/lights from the 8 env files deferred (high regression risk; do once rig validated). `fog==sky horizon` ✓. | `composition/OdysseyAtmosphere.js`, `ChapterEnvironmentManager.setAtmosphereOwned`, `OdysseyBoardController` (skip board globals when AAA) | ✅ One consistent director-driven key across the climb; aerial perspective via fog==horizon; no board-side double-lighting; no regression (flag-gated). Per-chapter light/sky unification pending. |
| **P3 — Diegetic path + node identity** ✅ **SHIPPED** (P3b shells included) | Per-chapter path colour/style + director flow ✓; node focal hierarchy (current node blazes/beat-pulses) ✓; per-world node shells ✓ via per-instance style/accent/seed metadata. | `OdysseyPathRenderer.js`, `LevelNodeManager.js`, `chapter-profile.js` | ✅ Path unmistakably belongs to each world (captured: lava-crust/ley-line/stellar/neon); current node emphasised; shells read as magma geode/bubble/seed/cairn/cloud/star/lensed/neon; flag-gated, no regression. |
| **P4 — Level up the 4 thin chapters** | Rebuild Ch6 (real volumetric black hole, not flat plane), Ch7 (lensing + accretion), Ch5 (cloud decks + aurora), Ch8 (neon city). Hero anchors per §5. | `cosmic-expanse.js`, `black-hole-transcendence.js`, `sky-drift.js`, `urban-dreams.js` | All 8 chapters read at one quality bar; no cardboard cut-outs. |
| **P5 — Threshold transitions** | `ChapterThresholdDirector` + the 7 breach designs (§6); narrative outros play on screen; camera-led, never-cut. | new `transitions/ChapterThresholdDirector.js`, hooks in `OdysseyBoardController._handleChapterSeam` | Each seam is a distinct "wow" moment; continuous camera; no fades-to-black. |
| **P6 — Audio-visual synergy** | Per-chapter signature tracks + breach stingers ([chapters.js](../src/core/odyssey/data/chapters.js), [music-manifest.js](../src/audio/music-manifest.js)); reactive path/node/atmosphere/camera. | `chapters.js`, `OdysseyAudioReactor`, director | Map grooves with music; beat/bass legible in visuals; no strobing; clamped. |
| **P7 — Camera language + vista beats + polish** | Per-act camera profiles (close→vast→kinetic); chapter-arrival vista beat + title card; final grade/exposure tuning per chapter; preset calibration. | `OdysseyCameraController` (profile param), `OdysseyDirector`, `LevelSelectUI` title card | Each act feels distinct; arrivals land as moments; locked 60fps at High. |

**Critical path:** P0 → P1 → P2 → P3 are the foundation (everything else reads from them). P4 can run in parallel with P5 once profiles exist. P6/P7 are the finish.

---

## 9. Risks & Gotchas

- **WebGPU cannot be validated on this box** (WSL/Electron, per project memory). Always keep the WebGL fallback fully shippable; gate user-verified WebGPU claims to Windows Chrome screenshots in `docs/validation/odyssey/`.
- **MRT discipline:** with selective bloom, *every* bloom-eligible material needs an `emissiveNode`; atmosphere/mid-env must not, or the frame washes out (the documented neon-district/sky-children failure mode). Audit on each new material.
- **TSL `.assign()` in plain-JS helpers throws/silently drops** ("No stack defined") — build fresh const+`.add()` chains in struct-returning shade helpers (the himalayan ridge-terrain pattern). Applies to any new TSL path/node/anchor materials.
- **Don't break level entry.** The orb-portal state machine and compositor ([OrbPortalTransitionDirector.js](../src/core/odyssey/OrbPortalTransitionDirector.js)) are load-bearing and well-tested; the chapter-threshold work *borrows* its language but must not destabilize it. Keep [odyssey-path-layout.test.js](../src/rendering/odyssey/odyssey-path-layout.test.js) and theme-icon-resolver tests green.
- **Editor mode** (`OdysseyLayoutEditor`, 2266 lines) consumes the path/curve; any path API change must keep its hooks working.
- **Eager load cost.** All 8 environments load at init today ([OdysseyBoardController.js:300-307](../src/rendering/odyssey/OdysseyBoardController.js#L300)). Leveling up the thin chapters increases that budget — keep the staged `_yieldToMain` loading and background prewarm; consider deferring the heaviest new anchors (Ch6/7) to background load.
- **Don't regress the loading smoothness.** The init carefully yields to keep the overlay animating; new heavy GPU work (compile, MRT targets) must respect those yields.
- **Audio autoplay/availability.** The reactor must degrade gracefully when no track is playing (analyser returns zeros — already handled in `AudioAnalyzer.update`); visuals must look right with `energy=0`.

---

## 10. Component Upgrade Checklist (every piece touched)

**New modules**
- [x] `composition/OdysseyDirector.js` — the conductor (§4.2) — **P0**
- [x] `composition/OdysseyAtmosphere.js` — shared sky-dome/fog/light rig (§4.3) — **P2** (global rig; per-chapter strip deferred)
- [x] `composition/OdysseyAudioReactor.js` — `AudioAnalyzer` → board signals (§4.7) — **P0**
- [x] `composition/odyssey-debug-overlay.js` — `?odysseyAAA=1` live HUD — **P0**
- [ ] `rendering/odyssey-post/OdysseyPipeline.js` — TSL WebGPU post (§4.1) — **deferred to post-TSL-conversion (P2–P4)**
- [x] `rendering/odyssey-post/odyssey-post-fallback.js` — WebGL post: exposure→ACES→grade (§4.1) — **P1**
- [x] `scripts/odyssey-aaa-board-capture.mjs` — offscreen board screenshot harness — **P1**
- [ ] `transitions/ChapterThresholdDirector.js` — the 7 breaches (§6)
- [x] `chapter-environments/shared/chapter-profile.js` — per-world params (§5) — **P0**
- [ ] `chapter-environments/shared/odyssey-noise.js` — shared fbm/curl/ridged

**Upgraded modules**
- [~] `OdysseyBoardController.js` — director hookup + render-loop update **(P0)**; flag-gated AAA post pipeline wiring **(P1)**; WebGPU renderer init (deferred)
- [x] `effects/PostProcessingStack.js` — exported CA/vignette/grain shaders for reuse; extended by `OdysseyFallbackPipeline` **(P1)**
- [x] `OdysseyPathRenderer.js` — diegetic per-chapter path materials + flow (§4.4) — **P3**
- [x] `LevelNodeManager.js` — focal hierarchy (current node blazes/pulses) **(P3)**; per-world shells **(P3b)** (§4.5)
- [ ] `OdysseyCameraController.js` — per-act camera profiles + vista beats (§7/P7)
- [~] `ChapterEnvironmentManager.js` — `setAtmosphereOwned` guard yields fog/clear/ambient to the atmosphere, keeps chapter-change/FOV detection **(P2)**; per-chapter strip + blend/cull tuning later

**Chapter environments (refit to spine + level-up the thin four)**
- [ ] `earth-core.js` 🟢 refit • `deep-ocean.js` 🟢 refit • `surface-world.js` 🟢 refit
- [ ] `mountain-peaks.js` 🔴 hero summit/alpenglow • `sky-drift.js` 🔴 cloud decks/aurora
- [ ] `cosmic-expanse.js` 🔴 real volumetric black hole (kill flat plane) • `black-hole-transcendence.js` 🔴 lensing/accretion • `urban-dreams.js` 🔴 neon city

**Data**
- [ ] `chapters.js` — per-chapter `music.track` + breach stinger (replace 8× `'Ambient'`)
- [ ] `music-manifest.js` — register the 8 signature tracks + stingers

**Tests / validation**
- [x] Keep `odyssey-path-layout.test.js` + `theme-icon-resolver.test.js` green — **P0** (still green)
- [x] Add director/profile unit coverage (pure functions: blend, audio mapping) — **P0** (`composition/OdysseyDirector.test.js`, 10 tests)
- [ ] `docs/validation/odyssey/windows/` — user WebGPU screenshots per phase

---

### Appendix A — Current-state file map (for reference)

| Concern | File | Notes |
|---|---|---|
| Chapter data | [chapters.js](../src/core/odyssey/data/chapters.js) | 8 chapters; env colors, themes, narrative, boardTransition |
| Spline layout | [odyssey-layout.js](../src/core/odyssey/data/odyssey-layout.js) | 28 control points y=-30→960; 55 level positions |
| Board orchestrator | [OdysseyBoardController.js](../src/rendering/odyssey/OdysseyBoardController.js) | own WebGLRenderer; render loop at `renderFrame` |
| Environments | [ChapterEnvironmentManager.js](../src/rendering/odyssey/ChapterEnvironmentManager.js) + `chapter-environments/*` | dynamic import, opacity blend, global env lerp |
| Path | [OdysseyPathRenderer.js](../src/rendering/odyssey/OdysseyPathRenderer.js) | 3 tubes + torus markers, fixed rainbow |
| Nodes | [LevelNodeManager.js](../src/rendering/odyssey/LevelNodeManager.js) | instanced glass orbs + 7040 particles |
| Camera | [OdysseyCameraController.js](../src/rendering/odyssey/OdysseyCameraController.js) | follow/free/focus, breathing, portal approach |
| Post | [effects/PostProcessingStack.js](../src/rendering/odyssey/effects/PostProcessingStack.js) | EffectComposer: bloom+CA+vignette+grain |
| Level-entry warp | [OrbPortalTransitionDirector.js](../src/core/odyssey/OrbPortalTransitionDirector.js) + [ThemeTransitionManager.js](../src/core/odyssey/ThemeTransitionManager.js) | state machine + compositor + warp renderer |
| Mode/flow | [OdysseyMode.js](../src/core/game-modes/OdysseyMode.js) | 5142 lines; level flow, not board render |
| Audio engine | [audio-analyzer.js](../src/audio/audio-analyzer.js) | smoothed bass/mid/treble + beat — ready to use |
