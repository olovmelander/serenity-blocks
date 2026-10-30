# Breathing worlds and Hale sessions — a performance pass (October 2026)

A static audit and code-level pass over everything that runs while you breathe: the guide and its
frame loop, the stage and world host, the lens, the Hale session flow, and the twelve worlds in
all their moods. It was done in a cloud session with no GPU, so **nothing here is a frame-time
figure** (ADR-0016): the pass changes code, and proves that the pictures did not change.

**The look is untouched.** Every world in every mood, and four more configurations, render
pixel-identical to the commit before this pass (max abs diff 0 over 120 frames; see
Verification). The guide's own CSS changed only in what is painted where nobody can see it.

## What changed

### A world that never came back (bug)

`BreathStage.start()` said "ready" only after a world swap. A parked stage (kept 45 s after a
practice ends, so a quick return does not rebuild the renderer) started again **on the world it
already showed** swapped nothing, so it never said "ready", and the guide — which had dropped its
`is-live` mark when the practice ended — kept the canvas at opacity 0. The player saw only the CSS
orb, while the hidden world went on drawing every frame at full cost. It happened on:

- ending a practice and beginning the same world again within 45 s;
- in Serenity Mode, "Over the theme" then "Own world" on the same world.

A Hale session escaped it by accident (its first `setTechnique` re-asks after `start()`).
`start()` now draws a fresh frame and says "ready" when it starts on the world it already shows.
Reproduced in a real browser on the commit before (the world never returned within 20 s) and
fixed after (back in 6 ms); `tests/unit/breath-stage.test.js` (new) pins it.

### The orb repainted behind the world every frame

The CSS orb (`.breath-guide__fallback`) is the guide's light while a world loads, between worlds
and without a GPU. Its glow is a gradient whose alpha follows `--breath`, which the guide writes
every frame — so the orb was repainted every frame for the whole practice, under an opaque canvas
that hid it completely. It is now `visibility: hidden` once the world has dawned
(`.is-live:not(.is-paused)`, after the same 1.3 s the canvas takes to reach full opacity), and
comes back at once when the world dips between worlds or the practice pauses (the paused world is
translucent over it). Main-thread `Paint` events in a DevTools trace over ~70 frames of a live
practice: **74 before, 9 after** (an event count from the trace, not a timing).

### Sessions open on their world

A session used to start its stage when the guide opened: the renderer, the world's node build and
its pipelines all after the countdown, behind the CSS orb (seconds, on a first compile). Now:

- **The countdown is the world's time to compile.** `SessionsTab.startCountdown()` →
  `BreathworkSessionManager.prepareSession(id)` → `BreathingGuide.prepare(world)` →
  `BreathStage.prepare(world)`: the stage starts its renderer and compiles the session's first
  world behind the closed guide, with no frame loop (the same hidden swap a world change uses,
  ADR-0020). The session then opens on it: in the headless check the world was live 3 ms after
  `start()`, against ~0.8 s cold. On the WebGL2 backend only the renderer starts (its shaders
  compile synchronously, which would stall the countdown instead).
- **A prepared stage is parked like any other:** one timer (`_parkStage`) gives the GPU device
  back 45 s after the last reason to keep it, if no practice starts.
- **The stage's code is fetched ahead** (`BreathingGuide.preloadStage()`, no GPU work) when the
  Breathing tab is shown and when a session's preparation screen opens. A failed fetch is no
  longer cached forever: the next start tries again.

### The frame loop makes no garbage

Per frame, the guide, the host and the worlds used to build fresh objects, arrays and closures
(the breath state, the cue's words, a world's update state, the light-shaft source and its helper
closure, the lens state, `forEach` closures, spread rotations). They now fill objects they own,
loop with indices, and compare numbers before they build strings:

| Where | Per frame before | Now |
| --- | --- | --- |
| `BreathingGuide._animate` / `_render` / `_words` | breath state, words object (spreads in a guided stage), a closure per segment, `toFixed` strings for every segment and for `--breath` even in a hold | one state object, one words object; strings only for values that changed |
| `cycleSeconds` (every frame) | `reduce` with a closure | a loop (same sum, same order) |
| `BreathWorldHost._push` / `_shaftSource` | world update state, light source + closure, lens state | three objects filled in place |
| `BreathWorldHost._fitCamera` | projection matrix and its inverse rebuilt every frame | rebuilt only when the screen's shape changes (the camera still moves every frame) |
| Heart Glow (`lotus.js`, `lotus-flower.js`) | pose object, two `forEach` over a fresh array, petal `forEach` | filled pose, plain loops |
| Sacred Geometry (`sacred-solids.js`, `sacred.js`) | four arrays of turns, two nested `forEach`, spread rotations, destructuring | a closed-form `turn()`, plain loops |
| Ocean Tide, Crystal Prism | a closure and two arrays (every ramp evaluated), a `forEach` with destructuring | module-level ramps (only the phase's own runs), a plain loop |

And ten times a second during a session: the guide merges progress in place and writes
`data-session-phase` only when the stage changes.

### Stars and meteors do their work only where they show

Two helpers in `stage/breath-tsl.js` paint the skies of eight worlds:

- **`starLayer`** (three per `starfield`) did a star's whole work in every cell — hashes, a pow,
  two exps, a sin, three divides — and then multiplied it by `step(pick, amount)`, which is 0 in
  most cells (about two in three of Cosmic Nebula's far sky at full density, nine in ten on a
  phone). It now asks first. The cells are tens of pixels wide, so whole groups of pixels take the
  same path.
- **`shootingStar`** computed the meteor's streak on every sky pixel and multiplied it by its
  envelope, which is 0 between meteors (about 97 % of the time). The envelope is the same for every
  pixel, so the streak now sits in a branch that costs nothing while no meteor is on — the rule the
  moods record states for every event, which this helper had missed. The caller's nodes are pinned
  before the branch (a node first built inside it would read as unset wherever it is used again).

Both are exact: where the old code multiplied by exactly 0 the new code writes 0, and elsewhere it
computes the same expression. Checked on all eight worlds in every mood, and on ten frames where a
meteor is crossing (found by emulating the event timetable in f32, a meteor confirmed in frame).

### The worlds' own shaders

A read-only audit of every world (five parallel passes) found that most of each backdrop's
remaining cost is work whose result is multiplied by exactly zero over large parts of the screen:
the floor computed in the sky, the sea on dry sand, 48 painted quartz points evaluated at every
pixel, trunks shaded where no trunk stands. Each skip below tests the very factor that would have
been 0 (or a bound proved from the noise's range, |gnoise − 0.5| ≤ 0.72, so every fbm lies in
[−0.22, 1.22], with margins), keeps a zero in the skipped term's slot so sums keep their order, and
pins with `.toVar()` before the branch every node that is used again after it (a node first built
inside a branch reads as unset after it). Savings are op-count estimates from the audit, not
measurements.

| World | What no longer runs where it is exactly 0 | Est. saving |
| --- | --- | --- |
| Cosmic Nebula | the galaxy's arms, lanes and knots beyond r0 1.07 (41–71 % of the disc quad); the five spiked stars' spikes and cores off their own strips; the far sky's dark lanes where their mask is 0; the cluster's star cores beyond 18.5 px; the hanging pillars on every screen too wide to show them (a uniform test) | ~300/px on the overlay, ~540 per skipped disc fragment, ~90/px for the lanes, ~140/px on wide screens |
| Moonlit Waters | each land layer outside its own stretch of horizon (ridge, island, headland, cape: 11 gnoise per land pixel down to ~3, in the sky and its reflection); the cloud bank above its proven crown and near the moon; Sea Fog's lighthouse lamp built once instead of twice | ~470 per land-band pixel, ~36/px for the bank |

## Verification

**Pixel identity** (`scripts/breathing-pixel-identity.mjs`, new). It renders the playground's
breathing host in headless Chromium (SwiftShader WebGPU, ANGLE for WebGL2 — the setup of
`scripts/capture-breathing-headless.mjs`) to PNG, once from a pristine worktree of the commit
before and once from this branch, and compares every pixel (`--capture`, then `--compare`):

| Set | Frames |
| --- | ---: |
| Every mood of every world, High, 1280 × 720, mid-inhale | 48 |
| Every world, empty and full lungs (phase 3 and 1), High | 24 |
| Every world at another moment and visit seed (t 47.3, seed 0.21, out-breath) | 12 |
| Every world on the phone tier: Low, 390 × 844, portrait focus | 12 |
| Every world on Minimal (no post pipeline: the direct render path) | 12 |
| Every world on the WebGL2 backend, Medium | 12 |

Two captures of the same build agree to the bit, so any difference would be real: there was
none (max abs diff 0 in all 120).

**The guide in a real browser** (the shipped guide module and CSS, the real stage on SwiftShader
WebGPU): the orb's visibility through dawn, pause and resume; the trace's paint counts; the
restart bug before and after; a prepared start. **Tests:** `breath-stage.test.js` (new: first
world, restart on the same world, restart on another, prepare without a frame loop, a start during
a prepare, WebGL2, stop and dispose); `breathing-guide.test.js` (prepare, parking, a practice that
starts first, preload); `hale-session-practice.test.js` (`prepareSession`); the full unit suite,
typecheck and lint (no new warnings).

## Not measured, and open

- **Frame time on hardware.** The paint count and the allocations removed are facts about the
  code; what they buy in milliseconds on the integrated GPU or a phone is unmeasured (ADR-0016).
- **The next world of a session** still compiles at its stage change (behind the dip). It could
  compile during the stage before it, into the scene pass's own target; not done here.
- **Display-rate tiers on high-refresh screens** (High and above draw at 120–165 Hz there).
  A 60 Hz cap would roughly halve their GPU work for slow breathing motion, but it changes the
  smoothness the owner asked to keep: the owner's call.
