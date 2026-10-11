/**
 * Stellar Drift — what is drawn as geometry on top of the traced picture.
 *
 *   the ice      the camera drifts in the thin haze beyond the rings: a few slow, tumbling
 *                boulders of ice near the lens, shards between them and the giant, and
 *                thousands of motes that catch the sun for an instant as they turn. They live in
 *                the resting camera's own frame and pass through it at one common drift, so the
 *                near ones cross the frame quickly and the far ones hardly move.
 *   sparks       the ice a lock's mote throws up where it lands in the rings, and what a meteor
 *                strews as it burns: a pool written at event time, moved by a closed form.
 *   meteors      the mote that carries a lock from the card to the rings (an arc in the piece's
 *                colour) and the meteors a chain brings (straight, white-hot at the head).
 *
 * None of it is created at event time: every pool is drawn always, with idle slots collapsed.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    METEOR_SLOTS, RING_RATE, TAU, mulberry32, sdFxMaterial, sdPart, sdQuadGeometry, sdSolidMaterial,
} from './stellar-drift-tsl.js';

/** The common drift of the ice through the camera's frame (radii per second, to the left). */
export const ICE_DRIFT = 0.012;

// ── Geometry ────────────────────────────────────────────────────────────────────

/**
 * A lump of ice: an icosphere pushed in by a handful of random planes, so it has flat cleaved
 * faces and sharp ridges. Non-indexed, with one normal per face.
 */
export function createIceGeometry(detail, seed, cuts = 9) {
    const rand = mulberry32(seed);
    const base = new THREE.IcosahedronGeometry(1, detail);
    const pos = base.getAttribute('position');
    const planes = [];
    for (let i = 0; i < cuts; i++) {
        const z = rand() * 2 - 1;
        const a = rand() * TAU;
        const s = Math.sqrt(1 - z * z);
        planes.push([s * Math.cos(a), z, s * Math.sin(a), 0.55 + rand() * 0.38]);
    }
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        for (let k = 0; k < planes.length; k++) {
            const [nx, ny, nz, d] = planes[k];
            const over = v.x * nx + v.y * ny + v.z * nz - d;
            if (over > 0) {
                v.x -= nx * over;
                v.y -= ny * over;
                v.z -= nz * over;
            }
        }
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    base.computeVertexNormals();
    base.deleteAttribute('uv');
    return base;
}

function instanced(base, count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('normal', base.getAttribute('normal'));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** Rodrigues: `v` turned by `angle` about the unit `axis`. */
const turn = (v, axis, angle) => {
    const c = cos(angle);
    const s = sin(angle);
    return v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(c)));
};

// ── The ice ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} u       shared uniforms
 * @param {number[]} counts  [boulders, shards, motes]
 */
export function createIce(u, counts, seed = 77) {
    const frame = {
        home: uniform(new THREE.Vector3(0, 1, 5)),
        right: uniform(new THREE.Vector3(1, 0, 0)),
        up: uniform(new THREE.Vector3(0, 1, 0)),
        fwd: uniform(new THREE.Vector3(0, 0, -1)),
        /** Tangents of the half field of view (x, y), with a margin so nothing pops at the edge. */
        span: uniform(new THREE.Vector2(0.6, 0.34)),
        /** The drift's own clock (the world integrates it). */
        clock: uniform(0),
    };

    /**
     * Where an instance is in the frame: its depth from the seed, its place across the frame
     * carried along by the drift (nearer ice crosses faster) and wrapped.
     */
    const place = (s, near, far, lean) => {
        const depth = mix(float(near), float(far), s.z.mul(s.z));
        const width = frame.span.x.mul(depth).mul(2.0);
        const x = fract(s.x.sub(frame.clock.mul(ICE_DRIFT).div(width))).sub(0.5).mul(width);
        const y = fract(s.y.add(frame.clock.mul(ICE_DRIFT * lean).div(width))).sub(0.5).mul(frame.span.y.mul(depth).mul(2.0));
        return vec3(x, y, depth);
    };
    const toWorld = (p) => frame.home.add(frame.right.mul(p.x)).add(frame.up.mul(p.y)).add(frame.fwd.mul(p.z));

    const rand = mulberry32(seed);
    const seeds = (count) => {
        const a = new Float32Array(count * 4);
        const b = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            a[i * 4] = rand();
            a[i * 4 + 1] = rand();
            a[i * 4 + 2] = rand();
            a[i * 4 + 3] = rand();
            const z = rand() * 2 - 1;
            const ang = rand() * TAU;
            const s = Math.sqrt(1 - z * z);
            b[i * 4] = s * Math.cos(ang);
            b[i * 4 + 1] = z;
            b[i * 4 + 2] = s * Math.sin(ang);
            b[i * 4 + 3] = rand();
        }
        return { a, b };
    };

    /** A class of solid ice: lumps of one mesh, each with its own size, shape and tumble. */
    const lumps = (name, count, detail, near, far, sizeLo, sizeHi, order) => {
        const { a, b } = seeds(count);
        const geometry = instanced(createIceGeometry(detail, seed + order * 131), count, { aSeed: [a, 4], aSpin: [b, 4] });
        const material = sdSolidMaterial(name);
        const s = attribute('aSeed', 'vec4');
        const spin = attribute('aSpin', 'vec4');
        const angle = frame.clock.mul(spin.w.mul(0.22).add(0.04)).add(s.w.mul(TAU));
        // Each lump is stretched its own way before it tumbles.
        const stretch = vec3(1.0, s.x.mul(0.5).add(0.55), s.y.mul(0.4).add(0.7));
        const size = mix(float(sizeLo), float(sizeHi), pow(s.w, 3.0));
        const centre = toWorld(place(s, near, far, 0.16));
        material.positionNode = centre.add(turn(positionGeometry.mul(stretch), spin.xyz, angle).mul(size));
        const vNormal = varying(turn(normalize(normalGeometry.div(stretch)), spin.xyz, angle), `v${name}N`);
        const vAt = varying(centre, `v${name}P`);
        const vTone = varying(s.w, `v${name}T`);
        material.colorNode = Fn(() => {
            const N = normalize(vNormal).toVar();
            const V = normalize(u.camPos.sub(vAt)).toVar();
            const S = u.sunDir;
            const m0 = dot(N, S).toVar();
            const ice = mix(u.ringIce, u.ringIce.mul(vec3(0.5, 0.72, 1.0)), vTone).mul(0.9).toVar();
            const sun = u.sun.mul(u.sunGain);
            const lit = max(m0, 0.0).mul(0.9);
            // Ice lets the light through its thin edges when the sun is behind it.
            const through = pow(max(dot(V, S).negate(), 0.0), 2.0).mul(float(1.0).sub(abs(m0))).mul(0.5);
            const halfway = normalize(S.add(V));
            const glint = pow(max(dot(N, halfway), 0.0), 60.0).mul(2.4);
            const rim = pow(float(1.0).sub(max(dot(N, V), 0.0)), 3.0);
            // What reaches its dark faces: the giant's light from one side, the sky's from all.
            const toGiant = normalize(vAt.negate());
            const fill = u.shine.mul(max(dot(N, toGiant), 0.0).mul(0.06)).add(u.night.mul(0.05))
                .add(mix(u.gasA, u.gasB, 0.5).mul(rim.mul(0.03)));
            const colour = ice.mul(sun.mul(lit.add(through)).add(fill)).add(sun.mul(glint))
                .add(u.accent.mul(u.ringGlow.x).mul(rim.mul(0.2)));
            return vec4(colour, 1.0);
        })();
        return sdPart(name, geometry, material, order);
    };

    const boulders = lumps('StellarDriftBoulders', counts[0], 2, 0.9, 3.0, 0.004, 0.017, 2);
    const shards = lumps('StellarDriftShards', counts[1], 1, 0.7, 3.8, 0.0012, 0.0055, 3);

    // Motes: points of ice that flash as a facet finds the sun.
    const mote = seeds(counts[2]);
    const moteGeometry = sdQuadGeometry(counts[2], { aSeed: [mote.a, 4], aSpin: [mote.b, 4] });
    const moteMaterial = sdFxMaterial('StellarDriftMotes');
    const ms = attribute('aSeed', 'vec4');
    const mspin = attribute('aSpin', 'vec4');
    const mAt = place(ms, 0.25, 3.8, 0.16);
    // Never smaller than a pixel and a half; the near ones a few pixels across.
    const mSize = max(u.pixelAngle.mul(mAt.z).mul(1.5), mix(float(0.0006), float(0.0022), pow(ms.w, 6.0)));
    moteMaterial.positionNode = toWorld(mAt)
        .add(frame.right.mul(positionGeometry.x.mul(mSize)))
        .add(frame.up.mul(positionGeometry.y.mul(mSize)));
    const flashing = pow(sin(frame.clock.mul(mspin.w.mul(1.6).add(0.3)).add(ms.w.mul(40.0))).mul(0.5).add(0.5), 14.0);
    const vMote = varying(vec2(flashing.mul(2.6).add(0.1), ms.w), 'vSdMote');
    moteMaterial.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const d2 = dot(p, p);
        const core = exp(d2.mul(-5.0)).mul(float(1.0).sub(smoothstep(0.7, 1.0, d2)));
        const tint = mix(u.ringIce, vec3(0.7, 0.86, 1.0), vMote.y);
        const light = tint.mul(u.sun).mul(u.sunGain).mul(vMote.x)
            .add(u.accent.mul(u.ringGlow.x).mul(0.5));
        return vec4(light.mul(core).mul(0.8), 0.0);
    })();
    const motes = sdPart('StellarDriftMotes', moteGeometry, moteMaterial, 6);

    return {
        boulders,
        shards,
        motes,
        /** The resting camera's frame: where the ice lives. */
        setFrame(home, right, up, fwd, _distance, tanV, aspect) {
            frame.home.value.copy(home);
            frame.right.value.copy(right);
            frame.up.value.copy(up);
            frame.fwd.value.copy(fwd);
            frame.span.value.set(tanV * aspect * 1.3, tanV * 1.3);
        },
        update(time, _dt, motion = 1) {
            frame.clock.value = time * motion;
        },
    };
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

/** Seconds a spark lives. */
const SPARK_LIFE = 2.4;

/**
 * Ice thrown up out of the rings (and off a burning meteor): each spark leaves its origin with
 * its own velocity, is slowed, falls back to the ring plane and fades. Written at event time,
 * moved in the vertex stage.
 */
export function createSparks(u, count) {
    const origin = new Float32Array(count * 4); // xyz, birth
    const velocity = new Float32Array(count * 4); // xyz, size
    const colour = new Float32Array(count * 4); // rgb, seed
    for (let i = 0; i < count; i++) origin[i * 4 + 3] = -1e6;
    const geometry = sdQuadGeometry(count, { aOrigin: [origin, 4], aVelocity: [velocity, 4], aColour: [colour, 4] });
    ['aOrigin', 'aVelocity', 'aColour'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const material = sdFxMaterial('StellarDriftSparks');
    const o = attribute('aOrigin', 'vec4');
    const v = attribute('aVelocity', 'vec4');
    const c = attribute('aColour', 'vec4');
    const age = u.time.sub(o.w);
    const live = step(0.0, age).mul(step(age, SPARK_LIFE));
    // Thrown, slowed by nothing but its own fall back to the plane it came from.
    const fall = float(0.16);
    const rise = v.y.mul(age).sub(fall.mul(age).mul(age).mul(0.5));
    // Carried round with the rings while it flies.
    const r = max(length(o.xz), 1.0);
    const swing = pow(r, -1.5).mul(RING_RATE).mul(age).mul(6.0);
    const flat = o.xz.add(v.xz.mul(age).mul(exp(age.mul(-0.5))));
    const at = vec3(
        flat.x.mul(cos(swing)).sub(flat.y.mul(sin(swing))),
        o.y.add(max(rise, 0.0)),
        flat.x.mul(sin(swing)).add(flat.y.mul(cos(swing))),
    );
    const dist = length(at.sub(u.camPos));
    const size = u.pixelAngle.mul(dist).mul(v.w.mul(2.2).add(1.6)).mul(live);
    material.positionNode = at
        .add(u.camRight.mul(positionGeometry.x.mul(size)))
        .add(u.camUp.mul(positionGeometry.y.mul(size)));
    const twinkle = sin(age.mul(c.w.mul(22.0).add(9.0)).add(c.w.mul(50.0))).mul(0.35).add(0.65);
    const fade = exp(age.mul(-1.5)).mul(smoothstep(0.0, 0.05, age)).mul(live).mul(twinkle);
    const vSpark = varying(vec4(c.rgb, fade), 'vSdSpark');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const d2 = dot(p, p);
        const core = exp(d2.mul(-4.5)).mul(float(1.0).sub(smoothstep(0.7, 1.0, d2)));
        const hot = mix(vSpark.rgb, vec3(1.0), core.mul(0.5));
        return vec4(hot.mul(core).mul(vSpark.w).mul(3.2), 0.0);
    })();

    const part = sdPart('StellarDriftSparks', geometry, material, 8);
    let cursor = 0;
    const touch = () => {
        geometry.getAttribute('aOrigin').needsUpdate = true;
        geometry.getAttribute('aVelocity').needsUpdate = true;
        geometry.getAttribute('aColour').needsUpdate = true;
    };
    return {
        ...part,
        count,
        reset() {
            for (let i = 0; i < count; i++) origin[i * 4 + 3] = -1e6;
            cursor = 0;
            touch();
        },
        /**
         * Throw `amount` (0..1) of a burst's sparks up from (x, y, z) in a colour.
         * `salt` makes two bursts in one frame differ.
         */
        burst(x, y, z, rgb, amount, time, salt = 0) {
            const n = Math.max(4, Math.round(Math.min(1.5, amount) * Math.min(64, count * 0.09)));
            const rand = mulberry32(0x5a17 + Math.floor(time * 977) * 31 + salt * 7919);
            for (let k = 0; k < n; k++) {
                const i = cursor;
                cursor = (cursor + 1) % count;
                const a = rand() * TAU;
                const out = (0.02 + rand() * 0.11) * (0.6 + amount * 0.6);
                origin[i * 4] = x;
                origin[i * 4 + 1] = y;
                origin[i * 4 + 2] = z;
                origin[i * 4 + 3] = time + rand() * 0.05;
                velocity[i * 4] = Math.cos(a) * out;
                velocity[i * 4 + 1] = 0.05 + rand() * 0.2 * (0.5 + amount * 0.5);
                velocity[i * 4 + 2] = Math.sin(a) * out;
                velocity[i * 4 + 3] = rand();
                const pale = rand() * 0.6;
                colour[i * 4] = rgb[0] + (1 - rgb[0]) * pale;
                colour[i * 4 + 1] = rgb[1] + (1 - rgb[1]) * pale;
                colour[i * 4 + 2] = rgb[2] + (1 - rgb[2]) * pale;
                colour[i * 4 + 3] = rand();
            }
            touch();
        },
        update() {},
    };
}

// ── Meteors and motes ───────────────────────────────────────────────────────────

/** Segments along a meteor's ribbon. */
const RIBBON_SEGMENTS = 10;

/**
 * A pool of ribbons. Each slot is four rows of a uniform table: (from, birth), (to, flight),
 * (colour, size), (the arc's control point, kind: 1 = a lock's mote, 0 = a meteor).
 */
export function createMeteors(u) {
    const rows = Array.from({ length: METEOR_SLOTS * 4 }, () => new THREE.Vector4(0, 0, 0, -1e6));
    const table = uniformArray(rows, 'vec4');
    const base = new THREE.PlaneGeometry(1, 1, RIBBON_SEGMENTS, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(Float32Array.from({ length: METEOR_SLOTS }, (_, i) => i), 1));
    geometry.instanceCount = METEOR_SLOTS;
    base.dispose();

    const material = sdFxMaterial('StellarDriftMeteors');
    const slot = int(attribute('aSlot', 'float').add(0.5)).mul(4);
    const A = table.element(slot);
    const Bv = table.element(slot.add(1));
    const C = table.element(slot.add(2));
    const D = table.element(slot.add(3));
    const age = u.time.sub(A.w);
    const phase = clamp(age.div(max(Bv.w, 0.01)), 0.0, 1.0);
    const live = step(0.0, age).mul(step(age, Bv.w.add(0.25)));
    // A meteor's streak is long; a mote keeps a short tail behind it.
    const tail = mix(float(0.55), float(0.5), D.w);
    const along = uv().x;
    const s = clamp(phase.sub(float(1.0).sub(along).mul(tail)), 0.0, 1.0);
    const bezier = (k) => {
        const a = mix(A.xyz, D.xyz, k);
        const b = mix(D.xyz, Bv.xyz, k);
        return mix(a, b, k);
    };
    const at = bezier(s);
    const ahead = bezier(clamp(s.add(0.02), 0.0, 1.0)).sub(bezier(clamp(s.sub(0.02), 0.0, 1.0)));
    const toCam = u.camPos.sub(at);
    const dist = length(toCam);
    const side = normalize(cross(ahead.add(vec3(1e-5, 0.0, 0.0)), toCam));
    const width = u.pixelAngle.mul(dist).mul(C.w.mul(mix(float(3.2), float(4.4), D.w)))
        .mul(along.mul(0.8).add(0.2)).mul(live);
    material.positionNode = at.add(side.mul(uv().y.sub(0.5).mul(width).mul(2.0)));
    // Once it has landed the streak runs into the ground and goes out.
    const out = float(1.0).sub(smoothstep(0.0, 0.25, age.sub(Bv.w)));
    const vMeteor = varying(vec4(C.rgb, live.mul(out)), 'vSdMeteor');
    const vKind = varying(D.w, 'vSdMeteorKind');
    material.colorNode = Fn(() => {
        const q = uv();
        const across = clamp(abs(q.y.sub(0.5)).mul(2.0), 0.0, 1.0);
        const body = exp(across.mul(across).mul(-5.0)).mul(float(1.0).sub(smoothstep(0.75, 1.0, across)));
        const lengthways = pow(clamp(q.x, 0.0, 1.0), mix(float(2.2), float(1.6), vKind));
        const head = exp(float(1.0).sub(q.x).mul(float(1.0).sub(q.x)).mul(-260.0));
        const white = mix(vec3(1.0, 0.9, 0.74), vec3(1.0), vKind);
        const colour = mix(vMeteor.rgb, white, head.mul(0.75).add(lengthways.mul(mix(float(0.35), float(0.1), vKind))));
        const light = body.mul(lengthways.mul(1.6).add(head.mul(5.0)));
        return vec4(colour.mul(light).mul(vMeteor.w).mul(mix(float(2.2), float(3.4), vKind)), 0.0);
    })();

    const part = sdPart('StellarDriftMeteors', geometry, material, 9);
    let cursor = 0;
    const mid = new THREE.Vector3();
    return {
        ...part,
        reset() {
            for (let i = 0; i < METEOR_SLOTS; i++) rows[i * 4].w = -1e6;
            cursor = 0;
        },
        /** @param {{ from, to, birth, flight, rgb, size, mote }} m */
        launch(m) {
            const i = cursor;
            cursor = (cursor + 1) % METEOR_SLOTS;
            rows[i * 4].set(m.from.x, m.from.y, m.from.z, m.birth);
            rows[i * 4 + 1].set(m.to.x, m.to.y, m.to.z, m.flight);
            rows[i * 4 + 2].set(m.rgb[0], m.rgb[1], m.rgb[2], m.size);
            // A mote leaves the card on a rising arc and falls into the rings; a meteor flies straight.
            mid.copy(m.from).lerp(m.to, 0.5);
            if (m.mote) mid.y += m.from.distanceTo(m.to) * 0.22;
            rows[i * 4 + 3].set(mid.x, mid.y, mid.z, m.mote ? 1 : 0);
        },
        update() {},
    };
}

// ── Orbital resonances ──────────────────────────────────────────────────────────

export const RESONANCE_SLOTS = 8;
const RESONANCE_KINDS = Object.freeze({ sweep: 0, helix: 1, crown: 2 });
const RESONANCE_LIVES = [2.1, 2.6, 3.4];

/**
 * Two luminous strands per event, all in one draw. Sweeps open around the giant, a T-spin
 * winds a pair of inclined orbits, and a perfect clear opens a scalloped stellar crown.
 * A travelling white core and a softer coloured wake give each strand a sense of direction.
 * Slots and geometry are retained across events; time alone determines their pose.
 */
export function createResonances(u) {
    const rows = Array.from({ length: RESONANCE_SLOTS * 3 }, () => new THREE.Vector4());
    const table = uniformArray(rows, 'vec4');
    const base = new THREE.PlaneGeometry(1, 1, 128, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    const instances = new Float32Array(RESONANCE_SLOTS * 4);
    for (let i = 0; i < RESONANCE_SLOTS * 2; i++) {
        instances[i * 2] = Math.floor(i / 2);
        instances[i * 2 + 1] = i % 2;
    }
    geometry.setAttribute('aResonance', new THREE.InstancedBufferAttribute(instances, 2));
    geometry.instanceCount = RESONANCE_SLOTS * 2;
    base.dispose();

    const material = sdFxMaterial('StellarDriftResonances');
    const instance = attribute('aResonance', 'vec2');
    const slot = int(instance.x.add(0.5)).mul(3);
    const event = table.element(slot); // birth, life, kind, power
    const tint = table.element(slot.add(1)); // rgb, seeded rotation
    const motion = table.element(slot.add(2)).x;
    const lane = instance.y;
    const age = u.time.sub(event.x);
    const phase = clamp(age.div(max(event.y, 0.01)), 0.0, 1.0);
    const live = step(0.0, age).mul(step(age, event.y));
    const helix = float(1.0).sub(step(0.5, abs(event.z.sub(1.0))));
    const crown = step(1.5, event.z);
    const opening = float(1.0).sub(pow(float(1.0).sub(phase), 3.0));
    const turnAngle = tint.w.add(lane.mul(Math.PI)).add(phase.mul(motion).mul(1.3));
    const angle = uv().x.mul(TAU).add(turnAngle);
    const scallop = sin(angle.mul(6.0));
    const radius = float(1.08).add(lane.mul(0.055))
        .add(opening.mul(motion).mul(mix(float(0.48), float(0.13), helix)))
        .add(crown.mul(scallop.mul(scallop)).mul(opening).mul(0.11));
    // The helix tilts into depth, so the far strand disappears behind the giant.
    const tilt = helix.mul(lane.mul(2.0).sub(1.0)).mul(0.42);
    const orbitX = cos(angle);
    const orbitY = sin(angle).mul(mix(float(1.0), float(0.48), helix));
    const radial = u.camRight.mul(orbitX.mul(cos(tilt)).sub(orbitY.mul(sin(tilt))))
        .add(u.camUp.mul(orbitX.mul(sin(tilt)).add(orbitY.mul(cos(tilt)))));
    const towardCamera = normalize(u.camPos);
    const centre = radial.mul(radius)
        .add(towardCamera.mul(sin(angle).mul(helix).mul(lane.mul(2.0).sub(1.0)).mul(0.9)));
    // Reference-frame size plus a pixel floor: Low/portrait does not turn these into ropes.
    const dist = length(u.camPos.sub(centre));
    const width = max(float(0.0045), u.pixelAngle.mul(dist).mul(0.8))
        .mul(event.w.mul(0.4).add(0.8));
    const at = centre.add(normalize(radial).mul(uv().y.sub(0.5)).mul(width).mul(6.0)
        .mul(live));
    material.positionNode = at;
    const vAt = varying(at, 'vSdResonanceAt');
    const envelope = smoothstep(0.0, 0.12, phase).mul(float(1.0).sub(smoothstep(0.38, 1.0, phase)));
    const vEvent = varying(vec4(phase, live.mul(envelope).mul(event.w), helix, crown), 'vSdResonance');
    const vTint = varying(tint.rgb, 'vSdResonanceTint');
    const vLane = varying(lane, 'vSdResonanceLane');
    material.colorNode = Fn(() => {
        const q = uv();
        const across = abs(q.y.sub(0.5)).mul(2.0);
        const core = exp(across.mul(across).mul(-36.0));
        const glow = exp(across.mul(across).mul(-5.0))
            .mul(float(1.0).sub(smoothstep(0.75, 1.0, across)));
        // A partial sweep; the crown closes the circle with twelve bright beads.
        const travel = fract(q.x.sub(vEvent.x.mul(0.8)).add(vLane.mul(0.5)).add(1.0));
        const wake = smoothstep(0.12, 0.7, travel).mul(float(1.0).sub(smoothstep(0.92, 1.0, travel)));
        const beads = pow(sin(q.x.mul(TAU * 12)).mul(0.5).add(0.5), 18.0);
        const line = mix(wake, beads.mul(0.7).add(0.35), vEvent.w);
        const headDistance = travel.sub(0.88);
        const hot = exp(headDistance.mul(headDistance).mul(-1100.0));
        const colour = vTint.mul(glow.mul(0.65).add(core.mul(1.1))).mul(line)
            .add(mix(vTint, vec3(1.0), 0.75).mul(core).mul(hot).mul(1.6));
        // The traced globe doesn't write geometry depth. Resolve its occlusion analytically.
        const ray = normalize(vAt.sub(u.camPos)).toVar();
        const b = dot(u.camPos, ray).toVar();
        const disc = b.mul(b).sub(dot(u.camPos, u.camPos).sub(1.0)).toVar();
        const near = b.negate().sub(sqrt(max(disc, 0.0)));
        const hidden = step(0.0, disc).mul(step(0.0, near)).mul(step(near, length(vAt.sub(u.camPos))));
        return vec4(colour.mul(vEvent.y).mul(float(1.0).sub(hidden)), 0.0);
    })();

    const part = sdPart('StellarDriftResonances', geometry, material, 7);
    let cursor = 0;
    let emitted = 0;
    const kinds = { sweep: 0, helix: 0, crown: 0 };
    const reset = () => {
        rows.forEach((row) => row.set(0, 0, 0, 0));
        for (let i = 0; i < RESONANCE_SLOTS; i++) rows[i * 3].x = -1e6;
        cursor = 0;
        emitted = 0;
        Object.keys(kinds).forEach((kind) => { kinds[kind] = 0; });
    };
    reset();
    return {
        ...part,
        reset,
        emit({
            time, kind = 'sweep', power = 1, rgb, seed = 0, motion: amount = 1,
        }) {
            if (!Number.isFinite(time) || !Object.hasOwn(RESONANCE_KINDS, kind)) return;
            const mode = RESONANCE_KINDS[kind];
            const i = cursor * 3;
            cursor = (cursor + 1) % RESONANCE_SLOTS;
            rows[i].set(time, RESONANCE_LIVES[mode], mode, Math.max(0, Math.min(1.5, power)));
            rows[i + 1].set(rgb[0], rgb[1], rgb[2], mulberry32(seed)() * TAU);
            rows[i + 2].set(Math.max(0, Math.min(1, amount)), 0, 0, 0);
            emitted += 1;
            kinds[kind] += 1;
        },
        getState(time = u.time.value) {
            let active = 0;
            for (let i = 0; i < RESONANCE_SLOTS; i++) {
                const row = rows[i * 3];
                if (time >= row.x && time < row.x + row.y) active += 1;
            }
            return { active, emitted, kinds: { ...kinds } };
        },
        update() {},
    };
}
