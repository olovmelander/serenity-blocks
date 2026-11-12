# TSL Node Materials (three r187)

Every `*NodeMaterial` and node slot. **House default:** themes are self-shaded, so nearly
every material here is a `MeshBasicNodeMaterial` (light computed in its own `colorNode`,
scene-linear HDR) or a bare `NodeMaterial` with a `fragmentNode` for a full-screen pass. The
lit materials below (Standard, Physical, …) work, but a theme has no scene lights for them to
answer to. The traps of alpha, blending, masks and draw order are in
`gotchas/materials-draw-order.md`.

## Available Material Types

| Material | Description |
|----------|-------------|
| `MeshBasicNodeMaterial` | Unlit, no lighting calculations |
| `MeshStandardNodeMaterial` | PBR material with metalness/roughness |
| `MeshPhysicalNodeMaterial` | Advanced PBR with clearcoat, transmission, etc. |
| `MeshPhongNodeMaterial` | Classic Phong shading |
| `MeshToonNodeMaterial` | Cel/toon shading |
| `MeshLambertNodeMaterial` | Diffuse-only lighting |
| `MeshNormalNodeMaterial` | Visualize normals |
| `MeshMatcapNodeMaterial` | Matcap texture shading |
| `PointsNodeMaterial` | Points. On `THREE.Points` a WebGPU point is ONE pixel and `sizeNode` is ignored; put it on a `THREE.Sprite` (with `sprite.count`) for sized, instanced points |
| `LineBasicNodeMaterial` | For lines |
| `LineDashedNodeMaterial` | For dashed lines |
| `SpriteNodeMaterial` | Camera-facing quads: `positionNode` is the sprite's CENTRE; also `scaleNode`, `rotationNode`; instance with `sprite.count` |

## Creating Node Materials

```javascript
import * as THREE from 'three/webgpu';

// Standard PBR material
const material = new THREE.MeshStandardNodeMaterial();

// Physical material with advanced features
const physicalMat = new THREE.MeshPhysicalNodeMaterial();

// Unlit material
const basicMat = new THREE.MeshBasicNodeMaterial();
```

## Material Properties

### Color and Opacity

```javascript
import { texture, color, float } from 'three/tsl';

// Color from texture
material.colorNode = texture(diffuseMap);

// Solid color
material.colorNode = color(0xff0000);

// Computed color
material.colorNode = positionLocal.normalize();

// Opacity (requires material.transparent = true)
material.opacityNode = float(0.8);
material.transparent = true;

// Alpha test threshold
material.alphaTestNode = float(0.5);
```

### PBR Properties (MeshStandardNodeMaterial)

```javascript
import { texture, float, color } from 'three/tsl';

// Metalness (0 = dielectric, 1 = metal)
material.metalnessNode = texture(metalMap).r;
material.metalnessNode = float(0.0);

// Roughness (0 = smooth/mirror, 1 = rough)
material.roughnessNode = texture(roughnessMap).r;
material.roughnessNode = float(0.5);

// Emissive (self-illumination)
material.emissiveNode = color(0xff0000).mul(2.0);
material.emissiveNode = texture(emissiveMap);
```

### Normal Mapping

```javascript
import { texture, normalMap, bumpMap } from 'three/tsl';

// Normal map
material.normalNode = normalMap(texture(normalMapTexture));

// Normal map with strength
material.normalNode = normalMap(texture(normalMapTexture), float(0.5));

// Bump map (height to normal)
material.normalNode = bumpMap(texture(heightMap), 0.05);
```

### Physical Properties (MeshPhysicalNodeMaterial)

```javascript
const material = new THREE.MeshPhysicalNodeMaterial();

// Clearcoat (car paint effect)
material.clearcoatNode = float(1.0);
material.clearcoatRoughnessNode = float(0.1);
material.clearcoatNormalNode = normalMap(texture(clearcoatNormalMap));

// Transmission (glass/translucency)
material.transmissionNode = float(0.9);
material.thicknessNode = float(0.5);
material.attenuationDistanceNode = float(1.0);
material.attenuationColorNode = color(0xffffff);

// Iridescence (soap bubble effect)
material.iridescenceNode = float(1.0);
material.iridescenceIORNode = float(1.3);
material.iridescenceThicknessNode = float(400);

// Sheen (fabric effect): sheenNode IS the sheen colour (vec3). There is no sheenColorNode.
material.sheenNode = color(0xffffff);
material.sheenRoughnessNode = float(0.5);

// Anisotropy (brushed metal) — direction/rotation is encoded in the node's xy
material.anisotropyNode = float(1.0);

// Specular
material.specularIntensityNode = float(1.0);
material.specularColorNode = color(0xffffff);

// Index of Refraction
material.iorNode = float(1.5);

// Dispersion (rainbow effect in glass)
material.dispersionNode = float(0.0);
```

### Environment and Lighting

```javascript
import { cubeTexture, pmremTexture, lights } from 'three/tsl';

// Environment map reflection — the property is envNode (envMapNode does not exist)
material.envNode = cubeTexture(envCubeMap);
material.envNode = pmremTexture(equirectTexture);  // repo pattern for IBL

// Custom light selection
material.lightsNode = lights([keyLight, rimLight]);
```

## Vertex Manipulation

### Position Displacement

```javascript
import { positionLocal, normalLocal, texture } from 'three/tsl';

// Displace vertices along normals
const displacement = texture(heightMap).r.mul(0.1);
material.positionNode = positionLocal.add(normalLocal.mul(displacement));

// Wave displacement
const wave = positionLocal.x.add(time).sin().mul(0.1);
material.positionNode = positionLocal.add(vec3(0, wave, 0));
```

On instanced/batched/skinned meshes, `positionLocal` inside `positionNode` is
**post-transform** in r185 (raw geometry in r181) — prefer the portable idiom:
masks/pivots/phases from `positionGeometry`, output `positionLocal.add(displacement)`.

### Custom Vertex Shader

```javascript
// Complete vertex position override
material.vertexNode = customVertexPosition;
```

## Fragment Override

```javascript
// Complete fragment override. It replaces the whole path: colorNode, opacityNode,
// alphaTestNode, maskNode and the MRT outputs are all skipped (gotcha #111). Fog and the
// premultiply step still apply. It is how an OPAQUE material writes its own alpha (gotcha #91).
material.fragmentNode = vec4(finalColor, 1.0);

// Replace the final colour. The material still runs; its result is the `output` node.
material.outputNode = vec4(output.rgb.mul(tint), output.a);   // import { output } from 'three/tsl'

// The house form for light that only adds: premultiplied additive, alpha left alone (gotcha #90)
material.blending = THREE.AdditiveBlending;
material.premultipliedAlpha = true;
material.depthWrite = false;
material.outputNode = vec4(light, 0.0);
```

## Geometry Attributes

### Position Nodes

```javascript
import {
  positionGeometry,  // Original mesh position
  positionLocal,     // Position in model space
  positionWorld,     // Position in world space
  positionView       // Position in camera space
} from 'three/tsl';
```

### Normal Nodes

```javascript
import {
  normalGeometry,    // Original mesh normal
  normalLocal,       // Normal in model space
  normalWorld,       // Normal in world space (use for lighting)
  normalView         // Normal in camera space
} from 'three/tsl';
```

### Tangent/Bitangent

```javascript
import {
  tangentLocal, tangentWorld, tangentView,
  bitangentLocal, bitangentWorld, bitangentView
} from 'three/tsl';
```

### UV Coordinates

```javascript
import { uv } from 'three/tsl';

uv()    // Primary UV set (UV0)
uv(1)   // Secondary UV set (UV1)
uv(2)   // Tertiary UV set (UV2)
```

### Other Attributes

```javascript
import { vertexColor, instanceIndex, vertexIndex } from 'three/tsl';

vertexColor()    // Vertex colors (if present)
instanceIndex    // Index for instanced meshes
vertexIndex      // Current vertex index
```

## Camera Nodes

```javascript
import {
  cameraPosition,         // Camera world position
  cameraNear,             // Near plane distance
  cameraFar,              // Far plane distance
  cameraViewMatrix,       // View matrix
  cameraProjectionMatrix, // Projection matrix
  cameraWorldMatrix       // Camera world matrix
} from 'three/tsl';
```

## Screen Space Nodes

```javascript
import {
  screenUV,         // Screen UV (0-1), y = 0 at the TOP on both backends
  screenCoordinate, // Pixel coordinates
  screenSize,       // Screen dimensions
  viewportUV,       // Viewport UV
  viewport,         // Viewport rectangle: vec4(x, y, width, height), physical pixels
  viewportSize,     // viewport.zw
  depth             // Fragment depth
} from 'three/tsl';
```

## Examples

### Animated Color Material

```javascript
import * as THREE from 'three/webgpu';
import { color, float, time, oscSine, mix } from 'three/tsl';

const material = new THREE.MeshStandardNodeMaterial();

const colorA = color(0xff0000);
const colorB = color(0x0000ff);
const t = oscSine(time.mul(0.5));

material.colorNode = mix(colorA, colorB, t);
material.roughnessNode = float(0.5);
material.metalnessNode = float(0.0);
```

### Triplanar Mapping Material

```javascript
import * as THREE from 'three/webgpu';
import { texture, triplanarTexture, float } from 'three/tsl';

const material = new THREE.MeshStandardNodeMaterial();

// Apply texture from all three axes
material.colorNode = triplanarTexture(
  texture(diffuseMap),
  null,           // Y-axis texture (optional)
  null,           // Z-axis texture (optional)
  float(0.1)      // texture SCALE: coordinates are positionLocal * scale (5th/6th: position, normal)
);
```

### Glass Material

```javascript
import * as THREE from 'three/webgpu';
import { float, color } from 'three/tsl';

const material = new THREE.MeshPhysicalNodeMaterial();

material.colorNode = color(0xffffff);
material.transmissionNode = float(0.95);
material.roughnessNode = float(0.0);
material.metalnessNode = float(0.0);
material.iorNode = float(1.5);
material.thicknessNode = float(0.5);
```

### Fresnel Rim Material

```javascript
import * as THREE from 'three/webgpu';
import {
  color, float, normalWorld, positionWorld,
  cameraPosition, Fn
} from 'three/tsl';

const fresnel = Fn(() => {
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const nDotV = normalWorld.dot(viewDir).saturate();
  return float(1.0).sub(nDotV).pow(3.0);
});

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = color(0x222222);
material.emissiveNode = color(0x00ffff).mul(fresnel());
```

### Dissolve Effect Material

```javascript
import * as THREE from 'three/webgpu';
import {
  Fn, color, float, positionLocal, rand, smoothstep, uniform,
} from 'three/tsl';

const threshold = uniform(0.5);

const material = new THREE.MeshStandardNodeMaterial();

// A builder, called inside each Fn below, so each graph pins its own copy.
// rand() is three's vec2 -> [0, 1) hash. (hash() casts its seed to uint and uses .x only:
// hash(positionLocal.mul(50)) gives bands along x, not grain.)
const grain = () => rand(positionLocal.xy.add(positionLocal.z).mul(50).floor()).toVar();

// maskNode discards where the mask is false. If() exists only inside a Fn: at module scope it
// throws, and a bare Discard() there builds a node that is attached to nothing.
material.maskNode = Fn(() => grain().greaterThanEqual(threshold))();
material.colorNode = color(0x333333);

// Edge glow
material.emissiveNode = Fn(() => {
  const edge = smoothstep(threshold, threshold.add(0.1), grain());
  return color(0xff5500).mul(float(1.0).sub(edge));
})();
```
