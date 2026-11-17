# Solar Eclipse — the black sun over the salt mirror

Rebuilt from scratch on 2026-10-11 (`feature/solar-eclipse-masterpiece`, merged 6c14c6bf) as "the
crown of the black sun", taken further on 2026-10-12 (`feature/solar-eclipse-totality`), and given
its atmosphere on 2026-10-21 (`feature/solar-eclipse-third-pass`), all with Three.js 0.186.1. The rebuild replaced the earlier theme in full (a classic
`WebGLRenderer` scene of a plasma sun sphere, a moon sphere that slid across it, particle
coronas, flares, meteors, nebula quads and lens flares, finished by an `EffectComposer` with
UnrealBloom, chromatic aberration and a vignette, all in GLSL `ShaderMaterial`s). The second pass
kept the rebuild's sun, its event language and its palettes, and changed the world it stands in:
the lens came down from a high ridge to the edge of a flooded salt flat, and the water gives the
whole eclipse back. The third pass kept all of that and worked on the air and the light in it: the
flat cloud deck became rows of heaped cloud, the sky leans toward the near edge of the moon's
shadow, the prominences became flux ropes that erupt as loops, and the water draws its bright
reflections out into a soft column. The fourth pass (2026-11-17, `feature/solar-eclipse-living`,
three r187) made it live: a totality sky in every palette, a weather of real cloud forms, a
sculpted volcano whose summit passes in and out of the sunlight, a sungrazing comet now and then,
flamingos, an effect of its own for every event, and the end of a run as third contact (the next
section). Solar Eclipse keeps its identity — the sun and the moon in one line, a corona, a
diamond ring. This document records the shipped design and what was verified. It is a reference,
not a backlog.

## The living totality (2026-11-17)

The audit (captures at rest, through the clock and on every event, and measured pixel columns)
found: the sky a low-saturation mauve wash (the band peaked at a peachy (178, 120, 102), the
middle of the sky (94, 75, 87)), with three of the six palettes tinting the whole frame (an olive
jade, a grey azure); the clouds flat cut-out patches with orange decals on top, a camouflage the
mirror doubled; the volcano a flat brown paper cut-out; nothing but the palette changing over
time; level-ups, CMEs and twists hard to see, and the clears looking alike but for their beads.

What changed:

- **The air** (`solar-eclipse-sky.js`, `PALETTES` in core.js): every palette keeps a real totality
  sky: deep blue overhead, a saturated band with its own height (`bandHeight`), a hot rim that
  turns yellow toward the shadow's near edge and redder away from it, and a new `belt` of paler
  light lifted above where the band has faded (the old terms summed complementary hues into grey:
  gotcha #1414). The palettes now differ in the band's character: ember (amber under violet),
  gold, jade (a coral band under a teal sky), azure (white-gold under cobalt), violet (magenta),
  rose (crimson under plum).
- **The weather** (`solar-eclipse-clouds.js`, `WEATHERS`/`weatherAt` in core.js): five weathers
  turn by the clock (banks, towers, clear, deck, storm; 70–100 s each, 22 s hand-overs), mixing
  four layers. *Towers*: far cumulus beyond the moon's shadow, in full sunlight while everything
  round the lens is dark; the uneclipsed sun stands behind them, so their cores are dusky, the
  face toward the sun burns and their thin parts glow with forward-scattered light; their heads
  run ahead of their feet and boil, so a tower grows and falls apart. *Deck*: altocumulus rows in
  their own plane, dark overhead and burning where the sheet reaches out past the shadow's edge,
  so the edge of the shadow is drawn across the sky (gotcha #1517 for its far veil). *Rows*: the
  old three rows restyled as long soft bars, dark bodies lit from below by the band, their thin
  edges letting it through. *Lenticular*: a stack of smooth lenses over the volcano, sunlit when
  its summit is. Every layer changes shape as it drifts (its layers move at different speeds).
- **The shadow breathes** (`shadowReachAt`): its reach swings ±20 % over 173 s, so the volcano's
  summit (`summitLit`) and the far clouds pass into the sunlight and out of it.
- **The volcano** is sculpted (gotcha #1606): gullies fanning from the summit, the flank toward the
  bright side holding the band's light, snow above a ragged line lingering in the gullies, cool
  grey snow in the shadow, and sunlight that creeps down from the summit as the shadow draws back.
  A near range's backlit rim no longer draws a line across it (gotcha #1605).
- **The comet** (`COMET`/`cometAt`): every 290 s a sungrazer stands in the corona for 80 s, a few
  radii off the limb, a straight blue ion tail and a curling dust tail streaming away from the
  sun; each one takes the next of four places.
- **The corona** stands in an aureole of its own scattered light and fades in daylight; the
  prominences burn less white, so the pieces' colours stay saturated.
- **The flamingos** (`solar-eclipse-flamingos.js`, `-flamingo-flight.js`, `-flamingo-model.js`,
  built by `scripts/blender/solar_eclipse_flamingo.py`, headless and byte-identical): a Blender
  model of 544 triangles with a 16-bone rig and sampled actions (flap, walk, glide, stand, feed, alert, a wing
  salute, rest on one leg). About one flight a minute (5–12 birds in a loose file or a shallow
  echelon, 110–200 m out, 3–7 m over the water) crosses low in front of the band, each bird
  entering and leaving beyond the frame's edge; a wading flock of up to 20 stands 150–330 m out
  between the sun's column and the card, each bird running its own loop of acts. Every bird is
  doubled in the mirror by the same bones turned over the water. Thin parts are widened to at
  least 1.2 px with coverage alpha, since the post has no MSAA. Two draws; their stable identities
  come from the flight's slot and the bird's rank, never from a list index.

The events, each now its own (the table under "Event language" still holds for the rest):

| Event | Its own effect, added this pass |
|---|---|
| Two lines | Shadow bands race over the whole flat (a swell; none under reduced motion). |
| Three lines | A wave of light runs out through the corona along its streamers (two may run; a quick second feeds the first). |
| T-spin | The twist falls off steeply with height (`TWIST_FALLOFF`), so the rays wind into a visible pinwheel (1.45 rad at the limb). |
| Back-to-back | A halo CME: a fibrous shell blown out all round the sun to about four radii, a cavity behind it, beside the twin ejections; fed, never restarted. |
| Four lines | The diamond now strings the lens's ghosts through the frame (post, High and up). |
| Perfect clear | The second totality: as the diamond closes, the moon's shadow sweeps back across the sky from the west, the daylight held ahead of its front, a darker curtain at its edge; a wave runs out through the corona after it. |
| Level up | A pulse of light runs round the horizon from the shadow's bright side. |
| Game over | Third contact: the moon slides off further than for any diamond, a sliver of the sun burns, daylight floods back and the corona fades, for 11 s or until the next run starts (`onSessionStart`, from the mode manager's `modeStarted`); then the shadow sweeps back in. |

New playground parameters: `weather=banks|towers|clear|deck|storm`, `comet=<s>`, `flamingo=<s>`
(`flamingoFlight=<k>`), and the events `clear&lines=2|3`, `b2b`, `gameOver`, `return`.

### Verification (the living pass)

- **Unit tests:** the eight Solar Eclipse files, 213 tests, green: `solar-eclipse-living.test.js`
  (17: the palettes' belt and deep air, the weather's cycle and hand-overs, the shadow's breath
  and the summit's light, the comet, each event's own effect, third contact and the return, a
  seek forgetting everything, reduced motion), `solar-eclipse-flamingos.test.js` (17), and the
  shader gate now building High, Low and Minimal through both builders (the High dome is 88.5 KB
  of WGSL, 73 KB before; the budget is 112 KB).
- **Playground** (WebGPU on the RTX, `maxFps=30`): the six palettes, the five weathers, an
  eight-minute clock strip, every event, close-ups of the volcano, the clouds, the halo, the comet
  and the water; Minimal, Low, Medium, Ultra, the WebGL2 backend at rest and on four lines, a
  390 × 844 portrait (at rest and in third contact) and 21:9; consoles clean.
- **Real game** (private headless Chrome, WebGPU, 30 fps): the theme pinned, real hard drops,
  then three lines, four lines with a back-to-back, a perfect clear and a game over through the
  app's own bus and window event; every effect drew and the console was clean.
- **Water grain** (owner feedback on Sunset: no sparkle fields on water in play): the share of
  pixels 22 levels brighter than their 7 × 7 mean on the left half of the water is 0.6 % at
  rest, 0.8–1.6 % on single, double and four-line clears (1.0–1.2 % before this pass); a perfect
  clear reaches 2.9 % on its lower water, which is its rings breaking the reflected corona's rays
  into smooth bands, not sparkle.
- **Cost** (RTX, 1920 × 1080, `maxFps=30`, GPU timestamps, two interleaved rounds, origin/main on a
  second private server): High 0.378 ms on main, 0.42–0.43 ms with the sky and weather (banks,
  storm), 0.45–0.48 ms with the flamingos (0.48–0.54 with their first, 1,960-triangle mesh; now
  544 triangles a bird, at most about 33K for every bird and its image on High); Low 0.238 →
  0.27 → 0.29 ms. Not measured: the integrated GPU, an uncapped frame rate.
- **The icon** is re-baked from the new sky (the icon lens over sunlit towers, ember, ten
  prominences; contrast 1.16, saturation 1.25, brightness 1.05).

Not verified in this pass: a real phone, multiplayer and Odyssey layouts, anyone watching it in
motion for minutes; the flamingos ignore reduced motion (calm ambient life, a judgement call).

## The picture

The moment of totality over a salt flat under a film of still water, seen through a long lens.
The black sun stands in the free space left of the card, its corona streaming out along the
lines of its magnetic field: two helmet streamers on the equator narrowing into long pointed
wings, fine polar plumes splaying out of the dark polar holes, hundreds of fine rays between. The
moon is a little larger than the sun and pitch black; a thin pink sliver of chromosphere creeps
round its limb. Venus and Jupiter are out.

Below the horizon the water returns all of it: the black sun and its crown stand in the mirror
under the sun itself, the same height below the horizon as the sun stands above it. Near the
lens the mirror is broken by the salt crust's cracked polygons, their dry ridges catching the
light of the horizon; farther off they sink into the film and the water is glass. A long, faint
swell bends the reflection slowly, and the wind's patches roughen some reaches and leave others
still.

On the far shore stands a low line of ranges and, right of the card, a broad volcanic shield
with a broken summit and a parasitic cone on its flank, every one doubled in the water. Over them
stand three rows of heaped cloud, each farther and lower than the last: the farthest, out beyond
the edge of the moon's shadow, is still in sunlight and burns orange from the top down, its
creases in the sky's cool light; the nearest, under the shadow, are dark bodies whose undersides
the band of light lights from below, their thin edges letting it through. All round the horizon
burns the light of the world beyond the shadow, but the lens does not stand in the shadow's
middle: toward its nearest edge (right of the card, and swinging slowly with the clock) the band
burns brighter and climbs higher and even the near clouds catch the sun, while over the black sun
the air is darkest. Between the warm band and the dark the light pales toward blue, and a breath
of mist lies on the far water.

The card sits in the middle of the frame, so the picture is composed round it: the sun stands in
the middle of the free space on the card's left (the world reads the live card rect), its size a
set share of the frame but never so large that its crown overflows that space, and its reflection
stands in the same column below; on a screen too narrow to leave any space beside the card (a
phone held upright), a smaller sun stands above the card instead.

## The one idea

**The board dresses the black sun, and the water gives it back.** Every locked piece raises a
prominence on the sun's limb in the piece's own colour, born in a flare at its feet: the board's
columns are laid over the top of the sun, left column on the left limb, so the crown records where
the pieces fell. A clear sends Baily's beads racing round the limb, flings the oldest prominences
off into the corona and drops a ring into the sun's own reflection. Four lines bring the diamond
ring, and its light runs down the water. A chain of clears is a longer exposure: the camera sees
further into the outer corona, the faint stars come out, earthshine lights the moon's face, and
the water stills to glass.

## Event language

| Event | What happens |
|---|---|
| Lock | A mote of the piece's colour leaves the card's edge at the piece's height and eases along a bowed path to the limb, running round the edge of the moon rather than across it (its reflection flies in the water below), where a prominence of that colour is born in a flare at its feet and rises in under a second: an arch, a flux rope with strands wound round it and fainter loops of the same system nested under it, hottest at its feet (which take the chromosphere's pink) with knots draining down its legs, or a ragged hedgerow. The limb keeps twelve; each stands about half a minute, then fades. Nothing lands on the water at the card's foot: the lock belongs to the sun. |
| Hard drop | A taller, wider arch, a brighter flare and mote, a jolt of the lens and a kick of the fringe. |
| Clear | A necklace of beads, one per line, races round the black sun; the chromosphere flashes; the corona swells; the two oldest prominences per line ERUPT: each lifts off the limb as a loop (a hedgerow too) that widens as it climbs, sways in long bends, thins into strands with its legs trailing below it, and is flung out through the corona within two seconds. With none held, sprays of white jets run out instead. A ring drops into the sun's own reflection, stronger for more lines, and breaks it into wavering bands as it spreads. |
| Four lines | The diamond ring: the moon slides off until the photosphere breaks through one lunar valley on the card's side; a brilliant bead with a modest starburst, a ring of beads, daylight flooding back into the air, the lens breathing; its light lays a glitter path down the water (a soft pillar there; the starburst is the lens's own and is never in the mirror) and shadow bands race over the salt; then the moon slides back and totality returns. Two rings follow each other into the reflection. Half a second later a coronal mass ejection leaves the limb into the open sky (up and away from the card beside it, sideways over it): a bubble that blows the corona's own rays outward. Every held prominence erupts with it. |
| Perfect clear | The four-line show, with a larger flash, a stronger diamond and a second, six-bead necklace. |
| T-spin | The corona twists: the rays wind into a spiral that is strongest at the limb and unwinds outward, the prominences swept round with it, then rings down over about two seconds. A whirl winds into the reflection. |
| Chain | The exposure lengthens: the outer corona and the streamers' wings reach further, the faint stars come out (and stand in the water), earthshine shows the moon's maria; the swell and the wind die down and the mirror goes to glass. It all closes slowly when the chain breaks. |
| Level up | The light turns one step (and the solar cycle with it), the chromosphere flashes all round the limb, two beads run round it and a gentle ring spreads through the reflection. |
| Clock alone | The light turns one step every 100 s, whatever the level, resting 15 s at each end (so it is on its way 70 % of the time); the solar cycle rides the same wheel, so the corona's shape changes too. The sun's axis sways over 260 s and the moon wanders over 83 s and 131 s, so the chromosphere's sliver creeps round the limb; the moon's shadow swings its bright side over 310 s; the cloud rows drift along the horizon and the wind's patches wander over the water. |

The palettes, in hue order round the wheel: **ember** (amber horizon, indigo shadow, the quiet
sun's long wings), **gold**, **jade**, **azure** (an icy horizon, the round crown of solar
maximum), **violet**, **rose**. Each palette carries where the solar cycle stands, so a session
watches the corona change from the two long wings of a quiet sun to a crown of streamers and
back. Neighbours' glow and band colours are staggered by a family so a blend never passes
through grey (`solar-eclipse-core.test.js` checks the saturation half-way between every pair).
The burning clouds take each palette's sunlit colour, their creases and the shadowed rows its
air, the salt its air too.

## How it is built

Everything is one dome and one set of strips:

- `solar-eclipse-sky.js` — the dome round the lens. Each pixel reads the scene in its own
  direction. Below the horizon it first asks the water (`solar-eclipse-mirror.js`) which
  direction the mirror sends the eye on to, and draws the sky in THAT direction: the reflection
  is not a second pass and not a reflector, it is the same function read once per pixel. Then:
  the air (the dark of the shadow, the band beyond it, the bright rim at the horizon, daylight
  for the diamond; the band leans toward the moon's shadow's near edge, `UMBRA` and
  `u.umbraAz`, and pales toward blue above it), the planets and the exposure's faint stars, the
  sun (below), the clouds (core.js `CLOUDS`: three rows at 150, 66 and 40 km, each read in
  (bearing, height above its base) so a heap keeps its shape however low it stands, the
  threshold climbing with height for flat bases and heaped tops, a second tap a little higher
  telling tops from undersides; lit from above where the row lies beyond `shadowEdgeAt`, lit from
  below by the band inside it; held off the black disc), then six crest lines from a baked half-float table,
  farthest first: each darker than the air behind it, mist along its foot, its crest rimmed by
  the light behind; the farthest is the sunlit range beyond the shadow. Last, for the water's
  own pixels: Fresnel over the salt's floor, the salt under the film, the crust's ridges lit by
  the whole sky (shadow bands flicker over them at the diamond; sunk under the film where the
  water gives the sun back, so no vein crosses its reflection), the diamond's glitter, and a
  breath of mist on the far water.
  Every exponential is bounded before it is masked.
- `solar-eclipse-mirror.js` — the water under a direction that looks down: its ground point
  (the lens stands 1.7 m above it), three faint swells that fade wherever a wave would be finer
  than a few pixels (so the far water is glass and never aliases), the wind's patches, a table of
  eight rings and whirls the gameplay drops (a short train of crests spreading at 1.35 m/s, its
  slope thinning as it widens; core.js `ringSlope` is the CPU twin), the normal, the reflected
  direction (never back down into the water), Fresnel, and the salt crust: a Voronoi on the
  ground plane, its borders wandering, its ridges swelling, thinning and sinking along their
  length, keeping their share rather than their width once a ridge is finer than a pixel, gone
  beyond 60 m. The glitter path is an analytic facet distribution round the reflected diamond,
  so it is the narrow column real water makes, sparkling where single facets can be resolved.
- `solar-eclipse-sun.js` — the black sun, drawn in the lens's IMAGE PLANE in solar radii (so it
  is a true circle on any screen). The corona is a dipole field: a point at radius r and latitude
  λ lies on the field line whose foot is `acos(cos λ / √min(r, 2.5))`. A broad warp tilts the
  belt by position angle alone (a ray beyond the source surface stays straight). The fine rays
  read the noise along a label that leans toward the radial away from the closed arches (so the
  open field never combs into hair), each quadrant from its own row, blended smoothly across the
  current sheet and the axis (so no limb mirrors another). Inside the helmets the light is smooth
  with a whisper of loops; a bright cusp where they close; a stalk narrowing as `0.2/r + 0.075`
  radians and falling off as `r^−1.85`, its rays calmed, so the wing is one long streamer and
  never a beam; ten extra streamers rise as the cycle climbs. Then the chromosphere, the
  prominence table (a Loop over twelve rows; arches as flux ropes with wound strands and a
  nested arcade, hedgerows, sprays of jets; the birth flare; each eruption a slow sway of its own
  frame, a lift, a widening loop whose threads spread and thin, and a fade, all inside a box that
  grows with it and fades its light before its edge), a CME, the
  moon (its limb notched by lunar valleys where beads break through), the bead necklace and the
  diamond's glare.
- `solar-eclipse-fx.js` — the motes: instanced strips laid along the great circle from the card's
  edge to the limb, bowed, eased in, with a rounded nose, every point carried out of the moon's
  disc in the sun's plane so a mote runs round the limb; a second set reads the same table
  turned over the horizon and dimmed by the water, drawn only where the mote is above it.
- `solar-eclipse-world.js` — the state: the composition, the prominence table, the ripple table,
  the moon's wander and slide, the exposure and the glass, the twist, the diamond's glitter
  direction and the shadow bands, the palette wheel, and what the post is asked for (flash, kick,
  bloom boost, the iris on the diamond, the lens breath, and two MATTES: the moon's disc and its
  reflection, inside which the post holds the bloom off, so the inner corona's glare never greys
  the black).
- `solar-eclipse-core.js` — the numbers, CPU only: frames, the far shore's bake (the volcano is
  an uneven shield, its left flank longer, its summit broken by a crater's notch, a parasitic
  vent on its flank), the mirror (`MIRROR`, `groundOf`, `ringSlope`), the cloud deck (`CLOUDS`),
  the corona's field constants and streamer set, the moon, the palettes and their wheel, the
  exposure curve, the board-to-limb mapping, the prominence shapes.
- `solar-eclipse-post.js` — one scene pass, a max-channel bloom (Medium and up), one output pass:
  lens breath, fringe, calm zones over the card and HUD, below the horizon the bloom drawn out
  into a soft vertical column (eight taps; a chain stills it), the two moon mattes (held off from
  98.5 % of the disc's radius to its edge, so the limb is crisp), exposure, a hue-preserving
  filmic tone map, a grade that leans the shadows blue by scaling alone (an added constant
  lifted every black to a veil), vignette, grain and dither.
- `solar-eclipse-theme.js`, `-director.js`, `-composition.js` — the lifecycle, the renderer
  (WebGPU, else its WebGL2 backend), the gameplay intake (the true combo, several boards), the
  layout watch, settings, reduced motion and device-loss recovery, as in the sibling rebuilds.

The mirror is the one motif here the fleet already knows well ("mirror water across the bottom
third", `docs/theme-concepts/reference/catalog.md`, Part 0). What keeps it this theme's own: it
is a salt flat, not a lake (the cracked crust is in no other theme); it doubles an eclipse; and
the water answers the sun, not the board — the catalogue's most-shipped lock device, a ring from
the board's foot, was tried in this pass and taken out again.

## Tiers

Every tier keeps the whole picture and every event (`solar-eclipse-quality.js`); the mirror, its
rings and whirls, the glitter path and the reflected motes are on every tier:

| Tier | Corona rays | Outflow | Prominence threads | Snow, gullies | Valley mist | Exposure stars | Swell | Salt crust | Cloud rows | Towers, cap | Deck | Flamingos (flock / flight) | Motes | Bloom (and the water's column) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Minimal | 1 octave | — | — | — | — | — | — | — | — | — | — | 8 / 6 | 8 | — |
| Low | 1 octave | — | yes | — | — | yes | yes | — | — | yes | — | 10 / 7 | 10 | — |
| Medium | 2 octaves | yes | yes | yes | — | yes | yes | yes | yes | yes | yes | 14 / 10 | 12 | yes |
| High, Ultra, Extreme | 2 octaves | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | 18–20 / 12 | 14–16 | yes |

The comet, the shadow's sweep, the halo CME, the waves through the corona and third contact are
on every tier; the lens's ghosts ride on the lens breath (Medium and up).

The pixel-ratio cap rises with the tier (0.7 → 1.6), as in the sibling themes.

## Reproduce

Playground: `/playground.html?effect=solar-eclipse&t=14&quality=High&board=1`, plus
`event=lock|drop|clear|quad|twist|perfect|levelUp`, `eventAge=`, `lines=`, `u=`, `row=`,
`color=`, `combo=`, `locks=`, `clears=`, `level=`, `parts=sky,motes`, `noPost=1`,
`falseColor=1`, `px=`/`py=`, `reduce=1`, and `icon=1` (`iconFov=13`, `iconYaw`, `iconPitch`,
`iconHorizon=1` to stand the lens level at the horizon under the sun). `t=14` lies in the rest
of the level's own palette; a later `t` shows the clock's drift.

Real game: `?eclipseTime=<s>` (frozen), `?eclipseFixedDt=<ms>`, `?eclipseParts=sky,motes`,
`?eclipseFalseColor=1`, `?eclipseForceWebGL=1` (or `?forceWebGL=1`). The theme needs
`unlockAll=1` in a fresh profile.

The icon (re-baked in the living pass): `t=14&quality=Ultra&icon=1&iconHorizon=1&iconFov=34&locks=10&weather=towers&hud=0`
captured square (840 px), the whole frame baked to a 512 px circle with contrast 1.16, saturation
1.25 and brightness 1.05: the black sun over its own reflection, the burning horizon and the
sunlit towers between. (Superseded: the earlier pass's icon, saturation 1.3, brightness 1.04,
without the weather.)

## Verification

### The atmosphere pass (2026-10-21, origin/main 8a064bb7 plus this change)

- **What changed, and why:** in the baseline captures the cloud deck read as horizontal dashes
  over the whole band (a flat deck seen this low; the TSL notes' own trap) and again in the
  water; the sky was one lavender wash; the prominences read as neon hoops, their eruptions tore
  into straight-edged chunks (the box each is drawn in clipped them) and a mote could fly across
  the black disc; the lens's starburst stood in the water as a zigzag and the salt crust drew
  veins over the moon's reflection, so it read as a cracked boulder.
- **Two bugs the new shader gate found:** the white jets a clear sends out with no prominence
  held had never drawn (their `up` was assigned in the hedgerow branch only, the jet branch read
  zero), and the first build of the cloud rows read zero in two of three rows for the same
  reason. Both pinned; `tests/unit/solar-eclipse-shaders.test.js` (new) builds the dome and the
  motes through the WGSL and GLSL builders at High and Minimal and fails on a warning, an
  unassigned var read, an equal-edge smoothstep, a NaN literal, MaterialX noise or a helper that
  closes over a uniform. The High dome is 73 KB of WGSL (about 69 KB before).
- **Unit tests:** the five Solar Eclipse files, 164 tests, green; new: the cloud rows (farthest
  first and lowest, under the sun, the farthest in sunlight on every bearing, the nearest in the
  shadow on its dark side), the shadow's bright side (nearer edge, a slow swing always right of
  the line of sight), the world writing it, and the post told where the water begins and how a
  chain stills it.
- **Playground:** WebGPU on the RTX 5080 Laptop: every event, the six palettes, Minimal, Low and
  Medium, a narrow portrait, prominence close-ups at 2400 × 1350; the WebGL2 backend at rest and
  on four lines; consoles clean.
- **Real game** (the private dev server, theme pinned, sixteen real hard drops, a shown
  off-screen window): WebGPU at about 169 frames a second on the RTX, no console errors; twelve
  prominences held at once.
- **Cost:** on the RTX at 2560 × 1440 Ultra the playground frame (seek included) measured 2.13 ms
  on origin/main and 2.24 ms with this change (median of nine interleaved runs, a few per cent and
  within the run-to-run spread). On the Radeon 610M iGPU other sessions shared the GPU and single
  runs swung from 25 to 80 ms, so no difference there can be read; not measured further.

Not verified in this pass: a perf-lane reading, a real phone, the phone validator, multiplayer and
Odyssey layouts; `aspects.jpg`, `clock-ingame.jpg` and the icon are the previous pass's.

### The salt-mirror pass (2026-10-12, origin/main 3ff50fe7 plus this change)

- **Unit tests:** the four Solar Eclipse files, 154 tests, all green: `solar-eclipse-core.test.js`
  (32: the far shore stands on the water with open water between the nearest islands; one
  volcano, an uneven shield with a broken summit and a parasitic vent; the water under a downward
  direction; a ring spreading at its own speed and dying away; a faint swell; the cloud deck
  burning low, under its top), `solar-eclipse-world.test.js` (42: the sun's reflection the same
  height below the horizon in its own column; a lock drops nothing on the water; a clear's ring
  into the reflection, stronger for more lines, two on four lines; a whirl on a T-spin; the oldest
  ring's slot reused; the glitter path aimed at the bead and the shadow bands, both gone after;
  glass in a chain; the reflected moon's matte; a seek forgets every ring; the CME off the card),
  and the director (26) and theme (54) tests. The whole suite (`--maxWorkers=5`, long timeouts, run alone):
  844 of 846 files and 16 175 tests green; the two red files are the same environmental reds as
  the rebuild's (`odyssey-level-briefing`: the Swedish number format; `tts-recorder-e2e`: Windows
  refuses its symlink).
- **Every CI gate on the final code:** typecheck, ts-ratchet (at baseline), the lint ratchet
  (count shrank, 807 → 565; baseline left alone), architecture fitness (shrank), the theme
  lifecycle audit, dependency boundaries, the palette gate (its one warning is another theme's),
  perf budgets, the build with the boot-closure guard, ip-strings, pages-artifact and release
  gates; the URL-parameter catalogue tests (`iconHorizon` is catalogued). ESLint is clean on every
  file of the change.
- **Shaders without a device:** both backends' graphs built in Node at High and Minimal, no TSL
  warnings; the dome's fragment is about 60 KB of WGSL (41 KB before the mirror).
- **Playground:** eight GPU rounds on the RTX (WebGPU): every event, the six palettes, Minimal to
  Extreme, 21:9, 4:3 and a narrow portrait, close-ups of the corona and the prominences, and the
  icon candidates; consoles clean.
- **Real game** (the dev server, theme pinned, real hard drops, clears, a chain, four lines and a
  level-up through the app's own bus; one run each, an observation, not a measurement): WebGPU on
  the RTX at 129.7 fps, the WebGL2 backend at 131.3 fps and the AMD integrated GPU at 130.9 fps
  (all at the display's rate), no console errors on any of them; a quality change mid-session
  rebuilds in place. The clock-only strip below (`eclipseFixedDt=100`, level 1 and no lines in
  every frame) moves ember → gold → jade → toward azure and the solar cycle 0.12 → 0.95 in 284 s
  of theme time. Those runs were taken just before the swell was halved (the moon's reflection
  read as a boulder); the playground captures and the fleet screenshot are after it.
- **`validate-all-themes --theme solar-eclipse`** against a preview of the build: PASS (0
  lifecycle failures, 0 console errors); its screenshot and result replace the old ones in
  `docs/theme-screenshots/` (the shared `capture-report.json` left as it was).
- **Phones:** `validate-mobile-webgl2 --theme=solar-eclipse` at Low and Minimal: pass, no errors
  (four SwiftShader readback notices), and the screenshots were read: portrait, the diamond and
  landscape all draw, nothing black where light belongs.

Tried and taken out again in this pass: a ring of the piece's light spreading on the water from
the card's foot on every lock (the fleet's most-shipped lock device, so the lock now flares on
the sun instead), and islands of dry crust (they swallowed the sun's reflection).

Not verified: a perf-lane reading (ADR-0016); a real phone; multiplayer, Infinity, meditation
and Odyssey layouts; anyone watching it move for minutes. The icon, the salt mirror replacing the
ridge, and the palettes' pace are the author's picks.

### The rebuild (2026-10-11, origin/main 489105cf plus that change)

139 new tests; the whole suite 814/816 (the two environmental reds); every CI gate and the
build; real game on the RTX (WebGPU 132 fps, WebGL2 127–128), iGPU 132; validate-all-themes
PASS; phone validator Low/Minimal pass. Recorded in full in this file's history (6c14c6bf).

## Captured previews

- `solar-eclipse-captures/living-palettes.jpg` — the six palettes at their rest (the living pass).
- `solar-eclipse-captures/living-clock.jpg` — eight minutes of the clock alone: the weather, the
  light, the comet, the summit in and out of the sunlight.
- `solar-eclipse-captures/living-events.jpg` — a clear of each size, four lines, the perfect
  clear's sweep, a twist, a back-to-back's halo, a level-up's pulse, third contact and the return.
- `solar-eclipse-captures/living-ingame.jpg` — the real game: rest, hard drops, three lines, four
  lines and a back-to-back, the perfect clear's sweep, third contact.
- `solar-eclipse-captures/living-flamingos.jpg` — flights left of the card and right of the HUD,
  the wading flock, in three palettes.

Earlier passes:

- `solar-eclipse-captures/third-pass.jpg` — before and after the atmosphere pass, at rest and on
  four lines.
- `solar-eclipse-captures/prominences.jpg` — before and after: held, erupting, and a mote on its
  way to the limb.
- `solar-eclipse-captures/events.jpg` — a hard drop, a clear's eruptions and ring, a clear's
  jets, the diamond ring and its glitter path, the CME, a T-spin, a perfect clear, a level-up, a
  chain.
- `solar-eclipse-captures/palettes.jpg` — the six palettes at their rest (`level=1…6`, `t=14`).
- `solar-eclipse-captures/tiers.jpg` — Minimal, Low, Medium.
- `solar-eclipse-captures/ingame.jpg` — the real game: at rest, after hard drops, twelve
  prominences held.
- `solar-eclipse-captures/clock-ingame.jpg` — the clock alone in the real game, level 1 (the
  salt-mirror pass).
- `solar-eclipse-captures/aspects.jpg` — 21:9, 4:3, a narrow portrait (the salt-mirror pass).
- `solar-eclipse-captures/icon.jpg` — the old icon, the new one and the gold alternative.
