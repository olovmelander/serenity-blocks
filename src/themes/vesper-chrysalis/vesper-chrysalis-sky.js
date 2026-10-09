/**
 * Vesper Chrysalis — the sky.
 *
 * One dome that draws the whole distance along the view ray: the dusk, the stars, the ringed
 * world, the evening star, the aurora, the clouds and the ranges (vcBackdrop,
 * vesper-chrysalis-tsl.js). It is drawn LAST among the opaque parts, depth-tested, so its shader
 * runs only where the sky shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, normalize, positionWorld, vec4,
} from 'three/tsl';
import { vcBackdrop, vcPart } from './vesper-chrysalis-tsl.js';

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.lite=false]  the cut-down sky of the lowest tier
 */
export function createSky(u, opts = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition));
        return vec4(vcBackdrop(u, dir, { lite: opts.lite === true }), 1.0);
    })();
    const geometry = new THREE.SphereGeometry(5200, 48, 24);
    return vcPart('VesperChrysalisSky', geometry, material, 40);
}
