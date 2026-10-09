/**
 * Stillwater — the banks and the stones.
 *
 * The ground is one mesh laid over the plan's height function (stillwater-plan.js): turf at the
 * water, mounds of moss, the wood's floor climbing away into the mist. The boulders are one
 * instanced stone, turned and stretched: moss on their backs, wet and dark at the waterline.
 * Both shade themselves with the night's shared light (swLight) and go into the shared mist.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    float,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    groundHeight, shoreDistance, STAGE, valueNoise,
} from './stillwater-plan.js';
import { swFog, swLight, swPart } from './stillwater-tsl.js';

/**
 * The ground. Triangles that lie wholly under deep water are left out.
 * @param {object} u
 * @param {object} [opts]
 * @param {number} [opts.cell=0.55]  metres between vertices
 */
export function createGround(u, opts = {}) {
    const cell = opts.cell ?? 0.55;
    const nx = Math.max(8, Math.round((STAGE.x1 - STAGE.x0) / cell));
    const nz = Math.max(8, Math.round((STAGE.z1 - STAGE.z0) / cell));
    const sx = (STAGE.x1 - STAGE.x0) / nx;
    const sz = (STAGE.z1 - STAGE.z0) / nz;
    const cols = nx + 1;
    const rows = nz + 1;
    const heights = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            heights[j * cols + i] = groundHeight(STAGE.x0 + i * sx, STAGE.z0 + j * sz);
        }
    }
    const at = (i, j) => heights[Math.max(0, Math.min(rows - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))];
    const positions = new Float32Array(cols * rows * 3);
    const normals = new Float32Array(cols * rows * 3);
    const shore = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const o = (j * cols + i) * 3;
            const x = STAGE.x0 + i * sx;
            const z = STAGE.z0 + j * sz;
            positions[o] = x;
            positions[o + 1] = heights[j * cols + i];
            positions[o + 2] = z;
            const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * sx);
            const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * sz);
            const l = Math.hypot(dx, 1, dz);
            normals[o] = -dx / l;
            normals[o + 1] = 1 / l;
            normals[o + 2] = -dz / l;
            shore[j * cols + i] = shoreDistance(x, z);
        }
    }
    const index = [];
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const a = j * cols + i;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            // Nothing is drawn where the bed lies deep: the water above it is opaque.
            if (Math.max(heights[a], heights[b], heights[c], heights[d]) < -0.5) continue;
            index.push(a, c, b, b, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
    geometry.setIndex(index);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterGround';
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        // The plan's coordinates (the stage may be drawn in on a narrow frame).
        const st = vec2(P.x.div(u.squeeze), P.z).toVar();
        const shoreD = attribute('aShore', 'float').toVar();
        const coarse = u.noise(st.mul(0.045).add(vec2(0.13, 0.71))).toVar();
        const fine = u.noise(st.mul(0.31).add(vec2(0.57, 0.29))).toVar();
        const grain = u.noise(st.mul(1.7)).toVar();
        // Cushions of moss break the needle floor; the slopes that face up keep the most.
        const N0 = normalize(normalWorld).toVar();
        const cushion = smoothstep(0.38, 0.62, coarse.r.mul(0.55).add(fine.g.mul(0.45)))
            .mul(smoothstep(0.55, 0.9, N0.y)).toVar();
        const N = normalize(N0.add(vec3(fine.b.sub(0.5), 0.0, fine.a.sub(0.5)).mul(cushion.mul(0.5).add(0.18)))
            .add(vec3(grain.r.sub(0.5), 0.0, grain.g.sub(0.5)).mul(0.22))).toVar();
        const floor = u.ground.mul(grain.b.mul(0.5).add(0.75));
        const moss = u.moss.mul(fine.r.mul(0.6).add(0.7)).mul(grain.a.mul(0.35).add(0.8));
        const albedo = mix(floor, moss, cushion.mul(0.9)).toVar();
        // Wet and dark where the water has been, pale dead grass on the lip above it.
        const wet = float(1.0).sub(smoothstep(-0.05, 0.42, shoreD));
        albedo.mulAssign(float(1.0).sub(wet.mul(0.55)));
        const lip = smoothstep(0.25, 0.7, shoreD).mul(float(1.0).sub(smoothstep(0.9, 1.9, shoreD)));
        albedo.assign(mix(albedo, u.moss.mul(0.6).add(u.stone.mul(0.35)), lip.mul(coarse.b).mul(0.6)));
        const col = swLight(u, albedo, N, P);
        return vec4(swFog(u, col, P), 1.0);
    })();
    return swPart('StillwaterGround', geometry, material, 8);
}

/** One lumpy stone, about a unit sphere. Wound outward (pinned by the meshes test). */
export function createBoulderGeometry(detail = 3, seed = 17.3) {
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    const pos = geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        // Big planes and shoulders first, then a little grain: a glacier's stone, not a ball.
        const big = valueNoise(v.x * 1.3 + seed, v.y * 1.3 + v.z * 1.7 - seed);
        const mid = valueNoise(v.x * 3.1 - v.y * 2.3 + seed * 2, v.z * 3.3 + v.y * 1.1);
        const small = valueNoise(v.x * 8 + v.z * 5, v.y * 8 - v.z * 3 + seed);
        const r = 0.82 + (big - 0.5) * 0.42 + (mid - 0.5) * 0.2 + (small - 0.5) * 0.05;
        // A flattened underside, so it sits.
        const sit = v.y < -0.35 ? 1 - (-(v.y + 0.35)) * 0.35 : 1;
        pos.setXYZ(i, v.x * r, v.y * r * sit, v.z * r);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * The boulders (stage space: the caller puts the mesh in the stage group).
 * @param {object} u
 * @param {Array} plan  planBoulders()
 * @param {object} [opts]
 * @param {number} [opts.detail=3]
 */
export function createBoulders(u, plan, opts = {}) {
    const geometry = createBoulderGeometry(opts.detail ?? 3);
    // IcosahedronGeometry is not indexed: merge nothing, just smooth the normals by position.
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterBoulders';
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N0 = normalize(normalWorld).toVar();
        const n1 = u.noise(vec2(P.x.add(P.y.mul(0.6)), P.z.sub(P.y.mul(0.4))).mul(0.37)).toVar();
        const n2 = u.noise(vec2(P.x.sub(P.y), P.z.add(P.y)).mul(1.9)).toVar();
        const N = normalize(N0.add(vec3(n2.r.sub(0.5), n2.g.sub(0.5), n2.b.sub(0.5)).mul(0.3))).toVar();
        // Moss lies on what faces up, in from the edges; lichen pales the flanks.
        const top = smoothstep(0.25, 0.75, N0.y.add(n1.r.sub(0.5).mul(0.6)));
        const stone = u.stone.mul(n2.a.mul(0.5).add(0.72)).mul(mix(float(1.0), float(1.35), smoothstep(0.55, 0.8, n1.g)));
        const moss = u.moss.mul(n2.b.mul(0.5).add(0.75));
        const albedo = mix(stone, moss, top.mul(0.92)).toVar();
        const wet = float(1.0).sub(smoothstep(0.02, 0.3, P.y));
        albedo.mulAssign(float(1.0).sub(wet.mul(0.6)));
        const col = swLight(u, albedo, N, P, { wrap: 0.3 });
        return vec4(swFog(u, col, P), 1.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, plan.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    plan.forEach((b, i) => {
        e.set(Math.sin(b.seed) * 0.12, b.yaw, Math.cos(b.seed * 1.7) * 0.12);
        q.setFromEuler(e);
        p.set(b.x, b.y, b.z);
        s.set(b.size[0], b.size[1] * (b.flat ? 0.9 : 1), b.size[2]);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
    });
    mesh.count = plan.length;
    mesh.instanceMatrix.needsUpdate = true;
    const part = swPart('StillwaterBoulders', geometry, material, 6, { mesh });
    part.count = plan.length;
    return part;
}
