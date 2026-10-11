# Stellar Drift — the ringed giant

Implemented 2026-10-11 on `feature/stellar-drift-masterpiece`, with Three.js 0.186.1. A
from-scratch rebuild: it replaces the earlier theme in full (the sphere-and-plane scene of
`stellar-drift-atmosphere.js`, `-backdrop.js`, `-planets.js`, its event director
`-reactions.js` and `-event-effects.js`, and the post stack; see
[STELLAR_DRIFT_DEPTH_OVERHAUL_2026-10.md](STELLAR_DRIFT_DEPTH_OVERHAUL_2026-10.md) for what that
was). Stellar Drift keeps its identity — a banded giant with rings on the left of the board,
moons and a teal-and-violet nebula on the right, a camera adrift among ice — and everything else
is new. This document records the shipped design and what was verified. It is a reference, not a
backlog.

## The picture

A ringed giant fills the left of the frame. Its weather runs in bands that shear past one
another, each on its own wind; ovals twist the bands into spirals; a six-sided jet rings its
north pole; and the whole globe turns once in nineteen minutes. Its rings sweep behind the
card: a thin inner veil, a broad bright ring grooved like a record, a dark division, an outer
ring with two clean gaps and a strand of dust outside it. The rings throw their shadow on the
cloud tops below them, gap for gap, and the giant throws its own shadow across the rings
behind it. Its night side is not black: the rings light it, its air glows along the limb,
lightning flickers under its cloud and an aurora stands on its pole.

Two moons hang far off on the other side of the card, one of ice that vents a fan of fine jets
into the dark, one of rust, in front of a nebula. The camera drifts in the thin haze of ice
beyond the rings: a few slow lumps near the lens, shards between them and the giant, and
thousands of motes that flash as a facet finds the sun. The pointer leans the view, so the near
ice slides across the giant.

On an upright phone the giant rises into the sky above the card.

## The one idea

The board plays on the giant. The rings are its instrument: every lock lands in them as light
in the piece's own colour, and every clear rings them from the inside out. The cloud is its
page: a cleared row is written round the globe on its own latitude. The aurora is the chain.

## Event language

| Event | What happens |
| --- | --- |
| Lock | A mote of the piece's colour leaves the card on an arc and falls into the rings 0.42 s later: a flash, a splash of lit ice thrown up and carried round, and a ring of light that runs out from where it landed and is wound into a spiral by the rings' own shear. It leaves a stain of that colour in the ice, drawn out into an arc, for about a quarter of a minute. The piece's column chooses where along the visible arc of the rings it lands (left to right as on the board), its row how far out. |
| Hard drop | The same, landing harder: a brighter mote, a stronger ripple, twice the ice. |
| Clear (1–3) | The rings chime: light runs out through the whole system, one front per line, in the colour of the piece that made the clear. Every cleared row is written round the giant as a streak of light on its own latitude, starting at the limb that faces the card. Lightning answers under the night side's cloud and the aurora flares. Three lines bring a meteor. |
| Combo | The aurora is the chain. Each step raises its curtains; from about four a second oval lights inside the first; lightning walks the night side; the rings hum in the chain's colour in slow swells; and from the third step meteors begin to fall, more with every two steps. When the chain breaks the aurora sinks back over a few seconds. |
| Four lines | A storm of seven meteors burns into the cloud tops (each a fireball, lit cloud round it, and a bruise that lingers a quarter of a minute), the icy moon vents a great fan of ice, and the rings ring four times over. |
| T-spin | A two-armed spiral of light winds round through the rings. |
| Perfect clear | As four lines. |
| Level up | The hour turns: the picture moves one palette round its wheel, and the rings ring it in in the star's own light. |
| Time | By itself, with no level change, the picture drifts round the same wheel: one palette every 90 seconds. |
| Game over, new run | Everything in flight is dropped; the giant keeps turning and the hour keeps its place. |

### The hours

Six palettes on a wheel, each a neighbour in hue of the one before: **amber** (the home
palette: cream zones, rust belts, a teal and violet nebula), **rose**, **orchid**, **azure**,
**jade**, **gold**, and back to amber. A palette is a different giant, different rings, moons,
nebula, aurora and star.

The place on the wheel is `clock / 90 s + (level − 1)`: the clock alone carries the picture one
palette on every 90 seconds, whatever the level, and a level-up is one more step on top of
wherever the clock has brought it (eased over a few seconds, never a jump). The picture rests on
a palette for 15 % of a step at each end and is on its way for the other 70 %. The giant's bands
do not cross-fade: each band takes the next palette at its own moment, so a turn of the hour
crosses the globe like weather. The sun moves with the wheel: at amber it stands behind the
camera's left shoulder (most of the disc lit), at azure it has swung round toward the far side
(a crescent, the night side and its lightning facing the card).

The theme's clock survives a rebuild in place (a quality change while playing, a GPU recovery),
so the drift does not snap back; it is cleared when the theme is stopped.

## How it is built

Everything is measured in radii of the giant, and the world's frame is the giant's: its centre
is the origin, its axis and the rings' normal are +Y.

**One full-screen pass** (`stellar-drift-space.js`) traces every pixel's view ray against the
giant (a unit sphere), the ring plane, the two moons and the sky, and composites along the ray:
sky and moons, the rings' far side, the giant and its limb haze, the aurora, the rings' near
side. That is what makes the picture hold together:

- The rings are a slab of ice with an optical depth, read from one radial profile baked on the
  CPU (2,048 texels, a CPU-averaged mip chain, chosen per pixel from its footprint). How bright
  they are follows single scattering in a slab from the sun's and the eye's slant; ice shines
  back toward the light, dust throws it forward; thin parts let the giant and the stars through.
- The rings' shadow on the cloud tops reads the same profile at the radius where the surface
  point's sun ray crosses the plane, so every gap is a line of light in the shadow. The giant's
  shadow on the rings is a ray–sphere test with a penumbra that widens with distance and a last
  ember of sunset light along its edge.
- Every edge is anti-aliased from its own distance in pixels (the limb from the ray's closest
  approach, the moons the same way, the rings by their mip), on both backends, with no
  multisampling.
- The cloud is not a picture. Latitude chooses a band's colour from a table (512 latitudes, one
  row per palette); the baked fBm texture, read along each band's own wind in two reads half a
  cycle apart and cross-faded (so the shear never winds up), bends that latitude and tears the
  bands' edges into festoons; eight ovals twist the lookup into spirals; and the globe turns
  under it. Sunlight is a soft terminator that warms toward dusk, a limb that darkens, a veil of
  air toward the limb; the night side keeps the rings' light, the sky's and its own airglow.
- The aurora is geometry, not a glow: each oval is a cone from the giant's centre, the ray's
  two crossings of it are solved in closed form, and where a crossing lies in the thin shell
  above the cloud tops there is a curtain, brighter the more nearly the ray runs along it. So
  the near half of an oval stands in front of the disc, the far half rises behind the limb, and
  its two ends blaze.
- The sky is a nebula laid out on the resting camera's own sheet (so it is composed for the
  frame and still stays at infinity when the camera leans), three lattices of far stars that
  are never smaller than a pixel, and the moons, shaded per pixel from a one-fetch 3D lattice
  noise.

**What the board does** arrives in that pass as rows of one uniform table (`EVENT_ROWS`): up to
16 ripples, 4 chimes, 8 jets, 8 strikes and 10 lightning cells, live rows compacted to the front
and looped by count, so an idle pool costs nothing. The world owns five small fixed pools
(`stellar-drift-pool.js`); nothing is allocated or created at event time.

**Geometry on top** (`stellar-drift-fx.js`): the ice (two classes of instanced lumps cut from
icospheres by random planes, lit as ice, and a pool of motes), the sparks a landing throws up
(written at event time, moved by a closed form in the vertex stage), and one pool of ribbons for
both the lock's mote (an arc) and the meteors (straight, white-hot at the head).

**The post** (`stellar-drift-post.js`): one scene pass with a single output, a bloom chain with
a hue-preserving knee on the largest channel (Medium and up), and one output pass: a lens fringe
that widens on an impact, calm zones over the card and the HUD, a hue-preserving filmic curve,
a cool lift in the shadows, vignette, grain and dither.

**The world** (`stellar-drift-world.js`) owns the uniforms, the camera rig (the camera is stood
where the composition asks for the giant: its centre on an anchor, its size, its lean, for any
aspect) and the choreography. Everything is a function of the world clock and event timestamps,
so `seek(t)` plus a fixed-step replay reproduces any frame. `stellar-drift-core.js` and
`stellar-drift-bake.js` are three-free and hold the maths and the bakes the tests read.

Nothing is downloaded: no texture and no model file. Blender was not needed: a giant, its rings
and its moons are spheres, a plane and light; the only meshes are lumps of ice, which are
icospheres cut by a handful of planes in code.

## Tiers

Every tier keeps the whole picture and every event.

| Tier | Cloud reads | Ovals | fBm | Ring profile | Aurora ovals | Ice (lumps, shards, motes) | Bloom / MSAA |
| --- | --- | ---: | --- | ---: | ---: | --- | --- |
| Minimal | one, no fine field | 3 | 256², 5 octaves | 1,024 | 1 | 2 / 24 / 400 | off / 0 |
| Low | two cross-faded | 4 | 256², 5 octaves | 1,024 | 1 | 3 / 40 / 700 | off / 0 |
| Medium | two + fine field | 6 | 512², 6 octaves | 2,048 | 2 | 4 / 70 / 1,300 | on / 0 |
| High | two + fine field | 8 | 512², 6 octaves | 2,048 | 2 | 6 / 110 / 2,200 | on / 4 |
| Ultra | two + fine field | 8 | 512², 6 octaves | 2,048 | 2 | 8 / 150 / 3,200 | on / 4 |
| Extreme | two + fine field | 8 | 512², 6 octaves | 2,048 | 2 | 10 / 200 / 4,600 | on / 4 |

## Verification

Everything below was run on 2026-10-11 on the development laptop (RTX 3070 "nvidia ampere",
Windows 11), while several other sessions shared the machine and its GPU.

**Unit tests.** 141 tests in five new files (`tests/unit/stellar-drift-plan.test.js`,
`-world`, `-theme`, `-director`, `-composition`), replacing the five files of the old
implementation. They pin, among other things: the wheel (six palettes; with no level change the
picture has moved within a minute and stands on the next palette one step later; a level-up
adds exactly one step; it is on its way for 70 % of a step; no neighbouring pair of palettes
mixes to grey half-way, a check that caught one pair and changed a colour), the sun (always
over the rings and on the giant's left), the bakes (deterministic; the rings' parts, their two
gaps, the mip chain), the composition for aspects from 0.45 to 3.5, event pools that never
exceed their slots under 500 locks and 200 clears, that a seek plus the same replay gives the
same frame twice, and that the theme's clock survives a rebuild in place.

**Whole suite, on the final tree:** 809 of 811 files, 14,906 tests passed (the same result as
a first full run earlier in the day). The two failing files are not this change's:
`odyssey-level-briefing` expects "250,000" and this machine's Swedish locale prints "250 000",
and `tts-recorder-e2e` cannot create a symlink on this Windows account (`EPERM`).

**Static gates, on the final tree, all green:** lint ratchet (646 errors against a baseline of
807; the new files have none), typecheck, import boundaries, architecture fitness, the
TypeScript ratchet, the theme lifecycle audit, the perf-budget gate, the production build with
its boot-closure guard, and the IP-string, Pages-artifact and release gates. Lint and fitness
baselines were left alone (both shrank).

**Playground, WebGPU on the RTX:** 38 frames in two batches, every one with a clean console:
rest, a lock's mote and ripple, ten locks' stains, a three-line clear, four lines, a chain of
nine, a T-spin, a level-up, all six palettes, Ultra, Low and Minimal, the WebGL2 backend, an
upright phone (430 × 850), a 21:9 screen and reduced motion. Medium and Extreme were not
captured in the playground (Medium ran in the game, below; both build and take gameplay in the
unit tests).

**Playground, WebGL2 on the software renderer:** the look was built there first (about sixty
frames), and it matches the GPU's.

**The real game:**
- on the WebGL2 backend (software renderer, about 1.6 frames a second): boot, the theme pinned,
  real hard drops from the keyboard, clears and a chain through the app's own event bus, four
  lines, a broken chain, a level-up, a live change of quality to Medium (the level and the
  clock were taken up again: the picture stood on rose, place 1.05, as before the rebuild),
  then leaving the theme (its canvas gone, the next theme running). No console line from the
  theme.
- on WebGPU on the RTX at High: the same script. About 132 frames a second at rest and 131
  during the four-line storm (one reading each, 1584 × 813, pixel ratio 1; it is the display's
  cap or close to it, so it says "not a problem here", not how much room is left). The game
  ended in the middle of the script, so the new-run reset was exercised too. Console: the two
  "Scene ready" lines and nothing else.
- the repo's own lifecycle validator (`scripts/validate-all-themes.mjs --theme stellar-drift`, a fresh Electron against a preview of the production build): 107 of 107 checks pass, with no console errors.

**Phones.** `scripts/validate-mobile-webgl2.mjs` (a phone-sized software WebGL2 context)
passes at Low and at Minimal, and its screenshots show the whole picture and its events with no
black or blown-out regions. No physical phone was tried.

**Not done:** no perf-lane (ADR-0016) reading and no integrated-GPU reading; multiplayer,
Infinity and Odyssey layouts were not captured; `docs/theme-screenshots/stellar-drift.png`
still shows the old artwork; nobody but the author has watched it in motion.

## Reproduce

`npm run dev:playground`, then
`/playground.html?effect=stellar-drift&t=20&quality=High&board=1&orbit=0&hud=0` plus:

- `event=lock|drop|clear|quad|tspin|perfect|levelUp`, `eventAge=<s>` (and `lines=`, `row=`,
  `u=`, `color=<hex>`), `locks=<n>` (locks played before the moment shown), `combo=<n>` (a held
  chain);
- `level=<n>` rests on that level's palette when `t` is inside the rest (`t=14`); later `t`
  values show the clock's drift on the same level (`level=1&t=50` is half-way from amber to
  rose, `t=100` is rose, `t=190` orchid, `t=280` azure, `t=370` jade, `t=460` gold);
- `parts=space,ice,sparks,meteors`, `noPost=1`, `falseColor=1`, `bloom=0|1`, `msaa=<n>`,
  `px=`/`py=` (a held pointer lean), `reduce=1`, `forceWebGL=1`, `demo=1` (live: a looping
  script of play);
- `icon=1&iconFov=31` turns the lens to the giant (the icon is the centre square of
  `t=20&quality=Ultra&icon=1&iconFov=36&iconYaw=-0.05&combo=7&locks=8`).

In the game: `?stellarDriftTime=<s>`, `?stellarDriftFixedDt=<ms>`, `?stellarDriftParts=a,b`,
`?stellarDriftFalseColor=1`, `?stellarDriftForceWebGL`.

## Captured previews

In [stellar-drift-captures/](stellar-drift-captures/):

- `desktop-rest.jpg` — the giant at rest, with the mock board (WebGPU, High).
- `desktop-events.jpg` — a hard drop's mote, ten locks' stains, a three-line clear, four
  lines, a chain of nine, a T-spin, a level-up, and the azure hour with a chain (WebGPU, High).
- `clock-drift.jpg` — the clock alone: level 1 in every frame, at 10, 50, 100, 190, 280, 370,
  460 and 545 seconds (amber, half-way to rose, rose, orchid, azure, jade, gold, amber again).
- `desktop-ingame.jpg` — the real game on the RTX: rest, hard drops, their stains, a clear, a
  chain, four lines, and the end of the run.
- `tiers.jpg` — Minimal and Low (WebGL2), High on the WebGL2 backend, Ultra, 21:9, reduced
  motion.
- `portrait.jpg` — an upright phone.
- `icon-sheet.jpg` — the four icon candidates; the first (the giant with its aurora, the
  whole ring in the circle) is the one shipped.
