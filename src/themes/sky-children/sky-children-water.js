/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the pools and basins.
 *
 * One instanced draw: every terrace pool and every basin is a lobed disc of milky jade water lying in
 * its shelf. Seen low across the gulf, water mirrors the sky (Fresnel for n = 1.33); looked into, it
 * shows its milky body lit by the sun behind the eye. A pool that HOLDS a piece's colour glows from
 * within in it, a jewel in the stained-glass staircase the board builds, with a bright meniscus at
 * its lip; a lock's ring runs across it; the bell's toll rings every pool at once.
 *
 * Per instance (interleaved, one vertex buffer): aPool (seed, ringAt, ringStrength, releasedAt) and
 * aHeld (r, g, b, heldAt). The envelope of a held colour is computed here from the clock:
 * fade in (0.25 s, 1.5 s when silent), full for HOLD_SECONDS, then exp(−(age − HOLD)/DECAY);
 * a release dims it over RELEASE_SECONDS.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, dot, exp, float, length, max, min, mix, normalWorld, normalize,
    positionWorld, pow, reflect, sin, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { horizonHaze, luma, skyBase } from './sky-children-tsl.js';

export const HOLD_SECONDS = 18;
export const DECAY_SECONDS = 6;
export const RELEASE_SECONDS = 0.8;

/** A disc with a scalloped rim (24 lobes), radius ≈ 1, in the XZ plane, facing up. */
export function buildPoolGeometry(segments = 40) {
    const pos = [0, 0, 0];
    const rimR = (th) => 1 + 0.07 * Math.sin(th * 7 + 0.3) + 0.04 * Math.sin(th * 13 + 1.1);
    for (let ring = 1; ring <= 3; ring++) {
        const k = ring / 3;
        for (let i = 0; i < segments; i++) {
            const th = (i / segments) * Math.PI * 2;
            const r = rimR(th) * k;
            pos.push(Math.cos(th) * r, 0, Math.sin(th) * r);
        }
    }
    const index = [];
    for (let i = 0; i < segments; i++) index.push(0, 1 + ((i + 1) % segments), 1 + i);
    for (let ring = 1; ring < 3; ring++) {
        const a0 = 1 + (ring - 1) * segments;
        const b0 = 1 + ring * segments;
        for (let i = 0; i < segments; i++) {
            const i1 = (i + 1) % segments;
            index.push(a0 + i, a0 + i1, b0 + i, b0 + i, a0 + i1, b0 + i1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uvR = [];
    for (let i = 0; i < pos.length; i += 3) uvR.push(Math.hypot(pos[i], pos[i + 2]));
    g.setAttribute('aRim', new THREE.Float32BufferAttribute(uvR, 1));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
}

/**
 * @param {object} p
 * @param {number} p.capacity
 * @param {object} p.U
 * @param {object} p.tex   { noise }
 */
export function createPools({ capacity, U, tex }) {
    const geometry = buildPoolGeometry();
    const data = new Float32Array(capacity * 8);
    const buffer = new THREE.InstancedInterleavedBuffer(data, 8);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPool', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aHeld', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    for (let i = 0; i < capacity; i++) {
        data[i * 8 + 0] = i * 0.618;
        data[i * 8 + 1] = -1e4;
        data[i * 8 + 3] = -1e4;
        data[i * 8 + 7] = -1e4;
    }

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.colorNode = Fn(() => {
        const { light } = U;
        const pool = attribute('aPool', 'vec4');
        const held = attribute('aHeld', 'vec4');
        const rim = attribute('aRim', 'float');
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P).toVar();
        const dist = length(toEye);
        const V = toEye.div(dist).toVar();
        const t = U.time;

        // Shimmer: a little slope from the noise, moving.
        const at = P.xz.mul(0.08).add(vec2(t.mul(0.03), t.mul(-0.02)));
        const n1 = texture(tex.noise, at).r.sub(0.5);
        const n2 = texture(tex.noise, at.mul(1.9).add(0.4)).a.sub(0.5);
        // The rings: a lock's, and the bell's toll through every pool.
        const ringAge = t.sub(pool.y);
        const ringR = ringAge.mul(0.55);
        const ring = exp(rim.sub(ringR).div(0.07).pow2().negate()).mul(exp(ringAge.mul(-1.6))).mul(pool.z)
            .mul(smoothstep(0.0, 0.05, ringAge));
        const tollAge = t.sub(U.toll.x);
        const toll = sin(rim.mul(22.0).sub(tollAge.mul(9.0))).mul(exp(tollAge.mul(-0.9)))
            .mul(smoothstep(0.0, 0.1, tollAge)).mul(U.toll.y)
            .mul(0.5);
        const N = normalize(normalWorld.add(vec3(n1.mul(0.05).add(ring.mul(0.2)).add(toll.mul(0.05)), 0.0, n2.mul(0.05)))).toVar();

        // Water mirrors the sky (Schlick, n = 1.33).
        const Rr = reflect(V.negate(), N);
        const R = normalize(vec3(Rr.x, max(Rr.y, 0.02), Rr.z)).toVar();
        const mirror = skyBase(R, U).toVar();
        const cosI = clamp(dot(N, V), 0.0, 1.0);
        const m = float(1.0).sub(cosI);
        const fresnel = float(0.02).add(m.mul(m).mul(m).mul(m).mul(m)
            .mul(0.98)).toVar();
        // The milky body, lit by the key behind the eye.
        const body = light.water.mul(light.key.mul(U.keyGain).mul(0.45).add(skyBase(vec3(0.0, 1.0, 0.0), U).mul(0.5)));
        const colour = mix(body, mirror, fresnel).toVar();

        // Held: the piece's colour glows from within, a meniscus at the lip.
        const age = t.sub(held.w).toVar();
        const fadeIn = smoothstep(0.0, 0.25, age);
        const hold = mix(float(1.0), exp(age.sub(HOLD_SECONDS).div(-DECAY_SECONDS)), smoothstep(HOLD_SECONDS - 0.01, HOLD_SECONDS, age));
        // A hold clears the pool's release time, so any release on record is this colour's.
        const released = t.sub(pool.w);
        const drain = mix(float(1.0), float(1.0).sub(smoothstep(0.0, RELEASE_SECONDS, released)), smoothstep(-1e3, -999.0, pool.w));
        const strength = clamp(fadeIn.mul(hold).mul(drain), 0.0, 1.0).toVar();
        // A held colour glows from within whatever the angle (light, not a tint the mirror hides).
        colour.assign(mix(colour, mirror.mul(fresnel).mul(0.35), strength.mul(0.6)));
        colour.addAssign(held.xyz.mul(strength).mul(1.6));
        const meniscus = smoothstep(0.7, 0.98, rim).mul(strength);
        colour.addAssign(held.xyz.mul(meniscus).mul(2.5));
        // The ring catches the key; the toll catches the sky.
        colour.addAssign(light.key.mul(ring.mul(0.6)).add(mirror.mul(abs(toll).mul(0.3))));
        // The air between.
        const air = float(1.0).sub(exp(dist.div(-2600.0)));
        colour.assign(mix(colour, horizonHaze(V.negate(), U), min(air, 0.9)));
        return vec4(colour, 1.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sky-children-pools';
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    // Dormant slots: zero scale, far below (drawn from frame 0, no area).
    const m4 = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, zero);
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const tiltAxis = new THREE.Vector3(1, 0, 0);
    const tiltQ = new THREE.Quaternion();

    return {
        mesh,
        capacity,
        /**
         * Place pool i (world centre, radius, a seed for its turn). Seen from across the gulf a
         * level pool is a hairline; it is tilted a little toward the eye (`tilt` radians) so its
         * water reads as a lens on its step.
         */
        set(i, world, radius, seed = i, tilt = 0.21) {
            if (i < 0 || i >= capacity) return;
            const d = Math.hypot(world[0], world[2]) || 1;
            // Tilt about the horizontal axis across the line of sight.
            tiltAxis.set(world[2] / d, 0, -world[0] / d);
            tiltQ.setFromAxisAngle(tiltAxis, -tilt);
            q.setFromAxisAngle(axis, seed * 2.39996).premultiply(tiltQ);
            s.set(radius, 1, radius);
            p.set(world[0], world[1], world[2]);
            m4.compose(p, q, s);
            mesh.setMatrixAt(i, m4);
            mesh.instanceMatrix.needsUpdate = true;
        },
        /** Pool i takes a colour (linear rgb) at time `at`; silent fills fade in slowly. */
        hold(i, rgb, at, silent = false) {
            if (i < 0 || i >= capacity) return;
            const o = i * 8;
            data[o + 4] = rgb[0];
            data[o + 5] = rgb[1];
            data[o + 6] = rgb[2];
            // A silent fill reads as one that began 1.25 s later, faded over its first 0.25 s (≈ 1.5 s).
            data[o + 7] = silent ? at + 1.25 : at;
            data[o + 3] = -1e4;
            buffer.needsUpdate = true;
        },
        /** Pool i lets its colour go at time `at`. */
        release(i, at) {
            if (i < 0 || i >= capacity) return;
            data[i * 8 + 3] = at;
            buffer.needsUpdate = true;
        },
        /** A ring runs across pool i. */
        ring(i, at, strength = 1) {
            if (i < 0 || i >= capacity) return;
            data[i * 8 + 1] = at;
            data[i * 8 + 2] = strength;
            buffer.needsUpdate = true;
        },
        /** Forget everything held (a new run, a seek). */
        clearAll() {
            for (let i = 0; i < capacity; i++) {
                data[i * 8 + 1] = -1e4;
                data[i * 8 + 3] = -1e4;
                data[i * 8 + 7] = -1e4;
            }
            buffer.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}

export { luma, pow };
