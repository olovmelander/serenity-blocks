/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The small tools the fold's places share (odyssey-fold-places.tsl.js): a room's frame, lines
 * whose width comes from the pixel's angle, the soap film, a palette pick.
 *
 * What every place keeps to, because the fold's dispatcher runs a place behind a per-pixel branch
 * while one room opens through another:
 *  - no screen derivative and no mip-picking texture read (line widths from `pix`, the pixel's
 *    angle in radians, and the distance; noise from the baked lattice at level 0);
 *  - every value more than one branch reads is pinned (`toVar`) before the branch;
 *  - a glow's width is an ANGLE (distance over depth), so near things stay crisp;
 *  - bounded before masked: no exp of a positive distance, no pow of a signed base.
 */
import {
    cos, dot, exp, float, max, select, sin, smoothstep, vec2, vec3,
} from 'three/tsl';
import { latticeNoise3 } from '../shared/odyssey-lattice-noise.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Smooth value noise in 0..1 from the baked lattice (one fetch, level 0). */
export const N = latticeNoise3;

export const sq = (x) => x.mul(x);

/** exp(-x^2), written as a product (pow of a negative base is NaN in WGSL). */
export const gauss = (x) => exp(x.mul(x).negate());

/** The soap film: hue `t` (turns) to a thin-film colour (magenta, gold, green, cyan, violet). */
export const film = (t) => vec3(0.55).add(vec3(0.45).mul(cos(vec3(t, t, t).add(vec3(0.0, 0.27, 0.58)).mul(TAU))));

export const rot2 = (v, a) => {
    const c = cos(a);
    const s = sin(a);
    return vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)));
};

/**
 * Rows of the rotation that turns the view into a room's frame: yaw (degrees, to the right),
 * then pitch (up), then roll. Folded in JavaScript, so a place's frame costs three dot products.
 * @param {number[]} frame [yaw, pitch, roll]
 * @returns {number[][]}
 */
export function frameRows([yawDeg, pitchDeg, rollDeg]) {
    const [cy, sy] = [Math.cos(yawDeg * DEG), Math.sin(yawDeg * DEG)];
    const [cp, sp] = [Math.cos(pitchDeg * DEG), Math.sin(pitchDeg * DEG)];
    const [cr, sr] = [Math.cos(rollDeg * DEG), Math.sin(rollDeg * DEG)];
    const yaw = [[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]];
    const pitch = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
    const roll = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
    const cell = (row, b, j) => (row[0] * b[0][j]) + (row[1] * b[1][j]) + (row[2] * b[2][j]);
    const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => cell(row, b, j)));
    return mul(roll, mul(pitch, yaw));
}

/** A direction turned by constant rows. */
export const turn = (v, rows) => vec3(
    dot(v, vec3(...rows[0])),
    dot(v, vec3(...rows[1])),
    dot(v, vec3(...rows[2])),
);

/** A line of half-width `w` at distance `d` from its middle, `aa` wide at its edge (never zero). */
export const stroke = (d, w, aa) => float(1).sub(smoothstep(float(w), float(w).add(max(aa, 1e-4)), d));

/** A glow whose width is an angle: 1 at the thing, falling as (distance / depth)^2 * k. */
export const glowAt = (dist, depth, k) => {
    const da = max(dist, 0).div(depth);
    return float(1).div(float(1).add(da.mul(da).mul(k)));
};

/** One of `list` (JavaScript rgb triples) by a float index node, as a chain of selects. */
export const pick = (index, list) => list.slice(1).reduce(
    (acc, rgb, i) => select(index.greaterThan(i + 0.5), vec3(...rgb), acc),
    vec3(...list[0]),
);
