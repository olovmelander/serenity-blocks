# Odyssey — Chapter 8: the neon city (2026-10-20 overhaul, CH8 lane)

**Status: on `feature/odyssey-overhaul-ch8` (base main d557160a), not merged.** Part of the
whole-journey visual overhaul. Olov's brief: "can chapter 8 be inspired from Neon District?" —
chapter 8 (Urban Dreams, orbs 57–60, the finale after the black-hole warp; orb 59 IS Neon District
and the chapter plays its track) as a stunning rain-soaked neon city with Neon District's craft,
keeping the 7→8 seam (the warp tunnel's mouth opening onto the Retrosun) continuous, the orbs and
rail readable, at 120+ fps.

## What it was

A flat synthwave canyon: unlit purple box towers with dotted window grids under one purple haze
ramp, a dead dark street washed by nine additive haze pools and seven haze curtains, twelve
generic scanline cards, eighteen neon tubes sliding down the canyon and nine torus "gates" round
the rail (both read as stray lines), a pink additive cone and four floating torus rings on the
spire, a magenta scanline billboard on a black deck in the bottom centre of the first frames.

## What it is now

Everything below is in CORRIDOR space (the stage frame the city is built in and the camera rides;
the world's up is ~70° off the city's). Materials read their corridor position from one uniform
matrix (`neon.cityFromWorld`) the chapter sets every frame, and the eye from `neon.camCity`.

| Piece | Module | After Neon District's |
|---|---|---|
| City plan: towers (dealt exactly as before), signs, screens, the glow map | `shared/odyssey-neon-city-plan.js` (three-free) | `neon-district-layout.js` (addGlow) |
| The air: haze (exp2, thinner up high) + a STREET MIST integrated along the view ray, coloured by the signs below it; the ignition ring; the spire's light | `shared/odyssey-neon-light.tsl.js` | `neon-district-tsl.js` ndGlow / ndFogAmount / ndHaze / ndAtmosphere |
| Towers lit by the city: glow-map light pooling up the boulevard walls, ledges catching it, wet glass with rivulets mirroring the mist, roofs with gravel, plant boxes, parapets and puddles; hero trims are meters that fill as the ignition passes | `urban-dreams.tsl.js` createFacadeMaterial | `neon-district-facades.js` |
| Tube blades, wall tube signs, lit fascias, roof light boxes, giant LED screens (Hale's breathing ring, Combo's falling blocks, Serenity Transit's sun), each with a halo in the wet air | `shared/odyssey-neon-signs.tsl.js`, `shared/odyssey-neon-glyphs.js` | `neon-district-signs.js`, `-glyphs.js`, `-lights.js` createHalos |
| The wet boulevard: paint, zebras, puddles, chasing kerb LEDs, shop light along the walls, rivers of traffic (white coming, red going, each streaking the wet road), the walls' signs smeared in it, the Retrosun's reflection traced analytically | `urban-dreams.tsl.js` createWetReflectionPlaneTSL | `neon-district-street.js` |
| Rain: strips ≥ 1.5 px lit by what is behind them, in a box that FOLLOWS the flying eye in corridor space while every drop keeps its column | `shared/odyssey-neon-rain.tsl.js` | `neon-district-weather.js` createRain |
| Sky traffic: canyon decks + cross-town streaks, one draw | `shared/odyssey-neon-traffic.tsl.js` | `neon-district-lights.js` createTraffic |
| Smog ceiling lit from below, rose over one district and cyan over the next | `urban-dreams.tsl.js` createSkyGradientTSL | `neon-district-sky.js` |
| Lantern strings across the boulevard below the rail | `shared/odyssey-neon-lanterns.tsl.js` | the street's lanterns |
| Glazed skybridges seated between real inner towers | `shared/odyssey-neon-skybridges.tsl.js` | the lit bridges |

Nothing is imported from `src/themes/neon-district/` (Rollup puts a theme folder in one chunk);
the code is copied and adapted, each module credits its source file.

**The spire powers the city.** One clock (`urbanIgnition`): the arrival city is half lit (a fifth
of the signs dark, dimmer mist and windows); as the ignition ring spreads from the spire, signs
spell on letter by letter as it passes, the mist takes the signs' colour, the windows come up and
the hero trims fill. The spire's pink cone and four torus rings are retired for a needle mast of
the same conduit carrying a blinking red beacon.

**Retired:** the nine torus ring gates, eighteen traffic tubes, twelve holo cards, nine haze pools,
seven haze curtains, the gate bridge's pylons and magenta billboard, the spire's frames and cone,
and the two corridor-field sheets for chapter 8 (`odyssey-corridor-field.js`: an A/B on the bench
showed no difference left for them to make).

**Not restaged** (research item 5): the street stays at corridor y −60, the eye ~70 u above it.
Seen from the rail the chapter reads as a flight over a canyon (a spinner's view, not a pedestrian's),
the neon sits on the walls around and below the eye, and raising the street would put the inner
walls above the eye, cover the Retrosun/skyline composition the 7→8 carry lands on, and move every
tower the tier and layout tests pin.

## Numbers

In-game captures (Extreme, WebGPU, 1280 x 720, 8 stations, `--time=9 --envTime=30`), against the
integrator's BEFORE gallery of the same stations:

| | Before | After |
|---|---|---|
| Draw calls per station | 73–91 (≈ 84) | 42–49 |
| Triangles at local 0.45 | 279.5 k | 254.3 k |
| 7→8 seam, max luma step per 0.01 p (gate ≤ 45) | — | 24.7 (PASS), 16 samples p 0.9009 → 1 |
| Console (WebGPU, WebGL2, Low, seam) | — | clean: no errors, no validation messages |

Frame interval on the bench (`ch8-neon`, High, the real post, 1920 x 1080, vsync and the frame
limit off, RTX 3070 laptop), BEFORE (main d557160a's chapter on the same bench) and AFTER
alternated twice on a machine shared with other sessions:

| local | before p50 / mean (ms) | after p50 / mean (ms) |
|---|---|---|
| 0.45 | 2.1 / 2.2, 1.6 / 1.7 | 1.6 / 1.7, 2.6 / 2.9 |
| 0.90 | 2.6 / 2.6, 3.3 / 3.5 | 2.0 / 2.1, 2.5 / 2.8 |

The two are inside each other's noise: no measurable cost at ~300–600 fps uncapped. Hiding every
new emitter (signs, halos, rain, traffic, lanterns, skybridges) moved the after frame by
~0.2 ms p50. The glyph atlas bake (once a session, at chapter creation, during the journey
load) is ~17–23 ms of CPU; the glow-map bake and the plan a few ms.

Captures: `$S/lanes/ch8/cap/ch08-v5/` (+ `sheet.png`), `seam-7-8-v5/` (+ `-luma.txt`),
`ch08-v4-webgl/`, `ch08-v4-low/`, before/after `$S/lanes/ch8/compare/before-after-ch08.png`.

## Bench

`?effect=ch8-neon&orbit=0&t=9&cityT=<0..1>` — the shipping chapter with the real rail, camera,
director, corridor field and the REAL Odyssey post (bloom + ACES + grade), so emitters are judged
through the tone curve they are authored for. `air=mistDensity:0.006,mistGlow:0.3,...` A/Bs the
air without a rebuild; `hide=`, `field=0`, `post=0`, `tier=`.

## Traps met

- **MSAA extrapolates uv on thin far geometry** (SKILL table): the skybridge roof's `exp(-5·edge)`
  of a negative edge distance overflowed into a magenta bloom blob in the middle of the frame.
  Clamp interpolated coordinates before any `exp`.
- An unlit sign must still read as glass (a faint line of its colour), or the arrival city is
  full of blank dark slabs.
- Signs, halos, rain, traffic, lanterns and the beacon are premultiplied "over" with alpha 0
  (pure addition that leaves the target's alpha alone); their 7→8 fade rides `uOpacity` because
  the manager's `material.opacity` would only scale an alpha that is 0.

**The 7→8 seam.** The city's new emitters nearer than chapter 7's black-hole window shone over
the warp tunnel before its mouth opened (the first in-game seam capture showed signs floating in
the tunnel at p 0.9489). They now arrive THROUGH the mouth: `neon.seamReveal` follows the carry's
`open` ramp (urban-dreams-sun-carry.js) and fades the signs, halos, lanterns, traffic and
skybridges. The Retrosun's reflection in the street rises after the hand-over (local 0.05–0.15),
since the disc itself switches over on one frame and its reflection has no twin in chapter 7.
Sheet lightning (one flash per 26 s window, closed form in the clock) is off at the capture time.

## Open items

- **Tower windows over the tunnel** (pre-existing, not changed here): the nearest towers' lit
  windows still show faintly over the warp tunnel just before the mouth opens (they are nearer
  than the black-hole window and fade on the manager's coverage schedule). The same `seamReveal`
  could gate them; left for the integrator, who owns the tunnel side of the seam.
- **Rain on the lens** (Neon District's `neon-district-glass.js`) is a post feature and belongs
  to the integrator's pipeline: the obvious next step for the finale. Proposal: the glass pass
  gated to chapter 8's weight, beads lit by the frame behind them.
- **Interior-mapped rooms** (research item 6) were not ported: at this eye height the nearest
  windows are 15–40 u away and the flat lit floors already read; the gating cost (≈ 16 fps once
  in Neon District before it was gated) did not look worth it.
- No perf-lane (ADR-0016) reading; the bench A/B above is the evidence. No iGPU reading.
- The bench's director runs at a fixed 1/60 step so a `?t=` frame settles; the post and the
  path renderer see `delta = 0` after the first frame, as on the other chapter benches.
