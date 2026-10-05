# Aurora visual overhaul — October 2026

Aurora is rebuilt on the pinned Three.js 0.186.1 node renderer, on native WebGPU and on its
WebGL2 backend, replacing the WebGL theme of six GLSL materials on flat additive planes.
One procedural world and one event director serve the production theme and the isolated
playground. This is an implementation record, not a backlog; ADR-0007, ADR-0016, ADR-0018
and ADR-0019 remain the governing contracts.

## Art direction

A clear arctic night over a lake. One auroral ribbon falls on the diagonal from above the
board to the right-hand horizon, twisting through a fold on the way; a second arc weaves
under it and a third glows low behind the range. Two snow massifs frame the board and the
saddle between them stays low behind it. The lake mirrors everything — curtains, peaks,
stars, meteors — drawn into vertical streaks by wind-ruffled water. Spruces on two snow
spits close the lower corners and leave a channel of open water running to the eye.

The resting display is green, as a quiet aurora is. Colour arrives with play: magenta rays
and a red crown in the tall rays, a pink hem on energised lower borders, a lavender corona
overhead in a storm, and the colour of each piece the player places.

## How the aurora is drawn

A real auroral arc is a thin sheet hanging along the magnetic field: nearly identical at
every altitude, endlessly folded sideways. The theme models exactly that.

- `aurora-field.js` defines each arc as a **footprint curve** on a horizontal plane in
  kilometres — a resting line plus four sheared sine folds — extruded up a slightly leaning
  field line between a sharp lower border at 100 km and a 400 km ceiling.
- `aurora-curtains.js` marches each view ray through the slice of sky an arc can occupy and
  integrates the sheet **analytically** between samples: the density kernel
  `(1 + x²)^-3/2` has the closed-form antiderivative `x / sqrt(1 + x²)`, and the distance
  between samples is a cubic Hermite spline built from the field's own gradient. A sheet a
  few kilometres thick is never stepped over, so 8–22 samples give continuous curtains with
  a sharp border, height colour bands and bright edge-on folds. Rays are a noise tile
  sampled along the arc with a mip level that follows the pixel footprint.
- The march renders into a **reduced-resolution buffer mapped by view direction**. The sky
  dome and the lake both read it by direction, so the lake mirrors the display without a
  second march, and the buffer may refresh below the display rate without lagging behind
  camera motion. Its highlights are compressed along their own hue, so bright folds
  saturate toward their colour instead of clipping to white.
- Billows — travelling waves in the fabric itself — are evaluated analytically, gradient
  included, in the same field. An earlier texture-driven displacement was removed: its
  between-sample interpolation error produced a ladder pattern (bisected with playground
  overrides before the change).

## Event language

The player plays the sky like an instrument. `aurora-director.js` turns bus events into
state; it is plain numbers with no three, DOM or timers, and replays exactly from `reset()`.

| Trigger | Response |
| --- | --- |
| Piece lock | Pulses in the piece's own colour leave both edges of the board and run outward along the two leading arcs, taking over a stretch of curtain; the side the piece landed on takes more. A ring opens on the lake. A hard drop is stronger. |
| Line clear | Every arc is strummed: colour pulses, a billow that moves the fabric, a bright band sweeping up the rays, taller curtains, a pink hem, a wave on the lake. A clearing lock is one cue, not two. |
| Four lines | The corona breaks out overhead — lavender rays converging on the magnetic zenith — with a meteor volley. |
| Clear streak | Each consecutive clearing lock sends one surge the length of the sky and winds the display up: faster rays, deeper folds, a storm tint, a red crown, meteors from 3, corona from 5. A lock that clears nothing ends it. |
| Cascade | The bus `COMBO` event is cascade depth inside one lock, not a streak; it deepens that clear. The streak is counted with `ComboTracker`. |
| T-spin, perfect clear, level up | A violet billow; a gold bloom with the corona held; a gentle sweep. |
| Game over, mode stop, effects off | The sky settles; the streak is forgotten. |

Pulses, rings and meteors live in fixed pools created at build time; nothing is allocated
or compiled at event time. Events never flash: a pulse turns the curtain its own colour and
lifts it slightly, and surge, crown, fringe and exposure are capped. Under
`prefers-reduced-motion` every event remains, the camera holds still, shake is dropped and
displacement and corona are softened. `backgroundComboEffects` gates all reactions;
`pieceLockRipple` gates only the visible pluck, never the streak bookkeeping. Board
positions are read from the DOM on layout changes (never in a bus handler), so local
multiplayer boards each answer above their own place.

## Runtime ownership

| Module | Responsibility |
| --- | --- |
| `aurora-theme.js` | Renderer selection and fallback, generation-safe start, events, settings, sizing, GPU recovery, disposal |
| `aurora-world.js` | Shared artwork for theme and playground: camera framing, uniforms, director wiring |
| `aurora-director.js` | Gameplay → sky state: cues, pools, decay, streak counting |
| `aurora-field.js` | Arc geometry shared by CPU and GPU; the excitation map pulses are painted into |
| `aurora-curtains.js` | The march material and its direction-mapped buffer |
| `aurora-sky.js` | Sky dome, Milky Way, star catalogue sprites, meteor pool |
| `aurora-landscape.js` | Baked range, snow banks, spruces, mirror lake and its rings |
| `aurora-post.js` | Bloom and grade; direct rendering on the two cheapest tiers |
| `aurora-quality.js`, `aurora-palette.js`, `aurora-noise.js`, `aurora-board-rects.js` | Tier budgets, colour, deterministic bakes, board spans |
| `src/playground/effects/aurora.effect.js` | The same world in isolation, with deterministic event replay |

## Quality budgets

Every tier keeps the whole picture and all three event languages.

| Tier | Arcs | March steps | Curtain buffer | Refresh cap | Stars | Lake mirror | Post | DPR cap |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- | ---: |
| Extreme | 3 + corona | 22 | 0.75×, half-float | 90 Hz | 9000 | planar 0.50 | bloom 0.60, 4× MSAA | 1.50 |
| Ultra | 3 + corona | 18 | 0.66×, half-float | 72 Hz | 7000 | planar 0.42 | bloom 0.55, 4× MSAA | 1.35 |
| High | 3 + corona | 16 | 0.50×, half-float | 60 Hz | 5200 | planar 0.35 | bloom 0.45, 4× MSAA | 1.25 |
| Medium | 3 + corona | 12 | 0.42×, half-float | 48 Hz | 3400 | planar 0.26 | bloom 0.32 | 1.00 |
| Low | 2 + corona | 10 | 0.36×, RGBA8 | 30 Hz | 2000 | analytic | direct | 0.90 |
| Minimal | 2 + corona | 8 | 0.30×, RGBA8 | 24 Hz | 1200 | analytic | direct | 0.75 |

The analytic mirror reflects the sky gradient, the curtain buffer along the reflected ray
and the skyline from a baked ridge profile, with the same ripples as the planar mirror.
MSAA follows the player's antialiasing setting. These are allocation budgets, not
measurements of frame rate.

## Reproducible preview

Run `npm run dev:playground` and open:

- `/playground.html?effect=aurora&quality=High&t=20`
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=lock&eventAge=0.3&color=%23ff88ee&column=7&drop=12`
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=quad&eventAge=0.8`
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=combo&combo=6&eventAge=0.8`
- `/playground.html?effect=aurora&quality=Low&t=20&forceWebGL=1`

`t` fixes the animation phase; `eventAge` fixes the time since the cue. A streak is replayed
as real consecutive clearing locks. Other parameters: `event=clear|tspin|perfect|level`,
`lines`, `reduce=1`.

### Theme icon

`src/themes/aurora/aurora-theme-icon.png` (and its copy under `public/assets/themes/`) is a
frame of the scene itself, 2.4 s after a four-line clear, when the pink has spread through
the curtains and the lake ring has gone:

- `/playground.html?effect=aurora&quality=Extreme&t=20&icon=1&event=quad&eventAge=2.4`

`icon=1` selects a tighter lens — 48° field of view, turned 7° toward the fold of the
leading arc, horizon at 0.29 of the frame — so the ribbon, the peaks and the mirrored lake
all sit inside the circle the theme picker cuts (`iconFov`, `iconYaw` and `iconHorizon`
override it). The frame was captured at 1400 × 1400 on WebGPU and reduced to 512 × 512;
two captures were byte-identical. The file follows the house style of the other theme
icons (`scripts/process_icons.py`): a circle touching all four edges on a transparent
ground, with an anti-aliased rim. Inside the circle the pixels are the capture's,
untouched. Checked in the real theme picker: the Aurora card loads the 512 px file and
shows it in its 80 px circle. Not checked on an Odyssey level orb.

## Acceptance evidence

Captures were taken through Electron on this machine's discrete GPU (the playground
reports `WebGPU · nvidia ampere`), from the Vite dev server.

| Capture | Surface |
| --- | --- |
| [idle](aurora-overhaul/idle.jpg) | Playground, High, WebGPU |
| [lock](aurora-overhaul/lock.jpg) | Playground, High, WebGPU, 0.3 s after a hard-dropped lock |
| [four-line clear](aurora-overhaul/four-line-clear.jpg) | Playground, High, WebGPU, 0.8 s after the clear |
| [in-game lock](aurora-overhaul/in-game-lock.jpg), [clear](aurora-overhaul/in-game-clear.jpg), [streak](aurora-overhaul/in-game-streak.jpg) | Production theme under a real single-player board, High, WebGPU, events sent through the real event bus |
| [in-game, WebGL2 Low](aurora-overhaul/in-game-webgl2-low.jpg) | The same run with `?forceWebGL=1` at Low: analytic mirror, RGBA8 curtain buffer, no post chain |
| [portrait](aurora-overhaul/portrait-low-webgl2.jpg) | Playground, 390 × 844, Low, WebGL2 |

- Both in-game runs finished with zero console errors or warnings beyond Chromium's
  standing `powerPreference` notice, the streak counted to 6, and leaving the theme left
  zero canvases in the static container.
- `scripts/validate-all-themes.mjs --theme aurora` against the dev server passed: 0
  lifecycle failures, 0 console errors, 0 shader or pipeline failures.
- 59 new tests cover the director (cue selection, streak versus cascade, bounded pools,
  exact replay, frame-rate independence, decay to exact calm, reduced motion, malformed
  payloads), the field and excitation map, the tiers and bakes, the world's fixed resources
  and disposal, and the theme lifecycle (fallback, stale starts, event routing, settings
  gates, rebuilds, teardown). Two faults they caught were fixed: pulses accumulated twice
  whenever the curtain buffer refreshed below the simulation rate, and the reduced-motion
  preference was not applied until it changed.
The gates below were run on the tree integrated with main at `62784d4c` (the Stellar Drift
depth overhaul, the Chiral Gold choreography and phaser 4.2.1), in a temporary worktree so
the shared `dist` was not rewritten. That merge shares no file with this change and does
not touch the shared theme runtime, so the captures above, taken before it, were not
repeated. Local `node_modules` still held phaser 4.1.0; CI installs 4.2.1 from the lock.

- Full suite: 554 files, 6,140 tests, all passing. An earlier run before integration had
  one failure, `odyssey-world-bake-loader` timing out at 5 s under full-suite load; it
  passed alone then and passed in this run.
- Typecheck, TypeScript ratchet, theme lifecycle audit and dependency boundaries (1,087
  modules) pass. The lint ratchet passes at exactly main's ceiling of 1,070 errors, so the
  Aurora files add none. Architecture fitness passes with fewer `ShaderMaterial` sites and
  fewer raw resize listeners than its baseline.
- Production build with the boot-closure guard, the IP-string gate, the Pages artifact
  check, the release gates and the structural performance-budget gate pass.

## Not done, not measured

- **No performance measurement.** No frame time, GPU time or battery figure is claimed
  (ADR-0016). The integrated GPU and physical phones were not exercised.
- `architecture-fitness.json` was left untouched while other theme work is in flight, so
  the lower `ShaderMaterial` and resize-listener counts are not locked in yet.
- The stylesheet rules for the four removed DOM layers remain in `public/styles/main.css`;
  they match nothing now. `docs/theme-screenshots/aurora.png` still shows the previous
  artwork; `scripts/capture-theme-screenshots.mjs` writes it during a fleet capture, which
  was not run.
- Minimal's 8-sample march shows slight stepping on the tightest fold. Portrait is framed
  by camera only; the arcs are authored for landscape.
- Online multiplayer and Odyssey levels that use this theme were not played through.
