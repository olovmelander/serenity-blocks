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
