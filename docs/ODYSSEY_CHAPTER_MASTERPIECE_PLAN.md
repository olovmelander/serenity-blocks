# Odyssey Journey — Chapter Masterpiece Plan

**Status:** Review + next-wave production plan, June 12 2026.
**Relationship to prior plans:** `docs/ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md` (June 11) remains the **art-direction law** — its palettes, value specifications, seam atlas, and acceptance criteria are not restated here and still bind every chapter. This document is what comes *after* it: a validation review of where the journey actually stands today, and the plan for the wave that turns each chapter from "correctly specified" into "blows your mind."

---

## 1. Where the Journey Actually Stands (Review Findings)

### 1.1 The baseline captures confirm the diagnosis — and sharpen it

A fresh frame review of the 201-frame baseline set (`artifacts/odyssey/journey_old/`, June 7) confirms every major finding in the creative plan, with four sharpened observations:

1. **Chapter 2 is worse than documented.** Every sampled frame (03, 08, 13, 16, 19) is a *flat bright-cyan caustic wallpaper* — there is no depth ladder at all, not a weak one. Frame 08 is a uniform texture wall with zero value structure; the "dark floor" does not exist in any frame. The plan's "get darker before lighter" inversion is the single most important fix in the chapter.
2. **The rail glow is the journey's accidental hero.** In Chapters 3, 4, and 5, the white-hot path ribbon + marble bloom is the brightest, highest-contrast element on screen in nearly every frame (Ch4-12/22, Ch5-06/15/21 are extreme cases: the rail is the *only* structure in the frame). The worlds are losing the figure-ground battle to the UI of the journey itself. No chapter section in the prior plan owns this defect — it is now a journey-wide law (§4.1).
3. **Chapter 8's city never reads as a city.** It is not merely under-lit: at no sampled frame (02, 07, 11, 12) does *architecture* exist — only floating confetti-tile mosaics against RGB-black. The implemented skyline/haze/sun stack (§2, Ch8) is therefore the single highest-visual-leverage unverified work in the project.
4. **The debug HUD pollutes every baseline frame.** The AAA-spine panel and dashed magenta path-line are the darkest/most-saturated elements in many pale frames (Ch5 especially, where the HUD is literally the only dark value on screen). Review captures must run with the overlay off, or every value judgment is contaminated.

Chapter-by-chapter one-liners from the visual pass (frame numbers cite the baseline set):

| Ch | Baseline verdict (confirmed by own review) |
|----|--------------------------------------------|
| 1 | Strong fracture-plate magma material wasted on repeating two-sphere compositions floating in an orange particle wash; close passes (06, 10, 14) decompose into flat triangular planes; no enclosure, no destination; seam sphere survives into the rail recolor (17). |
| 2 | Flat cyan wallpaper end-to-end; life = rail-beaded specks; white slab panes intrude by 19; the caustic ceiling beat (19) is the only composition with a structure worth keeping. |
| 3 | Pastel value collapse; mint-cone trees at ground value; lime rail clashes with everything; birds (07, 15) are the chapter's only living asset; winter exit (27) approaches whiteout behind ghost peaks. |
| 4 | One pale blue-grey band the whole chapter; V-notch silhouettes are flat untextured shapes; no snowline, no foreground, no scale cue; path glow owns every frame; lilac drift from 28. |
| 5 | The journey's most severe failure: 06–27 are a near-uniform lavender field; the white rail is the only structure; aurora = faint lilac smears (15, 21). |
| 6 | Lavender→black hard cut at entry (05→08); genuinely good crimson filament material mid-chapter (18) but two-tier composition — rail leads into pure black, no midground, no visible black hole in body frames; portal eye (30) readable with faint moiré. |
| 7 | A barbell: excellent accretion entry (03) and tunnel mosaic (25), bridged by frames of literal RGB-black with nothing but the pink ribbon (09, 15). |
| 8 | Bi-modal salt-and-pepper; full-bright confetti windows vs pure black; a dead horizontal void band mid-frame (07); no sun, no skyline, no architecture anywhere. |

### 1.2 The creative plan has been implemented — and none of it verified

The working tree audit (now commit `0d9ee80`) shows the June 11 plan's directives are **near-fully implemented in code** — far beyond Wave 1. Spot evidence per chapter:

| Ch | Implemented (code evidence found) | Notes / risk |
|----|-----------------------------------|--------------|
| 1 | `createFirstHeartTSL` (earth-core.tsl.js:1067), `createColonnadeWalls` (earth-core.js:1396, merged single-geometry), `createSeleniteChamber` (chapel), molten **basins** [0.05, 0.42, 0.8] feeding `createLavaFloor`, tether-streams, cluster cap 2→6 | Whole Wave-3 asset list present. Unverified whether the Heart reads from frame 01 at its authored scale. |
| 2 | `createVentGlowTSL` (drowned First Heart at entry), `createSkylightPanes` (staged 2→3 approach), `createPearlGateTSL` (nacre ring ON the rail), manta work (11 refs in .js, 23 in .tsl), plankton **three depth TIERS** with brightness budget "~40% below the old 1.55×0.95" (deep-ocean.js:730–754) | The chapter needs the *darkness inversion* verified above all — tiers help only if the field actually darkens. |
| 3 | `createSpruceTreesTSL`, `createCabinTSL`, `createForegroundPassByTSL` (FG dark-anchor layer), `uSeason` scalar (surface-world.js:289–295) driving season-scripted light | Water gold-glitter read and fog-density drop need capture confirmation — the wash was chapter-defining. |
| 4 | `createBannerPlume` (rose-backlit, capped bloom), `createPrayerFlagLine`, `createCairnsAndCross` (Gipfelkreuz), `createEagles(3)`, spindrift rework, camera framing overrides (+92 lines in OdysseyCameraController.js) | The four-band value structure and snowline are tuning outcomes, not assets — only a capture can confirm. |
| 5 | `uDusk` scalar (sky-drift.js:244–251) staging "faint 10% → hero 35% → corona 80%", `SKY_AURORA_EXIT_BAND` 0.34→**0.15**, receding `summitRing`, `createLenticularCloudTSL`, `createNoctilucentVeilTSL`, `createIceCrystalsTSL`, `createDarkWispsTSL` | Highest-risk chapter for "authored but washes out": every one of these is additive over what was a bright lavender field. The dark backstop must land first or nothing else reads. |
| 6 | `createAsteroidGarland` (instanced, zero-alloc tumble), `createAuroraFilamentBridge` (green→crimson carried element), `createStreakMotes(90)` | Black-hole re-aim onto the rail vanishing point not directly confirmed in audit — verify on capture. |
| 7 | Lensed **fold arcs** (black-hole-transcendence.js:226–244, additive, emitsBloom, top+bottom of shadow), `createAmbientWashTSL` violet floor, `createCorridorDustTSL` | The 6→7 ~1002 ms seam hitch fix is *not evidenced* in the audit — treat as open until HUD-measured. |
| 8 | `createSkylineSilhouetteTSL` ×2 (z −1120/−1145, in front of sun at −1180), `createHorizonHazeTSL`, **sun radius 240→320** with reveal idling at 0.45 (urban-dreams.js:622–623), WINDOW VALUE TIERS (urban-dreams.tsl.js:410), **Gate Bridge** (urban-dreams.js:456–460) | The sun has failed to land on screen once already at radius 240/alpha 0.78. Radius 320 + idle 0.45 is a guess until captured. |
| Seams | Airglow membrane implemented as the 5→6 threshold (ChapterThresholdDirector.js:81, chapter-threshold-director.tsl.js:141–150 — thin olive band sweeping bottom→top); threshold TSL +35 lines; post pipeline +34 lines | The 5→6 luminance crash and 6→7 hitch remain the two seams to measure first. |

**The conclusion that drives this whole plan:** the project's recurring, *proven* failure mode is "authored in code, absent on screen" (the radius-240 synthwave sun, Ch7's mounted-but-invisible midsection systems, Ch4's landed-but-unverified de-wash). An enormous implementation wave just landed. Until it is captured, **no further visual code should be written against assumptions** — the next unit of work is verification, then targeted readability tuning, then (and only then) the masterpiece elevation in §3.

### 1.3 Hardware constraint — captures are currently dangerous

This machine (AMD Radeon 610M iGPU) has Windows kernel evidence of GPU watchdog events (`LiveKernelEvent 117`) and two `VIDEO_TDR_FAILURE` bluescreens on June 6, 7, and 9 — the prior Odyssey capture sessions. Three capture attempts on June 12 all died silently during WebGPU shader prewarm (chapters 4–6). The full 200-step journey capture is currently a machine-stability hazard, not just a workflow inconvenience. §5 defines the TDR-safe capture protocol; the per-chapter harness `scripts/odyssey-earth-core-quick-capture.mjs` added in `0d9ee80` is the right template.

---

## 2. Wave V — Verify (capture truth, no visual code)

**Goal:** one TDR-safe capture cycle that converts every "unverifiable" in §1.2 into pass/fail against the June 11 plan's own acceptance criteria.

1. **Capture per chapter, not per journey.** Generalize `odyssey-earth-core-quick-capture.mjs` into `odyssey-chapter-capture.mjs --chapter N`: boot, prewarm *only that chapter ±1* (the manager already supports lazy creation), pan that chapter's local range in ~20 steps, quit. Eight short GPU sessions with cool-down beats instead of one 200-step marathon inside the TDR window.
2. **Capture at reduced load:** 1280×720 window, pixel ratio 1.0, quality preset High (not Extreme), `?skipIntro=1&odysseyAAA=1` with the **debug overlay disabled** — the HUD/path-line contamination in §1.1 must not recur. Add an explicit overlay-off flag if one does not exist.
3. **Capture both backends once:** the WebGL2 fallback (`?forceWebGL=1`) for chapter 1 only, as a parity smoke check.
4. **Measure the two suspect seams** (5→6 luminance ramp, 6→7 hitch ms on the HUD) in a dedicated two-chapter session.
5. **Review protocol per chapter:** grayscale value-band check, >50%-void law, hero-visibility check (the chapter's destination landmark identifiable at 10%/50%/90% local progress), figure-ground check (is anything brighter than the rail?), and the trailer-frame test at ~30%/60%/90%.

Deliverable: a pass/fail matrix against the June 11 acceptance criteria, committed as `docs/ODYSSEY_WAVE_V_CAPTURE_REPORT.md`. Wave R items below are pre-authorized fixes for the *expected* failures; anything that passes gets struck.

---

## 3. Wave R — Readability (the expected tuning pass)

These are the parameters the audit flags as most likely to fail the capture, with the fix direction pre-agreed so the next session can tune without re-deriving intent. All are tuning, no new assets.

- **Ch8 sun:** if the 320-radius disc still does not subtend ~25–30% of frame height in frames equivalent to 06–10, stop scaling and *move it nearer* (pull from z −1180 toward −900) — apparent size, not authored size, is the acceptance criterion. Check `discAlpha` 0.78 × reveal 0.45 ≈ 0.35 effective alpha survives ACES against the haze card behind it.
- **Ch5 stack:** the dark backstop is the gate for everything. If the moonlit deck's ink cores do not register as a *mid-dark band* in grayscale by ~40% progress, darken the deck before touching any aurora parameter. Only then judge the hem/body/cap colors.
- **Ch7 midsection:** if frames equivalent to 07–14 still sit below the violet floor (#120A21), raise `createAmbientWashTSL` base luminance and the corridor-dust alpha *together* — they are one read. The fold arcs (opacity 0.62) must be visible at lock distance; if not, widen the arc bands before brightening them.
- **Ch1 First Heart:** must be identifiable in frame 01 as a distinct incandescent point between the colonnade brackets. If it reads as "more orange in an orange scene," cool and darken everything in a 30°-cone around it (the enclosure treatment owns this) rather than brightening the Heart — the white tier is already at its bloom cap.
- **Ch2 darkness inversion:** entry third must hit the abyssal #04101f family. If the gradient still floats bright, the caustic ceiling texture itself (the wallpaper of frame 08) needs its mid-chapter visibility gated by progress, not just re-tinted.
- **Ch4 value bands:** if shadowed snow still reads grey instead of blue (#8FB4DC), fix the snow material's shadow pole before anything else — "blue, never grey" is the chapter's entire de-wash. Confirm the notch-crossing no longer blooms out (climax caps landed in code; verify).
- **Ch6 hero aim:** confirm the black hole rides the rail's vanishing point through the 13–25 stretch. If the `APPROACH` endpoint re-aim did not land, this one fix removes the chapter's dead air at zero asset cost.
- **Journey-wide figure-ground (new law, §4.1):** per-chapter rail/marble emissive retune so the world's hero outshines the path in every chapter.

---

## 4. Journey-Wide Masterpiece Laws (new — beyond the June 11 plan)

### 4.1 The rail must lose the figure-ground battle — in every chapter

The June 11 plan treats the rail as a compositional spine (correct) but never caps its luminance. The captures prove the rail + marble bloom is the de-facto focal point of Chapters 3–5 and competes in 1, 2, and 6. New law: **in every chapter, the brightest sustained element on screen is the chapter's hero, and the rail sits one value band below it.** Implementation: per-chapter `pathStyle` emissive/glow caps in `shared/chapter-profile.js` + `OdysseyPathRenderer.js`/`odyssey-path-renderer.tsl.js` flow-pulse gains, tuned per chapter at Wave R capture time. The rail may *pulse* to full brightness on beat events (node pass, seam breach) — transient, never sustained. Acceptance: in the grayscale check of any held frame, the strongest light–dark edge belongs to the chapter hero, not the path.

### 4.2 One scripted "I was there" moment per chapter

Trailer frames are necessary but not sufficient — masterpieces are remembered as *moments*: a thing that happened near you, once, with scale and intent. Each chapter gets exactly one scripted proximity event, choreographed against chapter-local progress (all assets exist at create time; events are uniform-driven reveals, zero allocation, ecotone-reachable opacity):

| Ch | The moment | Mechanism |
|----|------------|-----------|
| 1 | **Lava-surf breach** — the camera skims a molten basin as a swell crests toward the lens, embers showering past | Basin swell amplitude keyed to a ±0.03 progress window around basin 2 (0.42); near-camera ember gust burst via existing `createNearCameraEmbers` gain |
| 2 | **The escort** — one manta of the trio holds formation alongside the camera for ~6 s at ~25 u lateral, wing filling a third of frame, before banking away across the corridor | Author manta pass 2's arc as a parallel-track segment in its per-instance path params (deep-ocean.js manta staging); rim + photophores at full read |
| 3 | **The sun behind the Great Tree** — at the Great Tree beat the warm sun disc crosses *behind* the crown, edge-lighting the canopy and throwing one long god-ray fan toward the camera | Key the sky-dome sun azimuth (already season-driven via `uSeason`) so alignment lands at the Tree's progress station; brighten crown-gradient rim for the window |
| 4 | **The wall** — the rail grazes a sheer strata face close enough to fill the left third of frame, spindrift ripping off its edge, then releases into the V-notch reveal | Camera framing override (the +92-line OdysseyCameraController work is the canvas) + one near-path cliff card with strata shading; compression→release pacing |
| 5 | **Corona overhead** — during the existing camera-roll energy at ~80%, the zenith corona bursts radially overhead while vertical aurora-photon streaks rain past the camera | The authored corona spike + a short-lived vertical streak tier on the ice-crystal system, gated to the corona window |
| 6 | **The pass** — one garland asteroid crosses within ~15 u at high parallax speed, accretion-orange rim light sweeping across its silhouette as it tumbles past | Stagger one asteroid seat onto a near-corridor crossing track; rim term keyed to hole direction (both exist in the garland material) |
| 7 | **Disk-plane crossing** — the camera crosses the accretion plane: the disk closes to a razor edge-on line for two beats, then reopens below — the Interstellar beat | The camera-locked hero already tracks the camera; add a scripted pitch offset in its lock update across a ±0.02 progress window |
| 8 | **Under the Gate Bridge** — the implemented bridge pass becomes an event: its mega-billboard floods the lane magenta, rain backlights, and for one beat the bridge's shadow swallows the path glow before the sun re-reveals | Gate Bridge exists; add a brief path-glow dip + billboard gain in `updateUrbanDreamsEnvironment` keyed to the bridge's progress window |

These eight moments are the marketing reel. Each must pass as a 3-frame sequence (approach / peak / release), not just a still.

### 4.3 The journey breathes with the music

`OdysseyAudioReactor`/`OdysseyDirector` (committed June 2) already expose energy/bass/beat state, and `uPulseIntensity` is plumbed through Chapter 1's builders. Extend the same single-uniform discipline to every chapter's *hero only*: the First Heart's 0.2 Hz breath deepens on bass; jelly bells pulse on beat phase offsets; god-ray fans swell; the aurora corona rides energy; the accretion disk's `uEnergy` (already wired in Ch7/Ch8 code) couples to the soundtrack; the Retrosun's scanline breathe follows the encore track. One rule: audio modulates *amplitude of an existing motion*, never triggers new geometry — zero allocation, no compile variance. The journey should feel scored, not decorated.

### 4.4 Motion is reviewed as motion

All review to date judges stills; half the art direction (one motion accent per shot, fold-speed ratios, wind vectors, inward-streaming infall) is invisible in them. Wave V captures add, per chapter, one **3-frame burst** (≈0.5 s apart) at the chapter's signature-motion station, and the review checks: does the motion accent aim at the focal? Is there exactly one? Do consecutive frames parallax (the Ch3 06–09 near-duplicate failure)? This costs three extra screenshots per chapter and finally puts choreography under review.

---

## 5. Performance & Stability Law (TDR is a visual defect)

The journey has now crashed its own development machine repeatedly. A chapter that drops to 20 fps or device-removes on an iGPU has no visuals at all — performance *is* the eighth art-direction rule.

1. **Prewarm budget:** the crash window is shader prewarm (chapters 4–6 compile-heavy). Gate: journey boot-to-interactive prewarm must complete on the dev iGPU without a driver reset, measured per Wave V session. If any single chapter's prewarm exceeds its budget, that chapter sheds compile variants (shared materials, fewer builder permutations) before it ships new visuals.
2. **The quality ladder must be real:** Wave V runs Chapter 5 and 6 (the heaviest additive stretch) once at Minimal preset and confirms the new systems (ice crystals, dark wisps, streak motes, asteroid garland, corridor dust ×3) actually degrade — counts, not just opacity.
3. **Standing gates per wave (unchanged from the June 11 plan, now with teeth):** 60 fps, draws <100 in-chapter, additive overdraw ≤3 layers, seam hitch ≤33 ms HUD-measured, zero per-frame allocation, `webgpu-tsl-build.test.js` green.
4. **Pixel-ratio policy** (commit `9095180`) stays the live mechanism for capping odyssey scenes on weak GPUs; any new full-screen-ish additive layer must justify itself against it.

---

## 6. Roadmap

| Wave | Content | Gate to next |
|------|---------|--------------|
| **V — Verify** (§2) | Per-chapter TDR-safe captures, overlay off; seam measurements (5→6 ramp, 6→7 hitch); Minimal-preset spot check; capture report committed | Pass/fail matrix exists; no code written |
| **R — Readability** (§3) | Tune the expected failures: Ch8 sun apparent size, Ch5 dark backstop, Ch7 violet floor + fold arcs, Ch1 Heart isolation, Ch2 darkness inversion, Ch4 blue snow shadow, Ch6 hero aim, journey-wide rail figure-ground (§4.1) | Re-capture passes the June 11 acceptance criteria per chapter |
| **M — Masterpiece** (§4.2–4.4) | The eight scripted moments; audio-reactive hero coupling; motion-burst review discipline | Each moment passes its 3-frame sequence test; perf gates hold |
| **P — Polish** | Final grade nudges in `CHAPTER_SIGNATURES` (last, never first); title-card placement audit; encore loop afterimage (8→1) | Full-journey capture on the user's desktop reviewed end-to-end |

Chapters are independent within a wave; both sides of a seam land together (unchanged law).

## 7. Risks & Non-Goals

- **Biggest risk — tuning blind.** Nothing in Wave R/M starts before Wave V captures exist. The implementation wave was authored against June 7 frames; stacking more code on unverified code compounds the "authored but absent" debt.
- **Second risk — the Ch5/Ch6 additive stack.** Five new additive systems landed in the journey's already heaviest stretch. If Wave V shows fill-rate strain or wash, *remove or gate density first*; the June 11 dark-backstop law outranks any individual system's visibility.
- **Capture-loop cost stands:** verification needs the user's desktop session; batch ruthlessly (one Wave V cycle, one Wave R re-capture).
- **Non-goals (inherited unchanged):** no gameplay/data changes, no engine rework, no imported assets, no grade-first fixes, encore stays an encore. Additionally out of scope here: re-litigating any palette, seam poetry, or acceptance criterion of the June 11 plan — that document remains the law; this one verifies and elevates it.

## 8. Document Map

- Art-direction law: `docs/ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md` (June 11)
- This plan: `docs/ODYSSEY_CHAPTER_MASTERPIECE_PLAN.md`
- Baseline captures: `artifacts/odyssey/journey_old/` (June 7, 201 frames — pre-implementation)
- Implementation wave: commit `0d9ee80` (chapter environments, seams, camera, post)
- Per-chapter capture template: `scripts/odyssey-earth-core-quick-capture.mjs`; journey harness: `scripts/odyssey-journey-capture.mjs`
- Wave V deliverable (to be created): `docs/ODYSSEY_WAVE_V_CAPTURE_REPORT.md`
