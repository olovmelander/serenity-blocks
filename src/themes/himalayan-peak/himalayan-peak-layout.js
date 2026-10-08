/**
 * Himalayan Peak — the plan of what stands near the viewer and of what the wind carries
 * (CPU only, three-free).
 *
 *  - The pass: the shoulder of snow the viewer stands on, drawn fine where the baked ground is
 *    too coarse to stand on, and married to it a few hundred metres out.
 *  - The chorten on its mound to the left, the cairn and its pole to the right, and the lines of
 *    prayer flags strung between them and out of the frame.
 *  - Where the crests throw their snow (points along the plan's ridges, set on the baked ground).
 *  - The track an avalanche takes down the hero's east face (the baked ground's own fall line).
 */

import {
    DEG, EYE, EYE_HEIGHT, REST_RIG, fovForAspect, mulberry32, smooth,
} from './himalayan-peak-core.js';
import { sampleField } from './himalayan-peak-field.js';
import { GROUND_UNDER_SNOW, HERO_SUMMIT, crestPoints } from './himalayan-peak-massif.js';

/** The snow under the viewer's boots. */
export const BOOTS = EYE.y - EYE_HEIGHT;

/** The chorten (its foot, metres from the eye) and the cairn with the flag pole. */
export const CHORTEN = Object.freeze({ x: -9.2, z: -19.5, height: 4.6 });
export const CAIRN = Object.freeze({ x: 11.4, z: -15.5, pole: 4.3 });

/**
 * The pass's own mesh reaches this far. Between the two PASS_MARRY radii it goes over from the
 * shoulder to the baked ground; all of that lies behind the shoulder's brow, out of sight.
 */
export const PASS_REACH = 190;
export const PASS_MARRY = [26, 150];

function hash(ix, iy) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
}

/**
 * The snow near the viewer (metres), before it is married to the baked ground: level under the
 * boots, a mound for the chorten, a lower one for the cairn, wind-packed drifts, and a brow a
 * dozen metres ahead where the pass falls away toward the cloud.
 */
export function shoulderHeight(x, z) {
    const ahead = Math.max(0, -z - 3);
    const brow = -0.019 * ahead * ahead - 0.0001 * ahead * ahead * ahead;
    const mound = (cx, cz, r, h) => {
        const d = Math.hypot(x - cx, z - cz) / r;
        return d >= 1 ? 0 : h * (1 - d * d) ** 2;
    };
    // The ground under the mounds does not fall away as fast: they stand on spurs.
    const spur = mound(CHORTEN.x - 1, CHORTEN.z + 2, 26, 1) * 0.62 + mound(CAIRN.x + 1, CAIRN.z + 2, 20, 1) * 0.55;
    const drifts = (valueNoise(x / 7.5 + 3.1, z / 3.4 - 1.7) - 0.5) * 0.34 + (valueNoise(x / 2.3, z / 1.3) - 0.5) * 0.09;
    return BOOTS + brow * (1 - spur)
        + mound(CHORTEN.x, CHORTEN.z, 9.5, 1.1)
        + mound(CAIRN.x, CAIRN.z, 7, 0.7)
        + mound(-17, -9, 8, 0.9)
        + drifts * Math.min(1, Math.hypot(x, z) / 2.5);
}

/**
 * The pass's height at a point: the shoulder near the viewer, the baked ground far from them.
 * @param {{ heights: Float32Array, size: number }} field
 */
export function passHeight(field, x, z) {
    const r = Math.hypot(x - EYE.x, z - EYE.z);
    const w = smooth(PASS_MARRY[0], PASS_MARRY[1], r);
    const baked = sampleField(field.heights, field.size, x, z);
    // At its rim the fine mesh dips under the baked one, so the two never fight for a pixel.
    const tuck = smooth(110, PASS_REACH, r) * 9;
    return shoulderHeight(x - EYE.x, z - EYE.z) * (1 - w) + (baked + GROUND_UNDER_SNOW * (1 - w) - tuck) * w;
}

/** Top of the chorten's spire and of the cairn's pole (design space), given the pass. */
export function anchors(field) {
    const cy = passHeight(field, EYE.x + CHORTEN.x, EYE.z + CHORTEN.z);
    const ky = passHeight(field, EYE.x + CAIRN.x, EYE.z + CAIRN.z);
    return {
        chorten: [EYE.x + CHORTEN.x, cy, EYE.z + CHORTEN.z],
        spire: [EYE.x + CHORTEN.x, cy + CHORTEN.height, EYE.z + CHORTEN.z],
        cairn: [EYE.x + CAIRN.x, ky, EYE.z + CAIRN.z],
        pole: [EYE.x + CAIRN.x, ky + 0.9 + CAIRN.pole, EYE.z + CAIRN.z],
    };
}

/** The point `depth` metres from the eye along the direction (azimuth, elevation) in radians. */
function along(azimuth, elevation, depth) {
    const c = Math.cos(elevation);
    return [EYE.x + Math.sin(azimuth) * c * depth, EYE.y + Math.sin(elevation) * depth, EYE.z - Math.cos(azimuth) * c * depth];
}

/**
 * The lines of prayer flags for an aspect ratio. Each line hangs between `a` and `b` with `sag`
 * metres of belly and carries `count` flags `size` metres wide. The lines are strung for what
 * the frame shows: one runs up out of the top-left corner, one crosses over the card, one comes
 * down to the cairn's pole from the top right, and one hangs low between spire and pole.
 * @param {{ spire: number[], pole: number[] }} at
 * @param {number} aspect
 */
export function flagLines(at, aspect) {
    const vFov = fovForAspect(aspect) * DEG;
    const hHalf = Math.atan(Math.tan(vFov / 2) * aspect);
    const top = REST_RIG.pitch + vFov / 2;
    // Upright screens are too narrow to see the anchors: the lines come in from off-frame.
    const wide = smooth(0.7, 1.3, aspect);
    const reach = Math.min(hHalf, 40 * DEG);
    const over = REST_RIG.pitch + (vFov / 2) * 0.84;
    return [
        {
            name: 'crown', a: at.spire, b: along(-reach * 1.18, top + 3 * DEG, 8.5), sag: 0.5, count: 9, size: 0.5,
        },
        {
            name: 'over', a: at.spire, b: along(reach * 1.12, over + 5 * DEG, 12 + 4 * wide), sag: 1.5, count: 26, size: 0.5,
        },
        {
            name: 'low', a: at.spire, b: at.pole, sag: 1.7, count: 22, size: 0.44,
        },
        {
            name: 'east', a: at.pole, b: along(reach * 1.2, top - 2 * DEG, 7.5), sag: 0.6, count: 11, size: 0.5,
        },
        {
            // A far line down the slope behind the chorten, small against the cloud.
            name: 'far', a: at.spire, b: along(-reach * 1.3, -1 * DEG, 46), sag: 2.6, count: 24, size: 0.44,
        },
    ];
}

/** A point on a hanging line at `s` (0..1): a parabola under the chord. */
export function linePoint(line, s, out = [0, 0, 0]) {
    for (let k = 0; k < 3; k++) out[k] = line.a[k] + (line.b[k] - line.a[k]) * s;
    out[1] -= line.sag * 4 * s * (1 - s);
    return out;
}

/**
 * Where the crests throw their snow: `count` emitters, the first third of them on the hero's
 * summit (its banner), the rest spread along every crest the eye sees against the sky. Each is
 * [x, y, z, strength 0..1, banner 0|1].
 * @param {{ heights: Float32Array, size: number }} field
 */
export function crestEmitters(field, count, seed = 4471) {
    const rand = mulberry32(seed);
    const out = [];
    const ground = (x, z) => sampleField(field.heights, field.size, x, z);
    const banner = Math.round(count * 0.34);
    for (let i = 0; i < banner; i++) {
        // Along the top of the hero, thickest at the summit.
        const t = (rand() - 0.5) * (rand() < 0.7 ? 150 : 700);
        const x = HERO_SUMMIT.x + (rand() - 0.5) * 50;
        const z = HERO_SUMMIT.z + t;
        out.push([x, ground(x, z) + 6, z, 1 - Math.min(0.6, Math.abs(t) / 900), 1]);
    }
    const crests = [];
    [['hero', 1], ['headwall', 1], ['sentinel', 1], ['hero-west', 0.7], ['tooth', 0.5]].forEach(([name, weight]) => {
        crestPoints(name, 90).forEach(([x, z]) => {
            const y = ground(x, z);
            if (y > 320) crests.push([x, y, z, weight * smooth(300, 1500, y)]);
        });
    });
    for (let i = banner; i < count && crests.length; i++) {
        // The higher crests smoke more: a few more draws for a low one.
        let c = crests[Math.floor(rand() * crests.length)];
        for (let tries = 0; tries < 4 && rand() > c[3] + 0.15; tries++) c = crests[Math.floor(rand() * crests.length)];
        const x = c[0] + (rand() - 0.5) * 80;
        const z = c[2] + (rand() - 0.5) * 80;
        out.push([x, Math.max(c[1], ground(x, z)) + 4, z, 0.35 + 0.65 * c[3] * rand(), 0]);
    }
    return out.slice(0, count);
}

/**
 * The avalanche's track: the fall line of the baked ground from under the hero's summit down
 * its east face to the cloud. Points [x, y, z, metres along].
 * @param {{ heights: Float32Array, size: number }} field
 */
export function avalancheTrack(field, steps = 64) {
    const ground = (x, z) => sampleField(field.heights, field.size, x, z);
    let x = HERO_SUMMIT.x + 420;
    let z = HERO_SUMMIT.z - 260;
    const stride = 46;
    const out = [];
    let run = 0;
    let dx = 1;
    let dz = 0;
    for (let i = 0; i < steps; i++) {
        const y = ground(x, z);
        out.push([x, y, z, run]);
        if (y < -40) break;
        const gx = (ground(x + 25, z) - ground(x - 25, z)) / 50;
        const gz = (ground(x, z + 25) - ground(x, z - 25)) / 50;
        const len = Math.hypot(gx, gz);
        // Keep some of the last heading: snow does not turn on a point.
        if (len > 1e-4) {
            dx = dx * 0.45 - (gx / len) * 0.55;
            dz = dz * 0.45 - (gz / len) * 0.55;
            const n = Math.hypot(dx, dz) || 1;
            dx /= n;
            dz /= n;
        }
        // Shorter steps where a full one would climb out of the gully; the track ends where
        // even a short one does.
        let hop = stride;
        while (hop > 6 && ground(x + dx * hop, z + dz * hop) > y + 1.5) hop *= 0.5;
        if (ground(x + dx * hop, z + dz * hop) > y + 1.5) break;
        x += dx * hop;
        z += dz * hop;
        run += hop;
    }
    // (A track needs two ends, even where the ground gives it nowhere to go.)
    if (!out.length) out.push([x, ground(x, z), z, 0]);
    if (out.length < 2) out.push([out[0][0] + 1, out[0][1] - 1, out[0][2], stride]);
    return out;
}
