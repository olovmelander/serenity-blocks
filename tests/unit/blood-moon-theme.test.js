import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import BloodMoonTheme from '../../src/themes/blood-moon/blood-moon-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const mocks = vi.hoisted(() => ({ renderers: [], options: [], create: vi.fn() }));
vi.mock('three/webgpu', async (original) => ({
    ...await original(),
    WebGPURenderer: class {
        constructor(options) {
            mocks.options.push(options);
            const candidate = mocks.renderers.shift();
            if (!candidate) throw new Error('Unexpected renderer allocation');
            // The constructor seam hands the wrapper an independently controlled candidate.
            // eslint-disable-next-line no-constructor-return
            return candidate;
        }
    },
}));
vi.mock('../../src/playground/effects/blood-moon.effect.js', () => ({ create: mocks.create }));
vi.mock('../../src/utils/viewport.js', () => ({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }),
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function until(predicate) {
    // Advance promise jobs until the mocked lifecycle reaches the requested async boundary.
    // eslint-disable-next-line no-await-in-loop
    for (let i = 0; i < 50 && !predicate(); i++) await Promise.resolve();
    expect(predicate()).toBeTruthy();
}

function eventTarget() {
    const handlers = new Map();
    return {
        addEventListener: vi.fn((key, fn) => {
            if (!handlers.has(key)) handlers.set(key, new Set());
            handlers.get(key).add(fn);
        }),
        removeEventListener: vi.fn((key, fn) => handlers.get(key)?.delete(fn)),
        dispatch(key, detail) { handlers.get(key)?.forEach((fn) => fn({ detail })); },
        count(key) { return handlers.get(key)?.size ?? 0; },
    };
}

function renderer() {
    const domElement = { style: {}, setAttribute: vi.fn(), parentNode: null };
    domElement.remove = vi.fn(() => domElement.parentNode?.removeChild(domElement));
    return {
        domElement,
        backend: { isWebGPUBackend: false },
        init: vi.fn(async () => {}),
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
        setClearColor: vi.fn(),
        setAnimationLoop: vi.fn(),
        dispose: vi.fn(async () => {}),
    };
}

function runtime() {
    return {
        prepare: vi.fn(async () => {}),
        camera: vi.fn(),
        seek: vi.fn(),
        update: vi.fn(),
        render: vi.fn(),
        resize: vi.fn(),
        setLayout: vi.fn(),
        setReducedMotion: vi.fn(),
        setEffectsEnabled: vi.fn(),
        cue: vi.fn(),
        dispose: vi.fn(),
        getDiagnostics: vi.fn(() => ({ loaded: true })),
    };
}

describe('Blood Moon production lifecycle', () => {
    let container;
    let boardNodes;
    let win;
    let media;
    const themes = [];

    function theme() {
        const value = new BloodMoonTheme();
        value.isActive = true;
        value.hasStarted = true;
        value.lifecycleState = 'running';
        vi.spyOn(value, 'setupGpuResilience').mockImplementation(() => {});
        vi.spyOn(value, 'shouldRenderFrame').mockReturnValue(true);
        themes.push(value);
        return value;
    }

    function allocation() {
        const gpu = renderer();
        const scene = runtime();
        mocks.renderers.push(gpu);
        mocks.create.mockReturnValueOnce(scene);
        return { gpu, scene };
    }

    beforeEach(() => {
        mocks.renderers.length = 0;
        mocks.options.length = 0;
        mocks.create.mockReset();
        boardNodes = [];
        media = { ...eventTarget(), matches: false };
        container = {
            children: [],
            style: { removeProperty: vi.fn() },
            classList: { add: vi.fn(), remove: vi.fn() },
            appendChild: vi.fn((node) => { container.children.push(node); node.parentNode = container; }),
            removeChild: vi.fn((node) => {
                container.children = container.children.filter((child) => child !== node);
                node.parentNode = null;
            }),
        };
        win = {
            ...eventTarget(),
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1,
            settings: { effectQuality: 'High' },
            location: { search: '', protocol: 'http:', hostname: 'localhost' },
            matchMedia: vi.fn(() => media),
        };
        vi.stubGlobal('window', win);
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => container),
            querySelectorAll: vi.fn((selector) => (selector === '.theme-container' ? [container] : boardNodes)),
        });
        vi.stubGlobal('navigator', { gpu: null });
        let nextFrame = 0;
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++nextFrame));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        themes.splice(0).forEach((value) => value.cleanup());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('waits for all runtime preparation before publishing ready or starting a loop', async () => {
        const value = theme();
        const { gpu, scene } = allocation();
        const gate = deferred();
        scene.prepare.mockReturnValue(gate.promise);
        const creating = value.createScene();
        await until(() => scene.prepare.mock.calls.length === 1);
        expect(await value.whenCriticalReady()).toBe(false);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        gate.resolve();
        await creating;
        expect(await value.whenCriticalReady()).toBe(true);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(gpu.setPixelRatio).toHaveBeenCalledWith(value.getEffectivePixelRatio());
        expect(value.containers).toEqual([]);
    });

    it('strips preview controls, translates seed and freezes the requested production time', async () => {
        const value = theme();
        const { scene } = allocation();
        win.settings.effectQuality = 'low';
        win.settings.graphicsQuality = 'Extreme';
        win.location.search = '?board=1&event=tetris&eventAge=.5&t=2&bloodMoonTime=8&bloodMoonSeed=71';
        await value.createScene();
        const { params } = mocks.create.mock.calls[0][0];
        expect(params.get('quality')).toBe('Low');
        expect(params.get('seed')).toBe('71');
        for (const key of ['board', 'event', 'eventAge', 't']) expect(params.has(key)).toBe(false);
        value.stepFrame(1000);
        value.stepFrame(2000);
        expect(value.time).toBe(8);
        expect(scene.update).toHaveBeenLastCalledWith(8, 0);
    });

    it('tries native WebGPU then the same renderer with its WebGL2 backend', async () => {
        navigator.gpu = {};
        const value = theme();
        const failed = renderer();
        failed.init.mockRejectedValue(new Error('adapter unavailable'));
        mocks.renderers.push(failed);
        const { gpu } = allocation();
        await value.createScene();
        expect(mocks.options.map((options) => options.forceWebGL)).toEqual([false, true]);
        expect(failed.dispose).toHaveBeenCalled();
        expect(value.renderer).toBe(gpu);
    });

    it('honors forced WebGL2 even when WebGPU exists', async () => {
        navigator.gpu = {};
        win.location.search = '?bloodMoonForceWebGL=1';
        const value = theme();
        allocation();
        await value.createScene();
        expect(mocks.options).toHaveLength(1);
        expect(mocks.options[0].forceWebGL).toBe(true);
    });

    it('does not append a canvas, fall back or revive a stopped renderer initialization', async () => {
        navigator.gpu = {};
        const value = theme();
        const gpu = renderer();
        const gate = deferred();
        gpu.init.mockReturnValue(gate.promise);
        mocks.renderers.push(gpu);
        const creating = value.createScene();
        await until(() => gpu.init.mock.calls.length === 1);
        value.stop();
        gate.resolve();
        await creating;
        expect(container.appendChild).not.toHaveBeenCalled();
        expect(mocks.options).toHaveLength(1);
        expect(gpu.dispose).toHaveBeenCalled();
        expect(value.renderer).toBeNull();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('retires stale preparation without destroying a newer runtime or its device', async () => {
        const value = theme();
        const old = allocation();
        const gate = deferred();
        old.scene.prepare.mockReturnValue(gate.promise);
        const first = value.createScene();
        await until(() => old.scene.prepare.mock.calls.length === 1);
        const next = allocation();
        await value.createScene();
        expect(old.scene.dispose).toHaveBeenCalledTimes(1);
        expect(old.gpu.dispose).not.toHaveBeenCalled();
        expect(old.gpu.domElement.parentNode).toBeNull();
        gate.resolve();
        await first;
        await Promise.resolve();
        expect(old.gpu.dispose).toHaveBeenCalledTimes(1);
        expect(value.runtime).toBe(next.scene);
        expect(value.renderer).toBe(next.gpu);
        expect(next.scene.dispose).not.toHaveBeenCalled();
        expect(next.gpu.dispose).not.toHaveBeenCalled();
        expect(container.children).toEqual([next.gpu.domElement]);
    });

    it('propagates preparation failure after removing the current runtime', async () => {
        const value = theme();
        const { scene, gpu } = allocation();
        scene.prepare.mockRejectedValue(new Error('shader failed'));
        await expect(value.createScene()).rejects.toThrow('shader failed');
        await Promise.resolve();
        expect(value.runtime).toBeNull();
        expect(scene.dispose).toHaveBeenCalledTimes(1);
        expect(gpu.dispose).toHaveBeenCalledTimes(1);
        expect(container.children).toEqual([]);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('coalesces wrapper subscriptions and honors pause, effect and lock settings', async () => {
        const value = theme();
        const { scene } = allocation();
        await value.createScene();
        value.setupListeners();
        const clear = { lineCount: 4, comboCount: 3 };
        eventBus.emit(EVENTS.LINE_CLEAR, clear);
        expect(scene.cue).toHaveBeenCalledExactlyOnceWith('tetris', clear);
        value.pause();
        eventBus.emit(EVENTS.LINE_CLEAR, clear);
        expect(scene.cue).toHaveBeenCalledTimes(1);
        value.resume();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { pieceLockRipple: false } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: {} });
        expect(scene.cue).toHaveBeenCalledTimes(1);
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        expect(scene.cue).toHaveBeenLastCalledWith('tspin', { lineCount: 2 });
        win.dispatch('settingsChanged', { backgroundComboEffects: false });
        expect(scene.setEffectsEnabled).toHaveBeenLastCalledWith(false);
        eventBus.emit(EVENTS.COMBO, { comboCount: 4 });
        expect(scene.cue).toHaveBeenCalledTimes(2);
        win.dispatch('settingsChanged', { reducedMotion: true });
        expect(scene.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(scene.setEffectsEnabled).toHaveBeenLastCalledWith(false);
        expect(win.count('settingsChanged')).toBe(1);
    });

    it('rebuilds content on quality updates with payload precedence and coalesces the rebuild', async () => {
        const value = theme();
        const old = allocation();
        await value.createScene();
        const next = allocation();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'Minimal' });
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { changed: { enableAntialiasing: false } });
        await until(() => value.runtime === next.scene && value.runtimeEntry.ready);
        expect(value.quality).toBe('Minimal');
        expect(mocks.options).toHaveLength(2);
        expect(mocks.options[1].antialias).toBe(false);
        expect(old.scene.dispose).toHaveBeenCalledTimes(1);
        expect(win.settings.effectQuality).toBe('High');
        expect(mocks.create.mock.calls[1][0].params.get('quality')).toBe('Minimal');
    });

    it('keeps one loop after pause/resume and clamps a backgrounded frame delta', async () => {
        const value = theme();
        const { scene } = allocation();
        await value.createScene();
        value.animate();
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        value.stepFrame(1000);
        value.stepFrame(9000);
        expect(scene.update.mock.calls.at(-1)[1]).toBe(0.05);
        value.pause();
        value.stepFrame(10000);
        expect(scene.update).toHaveBeenCalledTimes(2);
        expect(value.resume()).toBe(true);
        value.restartRenderLoop();
        value.restartRenderLoop();
        expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
        value.stepFrame(20000);
        expect(scene.update.mock.calls.at(-1)[1]).toBe(1 / 60);
    });

    it('reads visible board rectangles after a frame boundary and responds to viewport size', async () => {
        const value = theme();
        const { scene, gpu } = allocation();
        const rect = {
            left: 700, top: 100, right: 1220, bottom: 1000, width: 520, height: 900,
        };
        boardNodes = [
            { checkVisibility: () => true, getBoundingClientRect: () => rect },
            { checkVisibility: () => false, getBoundingClientRect: vi.fn() },
        ];
        await value.createScene();
        expect(scene.setLayout).toHaveBeenLastCalledWith([{
            left: 700, top: 100, right: 1220, bottom: 1000,
        }]);
        scene.setLayout.mockClear();
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1200, height: 800 });
        expect(scene.resize).toHaveBeenLastCalledWith(1200, 800);
        expect(gpu.setSize).toHaveBeenLastCalledWith(1200, 800);
        expect(scene.setLayout).not.toHaveBeenCalled();
        value.stepFrame(1000);
        expect(scene.setLayout).toHaveBeenCalledTimes(1);
    });

    it('cleanup is terminal and idempotent while preserving the registry-owned container', async () => {
        const value = theme();
        const { scene, gpu } = allocation();
        await value.createScene();
        value.cleanup();
        value.cleanup();
        value.stop();
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(scene.cue).not.toHaveBeenCalled();
        expect(scene.dispose).toHaveBeenCalledTimes(1);
        expect(gpu.dispose).toHaveBeenCalledTimes(1);
        expect(value.animationIds).toEqual([]);
        expect(value.eventUnsubscribers).toEqual([]);
        expect(value.runtime).toBeNull();
        expect(value.renderer).toBeNull();
        expect(container.children).toEqual([]);
        expect(win.count('settingsChanged')).toBe(0);
        expect(media.count('change')).toBe(0);
        expect(value.cleanupComplete).toBe(true);
    });
});
