/**
 * Sunbraid — the gliders: broad, thin-winged creatures riding the warm air over the valley
 * (flight in sunbraid-glide.js). Their membranes are pale and thin: seen against the suns they
 * glow in the suns' colours, and each throws three shadows that sweep the white floor (the world
 * writes their discs into the shadow rows every frame, sunbraid-tsl.js sunVisibility).
 *
 * One instanced mesh; per instance the body's transform (written each frame from the clock) and
 * its wingbeat and span (an interleaved dynamic buffer).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, abs, cos, float, max, mix, normalize, normalWorld, positionGeometry, positionLocal,
    positionWorld, smoothstep, uv, vec3, vec4, dot, fract,
} from 'three/tsl';
import { MAX_GLIDERS, gliderAt } from './sunbraid-glide.js';
import { groundHeight } from './sunbraid-plan.js';
import { TAU, haze, mist } from './sunbraid-tsl.js';

/**
 * A glider at unit span, nose toward −z: a broad leaf of a wing (a rounded diamond, rows across
 * so it can bend) and a long tapering tail. aWing = (how far out along the wing 0..1, 1 on the tail).
 */
export function buildGliderGeometry(across = 12, along = 10) {
    const pos = [];
    const wing = [];
    const uvs = [];
    const index = [];
    // The wing: rows along the body from the nose (v = 0) to the trailing notch (v = 1).
    const outline = (v) => {
        // Half-width at v: swelling to the wingtips at v ≈ 0.42, a rounded leading edge.
        const lead = Math.sin(Math.min(1, v / 0.42) * Math.PI * 0.5);
        const trail = 1 - Math.max(0, (v - 0.42) / 0.58) ** 1.4;
        return 0.5 * lead * trail;
    };
    for (let j = 0; j <= along; j++) {
        const v = j / along;
        const half = outline(v);
        const z = -0.32 + v * 0.62;
        for (let i = 0; i <= across; i++) {
            const s = (i / across) * 2 - 1;
            pos.push(s * half, 0, z);
            wing.push(Math.abs(s * half) * 2);
            uvs.push((s + 1) / 2, v);
        }
    }
    const cols = across + 1;
    for (let j = 0; j < along; j++) {
        for (let i = 0; i < across; i++) {
            const a = j * cols + i;
            index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
        }
    }
    // The tail: a tapering ribbon back from the notch.
    const base = pos.length / 3;
    const tailRows = 8;
    for (let j = 0; j <= tailRows; j++) {
        const v = j / tailRows;
        const z = 0.3 + v * 0.95;
        const w = 0.035 * (1 - v) + 0.004;
        pos.push(-w, 0, z, w, 0, z);
        wing.push(1, 1);
        uvs.push(0.48, 1 + v, 0.52, 1 + v);
    }
    for (let j = 0; j < tailRows; j++) {
        const a = base + j * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    // A vertex touched only by zero-area triangles (the nose) has no normal: give it the wing's.
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) {
        if (Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 1e-6) normals.setXYZ(i, 0, 1, 0);
    }
    return geometry;
}

export function createGliders(u, t, count) {
    const n = Math.max(0, Math.min(MAX_GLIDERS, count));
    const geometry = buildGliderGeometry();
    // Per instance: wingbeat (0..1), span (metres), spare, spare — one dynamic buffer.
    const beats = new Float32Array(Math.max(1, n) * 4);
    const beatBuffer = new THREE.InstancedInterleavedBuffer(beats, 4, 1);
    beatBuffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aBeat', new THREE.InterleavedBufferAttribute(beatBuffer, 4, 0));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const beat = attribute('aBeat', 'vec4');
    const wingOut = attribute('aWing', 'float');
    // The wingbeat: a slow downstroke rolling out to the tips, the tail trailing it.
    const phase = beat.x.mul(TAU);
    const tailWave = cos(phase.mul(0.5).sub(positionGeometry.z.mul(5.0))).mul(smoothstep(0.3, 1.2, positionGeometry.z));
    const flap = cos(phase.sub(wingOut.mul(1.4))).mul(wingOut.mul(wingOut)).mul(0.09)
        .add(tailWave.mul(0.05));
    material.positionNode = positionLocal.add(vec3(0.0, flap.mul(beat.y), 0.0));
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        const V = normalize(P.sub(u.eye)).toVar();
        const q = uv();
        // Pale pearl with fine ribs fanning out from the body.
        const ribs = smoothstep(0.82, 1.0, abs(fract(q.x.sub(0.5).mul(9.0).div(max(q.y, 0.15))).sub(0.5)).mul(2.0));
        const pearl = vec3(0.93, 0.9, 0.95).mul(float(1.0).sub(ribs.mul(0.18)));
        // Lit on either face, and glowing through where it stands before a sun.
        const lightOf = (S, C) => {
            const face = abs(dot(N, S));
            const m = max(dot(V, S), 0.0);
            const m2 = m.mul(m);
            const through = m2.mul(m2).mul(1.6).add(0.12);
            return C.mul(face.mul(0.45).add(through));
        };
        const lit = lightOf(u.sun0, u.col0).add(lightOf(u.sun1, u.col1)).add(lightOf(u.sun2, u.col2))
            .add(mix(u.horizon, u.zenith, 0.5).mul(0.4));
        const colour = pearl.mul(lit);
        const vis = vec3(1.0, 1.0, 1.0);
        return vec4(haze(u, mist(u, colour, P, vis), P), 1.0);
    })();
    material.fog = false;
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
    mesh.count = n;
    mesh.name = 'Sunbraid gliders';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const at = {
        x: 0, y: 0, z: 0, hx: 0, hz: -1, bank: 0, beat: 0, span: 20,
    };
    const m = new THREE.Matrix4();
    const qn = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, -1);
    return {
        mesh,
        material,
        geometry,
        count: n,
        /** Fly every glider to clock `time`; write their shadow discs into the rows. */
        update(time, dt, world) {
            const rows = world.u.gliderRows;
            for (let k = 0; k < n; k++) {
                gliderAt(k, time, at);
                const y = groundHeight(at.x, at.z) + at.y;
                // Heading: the nose (−z) along the travel; then bank about the nose.
                qn.setFromAxisAngle(Y, Math.atan2(-at.hx, -at.hz));
                qb.setFromAxisAngle(Z, at.bank);
                qn.multiply(qb);
                s.setScalar(at.span);
                p.set(at.x, y, at.z);
                m.compose(p, qn, s);
                mesh.setMatrixAt(k, m);
                beats[k * 4] = world.reducedMotion ? 0.25 : at.beat;
                beats[k * 4 + 1] = at.span;
                // The shadow: a disc a little smaller than the wing (it is a leaf, not a plate).
                rows[k].set(at.x, y, at.z, at.span * 0.3);
            }
            for (let k = n; k < rows.length; k++) rows[k].set(0, -1e5, 0, 0);
            world.u.gliderCount.value = n;
            mesh.instanceMatrix.needsUpdate = true;
            beatBuffer.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
