import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import OceanTheme from '../../src/themes/ocean/ocean-theme.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({
    disposeOceanGltfCache: vi.fn(),
    loadGltfCached: vi.fn(),
}));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function trackedUniform() {
    let currentValue = -99;
    const write = vi.fn((value) => { currentValue = value; });
    return {
        write,
        get value() { return currentValue; },
        set value(value) { write(value); },
    };
}

function startFrameHarness() {
    let pendingFrame;
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        pendingFrame = callback;
        return 1;
    }));
    // The real frame loop runs, but no renderer or browser GPU is created.
    const theme = new OceanTheme();
    theme.isActive = true;
    theme.shouldRenderFrame = () => true;
    theme.registerAnimation = () => {};
    theme.clock = { getDelta: () => 1 / 60, elapsedTime: 0 };
    theme.renderer = { render: vi.fn() };
    theme.oceanCamera = { update: () => null };
    theme.currentStrength = 0.5;
    theme.targetCurrentStrength = 0.5;
    theme.glowIntensity = 0.8;
    theme.targetGlowIntensity = 0.8;
    const legacy = {
        uCurrentStrength: trackedUniform(),
        uWaveIntensity: trackedUniform(),
        uIntensity: trackedUniform(),
        uGlowIntensity: trackedUniform(),
    };
    const tsl = {
        uCurrentStrength: trackedUniform(),
        uGlowIntensity: trackedUniform(),
    };
    theme.uniformsToUpdate = [legacy];
    theme._tslUniforms = [tsl];
    theme.startAnimation();
    return {
        theme,
        legacy,
        tsl,
        frame: () => {
            theme.clock.elapsedTime += 1 / 60;
            pendingFrame();
        },
    };
}

describe('Ocean material response to current and glow', () => {
    it('initializes both shader paths, skips steady writes, and broadcasts a gameplay surge', () => {
        const {
            theme, legacy, tsl, frame,
        } = startFrameHarness();
        frame();

        expect(legacy.uCurrentStrength.value).toBe(0.5);
        expect(legacy.uWaveIntensity.value).toBeCloseTo(1.15);
        expect(legacy.uIntensity.value).toBe(0.8);
        expect(legacy.uGlowIntensity.value).toBe(0.8);
        expect(tsl.uCurrentStrength.value).toBe(0.5);
        expect(tsl.uGlowIntensity.value).toBe(0.8);

        frame();
        for (const uniform of [...Object.values(legacy), ...Object.values(tsl)]) {
            expect(uniform.write).toHaveBeenCalledTimes(1);
        }

        theme.targetCurrentStrength = 1.3;
        theme.targetGlowIntensity = 1.5;
        frame();

        expect(tsl.uCurrentStrength.value).toBeGreaterThan(0.5);
        expect(tsl.uGlowIntensity.value).toBeGreaterThan(0.8);
        expect(legacy.uCurrentStrength.value).toBe(theme.currentStrength);
        expect(legacy.uWaveIntensity.value).toBe(1 + theme.currentStrength * 0.3);
        expect(legacy.uIntensity.value).toBe(theme.glowIntensity);
        expect(legacy.uGlowIntensity.value).toBe(theme.glowIntensity);
        expect(tsl.uCurrentStrength.value).toBe(theme.currentStrength);
        expect(tsl.uGlowIntensity.value).toBe(theme.glowIntensity);
        for (const uniform of [...Object.values(legacy), ...Object.values(tsl)]) {
            expect(uniform.write).toHaveBeenCalledTimes(2);
        }
    });

    it('wires sampled GPU particles into the theme and keeps CPU updates only for jellyfish', () => {
        const { theme } = startFrameHarness();
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera();
        theme.isWebGPU = false;
        theme.renderer.isWebGPURenderer = true;
        theme.flags.legacyModels = true;
        theme.activePreset = {
            ...theme.activePreset, planktonCount: 12, bubbleCount: 8, jellyfishCount: 1,
        };
        theme.createPlankton();
        theme.createBubbles();
        theme.createJellyfish();

        expect(theme.planktonMesh.count).toBe(12);
        expect(theme.bubbleMesh.count).toBe(8);
        expect(theme.planktonMesh.geometry.instanceCount).toBe(12);
        expect(theme.bubbleMesh.geometry.instanceCount).toBe(8);
        expect(theme.planktonMesh.geometry.attributes.aCenter.array).toBe(theme.planktonData.positions);
        expect(theme.bubbleMesh.geometry.attributes.aCenter.array).toBe(theme.bubbleBillboardData.positions);
        expect(theme._tslUniforms).toContain(theme.planktonMesh.material.userData);
        expect(theme._tslUniforms).toContain(theme.bubbleMesh.material.userData);

        const writeBillboard = vi.spyOn(theme, 'writeBillboardInstance');
        const updateCamera = vi.spyOn(theme.camera, 'updateMatrixWorld');
        theme.updateOceanBillboards(8, 1);
        theme.updateOceanBillboards(8, 2);
        expect(writeBillboard).not.toHaveBeenCalled();
        expect(updateCamera).not.toHaveBeenCalled();
        theme.updateOceanBillboards(8, -1);
        expect(writeBillboard).toHaveBeenCalledTimes(1);
        expect(theme.jellyfishMesh.instanceMatrix.version).toBeGreaterThan(0);
        theme.scene.children.forEach(({ geometry, material }) => {
            geometry.dispose();
            material.dispose();
        });
    });

    it('initializes replacement uniforms after a scene rebuild at steady current and glow', () => {
        const { theme, frame } = startFrameHarness();
        theme.scene = new THREE.Scene();
        frame();
        theme.disposeSceneContents();

        const legacy = {
            uCurrentStrength: trackedUniform(),
            uWaveIntensity: trackedUniform(),
            uGlowIntensity: trackedUniform(),
        };
        const tsl = { uCurrentStrength: trackedUniform(), uGlowIntensity: trackedUniform() };
        theme.uniformsToUpdate.push(legacy);
        theme._tslUniforms = [tsl];
        frame();
        expect(legacy.uCurrentStrength.value).toBe(0.5);
        expect(legacy.uWaveIntensity.value).toBeCloseTo(1.15);
        expect(legacy.uGlowIntensity.value).toBe(0.8);
        expect(tsl.uCurrentStrength.value).toBe(0.5);
        expect(tsl.uGlowIntensity.value).toBe(0.8);
        frame();
        for (const uniform of [...Object.values(legacy), ...Object.values(tsl)]) {
            expect(uniform.write).toHaveBeenCalledTimes(1);
        }
    });

    it.each(['legacy', 'tsl'])('initializes deferred %s materials while their sources remain steady', (path) => {
        const { theme, frame } = startFrameHarness();
        frame();
        frame();
        const added = { uCurrentStrength: trackedUniform(), uGlowIntensity: trackedUniform() };
        const registry = path === 'legacy' ? theme.uniformsToUpdate : theme._tslUniforms;
        registry.push(added);
        frame();
        expect(added.uCurrentStrength.value).toBe(0.5);
        expect(added.uGlowIntensity.value).toBe(0.8);
        frame();
        expect(added.uCurrentStrength.write).toHaveBeenCalledTimes(1);
        expect(added.uGlowIntensity.write).toHaveBeenCalledTimes(1);
    });

    it('preserves the classic WebGL point-particle branches', () => {
        const { theme } = startFrameHarness();
        theme.scene = new THREE.Scene();
        theme.activePreset = { ...theme.activePreset, planktonCount: 12, bubbleCount: 8 };
        theme.createPlankton();
        theme.createBubbles();
        expect(theme.planktonMesh.isPoints).toBe(true);
        expect(theme.bubbleMesh.isPoints).toBe(true);
        expect(theme.planktonMesh.geometry.attributes.position.count).toBe(12);
        expect(theme.bubbleMesh.geometry.attributes.position.count).toBe(8);
        expect(theme.uniformsToUpdate).toContain(theme.planktonMesh.material.uniforms);
        expect(theme.uniformsToUpdate).toContain(theme.bubbleMesh.material.uniforms);
        theme.scene.children.forEach(({ geometry, material }) => {
            geometry.dispose();
            material.dispose();
        });
    });
});
