/**
 * Grainfields — the plan of the land (CPU, three-free).
 *
 * One analytic height function for everything that stands on the ground: the land mesh, the
 * barley round the eye, the shelterbelts and the fort's knoll. The land, from the eye outward:
 *
 *  - the near field: from the eye's feet it rises gently to a crest a hundred metres out, whose
 *    ears stand at the eye's height, so everything behind it lies below the line over them;
 *  - behind the crest a broad vale with the fort's knoll in it, rolling fields and a low ridge on
 *    the right with shelterbelts along its plots;
 *  - beyond, the land climbs in ranks: a forested ridge three kilometres out, the foothills at
 *    seven, and Lapporten's fells behind them (grainfields-lapporten.js).
 *
 * The pale path (a track with a broad seam of white flowers along it) winds from the near field on
 * the left to the fort: its centre line is a polyline the shaders read too (PATH_POINTS).
 * The plots of the patchwork, the shelterbelts and the tree sites are laid out here as well.
 */
import {
    CREST, EYE, PLACES, clamp01, mulberry32, smooth,
} from './grainfields-core.js';

// ── Small fields of numbers ───────────────────────────────────────────────────────

/** A smooth hash-free noise: a sum of a few incommensurate sines (deterministic, cheap). */
function swell(x, z) {
    return Math.sin(x * 0.0071 + 0.6) * Math.cos(z * 0.0063 - 0.4)
        + 0.55 * Math.sin(x * 0.0123 - z * 0.0097 + 1.1)
        + 0.3 * Math.cos(x * 0.021 + z * 0.017 - 2.3);
}

// ── The path ──────────────────────────────────────────────────────────────────────

/**
 * The path's centre line (x, z), from the near field left of the eye to the fort's gate. A
 * leading line: it enters the frame at the bottom left and winds away into the vale.
 */
export const PATH_POINTS = Object.freeze([
    [-5.4, -2.8], [-7.2, -7.5], [-9.0, -13], [-10.6, -19.5], [-12.4, -27], [-14.0, -35.5],
    [-16.2, -45], [-18.0, -56], [-20.6, -68], [-24.0, -81], [-28.0, -95], [-42, -140],
    [-80, -260], [-150, -520], [-250, -860], [-340, -1150], [-395, -1300],
]);
/** Half-widths (metres): the trodden track, and the seam of white flowers beside it. */
export const PATH = Object.freeze({ track: 1.1, flowers: 4.6 });

/** Distance from a point to the path's centre line, and how far along it (0..1). */
export function pathDistance(x, z) {
    let best = Infinity;
    let along = 0;
    let total = 0;
    const lengths = [];
    for (let i = 0; i + 1 < PATH_POINTS.length; i++) {
        const [ax, az] = PATH_POINTS[i];
        const [bx, bz] = PATH_POINTS[i + 1];
        lengths.push(Math.hypot(bx - ax, bz - az));
        total += lengths[i];
    }
    let run = 0;
    for (let i = 0; i + 1 < PATH_POINTS.length; i++) {
        const [ax, az] = PATH_POINTS[i];
        const [bx, bz] = PATH_POINTS[i + 1];
        const vx = bx - ax;
        const vz = bz - az;
        const len2 = vx * vx + vz * vz;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
        const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
        if (d < best) {
            best = d;
            along = (run + lengths[i] * t) / total;
        }
        run += lengths[i];
    }
    return { distance: best, along };
}

/**
 * The path's seam of white flowers widens and narrows along its length; near the eye it is a
 * narrow verge (the barley stands close to the track there).
 */
export function flowerWidth(along) {
    const near = 0.3 + 0.7 * smooth(0.02, 0.14, along);
    return PATH.flowers * near * (0.75 + 0.45 * Math.sin(along * 23.0 + 0.7) * Math.sin(along * 7.0));
}

// ── The height of the land ────────────────────────────────────────────────────────

/** The fort's knoll: a flat crown terrace, steep stony sides, a skirt into the shore. */
function knoll(x, z) {
    const F = PLACES.fort;
    const r = Math.hypot(x - F.x, z - F.z);
    const crown = 1 - smooth(F.radius * 0.42, F.radius * 0.62, r);
    const side = 1 - smooth(F.radius * 0.42, F.radius * 1.15, r);
    const skirt = Math.exp(-((r / (F.radius * 1.9)) ** 2));
    return F.height * (0.62 * side + 0.38 * crown) * (0.85 + 0.15 * skirt) + 3 * skirt;
}

/**
 * The near field: from the eye's ground it rises gently to the crest (its distance sways with the
 * bearing), ripples a little, and stands level behind it. Returns its height and how far the far
 * land has taken over (0 at the crest, 1 by CREST.behind times its distance).
 */
export function nearField(x, z) {
    const d = Math.hypot(x - EYE.x, z - EYE.z);
    const bearing = Math.atan2(x - EYE.x, -(z - EYE.z)) * (180 / Math.PI);
    const crest = CREST.distance + CREST.sway * Math.sin(bearing * 0.11 + 0.7);
    const k = Math.min(1, d / crest);
    const up = k * k * (3 - 2 * k);
    const ripple = 0.18 * Math.sin(x * 0.21 + 0.4) * Math.sin(z * 0.17 - 1.2) * smooth(6, 30, d);
    return {
        h: EYE.ground + CREST.rise * up + ripple,
        behind: smooth(crest * 1.02, crest * CREST.behind, d),
    };
}

/**
 * The land's height (metres; the vale's floor lies near y = 0) at a world point.
 * Deterministic and smooth (continuous slope everywhere), cheap enough to call per post.
 * The near field (round the eye, up to the crest) hands over to the far land behind the crest;
 * the far land lies below the line over the crest's ears until the foothills.
 */
export function groundHeight(x, z) {
    const near = nearField(x, z);
    if (near.behind <= 0) return near.h;
    const far = farHeight(x, z);
    return near.h + (far - near.h) * near.behind;
}

/** The far land: the vale behind the crest, the right ridge, the foothills, the fort's hill. */
function farHeight(x, z) {
    const dEye = Math.hypot(x - EYE.x, z - EYE.z);
    // The fields behind the crest lie low (below the line over the crest's ears), then climb.
    const fall = 3.0 + 4.0 * Math.exp(-dEye / 700);
    const vale = -3.5 * Math.exp(-(((z + 1150) / 700) ** 2)) * (1 - smooth(800, 2600, x));
    // Gentle swells in the fields.
    const calm = smooth(60, 400, dEye);
    const rolling = 2.6 * swell(x, z) * calm;
    // Beyond the vale the land climbs in ranks, each a ridge across the view: a forested ridge three
    // kilometres out, the foothills at seven (the fells rise behind them).
    const bearing = Math.atan2(x - EYE.x, -(z - EYE.z)) * (180 / Math.PI);
    const beyond = smooth(1700, 9000, -z);
    const rise = 120 * beyond ** 1.6 + 22 * smooth(1300, 3200, -z);
    const ridgeAt = 3300 + 520 * Math.sin(bearing * 0.07 + 0.6);
    const ridgeSpan = (dEye - ridgeAt) / 640;
    const ridgeLine = 95 * Math.exp(-ridgeSpan * ridgeSpan) * (0.55 + 0.45 * Math.sin(bearing * 0.13 + 2.0))
        * (0.8 + 0.2 * swell(x * 0.4, z * 0.4));
    const hillsAt = 7100 + 900 * Math.sin(bearing * 0.05 - 0.4);
    const hillsSpan = (dEye - hillsAt) / 1500;
    const hills = 230 * Math.exp(-hillsSpan * hillsSpan) * (0.62 + 0.38 * Math.sin(bearing * 0.09 - 1.1));
    // A low ridge on the right with plots on its flanks.
    const ridge = 74 * Math.exp(-(((x - 2100) / 1100) ** 2)) * smooth(500, 2600, -z);
    // A shoulder of land behind the left shelterbelt.
    const shoulder = 26 * Math.exp(-(((x + 1900) / 700) ** 2)) * smooth(300, 1400, -z);
    let h = fall + vale + rolling + rise + ridgeLine + hills + ridge + shoulder;
    // The farmed land stays above the vale's floor (a smooth floor, no crease).
    const floor = 1.6;
    h = 0.5 * (h + floor + Math.sqrt((h - floor) ** 2 + 4));
    // The fort's knoll stands on the near shore.
    h += knoll(x, z);
    return h;
}

/** The ground's slope (dh/dx, dh/dz) by central differences. */
export function groundSlope(x, z, step = 0.5) {
    return [
        (groundHeight(x + step, z) - groundHeight(x - step, z)) / (2 * step),
        (groundHeight(x, z + step) - groundHeight(x, z - step)) / (2 * step),
    ];
}

// ── The patchwork ─────────────────────────────────────────────────────────────────

/**
 * The plots: a grid turned 12° off the view axis, its rows of irregular length, each plot one
 * crop. `PLOT` gives the grid's angle and cell sizes; plotAt() returns the plot's id (0..1 hash)
 * and how close the point is to a plot's edge (metres), as the land shader computes them.
 */
export const PLOT = Object.freeze({ angle: 12, across: 260, along: 190 });

function hash2(i, j) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function plotAt(x, z) {
    const a = (PLOT.angle * Math.PI) / 180;
    const u = x * Math.cos(a) - z * Math.sin(a);
    const v = x * Math.sin(a) + z * Math.cos(a);
    const row = Math.floor(v / PLOT.along);
    // Each row's plots are offset and of their own length.
    const shift = hash2(row, 7) * PLOT.across;
    const width = PLOT.across * (0.7 + 0.6 * hash2(row, 11));
    const col = Math.floor((u + shift) / width);
    const fu = (u + shift) / width - col;
    const fv = v / PLOT.along - row;
    const edge = Math.min(fu * width, (1 - fu) * width, fv * PLOT.along, (1 - fv) * PLOT.along);
    return {
        id: hash2(col, row), edge, row, col,
    };
}

// ── Shelterbelts and trees ────────────────────────────────────────────────────────

/**
 * The shelterbelts: rows of larch and birch along the plots, as polylines (x, z). The left belt
 * frames the view; the right one runs along the ridge's foot; the far ones stitch the vale.
 * `kind`: 0 larch-dominant, 1 birch-dominant, 2 mixed with spruce.
 */
export const BELTS = Object.freeze([
    Object.freeze({
        kind: 0,
        width: 26,
        points: [[-60, -70], [-120, -180], [-210, -330], [-300, -470], [-420, -620], [-560, -760], [-700, -900]],
    }),
    Object.freeze({
        kind: 1,
        width: 26,
        points: [[96, -270], [190, -420], [320, -560], [480, -690], [660, -800], [900, -920], [1250, -1040]],
    }),
    Object.freeze({
        kind: 2,
        width: 40,
        points: [[1150, -1350], [1500, -1500], [1900, -1700], [2400, -1950], [3000, -2200]],
    }),
    Object.freeze({
        kind: 2,
        width: 46,
        points: [[-260, -2350], [200, -2500], [700, -2650], [1200, -2900]],
    }),
    Object.freeze({
        kind: 0,
        width: 34,
        points: [[-2200, -900], [-1900, -1100], [-1600, -1350], [-1550, -1650]],
    }),
]);

/** Distance from a point to a polyline. */
function polylineDistance(x, z, points) {
    let best = Infinity;
    for (let i = 0; i + 1 < points.length; i++) {
        const [ax, az] = points[i];
        const [bx, bz] = points[i + 1];
        const vx = bx - ax;
        const vz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
        best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
    return best;
}

/** How much a point lies inside a shelterbelt (0..1), and which kind. */
export function beltAt(x, z) {
    let cover = 0;
    let kind = 0;
    for (let i = 0; i < BELTS.length; i++) {
        const b = BELTS[i];
        const d = polylineDistance(x, z, b.points);
        const c = 1 - smooth(b.width * 0.35, b.width * 0.5, d);
        if (c > cover) {
            cover = c;
            ({ kind } = b);
        }
    }
    return { cover, kind };
}

/**
 * The forest on the ridges and the foothills: cover 0..1 by height and distance (the vale and
 * the near fields are farmed; the land climbs into forest beyond them).
 */
export function forestCover(x, z, h = groundHeight(x, z)) {
    const far = smooth(2300, 3400, -z);
    const up = smooth(30, 80, h);
    const patch = 0.5 + 0.5 * Math.sin(x * 0.0021 + 1.3) * Math.cos(z * 0.0017 - 0.2);
    return clamp01(far * up * (0.75 + 0.5 * patch));
}

/** Tree heights (metres) and crown widths (of the height) by kind: larch, birch, spruce. */
const KIND_HEIGHT = Object.freeze([22, 15, 19]);
const KIND_WIDTH = Object.freeze([0.34, 0.42, 0.3]);

/** A belt's tree kind: a mixed belt spruce, larch and birch; the others mostly their own kind. */
function pickKind(beltKind, pick) {
    if (beltKind === 2) {
        if (pick < 0.4) return 2;
        return pick < 0.7 ? 0 : 1;
    }
    return pick < 0.78 ? beltKind : 1 - beltKind;
}

/**
 * The trees of the shelterbelts (and a few singles in the fields): instance data
 * (x, ground y, z, height) + (kind, seed, crown width, lean). Spacing by kind; a seeded walk.
 */
export function treeSites(seed = 0x7ee5, density = 1) {
    const random = mulberry32(seed);
    const out = [];
    for (let i = 0; i < BELTS.length; i++) {
        const b = BELTS[i];
        for (let s = 0; s + 1 < b.points.length; s++) {
            const [ax, az] = b.points[s];
            const [bx, bz] = b.points[s + 1];
            const len = Math.hypot(bx - ax, bz - az);
            const dist = Math.hypot((ax + bx) / 2 - EYE.x, (az + bz) / 2 - EYE.z);
            // Far belts read as a canopy; their trees are fewer and larger.
            const spacing = (dist < 1200 ? 5.2 : 8.5) / Math.max(0.25, density);
            const n = Math.max(1, Math.floor(len / spacing));
            for (let k = 0; k < n; k++) {
                const t = (k + random()) / n;
                const across = (random() - 0.5) * b.width * 0.8;
                const nx = -(bz - az) / len;
                const nz = (bx - ax) / len;
                const x = ax + (bx - ax) * t + nx * across;
                const z = az + (bz - az) * t + nz * across;
                const pick = random();
                const kind = pickKind(b.kind, pick);
                const height = KIND_HEIGHT[kind] * (0.75 + random() * 0.45);
                const width = height * KIND_WIDTH[kind] * (0.85 + random() * 0.3);
                out.push(x, groundHeight(x, z), z, height, kind, random(), width, (random() - 0.5) * 0.06);
            }
        }
    }
    // A few lone trees in the fields (a birch by the path, an old larch on the ridge).
    const singles = [[-34, -150, 1], [96, -620, 0], [-640, -1160, 1], [420, -1180, 0], [-180, -880, 1]];
    singles.forEach(([x, z, kind]) => {
        const height = kind === 1 ? 17 : 24;
        out.push(x, groundHeight(x, z), z, height, kind, random(), height * (kind === 1 ? 0.46 : 0.38), 0.02);
    });
    return new Float32Array(out);
}

// ── The barley round the eye ──────────────────────────────────────────────────────

/** The bearings the near barley covers (degrees right of the view axis): the widest frame, and a margin. */
export const GRAIN_BEARINGS = Object.freeze([-56, 56]);

/**
 * The close stand: the stalks inside the clearing round the eye that only the portrait lens looks
 * down on (it sees the ground from 1.6 m out, the stand began at 2.5 m, and the bottom third of a
 * phone was bare floor). `near`/`far` metres from the eye, the portrait frame's bearings with the
 * lens's drift and the parallax, and the share of the near stand's count it carries at its own
 * crop density.
 */
export const CLOSE_STAND = Object.freeze({
    near: 1.25, far: 2.55, bearings: Object.freeze([-44, 20]), share: 0.0153,
});

/**
 * The barley's clumps round the eye: `count` sites between `near` and `far` metres, kept only where
 * barley grows. Inside `knee` metres they stand at a crop's own density (uniform over the ground);
 * beyond it, at constant density ON SCREEN (distance log-uniform: area density falls as 1/r²,
 * continuous at the knee). Instance data: (x, ground y, z, scale) + (seed, yaw, plot id,
 * fade) where fade runs from 1 to 0 over the last eighth of the reach (the land's carpet takes
 * over; `fade: false` keeps them whole to the edge). `bearings` the span they cover; `bank: false`
 * plants the clearing round the eye too (the close stand). Deterministic for a seed.
 */
export function grainSites({
    count, near, far, knee = near, seed = 0x6a7e, bearings = GRAIN_BEARINGS, bank = true, fade = true,
}) {
    const random = mulberry32(seed);
    const out = new Float32Array(count * 8);
    const k = Math.max(near, Math.min(far, knee));
    // The distance's density: r / k² inside the knee, 1 / r beyond it.
    const inner = (k * k - near * near) / (2 * k * k);
    const outer = Math.log(far / k);
    const distance = (v) => {
        const m = v * (inner + outer);
        return m < inner ? Math.sqrt(near * near + 2 * k * k * m) : k * Math.exp(m - inner);
    };
    const [b0, b1] = bearings;
    let n = 0;
    let tries = 0;
    while (n < count && tries < count * 6) {
        tries += 1;
        const r = distance(random());
        const bearing = b0 + (b1 - b0) * random();
        const a = (bearing * Math.PI) / 180;
        const x = EYE.x + Math.sin(a) * r;
        const z = EYE.z - Math.cos(a) * r;
        const cover = grainCover(x, z, { bank });
        if (random() > cover) continue;
        const o = n * 8;
        out[o] = x;
        out[o + 1] = groundHeight(x, z);
        out[o + 2] = z;
        out[o + 3] = 0.9 + random() * 0.22;
        out[o + 4] = random();
        out[o + 5] = random() * Math.PI * 2;
        out[o + 6] = plotAt(x, z).id;
        out[o + 7] = fade ? 1 - smooth(far * 0.86, far, r) : 1;
        n += 1;
    }
    return { data: out.subarray(0, n * 8), count: n };
}

// ── What the barley covers ────────────────────────────────────────────────────────

/**
 * Whether barley grows at a point (0..1): not on the path, not in a shelterbelt, not on the
 * lens's reach round the eye (unless `bank` is false), not on the fort's knoll.
 */
export function grainCover(x, z, { bank: clearing = true } = {}) {
    const { distance, along } = pathDistance(x, z);
    const onPath = 1 - smooth(PATH.track * 0.9, PATH.track + flowerWidth(along) * 0.95, distance);
    const belt = beltAt(x, z).cover;
    const F = PLACES.fort;
    const fort = 1 - smooth(F.radius * 0.9, F.radius * 1.3, Math.hypot(x - F.x, z - F.z));
    // No stalk brushes the lens.
    const bank = clearing ? 1 - smooth(1.2, 2.2, Math.hypot(x - EYE.x, z - EYE.z)) : 0;
    return clamp01(1 - Math.max(onPath, belt, fort, bank));
}
