/**
 * Painted Ages — the plan of the land (CPU only, three-free).
 *
 * The heights before any rain: smooth landforms the bake script (scripts/painted-ages/
 * bake-badlands.mjs) evaluates on the three field grids and then lets rain erode. The theme
 * itself only evaluates the plan when the baked images cannot be read (a small, unweathered
 * stand-in), so this module can afford to be clear rather than fast.
 *
 *  - a braided river winds out of the far north, past the flatiron range and through the
 *    valley, leaving the frame at the lower right;
 *  - ranks of ridged badland hills stand on both sides, sharp-crested, elongated across the view
 *    so they layer one behind another;
 *  - the overlook spur runs from the eye out to the pavilion knoll on the left; a great dragon-
 *    spine ridge holds the right; a cluster of rainbow cones stands in the left middle distance;
 *  - at three kilometres a flatiron range (Hornocal's teeth) rises across the whole view;
 *  - far ranges, and on the horizon a line of snow peaks.
 */
import {
    EARTH_DROP, EYE, clamp, lerp, mulberry32, smooth,
} from './painted-ages-core.js';

// ── Noise ─────────────────────────────────────────────────────────────────────────

const PERM = new Uint8Array(512);
{
    const random = mulberry32(0x7ab1e5);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** 2D simplex noise in about −1..1. */
export function simplex(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
        const g = GRAD[PERM[ii + PERM[jj]] & 7];
        t0 *= t0;
        n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
        const g = GRAD[PERM[ii + i1 + PERM[jj + j1]] & 7];
        t1 *= t1;
        n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
        const g = GRAD[PERM[ii + 1 + PERM[jj + 1]] & 7];
        t2 *= t2;
        n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
}

/** fBm of simplex noise, about −1..1. */
export function fbm(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * simplex(x * f + i * 17.3, y * f - i * 9.1);
        norm += amp;
        amp *= gain;
        f *= lacunarity;
    }
    return sum / norm;
}

/**
 * Musgrave's ridged multifractal, about 0..1: sharp crests where the noise crosses zero, each
 * finer octave weighted by the coarser signal so detail gathers on the ridges.
 */
export function ridged(x, y, octaves = 5, lacunarity = 2.1, gain = 0.62, offset = 1) {
    let signal = offset - Math.abs(simplex(x, y));
    signal *= signal;
    let sum = signal;
    let norm = 1;
    let weight = 1;
    let f = 1;
    let amp = 1;
    for (let i = 1; i < octaves; i++) {
        f *= lacunarity;
        amp *= 0.55;
        weight = clamp(signal * gain * 1.6, 0, 1);
        signal = offset - Math.abs(simplex(x * f + i * 31.7, y * f - i * 12.9));
        signal *= signal * weight;
        sum += signal * amp;
        norm += amp;
    }
    return sum / norm;
}

// ── The river ─────────────────────────────────────────────────────────────────────

/** The river's thalweg (x, z), from the far north to the lower right of the frame. */
export const RIVER = Object.freeze([
    [-1600, -9000], [-1100, -7000], [-700, -5600], [-380, -4400], [-200, -3300], [-120, -2500],
    [-40, -2000], [70, -1650], [10, -1300], [120, -1000], [210, -760], [250, -540], [360, -340],
    [540, -170], [780, 10], [1100, 220],
].map((p) => Object.freeze(p)));

/** Distance along the river's course to each of its points (metres from the source). */
export const RIVER_ALONG = Object.freeze(RIVER.reduce((acc, p, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + Math.hypot(p[0] - RIVER[i - 1][0], p[1] - RIVER[i - 1][1]));
    return acc;
}, []));
export const RIVER_LENGTH = RIVER_ALONG[RIVER_ALONG.length - 1];

/** The river bed's height at a point of its course (it falls gently toward the eye). */
export function riverFloor(z) {
    return 2 + Math.max(0, -z - 300) * 0.011 + Math.max(0, -z - 4000) * 0.012;
}

/** Distance (metres) from (x, z) to the river's course, plus where along it (0 at the source). */
export function riverDistance(x, z, out = { d: 0, along: 0, z: 0 }) {
    let best = Infinity;
    let along = 0;
    let run = 0;
    let at = 0;
    let bz = z;
    for (let i = 0; i < RIVER.length - 1; i++) {
        const [ax, az] = RIVER[i];
        const [bx, bzz] = RIVER[i + 1];
        const dx = bx - ax;
        const dz = bzz - az;
        const len = Math.hypot(dx, dz);
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (len * len), 0, 1);
        const px = ax + dx * t;
        const pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < best) {
            best = d;
            at = run + t * len;
            bz = pz;
        }
        run += len;
    }
    along = at;
    out.d = best;
    out.along = along;
    out.z = bz;
    return out;
}

// ── Hero landforms ────────────────────────────────────────────────────────────────

/** The pavilion stands on a small level terrace at the end of the overlook spur. */
export const PAVILION = Object.freeze({
    x: -150, z: -360, y: 140, terrace: 11, bank: 9, yaw: 0.35,
});

/** The overlook spur's crest line: the eye's own ridge out to the pavilion knoll. */
export const SPUR = Object.freeze([
    Object.freeze({
        x: 6, z: 14, y: 166, w: 40,
    }),
    Object.freeze({
        x: -26, z: -52, y: 148, w: 44,
    }),
    Object.freeze({
        x: -62, z: -124, y: 126, w: 46,
    }),
    Object.freeze({
        x: -96, z: -214, y: 110, w: 44,
    }),
    Object.freeze({
        x: -126, z: -300, y: 124, w: 48,
    }),
    Object.freeze({
        x: PAVILION.x, z: PAVILION.z, y: PAVILION.y + 1.5, w: 56,
    }),
    Object.freeze({
        x: -182, z: -452, y: 116, w: 66,
    }),
]);

/** The great dragon-spine ridge on the right: crest polyline with heights (below the eye). */
export const SPINE = Object.freeze([
    Object.freeze({
        x: 330, z: -640, y: 70, w: 60,
    }),
    Object.freeze({
        x: 450, z: -780, y: 146, w: 82,
    }),
    Object.freeze({
        x: 560, z: -900, y: 104, w: 80,
    }),
    Object.freeze({
        x: 690, z: -1030, y: 172, w: 100,
    }),
    Object.freeze({
        x: 830, z: -1150, y: 116, w: 96,
    }),
    Object.freeze({
        x: 980, z: -1280, y: 158, w: 110,
    }),
    Object.freeze({
        x: 1140, z: -1420, y: 112, w: 110,
    }),
]);

/** Rainbow cones in the left middle distance (centre, summit, radius). */
export const CONES = Object.freeze([
    Object.freeze({
        x: -470, z: -860, y: 132, r: 120,
    }),
    Object.freeze({
        x: -680, z: -1060, y: 158, r: 150,
    }),
    Object.freeze({
        x: -380, z: -1190, y: 124, r: 110,
    }),
    Object.freeze({
        x: -860, z: -800, y: 118, r: 120,
    }),
    Object.freeze({
        x: 420, z: -1520, y: 150, r: 140,
    }),
    Object.freeze({
        x: 120, z: -300, y: 40, r: 60,
    }),
]);

/**
 * How much badland relief stands at a point: little in the basin the eye looks down into, full
 * from about 600 m out. The basin is what lets the lower third show the valley floor.
 */
function reliefEnvelope(x, z) {
    const d = Math.hypot(x - 40, z + 60);
    return 0.12 + 0.88 * smooth(240, 720, d);
}

/** Distance to a crest polyline and the crest's height and width there. */
function crestAt(line, px, pz, out) {
    // A crest wanders and swells: nothing a river or the rain shaped is ruler-straight.
    const x = px + 16 * simplex(px / 120, pz / 120) + 6 * simplex(px / 41, pz / 41);
    const z = pz + 16 * simplex(px / 120 + 5.3, pz / 120 - 3.1) + 6 * simplex(px / 41 - 2.2, pz / 41 + 8.4);
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len2 = dx * dx + dz * dz;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (d < best) {
            best = d;
            // Hermite between the posts: the crest swells and dips smoothly.
            const s = t * t * (3 - 2 * t);
            out.y = lerp(a.y, b.y, s);
            out.w = lerp(a.w, b.w, t);
            out.t = (i + t) / (line.length - 1);
        }
    }
    out.d = best;
    out.y += 7 * simplex(x / 90 - 1.7, z / 90 + 4.2);
    return out;
}

const _crest = {
    d: 0, y: 0, w: 1, t: 0,
};
const _river = { d: 0, along: 0, z: 0 };

/**
 * A ridge's cross-section: a rounded crest a few metres wide, flanks steepening to ~45° and
 * then easing out concave into the floor (the badland profile). The rain cuts the rest.
 */
function ridgeProfile(d, w) {
    const u = d / w;
    // The long tail is cut off a few widths out: a ridge does not raise the next valley.
    return (1 + u * u) ** -0.85 * Math.exp(-((u / 4.5) ** 2));
}

// ── The plan ──────────────────────────────────────────────────────────────────────

/**
 * Badland relief: anisotropic ridged noise (ridges run roughly across the view, ~12° off the
 * x axis), in metres above the local floor.
 */
function badlands(x, z) {
    const c = Math.cos(0.21);
    const s = Math.sin(0.21);
    const u = x * c + z * s;
    const v = -x * s + z * c;
    // A slow warp so the ranks bend and break instead of running ruler-straight.
    const wu = u + 140 * fbm(x / 900, z / 900, 2);
    const wv = v + 90 * fbm(x / 700 + 3.1, z / 700 - 7.7, 2);
    const big = ridged(wu / 660, wv / 220, 3, 2.05, 0.7);
    const mid = ridged(wu / 240, wv / 105, 3, 2.1, 0.6);
    // Long ridges with rounded shoulders and knife crests: soften the base, keep the crest line.
    const r = big ** 1.1 * 0.8 + mid ** 1.6 * 0.2 * (0.3 + big);
    return 160 * r;
}

/** Hornocal's teeth: a range of flatirons dipping toward the eye, cut into triangles by gullies. */
function flatirons(x, z) {
    const front = -2650 + 140 * fbm(x / 1800, 1.3, 2);
    const crest = front - 720 - 120 * fbm(x / 1400, 5.2, 2);
    const back = crest - 1300;
    // The dip slope rises straight from the front to the crest; the scarp falls away behind.
    const rise = clamp((front - z) / (front - crest), 0, 1);
    const fall = 1 - smooth(crest, back, z);
    const toe = smooth(0, 0.18, rise);
    const peak = 400 + 90 * fbm(x / 2600, 9.4, 3) + 40 * simplex(x / 700, 2.2);
    const plate = peak * Math.min(rise * toe, fall ** 0.8);
    // Gullies every ~250 m (jittered), cut almost to the toe and widest at the crest:
    // triangular facets with their apex up.
    const jitter = 0.3 * simplex(x / 900, 4.4);
    const cell = x / 330 + jitter;
    const tooth = Math.abs(cell - Math.round(cell)) * 2; // 0 in a gully, 1 mid-facet
    const depth = peak * 0.42 * rise ** 0.9 * fall;
    const notch = depth * Math.max(0, 1 - tooth / (0.55 + 0.45 * rise)) ** 1.3;
    // Secondary gullies on each facet.
    const cell2 = x / 64 + 0.5 * simplex(x / 300, z / 300);
    const tooth2 = Math.abs(cell2 - Math.round(cell2)) * 2;
    const notch2 = 18 * rise * fall * (1 - tooth2) ** 2;
    return Math.max(0, plate - notch - notch2);
}

/** Far ranges and the snow peaks on the horizon. */
function ranges(x, z) {
    const mid = smooth(-6000, -7600, z) * (1 - smooth(-15000, -17000, z));
    const far = smooth(-17000, -20000, z);
    let h = 0;
    if (mid > 0) {
        // Rolling ranges: broad shoulders, ridged crests only on top.
        const body = 0.5 + 0.5 * fbm(x / 5200 + 4.1, z / 3000, 4);
        const crest = ridged(x / 2600 + 4.1, z / 1700, 4, 2.0, 0.6);
        h += mid * (160 + 620 * body * (0.55 + 0.45 * crest));
    }
    if (far > 0) {
        // The snow range: a few broad massifs, crested and gullied.
        const massif = Math.exp(-(((x + 3200) / 6200) ** 2)) + 0.8 * Math.exp(-(((x - 8200) / 5200) ** 2))
            + 0.6 * Math.exp(-(((x + 13000) / 4800) ** 2)) + 0.3;
        const body = 0.5 + 0.5 * fbm(x / 7000 - 2.3, z / 5000 + 1.7, 4);
        const crest = ridged(x / 2200 - 2.3, z / 1800 + 1.7, 5, 2.1, 0.65);
        h += far * (800 + 2300 * massif * body * (0.6 + 0.4 * crest));
    }
    return h;
}

/**
 * The plan's height at (x, z), in metres above the river at the eye's foot. Smooth: every edge
 * the rain will cut is still to come.
 */
export function planHeight(x, z) {
    const river = riverDistance(x, z, _river);
    const floor = riverFloor(river.z);
    // Valley: a braided floor 40–90 m wide, then the hills rise.
    const floorHalf = 34 + 22 * smooth(-200, -2400, z) + 14 * simplex(x / 300, z / 300);
    const open = smooth(floorHalf, floorHalf + 170, river.d);
    let h = floor + 3 * fbm(x / 120, z / 120, 2) * (1 - open);
    // Badland ranks everywhere off the floor, low in the basin below the eye, fading out under
    // the flatiron range's apron.
    const near = 1 - smooth(-2300, -2900, z);
    h += open * near * reliefEnvelope(x, z) * badlands(x, z);
    // The apron and the flatirons.
    h += open * flatirons(x, z);
    // Far ranges.
    h += ranges(x, z);
    // Hero forms, laid over with a soft max (they own their ground).
    const spur = crestAt(SPUR, x, z, _crest);
    const spurH = spur.y * ridgeProfile(spur.d, spur.w) * (0.3 + 0.7 * open);
    h = softMax(h, spurH, 18);
    const spine = crestAt(SPINE, x, z, _crest);
    const spineH = spine.y * ridgeProfile(spine.d, spine.w);
    h = softMax(h, spineH * (0.35 + 0.65 * open), 22);
    for (const cone of CONES) {
        // Cones lean along the strike and their skirts lobe out where spurs run down.
        const ax = (x - cone.x) * 0.82;
        const az = (z - cone.z) * 1.12;
        const a = Math.atan2(az, ax);
        const lobe = 1 + 0.16 * Math.sin(a * 3 + cone.x * 0.01) + 0.1 * Math.sin(a * 5 - cone.z * 0.013);
        const d = Math.hypot(ax, az) / lobe;
        const coneH = cone.y * Math.exp(-((d / cone.r) ** 2.1)) * (1 + 0.03 * simplex(x / 40, z / 40)) * open;
        h = softMax(h, coneH, 16);
    }
    // A little roughness off the floor, so the rain finds a thousand courses instead of a few.
    h += 3.2 * fbm(x / 34, z / 34, 3) * smooth(floor + 4, floor + 30, h);
    // The pavilion's terrace.
    const pd = Math.hypot(x - PAVILION.x, z - PAVILION.z);
    const level = 1 - smooth(PAVILION.terrace, PAVILION.terrace + PAVILION.bank, pd);
    h = lerp(h, PAVILION.y, level);
    return h;
}

/** A smooth maximum (k metres of blend). */
export function softMax(a, b, k) {
    const h = clamp(0.5 + (b - a) / (2 * k), 0, 1);
    return lerp(a, b, h) + k * h * (1 - h);
}

/** The drop of the earth's surface at a point (metres), seen from the eye. */
export function earthDrop(x, z) {
    const d2 = (x - EYE.x) ** 2 + (z - EYE.z) ** 2;
    return d2 * EARTH_DROP;
}
