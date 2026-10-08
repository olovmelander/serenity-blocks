---
name: webgpu-threejs-tsl
description: Three.js WebGPU + TSL reference (node materials, compute shaders, post-processing) verified against this repo's pinned three 0.186.1 (r186). Use when creating or changing any visual surface — a theme (src/themes), a playground effect (src/playground/effects), an Odyssey chapter (src/rendering/odyssey) — or when working with shaders, particles, glow/bloom, reflections, auroras, GPU compute, node materials, or debugging WebGPU validation errors and TSL compile failures. Not for Phaser 2D code, DOM/CSS UI, Electron shell, or audio work.
---

# WebGPU Three.js with TSL (three r186)

TSL (Three.js Shading Language) is a node-based shader abstraction: you write GPU
shaders in JavaScript instead of GLSL/WGSL strings. Every visual surface in this
repo (themes, playground effects, Odyssey chapters) is WebGPU/TSL.

**Version contract:** this repo pins `three@0.186.1` (r186). The migration-sensitive APIs below
were reverified against that package; historical r185 notes describe retained behavior. TSL churns fast between releases — when an API is in
doubt, the source of truth is `node_modules/three/src/Three.TSL.js` (TSL exports)
and `node_modules/three/src/Three.WebGPU.js` (renderer/material exports), not your
training data and not the three.js wiki.

## Workflow (non-negotiable)

Iterate in the playground, screenshot to verify, then port. The full loop, the
screenshot requirement, and the ⚠️ TDR hazard (one small effect per session — full-journey
captures have crashed this machine's iGPU) are defined in CLAUDE.md and
`docs/WEBGPU_THREEJS_WORKFLOW.md`; the drop-in effect contract is `src/playground/README.md`.
This skill covers the API layer only — it does not replace that workflow.

## Quick start

```javascript
import * as THREE from 'three/webgpu';   // NEVER plain 'three' for WebGPU work
import { color, time, oscSine, Fn, uniform } from 'three/tsl';  // every TSL fn must be imported

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();                   // before first render/compute

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = color(0xff0000).mul(oscSine(time));  // oscSine already returns 0..1
```

The post class was renamed `RenderPipeline` in r183; in r186 `THREE.PostProcessing`
is a fully-functional **deprecated alias** that logs one warnOnce per pipeline
("has been renamed to RenderPipeline"). **Repo policy: construct
`RenderPipeline`** — the repo-wide rename has landed, so a `PostProcessing`
deprecation warning now indicates a stray un-renamed site that needs fixing.
Copy the working repo pattern, e.g. `src/themes/wolfhour/wolfhour-post.js`:

```javascript
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const post = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode('output');
post.outputNode = scenePassColor.add(bloom(scenePassColor));
post.render();                            // instead of renderer.render()
```

## Gotchas this repo has already paid for

Check this table before debugging "shader looks wrong / nothing renders / slow".

| Symptom | Cause | Fix |
|---|---|---|
| `PostProcessing: "PostProcessing" has been renamed to "RenderPipeline"` warning | A stray un-renamed construction site — the repo-wide rename to `RenderPipeline` has landed, so nothing in-repo should construct `PostProcessing` anymore | Swap that site to `new THREE.RenderPipeline(...)` (pure name change; every member is identical) |
| `X is not defined` in effect code | TSL functions are not globals | Import every identifier from `'three/tsl'` (incl. `Fn`, `If`, `Loop`) |
| Instanced mask/displacement lands in wrong space, or instancing collapses to one transform | r185 **inverted** `positionNode` ordering (verified from generated WGSL): r181 ran `positionNode` first (`positionLocal` inside it = raw geometry) and applied instance/batch/skin matrices *after* its output; r185 applies the matrices *first* (`positionLocal` is post-instance inside `positionNode`) and the node's output is **final** | Portable idiom: compute masks/pivots/phases from `positionGeometry`, output `positionLocal.add(displacement)`. Never output a `positionGeometry`-only expression on a real-matrix InstancedMesh — on r185 that discards the instance matrices |
| Instanced/point particles invisible or collapsed to a dot | `positionNode = buffer.element(instanceIndex)` replaces *every vertex* with one point | `positionLocal.add(buffer.element(instanceIndex))`, or the `vertexNode` billboard pattern in `src/themes/winter/rendering/snow-renderer.js` |
| Conditional write silently ignored | JS variable reassignment inside `If()` — TSL can't see `x = x.add(1)` | `.toVar()` + `.assign()`, or `select()` — see `docs/core-concepts.md` § Control Flow |
| A branch reads ZEROS from shared nodes (uniform `If`/`Else` regimes: one side fine, other flat/grey) | The WGSL builder hoists var **declarations** to function scope but emits each **assignment at the node's first build site**; a `.toVar()` created *outside* any `Fn` (no active stack) gets its assignment emitted inside whichever branch builds it first — the other branch reads the zero-initialised declaration. Also poisons later graph roots (`opacityNode` after `colorNode`) that reuse the var | Root-pin: at the top of the `Fn`, before any `If`, call bare `.toVar()` on every shared node (`toStack()` runs at creation, so each call is a real root statement). Found via Odyssey water's regime branch: submerged frames zeroed `wN`/`depth` — Snell ceiling went flat, sea went transparent |
| Shader module fails to compile at all | `smoothstep(a, a, x)` — **EQUAL** edges are a hard WGSL error ("called with 'low' equal to 'high'"), killing the whole module so the material never draws | Keep the edges distinct |
| JS-side mask is 0 | `THREE.MathUtils.smoothstep(x, min, max)` (the **JS** helper) really does return 0 on reversed edges — `if (x <= min) return 0` | Invert the ramp: `1 - smoothstep(lo, hi, x)` |
| A region goes BLACK behind a mask that should hide a term (sky vanishes above a ridge, a disc eats its backdrop) — often ONLY on a tall portrait screen | The masked-out term is unbounded there: a rim light written `exp(k * signedDistance)` reaches 1e8 on the far side, and `mix(a, b, 1)` evaluated as `a + (b - a)` loses `b` entirely to float cancellation. A 390 × 844 screen spans more than twice the hero-space height of 16:9, so an overflow that stayed at the float maximum (and was masked away) in landscape becomes Inf, then NaN | Bound every term before it is masked: `exp(max(distance, 0).mul(-k))`, and capture portrait before calling it done. Found on the breathing Aurora world (2026-10-05), `src/ui/effects/breathing/worlds/aurora.js`; the portrait form on the forest's fern rim, `worlds/forest.js` |
| Effect "disabled" but GPU cost unchanged | Multiplying by a 0-value uniform is NOT dead-code-eliminated | Gate in JS (skip the pass / swap the node), not with shader zeros |
| Per-frame uniform upload you didn't intend | Mutating a `THREE.Color`/`Vector` inside `uniform(...)` in place still uploads every frame | Fine when intended; don't assume unchanged-value writes are free |
| Oscillation stuck in upper half | `oscSine` already returns 0..1 | Drop the `.mul(0.5).add(0.5)` remap |
| Emissive-only (selective) bloom does nothing | Selective bloom needs MRT; most themes here run bloom on the composite without MRT | Check the theme's `useMRT` before promising selective bloom; see `docs/post-processing.md` § MRT |
| Additive glow stops blooming / glows stomp black after r185 | MRT secondary attachments default to `NoBlending` in r185 | Use `withEmissiveMaterialBlending` from `src/themes/shared/mrt-blend.js` — it does `setBlendMode('emissive', new BlendMode(MaterialBlending))` ; r186 preserves blend modes during `merge()` natively |
| First-visit hitch despite `compileAsync`, or warmed materials rebuild wrong | r185 `compileAsync` defers node building to a per-object loop that **yields to the main thread** — a bind/compile/restore-synchronously recipe restores state mid-await and silently poisons the MRT-agnostic builder cache | Use Odyssey's `warmup/post-target-compile.js` for scoped target/MRT bindings across deferred builds; keep its side, call-depth and live-loop guards |
| Backgrounded tab burns GPU | Loop keeps computing/rendering when hidden | `shouldRenderFrame()` gate + clamp `delta` in the update loop (pattern in every theme) |
| Works in dev, black in packaged Electron | Absolute `/assets/...` fetch resolves to filesystem root under `file://` | Use relative `./assets/...` |
| ONE pipeline takes seconds to compile (startup freeze / slow theme entry); the WGSL is small | `mx_noise_float` / `mx_fractal_noise_*` (MaterialX Perlin) hashes the lattice with an **integer** Bob-Jenkins mix; once DXC inlines every evaluation the compile grows superlinearly — 20 evaluations = **7.3 s** on an RTX 3070 (Odyssey lava lake, 2026-08-21). r185's `select()` emission doubled what r181 cost | Use the Ashima simplex port `snoise3` / `simplex3` in `chapter-environments/shared/odyssey-tsl-noise.js` (mx-calibrated: same std and feature size), value noise, or a baked texture. Diagnose with an `initScript` that wraps `GPUDevice.prototype.createRenderPipelineAsync` and sorts by duration — the label names the material |
| Fragment WGSL is huge (tens of KB) with no `fn` definitions; compile slow | A TSL `Fn` **without `setLayout`** is an *inline* function — its body is re-emitted at every call site (a 20-call simplex lake fragment was 113 KB) | Give every shared helper `Fn` a `setLayout({ name, type, inputs })`; with it the builder emits one real WGSL `fn` (14 KB, 1.9 s instead of 3.7 s on the same lake) |
| `compileAsync` prewarm is slow / reads `background.isColor` of undefined | Argument order: three's contract is `compileAsync(objectToCompile, camera, targetScene)`. Passing `(scene, camera, group)` projects the WHOLE scene and takes lights/background from a Group | `compileAsync(group, camera, scene)` — and because r185 awaits each object's pipeline before the next (one call = serial compiles), fan a group out through a pool of targeted per-object calls, one per builder-identity bucket (`compileObjectsFannedOut` in `warmup/post-target-compile.js`; InstancedMesh objects each own a builder state — RenderObject.js:833). Pinned by `tests/unit/odyssey-post-target-compile.test.js` |
| `[Texture "ShadowDepthTexture"] usage (TextureBinding\|RenderAttachment) ... same synchronization scope`, then invalid command buffers | A shadow **caster** samples the shadow map in its `colorNode` (unlit materials that call `shadow(light)` themselves). The shadow pass builds each caster's alpha as `material.colorNode.a` (`Renderer._getShadowNodes`), so the whole colour graph — including the shadow lookup — runs while the map is the render target | Put a caster's shading in `material.fragmentNode = vec4(colour, 1)` and leave `colorNode` unset. Non-casters may keep `colorNode`. Precedent: `src/themes/fall/fall-forest.js` |
| Need real sun shadows in an unlit (`MeshBasicNodeMaterial`) scene | — | `const lit = float(shadow(light))` from `three/tsl` works standalone: share ONE node across all materials, add the light to the scene, set `renderer.shadowMap.enabled = true` and `castShadow` on casters. For a fixed light set `light.shadow.autoUpdate = false` and raise `needsUpdate` over the first frames (async pipelines can still be missing from the first map). Verified on both backends. Precedent: `src/themes/fall/fall-light.js` |
| `GodraysNode` throws / reads `depthTexture` of null at build | It reads `light.shadow.map` inside `setup()`, and that map only exists after some material that uses the light's shadow has been built | Render the scene once (`renderer.render(scene, camera)`) before the first `pipeline.render()`; then `godrays(scenePassDepth, camera, light)`. Works on WebGPU and the WebGL2 backend. Precedent: `src/themes/fall/fall-post.js` |
| `THREE.TSL: "rtt()" does not allow overwriting the value` every frame | `bilateralBlur(node)` was given a non-texture node (e.g. the `GodraysNode` itself); it ping-pongs its input texture and cannot swap an `rtt()` wrapper | Pass the pass texture: `bilateralBlur(godraysNode.getTextureNode(), ...)` |
| A hashed pattern sparkles per pixel inside one instance (speckled windows, dithered masks) | A per-instance attribute read in the fragment stage is an interpolated varying: a constant comes back with last-bit noise, and a hash amplifies that into a different value per pixel. A large hash input (a seed in the thousands times a fraction) loses the same bits on its own | Store instance seeds as INTEGERS, `floor(seed.add(0.5))` in the shader, and split a big seed into two small integers (`mod(seed, 64)`, `floor(seed / 64)`) so every hash input is exactly representable. Found on Neon District's facades (2026-10-05), `neon-district-facades.js` |
| A whole row or column of a procedural grid flickers between present and absent per pixel | `floor()` of a quotient of interpolated per-instance values that divides EXACTLY (storeys = (height - plinth) / storey height) lands either side of the integer from pixel to pixel | Bias the quotient before the floor (`floor(q.add(0.02))`) wherever the layout can produce an exact division. Same file |
| `THREE.TSL: TypeError: Cannot read properties of undefined (reading 'addToStack') "VarNode.build()"` on the **WebGL2 backend only**; the mesh never draws | A `select()` whose branch holds another `select()` (e.g. `select(alive, clip(...), CULLED)` where `clip` itself selects) with `Fn` calls such as `hash()` inside. The GLSL builder resolves the inner conditional's type through `flowBuildStage`, where there is no base stack for the call's implicit var. The WGSL builder builds the same graph without complaint, so a WebGPU-only check misses it | Fold the conditions into ONE `select(a.and(b), value, fallback)` and build `value` as a `.toVar()` inside a `Fn` first. Precedent: `streakClip` in `src/themes/black-hole/black-hole-matter.js` |
| An additive layer leaves a grey box, or changes a post effect that reads the scene pass's alpha | Non-premultiplied `AdditiveBlending` is `(SrcAlpha, One, One, One)` (`WebGPUPipelineUtils.js`): every additive fragment ADDS its alpha of 1 to the target | `premultipliedAlpha: true` (blend `One, One, One, One`) plus `material.outputNode = vec4(rgb, 0)`. `outputNode` replaces the result after the premultiply step, so the light is added and the target's alpha is left alone. Precedent: `black-hole-matter.js` |
| Alpha written by an opaque material's `colorNode` arrives as 1 | `NodeMaterial.setupDiffuseColor` assigns `diffuseColor.a = 1` for opaque, normally-blended materials | Write the whole fragment: `material.fragmentNode = vec4(rgb, a)`. Precedent: `black-hole-lens.js` hands the post chain a mask this way |
| A camera-facing ribbon built in WORLD space (`side = cross(axis, toCamera)`) draws nothing, with no error | Its winding faces away from the camera and the default `FrontSide` culls it. Quads built in clip space keep the plane's winding and are unaffected | `material.side = THREE.DoubleSide` |
| `Error while parsing WGSL: unresolved value 'nodeUniformN'` inside a function you gave `setLayout`, and the material's pipeline is invalid | The laid-out `Fn` samples a **texture** captured from the enclosing scope. r186 emits the body as a real WGSL `fn` that names the texture binding, but the binding is not declared for that module (verified 2026-10-05 with `texture(tex, uv).level(0)` in a `setLayout` helper; the same helper inline compiled) | Keep textures out of laid-out helpers: sample in the caller and pass the value in, or replace the lookup with arithmetic. Pass event/uniform values in as parameters too (one `vec4` built once per fragment) rather than closing over them — that keeps the helper a pure function. Precedent: `caveEnvironment` in `src/themes/crystal-cave/crystal-cave-light.js` |
| Whole frame goes **black** (no console error) as soon as one material is on screen; a tighter camera angle renders fine | One fragment produced **NaN** and the bloom mip chain spread it over the image. Usual source: `pow(x, n)` with a base a hair below zero — Schlick's `pow(1 - cos, 5)` when a normalised dot product returns 1.0000001, or `sqrt`/`pow` after a subtraction that should be >= 0. `pow2/pow3/pow4` are plain multiplies and are safe | Clamp the cosine (`clamp(dot(...), 0, 1)`) and write small integer powers as products (`m.mul(m)`…). Bisect by hiding one material at a time: the frame returns when the culprit leaves. Precedent: `schlick()` in `src/themes/crystal-cave/crystal-cave-gems.js` |
| `Error while parsing WGSL: unresolved value 'NodeBuffer_…'` or `struct member nodeUniformN not found` after giving a shared helper `setLayout` | A `Fn` with a layout is generated once and its code is reused by every later material; uniforms and uniform arrays it captured from its closure are only declared in the first shader that built it | Keep layout functions pure — pass values in as parameters, as `chapter-environments/shared/odyssey-tsl-noise.js` does — and leave helpers that read uniforms as inline `Fn`s (a `Loop` inside an inline `Fn` is fine). Precedent: `src/themes/sakura-twilight/sakura-light.js` |
| Seconds of frozen frames right after a heavy scene reports ready, though no single shader is large | Pipeline COUNT: three creates one per mesh per pass it is drawn in — scene pass, `reflector()` pass, shadow pass, and any direct `renderer.render()` such as the one that primes `GodraysNode`'s shadow rig. Sakura Twilight's 200 pipelines froze it for ~14 s after ready; at 113 it measured 7.5–11.5 s (noisy: other sessions were on the machine) | Count them first (a preload that wraps `GPUDevice.prototype.createRenderPipeline`; the label names the material). Then cut passes, not materials: prime the shadow rig with one object visible instead of the whole scene, and keep small or near things out of the mirror with a camera layer (`reflection.reflector.getVirtualCamera(camera).layers.set(0)` before the first frame). Sharing one material across meshes does NOT lower the count (six bark meshes with one material = twelve pipelines in two passes). Precedent: `src/themes/sakura-twilight/sakura-world.js`, `sakura-water.js` |
| `THREE.TSL: 'dFdx' is not supported in the vertex stage` on a loaded glTF | The model ships without normals (the Khronos sample fox does), so `normalWorld` falls back to screen-space derivatives; a `varying(...)` that contains it evaluates them in the vertex stage | Set `material.flatShading = true` after construction (it is not a constructor option of `MeshBasicNodeMaterial`) and keep the normal out of vertex-stage expressions. Precedent: `src/themes/sakura-twilight/sakura-foxes.js` |
| A thin line is ruled down every cell boundary of a glyph or sprite atlas | The cell index comes from `floor()`/`fract()` of a UV, so the atlas UV JUMPS between neighbouring pixels at each boundary; the automatic mip selection reads that jump as extreme minification and samples the coarsest level there, which holds the average of the whole atlas | Sample a fixed level (`texture(atlas, uv).level(1.0)`) or pass explicit gradients; keep the mip chain only for the level you choose. Found on Chiral Gold's combo tally (2026-10-05), `chiral-gold-fx.js` |
| `Render pipeline creation failed (...): Vertex buffer count (9) exceeds the maximum number of vertex buffers (8)`, the mesh never draws on WebGPU (the WebGL2 backend draws it) | On WebGPU every `BufferAttribute` is its own vertex buffer and a pipeline may bind eight. `position` + `uv` + seven instanced attributes is nine | Pack the per-instance attributes into `InstancedInterleavedBuffer`s (one for what never changes, one `DynamicDrawUsage` for what gameplay writes) and expose them as `InterleavedBufferAttribute`s under the same names; `attribute('aName', 'vec4')` reads them unchanged, and several draws can share the buffers. Found on Lunara's spires (2026-10-05), `lunara-crystals.js` |
| A sky dome's shader (stars, aurora, nebula) costs the whole frame although ground, water and props cover most of it | The dome was drawn first (`renderOrder` low, `depthTest = false`), so every pixel ran its shader before being painted over, in the mirror's second render too | Give the solids the lower `renderOrder`s (near things first), draw the dome LAST among the opaque parts with `depthTest = true`, `depthWrite = false`: it is shaded only where the sky shows. Same build, `lunara-sky.js` |
| A fragment module of 100–180 KB of WGSL with hundreds of `var<private>` declarations; slow pipeline creation | A JS `forEach` that emits a feature's TSL once per element (47 painted crystals, 84 loop segments, 30 leaves) inlines every copy and hoists all its variables: a 135 KB `main()` with 974 private variables | One TSL `Loop` over the same values in a `uniformArray` (or derived from the loop index), and repeated bodies as pure laid-out `Fn`s. Four breathing worlds' largest modules went from 139–176 KB to 31–64 KB with frames identical to rounding (`worlds/storm.js`, `crystal*.js`, `solar.js`, `zen.js`, 2026-10-05). Measure with `scripts/capture-breathing-headless.mjs --shaders` |
| Pipeline creation fails WebGPU validation after splitting a material's data into many `uniformArray`s (the WebGL2 backend may still draw) | Each `uniformArray` is its own uniform buffer and a shader stage may bind 12 (`maxUniformBuffersPerShaderStage`); the object's own buffer counts too, so 13–15 arrays fail | Pack a feature set into ONE array of `vec4` rows addressed by block/stride/offset. Precedent: `row(block, i, k)` in `src/ui/effects/breathing/worlds/solar.js` |
| Screen-space light shafts (`radialBlur` or a hand-rolled march toward the light) smear bright lines into long streaks, draw ruler-straight shadow lines under thin occluders, veil the whole frame, or show a lattice/grain at reduced resolution | Every pixel marches toward the light, so anything bright that points at it (vertical rims below a light) stacks instead of spreading; a thin occluder straight below the light shadows its whole column; a march that reaches the light gives every pixel the core; a jittered single march at ¼ resolution leaves its jitter pattern | Limit emitters to the light's neighbourhood (radius) and to a region, shorten the march (`length` ≈ 0.7), fade its last steps, and stack two short marches (N + M taps ≈ N × M samples, no jitter). Precedent: `src/ui/effects/breathing/stage/breath-post.js` |
| Black, red and green dashes along thin bright strips (inlaid lines, rims, ribbons) once they are far away; clean up close and clean without MSAA | With MSAA a fragment's varyings are evaluated at the pixel centre even when only a corner sample is covered, so on a strip thinner than a pixel a UV is EXTRAPOLATED far outside 0..1. A profile such as `1 - abs(uv.x - 0.5) * 2` goes strongly negative, the colour goes negative, and fog or bloom then mixes it per channel | `clamp()` every interpolated coordinate (or the profile built from it) before it shapes a colour; the same for barycentrics and any per-vertex 0..1 ramp. Found on Halcyon Apex's ley lines (2026-10-08), `createLeyMaterial` in `src/themes/halcyon-apex/halcyon-apex-stone.js` |

> **CORRECTED 2026-08-13 — reversed-edge `smoothstep` in a SHADER is fine.** This table used to
> claim `smoothstep(hi, lo, x)` returns 0 in WGSL. It does not. TSL emits the WGSL builtin
> verbatim (`MathNode.js:387/1018`; no entry in `WGSLNodeBuilder`'s polyfill or method tables,
> so `getMethod` falls through to the literal name), and a GPU probe on Dawn/Chrome 151
> compiled it clean and returned a **descending ramp exactly equal to `1 − smoothstep(lo, hi, x)`**
> at all 32 sampled values. The false rule came from conflating three real things: the **JS**
> `THREE.MathUtils.smoothstep` (which genuinely early-outs to 0), the **equal-edge** compile
> error, and a since-removed Tint validation error on const reversed edges (three.js #30593,
> fixed by gpuweb #4981). Shipped counter-examples: the wisps' soft edge, `smoothstep(1.0, 0.75, d)`
> in `src/themes/lunara/lunara-fx.js` and `src/themes/halcyon-apex/halcyon-apex-fx.js`; until its
> 2026-10-08 rebuild the Halcyon Apex effect drew its sun, halo, cloud band and haze through four
> reversed-edge smoothsteps (`halcyon-apex.effect.js` at 182ebd19).
> Prefer forward edges for readability; do not "fix" a working reversed one on this rule's say-so.

## r186 lifecycle and compute

- Use `compileComputeAsync` from `src/rendering/webgpu-compute-pipeline-async.js`
  on loading surfaces. It delegates to native compilation, checks actual GPU readiness,
  and blocks dispatch while nodes build or pipelines fail. A resolved native compile
  promise alone does not prove success. The `syncComputePipelines` rollback is retired.
- `await renderer.dispose()` before destroying/nulling a device or releasing a shared
  device owner. Canvas removal and reference clearing may remain immediate. Observe
  disposal rejection even in fire-and-forget cleanup. See Stillwater and boot warp.
- r186 removes WebGPU `PCFSoftShadowMap`; use `PCFShadowMap`.

## Doc map — read on demand, not up front

- `docs/core-concepts.md` — types, operators, uniforms, control flow. Read when writing
  any nontrivial TSL, and always for conditionals/mutation (`If`/`toVar`/`select` rules).
- `docs/materials.md` — every `*NodeMaterial` and node property. Read when choosing or
  configuring a material.
- `docs/compute-shaders.md` — storage buffers, compute passes, atomics, GPU↔CPU readback.
  Read for particles/simulation work.
- `docs/post-processing.md` — RenderPipeline, `pass()`, MRT, display effects
  with verified import paths. Read for bloom/grade/DoF/etc.
- `docs/noise-and-utility-nodes.md` — built-in noise (mx_* / triNoise3D), per-instance
  variation, billboarding, UV/blend utilities. Read BEFORE hand-rolling noise or
  desync logic for any theme effect.
- `docs/scene-techniques.md` — reflector() mirrors, soft particles, GPU feedback
  textures (trails/ripples), in-playground grade preview, fake lighting for unlit
  scenes, glass refraction, height fog. Read when building or upgrading a theme's
  hero visual.
- `docs/performance.md` — this repo's perf playbook: GPU timestamps, frame gating,
  fill-rate triage, TSL cost traps, tier scaling. Read before ANY perf pass and
  after adding a heavy effect.
- `docs/wgsl-integration.md` — `wgslFn` for raw WGSL. Read only when TSL can't express it.
- `docs/device-loss.md` — GPU device-loss recovery. Read when the iGPU TDRs or the
  renderer dies mid-session.
- `docs/limits-and-features.md` — `requiredLimits` for big buffers. Read when compute
  buffers exceed ~128 MiB or you hit limit validation errors.
- `REFERENCE.md` — one-page cheatsheet of the above.
- `examples/`, `templates/` — standalone-app scaffolds. For repo work prefer real code:
  a playground effect (`src/playground/effects/*.effect.js`) or a theme's `-post.js` is
  always closer to the target than a generic template.

## Verification checklist (before claiming done)

1. Playground screenshot via chrome-devtools MCP (`?effect=<id>`, wait for
   `window.__PLAYGROUND_READY__`, use `?t=<seconds>` for phase-locked shots).
2. Console clean — zero WebGPU validation errors or TSL compile warnings.
3. If you touched a material/pass shared across quality tiers, sanity-check one low tier.
4. Port to the real theme/chapter only after 1–2 pass in isolation.
