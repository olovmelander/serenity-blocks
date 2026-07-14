# Built-in Noise & Utility Nodes (three r181)

Three ships a full noise library and a set of UV/instancing/blend utilities as TSL
nodes. **Reach for these before hand-rolling `fract(sin(dot(...)))` hashes** — they
are battle-tested, WGSL-optimized, and free to import. Everything below is verified
exported in the installed r181 (`node_modules/three/src/Three.TSL.js`).

## Noise nodes

All MaterialX noise accepts **vec2 or vec3** coordinates. The perlin/worley/cell
variants have true 2D overloads; the `mx_fractal_noise_*` variants are vec3-only —
a vec2 is zero-padded to `vec3(x, y, 0)` and still runs the 3D noise.

| Node | Signature | Character |
|---|---|---|
| `mx_noise_float` | `(texcoord = uv(), amplitude = 1, pivot = 0)` | Perlin, smooth, ~[-1,1]·amplitude + pivot |
| `mx_noise_vec3` | same | 3-channel Perlin (cheap color variation) |
| `mx_fractal_noise_float` | `(position, octaves = 3, lacunarity = 2, diminish = 0.5, amplitude = 1)` | FBM — clouds, terrain, water |
| `mx_fractal_noise_vec2/vec3/vec4` | same | multi-channel FBM |
| `mx_worley_noise_float` | `(texcoord = uv(), jitter = 1)` | cellular — caustics, scales, cracked ice |
| `mx_worley_noise_vec2/vec3` | same | F1/F2-style channels |
| `mx_cell_noise_float` | `(texcoord = uv())` | blocky per-cell random |
| `triNoise3D` | `(position, speed, time)` | cheap animated 3D noise — fog, embers |
| `hash` | `(seed)` | per-instance/per-fragment random, 0..1 |

```javascript
import { mx_fractal_noise_float, mx_worley_noise_float, triNoise3D, positionWorld, time, uv } from 'three/tsl';

// FBM terrain/water — no hand-rolled octave loop needed
const height = mx_fractal_noise_float(positionWorld.xz.mul(0.15), 4, 2.0, 0.5, 1.0);

// Animated volumetric-ish fog density
const fogNoise = triNoise3D(positionWorld.mul(0.02), 0.2, time);

// Worley caustics on a lake bed
const caustic = mx_worley_noise_float(uv().mul(20), 1.0).oneMinus().pow(3);
```

**Domain warping** (the "fluidity" upgrade from the Vesper V4 plan) is two nested
noise calls — warp the coordinate with one noise before feeding the next:

```javascript
const warp = mx_noise_vec3(positionWorld.mul(0.1), 0.35);
const warped = mx_fractal_noise_float(positionWorld.add(warp).mul(0.2), 4);
```

**Not built in:** curl noise. Keep the repo's hand-rolled implementations; don't
import a `curlNoise` that doesn't exist.

## Per-instance variation (desync)

Uniform phase makes instanced animation read as fake. Three ways to desync,
cheapest first:

```javascript
import { hash, instanceIndex, range, TWO_PI } from 'three/tsl';

// 1. Hash of the instance index — free, deterministic
const phase = hash(instanceIndex).mul(TWO_PI);

// 2. range(min, max) — per-instance random baked once at first compile
//    (InstancedMesh only; min/max must be constants)
const sway = range(0.5, 1.5);

// 3. Authored per-instance attributes — full control (aPhase pattern)
import { instancedBufferAttribute } from 'three/tsl';
const phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
material.someNode = instancedBufferAttribute(phaseAttr);
// instancedDynamicBufferAttribute(...) — same, for per-frame CPU updates
```

Reminder from the gotcha table: inside instanced materials, local-space masks must
use `positionGeometry` — `positionLocal` is already instance-transformed in r181.

## Billboarding

The snow renderer hand-rolls camera-facing quads in `vertexNode`
(`src/themes/winter/rendering/snow-renderer.js`) because it also does tumble and
velocity stretch. For plain billboards, the built-in is one call:

```javascript
import { billboarding } from 'three/tsl';

material.vertexNode = billboarding();                        // Y-axis cylindrical — stays world-upright (trees/grass)
material.vertexNode = billboarding({ vertical: true });      // full camera-facing (spherical)
material.vertexNode = billboarding({ position: myCenter });  // custom pivot
```

Signature: `billboarding({ position = null, horizontal = true, vertical = false })`.

## UV utilities

| Node | Use |
|---|---|
| `rotateUV(uv, rotation, center?)` | spin textures (portals, vortices) |
| `spherizeUV(uv, strength, center?)` | fisheye/bulge distortion |
| `matcapUV` | matcap lookup UV from view/normal — fake studio lighting on unlit scenes |
| `equirectUV(direction)` | sample equirect env textures by direction |
| `rotate(vec2, angle)` | rotate any vec2 (not just UVs) |

## Blend & color utilities

Photoshop-style blends — the current names are `blend*`-prefixed; the bare names
(`burn`, `dodge`, `screen`, `overlay`) are **deprecated r171 aliases**, don't use them:

```javascript
import { blendOverlay, blendScreen, blendBurn, blendDodge } from 'three/tsl';

const graded = blendOverlay(baseColor, gradeColor);   // all take (base, blend), vec3 in/out
```

`blendColor(base, blend)` is NOT one of these: it's vec4 `NormalBlending` alpha
compositing (non-premultiplied) — feeding it two vec3 colors gives alpha-driven
compositing on a padded w, not a color blend.

HSV round-trip for hue-shifts without a LUT:

```javascript
import { mx_hsvtorgb, mx_rgbtohsv, vec3 } from 'three/tsl';

const hsv = mx_rgbtohsv(color);
const shifted = mx_hsvtorgb(vec3(hsv.x.add(hueShift), hsv.y.mul(satBoost), hsv.z));
```

Also handy: `pcurve(x, a, b)` (parabolic shaping curve), `remap` / `remapClamp`,
`oneMinus()`, `saturate()`.
