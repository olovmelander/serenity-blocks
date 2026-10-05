import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import OceanTheme from '../../src/themes/ocean/ocean-theme.js';
import IceTempleTheme from '../../src/themes/ice-temple/ice-temple-theme.js';
import { gpuResilience } from '../../src/utils/gpu-context-resilience.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const state = vi.hoisted(() => ({ owners: [] }));
vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({
    disposeOceanGltfCache: vi.fn(), loadGltfCached: vi.fn(),
}));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGPURenderer: class {
            constructor(options) {
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL ? { isWebGLBackend: true } : { isWebGPUBackend: true };
                this.backend.gl = { isContextLost: () => this._isDeviceLost === true };
                const device = new EventTarget();
                device.lost = new Promise((resolve) => { device.lose = resolve; });
                this.backend.device = device;
                this.capabilities = { maxColorAttachments: 8 };
                this.domElement = new EventTarget();
                this.domElement.style = {};
                this.onDeviceLost = vi.fn(() => { this._isDeviceLost = true; });
                const backendLoss = (event) => {
                    event.preventDefault();
                    this.onDeviceLost({ api: 'WebGL', originalEvent: event });
                };
                if (this.backend.isWebGLBackend) this.domElement.addEventListener('webglcontextlost', backendLoss);
                this.init = vi.fn();
                this.dispose = vi.fn(() => {
                    this.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
                    this.domElement.removeEventListener('webglcontextlost', backendLoss);
                });
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
            }
        },
    };
});

async function startRendererOnly(Theme, native = false) {
    vi.stubGlobal('navigator', native ? { gpu: {} } : {});
    const theme = new Theme();
    theme.applyQualityPreset('Low');
    state.owners.push(theme);
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        await renderer.init();
        return renderer;
    });
    vi.spyOn(theme, 'disposeRenderer');
    vi.spyOn(theme, 'createScene').mockImplementation(async (generation) => {
        await theme.initRenderer({ appendChild: vi.fn() }, generation);
        if (Theme === IceTempleTheme) theme.setupRendererResilience();
    });
    await theme.start({ loadTheme: vi.fn() });
    return theme;
}

beforeEach(() => {
    state.owners.length = 0;
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 2,
        location: { search: '' },
        settings: { effectQuality: 'Low' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        cancelAnimationFrame: vi.fn(),
    });
    vi.stubGlobal('document', {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    state.owners.forEach((theme) => {
        theme.stop();
        theme._contextRestoreUnsub?.();
        theme._contextRestoreUnsub = null;
    });
    gpuResilience.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const themes = [['Ocean', OceanTheme], ['Ice Temple', IceTempleTheme]];
describe.each(themes)('%s portable context recovery', (_name, Theme) => {
    it.each([false, true])('registers the backend and detaches before disposal (native=%s)', async (native) => {
        const canvasMonitor = vi.spyOn(gpuResilience, 'monitorWebGL');
        const deviceMonitor = vi.spyOn(gpuResilience, 'monitorWebGPU');
        const theme = await startRendererOnly(Theme, native);
        const { renderer } = theme;
        expect(canvasMonitor).toHaveBeenCalledWith(renderer.domElement, expect.objectContaining({ label: theme.name }));
        if (native) {
            expect(deviceMonitor).toHaveBeenCalledWith(
                renderer.backend.device,
                expect.objectContaining({ label: theme.name }),
            );
        } else {
            expect(deviceMonitor).not.toHaveBeenCalled();
        }

        const emit = vi.spyOn(eventBus, 'emit');
        const loss = new Event('webglcontextlost', { cancelable: true });
        expect(typeof renderer.onDeviceLost).toBe('function');
        renderer.domElement.dispatchEvent(loss);
        expect(loss.defaultPrevented).toBe(true);
        if (!native) expect(renderer._isDeviceLost).toBe(true);
        expect(emit).toHaveBeenCalledWith(EVENTS.CONTEXT_LOST, expect.objectContaining({ label: theme.name }));
        emit.mockClear();
        theme.stop();
        renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
        renderer.backend.device.lose({ reason: 'destroyed' });
        await Promise.resolve();
        expect(emit).not.toHaveBeenCalled();
        expect(theme._resilienceUnsubs).toBeNull();
    });

    it('rebuilds a fresh node WebGL2 renderer on restore and ignores the retired canvas', async () => {
        const theme = await startRendererOnly(Theme);
        const retired = theme.renderer;
        retired.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        expect(retired.dispose).toHaveBeenCalledOnce();
        expect(theme.isActive).toBe(true);
        expect(theme.isPaused).toBe(true);
        retired.domElement.dispatchEvent(new Event('webglcontextrestored'));
        await vi.waitFor(() => {
            expect(theme.renderer).not.toBe(retired);
            expect(theme.lifecycleState).toBe('running');
        });
        expect(theme.renderer.isWebGPURenderer).toBe(true);
        expect(theme.renderer.backend.isWebGLBackend).toBe(true);
        expect(theme.createScene).toHaveBeenCalledTimes(2);
        expect(retired.dispose).toHaveBeenCalledOnce();

        retired.domElement.dispatchEvent(new Event('webglcontextrestored'));
        await Promise.resolve();
        expect(theme.createScene).toHaveBeenCalledTimes(2);
    });
});

it('preserves Ice Temple native device-loss fallback while detaching it on stop', async () => {
    const theme = await startRendererOnly(IceTempleTheme, true);
    const nativeRenderer = theme.renderer;
    const recover = vi.spyOn(theme, 'handleDeviceLoss').mockResolvedValue();
    nativeRenderer.onDeviceLost({ reason: 'unknown' });
    await Promise.resolve();
    expect(recover).toHaveBeenCalledOnce();
    theme.stop();
    nativeRenderer.onDeviceLost({ reason: 'late-loss' });
    expect(recover).toHaveBeenCalledOnce();
});
