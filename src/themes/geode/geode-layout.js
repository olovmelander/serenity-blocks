/**
 * Geode — the plan (CPU only, three-free, deterministic).
 *
 * Where everything stands inside the cavity:
 *
 *   relief    the wall's own lumps (the smooth egg pushed in and out by the noise field);
 *   clusters  eighteen hero clusters of large crystals, placed by hand round the frame — four
 *             to each side of the board, three above, three below, one in each near corner —
 *             each cut from one mineral, fanning out of a common root;
 *   crown     eight rings of crystals between the agate and the viewer, which only stand while
 *             a chain of clears is alive (ring k grows on the chain's k-th step past the first);
 *   druzy     the lining: thousands of small points, larger where they meet the agate's rim;
 *   stars     points of the lining that flash a four-pointed star when they catch the light.
 *
 * The hero list is ordered by importance (every cluster's tallest crystal first, then every
 * cluster's second…), so a quality tier takes the first N and keeps the whole composition.
 */

import {
    BAND_EDGE_WANDER,
    CAVITY,
    CROWN_RINGS,
    CROWN_W0,
    CROWN_W1,
    DEG,
    MINERALS,
    TAU,
    lerp,
    mulberry32,
    smooth,
    wallNormal,
    wallPoint,
    wallW,
} from './geode-core.js';

/** Hero clusters: (w°, phi°, size, mineral). phi 0 = right of the board, 90 = above it. */
export const CLUSTERS = Object.freeze([
    [78, 8, 1.15, 0], [80, 172, 1.2, 1], [86, 68, 0.95, 2], [84, 250, 0.95, 4],
    [93, -22, 1.0, 1], [91, 202, 1.0, 0], [84, 112, 0.95, 3], [88, 292, 0.95, 0],
    [70, 30, 0.85, 3], [72, 150, 0.85, 4], [96, 90, 0.9, 0], [97, 270, 0.9, 1],
    [99, 36, 1.0, 2], [98, 146, 1.0, 5], [106, 42, 1.1, 5], [106, 138, 1.1, 2],
    [107, 222, 1.1, 3], [107, 318, 1.1, 4],
]);

/** Crystals grown in each hero cluster (a tier draws the first few of each). */
export const CLUSTER_SIZE = 20;

/** The wall's relief at (w, phi): spans the surface stands in from the smooth egg. */
export function reliefAt(sample, w, phi) {
    const n1 = sample((phi / TAU) * 4, w * 0.55, 0) - 0.5;
    const n2 = sample((phi / TAU) * 10, w * 1.9 + 0.37, 1) - 0.5;
    const rough = smooth(CAVITY.wHeart, CAVITY.wBands + 0.25, w);
    return (n1 * 5.5 + n2 * 1.8) * (0.25 + 0.75 * rough);
}

/** Where the agate ends and the druzy begins round the axis (the edge is ragged). */
export function bandEdgeAt(sample, w, phi) {
    return CAVITY.wBands + (sample((phi / TAU) * 3, w * 0.9, 0) - 0.5) * BAND_EDGE_WANDER;
}

/** The mineral zone of the lining at (w, phi): a fractional index into the palette's minerals. */
export function zoneAt(sample, w, phi) {
    const v = sample((phi / TAU) * 3, w * 0.9, 2) * 1.7 + 0.1;
    return (v - Math.floor(v)) * MINERALS;
}

const normalize3 = (v) => {
    const inv = 1 / Math.max(1e-9, Math.hypot(v[0], v[1], v[2]));
    v[0] *= inv;
    v[1] *= inv;
    v[2] *= inv;
    return v;
};

/** Two unit tangents of the wall at a normal: `e1` round the axis, `e2` along the wall. */
function tangents(n) {
    const e1 = normalize3([-n[1], n[0], 0]);
    if (!(Math.hypot(e1[0], e1[1]) > 1e-6)) {
        e1[0] = 1;
        e1[1] = 0;
    }
    const e2 = [
        n[1] * e1[2] - n[2] * e1[1],
        n[2] * e1[0] - n[0] * e1[2],
        n[0] * e1[1] - n[1] * e1[0],
    ];
    return [e1, normalize3(e2)];
}

/**
 * @param {(x: number, y: number, channel: number) => number} sample  the baked noise field
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.crownPerRing=20]
 * @param {number} [opts.druzy=14000]
 * @param {number} [opts.stars=320]
 */
export function buildPlan(sample, {
    seed = 0x6e0de, crownPerRing = 20, druzy = 14000, stars = 320,
} = {}) {
    const rand = mulberry32(seed);
    const point = [0, 0, 0];
    const normal = [0, 0, 0];
    /** The lumpy wall's point at (w, phi). */
    const surface = (w, phi, out = [0, 0, 0]) => {
        wallPoint(w, phi, point);
        wallNormal(w, phi, normal);
        const r = reliefAt(sample, w, phi);
        out[0] = point[0] + normal[0] * r;
        out[1] = point[1] + normal[1] * r;
        out[2] = point[2] + normal[2] * r;
        return out;
    };

    const crystal = (root, axis, height, radius, extra) => ({
        x: root[0],
        y: root[1],
        z: root[2],
        axis,
        height,
        radius,
        yaw: rand() * TAU,
        seed: 1 + Math.floor(rand() * 4000),
        tip: [root[0] + axis[0] * height, root[1] + axis[1] * height, root[2] + axis[2] * height],
        w: wallW(root[0], root[1], root[2]),
        ring: 0,
        main: false,
        cluster: -1,
        mineral: 0,
        ...extra,
    });

    // ── Hero clusters ──
    const clusters = [];
    const perCluster = [];
    CLUSTERS.forEach(([wDeg, phiDeg, size, mineral], ci) => {
        const w = wDeg * DEG;
        const phi = phiDeg * DEG;
        const root = surface(w, phi);
        const n = wallNormal(w, phi);
        const [e1, e2] = tangents(n);
        clusters.push({
            w, phi, size, mineral, root, normal: [...n],
        });
        const list = [];
        // The tallest stands near the middle and leans a little; the rest fan out round it.
        const lean = [(rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3];
        const mainAxis = normalize3([
            n[0] + e1[0] * lean[0] + e2[0] * lean[1],
            n[1] + e1[1] * lean[0] + e2[1] * lean[1],
            n[2] + e1[2] * lean[0] + e2[2] * lean[1],
        ]);
        const tall = (11 + rand() * 4.5) * size;
        list.push(crystal(
            [root[0] - mainAxis[0] * 0.6, root[1] - mainAxis[1] * 0.6, root[2] - mainAxis[2] * 0.6],
            mainAxis,
            tall,
            tall * (0.085 + rand() * 0.02),
            { main: true, cluster: ci, mineral },
        ));
        for (let k = 1; k < CLUSTER_SIZE; k++) {
            const ang = rand() * TAU;
            const far = (0.25 + 0.75 * Math.sqrt(k / CLUSTER_SIZE)) * (0.7 + rand() * 0.5);
            const ox = Math.cos(ang) * far;
            const oy = Math.sin(ang) * far;
            const spread = 3.6 * size;
            const at = [
                root[0] + (e1[0] * ox + e2[0] * oy) * spread,
                root[1] + (e1[1] * ox + e2[1] * oy) * spread,
                root[2] + (e1[2] * ox + e2[2] * oy) * spread,
            ];
            // Every crystal points away from a root a little under the wall.
            const fan = 0.85 + rand() * 0.5;
            const axis = normalize3([
                mainAxis[0] + (e1[0] * ox + e2[0] * oy) * fan,
                mainAxis[1] + (e1[1] * ox + e2[1] * oy) * fan,
                mainAxis[2] + (e1[2] * ox + e2[2] * oy) * fan,
            ]);
            const h = tall * lerp(0.74, 0.2, far / 1.2) * (0.7 + rand() * 0.6);
            // The smaller a crystal, the stubbier.
            const r = h * lerp(0.17, 0.095, smooth(2, 10, h)) * (0.85 + rand() * 0.3);
            // Now and then a neighbour is cut from another mineral.
            const own = rand() < 0.82 ? mineral : (mineral + 1 + Math.floor(rand() * (MINERALS - 1))) % MINERALS;
            list.push(crystal(
                [at[0] - axis[0] * 0.5, at[1] - axis[1] * 0.5, at[2] - axis[2] * 0.5],
                axis,
                h,
                r,
                { cluster: ci, mineral: own },
            ));
        }
        // The main first, then the rest tallest first.
        const [main, ...rest] = list;
        rest.sort((p, q) => q.height - p.height);
        perCluster.push([main, ...rest]);
    });
    const heroes = [];
    for (let k = 0; k < CLUSTER_SIZE; k++) {
        for (let ci = 0; ci < perCluster.length; ci++) heroes.push(perCluster[ci][k]);
    }

    // ── The crown: rings that grow with the chain ──
    const crown = [];
    for (let ring = 1; ring <= CROWN_RINGS; ring++) {
        const w = lerp(CROWN_W0, CROWN_W1, (ring - 1) / (CROWN_RINGS - 1));
        const turn = rand() * TAU;
        for (let k = 0; k < crownPerRing; k++) {
            const phi = turn + ((k + (rand() - 0.5) * 0.5) / crownPerRing) * TAU;
            const wk = w + (rand() - 0.5) * 0.045;
            const root = surface(wk, phi);
            const n = wallNormal(wk, phi);
            const [e1, e2] = tangents(n);
            const jx = (rand() - 0.5) * 0.5;
            const jy = (rand() - 0.5) * 0.5 - 0.12;
            const axis = normalize3([
                n[0] + e1[0] * jx + e2[0] * jy,
                n[1] + e1[1] * jx + e2[1] * jy,
                n[2] + e1[2] * jx + e2[2] * jy,
            ]);
            const h = 4.6 + rand() * 4.2;
            crown.push(crystal(
                [root[0] - axis[0] * 0.4, root[1] - axis[1] * 0.4, root[2] - axis[2] * 0.4],
                axis,
                h,
                h * (0.1 + rand() * 0.035),
                { ring, mineral: ring - 1 },
            ));
        }
    }

    // ── The druzy lining ──
    const druzyBase = new Float32Array(druzy * 4);
    const druzyAxis = new Float32Array(druzy * 4);
    const druzyLook = new Float32Array(druzy * 4);
    const wEnd = 2.08;
    let placed = 0;
    let guard = 0;
    const at = [0, 0, 0];
    while (placed < druzy && guard < druzy * 30) {
        guard += 1;
        // Denser toward the agate's rim, where the eye rests.
        const w = lerp(CAVITY.wBands - BAND_EDGE_WANDER * 0.5, wEnd, rand() ** 1.2);
        const phi = rand() * TAU;
        if (rand() > Math.sin(w)) continue;
        const edge = bandEdgeAt(sample, w, phi);
        if (w < edge - 0.02) continue;
        surface(w, phi, at);
        const n = wallNormal(w, phi);
        const [e1, e2] = tangents(n);
        const jx = (rand() - 0.5) * 0.8;
        const jy = (rand() - 0.5) * 0.8;
        const axis = normalize3([
            n[0] + e1[0] * jx + e2[0] * jy,
            n[1] + e1[1] * jx + e2[1] * jy,
            n[2] + e1[2] * jx + e2[2] * jy,
        ]);
        // The points that border the agate stand tallest.
        const rim = Math.exp(-Math.max(0, w - edge) * 7);
        const h = (0.7 + rand() ** 2.4 * 1.9) * (1 + rim * 1.2);
        const o = placed * 4;
        druzyBase.set([at[0] - axis[0] * 0.2, at[1] - axis[1] * 0.2, at[2] - axis[2] * 0.2, h], o);
        druzyAxis.set([axis[0], axis[1], axis[2], h * (0.27 + rand() * 0.14)], o);
        druzyLook.set([rand() * TAU, zoneAt(sample, w, phi), 1 + Math.floor(rand() * 4000), w], o);
        placed += 1;
    }

    // ── Stars: points of the lining that flash ──
    const starPos = new Float32Array(stars * 4);
    const starLook = new Float32Array(stars * 4);
    for (let i = 0; i < stars; i++) {
        let w = 0;
        let phi = 0;
        for (let tries = 0; tries < 12; tries++) {
            w = lerp(CAVITY.wBands - BAND_EDGE_WANDER * 0.4, 1.98, rand() ** 1.15);
            phi = rand() * TAU;
            if (rand() < Math.sin(w) && w > bandEdgeAt(sample, w, phi)) break;
        }
        surface(w, phi, at);
        const n = wallNormal(w, phi);
        starPos.set([at[0] + n[0] * 0.7, at[1] + n[1] * 0.7, at[2] + n[2] * 0.7, w], i * 4);
        starLook.set([rand(), zoneAt(sample, w, phi), rand(), rand()], i * 4);
    }

    return {
        seed,
        clusters,
        heroes,
        crown,
        crownPerRing,
        /** Heroes first (by importance), then the crown ring by ring. */
        crystalsFor(heroCount) {
            const n = Math.max(CLUSTERS.length, Math.min(heroes.length, heroCount));
            return [...heroes.slice(0, n), ...crown];
        },
        druzy: {
            count: placed, base: druzyBase, axis: druzyAxis, look: druzyLook,
        },
        stars: { count: stars, pos: starPos, look: starLook },
        surface,
        relief: (w, phi) => reliefAt(sample, w, phi),
    };
}
