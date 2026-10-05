/* eslint-disable max-classes-per-file */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import AstralWeaveTheme from '../../src/themes/astral-weave/astral-weave-theme.js';
import ChiralGoldTheme from '../../src/themes/chiral-gold/chiral-gold-theme.js';
import { AstralWeaveBurstCompute } from '../../src/themes/astral-weave/astral-weave-compute.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const mocks = vi.hoisted(() => ({ initialize: null, instances: [] }));
vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        RenderPipeline: class {
            constructor() {
                this.render = vi.fn();
                this.dispose = vi.fn();
            }
        },
        WebGPURenderer: class {
            constructor(options) {
                this.options = options;
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL
                    ? { isWebGLBackend: true }
                    : { isWebGPUBackend: true, device: { limits: { maxColorAttachments: 8 } } };
                this.domElement = {
                    style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
                };
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.getPixelRatio = () => 1;
                this.setSize = vi.fn();
                this.clear = vi.fn();
                this.render = vi.fn();
                this.compute = vi.fn();
                this.setAnimationLoop = vi.fn();
                this.constructorLossCallback = vi.fn(() => { this.deviceLost = true; });
                this.onDeviceLost = this.constructorLossCallback;
                this.init = vi.fn(async () => mocks.initialize?.(this));
                mocks.instances.push(this);
            }
        },
    };
});

const themeTypes = [['Astral Weave', AstralWeaveTheme], ['Chiral Gold', ChiralGoldTheme]];
const owners = [];
function createTheme(Theme, quality = 'Low') {
    const theme = new Theme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    theme.applyQualityPreset(quality);
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'removeRendererResilience');
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        try {
            await renderer.init();
            return renderer;
        } catch (error) {
            await theme.disposeRenderer(renderer, { nullInstance: false });
            throw error;
        }
    });
    owners.push(theme);
    return theme;
}
function assertNoClassicShaders(scene) {
    const materials = [];
    scene.traverse((object) => {
        for (const material of [object.material].flat().filter(Boolean)) materials.push(material);
    });
    expect(materials.length).toBeGreaterThan(0);
    expect(materials.filter((material) => material.isShaderMaterial)).toEqual([]);
}

describe('Astral Weave and Chiral Gold WebGL2 art parity', () => {
    beforeEach(() => {
        mocks.initialize = null;
        mocks.instances.length = 0;
        vi.stubGlobal('window', {
            innerWidth: 390,
            innerHeight: 844,
            devicePixelRatio: 3,
            location: { search: '' },
            settings: { effectQuality: 'Low', graphicsQuality: 'Low' },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
        vi.stubGlobal('navigator', {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const theme of owners.splice(0)) {
            theme._contextRestoreUnsub?.();
            theme._contextRestoreUnsub = null;
            theme.scene?.traverse((object) => {
                object.geometry?.dispose();
                for (const material of [object.material].flat().filter(Boolean)) material.dispose();
            });
            theme.cpuBurstSimulation?.dispose();
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each(themeTypes)('uses node WebGL2 without a GPU (%s)', async (_label, Theme) => {
        const theme = createTheme(Theme);
        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.isWebGL).toBe(true);
        expect(theme.flags.useCompute).toBe(false);
        expect(theme.flags.useMRT).toBe(false);
    });

    it.each(themeTypes)('keeps automatic node fallback (%s)', async (_label, Theme) => {
        vi.stubGlobal('navigator', { gpu: {} });
        mocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = createTheme(Theme);

        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(mocks.instances).toHaveLength(1);
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it.each(themeTypes)('retries failed native init as node WebGL2 (%s)', async (_label, Theme) => {
        vi.stubGlobal('navigator', { gpu: {} });
        mocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Device unavailable');
        };
        const theme = createTheme(Theme);

        expect(await theme.initRenderer({ appendChild: vi.fn() })).toBe(true);
        expect(mocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(mocks.instances[0], { nullInstance: false });
        expect(theme.renderer).toBe(mocks.instances[1]);
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it.each(themeTypes)('retains native compute and MRT on High (%s)', async (_label, Theme) => {
        vi.stubGlobal('navigator', { gpu: {}, userAgent: 'Linux' });
        const theme = createTheme(Theme, 'High');
        await theme.initRenderer({ appendChild: vi.fn() });
        if (theme.probeCapabilities) { theme.probeCapabilities(); theme.updateCapabilityFlags(); }
        expect(theme.isWebGPU).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.flags.usePost).toBe(true);
        expect(theme.flags.useCompute).toBe(true);
        expect(theme.flags.useMRT).toBe(true);
    });

    it.each(themeTypes)('recovers GL context and removes monitors on retirement (%s)', async (_label, Theme) => {
        const theme = createTheme(Theme);
        await theme.initRenderer({ appendChild: vi.fn() });
        const publishedRenderer = theme.renderer;
        const recover = theme.setupRendererResilience.mock.calls.at(-1)[1].onContextRestored;
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        recover();
        expect(rebuild).toHaveBeenCalledWith(theme.lifecycleGeneration);
        rebuild.mockClear();
        if (theme.cleanupRuntime) theme.cleanupRuntime();
        else theme.disposeRuntimeResources();
        expect(theme.removeRendererResilience).toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(publishedRenderer, { nullInstance: false });
        expect(typeof publishedRenderer.onDeviceLost).toBe('function');
        expect(() => publishedRenderer.onDeviceLost({ reason: 'destroyed' })).not.toThrow();
        recover();
        expect(rebuild).not.toHaveBeenCalled();
    });

    it('does not dispose the Astral GL backend again after loss-time retirement', async () => {
        const theme = createTheme(AstralWeaveTheme);
        await theme.initRenderer({ appendChild: vi.fn() });
        const publishedRenderer = theme.renderer;
        publishedRenderer.dispose = vi.fn();
        theme._contextLostRendererDisposals.set(publishedRenderer, { releaseStarted: true });
        theme.disposeRenderer.mockRestore();
        theme.cleanupRuntime();
        expect(publishedRenderer.dispose).not.toHaveBeenCalled();
        expect(theme.renderer).toBeNull();
    });

    it.each(themeTypes)('keeps the %s GL callback and restore monitor until restoration', async (_label, Theme) => {
        const theme = createTheme(Theme);
        await theme.initRenderer({ appendChild: vi.fn() });
        const publishedRenderer = theme.renderer;
        const rebuild = vi.spyOn(theme, 'createScene').mockResolvedValue();
        const recover = theme.setupRendererResilience.mock.calls.at(-1)[1].onContextRestored;
        expect(publishedRenderer.onDeviceLost).toBe(publishedRenderer.constructorLossCallback);
        publishedRenderer.onDeviceLost({ api: 'WebGL', reason: 'context-lost' });
        expect(publishedRenderer.deviceLost).toBe(true);
        expect(theme.renderer).toBe(publishedRenderer);
        const duplicateLossListeners = publishedRenderer.domElement.addEventListener.mock.calls
            .filter(([event]) => event === 'webglcontextlost');
        expect(duplicateLossListeners).toEqual([]);
        expect(theme.removeRendererResilience).not.toHaveBeenCalled();
        expect(rebuild).not.toHaveBeenCalled();
        recover();
        expect(rebuild).toHaveBeenCalledWith(theme.lifecycleGeneration);
    });

    it.each(themeTypes)('preserves native %s device recovery', async (_label, Theme) => {
        vi.stubGlobal('navigator', { gpu: {}, userAgent: 'Linux' });
        const theme = createTheme(Theme, 'High');
        await theme.initRenderer({ appendChild: vi.fn() });
        const recover = vi.spyOn(theme, Theme === AstralWeaveTheme ? 'handleDeviceLost' : 'handleDeviceLoss')
            .mockResolvedValue();
        const info = { api: 'WebGPU', reason: 'unknown' };
        theme.renderer.onDeviceLost(info);
        expect(recover.mock.calls[0][0]).toBe(info);
    });

    it.each(themeTypes)('lets Base serialize %s restore after deferred renderer retirement', async (_label, Theme) => {
        const theme = createTheme(Theme);
        const container = { appendChild: vi.fn() };
        if (theme.ensureThemeContainer) vi.spyOn(theme, 'ensureThemeContainer').mockReturnValue(container);
        const createScene = vi.spyOn(theme, 'createScene').mockImplementation(async (generation) => {
            await theme.initRenderer(container, generation);
        });
        const sharedRenderer = { loadTheme: vi.fn() };
        await theme.start(sharedRenderer);
        const lostRenderer = theme.renderer;
        const localRestore = theme.setupRendererResilience.mock.calls.at(-1)[1].onContextRestored;
        let finishRetirement;
        const retirement = new Promise((resolve) => { finishRetirement = resolve; });
        theme._contextLostRendererDisposals.set(lostRenderer, { releaseStarted: true, completion: retirement });
        const restart = vi.spyOn(theme, 'start');

        eventBus.emit(EVENTS.CONTEXT_RESTORED, {
            type: 'webgl', canvas: lostRenderer.domElement, label: theme.name,
        });
        localRestore();
        expect(createScene).toHaveBeenCalledTimes(1);
        expect(mocks.instances).toHaveLength(1);
        expect(restart).not.toHaveBeenCalled();

        finishRetirement();
        await retirement;
        await theme._startInFlight;
        expect(restart).toHaveBeenCalledTimes(1);
        expect(createScene).toHaveBeenCalledTimes(2);
        expect(mocks.instances).toHaveLength(2);
        expect(theme.renderer).not.toBe(lostRenderer);
        expect(theme.lifecycleState).toBe('running');
    });

    it('does not report cancelled Astral initialization as an active renderer failure', async () => {
        const theme = createTheme(AstralWeaveTheme);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(theme, 'ensureContainer').mockReturnValue({});
        vi.spyOn(theme, 'initRenderer').mockImplementation(async () => {
            theme.lifecycleGeneration += 1;
            return false;
        });
        await theme.createScene(theme.lifecycleGeneration);
        expect(error).not.toHaveBeenCalled();
        theme.restorePointUvWarningFilter();
    });

    it('keeps both Chiral helices in portrait and restores authored homes after rotation', async () => {
        const theme = createTheme(ChiralGoldTheme, 'High');
        await theme.initRenderer({ appendChild: vi.fn() });
        theme.createStrands();
        const homes = theme.strands.map((strand) => strand.userData.home.clone());
        theme.layoutStrandsForViewport();
        expect(theme.strands.length).toBeGreaterThan(1);
        for (const strand of theme.strands) {
            const projected = strand.position.clone().project(theme.camera);
            expect(Math.abs(projected.x)).toBeLessThan(0.9);
            expect(strand.scale.x).toBeCloseTo(390 / 844);
            expect(strand.scale.y).toBe(strand.scale.x);
            expect(strand.scale.z).toBe(strand.scale.x);
        }
        for (let phase = 0; phase < 24; phase++) {
            theme.camera.position.x = Math.sin(phase) * 260;
            theme.camera.lookAt(0, 0, 0);
            theme.layoutStrandsForViewport();
            for (const strand of theme.strands) {
                const projected = strand.position.clone().project(theme.camera);
                expect(Math.abs(projected.x)).toBeLessThan(0.9);
                strand.position.x += 2000;
            }
        }
        theme.camera.aspect = 844 / 390;
        theme.camera.updateProjectionMatrix();
        theme.layoutStrandsForViewport();
        theme.strands.forEach((strand, index) => {
            expect(strand.userData.home.equals(homes[index])).toBe(true);
            expect(strand.scale.toArray()).toEqual([1, 1, 1]);
        });
    });

    it('runs Astral geometry and gameplay bursts with attributes instead of compute storage', async () => {
        const theme = createTheme(AstralWeaveTheme);
        await theme.initRenderer({ appendChild: vi.fn() });
        await theme.loadRuntimeModules();
        for (const key of ['glow', 'nebula', 'lensDirt', 'centerVeil']) theme.textures[key] = new THREE.Texture();
        theme.createSceneGraph();
        assertNoClassicShaders(theme.scene);
        for (const particles of [theme.starfield, theme.flowParticles, theme.dustParticles]) {
            expect(particles.isInstancedMesh).toBe(true);
            expect(particles.geometry.getAttribute('uv').count).toBe(4);
            expect(particles.geometry.getAttribute('aCenter').isInstancedBufferAttribute).toBe(true);
            expect(particles.geometry.getAttribute('aCenter').count).toBe(particles.count);
        }
        expect(theme.nexusNodeData.length).toBeGreaterThan(0);
        expect(theme.burstNodeData.meta.usesCompute).toBe(false);
        expect(theme.cpuBurstSimulation.count).toBeLessThanOrEqual(128);
        expect(theme.burstParticles.geometry.attributes.aBurstPosition.array)
            .toBe(theme.cpuBurstSimulation.positionData);

        theme.fxController.onPieceLock();
        theme.fxController.onLineClear(4);
        theme.fxController.onCombo(3);
        theme.spawnPendingReactiveEffects();
        expect(theme.cpuBurstSimulation.positionData
            .some((value, index) => index % 4 === 3 && value === 1)).toBe(true);
        const before = theme.cpuBurstSimulation.positionData.slice();
        theme.updateCompute(1 / 60, theme.fxController.getSignals());
        expect(theme.cpuBurstSimulation.positionData).not.toEqual(before);
        expect(theme.cpuBurstSimulation.positionData.every(Number.isFinite)).toBe(true);
        expect(theme.renderer.compute).not.toHaveBeenCalled();
        for (let i = 0; i < 160; i++) theme.updateCompute(1 / 60, theme.fxController.getSignals());
        expect(theme.cpuBurstSimulation.positionData
            .every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
    });

    it('retains Chiral CPU dust, wisps and event bursts using node materials', async () => {
        const theme = createTheme(ChiralGoldTheme);
        await theme.initRenderer({ appendChild: vi.fn() });
        theme.probeCapabilities();
        theme.updateCapabilityFlags();
        theme.createDustSystem();
        theme.createBurstSystem();
        theme.createWispSystem();
        theme.triggerBurst(0.6, 2, new THREE.Vector3(-80, 30, 0));
        assertNoClassicShaders(theme.scene);
        expect(theme.dustPoints.material.isNodeMaterial).toBe(true);
        expect(theme.wispPoints.material.isNodeMaterial).toBe(true);
        expect(theme.burstPools.length).toBeGreaterThan(0);
        expect(theme.burstPools.every((pool) => pool.material.isNodeMaterial)).toBe(true);
        const active = theme.burstPools.find((pool) => pool.userData.cpuBurst.active);
        const before = active.geometry.attributes.position.array.slice();
        theme.updateBurstCpu(1 / 60);
        expect(active.geometry.attributes.position.array).not.toEqual(before);
        expect(active.geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
        expect(theme.renderer.compute).not.toHaveBeenCalled();
    });

    it('restores Chiral renderer clear state when compatible post throws', async () => {
        const theme = createTheme(ChiralGoldTheme, 'High');
        await theme.initRenderer({ appendChild: vi.fn() });
        theme.flags.usePost = true;
        theme.postProcessing = { render: vi.fn(() => { throw new Error('Frame interrupted'); }) };
        theme.renderer.autoClear = false;
        expect(() => theme.renderFrame()).toThrow('Frame interrupted');
        expect(theme.renderer.autoClear).toBe(false);
        expect(theme.renderer.clear).not.toHaveBeenCalled();
    });

    it.each(themeTypes)('keeps High post on node WebGL2 (%s)', async (_label, Theme) => {
        const theme = createTheme(Theme, 'High');
        await theme.initRenderer({ appendChild: vi.fn() });
        if (theme.loadRuntimeModules) await theme.loadRuntimeModules();
        if (theme.probeCapabilities) { theme.probeCapabilities(); theme.updateCapabilityFlags(); }
        theme.setupPostProcessing();
        theme.configureRendererColorPipeline();

        expect(theme.flags.usePost).toBe(true);
        expect(theme.flags.useMRT).toBe(false);
        expect(theme.flags.useCompute).toBe(false);
        expect(theme.postProcessing).toBeTruthy();
        expect(theme.postProcessing.useMRT).toBe(false);
        expect(theme.renderer.toneMapping).toBe(THREE.NoToneMapping);
        theme.postProcessing.dispose();
    });
});

describe('bounded Astral CPU burst lifecycle', () => {
    it('reuses slots, matches the native decay law and hides expired particles', () => {
        const pool = new AstralWeaveBurstCompute(4, () => 0.5);
        pool.spawnBurst(9, { x: 7, y: 8, z: 9 }, { spread: 0, lifeMin: 0.4, lifeMax: 0.4 });
        expect(pool.positionData).toHaveLength(16);
        expect(pool.cursor).toBe(9);
        expect(pool.computeNode).toBeNull();
        const initialY = pool.positionData[1];
        pool.updateCpu(1 / 60, { gravity: -11.5, drag: 0.985 });
        expect(pool.positionData[1]).toBeGreaterThan(initialY);
        expect(pool.miscData[1]).toBeCloseTo(0.4 - (1 / 60) * 1.05);
        for (let i = 0; i < 30; i++) pool.updateCpu(1 / 60);
        for (let i = 0; i < pool.count; i++) {
            expect(pool.positionData[i * 4 + 3]).toBe(0);
            expect(pool.positionData[i * 4 + 2]).toBe(-9999);
            expect(pool.miscData[i * 4 + 1]).toBe(0);
        }
        pool.dispose();
    });
});
