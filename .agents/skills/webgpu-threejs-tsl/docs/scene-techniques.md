# Scene Techniques (three r187, repo-proven)

High-impact building blocks for this game's themes. Each section names the working
repo reference to copy from — prefer that over inventing a variant. The traps for each
are in `gotchas/` (`look-water.md` for mirrors, `textures-noise-targets.md` for feedback
targets, `post-color.md` for grading).

## Planar reflections — `reflector()`

Real mirror reflections for lakes/wet ground. It renders the scene a second time from
the mirrored camera, so reduce `resolutionScale`, turn `bounces` off, and mirror only what
stands in the scene. The sky is never worth a second render: a sky that is a cheap function
of a direction is called again along the mirrored ray (gotcha #137), and an expensive one
(a march) is painted once into a reduced target that the water looks its mirrored ray up in
(gotcha #128). `gotchas/look-water.md` opens with the chooser.

```javascript
import { mix, reflector, screenUV } from 'three/tsl';

// Defaults are resolutionScale 1, bounces TRUE (re-rendered on every render call that draws
// the surface), samples 0. The repo always passes bounces: false (once a frame), a tier-scaled
// resolution (0.25–0.85) and the scene pass's own sample count (two counts = two pipelines
// per material).
const reflection = reflector({ resolutionScale: 0.5, bounces: false, generateMipmaps: false, samples });
reflection.target.rotateX(-Math.PI / 2);                  // mirror plane
scene.add(reflection.target);

// Ripples: sample at a perturbed UV. The reflector's default UV is
// screenUV.flipX() — keep the flip or the reflection mirrors horizontally.
// Clamp the offset: a summed slope that is too large tears the image (gotcha #141).
const reflUV = screenUV.flipX().add(rippleNoise.mul(0.02));
const reflColor = reflection.sample(reflUV).rgb;
groundMaterial.colorNode = mix(baseColor, reflColor, fresnelFactor);   // NOT baseColor.mix(…): see below
```

**`a.mix(b, t)` is not `mix(a, b, t)`.** The chained form makes the RECEIVER the blend factor
(`t.mix(a, b)`), so `baseColor.mix(reflColor, fresnel)` uses the base colour as the weight.
Use the function form.

Working references: `src/themes/vesper-chrysalis/vesper-chrysalis-lake.js`
(ripple-perturbed via `.sample()`, the pattern above); `src/themes/halcyon-apex/halcyon-apex-water.js`
reads it with an explicit mip level that falls with distance (`.level(reach.mul(1.4))`, which
needs `generateMipmaps: true`); `src/themes/summer/summer-lake.js` bends the lookup by its wave
normal and restricts the mirror by camera layer
(`reflection.reflector.getVirtualCamera(camera).layers`).
Note: the parameter is `resolutionScale` — `resolution` was renamed in r180.

## Soft particles (depth fade)

Hard quad-vs-geometry intersections are the #1 tell of cheap particles (snow
hitting the ground, mist against mountains). Fade fragments as they approach the
depth buffer:

```javascript
import { cameraFar, cameraNear, linearDepth, smoothstep, viewportLinearDepth } from 'three/tsl';

// Both depths run 0..1 across near..far: scale the gap to world units before fading.
const gap = viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear));
const fade = smoothstep(0.0, softness, gap);     // softness in world units (crystal-cave-air.js uses 4)

particleMaterial.opacityNode = baseAlpha.mul(fade);
particleMaterial.depthWrite = false;             // particles must not self-occlude
```

Working reference: `src/themes/crystal-cave/crystal-cave-air.js`. Conversion helpers exist for
custom math: `viewZToPerspectiveDepth`, `perspectiveDepthToViewZ`, `viewZToOrthographicDepth`.
The particles must draw after the opaque geometry (the default for transparent materials).
`viewportDepthTexture()` is ONE shared texture: read under targets of different sample counts
(a 4× scene pass and a single-sampled mirror) it does not match.

## GPU feedback textures

**The house way needs no compute**: draw into a `RenderTarget` that is never cleared, with a
blend that composites in place, and repoint one `texture()` node when you swap targets
(gotcha #114; `src/themes/chromatic-impasto/chromatic-impasto-canvas.js`). It runs on both
backends. A render-pass fluid is the same idea with a solver
(`src/themes/aether-tides/aether-tides-fluid.js`, gotcha #106, #107, #236).

The compute form below (`StorageTexture` + `textureStore`) is WebGPU-only, so a theme that uses
it needs a CPU or render-pass twin for the WebGL2 backend. No theme ships it yet: the sample
builds to WGSL but has no reference in `src/`.

```javascript
import { Fn, textureStore, texture, instanceIndex, uniform, uvec2, vec4 } from 'three/tsl';

// PING-PONG is mandatory: WebGPU forbids reading and writing the same texture
// in one dispatch (writable + sampled usage in the same scope fails validation),
// and rgba16float has no read_write storage access. Read A, write B, swap.
const texA = new THREE.StorageTexture(512, 512);   // from 'three/webgpu'
const texB = new THREE.StorageTexture(512, 512);
texA.type = THREE.HalfFloatType;
texB.type = THREE.HalfFloatType;

// Build BOTH passes once (never per frame — see docs/performance.md)
// A decay per FRAME changes with the frame rate (0.985 is a 0.76 s half-life at 60 fps and a
// quarter of that at 240): derive it from dt.  Each frame: uDecay.value = Math.exp(-dt / tau)
const uDecay = uniform(1);
const makeTrailPass = (src, dst) => Fn(() => {
  const coord = uvec2(instanceIndex.mod(512), instanceIndex.div(512));
  const prev = texture(src).load(coord);               // previous frame
  const decayed = prev.mul(uDecay);
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

A theme's playground effect constructs the theme's own post class, so the playground already
shows the shipped grade (60 effects do this: `src/playground/effects/winter.effect.js` imports
`winter-post.js`). Judge colour there, through the finished chain, never from the raw scene.

Use the snippet below only for an effect that has no post class yet: the playground's renderer
is flat (`NoToneMapping`), so colours tuned on the raw scene shift once a chain grades them.

```javascript
import { renderOutput, toneMapping, color } from 'three/tsl';

// e.g. ACES at exposure 0.82 with a cold tint
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
`NoToneMapping` (`src/playground/main.js`). Nearly every theme turns the pipeline's transform
off and tones in its own output node; renderer-level ACES is left only in the forest family
and Wolfhour. ACES at exposure 1 is already +0.74 stop (gotcha #112).

## IBL & fake lighting for unlit scenes

The themes are deliberately `MeshBasicNodeMaterial` (unlit) — real lights do
nothing. Three patterns give "lit" depth without converting materials:

```javascript
import { float, pmremTexture, normalWorld, matcapUV, mix, texture } from 'three/tsl';

// 1. PMREM environment as a color source (works on unlit materials).
//    (texture, direction, roughness 0..1): the roughness is REQUIRED outside a lit material,
//    or the build throws. Warm the PMREM pipelines first: src/themes/shared/pmrem-warm.js
const env = pmremTexture(envTexture, normalWorld, float(1.0));
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

- `viewportSharedTexture()` is ONE texture for every use and every render target, with no
  mipmaps; for a blurred read use `viewportMipTexture()`. Inside a `pass()` it holds linear HDR
  at the pass's resolution.
- A `reflector()` that draws a material reading it resizes that one texture and destroys the
  copy the main pass still holds (`Destroyed texture … used in a submit`, gotcha #240). Give
  such a material its own `viewportTexture()` (three keeps one copy per render target), made
  ONCE and read with `.sample(uv)`.
- References: `src/themes/crystal-cave/crystal-cave-water.js`, `src/themes/koi-pond/koi-pond-water.js`.

## Fog with height + depth

`fog(color, factor)` composes any factor node; combine range fog with a height
band for the "aerial perspective" look:

```javascript
import { fog, rangeFogFactor, positionWorld, smoothstep } from 'three/tsl';

const distFactor = rangeFogFactor(30, 300);
const heightFactor = smoothstep(0, 40, positionWorld.y).oneMinus();   // thicker low down
scene.fogNode = fog(fogColor, distFactor.mul(heightFactor).clamp());
```

Most themes do not use scene fog at all: each part mixes toward the sky's own horizon colour
in its material, so far ground and sky agree (gotcha #238). Where a scene does carry fog
(the Odyssey board sets one), **an additive material must set `fog = false`**: three's fog is
`mix(rgb, fogColour, f)` with the alpha kept, so an additive quad adds `fogColour · f` over its
whole area and shows as a lit square. Dim it by the fog yourself instead
(`oneMinus(densityFogFactor(density))`, as `src/rendering/odyssey/level-node-manager.tsl.js` does).
