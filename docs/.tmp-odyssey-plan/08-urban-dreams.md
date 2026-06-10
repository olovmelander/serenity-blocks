## Chapter 8 — Urban Dreams Encore

### Creative Vision & Player Feeling

The singularity does not end the journey — it refracts it. Chapter 8 is the afterimage burned onto the player's retina after staring into the black hole: the accretion disk's molten gold cools into a synthwave sun, the photon ring's cyan becomes street neon, and the void becomes a rain-slicked city night. The player should feel release after transcendence — faster, flashier, nocturnal, celebratory. Where Chapter 7 asked for surrender, the encore asks for swagger: a victory lap down one endless neon canyon toward a sun that never finishes setting. Emotionally this is the curtain call — the house lights are warm, the band plays one more song, and at the very end the city dims like an afterimage, leaving only the memory of fire deep below, where it all began.

### Hero Image & Composition

The signature trailer frame: a one-point-perspective shot straight down the canyon slot. A colossal scanline-cut synthwave sun sits dead-center on the horizon — Laser Lemon crown #FEF65B through Heavy Orange #FD8A26 to Hot Pink #FF5ACD — partially occluded by a jagged, near-black skyline silhouette (towers, antennas, billboard frames) so it reads as distant and enormous. The megastructure spire crosses the disc as the tallest silhouette, its conduit core the one cool accent inside the warm disc.

- **Foreground framing:** dark tower edges at frame left/right rim-lit with thin cyan #00F2FF edge neon; the cyan path ribbon and ring gates threading bottom-center toward the vanishing point; rain streaks catching magenta.
- **Midground journey assets:** the canyon walls of lit-window facades, holographic signs angled toward the path, sky-traffic light trails streaking toward the sun, the wet street's smeared vertical reflections.
- **Background world scale:** the sun-and-skyline backdrop plus a magenta-violet horizon haze band (#C600FF bridging into #580E91 sky) that lifts the void's black floor and fakes kilometers of city beyond the last tower.

The composition obeys the Blade Runner 2049 discipline (StudioBinder's BR2049 analysis; 80.lv "Lights and Color in Cyberpunk Environments"): one dominant hue per beat — magenta city body, cyan reserved for the path and accents, the sun the only warm element in the chapter and therefore the undisputed focal point.

### Screenshot Diagnosis

Frames 01–04: the vortex intro is a real hero focal point with readable recession — preserve the device and its timing exactly, including the "Urban Encore" title placement in frame 02. Frame 05: the focal point dies with the vortex; the centered lens-ring reads as an artifact. Frames 06–10 — over a third of the chapter — aim the camera at a horizontal band of pure black between tiled ceiling and floor terraces: no focal point, no background layer, no mid-value, no scale cue; the offscreen spotlight cones tease a source that never resolves. Crucially, `createSynthwaveSunTSL` already exists and is mounted at the corridor's far end — these frames prove it is not landing on screen; the first job is making it read, not inventing it. The value structure is bi-modal salt-and-pepper: every facade window at full emissive against black. Frames 07–10 are compositionally near-duplicates (one beat repeated four times). Frame 11 is a dead frame — a screen-filling flat teal polygon reading as camera-inside-geometry; frame 12's disconnected pink/blue shards read as glitch debris, though its tower-edge-against-black silhouette is the best macro shape in the set and proves the look works. Palette DNA (magenta/cyan/cream on deep navy) is coherent throughout — redistribute, never add hues.

### Art Direction Specification

**Palette anchors.** Sun ramp: #FEF65B → #FD8A26 → #FF5ACD (the cooled echo of Chapter 7's accretion ramp #FFF6E8/#FFB347/#FF7A1A — the cosmic handoff per the synthwave/Outrun canon and the DNGR disk physics). Bridge rule: orange never touches blue directly — magenta/purple #C600FF always mediates (Outrun palette guide). City: electric cyan #00F2FF (path, gates, street centerline), hot magenta #FF3FB4 (signs, sky, traffic), deep indigo base #0C0818, sky floor #02066F–#580E91, skyline silhouette near-black #07050F (never RGB 0,0,0). Warm cream windows #FFD180 become rare punctuation, ≤5% of lit windows.

**Value hierarchy.** Rebuild as four bands: (1) near-black silhouette layer — skyline cards, tower rooflines, foreground frames; (2) dim ambient mass — 70–80% of facade windows at roughly a quarter of current intensity, below the 0.85 bloom threshold; (3) mid-value glow — horizon haze band, light-pollution dome, wet-street smears; (4) full-brightness accents — the sun, the spire conduit, path ribbon, ring gates, one accent window row per landmark tower. The strongest light-dark edge in every frame is the sun's limb against the skyline silhouette.

**Lighting and silhouettes.** Every tower must pass the flat-black-shape test against the haze (silhouette-first practice from Journey/Tsushima art teams). Give the slab edges hard rooflines, setbacks, and antenna spikes so walls read as architecture, not confetti. The teased offscreen spotlight cones in frames 06–10 resolve into the sun: their color shifts warm as the camera approaches it.

**Materials and motion.** Wet asphalt stretches sign reflections 2–4x vertically, blurred horizontally, broken by puddle masks so they shimmer rather than mirror. Light trails are TRON ribbons — white-hot core, colored bloom falloff — not particles, all converging on the sun's vanishing point. One motion accent per shot: traffic in the mid-chapter, the shock ring at the finale.

### Asset & Detail List

- **Synthwave sun** (exists: `createSynthwaveSunTSL`) — dead ahead on the corridor centerline; must subtend ~25–30% of frame height from mid-chapter onward; scanline gaps widening toward the bottom, solid hot crown.
- **Skyline silhouette cards** (new) — two or three flat near-black layered cards between the sun and the last tower rank (z beyond −1100 in corridor space): jagged rooflines, water towers, antenna clusters, dead billboard frames; nearest card slightly blue-lifted, farthest darkest, so the sun is partially occluded and reads distant.
- **Horizon haze gradient** (new) — a wide magenta-violet fog card behind the skyline, the chapter's missing mid-value band.
- **Mid-chapter landmark: the Gate Bridge** (new) — a horizontal sky-bridge spanning the canyon at roughly the frame-07/08 position, carrying one oversized magenta holo-billboard; the camera passes under it, breaking the four-frame duplicate beat with a compression-and-release moment (Piaskiewicz composition; Journey's pacing curve).
- **Existing assets, retuned:** facade window tiers (dim majority/bright accents), curtain walls extended so no gap shows raw black, hologram signs distributed along the full corridor instead of clustered near z≈−600, ring gates kept as path rhythm, hero light trails sweeping the spire at the finale, rain curtain unchanged.

### Transition In / Transition Out

**In (from Chapter 7):** the "Neon Snap" threshold (`ODYSSEY_THRESHOLD_PROFILES['7-8']`) and the vortex intro of frames 01–04 already work — preserve them. Strengthen the poetic handoff: during the 7→8 ecotone overlap the singularity's last lensed gold smear should hang on the horizon and *become* the sun's first glow — the accretion ramp literally cooling into the Retrosun gradient, while the photon ring's cyan persists as the path ribbon.

**Out (journey's end):** frames 11–12 are broken — the flat teal polygon and unshaded breach shards must become designed geometry: emissive vertical gradients, cyan edge glow, and motion streaks on the breach planes so the exit reads as a deliberate neon wipe, never raw clipping. The resolve is a dimming, not a cut: over the journey-end ramp the city's windows gutter out block by block, signs flicker dark, rain thins, and the sun is the last thing lit — its hot crown cooling from #FEF65B toward the molten orange of Chapter 1's magma (#FF7A1A into the Ch1 fog family around #2D1500). If the journey loops to Chapter 1, the final beat tilts the eye downward: the sun's afterglow sinks below the street datum like an ember returning to the core, the city fading like an afterimage exactly as the outro copy promises.

### Technical Implementation Guidance

All work lands in `src/rendering/odyssey/chapter-environments/urban-dreams.js` (scene assembly, `updateUrbanDreamsEnvironment`) and `urban-dreams.tsl.js` (NodeMaterial builders), per the .js/.tsl.js pattern; new refs in `group.userData`, animation in update, no per-frame allocation.

1. **Sun visibility audit first.** The sun mesh sits at corridor (0, −10, −1180) with disc radius 240 and `renderOrder` −95; frames 06–10 show it absent. Verify against `computeCorridorOrientation` (the averaged-tangent alignment in urban-dreams.js) that the corridor's −Z actually matches the camera's forward band in those frames; check occlusion by the curtain walls (`createCurtainWallTSL`, WALL_LEN 1400 centered at z −520) and the frustum-culling bounding sphere; check whether `discAlpha` (capped 0.78) times the idle `revealGain` (~0.7) leaves the disc under the 0.85 bloom threshold after ACES. Raise the disc's apparent size and/or pull it nearer until it holds ~25–30% of frame height mid-chapter, and let `uReveal` idle higher so the disc is always alive.
2. **Skyline silhouette + horizon haze.** Add two or three cheap flat cards (single quads, dark colorNodes with hash-derived roofline masks built from `fbm2`/`hash21` in `shared/odyssey-tsl-noise.js`) between the sun (renderOrder −95) and the towers, plus one wide haze gradient card; no `emitsBloom`, opacity routed through `uOpacity` so the ecotone crossfade reaches them (hard constraint 3).
3. **Window value tiers.** In `createFacadeMaterial`, split the single `on = step(0.42, r)` gate into three hash bands — dim ambient (~70–80% of lit windows at ~0.25x intensity), mid, and rare full-bright accent rows biased toward camera-near ranks and the `LANDMARKS` towers — and demote the warm-cream branch (`step(0.86, r)`) to ≤5%. This is the bi-modal-value fix and costs nothing.
4. **Gate Bridge landmark.** Build in `createCityBlocksTSL`'s group or a sibling builder at the mid-corridor z; reuse `createSignMaterial` for its billboard. Keep it inside the chapter group at create time (light-rig constraint if any light is added).
5. **Exit shading.** Give the journey-end breach planes (the `userData.journeyEnd` ramp consumers and the 7→8/exit geometry shaded today as flat polygons — coordinate with `transitions/ChapterThresholdDirector.js` and `chapter-threshold-director.tsl.js`) vertical emissive gradients, edge glow, and streak masks; drive the city-dimming resolve from the same progress ramp in `updateUrbanDreamsEnvironment`, alongside the existing `uReveal` ignition (0.82→1.0).
6. **Grade.** Any warm-sun lift goes through value structure, not per-chapter tint cranking, per the cohesion law in `CHAPTER_SIGNATURES` (`odyssey-post/odyssey-tsl-pipeline.js`). Batch everything; request ONE desktop capture (WebGPU cannot screenshot headless).

The neon vocabulary can borrow directly from `src/themes/electric-dreams-v3/materials/tsl-noise-lib.js` (`iridescentRamp` purple→magenta→cyan) and the MRT selective-bloom taste decisions in `src/themes/electric-dreams-v3/post/render-pipeline.js`.

### Acceptance Criteria

- Frames 06–10 each contain the sun, partially occluded by a readable skyline silhouette, with the haze band killing the pure-black horizontal void; no frame in the chapter exceeds 50% void.
- Grayscale check: every frame shows four distinct value bands; the strongest edge is the sun's limb against the skyline.
- ≤30% of facade windows at full brightness; the sun is unambiguously the brightest element in frames 05–12.
- One frame between 06 and 09 shows the Gate Bridge overhead — the 07–10 duplicate beat is broken.
- Frame 11 no longer exists as a flat untextured polygon; the exit reads as a designed neon wipe, and frame 12's shards carry gradients and edge glow.
- The final frame shows the city dimmed and the sun's ember sinking — a visible hint of descent toward the core.
- Trailer-frame test: frames 02 (title), 07 (sun + bridge), and 12 (silhouette finale) each hold up as standalone marketing stills.
