/**
 * Winter — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the bake, the layout, the director and their tests import only this.
 *
 * The place (metres, y up): the viewer stands on a snowfield at the origin and looks down −Z
 * over a frozen lake to a forested shore and the fells behind it. The moon stands high on the
 * right; the last light of a polar noon lies along the horizon on the left. +X is right.
 *
 * The idea is the northern one behind the word "revontulet", fox fires: an arctic fox runs over
 * the fells and its tail sweeps sparks of snow into the sky, where they burn as the aurora.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** mulberry32: a tiny seeded [0, 1) generator. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges (either order). */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

// ── The eye ─────────────────────────────────────────────────────────────────────

/** How far over the snow the viewer's eye is. */
export const EYE_HEIGHT = 2.35;

/** The rest camera: a slight upward tilt, a held horizontal field of view. */
export const REST_RIG = Object.freeze({
    pitch: 6.5 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 76,
    minFov: 40,
    maxFov: 70,
    near: 0.25,
    far: 40000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Half the horizontal field of view (radians) the frame really shows at an aspect. */
export function halfWidthFor(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    return Math.atan(Math.tan((fovForAspect(a) * DEG) / 2) * a);
}

/**
 * What the frame holds is laid out in fractions of its half width, so an upright screen keeps
 * the moon, the framing trees and the fox: this is the bearing (radians, + right) a fraction
 * stands at. Wide screens stop spreading at the planned 38°.
 */
export function bearingFor(fraction, aspect) {
    const half = Math.min(38 * DEG, Math.max(15 * DEG, halfWidthFor(aspect)));
    return Math.atan(fraction * Math.tan(half));
}

// ── The moon and the last light ─────────────────────────────────────────────────

/** The moon: a fraction of the half width to the right, well up, and far larger than life. */
export const MOON = Object.freeze({
    fraction: 0.8,
    elevation: 22.5 * DEG,
    radius: 2.5 * DEG,
    /** The ring of ice-light stands 22° from it, as it does. */
    halo: 22 * DEG,
});

/** Unit vector toward the moon for an aspect. */
export function moonDirection(aspect, out = [0, 0, 0]) {
    const az = bearingFor(MOON.fraction, aspect);
    const c = Math.cos(MOON.elevation);
    out[0] = Math.sin(az) * c;
    out[1] = Math.sin(MOON.elevation);
    out[2] = -Math.cos(az) * c;
    return out;
}

/** The bearing the twilight glows from (a fraction of the half width, to the left). */
export const GLOW_FRACTION = -0.62;

/** Unit vector (on the ground) toward the middle of the twilight glow. */
export function glowDirection(aspect, out = [0, 0]) {
    const az = bearingFor(GLOW_FRACTION, aspect);
    out[0] = Math.sin(az);
    out[1] = -Math.cos(az);
    return out;
}

// ── The ground ──────────────────────────────────────────────────────────────────

/** The lake's ice lies this far under the snow the viewer stands on. */
export const LAKE_Y = -0.9;

function lattice(ix, iz) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
export function valueNoise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sz;
}

/** Fractal value noise in about −1..1. */
export function fbm(x, z, octaves = 4) {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
        sum += (valueNoise(x * f + o * 17.3, z * f - o * 9.1) - 0.5) * 2 * amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum;
}

/** The fells behind the far shore: [x, z, radius, height], rounded as Lapland's are. */
export const FELLS = Object.freeze([
    // The hero: a broad twin-topped fell left of the board.
    [-1050, -2900, 1150, 560],
    [-520, -3300, 900, 430],
    [-1900, -2500, 900, 330],
    // Behind the board the land stays low: a saddle.
    [150, -4200, 1500, 300],
    // Under the moon: a long back that climbs to the right.
    [1250, -2700, 1000, 380],
    [2100, -2300, 950, 470],
    [650, -3600, 800, 250],
    // The far range, pale in the air.
    [-2600, -6200, 2100, 720],
    [300, -7000, 2600, 620],
    [3300, -6000, 2200, 800],
]);

/** Signed distance to the far shore along z: the lake ends about here. */
const farShore = (x) => -235 - 34 * Math.sin(x * 0.0061 + 1.1) - 13 * Math.sin(x * 0.021 + 0.4);
/** ... and to the near one, where the viewer's snowfield slopes down to the ice. */
const nearShore = (x) => -25.5 - 5 * Math.sin(x * 0.043 + 0.6) - 2.6 * Math.sin(x * 0.11 + 2.1) - 0.0016 * x * x;

/** Spits and islets that reach into the lake: [x, z, radius along x, radius along z, turn, rise]. */
export const SPITS = Object.freeze([
    [-66, -58, 40, 17, 0.22, 2.4],
    [64, -72, 37, 15, -0.28, 2.0],
    [-44, -146, 26, 9, 0.1, 1.3],
    [118, -150, 46, 16, -0.12, 2.2],
    [-150, -118, 52, 20, 0.3, 2.6],
]);

/**
 * About how many metres inland a point is (negative on the lake's ice). Not a true distance,
 * but monotonic through the shore, which is all the ground and the layout ask of it.
 */
export function landDistance(x, z) {
    let land = Math.max(z - nearShore(x), farShore(x) - z, Math.abs(x) - (205 + 22 * Math.sin(z * 0.011 + 0.5)));
    for (let i = 0; i < SPITS.length; i++) {
        const s = SPITS[i];
        const c = Math.cos(s[4]);
        const n = Math.sin(s[4]);
        const dx = x - s[0];
        const dz = z - s[1];
        const u = (dx * c + dz * n) / s[2];
        const v = (-dx * n + dz * c) / s[3];
        const inside = (1 - Math.sqrt(u * u + v * v)) * Math.min(s[2], s[3]);
        if (inside > land) land = inside;
    }
    return land + (valueNoise(x * 0.09 + 11, z * 0.09 - 5) - 0.5) * 3.2;
}

/** 1 on the lake's ice, 0 on land, soft through the shore's drifted bank. */
export function lakeMask(x, z) {
    return smooth(0.6, -1.4, landDistance(x, z));
}

function rawHeightOn(x, z, land) {
    if (land <= -1.4) return LAKE_Y;
    // The bank: a drift that climbs out of the ice and then lies nearly level.
    let h = LAKE_Y + 0.95 * smooth(-1.4, 7, land) + 0.012 * Math.min(Math.max(land, 0), 60);
    const inland = smooth(0, 14, land);
    // Wind-laid drifts: long backs across the wind with shorter ones riding them.
    h += inland * (0.26 * Math.sin(x * 0.115 + 1.3 + 0.6 * Math.sin(z * 0.07)) * Math.sin(z * 0.094 + 0.4)
        + 0.3 * fbm(x * 0.045, z * 0.045, 3));
    // The spits stand a little prouder than the shore.
    for (let i = 0; i < SPITS.length; i++) {
        const s = SPITS[i];
        const c = Math.cos(s[4]);
        const n = Math.sin(s[4]);
        const dx = x - s[0];
        const dz = z - s[1];
        const u = (dx * c + dz * n) / s[2];
        const v = (-dx * n + dz * c) / s[3];
        const r2 = u * u + v * v;
        if (r2 < 1) h += s[5] * (1 - r2) * (1 - r2);
    }
    // Behind the far shore the land climbs into the fells.
    const back = farShore(x) - z;
    if (back > 0) {
        h += 26 * smooth(0, 900, back) + 0.012 * back;
        let fell = 0;
        for (let i = 0; i < FELLS.length; i++) {
            const f = FELLS[i];
            const dx = (x - f[0]) / f[2];
            const dz = (z - f[1]) / f[2];
            const r2 = dx * dx + dz * dz;
            if (r2 < 6) fell += f[3] * Math.exp(-r2 * 1.35);
        }
        // Their backs are not smooth: shoulders, hollows and the odd tor.
        const rough = 1 + 0.2 * fbm(x * 0.0013, z * 0.0013, 4) + 0.06 * fbm(x * 0.006, z * 0.006, 3);
        h += fell * 0.6 * rough * smooth(120, 900, back);
    }
    // To the sides the banks rise into wooded ground.
    const side = Math.abs(x) - 205;
    if (side > 0) h += 9 * smooth(0, 260, side);
    return h;
}

const rawHeight = (x, z) => rawHeightOn(x, z, landDistance(x, z));

const ORIGIN_HEIGHT = rawHeight(0, 0);

/** The height of the snow (or the ice) at a point; 0 under the viewer's boots. */
export function groundHeight(x, z) {
    return rawHeight(x, z) - ORIGIN_HEIGHT;
}

/** The same with how far inland the point is, for one evaluation of the plan: [height, inland]. */
export function groundSample(x, z, out = [0, 0]) {
    const land = landDistance(x, z);
    out[0] = rawHeightOn(x, z, land) - ORIGIN_HEIGHT;
    out[1] = land;
    return out;
}

/** The height of the lake's ice in the same frame. */
export const ICE_Y = LAKE_Y - ORIGIN_HEIGHT;

/** Where the viewer's eye is. */
export const EYE = Object.freeze({ x: 0, y: EYE_HEIGHT, z: 0 });

/** The ground's unit normal at a point (finite differences of the height). */
export function groundNormal(x, z, eps = 0.25, out = [0, 1, 0]) {
    const hx = groundHeight(x + eps, z) - groundHeight(x - eps, z);
    const hz = groundHeight(x, z + eps) - groundHeight(x, z - eps);
    const nx = -hx / (2 * eps);
    const nz = -hz / (2 * eps);
    const len = Math.hypot(nx, 1, nz);
    out[0] = nx / len;
    out[1] = 1 / len;
    out[2] = nz / len;
    return out;
}

// ── The trees ───────────────────────────────────────────────────────────────────

/**
 * The trees that frame the picture, in fractions of the half width so every screen keeps them:
 * [fraction, metres from the eye, height (m), kind, turn]. Kinds are the baked ghosts
 * (winter-ghosts.js): sentinel, matron, leaner, gnome, twins.
 */
export const FRAME_TREES = Object.freeze([
    // Left: the great sentinel, running out of the top of the frame, and its company.
    [-0.86, 16, 11.5, 'sentinel', 0.4],
    [-1.13, 12.5, 9.5, 'matron', 2.1],
    [-0.56, 27, 7.4, 'leaner', 4.4],
    [-0.7, 28, 8.6, 'matron', 1.2],
    [-0.36, 25.5, 2.4, 'gnome', 0.3],
    [-0.44, 23.5, 1.5, 'twins', 2.5],
    [-0.27, 29, 1.9, 'gnome', 3.3],
    // Right: a stand under the moon, one bowed top reaching up to it.
    [1.0, 13, 10.8, 'leaner', 0.9],
    [0.76, 23, 9.6, 'sentinel', 3.6],
    [0.6, 28.5, 7.0, 'matron', 5.1],
    [1.14, 20, 9.0, 'sentinel', 2.2],
    [0.5, 25, 1.6, 'gnome', 5.6],
    [0.68, 22, 2.2, 'twins', 1.1],
    [0.9, 17.5, 2.5, 'gnome', 4.0],
]);

/** A framing tree nearer than this (metres) is drawn as the full ghost. */
export const FULL_GHOST_WITHIN = 21;

/**
 * Every tree for an aspect: the framing ones (`frame`), the stands on the spits, and the wood
 * on the far shore. `lod` 0 = the full ghost (framing trees close by), 1 = framing trees
 * further off, 2 = the spits, 3 = the far shore.
 * @returns {{ x: number, y: number, z: number, height: number, kind: string, turn: number, lod: number,
 *             frame: boolean }[]}
 */
export function plantTrees(aspect, { mid = 70, far = 420, seed = 0x51a7 } = {}) {
    const trees = [];
    FRAME_TREES.forEach(([fraction, dist, height, kind, turn]) => {
        const az = bearingFor(fraction, aspect);
        const x = Math.sin(az) * dist;
        const z = -Math.cos(az) * dist;
        trees.push({
            x, y: groundHeight(x, z), z, height, kind, turn, lod: dist > FULL_GHOST_WITHIN ? 1 : 0, frame: true,
        });
    });
    const rand = mulberry32(seed);
    const kinds = ['sentinel', 'matron', 'leaner'];
    // The stands on the spits and along the near banks.
    let tries = 0;
    while (trees.length < FRAME_TREES.length + mid && tries < mid * 60) {
        tries += 1;
        const s = SPITS[Math.floor(rand() * SPITS.length)];
        const a = rand() * TAU;
        const r = Math.sqrt(rand()) * 0.86;
        const c = Math.cos(s[4]);
        const n = Math.sin(s[4]);
        const u = Math.cos(a) * r * s[2];
        const v = Math.sin(a) * r * s[3];
        const x = s[0] + u * c - v * n;
        const z = s[1] + u * n + v * c;
        if (landDistance(x, z) < 2.5) continue;
        // (Not on top of one another.)
        let clear = true;
        for (let i = FRAME_TREES.length; i < trees.length && clear; i++) {
            if (Math.hypot(trees[i].x - x, trees[i].z - z) < 3.4) clear = false;
        }
        if (!clear) continue;
        trees.push({
            x,
            y: groundHeight(x, z),
            z,
            height: 5.5 + rand() * rand() * 7.5,
            kind: kinds[Math.floor(rand() * 3)],
            turn: rand() * TAU,
            lod: 2,
            frame: false,
        });
    }
    // The wood on the far shore, thinning as it climbs: fells are bare above the tree line.
    tries = 0;
    const start = trees.length;
    while (trees.length < start + far && tries < far * 80) {
        tries += 1;
        // Most of them make the tree line along the shore; the rest climb behind it.
        const depth = rand() < 0.55 ? rand() * 0.09 : rand() ** 1.5;
        const x = (rand() * 2 - 1) * (300 + depth * 800);
        const z = farShore(x) - 3 - depth * 760;
        const y = groundHeight(x, z);
        const keep = 1 - smooth(18, 70, y) - depth * 0.3;
        if (rand() > keep) continue;
        // (Behind the bearing the frame can show, nobody would see them.)
        if (Math.abs(Math.atan2(x, -z)) > 50 * DEG) continue;
        trees.push({
            x,
            y,
            z,
            height: (8 + rand() * 9) * (1 - smooth(10, 70, y) * 0.5),
            kind: kinds[Math.floor(rand() * 3)],
            turn: rand() * TAU,
            lod: 3,
            frame: false,
        });
    }
    return trees;
}

// ── The fox ─────────────────────────────────────────────────────────────────────

/** The fox is drawn this much larger than life, so it reads at the distance it keeps. */
export const FOX_SCALE = 1.5;

/**
 * The fox's round over the snowfield: [fraction of the half width, metres from the eye]. It
 * passes both open sides of the board and crosses below it, never behind a framing tree.
 */
export const FOX_ROUND = Object.freeze([
    [-0.74, 12.6], [-0.6, 11.4], [-0.3, 10.2], [0, 9.8], [0.3, 10.2], [0.62, 11.4],
    [0.78, 13.6], [0.6, 17], [0.25, 20], [-0.2, 20.5], [-0.58, 17.5],
]);

/** Where along the round (index into FOX_ROUND) the fox likes to stop. */
export const FOX_STATIONS = Object.freeze([1, 5]);

/**
 * The round as a closed Catmull-Rom curve on the ground for an aspect, sampled evenly by
 * distance.
 * @returns {{ points: Float32Array, length: number, count: number, stations: number[] }}
 *   points = count × (x, z, heading); stations = distance along the round of each stop
 */
export function foxRound(aspect, count = 256) {
    // An upright screen's board hides the middle of the snowfield: the round is drawn in under
    // the board's foot there, where the snow shows.
    const pull = 0.62 + 0.38 * smooth(0.75, 1.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const knots = FOX_ROUND.map(([fraction, dist]) => {
        const az = bearingFor(fraction, aspect);
        return [Math.sin(az) * dist * pull, -Math.cos(az) * dist * pull];
    });
    const n = knots.length;
    const fine = n * 24;
    const raw = new Float32Array((fine + 1) * 2);
    const cumulative = new Float32Array(fine + 1);
    for (let i = 0; i <= fine; i++) {
        const f = (i / fine) * n;
        const k = Math.floor(f) % n;
        const t = f - Math.floor(f);
        const p0 = knots[(k + n - 1) % n];
        const p1 = knots[k];
        const p2 = knots[(k + 1) % n];
        const p3 = knots[(k + 2) % n];
        for (let c = 0; c < 2; c++) {
            raw[i * 2 + c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t
                + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t
                + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t * t * t);
        }
        if (i > 0) {
            cumulative[i] = cumulative[i - 1] + Math.hypot(raw[i * 2] - raw[i * 2 - 2], raw[i * 2 + 1] - raw[i * 2 - 1]);
        }
    }
    const length = cumulative[fine];
    const points = new Float32Array(count * 3);
    let j = 0;
    for (let i = 0; i < count; i++) {
        const d = (i / count) * length;
        while (j < fine - 1 && cumulative[j + 1] < d) j += 1;
        const span = Math.max(1e-6, cumulative[j + 1] - cumulative[j]);
        const t = (d - cumulative[j]) / span;
        points[i * 3] = raw[j * 2] + (raw[j * 2 + 2] - raw[j * 2]) * t;
        points[i * 3 + 1] = raw[j * 2 + 1] + (raw[j * 2 + 3] - raw[j * 2 + 1]) * t;
    }
    for (let i = 0; i < count; i++) {
        const a = ((i + count - 1) % count) * 3;
        const b = ((i + 1) % count) * 3;
        points[i * 3 + 2] = Math.atan2(points[b] - points[a], points[b + 1] - points[a + 1]);
    }
    const stations = FOX_STATIONS.map((k) => cumulative[k * 24]);
    return {
        points, length, count, stations,
    };
}

/** The fox's place `distance` metres along its round: (x, z, heading). */
export function foxAt(round, distance, out = [0, 0, 0]) {
    const { points, length, count } = round;
    const f = ((((distance % length) + length) % length) / length) * count;
    const i = Math.floor(f) % count;
    const k = (i + 1) % count;
    const t = f - Math.floor(f);
    out[0] = points[i * 3] + (points[k * 3] - points[i * 3]) * t;
    out[1] = points[i * 3 + 1] + (points[k * 3 + 1] - points[i * 3 + 1]) * t;
    // (Headings wrap: take the short way round.)
    let dh = points[k * 3 + 2] - points[i * 3 + 2];
    if (dh > Math.PI) dh -= TAU;
    if (dh < -Math.PI) dh += TAU;
    out[2] = points[i * 3 + 2] + dh * t;
    return out;
}

// ── Gameplay slots and timings ──────────────────────────────────────────────────

/** Rings of lifted powder on the snow evaluated by its material. */
export const RING_SLOTS = 4;
export const RING_REACH = 15;
export const RING_TAU = 0.62;
export const RING_FADE = 1.05;
/** Metres a second a ring's front runs at its start: when it reaches the fox. */
export const RING_SPEED = RING_REACH / RING_TAU;

/** Gusts that cross the snowfield at once: a clear sends one out from under the board. */
export const GUST_SLOTS = 3;
export const GUST_SPEED = 30;

/** Colours the sky can be holding at once, and how long one lasts (seconds to 1/e). */
export const SKY_SLOTS = 6;
export const SKY_HOLD = 22;
/** Seconds a spark takes from the snow to the sky. */
export const SPARK_RISE = 2.6;

/** Seconds a four-line clear holds the night's breath before the sky opens. */
export const HUSH_HOLD = 0.22;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 4.2;
/** Seconds the fox of light takes to cross the sky. */
export const SPIRIT_RUN = 7.5;

/** The wind (m/s, +X is downwind) at rest; gusts and the chain raise it. */
export const WIND = Object.freeze({ x: 1.5, y: 0, z: 0.35 });

/** Radius of a powder ring `age` seconds after the lock. */
export function ringRadius(age, reach = 1) {
    return age <= 0 ? 0 : RING_REACH * reach * (1 - Math.exp(-age / RING_TAU));
}

/** Seconds a ring takes to reach a point `distance` metres from where it began (∞ if never). */
export function ringArrival(distance, reach = 1) {
    const k = distance / (RING_REACH * reach);
    return k >= 0.98 ? Infinity : -RING_TAU * Math.log(1 - k);
}

/** How brightly the fires burn for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.2) : 0;
}

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** An sRGB hex as scene-linear [r, g, b]. */
export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/** A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]. */
export function pieceColor(value, fallback = 0x5df2a6) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pale piece colours wash out as light: push them toward their own hue, and keep a floor in
    // every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.6) / (1 - lo * 0.6);
        return pushed * 0.94 + 0.06;
    });
}

/** The fires' own colours, for sparks nobody's piece coloured: green, ice, violet, rose. */
export const FOX_FIRE = Object.freeze([
    linRGB(0x4dffa6), linRGB(0x8fe9ff), linRGB(0xb79bff), linRGB(0xff9ccf),
]);

/**
 * The hours of the polar day, one per level (cycled), all scene-linear. Each hour has two ends:
 * `calm` is the twilight at rest and `lit` is the night the fires make of it (the chain at full
 * charge); the world mixes them by the charge.
 *
 *   zenith    the top of the sky            band     the sky a hand above the horizon
 *   glow      the last light on the horizon haze     the horizon away from it
 *   moon      the moon's light              shade    the light in the shadows
 *   fire      the aurora's foot             crown    the aurora's top
 *   stars     how many stars show (0..1)
 *
 * The fires' green keeps to the one this project measured against photographs of the real
 * thing (hue about 134-145 degrees: between [0.04, 1, 0.26] and [0.03, 1, 0.52], the palette
 * the Odyssey's planet aurora also carries); each hour leans within that range, no further.
 */
const light = (zenith, band, glow, haze, moon, shade, fire, crown, stars) => ({
    zenith, band, glow, haze, moon, shade, fire, crown, stars,
});

export const HOURS = Object.freeze([
    {
        name: 'kaamos',
        calm: light(
            [0.035, 0.09, 0.3],
            [0.1, 0.4, 0.46],
            [1.05, 0.5, 0.46],
            [0.4, 0.42, 0.66],
            [1.05, 1.12, 1.4],
            [0.17, 0.25, 0.5],
            [0.05, 1.0, 0.44],
            [0.3, 0.42, 1.0],
            0.35,
        ),
        lit: light(
            [0.004, 0.012, 0.055],
            [0.012, 0.07, 0.12],
            [0.46, 0.15, 0.3],
            [0.06, 0.09, 0.22],
            [0.8, 0.9, 1.25],
            [0.05, 0.09, 0.21],
            [0.04, 1.0, 0.32],
            [0.6, 0.22, 0.95],
            1,
        ),
    },
    {
        name: 'rose-noon',
        calm: light(
            [0.07, 0.11, 0.34],
            [0.36, 0.34, 0.56],
            [1.25, 0.62, 0.4],
            [0.6, 0.44, 0.62],
            [1.1, 1.05, 1.2],
            [0.22, 0.24, 0.48],
            [0.05, 1.0, 0.5],
            [1.0, 0.4, 0.7],
            0.2,
        ),
        lit: light(
            [0.008, 0.012, 0.06],
            [0.07, 0.05, 0.14],
            [0.62, 0.2, 0.24],
            [0.1, 0.08, 0.2],
            [0.85, 0.85, 1.15],
            [0.07, 0.08, 0.2],
            [0.04, 1.0, 0.36],
            [1.0, 0.25, 0.6],
            0.9,
        ),
    },
    {
        name: 'blue-hour',
        calm: light(
            [0.02, 0.06, 0.26],
            [0.07, 0.2, 0.5],
            [0.5, 0.42, 0.72],
            [0.2, 0.3, 0.62],
            [1.0, 1.15, 1.5],
            [0.12, 0.2, 0.5],
            [0.03, 1.0, 0.52],
            [0.3, 0.3, 1.0],
            0.6,
        ),
        lit: light(
            [0.003, 0.009, 0.05],
            [0.01, 0.04, 0.13],
            [0.2, 0.14, 0.4],
            [0.04, 0.07, 0.2],
            [0.8, 0.95, 1.35],
            [0.04, 0.08, 0.22],
            [0.03, 1.0, 0.48],
            [0.35, 0.2, 1.0],
            1,
        ),
    },
    {
        name: 'violet-dusk',
        calm: light(
            [0.05, 0.05, 0.26],
            [0.26, 0.2, 0.52],
            [1.0, 0.36, 0.62],
            [0.44, 0.3, 0.62],
            [1.05, 1.0, 1.3],
            [0.2, 0.19, 0.48],
            [0.05, 1.0, 0.4],
            [1.0, 0.25, 0.9],
            0.45,
        ),
        lit: light(
            [0.008, 0.006, 0.05],
            [0.05, 0.025, 0.13],
            [0.5, 0.1, 0.36],
            [0.08, 0.05, 0.2],
            [0.85, 0.82, 1.2],
            [0.07, 0.06, 0.2],
            [0.04, 1.0, 0.3],
            [1.0, 0.15, 0.85],
            1,
        ),
    },
    {
        name: 'deep-night',
        calm: light(
            [0.006, 0.016, 0.075],
            [0.014, 0.07, 0.14],
            [0.3, 0.16, 0.34],
            [0.05, 0.09, 0.22],
            [0.9, 1.0, 1.4],
            [0.06, 0.1, 0.24],
            [0.04, 1.0, 0.3],
            [0.45, 0.3, 1.0],
            1,
        ),
        lit: light(
            [0.002, 0.006, 0.03],
            [0.006, 0.035, 0.08],
            [0.2, 0.08, 0.26],
            [0.025, 0.05, 0.14],
            [0.8, 0.9, 1.3],
            [0.035, 0.07, 0.17],
            [0.04, 1.0, 0.26],
            [0.7, 0.2, 1.0],
            1,
        ),
    },
]);

export const HOUR_KEYS = Object.freeze(['zenith', 'band', 'glow', 'haze', 'moon', 'shade', 'fire', 'crown']);

/**
 * The hours do not wait for a level: they also turn by the clock alone. An hour rests for the
 * first part of its period, then melts into the next over the rest of it, so a long spell on
 * one level still moves through the whole polar day (five hours in eight minutes). A level is
 * one step on top of wherever the clock has brought the sky.
 */
export const HOUR_PERIOD = 96;
/** The share of its period an hour rests before it begins to turn. */
export const HOUR_REST = 0.3;

/**
 * How far the clock alone has turned the hours at `time` (seconds), in hours: a whole number
 * while one rests, easing to the next whole number as it melts. A function of the time and
 * nothing else, so a seek and a replay agree at any frame rate.
 */
export function hourDrift(time) {
    const t = Math.max(0, Number.isFinite(time) ? time : 0) / HOUR_PERIOD;
    const whole = Math.floor(t);
    const k = clamp01((t - whole - HOUR_REST) / (1 - HOUR_REST));
    return whole + k * k * k * (k * (k * 6 - 15) + 10);
}

/**
 * The sky's colours `phase` hours into the polar day (any real number: the day comes round),
 * mixed between the hour's calm and lit ends by `heat` (0..1). Fills `out[key]` for every key
 * of HOUR_KEYS and returns how many stars show.
 */
export function hourAt(phase, heat, out) {
    const n = HOURS.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    const i = Math.floor(p) % n;
    const f = p - Math.floor(p);
    const a = HOURS[i];
    const b = HOURS[(i + 1) % n];
    const w = smooth(0, 1, heat);
    for (let k = 0; k < HOUR_KEYS.length; k++) {
        const key = HOUR_KEYS[k];
        for (let c = 0; c < 3; c++) {
            const from = a.calm[key][c] + (a.lit[key][c] - a.calm[key][c]) * w;
            const to = b.calm[key][c] + (b.lit[key][c] - b.calm[key][c]) * w;
            out[key][c] = from + (to - from) * f;
        }
    }
    const from = a.calm.stars + (a.lit.stars - a.calm.stars) * w;
    const to = b.calm.stars + (b.lit.stars - b.calm.stars) * w;
    return from + (to - from) * f;
}

/** The name of the hour a phase is nearest. */
export function hourName(phase) {
    const n = HOURS.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    return HOURS[Math.round(p) % n].name;
}

/**
 * The count of hours nearest `from` that shows the same hour as `wanted`: the day is a circle,
 * so the sky turns to a new level's hour the short way round.
 */
export function nearestTurn(from, wanted, n = HOURS.length) {
    return wanted + n * Math.round((from - wanted) / n);
}
