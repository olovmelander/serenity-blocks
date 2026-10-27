// @ts-check
/**
 * A spare GPUDevice for the next theme start.
 *
 * WHY. Every theme builds its own WebGPURenderer, and `renderer.init()` starts with
 * `navigator.gpu.requestAdapter()` + `adapter.requestDevice()`: 150-500 ms on the critical path of
 * every theme opening, before the theme can upload or draw anything (2026-10-27 fleet bench on an
 * RTX 5080 laptop: adapter 107-230 ms, device 33-287 ms). None of it depends on the theme, so the
 * device can be asked for while the player is still looking at the previous theme.
 *
 * WHAT. One device is requested ahead of time with the descriptor three would have used
 * (WebGPUBackend.init, r186: `powerPreference`, `featureLevel: 'compatibility'`, every supported
 * feature, no limits). `injectSpareThemeDevice(renderer)` hands it to a renderer that has not been
 * initialised yet, through the backend's `parameters.device` (the documented injection seam: init
 * uses `parameters.device` when it is set). Ownership does not change: the renderer that takes the
 * device is its only user, and its `dispose()` destroys it afterwards, as three destroys a device it
 * created itself (WebGPUBackend.dispose guards on `parameters.device === undefined`). So a theme
 * still gets a fresh device per start and frees everything with it; only the wait moves earlier.
 * A refill is requested a few seconds after each hand-over, so it never competes with the
 * incoming theme's own GPU work.
 *
 * Not for the shared warm device (webgpu-device-warm.js, Odyssey), which is never destroyed.
 * Rollback: ?themeDeviceSpare=0 (or localStorage serenity.themeDeviceSpare=0).
 */
import { readFlag } from '../core/flags.js';

/** Wait after a hand-over before requesting the next spare (the incoming theme compiles meanwhile). */
const REFILL_DELAY_MS = 4000;
/** A spare still being requested is worth waiting for this long (it started earlier than a new one). */
const PENDING_WAIT_MS = 1500;

// The project carries no WebGPU type definitions: devices and adapters are typed `any` here.
/** @typedef {{ promise: Promise<any>, device: any, powerPreference: string }} Spare */

/** @type {?Spare} */
let spare = null;
let refillTimer = null;
const stats = {
    requested: 0, handedOut: 0, missed: 0, lost: 0, destroyed: 0,
};

/** @returns {any} navigator.gpu, or undefined */
function gpuOf() {
    return typeof navigator === 'undefined' ? undefined : /** @type {any} */ (navigator).gpu;
}

function enabled() {
    return typeof navigator !== 'undefined' && !!gpuOf() && readFlag('themeDeviceSpare', true);
}

/**
 * three r186's GPUFeatureName values (src/renderers/webgpu/utils/WebGPUConstants.js, not exported
 * from 'three/webgpu'). WebGPUBackend.init requests exactly those the adapter supports; the spare
 * asks for the same set, so a theme gets the device its own init would have made.
 * tests/unit/theme-device-spare.test.js keeps this list equal to three's.
 */
export const THREE_GPU_FEATURES = Object.freeze([
    'core-features-and-limits', 'depth-clip-control', 'depth32float-stencil8', 'texture-compression-bc',
    'texture-compression-bc-sliced-3d', 'texture-compression-etc2', 'texture-compression-astc',
    'texture-compression-astc-sliced-3d', 'timestamp-query', 'indirect-first-instance', 'shader-f16',
    'rg11b10ufloat-renderable', 'bgra8unorm-storage', 'float32-filterable', 'float32-blendable',
    'clip-distances', 'dual-source-blending', 'subgroups', 'texture-formats-tier1', 'texture-formats-tier2',
]);

/**
 * @param {any} adapter a GPUAdapter
 * @returns {string[]} the features three would request on this adapter
 */
function threeFeatureList(adapter) {
    return THREE_GPU_FEATURES.filter((name) => adapter.features.has(name));
}

/**
 * Request a spare now, unless one is held or on its way.
 * @param {{ powerPreference?: 'high-performance'|'low-power' }} [options]
 * @returns {?Promise<any>} the spare GPUDevice (or null)
 */
export function primeThemeDevice({ powerPreference = 'high-performance' } = {}) {
    if (!enabled()) return null;
    if (spare) return spare.promise;
    stats.requested += 1;
    /** @type {Spare} */
    const entry = { promise: /** @type {any} */ (null), device: null, powerPreference };
    entry.promise = (async () => {
        const adapter = await gpuOf().requestAdapter({
            powerPreference,
            featureLevel: 'compatibility',
            xrCompatible: false,
        });
        if (!adapter) return null;
        const device = await adapter.requestDevice({ requiredFeatures: /** @type {any} */ (threeFeatureList(adapter)) });
        device.lost?.then(() => {
            if (spare?.device === device) {
                spare = null;
                stats.lost += 1;
            }
        });
        return device;
    })().then((device) => {
        if (spare === entry) entry.device = device;
        else if (device) device.destroy(); // superseded while in flight: nobody will take it
        if (!device && spare === entry) spare = null;
        return device;
    }).catch((error) => {
        if (spare === entry) spare = null;
        console.warn('[gpu] spare theme device request failed; themes request their own:', error?.message || error);
        return null;
    });
    spare = entry;
    return entry.promise;
}

function scheduleRefill(powerPreference) {
    if (refillTimer !== null) return;
    refillTimer = setTimeout(() => {
        refillTimer = null;
        primeThemeDevice({ powerPreference });
    }, REFILL_DELAY_MS);
}

/**
 * Take the spare (waiting briefly for one in flight), or null.
 * @param {string} powerPreference
 * @returns {Promise<any>} a GPUDevice, or null
 */
async function takeSpare(powerPreference) {
    const entry = spare;
    if (!entry || entry.powerPreference !== powerPreference) return null;
    let { device } = entry;
    if (!device) {
        device = await Promise.race([
            entry.promise,
            new Promise((resolve) => { setTimeout(() => resolve(null), PENDING_WAIT_MS); }),
        ]);
    }
    // Someone else may have taken it while we waited.
    if (!device || spare !== entry) return null;
    spare = null;
    return device;
}

/**
 * Give a not-yet-initialised WebGPU renderer the spare device, and make its dispose() destroy it.
 * A no-op (false) for a WebGL backend, a renderer that brings its own device or limits, an
 * initialised renderer, or when no spare is ready.
 * @param {any} renderer a WebGPURenderer before init()
 * @returns {Promise<boolean>} whether a device was injected
 */
export async function injectSpareThemeDevice(renderer) {
    const backend = renderer?.backend;
    if (!enabled() || !backend || backend.isWebGPUBackend !== true) return false;
    const params = backend.parameters;
    if (!params || params.device !== undefined) return false;
    // three defaults requiredLimits to {} (WebGPUBackend constructor); only real limits need their own device.
    const limits = params.requiredLimits;
    if (limits && typeof limits === 'object' && Object.keys(limits).length > 0) return false;
    if (renderer._initialized === true || typeof renderer.dispose !== 'function') return false;
    const powerPreference = params.powerPreference || 'high-performance';
    const device = await takeSpare(powerPreference);
    if (!device) {
        // This renderer requests its own; the next theme start finds a spare.
        stats.missed += 1;
        scheduleRefill(powerPreference);
        return false;
    }
    params.device = device;
    stats.handedOut += 1;
    const dispose = renderer.dispose.bind(renderer);
    renderer.dispose = function disposeWithSpareDevice(...args) {
        const result = dispose(...args);
        const destroy = () => {
            try {
                device.destroy();
                stats.destroyed += 1;
            } catch (error) { /* already gone */ }
        };
        if (typeof result?.then === 'function') Promise.resolve(result).finally(destroy);
        else destroy();
        return result;
    };
    scheduleRefill(powerPreference);
    return true;
}

/** Counters for diagnostics and tests. */
export function getThemeDeviceSpareStats() {
    return { ...stats, held: !!spare?.device, pending: !!spare && !spare.device };
}

/** Test seam: drop the held spare (destroying it) and the refill timer. */
export function resetThemeDeviceSpareForTests() {
    if (refillTimer !== null) clearTimeout(refillTimer);
    refillTimer = null;
    const held = spare?.device;
    spare = null;
    try { held?.destroy(); } catch (error) { /* gone */ }
    for (const key of Object.keys(stats)) stats[key] = 0;
}
