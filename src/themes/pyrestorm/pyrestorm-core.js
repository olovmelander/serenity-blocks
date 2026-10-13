/**
 * Pyrestorm — renderer-free constants and maths (three-free, DOM-free).
 *
 * The world: an eye on a high tephra ridge at night, looking north across a dark lava plain to a
 * broken stratovolcano fifteen kilometres away. Its breached crater fountains fire; threads of lava
 * run down its gullies and out across the plain in braided rivers that pass below the ridge; a
 * fissure burns in a curtain of fire to the right. Above the summit the eruption column climbs
 * five kilometres and bends downwind into a pyrocumulonimbus anvil that roofs the sky, lit orange
 * from below and charged with volcanic lightning (a "dirty thunderstorm"). Metres; x right, y up,
 * z toward the eye (the view looks down −z).
 *
 * This module owns what everything shares: the eye and rest rig, the land's height functions (the
 * CPU twin of the baked mesh, also used to place events), the volcano, the fissure, the column's
 * path, the authored lava rivers, the piece codes the director deals in, timings and small maths.
 */

// ── Maths ─────────────────────────────────────────────────────────────────────────

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const clamp01 = (v) => clamp(v, 0, 1);
export const clampInt = (v, lo, hi) => Math.round(clamp(v, lo, hi));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Fraction of the way to a target after dt at an exponential rate. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Hermite step between two edges (a step at lo when the edges are equal). */
export function smooth(lo, hi, v) {
    if (hi === lo) return v < lo ? 0 : 1;
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Small, fast, deterministic PRNG (returns a function giving floats in [0, 1)). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a) {
    let x = a % TAU;
    if (x > Math.PI) x -= TAU;
    if (x <= -Math.PI) x += TAU;
    return x;
}

/** sRGB hex → linear RGB (0..1). */
export function hexToLinear(hex, out = [0, 0, 0]) {
    const s = typeof hex === 'string' ? hex.replace('#', '') : '';
    const v = s.length === 6 ? Number.parseInt(s, 16) : NaN;
    if (!Number.isFinite(v)) {
        out[0] = 1;
        out[1] = 0.45;
        out[2] = 0.12;
        return out;
    }
    const lin = (c) => {
        const x = c / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    out[0] = lin((v >> 16) & 255);
    out[1] = lin((v >> 8) & 255);
    out[2] = lin(v & 255);
    return out;
}

// ── Noise (CPU; the land is baked from these) ──────────────────────────────────────

/** Integer lattice hash → [0, 1). */
export function hash2(ix, iz, seed = 0) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [−1, 1]. */
export function vnoise(x, z, seed = 0) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed);
    const b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed);
    const d = hash2(ix + 1, iz + 1, seed);
    return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

/** fBm of value noise, roughly [−1, 1]. */
export function fbm(x, z, octaves = 4, seed = 0) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
        sum += amp * vnoise(x * f, z * f, seed + o * 31);
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum / norm;
}

/** Ridged fBm in [0, 1]: sharp crests, rounded troughs. */
export function ridged(x, z, octaves = 4, seed = 0) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
        const n = 1 - Math.abs(vnoise(x * f, z * f, seed + o * 57));
        sum += amp * n * n;
        norm += amp;
        amp *= 0.5;
        f *= 2.1;
    }
    return sum / norm;
}

// ── The view ──────────────────────────────────────────────────────────────────────

/**
 * Rest rig (degrees). Landscape looks a touch up so the column has the sky; a wide screen narrows
 * the lens. On a portrait screen the board fills the middle: the lens turns to the volcano and
 * looks DOWN so the summit, its fountain and the foot of the column stand in the strip above the
 * card (the lava runs on behind the translucent card). Between portrait and square the summit
 * goes round the card's top-left corner (first left along the top, then down the left side),
 * never across the card.
 */
export const RIG = Object.freeze({
    landscape: Object.freeze({ fov: 44, yaw: -4, pitch: 2.5 }),
    wide: Object.freeze({ fov: 36, yaw: -3, pitch: 5 }),
    /** Square-ish screens: wider, turned a little more toward the volcano. */
    square: Object.freeze({ fov: 54, yaw: -11.8, pitch: 7.9 }),
    /** Portrait: the summit centred above the card. */
    portrait: Object.freeze({ fov: 58, yaw: -23, pitch: -13.6 }),
    /** Half-way to square: still above the card, turned so the summit stands left of its edge. */
    turn: Object.freeze({ fov: 58, yaw: -12.8, pitch: -13.6 }),
    near: 4,
    far: 90000,
});

function blendRig(A, B, k, out) {
    out.fov = lerp(A.fov, B.fov, k);
    out.yaw = lerp(A.yaw, B.yaw, k);
    out.pitch = lerp(A.pitch, B.pitch, k);
    return out;
}

/** The lens for an aspect ratio (blended between the poses, so no width snaps). */
export function rigFor(aspect, out = { fov: 44, yaw: -4, pitch: 2.5 }) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const {
        landscape: L, wide: W, square: S, portrait: P, turn: T,
    } = RIG;
    if (a < 0.8) return blendRig(P, T, smooth(0.62, 0.8, a), out);
    if (a < 1.0) return blendRig(T, S, smooth(0.8, 1.0, a), out);
    if (a < 1.78) return blendRig(S, L, smooth(1.0, 1.78, a), out);
    return blendRig(L, W, smooth(1.78, 2.4, a), out);
}

// ── The land ──────────────────────────────────────────────────────────────────────

/** The stratovolcano: summit above its base, base radius, the crater, the breach. */
export const VOLCANO = Object.freeze({
    x: -5900,
    z: -13300,
    height: 3250,
    radius: 9600,
    crater: 420,
    craterDepth: 170,
    /** The breach opens toward the eye's right (+x, +z): radians in the xz plane (atan2(z, x)). */
    breach: 0.66,
    breachDepth: 430,
    breachReach: 2900,
});

/** A parasitic cone on the volcano's left flank. */
export const SATELLITE = Object.freeze({
    x: -7000, z: -8800, height: 380, radius: 1400, crater: 110,
});

/** The fissure: a line of fountains across the plain to the right (two ends, xz). */
export const FISSURE = Object.freeze({
    a: Object.freeze([2350, -6950]),
    b: Object.freeze([4500, -8650]),
    /** Ordinary fountain height (m) and the rampart's height. */
    jet: 120,
    rampart: 26,
});

/** The volcano's own relief above the plain at (x, z). */
export function volcanoHeight(x, z) {
    const V = VOLCANO;
    const dx = x - V.x;
    const dz = z - V.z;
    const r = Math.hypot(dx, dz);
    if (r >= V.radius) return 0;
    const rn = r / V.radius;
    // Concave flanks; a rounded shoulder below the summit.
    let h = V.height * (1 - rn) ** 2.05;
    const phi = Math.atan2(dz, dx);
    // Seam of every angular noise at the far side (the eye never sees it).
    const toEye = Math.atan2(-V.z, -V.x);
    const a = wrapAngle(phi - toEye);
    // Gullies: radial crests and troughs, strongest on the mid-flank.
    const gw = smooth(250, 1500, r) * (1 - smooth(5200, 9200, r));
    const g = ridged(a * 4.2 + fbm(a * 2, r / 2200, 2, 5) * 0.6, r / 2600, 3, 11) - 0.55;
    h += g * 95 * gw;
    // Broad lobes and an older shoulder: the cone is not a lathe.
    h += fbm(dx / 3800, dz / 3800, 3, 23) * 260 * smooth(0, 2000, r) * (1 - smooth(6000, 9800, r));
    // The somma: an older caldera wall on the eye's left, a steep inner face toward the young cone.
    const sommaR = 3300 + 260 * Math.sin(a * 3.1);
    const somma = Math.exp(-(((a - 1.0) / 0.55) ** 2)) * smooth(-900, -120, r - sommaR) * (1 - smooth(0, 2400, r - sommaR));
    h = Math.max(h, V.height * 0.52 * somma * (1 - (r - sommaR) / 9000) + fbm(a * 9, r / 700, 3, 61) * 70 * somma);
    // The crater: a bowl inside a lip.
    const floor = V.height * (1 - V.crater / V.radius) ** 2.05 - V.craterDepth;
    h = lerp(h, Math.min(h, floor), 1 - smooth(V.crater * 0.35, V.crater * 1.12, r));
    h += 38 * Math.exp(-(((r - V.crater) / 140) ** 2));
    // The breach: a notch cut from the crater down the flank toward the eye's right.
    const db = wrapAngle(phi - V.breach);
    const notchWidth = 0.22 + 0.25 * smooth(0, V.breachReach, r);
    const notch = Math.exp(-((db / notchWidth) ** 2)) * (1 - smooth(V.breachReach * 0.35, V.breachReach, r));
    h -= V.breachDepth * notch * smooth(0, V.crater * 0.8, r + V.crater * 0.2);
    // Rough scoria.
    h += fbm(x / 420, z / 420, 3, 41) * 22;
    // The relief fades out at the foot, where the cone meets the plain.
    return h * (1 - smooth(V.radius * 0.86, V.radius, r));
}

/** The parasitic cone. */
export function satelliteHeight(x, z) {
    const S = SATELLITE;
    const r = Math.hypot(x - S.x, z - S.z);
    if (r >= S.radius) return 0;
    const rn = r / S.radius;
    let h = S.height * (1 - rn) ** 1.5;
    h -= 70 * (1 - smooth(S.crater * 0.3, S.crater, r));
    return h;
}

/** Distance from (x, z) to the segment a→b, with the segment parameter. */
export function segmentDistance(x, z, ax, az, bx, bz, out = { d: 0, t: 0 }) {
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz || 1;
    const t = clamp01(((x - ax) * vx + (z - az) * vz) / len2);
    const px = ax + vx * t;
    const pz = az + vz * t;
    out.d = Math.hypot(x - px, z - pz);
    out.t = t;
    return out;
}

const _seg = { d: 0, t: 0 };

/** Boulders on the eye's slope: (x, z, height, radius). */
export const BOULDERS = Object.freeze([
    Object.freeze([-62, -46, 2.6, 3.4]),
    Object.freeze([48, -58, 1.8, 2.6]),
    Object.freeze([96, -120, 3.2, 4.2]),
    Object.freeze([-40, -150, 2.4, 3.6]),
    Object.freeze([150, -70, 2.2, 3.0]),
]);

/** Scoria cones on the plain: (x, z, height, radius). */
export const CONES = Object.freeze([
    Object.freeze([-2700, -5600, 85, 520]),
    Object.freeze([6100, -12400, 120, 700]),
    Object.freeze([8600, -5900, 70, 460]),
    Object.freeze([-9300, -6900, 95, 600]),
    Object.freeze([1500, -9800, 55, 380]),
]);

/** The plain, the eye's ridge, the valley the rivers follow, and the ranges on the horizon. */
export function plainHeight(x, z) {
    // The plain rises gently toward the volcano and falls to the right, where the rivers drain.
    let h = 40 + 0.0105 * Math.max(0, -z - 1500) - 0.0055 * x;
    // Old flow fields: broad swells and pressure ridges.
    h += fbm(x / 2600, z / 2600, 4, 7) * 34 + ridged(x / 900, z / 900, 3, 9) * 9;
    // The valley below the ridge, which the river follows from left to right.
    h -= 26 * Math.exp(-(((z + 2650 + 260 * Math.sin(x / 1900)) / 700) ** 2));
    // The eye's ridge: the eye stands at the brow of a long tephra slope that falls to the
    // valley; behind it the crest runs on. A gentle upper slope (seen in the frame's bottom band,
    // with boulders and a crag on its left) breaks into a steep lower one.
    const d = -z + 70 * fbm(x / 420, 1.3, 3, 19) + 0.000035 * x * x;
    const upper = 432 - 0.2 * d;
    const lower = 432 - 0.2 * 300 - 0.52 * (d - 300);
    let ridge = d < 300 ? upper : lower;
    ridge = Math.max(ridge, 0) * (1 - smooth(4800, 9000, Math.abs(x)));
    // Crags along the brow, where the gentle slope breaks (so its edge is never ruler-straight).
    ridge += ridged(x / 70, z / 70, 2, 43) * 16 * Math.exp(-(((d - 300) / 110) ** 2)) * (1 - smooth(1500, 3000, Math.abs(x)));
    // Behind the eye the crest rounds over.
    if (d < 0) ridge = 432 + 0.08 * -d - 0.00012 * d * d;
    // Soft toe where the slope meets the valley.
    ridge = Math.max(0, ridge - 40) + 40 * smooth(-40, 40, ridge - 40) * 0 + Math.min(ridge, 40) * 0.0;
    h += Math.max(0, ridge - h) * smooth(0, 140, ridge - h + 40);
    // A crag and boulders of old lava on the upper slope, rooted in it.
    const crag = Math.exp(-((((x + 120) / 34) ** 2) + (((z + 70) / 26) ** 2))) * 15
        + Math.exp(-((((x + 175) / 18) ** 2) + (((z + 52) / 16) ** 2))) * 9;
    h += crag * (0.6 + 0.4 * ridged(x / 9, z / 9, 3, 29));
    for (let i = 0; i < BOULDERS.length; i++) {
        const b = BOULDERS[i];
        const r2 = ((x - b[0]) ** 2 + (z - b[1]) ** 2) / (b[3] * b[3]);
        if (r2 < 1) h += b[2] * Math.sqrt(1 - r2);
    }
    h += fbm(x / 160, z / 160, 3, 13) * 6 * smooth(-2600, -400, z) + ridged(x / 14, z / 14, 2, 37) * 1.1 * smooth(-500, -60, z);
    // Scoria cones dotted over the plain.
    for (let i = 0; i < CONES.length; i++) {
        const c = CONES[i];
        const r = Math.hypot(x - c[0], z - c[1]);
        if (r < c[3]) {
            const k = 1 - r / c[3];
            h += c[2] * k ** 1.4 - c[2] * 0.25 * (1 - smooth(0, c[3] * 0.22, r));
        }
    }
    // The fissure's spatter rampart: a low wall along the line with a groove on its crest.
    segmentDistance(x, z, FISSURE.a[0], FISSURE.a[1], FISSURE.b[0], FISSURE.b[1], _seg);
    h += FISSURE.rampart * Math.exp(-((_seg.d / 75) ** 2)) - 14 * Math.exp(-((_seg.d / 22) ** 2));
    // Ranges on the horizon, beyond the volcano.
    const far = Math.hypot(x, z);
    const rangeW = smooth(17000, 26000, far);
    if (rangeW > 0) {
        h += rangeW * (180 + ridged(x / 5200, z / 5200, 4, 17) * 1350) * (0.6 + 0.4 * smooth(-0.6, 0.4, -z / far));
    }
    return h;
}

/** The whole land at (x, z) (what the meshes are baked from). */
export function landHeight(x, z) {
    return plainHeight(x, z) + volcanoHeight(x, z) + satelliteHeight(x, z);
}

/** The crater's vent (where the fountain and the column rise from): on the crater's floor. */
export const CRATER = Object.freeze({
    x: VOLCANO.x + 60,
    y: Math.round(landHeight(VOLCANO.x + 60, VOLCANO.z + 40) + 30),
    z: VOLCANO.z + 40,
});

/** The eye: a little above the ridge's crest. */
export const EYE = Object.freeze({ x: 0, y: Math.round(landHeight(0, 0) + 6), z: 0 });

// ── The eruption column ───────────────────────────────────────────────────────────

/**
 * The column: up from the crater, bending downwind (right and away from the eye) into the anvil.
 * `s` runs 0 (crater) → 1 (where the column flattens into the anvil). Width grows with height.
 */
export const COLUMN = Object.freeze({
    rise: 4700,
    /**
     * The wind's drift at the top (x, z), applied as s^LEAN: upright low down, bent high up. The
     * wind blows from the eye's left to its right (a little away), so the column bends across the
     * top of the frame and the anvil spreads over the right-hand sky; the left stays clear.
     */
    drift: Object.freeze([8000, -4200]),
    lean: 3.0,
    baseWidth: 850,
    topWidth: 5000,
});

/**
 * The anvil: from the column's head it runs away downwind (right and far from the eye) for some
 * sixty kilometres, widening, so in perspective it roofs the right-hand sky from the top of the
 * frame down to the far horizon. Its base, thickness, centre (xz), half-lengths along and across
 * its run, and the run's heading (radians in the xz plane).
 */
export const ANVIL = Object.freeze({
    base: 7300,
    thick: 1700,
    x: 16600,
    z: -43900,
    along: 32000,
    across: 17000,
    heading: Math.atan2(-0.88, 0.48),
});

/** A point on the column's axis at s (0 crater … 1 anvil). */
export function columnPoint(s, out = [0, 0, 0]) {
    const k = clamp01(s);
    const lean = k ** COLUMN.lean;
    out[0] = CRATER.x + COLUMN.drift[0] * lean + 180 * Math.sin(k * 4.1);
    out[1] = CRATER.y + 80 + COLUMN.rise * (1 - (1 - k) ** 1.25);
    out[2] = CRATER.z + COLUMN.drift[1] * lean;
    return out;
}

export function columnWidth(s) {
    const k = clamp01(s);
    return lerp(COLUMN.baseWidth, COLUMN.topWidth, k ** 1.15);
}

// ── The lava rivers (authored; the bake meanders, braids and rasterises them) ─────────

/**
 * Each river: control points (x, z) from source to mouth, half-width (m) at source and mouth, the
 * heat at its source (1 = fresh from the vent), how fast it cools (per km), and how far it is
 * allowed to meander (m). Braids split from their parent between two fractions of its length and
 * rejoin it.
 */
export const RIVERS = Object.freeze([
    // The main river, out of the breach, down the plain left of the card and off along the valley.
    Object.freeze({
        id: 'main',
        points: [[-3650, -11500], [-3150, -10200], [-2950, -8800], [-2350, -7100], [-1850, -5500], [-1450, -4100],
            [-1150, -2900], [-800, -1900], [-650, -1350], [-1000, -1100], [-1700, -1180], [-3000, -1550], [-4800, -1900],
            [-6800, -2100]],
        width: [34, 96],
        heat: 1,
        cool: 0.055,
        meander: 170,
    }),
    // The fissure's flow, toward the eye on the right, then off along the valley.
    Object.freeze({
        id: 'fissure',
        points: [[3350, -7750], [2950, -6700], [2450, -5700], [2150, -4700], [1850, -3700], [1500, -2800], [950, -1900],
            [650, -1400], [950, -1120], [1800, -1200], [3300, -1550], [5600, -1950], [8000, -2100]],
        width: [44, 70],
        heat: 0.98,
        cool: 0.06,
        meander: 140,
    }),
    // An older arm on the left, cooling as it spreads.
    Object.freeze({
        id: 'west',
        points: [[-2700, -8000], [-3900, -7100], [-4700, -5900], [-5100, -4600], [-6200, -3500], [-8400, -2800]],
        width: [26, 60],
        heat: 0.82,
        cool: 0.12,
        meander: 160,
    }),
    // A short tongue from the satellite cone.
    Object.freeze({
        id: 'satellite',
        points: [[-6900, -8350], [-6550, -7300], [-6950, -6200], [-6750, -5200]],
        width: [18, 34],
        heat: 0.78,
        cool: 0.2,
        meander: 110,
    }),
]);

/** Braids: (parent id, from fraction, to fraction, side ±1, how far out (m), half-width). */
export const BRAIDS = Object.freeze([
    Object.freeze({
        parent: 'main', from: 0.18, to: 0.32, side: 1, out: 420, width: 26,
    }),
    Object.freeze({
        parent: 'main', from: 0.3, to: 0.45, side: -1, out: 330, width: 28,
    }),
    Object.freeze({
        parent: 'main', from: 0.52, to: 0.68, side: 1, out: 260, width: 30,
    }),
    Object.freeze({
        parent: 'main', from: 0.72, to: 0.9, side: -1, out: 300, width: 28,
    }),
    Object.freeze({
        parent: 'fissure', from: 0.2, to: 0.62, side: 1, out: 300, width: 24,
    }),
    Object.freeze({
        parent: 'west', from: 0.3, to: 0.75, side: 1, out: 330, width: 18,
    }),
]);

/** Flank streams down the cone: how many, and their bearings' spread around the breach (rad). */
export const FLANK = Object.freeze({
    streams: 9,
    /** Bearings relative to the breach (radians); the lava spills down gullies on both sides. */
    spread: 1.35,
    width: [9, 22],
});

// ── Pieces ────────────────────────────────────────────────────────────────────────

export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
/** The board's piece colours by code (pyrestorm-tetrominos.js carries the same table). */
export const PIECE_COLORS = Object.freeze(['#C9B5FF', '#FF6A1F', '#2673E6', '#EDE6DA', '#C21E3A', '#33B07A', '#F4C430', '#2B2422']);

export function pieceCode(shape) {
    if (typeof shape !== 'string') return PIECE_CODE.GARBAGE;
    const key = shape.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(PIECE_CODE, key) ? PIECE_CODE[key] : PIECE_CODE.GARBAGE;
}

/**
 * A piece matrix as 4 cell offsets (8 numbers, x right, y up), centred on its bounding box.
 * Returns null for anything that is not a matrix with at least one filled cell.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

/** The pieces in their spawn orientation (the game's own matrices). */
export const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
});
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

/**
 * A piece's colour as fire: incandescence keeps its own temperature and takes a quarter of the
 * piece's hue, so a blue piece throws violet-white bombs, never plastic blue ones.
 */
export function fireTint(rgb, out = [0, 0, 0], toward = 0.32) {
    const base = [1, 0.36, 0.08];
    const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    for (let c = 0; c < 3; c++) out[c] = lerp(base[c], rgb[c] / m, toward);
    return out;
}

// ── Timings (seconds) ─────────────────────────────────────────────────────────────

export const TIMING = Object.freeze({
    /** One watch of the night per this many seconds of theme clock (the wheel's clock term). */
    watch: 100,
    /** Share of a watch step the light rests on the watch's own palette, at each end. */
    watchRest: 0.15,
    /** A level-up's turn of the wheel eases over this long. */
    levelTurn: 5,
    /** A Strombolian burst's bombs fly for about this long. */
    bombFlight: 3.4,
    /** Lightning: a stroke's leader takes this long to reach the ground; the channel glows this long. */
    leader: 0.09,
    stroke: 0.55,
    /** Line-clear bolts follow each other this far apart. */
    boltStagger: 0.3,
    /** The storm's charge (a chain) builds and drains with these rates (per second). */
    chargeRise: 1.3,
    chargeFall: 0.35,
    /** Four lines: the shock front crosses the sky in this long; the surge runs this long. */
    shock: 2.6,
    surge: 9,
    /** T-spin: the vortex ring rises for this long. */
    ring: 14,
    /** Perfect clear: the anvil's sheet lightning crosses it in this long, and it fades over this. */
    sheet: 1.8,
    sheetFade: 3.5,
    /** Game over: the eruption sinks to embers over this long, and wakes over this long. */
    sink: 6,
    wake: 4,
    /** Without play the storm's charge is forgotten after this long. */
    idle: 90,
});
