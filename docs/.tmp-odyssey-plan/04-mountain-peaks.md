# (Section file — assembled into docs/ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md)

## Chapter 4 — Mountains & Thin-Air Ascension

### Creative Vision & Player Feeling

The player should feel cold air in their teeth. Chapter 3 ended with the earth rising underfoot; Chapter 4 is the commitment — a deliberate climb along a ridgeline toward a mythic summit, with the valley world sinking into a silver cloud-sea below. The emotional beat is **awe edged with danger**: this is the first chapter where the world could hurt you. The reference grammar is the Alps and Himalaya at civil twilight — alpenglow physics, where only the highest snow holds the rose light while everything below has already fallen into blue shadow (the vertical color split IS the drama; see the alpenglow research note). Journey's final ascent is the tonal anchor: warm world behind, hostile blue-grey wind ahead, summit as release. By the last frames the player should believe the outro line — "at the summit, stone gives way to light" — because they watched the hero summit ignite rose-gold and then break above the clouds into the first true sky of Chapter 5.

### Hero Image & Composition

**The trailer frame:** camera low and tight on the rail as it threads the V-notch saddle; the lower-left foreground ridge-shoulder crests into frame as a crisp sunlit snow edge; a faded prayer-flag line cuts the lane diagonally just over the camera; beyond the notch, the central hero summit (the `mountain3` peak, size 1340 / height 720 in `createMountainPeaksEnvironment`) towers into the upper frame trailing a backlit spindrift banner plume, its crown rose-gold against the deep indigo zenith band, the warm sun disc low on the gilt horizon to the right, two eagles wheeling dark against the silver band.

- **Foreground framing (the missing tier):** the existing near ridge-shoulder (seed 71.5, lower-left, mostly below frame) must actually enter the frame as a hard, detailed snow cornice — plus near-camera matter that crosses the lens: a lung-ta prayer-flag line strung across the path, one or two cairn silhouettes beside rail nodes, and wind-streaked spindrift gusts sweeping through the camera plane.
- **Midground journey assets:** the rail (keep it — frames 05–21 prove it is the chapter's compositional spine) aimed permanently at the V-notch; the left/right framing peaks (`mountain1`/`mountain2`) overlapping the frame top with no breathing room so they read close; eagles crossing the lane; falling ice glints off the notch walls.
- **Background world scale:** the banded stratospheric sky from `createMountainSkyTSL` (gilt → silver → alpine → indigo), the on-screen sun disc, the cloud-sea deck below sealing off the valley (altitude every frame), one additional far range behind the heroes so atmospheric perspective has three ridge planes, and the aurora curtains strengthening only in the final act as the Chapter 5 tease.

### Screenshot Diagnosis

The capture set (`artifacts/odyssey/journey/Mountains & Thin-Air Ascension - 01..30.png`) predates or contradicts the de-wash wave already authored in the working tree (banded sky, three-zone snow, sun disc, cloud-sea deck, summit-glow climax all exist in `mountain-peaks.tsl.js`); the first action is a fresh desktop capture to confirm what landed. Against the frames as captured:

- **Frames 01–06 / 26–30:** the whole scene lives in one ~10% pale blue-grey luminance band; 26–30 are featureless lilac with a floating squiggle — ~17% of the chapter is dead footage.
- **Frames 01–04 (transition in):** leftover Chapter 3 foliage at the bottom edge, hard-edged translucent terrain/water cards clipping mid-frame, a straight-edged waterfall card vanishing by 05, and a mountain silhouette (single steep right peak) that does not match the V-notch that pops in at 05–07 — the reported "mountains change shape, waterfalls disappear."
- **Frames 07–18:** the strongest stretch (dark orb focal, V-notch framing, real ridge-plane separation) but one composition held ~12 frames with nothing happening, peaks one flat mid-light value, no snowline, no foreground tier; HUD camera distance ~30 throughout, so the notch barely grows — no approach, no intimacy.
- **Frames 19–25 (storm):** snow reads as blurry white blotches, not wind-driven flakes; 22–23 — the climactic notch crossing — blows out into a pure white bloom hotspot: the payoff frame is literally nothing.
- **Frames 24–30 (transition out):** terrain fractures into flat-shaded triangular facets, untextured polygon planes drift through fog, a clipped beige orb fragment pops at 29, and 30 teases nothing of Chapter 5.
- **Preserve:** the rail leading line, the V-notch skeleton, the fog narrative arc (hazy entry → clear middle → storm → summit exit) — over-applied, not wrong — and the existing snow particle system as a base to amplify.

### Art Direction Specification

**Value hierarchy (the core fix):** every frame must hold four readable bands — near-black shadowed rock `#0E1C30`–`#202F40` (`MOUNTAIN_PALETTE.shadowCool`/`rockCool`), ice-blue shadowed snow `#8FB4DC` (`snowShadowCool`), sunlit snow `#F4F8FF` (`snowCool`, just shy of white so ACES rolls it off), and the single warm accent: alpenglow rose `#F59478` plus sun core `#FFE3B0`/halo `#FFB27A`. Shadowed snow is **blue, never grey**. The snow line is a hard, high-contrast boundary (snowLine 0.46, snowBand 0.06, slope-gated bare-rock crags) — "snow-capped" must survive a grayscale screenshot.

**Sky:** the four-band dome (`uGilt #E6B483`, `uSilver #AAC6E0`, `uAlpine #3A6BA6`, `uZenith #132247`) with the aerosol-thinning darkening toward the zenith — the dome itself carries top-to-bottom contrast, so no frame can read as fog-test.

**Lighting:** one on-screen sun along `MOUNTAIN_LIGHT_DIR (0.7, 0.25, 0.4)`, low on the gilt band; key faces sunlit-warm, away-faces fall into the cool shadow bounce (shadowAmount 0.6, keyAmbient 0.18). The climax is scripted light: `uSummitGlow` rises 0.62→0.9 of local progress, igniting only the sun-facing crown of the hero peaks rose-gold (capped 0.7 added energy — controlled bloom, never the white blowout of frames 22–23).

**Silhouettes:** every hero must pass the flat-black-shape test against the silver band. The cultural props (flags, cairns, summit cross) are silhouette-first assets — readable shapes, near-zero interior detail.

**Motion language:** one persistent wind vector, left-to-right and slightly downhill, owns everything that moves — spindrift streaks, flag ripple, snowfall shear, eagle drift, banner plume. Motion is the pointer: the banner plume points at the summit; eagles arc toward the notch.

**Accent chroma (the only saturation in the chapter besides alpenglow):** sun-bleached lung-ta flags in traditional order — blue `#2E5FA3`, white `#F5F0E6`, red `#C0392B`, green `#2E7D4F`, yellow `#E3B428` — desaturated ~30% so they read weathered and authentic.

### Asset & Detail List

1. **Spindrift system (replaces "weak snow"):** rebuild the 1000-flake `createSnow` field as wind-sheared spindrift — billboards stretched along the wind vector (streaks, not dots), fall speed and streak length scaling with altitude so high motes whip jet-stream fast and valley motes drift, gust pulses on the storm beat. Port the motion math of `src/themes/himalayan-peak/sim/spindrift.js` (altitude-scaled wind, mod-wrapped span, sun-tinted crystals) but onto instanced billboard quads via `shared/odyssey-tsl-billboard.js` — its `PointsNodeMaterial` approach is banned on this renderer.
2. **Summit banner plume:** a single ribbon of layered, additive-free billboard streamers shedding off the lee (right) side of the hero summit crown, backlit rose at climax — the one Everest-scale danger signal, visible from progress ~0.3 onward.
3. **Prayer-flag line:** one catenary cord crossing the lane diagonally at roughly two-thirds chapter progress, 20–30 small flag quads vertex-rippled by the shared wind, faded lung-ta palette; technique reference `src/themes/himalayan-peak/rendering/prayer-flags.js`.
4. **Two cairns + one summit cross:** stacked-stone silhouettes (~3–5 m) placed within ~15 world units of the rail at the chapter's first and last thirds; a thin Gipfelkreuz silhouette on the hero summit crown — the destination landmark that resolves at climax. These are the chapter's human-scale cues; without them the mountains could be 10 m tall.
5. **Eagles:** two to three soaring raptors (not a flock), slotted-wingtip silhouettes `#0D0B09` with sun-warmed tips, crossing the lane every 9–22 seconds; port the shoulder-pivot vertex flap of `src/themes/himalayan-peak/rendering/peak-eagles.js` (single InstancedMesh, CPU flight path, banking roll).
6. **Far second range:** one additional foothill-language range behind the heroes (reuse `createFBMMountainTSL` with `FOOTHILL_APRON_TREATMENT`, heavier fog mix) so three ridge planes recede.
7. **Icy ledge glints:** sparse static glitter on the notch walls using the existing `snowSparkle` wind-streak term, brightened only within ~250 units of the camera so the close pass reveals detail.

### Transition In / Transition Out

**In (from Chapter 3, "forests rise into alpine ridges"):** the poetic transformation is *the horizon becoming the ground*. Chapter 3's distant range already uses the same `mountainCpuDisplacement` and `MOUNTAIN_PALETTE` via `shared/mountain-language.js` — enforce that the Ch3 horizon silhouettes ARE the Ch4 heroes (matching seeds/relative placement), so the mountains never change shape; the player approaches the very peaks they saw from the meadow. Chapter 3's waterfalls must not vanish: through the ecotone they hand off to frozen cascades and mist trails on the foothill skirt (the `mountainSkirtColorNode` meadow→rock ramp is the canvas), and every Ch3 terrain/water card must fade through a `uOpacity` uniform reachable by `_collectOpacityTargets` — the hard-edged clipping rectangles of frames 01–02 are cards the crossfade cannot reach. The cloud-sea deck rises into place via its `uReveal` hook so the camera breaks UP through the cloud ceiling — daylight shafts condensing into thin air.

**Out (to Chapter 5, "snow peaks dissolve into aurora"):** delete the lilac dead zone. The existing seam exit (`MOUNTAIN_SEAM_EXIT_BAND` 0.34 sinking the peaks 140 units beneath the cloud-sea while fading `uOpacity`) is the right mechanism — but the camera must be given something to inherit: as the peaks sink, the aurora curtains (`createMountainAuroraBackdrop`) brighten from preview to a faint readable arc — capped well below the authored [1.0, 0.95, 0.95, 0.7] full-strength opacities, because that arc is exactly the level Chapter 5's staged ramp inherits and builds from (faint arc at ~10%, hero by ~35%); a full-blaze exit here would make Ch5's entry read as a regression. And strictly no stars: the star billboards stay dark through the seam — stars remain Chapter 6's identity, and Chapter 5 opens starless. The final frames are summit-light dissolving into aurora — the literal first terrain of Chapter 5. Frame 30 must show the faint aurora arc and a hint of Ch5's cloud strata, never empty fog. The faceted-polygon pop at 24–28 is the seam crossfade failing to reach a material — audit every Ch4/Ch5 mesh for routed opacity.

### Technical Implementation Guidance

Order of work, all within the established contract (assets built in `createMountainPeaksEnvironment` / the `.tsl.js` builders, refs in `group.userData`, animation in `updateMountainPeaksEnvironment`, budgets from the quality preset):

1. **Verify the landed wave first.** Request one desktop capture; confirm the banded sky, three-zone snow, sun disc (`createMountainSunTSL`), cloud-sea deck (`createCloudSeaDeckTSL`), and `uSummitGlow` climax in `src/rendering/odyssey/chapter-environments/mountain-peaks.tsl.js` actually render as authored before adding anything.
2. **Camera intimacy** (`src/rendering/odyssey/OdysseyCameraController.js` + `ODYSSEY_CAMERA_PROFILES` / `CHAPTER_FRAMING_OVERRIDES` in `shared/chapter-profile.js`): author a Chapter 4 framing override that tightens camera distance through local progress 0.6–0.9 so the notch visibly grows, threads the saddle close to the left wall, and grazes the foreground cornice — the missing approach beat of frames 07–21.
3. **Spindrift, flags, cairns/cross, eagles, second range** as per the asset list — all instanced billboard quads or InstancedMesh built at create time in `mountain-peaks.js`, time-driven through shared TSL uniforms ticked in the update (mirror the existing `snowTimeUniform` pattern; zero per-frame allocation, no new lights — the ambient/moon/alpenFill rig is sufficient and already lives in the group).
4. **Bloom discipline:** only the sun disc/rays, summit-ignite crowns, and aurora carry `userData.emitsBloom`; flags, cairns, spindrift, and the sky must not. Climax energy stays capped (ignite ≤0.7, disc opacity ≤0.9) so frames 22–23 never blow out again.
5. **Seam audits:** route every new material's alpha through `uOpacity` and register it in `mountainOpacityUniformTargets` so the `MOUNTAIN_SEAM_EXIT_BAND` fade and the manager ecotone (`resolveChapterBlendState` in `ChapterEnvironmentManager.js`) reach it; align the 3→4 entry with the Ch3 side in `surface-world.js`/`surface-world.tsl.js` (waterfall/terrain card opacity routing, matching horizon-range seeds) and tune the `'3-4'` / `'4-5'` profiles in `transitions/ChapterThresholdDirector.js` to ride the wind language, not a hard veil.
6. **Grade, last:** only after value structure lands, nudge the Ch4 entry in `CHAPTER_SIGNATURES` (`odyssey-post/odyssey-tsl-pipeline.js`) for crisp cold contrast — never use tint to fake the de-wash (visual law).
7. **Prewarm:** any new group outside the chapter group needs `_prewarmGroup` compileAsync; everything above belongs inside the chapter group, so the existing `_prewarmChapterEnvironment` covers it.

### Acceptance Criteria

- A grayscale conversion of any frame between local progress 0.1 and 0.9 shows four distinct value bands (dark rock / shadowed snow / sunlit snow / sky), and the snowline is identifiable in every frame containing a peak.
- The notch-crossing payoff (formerly frames 22–23) shows readable rock-and-snow walls on both sides of the camera — no frame anywhere in the chapter is >50% pure white or featureless fog.
- At least one human-scale cue (flag line, cairn, or cross) is on screen for ≥60% of the chapter; the summit cross silhouette resolves against the sky at the climax.
- Snow visibly streaks with the wind in ≥80% of frames; the hero summit's banner plume is visible from mid-chapter and glows rose at climax.
- The Ch3→Ch4 boundary shows no clipping cards, no vanishing waterfall, no silhouette swap — the approached peaks match the Chapter 3 horizon.
- The final three frames of the chapter contain a faint aurora arc (at the entry intensity Chapter 5's ramp begins from) + a Ch5 cloud-strata tease, with no stars anywhere in the chapter — zero dead lilac frames.
- An eagle or flag motion accent appears at least every ~8 seconds of travel through the held middle composition.
- Draw calls stay within the chapter's current budget envelope (no regression past the perf plan's <100 target zone) and `__tests__/webgpu-tsl-build.test.js` stays green.
- **Trailer-frame test:** the hero composition (notch + foreground cornice + flag line + plumed summit + sun) passes as a marketing still with the HUD off — a stranger should say "Alps," not "fog test."
