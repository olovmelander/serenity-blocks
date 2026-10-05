/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sacred Geometry's floor inscription: a mandala of fine golden light cut into the obsidian,
 * centred under the gate. At its heart the Flower of Life (nineteen circles, each through the
 * centres of its neighbours) in its double enclosing ring; around it a sunburst of spokes, a
 * ring of ticks, a rosary of twelve small circles and, far out, eight bindus on a great circle.
 * The flower turns one way and the outer rings the other, slowly, like a mechanism.
 *
 * Everything is drawn in floor units (the floor seen in perspective), so it foreshortens
 * correctly. Each line is pre-filtered against the pixel's footprint ACROSS that line, from the
 * screen derivatives of the floor position: near the viewer a line keeps its cut width; toward
 * the horizon, where a pixel spans more floor than the line is wide, it widens and dims in
 * proportion (its light is conserved) and melts into an even glow instead of shimmering.
 * Circles only, no long straight cuts: in perspective those read as a grid.
 */
import {
    abs, atan, cos, dFdx, dFdy, dot, exp, float, floor, length, max, sin, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';
import { fadeOut, turn } from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
/** The Flower of Life's circle radius: its second ring of centres (2 A) meets the gate's feet. */
export const FLOWER = 0.35;
const A = FLOWER;
/** Concentric circles: radius, cut width, brightness. */
const RINGS = [
    [3 * A, 0.0038, 1.0], [3 * A + 0.045, 0.0024, 0.6],
    [1.52, 0.0036, 0.85], [1.58, 0.0022, 0.5], [1.68, 0.0022, 0.45],
    [2.12, 0.0034, 0.75], [2.95, 0.004, 0.65],
];
/** The rosary: small circles strung on a ring between the ticks and the fourth circle. */
const ROSARY = { radius: 1.9, circle: 0.09, count: 12 };

/** The nineteen centres of the Flower of Life: the centre, then rings at A, √3 A and 2 A. */
const FLOWER_CENTRES = [[0, 0]];
for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * TAU;
    FLOWER_CENTRES.push([Math.cos(angle) * A, Math.sin(angle) * A]);
}
for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * TAU;
    const between = angle + Math.PI / 6;
    FLOWER_CENTRES.push([Math.cos(between) * A * Math.sqrt(3), Math.sin(between) * A * Math.sqrt(3)]);
    FLOWER_CENTRES.push([Math.cos(angle) * 2 * A, Math.sin(angle) * 2 * A]);
}

/**
 * A line of light `width` wide at distance `d`, pre-filtered to the pixel footprint `fp`: far
 * away it widens to the footprint and dims in proportion (its light is conserved); close to the
 * lens it stays about a pixel and a half wide, a fine cut rather than a magnified stripe.
 */
export const lineOf = (d, fp, width) => {
    // Never zero: where the footprint vanishes (the clamped sky above the horizon) 0/0 would be NaN.
    const w = fp.mul(1.3).min(width).max(width * 0.05).toVar();
    const w2 = w.mul(w).toVar();
    const s2 = fp.mul(fp).mul(0.6).add(w2).toVar();
    return exp(d.mul(d).div(s2).negate()).mul(sqrt(w2.div(s2)));
};

/** Floor distance one pixel spans across a line with unit normal `n` (dx, dy: screen derivatives). */
const across = (n, dx, dy) => abs(dot(n, dx)).add(abs(dot(n, dy)));

/** A circle of radius `radius` centred at `centre` (a vec2 node). */
function circleLine(m, centre, radius, dx, dy, width) {
    const offset = m.sub(centre).toVar();
    const distance = length(offset).toVar();
    const normal = offset.div(distance.max(1e-4));
    return lineOf(abs(distance.sub(radius)), across(normal, dx, dy), width);
}

/**
 * The inscription's light at floor point `f` (floor units, origin under the gate's centre).
 * `reach` is how far from the centre the breath's light has spread (floor units); `wave` lights
 * a ring at that front while the lungs fill. Returns linear RGB.
 */
export function inscription(f, u, { reach, wave, detail }) {
    // Two frames turning against each other: the flower, and the outer rings.
    const a = turn(f, u.time.mul(0.012)).toVar();
    const b = turn(f, u.time.mul(-0.007).add(0.26)).toVar();
    const adx = dFdx(a).toVar();
    const ady = dFdy(a).toVar();
    const bdx = dFdx(b).toVar();
    const bdy = dFdy(b).toVar();
    const r = length(f).toVar();
    const radial = a.div(r.max(1e-4)).toVar();
    const fpRadial = across(radial, adx, ady).toVar();

    // Concentric sacred circles (frame-free).
    const rings = float(0).toVar();
    RINGS.forEach(([radius, width, gain]) => {
        rings.addAssign(lineOf(abs(r.sub(radius)), fpRadial, width).mul(gain));
    });

    // The Flower of Life. The lightest tier draws its seed: the centre and the first ring of six.
    const flower = float(0).toVar();
    FLOWER_CENTRES.slice(0, detail >= 0.5 ? FLOWER_CENTRES.length : 7).forEach(([x, y]) => {
        flower.addAssign(circleLine(a, vec2(x, y), A, adx, ady, 0.0026));
    });

    // A sunburst of twenty-four spokes between the flower's ring and the third circle.
    // atan(0, 0) is undefined in GLSL: never ask for it.
    const phi = atan(b.y, b.x.add(1e-6)).toVar();
    const tangentFp = across(vec2(b.y.negate(), b.x).div(r.max(1e-4)), bdx, bdy).toVar();
    const spokes = lineOf(r.mul(abs(sin(phi.mul(12)))).div(12), tangentFp, 0.0024)
        .mul(smoothstep(1.11, 1.15, r)).mul(fadeOut(1.47, 1.51, r))
        .toVar();
    // Seventy-two ticks between the third circle's outer rings (phones skip the finest cuts).
    const ticks = detail >= 0.6
        ? lineOf(r.mul(abs(sin(phi.mul(36).add(Math.PI / 2)))).div(36), tangentFp, 0.0022)
            .mul(smoothstep(1.585, 1.595, r)).mul(fadeOut(1.665, 1.675, r))
        : float(0);

    // The rosary: twelve small circles; only the nearest can touch a point.
    const step = TAU / ROSARY.count;
    const bead = floor(phi.div(step).add(0.5)).mul(step);
    const rosary = circleLine(b, vec2(cos(bead), sin(bead)).mul(ROSARY.radius), ROSARY.circle, bdx, bdy, 0.0024);

    // Eight bindus on the great circle: small discs of light.
    const dotStep = TAU / 8;
    const dotAngle = floor(phi.div(dotStep).add(0.5)).mul(dotStep);
    const dotDistance = length(b.sub(vec2(cos(dotAngle), sin(dotAngle)).mul(2.95)));
    const bindus = lineOf(dotDistance.sub(0.03).max(0), tangentFp.add(fpRadial).mul(0.5), 0.006).mul(1.3);

    // The breath's light spreads from the centre: lines inside its reach glow, beyond it rest dim.
    const lit = fadeOut(reach.sub(0.35), reach.add(0.35), r).mul(0.72).add(0.28).toVar();
    const front = r.sub(reach);
    const crest = exp(front.mul(front).div(fpRadial.mul(fpRadial).add(0.0045)).negate()).mul(wave);

    const gold = vec3(1.0, 0.7, 0.32);
    const whiteGold = vec3(1.0, 0.88, 0.66);
    const amber = vec3(1.0, 0.56, 0.22);
    return whiteGold.mul(flower.mul(0.7))
        .add(gold.mul(rings.add(rosary.mul(0.8)).add(bindus)))
        .add(amber.mul(spokes.mul(0.55).add(ticks.mul(0.6))))
        .mul(lit)
        .add(gold.mul(crest).mul(0.55));
}

/** A pixel's floor footprint (floor units): the larger axis, for fading fine texture with distance. */
export const footprint = (f) => {
    const dx = dFdx(f);
    const dy = dFdy(f);
    return max(abs(dx.x).add(abs(dy.x)), abs(dx.y).add(abs(dy.y)));
};
