## Chapter 1 — Earth Core & Subterranean Origins

### Creative Vision & Player Feeling

The player wakes inside the planet's furnace and should feel **enclosed, pressurized, and pulled forward by heat**. This is a cathedral carved by magma: a black basalt nave whose vaults are lost in smoke, whose floor is a living lava lake, and whose altar is a white-hot heart of the world burning at the far end of the corridor. The emotional beat is *wonder under pressure* — the first rhythm of the whole journey. Every frame should whisper "you are kilometers underground, and something ancient is glowing ahead." The quality bar is Pyrestorm (`src/themes/pyrestorm/`) crossed with God of War's Muspelheim staging: 70–90% of the frame in near-black charred rock, with molten light confined to flow channels and cracks so the glow reads as tracery, never wash ([arhfoundation.org/color-of-volcano-science](https://www.arhfoundation.org/color-of-volcano-science), [aenok.com Muspelheim breakdown](https://www.aenok.com/projects/o2nzbJ)).

### Hero Image & Composition

**The hero is "The First Heart"** — a distant white-hot caldera fissure (#ffe6b0 core, blooming) seated at the chapter's far end, dead on the rail's vanishing point. It is the chapter's Journey-mountain: visible from frame 01 as a tiny incandescent ember between black colonnades, growing across the whole descent until the lava-fall hero (`lava-fall-hero` group, x≈24/z≈−113) pours into it at the close-passage climax. One dominant focal per shot; everything else subordinated to it.

- **Foreground framing:** near-black hexagonal basalt columns and ceiling slabs bracket every frame edge (repoussoir), plus tiny sharp near-camera embers (existing `createNearCameraEmbers`) and drifting obsidian gravel shards as scale anchors. Foreground carries silhouette, never detail.
- **Midground journey assets:** the lava lake the camera looks across, the lava-fall ribbon, size-graded geode/boulder clusters seated ON the lake with contact decals, the mid-chapter selenite geode chamber, and the glowing path rail as the converging leading line.
- **Background world scale:** an enclosing cavern — the swirling red-brown vault treatment from frames 15–16 promoted chapter-wide on the background sphere, layered magma-horizon "far shore" bands, distant column strata fading into #3a0d04 haze, and the First Heart's glow silhouetting it all. Never deep space tinted red; always the inside of a planet.

### Screenshot Diagnosis

Confirmed against captures 01–19. **Preserve:** the fracture-plate magma material (05, 06, 12–14 — best silhouette in 14), the rail as leading line and its orange→cyan recolor in 17–19, the close-passage beats 05–07 and 12–14, ember columns (05, 08, 09), and the 15–16 nebula backdrop. **Fix, in priority order:** (1) the 08–11 dead zone (60–80% void, no focal; 10–11 read as debris artifacts) and the verbatim two-sphere repetition at 01–02 / 05–06 / 08–09 / 10–13 / 15–16; (2) no enclosing subterranean layer anywhere — promote the 15–16 treatment chapter-wide and kill the milky banded wash of 04; (3) the pure-black untextured cones in 01–05 and 08 need rim light and emissive veining; (4) frame 07's near-clip disintegration; (5) the 16→17 confetti pop, and the magma sphere bleeding into 17–19. Also: 01–02 and 10–11 are dead-time twins — the entry needs an event, the midpoint needs a beat.

### Art Direction Specification

**Palette — one blackbody ladder, no arbitrary lava colors.** Cooled crust #1a1410→#2b2420 with ash dusting #4a4540; first incandescence oxblood #5e0a00→#7a1500; cherry #b22000; flowing orange #ff6a00; bright #ffb04a; white-hot focal cores #ffe6b0 (the Heart, vein centers, lava-fall throat only). These map onto the live uniforms: lake `uColorHot` 0xff8a24 / `uColorMid` 0xb83208 / `uColorCool` 0x050206, fall `uHot` 0xffb45a, horizon `uHot` 0xff7a1e — keep them, but reserve a near-#ffe6b0 tier exclusively for the Heart so the hottest white belongs to one object. Cool counterpoints (<10% of any frame): the existing obsidian sheen `uColorReflect` 0x091022, plus new selenite crystal accents #bfe8f0 (backlit, translucent — Naica's Cave of Crystals, [en.wikipedia.org/wiki/Cave_of_the_Crystals](https://en.wikipedia.org/wiki/Cave_of_the_Crystals)) which quietly foreshadow Chapter 2's cyan.

**Value hierarchy — four bands, never binary.** (1) Near-black FG silhouettes #0d0604; (2) a NEW midtone band: ember-red atmospheric wash #3a0d04→#5e0a00 on cavern walls, haze, and horizon bands — this is the layer frames 09–13 are missing; (3) hot orange flow channels; (4) white-hot focal. The strongest light-dark edge always lives at the current focal (the Heart, or a passing geode).

**Lighting.** Keep the two-PointLight rig (`setupVolcanicLighting`: lava key 0xff5511, glow 0xff7722) and the baked-bounce model (`uBakedBounce`). All "new light" is authored emissive + fresnel, not lights: every black column gets a warm fresnel rim (pow-4, like Pyrestorm's `MOUNTAIN_FRAGMENT_SHADER` rim) keyed to the lake below, so silhouettes read as basalt, not placeholders.

**Silhouettes.** Hexagonal columnar jointing is the chapter's architectural signature — Fingal's Cave colonnades ([en.wikipedia.org/wiki/Fingal's_Cave](https://en.wikipedia.org/wiki/Fingal's_Cave)): clustered 5–7-sided prisms, stepped heights, every hero shape testable as a flat black thumbnail. Geode boulders keep their spiky fracture-plate silhouette (frame 14 is the reference).

**Materials & motion.** Ropy pahoehoe normal detail and a faint silvery-blue thin-film sheen on the freshest lake flows ([sandatlas.org/types-lava-flows](https://sandatlas.org/types-lava-flows/)); flow-map ping-pong motion per Pyrestorm's `LAVA_FRAGMENT_SHADER`. Motion language: everything rises (embers, smoke, heat shimmer) while the camera descends — one motion accent per shot, aimed at the focal.

### Asset & Detail List

1. **The First Heart (NEW hero):** white-hot fissure + caldera glow at chapter-end local t≈0.95, on the rail vanishing line, ~150 units past the last node; #ffe6b0 core ringed #ff6a00→#7a1500, slow 0.2 Hz breathing. Visible from frame 01.
2. **Lava-fall hero (existing, intensify):** keep the crossed-plane fall and splash decal; its throat picks up the #ffe6b0 tier as `uDescent`→1.
3. **Basalt colonnade walls (NEW):** 6–8 clustered hex-column groups per side, 55–90 units off-path, size-graded near→far (heights 60→160), continuous along the whole corridor — these are the cavern walls that fix the 08–13 emptiness and pay off the entry cones.
4. **Selenite geode chamber (NEW, mid-chapter beat at local t 0.42–0.60 — exactly the 08–11 dead zone):** a cracked geode "chapel" off the right of the rail: 5–9 translucent #bfe8f0 crystal beams jutting at conflicting angles, backlit by a molten pocket beneath, dark basalt shell framing them.
5. **Varied geode clusters (replace the two-sphere repetition):** expand the `createVolcanicRockClusters` seat table to 6–7 seats with small/medium/large grading (radii ~2/4/6), satellites of 3–5 small shards orbiting each large boulder, and thin ropy magma tether-streams (scaled-down lava-fall ribbons) connecting cluster members.
6. **Existing supporting cast (keep, tuned):** molten haze tube, magma-horizon far-shore bands aligned to the lake line, ember-storm columns, magma cloud deck/canopy, molten-pocket node shelves with contact decals, near-camera sharp embers; add a sparse near-camera gravel ring of 20–30 slow-tumbling obsidian shards for scale.

### Transition In / Transition Out

**In (journey start / encore loop):** the chapter must open with an event, not mid-void. Stage the first two seconds as a *breach of the crust*: the camera emerges through a tight black aperture formed by the two nearest colonnade brackets — compression — then the nave opens and the First Heart ignites at the vanishing point — release. If the journey loops from Chapter 8, the encore's neon afterimage cools through magenta-ember into oxblood #5e0a00 over the seam: city light becoming core light, the singularity's refraction collapsing back into pressure.

**Out (→ Chapter 2, "magma vents become hydrothermal glow"):** keep the rail's orange→cyan recolor — it is the spine of the hand-off — but choreograph matter transforming around it across the ecotone band rather than popping at 16→17. Ember columns thin and whiten into rising steam; the lake's hot veins quench to the silvery-blue pahoehoe sheen, then to teal; the selenite crystals brighten as the heat dies, becoming the first bioluminescent lights of the ocean. The `'1-2'` Steam Quench threshold (primary 0xff6a22 → secondary 0x58d8ff, particle 0xc7f4ff) plays as veils of steam, not confetti. The hero geode boulders sink to the lake and fade via their opacity plumbing so **no magma sphere survives past frame 18** — by then Chapter 2's descending light shafts own the frame.

### Technical Implementation Guidance

All work follows the create/userData/update contract in `src/rendering/odyssey/chapter-environments/earth-core.js` with material builders in `earth-core.tsl.js`; instanced billboards only for particles (`shared/odyssey-tsl-billboard.js`); TSL noise from `shared/odyssey-tsl-noise.js`; emissives authored ≥0.85 for selective bloom, capped ~0.9.

1. **First Heart:** new builder in `earth-core.tsl.js` reusing the `createMagmaHorizonTSL` band language plus a tight white-hot core (ramped through the `moltenRockField` palette); mount in `createEarthCoreEnvironment`, ref in `group.userData`, breathing driven from `uTime`/`uDescent` in `updateEarthCoreEnvironment`. Flag `userData.emitsBloom`.
2. **Colonnades:** instance `createObsidianColumnTSL` (or a hex-prism variant of `createMoltenPocketMaterialTSL`'s `isColumn` path) in merged clusters to respect the <100 draw-call budget; extend `bracketTs` beyond [0.18, 0.62] (add ~0.85) so the bracket rhythm spans the descent.
3. **Light the black cones:** in `createMoltenPocketMaterialTSL` (`isColumn` true), raise the fresnel rim term and add fbm-traced emissive veining (warm `uHot` 0xcc4400 tier), scaled by `uBakedBounce` and lake-distance falloff (the existing `baseBleed` smoothstep). No new lights (QW4/QW9).
4. **Dead-zone beat:** geode chamber + expanded seat table in `createVolcanicRockClusters`; raise the cluster cap (currently min(…, 2)) under the quality-preset particle budget; tether-streams reuse `createLavaFallTSL` at thin scales.
5. **Frame-07 near-clip:** enforce a minimum radial clearance from the spline (sample `getOdysseyPathPointAt` at placement time) for any asset radius > ~4 units, and add a camera-proximity opacity fade in the geode material (positionWorld-based node, routed through `uOpacity` so the ecotone crossfade still reaches it).
6. **Enclosure:** rework `createVolcanoBackgroundTSL` to the 15–16 swirling treatment using `ridged3`/`fbm3` — dimensional red-brown convection, no banding, never >50% void; fog stays owned by `ChapterEnvironmentManager.updateGlobalEnvironment` per `chapter-profile.js` (fog 0x2d1500, density 0.014).
7. **Seam:** author the geode sink-and-fade + ember→steam swap against `resolveChapterBlendState` ecotone weights; widen the pre-roll of the `'1-2'` threshold profile in `transitions/ChapterThresholdDirector.js` rather than adding particles at the crossing. Grain note: fix 09–11 by adding the midtone band, not by grading; only then consider a small ch1 grain reduction in `CHAPTER_SIGNATURES`.
8. **Prewarm:** new geometry rides the existing chapter group, covered by `_prewarmChapterEnvironment` + the journey replay warmup; verify `__tests__/webgpu-tsl-build.test.js` stays green.

### Acceptance Criteria

- The First Heart is identifiable in frame 01 and continuously across the descent; no frame between entry and seam lacks a single dominant focal.
- Frames equivalent to 08–11 contain the geode chamber and colonnade walls; no frame is >50% void; grayscale check shows four value bands.
- No two consecutive encounter compositions repeat the small-left/large-right sphere arrangement; clusters show small/medium/large grading with satellites and tethers.
- Every column/cone silhouette shows a readable warm rim or vein — zero pure-black untextured shapes.
- No close passage decomposes into flat planes (frame-07 class failure eliminated).
- The out-transition shows ember→steam and orange→cyan transformation across multiple frames with no single-frame pop; no magma boulder visible by the frame-18 equivalent.
- White-hot #ffe6b0 appears only on the Heart, vein cores, and the fall throat; bloom stays selective.
- Draw calls remain <100 in-chapter; no new PointLights; tests green.
- Trailer-frame test: the entry breach reveal, the lava-fall close passage, the geode chapel, and the Heart approach each hold as a standalone trailer still.
