# Ocean — the reef canyon at the edge of the blue

Implemented 2026-10-11 on `feature/ocean-masterpiece`, with Three.js 0.186.1. A from-scratch
rebuild: it replaces the earlier theme in full (a 5,000-line lifecycle adapter, the atmosphere,
fish, rare-fauna, reef-dweller and gameplay-effect systems, 57 MB of imported models with their
Blender and TripoSR generators, the `ocean-reef-light` study effect, fourteen test files and
about eighty URL debug flags). Ocean keeps its identity — sunlit shallows over a coral reef,
kelp, fish, the large animals of the open sea — and nothing else. Nothing is loaded: every mesh
is grown in code and every texture is baked on the CPU or painted on the GPU. This document
records the shipped design and what was verified. It is a reference, not a backlog.

## The picture

The viewer rests in the mouth of a reef canyon, looking out and a little upward. Overhead the
surface rolls; the sky is seen through it in Snell's window, and past the window's edge the
surface turns into a moving mirror of the deep. The sun stands somewhere above the frame and its
light comes down through the water in shafts that wander, and the same light lies on the sand
and the coral as a net of caustics, each thread with a fringe of colour.

A garden of coral rises on either side of the board: branching coral, table corals on stalks,
brain corals with their maze, tube sponges, sea fans in lace and anemones that never keep still.
Kelp climbs the shoulders behind them, golden where the light comes through it; seagrass grows in
meadows along the sand channel. A silver school streams through the canyon's mid-water, its
flanks flashing as it turns; small bright reef fish keep to the coral heads; moon jellies hang in
the blue. And something large is always passing out there: a turtle, a manta, a whale far off.

![At rest](ocean-overhaul/01-idle.webp)

## The one idea

The light is ONE pattern. Every frame a small tileable target is painted with the caustic net
(two scales of it) in one channel and the broad mask of the shafts in another. Everything that
is lit looks its own point up along the sun's ray, at the place where that ray came through the
surface; the post stack's shaft march looks every step of its walk up the same way. So a shaft
stands exactly over the bright patch it lays on the sand, both move with the same water, and the
large animals' shadows (capsules along the sun's ray) cut the shafts and the sand alike.

## Event language

| Gameplay | What the sea does |
|---|---|
| Lock | The piece's light sinks from the card's edge on its side to the reef: a bright head with a wake of motes. Where it lands a ring of its colour runs out over sand and coral, a crown of sparks is thrown up, bubbles rise, sand lifts, and the fish nearby dart away (the reef fish into their colony). The colonies round the landing light up in the piece's colour and **hold** it. |
| Hard drop | Lands harder: a ring of pressure crosses the picture from the landing (it bends the image as it passes), more sparks, more bubbles. |
| Line clear | A current crosses the canyon, alternating sides: kelp and grass lean as its front passes and come back. The school draws out into a ribbon and streams across at the height of the cleared rows. The shafts flare. Every colony holding a colour **lets it go** as the front reaches it: a slow upward snow of beads in the colours of the pieces that fed it — the reef spawning. The cleared rows leave the card as sheets of bubbles carried off by the current. |
| T-spin | A ring of bubbles blown where the last piece went in, widening as it climbs, with a ring of light on the reef. |
| Four lines / perfect clear | The sea holds its breath (a third of a second); then one great shaft of light comes down over the board, the school winds itself round it in a spiral, the whole reef spawns at once, a ring of pressure crosses the picture, and the whale is called. A perfect clear also clears the water itself for a while. |
| Combo | The large animals are called in from the blue, one more with each step: at 2 a turtle, at 3 mantas (up to three), at 5 a whale far out, at 7 the whale comes through the canyon over the board, its calf under its flank, its shadow cutting the shafts — and it sings: shells of light run out through the water from it and set the plankton glowing. A pass, once called, finishes whether or not the chain holds. |
| Level up | The light steps one hour on from wherever the clock has carried it (eased over 3.6 s; a new run never turns it back, its first level-up steps on from there too), a long swell passes overhead (the surface's waves stand higher), and a ring of the new hour's light runs out over the whole canyon floor. **The light also moves on by itself, an hour every 100 s of the world's clock, whatever the level** (see below). |
| Game over / new run | The chain breaks and every held colour is let go; the hour stays. |

![A lock's light sinking](ocean-overhaul/03-lock-falling.webp)
![Colonies holding the pieces' colours](ocean-overhaul/05-held.webp)
![A clear's current letting the colours go](ocean-overhaul/07-clear.webp)
![The reef spawning](ocean-overhaul/08-spawn.webp)
![Four lines: the great shaft and the school round the board](ocean-overhaul/10-quad.webp)
![The whale over the board](ocean-overhaul/11-whale.webp)

### The hours

Six hours on a wheel, in the order a day runs and in hue order, so no crossing goes through grey:
the high sun (turquoise water, the light right through it), the gold, the fire (sunset burning in
the window over violet water), the blue hour (indigo, the corals beginning to glow), the moon
(black-blue water, silver shafts, the reef fluorescing, the jellies' rims and the plankton
alight), first light (a rose sun on the other side, clear jade water). The place on the wheel is
`(level − 1) + clock / 100 s`: a new level turns it one whole hour and the clock turns it by
itself in every mode, the ones that never level included. Within an hour the light rests on that
hour's own colours for 15 % at each end and is on its way to the next for the other 70 %
(no hold-then-turn). Unit-tested in `tests/unit/ocean-hours.test.js` and
`tests/unit/ocean-world.test.js` (at a fixed level the light has moved within the first minute
and stands on the next hour one hour of the clock later).

![The six hours](ocean-overhaul/hours.webp)

## How it is built

| Module | What it holds |
|---|---|
| `ocean-core.js` | Three-free numbers: the rig, the seabed's height function (a sand channel, two reef shoulders in crags and shelves, coral heads, far pinnacles, a soft ceiling 3 m under the surface), Snell refraction, the event tables' sizes and timings, the school's loop, the animals' lanes and passes. |
| `ocean-hours.js` | The six hours and the wheel. |
| `ocean-tsl.js` | The shared uniforms and TSL helpers: the water's colour along a direction (`ocBackdrop`), its absorption (`ocFog`), the light pattern pass and its lookups, the sea's light on a surface (`ocLight`), the animals' shadows, and the event loops (rings, held colours, currents, songs). |
| `ocean-surface.js` | The underside of the sea (Snell's window, the mirror of the deep past its edge) and the backdrop dome. |
| `ocean-seabed.js` | The seabed sheet: sand with ripples, reef rock with its crust, the caustic net read three times for its colour fringe. |
| `ocean-plan.js` | Where everything grows (seeded; a lower tier keeps the hero gardens). |
| `ocean-reef.js` | The six colony kinds, each one mesh grown in code and drawn instanced. |
| `ocean-flora.js` | Kelp (one curve per stand, blades on floats streaming downstream) and seagrass. |
| `ocean-fauna.js` | The silver school (a pure function of its uniforms and the startles), reef fish, moon jellies. |
| `ocean-giants.js` | Humpback whales, manta rays, green turtles: grown in code, swum in the vertex stage. |
| `ocean-fx.js` | The event pool (drift, home, bubble, bead, puff) and the marine snow. |
| `ocean-world.js` | The choreography; shared by the theme and the playground effect. |
| `ocean-post.js` | Shaft march (reduced-resolution `rtt`), pressure rings, fringe, calm zones over the card and HUD, bloom, sea filmic tone map, grade, grain. |
| `ocean-director.js`, `ocean-composition.js` | The fleet's gameplay director and layout reader (as in Stillwater). |
| `ocean-theme.js` | The lifecycle adapter (as in Stillwater, without an asset wait). |

Everything is a function of the world clock and event timestamps (nothing is created at event
time), so `seek(t)` plus a fixed-step replay reproduces any frame. Rates that change with the
game (the school's pace, the flora's sway) are integrated on the CPU, never written as
`clock × rate`.

## Tiers

Every tier keeps the whole picture and every event. From Minimal to Extreme: the light pattern
256–768 texels, the seabed grid 0.42–1.3 of full, 3–6 wave trains, 30–140 % of the reef's
colonies, 8–38 kelp stands with 16–44 blades each, 260–3,000 tufts of grass, 380–4,400 fish in
the school, 50–380 reef fish, 0–14 jellies, 260–2,800 motes, a pool of 256–1,600 event motes. The
post: the shaft march 6–24 steps at a quarter to half resolution on every tier, bloom from
Medium up, MSAA and the chromatic fringe from High up, the animals' shadows in the shafts from
Medium up.

## Verification

- **Playground, WebGPU on the RTX 3070** (`?effect=ocean`, a scratch Electron batch under the
  shared GPU lock): about ninety frames over seven rounds of iteration, the last 28 of them the
  evidence in `ocean-overhaul/` — rest, the board, a lock's light falling and landing, ten locks
  held, a hard drop, a clear and the spawn after it, a t-spin, four lines, the whale, a manta, a
  turtle, a level-up, all six hours, the Low tier, the WebGL2 backend and a 430 × 852 portrait.
  Every console clean (only the harness's own Vite-socket and Electron notices).
- **Real game, WebGPU and WebGL2** (the in-game harness on a private dev server: skip the intro,
  pin the theme, real keyboard hard drops, then line clears, a chain, a LEVEL_UP and four lines
  through the app's own event bus): the theme ran, the locks left 8 held colours, the clears let
  them go, the chain called the turtle, three mantas and the whale, the level turned the light
  from the high sun to the gold, four lines brought the great shaft down (beam 1) with the school
  wound round the board (vortex 0.99). A live change to Medium rebuilt the world in place; leaving
  for Forest left no Ocean canvas. 131 fps at rest and during the quad on WebGPU, 130 on the WebGL2
  backend (High, the RTX, with peer sessions running: an observation, not a measurement). No
  warning or error from the theme (only Chromium's `powerPreference` notice).
- **The light by the clock alone, in the real game**: the in-game harness with `?oceanFixedDt=50`
  (about three seconds of the theme's clock to a wall second), no line clears and no level-ups,
  the world sampled every ~16 wall seconds: the HUD shows level 1 throughout, and the place on the
  wheel went 0.55, 1.11, 1.66, 2.22, 2.77, 3.32 — gold, gold, fire, fire, blue, blue. (The idle
  game topped out after about 80 s, so the last two frames show the game-over card over the blue
  hour.) A level-up adds an hour on top of that.

![The light moving on by the clock alone, level 1 throughout](ocean-overhaul/ingame-clock-only.webp)
- **Lifecycle**: `node scripts/validate-all-themes.mjs --theme ocean` — PASS (0 lifecycle
  failures, 0 console errors, 0 process failures).
- **Unit tests** (new): `ocean-theme` (62, the adapter's contract), `ocean-director` (26),
  `ocean-composition` (12), `ocean-core` (18), `ocean-hours` (9), `ocean-plan` (12, the plan and
  the tiers), `ocean-meshes` (27, every grown mesh's winding, normals and triangle budget),
  `ocean-world` (18, the real world built in Node and driven through the theme's calls),
  `ocean-playground` (8). They found four real faults that no screenshot showed: the held-colour
  list could outgrow its uniform table under rapid locks (a crash on the next frame), the turtle,
  the mantas and the far whale popped into view at the ends of their passes, the school's loop
  dipped into the reef shoulder, and a far pinnacle stood up through the surface.
- **Static gates**: `lint:ci` (616 errors against a baseline of 807 — the old Ocean took 191
  pre-existing ones with it; the baseline is left as it is), `typecheck`.

![In the real game](ocean-overhaul/ingame.webp)

### Not verified, and what is open

- Nobody has watched it move: the pace of the school, the kelp, the currents and the passes are
  judged from stills, numbers and tests only.
- No perf-lane (ADR-0016) reading; nothing on an integrated GPU or a phone beyond the playground
  portrait frame. First-activation pipeline compile time not measured.
- The icon is my pick, not reviewed: the hero coral garden on the right shoulder (a pink anemone over
  branching coral), chosen from eight candidates at the picker's 80 px beside its neighbours
  (`?effect=ocean&t=20&quality=Extreme&hour=0.6&icon=1&iconFov=26&iconYaw=-0.62&iconPitch=-0.38`,
  840 px square, baked to the 512 px circle with saturation 1.35 and contrast 1.15). Both copies
  (`src/themes/ocean/` and `public/assets/themes/`) were replaced.

![The icon at picker size, beside its neighbours](ocean-overhaul/icon-at-picker-size.png)
- The six hours' palettes, the hour's length (100 s) and the size of the event effects are my
  choices.
- Blender was not used: every mesh is grown in code, so nothing could be authored there that the
  code does not already make, and the live Blender session belongs to whoever has it open.

## Reproduce

Playground: `npm run dev:playground`, then
`/playground.html?effect=ocean&t=20&quality=High&board=1` plus
`event=lock|drop|clear|quad|tspin|perfect|levelUp|break`, `eventAge=<s>`, `lines=`, `row=`, `u=`,
`color=<hex>`, `combo=<n>`, `locks=<n>`, `pass=turtle|manta|whale|whaleFar&passAge=<s>`,
`hour=<place>` (0 high sun … 5 first light), `level=<n>`, `shafts=0`, `noPost=1`,
`parts=surface,seabed,...`, `icon=1` (+ `iconFov`, `iconYaw`, `iconPitch`, …). Theme flags:
`oceanTime`, `oceanFixedDt`, `oceanParts`, `oceanFalseColor`, `oceanForceWebGL`.
