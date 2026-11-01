// @ts-check
/**
 * @fileoverview THE JELLYFISH DRIFT — chapter 2's open water is never empty (2026-11-01).
 *
 * The big animals (odyssey-ocean-roam.js) swim long loops and are in view part of the time, so
 * between their passes the mid-water was "atmospheric but sparse" (docs/ODYSSEY_CHAPTER_AUDIT_
 * 2026-10-22.md). Jellyfish fill it the way they fill a real sea: a few dozen, mostly small and
 * far, a handful beside the climb, each hanging in its own place and drifting on its own slow
 * loop. The climb passes them; they never move with it.
 *
 * HOW A JELLY SWIMS. A beat is a fast contraction and a slow relaxation (`jellySqueeze`). The
 * bell is pushed along its own axis on the contraction and coasts after it (`jellySurge`: its
 * speed peaks a fifth of the way into the beat and dies away). Between beats it sinks back as
 * much as the beat lifted it, so it bobs where it hangs. Its axis leans `tilt` from upright and
 * turns slowly round as it goes, so over a few minutes it draws a small loop (`loop` u in radius).
 * All of it is a function of the clock alone: the shader places every vertex from the same
 * formulas (odyssey-jellyfish.js), and the CPU twin here is what the tests and the gate read.
 *
 * WHERE. Placed by scoring the real rail camera over the drift up the ocean and at the orb parks
 * (tests/unit/odyssey-ch2-jellyfish.test.js): something in frame on every stretch of the climb,
 * a near one now and then, none over the orbs, the rail or the eye, none inside the big animals'
 * routes, all under the surface. See docs/ODYSSEY_CH2_JELLYFISH_2026-11.md.
 *
 * Pure: no three.js (vectors are anything with x, y, z).
 */
import { OCEAN_COLUMN } from './odyssey-ocean-roam.js';

const TAU = Math.PI * 2;

/** The kinds, by index (the shader's `kind`). */
export const JELLY_KIND = Object.freeze({ moon: 0, nettle: 1, lantern: 2 });

/**
 * Per kind, in bell radii: `glide` how far one beat carries it along its axis, `height` the
 * bell's height, `tentacles` and `arms` how far they hang, `beat` seconds per beat at r = 1 (a
 * bigger bell beats slower, as sqrt(r)).
 *   moon    — Aurelia: a flat glassy dome, a fringe of short tentacles, four short frilly arms;
 *   nettle  — Chrysaora: an amber bell with long trailing tentacles and long ruffled arms;
 *   lantern — a small deep bell (Periphylla/Atolla) with a ring of blue light.
 */
export const JELLY_KINDS = Object.freeze([
    Object.freeze({
        name: 'moon', glide: 1.0, height: 0.5, tentacles: 0.55, arms: 1.2, beat: 2.4,
    }),
    Object.freeze({
        name: 'nettle', glide: 0.8, height: 0.72, tentacles: 5.5, arms: 3.4, beat: 2.6,
    }),
    Object.freeze({
        name: 'lantern', glide: 1.1, height: 0.95, tentacles: 2.2, arms: 0.7, beat: 2.0,
    }),
]);

/** The beat's shape: the share of it spent contracting, and how front-loaded the glide is. */
export const JELLY_PULSE = Object.freeze({ contract: 0.26, surge: 5 });

const SURGE_NORM = 1 - ((1 + JELLY_PULSE.surge) * Math.exp(-JELLY_PULSE.surge));
const smooth = (u) => u * u * (3 - (2 * u));

/**
 * How contracted the bell is at beat phase `f` (0..1): 0 relaxed, 1 fully in. Fast in (a
 * quarter of the beat), slow out, smooth at both ends of the beat.
 * @param {number} f
 */
export function jellySqueeze(f) {
    const c = JELLY_PULSE.contract;
    if (f < c) return smooth(Math.max(f, 0) / c);
    const u = Math.min((f - c) / (1 - c), 1);
    // Out faster at first, settling slowly (the bell's elastic recoil).
    return 1 - smooth(u ** 0.7);
}

/**
 * How far through its beat's glide the bell is at beat phase `f` (0 at 0, 1 at 1): its speed
 * rises through the contraction, peaks at a fifth of the beat and dies away as it coasts.
 * @param {number} f
 */
export function jellySurge(f) {
    const x = JELLY_PULSE.surge * Math.min(Math.max(f, 0), 1);
    return (1 - ((1 + x) * Math.exp(-x))) / SURGE_NORM;
}

/**
 * @typedef {object} OceanJelly
 * @property {number} kind JELLY_KIND
 * @property {number} bearing its home lies this way from the column (degrees in the xz plane,
 *   from +x toward +z)...
 * @property {number} out ...this far out from it (u)
 * @property {number} y its home's height
 * @property {number} r bell radius (u)
 * @property {number} phase where in its beat it is at t = 0 (0..1)
 * @property {number} tilt how far its axis leans from upright (rad)
 * @property {number} loop the radius of the small loop it drifts round (u)
 * @property {number} turn +1 / -1, which way round
 * @property {number} spin where on that loop it starts (rad)
 * @property {number} bob its slow rise and fall (u), over `bobS` seconds
 * @property {number} bobS
 * @property {number} reach tentacle length (bell radii): its kind's, scaled per jelly
 */

/**
 * One row of the table: [bearing, out, y, r, phase, tilt, loop, turn, spin, bob, bobS, reach].
 * @param {'moon'|'nettle'|'lantern'} kind
 * @param {number[]} row
 * @returns {OceanJelly}
 */
const jelly = (kind, [bearing, out, y, r, phase, tilt, loop, turn, spin, bob, bobS, reach]) => Object.freeze({
    kind: JELLY_KIND[kind], bearing, out, y, r, phase, tilt, loop, turn, spin, bob, bobS, reach,
});

/**
 * The drift, deepest first. The rows came from a constrained search on the real camera (a scratch
 * tool, as the big animals' routes did; docs/ODYSSEY_CH2_JELLYFISH_2026-11.md), whose limits are
 * the ones tests/unit/odyssey-ch2-jellyfish.test.js pins: change a row only with that test in hand.
 * Moon jellies through the whole column, sea nettles in the upper half toward the light, the
 * lanterns in the deeper middle, where the water is darkest and their light reads.
 */
export const OCEAN_JELLIES = Object.freeze([
    jelly('moon', [-7, 37.4, 152.2, 1.34, 0.75, 0.15, 3.7, -1, 1.29, 1.4, 71, 0.51]),
    jelly('moon', [104, 54.2, 164.3, 0.8, 0.64, 0.38, 3.8, -1, 0.19, 1.4, 86, 0.48]),
    jelly('lantern', [162, 34.9, 168.4, 0.78, 0.71, 0.15, 1.7, 1, 0.39, 2.2, 64, 1.93]),
    jelly('moon', [-177, 38.8, 170.1, 1.28, 0.37, 0.36, 1.8, -1, 1.72, 0.9, 48, 0.65]),
    jelly('lantern', [152, 16.4, 175.1, 0.95, 0.9, 0.42, 2.6, 1, 2.84, 1.6, 56, 2.08]),
    jelly('moon', [-43, 31.9, 180.3, 1.13, 0.2, 0.29, 2.9, -1, 3.34, 1.5, 51, 0.59]),
    jelly('lantern', [-8, 17.2, 184.1, 0.92, 0.56, 0.35, 1.9, -1, 4.77, 0.7, 51, 2.3]),
    jelly('moon', [-91, 19.3, 186.6, 1.35, 0.96, 0.44, 3.8, 1, 5.49, 0.7, 62, 0.51]),
    jelly('lantern', [-59, 75.8, 192.6, 0.9, 0.38, 0.37, 4.8, -1, 4.72, 0.9, 44, 2.21]),
    jelly('lantern', [-17, 85.9, 192.6, 0.81, 0.27, 0.14, 4.6, -1, 3.44, 1.9, 75, 1.91]),
    jelly('lantern', [130, 82.9, 194.1, 0.84, 0.76, 0.16, 2.9, 1, 0.66, 1.7, 73, 2.13]),
    jelly('lantern', [-107, 46.9, 201.6, 0.86, 0.53, 0.16, 3.3, -1, 3.14, 2.2, 86, 2.36]),
    jelly('lantern', [173, 76.1, 202.5, 0.83, 0.09, 0.4, 4, -1, 6, 1.8, 74, 1.81]),
    jelly('moon', [45, 57.9, 213, 0.92, 0.12, 0.37, 4.2, -1, 3.96, 1.6, 71, 0.57]),
    jelly('nettle', [-89, 66.5, 216.7, 1.34, 0.61, 0.27, 2.8, -1, 3.42, 1.5, 58, 4.91]),
    jelly('moon', [172, 78.6, 223.1, 1.34, 0.98, 0.18, 4.2, 1, 2.41, 1.1, 63, 0.57]),
    jelly('moon', [5, 75.8, 224.4, 0.98, 0.46, 0.17, 3, 1, 0.98, 2, 65, 0.61]),
    jelly('moon', [102, 86.2, 225.3, 0.81, 0.69, 0.19, 1.8, 1, 5.46, 2.1, 37, 0.45]),
    jelly('nettle', [-56, 13.5, 225.9, 1.73, 0.07, 0.33, 2.3, 1, 3.3, 0.6, 40, 5.37]),
    jelly('moon', [-121, 61.7, 243.4, 1.32, 0.51, 0.4, 3.4, 1, 5.48, 1, 43, 0.55]),
    jelly('nettle', [-134, 67.1, 247.2, 1.4, 0.41, 0.45, 3.8, -1, 2.3, 0.7, 73, 6.48]),
    jelly('nettle', [-105, 79.8, 251.9, 2.65, 0.17, 0.3, 2.5, 1, 0.61, 1.5, 43, 5.31]),
    jelly('nettle', [-161, 24.1, 266.7, 1.8, 0.05, 0.22, 3.4, -1, 3.73, 1.2, 40, 5.23]),
    jelly('nettle', [-148, 34.9, 273.6, 1.51, 0.62, 0.31, 1.9, 1, 3.93, 0.6, 52, 5.68]),
    jelly('moon', [-93, 79.7, 281.8, 1.29, 0.96, 0.28, 1.5, -1, 0.58, 2, 59, 0.55]),
    jelly('moon', [-133, 76.9, 282.4, 1.29, 0.87, 0.36, 3.1, -1, 4.85, 1.4, 71, 0.63]),
    jelly('moon', [-158, 30, 282.9, 0.95, 0.35, 0.21, 2.7, 1, 5.12, 0.6, 66, 0.48]),
    jelly('moon', [0, 67.2, 283, 1.14, 0.78, 0.17, 4.6, 1, 3.47, 1.7, 43, 0.6]),
    jelly('moon', [-100, 41.1, 283.6, 0.82, 0.65, 0.45, 1.8, 1, 2.96, 0.7, 66, 0.57]),
]);

/** Seconds per beat for a jelly (its kind's beat, slower for a bigger bell). */
export function jellyBeatS(j) {
    return JELLY_KINDS[j.kind].beat * Math.sqrt(Math.max(j.r, 0.2));
}

/** Its home in the world (the centre of its loop). */
export function jellyHome(j, out = { x: 0, y: 0, z: 0 }) {
    const b = j.bearing * (Math.PI / 180);
    out.x = OCEAN_COLUMN.x + (Math.cos(b) * j.out);
    out.y = j.y;
    out.z = OCEAN_COLUMN.z + (Math.sin(b) * j.out);
    return out;
}

/** How far below its bell centre its longest strand hangs at rest (u). */
export function jellyHang(j) {
    const k = JELLY_KINDS[j.kind];
    return j.r * (k.height + Math.max(j.reach, k.arms));
}

/**
 * Where a jelly's bell is at time `t` (world), and its axis (unit, the way the bell points)
 * when asked for. The shader's `jellyPlace` is the same arithmetic.
 * @param {OceanJelly} j
 * @param {number} t seconds (the world's clock)
 * @param {{ x: number, y: number, z: number }} out written
 * @param {{ x: number, y: number, z: number }} [axis] written when given
 */
export function jellyAt(j, t, out, axis) {
    const beat = jellyBeatS(j);
    const n = (t / beat) + j.phase;
    const k = Math.floor(n);
    const f = n - k;
    const step = JELLY_KINDS[j.kind].glide * j.r;
    const surge = jellySurge(f);
    const s = step * (k + surge);
    const sinT = Math.sin(j.tilt);
    const cosT = Math.cos(j.tilt);
    // The axis turns round as it goes (by distance swum, so it turns only while it glides).
    const psi = j.spin + ((j.turn * s * sinT) / j.loop);
    const b = j.bearing * (Math.PI / 180);
    out.x = OCEAN_COLUMN.x + (Math.cos(b) * j.out) + (j.turn * j.loop * Math.sin(psi));
    out.z = OCEAN_COLUMN.z + (Math.sin(b) * j.out) - (j.turn * j.loop * Math.cos(psi));
    // Up the axis on each beat and back down between them: it bobs where it hangs.
    out.y = j.y + (cosT * step * (surge - f)) + (j.bob * Math.sin(((TAU * t) / j.bobS) + (j.spin * 1.3)));
    if (axis) {
        axis.x = sinT * Math.cos(psi);
        axis.y = cosT;
        axis.z = sinT * Math.sin(psi);
    }
    return out;
}
