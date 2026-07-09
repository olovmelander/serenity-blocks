# Himalayan Peak — AAA WebGPU "Roof of the World" Rebuild Plan

> **Goal**: Turn the Himalayan Peak theme from a flat, DOM/canvas-2D postcard into a **breathtaking, world-class WebGPU mountain scene** — real 3D snow-capped ridges raked by light, eagles wheeling over the valley, prayer flags rippling in real wind, and a sky that goes from cool dawn to a **summit-igniting alpenglow** as your combos build. A scene that makes someone stop and stare. This is the Himalayan sibling of [ELECTRIC_DREAMS_V3_AAA_PLAN.md](ELECTRIC_DREAMS_V3_AAA_PLAN.md) and [WINTER_AAA_PLAN.md](WINTER_AAA_PLAN.md), and reuses their proven architecture (thin orchestrator + GPU subsystems + a director that maps game state to the whole scene).

> **Status**: PLAN WRITTEN ONLY (2026-06-01). No code yet. Art-direction locked with the user: **dynamic day→alpenglow mood arc**, **full 3D cinematic scene**, **keep a refined film-grain/print texture as the theme's signature**.

---

## 0. Why This, Why Now — The Honest Critique

The current theme is charming but it is **2D paper, not a mountain**. Everything is DOM elements and 2D canvas, composited with z-index. Grounded in the code:

| Symptom in the screenshots | Root cause in code |
|---|---|
| Mountains are **flat painted silhouettes** — no form, no light, you can see the layered cut-outs | Three `<canvas>` 2D layers drawn with `1-abs(sin(x))` ridge noise + a single right-slope stipple shadow ([himalayan-peak-theme.js:249-375](../src/themes/himalayan-peak/himalayan-peak-theme.js#L249)). No geometry, no real lighting, no snow accumulation. |
| The **vertical "print streak" look dominates** the whole frame and reads as a glitch, not a peak | That's the global SVG `feTurbulence` grain overlay at `opacity:0.15` + per-layer canvas grain ([himalayan-peak-theme.js:378-394](../src/themes/himalayan-peak/himalayan-peak-theme.js#L378)) stretched over flat art. The texture is a *nice idea* applied to the wrong substrate. |
| The **sun is a flat CSS blob**, no light comes off it | Sun is a static DOM `#himalayan-sun` div; sun rays are disabled ([himalayan-peak-theme.js:435-448](../src/themes/himalayan-peak/himalayan-peak-theme.js#L435)). It lights nothing. |
| **No air, no depth** — back and front ridges sit at the same "distance" | One mist gradient on the back layer only ([himalayan-peak-theme.js:364-371](../src/themes/himalayan-peak/himalayan-peak-theme.js#L364)). No aerial perspective, no atmospheric scattering, no fog volume. |
| Clouds are **CSS divs sliding sideways**; flags are **CSS divs**; birds are **inline-SVG `<div>`s** that flap with a keyframe | `himalayan-cloud`, `himalayan-prayer-flag`, `mountain-eagle-minimal` are all DOM ([himalayan-peak-theme.js:397-431](../src/themes/himalayan-peak/himalayan-peak-theme.js#L397), [:899-935](../src/themes/himalayan-peak/himalayan-peak-theme.js#L899)). They never inhabit the same 3D space as the peaks. |
| Combo FX are **hundreds of `document.createElement` divs** | `triggerSnowBlizzard`, `spawnIceCrystals`, `createWindGust`, `summonMountainSpirits`, `unleashBlizzard` each spawn/teardown dozens–hundreds of DOM nodes with `setTimeout` ([himalayan-peak-theme.js:587-984](../src/themes/himalayan-peak/himalayan-peak-theme.js#L587)). This is the opposite of GPU-orchestrated. |
| **No emotional arc** | Events fire one-shot DOM bursts; nothing in the *world* escalates. The light, the wind, the sky never build with the game. |

The architecture is **fully CPU/DOM-bound**: zero use of the shared WebGL/WebGPU renderer, zero geometry, zero shaders. Every other hero theme (swedish-forest, electric-dreams-v3, winter, neon-district) is GPU-orchestrated. Himalayan Peak is the last flat one.

This isn't a port. It's the version that earns the name "Roof of the World."

---

## 1. TL;DR — Three Game-Changing Techniques

| Technique | Proven by | Why it transforms the theme |
|---|---|---|
| **Real 3D Displaced Ridge Terrain w/ physically-motivated snow** | Ridged-multifractal terrain (Musgrave); slope+altitude snow lines (research below) | Replaces flat canvas silhouettes. Layered 3D ridge meshes displaced by **ridged-multifractal FBM** give genuine peaks, aretes and couloirs. **Snow accumulates by slope + altitude + a noise mask**, rock shows on the steeps via **triplanar** blending, and a **sun/moon rim-light** rakes the summits. With a real camera you get real parallax — the thing that makes mountains read as *vast*. This is the literal answer to "make the mountains look perfect." |
| **Atmospheric Scattering Sky + Aerial Perspective + Volumetric Clouds** | Rayleigh/Mie aerial perspective; Heckel/iq cloud raymarch; the famous Everest **snow-plume** | Replaces the dead gradient + sliding CSS clouds. A **scattering sky** (Rayleigh-blue zenith → Mie-warm horizon) hosts a **physical sun**; **distance fog tints far ridges toward the sky color** (true aerial perspective) so depth is *felt*; **volumetric/billboard clouds** drift between the ridges; and a signature **curl-noise snow-plume** streams off the hero summit. This is the "air" and the postcard depth the scene completely lacks. |
| **Cinematic Post + Alpenglow Grade + Frost/Grain Signature** | Three.js r181 `PostProcessing` TSL stack (same as Electric Dreams V3 / Winter) | Replaces the flat SVG grain. MRT emissive **bloom**, **god-rays** from the sun, **bokeh DOF**, **lens flare**, **ACES** tonemap, and a **director-driven golden-hour grade** that warms the whole frame at peak combo. The theme's DNA is preserved as a **refined, animated film-grain + faint vertical "print" streak** living in the post stack instead of smeared over flat art. The layer that pushes "tech demo" → "AAA finish." |

These compound: real form + real atmosphere + real finish, all GPU-side, all reactive.

**Plus two hero reactive details** the theme is famous for, rebuilt properly:
- **GPU-flocked Himalayan birds** (griffon vultures / lammergeier / demoiselle cranes that famously cross the range) — reuse swedish-forest's boid compute, wheeling in true 3D over the valley.
- **GPU prayer-flag cloth** — a real wind-rippled strand of *lung ta* flags across the foreground, driven by the same wind field as the snow-plume.

---

## 2. The Cinematic Vision

### Hero composition
A deep, wide Himalayan amphitheatre at dawn. A **hero summit** dominates the upper third — a real 3D ridge, snow raked by low sun, rock showing on its wind-scoured steeps, a faint **snow-plume streaming off the cornice**. Behind it, **range upon range of paler ridges** fade into blue atmospheric haze (aerial perspective), giving genuine depth. The **sun** sits low, throwing **god-rays** through thin cloud and a warm glow across the snowfields. **Eagles wheel** in slow circles over the valley. A strand of **prayer flags ripples** across the foreground-left, catching the wind. The board sits in clean air, mid-frame. The whole scene **breathes** with a slow camera drift and a living sky.

The emotional thesis: **the mountain light is the game's intensity.** Serene cool dawn when idle; the air warms and the wind rises as combos build; a big clear **ignites full alpenglow** — the summits blaze rosy-gold, the haze turns fuchsia-violet, the snow-plume flares, birds scatter — then the light **exhales back to calm dawn**.

### Ascent-intensity arc (3 acts + resolution)

One master scalar, `ascentIntensity ∈ [0,1]`, smoothed from game state (fast attack on tetris/big-combo, slow decay) drives **every** subsystem. An `AltitudeDirector` maps it — the Himalayan analogue of Winter's `StormDirector` and Electric Dreams' `fxState`.

| Act | Game state | Sky / Light | Mountains | Wind / Plume | Camera | Post |
|---|---|---|---|---|---|---|
| **I — Cool Dawn** | idle / early | cool blue-hour, soft pale sun, high stars fading | snow neutral white, blue shadows, deep haze | gentle plume, slow flag ripple | slow 25s drift | clean cool grade, light grain |
| **II — Warming** | combos building | sun warms to amber, sky horizon glows, god-rays strengthen | summit rims catch warm light, shadows deepen to violet | plume thickens, flags flutter harder, birds rise | gentle dolly-in, parallax tracks | bloom +, DOF deepens, grade warms |
| **III — Alpenglow Ignition** | tetris / high combo | **summits blaze rosy-gold**, haze turns fuchsia, sun flares, lens flare | full alpenglow rim, snow glows, rock reddens | plume surges + curls, flag snap, birds scatter & wheel | dolly-push + subtle shake + FOV pulse | **golden grade peaks**, bloom flare, god-ray spike, frost-glint, CA + |
| **Resolution** | game over / calm | light eases back to cool dawn over ~3s | rims cool, shadows soften | wind dies, plume settles, flags calm | slow pull-back | grade settles, vignette breathes, grain calms |

`ascentIntensity` never snaps — it eases, so the light feels like *weather and time of day*, not a state machine.

### Compositional depth (layers, back to front)

```
LAYER 0 — SCATTERING SKY + SUN              (the light source of the whole scene)
  Rayleigh/Mie gradient (cool-dawn → alpenglow ramp driven by AltitudeDirector)
  Physical sun disc + bloom + god-ray origin; fading starfield; milky band at dawn
  Parallax ~0.02x (effectively at infinity)

LAYER 1 — FAR RANGES                         (aerial perspective hero)
  3-5 displaced ridge bands, each fading further toward sky color (distance haze)
  Establishes the "ranges upon ranges" Himalayan depth

LAYER 2 — VOLUMETRIC / BILLBOARD CLOUDS      (between the ranges)
  Soft drifting cloud banks at altitude; thin veil the god-rays cut through

LAYER 3 — ★ HERO MASSIF                       (the centerpiece)
  Real 3D ridged-multifractal terrain; slope+altitude snow; triplanar rock;
  sun/alpenglow rim-light; ★ curl-noise SNOW-PLUME streaming off the cornice

LAYER 4 — BIRDS                               (life, true 3D depth)
  GPU boid flock — vultures/eagles wheeling; scatter on big combos

LAYER 5 — PRAYER FLAGS                        (foreground framing, culture)
  GPU cloth strand (lung ta: blue/white/red/green/yellow) rippling in the wind

LAYER 6 — ATMOSPHERE PARTICLES + FOREGROUND   (parallax 1.3x)
  Drifting snow-glints / spindrift catching the light; near rock framing (optional)

POST STACK (in order):
  → MRT emissive bloom (sun, snow glints, flag highlights, alpenglow rims)
  → God-rays / radial light-scatter from the sun screen position
  → Bokeh DOF (focus on hero massif; near flags & far haze soften)
  → ACES filmic tonemap
  → Director-driven golden-hour color grade (cool-dawn → alpenglow)
  → Lens flare (gated on sun visibility + ignition)
  → ★ Signature finish: animated film grain + faint vertical "print" streak + dither
  → Vignette
```

---

## 3. The Hero Techniques — Concrete Recipes

Grounded in our stack: three.js r181, `three/webgpu` + `three/tsl`, `THREE.PostProcessing`, the `Fn(() => {...})()` TSL pattern, uniforms stored on `material.userData`, `mx_noise_float` / the shared noise lib. WebGL fallback strategy in §9.

### 3.1 Real 3D Displaced Ridge Terrain — `himalayan-peak/rendering/ridge-terrain.js`

**Geometry**: a wide `PlaneGeometry` per range band (hero massif high-res ~256×256; far ranges progressively lower-res), tilted to face camera, displaced on the GPU.

**Heightfield (the shape)** — *ridged multifractal*, the canonical "sharp alpine peak" noise. Unlike plain FBM (rolling hills), ridged noise inverts and sharpens each octave to create **knife-edge aretes and pointed summits**:
```
ridged(p) = (1 - |valueNoise(p)|)^2        // sharp ridge per octave
h(p) = Σ  ridged(p · freqᵢ) · ampᵢ · prevWeight   // multifractal: detail rides on big forms
```
Reuse/extend the shared noise lib ([tsl-noise-lib.js](../src/themes/electric-dreams-v3/materials/tsl-noise-lib.js)); add `ridgedMultifractal` and a `domainWarp` to break grid artifacts. A per-band `uSeed` + horizontal scale gives each range its own profile. Displacement happens in `positionNode`; recompute normals analytically from height finite-differences (`hX`, `hZ` taps) for correct lighting — the same finite-diff normal trick swedish-forest's mountain material uses ([swedish-forest-materials.js:970-976](../src/themes/swedish-forest/swedish-forest-materials.js#L970)).

**Snow accumulation (the look)** — physically motivated, per research on slope/altitude snow distribution:
```
slope     = 1 - normal.y                    // 0 = flat top, 1 = vertical wall
altitude  = smoothstep(snowLineLo, snowLineHi, worldY)
windExpo  = dot(normal.xz, windDir)         // windward scouring
snowMask  = altitude
          · (1 - smoothstep(0.55, 0.8, slope))   // steep walls shed snow → rock shows
          · (0.7 + 0.3·fbm(p·detailFreq))        // patchy edges, not a hard line
          - windExpo · windScour·ascentIntensity // gusts strip windward faces
```
- **Snow surface**: high-albedo white/blue with a subtle sparkle term (`fbm` glints, bloom-eligible), faint subsurface-ish blue in shadow.
- **Rock**: triplanar-blended dark schist/granite (greys + warm browns) so steep faces have texture without UV stretching — triplanar is essential on near-vertical terrain.
- **Lighting**: a single directional "sun" (the LAYER 0 sun's world dir) → Lambert + a strong **rim/fresnel** term that the director tints from cool-white (dawn) to **rosy-gold (alpenglow)**. This rim *is* the alpenglow. Crevice/AO darkening from `depthFromPeak` (as swedish-forest does, [:988](../src/themes/swedish-forest/swedish-forest-materials.js#L988)).
- **Aerial perspective**: mix the final color toward the **sky horizon color** by `exp(-distance·fogDensity)` (Beer-Lambert) so far ranges desaturate and blue out. This single term, applied per-band, creates the "ranges upon ranges" depth. Tie `fogColor` to the sky uniform so it stays consistent as the light shifts.

**Snow-plume** (signature): a thin emissive ribbon/particle stream anchored at the hero cornice, advected by the curl-noise wind field (§3.2 wind), thickening + curling with `ascentIntensity`. The famous Everest jet-stream plume.

### 3.2 Atmospheric Sky + Aerial Perspective + Wind — `himalayan-peak/rendering/sky-dome.js` (+ shared wind in `sim/`)

**Sky**: an inverted sphere (BackSide), shaded in TSL — same skeleton as [nebula-volume.js](../src/themes/electric-dreams-v3/rendering/nebula-volume.js), retuned for daylight→alpenglow:
- Vertical gradient with a **Rayleigh-flavored** cool-blue zenith and a **Mie-flavored** warm horizon glow concentrated around the sun azimuth.
- A **physical sun disc** (smoothstep on `dot(viewDir, sunDir)`) with a wide soft halo; emissive → feeds bloom + god-rays + lens flare.
- **Director ramp**: `mix(dawnPalette, alpenglowPalette, ascentIntensity)` shifts zenith/horizon/sun color from cool dawn to rosy-gold. This is the master mood control; the terrain rim-light, fog color, and grade all read from the same `skyHorizonColor`/`sunColor` uniforms so the scene stays unified.
- Fading **starfield** (visible only in cool-dawn, fades as light warms) + a faint milky band — reuse the nebula star trick ([nebula-volume.js:77-82](../src/themes/electric-dreams-v3/rendering/nebula-volume.js#L77)).

**Wind field** (shared by plume, flags, atmosphere particles): a cheap **divergence-free curl-noise** sampler (same primitive Winter's storm-field uses — see [WINTER_AAA_PLAN.md §3.1](WINTER_AAA_PLAN.md)). `windDir`, `gustAmplitude` are director-driven uniforms. One field → coherent motion across plume + flags + spindrift.

**Clouds**: start with **lit billboard cloud cards** (cheap, swedish-forest already has `createCloudNodeMaterial`) drifting between ranges; **optional upgrade** to a half-res raymarched cloud band for Ultra/Extreme. Thin enough that god-rays cut through.

### 3.3 Cinematic Post + Alpenglow Grade + Signature Finish — `himalayan-peak/post/peak-pipeline.js`

Direct descendant of [render-pipeline.js](../src/themes/electric-dreams-v3/post/render-pipeline.js) — copy its structure, retune the stack:

1. **MRT emissive bloom** — only sun, snow glints, flag highlights, alpenglow rims glow (set `emissiveNode` on those materials; MRT requires *all* materials carry an `emissiveNode`, per project memory).
2. **God-rays** — radial blur/scatter from the sun's projected screen position (sample emissive, march ~16 taps toward sun UV). Strength scales with `ascentIntensity` and sun visibility. (Winter's cheap god-ray is a starting point; this is the marquee one.)
3. **Bokeh DOF** — focus plane on the hero massif; near prayer flags and far haze fall soft. Gives the cinematic depth read. (Deferrable to a later phase if budget is tight — see Winter's deferral note.)
4. **ACES filmic tonemap** — the cinematic curve (same node math as [render-pipeline.js:250-255](../src/themes/electric-dreams-v3/post/render-pipeline.js#L250)).
5. **Director-driven golden-hour grade** — luma-preserving saturation + warm/cool temperature shift driven by `ascentIntensity`. Cool-dawn neutral → alpenglow warm-gold. This is the post-side half of the mood arc.
6. **Lens flare** — gated on sun on-screen + ignition (reuse swedish-forest `createLensFlareNodeMaterial` or a post-space ghost chain).
7. **★ Signature finish** — the theme's DNA, refined: animated **film grain** + a **faint vertical "print" streak** (1D noise modulating a subtle vertical striation, dialable `uStreakStrength`, near-zero by default so it's *texture* not *glitch*) + blue-noise **dither**. Lives here, over the final 3D image — not smeared on flat art.
8. **Vignette** — gentle, breathes with the director.

All knobs profile-driven (per-quality presets) + runtime via `updateDynamic(cachedParams)` — never allocate per frame ([render-pipeline.js:322](../src/themes/electric-dreams-v3/post/render-pipeline.js#L322)).

### 3.4 GPU Birds — `himalayan-peak/rendering/peak-birds.js`

**Near-direct reuse** of [swedish-forest-birds.js](../src/themes/swedish-forest/swedish-forest-birds.js) + [swedish-forest-compute.js](../src/themes/swedish-forest/swedish-forest-compute.js): the boid flocking (separation/alignment/cohesion + predator avoidance) is exactly what we want. Changes: fewer, larger birds (Himalayan griffon vultures / lammergeier soar solo or in small kettles, not dense flocks); **slower, gliding wing-beats** with long circling arcs; bias their bounds to **wheel over the valley** in front of the ranges; tint dark-silhouette against the bright sky. On **big combos**, push a transient "predator" point to make them **scatter and re-form** — turning the existing predator input into a combo reaction.

### 3.5 GPU Prayer Flags — `himalayan-peak/rendering/prayer-flags.js`

A strand of quads (one per flag, traditional 5-color *lung ta* order: **blue / white / red / green / yellow**) on a catenary line across the foreground-left. Vertex shader ripples each quad with `sin` + curl-noise sampled from the shared wind field (so flags and snow-plume share weather). Director raises ripple amplitude + adds a "snap" on big clears (the spiritual `blessPrayerFlags` reaction, [himalayan-peak-theme.js:656](../src/themes/himalayan-peak/himalayan-peak-theme.js#L656), reborn as real cloth). Emissive edge highlight makes them bloom faintly at ignition.

---

## 4. Architecture & File Layout

Mirror the proven subsystem-orchestrator layout (electric-dreams-v3 / winter). The theme file becomes a **thin conductor**.

```
src/themes/himalayan-peak/
  himalayan-peak-theme.js          ← REWRITE: thin orchestrator (renderer, scene, camera,
                                      subsystem composition, frame loop, event→director wiring)
  himalayan-peak-tetrominos.js     ← keep (palette already perfect: lung-ta flag colors)
  himalayan-peak-theme-icon.png    ← keep (regenerate screenshot later)
  himalayan-noise.js               ← NEW: shared TSL noise (ridgedMultifractal, fbm, curl,
                                      domainWarp) — sibling of tsl-noise-lib.js / lunara-noise.js
  composition/
    altitude-director.js           ← NEW: ascentIntensity arc → all subsystems (StormDirector analogue)
    camera-director.js             ← NEW or reuse e-d-v3's (drift + combo dolly/shake/FOV pulse)
  rendering/
    sky-dome.js                    ← NEW: scattering sky + sun + stars + director ramp
    ridge-terrain.js               ← NEW: displaced ridged-multifractal massif + far ranges,
                                      snow/rock/triplanar/rim-light/aerial-perspective, snow-plume
    cloud-layer.js                 ← NEW: billboard clouds (+ optional raymarch upgrade)
    peak-birds.js                  ← NEW: boid flock (adapted from swedish-forest-birds.js)
    prayer-flags.js                ← NEW: GPU cloth flag strand
  sim/
    wind-field.js                  ← NEW: shared curl-noise wind (plume + flags + spindrift)
    spindrift.js                   ← NEW: GPU snow-glint / atmosphere particles
  post/
    peak-pipeline.js               ← NEW: cinematic post (adapted from e-d-v3 render-pipeline.js)
```

**Index/CSS**: the old DOM children of `#himalayan-peak-theme` ([index.html:347-353](../index.html#L347)) become a single mounted `<canvas>`. Strip the obsolete CSS (clouds/flags/sun/grain keyframes) and the SVG grain overlay. Theme registry entry ([theme-registry.js:10](../src/themes/theme-registry.js#L10)) is unchanged (same id/module path).

**Lifecycle**: set `this.resourceProfile = 'heavy-gpu'` so BaseTheme's deep GPU disposal kicks in ([base-theme.js:250](../src/themes/base-theme.js#L250)); wire `setupRendererResilience` for WebGPU device-loss; dispose every subsystem in `stop()` exactly as e-d-v3 does ([electric-dreams-v3-theme.js:753](../src/themes/electric-dreams-v3/electric-dreams-v3-theme.js#L753)).

---

## 5. The Reactive Arc — `AltitudeDirector`

The conductor. Holds `ascentIntensity` (eased) + transient punches, maps them to a struct every subsystem reads each frame. Mirrors Winter's StormDirector and e-d-v3's `fxState`.

- **Inputs** (via existing eventBus, gated on `window.settings.backgroundComboEffects` like the current theme): `LINE_CLEAR` (lineCount → attack), `COMBO` (comboCount → sustain), `PIECE_LOCK` (tiny breeze + flag flutter), `HARD_DROP` (camera/plume punch), `GAME_OVER` (resolution exhale), `GAME_START` (reset to dawn).
- **State**: `ascentIntensity` (fast attack ~0.2s on tetris/7+ combo, slow decay ~3-4s); `gustPulse`, `bloomPunch`, `flarePunch`, `cameraPunch` (decay per-frame, e-d-v3 pattern [:691-702](../src/themes/electric-dreams-v3/electric-dreams-v3-theme.js#L691)).
- **Outputs** (cached object, no per-frame alloc): sky palette blend t, sun color/warmth, terrain rim color + snow glow, fog density/color, wind dir + gust amplitude, plume density, bird scatter impulse, flag ripple gain, camera dolly/shake/FOV, and all post boosts (bloom/godray/grade-warmth/CA/flare).
- **Mapping examples**:
  - Triple → small warmth bump + gentle dolly + a few birds rise.
  - Tetris → ignition pulse: alpenglow snaps in, plume surges, lens flare, birds scatter, camera dolly-push + FOV pulse.
  - Combo ≥7 → sustained high `ascentIntensity` (the longer the combo, the longer the golden light holds).
  - Game over → drive `ascentIntensity` to 0 over ~3s with a slow camera pull-back.

This replaces ~10 DOM-spawning `onLineClear`/`onCombo` methods ([himalayan-peak-theme.js:485-1000](../src/themes/himalayan-peak/himalayan-peak-theme.js#L485)) with **one scalar driving a unified world**.

---

## 6. Phased Implementation Plan

Each phase is independently shippable + build-verifiable; the scene looks better at every step. (Mirrors how Winter shipped Phase 0→3.)

- **Phase 0 — Scaffold & first light.** New dir structure; thin orchestrator boots a `WebGPURenderer` (with the e-d-v3 init + timeout + backend-check guard, [:182-202](../src/themes/electric-dreams-v3/electric-dreams-v3-theme.js#L182)); perspective camera; mount canvas into `#himalayan-peak-theme`; `himalayan-noise.js`; **scattering sky + sun** only. Stub `AltitudeDirector` wired to events (logs intensity). Strip old DOM/CSS. *Result: a real 3D sky you can already see is alive.*
- **Phase 1 — The mountains.** `ridge-terrain.js`: hero massif + far ranges, ridged-multifractal displacement, snow/rock/triplanar, sun rim-light, aerial-perspective haze. Camera drift. *Result: the WOW core — peaks that look perfect.*
- **Phase 2 — Atmosphere & post.** `cloud-layer.js`; `peak-pipeline.js` (bloom + ACES + god-rays + grade + signature grain/streak + vignette). Director now drives the **day→alpenglow** mood arc end-to-end. *Result: cinematic, reactive, the mood lands.*
- **Phase 3 — Life.** `peak-birds.js` (boid flock) + `prayer-flags.js` (cloth) + `wind-field.js` + the **snow-plume** + `spindrift.js`. *Result: the scene breathes; all the beloved elements return, properly.*
- **Phase 4 — Polish & reactions.** Bokeh DOF, lens flare, bird-scatter on combos, flag-snap, ignition flares, camera punches; tune the 3-act arc. *Result: the full emotional arc.*
- **Phase 5 — Perf & quality presets.** Profile at 4K; wire quality presets (§7); adaptive downscale; LOD on far ranges; verify WebGL fallback; regenerate theme icon. *Result: ships at 60fps across the quality ladder.*

**Critical gate**: like Winter, browser-verify each phase in a **real WebGPU browser** before stacking the next — the whole plan is GPU-side.

---

## 7. Quality Presets & Performance Budget

Reuse the project's preset names (Extreme/Ultra/High/Medium/Low/Minimal) via `normalizeQuality`. Knobs:

| Knob | Minimal | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|
| Terrain res (hero / far) | 96 / 48 | 160 / 80 | 224 / 112 | 256 / 128 | 320 / 160 |
| Far range bands | 2 | 3 | 4 | 5 | 5 |
| Birds | 16 | 64 | 128 | 256 | 384 |
| Snow-plume / spindrift particles | off | 2k | 6k | 12k | 20k |
| Clouds | 3 cards | 6 cards | 8 cards | raymarch | raymarch |
| Post | bloom only | +ACES+grade+grain | +god-rays | +DOF+flare | +DOF+flare full |
| Pixel ratio | `getEffectivePixelRatio` capped | … | … | … | up to 2 |

Honor `getEffectivePixelRatio()` / `getAntialiasEnabled()` and subscribe to `PERFORMANCE_DOWNSCALE` (BaseTheme already auto-squashes render scale, [base-theme.js:51](../src/themes/base-theme.js#L51)). Half-res the god-rays + any cloud raymarch.

**Budget target**: ≤ ~4ms theme cost at High/1080p. Terrain is the big static cost (draw it once, displace on GPU, low far-range LOD); birds/plume/flags are cheap compute; post is the variable cost (DOF + god-rays are the expensive nodes — gate by quality).

---

## 8. WebGL Fallback Strategy

Electric Dreams V3 is WebGPU-only with a graceful message ([:176-181](../src/themes/electric-dreams-v3/electric-dreams-v3-theme.js#L176)); swedish-forest keeps a full WebGL path. **Recommendation for Himalayan Peak**: **WebGPU-first with a real WebGL fallback**, because this theme isn't a niche showcase — it's a beloved default-tier theme that must look good everywhere.

- **WebGPU path** (primary): everything above — TSL node materials, compute birds/plume, full post.
- **WebGL fallback**: same scene graph using `ShaderMaterial` equivalents — terrain displacement + snow/rock/rim in GLSL (swedish-forest's mountain GLSL is a starting point), `GPUComputationRenderer` boids (swedish-forest already ships this fallback, [swedish-forest-birds.js:400](../src/themes/swedish-forest/swedish-forest-birds.js#L400)), `EffectComposer` bloom + grade. Drop the raymarched cloud + DOF; keep billboard clouds + grain. The detection pattern: `renderer.backend?.isWebGPUBackend === true` gates the WebGPU-only nodes (per project memory + swedish-forest precedent).
- This split is the most code, so it's a Phase-5 hardening task — Phases 0-4 target WebGPU to nail the look first, then port the essentials down.

---

## 9. Risks, Gotchas, Deferred Polish

**Gotchas (from project memory + sibling themes):**
- **MRT requires every material to set `emissiveNode`** — even non-glowing ones (set to `vec3(0)`), or MRT bloom breaks. Bit everyone in winter/e-d-v3.
- **TSL**: `Fn(() => {...})()` needs the trailing `()`; `positionLocal`/`positionWorld` not `position`; `pointUV` not `gl_PointCoord`; store runtime uniforms on `material.userData`. (Project memory, "TSL Key Facts".)
- **A new mounted canvas needs the theme container cleared first** and the old DOM children removed — and because we're removing `<link>`-less inline DOM (not a stylesheet), HMR is fine, but a full reload is safest when ripping out the old CSS.
- **Aerial-perspective fog color must track the sky** — if the haze color and sky horizon color drift apart during the alpenglow ramp, far ranges look pasted-on. Single shared uniform.
- **Bird `frustumCulled = false`** + `matrixAutoUpdate = false` (swedish-forest pattern) or instances vanish.
- **Director easing**: attack-fast/decay-slow, or the alpenglow either never triggers or strobes on every clear.

**Deferred polish (ship core first, iterate in-browser):**
- Raymarched volumetric clouds (start with billboards).
- True bokeh DOF (start with focus-only blur; full hexagonal bokeh later).
- Foreground near-rock framing geometry (LAYER 6) — nice, not essential.
- Snow-plume → full curl-noise compute (start with a vertex-shader ribbon).
- Reflection/refraction on any glacial-lake foreground (out of scope for v1).

---

## 10. What We Keep vs Replace (faithfulness check)

The user loves this theme. Explicit mandate: keep the *feeling* — mountains, birds, sky, flags, sun, effects — and make them gold-standard.

| Beloved element | Today | Becomes |
|---|---|---|
| Majestic snow peaks | flat canvas silhouettes | **real 3D ridged-multifractal massif + far ranges**, slope/altitude snow, rim-light |
| The sky | dead gradient | **scattering sky** with a physical sun, day→alpenglow |
| The sun | CSS blob | **physical sun** driving bloom + god-rays + lens flare + scene lighting |
| Prayer flags | CSS divs | **GPU cloth** strand, real wind, lung-ta colors preserved |
| Birds / eagles | inline-SVG divs | **GPU-flocked** vultures/eagles wheeling in true 3D |
| Clouds | sliding CSS | **lit drifting clouds** between the ranges (god-rays through them) |
| Snow / blizzard / wind FX | DOM spawn storms | **director-driven** snow-plume + spindrift + wind, escalating with combos |
| The grainy "print" texture | SVG overlay on flat art | **refined animated grain + faint vertical streak** in the cinematic post stack |
| Combo "sacred" energy | DOM orbs/thunder | **the alpenglow ignition itself** — the mountain lights up with your play |

Nothing beloved is lost; everything is reborn at AAA fidelity.

---

## Sources / Research
- Snow accumulation (slope/altitude/wind-driven, vertex displacement + noise): [Real-time Rendering of Accumulated Snow (ResearchGate)](https://www.researchgate.net/publication/249762382_Real-time_Rendering_of_Accumulated_Snow), [Snow Accumulation in Screen Space (IEEE)](https://ieeexplore.ieee.org/document/8939960/), [GIS-based snow cover rendering (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0097849317301693)
- Aerial perspective / atmospheric scattering for distant peaks (Rayleigh/Mie, fog-toward-sky-color): [Notes on atmospheric perspective and distant mountains (runevision)](https://blog.runevision.com/2025/06/notes-on-atmospheric-perspective-and.html), [Aerial perspective (Britannica)](https://www.britannica.com/art/aerial-perspective)
- Himalayan art direction (alpenglow, golden hour, the Everest snow-plume, prayer flags): [On the trail to Everest — color, prayer, tradition (The Politic)](https://thepolitic.org/on-the-trail-to-everest-a-journey-of-color-prayer-and-himalayan-tradition/), [Annapurna photography guide](https://www.nepalhorizontreks.com/blog/photography-guide-for-annapurna-base-camp-trek-best-spots-tips)
- In-repo references: [ELECTRIC_DREAMS_V3_AAA_PLAN.md](ELECTRIC_DREAMS_V3_AAA_PLAN.md), [WINTER_AAA_PLAN.md](WINTER_AAA_PLAN.md), and the live subsystems they describe (orchestrator, post pipeline, nebula sky, boid birds, noise lib, storm director).
