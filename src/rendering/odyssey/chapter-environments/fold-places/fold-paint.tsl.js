/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE PAINT — the fold's seventh place (orb 56: Chromatic Impasto).
 *
 * Strokes of thick paint hanging in the dark, each its own pigment, laid across one another at
 * every angle and receding into a warm gloom: a room where colour has weight.
 *
 * Walked layer by layer, nearest first: on each plane across the way ahead, rows of long strokes
 * (each a band about a wandering middle line, its ends where a slow field runs out), laid at the
 * layer's own angle. Paint hides what is behind it, so the walk carries how much still shows
 * through and stops when nothing does.
 */
import {
    Break, If, Loop, abs, clamp, dot, exp, float, floor, fract, int, max, mix, sin, smoothstep, step, vec2, vec3,
} from 'three/tsl';
import { hash21 } from '../shared/odyssey-tsl-noise.js';
import {
    N, TAU, frameRows, gauss, pick, rot2, sq, stroke, turn,
} from './fold-tools.tsl.js';

export const PAINT = Object.freeze({
    frame: [6, 4, -8],
    /** The planes' spacing along the way, the rows' spacing on a plane. */
    layer: 2.3,
    row: 4.2,
    /** Nearer than this a stroke is not drawn (it would fill the frame). */
    near: 3.2,
    /** The gloom the far strokes sink into (per unit). */
    haze: 0.095,
});

/** The pigments: cadmium red, orange, ochre, viridian, cobalt, violet, a warm white, turquoise. */
export const PAINT_PIGMENTS = Object.freeze([
    [0.50, 0.022, 0.032], [0.62, 0.18, 0.012], [0.56, 0.36, 0.034], [0.010, 0.24, 0.16],
    [0.012, 0.095, 0.44], [0.19, 0.042, 0.37], [0.42, 0.37, 0.29], [0.012, 0.27, 0.34],
]);

const ROWS = frameRows(PAINT.frame);

export function placePaint({
    rd, tm, zEye, pix, mood, event, eventAge, steps,
}) {
    const V = PAINT;
    const r = turn(rd, ROWS).toVar();
    const fz = max(r.z, 0.08).toVar();
    const slope = r.xy.div(fz).toVar();
    const along = float(1).div(fz).toVar();
    const base = floor(zEye.div(V.layer)).toVar();
    const off = zEye.div(V.layer).sub(base).toVar();
    const acc = vec3(0).toVar();
    const through = float(1).toVar();
    const layers = Math.max(6, Math.round(steps * 0.42));
    const wet = eventAge.mul(0.9).toVar();
    const gloom = vec3(0.016, 0.007, 0.020);
    Loop({
        start: int(0), end: int(layers), type: 'int', condition: '<', name: 'paintLayer',
    }, ({ paintLayer }) => {
        const zk = float(paintLayer).add(1).sub(off).mul(V.layer)
            .toVar();
        const layerId = base.add(float(paintLayer)).add(1).toVar();
        const lh = hash21(vec2(layerId, 5.5)).toVar();
        const h = rot2(slope.mul(zk), lh.mul(TAU).add(tm.mul(0.004))).toVar();
        const rowAt = h.y.div(V.row).add(lh.mul(3.0)).toVar();
        const row = floor(rowAt.add(0.5)).toVar();
        const yl = rowAt.sub(row).mul(V.row).toVar();
        const sh = hash21(vec2(row.add(64.0), layerId.add(3.0))).toVar();
        const sh2 = hash21(vec2(layerId.add(9.0), row.add(77.0))).toVar();
        // The stroke's middle line wanders; its width swells and runs out along its length.
        const body = N(vec3(h.x.mul(0.21).add(sh.mul(40.0)), row.mul(3.1), layerId.mul(5.7))).toVar();
        const mid = sin(h.x.mul(0.27).add(sh.mul(TAU))).mul(0.62).add(body.sub(0.5).mul(1.5));
        const width = smoothstep(0.40, 0.66, body).mul(sh2.mul(0.6).add(0.55)).toVar();
        const e = yl.sub(mid).toVar();
        const d = abs(e).sub(width).toVar();
        const t = zk.mul(along).toVar();
        const aa = t.mul(pix).mul(1.4).add(0.004).toVar();
        // Bristle marks along it: ridges of thick paint, catching light on their upper sides.
        const bristle = N(vec3(h.x.mul(0.9), e.mul(11.0), layerId.add(sh.mul(9.0)))).toVar();
        const ridge = sin(e.mul(30.0).add(bristle.mul(7.0))).mul(0.5).add(0.5);
        const relief = clamp(e.div(max(width, 0.05)), -1.0, 1.0);
        const light = relief.mul(0.42).add(0.58)
            .add(ridge.sub(0.5).mul(0.36).mul(float(1).sub(smoothstep(0.02, 0.09, aa))));
        const pigment = pick(floor(fract(sh.add(mood.z.mul(0.25)).add(layerId.mul(0.37))).mul(8.0)), PAINT_PIGMENTS);
        // The happening: a wet gleam runs down every stroke.
        const gleam = gauss(fract(h.x.mul(0.05).sub(wet.mul(0.11)).add(sh)).sub(0.5).mul(7.0)).mul(event);
        const haze = float(1).sub(exp(t.mul(-V.haze)));
        const lit = mix(pigment.mul(light).add(vec3(1.0, 0.94, 0.86).mul(gleam).mul(0.22)), gloom, haze);
        const nearFade = smoothstep(V.near, V.near + 2.6, zk);
        const cover = stroke(d, 0.0, aa).mul(step(0.02, width)).mul(nearFade).toVar();
        acc.addAssign(lit.mul(cover).mul(through));
        // Thick paint casts a soft shade on what lies behind it, just under its lower edge.
        const shade = stroke(abs(e.add(width).add(0.18)), 0.16, float(0.2)).mul(nearFade).mul(0.4);
        through.mulAssign(float(1).sub(cover).mul(float(1).sub(shade)));
        If(through.lessThan(0.02), () => {
            Break();
        });
    });
    // The ground it hangs before: a dark warm canvas with one light rising in it.
    const glow = clamp(dot(r, vec3(0.30, 0.52, 0.80)), 0.0, 1.0);
    const canvas = vec3(0.008, 0.004, 0.010)
        .add(mix(vec3(0.20, 0.035, 0.075), vec3(0.085, 0.035, 0.20), mood.x).mul(sq(glow).mul(glow)).mul(0.6))
        .add(vec3(0.004, 0.012, 0.024).mul(smoothstep(0.2, -0.8, r.y)));
    return acc.add(canvas.mul(through));
}
