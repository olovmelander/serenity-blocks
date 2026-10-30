# Breathing worlds and Hale sessions — a performance pass (October 2026)

A static audit and code-level pass over everything that runs while you breathe: the guide and its
frame loop, the stage and world host, the lens, the Hale session flow, and the twelve worlds in
all their moods. It was done in a cloud session with no GPU, so **nothing in its first part is a
frame-time figure** (ADR-0016): the pass changes code, and proves that the pictures did not change.
A second session then measured on a discrete GPU (an RTX 5080 Laptop GPU) and changed code only where
those numbers showed a cost: **"Measured on hardware"**, below — the cost of every world and tier,
stage changes, the display's rate against a 60 Hz cap, and three changes made from the measurements
(a session's last stage change that built its world again, Ancient Forest's trunk rows, `voronoi`).

**The look is untouched.** All twelve worlds render pixel-identical to the commit before this
pass on the reference renderer: every mood, empty and full lungs, another moment, the phone tier,
Minimal and the WebGL2 backend (max abs diff 0 over 120 frames, plus ten frames with a meteor
crossing; see Verification). The guide's own CSS changed only in what is painted where nobody can
see it. One later change does alter a picture, on purpose: Ocean Tide's turn ashore (its own
follow-up, at the end).

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

### …and change worlds without compiling (follow-up)

A session moves through several worlds (Base: the forest, then round after round the storm, the
cosmos and coherence; First and Elixir change at every stage). Each stage change used to build the
next world and compile its shaders behind the dip, on the CSS orb, for as long as the driver took.
Now the next stage's world is ready before the stage changes:

- **Built and compiled ahead.** Each stage asks for the next one's world:
  `BreathworkSessionManager._runPhase()` → `BreathingGuide.prepareNext(world)` →
  `BreathStage.prepareNext()`. Two seconds after the world on screen has settled,
  `BreathWorldHost.prepareWorld()` builds the next world off screen (its mood and visit seed picked
  as a visit would pick them, nothing on screen touched) and `compilePrepared()` compiles it while
  frames keep drawing. The stage change's `setWorld()` adopts those very objects: nothing is built
  again, and the world is back as the dip ends. What was built ahead is dropped when the practice
  ends or the plan changes, and disposed only once a compile in flight is done with it.
- **Compiled for the scene pass's own context.** three r186 keys a material's shader build by its
  render context (the scene pass draws one call deep, inside the lens's pipeline) and builds it
  after `compileAsync`'s first await, reading whatever target is bound by then. A plain
  `compileAsync` built every shader for another context, and the stage change built and compiled
  them all again (the pipeline instrument showed the same material's fragment shader made twice,
  its functions in another order). The host compiles through the Odyssey warm-up's
  `compileGroupUnderLiveLoop` (`rendering/odyssey/warmup/post-target-compile.js`, pinned by its
  contract tests), which compiles in exactly that context while live frames see their own.
- **The lens no longer rebuilds for light shafts.** A world with shafts (Ancient Forest, Electric
  Storm) used to swap the lens's output graph, which made the shaft passes, the output quad
  (synchronously) and the bloom passes again at every change into or out of it: 14 pipelines. The
  shaft passes are now in the one graph from the start and simply stop rendering while a world has
  none (`RTTNode.autoUpdate`); their last image is added at strength 0, exactly nothing, for one
  texture read. They render once on the first frame, so their two pipelines are made behind the
  first dip with the rest of the lens's. A world change is uniforms only.
- **Where it does not apply.** The WebGL2 backend compiles synchronously (building ahead would
  stall the world on screen), and the lightest tier draws through three's frame-buffer target,
  which those helpers do not cover: both change worlds as before.

From the stage change's request to the world back on screen, in the headless check (the shipped
guide and stage on SwiftShader WebGPU, High; timings are functional evidence only, ADR-0016):

| Stage change | Cold | Built ahead |
| --- | ---: | ---: |
| Ocean Tide → Moonlit Waters | 1,239 ms, 3 pipelines made at the change | 591 ms, none |
| Ocean Tide → Ancient Forest (shafts on) | 1,467 ms, 9 (23 before the lens stopped rebuilding) | 500 ms, none |

What is left is the dip itself (420 ms) and three settle frames. Building ahead took ~3.3 s of the
stage before; the world on screen kept drawing meanwhile (worst frame gap 133 ms, against 83 ms at
rest, on the software renderer). Every world built ahead and adopted renders exactly as one built
cold: every mood on High and every world on Low and Minimal, 72 frames, max abs diff 0. With the
lens's one graph the full 120-frame set and the ten meteor frames still match the commit before
this pass.

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
| Sacred Geometry (`sacred-solids.js`, `sacred.js`) | four arrays of turns, two nested `forEach`, spread rotations, destructuring | a closed-form `tumble()`, plain loops |
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
| Volcanic Fire | the far wall's skyline noise away from its proven band (a stand-in a unit above or below makes the same sky and wall decisions); the far cone's skyline above its highest point; the fountain's turbulence, tongues and jets outside the column's reach; the plume's light where its density is 0, and its test tightened to where it can be nonzero; the finer craquelure on whole crust; stars under the deck and low in the glow | ~360/px for the wall, 25–200/px for the fountain, ~55–120/px for the cone |
| Crystal Prism | the 48 painted quartz points (far field, floor and vault druses, near points), each now tested against the circle outside which its cover is exactly 0 (shapes evaluated per pixel: floor 27 → ~1.5, vault 13 → ~0.6, near 6 → ~0.5; the floor bound includes this world's camera drift); the wet floor above the horizon, and its caustics where no fan light lands; the rock's lip and grain below its proven reach; the fan's nine bands where no light arrives; dust, beam dust and glints where their light is 0; the mist bank's noise where the bank is 0; at total internal reflection, the light that would have left (its weight rounds to exactly 0) | ~10k → ~1.5k/px for the points, ~1.5k/px above the horizon, ~1.1k/px for the rock |
| Solar Flare | stars under the photosphere's glow; the galaxy rift's noise where it is under 1.7e-9 (1 − rift·0.85 is exactly 1.0 in f32 there); Golden Star's coronal loops grouped so each arcade's hub is tested once, not three times (same arcs, same order); Total Eclipse's mottle off the moon; Blue Star's ringlets off the ring sheet; the solar wind's glints outside their ramps and in unpicked cells | ~290/px where the stars skip, ~240/px on half the sky for the rift, ~240/px near the star for the loops |
| Sacred Geometry | the floor (inscription, footprint, ripples, gloss) above the horizon, where its mask is 0 — the inscription's derivatives are now taken before the branch, in uniform control flow; the gate's reflection where nothing lies under it; the floor mist above its bank; the rose window inside the radius no tracery reaches (worked out in the shader from the pixel size, so it holds at every resolution); the aura and rays below the gate; the previous path light except during its fade; the four corner lights computed once instead of ten times | ~25–30 of the backdrop's ~75 noise-equivalents/px (one ≈ a gnoise, ~180 ops) |
| Heart Glow | the pond, its pads and its mist in the sky, where there is no water (about half a landscape frame); each lily pad beyond its reach (also in the flower's mirror); leaf shading off the pads; the tree line above its proven crest; the reeds and buds outside their boxes; the lanterns beyond their halo; the floating lanterns' paper outside its box; stars low in the sky; the moon's maria off the disc and under the water | ~25–35 of ~65 noise-equivalents/px |
| Ancient Forest | the forest floor above the horizon; each trunk row's bark in the gaps between its trunks (most of the row); the undergrowth outside its proven band; the canopy's leaves where the cover is under their mask's threshold, and the whole canopy far below its top (tall screens); the ferns away from the bottom corners (every frond's reach bounded from its length, droop and angle); the bird between flights | ~9k of the backdrop's ~24k ops/px |
| Zen Garden | the moss's noise and colour away from the islands' fuzzy edges and the near border; the breath ring's shimmer where the ring is 0; clouds and stars below the horizon; the hedge above its tallest dome, the wall above its cap; maple leaves and blossoms beyond their outline; on the stones, the shadow march once the shade is total, the cloud shade where no direct light falls, and the mist's noise above the mist | ~1.7k of ~8.4k ops/px (up to ~3.5k on the costliest stone pixels) |
| Aurora Dreams | each curtain between its segments, in the moods whose curtains break; the hash the hem's jog shares with its pleat; the spruce where no tree stands, and each tree row outside its band of the horizon; the snow ranges' face above the skyline; the storm's red crown below its fade-in; the moon's face off its disc | ~1.5k of ~7.5k ops/px |
| Electric Storm | each filament thread before its start and past its tip — and inside the electrode, where every thread of a filament is dark and runs straight, all of them at once, leaving only their contact blooms; the blooms while no filament touches the glass; the globe's interior outside its glass; the electrode ball's surface off the ball; the fern while nothing touches; Rain on the Window's city light rows away from their own band; each out-of-focus room light outside its square; the base outside its box; the table and its mirror image above the horizon | ~4k per globe pixel for the filaments, ~1.5k/px for the city rows, ~400/px for the room lights |
| Ocean Tide | the sea's surface and colour on dry sand (no water there, so no depth: the bed is not bent and the sand is kept, the reef proved ≥ 2.2 units out); the foam and plankton above the water's reach where nothing is stranded; the chop's noise, the foam lace (moods without plankton), the caustic nets and the sun's glitter path where their distance fades are exactly 0; the ray and the gull between their visits | ~1.7k per dry pixel, ~2k on the 30–36 % of the frame above the reach |

One fix rides along in Zen Garden: on the far side of a stone the shadow's softness went negative and
reversed smoothstep's edges (undefined in GLSL, so on the WebGL2 path), where the shadow is
multiplied by 0 anyway. The softness is now clamped there; no pixel changed on either backend.

**Exact zeros were not enough.** A value computed inside a branch and read after it can round
differently: the shader compiler folds constants through straight-line code ((x + c1) − c2,
(x·c1)·c2, a·b + a·c → a·(b + c)) but not through a branch's merge. Ocean Tide's first version
computed its gusts inside the dry-sand branch and moved one or two pixels a frame by one 8-bit
level; the gusts are computed before the branch again, Electric Storm's blooms each keep their own
branch so their sum is not refactored, and every value that leaves a branch was checked against the
folding rules. The pixel test caught what the proofs could not.

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

That identity is exact on the reference renderer (Tint's SPIR-V, optimized by spirv-opt inside
SwiftShader). A GPU driver compiles the same WGSL its own way, and may fuse or fold a restructured
expression differently from the old one: on hardware a rare pixel can move by one 8-bit level, the
same order as the difference between two drivers.

**The guide in a real browser** (the shipped guide module and CSS, the real stage on SwiftShader
WebGPU): the orb's visibility through dawn, pause and resume; the trace's paint counts; the
restart bug before and after; a prepared start. **Tests:** `breath-stage.test.js` (new: first
world, restart on the same world, restart on another, prepare without a frame loop, a start during
a prepare, WebGL2, stop and dispose); `breathing-guide.test.js` (prepare, parking, a practice that
starts first, preload); `hale-session-practice.test.js` (`prepareSession`); the full unit suite
(1,271 files) and typecheck; and CI's other gates: the lint ratchet (at its baseline, 9 fewer
warnings), boundaries, release gates, the build and its boot closure, IP strings, the Pages
artifact and the perf budgets.

## Follow-up: Ocean Tide turns ashore in one motion (a change of look, on purpose)

The owner found Ocean Tide's turn from the out-breath into the in-breath "a bit hacky": the water
should feel smooth and connected all the time. Unlike everything above, this changes the picture,
on purpose, and only Ocean Tide's.

**What was wrong.** On the first frame of the in-breath three things stepped at once. The bore (the
incoming wave's white water) jumped from its own path onto the swash front, and the out-breath
look (the wave's hump and lit face, its uneven peaks, the glassy film and stranded bubbles on the
sand) began to switch through a first-order ease, which sets off at full speed when its target
steps. The picture popped, then went on changing for half a second while the water itself stood
still at its reversal.

**What changed** (`worlds/ocean.js`; the swash's per-frame state is now `createSwash()`):

- The incoming wave comes to rest on the very line where the backwash stops (the front at empty
  lungs, its lobes and all), and glides onto the front as the in-breath begins: the uprush carries
  it on from where it is. Late in the out-breath it runs a few pixels from its old path, its shape
  easing into the waterline's.
- The out-breath look gives way over the first third of the in-breath (`outFor`), as the uprush
  gathers, not in the half second after the turn.
- What the breath still steps glides (`glide`: critically damped, it starts from rest), so nothing
  sets off at full speed. The white water meets itself at every turn of every pattern: the natural
  pace of the rest stages (4·1·6·1) used to dim it through the pause on empty lungs and whiten it
  again at the turn.
- A fresh world starts where the breath is: nothing glides in at the start of a practice.

Mean change from one frame to the next (15 fps), from the last out-breath frame to the first
in-breath frame:

| | Whole frame | Near the shore |
| --- | --- | --- |
| Before | 0.58 → **2.16** | 0.94 → **4.15** |
| Now | 0.58 → 0.53, lowest 0.37 a third of a second on | 0.93 → 0.80, lowest 0.45 |

Motion now eases into the reversal and out of it, with one low point where the water turns. The
turn into the out-breath is unchanged (within 0.01), and 4·1·6·1 has no step either.

**Verification.** The real stage stepped at 30 Hz on SwiftShader WebGPU (High, 640 × 360, the
first mood, visit seed 0.5) and captured at 15 fps across both turns of 4·0·4·0 and 4·1·6·1, with no
console errors; moving the swash into `createSwash()` left all 96 frames pixel-identical. Frames
differ from before from the second quarter of the out-breath to a third into the in-breath, and
by under 0.15 on average elsewhere (the white water's glide). `breath-ocean-swash.test.js` (new)
steps the swash at 60 Hz through 4·0·4·0, 4·0·6·0 and 4·1·6·1: no value steps more than 0.05 in a
frame or changes pace by more than 0.015 (the old swash's eases kicked by 0.05, its bore jumped by
1); the bore moves out to the break only once its white water is spent (under 0.025, as before);
the out-breath look changes slowest in the in-breath's first tenth; and a fresh world's first
frame is a pinned frame's.

## Measured on hardware (2026-10-30)

A second session measured on a GPU what the first could not, then changed code only where the
numbers showed a cost. Everything here comes from **one machine: a laptop with a discrete NVIDIA
RTX 5080 Laptop GPU** (driver 573.24, Windows 11, Dawn on D3D12), in Electron 44.9.3
(Chromium 152) on that GPU, in Lenovo's Balanced mode (the GPU held to 95 W, the owner's choice).
Its panel is 2560 × 1600 at 240 Hz and 150 % scaling. In this laptop's hybrid graphics mode
Chromium presents at about 180 frames a second there (the ceiling THEME_FLEET_240 §6 found);
twice during the session the panel switched to the NVIDIA GPU directly and presentation rose to
240 (below). **Integrated GPUs, other discrete GPUs and phones stay unmeasured**: the ranking below
says where they would hurt first, nothing about how much.

### The instrument

`scripts/breathing-gpu-bench.mjs` (Electron on the discrete GPU; every page logs and checks its
adapter) loads the playground's breathing host — the shipping host and worlds — with:

- **the stage's drawing buffer** (`stage=1`): the canvas sized as `BreathStage.resize()` sizes it
  for the tier, through the same function (`breathPixelRatio()`, now shared by both);
- **the stage's renderer** (`antialias=0`): the playground builds its renderer with 4× MSAA, and a
  `pass()` scene node takes the renderer's sample count, so without this the bench would have timed
  a multisampled scene pass that the game never draws;
- **pinned content**: clock `t = 12`, the breath (empty: 0 in the empty hold; mid: 0.5 on the
  in-breath; full: 1 in the full hold), the first mood, visit seed 0.5.

GPU time is three's own per-frame figure, the sum of a frame's render passes from timestamp
queries, taken **for every frame of every resolved batch, each frame once**: the bench wraps the
query pool's resolve and reads every pass of every frame it holds, so nothing is dwell-weighted
(ADR-0016). The playground's own reference sample (the last frame of each batch) is recorded beside
it and agrees to a timestamp step. Passes are labelled by their render target: the scene pass, the
12 bloom passes, the 2 light-shaft passes, the output quad (on Minimal, the one direct draw). Each
reading also records the drawing buffer, draw calls and triangles (constant through the reading, or
it is void), the window's size before and after (void if it moved), nvidia-smi's power and P-state,
and an idle check of the GPU before every page (void if anything else was drawing on it).

Every reading was **repeated a full pass apart**; a figure is kept only where two repeats agree
(p50 within 5 % or two 65.536 µs timestamp steps, p95 within 10 % or two steps, the same draws and
buffer). Four cells that disagreed got a third repeat, and the closest agreeing pair is the figure.
The rule is pinned by `tests/unit/breathing-bench-summary.test.js`.

**Why the tables are uncapped.** At the display's rate these worlds are a light load, and the
driver moves the GPU between power states within a single reading (P0 to P8 in three seconds): the
same frame then takes anywhere from 0.6 to 2.5 ms, and a world's figure follows the clock more than
its shader (Aurora Dreams read 1.18 ms on Extreme and 1.70 ms on Ultra, which does less). That can
neither rank worlds nor prove a change. So the tables are measured as the theme fleet was:
**uncapped** (vsync and the frame-rate limit off), where the GPU works at its power limit and its
clock holds still; repeats then agree and the tiers fall in the order of their work. These figures
are *work at a steady clock*, not what a player's frame costs at 180 Hz. What a player gets (the
display's rate, the driver's clocks, CPU time and power) is measured separately below. Uncapped CPU
times include waiting on the swap chain and are left out.

### Where the time goes

All twelve worlds, every tier, empty, mid and full lungs, on two screens; 432 readings a screen,
216 of 216 cells with agreeing repeats on each, none void. GPU ms per frame, p50 / p95, mid lungs:

**The laptop's panel**, 2560 × 1600 at a scale of 1.5 (1706 × 1066 CSS pixels; drawing buffers Extreme 2400 × 1499, Ultra 2191 × 1369, High 1959 × 1224, Medium 1549 × 968, Low 1200 × 749, Minimal 894 × 558):

| World | Extreme | Ultra | High | Medium | Low | Minimal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 5.01 / 5.34 | 4.03 / 4.26 | 3.15 / 3.38 | 1.97 / 2.10 | 1.11 / 1.28 | 0.59 / 0.62 |
| Cosmic Nebula | 3.67 / 3.87 | 2.92 / 3.11 | 2.36 / 2.49 | 1.44 / 1.61 | 0.75 / 0.88 | 0.39 / 0.46 |
| Zen Garden | 3.18 / 3.54 | 2.52 / 2.79 | 2.13 / 2.36 | 1.38 / 1.54 | 0.85 / 0.95 | 0.52 / 0.66 |
| Crystal Prism | 2.92 / 3.15 | 2.36 / 2.52 | 1.90 / 2.06 | 1.11 / 1.25 | 0.52 / 0.69 | 0.33 / 0.36 |
| Ocean Tide | 2.56 / 2.72 | 2.10 / 2.29 | 1.67 / 1.80 | 0.98 / 1.18 | 0.49 / 0.59 | 0.26 / 0.33 |
| Sacred Geometry | 2.52 / 2.75 | 1.97 / 2.23 | 1.57 / 1.74 | 0.92 / 1.05 | 0.46 / 0.59 | 0.26 / 0.33 |
| Aurora Dreams | 2.42 / 2.69 | 1.97 / 2.16 | 1.57 / 1.74 | 0.92 / 1.08 | 0.39 / 0.52 | 0.26 / 0.33 |
| Solar Flare | 1.93 / 2.13 | 1.57 / 1.74 | 1.25 / 1.41 | 0.69 / 0.85 | 0.39 / 0.52 | 0.20 / 0.23 |
| Heart Glow | 1.90 / 2.10 | 1.54 / 1.74 | 1.21 / 1.34 | 0.72 / 0.82 | 0.33 / 0.46 | 0.20 / 0.26 |
| Volcanic Fire | 1.84 / 2.03 | 1.51 / 1.67 | 1.18 / 1.34 | 0.72 / 0.85 | 0.39 / 0.46 | 0.20 / 0.26 |
| Moonlit Waters | 1.61 / 1.80 | 1.25 / 1.38 | 0.98 / 1.15 | 0.59 / 0.72 | 0.33 / 0.43 | 0.16 / 0.23 |
| Electric Storm | 1.57 / 1.77 | 1.18 / 1.31 | 0.88 / 1.02 | 0.46 / 0.56 | 0.20 / 0.36 | 0.13 / 0.13 |

**1920 × 1080 at a scale of 1** (a common desktop monitor; Extreme, Ultra and High all draw 1920 × 1080 there, Medium 1632 × 918, Low 1264 × 711, Minimal 942 × 530, so the top three differ only in their shaders):

| World | Extreme | Ultra | High | Medium | Low | Minimal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 2.92 / 3.11 | 2.75 / 2.95 | 2.79 / 2.98 | 1.97 / 2.10 | 1.15 / 1.28 | 0.56 / 0.62 |
| Cosmic Nebula | 2.13 / 2.26 | 2.03 / 2.20 | 2.03 / 2.23 | 1.44 / 1.57 | 0.72 / 0.85 | 0.39 / 0.46 |
| Zen Garden | 1.97 / 2.13 | 1.84 / 2.00 | 1.84 / 2.06 | 1.31 / 1.44 | 0.82 / 0.92 | 0.52 / 0.59 |
| Crystal Prism | 1.67 / 1.87 | 1.61 / 1.77 | 1.61 / 1.74 | 1.08 / 1.25 | 0.56 / 0.69 | 0.33 / 0.39 |
| Ocean Tide | 1.47 / 1.67 | 1.44 / 1.57 | 1.44 / 1.57 | 1.02 / 1.11 | 0.49 / 0.59 | 0.26 / 0.33 |
| Sacred Geometry | 1.47 / 1.64 | 1.38 / 1.54 | 1.34 / 1.51 | 0.92 / 1.05 | 0.46 / 0.59 | 0.26 / 0.33 |
| Aurora Dreams | 1.34 / 1.54 | 1.34 / 1.51 | 1.31 / 1.51 | 0.95 / 1.08 | 0.39 / 0.52 | 0.26 / 0.26 |
| Solar Flare | 1.11 / 1.25 | 1.05 / 1.18 | 1.05 / 1.21 | 0.66 / 0.79 | 0.36 / 0.46 | 0.16 / 0.23 |
| Heart Glow | 1.08 / 1.25 | 1.05 / 1.18 | 1.02 / 1.18 | 0.66 / 0.79 | 0.33 / 0.46 | 0.20 / 0.26 |
| Volcanic Fire | 1.08 / 1.21 | 1.02 / 1.18 | 1.02 / 1.15 | 0.69 / 0.82 | 0.33 / 0.46 | 0.20 / 0.26 |
| Moonlit Waters | 0.95 / 1.05 | 0.88 / 0.98 | 0.85 / 0.98 | 0.59 / 0.72 | 0.33 / 0.43 | 0.20 / 0.26 |
| Electric Storm | 0.88 / 1.02 | 0.79 / 0.92 | 0.72 / 0.85 | 0.39 / 0.56 | 0.20 / 0.33 | 0.10 / 0.13 |

The breath barely moves the cost: across empty, mid and full lungs a cell changes by a timestamp
step or two, except Crystal Prism (empty lungs about 10 % lighter on every tier), Ocean Tide (full
lungs about 10 % heavier: the sea climbs the sand) and Electric Storm (full lungs up to 15 % heavier
on its lightest tiers: more filaments reach the glass). The full three-lung tables are in
`reports/breathing-gpu-2026-10/`.

**The heaviest worlds** are Ancient Forest, by a margin at every tier (about 40 % above the next),
then Cosmic Nebula and Zen Garden, then Crystal Prism. The two suspects named before measuring are
not: Sacred Geometry (50 draws, the largest shaders) is mid-table and Moonlit Waters second
lightest. **Inside them, the scene pass is the frame**:

Native resolution, mid lungs, mean GPU ms per pass:

| World | Tier | Scene | Bloom | Shafts | Output | Draws |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | Extreme | 4.53 | 0.14 | 0.28 | 0.07 | 18 |
| Ancient Forest | High | 2.87 | 0.11 | 0.15 | 0.05 | 18 |
| Cosmic Nebula | Extreme | 3.42 | 0.15 | — | 0.08 | 19 |
| Cosmic Nebula | High | 2.18 | 0.11 | — | 0.05 | 19 |
| Zen Garden | Extreme | 2.99 | 0.13 | — | 0.07 | 16 |
| Zen Garden | High | 2.01 | 0.09 | — | 0.05 | 16 |
| Crystal Prism | Extreme | 2.41 | 0.15 | 0.28 | 0.07 | 24 |
| Crystal Prism | High | 1.57 | 0.12 | 0.15 | 0.05 | 24 |
| Ocean Tide | Extreme | 2.33 | 0.14 | — | 0.08 | 14 |
| Ocean Tide | High | 1.51 | 0.11 | — | 0.05 | 14 |
| Sacred Geometry | Extreme | 2.03 | 0.14 | 0.28 | 0.07 | 50 |
| Sacred Geometry | High | 1.26 | 0.12 | 0.15 | 0.05 | 50 |
| Aurora Dreams | Extreme | 2.22 | 0.15 | — | 0.07 | 15 |
| Aurora Dreams | High | 1.40 | 0.11 | — | 0.05 | 15 |
| Solar Flare | Extreme | 1.41 | 0.15 | 0.29 | 0.08 | 16 |
| Solar Flare | High | 0.92 | 0.12 | 0.15 | 0.05 | 16 |
| Heart Glow | Extreme | 1.39 | 0.15 | 0.29 | 0.08 | 32 |
| Heart Glow | High | 0.89 | 0.12 | 0.15 | 0.05 | 32 |
| Volcanic Fire | Extreme | 1.63 | 0.14 | — | 0.07 | 18 |
| Volcanic Fire | High | 1.06 | 0.11 | — | 0.05 | 18 |
| Moonlit Waters | Extreme | 1.39 | 0.15 | — | 0.07 | 14 |
| Moonlit Waters | High | 0.84 | 0.11 | — | 0.05 | 14 |
| Electric Storm | Extreme | 1.08 | 0.15 | 0.27 | 0.07 | 18 |
| Electric Storm | High | 0.59 | 0.11 | 0.14 | 0.05 | 18 |

The lens costs the same in every world: bloom 0.09–0.15 ms, light shafts 0.15–0.29 ms where a world
has them, output 0.05–0.08 ms. Everything else is the backdrop's shader.

**Inside Ancient Forest's scene pass** (native, Extreme, a leave-one-out census through the bench's
page variants and a temporary flag, never committed: each part removed in turn, two repeats): of its
4.65 / 4.57 ms the five trunk rows take 2.20 (their mist wisps 1.00, their bark shading 0.85), the
canopy and its leaves 1.75 (removing the leaves removes the noise fields that only feed them too);
on High, of 3.02 / 3.05 ms, the rows 1.49, the canopy 1.10, the bark 0.55. The smaller parts (floor,
haze, the rows' bends, painted beams, undergrowth, motes, ferns: 0.06–0.35 ms each on Extreme) sit
within the repeats' spread. Rows overlap their parts, so these do not add up.

### What a player's frame costs, as shipped

At the display's rate (about 180 Hz in hybrid mode), the driver's own clocks, native resolution,
mid lungs, two repeats each. GPU ms at these clocks are quoted only where the repeats agree; power
is nvidia-smi's board power through the window (the idle GPU drew 5–16 W before each page).

| World | Extreme: power (W) | Extreme: frame interval p50 / p95 (ms) | Extreme: GPU ms | High: power | Low (30 fps): power |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ancient Forest | 95 / 95 | 5.7 / 6.4, 5.6 / 6.3 | 4.75 | 76 / 76 | 11 / 11 |
| Cosmic Nebula | 83 / 83 | 5.5 / 6.2, 5.5 / 6.3 | 3.08 | 56 / 62 | 10 / 10 |
| Zen Garden | 76 / 77 | 5.5 / 6.2 | 2.88 | 63 / 62 | 10 / 10 |
| Crystal Prism | 64 / 71 | 5.6 / 6.3, 5.5 / 6.2 | — | 49 / 51 | 10 / 10 |
| Aurora Dreams | 65 / 63 | 5.5 / 6.3, 5.6 / 6.2 | — | 44 / 47 | 9 / 11 |
| Ocean Tide | 59 / 68 | 5.5 / 6.2, 5.4 / 6.2 | — | 46 / 45 | 9 / 9 |
| Sacred Geometry | 69 / 58 | 5.5 / 6.2, 5.5 / 6.3 | — | 46 / 45 | 10 / 10 |
| Solar Flare | 48 / 49 | 5.5 / 6.3, 5.6 / 6.3 | — | 41 / 39 | 9 / 9 |
| Heart Glow | 49 / 48 | 5.6 / 6.2, 5.5 / 6.2 | — | 39 / 39 | 9 / 9 |
| Volcanic Fire | 47 / 48 | 5.6 / 6.3, 5.4 / 6.2 | — | 38 / 47 | 9 / 9 |
| Electric Storm | 44 / 44 | 5.6 / 6.3, 5.5 / 6.3 | — | 35 / 36 | 8 / 8 |
| Moonlit Waters | 43 / 43 | 5.6 / 6.3, 5.6 / 6.2 | 1.51 | 43 / 44 | 9 / 9 |

- **Every world keeps the display's cadence on every tier but one cell**: Ancient Forest on Extreme
  at native resolution runs the GPU at its 95 W limit and slips just below it (frames every 5.6–5.7
  ms against 5.4–5.6 for the rest, p95 6.3–6.4). At 1920 × 1080 on High every world holds it
  (5.5–5.6 ms; 35–73 W).
- **Power is the cost the RTX actually pays**: 43–95 W on Extreme, 35–76 W on High, against 8–11 W
  on Low at its 30 fps cap, for a practice that moves at the pace of a breath.
- **CPU per frame is no cost**: the playground's frame callback took 0.4–0.8 ms p50 in every world
  and tier (Chromium's timer resolution is 0.1 ms).

### Stage changes on hardware

`scripts/breathing-stage-change-probe.mjs` boots the real game, builds a session manager over the
real guide (as the Hub does) and runs Hale First Breath (Zen Garden → Heart Glow → Sacred Geometry →
Moonlit Waters → Zen Garden) and Base (Ancient Forest → Electric Storm with light shafts → Cosmic
Nebula → Heart Glow → Electric Storm) through their stage changes, on High at native resolution.
Harness-only shortcuts: the stages are shortened in the probe's own copy of the plan (12–24 s each),
holds are timed, sound is off. Two modes on the same commit: **built ahead** (as shipped) and
**cold** (the probe swaps the live stage's `prepareNext` for one that drops the request). One warm-up
run of each session first (so the GPU shader cache holds every world, as for a returning player),
then two rounds of each mode interleaved; every change below repeats within about 10 %, and no run was
throttled (the probe voids any stage whose frames came slower than every 20 ms). The display
presented at 240 Hz throughout (4.2 ms frames).

**(b) From the stage change to the world back on screen**, and what the change itself made:

| Change | Built ahead | Cold | Made at the change, cold |
| --- | ---: | ---: | --- |
| Zen Garden → Heart Glow | 436 / 439 ms | 761 / 715 ms | 15–16 pipelines, 26–28 shader modules |
| Heart Glow → Sacred Geometry | 436 / 435 ms | 1,370 / 1,234 ms | 28 pipelines, 38 modules |
| Sacred Geometry → Moonlit Waters | 435 / 431 ms | 2,015 / 2,010 ms | 1 pipeline, 2 modules |
| Moonlit Waters → Zen Garden (last) | 1,803 / 1,628 ms (not adopted: the bug below) | 1,619 / 1,539 ms | 3 pipelines, 6 modules |
| Ancient Forest → Electric Storm | 432 / 434 ms | 668 / 685 ms | 3 pipelines, 6 modules |
| Electric Storm → Cosmic Nebula | 434 / 434 ms | 1,334 / 1,251 ms | 6 pipelines, 10 modules |
| Cosmic Nebula → Heart Glow | 434 / 432 ms | 1,025 / 928 ms | 15–16 pipelines, 26–28 modules |
| Heart Glow → Electric Storm | 436 / 436 ms | 769 / 686 ms | 3 pipelines, 6 modules |

Built ahead, the world is back as the 420 ms dip ends, a frame or two later; no shader module is
made at the change, and at most 12 pipelines whose descriptors the driver already holds (each
resolved within 2 ms). Cold, the change waits 0.7–2.0 s on the CSS orb for its shaders and pipelines
(D3D12 compiles were not slower than SwiftShader's here: the cloud session's 1.2–1.5 s are in the same
range). The worst cold change is Moonlit Waters', whose two shaders are the largest compile.

**The last stage change, fixed.** Every First Breath run above shows it: the change into the closing stage was not adopted and built its world cold (1,803 / 1,628 ms built ahead, as slow as the cold mode's 1,619 / 1,539), after paying for building it ahead. With the fix ("What changed", 1), two runs of First Breath on the change's commit: every change, the last included, back in 432–441 ms and adopted; the last one 433 / 435 ms, with no pipeline or shader module made at it.

**(a) What building ahead costs the world on screen.** Two seconds after a stage settles, the next
world is built (1–10 ms on the main thread) and compiled (0.5–1.7 s, its shaders built in steps that
yield to the frame loop, its pipelines made on the driver's workers). Through that window, frames
come late; through the same stretch of a stage with nothing built, they do not:

| While compiling ahead | Frames over 1.5 display intervals | Worst frame | Same stretch, cold |
| --- | ---: | ---: | ---: |
| Heart Glow, for Sacred Geometry (0.93–0.95 s) | 16 of 181, 16 of 186 | 50 / 46 ms | 8 / 5 ms |
| Sacred Geometry, for Moonlit Waters (1.5–1.7 s) | 22 of 362, 2 of 348 | 54 / 50 ms | 8 / 8 ms |
| Moonlit Waters, for Zen Garden (1.2–1.3 s) | 3 of 298, 4 of 266 | 33 / 29 ms | 4 / 5 ms |
| Electric Storm, for Cosmic Nebula (1.0 s) | 8 of 228, 21 of 181 | 29 / 33 ms | 8 / 5 ms |
| Cosmic Nebula, for Heart Glow (0.78 s) | 20 of 116, 24 of 114 | 54 / 50 ms | 5 / 5 ms |
| Heart Glow, for Electric Storm (0.47–0.48 s) | 10 of 93, 7 of 99 | 29 / 29 ms | 12 / 17 ms |

So building ahead does cost the world on screen frames: once a stage, for half a second to a second
and a half, a few frames take up to 50 ms (a dozen display intervals at 240 Hz), where the world at
rest keeps its cadence. That is the price of the change above (back in 0.43 s instead of 0.7–2.0 s,
behind the dip either way). Where the long frames come from was not traced; the likeliest source is
the main thread, since three builds each shader stage of a material in one uninterrupted step and the
backdrops' fragment shaders are the largest (such a step cannot be split from outside three). It is
left as it is: whether to move that work, and where, is a choice of feel (options in "Not measured,
and open").

**First visits.** From starting a practice on a world no stage has shown (the Breathing tab's path:
the guide makes its renderer, builds the world and compiles it behind the hidden canvas) to the world
on screen, High, native; the CSS orb breathes meanwhile. Two runs, one with an empty Chromium shader
cache (a fresh profile) and one warm:

| World | Empty Chromium cache | Warm |
| --- | ---: | ---: |
| Zen Garden | 2,514 ms | 2,573 ms |
| Moonlit Waters | 1,388 ms | 1,313 ms |
| Ancient Forest | 1,379 ms | 1,300 ms |
| Cosmic Nebula | 959 ms | 918 ms |
| Crystal Prism | 926 ms | 943 ms |
| Sacred Geometry | 851 ms | 893 ms |

The renderer itself is ready about 0.13–0.2 s in. An empty Chromium cache changed nothing measurable:
the NVIDIA driver keeps its own cache of compiled shaders for the whole machine, which this session
did not empty (it serves every other application too), so a first visit on a machine that has never
compiled these shaders is unmeasured. Zen Garden is the slowest to appear by a second. A Hale session
hides this behind its countdown (its first world is prepared then); a practice started from the
Breathing tab shows the CSS orb this long, then the world fades in.

### The display's rate against a 60 Hz cap (the owner's decision)

High and above draw at the display's rate (`frameInterval: 0`); on this laptop that is 180–240 frames
a second, not the 120–165 the first pass assumed. Measured at native resolution, mid lungs, with the
panel presenting at 238 Hz, two rounds of each arm alternating (the playground's new `maxFps=60` cap
skips ticks as the stage's own cap does). Board power from nvidia-smi through a 6 s window; the idle
GPU drew 12–18 W before each page.

| World | Tier | Display rate: presented, power | Capped at 60 Hz: power |
| --- | --- | ---: | ---: |
| Ancient Forest | Extreme | 185 / 189 Hz (cannot hold 240), 95 / 95 W | 43 / 41 W |
| Crystal Prism | Extreme | 238 Hz, 94 / 93 W | 33 / 30 W |
| Aurora Dreams | Extreme | 238 Hz, 85 / 86 W | 30 / 27 W |
| Electric Storm | Extreme | 238 Hz, 61 / 58 W | 26 / 23 W |
| Ancient Forest | High | 238 Hz, 94 / 94 W | 30 / 34 W |
| Crystal Prism | High | 238 Hz, 75 / 80 W | 24 / 32 W |
| Aurora Dreams | High | 238 Hz, 72 / 72 W | 22 / 28 W |
| Electric Storm | High | 238 Hz, 54 / 56 W | 19 / 24 W |

A frame costs the GPU about the same either way (capped, the GPU idles between frames in a lower
power state, so a frame takes the same or a little longer); a cap simply draws a quarter of the
frames. Board power falls to 30–45 % of what the same world draws at 238 Hz; above the idle GPU's,
to between a tenth and a third. What it costs is smoothness:
everything on screen moves in 16.7 ms steps instead of 4.2 ms ones. The breath and the camera are slow,
but motes, falling leaves, meteors and lightning cross the screen fast enough for 60 Hz steps to read as
judder on a 240 Hz panel. **No cap was added**: the owner keeps smoothness first. Ways to have some of
both, for later:

- a cap only on battery (the display then times out after 3 minutes idle too, and the GPU's power
  matters most);
- half the display's rate (120 on this panel) rather than 60;
- the cap only on Extreme and Ultra, which buy resolution and are the hungriest (Ancient Forest on
  Extreme cannot hold 240 anyway);
- a setting, so the player chooses.

### What changed, from the measurements

Three changes, each measured before and after with the same instrument (native, uncapped, Extreme
and High, mid lungs, the committed branch on one dev server and the change on another, interleaved
A B A B; repeats agree within each arm):

1. **A session's last stage change built its world again** (a bug, found by the stage-change probe).
   `BreathworkSessionManager._runPhase()` asks for the stage's world (`setTechnique`, whose swap
   adopts what was built ahead only after the 420 ms dip) and, in the same moment, for the next
   stage's (`prepareNext`). The last stage has none, and `BreathStage.prepareNext(null)` dropped
   what was built ahead at once, before the swap could take it: every session's last change built
   and compiled its world behind the dip, cold. `prepareNext(null)` now drops it only once a change
   under way is done, and only if nothing has been asked for meanwhile
   (`tests/unit/breath-stage.test.js`: the last change adopts before anything is dropped; a request
   during the change stands). Pixels untouched. Its effect on hardware is in the stage-change
   table above.
2. **`voronoi` hashes one cell, not nine** (`stage/breath-tsl.js`). The cell id was hashed for all
   nine cells of the search and the nearest one's kept; now the search keeps the nearest cell and
   hashes it once. The same cell, so the same value: exact. Used by Ancient Forest (leaves, floor
   dapples), Moonlit Waters, Ocean Tide and Volcanic Fire. Ancient Forest's scene pass on Extreme:
   4.72 / 4.72 → 4.62 / 4.62 ms (−2.3 %); on High and in the other three worlds the change is
   inside the repeats' spread (below what two rounds resolve).
3. **Ancient Forest's trunk rows work out a trunk only where one can stand** (`worlds/forest.js`).
   Every row computed its trunks' bend noise and edge mask at every pixel, though most of a row is
   the ground below it, empty cells and the gaps between its trunks, where the mask is exactly 0.
   Plain comparisons now find those places first (each a hair inside the edge where its factor
   reaches 0, and the gap test widened by the lean's and the bend's largest reach: |bend| ≤ 0.072
   because gnoise stays within 0.5 ± 0.72) and skip the bend's noise and the mask there; elsewhere
   the mask is computed by the very same code as before. Scene pass, two rounds each:

   | Ancient Forest, scene pass | Extreme | High |
   | --- | ---: | ---: |
   | Before | 4.72 / 4.72 ms | 3.05 / 3.02 ms |
   | `voronoi` only | 4.62 / 4.62 (−2.3 %) | 3.02 / 3.08 (not resolved) |
   | Trunk rows only | 4.38 / 4.38 (−7.3 %) | 2.82 / 2.91 (−5.6 %) |
   | Both | 4.31 / 4.30 (**−8.8 %**) | 2.86 / 2.84 (**−6.1 %**) |

   In the earlier A/B (the same two arms, a quieter display mode) the frame's GPU p50 on Extreme
   went 4.98 / 5.05 → 4.65 / 4.59 ms.

**Pixel identity.** Chromium on Windows blocks software WebGPU (SwiftShader), so
`scripts/breathing-pixel-identity.mjs` could not run its WebGPU sets here as the cloud session did,
and now says so instead of measuring the WebGL2 fallback under a WebGPU set's name. It gained a
`--gpu` mode: the same six sets and 120 frames, in Electron on the discrete GPU (the driver's own
compiler), compared by the same `--compare`. On the RTX, two captures of the **same** main build
already differ by 1/255 on up to 0.005 % of the pixels of Sacred Geometry and Heart Glow (the two
worlds drawn from real geometry); every other world repeats to the bit. Against current main the
change matches that floor in every WebGPU frame (108 of 108: differences only in those two worlds,
of the same size). On the WebGL2 backend (ANGLE on D3D11, whose compiler regroups float arithmetic
across a restructured shader) **one pixel of Ancient Forest's frame moves by 1/255** (green 56 → 55,
on the forest floor, not a trunk): the trunk rows' change, which bisecting proved (`voronoi` alone
leaves it identical; the trunk code inside the branch is line for line the old one, and moving it
into a branch is enough). The owner chose to keep it.

### Traps found (for the next measurement)

- The playground's renderer is 4× MSAA by default, and a `pass()` scene inherits it: measure a
  surface built with `antialias: false` with `antialias=0`.
- At the display's rate a light load is measured in the driver's power states, not the shader's
  work (above). Uncapped is steady; vsync-off numbers are higher than the P0 figures at the display's
  rate because the GPU then works at its power limit.
- The panel switched between hybrid and direct presentation twice in the session (180 → 240 Hz). A
  window made before a switch was left drawing about once a second; another grew 1920 × 1080 →
  1936 × 1088. The bench now checks the window's size before and after every reading and the probe
  makes a new window for every run and voids any stage whose frames came slower than every 20 ms.
- At a 1.5 scale a frameless Electron window's content size is not what is asked for while it has
  the thick (resize) frame (`thickFrame: false` fixes it); 2560 × 1600 at 1.5 is 1706.67 CSS pixels,
  so "native" is 1706 × 1066 (every tier's buffer there is set by its pixel budget anyway).
- `gnoise3` is not bounded like `gnoise`: its gradients are 3D, and it reaches 0.5 ± 0.93, not
  0.5 ± 0.72 (worked out over the cell, the extreme being every gradient at (±1, ±1, ±1)). No skip in
  the worlds relies on a 3D bound today; one that does must use 0.93.

## Not measured, and open

- **Other hardware.** Every figure above is one RTX 5080 Laptop GPU in Balanced mode. Integrated GPUs,
  other discrete GPUs and phones are unmeasured; the ranking (Ancient Forest, then Cosmic Nebula and
  Zen Garden, then Crystal Prism) says where they would hurt first. The guide's paint count and the
  allocations the first pass removed are still not timed anywhere.
- **Building ahead stutters once a stage** (measured above: a few frames up to about 50 ms while the
  next world compiles), and is kept because the alternative is a 0.7–2.0 s wait on the CSS orb at
  every change. Ways to move that work where it cannot be seen, none tried yet: start the next build
  inside the dip of the change that just happened, when the world on screen was adopted and has
  nothing of its own to compile (the canvas is hidden for 420 ms of it); or build every world of a
  session during its countdown and keep them for the session, so a world met again (Base meets the
  storm three times) costs nothing at all, at a GPU-memory cost that is unmeasured. The owner's call.
- **A frame cap** (the trade-off above): the owner's call. On the WebGL2 backend and the lightest tier
  a session still compiles its next world at the stage change, behind the dip, as before.
- **The `voronoi` change outside Ancient Forest** (Moonlit Waters, Ocean Tide, Volcanic Fire) is
  exact but below what two rounds of the bench resolve; whatever it buys there is unmeasured.
- **A never-seen first visit** (no shader in the driver's own cache either) is unmeasured, and the
  Breathing tab's first visits (0.85–2.6 s on the orb above) could be hidden as a session's are, by
  preparing the world when it is chosen on the tab rather than when the practice starts: GPU work
  while the tab is open, the owner's call.
