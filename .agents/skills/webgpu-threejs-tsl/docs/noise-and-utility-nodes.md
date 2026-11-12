# Noise and utility nodes (three r187)

Where a theme gets its noise, which of three's built-in nodes it may use, and the small
utilities (per-instance variation, billboards, UV and blend helpers). Read it before writing a
procedural surface. The traps of noise (mips, slopes, facets, hashing) are in
`gotchas/textures-noise-targets.md` and `gotchas/numerics.md`.

## Where a theme gets its noise

**Not from MaterialX.** `mx_noise_*`, `mx_fractal_noise_*` and `mx_worley_noise_*` hash their
lattice with integer arithmetic that the shader compiler inlines at every evaluation: 20
evaluations made ONE pipeline take 7.3 s to compile (gotcha #80). A rebuilt theme's test fails
on any `mx_` call in its source, the colour helpers (`mx_hsvtorgb`, `mx_rgbtohsv`) included.

Use one of these, cheapest first:

| Source | What it is | Precedent |
|---|---|---|
| A laid-out hash | sine-free `fract` hashes as pure laid-out `Fn`s, for dither, twinkle, per-cell choices | `swHash11`, `swHash21`, `swHash23` in `src/themes/serenity-warp/serenity-warp-tsl.js` |
| A baked 2D texture | fBm or value noise baked on the CPU at build (`bakeOnce`, `src/themes/shared/bake-cache.js`), tileable, with mips; read at an EXPLICIT `.level()` | `bakeFbm` in `src/themes/void-ember/void-ember-tsl.js` |
| The 2D lattice for 3D noise | a 256² RGBA8 lattice whose channels are shifted z-slices: one bilinear fetch is trilinear value noise for two fields (gotcha #136) | `bakeLattice` in `src/themes/void-ember/void-ember-tsl.js` |
| Value noise and simplex in TSL | laid-out, pure, calibrated to the MaterialX look they replaced | `noise2`, `noise3`, `simplex3` in `src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js` |

Themes are islands: copy a helper into your theme's `-tsl.js`, do not import another theme's.

What goes wrong with a baked texture, in one place:

- A tile packs several lattice periods: size a read by the feature you want, not by the tile (#183).
- Read at mip 0 with a large gain it is serrated; ask for a blurred level (#104). Without mips,
  fade fine detail out by its own footprint (#133).
- A steep curve on a magnified read draws the texel grid as facets (#268), and a normal from its
  differences shows blocks: bake the gradient with the height (#169, #246, #272).
- To make a pattern CHANGE rather than slide, move the whole surface through a 3D volume (#132).

## three's built-in noise nodes

All exported from `three/tsl` in r187. Fine in a playground sketch or a CPU-side experiment;
the MaterialX rows are banned in theme shaders for the reason above.

| Node | Signature | Notes |
|---|---|---|
| `hash` | `(seed)` | the seed is cast to **uint**: pass an exact, non-negative integer (`instanceIndex`, a floored cell id shifted positive). A vector uses `.x` only; a float in 0..1 hashes to one value; a negative float clamps to 0 (gotcha #204). Returns [0, 1) |
| `rand` | `(uv)` | vec2 → [0, 1), the classic sine hash |
| `interleavedGradientNoise` | `(position)` | per-pixel dither pattern; visible as grain without a temporal filter (gotcha #201) |
| `triNoise3D` | `(position, speed, time)` | cheap animated 3D noise |
| `mx_noise_float` / `_vec3` | `(texcoord = uv(), amplitude = 1, pivot = 0)` | Perlin. **Banned in themes** |
| `mx_fractal_noise_float` / `_vec2` / `_vec3` / `_vec4` | `(position, octaves = 3, lacunarity = 2, diminish = 0.5, amplitude = 1)` | 3D fBm (a vec2 is padded); the 2D one is `mx_fractal_noise_float_2d`. **Banned in themes** |
| `mx_worley_noise_float` | `(texcoord = uv(), jitter = 1, style = 0)` | always the 3D version; `mx_worley_noise_float_2d` is the 2D one. **Banned in themes** |
| `mx_cell_noise_float` | `(texcoord = uv())` | blocky per-cell random. **Banned in themes** |

Addons (not in `three/tsl`): `three/addons/tsl/math/curlNoise.js` exports `curlNoise(p)` (vec3 →
vec3, 18 simplex evaluations a call) and `snoise(v)`; `three/addons/tsl/math/voronoiNoise.js`
exports `voronoi2d(p, time)` and `voronoi3d(p, time)`. No theme uses them: count their cost in
the generated shader before you do.

A search of the GENERATED shader for `mx_` proves nothing on r187: MaterialX functions are
emitted under generated names (`fnNN`). A shader gate asks `hasMaterialXNoise(text)` from
`tests/unit/helpers/materialx-noise.js` instead (calibrated against the installed three), and
the theme's own test bans `mx_` calls in the source text.

## Per-instance variation

Uniform phase makes instanced animation read as fake. Ways to desync, cheapest first:

```javascript
import { attribute, floor, hash, instanceIndex, TWO_PI } from 'three/tsl';

// 1. Hash of the instance index: free and reproducible
const phase = hash(instanceIndex).mul(TWO_PI);

// 2. Authored per-instance data (the house form): ONE InstancedInterleavedBuffer per pool,
//    exposed as InterleavedBufferAttributes and read by name. Seeds are stored as INTEGERS.
const aLook = attribute('aLook', 'vec4');
const seed = floor(aLook.z.add(0.5));
```

- `range(min, max)` is a hash of `instanceIndex` computed in the shader (any mesh, constant
  bounds only). Its seed mixes in `object.id` and a counter of `range()` calls, so values shift
  when objects are created in another order: for a reproducible capture use
  `hash(instanceIndex.add(SEED))`.
- `instancedBufferAttribute(typedArray, 'float')` is NOT instanced in r187. Pass a real
  `new THREE.InstancedBufferAttribute(array, n)`. `instancedDynamicBufferAttribute` re-uploads
  every frame.
- A per-instance value read in the FRAGMENT stage is interpolated and comes back a few bits
  off, which a hash or a `floor` amplifies into per-pixel sparkle: pass it flat
  (`src/themes/shared/flat-varying.js`) or decode `floor(x.add(0.5))` (gotcha #87, #88).
- Inside a `positionNode`, read masks, pivots and phases from `positionGeometry` and return
  `positionLocal.add(offset)`: the instance matrix is already in `positionLocal` (gotcha #65).

## Billboarding

The house places camera-facing quads itself in `vertexNode` (clip space), because a quad is
usually also sized in pixels, stretched along a velocity or oriented to a path:
`src/themes/winter/winter-fx.js`, the stars in `src/themes/serenity-warp/serenity-warp-stars.js`,
and `templates/theme-starter.effect.js` in this skill. For a plain billboard the built-in is
one call:

```javascript
import { billboarding } from 'three/tsl';

material.vertexNode = billboarding();                        // turns about Y, stays upright (trees, grass)
material.vertexNode = billboarding({ vertical: true });      // faces the camera fully
material.vertexNode = billboarding({ position: myCenter });  // a custom pivot
```

Signature: `billboarding({ position = null, horizontal = true, vertical = false,
horizontalRotation = false })`. It builds from `positionGeometry` and the model matrix, so on an
instanced mesh only an instance's translation survives.

A ribbon or strip whose side vector comes from a cross product can face away or twist: give it
`side: DoubleSide` and orient the side vector by the stroke's overall direction (gotcha #92, #214).

## UV utilities

| Node | Use |
|---|---|
| `rotateUV(uv, rotation, center?)` | spin a texture (portals, vortices) |
| `spherizeUV(uv, strength, center?)` | fisheye or bulge |
| `matcapUV` | matcap lookup from the view-space normal |
| `equirectUV(direction)` | sample an equirect texture by direction |
| `rotate(vec2, angle)` | rotate any vec2 |

A render target's `v = 0` is its top row on both backends, and `screenUV` has y = 0 at the top
(gotcha #113).

## Blend and colour utilities

```javascript
import { blendBurn, blendDodge, blendOverlay, blendScreen } from 'three/tsl';

const graded = blendOverlay(baseColor, gradeColor);   // all take (base, blend), vec3 in and out
```

The bare names (`burn`, `dodge`, `screen`, `overlay`) no longer exist in r187. `blendColor(base,
blend)` is not one of these: it is vec4 alpha compositing.

Shaping: `parabola(x, k)` (a bump: 0 at both ends, 1 at 0.5), `gain(x, k)` (an S-curve about
0.5), `pcurve(x, a, b)` (as shipped, a 0→1 ease, not a bump), `remap` / `remapClamp`,
`oneMinus()`, `saturate()`.

Turning a colour between two hues in RGB passes through grey, and the short way round the hue
wheel can pass through lime: blend hues on the CPU and upload the result (gotcha #221;
`meltPalettes` in `src/themes/shared/mood-clock.js`).
