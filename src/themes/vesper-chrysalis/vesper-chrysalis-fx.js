/**
 * Vesper Chrysalis — what gameplay sets in flight: the moths, the wing-dust, the blades of
 * light and the fireflies.
 *
 * Every pool is always drawn; a dormant slot is a degenerate quad. Nothing is created at event
 * time: an event writes a few numbers (where from, where to, when) and the vertex shader places
 * the quads as a function of the clock, so any moment can be replayed.
 *
 *   moths      a lock's light on its way to a lily: two beating wings, a glow, a wake of motes,
 *              on a bowed path with a moth's flutter in it
 *   dust       wing scales: thrown where the wings are being written, shed everywhere when they
 *              fall, and — as light let go by a lily — streaming home to the chrysalis
 *   blades     the cleared rows leaving the card (drawn in screen space, never mirrored)
 *   fireflies  over the water at the edges of the view
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    fract,
    int,
    length,
    max,
    min,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BLADE_SLOTS,
    HEART,
    MOTH_SLOTS,
    MOTH_TAIL,
    mulberry32,
    vcBell,
    vcHash11,
    vcPart,
} from './vesper-chrysalis-tsl.js';

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
};

// ── Moths ───────────────────────────────────────────────────────────────────────

/** Seconds a moth takes to melt into its lily once it has landed. */
const MOTH_SETTLE = 0.28;

/**
 * @param {object} u
 */
export function createMoths(u) {
    const perMoth = 3 + MOTH_TAIL; // two wings, the glow, the wake
    const n = MOTH_SLOTS * perMoth;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 4); // (slot, kind 0 | 1 wing, 2 glow, 3 mote, k 0..1, seed)
    const rand = mulberry32(3301);
    for (let s = 0; s < MOTH_SLOTS; s++) {
        for (let i = 0; i < perMoth; i++) {
            const kind = Math.min(i, 3);
            const k = kind === 3 ? (i - 2) / MOTH_TAIL : 0;
            data.set([s, kind, k, rand()], (s * perMoth + i) * 4);
        }
    }
    geometry.setAttribute('aMoth', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const from = Array.from({ length: MOTH_SLOTS }, () => new THREE.Vector4(0, 0, 0, -100)); // xyz, birth
    const to = Array.from({ length: MOTH_SLOTS }, () => new THREE.Vector4(0, 0, 0, 1)); // xyz, flight
    const bow = Array.from({ length: MOTH_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)); // xyz, seed
    const tint = Array.from({ length: MOTH_SLOTS }, () => new THREE.Vector4(1, 1, 1, 0)); // rgb, size
    const uFrom = uniformArray(from, 'vec4');
    const uTo = uniformArray(to, 'vec4');
    const uBow = uniformArray(bow, 'vec4');
    const uTint = uniformArray(tint, 'vec4');

    const material = additive('VesperChrysalisMoths');
    const aMoth = attribute('aMoth', 'vec4');
    const slot = int(aMoth.x.add(0.5));
    const vTint = varying(uTint.element(slot).rgb, 'vMothTint');
    const vKind = varying(aMoth.y, 'vMothKind');
    const vFade = varying(float(0.0), 'vMothFade');

    material.vertexNode = Fn(() => {
        const A = uFrom.element(slot);
        const B = uTo.element(slot);
        const C = uBow.element(slot);
        const T = uTint.element(slot);
        const kind = aMoth.y;
        // A mote of the wake is the moth a little earlier.
        const age = u.time.sub(A.w).sub(aMoth.z.mul(0.42)).toVar();
        const flight = max(B.w, 0.05);
        const x = clamp(age.div(flight), 0.0, 1.0).toVar();
        // It leaves the card fast and settles onto the lily.
        const s = float(1.0).sub(float(1.0).sub(x).mul(float(1.0).sub(x))).toVar();
        const mid = A.xyz.add(B.xyz).mul(0.5).add(C.xyz);
        const p = A.xyz.mul(float(1.0).sub(s).mul(float(1.0).sub(s)))
            .add(mid.mul(s.mul(float(1.0).sub(s)).mul(2.0)))
            .add(B.xyz.mul(s.mul(s)));
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const dist = max(view.z.negate(), 1.0);
        // The flutter: it never flies straight, least of all in the middle of its way.
        const wander = sin(x.mul(Math.PI)).mul(dist.mul(0.012).add(0.2));
        const seed = C.w.add(aMoth.z.mul(3.0));
        const flutterX = sin(age.mul(15.0).add(seed.mul(6.0))).mul(wander);
        const flutterY = cos(age.mul(21.0).add(seed.mul(9.0))).mul(wander).mul(0.7);
        // Seen from far it is drawn a little larger than life, or it would be lost.
        const size = T.w.mul(dist.div(15.0).pow(0.55));
        const q = positionGeometry.xy.toVar();
        const off = vec2(0.0).toVar();
        // Wings: two quads hinged on the body, beating.
        const beat = sin(age.mul(46.0).add(seed.mul(4.0)));
        const wingSide = kind.mul(2.0).sub(1.0);
        const wx = q.x.add(0.5).mul(wingSide).mul(abs(beat).mul(0.75).add(0.25));
        const wy = q.y.mul(0.9).add(q.x.add(0.5).mul(beat).mul(0.35));
        const isWing = float(1.0).sub(step(1.5, kind));
        const isGlow = step(1.5, kind).mul(float(1.0).sub(step(2.5, kind)));
        const isMote = step(2.5, kind);
        off.assign(vec2(wx, wy).mul(isWing).mul(size)
            .add(q.mul(isGlow).mul(size).mul(4.6))
            .add(q.mul(isMote).mul(size).mul(float(1.0).sub(aMoth.z.mul(0.7))).mul(0.8)));
        // Alive from its birth until it has melted into the lily.
        const live = step(0.0, age).mul(float(1.0).sub(smoothstep(flight, flight.add(MOTH_SETTLE), age)))
            .mul(step(0.5, T.w.mul(1000.0)));
        vFade.assign(live.mul(mix(float(1.0), float(1.0).sub(aMoth.z).mul(0.6), isMote))
            .mul(mix(float(1.0), vcHash11(aMoth.w.mul(91.0).add(age.mul(9.0).floor())).mul(0.7).add(0.3), isMote)));
        return cameraProjectionMatrix.mul(vec4(
            view.x.add(flutterX).add(off.x.mul(live)),
            view.y.add(flutterY).add(off.y.mul(live)),
            view.z,
            1.0,
        ));
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        // A wing is a soft leaf of light with a brighter leading edge; the rest are round.
        const wing = float(1.0).sub(smoothstep(0.55, 1.0, d)).mul(smoothstep(-1.0, 0.6, q.y).mul(0.6).add(0.4));
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const glow = exp(d.mul(-5.0)).mul(0.5).add(exp(d.mul(-16.0)).mul(1.6)).mul(edge);
        const mote = exp(d.mul(d).mul(-5.0)).mul(float(1.0).sub(smoothstep(0.7, 1.0, d)));
        const isWing = float(1.0).sub(step(1.5, vKind));
        const isGlow = step(1.5, vKind).mul(float(1.0).sub(step(2.5, vKind)));
        const isMote = step(2.5, vKind);
        const shape = wing.mul(isWing).mul(2.6).add(glow.mul(isGlow).mul(1.5)).add(mote.mul(isMote).mul(2.4));
        const hue = mix(vTint, vec3(1.0, 0.97, 0.92), isWing.mul(0.35));
        return vec4(hue.mul(shape).mul(vFade).mul(u.breath), 0.0);
    })();
    mesh.material = material;

    const part = vcPart('VesperChrysalisMoths', geometry, material, 68, { mesh });
    part.cursor = 0;
    /**
     * Send a moth. `from`/`to` world points, `bow` how the path bends (added at mid-flight).
     * @returns {number} the slot it took
     */
    part.launch = ({
        from: a, to: b, bow: c, rgb, time, flight, size = 0.34,
    }) => {
        const i = part.cursor % MOTH_SLOTS;
        part.cursor += 1;
        from[i].set(a[0], a[1], a[2], time);
        to[i].set(b[0], b[1], b[2], flight);
        bow[i].set(c[0], c[1], c[2], (part.cursor * 0.618) % 1);
        tint[i].set(rgb[0] * 2.2, rgb[1] * 2.2, rgb[2] * 2.2, size);
        return i;
    };
    part.reset = () => {
        part.cursor = 0;
        for (let i = 0; i < MOTH_SLOTS; i++) {
            from[i].set(0, 0, 0, -100);
            tint[i].set(1, 1, 1, 0);
        }
    };
    return part;
}

// ── Dust ────────────────────────────────────────────────────────────────────────

/**
 * Wing scales. A scale with a positive size falls: thrown, slowed by the air, drifting down
 * with a flutter. One with a NEGATIVE size is light going home: it eases along a straight line
 * to where its velocity takes it in its lifetime.
 * @param {object} u
 * @param {number} count
 */
export function createDust(u, count) {
    const n = Math.max(8, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const birth = new Float32Array(n * 4).fill(0); // xyz, time
    const motion = new Float32Array(n * 4).fill(0); // velocity xyz, life
    const look = new Float32Array(n * 4).fill(0); // rgb, size (negative = going home)
    for (let i = 0; i < n; i++) birth[i * 4 + 3] = -100;
    const aBirth = new THREE.InstancedBufferAttribute(birth, 4);
    const aMotion = new THREE.InstancedBufferAttribute(motion, 4);
    const aLook = new THREE.InstancedBufferAttribute(look, 4);
    [aBirth, aMotion, aLook].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aBirth', aBirth);
    geometry.setAttribute('aMotion', aMotion);
    geometry.setAttribute('aLook', aLook);
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('VesperChrysalisDust');
    const nBirth = attribute('aBirth', 'vec4');
    const nMotion = attribute('aMotion', 'vec4');
    const nLook = attribute('aLook', 'vec4');
    const vTint = varying(nLook.rgb, 'vDustTint');
    const vFade = varying(float(0.0), 'vDustFade');
    material.vertexNode = Fn(() => {
        const age = u.time.sub(nBirth.w).toVar();
        const life = max(nMotion.w, 0.05);
        const x = clamp(age.div(life), 0.0, 1.0).toVar();
        const home = step(nLook.w, 0.0);
        const size = abs(nLook.w);
        const seed = fract(nBirth.x.mul(13.7).add(nBirth.y.mul(7.3)).add(nBirth.w.mul(3.1)));
        // Falling: the throw dies in the air, then it sinks, turning as it goes.
        const thrown = nMotion.xyz.mul(float(1.0).sub(exp(age.mul(-2.2))).div(2.2));
        const sink = vec3(
            sin(age.mul(2.3).add(seed.mul(40.0))).mul(0.5).mul(x),
            age.mul(-0.55).sub(age.mul(age).mul(0.12)),
            cos(age.mul(1.9).add(seed.mul(23.0))).mul(0.5).mul(x),
        );
        const falling = nBirth.xyz.add(thrown).add(sink);
        // Going home: slow to leave, quick to arrive, on a line that swings a little.
        const ease = x.mul(x).mul(float(3.0).sub(x.mul(2.0)));
        const swing = sin(x.mul(Math.PI)).mul(sin(seed.mul(60.0))).mul(1.6);
        const homing = nBirth.xyz.add(nMotion.xyz.mul(life).mul(ease)).add(vec3(swing.mul(0.6), swing, 0.0));
        const p = mix(falling, homing, home);
        const view = cameraViewMatrix.mul(vec4(p, 1.0));
        const dist = max(view.z.negate(), 1.0);
        const live = step(0.0, age).mul(step(age, life));
        // A scale turns as it falls: it flashes when it faces the viewer.
        const turn = sin(age.mul(seed.mul(9.0).add(5.0)).add(seed.mul(70.0))).mul(0.5).add(0.5);
        const flashing = mix(turn.mul(turn).mul(0.85).add(0.15), float(1.0), home);
        vFade.assign(live.mul(smoothstep(0.0, 0.06, x)).mul(float(1.0).sub(smoothstep(0.55, 1.0, x))).mul(flashing));
        const grown = size.mul(dist.div(30.0).pow(0.45)).mul(live);
        const q = positionGeometry.xy.mul(grown);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        // A point with a little four-armed glint.
        const core = exp(d.mul(d).mul(-9.0));
        const arms = exp(abs(q.x).mul(-18.0)).mul(exp(abs(q.y).mul(-3.0)))
            .add(exp(abs(q.y).mul(-18.0)).mul(exp(abs(q.x).mul(-3.0))));
        const shape = core.mul(2.4).add(arms.mul(0.8)).mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
        return vec4(vTint.mul(shape).mul(vFade).mul(u.breath), 0.0);
    })();
    mesh.material = material;

    const part = vcPart('VesperChrysalisDust', geometry, material, 70, { mesh });
    part.count = n;
    part.cursor = 0;
    let rand = mulberry32(8123);
    /**
     * Throw `n` scales from a point.
     * @param {object} e
     * @param {number[]} e.at          world point
     * @param {number} e.n
     * @param {number[]} e.rgb
     * @param {number} e.time          when they appear (may be in the future)
     * @param {number[]} [e.vel]       mean velocity (m/s)
     * @param {number} [e.spread=2]    random velocity added (m/s)
     * @param {number} [e.scatter=0]   random offset of the starting point (m)
     * @param {number[]} [e.life]      [min, max] seconds
     * @param {number} [e.size=0.22]
     * @param {number} [e.stagger=0]   seconds over which they appear
     * @param {number[]} [e.home]      a world point: the scales go THERE instead of falling
     */
    part.emit = ({
        at, n: amount, rgb, time, vel = [0, 0, 0], spread = 2, scatter = 0, life = [1.2, 2.6], size = 0.22, stagger = 0,
        home = null,
    }) => {
        const many = Math.max(0, Math.min(n, Math.round(amount)));
        for (let k = 0; k < many; k++) {
            const i = part.cursor % n;
            part.cursor += 1;
            const o = i * 4;
            const ox = at[0] + (rand() - 0.5) * 2 * scatter;
            const oy = at[1] + (rand() - 0.5) * 2 * scatter;
            const oz = at[2] + (rand() - 0.5) * scatter;
            const lifetime = life[0] + (life[1] - life[0]) * rand();
            birth.set([ox, oy, oz, time + rand() * stagger], o);
            if (home) {
                const per = 1 / lifetime;
                motion.set([(home[0] - ox) * per, (home[1] - oy) * per, (home[2] - oz) * per, lifetime], o);
            } else {
                motion.set([
                    vel[0] + (rand() - 0.5) * 2 * spread,
                    vel[1] + (rand() - 0.5) * 2 * spread,
                    vel[2] + (rand() - 0.5) * spread,
                    lifetime,
                ], o);
            }
            const s = size * (0.6 + rand() * 0.8);
            const gain = 1.4 + rand() * 1.6;
            look.set([rgb[0] * gain, rgb[1] * gain, rgb[2] * gain, home ? -s : s], o);
        }
        if (many > 0) {
            aBirth.needsUpdate = true;
            aMotion.needsUpdate = true;
            aLook.needsUpdate = true;
        }
        return many;
    };
    part.reset = () => {
        part.cursor = 0;
        // The same events throw the same scales again: a replay is exact.
        rand = mulberry32(8123);
        for (let i = 0; i < n; i++) birth[i * 4 + 3] = -100;
        look.fill(0);
        aBirth.needsUpdate = true;
        aLook.needsUpdate = true;
    };
    return part;
}

// ── Blades ──────────────────────────────────────────────────────────────────────

/** Seconds a blade lives. */
export const BLADE_LIFE = 0.9;

/**
 * The cleared rows leave the card: from each row a blade of light shoots out of both edges of
 * the card. Drawn in screen space (never mirrored).
 * @param {object} u
 */
export function createBlades(u) {
    const quads = BLADE_SLOTS * 2;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(quads * 2); // (slot, side −1 | +1)
    for (let i = 0; i < quads; i++) data.set([Math.floor(i / 2), i % 2 === 0 ? -1 : 1], i * 2);
    geometry.setAttribute('aBlade', new THREE.InstancedBufferAttribute(data, 2));
    const mesh = new THREE.InstancedMesh(geometry, null, quads);
    mesh.frustumCulled = false;

    /** (y, x0, x1, birth) in screen fractions (y down), and (rgb, strength). */
    const rows = Array.from({ length: BLADE_SLOTS }, () => new THREE.Vector4(0.5, 0.4, 0.6, -100));
    const tints = Array.from({ length: BLADE_SLOTS }, () => new THREE.Vector4(1, 1, 1, 0));
    const uRows = uniformArray(rows, 'vec4');
    const uTints = uniformArray(tints, 'vec4');

    const material = additive('VesperChrysalisBlades');
    material.depthTest = false;
    const aBlade = attribute('aBlade', 'vec2');
    const slot = int(aBlade.x.add(0.5));
    const vTint = varying(uTints.element(slot), 'vBladeTint');
    const vAge = varying(u.time.sub(uRows.element(slot).w), 'vBladeAge');
    const REACH = 0.34; // of the screen's width
    const THICK = 0.024; // of the screen's height
    material.vertexNode = Fn(() => {
        const R = uRows.element(slot);
        const age = u.time.sub(R.w);
        const live = step(0.0, age).mul(step(age, BLADE_LIFE));
        const grow = float(1.0).sub(exp(age.mul(-7.0)));
        const edge = mix(R.y, R.z, aBlade.y.mul(0.5).add(0.5));
        // The quad runs from the card's edge outward.
        const along = positionGeometry.x.add(0.5);
        const sx = edge.add(aBlade.y.mul(along).mul(REACH).mul(grow));
        const sy = R.x.add(positionGeometry.y.mul(THICK).mul(2.0));
        return vec4(sx.mul(2.0).sub(1.0), float(1.0).sub(sy.mul(2.0)), 0.0, 1.0).mul(vec4(live, live, 1.0, 1.0));
    })();
    material.outputNode = Fn(() => {
        const q = uv();
        const along = q.x;
        const across = q.y.sub(0.5).mul(2.0);
        const fade = exp(vAge.mul(-4.2));
        // A hot core and a soft sheath, brightest at the head, with a spark running out along it.
        const core = exp(across.mul(across).mul(-110.0));
        const sheath = exp(abs(across).mul(-5.0)).mul(0.26);
        // Where it leaves the card it flares.
        const flare = vcBell(along.div(0.09)).mul(exp(across.mul(across).mul(-9.0))).mul(1.3);
        const taper = clamp(float(1.0).sub(along), 0.0, 1.0).pow(0.6).mul(smoothstep(0.0, 0.04, along));
        const head = vcBell(along.sub(min(vAge.mul(3.4), 0.96)).div(0.1)).mul(1.6);
        const light = core.add(sheath).mul(taper.add(head)).add(flare).mul(fade);
        return vec4(vTint.rgb.mul(light).mul(vTint.w).mul(5.0).mul(u.breath), 0.0);
    })();
    mesh.material = material;

    const part = vcPart('VesperChrysalisBlades', geometry, material, 80, { mesh });
    /**
     * @param {number[]} ys     screen y of each cleared row (fractions, y down)
     * @param {number} x0       the card's left edge
     * @param {number} x1       the card's right edge
     */
    part.fire = (ys, x0, x1, rgb, time, strength = 1) => {
        for (let i = 0; i < BLADE_SLOTS; i++) {
            if (i < ys.length) {
                rows[i].set(ys[i], x0, x1, time + i * 0.035);
                tints[i].set(rgb[0], rgb[1], rgb[2], strength);
            } else {
                rows[i].w = -100;
            }
        }
    };
    part.reset = () => {
        for (let i = 0; i < BLADE_SLOTS; i++) rows[i].w = -100;
    };
    return part;
}

// ── Fireflies ───────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {number} count
 */
export function createFireflies(u, count) {
    const n = Math.max(1, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 4); // (x, y, z, seed)
    const rand = mulberry32(1777);
    for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const depth = 9 + rand() ** 1.5 * 70;
        // Thickest near the reeds, thinning out over the open water.
        const lateral = 0.2 + rand() * 0.62;
        data.set([side * lateral * 0.767 * depth, 0.4 + rand() ** 1.7 * 5.5, -depth, rand()], i * 4);
    }
    geometry.setAttribute('aFly', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = count > 0 ? n : 0;
    mesh.frustumCulled = false;

    const material = additive('VesperChrysalisFireflies');
    const aFly = attribute('aFly', 'vec4');
    const vGlow = varying(float(0.0), 'vFlyGlow');
    const vSeed = varying(aFly.w, 'vFlySeed');
    material.vertexNode = Fn(() => {
        const s = aFly.w;
        const t = u.drift;
        const wander = vec3(
            sin(t.mul(s.mul(0.3).add(0.21)).add(s.mul(50.0))).mul(1.7).add(sin(t.mul(0.53).add(s.mul(13.0))).mul(0.6)),
            sin(t.mul(s.mul(0.25).add(0.33)).add(s.mul(31.0))).mul(0.7),
            cos(t.mul(s.mul(0.2).add(0.17)).add(s.mul(77.0))).mul(1.9),
        );
        const view = cameraViewMatrix.mul(vec4(aFly.xyz.add(wander), 1.0));
        const dist = max(view.z.negate(), 1.0);
        // It shows its light in slow pulses, each firefly to its own count.
        const pulse = sin(t.mul(s.mul(0.9).add(0.7)).add(s.mul(90.0))).mul(0.5).add(0.5);
        vGlow.assign(pulse.mul(pulse).mul(pulse).mul(u.power.mul(0.8).add(1.0)));
        const size = float(0.27).mul(dist.div(20.0).pow(0.5));
        const q = positionGeometry.xy.mul(size);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const edge = float(1.0).sub(smoothstep(0.75, 1.0, d));
        const shape = exp(d.mul(d).mul(-14.0)).mul(2.6).add(exp(d.mul(-5.0)).mul(0.3)).mul(edge);
        const hue = mix(u.core, u.crystal, fract(vSeed.mul(7.0)).mul(0.5)).add(vec3(0.12, 0.14, 0.02));
        return vec4(hue.mul(shape).mul(vGlow).mul(u.breath), 0.0);
    })();
    mesh.material = material;
    const part = vcPart('VesperChrysalisFireflies', geometry, material, 67, { mesh });
    part.count = mesh.count;
    return part;
}

export const DUST_HOME = Object.freeze([HEART[0], HEART[1], HEART[2] + 1.5]);
