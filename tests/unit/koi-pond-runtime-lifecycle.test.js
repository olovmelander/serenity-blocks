import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { createKoiPondRuntime } from '../../src/themes/koi-pond/rendering/koi-pond-runtime.js';

const subsystemMocks = vi.hoisted(() => ({
    cameraFactory: vi.fn(),
    waterFactory: vi.fn(),
    landscapeFactory: vi.fn(),
    routingFactory: vi.fn(),
    gameplayFactory: vi.fn(),
}));

vi.mock('../../src/themes/koi-pond/rendering/koi-pond-camera.js', () => ({
    createKoiPondCameraDirector: (...args) => subsystemMocks.cameraFactory(...args),
}));

vi.mock('../../src/themes/koi-pond/rendering/koi-pond-water.js', () => ({
    createKoiPondWater: (...args) => subsystemMocks.waterFactory(...args),
}));

vi.mock('../../src/themes/koi-pond/rendering/koi-pond-landscape.js', () => ({
    createKoiPondLandscape: (...args) => subsystemMocks.landscapeFactory(...args),
}));

vi.mock('../../src/themes/koi-pond/koi-pond-gameplay-routing.js', () => ({
    KoiPondGameplayRouting: class MockKoiPondGameplayRouting {
        constructor(...args) {
            Object.assign(this, subsystemMocks.routingFactory(...args));
        }
    },
}));

vi.mock('../../src/themes/koi-pond/rendering/koi-pond-gameplay-fx.js', () => ({
    createKoiPondGameplayFX: (...args) => subsystemMocks.gameplayFactory(...args),
}));

vi.mock('../../src/themes/koi-pond/rendering/koi-pond-layout.js', () => ({
    KOI_POND_LAYOUT: {
        gameplayCenter: { x: 0, z: 0 },
        gameplayRadii: { x: 8, z: 5 },
    },
    mapKoiPondSideLaneToWorld: (origin) => origin,
    normalizeKoiPondQuality: (value) => value || 'High',
}));

function createWater(dispose) {
    return {
        camera: vi.fn(),
        dispose,
        getDiagnostics: vi.fn(() => ({})),
        resize: vi.fn(),
        setReducedMotion: vi.fn(),
        update: vi.fn(),
    };
}

function createCameraDirector(dispose) {
    return {
        apply: vi.fn(),
        dispose,
        getDiagnostics: vi.fn(() => ({})),
        reset: vi.fn(),
        setPointer: vi.fn(),
        setReducedMotion: vi.fn(),
        update: vi.fn(),
    };
}

function createLandscape(dispose) {
    return {
        dispose,
        getActiveParticleCount: vi.fn(() => 0),
        getDiagnostics: vi.fn(() => ({})),
        pulse: vi.fn(),
        setIntensity: vi.fn(),
        setQuality: vi.fn(),
        setReducedMotion: vi.fn(),
        update: vi.fn(),
    };
}

function createRouting(dispose) {
    return {
        dispatch: vi.fn(),
        dispose,
        drainCommands: vi.fn(() => []),
        getState: vi.fn(() => ({})),
        setIntensityMultiplier: vi.fn(),
        setReducedMotion: vi.fn(),
    };
}

function createGameplayFx(dispose) {
    return {
        dispose,
        enqueue: vi.fn(),
        getActiveParticleCount: vi.fn(() => 0),
        getDebugState: vi.fn(() => ({
            activeDraws: 0,
            activeInstances: 0,
            submittedInstances: 0,
        })),
        hasActiveEffects: vi.fn(() => false),
        prepareForCompile: vi.fn(() => () => {}),
        setIntensity: vi.fn(),
        setQuality: vi.fn(),
        setReducedMotion: vi.fn(),
        update: vi.fn(),
    };
}

function createDependencies(disposalOrder = []) {
    const cameraDirector = createCameraDirector(
        vi.fn(() => disposalOrder.push('camera')),
    );
    const water = createWater(vi.fn(() => disposalOrder.push('water')));
    const landscape = createLandscape(vi.fn(() => disposalOrder.push('landscape')));
    const routing = createRouting(vi.fn(() => disposalOrder.push('routing')));
    const gameplayFx = createGameplayFx(vi.fn(() => disposalOrder.push('gameplay')));
    subsystemMocks.cameraFactory.mockReturnValue(cameraDirector);
    subsystemMocks.waterFactory.mockReturnValue(water);
    subsystemMocks.landscapeFactory.mockReturnValue(landscape);
    subsystemMocks.routingFactory.mockReturnValue(routing);
    subsystemMocks.gameplayFactory.mockReturnValue(gameplayFx);
    return {
        cameraDirector,
        gameplayFx,
        landscape,
        routing,
        water,
    };
}

function createRuntimeOptions() {
    return {
        scene: { add: vi.fn() },
        camera: {},
        renderer: {
            backend: { isWebGPUBackend: true },
            info: {
                memory: {},
                render: {},
            },
        },
        params: new URLSearchParams(),
        quality: 'High',
    };
}

describe('Koi Pond runtime lifecycle', () => {
    beforeEach(() => {
        Object.values(subsystemMocks).forEach((mock) => mock.mockReset());
    });

    afterEach(() => {
        delete globalThis.window;
    });

    it('rolls back earlier subsystems when landscape construction fails', () => {
        const disposalOrder = [];
        const { water } = createDependencies(disposalOrder);
        const failure = new Error('landscape failed');
        subsystemMocks.landscapeFactory.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => createKoiPondRuntime(createRuntimeOptions())).toThrow(failure);
        expect(water.dispose).toHaveBeenCalledTimes(1);
        expect(disposalOrder).toEqual(['water', 'camera']);
        expect(subsystemMocks.routingFactory).not.toHaveBeenCalled();
        expect(subsystemMocks.gameplayFactory).not.toHaveBeenCalled();
    });

    it('rolls back every completed subsystem in reverse order on a late failure', () => {
        const disposalOrder = [];
        const {
            landscape,
            routing,
            water,
        } = createDependencies(disposalOrder);
        const failure = new Error('gameplay failed');
        subsystemMocks.gameplayFactory.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => createKoiPondRuntime(createRuntimeOptions())).toThrow(failure);
        expect(routing.dispose).toHaveBeenCalledTimes(1);
        expect(landscape.dispose).toHaveBeenCalledTimes(1);
        expect(water.dispose).toHaveBeenCalledTimes(1);
        expect(disposalOrder).toEqual(['routing', 'landscape', 'water', 'camera']);
    });

    it('disposes a completed runtime exactly once in reverse dependency order', () => {
        const disposalOrder = [];
        const {
            gameplayFx,
            landscape,
            routing,
            water,
        } = createDependencies(disposalOrder);
        vi.stubGlobal('window', {});
        const runtime = createKoiPondRuntime(createRuntimeOptions());

        expect(window.__KOI_POND_RUNTIME__).toBeDefined();
        runtime.dispose();
        runtime.dispose();

        expect(gameplayFx.dispose).toHaveBeenCalledTimes(1);
        expect(routing.dispose).toHaveBeenCalledTimes(1);
        expect(landscape.dispose).toHaveBeenCalledTimes(1);
        expect(water.dispose).toHaveBeenCalledTimes(1);
        expect(disposalOrder).toEqual([
            'gameplay',
            'routing',
            'landscape',
            'water',
            'camera',
        ]);
        expect(window.__KOI_POND_RUNTIME__).toBeUndefined();
    });

    it('continues disposing later subsystems after one cleanup fails', () => {
        const disposalOrder = [];
        const {
            gameplayFx,
            landscape,
            routing,
            water,
        } = createDependencies(disposalOrder);
        gameplayFx.dispose.mockImplementationOnce(() => {
            disposalOrder.push('gameplay');
            throw new Error('gameplay cleanup failed');
        });
        const runtime = createKoiPondRuntime(createRuntimeOptions());

        expect(() => runtime.dispose()).toThrow(AggregateError);
        expect(gameplayFx.dispose).toHaveBeenCalledTimes(1);
        expect(routing.dispose).toHaveBeenCalledTimes(1);
        expect(landscape.dispose).toHaveBeenCalledTimes(1);
        expect(water.dispose).toHaveBeenCalledTimes(1);
        expect(disposalOrder).toEqual([
            'gameplay',
            'routing',
            'landscape',
            'water',
            'camera',
        ]);
    });

    it('treats render quality as construction-immutable and requests a rebuild', () => {
        const {
            gameplayFx,
            landscape,
        } = createDependencies();
        const runtime = createKoiPondRuntime(createRuntimeOptions());

        expect(runtime.setQuality('Low')).toBe(true);
        expect(runtime.getDiagnostics()).toMatchObject({
            quality: 'High',
            requestedQuality: 'Low',
            requiresRebuild: true,
        });
        expect(landscape.setQuality).not.toHaveBeenCalled();
        expect(gameplayFx.setQuality).not.toHaveBeenCalled();

        expect(runtime.setQuality('High')).toBe(false);
        expect(runtime.getDiagnostics()).toMatchObject({
            quality: 'High',
            requestedQuality: 'High',
            requiresRebuild: false,
        });
    });

    it('applies continuous intensity once while retaining a zero-work routing gate', () => {
        const {
            gameplayFx,
            landscape,
            routing,
        } = createDependencies();
        const runtime = createKoiPondRuntime({
            ...createRuntimeOptions(),
            intensity: 0.5,
        });

        expect(subsystemMocks.routingFactory).toHaveBeenCalledWith(
            expect.objectContaining({ intensityMultiplier: 1 }),
        );
        expect(subsystemMocks.gameplayFactory).toHaveBeenCalledWith(
            expect.objectContaining({ intensity: 0.5 }),
        );

        runtime.configureGameplay({ intensity: 0.25 });
        expect(routing.setIntensityMultiplier).toHaveBeenLastCalledWith(1);
        expect(gameplayFx.setIntensity).toHaveBeenLastCalledWith(0.25);
        expect(landscape.setIntensity).toHaveBeenLastCalledWith(0.25);

        runtime.configureGameplay({ intensity: 0 });
        expect(routing.setIntensityMultiplier).toHaveBeenLastCalledWith(0);
        expect(gameplayFx.setIntensity).toHaveBeenLastCalledWith(0);
        expect(landscape.setIntensity).toHaveBeenLastCalledWith(0);
    });
});
