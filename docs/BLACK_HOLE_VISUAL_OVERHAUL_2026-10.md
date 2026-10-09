# Black Hole visual overhaul — October 2026

Black Hole is rebuilt on the pinned Three.js 0.186.1 node renderer, on native WebGPU and on
its WebGL2 backend. The previous theme assembled its hole from separate pieces — a flat
ring for the disk, a billboard arc standing in for the far side, a circle for the photon
ring, point sprites for stars, three compute kernels for particles. The rebuild draws the
hole the way it would be seen: every view ray is traced through the curved space around it.
One procedural world and one event director serve the production theme and the isolated
playground. This is an implementation record, not a backlog; ADR-0007, ADR-0016, ADR-0018,
ADR-0019 and ADR-0020 remain the governing contracts.

## Art direction

A black hole hangs in the free space beside the board, large enough that its disk runs
behind the playfield and off the edge of the screen. The camera circles it once every
minute and a half, floating above and below the plane of the disk, so the picture is never
the same twice: a broad tilted whirlpool one minute, and the next the hole seen edge-on —
the near side of the disk a blade across the shadow, the far side lifted into an arch over
it and its second image tucked underneath. Behind it lie the Milky Way and a few thousand
stars, and every one of them is bent: the galaxy smears into a ring around the shadow and
stars near it stretch into arcs and slide round as the camera moves.

The resting disk is gold: ember red at its frayed rim, white where the gas approaching the
camera is beamed brighter, with a razor of light — the photon ring — on the edge of the
shadow. Colour arrives with play. The player feeds the hole, and each piece arrives in its
own colour.

## How the hole is drawn

- **One material traces every ray** (`black-hole-lens.js`). In Schwarzschild geometry a
  photon's path obeys `x'' = -(3/2) h² x / |x|⁵` with `h = |x × x'|`, which is exact for null
  geodesics, so a plain symplectic step integrates it. Lengths are in Schwarzschild radii in
  the disk's own frame. Steps are a fixed fraction of the distance to the hole, so a ray
  spends its budget where space is most curved.
- **Only rays that come near the disk are marched.** A ray that misses a sphere of 11.6
  radii takes the closed-form bend of the same force law along a straight line, and a
  marched ray takes that closed form for the stretches before and after the sphere. The
  closed form is first-order and the march is exact, so the two are eased into each other
  across a band inside the sphere; there is no seam.
- **The shadow's edge is not integrated at all.** A ray from outside is captured exactly
  when its impact parameter is below `3√3/2` radii, so the edge is that test, anti-aliased
  over one pixel, on every tier. The photon ring is the analytic pile-up of light just
  outside it, dimmed by whatever gas lies in front.
- **The disk is a thin sheet** from the innermost stable orbit at 3 radii to a frayed rim
  near 10.5, with a faint glow where gas plunges inside it. A ray lights it wherever it
  crosses the plane — the first crossing is the disk, later ones are its lensed images.
  The gas is one baked tile whose features run long round the disk (`black-hole-noise.js`),
  advected with Keplerian shear by two phases that cross-fade so neither is ever seen
  resetting, read at a mip level chosen from the pixel's footprint on the disk. Its colour
  is a blackbody-like ramp over temperature; its brightness carries relativistic beaming and
  gravitational redshift. A shoulder on the brightest channel keeps an excited disk from
  clipping into a white plate.
- **The sky is evaluated along the bent ray.** The unresolved glow — band, bulge, dust
  lanes, a few emission clouds — is a small panorama baked on the CPU in slices while the
  renderer comes up, mottled in the shader so it keeps its grain where the lens magnifies
  it. Stars are not baked: each is a jittered point in a lattice on the unit sphere,
  evaluated per pixel and never drawn thinner than a pixel, so they stay sharp and do not
  shimmer however far the lens stretches them.
- **Everything that moves is closed-form** (`black-hole-matter.js`): dust on Keplerian
  orbits, fed pieces, ejecta and the jets are functions of a clock and a few per-event
  uniforms evaluated in the vertex shader. Nothing is simulated or uploaded per frame, a
  frame can be replayed exactly, and both backends run the same code. Each mote is a
  streak from where it was a moment ago, displaced by the thin-lens image of a point mass,
  so matter passing behind the hole rises around the shadow instead of crossing it.

## Event language

The player feeds the hole. `black-hole-director.js` turns bus events into state; it is
plain numbers with no three, DOM or timers, and replays exactly from `reset()`.

| Trigger | Response |
| --- | --- |
| Piece lock | The piece's own four cells dissolve into a stream of its colour that leaves the board where it landed, spirals in with the gas and comes down on the disk. Where it lands a hot arc of that colour lights, rides its orbit, shears out and cools over four seconds — and is seen twice, once directly and once lensed round the far side. A ring of refraction opens at the board; the photon ring answers when the last of it is in. A hard drop is faster and brighter. |
| Line clear | A pressure wave runs out through the disk, the gas spins up and heats, the photon ring flares, dust is drawn inward and space ripples from the cleared rows. A clearing lock is one cue, not two. |
| Four lines | The hole fires its jets along its axis, throws ejecta off the inner edge and sends a ripple across the whole screen from the hole itself. |
| Clear streak | From the second consecutive clearing lock, each one throws ejecta and winds the hole up — hotter, faster, brighter. From five the jets stay lit; from eight every clear sends the screen-wide ripple. A lock that clears nothing, or nine quiet seconds, lets it go. |
| Cascade | The bus `COMBO` event is cascade depth inside one lock, not a streak; it sends an echo of the pressure wave. The streak is counted with `ComboTracker`. |
| T-spin, perfect clear, level up | The gas whips round and a violet knot lights where it tore; three gold arcs, the ring at full bloom and the jets; a slow pressure wave. |
| Game over, mode stop, effects off | The hole settles to exact rest; the streak is forgotten. |

Fed pieces, hot arcs, waves, ripples and bursts live in fixed pools created at build time;
nothing is allocated or compiled at event time, and the parked layers are drawn once before
the first frame so their pipelines exist. Under `prefers-reduced-motion` every event
remains, the camera holds still, and shake and refraction are dropped. `backgroundComboEffects`
gates all reactions; `pieceLockRipple` gates only the visible feed, never the streak
bookkeeping. Board rectangles are read from the DOM on layout changes (never in a bus
handler), so a piece leaves from where it landed and local multiplayer boards each feed the
hole from their own place.

## Runtime ownership

| Module | Responsibility |
| --- | --- |
| `black-hole-theme.js` | Renderer selection and fallback, generation-safe start, events, settings, sizing, dynamic resolution, GPU recovery, disposal |
| `black-hole-world.js` | Shared artwork for theme and playground: bakes, camera choreography and framing, the gas clock, director wiring |
| `black-hole-director.js` | Gameplay → state: cues, pools, decay, streak counting |
| `black-hole-lens.js` | The ray-traced hole: geodesic march, disk, photon ring, lensed galaxy and stars |
| `black-hole-matter.js` | Dust, fed pieces, ejecta and jets as closed-form instanced streaks |
| `black-hole-post.js` | Refraction ripples, bloom and grade; direct rendering on the cheapest tier |
| `black-hole-noise.js`, `black-hole-quality.js`, `black-hole-resolution.js`, `black-hole-board-rects.js`, `black-hole-disk-basis.js` | Deterministic bakes, tier budgets, the dynamic-resolution controller, board rectangles, the disk's plane |
| `src/playground/effects/black-hole.effect.js` | The same world in isolation, with deterministic event replay |

Removed with the old theme: `black-hole-materials.js`, `black-hole-compute.js`,
`black-hole-fx-controller.js`, the `black-hole-burst` and `black-hole-performance`
playground effects, `scripts/black-hole-contact-sheet.mjs`, the theme's DOM layers in
`index.html`, its emissive render target and its three compute kernels.

## Quality budgets

Every tier keeps the whole picture and every event.

| Tier | March steps | Step | Gas octaves | Star layers | Galaxy | Dust | Ejecta | Fed motes × slots | Post | DPR cap |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- | ---: |
| Extreme | 96 | 0.100 | 2 | 2 | 768 × 384 | 5200 | 6400 | 144 × 8 | bloom 0.50, dispersion | 1.15 |
| Ultra | 80 | 0.115 | 2 | 2 | 640 × 320 | 3800 | 4400 | 120 × 8 | bloom 0.50, dispersion | 1.10 |
| High | 64 | 0.135 | 2 | 2 | 512 × 256 | 2400 | 2800 | 96 × 8 | bloom 0.45, dispersion | 1.00 |
| Medium | 48 | 0.170 | 2 | 2 | 512 × 256 | 1500 | 1800 | 72 × 6 | bloom 0.38 | 0.95 |
| Low | 36 | 0.210 | 1 | 1 | 384 × 192 | 800 | 1000 | 48 × 6 | bloom 0.32 | 0.85 |
| Minimal | 28 | 0.260 | 1 | 1 | 256 × 128 | 420 | 520 | 32 × 4 | direct | 0.85 |

"Step" is the stride as a fraction of the distance to the hole. These are allocation
budgets, not measurements of frame rate.

### Dynamic resolution

Nearly all of the frame is one fragment shader whose cost follows the pixels drawn, so
render scale is the lever that tracks load. The controller moves out of the theme into
`black-hole-resolution.js`, as plain numbers, and is rewritten. As before it steers on
measured GPU render time where the backend reports it, on frame time otherwise, and holds
its target to the display's refresh rate. But frame time is a poor witness, in four ways
the old controller did not handle:

- **It cannot show headroom.** A frame never arrives early, so on that signal the old
  controller could step down and never come back. Now on-time frames are reason enough to
  probe a step up, and a scale that just failed stays off-limits for 20 s, doubling each
  time the probe fails again, so the picture does not pump.
- **It is ragged.** Frames land on whole refresh intervals. The reading is averaged over
  about a second and acted on only after it has read late twice running and stopped moving.
- **It must be the browser's cadence, not the theme's.** Under a frame-rate cap the theme
  draws on only some animation frames, and the spacing of the frames it chose to draw
  says how the cap fell on the refresh rate, not whether the device kept up. The theme
  now counts the animation frames it skipped and reports the cadence of all of them.
- **It is late for reasons that have nothing to do with pixels.** Every run of steps down
  is judged against the reading it started from; when two steps have bought nothing the
  resolution is handed back in full, and the controller waits 30 s (doubling) before
  trying again. A run of frames far over budget counts as load rather than as a hitch, so
  a device that cannot keep up at all still reaches its floor.

## Reproducible preview

Run `npm run dev:playground` and open:

- `/playground.html?effect=black-hole&quality=High&t=12&az=0.5&el=0.16&dist=1000&frame=-0.6&board=1`
- `/playground.html?effect=black-hole&quality=High&t=16&az=3.4&el=0.2&dist=1000&frame=-0.6&board=1`
- `…&event=lock&eventAge=0.75&color=%2362ffe0&row=10&drop=4` (and `eventAge=2.2` for the landed arc)
- `…&event=clear&lines=2&eventAge=0.5`
- `…&event=quad&eventAge=1.0`
- `…&event=combo&combo=8&eventAge=0.5`
- `/playground.html?effect=black-hole&quality=Low&t=30&forceWebGL=1`

`t` fixes the animation phase; `eventAge` fixes the time since the cue. A streak is replayed
as real consecutive clearing locks. `az`, `el`, `dist` and `frame` hold the camera; without
them it follows the theme's own path. Other parameters: `event=tspin|perfect|level`,
`lines`, `column`, `row`, `reduce=1`, `tone=aces|agx|neutral`, and per-term gains for
bisecting a look (`disk`, `ring`, `heat`, `sky`, `stars`, `doppler`, `bloom`, `exposure`).

### Theme icon

`src/themes/black-hole/black-hole-theme-icon.png` (and its copy under
`public/assets/themes/`) is a frame of the scene itself, 2.7 s after a perfect clear, when
the ejecta have thinned and the jets are still lit:

- `/playground.html?effect=black-hole&quality=Extreme&t=20&icon=1&event=perfect&eventAge=2.7`

`icon=1` holds the hole dead centre and nearly edge-on through a 27° lens rolled 24°, so the
shadow, the arch over it, the blade across it and both jets sit inside the circle the theme
picker cuts, and lifts exposure and the sky a little for the small size (`iconFov`,
`iconRoll`, `iconAz`, `iconEl` override the lens). The frame was captured at 1400 × 1400 on
WebGPU and reduced to 512 × 512; two captures were byte-identical. The file follows the
house style of the other theme icons (`scripts/process_icons.py`): a circle touching all
four edges on a transparent ground, with an anti-aliased rim. It was previewed at 80 px
beside its neighbours ([sheet](black-hole-overhaul/icon-sheet.jpg)); it was not checked in
the running theme picker or on an Odyssey level orb. Void Ember's registry entry pointed at
the same file and so showed the new picture too, until Void Ember got its own icon on
2026-10-09 ([VOID_EMBER_VISUAL_OVERHAUL_2026-10.md](VOID_EMBER_VISUAL_OVERHAUL_2026-10.md)).

## Acceptance evidence

Captures were taken through Electron on this machine, from the Vite dev server.

| Capture | Surface |
| --- | --- |
| [idle](black-hole-overhaul/idle.jpg), [edge-on](black-hole-overhaul/edge-on.jpg) | Playground, High, WebGPU (`nvidia ampere`), stand-in board |
| [lock](black-hole-overhaul/lock.jpg), [landed arc](black-hole-overhaul/landed.jpg) | Playground, High, WebGPU: 0.75 s and 2.2 s after a lock |
| [clear](black-hole-overhaul/clear.jpg), [four lines](black-hole-overhaul/four-lines.jpg), [streak of eight](black-hole-overhaul/streak.jpg) | Playground, High, WebGPU |
| [Minimal](black-hole-overhaul/minimal.jpg), [Minimal, four lines](black-hole-overhaul/minimal-four-lines.jpg) | Playground, Minimal, WebGPU: 28 steps, no post chain — the same lock as above, and the jets |
| [portrait](black-hole-overhaul/portrait-low-webgl2.jpg) | Playground, 390 × 844, Low, WebGL2 |
| [in-game idle](black-hole-overhaul/in-game-idle.jpg), [lock](black-hole-overhaul/in-game-lock.jpg), [clear](black-hole-overhaul/in-game-clear.jpg), [streak](black-hole-overhaul/in-game-streak.jpg), [four lines](black-hole-overhaul/in-game-four-lines.jpg) | Production theme under a real single-player board, High, WebGPU, events sent through the real event bus |
| [in-game, WebGL2 Low](black-hole-overhaul/in-game-webgl2-low.jpg) | The same run with `?forceWebGL=1` at Low |
| [in-game, integrated GPU](black-hole-overhaul/in-game-igpu-low.jpg) | The same run at Low on the machine's integrated Radeon (`amd gcn-5`), WebGPU |

Every playground capture records the tier and backend it ran on and the page's console.
All ten ran where the table says and logged no warning or error.

**In game.** A real single-player board on the dev server, events sent through the real
event bus: one lock, a two-line clear, four single clears in a row, a four-line clear.

| Run | Result |
| --- | --- |
| High, WebGPU, `nvidia ampere` | No errors. One warning, from `BaseTheme` ("already active or paused, stopping before restart"), on the live quality change. Changing High → Medium while running rebuilt the scene on one canvas; leaving for another theme left no canvas behind. Render scale 1 throughout, steered on GPU time. |
| Low, WebGPU, integrated Radeon (`amd gcn-5`) | No warning or error. Render scale 1 throughout, steered on GPU time. |
| Low, WebGL2 (`?forceWebGL=1`), three runs | No warning or error. Two runs held render scale 1 throughout, with animation frames averaging 10.5 ms and 10.8 ms through the events against a 16.7 ms budget on a 120 Hz display. In the third, with other sessions' jobs on the machine, frames read 28–41 % late: the controller shed two steps, found the reading no better and was back at full scale 5.6 s after the first. |

**Theme validator.** `node scripts/validate-all-themes.mjs --theme black-hole` in a fresh
Electron process against the dev server: PASS — 0 lifecycle failures, 0 console errors,
0 process failures.

**Tests.** `tests/unit/black-hole-director.test.js`, `black-hole-world.test.js` and
`black-hole-theme.test.js`: 85 tests. They replace the four suites of the old theme. Faults
they or the captures found on the way, all fixed:

- Director outputs approached rest without ever reaching it, and `reset()` left the pools
  as the last event had them, so a replay was not exact.
- A lock whose stream the world never launched still lit its arc on the disk.
- On WebGL2 only, the event layers failed to build (`VarNode.build` outside a stack) the
  first time one became visible: a nested `select()` in the streak vertex stage.
- Additive matter wrote alpha, which unmasked the bloom inside the shadow as a grey
  rectangle; the world-space jet ribbon was back-face culled and invisible.
- Under reduced motion the camera still pushed in on events.
- The dynamic-resolution faults listed above. Each has a test that drives the controller
  with a modelled device: one that sheds load with pixels, one that does not, one that
  holds a scale and fails just above it, a 144 Hz display under a 60 fps cap, and a
  display that drops a frame now and then.

**Gates**, run on this branch: `npm run typecheck`; `ts-ratchet-check` (60 files, at
baseline); `npm run lint:ci` (1070 errors, at baseline); `architecture-fitness-check`
(passes; shader-material hits 290 → 276 and resize listeners 46 → 44, not locked in);
`npm run audit:theme-lifecycle`; `npm run check:boundaries` (1107 modules, no violations);
`npm run perf:budgets:gate`; `npm run check:release-gates`; `npm run build` with the
boot-closure guard; `npm run check:ip-strings`; `npm run check:pages-artifact`.

`npm test`, the whole suite in parallel: 6398 tests passed, 3 skipped, 2 failed, and one
file's setup hook timed out. All three are Odyssey world-bake tests with wall-clock limits
(`odyssey-forest`, `odyssey-forest-lever`, `odyssey-world-bake-loader`) in files this branch
does not touch; on a machine shared with other sessions' jobs they ran over their limits.
Run on their own, all 43 tests in those three files pass.

## Not done, not measured

- **No performance measurement.** No frame time, GPU time or battery figure is claimed
  (ADR-0016): the machine was running other sessions' GPU captures throughout. The frame
  cadences and render scales quoted under "In game" are what single runs on that shared
  machine showed, there to say what dynamic resolution did, not how fast the theme is.
  Physical phones were not exercised.
- `architecture-fitness.json` was left untouched while other theme work is in flight.
- The stylesheet rules for the removed DOM layers remain in `public/styles/main.css`; they
  match nothing now. `docs/theme-screenshots/black-hole.png` still shows the previous
  artwork; `scripts/capture-theme-screenshots.mjs` writes it during a fleet capture, which
  was not run.
- The far field is bent to first order, which under-bends the sky by about a tenth at the
  edge of the marched sphere; the handover band hides the join, not the error.
- Jets, dust and fed matter are bent by a point-mass thin lens, not by the march: close to
  the shadow they are an approximation, and a mote dead behind the hole fades out rather
  than smearing round the ring.
- Online multiplayer and Odyssey levels that use this theme were not played through. With
  boards across most of the width there is no free gap, and the hole wanders behind them.
