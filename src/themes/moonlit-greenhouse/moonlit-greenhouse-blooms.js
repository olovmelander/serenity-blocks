/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — STUB (to be built): the blooms
 */
import * as THREE from 'three/webgpu';

function emptyPart(name) {
    const mesh = new THREE.Group();
    mesh.name = `moonlit-greenhouse-${name}`;
    return { mesh, dispose() { mesh.removeFromParent(); } };
}
export function createBlooms() {
    const part = emptyPart('blooms');
    const list = [];
    part.add = (b) => { list.push({ ...b, rgb: [...b.rgb] }); return list[list.length - 1]; };
    part.release = (count, at, out) => { const n = Math.min(count, list.length); for (let i = 0; i < n; i += 1) out.push({ ...list.shift(), at }); return out; };
    part.lights = (clock) => list.filter((b) => clock >= b.at).map((b) => ({ x: b.x, y: b.y + 0.3, z: b.z, strength: 1, rgb: b.rgb, radius: 1.6 }));
    part.count = () => list.length;
    part.reset = () => { list.length = 0; };
    return part;
}
export function createQueen() { return emptyPart('queen'); }
