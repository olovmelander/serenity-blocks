/**
 * Grainfields — the ruin on the knoll.
 *
 * The old stone fort on its knoll in the vale (PLACES.fort), seen against the gate from a kilometre
 * and a half: a square keep with its walls broken down to different heights and a corner fallen,
 * a stub of a round tower beside it and a curtain wall round the knoll's crown with breaches in
 * it. Small on the skyline (a few dozen pixels), so it is drawn as blocks: one merged mesh of
 * boxes and a cylinder, its stone shaded by the shared light (lit faces, the dark inside of the
 * broken walls, lichen low down) and the air between.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    Fn,
    float,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec3,
    vec4,
} from 'three/tsl';
import { PLACES, mulberry32 } from './grainfields-core.js';
import { groundHeight } from './grainfields-plan.js';
import { aerial, lightSurface } from './grainfields-light.js';

/** The ruin's plan (metres): the keep's side and wall, the tower, the curtain wall's ring. */
export const FORT = Object.freeze({
    keep: 13, wall: 1.8, heights: [15, 10.5, 8.5, 13.5], tower: { r: 3.8, h: 9.5 }, ring: 27, curtain: [3.2, 6.0],
});

function box(w, h, d, x, y, z, yaw = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    if (yaw) g.rotateY(yaw);
    g.translate(x, y, z);
    return g;
}

/** The ruin's blocks in its own frame (y up from the knoll's crown). */
export function createFortGeometry() {
    const random = mulberry32(0xf027);
    const parts = [];
    const { keep, wall, heights } = FORT;
    const half = keep / 2;
    // The keep's four walls, each broken off at its own height; a merlon or two on the tallest.
    parts.push(box(keep, heights[0], wall, 0, 0, -half + wall / 2));
    parts.push(box(wall, heights[1], keep, half - wall / 2, 0, 0));
    parts.push(box(keep * 0.62, heights[2], wall, -keep * 0.19, 0, half - wall / 2));
    parts.push(box(wall, heights[3], keep, -half + wall / 2, 0, 0));
    parts.push(box(wall * 1.1, 2.2, wall, -half + 1.4, heights[0], -half + wall / 2));
    parts.push(box(wall * 1.1, 1.6, wall, 1.8, heights[0], -half + wall / 2));
    // The fallen corner: a heap of rubble.
    parts.push(box(4.5, 2.4, 4.0, half - 1.5, 0, half - 1.2, 0.3));
    parts.push(box(2.6, 1.3, 2.2, half + 1.2, 0, half + 1.4, -0.4));
    // The tower's stub.
    const tower = new THREE.CylinderGeometry(FORT.tower.r, FORT.tower.r * 1.08, FORT.tower.h, 12);
    tower.translate(-half - 2.5, FORT.tower.h / 2, -half - 2.5);
    parts.push(tower);
    // The curtain wall round the crown, breached in three places.
    const segments = 14;
    for (let i = 0; i < segments; i++) {
        if (i === 3 || i === 8 || i === 9 || i === 12) continue;
        const a = (i / segments) * Math.PI * 2;
        const len = (2 * Math.PI * FORT.ring) / segments + 0.4;
        const h = FORT.curtain[0] + (FORT.curtain[1] - FORT.curtain[0]) * random();
        parts.push(box(len, h, 1.4, Math.cos(a) * FORT.ring, 0, Math.sin(a) * FORT.ring, -a + Math.PI / 2));
    }
    const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
    parts.forEach((g) => g.dispose());
    merged.computeVertexNormals();
    return merged;
}

export function createFort(u, t) {
    const F = PLACES.fort;
    const geometry = createFortGeometry();
    const baseY = groundHeight(F.x, F.z);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsFort';
    material.fog = false;
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(normalWorld).toVar();
        // Grey stone, warmer where it has weathered, lichen and grass low down.
        const grain = texture(t.noise, P.xz.mul(0.09).add(P.y.mul(0.07))).g;
        const stone = mix(vec3(0.12, 0.115, 0.105), vec3(0.2, 0.18, 0.15), grain);
        const foot = float(1.0).sub(smoothstep(0.5, 3.0, P.y.sub(baseY)));
        const albedo = mix(stone, vec3(0.06, 0.08, 0.035), foot.mul(0.6));
        const lit = lightSurface(u, t.noise, P, N, albedo);
        return vec4(aerial(u, P, lit.colour), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsFort';
    mesh.position.set(F.x, baseY - 0.6, F.z);
    mesh.rotation.y = 0.35;
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
