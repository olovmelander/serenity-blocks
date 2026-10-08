/**
 * Himalayan Peak — the plan of the amphitheatre (CPU only, three-free).
 *
 * The mountains are drawn as their crest lines. A ridge is a polyline of crest points; the
 * ground falls away from it on both sides along a concave profile, and the fall line carries
 * ribs and gullies that are a function of the distance ALONG the crest, so buttresses and
 * couloirs run straight down the faces the way they do on a real wall. The amphitheatre is the
 * highest of all the ridges at each point, bent by a slow warp and roughened by ridged noise.
 *
 * `scripts/himalayan-peak/bake-massif.mjs` evaluates this plan on the theme's grid, erodes it
 * and writes `assets/massif.png`. The theme never evaluates the plan at full size: it reads the
 * baked heights and uses the plan only for what the bake does not change (where the crests run).
 *
 * Compass, as the viewer sees it: −Z is ahead (north), +X is right (east). The sun rises in the
 * north-east, behind the headwall.
 */

import { EYE, EYE_HEIGHT, GRID } from './himalayan-peak-core.js';

/** The baked ground under the eye lies this far under the pass's own, finer snow. */
export const GROUND_UNDER_SNOW = 3;

/** The floor of the basins, far under the cloud sea. */
export const BASIN_FLOOR = -460;

/**
 * The ridges. `pts` are crest points [x, y, z]; `l` / `r` are the faces to the left and right of
 * someone walking the crest from its first point to its last: how far the face runs out (metres)
 * and how concave it is (1 = a straight slope, 2 = a wall that eases into an apron). `ribs` =
 * [spacing, depth 0..1]; `crest` = how much the crest line itself is notched (metres).
 */
export const RIDGES = Object.freeze([
    {
        // The hero: a great wall running north to south with its summit near the south end. Its
        // east face (the left of this walk) looks out over the basin, straight at the sunrise.
        name: 'hero',
        pts: [
            [-2750, 1500, -11300], [-3000, 1950, -10450], [-3270, 2330, -9600], [-3530, 2640, -8760],
            [-3720, 2900, -8080], [-3840, 3120, -7640], [-3900, 3290, -7330], [-3950, 3050, -7080],
            [-4010, 2700, -6700], [-4140, 2330, -6200], [-4330, 1950, -5650], [-4620, 1560, -5050],
            [-5020, 1200, -4400], [-5540, 900, -3760], [-6200, 700, -3150], [-7000, 620, -2600],
            [-7700, 700, -2100],
        ],
        l: { width: 3500, power: 1.95 },
        r: { width: 2600, power: 1.6 },
        ribs: [430, 0.34],
        crest: 70,
    },
    {
        // The hero's hidden north-west arm: the skyline to the left of the summit.
        name: 'hero-west',
        pts: [
            [-3930, 3120, -7620], [-4500, 2650, -7900], [-5200, 2300, -8300], [-6000, 2050, -8800],
            [-6900, 2250, -9300], [-7600, 1900, -9900],
        ],
        l: { width: 2200, power: 1.7 },
        r: { width: 2400, power: 1.7 },
        ribs: [380, 0.3],
        crest: 90,
    },
    {
        // The headwall: the back of the amphitheatre. The sun climbs behind it and crests the
        // col at its eastern end.
        name: 'headwall',
        pts: [
            [-2750, 1500, -11300], [-2350, 1700, -12000], [-1700, 2040, -12550], [-900, 2230, -12850],
            [100, 2050, -12950], [1200, 2320, -12900], [2300, 2120, -12700], [3400, 1900, -12350],
            [4500, 1980, -11950], [5600, 1950, -11650], [6450, 1780, -11200], [7000, 2050, -10700],
            [7400, 2400, -10100], [7700, 2600, -9600],
        ],
        l: { width: 2300, power: 1.8 },
        r: { width: 3000, power: 1.9 },
        ribs: [360, 0.36],
        crest: 110,
    },
    {
        // The sentinel: the near wall on the right, always in shadow, its crest always burning.
        name: 'sentinel',
        pts: [
            [7700, 2600, -9600], [7100, 2150, -8600], [6300, 1750, -7700], [5500, 1900, -6800],
            [4900, 2250, -5900], [4650, 2480, -5150], [4750, 2200, -4400], [5100, 1750, -3600],
            [5600, 1300, -2800], [6200, 950, -2000], [6900, 760, -1200], [7700, 700, -500],
        ],
        l: { width: 2500, power: 1.7 },
        r: { width: 2900, power: 1.9 },
        ribs: [340, 0.4],
        crest: 100,
    },
    {
        // The pass the viewer stands on, between the hero's foot and the sentinel's.
        name: 'pass',
        pts: [
            [-7700, 700, -2100], [-6400, 640, -900], [-4800, 560, -150], [-3200, 470, 330],
            [-1700, 400, 300], [-700, 356, 130], [-200, EYE.y - EYE_HEIGHT + 2, 30],
            [EYE.x, EYE.y - EYE_HEIGHT, EYE.z + 6], [260, EYE.y - EYE_HEIGHT + 3, 30],
            [900, 372, 150], [2100, 430, 220], [3600, 520, 30], [5200, 620, -350], [6500, 700, -500],
            [7700, 700, -500],
        ],
        l: { width: 1500, power: 1.5 },
        r: { width: 1500, power: 1.35 },
        ribs: [260, 0.2],
        crest: 14,
    },
    {
        // Islands in the cloud sea: the tooth in front of the hero's foot...
        name: 'tooth',
        pts: [[-2500, 150, -4700], [-2150, 470, -4250], [-1950, 610, -3950], [-1700, 380, -3600], [-1300, 60, -3250]],
        l: { width: 900, power: 1.5 },
        r: { width: 900, power: 1.5 },
        ribs: [200, 0.3],
        crest: 60,
    },
    {
        // ...a spur that runs out from the hero's face toward the middle of the basin...
        name: 'spur',
        pts: [[-3200, 1250, -8300], [-2500, 760, -8000], [-1700, 480, -7800], [-900, 330, -7900], [-200, 150, -8300]],
        l: { width: 1100, power: 1.5 },
        r: { width: 1100, power: 1.5 },
        ribs: [240, 0.3],
        crest: 70,
    },
    {
        // ...and a reef under the sun, where the light lies on the cloud.
        name: 'reef',
        pts: [[2000, 120, -7300], [2700, 380, -6900], [3200, 450, -6400], [3500, 250, -5800]],
        l: { width: 800, power: 1.4 },
        r: { width: 800, power: 1.4 },
        ribs: [200, 0.3],
        crest: 60,
    },
]);

// ── Noise (seeded, CPU) ─────────────────────────────────────────────────────────

function hash2(ix, iy, seed) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [0, 1]. */
export function valueNoise(x, y, seed = 1) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
}

/** Fractal value noise in [0, 1]. */
export function fbm(x, y, octaves, seed = 1) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
        sum += valueNoise(fx, fy, seed + o * 17) * amp;
        norm += amp;
        amp *= 0.5;
        fx = fx * 2.03 + 11.7;
        fy = fy * 2.03 - 5.3;
    }
    return sum / norm;
}

/** Ridged multifractal in [0, 1]: sharp where the noise crosses its middle. */
export function ridged(x, y, octaves, seed = 1) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let prev = 1;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
        const n = 1 - Math.abs(valueNoise(fx, fy, seed + o * 31) * 2 - 1);
        const r = n * n;
        sum += r * amp * prev;
        norm += amp;
        prev = 0.35 + 0.65 * r;
        amp *= 0.5;
        fx = fx * 2.07 + 3.1;
        fy = fy * 2.07 + 7.9;
    }
    return sum / norm;
}

// ── The plan as a height ────────────────────────────────────────────────────────

/** Per-ridge data the evaluation needs, computed once. */
function prepare(ridge, index) {
    const n = ridge.pts.length;
    const along = new Float64Array(n);
    let reach = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
        const p = ridge.pts[i];
        if (i > 0) {
            const q = ridge.pts[i - 1];
            reach += Math.hypot(p[0] - q[0], p[2] - q[2]);
        }
        along[i] = reach;
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
    }
    const pad = Math.max(ridge.l.width, ridge.r.width) * 1.35;
    return {
        ridge, along, seed: 101 + index * 37, minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad,
    };
}

const PREPARED = RIDGES.map(prepare);

/** The height one ridge gives a point, or BASIN_FLOOR beyond its faces. */
function ridgeHeight(prep, x, z) {
    if (x < prep.minX || x > prep.maxX || z < prep.minZ || z > prep.maxZ) return BASIN_FLOOR;
    const { ridge, along, seed } = prep;
    const { pts } = ridge;
    let best = Infinity;
    let bestY = 0;
    let bestS = 0;
    let bestSide = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const len2 = dx * dx + dz * dz;
        let k = ((x - a[0]) * dx + (z - a[2]) * dz) / len2;
        if (k < 0) k = 0;
        else if (k > 1) k = 1;
        const px = a[0] + dx * k;
        const pz = a[2] + dz * k;
        const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (d2 < best) {
            best = d2;
            // Ease the crest's height between its points, so summits are rounded, not kinked.
            const e = k * k * (3 - 2 * k);
            bestY = a[1] + (b[1] - a[1]) * (k * 0.55 + e * 0.45);
            bestS = along[i] + (along[i + 1] - along[i]) * k;
            // Right of the walk = the walk's direction turned toward −x when it heads +z.
            bestSide = (x - px) * -dz + (z - pz) * dx;
        }
    }
    const dist = Math.sqrt(best);
    const face = bestSide > 0 ? ridge.r : ridge.l;
    // The faces breathe in and out along the crest, so no two stretches of wall are alike.
    const width = face.width * (0.78 + 0.44 * valueNoise(bestS / 2300, seed * 0.13, seed));
    let t = dist / width;
    if (t >= 1.3) return BASIN_FLOOR;
    // Ribs and gullies: a function of the distance along the crest, so they run down the fall
    // line. They vanish at the crest and at the foot of the face.
    const side = bestSide > 0 ? 7.31 : 0;
    const [spacing, depth] = ridge.ribs;
    const wander = (valueNoise(bestS / (spacing * 2.6) + side, dist / 900, seed + 5) - 0.5) * 1.7;
    const coarse = 1 - Math.abs(valueNoise(bestS / spacing + wander + side, 0.37, seed + 9) * 2 - 1);
    const fine = 1 - Math.abs(valueNoise(bestS / (spacing * 0.37) + wander * 2.1 + side, 3.3, seed + 13) * 2 - 1);
    const rib = coarse * coarse * 0.72 + fine * fine * 0.28;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.75;
    t *= 1 + depth * (0.5 - rib) * 2 * env;
    if (t >= 1) return BASIN_FLOOR;
    // The crest line is notched: gendarmes and gaps.
    const notch = (fbm(bestS / 340, seed * 0.71, 3, seed + 21) - 0.5) * 2 * ridge.crest;
    const top = bestY + notch * Math.max(0, 1 - t * 3);
    return BASIN_FLOOR + (top - BASIN_FLOOR) * (1 - t) ** face.power;
}

let eyeLift = null;

/** A smooth maximum (the crease between two ridges is a gully, not a knife cut). */
function smoothMax(a, b, k) {
    const h = Math.max(0, Math.min(1, 0.5 + (a - b) / (2 * k)));
    return b + (a - b) * h + k * h * (1 - h);
}

/**
 * The amphitheatre's height (metres) at a point, before erosion.
 * @param {number} x
 * @param {number} z
 */
export function planHeight(x, z) {
    // The ground under the eye is raised (or lowered) so the viewer stands on it, not in it.
    if (eyeLift === null) eyeLift = EYE.y - EYE_HEIGHT - GROUND_UNDER_SNOW - rawHeight(EYE.x, EYE.z);
    const t = Math.hypot(x - EYE.x, z - EYE.z) / 620;
    return rawHeight(x, z) + (t >= 1 ? 0 : eyeLift * (1 - t * t) ** 2);
}

function rawHeight(x, z) {
    // A slow warp bends every crest a little off its ruler line.
    const wx = x + (fbm(x / 2600 + 3.1, z / 2600 - 1.7, 3, 51) - 0.5) * 520;
    const wz = z + (fbm(x / 2600 - 8.3, z / 2600 + 4.9, 3, 67) - 0.5) * 520;
    let h = BASIN_FLOOR;
    for (let i = 0; i < PREPARED.length; i++) {
        // The pass under the viewer's boots is not warped: the eye must stand on it.
        const pass = PREPARED[i].ridge.name === 'pass';
        const near = pass ? Math.max(0, 1 - Math.hypot(x - EYE.x, z - EYE.z) / 700) : 0;
        const v = ridgeHeight(PREPARED[i], wx + (x - wx) * near, wz + (z - wz) * near);
        h = smoothMax(h, v, 45);
    }
    // Crags ride on the big forms: more of them high up, none on the basin floor.
    const high = Math.max(0, Math.min(1, (h - BASIN_FLOOR) / 1400));
    const calm = 1 - Math.max(0, 1 - Math.hypot(x - EYE.x, z - EYE.z) / 420);
    const crag = (ridged(x / 520, z / 520, 5, 7) - 0.32) * 170 + (fbm(x / 130, z / 130, 3, 23) - 0.5) * 34;
    const floor = (fbm(x / 1900, z / 1900, 3, 91) - 0.5) * 120;
    return h + crag * high * high * calm + floor * (1 - high);
}

/**
 * The plan sampled on a square grid.
 * @param {number} [size=GRID.size]
 * @returns {Float32Array} size × size, row by row from z0, each row from x0
 */
export function buildPlanHeights(size = GRID.size) {
    const out = new Float32Array(size * size);
    const cell = GRID.span / (size - 1);
    for (let j = 0; j < size; j++) {
        const z = GRID.z0 + j * cell;
        for (let i = 0; i < size; i++) out[j * size + i] = planHeight(GRID.x0 + i * cell, z);
    }
    return out;
}

/**
 * Points along a ridge's crest, `step` metres apart: [x, z, along] triples.
 * @param {string} name
 * @param {number} step
 */
export function crestPoints(name, step) {
    const prep = PREPARED.find((p) => p.ridge.name === name);
    if (!prep) return [];
    const { ridge, along } = prep;
    const out = [];
    const total = along[along.length - 1];
    let seg = 0;
    for (let s = 0; s <= total; s += step) {
        while (seg < along.length - 2 && along[seg + 1] < s) seg += 1;
        const k = (s - along[seg]) / Math.max(1e-6, along[seg + 1] - along[seg]);
        const a = ridge.pts[seg];
        const b = ridge.pts[seg + 1];
        out.push([a[0] + (b[0] - a[0]) * k, a[2] + (b[2] - a[2]) * k, s]);
    }
    return out;
}

/** The hero's summit as the plan draws it. */
export const HERO_SUMMIT = Object.freeze({ x: -3900, y: 3290, z: -7330 });
