/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Light-Spirits / Butterflies (Phase 7.7)
 *
 * Soft, colored glowing motes drifting in lazy orbits over the flower islands —
 * the Sky-COTL "light spirits / butterflies". Larger, slower and COLORED than the
 * fine white glints, with a gentle breathing pulse.
 *
 * Rendered as camera-facing BILLBOARD QUADS (not points): `pointUV`/`gl_PointCoord`
 * is invalid WGSL on this WebGPU/ANGLE-D3D11 backend and `uv()` collapses the
 * round mask to 0 (invisible). Each quad billboards via the camera basis and gets
 * its round mask from the corner position. Reads the shared `u` block (drifts
 * faster on combos via u.uGust).
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §7.7.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, attribute, cameraViewMatrix, cos, float, length, positionLocal, sin, smoothstep, vec3,
} from 'three/tsl';
import { ISLAND_REGIONS } from '../rendering/valley-terrain.js';

// Soft warm spirit colors (glow gently).
const SPIRIT_COLORS = [
    [1.0, 0.84, 0.46], // warm gold
    [1.0, 0.58, 0.74], // soft pink
    [0.62, 0.90, 1.0], // soft cyan
    [0.86, 0.74, 1.0], // lilac
    [1.0, 0.97, 0.86], // warm white
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export function createSpirits(u, opts = {}) {
    const count = Math.max(8, Math.floor(opts.count ?? 30));
    const positions = []; // corner.xy, z=0
    const anchors = []; // (centerX, baseY, centerZ)
    const colors = [];
    const phases = [];
    const sizes = [];
    const orbits = []; // (radius, speed)
    const indices = [];

    for (let i = 0; i < count; i += 1) {
        const isl = ISLAND_REGIONS[Math.floor(Math.random() * ISLAND_REGIONS.length)];
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * isl.r * 0.8;
        const cx = isl.x + Math.cos(a) * rr;
        const cy = 56 + Math.random() * 40;
        const cz = isl.z + Math.sin(a) * rr;
        const col = SPIRIT_COLORS[Math.floor(Math.random() * SPIRIT_COLORS.length)];
        const ph = Math.random() * 6.2831;
        const sz = 2.4 + Math.random() * 2.8; // world half-size
        const orbR = 6 + Math.random() * 16;
        const orbSpeed = (0.18 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1);
        const base = positions.length / 3;
        for (let c = 0; c < 4; c += 1) {
            positions.push(CORNERS[c][0], CORNERS[c][1], 0);
            anchors.push(cx, cy, cz);
            colors.push(col[0], col[1], col[2]);
            phases.push(ph);
            sizes.push(sz);
            orbits.push(orbR, orbSpeed);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAnchor', new THREE.Float32BufferAttribute(anchors, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aOrbit', new THREE.Float32BufferAttribute(orbits, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // avoid per-frame "normal not found" rebuild (MeshBasicNodeMaterial)
    geometry.frustumCulled = false;

    const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, fog: false });
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const aAnchor = attribute('aAnchor');
    const aColor = attribute('aColor');
    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');
    const aOrbit = attribute('aOrbit');

    material.positionNode = Fn(() => {
        const corner = positionLocal.xy;
        const speed = aOrbit.y.mul(float(1.0).add(u.uGust.mul(1.5)));
        const ang = u.uTime.mul(speed).add(aPhase);
        const anchor = vec3(
            aAnchor.x.add(cos(ang).mul(aOrbit.x)),
            aAnchor.y.add(sin(u.uTime.mul(0.5).add(aPhase)).mul(7.0)),
            aAnchor.z.add(sin(ang).mul(aOrbit.x)),
        );
        const right = vec3(cameraViewMatrix.element(0).x, cameraViewMatrix.element(1).x, cameraViewMatrix.element(2).x);
        const up = vec3(cameraViewMatrix.element(0).y, cameraViewMatrix.element(1).y, cameraViewMatrix.element(2).y);
        return anchor.add(right.mul(corner.x.mul(aSize))).add(up.mul(corner.y.mul(aSize)));
    })();

    const pulse = float(0.7).add(sin(u.uTime.mul(1.7).add(aPhase.mul(1.3))).mul(0.3));
    material.colorNode = aColor.mul(pulse).mul(1.2);

    // Round soft glow from the quad corner.
    const r = length(positionLocal.xy);
    const mask = float(1.0).sub(smoothstep(float(0.0), float(1.0), r));
    material.opacityNode = mask.mul(pulse).mul(0.9);
    material.emissiveNode = aColor.mul(mask).mul(0.4);
    material.userData.emitsBloom = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
