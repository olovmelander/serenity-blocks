/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — the dome: `skyColour` along the view ray, the Deep included (there is no ground).
 *
 * Drawn after the solids with the depth test on (renderOrder 50), so the whole function is shaded
 * only where it shows; it follows the eye, so it is always at infinity.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, normalize, positionWorld, vec4,
} from 'three/tsl';
import { skyColour } from './sky-children-tsl.js';

export const SKY_RADIUS = 50000;

/**
 * @param {object} p
 * @param {object} p.tier  the quality tier
 * @param {object} p.U     the world's uniforms
 * @param {object} p.tex   { noise, lut }
 * @returns {{ mesh: THREE.Mesh, follow(camera: THREE.Camera): void, dispose(): void }}
 */
export function createSky({ tier, U, tex }) {
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        return vec4(skyColour(dir, U, tex, {
            slices: tier.cloudSlices,
            shower: true,
            stars: tier.starLayers,
            milky: tier.milky,
            shelves: tier.shelves,
            casters: tier.casters,
            optics: true,
            rays: true,
            cirrus: true,
            banks: true,
            calm: true,
            // The cloud sea is a mesh of its own: the dome keeps only the shelves under it.
            seaMesh: true,
        }), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-children-sky';
    mesh.scale.setScalar(SKY_RADIUS);
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    return {
        mesh,
        follow(camera) {
            mesh.position.copy(camera.position);
            mesh.updateMatrixWorld();
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
