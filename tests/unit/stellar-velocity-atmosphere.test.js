import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import StellarVelocityTheme from '../../src/themes/stellar-velocity/stellar-velocity-theme.js';
import {
    ATMOSPHERE_TIERS, bakeStellarNoise, getStellarDestinationLayout, StellarVelocityAtmosphere,
} from '../../src/themes/stellar-velocity/stellar-velocity-atmosphere.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Stellar Velocity atmosphere', () => {
    it('preserves the same seeded cloud field when texture resolution changes', () => {
        const low = bakeStellarNoise(64);
        const high = bakeStellarNoise(256);
        try {
            for (const [x, y] of [[0, 0], [1, 17], [31, 42], [63, 63]]) {
                const a = (y * 64 + x) * 4;
                const b = (y * 4 * 256 + x * 4) * 4;
                expect(Array.from(low.image.data.slice(a, a + 4)))
                    .toEqual(Array.from(high.image.data.slice(b, b + 4)));
            }
            expect(low.wrapS).toBe(THREE.RepeatWrapping);
            expect(low.wrapT).toBe(THREE.RepeatWrapping);
            expect(low.colorSpace).toBe(THREE.NoColorSpace);
        } finally { low.dispose(); high.dispose(); }
    });

    it.each(Object.keys(ATMOSPHERE_TIERS))('keeps %s filaments in one instanced draw', (quality) => {
        const scene = new THREE.Scene();
        const atmosphere = new StellarVelocityAtmosphere({ scene, quality }).build();
        try {
            const ribbons = atmosphere.root.getObjectByName('stellar-velocity-plasma-filaments');
            expect(ribbons.geometry.isInstancedBufferGeometry).toBe(true);
            expect(ribbons.geometry.instanceCount).toBe(ATMOSPHERE_TIERS[quality].ribbons);
            expect(ribbons.geometry.getAttribute('aLane').count).toBe(ribbons.geometry.instanceCount);
            expect(ribbons.geometry.index.count).toBe(ATMOSPHERE_TIERS[quality].segments * 6);
            expect(ribbons.frustumCulled).toBe(false);
        } finally { atmosphere.dispose(); }
    });

    it('positions the destination beside desktop gameplay and above portrait gameplay', () => {
        const desktop = getStellarDestinationLayout(16 / 9, true);
        const portrait = getStellarDestinationLayout(390 / 844, true);
        expect(desktop.x).toBeLessThan(-0.5);
        expect(Math.abs(desktop.y)).toBeLessThan(0.2);
        expect(portrait.y).toBeGreaterThan(0.7);
        expect(portrait.scale).toBeLessThan(0.5);
        expect(getStellarDestinationLayout(16 / 9, false).x).toBeGreaterThan(-0.2);
    });

    it('releases its baked texture and every owned material once, including bound core objects', () => {
        const scene = new THREE.Scene();
        const atmosphere = new StellarVelocityAtmosphere({ scene, quality: 'Low' }).build();
        const core = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), atmosphere.createCoreMaterial());
        atmosphere.bindCore({
            warpCore: core, warpCoreRings: [], warpCoreGlowPlanes: [], routeGuides: [],
        });
        const resources = new Set([atmosphere.noise]);
        atmosphere.root.traverse((object) => {
            if (object.geometry) resources.add(object.geometry);
            if (object.material) resources.add(object.material);
        });
        const spies = [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
        atmosphere.dispose();
        atmosphere.dispose();
        expect(scene.children).toHaveLength(0);
        spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    });

    it('retains native selective bloom with the complete shipping scene', () => {
        const theme = new StellarVelocityTheme();
        theme.scene = new THREE.Scene();
        theme.renderer = { getPixelRatio: () => 1, setClearColor: vi.fn() };
        theme.usesNodeMaterials = true;
        theme.isWebGPU = true;
        theme.capabilities = { mrt: true, compute: false };
        theme.applyQualityPreset('Minimal');
        theme.createStarfield();
        theme.createNebulaBackdrop();
        theme.createWarpCore();
        theme.createAsteroidField();
        theme.createAsteroidMicroDebris();
        try {
            expect(theme.ensureMrtMaterials()).toBe(true);
            expect(theme.capabilities.mrt).toBe(true);
            expect(theme.materialAuditReport.issues).toEqual([]);
        } finally { theme.disposeSceneResources(); }
    });

    it('reads MRT limits from the r186 native device without a classic capabilities object', () => {
        const theme = new StellarVelocityTheme();
        theme.usesNodeMaterials = true;
        theme.isWebGPU = true;
        theme.renderer = { backend: { device: { limits: { maxColorAttachments: 8 } } } };
        theme.probeCapabilities();
        expect(theme.capabilities.maxColorAttachments).toBe(8);
        expect(theme.capabilities.mrt).toBe(true);
    });

    it('keeps scheduling while hidden without simulating or rendering', () => {
        const callbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback) => { callbacks.push(callback); return callbacks.length; });
        vi.stubGlobal('document', { hidden: true });
        const theme = new StellarVelocityTheme();
        theme.isActive = true;
        const gate = vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(false);
        const render = vi.spyOn(theme, 'render').mockImplementation(() => {});
        const computeStep = vi.spyOn(theme, 'updateStarfield').mockImplementation(() => {});
        vi.spyOn(theme, 'updateAdaptiveScaler').mockImplementation(() => {});
        theme.startAnimation();
        callbacks[0]();
        expect(callbacks).toHaveLength(2);
        expect(render).not.toHaveBeenCalled();
        expect(computeStep).not.toHaveBeenCalled();
        expect(theme.time).toBe(0);
        gate.mockReturnValue(true);
        callbacks[1]();
        expect(render).toHaveBeenCalledOnce();
        expect(computeStep).toHaveBeenCalledOnce();
        expect(callbacks).toHaveLength(3);
        theme.clock.dispose();
    });
});
