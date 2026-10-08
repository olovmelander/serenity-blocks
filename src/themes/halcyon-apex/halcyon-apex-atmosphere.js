/**
 * Halcyon Apex — what hangs in the air.
 *
 *  - The upfall: under the Halcyon the lagoon runs upward, a funnel of drops that spirals in
 *    and narrows into the diamond's lower point. It is the sanctuary's one standing wonder, and
 *    line B's pulses climb it.
 *  - Beads: when a chain of clears lifts the sanctuary, drops of the lagoon bead up all over it
 *    and rise, each one a small lens with the sun in it. The longer the chain, the more of them.
 *  - Motes: dust in the morning light, bright only toward the sun.
 *  - The flock: birds circling far out over the water, thrown up by a four-line clear.
 *
 * Every particle is a closed-form function of the world's clocks and its own seed: nothing is
 * simulated and nothing is created at event time.
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
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LEY_B,
    LIFT_MAX,
    SITE,
    TAU,
    haAtmosphere,
    haFxMaterial,
    haPart,
    haPulseLight,
    haQuadGeometry,
    haSkyBase,
    mulberry32,
} from './halcyon-apex-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** A camera-facing quad of `metres` (clamped to a pixel range) at `world`. */
const billboard = (u, world, metres, minPx, maxPx, alive) => {
    const clip = viewProjection(world);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(metres.mul(pxPerMetre), u.viewport.y.mul(minPx), u.viewport.y.mul(maxPx)).mul(alive);
    return vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(u.viewport.mul(0.5)).mul(clip.w)), clip.z, clip.w);
};

function seeds(count, seed) {
    const rand = mulberry32(seed);
    const a = new Float32Array(count * 4);
    for (let i = 0; i < a.length; i++) a[i] = rand();
    return a;
}

// ── The upfall ──────────────────────────────────────────────────────────────────

/** The funnel's radius at the water, and the turns a drop makes on its way up. */
export const UPFALL_RADIUS = 7.5;
export const UPFALL_TURNS = 0.55;

/**
 * @param {object} u
 * @param {number} count
 */
export function createUpfall(u, count) {
    const geometry = haQuadGeometry(count, { aSeed: [seeds(count, 0x3f1), 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = haFxMaterial('HalcyonApexUpfall');
    const top = u.halcyonPos.y.sub(SITE.halcyon.half * 0.82);
    // Each drop climbs at its own pace; the chain's lift hurries them all.
    const k = fract(seed.x.add(u.beadLift.mul(seed.y.mul(0.05).add(0.045)))).toVar();
    const ease = k.mul(k).mul(float(3.0).sub(k.mul(2.0)));
    const radius = float(1.0).sub(ease).pow(1.4).mul(seed.z.mul(0.7).add(0.3))
        .mul(UPFALL_RADIUS);
    const angle = seed.w.mul(TAU).add(ease.mul(UPFALL_TURNS * TAU)).add(u.spin.mul(0.25));
    const world = vec3(
        u.halcyonPos.x.add(cos(angle).mul(radius)),
        ease.mul(top).add(0.05),
        u.halcyonPos.z.add(sin(angle).mul(radius)),
    );
    const metres = mix(float(0.2), float(0.07), ease).mul(seed.y.mul(0.8).add(0.6));
    material.vertexNode = billboard(u, world, metres, 0.0012, 0.02, float(1.0));
    const pulse = haPulseLight(u, float(1.0), float(LEY_B.ring).add(ease.mul(LEY_B.rise))).mul(u.pulsesLive);
    const fade = smoothstep(0.0, 0.08, k).mul(float(1.0).sub(smoothstep(0.9, 1.0, k)));
    const twinkle = sin(u.time.mul(seed.z.mul(5.0).add(3.0)).add(seed.w.mul(40.0))).mul(0.3).add(0.7);
    const light = mix(u.shallow.mul(1.6).add(0.2), u.sun.mul(0.5), ease.mul(0.5)).mul(twinkle).mul(u.power.mul(0.8).add(1.0))
        .add(u.ley.mul(pulse.w).mul(1.5))
        .add(pulse.rgb.mul(4.0));
    const vLight = varying(light.mul(fade).mul(u.breath), 'haUpfall');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-4.5))).mul(float(1.0).sub(smoothstep(0.75, 1.0, d))), 0.0);
    })();
    const part = haPart('HalcyonApexUpfall', geometry, material, 24);
    part.count = count;
    return part;
}

// ── Beads ───────────────────────────────────────────────────────────────────────

/** The stretch of lagoon the beads rise from (metres, in front of the viewer). */
export const BEAD_FIELD = Object.freeze({ halfWidth: 78, near: -5, far: -150 });

/** The fraction of the bead pool a chain of `lift` steps has woken (0..1). */
export function beadShare(lift) {
    const k = Math.max(0, Math.min(1, lift / LIFT_MAX));
    return k * (2 - k);
}

/**
 * @param {object} u
 * @param {number} count
 */
export function createBeads(u, count) {
    const geometry = haQuadGeometry(count, { aSeed: [seeds(count, 0xbead), 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = haFxMaterial('HalcyonApexBeads');
    // Nearer beads are woken first: the chain is seen to start at the viewer's feet.
    const order = seed.y.mul(seed.y);
    const k = clamp(u.lift.div(LIFT_MAX), 0.0, 1.0);
    const share = k.mul(float(2.0).sub(k));
    const awake = smoothstep(order, order.add(0.08), share.mul(1.08));
    const cycle = fract(seed.w.add(u.beadLift.mul(seed.z.mul(0.035).add(0.022)))).toVar();
    const ceiling = seed.z.mul(15.0).add(5.0).add(u.surge.mul(14.0));
    const zAt = mix(float(BEAD_FIELD.near), float(BEAD_FIELD.far), order);
    const x = seed.x.sub(0.5).mul(zAt.negate().mul(2.1).add(6.0)).clamp(-BEAD_FIELD.halfWidth * 2, BEAD_FIELD.halfWidth * 2);
    const z = zAt;
    const sway = sin(u.time.mul(0.7).add(seed.w.mul(30.0))).mul(0.25);
    const world = vec3(x.add(sway), cycle.mul(ceiling).add(0.04), z.add(sway.mul(0.6)));
    const metres = seed.w.mul(0.1).add(0.07);
    material.vertexNode = billboard(u, world, metres, 0.0016, 0.021, awake);
    const fade = smoothstep(0.0, 0.07, cycle).mul(float(1.0).sub(smoothstep(0.82, 1.0, cycle))).mul(awake).mul(u.breath);
    const vFade = varying(fade, 'haBeadF');
    const vWorld = varying(world, 'haBeadP');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d = length(q);
        const inside = float(1.0).sub(smoothstep(0.86, 1.0, d));
        // A drop is a lens: it holds the scene upside down, the sky at its foot.
        const V = normalize(vWorld.sub(cameraPosition));
        const bent = normalize(vec3(V.x.sub(q.x.mul(0.9)), q.y.mul(-1.0).add(0.2), V.z.sub(q.x.mul(0.2))));
        const lens = mix(u.shallow.mul(0.6), haSkyBase(u, vec3(bent.x, abs(bent.y), bent.z)), smoothstep(-0.3, 0.3, bent.y));
        const rim = smoothstep(0.55, 0.95, d).mul(inside);
        // The sun, caught twice: a spark on its side of the drop, a glow through the far side.
        const toSun = normalize(vec2(u.sunDir.x.mul(V.z.negate()).add(u.sunDir.z.mul(V.x)), u.sunDir.y.add(0.2)));
        const spark = exp(length(q.sub(toSun.mul(0.45))).pow(2.0).mul(-26.0));
        const glow = exp(length(q.add(toSun.mul(0.5))).pow(2.0).mul(-7.0)).mul(0.35);
        const alpha = inside.mul(0.3).add(rim.mul(0.22)).mul(vFade);
        const body = haAtmosphere(u, lens.mul(0.85).add(haSkyBase(u, vec3(0.0, 1.0, 0.0)).mul(rim).mul(0.9)), vWorld);
        const light = u.sun.mul(spark.mul(1.6).add(glow)).mul(u.sunLit).mul(inside).mul(vFade);
        return vec4(body.mul(alpha).add(light), alpha);
    })();
    const part = haPart('HalcyonApexBeads', geometry, material, 26);
    part.count = count;
    return part;
}

// ── Motes ───────────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {number} count
 */
export function createMotes(u, count) {
    const geometry = haQuadGeometry(count, { aSeed: [seeds(count, 0x707e), 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = haFxMaterial('HalcyonApexMotes');
    // A slow drift down the lagoon, wrapping inside a box in front of the viewer.
    const drift = u.cloudDrift.mul(0.08);
    const x = fract(seed.x.add(drift.mul(seed.w.mul(0.03).add(0.012)))).sub(0.5).mul(90.0);
    const y = fract(seed.y.add(u.beadLift.mul(0.004)).add(sin(u.time.mul(0.21).add(seed.z.mul(40.0))).mul(0.012))).mul(17.0).add(0.4);
    const z = fract(seed.z.sub(drift.mul(0.011))).mul(-72.0).sub(2.5);
    const world = vec3(x, y, z);
    material.vertexNode = billboard(u, world, seed.w.mul(0.03).add(0.02), 0.0011, 0.006, float(1.0));
    const V = normalize(world.sub(cameraPosition));
    const forward = max(dot(V, u.sunDir), 0.0);
    const f4 = forward.mul(forward).mul(forward).mul(forward);
    const glint = sin(u.time.mul(seed.w.mul(2.2).add(0.7)).add(seed.x.mul(60.0))).mul(0.5).add(0.5);
    const vLight = varying(u.sun.mul(f4.mul(f4).mul(0.55).add(0.012)).mul(glint.mul(0.8).add(0.2)).mul(u.breath), 'haMote');
    material.colorNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        return vec4(vLight.mul(exp(d.mul(d).mul(-4.0))), 0.0);
    })();
    const part = haPart('HalcyonApexMotes', geometry, material, 28, false);
    part.count = count;
    return part;
}

// ── The flock ───────────────────────────────────────────────────────────────────

/** Seconds the flock takes to settle after a four-line clear throws it up. */
export const SCATTER_LIFE = 5;

/**
 * @param {object} u
 * @param {number} count
 */
export function createBirds(u, count) {
    const rand = mulberry32(0xb12d);
    const aBird = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aBird.set([rand(), rand(), rand(), rand()], i * 4);
    const geometry = new THREE.InstancedBufferGeometry();
    // Two wings: root, trailing root, tip (the tip flaps).
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0.16, 0, 0, -0.2, -1, 0, -0.08,
        0, 0, -0.2, 0, 0, 0.16, 1, 0, -0.08,
    ], 3));
    geometry.setAttribute('aBird', new THREE.InstancedBufferAttribute(aBird, 4));
    geometry.instanceCount = count;
    const bird = attribute('aBird', 'vec4');
    const scatter = uniform(-100);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexBirds';
    material.fog = false;
    material.side = THREE.DoubleSide;
    // The flock rides a wide circle over the far lagoon; each bird keeps its own place in it.
    const since = u.time.sub(scatter);
    const thrown = exp(max(since, 0.0).mul(-1 / (SCATTER_LIFE * 0.4))).mul(step(0.0, since));
    const round = u.time.mul(0.045).add(bird.x.mul(0.5)).add(1.2);
    const centre = vec3(-30.0, 46.0, -330.0);
    const ring = bird.y.mul(46.0).add(96.0).add(thrown.mul(40.0));
    const flight = vec3(cos(round).mul(ring), bird.z.mul(26.0).add(sin(u.time.mul(0.3).add(bird.w.mul(20.0))).mul(2.5)).add(thrown.mul(34.0)), sin(round).mul(ring).mul(0.55));
    const heading = vec3(sin(round).negate(), 0.0, cos(round).mul(0.55));
    const fwd = normalize(heading);
    const side = normalize(vec3(fwd.z, 0.0, fwd.x.negate()));
    const flap = sin(u.time.mul(bird.w.mul(2.5).add(5.5).add(thrown.mul(6.0))).add(bird.x.mul(40.0)));
    const tip = abs(positionGeometry.x);
    const span = float(1.25);
    const local = side.mul(positionGeometry.x.mul(span).mul(float(1.0).sub(abs(flap).mul(0.18).mul(tip))))
        .add(fwd.mul(positionGeometry.z.mul(span)))
        .add(vec3(0.0, flap.mul(0.5).mul(tip).mul(span), 0.0));
    material.positionNode = centre.add(flight).add(local);
    material.colorNode = haAtmosphere(u, vec3(0.03, 0.045, 0.06).add(u.sun.mul(0.012)), centre.add(flight));
    const part = haPart('HalcyonApexBirds', geometry, material, -8);
    part.count = count;
    /** Throw the flock up at `time`. */
    part.scatter = (time) => {
        scatter.value = time;
    };
    part.reset = () => {
        scatter.value = -100;
    };
    return part;
}
