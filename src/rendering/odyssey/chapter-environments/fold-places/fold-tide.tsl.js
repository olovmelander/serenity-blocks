/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE TIDE — the fold's first place (orbs 49 and 50: Fluid Dreams, Nebula Flow).
 *
 * An ocean of liquid colour hangs overhead; below lies a black mirror; between them a horizon
 * with one low light on it, and thin threads of light standing from the mirror up into the tide.
 *
 * Met exactly. A ray that rises meets the ocean; one that falls meets the mirror and goes on up
 * to the ocean from there, so the mirror's image is the same lookup at a longer path. A thread is
 * a point in plan: the ray passes it at a distance that is one cross product.
 */
import {
    abs, clamp, dot, exp, float, floor, max, mix, sin, smoothstep, sqrt, step, vec2, vec3,
} from 'three/tsl';
import {
    N, frameRows, gauss, glowAt, sq, turn,
} from './fold-tools.tsl.js';

export const TIDE = Object.freeze({
    frame: [-13, 7, -5],
    ceiling: 2.3,
    floor: 1.25,
    scale: 0.15,
    fog: 0.034,
    /** The low light on the horizon: its direction in the room (unit after normalising). */
    sun: [0.50, 0.035, 1.0],
    /** The threads: two rows a side, this far out (`near`, `far`), this far apart along the way. */
    threads: Object.freeze({
        near: 7.5, far: 17, apart: 24, core: 0.012, glowK: 220000,
    }),
});

const ROWS = frameRows(TIDE.frame);

export function placeTide({
    rd, tm, zEye, pix, mood, event, eventAge,
}) {
    const V = TIDE;
    const r = turn(rd, ROWS).toVar();
    const up = r.y.toVar();
    const ay = max(abs(up), 0.004).toVar();
    const below = float(1).sub(step(0.0, up)).toVar();
    const path = mix(float(V.ceiling), float(V.ceiling + (2 * V.floor)), below).div(ay).toVar();
    // The mirror is not quite still: its image of the ocean shivers.
    const shiver = N(vec3(r.x.div(ay).mul(1.1), r.z.div(ay).mul(1.1).add(zEye.mul(0.5)), tm.mul(0.13)))
        .sub(0.5).mul(below).mul(0.5);
    const P = vec2(r.x.mul(path).add(shiver), r.z.mul(path).add(zEye)).toVar();
    const flow = tm.mul(0.021).toVar();
    const s = P.mul(V.scale).toVar();
    const wa = N(vec3(s.x, s.y, flow)).toVar();
    const wb = N(vec3(s.x.add(5.2), s.y.add(1.3), flow.add(7.0))).toVar();
    const sw = s.add(vec2(wa, wb).sub(0.5).mul(2.4)).toVar();
    const n1 = N(vec3(sw.x.mul(1.7), sw.y.mul(1.7).sub(flow.mul(1.6)), flow.mul(1.3).add(3.0))).toVar();
    // The pixel's footprint on the ocean, in the fine web's own cells: the web fades to its mean
    // where a cell is under a couple of pixels (toward the horizon).
    const foot = path.mul(pix).div(ay).mul(V.scale * 4.3);
    const fine = float(1).sub(smoothstep(0.18, 0.7, foot)).toVar();
    const n2 = N(vec3(sw.x.mul(4.3), sw.y.mul(4.3).add(flow.mul(2.0)), flow.mul(2.1).add(9.0))).toVar();
    // Light caught in the liquid: a web of bright seams where the fields cross their middles.
    const seam1 = float(1).sub(abs(n1.mul(2).sub(1))).toVar();
    const seam2 = float(1).sub(abs(n2.mul(2).sub(1))).toVar();
    const web = sq(sq(sq(seam1))).mul(0.85).add(sq(sq(sq(seam2))).mul(fine).mul(0.5)).toVar();
    // Long swells crossing it, and the rare great one (the room's happening) coming in from far off.
    const swell = sin(P.y.mul(0.33).add(wa.mul(5.0)).sub(tm.mul(0.21))).mul(0.5).add(0.5).toVar();
    const crestAt = float(46).sub(eventAge.mul(5.2));
    const crest = gauss(P.y.sub(zEye).sub(crestAt).add(wa.mul(6.0)).div(1.6)).mul(event).toVar();
    // The seams' light: aqua to orchid, and nothing between that could go olive (a soap film's
    // whole wheel put a muddy green-gold over the ocean on some turns of the mood).
    const tone = smoothstep(0.25, 0.75, wa.mul(0.6).add(n1.mul(0.4)).add(mood.x.sub(0.5).mul(0.3)));
    const seamCol = mix(vec3(0.16, 0.95, 0.90), vec3(0.95, 0.36, 0.95), tone);
    const warmth = smoothstep(0.35, 0.7, wb.add(mood.y.mul(0.2)).sub(0.1)).toVar();
    const deep = mix(vec3(0.004, 0.020, 0.036), vec3(0.020, 0.007, 0.060), warmth);
    const lit = mix(vec3(0.008, 0.150, 0.170), vec3(0.130, 0.070, 0.330), warmth);
    const ocean = deep
        .add(lit.mul(swell.mul(0.7).add(0.12)).mul(smoothstep(0.25, 0.8, n1)))
        // (The swell lights the seams it passes under and lifts the water a little: laid on as
        // flat colour it was a pale veil over a third of the frame.)
        .add(seamCol.mul(web).mul(crest.mul(2.6).add(1.0)).mul(0.30))
        .add(lit.mul(crest).mul(0.9))
        .toVar();
    // The low light and the horizon it sits on.
    const sunLen = Math.hypot(...V.sun);
    const sunDir = vec3(V.sun[0] / sunLen, V.sun[1] / sunLen, V.sun[2] / sunLen);
    const toSun = clamp(dot(r, sunDir), 0.0, 1.0).toVar();
    const sunward = sq(sq(toSun)).toVar();
    const horizonCol = mix(vec3(0.13, 0.035, 0.22), vec3(1.0, 0.50, 0.30), sq(sunward)).toVar();
    const fog = exp(path.mul(-V.fog)).toVar();
    // The mirror keeps a third of the light and cools it.
    const kept = mix(vec3(1, 1, 1), vec3(0.26, 0.33, 0.46), below).toVar();
    const band = exp(ay.mul(-17.0)).mul(sq(sunward).mul(0.9).add(0.1));
    const disc = exp(toSun.sub(1).mul(3200.0)).mul(2.4).add(exp(toSun.sub(1).mul(110.0)).mul(0.16))
        .mul(float(1).sub(below.mul(0.8)));
    // Its road on the mirror: rows of glitter under it, the rows closing up toward the horizon.
    const span = float(V.floor).div(ay).toVar();
    const fx = r.x.mul(span);
    const fz = r.z.mul(span).add(zEye);
    const across = r.x.div(max(r.z, 0.05)).sub(V.sun[0] / V.sun[2]);
    const ripple = N(vec3(fx.mul(4.5), fz.mul(21.0).sub(tm.mul(0.9)), tm.mul(0.21)));
    const calm = float(1).sub(smoothstep(0.12, 0.5, span.mul(pix).div(ay).mul(21.0)));
    const road = gauss(across.mul(9.0).div(ay.mul(2.6).add(0.3)))
        .mul(mix(float(0.42), smoothstep(0.5, 0.8, ripple), calm))
        .mul(below).mul(exp(ay.mul(-2.4)))
        .mul(0.5);
    // ── the threads: light standing from the mirror into the tide ──
    const T = V.threads;
    const plan = max(sqrt(max(float(1).sub(up.mul(up)), 0.0)), 1e-3).toVar();
    const dxp = r.x.div(plan).toVar();
    const dzp = r.z.div(plan).toVar();
    const side = step(0.0, dxp).mul(2).sub(1).toVar();
    const thread = (out, shift) => {
        const run = float(out).div(max(abs(dxp), 1e-3));
        const zAt = dzp.mul(run).add(zEye);
        const zc = floor(zAt.div(T.apart).add(shift)).add(0.5).sub(shift).mul(T.apart);
        // The ray's distance from the thread in plan, and how far along the ray that is.
        const off = abs(side.mul(out).mul(dzp).sub(zc.sub(zEye).mul(dxp)));
        const along = side.mul(out).mul(dxp).add(zc.sub(zEye).mul(dzp));
        const reach = max(along, 0.5).div(plan);
        // Only a thread ahead of the eye, and nearer than the ocean or the mirror the ray meets.
        const there = step(reach, path).mul(step(0.5, along));
        const rise = sin(up.div(plan).mul(reach).mul(1.7).sub(tm.mul(0.9))
            .add(zc.mul(0.37))).mul(0.3).add(0.7);
        // (A thread close by is faint: it would cut the frame with a bar of light.)
        return glowAt(off.sub(T.core), reach, T.glowK).mul(there).mul(exp(reach.mul(-V.fog * 1.1))).mul(rise)
            .mul(smoothstep(6.0, 16.0, reach).mul(0.75).add(0.25));
    };
    const threads = thread(T.near, 0.0).add(thread(T.far, 0.5).mul(0.8)).toVar();
    return ocean.mul(fog).mul(kept)
        .add(horizonCol.mul(float(1).sub(fog)).mul(kept).mul(0.10))
        .add(horizonCol.mul(band).mul(0.38))
        .add(vec3(1.0, 0.80, 0.60).mul(disc.add(road)))
        .add(mix(vec3(0.45, 1.0, 0.92), vec3(0.85, 0.72, 1.0), mood.z).mul(threads)
            .mul(kept.mul(0.6).add(0.4)).mul(0.75));
}
