/**
 * High Coast — the plan of the land and the sea floor (CPU only, three-free).
 *
 * The heights the bake script (scripts/high-coast/bake-coast.mjs) evaluates on the three field
 * grids before it smooths, joints and nests them; the theme evaluates the plan itself only when the
 * baked images cannot be read (a small stand-in), so this module can afford to be clear.
 *
 *  - the SUMMIT under the eye: a glacier-polished granite dome whose edge falls away a dozen
 *    metres in front of the eye, a knoll on the left where the old pine and the trail sign stand;
 *  - the HEADLAND on the left: a ridge whose east face is a sheer rapakivi cliff 200 m high, its
 *    crown forested (a kalottberg: the old island top kept its moraine), its south flank washed bare
 *    and terraced with shingle beach ridges (klapperstensfält);
 *  - the BAY below: deep in the middle, shelved and strewn with skerries toward every shore, so a
 *    falling sea brings rock up out of it;
 *  - the islands: a large pine island behind the card, the hamlet's island on the near right, a
 *    string of islands to the right, the outer archipelago, a steep lighthouse island far out;
 *  - the mainland coast continuing north on the left as rounded blue hills; the open Bothnian Sea
 *    to the right under the sun.
 *
 * Heights are metres above the sea at rest (negative = sea floor).
 */
import {
    EARTH_DROP, EYE, PLACES, clamp, lerp, mulberry32, smooth,
} from './high-coast-core.js';

// ── Noise ─────────────────────────────────────────────────────────────────────────

const PERM = new Uint8Array(512);
{
    const random = mulberry32(0x40ea);
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

/** Musgrave's ridged multifractal, about 0..1. */
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

// ── Shapes ────────────────────────────────────────────────────────────────────────

/**
 * A glacier-polished granite dome (a roche moutonnée): an ellipse of radii rx × rz turned by
 * `yaw`, height `h` above the sea at its crown and sinking to `foot` (sea floor) at its rim,
 * with a rounded crown and convex flanks, its outline lobed so no island is an ellipse.
 */
function dome(x, z, d) {
    const c = Math.cos(d.yaw || 0);
    const s = Math.sin(d.yaw || 0);
    const dx = x - d.x;
    const dz = z - d.z;
    const u = (dx * c + dz * s) / d.rx;
    const v = (-dx * s + dz * c) / d.rz;
    const a = Math.atan2(v, u);
    const seed = d.seed || 0;
    const lobe = 1 + 0.13 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 5 - seed * 1.7) + 0.06 * Math.sin(a * 8 + seed * 2.3);
    const r = Math.hypot(u, v) / lobe;
    if (r > 2.6) return -1e4;
    // Above the sea: a rounded crown (flatter and steeper-shored as `sharp` falls below 1).
    if (r <= 1) {
        const body = (1 - r * r) ** (d.sharp ?? 0.8);
        // Granite knolls on the crown, fading out toward the shore.
        const knolls = d.knobs ? d.h * d.knobs * (ridged(x / (d.rx * 0.45) + seed, z / (d.rx * 0.45) - seed, 3, 2.1, 0.6) - 0.35) * body : 0;
        return d.h * body + knolls;
    }
    // Below it: the shore's slope carried on down to the dome's foot on the sea floor.
    return Math.max(d.foot ?? -30, -(r - 1) * d.h * 2.2);
}

/** Distance to a crest polyline with the crest's height, width and the side a point lies on. */
function crestAt(line, px, pz, out) {
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len2 = dx * dx + dz * dz;
        const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / len2, 0, 1);
        const qx = a.x + dx * t;
        const qz = a.z + dz * t;
        const d = Math.hypot(px - qx, pz - qz);
        if (d < best) {
            best = d;
            const st = t * t * (3 - 2 * t);
            out.y = lerp(a.y, b.y, st);
            out.w = lerp(a.w, b.w, t);
            out.cliff = lerp(a.cliff ?? 0.5, b.cliff ?? 0.5, t);
            // The side: positive toward the line's right (east of a line running away from the eye).
            const len = Math.sqrt(len2);
            out.side = ((px - qx) * -dz + (pz - qz) * dx) / len;
            out.t = (i + t) / (line.length - 1);
        }
    }
    out.d = best;
    return out;
}

// ── Hero landforms ────────────────────────────────────────────────────────────────

/**
 * The headland's crest, from its foot out of the frame on the near left along the left of the
 * bay and on into the mainland. `w` is the half-width of the ridge's body; `cliff` is how far east
 * of the crest (in widths) the cliff's lip runs. Heights above the sea. The east face runs almost
 * north–south, so from the eye it is seen three-quarter on and the low sun rakes across it.
 */
export const HEADLAND = Object.freeze([
    Object.freeze({
        x: -930, z: -150, y: -30, w: 110, cliff: 1.0,
    }),
    Object.freeze({
        x: -820, z: -390, y: 62, w: 120, cliff: 1.0,
    }),
    Object.freeze({
        x: -660, z: -700, y: 172, w: 150, cliff: 0.95,
    }),
    Object.freeze({
        x: -620, z: -1020, y: 236, w: 160, cliff: 0.92,
    }),
    Object.freeze({
        x: -650, z: -1360, y: 226, w: 170, cliff: 0.92,
    }),
    Object.freeze({
        x: -745, z: -1730, y: 188, w: 170, cliff: 0.95,
    }),
    Object.freeze({
        x: -940, z: -2260, y: 150, w: 190, cliff: 1.0,
    }),
    Object.freeze({
        x: -1300, z: -3060, y: 112, w: 220, cliff: 1.1,
    }),
]);

/**
 * Islands as domes: centre, radii, yaw, crown height, foot depth, crown sharpness (below 1 a
 * flatter crown and steeper shores), knobs (share of the height in granite knolls on the crown).
 */
export const ISLANDS = Object.freeze([
    // The great pine island behind the card ("Storön").
    {
        x: 150, z: -1400, rx: 330, rz: 190, yaw: 0.16, h: 92, foot: -40, sharp: 0.62, knobs: 0.22, seed: 1.3,
    },
    {
        x: -60, z: -1250, rx: 150, rz: 100, yaw: -0.4, h: 46, foot: -32, sharp: 0.7, knobs: 0.2, seed: 2.1,
    },
    // The hamlet's island on the near right, low and broad, a cove on its near side.
    {
        x: 205, z: -545, rx: 118, rz: 80, yaw: 0.45, h: 18, foot: -16, sharp: 1.1, knobs: 0.12, seed: 4.4,
    },
    {
        x: 312, z: -455, rx: 62, rz: 40, yaw: 0.2, h: 8, foot: -14, sharp: 1.2, knobs: 0.1, seed: 0.7,
    },
    // A string of islands to the right.
    {
        x: 640, z: -930, rx: 150, rz: 105, yaw: -0.3, h: 58, foot: -32, sharp: 0.68, knobs: 0.22, seed: 3.3,
    },
    {
        x: 880, z: -1520, rx: 220, rz: 150, yaw: 0.4, h: 84, foot: -40, sharp: 0.62, knobs: 0.2, seed: 5.1,
    },
    {
        x: 560, z: -1960, rx: 120, rz: 90, yaw: 0.9, h: 36, foot: -34, sharp: 0.8, knobs: 0.15, seed: 6.6,
    },
    {
        x: 1180, z: -2380, rx: 260, rz: 170, yaw: -0.2, h: 96, foot: -44, sharp: 0.6, knobs: 0.2, seed: 7.2,
    },
    // The outer archipelago: high islands looming over the sea (Ulvön's and Mjältön's kind).
    {
        x: -300, z: -2700, rx: 260, rz: 160, yaw: 0.3, h: 70, foot: -46, sharp: 0.66, knobs: 0.2, seed: 8.8,
    },
    {
        x: 260, z: -3350, rx: 400, rz: 230, yaw: -0.15, h: 124, foot: -50, sharp: 0.58, knobs: 0.2, seed: 9.4,
    },
    {
        x: 1500, z: -3950, rx: 300, rz: 180, yaw: 0.5, h: 80, foot: -50, sharp: 0.64, knobs: 0.18, seed: 10.1,
    },
    {
        x: -950, z: -4400, rx: 440, rz: 250, yaw: 0.1, h: 146, foot: -50, sharp: 0.56, knobs: 0.2, seed: 11.7,
    },
    {
        x: 720, z: -4800, rx: 260, rz: 160, yaw: -0.6, h: 64, foot: -50, sharp: 0.68, knobs: 0.18, seed: 12.2,
    },
    // The lighthouse island: steep and high (Högbonden's kind).
    {
        x: PLACES.lighthouse.x, z: PLACES.lighthouse.z, rx: 220, rz: 170, yaw: 0.3, h: 78, foot: -60, sharp: 0.42, knobs: 0.12, seed: 13.9,
    },
    {
        x: 2700, z: -6300, rx: 340, rz: 200, yaw: 0.2, h: 60, foot: -60, sharp: 0.66, knobs: 0.18, seed: 14.5,
    },
    {
        x: -2200, z: -6800, rx: 560, rz: 320, yaw: 0.3, h: 156, foot: -60, sharp: 0.56, knobs: 0.2, seed: 15.3,
    },
    {
        x: 400, z: -7600, rx: 620, rz: 290, yaw: -0.1, h: 112, foot: -60, sharp: 0.58, knobs: 0.2, seed: 16.8,
    },
    {
        x: 4000, z: -8800, rx: 440, rz: 250, yaw: 0.4, h: 52, foot: -60, sharp: 0.7, knobs: 0.16, seed: 17.1,
    },
    {
        x: 6200, z: -12500, rx: 700, rz: 300, yaw: 0.1, h: 40, foot: -60, sharp: 0.7, knobs: 0.14, seed: 18.6,
    },
    {
        x: -400, z: -12000, rx: 900, rz: 420, yaw: -0.2, h: 96, foot: -60, sharp: 0.6, knobs: 0.18, seed: 19.9,
    },
].map((d) => Object.freeze(d)));

/**
 * Skerry fields: discs where the sea floor is strewn with rounded, ice-polished rocks standing a
 * little below or above the sea at rest. A falling sea brings them up; `top` is the highest a
 * rock reaches (most lie lower, waiting).
 */
export const SKERRY_FIELDS = Object.freeze([
    {
        x: 120, z: -330, r: 220, top: 1.2,
    },
    {
        x: 330, z: -620, r: 210, top: 2.2,
    },
    {
        x: -230, z: -640, r: 200, top: 0.8,
    },
    {
        x: 420, z: -1150, r: 230, top: 1.8,
    },
    {
        x: -260, z: -1080, r: 180, top: 1.0,
    },
    {
        x: 760, z: -1240, r: 220, top: 1.5,
    },
    {
        x: 980, z: -2020, r: 300, top: 1.8,
    },
    {
        x: 60, z: -2250, r: 380, top: 1.0,
    },
    {
        x: -380, z: -1700, r: 260, top: 0.6,
    },
].map((d) => Object.freeze(d)));

const _crest = {
    d: 0, y: 0, w: 1, cliff: 0.5, side: 0, t: 0,
};

/** The sea floor: a basin deepening away from the shores, with glacial troughs and banks. */
function seaFloor(x, z) {
    const trough = -46 - 14 * smooth(-600, -3000, z) - 8 * fbm(x / 1400, z / 1400, 3);
    return trough + 6 * fbm(x / 300, z / 300, 3);
}

/** The summit under the eye: polished granite, its edge a dozen metres in front of the eye. */
function summit(x, z) {
    // A rounded square of polished rock (a superellipse) whose near rim runs a dozen metres in
    // front of the eye, pushed out on the left where the knoll stands.
    const knoll = Math.exp(-(((x - PLACES.pine.x) / 11) ** 2 + ((z - PLACES.pine.z) / 9) ** 2));
    const ax = 70 + 6 * fbm(z / 40, 1.3, 2);
    const az = 58 + 10 * knoll + 2.5 * fbm(x / 26, 0.4, 2) - 2 * smooth(5, 40, x);
    const u = (x - 5) / ax;
    const v = (z - 44) / az;
    const rim = (u ** 4 + v ** 4) ** 0.25;
    const past = Math.max(0, rim - 1) * Math.min(ax, az);
    // Six metres under the eye: the rim frames the foot of the view, the knoll its left side.
    let h = 146.2 + 0.8 * fbm(x / 18, z / 18, 3) + 0.4 * fbm(x / 6, z / 6, 2)
        // The knoll: a low rise where the pine roots and the sign stands.
        + 0.7 * knoll + 0.4 * Math.exp(-(((x - PLACES.sign.x) / 5) ** 2 + ((z - PLACES.sign.z) / 4) ** 2))
        // The crown is a whaleback: it rolls off gently toward its rim.
        - 4 * Math.max(0, rim - 0.7) ** 2;
    // Past the rim the dome falls away steeply (a convex shoulder, then ~55°) to the sea floor.
    h -= past * (0.6 + 1.0 * smooth(0, 14, past)) * (1.35 + 0.25 * fbm(x / 30, z / 30, 2));
    return h;
}

/** The headland: a broad ridge whose east face is a sheer cliff with a talus foot. */
function headland(x, z) {
    const c = crestAt(HEADLAND, x, z, _crest);
    if (c.d > c.w * 3.4) return -1e4;
    const u = c.d / c.w;
    // Granite knolls on the crown.
    const crown = c.y + 9 * fbm(x / 140, z / 140, 3);
    if (c.side <= 0) return crown * Math.exp(-((u / 1.3) ** 2.2)) - 20 * smooth(1.6, 3.2, u);
    // The lip wanders slowly, and the face is broken into buttresses and recesses along its
    // vertical joints, not fluted. Joint spacing in granite is irregular: each buttress is its
    // own width (the warp stretches some cells, squeezes others), its own depth, and lopsided (a
    // flat face on one side, a sharp re-entrant corner on the other); now and then a joint has
    // opened into a deep gully. A symmetric zigzag at a fixed 52 m read as a drawn curtain.
    const phase = z / 58 + 0.9 * fbm(x / 260, z / 260, 2);
    const cell = Math.floor(phase);
    const f = phase - cell;
    const hash = (k) => {
        const s = Math.sin(cell * 127.1 + k * 311.7) * 43758.5453;
        return s - Math.floor(s);
    };
    const skew = 0.25 + 0.5 * hash(1);
    const profile = f < skew ? f / skew : (1 - f) / (1 - skew);
    const depth = 7 + 18 * hash(2);
    const gully = hash(3) > 0.82 ? 14 * Math.exp(-(((f - skew) / 0.06) ** 2)) : 0;
    const lip = c.cliff * c.w + 30 * fbm(x / 160, z / 160, 2) + depth * profile + gully;
    // The plateau falls a little toward the lip…
    if (c.side < lip) return crown * (1 - 0.2 * (c.side / lip) ** 2);
    // …then down in jointed steps: steep risers between narrow ledges (where pines take hold),
    // about 65° overall, onto a talus foot of fallen blocks.
    const past = c.side - lip;
    const atLip = crown * 0.8;
    const fall = atLip - past * (2.3 + 0.5 * fbm(z / 90, x / 90, 2));
    const wall = terrace(fall, 11 + 3 * fbm(z / 140, 7.1, 2), 5 * fbm(z / 75, x / 75, 2));
    const foot = -10 - past * 0.3 + 24 * Math.exp(-((past / 34) ** 2)) + 3 * fbm(x / 9, z / 9, 2) * Math.exp(-((past / 40) ** 2));
    return Math.max(wall, foot);
}

/**
 * Jointed steps: a height `h` falling linearly is turned into treads (nearly flat) and risers
 * (nearly sheer) of about `step` metres; `shift` moves the step lines so no ledge is level for
 * long.
 */
function terrace(h, step, shift) {
    const v = (h + shift) / step;
    const i = Math.floor(v);
    const f = v - i;
    // Riser from f = 0.62 to 1 (steep), tread below it (a gentle fall toward the edge).
    const rise = f < 0.62 ? f * 0.18 : 0.1116 + ((f - 0.62) / 0.38) ** 1.6 * 0.8884;
    return (i + rise) * step - shift;
}

/** Shingle terraces: a staircase of old beach ridges on a slope, metres to add. */
export function shingleRelief(x, z, h) {
    const band = h / 5.5 + 0.6 * fbm(x / 160, z / 160, 2);
    const f = band - Math.floor(band);
    // Each ridge a rounded hump at the step's outer edge.
    return 1.1 * Math.exp(-(((f - 0.82) / 0.12) ** 2));
}

/**
 * How much a point belongs to a shingle field (0..1): the headland's south flank (seen across
 * the inlet on the left) and a patch on the far shoulder of the summit, between 18 and 150 m.
 */
export function shingleMask(x, z, h) {
    const a = Math.exp(-(((x + 700) / 170) ** 2 + ((z + 560) / 150) ** 2));
    const b = Math.exp(-(((x + 560) / 120) ** 2 + ((z + 860) / 110) ** 2)) * 0.8;
    const heightBand = smooth(18, 34, h) * (1 - smooth(120, 150, h));
    return clamp((a + b) * heightBand * 1.6 - 0.15, 0, 1);
}

/** The mainland coast continuing north on the left: rounded hills fading into the haze. */
function mainland(x, z) {
    const shore = -900 + Math.min(0, z + 2400) * 0.36 + 300 * fbm(z / 2600, 3.3, 3);
    const inland = shore - x;
    if (inland < -700) return -1e4;
    const rise = smooth(-150, 1500, inland);
    const hills = 0.5 + 0.5 * fbm(x / 2600 + 1.1, z / 2600, 4);
    // Kalottberg: round wooded crowns standing over washed slopes.
    const crowns = 0.5 + 0.5 * fbm(x / 1700 + 3, z / 1700, 3);
    return -30 + rise * (120 + 220 * hills + 120 * crowns ** 2);
}

/**
 * Rounded, ice-polished rocks in a field (cells of 52 m, two in five holding a rock): the highest
 * rock surface at (x, z), metres relative to the field's `top`, or −1e4 where no rock stands.
 */
function skerryRocks(x, z) {
    const s = 52;
    const gx = Math.floor(x / s);
    const gz = Math.floor(z / s);
    let best = -1e4;
    const ca = Math.cos(0.6);
    const sa = Math.sin(0.6);
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const cx = gx + i;
            const cz = gz + j;
            const hash = (k) => {
                const v = Math.sin(cx * (127.1 + k * 31.3) + cz * (311.7 - k * 17.9)) * 43758.5453;
                return v - Math.floor(v);
            };
            if (hash(0) > 0.22) continue;
            const px = (cx + 0.15 + 0.7 * hash(1)) * s;
            const pz = (cz + 0.15 + 0.7 * hash(2)) * s;
            const radius = 7 + 17 * hash(3) ** 1.5;
            // Whalebacks: drawn out along the ice's flow.
            const dx = x - px;
            const dz = z - pz;
            const u = (dx * ca + dz * sa) / (radius * 1.6);
            const v = (-dx * sa + dz * ca) / radius;
            const d2 = u * u + v * v;
            if (d2 >= 1.6) continue;
            const depth = 9 * hash(4) ** 0.7;
            const rise = Math.min(radius * 0.38, 7);
            // A rounded dome (a whaleback), not a flat-topped disc.
            const surface = -depth - rise * d2 * 0.95 - (d2 > 1 ? (d2 - 1) * 8 : 0);
            if (surface > best) best = surface;
        }
    }
    return best;
}

/**
 * The plan's height at (x, z): metres above the sea at rest. Smooth: the joints, the polish
 * and the shingle are the bake's.
 */
export function planHeight(x, z) {
    let h = seaFloor(x, z);
    h = softMax(h, summit(x, z), 10);
    h = softMax(h, headland(x, z), 14);
    h = softMax(h, mainland(x, z), 40);
    for (const d of ISLANDS) {
        const s = dome(x, z, d);
        if (s > -1e3) h = softMax(h, s, Math.max(6, d.rx * 0.06));
    }
    for (const f of SKERRY_FIELDS) {
        const k = 1 - smooth(f.r * 0.45, f.r, Math.hypot(x - f.x, z - f.z));
        if (k <= 0) continue;
        const rock = skerryRocks(x, z);
        if (rock > -1e3) h = softMax(h, f.top + rock - (1 - k) * 7, 1.5);
    }
    // Low roughness everywhere: granite is never a plane.
    h += 1.2 * fbm(x / 46, z / 46, 3);
    return h;
}

/**
 * The cover the land wears (0..1 each): forest, and heath (bare granite with heather and
 * lichen). Shingle is `shingleMask`. Water is wherever the land stands below the sea.
 */
export function planCover(x, z, h, slope, out = { forest: 0, heath: 0 }) {
    // Forest needs soil: above the splash zone, not on cliffs, thickest on the crowns.
    const above = smooth(2.2, 5.5, h);
    const gentle = 1 - smooth(0.85, 1.35, slope);
    const patch = 0.5 + 0.5 * fbm(x / 140 + 7.7, z / 140 - 3.3, 3);
    let forest = above * gentle * smooth(0.3, 0.55, patch + 0.25);
    // The summit and the near slopes below the eye: bare polished granite and heath.
    forest *= smooth(70, 220, Math.hypot(x - EYE.x, z - EYE.z));
    forest *= 1 - shingleMask(x, z, h);
    // Kalottberg: on the headland, forest crowns the top; the washed flanks below are bare.
    const c = crestAt(HEADLAND, x, z, _crest);
    if (c.d < c.w * 2.5) forest *= smooth(c.y * 0.55, c.y * 0.75, h);
    // The hamlet's yard is open.
    const hm = Math.hypot(x - PLACES.hamlet.x, z - PLACES.hamlet.z);
    forest *= smooth(PLACES.hamlet.radius * 0.6, PLACES.hamlet.radius * 1.2, hm);
    out.forest = clamp(forest, 0, 1);
    out.heath = clamp(above * (1 - forest) * smooth(0.2, 0.6, 1 - slope), 0, 1);
    return out;
}
