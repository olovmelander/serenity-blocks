# Odyssey overhaul 2026-10 — Act II lane (chapters 3 Surface, 4 Mountains, 5 Sky Drift)

**Status:** lane branch `feature/odyssey-overhaul-act2` (base main `d557160a`), not merged.
Part of the whole-journey overhaul run by the integrator (protocol in the session scratchpad,
`lanes/PROTOCOL.md`). Three.js `0.186.1`.

Owner's question for this act: *"how can we make the chapters 3, 4, and 5 more of an experience
and more visually stunning?"* — within "the most visually stunning ... odyssey", with good
performance (120+ fps Extreme, RTX 3070).

## 0. What the before frames showed, and the two facts that decided the plan

- **The player sees Act II parked at an orb.** A glide between two orbs is ~0.9 s in chapters
  3-4; the orbs are ~33 u apart on a ~1 km view of the massif. Every ch3/ch4 orb therefore showed
  the same picture (the snowy cone dead ahead) — the composition problem was the camera, not the
  world. A capture **panorama** of every orb at ±30/60/100 deg (run `x1`) showed what the island
  offers in each direction: the coast curving away with the far isles to the left, the flower
  meadows and the sea to the right, the sun over the sea behind.
- **The act is front-lit** (its sun ~25 deg up behind the camera). That costs it every back-lit
  effect and gives it the antisolar ones: a rainbow stands where the camera looks.

Defects in the before gallery and their causes:

| Seen | Cause | Fix |
|---|---|---|
| A dark smudge with a pale ellipse on the massif's upper face (every ch3/ch4 frame, ch5 too) | The drifting **cloud shadows** (`GROUND_CLOUD_SHADOW`): 400 u tiles, a 0.60..0.67 window and 0.55 depth made 100-200 u hard-rimmed blobs, on the upper cone only. Raycast-confirmed (a CPU ray from the capture's camera through the smudge's pixels lands in the field's shadow at 0.47-0.48). | Reworked as real fair-weather cumulus shadows (§2) |
| ch4 L26 / ch5 L27 looked ~45-60 deg up into empty sky | The rail stands up the face there; the old "saddle approach" framing pushed the eye under it | The wall shot (§1) |
| A fat white pipe across ch4/ch5 frames | The ribbon's screen-fraction ceiling (2.8 % of the screen) binds on the 10-40 u of rail just ahead of the follow camera | Near-eye thinning per recipe (§1) |
| Vestigial framing toward a "Great Tree" (ch3) and a "V-notch" (ch4) | Both subjects exist only in the diorama chapters (`?odysseyOneWorld=0`) | Removed |

## 1. The camera: one picture per parked orb, the wall, a thinner rail

- `CHAPTER_3_SHOTS` / `CHAPTER_4_SHOTS` (OdysseyCameraController.js) are **keyframed shot paths**:
  an angular move (yaw / pitch / FOV) held at each parked orb and eased between neighbours with a
  smootherstep over the whole glide (`addKeyframedShots`), so the glide IS the pan and the parked
  frame is exactly the authored one. Yaw stays within ±38 deg so the orb underfoot and the way
  ahead stay on screen; keys inside the 2->3 / 3->4 / 4->5 seam windows are small, so
  `odyssey-seam-camera-continuity.test.js` holds (worst aim steps 2.0 / 1.6 / 4.2 deg per 0.001 p
  against limits 2.5 / 2 / 5).
  - ch3: L12 massif + east meadows, L13 the coast curving left with the far isle, L14 the long
    beach and the sea (wider lens), L15 the massif with the shower gathering right, L16 the bow
    over the east meadows, L17 forest and shore on a longer lens, L18 the massif.
  - ch4: L20 meadows and sea right, L21 the meadow under the sunlit flank, L22 the west peak over
    the forest, L23 the coast and isles, L24-L25 the face rising.
- **The wall** (ch4 L26 -> ch5 L27): a pitch-down (-16 deg) on a slightly wider lens held from L25
  through the 4->5 boundary, matched by chapter 5's new `face` shot (released by L28). L27 went
  from pitch ~60 deg (summit in the bottom third under empty sky) to ~44 deg with the summit
  above centre and the orb on screen (pinned by a new case in `odyssey-ch5-climb-framing.test.js`;
  the old "lift-off pose unchanged" case now exempts the face shot and still pins the climb shots).
- Removed: ch3's lean toward the diorama's Great Tree and ch4's push toward the V-notch.
- **Near-eye ribbon thinning** (odyssey-path-renderer.tsl.js): a recipe's `nearThin` (packed in the
  spare `fill.w` lane) narrows the body and the haze within `nearThinFar` (110 u) of the lens —
  ch3 0.55, ch4 0.72, ch5 0.78; every other chapter 0 (unchanged). The screen-fraction CEILING
  thins harder (to ~10 % at the lens) because the follow camera can pass 6-12 u from the rail
  behind its orb, where even a thin tube is a pipe; and the haze around it fades with it (a
  `--hide=odyssey-path-glow-tsl` bisect at L26 showed the white halo doubling the body's apparent
  width). The far rail, the way ahead, keeps its width and its pixel floor.

## 2. Light and air

- **Cloud shadows over the whole island** (world renderer, `GROUND_CLOUD_SHADOW`,
  `cloudShadowLight`, `cloudShadowSchedule`): fair-weather cumulus shadows a few hundred metres
  across (the deck's own clustered silhouette field at 1,150 u a tile, broken into irregular
  regions by a rotated 2,700 u read of the slow value-noise channel so the tile never repeats
  visibly), soft-rimmed, 0.46 deep, drifting downwind at ~8 u/s over all dry land — the ground
  AND the forest (the trees read the same field, or every shadow stopped at a forest edge).
  Strength and cover are uniforms: off under water, a heavier sky at the breach that opens as the
  shore arrives ("light floods the island"), then scattered cover. High tier only, as before (two
  fetches per ground / tree fragment). This replaced the 520 u-and-above blobs that drew the
  smudge on the summit.
- **The antisolar sky** (`world/odyssey-sky-optics.js`, wired into the world's sky dome behind a
  uniform branch): a primary bow at 40.6-42.4 deg round the TRUE antisolar point (−sun), a fainter
  reversed secondary at 50-53 deg, the brighter sky inside the primary and Alexander's darker
  band, all standing on a slate SHOWER VEIL of falling rain shafts in the low sky round the
  antisolar azimuth (a bow is vivid against rain, invisible against a clean noon sky). Keyed to
  progress (`antisolarSchedule`): the shower gathers over the shore orbs, the bow stands from
  L15 to L21 — its left foot comes down just right of the massif from the shore, and the L16 shot
  turns to it. ~30 ALU on sky pixels while scheduled; nothing outside the window.
- **The air** (`composition/odyssey-air-motes.js`): one additive draw of ~900 world-anchored motes
  in a box round the eye (no instance data; the Spring theme's technique): pollen over the shore,
  thistle down on the meadows, diamond dust on the climb, each kind faded in and out by progress.
  Front-lit, sized to at least 1.5 px, faded near the lens and toward the box's edge. 420 motes on
  Low/Minimal.

## 3. Life

- **Lowland flights** (`composition/odyssey-flights.js`, one opaque instanced draw, the summit
  birds' contract): twelve gulls in two parties wheeling in loose, drifting loops over the surf
  (one off the coast the L13-L14 shots turn to, one over the beach line the rail crosses), twelve
  swallows darting in figure-of-eights at eye height beside the meadow stretch of the rail
  (blue-black, bursts of fast beats), and a skein of nine geese crossing in front of the massif's
  face in a V once every 52 s. Closed form in the vertex stage (heading from the next position,
  bank from the turn's real acceleration — steep, because a level bird seen from near its own
  height is a one-pixel line; a right turn dips the right wing; orientation from world up), lit
  by which side of its wings the eye sees (from below a shaded grey shape on the bright sky, from
  above its sunlit back). The first in-game look (x2/x3) found them drawn but invisible: the bank
  was off by the time step squared (~4 deg instead of ~35) and white gulls at eye height are
  edge-on white lines on a pale horizon. Sited on the CPU height mirror and
  the live spline: every bird clears the terrain (> 6 u) and the rail (> 14 u) while shown.
- **The massif's eagle** (`composition/odyssey-eagle.js`, `odyssey-eagle-flight.js`, model
  `assets/chapter-04/eagle.glb` — a copy of the Himalayan Peak theme's Blender-built eagle, since
  themes cannot be imported): a golden eagle thermalling over the face as the wall begins (L24-L28)
  with the theme's code-posed flight (26 bones, splayed primaries, bouts of wingbeats). The whale
  pass's lifecycle exactly: fetched as its window approaches, live-compiled while the board is
  idle, only then drawn (`_tickEagle`). Clears the terrain by > 40 u and the rail by > 45 u.
- **The summit's spindrift** (`composition/odyssey-summit-spindrift.js`): a plume of torn snow
  leaving the summit crest and streaming west into the existing banner cloud (the cloud field's
  `banner` masses), so the banner reads as one; seen from the shore to the top of the climb.

## 4. Surfaces

- **The summit mantle** (world renderer, ground graph): from the climb (L28-L32) the upper cone
  read as a beige dune of stippled rock streaks. Three changes: above ~800 u on the hero cone the
  flute ribs and the crest strip scour less (`mantle`), the snowline's atlas break-up is a third as
  strong on the hero (the speckle that read as sand grain), and `HERO_FLUTE_DEPTH` 0.24 -> 0.34
  (light-and-shade down every fall line). Plus a **clearer high-altitude sun** in the colour script
  (`highlands` 0xffeecb -> 0xfff3e0, `alpine` 0xfff4e2 -> 0xfff8f0): under the warm sun the grey
  stone and the snow both went beige. (The REJECTED direction was a warmer ch5 sun; this is the
  opposite one.) The summit now reads white with fluted streaks; it is still a smooth cone at the
  closest shots (see open items).
- **Soft cloud rims** (cloud field material, `FIELD_SOFT_RIM`): the outermost rim of every mass
  leans toward the sky colour along its ray (a little white kept) — the thinnest cloud shows the
  sky behind it — so the hard sticker outline dissolves into the sky. (A billowed band edge from
  the detail texture was tried and removed: Act II's front-lit faces sit far above the lit/shade
  band, so a ±0.13 shift drew nothing, and it cost a fetch.)
- **Foliage clumps** (forest v2 material, `fvClump`): near crowns (inside 260 u) slide their tone
  bands by a value-noise read on the crown's surface, so the light breaks into leafy masses
  instead of one smooth band per crown (the "broccoli" read). Still only the authored tones; one
  fetch per near crown fragment; gone before the band collapse at range.

## 5. Verification

Captures under the shared GPU lock (`lanes/lane-capture.sh`, Extreme, WebGPU, 1280×720,
`--time=9 --envTime=30 --settle=2500`), stations at the **orbs** (chapter-local 0.003, 0.122,
0.249, 0.370, 0.501, 0.621, 0.746, 0.871) rather than the generic eight, because the orbs are
where the player looks. Scratchpad `lanes/act2/cap/`:

| Run | What |
|---|---|
| `x1` | panorama: every ch3/ch4 orb turned ±30/60/100 deg (scouting only, never shipped) |
| `x2` | first full pass (shots, shadows, bow, flights, eagle, motes, spindrift, rims, clumps) |
| `x3` | ribbon ceiling, stronger shower, gulls re-sited, ch4 keys, summit mantle, cooler sun + all four seams |
| `x4` | WebGL2 (ch4, ch5), Low (ch3-5), a no-glow bisect at L26, the travel feel probe |
| `x5` | final: flights bank/light fix, haze thinning, geese; ch3 WebGL2; seams 2-3 and 4-5 |

Seam luma gate (`scripts/odyssey-seam-luma.mjs`, 18 stations, |step| <= 45 per 0.01 p):

| Seam | Worst step | Result | Seamless-pass record |
|---|---|---|---|
| 2->3 | 30.9 at p 0.1367 (the breach) | PASS (x3, x5) | 29.7 |
| 3->4 | -19.4 | PASS (x3) | -4.1 |
| 4->5 | 7.0 | PASS (x3, x5) | -8.3 |
| 5->6 | -35.7, end luma 22.2 | **FAIL**: 2 rising steps after the boundary (space side, see open items) | -35.7, 0 rises |

WebGL2 (`--force-webgl`): chapters 3, 4 and 5 render complete (bow, flights, eagle, plume, motes);
Low tier: chapters 3-5 render complete (the bow and the shower on, cloud shadows off by tier as before).

Console: no errors and no WebGPU validation messages in any capture's `console.log` (Electron's
CSP warning only); the eagle logs `loaded` then `ready (live-loop compiled)`.

**Performance** (feel probe, Extreme, cap 144, RTX 3070 on mains, `--phases=start,travel
--from=0.13 --to=0.72 --gpu=1`, i.e. a 30 s wheel travel through all of chapters 3-5): **130.5
presents per second** (the display's rate), worst frame 10.7 ms, **0 frames over 20 ms, 0
synchronous pipeline creations** (one async: the eagle's live compile), main thread p50 3.0 ms /
p99 5.2 ms, GPU p50 0.52 ms / p95 1.05 ms per frame (scene pass p50 0.39 ms). The smoothness
pass's record for the whole journey was 130.8-131.3 presents/s with main thread ~2.3-2.9 ms and
GPU 0.3-1.9 ms; no base-vs-head A/B was run in this lane (the base tree would need its own
server and lock turn), so treat the main-thread figure (+~0.3 ms, the eagle's CPU posing and the
skinned upload are the likely share) as unconfirmed.

Tests: `tests/unit/odyssey-act2-life.test.js` (new, 18 cases: shader builds for WGSL + GLSL of
the flights, eagle, motes, spindrift and sky optics with no NaN/Infinity/stringified nodes;
bird / eagle / plume clearances against the CPU height mirror and the live spline; windows and
schedules), `odyssey-ch5-climb-framing.test.js` (updated: the face shot), the seam camera
continuity, the world lints, the world and composition suites, the colour script, the path
renderer TSL build, the URL parameter catalogue — see the lane report for the run.

## 6. Open items

- **5->6 seam** fails the "no rises after the boundary" gate (2 rises: +5.8 at 0.7583 as the
  black-hole omen and the galactic band arrive, then a slow +4.9 from 0.7843) — the space side,
  which the integrator owns and is re-placing; the world side of the departure (0.69-0.75) is
  unchanged in behaviour and dark by 0.72.
- **L27/L28** (the first climb orbs) still look ~45 deg up the face: the orb underfoot is ~35 u
  straight above the eye on the near-vertical rail, so any further pitch-down loses it. A real
  fix moves the eye off the wall (an eye offset, not an aim), which is a camera-rig change.
- The summit is clean white with fluted streaks but still a smooth cone at the closest summit
  shots; snow texture at that range (wind crust, glints) would be the next step.
- Not done from the research list: the waterfall (a white streak on a cone already striped by
  snow tongues would read as one more couloir), the glory (the antisolar point is in frame at
  only one orb, L33, on its bottom edge), the storm cell (cloud-field triangle budget), the
  hero horn/aretes (high risk: rail clearances and bakes).
- The eagle model is a byte copy of the theme's; regenerate both from the Blender script if it
  changes (`assets/chapter-04/ATTRIBUTION.md`).
