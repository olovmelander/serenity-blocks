## Chapter 2 — Deep Ocean & Liquid Worlds

### Creative Vision & Player Feeling

After the pressure and heat of the core, Chapter 2 is release into suspension. The player is born into abyssal twilight at the chapter's foot and carried up a living water column toward a sunlit ceiling — "Drift, dive, recover." The feeling is weightless awe with an undertow of patience: the ocean does not rush you, it escorts you. Life arrives in choreographed passes, not ambient noise — Abzu's lesson that you stage the most iconic, memorable representation of ocean life and control emotion by how far the player can see into the murk (80.lv Abzu creative-director interview). Because water strips warm wavelengths within meters (manoa.hawaii.edu light-absorption reference), every warm or bright thing in this chapter must be either the distant surface or bioluminescence — and that contrast is the chapter's emotional payoff. The player should feel watched over by enormous, gentle things, and should exhale when the caustic ceiling finally fills the frame.

### Hero Image & Composition

The trailer frame: mid-chapter, a 40-unit manta banking diagonally across the corridor 25 units ahead of the camera, wings fully spread, its ventral edge rim-lit electric cyan `#2ef0ff` by a god-ray shaft behind it; a plankton current streams past in visible parallax; the lower third of frame falls into velvet indigo `#04101f`; far above, a faint warm-teal surface disc promises the climb. One dominant focal point, leading lines (rail + shaft) converging on it.

- **Foreground framing:** near-camera plankton motes rendered large, soft, and dim (bokeh discs, not sparks); an occasional kelp frond or wing-tip silhouette sweeping the frame edge as the camera passes a station. Dark, detail-free, strictly a framing device.
- **Midground journey assets:** the choreographed life layer at 15–45 units lateral — the manta passes, the jellyfish procession, the Pearl Gate ring on the rail, pearl bubble streams. This plane carries maximum detail, saturation, and motion.
- **Background world scale:** the vertical gradient ladder of the ocean itself (sunlit teal apex → cobalt mid → near-black abyss), the leviathan silhouette crossing once at extreme distance, the bioluminescent reef glowing on the seabed dunes far below, and the receding god-ray shafts. Value-compressed, desaturated, atmosphere-tinted.

### Screenshot Diagnosis

Confirmed against the capture set (`artifacts/odyssey/journey/Deep Ocean & Liquid Worlds - NN.png`):

- **Preserve exactly:** the caustic ceiling / spine / dark floor three-value beat of frames 18–19; the diagonal rail sweep of 16–17; the exit arc of 20–22 (terrain band, god-ray streaks, warm halo on the traveler); the committed cyan identity.
- **Fauna are mis-scaled, mis-distributed:** in frames 05–15 every creature is a 5–15px speck beaded along the rail spline — no wing silhouette, no banking, no scale. The off-axis 70% of frame is empty.
- **Plankton destroys depth:** frames 03–15 show uniform size/brightness/density motes with no near/far grading and no current direction — reads as snow, lifts the whole frame to light-mid, and erases the value structure.
- **No hero for twelve frames:** 03–15 give the eye nowhere to land; the first focal object (the ring at 16) renders as an unlit black torus. Frames 06–08 are nearly pixel-identical dead time.
- **Placeholder geometry:** the dark-blue panel in 03–06, pink rectangles in 11–15 (jellyfish halo quads whose feather is not reaching zero before the quad edge), and white slabs popping in at 20.
- **Transitions:** the orange core sphere simply vanishes between 02 and 03 with no submersion beat; the title card at 02 sits over the busiest pixels at low contrast.

### Art Direction Specification

**Palette — the depth ladder is the chapter.** Map water color to chapter progress, not to a static gradient the camera happens to sit inside: abyssal entry `#04101f` → cobalt twilight `#10325a` → mid teal `#0a4a66` → sunlit teal ceiling `#149aae` (the existing `uColorTop`). Bioluminescent key: cyan `#2ef0ff` (real deep-sea glow is blue-green ~470–490nm — Monterey Bay Aquarium bioluminescence reference). Single deliberate accent: jelly magenta `#ff44dd` (already in the jelly palette) used sparingly on bells and the reef pulse — this replaces the orphaned pink smears with an accent that has a visible source. Rare warm amber `#ffb35c` reserved for one anglerfish-style lure beat and the Ch1 hydrothermal afterglow. Profile anchors stay: primary `0x0088ff`, accent `0x6fe8ff`, shadow `0x001020`.

**Value hierarchy.** Three bands in every frame: dark floor (bottom third never lifts above `#0a1a2e`), mid water column, light ceiling. Critically, the chapter must get *darker before it gets lighter*: progress 0.0–0.35 plays in twilight (the current wash at frames 06–10 inverts this), 0.35–0.7 in graded cobalt, 0.7–1.0 climbing into the bright ceiling. The strongest light-dark edge is always reserved for the current hero (manta against shaft, jelly against abyss).

**Lighting.** All light is either downwelling (god-ray cones, caustic ceiling, surface disc) or bioluminescent (jellies, reef, plankton, manta rims). No unmotivated fill. Bloom is threshold-based (≥0.85), so bio emissives must be authored to just cross threshold at their cores and feather below it — glow, never clip (emissive cap <1.0 per the visual law).

**Silhouettes.** Every creature must pass the flat-black-shape test. The manta mask needs a real diamond wing-span with swept tips and a slow wingbeat undulation; the jellyfish bell+tendril impostor already passes at sufficient size. The traveler picks up a persistent cool cyan rim while inside the chapter so it reads as a pearl, not a chewed black blob.

**Materials.** The Pearl Gate (the frame-16 torus) becomes nacre: deep blue-green base with an iridescent fresnel sweep (thin-film cyan→magenta→pearl-white at grazing angles) and a soft interior caustic shimmer — it should look grown, not modeled, and rhyme with the `BUBBLE_PEARL` node style. Bubbles read as pearls: tight bright specular dot, faint rim, near-transparent body.

**Motion language.** One global current direction (diagonally up-corridor) carried by plankton drift, kelp sway phase, and bubble streams — motion outranks static contrast, so the current is the chapter's pointer toward the surface. Mantas describe banked arcs across frames; jellies pulse on eased 2–4s sines with desynced phases so distant ones read purely as rhythmic light (Blue Planet II staging).

### Asset & Detail List

1. **Manta trio (NEW — the chapter's hero fix).** Three choreographed crossings at progress stations ~0.22, ~0.52, ~0.82, each a single manta (size 35–55 units) entering from 40–60 units off-axis, crossing the frustum 20–35 units ahead of the camera on a banked arc, exiting the opposite side over ~20 seconds of travel. Pass two is backlit by a god-ray shaft (the hero image). Ventral cyan rim + two photophore lines along the wings.
2. **Jellyfish procession (REWORK placement, keep material).** 6–10 large bells strung up the corridor at 18–40 units lateral, never on the rail line; magenta bells biased to the darkest stretch (progress 0.1–0.35) where they own the frame.
3. **Plankton current (REWORK grading).** Three explicit depth tiers: near (lateral <12u: large, soft, dim, fast parallax), mid (12–30u: medium, brighter), far (>30u: small, sharp, faint). All tiers share the global current vector. Net brightness budget drops ~40% from today.
4. **Pearl Gate ring (REWORK material)** on the rail at ~0.68 progress — the nacreous threshold the camera passes through, replacing the black torus.
5. **Leviathan (KEEP, demote to background).** One extreme-distance crossing at ~0.45, below and beyond the manta layer — scale cue, never competing with the mantas.
6. **Bioluminescent reef + kelp clusters (KEEP).** Seabed crest pockets pulsing cyan↔magenta far below the rail, visible in down-frame at progress 0.0–0.4.
7. **God-ray shafts (KEEP placement logic),** brightening and multiplying with progress so light density itself narrates ascent.
8. **Caustic Gerstner ceiling (PRESERVE EXACTLY)** for the 18–19 beat, plus pearl-bubble streams accelerating upward in the final act.
9. **Hydrothermal vent glow (NEW, entry only):** a dim ember-orange `#7a1500` shimmer at the chapter's foot — Ch1's heat quenched under water.

### Transition In / Transition Out

**In (1→2, "Steam Quench"):** magma becomes hydrothermal glow, per the global poetic-transformation rule. Do not pop the orange sphere out between frames 02 and 03 — submerge it: the Ch1 core light survives for the first ~4% of the chapter as a refracted, wobbling amber glow seen *through* water below the camera, wrapped in a rising bubble-and-steam veil (the existing `'1-2'` threshold profile's `0xff6a22` primary and `0xc7f4ff` particle color are already correct). The camera crosses a visible thermocline shimmer — a brief refraction ripple and a hard light-temperature shift from amber to teal — and the title card moves to the calm dark water just after the crossing, white text over `#04101f`.

**Out (2→3, "Surface Breach"):** ocean caustics become daylight shafts. The white slabs of frame 20 are rebuilt as an approach: from ~0.85 progress the caustic ceiling brightens and lowers, god-rays widen and warm slightly, bubble streams accelerate, and fractured skylight panes (bright refracted patches of the Ch3 sky seen through the wave surface — its mid azure `#2F86D8` shot through with hints of the warm horizon gold `#F0B878`) fade in over ~8 seconds instead of popping. The breach itself keeps the existing 21–22 arc — warm halo, god-ray streaks — handing the warm light directly to Chapter 3's living daylight.

### Technical Implementation Guidance

All chapter work lives in `src/rendering/odyssey/chapter-environments/deep-ocean.js` (scene assembly, placement, update) and `deep-ocean.tsl.js` (NodeMaterial builders), respecting the create/update contract and quality budgets. Ordered:

1. **Manta passes.** Extend `createCreatureSilhouettes` in `deep-ocean.js`: reserve three instances (alongside the existing leviathan instance 0) with per-instance pass parameters (station t, arc amplitude, phase) authored via `createCorridorSampler`. In `createCreatureSilhouetteMaterial` (`deep-ocean.tsl.js`), widen the shape-1 mask in `creatureMask` into a true diamond manta with swept tips, add a slow wingbeat vertical undulation and a banked-arc traverse term (like the existing `levTraverse` but lateral-plus-vertical, slower), and add photophore stripe glow gated to manta instances. All motion stays in-shader from `uTime` + per-instance attributes — zero per-frame CPU, no allocation.
2. **Plankton grading.** In `createPlanktonParticles`, derive a per-instance depth tier from the sampled lateral radius; write per-tier size/brightness into `aSize`/`aColor` at create time, and add a wrapped current-drift term to the billboard `positionNode` (shared direction uniform) so the field visibly flows. Cut `opacityNode` gain from 0.95 and the 1.55 color multiplier down so far-tier motes sit well under bloom threshold.
3. **Progress-mapped darkness.** Bias the lower frame darker: deepen `createOceanGradientTSL`'s down-mix and verify the chapter-2 fog (`fogColor 0x041726`, `fogDensity 0.0035` in `shared/chapter-profile.js`) against fresh captures; if mid-chapter still washes, the fix is value structure (darker gradient, dimmer plankton), never a grade tint, per the visual-cohesion law.
4. **Placeholder kill.** Feather the jellyfish `halo` term in `jellyfishImpostor` to exactly zero before the quad edge (the pink rectangles of frames 11–15); audit the dark panel of 03–06 (likely the `createWaterSurfaceTSL` plane edge or a corridor-field card from `composition/odyssey-corridor-field.js`) and either feather or cull it.
5. **Pearl Gate.** Re-material the rail ring (the `BUBBLE_PEARL` style in `LevelNodeManager.js` and `shared/chapter-profile.js` / threshold ring in `transitions/chapter-threshold-director.tsl.js`) with an iridescent fresnel nacre node built from `odyssey-tsl-noise.js` primitives; it must respond to the god-ray key.
6. **Transitions.** Author the thermocline beat on the `'1-2'` profile and the skylight-pane approach on the `'2-3'` profile in `ChapterThresholdDirector.js` (state-only triggers, prebuilt assets); the amber vent glow and skylight panes live inside the chapter group with `uOpacity` routing so the ecotone crossfade reaches them, never toggling `.transparent` at runtime.
7. **Verify** via one batched desktop capture (WebGPU cannot screenshot headless) and keep `webgpu-tsl-build.test.js` green.

This supersedes nothing structural; it refines the chapter-by-chapter plan's Ch2 flagship remake by demoting the leviathan to background scale and promoting the manta trio to hero.

### Acceptance Criteria

- [ ] Frames equivalent to 05–15 each contain at least one readable midground lifeform with a recognizable silhouette ≥80px, off the rail line; no creature reads as a speck on the spine.
- [ ] At least one manta crossing is captured mid-bank with a visible wing silhouette and cyan rim — and that frame passes the trailer test unedited.
- [ ] Plankton shows three visibly distinct size/brightness tiers and a shared current direction across consecutive frames; no frame reads as uniform snow.
- [ ] The bottom third of every mid-chapter frame holds dark values (≤ ~`#0a1a2e`); the chapter's brightest frames are its last three, not its middle.
- [ ] No untextured quads: no hard-edged panels, pink rectangles, or popping white slabs anywhere in the capture set.
- [ ] The frame-16 ring reads as lit nacre with visible fresnel response, not a black torus.
- [ ] Entry shows the amber core glow refracted underwater plus a thermocline crossing; exit shows ≥3 frames of skylight-pane buildup before the breach.
- [ ] Frames 18–19's ceiling/spine/floor composition and the 21–22 breach arc are unchanged or better.
- [ ] No frame >50% void; draw calls and instanced counts stay within the chapter's existing quality-preset budgets; no new per-frame allocations.
