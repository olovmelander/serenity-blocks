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
behind it. Its night side is not black: the rings light it, its air glows along the limb and
lightning flickers under its cloud. (Its poles carried an aurora until 2026-10-21; it was
removed at the owner's request. See "Event pass" below.)

Two moons hang far off on the other side of the card, one of ice that vents a fan of fine jets
into the dark, one of rust, in front of a nebula. The camera drifts in the thin haze of ice
beyond the rings: a few slow lumps near the lens, shards between them and the giant, and
thousands of motes that flash as a facet finds the sun. The pointer leans the view, so the near
ice slides across the giant.

On an upright phone the giant rises into the sky above the card.

## The one idea

The board plays on the giant. The rings are its instrument: every lock lands in them as light
in the piece's own colour, and every clear rings them from the inside out. The cloud is its
page: a cleared row is written round the globe on its own latitude, and the larger rewards are
weather on it. The rings are the chain.

## Event language

As rebuilt on 2026-10-21 (see "Event pass" below).

| Event | What happens |
| --- | --- |
| Lock | A comet of the piece's colour (a white-hot head with a lens's faint four-point spikes, its trail cooling into a short train) leaves the card on an arc and falls into the rings 0.42 s later: a white-hot impact, the ringlet it lands on lit along its orbit both ways (an arc that lies along the rings' grain, never a hoop across it), a splash of ice chips that streak as they fly, and a density wave that brightens and thins the rings themselves as it runs out, wound into a spiral by their shear. It leaves a stain of that colour in the ice, drawn out into an arc, for about a quarter of a minute. The piece's column chooses where along the visible arc of the rings it lands (left to right as on the board), its row how far out. |
| Hard drop | The same, landing harder: a brighter comet, a stronger wave, twice the ice. |
| Clear (1–3) | The rings chime: a front per line runs out through the whole system, lighting it ringlet by ringlet with a white leading edge, in the colour of the piece that made the clear. Every cleared row is written round the giant as a hairline of light with a white-hot head, racing from the limb that faces the card along its latitude, hugging the band's festoons, lit through the cloud's own relief and cooling from its far end. Lightning answers under the night side's cloud: a flash that lights the cloud from below with the branching channels in its heart. Three lines bring a meteor. |
| Combo | The rings are the chain. Each step raises their hum in the chain's colour (slow swells, and their spokes stand out); lightning walks the night side; from the third step meteors begin to fall, more with every two steps. At 3 and 5 two arcs of the chain's light race apart round the rings from the side that faces the camera; at 8 the chain is crowned: the arcs again, the rings' hum and spokes stronger for a while, and a corona of light leaves the giant. When the chain breaks the hum sinks back over a few seconds. |
| Four lines | A storm of seven bolides strikes the cloud tops, modelled on the comet that hit Jupiter in 1994: a blinding fireball, a broad shock that runs out through the cloud and lights its thick parts, heat cooling from white through the piece's colour to embers, then a dark scar with a crescent of ejecta thrown downrange, which the band's own wind shears as it lingers for a quarter of a minute. A corona of light leaves the giant, the icy moon vents a great fan of ice, and the rings ring four times over. |
| T-spin | A cyclone is spun into the cloud where the giant faces the camera in daylight: the bands wind into a tightening spiral for a few seconds and then let go, two arms of the piece's colour wound with them; a two-armed spiral of light winds round through the rings, tightening as it turns. A zero-line spin does the same, more gently. |
| Back-to-back | A beat after the clear, the rings' outer strand blazes: two threads braided round each other, with knots of light running along them. |
| Perfect clear | The whole answer in gold: the arcs round the rings, the crown, a gold corona, the strand ablaze, the moon's vent (with four lines' storm if it was four lines). |
| Level up | The hour turns: the picture moves one palette round its wheel, the rings ring it in in the star's own light, and a soft corona of starlight leaves the giant. |
| Time | By itself, with no level change, the picture drifts round the same wheel: one palette every 90 seconds. |
| Game over, new run | Everything in flight is dropped; the giant keeps turning and the hour keeps its place. |

### The hours

Six palettes on a wheel, each a neighbour in hue of the one before: **amber** (the home
palette: cream zones, rust belts, a teal and violet nebula), **rose**, **orchid**, **azure**,
**jade**, **gold**, and back to amber. A palette is a different giant, different rings, moons,
nebula and star.

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
sky and moons, the rings' far side, the giant and its limb haze, the rings' near side, and the
corona a large reward throws off. That is what makes the picture hold together:

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
- The sky is a nebula laid out on the resting camera's own sheet (so it is composed for the
  frame and still stays at infinity when the camera leans), three lattices of far stars that
  are never smaller than a pixel, and the moons, shaded per pixel from a one-fetch 3D lattice
  noise.

**What the board does** arrives in that pass as rows of one uniform table (`EVENT_ROWS`): up to
16 ripples, 4 chimes, 8 jets, 8 strikes and 10 lightning cells, live rows compacted to the front
and looped by count, so an idle pool costs nothing. The world owns five small fixed pools
(`stellar-drift-pool.js`); nothing is allocated or created at event time. The larger rewards'
flourishes (a cyclone, a surge round the rings, the outer strand ablaze, a corona) are one of
each at a time, uniforms of their own, each read inside a branch that only runs while it lives.

**Geometry on top** (`stellar-drift-fx.js`): the ice (two classes of instanced lumps cut from
icospheres by random planes, lit as ice, and a pool of motes), the sparks a landing throws up
(written at event time, moved by a closed form in the vertex stage, streaking along their own
motion), and one pool of flights for both the lock's comet (an arc) and the meteors (straight),
drawn twice from one uniform table: a ribbon of trail and train, and a head.

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

| Tier | Cloud reads | Ovals | fBm | Ring profile | Lightning channels | Ice (lumps, shards, motes) | Bloom / MSAA |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| Minimal | one, no fine field | 3 | 256², 5 octaves | 1,024 | glow only | 2 / 24 / 400 | off / 0 |
| Low | two cross-faded | 4 | 256², 5 octaves | 1,024 | glow only | 3 / 40 / 700 | off / 0 |
| Medium | two + fine field | 6 | 512², 6 octaves | 2,048 | yes | 4 / 70 / 1,300 | on / 0 |
| High | two + fine field | 8 | 512², 6 octaves | 2,048 | yes | 6 / 110 / 2,200 | on / 4 |
| Ultra | two + fine field | 8 | 512², 6 octaves | 2,048 | yes | 8 / 150 / 3,200 | on / 4 |
| Extreme | two + fine field | 8 | 512², 6 octaves | 2,048 | yes | 10 / 200 / 4,600 | on / 4 |

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

- `event=lock|drop|clear|quad|tspin|perfect|b2b|cascade|levelUp`, `eventAge=<s>` (and `lines=`,
  `row=`, `u=`, `color=<hex>`, `cascade=<depth>`), `locks=<n>` (locks played before the moment
  shown), `combo=<n>` (the held chain and the clear's combo); `event=tspin&lines=0` previews a
  spin without a line clear;
- `level=<n>` rests on that level's palette when `t` is inside the rest (`t=14`); later `t`
  values show the clock's drift on the same level (`level=1&t=50` is half-way from amber to
  rose, `t=100` is rose, `t=190` orchid, `t=280` azure, `t=370` jade, `t=460` gold);
- `parts=space,ice,sparks,meteors,heads`, `noPost=1`, `falseColor=1`, `bloom=0|1`, `msaa=<n>`,
  `px=`/`py=` (a held pointer lean), `reduce=1`, `forceWebGL=1`, `demo=1` (live: a looping
  script of play);
- `icon=1&iconFov=31` turns the lens to the giant (the icon is baked from a 1080² frame of
  `t=20&quality=Ultra&icon=1&iconFov=42&iconYaw=-0.05&combo=7&locks=8`, a square of 0.86 of its
  height centred at (0.435, 0.5), circle-clipped to 512 px; re-baked 2026-10-21 without the aurora).

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
- `icon-sheet.jpg` — the four icon candidates of 2026-10-11 (the first shipped then; the icon
  was re-baked without the aurora on 2026-10-21).
- `events-2026-10-21/desktop-events.jpg` — the event pass below, WebGPU High, 1600 × 900, with
  the mock board: a lock's comet, a hard drop's arc in the ringlet, a three-line clear, four
  lines (bolides and the corona, the impacts, the scars seven seconds on), a T-spin's cyclone,
  a back-to-back strand, a chain of three's surge, a chain of eight's crown, a perfect clear and
  a level-up; and three of them at full size.

## Event pass (2026-10-21)

The owner found the event effects badly implemented, and asked for them redone as the
picture's best work. What was wrong, seen in captures of the shipped theme:

- the rewards of 2026-10-11 (combo milestones, T-spin, back-to-back, perfect clear) were strands
  laid out in the camera's own plane round the giant: flat wireframe ellipses and a wobbling
  scalloped hoop that belonged to no part of the scene;
- meteors were uniform ribbons from far off screen (laser lines), and their strikes flat white
  discs on the cloud;
- a cleared row was a broad, smooth smear of the piece's colour (two halos merging);
- a lock's ripple was a crisp hoop of colour that cut across the ringlets like a decal, and its
  mote a hairline;
- lightning was a round glow.

During the pass the owner also asked for the aurora (the green and violet curtains on the
giant's poles) to go. It is removed outright: the curtains, their foot on the cloud tops, the
second oval, its palette colours (`auroraLow`, `auroraHigh`), its tier setting and its uniform.
The chain it carried now lives in the rings (their hum, spokes and surges).

What replaced them is in the event table above. How each is built:

- **Flights** (`createMeteors`, `createHeads`): one uniform table drawn twice. The ribbon's rows
  crowd toward the head and its colour and width are a function of the time since the head
  passed each point: white-hot and narrow for a twentieth of a second, the piece's colour, then
  a short train that widens as it cools; a meteor's breaks into pieces along its path. The head is
  a camera-facing quad (core, inner glow, halo and a lens's four spikes) that flickers on a
  meteor and swells as it meets the giant's air. Both hide behind the giant analytically. Sizes
  are authored in pixels of a 1080-line frame and floored at a buffer pixel. Meteors now start
  1.5 to 2.6 radii out (from 2.8 to 4.6), so they streak past the giant, not across the sky.
- **Ring impacts**: the ripple is a density wave that scales the rings' own light (crest up,
  trough down, through `crowd`), with colour only on its first crest; the light that runs both
  ways along the ringlet the lock landed on (in the shear-unwound frame, so the orbit carries it)
  is the hero shape, because an arc along the rings' grain reads as part of them and a circle
  across it does not. Chimes light the rings groove by groove (`grooves` = the profile's ringlet
  channel squared) with a white leading edge.
- **Strikes** follow the Shoemaker–Levy 9 impacts on Jupiter: fireball, one broad shock lit only
  where the cloud is thick (relief squared), heat cooling through the piece's colour to embers,
  then a dark heart and a crescent of ejecta downrange (the meteor's bearing across the cloud is
  packed into the strike's second row in place of its size, which is now `strikeSize(strength)`).
  The scar drifts on its own band's wind, four times the cloud's, so latitudes through it
  shear.
- **Rows**: a hairline never under a pixel and a half on the cloud, with a hot head, hugging the
  band's festoons, its trail broken into brighter and fainter pieces by the cloud's own noise
  channels (no extra fetch).
- **Lightning**: a flash that lights the cloud from below, and on Medium and up the branching
  channels, where a fine field crosses its middle (`(1 − |2n − 1|)¹⁴`), read only within four
  radii of the cell.
- **Cyclone** (T-spin): one more twist of the cloud lookup, after the ovals, tightening for three
  seconds and letting go; its arms are where `atan(dy, dx) + twist` is constant, so they follow
  the cloud's own spiral. Its pull is tapered to nothing before the edge of its test (a hard cut
  left a step in a band).
- **Surge** (milestones): two arcs racing apart round the rings from the camera's bearing, laid
  out on the CPU (how far round, how strong), lighting the grooves.
- **Strand** (back-to-back): two threads braided round the outer strand with knots running along
  them, added after the rings' roll-off so they burn in the strand's own gaps.
- **Corona** (four lines, the crown, a perfect clear, a level-up): a shell of plasma with a
  Gaussian profile seen through in closed form: inside its radius `√(2Rw / (R² − d² + 2Rw))`,
  outside `exp(−((d − R)/3w)²)`, so it is brightest just off the limb with no hard line at either
  edge (the run-length form from Supernova drew a glass bubble here), torn into radial filaments
  by ridged 3D noise, and over the disc only 15 % of it shows. It stays within 1.6 radii: the
  giant is so large on screen that a shell further out crosses the card as another planet's
  outline. Its front runs on through the ring plane on its own radius and lights the rings.

**Cost.** Every new term is behind a branch that only runs near its event (strikes within six
of their sizes, rows within 0.12 rad of their latitude, lightning within eight radii and its
channels within four, the corona's noise only where it shows), and the flourishes only while
they live. GPU time per frame, medians of 25 seek-rendered frames, interleaved with origin/main
served from a second checkout, two rounds, at Low on the integrated AMD Radeon 610M (RDNA 2),
1600 × 900 (other sessions were using the machine; differences under about 5 ms are noise):

| Moment | Before (ms) | After (ms) |
| --- | --- | --- |
| Rest | 29.8, 40.2 | 37.4, 41.2 |
| Four lines, 1 s in | 38.5, 43.6 | 38.4, 43.1 |
| Perfect clear, 0.8 s in | 35.5, 42.5 | 42.5, 38.7 |
| T-spin, 1.5 s in | 39.1, 40.3 | 34.3, 35.4 |

A first version without the gates cost 5 to 11 ms more than before during events on that GPU
(ten lightning cells each fetching noise on every pixel of the giant); the gates removed it. On
the RTX 5080 at 2560 × 1440 every moment measured 0.6 to 2.4 ms.

**Verification.** Playground captures on WebGPU (RTX 5080) of every event at several ages, at
High, Ultra, Low and Minimal, on the WebGL2 backend, on an upright phone (430 × 850) and with
reduced motion; no console error in any. A new shader gate (`tests/unit/stellar-drift-shaders.test.js`)
builds every material through the WGSL and GLSL builders at High and Low and fails on a warning,
a NaN or a stringified node, equal smoothstep edges, an undeclared binding or a WGSL var read
before any assignment has certainly run. The world, plan and fx tests were rewritten for the
flourishes and the chain in the rings. The real game in Electron (WebGPU, High, 1600 × 900): the
theme pinned, a single game started, hard drops from the keyboard, then four lines and a
back-to-back T-spin driven through the live world: the comet, the corona, the rows and the
cyclone drew as in the playground, with no console error.

**Not done:** no physical phone; `docs/theme-screenshots/stellar-drift.png` was not refreshed.

