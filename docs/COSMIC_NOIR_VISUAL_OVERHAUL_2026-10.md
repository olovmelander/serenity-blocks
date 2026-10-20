# Cosmic Noir — smoke in the searchlight (2026-10)

Status: **Reference** (shipped design and evidence). Replaces the legacy theme in full: the old
`cosmic-noir-theme.js` (4,895 lines: a ringed planet under a smoke nebula, ShaderMaterial and node
materials side by side, an EffectComposer fallback, WebGPU compute sparks) and its four helper
modules, its performance effect, its phase-6 validation script and its eight test suites are gone.
[COSMIC_NOIR_PERF_AUDIT_2026-06-30.md](COSMIC_NOIR_PERF_AUDIT_2026-06-30.md) describes the old theme.

Evidence: [reports/cosmic-noir-overhaul/](../reports/cosmic-noir-overhaul/) (listed in §7).

## 1. The ask and what changed

Olov, 2026-10-20: "Start working on Cosmic Noir!!!", after asking which themes most needed better
visuals and effects. Cosmic Noir was one of the five named.

The new picture: **a black-and-white film of deep space.** A pulsar turns inside the derelict
shutter cage of a lantern that hangs beside the board. Its two beams sweep like a lighthouse's
through drifting interstellar smoke. Most of the frame is black. The smoke shows only where a beam
crosses it, and where a beam crosses the slats it is cut into a fan of shafts (light through
venetian blinds). The whole picture is graded as a print on one film stock at a time.

| | Before | After |
| --- | --- | --- |
| Subject | Ringed planet, grey smoke nebula | A lighthouse pulsar in a slatted lantern, beams through smoke |
| Light | Even grey nebula glow | Hard shafts in deep black; the smoke lit only by the beams, the core and events |
| Grade | Fixed monochrome | Film: characteristic curve, soft black point, five toning stocks drifting with the clock |
| Renderer | WebGPU + GLSL twins, compute, MRT | One node renderer on both backends, two passes, no compute |
| Code | 4,895-line theme plus four modules | World, volume, post and core modules shared with the playground effect |

## 2. The picture

**Composition** (`pulsarAnchor()` in `cosmic-noir-core.js`). The camera stands at the origin and
turns so that the pulsar (24 units down −Z) hangs in the free zone left of the card: x ≈ 0.205,
y 0.34 of the screen at 16:9, a little further in on wider frames. On an upright phone it hangs
above the board (x 0.5, y 0.12). The beams sweep across the card and the right-hand free zone. A
slow dolly drift and the pointer move the camera by under half a unit.

**The lantern** (`CAGE`). It is a cylinder of 22 vertical slats (radius 1.7, half-height 2.3) on the
pulsar's spin axis, with closed lids that leak 30 % round their rims. At rest a slat covers 0.45 of
each pitch; a chain opens the blinds toward 0.25. The cage turns slowly the other way (150 s a
turn). It is drawn at full resolution: dark slats with a thin rim of light in front, the lit inner
faces of the far wall behind, and the smoke held inside the lantern glowing round the core (§3).

**The beams** (`PULSAR`). The spin axis leans a little toward the camera (a three-quarter view). The
beams leave at 60° from it, so the upper beam's cone passes about 19° from the lens at its nearest:
a blaze and a lens glare, never a white-out. Each beam has a gaussian core 11° wide (wide enough to
span two or three slat gaps, so a beam comes out as a fan) and a dim 26° skirt. The beams turn once
every 14 s at rest; each step of a chain adds 32 % to the rate, up to nine steps.

**The smoke** (`SMOKE`, `cosmic-noir-bake.js`). A 64³ tileable volume is baked on the CPU, in a worker
on a first visit, with four fields per texel: masses, filaments, billows and a slow field that
opens dark gaps. It is read stretched 2.4 times wider than it is tall, warped by the slow field,
lying in layers, and drifting on a slow wind. A thin haze (0.05) fills the envelope, so that a beam
is a shaft even between the masses. A clear corridor runs from the eye to the lantern, keeping 22 %
of the smoke as a veil, so that drifting smoke never hides the picture's light for a minute (found
at t ≈ 110–160 s, before the corridor).

**The film** (`cosmic-noir-post.js`). The post works on luminance only:
- a soft black point, `L²/(L + 0.02)`, which sinks the thinnest haze into black;
- an ACES-like characteristic curve;
- the stock's toning: shadow and highlight tints whose luminance is about 1, so a stock never
  changes how bright the print is, over a near-black paper;
- a vignette, mid-tone grain at 24 frames a second, and white dust specks on the negative;
- calm zones over the card and the HUD.

There is no bloom on any tier. three's BloomNode (with a max-channel knee) was built and measured
in the game: its eleven passes cost about 3.4 ms of CPU a frame to encode and drew almost nothing
the analytic lens (§3) does not. The playground's `bloom=1` still builds it, for that A/B.

Measured on the playground at High, t = 12: luminance p1 / p50 / p99 = 2 / 19 / 173 (sRGB 0–255).
The first draft read 12 / 31 / 121: a grey print.

## 3. Drawing it

Two passes per frame.

1. **The smoke target** (`createSmoke` in `cosmic-noir-volume.js`). It is drawn at a fraction of the
   drawing buffer (the tier's `scale`), in half float where the renderer can filter it, else RGBA8
   with a square-root encoding.
   - Each pixel marches front to back with log-spaced steps, starting at a different place
     (interleaved gradient noise).
   - Lit in the march: the beams' skirts, barred by the cage with a penumbra that widens with
     distance; the core's glow, through the slats' average; puffs and their embers; a faint
     starlight ambient. One read toward the pulsar shades it (`taps`).
   - **The beams' cores are integrated in closed form**, not marched. Near the ray's nearest point
     to the beam line, the angle off the beam grows as √(α₀² + (Δt·sinθ/s)²), so the gaussian core
     integrates to exp(−(α₀/w)²)·√π·w·|s|/sinθ, capped at 7 units where the ray runs along the beam.
     The smoke there is read once, at the beam's own thickness (a softplus edge), and shaded,
     barred and phased once. Marched, a beam this thin came out as a texel checker.
   - **The light echoes are thin shells, also in closed form.** Where a step crosses a shell, the
     smoke there is lit over the crossing's length, w·√π·R/√(R² − d²), which is long at the limb
     and so draws a ring. Only the masses light, never the haze, and the shell's face is kept at 30 %
     of its limb (it slices the dense smoke round the lantern into a disc). An echo slows as it
     spreads and stops short of the camera (inside it, a shell is a wall). Marched, an echo lit a
     translucent plate; in the game, a first closed-form version still lit the whole left side.
   - The march stops at the lantern's wall, slat or gap. A slat-by-slat cut in this smaller target
     aliased into dots at Minimal.
2. **The backdrop** (one full-screen triangle at the screen's own resolution). It draws:
   - the far stars, in up to three lattices with a fixed angular footprint;
   - the pulsar's point, the lantern's slats, rims and lids;
   - the inside of the lantern through the gaps, in closed form: the core's light over the chord,
     ∫ R²/(R² + d² + (t − t꜀)²) dt = R²/k·[atan((t_b − t꜀)/k) − atan((t_a − t꜀)/k)], and the beams'
     cores where they leave;
   - the smoke target through a small tent;
   - the lens halo, the 8-point star-filter spikes, and the glare when a beam looks at us
     (attenuated by the smoke in front).

There is no compute and no MRT. The scene pass has one output. The WebGL2 backend draws the same
picture.

## 4. Event language

Staged per player slot by the director (`cosmic-noir-director.js`, copied from Stellar Velocity) and
flushed on frame time. The chain is the true combo from `ComboTracker` (ADR-0011).

| Event | Response |
| --- | --- |
| Lock | Smoke billows out of the card's nearer side edge at the piece's height, lit from within by a dying ember (its own billows; a hard drop puffs harder) and drifting off. |
| Clear | The pulsar flares; one light echo per line leaves it, 0.14 s apart, slowing as it spreads, drawing the smoke's shape in rings. |
| Chain | The lighthouse spins up (an integrated rate, never a phase jump) and the blinds open. |
| Four lines | The flashbulb: the print turns to its own negative for 0.06 s and fades back in 0.2 s; four echoes, a big flare, the cage's slats spin. Under reduced motion it is a flash instead. |
| T-spin | The cage spins and settles back to its own slow turn. |
| Level up | A reel change: two cue marks flash at the top right of the picture, a second apart, and the print turns one stock along (eased over about two seconds). A small echo leaves the pulsar. |

## 5. The film stocks: the clock and the level

Five stocks, walked as a line there and back (cyanotype – silver – selenium – sepia – platinum –
sepia – …), so that neighbours are always close tones. Level 1 starts on silver.

- **The clock alone** carries the print one stock every `STOCK_STEP` = 100 s. It rests on each stock
  for `STOCK_REST` = 0.15 of a step at each end and turns in between, so it is visibly moving within
  the first minute (place 0.6 at 60 s).
- **A level-up** adds one step (a jump counts at most three). The steps and the clock simply add:
  place = steps + time/100. A new game never turns the print back: its first level-up is one more
  step.
- A rebuilt world (a quality change, a lost GPU) takes up the level and the steps through
  `getCarry()`/`takeCarry()`. The clock survives a rebuild in place and is reset only by `stop()`.

Unit tests (`tests/unit/cosmic-noir-core.test.js`, `cosmic-noir-world.test.js`) pin the drift at
level 1 from real frames, the rests, the walk there and back with no jump, the level steps, the
carry, and that every stock's tones keep luminance at about 1.

## 6. Tiers

| Tier | March | Shading tap | Fine threads | Target scale | Noise | Star layers | Dust |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Minimal | 12 | — (×0.6) | — | 0.34 | 32³ | 1 | — |
| Low | 16 | — (×0.6) | — | 0.40 | 48³ | 2 | yes |
| Medium | 22 | 1 | yes | 0.45 | 64³ | 2 | yes |
| High | 30 | 1 | yes | 0.55 | 64³ | 3 | yes |
| Ultra | 38 | 1 | yes | 0.65 | 64³ | 3 | yes |
| Extreme | 46 | 1 | yes | 0.75 | 64³ | 3 | yes |

Every tier keeps the whole picture and every event.

## 7. Validation

All evidence is in [reports/cosmic-noir-overhaul/](../reports/cosmic-noir-overhaul/).

**Playground** (`?effect=cosmic-noir`, contact sheets from `window.__cosmicNoir.sheet()`):
- `sweep-high-playground.jpg`: t = 0–16 s at High. The beams turn through the frame; the fans of
  shafts at 10 and 12 s; a beam toward the lens at 4 s.
- `events-playground.jpg`: lock, hard drop, one- and three-line clears, four lines (the negative and
  after), T-spin, level-up (with the cue mark) and a chain of 8 (the blinds open).
- `stocks-clock-and-level-playground.jpg`: level 1 at 12, 60, 112, 212, 312 and 412 s (silver,
  turning, selenium, sepia, platinum, sepia), and levels 2, 3 and 5 at 12 s.
- `minimal-playground.jpg`: the Minimal tier (the lantern drawn sharp at a 0.34 target).
- `icon-candidates-80px.png`: the icon candidates beside their neighbours at the picker's 80 px.
- WebGL2 (`forceWebGL=1`) and every tier rendered with no console errors.

**The real game** (the dev server in Electron, WebGPU on the RTX 3070, 1600 × 852, scripted play
through the app's own event bus; the probe is in the git-ignored `.cache/noir/perf/`):
- `ingame-rest-high.jpg`, `ingame-lock-high.jpg`, `ingame-clear3-high.jpg`,
  `ingame-four-lines-negative-high.jpg`, `ingame-levelup-high.jpg`.
- `ingame-webgl2-rest.jpg`, `ingame-webgl2-four-lines.jpg`: the WebGL2 backend in the game.
- `ingame-level1-clock-000s.jpg` … `-300s.jpg`: the game at level 1, the clock pinned with
  `cosmicNoirTime` at 0, 100, 200 and 300 s: silver, selenium, sepia, platinum.
- The clock alone, live: with no level change the stock place moved 0.300 in 29.96 s (1.4536 →
  1.7665, of which 0.013 was a level-up still easing in). A game over in that window started a new
  game at level 1, and the print kept its step.
- Console: no WebGPU or WebGL errors. A warning on page unload, "Failed to unsubscribe runtime
  event … reading 'indexOf'", came from `GameModeManager`'s unsubscribe after the manager had
  cleared its handlers (every adapter copied from Stellar Velocity hits it). It is now a no-op
  there, with a test.

**Tests**: `tests/unit/cosmic-noir-core.test.js`, `-world.test.js`, `-bake-worker.test.js`,
`-theme.test.js`, `-director.test.js`, `-composition.test.js` (the last three ported from Stellar
Velocity's), `game-mode-manager-unsubscribe.test.js`. The core suite found two stocks whose shadow
tone darkened the print (cyanotype 0.88, selenium 0.95 luminance), since normalised.

### Performance

`reports/cosmic-noir-overhaul/perf-rtx3070.txt` (in the game, on mains power):

| Tier | GPU p50 rest / storm | Uncapped fps (rest) | CPU per frame (p50) |
| --- | --- | --- | --- |
| Low | 0.34 / 0.47 ms | 821 | 0.4 ms |
| Medium | 1.2 / 1.4 ms | 693 | 0.4 ms |
| High | 2.0 / 2.4 ms | 441 | 0.6 ms |
| Ultra | 3.1 / 3.8 ms | 289 | 0.5 ms |
| Extreme | 4.7 / 5.7 ms | 198 | 1.0 ms |

With vsync on (the display's ~131 Hz), High and Extreme hold 130 fps through a storm of events, and
the WebGL2 backend holds 130 fps at High. At High the smoke target is ~1.5 ms of the GPU frame; the
backdrop and the film are 0.26 ms. Before the bloom came out, High ran 152 fps uncapped with 4.3 ms
of CPU a frame.

Not measured: an integrated GPU, a phone, a window larger than 1600 × 900.

## 8. Files and parameters

`src/themes/cosmic-noir/`:
- `cosmic-noir-core.js`: constants and three-free maths (stocks, beams, cage, events, anchor);
- `cosmic-noir-bake.js`, `-bakes.js`, `-bake.worker.js`: the smoke bake, in a worker on a first
  visit;
- `cosmic-noir-quality.js`: the tiers;
- `cosmic-noir-tsl.js`: the shared TSL helpers and uniforms;
- `cosmic-noir-volume.js`: the smoke pass and the backdrop;
- `cosmic-noir-world.js`: the choreography, clocks, events and camera;
- `cosmic-noir-post.js`: the film;
- `cosmic-noir-composition.js`, `-director.js`: copied from Stellar Velocity;
- `cosmic-noir-theme.js`: the adapter (lifecycle, renderer, settings, layout, recovery, capture
  flags).

The playground effect is `src/playground/effects/cosmic-noir.effect.js`; `window.__cosmicNoir.sheet()`
draws contact sheets of any moment and event. Capture flags: `cosmicNoirForceWebGL`, `cosmicNoirTime`,
`cosmicNoirFixedDt`, `cosmicNoirParts` (sky, smoke) and `cosmicNoirFalseColor`. The 19 parameters of
the old theme are retired (see [URL_PARAMETER_REFERENCE.md](URL_PARAMETER_REFERENCE.md)). The theme
has left the dual-state allowlist: it has no GLSL twin.

Icon: the lantern in the playground's icon lens (`?effect=cosmic-noir&t=11&icon=1&iconFov=26`),
centre square of the frame dropped 12 % of its height and cropped to 90 %, a noir grade (black point
0.16, gamma 1.3, gain 1.3), and a circle. It is my pick and awaits Olov's word.
