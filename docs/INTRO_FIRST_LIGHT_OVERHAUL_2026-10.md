# The opening and menu world — First Light

A rebuild of the intro animation (2026-10-15): the loading screen, the opening, the title, the
step into the main menu and the world that stays behind the menu. It replaces the intro's two
renderers (`threejs-intro-renderer-webgpu.js` with its particle and tetromino compute
simulations, and the classic-three `threejs-intro-renderer.js` fallback) with **one TSL world on
WebGPURenderer**, the WebGL2 backend as its fallback, and redesigns the loading screen around
the logo it keeps. The boot's machinery (startup pipeline, studio-ident hold, boot warp, title
handoff, menu wordmark flight, parked menu renderer) is kept and fed by the new world.

## Fitted to the interface (2026-11-04)

The murmuration below was a spray on the title and, behind the menu, almost nothing: it flew "to
the right of the navigation", which is exactly where the stage card stands, so about nine tenths
of it was hidden, scraps showed round the card's edges, and the rest ghosted through its glass.
This pass rebuilds its body and makes it know the interface. The look is judged in the real game
at the owner's window (1707 x 1067).

**The line.** The flock's middle was a formula in the vertex stage, so it could only ever be an
ellipse. It is now a uniform cubic B-spline of 28 points that the world writes every frame
(`writeFlockLine`), with a width share per point. It is still a closed form of time, so a seek
still lands where playing would, and the path can be any shape. The motes read the spline, its
tangent and a lent hue per point; a touch now reads the same points on the CPU.

**The body.**

| Was | Is |
|---|---|
| Motes spread evenly along the flock, so where it tapers they crowded into bright leaf shapes | Spread by the flock's width (an inverse-CDF sampler): its tips thin out to wisps |
| A hard-edged disc across it, a spray of dots | 68 % fly in fine streams (strands at one place across the sheet, over a stretch of its length, some burning brighter), the rest are Gaussian dust with a few stragglers: silk with a soft edge |
| A flat sheet | A sheet that folds: an S across it travels down the flock, and turned edge on each fold gathers the motes along a fine bright line |
| The split carved a hard black slit (each stream only spread outward from the gap) | Each stream keeps its full spread and it opens a stretch at a time: a valley of thinner light |
| Evenly spaced banking turns read as a row of fins | Detuned along the flock |
| One size and brightness | Dust, sparks and a few wide faint motes for the body of light under them; a little larger and brighter nearer the eye |

**The title.** The ring was a lumpy potato in world units, not concentric with the wordmark, and
the leaning camera slid it about. It is now an ellipse measured from the wordmark's rect through
the live camera every frame, so it stays locked to the logo on screen, round the tagline and
clear of the prompt. Its outline barely breathes, its motes lie evenly by rank (`FLOCK_RANK_FIT`),
and each carries half the light: the same motes in a tenth of the area burned white and turned
the sky to milk. The flock no longer only fades near the wordmark, it flows round it.

**The menu.** The flock flies a circuit round the stage card (`stageCircuit`, `circuitPoint`): a
rounded path down the middle of the free band on each side, between card and navigation, card and
dock, card and the frame's edge, re-fitted when the layout changes (it glides, it does not jump).
Its width follows the gutter it is in, so it fans out in the wide bands and narrows to pass under
the card. It flies the way the free flock flies and the same angle lands on the same side, so
Begin pours it across, head first, without crossing the card.

- **The panels.** The motes used to fade near two rects. Now the card, navigation, logo and dock
  are rounded boxes with a soft wall (`setRects`): a mote pushed against one slides along its edge,
  so the flock takes the panel's outline and crowds into a soft rim of light on it.
- **The mode's light.** The current mode lends the flock its light, as it lends the page: the hue
  reaches the head first and runs down to the tail. The page's pastels are deepened for light
  (added up in a dense flock they wash to white), and they run the flock's whole length, because
  at its tail a hue meeting the logo's spectrum added up to grey.
- **The thread.** 3 % of the motes leave the flock for a fine stream of light from the current row
  into the card, level out of the row and level into the card, in the mode's hue: the list and the
  stage visibly joined. It glides when the current row moves (`menu:currentChanged`) and is absent
  where there is no gutter to cross.
- **The frame.** On the breath the title's flock gathers, behind the menu it closes round the card:
  its head runs ahead and its tail falls back until they meet, every wave along it comes round to a
  whole number so the two ends join as one sheet, it holds, and lets go on the out-breath. (The old
  reason for no gathering here, that the ring would cross the navigation, went with the circuit.)
- **The stacked layout** has no stage card: the column of logo, list and dock is the panel it
  circles, and it no longer ghosts through the list.

**The scene.** The flock is the show, so the rest stepped back: the far motes are finer and
quieter, and the near discs fainter, or the flock's fine dots are lost among them; the veils' cores
are thinner, and the hero veil passes under the begin prompt instead of through it; the post's calm
now covers the logo too and holds the navigation's background far lower. The lens fringe is a
quarter of what it was, because on a dot two pixels wide it painted a red and a blue edge (the "warm
stars"). The waves' front is a hairline in the logo's spectrum, not the grey disc it was.

**A bug found on the way.** `.intro-shimmer` was a bare bar sweeping the sky on both sides of the
wordmark, on every boot and again every 7.5 s on the title. It is now masked by the logo itself, so
it only touches the letters. The mask stays still and the streak moves inside it, by `transform`.

Checked in the real game (WebGPU, High, 30 fps cap, clean consoles): the opening, the title, the
gathering, Begin; eight modes behind the real card; the frame closing in Odyssey gold and Local
Versus rose; Settings over the menu and back; 1707 x 1067, 1920 x 1080, 2560 x 1080, 1280 x 720,
1024 x 768, 820 x 1180, 390 x 844. Playground: WebGL2 backend, Medium and Low; every material builds
on both backends at High and Low. The frame rate was not measured: it adds a little vertex work (the
spline and six rounded boxes per mote), and an uncapped comparison waits for a full-speed session.

## The murmuration (2026-11-03)

The section below is the first murmuration. Where it differs from the pass above, the pass above
is what ships.

The rising pieces and the stack are gone. In their place flies **one great murmuration of
light** (`intro-world-murmuration.js`, about 110 000 motes on High, 52 000 on Medium, 18 000 on
Low): a long plume whose head flies a slow loop round the wordmark and whose body follows it, so
the flock sweeps across the whole frame in arcs and swings toward the eye and away again. Across
its body it is a broad, thin ribbon that banks: a wave of turning rolls from head to tail, and
where the ribbon turns edge on its motes crowd along the line of sight and the band blazes. It
bulges and thins along its length, and on the out-breath it opens into two streams and closes
again. Its colour runs the logo's spectrum along it: lavender at the head, aqua through the body,
mint at the tail.

- **The opening:** the flock pours up out of the light below as the eye rises.
- **The gathering** (every third breath on the title): the whole flock pours, head first, into a
  ring of light round the wordmark. The ring ripples, beads and breathes, a wave of light leaves
  the title as it closes, the eye leans in, and on the out-breath the ring unravels back into the
  flock. Behind the menu there is no gathering (the ring would cross the navigation); the flock
  flies to the right of it.
- **The music:** the flock swells and brightens with the soundtrack's level.
- **A touch:** a pulse of light runs both ways along the flock from the part nearest the click.

Everything is a closed form of time (`murmurationAt`, `murmurationLine` in
`intro-world-core.js`), every mote is placed in the vertex stage from a static seed: no compute,
no state, a seek lands where playing would. Motes are a few pixels at any distance, with a light
budget per tier, and fade where the title and the menu's navigation stand. The veils keep to a
quieter light now: the murmuration is the show. The sections below describe the 2026-10 world;
where they speak of pieces and the stack, the murmuration and the gathering replace them.

## The picture

A deep, dark cosmos (since the 2026-10-16 pass below): a near-black void overhead, a faint violet
nebula in wisps just under the title, and **light rising from below**: an abyssal glow (deep
violet on the left, abyssal teal with a cyan mid-glow ahead, sea-green to the right) broken into
wisps by soft grain, as if a sea of light lay far beneath. Sheets of **silk light** (four veils)
billow across the sky: the hero veil passes under the title and climbs out past its right
shoulder, a thin thread of silk crosses above it, a faint veil hangs high and far, and a soft
one crosses the foot of the frame as if out of focus. Each is a deep jewel-toned sheet with one
razor-thin cyan core; folds that turn edge-on to the eye glow brighter, as a sheet of light does.
A cool **halo** stands behind the wordmark, the first light.

The **pieces** rise at every depth on either side of the title, never through its column:
solid tetrominoes (one fused rounded block each, never four cells) in a deepened lacquer of the
logo's colours, lit by a cream key from above and faintly by the glow from below, a clear coat
mirroring the sky, a cool rim (cyan below, violet above), the far ones sinking into the dark.
**Motes** of light rise through the whole depth; one in a hundred is close enough to open into a
soft disc.

The whole world **breathes**: in for 4 s, out for 6 s (six breaths a minute). The haze, the
halo, the veils' billow and the motes swell on the in-breath, and everything that rises rises a
little faster then (the pace is the breath's integral, so a seek lands where playing would).

**The stack.** Every third breath on the title (every sixth behind the menu, on its right), two
pieces of one shape find each other on the in-breath, turn to fit and lock into one rectangle at
its top (two J or two L make a 2 x 4, two O a 4 x 2, two I a bar of eight), flash, hold, and let
go on the out-breath; a small ring of light leaves the lock. The game in one gesture: stack,
breathe, rise.

## The sequence

| Moment | What the player sees |
|---|---|
| Loading screen | The logo (unchanged) and its tagline over the world's first frame painted in CSS: the light rising from below, motes rising, a halo breathing behind the logo. Below, a guide to breathe by — "Breathe in" / "Breathe out" on the same 4 s / 6 s breath — and a hairline that follows the boot's real milestones (it never runs back; light runs along it between milestones). Only `transform` and `opacity` move, so it keeps moving while shaders compile (ADR-0020). |
| The opening | When the boot warp hands over, the loading screen dissolves over the live world while its wordmark grows into the title (the existing connected handoff). Underneath, the world **opens**: the eye starts close, looking down into the light, and rises and draws back to the horizon while the veils unfurl along their length, the pieces rise past and a wave of light leaves the logo, bending the picture as it passes. A soft glow bridges the two halos so the frame never dips. About five seconds in all. |
| The title | The settled world; the halo behind the wordmark; "Press any key / or click to begin" (or "Tap to begin" on a touch screen), breathing on the world's breath with a hairline under it. Clicking a piece spins it and lights it. |
| Begin | A wave of light leaves the title as the wordmark flies to the menu's logo; the eye glides into the menu's view (higher, the light lower); the menu fades up a beat behind it. |
| The menu | The world calmer and lower behind the cards: pieces keep out of the navigation and the logo, the post softens its light behind the navigation, the stage card and the dock; stacks happen to the right of the card. |
| Return to the menu | The parked renderer revives straight into the menu's view (no opening). |

## How it is built

`src/ui/intro-world/`, loaded lazily by `src/ui/threejs-intro-renderer-webgpu.js` (nothing of it
is on the boot path; `intro-visual-config.js` keeps only the phase names and the budget check).

| Module | What it holds |
|---|---|
| `intro-world-core.js` | Pure (no three): the palette and the modes' hues, the breath and its exact integral (the rise clock), the camera poses and the opening's curves, the murmuration's seeds, its state at a moment, its line (`writeFlockLine`), the circuit round the stage card, the gathering's rhythm. |
| `intro-world-tsl.js` | Laid-out helpers (`fl_*`): hashes, Fresnel, quaternion rotate, `fl_sky` (the sky as one function of a direction) and `fl_skySoft` (its cheap twin for reflections and air); the baked 128² fBm grain. |
| `intro-world-sky.js` | The sky on a sphere round the eye, drawn after the opaque pieces; the haze's grain projected on a plane far below. |
| `intro-world-veils.js` | Four ribbons in one draw: built on the CPU along curves, billowed by two travelling waves in the vertex stage with analytic normals; premultiplied additive light. |
| `intro-world-murmuration.js` | The murmuration: one instanced draw of point motes placed in the vertex stage from the frame's closed-form state (six `vec4` rows), the flock's line and lent hue (a B-spline of 28 points), the thread, and the interface's panels as rounded boxes the motes flow round. |
| `intro-world-motes.js` | Instanced quads placed in the vertex stage from static seeds and the rise clock. |
| `intro-world-post.js` | One scene pass (MSAA on High), bloom on a max-channel knee, and one output pass: the waves (opening, begin, stack lock), calm rects, hue-preserving filmic, a grade by scaling only, vignette, grain and dither. |
| `intro-world.js` | The world: builds the parts, owns the shared uniforms, integrates the clocks, directs the camera, the opening, the title/menu blend, the gathering and the frame round the card, touches, and the fit to the wordmark and the menu's layout; `seek(t)` for captures. |

No compute, no scene lights, no MaterialX noise: about a dozen pipelines, created
asynchronously under the loading screen (`IntroAnimation.beginIntroPipelineSession`).

**Boot integration.** `IntroAnimation.revealTitle()` (called at the warp's handoff, or after the
CSS fallback) begins the opening with the cover's dissolve time and the logo's centre;
`handleInteraction()` sends the begin wave; `syncMenuLayout()` measures the menu on a layout
change and when the current mode moves (`menu:currentChanged`), never per frame, and hands the
renderer its panels, the current row and mode, and its calm rects. The boot warp keeps its gating and
timing; its overlay (`boot-aurora-scene.js`) is now the bridging glow. The loading screen's
progress line follows `markStartup` through a listener registry
(`startup-debug.js` `onStartupMark`, `startup-progress.js`).

**Palette.** The murmuration wears the logo's colours. With no pieces in the intro, the palette
gate (`scripts/palette-guideline-check.mjs`) no longer screens it.

## Tiers

| Budget | World | Post |
|---|---|---|
| HIGH | murmuration of 110,000, 1,800 motes, grain, pixel ratio up to 2 | MSAA x4, bloom ½ res, lens fringe |
| MEDIUM | murmuration of 52,000, 1,100 motes, grain, up to 1.5 | bloom ⅓ res |
| LOW | murmuration of 18,000, 600 motes, no grain, 1 | no bloom |

The starting budget comes from the device (`detectIntroBudget`); after a 10 s grace (and never
during the opening) a frame rate under 35 / 50 fps (scaled by the Target Frame Rate) steps it
down. The intro still draws at the Target Frame Rate and not at all while hidden.

## Verification

- Unit: `tests/unit/intro-world-core.test.js` (the breath and its integral, lanes clear of the
  title's column, wrap without pops, quiet zones, opening curves, camera poses, the stack's fits
  making rectangles, its rhythm and pair choice, the palette at 0/7),
  `tests/unit/intro-world-shaders.test.js` (every material through the WGSL and GLSL builders at
  High and Low: no throw, no warning, no NaN, no reversed `smoothstep` edges, pure helpers),
  `tests/unit/startup-progress.test.js`; the intro's existing suites updated for one renderer on
  both backends (`intro-renderer-park`, `intro-async-pipelines`, `startup-animation-reliability`).
- Playground (`effect=intro-world`), RTX 3070 on AC: every phase on WebGPU, the WebGL2 backend,
  Medium and Low, portrait; clean consoles. Uncapped at 1600 x 900: ~465 fps on WebGPU (2.1 ms
  p50 frame, 2.5 ms p95) on the title and ~453 behind the menu; ~670 on the WebGL2 backend.
- Real boot, cold profile, dev server (`boot-film` captures every 200–400 ms): the title is
  interactive at 9.9–10.4 s over four runs (the old intro: 18.0 s on the same machine); the
  opening begins at the warp's handoff (6.1–6.5 s) and has settled about 3.3 s later; the menu
  fades up behind the begin wave. With `forceWebGL=1` (the CSS fallback, no warp) the loading
  wordmark now grows into the title as on the warp path; the title is interactive at 16.8 s
  (the theme warm compiles synchronously there). Phone-sized window (390 x 844): 9.4 s, layout
  intact through the menu.
- Menu round trip in the real game: the intro parks on mode entry (64 x 36, hidden), and the
  return revives it into the menu's view at full size.
- Gates: typecheck, `lint:ci` (577 errors against a baseline of 599: the deleted renderers
  carried some), boundaries, fitness, ts-ratchet, lifecycle audit, perf budgets, palette gate,
  `npm run build` with the boot-closure guard (the world is a 44.7 kB lazy chunk, 17.5 kB
  gzipped). Full unit suite: 955 of 957 files; the two failures are this machine's known
  environmental ones (`odyssey-level-briefing` locale, `tts-recorder-e2e` symlink EPERM).

## Deep cosmos pass (2026-10-16)

The first build read as a bright pastel nebula. This pass changed only colours, shader falloffs,
blending and lighting; the choreography, timings, camera, ring, ribbon motion, geometry and UI
layout are as they were, and so is the piece palette (the legal gate's input). The knobs, for
fine-tuning:

| Part | Before → after |
|---|---|
| Sky (`fl_sky`) | zenith / eye level `#020311` / `#0d1238` → `#03040A` / `#070A17`; violet lift `#2d235d` x0.8, exp(-30x²) → `#1F1647` x0.4 x grain wisps (0.15–1.45), exp(-70x²); low glow pastel (luma ~0.7) → band `#1F1647`/`#093542`/`#07383A` x0.85 (width 0.17 → 0.12) + core `#2A1E66`/`#007A8C`/`#007A78` x0.55, grain contrast x(0.55–1.45) → x(0.1–1.5); halo 0.17·exp(-42a²) + 0.065·exp(-8a²) → 0.06·exp(-110a²) + 0.008·exp(-30a²), `#8A6BFF` to cool white |
| Veils | colours to deep jewel tones (hero `#2a1e6e #007a8c #035563`), gains hero/thread/far/near 1.0/1.35/0.42/0.5 → 1.0/1.0/0.15/0.22; body across² → across⁴ (soft veils keep across²); fold gain cap 2.6 → 2.0 plus a soft knee body/(1 + 0.5·body); hems 0.07/0.05 → 0.045/0.035 in the body's tone; new core: exp(-(v·halfWidth/0.15)²) in `#6CEBFF` → `#8FFFE0` at 0.85 x (1 − soft)³ |
| Pieces | lacquer 20 % desaturated x0.82; uplight 0.5 → 0.28 in `#8A6BFF` / `#00C4DF`; ambient 0.03 → 0.016; own glow 0.075 + 0.06cos² → 0.04 + 0.03cos² (world glow 0.05 + 0.06b → 0.028 + 0.033b); rim → m³·0.55 `#8A6BFF` above to `#4AD8FF` below; key and specular unchanged |
| Post | bloom threshold/knee/radius 0.9/0.45/0.7 → 1.0/0.35/0.45, strength High/Medium 0.62/0.58 → 0.52/0.48; wave edge width 0.012 → 0.009 at 0.12, wash 0.035 → 0.012, colour `#ede4f8` → `#ddf3ff` (bend unchanged); vignette 0.42 → 0.5 |
| Motes | cool white / violet / cyan, gain 1.0 → 0.85, near discs 0.07 → 0.05 |
| Loading screen, CSS fallback, bridge glow | the same void, abyssal teal and violet in `main.css` / `intro-animation.css`; `boot-aurora-scene.js` glow `#8A6BFF` to cool white at 0.16 / 0.04 (was 0.22 / 0.08, cream to lavender) |

Measured on the playground title frame (stars eroded out): the background at or under `#120C2B`
went from 3 % to 54 % (menu 78 %, under the loading screen 50 %, the opening's ring frame 41 %);
corners `#2d324c` → `#02030a`. Real boot film: the loading screen hands into the opening with no
bright step; clean console.

## Every loading screen (2026-10-16)

The boot's loading screen became the game's loading language. Every surface that covers the
game while it prepares is the same first frame of the world, from one set of values in `main.css`:

| Part | Shared as |
|---|---|
| The void, the light below, the halo, the vignette | `--sb-void-sky`, `--sb-void-light`, `--sb-void-halo`, `--sb-void-vignette` |
| Light rising and breathing, motes at two depths, stars thinning toward the light | `.sb-void-light`, `.sb-void-motes` (two `<i>`), `.sb-starfield.sb-void-stars` |
| The halo behind the name | `.sb-void-halo` (its host places it) |
| "Breathe in / Breathe out" on the 4 s / 6 s breath, a still "Preparing your space" for reduced motion | `.sb-breath-guide` + `__word--in/--out/--still` |
| Progress that follows real milestones, never runs back, with light running along it | `.sb-progress-line` + `__fill`, driven by `--sb-progress` |

Where it shows:

- **Mode covers** (`cinematic-loading-overlay.js`): Single Player, Infinity, Serenity, Online
  (main.js), Local Versus (its match types as the variant line) and Odyssey. The mode's name in the
  logo's lettering arrives and pulses as the boot's logo does. The progress line follows the
  entry's milestones (`MODE_LOADING_STEPS`: presented, prepared, activated, started, theme ready,
  content loaded, settled) and fills as the cover lifts. Odyssey is covered the moment its card is
  chosen (main puts the cover up; the mode adopts it).
- **Countdowns:** local versus (the cover becomes the count) and the online match countdown: a
  ring of light per count in the spectrum's colour over the void, opening with each count; GO is
  coral.
- **Odyssey's covers:** the opaque transit between orbs and the retained cover, the retry veil and
  the fallback backdrops sit on `--sb-void-sky`; the chapter-coloured portal stays Odyssey's own.

Not changed: the Odyssey portal transitions into and out of a level (in-world canvas cinematics),
the Ready/Go cue, the Sukha session countdown and the return to the menu (the intro world revives;
no cover).

Verified: a harness page with the real stylesheets and modules (every cover, both countdowns, the
boot screen, phone and landscape sizes, reduced motion), and the real game on the RTX entering
Single Player, Odyssey and Infinity from the menu (covered within ~70 ms of the click; the line
reaches each milestone; the cover dissolves into the live scene).

## Open

- Real phone, packaged Electron build, and an iGPU reading not taken (the dev machine's RTX is
  the reference; the WebGL2 backend renders the same world).
- The breath guide on the loading screen is new copy ("Breathe in" / "Breathe out"); the prompt
  now reads "Press any key / or click to begin" ("Tap to begin" on touch).

## Reproduce

```text
/playground.html?effect=intro-world&t=12                         the title
/playground.html?effect=intro-world&phase=open&opening=1.4&t=20  the opening, 1.4 s in
/playground.html?effect=intro-world&phase=boot&t=8               the frame under the loading screen
/playground.html?effect=intro-world&phase=menu&ui=1&t=12         behind the menu (mock UI)
/playground.html?effect=intro-world&t=25.5                       the first gathering, the ring held
/playground.html?effect=intro-world&t=12&begin=0.5               the begin wave
/playground.html?effect=intro-world&phase=boot&autoOpen=2        live: watch the opening
/?forceWebGL=1                                                   the whole boot on the WebGL2 backend
```
