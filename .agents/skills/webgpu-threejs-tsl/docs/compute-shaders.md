# TSL Compute Shaders

Compute shaders run on the GPU for parallel processing of data. TSL makes them accessible through JavaScript.

**House policy: compute is the exception.** A theme uses compute only when the concept truly
needs it, and then with a CPU twin, because the WebGL2 backend is a player surface (ADR-0019)
and the repo's compute wrapper reports it `unsupported` there. Most "particle" effects in this
repo are instanced quads with closed-form motion in the vertex stage and need no compute at all
(`docs/theme-foundation.md` §4). Murmuration (`src/themes/murmuration/`) and Astral Weave's dust
(`src/themes/astral-weave/astral-weave-dust.js`) are the compute precedents. On a loading
surface, pipelines are compiled through `src/rendering/webgpu-compute-pipeline-async.js`
(ADR-0020), never by a first `renderer.compute()` in front of the player.

## Contents

- [Mutation: node assignment vs JS reassignment](#critical-tsl-node-property-assignment-vs-js-variable-reassignment)
- [Basic setup](#basic-setup) · [Storage buffers](#storage-buffers) · [Patterns](#compute-shader-patterns)
- [Workgroups and synchronization](#workgroups-and-synchronization) · [Atomics](#atomic-operations)
- [Using compute results in materials](#using-compute-results-in-materials)
- [Execution, compiling ahead and disposal](#execution-methods)
- [Reading back data](#reading-back-data-gpu-to-cpu) · [Complete example](#complete-example-particle-system)

## CRITICAL: TSL Node Property Assignment vs JS Variable Reassignment

**TSL can intercept property assignments on nodes, but NOT JavaScript variable reassignment.**

### What Works vs What Doesn't

| Pattern | Works? | Why |
|---------|--------|-----|
| `node.y = value` | ✅ | Property setter - TSL intercepts |
| `node.x.assign(value)` | ✅ | TSL method call |
| `buffer.element(i).assign(v)` | ✅ | TSL method call |
| `variable = variable.add(1)` | ❌ | JS variable reassignment - TSL can't see it |

### This WORKS (property assignment on vec3):

```javascript
// ✅ CORRECT - Property assignment on node object
const computeShader = Fn(() => {
  const result = vec3(position);

  If(result.y.greaterThan(limit), () => {
    result.y = limit;  // TSL intercepts property setters!
  });

  return result;
})();
```

### This does NOT work (JS variable reassignment):

```javascript
// ❌ WRONG - JavaScript variable reassignment inside If()
const computeShader = Fn(() => {
  let value = buffer.element(index).toFloat();  // Scalar float - no .x/.y properties

  If(condition, () => {
    value = value.add(1.0);  // JS reassigns variable to NEW node - TSL can't track this!
  });

  buffer.element(index).assign(value);  // Uses ORIGINAL node, not the add result!
})().compute(count);
```

**Why it fails:** `value = value.add(1.0)` creates a new TSL node and reassigns the JavaScript variable to point to it. But TSL can't intercept JavaScript variable assignment - it can only intercept property setters and method calls on TSL node objects. Since `value` is a scalar float (no `.x`/`.y` properties), you can't use property assignment.

### Solution 1: Use `select()` for Conditional Values

```javascript
// ✅ CORRECT - Use select() for inline conditionals
import { select } from 'three/tsl';

const computeShader = Fn(() => {
  const currentValue = buffer.element(index).toFloat();

  // select(condition, valueIfTrue, valueIfFalse)
  const newValue = select(
    condition,
    currentValue.add(1.0),  // If true
    currentValue            // If false
  );

  buffer.element(index).assign(newValue);
})().compute(count);
```

### Solution 2: Use `.assign()` Directly on Buffer Elements Inside If()

```javascript
// ✅ CORRECT - Direct buffer assignment inside If() works
const computeShader = Fn(() => {
  const element = buffer.element(index);

  If(condition, () => {
    // Direct assignment to buffer element works!
    element.assign(element.add(1.0));
  });
})().compute(count);
```

### Solution 3: Use `.toVar()` for Mutable Variables

```javascript
// ✅ CORRECT - Use .toVar() for variables that need mutation
const computeShader = Fn(() => {
  // .toVar() creates a proper GPU variable that can be reassigned
  const value = buffer.element(index).toFloat().toVar();

  If(condition, () => {
    value.assign(value.add(1.0));  // This works with .toVar()!
  });

  buffer.element(index).assign(value);
})().compute(count);
```

### Quick Reference: When to Use What

| Pattern | Use Case |
|---------|----------|
| `select(cond, a, b)` | Simple conditional value selection |
| `element.assign()` inside `If()` | Direct buffer writes |
| `.toVar()` + `assign()` | Complex logic with multiple conditionals |
| Regular `If()` with direct assigns | Multiple buffer element updates |

### Example: Correct Stamp/Fade Pattern

```javascript
// ✅ CORRECT implementation of conditional stamping
const computeShader = Fn(() => {
  const currentFoam = foamBuffer.element(index).toFloat();

  // Calculate distance
  const dist = worldPos.distance(stampPos);
  const radius = float(50.0);

  // Calculate falloff (will be 0 outside radius due to select)
  const falloff = float(1.0).sub(dist.div(radius));

  // Use select() - returns falloff if inside radius, 0 if outside
  const foamToAdd = select(dist.lessThan(radius), falloff, float(0.0));

  // Combine and write
  const newFoam = max(currentFoam, foamToAdd);
  foamBuffer.element(index).assign(clamp(newFoam, 0.0, 1.0));
})().compute(bufferSize);
```

---

## Basic Setup

```javascript
import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, vec3 } from 'three/tsl';

// Create storage buffer
const count = 100000;
const positions = instancedArray(count, 'vec3');

// Create compute shader
const computeShader = Fn(() => {
  const position = positions.element(instanceIndex);
  position.x.addAssign(0.01);
})().compute(count);

// Initialize renderer first, then use synchronous compute
await renderer.init();
renderer.compute(computeShader);
```

### Per-vertex vs per-instance storage, and read-only access

`instancedArray()` and `attributeArray()` differ only in the attribute behind them:
`StorageInstancedBufferAttribute` (one element per instance) versus `StorageBufferAttribute`
(one element per vertex). **Both are read-write in compute.** Read-only is a separate switch,
`.toReadOnly()`. In the vertex and fragment stages every storage buffer is bound read-only
regardless.

```javascript
import { attributeArray } from 'three/tsl';

const lookupTable = attributeArray(data, 'float').toReadOnly(); // var<storage, read> in compute
const value = lookupTable.element(index);
```

**Prefer `'vec4'` to `'vec3'` for anything seeded from the CPU more than once or read back.**
WGSL cannot pack `vec3` in a storage buffer, so three pads a `'vec3'` storage attribute to four
floats on first upload (`attribute.itemSize` becomes 4 and `attribute.array` a new padded
array), and a later CPU write through the original stride of 3 scrambles it. Re-seed with a
compute pass instead (`reseat()` in `src/themes/astral-weave/astral-weave-dust.js`).

## Storage Buffers

### Instanced Arrays

```javascript
import { instancedArray } from 'three/tsl';

// Create typed storage buffers
const positions = instancedArray(count, 'vec3');
const velocities = instancedArray(count, 'vec3');
const colors = instancedArray(count, 'vec4');
const indices = instancedArray(count, 'uint');
const values = instancedArray(count, 'float');
```

### Accessing Elements

```javascript
const computeShader = Fn(() => {
  // Get element at current index
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // Read values
  const x = position.x;
  const speed = velocity.length();

  // Write values
  position.assign(vec3(0, 0, 0));
  position.x.assign(1.0);
  position.addAssign(velocity);
})().compute(count);
```

### Accessing Other Elements

```javascript
const computeShader = Fn(() => {
  const myIndex = instanceIndex;
  const neighborIndex = myIndex.add(1).mod(count);

  const myPos = positions.element(myIndex);
  const neighborPos = positions.element(neighborIndex);

  // Calculate distance to neighbor
  const dist = myPos.distance(neighborPos);
})().compute(count);
```

## Compute Shader Patterns

### Initialize Particles

```javascript
const computeInit = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // Random positions using hash
  position.x.assign(hash(instanceIndex).mul(10).sub(5));
  position.y.assign(hash(instanceIndex.add(1)).mul(10).sub(5));
  position.z.assign(hash(instanceIndex.add(2)).mul(10).sub(5));

  // Zero velocity
  velocity.assign(vec3(0));
})().compute(count);

// Run once at startup (after await renderer.init())
renderer.compute(computeInit);
```

### Physics Update

```javascript
const gravity = uniform(-9.8);
const deltaTimeUniform = uniform(0);
const groundY = uniform(0);

const computeUpdate = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);
  const dt = deltaTimeUniform;

  // Apply gravity
  velocity.y.addAssign(gravity.mul(dt));

  // Update position
  position.addAssign(velocity.mul(dt));

  // Ground collision
  If(position.y.lessThan(groundY), () => {
    position.y.assign(groundY);
    velocity.y.assign(velocity.y.negate().mul(0.8)); // Bounce
    velocity.xz.mulAssign(0.95); // Friction
  });
})().compute(count);

// In animation loop. THREE.Clock is deprecated (r183) and warns: use THREE.Timer, or the
// rAF timestamp and your own last-frame time as the themes do.
const timer = new THREE.Timer();
function animate(time) {            // setAnimationLoop passes the frame timestamp
  timer.update(time);
  deltaTimeUniform.value = Math.min(timer.getDelta(), 0.1);
  renderer.compute(computeUpdate);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
```

### Attraction to Point

```javascript
const attractorPos = uniform(new THREE.Vector3(0, 0, 0));
const attractorStrength = uniform(1.0);

const computeAttract = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // Direction to attractor
  const toAttractor = attractorPos.sub(position);
  const distance = toAttractor.length();
  const direction = toAttractor.normalize();

  // Apply force (inverse square falloff)
  const force = direction.mul(attractorStrength).div(distance.mul(distance).add(0.1));
  velocity.addAssign(force.mul(deltaTimeUniform));
})().compute(count);
```

### Neighbor Interaction (Boids-like)

This loop is O(N²): every particle tests every other, each dispatch. Keep N in the low
thousands or bin the particles into a spatial grid first. At the 100 000 used elsewhere on
this page it is 10¹⁰ tests a frame, which is how an integrated GPU gets reset by the driver.

```javascript
const computeBoids = Fn(() => {
  const myPos = positions.element(instanceIndex);
  const myVel = velocities.element(instanceIndex);

  const separation = vec3(0).toVar();
  const alignment = vec3(0).toVar();
  const cohesion = vec3(0).toVar();
  const neighborCount = int(0).toVar();

  // Check nearby particles
  Loop(count, ({ i }) => {
    If(i.notEqual(instanceIndex), () => {
      const otherPos = positions.element(i);
      const otherVel = velocities.element(i);
      const dist = myPos.distance(otherPos);

      If(dist.lessThan(2.0), () => {
        // Separation
        const diff = myPos.sub(otherPos).normalize().div(dist);
        separation.addAssign(diff);

        // Alignment
        alignment.addAssign(otherVel);

        // Cohesion
        cohesion.addAssign(otherPos);

        neighborCount.addAssign(1);
      });
    });
  });

  If(neighborCount.greaterThan(0), () => {
    const n = neighborCount.toFloat();
    alignment.divAssign(n);
    cohesion.divAssign(n);
    cohesion.assign(cohesion.sub(myPos));

    myVel.addAssign(separation.mul(0.05));
    myVel.addAssign(alignment.sub(myVel).mul(0.05));
    myVel.addAssign(cohesion.mul(0.05));
  });

  // Limit speed
  const speed = myVel.length();
  If(speed.greaterThan(2.0), () => {
    myVel.assign(myVel.normalize().mul(2.0));
  });

  myPos.addAssign(myVel.mul(deltaTimeUniform));
})().compute(count);
```

## Workgroups and Synchronization

### Workgroup Size

```javascript
// Default workgroup size is [64] (padded to [64, 1, 1]); pass 1–3 positive integers to override.
const computeShader = Fn(() => {
  // shader code
})().compute(count, [64]);

// A NUMERIC count is always a 1D dispatch: ceil(count / 64) workgroups of 8×8 along X.
// Use instanceIndex here; globalId.xy is NOT a width × height grid.
const computeLinear = Fn(() => { /* … */ })().compute(width * height, [8, 8]);

// A true 2D grid: pass the dispatch size (workgroup counts) as an array. three emits no
// automatic `instanceIndex >= count` guard in this form, so bound-check globalId yourself.
const compute2D = Fn(() => { /* use globalId.xy */ })()
  .compute([Math.ceil(width / 8), Math.ceil(height / 8)], [8, 8]);
```

### Compute Builtins

```javascript
// subgroupSize / subgroupIndex / invocationSubgroupIndex need renderer.hasFeature('subgroups')
// (the WGSL builder reports an error without it).
import {
  globalId, localId, workgroupId, numWorkgroups, subgroupSize,
  invocationLocalIndex, invocationSubgroupIndex, subgroupIndex
} from 'three/tsl';

const computeShader = Fn(() => {
  // Global invocation ID across all workgroups
  const gid = globalId;

  // Local invocation ID within the workgroup
  const lid = localId;

  // Workgroup ID
  const wid = workgroupId;

  // Total number of workgroups
  const nwg = numWorkgroups;
})().compute(count, [64]);
```

### Barriers

`workgroupBarrier()` pairs with `workgroupArray()` (memory shared by the invocations of ONE
workgroup); `storageBarrier()` is the one for storage buffers (`instancedArray`,
`attributeArray`); `textureBarrier()` for storage textures.

```javascript
import { workgroupArray, workgroupBarrier, invocationLocalIndex } from 'three/tsl';

const WG = 64;
const scratch = workgroupArray('float', WG);     // shared by the invocations of one workgroup

const computeShader = Fn(() => {
  scratch.element(invocationLocalIndex).assign(values.element(instanceIndex));
  workgroupBarrier();                            // every invocation of the workgroup reaches here
  const next = scratch.element(invocationLocalIndex.add(1).mod(WG));
  values.element(instanceIndex).assign(next);
})().compute(count, [WG]);
```

Any barrier switches off the automatic out-of-range guard (three stops emitting
`if (instanceIndex >= count) return` once a barrier is in the kernel): make `count` a multiple
of the workgroup size, or guard the writes yourself.

## Atomic Operations

For thread-safe read-modify-write operations:

```javascript
import { atomicAdd, atomicSub, atomicMax, atomicMin, atomicAnd, atomicOr, atomicXor } from 'three/tsl';

// The buffer must be declared atomic — WGSL atomics only operate on
// atomic<u32>/atomic<i32> storage. Call .toAtomic() on the storage node.
const counter = instancedArray(1, 'uint').toAtomic();

const computeShader = Fn(() => {
  // Atomically increment counter
  atomicAdd(counter.element(0), 1);

  // Atomic max
  atomicMax(maxValue.element(0), localValue);
})().compute(count);
```

## Using Compute Results in Materials

### Instanced Mesh with Computed Positions

```javascript
// Create instanced mesh
const geometry = new THREE.SphereGeometry(0.1, 16, 16);
const material = new THREE.MeshStandardNodeMaterial();

// ADD the computed position to the instance's local vertices.
// `positionNode = positions.element(instanceIndex)` alone is a classic bug:
// it replaces EVERY vertex with the same point, collapsing each instance
// to a zero-area dot (nothing renders).
material.positionNode = positionLocal.add(positions.element(instanceIndex));

// Optionally use computed colors
material.colorNode = colors.element(instanceIndex);

const mesh = new THREE.InstancedMesh(geometry, material, count);
mesh.frustumCulled = false;   // positions live in the GPU buffer, not in instanceMatrix:
                              // the mesh's bounds are one small sphere at the origin
scene.add(mesh);
```

For camera-facing particle quads (billboards), override `material.vertexNode`
instead and build the clip-space position yourself — see the working pattern in
`src/themes/winter/winter-snowfall.js`.

### Point/Sprite Particles with Computed Positions

For `PointsNodeMaterial`/`SpriteNodeMaterial`, `positionNode` means the particle
**center** (unlike mesh materials, where it replaces vertex positions). The pattern for
instanced particles is a `THREE.Sprite` with the storage buffer bound via `.toAttribute()`.
Do not use `THREE.Points` for this: WebGPU point primitives are one pixel (`sizeNode` is
ignored), and a `Points` object draws one instance, so `positions.element(instanceIndex)`
reads element 0 for every vertex.

```javascript
const material = new THREE.PointsNodeMaterial();
material.positionNode = positions.toAttribute();  // per-instance center
material.colorNode = colors.toAttribute();
material.sizeNode = float(5.0);

const particles = new THREE.Sprite(material);
particles.count = count;
particles.frustumCulled = false;   // centers come from the GPU buffer
scene.add(particles);
```

## Execution Methods

```javascript
// IMPORTANT: Always initialize the renderer first
await renderer.init();

// Synchronous dispatch (after any loading-surface precompile has finished)
renderer.compute(computeShader);

// Multiple computes
renderer.compute(computeInit);
renderer.compute(computePhysics);
renderer.compute(computeCollisions);

// computeAsync() is not deprecated in r187, but it only awaits init() and then calls compute():
// it does not wait for the GPU and does not compile off-thread. Prefer: await renderer.init()
// once, then renderer.compute() (before init it warns and returns a Promise).
// Deprecated wrappers: renderAsync, clear*Async, hasFeatureAsync, initTextureAsync.
// Removed: waitForGPU().
```

`renderer.compute(nodes, dispatchSize)` takes a second argument for nodes made with
`computeKernel()`; it throws for nodes made with `.compute(count)`.

**The first `renderer.compute()` of a node creates its pipeline synchronously**
(`device.createComputePipeline`). A one-shot kernel fired from an event handler therefore
hitches on first use unless it was compiled ahead.

### Compile before dispatch on loading surfaces

The native `renderer.compileComputeAsync(nodes)` builds nodes and GPU pipelines
without dispatching. Use the repository wrapper on intro/boot/loading surfaces (ADR-0020):

```javascript
import { compileComputeAsync } from '../../rendering/webgpu-compute-pipeline-async.js';
const result = await compileComputeAsync(renderer, computeShader, { timeoutMs: 9000 });
if (result.status === 'ready') renderer.compute(computeShader);
// status: 'ready' | 'failed' | 'timeout' | 'unsupported' | 'device-lost'
```

Native compilation resolves even when pipeline creation failed, and a dispatch does not check
the pipeline's slot. The wrapper checks cached GPU slots and guards both the asynchronous
node-build interval and pending/failed backend pipelines. A timeout leaves those guards active
until native work settles.

On the WebGL2 backend the wrapper returns `status: 'unsupported'` (it only guards the WebGPU
backend). three's WebGL2 backend can still run simple compute nodes through transform feedback
(numeric count only; atomics, barriers and compute builtins are WebGPU-only), so keep the
caller's fallback path: a CPU twin of the simulation.

### Disposing compute resources

- `computeNode.dispose()` frees the pipeline, bindings and node data. It does NOT free storage
  buffers: those go with `storageNode.value.dispose()` or with `renderer.dispose()`.
- Dispose compute nodes before their renderer.
- `await renderer.dispose()`: it is async (`docs/three-r187.md`, `docs/device-loss.md`).

## Reading Back Data (GPU to CPU)

Storage buffers read back via `getArrayBufferAsync` — pass the buffer attribute
that backs the storage node:

```javascript
const positions = instancedArray(count, 'vec3');

// ... after at least one compute pass (the GPU buffer exists from first use) ...
const arrayBuffer = await renderer.getArrayBufferAsync(positions.value);
const data = new Float32Array(arrayBuffer);
// vec3 storage is padded to vec4 on the GPU: FOUR floats per element.
const x = data[i * 4], y = data[i * 4 + 1], z = data[i * 4 + 2];
// getArrayBufferAsync(attribute, target = null, offset = 0, count = -1): offset and count are
// BYTES (multiples of 4); target may be an ArrayBuffer or a reusable THREE.ReadbackBuffer.
```

(`readRenderTargetPixelsAsync` is the different API for reading *render targets*,
not compute storage buffers.)

Readback stalls the pipeline — do it for debugging/tools, never per frame in a
shipping loop.

## Complete Example: Particle System

```javascript
import * as THREE from 'three/webgpu';
import {
  Fn, If, instancedArray, instanceIndex, uniform,
  vec3, float, hash, time
} from 'three/tsl';

// Setup
const count = 50000;
const positions = instancedArray(count, 'vec3');
const velocities = instancedArray(count, 'vec3');
const lifetimes = instancedArray(count, 'float');

// Uniforms
const emitterPos = uniform(new THREE.Vector3(0, 0, 0));
const gravity = uniform(-2.0);
const dt = uniform(0);

// Initialize
const computeInit = Fn(() => {
  const pos = positions.element(instanceIndex);
  const vel = velocities.element(instanceIndex);
  const life = lifetimes.element(instanceIndex);

  pos.assign(emitterPos);

  // Random velocity in cone
  const angle = hash(instanceIndex).mul(Math.PI * 2);
  const speed = hash(instanceIndex.add(1)).mul(2).add(1);
  vel.x.assign(angle.cos().mul(speed).mul(0.3));
  vel.y.assign(speed);
  vel.z.assign(angle.sin().mul(speed).mul(0.3));

  // Random lifetime
  life.assign(hash(instanceIndex.add(2)).mul(2).add(1));
})().compute(count);

// Update
const computeUpdate = Fn(() => {
  const pos = positions.element(instanceIndex);
  const vel = velocities.element(instanceIndex);
  const life = lifetimes.element(instanceIndex);

  // Apply gravity
  vel.y.addAssign(gravity.mul(dt));

  // Update position
  pos.addAssign(vel.mul(dt));

  // Decrease lifetime
  life.subAssign(dt);

  // Respawn dead particles
  If(life.lessThan(0), () => {
    pos.assign(emitterPos);
    const angle = hash(instanceIndex.add(time.mul(1000))).mul(Math.PI * 2);
    const speed = hash(instanceIndex.add(time.mul(1000)).add(1)).mul(2).add(1);
    vel.x.assign(angle.cos().mul(speed).mul(0.3));
    vel.y.assign(speed);
    vel.z.assign(angle.sin().mul(speed).mul(0.3));
    life.assign(hash(instanceIndex.add(time.mul(1000)).add(2)).mul(2).add(1));
  });
})().compute(count);

// Material: a Sprite, so the size is honoured and every particle is its own instance
const material = new THREE.PointsNodeMaterial();
material.positionNode = positions.toAttribute();   // particle centre, per instance
material.sizeNode = float(3.0);
material.colorNode = vec3(1, 0.5, 0.2);

const particles = new THREE.Sprite(material);
particles.count = count;
particles.frustumCulled = false;                   // centres come from the GPU buffer
scene.add(particles);

// Init (after await renderer.init())
renderer.compute(computeInit);

// Animation loop
const timer = new THREE.Timer();
function animate(time) {
  timer.update(time);
  dt.value = Math.min(timer.getDelta(), 0.1);
  renderer.compute(computeUpdate);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
```
