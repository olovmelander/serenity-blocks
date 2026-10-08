/**
 * Cinder Drift — the chamber's plan (CPU only, three-free, seeded and deterministic).
 *
 * A magma chamber of columnar basalt. Two cliffs of tall columns run down the chamber and close
 * in a throat at its far end; broken columns step down from their feet into the lake; islands of
 * columns stand in the lava; more hang from the roof like organ pipes. The great fall pours out
 * of the left cliff, and the night looks in through one hole in the roof on the right.
 *
 * The plan is a height function (how high the rock stands at a point, or −1 over the lake) and
 * the list of columns cut from it. Each column also carries what the light needs and a shader
 * cannot find out: the height below which its neighbours hide it from the lake and from the
 * fall, how open it stands, and which way the open lake lies.
 */

import {
    FALL, FISSURE_Z, FOUNTAIN_SLOTS, LAKE, SKYLIGHT, STREAM_SLOTS, TAU, clamp01, mulberry32, smooth,
} from './cinder-drift-core.js';

/** Floats per column in the packed plan: see `packColumns`. */
export const COLUMN_STRIDE = 12;

/** The shore-distance grid over LAKE (texels a side) and the distance it saturates at. */
export const SHORE_SIZE = 128;
export const SHORE_REACH = 36;

/** The mouth the great fall pours out of: its radius in the cliff's face, and its height. */
export const MOUTH = Object.freeze({ radius: 5.4, height: 5.6 });

/** Where the camera stands (the plan sizes its columns by how far away they are). */
const EYE = Object.freeze([0, 3.2, 0]);

/** Islands of columns in the lake: centre, radius, the height of their tallest column. */
export const ISLANDS = Object.freeze([
    // The two stacks that frame the picture, hard against its edges.
    {
        x: -13.4, z: -12.5, r: 3.4, h: 4.4,
    },
    {
        x: 12.4, z: -10.8, r: 3.8, h: 6.0,
    },
    // The island the skylight falls on.
    {
        x: SKYLIGHT.foot[0], z: SKYLIGHT.foot[2], r: 7.5, h: 8.5,
    },
    {
        x: 27, z: -52, r: 5.2, h: 9.5,
    },
    {
        x: -15, z: -60, r: 5.0, h: 6.5,
    },
    {
        x: -34, z: -150, r: 8, h: 17,
    },
    {
        x: 34, z: -168, r: 9, h: 14,
    },
    {
        x: 4, z: -196, r: 7, h: 11,
    },
]);

function hash2(ix, iy, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x, y, seed = 0) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Three octaves of value noise in [0, 1]. */
export function fbm(x, y, seed = 0) {
    return (valueNoise(x, y, seed) * 4 + valueNoise(x * 2.03, y * 2.03, seed + 17) * 2
        + valueNoise(x * 4.11, y * 4.11, seed + 31)) / 7;
}

/** The left cliff's face (x < 0) at depth z down the chamber. */
export function leftWallX(z) {
    const open = smooth(0, 90, -z);
    const close = smooth(150, 232, -z);
    return -(24 + 28 * open - 30 * close * close + 3.2 * Math.sin(z * 0.047 + 0.7) + 1.6 * Math.sin(z * 0.131 + 2.1));
}

/** The right cliff's face (x > 0). */
export function rightWallX(z) {
    const open = smooth(0, 100, -z);
    const close = smooth(160, 232, -z);
    return 26 + 30 * open - 32 * close * close + 3.0 * Math.sin(z * 0.041 + 4.0) + 1.8 * Math.sin(z * 0.117 + 0.4);
}

/** The far wall's face. */
export function farWallZ(x) {
    return -232 + 6 * Math.sin(x * 0.06 + 1.0);
}

/**
 * Build the plan.
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.detail=1]  column spacing scale (a lower tier asks for coarser columns)
 */
export function buildPlan({ seed = 0x51cd, detail = 1 } = {}) {
    const s0 = seed | 0;

    /** Roof height over a point. */
    const mouthX = leftWallX(FALL.z);
    const ceilingAt = (x, z) => 39 + 10 * fbm(x * 0.021, z * 0.021, s0 + 3)
        + 3.5 * Math.sin(z * 0.019 + 0.6) - 0.0016 * x * x
        + 8 * Math.exp(-((x - mouthX) ** 2 + (z - FALL.z) ** 2) / 200);

    /**
     * The nearest cliff at a point: how far inside it the point is (metres; negative over the open
     * chamber) and a coordinate that runs along it. One reused record: read it before asking again.
     */
    const wall = { depth: 0, along: 0 };
    const wallAt = (x, z) => {
        const dl = leftWallX(z) - x;
        const dr = x - rightWallX(z);
        const df = farWallZ(x) - z;
        if (df >= dl && df >= dr) {
            wall.depth = df;
            wall.along = x + 900;
        } else if (dl > dr) {
            wall.depth = dl;
            wall.along = z;
        } else {
            wall.depth = dr;
            wall.along = z + 400;
        }
        return wall;
    };
    const wallDepth = (x, z) => wallAt(x, z).depth;

    /** Signed depth into the nearest island (positive inside), and that island's height there. */
    const islandAt = (x, z, out) => {
        let best = -Infinity;
        let height = -1;
        for (let i = 0; i < ISLANDS.length; i++) {
            const isle = ISLANDS[i];
            const dx = x - isle.x;
            const dz = z - isle.z;
            const reach = Math.sqrt(dx * dx + dz * dz);
            // (Far from an island its lobes do not matter: the plan asks this a quarter of a
            // million times.)
            let d = isle.r - reach;
            if (reach < isle.r * 1.32 + 12) {
                const a = Math.atan2(dz, dx);
                d = isle.r * (1 + 0.22 * Math.sin(a * 3 + i * 1.7) + 0.1 * Math.sin(a * 7 + i)) - reach;
            }
            if (d > best) {
                best = d;
                height = d > 0
                    ? 0.5 + isle.h * clamp01(d / isle.r) ** 0.62 * (0.55 + 0.7 * valueNoise(x * 0.33, z * 0.33, s0 + 41 + i))
                    : -1;
            }
        }
        out.depth = best;
        out.height = height;
        return out;
    };
    const isle = { depth: 0, height: -1 };

    /** Width of the broken foreshore at the cliff's foot (0 where the cliff plunges straight in). */
    const foreshoreAlong = (s) => Math.max(0, 10.5 * valueNoise(s * 0.045, 11.7, s0 + 5) - 3.4);
    const foreshore = (x, z) => foreshoreAlong(wallAt(x, z).along);

    /** Signed depth into rock of any kind (positive inside, negative = metres of open lava). */
    const depthAt = (x, z) => {
        const dw = wallDepth(x, z);
        islandAt(x, z, isle);
        return Math.max(dw, isle.depth);
    };

    /** How high the rock stands at a point, or −1 over the lake. */
    const heightAt = (x, z) => {
        const { depth: dw, along: s } = wallAt(x, z);
        let h = -1;
        if (dw >= 0) {
            // The cliff: a first row broken off at a ledge that wanders along the wall, the rows
            // behind it standing higher, the third reaching the roof.
            const ledge = 3.5 + 30 * valueNoise(s * 0.033, 7.3, s0 + 7) ** 1.7;
            const rise = 10 + 24 * valueNoise(s * 0.061, 3.1, s0 + 9);
            h = ledge + rise * (dw / 2.4) ** 1.25;
        } else {
            const f = foreshoreAlong(s);
            if (f > 0 && dw > -f) {
                const k = 1 + dw / f;
                h = (0.3 + 5.2 * k * k) * (0.3 + 1.15 * valueNoise(x * 0.23, z * 0.23, s0 + 13));
            }
        }
        islandAt(x, z, isle);
        if (isle.height > h) h = isle.height;
        // (The roof is nowhere lower than this: only tall rock needs to ask where it is.)
        return h > 18 ? Math.min(h, ceilingAt(x, z)) : h;
    };

    // ── The great fall and the fissures a chain of clears opens ──
    const fallWall = mouthX;
    const fall = {
        lip: [fallWall - 1.2, FALL.lipY, FALL.z],
        foot: [fallWall + FALL.reach, 0, FALL.z + 5.5],
        width: FALL.width,
    };
    /** The fall's light, as the rock sees it: a point a third of the way up the cascade. */
    const fallLight = [fall.foot[0] - 1.2, 11, fall.foot[2] - 1];
    // Alternating sides, nearest first, each clear of the card at the rest camera.
    const streamSites = [
        { side: 1, z: -62, y: 17 }, { side: -1, z: -58, y: 15 }, { side: 1, z: -124, y: 27 },
        { side: -1, z: -146, y: 30 }, { side: 1, z: -176, y: 24 }, { side: -1, z: -186, y: 22 },
    ];
    /** Step x by `step` until (x, z) has at least `-clear` metres of open lava round it. */
    const clearOfRock = (x, z, step, clear) => {
        let at = x;
        for (let k = 0; k < 40 && depthAt(at, z) > clear; k++) at += step;
        return at;
    };
    const streams = streamSites.slice(0, STREAM_SLOTS).map((site, i) => {
        const face = site.side < 0 ? leftWallX(site.z) : rightWallX(site.z);
        const f = foreshore(face, site.z);
        return {
            lip: [face + site.side * 0.5, site.y, site.z],
            foot: [clearOfRock(face - site.side * (1.6 + f), site.z + 1.2, -site.side * 0.5, -0.8), 0, site.z + 1.2],
            width: 1.5 + 0.5 * hash2(i, 3, s0),
            side: site.side,
        };
    });

    /** The fissure a clear opens across the lake: fountain feet, from beside the card outward. */
    const fountains = [];
    for (let i = 0; i < FOUNTAIN_SLOTS; i++) {
        const pair = Math.floor(i / 2);
        const side = i % 2 ? 1 : -1;
        const z = FISSURE_Z + 5 * (hash2(i, 9, s0) - 0.5) - pair * 1.6;
        const x = side * ((side > 0 ? 15.8 : 9.5) + pair * (side > 0 ? 3.6 : 4.3) + 1.2 * (hash2(i, 5, s0) - 0.5));
        fountains.push({ x: clearOfRock(x, z, -side, -2.5), z });
    }

    // ── Columns ──
    const columns = [];
    const rand = mulberry32(s0 + 101);
    const hx0 = LAKE.x0 + 55;
    const hx1 = LAKE.x1 - 55;
    const addBand = (near, far, spacing) => {
        const s = spacing * detail;
        const rowStep = s * 0.866;
        const rows = Math.ceil((14 - (LAKE.z0 + 60)) / rowStep);
        const cols = Math.ceil((hx1 - hx0) / s);
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const jx = (rand() - 0.5) * 0.3 * s;
                const jz = (rand() - 0.5) * 0.3 * s;
                const jr = rand();
                const jh = rand();
                const x = hx0 + (i + (j % 2) * 0.5) * s + jx;
                const z = 14 - j * rowStep + jz;
                const dist = Math.hypot(x - EYE[0], z - EYE[2]);
                // (Nothing behind the camera is ever seen.)
                if (dist < near || dist >= far || z > 4) continue;
                const top = heightAt(x, z);
                const roof = ceilingAt(x, z);
                const dw = wallDepth(x, z);
                // The mouth of the fall: the cliff's columns are cut off at the lip, and the
                // roof's hang down over them in an arch.
                const dm = Math.hypot(x - fall.lip[0], z - fall.lip[2]);
                const inMouth = dw > -1.5 && dm < MOUTH.radius;
                if (inMouth && top > 0) {
                    columns.push({
                        x, z, y0: -1.2, y1: FALL.lipY - 0.35 - jh * 0.5, radius: s * (0.585 + 0.05 * jr), rot: rand() * TAU, seed: rand(), hang: 0, dist,
                    });
                    const arch = Math.min(roof - 0.8, FALL.lipY + MOUTH.height - (dm / MOUTH.radius) ** 2 * (MOUTH.height - 1.2) + (jr - 0.5) * 0.8);
                    columns.push({
                        x, z, y0: roof + 1.5, y1: arch, radius: s * (0.585 + 0.05 * jr), rot: rand() * TAU, seed: rand(), hang: 1, dist,
                    });
                } else if (top > 0) {
                    // Deep in the cliff only the first row that reaches the roof can be seen.
                    if (top >= roof - 0.4 && dw > s) {
                        const lx = leftWallX(z) - x;
                        const rx = x - rightWallX(z);
                        const fz = farWallZ(x) - z;
                        let px = x;
                        let pz = z;
                        if (fz >= lx && fz >= rx) pz += s;
                        else if (lx > rx) px += s;
                        else px -= s;
                        if (heightAt(px, pz) >= ceilingAt(px, pz) - 0.4) continue;
                    }
                    // Columns break at their own heights: more so the taller they stand.
                    const broken = top >= roof - 0.4 ? top + 1.5 : Math.max(0.25, top * (0.82 + 0.3 * jh) + (jh - 0.5) * 0.7);
                    columns.push({
                        x, z, y0: -1.2, y1: Math.min(broken, roof + 1.5), radius: s * (0.585 + 0.05 * jr), rot: rand() * TAU, seed: rand(), hang: 0, dist,
                    });
                } else if (z < -34 && dw < -1.5) {
                    // Organ pipes under the roof, in clusters; none round the skylight.
                    const cluster = fbm(x * 0.045, z * 0.045, s0 + 23);
                    const hole = Math.hypot(x - SKYLIGHT.top[0], z - SKYLIGHT.top[2]);
                    if (cluster > 0.535 && hole > SKYLIGHT.radius + 2.5) {
                        // (Now and then one pipe hangs far below its neighbours.)
                        const length = Math.min(22, (cluster - 0.535) * 70 * (0.45 + 0.9 * jh) + 0.8 + (jr > 0.9 ? 2 + jh * 6 : jr * 1.4));
                        columns.push({
                            x, z, y0: roof + 1.5, y1: roof - length, radius: s * (0.585 + 0.05 * jr), rot: rand() * TAU, seed: rand(), hang: 1, dist,
                        });
                    }
                }
            }
        }
    };
    addBand(0, 46, 0.95);
    addBand(46, 112, 1.42);
    addBand(112, 400, 2.15);

    // ── What the light needs ──
    const lightFor = (c) => {
        const { x, z } = c;
        // Which way the open lake lies: down the slope of the rock's depth.
        const e = 1.5;
        let gx = depthAt(x + e, z) - depthAt(x - e, z);
        let gz = depthAt(x, z + e) - depthAt(x, z - e);
        const gl = Math.hypot(gx, gz) || 1;
        gx /= -gl;
        gz /= -gl;
        if (c.hang) {
            c.open = Math.atan2(gz, gx);
            c.lakeShadow = -1;
            c.fallShadow = -1;
            // Pipes in the middle of a cluster see less of the lake than the ones at its edge.
            let longer = 0;
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * TAU;
                const cl = fbm((x + Math.cos(a) * 3.2) * 0.045, (z + Math.sin(a) * 3.2) * 0.045, s0 + 23);
                if (cl > 0.535) longer += 1;
            }
            c.ao = 1 - 0.07 * longer;
            return;
        }
        // The lake's light comes from the open lava out in front: anything standing between
        // hides the foot of this column from it.
        const reach = 20;
        let lakeShadow = -1;
        for (let k = 1; k <= 9; k++) {
            const ds = c.radius * 1.2 + (k - 1) * 1.9;
            if (ds >= reach - 1) break;
            const t = heightAt(x + gx * ds, z + gz * ds);
            if (t > 0) lakeShadow = Math.max(lakeShadow, (t * reach) / (reach - ds));
        }
        c.lakeShadow = Math.min(lakeShadow, 80);
        // The fall's light is a point: the same question along the line to it.
        const lx = fallLight[0] - x;
        const lz = fallLight[2] - z;
        const span = Math.hypot(lx, lz);
        let fallShadow = -1;
        if (span > 2) {
            const steps = Math.min(26, Math.ceil(span / 3.5));
            for (let k = 1; k < steps; k++) {
                const f = (k / steps) * 0.92;
                const ds = c.radius * 1.3 + f * (span - c.radius * 1.3);
                const t = heightAt(x + (lx / span) * ds, z + (lz / span) * ds);
                if (t > 0) {
                    const u = ds / span;
                    fallShadow = Math.max(fallShadow, (t - fallLight[1] * u) / (1 - u));
                }
            }
        }
        c.fallShadow = Math.min(fallShadow, 80);
        // Open sky above the column's cap: taller neighbours close it in.
        let excess = 0;
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU + 0.3;
            const t = heightAt(x + Math.cos(a) * c.radius * 2.6, z + Math.sin(a) * c.radius * 2.6);
            excess += Math.max(0, Math.min(12, t - c.y1));
        }
        c.ao = 1 / (1 + excess / 14);
        c.open = Math.atan2(gz, gx);
    };
    columns.forEach(lightFor);
    // Nearest first: the solids draw front to back.
    columns.sort((a, b) => a.dist - b.dist);

    // ── How far each point of the lake is from rock ──
    const shore = new Float32Array(SHORE_SIZE * SHORE_SIZE);
    for (let j = 0; j < SHORE_SIZE; j++) {
        const z = LAKE.z0 + ((j + 0.5) / SHORE_SIZE) * (LAKE.z1 - LAKE.z0);
        for (let i = 0; i < SHORE_SIZE; i++) {
            const x = LAKE.x0 + ((i + 0.5) / SHORE_SIZE) * (LAKE.x1 - LAKE.x0);
            const dw = wallDepth(x, z);
            islandAt(x, z, isle);
            let d = Math.max(dw, isle.depth);
            const f = dw < 0 ? foreshore(x, z) : 0;
            if (f > 0) d = Math.max(d, dw + f * 0.8);
            shore[j * SHORE_SIZE + i] = clamp01(-d / SHORE_REACH);
        }
    }

    let standing = 0;
    for (let i = 0; i < columns.length; i++) standing += columns[i].hang ? 0 : 1;

    return {
        seed: s0,
        detail,
        columns,
        counts: { standing, hanging: columns.length - standing },
        shore,
        fall,
        fallLight,
        streams,
        fountains,
        islands: ISLANDS,
        heightAt,
        ceilingAt,
        depthAt,
        wallDepth,
    };
}

/**
 * The columns as one flat array, COLUMN_STRIDE floats each:
 *   x, z, y0, y1 | radius, rot, seed, hang | lakeShadow, fallShadow, ao, open
 * (y0 is where the column is rooted — under the lake, or in the roof — and y1 its free end.)
 */
export function packColumns(plan) {
    const out = new Float32Array(plan.columns.length * COLUMN_STRIDE);
    for (let i = 0; i < plan.columns.length; i++) {
        const c = plan.columns[i];
        out.set([
            c.x, c.z, c.y0, c.y1, c.radius, c.rot, c.seed, c.hang, c.lakeShadow, c.fallShadow, c.ao, c.open,
        ], i * COLUMN_STRIDE);
    }
    return out;
}
