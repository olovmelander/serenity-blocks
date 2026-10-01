import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import CosmicNoirTheme from '../../src/themes/cosmic-noir/cosmic-noir-theme.js';
import { ThemeCameraRig } from '../../src/themes/shared/camera-rig.js';
import {
    applyNoirFlashScale, constrainNoirCamera, decayNoirValue, sampleNoirNebula,
    resolveNoirComposition, NOIR_SHOCKWAVE_SHAPES, NOIR_WAVE_LIMIT,
} from '../../src/themes/cosmic-noir/cosmic-noir-motion.js';

function runtime() {
    const theme = new CosmicNoirTheme();
    theme.flags.seed = 12345;
    theme.initializeDeterministicState();
    theme.planetGroup = new THREE.Group();
    theme.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 50000);
    theme.cameraRig = new ThemeCameraRig(theme.camera, { idlePhase: 0 });
    return theme;
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Cosmic Noir choreography', () => {
    it('preserves the authored cloud offsets with bounded, absolute-time movement', () => {
        const layer = {
            baseX: 1200,
            baseY: -620,
            baseRotation: 1.4,
            driftPhase: 0.7,
            driftAmplitude: 100,
            pulsePhase: 1.3,
            parallaxX: 0.2,
            parallaxY: 0.15,
        };
        const camera = { x: 120, y: -40 };
        const target = {};
        for (let t = 0; t < 3600; t += 7.1) {
            expect(sampleNoirNebula(t, layer, camera, target)).toBe(target);
            expect(Math.abs(target.x - 1224)).toBeLessThanOrEqual(100);
            expect(Math.abs(target.y + 626)).toBeLessThanOrEqual(45);
            expect(Math.abs(target.rotation - 1.4)).toBeLessThanOrEqual(0.009);
        }
        const expected = { ...sampleNoirNebula(12, layer, camera, target) };
        sampleNoirNebula(987, layer, camera, target);
        expect(sampleNoirNebula(12, layer, camera, target)).toEqual(expected);
        const { pulse } = sampleNoirNebula(22, layer, camera, {});
        expect(pulse).toBeCloseTo(expected.pulse, 12);
    });

    it.each([0.94, 0.92, 1 - 7 / 60])('keeps %s decay identical at 30, 60 and 144 Hz', (retention) => {
        const results = [30, 60, 144].map((fps) => {
            let value = 1;
            for (let i = 0; i < fps; i++) value = decayNoirValue(value, retention, 1 / fps);
            return value;
        });
        expect(results[0]).toBeCloseTo(results[1], 12);
        expect(results[2]).toBeCloseTo(results[1], 12);
        expect(decayNoirValue(1, retention, 1 / 60)).toBeCloseTo(retention, 12);
    });

    it('advances the real reactive envelope independently of refresh rate', () => {
        const results = [30, 60, 144].map((fps) => {
            const theme = runtime();
            theme.pushReactiveEnvelope({ pulse: 1, star: 1, bloom: 1 });
            for (let i = 0; i < fps / 2; i++) theme.updateReactiveEnvelope(1 / fps);
            return theme.reactiveEnvelope;
        });
        for (const key of ['pulse', 'star', 'bloom']) {
            expect(results[0][key]).toBeCloseTo(results[1][key], 12);
            expect(results[2][key]).toBeCloseTo(results[1][key], 12);
        }
    });

    it('keeps the moving planet clear of the camera, including after the rig offsets', () => {
        const theme = runtime();
        theme.pointerX = 1;
        theme.pointerY = -1;
        for (let i = 0; i < 1200; i++) {
            theme.time = i * 0.25;
            theme.updateScene(0.025);
            expect(theme.camera.position.distanceTo(theme.planetGroup.position)).toBeGreaterThanOrEqual(899.999);
            expect(theme.camera.position.z - theme.planetGroup.position.z).toBeGreaterThanOrEqual(720);
        }
        const position = { x: 1400, y: -120, z: 1300 };
        expect(constrainNoirCamera(position, { x: 800, y: 0, z: 0 })).toEqual(position);
        expect(position.z).toBe(1300);
    });

    it('maintains the physical sprite flash size throughout its fade', () => {
        const theme = runtime();
        theme.isWebGPU = true;
        theme.createComboFlashLayer(280);
        applyNoirFlashScale(theme.comboFlash, 0.8);
        expect(theme.comboFlash.scale.x).toBeCloseTo(756 * 1.52);
        expect(theme.comboFlash.scale.y).toBeCloseTo(756 * 1.52);
        applyNoirFlashScale(theme.comboFlash, 0);
        expect(theme.comboFlash.scale.x).toBe(756);
        const plane = new THREE.Mesh();
        plane.userData.baseSize = 1;
        applyNoirFlashScale(plane, 0.8);
        expect(plane.scale.x).toBeCloseTo(1.52);
        theme.comboFlash.material.dispose();
    });

    it.each([16 / 9, 1.6, 4 / 3, 1, 0.75, 9 / 16])('keeps core visible in the left lane at aspect %s', (aspect) => {
        const theme = runtime();
        theme.camera.aspect = aspect;
        theme.camera.updateProjectionMatrix();
        const viewCenter = new THREE.Vector3();
        const projected = new THREE.Vector3();
        const pose = {};
        for (let time = 0; time < 360; time += 2.7) {
            theme.time = time;
            theme.pointerX = Math.sin(time * 0.31);
            theme.pointerY = Math.cos(time * 0.17);
            theme.updateScene(0.025);
            viewCenter.copy(theme.planetGroup.position).applyMatrix4(theme.camera.matrixWorldInverse);
            const depth = -viewCenter.z;
            const radius = 280 * theme.planetGroup.scale.x;
            const focal = 1 / Math.tan((theme.camera.fov * Math.PI) / 360);
            // Exact perspective sphere silhouette extrema, rather than a center-only check.
            const denominator = depth * depth - radius * radius;
            const xEdge = radius * Math.sqrt(depth * depth + viewCenter.x ** 2 - radius * radius);
            const yEdge = radius * Math.sqrt(depth * depth + viewCenter.y ** 2 - radius * radius);
            const xMin = ((focal / aspect) * (viewCenter.x * depth - xEdge)) / denominator;
            const xMax = ((focal / aspect) * (viewCenter.x * depth + xEdge)) / denominator;
            const yMin = (focal * (viewCenter.y * depth - yEdge)) / denominator;
            const yMax = (focal * (viewCenter.y * depth + yEdge)) / denominator;
            expect((xMin + 1) / 2).toBeGreaterThan(0.025);
            expect((xMax + 1) / 2).toBeLessThan(0.375);
            expect(yMin).toBeGreaterThan(-0.96);
            expect(yMax).toBeLessThan(0.96);
            // The real 600px portrait board begins at x=130 and reaches near the top.
            if (aspect < 1.1) {
                expect((xMax + 1) / 2).toBeLessThan(0.2);
                expect((1 - yMin) / 2).toBeLessThan(0.245);
            }
            resolveNoirComposition(time, aspect, theme.planetPhaseX, theme.planetPhaseY, pose);
            expect((xMin + xMax + 2) / 4).toBeCloseTo(pose.x, 10);
            expect((2 - yMin - yMax) / 4).toBeCloseTo(pose.y, 10);
            projected.copy(theme.planetGroup.position).project(theme.camera);
            expect(Number.isFinite(projected.x)).toBe(true);
            expect(theme.tempBhScreenPos.x).toBeCloseTo(projected.x * 0.5 + 0.5, 10);
            expect(theme.tempBhScreenPos.y).toBeCloseTo(projected.y * 0.5 + 0.5, 10);
        }
    });
});

describe('Cosmic Noir reusable event waves', () => {
    it('keeps both-sided additive classic materials in one draw', () => {
        const theme = runtime();
        theme.createAccretionDisk();
        const wave = theme.acquireCosmicWave({});
        for (const material of [theme.accretionDisk.material, wave.material]) {
            expect(material.side).toBe(THREE.DoubleSide);
            expect(material.forceSinglePass).toBe(true);
            expect(material.blending).toBe(THREE.AdditiveBlending);
            expect(material.depthWrite).toBe(false);
        }
        theme.releaseCosmicWave(wave);
        theme.disposeCosmicWavePool();
        theme.accretionDisk.geometry.dispose();
        theme.accretionDisk.material.dispose();
        theme.disposeSharedNoiseTexture();
    });

    it('keeps lock rings centered, scaled with the core and facing the camera', () => {
        for (const aspect of [16 / 9, 1, 0.75, 9 / 16]) {
            const theme = runtime();
            theme.camera.aspect = aspect;
            theme.camera.updateProjectionMatrix();
            theme.time = 12;
            theme.updateScene(0);
            theme.handlePieceLock();
            const [wave] = theme.cosmicWaves;
            const worldCenter = new THREE.Vector3();
            const worldScale = new THREE.Vector3();
            const rotation = new THREE.Quaternion();
            const facing = new THREE.Vector3();
            const viewDirection = new THREE.Vector3();
            for (let frame = 0; frame < 30; frame++) {
                theme.time += 1 / 60;
                theme.updateScene(1 / 60);
                expect(wave.parent).toBe(theme.planetGroup);
                wave.getWorldPosition(worldCenter);
                expect(worldCenter.distanceTo(theme.planetGroup.position)).toBeLessThan(1e-8);
                wave.getWorldScale(worldScale);
                expect(worldScale.x / theme.planetGroup.scale.x).toBeCloseTo(wave.scale.x, 10);
                wave.getWorldQuaternion(rotation);
                facing.set(0, 0, 1).applyQuaternion(rotation);
                viewDirection.copy(theme.camera.position).sub(worldCenter).normalize();
                expect(facing.dot(viewDirection)).toBeCloseTo(1, 10);
            }
            theme.updateCosmicWaves(1);
            theme.disposeCosmicWavePool();
        }
    });

    it('compiles the lock wave while attached, then parks it before animation starts', async () => {
        const theme = runtime();
        const container = { innerHTML: '' };
        vi.stubGlobal('document', { getElementById: () => container });
        theme.isActive = true;
        for (const method of [
            'cancelAnimationLoop', 'clearEventSubscriptions', 'removeResizeListener',
            'removeRendererResilience', 'removeBaselineHelpers', 'disposeRuntimeResources',
            'refreshFlagsForScene', 'initializeAdaptiveBudgetState', 'probeCapabilities',
            'updateCapabilityFlags', 'ensureSharedNoiseTexture', 'createStarfield',
            'createNebulaClouds', 'createAmbientDust', 'createPlanet', 'createAtmosphere',
            'createVoidSparks', 'createGasSwirlParticles', 'ensureMrtMaterials',
            'auditMrtMaterials', 'setupPostProcessing', 'normalizeRuntimeFeatureFlags',
            'configureRendererColorPipeline', 'setupResizeHandler', 'setupEventListeners',
        ]) vi.spyOn(theme, method).mockImplementation(() => {});
        theme.scene = new THREE.Scene();
        theme.scene.add(theme.planetGroup);
        theme.renderer = {};
        vi.spyOn(theme, 'initRenderer').mockResolvedValue(true);
        let warmingWave;
        vi.spyOn(theme, 'precompileSceneWithTimeout').mockImplementation(async () => {
            [warmingWave] = theme.planetGroup.children;
            expect(warmingWave.visible).toBe(true);
            expect(warmingWave.geometry.parameters.radius).toBe(288);
            expect(warmingWave.geometry.parameters.tube).toBe(1.3);
            expect(theme.cosmicWavePool).toHaveLength(0);
        });
        vi.spyOn(theme, 'startAnimation').mockImplementation(() => {
            expect(warmingWave.visible).toBe(false);
            expect(warmingWave.parent).toBeNull();
            expect(theme.cosmicWavePool).toEqual([warmingWave]);
        });
        await theme.createScene();
        expect(theme.startAnimation).toHaveBeenCalledOnce();
        theme.handlePieceLock();
        expect(theme.cosmicWaves[0]).toBe(warmingWave);
        theme.updateCosmicWaves(1);
        theme.disposeCosmicWavePool();
    });

    it('limits repeated piece locks and reuses their retired geometry', () => {
        const theme = runtime();
        for (let i = 0; i < 30; i++) theme.handlePieceLock();
        expect(theme.cosmicWaves).toHaveLength(2);
        const geometries = new Set(theme.cosmicWaves.map((wave) => wave.geometry));
        expect(theme.cosmicWaves[0].userData.uniforms.uOpacity.value).toBe(0.24);
        theme.updateCosmicWaves(0.8);
        expect(theme.cosmicWaves).toHaveLength(0);
        expect(theme.cosmicWavePool).toHaveLength(2);
        theme.handlePieceLock();
        expect(geometries.has(theme.cosmicWaves[0].geometry)).toBe(true);
        expect(theme.cosmicWaves[0].userData.uniforms.uOpacity.value).toBe(0.24);
        theme.updateCosmicWaves(1);
        theme.disposeCosmicWavePool();
    });

    it('bounds sustained combo waves and preserves them when piece locks arrive', () => {
        const theme = runtime();
        for (let i = 0; i < 100; i++) theme.createCosmicWave(6);
        expect(theme.cosmicWaves).toHaveLength(NOIR_WAVE_LIMIT);
        const established = [...theme.cosmicWaves];
        theme.handlePieceLock();
        expect(theme.cosmicWaves).toEqual(established);
        theme.updateCosmicWaves(2);
        expect(theme.cosmicWavePool.length).toBeLessThanOrEqual(NOIR_WAVE_LIMIT);
        theme.disposeCosmicWavePool();
    });

    it('reuses a finite shape palette under repeated high combos', () => {
        const theme = runtime();
        theme.registerDeferredTimeout = (callback) => callback();
        theme.onLineClear(4, 10);
        const firstGeometries = new Set(theme.cosmicWaves.map((wave) => wave.geometry));
        expect(theme.cosmicWaves).toHaveLength(7);
        const shockwaves = theme.cosmicWaves.slice(4);
        expect(shockwaves.map((wave) => wave.geometry.parameters.radius))
            .toEqual(NOIR_SHOCKWAVE_SHAPES.map((shape) => shape.radius));
        theme.updateCosmicWaves(2);
        theme.onLineClear(4, 10);
        expect(theme.cosmicWaves.every((wave) => firstGeometries.has(wave.geometry))).toBe(true);
        theme.updateCosmicWaves(2);
        theme.disposeCosmicWavePool();
    });

    it('consumes pending combo state even when the clear carries an explicit combo', () => {
        const theme = runtime();
        theme.onLineClear = vi.fn();
        theme.handleCombo({ comboCount: 3 });
        theme.handleLineClear({ lineCount: 2, comboCount: 4 });
        theme.handleLineClear({ lineCount: 1 });
        expect(theme.onLineClear.mock.calls).toEqual([[2, 4], [1, 0]]);
        theme.handleCombo({ comboCount: 2 });
        theme.handleLineClear({ lineCount: 1 });
        expect(theme.onLineClear).toHaveBeenLastCalledWith(1, 2);
        expect(theme.pendingComboCount).toBe(0);
    });
});
