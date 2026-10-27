// @ts-check
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { GPUFeatureName } from '../../node_modules/three/src/renderers/webgpu/utils/WebGPUConstants.js';
import {
    THREE_GPU_FEATURES,
    getThemeDeviceSpareStats,
    injectSpareThemeDevice,
    primeThemeDevice,
    resetThemeDeviceSpareForTests,
} from '../../src/rendering/theme-device-spare.js';

/** A fake adapter/device pair: requestDevice records its descriptor; destroy() marks the device. */
function installFakeGpu() {
    const devices = [];
    const adapter = {
        features: new Set(['core-features-and-limits', 'timestamp-query', 'shader-f16', 'not-a-three-feature']),
        requestDevice: vi.fn(async (desc) => {
            let resolveLost;
            const device = {
                desc,
                destroyed: false,
                lost: new Promise((r) => { resolveLost = r; }),
                destroy() { this.destroyed = true; resolveLost({ reason: 'destroyed' }); },
            };
            devices.push(device);
            return device;
        }),
    };
    const gpu = { requestAdapter: vi.fn(async () => adapter) };
    vi.stubGlobal('navigator', { gpu });
    return { gpu, adapter, devices };
}

/** A WebGPURenderer-shaped object before init(). */
function fakeRenderer({ webgpu = true, params = {} } = {}) {
    const renderer = {
        _initialized: false,
        // three r186's WebGPUBackend constructor defaults requiredLimits to {}.
        backend: { isWebGPUBackend: webgpu, parameters: { powerPreference: 'high-performance', requiredLimits: {}, ...params } },
        disposed: 0,
        dispose() { this.disposed += 1; return Promise.resolve(); },
    };
    return renderer;
}

describe('theme device spare', () => {
    beforeEach(() => { resetThemeDeviceSpareForTests(); });
    afterEach(() => {
        resetThemeDeviceSpareForTests();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('relies on three r186 behaviour that is still there', () => {
        const src = readFileSync(new URL('../../node_modules/three/src/renderers/webgpu/WebGPUBackend.js', import.meta.url), 'utf8');
        // init uses an injected device instead of requesting one…
        expect(src).toContain('if ( parameters.device === undefined ) {');
        expect(src).toContain('device = parameters.device;');
        // …limits default to an empty object (the injection guard reads that as "no limits")…
        expect(src).toContain('this.parameters.requiredLimits = ( parameters.requiredLimits === undefined ) ? {} : parameters.requiredLimits;');
        // …and dispose leaves an injected device alone (the renderer's wrapped dispose destroys it).
        expect(src).toMatch(/if \( this\.parameters\.device === undefined && this\.device !== null \)/);
    });

    it('asks for exactly the features three r186 would ask for', () => {
        expect([...THREE_GPU_FEATURES].sort()).toEqual(Object.values(GPUFeatureName).sort());
    });

    it('hands a primed device to a renderer, which destroys it on dispose', async () => {
        const { gpu, devices } = installFakeGpu();
        await primeThemeDevice();
        expect(gpu.requestAdapter).toHaveBeenCalledWith({
            powerPreference: 'high-performance', featureLevel: 'compatibility', xrCompatible: false,
        });
        expect(devices[0].desc.requiredFeatures.sort()).toEqual(['core-features-and-limits', 'shader-f16', 'timestamp-query']);

        const renderer = fakeRenderer();
        expect(await injectSpareThemeDevice(renderer)).toBe(true);
        expect(renderer.backend.parameters.device).toBe(devices[0]);
        expect(devices[0].destroyed).toBe(false);
        await renderer.dispose();
        await Promise.resolve();
        expect(renderer.disposed).toBe(1);
        expect(devices[0].destroyed).toBe(true);
        expect(getThemeDeviceSpareStats()).toMatchObject({ handedOut: 1, destroyed: 1 });
    });

    it('gives each spare to one renderer only, and refills later', async () => {
        vi.useFakeTimers();
        const { devices } = installFakeGpu();
        await primeThemeDevice();
        const a = fakeRenderer();
        const b = fakeRenderer();
        expect(await injectSpareThemeDevice(a)).toBe(true);
        expect(await injectSpareThemeDevice(b)).toBe(false);
        expect(b.backend.parameters.device).toBeUndefined();
        expect(devices).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(5000);
        expect(devices).toHaveLength(2);
        expect(getThemeDeviceSpareStats().held).toBe(true);
    });

    it('leaves WebGL backends, renderers with their own device or limits, and initialised renderers alone', async () => {
        installFakeGpu();
        await primeThemeDevice();
        expect(await injectSpareThemeDevice(fakeRenderer({ webgpu: false }))).toBe(false);
        expect(await injectSpareThemeDevice(fakeRenderer({ params: { device: {} } }))).toBe(false);
        expect(await injectSpareThemeDevice(fakeRenderer({ params: { requiredLimits: { maxBindGroups: 8 } } }))).toBe(false);
        const initialised = fakeRenderer();
        initialised._initialized = true;
        expect(await injectSpareThemeDevice(initialised)).toBe(false);
        expect(getThemeDeviceSpareStats()).toMatchObject({ handedOut: 0, held: true });
    });

    it('is a no-op without WebGPU', async () => {
        vi.stubGlobal('navigator', {});
        expect(primeThemeDevice()).toBeNull();
        expect(await injectSpareThemeDevice(fakeRenderer())).toBe(false);
    });

    it('drops a spare that is lost while held', async () => {
        const { devices } = installFakeGpu();
        await primeThemeDevice();
        devices[0].destroy();
        await Promise.resolve();
        await Promise.resolve();
        expect(getThemeDeviceSpareStats().held).toBe(false);
        expect(await injectSpareThemeDevice(fakeRenderer())).toBe(false);
    });
});
