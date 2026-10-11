/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — STUB (to be built): the canal
 */
import * as THREE from 'three/webgpu';

function emptyPart(name) {
    const mesh = new THREE.Group();
    mesh.name = `moonlit-greenhouse-${name}`;
    return { mesh, dispose() { mesh.removeFromParent(); } };
}
export function createWater() { return emptyPart('water'); }
export function createPads() { return emptyPart('pads'); }
export function createReeds() { return emptyPart('reeds'); }
