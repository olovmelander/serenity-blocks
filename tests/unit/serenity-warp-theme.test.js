import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import SerenityWarpTheme from '../../src/themes/serenity-warp/serenity-warp-theme.js';
import { SERENITY_WARP_TETROMINOS } from '../../src/themes/serenity-warp/serenity-warp-tetrominos.js';
import { getThemeMeta } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const rendererMocks = vi.hoisted(() => ({
    webgpuInstances: [],
    webglInstances: [],
    webgpuInitQueue: [],
    gameplayInstances: [],
    gameplayFactory: vi.fn(),
}));

vi.mock('../../src/themes/serenity-warp/serenity-warp-gameplay-fx.js', () => ({
    createSerenityWarpGameplayFX: (...args) => rendererMocks.gameplayFactory(...args),
}));

function createMockGameplayFx(options) {
    const gameplayFx = {
        options,
        enqueue: vi.fn(),
        update: vi.fn(),
        setQuality: vi.fn(),
        setReducedMotion: vi.fn(),
        setIntensity: vi.fn(),
        dispose: vi.fn(),
    };
    rendererMocks.gameplayInstances.push(gameplayFx);
    return gameplayFx;
}

function createMockVisual(canvas, { webgpu }) {
    const device = webgpu ? {
        lost: new Promise(() => {}),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    } : null;
    return {
        canvas,
        renderer: {
            domElement: canvas,
            backend: webgpu ? { isWebGPUBackend: true, device } : {},
        },
        scene: { children: [] },
        camera: {},
        init: vi.fn(() => {
            const queuedInit = rendererMocks.webgpuInitQueue.shift();
            return queuedInit ? queuedInit() : Promise.resolve(true);
        }),
        getDevice: vi.fn(() => device),
        setPerformanceBudget: vi.fn(),
        setBackgroundMode: vi.fn(),
        setTitleEffectsEnabled: vi.fn(),
        setTetrominoTitleAvoidanceEnabled: vi.fn(),
        setTetrominoRecyclingPolicy: vi.fn(),
        setPhase: vi.fn(),
        setAudioPulse: vi.fn(),
        update: vi.fn(),
        destroy: vi.fn(),
    };
}

vi.mock('../../src/ui/threejs-intro-renderer-webgpu.js', () => ({
    default: function MockIntroWebGPUVisual(canvas) {
        const visual = createMockVisual(canvas, { webgpu: true });
        rendererMocks.webgpuInstances.push(visual);
        return visual;
    },
}));

vi.mock('../../src/ui/threejs-intro-renderer.js', () => ({
    default: function MockIntroWebGLVisual(canvas) {
        const visual = createMockVisual(canvas, { webgpu: false });
        visual.init = vi.fn(() => true);
        rendererMocks.webglInstances.push(visual);
        return visual;
    },
}));

function createFakeDom(search = '', { reducedMotion = false } = {}) {
    const listeners = new Map();
    const mediaListeners = new Map();
    const rafCallbacks = [];
    const children = [];
    const containerStyle = {
        removeProperty(name) {
            delete this[name];
        },
    };
    const classList = {
        add: vi.fn(),
        remove: vi.fn(),
    };
    const container = {
        id: 'serenity-warp-theme',
        style: containerStyle,
        classList,
        children,
        innerHTML: '',
        appendChild(node) {
            node.parentNode = this;
            children.push(node);
            return node;
        },
    };

    const createElement = (tagName) => ({
        tagName: tagName.toUpperCase(),
        id: '',
        className: '',
        style: {},
        parentNode: null,
        setAttribute: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        remove() {
            if (!this.parentNode) return;
            const index = this.parentNode.children.indexOf(this);
            if (index >= 0) this.parentNode.children.splice(index, 1);
            this.parentNode = null;
        },
    });

    vi.stubGlobal('document', {
        getElementById: vi.fn((id) => (id === container.id ? container : null)),
        querySelectorAll: vi.fn(() => [container]),
        createElement,
    });
    vi.stubGlobal('window', {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        location: { search },
        settings: {
            effectQuality: 'High',
            backgroundComboEffects: true,
            pieceLockRipple: true,
        },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn((type) => listeners.delete(type)),
        matchMedia: vi.fn(() => ({
            matches: reducedMotion,
            addEventListener: vi.fn((type, handler) => mediaListeners.set(type, handler)),
            removeEventListener: vi.fn((type) => mediaListeners.delete(type)),
        })),
        isRenderingPaused: false,
        isRenderingReduced: false,
    });
    vi.stubGlobal('navigator', {
        gpu: {},
        deviceMemory: 8,
        hardwareConcurrency: 8,
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        rafCallbacks.push(callback);
        return 40 + rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    return {
        container,
        listeners,
        mediaListeners,
        rafCallbacks,
    };
}

describe('Serenity Warp theme adapter', () => {
    beforeEach(() => {
        rendererMocks.webgpuInstances.length = 0;
        rendererMocks.webglInstances.length = 0;
        rendererMocks.webgpuInitQueue.length = 0;
        rendererMocks.gameplayInstances.length = 0;
        rendererMocks.gameplayFactory.mockReset();
        rendererMocks.gameplayFactory.mockImplementation(createMockGameplayFx);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('is registered as a heavy cosmic Hub theme with a matching icon', () => {
        expect(getThemeMeta('serenity-warp')).toMatchObject({
            displayName: 'Serenity Warp',
            group: 'cosmic',
            performanceClass: 'heavy',
            startupEligible: false,
            icon: './serenity-warp/serenity-warp-theme-icon.png',
        });
    });

    it('adapts the full-bright WebGPU intro without title-only effects', async () => {
        const { container, rafCallbacks } = createFakeDom();
        const theme = new SerenityWarpTheme();

        await theme.start({ loadTheme: vi.fn() });

        const [visual] = rendererMocks.webgpuInstances;
        expect(visual).toBeDefined();
        expect(rendererMocks.webglInstances).toHaveLength(0);
        expect(visual.setPerformanceBudget).toHaveBeenCalledWith('HIGH');
        expect(visual.setBackgroundMode).toHaveBeenCalledWith(false);
        expect(visual.setTitleEffectsEnabled).toHaveBeenCalledWith(false);
        expect(visual.setTetrominoTitleAvoidanceEnabled).toHaveBeenCalledWith(false);
        expect(visual.setTetrominoRecyclingPolicy).toHaveBeenCalledWith({
            mode: 'minimum-residence',
            minimumResidenceMs: 90_000,
        });
        expect(visual.setPhase).toHaveBeenCalledWith('idle', true);
        expect(rendererMocks.gameplayFactory).toHaveBeenCalledWith(expect.objectContaining({
            scene: visual.scene,
            camera: visual.camera,
            isWebGPU: true,
            quality: 'High',
            reducedMotion: false,
            intensity: 1,
        }));
        const [gameplayFx] = rendererMocks.gameplayInstances;
        const controller = theme.gameplayFxController;
        const controllerDispose = vi.spyOn(controller, 'dispose');
        expect(visual.update).not.toHaveBeenCalled();
        rafCallbacks.shift()(1000);
        rafCallbacks.shift()(1016.67);
        expect(visual.update).toHaveBeenCalledTimes(2);
        expect(gameplayFx.update).toHaveBeenCalledTimes(2);
        expect(gameplayFx.update.mock.invocationCallOrder[0])
            .toBeLessThan(visual.update.mock.invocationCallOrder[0]);
        expect(visual.update.mock.calls.every(([time]) => Number.isFinite(time))).toBe(true);
        expect(visual.setAudioPulse.mock.calls.every(([pulse]) => Number.isFinite(pulse))).toBe(true);
        expect(container.children.some((node) => node.id === 'serenity-warp-canvas')).toBe(true);

        theme.cleanup();
        expect(controllerDispose).toHaveBeenCalledTimes(1);
        expect(controllerDispose.mock.invocationCallOrder[0])
            .toBeLessThan(visual.destroy.mock.invocationCallOrder[0]);
        expect(gameplayFx.dispose).toHaveBeenCalledTimes(1);
        expect(gameplayFx.dispose.mock.invocationCallOrder[0])
            .toBeLessThan(visual.destroy.mock.invocationCallOrder[0]);
        expect(visual.destroy).toHaveBeenCalledTimes(1);
        expect(container.children).toHaveLength(0);
    });

    it('turns gameplay events into filtered, frame-drained reaction commands', async () => {
        const { rafCallbacks } = createFakeDom();
        const theme = new SerenityWarpTheme();

        await theme.start({ loadTheme: vi.fn() });
        const [gameplayFx] = rendererMocks.gameplayInstances;
        const lockPayload = {
            player: 'local',
            piece: {
                shapeKey: 'T',
                color: '#536dff',
                x: 4,
                y: 17,
                shape: [[1, 1, 1], [0, 1, 0]],
            },
        };

        eventBus.emit(EVENTS.PIECE_LOCK, lockPayload);
        eventBus.emit(EVENTS.LINE_CLEAR, {
            player: 'local',
            lineCount: 2,
            clearedRows: [18, 19],
            cascadeCount: 1,
        });
        eventBus.emit(EVENTS.COMBO, { player: 'local', comboCount: 2 });
        eventBus.emit(EVENTS.TSPIN, { player: 'local', lineCount: 2 });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { player: 'local' });
        eventBus.emit(EVENTS.B2B, { player: 'local', active: true });

        expect(gameplayFx.enqueue).not.toHaveBeenCalled();
        rafCallbacks.shift()(1000);

        expect(gameplayFx.enqueue.mock.calls.map(([command]) => command.type)).toEqual([
            'phase-seal',
            'line-clear',
            'spectrum-gate',
            'mobius-twist',
            'perfect-clear',
            'b2b-echo',
        ]);

        window.settings.pieceLockRipple = false;
        eventBus.emit(EVENTS.PIECE_LOCK, {
            ...lockPayload,
            piece: { ...lockPayload.piece, x: 0, y: 8 },
        });
        eventBus.emit(EVENTS.LINE_CLEAR, {
            player: 'local',
            lineCount: 1,
            clearedRows: [9],
            cascadeCount: 1,
        });
        rafCallbacks.shift()(1016.67);
        const secondFrameTypes = gameplayFx.enqueue.mock.calls.slice(6)
            .map(([command]) => command.type);
        expect(secondFrameTypes).toEqual(['line-clear']);
        expect(gameplayFx.enqueue.mock.calls[6][0].origin.sideLane.side).toBe('left');

        window.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.PIECE_LOCK, {
            ...lockPayload,
            piece: { ...lockPayload.piece, x: 1, y: 5 },
        });
        eventBus.emit(EVENTS.TSPIN, { player: 'local', lineCount: 1 });
        rafCallbacks.shift()(1033.34);
        expect(gameplayFx.enqueue).toHaveBeenCalledTimes(7);

        theme.cleanup();
    });

    it('applies live quality, effect, and reduced-motion settings', async () => {
        const {
            listeners,
            mediaListeners,
        } = createFakeDom();
        const theme = new SerenityWarpTheme();

        await theme.start({ loadTheme: vi.fn() });
        const [visual] = rendererMocks.webgpuInstances;
        const [gameplayFx] = rendererMocks.gameplayInstances;

        window.settings.effectQuality = 'Low';
        window.settings.backgroundComboEffects = false;
        window.settings.reducedMotion = true;
        listeners.get('settingsChanged')?.({ detail: { effectQuality: 'Low' } });

        expect(visual.setPerformanceBudget).toHaveBeenLastCalledWith('LOW');
        expect(gameplayFx.setQuality).toHaveBeenLastCalledWith('Low');
        expect(gameplayFx.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(gameplayFx.setIntensity).toHaveBeenLastCalledWith(0);

        window.settings.reducedMotion = false;
        const mediaQuery = window.matchMedia.mock.results[0].value;
        mediaQuery.matches = true;
        mediaListeners.get('change')?.({ matches: true });
        expect(gameplayFx.setReducedMotion).toHaveBeenLastCalledWith(true);

        theme.cleanup();
        expect(mediaQuery.removeEventListener).toHaveBeenCalledWith(
            'change',
            expect.any(Function),
            undefined,
        );
    });

    it('uses a fresh canvas for the WebGL2 fallback and disposes it once', async () => {
        const { container } = createFakeDom('?forceWebGL=1');
        const theme = new SerenityWarpTheme();

        await theme.start({ loadTheme: vi.fn() });

        expect(rendererMocks.webgpuInstances).toHaveLength(0);
        const [visual] = rendererMocks.webglInstances;
        expect(visual).toBeDefined();
        expect(theme.isWebGPU).toBe(false);
        expect(container.children.filter((node) => node.tagName === 'CANVAS')).toHaveLength(1);

        theme.stop();
        theme.cleanup();
        expect(visual.destroy).toHaveBeenCalledTimes(1);
        expect(container.children).toHaveLength(0);
    });

    it('keeps the ambient renderer alive when gameplay FX cannot initialize', async () => {
        const { rafCallbacks } = createFakeDom();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        rendererMocks.gameplayFactory.mockImplementationOnce(() => {
            throw new Error('mock gameplay pipeline failure');
        });
        const theme = new SerenityWarpTheme();

        await expect(theme.start({ loadTheme: vi.fn() })).resolves.toBeUndefined();
        const [visual] = rendererMocks.webgpuInstances;
        expect(theme.gameplayFx).toBeNull();

        eventBus.emit(EVENTS.PIECE_LOCK, {
            piece: {
                shapeKey: 'O',
                x: 4,
                y: 18,
                shape: [[1, 1], [1, 1]],
            },
        });
        rafCallbacks.shift()(1000);
        expect(visual.update).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Gameplay FX unavailable'),
            expect.any(Error),
        );

        theme.cleanup();
        expect(visual.destroy).toHaveBeenCalledTimes(1);
    });

    it('requests a full restart when a stopped runtime cannot be resumed', async () => {
        createFakeDom();
        const theme = new SerenityWarpTheme();

        await theme.start({ loadTheme: vi.fn() });
        theme.stop();

        expect(theme.visual).toBeNull();
        expect(theme.renderer).toBeNull();
        expect(theme.resume()).toBe(false);
        expect(theme.isActive).toBe(false);

        theme.cleanup();
    });

    it('rejects a stale WebGPU build instead of replacing the current scene', async () => {
        const { container } = createFakeDom();
        let resolveFirstInit;
        rendererMocks.webgpuInitQueue.push(
            () => new Promise((resolve) => { resolveFirstInit = resolve; }),
            () => Promise.resolve(true),
        );
        const theme = new SerenityWarpTheme();

        const staleStart = theme.start({ loadTheme: vi.fn() });
        await vi.waitFor(() => expect(rendererMocks.webgpuInstances).toHaveLength(1));
        theme.stop();
        await theme.start({ loadTheme: vi.fn() });

        const [staleVisual, currentVisual] = rendererMocks.webgpuInstances;
        expect(theme.visual).toBe(currentVisual);
        resolveFirstInit(true);
        await staleStart;

        expect(staleVisual.destroy).toHaveBeenCalledTimes(1);
        expect(currentVisual.destroy).not.toHaveBeenCalled();
        expect(theme.visual).toBe(currentVisual);
        expect(container.children.filter((node) => node.id === 'serenity-warp-canvas')).toHaveLength(1);

        theme.cleanup();
    });

    it('exports gameplay colors that match the floating intro pieces', () => {
        expect(SERENITY_WARP_TETROMINOS.colors).toMatchObject({
            I: '#52ef32',
            O: '#ffa31a',
            T: '#536dff',
            S: '#35e6ef',
            Z: '#ff3b30',
            J: '#ffe23d',
            L: '#d33bea',
        });
        expect(SERENITY_WARP_TETROMINOS.renderMode).toBe('glow');
    });
});
