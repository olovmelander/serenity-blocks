# (Section file — Chapter 7 of ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md)

## Chapter 7 — Black Hole & Abstract Transcendence

### Creative Vision & Player Feeling

This is the true finale: the sublime collapse. The player should feel three movements in one chapter. Movement I, *The Approach* (entry through ~25% progress): dread and awe — a colossal accretion disk swallowing the sky. Movement II, *Inside the Pull* (the long midsection): surrendered free-fall — never safe, never empty, the singularity always ahead, matter streaming past the camera into it. Movement III, *Transcendence* (final levels): release — physics dissolves into the pink/cyan tunnel, and danger becomes beauty. The emotional law of the chapter: **you should always feel the black hole's pull.** Every frame from entry to tunnel must contain either the lensed horizon itself or matter visibly falling toward it. Dangerous, beautiful, overwhelming — but readable: ONE dominant event horizon, controlled chaos around it, per the Gargantua staging canon ([DNGR paper](https://arxiv.org/abs/1502.03808), [CERN Courier: Building Gargantua](https://cerncourier.com/a/building-gargantua/)).

### Hero Image & Composition

The trailer frame: a pure-black shadow disc filling ~40% of frame height in the upper-centre third, rimmed by a razor gold-white photon ring (#FFF0C2), wrapped by the near-edge-on accretion torus — and, critically, the **over/under lensed fold**: thin arcs of disk light bent over the top and under the bottom of the shadow (the single most recognizable black-hole signature; without it the composition reads as Saturn, not Gargantua). Camera rides 10–20° above the disk plane so the fold reads ([NASA SVS accretion visualization](https://svs.gsfc.nasa.gov/13326/)).

- **Foreground framing:** magenta/cyan/gold infall embers and dust motes streaking past the camera edges toward the hero; occasional fractured light shards (thin crystalline billboards) crossing the lower corners. These frame the shot and sell velocity.
- **Midground journey assets:** the ribbon path spiralling toward the horizon; the chain of secondary lensing motifs (smaller horizons with photon rings and magenta/cyan halos) staggered along the corridor; the nine infall stream tubes spiralling into the locked hero; in the final act, the cyan/pink calligraphic swirls thickened into glowing volumetric ribbons.
- **Background world scale:** the camera-locked colossal singularity (the persistent destination landmark, Journey's-mountain style) plus the deep-violet void dome with clustered magenta/cyan/gold nebula pockets and the tangentially smeared lensing starfield. Stars must vary in magnitude so the lensed smear reads as distorted starlight, not uniform blur.

### Screenshot Diagnosis

Frames 01–06 and 24–26 are keepers. The accretion hero of 02–05 (ember-orange/violet swirls with embedded starfield) is the chapter's best painterly asset — palette and timing untouched, title card on 02 stays. The transcendence tunnel of 24–26 (tile mosaic / vortex / ribbon, three full depth layers) is exemplary; 25 is the money shot. Do not touch either.

The failures are concentrated in the midsection. Frames 07–14 are dead: eight consecutive frames of pure RGB-black with only the ribbon — no focal, no midtones, no scale referent for 17 frames after 06. The 06→07 cut is the harshest in the journey: disk and torus vanish between frames, with a measured ~1002 ms seam hitch logged on the HUD. Frame 15 is a bloom blowout — a flat banded pink cone covering ~35% of frame from the camera clipping into ribbon glow; an artifact, not a composition. Frames 16–23: the cyan/pink S-curve swirls are elegant linework but sub-pixel — wireframes of a disk whose fill is off — and the colored bokeh blobs (16–20, 23) are the right background idea at roughly a quarter of the needed density and brightness. 04–05 also lose their background: the right half of frame is empty void. 23→24 pops from near-empty black to dense tunnel in one frame. The green pebble in 07–08 is off-palette; the marble at top-right of 19 clips the ribbon.

Note for the team: `black-hole-transcendence.js` already contains the intended fixes for most of this — the camera-locked distant hero (`createDistantBackgroundHole` + the B2 camera-lock block in `updateBlackHoleTranscendenceEnvironment`), the `createAmbientWashTSL` violet floor, `createCorridorDustTSL`, and `createInfallEmberFieldTSL`. The capture shows none of it reading. First task is verification, then amplification — not reinvention.

### Art Direction Specification

**Palette anchors.** Shadow: pure black #000000 — the only true black allowed in frame, darkness defines the shape. Photon ring: incandescent gold-white #FFF0C2 (max two nested sub-rings; more reads as noise). Disk ramp: inner near-white #FFF4CF → magenta plasma body #FF2EA8 → Doppler electric blue #3AA0FF, with gold ember wisps #FFB347. Doppler asymmetry held at ~30–50% (Interstellar's deliberate muting — full physical asymmetry reads as broken). Einstein ring: cyan #6AE8FF grading to magenta #FF4EC8. Void floor: deep violet #120A21 rising to indigo #261240 — never RGB-black. Energy streams and embers: magenta #FF3AD0, cyan #4EC8FF, gold #FFCF6E, violet #7A4CFF. Halos: magenta #FF2BD0 / cyan #57DCFF alternating.

**Value hierarchy.** Three bands in every frame: the black shadow disc (darkest), violet/indigo void and bokeh mids (#120A21–#261240 plus nebula pockets), and the hot disk/ring/ember highlights. Target roughly 70% deep values / 20% mids / 10% hot. The strongest light-dark edge in frame must always be the photon ring against the shadow. Vignette stays at the chapter-plan 1.05 (the 1.35 figure is superseded — it crushes the void).

**Lighting & bloom.** All glow is emissive-authored against the 0.85 bloom threshold; only disk, photon rings, lensing shells, embers, shards, and starfield carry `emitsBloom`; void dome and ambient wash never bloom. Emissive capped <1.0.

**Silhouettes.** The shadow disc is the chapter's silhouette test: it must read as a flat black circle against the disk glow at any distance. The 16–23 swirls must pass a thickness test — no element thinner than ~3 px at 1080p at its on-path viewing distance, or it aliases in motion.

**Materials & motion language.** Everything moves inward. Disks rotate; streams spiral in and brighten toward the horizon, snuffing to black AT the horizon (never glowing on it); embers orbit tangentially with bounded radial breathing; the tunnel rotates around the camera axis. One motion accent per shot, always aimed at the hero.

### Asset & Detail List

1. **Camera-locked colossal singularity** (exists: `createDistantBackgroundHole`, locked at ~900 units forward, upper-centre bias) — must visibly dominate frames 07–23. Shadow ≥25–30% of frame height.
2. **Lensed fold arcs** (new): two thin curved additive bands carrying the disk ramp colors, folded over the top and under the bottom of the distant hero's shadow.
3. **Entry hero disk + photon ring + Einstein shell** (exists, frames 01–06) — untouched, including the 25%-progress entry fade handoff.
4. **Nine infall stream tubes** (exist) — recolor any off-palette tube to the magenta/cyan/gold triad; brighten tips near the horizon.
5. **Infall ember field** (exists, ~520 instances, cap 900) — raise density toward the cap on High/Ultra; this is the "denser infall particles" mandate.
6. **Corridor dust/bokeh field** (exists, 460 instances) — 3–4x perceived density and brightness through 07–23, extended back into 07–14; gold/amber motes continue the 03–05 spark language so the gold never disappears after 06.
7. **Five secondary lensing motifs** (exist) — verify they actually enter the camera corridor in frames 07–14; pull one or two onto the forward view axis if not.
8. **Volumetric calligraphic swirls** (16–23): keep the existing S-curve linework, add a soft additive glow sheath (cyan #6AE8FF / pink #FF4EC8) around each curve so it reads as a luminous ribbon with mass, not a wireframe.
9. **Fractured light shards** (exist: `createTranscendenceShardsTSL`, 220 instances) — increase size variance so a handful read as distinct crystalline slivers crossing the foreground, not uniform sparkles.
10. **Tunnel pre-seed** (21–23): sparse mosaic tiles and faint vortex hints spawning ahead of the camera so 24 is a crescendo, not a scene load.
11. **Path-riding pebbles** — recolor the green pebble to violet #7A4CFF; either scale the frame-19 marble into a readable lensed orb with a faint photon rim or remove it.

### Transition In / Transition Out

**In (6→7), "nebula collapses into the black hole":** Chapter 6's nebula filaments and starfield should visibly stretch tangentially — the first hint of lensing — as the void dome's magenta pockets bleed into Ch6's final stretch via the ecotone overlap. The threshold breach (`ODYSSEY_THRESHOLD_PROFILES['6-7']`, music stinger "lensing-engage") is the moment the screen-space lens warp (`uLensCenter`) first engages. No element pops: Ch6's stars become Ch7's lensed starfield. The measured 1002 ms hitch at this seam is a hard defect — fix before any visual work lands, or the poetry is moot.

**Out (7→8), "the singularity refracts into neon city light":** the transcendence tunnel's pink/cyan weave is already the bridge — its palette hands directly to Ch8's magenta/cyan neon. Across the final 5% of the chapter, let the tunnel's tile mosaic straighten into grid-like perspective lines and the gold disk ramp linger as a warm afterglow on the horizon (the '7-8' neon-afterglow seam ramp exists), so Ch8's Retrosun and grid feel like the afterimage of the disk and photon ring. The cut must read as refraction, not relocation.

### Technical Implementation Guidance

Files: `src/rendering/odyssey/chapter-environments/black-hole-transcendence.js`, its TSL twin `black-hole-transcendence.tsl.js`, `src/rendering/odyssey/odyssey-path-renderer.tsl.js` (ribbon near-clip fade), `transitions/ChapterThresholdDirector.js` ('6-7' profile), `odyssey-post/odyssey-tsl-pipeline.js` (lens warp tuning only), and `ChapterEnvironmentManager.js` (seam prewarm).

Order of attack:

1. **Verify, then amplify the midsection (the capture contradicts the code).** Confirm in a desktop capture that the B2 camera-lock block, `createAmbientWashTSL`, `createCorridorDustTSL`, and `createInfallEmberFieldTSL` are live in the build being captured. If live but unreadable, raise the ambient wash alpha cap and base luminance until frames 07–14 sit at the #120A21 violet floor, lift corridor-dust breathe alpha and per-tier counts ~3x (within the quality-preset particle budgets passed into `create`), and push the distant hero's halo ring and disk `uEnergy` response so the locked singularity reads at lock depth. One capture wave, batched (user-desktop capture only — no headless WebGPU screenshots).
2. **Kill the 6→7 hitch.** Audit what compiles at the seam: the shared motif materials, ember field, and wash must be covered by `_prewarmChapterEnvironment` compileAsync AND the whole-journey warmup replay; ensure no light-set change and no `.transparent` flip occurs at the boundary (QW4/QW5).
3. **Lensed fold arcs.** Add two curved additive band meshes to `createDistantBackgroundHole` (built in the `.tsl.js` as a feathered arc material sharing the disk's `uHot/uMid/uCool` ramp and `uFade` discipline), refs in `group.userData`, oriented in the camera-lock update so they always cap the shadow top and bottom. Tag `emitsBloom`.
4. **Frame-15 blowout.** In `odyssey-path-renderer.tsl.js`, fade the ribbon's emissive/alpha to zero inside a small camera-proximity radius so the camera can never sit inside an unfeathered glow volume.
5. **Volumetric swirls + tunnel pre-seed (16–24).** Sheathe the swirl curves in a soft additive glow (same technique as the infall tubes' shared materials); pre-spawn sparse tunnel tiles in the 21–23 span with a progress-driven `uOpacity` ramp so the ecotone crossfade reaches them.
6. **Lens warp polish.** With the hero now persistent, the existing `setLensTarget`/`uLensCenter` screen-space warp gets a real anchor for the whole chapter; add magnitude variance to `createLensingStarfieldTSL` star sizes so the tangential smear reads as starlight. Borrow the iridescent magenta→cyan ramp vocabulary and energy-brightness coupling from `src/themes/electric-dreams-v3/materials/tsl-noise-lib.js` and `sim/fluid-particles.js` for ember color/energy behavior.

All additions: instanced billboard quads via `odyssey-tsl-billboard.js` (never THREE.Points), zero per-frame allocation, fades routed through `uOpacity`, lights unchanged.

### Acceptance Criteria

- No frame between chapter entry and exit reads as pure RGB-black; frames equivalent to 07–14 show the violet floor, dust parallax, and the locked singularity (shadow ≥25% frame height) with photon ring and fold arcs.
- The 6→7 seam shows the disk receding with parallax — no element pops — and the measured seam hitch is ≤33 ms (HUD-verified).
- Frame 15's banded cone is gone; the camera never clips into unfeathered glow.
- 16–23 swirls read as luminous ribbons with ≥3 px stroke at 1080p; bokeh density/brightness up 3–4x; tunnel hints visible by 22 so 24 reads as crescendo.
- 01–06 disk palette/timing and 24–26 tunnel are pixel-comparable to the current capture (untouched).
- Doppler asymmetry visible but ≤50%; exactly one dominant horizon per frame; embers snuff to black at the horizon edge.
- Trailer-frame test: any random frame from the chapter, cropped without HUD, passes as marketing art — three value bands, one focal, three depth layers.
- Perf: draw calls <100 in-chapter, no new per-frame allocations, particle counts ride the Minimal→Extreme presets; `webgpu-tsl-build.test.js` stays green.
