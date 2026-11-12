---
name: webgpu-threejs-tsl
description: Three.js WebGPU + TSL for this repo, verified against the pinned three 0.187.0 (r187) - the house rules every theme follows, some two hundred numbered gotchas the repo has already paid for, and the API reference (node materials, post chain, compute). Use it whenever you create or change a visual surface - a theme (src/themes), a playground effect (src/playground/effects), an Odyssey chapter (src/rendering/odyssey), a breathing world - and whenever you write or debug TSL, shaders, particles, bloom, tone mapping, water, sky, clouds, shadows, render targets or GPU compute, or meet a black or wrong frame, a slow shader compile, a WebGPU validation error or a failure only the WebGL2 backend shows, even when the request never says "three" or "shader". Not for the Phaser 2D board, DOM/CSS UI, the Electron shell or audio.
---

# WebGPU Three.js with TSL in Serenity Blocks (three r187)

Every visual surface in this repo is three.js on `WebGPURenderer` with TSL node materials: you
write shaders as JavaScript node graphs, and three turns them into WGSL (WebGPU) or GLSL (its
WebGL2 backend, which players also run). This page holds what is true for every one of those
surfaces. Everything else is one file away, and the tables below say which file.

**Paths.** `REFERENCE.md`, `gotchas/…`, `templates/…`, `scripts/…` and the `docs/…` files listed
under "Reference docs" below are in this skill's folder (`.claude/skills/webgpu-threejs-tsl/`).
Every other path (`src/…`, `tests/…`, `docs/adr/…`, `docs/theme-concepts/…`) is from the repo root.

**The version contract.** three is pinned at exactly `0.187.0` (ADR-0018). TSL changes between
releases in ways no migration guide lists, so when an API is in doubt the answer is in the
installed package, not in memory and not on the web. A TSL name:
`node -e "import('three/tsl').then(m => console.log('instancedArray' in m, 'atan2' in m))"` prints
`true false`. A post node is an addon file, not a `three/tsl` export:
`ls node_modules/three/examples/jsm/tsl/display/`. What a graph really emits: build it to WGSL and
GLSL with no GPU (`build()` in `tests/unit/helpers/tsl-node-build.js`). What r187 changed is in
`docs/three-r187.md`, and `node .claude/skills/webgpu-threejs-tsl/scripts/audit.mjs` re-checks
every name on these pages against the installed package.

## The loop

A clean build proves nothing about a picture, so no visual change is done without a screenshot
and a clean console (CLAUDE.md, ADR-0007).

1. **Iterate in the playground**, not the game: `npm run dev:playground`, then
   `http://localhost:5173/playground.html?effect=<id>&t=<seconds>&maxFps=30`. A theme's effect
   file (`src/playground/effects/<id>.effect.js`) mounts the same world and post the theme ships;
   its header lists the parameters it reads (`quality=`, `event=`, `eventAge=`, …).
2. **Look at it** with the `chrome-devtools` MCP: wait for `window.__PLAYGROUND_READY__ === true`,
   screenshot the canvas, read the console. `?t=` pins the time so two shots are comparable.
   When the MCP answers "The browser is already running", another session holds it: leave it
   alone and capture with
   `node .claude/skills/webgpu-threejs-tsl/scripts/shot.mjs out.png "<url>" [width height]`
   (its own headless Chrome on real WebGPU; it prints the backend and the console).
3. **Take the captures that find the faults the default one hides**: the WebGL2 backend
   (`forceWebGL=1`), the lowest tier (`quality=Minimal`), a tall phone frame (390 × 844), and each
   gameplay event you touched (`event=…`). Most rows in `gotchas/` were found by one of these.
4. **Then port** into the theme or chapter, and capture it once in the real game.

Keep the GPU cool: `maxFps=30` on every playground URL, one small effect at a time (a full-journey
capture has TDR-crashed the dev machine), and ask the owner before any uncapped speed measurement.

## Where to look

| You are about to… | Read first |
|---|---|
| Build a new theme, or change how one starts, reacts to play, scales by tier or is tested | `docs/theme-foundation.md` |
| Write TSL with an `If`, `Loop`, `select`, `.assign()` or a shared helper `Fn` | `gotchas/tsl-emission.md`, `gotchas/tsl-functions-loops.md` |
| Debug a symptom (black frame, wrong colour, nothing drawn, a parse error, a freeze) | `node …/scripts/gotcha.mjs <words>` (below) |
| Build a kind of thing (water, sky, clouds, terrain, particles) | the matching `gotchas/look-*.md`, whole |
| Build or change a post chain, bloom, tone curve or grade | `gotchas/post-color.md`, then `docs/post-processing.md` |
| Speed something up, or decide what a tier drops | `gotchas/performance-tiers.md`, then `docs/performance.md` |
| Look up an API (a node, a material property, an addon's signature) | `REFERENCE.md`, then the topic file in `docs/` |
| Touch `compileAsync`, warm-up, shadow maps or anything r187 changed | `docs/three-r187.md` |

## Rules that hold in every shader

Each is a fault this repo has shipped or nearly shipped; the number is its row in `gotchas/`.

**Imports**
- `import * as THREE from 'three/webgpu'`, every TSL name from `'three/tsl'` (`Fn`, `If` and `Loop`
  too), post nodes from `three/addons/tsl/display/…`. New code never imports `'three'` and never
  uses `ShaderMaterial`, GLSL strings or `mx_noise_*`: a rebuilt theme's own tests fail on them
  (#64, #80; `wolfhour` is the one WebGL holdout, ADR-0008).
- Never put a JavaScript operator on a node. `-x` prints `NaN` into the shader and `1 + x`
  concatenates a string; write `x.negate()` and `x.add(1)` (#167, #213).

**Where code lands** (the model, with builder output, is in `gotchas/tsl-emission.md`)
- An expression is written into the shader where it is first USED, not where your JavaScript
  wrote it, and again in every branch and loop body that reads it. So inside the `Fn`, before
  the first `If`, `Loop`, `select` or `.assign()`, pin every value that more than one place
  reads with `.toVar()`, and read that variable. It is then computed once, and before anything
  that changes what it reads: `ds = t.sub(prev)` used after `prev.assign(t)` is zero (#200, #215, #228).
- Up to r186 a value first built inside one branch read ZERO in the others (#68, #171, #205,
  #212). r187 writes it again in each branch instead: correct, but paid for twice. The pin is
  the fix for both, and `unassignedReads` in a theme's shader test still guards it.
- Build nodes inside a `Fn`. An `If` at module level throws, and a `Loop` made while a material is
  constructed vanishes from the shader without a word (#230).
- Mutation is `.toVar()` + `.assign()` or a `select()`; a JavaScript reassignment inside `If` is
  invisible to the shader (#67).

**Numbers**
- Bound a term before you mask, mix or sum it: `exp(k · distance)` overflows on a tall screen,
  `Inf · 0` is NaN, and bloom spreads one NaN texel over the frame (#71, #94).
- Clamp a `pow`, `sqrt` or `acos` argument that comes from a dot product, write small integer
  powers as products, and never `normalize()` a vector that can be zero (#94, #231).
- A hash or `floor` amplifies the last bit: feed it exact, non-negative integers (`floor(seed.add(0.5))`,
  cells shifted positive), and pass per-instance values to the fragment flat
  (`src/themes/shared/flat-varying.js`) (#87, #204, #88).
- Under MSAA an interpolated coordinate is extrapolated outside 0..1 on thin geometry: clamp it
  before it shapes a colour (#105). Anything the shader compares with the clock must live on the
  same wrapped clock (#174).

**Functions, loops and data**
- A helper called more than once gets `setLayout`, and is then pure and flat: values in as
  parameters (no captured uniform or texture), no call to another laid-out helper, no parameter
  named with a word WGSL or GLSL reserves (`from`, `input`, `filter`, …) (#81, #93, #95, #207, #178, #223).
- Many of a thing is one `uniformArray` of `vec4` rows, live rows packed at the front, read by one
  TSL `Loop` to a count uniform. Never a JavaScript `forEach` that emits TSL per element (#101, #110, #162).
- WebGPU limits bite early: 8 vertex buffers a pipeline (interleave instance attributes), 12
  uniform buffers a stage (one array of rows, not many arrays) (#99, #102).

**Materials and order**
- Themes are self-shaded: `MeshBasicNodeMaterial` (or `NodeMaterial` for a full-screen pass),
  scene-linear HDR, no scene lights.
- Draw solids first, the sky or backdrop last among the opaque parts (`depthTest` on,
  `depthWrite` off), light after. `renderOrder` belongs on meshes; on a `Group` it reorders the
  whole group (#100, #139, #206).
- Light that adds is premultiplied and leaves alpha alone: `premultipliedAlpha: true` and
  `outputNode = vec4(rgb, 0)` (#90). An opaque material's own alpha needs `fragmentNode` (#91), and
  a `fragmentNode` silences `maskNode` (#111).
- In a `positionNode`, read masks and pivots from `positionGeometry` and return
  `positionLocal.add(offset)`: since r185 `positionLocal` already holds the instance matrix (#65).

**Post and colour**
- One scene pass, one bloom, one output pass that tone-maps exactly once.
  `new THREE.RenderPipeline(renderer)`, never `PostProcessing` (#63). The pass carries its own
  MSAA count: give it `sceneSamples()`, since the output quad is never multisampled and a pass
  given `samples: 0` has no antialiasing at all (#224). FXAA, on tiers without MSAA, goes last,
  after the sRGB encode.
- Inside a post pass the camera nodes belong to the pass's own quad camera; hand the scene camera's
  matrices in as uniforms (#165).
- Judge colour only through the finished chain, never from the linear numbers (#112, #227).
- A frame-wide flash is multiplied by `flashScale()` where it is written (ADR-0021).

**Cost, tiers and backends**
- A zero uniform switches nothing off. Gate features in JavaScript: do not build the node, the pass
  or the mesh (#72). A tier drops a term in JavaScript too, never by feeding it a neutral constant (#135).
- Start-up cost is pipelines: one per mesh per pass it is drawn in, whatever the materials share.
  Cut passes, keep sample counts equal, never call two `compileAsync` on one renderer at once
  (#96, `docs/three-r187.md`).
- On the integrated GPU a full-screen function pays for every term at every pixel: branch out what
  only part of the frame needs (#269, #257).
- Both backends are player surfaces (ADR-0019): gate on `renderer.isWebGPURenderer`, capture both,
  and take the WebGL2 shot on real hardware when there is a ray march (#216).

## The gotcha files

`gotchas/` holds every hard-won lesson, one per line: symptom, cause, fix, and the file where the
fix lives. Read the engine files when you write code of that kind; read a `look-` file whole
before you build that kind of thing (they are recipes as much as warnings).

| File | Covers |
|---|---|
| `tsl-emission.md` | where the builder writes code: branches, loops, assignment order, JS operators, duplicated terms |
| `tsl-functions-loops.md` | `Fn` and `setLayout`, reserved names, `Loop`, `uniformArray` tables, shader size |
| `numerics.md` | NaN and Inf, overflow, hashing, `floor`, MSAA extrapolation, long sessions |
| `materials-draw-order.md` | alpha, additive and premultiplied blending, masks, depth, `renderOrder`, sides |
| `geometry-instancing.md` | `positionNode`, instancing, vertex buffers, merged and generated meshes, glTF |
| `light-shadows.md` | shadow maps and filters, `GodraysNode`, analytic shadows, light shafts in air |
| `post-color.md` | the post chain, MSAA, MRT, bloom, tone curves, grading, screen-space effects, hue |
| `textures-noise-targets.md` | noise sources, mips, atlases, normals from heights, render targets, feedback, simulations |
| `performance-tiers.md` | compile time, pipeline count, `compileAsync`, integrated-GPU cost, tier traps |
| `backends-capture.md` | WebGL2-backend-only faults, headless and playground captures, the packaged app |
| `look-water.md` | water, mirrors, `reflector()`, glitter, caustics, ripples |
| `look-sky-space.md` | stars, sun and moon discs, planets, rings, coronas, shells, lenses, rainbows |
| `look-clouds-volumes.md` | marched clouds and nebulae, steam, cloud cards, sphere-traced fields |
| `look-terrain.md` | ground, heightfields, cliffs, dunes, trees, painted silhouettes |
| `look-events-particles.md` | gameplay reactions, aiming round the board, particles, bolts |

**Searching.** A row is one long line, and a search tool that clips long lines shows nothing of
it. Use the script, which prints a row whole as symptom, cause and fix:

```bash
node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs "vertex buffer"   # a phrase from the error
node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs black bloom       # rows holding both words
node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs 94                # the row cited as "gotcha #94"
node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs --list water      # numbers and symptoms, one file
```

**Adding one.** A fault that cost you a round will cost the next session one too: add a row at the
end of the matching file, in both copies of the skill (`gotchas/README.md`). Never on this page:
it is loaded whole on every use, and `tests/unit/agent-skill-contract.test.js` holds it to a size.

## Reference docs (read on demand)

Beyond those in "Where to look": `docs/core-concepts.md` (types, operators, uniforms, `Fn`, control
flow), `docs/materials.md` (every node material and slot), `docs/noise-and-utility-nodes.md`
(where a theme gets its noise; billboards, UV and blend helpers), `docs/scene-techniques.md`
(mirrors, soft particles, feedback targets, fake lighting, refraction, fog),
`docs/compute-shaders.md` (compute needs a CPU twin for WebGL2), `docs/device-loss.md`,
`docs/limits-and-features.md`, `docs/wgsl-integration.md` (WebGPU only: not used here).

**A starting point.** `templates/theme-starter.effect.js` is the smallest world that keeps every
rule on this page (a sky function, a ground, instanced motes, an event table, tiers, a post
chain): copy it to `src/playground/effects/<id>.effect.js` and replace its content part by part.
A test builds it to WGSL and GLSL at every three bump. For a whole theme, copy real code, which
its own tests keep honest: `src/themes/serenity-warp/` is the cleanest, `src/themes/rainbark/`
has the richest event director.

## Before you call it done

1. Screenshots at a fixed `t`: WebGPU, `forceWebGL=1`, the lowest tier, portrait, and each event you
   touched. Look at them; a validator's "pass" has sat beside a broken picture before.
2. Console clean on both backends: no WebGPU validation error, no `THREE.TSL` warning.
3. The theme's tests and its shader gate (`tests/unit/<id>-shaders.test.js`) pass. For a change to
   a theme, the full list of checks is `docs/theme-foundation.md` §10 and §11.
4. Anything that cost you a round is a row in `gotchas/`, in both copies of the skill.
