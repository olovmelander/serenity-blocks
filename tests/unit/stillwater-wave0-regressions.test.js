import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import StillwaterTheme from '../../src/themes/stillwater/stillwater-theme.js';

const loaderState = vi.hoisted(() => ({ queue: [] }));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class MockGLTFLoader {
        loadAsync() {
            const next = loaderState.queue.shift();
            return next ?? Promise.reject(new Error('No GLB response queued for test'));
        }
    },
}));

const themeSource = readFileSync(
    new URL('../../src/themes/stillwater/stillwater-theme.js', import.meta.url),
    'utf8',
);
const shaderSource = readFileSync(
    new URL('../../src/themes/stillwater/stillwater-shaders.js', import.meta.url),
    'utf8',
);
const sharedRendererSource = readFileSync(
    new URL('../../src/rendering/renderer.js', import.meta.url),
    'utf8',
);

function createPoolTheme() {
    const theme = new StillwaterTheme();
    theme.scene = new THREE.Scene();
    theme.mainGroup = new THREE.Group();
    theme.scene.add(theme.mainGroup);
    theme.createLightBeams();
    theme.createReactionPools();
    return theme;
}

function createRafHarness() {
    let nextId = 1;
    const callbacks = new Map();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => callbacks.delete(id)));
    vi.stubGlobal('document', {
        getElementById: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
    });
    return callbacks;
}

afterEach(() => {
    loaderState.queue.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Stillwater Wave 0 regression gates', () => {
    it('keeps GLSL masks defined and the output color transform explicit', () => {
        const reversedNumericSmoothsteps = [...shaderSource.matchAll(
            /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g,
        )].filter((match) => Number(match[1]) > Number(match[2]));

        expect(reversedNumericSmoothsteps).toEqual([]);
        expect(shaderSource).toContain('float reflectionMix = clamp(');
        expect(shaderSource).toContain('uv += vec2(ripple * 0.6, ripple);');
        expect(shaderSource).toContain('pos.z += sin(');
        expect(themeSource).toContain('#include <tonemapping_fragment>');
        expect(themeSource).toContain('#include <colorspace_fragment>');
    });

    it('uses one deterministic, registered render loop and a clamped delta', () => {
        expect(themeSource).not.toContain('Math.random(');
        expect(themeSource).not.toContain('requestAnimationFrame(');
        expect(themeSource).not.toContain('this.spiritBursts');
        expect(themeSource).toContain('this._animationDriver = this.safeAnimate(');
        expect(themeSource).toContain('THREE.MathUtils.clamp(rawDelta, 0, 0.1)');
        expect(themeSource).toContain('smoothingAlpha(4, delta)');
        expect(themeSource).toContain('this.prewarmReactionPools();');
    });

    it('does not multiply RAF chains across repeated pause and resume cycles', () => {
        const callbacks = createRafHarness();
        const theme = new StillwaterTheme();
        theme.renderer = {};
        theme.isActive = true;
        theme.hasStarted = true;
        theme.lifecycleState = 'running';
        theme.shouldRenderFrame = vi.fn(() => true);
        theme.renderFrame = vi.fn();
        theme.clock.start = vi.fn();
        theme.clock.stop = vi.fn();
        theme.clock.getDelta = vi.fn(() => 0);

        theme.startAnimationLoop();
        for (let cycle = 0; cycle < 20; cycle++) {
            expect(theme.pause()).toBe(true);
            expect(callbacks.size).toBe(0);
            expect(theme.resume()).toBe(true);
            expect(callbacks.size).toBe(1);
        }

        theme.resume();
        expect(callbacks.size).toBe(1);
        expect(theme.renderFrame).toHaveBeenCalledTimes(21);
    });

    it('honors the shared frame gate before running Stillwater updates', () => {
        const callbacks = createRafHarness();
        const theme = new StillwaterTheme();
        theme.renderer = {};
        theme.isActive = true;
        theme.shouldRenderFrame = vi.fn(() => false);
        theme.renderFrame = vi.fn();
        theme.clock.start = vi.fn();
        theme.clock.getDelta = vi.fn(() => 0);

        theme.startAnimationLoop();

        expect(callbacks.size).toBe(1);
        expect(theme.shouldRenderFrame).toHaveBeenCalledTimes(1);
        expect(theme.renderFrame).not.toHaveBeenCalled();
    });

    it('reuses bounded reaction pools under a 48-lock burst', () => {
        const theme = createPoolTheme();
        theme.camera = {};
        theme.renderer = { render: vi.fn() };
        theme.prewarmReactionPools();
        expect(theme.renderer.render).toHaveBeenCalledTimes(1);
        expect(theme.ripples.every((entry) => !entry.visible)).toBe(true);
        expect(theme.lightBeams.every((entry) => !entry.visible)).toBe(true);
        expect(theme.spiritBurstSystem.visible).toBe(false);
        expect(theme.spiritBurstSystem.material.opacity).toBe(0.9);

        const rippleGeometryIds = theme.ripples.map((entry) => entry.geometry.uuid);
        const rippleMaterialIds = theme.ripples.map((entry) => entry.material.uuid);
        const beamGeometryIds = theme.lightBeams.map((entry) => entry.geometry.uuid);
        const beamMaterialIds = theme.lightBeams.map((entry) => entry.material.uuid);
        const burstGeometryId = theme.spiritBurstSystem.geometry.uuid;
        const burstMaterialId = theme.spiritBurstSystem.material.uuid;

        for (let lock = 0; lock < 48; lock++) {
            theme.createRipple(0.5, lock - 24, 3);
            theme.createSpiritBurst(lock - 24, 3);
            theme.createLightBeam();
        }
        theme.updateSpiritBurstSystem(1 / 60);

        expect(theme.ripples).toHaveLength(12);
        expect(theme.lightBeams).toHaveLength(4);
        expect(theme.ripples.map((entry) => entry.geometry.uuid)).toEqual(rippleGeometryIds);
        expect(theme.ripples.map((entry) => entry.material.uuid)).toEqual(rippleMaterialIds);
        expect(theme.lightBeams.map((entry) => entry.geometry.uuid)).toEqual(beamGeometryIds);
        expect(theme.lightBeams.map((entry) => entry.material.uuid)).toEqual(beamMaterialIds);
        expect(theme.spiritBurstSystem.geometry.uuid).toBe(burstGeometryId);
        expect(theme.spiritBurstSystem.material.uuid).toBe(burstMaterialId);
        expect(theme.spiritBurstSystem.geometry.attributes.position.count).toBe(144);
        expect(theme.spiritBurstSystem.userData.activeCount).toBeLessThanOrEqual(144);
        expect([...theme.spiritBurstSystem.userData.positions].every(Number.isFinite)).toBe(true);
        expect([...theme.spiritBurstSystem.userData.velocities].every(Number.isFinite)).toBe(true);
        expect(theme.ambientLightBeams).toHaveLength(4);
        expect(theme.ambientLightBeams.every((beam) => (
            Number.isFinite(beam.material.uniforms.uOpacity.value)
        ))).toBe(true);

        theme.disposeSceneResources();
    });

    it('keeps random domains deterministic and independent', () => {
        const first = new StillwaterTheme();
        const second = new StillwaterTheme();
        for (let i = 0; i < 20; i++) first.layoutRandom();

        expect(Array.from({ length: 8 }, () => first.reactionRandom())).toEqual(
            Array.from({ length: 8 }, () => second.reactionRandom()),
        );
        expect(Array.from({ length: 8 }, () => first.behaviorRandom())).toEqual(
            Array.from({ length: 8 }, () => second.behaviorRandom()),
        );
    });

    it('disposes a GLB that resolves after its runtime was stopped', async () => {
        let resolveLoad;
        loaderState.queue.push(new Promise((resolve) => { resolveLoad = resolve; }));
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshBasicMaterial();
        const geometryDispose = vi.spyOn(geometry, 'dispose');
        const materialDispose = vi.spyOn(material, 'dispose');
        const root = new THREE.Group();
        root.add(new THREE.Mesh(geometry, material));
        const gltf = { scene: root, animations: [] };

        const theme = new StillwaterTheme();
        theme.scene = new THREE.Scene();
        theme.mainGroup = new THREE.Group();
        theme.scene.add(theme.mainGroup);
        theme.isActive = true;
        const generation = ++theme._runtimeGeneration;
        const pendingLoad = theme.createHeroTroll(generation);

        theme.stop();
        resolveLoad(gltf);

        await expect(pendingLoad).resolves.toBe(false);
        expect(theme.heroTroll).toBeNull();
        expect(root.parent).toBeNull();
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);
    });

    it('keeps Stillwater particles out of the shared renderer', () => {
        expect(sharedRendererSource).not.toMatch(/themeName\s*===\s*['"]stillwater['"]/);
        expect(sharedRendererSource).toContain('this.lastFrameDrawCalls = currentFrameDrawCalls;');
    });
});
