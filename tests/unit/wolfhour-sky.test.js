import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createWolfhourSky } from '../../src/themes/wolfhour/wolfhour-sky.js';
import { resolveWolfhourComposition } from '../../src/themes/wolfhour/wolfhour-composition.js';

const owners = [];

function createSky(quality = 'High') {
    const sky = createWolfhourSky({ scene: new THREE.Scene(), quality });
    owners.push(sky);
    return sky;
}

function vectorUniform(node) {
    const uniforms = new Set();
    node.traverse((child) => {
        if (child.isUniformNode && child.value?.isVector2) uniforms.add(child);
    });
    expect(uniforms.size).toBe(1);
    return [...uniforms][0].value;
}

describe('Wolfhour celestial depth', () => {
    beforeEach(() => {
        vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    });
    afterEach(() => {
        for (const sky of owners.splice(0)) sky.dispose();
        vi.restoreAllMocks();
    });

    it('moves each layer by its intended apparent depth without accumulating offsets', () => {
        const sky = createSky();
        const layers = [
            [sky.group.getObjectByName('Wolfhour sky plane'), 0.025],
            [sky.group.getObjectByName('Wolfhour stars'), 0.045],
            [sky.moon, 0.085],
            [sky.halo, 0.085],
            [sky.group.getObjectByName('Wolfhour valley mist'), 0.75],
        ].map(([object, response]) => ({ object, response, base: object.position.clone() }));
        const camera = new THREE.OrthographicCamera();
        for (const [x, y] of [[37, -22], [-13, 20], [0, 0]]) {
            camera.position.set(x, y, 1000);
            sky.applyParallax(camera);
            for (const { object, response, base } of layers) {
                expect(object.position.x - x - base.x).toBeCloseTo(-x * response, 10);
                expect(object.position.y - y - base.y).toBeCloseTo(-y * response, 10);
                expect(object.position.z).toBe(base.z);
            }
            expect(sky.halo.position.x).toBe(sky.moon.position.x);
            expect(sky.halo.position.y).toBe(sky.moon.position.y);
        }
    });

    it('keeps lunar sky glow and star attenuation centered on the moon after movement and resize', () => {
        const sky = createSky();
        const backdrop = sky.group.getObjectByName('Wolfhour sky plane');
        const stars = sky.group.getObjectByName('Wolfhour stars');
        const glowCenter = vectorUniform(backdrop.material.colorNode);
        const attenuationCenter = vectorUniform(stars.material.opacityNode);
        const camera = new THREE.OrthographicCamera();
        camera.position.set(48, -31, 1000);
        sky.applyParallax(camera);
        for (const aspect of [16 / 9, 9 / 16, 32 / 9]) {
            sky.resize(aspect);
            const composition = resolveWolfhourComposition(aspect);
            expect(sky.moon.position.x).toBeCloseTo(composition.moonX + 48 * 0.915, 10);
            expect(sky.moon.position.y).toBeCloseTo(composition.moonY - 31 * 0.915, 10);
            expect(glowCenter.x + backdrop.position.x).toBeCloseTo(sky.moon.position.x, 10);
            expect(glowCenter.y + backdrop.position.y).toBeCloseTo(sky.moon.position.y, 10);
            expect(attenuationCenter.x + stars.position.x).toBeCloseTo(sky.moon.position.x, 10);
            expect(attenuationCenter.y + stars.position.y).toBeCloseTo(sky.moon.position.y, 10);
        }
    });

    it('retains one immutable instanced star draw during camera motion', () => {
        const sky = createSky();
        const starDraws = sky.group.children.filter(object => object.isInstancedMesh);
        expect(starDraws).toHaveLength(1);
        const [stars] = starDraws;
        expect(stars.count).toBe(6000);
        const initial = stars.instanceMatrix.array.slice();
        const initialVersion = stars.instanceMatrix.version;
        const camera = new THREE.OrthographicCamera();
        for (let frame = 0; frame < 24; frame++) {
            camera.position.set(Math.sin(frame) * 30, Math.cos(frame) * 15, 1000);
            sky.update(frame / 60, { nebulaDefinition: 0.4 });
            sky.applyParallax(camera);
        }
        expect(stars.instanceMatrix.version).toBe(initialVersion);
        expect(stars.instanceMatrix.array.every((value, index) => value === initial[index])).toBe(true);
        expect(sky.moon.geometry.index.count / 3).toBeLessThan(3000);
    });
});
