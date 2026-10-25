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
| Piece lock | Pulses in the piece's own colour leave both edges of the board and run outward along the two leading arcs, taking over a stretch of curtain; the side the piece landed on takes more. The curtain just beside the board wakes, and quick hands build it into a blazing stretch. A ring opens on the lake. A hard drop is stronger. |
| Line clear | Every arc is strummed: colour pulses, a billow that moves the fabric, an awake front running out along every arc from the board, flames climbing the rays (two on a bigger clear), taller curtains, a pink hem, a wave on the lake. A clearing lock is one cue, not two. |
| Four lines | Breakup: the whole sky wakes from the board outward, the near arc violet-topped and the others red-crowned, a train of flames climbs the rays, and the corona breaks out overhead — lavender rays converging on the magnetic zenith — with a meteor volley. |
| Clear streak | Each consecutive clearing lock sends one surge the length of the sky, an awake stretch riding with it, and winds the display up: faster rays, deeper folds, a storm tint, a red crown, meteors from 3, corona from 5. A lock that clears nothing ends it. |
| Fever, and after | The substorm wakes the weather everywhere and turns it over faster. Once the hands rest, pulsating patches come up across the quiet sky while the storm recovers, and fade with it. |
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
| `aurora-weather.js` | Where along each arc the display is awake: wandering ambient cells, event cells that build with play, each arc's fold breathing |
| `aurora-field.js` | Arc geometry and character shared by CPU and GPU; the excitation map pulses are painted into; the activity-cell layout |
| `aurora-curtains.js` | The march material and its direction-mapped buffer |
| `aurora-sky.js` | Sky dome, Milky Way, star catalogue sprites, meteor pool |
| `aurora-atmosphere.js` | The air every surface is seen through: patchy ground mist and haze, lit by the curtains above |
| `aurora-landscape.js` | Baked range, snow banks with frost glints, near spruces, far forest, mirror lake with shore ice and its rings |
| `aurora-air.js` | Diamond dust: ice crystals glinting in the display's colour |
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

The ground and air added on 2026-10-20 (next section) scale with the same tiers:

| Tier | Near spruces | Far forest | Diamond dust | Frost glint density |
| --- | ---: | ---: | ---: | ---: |
| Extreme | 46 | 760 | 1500 | 260 |
| Ultra | 38 | 640 | 1100 | 200 |
| High | 30 | 520 | 800 | 150 |
| Medium | 22 | 380 | 480 | 100 |
| Low | 14 | 250 | 220 | 60 |
| Minimal | 8 | 150 | 100 | 32 |

## Atmosphere and ground pass (2026-10-20)

The sky was finished; the ground under it read as paper cut-outs. This pass rebuilt the
landscape and the air without touching the curtains or the event language.
[Before](aurora-overhaul/atmosphere-before.jpg) and [after](aurora-overhaul/atmosphere-idle.jpg),
the same frame (`?effect=aurora&quality=High&t=20`, 1600 × 900, WebGPU).

- **Air** (`aurora-atmosphere.js`). Two exponential height layers, a cold ground mist (scale
  height 24) and a thin haze (700), integrated in closed form along the segment from the eye
  to whatever is shaded. Lake, banks, trees, range and sky dome all call the same function,
  so the far range sinks into its valleys' mist with no seam against the sky. The mist is
  patchy where the segment ends low (a drifting noise read) and is lit by the curtain
  radiance a little above it, so a pulse that turns a curtain magenta turns the mist under
  it too. The planar mirror's eye below the water sees the same air (heights are absolute).
- **Light from the display.** `litSurface` takes the curtain radiance standing over each
  surface: snow facing the sky takes its colour, and snow edges against the curtains (ridge
  cornices, the boughs' rims) are backlit by it.
- **Spruces.** Each tree is now 22 whorls of drooping branches. A branch is a tapering tent
  (a snow-bearing roof over a dark underside) with sub-branch tips hanging from its edges,
  around a dark core cone. Normals are written per vertex, and `orientTriangles` winds every
  triangle to agree with them: a double-sided node material flips the normal of a back face,
  and the first build lit every roof as an underside (the snow mask read zero everywhere).
- **Far forest.** 150–760 small spruces stand in groves on the range's low forested slopes,
  and every other grove grows at the waterline, so a broken dark treeline separates the lake
  from the snowfields and mirrors in the water. A far tree is about 330 triangles.
- **Range.** Per-pixel snow and rock from three world-space noise reads: rock ribs bared
  on steep faces, snow streaks down the fall line (read in face space, so they run downhill),
  warped strata, and wind drifts on the open snow.
- **Shore ice and frost.** A baked mask freezes the shallows along both banks in tongues:
  frosted, cracked, a dim mirror that ripples do not move, with a faint lip at open water
  ([close-up](aurora-overhaul/atmosphere-shore-ice.jpg)). The banks carry frost glints on a
  grid laid out in the resting eye's angles, so a glint is a few pixels at any range and
  stays put while the camera breathes.
- **Diamond dust** (`aurora-air.js`). Crystals drift on a slow wind through a box anchored
  to the resting eye and wrap at its walls; each flares briefly in the colour of the curtain
  above it. All placement happens in the vertex stage; nothing is allocated after the build.
- **Milky Way.** Its plane now rises from behind the left spruces across the empty upper
  left of the frame (it ran mostly outside the frame before), and its finer reads are
  isotropic: stretched 2.4 : 1 along the band they combed into streaks.
- **Lake rings** are lit on their crests only, so a clear sends thin rings of light across
  the water instead of a lit disc ([streak of 6](aurora-overhaul/atmosphere-streak.jpg)).

Checks for this pass: `tests/unit/aurora-shaders.test.js` builds every material and the
curtain march through the WGSL and GLSL node builders at High and Low (no throw, no
warning, no NaN literal, no stringified node, no equal-edge smoothstep, each stage under
96 KB); `tests/unit/aurora-landscape.test.js` covers the closed-form air against numerical
integration, tree winding and snow placement, grove clustering, the ice mask and the new
budgets. Captured on WebGPU at High (idle, four-line clear, streak of 6, shore close-up),
WebGL2 at Low and [Minimal](aurora-overhaul/atmosphere-minimal-webgl2.jpg), and portrait
390 × 844 at Medium, with no console errors. Not measured: frame time. The far forest and
the near spruces are drawn twice on the planar-mirror tiers (scene and reflection), which is
where most of the added triangles go. The theme icon still shows the earlier ground.

The analytic mirror reflects the sky gradient, the curtain buffer along the reflected ray
and the skyline from a baked ridge profile, with the same ripples as the planar mirror.
MSAA follows the player's antialiasing setting. These are allocation budgets, not
measurements of frame rate.

## Sky weather and event pass (2026-10-25)

Olov: "improve the aurora so it feels more varied around the sky and have better event
effects." Before this pass every stretch of every arc was the same green curtain with the
same faint purple tops, minute after minute, and most events only recoloured it: a two-line
clear barely differed from idle, and the band meant to climb the rays brightened only their
already faint tops, so it could not be seen.

**Variety.** A real display is awake in places: stretches flare into tall, sharp, coloured
rays while the rest glows as a quiet, smooth band, and the activity wanders.
`aurora-weather.js` gives each resting arc five activity cells, `[bearing, 1 / half-width,
strength, tops]`, that the march sums at every sample (`cellLife()` in `aurora-field.js` is
the CPU twin). Bearings and widths are radians of view along the arc (`atan(s / distance)`),
so a cell reads the same size wherever it stands, however far the arc recedes there.

- **Two ambient cells per arc** wander on their own. Each lives one cycle of its own period
  (29–61 s of weather, never a common beat): born at a hashed bearing in view, it swells,
  drifts up to 0.3 rad and fades, then comes back elsewhere, red-crowned or violet-topped as
  its hash leans. They are a pure function of the weather clock, so the sky replays exactly
  and draws on no random stream. The clock runs up to 2.2× faster, and the cells swell, as
  the storm builds.
- **How a stretch reads.** A quiet stretch is dimmer (down to half), smoother (ray contrast
  toward 0.62–1 instead of 0.16–1) and lower (down to 0.72× ray height); each arc's own
  floor (`lively`, 0.22–0.4) keeps it from going all the way. An awake one is up to 1.5× as bright,
  1.25× as tall, and carries its arc's colours: the crown, violet and hem multipliers rise
  with it, capped so the green body always shows under a storm's colours.
- **Each arc has a character** (`ARC_CHARACTER`): the main arc's tall rays reach into
  sunlight (violet tops, 1.35×), the cross arc burns a pink lower border (1.5×) in a cooler
  green, and the far arc wears the red crown (2.4×) in a yellower green. The corona keeps its
  old look exactly.
- **Folds breathe.** Each arc's fold depth swings ±42% on its own slow beat (97, 131, 113 s),
  so an arc is sometimes a nearly straight band and sometimes a deep S.
- **Pulsating aurora.** Soft pale patches on a 105 km shell switch slowly on and off (a 7 s
  beat, lit for about half of it with soft edges, far below any flash threshold), each patch on its
  own phase read from a coarser tile so it lights nearly as one. Faint on a quiet night
  (strength 0.32), they come up to 1.22 while a storm recovers and fade with it: the quiet
  form a real display takes after a substorm.

[Four moments of an idle sky](aurora-overhaul/weather-variety.jpg) (`t=20`, `140`, `310`,
`400`): the tall S-ribbon; a rayed curtain with quiet left stretches; a broad quiet arc under
pulsating patches; a red-crowned stretch blazing mid-sky.

**Events.** Every cue now also wakes the sky through event cells, three per arc. A hit near a
cell still lit, moving the same way, joins it (a `Swell` per cell: it adds, it never
restarts); otherwise it takes a free cell or the faintest. A cell may spread (radians per
second, easing off over 1.1 s) and travel (a steady pace).

- A lock wakes the stretches just beside the board on the two leading arcs; twelve quick
  locks build them from a glimmer into a blazing stretch, under a 1.3 ceiling.
- A clear wakes every resting arc at the board and spreads it out at 0.36–0.54 rad/s, so an
  awake front runs out along the sky; two or more lines colour its tops.
- A quad breaks the whole sky up (spreading at 0.95 rad/s), the near arc violet-topped and the
  others red-crowned; a streak's surge carries an awake stretch along with it at its pace;
  cascades, back-to-backs, T-spins, perfect clears and level-ups each wake the sky in their
  own colours.
- **Flames.** A band climbing the rays now lights them at its own height, well above where
  their green has faded (`flame` in the march), instead of only scaling light that was
  already faint there, so the wave is seen running up the curtain. A clear of two or more
  lines sends a second flame 0.22 s behind the first, and a quad a train of two more. The
  band pool grew from three to four so the train never takes the strum's place.
- Reduced motion keeps every cell's light and slows only how far it spreads and travels.

[Events](aurora-overhaul/weather-events.jpg): twelve quick locks (the stretch right of the
board blazes), a two-line clear (the cross arc wakes along its length), a quad 0.45 s in,
and the pulsating patches 8 s after a storm.

**Cost, by construction.** No timings: the GPUs on this machine are shared with the user's
parallel sessions. Per march sample per resting arc, one `atan` and five `exp`; per curtain
buffer pixel, two noise reads for the patches. Twenty `vec4` and five `float` uniforms more.
On the CPU, nine `Swell` reads a frame. Nothing is allocated at event time: `wake()` takes
positional arguments and the cells are fixed at build.

**Checks.** `tests/unit/aurora-weather.test.js` (13 tests): ambient cells cover a wide reach of
each arc and come and go; they replay exactly and ignore the frame rate; folds breathe out of
step within bounds; `cellLife()` reads a cell only where it stands; hits join and plateau under
the ceiling; a full arc gives up only its faintest cell; spread eases and travel holds its
pace; everything settles exactly. On the director: a lock wakes the curtain beside the board
and quick hands build it; a clear's front spreads along every arc; a quad wakes the sky
violet over red; a streak carries a travelling cell; a storm raises the patches and settles
exactly; reduced motion narrows only the spread. Two surge tests that took "the youngest band"
for the quad's own now take the eldest, since the quad's flames follow it. All 102 Aurora
tests pass; the shader build test passes on WGSL and GLSL at High and Low within the stage
size budget; ESLint on the touched files is at main's baseline. Captured in the playground on
WebGPU at High and on WebGL2 at Low and Minimal, and in the real game at High on WebGPU (six
real hard drops through the event bus, then injected quad and storm), with no console errors
beyond the environment's SteamCloud notices. `validate-all-themes --theme aurora` passed: 0
lifecycle failures, 0 console errors. The fleet screenshot `docs/theme-screenshots/aurora.png`
now shows the rebuilt scene.

## Reproducible preview

Run `npm run dev:playground` and open:

- `/playground.html?effect=aurora&quality=High&t=20`
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=lock&eventAge=0.3&color=%23ff88ee&column=7&drop=12`
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=quad&eventAge=0.8`
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=combo&combo=6&eventAge=0.8`
- `/playground.html?effect=aurora&quality=High&t=310` (a quiet night under pulsating patches)
- `/playground.html?effect=aurora&quality=High&t=20&board=1&event=rush&eventAge=0.3&column=3`
- `/playground.html?effect=aurora&quality=High&t=40&board=1&event=storm&eventAge=8`
- `/playground.html?effect=aurora&quality=Low&t=20&forceWebGL=1`

`t` fixes the animation phase (and the sky's weather); `eventAge` fixes the time since the
cue. A streak is replayed as real consecutive clearing locks, a storm as twelve of them 0.64 s
apart into a fever, a rush as twelve quick locks that clear nothing. Other parameters:
`event=clear|tspin|perfect|level`, `lines`, `reduce=1`.

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
  they match nothing now. (`docs/theme-screenshots/aurora.png` was refreshed by the
  2026-10-25 pass.)
- Minimal's 8-sample march shows slight stepping on the tightest fold. Portrait is framed
  by camera only; the arcs are authored for landscape.
- Online multiplayer and Odyssey levels that use this theme were not played through.
- 2026-10-25 pass: the far arc's red crown rarely shows, since the range hides most of that
  arc; the pulsating patches are a judgement call (at rest they can read as faint lit cloud
  over the Milky Way: `RESTING_PULSATION` in `aurora-director.js` sets how strongly); the
  theme icon still shows the scene before this pass; not checked on portrait or an Odyssey orb.
