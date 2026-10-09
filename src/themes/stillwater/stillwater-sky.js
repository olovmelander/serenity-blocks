/**
 * Stillwater — the sky and the far wood.
 *
 * One dome that draws the whole distance along the view ray: the night, the moon in its halo,
 * the stars, the northern lights and rank behind rank of spruce going into the mist
 * (swBackdrop, stillwater-tsl.js). It is drawn LAST among the opaque parts, depth-tested, so its
 * shader runs only where the distance shows between the trunks.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, normalize, positionWorld, vec4,
} from 'three/tsl';
import { swBackdrop, swPart } from './stillwater-tsl.js';

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.lite=false]  the cut-down sky of the lowest tier
 */
export function createSky(u, opts = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition));
        return vec4(swBackdrop(u, dir, { lite: opts.lite === true }), 1.0);
    })();
    const geometry = new THREE.SphereGeometry(900, 40, 20);
    return swPart('StillwaterSky', geometry, material, 40);
}
