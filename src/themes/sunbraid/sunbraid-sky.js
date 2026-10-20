/**
 * Sunbraid — the sky: one dome drawn last among the opaque parts (shaded only where the sky shows),
 * the three suns' discs, aureoles and horizon glows from sunbraid-tsl skyColor().
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, normalize, positionWorld, vec4,
} from 'three/tsl';
import { skyColor } from './sunbraid-tsl.js';

export function createSky(u, t) {
    const geometry = new THREE.SphereGeometry(30000, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        return vec4(skyColor(u, dir, { clouds: t.noise, ribbons: true }), 1.0);
    })();
    material.fog = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Sunbraid sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1000;
    return {
        mesh,
        material,
        geometry,
        update(time, dt, world) {
            mesh.position.copy(world.eyeVector);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
