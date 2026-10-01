import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';
import * as materialFactories from '../../src/themes/wolfhour/wolfhour-materials.js';
import { resolveWolfhourComposition, updateWolfhourCamera } from '../../src/themes/wolfhour/wolfhour-composition.js';

const themes = [];
function createTheme(quality = 'High') {
    const theme = new WolfhourTheme();
    theme.applyQualityPreset(quality);
    theme.scene = new THREE.Scene();
    theme.camera = new THREE.OrthographicCamera(-889, 889, 500, -500, 0.1, 10000);
    theme.camera.position.set(0, 0, 1000);
    theme.renderer = { isWebGPURenderer: true, getPixelRatio: () => 1 };
    theme.isWebGPU = true;
    theme.materialFactories = materialFactories;
    themes.push(theme);
    return theme;
}

describe('Wolfhour ambient integration', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720, location: { search: '?wolfhourSeed=73013' } });
        vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
        vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const theme of themes.splice(0)) {
            theme.renderer = null;
            theme.resetRuntimeScene();
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('connects lunar reaction aliases to the sky owner without constructing legacy ambient objects', () => {
        const theme = createTheme('Ultra');
        theme.createAmbientScene();
        expect(theme.scene.children).toContain(theme.celestialSky.group);
        expect(theme.scene.children).toContain(theme.alpineLandscape.group);
        expect(theme.moon).toBe(theme.celestialSky.moon);
        expect(theme.moonHalo).toBe(theme.celestialSky.halo);
        expect(theme.moonNodeData).toBe(theme.celestialSky.moonNodeData);
        expect(theme.moonHaloNodeData).toBe(theme.celestialSky.moonHaloNodeData);
        expect(theme.moonHaloNodeData.maxPulses).toBe(6);
        expect(theme.mountains).toEqual([]);
        expect(theme.nebulaPlanes).toEqual([]);
        expect(theme.starfield).toBeNull();
        expect(theme.groundFog).toBeNull();
        expect(theme.getRuntimeFeatureSnapshot().starCount).toBe(theme.celestialSky.starCount);
        expect(theme.celestialSky.starCount).toBeGreaterThan(0);
    });

    it('updates and expires real lunar uniforms while the shared effect energy decays', () => {
        const theme = createTheme();
        theme.createAmbientScene();
        theme.time = 8;
        theme.addEffectState({ mountainPulse: 1, nebulaDefinition: 1 });
        const slot = theme.triggerLunarReaction({ strength: 1, combo: 0.5, duration: 1.5 });
        theme.time = 8.5;
        expect(() => theme.updateEffects(0.5)).not.toThrow();
        theme.updateLunarReaction();
        theme.celestialSky.update(theme.time, theme.effectState);
        theme.alpineLandscape.update(theme.time, theme.effectState);
        expect(theme.moonNodeData.uniforms.uPulse.value).toBeGreaterThan(0);
        expect(theme.moonHaloNodeData.pulseValues[slot].z).toBeGreaterThan(0);
        expect(theme.effectState.mountainPulse).toBeLessThan(1);
        theme.time = 10;
        theme.updateLunarReaction();
        expect(theme.moonNodeData.uniforms.uPulse.value).toBe(0);
        expect(theme.moonHaloNodeData.pulseValues[slot].z).toBe(0);
    });

    it('spawns crashes against the new terrain when the legacy mountain list is empty', () => {
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        const origin = { x: -610, y: 0, z: 100 };
        expect(theme.mountains).toEqual([]);
        expect(theme.createMeteorCrash({ origin })).toBe(true);
        const crash = theme.meteorCrashes[0].userData;
        const target = theme.alpineLandscape.impactTarget(crash.targetX);
        expect(crash.targetX).toBe(target.x);
        expect(crash.targetY).toBe(target.y);
        expect(crash.targetZ).toBeGreaterThan(target.z);
        expect(crash.targetZ - target.z).toBeLessThan(30);
        expect([crash.startX, crash.startY, crash.startZ].every(Number.isFinite)).toBe(true);
        expect(crash.trail.geometry.getAttribute('position').array.every(Number.isFinite)).toBe(true);
    });

    it.each([9 / 16, 16 / 9])('distributes pooled crashes from one gameplay origin across both shoulders at aspect %s', (aspect) => {
        window.innerWidth = 720 * aspect;
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        let seed = 73013;
        theme.randomFn = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
        const payload = { origin: { x: -610, y: 0, z: 100 } };
        const targets = [];
        const localTargets = [];
        let pooledCrash;
        for (let index = 0; index < 20; index++) {
            theme.time = 8 + index * 6;
            theme.pointerX = index % 2 ? 1 : -1;
            theme.updateCameraAnimation(1);
            expect(theme.createMeteorCrash(payload)).toBe(true);
            const crash = theme.meteorCrashes[0];
            if (pooledCrash) expect(crash).toBe(pooledCrash);
            else pooledCrash = crash;
            const { targetX, targetY, targetZ } = crash.userData;
            expect([targetX, targetY, targetZ].every(Number.isFinite)).toBe(true);
            expect(targetX).toBeGreaterThan(theme.camera.position.x + theme.camera.left);
            expect(targetX).toBeLessThan(theme.camera.position.x + theme.camera.right);
            expect(targetY).toBeGreaterThan(theme.camera.position.y + theme.camera.bottom);
            expect(targetY).toBeLessThan(theme.camera.position.y + theme.camera.top);
            theme.scene.updateMatrixWorld(true);
            const local = theme.alpineLandscape.group.children[1].worldToLocal(new THREE.Vector3(targetX, targetY, targetZ));
            for (const previous of localTargets.slice(-2)) expect(Math.abs(local.x - previous)).toBeGreaterThan(40);
            targets.push(targetX);
            localTargets.push(local.x);
            theme.releaseMeteorCrash(0, crash);
        }
        expect(targets.filter(x => x < 0).length).toBeGreaterThan(2);
        expect(targets.filter(x => x > 0).length).toBeGreaterThan(2);
        expect(new Set(localTargets.map(x => Math.round(x))).size).toBeGreaterThan(12);
        expect(theme.effectPools.crash).toEqual([pooledCrash]);
    });

    it('does not consume an impact target when the crash pool is already at capacity', () => {
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        const selectTarget = vi.spyOn(theme.alpineLandscape, 'randomImpactTarget');
        const payload = { origin: { x: -610, y: 0, z: 100 } };
        expect(theme.createMeteorCrash(payload)).toBe(true);
        const active = theme.meteorCrashes[0];
        expect(selectTarget).toHaveBeenCalledTimes(1);
        for (let attempt = 0; attempt < 4; attempt++) {
            expect(theme.createMeteorCrash(payload)).toBe(false);
        }
        expect(theme.meteorCrashes).toEqual([active]);
        expect(selectTarget).toHaveBeenCalledTimes(1);
        theme.releaseMeteorCrash(0, active);
        expect(theme.createMeteorCrash(payload)).toBe(true);
        expect(theme.meteorCrashes[0]).toBe(active);
        expect(selectTarget).toHaveBeenCalledTimes(2);
    });

    it('randomizes legacy crash peaks within the camera view despite an identical gameplay origin', () => {
        const theme = createTheme();
        theme.ensureSharedGeometries();
        theme.camera.position.x = 80;
        theme.mountains = [
            [-600, -200, -600], [650, -200, -700],
            [-1300, -200, -800], [1300, -200, -900],
            [925, -200, -950], // Center fits, but its landing jitter could leave the view.
        ].map(([x, y, z]) => {
            const mountain = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
            mountain.position.set(x, y, z);
            return mountain;
        });
        expect(theme.alpineLandscape).toBeNull();
        let seed = 73013;
        theme.randomFn = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
        const selectedDepths = new Set();
        for (let index = 0; index < 20; index++) {
            theme.time = index * 6;
            expect(theme.createMeteorCrash({ origin: { x: -600, y: 0, z: 100 } })).toBe(true);
            const crash = theme.meteorCrashes[0];
            const { targetX, targetY, targetZ } = crash.userData;
            expect([targetX, targetY, targetZ].every(Number.isFinite)).toBe(true);
            // Distinct depths identify the selected peak independently of random
            // X jitter; neither offscreen nor unsafe edge peaks may be chosen.
            expect([-500, -600]).toContain(targetZ);
            expect(targetX).toBeGreaterThan(theme.camera.position.x + theme.camera.left);
            expect(targetX).toBeLessThan(theme.camera.position.x + theme.camera.right);
            selectedDepths.add(targetZ);
            theme.releaseMeteorCrash(0, crash);
        }
        expect(selectedDepths).toEqual(new Set([-500, -600]));
    });

    it('keeps portrait meteor impacts within the actual camera frame', () => {
        window.innerWidth = 360;
        window.innerHeight = 640;
        const theme = createTheme();
        theme.createAmbientScene();
        theme.updateCameraAnimation(0);
        theme.ensureSharedGeometries();
        expect(theme.createMeteorCrash({ origin: { x: 900, y: 0, z: 100 } })).toBe(true);
        const crash = theme.meteorCrashes[0].userData;
        expect(crash.targetX).toBeGreaterThan(theme.camera.position.x + theme.camera.left);
        expect(crash.targetX).toBeLessThan(theme.camera.position.x + theme.camera.right);
        expect(crash.targetY).toBeLessThan(theme.camera.position.y + theme.camera.top);
        expect(crash.targetY).toBeGreaterThan(theme.camera.position.y + theme.camera.bottom);
    });

    it.each([9 / 16, 16 / 9])('moves distant sky and successive ridges at distinct apparent rates at aspect %s', (aspect) => {
        window.innerWidth = 720 * aspect;
        const theme = createTheme('Low');
        theme.createAmbientScene();
        theme.time = 24;
        const objects = [
            theme.celestialSky.group.getObjectByName('Wolfhour sky plane'),
            theme.celestialSky.group.getObjectByName('Wolfhour stars'),
            theme.moon,
            ...theme.alpineLandscape.group.children,
        ];
        const screenPositions = () => {
            theme.scene.updateMatrixWorld(true);
            theme.camera.updateMatrixWorld(true);
            return objects.map(object => object.getWorldPosition(new THREE.Vector3()).project(theme.camera).x);
        };
        theme.pointerX = -1;
        theme.smoothedPointerX = -1;
        theme.updateCameraAnimation(0);
        const before = screenPositions();
        const cameraBefore = theme.camera.position.x;
        theme.pointerX = 1;
        theme.updateCameraAnimation(1);
        const after = screenPositions();
        expect(theme.camera.position.x).toBeGreaterThan(cameraBefore);
        const shifts = after.map((position, index) => before[index] - position);
        // This tests the actual theme wiring and matrices, without duplicating the
        // chosen parallax coefficients. A flat moving postcard fails these checks.
        expect(shifts.every(shift => Number.isFinite(shift) && shift > 0)).toBe(true);
        for (let index = 1; index < shifts.length; index++) {
            expect(shifts[index]).toBeGreaterThan(shifts[index - 1]);
        }
        expect(shifts.at(-1)).toBeGreaterThan(shifts[0] * 5);
    });

    it.each([9 / 16, 16 / 9])('keeps an impact on the same mountain point through camera motion at aspect %s', (aspect) => {
        window.innerWidth = 720 * aspect;
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        theme.time = 8;
        theme.pointerX = theme.smoothedPointerX = -1;
        theme.updateCameraAnimation(0);
        expect(theme.createMeteorCrash({ origin: { x: 600, y: 0, z: 0 } })).toBe(true);
        const crash = theme.meteorCrashes[0];
        const data = crash.userData;
        const hero = theme.alpineLandscape.group.children[1];
        theme.scene.updateMatrixWorld(true);
        // Preserve the physical terrain point, independently of the controller's
        // impact offset bookkeeping, and compare its actual projected position.
        const anchor = hero.worldToLocal(new THREE.Vector3(data.targetX, data.targetY, data.targetZ - 15));
        const checkAttachment = (object, point) => {
            theme.scene.updateMatrixWorld(true);
            theme.camera.updateMatrixWorld(true);
            const mountainScreen = hero.localToWorld(anchor.clone()).project(theme.camera);
            const impactScreen = object.localToWorld(point.clone()).project(theme.camera);
            expect(impactScreen.x).toBeCloseTo(mountainScreen.x, 9);
            expect(impactScreen.y).toBeCloseTo(mountainScreen.y, 9);
        };
        const target = new THREE.Vector3(data.targetX, data.targetY, data.targetZ);
        checkAttachment(crash, target);
        theme.pointerX = 1;
        theme.pointerY = 0.8;
        theme.time = 8.65;
        theme.updateCameraAnimation(0.65);
        theme.updateMeteorCrashes();
        expect(data.phase).toBe('descent');
        expect(crash.position.length()).toBeGreaterThan(1);
        checkAttachment(crash, target);

        theme.time = 9.5;
        theme.updateCameraAnimation(0.85);
        theme.updateMeteorCrashes();
        expect(data.phase).toBe('explosion');
        checkAttachment(data.shockwave, new THREE.Vector3());
        const impactPosition = crash.position.clone();
        theme.pointerX = -0.8;
        theme.pointerY = -0.6;
        theme.time = 10.5;
        theme.updateCameraAnimation(1);
        theme.updateMeteorCrashes();
        expect(crash.position.distanceTo(impactPosition)).toBeGreaterThan(1);
        checkAttachment(data.shockwave, new THREE.Vector3());
    });

    it('restarts pooled dust and debris on the first impact frame', () => {
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        theme.time = 8;
        const payload = { origin: { x: -600, y: 0, z: 0 } };
        expect(theme.createMeteorCrash(payload)).toBe(true);
        const crash = theme.meteorCrashes[0];
        const data = crash.userData;
        theme.time = data.startTime + data.duration + 0.01;
        theme.updateMeteorCrashes();
        const firstImpactTime = theme.time;
        theme.time = firstImpactTime + 2;
        theme.updateMeteorCrashes();
        expect(data.debrisNodeData.uniforms.uTime.value).toBeCloseTo(2);
        expect(data.dustNodeData.uniforms.uTime.value).toBeCloseTo(2);
        theme.time = firstImpactTime + 4.6;
        theme.updateMeteorCrashes();
        expect(theme.meteorCrashes).toHaveLength(0);
        expect(theme.effectPools.crash).toContain(crash);

        theme.time += 1;
        expect(theme.createMeteorCrash(payload)).toBe(true);
        expect(theme.meteorCrashes[0]).toBe(crash);
        theme.time = data.startTime + data.duration + 0.01;
        // The transition itself must reset the shader ages. An additional frame
        // would mask the stale pooled-uniform bug this regression guards.
        theme.updateMeteorCrashes();
        expect(data.phase).toBe('explosion');
        expect(data.debris.visible).toBe(true);
        expect(data.dustCloud.visible).toBe(true);
        expect(data.debrisNodeData.uniforms.uTime.value).toBe(0);
        expect(data.dustNodeData.uniforms.uTime.value).toBe(0);
    });

    it('keeps a live crash attached through portrait and ultrawide aspect changes', () => {
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        theme.time = 8;
        theme.pointerX = theme.smoothedPointerX = -0.6;
        theme.updateCameraAnimation(0);
        expect(theme.createMeteorCrash({ origin: { x: 600, y: 0, z: 0 } })).toBe(true);
        const crash = theme.meteorCrashes[0];
        const data = crash.userData;
        const hero = theme.alpineLandscape.group.children[1];
        theme.scene.updateMatrixWorld(true);
        const anchor = hero.worldToLocal(new THREE.Vector3(data.targetX, data.targetY, data.targetZ));
        const target = new THREE.Vector3(data.targetX, data.targetY, data.targetZ);
        const initialScale = theme.alpineLandscape.group.scale.x;
        const checkAttachment = (object, localPoint) => {
            theme.scene.updateMatrixWorld(true);
            theme.camera.updateMatrixWorld(true);
            const expected = hero.localToWorld(anchor.clone());
            const actual = object.localToWorld(localPoint.clone());
            expect(actual.x).toBeCloseTo(expected.x, 8);
            expect(actual.y).toBeCloseTo(expected.y, 8);
            expected.project(theme.camera);
            actual.project(theme.camera);
            expect(actual.x).toBeCloseTo(expected.x, 9);
            expect(actual.y).toBeCloseTo(expected.y, 9);
        };
        const resizeAndAdvance = (aspect, time, pointerX) => {
            const delta = time - theme.time;
            window.innerWidth = 720 * aspect;
            theme.celestialSky.resize(aspect);
            theme.alpineLandscape.resize(aspect);
            theme.pointerX = pointerX;
            theme.pointerY = -pointerX * 0.5;
            theme.time = time;
            theme.updateCameraAnimation(delta);
            theme.updateMeteorCrashes();
        };

        resizeAndAdvance(9 / 16, 8.6, 1);
        expect(data.phase).toBe('descent');
        expect(theme.alpineLandscape.group.scale.x).toBeLessThan(initialScale);
        checkAttachment(crash, target);

        resizeAndAdvance(32 / 9, 9.5, -1);
        expect(data.phase).toBe('explosion');
        expect(theme.alpineLandscape.group.scale.x).toBeGreaterThan(initialScale);
        checkAttachment(data.shockwave, new THREE.Vector3());

        // Returning to the original aspect must not accumulate resize offsets.
        resizeAndAdvance(16 / 9, 10.2, 0.8);
        expect(data.phase).toBe('explosion');
        expect(theme.alpineLandscape.group.scale.x).toBe(initialScale);
        checkAttachment(data.shockwave, new THREE.Vector3());
    });

    it('stops drawing an expired shockwave while its dust and debris finish fading', () => {
        const theme = createTheme();
        theme.createAmbientScene();
        theme.ensureSharedGeometries();
        expect(theme.createMeteorCrash({ origin: { x: 600, y: 0, z: 0 } })).toBe(true);
        const crash = theme.meteorCrashes[0];
        const data = crash.userData;
        theme.time = data.startTime + data.duration + 0.01;
        theme.updateMeteorCrashes();
        const impactTime = theme.time;
        theme.time = impactTime + 1.2;
        theme.updateMeteorCrashes();
        expect(data.shockwave.visible).toBe(true);
        theme.time = impactTime + 2.51;
        theme.updateMeteorCrashes();
        expect(data.shockwave.visible).toBe(false);
        expect(data.shockwaveNodeData.uniforms.uOpacity.value).toBe(0);
        expect(data.debris.visible).toBe(true);
        expect(data.dustCloud.visible).toBe(true);
        expect(crash.visible).toBe(true);
        expect(theme.meteorCrashes).toContain(crash);
        expect(data.debrisNodeData.uniforms.uTime.value).toBeCloseTo(2.51);
        expect(data.dustNodeData.uniforms.uTime.value).toBeCloseTo(2.51);
        theme.time = impactTime + 4.6;
        theme.updateMeteorCrashes();
        expect(crash.visible).toBe(false);
        expect(theme.meteorCrashes).toHaveLength(0);
    });

    it('preserves elapsed animation time when a 60 FPS cap skips alternate 120 Hz callbacks', () => {
        let nowMs = 1000;
        let callbackIndex = 0;
        let nextFrameId = 0;
        const callbacks = new Map();
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            const id = ++nextFrameId;
            callbacks.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', id => callbacks.delete(id));

        const theme = createTheme();
        theme.isActive = true;
        theme.fixedDeltaSeconds = null;
        theme.flags.baseline = false;
        theme.renderer.render = vi.fn();
        vi.spyOn(theme, 'shouldRenderFrame').mockImplementation(() => callbackIndex % 2 === 0);
        for (const method of [
            'updateCameraAnimation', 'updateLunarReaction', 'updateNebulas', 'updateEffects',
            'processReactiveQueue', 'updateMeteors', 'updateMeteorCrashes', 'updateComputeSystems',
        ]) {
            vi.spyOn(theme, method).mockImplementation(() => {});
        }

        // Exercise the real loop and THREE.Timer; only rendering and scene updates
        // are stubbed. Each accepted frame must include the preceding skipped frame.
        theme.startAnimation();
        for (callbackIndex = 1; callbackIndex <= 12; callbackIndex++) {
            nowMs = 1000 + callbackIndex * (1000 / 120);
            expect(callbacks.size).toBe(1);
            const [id, callback] = callbacks.entries().next().value;
            callbacks.delete(id);
            callback(nowMs);
            expect(theme.time).toBeCloseTo(Math.floor(callbackIndex / 2) / 60, 10);
            expect(theme.renderer.render).toHaveBeenCalledTimes(1 + Math.floor(callbackIndex / 2));
        }
        const deltas = theme.updateEffects.mock.calls.slice(1).map(([delta]) => delta);
        expect(deltas).toHaveLength(6);
        for (const delta of deltas) expect(delta).toBeCloseTo(1 / 60, 10);
        expect(theme.time).toBeCloseTo(0.1, 10);
    });

    it('disposes moon aliases once through their owner and allows a clean subsequent build', () => {
        const theme = createTheme('Low');
        theme.createAmbientScene();
        const scene = theme.scene;
        const oldMoon = theme.moon;
        const resources = [oldMoon.geometry, oldMoon.material, theme.moonHalo.geometry,
            theme.moonHalo.material, theme.celestialSky.moonTexture];
        const counts = new Map(resources.map(resource => [resource, 0]));
        for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
        theme.renderer = null;
        theme.resetRuntimeScene();
        theme.resetRuntimeScene();
        expect([...counts.values()]).toEqual(resources.map(() => 1));
        expect(scene.children).toEqual([]);
        for (const property of ['moon', 'moonHalo', 'moonNodeData', 'moonHaloNodeData', 'celestialSky', 'alpineLandscape']) {
            expect(theme[property]).toBeNull();
        }
        theme.scene = new THREE.Scene();
        theme.renderer = { isWebGPURenderer: true, getPixelRatio: () => 1 };
        theme.createAmbientScene();
        expect(theme.moon).not.toBe(oldMoon);
        expect(theme.scene.children).toHaveLength(2);
    });
});

describe('Wolfhour composition', () => {
    it.each([9 / 16, 16 / 9, 32 / 9])('keeps the moon within the frame through motion and pointer extremes at aspect %s', (aspect) => {
        const composition = resolveWolfhourComposition(aspect);
        const radius = 126 * composition.moonScale;
        const camera = new THREE.OrthographicCamera(-500 * aspect, 500 * aspect, 500, -500);
        for (const pointer of [-1, 1]) {
            for (let time = 0; time <= 240; time += 12) {
                updateWolfhourCamera(camera, time, aspect, pointer, -pointer, 2);
                expect(composition.moonX - radius).toBeGreaterThan(camera.position.x + camera.left);
                expect(composition.moonX + radius).toBeLessThan(camera.position.x + camera.right);
                expect(composition.moonY + radius).toBeLessThan(camera.position.y + camera.top);
                expect(composition.moonY - radius).toBeGreaterThan(camera.position.y + camera.bottom);
                expect(camera.rotation.z).toBe(0);
            }
        }
    });
});
