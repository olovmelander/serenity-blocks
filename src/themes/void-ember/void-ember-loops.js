/**
 * Void Ember — flare loops: the star's prominences, and what the board hangs on it.
 *
 * A loop is an arcade of three strands of plasma standing on the photosphere: real ribbons in
 * the star's own frame, so one on the limb is an arch in profile, one on the face a bright
 * filament, and one that the star has carried round is hidden behind it. Every piece that lands
 * raises one where it struck, burning in that piece's colour; the star holds it for a while as
 * the colour burns off into its own fire. A clear tears the held loops off the star: each one
 * swells, snaps its feet and flies out into the dark as an expanding arc.
 *
 * Everything a strand does is a closed form of the clock and four per-instance vectors written
 * when its loop is raised or torn off: nothing is created at event time, and dormant slots
 * collapse to zero size.
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
    cross,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
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
    ERUPT_LIFE, LOOP_HOLD, LOOP_LIFE, LOOP_RISE, LOOP_SEGMENTS, LOOP_SLOTS, TAU,
    loopHeld, veBlackbody, veFxMaterial, vePart,
} from './void-ember-tsl.js';

/** Strands in one loop's arcade. */
export const LOOP_STRANDS = 3;
/** How each strand differs from the loop it belongs to. */
const STRANDS = Object.freeze([
    {
        span: 1, height: 1, turn: 0, aside: 0.02, lean: 0.06, gain: 1, width: 1,
    },
    {
        span: 0.9, height: 0.88, turn: 0.1, aside: 0.045, lean: 0.14, gain: 0.8, width: 0.8,
    },
    {
        span: 1.1, height: 1.1, turn: 0.07, aside: 0.04, lean: 0.12, gain: 0.6, width: 0.7,
    },
]);
/** An erupting loop's apex leaves at this many radii per second, and keeps gaining. */
const ERUPT_SPEED = 1.5;
const ERUPT_GAIN = 1.6;
const NEVER = 1e6;
/** Seconds ahead of its lift-off that a loop already belongs to the wave that will take it. */
const PROMISED = 1.5;
/** Seconds a newly risen loop is safe from being replaced by the next landing. */
const FRESH = 2;

/** Height (radii) of an erupting loop's apex above where it stood, `tau` seconds in. CPU twin. */
export function eruptLift(tau) {
    const t = Math.max(0, tau);
    return t * ERUPT_SPEED + t * t * ERUPT_GAIN;
}

/** @param {object} u shared uniforms */
export function createLoops(u) {
    const count = LOOP_SLOTS * LOOP_STRANDS;
    const aSite = new Float32Array(count * 4);
    const aTan = new Float32Array(count * 4);
    const aShape = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aSite.set([0, 1, 0, 0], i * 4);
        aTan.set([1, 0, 0, 0], i * 4);
        aShape.set([0.1, 0.1, -1000, NEVER], i * 4);
    }

    const strip = new THREE.PlaneGeometry(1, 1, LOOP_SEGMENTS, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(strip.getIndex());
    geometry.setAttribute('position', strip.getAttribute('position'));
    geometry.setAttribute('uv', strip.getAttribute('uv'));
    const attrs = {
        aSite, aTan, aShape, aTint,
    };
    Object.keys(attrs).forEach((name) => {
        const attr = new THREE.InstancedBufferAttribute(attrs[name], 4);
        attr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute(name, attr);
    });
    geometry.instanceCount = count;

    const site = attribute('aSite', 'vec4');
    const tan = attribute('aTan', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = veFxMaterial('VoidEmberLoops');
    material.side = THREE.DoubleSide;

    // ── Where the strand stands ──
    const s = positionGeometry.x.add(0.5);
    const across = positionGeometry.y.mul(2.0);
    const seed = site.w;
    const n = u.starRot.mul(site.xyz);
    const t1 = u.starRot.mul(tan.xyz);
    const t2 = cross(n, t1);
    const age = u.time.sub(shape.z);
    const eru = max(u.time.sub(shape.w), 0.0);
    const torn = step(shape.w, u.time);
    // It rises fast, overshoots a little, and settles; then sinks as its light goes.
    const up = clamp(age.div(LOOP_RISE), 0.0, 1.0);
    const rise = up.mul(up).mul(float(3.0).sub(up.mul(2.0))).mul(float(1.0).add(sin(up.mul(Math.PI)).mul(0.16)));
    const held = exp(max(age, 0.0).div(-LOOP_HOLD))
        .mul(float(1.0).sub(smoothstep(LOOP_LIFE - 8, LOOP_LIFE, age)))
        .mul(step(0.0, age));
    const breathe = sin(u.time.mul(0.7).add(seed.mul(TAU))).mul(0.05).add(1.0);
    const lift = eru.mul(ERUPT_SPEED).add(eru.mul(eru).mul(ERUPT_GAIN)).mul(torn);
    const apex = shape.y.mul(rise).mul(held.mul(0.45).add(0.55)).mul(breathe).add(lift);
    const reach = shape.x.mul(lift.mul(0.55).add(1.0));
    const phi = s.mul(Math.PI);
    const sp = sin(phi);
    const cp = cos(phi);
    // A semi-ellipse on two feet, fuller at the shoulders than a sine.
    const arch = sp.mul(sp.mul(0.25).add(0.75));
    const dArch = cp.mul(sp.mul(0.5).add(0.75));
    const sway = sin(s.mul(TAU).add(seed.mul(17.0)).add(u.time.mul(0.45))).mul(0.055);
    const lean = tan.w;
    const local = n.mul(arch.mul(apex).add(0.985))
        .add(t1.mul(cp.negate().mul(reach)))
        .add(t2.mul(arch.mul(apex).mul(lean.add(sway))));
    const along = n.mul(dArch.mul(apex)).add(t1.mul(sp.mul(reach))).add(t2.mul(dArch.mul(apex).mul(lean)));
    const world = u.centre.add(local.mul(u.radius));
    const toCamera = normalize(cameraPosition.sub(world));
    const across3 = cross(normalize(along.add(vec3(1e-5, 0.0, 0.0))), toCamera);
    // Where the strand runs straight at the camera its ribbon has no width to show: let it
    // close there instead of flipping over.
    const facing = length(across3);
    const sideways = across3.div(max(facing, 1e-4));
    // Thin at the feet, full at the apex; an erupting one spreads as it leaves.
    const alive = step(0.001, tint.w).mul(step(0.0, age)).mul(step(eru, ERUPT_LIFE));
    const width = u.radius.mul(tint.w.mul(0.05).add(0.06)).mul(sp.mul(0.7).add(0.3))
        .mul(lift.mul(0.12).add(1.0))
        .mul(smoothstep(0.0, 0.35, facing))
        .mul(alive);
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world.add(sideways.mul(across.mul(width))), 1.0));
    material.vertexNode = clip;

    // ── Its light ──
    const leaving = exp(eru.mul(-3.2)).mul(3.0).add(1.0)
        .mul(exp(eru.div(-0.5)))
        .mul(float(1.0).sub(smoothstep(ERUPT_LIFE - 0.8, ERUPT_LIFE, eru)))
        // It thins as it spreads: an arc that has left the star does not hang over the frame.
        .div(lift.mul(0.55).add(1.0).mul(lift.mul(0.55).add(1.0)));
    const gain = tint.w.mul(held.mul(0.85).add(0.2)).mul(smoothstep(0.0, 0.25, up))
        .mul(exp(max(age, 0.0).div(-0.5)).mul(1.6).add(1.0))
        .mul(mix(float(1.0), leaving, torn))
        .mul(alive);
    // The element burns off: the loop cools from the piece's colour into the star's own fire.
    const own = veBlackbody(u.heat.add(0.22));
    const burnt = clamp(float(1.0).sub(held.mul(1.15)), 0.0, 1.0).mul(float(1.0).sub(torn));
    const vLight = varying(mix(tint.rgb, own, burnt.mul(0.85)).mul(gain), 'veLoopLight');
    const vSeed = varying(vec2(seed, lift), 'veLoopSeed');
    material.colorNode = Fn(() => {
        const st = uv();
        // Across the ribbon, −1..1 (clamped: with MSAA a varying is extrapolated off a thin strip).
        const y = clamp(st.y.sub(0.5).mul(2.0), -1.0, 1.0).toVar();
        const leg = clamp(abs(st.x.sub(0.5)).mul(2.0), 0.0, 1.0).toVar();
        // Two threads of plasma wander across the ribbon as they run along it, and knots of it
        // rain down both legs from the apex to the feet.
        const flow = u.fbmLod(vec2(
            leg.mul(0.5).sub(u.time.mul(0.05)).add(vSeed.x.mul(3.7)),
            vSeed.x.mul(11.3),
        ), 3.0).toVar();
        const weave = u.fbmLod(vec2(st.x.mul(0.7).add(vSeed.x.mul(7.1)), vSeed.x.mul(5.3).add(u.time.mul(0.012))), 5.0).toVar();
        // A blurred mip: the slow octaves wander, the fast ones would saw the threads.
        const d1 = y.sub(weave.r.sub(0.5).mul(3.2));
        const d2 = y.add(weave.g.sub(0.5).mul(3.4));
        const threads = exp(d1.mul(d1).mul(-42.0)).add(exp(d2.mul(d2).mul(-70.0)).mul(0.7));
        const sheath = exp(y.mul(y).mul(-3.2)).mul(0.2);
        // The ribbon's own edge is soft, whatever the threads do.
        const inside = float(1.0).sub(y.mul(y));
        const knots = smoothstep(0.3, 0.7, flow.r).mul(0.5).add(0.7);
        const feet = leg.mul(leg).mul(1.2).add(1.0);
        const peak = max(vLight.x, max(vLight.y, vLight.z));
        const hot = mix(vLight, vec3(1.0, 0.9, 0.74).mul(peak), min(threads, 1.0).mul(0.12));
        return vec4(hot.mul(threads.mul(knots).add(sheath)).mul(inside.mul(inside)).mul(feet).mul(u.breath)
            .mul(u.iris), 0.0);
    })();

    const part = vePart('VoidEmberLoops', geometry, material, 20);

    // ── The store (CPU) ──
    const slots = Array.from({ length: LOOP_SLOTS }, () => ({
        birth: -1000, erupt: NEVER, strength: 0, site: [0, 1, 0], rgb: [1, 0.4, 0.1], height: 0.2,
    }));
    const touch = () => {
        Object.keys(attrs).forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
    };
    const tangentFor = (dir, azimuth, out) => {
        // Any vector not along `dir`, made square to it, then turned by the azimuth.
        const ax = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let e1 = [
            ax[1] * dir[2] - ax[2] * dir[1], ax[2] * dir[0] - ax[0] * dir[2], ax[0] * dir[1] - ax[1] * dir[0],
        ];
        const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1;
        e1 = e1.map((v) => v / l1);
        const e2 = [
            dir[1] * e1[2] - dir[2] * e1[1], dir[2] * e1[0] - dir[0] * e1[2], dir[0] * e1[1] - dir[1] * e1[0],
        ];
        const c = Math.cos(azimuth);
        const sn = Math.sin(azimuth);
        for (let k = 0; k < 3; k++) out[k] = e1[k] * c + e2[k] * sn;
        return { e2: [e2[0] * c - e1[0] * sn, e2[1] * c - e1[1] * sn, e2[2] * c - e1[2] * sn] };
    };
    const tangent = [1, 0, 0];

    /**
     * Raise a loop in `slot` at `site` (a unit vector in the star's frame). `azimuth` turns its
     * plane round the site, `span` is half the distance between its feet and `height` its apex,
     * both in radii.
     */
    part.raise = (slot, {
        site: dir, azimuth = 0, span = 0.16, height = 0.3, rgb, time, strength = 1, seed: salt = 0,
    }) => {
        const entry = slots[slot];
        if (!entry) return;
        entry.birth = time;
        entry.erupt = NEVER;
        entry.strength = strength;
        entry.site = [dir[0], dir[1], dir[2]];
        entry.rgb = [rgb[0], rgb[1], rgb[2]];
        entry.height = height;
        for (let j = 0; j < LOOP_STRANDS; j++) {
            const i = slot * LOOP_STRANDS + j;
            const sd = ((slot * 7 + j * 31 + salt * 13) % 97) / 97;
            const sd2 = ((slot * 19 + j * 47 + salt * 5) % 89) / 89;
            // Field lines of one active region: each stands on its own feet, turned and leaning
            // its own way — a tangle, not a ribcage.
            const strand = STRANDS[j];
            const { e2 } = tangentFor(dir, azimuth + strand.turn * (sd < 0.5 ? 1 : -1) + (sd2 - 0.5) * 0.5, tangent);
            const off = strand.aside * (sd2 - 0.5) * 2;
            const fwd = strand.aside * (sd - 0.5);
            const px = dir[0] + e2[0] * off + tangent[0] * fwd;
            const py = dir[1] + e2[1] * off + tangent[1] * fwd;
            const pz = dir[2] + e2[2] * off + tangent[2] * fwd;
            const pl = Math.hypot(px, py, pz) || 1;
            aSite.set([px / pl, py / pl, pz / pl, sd], i * 4);
            aTan.set([tangent[0], tangent[1], tangent[2], strand.lean * (sd2 < 0.5 ? 1 : -1) + (sd - 0.5) * 0.2], i * 4);
            aShape.set([
                span * strand.span * (0.85 + sd2 * 0.3), height * strand.height * (0.85 + sd * 0.3), time + j * 0.07, NEVER,
            ], i * 4);
            aTint.set([rgb[0] * strand.gain, rgb[1] * strand.gain, rgb[2] * strand.gain, strength * strand.width], i * 4);
        }
        touch();
    };

    /** Tear loop `slot` off the star at `time`. Returns false if it holds nothing. */
    part.erupt = (slot, time) => {
        const entry = slots[slot];
        // Already leaving (or due to leave before then): nothing more to tear off.
        if (!entry || entry.erupt <= time || entry.strength <= 0) return false;
        if (loopHeld(time - entry.birth) < 0.02 && time - entry.birth > LOOP_RISE) return false;
        entry.erupt = time;
        for (let j = 0; j < LOOP_STRANDS; j++) aShape[(slot * LOOP_STRANDS + j) * 4 + 3] = time + j * 0.04;
        geometry.getAttribute('aShape').needsUpdate = true;
        return true;
    };

    /** How much of its light loop `slot` still holds at `time` (0 once it has been torn off). */
    part.held = (slot, time) => {
        const entry = slots[slot];
        if (!entry || entry.strength <= 0 || entry.erupt <= time) return 0;
        return loopHeld(time - entry.birth) * entry.strength;
    };
    part.slot = (slot) => slots[slot];
    /** The slot whose loop holds the least light: where the next lock's loop goes. */
    part.weakest = (first, last, time) => {
        let best = first;
        let least = Infinity;
        for (let i = first; i < last; i++) {
            // A loop not yet risen is not free. One that is leaving counts for the light it
            // still shows, so after a clear of the whole star the oldest arc gives way first.
            const entry = slots[i];
            let h = part.held(i, time);
            const gone = time - entry.erupt;
            if (gone >= 0 && gone < ERUPT_LIFE) h = 0.95 * Math.exp(-gone / 0.6);
            else if (entry.strength > 0 && time < entry.birth) h = 3;
            // Promised to a wave that is about to take it: it should still fly.
            else if (entry.strength > 0 && gone < 0 && gone > -PROMISED) h = 2.5;
            // Just risen: the last thing to replace (a hard drop's three must all stand).
            else if (entry.strength > 0 && time - entry.birth < FRESH) h = 2.8;
            if (h < least) {
                least = h;
                best = i;
            }
        }
        return best;
    };
    part.litCount = (time, first = 0, last = LOOP_SLOTS) => {
        let lit = 0;
        for (let i = first; i < last; i++) if (part.held(i, time) > 0.05) lit += 1;
        return lit;
    };
    part.totalHeld = (time, first = 0, last = LOOP_SLOTS) => {
        let sum = 0;
        for (let i = first; i < last; i++) sum += part.held(i, time);
        return sum;
    };
    part.reset = () => {
        for (let i = 0; i < LOOP_SLOTS; i++) {
            slots[i].birth = -1000;
            slots[i].erupt = NEVER;
            slots[i].strength = 0;
        }
        for (let i = 0; i < count; i++) {
            aShape[i * 4 + 2] = -1000;
            aShape[i * 4 + 3] = NEVER;
            aTint[i * 4 + 3] = 0;
        }
        touch();
    };
    part.count = LOOP_SLOTS;
    return part;
}

/** The minimum of two loops' worth of spark budget, kept here so the world and tests agree. */
export const loopSparkShare = (pool, loops) => Math.max(3, Math.min(28, Math.floor((pool * 0.45) / Math.max(1, loops))));
