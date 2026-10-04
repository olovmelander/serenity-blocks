import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { getMoonPositionForCamera } from '../../src/playground/effects/moonlit-forest-master.effect.js';

function cameraFor(width, height) {
    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 2400);
    camera.position.set(0, 22, 86);
    camera.lookAt(0, 14, -104);
    camera.updateProjectionMatrix();
    return camera;
}

describe('Moonlit Forest lunar framing', () => {
    it('preserves the authored desktop position', () => {
        expect(getMoonPositionForCamera(cameraFor(1440, 900)).toArray()).toEqual([74, 94, -285]);
    });

    it.each([[390, 844], [320, 740], [844, 390]])('keeps the moon and halo visible at %sx%s', (width, height) => {
        const camera = cameraFor(width, height);
        const position = getMoonPositionForCamera(camera);
        const haloEdge = position.clone().add(new THREE.Vector3(31, 0, 0)).project(camera);
        expect(haloEdge.x).toBeLessThanOrEqual(0.94001);
        expect(position.y).toBe(94);
        expect(position.z).toBe(-285);
    });

    it('restores the desktop composition after rotation', () => {
        const camera = cameraFor(390, 844);
        expect(getMoonPositionForCamera(camera).x).toBeLessThan(74);
        camera.aspect = 844 / 390;
        camera.updateProjectionMatrix();
        expect(getMoonPositionForCamera(camera).x).toBe(74);
    });
});
