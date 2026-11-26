# Blood Moon — a total lunar eclipse over a salt flat (2026-10-20)

Branch `feature/blood-moon-eclipse`, worktree `../serenity-blocks-bloodmoon`. Evidence:
[reports/blood-moon-overhaul/eclipse-salt-flat/](../reports/blood-moon-overhaul/eclipse-salt-flat/).

## November 2026 visual audit and revision

The authored lunar surface, the moving umbra and the mirror were the strongest parts of the October scene. A matched capture at eight seconds showed the lower half of the reflected moon outside the frame. The volcano read as a single smooth cone. Several large stars had soft or clipped edges, the galactic band had little internal structure, and the sky and its reflection had almost the same texture. [Original and revised frames](../reports/blood-moon-overhaul/november/comparison.webp)

| Surface | Change |
| --- | --- |
| Moon | A larger disc exposes more of the existing atlas. Oblique lighting picks out crater relief, darker basalt seas separate from the highlands, and a thin copper limb catches the light above the shadow. Only rays through the disc and its reflection fetch the two lunar textures. |
| Stars and Milky Way | The two star populations have sharper cores, varied temperatures and gentle scintillation. Mipmapped galactic dust and star clouds follow a great circle. The band rises on the open side of a portrait view. Minimal and Low load a smaller atlas. |
| Atmosphere | Red airglow, wind-streaked cirrus, a clear violet night and a 22-degree ice halo blend over 188 seconds. Their timing drifts against the four-minute eclipse. Both the water and the mountains take the changing light. [Four moments from the cycle](../reports/blood-moon-overhaul/november/night-cycle.webp) |
| Range | A Blender-built caldera has a breached flank, a secondary summit and exposed beds. Four ridgelines overlap in haze. The runtime reads a baked plate with lighting, snow, distance and coverage along the sky or mirror ray. The bake checks that the shoreline covers every bearing. |
| Salt and water | A seamless plate replaces the per-pixel search for polygon borders. Its distance, slope and mineral channels shade copper seams and salt shoulders. Intersecting wave trains break up the reflection in patches. Bright horizontal facets stretch a path from the moon toward the observer. |
| Board and UI | Seven mineral colours distinguish the shapes that previously shared similar reds. The Solo well has darker glass behind the spawn rows, the queue has a clearer NEXT label, and the score panel picks up the plum and copper of the scene. The picker icon comes from the revised world. |

The original locks, clears and twists drew much of their energy from the same ring around the moon. In the revision, the location and motion tell the player what happened. [Gameplay effects side by side](../reports/blood-moon-overhaul/november/events.webp)

| Gameplay event | Visible response |
| --- | --- |
| Lock and hard drop | A lock flicks salt spray from a spot beside the board. A hard drop draws a descending hot streak and sends up a larger splash. Its following lock ripples at the same point. |
| One, two and three lines | A single draws a glint across the salt. A double forks in two directions. A triple lifts three successive wave fronts. The wet edges break into horizontal fragments. |
| Four lines | Four magnetic loops open around the limb, an annular shower flies outward and a fireball crosses the sky and water. |
| Twist | Two arms shear away from opposing points on the moon. A scoring twist braids several strands. A zero-line twist leaves a narrower pair. |
| Cascades and consecutive clearing pieces | The cascade depth sets the length of a train of splitting meteors. Chains of consecutive clearing pieces feed sustained changes in the corona, colour, wind and crater heat. |
| Back-to-back and level up | A back-to-back throws a staggered spray of hot stones from the volcano. A level up raises pillars of light from the reflection. |
| Perfect clear | The umbra steps aside to reveal a white diamond on the limb. Pearl rays, a sparkling crown and the bright road across the water recede as the eclipse returns. |
| Multiplayer garbage and counters | Incoming rows fracture the salt. A counter draws the light back inward. The theme reacts to the local player's garbage. |
| Game over | The chain resets and cooled embers fall through the sky. |

The filaments share one draw while active. Their pool has 36 strokes on Minimal and Low and 72 on higher tiers. A perfect clear can claim space from routine impacts during heavy play. Reduce motion holds the eclipse and weather still and suppresses the new trajectories. Reduce flashing attenuates the crown, reflected crests and event light while preserving the movement of the water.

**Verification.** The production Solo board was played with normal movement and drop inputs. A separate sequence sent a quad, back-to-back, cascade and perfect clear through the game's event bus to inspect the busiest frame. The upcoming pieces, ghost, and score remained visible. Disabling background effects retired the active reactions and re-enabling them restored the response. [Solo board](../reports/blood-moon-overhaul/november/solo.webp) · [Stacked events](../reports/blood-moon-overhaul/november/solo-busy.webp) · [Recorded gameplay effects](../reports/blood-moon-overhaul/november/blood-moon-in-motion.webm)

At High, the 1440 × 810 production Solo run on NVIDIA Blackwell had a median frame interval of 33.3 ms and a 95th percentile of 37.5 ms over 146 intervals at the 30 fps test cap. Matched 1280 × 720 playground captures retained two submitted draws at idle and went from five to six on a quad. Median CPU time moved from 0.6 to 0.7 ms at idle and from 0.7 to 0.8 ms on a quad. Each visit yielded eight quantized GPU timestamps. Measurements cover this adapter and cap. A separate three-minute overlap simulation saturated the stroke, ripple and particle pools on Minimal, High and Extreme. All three pools emptied after play stopped. [Measurements](../reports/blood-moon-overhaul/november/verification.json)

The shipping Solo adapter was exercised on WebGPU and WebGL2. The playground checks covered the eclipse phases, all event families, reduced motion, reduced flashing and a [390 × 844 Minimal WebGL2 view](../reports/blood-moon-overhaul/november/portrait-webgl2.webp). The 94 Blood Moon tests, both shader builders, typecheck, scoped lint, lifecycle and dependency checks, and production build passed. Blood Moon's piece palette passes the colour check, and its Odyssey passage colours match the revised icon.

The rocky relief and salt plate can be regenerated with [the Blender bake](../scripts/blender/blood_moon_range.py). The galactic dust band uses a built-in ImageGen texture in [full](../public/textures/blood-moon/galactic-rift.webp) and [small](../public/textures/blood-moon/galactic-rift-small.webp) sizes.

<details>
<summary>Galactic dust texture generation prompt</summary>

A deep-sky astrophotography texture for a game's real-time sky. Wide landscape format. Direct view across the Milky Way from earth, the long axis of the galactic band runs HORIZONTALLY from left to right exactly through the middle. Numerous powder-fine champagne and smoky rose star clouds, dramatically branching near-black interstellar dust lanes, patches of dusty mauve and a handful of subtle little carmine emission knots, sparse ice blue pin stars. Detailed galactic core slightly right of center, dissolving into irregular finer star streams towards the left. The band occupies the central half of the image height, with the upper and lower quarters fading naturally into very dark clean space. Atmospheric high resolution long-exposure observatory photo, star clouds actually resolve into thousands of incredibly tiny fine stars, local contrast, delicate graded falloff, exceptionally crisp detail. Restrained natural color. Sky only. No moon, no planet, no spiral galaxy seen from above, no earth, no mountains, no landscape or terrestrial clouds, no sun, no horizon, no lens flare, no text, no frame. The finished material will be wrapped on a great circle and turned diagonally in the real scene.

</details>

## Why

A fleet review on 2026-10-20 found Blood Moon the thinnest theme by far: a red-tinted moon, red
stars and a nebula, about 1,100 lines and six draw calls, against 4,000–15,000 lines for the themes
overhauled in October. It was a picture, not a place. The owner asked for it to be improved next,
along the direction the review proposed: make the eclipse something that happens, not a tint, and
put land under it.

## The subject

A total lunar eclipse seen from a salt flat. The eye stands a metre above a crust of salt polygons
whose raised rims stand out of a thin film of water; between them the water mirrors the whole
night: the red moon, the stars, the Milky Way and a far range with a snow-shouldered volcano. Earth's
shadow really crosses the moon: totality first (the theme opens on a blood moon), then the shadow
slides aside until a white sliver of uneclipsed moon burns on one limb, back into totality, and out
the other way, on a four-minute cycle. The night is exposed for the moon the way an eye or a camera
would be: wide open through totality, so the red face, the Milky Way and faint stars read; stopped
down when the sliver appears, so the sliver blows out white, the red face sinks to copper and the
stars thin out, and the salt flat lights up silver-warm. Now and then a meteor falls beside the
board, and a big clear sends a fireball across the open sky; the water mirrors both.

Odyssey: orb 39 stays in Chapter 6 (Space & Cosmic Expanse). The eclipse is the subject and the
salt flat its stage, as Shifting Sands' dunes are a planetary stop in the same chapter. Its level
description now reads "A blood-red moon hangs over a mirror of salt" (`src/core/odyssey/data/levels.js`),
and the chapter audit row is updated (`docs/ODYSSEY_UNIQUE_THEME_CHAPTER_AUDIT_2026-10.md`).

## Module map

The theme is still a thin `BaseTheme` wrapper (`src/themes/blood-moon/blood-moon-theme.js`,
unchanged) around the playground effect, so the playground and the game draw the same scene.

| File | What it holds |
| --- | --- |
| `src/playground/effects/blood-moon-eclipse.js` | The eclipse with no renderer: the shadow's path (`eclipseOffset`), the light law on the moon's face (`lunarLight`), and per frame the moon's mean light, how much of it lies in the umbra and the exposure (`sampleEclipse`). Pure functions of time. |
| `src/playground/effects/blood-moon-world.js` | The world in one full-screen draw (`createWorldMaterial`): night, moon, range, salt flat and mirror. Also the TSL twin of `lunarLight` and the salt cells. |
| `src/playground/effects/blood-moon-ripples.js` | A fixed pool of rings on the water, live rows kept at the front; `rippleCue` maps gameplay cues to rings. |
| `src/playground/effects/blood-moon-meteors.js` | The meteors: quiet ones as a pure function of the clock, cued fireballs, paths kept inside the frame, beside the board and clear of the moon. |
| `src/playground/effects/blood-moon.effect.js` | Wiring: the ground-level camera, the moon's world direction from the layout, the eclipse and exposure per frame, gameplay cues, Reduce flashing, the event overlays. |
| `src/playground/effects/blood-moon-state.js` | Layout (now with a horizon the moon always stands above) and the quality tiers; the reaction envelopes are unchanged. |
| `blood-moon-bursts.js`, `blood-moon-surface.js` | Unchanged: the combo showers and the authored lunar atlas. |

`blood-moon-motion.js` (the moon's own wandering path) is retired: the moon is now fixed in the
sky and the camera does the moving, so moon, stars and horizon shift together.

## How it is drawn

- **One sky lookup per pixel.** A pixel above the horizon asks the sky along its view ray; a pixel
  on the flat asks along that ray mirrored in the water's normal. The mirror is exact and full
  resolution with no second pass, and the moon, stars, Milky Way and range all appear in it.
- **The moon** is drawn in the lens's image plane (the `sunPlane` idea from Solar Eclipse), so it is
  round anywhere in the frame. Its face is the authored 2k lunar atlas; each point is lit by
  `lunarLight(s)`, where `s` is its distance from the umbra's axis in lunar radii: deep red at the
  umbra's heart, copper at its rim, a thin turquoise ozone fringe just outside it, then the sun
  returning across the penumbra, reddened where only its limb shows. The sun's visible share climbs
  as `f^1.25` from the umbra's edge (not a smoothstep, which starts flat and fogged the edge), so the
  shadow's boundary is soft but defined, as in eclipse photographs. The umbra is 2.7 lunar radii,
  the penumbra 4.65, and the shadow's centre passes 0.62 radii below the moon's centre, so the lower
  limb lies deepest and the upper limb glows copper.
- **The cycle** (`ECLIPSE.period` = 240 s): the shadow's centre moves as `sin·|sin| × 2.2` radii,
  which lingers near zero, so totality holds about two thirds of the time and the sliver alternates
  sides. **Exposure** stays at 1 while the moon's mean luminance is under the key (late totality's
  copper rim still reads at full exposure) and falls as `(key / luminance)^0.85` to a floor of 0.15
  as the sliver appears. It changes by under 0.01 per 60 fps frame, so it is never a flash. Reduced
  motion holds the clock at 0: totality, still.
- **Salt cells:** a two-pass Voronoi border distance (Inigo Quilez's) on cells 1.45 m across gives
  each point its distance to the nearest rim and the rim's direction. A rim is a rounded bank 9 cm
  wide whose flanks tilt toward each cell's middle, lit from the moon's side. Everything is faded by
  the pixel's footprint on the ground: crisp rims near the lens, a faint average further off, and a
  perfect mirror at the horizon, so the pattern never shimmers. Each polygon holds its own depth of
  water (more or less salt shows through), and salt shows through the shallow film beside each rim.
- **Water:** Fresnel with a mirror floor, a whisper of wind (kept small so reflected stars stay
  crisp), and the gameplay rings.
- **Sky:** night gradient with a warm airglow band, the moon's light scattered blue-first (it turns
  the night blue-grey when the sliver shows), an aureole round the moon, two lattice star layers (a
  3D lattice, round everywhere), the Milky Way (two cloud reads plus a dense lattice of faint points
  for its grain), all wheeling a degree every four minutes about a tilted pole.
- **The range:** several summits in any width of view, and a stratovolcano placed four fifths of the
  way across whatever the frame's aspect (`volcanoAz` / `volcanoWidth` / `volcanoHeight` set on
  resize; its height follows its width, so a phone's narrow portrait frame keeps its proportions),
  with only its own moon-facing flank and snow shoulders lit.
- **Meteors** (`blood-moon-meteors.js`): a stretch of a great circle drawn in the sky function (so
  the water mirrors it): a white-green head and a trail that cools and narrows behind it. A quiet one
  falls in about two of every three 21 s slots of the clock and lasts about a second. Paths start and
  end inside the frame (scaled by the bearing of its side edge), fall outward, away from the board,
  and never start on the moon or its ember ring. The shader skips the meteor outright when the sky
  holds none.

## Gameplay

- **Rings on the water** (`rippleCue`): a lock drops one, a clear one or two, a T-spin two, a Quad
  three, a perfect clear four, a level-up two. They land on visible water beside the board (the board
  lanes come from the layout), mostly near the lens, spread at 2.1 m/s, bend the reflections and
  their crests catch the moon's own light: red in totality, silver when the sliver shows.
- **Fireballs:** a Quad, a T-spin and a perfect clear send a brighter, slower meteor with a glowing
  head and halo across the open sky on the far side from the moon; its glint shows in the water.
- **Kept from the previous Blood Moon:** the broken lunar wave of a lock (Wolfhour's), the corona
  flare, the expanding wave ring and the three-slot ember showers of clears and combos, all following
  the moon's screen position (projected from its world direction every frame).
- **Reduce flashing effects** (ADR-0021): the moon's pulse, the corona, the lunar wave, the wave ring
  and the stars' boost keep `flashScale()` of their strength; rings and showers still move. Gated by
  a test (`tests/unit/blood-moon-shaders.test.js`, "blood moon under Reduce flashing effects").
  Blood Moon has no `*-post.js`, so the fleet's post-stack fitness test does not cover it.

## Tiers

| Tier | Star layers | Milky Way | Salt cells' 2nd pass | Rings | Sparks | Lunar atlas |
| --- | --- | --- | --- | --- | --- | --- |
| Minimal | 1 | no | 3×3 | 4 | 180 | 512 |
| Low | 1 | yes | 3×3 | 4 | 300 | 512 |
| Medium | 2 | yes | 5×5 | 6 | 600 | 1024 |
| High | 2 | yes | 5×5 | 8 | 1000 | 1024 |
| Ultra | 2 | yes | 5×5 | 8 | 1400 | 2048 |
| Extreme | 2 | yes | 5×5 | 8 | 1800 | 2048 |

## Icon

The hub icon is a render of the theme itself: `?effect=blood-moon&icon=1&t=0` in a square window
(the moon centred over its reflection, horizon a little below the middle), resized and masked to a
circle with a 1.5 px soft edge. Written to `src/themes/blood-moon/blood-moon-theme-icon.png` (512 px,
the source of the build's thumbnails) and to the `public/assets/themes/blood-moon-*` copies (1024,
640 and 512 px). The `icon` parameter is in the URL catalog.

## Layout

`resolveBloodMoonLayout` now returns a `horizon` (0.34 of the height wide, 0.45 portrait) and keeps
the moon's lower limb at least 0.05 above it. The moon is smaller than before (radius 0.15 of the
height wide, 0.11 portrait; it was 0.23 / 0.14), since the landscape is now part of the picture,
and keeps 0.03 of the height from any board (was 0.014) to leave room for the camera's sway.

## Verification

- Unit tests: 74 across six Blood Moon files, including the new
  `blood-moon-eclipse.test.js` (the cycle, the sliver on both limbs, exposure smoothness, the light
  law, the ripple pool, the meteors' schedule, paths and fireballs, and their keeping clear of the
  moon) and `blood-moon-shaders.test.js` (every material built through the WGSL and
  GLSL node builders at High and Minimal, no warnings, under 48 KB a stage, no unassigned var reads,
  pure laid-out `bm*` helpers, Reduce flashing). Lint is clean on the touched files.
- The full unit suite: 20,047 passed, 3 failed in 4 files (`records-view`, `odyssey-level-briefing`,
  `game-over-modal-result-compatibility`, `tts-recorder-e2e`). The same four fail on untouched
  `main` (the first three expect "250,000" where this machine's locale writes "250 000").
- Playground captures, zero console errors each, in the evidence folder: totality with no board,
  totality with a board, late totality (t = 40), the sliver (t = 60), a Quad with its fireball at
  1.1 s, a lock at 0.7 s, a quiet meteor (t = 35), Minimal on the WebGL2 backend, and phone portrait
  (390×844) and landscape (844×390) at Low on the WebGL2 backend.
- In game, from a production build: `node scripts/validate-all-themes.mjs --theme blood-moon`: PASS,
  0 lifecycle failures, 0 console errors, 0 process failures; it refreshed
  `docs/theme-screenshots/blood-moon.png` (and its result JSON).
- Cost, the perf lane (`validate-all-themes.mjs --theme blood-moon --perf`, production build, High,
  WebGPU, this machine's NVIDIA Blackwell GPU), old Blood Moon (main) against the new one in the same
  session (records: `perf-lane-old.json`, `perf-lane-new.json` in the evidence folder):

  | | Old | New |
  | --- | --- | --- |
  | GPU per frame, median / 95th percentile | 0.066 / 0.98 ms | 0.197 / 0.26 ms |
  | CPU per frame, median | 0.3 ms | 0.3 ms |
  | Pipelines | 9 | 6 |
  | Draw calls at rest | 6 | 2 |
  | Theme switch (first / second visit) | 488 / 169 ms | 473 / 234 ms |

  Other sessions were rendering on the same GPU during the sweep, so treat the small differences
  as noise. The 2026-10 fleet record (RTX 3070 laptop) had the old theme at 0.79 ms GPU.

## Open

- An integrated GPU and a physical phone. The repo's mobile validator
  (`scripts/validate-mobile-webgl2.mjs`) needs Playwright, which is not installed here; the phone
  captures above are Electron windows at phone sizes, not devices.

## Notes for the next session

- Electron exits with code 127 before running its script when an argument is a bare URL containing
  `&` (`--url http://…?a=1&b=2`). Pass `--url=http://…` instead; the capture scripts accept it.
- Worktrees that junction `node_modules` share Vite's dependency cache. Start a dev server with
  `VITE_CACHE_DIR=<worktree>/.vite-cache-<port>` (vite.config.js reads it) so it does not
  re-optimise the cache under other sessions' servers.
