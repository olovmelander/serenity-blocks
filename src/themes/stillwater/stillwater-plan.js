/**
 * Stillwater — the lie of the land (CPU only, three-free).
 *
 * The tarn's shore, the height of the ground round it, and where everything that grows or lies
 * there stands: trunks, boulders, lily pads, reeds, ferns, glowing caps, the eyes in the far
 * wood. All of it is planned in STAGE space (before the narrow-frame squeeze) from fixed seeds,
 * so the same wood is built every time and the tests can walk it.
 */

import {
    DEG, EYE, SPIRIT, TROLL, clamp01, lerp, mulberry32, smooth,
} from './stillwater-core.js';

/** The stage's extent: what the terrain mesh and the shore map cover. */
export const STAGE = Object.freeze({
    x0: -44, x1: 44, z0: -74, z1: 13,
});

// ── Noise (value noise on an integer lattice; deterministic, no tables) ──────────

function hash2(ix, iz) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// ── The shore ───────────────────────────────────────────────────────────────────

/** How far the water reaches to the left at a depth z: [z, metres], far to near. */
const LEFT_SHORE = [
    [-74, 2.0], [-66, 4.5], [-56, 11.5], [-44, 16.5], [-32, 17.0], [-23, 14.6], [-17.5, 11.2], [-13.6, 7.9],
    [-10.2, 6.4], [-7, 6.0], [-3, 4.6], [1.5, 2.85], [4.5, 2.4], [13, 2.0],
];
/** …and to the right. */
const RIGHT_SHORE = [
    [-74, 2.0], [-66, 5.5], [-56, 13.0], [-44, 18.0], [-32, 17.8], [-24, 15.2], [-18.5, 12.0], [-14.6, 8.7],
    [-11, 7.4], [-7.5, 7.0], [-3, 5.4], [1.5, 3.25], [4.5, 2.7], [13, 2.2],
];
/** The near shore (the viewer stands just behind it) and the far one. */
const NEAR_SHORE_Z = 4.3;
const FAR_SHORE_Z = -66;

/** Catmull-Rom through [z, value] points sorted by rising z. */
function along(points, z) {
    const n = points.length;
    if (z <= points[0][0]) return points[0][1];
    if (z >= points[n - 1][0]) return points[n - 1][1];
    let i = 0;
    while (i < n - 2 && z > points[i + 1][0]) i += 1;
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = points[Math.max(0, i - 1)];
    const p3 = points[Math.min(n - 1, i + 2)];
    const t = (z - p1[0]) / (p2[0] - p1[0]);
    // Tangents by finite differences over the uneven spacing (keeps the curve from overshooting).
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * (p2[0] - p1[0]);
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * (p2[0] - p1[0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}

export const leftShore = (z) => along(LEFT_SHORE, z);
export const rightShore = (z) => along(RIGHT_SHORE, z);

/**
 * About how far a point is from the water's edge: positive on land, negative on the water.
 * (A smooth maximum of the four shores, so the corners of the tarn are round.)
 */
export function shoreDistance(x, z) {
    const k = 1.3;
    const a = -x - leftShore(z);
    const b = x - rightShore(z);
    const c = z - NEAR_SHORE_Z;
    const d = FAR_SHORE_Z - z;
    const m = Math.max(a, b, c, d);
    const sum = Math.exp(k * (a - m)) + Math.exp(k * (b - m)) + Math.exp(k * (c - m)) + Math.exp(k * (d - m));
    return m + Math.log(sum) / k;
}

// ── Level places: where the large things stand, the ground is made flat ──────────

/** Distance from a point to a segment in the plan, and how far along it the nearest point is. */
function toSegment(x, z, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / len2);
    return { dist: Math.hypot(x - (ax + dx * t), z - (az + dz * t)), t };
}

/** The troll's path from his seat down to the water: a level track 1.2 m to either side. */
export function trollTrack(x, z) {
    const s = toSegment(x, z, TROLL.home[0], TROLL.home[2], TROLL.reach[0], TROLL.reach[2]);
    return { weight: 1 - smooth(0.9, 2.3, s.dist), height: lerp(TROLL.home[1], TROLL.reach[1], smooth(0, 1, s.t)) };
}

/** The rest camera's own footing. */
const FOOTING = Object.freeze({
    x: EYE.x, z: EYE.z + 0.4, radius: 3.2, height: 0.3,
});

/** Height of the ground (and of the tarn's bed, which is negative) at a stage point. */
export function groundHeight(x, z) {
    const d = shoreDistance(x, z);
    if (d <= 0) {
        // The bed: it shelves away from the edge and lies under a few stones.
        const bed = Math.max(-2.8, d * 0.34);
        const rough = (valueNoise(x * 0.42 + 3.1, z * 0.42 - 7.7) - 0.5) * 0.28 * Math.min(1, -d * 0.8);
        return bed + rough;
    }
    const n1 = valueNoise(x * 0.085 + 11.3, z * 0.085 - 4.1);
    const n2 = valueNoise(x * 0.27 - 2.4, z * 0.27 + 9.6);
    const n3 = valueNoise(x * 0.95 + 5.5, z * 0.95 + 1.2);
    // A lip of turf at the water, then mounds of moss, then the wood's floor climbing away.
    let h = 0.3 * (1 - Math.exp(-d * 1.9)) + 0.05 * d
        + (n1 - 0.36) * 1.3 * smooth(0.6, 9, d)
        + (n2 - 0.5) * 0.5 * smooth(0.25, 3.5, d)
        + (n3 - 0.5) * 0.09 * smooth(0.1, 1.2, d)
        + Math.min(5, 0.0042 * d * d);
    h = Math.max(h, 0.02 + 0.02 * Math.min(d, 1));
    // The level places end where the bank does: at the water's edge the ground is the bank's own,
    // so it meets the water without a step.
    const dry = smooth(0, 0.6, d);
    const track = trollTrack(x, z);
    if (track.weight > 0) h = lerp(h, track.height, track.weight * dry);
    const foot = 1 - smooth(FOOTING.radius * 0.45, FOOTING.radius, Math.hypot(x - FOOTING.x, z - FOOTING.z));
    if (foot > 0) h = lerp(h, FOOTING.height, foot * dry);
    return h;
}

/** The slope of the ground (a unit normal) by central differences. */
export function groundNormal(x, z, out = [0, 1, 0], step = 0.35) {
    const hx = groundHeight(x + step, z) - groundHeight(x - step, z);
    const hz = groundHeight(x, z + step) - groundHeight(x, z - step);
    const nx = -hx;
    const ny = 2 * step;
    const nz = -hz;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
    return out;
}

// ── Sight lines ─────────────────────────────────────────────────────────────────

/** The azimuth (radians, + to the right) of a stage point from the rest camera. */
export function azimuthOf(x, z) {
    return Math.atan2(x - EYE.x, EYE.z - z);
}

/** Distance in the plan from the rest camera. */
export function rangeOf(x, z) {
    return Math.hypot(x - EYE.x, z - EYE.z);
}

/**
 * Windows of the view nothing tall may stand in: the mist behind the spirit, the moon above her,
 * the troll and his lantern, and the troll's walk. [az0, az1 (degrees), nearest range, furthest].
 */
const KEEP_CLEAR = Object.freeze([
    [-28.5, -15.5, 0, 46],
    [-23.5, -15.5, 46, 200],
    [18.5, 30.5, 9, 40],
]);

export function inKeepClear(x, z, margin = 0) {
    const az = azimuthOf(x, z) / DEG;
    const range = rangeOf(x, z);
    for (let i = 0; i < KEEP_CLEAR.length; i++) {
        const w = KEEP_CLEAR[i];
        const half = (Math.atan2(margin, range) / DEG) || 0;
        if (az > w[0] - half && az < w[1] + half && range >= w[2] && range <= w[3]) return true;
    }
    return false;
}

// ── Trunks ──────────────────────────────────────────────────────────────────────

/** The trees placed by hand: the two giants that frame the view, and the ranks behind the figures. */
const HERO_TRUNKS = Object.freeze([
    {
        x: -3.75, z: 1.15, radius: 0.58, height: 27, lean: [-0.012, -0.01], roots: 1,
    },
    {
        x: 4.2, z: 0.45, radius: 0.62, height: 29, lean: [0.014, 0.0], roots: 1,
    },
    {
        x: -9.9, z: -6.2, radius: 0.42, height: 24, lean: [0.02, 0.01], roots: 0.7,
    },
    {
        x: -12.6, z: -13.4, radius: 0.5, height: 26, lean: [0.035, 0.0], roots: 0.8,
    },
    {
        x: 12.5, z: -13.6, radius: 0.55, height: 27, lean: [-0.03, 0.01], roots: 0.9,
    },
    {
        x: 12.9, z: -7.8, radius: 0.46, height: 25, lean: [-0.02, 0.0], roots: 0.7,
    },
    {
        x: -16.4, z: -21.5, radius: 0.4, height: 24, lean: [0.02, 0.0], roots: 0.6,
    },
    {
        x: 17.9, z: -22.5, radius: 0.42, height: 25, lean: [-0.015, 0.0], roots: 0.6,
    },
]);

/**
 * Every trunk: the hand-placed ones, then a scatter over the banks that keeps the sight lines
 * open. Each: { x, y, z, radius, height, lean: [x, z] per metre of height, roots 0..1, seed }.
 */
export function planTrunks(count = 70, seed = 4407) {
    const rand = mulberry32(seed);
    const out = [];
    HERO_TRUNKS.forEach((t, i) => {
        out.push({
            ...t, lean: [...t.lean], y: groundHeight(t.x, t.z) - 0.25, seed: i * 7.31 + 1.7, hero: true,
        });
    });
    let guard = 0;
    while (out.length < count && guard < count * 60) {
        guard += 1;
        const x = lerp(STAGE.x0 + 3, STAGE.x1 - 3, rand());
        const z = lerp(STAGE.z0 + 4, 4, rand());
        const pick = rand();
        const size = rand();
        const d = shoreDistance(x, z);
        if (d < 0.9 || d > 30) continue;
        const range = rangeOf(x, z);
        if (range < 9) continue;
        const radius = lerp(0.3, 0.62, size * size);
        if (inKeepClear(x, z, radius + 0.5)) continue;
        // Thinner further from the water (the wall of the wood is the far function's job).
        if (pick > 1.15 - d / 34) continue;
        if (trollTrack(x, z).weight > 0) continue;
        let near = false;
        for (let i = 0; i < out.length && !near; i++) {
            near = Math.hypot(out[i].x - x, out[i].z - z) < 1.9 + out[i].radius + radius;
        }
        if (near) continue;
        out.push({
            x,
            y: groundHeight(x, z) - 0.25,
            z,
            radius,
            height: lerp(19, 27, rand()),
            lean: [(rand() - 0.5) * 0.05, (rand() - 0.5) * 0.03],
            roots: 0.35 + rand() * 0.4,
            seed: rand() * 100,
            hero: false,
        });
    }
    return out;
}

// ── Boulders ────────────────────────────────────────────────────────────────────

/** The stones placed by hand: the spirit's, the troll's seat, and those that break the water. */
const HERO_BOULDERS = Object.freeze([
    // The spirit's stone: low and flat-topped at the left bank's point.
    {
        x: SPIRIT.home[0], z: SPIRIT.home[2], size: [1.2, 0.6, 1.0], sink: 0.34, flat: 1,
    },
    // The troll's seat, at his back.
    {
        x: TROLL.home[0] + 1.75, z: TROLL.home[2] - 0.7, size: [1.7, 1.25, 1.4], sink: 0.4, flat: 0,
    },
    // Stones in the water.
    {
        x: -4.9, z: -2.6, size: [0.75, 0.42, 0.6], sink: 0.2, flat: 0,
    },
    {
        x: -8.6, z: -13.3, size: [0.9, 0.5, 0.7], sink: 0.24, flat: 0,
    },
    {
        x: 5.7, z: -5.0, size: [0.85, 0.46, 0.7], sink: 0.22, flat: 0,
    },
    {
        x: 9.6, z: -15.8, size: [1.1, 0.6, 0.85], sink: 0.28, flat: 0,
    },
    {
        x: -2.7, z: 2.5, size: [0.62, 0.34, 0.5], sink: 0.16, flat: 0,
    },
    {
        x: 3.3, z: 2.2, size: [0.7, 0.4, 0.55], sink: 0.2, flat: 0,
    },
]);

/**
 * How far above its middle the flat-laid stone's top is, as a share of its planned height (the
 * stone's mesh is lumpy, not a sphere; pinned against the mesh itself by the meshes test).
 */
export const STONE_TOP = 0.82;

/** Each boulder: { x, y (centre), z, size: [rx, ry, rz], yaw, seed, flat }. */
export function planBoulders(count = 30, seed = 913) {
    const rand = mulberry32(seed);
    const out = [];
    const place = (b, i) => {
        const ground = Math.max(groundHeight(b.x, b.z), -0.2);
        out.push({
            x: b.x,
            // (The stone's mesh reaches about 0.65 of its height below its middle: every one is bedded.)
            y: ground + b.size[1] * (0.45 - b.sink),
            z: b.z,
            size: [...b.size],
            yaw: i * 1.37,
            seed: i * 3.71 + 0.5,
            flat: b.flat,
            hero: true,
        });
    };
    HERO_BOULDERS.forEach(place);
    // The spirit's stone has its top where she stands.
    out[0].y = SPIRIT.home[1] - out[0].size[1] * STONE_TOP;
    let guard = 0;
    while (out.length < count && guard < count * 60) {
        guard += 1;
        const x = lerp(-26, 26, rand());
        const z = lerp(-40, 3.6, rand());
        const size = rand();
        const yaw = rand() * 6.283;
        const squash = rand();
        const d = shoreDistance(x, z);
        if (d < -1.6 || d > 4.5) continue;
        if (Math.hypot(x - EYE.x, z - EYE.z) < 3.4) continue;
        if (trollTrack(x, z).weight > 0) continue;
        if (Math.hypot(x - SPIRIT.home[0], z - SPIRIT.home[2]) < 2.2) continue;
        const r = lerp(0.28, 1.0, size * size);
        let near = false;
        for (let i = 0; i < out.length && !near; i++) {
            near = Math.hypot(out[i].x - x, out[i].z - z) < (out[i].size[0] + r) * 1.15;
        }
        if (near) continue;
        const ry = r * lerp(0.5, 0.78, squash);
        out.push({
            x,
            y: Math.max(groundHeight(x, z), -0.25) + ry * 0.42,
            z,
            size: [r, ry, r * lerp(0.75, 1.05, rand())],
            yaw,
            seed: rand() * 100,
            flat: 0,
            hero: false,
        });
    }
    return out;
}

// ── Lily pads ───────────────────────────────────────────────────────────────────

/** Each pad: { x, z, size, yaw, flower 0|1, seed, side −1|+1 }. Rafts of them lie off both banks. */
export function planLilies(count = 46, seed = 2718) {
    const rand = mulberry32(seed);
    const rafts = [
        [-5.6, -4.2, 1.9], [-4.3, -8.2, 1.7], [-7.8, -15.8, 2.4], [-3.4, 0.4, 1.3], [-9.5, -21, 2.6],
        [5.9, -7.6, 1.9], [4.6, -2.2, 1.6], [8.6, -17.5, 2.5], [3.9, 1.0, 1.2], [11.5, -24, 2.6],
    ];
    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 80) {
        guard += 1;
        const raft = rafts[Math.floor(rand() * rafts.length)];
        const a = rand() * 6.283;
        const r = Math.sqrt(rand()) * raft[2];
        const x = raft[0] + Math.cos(a) * r * 1.25;
        const z = raft[1] + Math.sin(a) * r;
        const size = lerp(0.17, 0.34, rand());
        const yaw = rand() * 6.283;
        const flower = rand() < 0.3 ? 1 : 0;
        if (shoreDistance(x, z) > -0.55) continue;
        let near = false;
        for (let i = 0; i < out.length && !near; i++) {
            near = Math.hypot(out[i].x - x, out[i].z - z) < (out[i].size + size) * 1.05;
        }
        if (near) continue;
        out.push({
            x, z, size, yaw, flower, seed: rand() * 100, side: x < 0 ? -1 : 1,
        });
    }
    return out;
}

// ── Reeds, ferns ────────────────────────────────────────────────────────────────

/** Each reed: { x, y, z, height, lean, seed }. They stand in the shallows in clumps. */
export function planReeds(count = 520, seed = 5519) {
    const rand = mulberry32(seed);
    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 40) {
        guard += 1;
        const x = lerp(-24, 24, rand());
        const z = lerp(-36, 3.9, rand());
        const h = rand();
        const lean = rand();
        const d = shoreDistance(x, z);
        if (d < -1.15 || d > 0.3) continue;
        // None right under the viewer's nose: a blade a metre off is a bar across the picture.
        if (rangeOf(x, z) < 7.5) continue;
        // Clumps: a slow noise decides where reeds grow at all.
        if (valueNoise(x * 0.33 + 40, z * 0.33 - 17) < 0.46) continue;
        if (Math.hypot(x - SPIRIT.home[0], z - SPIRIT.home[2]) < 1.5) continue;
        if (trollTrack(x, z).weight > 0.5) continue;
        out.push({
            x,
            y: Math.max(groundHeight(x, z), -0.5),
            z,
            height: lerp(0.55, 1.45, h * h * 0.6 + h * 0.4),
            lean: (lean - 0.5) * 0.5,
            seed: rand() * 100,
        });
    }
    return out;
}

/** Each fern: { x, y, z, size, yaw, seed, normal }. Crowns of fronds on the banks. */
export function planFerns(count = 150, seed = 8123) {
    const rand = mulberry32(seed);
    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 40) {
        guard += 1;
        const x = lerp(-22, 22, rand());
        const z = lerp(-34, 9, rand());
        const size = lerp(0.45, 1.0, rand());
        const yaw = rand() * 6.283;
        const d = shoreDistance(x, z);
        if (d < 0.35 || d > 9) continue;
        if (valueNoise(x * 0.22 - 8, z * 0.22 + 31) < 0.4) continue;
        if (Math.hypot(x - EYE.x, z - EYE.z) < 2.0) continue;
        if (trollTrack(x, z).weight > 0.3) continue;
        out.push({
            x, y: groundHeight(x, z), z, size, yaw, seed: rand() * 100,
        });
    }
    return out;
}

// ── Glowing caps ────────────────────────────────────────────────────────────────

/**
 * Small glowing mushrooms in rings and drifts on both banks. Each: { x, y, z, size, seed,
 * side, order } — `order` 0..1 runs from the frame's edge in toward the board on its own side,
 * which is the order a chain lights them in.
 */
export function planCaps(count = 90, seed = 3301) {
    const rand = mulberry32(seed);
    const drifts = [
        [-4.6, 2.0, 0.9], [-6.3, -2.6, 1.2], [-8.3, -8.4, 1.3], [-10.6, -11.2, 1.5], [-5.2, -1.2, 0.7],
        [5.2, 1.6, 0.9], [7.2, -3.4, 1.2], [8.9, -8.2, 1.2], [10.6, -10.2, 1.3], [12.2, -15.5, 1.6],
        [-13.5, -17, 1.8], [14.2, -19, 1.8],
    ];
    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 60) {
        guard += 1;
        const drift = drifts[Math.floor(rand() * drifts.length)];
        const a = rand() * 6.283;
        const r = (0.35 + 0.65 * Math.sqrt(rand())) * drift[2];
        const x = drift[0] + Math.cos(a) * r;
        const z = drift[1] + Math.sin(a) * r * 0.8;
        const size = lerp(0.05, 0.13, rand());
        const d = shoreDistance(x, z);
        if (d < 0.15 || d > 7) continue;
        if (trollTrack(x, z).weight > 0.4) continue;
        out.push({
            x, y: groundHeight(x, z), z, size, seed: rand() * 100, side: x < 0 ? -1 : 1, order: 0,
        });
    }
    // Outside in, per side, by where each stands in the frame.
    [-1, 1].forEach((side) => {
        const mine = out.filter((c) => c.side === side)
            .sort((a, b) => Math.abs(azimuthOf(b.x, b.z)) - Math.abs(azimuthOf(a.x, a.z)));
        mine.forEach((c, i) => {
            c.order = mine.length > 1 ? i / (mine.length - 1) : 0;
        });
    });
    return out;
}

// ── Eyes in the far wood ────────────────────────────────────────────────────────

/**
 * Pairs of eyes between the far trunks. Each: { x, y, z, gap, size, seed, rank } — `rank` 0..1
 * is the order they open in as a chain grows (the shyest last). None stands behind the card.
 */
export function planEyes(pairs = 28, seed = 6007) {
    const rand = mulberry32(seed);
    const out = [];
    let guard = 0;
    while (out.length < pairs && guard < pairs * 400) {
        guard += 1;
        // (Inside the widest frame the game is composed for: an eye nobody can see takes no turn.)
        const az = (rand() < 0.5 ? -1 : 1) * lerp(9.5, 33, rand()) * DEG;
        const range = lerp(26, 80, rand());
        const x = EYE.x + Math.sin(az) * range;
        const z = EYE.z - Math.cos(az) * range;
        const up = rand();
        const size = rand();
        if (shoreDistance(x, z) < 1.2) continue;
        if (Math.abs(az) > 15.5 * DEG && Math.abs(az) < 23.5 * DEG && az < 0) continue; // the moon's own gap
        let near = false;
        for (let i = 0; i < out.length && !near; i++) {
            near = Math.abs(azimuthOf(out[i].x, out[i].z) - az) < 0.85 * DEG;
        }
        if (near) continue;
        out.push({
            x,
            y: groundHeight(x, z) + lerp(0.7, 3.4, up * up),
            z,
            gap: lerp(0.16, 0.36, size),
            size: lerp(0.05, 0.11, size),
            seed: rand() * 100,
            rank: 0,
        });
    }
    out.forEach((e, i) => {
        e.rank = out.length > 1 ? i / (out.length - 1) : 0;
    });
    return out;
}

// ── The shore map ───────────────────────────────────────────────────────────────

export const SHORE_MAP = Object.freeze({ size: 256, span: 6 });

/**
 * The signed distance to the shore over the stage, as bytes: 0.5 at the water's edge, rising
 * onto land and falling out over the water, saturating SHORE_MAP.span metres either way. The
 * water reads it for its shallows and the line where it meets the bank.
 */
export function bakeShoreMap(size = SHORE_MAP.size) {
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) {
        const z = lerp(STAGE.z0, STAGE.z1, (j + 0.5) / size);
        for (let i = 0; i < size; i++) {
            const x = lerp(STAGE.x0, STAGE.x1, (i + 0.5) / size);
            const d = shoreDistance(x, z);
            const v = Math.round(clamp01(d / (SHORE_MAP.span * 2) + 0.5) * 255);
            const o = (j * size + i) * 4;
            data[o] = v;
            data[o + 1] = v;
            data[o + 2] = v;
            data[o + 3] = 255;
        }
    }
    return data;
}

// ── Saplings ────────────────────────────────────────────────────────────────────

/**
 * Young spruces on the banks, between the trunks. Each: { x, y, z, height, width, yaw, seed }.
 * They keep off the figures' ground and out of the sight lines.
 */
export function planSaplings(count = 140, seed = 7717) {
    const rand = mulberry32(seed);
    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 60) {
        guard += 1;
        const x = lerp(STAGE.x0 + 2, STAGE.x1 - 2, rand());
        const z = lerp(STAGE.z0 + 3, 5, rand());
        const tall = rand();
        const width = lerp(0.8, 1.25, rand());
        const yaw = rand() * 6.283;
        const d = shoreDistance(x, z);
        if (d < 1.3 || d > 26) continue;
        const range = rangeOf(x, z);
        if (range < 8) continue;
        // Thickets: they come up where the light once got in.
        if (valueNoise(x * 0.13 + 71, z * 0.13 - 23) < 0.42) continue;
        const height = lerp(1.4, 7.5, tall * tall);
        if (inKeepClear(x, z, 1.2) && range < 30) continue;
        if (trollTrack(x, z).weight > 0) continue;
        if (Math.hypot(x - SPIRIT.home[0], z - SPIRIT.home[2]) < 3) continue;
        out.push({
            x, y: groundHeight(x, z), z, height, width, yaw, seed: rand() * 100,
        });
    }
    return out;
}
