## Chapter 6 — Space & Cosmic Expanse

### Creative Vision & Player Feeling

The sky does not end — it dissolves. Chapter 6 is the moment the journey's escalating language of *atmosphere* becomes *void*: the last aurora curtains of Chapter 5 stretch, thin, and recolor until the player realizes they are no longer looking at light in air but at interstellar gas lit from within. The emotional register is awe shading into the first prickle of dread ("Push into the void"; emotionalBeat tips from awe toward panic by the seam). The player should feel three things in sequence: the held breath of leaving the last air, the cathedral hush of drifting between landmarks of impossible scale, and the gravitational certainty of the black hole growing dead ahead — the destination omen that makes Chapter 7 inevitable. Space here is not empty; it is *deep*. True-black negative space is the instrument, but it is always negative space *between* things: filaments, planets, a galaxy, a pillar, a hole in the universe.

### Hero Image & Composition

The trailer frame: the rail ribbon S-curves up-right toward its vanishing point, and seated exactly on that vanishing point is the black hole — white-gold accretion disk #FFF0C4 → #FF5A14, violet outer rim #6A2CFF, blue Einstein ring #9BBCFF — with the crimson Blood-Moon-grade nebula filaments sweeping diagonally behind it, the banded gas giant looming rim-lit in the lower-left foreground, and the spiral galaxy a crisp bright smudge upper-right. The eye travels: planet (near) → ribbon → black hole (destination) → nebula (depth) → galaxy (infinity).

- **Foreground framing:** the gas giant (butterscotch #D9A86A belts, cobalt #3F5FB0 troughs, storm #FF6A3A, atmosphere rim #4275E6) occupies the lower-left third at genuine scale — a planet you pass, not a marble you spot. Near-camera dust motes and occasional elongated speed-streak sparks frame the corridor edges.
- **Midground journey assets:** this is the chapter's structural fix. A garland of dark silhouette asteroids — rim-lit orange by the accretion key light — crosses the corridor at mid-chapter; the nebula pillar rises as a vertical magenta-rust column left of the path; the suction-debris stream spirals visibly into the hole. The midground must always contain at least one object between the player and the backdrop.
- **Background world scale:** the pocketed crimson/indigo nebula dome (preserve exactly — it is the benchmark), the tight Milky Way dust lane, three parallax star shells, and the spiral galaxy anchor. The vacuum between pockets stays near-black #020208 with only the faintest indigo lift — never a wash.

Composition law for the whole chapter: **the rail's travel vector and the visual interest must agree.** Every hero is staged on or near the rail's forward look (+0.7, +0.5, −0.25), with the black hole riding the upper-third vanishing point for the entire act.

### Screenshot Diagnosis

- **Frames 01–07 (intro):** structure collapses into an overexposed lavender wash; 04–07 have no dark anchor, 07 is a dead frame. The gas giant and moon are clipped at the far left edge (03–06) and exit before space begins. 07→08 is the largest single-frame luminance pop in the journey — lavender/white hard-cuts to black/crimson with zero shared palette.
- **Frames 08–28 (body):** the crimson nebula is the chapter's best asset and already at the Blood Moon bar — especially 17–21 where the ribbon crosses the densest filament. **Preserve this material untouched.** But depth is two-tier only: no midground objects anywhere; the rail leads up-right into near-pure black (13–25) while all interest sits center-left; ~11 frames (16–26) are compositionally identical dead air. The only galaxy is a ~10px pinprick at the left edge of 08–12. Stars are sparse single-pixel dots; intro particles read as square sprites.
- **Avatar:** the dark pebble vanishes against black in 11, 13–15, 20, 24; it only reads crossing bright filaments.
- **Frames 28–33 (outro):** 28→29 pops to a frame-filling concentric moiré field that buries the otherwise excellent portal eye (30–32 — dark sphere, magenta iris torus, star-speckled pupil: keep this concept); 32→33 the field vanishes in one frame. Lower-left red nebula in 10/12 shows blocky low-frequency noise versus the crisp filaments above. The dashed magenta path-line in all frames reads as debug overlay — confirm it is capture-only.

### Art Direction Specification

**Palette anchors.** Vacuum base #020208 rising to indigo #08051A at zenith. Crimson nebula (benchmark, preserve): pale-pink hot cores #FF8FA3 → body #E8485C → falloff #6E1030 → black. Cool counter-pocket: cobalt #2F6BFF, teal #2FD0FF, deep indigo #2A1A6A. Warm band filaments: rust #FFA14A with incandescent strand cores #FFD2A0. Black hole: disk #FFF0C4/#FF5A14/#6A2CFF, photon ring #FFF0BF, lens shell #9BBCFF. Stars: hot blue-white #CFE0FF dominant, minority warm gold #FFD9A0 and violet #C59CFF. Handoff colors: aurora green #3DFF8E and red caps #C71F37 (in), seam violet #B38BFF and warm ember #FF7A42 (out).

**Value hierarchy.** Space is the journey's crispest chapter: deepest blacks, hottest small highlights, nothing in the middle washing. Target a 70/25/5 split — 70% values below 0.15, 25% mid (nebula bodies, planet day-side), 5% hot (cores, ring, stars). No frame more than 50% featureless black: the star shells, dust motes, and at least one midground silhouette must always break the void. The strongest light-dark edge in any frame belongs to the current hero (accretion ring against the horizon, or filament against vacuum).

**Lighting.** One warm key — the accretion disk light (0xFF6A2A point light, energy-pulsed) — and one cool violet rim directional (0x6A4CFF). Every midground object is lit by these two and nothing else: orange rim toward the hole, violet fill away. Stars stop twinkling relative to Chapter 5 — keep the 0.78 scintillation floor; persistence is the "above the atmosphere" cue.

**Silhouettes.** Every hero must read as a flat black-on-bright or bright-on-black shape: the gas giant as a crescent-lit disc with a fuzzy terminator and an atmosphere ring that continues past the terminator onto the night side (#6FA8FF rim); asteroids as hard tumbling silhouettes against the crimson filament; the pillar as a tapered column; the black hole as a perfect void disc inside fire.

**Materials & motion.** Domain-warped FBM gas with thresholded pockets (the shipped Blood Moon technique) for all nebula matter; instanced billboard quads with feathered round envelopes for all particles — no square sprites survive this pass. Motion language: slow Keplerian shear on the disk, fold-speed-over-drift-speed on filament interiors, near-dust drifting fast / far-dust slow for parallax, debris spiraling inward. One motion accent per shot, always aimed at the focal.

### Asset & Detail List

1. **Black hole destination omen** (exists) — re-aim its `uApproach` march so it tracks the rail's vanishing point (upper-right of frame through the 13–25 stretch), not screen-center-x. It is the chapter's Journey-mountain: visible in every frame from progress 0.15 on.
2. **Gas giant hero** (exists) — restage its entry pose into the forward frame at chapter start (currently it spawns far-left and clips out); it should be the intro's dark anchor, crescent-lit against the brightening seam, then march to lower-left foreground at 2× scale by mid-chapter.
3. **Spiral galaxy anchor** (exists) — grow its end-state and keep it upper-right, on the same side the rail travels, so the "empty" half of frame owns a focal.
4. **NEW — asteroid garland:** 9–14 instanced dark rocks, 4–18 units, crossing the corridor diagonally between progress 0.35–0.65, staged up-right of the rail; orange accretion rim light on the holeward edges; two or three pass within 30 units of the camera for genuine scale shock.
5. **Nebula pillar** (exists) — keep its mid-chapter `uApproach` reveal; verify it actually enters frame during 16–26, where the dead air lives.
6. **Particle field, three tiers** (exists, extend): near iridescent motes (magenta/cyan/mint/gold), far fine dust, plus a NEW sparse rail-hugging tier of slightly elongated streak quads that sell forward speed.
7. **Airglow membrane** — NEW threshold beat: a thin olive-green #7FBF6A luminous band the camera punches through at the 5→6 boundary (the real-world "last shell of atmosphere").
8. **Aurora-to-filament bridge** — NEW carried element: the final green curtains stretch, elongate, and recolor #3DFF8E → #C71F37 → #E8485C across the ecotone, becoming the first crimson filaments.
9. **Avatar emissive trim** — cool #8FB0FF rim authored above the 0.85 bloom threshold so the traveler reads against pure black.

### Transition In / Transition Out

**In (from Chapter 5 — "the aurora stretches into the cosmos").** Replace the lavender washout and the 07→08 pop with a three-beat ramp across the widened 5→6 seam: (1) *Last light* — Sky's haze authors its own seam exit: opacity falls and hue slides lavender → indigo #1B2A6B while the existing star early-ignite strengthens, so a dark anchor exists by frame 03-equivalent; the gas giant crescent sits in the forward frame as the value anchor. (2) *Membrane* — the threshold beat becomes the airglow shell: thin, horizon-hugging, olive-green, punched through in under a second — a designed event, not a veil wash. (3) *Ignition* — the aurora-to-filament bridge carries green into crimson while exposure eases down to 1.08; stars are already crisp before the nebula arrives. Net: at no point do adjacent frames disagree by more than one value band or share zero hues.

**Out (to Chapter 7 — "nebula collapses into the black hole").** The portal eye stays the climax; the moiré dies. The current concentric interference field is replaced by 3–5 broad, slow gravitational shear arcs in seam violet #B38BFF with warm ember #FF7A42 inner edges — low-frequency, capped opacity, framing the eye instead of burying it. The crimson nebula visibly *streams* toward the hole in the last 10% (debris and filament drift vectors bend inward), and the indigo patches grow to carry the palette into Chapter 7's violet. The shear arcs decay over the seam-exit band rather than switching off, killing the 32→33 pop; Chapter 7's lensing inherits the same arc geometry so the handoff reads as the same physics intensifying.

### Technical Implementation Guidance

All chapter work lands in `src/rendering/odyssey/chapter-environments/cosmic-expanse.js` (scene assembly, `APPROACH` march, `update`) and `cosmic-expanse.tsl.js` (material builders), per the create/userData/update contract and quality budgets.

1. **Hero re-aim (highest leverage):** retune the `APPROACH` endpoint table in `cosmic-expanse.js` — bias `bhScaleB`/`bhYb` and the planet/galaxy B-poses so the black hole tracks the rail's vanishing point through mid-chapter and the galaxy holds the upper-right. Validate against `getOdysseyPathCurve()` tangents for this chapter's range (`getChapterPathRange(6)` in `path-utils.js`).
2. **Asteroid garland:** new instanced mesh in `createCosmicExpanseEnvironment` (refs in `group.userData`, ticked in `updateCosmicExpanseEnvironment`); silhouette material lit by the existing `diskLight` and rim directional — rocks must exist at create time and respect the preset `particleCount`. Slow per-instance tumble only; zero per-frame allocation.
3. **Intro fix:** the wash is the Sky side of the ecotone — author a seam-exit value ramp in `sky-drift.js` (its haze `uOpacity` plus a hue slide toward indigo), and strengthen the existing `_seamInBoostFor` SEAM_56 star ignition in `ChapterEnvironmentManager.js`. Exposure ramps through `OdysseyDirector`'s blended atmosphere state — chapters never touch fog/clearColor.
4. **Airglow membrane + shear arcs:** rework the '5-6' (kind 4, Atmosphere Edge) and '6-7' (kind 5, Lensing Engage) profiles in `transitions/ChapterThresholdDirector.js` / `chapter-threshold-director.tsl.js` — 5-6 veil becomes the thin olive band; 6-7 veil's pattern drops to low-frequency shear arcs with a decay tail across the seam-exit band. No allocation at trigger time, per the prebuilt-FX contract.
5. **Particles:** in `createCosmicDust` add the streak tier (shallow zBase, elongated quads via the billboard helper in `shared/odyssey-tsl-billboard.js`); round-envelope all intro-visible sprites. Counts stay under the existing `DUST_*_CAP` discipline.
6. **Far-nebula blockiness (frames 10/12):** in `createNebulaVolume`'s far tier, raise the per-sprite warp frequency or add one FBM octave only for `nebula-volume-far` (its huge sprites under-sample at 2–3 octaves), or trim `sizeSpan` — whichever holds fill-rate.
7. **Avatar trim:** author the emissive rim where the traveler is owned (path/node systems — `odyssey-path-renderer.js` / `level-node-manager.js`), keyed from the chapter profile accent 0x8FB0FF, ≥0.85 for selective bloom (`userData.emitsBloom` discipline).
8. **Verify** the dashed magenta path-line is the capture/debug overlay (`composition/odyssey-debug-overlay.js`, `?odysseyAAA=1`) and excluded from review captures. Keep `webgpu-tsl-build.test.js` green; batch everything for ONE user desktop capture.

This supersedes nothing structural; it refines the shipped B3b hero-march and ecotone decisions with rail-aligned staging and redesigned threshold beats.

### Acceptance Criteria

- No adjacent-frame luminance pop anywhere in 01–33: the 07→08, 28→29, and 32→33 discontinuities are replaced by ramps sharing at least one hue and one value band across the cut.
- Frames equivalent to 04–07 contain a dark anchor (gas giant crescent) and visible stars; no frame is >50% featureless white or black.
- From progress 0.15 onward, the black hole is visible in every frame and sits within the rail's forward look; the up-right half of frame is never empty for more than 2 consecutive captures.
- At least one midground object (asteroid, pillar, debris stream, or planet limb) separates foreground from backdrop in every body frame 08–28; the 16–26 dead-air stretch shows visible parallax and a growing destination.
- The crimson nebula filaments of 17–21 are pixel-identical in material quality to today's capture.
- The portal eye at the climax is readable with no moiré; shear arcs frame it.
- Intro particles are round; star field shows three parallax tiers with size/color variety; avatar silhouette reads in every frame via its #8FB0FF trim.
- Trailer-frame test: any random capture from 08–33 — black hole on the vanishing point, rim-lit hero in frame, true-black negative space between pockets — could ship as key art.
