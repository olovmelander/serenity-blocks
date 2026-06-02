/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Drifting Light-Mote Glints
 *
 * A field of fine pollen / light motes drifting on the wind over the meadow,
 * catching the low golden-hour sun and twinkling — the look bible's "selective,
 * stable glitter/spark accents" (anchor #5).
 *
 * Rendered as camera-facing BILLBOARD QUADS (not PointsNodeMaterial): point
 * sprites need `gl_PointCoord` (`pointUV`), which is invalid WGSL on this
 * WebGPU/ANGLE-D3D11 backend, and `uv()` collapses the round mask to 0. Each
 * quad billboards via the camera basis (cameraViewMatrix columns) and gets its
 * round mask from the corner position — no point-sprite coord needed.
 *
 * Analytic motion (no compute): a horizontal wind flow that WRAPS across the
 * volume + a gentle bob + a stable twinkle. Reads the shared `u` block.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, attribute, cameraViewMatrix, float, length, mod, positionLocal, sin, smoothstep, vec3,
} from 'three/tsl';

const SPAN_X = 980; // horizontal wrap span
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export function createGlints(u, opts = {}) {
    const count = Math.max(60, Math.floor(opts.count ?? 600));
    const positions = []; // corner (x,y) packed in position.xy, z=0
    const bases = [];
    const rands = [];
    const sizes = [];
    const indices = [];

    for (let i = 0; i < count; i += 1) {
        const bx = (Math.random() - 0.5) * SPAN_X;
        const by = 2 + Math.random() * 58;
        const bz = -440 + Math.random() * 600;
        const r0 = Math.random();
        const r1 = Math.random();
        const r2 = Math.random();
        const s = 0.7 + Math.random() * 1.7; // world-space half-size
        const base = positions.length / 3;
        for (let c = 0; c < 4; c += 1) {
            positions.push(CORNERS[c][0], CORNERS[c][1], 0);
            bases.push(bx, by, bz);
            rands.push(r0, r1, r2);
            sizes.push(s);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aBase', new THREE.Float32BufferAttribute(bases, 3));
    geometry.setAttribute('aRand', new THREE.Float32BufferAttribute(rands, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // MeshBasicNodeMaterial references `normal` → avoid per-frame "normal not found" rebuild
    geometry.frustumCulled = false;

    const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, fog: false });
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const aBase = attribute('aBase');
    const aRand = attribute('aRand');
    const aSize = attribute('aSize');
    const phase = aRand.x.mul(6.2831);
    const windSpeed = float(4.0).add(u.uGust.mul(34.0));

    material.positionNode = Fn(() => {
        const corner = positionLocal.xy;
        const wx = mod(
            aBase.x.add(u.uTime.mul(windSpeed)).add(aRand.x.mul(SPAN_X)).add(SPAN_X * 0.5),
            float(SPAN_X),
        ).sub(SPAN_X * 0.5);
        const wy = aBase.y.add(sin(u.uTime.mul(0.5).add(phase)).mul(3.5))
            .add(sin(u.uTime.mul(0.21).add(phase.mul(1.7))).mul(2.2));
        const wz = aBase.z.add(sin(u.uTime.mul(0.32).add(phase.mul(1.3))).mul(6.0));
        const anchor = vec3(wx, wy, wz);
        // Camera-facing billboard via the view-matrix basis (no gl_PointCoord).
        const right = vec3(cameraViewMatrix.element(0).x, cameraViewMatrix.element(1).x, cameraViewMatrix.element(2).x);
        const up = vec3(cameraViewMatrix.element(0).y, cameraViewMatrix.element(1).y, cameraViewMatrix.element(2).y);
        const sz = aSize.mul(float(1.0).add(u.uGust.mul(0.5)));
        return anchor.add(right.mul(corner.x.mul(sz))).add(up.mul(corner.y.mul(sz)));
    })();

    const twinkle = float(0.6).add(sin(u.uTime.mul(2.4).add(phase.mul(7.0))).mul(0.4));
    material.colorNode = vec3(1.0, 0.95, 0.82).mul(u.uSunColor).mul(twinkle);

    // Round soft mask from the quad corner (−1..1) → no point-sprite coord needed.
    const r = length(positionLocal.xy);
    const mask = float(1.0).sub(smoothstep(float(0.1), float(1.0), r));
    const fieldAlpha = float(0.12).add(u.uGust.mul(0.34));
    material.opacityNode = mask.mul(twinkle).mul(fieldAlpha);
    material.emissiveNode = vec3(0.5, 0.47, 0.4).mul(mask).mul(0.3);
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
