import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import BlackHoleTheme from '../../src/themes/black-hole/black-hole-theme.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function createRunningTheme(renderer) {
    const theme = new BlackHoleTheme();
    theme.renderer = renderer;
    theme.isActive = true;
    theme.lifecycleState = 'running';
    theme.gpuTimings.enabled = true;
    theme.gpuTimings.lastResolve = 0;
    return theme;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Black Hole lifecycle ownership', () => {
    it('retires a compute timestamp result that resolves after renderer teardown', async () => {
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
        vi.spyOn(performance, 'now').mockReturnValue(1000);

        const query = deferred();
        const backend = {
            getTimestamp: vi.fn(),
            getTimestampUID: vi.fn(),
            hasTimestamp: vi.fn(),
            trackTimestamp: true,
        };
        const renderer = {
            backend,
            resolveTimestampsAsync: vi.fn(() => query.promise),
        };
        const theme = createRunningTheme(renderer);
        theme.particleCompute = { computeNode: {} };

        const update = theme.updateGpuTimings();
        expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);

        theme.stop();
        theme.renderer = null;
        query.resolve();

        await expect(update).resolves.toBeUndefined();
        expect(backend.getTimestampUID).not.toHaveBeenCalled();
        expect(theme.gpuTimings.compute).toEqual({});
        expect(theme.gpuTimings.enabled).toBe(false);
    });

    it('does not publish a render timestamp into a later lifecycle generation', async () => {
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });

        const query = deferred();
        const renderer = {
            backend: { trackTimestamp: true },
            resolveTimestampsAsync: vi.fn(() => query.promise),
        };
        const theme = createRunningTheme(renderer);
        theme.time = 1;

        theme.sampleRenderGpuTiming();
        expect(theme.gpuTimings.renderPending).toBe(true);

        theme.stop();
        theme.renderer = null;
        query.resolve(12);
        await query.promise;
        await Promise.resolve();

        expect(theme.dynamicResolution.gpu.valid).toBe(false);
        expect(theme.gpuTimings.renderPending).toBe(false);
    });
});
