# Solar Eclipse — the crown of the black sun

Implemented 2026-10-11 on `feature/solar-eclipse-masterpiece`, with Three.js 0.186.1. A
from-scratch rebuild: it replaces the earlier theme in full (a classic `WebGLRenderer` scene of a
plasma sun sphere, a moon sphere that slid across it, particle coronas, flares, meteors, nebula
quads and lens flares, finished by an `EffectComposer` with UnrealBloom, chromatic aberration and
a vignette, all in GLSL `ShaderMaterial`s), and the `solar-eclipse-mobile` playground effect
that previewed its portrait fit. Solar Eclipse keeps its identity — the sun and the moon in one
line, a corona, a diamond ring — and everything else is new. This document records the shipped
design and what was verified. It is a reference, not a backlog.

## The picture

The moment of totality, seen through a long lens from a high ridge. The black sun stands in the
free space left of the card, its corona streaming out along the lines of its magnetic field: two
helmet streamers on the equator whose stalks run far out as long wings, fine polar plumes
splaying out of the dark polar holes, hundreds of fine rays between. The moon is a little larger
than the sun and wanders a little off its centre, so a thin pink sliver of chromosphere creeps
round the limb. Venus, Jupiter and a few bright stars are out. Below, range after range of
mountains fades into the haze, mist banked in the valleys between them, and all round the
horizon burns the light of the world beyond the moon's shadow.

The card sits in the middle of the frame, so the picture is composed round it: the sun stands in
the middle of the free space on the card's left (the world reads the live card rect), its crown
fills that space and its equatorial wing reaches toward the board; on a screen too narrow to leave
any space beside the card (a phone held upright), a smaller sun stands above the card instead.

## The one idea

**The board dresses the black sun.** Every locked piece raises a prominence on the sun's limb, in
the piece's own colour: the board's columns are laid over the top of the sun, left column on the
left limb, so the crown records where the pieces fell. A clear sends Baily's beads racing round
the limb and flings the oldest prominences off into the corona. Four lines bring the diamond
ring. And a chain of clears is a longer exposure: the camera sees further into the outer corona,
the faint stars come out and earthshine lights the moon's face, the way a real eclipse
photograph does.

## Event language

| Event | What happens |
|---|---|
| Lock | A mote of the piece's colour leaves the card's edge at the piece's height and eases along a bowed path to the limb, where a prominence of that colour rises in under a second: an arch of three strands with knots flowing along them, or a ragged hedgerow of threads. The limb keeps twelve; each stands about half a minute, then fades. |
| Hard drop | A taller, wider arch, a brighter mote, a jolt of the lens and a kick of the fringe. |
| Clear | A necklace of beads, one per line, races round the black sun; the chromosphere flashes; the corona swells; the two oldest prominences per line ERUPT: each lifts off the limb, twists and tears into blobs and is flung out through the corona within two seconds. With none held, white jets run out instead. |
| Four lines | The diamond ring: the moon slides off until the photosphere breaks through one lunar valley on the card's side; a brilliant bead with a modest starburst, a ring of beads, daylight flooding back into the air, the lens breathing; then the moon slides back and totality returns. Half a second later a coronal mass ejection leaves the limb into the open sky (up and to the right beside the card, sideways over it): a bubble that blows the corona's own rays outward. Every held prominence erupts with it. |
| Perfect clear | The four-line show, with a larger flash, a stronger diamond and a second, six-bead necklace. |
| T-spin | The corona twists: the rays wind into a spiral that is strongest at the limb and unwinds outward, the prominences swept round with it, then rings down over about two seconds. |
| Chain | The exposure lengthens: the outer corona and the streamers' wings reach further, the faint stars come out, earthshine shows the moon's maria. It closes slowly when the chain breaks. |
| Level up | The light turns one step (and the solar cycle with it), the chromosphere flashes all round the limb and two beads run round it. |
| Clock alone | The light turns one step every 100 s, whatever the level, resting 15 s at each end (so it is on its way 70 % of the time); the solar cycle rides the same wheel, so the corona's shape changes too. The sun's axis sways over 260 s and the moon wanders over 83 s and 131 s, so the chromosphere's sliver creeps round the limb. |

The palettes, in hue order round the wheel: **ember** (amber horizon, indigo shadow, the quiet
sun's long wings), **gold**, **jade**, **azure** (an icy horizon, the round crown of solar
maximum), **violet**, **rose**. Each palette carries where the solar cycle stands, so a session
watches the corona change from the two long wings of a quiet sun to a crown of streamers and
back. Neighbours' glow and band colours are staggered by a family so a blend never passes
through grey (`solar-eclipse-core.test.js` checks the saturation half-way between every pair).

## How it is built

Everything is one dome and one set of strips:

- `solar-eclipse-sky.js` — the dome round the lens. Each pixel reads the scene in its own
  direction: the air (the dark of the shadow, the band beyond it, the bright rim at the horizon,
  daylight for the diamond), the planets and the exposure's faint stars (cells in azimuth and
  altitude), the sun (below), then six crest lines from a baked half-float table, farthest first:
  each darker than the air behind it, mist banked at its foot and rolling along the valley, its
  crest rimmed by the light behind; the farthest is the sunlit range beyond the shadow, its snow
  catching the light on the faces turned toward it. Every exponential is bounded before it is
  masked (a crest rim overflowed far above its range and `mix(sky, Inf, 0)` drew black shapes in
  the sky through a narrower lens).
- `solar-eclipse-sun.js` — the black sun, drawn in the lens's IMAGE PLANE in solar radii (so it
  is a true circle on any screen; a gnomonic disc about the sun's own direction was an upright
  ellipse at the top of a phone's 74° frame). The corona is a dipole field: a point at radius r
  and latitude λ lies on the field line whose foot is `acos(cos λ / √min(r, 2.5))`; below the cusp
  `acos(1/√2.5)` the lines close (two helmet bulbs on the equator, their arches nearly smooth),
  above the source surface they run straight out. Fine rays are two octaves of the baked noise
  read along that label (north and south of the current sheet from two rows, blended across it),
  slowly drifting; a broad warp of the label varies with `min(r, 2.5)` only, so rays stay
  straight beyond it; slow puffs drift outward along the lines. The stalks fall off as `r^−1.55`,
  so the wings reach out; ten extra streamers rise one by one as the cycle climbs toward
  maximum. Then the chromosphere (a thin pink skin with spicules), the prominence table (a Loop
  over twelve rows; arches, hedgerows and jets, each eruption a wobble of its own frame, a lift,
  a tearing and a fade), a CME (a bubble that multiplies the corona's own light, so it wears its
  rays), the moon (its limb notched by lunar valleys where beads break through; earthshine
  with maria on its face), the bead necklace and the diamond's glare.
- `solar-eclipse-fx.js` — the motes: instanced strips laid along the great circle from the card's
  edge to the limb, bowed, eased in, with a rounded nose; replayable from the clock.
- `solar-eclipse-world.js` — the state: the composition (the sun stood in the card's free space,
  its size a set share of the frame), the prominence table, the moon's wander and slide, the
  exposure, the twist, the palette wheel, and what the post is asked for (flash, kick, bloom
  boost, the iris on the diamond, the lens breath, and the MOON MATTE: the moon's disc on screen,
  inside which the post holds the bloom off, so the inner corona's glare never greys the black).
- `solar-eclipse-core.js` — the numbers, CPU only: frames, the ranges' bake, the corona's field
  constants and streamer set, the moon, the palettes and their wheel, the exposure curve, the
  board-to-limb mapping, the prominence shapes.
- `solar-eclipse-post.js` — one scene pass, a max-channel bloom (Medium and up), one output pass:
  lens breath, fringe, calm zones over the card and HUD, the moon matte, exposure, a
  hue-preserving filmic tone map, grade, vignette, grain and dither.
- `solar-eclipse-theme.js`, `-director.js`, `-composition.js` — the lifecycle, the renderer
  (WebGPU, else its WebGL2 backend), the gameplay intake (the true combo, several boards), the
  layout watch, settings, reduced motion and device-loss recovery, as in the sibling rebuilds.

## Tiers

Every tier keeps the whole picture and every event (`solar-eclipse-quality.js`):

| Tier | Corona rays | Outflow | Prominence threads | Sunlit range's snow | Valley mist banks | Exposure stars | Motes | Bloom |
|---|---|---|---|---|---|---|---|---|
| Minimal | 1 octave | — | — | — | — | — | 8 | — |
| Low | 1 octave | — | yes | — | — | yes | 10 | — |
| Medium | 2 octaves | yes | yes | yes | — | yes | 12 | yes |
| High, Ultra, Extreme | 2 octaves | yes | yes | yes | yes | yes | 14–16 | yes |

The pixel-ratio cap rises with the tier (0.7 → 1.6), as in the sibling themes.

## Reproduce

Playground: `/playground.html?effect=solar-eclipse&t=14&quality=High&board=1`, plus
`event=lock|drop|clear|quad|tspin|perfect|levelUp`, `eventAge=`, `lines=`, `u=`, `row=`,
`color=`, `combo=`, `locks=`, `clears=`, `level=`, `parts=sky,motes`, `noPost=1`,
`falseColor=1`, `px=`/`py=`, `reduce=1`, and `icon=1` (`iconFov=13`, `iconYaw`, `iconPitch`).
`t=14` lies in the rest of the level's own palette; a later `t` shows the clock's drift.

Real game: `?eclipseTime=<s>` (frozen), `?eclipseFixedDt=<ms>`, `?eclipseParts=sky,motes`,
`?eclipseFalseColor=1`, `?eclipseForceWebGL=1` (or `?forceWebGL=1`). The theme needs
`unlockAll=1` in a fresh profile.

The icon: `t=14&quality=Ultra&icon=1&iconFov=30&iconPitch=-0.13&locks=10` captured square,
centre-cropped full and baked to a 512 px circle with contrast 1.16 and saturation 1.3.

## Verification

All on 2026-10-11, on the feature tree (origin/main 489105cf plus this change):

- **Unit tests:** 139 new tests in four files: `solar-eclipse-core.test.js` (26: frames, the
  ranges' bake, the corona's field, the moon covering the photosphere at rest and uncovering it
  for the diamond, palettes that never blend through grey, the chain, the board on the limb),
  `solar-eclipse-world.test.js` (33: composition beside and above the card, a round sun on a
  phone, locks, eruptions, jets, the diamond and the CME aimed into free space, the twist, the
  exposure, the clock-driven light and cycle, replay after a seek), and the director and theme
  tests ported from Starlight (80). The whole suite (`--maxWorkers=5`, long timeouts, run alone): 814 of 816 files and 15 250 tests green; the two red files fail the same on untouched main on this machine (`odyssey-level-briefing`: the Swedish number format; `tts-recorder-e2e`: Windows refuses its symlink).
- **Every CI gate:** typecheck, ts-ratchet, the lint ratchet (count shrank, 807 → 614, baseline
  left alone), architecture fitness (shrank), the theme lifecycle audit, dependency boundaries,
  the palette gate, perf budgets, the build with the boot-closure guard, ip-strings,
  pages-artifact and release gates. ESLint is clean on every file of the change.
- **Shaders without a device:** both backends' graphs built in Node at High and Minimal (no
  TSL warnings); the sky's fragment is about 41 KB of WGSL.
- **Playground:** about a dozen rounds on the RTX (WebGPU), the first on SwiftShader (the WebGL2
  backend), every event, every palette, every tier, phone portrait, 4:3 and 21:9; consoles clean.
- **Real game** (the dev server, theme pinned, real hard drops from the keyboard, clears, a
  chain, four lines and a level-up through the app's own bus): WebGPU on the RTX at 132 fps
  and the WebGL2 backend at 127–128 fps (the display's rate), the AMD integrated GPU at
  132 fps (an observation, not a measurement); a quality change mid-session rebuilds in place
  and keeps the clock and the light (gold at turn 0.51 before, 0.75 eleven seconds later); the
  clock-only strip below (level 1 and no clears in every frame, `eclipseFixedDt=100`) moves
  ember → gold → jade and the solar cycle 0.12 → 0.95 in under five minutes of theme time.
- **`validate-all-themes --theme solar-eclipse`** against a preview of the build: PASS (0
  lifecycle failures, 0 console errors); its screenshot and result replace the old ones in
  `docs/theme-screenshots/`.
- **Phones:** `validate-mobile-webgl2 --theme=solar-eclipse` at Low and Minimal: pass, and its
  screenshots were read (the diamond's broad glow greyed the moon there; tightened).

Not verified: a perf-lane reading (ADR-0016); a real phone; multiplayer, Infinity, meditation
and Odyssey layouts; anyone watching it move for minutes. The icon and the palettes' pace are
the author's picks.

## Captured previews

- `solar-eclipse-captures/events.jpg` — lock, hard drop, bead necklace, eruptions, the diamond
  ring, the CME, a T-spin, a chain, a level-up.
- `solar-eclipse-captures/palettes.jpg` — the six palettes at their rest (`level=1…6`, `t=14`).
- `solar-eclipse-captures/clock-ingame.jpg` — the clock alone in the real game, level 1.
- `solar-eclipse-captures/tiers.jpg` — Minimal to Extreme.
- `solar-eclipse-captures/aspects.jpg` — phone portrait, 21:9, 4:3.
- `solar-eclipse-captures/ingame.jpg` — the real game: at rest, after hard drops, in a chain,
  the diamond.
- `solar-eclipse-captures/icon.jpg` — the old icon, the new one, and two alternatives.
