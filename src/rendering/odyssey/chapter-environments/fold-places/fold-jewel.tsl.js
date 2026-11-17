/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE JEWEL — the fold's sixth place (orb 55: Kaleidosonic).
 *
 * The inside of a cut gem: a table, a crown and a pavilion of eight facets each and the eight
 * between, dark glass with bright edges, turning slowly. Each facet is a window on one of the
 * worlds the journey has crossed: the lava core's glowing cracks, the deep sea's nets of light,
 * the island's shallows and sand, the mountains' snow, the Earth from orbit, the stars. A
 * different world in every facet, and they change as the gem turns.
 *
 * Met exactly, three times over. A ray runs to the facet it leaves by, lights that facet's
 * edges, and is thrown back in; after the last throw it looks out at a world.
 */
import {
    If, Loop, abs, clamp, cos, dot, float, floor, fract, int, max, mix, reflect, sin, smoothstep, vec2, vec3,
} from 'three/tsl';
import { hash21 } from '../shared/odyssey-tsl-noise.js';
import {
    DEG, N, TAU, film, frameRows, pick, rot2, sq, turn,
} from './fold-tools.tsl.js';

export const JEWEL = Object.freeze({
    frame: [16, 22, -12],
    /** Where the eye sits in the gem (off its axis, so no view is a rosette). */
    eye: [0.42, -0.18, 0.1],
    bounces: 3,
    /** The gem's turn about its own axis: by the clock (rad/s) and by travel (rad per unit). */
    spin: 0.021,
    travelSpin: 0.045,
    /** What is kept of the light at each throw. */
    kept: 0.74,
});

/**
 * The journey's worlds, as a facet shows them: a field of two colours (`low`, `high`) with seams
 * of light in a third (`seam`): the lava core, the deep sea, the island, the mountains, the Earth
 * from orbit, space.
 */
export const JEWEL_WORLDS = Object.freeze({
    low: [
        [0.035, 0.003, 0.0], [0.0, 0.010, 0.050], [0.0, 0.13, 0.16],
        [0.020, 0.050, 0.16], [0.0, 0.020, 0.12], [0.005, 0.0, 0.018],
    ],
    high: [
        [0.16, 0.016, 0.0], [0.0, 0.070, 0.18], [0.15, 0.12, 0.035],
        [0.050, 0.085, 0.20], [0.008, 0.075, 0.26], [0.065, 0.010, 0.15],
    ],
    seam: [
        [1.0, 0.40, 0.04], [0.10, 0.55, 0.66], [0.34, 0.42, 0.30],
        [0.30, 0.26, 0.34], [0.26, 0.34, 0.44], [0.55, 0.44, 0.42],
    ],
});

const ROWS = frameRows(JEWEL.frame);

export function placeJewel({
    rd, tm, zEye, mood, event, flash,
}) {
    const V = JEWEL;
    const spin = tm.mul(V.spin).add(zEye.mul(V.travelSpin)).toVar();
    const r0 = turn(rd, ROWS).toVar();
    const rs = rot2(r0.xz, spin);
    const dir = vec3(rs.x, r0.y, rs.y).toVar();
    const pos = vec3(...V.eye).toVar();
    const acc = vec3(0).toVar();
    const kept = float(1).toVar();
    const travelled = float(0).toVar();
    const facet = float(0).toVar();
    const key = vec3(0.36, 0.80, 0.48);
    const ring = (i, tilt, turnBy) => {
        const th = float(i).mul(TAU / 8).add(turnBy);
        return vec3(cos(th).mul(Math.sin(tilt)), float(Math.cos(tilt)), sin(th).mul(Math.sin(tilt)));
    };
    Loop({
        start: int(0), end: int(V.bounces), type: 'int', condition: '<', name: 'jewelBounce',
    }, ({ jewelBounce }) => {
        const t1 = float(1e3).toVar();
        const t2 = float(1e3).toVar();
        const nHit = vec3(0, 1, 0).toVar();
        const idHit = float(0).toVar();
        const meet = (n, offset, id) => {
            const nn = n.toVar();
            const den = dot(nn, dir).toVar();
            const tt = float(offset).sub(dot(nn, pos)).div(max(den, 1e-4)).toVar();
            If(den.greaterThan(1e-4), () => {
                If(tt.lessThan(t1), () => {
                    t2.assign(t1);
                    t1.assign(tt);
                    nHit.assign(nn);
                    idHit.assign(id);
                }).ElseIf(tt.lessThan(t2), () => {
                    t2.assign(tt);
                });
            });
        };
        // The table above and the culet's small flat below.
        meet(vec3(0, 1, 0), 1.25, float(40));
        meet(vec3(0, -1, 0), 2.9, float(41));
        Loop({
            start: int(0), end: int(8), type: 'int', condition: '<', name: 'jewelFacet',
        }, ({ jewelFacet }) => {
            const i = float(jewelFacet);
            meet(ring(i, 48 * DEG, 0), 2.05, i);
            meet(ring(i, 76 * DEG, TAU / 16), 2.85, i.add(8));
            meet(ring(i, 132 * DEG, TAU / 16), 2.25, i.add(16));
            meet(ring(i, 112 * DEG, 0), 2.75, i.add(24));
        });
        travelled.addAssign(t1);
        // The facet's edge: where the next facet's plane is met almost as soon.
        const near = t2.sub(t1).div(travelled);
        const edge = float(1).div(float(1).add(near.mul(near).mul(400000.0)));
        const next = reflect(dir, nHit).toVar();
        const glint = clamp(dot(next, key), 0.0, 1.0);
        // (A glint is a point: a low power lit a whole facet as a pale wedge.)
        const g16 = sq(sq(sq(sq(glint))));
        const fire = sq(sq(sq(sq(g16))));
        const spectrum = film(idHit.mul(0.137).add(near.mul(3.0)).add(mood.x.mul(0.5)));
        // (Each throw's edges fainter than the last, so the near facets read first.)
        acc.addAssign(spectrum.mul(0.7).add(vec3(0.3, 0.3, 0.3)).mul(edge).mul(sq(kept))
            .mul(0.26));
        acc.addAssign(vec3(1.0, 0.95, 0.88).mul(fire).mul(kept).mul(0.3));
        facet.assign(facet.mul(3.7).add(idHit).add(float(jewelBounce).mul(11.0)));
        pos.assign(pos.add(dir.mul(t1)));
        dir.assign(next);
        kept.mulAssign(V.kept);
    });
    // What the last facet looks out on: one of the journey's worlds, by the facets met on the
    // way, drawn where the ray left the gem (so the world lies still on its facet).
    const fh = hash21(vec2(facet, 3.3)).toVar();
    const world = floor(fract(fh.add(mood.z.mul(0.5))).mul(6.0)).toVar();
    // (Each facet at its own scale, so no two show the same weave.)
    const at = pos.mul(fh.mul(0.9).add(0.7)).add(vec3(fh.mul(31.0), fh.mul(17.0), tm.mul(0.03))).toVar();
    const field = N(at.mul(0.9)).toVar();
    const fine = N(at.mul(2.6).add(vec3(3.1, 7.7, 1.3))).toVar();
    const seam = sq(sq(sq(float(1).sub(abs(fine.mul(2).sub(1)))))).toVar();
    const scene = mix(pick(world, JEWEL_WORLDS.low), pick(world, JEWEL_WORLDS.high), smoothstep(0.25, 0.75, field))
        .add(pick(world, JEWEL_WORLDS.seam).mul(seam).mul(field.mul(0.8).add(0.3)));
    // The happening: one world's light floods every facet for a while.
    // (As a tint through the worlds, which keep their darks: mixed over them it was a veil.)
    const flood = pick(floor(fract(mood.z.mul(3.0)).mul(6.0)), JEWEL_WORLDS.seam).mul(2.4);
    const shown = scene.mul(mix(vec3(1, 1, 1), flood, event.mul(flash).mul(0.6)));
    return acc.add(shown.mul(kept).mul(0.8)).add(vec3(0.004, 0.002, 0.008));
}
