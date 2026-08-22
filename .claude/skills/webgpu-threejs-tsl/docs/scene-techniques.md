# Scene Techniques (three r185, repo-proven)

High-impact building blocks for this game's themes. Each section names the working
repo reference to copy from — prefer that over inventing a variant.

## Planar reflections — `reflector()`

Real mirror reflections for lakes/wet ground. Renders the scene a second time from
the mirrored camera, so **always** reduce `resolutionScale`.

```javascript
import { reflector, screenUV } from 'three/tsl';

const reflection = reflector({ resolutionScale: 0.5 });   // repo uses 0.4–0.5
reflection.target.rotateX(-Math.PI / 2);                  // mirror plane
scene.add(reflection.target);

// Ripples: sample at a perturbed UV. The reflector's default UV is
// screenUV.flipX() — keep the flip or the reflection mirrors horizontally.
const reflUV = screenUV.flipX().add(rippleNoise.mul(0.02));
const reflColor = reflection.sample(reflUV).rgb;
groundMaterial.colorNode = baseColor.mix(reflColor, fresnelFactor);
```

Working references: `src/playground/effects/vesper-lake.effect.js:82-96`
(ripple-perturbed via `.sample()`, the pattern above); `halcyon-apex.effect.js:875`
and `summer-meadow.effect.js:364` use the reflection unperturbed.
Note: the parameter is `resolutionScale` — `resolution` was renamed in r180.

## Soft particles (depth fade)

Hard quad-vs-geometry intersections are the #1 tell of cheap particles (snow
hitting the ground, mist against mountains). Fade fragments as they approach the
depth buffer:

```javascript
import { linearDepth, viewportLinearDepth, smoothstep } from 'three/tsl';

// scene depth already written at this fragment vs this particle fragment's depth
const sceneDepth = viewportLinearDepth;          // linearized current depth buffer
const fragDepth = linearDepth();                 // this fragment
const fade = smoothstep(0.0, softness, sceneDepth.sub(fragDepth));

particleMaterial.opacityNode = baseAlpha.mul(fade);
particleMaterial.depthWrite = false;             // particles must not self-occlude
```

Conversion helpers exist for custom math: `viewZToPerspectiveDepth`,
`perspectiveDepthToViewZ`, `viewZToOrthographicDepth`, etc. Requires the particles
to render after opaque geometry (default for transparent materials).

## GPU feedback textures — `StorageTexture` + `textureStore`

Persistent, decaying surface state fully on the GPU: trails, ripples, heat, wetness.
(The paw-trail system currently stamps a CPU `DataTexture` — this is the GPU
upgrade path.)

```javascript
import { Fn, textureStore, texture, instanceIndex, uvec2, vec4 } from 'three/tsl';

// PING-PONG is mandatory: WebGPU forbids reading and writing the same texture
// in one dispatch (writable + sampled usage in the same scope fails validation),
// and rgba16float has no read_write storage access. Read A, write B, swap.
const texA = new THREE.StorageTexture(512, 512);   // from 'three/webgpu'
const texB = new THREE.StorageTexture(512, 512);
texA.type = THREE.HalfFloatType;
texB.type = THREE.HalfFloatType;

// Build BOTH passes once (never per frame — see docs/performance.md §6)
const makeTrailPass = (src, dst) => Fn(() => {
  const coord = uvec2(instanceIndex.mod(512), instanceIndex.div(512));
  const prev = texture(src).load(coord);               // previous frame
  const decayed = prev.mul(0.985);                     // ~7s decay
  textureStore(dst, coord, vec4(decayed.add(stampContribution(coord))));
})().compute(512 * 512);
const passAB = makeTrailPass(texA, texB);
const passBA = makeTrailPass(texB, texA);

// The material samples through ONE texture node whose .value we repoint
const trailSample = texture(texA);
groundMaterial.colorNode = baseSnow.mul(trailSample.sample(groundUV).r.oneMinus());

// Each frame, inside the gated loop:
let readIsA = true;
function updateTrails() {
  renderer.compute(readIsA ? passAB : passBA);
  readIsA = !readIsA;
  trailSample.value = readIsA ? texA : texB;           // sample the fresh side
}
```

Signature: `textureStore(storageTexture, coordNode, valueNode)`.

## Previewing the in-game grade in the playground

Documented workflow pain: the playground renders flat (`NoToneMapping`) while
themes grade through ACES + exposure + tint, so colors tuned in the playground
shift in-game. Emulate the grade **inside the playground effect** instead of
overshooting by feel:

```javascript
import { renderOutput, toneMapping, color } from 'three/tsl';

// Recreate e.g. WinterPipeline: ACES @ exposure 0.82 + cold tint
postProcessing.outputColorTransform = false;   // REQUIRED — see note below
const graded = toneMapping(THREE.ACESFilmicToneMapping, 0.82, sceneColor)
  .mul(color(0.92, 0.97, 1.06));
postProcessing.outputNode = renderOutput(graded, THREE.NoToneMapping);
// With outputColorTransform=false this renderOutput IS the final transform:
// NoToneMapping skips re-mapping, and the working→sRGB conversion still runs once.
```

**Why `outputColorTransform = false`:** left at its default (`true`),
`RenderPipeline` wraps your `outputNode` in a *second* `renderOutput` using the
**renderer's** toneMapping — under an ACES renderer your hand-applied grade gets
tone-mapped twice, and your inner `NoToneMapping` does nothing. It only looks
right in the playground because the playground renderer happens to be
`NoToneMapping` (`src/playground/main.js`).

Now playground screenshots match the in-game look, and color values port 1:1.

## IBL & fake lighting for unlit scenes

The themes are deliberately `MeshBasicNodeMaterial` (unlit) — real lights do
nothing. Three patterns give "lit" depth without converting materials:

```javascript
import { pmremTexture, normalWorld, matcapUV, mix, texture } from 'three/tsl';

// 1. PMREM environment as a color source (works on unlit materials)
const env = pmremTexture(envTexture, normalWorld);        // (texture, dir?, rough?)
material.colorNode = baseColor.mul(env.mul(iblStrength).add(ambientFloor));

// 2. Hemisphere gradient — 2-line fake GI (sky color from above, bounce from below)
const hemi = mix(bounceColor, skyColor, normalWorld.y.mul(0.5).add(0.5));
material.colorNode = baseColor.mul(hemi);

// 3. Matcap — baked studio lighting via view-space normal lookup
material.colorNode = baseColor.mul(texture(matcapTex, matcapUV));
```

Pattern 2 is the cheap answer to the V4 "colored-bounce lighting" gap: sample the
dominant ground/feature color as `bounceColor` so large emissive features visibly
tint nearby geometry from below.

## Glass / refraction behind the board — `viewportSharedTexture`

Reads what's already rendered under the current fragment — refraction without a
second scene render:

```javascript
import { viewportSharedTexture, screenUV, normalView } from 'three/tsl';

const distorted = screenUV.add(normalView.xy.mul(refractStrength));
glassMaterial.colorNode = viewportSharedTexture(distorted).rgb.mul(glassTint);
glassMaterial.transparent = true;
```

Requires the glass object to render after what it distorts (transparent pass
order). Cheaper than `transmission` for flat panels like the board backdrop.

## Fog with height + depth

`fog(color, factor)` composes any factor node; combine range fog with a height
band for the "aerial perspective" look:

```javascript
import { fog, rangeFogFactor, positionWorld, smoothstep } from 'three/tsl';

const distFactor = rangeFogFactor(30, 300);
const heightFactor = smoothstep(0, 40, positionWorld.y).oneMinus();   // thicker low down (never reverse smoothstep edges — see gotcha table)
scene.fogNode = fog(fogColor, distFactor.mul(heightFactor).clamp());
```

Animate `fogColor`/band edges with `triNoise3D` for drifting haze
(see `docs/noise-and-utility-nodes.md`).
