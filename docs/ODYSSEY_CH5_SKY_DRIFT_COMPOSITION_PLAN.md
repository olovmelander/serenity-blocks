# Odyssey Ch5 "Sky Drift" — composition overhaul (2026-06-15)

Screenshot-grounded review of Chapter 5 in the live playground harness
(`?effect=ch5-sky-drift`, which mounts the shipping `createSkyDriftEnvironment`, the real
`OdysseyPathRenderer`, the live `OdysseyCameraController` + `OdysseyDirector`, and the
shipping TSL builders — so every tweak here ports directly into Odyssey mode). Same
discipline as `surface-world-environment.test.js`: compose the shipping builders, don't
fork shaders.

## Measured baseline (v4, WebGPU, 1280×720)

Live geometry read from `window.scene`/`window.camera` in the harness:

| skyT | cam pos | cam dir (pitch) | hero-crown NDC y | aurora NDC y |
|------|---------|-----------------|------------------|--------------|
| 0.0 (entry) | (-215, 397, -488) | (0, 0.9, -0.4) **~65° up** | off-frame | ~0.6 (hems only) |
| 0.5 (mid)   | (-216, 511, -531) | (0, 0.9, -0.4) **~69° up** | center-hero ~0.6, sides ~0.6–2.2 | **1.1 – 1.9 (above top edge)** |

World placement (locked Ch4 hero chain, inherited as the "receding summit ring"):
- `ch4-left-main`  base y 317, z -919, crown ~641
- `ch4-right-main` base y 307, z -969, crown ~613
- `ch4-center-hero` base y 297, z -1059, **crown ~945** (towers above the aurora)
- aurora curtains: env-local y 34–96 → world y 575–637, z -674…-1194

## Diagnosis (what's wrong, from the captures)

1. **Camera stares ~65–69° up at empty sky the whole chapter.** Caused by the near-vertical
   Ch5 path tangent (≈0.9) feeding `climbBias` (+2.7 up) + positive `lookUp`. This splits the
   frame: **peak bodies fall below the bottom edge, the aurora projects ABOVE the top edge**,
   leaving a washed pale-blue middle (entry/mid screenshots are essentially empty).
2. **Mountains effectively invisible** for most of the chapter — only crown tips reach the
   frame; the dramatic snowy mass is below. The user reads this as "no mountains". Only the
   late shot (skyT 0.78) swings a peak into the left third (the one strong frame).
3. **Aurora is not the hero.** It sits at/above the top edge (NDC y 1.1–1.9), so the user sees
   faint, edge-cut hems instead of a sweeping curtain. Anchored too high *for this up-pitched
   camera*, and the brightest folds are out of view.
4. **Empty/washed sky** in the middle band — cloud strata too thin to carry the dead center.
5. **"Path drives into the mountain"** read — needs a framing/placement check that the rail
   visibly *clears* and sweeps *past* the peak mass rather than stabbing into it.

## Target composition — "the ascent past the peaks, aurora as hero"

The canonical aurora-over-mountains hero shot, staged as a 3-beat ascent:
- **Entry**: snowy peaks anchor the **lower third**, the aurora **rises behind them** across the
  upper two-thirds, warm sun gilds one side. Peaks dominant, aurora promising.
- **Mid**: aurora is the unmistakable **hero** — a wide, bright, arcing curtain across the upper
  frame; peaks **receding** in the lower third but still clearly present.
- **Late**: **crane up** into the aurora/sun canopy as the rail leaves the peaks behind → the
  Sky→Space hand-off. The peaks sink out the bottom *last*, never just vanish.

## Levers (Ch5-scoped first; global spline only as last resort)

1. **Camera framing** — `resolveChapter5Framing` + the `CHAPTER_5_*` records in
   `OdysseyCameraController.js`. Swing `lookUp` strongly **negative** at entry/mid to cancel
   `climbBias` and drop the horizon (peaks + aurora) into frame; stage it back **up** for the
   late crane. Tune `lookForward`/`lookRight`/`camUp`/`camForward` so the big center peak rides
   the rule-of-thirds and the aurora sweeps the upper band. Target: hero-crown NDC y ≈ -0.2…0,
   aurora hems NDC y ≈ +0.2…0.7.
2. **Aurora curtains** — `createAuroraRibbonsTSL` / `createAuroraRibbonTSL` configs in
   `sky-drift.tsl.js`. Re-tier heights so the curtains **arch OVER the peak band** (raise the far
   curtains into a dome, keep a near hero curtain straddling the rail), widen + brighten the
   hero folds, pull the central sweep toward x≈0 so it reads edge-to-edge behind the summit.
3. **Mountain presence** — keep the inherited hero chain readable the full chapter (it already
   is world-locked + camera-pass gated); make sure framing keeps the mass in the lower third and
   the rail clearly clears it.
4. **Sky / cloud richness** — `createSkyGradientTSL` + `createCloudStrataTSL`: give the middle
   band structure (denser/brighter silver-lined strata behind the peaks, warmer sun horizon) so
   no washed empty gap remains.
5. **Spline (last resort)** — only if framing can't deliver "peaks visible full chapter" +
   "rail clears the mountain": gentle the Ch5 segment of `odyssey-layout.js` control points
   (indices ~14–17) toward a more forward-sweeping, less vertical ascent. Verify Ch4/Ch6
   framing + `odyssey-path-layout.test.js` stay green before/after.

## Outcome (2026-06-15, screenshot-verified in the harness)

Root cause turned out to be the **camera**, not (mostly) the spline: the near-vertical Ch5
rail rolled the horizon ~42° and craned the eye ~69° up at empty sky, so peaks fell below
frame and the aurora projected above the top edge. Spline gentling was rejected — the giant
canonical hero peak leaves the rail only ~25 units of xz clearance margin, so the original
verticality is **load-bearing for mountain clearance** (path already clears by 78; "into the
mountains" was the *camera aiming at the peak*, not a real intersection).

What landed (all Ch5-scoped, ports straight into Odyssey mode):
- **Camera** (`OdysseyCameraController.js`): two new data-driven framing fields — `worldUp`
  (blend the up-vector to world-up → roll 42°→~3°, level horizon) and `climbScale` (scale the
  climb up-push → 0 for Ch5 so the aim drops to the horizon). Ch5 framing restaged as a V:
  entry pitch ~35° (peaks + rising aurora), mid ~27° (the most level — aurora-over-peaks hero),
  exit cranes to ~36° + relaxes `worldUp` for the Sky→Space hand-off. Defaults (0 / 1) leave
  every other chapter untouched.
- **Aurora** (`sky-drift.tsl.js` `createAuroraRibbonsTSL`): the 6 curtains re-tiered into an
  ARC that climbs with depth (world y ~760 near → ~1150 far) so it sweeps the upper frame
  BEHIND/ABOVE the peaks; widened + taller + brighter; staged to read from entry (stage floor
  0.28→0.72).
- **Sky** (`createSkyGradientTSL`): zenith + midSky deepened to a twilight indigo from entry so
  the additive aurora reads against a dark canvas while the warm sun keeps the horizon band.
- **Tests**: `OdysseyCameraController.test.js` updated to the new V-staging + the two new
  fields; full odyssey suite (94 tests) + path-layout clearance test green.

Result: mountains visible the WHOLE chapter (were absent except late), aurora is the bold hero
sweeping behind the peaks at every beat, level horizon, genuine crane-up ascent into space.

Deferred (lower value / out of scope / GPU-fragility): shared path-rail brightness + level-node
ring (shared renderer), heavier cloud strata, late/exit aurora reading slightly "rainbow".

## Follow-up pass (2026-06-15) — 5→6 seam pop + Ch6 alignment

### 5→6 pop (FIXED + tested)
The inherited summit chain + aurora "popped" at the Sky→Space hand-off. Root cause: the
ChapterEnvironmentManager fades the Ch5 env via `group.userData.chapterOpacity` but **cannot
reach the summit/aurora NodeMaterials** (alpha flows through opacityNode/uOpacity), and it
hard-flips `group.visible=false` at the (short, 0.3-of-Space) carry-band end. The Node probe
showed the camera **never physically passes the hero peak in Ch6** — it stays ~400u in front
(z −594→−713 vs peak −1059), the peak at 53–92° off-axis the whole act — so the camera-pass
fade never fires and the only thing removing them was the hard visible-flip.
- Manager: the 5→6 carry now **holds** the Ch5 env fully present (`SEAM_56_CARRY_HOLD_BAND`
  0.4 of Space span) then **eases** it out over a long tail (`SEAM_56_AURORA_CARRY_BAND`
  0.3→0.85), so the inherited peaks/aurora dissolve as the camera moves on.
- sky-drift: multiplies `chapterOpacity` into the summit-ring + aurora uniforms (so the
  manager's smooth fade reaches them), and `resolveSkyDriftAuroraExitOpacity` rebased to a
  **held-then-eased recede over the Space span** (ch6→ch7), matched to the carry.
- Tests updated (`sky-drift-environment.test.js` held-dissolve + monotonic; full suite green).
- Verification: logic + unit tests (the playground harness has no manager, so chapterOpacity
  defaults to 1 there; the seam itself is a with-manager / in-game behaviour).

### Ch6 hero alignment (DIAGNOSED + harness built; camera re-aim deferred)
Built `src/playground/effects/ch6-cosmic-expanse.effect.js` (the Ch6 twin of the Ch5 harness,
with a `window.__SPACE__` hook). Live NDC measurement across the chapter:
- The Ch6 camera looks **hard up-and-right** (dir.x 0.66→0.95) because the spline **sweeps
  right** (cam x −211→−5, tangent yaw ~54°) — and path-frame `lookRight` is the wrong lever at
  that orientation (same degeneracy as Ch5's vertical tangent), so framing can't counter it.
- The heroes (black hole / gas giant / galaxy) are placed **down-corridor (deep −z)**, so they
  fall **off the left edge** (NDC x −1.2 to −7) for most of the act; at spaceT 0.5 they're far
  off; by spaceT 1 they're behind the camera.
- Unprojecting target framings showed the heroes would have to move to **extreme up-right** (y
  1400+, x 700+) to suit the current aim — i.e. the **camera** needs the work, not just the
  hero positions. This is a substantial pass (a Ch6 camera re-aim like Ch5's worldUp/lookUp
  treatment, plus hero re-placement), best done in a fresh-GPU session. NOT shipped as a blind
  hero shift (would likely cluster them high-right / off the other edge without verification).
- NOTE: the dev iGPU degraded over this long multi-chapter session (repeated WebGPU page
  resets/black frames) — the documented TDR risk — so Ch6 was stopped before visual iteration.

## Method / guardrails
- Playground-first, **screenshot every change** with chrome-devtools MCP; fixed `?t=8` for
  reproducible phase-locked frames. Single chapter only (no full-journey capture — TDR risk).
- Keep `sky-drift-environment.test.js` + `OdysseyCameraController.test.js` +
  `odyssey-path-layout.test.js` green.
- Capture v5 entry/mid/late into `.playground-shots/` when each beat lands.
