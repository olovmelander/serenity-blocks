# WebGPU device loss

A device is lost when the GPU driver cannot go on: a driver crash or update, heavy memory
pressure, a shader that runs so long the OS resets the adapter (a TDR), a laptop switching
GPUs. The `GPUDevice` and everything made with it (buffers, textures, pipelines) are dead from
that moment; nothing is restored. On this repo's dev machine a full-journey capture has done
exactly that to the integrated GPU, which is why the workflow says one small effect at a time.

Read this when a renderer dies mid-session, when you write or change a surface's recovery, or
when you create or dispose a renderer outside `BaseTheme`.

## In this repo: do not hand-roll it

A theme never listens for loss itself. The adapter does two things, and both are boilerplate
you clone (`setupGpuResilience()` in `src/themes/serenity-warp/serenity-warp-theme.js`):

```javascript
this.setupRendererResilience(renderer, {                 // src/themes/base-theme.js
    webgpuDevice: this.isWebGPU ? renderer.backend?.device : null,
});
if (!this.isWebGPU) return;   // WebGL2: BaseTheme's CONTEXT_RESTORED restart covers it
this.gpuSurfaceUnregister = registerGpuSurface(this.name, {   // src/utils/gpu-loss-coordinator.js
    recover: async () => {
        if (this.gpuRecoveryAttempted) throw new Error('… WebGPU recovery already attempted.');
        this.gpuRecoveryAttempted = true;
        this.forceWebGL = true;                          // one retry, on the WebGL2 backend
        if (this.isActive) await this.createScene();
    },
});
```

What that gives:

- Losses flow through `gpuResilience.monitorWebGPU()` / `monitorWebGL()`
  (`src/utils/gpu-context-resilience.js`) onto the bus as `EVENTS.CONTEXT_LOST`, and the
  coordinator is the one consumer.
- **A WebGPU surface gets ONE recovery**: rebuild on the WebGL2 backend. A second loss routes
  out to the main menu. A retry loop is the wrong move: a GPU that was reset loses the next
  device too.
- An uncaptured GPU **error** (validation, out of memory) is counted for diagnostics and never
  triggers recovery; recovering on every error would storm.
- The surface label must equal `this.name`.
- In `disposeRuntime()`, call `removeRendererResilience()` BEFORE `disposeRenderer()`. A dispose
  is not a loss, and in the other order the destroyed device is reported as one.

## What three r187 does

- **three hooks the device itself.** `WebGPUBackend.init` attaches to `device.lost` and calls
  `renderer.onDeviceLost({ api, message, reason, originalEvent })`. A WebGL context loss on the
  WebGL2 backend arrives on the same callback. A loss whose reason is `'destroyed'` (your own
  `device.destroy()` or `renderer.dispose()`) is dropped and never reaches it.
- **The default handler matters.** `renderer.onDeviceLost` defaults to a handler that logs and
  sets `_isDeviceLost`, the flag that makes `render()`, `compute()`, `compileAsync()` and
  `compileComputeAsync()` return silently. Replace it without calling the default and three keeps
  issuing commands to a dead device:

  ```javascript
  const threeDefault = renderer.onDeviceLost;
  renderer.onDeviceLost = (info) => { threeDefault.call(renderer, info); recover(info); };
  ```

- **`renderer.backend.device` exists only on the WebGPU backend.** Code that reads
  `renderer.backend.device.lost` throws on the WebGL2 backend. Test
  `renderer.backend.isWebGPUBackend === true` first.
- **A failed WebGPU start does not throw.** When there is no adapter, or `requestDevice()`
  rejects (an unsupported `requiredLimits` included), `WebGPURenderer` warns and switches to its
  WebGL2 backend; `await renderer.init()` rejects only if that fails too. So "did I get WebGPU?"
  is `renderer.backend.isWebGPUBackend`, not a `try`/`catch`.
- **Uncaptured errors** go to `renderer.onError({ api, type, message, originalEvent })`. three
  installs it by assignment (`device.onuncapturederror = …`), so on a device shared by several
  renderers the last one initialised replaces the others. The repo listens with
  `addEventListener('uncapturederror')` instead (`src/utils/gpu-context-resilience.js`).
- **Drive the loop with `renderer.setAnimationLoop(fn)`**, which `dispose()` stops. A hand-made
  `requestAnimationFrame` loop keeps running against the old renderer after a recovery, and each
  recovery adds another.

## Disposing a renderer

- **`dispose()` is async**: `await renderer.dispose()` before you destroy or null a device or
  release a shared device's owner. It awaits a pending `init()` and rethrows its rejection, so
  observe the rejection even in fire-and-forget cleanup (`src/ui/boot-warp-transition.js`).
- It destroys the device only if the renderer created it. A renderer handed a `device` (the
  shared warm device, `src/rendering/webgpu-device-warm.js`) leaves it alive.
- It does not remove the canvas, and it cannot unhook `device.lost`. On a shared device that
  promise never settles, so its callback keeps every disposed renderer reachable, with its swap
  chain and render targets (about 70 MB of VRAM per Odyssey visit, measured). After disposing a
  renderer that ran on the warm device, call `releaseDisposedRenderer(renderer)`:

  ```javascript
  Promise.resolve(renderer.dispose()).finally(() => releaseDisposedRenderer(renderer));
  ```

- A disposed renderer cannot be initialised again (`_initialized` is never reset): make a new one.
- `BaseTheme.disposeRenderer()` does all of this for a theme. Call it; do not copy it.

## A standalone surface (outside BaseTheme)

Only for a surface that cannot use the theme machinery (a tool page, a prototype). Keep the
repo's policy: one recovery, then stop.

```javascript
import * as THREE from 'three/webgpu';

let renderer = null;
let recoveries = 0;

async function start() {
  const r = new THREE.WebGPURenderer({ antialias: true });
  const threeDefault = r.onDeviceLost;           // logs, and stops render()/compute()
  r.onDeviceLost = (info) => { threeDefault.call(r, info); recover(r, info); };

  await r.init();                                // also resolves on the WebGL2 fallback
  renderer = r;
  r.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(r.domElement);
  setupScene();
  r.setAnimationLoop(animate);                   // stopped by dispose()
}

async function recover(lost) {
  if (renderer !== lost) return;                 // a stale callback from a replaced renderer
  renderer = null;
  lost.domElement.remove();
  try { await lost.dispose(); } catch { /* its init had failed */ }
  if (++recoveries > 1) { showError('Graphics device lost.'); return; }
  await start();
}
```

Keep what the player must not lose (progress, settings) outside the GPU; let transient state
(particle positions, a simulation's fields) start again.

## Testing the recovery path

- `device.destroy()` does **not** exercise three's path: three ignores reason `'destroyed'`.
  Call the hook instead:

  ```javascript
  renderer.onDeviceLost({ api: 'WebGPU', message: 'simulated', reason: 'unknown', originalEvent: null });
  ```

- The repo's own monitor (`gpuResilience.monitorWebGPU`) listens to the raw promise and does
  broadcast a destroy, marked `destroyed: true`, which the coordinator ignores. The coordinator
  is unit-testable with no GPU: construct `GpuLossCoordinator` with a mock bus and emit
  `CONTEXT_LOST`.
- A real GPU-process crash: `about:gpucrash` in a separate Chrome tab. Chrome restricts WebGPU
  after repeated crashes; this file does not vouch for the exact thresholds (they are browser
  behaviour, not checked against any source here).
