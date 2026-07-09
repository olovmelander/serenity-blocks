# Odyssey Journey — Creative Implementation Plan

**Status:** Production plan, June 2026. Authored from a frame-by-frame review of the full 201-frame journey capture set (`artifacts/odyssey/journey/`), the Odyssey rendering source, the seven in-repo reference themes, and external research into AAA environment art direction. This is the creative authority for the next visual wave of Odyssey Journey. It builds on and, where stated, supersedes the prior planning documents (see *Constraints & Prior-Plan Alignment* below).

## How to Use This Document

The eight chapter sections are self-contained work orders: each carries its own screenshot diagnosis, art direction specification, asset list, transition contract, technical guidance, and acceptance criteria. The global sections — this front matter and the *Seam Atlas*, *Roadmap*, *Risks*, *Validation*, and *Non-Goals* at the end — define the law that every chapter obeys. A follow-up coding agent should read the global sections once, then execute chapter sections in roadmap order. This plan contains no code by design; every directive names the file, system, builder, or uniform it lands in, and the implementation lives with the engineer.

## Creative Vision — One Continuous Ascent

Odyssey Journey is one playable cinematic shot: a rail ascent from the planet's molten heart to the dissolution of physics, and one encore after the curtain. The game's own narrative copy already promises this arc — "the journey begins deep within the Earth's core… pressure surrounds you, but crystal light shows the way," rising chapter by chapter until "beyond the singularity, physical reality dissolves," and finally "the city fades like an afterimage." The visuals must keep that promise frame by frame.

The escalating visual language is **pressure → flow → life → altitude → atmosphere → void → transcendence → encore**. Each chapter is distinct — no two chapters share a dominant hue — but each inherits matter and light from its neighbor, transformed rather than swapped: magma vents become hydrothermal glow, ocean caustics become daylight shafts, forests rise into alpine ridges, snow peaks dissolve into aurora, aurora stretches into nebula, nebula collapses into the black hole, and the singularity refracts into neon city light.

The bar for every single frame is the **trailer-frame test**: any capture, cropped without HUD, should hold up as marketing art — one dominant focal point, a readable value structure, three layers of depth, and a sense of scale. The capture review below shows how far each chapter currently is from that bar, and the chapter sections specify exactly how each one gets there.

## Research Foundation

The direction in this plan is grounded in verified, cross-sourced principles from AAA environment art practice — primarily the GDC/SIGGRAPH record of Journey, Firewatch, Ghost of Tsushima, God of War, Ori, and Sky: Children of the Light, plus film color-script practice. The rules below are enforced throughout the chapter sections:

1. **One dominant focal point per shot — never two.** Everything else is deliberately subordinated; competing focals read as noise. *(Piaskiewicz, "Composition in Level Design"; Level Design Book.)*
2. **Build value structure before color.** Each scene blocks as 2–4 distinct value bands; the strongest light–dark edge is reserved for the focal. A scene that reads in grayscale reads in any palette. *(Blevins; environment-art composition guides.)*
3. **Stage explicit foreground / midground / background.** FG = dark near-silhouette framing, no detail; MG = the focal plane carrying maximum detail, saturation, motion; BG = value-compressed, desaturated, atmosphere-tinted. *(Blevins; Ori GDC art talks; Jane Ng, Firewatch GDC 2016.)*
4. **Color-script the whole journey.** Adjacent chapters must contrast (warm→cool, dark→light, dense→open) or the arc doesn't read. *(Pixar colorscript practice; Firewatch.)* The color script master table below is that script.
5. **Atmospheric perspective is the primary depth and mood tool.** Tint haze to the chapter palette; desaturate and lift with distance. *(Jasmin Patry, "Real-Time Samurai Cinema," SIGGRAPH 2021.)*
6. **A rail camera means directing film.** Compose held shots: focals on thirds, leading lines converging, foreground framing — the camera path is known, so cheat geometry for the frame, not the map. *(God of War Ragnarök vista breakdowns; Ori.)*
7. **Players look where they're moving and rarely up.** Critical focals live near the travel vector; upward reveals are earned with light, motion, or a vertical line first.
8. **Silhouette-first asset design.** Every hero structure must read as a flat black shape against its background before it earns detail.
9. **Keep one persistent destination landmark per chapter.** Journey's glowing mountain is the canon: a visible destination orients, motivates, and stitches the journey. *(Matt Nava, "The Art of Journey," GDC 2013.)* Every chapter section names its landmark.
10. **Figure-ground: the traveler is the accent.** The marble/avatar must hold a readable silhouette in every frame; environments spend saturation where attention should go.
11. **Motion outranks static contrast.** One motion accent per shot, aimed at the focal — wind, birds, particles, folds.
12. **Pace by compression and release, and let shots breathe.** Alternate narrow/dark passages with open vista reveals; hold key compositions long enough to land. *(Nava; Tanabe, "Art of Sky," GDC 2020.)*

Key sources: [The Art of Journey (GDC)](https://gdcvault.com/play/1017799/The-Art-of) · [Making the World of Firewatch (GDC 2016)](https://www.gdcvault.com/play/1023191/Making-the-World-of) · [Real-Time Samurai Cinema (SIGGRAPH 2021)](https://www.glowybits.com/talks/real-time_samurai_cinema/real-time_samurai_cinema.pdf) · [Composition in Level Design](https://www.gamedeveloper.com/design/composition-in-level-design) · [Art of Sky: Children of the Light (GDC 2020)](https://gdcvault.com/play/1026903/Art-of-Sky-Children-of) · [FG/MG/BG (Neil Blevins)](http://www.neilblevins.com/art_lessons/composition_fore_mid_back/composition_fore_mid_back.htm) · [What is a Color Script (StudioBinder)](https://www.studiobinder.com/blog/what-is-a-color-script-definition/)

Chapter-specific reference research (lava color physics, bioluminescence staging, alpenglow, aurora spectra, nebula palettes, Gargantua lensing, synthwave canon) is cited inline in each chapter section where it directly shaped the direction.

## What the 201-Frame Review Found

Every chapter was reviewed frame by frame against the capture set. Full diagnoses with frame references live in the chapter sections; the journey-wide patterns are what this plan is built to kill:

1. **Dead middles, strong bookends.** Almost every chapter opens and closes better than it travels: Ch1 frames 08–11, Ch2 frames 03–15 (60% of the chapter), Ch5 frames 14–18, Ch6 frames 16–26, Ch7 frames 07–23 (a 17-frame void), and Ch8 frames 06–10 are stretches with no focal point, no event, and no compositional development. The fix is never "more stuff" — it is a destination landmark on the travel vector plus one authored midground beat per dead zone.
2. **Collapsed value ranges.** Ch3, Ch4, and Ch5 each live inside a single pale luminance band (pastel haze, blue-grey fog, lavender wash); Ch8 is bi-modal salt-and-pepper. The additive-wash failure is proven by capture: additive curtains and particles over a bright field desaturate to white smears. Every chapter now carries an explicit value-band specification and a dark backstop.
3. **No hero focal points.** The capture sets confirm hero assets either don't exist (Ch1's destination, Ch2's midground life, Ch4's summit identity), don't read (Ch7's camera-locked singularity, Ch8's existing synthwave sun — authored in code, absent on screen), or sit off the travel vector (Ch6's black hole drifting away from the rail's vanishing point).
4. **Missing foreground tier.** Almost no chapter has near-camera matter framing the shot. The chapter sections each add a cheap FG layer (colonnade brackets, near plankton bokeh, pass-by silhouettes, spindrift, dark wisps, dust motes, rain).
5. **Transition pops and artifacts.** Measured single-frame discontinuities at nearly every seam: Ch1's 16→17 confetti pop, Ch2's vanishing core sphere, Ch3's slab pop-in and whiteout exit, Ch4's clipping cards and faceted morphs, Ch6's 07→08 luminance crash and 28→29 moiré burial, Ch7's measured ~1002 ms 6→7 seam hitch, Ch8's dead frame 11. The *Seam Atlas* at the end of this plan is the unified fix.

Per-chapter, in one line each: **Ch1** recycles one two-sphere composition five times along an empty corridor with no destination. **Ch2** has its life strung as unreadable specks on the rail inside a uniform cyan particle soup. **Ch3** is washed pastel with invisible water, square-sprite flora, and 65–75% empty sky. **Ch4** is one V-notch composition held for ~12 frames in a single blue-grey band, with a third of the run in featureless fog. **Ch5** is a lavender void for 22 of 29 frames with a colorless aurora arriving in the last third. **Ch6** has a genuinely strong crimson nebula body bookended by two broken transitions and an empty midground. **Ch7** is a barbell: gorgeous disk entry and tunnel exit bridging 17 frames of near-pure black. **Ch8** opens strong, then stares into a black void band where its authored sun never lands on screen.

What already works — and is explicitly protected by acceptance criteria: Ch1's fracture-plate magma material and rail leading line, Ch2's caustic-ceiling finale, Ch3's seasonal arc concept, Ch4's V-notch rail spine and fog narrative, Ch5's 26–29 portal, Ch6's Blood-Moon-grade crimson nebula, Ch7's accretion entry and transcendence tunnel, Ch8's vortex intro and palette DNA.

## Global Art Direction Law

These rules bind every chapter section; they restate the product mandate plus the research above as enforceable law:

- Each chapter has **one hero focal point** (its destination landmark), a readable path, and **three layers of depth** — foreground framing, midground journey assets, background world scale.
- **No empty fog fields, washed colors, isolated props, tiny unreadable assets, or abrupt visual pops.** No frame more than 50% void (black or white). Every frame passes a grayscale value-band check.
- **Transitions are poetic transformations of matter and light, never hard swaps** — the Seam Atlas defines every handoff, and both sides of each seam quote the same carried elements and colors.
- **One escalating language** connects distinct chapters: pressure, flow, life, altitude, atmosphere, void, transcendence, encore.
- **Fix weak frames with value structure, never with per-chapter grade tints** (standing visual-cohesion law). Emissives are authored against the 0.85 selective-bloom threshold and capped below 1.0.
- **Every screenshot is a potential trailer frame.**

### Color Script Master Table

| Ch | World | Dominant palette | Value key | Hero / destination landmark | Signature motion |
|----|-------|------------------|-----------|------------------------------|------------------|
| 1 | Earth Core | Blackbody ladder #1a1410 → #ff6a00 → #ffe6b0 on near-black basalt; selenite #bfe8f0 accent | 70–90% near-black; glow as tracery | "The First Heart" white-hot caldera on the vanishing point | Everything rises: embers, smoke, heat shimmer |
| 2 | Deep Ocean | Depth ladder #04101f → #10325a → #149aae; bio cyan #2ef0ff; jelly magenta accent | Darker before lighter; dark floor every frame | Manta trio crossings; the nacreous Pearl Gate | One global current, diagonally up-corridor |
| 3 | Surface World | Azure #1452B8/#2F86D8 sky, gold horizon #F0B878, saturated greens, blue-green water | Restored darks: near-black FG pass-bys, dark shoreline | River sun-glitter leading to the Great Tree | Wind: petals, leaves, birds, grass |
| 4 | Mountains | Rock #202F40, shadowed snow #8FB4DC, sunlit snow #F4F8FF, alpenglow #F59478 | Four bands; hard high-contrast snowline | Hero summit with Gipfelkreuz and backlit banner plume | Wind-sheared spindrift, flag ripple, eagles |
| 5 | Sky Drift | Scripted dusk #FFCCA3 → #1B2A6B → #0E1430; aurora #FF5FB0 hem / #3DFF8E body / #C71F37 caps | Dark backstop by mid-chapter; no stars | Aurora arch → zenith corona; the portal | Aurora folds racing 10× faster than drift |
| 6 | Space | Vacuum #020208; crimson nebula #E8485C; disk gold #FFF0C4/#FF5A14 | 70/25/5 dark/mid/hot; crispest chapter | Black hole riding the rail's vanishing point | Inward: debris and filaments stream toward the hole |
| 7 | Black Hole | Violet floor #120A21; disk #FFF4CF → #FF2EA8 → #3AA0FF; ring gold #FFF0C2 | 70/20/10; photon ring is the strongest edge | Camera-locked lensed singularity with over/under fold arcs | Everything falls inward; tunnel rotates |
| 8 | Urban Dreams | Sun #FEF65B/#FD8A26/#FF5ACD; cyan #00F2FF path; magenta #FF3FB4 city; indigo #0C0818 | Four bands; sun limb vs. skyline silhouette | Scanline Retrosun behind a near-black skyline | Light trails converging on the sun |

## Constraints & Prior-Plan Alignment

**Rendering constraints in force** (verified in code; every chapter section respects them):

1. WebGPU `three/webgpu` + TSL `NodeMaterial` only — one codebase with the WebGL2 fallback backend. New visuals go in each chapter's `create*` (built from `.tsl.js` builders), refs in `group.userData`, animation in `update*`, within the quality-preset budgets passed into `create`.
2. All sized particles are instanced billboard quads (`shared/odyssey-tsl-billboard.js`) — never `THREE.Points`.
3. Every fading material routes through `material.opacity` or a `uOpacity` uniform reachable by the ecotone crossfade (or authors its own seam exit); `.transparent` is never flipped at runtime.
4. Lights exist inside the chapter group at create time (persistent light rig; intensity rewritten every update); changing the active light set at a seam causes recompile hitches.
5. Zero per-frame allocation; new non-chapter groups need explicit compileAsync prewarm (the whole-journey replay warmup covers chapter groups).
6. Atmosphere, fog, and grade are owned by the director, manager, and post pipeline — chapters never write `scene.fog` or clear color.
7. Bloom is selective and threshold-based (≥0.85 via `userData.emitsBloom`); skies and atmosphere never bloom.
8. Performance budgets: 60 fps, seam hitch ≤33 ms, draw calls <100 target in-chapter, additive overdraw ≤~3 layers, particle counts riding the Minimal→Extreme presets and the adaptive-quality ladder.

**Verification constraint:** the WebGPU board cannot be screenshot headless. All visual work is batched per wave, then verified with **one** user desktop capture per wave (see *Validation*).

**This plan supersedes / resolves:**

- The master plan's `SeamDirector` + seven cinematic seam archetypes stay retired; the implemented **ecotone / carried-element model wins**, and the Seam Atlas is authored entirely in that model.
- Chapter 7 vignette stays at **1.05** (the 1.35 figure is superseded — it crushes the void).
- **One ACES master curve** stays; no AgX switch.
- GPU compute-particle ambitions stay deferred; all new density rides instanced budgets and the adaptive ladder.
- Chapter 5's "ever-present aurora from frame one" stance and its "uniformly bright hazy daytime" identity are **superseded** by the staged dusk script in the Chapter 5 section — the capture proves additive curtains over a bright field wash to lilac.
- The chapter-by-chapter improvement plan remains the closest prior authority; where a chapter section refines it (Ch2's manta-hero promotion, Ch6's rail-aligned hero march, Ch8's sun-visibility-first ordering), the section says so explicitly.

---

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

**The lake must keep the legacy floor's molten-sea vitality.** The original additive lava floor (the pre-lake `createLavaFloor`, still visible on the deployed build) had a character players love and the opaque lake must not lose: rolling incandescent swells directly under the camera, bright yellow-white veins (#ffffaa cores over #ff6600 flows) snaking through a turbulent temperature field, pulse-driven hot spots, and a radiant under-glow halo that made the whole sea feel alive. The lake keeps its opaque, depth-writing foundation — that is what fixed the chapter's value structure — but inherits those reads as its **hot state**: full vein-and-swell energy concentrated in designated molten basins along the camera corridor, dark crust and glowing tracery everywhere else, so the sea roils where the player is looking without regressing the four-band value ladder.

### Asset & Detail List

1. **The First Heart (NEW hero):** white-hot fissure + caldera glow at chapter-end local t≈0.95, on the rail vanishing line, ~150 units past the last node; #ffe6b0 core ringed #ff6a00→#7a1500, slow 0.2 Hz breathing. Visible from frame 01.
2. **Lava-fall hero (existing, intensify):** keep the crossed-plane fall and splash decal; its throat picks up the #ffe6b0 tier as `uDescent`→1.
3. **Basalt colonnade walls (NEW):** 6–8 clustered hex-column groups per side, 55–90 units off-path, size-graded near→far (heights 60→160), continuous along the whole corridor — these are the cavern walls that fix the 08–13 emptiness and pay off the entry cones.
4. **Selenite geode chamber (NEW, mid-chapter beat at local t 0.42–0.60 — exactly the 08–11 dead zone):** a cracked geode "chapel" off the right of the rail: 5–9 translucent #bfe8f0 crystal beams jutting at conflicting angles, backlit by a molten pocket beneath, dark basalt shell framing them.
5. **Varied geode clusters (replace the two-sphere repetition):** expand the `createVolcanicRockClusters` seat table to 6–7 seats with small/medium/large grading (radii ~2/4/6), satellites of 3–5 small shards orbiting each large boulder, and thin ropy magma tether-streams (scaled-down lava-fall ribbons) connecting cluster members.
6. **Existing supporting cast (keep, tuned):** molten haze tube, magma-horizon far-shore bands aligned to the lake line, ember-storm columns, magma cloud deck/canopy, molten-pocket node shelves with contact decals, near-camera sharp embers; add a sparse near-camera gravel ring of 20–30 slow-tumbling obsidian shards for scale.
7. **The molten sea (legacy-floor revival, on the lake):** two or three bright molten basins along the rail where the lake's swell amplitude rises and the legacy vein/hot-spot language returns at full energy — the camera passes low enough that roiling, yellow-white-veined lava fills the lower quarter of frame ("lava surf" beats, one of them doubling as the entry event under the breach). Inside the basins the under-lake corona glow brightens back toward its legacy radiance; outside them it stays dim and the dark crust owns the surface.

### Transition In / Transition Out

**In (journey start / encore loop):** the chapter must open with an event, not mid-void. Stage the first two seconds as a *breach of the crust*: the camera emerges through a tight black aperture formed by the two nearest colonnade brackets — compression — then the nave opens and the First Heart ignites at the vanishing point — release. If the journey loops from Chapter 8, the encore's neon afterimage cools through magenta-ember into oxblood #5e0a00 over the seam: city light becoming core light, the singularity's refraction collapsing back into pressure.

**Out (→ Chapter 2, "magma vents become hydrothermal glow"):** keep the rail's orange→cyan recolor — it is the spine of the hand-off — but choreograph matter transforming around it across the ecotone band rather than popping at 16→17. Ember columns thin and whiten into rising steam; the lake's hot veins quench to the silvery-blue pahoehoe sheen, then to teal; the selenite crystals brighten as the heat dies, becoming the first bioluminescent lights of the ocean. The `'1-2'` Steam Quench threshold (primary 0xff6a22 → secondary 0x58d8ff, particle 0xc7f4ff) plays as veils of steam, not confetti. The hero geode boulders sink to the lake and fade via their opacity plumbing so **no magma sphere survives past frame 18**. The First Heart is the last emissive to dim: as the waterline rises it walks back down the blackbody ladder — #ffe6b0 white surrendering to #ff6a00 orange, then to oxblood #7a1500 — until only a drowned ember remains, refracted and wobbling beneath the camera. That submerged afterglow is the very "hydrothermal vent glow" Chapter 2 inherits at its entry, so both chapters describe one continuous light source. The boundary itself belongs to Chapter 2's abyssal twilight: dark water, sparse first god-rays, the Heart's amber memory below — heat does not hand off to brightness, it hands off to depth.

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
9. **Molten-sea revival:** in `createLavaLakeTSL`, raise the swell displacement and restore the legacy floor's surface language — yellow-white vein cores (#ffffaa, the legacy `uColorHot`) over #ff6600 flows and pulsing hot spots (the original `createLavaFloor` shader in git history is the reference: layered FBM temperature field, `smoothstep`-gated vein term, pow-3 pulse spots, `uPulseIntensity`-reactive) — gated by a basin mask sampled along the rail so full energy lives only in the designated molten basins and the dark-crust value structure survives everywhere else. Inside basins, ease the under-lake corona sprites back from today's 0.18/0.28 toward their legacy 0.35/0.5 opacities. Bloom discipline holds: vein cores may cross the 0.85 threshold (they are sanctioned "vein centers" in the palette law), but basin glow stays below the Heart's white-hot tier so the destination still wins the frame.

### Acceptance Criteria

- The First Heart is identifiable in frame 01 and continuously across the descent; no frame between entry and seam lacks a single dominant focal.
- Frames equivalent to 08–11 contain the geode chamber and colonnade walls; no frame is >50% void; grayscale check shows four value bands.
- No two consecutive encounter compositions repeat the small-left/large-right sphere arrangement; clusters show small/medium/large grading with satellites and tethers.
- Every column/cone silhouette shows a readable warm rim or vein — zero pure-black untextured shapes.
- No close passage decomposes into flat planes (frame-07 class failure eliminated).
- The out-transition shows ember→steam and orange→cyan transformation across multiple frames with no single-frame pop; no magma boulder visible by the frame-18 equivalent.
- White-hot #ffe6b0 appears only on the Heart, vein cores, and the fall throat; bloom stays selective.
- Draw calls remain <100 in-chapter; no new PointLights; tests green.
- At least two captures show a "lava surf" beat: the molten sea filling the lower quarter of frame with rolling swells and yellow-white veins at legacy-floor energy — the lake reads as a living sea, not a static plane — while frames outside the basins keep the unchanged dark-crust value ladder.
- Trailer-frame test: the entry breach reveal, a lava-surf basin pass, the lava-fall close passage, the geode chapel, and the Heart approach each hold as a standalone trailer still.

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

## Chapter 3 — Surface World & Living Landscapes

### Creative Vision & Player Feeling
This is the journey's first inhale. Two chapters of pressure — molten dark, then deep water — resolve into daylight, and the player must physically feel the release: lungs filling, color returning, the world suddenly *fertile*. The emotional reference is Sky: Children of the Light's Daylight Prairie threshold (https://gdcvault.com/play/1026903/Art-of-Sky-Children-of) — breaking through a layer into an overexposed-with-life meadow where light itself is the subject — married to Kazuo Oga's warm-olive Ghibli greens (https://animationobsessive.substack.com/p/what-kazuo-oga-thinks-about-when) and Ghost of Tsushima's single-species flower drifts (https://www.tokyoweekender.com/art_and_culture/what-sets-ghost-of-tsushima-apart-from-the-rest/). The chapter's subtitle is "Learn the seasons": the existing spring→autumn→winter arc is the story, and the *light itself* must age with it — golden and green at the breach, amber and long-shadowed in autumn, blue-pale and hushed at the snow line. The player should arrive breathless and leave wistful, already climbing.

### Hero Image & Composition
The held trailer frame is the mid-chapter golden-hour valley: camera on the rail looking down the length of the river.

- **Foreground framing (currently absent — build it):** dark, near-silhouette grass heads, reed plumes, and one overhanging branch sweeping past at 2–6 units from the lens, sitting at the darkest value in frame (#0E1F12 range). These give the rail ride speed, intimacy, and the dark anchor the pastels need (Blevins FG/MG/BG: http://www.neilblevins.com/art_lessons/composition_fore_mid_back/composition_fore_mid_back.htm).
- **Midground journey assets (the focal plane):** the Great Tree on its knoll left of the path (it exists at x 40 / z −260 in `surface-world.tsl.js` — it must triple in visual presence), the blue-green river carrying a broken gold glitter column from lower-left into frame center, single-species flower drifts following the terrain contours, and the falu-red cabin at the treeline as the human-scale cue. The river is the leading line; it converges on the Great Tree.
- **Background world scale:** three bands of hills losing saturation and hue with distance — full green #6FA84A, sage #8FA77E, blue-violet haze #9DB4C9 (the BotW gouache model, https://www.thumbsticks.com/gdc17-designing-zelda-breath-of-the-wild/) — beneath the existing distant snow range, which must be faintly present from mid-chapter onward as the Journey-style destination landmark for Chapter 4, not a frame-26 surprise.

One dominant focal point per held shot: Great Tree beat, then waterfall beat, then cabin/treeline beat, then the rising range.

### Screenshot Diagnosis
From `artifacts/odyssey/journey/Surface World & Living Landscapes - NN.png`: the value hierarchy is collapsed — frames 03–04 and 26–30 approach blank fields, trees sit at ground value (07, 08, 18), and nothing in any frame is darker than mid-grey except the unreadable avatar (05–13). The water plane in 01, 02, 04, 07, 13 has no blue, no specular, no shoreline — invisible as water. Trees are identical pale-mint cones (14, 15, 18, 19); autumn leaves read as crisp orange rectangles (16, 17, 20). No foreground layer exists in any frame; 06–09 are near-duplicates with no parallax. The saturated terrain slab pops on the right edge of 01–02 with a pink streak artifact at 02; the exit ghosts in translucent cubes (28–29) and dies in near-whiteout (30); the pod is cut by the frame edge at 26. Preserve and amplify: the seasonal arc (01–12 green, 13–20 autumn, 22–25 snow), the bird silhouettes (04, 05, 10, 21, 24, 25), the god rays (06–09, 14–20), the spiral contrail (21, 25, 27), and the ring motif bookends (01, 27–30).

### Art Direction Specification
**Palette anchors.** Sky: zenith #1452B8 → mid azure #2F86D8 → warm horizon #F0B878 (already authored in `createSkyBackgroundTSL` — keep). Sun core #FFE6A8, halo #FFC26A. Water: deep teal toe #0E7A96 → shallow aqua #46D8C8, sun-path gold #FFD27A widening to #FFD98A near the glitter column (golden-hour water carries two colors at once — body blue-green in troughs, sky gold on sun-facing facets). Foliage: sunlit spring green #42C32A, shaded forest #0D3A16, olive Oga-green #7C8A3F for meadows, near-black anchor #0E1F12 for FG silhouettes. Autumn: gold #E8B04A, amber #CF7A3A, rust #B0502E. Winter: snow #F2F7FF with blue shadow #9FB0C2 (never grey). Cabin: falu red #8B2F26, trim #F3EFE4. Accent flora drifts: white meadow-flower #F5F0E2, lupine violet #7A6BC8 — one species per drift, Tsushima-style mass.

**Value hierarchy.** Three bands enforced in grayscale: FG silhouettes 10–20% value; midground focal plane 35–65% carrying all detail and saturation; background 70–85%, hue-shifted toward haze blue. The strongest light–dark edge in every held shot belongs to the focal (Great Tree crown against sky; gold sun-path against teal water). The current fog lift is the enemy: pull `fogDensity` down ~40% and let the dark FG do the luminosity work.

**Lighting by season.** One low raking warm key (the B5 rig exists: directional #FFCF7A from the left) — but the season must move it: spring/summer key #FFCF7A at 0.7 intensity with cool sky-fill #ACC6E6; autumn warms to #FFB070 and lengthens the fake long-shadow banding; winter cools the key to #DCE8FF at 0.55, cools the sky-dome bands toward #B4BBDD lavender (the himalayan-peak dawn pole, `src/themes/himalayan-peak/`), and thins the god rays. Season changes must read as *light* changes, not prop swaps.

**Silhouettes & materials.** Every tree must pass the flat-black-shape test: mix two species — the existing stacked-cone deciduous and a spruce built like swedish-forest's 5-overlapping-cone merge (`src/themes/swedish-forest/swedish-forest-theme.js`, createMergedSpruceGeometry) — with 2.5× size variation and clustered placement, never uniform stamping. Canopies get the sakura-twilight volumetric crown gradient (shadow underbelly → lit crown → highlight, `src/themes/sakura-twilight/sakura-twilight-theme.js` setupSharedCanopyMaterial) so each tree has a glowing top and dark belly.

**Motion language.** One persistent breeze direction (Tsushima's wind-as-character) drives grass sway, petal drift, and leaf fall toward the focal. Birds are the alive signal: keep the circling flock, add one or two low fast crossers near the path. Particles by season: sakura petals (spring), amber pollen + dusk fireflies #FFAA44 (summer), tumbling leaves (autumn), slow snow motes (winter) — never two particle stories at once.

### Asset & Detail List
1. **Great Tree** (exists, `createGreatTreeTSL`) — upscale crown ~1.6×, add crown gradient + denser leaf-fall halo; sits left of path at the first held beat (~30% through the chapter corridor).
2. **Tiered waterfall + plunge pool** (exists, `createWaterfallTSL` at x −64 / z −480) — second beat; brighten ribbon crests toward #E8E2D0 so it blooms gently and reads from 200 units.
3. **Falu-red cabin** (new) — 6–8 units tall with white trim and a single smoke wisp, at the treeline right of path mid-corridor; this is the scale cue the reviewer flagged at frames 12–13, promoted from hazed speck to landmark.
4. **River/lake** (exists, `createOceanSurfaceTSL`) — must visibly wind from lower-left under the path; dark wet-sand shoreline band where terrain meets water.
5. **Mixed tree stands** — spruce clusters + deciduous drifts replacing uniform cones; one mid-distance tree line (exists) cooled for aerial perspective.
6. **Flower drifts** — two single-species swathes (white, then lupine violet) hugging terrain contours within 40 units of the path.
7. **Foreground pass-by layer** (new) — dark grass heads/reeds/branch silhouettes flanking the spline the full chapter length.
8. **Birds** — existing circlers plus low crossers at height 8–14 crossing the corridor; golden-warm wingtip catch.
9. **Seasonal particles** — petals, pollen/fireflies, leaves (leaf-shaped alpha, not squares), snow motes.
10. **Distant range + aurora preview** (exist) — visible earlier, faint, as the destination landmark.

### Transition In / Transition Out
**In (from Chapter 2):** ocean caustics become daylight shafts. The Surface Breach threshold (`ODYSSEY_THRESHOLD_PROFILES['2-3']`: cyan #4BD6FF → warm cream #FFF1B8, white spray particles) is the right poetry — water light tilting upward into sun shafts as the camera breaks the surface. Fix the two artifacts: the saturated terrain slab popping at frames 01–02 (the landscape plane is visible before the ecotone fade — its near edge needs the same progress-gated ramp the alpine pieces already use) and the pink streak at 02 (petals leaking through the breach; tighten their underwater gate). Frame 03 must not be empty sky: the first held composition — river + first trees — should already be rising into frame.

**Out (to Chapter 4):** forests rise into alpine ridges. The authored seam machinery — `resolveSurfaceWorldSeamRecedeState` plus Ridgeline Rise (`'3-4'`, green #A7E96A → ice #D9EFFF) — is the right spine for the hue handoff, but the waterfall must not simply fade out: through the ecotone it hands off to frozen cascades and mist trails on Chapter 4's foothill skirt (the `mountainSkirtColorNode` meadow→rock ramp is the canvas), so falling water transforms into ice rather than vanishing — the "waterfalls disappear" defect dies here. Likewise the distant range is not dissolved away: its silhouettes ARE Chapter 4's rising heroes (matching seeds and relative placement), so the mountains never change shape as the player climbs toward them. What's still missing is *value*: winter must cool and slightly darken the final stretch so 26–30 never approach whiteout (visual law: no frame >50% white), Chapter 4's crystal geometry must arrive opaque behind ridgelines rather than as translucent ghost cubes (coordinate with the Ch4 section), and the camera framing at 26 must not bisect the pod at the frame edge (a `CHAPTER_FRAMING_OVERRIDES` nudge).

### Technical Implementation Guidance
Work in `src/rendering/odyssey/chapter-environments/surface-world.js` / `surface-world.tsl.js`, with grade/atmosphere changes only through their owners.

1. **Value restoration first.** In `chapter-profile.js` chapter 3: drop `fogDensity` 0.004 → ~0.0024 and keep `fogColor` as the sky-horizon family (the sky-children trick: fog = horizon color nudged ~5% toward white so aerial perspective matches the dome, `src/themes/sky-children-v2/sky-children-v2-theme.js`). In `createLandscapeTSL`, deepen valley-floor shading: strengthen the long-shadow banding amplitude and darken the shaded grass pole toward #0D3A16 so tree silhouettes separate from ground.
2. **Foreground pass-by layer.** New builder in `surface-world.tsl.js` (instanced, capped by the quality preset passed into `create`): sample `getOdysseyPathPointAt` across the chapter range, scatter dark grass/reed/branch silhouettes 2–8 units off the spline. Register in `group.userData.surfaceElements` with a tagged `uOpacity` so the surface fade and ecotone reach it (constraint 3); sized elements as instanced billboard quads, never Points.
3. **Water read.** In `createOceanSurfaceTSL`: deepen `uDeep`, raise the caustic tint saturation, and double the sun-path column weight so the gold glitter survives ACES. In `getTerrainHeight`'s shading counterpart, add a dark wet-sand band (#3A2E1E) in the 1–2 height units above the water clamp for shoreline contrast. Verify the river plane actually intersects early-corridor framing — frames 01–13 must contain readable water.
4. **Kill the squares.** Replace the disc/step masks in `createFallingLeavesTSL` and `createPetals` with a leaf/teardrop alpha shape whose feather reaches zero well inside the quad edge, and rotate the uv over time for tumble (the sakura petal technique, `sakura-twilight-theme.js` createPetals). Extend autumn leaves corridor-wide, gated by season.
5. **Tree variation.** Add a spruce merge alongside `createTreesTSL`'s deciduous; widen scale spread; place in clusters (reject-sample toward existing instances). Apply the crown gradient to both. Keep everything instanced and FrontSide.
6. **Season scalar.** Derive a `uSeason` (0→1 across the chapter span from `cameraProgress`) in `updateSurfaceWorldEnvironment`; lerp the sky-dome band uniforms, sun-disc tints, and the in-group DirectionalLight color/intensity (rewritten every frame per the QW4 light-rig rule). The existing `uSnowBlend` plumbing is the model — add an autumn foliage-recolor uniform to the tree materials.
7. **Spine & figure-ground.** In `chapter-profile.js` path: retune `emissiveColor` 0x9BE84F toward a sun-warmed chlorophyll (#C9CF52 family) with golden flow pulses so the leyline belongs to the golden hour instead of clashing lime. Resolve the pod's grey/brown swap (frames 22–23) with one consistent warm seed-lantern accent — the traveler is the saturation accent (Journey figure-ground).
8. **Entry/exit gates.** Extend the `resolveSurfaceWorldAlpineRampState` pattern to the landscape's near edge for the 01–02 slab; bias the winter sky/exposure cooler-darker through the season scalar for 26–30. Prewarm any new groups via the existing compileAsync path; no per-frame allocation; respect bloom threshold 0.85 (only sun, waterfall crests, fireflies emit).

### Acceptance Criteria
- A grayscale conversion of any held frame shows three distinct value bands; something near-black exists in every frame (FG layer), and frames 03-equivalent and 30-equivalent are no longer >50% empty sky/white.
- Water is identifiable as water — blue-green body plus a broken gold sun-glitter column — in every frame that contains it, with a visible dark shoreline.
- The Great Tree, waterfall, and red cabin each dominate one held beat; the cabin reads as human-scale (trees are now measurable).
- No orange rectangles: every airborne leaf/petal has a shaped, feathered alpha and tumbles.
- Tree stands show two species, ≥2× size variation, and clustering; silhouettes separate from the ground in grayscale.
- Autumn frames are measurably warmer-lit and winter frames cooler-lit than spring frames (sample the key-light color in captures).
- Consecutive frames parallax: the FG layer guarantees visible motion between any two adjacent captures.
- Entry shows no slab pop or pink streak; exit cross-dissolves into Chapter 4 ridgelines with no translucent ghost geometry and no whiteout; the pod is fully framed at the seam.
- Frame budget holds: chapter draws stay within the existing 100–200 corridor and all new content is instanced and quality-preset capped.
- Trailer-frame test: frames at ~10%, 30% (Great Tree), 55% (waterfall), 75% (autumn cabin), and 95% (winter rise) each stand alone as a poster.

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

**In (from Chapter 3, "forests rise into alpine ridges"):** the poetic transformation is *the horizon becoming the ground*. Chapter 3's distant range already uses the same `mountainCpuDisplacement` and `MOUNTAIN_PALETTE` via `shared/mountain-language.js` — enforce that the Ch3 horizon silhouettes ARE the Ch4 heroes (matching seeds/relative placement), so the mountains never change shape; the player approaches the very peaks they saw from the meadow. And answer Chapter 3's coordination request directly: inside Ch3's final frames (the 28–29 equivalents), Ch4's peak geometry must arrive **opaque**, introduced by position and occlusion — rising behind Chapter 3's far ridgeline silhouettes, mostly hidden at first and revealed larger as the rail climbs — never by an alpha fade against open sky. The ecotone weights may drive position, scale, and fog-mix on these heroes; `uOpacity` ramps are reserved for elements never seen edge-on against the sky, so the translucent ghost-cube read of the old captures becomes impossible. Chapter 3's waterfalls must not vanish: through the ecotone they hand off to frozen cascades and mist trails on the foothill skirt (the `mountainSkirtColorNode` meadow→rock ramp is the canvas), and every Ch3 terrain/water card must fade through a `uOpacity` uniform reachable by `_collectOpacityTargets` — the hard-edged clipping rectangles of frames 01–02 are cards the crossfade cannot reach. The cloud-sea deck rises into place via its `uReveal` hook so the camera breaks UP through the cloud ceiling — daylight shafts condensing into thin air.

**Out (to Chapter 5, "snow peaks dissolve into aurora"):** delete the lilac dead zone. The existing seam exit (`MOUNTAIN_SEAM_EXIT_BAND` 0.34 sinking the peaks 140 units beneath the cloud-sea while fading `uOpacity`) is the right mechanism — but the camera must be given something to inherit: as the peaks sink, the aurora curtains (`createMountainAuroraBackdrop`) brighten from preview to a faint readable arc — capped well below the authored [1.0, 0.95, 0.95, 0.7] full-strength opacities, because that arc is exactly the level Chapter 5's staged ramp inherits and builds from (faint arc at ~10%, hero by ~35%); a full-blaze exit here would make Ch5's entry read as a regression. And strictly no stars: the star billboards stay dark through the seam — stars remain Chapter 6's identity, and Chapter 5 opens starless. The final frames are summit-light dissolving into aurora — the literal first terrain of Chapter 5. Frame 30 must show the faint aurora arc and a hint of Ch5's cloud strata, never empty fog. The faceted-polygon pop at 24–28 is the seam crossfade failing to reach a material — audit every Ch4/Ch5 mesh for routed opacity.

### Technical Implementation Guidance

Order of work, all within the established contract (assets built in `createMountainPeaksEnvironment` / the `.tsl.js` builders, refs in `group.userData`, animation in `updateMountainPeaksEnvironment`, budgets from the quality preset):

1. **Verify the landed wave first.** Request one desktop capture; confirm the banded sky, three-zone snow, sun disc (`createMountainSunTSL`), cloud-sea deck (`createCloudSeaDeckTSL`), and `uSummitGlow` climax in `src/rendering/odyssey/chapter-environments/mountain-peaks.tsl.js` actually render as authored before adding anything.
2. **Camera intimacy** (`ODYSSEY_CAMERA_PROFILES` in `shared/chapter-profile.js` + `CHAPTER_FRAMING_OVERRIDES` in `src/rendering/odyssey/OdysseyCameraController.js`): author a Chapter 4 framing override that tightens camera distance through local progress 0.6–0.9 so the notch visibly grows, threads the saddle close to the left wall, and grazes the foreground cornice — the missing approach beat of frames 07–21.
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

## Chapter 5 — Sky & Atmospheric Drift

### Creative Vision & Player Feeling

The summit exhales into sky. Chapter 4 ended with "stone gives way to light"; Chapter 5 is that breath released — the player should feel weightless ascent, the last mountain falling away beneath them while the sky itself becomes terrain. The emotional beat is awe shading into anticipation: this is the last air before the void, and the sky should spend it extravagantly. The chapter is a single continuous dusk: we enter in late golden light with snow peaks still glowing below, climb through deepening indigo as the aurora ignites and takes over as the hero, and exit through a corona climax into the electric-blue hush of noctilucent clouds at the edge of space. One scalar — call it duskProgress — scripts the whole arc, exactly the way `MoodDirector.radiance` scripts sky-children-v2's sunset (src/themes/sky-children-v2/composition/mood-director.js): not a switch, a golden hour that cools into auroral night.

This direction explicitly supersedes two standing decisions. First, the "ever-present aurora from frame one" stance in sky-drift.js: the aurora is now a staged ramp — present as a faint arc by ~10% of the chapter, readable hero by ~35%, corona climax at ~80%, receding only in the final ~15% (narrowing the current `SKY_AURORA_EXIT_BAND` of 0.34). Second, the "uniformly bright hazy daytime" identity: the chapter keeps its warm hazy entry (and still strictly NO stars — that remains Ch6's identity), but it must earn a dark value anchor by mid-chapter or the aurora can never read. The capture proves it: additive curtains over a bright lavender field desaturate to white smears.

### Hero Image & Composition

The trailer frame: camera low on the rail, dolly rising; below and behind, two violet-shadowed snow peaks sink into a moonlit stratocumulus deck; ahead, a vast green aurora curtain arches edge-to-edge across the upper frame, magenta hem rippling, crimson tops fading into indigo; the rail's luminous S-curve converges under the curtain's brightest fold, and the dark marble sits silhouetted against the green glow at the lower-thirds intersection.

- **Foreground framing:** near cloud wisps and ice spindrift streaking past camera (existing `createSkyWispTSL` wisps, plus a new ice-crystal layer), and the occasional dark wisp — a shadowed cloud shred crossing the lower frame to give the near field a value anchor.
- **Midground journey assets:** the rail and marble; the threaded cloud strata (`createCloudStrataTSL`) the path dollies between, now with ink-shadowed undersides; one lenticular cloud stack as a stationary mid-chapter landmark; the god-ray fans early, the aurora arch late.
- **Background world scale:** receding mountain summits below in the first third (the world we left), the moonlit cloud deck horizon through the middle, and the noctilucent veil above in the final third (the world we approach). The eye always has a destination: the low warm sun in Act I, the aurora arch in Act II, the corona-then-portal in Act III.

### Screenshot Diagnosis

Frames 01–04: mountain facets read as skybox seams, not peaks — they need 2–3x more value separation, real ridgeline silhouettes, and a gradual fog-swallow instead of vanishing by 05. Frames 04–07: near-uniform lavender field; the marble goes light-on-light and loses its silhouette; the debug HUD panels are literally the darkest values on screen — the chapter has no dark/mid/light structure until 26. Frames 04–25: no focal destination; the sun hero authored in `createSkyGradientTSL` does not survive the grade — frame 04 shows zero warm anchor. Frames 08–18: midground is low-frequency blotches reading as compression artifacts; hard billboard seams upper-left in 09/10/13 (god-ray fan planes caught oblique) and card corners lower-right in 22–23. Frames 14–18: a dead stretch, ~17% of the chapter with no development — exactly where the aurora should be building. Frames 17–25: the aurora arrives in the final third as desaturated white-lilac streaks confined to the right half (confirmed in 21: pure pale streaking, no green), then dies into the portal rather than peaking before it. Preserve: the palette coherence, rail readability and the 08–13 camera roll, the marble-as-anchor frames (10, 11, 14, 15, 18, 21), the 04–07 particle drift, and the 26–29 portal — that portal is the AAA bar the whole chapter is pulled toward. The red polyline in 27–29 must be confirmed debug-only.

### Art Direction Specification

**Palette (duskProgress-scripted, three acts):**
- Act I "Summit Exhale" (0–30%): warm horizon #FFCCA3 → periwinkle mid #8C84BD → violet zenith #4A3F7A; sun disc/glow #FFB866 core, #FF9A4A halo; peak snow #8FA3C8 lit / #2A3354 shadow (the Ch4 `MOUNTAIN_PALETTE` carried over via mountain-language.js).
- Act II "Aurora Ascendancy" (30–80%): horizon cools to #6B6FA8, zenith deepens to indigo #1B2A6B; moonlit cloud-deck tops #8FA3C8 over ink cores #1A2238; the aurora takes the saturation budget.
- Act III "Edge of Air" (80–100%): zenith approaches #0E1430 (never RGB-black — the no->50%-void law holds), noctilucent filaments #9FD8FF/#BFE8FF, threshold portal cool-white.

**Aurora color identity (physically ordered, never randomized):** thin magenta-pink hem at the curtain base #FF5FB0, bright yellow-green foot #9CFF57, green body #3DFF8E with dim wash #1E9E64, crimson cap fading up #C71F37 → #6E1030, blue-violet accent #5B3BFF only on the sharpest lower edges. This corrects the current `createAuroraRibbonTSL` stack (teal low, magenta crown) — real curtains wear pink at the hem and red at the crown (nps.gov aurora-physics reference; earthsky.org aurora forms).

**Value hierarchy:** every act must read in grayscale as dark FG accents / mid MG / lighter BG, with the strongest light-dark edge reserved for the act's hero (sun, aurora fold, portal). The marble must always sit against a mid-or-darker backdrop — the strata sheets nearest the path carry shadowed undersides so frames like 05–07 can never go light-on-light again.

**Motion language:** aurora folds travel ALONG the arc faster than the arc drifts (~10:1 fold-to-drift speed, the substorm signature); cloud strata drift slow; wisps and ice crystals streak fast past camera; lenticular stack stays dead still while wind streams through it. One motion accent aims at each act's focal point.

**Silhouettes/materials:** peaks as bold ridged silhouettes (ridged-multifractal language from src/themes/himalayan-peak/rendering/ridge-terrain.js, with its signature alpenglow rim — pow(1−N·V, 2.6) gated by sun facing — catching #FFB866 on the snow edges); clouds shaded with the Beer's-law + powder + Henyey-Greenstein silver-lining vocabulary of src/themes/sky-children-v2/rendering/cloud-sea.js, shadows tinted blue-violet, never grey.

### Asset & Detail List

1. **Receding summit ring** — 2–3 large ridge-silhouette planes below and slightly behind the path at chapter entry (visible frames 01–08), alpenglow-rimmed, sinking and fog-swallowing across the first 30% via a chapter-owned opacity band (mirroring mountain-peaks' own `MOUNTAIN_SEAM_EXIT_BAND` exit authoring).
2. **On-camera low sun** — the existing `createSunGlowTSL` stack plus dome sun, but actually readable: disc + aureole on the default forward aim, sinking toward the horizon as duskProgress rises, gone by ~55%.
3. **Aurora curtain set** — the six `createAuroraRibbonsTSL` curtains retuned to the physical color stack; the MID hero repositioned to straddle the path so the camera flies UNDER its arch (~55–70%); a zenith corona burst — rays converging radially overhead — as the 75–85% climax, framed during the existing camera roll energy.
4. **Moonlit stratocumulus deck** — the `createCloudDecks` sprite ring re-tinted to silver-blue tops / ink cores, sitting as the Act II horizon (the dark value anchor).
5. **Lenticular landmark** — one stacked-disc lens cloud, mid-right of path around 45–55%, killing the 14–18 dead stretch as a stationary scale object.
6. **Ice spindrift** — instanced billboard crystals (altitude-scaled wind speed per src/themes/himalayan-peak/sim/spindrift.js, rebuilt as quads — never THREE.Points), tinted by the live sun/aurora color.
7. **Noctilucent veil** — electric-blue herringbone filaments high overhead in the last 15%, the "last clouds," self-luminous against the deep indigo.
8. **Dark foreground wisps** — a handful of shadowed cloud shreds crossing the lower frame for FG value.

### Transition In / Transition Out

**In (from Ch4 Mountains):** snow peaks dissolve into aurora — literally. The Ch4 summits persist into the ecotone overlap as the receding summit ring; their alpenglow rims are the same hue family as the rising sun glow, so the mountain's last light becomes the sky's first. The faint Ch4 aurora preview (shared/mountain-aurora.js already seeds curtains over the peaks) is the promise this chapter keeps: the same curtain geometry brightens and descends to meet the player. No pop — the peaks sink below frame over eight beats, not one.

**Out (to Ch6 Space):** aurora stretches into nebula. The corona climax peaks BEFORE the portal (~80%), then the curtains flatten and recede downward — the from-orbit read, green band hugging the limb below — while the noctilucent filaments and a thin olive-green airglow line (#7FBF6A) become the membrane the player punches through. The threshold director's 5→6 effects (the 26-frame lens bubbles) must fade in over the last three beats instead of popping, and the last aurora green hands off through the green→crimson filament recolor bridge — the final curtains stretching and recoloring #3DFF8E → #C71F37 → #E8485C — to become the first crimson nebula filaments of Ch6.

### Technical Implementation Guidance

1. **duskProgress scalar** — in `updateSkyDriftEnvironment` (src/rendering/odyssey/chapter-environments/sky-drift.js), derive a 0–1 chapter-local progress from cameraProgress against `getActiveOdysseyChapterPositions()` (the same pattern as `resolveSkyDriftAuroraExitOpacity`), expose it as a new uniform in the shared uniforms block, and thread it into every sky-drift.tsl.js builder. Day/dusk palette endpoints lerp by this one scalar — the sky-children-v2 single-uniform-block architecture, verbatim.
2. **Sky dome** — in `createSkyGradientTSL` (src/rendering/odyssey/chapter-environments/sky-drift.tsl.js), lerp the zenith/midSky/horizon vec3 stops between the Act I and Act III palettes; sink `uSunDir`'s elevation with duskProgress; add the sky-dome painterly FBM break (src/themes/sky-children-v2/rendering/sky-dome.js) so the gradient never reads as a clean ramp. Coordinate the fog color in `ODYSSEY_CHAPTER_PROFILES` ch5 (shared/chapter-profile.js) — fog stays owned by `ChapterEnvironmentManager.updateGlobalEnvironment`, so the profile's atmosphere must describe the dusk midpoint, not the old flat lavender.
3. **Aurora** — retune `createAuroraRibbonTSL`'s uColorA/uColorMid/uColorB/uColorHi to the hem-green-crimson stack; add the magenta hem band at the base feather; drive overall intensity by duskProgress (faint arc at 0.1, hero at 0.35, corona spike near 0.8) multiplied with the existing shared uOpacity; shrink `SKY_AURORA_EXIT_BAND` (sky-drift.js) from 0.34 to ~0.15; reposition the MID curtain in `createAuroraRibbonsTSL` to straddle the path; speed the fold terms in the curtain sin-stack ~10x relative to drift.
4. **Why the wash happened** — audit the ch5 entry in `CHAPTER_SIGNATURES` (src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js): the master grade is flattening saturated additive sources into lilac. Fix by giving the scene value structure (the indigo Act II backstop), not by cranking the tint — per the standing visual law.
5. **Peaks** — build the summit ring in `createSkyDriftEnvironment` from the shared mountain vocabulary (shared/mountain-language.js `mountainColorNode`/`MOUNTAIN_PALETTE`), with a chapter-authored entry fade through a uOpacity uniform (ecotone-reachable, transparent at build, per the hard constraints); verify mountain-peaks.js's seam exit band overlaps so Ch4's real peaks and Ch5's ring crossfade seamlessly.
6. **Seam artifacts** — tighten the radial mask in `createGodRayFanTSL` so oblique views never reveal the plane edge (the 09/10/13 seams), and clamp strata tilts or tighten the 0.42 feather in `createCloudSheetTSL` for the 22–23 corners.
7. **Decks, wisps, ice** — re-tint `createCloudDecks` to the moonlit palette with ink cores (drop the additive blending on the darkest sprites so they can actually darken the frame); add the ice-crystal instanced quads alongside `createSkyWispTSL` using shared/odyssey-tsl-billboard.js; budget both against the quality-preset particle counts.
8. **Lights** — the `setupSkyLighting` PointLights must keep being created in the group and rewritten per frame; shift the purple/cyan glows toward aurora green as duskProgress rises.
9. **Capture hygiene** — confirm the red polyline is the debug overlay (gated by ?odysseyAAA=1) and exclude it from review captures. Batch all of the above before requesting the user's single desktop capture.

### Acceptance Criteria

- Frames 01–04 equivalents: peaks read as unmistakable ridgeline silhouettes with at least 2–3x today's value separation, and dissolve gradually — no frame-to-frame pop.
- A grayscale conversion of any frame shows three value bands; in no frame is the debug HUD the darkest element on screen.
- The sun reads as a warm disc-plus-halo focal point in the first third; the marble holds a dark silhouette against mid-value backdrop in every frame (the 05–07 failure is gone).
- Aurora: visible arc by ~10% progress, readable green-bodied hero with magenta hem and crimson caps by ~35%, full-sky corona by ~80%, receding only in the last 15% and handing its green to the portal — never white-lilac smears.
- The 14–18 dead stretch contains the lenticular landmark and a visibly building aurora; no five-frame run is compositionally static.
- No straight billboard edges or card corners anywhere in the 29-frame sweep; no stars before the chapter boundary.
- Trailer-frame test: frames at ~10%, ~50%, and ~80% each stand alone as marketing stills with a single dominant focal point — and the mid-chapter now competes with the 26–29 portal instead of losing to it.

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

**Lighting.** One warm key — the accretion disk light (0xFF6A2A point light, energy-pulsed) — and one cool violet rim directional (0x6A4CFF). Every midground object is lit by these two and nothing else: orange rim toward the hole, violet fill away. Stars first ignite at the seam (the SEAM_56 early-ignite ramp) and are born already calm — scintillation floored at 0.78 from first ignition; Chapter 5 is starless, so the steadiness itself is the "above the atmosphere" cue.

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
4. **Airglow membrane + shear arcs:** rework the '5-6' (kind 4, Atmosphere Edge) and '6-7' (kind 5, Lensing Engage) profiles in `transitions/ChapterThresholdDirector.js` / `chapter-threshold-director.tsl.js` — the 5-6 rework replaces only the veil component with the thin olive band; the profile's lens-bubble particle component is retained and fades in across the three seam beats, exactly as Chapter 5's Transition Out specifies. The 6-7 veil's pattern drops to low-frequency shear arcs with a decay tail across the seam-exit band. No allocation at trigger time, per the prebuilt-FX contract.
5. **Particles:** in `createCosmicDust` add the streak tier (shallow zBase, elongated quads via the billboard helper in `shared/odyssey-tsl-billboard.js`); round-envelope all intro-visible sprites. Counts stay under the existing `DUST_*_CAP` discipline.
6. **Far-nebula blockiness (frames 10/12):** in `createNebulaVolume`'s far tier, raise the per-sprite warp frequency or add one FBM octave only for `nebula-volume-far` (its huge sprites under-sample at 2–3 octaves), or trim `sizeSpan` — whichever holds fill-rate.
7. **Avatar trim:** author the emissive rim where the traveler is owned (path/node systems — `OdysseyPathRenderer.js` / `LevelNodeManager.js`), keyed from the chapter profile accent 0x8FB0FF, ≥0.85 for selective bloom (`userData.emitsBloom` discipline).
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

**Palette anchors.** Sun ramp: #FEF65B → #FD8A26 → #FF5ACD — the cooled echo of Chapter 7's disk: its warm core #FFF4CF and gold ember wisps #FFB347 flattened into the scanline disc, its magenta plasma body #FF2EA8 surviving as the hot pink (the cosmic handoff per the synthwave/Outrun canon and the DNGR disk physics). Bridge rule: orange never touches blue directly — magenta/purple #C600FF always mediates (Outrun palette guide). City: electric cyan #00F2FF (path, gates, street centerline), hot magenta #FF3FB4 (signs, sky, traffic), deep indigo base #0C0818, sky floor #02066F–#580E91, skyline silhouette near-black #07050F (never RGB 0,0,0). Warm cream windows #FFD180 become rare punctuation, ≤5% of lit windows.

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

## The Seam Atlas — Transition Master Strategy

Every boundary is a poetic transformation with named carried elements; both adjacent chapter sections quote the same handoff. All seams are authored in the ecotone / carried-element model: opacity crossfades ride `resolveChapterBlendState`'s ecotone weights, breach FX are prebuilt state-only triggers in `transitions/ChapterThresholdDirector.js`, and no element pops, recompiles, or changes the light set at a crossing.

| Seam | Transformation | Carried elements | Key fixes |
|------|----------------|------------------|-----------|
| 1→2 "Steam Quench" | Magma vents become hydrothermal glow | The First Heart quenches down the blackbody ladder and survives as the drowned amber vent glow (#7a1500) below Ch2's entry; the rail recolors orange→cyan; embers whiten into steam; selenite crystals become the first bioluminescent lights | No sphere pop at 16→17 / 02→03; thermocline refraction beat; the boundary is dark abyssal twilight, not bright shafts |
| 2→3 "Surface Breach" | Ocean caustics become daylight shafts | God-rays widen and warm; fractured skylight panes of Ch3's azure #2F86D8 and horizon gold #F0B878 build for ~8 seconds; the breach hands its warm halo to Ch3's daylight | White slabs of frame 20 replaced by the staged pane buildup; title card relocated to calm pixels |
| 3→4 "The Horizon Becomes the Ground" | Forests rise into alpine ridges | Ch3's horizon silhouettes ARE Ch4's heroes (matched seeds and placement); waterfalls hand off to frozen cascades and mist trails on the foothill skirt; the cloud-sea rises so the camera breaks up through the ceiling | Ch4 geometry arrives opaque behind ridgelines (position and occlusion, never alpha against sky); every Ch3 card routed through reachable `uOpacity` — no clipping rectangles, no silhouette swap |
| 4→5 "Summit Exhale" | Snow peaks dissolve into aurora | The sinking summits persist as Ch5's receding summit ring; alpenglow rims become the sky's first warm light; the faint Ch4 aurora arc exits at exactly the intensity Ch5's staged ramp begins from | Lilac dead zone deleted; faceted-polygon pops audited via opacity routing; strictly starless on both sides |
| 5→6 "Edge of Air" | Aurora stretches into nebula | Three beats: last-light indigo ramp → thin olive airglow membrane #7FBF6A punched through → green-to-crimson filament bridge (#3DFF8E → #C71F37 → #E8485C); the threshold's lens bubbles are retained and fade across the beats; SEAM_56 stars ignite born-calm | The journey's largest luminance pop (07→08) replaced by a ramp; adjacent frames always share a hue and a value band |
| 6→7 "Lensing Engage" | Nebula collapses into the black hole | Filaments and debris visibly stream inward; Ch6's stars become Ch7's tangentially lensed starfield; gravitational shear arcs (#B38BFF / #FF7A42) frame the portal eye and hand their geometry to Ch7's screen-space lens warp | **The measured ~1002 ms seam hitch is a hard defect fixed before any visual work**; the moiré field is replaced by the low-frequency shear arcs |
| 7→8 "Neon Snap" | The singularity refracts into neon city light | The tunnel's pink/cyan weave hands to the city's magenta/cyan; the disk's gold ramp lingers as the Retrosun's first glow (#FFF4CF and #FFB347 cooling into #FEF65B/#FD8A26/#FF5ACD); the photon ring's cyan persists as the path ribbon | Tunnel mosaic straightens into grid perspective lines; the cut reads as refraction, not relocation |
| 8→(1) "Afterimage" | The city fades; the ember returns to the core | Windows gutter out block by block; the sun is the last thing lit, its crown cooling toward Ch1's magma family (#FF7A1A into the #2D1500 fog); the afterglow sinks below the street like an ember returning to the core | Frames 11–12 rebuilt as a designed neon wipe — no flat untextured polygons; if the journey loops, the encore's neon cools magenta-ember → oxblood into Ch1's breach entry |

## Sequencing & Priority Roadmap

Work is gated into waves; each wave is batched, captured **once** on the user's desktop, and reviewed frame-by-frame against the acceptance criteria before the next begins.

**Wave 0 — Capture truth (no code).** Several chapters have landed-but-unverified work in the working tree: Ch4's de-wash wave (banded sky, three-zone snow, sun disc, summit glow), Ch7's midsection systems (camera-locked hero, ambient wash, corridor dust, ember field), and Ch8's existing synthwave sun. Take one fresh capture with the debug overlay confirmed off (the dashed magenta path-line and red polyline must be `?odysseyAAA=1`-gated overlay only) and re-baseline every chapter diagnosis before touching anything.

**Wave 1 — Hard defects and value structure.** Highest leverage, mostly tuning, no new assets: the Ch7 6→7 seam hitch and frame-15 bloom blowout; the Ch8 sun visibility/occlusion audit and facade window value tiers; Ch5's duskProgress script, aurora color retune, and dark backstop; Ch3's fog density and value restoration; Ch4's four-band value structure and climax bloom discipline; Ch6's intro ramp and hero re-aim onto the rail's vanishing point; Ch1's chapter-wide enclosure treatment and black-cone rim lighting. This wave alone takes most frames from failing to passing the trailer test.

**Wave 2 — The Seam Atlas.** All eight boundaries reworked to the table above, including the chapter-side opacity-routing audits (every fading material reachable by the ecotone crossfade) and both threshold-profile redesigns ('5-6' olive membrane, '6-7' shear arcs).

**Wave 3 — Hero assets and midground life.** Ch1: the First Heart, basalt colonnades, selenite geode chapel, varied geode clusters, the molten-sea lake revival (legacy-floor vein/swell energy in basin form). Ch2: the manta trio, plankton depth tiers and current, the Pearl Gate, jellyfish re-staging. Ch3: golden-hour hero composition, Great Tree upscale, tree species/cluster variation, shaped leaf alphas. Ch4: camera intimacy override, spindrift rebuild, prayer flags, cairns and summit cross, eagles, second far range. Ch5: receding summit ring, lenticular landmark, moonlit deck re-tint, ice spindrift, noctilucent veil. Ch6: asteroid garland, streak-mote tier, gas-giant restaging, galaxy growth. Ch7: lensed fold arcs, corridor bokeh densification, swirl glow sheaths, secondary motif corridor pass. Ch8: skyline silhouette cards, horizon haze band, the Gate Bridge.

**Wave 4 — Climax polish and finale.** Ch5's zenith corona; Ch4's summit ignite tuning; Ch7's tunnel pre-seed; Ch8's exit wipe and city-dimming resolve; only then any final per-chapter grade nudges in `CHAPTER_SIGNATURES` — grade is the last tool, never the fix.

Within any wave, chapters are independent and can be parallelized; seams are not — both sides of a seam land together.

## Risks & Mitigations

- **GPU fill-bound regression.** The renderer is fill-bound (additive overdraw, post passes). Every new particle tier, haze card, and glow sheath must ride the quality presets and the adaptive-quality ladder, stay within ~3 additive layers, and prefer fewer-larger feathered quads over more-smaller ones. Watch the Ch5/Ch6 stretch — already the heaviest in the journey (~425k tris, ~197 draws in the baseline console capture).
- **Seam recompile hitches.** The 6→7 hitch proves the class. New materials and groups must be covered by chapter prewarm plus the whole-journey replay warmup; no light-set changes, no `.transparent` flips, no allocation in threshold triggers. Hitches are HUD-measured at every seam after every wave; the bar is ≤33 ms.
- **Additive wash (the proven failure).** Ch5's capture demonstrates that additive sources over a bright field desaturate to nothing. Every additive system now requires a named dark backstop in its chapter's value specification; the grayscale check in review is the enforcement.
- **Opacity reachability.** TSL materials whose alpha bypasses `uOpacity` are invisible to the ecotone crossfade — this caused the clipping cards and facet pops. Each chapter's seam work includes an explicit audit of every material against `_collectOpacityTargets`.
- **Scope.** Eight chapters of asks is a quarter of work if taken flat. The waves are the mitigation: Wave 1 is tuning-heavy and cheap; everything after is gated on a verified capture. Nothing in Wave 3–4 starts while a Wave 1 defect stands.
- **Capture-loop cost.** Verification needs the user's desktop session, so iteration is expensive by design. Batch ruthlessly; never request a capture for a single change.
- **Backend parity.** The WebGL2 fallback must keep rendering: `__tests__/webgpu-tsl-build.test.js` stays green every wave, with a periodic `?forceWebGL=1` spot check.

## Validation

- **The chapter acceptance criteria are the contract.** Each section ends with checkable visual outcomes tied to frame equivalents; a wave is done when its criteria pass on a fresh capture.
- **Journey-wide checks on every capture:** grayscale value-band test per frame; the >50%-void law; an adjacent-frame pop scan (no cut may share zero hues and zero value bands); the trailer-frame test on randomly sampled frames; avatar-silhouette readability in every frame.
- **Performance gates:** 60 fps with draws inside the current envelope (<100 target), seam hitches ≤33 ms on the HUD, no texture/geometry-count churn between chapters (baseline: 285 geometries / 74 textures steady), and the standing test suite green (`odyssey-path-layout.test.js`, `LevelNodeManager.test.js`, `__tests__/webgpu-tsl-build.test.js`).
- **Capture protocol:** one desktop capture per wave, debug overlay off, same journey replay and naming convention as `artifacts/odyssey/journey/` so new frames diff directly against this plan's baseline set.

## Non-Goals

- **No gameplay, difficulty, narrative, or data changes.** `chapters.js`, `levels.js`, the level layouts, and the difficulty model are untouched; this is a purely visual program.
- **No engine or architecture rework.** The deferred master-plan items stay deferred: no `SeamDirector` archetype revival, no AgX tonemap, no Hillaire atmosphere or froxel aerial perspective, no histogram auto-exposure, no GPU compute particles, no camera dual-spline rig or path re-author. If any are revived later, that is a separate plan.
- **No imported assets.** Everything stays procedural TSL within the existing builder pattern — no textures, models, or HDRIs enter the repo for this work.
- **No grade-first fixes.** Per-chapter tint adjustments in `CHAPTER_SIGNATURES` are a final-polish tool only; any chapter that "needs a tint" actually needs value structure.
- **The encore stays an encore.** Chapter 8 is not extended or promoted; Chapter 7 remains the journey's true finale, and Chapter 8's job is to be fast, flashy, and brief.

## Document Map

- This plan: `docs/ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md` (assembled from the chapter work orders above).
- Capture baseline: `artifacts/odyssey/journey/` — 201 frames across 8 chapters plus `journey-console.log`.
- Prior planning record (still useful for rationale; superseded where stated): `ODYSSEY_AAA_MASTER_PLAN.md`, `ODYSSEY_VISUAL_COHESION_MASTER_PLAN.md`, `ODYSSEY_CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN.md`, `ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md`, `ODYSSEY_EARTH_CORE_AAA_PLAN.md`, `ODYSSEY_CINEMATIC_JOURNEY_PLAN.md`, and the commissioning brief `ODYSSEY_CREATIVE_DIRECTOR_IMPLEMENTATION_PROMPT.md`.

