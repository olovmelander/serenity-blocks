# Chromatic Impasto — the canvas the board paints

Implemented 2026-10-08 on `feature/chromatic-impasto-masterpiece`, with Three.js 0.186.1. A
from-scratch rebuild: it replaces the earlier theme in full (a 2D WebGL fluid simulation drawn as
glowing smoke on black, with its `ChromaticImpastoSimulator`). The theme keeps its identity — thick
oil paint, bold tube colours (blood red, cadmium yellow, turquoise, ultramarine), strokes that swirl, a canvas the
game paints on, the whorl a chain of clears stirs — and everything else is new. This document
records the shipped design and what was verified. It is a reference, not a backlog.

## The picture

One canvas fills the frame, seen square on, as an action painter sees the cloth on the studio
floor. It is painted in thick oil: every bristle of the brush leaves a track, every stroke has
rails where the paint was squeezed to its sides, a pool where the brush came down and a lip where
it pushed the paint to. A lamp stands low on the upper left, so the relief is raked: ridges throw
shadows across the paint beyond them and carry the lamp's window in their wet skin, with a cooler
light from the lower right on their other flank. Where the paint is thin the linen shows.

The picture is a current: one great whorl turns round the board, smaller ones turn in the open
cloth to either side, each against its neighbour, and most strokes follow it. It is blocked in
while the theme starts, the way a painter blocks a canvas in (the darks in broad flat passes, then
a few bold colour masses, the black contour drawn round every form, the lights last),
and the painter never quite stops: every few seconds one more unhurried stroke goes on somewhere.

![The canvas at rest](chromatic-impasto-overhaul/rest.webp)

The gameplay card hangs in front of the middle of it. Most of the canvas stays deep in tone on
purpose: what is bright counts, and everything the game lays on top has headroom.

![In the game](chromatic-impasto-overhaul/in-game.webp)

## The one idea

The board is the brush. Nothing the game does is a light effect laid over a backdrop: every
response is paint, laid on the canvas in the piece's own colour, and it stays. The picture at the
end of a game is the picture that game painted.

## Event language

| Event | Response |
| --- | --- |
| Piece lock | One stroke of the piece's colour leaves the card's side at the piece's height, drawn out thin and pressed down as it goes, and bends into the current. It is streaked with the colour of the piece before it, picked up wet. How far it reaches differs from lock to lock, so paint is laid near the board and far from it. A few drops fly off its tip and land as dots. For two seconds the new paint is at its wettest, and the eye finds it. |
| Hard drop | The same, harder: the stroke is a slab laid with the knife, driven out of a splat (a crater with a thrown rim and its spatter), and a fan of paint is thrown into the air. The camera is nudged. |
| Line clear | Each cleared row leaves the card as a loaded brush, one each way, from the card's side to the edge of the cloth at the row's own height, in the colours of the last pieces laid, running dry as it goes. Paint flies off the brush where it leaves the card, and a ring of wet light crosses the canvas from the board. (A tall frame has no cloth beside the board: there the rows leave from under its foot and over its top, both ways from the middle.) |
| Combo | From the second link every link turns the canvas a notch round the board, a little further each time: the wet paint is stirred into the arms of a whorl, and what was stirred stays stirred when the chain breaks. (A notch a link, not a speed: a chain of nine winds the paint less than a turn, into arms and never into thread.) Every link also draws arcs round the board, more and longer as the chain grows, and throws paint off them with the turn; from the fifth link one arc of each link is fluorescent paint (brightest while it is wet), from the eighth it is gold. The lamp brightens and lifts, and the whole canvas gets wetter. |
| Four lines | The studio holds its breath: a fifth of a second of near dark. Then four rows sweep out, paint is flung from behind the board in every direction (heavy throws that taper into drops, great splats, a hundred and more drops in the air), and gold leaf is laid round the card in a ring. Each four-line clear of a game lays its ring outside the last: the board ends the game in the frame it earned. |
| Perfect clear | All of that, with a second ring and two great arcs of white and gold wound round the board. |
| T-spin | The canvas turns a notch on its own, and three arcs are drawn round the board. |
| Level up | A new period: the painter goes over the picture in other tubes. Five, cycled: nordic, the Fauves, a nocturne, earth and fire, spring. |
| New game | The canvas is scraped down with the knife and blocked in again, in the first period. A game that ends keeps its painting until then. |

Combo here is the true consecutive-clear combo (one `ComboTracker` per player in
`ChromaticImpastoDirector`); the bus's `COMBO` event is cascade depth (ADR-0011). With several
boards on screen each lock is laid beside the cards' union at its own board's height, and the
canvas turns to the longest chain any board is holding.

![A lock, a hard drop, two lines, a chain of five, four lines, a chain of nine](chromatic-impasto-overhaul/events.webp)

## How it is built

| File | Role |
| --- | --- |
| `chromatic-impasto-core.js` | Three-free constants and maths: the frame, the relief, the periods' tube colours, the flow field, the twist's profile, the chain's rates. |
| `chromatic-impasto-strokes.js` | Three-free: a stroke as a ribbon (path, width, load, time), and the piece of it a frame emits. |
| `chromatic-impasto-painter.js` | Three-free: the log of everything laid, in order, and the cursor through it. |
| `chromatic-impasto-gestures.js` | Three-free: what is painted — the underpainting, a lock, a row, a splat, the burst, the gold, the arcs, the scrape, the painter's own strokes. |
| `chromatic-impasto-tsl.js` | Hashes, value noise, the weave, the lamp's soft box, the twist as the shaders read it. |
| `chromatic-impasto-canvas.js` | The paint on the GPU: two half-float targets, the stamp shader, drying, the bake. |
| `chromatic-impasto-surface.js` | The painted surface as the eye sees it: relief, parallax, raked shadows, wet gloss, gold, cloth. |
| `chromatic-impasto-fx.js` | Thrown paint and its shadows; dust in the lamp. |
| `chromatic-impasto-world.js` | Owns the uniforms, the parts, the camera rig and the choreography. Shared with the playground effect, so what is iterated there ships. |
| `chromatic-impasto-director.js` | Renderer-free: stages bus events per player and resolves one lock and one clear per frame. |
| `chromatic-impasto-composition.js` | Three-free: reads the live card, board and HUD rects and maps board columns and rows onto the screen. |
| `chromatic-impasto-post.js` | One scene pass, bloom, and one output pass. |
| `chromatic-impasto-quality.js` | Content tiers. |
| `chromatic-impasto-theme.js` | Lifecycle, renderer selection, settings, layout watch, GPU-loss recovery, capture flags. |

Techniques worth knowing before changing it:

- **One node renderer on both backends.** `WebGPURenderer` on WebGPU, its WebGL2 backend
  otherwise (or `?forceWebGL`). There is no `ShaderMaterial` and no compute.
- **The log is the painting; the GPU is a cache.** Every stroke is a record: a path, a width, a
  load of paint, two colours, a start time and a duration. Each frame the painter emits, for
  every stroke under way, the piece of ribbon between where its brush was and where it is now.
  The pieces partition the ribbon exactly (they share their cut edges, and a cut inside a segment
  lies on the segment's own sides), so every texel of a stroke is composited once whatever the
  frame rate: a test proves the same paint at 30 and 240 frames a second. Replaying the log lays
  the same painting again — for a capture (`seek`), at a new size after a resize (out of sight,
  see below), and on a new world after a quality change or a lost GPU (the theme hands the log
  over).
- **A stroke is drawn, not simulated.** There is no fluid solver. The stamp shader lays, inside
  each piece of ribbon: bristles in clumps (a slow value across the stroke), a shallow track on
  every bristle with a deep one here and there, rails at the sides, a pool at the touch-down and a
  lip at the lift-off, a second colour carried on some clumps in bands that break and rejoin,
  bristles that run dry one by one toward the end, a frayed lift-off, and thin paint that catches
  only the high places of the cloth. A knife is the same shader with flat tracks, clean edges and
  tall rails; a splat is a crater with a thrown rim; a drop is a bead. Each piece of ribbon is a
  quad drawn as two triangles, and seldom a parallelogram (a bend's outer side is longer, a
  swelling or lifting brush makes the sides converge), so its corners carry what is affine in the
  segment's own frame: the distance across the segment's chord, and the arc length and half-width
  at the corner's place along it. Interpolation then gives the stamp exact coordinates in both
  triangles. Before 2026-11-27 the corners carried only "left edge, right edge, arc length here",
  each triangle interpolated its own map, and every bristle track kinked at the diagonal into a
  sawtooth a piece long, read as "stair-steps" on thick strokes' edges.
- **Two targets, no read-back.** `pigment` holds the colour on top and how wet it is; `relief`
  holds how thick the paint stands and what it is made of (gold leaf above zero, fluorescent
  below). Pigment is composited "over". Relief keeps a share of what is underneath (the blend's
  alpha is what the old relief loses), so paint laid on paint piles up. Nothing reads a target
  while writing it, so there is no ping-pong, and a canvas nobody is painting on costs nothing:
  no pass runs but a drying step four times a second, by blending alone, for a minute after the
  last stroke.
- **The relief is lit, not faked.** The surface normal is the gradient of the paint's height.
  The view ray is followed up to the paint's surface (two steps), so thick paint stands off the
  cloth and shifts against it as the camera drifts. The height is marched toward the lamp (eight
  taps, the penumbra widening with distance) for the shadows ridges throw. Oil is a dielectric:
  it mirrors a soft box with glazing bars where a facet turns the lamp's window to the eye, and a
  second, cooler box opposite. Gold has no colour of its own, only reflection.
- **The twist is a rotation the display reads the paint through.** Each link of a chain moves a
  target angle on a notch and the canvas eases after it; one rotation is found per fragment
  (most at a ring just outside the board, none under it and none past its reach) and every
  neighbouring tap is carried through its linearisation, so the relief of the turning paint is
  lit correctly. A stroke begun then is laid through the twist (and the angle is kept on it, so
  a replay lays it in the same place). A broken chain leaves the canvas turned; the next chain
  turns it further. Only when the angle has wound far enough (and when a game ends, the board
  moves or the frame changes shape) is the twist baked: the paint is resampled through it into
  the spare pair of targets, the pairs swap, and strokes still under way are carried back. The
  bake is a log entry like any other. How far the stirring reaches is chosen while the canvas is
  untwisted and held until the bake, so a longer chain reaches further after its next bake and
  never drags paint that is already turned.
- **A bake resamples with Catmull-Rom, in five bilinear taps.** A long game bakes dozens of
  times; bilinear would melt the bristle tracks a little more each time. Where nothing is
  twisted every weight but one is zero and the texel is copied exactly, so only stirred paint
  softens, slowly, as stirred paint does. Past its edge the cloth mirrors itself, so a twist
  that reaches past it turns paint into view, never one edge texel smeared into a streak.
- **A facet mirrors the lamp's window whole; a flat pool of paint takes a share of it.** Mirrored
  whole by flat wet paint, the window lays one grey veil over the side of the canvas the lamp
  stands on (it did, in the game, on a four-line clear at the end of a chain). For the same
  reason the lamp brightens with a chain but does not climb.
- **A render target's v = 0 is its top row, on both backends.** Paint drawn with a y-up camera
  and looked up with a y-up coordinate comes out upside down, silently. One helper
  (`ciCanvasUv`) turns a canvas point into a target coordinate for every lookup and for the
  bake.
- **Thrown paint is closed form.** A drop's whole flight is a function of the world clock
  (gravity is toward the cloth, which lies flat under the eye), so the pool is never stepped, and
  where and when each drop lands is known when it is thrown: the world schedules its dot then.
  Every drop throws a shadow on the paint beneath it, away from the lamp.
- **HDR, single output.** The scene is scene-linear; a max-channel knee selects what blooms (no
  MRT), and one output pass does the lens fringe, the calm zones on the card and HUD (what shows
  through them is dimmed and drained of colour: the pieces are made of the same pigments as the
  painting behind them), bloom, a hue-preserving filmic curve, grade, vignette, grain and dither.
  `usesMrtScenePass()` is false.
- **No MaterialX noise.** Hash-without-sine value noise; every shared `Fn` carries `setLayout`
  and is pure. Values hashed per stroke are integers.

## Tiers

| Tier | Paint texels per pixel (height cap) | Underpainting | Parallax steps | Shadow taps | Wide occlusion | Weave relief | Drops | Dust | Bloom |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Minimal | 0.7 (720) | 60% | 0 | 0 | no | no | 96 | 0 | off |
| Low | 0.85 (900) | 75% | 0 | 3 | no | yes | 160 | 0 | off |
| Medium | 1.0 (1,152) | 90% | 1 | 5 | no | yes | 256 | 28 | on |
| High | 1.2 (1,408) | 100% | 2 | 8 | yes | yes | 384 | 44 | on |
| Ultra | 1.35 (1,664) | 110% | 2 | 10 | yes | yes | 512 | 60 | on |
| Extreme | 1.5 (1,920) | 120% | 3 | 12 | yes | yes | 640 | 76 | on |

The lens fringe is High and up.

**A resize keeps the painting (2026-11-27).** The display reads the paint in canvas units, so the
texture shows correctly at any window size, and nothing touches it while the window moves: the
surface covers the new frame at once, with the paint mirrored in the cloth's edge where a wider
frame reaches past it. Once the window has held its size for 0.35 s the paint follows. A texture
that covers the frame at near the resolution it asks for, or finer, is kept as it is (the paint
never loses resolution: a window made smaller shows the same paint, and one made larger again
finds it waiting). Otherwise, while the log holds the whole painting it is laid again at the new
size out of sight, nine thousand quads a frame at most, and shown once laid; the old painting
stays on screen until then, and a twist bake asked for meanwhile waits for it. The log holds
five thousand entries, and a longer game lets go of its oldest strokes (the underpainting first):
its paint is resampled into the new size instead, since a replay could no longer lay it. The
picture is never composed afresh for a new shape: a frame wider than the underpainting reached is
blocked in at the sides only, in the same layers and tubes, each stroke cut where it reaches the
paint already there (`composeUnderpainting({ beyond })`), in its place in the log when the
painting is about to be laid again, else live over 1.6 s. Before this, every change of shape threw
the underpainting away and blocked in another picture, any change at all wiped the canvas and
laid it again over several frames in view, and in a long game that replay of a trimmed log left
the cloth all but bare. (Since paint can now be finer than the screen, the surface reads the
relief's slope no finer than 0.8 of a pixel; at every tier's own resolution the texel still
decides, and the frame is unchanged: playground captures on WebGPU, WebGL2, Minimal and a phone
frame match main pixel for pixel.)

## Assets

None. The painting is generated: no texture, no model, no font. Blender was not needed — there is
no object in the scene to model; the relief is the paint's own height field, and every stroke is a
few dozen quads built from its path.

## Verification

- Unit tests: 141 new tests in four files (core maths, strokes, painter, gestures and tiers 36;
  director 19; world 32; theme 54), and the shared teardown matrix, where Chromatic Impasto's
  entry was rewritten for the new class. They prove, among other things, that a stroke's pieces
  partition its ribbon exactly at 30, 60, 144 and 240 frames a second, that a rewound log lays
  the same quads, that a stroke begun under a twist is laid the same way on a replay and comes
  before the bake that followed it, and that the world lays the same paint at 30 and at 240
  frames a second. Whole suite, on `main` as it stood at the merge: 707 files, 9,814 tests, one
  failure, which is the build machine's and not this change's: `odyssey-level-briefing.test.js`
  expects `250,000` and a Swedish locale writes `250 000`; it fails the same way on untouched
  `main`.
- Gates: typecheck, TypeScript ratchet, lint ratchet (779 errors against a baseline of 807; the
  baseline was left as it is), architecture fitness, theme lifecycle audit, dependency
  boundaries, performance budgets, production build with the boot-closure guard (the theme's
  chunk is 89 kB, 33 kB gzipped), IP-string gate, Pages artifact check and release gates all
  pass. The palette gate fails on `main` and here for the same unrelated reason (Stillwater);
  Chromatic Impasto's piece colours are unchanged and score 5/7 on it.
- A second, independent read of the code found twelve defects, none a
  crash; ten are fixed with tests (a bake logged after paint it had preceded, a bake applied to
  a half-laid replay, a reshape measured against the previous size instead of the painted one, a
  new game's start lost during a rebuild, a stale twist handed to a rebuilt world, the stamp
  buffer uploaded whole on every flush, gold rings not starting over with a new game, cleared
  rows painting nothing on a tall frame, a stroke too short to finish, a missing guard). Two
  stand as they are: paint laid over gold leaf keeps a share of its metal (the relief's blend
  carries both), and where two strokes drawn at the same moment cross, a replay may put the
  other one on top (their places are the same).
- Playground captures on WebGPU (RTX 3070 Laptop), High: rest with and without the board; a lock
  and a hard drop; clears of two and three lines; held chains of three, five and nine; four
  lines early and late; a perfect clear; a T-spin; a level-up in progress; a new game's scrape;
  all five periods; reduced motion. Also Ultra and Extreme; Minimal; Low and High on the forced
  WebGL2 backend (with a baked twist); and a 430 x 932 portrait frame at Medium at rest and
  through a hard drop, three lines, a chain of five and four lines. No console errors or
  warnings in any of them.
- In the real game (Electron, dev server, single player): the theme starts on WebGPU, aims its
  events at the live board, takes bus-injected hard drops, clears, a chain and four lines, keeps
  its painting through a live quality change (High to Medium: the same log, laid again on the
  new world) and lets go of its canvas when another theme takes over, with no console errors or
  warnings.
- Frame rate was observed, not measured: the machine was shared with about ten other sessions'
  GPU and CPU jobs. Readings of the whole game at 1584 x 813 on the RTX 3070: about 128 frames a
  second at High, median frame interval 7.7 ms at rest and through the events, 99th percentile
  9 to 22 ms, no frame over 66 ms in any run.
- Mobile WebGL2 emulation (`scripts/validate-mobile-webgl2.mjs --theme chromatic-impasto`, a
  390 x 844 phone viewport in Chromium, Low): pass in portrait, through its effects and in
  landscape, on the node renderer's WebGL2 backend. The theme was added to that script's list
  of node scenes. This is browser emulation, not a phone.
- The hub-driven lifecycle validation (`scripts/validate-all-themes.mjs --theme
  chromatic-impasto`) did not pass and says nothing about the theme: it stops at
  `theme-card-selection-started`, before the theme is involved, with `unlockAll=1` in its URL
  and without. The hub's card click now goes to the collection view first (the Odyssey theme
  collection landed on `main` the same day) and the script still expects the click to start a
  selection. The same ground is covered above by the in-game run, which switches themes through
  the theme manager.

Not verified: GPU cost per tier through the theme perf lane (ADR-0016); an integrated GPU;
physical phones; local multiplayer and Infinity layouts in a capture (their routing is
unit-tested only); sessions of several hours. `docs/theme-screenshots/chromatic-impasto.png`
still shows the previous artwork; `scripts/capture-theme-screenshots.mjs` writes it during a
fleet capture.

## Reproduce

Run `npm run dev:playground`, then:

`/playground.html?effect=chromatic-impasto&t=12&quality=High&board=1`

Add `event=lock|drop|clear|quad|twist|perfect|levelUp|fresh` with `eventAge=<s>`, and `combo=<n>`
(held for `comboHold=<s>`), `locks=<n>` (play n locks first), `level=<n>`, `lines=<n>`,
`u=<0..1>`, `row=<n>`, `color=<hex>`, `seed=<n>`. `demo=1` (without `t`) plays a looping script.
`parts=` draws only the named parts; `falseColor=1` bands the pre-tone-map peak; `noPost=1` shows
the raw scene; `forceWebGL=1` uses the WebGL2 backend; `icon=1` is the icon's lens. In the game:
`?chromaticImpastoTime=`, `?chromaticImpastoFixedDt=`, `?chromaticImpastoParts=`,
`?chromaticImpastoFalseColor=1`.

The theme icon is the whorl a chain of nine has stirred, with its gold arcs, through the
playground's icon lens
(`/playground.html?effect=chromatic-impasto&t=26&quality=Ultra&icon=1&iconX=0&iconY=0&iconZoom=1.15&locks=8&combo=9&comboHold=10`
in an 800 x 800 window), given a colour lift (contrast 1.1, saturation 1.15, brightness 1.03) and
baked as a 512 px circle. The same file is kept at
`public/assets/themes/chromatic-impasto-theme-icon.png`. (The file it replaces was a JPEG under a
`.png` name.) Superseded 2026-10-23 by the plain square frame of the painting ([THEME_ICON_AUDIT_2026-10-23.md](THEME_ICON_AUDIT_2026-10-23.md)).

## Captured previews

![The paint, close](chromatic-impasto-overhaul/close.webp)

![In the game: at rest, a hard drop, two lines, four lines](chromatic-impasto-overhaul/in-game-events.webp)

![Minimal, Low on WebGL2, and the other four periods](chromatic-impasto-overhaul/tiers.webp)

![Portrait: at rest, three lines, a chain of five, four lines](chromatic-impasto-overhaul/portrait.webp)

## The light pass (2026-10-21)

The owner asked for better visuals, effects, atmosphere and graphics. The canvas read as an
evenly lit photograph of plastic paint: the lamp lit every corner the same, each stroke was one
flat tube colour, and the gold leaf of a four-line clear or a long chain came out as pale beige
tubing. This pass makes the studio and the paint more physical.

![Before and after](chromatic-impasto-overhaul/light-before-after.jpg)
*Before (left) and after (right): at rest, four lines at 1.5 s, a chain of nine
(`t=40&quality=High&board=1`).*

![The paint and the gold leaf, close](chromatic-impasto-overhaul/light-close.jpg)
*The same through the icon lens, close: the paint, and the gold leaf of a perfect clear.*

- **A lamp, not the sun.** The lamp stands 3.9 canvas units off the canvas's centre (the frame is
  two units tall), beyond the upper left, and its light falls off across the cloth as
  1 / distance^1.6 (1 at the centre): the corner nearest it is lit warm and full, the far corner
  sinks toward the room's cool fill, and the rays meet the cloth lower the further they travel,
  so the relief rakes harder there. Only the diffuse light and the lamp's own highlight fall
  off; the window mirrored in the wet skin is still found from the canvas's centre (a per-point
  direction moved its reflection onto the flat paint next to the lamp, a grey veil over that
  corner). The drops' shadows keep the centre's direction too.
- **Broken colour.** Paint loaded from the palette is never mixed through: groups of bristles
  carry it lighter (white worked into it) or deeper, in streaks that run along the stroke and
  break off, each stroke mixed more or less carelessly (a knife drags its colour in broader
  bands), and the paint pushed up into the rails reads deeper. White goes into the colours, not
  the darks: a navy or a deep green worked lighter is the same dark lifted, not chalk.
- **Coloured shadows.** Oil paint is a little translucent: the lamp's light scattered inside a
  ridge leaves the shadow it throws faintly lit in the paint's own colour, deepened (albedo²),
  instead of a grey hole.
- **Gold leaf.** Laid in leaves (0.062 units a side) in courses offset by half a leaf, each leaf
  pressed down at its own tilt and crinkled, its edge overlapping the next as a seam, the red
  bole showing where the leaf has cracked. The leaves are placed in paint coordinates, so they
  turn with the paint when a chain stirs it. Gold mirrors a warm studio: under the eye a flat
  leaf mirrors the ceiling over the canvas, which the lamp lights from its side, so leaves tipped
  toward the lamp shine and leaves tipped away go umber; the lamp itself is a broad lobe in the
  crinkles. The mosaic of bright and dark leaves glitters as the lamp wanders. Only gilded
  fragments run the leaf (`If(metal > 0.001)`): run everywhere, it cost a quarter of the frame
  on an integrated GPU.
- **Dust in the lamp's beam.** The camera is focused on the paint: motes low over it are fine
  points, the few that hang near the lens are broad, faint discs with a brighter rim (the blur
  disc is aperture × height / focus distance, capped on screen at 0.05 units so a phone frame
  holds no coin-sized discs). Each is lit only while it is in the lamp's beam (a soft cone toward
  the canvas's middle) and more brightly nearer the lamp, in a warmer light than the lamp's white,
  and none drifts over the board's card. Medium and up, as before.

**Cost.** GPU time per frame from timestamp queries, the original against this pass, medians
of 120 frames: RTX 5080 Laptop at 2560 × 1600, High 0.79 → 0.85 ms and Extreme 0.98 → 0.98 ms;
the laptop's integrated Radeon at 1600 × 900, Low 11.9 → 12.6 ms and High within noise (other
sessions shared the GPU and moved readings by ±2 ms). In the real game at High: about 177 fps.

**Verification.** Playground on WebGPU at Minimal, Low, High and Extreme, the WebGL2 backend
(four lines), a 430 × 900 portrait frame at rest and through four lines, and the real game
(menus, board, HUD, hard drops), consoles clean apart from Electron's own notices. A new shader
gate, `tests/unit/chromatic-impasto-shaders.test.js` (Kaleidosonic's harness), builds every
material the world draws, every pass of the paint canvas (both stamps, fill, dry, both bakes) and
the post's output through the WGSL and GLSL node builders at High, Minimal and Extreme, and fails
on a warning, a throw, a stage over 64 KB, MaterialX noise, equal smoothstep edges, a NaN literal,
a var read before it is assigned, or a laid-out `ci_*` helper that closes over a uniform or a
texture. All five Chromatic Impasto test files pass.

## Brushwork, composition and gameplay, November 2026

The baseline had a strong idea worth keeping. A lock borrows pigment from the previous piece,
and the marks the player makes survive on the canvas. The warm raking lamp, cool fill and relief
shadows already gave those marks weight. At playing distance, repeated square ends, parallel
rails and isolated bright dabs made the brushes look mechanically cut. Cream occurred mainly
in short dashes. Pale motes looked flat. Counting nearly identical row sweeps was the main way
to tell a single, double and triple apart. The older playground mock also hid how the theme
actually read behind the solo well.

![Old and revised brushwork at the same time, framing and magnification](chromatic-impasto-overhaul/november-comparison.webp)

### Oil, light and linen

The brush rolls onto its shoulder, widens under pressure and lifts to a fine end. Its bristles
splay in tufts. More oil collects on one edge, which catches a stronger reflection. The relief
target carries the local oil content in its blue channel, so a wet, smooth knife cut can cross a
coarser brush pass under the same lamp. The dark lay-in includes dry strokes of coloured
underpaint. In the spaces between them, individual flax threads cross continuously and soften
as their spacing approaches a screen pixel. Cream beads reflect the window above a shaded
underside. Thrown drops stretch at launch, gather at the top of their flight and leave a spot
where they land.

### How a painting develops

Two large curls anchor the exposed cloth. Each starts with a deep colour, picks up a second
tube on its shoulder, then receives a light edge. Between locks, the painter revisits one bend
three times to build it up, makes a free mark and moves on. The five periods have different
brush movements as well as different pigments. Nocturne coils tightly in ultramarine and yellow.
Ember opens into lower sweeps of vermilion and ochre. New layers go down in sequence while the
previous painting remains visible. A finished round receives an ivory signature and holds its
composition until play starts again.

![Fauve, Nocturne, Ember and Spring at playing distance](chromatic-impasto-overhaul/november-periods.webp)

### What the player paints

| Moment | Mark |
| --- | --- |
| Lock and hard drop | A lock pulls a brushstroke of the piece's pigment. A hard drop presses a knife into the cloth, with the impact and thrown paint scaled to the fall distance. |
| Single, double and triple | One rising wrist flick, two crossing ribbons, or a three-blade fan. Each leaves from the cleared rows. |
| Four lines | A brief hush, four loaded rows, radial throws and a wreath of overlapping gold leaves. |
| Twist | A turn without a clear leaves a small three-colour thumbprint in open cloth. A clearing twist winds long strokes back toward the board. |
| Cascade and back-to-back | A cascade leaves a skipping succession of shrinking paint impacts. Consecutive difficult clears leave a pair of hooked gold cuts. |
| Combo and release | Each link draws the canvas further around the well. Fluorescent pigment enters at five and gold at eight. A long chain releases a spreading wet sheen. |
| Perfect clear | A gilded, eight-petal rosette opens beside the well. A delayed perfect-clear notification adds the crown to the clear already in progress. |
| Level, game over and restart | The painter changes tubes and overpaints at a level change, signs the completed round, then scrapes the cloth for a fresh game. |

![Eighteen gameplay moments with the solo well and queue visible](chromatic-impasto-overhaul/november-events.webp)

The solo well has viridian walls and a dark ledger with linen-coloured lettering. The darker
piece pigments were lifted while retaining the theme's shape-to-colour assignments. The centre
of the board stays dark through the strongest events. Reduce Motion holds the airborne ambient
details in place, and Reduce Flashing attenuates the quad's dark-to-light transition.

![Live solo play after four hard drops](chromatic-impasto-overhaul/november-solo.webp)

At 390 × 844 the queue and ledger leave two strips of visible cloth. The row gestures fit their
braids and fans into those strips. Droplet launch velocities are solved for the available space
so each airborne bead and its painted landing agree. Gold leaf frames the ledger together with
the well. [Portrait four-line clear](chromatic-impasto-overhaul/november-portrait.webp)

The live solo test also started with a prepared four-row stack and one open column. A hard drop
through the game input cleared all four rows, emptied the well and produced the eight petals
and gold centre through the game's event director. [In-game perfect clear](chromatic-impasto-overhaul/november-perfect.webp)

### Frame timing and checks

Two isolated production playground builds ran the same 26-second portion of the demo on the
NVIDIA Blackwell adapter, at High, 1280 × 720 and a 30 FPS cap. Each reached 20 locks, seven
clears and one four-line clear. The painter used the same 1643 × 924 targets in both runs.

| 95th percentile | Before | Revised |
| --- | ---: | ---: |
| Frame interval | 34.2 ms | 33.9 ms |
| CPU update and render submission | 1.3 ms | 1.4 ms |
| GPU render timestamp | 0.85 ms | 0.79 ms |

The runs recorded 778 and 779 frame intervals respectively, with 25 resolved GPU timestamps
each. These are desktop measurements. Portrait was exercised through browser emulation.
The revised renderer uses the existing paint targets and droplet pools. Linen shading runs
on exposed cloth, gold reflections on gilded pixels, and period changes skip building the
dark ground strokes that would be thrown away.

The visual checks covered WebGPU, forced WebGL2, Minimal through Extreme endpoints, the five
periods, the event gallery, reduced motion and reduced flashing. The playground consoles were
clear of shader warnings and validation errors. The live game reported Chrome's Windows
adapter-preference notice. The production application built successfully and passed its boot
dependency check. The theme and shared regression suites passed 331 tests.

### Reproducing the review

Run `npm run dev:playground` and open
`/playground.html?effect=chromatic-impasto&board=1&demo=1&maxFps=30` for the animated
sequence. A fixed `t=12` with `event=perfect&eventAge=1.55` shows the opened rosette.
The playground uses the shipping painter, materials, camera and post chain together with the
solo well's stylesheet. The live-game screenshot above comes from an actual round in the game.

## A darker canvas (2026-11-26)

The owner asked for the canvas the paint lies on to be a little darker, with the paint's colours
left alone. The surface shader now tones the bare cloth by `CANVAS_TONE` (0.6), weighted by how
bare it is (the square of its cloth cover, as the weave's own thread colour is), so the mid-brown
linen reads as a deep umber and a stroke thick enough to hide the weave is untouched. Bare cloth
carries no gloss, so the change is a straight darkening of the cloth and nothing else.

Compared at a fixed `t=12`, and at `t=40` with the solo well, on WebGPU High, the WebGL2 backend
and the Minimal tier: the linen and the thin lay-in washes are darker, the thick strokes keep
their colour, and the consoles stayed clean.

The theme icon was re-baked to match, from the same frame as before so its composition is
unchanged: `playground.html?effect=chromatic-impasto&maxFps=30&hud=0&t=12` at 1280 × 720, the
square from (2, 0) to (526, 524), resized to 512 px and given the previous icon's disc alpha.
The Odyssey passage palette was re-baked from it (`node scripts/bake-odyssey-passage-palettes.mjs`).
