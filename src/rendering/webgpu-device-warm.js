/**
 * @fileoverview A shared, warmed `GPUDevice` (plan item 2.5).
 *
 * WHY. `WebGPURenderer.init()` is ~97 % `navigator.gpu.requestAdapter()` +
 * `adapter.requestDevice()` — 300–430 ms of the Odyssey startup's `renderer` bucket, and the same
 * wait before any WebGPU theme's first frame. None of it depends on the mode, the scene or the
 * settings, so it can happen while the player is still looking at the menu. r185 takes an injected
 * device (`WebGPUBackend.init`: `if (parameters.device === undefined) { …requestAdapter… } else
 * { device = parameters.device }`), and only destroys the device it created itself
 * (`dispose()` guards on `parameters.device === undefined`) — so the caller owns an injected one,
 * which is exactly what lets it outlive a board and be reused on re-entry.
 *
 * The descriptor MUST match what three would have asked for, or the renderer gets a different
 * device than the code expects: `featureLevel: 'compatibility'`, every feature the adapter
 * supports (three passes all of them, and `core-features-and-limits` is what decides
 * `compatibilityMode`, i.e. whether MSAA is available), and the same `powerPreference`.
 *
 * A lost device drops out of the cache so the next caller requests a fresh one.
 */

/** @type {?{promise: Promise<?GPUDevice>, device: ?GPUDevice, powerPreference: string, ms: number}} */
let warmed = null;

function hasWebGpu() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Start (or join) a device request. Safe to call before anything else exists; resolves to null
 * when WebGPU is unavailable or the request fails, so callers can always fall back to letting
 * three request its own.
 * @param {{powerPreference?: 'high-performance'|'low-power'}} [options]
 * @returns {Promise<?GPUDevice>}
 */
export function warmWebGpuDevice({ powerPreference = 'high-performance' } = {}) {
    if (!hasWebGpu()) return Promise.resolve(null);
    // A device is requested for ONE power preference; a caller that wants the other one gets its
    // own (the low-power lane is a diagnostic flag, not a shipping path).
    if (warmed && warmed.powerPreference !== powerPreference) return Promise.resolve(null);
    if (warmed) return warmed.promise;

    const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
    const promise = (async () => {
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference,
            featureLevel: 'compatibility',
            xrCompatible: false,
        });
        if (!adapter) return null;
        const requiredFeatures = [];
        adapter.features.forEach((name) => requiredFeatures.push(name));
        const device = await adapter.requestDevice({ requiredFeatures });
        device.lost?.then(() => {
            if (warmed?.device === device) warmed = null; // next caller requests a fresh one
        });
        return device;
    })().then((device) => {
        if (warmed) {
            warmed.device = device;
            warmed.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - startedAt);
        }
        return device;
    }).catch((error) => {
        console.warn('[gpu] device warm failed; the renderer will request its own:', error?.message || error);
        warmed = null;
        return null;
    });

    warmed = {
        promise, device: null, powerPreference, ms: 0,
    };
    return promise;
}

/**
 * The warmed device if one is ready, else null — never waits.
 * @param {{powerPreference?: string}} [options]
 * @returns {?GPUDevice}
 */
export function getWarmWebGpuDevice({ powerPreference = 'high-performance' } = {}) {
    if (!warmed || warmed.powerPreference !== powerPreference) return null;
    return warmed.device;
}

/** How long the warm took, for the startup trace. */
export function warmWebGpuDeviceMs() {
    return warmed?.ms ?? null;
}

/** Test hook: forget the cache (does not destroy the device). */
export function resetWarmWebGpuDeviceForTests() {
    warmed = null;
}
