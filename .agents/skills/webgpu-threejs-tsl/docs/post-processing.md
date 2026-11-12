# TSL post-processing (three r187)

A post chain is a node graph over the rendered scene, drawn by a `RenderPipeline`. Read this
when you build or change a theme's `*-post.js`, or need an addon's exact signature. The traps are
in `gotchas/post-color.md`; this file is the API.

Every theme already has a working post module (60+ `*-post.js` files, e.g.
`src/themes/serenity-warp/serenity-warp-post.js`, `src/themes/winter/winter-post.js`,
`src/themes/aurora/aurora-post.js`). Copy those, not web samples.

## Contents

- [The house chain](#the-house-chain)
- [What a scene pass is in r187](#what-a-scene-pass-is-in-r187)
- [Alpha and the output transform](#alpha-and-the-output-transform)
- [Display nodes: every addon and its signature](#display-nodes-every-addon-and-its-signature)
- [Bloom](#bloom) · [FXAA and MSAA](#fxaa-and-msaa) · [Depth of field](#depth-of-field) · [Ambient occlusion](#ambient-occlusion-gtao)
- [Colour adjustments](#colour-adjustments-from-threetsl) · [3D LUT](#3d-lut)
- [Custom effects](#custom-effects) · [Reduced-resolution work: rtt()](#reduced-resolution-work-rtt)
- [MRT and selective bloom](#multiple-render-targets-mrt)
- [Toggling, warm-up, transitions](#conditional--toggleable-effects)

## The house chain

One scene pass, one bloom, ONE output pass; tone mapping exactly once.

```javascript
import * as THREE from 'three/webgpu';
import { Fn, clamp, max, pass, renderOutput, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { sceneSamples } from '../shared/scene-antialias.js';       // from a theme folder

renderer.toneMapping = THREE.NoToneMapping;                        // the chain tones, not the renderer

const pipeline = new THREE.RenderPipeline(renderer);               // never PostProcessing
const scenePass = pass(scene, camera, { samples: sceneSamples(quality, antialias) });
const sceneColor = scenePass.getTextureNode('output');
const bloomNode = look.bloom ? bloom(sceneColor, look.bloomStrength, 0.6, 1.0) : null;   // not built on lean tiers

pipeline.outputColorTransform = false;                             // this node encodes, once
pipeline.outputNode = Fn(() => {
  const hdr = max(sceneColor.rgb, vec3(0.0)).toVar();
  if (bloomNode) hdr.addAssign(bloomNode.rgb);                     // .rgb: bloom's alpha is not coverage
  const toned = filmic(hdr);                                       // the theme's own curve
  return renderOutput(vec4(clamp(toned, 0.0, 1.0), 1.0), THREE.NoToneMapping);   // sRGB encode only
})();

pipeline.render();                                                  // each frame, instead of renderer.render()
```

`THREE.PostProcessing` is a deprecated subclass of `RenderPipeline` (renamed in r183). It warns
once per page load, however many pipelines are built; the repo constructs `RenderPipeline`
everywhere, so the warning means a stray site (gotcha #63).

## What a scene pass is in r187

- **Sample count.** `pass(scene, camera, { samples })`. When `samples` is left out, the pass
  takes the RENDERER's count (4 on an `antialias: true` renderer, else 0). Themes build the
  renderer with `antialias: false` and give the pass its count through `sceneSamples()`
  (`src/themes/shared/scene-antialias.js`), so the tier decides. Only 1 and 4 exist on WebGPU.
  The output quad itself is never multisampled (gotcha #224).
- **Format.** The colour target is HalfFloat (`renderer.getOutputBufferType()`): scene-linear HDR
  survives to the output node.
- **Resolution.** `scenePass.setResolutionScale(s)` draws the scene at `s` × the drawing buffer.
- **Reads.** `getTextureNode('output' | 'depth' | <mrt name>)`, `getViewZNode()`,
  `getLinearDepthNode()` (both assume a perspective camera), `getPreviousTextureNode(name)` for
  last frame's buffer.
- **Controls.** `setLayers(layers)`, `overrideMaterial`, `opaque` / `transparent` switches,
  `autoClear*`, and `{ depthBuffer: false }` or a shared `depthTexture` in the options.
- **Camera nodes inside the chain belong to the pipeline's quad camera**, not the scene camera
  (gotcha #165): hand the scene camera's matrices in as uniforms.
- **A second target of another sample count doubles the pipelines.** A `reflector()` beside the
  pass takes the same `samples` (gotcha #224, #96).

## Alpha and the output transform

The output transform (`renderOutput`, or the pipeline's default) treats alpha as premultiplied
coverage: it clamps alpha, un-premultiplies, tone-maps, converts colour space, premultiplies
again, and returns `vec4(0)` where alpha is 0. So:

- An output node that scales the whole `vec4` (`sceneColor.mul(ao)`) or returns a `float`
  (`grayscale(sceneColor)`) changes the canvas's opacity. Work on `.rgb` and rebuild the `vec4`.
- `sceneColor.add(bloomNode)` adds bloom's alpha too (about 3 × strength). Add `.rgb`.
- With `outputColorTransform = false`, a bare `renderOutput(node)` takes the renderer's tone
  mapping and colour space; `renderOutput(node, THREE.NoToneMapping)` encodes only.
- Additive scene parts write `vec4(rgb, 0)` so the pass's alpha stays what the solids wrote
  (gotcha #90); the scene pass's alpha can then carry a value to the post (gotcha #271).

## Display nodes: every addon and its signature

All under `three/addons/tsl/display/`. File names are inconsistent (`BloomNode.js`, `Sepia.js`,
`boxBlur.js`), and signatures change between releases: this table was read from the r187 files.
The repo itself imports only `BloomNode` (70 files), `FXAANode` (24), `GodraysNode` (5),
`BilateralBlurNode` (5), `SharpenNode` and `GaussianBlurNode`.

| Factory | File | Signature (r187) |
|---|---|---|
| `bloom` | `BloomNode.js` | `bloom(node, strength, radius, threshold)`: numbers or nodes |
| `fxaa` | `FXAANode.js` | `fxaa(node)`: needs display-space (tone-mapped, sRGB) input |
| `smaa` | `SMAANode.js` | `smaa(node)` |
| `sharpen` | `SharpenNode.js` | `sharpen(node, sharpness, denoise)` |
| `fsr1` | `FSR1Node.js` | `fsr1(node, sharpness, denoise)` |
| `gaussianBlur` | `GaussianBlurNode.js` | `gaussianBlur(node, directionNode = null, sigma = 4, { premultipliedAlpha, resolutionScale })` |
| `bilateralBlur` | `BilateralBlurNode.js` | `bilateralBlur(node, directionNode, sigma, sigmaColor)`: give it a pass TEXTURE (gotcha #86) |
| `godrays` | `GodraysNode.js` | `godrays(depthNode, camera, light)`: the light's shadow map must exist first (gotcha #85) |
| `dof` | `DepthOfFieldNode.js` | `dof(node, viewZNode, focusDistance = 1, focalLength = 1, bokehScale = 1)` |
| `ao` (GTAO) | `GTAONode.js` | `ao(depthNode, normalNode, camera)`: `normalNode` may be `null` (normals from depth) |
| `ssao` | `SSAONode.js` | `ssao(depthNode, normalNode, camera)` |
| `ssr` | `SSRNode.js` | `ssr(colorNode, depthNode, normalNode, { metalnessNode, roughnessNode, camera, … })`: an options object |
| `ssgi` | `SSGINode.js` | `ssgi(beautyNode, depthNode, normalNode, camera)`: heavy |
| `sss` | `SSSNode.js` | `sss(depthNode, camera, mainLight)` |
| `traa` / `taau` | `TRAANode.js` / `TAAUNode.js` | `(beautyNode, depthNode, velocityNode, camera)` |
| `temporalReproject` | `TemporalReprojectNode.js` | `(beautyNode, depthNode, normalNode, velocityNode, camera, options)` |
| `denoise` / `recurrentDenoise` | `DenoiseNode.js` / `RecurrentDenoiseNode.js` | `denoise(node, depthNode, normalNode, camera)` / `recurrentDenoise(inputTexture, camera, options)` |
| `motionBlur` | `MotionBlur.js` | `motionBlur(node, velocity, numSamples)` |
| `chromaticAberration` | `ChromaticAberrationNode.js` | `chromaticAberration(node, strength = 1.0, center = null, scale = 1.1)` |
| `rgbShift` | `RGBShiftNode.js` | `rgbShift(node, amount, angle)` |
| `film` | `FilmNode.js` | `film(node, intensity, uv)` |
| `afterImage` | `AfterImageNode.js` | `afterImage(node, damp)` |
| `dotScreen` | `DotScreenNode.js` | `dotScreen(node, angle, scale)` |
| `sobel` | `SobelOperatorNode.js` | `sobel(node)` |
| `lensflare` | `LensflareNode.js` | `lensflare(node, params)` |
| `lut3D` | `Lut3DNode.js` | `lut3D(node, texture3D(lut), size, intensity)`: all four required |
| `transition` | `TransitionNode.js` | `transition(nodeA, nodeB, mixTextureNode, mixRatio, threshold, useTexture)` |
| `outline` | `OutlineNode.js` | `outline(scene, camera, params)` |
| `sepia`, `bleach` | `Sepia.js`, `BleachBypass.js` | `sepia(color)`, `bleach(color, opacity)` |
| `pixelationPass` | `PixelationPassNode.js` | `pixelationPass(scene, camera, pixelSize, normalEdgeStrength, depthEdgeStrength)`: replaces `pass()` |
| `retroPass`, `oitPass`, `ssaaPass` | `RetroPassNode.js`, `OITPassNode.js`, `SSAAPassNode.js` | `(scene, camera, options)`: each replaces `pass()` |
| helpers | `boxBlur.js`, `hashBlur.js`, `radialBlur.js`, `depthAwareBlend.js`, `depthAwareBlur.js`, `lensDirt.js`, `CRT.js` | read the file for the signature |

There is **no `AnamorphicNode.js` in r187**: streaks are made with BloomNode's `highPassFn` and
`bloomTintColors`. `texture3D`, `texture3DLoad` and `texture3DLevel` are all exported from
`three/tsl`.

**Hidden passes.** Most of these wrap their input in `convertToTexture()`: a texture node or a
pass is used as it is, but an EXPRESSION is first drawn into a full-resolution HalfFloat target.
Feeding `fxaa(expression)` therefore costs one more full-screen pass than `fxaa(texture)`.

## Bloom

```javascript
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const bloomNode = bloom(sceneColor, 0.6, 0.6, 1.0);   // strength, radius, threshold (numbers or nodes)
bloomNode.threshold.value = 1.0;   // uniform nodes: set .value, never replace the property
bloomNode.strength.value = 0.6;
bloomNode.radius.value = 0.6;      // 0..1: shifts weight from the tight mips to the wide ones (not pixels)
bloomNode.setResolutionScale(0.5); // per tier; takes effect next frame, no rebuild
```

- Cost: 12 full-screen draws a frame into HalfFloat targets (high-pass, five mips blurred both
  ways, composite), at half resolution by default. Its resolution scale is the first thing a
  lean tier lowers (Winter 0.25–0.5; Wolfhour `setResolutionScale(0.5 * bloomDownsample)`).
- `highPassFn` replaces the high-pass (the house's hue-preserving one keeps a saturated light's
  colour); `smoothWidth` softens the knee; `bloomTintColors` tints the five mips.
- The threshold is applied BEFORE your exposure: tie the knee to the iris
  (`threshold.value = knee / exposure`, gotcha #134).
- Dispose with `disposeBloomNodeDeep(bloomNode)` (`src/themes/shared/bloom-dispose.js`).
  `BloomNode.dispose()` frees its own materials, but the node draws through a module-level shared
  `QuadMesh` that keeps the last material parked on it.
- One NaN texel in the input becomes a black frame (gotcha #94).

## FXAA and MSAA

FXAA expects display-space colour, so it runs LAST, after the tone curve and the sRGB encode,
and the pipeline's own transform is off:

```javascript
pipeline.outputColorTransform = false;
const graded = renderOutput(vec4(toned, 1.0), THREE.NoToneMapping);
pipeline.outputNode = samples > 0 ? graded : fxaa(graded);   // src/themes/fall/fall-post.js
```

A multisampled scene pass needs no FXAA; a single-sampled tier keeps it. Cut-outs made with
`discard` stay whole-pixel even under MSAA unless they use `alphaToCoverage` (gotcha #211, #224).

## Depth of field

```javascript
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

const viewZNode = scenePass.getViewZNode();
pipeline.outputNode = dof(sceneColor, viewZNode, 5.0, 25.0, 1.0);   // focusDistance, focalLength, bokehScale
```

## Ambient occlusion (GTAO)

```javascript
import { ao } from 'three/addons/tsl/display/GTAONode.js';

const depthNode = scenePass.getTextureNode('depth');
const normalNode = scenePass.getTextureNode('normal');   // an MRT attachment; or null: normals from depth
const aoValue = ao(depthNode, normalNode, camera).getTextureNode().r;
pipeline.outputNode = vec4(sceneColor.rgb.mul(aoValue), sceneColor.a);   // never scale alpha
```

Themes here are self-shaded and bake their own occlusion; no shipped theme runs GTAO.

## Colour adjustments (from `three/tsl`)

```javascript
import { grayscale, saturation, hue, vibrance, posterize } from 'three/tsl';

vec4(vec3(grayscale(sceneColor.rgb)), sceneColor.a);   // grayscale() returns a FLOAT
saturation(sceneColor.rgb, 1.5);                       // vec3; 0 grey, 1 unchanged
hue(sceneColor.rgb, time.mul(0.5));                    // vec3; radians
vibrance(sceneColor.rgb, 0.5);                         // vec3
posterize(sceneColor, 8);                              // keeps the vec4
```

A polynomial curve in display space (`T·T·(3 − 2T)`) folds values above 1 back down: clamp first
(gotcha #122). A colour turned between two hues goes through grey or lime in RGB (gotcha #221).

## 3D LUT

```javascript
import { texture3D } from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';

const lutTexture = new THREE.Data3DTexture(lutData, size, size, size);
pipeline.outputNode = lut3D(sceneColor, texture3D(lutTexture), size, 1.0);   // a NODE, and intensity is required
```

No shipped theme grades through a LUT, so there is no live example. 3D textures also fail on
some WebGL2 devices (`docs/theme-concepts/PLAYBOOK.md` §5.7): prefer a 2D table.

## Custom effects

Build them as `Fn()` graphs over the scene pass, pinning what is read more than once:

```javascript
import { Fn, float, screenUV, vec4 } from 'three/tsl';

const vignetted = Fn(() => {
  const color = sceneColor.rgb.toVar();
  const edge = screenUV.sub(0.5).length();
  color.mulAssign(float(1.0).sub(edge.mul(1.5)).clamp(0.0, 1.0));
  return vec4(color, 1.0);
})();
```

To read the scene at an offset (a fringe, a distortion), sample the pass texture with a UV:

```javascript
const r = sceneColor.sample(screenUV.add(vec2(0.002, 0))).r;
const b = sceneColor.sample(screenUV.sub(vec2(0.002, 0))).b;
```

A fringe taken from the sharp scene over a blurred one blotches (gotcha #260); a shimmer that
follows bloom wobbles thin lines (gotcha #217).

## Reduced-resolution work: `rtt()`

`rtt(node, width = null, height = null, { resolutionScale = 1, autoUpdate = true, type })` draws a
node into its own target; `setResolutionScale()` changes it later. It is how a march or a shaft
gather runs at a fraction of the frame
(`rtt(gather, null, null, { resolutionScale: RAYS.scale })` in `src/themes/forest/forest-post.js`).
`autoUpdate: false` redraws only when `textureNeedsUpdate = true`. An `rtt()` handed to an addon
that ping-pongs its input cannot be swapped (gotcha #86).

## Multiple render targets (MRT)

```javascript
import { emissive, mrt, normalView, output } from 'three/tsl';

scenePass.setMRT(mrt({ output, normal: normalView, emissive }));
const emissiveTexture = scenePass.getTextureNode('emissive');
```

- **Most themes do not use MRT** (`usesMrtScenePass()` returns false): bloom runs on the
  composite, and "emissive-only bloom" does nothing there (gotcha #75). Check before designing
  an effect round it.
- **Secondary attachments default to `NoBlending`** (since r185): an additive material keeps
  blending on the colour attachment but overwrites the emissive one. Wrap the MRT with
  `withEmissiveMaterialBlending(mrt({ output, emissive }))` from `src/themes/shared/mrt-blend.js`
  (gotcha #76).
- A `MeshBasicNodeMaterial` with only a `colorNode` writes nothing useful to `emissive`; an
  `emissiveNode` does, and is ALSO added to the colour (gotcha #119). `material.mrtNode =
  mrt({ emissive: glow })` overrides one attachment for one material.
- A material that sets `fragmentNode` skips the MRT branch altogether.

Selective bloom is then `bloom(emissiveTexture)` with a threshold of 0, added to the colour's `.rgb`.

## Conditional / toggleable effects

Multiplying by a zero uniform does not remove the work. Gate in JavaScript: do not build the
node on tiers that lack it, or build two output graphs and set `pipeline.needsUpdate = true` when
you swap (gotcha #72).

## Warm-up

`renderer.compileAsync(scene, camera)` compiles for the target bound when it is called, not for a
pass's own target (HalfFloat, its samples, its MRT). `await scenePass.compileAsync(renderer)`
compiles the pass's scene with the pass's target; the output quad and bloom's own materials still
need one real `pipeline.render()` behind the loading overlay. An ordinary theme does none of
this by hand: the theme manager's pipeline session covers it (ADR-0020, `docs/three-r187.md`).

## Scene transitions

```javascript
import { transition } from 'three/addons/tsl/display/TransitionNode.js';

pipeline.outputNode = transition(
  pass(sceneA, camera).getTextureNode('output'),
  pass(sceneB, camera).getTextureNode('output'),
  texture(transitionTexture),   // the mix texture is the THIRD argument
  mixRatio,                     // a uniform, 0..1
  0.3,                          // threshold
  1,                            // useTexture
);
```
