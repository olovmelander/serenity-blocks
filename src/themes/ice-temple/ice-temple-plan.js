/**
 * Ice Temple — the plan (CPU only, three-free, seeded and deterministic).
 *
 * The temple stands on a frozen lake under the polar night. Its nave is two rows of colossal
 * hexagonal ice columns joined by pointed arches, open to the sky between the ribs; an aisle of
 * shorter columns (some broken) stands outside each row, tied to it by flying ribs; a half ring
 * of columns closes the far end around the Great Crystal. Icicles hang from every rib, crystals
 * crowd every column's foot, and drifts of them stand out on the lake.
 *
 * Everything here is a list of numbers; ice-temple-architecture.js turns the lists into one
 * merged geometry.
 */

import {
    NAVE, TAU, mulberry32,
} from './ice-temple-core.js';

const DEG = Math.PI / 180;

/**
 * The aisle columns that have fallen, as "pair:side" (side −1 = left). Chosen, not rolled: the
 * ruins are part of the composition, two a side, never opposite one another.
 */
const BROKEN_AISLE = new Set(['1:1', '3:-1', '4:1', '6:-1']);

/** Points along one side of a pointed arch: springing (0, 0) to crown (w, h), `n` segments. */
export function pointedArc(w, h, n) {
    const cx = (w * w + h * h) / (2 * w);
    const radius = cx;
    const end = Math.PI - Math.asin(Math.min(1, h / radius));
    const out = [];
    for (let i = 0; i <= n; i++) {
        const a = Math.PI + (end - Math.PI) * (i / n);
        out.push([cx + radius * Math.cos(a), radius * Math.sin(a)]);
    }
    return out;
}

/** A pointed arch from A to B (both at the springing height), rising `rise` above it. */
function archPoints(ax, az, bx, bz, spring, rise, segments) {
    const dx = bx - ax;
    const dz = bz - az;
    const span = Math.hypot(dx, dz);
    const half = pointedArc(span / 2, rise, segments);
    const pts = [];
    for (let i = 0; i < half.length; i++) {
        const [s, y] = half[i];
        pts.push([ax + (dx * s) / span, spring + y, az + (dz * s) / span]);
    }
    for (let i = half.length - 2; i >= 0; i--) {
        const [s, y] = half[i];
        pts.push([bx - (dx * s) / span, spring + y, bz - (dz * s) / span]);
    }
    return pts;
}

/** A quadratic Bézier through three points, `n` segments. */
function bezier(a, c, b, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const k0 = (1 - t) * (1 - t);
        const k1 = 2 * t * (1 - t);
        const k2 = t * t;
        pts.push([
            a[0] * k0 + c[0] * k1 + b[0] * k2,
            a[1] * k0 + c[1] * k1 + b[1] * k2,
            a[2] * k0 + c[2] * k1 + b[2] * k2,
        ]);
    }
    return pts;
}

function polylineLength(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    }
    return total;
}

/** The point `d` metres along a polyline. */
function pointAlong(pts, d) {
    let left = d;
    for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
        if (left <= seg || i === pts.length - 1) {
            const t = seg > 0 ? Math.min(1, left / seg) : 0;
            return [
                pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
                pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
                pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * t,
            ];
        }
        left -= seg;
    }
    return pts[pts.length - 1];
}

/**
 * @param {number} [seed]
 * @returns {{
 *   columns: Array<{ x: number, z: number, radius: number, height: number, kind: string,
 *     twist: number, seed: number, broken: boolean }>,
 *   ribs: Array<{ points: number[][], radius: number, seed: number, kind: string, normal: number[] }>,
 *   icicles: Array<{ x: number, y: number, z: number, length: number, radius: number, seed: number }>,
 *   crystals: Array<{ base: number[], dir: number[], length: number, radius: number, seed: number,
 *     kind: string }>,
 * }}
 */
export function buildPlan(seed = 20261005) {
    const rand = mulberry32(seed);
    const range = (lo, hi) => lo + (hi - lo) * rand();
    const columns = [];
    const ribs = [];
    const icicles = [];
    const crystals = [];

    const hang = (points, radius, spacing, lengths, chance = 0.82) => {
        const total = polylineLength(points);
        for (let d = spacing * 0.6; d < total - spacing * 0.4; d += spacing * range(0.7, 1.35)) {
            if (rand() > chance) continue;
            const p = pointAlong(points, d);
            const length = range(lengths[0], lengths[1]) * (rand() < 0.12 ? 1.8 : 1);
            icicles.push({
                x: p[0] + range(-0.12, 0.12),
                y: p[1] - radius * 0.7,
                z: p[2] + range(-0.12, 0.12),
                length,
                radius: 0.05 + length * range(0.045, 0.075),
                seed: rand(),
            });
        }
    };

    /** Crystals crowding a foot: leaning out from a centre. */
    const cluster = (cx, cz, count, reach, lengths, radii, kind = 'shard', baseY = 0) => {
        const turn = rand() * TAU;
        for (let i = 0; i < count; i++) {
            const a = turn + (i / count) * TAU + range(-0.35, 0.35);
            const lean = range(12, 46) * DEG;
            const r = reach * range(0.75, 1.15);
            const length = range(lengths[0], lengths[1]);
            crystals.push({
                base: [cx + Math.cos(a) * r, baseY - 0.2, cz + Math.sin(a) * r],
                dir: [Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)],
                length,
                radius: Math.max(radii[0], Math.min(radii[1], length * range(0.11, 0.17))),
                seed: rand(),
                kind,
            });
        }
    };

    // ── The nave ──
    for (let k = 0; k < NAVE.pairs; k++) {
        const z = NAVE.firstZ - k * NAVE.bay;
        for (let side = -1; side <= 1; side += 2) {
            const x = side * NAVE.halfWidth;
            columns.push({
                x,
                z,
                radius: NAVE.columnRadius * range(0.96, 1.05),
                height: NAVE.springHeight,
                kind: 'nave',
                twist: range(-0.2, 0.2),
                seed: rand(),
                broken: false,
            });
            cluster(x, z, 6, NAVE.columnRadius + 0.75, [0.9, 3.1], [0.16, 0.42]);
        }
        // The transverse arch, and its icicles.
        const arch = archPoints(-NAVE.halfWidth, z, NAVE.halfWidth, z, NAVE.springHeight, NAVE.apexHeight - NAVE.springHeight, 11);
        ribs.push({
            points: arch, radius: 0.62, seed: rand(), kind: 'transverse', normal: [0, 0, 1],
        });
        hang(arch, 0.62, 1.0, [0.6, 2.8]);
        // Arcade arches to the next pair.
        if (k < NAVE.pairs - 1) {
            for (let side = -1; side <= 1; side += 2) {
                const x = side * NAVE.halfWidth;
                const arcade = archPoints(x, z, x, z - NAVE.bay, NAVE.springHeight - 1.6, 5.4, 7);
                ribs.push({
                    points: arcade, radius: 0.36, seed: rand(), kind: 'arcade', normal: [1, 0, 0],
                });
                hang(arcade, 0.36, 0.85, [0.35, 1.9]);
            }
        }
    }

    // ── The aisles ──
    for (let k = 0; k < NAVE.aislePairs; k++) {
        const z = NAVE.aisleFirstZ - k * NAVE.bay;
        for (let side = -1; side <= 1; side += 2) {
            const x = side * NAVE.aisleHalf + range(-0.5, 0.5);
            const broken = BROKEN_AISLE.has(`${k}:${side}`);
            const height = broken ? range(3.6, 6.8) : NAVE.aisleHeight * range(0.92, 1.12);
            columns.push({
                x,
                z,
                radius: NAVE.aisleRadius * range(0.9, 1.1),
                height,
                kind: 'aisle',
                twist: range(-0.4, 0.4),
                seed: rand(),
                broken,
            });
            cluster(x, z, 4, NAVE.aisleRadius + 0.6, [0.6, 2.3], [0.12, 0.32]);
            if (broken) {
                // What fell lies beside it, half buried.
                const a = rand() * TAU;
                const length = range(3.2, 5.6);
                crystals.push({
                    base: [x + Math.cos(a) * 2.6, 0.42, z + Math.sin(a) * 2.6],
                    dir: [Math.cos(a + 1.3), range(-0.02, 0.1), Math.sin(a + 1.3)],
                    length,
                    radius: NAVE.aisleRadius * 0.9,
                    seed: rand(),
                    kind: 'shard',
                });
                continue;
            }
            // A flying rib from the nave column down to the aisle column's head.
            const nz = z + NAVE.bay / 2;
            const from = [side * NAVE.halfWidth, NAVE.springHeight * 0.74, nz];
            const to = [x, height + 0.4, z];
            const mid = [side * (NAVE.halfWidth + (NAVE.aisleHalf - NAVE.halfWidth) * 0.42), NAVE.springHeight * 0.78, (nz + z) / 2];
            const flying = bezier(from, mid, to, 9);
            ribs.push({
                points: flying, radius: 0.3, seed: rand(), kind: 'flying', normal: [0, 0, 1],
            });
            hang(flying, 0.3, 0.8, [0.3, 1.6], 0.7);
        }
    }

    // ── The apse: a half ring round the Great Crystal ──
    const boss = [0, NAVE.apexHeight + 3.5, NAVE.apseZ - 2];
    let previous = null;
    for (let i = 0; i < NAVE.apseColumns; i++) {
        const a = (-78 + (156 * i) / (NAVE.apseColumns - 1)) * DEG;
        const x = Math.sin(a) * NAVE.apseRadius;
        const z = NAVE.apseZ - Math.cos(a) * NAVE.apseRadius;
        columns.push({
            x,
            z,
            radius: NAVE.columnRadius * 0.92,
            height: NAVE.springHeight,
            kind: 'apse',
            twist: range(-0.2, 0.2),
            seed: rand(),
            broken: false,
        });
        cluster(x, z, 4, NAVE.columnRadius + 0.6, [0.8, 2.6], [0.15, 0.36]);
        const up = bezier([x, NAVE.springHeight, z], [x * 0.72, boss[1] - 1.5, NAVE.apseZ - Math.cos(a) * NAVE.apseRadius * 0.72], boss, 8);
        ribs.push({
            points: up, radius: 0.42, seed: rand(), kind: 'apse', normal: [Math.cos(a), 0, Math.sin(a)],
        });
        hang(up, 0.42, 1.1, [0.5, 2.2], 0.75);
        if (previous) {
            const arcade = archPoints(previous[0], previous[1], x, z, NAVE.springHeight - 1.6, 4.2, 6);
            ribs.push({
                points: arcade,
                radius: 0.34,
                seed: rand(),
                kind: 'arcade',
                normal: [-(z - previous[1]), 0, x - previous[0]],
            });
            hang(arcade, 0.34, 0.9, [0.35, 1.7]);
        }
        previous = [x, z];
    }

    // ── The Great Crystal ──
    crystals.push({
        base: [0, -1, NAVE.heartZ], dir: [0.02, 1, 0.03], length: 35, radius: 3.5, seed: rand(), kind: 'heart',
    });
    const heartTurn = rand() * TAU;
    for (let i = 0; i < 11; i++) {
        const a = heartTurn + (i / 11) * TAU + range(-0.2, 0.2);
        const lean = range(14, 44) * DEG;
        const length = range(13, 27) * (1 - (lean / DEG - 14) / 90);
        crystals.push({
            base: [Math.cos(a) * range(1.2, 3.4), -1, NAVE.heartZ + Math.sin(a) * range(1.2, 3.4)],
            dir: [Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)],
            length,
            radius: range(1.2, 2.6),
            seed: rand(),
            kind: 'heart',
        });
    }

    // ── Drifts of crystals out on the lake ──
    for (let i = 0; i < 22; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side * range(NAVE.aisleHalf + 6, NAVE.aisleHalf + 46);
        const z = range(-118, 2);
        cluster(x, z, 5 + Math.floor(rand() * 5), range(0.8, 2.2), [1.6, 8.5], [0.25, 1.1]);
    }
    // A few between the nave and the aisles, where the camera sees them close.
    for (let i = 0; i < 10; i++) {
        const side = i % 2 ? 1 : -1;
        cluster(side * range(NAVE.halfWidth + 3.5, NAVE.aisleHalf - 3), range(-66, -6), 4, range(0.4, 0.9), [0.7, 2.8], [0.14, 0.38]);
    }

    // ── Icicles under every capital ──
    columns.forEach((column) => {
        if (column.broken) return;
        const top = column.height - (column.kind === 'aisle' ? 0.2 : 0.9);
        const ring = column.radius * (column.kind === 'aisle' ? 1.25 : 1.4);
        const count = column.kind === 'aisle' ? 6 : 9;
        for (let i = 0; i < count; i++) {
            if (rand() < 0.2) continue;
            const a = (i / count) * TAU + range(-0.2, 0.2);
            const length = range(0.4, 2.1);
            icicles.push({
                x: column.x + Math.cos(a) * ring,
                y: top,
                z: column.z + Math.sin(a) * ring,
                length,
                radius: 0.05 + length * range(0.045, 0.07),
                seed: rand(),
            });
        }
    });

    return {
        columns, ribs, icicles, crystals,
    };
}
