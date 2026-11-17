/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE FLOCK — the fold's fourth place (orb 53: Murmuration).
 *
 * Veils of motes of light wheeling over a dusk horizon and its still water: thousands of them,
 * lit only where the flock is, in thin sheets that drape and fold as starlings fly.
 *
 * Walked layer by layer: planes across the way ahead, a scattering of motes on each, met where
 * the ray crosses the plane, so every mote stands at one place in the room and is counted once.
 */
import {
    Loop, abs, clamp, dot, exp, float, floor, int, length, max, mix, normalize, sin, smoothstep, step, vec2, vec3,
} from 'three/tsl';
import { hash21 } from '../shared/odyssey-tsl-noise.js';
import {
    N, TAU, frameRows, gauss, glowAt, sq, turn,
} from './fold-tools.tsl.js';

export const FLOCK = Object.freeze({
    frame: [9, -15, -3],
    /** The planes' spacing along the way, and the motes' grid on each. */
    layer: 0.95,
    cell: 0.6,
    mote: 0.014,
    glowK: 300000,
    fog: 0.05,
    /** How thick a veil is, in the slow field's own units. */
    veil: 0.11,
});

const ROWS = frameRows(FLOCK.frame);

export function placeFlock({
    rd, tm, zEye, mood, event, eventAge, steps,
}) {
    const V = FLOCK;
    const r = turn(rd, ROWS).toVar();
    const fz = max(r.z, 0.08).toVar();
    const slope = r.xy.div(fz).toVar();
    const along = float(1).div(fz).toVar();
    const acc = vec3(0).toVar();
    const base = floor(zEye.div(V.layer)).toVar();
    const off = zEye.div(V.layer).sub(base).toVar();
    const drift = vec3(tm.mul(0.013), tm.mul(-0.006), tm.mul(0.021)).toVar();
    const lean = mood.x.sub(0.5).mul(0.08).toVar();
    // The happening: the whole flock turns, a wave of light running through it.
    const turnAt = float(30).sub(eventAge.mul(3.4)).toVar();
    Loop({
        start: int(0), end: int(steps), type: 'int', condition: '<', name: 'flockLayer',
    }, ({ flockLayer }) => {
        const zk = float(flockLayer).add(1).sub(off).mul(V.layer)
            .toVar();
        const layerId = base.add(float(flockLayer)).add(1).toVar();
        const hit = slope.mul(zk).toVar();
        const cell = floor(hit.div(V.cell).add(0.5)).toVar();
        const seed = cell.add(vec2(layerId.mul(17.0), layerId.mul(31.0))).toVar();
        const h1 = hash21(seed).toVar();
        const h2 = hash21(seed.yx.add(7.7)).toVar();
        const centre = cell.mul(V.cell).add(vec2(h1, h2).sub(0.5).mul(V.cell * 0.86)).toVar();
        const t = zk.mul(along).toVar();
        const glow = glowAt(length(hit.sub(centre)).sub(V.mote), t, V.glowK);
        // The veil this mote flies in (read at the mote, so a mote is lit whole or not at all).
        const at = vec3(centre.x, centre.y, layerId.mul(V.layer)).mul(0.105).add(drift);
        const field = N(at).toVar();
        const veil = float(1).sub(smoothstep(V.veil * 0.3, V.veil, abs(field.sub(0.5).sub(lean))));
        const body = smoothstep(0.30, 0.62, N(at.mul(0.37).add(vec3(3.1, 7.7, 1.3))));
        // Each mote its own brightness, and a slow beat (a wing catching the light).
        const size = sq(fract2(h1, h2)).mul(0.9).add(0.25);
        const beat = sin(tm.mul(2.2).add(h1.mul(TAU))).mul(0.2).add(0.8);
        const wave = gauss(zk.sub(turnAt).add(centre.x.mul(0.6)).div(3.0)).mul(event);
        const fade = smoothstep(0.5, 2.6, zk).mul(exp(t.mul(-V.fog)));
        const tone = mix(vec3(1.0, 0.84, 0.70), vec3(0.66, 0.72, 1.0), smoothstep(3.0, 20.0, t));
        acc.addAssign(tone.mul(glow.mul(veil).mul(body.mul(0.9).add(0.1)).mul(size).mul(beat)
            .mul(fade)
            .mul(wave.mul(2.0).add(1.0))));
    });
    // The dusk it wheels in: deep violet overhead, a band of rose light low on a far horizon,
    // and still water under it holding a dim image of the band.
    const up = r.y.add(0.16).toVar();
    const sky = mix(vec3(0.036, 0.016, 0.066), vec3(0.005, 0.004, 0.020), smoothstep(0.0, 0.7, up));
    const glowDir = clamp(dot(normalize(vec3(r.x, 0.0, r.z)), vec3(0.42, 0.0, 0.907)), 0.0, 1.0).toVar();
    const bandCol = mix(vec3(0.34, 0.08, 0.30), vec3(1.0, 0.44, 0.26), sq(sq(glowDir)).mul(mood.y.mul(0.4).add(0.6)));
    const band = exp(abs(up).mul(-13.0)).mul(sq(glowDir).mul(0.85).add(0.15));
    const water = mix(vec3(0.014, 0.008, 0.030), vec3(0.003, 0.003, 0.012), smoothstep(0.0, 0.5, up.negate()));
    const lane = exp(abs(up).mul(-3.2)).mul(sq(sq(glowDir))).mul(float(1).sub(step(0.0, up))).mul(0.10);
    const dusk = mix(water, sky, step(0.0, up)).add(bandCol.mul(band.mul(0.42).add(lane)));
    return dusk.add(acc.mul(1.15));
}

/** A third number in 0..1 from two hashes (their sum's fraction): spares a third hash a mote. */
function fract2(a, b) {
    const s = a.mul(7.0).add(b.mul(13.0));
    return s.sub(floor(s));
}
