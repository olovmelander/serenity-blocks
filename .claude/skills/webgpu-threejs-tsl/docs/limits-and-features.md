# WebGPU limits and features

A WebGPU device is created with **default limits** unless you ask for more, whatever the
hardware could do, and **features** are optional capabilities that must be requested when the
device is made. Read this when pipeline creation fails validation with a count or a size in the
message, when a compute buffer is large, or when you want a feature (`timestamp-query`,
`float32-filterable`, …).

## The limits themes actually hit

Both have gotcha rows, because both fail on WebGPU only (the WebGL2 backend draws the same
scene) and neither is reported until the pipeline is created:

| Limit | Value | How a theme hits it | Fix |
|---|---|---|---|
| `maxVertexBuffers` | 8 per pipeline | Every `BufferAttribute` is its own vertex buffer: `position` + `uv` + seven instanced attributes is nine | Pack per-instance attributes into `InstancedInterleavedBuffer`s (gotcha #99) |
| `maxUniformBuffersPerShaderStage` | 12 per stage | Every `uniformArray` is its own uniform buffer, and the object's own buffer counts | One array of `vec4` rows addressed by block and offset (gotcha #102) |

For any other limit, read the value from the device three made rather than from a table (three
asks for its adapter in a way that can lower some defaults, see below):

```javascript
// In the playground console, on the WebGPU backend:
['maxBufferSize', 'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage',
 'maxSampledTexturesPerShaderStage', 'maxComputeWorkgroupSizeX',
 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupsPerDimension', 'maxColorAttachments']
  .map((k) => [k, renderer.backend.device.limits[k]]);
```

## Asking for more

`WebGPURenderer` passes `requiredLimits` to `requestDevice()`:

```javascript
const renderer = new THREE.WebGPURenderer({
  powerPreference: 'high-performance',
  requiredLimits: { maxStorageBufferBindingSize: 512 * 1024 * 1024 },
});
await renderer.init();
```

Three things to know before you do:

- **An unsupported limit does not throw.** `requestDevice()` rejects, and `WebGPURenderer.init()`
  catches that and silently switches to the WebGL2 backend (a console warning only). After
  `await renderer.init()`, check `renderer.backend.isWebGPUBackend === true`, then read what you
  got from `renderer.backend.device.limits`.
- **`requiredLimits` is ignored when the renderer is handed a `device`.** In this repo a theme
  that sets `requiredLimits` loses the spare-device fast start
  (`src/rendering/theme-device-spare.js` skips the spare when limits are asked for), and a
  renderer on the shared warm device (`src/rendering/webgpu-device-warm.js`) cannot raise limits
  at all. So a raised limit costs start-up time: prefer a design that fits the defaults.
- **Check the adapter three will use, not a default one.** three requests its adapter with the
  renderer's `powerPreference` and `featureLevel: 'compatibility'`; on a laptop with two GPUs a
  bare `requestAdapter()` may describe the other one.

```javascript
const powerPreference = 'high-performance';
const adapter = await navigator.gpu?.requestAdapter({ powerPreference, featureLevel: 'compatibility' });
const requiredLimits = {};
const wanted = 1024 * 1024 * 1024; // 1 GiB
if (adapter && adapter.limits.maxBufferSize >= wanted) requiredLimits.maxBufferSize = wanted;

const renderer = new THREE.WebGPURenderer({ powerPreference, requiredLimits });
await renderer.init();
const granted = renderer.backend.isWebGPUBackend ? renderer.backend.device.limits.maxBufferSize : 0;
```

Ask only for what the effect needs. Requesting maximums hides the fact that it works on your
GPU and fails on a weaker one, and every tier down to a phone's WebGL2 has to draw the theme.

## Features

- three requests **every feature on its own fixed list** (`GPUFeatureName`, 20 names in r187)
  that the adapter supports. A feature outside that list is never enabled, and you cannot add
  one through the renderer's options.
- Ask what you got with `renderer.hasFeature(name)` after `await renderer.init()`; it throws
  before init. (`hasFeatureAsync` is a deprecated wrapper.)
- **Compatibility mode turns MSAA off.** When the device lacks `core-features-and-limits`,
  three sets the renderer's sample count to 0. A device made elsewhere and injected must
  therefore be requested the way three would (`src/rendering/theme-device-spare.js` mirrors it).
- The WebGL2 backend has its own answers: gate on a capability you measured there
  (half-float render targets need `EXT_color_buffer_float` or `_half_float`), never on the
  WebGPU feature name.

| Feature | What it unlocks here |
|---|---|
| `timestamp-query` | GPU timings (`trackTimestamp`, the playground's `profile=1`): the verified instrument of ADR-0016 |
| `float32-filterable` | Linear filtering of float32 textures |
| `subgroups` | `subgroupSize` and the other subgroup builtins in compute |
| `texture-compression-bc` / `-etc2` / `-astc` | Compressed texture formats |
| `dual-source-blending`, `clip-distances`, `depth-clip-control` | Rarely needed; check `hasFeature` first |

## Debugging a limit failure

The validation error names the limit (`Vertex buffer count (9) exceeds the maximum number of
vertex buffers (8)`), and the pipeline's label names the material. To list every limit of a
device or adapter, iterate it:

```javascript
for (const key in renderer.backend.device.limits) console.log(key, renderer.backend.device.limits[key]);
```
