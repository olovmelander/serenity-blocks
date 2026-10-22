/**
 * Ocean — what drifts in the water, and what gameplay sets in flight.
 *
 * Every pool is always drawn; a dormant slot is a degenerate quad. Nothing is created at event
 * time: an event writes a few numbers (where, when, how) and the vertex shader places the quads
 * as a function of the clock, so any moment can be replayed.
 *
 *   pool    the motes every event is made of, five ways of moving:
 *             drift   thrown, slowed by the water, carried by the current
 *             home    eased along a line to a point: a lock's light sinking to the reef
 *             bubble  rising, wobbling, growing as they climb, gone at the surface; a ring of
 *                     them (a t-spin) widens as it climbs
 *             bead    rising slowly with the water's sway: the reef spawning
 *             puff    a soft cloud of sand thrown up where something lands
 *   motes   marine snow: specks hanging in the water, lit where a shaft crosses them; at night
 *           a share of them is plankton that glows when a current or the whale's song passes
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
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SURFACE, mulberry32, ocLean, ocLightPoint, ocLightRead, ocPart, ocSong, ocThrough,
} from './ocean-tsl.js';

/** The pool's ways of moving, as the number the shader reads. */
export const POOL_MODES = Object.freeze({
    drift: 0, home: 1, bubble: 2, bead: 3, puff: 4,
});

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
};

/** A quad of `size` metres at a view-space point, never smaller than about a pixel and a half. */
const billboard = (u, view, size) => {
    const dist = max(view.z.negate(), 0.3);
    const pixel = dist.mul(1.6).div(max(u.viewport.y, 1.0));
    const grown = max(size, pixel);
    const q = positionGeometry.xy.mul(grown);
    return {
        clip: cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0)),
        // A mote drawn larger than it is spreads its light thinner.
        thin: size.div(grown).mul(size.div(grown)),
    };
};

// ── The pool ────────────────────────────────────────────────────────────────────

/** Slots ahead of the pool's cursor a new mote looks through for one that is spent. */
const PROBE = 6;

/**
 * @param {object} u
 * @param {number} count
 */
export function createPool(u, count) {
    const n = Math.max(8, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const birth = new Float32Array(n * 4); // xyz, time
    const motion = new Float32Array(n * 4); // velocity xyz, life
    const look = new Float32Array(n * 4); // rgb, size
    const mode = new Float32Array(n * 4); // mode, ring radius, ring speed, angle
    for (let i = 0; i < n; i++) birth[i * 4 + 3] = -100;
    const aBirth = new THREE.InstancedBufferAttribute(birth, 4);
    const aMotion = new THREE.InstancedBufferAttribute(motion, 4);
    const aLook = new THREE.InstancedBufferAttribute(look, 4);
    const aMode = new THREE.InstancedBufferAttribute(mode, 4);
    [aBirth, aMotion, aLook, aMode].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aBirth', aBirth);
    geometry.setAttribute('aMotion', aMotion);
    geometry.setAttribute('aLook', aLook);
    geometry.setAttribute('aMode', aMode);
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('OceanPool');
    const nBirth = attribute('aBirth', 'vec4');
    const nMotion = attribute('aMotion', 'vec4');
    const nLook = attribute('aLook', 'vec4');
    const nMode = attribute('aMode', 'vec4');
    const vTint = varying(nLook.rgb, 'vPoolTint');
    const vKind = varying(nMode.x, 'vPoolKind');
    const vFade = varying(float(0.0), 'vPoolFade');
    const vSeen = varying(vec3(0.0), 'vPoolSeen');
    material.vertexNode = Fn(() => {
        const age = u.time.sub(nBirth.w).toVar();
        const life = max(nMotion.w, 0.05);
        const x = clamp(age.div(life), 0.0, 1.0).toVar();
        const kind = nMode.x;
        const isHome = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind)));
        const isBubble = step(1.5, kind).mul(float(1.0).sub(step(2.5, kind)));
        const isBead = step(2.5, kind).mul(float(1.0).sub(step(3.5, kind)));
        const isPuff = step(3.5, kind);
        const seed = fract(nBirth.x.mul(13.7).add(nBirth.y.mul(7.3)).add(nBirth.w.mul(3.1)).add(nMode.w.mul(0.37)));
        const v = nMotion.xyz;
        // Drifting: the throw dies in the water, and the current takes it.
        const carried = vec3(u.current.mul(age).mul(0.35), age.mul(-0.05), 0.0);
        const drifting = nBirth.xyz.add(v.mul(float(1.0).sub(exp(age.mul(-2.2))).div(2.2))).add(carried);
        // Sinking home: slow to leave, quick to arrive, on a line that bows.
        const ease = x.mul(x).mul(float(3.0).sub(x.mul(2.0)));
        const bow = sin(x.mul(Math.PI)).mul(0.45);
        const homing = nBirth.xyz.add(v.mul(life).mul(ease)).add(vec3(0.0, bow, 0.0));
        // A bubble: up, faster as it climbs, a wobble that grows; a ring of them widens.
        const ringR = nMode.y.add(nMode.z.mul(age));
        const ring = vec3(cos(nMode.w), 0.0, sin(nMode.w)).mul(ringR).mul(step(0.001, nMode.y));
        const wobble = vec3(sin(age.mul(9.0).add(seed.mul(40.0))), 0.0, cos(age.mul(7.3).add(seed.mul(23.0))))
            .mul(age.mul(0.02).add(0.03)).mul(float(1.0).sub(step(0.001, nMode.y)));
        const rising = nBirth.xyz
            .add(vec3(v.x, 0.0, v.z).mul(float(1.0).sub(exp(age.mul(-1.4))).div(1.4)))
            .add(vec3(0.0, v.y.mul(age).add(age.mul(age).mul(0.22)), 0.0))
            .add(wobble)
            .add(ring)
            .add(carried.mul(0.5));
        // A bead: up slowly, swaying with the water, drifting with it.
        const sway = vec3(sin(age.mul(0.7).add(seed.mul(20.0))), 0.0, cos(age.mul(0.53).add(seed.mul(11.0)))).mul(0.32)
            .mul(smoothstep(0.0, 2.0, age));
        const spawning = nBirth.xyz.add(v.mul(age)).add(sway).add(carried.mul(1.4));
        // A puff of sand: thrown out, then it hangs and settles.
        const puffing = nBirth.xyz.add(v.mul(float(1.0).sub(exp(age.mul(-1.8))).div(1.8)))
            .add(vec3(0.0, age.mul(age).mul(-0.03), 0.0));
        const p = drifting.toVar();
        p.assign(mix(p, homing, isHome));
        p.assign(mix(p, rising, isBubble));
        p.assign(mix(p, spawning, isBead));
        p.assign(mix(p, puffing, isPuff));
        // Nothing rises out of the sea.
        const under = step(p.y, SURFACE - 0.15);
        const live = step(0.0, age).mul(step(age, life)).mul(under);
        const fadeIn = smoothstep(0.0, mix(float(0.04), float(0.18), isBead.add(isPuff)), x);
        const fadeOut = float(1.0).sub(smoothstep(mix(float(0.6), float(0.45), isBead), 1.0, x));
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const grow = float(1.0).add(age.mul(0.1).mul(isBubble)).add(x.mul(1.6).mul(isPuff));
        const shape = billboard(u, view, nLook.w.mul(grow).mul(live));
        vFade.assign(live.mul(fadeIn).mul(fadeOut).mul(shape.thin));
        vSeen.assign(ocThrough(u, length(p.sub(cameraPosition))));
        return shape.clip;
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const edge = float(1.0).sub(smoothstep(0.92, 1.0, d));
        const isBubble = step(1.5, vKind).mul(float(1.0).sub(step(2.5, vKind)));
        const isPuff = step(3.5, vKind);
        // A glowing mote: a hot core and a soft halo.
        const glow = exp(d.mul(d).mul(-9.0)).mul(2.6).add(exp(d.mul(-4.0)).mul(0.22));
        // A bubble: a bright rim and a highlight, silver with a breath of the colour it carries.
        const rim = smoothstep(0.62, 0.9, d).mul(float(1.0).sub(smoothstep(0.9, 1.0, d)));
        const spot = exp(q.sub(vec2(-0.33, 0.36)).dot(q.sub(vec2(-0.33, 0.36))).mul(-28.0));
        const silver = u.shallow.mul(0.9).add(u.sun.mul(0.35)).add(vTint.mul(0.3));
        const bubble = silver.mul(rim.mul(1.2).add(0.05)).add(u.sun.mul(spot).mul(0.9));
        // Sand: a dim, soft cloud in the water's light.
        const puff = vTint.mul(u.ambient.add(u.sun.mul(0.25))).mul(exp(d.mul(d).mul(-2.6)).mul(0.11));
        const col = vTint.mul(glow).toVar();
        col.assign(mix(col, bubble, isBubble));
        col.assign(mix(col, puff, isPuff));
        return vec4(col.mul(edge).mul(vFade).mul(vSeen).mul(u.breath), 0.0);
    })();
    mesh.material = material;

    const part = ocPart('OceanPool', geometry, material, 70, { mesh });
    part.count = n;
    part.cursor = 0;
    let rand = mulberry32(8123);
    /**
     * Throw `n` motes from a point.
     * @param {object} e
     * @param {string} e.mode          drift | home | bubble | bead | puff
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
     * @param {number[]} [e.home]      with mode home: the world point they sink to
     * @param {number} [e.ring=0]      with mode bubble: start them on a ring of this radius...
     * @param {number} [e.ringSpeed=0] ...widening this fast (m/s)
     */
    part.emit = ({
        mode: kind = 'drift', at, n: amount, rgb, time, vel = [0, 0, 0], spread = 1, scatter = 0, life = [1.0, 2.2],
        size = 0.1, stagger = 0, home = null, ring = 0, ringSpeed = 0,
    }) => {
        const many = Math.max(0, Math.min(n, Math.round(amount)));
        const code = POOL_MODES[kind] ?? 0;
        for (let k = 0; k < many; k++) {
            // The next slot that is spent by the time this mote appears, or, if the few ahead are
            // all still alive, the one with the least life left: a quick lock's sparks never cut
            // short the reef's slow spawning (beads live for many seconds).
            let i = part.cursor % n;
            let skip = 0;
            let least = Infinity;
            for (let s = 0; s < PROBE; s++) {
                const j = (part.cursor + s) % n;
                const left = birth[j * 4 + 3] + motion[j * 4 + 3] - time;
                if (left <= 0) {
                    i = j;
                    skip = s;
                    break;
                }
                if (left < least) {
                    least = left;
                    i = j;
                    skip = s;
                }
            }
            part.cursor += skip + 1;
            const o = i * 4;
            const ox = at[0] + (rand() - 0.5) * 2 * scatter;
            const oy = at[1] + (rand() - 0.5) * 2 * scatter * (kind === 'bubble' ? 0.3 : 1);
            const oz = at[2] + (rand() - 0.5) * 2 * scatter;
            const lifetime = life[0] + (life[1] - life[0]) * rand();
            // A ring's bubbles start together; everything else may straggle.
            const start = time + (ring > 0 ? 0 : rand() * stagger);
            birth.set([ox, oy, oz, start], o);
            if (home) {
                const per = 1 / lifetime;
                motion.set([(home[0] - ox) * per, (home[1] - oy) * per, (home[2] - oz) * per, lifetime], o);
            } else {
                motion.set([
                    vel[0] + (rand() - 0.5) * 2 * spread,
                    vel[1] + (kind === 'bubble' || kind === 'bead' ? rand() * spread : (rand() - 0.5) * 2 * spread),
                    vel[2] + (rand() - 0.5) * 2 * spread,
                    lifetime,
                ], o);
            }
            mode.set([code, ring, ringSpeed, ring > 0 ? (k / many) * Math.PI * 2 : rand() * 6.283], o);
            const s = size * (0.6 + rand() * 0.8);
            const gain = kind === 'bubble' || kind === 'puff' ? 1 : 1.4 + rand() * 1.6;
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

// ── Marine snow ─────────────────────────────────────────────────────────────────

/** The box of water the motes fill (world): its least corner and its size. */
const SNOW_MIN = [-24, 0.4, -34];
const SNOW_SIZE = [48, 14, 46];

/**
 * @param {object} u
 * @param {number} count
 */
export function createMotes(u, count) {
    const n = Math.max(1, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 4); // where in the box (0..1)³, seed
    const rand = mulberry32(5501);
    for (let i = 0; i < n; i++) {
        // Thicker near the viewer: the far ones only add up to haze.
        const z = 1 - rand() ** 1.6;
        data.set([rand(), rand(), z, rand()], i * 4);
    }
    geometry.setAttribute('aMote', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('OceanMotes');
    const aMote = attribute('aMote', 'vec4');
    const vLight = varying(vec3(0.0), 'vMoteLight');
    material.vertexNode = Fn(() => {
        const seed = aMote.w;
        const t = u.drift;
        // The snow sinks, the current carries it, each speck wanders a little.
        const flow = vec3(u.current.mul(t).mul(0.22), t.mul(-0.045), t.mul(0.01));
        const wander = vec3(sin(t.mul(0.31).add(seed.mul(40.0))), sin(t.mul(0.23).add(seed.mul(17.0))), cos(t.mul(0.27).add(seed.mul(29.0))))
            .mul(0.35);
        const size = vec3(...SNOW_SIZE);
        const cell = fract(aMote.xyz.add(flow.add(wander).div(size)));
        const p = vec3(...SNOW_MIN).add(cell.mul(size)).toVar();
        // Faded where the box wraps, so nothing blinks in or out.
        const edge = smoothstep(0.0, 0.06, cell).mul(float(1.0).sub(smoothstep(0.94, 1.0, cell)));
        const keep = edge.x.mul(edge.y).mul(edge.z);
        // Lit where a shaft crosses it, dim elsewhere.
        const mask = ocLightRead(u, ocLightPoint(u, p)).g;
        const under = max(float(SURFACE).sub(p.y), 0.0);
        const lit = mask.mul(mask).mul(exp(under.mul(-0.08)));
        const day = u.spark.mul(lit.mul(1.6).add(0.07));
        // At night a share of them is plankton: it glows when the water moves round it.
        const plankton = step(0.55, seed);
        const stir = abs(ocLean(u, p.x.div(u.squeeze))).mul(1.4).add(ocSong(u, p).mul(2.5)).add(u.surge.mul(0.6));
        const twinkle = sin(u.time.mul(seed.mul(3.0).add(1.5)).add(seed.mul(60.0))).mul(0.5).add(0.5);
        const glow = u.glow.mul(u.night.mul(0.25).add(stir.mul(u.night.mul(0.7).add(0.3)))).mul(twinkle.mul(0.7).add(0.3))
            .mul(plankton)
            .mul(2.2);
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const shape = billboard(u, view, float(0.018).add(seed.mul(0.02)));
        vLight.assign(day.add(glow).mul(keep).mul(shape.thin).mul(ocThrough(u, length(p.sub(cameraPosition)))));
        return shape.clip;
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const shape = exp(d.mul(d).mul(-7.0)).mul(float(1.0).sub(smoothstep(0.85, 1.0, d)));
        return vec4(vLight.mul(shape).mul(u.breath), 0.0);
    })();
    mesh.material = material;
    const part = ocPart('OceanMotes', geometry, material, 68, { mesh });
    part.count = n;
    return part;
}

/** The water just in front of the eye (rest eye at z = 10, looking along −z and a little up). */
const NEAR_MIN = [-5, 0.3, 3.0];
const NEAR_SIZE = [10, 7, 6.7];
/** Where the eye is focused (metres) and how wide its lens is open (radians of blur per dioptre). */
const NEAR_FOCUS = 9;
const NEAR_APERTURE = 0.012;
/** A speck's light in a shaft (times the shaft and the forward scatter), and in the plain water. */
const NEAR_SHAFT = 14;
const NEAR_BASE = 0.3;

/**
 * The specks right in front of the eye: sharp where a shaft crosses them a few metres out, and
 * nearer than that out of focus, soft discs with a brighter rim, as a lens sees them. A disc keeps
 * only a share of a point's light, so the discs are faint and the points bright.
 * @param {object} u
 * @param {number} count
 */
export function createNearMotes(u, count) {
    const n = Math.max(1, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 4); // where in the box (0..1)³, seed
    const rand = mulberry32(7717);
    for (let i = 0; i < n; i++) {
        data.set([rand(), rand(), rand(), rand()], i * 4);
    }
    geometry.setAttribute('aMote', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('OceanNearMotes');
    const aMote = attribute('aMote', 'vec4');
    const vLight = varying(vec3(0.0), 'vNearLight');
    /** 0 for a point in focus, 1 for a wide disc: how much of a lens's ring it shows. */
    const vBlur = varying(float(0.0), 'vNearBlur');
    material.vertexNode = Fn(() => {
        const seed = aMote.w;
        const t = u.drift;
        // Carried by the current, sinking slowly, each wandering a hand's breadth.
        const flow = vec3(u.current.mul(t).mul(0.12), t.mul(-0.022), t.mul(0.006));
        const wander = vec3(
            sin(t.mul(0.21).add(seed.mul(40.0))),
            sin(t.mul(0.17).add(seed.mul(17.0))),
            cos(t.mul(0.19).add(seed.mul(29.0))),
        ).mul(0.12);
        const size = vec3(...NEAR_SIZE);
        const cell = fract(aMote.xyz.add(flow.add(wander).div(size)));
        const p = vec3(...NEAR_MIN).add(cell.mul(size)).toVar();
        const edge = smoothstep(0.0, 0.08, cell).mul(float(1.0).sub(smoothstep(0.92, 1.0, cell)));
        const keep = edge.x.mul(edge.y).mul(edge.z);
        const view = cameraViewMatrix.mul(vec4(p, 1.0)).toVar();
        const dist = max(view.z.negate(), 0.25).toVar();
        // The speck's own size (a few millimetres), the lens's blur at its distance, and never
        // under a pixel and a half.
        const pixel = float(1.1).div(max(u.viewport.y, 1.0));
        const own = float(0.002).add(seed.mul(0.004)).div(dist);
        const blur = float(NEAR_APERTURE).mul(abs(float(1.0).div(dist).sub(1 / NEAR_FOCUS)));
        const drawn = max(max(own, blur), pixel.mul(1.5)).toVar();
        // A disc keeps a share of a point's light (a lens's blur leaves a soft disc you can see,
        // it does not spread it to nothing); the larger, the fainter.
        const thin = pow(clamp(pixel.mul(2.0).div(drawn), 0.1, 1.0), 0.7);
        vBlur.assign(smoothstep(pixel.mul(3.0), pixel.mul(9.0), blur));
        // Lit where a shaft crosses it, and brightest seen against the light (it scatters forward).
        const mask = ocLightRead(u, ocLightPoint(u, p)).g;
        const under = max(float(SURFACE).sub(p.y), 0.0);
        const lit = mask.mul(mask).mul(exp(under.mul(-0.08)));
        const toward = clamp(normalize(p.sub(cameraPosition)).dot(u.sunDir), 0.0, 1.0);
        const t2 = toward.mul(toward);
        const phase = t2.mul(t2).mul(1.8).add(0.3);
        const day = u.spark.mul(lit.mul(phase).mul(NEAR_SHAFT).add(NEAR_BASE));
        // At night some of them are plankton, a faint green-blue light of their own.
        const twinkle = sin(u.time.mul(seed.mul(2.0).add(1.1)).add(seed.mul(70.0))).mul(0.5).add(0.5);
        const glow = u.glow.mul(u.night).mul(step(0.6, seed)).mul(twinkle.mul(0.6).add(0.4)).mul(5.0);
        vLight.assign(day.add(glow).mul(keep).mul(thin).mul(ocThrough(u, dist)));
        const q = positionGeometry.xy.mul(drawn.mul(dist).mul(2.0));
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0)).toVar();
        // A point is a soft spot; a disc is flat with a lit rim and a clean edge.
        const spot = exp(d.mul(d).mul(-5.0)).mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
        const rim = smoothstep(0.55, 0.95, d).mul(0.5).add(0.62);
        const disc = float(1.0).sub(smoothstep(0.84, 1.0, d)).mul(rim).mul(0.62);
        return vec4(vLight.mul(mix(spot, disc, vBlur)).mul(u.breath), 0.0);
    })();
    mesh.material = material;
    const part = ocPart('OceanNearMotes', geometry, material, 69, { mesh });
    part.count = n;
    return part;
}
