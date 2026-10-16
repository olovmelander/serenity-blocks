# The opening and menu world — First Light

A rebuild of the intro animation (2026-10-15): the loading screen, the opening, the title, the
step into the main menu and the world that stays behind the menu. It replaces the intro's two
renderers (`threejs-intro-renderer-webgpu.js` with its particle and tetromino compute
simulations, and the classic-three `threejs-intro-renderer.js` fallback) with **one TSL world on
WebGPURenderer**, the WebGL2 backend as its fallback, and redesigns the loading screen around
the logo it keeps. The boot's machinery (startup pipeline, studio-ident hold, boot warp, title
handoff, menu wordmark flight, parked menu renderer) is kept and fed by the new world.

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
the Ready/Go cue, the Hale session countdown and the return to the menu (the intro world revives;
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
/playground.html?effect=intro-world&t=23.75                      the first stack locking
/playground.html?effect=intro-world&t=12&begin=0.5               the begin wave
/playground.html?effect=intro-world&phase=boot&autoOpen=2        live: watch the opening
/?forceWebGL=1                                                   the whole boot on the WebGL2 backend
```
