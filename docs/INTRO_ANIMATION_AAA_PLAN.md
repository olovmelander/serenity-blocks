# Intro Animation — AAA Visual Overhaul Plan ("Cosmic Serenity")

## Goal

Take the intro animation (boot screen **and** the persistent main-menu background) from
"good indie" to genuinely **AAA, mesmerizing, wow-on-first-launch**. The floating /
bouncing tetrominos are the signature element and **must be kept** — every change here is
*additive* around them (richer world, better light, better grade), never a replacement.

It must look amazing in two contexts:
1. **Boot intro** — first thing the player sees, full drama (`PRESS ANY KEY`).
2. **Menu background** — same renderer running behind the menu cards (`background-only`
   mode), so it must stay readable behind text and never fight the UI.

## Constraints (hard rules)

- **Keep the tetrominos** — same physics, same chunky look, same collisions. Only optional
  glow/trail polish, off by default if it costs readability.
- **WebGPU is the AAA path** ([threejs-intro-renderer-webgpu.js](../src/ui/threejs-intro-renderer-webgpu.js));
  the WebGL path ([threejs-intro-renderer.js](../src/ui/threejs-intro-renderer.js)) gets a
  cheaper "graceful" version of each effect so old hardware still looks good.
- **60 fps floor** on mid hardware, **120 fps** on high-end. Every effect is gated by the
  quality tiers already in [intro-visual-config.js](../src/ui/intro-visual-config.js).
- **Reuse, don't reinvent.** Electric Dreams V3 already ships battle-tested TSL modules we
  can port almost verbatim (see "Assets we already own" below).

---

## Diagnosis — why the current intro doesn't read as AAA yet

From the running build (screenshots) + code review, the gap is **not** the tetrominos or
the particle counts — those are great. It's the *world they live in* and the *grade*:

| # | Tell | Root cause in code |
|---|------|--------------------|
| 1 | **Background is a flat black void** with sparse colored dots — no atmosphere, no depth | Volumetric nebula and constellation lines are **disabled** ([webgpu:65-66](../src/ui/threejs-intro-renderer-webgpu.js#L65-L66)); fog is near-black + very thin (`FogExp2(0x05000f, 0.0065)`); the only "nebula" is one flat additive `PlaneGeometry` far behind everything |
| 2 | **Bloom looks washy / uniform** — the whole frame glows equally instead of just the lights | Post does *non-selective* additive bloom on the full scene ([webgpu:520-592](../src/ui/threejs-intro-renderer-webgpu.js#L520-L592)); no MRT emissive channel, no ACES filmic curve, no saturation/contrast grade |
| 3 | **Title glow is a hard horizontal streak/bar** | Title glow is a single screen-space elliptical falloff added in post ([webgpu:561-580](../src/ui/threejs-intro-renderer-webgpu.js#L561-L580)) — no volumetric halo, no anamorphic streak, no lens veil |
| 4 | **Particles read as uniform flat dots** — little sense of 3D depth | Single billboard layer; depth fade exists but there's no parallax separation between "far stars / mid dust / near motes" |
| 5 | **Motion is random drift** — pretty but not *hypnotic* | Particles + tetrominos move on independent random velocities; nothing choreographs them into the slow, organized, "breathing" motion that reads as premium |

**The single highest-impact fix is #1** — replacing the black void with a living, parallaxing
cosmic nebula. That one change transforms the entire feel. Everything else is multiplier polish.

---

## Assets we already own (port, don't write from scratch)

These live in `src/themes/electric-dreams-v3/` and are WebGPU/TSL, r181-compatible:

| Module | What it gives us | Reuse strategy |
|--------|------------------|----------------|
| [rendering/nebula-volume.js](../src/themes/electric-dreams-v3/rendering/nebula-volume.js) | Inverted-sphere **nebula sky**: domain-warped FBM, indigo→violet→teal vertical gradient, sparse magenta highlight pockets, procedural stars, heat/pulse uniforms | Port as the new backdrop. Re-palette to the intro's chromadelic identity. |
| [post/render-pipeline.js](../src/themes/electric-dreams-v3/post/render-pipeline.js) (`V3PostPipeline`) | **MRT selective bloom** (only emissive glows), **ACES** tonemap, luma-preserving **saturation + contrast**, **real chromatic aberration** (RGB resample, not additive tint), grain + dither, per-quality profiles | Adopt as the intro's post stack; keep the title-glow + god-ray nodes layered in. |
| [materials/tsl-noise-lib.js](../src/themes/electric-dreams-v3/materials/tsl-noise-lib.js) | Shared `warpedFbm3`, `fbm3`, `valueNoise2/3`, `iridescentRamp`, `smin`, `rotate2` | Import directly (or copy to `src/ui/`) so nebula + dust + post share *one* noise definition. |
| [sim/shape-formations.js](../src/themes/electric-dreams-v3/sim/shape-formations.js) | Golden-angle / Fibonacci **target-position generators** (sphere, etc.) | Optional "wow beat": briefly pull drifting pieces/particles toward a loose formation, then release. |
| [composition/camera-director.js](../src/themes/electric-dreams-v3/composition/camera-director.js) | Pointer-parallax orbital camera | Already ported into the intro as `IntroCameraParallax` — Phase A leans on it for real depth parallax. |

---

## The Plan

Phases are ordered by **impact ÷ effort**. A and B together deliver ~80% of the wow.

### Phase A — Living Cosmic Backdrop  ⭐ biggest win

Replace the black void with depth and atmosphere.

- **A1. Nebula sky.** Port `createNebulaSky()` as a large inverted sphere behind everything
  (`renderOrder = -1000`, `frustumCulled = false`). Re-palette to the intro identity
  (deep indigo base, cyan/magenta/violet highlight pockets). Drive `uTime` from the sim
  clock; wire `uPulse` to the existing `audioPulse`. This replaces the disabled flat-plane
  nebula entirely.
- **A2. Parallax depth layers.** Separate the particle field into **3 depth bands** that move
  at different rates as the camera parallaxes (we just added pointer parallax — exploit it):
  - *Far stars* (z ≈ −120…−60): tiny, slow, dim — the "fixed" sky.
  - *Mid dust* (z ≈ −40…−10): soft FBM-tinted motes drifting on a gentle curl.
  - *Near motes* (z ≈ −5…+15): larger, brighter, faster — they sell the depth as the
    camera moves. (The compute already segments particles by type — extend that.)
- **A3. Volumetric light shafts.** A real god-ray/light-shaft layer emanating from behind the
  title (radial streaks in a screen-space pass, breathing on `uTime`), tuned subtle so it
  reads as atmosphere, not a flashlight. (Upgrade the existing `godRays` node, which is
  currently masked to near-zero.)
- **A4. Atmospheric depth.** Warm the fog very slightly and add height-fog tint so distant
  pieces sit *in* the nebula rather than floating on black.

**Result:** the scene gains a sense of being *somewhere* — a vast, slowly swirling cosmos —
instead of objects on black.

### Phase B — Cinematic Post Grade  ⭐ second biggest win

Swap the additive post for a filmic pipeline (port `V3PostPipeline`).

- **B1. MRT selective bloom.** Render `output` + `emissive` targets; bloom **only** the
  emissive channel so tetromino edges, lights, stars, and the title glow bloom — but the
  nebula and grain stay crisp. Kills the "everything is washy" look.
  - ⚠️ **Gotcha:** with MRT, *every* material in the scene must set an `emissiveNode`
    (nebula → `vec3(0)` so it never blooms). Audit all intro materials.
- **B2. ACES filmic tonemap + grade.** Replace ad-hoc lifts with the ACES curve +
  luma-preserving saturation and contrast. Instant "shot on a camera" upgrade.
- **B3. Real chromatic aberration + vignette + grain/dither** from the V3 stack (edge-biased,
  very subtle) for cohesion and anti-banding.
- **B4. Keep the title/god-ray nodes** layered on top of the V3 graph (they're additive and
  composit fine before tonemap).

### Phase C — Title as a Hero Moment

The wordmark is the focal point; right now it's a flat bar.

- **C1. Volumetric halo + anamorphic streak.** Replace the elliptical glow with a soft radial
  bloom *plus* a horizontal anamorphic streak (thin, bright, lens-like) and a faint vertical
  bloom — that's the "expensive lens" look. Breathe intensity on `uTime` + `audioPulse`.
- **C2. Light-sweep reveal (boot only).** On `REVEAL`, sweep a specular highlight across the
  letters once (CSS or a masked node), then settle. Makes the logo feel *forged*.
- **C3. (Stretch) 3D wordmark.** Extrude the title as real geometry so tetrominos can pass
  *in front of and behind* it with correct occlusion + DoF — a strong depth cue. Gated to
  high tiers; keep the CSS title as fallback.

### Phase D — Choreographed, Hypnotic Motion

Turn "random drift" into "designed, breathing" motion.

- **D1. Curl/vortex field.** Add a gentle divergence-free curl-noise flow (shared `fbm3`) so
  particles **and** tetrominos swirl along slow organic currents instead of straight lines —
  this is the difference between "screensaver" and "mesmerizing." Strength is tiny; the
  tetromino *bounce* physics still dominate up close.
- **D2. Slow "breath" macro-cycle.** A ~20–30 s global cycle that gently swells bloom + nebula
  highlight + camera dolly together, so the whole scene inhales/exhales. Hypnotic, calm — on
  brand for "Serenity."
- **D3. Constellation beats.** Re-enable + animate the (currently disabled) constellation
  lines so faint links *form and dissolve* between nearby stars every several seconds.
- **D4. (Optional) Formation beat.** Every ~30 s, briefly bias drifting tetrominos toward a
  loose golden-angle ring/logo silhouette (port `shape-formations`), hold ~1 s, release. A
  subtle "did the blocks just align?" moment — pure wow, fully reversible.
- **D5. Audio reactivity** (hook already exists via `getMusicPulse()`): bass → nebula highlight
  swell + bloom bump; treble → sparkle bursts. Keep it *felt*, not flashy.

### Phase E — Tetromino Polish (keep them, just make them premium)

Non-invasive — preserves look & physics.

- **E1. Comet trails.** Re-enable the already-scaffolded GPU trails (the upgrade plan notes
  they exist but are off): short, type-colored, additive tails that fade with distance.
- **E2. Rim / fresnel light.** Add a subtle fresnel emissive so edges catch a cyan/magenta rim
  against the dark nebula — reads as "lit by the cosmos."
- **E3. Soft ground-glow contact.** When two pieces collide (flash already exists), emit a
  brief soft radial glow at the contact point (cheap sprite) for tactile feedback.

### Phase F — Performance, Tiers & Safety

- **F1. Per-tier budgets.** Extend [intro-visual-config.js](../src/ui/intro-visual-config.js)
  quality budgets: nebula detail (FBM octaves), parallax layer counts, MRT on/off, god-ray
  samples, trails on/off. Minimal/Low tiers drop the volumetric layers but keep nebula sky +
  ACES grade (both cheap, both high-impact).
- **F2. Background-mode throttle.** In menu `background-only` mode, dim the nebula, cut the
  particle counts, freeze the formation beats, and ease bloom so the scene never competes with
  the menu cards — and so it leaves GPU headroom for menu interactions.
- **F3. Measure.** Use the existing `renderer.info` + spike logging (recent commit
  `e7aecd7b`) to verify each phase holds frame budget; add a `?introPerf` overlay toggle.
- **F4. WebGL parity.** For each WebGPU effect, ship a cheaper WebGL twin (sky → gradient-+-FBM
  plane; selective bloom → existing UnrealBloom tuned down; ACES → tone-map + simple grade)
  so the fallback still looks intentional.

---

## File-by-file change map

| File | Phase | Change |
|------|-------|--------|
| `src/ui/intro-noise-lib.js` *(new, or import from v3)* | A,B,D | Shared TSL noise (`warpedFbm3`, `fbm3`, `valueNoise2`, `iridescentRamp`, curl) |
| `src/ui/intro-nebula-sky.js` *(new)* | A1 | Ported/​re-paletted inverted-sphere nebula sky |
| [threejs-intro-renderer-webgpu.js](../src/ui/threejs-intro-renderer-webgpu.js) | A,C,D,E | Add sky + parallax bands + curl field + formation beats; enable trails/rim; wire audio; replace `setupPostProcessing()` with V3 pipeline |
| `src/ui/intro-post-pipeline.js` *(new, adapt V3PostPipeline)* | B,C | MRT selective bloom + ACES + grade + chroma + title/god-ray nodes |
| [intro-tetromino-compute.js](../src/ui/intro-tetromino-compute.js) | D1,E1 | Add gentle curl advection; emit trail samples |
| [intro-particle-compute.js](../src/ui/intro-particle-compute.js) | A2,D1 | Depth-band assignment + curl flow + parallax rates |
| [intro-visual-config.js](../src/ui/intro-visual-config.js) | F | New per-tier budget keys; background-mode profile |
| [threejs-intro-renderer.js](../src/ui/threejs-intro-renderer.js) (WebGL) | F4 | Cheaper twins of sky + grade so fallback looks AAA-lite |
| `public/styles/intro-animation.css` | C2 | Title light-sweep keyframe (boot reveal) |

---

## Suggested implementation order

1. **Phase A1 (nebula sky)** — one file, massive visual delta, low risk. Do this first and
   screenshot the before/after; it sets the tone for everything else.
2. **Phase B1–B2 (MRT bloom + ACES grade)** — the other half of the wow. Watch the MRT
   emissive-node audit (gotcha above).
3. **Phase A2–A3 (parallax depth + light shafts)** — leverages the camera parallax we already
   added.
4. **Phase C (title hero)** — focal polish once the world + grade are in.
5. **Phase D (choreography)** — the "mesmerizing" layer; tune slowly, it's all about restraint.
6. **Phase E (tetromino polish)** + **Phase F (tiers/perf/fallback)** — finishing + hardening.

Ship-and-review after each of 1–4; they're independently shippable and each is a visible upgrade.

---

## Performance budget (targets)

| Effect | Cost target (Ultra) | Tier floor |
|--------|--------------------|-----------|
| Nebula sky (surface FBM sphere) | ~0.2–0.4 ms | All tiers (octaves scale down) |
| MRT selective bloom | ~0.6–1.0 ms | High+; Low uses non-MRT bloom |
| Parallax dust/mote bands | within current particle budget | reduce counts per tier |
| Light shafts | ~0.3 ms | High+ only |
| Curl advection (compute) | negligible (few ALU ops/particle) | All tiers |
| Comet trails | ~0.3 ms | High+ only, off in background mode |

**Frame floor:** 60 fps mid-range, 120 fps high-end, background mode < 30% of full intro GPU.

---

## Risks & gotchas

- **MRT requires `emissiveNode` on *all* scene materials** — missing one throws or mis-blooms.
  Audit nebula, particles, constellation, tetromino, glow, dust before enabling MRT.
- **Readability in menu mode** — nebula brightness + bloom must be dialed back behind cards;
  validate against the actual menu (`background-only`) not just the boot screen.
- **Don't over-choreograph** — the formation/vortex beats must stay *subtle*; the tetrominos
  remain the stars. Anything that makes motion feel "automated" is a regression.
- **Two renderers to keep in parity** — land each effect behind a shared helper/constant so the
  WebGL twin doesn't drift (same approach used for `IntroCameraParallax`).
- **Tonemap order** — title glow / god-rays must be added *before* ACES so highlights roll off
  naturally; grain/dither added *after*.
