# Sunset — the lantern sea

Implemented 2026-10-11 on `feature/sunset-masterpiece`, with Three.js 0.186.1. A from-scratch
rebuild: it replaces the earlier theme in full (a classic `WebGLRenderer` scene with an
EffectComposer, a GLSL sky dome, a sprite-glow sun and moon, god-ray and shockwave planes, a
35 000-point starfield and a mirror-camera ocean adapted from `Water.js`, reading
`textures/water-normal.jpg` and `textures/2k_moon.jpg`). Sunset keeps its identity — the sun
going down into an open sea, its road of light, a day that turns into night and back — and
everything else is new. This document records the shipped design and what was verified. It is
a reference, not a backlog. On 2026-10-12 the six-hour wheel became the whole day: sunrise,
sunset, moonrise and moonset in the picture, every hour between, and a new sun and moon (see
"The day").

## The picture

An open sea seen from a little above the water, and the whole day turning over it. The sun
comes down the sky on the left of the card and sets into the sea there, its road of light
running from the horizon to the foot of the frame, broken into sparks near the eye and widening
into a shimmering band toward the horizon. A deck of cloud runs in over the eye toward the
place it goes down; as it sets the deck is lit from beneath, gold near the sun and rose away
from it, while low cloud toward the light stands dark against it with a burning edge. High
cirrus streams toward the sunset point like rays. As the sun sets the moon comes up on the
right; it rides over the picture through the night with the stars and the Milky Way wheeling
behind it, lays a silver road of its own, and goes down on the left just before the sun comes
up out of the sea on the right.

The card sits in the middle of the frame, so the picture is composed round it: the world reads
the live card and stats rects and puts the place the sky goes down in the middle of the margin
left of the card and the place it comes up in the free strip right of the card and the stats
bar. The horizon
stands low (61 % down a wide frame, the middle of a tall one), so the sky is most of the
picture.

## The one idea

**The board fills the sea with lanterns, and every clear sets some of them free.** A locked
piece sends a light of its own colour from the card's edge down to the water beside the card,
where it becomes a paper lantern afloat in that colour, riding the swell on a streak of its own
reflected light. A clear lifts the oldest of them off the water, and the evening wind carries
them away toward the place the sun goes down, climbing, until they are sparks over the horizon.
Over a game the sea fills with lights and the sky over the sunset fills with rising lanterns.

## Event language

| Play | The sea |
| --- | --- |
| Lock | A light in the piece's colour leaves the card's edge at the piece's height and arcs down to the sea beside the card, on the side its column is nearer (a piece low on the stack lands near the eye, one high up lands far out toward the horizon; the stats bar is kept clear). Where it lands a paper lantern of that colour lights with a flare and a ring runs out from it. The water mirrors it on a streak of its own light and is lit round it. |
| Hard drop | The same, set down hard: a splash of drops in the lantern's light, a wider, brighter ring. |
| Clear | For every line the oldest lantern on the water flares and lifts off, leaving a ring; the wind takes it toward the sunset. A chain lifts more at once. A halo blooms round the sun (round the moon at night): it runs out from the disc to 22° in a second, prismatic, red on its inner edge, holds, and fades; the sun's aureole flares and its road on the sea flares with it. |
| T-spin | The lanterns that lift go up turning round where they rose before the wind takes them. |
| Four lines, perfect clear | Every lantern on the water lifts at once, the sky is set on fire, and if the sun is low the last of its upper limb burns green for a breath (the green flash). A perfect clear also calls the whole flock. |
| Chain of clears | The sky catches fire: the cloud burns brighter and further from the sun with every clear held, the sun's road with it; from three clears a skein of gulls crosses in front of the sun (the moon at night), from five a great one. It cools slowly when the chain breaks. |
| Too many afloat | The water holds about half the pool; past that the oldest lantern sets out by itself, so the sky always has some in it. |
| Level up | The day runs on an eighth of itself (70.6 s of its timetable), eased over 3.6 s: the sun, the moon and the stars are seen to run across the sky. Two levels at once go twice as far, from where the last turn was headed; nothing turns the day back. |
| The clock, with no play at all | **The day turns by itself, slowly, whatever the level**: one whole day in 565 s, never standing still. A level-up is added on top of where the clock has carried the day (`wheel = clock + LEVEL_SECONDS × levels gained`), so the light never waits for a level. |
| New run | The lanterns go and the chain cools; the day goes on from where it was (the level is 1 again, the light does not move). A rebuild in place (a quality change, a lost device) hands the clock, the level and the day over whole. |

## The day

`sunset-hours.js` is the whole twenty-four hours. **Where the bodies run:** the sun comes up out
of the sea in the strip right of the card at 06:00, climbs (straight up at first, then leaning
left), leaves the top of the picture at about 08:30, stands 52° up over the picture at noon,
comes back in at the top left at about 15:30 and goes down into the sea in the margin left of
the card at 18:00. Under the sea it runs back from left to right. The moon keeps the same road
172° of the sky's turn behind the sun and lower (40° at its highest): it comes up on the right at
17:28 (so it stands over the sea on the right while the sun sets on the left), leaves the top of
the picture at about 21:30, comes back in at the top left at about 02:00 and goes down on the
left at 05:28, half an hour before the sun comes up on the right. A unit test walks the whole day
on the solo layout and checks that whenever the sun or the moon is in the picture it is clear of
the card and the stats bar. The stars turn about a pole behind the eye, 35° up, so in front of
the eye they come up on the right and go down on the left as the sun and the moon do; the Milky
Way is fixed to the same sky and stands across the picture at midnight.

**The light:** eleven stations name the day: midnight, before dawn (04:42), dawn (05:27, the moon
setting into the pink belt), sunrise (06:03), morning (08:00), noon, afternoon (15:00), golden
hour (17:00), sunset (18:00), afterglow (18:24) and dusk (19:18, the moon climbing on the right).
Between two of them the light is always on its way (half linear, half eased: it never stands
still), and no two neighbours mix through grey (a unit test walks the horizon, toward the sun and
away from it, every three minutes of the day). The sun's and the moon's own colours are not
authored: they come from the air they are seen through (Kasten–Young air mass, per-channel
extinction), so either one whitens as it climbs and reddens to a coal as it nears the sea,
wherever it is. The same air gives their roads on the sea (deeper again, seen twice through the
air) and the moon's glow; the moon's road and glow fade out by day. How far the stars are out
and which body keys the cloud follow the sun's and the moon's heights.

**The timetable:** a day takes 565 s of the clock and lingers where the light changes most. From
the start: golden hour (16:40) at 0 s, the sun on the water at 70 s, dusk at 140 s, 23:00 at
200 s, 03:00 at 260 s, 05:00 at 305 s, 06:00 at 355 s, 08:00 at 430 s, noon at 480 s, 16:00 at
540 s. The hours run through these knots on a curve that never runs back (monotone cubic,
periodic): the evening from golden hour to dusk and the dawn from the moon setting to the
morning are a quarter of the hours and take nearly half of the clock; at its fastest (round
noon) the day runs under six minutes a second.

**The sun and the moon, drawn:** the sun darkens toward its limb, blue most (a gold heart in a
deeper rim), its lower limb reddens near the sea, it is squashed by the air and looks a tenth
larger on the horizon. The moon is a sphere lit from the sun's side of it at a 50° phase angle,
a gibbous moon whatever the hour (a full one reads flat at 33 pixels): its shadow is on the limb
away from the sun wherever the sun is, the right as it rises beside the sunset, swinging
round through the night to the left as it sets before the sunrise, with the seas the eye knows (Imbrium,
Serenitatis, Tranquillitatis, Crisium, Fecunditatis, Nectaris, Procellarum, Nubium, Humorum,
Frigoris), Tycho with its rays, Copernicus, Kepler and Aristarchus, crater relief along the
shadow's edge and a faint earthshine. Its face turns as it crosses the sky, it looks a fifth
larger on the horizon, and it is light added to the air in front of it: a pale ghost in a lit
sky, the brightest thing in a dark one. The face is drawn only where the disc is (a branch with
explicit mip levels, so WGSL's uniformity rules hold).

## How it is built

All of it is generated: no models, no textures on disk, no compute. Two noise textures are baked
on the CPU when the scene is built (the sky's: broad fBm, rounded cells for cumulus heads, a
second fBm, fine fBm; the sea's: the slope of a five-octave height field and two heights).

- **`sunset-tsl.js`** — `skyColour(dir)`: the whole distance as ONE function of a direction —
  the air's three bands in the hour's colours (the sun's colour hangs as a lobe round its
  bearing), the sun and the moon with their glows and discs (the low sun squashed, its lower
  limb reddened, its heart yellower; the moon gibbous, with grey seas), the green flash, the
  stars on a 3D lattice (no stretched stars anywhere on the sphere) turning round the pole, the
  Milky Way arching across the night frame, a clear's 22° halo round the sun or the moon, high cirrus
  streaming toward the sunset point, long
  bars of cloud low over the sea, and the cloud deck drawn in relief: a few slices of one noise
  field at rising heights, composed from the lowest up, so toward the horizon the sides and
  tops of the clouds come into view over their bases. By day a cloud's top takes the light;
  with the sun on the horizon its base does, and low cloud toward the light shows its dark side
  with a lining. `glintLobe` is the share of water facets that mirror a light, from the slope
  and its variance.
- **`sunset-sky.js`** — the dome: `skyColour` along the view ray (drawn last among the opaque
  parts, depth test on, so it is shaded only where it shows), the air over the far sea below the
  horizon.
- **`sunset-sea.js`** — a fan of rings round the eye's foot out to 9 km. Eight Gerstner trains
  in the vertex stage, each fading out where the mesh is too coarse for it. The fragment
  rebuilds the slope from the same trains and up to three ripple layers, and keeps the slope a
  pixel cannot resolve as a variance: that variance is what draws the roads (sparks near the eye,
  a broad shimmering band toward the horizon) for the sun, the moon and every lantern through
  the same `glintLobe`. It mirrors `skyColour` along the mirror ray (fewer layers), takes the
  rings from a uniform table, and fades into the air over the far sea.
- **`sunset-lantern-pool.js`** (three-free) — every lantern's life in closed form in the world's
  clock: the light's arc from the card, afloat on the swell (`seaHeight`, `seaSlope` on the CPU),
  drifting out, lifted, climbing into the wind (lagged rise and drift, a T-spin's turn), guttering
  out at the horizon.
- **`sunset-lanterns.js`** — the lanterns (one instanced mesh: a tapered paper shell with bamboo
  ribs on a dark float, lit from inside in the piece's colour) and one additive layer of
  camera-facing glows (halos, the lights in flight with their trails, splash drops) that keep a
  few pixels across however far away they are.
- **`sunset-birds.js`** — the gulls: one small mesh with wings that bend at the elbow and beat
  in the vertex stage, each bird at its own pace with glides; the instances carry their own place
  and heading (a `positionNode` output is final, so an instance matrix would be lost).
- **`sunset-world.js`** — the uniforms, the day (the clock, the levels' offset, the sun's and the
  moon's places from `arcAt`), the tables (rings, lamps the sea mirrors),
  the event language, the camera (afloat: the swell lifts the eye a little), what the post needs.
- **`sunset-post.js`** — one scene pass, bloom with a hue-preserving high-pass (threshold above
  the brightest sky, so only the disc, the roads and the lanterns bloom), shafts marched toward
  the sun (none at night: they would comb the stars), calm zones under the card and stats, a
  hue-preserving filmic curve that whitens only the hottest values, the hour's grade, vignette,
  grain, FXAA.
- **`sunset-theme.js`**, **`sunset-director.js`**, **`sunset-composition.js`** — the adapter the
  recent rebuilds share (lifecycle, WebGPU with the WebGL2 backend, GPU-loss recovery, layout
  reads on frame time, the director that stages bus events and derives the true combo), with the
  clock and level carried across a rebuild in place.

## Tiers

Every tier keeps the whole picture and every event (`sunset-quality.js`): the deck's slices
(2 to 7) and how many of them the sea mirrors (0 to 3), its torn edges, cirrus, bars and the
Milky Way, the sea mesh (90 × 64 to 300 × 240), ripple layers (1 to 3), lanterns alive (24 to 64)
and how many the sea mirrors (4 to 22), rings, lights in flight, splash drops and the largest
flock (9 to 35). Bloom and shafts from Medium up; the pixel-ratio cap runs 0.7 to 1.6.

## Reproduce

Playground: `/playground.html?effect=sunset&t=14&quality=High&board=1` plus `hour=<h>` (holds the
day at an hour, 0 to 24: 4.7 before dawn, 5.45 dawn, 6.05 sunrise, 8 morning, 12 noon, 15
afternoon, 17 golden hour, 18 sunset, 18.4 afterglow, 19.3 dusk, 0 midnight; unset, `t` is the
day's clock: `t=0` is 16:40, sunset at `t=70`, sunrise at `t=355`),
`level=<n>`, `locks=<n>`, `lift=<n>&liftAge=<s>` (`spin=1`), `flock=<n>&flockAge=<s>`,
`event=lock|drop|clear|quad|tspin|perfect|levelUp` with `eventAge`, `lines`, `row`, `u`, `color`,
`combo=<n>`, `parts=sky,sea,lanterns,glows,birds`, `falseColor=1`, `noPost=1`, and
`P.<name>=<value>` to override any number of `TUNE` in `sunset-tsl.js` before the world is
built. The icon (shot on the six-hour wheel at its place 0.95, the sun on the water; on the day
that is `hour=18`): `t=40&quality=Ultra&hour=18&combo=5&icon=1&iconFov=24&iconYaw=0.322&iconPitch=-0.045&iconLanterns=9&lift=3&liftAge=6&flock=11&flockAge=9`
on a square frame.

Theme flags (the real game; add `unlockAll=1`): `sunsetTime=<s>` (seek and freeze),
`sunsetFixedDt=<ms>`, `sunsetParts=…`, `sunsetFalseColor=1`, `sunsetForceWebGL=1` (or
`forceWebGL=1`).

## Verification

All on 2026-10-11, on the feature tree (main 489105cf plus this rebuild).

- **Unit tests**: six files, 109 tests. `sunset-core` (the piece's light, the swell's slope
  against its height, the bodies' paths, the noise bakes); `sunset-hours` (the wheel, the bodies
  only ever turning one way, no crossing through grey, **the clock alone moving the light within
  the first minute and a whole hour in 96 s, a level adding one hour on top**, a new run going
  forward); `sunset-lantern-pool`; `sunset-world` (built for real in Node: every tier, the facing
  of the generated meshes, lanterns landing beside the card and never behind it, lifts, the green
  flash only with a low sun, the chain's fire and gulls, the hour on a level and by the clock, a
  new run); and the shared adapter's `sunset-director` and `sunset-theme` (from the sibling
  rebuilds). The Rainy Window half of `portrait-theme-composition.test.js` is kept; its Sunset
  half pinned the old class and went with it.
- **Gates**: typecheck, the ts and lint ratchets (the lint count fell to 612 against a baseline of
  807), architecture fitness, the theme lifecycle audit, dependency boundaries, palette, perf
  budgets, the build with the boot-closure guard, ip-strings, pages artifact, release gates: all
  pass. Full suite 816 of 819 files: the three reds fail on this machine whatever the change (the
  Swedish-locale briefing test, the TTS recorder's symlink that Windows refuses, and the Odyssey
  forest's 300 ms wall-clock bake budget, which passes alone, 23 of 23).
- **Playground**: WebGPU on the RTX at every tier and the WebGL2 backend, at 1600 × 852 and in
  portrait (430 × 850), every hour and every event; the look was iterated on SwiftShader
  (`hours.jpg`, `events.jpg`, `halo.jpg`, `tiers.jpg`, `portrait.jpg` here).
- **Real game** (Electron, dev server): WebGPU on the RTX at 131 fps at High (the display's rate),
  the WebGL2 backend at 122 to 131 fps; no console warning or error, no event dropped; real hard
  drops, clears, a chain (ten lanterns lifted, the flock called) and a level-up (`ingame.jpg`). A
  tier change at 151 s of theme clock came back at 155 s on the same hour (wheel place 1.57, then
  1.62): the light does not snap back.
- **The clock alone** (`clock-ingame.jpg`): the real game at level 1 with `sunsetFixedDt=50` and
  no clears: golden hour at 8 s, the sun on the water at 64 s, at the horizon at 119 s, afterglow
  at 174 s and 228 s, night at 283 s, level 1 in every frame.
- **Lifecycle validator** (`validate-all-themes --theme sunset`): 107 of 107 checks, no console
  error. `docs/theme-screenshots/sunset.png` and its result are that run's.
- **Phone emulation** (software WebGL2): pass at Low and Minimal, and their screenshots are clean.
- **The icon** (`icon.jpg`, `icon-at-picker-size.png`, the old one first): the sun half under the
  sea with its road, a lantern rising, gulls crossing, lanterns afloat; a 512 × 512 full-bleed
  circle in both icon places. It is my pick, previewed at 80 px beside its neighbours.

**The day (2026-10-12, on main 3ff50fe7 plus this change):**

- **Unit tests**: `sunset-hours` rewritten for the day (the stations and what they author, no
  grey crossing at any of 480 points of the day, darkest at midnight, never standing still; the
  sun up on the right at six, 52° up at noon, down on the left at six, right to left all day; the
  moon up just before sunset and down just before sunrise; the air's colours; the clouds handed
  to the moon and back; the timetable rising without a break, lingering at dawn and dusk, under
  six minutes of the day a second; the clock alone moving the light within the first minute; a
  level as an eighth of the day). `sunset-world`: the sun and the moon clear of the card and the
  stats bar at every quarter hour they are in the picture, the clock and two kinds of level-up
  (never back), the stars turning the same way as the sun, a new run keeping the day and a rebuild
  handing it over whole. Six files, 115 tests.
- **Playground** (WebGPU on the RTX at High; Low, Ultra and the WebGL2 backend too; no console
  error or WebGPU validation message): every station and the hours between (`day.jpg`: midnight,
  03:00, 04:42, dawn, sunrise, 07:00, noon, 15:30, golden hour, sunset, afterglow, dusk), the
  moon's face and phase cropped at its real size, a level-up running the day on, a clear's halo
  round the moon, four lines at sunrise (the green flash shows at sunrise too).
- **The clock alone in the real game** (`day-ingame.jpg`): level 1, no lines, `sunsetFixedDt=200`:
  16:51 at 8 s of theme clock, the sun on the water at 75 s (18:07), the moon up on the right at
  152 s (20:01), midnight at 217 s, the moon low on the left at 291 s (04:30), dawn at 332 s,
  the sun on the sea on the right at 361 s (06:07), the morning at 423 s, noon at 484 s and the
  sun coming down on the left again at 548 s (16:16).
- **Picks**: the station palettes, the 565 s day and its timetable, the arcs' heights, the moon's
  lag and 50° phase are my choices.

Not done: no perf-lane (ADR-0016) reading, no integrated-GPU or real-phone reading, the
multiplayer, Infinity, meditation and Odyssey layouts not captured, and nobody has watched it
move except through stills and strips. Blender was not used: the scene is a sky, a sea and small
generated meshes. The 22° halo, the hour palettes, the 96 s hour and the icon are my choices.
