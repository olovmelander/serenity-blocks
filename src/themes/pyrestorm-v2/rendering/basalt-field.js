/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Basalt Field
 *
 * Instanced basalt spires scattered across the flat molten plain that rings the
 * volcano, plus a handful of large foreground "hero" rocks that frame the lower
 * corners of the shot and give the scene a sense of scale (a depth/composition
 * cue the old uniform spire field lacked). One lit rock material, one draw call.
 */
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createRockMaterial } from '../materials/rock-material.js';

const PLAIN_Y = -150;

// A few mid-ground rocks off to the sides that frame the shot without walling
// off the volcano. Heights are modest (~250–340 units) — NOT the 1700-unit
// monoliths the old scale bug produced.
const HERO_ROCKS = [
    { x: -640, z: 560, scale: 1.9 },
    { x: 660, z: 600, scale: 1.7 },
    { x: -420, z: 360, scale: 1.3 },
    { x: 500, z: 400, scale: 1.4 },
];

export function createBasaltField({ spireCount = 600 } = {}) {
    const total = spireCount + HERO_ROCKS.length;

    const geo = new THREE.ConeGeometry(26, 110, 5);
    geo.translate(0, 55, 0); // pivot at base
    geo.computeVertexNormals();

    const { material, uniforms } = createRockMaterial({
        baseColor: vec3(0.07, 0.05, 0.055),
    });

    const mesh = new THREE.InstancedMesh(geo, material, total);
    const dummy = new THREE.Object3D();

    // Scattered spires spread far across the plain (1700–9000), strongly biased
    // outward so they read as a distant basalt field, not a foreground wall.
    for (let i = 0; i < spireCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 1700 + (Math.random() ** 2) * 7300;
        dummy.position.set(Math.cos(angle) * dist, PLAIN_Y, Math.sin(angle) * dist);

        const heavy = Math.random() > 0.92;
        const scale = heavy ? 1.3 + Math.random() * 0.9 : 0.4 + Math.random() * 0.7;
        dummy.scale.set(scale, scale * (1.0 + Math.random() * 0.5), scale);
        dummy.rotation.set(
            (Math.random() - 0.5) * 0.25,
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * 0.25,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }

    // Framing rocks (modest height multiplier — the bug was scale × h ≈ 14×).
    HERO_ROCKS.forEach((r, k) => {
        dummy.position.set(r.x, PLAIN_Y, r.z);
        dummy.scale.set(r.scale, r.scale * 1.4, r.scale);
        dummy.rotation.set(
            (Math.random() - 0.5) * 0.18,
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * 0.18,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(spireCount + k, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms,
        dispose() {
            geo.dispose();
            material.dispose();
        },
    };
}
