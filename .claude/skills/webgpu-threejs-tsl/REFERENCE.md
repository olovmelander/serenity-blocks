# TSL quick reference (three r187)

The API on one page, checked against the installed `three@0.187.0`. Where a line has a trap
behind it, the gotcha's number is given. For anything not here, test the name
(`node -e "import('three/tsl').then(m => console.log('name' in m))"`) before using it.

## Contents

[Imports](#imports) · [Types](#types) · [Operators](#operators) · [Math](#math) ·
[Geometry and camera nodes](#geometry-and-camera-nodes) · [Screen](#screen-nodes) ·
[Uniforms and attributes](#uniforms-attributes-varyings) · [Functions](#functions) ·
[Control flow](#control-flow) · [Textures](#textures) · [Materials](#materials) ·
[Post](#post) · [Noise and hashing](#noise-and-hashing) · [Compute](#compute) ·
[Renderer](#renderer) · [Renamed and removed](#renamed-and-removed)

## Imports

```javascript
import * as THREE from 'three/webgpu';                     // renderer, node materials, all of core
import { Fn, If, Loop, float, uniform, vec3 } from 'three/tsl';   // EVERY TSL name, these included
import { bloom } from 'three/addons/tsl/display/BloomNode.js';     // post nodes: one file each
```

Never `from 'three'` in WebGPU code: a second copy of three breaks node materials.

## Types

| TSL | Shader type | Notes |
|---|---|---|
| `float(1.0)`, `int(1)`, `uint(1)`, `bool(true)` | scalar | a bare JS number is promoted where a node method takes it |
| `vec2`, `vec3`, `vec4`, `ivec2`, `uvec2`, … | vector | `vec3(x)` splats; `vec3(selectNode)` can collapse to a scalar, spell out three (#177) |
| `color(0xff8800)` | `vec3` | converted from sRGB to the linear working space; author scene-linear HDR light as `vec3` |
| `mat2`, `mat3`, `mat4` | matrix | |

Convert with `.toFloat()`, `.toInt()`, `.toUint()`, `.toVec3()`. Swizzle with `.xyz`, `.rgb`,
`.xz`, `.zyx`.

## Operators

Nodes are objects: JavaScript operators do not work on them. `-x` prints `NaN` into the shader
and `1 + x` builds a string (#167, #213).

| Meaning | TSL | Meaning | TSL |
|---|---|---|---|
| `a + b`, `a − b` | `a.add(b)`, `a.sub(b)` | `a < b`, `a > b` | `a.lessThan(b)`, `a.greaterThan(b)` |
| `a × b`, `a ÷ b` | `a.mul(b)`, `a.div(b)` | `a ≤ b`, `a ≥ b` | `a.lessThanEqual(b)`, `a.greaterThanEqual(b)` |
| `−a`, `1 − a` | `a.negate()`, `a.oneMinus()` | `a == b`, `a != b` | `a.equal(b)`, `a.notEqual(b)` (no `.equals`) |
| modulo | `a.mod(b)`: floats `a − b·floor(a/b)`, ints `%` | and, or, not | `a.and(b)`, `a.or(b)`, `a.not()` |
| assign | `v.assign(b)`, `v.addAssign(b)`, `v.mulAssign(b)` | clamp 0..1 | `a.saturate()` |

## Math

`abs sign floor ceil fract min max clamp mix step smoothstep sin cos tan asin acos atan exp log
pow sqrt length distance dot cross normalize reflect refract fwidth dFdx dFdy`

- `mix(a, b, t)` as a function. The chained form makes the RECEIVER the weight: `t.mix(a, b)`.
  `a.mix(b, t)` blends with `a` as the factor.
- `atan(y, x)` is the two-argument form; there is no `atan2`.
- `smoothstep(lo, hi, x)`: equal edges are a hard WGSL error (#69); reversed edges are fine in a
  shader. The JavaScript `THREE.MathUtils.smoothstep(x, min, max)` takes `x` FIRST (#70).
- `pow(x, n)` with a base a hair below zero is NaN: clamp the base, write small integer powers
  as products (#94). `normalize()` of a zero vector is NaN (#231).
- Shaping: `parabola(x, k)` (a bump: 0, 1, 0), `gain(x, k)` (an S-curve), `pcurve(x, a, b)` (as
  shipped, a 0→1 ease), `remap`, `remapClamp`.
- Oscillators over a time node: `oscSine(t)`, `oscSquare(t)`, `oscTriangle(t)`, `oscSawtooth(t)`
  all return 0..1 already.
- Constants: `PI`, `TWO_PI` (`PI2` is deprecated).

## Geometry and camera nodes

| Node | Meaning |
|---|---|
| `positionGeometry` | the raw vertex attribute, before anything |
| `positionLocal` | model space; inside a `positionNode` it already holds the instance matrix (#65) |
| `positionWorld`, `positionView` | world and view space |
| `normalGeometry`, `normalLocal`, `normalWorld`, `normalView` | pin the last two with `.toVar()` before a branch reads them (#205, #212) |
| `uv()`, `uv(1)`, `vertexColor()`, `tangentLocal` | attributes |
| `frontFacing` | bool, fragment stage |
| `instanceIndex`, `vertexIndex`, `drawIndex` | built-in indices |
| `cameraPosition`, `cameraNear`, `cameraFar` | |
| `cameraViewMatrix`, `cameraProjectionMatrix`, `cameraWorldMatrix`, `cameraProjectionMatrixInverse` | inside a post chain these belong to the pipeline's quad camera (#165) |
| `modelWorldMatrix`, `modelViewMatrix` | |

`transformedNormalView` and `transformedNormalWorld` no longer exist: use `normalView` and
`normalWorld`.

## Screen nodes

| Node | Meaning |
|---|---|
| `screenUV` | 0..1, **y = 0 at the TOP** on both backends |
| `screenCoordinate` | the same in pixels |
| `screenSize` | drawing buffer size, pixels |
| `viewport` | `vec4(x, y, width, height)`, physical pixels; `viewportSize` is its `.zw` |
| `viewportLinearDepth`, `linearDepth()` | scene depth and this fragment's, both 0..1 across near..far |
| `viewportSharedTexture(uv)`, `viewportTexture(uv)`, `viewportMipTexture(uv)` | what is already drawn; the shared one is ONE texture for all targets (#240) |

A render target's `v = 0` is its TOP row on both backends (#113).

## Uniforms, attributes, varyings

```javascript
const u = uniform(0.5);                          // .value from JavaScript; float, Vector2/3/4, Color, Matrix
const n = uniform(0, 'int');                     // a typed uniform (a loop count)
const rows = uniformArray(vector4Array, 'vec4'); // one uniform BUFFER; rows.element(i); 12 buffers a stage (#102)
uniform(0).onRenderUpdate(({ deltaTime }) => deltaTime);            // the argument is the NodeFrame
uniform(0).onObjectUpdate(({ object }) => object.userData.value);   // also onFrameUpdate

const a = attribute('aPlace', 'vec4');           // any geometry attribute by name, interleaved too
const v = varying(expression, 'vName');          // computed in the vertex stage, interpolated
```

- Mutating a `Vector`/`Color` in place inside a uniform uploads every frame (#73).
- A per-instance value read in the fragment stage is interpolated and comes back a few bits off:
  store integers and `floor(x.add(0.5))`, or pass it flat (`src/themes/shared/flat-varying.js`) (#87).
- A varying on a thin triangle is extrapolated under MSAA: clamp it (#105), or take it at the
  centroid (`src/themes/shared/centroid-varying.js`).
- WebGPU binds 8 vertex buffers a pipeline: pack instance attributes into one
  `InstancedInterleavedBuffer` (#99).
- `instancedBufferAttribute(typedArray, 'float')` is NOT instanced in r187; pass a real
  `new THREE.InstancedBufferAttribute(array, n)`.

## Functions

```javascript
// Inline: the body is re-emitted at EVERY call site (#81). Fine for a one-off, or for a
// builder that reads the uniform bag or a texture.
const tint = Fn(([c, k]) => c.mul(k));

// Laid out: ONE real shader function. Must be pure (no captured uniform or texture, #93, #95),
// flat (calls no other laid-out helper, #207), with parameter names no shader language
// reserves (`from`, `input`, `filter`, … #178, #223).
const hash21 = Fn(([pIn]) => {
  const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'my_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });
// Short form: Fn(fn, { pIn: 'vec2', return: 'float' })  (three names it fnNN)

// A default is a plain JavaScript value until you make it a node
const add = Fn(([a = float(1.0), b = float(2.0)]) => a.add(b));
```

- A laid-out function's code is cached per backend and reused by every later material: that is
  why it cannot read a uniform.
- three names short-form functions `fnNN`. So do the MaterialX noises, which means a search of
  the generated shader for `mx_` finds nothing: a shader gate uses `hasMaterialXNoise(text)` from
  `tests/unit/helpers/materialx-noise.js`.

## Control flow

All of it exists only INSIDE a `Fn`: a bare `If(...)` at module level throws.

```javascript
const out = Fn(() => {
  const N = normalize(normalWorld).toVar();        // pin shared values FIRST (#68, #171)
  const value = float(0).toVar();                  // mutable: toVar() + assign()

  If(cond, () => { value.assign(1.0); })
    .ElseIf(other, () => { value.assign(0.5); })
    .Else(() => { value.assign(0.0); });

  const picked = select(cond, a, b);               // emitted as if/else: only one side runs;
                                                   // select(cond, a, b).uniformFlow() evaluates both
  Loop(8, ({ i }) => { value.addAssign(i.toFloat()); });
  Loop({ start: int(0), end: u.count, type: 'int', condition: '<', name: 'w' }, ({ w }) => {
    value.addAssign(rows.element(w).x);            // a NAMED loop hands its index over under that name (#155)
  });
  return vec4(N.mul(value), 1.0);
})();
```

- A JavaScript reassignment (`x = x.add(1)`) inside `If` is invisible to the shader (#67).
- A value written before an `.assign()` in JavaScript but first USED after it is computed after
  it: pin it with `.toVar()` before the assignment (#200).
- A node first built inside one branch is zero in the others (#68); never nest a `select` that
  holds `Fn` calls inside another `select` (#89, WebGL2 only).
- Property assignment (`copy.y = v`) works on a node you made (`vec3(node)`, `node.toVar()`).
  On a shared node (`positionWorld.y = …`, a texture sample, a uniform) the write is lost.
- `Break()`, `Continue()`, `Discard()` (or `cond.discard()`). `Return()` takes no value; an early
  return with a value is the value returned from an `If` callback, in a laid-out `Fn` only.
- `Loop` also takes a condition node (`Loop(v.lessThan(10), …)`, a while) and counts down
  (`Loop({ start: 10 }, …)`).

## Textures

```javascript
const t = texture(map, uvNode);        // automatic mip selection
t.level(2.0)                           // an explicit mip: REQUIRED inside a branch or loop, and for
                                       // a UV that jumps (atlas cells #98) or a blurred read (#104)
t.bias(1.0)   t.grad(dx, dy)           // .grad() on a swappable placeholder loses its sampler (#274)
t.sample(otherUv)                      // the same texture at another UV (reuse ONE node)
t.load(ivec2Coord)                     // texel fetch, no filtering
t.compare(depthRef)                    // shadow compare
texture3D(volume, p)                   // texture3DLoad and texture3DLevel exist too
node.value = otherTexture;             // repoint a node from JavaScript (ping-pong targets)
```

- A filtered texture is continuous in value, not in slope: a normal from differences of a
  magnified read shows the texel grid. Bake the gradient (#169, #246, #272, #273).
- A texture captured by a laid-out `Fn` is not declared in later shaders (#93): sample in the
  caller and pass the value in.
- `normalMap(texture(tex))`, not `normalMap(tex)`. `pmremTexture(env, direction, roughness)`
  needs all three outside a lit material.

## Materials

Themes use `MeshBasicNodeMaterial` (self-shaded) and `NodeMaterial` (full-screen passes). The
lit ones (`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, …) exist; `docs/materials.md`.

| Slot | What it does | Trap |
|---|---|---|
| `colorNode` | diffuse colour (and alpha when transparent) | an opaque material's alpha is forced to 1 (#91) |
| `emissiveNode` | ADDED to the output | on a Basic material, colour + emissive is twice the light (#119) |
| `opacityNode`, `alphaTestNode`, `maskNode` | alpha, test, discard | all skipped when `fragmentNode` is set (#111) |
| `positionNode` | vertex position, model space | return `positionLocal.add(offset)` (#65, #66) |
| `vertexNode` | final clip-space position | the house form for billboards and full-screen parts |
| `fragmentNode` | replaces the whole fragment path (colour, opacity, mask, MRT) | needed for an opaque material's own alpha |
| `outputNode` | replaces the final colour AFTER the material ran (`output` is its result) | additive light: `vec4(rgb, 0)` with `premultipliedAlpha` (#90) |
| `mrtNode` | per-material MRT override | |

`side`, `transparent`, `depthWrite`, `depthTest`, `blending`, `alphaToCoverage`, `fog` are plain
properties. `renderOrder` goes on the mesh, never on a `Group` (#206, #139). A caster that
samples its own shadow map in `colorNode` breaks the shadow pass (#83).

## Post

```javascript
const pipeline = new THREE.RenderPipeline(renderer);            // PostProcessing is a deprecated alias
const scenePass = pass(scene, camera, { samples });             // omitted: the renderer's count
const sceneColor = scenePass.getTextureNode('output');          // also 'depth', an MRT name
pipeline.outputColorTransform = false;                          // then tone and encode yourself, once:
pipeline.outputNode = renderOutput(vec4(toned, 1.0), THREE.NoToneMapping);
pipeline.render();
```

FXAA (tiers without MSAA) goes LAST, after that encode: `pipeline.outputNode = samples > 0 ?
graded : fxaa(graded)`. Everything else, with every addon's signature: `docs/post-processing.md`.

## Noise and hashing

| Node | Notes |
|---|---|
| `hash(seed)` | the seed is cast to **uint** (a vector uses `.x` only, a negative float clamps to 0): pass an exact non-negative integer (#204). Returns [0, 1) |
| `rand(uv)` | vec2 → [0, 1), the classic sine hash |
| `interleavedGradientNoise(position)` | per-pixel dither; visible without a temporal filter (#201) |
| `triNoise3D(p, speed, time)` | cheap animated 3D noise |
| `mx_noise_*`, `mx_fractal_noise_*`, `mx_worley_noise_*` | exported, and BANNED in theme shaders: seconds of compile per pipeline (#80) |
| `range(min, max)` | a hash of `instanceIndex`; its seed depends on creation order, so not reproducible across builds |

House sources of noise: a laid-out hash like the one above, a 2D texture baked on the CPU and
read at an explicit level, the 2D-lattice trick for 3D (#136), or the simplex port in
`src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js`.
`docs/noise-and-utility-nodes.md` has the rest.

## Compute

```javascript
const positions = instancedArray(count, 'vec4');           // per-instance storage, read-write
const table = attributeArray(data, 'float').toReadOnly();  // per-vertex storage; read-only is opt-in
const step = Fn(() => {
  positions.element(instanceIndex).addAssign(vec4(0.01, 0, 0, 0));
})().compute(count);                                       // workgroup [64] by default
await renderer.init();
renderer.compute(step);                                    // the FIRST call compiles synchronously
```

Compute is the exception here (the WebGL2 backend needs a CPU twin). `docs/compute-shaders.md`.

## Renderer

- `await renderer.init()` once, then `render()` and `compute()` synchronously. `render()` before
  `init()` throws.
- A failed WebGPU start does not throw: the renderer falls back to its WebGL2 backend. Ask
  `renderer.backend.isWebGPUBackend`. Gate features on `renderer.isWebGPURenderer` (true on both
  backends), not on the backend (ADR-0019).
- `await renderer.dispose()`: it is async. Device loss arrives at `renderer.onDeviceLost`
  (`docs/device-loss.md`).
- `renderer.compileAsync(object, camera, scene)`; one call at a time per renderer
  (`docs/three-r187.md`). A theme leaves pipelines to the theme manager.
- Shadows: `renderer.shadowMap.enabled = true`, `PCFShadowMap` (the soft type is gone), and
  `shadow(light)` from `three/tsl` in an unlit material (#84).
- `requiredLimits` and features: `docs/limits-and-features.md`.

## Renamed and removed

| Was | Now (r187) |
|---|---|
| `THREE.PostProcessing` | `THREE.RenderPipeline` (alias warns) |
| `atan2(y, x)`, `.equals()` | `atan(y, x)`, `.equal()` |
| `transformedNormalView` / `World` | `normalView` / `normalWorld` |
| `PI2` | `TWO_PI` |
| `THREE.Clock` | `THREE.Timer`, or the rAF timestamp |
| `PCFSoftShadowMap` | `PCFShadowMap` |
| `renderAsync`, `clear*Async`, `hasFeatureAsync`, `initTextureAsync` | the sync call after `await renderer.init()` (`computeAsync` is not deprecated) |
| `burn`, `dodge`, `screen`, `overlay` | `blendBurn`, `blendDodge`, `blendScreen`, `blendOverlay` |
| `AnamorphicNode.js` | gone: BloomNode's `highPassFn` / `bloomTintColors` |
| `reflector({ resolution })` | `reflector({ resolutionScale })` |
| `backend.hasTimestamp(uid)` | `backend.hasTimestampQuery(uid)` |
| `CubeUVReflectionMapping` | gone: PMREMs are cube render targets |
| `iridescenceThicknessRange` | `iridescenceThicknessMinimum` / `Maximum` |

---

The API reference docs in this skill began as dgreenheck/webgpu-claude-skill (MIT) and have been
rewritten against this repo's pinned three. Do not re-pull upstream over them.
