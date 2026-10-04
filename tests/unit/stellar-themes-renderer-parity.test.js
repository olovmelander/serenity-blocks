import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import StellarDriftTheme from '../../src/themes/stellar-drift/stellar-drift-theme.js';
import StellarVelocityTheme from '../../src/themes/stellar-velocity/stellar-velocity-theme.js';
import * as driftMaterials from '../../src/themes/stellar-drift/stellar-drift-materials.js';
import * as velocityMaterials from '../../src/themes/stellar-velocity/stellar-velocity-materials.js';

const rendererMocks = vi.hoisted(() => ({ instances: [], initialize: null }));
const postMocks = vi.hoisted(() => ({ instances: [] }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGPURenderer: class {
            constructor(options) {
                this.options = options;
                this.isWebGPURenderer = true;
                this.backend = options.forceWebGL
                    ? { isWebGLBackend: true }
                    : { isWebGPUBackend: true };
                this.capabilities = { maxColorAttachments: 4 };
                this.domElement = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
                this.init = vi.fn(async () => rendererMocks.initialize?.(this));
                this.setClearColor = vi.fn();
                this.setPixelRatio = vi.fn();
                this.setSize = vi.fn();
                this.getPixelRatio = () => 1;
                this.compute = vi.fn();
                this.clear = vi.fn();
                this.render = vi.fn();
                rendererMocks.instances.push(this);
            }
        },
    };
});

vi.mock('../../src/themes/stellar-drift/stellar-drift-post.js', () => ({
    StellarDriftPost: class {
        constructor(renderer, scene, camera, params) {
            this.params = params;
            this.useMRT = params.useMRT;
            this.setSize = vi.fn();
            this.update = vi.fn();
            this.render = vi.fn();
            postMocks.instances.push(this);
        }
    },
}));
vi.mock('../../src/themes/stellar-velocity/stellar-velocity-post.js', () => ({
    StellarVelocityPost: class {
        constructor(renderer, scene, camera, params) {
            this.params = params;
            this.useMRT = params.useMRT;
            this.setSize = vi.fn();
            this.update = vi.fn();
            this.render = vi.fn();
            postMocks.instances.push(this);
        }
    },
}));

function createTheme(Theme) {
    const theme = new Theme();
    theme.isActive = true;
    theme.cleanupComplete = false;
    vi.spyOn(theme, 'disposeRenderer').mockResolvedValue();
    vi.spyOn(theme, 'initializeRendererCandidate').mockImplementation(async (renderer) => {
        try {
            await renderer.init();
            return renderer;
        } catch (error) {
            await theme.disposeRenderer(renderer, { nullInstance: false });
            throw error;
        }
    });
    return theme;
}
const container = () => ({ appendChild: vi.fn(), querySelector: () => null });

beforeEach(() => {
    rendererMocks.instances.length = 0;
    rendererMocks.initialize = null;
    postMocks.instances.length = 0;
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 3,
        location: { search: '' },
        addEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    vi.stubGlobal('navigator', { gpu: {} });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe.each([
    ['Stellar Drift', StellarDriftTheme],
    ['Stellar Velocity', StellarVelocityTheme],
])('%s renderer parity', (_name, Theme) => {
    it.each([
        ['browser without WebGPU', false, false],
        ['explicit WebGL2 selection', true, true],
    ])('keeps the modern node renderer for a %s', async (_label, hasGPU, forceWebGL) => {
        vi.stubGlobal('navigator', hasGPU ? { gpu: {} } : {});
        const theme = createTheme(Theme);
        theme.flags.forceWebGL = forceWebGL;
        const mount = container();
        expect(await theme.initRenderer(mount)).toBe(true);
        expect(rendererMocks.instances).toHaveLength(1);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(false);
        expect(theme.isWebGL).toBe(true);
        theme.probeCapabilities();
        expect(theme.capabilities).toMatchObject({ post: true, mrt: false, compute: false });
        expect(mount.appendChild).toHaveBeenCalledWith(theme.renderer.domElement);
    });

    it('retains automatic WebGL2 backend fallback instead of constructing a classic renderer', async () => {
        rendererMocks.initialize = (renderer) => { renderer.backend = { isWebGLBackend: true }; };
        const theme = createTheme(Theme);
        expect(await theme.initRenderer(container())).toBe(true);
        expect(rendererMocks.instances).toHaveLength(1);
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.disposeRenderer).not.toHaveBeenCalled();
    });

    it('retries failed native initialization with a fresh node WebGL2 renderer', async () => {
        rendererMocks.initialize = (renderer) => {
            if (!renderer.options.forceWebGL) throw new Error('Native device unavailable');
        };
        const theme = createTheme(Theme);
        expect(await theme.initRenderer(container())).toBe(true);
        expect(rendererMocks.instances).toHaveLength(2);
        expect(theme.disposeRenderer).toHaveBeenCalledWith(rendererMocks.instances[0], { nullInstance: false });
        expect(theme.renderer).toBe(rendererMocks.instances[1]);
        expect(theme.renderer.options.forceWebGL).toBe(true);
        expect(theme.usesNodeMaterials).toBe(true);
    });

    it('does not mount a candidate after lifecycle ownership changes', async () => {
        const theme = createTheme(Theme);
        rendererMocks.initialize = () => { theme.lifecycleGeneration += 1; };
        const mount = container();
        expect(await theme.initRenderer(mount)).toBe(false);
        expect(mount.appendChild).not.toHaveBeenCalled();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(rendererMocks.instances[0], { nullInstance: false });
    });

    it('runs the modern grade and post update on WebGL2 without MRT or compute', async () => {
        const theme = createTheme(Theme);
        theme.flags.forceWebGL = true;
        expect(await theme.initRenderer(container())).toBe(true);
        theme.probeCapabilities();
        theme.configureRendererColorPipeline();
        expect(theme.renderer.toneMapping).toBe(0);
        theme.setupPostProcessing();
        expect(postMocks.instances).toHaveLength(1);
        expect(theme.composer).toBeNull();
        expect(theme.postProcessing.params.useMRT).toBe(false);
        if (Theme === StellarVelocityTheme) theme.updatePostProcessing();
        else theme.applyAdaptiveScalerState();
        expect(theme.postProcessing.update).toHaveBeenCalled();
        theme.renderFrame();
        expect(theme.postProcessing.render).toHaveBeenCalledOnce();
        expect(theme.renderer.render).not.toHaveBeenCalled();
        expect(theme.lastRenderPath).toBe('webgl2-node-post');
    });

    it('preserves native compute and MRT capabilities', async () => {
        const theme = createTheme(Theme);
        expect(await theme.initRenderer(container())).toBe(true);
        theme.probeCapabilities();
        expect(theme.usesNodeMaterials).toBe(true);
        expect(theme.isWebGPU).toBe(true);
        expect(theme.capabilities).toMatchObject({ post: true, compute: true, mrt: true });
    });
});

describe('stellar node material factories on WebGL2', () => {
    const entries = Object.entries({ ...driftMaterials, ...velocityMaterials })
        .filter(([name, value]) => name.startsWith('createStellar') && typeof value === 'function');
    it.each(entries)('%s selects node materials while native WebGPU is unavailable', (_name, factory) => {
        const result = factory({ usesNodeMaterials: true, isWebGPU: false, color: 0xffffff, opacity: 0.6 });
        expect(result.material.isNodeMaterial).toBe(true);
        expect(result.material.isShaderMaterial).not.toBe(true);
        expect(result.meta?.usesCompute ?? false).toBe(false);
        result.material.dispose();
    });
    it('does not bind stale compute buffers on a WebGL2 node renderer', () => {
        const readBuffer = vi.fn(() => { throw new Error('WebGL2 must use CPU attributes'); });
        const staleCompute = {
            count: 4,
            getPositionBuffer: readBuffer,
            getLifeBuffer: readBuffer,
            getColorBuffer: readBuffer,
            getMiscBuffer: readBuffer,
            getVelocityBuffer: readBuffer,
        };
        const factories = [
            [driftMaterials.createStellarDustRingMaterial, 'dustCompute'],
            [driftMaterials.createStellarAmbientParticlesMaterial, 'ambientCompute'],
            [driftMaterials.createStellarNebulaBurstMaterial, 'burstCompute'],
            [velocityMaterials.createStellarVelocityStarfieldMaterial, 'starCompute'],
            [velocityMaterials.createStellarVelocityBurstParticleMaterial, 'burstCompute'],
        ];
        for (const [factory, option] of factories) {
            const result = factory({ usesNodeMaterials: true, isWebGPU: false, [option]: staleCompute });
            expect(result.material.isNodeMaterial).toBe(true);
            expect(result.meta?.usesCompute ?? false).toBe(false);
            result.material.dispose();
        }
        expect(readBuffer).not.toHaveBeenCalled();
    });
});

describe('Stellar Velocity CPU animation on node WebGL2', () => {
    it('keeps instanced billboard geometry for stars and gameplay bursts', async () => {
        const theme = createTheme(StellarVelocityTheme);
        theme.flags.forceWebGL = true;
        expect(await theme.initRenderer(container())).toBe(true);
        theme.probeCapabilities();
        theme.qualityPreset = { ...theme.qualityPreset, starCount: 12 };
        theme.createStarfield();
        expect(theme.starfield.isMesh).toBe(true);
        expect(theme.starfield.geometry.isInstancedBufferGeometry).toBe(true);
        expect(theme.starfield.geometry.getAttribute('aOffset').count).toBeGreaterThan(0);
        expect(theme.starfield.material.isNodeMaterial).toBe(true);
        expect(theme.starfield.userData.cameraFacing).toBe(true);
        expect(theme.starfieldCompute).toBeNull();
        const starOffsets = theme.starfield.geometry.getAttribute('aOffset');
        const beforeStarZ = starOffsets.array[2];
        theme.updateStarfield(1 / 60);
        expect(starOffsets.array[2]).not.toBe(beforeStarZ);
        expect(starOffsets.version).toBeGreaterThan(0);
        theme.createBurstParticles(8);
        expect(theme.burstParticles).toHaveLength(1);
        const burst = theme.burstParticles[0];
        expect(burst.isMesh).toBe(true);
        expect(burst.geometry.isInstancedBufferGeometry).toBe(true);
        expect(burst.geometry.getAttribute('aOffset').count).toBeGreaterThan(0);
        expect(burst.material.isNodeMaterial).toBe(true);
        expect(burst.userData.cameraFacing).toBe(true);
        expect(theme.burstCompute).toBeNull();
        const burstOffsets = burst.geometry.getAttribute('aOffset');
        const beforeBurst = Array.from(burstOffsets.array);
        theme.updateBurstParticles(1 / 60);
        expect(Array.from(burstOffsets.array)).not.toEqual(beforeBurst);
        expect(burstOffsets.version).toBeGreaterThan(0);
        expect(theme.renderer.compute).not.toHaveBeenCalled();
    });
});


describe('Stellar Drift CPU nebula burst on node WebGL2', () => {
    it('retains node material selection when native compute is unavailable', async () => {
        const theme = createTheme(StellarDriftTheme);
        theme.flags.forceWebGL = true;
        expect(await theme.initRenderer(container())).toBe(true);
        theme.probeCapabilities();
        vi.spyOn(theme, 'getRoundParticleTexture').mockReturnValue(null);
        const nebula = {
            getWorldPosition: (target) => target.set(0, 0, -500),
            geometry: { parameters: { width: 200 } },
            scale: { x: 1 },
            userData: {},
        };
        theme.createNebulaBurst(nebula, 4);
        expect(theme.nebulaBursts).toHaveLength(1);
        expect(theme.nebulaBursts[0].material.isPointsNodeMaterial).toBe(true);
        expect(theme.nebulaBursts[0].material.userData.usesCompute).toBe(false);
        expect(theme.nebulaBursts[0].geometry.getAttribute('position').count).toBe(4);
        expect(theme.nebulaBursts[0].userData.velocities).toHaveLength(4);
        expect(theme.nebulaBurstCompute).toBeNull();
    });
});
