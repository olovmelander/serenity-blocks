# Theme foundation: how a theme is built in this repo

A theme is a living backdrop behind the falling-block board that a player looks at for an hour:
a WebGPU/TSL world that turns by the clock, answers every move of play, and runs from a phone's
WebGL2 to a desktop GPU at 240 Hz. This file is the contract every theme keeps and the shared
code it stands on. It is a map: each section ends where the detail lives.

Read it before building a theme and before changing how an existing one starts, reacts to play,
scales by tier or is tested. For shader work alone, the rules in `SKILL.md` and the files in
`gotchas/` are enough.

## Contents

1. [The shape of a theme](#1-the-shape-of-a-theme)
2. [Lifecycle rules that are easy to break](#2-lifecycle-rules-that-are-easy-to-break)
3. [The world](#3-the-world)
4. [House rendering rules](#4-house-rendering-rules)
5. [Reacting to play](#5-reacting-to-play)
6. [Time, moods and accessibility](#6-time-moods-and-accessibility)
7. [The post chain](#7-the-post-chain)
8. [Tiers, phones and performance](#8-tiers-phones-and-performance)
9. [Shared modules: reach for these first](#9-shared-modules-reach-for-these-first)
10. [Tests and gates](#10-tests-and-gates)
11. [Changing an existing theme](#11-changing-an-existing-theme)
12. [Adding a new theme](#12-adding-a-new-theme)
13. [Where the detail lives](#13-where-the-detail-lives)

## 1. The shape of a theme

A modern theme is a folder of small modules round one shared world. The theme (in the game) and
its playground effect (for captures) mount **the same world and the same post**, so what you
iterate in the playground is what ships.

`src/themes/<id>/`:

| File | Role |
|---|---|
| `<id>-theme.js` | The adapter: `export default class … extends BaseTheme`. Renderer (WebGPU, WebGL2 backend as fallback), GPU-loss recovery, bus wiring, layout reads, settings, pause/resume, dispose. Nearly identical in every theme: **clone it, rename, do not restructure** |
| `<id>-director.js` | Stages gameplay events into player slots and hands the world at most one lock and one clear per frame. Renderer-, DOM- and bus-free. Cloned |
| `<id>-composition.js` | Where the board card and HUD are on screen (`readLayoutRects`, `boardPoint`). Cloned |
| `<id>-core.js` | three-free constants and CPU maths (palette, seeds, easing). Everything testable in Node imports only this |
| `<id>-tsl.js` | Shared TSL: laid-out pure helpers, the one uniform bag `u`, material helpers |
| `<id>-bake.js`, `<id>-bakes.js`, `<id>-bake.worker.js` | three-free deterministic bakes (noise, atlases), the list of bake jobs, and the three-line worker that runs them off the main thread |
| `<id>-<part>.js` | One scene part each (`sky`, terrain, hero, `fx`, …): returns its mesh, material and geometry |
| `<id>-world.js` | The world: owns `u`, the parts, the camera rig, the choreography and the event slots |
| `<id>-post.js` | The post chain (`RenderPipeline`) and its per-tier look |
| `<id>-quality.js` | The six tiers' numbers |
| `<id>-tetrominos.js` | The piece palette |
| `<id>-theme-icon.png` | 512 × 512 picker icon |

Outside the folder: `src/playground/effects/<id>.effect.js`, the registry entry in
`src/themes/theme-registry.js`, the URL catalogue rows, and `tests/unit/<id>-*.test.js`.

**Themes are islands.** A theme imports its own folder, `src/themes/shared/`, `base-theme.js`
and general modules (`src/events/`, `src/utils/`); never another theme (`npm run check:boundaries`
fails). Copy a sibling's helper into your folder instead. The module's top level touches neither
the DOM nor the GPU: a registry test imports every theme in Node.

Two finished themes to read as code: `src/themes/serenity-warp/` (the cleanest) and
`src/themes/rainbark/` (the richest director). Their tests are the contract in executable form.
The same shape at its smallest, in one file, is `templates/theme-starter.effect.js` in this
skill: core numbers, the uniform bag, a laid-out helper, three parts, a post chain and a world,
each labelled with the theme file it grows into.

## 2. Lifecycle rules that are easy to break

The adapter is boilerplate because every line of it was a bug once. The facts behind it:

- **Identity.** The file is `<id>/<id>-theme.js`, the constructor calls `super(THEME_ID)`, and
  `THEME_ID` equals the registry id and the folder name, or the manager throws.
- **`createScene()` puts the whole world in the scene before it resolves.** The hidden prewarm
  waits for the scene's child count to hold still, then compiles every pipeline. Anything added
  later compiles in front of the player. So: every pool always drawn, dormant slots at zero size,
  nothing created at event time.
- **`createScene()` runs many times per start** (a quality change, a GPU-loss recovery). Event
  subscriptions are removed before they are added again, or every rebuild doubles each handler.
- **The frame order is fixed**: `world.updateCamera(camera, sim)` → `director.flush()` →
  `world.update(sim, camera)` → `post.update(world.getPostState())` → `post.render()`. The camera
  moves first because events aim through it.
- **Time comes from the theme's own `lastFrameMs`**, clamped (0.05 s): the frame pacer skips
  vsyncs, and a background tab returns after minutes. `THREE.Clock` is deprecated. Keep the loop
  method named `animate` (`restartRenderLoop` looks for it) and gate frames with
  `shouldRenderFrame()`.
- **Resize through `EVENTS.VIEWPORT_RESIZED`**, never a window listener, and size the renderer
  with `getEffectivePixelRatio(cap)` so the global render scale applies.
- **GPU loss gets one recovery**: rebuild on the WebGL2 backend. In `disposeRuntime()`, call
  `removeRendererResilience()` before `disposeRenderer()`, or the destroyed device reports as a loss.
- **Switching away is terminal.** `cleanup()` disposes everything; the instance is never restarted.
  Dispose is idempotent, bloom goes through `disposeBloomNodeDeep`, and geometry kept for the
  session is re-wrapped with `freshGeometry`.
- **Pipelines are the theme manager's business** (ADR-0020): no `buildsPipelinesAsync`, no
  `createRenderPipeline*`, no `compileAsync` in an ordinary theme.

Detail: `docs/theme-concepts/PLAYBOOK.md` §2.2 and the full call graph in
`docs/theme-concepts/reference/adapter.md`.

## 3. The world

The world is the theme's content, written so that any frame can be reproduced: `seek(t)` plus a
fixed-step replay lands on the same picture, which is what makes phase-locked captures, the
playground and the tests possible.

- It implements the methods the theme test pins (`WORLD_METHODS` in
  `tests/unit/serenity-warp-theme.test.js`): `build`, `bindCamera`, `showOnlyParts`, `setViewport`,
  `setLayout`, `setReducedMotion`, `seek`, `resetSession`, `restCamera`, `updateCamera`, `onLock`,
  `onClear`, `onCombo`, `levelUp`, `update`, `getPostState`, `getState`, `dispose`.
- **One uniform bag `u`**, built once. The world writes `.value`; materials only read.
- **Events write numbers** into preallocated slots and a small timed queue. Nothing is allocated
  per frame or per event: scratch vectors, reused objects, `uniform.value.set(…)`.
- **Phases are integrated and wrapped** (`phase += dt * rate`, then `% period`) before upload: a
  float clock multiplied by a moving rate jumps, and an unwrapped one loses precision within an
  hour (gotcha #174).
- **No downloads.** Every texture is baked on the CPU at build, so nothing breaks under `file://`
  in the packaged app and the theme is never busy during prewarm. Bakes go through the bake cache
  and the bake worker; the build itself is a generator of steps (section 9).
- **The camera ends its pose with the shared breath** (`applyCameraBreath`), scaled to zero under
  reduced motion. A coverage test checks every registered theme reaches it.

Detail: PLAYBOOK §2.4 and `docs/theme-concepts/reference/rendering.md` §1.

## 4. House rendering rules

The rules in `SKILL.md` hold for every shader. These are the theme-level choices on top:

1. **Self-shaded, scene-linear HDR.** `MeshBasicNodeMaterial` (or `NodeMaterial` for a full-screen
   pass) everywhere; light is computed in the material. No scene lights, no `ShaderMaterial`, no
   `mx_noise`. A real shadow map is the exception (`gotchas/light-shadows.md`).
2. **No compute unless the concept truly needs it**, and then with a CPU twin: the WebGL2 backend
   has none, and it is a player surface (Murmuration is the precedent).
3. **Instanced quads for many small things**: `InstancedBufferGeometry`, one
   `InstancedInterleavedBuffer` per pool, integer-coded per-instance data, closed-form motion in
   `vertexNode`.
4. **Laid-out pure helpers** for anything called twice; builders that read `u` or a texture are
   plain JavaScript functions inlined into a material's `Fn`.
5. **Event tables**: live rows compacted at the front of one `uniformArray`, the count in an int
   uniform, one TSL `Loop` over them.
6. **Textures are 2D and baked on the CPU**, mips built on the CPU where the look depends on them;
   half-float targets on WebGL2 need a capability check.
7. **Draw order**: solids, then the backdrop last among the opaque parts, then additive light.
8. **Both backends for every capture**, and gate on renderer kind, not backend (ADR-0019).
9. **Pieces are solid, fused shapes in one colour** wherever a theme draws them (gotcha #159): the
   owner asked for solid colour, and four separate cells read as "four bits".

Detail: PLAYBOOK §7.1 and `docs/theme-concepts/reference/rendering.md` §3.

## 5. Reacting to play

**The events.** A theme subscribes to exactly eight bus keys (`src/events/event-bus.js`), each
gated by `isActive && !isPaused`: `PIECE_LOCK`, `HARD_DROP`, `LINE_CLEAR`, `COMBO`, `TWIST`, `B2B`,
`PERFECT_CLEAR`, `LEVEL_UP`. There is no bus event for hold, game over, garbage, move or rotate
reactions, and a key that does not exist fails `tests/unit/event-contract.test.js`.

Traps in the payloads (all in PLAYBOOK §2.3 and `reference/events.md`):

- `COMBO` carries **cascade depth**, not a combo (ADR-0011). The true combo comes from
  `ComboTracker` per player slot.
- `HARD_DROP` fires before its `PIECE_LOCK`, and `piece` is a live pooled object: read it at once.
- Board rows include four hidden rows (visible row = row − 4).
- **Infinity never levels up**, local multiplayer and online send fewer events, and meditation
  sends clicks with a screen position and no board. Anything level-driven must also progress by
  the clock (section 6).

**The director** turns that stream into `sink.lock(…)`, `sink.clear(…)`, `sink.combo(n, player)`
and `sink.levelUp(level)`, once per frame. The objects it hands over are reused: the world copies
what it keeps.

**Reactions accumulate; they do not restart.** Feed events to the shared `GameplaySurge`
(`src/themes/shared/gameplay-surge.js`) and spend its three readings: `punch` (the hit: flashes,
kicks), `level` (the heat of play: bloom, saturation, wind) and `fever` (the slow tide: the
theme's crescendo), with `stage` for calm, warm, hot and fever looks. Every theme reads the same
numbers, so the same play feels the same size in every world. A single-slot envelope
(`flash.at = now`) is the bug this replaces: use a `Swell` (`src/themes/shared/swell.js`).

```javascript
// in the world (src/themes/serenity-warp/serenity-warp-world.js is the precedent)
this.pace = new GameplaySurge();                       // build()
this.pace.lock({ hardDrop }, t);                       // onLock(c)
this.pace.clear({ lines, cascade, combo, twist, perfect, b2b }, t);   // onClear(c)
this.pace.levelUp(t);                                  // levelUp(level)
this.pace.reset();                                     // resetSession()

// update(sim): once a frame. One reused object: { punch, level, fever, stage }
const heat = this.pace.sample(t);
u.skyFlash.value = heat.punch * FLASH_GAIN * flashScale();        // a frame-wide flash: scaled HERE
u.glow.value = 0.2 + heat.level * 0.5 + heat.fever * 0.3;        // what the world wears as play heats up
```

"Stronger when the player is fast" is therefore not something a theme computes: `punch` already
rides up under rapid hits, `level` is the pace, and `fever` only fills while it is sustained.

**Aim at what can be seen.** The board card covers the middle of the picture, and the post dims
inside it, so an effect "under the piece" is never seen (gotcha #144). Events leave the card's
edge toward the open stage; falling things keep to lanes outside the card and HUD. Never read
layout inside a bus handler (`getBoundingClientRect` forces layout): the adapter schedules reads.

**Light adds up.** Budget the total additive light per tier (gotcha #120), give overlapping pools
one hue and a capped level (#157), and couple the bloom knee to exposure so event lights survive
a bright scene (#134).

Detail: `gotchas/look-events-particles.md`, PLAYBOOK §2.3 and §2.5.

## 6. Time, moods and accessibility

- **Moods turn by the clock in every mode; a level is one step on top.** Only single player and
  the Odyssey level up, so a theme whose light changed only with the level stood in one light
  forever in Infinity, a match or meditation. `src/themes/shared/mood-clock.js` is the shared
  form: `phase = levelStep + moodDrift(time)`, resting on each mood before melting into the next,
  a pure function of time so a seek lands on the same light. `meltPalettes()` mixes two palettes
  the short way round the colour wheel (a straight mix of violet and amber is grey mauve).
- **Reduce flashing** (ADR-0021) is its own setting, read live: every frame-wide flash is
  multiplied by `flashScale()` from `src/utils/photosensitivity.js` where it is written (the post's
  `uFlash` line and any flash outside the post). Lightning fires one stroke; a strobe becomes
  steady light. A new post stack that does not scale its flash fails
  `tests/unit/reduce-flashing.test.js`. That test finds `*-post.js` files by itself, but a flash
  written in a WORLD or sky module is only checked if its file is in the test's hand-kept list:
  when you add one, add its line there in the same change.
- **Reduced motion** is separate: camera punch, kick and shake to zero, parallax off, ambient
  drift slowed, the shared breath off (`src/themes/shared/reduced-motion.js`).
- **Readability first**: nothing crosses the card or HUD, calm zones stay on, and the pieces'
  colours pass the palette gate (`npm run check:palette`).

## 7. The post chain

One scene pass, one bloom, one output pass; tone mapping exactly once.

- `new THREE.RenderPipeline(renderer)`; `pass(scene, camera, { samples: sceneSamples(quality, antialias) })`
  from `src/themes/shared/scene-antialias.js` (4× MSAA from High up; a `reflector()` beside it
  takes the same count, or every material compiles two pipelines). A pass left without
  `samples` takes the renderer's count, so the renderer is built with `antialias: false` and the
  tier decides here.
- `renderer.toneMapping = NoToneMapping`, `pipeline.outputColorTransform = false`; the output
  node applies the theme's filmic curve and encodes sRGB itself.
- Bloom on the tiers that can afford it (Medium up in most themes), with a hue-preserving
  high-pass and its knee tied to exposure. Disposed with `disposeBloomNodeDeep`.
- **Calm zones**: the post soft-dims inside rounded boxes round the cards and HUD so play stays
  readable, and scales flash, grain and glare down inside them.
- Features a tier lacks are **not built** (no node, no pass), never multiplied by zero.
- A `falseColor=1` view that bands the pre-tone-map maximum is the first thing to look at before
  tuning bloom or exposure.

Detail: `gotchas/post-color.md`, `docs/post-processing.md`, PLAYBOOK §2.6, and the post pipeline
read line by line in `docs/theme-concepts/reference/rendering.md` §2.

## 8. Tiers, phones and performance

- Six tiers: `Minimal`, `Low`, `Medium`, `High` (the default), `Ultra`, `Extreme`. The tier is
  fixed per build; a change rebuilds the scene.
- **Every tier keeps the whole picture and every event.** A tier cuts counts, steps, resolution
  and detail terms; it never drops a feature or a beat. Terms are dropped in JavaScript (gotcha #135).
- Sizes are authored for a reference frame and floored at about one buffer pixel, or stars are
  blobs on a phone and specks at 4K (gotcha #147). The phone validator runs at Low on a
  390 × 844 frame at half scale: look at its screenshots, not its verdict.
- **Performance work keeps the look** (the owner's standing instruction). In order: changes that
  alter no pixel (cache, reuse, skip what nobody sees, spread builds over frames); then visually
  equivalent ones (lower resolution only for low-frequency effects, early-outs where a term
  provably vanishes); only then trims, on non-High tiers, least visible first. Prove each with
  before/after shots at the same `t`.
- **Performance claims need a verified instrument** (ADR-0016): GPU timestamps on real hardware,
  old and new interleaved. Software rendering and a frame counter are not instruments. The
  integrated GPU is arithmetic-bound and behaves unlike the discrete one: time lean tiers there.

Detail: `gotchas/performance-tiers.md`, `docs/performance.md`, PLAYBOOK §2.7.

## 9. Shared modules: reach for these first

Each exists because several themes solved the same problem separately, and one of them got it
wrong. All under `src/themes/shared/` unless a path says otherwise.

| Need | Module |
|---|---|
| Start a node renderer on WebGPU with the WebGL2 backend as fallback | `node-renderer.js` (`initializeThemeNodeRenderer`) |
| MSAA for a scene drawn through `pass()` | `scene-antialias.js` (`sceneSamples`, `canvasAntialias`) |
| Reactions that build with the pace of play | `gameplay-surge.js` (`GameplaySurge`), `swell.js` (`Swell`, `softCeiling`) |
| Moods, hours and palettes that turn by the clock | `mood-clock.js` (`moodDrift`, `wheelAt`, `meltPalettes`) |
| The camera's idle breath; a full rig with parallax and shake | `camera-breath.js` (`applyCameraBreath`), `camera-rig.js` |
| The player's reduced-motion choice, eased | `reduced-motion.js` |
| The player's reduce-flashing choice | `src/utils/photosensitivity.js` (`flashScale`) |
| A deterministic CPU bake, cached across rebuilds | `bake-cache.js` (`bakeOnce`, `derivedOnce`) |
| Bakes off the main thread on first visit | `bake-worker-client.js` (`bakeInWorker`), `bake-worker-host.js` (`serveBakes`), `half-float.js` |
| A world build that yields between parts instead of freezing a frame | `build-steps.js` (`buildWorldBreathing`, `drainSteps`) |
| Large deterministic geometry, built once a session | `session-geometry.js`, `fresh-geometry.js` (after a dispose) |
| A per-instance value read exactly in the fragment stage | `flat-varying.js` (`flatVarying`) |
| A vertex value on thin geometry under MSAA | `centroid-varying.js` (`centroidVarying`) |
| A soft shadow with no per-pixel grain | `grid-shadow-filter.js`; r186's look kept: `width-pcf-shadow-filter.js` |
| A static shadow map that catches late casters | `static-shadow-draws.js` (`redrawStaticShadow`) |
| Selective bloom through MRT | `mrt-blend.js` (`withEmissiveMaterialBlending`) |
| Disposing bloom completely | `bloom-dispose.js` (`disposeBloomNodeDeep`) |
| FX drawables parked invisible whose pipelines must exist | `warm-hidden-drawables.js` (`warmParkedSoon`) |
| An environment map without a first-frame stall | `pmrem-warm.js` |
| An image texture decoded off the main thread | `decoded-texture.js` |
| A glTF attribute as plain floats; an instance pool that uploads only what it drew | `attribute-floats.js`, `instance-upload.js` |
| A fox | `fox-mind.js`, `fox-rig.js`, `fox-wander.js` |
| Pipelines created async on a loading surface; compute pipelines | `src/rendering/async-render-pipelines.js`, `src/rendering/webgpu-compute-pipeline-async.js` |

Read a module's header before using it: each says what it fixes, what it measured and which
themes use it.

## 10. Tests and gates

A theme's tests are relations, not tuning numbers: they pin what must stay true while the look
is free to change.

| Test | What it holds |
|---|---|
| `tests/unit/<id>-core.test.js` | The three-free maths |
| `tests/unit/<id>-director.test.js` | Events in, sink calls out: folds, combo breaks, malformed payloads, a throwing sink |
| `tests/unit/<id>-world.test.js` | A real world in a `THREE.Scene` with no renderer: what each event does, counts, bounds |
| `tests/unit/<id>-theme.test.js` | The adapter with mocks: registry entry, static bans, tiers, lifecycle; then builds the real world and post at every tier |
| `tests/unit/<id>-shaders.test.js` | **The shader gate.** Every part's material built through `WGSLNodeBuilder` and `GLSLNodeBuilder` with no GPU, at the default tier and the leanest. The checks a gate can hold: no throw, no warning, a size budget per stage, no `NaN` or `object Object` in the text, no reserved word as a parameter name, no variable read before it is assigned (`unassignedReads`), no MaterialX noise (`hasMaterialXNoise`) |

The shader gate catches most faults in `gotchas/tsl-emission.md` before a browser does. Its
harness is `tests/unit/helpers/tsl-node-build.js` (`stubRenderer`, `build`, `unassignedReads`)
with `tests/unit/helpers/materialx-noise.js` (never search the generated text for `mx_`: on
r187 that finds nothing); `tests/unit/himalayan-peak-shaders.test.js` is a compact one to copy. What it cannot see: the
text is never compiled, so a shader the browser rejects can still pass. The screenshot is still
required.

Run on every change to a theme:

```bash
npm run typecheck
npx vitest run tests/unit/<id>-                       # the theme's own files
npx vitest run tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/dual-state-theme-tripwire.test.js tests/unit/url-parameter-catalog.test.js \
  tests/unit/theme-camera-breath-coverage.test.js tests/unit/reduce-flashing.test.js
npm run audit:theme-lifecycle && npm run check:boundaries
npx eslint src/themes/<id> --ext .js
```

The full list CI runs is in `docs/theme-concepts/reference/ci.md` §7. `git add` new files before
trusting the tripwire: it scans tracked files only.

## 11. Changing an existing theme

1. **Read the theme's record first.** Each rebuilt theme has one in `docs/`
   (`<NAME>_VISUAL_OVERHAUL_<date>.md` or similar, listed in `docs/ARCHITECTURE_INDEX.md`). It
   says what was tried, what the owner rejected and what is deliberately the way it is. Undoing a
   recorded decision by accident is the commonest way to waste a session here.
2. **Open its playground effect** and take a "before" set at fixed times (a default frame, the
   event you will touch, the lowest tier, WebGL2, portrait). Keep them: "after" is judged beside them.
   The effect's own parameters (`quality=`, `event=lock|clear|…`, `eventAge=`, `parts=`, …) are
   listed in the header of `src/playground/effects/<id>.effect.js` and in
   `docs/URL_PARAMETER_REFERENCE.md`; `src/playground/README.md` lists only the page's own.
3. **Find the part**: one file per part, the uniform bag in `<id>-tsl.js`, choreography and
   events in `<id>-world.js`, the look of the frame in `<id>-post.js`.
4. **Read the matching gotcha file** before writing (`look-water.md` before touching water).
5. **Change one thing, capture, compare.** Judge at the size it is seen: a creature or prop at
   its real screen size, not a close-up.
6. **Re-pin what you moved on purpose**: a test that pins a count, a bound or a golden value is
   updated in the same change, with the reason.
7. **Finish**: the capture set again on both backends, the gates in section 10, the record doc
   updated with what changed and why, and a gotcha row for anything that cost a round.

## 12. Adding a new theme

Replacing a retired theme's slot is strongly preferred to adding one (PLAYBOOK §1). The work, in
order: the three-free core and palette; the cloned adapter, director and composition with the
registry entry (`{ id, displayName, module, group, icon }` in `RAW_THEME_REGISTRY`, the id added
to `HEAVY_GPU_THEME_IDS` when it is a heavy scene); the environment, one part at a time, each
proven in the playground; the gameplay events, one beat at a time; then post, tiers, phone, icon
and the record doc. The theme manager finds `<id>-theme.js` by glob, and the registry creates the
`#<id>-theme` container when `index.html` has none.

`docs/theme-concepts/PLAYBOOK.md` is that procedure in full: slot choice (§1), the staged build
order (§3), the rename and retire checklist (§4), cloud-container captures (§5) and the gates
(§6). It was written on three r186; where it differs from this file on a name, trust the code.
Known drift: the twist event is `EVENTS.TWIST` (the playbook's tables use an older key), Reduce
flashing is now a setting (it says none exists), and gotcha numbers are ids in `gotchas/`, not
line numbers.

## 13. Where the detail lives

| Question | File |
|---|---|
| The whole procedure for a new theme | `docs/theme-concepts/PLAYBOOK.md` |
| The adapter's call graph, clone recipe and pitfalls | `docs/theme-concepts/reference/adapter.md` |
| Event payloads, order within a lock, emit sites per mode | `docs/theme-concepts/reference/events.md` |
| A rebuild's rendering read line by line (world, post, TSL idioms) | `docs/theme-concepts/reference/rendering.md` |
| CI workflows and what each gate asks of a theme | `docs/theme-concepts/reference/ci.md` |
| Every theme's setting, palette and motifs (what not to repeat) | `docs/theme-concepts/reference/catalog.md` |
| The playground's contract and URL parameters | `src/playground/README.md` |
| The workflow and tool setup | `docs/WEBGPU_THREEJS_WORKFLOW.md` |
| The decisions that bind a theme | `docs/adr/` 0007 (done means a screenshot), 0008 and 0019 (backends), 0016 (perf instruments), 0018 (three pin), 0020 (async pipelines), 0021 (flashing) |
| Fleet-wide performance rounds and the bench | `docs/THEME_FLEET_240_HANDOVER_2026-10-27.md`, `npm run perf:themes:bench` |
