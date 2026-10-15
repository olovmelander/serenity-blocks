# The opening and menu world — First Light

A rebuild of the intro animation (2026-10-15): the loading screen, the opening, the title, the
step into the main menu and the world that stays behind the menu. It replaces the intro's two
renderers (`threejs-intro-renderer-webgpu.js` with its particle and tetromino compute
simulations, and the classic-three `threejs-intro-renderer.js` fallback) with **one TSL world on
WebGPURenderer**, the WebGL2 backend as its fallback, and redesigns the loading screen around
the logo it keeps. The boot's machinery (startup pipeline, studio-ident hold, boot warp, title
handoff, menu wordmark flight, parked menu renderer) is kept and fed by the new world.

## The picture

Deep ink overhead, indigo toward eye level, and **light rising from below**: a luminous haze in
the logo's own spectrum (lavender on the left, aqua ahead, mint to the right) with soft grain in
it, as if a sea of light lay far beneath. Sheets of **silk light** (four veils) billow across the
sky: the hero veil passes under the title and climbs out past its right shoulder, a thin thread
of silk crosses above it, a faint veil hangs high and far, and a soft one crosses the foot of the
frame as if out of focus. Folds that turn edge-on to the eye glow brightest, as a sheet of light
does. A **halo** stands behind the wordmark, the first light.

The **pieces** rise at every depth on either side of the title, never through its column:
solid tetrominoes (one fused rounded block each, never four cells) in lacquer of the logo's
colours, lit by a cream key from above and by the haze from below, a clear coat mirroring the
sky, the far ones sinking into the air. **Motes** of light rise through the whole depth; one in a
hundred is close enough to open into a soft disc.

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
| `intro-world-core.js` | Pure (no three): the palette, the breath and its exact integral (the rise clock), the camera poses and the opening's curves, the lanes the pieces rise in, quiet-zone presence, the stack's fits, rhythm and pair choice, quaternion helpers. |
| `intro-world-tsl.js` | Laid-out helpers (`fl_*`): hashes, Fresnel, quaternion rotate, `fl_sky` (the sky as one function of a direction) and `fl_skySoft` (its cheap twin for reflections and air); the baked 128² fBm grain. |
| `intro-world-sky.js` | The sky on a sphere round the eye, drawn after the opaque pieces; the haze's grain projected on a plane far below. |
| `intro-world-veils.js` | Four ribbons in one draw: built on the CPU along curves, billowed by two travelling waves in the vertex stage with analytic normals; premultiplied additive light. |
| `intro-world-pieces.js` | The fused rounded solids (outline extruded, as Serenity Warp's) and their lacquer; seven instanced draws on one material. |
| `intro-world-motes.js` | Instanced quads placed in the vertex stage from static seeds and the rise clock. |
| `intro-world-post.js` | One scene pass (MSAA on High), bloom on a max-channel knee, and one output pass: the waves (opening, begin, stack lock), calm rects, hue-preserving filmic, a grade by scaling only, vignette, grain and dither. |
| `intro-world.js` | The world: builds the parts, owns the shared uniforms, integrates the clocks, directs the camera, the opening, the title/menu blend, the stack, touches and quiet zones; `seek(t)` for captures. |

No compute, no scene lights, no MaterialX noise: about a dozen pipelines, created
asynchronously under the loading screen (`IntroAnimation.beginIntroPipelineSession`).

**Boot integration.** `IntroAnimation.revealTitle()` (called at the warp's handoff, or after the
CSS fallback) begins the opening with the cover's dissolve time and the logo's centre;
`handleInteraction()` sends the begin wave; `syncMenuLayout()` measures the menu once per layout
change and hands the renderer its avoid and calm rects. The boot warp keeps its gating and
timing; its overlay (`boot-aurora-scene.js`) is now the bridging glow. The loading screen's
progress line follows `markStartup` through a listener registry
(`startup-debug.js` `onStartupMark`, `startup-progress.js`).

**Palette and the legal screen.** The pieces wear the logo's colours with no shape on its
familiar Guideline hue: 0/7 on `scripts/palette-guideline-check.mjs`, which now screens the
intro's palette too.

## Tiers

| Budget | World | Post |
|---|---|---|
| HIGH | 21 pieces, 1,800 motes, grain, bevel 3, pixel ratio up to 2 | MSAA x4, bloom ½ res, lens fringe |
| MEDIUM | 18 pieces, 1,100 motes, grain, bevel 2, up to 1.5 | bloom ⅓ res |
| LOW | 14 pieces, 600 motes, no grain, bevel 1, 1 | no bloom |

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
/playground.html?effect=intro-world&t=23.75                      the first stack locking
/playground.html?effect=intro-world&t=12&begin=0.5               the begin wave
/playground.html?effect=intro-world&phase=boot&autoOpen=2        live: watch the opening
/?forceWebGL=1                                                   the whole boot on the WebGL2 backend
```
