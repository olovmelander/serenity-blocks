/**
 * Stellar Drift — what is drawn as geometry on top of the traced picture.
 *
 *   the ice      the camera drifts in the thin haze beyond the rings: a few slow, tumbling
 *                boulders of ice near the lens, shards between them and the giant, and
 *                thousands of motes that catch the sun for an instant as they turn. They live in
 *                the resting camera's own frame and pass through it at one common drift, so the
 *                near ones cross the frame quickly and the far ones hardly move.
 *   sparks       the ice a lock's mote throws up where it lands in the rings: chips that streak
 *                as they fly, a pool written at event time, moved by a closed form.
 *   meteors      the mote that carries a lock from the card to the rings (an arc in the piece's
 *                colour) and the meteors a chain brings (straight): each a ribbon of white-hot
 *                trail cooling into a train that lingers and spreads, and a head of light.
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
    METEOR_SLOTS, METEOR_TRAIN, MOTE_TRAIN, RING_RATE, TAU, mulberry32, sdFxMaterial, sdPart, sdQuadGeometry,
    sdSolidMaterial,
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
    const toCam = u.camPos.sub(at);
    const dist = length(toCam);
    const size = u.pixelAngle.mul(dist).mul(v.w.mul(2.2).add(1.6)).mul(live);
    // A chip streaks along its own motion while it is fast (the carry round the giant is slow
    // beside it, and left out).
    const slowing = exp(age.mul(-0.5));
    const vFlat = v.xz.mul(slowing).mul(float(1.0).sub(age.mul(0.5)));
    const vel = vec3(vFlat.x, v.y.sub(fall.mul(age)).mul(step(0.0, rise)), vFlat.y);
    const look = toCam.div(max(dist, 1e-4));
    const across = vel.sub(look.mul(dot(vel, look)));
    const along = normalize(across.add(u.camRight.mul(1e-4)));
    const side = normalize(cross(along, look));
    const streak = length(across).mul(0.06).mul(live);
    material.positionNode = at
        .add(along.mul(positionGeometry.x.mul(size.add(streak))))
        .add(side.mul(positionGeometry.y.mul(size)));
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

/** Rows along a ribbon (closer together toward the head, where the light is). */
const RIBBON_SEGMENTS = 28;

/**
 * The angle of a pixel of a 1080-line frame: what event sizes are authored in, so a fireball
 * covers the same share of the sky at any resolution (and is floored at a real buffer pixel).
 */
const refPixel = (u) => u.pixelAngle.mul(u.viewport.y).div(1080.0);

/** 1 where the giant does not stand between the camera and `at`. */
const unhidden = (u, at) => {
    const toAt = at.sub(u.camPos);
    const dist = length(toAt);
    const ray = toAt.div(max(dist, 1e-4));
    const b = dot(u.camPos, ray);
    const disc = b.mul(b).sub(dot(u.camPos, u.camPos).sub(1.0));
    const near = b.negate().sub(sqrt(max(disc, 0.0)));
    // A meteor ends ON the cloud tops: only a crossing well short of it hides it.
    return float(1.0).sub(step(0.0, disc).mul(step(0.0, near)).mul(step(near, dist.mul(0.985))));
};

/**
 * One flight of the pool, read from its four rows: where it is on its path at a share `s` of
 * the way, how old it is, and what it is.
 */
function readFlight(u, table, slotAttr) {
    const slot = int(slotAttr.add(0.5)).mul(4);
    const A = table.element(slot);
    const B = table.element(slot.add(1));
    const C = table.element(slot.add(2));
    const D = table.element(slot.add(3));
    const age = u.time.sub(A.w);
    const flight = max(B.w, 0.01);
    const kind = D.w;
    const bezier = (k) => {
        const a = mix(A.xyz, D.xyz, k);
        const b = mix(D.xyz, B.xyz, k);
        return mix(a, b, k);
    };
    return {
        age,
        flight,
        kind,
        rgb: C.rgb,
        size: C.w,
        phase: clamp(age.div(flight), 0.0, 1.0),
        train: mix(float(METEOR_TRAIN), float(MOTE_TRAIN), kind),
        bezier,
    };
}

/**
 * The flights: the mote that carries a lock from the card into the rings (an arc in the piece's
 * colour) and the meteors (straight). Each slot is four rows of a uniform table: (from, birth),
 * (to, flight), (colour, size), (the arc's control point, kind: 1 = a lock's mote, 0 = a meteor).
 * Two draws read it: the ribbons, and the heads (createHeads).
 *
 * A ribbon is the trail and the train it leaves: just behind the head the air is ionised white-hot
 * and narrow; it cools through the piece's colour, and a meteor's goes on glowing for a couple of
 * seconds as a faint train that widens as it spreads, breaking into pieces where the meteor shed
 * them.
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
    const slotAttr = attribute('aSlot', 'float');
    const f = readFlight(u, table, slotAttr);
    const live = step(0.0, f.age).mul(step(f.age, f.flight.add(f.train)));
    // The strip runs from where the train has faded to the head; its rows crowd toward the head.
    const { x } = uv();
    const lead = float(1.0).sub(float(1.0).sub(x).mul(float(1.0).sub(x)));
    const span = mix(float(0.6), float(0.75), f.kind);
    const s = clamp(f.phase.sub(float(1.0).sub(lead).mul(span)), 0.0, 1.0);
    /** Seconds since the head passed this point of the path. */
    const since = max(f.age.sub(s.mul(f.flight)), 0.0);
    const at = f.bezier(s);
    const ahead = f.bezier(clamp(s.add(0.01), 0.0, 1.0)).sub(f.bezier(clamp(s.sub(0.01), 0.0, 1.0)));
    const toCam = u.camPos.sub(at);
    const dist = length(toCam);
    const side = normalize(cross(ahead.add(vec3(1e-5, 2e-5, 0.0)), toCam));
    // Narrow and hot behind the head; behind that the train widens as it cools and spreads.
    const hotFall = exp(since.mul(-4.0));
    const widthPx = f.size.mul(mix(float(3.6), float(5.6), f.kind)).mul(hotFall)
        .add(since.mul(mix(float(9.0), float(5.0), f.kind)).add(2.4).mul(float(1.0).sub(hotFall)).mul(sqrt(f.size)));
    const width = max(widthPx.mul(refPixel(u)), u.pixelAngle.mul(1.5)).mul(dist).mul(live);
    material.positionNode = at.add(side.mul(uv().y.sub(0.5).mul(width)));
    const vSince = varying(since, 'vSdMeteorSince');
    const vInfo = varying(vec4(f.kind, s, lead, live.mul(unhidden(u, at))), 'vSdMeteorInfo');
    const vRgb = varying(vec4(f.rgb, slotAttr), 'vSdMeteorRgb');
    material.colorNode = Fn(() => {
        const kind = vInfo.x;
        const t = vSince.toVar();
        const across = clamp(abs(uv().y.sub(0.5)).mul(2.0), 0.0, 1.0);
        const a2 = across.mul(across);
        const core = exp(a2.mul(-14.0));
        const soft = exp(a2.mul(-2.6)).mul(float(1.0).sub(smoothstep(0.8, 1.0, across)));
        const hot = exp(t.div(mix(float(0.05), float(0.07), kind)).negate());
        const warm = exp(t.div(mix(float(0.16), float(0.2), kind)).negate());
        const glowing = exp(t.div(mix(float(METEOR_TRAIN * 0.2), float(MOTE_TRAIN * 0.4), kind)).negate());
        // A meteor sheds pieces as it burns: its trail breaks up along the path.
        const seed = vRgb.w.mul(1.7);
        const pieces = clamp(sin(vInfo.y.mul(157.0).add(seed)).mul(sin(vInfo.y.mul(61.0).add(seed.mul(3.1)))).mul(0.6)
            .add(0.7), 0.25, 1.3);
        const broken = mix(pieces, float(1.0), kind);
        const whiteHot = mix(vec3(1.0, 0.95, 0.86), vRgb.rgb, smoothstep(0.0, 0.3, t));
        const trainHue = mix(vRgb.rgb, vec3(0.55, 0.8, 1.0), mix(float(0.3), float(0.1), kind));
        const light = whiteHot.mul(core).mul(hot.mul(4.2).add(warm.mul(1.1))).mul(broken)
            .add(trainHue.mul(soft).mul(warm.mul(0.3).add(glowing.mul(0.24)).mul(mix(broken, float(1.0), 0.6))));
        const tailFade = smoothstep(0.0, 0.2, vInfo.z);
        return vec4(light.mul(tailFade).mul(vInfo.w).mul(mix(float(1.0), float(1.9), kind)), 0.0);
    })();

    const part = sdPart('StellarDriftMeteors', geometry, material, 9);
    let cursor = 0;
    const mid = new THREE.Vector3();
    return {
        ...part,
        table,
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

/**
 * The heads of the flights: a point of white-hot light in a halo of the piece's colour, with the
 * faint four-point spikes a lens gives a star. A meteor's head flickers as it burns and swells as
 * it meets the giant's air; a mote's is steady and smaller.
 */
export function createHeads(u, meteors) {
    const slots = Float32Array.from({ length: METEOR_SLOTS }, (_, i) => i);
    const geometry = sdQuadGeometry(METEOR_SLOTS, { aSlot: [slots, 1] });
    const material = sdFxMaterial('StellarDriftHeads');
    const slotAttr = attribute('aSlot', 'float');
    const f = readFlight(u, meteors.table, slotAttr);
    const showing = step(0.0, f.age).mul(step(f.age, f.flight.add(0.02)));
    const at = f.bezier(f.phase);
    const dist = length(u.camPos.sub(at));
    const burst = mix(smoothstep(0.72, 1.0, f.phase).mul(1.6), smoothstep(0.85, 1.0, f.phase).mul(0.6), f.kind);
    const sizePx = f.size.mul(mix(float(46.0), float(58.0), f.kind)).mul(burst.mul(0.5).add(1.0));
    const size = max(sizePx.mul(refPixel(u)), u.pixelAngle.mul(5.0)).mul(dist).mul(showing);
    material.positionNode = at
        .add(u.camRight.mul(positionGeometry.x.mul(size)))
        .add(u.camUp.mul(positionGeometry.y.mul(size)));
    const flicker = mix(
        sin(f.age.mul(71.0).add(slotAttr.mul(3.1))).mul(sin(f.age.mul(23.0).add(slotAttr))).mul(0.18).add(0.86),
        float(1.0),
        f.kind,
    );
    const gain = burst.mul(2.0).add(1.0).mul(flicker).mul(showing)
        .mul(unhidden(u, at));
    const vHead = varying(vec4(f.rgb, gain), 'vSdHead');
    const vKind = varying(f.kind, 'vSdHeadKind');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0).toVar();
        const r2 = dot(p, p).toVar();
        const core = exp(r2.mul(-70.0));
        const inner = exp(r2.mul(-16.0)).mul(0.8);
        const halo = exp(r2.mul(-4.5)).mul(0.16);
        const ax = abs(p.x);
        const ay = abs(p.y);
        const spikes = exp(ay.mul(-55.0)).mul(exp(p.x.mul(p.x).mul(-5.0)))
            .add(exp(ax.mul(-55.0)).mul(exp(p.y.mul(p.y).mul(-5.0)))).mul(0.22);
        const edge = float(1.0).sub(smoothstep(0.6, 1.0, r2));
        const light = vec3(1.0).mul(core.mul(3.0))
            .add(mix(vec3(1.0), vHead.rgb, 0.5).mul(inner))
            .add(vHead.rgb.mul(halo.add(spikes)));
        return vec4(light.mul(edge).mul(vHead.w).mul(mix(float(1.4), float(1.7), vKind)), 0.0);
    })();
    return { ...sdPart('StellarDriftHeads', geometry, material, 10), update() {} };
}
