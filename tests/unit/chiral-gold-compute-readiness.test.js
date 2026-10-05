import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import ChiralGoldTheme from '../../src/themes/chiral-gold/chiral-gold-theme.js';
import {
    ChiralGoldDustCompute,
    ChiralGoldBurstCompute,
    ChiralGoldWispCompute,
} from '../../src/themes/chiral-gold/chiral-gold-compute.js';

const compile = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../src/rendering/webgpu-compute-pipeline-async.js', () => ({
    compileComputeAsync: compile.run,
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const systems = [
    ['dust', ChiralGoldDustCompute],
    ['burst', ChiralGoldBurstCompute],
    ['wisps', ChiralGoldWispCompute],
];
const activeSystems = [];
function createSystem(System) {
    const system = new System(8, { randomFn: () => 0.5 });
    system.createComputeNode();
    activeSystems.push(system);
    return system;
}

beforeEach(() => compile.run.mockReset());
afterEach(() => {
    for (const system of activeSystems.splice(0)) system.dispose();
    vi.restoreAllMocks();
});

describe.each(systems)('Chiral Gold %s native compute readiness', (_label, System) => {
    it('keeps dispatch off until the checked pipeline is ready and binds it to the owning renderer', async () => {
        const pending = deferred();
        compile.run.mockReturnValue(pending.promise);
        const system = createSystem(System);
        const renderer = { compute: vi.fn() };
        const otherRenderer = { compute: vi.fn() };
        expect(system.dispatch(renderer)).toBe(false);
        const initializing = system.initialize(renderer, { timeoutMs: 3000 });
        expect(compile.run).toHaveBeenCalledWith(renderer, system.computeNode, { timeoutMs: 3000 });
        expect(system.compileReport.status).toBe('pending');
        expect(system.dispatch(renderer)).toBe(false);
        expect(renderer.compute).not.toHaveBeenCalled();
        pending.resolve({ status: 'ready', created: 1 });
        await initializing;
        expect(system.ready).toBe(true);
        expect(system.dispatch(otherRenderer)).toBe(false);
        expect(system.dispatch(renderer)).toBe(true);
        expect(renderer.compute).toHaveBeenCalledExactlyOnceWith(system.computeNode);
        renderer._isDeviceLost = true;
        expect(system.dispatch(renderer)).toBe(false);
    });

    it.each(['failed', 'timeout', 'unsupported', 'device-lost'])(
        'does not dispatch after a %s compile result', async (status) => {
            compile.run.mockResolvedValue({ status });
            const system = createSystem(System);
            const renderer = { compute: vi.fn() };
            await expect(system.initialize(renderer)).resolves.toMatchObject({ status });
            expect(system.ready).toBe(false);
            expect(system.dispatch(renderer)).toBe(false);
            expect(renderer.compute).not.toHaveBeenCalled();
        },
    );

    it('observes a rejected compile without starting synchronous dispatch', async () => {
        compile.run.mockRejectedValue(new Error('Invalid storage binding'));
        const system = createSystem(System);
        const renderer = { compute: vi.fn() };
        await expect(system.initialize(renderer)).resolves.toMatchObject({
            status: 'failed', message: 'Invalid storage binding',
        });
        expect(system.dispatch(renderer)).toBe(false);
    });

    it('disposes the compute node and prevents pending compilation from reviving retired buffers', async () => {
        const pending = deferred();
        compile.run.mockReturnValue(pending.promise);
        const system = createSystem(System);
        const node = system.computeNode;
        const dispose = vi.spyOn(node, 'dispose');
        const renderer = { compute: vi.fn() };
        const initializing = system.initialize(renderer);
        system.dispose();
        expect(dispose).toHaveBeenCalledOnce();
        expect(system.computeNode).toBeNull();
        expect(system.getPositionBuffer()).toBeNull();
        pending.resolve({ status: 'ready', created: 1 });
        await expect(initializing).resolves.toMatchObject({ status: 'cancelled' });
        expect(system.compileReport.status).toBe('retired');
        expect(system.ready).toBe(false);
        expect(system.dispatch(renderer)).toBe(false);
        expect(renderer.compute).not.toHaveBeenCalled();
    });

    it('keeps a later initialization authoritative when earlier work finishes last', async () => {
        const first = deferred();
        const second = deferred();
        compile.run.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const system = createSystem(System);
        const renderer = { compute: vi.fn() };
        const firstInit = system.initialize(renderer);
        const secondInit = system.initialize(renderer);
        second.resolve({ status: 'failed' });
        await secondInit;
        first.resolve({ status: 'ready' });
        await expect(firstInit).resolves.toMatchObject({ status: 'cancelled' });
        expect(system.compileReport.status).toBe('failed');
        expect(system.dispatch(renderer)).toBe(false);
    });
});

describe('Chiral Gold native dissolve readability', () => {
    it('keeps native row dissolves sparse compared with an equally intense hero burst', () => {
        const emitted = (profile) => {
            const system = new ChiralGoldBurstCompute(12000, { randomFn: () => 0.5 });
            activeSystems.push(system);
            system.triggerBurst(42, 1.5, new THREE.Vector3(-50, 0, 0), 0, { profile });
            return system.spawnPosData.filter((value, index) => index % 4 === 3 && value === 42).length;
        };
        const heroCount = emitted('hero_close');
        const dissolveCount = emitted('dissolve');
        expect(heroCount).toBeGreaterThan(0);
        expect(dissolveCount).toBeGreaterThan(0);
        expect(dissolveCount).toBeLessThanOrEqual(heroCount * 0.25);
    });
});

describe('Chiral Gold compute activation fallback', () => {
    const themes = [];
    const layerNames = [
        ['dustCompute', 'dustPoints', 'createDustSystem'],
        ['burstCompute', 'burstPoints', 'createBurstSystem'],
        ['wispCompute', 'wispPoints', 'createWispSystem'],
    ];
    function createTheme() {
        const theme = new ChiralGoldTheme();
        theme.isActive = true;
        theme.isWebGPU = true;
        theme.scene = new THREE.Scene();
        theme.renderer = { isWebGPURenderer: true, compute: vi.fn() };
        theme.flags.useCompute = true;
        theme.qualityPreset = {
            ...theme.qualityPreset, goldDustCount: 16, wispCount: 8,
            cpuBurstPoolSize: 2, cpuBurstParticles: 24,
        };
        themes.push(theme);
        return theme;
    }
    beforeEach(() => {
        vi.stubGlobal('window', {
            innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
            location: { search: '' }, settings: { effectQuality: 'High' },
        });
    });
    afterEach(() => {
        for (const theme of themes.splice(0)) {
            theme.disposeSceneResources();
            theme.disposeComputeResources();
        }
        vi.unstubAllGlobals();
    });

    it.each(layerNames)('rebuilds only failed %s on CPU and retires its old render resources', async (
        key, pointsKey,
    ) => {
        const theme = createTheme();
        const failed = {
            ready: false, initialize: vi.fn().mockResolvedValue({ status: 'failed' }), dispose: vi.fn(),
        };
        const ready = {
            ready: true, initialize: vi.fn().mockResolvedValue({ status: 'ready' }), dispose: vi.fn(),
        };
        const siblingKey = layerNames.find(([name]) => name !== key)[0];
        theme[key] = failed;
        theme[siblingKey] = ready;
        const old = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
        theme[pointsKey] = old;
        theme.scene.add(old);
        const geometryDispose = vi.spyOn(old.geometry, 'dispose');
        const materialDispose = vi.spyOn(old.material, 'dispose');

        await theme.initializeComputeSystems();

        expect(theme[key]).toBeNull();
        expect(failed.dispose).toHaveBeenCalledOnce();
        expect(old.parent).toBeNull();
        expect(geometryDispose).toHaveBeenCalledOnce();
        expect(materialDispose).toHaveBeenCalledOnce();
        expect(theme[siblingKey]).toBe(ready);
        expect(ready.dispose).not.toHaveBeenCalled();
        expect(theme.flags.useCompute).toBe(true);
        if (key === 'burstCompute') {
            expect(theme.burstPools).toHaveLength(2);
            expect(theme.burstPools.every((pool) => !pool.visible)).toBe(true);
        } else {
            expect(theme[pointsKey]).not.toBe(old);
            expect(theme[pointsKey].parent).toBe(theme.scene);
            if (key === 'wispCompute') expect(theme.wispCpuState).toBeTruthy();
        }
    });

    it.each(['generation', 'renderer', 'system'])(
        'does not rebuild a successor layer when %s changes during initialization', async (changedOwner) => {
            const theme = createTheme();
            const gate = deferred();
            const original = { ready: false, initialize: vi.fn(() => gate.promise), dispose: vi.fn() };
            theme.dustCompute = original;
            const create = vi.spyOn(theme, 'createDustSystem');
            const initializing = theme.initializeComputeSystems();
            if (changedOwner === 'generation') theme.lifecycleGeneration += 1;
            else if (changedOwner === 'renderer') theme.renderer = { isWebGPURenderer: true };
            else theme.dustCompute = { ready: false, dispose: vi.fn() };
            const current = theme.dustCompute;
            gate.resolve({ status: 'failed' });
            await initializing;
            expect(theme.dustCompute).toBe(current);
            expect(create).not.toHaveBeenCalled();
            expect(original.dispose).not.toHaveBeenCalled();
        },
    );
});
