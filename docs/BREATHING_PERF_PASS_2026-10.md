# Breathing worlds and Hale sessions — a performance pass (October 2026)

A static audit and code-level pass over everything that runs while you breathe: the guide and its
frame loop, the stage and world host, the lens, the Hale session flow, and the twelve worlds in
all their moods. It was done in a cloud session with no GPU, so **nothing here is a frame-time
figure** (ADR-0016): the pass changes code, and proves that the pictures did not change.

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

## Not measured, and open

- **Frame time on hardware.** The paint count and the allocations removed are facts about the
  code; what they buy in milliseconds on the integrated GPU or a phone is unmeasured (ADR-0016).
- **Building ahead on hardware.** The next world compiles on the driver's workers while the world
  on screen draws; whether that costs the world on screen a frame on the integrated GPU or a phone
  is unmeasured. On the WebGL2 backend and the lightest tier a session still compiles its next
  world at the stage change, behind the dip.
- **Display-rate tiers on high-refresh screens** (High and above draw at 120–165 Hz there).
  A 60 Hz cap would roughly halve their GPU work for slow breathing motion, but it changes the
  smoothness the owner asked to keep: the owner's call.
