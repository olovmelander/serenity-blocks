# Galaxy — the grand spiral

Implemented 2026-10-08 on `feature/galaxy-masterpiece`, with Three.js 0.186.1. A from-scratch
rebuild: it replaces the earlier theme in full (the 1,200-line theme class on `WebGLRenderer`,
its 590 lines of GLSL, the point-sprite spiral, the four nebula planes). Galaxy keeps its
identity — a tilted spiral in magenta, violet and blue round a glowing core, drifting slowly,
with a wave that runs out through the arms — and everything else is new. This document records
the shipped design and what was verified. It is a reference, not a backlog.

## The picture

A grand-design spiral hangs in deep space, leaning back from the line of sight. Its bulge is
old gold; a short bar leaves it; two arms open out of the bar, violet near the centre and blue
toward the rim, forking as they go. Pink nurseries glow along the trailing edge of each arm and
threads of dark dust run along the inner edge, reddening the light behind them and crossing in
front of the near side of the bulge. Eighty thousand suns lie over the gas as fine dust with a
few bright ones among them, and the old ones orbit: inside corotation they overtake the pattern
and brighten as they pass through an arm. Behind it all is a deep field — lattices of faint
stars, far galaxies as small tilted smudges, a band of lit cloud across the upper right, a
companion spiral, and a handful of foreground stars with diffraction spikes.

![The galaxy at rest](galaxy-captures/desktop-rest.jpg)

The gameplay card covers the middle of the frame, so the picture is built for what stays
visible: the nucleus burns to the left of the card, the arms sweep behind it, and the upper
right is left to the deep sky and the companion. On an upright phone the galaxy climbs into the
sky above the card.

![In game](galaxy-captures/desktop-ingame.jpg)

## The one idea

The galaxy is an instrument and the board plays it. A piece's light leaves the board, falls
into a star nursery and stays there; a clear sends a wave out from the nucleus that sets off
everything the galaxy is holding. The more of it the player has lit, the more a clear sets off.

## Event language

| Event | Response |
| --- | --- |
| Piece lock | A seed in the piece's colour leaves the edge of the card at the piece's own height and falls into a nursery level with that row, near the card or far across the galaxy. The nursery ignites in that colour — a starburst with four spikes, a few sparks — a ring runs out through the gas and the suns round it, and it **keeps** some of that light (it fades over about half a minute), so the galaxy slowly fills with the colours of the pieces played. |
| Hard drop | The same, harder: three seeds, a camera kick. |
| Line clear | The cleared rows leave the card as blades of light at their own heights. A wave leaves the nucleus and runs out through the disc, one front per line: it lifts and flares every sun it passes, the gas lights as it crosses, and each nursery it reaches lets go of what it holds — a white flash, a swell of the colour it was keeping, debris thrown out in the disc's plane. One line answers in the rim's blue, two in the inner arms' violet, three in the jets' colour with a pulse up both jets. |
| Combo | The nucleus charges. A ring stands round it in the disc for every step of the chain (up to six), lit in arcs that turn; the jets push further out along the galaxy's axis; every step sends a knot of light up both jets; the pattern turns faster and the old suns stream through the arms. When the chain breaks the galaxy lets its breath go and the rings fade. |
| Four lines / perfect clear | The galaxy holds its breath: every light sinks for a fifth of a second and the arms wind tighter. Then the nucleus erupts: both jets fire to their full reach behind a bright head, four fronts cross the disc in starfire gold, every nursery goes off as they pass, a thin prismatic ring crosses the sky from the nucleus, the picture itself ripples outward as if a lens slid across it, and shooting stars fly from the nucleus. |
| T-spin | The arms wind up and spring back, and a small ring leaves the nucleus. |
| Level up | The galaxy changes colours: five palettes, cycled (andromeda, whirlpool, sombrero, emerald, ultraviolet). |

Combo here is the true consecutive-clear combo (one `ComboTracker` per player in
`GalaxyDirector`); the bus's `COMBO` event is cascade depth (ADR-0011). With several boards on
screen each lock leaves its own board, and the nucleus charges to the longest chain any board
is holding.

![Lock, clear, combo and four lines](galaxy-captures/desktop-events.jpg)

## How it is built

| File | Role |
| --- | --- |
| `galaxy-core.js` | Three-free constants and maths shared by the plan, the choreography and the shaders: the galaxy's geometry, the arm function, ripple and wave timings, how a nursery's held light is carried, the five palettes, where the galaxy sits on screen for an aspect. |
| `galaxy-plan.js` | The plan, seeded and deterministic: every sun in four populations (arm, old disc, bulge, halo), the nursery sites along both arms, the foreground stars. Any prefix of a list is a usable tier. |
| `galaxy-tsl.js` | Hashes, the baked noise texture, the shared uniforms, the spiral function, and the board's light in the disc (lock ripples, clear waves). |
| `galaxy-disc.js` | The gas, the dust and the bulge as one volume: a box round the disc, shaded per view ray. |
| `galaxy-stars.js` | The suns: one instanced draw, every orbit a closed form. |
| `galaxy-nurseries.js` | The star nurseries, the light they hold, their ignitions and novas. |
| `galaxy-nucleus.js` | The nucleus's flare and lens streak, and the two jets. |
| `galaxy-sky.js` | The dome (void, cloud band, star lattices, deep field, companion, the prismatic ring), the foreground stars and the meteor pool. |
| `galaxy-fx.js` | Seeds, nova debris, row beams. |
| `galaxy-world.js` | Owns the uniforms, the parts, the camera rig, the galaxy's pose and the choreography. Shared with the playground effect, so what is iterated there ships. |
| `galaxy-director.js` | Renderer-free: stages bus events per player and resolves one lock and one clear per frame. |
| `galaxy-composition.js` | Three-free: reads the live card, board and HUD rects and maps board columns and rows onto the screen. |
| `galaxy-post.js` | One scene pass, bloom, and one output pass. |
| `galaxy-quality.js` | The six tiers. |
| `galaxy-theme.js` | Lifecycle, renderer selection, settings, layout watch, GPU-loss recovery, capture flags. |

Techniques worth knowing before changing it:

- **One node renderer on both backends.** `WebGPURenderer` on WebGPU, its WebGL2 backend
  otherwise (or `?forceWebGL`). There is no `ShaderMaterial` left. Nothing uses compute: every
  sun, seed, spark and meteor is a closed-form function of the clock, so the WebGL2 backend
  draws the same galaxy.
- **The disc is a volume, walked in layers.** The view ray crosses a slab; it is sampled in
  layers that crowd toward the midplane (y = ±H·(¼ξ + ¾ξ³)), front to back, each adding its
  light through what the dust before it lets pass. The dust takes blue first, so light seen
  through thin dust reddens before it goes out.
- **The grain is read once per pixel.** The two noise reads happen where the ray meets the
  midplane and are shared by every layer. Read per layer, a cloud is a column through the whole
  slab and a leaning view smears it along the ray; read once, the clouds keep their edges and
  the walk costs no texture fetches. The coarse read is in the spiral's own coordinates (across
  the arms, along them), so clumps follow the arms; its mip is chosen from the pixel's
  footprint, because the angle's seam would otherwise fool the automatic choice.
- **Nothing in the gas is cut with a hard threshold.** The light swells and fades; the dust,
  whose shadow is exponential in what it holds, draws the edges. Thresholded noise read as
  confetti.
- **The bulge is solved, not marched.** Its light along the ray is a closed form, split at the
  midplane: the half in front of the dust arrives whole, the half behind it through the lanes.
  That split draws the dark lanes across the near side of the bulge and hides them on the far
  side.
- **The density wave is made of suns passing through it.** Arm suns are stored as an offset
  from their arm's ridge, so they keep the pattern (and follow when a T-spin winds it). Old
  suns orbit with a flat rotation curve and brighten as they cross an arm. The galaxy's frame
  turns with the pattern, so an arm, a nursery or a ripple keeps its coordinates.
- **A sun is never smaller than a pixel.** Its quad is sized from its angular size and clamped
  to a pixel; what the clamp adds in area it takes back in brightness. A sub-pixel sun shimmers
  as the camera drifts.
- **The light a nursery holds is one number.** The moment it would have been lit at full
  strength: held(t) = e^(−(t − epoch)/30 s). Nothing is written per frame and nothing overflows.
  Events are queued with the time they happen at (a seed's landing, a front's passing) and
  applied on the frame that reaches it; whether a nursery has anything to let go is decided
  when the wave gets there, and the ring and the debris start from where the nursery is then.
- **A seed's landing point is resolved in its shader** from the nursery's site, so it lands on
  the nursery however far the pattern has turned or the arms have wound during the flight.
- **The jets are ribbons that turn to face the camera**, drawn double-sided; the far one is
  drawn under the disc so the dust dims it.
- **Closed form first.** Nothing is created at event time: events write numbers into
  ring-buffered uniform slots and preallocated pools. `seek(t)` plus a fixed-step replay
  reproduces any frame.
- **HDR, single output.** The scene is scene-linear and nothing writes depth: the sky is drawn
  first, the gas over it (premultiplied, so the dust dims the stars behind), every light added
  on top. A max-channel knee selects what blooms (no MRT). One output pass does the space
  ripple, the lens fringe, the calm zones on the card and HUD, bloom, rays dragged out of the
  nucleus, a hue-preserving filmic curve, grade, vignette, grain and dither. An iris closes as
  the galaxy flares so its colours survive the surge. `usesMrtScenePass()` is false.
- **No MaterialX noise.** One tileable fBm texture is baked on the CPU with its own mip chain.

## Tiers

| Tier | Suns | Layers through the gas | Nurseries | Sparks | Star lattices | Cloud band, deep field | Bloom, rays | Fringe |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Minimal | 12,000 | 1 (thin disc) | 40 | 128 | 1 | off, off | off | off |
| Low | 24,000 | 1 (thin disc) | 56 | 224 | 2 | on, off | off | off |
| Medium | 46,000 | 6 | 72 | 384 | 2 | on, on | on | off |
| High | 84,000 | 10 | 96 | 640 | 3 | on, on | on | on |
| Ultra | 130,000 | 14 | 120 | 900 | 3 | on, on | on | on |
| Extreme | 190,000 | 20 | 144 | 1,200 | 3 | on, on | on | on |

Every tier keeps the whole picture and every event. These are allocation budgets, not
measurements of frame rate.

## Assets

None. Everything is generated in code: the plan, the noise, the gas, the suns, the sky. No
model or texture file is loaded, and Blender was not needed: a galaxy is a volume and a field
of points, and what makes it read is the shading. The earlier theme loaded no assets either.

The earlier theme's 715 lines of DOM-effect CSS (star layers, nebula layers, shooting stars,
constellation bursts: all left from before it moved to WebGL, none of it matched by any
element) leave `public/styles/main.css`; `#galaxy-theme` keeps only its background colour.

## Verification

- Unit tests: 152 new tests in four files (director 19; plan 31; world 56; theme 46). The
  lifecycle-audit test no longer lists Galaxy among the themes whose `cleanup()` wraps a legacy
  `dispose()` (29 tests there). With the theme-wide tests the change could touch (dual-state
  tripwire, portable renderers and context recovery, portrait composition, teardown
  regressions, registry lifecycle acceptance, thumbnails, mobile quality and WebGL2 validation,
  URL-parameter catalogue): 24 files, 389 tests, all passing.
- Whole suite, run once while a dozen other sessions held the machine: 689 files, 9,179 tests;
  686 files passed. Two of the three that did not are wall-clock timeouts in Odyssey tests this
  change does not touch (a 5 s and a 30 s limit); both pass when run alone. The third
  (`odyssey-level-briefing`) expects "250,000" and gets "250 000" from this machine's Swedish
  number format, and fails identically on `main`.
- Gates: typecheck; lint ratchet (806 errors against a baseline of 807: the new files add none,
  the old ones took one with them; the baseline was left as it is); theme lifecycle audit;
  dependency boundaries (1,284 modules); architecture fitness (three metrics improved, not
  locked in); production build with the boot-closure guard; IP-string gate; Pages artifact
  check; release gates — all pass. The palette gate fails on `main` and here for the same
  unrelated reason (Stillwater); Galaxy scores 0/7 on it.
- Playground captures on WebGPU (RTX 3070 Laptop, 1445 × 813): rest at three moments of the
  pattern's turn; a lock and a hard drop at five moments; the galaxy holding eighteen locks;
  clears of one, two and three lines; held chains of five, six and eight; the four-line hush,
  eruption and aftermath at six moments; a perfect clear; a T-spin; a level change; four more
  palettes; rest or an event at Minimal, Low, Medium, Ultra and Extreme; High and Low on the
  forced WebGL2 backend; an upright 390 × 844 frame at rest, in a chain and through a four-line
  clear; a 21:9 and a near-square frame; reduced motion. The final set of 17 had no console
  errors or warnings.
- In the real game (Electron, dev server, single player, themes unlocked with `?unlockAll=1`):
  the theme starts on WebGPU, aims its events at the live board, takes real hard drops from the
  keyboard and bus-injected locks, clears, a chain and four lines, survives a live quality
  change (High to Medium) and lets go of its canvas when another theme takes over; no console
  errors or warnings. The same event script ran clean on the WebGL2 backend at Low and on the
  integrated GPU at High.
- The repo's lifecycle validator (`scripts/validate-all-themes.mjs`) cannot reach any locked
  theme since the theme collection landed: its worker's page URL carries no `unlockAll=1`, and
  it clicks a theme card, which now opens the theme's detail page instead of selecting it. As
  shipped it fails Galaxy on five theme-card checks with no console error. Run through a scratch
  copy of the worker with those two steps added (the URL parameter, a click on the detail page's
  Apply button), Galaxy passes all 105 checks: 0 lifecycle failures, 0 console errors, 0 shader
  pipeline failures. The tracked script was left as it is.
- A helper agent wrote the theme class, the director and the tests from the Lunara precedent,
  and its two reviews of the world found faults the captures had not shown: nova debris decided
  at clear time (so a seed still in flight went off without it, and two clears close together
  counted every nova twice); debris and rings starting where a nursery had stood rather than
  where it was; a seed's landing point frozen at launch; a T-spin perfect clear losing its
  eruption ring; foreground stars that differed per tier; a malformed click jamming the nursery
  queue; debris outrunning its pool on four lines; the surge and the sky's answer starting with
  the hush instead of the eruption. All are fixed and covered by the tests above.

Observed, not measured (whole-game frame rate at 1445 × 813 on the RTX 3070 while other
sessions held the machine, single runs): about 130 fps at High (frame interval 7.7 ms median at
rest and through the event script, no frame over 66 ms) and 129 fps on the WebGL2 backend at
Low. As a correctness check only, the same script on the integrated AMD GPU drew every event
at High (about 67 fps) and at Low (about 131, at 0.85 scale).

Not verified: GPU cost per tier through the theme perf lane (ADR-0016); physical phones; local
multiplayer, Infinity and Odyssey layouts in a capture (their routing is unit-tested only); the
icon on an Odyssey level orb; sessions of several hours. `docs/theme-screenshots/galaxy.png`
still shows the previous artwork (a fleet capture writes it).

## Reproduce

Run `npm run dev:playground`, then:

`/playground.html?effect=galaxy&t=20&quality=High&board=1`

Add `event=lock|drop|clear|quad|twist|perfect|levelUp` with `eventAge=<s>`, and `combo=<n>`,
`level=<n>`, `lines=<n>`, `u=<0..1>`, `row=<r>`, `color=<hex>`. `locks=<n>` plays n locks first,
so the galaxy is holding their light when the event fires. `demo=1` (without `t`) plays a
looping script. `parts=` draws only the named parts; `falseColor=1` bands the pre-tone-map
peak; `noPost=1` shows the raw scene; `forceWebGL=1` uses the WebGL2 backend; `reduce=1` is
reduced motion. In the game: `?galaxyTime=`, `?galaxyFixedDt=`, `?galaxyParts=`,
`?galaxyFalseColor=1`.

The theme icon is a frame of the scene through the playground's icon lens (the camera
turned to the nucleus and opened to 36°), four steps into a chain with twelve locks held:

`/playground.html?effect=galaxy&t=20&quality=Extreme&icon=1&iconFov=36&locks=12&combo=4`

captured in an 813 × 813 window (the largest square this laptop's screen allows), cropped to
90% of the frame round its centre, given a colour lift (contrast 1.18, saturation 1.32,
brightness 1.08) and baked as a 512 px circle on a transparent ground. The same file is kept at
`public/assets/themes/galaxy-theme-icon.png`.

## Depths pass (2026-10-20)

A second visual pass on `feature/galaxy-depths`. Evidence:
[reports/galaxy-depths/](../reports/galaxy-depths/).

| Before | After (High, WebGPU) |
| --- | --- |
| ![before](../reports/galaxy-depths/before-rest.jpg) | ![after](../reports/galaxy-depths/after-rest.jpg) |
| ![before, near arm](../reports/galaxy-depths/before-arm-closeup.jpg) | ![after, near arm](../reports/galaxy-depths/after-arm-closeup.jpg) |

- **Star-forming knots.** The nurseries' glow was thresholded noise and read as flat pink
  flakes with hard edges. Two hashed lattices in the galaxy's own frame (cells 4.6 and 2.3 units;
  42 % and 32 % of cells hold a knot) now give each knot a hot heart and a soft halo, read once per
  pixel where the ray meets the midplane (`grainAt`). The arm's trailing-edge profile in
  `sampleAt` decides which show, so they string along each arm and turn with the pattern; the
  arm's own clumps gather them into complexes. A halo fades to nothing inside its own cell (a halo
  cut by a cell edge drew straight lines), the heart burns near white while the halo keeps the
  nursery's colour, and a knot smaller than a pixel settles to its lattice's mean. The noise glow
  stays as a faint diffuse term (30 %).
- **Dust lanes.** The lane profile is narrower (the fourth power of the arm's lane cosine, not
  the second) and the dust stronger (`DUST_GAIN` 0.6 → 1.0): fine brown lanes curl round the bulge
  and along the arms' inner edges.
- **A smooth bulge.** Faint bulge and halo suns keep a quarter of their light and faint old-disc
  suns 60 % (their light is unresolved, and the bulge's spheroid already draws it); bright ones
  and every arm sun are unchanged. The bulge reads as a glow with a few bright stars, not grain.
- **Darker space.** The sky's everywhere-breath of nebula colour is 0.004 (was 0.01), the cloud
  band's body is about half (its filaments a little stronger), and the grade's shadow lift is
  under half.
- **The thin disc (Low, Minimal).** Light born inside the dust escapes as (1 − e^−τ)/τ, the slab
  solution, instead of e^(−τ/2): under thick dust it falls as 1/τ, so a lane is a translucent
  shadow. The old law drew the lanes as a black, cracked network on the low tiers (visible in the
  tier capture above, before this pass). τ is floored before both uses, so dust-free gas escapes
  whole.

Verified: the 152 Galaxy tests; lint clean on the theme; playground captures with clean consoles
on WebGPU (High at rest, ten locks held, the four-line eruption, the emerald palette, an upright
430 × 850 frame, Minimal) and on the WebGL2 backend (Low). Cost unchanged: 120 frames awaited on
the GPU queue at 1600 × 900, High, WebGPU (NVIDIA Blackwell), 1.4–1.7 ms a frame against main's
1.4–1.7 ms in the same session.

## Captured previews

![Portrait: at rest and a four-line clear](galaxy-captures/portrait.jpg)

![Minimal, Low on WebGL2, Medium and Extreme](galaxy-captures/tiers.jpg)

![Two more of the five palettes: whirlpool and sombrero](galaxy-captures/palettes.jpg)

## The living pass (2026-11-25)

A third pass on `feature/galaxy-living-masterpiece`: the owner asked for an audit of everything
the theme is made of and for the galaxy to become one of the game's most striking themes, varied
over time, with an effect of its own for every event and the biggest moments the most spectacular.
Nothing here is a model, so Blender was not used: the galaxy is gas, dust and points of light.

Before (left) and after (right), High on WebGPU at the same moment:

![Before and after](galaxy-captures/living-before-after.jpg)

### What the audit found

- The arms were two smooth ribbons strung with evenly spaced round pink balls. The grain was
  cloud noise, so nothing in the disc was a filament, and the dust lanes barely showed at High.
- No star clusters: the suns were an even sprinkle.
- The sky was one blurred band of cloud in a corner, the rest of the frame empty; nothing in it
  moved but the stars' twinkle. Nothing but the galaxy's own tilt gave depth.
- Only the colours changed with time (the palette wheel). The galaxy's form, its lean and its
  place never did, and nothing happened that the player had not played except a shooting star
  every 17 s.
- One, two and three lines differed only in colour and in how many fronts ran out. A twist's ring
  was a four-line clear's, smaller. A level-up was a slow global fade nobody saw. A back-to-back
  brightened a 60-pixel companion. A hard drop was a lock, three times. A run's end did nothing.
- A seed's tail read as a dotted line of beads on a long flight.

### What changed

**The disc** (`galaxy-disc.js`). Two more reads of the same noise, once per pixel where the ray
meets the midplane: one squeezed eight to one along the arm, whose level lines run on as long
filaments of dust beside each lane and as wisps of young light along the ridge, and one sheared out
of the arm's pitch, whose lines are spurs that leave the lane and cross the arm. A ring of star
formation stands where the arms leave the bar. The nurseries at rest are torn knots round a few
compact hearts, not balls.

**Star clusters** (`galaxy-plan.js`, `galaxy-stars.js`). A fifth population: 64 open clusters,
blue-white, a few units along the arm from a nursery, and 26 globular ones, old and warm, on a
sphere out of the plane. Members keep their place in the pattern's frame (gotcha #1436).

**The sky** (`galaxy-sky.js`). Everything far is read in a frame of its own that turns once in 90
minutes about the cloud band's pole (`SKY_TURN`, `u.skyRot`): the band's line never moves in the
frame, its clouds, stars and far galaxies slide along it. The clouds are wisps with faces lit from
the galaxy's side (one extra read, one step toward the nucleus in the clouds' own coordinates) and
a second read that drifts against the first, so they form and melt. A few nearer far galaxies to a
frame (spirals at every tilt, edge-on ones with a lane of dust); the companion has lanes and knots.
The galaxy's own old halo is drawn here, behind the disc (gotcha #1437). A few foreground stars hang
nearer than the rest and slide against the galaxy as the eye drifts (`near` in the plan).

**The airs** (`galaxy-living.js`). Five states of the galaxy's form on a clock of their own, 127 s
each against the palettes' 100 s, so a palette meets a different air every round; a level moves
the air two on:

| Air | What it does |
| --- | --- |
| clear | The rest look (every factor one). |
| starburst | The nurseries and knots burn hot, the arms open a little, the disc shows more of its face. |
| veiled | The dust lies thick, the bulge glows through it, the disc leans nearer edge-on. |
| awake | The nucleus and its halo burn, faint jets stand along the axis, the clouds brighten. |
| tide | The arms open wide and the disc shows its face. |

![Starburst, veiled, awake and tide](galaxy-captures/living-airs.jpg)

**The happenings** (`galaxy-living.js`, `happen()` in the world). About every 29 s, on a schedule
that is a pure function of the clock: a supernova in an arm (a point behind six spikes, a ring
through the gas round it: `createNovae`), a slow ripple of star formation down one arm, a shower of
shooting stars, the nucleus stirring, a flash in the companion. None while a run's end holds the
galaxy dark; `setHappenings(false)` switches them off.

**The events.** Every event now has a shape of its own on top of what it had:

| Event | Its own shape |
| --- | --- |
| Lock | The seed is a comet with an unbroken tail (gotcha #1775). |
| Hard drop | Where its seed lands, a plume breaks out of the plane, up and down the galaxy's axis. |
| One line | Light runs out along ONE arm like a fuse (the arms take turns). |
| Two, three lines | Along both arms; three hotter and quicker. |
| Four lines | The whole pattern ignites along both arms, twice, in the arms' own colour toward starfire; the ring leaves the clouds lit behind it. |
| Twist | Light runs IN along both arms, the other way from a clear. A twist that clears nothing: in along one. |
| Chain's end | The exhale runs out along both arms. |
| Back-to-back | The companion sends a ring of its own across the sky to meet the galaxy's. |
| Perfect clear | A front of gold crosses the whole sky; every far star and galaxy it passes answers (written against the iris: gotcha #1776). |
| Level up | The new colours sweep out from the nucleus behind a bright front (gotcha #1777); the sky's colours melt as before. |
| Game over | The galaxy sinks into the night: its young light goes out, the nucleus dims, the pattern all but stops, the far sky stays. It comes back by itself after 10 s, or re-ignites from the nucleus when the next run starts. |

The light along the arms is one mechanism (`gxPulseLight`, four slots, least light left wins)
read by the disc, the suns and the nurseries; at rest it costs one uniform branch.

![Four lines, a twist, a new level, a supernova, a crown, a run's end](galaxy-captures/living-events.jpg)

![In the real game: hard drops, four lines, a new level, game over](galaxy-captures/living-ingame.jpg)

### What a later change should know

- `tests/unit/galaxy-world.test.js` pins what PLAY does from the rest look: its worlds call
  `holdAir(0).setHappenings(false)`. `tests/unit/galaxy-living.test.js` holds the airs, the
  happenings, the pulses, the front, the dusk, the sky's frame and the clusters.
  `tests/unit/galaxy-shaders.test.js` is new: every part built to WGSL and GLSL at High and Minimal.
- The theme ends a run in the #1716 order (`endRun`: flush, reset, then `onGameOver`); the world
  keeps `over` and `dusk` through `resetSession()` and lets go on `onSessionStart()` or a seek.
- An air's lean and winding rest under reduced motion; its light does not (the mood-clock rule).
- A happening is stamped at its own moment and a pulse, a ring and a front hold timestamps, so
  30 and 240 frames a second agree. The air is applied AFTER the palette step in `update()`
  (gotcha #500).
- Playground: `air=<0..4>` holds an air, `happen=0` switches the happenings off,
  `event=spin|b2b|crown|over|dawn|happen` (with `kind=nova|ripple|shower|stir|flash`) fires the
  new events.

### Verified

- 250 Galaxy tests in 7 files, with the cross-theme tests a theme change can touch (registry
  lifecycle acceptance, dual-state tripwire, URL catalogue, camera-breath coverage, reduce
  flashing): 407 pass. Typecheck, the TS and lint ratchets (at baseline), architecture fitness,
  dependency boundaries and the theme lifecycle audit pass.
- Playground captures with clean consoles on WebGPU (RTX laptop GPU, 1600 x 900): rest at three
  moments, every air, every event at its telling age, the sky alone, a 16-frame strip of the
  demo loop; Minimal and Medium; High and Low on the forced WebGL2 backend; an upright 390 x 844
  frame; a 21:9 frame.
- The real game in a private headless Chrome on WebGPU at High: Galaxy picked, a single-player run
  started, seven hard drops from the keyboard, two and four lines, a new level and a perfect clear
  on the bus, a happening by itself, then the game's own game over: the world read `over: true`,
  `dusk 0.985`, counts back to zero. Console: the sound autoplay refusal of a headless page and the
  two Steam Cloud notices, nothing else.
- Cost, capped at 30 fps on the RTX at 1920 x 1080 (three interleaved rounds against the untouched
  main checkout, about ten GPU-timestamp samples a case, so a rough reading): High at rest 0.94 to
  1.26 ms, Low at rest 0.37 to 0.42 ms; the sky alone 0.30 to 0.31 ms and the disc alone 0.59 to
  0.61 ms. Capped readings on this machine swing by a fifth from run to run.

Not verified: an uncapped frame-rate reading; the integrated GPU; physical phones; local
multiplayer, Infinity and Odyssey layouts in a capture; how the sky's turn and the airs feel
watched in motion over many minutes (every judgement here is from stills and strips). The theme
icon and `docs/theme-screenshots/galaxy.png` still show the earlier passes.
