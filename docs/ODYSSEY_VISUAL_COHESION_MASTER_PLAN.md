# Odyssey Visual Cohesion Master Plan

> Single source of truth for turning the 8-chapter Odyssey spline journey from "8 set pieces marooned in void" into one continuous, AAA, cinematic vista. Synthesizes research (cinematic traversal, environment art, color science, three.js/TSL), 8 per-chapter screenshot audits, and 2 cross-arc cohesion audits.
>
> Scope grounding (real files in this repo, verified):
> - Per-chapter data: `src/rendering/odyssey/chapter-environments/shared/chapter-profile.js` (already declares `atmosphere`, `path`, `node`, `transition`, per-act `ODYSSEY_CAMERA_PROFILES`)
> - Chapter builders: `src/rendering/odyssey/chapter-environments/<name>.js` + `<name>.tsl.js`
> - Path: `src/rendering/odyssey/odyssey-path-renderer.tsl.js`
> - Nodes: `src/rendering/odyssey/level-node-manager.tsl.js`
> - Atmosphere dome: `src/rendering/odyssey/composition/odyssey-atmosphere-dome.tsl.js`
> - Director / uniforms: `src/rendering/odyssey/composition/OdysseyDirector.js`
> - Seam crossfade: `src/rendering/odyssey/ChapterEnvironmentManager.js`, `src/rendering/odyssey/transitions/chapter-threshold-director.tsl.js`
> - Post / grade / bloom: `src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js`
> - Path sampling for corridor content: `src/rendering/odyssey/path-utils.js` (`getOdysseyPathCurve()`, `getChapterPathRange(id)`, `getActiveOdysseyChapterPositions()`)
> - Shared noise / billboard libs: `chapter-environments/shared/odyssey-tsl-noise.js`, `chapter-environments/shared/odyssey-tsl-billboard.js`, `chapter-environments/shared/mountain-aurora.js`

---

## 1. Vision and the core problem

The Odyssey should read as **one unbroken cinematic dolly through a single living world** — a camera that descends from a molten core, swims an ocean, climbs a mountain, lifts into the sky, drifts through space, surrenders to a black hole, and lands in a neon city — never cutting, never pausing on nothing. **It does not.** Today every chapter is a *localized set piece* (one lava cloud, one accretion ring, one city cluster) bolted to a single far anchor (cosmic heroes sit at `z ≈ -740..-800` while the camera flies the spline lane), so the camera spends most of each chapter traversing **empty void** — literal black in the cosmic chapters (Black Hole/Space/Urban frames are 80–97% pure black), foggy white blowout in the terrestrial ones (Surface/Mountains 50–75% washed-out haze), with only a thin inconsistent path wire crossing it. Chapters are stitched, not blended: an environment **fades → black void → discrete glowing portal/halo ring → next environment**, so the seam is hidden by bloom rather than authored as a handoff. Compounding symptoms — three mismatched mountain styles, Sky and Space being interchangeable blue starfields, hero billboards showing hard rectangular edges against black, white-blown nodes, top-down Earth Core framing — are all downstream of the same two root causes: **(a) no continuous mid/far depth filling the corridor the camera actually occupies, and (b) no global color/atmosphere script tying the chapters into one arc.** The cure is overwhelmingly **compositional and shader-side, not more hero geometry**: fill the corridor with per-biome colored fog + parallax depth layers, blend biomes through ecotone overlap bands, unify the repeated motifs (mountains, path, nodes) under one parametrized language, and grade the whole journey under one filmic curve.

---

## 2. Design principles (distilled from the research)

| # | Principle | One-line rationale (research) |
|---|-----------|-------------------------------|
| P1 | **Per-biome colored fog is the #1 fix** | Sable's director called per-biome distance fog "really, really key" — it is both a depth cue and the cheapest way to give the void a *colored body* so the camera never frames true nothing. |
| P2 | **Build depth in BANDS (foreground / midground / far / sky)** | Atmospheric perspective: distant planes get cooler, lower-contrast, softer, less saturated — a "black gap" is just a missing midground + far band; fill them and void becomes vista. |
| P3 | **Ecotone / biome handoff replaces hard portal cuts** | In ecology the overlap strip is *richer* than either biome; Journey co-presents sand+snow during its handoff — both chapters on screen at once = no void, no seam, no "8 stitched demos." |
| P4 | **One continuous shot — the camera never teleports** | God of War (2018) is one unbroken shot so the adventure "feels like one continuous story"; every chapter-to-chapter move must be a continuous dolly through a blended band, not a cut to black. |
| P5 | **Hero as a persistent destination beacon** | BotW keeps the castle/volcano visible across vistas; the hero must be a *fogged silhouette/glow for the whole chapter*, not a flash at entry/exit, with the S-curved spline routed toward it so it stays frame-centered. |
| P6 | **3-layer composition: darkened foreground frames the lit hero** | Ori/level-design composition — a dark parallaxing foreground "creates a frame for the dominant" and the contrast "gives the feeling of space"; kills flat-billboard emptiness with real depth. |
| P7 | **Global color script: one value/hue/temperature curve along progress** | Pixar's color script catches duplicate/empty beats at a glance (Sky≈Space, all-black cosmic); each chapter is one control point on a single interpolating curve so neighbors never snap. |
| P8 | **Unify repeated motifs by depth treatment, not by picking one style** | The "three mountains" are one mountain at three distances; lock one silhouette/material and vary only fog tint + saturation + key temperature (atmospheric perspective), and lock ONE path cross-section tinted per biome. |
| P9 | **Dome / volumetric / soft-feathered heroes over flat billboards** | Feather sprite alpha to zero before the quad edge + soft-particle depth fade + rim glow embeds heroes in atmosphere; the rectangular accretion-disk edge disappears. |
| P10 | **Contrast, not brightness, marks the focal point** | "High color contrast draws the eye more than anything"; the node should be the brightest *saturated* thing against a desaturated fogged biome — fixes white blowout via ACES + contrast, not max emissive. |
| P11 | **Camera leads the eye / vista reveal rhythm** | Spatial composition (sightlines, vistas, landmarks) + "crest the hill, the vista opens"; per-chapter camera tilt/distance keeps the set piece framed (fix Earth Core top-down) and stages heroes as reveals. |

---

## 3. The 8-chapter COLOR SCRIPT & identity table

The journey is one value/temperature melody. **Value curve** (so the Black Hole reads as a *deliberate* dark trough, not one more black scene): Core dark-but-glowing → Ocean mid-dark → Surface bright → **Mountains brightest** → Sky luminous → Space dark → **Black Hole darkest** → Urban warm mid-bright resolution. **No two chapters share a dominant hue.** One shared accent — the path's signature emissive glint — threads through all 8 for unity.

| # | Chapter | Emotional beat | Signature palette (dominant) | Key light | Distinct identity hook |
|---|---------|----------------|------------------------------|-----------|------------------------|
| 1 | Earth Core | Primal, intense (descent in) | Red-orange embers on charred black; **shadows blue-violet** | Low warm key from *below* (`lightDir [0.1,-0.6,0.3]`, `0xff6622`) | Molten **volumetric haze + magma horizon glow** the path descends through; embers everywhere |
| 2 | Deep Ocean | Mystery, descent | Cyan-teal, **amber bioluminescent accents** | Cool key from surface far above (`[0.05,0.9,0.1]`) | **Vertical depth gradient** (sunlit teal top → indigo abyss) + god-ray light shafts |
| 3 | Surface World | Relief, life | Green + warm amber/peach sky | High warm sun (`[0.4,0.8,0.45]`) | **Golden-hour lush land**: vegetation, rolling solid terrain, distant unified range |
| 4 | Mountains | Aspiration (highest key) | **Cool blue-white** snow on slate-blue rock | Low raking alpenglow sun (`[0.7,0.25,0.4]`) | **Cloud sea below + stratospheric banding above**; crisp sharp peaks |
| 5 | Sky & Drift | Lift-off, luminous | **Warm hazy daylight → violet/magenta + aurora** (NOT deep blue) | Soft warm-key sun + god-rays | **Volumetric cloud strata the path flies THROUGH** + Rayleigh/Mie sky; bright, hazy, sun-anchored |
| 6 | Space | Awe, smallness | **True deep black + saturated indigo/magenta nebula pockets + hot-white** | Rim-only starlight (`0.55` intensity) | **Crisp pinpoint multi-depth starfield with NO haze** (the opposite of Sky), parallax travel |
| 7 | Black Hole | Existential low / transcendence (darkest) | Near-black + **single violent magenta-orange accretion accent** + cyan lensing | No key — **accretion glow only** | Lensed accretion torus as a **persistent fogged hero**; deep-violet ambient wash; gravitational-lensing CA accent |
| 8 | Urban Encore | Warm resolution / home (kinetic) | **Electric cyan + hot magenta** over sodium-amber city glow | Neon fill + horizon light-pollution | **Lit-window city canyon along the corridor**, neon haze, finale megastructure reveal |

> **Sky vs Space — the explicit divergence (P7):** Sky is **bright, hazy, warm, atmospheric, sun-anchored, cloud-filled, NO stars in the corridor**; Space is **dark, clear, cold, high-contrast vacuum, crisp pinpoint stars, NO haze**. Currently `sky-drift` primary `0x1a1a2e` collides with `cosmic-expanse` secondary `0x1a1a2e` — change Sky's palette off `0x1a1a2e` toward atmospheric warm-blue and only let stars FADE IN across the Sky→Space seam.

---

## 4. Cross-cutting fixes (whole journey)

### 4.1 Kill the void — fill the CORRIDOR, not just the far hero (P1, P2, P5)
The root cause is content anchored at `z ≈ -780` while the camera travels the spline lane. Two layers fix every chapter:

1. **Per-chapter colored exponential fog.** `chapter-profile.js` already declares `atmosphere.fogColor` / `fogDensity` per chapter — wire these into the scene (`THREE.FogExp2`) and/or the post depth-fog uniform in `odyssey-tsl-pipeline.js`. Density low near the path, rising toward chapter edges so void edges dissolve into colored atmosphere. **Note:** several authored densities are too low to read (Surface `0.0008`, Mountains `0.0005`) and Earth Core/Black Hole/Urban are fine (`0.015–0.02`) — re-tune so *no journey frame is >50% pure black/white*.
2. **Corridor-local volumetric/parallax field.** Instead of one far cloud, scatter content *along the curve*: sample `getOdysseyPathCurve()` / `getChapterPathRange(id)` (from `path-utils.js`) and distribute billboards/dust/silhouettes within ~60–120 units of the path so the camera is always *inside* the biome. Cosmic chapters get 3–5 parallaxing FBM dust/nebula sheets (near layers move faster); terrestrial get hazed midground silhouette ranges + a far backdrop dome.

> **Target metric for every fix below: no captured journey frame exceeds 50% empty void.**

### 4.2 Unify the THREE mountains into ONE language (P8)
Source confirms it's palette-level, not just lighting: `surface-world.tsl.js` has a distant-range palette (snow `0xeef4fb` / rock `0x3a4a60` / fog `0x6f9fd4`) **plus** a separate tundra-slope set (`0xdce5ea`/`0x4f5a64`/`0x8fb6e0`), while `mountain-peaks.tsl.js` uses yet another (snow `0xeaf1f8`&`0xd6e1ec` / rock `0x2b3a4d`&`0x33414d`). Plus a faceted low-poly "foothill bridge" wedge and a blocky cube peak — **four** mountain languages.
- Create `chapter-environments/shared/mountain-language.js`: ONE palette + ONE FBM displacement + ONE snow-line shader, used by both `surface-world` distant range and `mountain-peaks`.
- Drive variation by **two uniforms only**: `distance/fogDensity` and a `coolTemp` factor ramping neutral-grey-blue (Surface horizon) → saturated cool blue (Mountains chapter). Delete the tundra-slope palette, the faceted-grey foothill palette, and the cube peak.
- Rework the **foothill bridge** from a hard faceted grey wedge into a continuous FBM terrain skirt at low amplitude that height-blends Surface meadow-green at its base into Mountains rock at its top (it becomes a *ramp*, not a seam).
- **Gate the leak:** Mountains-style peaks + a translucent slab currently appear *during Deep Ocean* (Ocean frame 22). Ensure Ocean breaks out to Surface meadows first; alpine peaks fade in only across the Surface→Mountains ramp.

### 4.3 Ecotone transitions replace hard portals (P3, P4)
`ChapterEnvironmentManager.js` currently does **opacity-only** crossfade over a narrow seam — and because each chapter's content is one far set piece, the crossfade happens *over empty void* (set piece dims → black → next set piece). Fix:
- At each boundary define a **10–20% overlap window** (last ~12% of chapter N co-located with first ~12% of N+1). Drive two arc-length weights `wN = smoothstep(1→0)`, `wN1 = smoothstep(0→1)` from the existing `seamProgress (0..1)` already computed by the manager / `chapter-threshold-director.tsl.js`.
- Apply those weights to **shared corridor content spanning both chapters**, not two isolated far heroes: (a) lerp fog color/density, (b) fade each chapter's particle counts (Core embers thin as Ocean motes appear), (c) cross-fade backdrops, (d) carry **one shared element across** (same ridge silhouette from late Ocean + early Surface; same peak from late Surface + early Mountains).
- Seed 1–2 **hybrid "ambassador" props** per seam (charred rock crusted with frost; lava vent steaming into water; cosmic dust crystallizing into architecture).
- **Demote the portal ring** to a subtle accent/node marker *inside* the ecotone — never the bridge itself. Tame center bloom at boundaries so the world *transforming* is visible instead of a white wash.

### 4.4 Dome/volumetric heroes — kill billboard edges (P9)
- **Radial alpha to zero before the quad edge:** for every additive nebula/aurora/galaxy quad, multiply opacity by `smoothstep(0.5, 0.32, length(uv-0.5))` so alpha is exactly 0 at the quad border (the existing `pow(oneMinus(dist*2),k)` is non-zero up to `dist=0.5` — tighten it). `Space-33` is the worst offender (visible rectangular nebula).
- **Soft-particle depth fade** on all transparent volumes: `fade = saturate(invFade * (sceneZ - fragZ))` using `scenePass.getTextureNode('depth')` — removes hard intersection seams where glows clip the path/terrain.
- **Volume on a billboard / spherical heroes:** replace the flat accretion `RingGeometry` with either 2–3 stacked slightly-rotated soft cards + animated radial ramp, or a short fixed-step (~16) **raymarch** with **blue-noise/bayer dither offset** (the `VolumeNodeMaterial` bayer16 pattern) keeping it 60fps. Gas-giant sphere + fresnel lens shell already in `cosmic-expanse.tsl.js` are the template.
- **Rim/atmosphere glow** so heroes seat into haze rather than float on black.

### 4.5 Path-width & node-orb consistency (P8, P10)
- **ONE path tube spec** across all 8 chapters: lock radius, emissive curve, edge glow, bloom contribution; vary **only hue** per biome from the chapter palette. This kills the thin-magenta-wire (Space/Black Hole) vs fat-cyan-tube (Urban) vs garish-yellow-green (Surface) inconsistency. Increase tube segment count so the faceted polygonal silhouette (Urban frames 08/10) disappears. Edit `odyssey-path-renderer.tsl.js`; widths already declared in `chapter-profile.js path.widthScale` — clamp the spread.
- **Node glow clamped below pure white** in `level-node-manager.tsl.js` — fix blowout in Surface-29, Mtn-03, Sky-29, Space-04 via the global ACES curve + a tightened glow falloff. Tint selection halo toward the chapter accent (warm/amber inside Earth Core) so it never clashes (cyan-on-lava).

### 4.6 Camera framing language (P11)
- Per-chapter camera profiles exist per *act* in `chapter-profile.js` (`ODYSSEY_CAMERA_PROFILES`). Extend so each chapter's hero is a **vista anchor** the look-at frames (rule-of-thirds; center reserved for big reveals), and the **next** chapter's landmark is visible across the ecotone as a preview.
- **Fix Earth Core top-down:** reframe to a low 3/4 "descending into the core" forward-looking angle with a visible magma horizon so the charred-crust lava terrain (the existing WIN) is actually seen — not a top-down shaft over void.
- **Re-aim cosmic cameras at the hero** (Black Hole-21, Space-20, Urban-10 point into void): bias look-at to keep the hero ≥ partially in frame the way Black Hole-03 succeeds.
- Bias **Mountains toward the frame-10 framing** (three-peak V, central path leading up to the node) for the whole chapter.

### 4.7 Bloom / exposure / grade discipline (P7, P10)
- **ACES filmic tonemap** under one global exposure (fit `a=2.51, b=0.03, c=2.43, d=0.59, e=0.14`; `saturate((x*(a*x+b))/(x*(c*x+d)+e))`) so bright nodes/embers keep hue instead of clipping to white, and dark cosmic + bright Mountains are correctly exposed by the *same* curve. Already scaffolded in `odyssey-tsl-pipeline.js`.
- **MRT selective bloom** from an emissive channel: `scenePass.setMRT(mrt({output, emissive}))`, bloom source = `getTextureNode('emissive')`, threshold ~0. `odyssey-tsl-pipeline.js` already has the `useMRT`/`emitsBloom` scaffolding — finish `emissiveNode` on every additive hero so only tagged pixels (path, nodes, lava, accretion, aurora, neon) bloom; snow and sky backstops don't. Fixes node blowout AND makes path glow identical brightness everywhere.
- **One master grade / LUT** on top of all 8 (tinted toe in shadows, gentle filmic shoulder, slight temperature bias) so Earth Core lava and the Black Hole share one "film stock."
- **Arc-modulated vignette** (stronger in introspective lows: Deep Ocean, Black Hole; lighter in open beats: Mountains, Sky) and a **whisper of edge-only chromatic aberration** globally, briefly intensified at the Black Hole as a gravitational-lensing accent.

---

## 5. Per-chapter plan

Tags: **Impact** (H/M/L) · **Effort** (H/M/L). Files are relative to `src/rendering/odyssey/`.

### Chapter 1 — Earth Core
*Bimodal: immersion frames (08/12) are AAA molten; approach/entry (03/16) are 55–85% void; portal (19) is a generic cyan ring with zero molten identity.*
| Change | I/E | Files |
|--------|-----|-------|
| Wrap the WHOLE chapter path in warm molten volumetric haze + far magma-horizon glow band (kill void in 03/16) | H/M | `chapter-environments/earth-core.tsl.js`, `shared/chapter-profile.js` (`fogColor 0x2d1500`, raise corridor density), post fog in `odyssey-post/odyssey-tsl-pipeline.js` |
| Reframe camera off top-down to low 3/4 descending angle with magma horizon (preserve lava shader untouched) | H/M | `chapter-profile.js` camera profile, `OdysseyCameraController.js` |
| Re-theme exit transition to molten (cracked-obsidian ring, lava seams, warm bloom, embers crossing) — no cyan | H/L | `transitions/chapter-threshold-director.tsl.js`, `earth-core.tsl.js` |
| Light floating background spheres with warm bounce; give each node a molten "pocket" (platform/cavern) so it frames mid-frame | M/M | `earth-core.js`, `level-node-manager.tsl.js` |

### Chapter 2 — Deep Ocean
*Flat caustic wallpaper dome (~75% empty) except frame 18 (the gold standard: arcing path over a lavender mass). Frame 03 has warm pink bleed from the prior lava biome.*
| Change | I/E | Files |
|--------|-----|-------|
| Establish vertical depth gradient (sunlit teal top → indigo abyss) tied to camera depth | H/M | `deep-ocean.tsl.js`, `composition/odyssey-atmosphere-dome.tsl.js` |
| Add descending volumetric god-ray light shafts (the iconic ocean cue; directional key + depth) | H/M | `deep-ocean.js`, `deep-ocean.tsl.js` |
| Populate layered seabed + kelp/coral + far creature silhouettes at multiple depths (make every frame like 18) | H/H | `deep-ocean.js`, `shared/odyssey-tsl-billboard.js` |
| Clamp prior chapter's warm emissive during entry handoff (kill pink stain in 03) | M/L | `ChapterEnvironmentManager.js`, `transitions/chapter-threshold-director.tsl.js` |

### Chapter 3 — Surface World
*Washed-out white fog (50–65% empty), flat cardboard ground planes, the soft-grey mountain style, zero vegetation despite "Living Landscapes."*
| Change | I/E | Files |
|--------|-----|-------|
| Replace pale fog with sky gradient + warm key (golden-hour); pull exposure/bloom down hard (kills overexposed read) | H/L | `surface-world.tsl.js`, `chapter-profile.js` (fog `0xc8e6c9` too bright — re-tune), post pipeline |
| Deliver "Living Landscapes": instanced low-poly vegetation (grass/trees/reeds), drifting birds | H/M | `surface-world.js` (InstancedMesh + LODs) |
| Give ground real volume (rolling displaced terrain, hide hard undersides); layer distant rolling hills | H/M | `surface-world.js`, `surface-world.tsl.js` |
| Adopt unified mountain language; warm/match peaks (see §4.2) | H/M | `shared/mountain-language.js` (new), `surface-world.tsl.js` |

### Chapter 4 — Mountains
*Frame 10 proves the look; 03/18/25/30 are 60–75% void/white blowout, node destroyed by bloom, empty upper 2/3.*
| Change | I/E | Files |
|--------|-----|-------|
| Tame node/path/summit bloom so node keeps surface detail (raise threshold / lower emissive) | H/L | `level-node-manager.tsl.js`, `odyssey-path-renderer.tsl.js`, post pipeline |
| Add high-altitude cloud sea below + stratospheric sky banding above (fill vertical void; sell ascension) | H/M | `mountain-peaks.tsl.js`, `odyssey-atmosphere-dome.tsl.js` |
| Bias camera to frame-10 framing (path leads up to node, three-peak V); add off-center sun/moon disc | H/M | `chapter-profile.js`, `OdysseyCameraController.js` |
| Replace white-out entry/summit with ecotone handoffs (foothill ramp in, cloud-sea→stratosphere out) | H/M | `transitions/chapter-threshold-director.tsl.js`, `ChapterEnvironmentManager.js` |

### Chapter 5 — Sky & Drift
*Identity crisis: source parks heroes at z -750..-850, clouds at z -500, so 4/5 frames are flat navy starfield indistinguishable from Space. Aurora billboard shows hard edges.*
| Change | I/E | Files |
|--------|-----|-------|
| Bring 3–5 volumetric cloud strata INTO the camera's travel volume (path threads through clouds) | H/H | `sky-drift.tsl.js`, `sky-drift.js` |
| Re-grade to warm hazy daylight + Rayleigh/Mie sky; move palette off `0x1a1a2e`; stars only fade in at Sky→Space seam | H/M | `chapter-profile.js`, `odyssey-atmosphere-dome.tsl.js` |
| Pull eclipse/galaxy/nebulae forward (z -750→-300) as readable mid-ground heroes per node | H/M | `sky-drift.js` |
| Radial-feather the aurora/nebula cards (§4.4); reposition aurora to wrap/frame the node | M/L | `sky-drift.tsl.js`, `shared/odyssey-tsl-billboard.js` |

### Chapter 6 — Space
*Most empty chapter: 90–97% pure black in 3/5 frames. Flat rectangular nebula billboard (frame 33). No depth-cue layers.*
| Change | I/E | Files |
|--------|-----|-------|
| Continuous multi-layer parallax background: 2–3 nebula gradient depth sheets + dense multi-depth starfield + drifting dust (no frame >50% black) | H/H | `cosmic-expanse.tsl.js`, `cosmic-expanse.js`, `shared/odyssey-tsl-noise.js` |
| Replace flat nebula billboard with soft-feathered multi-layer sprites or sphere-mapped FBM band | H/M | `cosmic-expanse.tsl.js` |
| Differentiate from Sky: true deep black + saturated nebula pockets + a persistent distant galaxy/BH glow anchor; crisp pinpoint stars, NO haze | H/M | `cosmic-expanse.js`, `chapter-profile.js` |
| Fix leading-line conflict (taper path where it exits frame, brighten forward route); unify path tube | M/L | `odyssey-path-renderer.tsl.js` |

### Chapter 7 — Black Hole
*Structural: ALL hero elements share one anchor `(0,-22,-780)` over ~180 path-units, so the disk is seen ONCE (frame 03 is great) then 80–92% black corridor. Void dome contributes no visible nebula.*
| Change | I/E | Files |
|--------|-----|-------|
| Distribute hero presence along the whole path (2–3 secondary lensing/accretion motifs OR one large always-visible background BH); raise voidDome luminance so FBM filaments read | H/H | `black-hole-transcendence.js`, `black-hole-transcendence.tsl.js` |
| Add deep-violet ambient color wash + dust parallax so void stretches carry the palette (never RGB-black) | H/M | `black-hole-transcendence.tsl.js`, post pipeline |
| Bias camera look-at toward the event-horizon anchor for more of the traversal (sustain frame-03 shot) | H/M | `chapter-profile.js`, `OdysseyCameraController.js` |
| Cap path radius (kill flat over-thick ribbon, frame 21); soften infall-stream/ring grazing edges with additive falloff | M/M | `odyssey-path-renderer.tsl.js`, `black-hole-transcendence.tsl.js` |

### Chapter 8 — Urban Encore (finale)
*The authored city (22 towers, spire, holograms, haze, sky-traffic) lives deep at z -480..-700 while the camera tracks the path tight, so it's off-screen — finale ends on a wire on black (frame 12).*
| Change | I/E | Files |
|--------|-----|-------|
| Pull/duplicate the city to hug the WHOLE corridor (continuous lit-window canyon flanking the path) | H/M | `urban-dreams.js` |
| Luminous urban-night sky: neon gradient + horizon light-pollution band + smog haze + distant city-light bokeh (never pure black) | H/L | `urban-dreams.tsl.js`, `odyssey-atmosphere-dome.tsl.js` |
| Finale reveal: as progress→100%, crane/pull back to frame lit megastructure spire behind final node (payoff, not a wire) | H/M | `chapter-profile.js`, `OdysseyCameraController.js`, `urban-dreams.js` |
| Unify + fatten path to one glowing conduit (kill thin wire stubs + faceted silhouette); break from BH's cyan radial glow with real urban motif | H/L | `odyssey-path-renderer.tsl.js`, `urban-dreams.tsl.js` |

---

## 6. Phased roadmap

### Phase A — Cohesion foundations (void-fill + transitions + mountain unification + camera)
*Highest impact-to-effort first. This phase alone removes the "unfinished/messy" read across the whole journey.*
- [ ] **A1. Per-chapter colored fog wired live** from `chapter-profile.js atmosphere` into scene `FogExp2` + post depth-fog; re-tune densities so no frame >50% void (raise Surface/Mountains, keep cosmic). *(H/L)*
- [ ] **A2. Corridor-local depth layers** sampled off `getOdysseyPathCurve()`: cosmic 3–5 parallax FBM dust/nebula sheets + multi-depth starfield (Space/Black Hole/Sky); terrestrial hazed midground silhouettes + far dome. *(H/H)*
- [ ] **A3. ACES filmic tonemap + global exposure + MRT selective bloom** finished in `odyssey-tsl-pipeline.js`; clamp node/path emissive — kills white blowout everywhere. *(H/M)*
- [ ] **A4. Unified path tube spec** in `odyssey-path-renderer.tsl.js` (one radius/glow/segments, hue-only per biome). *(H/L)*
- [ ] **A5. Unified mountain language** module; collapse the 4 palettes; rework foothill bridge into a blended ramp; gate the Ocean peak leak. *(H/M)*
- [ ] **A6. Ecotone transition framework** on `seamProgress`: overlap bands cross-fade fog + particles + a shared carried element; demote portal ring to accent; tame seam bloom. *(H/M)*
- [ ] **A7. Camera framing pass**: fix Earth Core top-down; re-aim cosmic cameras at heroes; bias Mountains to frame-10. *(H/M)*

### Phase B — Per-chapter set-piece enrichment
- [ ] **B1. Sky reclaims identity**: cloud strata in the travel volume + Rayleigh/Mie sky + palette off `0x1a1a2e` + heroes pulled forward; stars only at Sky→Space seam. *(H/H)*
- [ ] **B2. Deep Ocean**: vertical depth gradient + god-rays + layered seabed/kelp/creature silhouettes. *(H/H)*
- [ ] **B3. Surface World "Living Landscapes"**: instanced vegetation + volumetric ground + warm golden-hour grade. *(H/M)*
- [ ] **B4. Black Hole hero distribution**: secondary motifs / persistent background BH + luminous void dome + ambient violet wash. *(H/H)*
- [ ] **B5. Space depth field**: continuous parallax nebula/star/dust layers + persistent distant anchor. *(H/H)*
- [ ] **B6. Urban city-to-corridor + luminous night sky + finale reveal**. *(H/M)*
- [ ] **B7. Earth Core enrichment**: molten haze along path + lit background spheres + node pockets. *(H/M)*
- [ ] **B8. Mountains vertical fill**: cloud sea + stratospheric banding + sun disc. *(H/M)*

### Phase C — Hero upgrades + post/color-grade finish
- [ ] **C1. Feather/soft-particle ALL billboards** (radial alpha→0 before edge + depth fade) — kills rectangular edges journey-wide. *(H/M)*
- [ ] **C2. Volumetric/raymarched heroes**: accretion disk → stacked soft cards or bayer-dithered raymarch; optional full raymarched black hole. *(H/H)*
- [ ] **C3. Master grade / LUT** across all 8 (tinted toe, filmic shoulder, temperature bias). *(M/M)*
- [ ] **C4. Arc-modulated vignette + edge-only chromatic aberration** (CA spike at Black Hole). *(M/M)*
- [ ] **C5. GPU compute particles** (curl-noise embers/motes/plankton/snow/sparks) for living atmosphere at near-zero CPU. *(M/H)*
- [ ] **C6. Volumetric god-rays pass** (three.js PR #30530) for Sky sun-shafts, Earth Core lava shafts, Ocean caustic columns. *(M/H)*
- [ ] **C7. Diegetic "materialize" transitions** where a streaming cut is unavoidable (biome assembles within the continuous move). *(M/M)*

---

## 7. Definition of done / verification

The user re-captures Odyssey screenshots in their desktop session after each phase (the screenshot loop is the acceptance test). A change is done when, across a fresh capture set:
- **No journey frame is >50% empty void** (black OR white-fog) — the primary metric.
- **No discrete portal-ring/halo is the perceived transition** — adjacent biomes are visibly co-present at every seam (one shared element carried across).
- **Sky and Space are unmistakably different worlds** (Sky hazy/warm/cloud-filled; Space dark/clear/pinpoint-stars).
- **One mountain language** — Surface's distant range reads as the *same* peaks the Mountains chapter shows up close.
- **No hard rectangular billboard edges**; heroes seat into atmosphere with a rim glow.
- **One consistent path tube** (width/glow) and **no white-blown nodes** — the node is the brightest *saturated* (not clipped-white) thing in frame.
- **The hero is framed for most of each chapter** (not just entry/exit); Earth Core is forward-looking, not top-down; Urban ends on a city payoff, not a wire on black.

Re-run the existing Odyssey unit tests after each edit (`OdysseyDirector.test.js`, `odyssey-p4-environments.test.js`, `LevelNodeManager.test.js`, `odyssey-path-layout.test.js`) to confirm data-layer changes (profiles, path, seams) stay green.
