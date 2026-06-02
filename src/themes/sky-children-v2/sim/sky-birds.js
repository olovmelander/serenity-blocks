/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Bird Flock (Phase 7.2)
 *
 * A persistent flock of small pale birds wheeling slowly across the sky between
 * the peak and the clouds — the flock from the Sky-COTL key art. Procedural
 * (no assets): a tiny dart body + two articulated wings in the canonical frame
 * (head +Z, wings ±X, up +Y). The flap is in the vertex shader (each wing rotates
 * about its shoulder, tips lag the root → a real wing-flex), decorrelated per
 * bird via a per-instance phase; flap deepens + the flock scatters on combos
 * (driven by the MoodDirector's gust/scatter).
 *
 * One InstancedMesh (built ONCE); CPU updates the formation each frame. Reads the
 * shared `u` block so the birds backlight-warm with the sun. Adapted from
 * himalayan-peak/rendering/peak-eagles.js. See docs/SKY_CHILDREN_V2_AAA_PLAN.md §7.2.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, abs, attribute, cos, float, mix, positionLocal, sin, smoothstep, uniform, vec3,
} from 'three/tsl';

const SHOULDER_X = 0.06;

function buildBirdGeometry() {
    const positions = [];
    const aWing = []; // -1 left, 0 body, +1 right
    const aSpan = []; // 0 shoulder → 1 tip
    const indices = [];
    const push = (x, y, z, w, s) => {
        positions.push(x, y, z); aWing.push(w); aSpan.push(s);
        return positions.length / 3 - 1;
    };

    // Body — a slim dart (head +Z → tail −Z).
    const head = push(0, 0, 0.52, 0, 0);
    const tail = push(0, 0, -0.46, 0, 0);
    const bl = push(-0.05, 0, 0.04, 0, 0);
    const br = push(0.05, 0, 0.04, 0, 0);
    indices.push(head, bl, br, tail, br, bl);

    // Wings — root (shoulder) → mid → swept tip, per side.
    [-1, 1].forEach((side) => {
        const r1 = push(side * SHOULDER_X, 0, 0.12, side, 0);
        const r2 = push(side * SHOULDER_X, 0, -0.20, side, 0);
        const mid = push(side * 0.52, 0.015, -0.04, side, 0.5);
        const tip = push(side * 1.0, 0.03, -0.30, side, 1.0);
        indices.push(r1, mid, r2, r1, tip, mid);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(aWing, 1));
    geometry.setAttribute('aSpan', new THREE.Float32BufferAttribute(aSpan, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
}

export function createSkyBirds(u, opts = {}) {
    const count = Math.max(3, Math.floor(opts.count ?? 9));
    const size = opts.size ?? 18;
    const geometry = buildBirdGeometry();

    // Per-bird flap phase (decorrelate the flock).
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i += 1) phases[i] = Math.random() * 6.2831;
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    const uTime = uniform(0);
    const uScatter = uniform(0);

    const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    const aWing = attribute('aWing');
    const aSpan = attribute('aSpan');
    const aPhase = attribute('aPhase');

    material.positionNode = Fn(() => {
        const isWing = abs(aWing);
        const flapSpeed = float(3.4).add(uScatter.mul(4.0));
        const amp = float(0.5).add(uScatter.mul(0.5)); // radians
        const dihedral = float(0.12);
        const phase = uTime.mul(flapSpeed).add(aPhase).sub(aSpan.mul(1.4)); // tips lag
        const flapAngle = dihedral.add(sin(phase).mul(amp));

        const shoulderX = aWing.mul(SHOULDER_X);
        const dx = positionLocal.x.sub(shoulderX);
        const dy = positionLocal.y;
        const ang = flapAngle.mul(aWing).mul(isWing);
        const ca = cos(ang);
        const sa = sin(ang);
        const wingX = shoulderX.add(dx.mul(ca).sub(dy.mul(sa)));
        const wingY = dx.mul(sa).add(dy.mul(ca));
        return vec3(wingX, wingY, positionLocal.z);
    })();

    // Pale birds, backlit-warm from the sun, darker underwing for read.
    material.colorNode = Fn(() => {
        const tipGlow = smoothstep(float(0.4), float(1.0), aSpan);
        const body = vec3(0.92, 0.93, 0.96);
        const warm = u.uSunColor.mul(0.6);
        return mix(body, warm, tipGlow.mul(0.4));
    })();
    material.emissiveNode = vec3(0.0);
    material.userData.emitsBloom = false;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;

    // ── Formation + flock motion (CPU). ──
    const offsets = [];
    for (let i = 0; i < count; i += 1) {
        // Loose V / cluster around the leader.
        const row = Math.ceil(i / 2);
        const sideSign = i % 2 === 0 ? -1 : 1;
        offsets.push(new THREE.Vector3(
            sideSign * row * (22 + Math.random() * 10),
            (Math.random() - 0.5) * 16,
            row * (16 + Math.random() * 8) + (Math.random() - 0.5) * 8,
        ));
    }

    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _pos = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _scl = new THREE.Vector3(size, size, size);
    const FORWARD = new THREE.Vector3(0, 0, 1);
    const center = new THREE.Vector3();
    const prevCenter = new THREE.Vector3();

    function update(time, scatter = 0) {
        uTime.value = time;
        uScatter.value = scatter;

        // Slow wheeling path across the sky — lowered so the flock reads in-frame
        // (between the islands and the peak), not way up out of view.
        center.set(
            Math.sin(time * 0.045) * 620,
            162 + Math.sin(time * 0.07) * 26,
            -340 + Math.cos(time * 0.038) * 240,
        );
        _fwd.copy(center).sub(prevCenter);
        if (_fwd.lengthSq() < 1e-4) _fwd.set(1, 0, 0);
        _fwd.normalize();
        _q.setFromUnitVectors(FORWARD, _fwd);
        prevCenter.copy(center);

        const spread = 1 + scatter * 1.6;
        for (let i = 0; i < count; i += 1) {
            _pos.copy(offsets[i]).multiplyScalar(spread).applyQuaternion(_q).add(center);
            // gentle individual bob
            _pos.y += Math.sin(time * 0.8 + i * 1.7) * 5;
            _m.compose(_pos, _q, _scl);
            mesh.setMatrixAt(i, _m);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    update(0, 0);

    return {
        mesh,
        update,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
