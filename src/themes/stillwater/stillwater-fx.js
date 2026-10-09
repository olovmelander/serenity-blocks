/**
 * Stillwater — what gameplay sets in flight, and what lives in the air of the place.
 *
 * Every pool is always drawn; a dormant slot is a degenerate quad. Nothing is created at event
 * time: an event writes a few numbers (where from, where to, when) and the vertex shader places
 * the quads as a function of the clock, so any moment can be replayed.
 *
 *   drops      a lock's light falling from the card to the water, with a wake of motes
 *   wisps      the will-o'-the-wisp a lock leaves standing over the water: a small flame of the
 *              piece's colour, until a clear gathers it
 *   sparks     the motes everything else is made of: a splash's crown, the cleared rows leaving
 *              the card, light going home to the lantern or the spirit, fireflies startled up
 *   fireflies  over the banks, more of them awake the longer a chain runs
 *   eyes       pairs of eyes between the far trunks: the wood watches a long chain
 *   mist       sheets of mist lying over the water, rank behind rank
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
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
    mix,
    normalize,
    positionGeometry,
    positionWorld,
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
    DROP_SLOTS,
    WISP_SLOTS,
    mulberry32,
    swFogAmount,
    swHash11,
    swHaze,
    swPart,
} from './stillwater-tsl.js';
import { shoreDistance } from './stillwater-plan.js';

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    // (Quads built in view space always face the viewer: one side is enough, and half the pipelines.)
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
};

// ── Drops ───────────────────────────────────────────────────────────────────────

/** Motes in a drop's wake. */
const DROP_TAIL = 9;

/**
 * A lock's light on its way from the card to the water: it leaves the card sideways and falls
 * in an arc, a bead of light with its wake behind it.
 * @param {object} u
 */
export function createDrops(u) {
    const perDrop = 1 + DROP_TAIL;
    const n = DROP_SLOTS * perDrop;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 3); // (slot, how far back in the wake 0..1, seed)
    const rand = mulberry32(2203);
    for (let s = 0; s < DROP_SLOTS; s++) {
        for (let i = 0; i < perDrop; i++) data.set([s, i / DROP_TAIL, rand()], (s * perDrop + i) * 3);
    }
    geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(data, 3));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const from = Array.from({ length: DROP_SLOTS }, () => new THREE.Vector4(0, 0, 0, -100)); // xyz, birth
    const to = Array.from({ length: DROP_SLOTS }, () => new THREE.Vector4(0, 0, 0, 1)); // xyz, flight
    const tint = Array.from({ length: DROP_SLOTS }, () => new THREE.Vector4(1, 1, 1, 0)); // rgb, size
    const uFrom = uniformArray(from, 'vec4');
    const uTo = uniformArray(to, 'vec4');
    const uTint = uniformArray(tint, 'vec4');

    const material = additive('StillwaterDrops');
    const aDrop = attribute('aDrop', 'vec3');
    const slot = int(aDrop.x.add(0.5));
    const vTint = varying(uTint.element(slot).rgb, 'vDropTint');
    const vFade = varying(float(0.0), 'vDropFade');
    material.vertexNode = Fn(() => {
        const A = uFrom.element(slot);
        const B = uTo.element(slot);
        const T = uTint.element(slot);
        const flight = max(B.w, 0.05);
        // A mote of the wake is the drop a little earlier.
        const age = u.time.sub(A.w).sub(aDrop.y.mul(0.16)).toVar();
        const x = clamp(age.div(flight), 0.0, 1.0).toVar();
        // Thrown out level, then it falls: quick sideways at first, the drop all at the end.
        const out = float(1.0).sub(float(1.0).sub(x).mul(float(1.0).sub(x)));
        const fall = x.mul(x);
        const p = vec3(
            mix(A.x, B.x, out),
            mix(A.y, B.y, fall).add(sin(x.mul(Math.PI)).mul(0.25)),
            mix(A.z, B.z, out),
        );
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const dist = max(view.z.negate(), 1.0);
        const head = step(aDrop.y, 0.01);
        const live = step(0.0, age).mul(step(age, flight)).mul(step(0.5, T.w.mul(1000.0)));
        vFade.assign(live.mul(mix(float(1.0).sub(aDrop.y).mul(0.5), float(1.0), head)));
        const size = T.w.mul(dist.div(10.0).pow(0.5)).mul(mix(float(1.0).sub(aDrop.y.mul(0.75)).mul(0.55), float(1.0), head));
        const jitter = vec2(swHash11(aDrop.z.mul(71.0)).sub(0.5), swHash11(aDrop.z.mul(37.0)).sub(0.5))
            .mul(aDrop.y).mul(0.16);
        const q = positionGeometry.xy.mul(size).mul(live);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x).add(jitter.x), view.y.add(q.y).add(jitter.y), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const shape = exp(d.mul(d).mul(-11.0)).mul(3.2).add(exp(d.mul(-4.5)).mul(0.5)).mul(edge);
        return vec4(mix(vTint, vec3(1.0, 0.97, 0.9), exp(d.mul(d).mul(-30.0)).mul(0.6)).mul(shape).mul(vFade).mul(u.breath), 0.0);
    })();
    mesh.material = material;

    const part = swPart('StillwaterDrops', geometry, material, 68, { mesh });
    part.cursor = 0;
    /** Send a drop from a world point to a point on the water. @returns {number} its slot */
    part.launch = ({
        from: a, to: b, rgb, time, flight, size = 0.3,
    }) => {
        const i = part.cursor % DROP_SLOTS;
        part.cursor += 1;
        from[i].set(a[0], a[1], a[2], time);
        to[i].set(b[0], b[1], b[2], flight);
        tint[i].set(rgb[0] * 2.4, rgb[1] * 2.4, rgb[2] * 2.4, size);
        return i;
    };
    part.reset = () => {
        part.cursor = 0;
        for (let i = 0; i < DROP_SLOTS; i++) {
            from[i].set(0, 0, 0, -100);
            tint[i].set(1, 1, 1, 0);
        }
    };
    return part;
}

// ── Wisps ───────────────────────────────────────────────────────────────────────

/** Motes in a wisp's flame. */
const WISP_FLAME = 5;

/**
 * The wisps' sprites. Where each wisp is and how brightly it burns is the world's business: it
 * writes the shared wisp table (u.wisps: (x, y, z, light) and (r, g, b, seed) per wisp, live
 * rows first), which the water also reads for their reflections.
 * @param {object} u
 */
export function createWisps(u) {
    const perWisp = 2 + WISP_FLAME; // the glow, the heart, the flame
    const n = WISP_SLOTS * perWisp;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 3); // (slot, kind 0 glow | 1 heart | 2 flame, k 0..1)
    for (let s = 0; s < WISP_SLOTS; s++) {
        for (let i = 0; i < perWisp; i++) {
            const kind = Math.min(i, 2);
            data.set([s, kind, kind === 2 ? (i - 2) / WISP_FLAME : 0], (s * perWisp + i) * 3);
        }
    }
    geometry.setAttribute('aWisp', new THREE.InstancedBufferAttribute(data, 3));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('StillwaterWisps');
    const aWisp = attribute('aWisp', 'vec3');
    const slot = int(aWisp.x.add(0.5));
    const vTint = varying(u.wisps.element(slot.mul(2).add(1)).rgb, 'vWispTint');
    const vKind = varying(aWisp.y, 'vWispKind');
    const vFade = varying(float(0.0), 'vWispFade');
    material.vertexNode = Fn(() => {
        const A = u.wisps.element(slot.mul(2));
        const C = u.wisps.element(slot.mul(2).add(1));
        const kind = aWisp.y;
        const seed = C.w;
        const live = step(aWisp.x.add(0.5), u.counts.z).mul(step(0.001, A.w));
        const isGlow = float(1.0).sub(step(0.5, kind));
        const isHeart = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind)));
        const isFlame = step(1.5, kind);
        // The flame: motes that leave the heart, climb and go out, one after another.
        const cycle = fract(u.time.mul(0.9).add(aWisp.z).add(seed.mul(7.0)));
        const climb = vec3(
            sin(cycle.mul(9.0).add(seed.mul(40.0)).add(aWisp.z.mul(20.0))).mul(0.05).mul(cycle),
            cycle.mul(0.42),
            cos(cycle.mul(7.0).add(seed.mul(23.0))).mul(0.05).mul(cycle),
        ).mul(isFlame);
        // It never hangs quite still.
        const flicker = sin(u.time.mul(11.0).add(seed.mul(60.0))).mul(0.06)
            .add(sin(u.time.mul(4.3).add(seed.mul(17.0))).mul(0.1)).add(1.0);
        const view = cameraViewMatrix.mul(vec4(A.xyz.add(climb), 1.0)).toVar();
        const dist = max(view.z.negate(), 1.0);
        const base = dist.div(14.0).pow(0.5).mul(A.w.mul(0.5).add(0.5));
        const size = base.mul(isGlow.mul(1.05).add(isHeart.mul(0.26)).add(isFlame.mul(float(1.0).sub(cycle).mul(0.16))));
        vFade.assign(live.mul(A.w).mul(flicker)
            .mul(isGlow.mul(0.3).add(isHeart.mul(1.4)).add(isFlame.mul(float(1.0).sub(cycle)).mul(1.0))));
        const q = positionGeometry.xy.mul(size).mul(live);
        // The heart is a little taller than wide: a flame, not a ball.
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y.mul(isHeart.mul(0.5).add(1.0))), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const isGlow = float(1.0).sub(step(0.5, vKind));
        const soft = exp(d.mul(-3.6)).mul(0.5).add(exp(d.mul(d).mul(-7.0)).mul(0.5));
        const hard = exp(d.mul(d).mul(-7.0)).mul(2.6);
        const shape = mix(hard, soft, isGlow).mul(edge);
        const hue = mix(mix(vTint, vec3(1.0, 0.98, 0.92), 0.55), vTint, isGlow);
        return vec4(hue.mul(shape).mul(vFade).mul(u.breath).mul(1.7), 0.0);
    })();
    mesh.material = material;
    return swPart('StillwaterWisps', geometry, material, 69, { mesh });
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

export const SPARK_DRIFT = 0;
export const SPARK_HOME = 1;
export const SPARK_SPLASH = 2;

/**
 * The motes. Three ways of moving: DRIFT (thrown, slowed by the air, sinking with a flutter),
 * HOME (eased along a line to where its velocity takes it in its lifetime: light going to the
 * lantern or the spirit), SPLASH (thrown up and fallen back: a drop of water with light in it;
 * it is gone when it meets the surface again).
 * @param {object} u
 * @param {number} count
 */
export function createSparks(u, count) {
    const n = Math.max(8, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const birth = new Float32Array(n * 4).fill(0); // xyz, time
    const motion = new Float32Array(n * 4).fill(0); // velocity xyz, life
    const look = new Float32Array(n * 4).fill(0); // rgb, size
    const mode = new Float32Array(n).fill(0);
    for (let i = 0; i < n; i++) birth[i * 4 + 3] = -100;
    const aBirth = new THREE.InstancedBufferAttribute(birth, 4);
    const aMotion = new THREE.InstancedBufferAttribute(motion, 4);
    const aLook = new THREE.InstancedBufferAttribute(look, 4);
    const aMode = new THREE.InstancedBufferAttribute(mode, 1);
    [aBirth, aMotion, aLook, aMode].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aBirth', aBirth);
    geometry.setAttribute('aMotion', aMotion);
    geometry.setAttribute('aLook', aLook);
    geometry.setAttribute('aMode', aMode);
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('StillwaterSparks');
    const nBirth = attribute('aBirth', 'vec4');
    const nMotion = attribute('aMotion', 'vec4');
    const nLook = attribute('aLook', 'vec4');
    const nMode = attribute('aMode', 'float');
    const vTint = varying(nLook.rgb, 'vSparkTint');
    const vFade = varying(float(0.0), 'vSparkFade');
    material.vertexNode = Fn(() => {
        const age = u.time.sub(nBirth.w).toVar();
        const life = max(nMotion.w, 0.05);
        const x = clamp(age.div(life), 0.0, 1.0).toVar();
        const isHome = step(0.5, nMode).mul(float(1.0).sub(step(1.5, nMode)));
        const isSplash = step(1.5, nMode);
        const seed = fract(nBirth.x.mul(13.7).add(nBirth.y.mul(7.3)).add(nBirth.w.mul(3.1)));
        // Drifting: the throw dies in the air, then it sinks, wandering as it goes.
        const thrown = nMotion.xyz.mul(float(1.0).sub(exp(age.mul(-2.2))).div(2.2));
        const sink = vec3(
            sin(age.mul(2.3).add(seed.mul(40.0))).mul(0.35).mul(x),
            age.mul(-0.22).sub(age.mul(age).mul(0.05)),
            cos(age.mul(1.9).add(seed.mul(23.0))).mul(0.35).mul(x),
        );
        const drifting = nBirth.xyz.add(thrown).add(sink);
        // Going home: slow to leave, quick to arrive, on a line that bows upward.
        const ease = x.mul(x).mul(float(3.0).sub(x.mul(2.0)));
        const bow = sin(x.mul(Math.PI)).mul(sin(seed.mul(60.0)).mul(0.5).add(0.9));
        const homing = nBirth.xyz.add(nMotion.xyz.mul(life).mul(ease)).add(vec3(0.0, bow, 0.0));
        // A splash: up, and back under its own weight.
        const splash = nBirth.xyz.add(nMotion.xyz.mul(age)).add(vec3(0.0, age.mul(age).mul(-4.4), 0.0));
        const p = mix(mix(drifting, homing, isHome), splash, isSplash).toVar();
        const above = mix(float(1.0), step(-0.02, p.y), isSplash);
        const view = cameraViewMatrix.mul(vec4(p, 1.0));
        const dist = max(view.z.negate(), 1.0);
        const live = step(0.0, age).mul(step(age, life)).mul(above);
        const twinkle = sin(age.mul(seed.mul(9.0).add(5.0)).add(seed.mul(70.0))).mul(0.5).add(0.5);
        const steady = max(isHome, isSplash);
        const shine = mix(twinkle.mul(twinkle).mul(0.8).add(0.2), float(1.0), steady);
        vFade.assign(live.mul(smoothstep(0.0, 0.05, x)).mul(float(1.0).sub(smoothstep(0.6, 1.0, x))).mul(shine));
        const grown = nLook.w.mul(dist.div(14.0).pow(0.5)).mul(live);
        const q = positionGeometry.xy.mul(grown);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-9.0));
        const shape = core.mul(2.6).add(exp(d.mul(-4.0)).mul(0.25)).mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
        return vec4(vTint.mul(shape).mul(vFade).mul(u.breath), 0.0);
    })();
    mesh.material = material;

    const part = swPart('StillwaterSparks', geometry, material, 70, { mesh });
    part.count = n;
    part.cursor = 0;
    let rand = mulberry32(8123);
    /**
     * Throw `n` motes from a point.
     * @param {object} e
     * @param {number[]} e.at          world point
     * @param {number} e.n
     * @param {number[]} e.rgb
     * @param {number} e.time          when they appear (may be in the future)
     * @param {number[]} [e.vel]       mean velocity (m/s)
     * @param {number} [e.spread=1]    random velocity added (m/s)
     * @param {number} [e.scatter=0]   random offset of the starting point (m)
     * @param {number[]} [e.life]      [min, max] seconds
     * @param {number} [e.size=0.1]
     * @param {number} [e.stagger=0]   seconds over which they appear
     * @param {number[]} [e.home]      a world point: the motes go THERE instead of drifting
     * @param {boolean} [e.splash]     thrown up and fallen back
     */
    part.emit = ({
        at, n: amount, rgb, time, vel = [0, 0, 0], spread = 1, scatter = 0, life = [1.0, 2.2], size = 0.1, stagger = 0,
        home = null, splash = false,
    }) => {
        const many = Math.max(0, Math.min(n, Math.round(amount)));
        for (let k = 0; k < many; k++) {
            const i = part.cursor % n;
            part.cursor += 1;
            const o = i * 4;
            const ox = at[0] + (rand() - 0.5) * 2 * scatter;
            const oy = at[1] + (rand() - 0.5) * 2 * scatter * (splash ? 0 : 1);
            const oz = at[2] + (rand() - 0.5) * 2 * scatter;
            const lifetime = life[0] + (life[1] - life[0]) * rand();
            birth.set([ox, oy, oz, time + rand() * stagger], o);
            if (home) {
                const per = 1 / lifetime;
                motion.set([(home[0] - ox) * per, (home[1] - oy) * per, (home[2] - oz) * per, lifetime], o);
                mode[i] = SPARK_HOME;
            } else {
                motion.set([
                    vel[0] + (rand() - 0.5) * 2 * spread,
                    vel[1] + (splash ? rand() * spread : (rand() - 0.5) * 2 * spread),
                    vel[2] + (rand() - 0.5) * 2 * spread,
                    lifetime,
                ], o);
                mode[i] = splash ? SPARK_SPLASH : SPARK_DRIFT;
            }
            const s = size * (0.6 + rand() * 0.8);
            const gain = 1.4 + rand() * 1.6;
            look.set([rgb[0] * gain, rgb[1] * gain, rgb[2] * gain, s], o);
        }
        if (many > 0) {
            aBirth.needsUpdate = true;
            aMotion.needsUpdate = true;
            aLook.needsUpdate = true;
            aMode.needsUpdate = true;
        }
        return many;
    };
    part.reset = () => {
        part.cursor = 0;
        // The same events throw the same motes again: a replay is exact.
        rand = mulberry32(8123);
        for (let i = 0; i < n; i++) birth[i * 4 + 3] = -100;
        look.fill(0);
        aBirth.needsUpdate = true;
        aLook.needsUpdate = true;
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
    const data = new Float32Array(n * 4); // (stage x, y, z, seed)
    const rand = mulberry32(1777);
    let placed = 0;
    let guard = 0;
    while (placed < n && guard < n * 60) {
        guard += 1;
        const x = (rand() - 0.5) * 44;
        const z = 6 - rand() ** 1.3 * 46;
        const y = 0.25 + rand() ** 1.8 * 3.6;
        const seed = rand();
        // Over the reeds and the moss at the water's edge, not out over the open tarn.
        const d = shoreDistance(x, z);
        if (d < -2.2 || d > 6.5) continue;
        data.set([x, y, z, seed], placed * 4);
        placed += 1;
    }
    geometry.setAttribute('aFly', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = count > 0 ? placed : 0;
    mesh.frustumCulled = false;

    const material = additive('StillwaterFireflies');
    const aFly = attribute('aFly', 'vec4');
    const vGlow = varying(float(0.0), 'vFlyGlow');
    material.vertexNode = Fn(() => {
        const s = aFly.w;
        const t = u.drift;
        const wander = vec3(
            sin(t.mul(s.mul(0.3).add(0.21)).add(s.mul(50.0))).mul(0.9).add(sin(t.mul(0.53).add(s.mul(13.0))).mul(0.35)),
            sin(t.mul(s.mul(0.25).add(0.33)).add(s.mul(31.0))).mul(0.35),
            cos(t.mul(s.mul(0.2).add(0.17)).add(s.mul(77.0))).mul(1.0),
        );
        const at = vec3(aFly.x.mul(u.squeeze), aFly.y, aFly.z).add(wander);
        const view = cameraViewMatrix.mul(vec4(at, 1.0));
        const dist = max(view.z.negate(), 1.0);
        // It shows its light in slow pulses, each to its own count; a chain wakes the sleepers.
        const pulse = sin(t.mul(s.mul(0.9).add(0.7)).add(s.mul(90.0))).mul(0.5).add(0.5);
        const awake = step(fract(s.mul(17.0)), u.power.mul(0.62).add(u.surge.mul(0.4)).add(0.38));
        vGlow.assign(pulse.mul(pulse).mul(pulse).mul(awake).mul(u.power.mul(0.7).add(1.0)));
        const size = float(0.11).mul(dist.div(12.0).pow(0.55));
        const q = positionGeometry.xy.mul(size);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const edge = float(1.0).sub(smoothstep(0.75, 1.0, d));
        const shape = exp(d.mul(d).mul(-14.0)).mul(3.0).add(exp(d.mul(-5.0)).mul(0.3)).mul(edge);
        return vec4(u.firefly.mul(shape).mul(vGlow).mul(u.breath).mul(1.6), 0.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterFireflies', geometry, material, 67, { mesh });
    part.count = mesh.count;
    return part;
}

// ── Eyes ────────────────────────────────────────────────────────────────────────

/**
 * Pairs of eyes in the far wood. They open in the order of their rank as u.eyes.x rises, all of
 * them for a moment when u.eyes.y flashes, and each blinks to its own count.
 * @param {object} u
 * @param {Array} plan  planEyes()
 */
export function createEyes(u, plan) {
    const pairs = Math.max(1, plan.length);
    const n = pairs * 2;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const place = new Float32Array(n * 4); // stage x, y, z, rank
    const shape = new Float32Array(n * 4); // offset along the pair's line, size, seed, tilt
    plan.forEach((e, i) => {
        for (let k = 0; k < 2; k++) {
            place.set([e.x, e.y, e.z, e.rank], (i * 2 + k) * 4);
            shape.set([(k === 0 ? -0.5 : 0.5) * e.gap, e.size, e.seed, (e.seed % 1) * 0.5 - 0.25], (i * 2 + k) * 4);
        }
    });
    geometry.setAttribute('aEyeAt', new THREE.InstancedBufferAttribute(place, 4));
    geometry.setAttribute('aEyeShape', new THREE.InstancedBufferAttribute(shape, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = plan.length * 2;
    mesh.frustumCulled = false;

    const material = additive('StillwaterEyes');
    material.depthTest = true;
    const aAt = attribute('aEyeAt', 'vec4');
    const aShape = attribute('aEyeShape', 'vec4');
    const vOpen = varying(float(0.0), 'vEyeOpen');
    const vLid = varying(float(1.0), 'vEyeLid');
    material.vertexNode = Fn(() => {
        const seed = aShape.z;
        // The head it belongs to moves a little: a thing that breathes is looking.
        const sway = vec3(
            sin(u.time.mul(0.31).add(seed.mul(9.0))).mul(0.12),
            sin(u.time.mul(0.23).add(seed.mul(5.0))).mul(0.06),
            0.0,
        );
        const at = vec3(aAt.x.mul(u.squeeze), aAt.y, aAt.z).add(sway);
        const view = cameraViewMatrix.mul(vec4(at, 1.0)).toVar();
        const dist = max(view.z.negate(), 1.0);
        const wake = max(
            smoothstep(aAt.w.mul(0.9), aAt.w.mul(0.9).add(0.1), u.eyes.x),
            smoothstep(aAt.w.mul(0.7), aAt.w.mul(0.7).add(0.3), u.eyes.y.mul(1.4)),
        );
        // A blink: shut for a moment, each to its own count.
        const count = fract(u.time.mul(seed.mul(0.07).add(0.11)).add(seed.mul(3.0)));
        const lid = clamp(abs(count.sub(0.02)).div(0.02), 0.0, 1.0);
        vLid.assign(lid);
        vOpen.assign(wake.mul(float(1.0).sub(swFogAmount(u, at).mul(0.55))));
        // Drawn a little larger than life at a distance, or they would be lost.
        const size = aShape.y.mul(dist.div(30.0).pow(0.6)).mul(2.2);
        const tilt = aShape.w;
        const along = vec2(cos(tilt), sin(tilt));
        const q = positionGeometry.xy.mul(size).mul(step(0.01, wake));
        return cameraProjectionMatrix.mul(vec4(
            view.x.add(along.x.mul(aShape.x)).add(q.x),
            view.y.add(along.y.mul(aShape.x)).add(q.y),
            view.z,
            1.0,
        ));
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        // An eye: round, shut from above and below by its lids.
        const d = length(vec2(q.x, q.y.div(max(vLid.mul(0.8).add(0.06), 0.06))));
        const edge = float(1.0).sub(smoothstep(0.55, 0.95, d));
        const light = exp(d.mul(d).mul(-5.0)).mul(2.4).add(exp(d.mul(-3.0)).mul(0.2)).mul(edge);
        return vec4(u.eye.mul(light).mul(vOpen).mul(u.breath), 0.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterEyes', geometry, material, 66, { mesh });
    part.count = plan.length;
    return part;
}

// ── Mist ────────────────────────────────────────────────────────────────────────

/** Where the sheets stand (z), how wide and how tall they are, and how much they hide. */
const MIST_SHEETS = [
    {
        z: -52, half: 60, height: 5.2, alpha: 0.62,
    },
    {
        z: -38, half: 48, height: 4.0, alpha: 0.52,
    },
    {
        z: -27, half: 38, height: 3.0, alpha: 0.44,
    },
    {
        z: -18.5, half: 28, height: 2.2, alpha: 0.36,
    },
    {
        z: -12.5, half: 22, height: 1.5, alpha: 0.26,
    },
    {
        z: -6, half: 16, height: 1.0, alpha: 0.2,
    },
];

/**
 * Sheets of mist over the water, the farthest first. Each is a low wall of the mist's own
 * colour with a torn upper edge, drifting sideways at its own pace.
 * @param {object} u
 * @param {number} count  how many of the sheets (the far ones first)
 */
export function createMist(u, count) {
    const sheets = MIST_SHEETS.slice(0, Math.max(1, Math.min(MIST_SHEETS.length, count)));
    const positions = [];
    const uvs = [];
    const info = [];
    const index = [];
    sheets.forEach((s, i) => {
        const base = positions.length / 3;
        positions.push(-s.half, -0.05, s.z, s.half, -0.05, s.z, -s.half, s.height, s.z, s.half, s.height, s.z);
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        for (let k = 0; k < 4; k++) info.push(s.alpha, i * 0.173 + 0.11, s.half, s.height);
        index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(info), 4));
    geometry.setIndex(index);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterMist';
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    material.fragmentNode = Fn(() => {
        const st = uv();
        const sheet = attribute('aSheet', 'vec4');
        const P = positionWorld;
        const along = st.x.sub(0.5).mul(sheet.z);
        // Banks of it, thick here and thin there, with a torn upper edge.
        const slow = u.noise(vec2(along.mul(0.012).add(u.drift.mul(0.0011)).add(sheet.y), sheet.y.mul(3.0)));
        const torn = u.noise(vec2(along.mul(0.05).sub(u.drift.mul(0.0023)), st.y.mul(0.35).add(sheet.y.mul(7.0))));
        const top = slow.r.mul(0.6).add(torn.g.mul(0.4)).mul(0.9).add(0.12);
        const body = float(1.0).sub(smoothstep(top.mul(0.35), top, st.y));
        const ends = smoothstep(0.0, 0.2, st.x).mul(smoothstep(1.0, 0.8, st.x));
        // It thins where the viewer stands close to it.
        const near = smoothstep(2.0, 9.0, length(P.sub(cameraPosition)));
        const a = body.mul(ends).mul(near).mul(sheet.x).mul(slow.b.mul(0.5).add(0.6))
            .mul(u.mist.mul(0.7).add(0.3))
            .mul(float(1.0).sub(u.lift));
        const dir = normalize(P.sub(cameraPosition));
        return vec4(swHaze(u, dir).mul(a), a);
    })();
    const part = swPart('StillwaterMist', geometry, material, 50);
    part.count = sheets.length;
    return part;
}
