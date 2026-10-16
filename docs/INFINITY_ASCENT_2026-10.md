# Infinity: the ascent (looking around the tower), 2026-10-16

**What changed.** Scrolling (the wheel or a trackpad), the right stick, or dragging the tower
map in Infinity no longer cuts to a separate black starfield. It is a journey through the
world you play in. The game holds its breath, and you rise along your tower or descend it.
The theme sinks away below you or lifts past you, and every theme's camera cranes with you.
The world's clock slows to a quarter. A night sky comes down from above, with stars, and a
haze of depth rises from below. Motes stream past at three depths and streak with the speed.
The well leans. The music muffles, air rises with the speed, ticks climb in pitch with the
height, bells ring at the milestones, and a gamepad pulses. The well shows the altitude, the
milestones as floors of light, the tower's memories and the way home. Let go and the view
waits, fills a ring, then flies home and lands.

It replaces `CosmicExplorationEffect.js`, `CosmicParticleSystem.js` and
`cosmic-exploration-shaders.js`. Those were two classic `WebGLRenderer`s (one at z-index -1,
opaque black, covering the theme, one at z-index 10000 over every menu), an `EffectComposer`,
full-window bloom, three `ShaderMaterial`s and a raw resize listener. The theme kept rendering,
unseen, underneath them.

## What the player feels

| Moment | Motion | World | Sound | Gamepad |
|---|---|---|---|---|
| First scroll | The view moves at once, against a spring (a peek); the game keeps running | A little of the overlay | — | — |
| Pull past 4 rows of input (2 wheel notches) | It gives way: the view catches up with the pull, the well dips and bounces; the game pauses | The look fades in over ~0.2 s | A low breath out; the music closes into a low-pass; air begins | Give pulse |
| Gliding | Critically damped spring at sub-row precision: a notch glides (ω 11), a trackpad follows (ω 22), the map drags (ω 16), the stick flies at up to 46 rows/s | Three planes of parallax: theme layer (12 % of the board's speed, capped at 30 % of the screen up / 6 % down), motes (30 / 48 / 72 %), the board (100 %); themes crane in 3D | Air louder and brighter with speed | — |
| Rising above your rows | — | The theme sinks; the night comes down from the top in the theme's own glow colour, stars come out; past ~24 rows it covers the world and the theme stops rendering (`isThemeCovered`) | A shimmer past the summit; ticks rise in pitch | — |
| Descending the tower | — | The theme lifts; a haze in the theme's ground colour rises from below, darker the lower | — | — |
| Every 10 rows | — | The ruler ticks slide along the wall | A soft tick (520 Hz at the floor, two octaves up by 640 rows) | Tick (≥ 60 ms apart) |
| A milestone (100, 250, 500, 750, 1,000) | — | A floor of light across the well (gold once built past) | A bell (brighter if reached) | Milestone pulse |
| Near a memory | — | Its bead on the wall and the tower map; a caption: "6-chain cascade · 4 min ago" | — | — |
| The floor / the top of the grid | The last 3 rows resist; arriving with a push is a bump | The well dips | A bump | Bump |
| Back at your rows | A detent: it clicks into place and lands after 0.38 s; push 3 rows on to carry through | — | A click | Dock pulse |
| 2.5 s without input | — | The way-home badge's ring fills (1.7 s) | — | — |
| The flight home | A small lift away (≤ 0.9 rows), then an eased descent (0.55 to 1.5 s by distance); the well dips and bounces on landing; the game resumes | The look fades out; the world's clock eases back (τ 0.75 s) | The music opens; a soft touchdown | Land swell |
| A game key or button | Home at once (the mode's quick lerp) and play | Fades out | The music opens | — |
| Escape | The look ends; the game stays paused under the menu | Fades out | — | — |

## How it is built

```
InfinityMode (src/core/game-modes)          owns the game: the pause/resume template, sessions
  └─ InfinityAscent  (src/ui/infinity/ascent/infinity-ascent.js)   the director, one per mode
       ├─ TowerFlight      tower-flight.js     pure motion model (pull, glide, edges, dock, landing)
       ├─ viewMetrics …    ascent-model.js     pure: height, rise, sky, deep, theme shift, crossings
       ├─ TowerMemory      tower-memory.js     big moments by height (LINE_CLEAR / PIECE_LOCK / PERFECT_CLEAR)
       ├─ AscentAudio      ascent-audio.js     synthesized on the effects bus + SoundManager.setMusicMuffle
       ├─ AscentHaptics    ascent-haptics.js   dual-rumble while the gamepad drives the view
       ├─ AscentOverlay    ascent-overlay.js   DOM in the well: ruler, floors, marks, caption, way home, altimeter
       ├─ AscentSkyStage   ascent-sky-stage.js lazy chunk: WebGPU → WebGL2 → CSS veil; hidden at rest
       │    └─ AscentSkyWorld ascent-sky-world.js  ONE full-screen TSL pass, display-space, premultiplied
       └─ loadThemeTints   ascent-tints.js     the sky's colours from the theme's icon
src/core/exploration-signal.js               the pull signal every theme reads (no DOM, no imports)
  ├─ src/themes/shared/camera-breath.js      explorationCrane(): a lift on the camera's own axis
  └─ src/themes/base-theme.js                themeTime(): the safeAnimate timestamp, integrated at the pace asked
```

- **The mode's side.** `_beginExploration()` and `_endExploration()` (renamed from the minimap
  versions) keep the session fences, the paused-loop ownership and the delayed-lerp restore.
  `endExplorationForMenu()` is what `main.js` calls on Escape. The wheel, gamepad-scroll and
  starfield code (≈ 330 lines) left InfinityMode, with its `performance.now()` calls and DOM
  reads in `src/core`.
- **The board.** `BaseBoardScene.setViewOffsetRows()` shows the peek as a presentation offset
  while the game runs (its rows, the follow camera and the theme origins are unchanged). While
  looking, the director drives `updateCameraPosition(top, true)` under manual control, as the
  old minimap drag did. `BoardJuice.setFlight(lean, stretch)` holds a
  `perspective(1600px) rotateX()` tip and a stretch. A held pose needs no frames, and with no
  flight the transform strings are identical to before (`board-juice-transform-writes` digests).
- **Themes.** `applyCameraBreath()` adds the crane to its lift. That covers 60 of 63 themes with
  no per-theme code: 14 move the camera and turn back to their subject, about 46 only turn (they
  look up as the view rises). Aether Tides, Nebula Flow (pure `cameraBreath`) and Wolfhour (own
  camera) do not crane. `BaseTheme.themeTime()` slows the 44 themes whose clock comes from the
  safeAnimate timestamp. The other 19 keep real time: forest, aurora, fall, summer,
  sakura-twilight, verdant-hills, golden-forest, crystal-cave and black-hole step a
  `THREE.Timer`; moonrise-summit and murmuration ignore the timestamp for a clock of their own;
  nimbus-veil, neon-dusk, synthwave-sunset and chromadelic-highway run a copied rAF loop whose
  delta also feeds their resolution scaling; wolfhour, cosmic-noir, rainy-window and misty-lake
  read `performance.now()` or a `THREE.Clock`. Chiral Gold now reads its audio analysis with `realFrameDelta`, so beat detection
  keeps time with the music. Other effects of the slow clock, accepted: theme layout re-reads
  scheduled at 0.5 s and 1.5 s land later, and calm-zone and pointer smoothing react slower.
- **The sky layer.** It is fixed at z-index -1, inserted right after `.background-container`
  (it wins on document order: above the theme, under the well). It is transparent where it
  covers nothing. It is built 1.2 s after the session starts, and one hidden frame compiles its
  single pipeline through `beginAsyncRenderPipelines` (ADR-0020). It draws only while the look
  is present. Renderer kind (ADR-0008): WebGPU-primary node scene with the WebGL2 backend; the
  CSS veil is the last resort and also takes over after a device loss.
- **Gamepad.** The right stick alone looks (dead zone 0.22, curve 1.6, a pull first). R3 held
  looks at once, as before. While looking, a game button (A, B, X, Y, LB, RB, D-pad, left
  stick past 0.6) sends the view home. That press is latched until released, so B does not
  also hard-drop.

## Reduced motion

Settings > Reduce motion or the system preference turns off the theme-layer parallax, the
crane (the signal's `rise` and `speed` are 0), the lean, the streaks, the mote sway and the
star twinkle. The flight home flies straight. The light (night, depths, stars), the sounds,
the overlay and the slow clock stay.

## Ratchets and gates

Lint errors 575 (baseline 599: the deleted files took errors with them). Fitness:
`shader-material:hits` 75 → 68, `core-dom-globals` 409 → 377, `core-nondeterminism`
197 → 192, `resize-listeners` 24 → 22. Baselines were not updated. Typecheck and boundaries
are clean. The URL catalog gains the seven `ascent*` names of the `infinity-ascent`
playground effect.

## Verification

- **Unit tests** (all new): `infinity-ascent-flight` (17: the pull, 60 Hz = 165 Hz, edges,
  dock, idle, landing curve, reduced motion), `infinity-ascent-parts` (15: model, memory,
  signal, tints, rumble, sounds with a fake context, overlay placement), `infinity-ascent-director`
  (4: wheel to commit to pause, the signal and theme shift, game key, idle landing, an outside
  end, menus keep their scrolling, reduced motion), `infinity-ascent-hooks` (11: crane, the slow
  clock is continuous and comes back, flight pose, gamepad latch, music muffle),
  `infinity-ascent-sky-shaders` (the sky at every tier and both blend modes through the WGSL
  and GLSL builders, plus the playground stand-ins). Updated: `infinity-result-lifecycle` (the
  renamed pause owners, the Escape path, the wheel listener per session),
  `phaser-core-presentation` (the peek offset), `infinity-minimap-presentation` (memory beads).
- **Playground** (`playground.html?effect=infinity-ascent`, chrome-devtools MCP on the RTX,
  WebGPU): contact sheets of rest, full night, depths, fast rise and fall, a half-present peek,
  four theme tints, WebGL2, the Low tier, reduced motion and home. The console was clean.
  Tuning they forced: motes read as stars at rest (made faint, they brighten with speed);
  streaks read as rain (longer, tapered, dimmer); the depths were invisible (stronger, taller
  haze); lifting the theme bared a flat band (smaller lift, wide feather); averaged icon colours
  went grey (saturation restored).
- **Real game** (dev server, Sunset, a 70-row test tower built through `lockedPieces`): a notch
  peeks without pausing; the second gives way and pauses. Rising 21 rows: signal weight 0.96,
  time scale 0.28, theme shifted 85 px, sky on WebGPU, the theme stopped once covered. The night
  over the whole world, the ruler, the altimeter and the way-home badge were captured. The
  owner's own scroll down to the floor, and their play right after (a game key ends the look),
  worked in the same session. Console: only Chrome's `powerPreference` notice.
- **Real game in Electron** (one window per backend, the RTX, under the GPU lock; scratch
  script): the WebGPU backend and `forceWebGL=1` gave the same result. Descending to the floor:
  clock 0.25, theme lifted 51 px, altitude 10, the way home "↑ 54". A fast flight up was captured
  mid-motion. Escape: the look ended (signal fading, theme layer restored), and the game stayed
  paused under the settings sheet ("Infinity waits where you left it"). Frame cadence while
  looking (an observation on a loaded machine, before the owner switched the laptop to Quiet
  mode, not a perf-lane measurement): WebGPU 131.6 fps median, p95 8.4 ms, worst 22.8 ms;
  WebGL2 129.9 fps, p95 8.3 ms, worst 11.4 ms. 131.6 Hz is this machine's Electron rAF cadence.
  Console on both: Vite's blocked socket (the harness blocks it), Electron's dev CSP notice,
  Chrome's `powerPreference` notice. The first two shots of each run caught the mode's loading
  cover, which takes the wheel while it is up (as it should). Wait for it to lift before
  driving a look.

## Traps found

- **The first input arrives before any frame of a look.** The motion model had no bounds yet,
  read "nothing to see that way" and dropped the first wheel notch. The director now syncs
  bounds, home and the camera row before every input (`_syncFlight`).
- **Commit from elsewhere.** A commit aimed at the game's camera row instead of where the view
  starts (the map or R3 committing from another place). The target is now
  `start + (pull − shown)`.
- **"Above" and "below".** Rows grow down the tower; `home − top > 0` means the view is ABOVE
  the player's rows. The altimeter had it inverted until a unit test read the words.
- **A test tower must be locked pieces.** `boardGrid` is rebuilt from `lockedPieces` on every
  lock, so cells written straight into the grid vanish.
- **The narrow well.** The way home and the altimeter both lived at the top and collided. The
  way home is now a corner badge, and the altimeter's label is "Altitude" (the HUD's "Height"
  is rows built).
- **A CSS `rotate` property turns the JS translation.** The individual `rotate` (or `scale`,
  `translate`) properties apply AFTER `transform` in the composed matrix, so a bead with
  `rotate: 45deg` and a script-set `transform: translate3d(0, y, 0)` slid diagonally: 0.7·y left
  and 0.7·y down. The diamond is now drawn on `::before`, and the element only translates.
- **Strict energy conservation hides the speed.** Streaks that spread all of a mote's light
  along their length went nearly black at real flight speeds (60+ rows a second), the opposite
  of "speed you can see". The light now spreads as `(r / (r + L))^0.45`, with a speed gain of
  2.2: faint at 15 rows a second, plain at 60.

## Open

- No physical gamepad was tested (stick, latch and rumble are unit-tested only).
- No perf-lane reading at the owner's 120 fps cap (ADR-0016). The layer is one full-screen pass,
  drawn only while looking; the theme stops under the full night.
- The sounds were not heard in a capture (unit-tested; the MCP session had no user gesture).
- No phone or portrait check of the overlay beyond the CSS rules.
- The 19 themes on their own clocks keep their pace while you look (listed above), and three
  themes do not crane. A `Timer` theme could follow with `timer.setTimescale()`, but black-hole's
  resolution scaling reads the same delta, and the four copied loops would need their animation
  delta split from their scaling delta first.
