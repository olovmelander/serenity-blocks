# TSL Post-Processing (three r181)

Post-processing applies effects to the rendered image via a node graph.

> **r181 API:** the class is `THREE.PostProcessing`. `THREE.RenderPipeline` is an
> r183 rename that does NOT exist in this repo's three — using it throws
> `RenderPipeline is not a constructor`. This repo has 15+ working `-post.js`
> pipelines (e.g. `src/themes/wolfhour/wolfhour-post.js`,
> `src/themes/fluid-dreams/fluid-dreams-post.js`) — copy those, not web samples.

## Basic Setup

```javascript
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

const renderer = new THREE.WebGPURenderer();
await renderer.init();

const postProcessing = new THREE.PostProcessing(renderer);

const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode('output');

postProcessing.outputNode = scenePassColor;   // passthrough

function animate() {
  postProcessing.render();   // NOT renderer.render()
}
```

## Built-in Effects (import paths verified against r181)

All display effects live under `three/addons/tsl/display/`. r181 filenames are
inconsistent (`BloomNode.js` vs `Sepia.js` vs `boxBlur.js`) — the table is the
source of truth:

| Effect | Import | Signature |
|---|---|---|
| `bloom` | `BloomNode.js` | `bloom(node, strength?, radius?, threshold?)` |
| `gaussianBlur` | `GaussianBlurNode.js` | `gaussianBlur(node, directionNode, sigma)` |
| `fxaa` | `FXAANode.js` | `fxaa(node)` |
| `smaa` | `SMAANode.js` | `smaa(node)` |
| `traa` | `TRAANode.js` | `traa(node, depth, velocity, camera)` |
| `dof` | `DepthOfFieldNode.js` | `dof(node, viewZNode, focusDistance, focalLength, bokehScale)` |
| `motionBlur` | `MotionBlur.js` | `motionBlur(node, velocity, numSamples?)` |
| `ssr` | `SSRNode.js` | `ssr(colorNode, depthNode, normalNode, metalnessNode, roughnessNode?, camera?)` |
| `ao` (GTAO) | `GTAONode.js` | `ao(depthNode, normalNode, camera)` |
| `ssgi` | `SSGINode.js` | `ssgi(...)` — heavy; not used in this repo |
| `film` | `FilmNode.js` | `film(node, intensity?, uv?)` |
| `outline` | `OutlineNode.js` | `outline(scene, camera, { selectedObjects, edgeThickness, edgeGlow, downSampleRatio })` |
| `chromaticAberration` | `ChromaticAberrationNode.js` | `chromaticAberration(node, strength?, center?, scale?)` |
| `sepia` | `Sepia.js` | `sepia(color)` |
| `lut3D` | `Lut3DNode.js` | `lut3D(node, lutTexture, size, intensity?)` |
| `transition` | `TransitionNode.js` | `transition(nodeA, nodeB, mixTexture, mixRatio, threshold, useTexture)` |
| `anamorphic` | `AnamorphicNode.js` | `anamorphic(node, threshold?, scale?, samples?)` |
| `lensflare` | `LensflareNode.js` | `lensflare(node, params?)` |
| `denoise` | `DenoiseNode.js` | `denoise(node, depth, normal, camera)` |
| `boxBlur` | `boxBlur.js` | mobile-friendly blur |
| `hashBlur` | `hashBlur.js` | single-pass blur |
| `dotScreen` | `DotScreenNode.js` | halftone |
| `rgbShift` | `RGBShiftNode.js` | RGB split |
| `afterImage` | `AfterImageNode.js` | trails |
| `bleach` | `BleachBypass.js` | bleach bypass grade |
| `sobel` | `SobelOperatorNode.js` | edge detect |
| `pixelationPass` | `PixelationPassNode.js` | pixelate (replaces `pass()`) |

**Not in r181** (don't import — the files don't exist): `godrays`, `retroPass`,
`bilateralBlur`, and the `texture3DLoad`/`texture3DLevel` TSL exports. They arrive
in r182/r183.

### Bloom (the repo's most-used effect)

```javascript
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const bloomPass = bloom(scenePassColor);
bloomPass.threshold.value = 0.5;   // brightness threshold
bloomPass.strength.value = 1.0;    // intensity
bloomPass.radius.value = 0.5;      // blur radius

postProcessing.outputNode = scenePassColor.add(bloomPass);
```

`threshold`/`strength`/`radius` are uniform nodes — set `.value` at runtime; don't
replace the properties with new `uniform()` objects.

### Depth of Field

```javascript
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

const scenePass = pass(scene, camera);
const colorNode = scenePass.getTextureNode('output');
const viewZNode = scenePass.getViewZNode();

postProcessing.outputNode = dof(colorNode, viewZNode, 5.0, 25.0, 1.0);
```

> The DOF API was reimplemented in r181 — the old
> `dof(color, depth, { focus, aperture, maxblur })` options-object form no longer works.

### Ambient Occlusion (GTAO)

```javascript
import { ao } from 'three/addons/tsl/display/GTAONode.js';

const depthNode = scenePass.getTextureNode('depth');
const normalNode = scenePass.getTextureNode('normal');   // requires MRT (below)

const aoPass = ao(depthNode, normalNode, camera);
postProcessing.outputNode = scenePassColor.mul(aoPass);
```

## Color Adjustments (from `three/tsl`, no addon import)

```javascript
import { grayscale, saturation, hue, vibrance, posterize } from 'three/tsl';

postProcessing.outputNode = grayscale(scenePassColor);
postProcessing.outputNode = saturation(scenePassColor, 1.5);   // 0 gray, 1 normal, 2 over
postProcessing.outputNode = hue(scenePassColor, time.mul(0.5)); // radians
postProcessing.outputNode = vibrance(scenePassColor, 0.5);
postProcessing.outputNode = posterize(scenePassColor, 8);
```

### 3D LUT (repo pattern: Vesper Chrysalis grade)

```javascript
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';

const lutTexture = new THREE.Data3DTexture(lutData, size, size, size);
postProcessing.outputNode = lut3D(scenePassColor, lutTexture, size);
```

See `src/playground/effects/vesper-chrysalis.effect.js` for a live LUT grade.

## Custom Effects

Build them as `Fn()` graphs over the scene pass:

```javascript
import { Fn, screenUV, float } from 'three/tsl';

// Vignette
const vignetted = Fn(() => {
  const color = scenePassColor.toVar();
  const dist = screenUV.sub(0.5).length();
  color.rgb.mulAssign(float(1.0).sub(dist.mul(1.5)).clamp(0, 1));
  return color;
})();

postProcessing.outputNode = vignetted;
```

To sample the scene at *offset* UVs (CRT RGB-split, distortion), sample the pass
texture node with an explicit UV instead of reading `scenePassColor` directly:

```javascript
const sceneTex = scenePass.getTextureNode('output');
const r = sceneTex.sample(screenUV.add(vec2(0.002, 0))).r;
const b = sceneTex.sample(screenUV.sub(vec2(0.002, 0))).b;
```

## Multiple Render Targets (MRT)

```javascript
import { mrt, output, normalView, emissive } from 'three/tsl';

const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({
  output,                 // color
  normal: normalView,     // for AO/SSR
  emissive,               // for selective bloom
}));

const colorTexture = scenePass.getTextureNode('output');
const emissiveTexture = scenePass.getTextureNode('emissive');
```

### Selective Bloom with MRT

```javascript
const bloomPass = bloom(emissiveTexture);
bloomPass.threshold.value = 0.0;
postProcessing.outputNode = colorTexture.add(bloomPass);
```

Only emissive surfaces bloom; bright white non-emissive surfaces don't.

> **Repo reality check:** most themes here run **composite bloom without MRT**
> (`useMRT: false` in several theme pipelines) — selective emissive bloom silently
> does nothing on those. Confirm the theme's MRT setting before designing an
> emissive-driven effect around it.

## Chaining Effects

```javascript
let out = scenePassColor;
out = out.add(bloom(out).mul(0.5));
out = saturation(out, 1.2);
out = out.mul(vignetteFactor);
out = fxaa(out);
postProcessing.outputNode = out;
```

Order matters and each texture-sampling stage costs fill rate — this repo's perf
audits repeatedly found bloom downsample size and redundant taps to be the top
post-processing costs. Bloom is cheapest when applied before AA, at reduced
resolution.

## Conditional / Toggleable Effects

Multiplying by a 0-value uniform does NOT eliminate the work — the GPU still runs
the whole graph. Gate in JavaScript instead: build two output graphs (or rebuild
`outputNode`) and set `postProcessing.needsUpdate = true` when swapping.

## Scene Transitions

```javascript
import { transition } from 'three/addons/tsl/display/TransitionNode.js';

const mixRatio = uniform(0);
postProcessing.outputNode = transition(
  pass(sceneA, camera).getTextureNode('output'),
  pass(sceneB, camera).getTextureNode('output'),
  texture(transitionTexture),  // mix texture is the THIRD argument
  mixRatio,
  0.3,                         // threshold
  1                            // useTexture flag
);
```
