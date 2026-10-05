# Shifting Sands — visual overhaul (2026-10)

Status: **Reference** (shipped design + evidence). Replaces the 2025 "Arrakis" theme (dune
heightmap + compute smoke + MRT bloom) entirely; there is no earlier design doc to supersede.

Evidence (before/after captures, event beats, perf cells):
[reports/theme-perf-shifting-sands/](../reports/theme-perf-shifting-sands/) and the screenshots
listed in §9.

## 1. What changed and why

The old theme read as a lumpy orange noise field under a flat red sky:

- **Shape.** The dunes were three octaves of Perlin noise with an `abs()` ridge — no slip faces,
  no crests, no wind direction. Grey "worm scar" blotches crawled across the foreground.
- **Light.** One flat diffuse term from a light that matched neither "moon" sprite; no cast
  shadows, no sky fill, so shadow sides were the same brown as the lit sides. ACES pushed the
  whole frame toward red-orange.
- **The worm** was a terrain displacement and a cloud of billboards; nothing in the frame was
  ever a worm.
- **Runtime.** Three compute dispatches per frame (worm path, spice, smoke), `THREE.Points`
  spice that WebGPU draws at 1 px, ~380 large smoke billboards (heavy overdraw on a 1.1 ms GPU
  frame), a fullscreen "blue glow" quad, and a new `PointsMaterial` minted on every line clear
  (a pipeline compile on gameplay). The loop used `setAnimationLoop`, bypassing the target-FPS
  cap, so it rendered every vsync (120+ Hz) at 1.1 ms each.

The rewrite is built around one picture: **Arrakis at the twin-sun dusk.** The suns hang low over
the far erg on the left; the dune ridges between the camera and the suns burn along their crests;
Shai-Hulud breaches there, a black arch against the light. On the right the Sentinel, a
monumental sandstone butte, takes the low sun on its flank under two pale moons. The board is the
**thumper**: every lock sends a ring of lifted sand across the erg, clears blow spice, and a
Tetris calls the worm.

## 2. Architecture

| Module | Role |
|---|---|
| `shifting-sands-theme.js` | BaseTheme lifecycle; `WebGPURenderer` on both backends (WebGPU → WebGL2, `antialias:false, depth:false`); GPU-loss recovery (`registerGpuSurface`, one WebGL2 retry); settings (quality rebuild, renderScale → pixel ratio, reduced motion, `backgroundComboEffects`, `pieceLockRipple`); pointer parallax; the board/HUD rects that feed the post's calm zones (read inside the frame loop at 0, +0.5 and +1.5 s after a trigger — scene build, resize, resume, mode start/stop, game over — no observers, no polling); `safeAnimate` loop under the target-FPS cap; capture flags. No raw `resize` listener (ThemeManager funnel + `VIEWPORT_RESIZED`). |
| `shifting-sands-world.js` | `ShiftingSandsWorld`: builds every element, owns the shared uniforms, the camera rig, the event choreography and the level dusk. Shared with the playground effect. |
| `shifting-sands-composition.js` | The rest rig (Hor+ 50° lens, horizontal FOV capped at 100°), the authored directions (suns, moons, Sentinel, wind, breach sites), the DOM rect reader. |
| `shifting-sands-terrain.js` | `DuneField` (CPU dune function), the polar-grid bake, the sand material. |
| `shifting-sands-sky.js` | The opaque sky dome: gradient, Mie glow, crepuscular rays, cirrus, twin suns, moons, stars. |
| `shifting-sands-rocks.js` | The Sentinel, its spires, the left outcrops and the Shield Wall escarpment — one merged mesh, one material. |
| `shifting-sands-worm.js` | The worm tube (vertex-animated on the breach path, one instance per worm slot) and the `WormDirector`: where a worm may breach, when, and every mark it leaves, closed-form from the sign to the last settling dust. |
| `shifting-sands-fx.js` | Worm sand (cascade, spray, burst, churn, surge, slump), spice motes, spindrift, spice blows — four instanced systems. |
| `shifting-sands-post.js` | One `RenderPipeline`: scene pass → soft-knee bloom (Medium+) → one output pass. |
| `shifting-sands-tsl.js` | Shared TSL helpers (all `setLayout`-wrapped), the value-noise texture, the one atmosphere. |

Playground: `playground.html?effect=shifting-sands` mounts the same world and post
(`quality=`, `board=1`, `event=lock|combo|clear|tetris|levelUp&eventAge=…`, `dusk=0..1`,
`parts=dunes,sky,rocks,worm,fx`, `falseColor=1`, `noPost=1`, `rays=`, `bloom=`, `icon=1`; for the
worm: `breach=1` makes `?t=` count from the idle worm breaking the sand, `cycle=<n>` picks the
cycle, `wormAz/wormDist/wormHeading/wormLeap/wormR` hold it at a site, `follow=1` aims a tight
lens at it — `followFoot=up|down`, `followLift=<units>` — and
`window.__PLAYGROUND__.diagnostics()` reports where and when the worms are).
In game: `?shiftingSandsTime=<s>` freezes a deterministic frame, `?shiftingSandsFixedDt=<ms>`,
`?shiftingSandsParts=…`, `?shiftingSandsFalseColor=1`, `?forceWebGL=1`.

**Everything that moves is closed-form** in the world clock plus event timestamps (worm path,
grains, motes, spindrift, spice blows, thumper rings): frame-rate independent, seekable, and
nothing is created at event time — every event is a uniform write into a pooled slot (unit-tested:
the scene graph is identical before and after a burst of events).

## 3. Composition

- **Lens:** 50° vertical, Hor+, horizontal FOV capped at 100°. The rest camera stands 36 units
  above the local sand, pitched −4.4°: the far horizon sits just above centre, so both side zones
  hold sky above and erg below.
- **Left zone (contre-jour):** sun A (ember gold, Ø 3.5°) at az −30.5°/el 4.6°, sun B (white gold,
  Ø 1.4°) at az −23.5°/el 11.2°.
- **The worm has no fixed place** (§4, *Worm director*): it breaches anywhere in the erg that is
  in view. In front of the suns it is a black arch against the light; elsewhere it is side-lit, and
  its sand is shaded to read in any light.
- **Right zone (side light):** the Sentinel at az +30.5°, 2350 units out (430 tall, a talus
  pedestal under a fluted cliff and a pale caprock), clear of the stats HUD; two spires; the
  moons above it at az +31°/+38.5°.
- **Below the card:** the near dune slope, ripples, glitter; the thumper rings cross it.
- Unit-tested at 4:3, 16:10, 16:9, 1600×769 and 21:9: suns left of the card and above the
  horizon, moons and Sentinel right of it, and — over forty idle cycles per aspect — both feet of
  every breach on screen and beside the card and the HUD.

## 4. Elements

- **Dunes.** A rolling draa swell under transverse barchanoid ridges: gentle windward slope, razor
  crest, slip face at the angle of repose (34°, unit-tested), crests warped into sinuous lines and
  broken into crescents whose horns run downwind, plus a weaker cross-dune set. The wind blows from
  the camera toward the suns, so the windward slopes face the viewer and take the low light at
  grazing angles. The far field relaxes into a hazy plain (no aliasing at the horizon).
- **The bake (once, CPU).** A polar grid around the camera's foot (columns uniform in azimuth, rows
  geometric in distance: uniform vertex density on screen). Per vertex: height, the ridge phase
  `u` and its gradient, the ridge amplitude, the gradient of everything else, the tangent of the
  horizon toward the suns (one geometric march on a sub-grid, bilinearly filled; formations join
  it as solids, so the Sentinel throws a long shadow), and a spice-stain mask.
- **Sand, per pixel.** The ridge slope is re-evaluated *exactly* from the interpolated phase, so
  every crest is razor sharp at any distance (anti-aliased by the phase footprint). Both suns'
  cast shadows come from the horizon tangent; the suns sit ~6° apart in elevation, so slopes whose
  horizon falls between them are lit by the companion alone — **coloured double shadows**. Because
  the bake stores tangents (not visibility), lowering the suns at dusk lengthens every shadow for
  free. Lifted Lambert (Journey), violet sky fill, warm bounce, horizon fill on sun-facing slopes,
  backlit forward-scatter sheen and specular, the contre-jour crest glow, wind ripples (bending,
  breathing wavelength, faded by footprint, off the slip faces), grain glitter (sub-pixel dots on
  random facets), rust spice stains, sheets of blowing sand streaming downwind, the thumper rings,
  and the shared aerial perspective (distance + analytic height fog, coloured by the sky).
- **Sky.** Hot apricot horizon toward the suns → dusty rose away → violet → deep blue zenith; Mie
  glow of both suns; faint crepuscular rays; cirrus on an altitude plane lit gold-pink from below;
  the twin suns with limb darkening and coronae; two moons (shaded spheres, crescent toward the
  suns, veiled by the haze); stars that surface as the dusk deepens. Drawn after the opaque world
  so early-z skips every covered pixel.
- **Formations.** Deformed lathes with closed-form radius (talus flare, cliff taper, irregular
  strata ledges, rain flutes, clefts, a caprock lip, a slight twist to the crown). Strata bands by
  height (shale base, red cliff, pale beds, pale caprock), desert varnish streaks, sand on ledges,
  the twin-sun light, sky fill, a backlit rim and aerial perspective. The Shield Wall escarpment
  on the far horizon is the last depth layer; the suns set toward it.
- **Shai-Hulud.** One tube mesh animated entirely in the vertex shader on a half-ellipse breach
  path; the body follows the head's own path. Annular plates, a fuller neck, a long taper to a
  pointed tail, and a maw that peels open from a closed dome into a flared bell as the worm rears
  and closes as it dives. Back faces are the inside: ember flesh ringed with pale crystal teeth.
  Dusty grey-ochre hide, sand on its back, a backlit rim on the true silhouette only. Whatever is
  below the sand is hidden by the opaque dunes. The mesh is instanced once per worm slot (two: the
  idle worm and the summoned one), each instance reading its slot's path.
- **Where it breaches.** Anywhere in the visible erg. Each breach draws an azimuth inside the
  lens, a distance (760–3300 units; far worms are scaled up so the arch still reads), a travel
  direction (either way across the view, leaning toward or away from the camera) and an arch
  between a tall hoop and a long low leap — so where it comes up, where it goes down and how far
  apart those are all change every time. Idle breaches also start up to 9 s late, so the worm does
  not keep time. A draw is rejected if a foot of the arch is off screen or nearer than 560 units,
  in or behind the rock, behind a board or the HUD (the theme hands the director the same layout
  rects the post's calm zones use; the free stretches of view are drawn by width, so the strip
  right of the HUD gets its share), or out of the camera's sight behind a dune (a sightline march
  on the CPU field). Captures replay one reference sequence; in play each session draws its own.
- **Seated on the real sand.** The erg is not flat, so the two *feet* of the arch are solved
  against it: the angles where the centre line crosses the dune surface, with the sand height and
  slope there. Everything the worm does to the ground happens at those points.
- **The wells.** The sand around each foot is displaced in the dune shader: it domes over the
  rising maw, bursts into a lobed rim, slumps when the tail has passed and leaves a crater that
  fills. The grid carries the height, but the slope is evaluated per pixel (like the ridges), so
  the rim catches the low sun even where the grid is coarse; churned sand loses its ripples and
  glitter and shows rays of thrown sand until the scar fades. Each breach also sends one ground
  wave out from the eruption and one from the strike (the thumper ring, in two reserved slots).
- **Worm director.** Idle cycles every 52 s: the worm sign (a travelling mound with a collapsing
  wake) races in for 13 s, the worm breaches, and after the tail has gone under the sand **settles
  for 9 s** — the wells collapse and fill, the dust drifts off, and the sign travels on from the
  dive. Every envelope is continuous and reaches zero inside the settle; the body is only shown or hidden
  while all of it is under the sand. The **summoned breach** (a Tetris) is a larger, closer worm
  1.6 s later, heralded by a great spice blow where it will come up. It has its own slot, so it
  never cuts the idle worm short — the two rise in different parts of the erg — and a summons
  that lands before an idle sign has begun keeps that cycle quiet. A second Tetris is refused only
  while the last summoned worm is still above the sand; if its dust is still settling, that fades
  over 0.9 s under the new sign. Closed-form in time and the summons timestamps (unit-tested,
  including a frame-by-frame test that nothing on the sand ever jumps).
- **Worm sand.** Six kinds of grain in one instanced draw, each reading its age off the worm's
  path clock (so the sand outlives the body and thins away on its own; nothing is switched off):
  the **cascade** pouring off the body in the air; the **burst**, a crown of sand thrown up where
  the maw erupts and where it strikes (the strike's is thrown on ahead, with the worm's momentum);
  the **spray** flung from a foot while the body runs through it; **churn**, dust boiling round
  the foot; the **surge**, a low wall of dust racing out along the sand from the eruption and the
  strike; and the **slump**, the column of dust the hole breathes out as it falls in behind the
  tail. Grains are fine streaks with a few clods, floored at 1.5 px; billows are lumpy, tear as
  they age and thin to nothing at the sand they stand on (the local slope of each foot is a
  uniform), so the dunes never cut them along a line. Dust carries a diffuse share of the sunlight
  as well as forward scatter, so it reads away from the suns too.
- **Spice and dust.** Spice motes drifting with the wind, flashing in forward scatter toward the
  suns (pixel-floored; a blue fringe at deep dusk and high combos); spindrift veils seated on real
  crest points found on the CPU field; spice-blow geysers.

## 5. Event language

| Event | Response |
|---|---|
| Piece lock | **Thumper beat:** a golden ring of lifted sand (and a low swell in the geometry) runs out across the erg from just beyond the foot of the board (≤ one per 120 ms; 4 pooled slots). Respects `pieceLockRipple`. |
| Combo c ≥ 2 | The spice glows (motes brighten, the blue fringe surfaces) and the wind rises. |
| Line clear (1–3) | n spice blows in the side zones (alternating sites), a gust (spindrift and blowing-sand sheets surge), a sun flare, a warm flash. |
| Tetris | The worm is summoned: the sign races in, the ground trembles (a fine tremor, never a shake), a great spice blow erupts where it will break the surface, and Shai-Hulud rears out of the dust — somewhere new each time, beside the idle worm if one is up. If the last summoned worm is still above the sand, three strong spice blows answer instead. |
| Level up | The dusk deepens (persistent, eased): every atmosphere colour slides toward its dusk value and both suns sink, lengthening every shadow; stars and moons strengthen. Game over / new game returns to golden hour. |

All reactions are gated on `isActive && !isPaused && backgroundComboEffects`; reduced motion stills
the camera rig (no breathing, no tremor, no pointer parallax) but keeps the events.

## 6. Post and grade

One scene pass (HalfFloat; MSAA only on Ultra/Extreme), bloom at Medium+ with a **max-channel
soft-knee prefilter** over 4 taps and a **hue-preserving clamp** (a per-channel clamp turned the
ember sun yellow and the glare olive over dark silhouettes), threshold 2.1 so only the sun discs,
coronae, glints and spice glow bloom, 4 mips (tight glare). One output pass:

heat haze (a shimmer band on the far erg, strongest toward the suns; one noise fetch) → calm zones
(what shows through the translucent board card and HUD is soft-clipped, its bloom attenuated; eased
in/out as the board appears and leaves) → bloom → **occluded crepuscular shafts** (the sharp scene marched toward the
primary sun, gathering only over-bright sky, jittered per pixel, weighted by the depth of lit air in
front of the pixel — so crests, the butte and the worm cut real dark shafts and stay silhouettes) →
an analytic sun flare (soft anamorphic streak + veil, gated by visibility) → **desert filmic** tone
map (hue-preserving shoulder; cores roll to warm white) → split tone (violet-teal shadows, amber
highlights), gentle saturation and mid contrast → vignette → sRGB → grain on the dark floor (High+)
→ triangular dither. `?shiftingSandsFalseColor=1` bands the pre-tone-map max channel.

## 7. Tiers

| | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Terrain grid (rows × cols) | 150×128 | 190×160 | 240×208 | 300×256 | 360×320 | 420×384 |
| Shadow sub-grid stride / steps | 4 / 14 | 4 / 16 | 3 / 18 | 3 / 20 | 2 / 20 | 2 / 22 |
| Ripples + glitter | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Clouds / stars | – / – | ✓ / – | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ |
| Rock detail | 0.5 | 0.65 | 0.8 | 1 | 1 | 1 |
| Worm sand (per worm) / motes / spindrift / blow per slot | 0 / 300 / 0 / 60 | 520 / 600 / 24 / 110 | 960 / 1000 / 48 / 160 | 1500 / 1500 / 72 / 220 | 2000 / 2200 / 96 / 280 | 2600 / 3000 / 120 / 340 |
| Bloom (strength @ scale) | – | – | 0.42 @ 0.25 | 0.45 @ 0.33 | 0.46 @ 0.375 | 0.48 @ 0.4 |
| Shaft taps / heat haze / grain | – | – | 5 / ✓ / – | 8 / ✓ / ✓ | 8 / ✓ / ✓ | 10 / ✓ / ✓ |
| Scene MSAA | 0 | 0 | 0 | 0 | 4 | 4 |
| Pixel-ratio cap | 0.75 | 0.9 | 1.0 | 1.25 | 1.5 | 1.75 |

Dormant pools (worm sand between breaches, spice blows with no live slot) draw a single
degenerate instance, so their pipelines compile with the first frame and cost nothing at rest. The
worm-sand counts are instances, not fill: about a quarter of a pool is billows, and a slot whose
worm is under the sand collapses to zero area. At rest the dune shader pays for one distance test
per well per pixel (the well body is branched over) and two more ground-wave slots.

## 8. Performance

Instrument: the theme perf lane (`scripts/validate-all-themes.mjs --perf`, production builds served
by `vite preview`), High, WebGPU on the RTX, 1600×769-class window, DPR 1 (renderer ratio 1.0 in
every cell), `--perf-idle-ms 10000 --perf-settle-ms 12000`, arms interleaved, a sampler polling for
contending GPU/CPU jobs every 2 s (another project's Playwright SwiftShader tests and another
session's Odyssey captures ran on and off all evening): **contended runs are discarded**. Cells in
[reports/theme-perf-shifting-sands/](../reports/theme-perf-shifting-sands/) (`final/` = the clean
cells below; `early/` = the first n=1 look).

| | Old theme (`before-1`, `before-2`) | New, DOM-polling layout watch (`cur-2`) | New, trigger-based layout reads (`nolayout-1`) |
|---|---|---|---|
| Lane frames in 10 s | 1229 / 1253 | **920** | 1306 |
| Wall p50 / p95 | 7.7 / 11.7, 7.6 / 9.4 ms | 8.1 / **16.9** ms | 7.6 / **8.3** ms |
| Frames over 16.7 ms | 5 / 10 | **50** | **0** |
| CPU submit p50 / p95 | 1.7 / 2.7, 1.6 / 2.5 ms | 2.3 / 3.0 ms | **1.4 / 1.7 ms** |
| GPU p50 / p95 (per rendered frame) | 1.114 / 1.245 ms | 0.721 / 0.983 ms | 0.918 / 2.49 ms ¹ |
| Draws / triangles | 28 / 80k | 19 / 244k | 19 / 244k |
| Pipelines | 18 | 15 | 15 |
| Switch wall / first frame GPU-complete | 269–358 / 2454–2661 ms | 361 / 2521 ms | 349 / 2566 ms |
| Heap p50 | 36.5–36.7 MB | 44.1 MB | 44.2 MB |

¹ This window included an idle worm breach (plumes are the heaviest overdraw in the theme). After
these cells the final build trimmed exactly that path: the shaft march is confined to the sun's
neighbourhood (it had been running eight full-resolution taps on nearly every pixel), the heat-haze
noise fetch only runs inside its horizon band, and the plume share and size dropped.

What the cells show:

- **The layout watch was the regression.** A ResizeObserver plus a 1 s DOM poll
  (`getBoundingClientRect`/`getComputedStyle` against the hub's continuously animating DOM) cost ~30 %
  of the lane's frames and 0.9 ms of CPU per submit. The shipped theme reads the rects inside its
  frame loop only after real triggers (Parhelion's model), and the variant with no watch is smoother
  than the old theme on every wall metric: 0 frames over budget, wall p95 8.3 ms, CPU submit −15 %.
- **GPU per rendered frame is lower** (p50 0.72–0.92 vs 1.11 ms) while drawing 3× the triangles,
  with 9 fewer draws and 3 fewer pipelines. The old theme also bypassed the target-FPS cap
  (`renderer.setAnimationLoop`), so it rendered at the display rate; the new one renders through
  `safeAnimate` at the player's target rate — at a 60 fps target on this 120+ Hz panel that is
  roughly half as many frames, so total GPU time per second falls by well over half.
- **Switch and first frame are unchanged within run-to-run noise** (the CPU dune bake replaces the
  old CPU Perlin mesh and compute setup); heap is ~8 MB higher (the baked terrain attributes).

Open: a clean n=3 interleaved lane on the final build (`ab/`, started, then stopped by contention
before a clean pair landed). Re-run on a quiet machine before a release claim:
`node scripts/validate-all-themes.mjs --perf --theme shifting-sands --skip-build --perf-idle-ms 10000 --perf-settle-ms 12000`.

## 9. Validation

- Playground (WebGPU and `forceWebGL=1`) at 1600×900: rest, deep dusk, lock ring, 2/3-line spice
  blows, idle breach across the suns, the summoned Tetris breach (with and without the board mock),
  Low tier, no-post and false-colour views. Zero console errors or WebGPU validation messages.
- In game: `scripts/capture-theme-screenshots.mjs --theme=shifting-sands` PASS (0 lifecycle
  failures, 0 console errors); `docs/theme-screenshots/shifting-sands.png` refreshed.
- Unit tests (51): `tests/unit/shifting-sands-{composition,terrain,worm,world}.test.js` —
  composition at five aspects, lens cap, DOM rect reads, ridge profile and angle of repose, field
  determinism, bake integrity, Sentinel shadow in the bake, breach path geometry and feet solved on
  uneven sand, director closed-form timing, **nothing on the sand jumps in a frame** (every mark
  stepped at 120 Hz through whole breaches; the body appears and vanishes only under the sand),
  sites spread over the erg and clear of boards, HUD, rock and hidden ground, summons rules (never
  cuts the idle worm, quiet cycle, re-summons fade), nothing created at event time, the sand
  outliving the worm, dusk, thumper rate limit.
- **Worm pass (2026-10-05):** playground on WebGPU and `forceWebGL=1`, High and Low — eruption,
  arch, strike, tail under, collapse and settle from the game lens, from a tight lens and looking
  down into both wells; a Tetris during an idle breach (both worms up); zero console messages.
  Real game on the dev server: `scripts/validate-all-themes.mjs --theme shifting-sands` PASS, the
  live layout reaching the director (free zones left of the board and right of the HUD) and a
  breach captured in play. **Not re-measured:** frame cost. The machine was shared with other GPU
  jobs and an empty scene swung between 6 and 48 ms at p95, so no number from that session is
  admissible; §8 predates this pass.
- Gates run locally: lint (0 problems in the theme; repo ratchet 1281 < 1336), typecheck, theme
  lifecycle audit, dependency boundaries, palette gate (0/7 for this palette), IP strings,
  architecture fitness (resize listeners 50 < 51).

## 10. Follow-ups

- Re-run the perf lane (§8) on a quiet machine: the worm pass added instances (vertex work) and a
  two-worm case, and its fill has not been measured on the integrated or phone GPUs.
- The theme icon was framed on the old fixed breach. `icon=1` now holds a worm at that site
  (az −27°, 1350 units, heading −118°); re-capture with `breach=1&t=<s>` if the icon is refreshed.
- The CPU dune bake (~tens of ms on the main thread at High) could move to a worker if a switch
  profile ever shows it.
- A composition solver (as in Chromadelic) could shift the Sentinel/breach azimuths for very narrow
  aspects; today they are authored for 4:3–21:9 and unit-tested there.
