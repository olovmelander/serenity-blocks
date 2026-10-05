# Breathing and Hale sessions — rebuilt (October 2026)

A from-scratch rebuild of everything breathing: the twelve worlds, the guide that sits over
them, the Breathing tab, and the Hale sessions menu and flow. It replaces the two earlier passes
recorded in [BREATHING_IMMERSIVE_OVERHAUL_2026-10.md](BREATHING_IMMERSIVE_OVERHAUL_2026-10.md).

## What the player gets

**A breathing practice is a place, not an overlay.** Starting the guide fades the game out
behind a full-screen world that breathes with you. Over it sit only a phase ("Breathe in"), the
seconds left, one cue line, and a bar that shows the whole breath with each phase as long as it
lasts.

| World | Rhythm | What the breath does |
| --- | --- | --- |
| Aurora Dreams | 5 · 2 · 7 · 2 | Curtains climb and brighten over a snow range and its lake |
| Sacred Geometry | 4 · 4 · 4 · 4 | Light travels one side of a square per phase; nested solids open |
| Moonlit Waters | 4 · 7 · 8 | The halo opens and the moon-path on the sea widens |
| Solar Flare | 3 · 1 · 3 · 1 | The disc swells and the corona streams out |
| Heart Glow | 5 · 5 | A lotus opens ring by ring around a glowing heart |
| Crystal Prism | 4 · 4 · 4 | A beam through a turning quartz point fans into a spectrum |
| Volcanic Fire | 2 · 1 | A flame leaps from cracked basalt |
| Ocean Tide | 4 · 4 | A wave runs up the sand and slides back, seen from above |
| Zen Garden | 6 · 3 · 6 · 3 | A ring of moonlight crosses raked furrows and returns |
| Cosmic Nebula | 5 · 3 · 5 · 3 | A spiral galaxy unwinds its arms |
| Ancient Forest | 4 · 2 · 6 · 2 | Light pours between old trunks in morning mist |
| Electric Storm | 3 · 2 · 4 · 1 | Filaments in a plasma globe reach for the glass |

**Breathing tab.** One featured world with its artwork, what it does and the shape of its
breath, a **Begin** button that starts it and closes the Hub, and the twelve worlds as picture
cards. Two preferences: words and counts, and *Begin with Serenity Mode* (the old
"auto-start" setting was saved but never read; it works now).

**Hale sessions.** The Hub tab is a catalogue of four sessions with their real length, rounds
and longest hold. **Begin** opens a full-screen preparation screen (what the session is, a
timeline of its stages, an optional intention, a voice-guidance switch), then a countdown, then
the session itself in the guide, then a result. During a session the guide shows the stage's
title and instruction, breaths or time left in the stage, minutes to go, and **Pause** and
**End** buttons.

What changed in how sessions work:

- **Pause is a real pause.** It used to restart the current stage on resume. Every piece of
  stage work now runs on timers that hold their remaining time, and the voice is held, not
  stopped.
- **Each session has its own journey of worlds**, the same every time (`SESSION_WORLDS`),
  instead of a random world per stage.
- **Ending asks once.** Escape or End on a session opens a confirmation; on a standalone
  practice it ends at once.
- **Breathing always holds gameplay.** A standalone practice started from the Hub in a
  falling-block mode keeps the game paused until it ends, like a session
  (`SerenityHub.holdsGameplay()`).
- Completed sessions are counted locally (`localStorage`, key `serenity.haleSessions`) and
  shown as one line in the catalogue.

Keys in a practice: `←` `→` change world, `Esc` ends. In a session: `Space` pauses, `Esc` asks
to end. Serenity Mode's own `Space` (toggle) and `T` (cycle) bindings are unchanged.

## Rendering

**Renderer kind (ADR-0008): WebGPU-primary node scene with the WebGL2 compatibility backend.**
The old `threejs-breathing-renderer.js` was a classic `WebGLRenderer` with three raw-GLSL
`ShaderMaterial`s and was listed as a permanent WebGL holdout. It is gone; breathing now uses
three r186 `WebGPURenderer` and TSL like the themes, so the holdout list is one entry shorter.

| File | Role |
| --- | --- |
| `src/ui/effects/breathing/breathing-guide.js` | Boot-path module: timing, DOM, CSS fallback. Loads the stage lazily. |
| `breath-catalogue.js`, `breath-clock.js` | The twelve worlds as data; breath timing as pure functions. |
| `stage/breath-stage.js` | Owns the renderer, canvas and frame loop. WebGPU, then WebGL2. |
| `stage/breath-world-host.js` | Owns the scene, camera, post pipeline and world lifecycle. Renderer-agnostic. |
| `stage/breath-tsl.js`, `breath-motes.js`, `breath-geometry.js` | Shared TSL (uniforms, noise, stars), the instanced mote cloud, mesh builders. |
| `worlds/*.js` | One module per world. |
| `src/playground/effects/breathing.effect.js` | The same host and worlds in the playground. |

**Fallback ladder.** WebGPU; `forceWebGL` when `navigator.gpu` is missing, `?forceWebGL=1` is
set, or WebGPU init fails or times out; and if neither starts, or the device is lost, the guide
stays on a CSS orb driven by the same `--breath` value, with all words and timing intact.

**How a world is built.** A world returns a backdrop (a `vec3` node painted on one clip-space
quad), optional meshes, an optional mote cloud, bloom settings and an `update`. The host's
camera maps the z = 0 plane onto the backdrop's own coordinate space (short screen axis −1..1,
origin on the hero, which sits `focus` above screen centre to leave room for the words), so
painted light and real geometry line up. Four worlds use real geometry: Sacred Geometry (edge
tubes of three solids), Heart Glow (23 petal meshes hinged from JS), Crystal Prism (a flat-shaded
lathe and shards) and Cosmic Nebula (up to 9,000 instanced star sprites placed in the vertex
stage).

**Breath inputs** (`createBreathUniforms`): `breath` 0..1, `phase`, `phaseT`, `time`,
`breathInt` (the integral of `breath`, for flow that quickens with the inhale without jumping),
`calm` (retention and integration slow the scene), `ext`, `focus`, `px`.

**World changes are a blink.** The canvas dips to dark over 0.4 s, the next world's pipelines
compile through `async-render-pipelines.js` while nothing is visible (ADR-0020), and the canvas
returns. Nothing compiles on screen.

**The theme stops drawing while it is covered.** Once the guide is opaque it sets
`window.isThemeCovered`; `BaseTheme.shouldRenderFrame()` returns false until the guide leaves.
A parked stage is disposed 45 s after the guide closes, so no second GPU device lingers.

| Tier | Pixel ratio cap | Pixel budget | Noise octaves | Motes | Bloom | Cadence |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Extreme | 2 | 3.6 MP | 6 | 100 % | half-res | display |
| Ultra | 1.75 | 3.0 MP | 5 | 100 % | half-res | display |
| High | 1.5 | 2.4 MP | 5 | 100 % | half-res | display |
| Medium | 1.25 | 1.5 MP | 5 | 70 % | 0.35 | display |
| Low | 1 | 0.9 MP | 4 | 45 % | none (direct render) | 30 Hz |
| Minimal | 1 | 0.5 MP | 3 | 25 % | none (direct render) | 30 Hz |

The tier follows the game's Effect Quality setting, read when the stage is created (a change
applies the next time a practice starts after the stage has been released); touch and small
screens are capped at Low.
(The previous renderer defined tiers but nothing ever called its `setQuality`.) Reduced motion
freezes ambient drift and keeps the breath.

### Things this pass paid for

- **A masked-out term must stay bounded.** A rim light written as `exp(k · signedDistance)`
  grew to 10⁸ on the far side of its mask, and `mix(a, b, 1)` (evaluated as `a + (b − a)`)
  cancelled the sky behind it to black. Clamp the distance before the `exp`.
- **Never reverse `smoothstep`'s edges.** Fine in WGSL, undefined in GLSL, and this code runs on
  both. Use `fadeOut(lo, hi, x)` from `breath-tsl.js`.
- **Value noise reads as blocks** at low octave counts; the worlds use quintic gradient noise.
- **Perspective needs a floor.** The moon-path's wavelets are `1 / depth`; on a tall phone the
  near water turned into blobs the size of the screen until the stretch was capped.

## Verification

`scripts/capture-breathing.mjs` renders every world from the playground in one page
(`window.__BREATH_LAB__` switches world and breath, `__PLAYGROUND__.seek` draws the frame):

```sh
node scripts/run-electron.mjs scripts/capture-breathing.mjs --baseUrl=http://127.0.0.1:5173 --posters
node scripts/run-electron.mjs scripts/capture-breathing.mjs --baseUrl=http://127.0.0.1:5173 --sheet=pairs,portrait,webgl
```

`--posters` writes the stills the Hub's cards use (`public/assets/breathing/<id>.webp`); rerun
it after changing a world. Sheets and in-game captures from this pass are in
[reports/breathing-overhaul-2026-10](../reports/breathing-overhaul-2026-10/README.md).

What was checked, and how:

- **Every world, empty and full, on WebGPU** (RTX 3070, Electron): contact sheets, no console
  errors or validation messages.
- **Every world on the WebGL2 backend** (`forceWebGL=1`): same artwork, no errors.
- **Every world at 390×844 on the Low tier** (no post pipeline).
- **The real game**, driven end to end at 1440×900 and 390×844: Serenity Mode → guide → world
  change → Hub Breathing tab → Hale catalogue → preparation → countdown → session (arrive, a
  breathing round, pause, end confirmation, a hold) → result → dismissed. No console errors;
  gameplay hold released at the end.
- **Pause ownership in single-player**, read from the running mode: paused under the guide,
  through a session's preparation, stages and result; resumed when each is dismissed; a direct
  `resumeGame()` refused meanwhile.
- **Unit tests:** timing and catalogue (`breath-clock`), every world built and disposed without
  a GPU (`breath-worlds`), the guide (`breathing-guide`), both tabs, the session manager's
  pause/resume and world journey, Hub pause ownership.

Not measured: frame cost on an integrated GPU or a physical phone. The tiers are set by
reasoning, not by a perf-lane reading (ADR-0016), and should be treated that way until one
exists. A full session was not played through in real time; stage changes were stepped.
