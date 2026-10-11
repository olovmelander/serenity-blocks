/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — STUB (to be built): the air
 */
import * as THREE from 'three/webgpu';

function emptyPart(name) {
    const mesh = new THREE.Group();
    mesh.name = `moonlit-greenhouse-${name}`;
    return { mesh, dispose() { mesh.removeFromParent(); } };
}
export function createFireflies() { return emptyPart('fireflies'); }
export function createMoths() { return emptyPart('moths'); }
export function createMotes() { return emptyPart('motes'); }
export function createDew() { return emptyPart('dew'); }
