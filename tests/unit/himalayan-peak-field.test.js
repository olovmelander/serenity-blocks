import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import {
    DEG, EYE, EYE_HEIGHT, GRID, HEIGHT_RANGE, SHADOW_TAN, SUN_AZIMUTH, SUN_ELEVATION, mulberry32, shadowWeights,
} from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import {
    CLOUD_CUT, HORIZON_RANGE, WEDGE, buildMassifMesh, decodeMassif, encodeMassif, horizonMap, sampleField, shadeMap,
    shadowHeight, shadowSlices,
} from '../../src/themes/himalayan-peak/himalayan-peak-field.js';
import { HERO_SUMMIT, buildPlanHeights } from '../../src/themes/himalayan-peak/himalayan-peak-massif.js';
import {
    MASSIF_SCHEMA, MASSIF_URL, PLAN_SIZE, deriveField, deriveFieldInSteps, loadMassif, planMassif,
} from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import { decodePng, encodePng } from '../../scripts/himalayan-peak/png.mjs';

const repoRoot = new URL('../../', import.meta.url);
const assetDirectory = new URL('src/themes/himalayan-peak/assets/', repoRoot);

const cellOf = (size) => GRID.span / (size - 1);
const xOf = (size, i) => GRID.x0 + i * cellOf(size);
const zOf = (size, j) => GRID.z0 + j * cellOf(size);
/** One row farther from the sun (+z) lies this many columns west along a line toward it... */
const SLANT = Math.sin(SUN_AZIMUTH) / Math.cos(SUN_AZIMUTH);
/** ...and this many metres along the ground. */
const runOf = (size) => cellOf(size) / Math.cos(SUN_AZIMUTH);
const [FLOOR, CEILING] = HORIZON_RANGE;
const clampTan = (v) => Math.max(FLOOR, Math.min(CEILING, v));

/** A square field from a height function of (column, row). */
function terrain(size, heightAt) {
    const out = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) out[j * size + i] = heightAt(i, j);
    }
    return out;
}

const level = (size, height) => terrain(size, () => height);

/** A wall across the whole field on `row` (and `thick` rows in all), on level ground. */
const wallAcross = (size, row, height, { thick = 1, base = 0 } = {}) => terrain(
    size,
    (i, j) => (j >= row && j < row + thick ? height : base),
);

/** Smooth hills (each a compact bump some eighth to a quarter of the field across). */
function hills(size, seed, amplitude, base = 0) {
    const rand = mulberry32(seed);
    const out = new Float32Array(size * size).fill(base);
    for (let b = 0; b < 10; b++) {
        const cx = rand() * size;
        const cz = rand() * size;
        const radius = size * (0.12 + rand() * 0.16);
        const height = (0.25 + rand() * 0.75) * amplitude;
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                const d = Math.hypot(i - cx, j - cz) / radius;
                if (d < 1) out[j * size + i] += height * (1 - d * d) ** 2;
            }
        }
    }
    return out;
}

/** The ground on row `j` at a fractional column, as the scan reads it; null beyond the grid. */
function rowHeight(heights, size, j, column) {
    const i = Math.floor(column);
    if (i < 0 || i >= size) return null;
    const a = heights[j * size + i];
    return i + 1 < size ? a + (heights[j * size + i + 1] - a) * (column - i) : a;
}

/**
 * One of the map's lines at row `j` — the line that leaves row 0 at column `line` — by a plain
 * maximum over everything on the grid before it (no hull): [ground, cloud top], clamped.
 */
function lineHorizons(heights, size, line, j) {
    const run = runOf(size);
    const h = rowHeight(heights, size, j, line - SLANT * j);
    let g = -Infinity;
    let c = -Infinity;
    if (h !== null) {
        for (let k = j - 1; k >= 0; k--) {
            const occluder = rowHeight(heights, size, k, line - SLANT * k);
            if (occluder === null) break;
            g = Math.max(g, (occluder - h) / ((j - k) * run));
            c = Math.max(c, occluder / ((j - k) * run));
        }
    }
    return [clampTan(g), clampTan(c)];
}

/**
 * Reference 1, by the map's own lines, at one grid point: the blend of the two lines either side
 * of it — or, in the first and the last column, the one of the two that is on the grid at that
 * row. Agrees with the map to rounding wherever the scan is right.
 */
function horizonAtByLines(heights, size, i, j) {
    const through = i + SLANT * j;
    const a = Math.floor(through);
    const f = through - a;
    let w = f;
    if (i - f < 0) w = 1;
    else if (i + 1 - f > size - 1) w = 0;
    const west = lineHorizons(heights, size, a, j);
    const east = lineHorizons(heights, size, a + 1, j);
    return [west[0] + (east[0] - west[0]) * w, west[1] + (east[1] - west[1]) * w];
}

/**
 * Reference 2, by the geometry alone, at one grid point: walk toward the sun (+x·sin, −z·cos of
 * its bearing) one row at a time and keep the steepest (occluder − h) / distance, reading each row
 * between its two columns. The second number is the same from y = 0 over the spot.
 */
function horizonAtPoint(heights, size, i, j) {
    const run = runOf(size);
    const h = heights[j * size + i];
    let g = -Infinity;
    let c = -Infinity;
    for (let k = 1; k <= j; k++) {
        const occluder = rowHeight(heights, size, j - k, i + SLANT * k);
        if (occluder === null) break;
        g = Math.max(g, (occluder - h) / (k * run));
        c = Math.max(c, occluder / (k * run));
    }
    return [clampTan(g), clampTan(c)];
}

/** A reference over the whole grid, in the map's own layout. */
function everywhere(reference, heights, size) {
    const out = new Float64Array(size * size * 2);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) out.set(reference(heights, size, i, j), (j * size + i) * 2);
    }
    return out;
}
const horizonByLines = (heights, size) => everywhere(horizonAtByLines, heights, size);
const horizonByPoints = (heights, size) => everywhere(horizonAtPoint, heights, size);

/**
 * Grid points whose line toward the sun leaves the grid through row 0, clear of the last column.
 * (A line that comes in through the east edge starts with nothing behind it: what the horizon is
 * there depends on ground that does not exist.)
 */
const hasWholeLine = (size, i, j) => i + SLANT * j <= size - 2;
/** The same, and between two lines that both run on the grid: not the first column. */
const liesBetweenLines = (size, i, j) => i >= 1 && hasWholeLine(size, i, j);

/** Largest and mean |a − b| of one channel over the points `keep` lets through. */
function channelError(a, b, size, channel, keep = () => true) {
    let worst = 0;
    let sum = 0;
    let count = 0;
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            if (!keep(size, i, j)) continue;
            const d = Math.abs(a[(j * size + i) * 2 + channel] - b[(j * size + i) * 2 + channel]);
            if (d > worst) worst = d;
            sum += d;
            count += 1;
        }
    }
    return { worst, mean: sum / Math.max(1, count), count };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('himalayan peak field: reading the heights', () => {
    const size = 33;
    const heights = terrain(size, (i, j) => 400 + Math.sin(i * 0.7) * 900 + Math.cos(j * 0.45 + i * 0.2) * 700);

    it('returns the stored height at every grid node', () => {
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                expect(sampleField(heights, size, xOf(size, i), zOf(size, j))).toBeCloseTo(heights[j * size + i], 6);
            }
        }
    });

    it('blends the four corners of a cell bilinearly', () => {
        const rand = mulberry32(31);
        for (let n = 0; n < 200; n++) {
            const i = Math.floor(rand() * (size - 1));
            const j = Math.floor(rand() * (size - 1));
            const tx = rand();
            const tz = rand();
            const a = heights[j * size + i];
            const b = heights[j * size + i + 1];
            const c = heights[(j + 1) * size + i];
            const d = heights[(j + 1) * size + i + 1];
            const expected = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
            const x = xOf(size, i) + tx * cellOf(size);
            const z = zOf(size, j) + tz * cellOf(size);
            expect(sampleField(heights, size, x, z)).toBeCloseTo(expected, 6);
        }
        // Halfway along an edge and in the middle of a cell.
        const mid = (heights[5 * size + 7] + heights[5 * size + 8]) / 2;
        expect(sampleField(heights, size, xOf(size, 7.5), zOf(size, 5))).toBeCloseTo(mid, 6);
        const corners = heights[5 * size + 7] + heights[5 * size + 8] + heights[6 * size + 7] + heights[6 * size + 8];
        expect(sampleField(heights, size, xOf(size, 7.5), zOf(size, 5.5))).toBeCloseTo(corners / 4, 6);
    });

    it('reads the bottom of the height range anywhere off the grid, and the edge nodes on its rim', () => {
        const far = GRID.x0 + GRID.span;
        const deep = GRID.z0 + GRID.span;
        for (const [x, z] of [
            [GRID.x0 - 1, GRID.z0 + 500], [far + 1, GRID.z0 + 500], [GRID.x0 + 500, GRID.z0 - 1],
            [GRID.x0 + 500, deep + 1], [-1e6, 0], [0, 1e6],
        ]) {
            expect(sampleField(heights, size, x, z)).toBe(HEIGHT_RANGE.min);
        }
        expect(sampleField(heights, size, GRID.x0, GRID.z0)).toBeCloseTo(heights[0], 6);
        expect(sampleField(heights, size, far, GRID.z0)).toBeCloseTo(heights[size - 1], 6);
        expect(sampleField(heights, size, GRID.x0, deep)).toBeCloseTo(heights[(size - 1) * size], 6);
        expect(sampleField(heights, size, far, deep)).toBeCloseTo(heights[size * size - 1], 6);
    });
});

describe('himalayan peak field: the sixteen-bit encoding', () => {
    const size = 24;
    const step = (HEIGHT_RANGE.max - HEIGHT_RANGE.min) / 65535;

    it('brings every height back within half a step and keeps the sky to the byte', () => {
        const rand = mulberry32(5);
        const heights = terrain(size, () => HEIGHT_RANGE.min + rand() * (HEIGHT_RANGE.max - HEIGHT_RANGE.min));
        const sky = Float32Array.from({ length: size * size }, (_, i) => (i % 256) / 255);
        const rgba = encodeMassif(heights, sky, size);
        expect(rgba).toBeInstanceOf(Uint8Array);
        expect(rgba).toHaveLength(size * size * 4);
        const decoded = decodeMassif(rgba, size);
        expect(decoded.heights).toBeInstanceOf(Float32Array);
        expect(decoded.sky).toBeInstanceOf(Uint8Array);
        let worst = 0;
        for (let i = 0; i < size * size; i++) {
            worst = Math.max(worst, Math.abs(decoded.heights[i] - heights[i]));
            expect(decoded.sky[i]).toBe(i % 256);
            expect(rgba[i * 4 + 3]).toBe(255);
        }
        // Half a step of the quantiser, and the rounding of a 32-bit float near 3 km.
        expect(worst).toBeLessThanOrEqual(step / 2 + 1e-3);
        expect(worst).toBeGreaterThan(0);
    });

    it('pins the ends of the range and clamps what lies beyond them', () => {
        const { min, max } = HEIGHT_RANGE;
        const heights = Float32Array.from([min, max, min - 900, max + 900]);
        const sky = Float32Array.from([0, 1, -3, 7]);
        const rgba = encodeMassif(heights, sky, 2);
        expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
        const decoded = decodeMassif(rgba, 2);
        expect(decoded.heights[0]).toBeCloseTo(HEIGHT_RANGE.min, 3);
        expect(decoded.heights[1]).toBeCloseTo(HEIGHT_RANGE.max, 3);
        expect(decoded.heights[2]).toBeCloseTo(HEIGHT_RANGE.min, 3);
        expect(decoded.heights[3]).toBeCloseTo(HEIGHT_RANGE.max, 3);
    });

    it('is exact from the second pass on: decoded heights encode to the bytes they came from', () => {
        const rand = mulberry32(77);
        const rgba = new Uint8Array(size * size * 4);
        for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : Math.floor(rand() * 256);
        const decoded = decodeMassif(rgba, size);
        const again = encodeMassif(decoded.heights, Float32Array.from(decoded.sky, (v) => v / 255), size);
        expect(Buffer.from(again).equals(Buffer.from(rgba))).toBe(true);
        // One step of the red byte is 256 steps of height.
        const one = decodeMassif(Uint8Array.from([1, 0, 0, 255, 0, 1, 0, 255]), 1);
        expect(one.heights[0] - HEIGHT_RANGE.min).toBeCloseTo(256 * step, 3);
        const two = decodeMassif(Uint8Array.from([0, 1, 0, 255]), 1);
        expect(two.heights[0] - HEIGHT_RANGE.min).toBeCloseTo(step, 4);
    });
});

describe('himalayan peak field: the horizon toward the sun', () => {
    const size = 64;
    const run = runOf(size);

    it('reads a level horizon on level ground, and the floor where nothing stands toward the sun', () => {
        const map = horizonMap(level(size, 120), size);
        expect(map).toBeInstanceOf(Float32Array);
        expect(map).toHaveLength(size * size * 2);
        // (Every column, the first and the last included.)
        let tilted = 0;
        let misjudged = 0;
        for (let j = 1; j < size; j++) {
            for (let i = 0; i < size; i++) {
                // The ground one row nearer the sun is as high as this: tan(elevation) = 0.
                if (Math.abs(map[(j * size + i) * 2]) > 1e-6) tilted += 1;
                // From y = 0 over the same spot that ground stands 120 m up, one row away.
                if (Math.abs(map[(j * size + i) * 2 + 1] - 120 / run) > 1e-5) misjudged += 1;
            }
        }
        expect(tilted).toBe(0);
        expect(misjudged).toBe(0);
        // The row nearest the sun has nothing in front of it at all.
        for (let i = 0; i < size; i++) {
            expect(map[i * 2]).toBeCloseTo(FLOOR, 6);
            expect(map[i * 2 + 1]).toBeCloseTo(FLOOR, 6);
        }
        // Ground lying level with the cloud top is its own horizon in both channels.
        const sea = horizonMap(level(size, 0), size);
        expect(sea[(30 * size + 30) * 2]).toBeCloseTo(0, 6);
        expect(sea[(30 * size + 30) * 2 + 1]).toBeCloseTo(0, 6);
    });

    it('does not care how high the whole field stands, on the ground', () => {
        const low = hills(size, 9, 500);
        const high = Float32Array.from(low, (v) => v + 1300);
        const a = horizonMap(low, size);
        const b = horizonMap(high, size);
        expect(channelError(a, b, size, 0).worst).toBeLessThan(1e-4);
        // The cloud top does: it looks at the same ground from further below.
        expect(channelError(a, b, size, 1).worst).toBeGreaterThan(0.3);
    });

    it('puts a point behind a wall under wall height / distance, and one in front of it under nothing', () => {
        const row = 20;
        const tall = 900;
        const map = horizonMap(wallAcross(size, row, tall), size);
        const column = 20;
        for (let j = row + 1; j < size; j++) {
            const expected = Math.min(CEILING, tall / ((j - row) * run));
            expect(map[(j * size + column) * 2], `row ${j}`).toBeCloseTo(expected, 5);
            // The ground lies at y = 0, so the cloud top over it sees the same wall.
            expect(map[(j * size + column) * 2 + 1], `row ${j}`).toBeCloseTo(expected, 5);
        }
        // Right behind it the wall fills the sky: the map is clamped.
        expect(map[((row + 1) * size + column) * 2]).toBeCloseTo(CEILING, 6);
        expect(tall / run).toBeGreaterThan(CEILING);
        // Sunward of the wall the ground is level.
        for (let j = 1; j < row; j++) expect(map[(j * size + column) * 2]).toBeCloseTo(0, 6);
        // The wall's own top looks down on everything toward the sun.
        expect(map[(row * size + column) * 2]).toBeCloseTo(-tall / (row * run), 5);
        expect(map[(row * size + column) * 2]).toBeLessThan(0);
    });

    it('leans the shadow away from the sun: west of straight behind, never east', () => {
        // A block six columns wide on row 20, columns 40..45. The sun stands to the right of −z,
        // so `k` rows behind (+z) its shadow has moved k·tan(azimuth) columns toward −x.
        const row = 20;
        const map = horizonMap(terrain(size, (i, j) => (j === row && i >= 40 && i <= 45 ? 900 : 0)), size);
        for (const k of [4, 10, 16]) {
            const lean = SLANT * k;
            const shadowed = Math.round(42.5 - lean);
            const mirrored = Math.round(42.5 + lean);
            expect(map[((row + k) * size + shadowed) * 2], `${k} rows behind`).toBeCloseTo(900 / (k * run), 5);
            expect(map[((row + k) * size + mirrored) * 2], `${k} rows behind`).toBeCloseTo(0, 6);
        }
        // Ten rows on, the ground straight behind the block is already in the open.
        expect(map[((row + 10) * size + 43) * 2]).toBeCloseTo(0, 6);
    });

    it('finds the same two horizons as a plain maximum along each of its lines', () => {
        // Any terrain, in both channels, over the whole grid: ground that rises out of the cloud
        // and ground that lies under it, where the cloud top's nearest corners stand below the
        // floor the map is clamped to.
        const fields = {
            wall: wallAcross(size, 20, 900),
            'thick wall on a plateau': wallAcross(size, 30, 2600, { thick: 3, base: 400 }),
            'ramp rising away from the sun': terrain(size, (i, j) => j * 30),
            'ramp falling away from the sun': terrain(size, (i, j) => 2000 - j * 30),
            'ramp across': terrain(size, (i) => i * 25),
            hills: hills(size, 3, 500),
            'steep hills': hills(size, 11, 1500),
            'hills in a basin': hills(size, 13, 500, -460),
            'steep hills in a deep basin': hills(size, 11, 3000, -600),
            'a wall out of a basin': wallAcross(size, 12, 2400, { base: -460 }),
            'level ground under the cloud': level(size, -200),
        };
        Object.keys(fields).forEach((name) => {
            const map = horizonMap(fields[name], size);
            const reference = horizonByLines(fields[name], size);
            for (const channel of [0, 1]) {
                const error = channelError(map, reference, size, channel);
                expect(error.count, name).toBe(size * size);
                expect(error.worst, `${name}, channel ${channel}`).toBeLessThan(1e-5);
            }
        });
        // And at another size, where the lines fall differently on the grid.
        const small = hills(48, 5, 1200, -300);
        const smallMap = horizonMap(small, 48);
        const smallReference = horizonByLines(small, 48);
        for (const channel of [0, 1]) {
            expect(channelError(smallMap, smallReference, 48, channel).worst).toBeLessThan(1e-5);
        }
    });

    it('sees a far wall from the cloud top over a rib that lies drowned in front of it', () => {
        // A basin at −460 m, a wall 2000 m high across it on row 10, and on row 38 a rib that
        // only comes up to −300 m. Over row 40 the two nearest corners of the ground's hull (the
        // floor one row away, the rib two) both stand steeper below y = 0 than the map's floor;
        // the horizon is the wall, thirty rows off.
        const field = terrain(size, (i, j) => {
            if (j === 10) return 2000;
            return j === 38 ? -300 : -460;
        });
        const map = horizonMap(field, size);
        const column = 12;
        expect(-460 / run).toBeLessThan(FLOOR);
        expect(-300 / (2 * run)).toBeLessThan(FLOOR);
        expect(map[(40 * size + column) * 2 + 1]).toBeCloseTo(2000 / (30 * run), 5);
        expect(map[(40 * size + column) * 2 + 1]).toBeGreaterThan(0.2);
        // From the basin's floor itself the wall stands higher still.
        expect(map[(40 * size + column) * 2]).toBeCloseTo((2000 + 460) / (30 * run), 5);
        // Every row behind the wall: the wall, however deep the ground under the cloud lies.
        for (let j = 11; j < size; j++) {
            const wall = Math.min(CEILING, 2000 / ((j - 10) * run));
            expect(map[(j * size + column) * 2 + 1], `row ${j}`).toBeCloseTo(wall, 5);
        }
        // Close to the grid's sunward rim nothing but drowned ground has been passed: the floor.
        expect(map[(3 * size + column) * 2 + 1]).toBeCloseTo(FLOOR, 6);
    });

    it('never puts ground that rises out of the cloud lower in the sky from the cloud top', () => {
        const fields = {
            wall: wallAcross(size, 20, 900),
            'thick wall on a plateau': wallAcross(size, 30, 2600, { thick: 3, base: 400 }),
            'ramp falling away from the sun': terrain(size, (i, j) => 2000 - j * 30),
            hills: hills(size, 3, 500),
            'steep hills on a shelf': hills(size, 11, 1500, 80),
        };
        Object.keys(fields).forEach((name) => {
            const map = horizonMap(fields[name], size);
            let lower = 0;
            for (let o = 0; o < size * size; o++) if (map[o * 2 + 1] < map[o * 2] - 1e-6) lower += 1;
            expect(lower, name).toBe(0);
        });
    });

    it('agrees with the geometry itself wherever the ground does not change across the lines', () => {
        // Walls and ramps that run the whole width: every line toward the sun crosses the same
        // profile, so blending two of them changes nothing and the map must be exact — from the
        // first column on.
        const fields = {
            wall: wallAcross(size, 20, 900),
            'thick wall on a plateau': wallAcross(size, 30, 2600, { thick: 3, base: 400 }),
            'a wall out of a basin': wallAcross(size, 12, 2400, { base: -460 }),
            'ramp rising away from the sun': terrain(size, (i, j) => j * 30),
            'ramp falling away from the sun': terrain(size, (i, j) => 2000 - j * 30),
        };
        Object.keys(fields).forEach((name) => {
            const map = horizonMap(fields[name], size);
            const exact = horizonByPoints(fields[name], size);
            for (const channel of [0, 1]) {
                const error = channelError(map, exact, size, channel, hasWholeLine);
                expect(error.count, name).toBeGreaterThan(size * size * 0.6);
                expect(error.worst, `${name}, channel ${channel}`).toBeLessThan(1e-5);
            }
        });
    });

    it('reads its first and its last column off the line that runs inside the grid', () => {
        const edges = [[0, 1], [size - 1, size - 2]];
        // Level ground and ramps the whole width: both edge columns are exact, in both channels.
        const plain = {
            level: level(size, 120),
            'ramp rising away from the sun': terrain(size, (i, j) => j * 30),
            'ramp falling away from the sun': terrain(size, (i, j) => 2000 - j * 30),
        };
        Object.keys(plain).forEach((name) => {
            const map = horizonMap(plain[name], size);
            edges.forEach(([edge]) => {
                for (let j = 0; j < size; j++) {
                    const exact = horizonAtPoint(plain[name], size, edge, j);
                    const where = `${name}, column ${edge}, row ${j}`;
                    expect(map[(j * size + edge) * 2], where).toBeCloseTo(exact[0], 5);
                    expect(map[(j * size + edge) * 2 + 1], where).toBeCloseTo(exact[1], 5);
                }
            });
        });
        // Rolling ground. The line that speaks for an edge column runs up to a column inside it,
        // so what the column reads lies between its own horizon and its inner neighbour's (to
        // the tolerance of the rolling-ground test below).
        const rolling = {
            'hills, seed 3': hills(size, 3, 500),
            'hills, seed 7': hills(size, 7, 500),
            'hills, seed 21': hills(size, 21, 500),
            'hills in a basin': hills(size, 13, 500, -460),
            wall: wallAcross(size, 20, 900),
        };
        Object.keys(rolling).forEach((name) => {
            const map = horizonMap(rolling[name], size);
            edges.forEach(([edge, inner]) => {
                const astray = [];
                for (let j = 1; j < size; j++) {
                    const own = horizonAtPoint(rolling[name], size, edge, j);
                    const next = horizonAtPoint(rolling[name], size, inner, j);
                    for (const channel of [0, 1]) {
                        const value = map[(j * size + edge) * 2 + channel];
                        const low = Math.min(own[channel], next[channel]);
                        const high = Math.max(own[channel], next[channel]);
                        if (value < low - 0.04 || value > high + 0.04) astray.push([j, channel, value, low, high]);
                    }
                }
                expect(astray, `${name}, column ${edge}`).toEqual([]);
            });
        });
        // The first column of rolling ground, straight against its own brute force: the ground's
        // horizon is as close there as in any column between two lines.
        for (const seed of [3, 7, 21]) {
            const field = hills(size, seed, 500);
            const map = horizonMap(field, size);
            let worst = 0;
            for (let j = 0; j < size; j++) {
                worst = Math.max(worst, Math.abs(map[j * size * 2] - horizonAtPoint(field, size, 0, j)[0]));
            }
            expect(worst, `seed ${seed}`).toBeLessThan(0.04);
        }
    });

    it('stays close to the geometry over rolling ground', () => {
        // What the tolerance covers. The map is worked out along lines that leave row 0 at whole
        // columns, and a grid point takes the blend of the two lines either side of it. Those
        // lines read the ground up to a column to the left and right of the true line through the
        // point, so the point and what stands in its way are in effect smoothed across a column,
        // and each line takes its own maximum before the two are blended. On these hills (a few
        // tens of metres of bend across a 238 m column, the nearest occluder 275 m away) that
        // comes to at most 0.025 of tangent, on horizons that span −0.4 to +0.33. A slant drawn
        // the wrong way round is off by 0.4 at two points in three.
        const TOLERANCE = 0.04;
        for (const seed of [3, 7, 21]) {
            const field = hills(size, seed, 500);
            const map = horizonMap(field, size);
            const exact = horizonByPoints(field, size);
            const error = channelError(map, exact, size, 0, liesBetweenLines);
            expect(error.count).toBeGreaterThan(size * size * 0.6);
            expect(error.worst, `seed ${seed}`).toBeLessThan(TOLERANCE);
            expect(error.mean, `seed ${seed}`).toBeLessThan(0.003);
            // The reference is not a flat nothing: these hills throw real shadows.
            let shadowed = 0;
            for (let o = 0; o < size * size; o++) if (exact[o * 2] > 0.1) shadowed += 1;
            expect(shadowed).toBeGreaterThan(300);

            // Mirror the ground east for west and the map must NOT follow: the sun has a side.
            const mirrored = terrain(size, (i, j) => field[j * size + size - 1 - i]);
            const flipped = horizonMap(mirrored, size);
            let off = 0;
            for (let j = 0; j < size; j++) {
                for (let i = 1; i + SLANT * j <= size - 2; i++) {
                    const there = flipped[(j * size + size - 1 - i) * 2];
                    if (Math.abs(there - exact[(j * size + i) * 2]) > TOLERANCE) off += 1;
                }
            }
            expect(off, `seed ${seed}`).toBeGreaterThan(error.count * 0.3);
        }
    });

    it('never leaves the range it is stored in', () => {
        const fields = [hills(size, 11, 3000, -600), wallAcross(size, 2, 3600, { base: -700 }), level(size, -650)];
        for (const field of fields) {
            const map = horizonMap(field, size);
            expect(map.every((v) => Number.isFinite(v))).toBe(true);
            let lowest = Infinity;
            let highest = -Infinity;
            for (let o = 0; o < map.length; o++) {
                lowest = Math.min(lowest, map[o]);
                highest = Math.max(highest, map[o]);
            }
            expect(lowest).toBeGreaterThanOrEqual(FLOOR - 1e-6);
            expect(highest).toBeLessThanOrEqual(CEILING + 1e-6);
        }
    });
});

describe('himalayan peak field: the shadow in the air', () => {
    const size = 64;
    const run = runOf(size);
    const row = 10;
    const tall = 1800;
    const texelX = (i, n = size) => GRID.x0 + ((i + 0.5) / n) * GRID.span;
    const texelZ = (j, n = size) => GRID.z0 + ((j + 0.5) / n) * GRID.span;

    it('weights two neighbouring slices, summing to one, and holds the ends', () => {
        SHADOW_TAN.forEach((tan, s) => {
            const w = shadowWeights(tan);
            w.forEach((value, k) => expect(value).toBeCloseTo(k === s ? 1 : 0, 9));
        });
        for (const tan of [-0.5, -0.14, -0.05, 0.06, 0.1, 0.16, 0.3, 0.41, 0.46, 2]) {
            const w = shadowWeights(tan);
            expect(w.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 9);
            expect(w.every((v) => v >= 0 && v <= 1)).toBe(true);
            expect(w.filter((v) => v > 0).length).toBeLessThanOrEqual(2);
            // The blend of the slices' own tangents is the tangent asked for (inside the range).
            const blended = w.reduce((sum, v, k) => sum + v * SHADOW_TAN[k], 0);
            expect(blended).toBeCloseTo(Math.max(SHADOW_TAN[0], Math.min(SHADOW_TAN[3], tan)), 9);
        }
        const out = [9, 9, 9, 9];
        expect(shadowWeights(0.16, out)).toBe(out);
        expect(out).toEqual([0, expect.closeTo(0.5, 9), expect.closeTo(0.5, 9), 0]);
        // Every elevation the sun can reach lies inside the baked slices.
        expect(Math.tan(SUN_ELEVATION.rest - 0.5 * DEG)).toBeGreaterThan(SHADOW_TAN[0]);
        expect(Math.tan(SUN_ELEVATION.max)).toBeLessThan(SHADOW_TAN[3]);
    });

    it('stands a wall\'s shadow at wall top − distance × tan behind it, for each slice', () => {
        const { volume, low, lowSize } = shadowSlices(wallAcross(size, row, tall), size, size);
        expect(lowSize).toBe(size);
        expect(volume).toHaveLength(size * size * 4);
        expect(low).toHaveLength(size * size);
        const column = 20;
        let checked = 0;
        SHADOW_TAN.forEach((tan, s) => {
            for (let j = row + 1; j < size; j++) {
                const fromWall = tall - (j - row) * run * tan;
                const stored = volume[(j * size + column) * 4 + s];
                // Level ground one row nearer the sun throws its own, a step's drop under itself.
                const fromGround = -run * tan;
                if (fromWall > fromGround + 1) {
                    expect(stored, `slice ${s}, row ${j}`).toBeCloseTo(fromWall, 0);
                    checked += 1;
                } else if (tan > 0) {
                    expect(stored, `slice ${s}, row ${j}`).toBeCloseTo(fromGround, 1);
                }
            }
        });
        // The wall's shadow was followed a long way in every slice before the ground took over.
        expect(checked).toBeGreaterThan(100);
        // With the sun under the horizon the shadow climbs as it runs out.
        expect(volume[((size - 1) * size + column) * 4]).toBeGreaterThan(tall + 1500);
        // The wall's own cells carry what stood sunward of them, not the wall.
        for (let s = 1; s < 4; s++) expect(volume[(row * size + column) * 4 + s]).toBeLessThan(0);
        // Nothing reaches the row nearest the sun: it is clear to below the range.
        for (let s = 0; s < 4; s++) expect(volume[column * 4 + s]).toBe(HEIGHT_RANGE.min - 200);
    });

    it('is the same along the whole width of ground that does not change across it', () => {
        const { volume } = shadowSlices(wallAcross(size, row, tall, { thick: 2, base: 150 }), size, size);
        let uneven = 0;
        for (let j = 0; j < size; j++) {
            for (let s = 0; s < 4; s++) {
                const first = volume[(j * size) * 4 + s];
                // (The last column too: it reads the edge where there is no column beyond it.)
                for (let i = 1; i < size; i++) {
                    if (Math.abs(volume[(j * size + i) * 4 + s] - first) > 0.005) uneven += 1;
                }
            }
        }
        expect(uneven).toBe(0);
    });

    it('leans the shadow in the air the way the horizon leans', () => {
        const block = terrain(size, (i, j) => (j === 20 && i >= 40 && i <= 45 ? 900 : 0));
        const { volume } = shadowSlices(block, size, size);
        // Four rows behind, the column the shadow has leant to is still under the whole block.
        const near = Math.round(42.5 - SLANT * 4);
        SHADOW_TAN.forEach((tan, s) => {
            expect(volume[(24 * size + near) * 4 + s], `slice ${s}`).toBeCloseTo(900 - 4 * run * tan, 0);
        });
        // Ten rows behind it stands west of straight behind, and the east side is in the open.
        const west = Math.round(42.5 - SLANT * 10);
        const east = Math.round(42.5 + SLANT * 10);
        expect(volume[(30 * size + west) * 4 + 1]).toBeGreaterThan(500);
        expect(volume[(30 * size + east) * 4 + 1]).toBeCloseTo(-run * SHADOW_TAN[1], 1);
        expect(volume[(30 * size + 43) * 4 + 1]).toBeCloseTo(-run * SHADOW_TAN[1], 1);
    });

    it('keeps the ground and the shadow as block means when it is stored smaller', () => {
        const field = hills(size, 17, 1400, -200);
        const full = shadowSlices(field, size, size);
        // At full size the ground is the field itself.
        expect(Array.from(full.low)).toEqual(Array.from(field));
        const lowSize = 16;
        const block = size / lowSize;
        const small = shadowSlices(field, size, lowSize);
        expect(small.lowSize).toBe(lowSize);
        expect(small.low).toHaveLength(lowSize * lowSize);
        expect(small.volume).toHaveLength(lowSize * lowSize * 4);
        for (let bj = 0; bj < lowSize; bj++) {
            for (let bi = 0; bi < lowSize; bi++) {
                let ground = 0;
                const air = [0, 0, 0, 0];
                for (let dj = 0; dj < block; dj++) {
                    for (let di = 0; di < block; di++) {
                        const o = (bj * block + dj) * size + bi * block + di;
                        ground += field[o];
                        for (let s = 0; s < 4; s++) air[s] += full.volume[o * 4 + s];
                    }
                }
                expect(small.low[bj * lowSize + bi]).toBeCloseTo(ground / (block * block), 2);
                for (let s = 0; s < 4; s++) {
                    expect(small.volume[(bj * lowSize + bi) * 4 + s]).toBeCloseTo(air[s] / (block * block), 1);
                }
            }
        }
    });

    it('reads the shadow\'s height for any elevation as a blend of the slices', () => {
        const { volume } = shadowSlices(wallAcross(size, row, tall), size, size);
        const x = texelX(20);
        const z = texelZ(20);
        const distance = (20 - row) * run;
        // At a texel's centre a single slice comes back as stored.
        for (let s = 0; s < 4; s++) {
            const w = [0, 0, 0, 0];
            w[s] = 1;
            expect(shadowHeight(volume, size, x, z, w)).toBeCloseTo(volume[(20 * size + 20) * 4 + s], 3);
        }
        // The wall's shadow is linear in tan(elevation), so the blend is exact between slices...
        for (const tan of [-0.1, 0, 0.06, 0.16, 0.3, 0.41]) {
            const stands = shadowHeight(volume, size, x, z, shadowWeights(tan));
            expect(stands, `tan ${tan}`).toBeCloseTo(tall - distance * tan, 0);
        }
        // ...and held at the first and last slice beyond them.
        expect(shadowHeight(volume, size, x, z, shadowWeights(-0.6))).toBeCloseTo(tall - distance * SHADOW_TAN[0], 0);
        expect(shadowHeight(volume, size, x, z, shadowWeights(0.9))).toBeCloseTo(tall - distance * SHADOW_TAN[3], 0);
        // Between texel centres it is bilinear.
        const between = shadowHeight(volume, size, x, (texelZ(20) + texelZ(21)) / 2, [0, 1, 0, 0]);
        expect(between).toBeCloseTo((volume[(20 * size + 20) * 4 + 1] + volume[(21 * size + 20) * 4 + 1]) / 2, 3);
        // Off the grid it holds the edge.
        const edge = shadowHeight(volume, size, GRID.x0 - 5000, texelZ(40), [0, 0, 1, 0]);
        expect(edge).toBeCloseTo(volume[(40 * size) * 4 + 2], 3);
        expect(shadowHeight(volume, size, x, GRID.z0 + GRID.span + 5000, [1, 0, 0, 0]))
            .toBeCloseTo(volume[((size - 1) * size + 20) * 4], 3);
    });
});

describe('himalayan peak field: the shading map', () => {
    const size = 48;
    const cell = cellOf(size);
    const sky = Uint8Array.from({ length: size * size }, (_, i) => (i * 7) % 256);
    const at = (map, i, j) => Array.from(map.slice((j * size + i) * 4, (j * size + i) * 4 + 4));

    it('writes an upright normal and no hollow for level ground, and passes the sky through', () => {
        const map = shadeMap(level(size, 77), sky, size);
        expect(map).toBeInstanceOf(Uint8Array);
        expect(map).toHaveLength(size * size * 4);
        let wrong = 0;
        for (let o = 0; o < size * size; o++) {
            const upright = map[o * 4] === 128 && map[o * 4 + 1] === 128;
            if (!upright || map[o * 4 + 2] !== sky[o] || map[o * 4 + 3] !== 128) wrong += 1;
        }
        expect(wrong).toBe(0);
        expect(at(map, 20, 20)).toEqual([128, 128, sky[20 * size + 20], 128]);
    });

    it('tilts the normal against the slope, in the channel of the axis it rises along', () => {
        // Ground rising toward +x at 45°: the normal leans toward −x by sin(45°).
        const east = at(shadeMap(terrain(size, (i) => i * cell), sky, size), 20, 20);
        expect(east[0]).toBe(Math.round((-Math.SQRT1_2 * 0.5 + 0.5) * 255));
        expect(east[1]).toBe(128);
        const west = at(shadeMap(terrain(size, (i) => -i * cell), sky, size), 20, 20);
        expect(west[0]).toBe(Math.round((Math.SQRT1_2 * 0.5 + 0.5) * 255));
        expect(west[1]).toBe(128);
        // Rising toward +z at 1 in 2: the other channel, and less of it.
        const south = at(shadeMap(terrain(size, (i, j) => j * cell * 0.5), sky, size), 20, 20);
        expect(south[0]).toBe(128);
        expect(south[1]).toBeLessThan(128);
        expect(south[1]).toBeGreaterThan(east[0]);
        expect(south[1]).toBe(Math.round(((-0.5 / Math.hypot(0.5, 1)) * 0.5 + 0.5) * 255));
        const north = at(shadeMap(terrain(size, (i, j) => -j * cell * 0.5), sky, size), 20, 20);
        expect(north[1]).toBeGreaterThan(128);
        // The bytes decode to a unit normal's x and z.
        const nx = (east[0] / 255) * 2 - 1;
        expect(Math.sqrt(1 - nx * nx)).toBeCloseTo(Math.SQRT1_2, 2);
    });

    it('calls a plane neither hollow nor proud, a trough hollow and a crest proud', () => {
        // (Away from the rim, where the ring of neighbours is clamped onto the grid.)
        const inside = (i, j) => i >= 3 && j >= 3 && i < size - 3 && j < size - 3;
        const plane = shadeMap(terrain(size, (i, j) => i * 40 - j * 25 + 300), sky, size);
        let bent = 0;
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                // (0.5 is 127.5 of 255: either neighbour is the plane.)
                if (inside(i, j) && Math.abs(plane[(j * size + i) * 4 + 3] - 127.5) > 0.5) bent += 1;
            }
        }
        expect(bent).toBe(0);
        const trough = shadeMap(terrain(size, (i) => Math.abs(i - 24) * 60), sky, size);
        const crest = shadeMap(terrain(size, (i) => -Math.abs(i - 24) * 60), sky, size);
        expect(at(trough, 24, 20)[3]).toBeGreaterThan(150);
        expect(at(crest, 24, 20)[3]).toBeLessThan(105);
        // Its two sides are planes again.
        expect(at(trough, 12, 20)[3]).toBe(128);
        expect(at(crest, 36, 20)[3]).toBe(128);
        // A deeper trough is more hollow, until the byte is full.
        const deeper = shadeMap(terrain(size, (i) => Math.abs(i - 24) * 120), sky, size);
        expect(at(deeper, 24, 20)[3]).toBeGreaterThan(at(trough, 24, 20)[3]);
        const gorge = shadeMap(terrain(size, (i) => Math.abs(i - 24) * 5000), sky, size);
        expect(at(gorge, 24, 20)[3]).toBe(255);
        const fin = shadeMap(terrain(size, (i) => -Math.abs(i - 24) * 5000), sky, size);
        expect(at(fin, 24, 20)[3]).toBe(0);
    });
});

describe('himalayan peak field: the mesh the eye can see', () => {
    const size = 97;
    const cell = cellOf(size);
    const BUCKETS = 512;
    /** The mesh's own distance buckets: a factor of 600^(1/512) apart. */
    const bucketOf = (r) => {
        const along = Math.log(Math.max(40, r) / 40) / Math.log(600);
        return Math.min(BUCKETS - 1, Math.floor(along * BUCKETS));
    };

    /** Every kept cell as { ids, x, z, r, top, bottom, north } from the index buffer. */
    function cellsOf(mesh) {
        const { positions, indices } = mesh;
        const out = [];
        for (let q = 0; q < indices.length; q += 6) {
            const ids = [...new Set(indices.slice(q, q + 6))];
            let x = 0;
            let z = 0;
            let top = -Infinity;
            let bottom = Infinity;
            let north = Infinity;
            let south = -Infinity;
            ids.forEach((id) => {
                x += positions[id * 3] / ids.length;
                z += positions[id * 3 + 2] / ids.length;
                top = Math.max(top, positions[id * 3 + 1]);
                bottom = Math.min(bottom, positions[id * 3 + 1]);
                north = Math.min(north, positions[id * 3 + 2]);
                south = Math.max(south, positions[id * 3 + 2]);
            });
            out.push({
                ids, x, z, r: Math.hypot(x - EYE.x, z - EYE.z), top, bottom, north, south,
            });
        }
        return out;
    }

    /** The checks every mesh must pass, whatever the ground. */
    function expectSound(mesh, heights, n, label) {
        const { positions, indices } = mesh;
        const vertices = positions.length / 3;
        expect(positions.length % 3, label).toBe(0);
        expect(indices, label).toBeInstanceOf(Uint32Array);
        expect(indices.length, label).toBe(mesh.kept * 6);
        expect(mesh.kept, label).toBeLessThanOrEqual(mesh.cells);
        // Every index names a vertex, and every vertex is used.
        const used = new Uint8Array(vertices);
        let outOfRange = 0;
        for (let k = 0; k < indices.length; k++) {
            if (indices[k] >= vertices) outOfRange += 1;
            else used[indices[k]] = 1;
        }
        expect(outOfRange, label).toBe(0);
        expect(used.every((flag) => flag === 1), label).toBe(true);
        // Every vertex is a point of the field (to the rounding of a 32-bit position on a cliff).
        let offField = 0;
        for (let v = 0; v < vertices; v++) {
            const ground = sampleField(heights, n, positions[v * 3], positions[v * 3 + 2]);
            if (Math.abs(ground - positions[v * 3 + 1]) > 0.05) offField += 1;
        }
        expect(offField, label).toBe(0);
        // Every triangle is wound so that its normal points up.
        let facingDown = 0;
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] * 3;
            const b = indices[t + 1] * 3;
            const c = indices[t + 2] * 3;
            const ux = positions[b] - positions[a];
            const uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a];
            const vz = positions[c + 2] - positions[a + 2];
            if (uz * vx - ux * vz <= 0) facingDown += 1;
        }
        expect(facingDown, label).toBe(0);
        const cells = cellsOf(mesh);
        // A cell is two triangles on four corners; none lies wholly under the cut.
        expect(cells.every((c) => c.ids.length === 4), label).toBe(true);
        expect(cells.filter((c) => c.top < CLOUD_CUT), label).toHaveLength(0);
        // Front to back: from one cell to the next the distance never falls by more than a bucket.
        let stepsBack = 0;
        for (let k = 1; k < cells.length; k++) {
            if (bucketOf(cells[k].r) < bucketOf(cells[k - 1].r) - 1) stepsBack += 1;
        }
        expect(stepsBack, label).toBe(0);
        if (cells.length > 1) expect(cells[cells.length - 1].r, label).toBeGreaterThan(cells[0].r);
        return cells;
    }

    it('builds level ground under the eye as sound triangles, nearest first, inside the wedge', () => {
        const plain = level(size, 100);
        const mesh = buildMassifMesh(plain, size);
        expect(mesh.cells).toBe((size - 1) * (size - 1));
        const cells = expectSound(mesh, plain, size, 'plain');
        // Most of what lies ahead is kept...
        expect(mesh.kept).toBeGreaterThan(mesh.cells * 0.6);
        expect(mesh.kept).toBeLessThan(mesh.cells);
        // ...and what lies off to the sides or behind is not (a few cells of margin at the edge).
        let outside = 0;
        cells.forEach((c) => {
            const bearing = Math.abs(Math.atan2(c.x - EYE.x, -(c.z - EYE.z)));
            if (c.r > 1000 && bearing > WEDGE + (4 * cell) / c.r) outside += 1;
        });
        expect(outside).toBe(0);
        expect(cells.some((c) => c.r < 450)).toBe(true);
        // The first cell drawn is one of those under the eye.
        expect(cells[0].r).toBeLessThan(cell);
    });

    it('never builds ground that lies under the cloud for good', () => {
        const drowned = buildMassifMesh(level(size, CLOUD_CUT - 100), size);
        expect(drowned).toMatchObject({ kept: 0, cells: (size - 1) ** 2 });
        expect(drowned.indices).toHaveLength(0);
        expect(drowned.positions).toHaveLength(0);
        // The west half drowned, the east half standing at 100 m.
        const half = terrain(size, (i) => (i < size / 2 ? CLOUD_CUT - 120 : 100));
        const mesh = buildMassifMesh(half, size);
        const cells = expectSound(mesh, half, size, 'half drowned');
        const plain = buildMassifMesh(level(size, 100), size);
        expect(mesh.kept).toBeGreaterThan(plain.kept * 0.4);
        expect(mesh.kept).toBeLessThan(plain.kept * 0.6);
        // Only the cells along the shore reach down into it.
        const shore = xOf(size, Math.floor(size / 2));
        expect(cells.filter((c) => c.x < shore - cell * 1.01)).toHaveLength(0);
        expect(cells.some((c) => c.bottom < CLOUD_CUT && c.top > 0)).toBe(true);
        // Ground between the cut and the cloud top is still built: the cloud laps over it.
        const shallow = buildMassifMesh(level(size, CLOUD_CUT + 50), size);
        expect(shallow.kept).toBe(plain.kept);
    });

    it('drops what a wall across the view hides', () => {
        const plain = level(size, 100);
        const wallRow = Math.round((-5000 - GRID.z0) / cell);
        const walled = terrain(size, (i, j) => (j >= wallRow && j < wallRow + 3 ? 3000 : 100));
        const far = zOf(size, wallRow);
        const open = cellsOf(buildMassifMesh(plain, size)).filter((c) => c.south < far);
        const mesh = buildMassifMesh(walled, size);
        const cells = expectSound(mesh, walled, size, 'walled');
        const behind = cells.filter((c) => c.south < far);
        // Thousands of cells lie beyond that line on open ground...
        expect(open.length).toBeGreaterThan(3000);
        // ...and behind the wall only the strip that touches its top is left.
        expect(behind.length).toBeLessThan(open.length * 0.05);
        expect(behind.filter((c) => c.south < far - cell * 3.01)).toHaveLength(0);
        // The wall's face toward the eye is there, from foot to top.
        const face = cells.filter((c) => c.top > 2900 && c.bottom < 200);
        expect(face.length).toBeGreaterThan(20);
        // Nothing in front of the wall was lost to it.
        const before = (list) => list.filter((c) => c.north > zOf(size, wallRow + 3)).length;
        expect(before(cells)).toBe(before(cellsOf(buildMassifMesh(plain, size))));
    });

    it('drops ground the eye could only see from underneath', () => {
        const shelf = level(size, EYE.y + 560);
        const mesh = buildMassifMesh(shelf, size);
        const cells = expectSound(mesh, shelf, size, 'shelf');
        expect(mesh.kept).toBeGreaterThan(0);
        // Only the cells round the eye stay (those near enough to turn as the camera sways).
        expect(cells.filter((c) => c.r > 900 + cell * 3)).toHaveLength(0);
    });

    it('draws about a quarter of the cells at twice the stride', () => {
        const ground = hills(size, 4, 900, 60);
        const one = buildMassifMesh(ground, size, { stride: 1 });
        const two = buildMassifMesh(ground, size, { stride: 2 });
        expectSound(one, ground, size, 'stride 1');
        expectSound(two, ground, size, 'stride 2');
        expect(two.cells).toBe(one.cells / 4);
        expect(two.kept / one.kept).toBeGreaterThan(0.2);
        expect(two.kept / one.kept).toBeLessThan(0.34);
        // Its vertices are every second grid node.
        let offNode = 0;
        for (let v = 0; v < two.positions.length; v += 3) {
            const column = (two.positions[v] - GRID.x0) / (cell * 2);
            const line = (two.positions[v + 2] - GRID.z0) / (cell * 2);
            if (Math.abs(column - Math.round(column)) > 1e-3 || Math.abs(line - Math.round(line)) > 1e-3) offNode += 1;
        }
        expect(offNode).toBe(0);
    });

    it('keeps a sane share of the real plan, the same every time', () => {
        const planSize = 128;
        const plan = buildPlanHeights(planSize);
        const mesh = buildMassifMesh(plan, planSize);
        expectSound(mesh, plan, planSize, 'plan');
        expect(mesh.cells).toBe((planSize - 1) ** 2);
        expect(mesh.kept / mesh.cells).toBeGreaterThan(0.03);
        expect(mesh.kept / mesh.cells).toBeLessThan(0.6);
        // What is kept includes the hero's summit and nothing under the cut.
        let top = -Infinity;
        for (let v = 1; v < mesh.positions.length; v += 3) top = Math.max(top, mesh.positions[v]);
        expect(top).toBeGreaterThan(3000);
        const again = buildMassifMesh(plan, planSize);
        expect(again.kept).toBe(mesh.kept);
        expect(Buffer.from(again.indices.buffer).equals(Buffer.from(mesh.indices.buffer))).toBe(true);
        expect(Buffer.from(again.positions.buffer).equals(Buffer.from(mesh.positions.buffer))).toBe(true);
        const coarse = buildMassifMesh(plan, planSize, { stride: 2 });
        expectSound(coarse, plan, planSize, 'plan, stride 2');
        expect(coarse.kept).toBeLessThan(mesh.kept * 0.4);
    });
});

describe('himalayan peak: the PNG the bake writes', () => {
    it('reads back what it wrote, pixel for pixel', () => {
        const rand = mulberry32(2026);
        // Noise (the Sub filter's case), not square, so a row and a column cannot be confused.
        const width = 37;
        const height = 23;
        const noise = Uint8Array.from({ length: width * height * 4 }, () => Math.floor(rand() * 256));
        const file = encodePng(noise, width, height);
        expect(file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
        const back = decodePng(file);
        expect(back.width).toBe(width);
        expect(back.height).toBe(height);
        expect(Buffer.from(back.rgba).equals(Buffer.from(noise))).toBe(true);
        // Rows that repeat the row above (the Up filter's case), with noise along each row.
        const stripes = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width * 4; x++) stripes[y * width * 4 + x] = (noise[x] + (y > 11 ? 1 : 0)) & 255;
        }
        expect(Buffer.from(decodePng(encodePng(stripes, width, height)).rgba).equals(Buffer.from(stripes))).toBe(true);
        // One pixel, and nothing that is not a PNG.
        expect(Array.from(decodePng(encodePng(Uint8Array.from([1, 2, 3, 4]), 1, 1)).rgba)).toEqual([1, 2, 3, 4]);
        expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/not a PNG/);
    });
});

describe('himalayan peak: the baked massif on disk', () => {
    const manifest = JSON.parse(readFileSync(new URL('massif-manifest.json', assetDirectory), 'utf8'));
    const file = readFileSync(new URL('massif.png', assetDirectory));
    let image;
    let heights;
    let sky;
    let size;
    let summit;

    beforeAll(() => {
        image = decodePng(file);
        size = image.width;
        ({ heights, sky } = decodeMassif(image.rgba, size));
        summit = 0;
        for (let i = 1; i < heights.length; i++) if (heights[i] > heights[summit]) summit = i;
    });

    it('is the file the manifest describes: schema, grid, size and hash', () => {
        expect(manifest.schema).toBe(MASSIF_SCHEMA);
        expect(manifest.size).toBe(GRID.size);
        expect(manifest.grid).toEqual({ ...GRID });
        expect(manifest.heightRange).toEqual({ ...HEIGHT_RANGE });
        expect(manifest.bytes).toBe(file.length);
        expect(manifest.sha256).toBe(createHash('sha256').update(file).digest('hex'));
        expect(existsSync(new URL(manifest.generator, repoRoot))).toBe(true);
        expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//i);
        expect(decodeURIComponent(new URL(MASSIF_URL).pathname.split('/').pop())).toBe('massif.png');
        // Small enough to ship: a few megabytes.
        expect(file.length).toBeLessThan(4 * 1024 * 1024);
    });

    it('decodes to the theme\'s grid, opaque, with every height inside the range it is stored over', () => {
        expect(image.width).toBe(manifest.size);
        expect(image.height).toBe(manifest.size);
        let lowest = Infinity;
        let translucent = 0;
        for (let i = 0; i < heights.length; i++) {
            if (heights[i] < lowest) lowest = heights[i];
            if (image.rgba[i * 4 + 3] !== 255) translucent += 1;
        }
        // Opaque: a canvas would premultiply anything else and change the bytes.
        expect(translucent).toBe(0);
        // Nothing sits on either end of the range: no height was clipped by the encoding.
        expect(lowest).toBeGreaterThan(HEIGHT_RANGE.min + 100);
        expect(heights[summit]).toBeLessThan(HEIGHT_RANGE.max - 100);
        // The basins go down under the cloud, the summits far above it.
        expect(lowest).toBeLessThan(CLOUD_CUT);
        // Decoding and encoding again gives the image back, byte for byte.
        const again = encodeMassif(heights, Float32Array.from(sky, (v) => v / 255), size);
        expect(Buffer.from(again).equals(Buffer.from(image.rgba))).toBe(true);
    });

    it('has the hero\'s summit as its highest point, where the plan draws it', () => {
        expect(Math.abs(heights[summit] - manifest.summit)).toBeLessThanOrEqual(0.6);
        const x = xOf(size, summit % size);
        const z = zOf(size, Math.floor(summit / size));
        expect(Math.hypot(x - HERO_SUMMIT.x, z - HERO_SUMMIT.z)).toBeLessThan(400);
        expect(Math.abs(heights[summit] - HERO_SUMMIT.y)).toBeLessThan(40);
        // Nothing outside the hero's summit region comes within 300 m of it.
        let rival = -Infinity;
        for (let j = 0; j < size; j += 2) {
            for (let i = 0; i < size; i += 2) {
                const away = Math.hypot(xOf(size, i) - HERO_SUMMIT.x, zOf(size, j) - HERO_SUMMIT.z);
                if (away > 1500 && heights[j * size + i] > rival) rival = heights[j * size + i];
            }
        }
        expect(rival).toBeLessThan(heights[summit] - 300);
        // The summit sees the whole sky; the amphitheatre as a whole does not.
        expect(sky[summit]).toBeGreaterThan(240);
        let total = 0;
        for (let i = 0; i < sky.length; i++) total += sky[i];
        expect(total / sky.length).toBeGreaterThan(80);
        expect(total / sky.length).toBeLessThan(240);
    });

    it('lies a few metres under the viewer\'s boots, for the pass\'s own snow to cover', () => {
        const boots = EYE.y - EYE_HEIGHT;
        const ground = sampleField(heights, size, EYE.x, EYE.z);
        // 4.2 m when it was baked: the plan's 3 m, and the sag of a 15 m cell over the crest.
        expect(boots - ground).toBeGreaterThan(2);
        expect(boots - ground).toBeLessThan(8);
        // And nowhere within a few steps does it stand above the eye.
        for (let a = 0; a < 360; a += 15) {
            for (const r of [5, 15, 30]) {
                const near = sampleField(heights, size, EYE.x + Math.sin(a * DEG) * r, EYE.z - Math.cos(a * DEG) * r);
                expect(near, `${r} m at ${a}°`).toBeLessThan(boots);
            }
        }
    });

    it('throws the same shadows as a plain maximum along the lines, under the cloud as over it', () => {
        // The whole massif by brute force is a second of arithmetic; a few thousand points of it,
        // scattered, each along its own two lines, is not.
        const map = horizonMap(heights, size);
        expect(map).toHaveLength(size * size * 2);
        const rand = mulberry32(8848);
        const worst = [0, 0];
        let drowned = 0;
        let shadowed = 0;
        for (let n = 0; n < 4000; n++) {
            const i = Math.floor(rand() * size);
            const j = Math.floor(rand() * size);
            const reference = horizonAtByLines(heights, size, i, j);
            for (const channel of [0, 1]) {
                const off = Math.abs(map[(j * size + i) * 2 + channel] - reference[channel]);
                worst[channel] = Math.max(worst[channel], off);
            }
            if (heights[j * size + i] < 0) {
                drowned += 1;
                // Over ground under the cloud, the cloud top in a wall's shadow at sunrise.
                if (reference[1] > 0.1) shadowed += 1;
            }
        }
        // (To the rounding of 32-bit heights three kilometres up.)
        expect(worst[0]).toBeLessThan(1e-4);
        expect(worst[1]).toBeLessThan(1e-4);
        // The sample is worth the name: a good part of it lies under the cloud sea, and a good
        // part of that behind a wall.
        expect(drowned).toBeGreaterThan(1000);
        expect(shadowed).toBeGreaterThan(200);
        // The first column is as true as any between two lines: on this ground a column inside
        // strays from its own brute force by more than 0.05 at some three rows in a hundred.
        let strays = 0;
        for (let j = 1; j < size; j++) {
            if (Math.abs(map[j * size * 2] - horizonAtPoint(heights, size, 0, j)[0]) > 0.05) strays += 1;
        }
        expect(strays).toBeLessThan(size * 0.05);
    });

    it('lets the sun clear the wall where the manifest says, between rest and full charge', () => {
        // The skyline from the eye along the sun's bearing, as the bake measures it.
        const cell = cellOf(size);
        let top = -1;
        for (let r = 200; r < 16000; r += cell * 0.5) {
            const x = EYE.x + Math.sin(SUN_AZIMUTH) * r;
            const z = EYE.z - Math.cos(SUN_AZIMUTH) * r;
            top = Math.max(top, (sampleField(heights, size, x, z) - EYE.y) / r);
        }
        const clears = Math.atan(top) / DEG;
        expect(clears).toBeCloseTo(manifest.sunClearsDegrees, 2);
        // At rest the sun is under the wall; a full chain stands it clear of it.
        expect(clears).toBeGreaterThan(SUN_ELEVATION.rest / DEG + 2);
        expect(clears).toBeLessThan(SUN_ELEVATION.full / DEG - 2);
        expect(Math.tan(clears * DEG)).toBeLessThan(CEILING);
    });
});

describe('himalayan peak: loading the massif', () => {
    const bakedFile = readFileSync(new URL('massif.png', assetDirectory));
    /** A stand-in for OffscreenCanvas whose 2D context reads back `data`. */
    const canvasThatReads = (data) => function FakeCanvas() {
        this.getContext = () => ({ drawImage() {}, getImageData: () => ({ data }) });
    };
    /** `fetch` answering every request with a file's bytes (an ArrayBuffer of their own). */
    const serving = (file, asked = []) => async (url) => {
        asked.push(url);
        return {
            ok: true,
            arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
            blob: async () => new Blob([file]),
        };
    };
    /** The chunks of a PNG file: [{ type, data }]. */
    const pngChunks = (file) => {
        const chunks = [];
        for (let offset = 8; offset + 8 <= file.length;) {
            const length = file.readUInt32BE(offset);
            const type = file.toString('ascii', offset + 4, offset + 8);
            chunks.push({ type, data: file.subarray(offset + 8, offset + 8 + length) });
            offset += length + 12;
        }
        return chunks;
    };

    it('samples the plan as a stand-in that sees the whole sky', () => {
        const massif = planMassif(48);
        expect(massif.size).toBe(48);
        expect(massif.source).toBe('plan');
        expect(massif.heights).toBeInstanceOf(Float32Array);
        expect(Array.from(massif.heights)).toEqual(Array.from(buildPlanHeights(48)));
        expect(massif.sky).toHaveLength(48 * 48);
        expect(massif.sky.every((v) => v === 235)).toBe(true);
    });

    it('derives everything the materials read, at the sizes they are stored in', () => {
        const massif = planMassif(64);
        const field = deriveField(massif);
        expect(field.heights).toBe(massif.heights);
        expect(field).toMatchObject({
            size: 64, source: 'plan', lowSize: 64, cell: cellOf(64),
        });
        expect(field.shade).toBeInstanceOf(Uint8Array);
        expect(field.shade).toHaveLength(64 * 64 * 4);
        expect(field.horizon).toHaveLength(64 * 64 * 2);
        expect(field.volume).toHaveLength(64 * 64 * 4);
        expect(field.low).toHaveLength(64 * 64);
        for (const name of ['horizon', 'volume', 'low']) {
            expect(field[name]).toBeInstanceOf(Float32Array);
            expect(field[name].every((v) => Number.isFinite(v)), name).toBe(true);
        }
        // The sky rides in the shading map's third channel.
        expect(field.shade[2]).toBe(235);
        // The shadow in the air is never stored larger than 256².
        const big = deriveField({
            heights: new Float32Array(512 * 512), sky: new Uint8Array(512 * 512), size: 512, source: 'asset',
        });
        expect(big.lowSize).toBe(256);
        expect(big.volume).toHaveLength(256 * 256 * 4);
        expect(big.low).toHaveLength(256 * 256);
        expect(big.source).toBe('asset');
    });

    it('derives the same in steps, with the mesh cut for the tier, and lets the page run meanwhile', async () => {
        const massif = planMassif(64);
        const whole = deriveField(massif);
        for (const stride of [1, 2, 4]) {
            const order = [];
            setTimeout(() => order.push('the page'), 0);
            // eslint-disable-next-line no-await-in-loop
            const stepped = await deriveFieldInSteps(massif, stride).then((field) => {
                order.push('the field');
                return field;
            });
            // A timer that was already waiting ran before the derivation was through.
            expect(order).toEqual(['the page', 'the field']);
            expect(stepped.heights).toBe(massif.heights);
            expect(stepped).toMatchObject({
                size: whole.size, source: whole.source, cell: whole.cell, lowSize: whole.lowSize,
            });
            for (const name of ['shade', 'horizon', 'volume', 'low']) {
                expect(stepped[name].constructor, name).toBe(whole[name].constructor);
                expect(Buffer.from(stepped[name].buffer).equals(Buffer.from(whole[name].buffer)), name).toBe(true);
            }
            // The mesh the massif is drawn with at that stride, cut ahead of the build.
            const mesh = buildMassifMesh(massif.heights, massif.size, { stride });
            expect(stepped.mesh.stride).toBe(stride);
            expect(stepped.mesh.kept).toBe(mesh.kept);
            expect(stepped.mesh.cells).toBe(mesh.cells);
            expect(Buffer.from(stepped.mesh.positions.buffer).equals(Buffer.from(mesh.positions.buffer))).toBe(true);
            expect(Buffer.from(stepped.mesh.indices.buffer).equals(Buffer.from(mesh.indices.buffer))).toBe(true);
            expect(stepped.mesh.kept).toBeGreaterThan(0);
        }
        // deriveField() itself cuts no mesh: a world built without load() cuts its own.
        expect(whole.mesh).toBeUndefined();
    });

    it('returns the plan at once, without a request, where there is no page or no way to inflate', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const request = vi.fn(serving(bakedFile));
        vi.stubGlobal('fetch', request);
        // This host has no document.
        expect(typeof document).toBe('undefined');
        const plain = await loadMassif();
        expect(plain).toMatchObject({ source: 'plan', size: PLAN_SIZE });
        expect(plain.heights).toHaveLength(PLAN_SIZE * PLAN_SIZE);
        expect(plain.sky.every((v) => v === 235)).toBe(true);
        // A page that can neither inflate nor decode an image.
        vi.stubGlobal('document', {});
        vi.stubGlobal('DecompressionStream', undefined);
        expect(typeof createImageBitmap).toBe('undefined');
        await expect(loadMassif()).resolves.toMatchObject({ source: 'plan', size: PLAN_SIZE });
        // Nor one that cannot ask for it.
        vi.unstubAllGlobals();
        vi.stubGlobal('document', {});
        vi.stubGlobal('fetch', undefined);
        await expect(loadMassif()).resolves.toMatchObject({ source: 'plan', size: PLAN_SIZE });
        expect(request).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    it('decodes the baked image\'s own bytes into exactly what the bake\'s reader gives', async () => {
        const asked = [];
        vi.stubGlobal('document', {});
        vi.stubGlobal('fetch', serving(bakedFile, asked));
        // No canvas is asked for anything: its pixels may come back with noise in them.
        const bitmap = vi.fn();
        vi.stubGlobal('createImageBitmap', bitmap);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const massif = await loadMassif();
        expect(warn).not.toHaveBeenCalled();
        expect(bitmap).not.toHaveBeenCalled();
        expect(asked).toEqual([MASSIF_URL]);
        expect(massif.source).toBe('asset');
        expect(massif.size).toBe(GRID.size);
        // The bake's own reader (scripts/himalayan-peak/png.mjs), on the same file.
        const image = decodePng(bakedFile);
        const expected = decodeMassif(image.rgba, image.width);
        expect(massif.heights).toBeInstanceOf(Float32Array);
        expect(massif.sky).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(massif.heights.buffer).equals(Buffer.from(expected.heights.buffer))).toBe(true);
        expect(Buffer.from(massif.sky).equals(Buffer.from(expected.sky))).toBe(true);
        // Both of the row filters the bake writes are in that file, so both were undone here.
        const data = pngChunks(bakedFile).filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data);
        const raw = inflateSync(Buffer.concat(data));
        const filters = new Set();
        for (let y = 0; y < image.height; y++) filters.add(raw[y * (image.width * 4 + 1)]);
        expect([...filters].sort()).toEqual([1, 2]);
        // Another address is asked for as given.
        await loadMassif('somewhere/else.png');
        expect(asked).toEqual([MASSIF_URL, 'somewhere/else.png']);
    });

    it('stands the plan in, and says why, for a file it cannot read', async () => {
        vi.stubGlobal('document', {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const reasons = () => warn.mock.calls.map((call) => String(call[1]));
        const rand = mulberry32(404);
        const noise = (width, height) => {
            const length = width * height * 4;
            return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
        };
        const small = encodePng(noise(16, 16), 16, 16);
        // In a PNG the header's data starts at byte 16: width, height, depth, colour type.
        const patched = (edit) => {
            const copy = Buffer.from(small);
            edit(copy);
            return copy;
        };
        const cases = [
            // The request fails, or cannot be made.
            [async () => ({ ok: false, status: 404 }), /404/],
            [async () => {
                throw new Error('offline');
            }, /offline/],
            // Another image altogether (its size read from its own header)...
            [serving(encodePng(noise(37, 23), 37, 23)), /37×23/],
            // ...one that is not eight-bit RGBA...
            [serving(patched((copy) => copy.writeUInt8(2, 25))), /RGBA/],
            // ...and one that says it is a row taller than its data.
            [serving(patched((copy) => copy.writeUInt32BE(17, 20))), /short/],
        ];
        for (let n = 0; n < cases.length; n++) {
            vi.stubGlobal('fetch', cases[n][0]);
            // eslint-disable-next-line no-await-in-loop
            const massif = await loadMassif();
            expect(massif, `case ${n}`).toMatchObject({ source: 'plan', size: PLAN_SIZE });
            expect(warn, `case ${n}`).toHaveBeenCalledTimes(n + 1);
            expect(reasons()[n], `case ${n}`).toMatch(cases[n][1]);
        }
    });

    it('falls back on a canvas, bytes untouched, where the page cannot inflate', async () => {
        const image = decodePng(bakedFile);
        const asked = [];
        vi.stubGlobal('document', {});
        vi.stubGlobal('DecompressionStream', undefined);
        vi.stubGlobal('fetch', serving(bakedFile, asked));
        const options = [];
        vi.stubGlobal('createImageBitmap', async (blob, option) => {
            options.push(option);
            return { width: image.width, height: image.height, close() {} };
        });
        vi.stubGlobal('OffscreenCanvas', canvasThatReads(new Uint8ClampedArray(image.rgba)));
        const massif = await loadMassif();
        expect(massif.source).toBe('asset');
        expect(massif.size).toBe(GRID.size);
        expect(asked).toEqual([MASSIF_URL]);
        // The bytes are the data: no colour conversion, no premultiplied alpha.
        expect(options).toEqual([{ colorSpaceConversion: 'none', premultiplyAlpha: 'none' }]);
        const expected = decodeMassif(image.rgba, image.width);
        expect(Buffer.from(massif.heights.buffer).equals(Buffer.from(expected.heights.buffer))).toBe(true);
        expect(Buffer.from(massif.sky).equals(Buffer.from(expected.sky))).toBe(true);
        // A canvas of the wrong size is turned away like any other wrong image.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('createImageBitmap', async () => ({ width: 8, height: 8, close() {} }));
        vi.stubGlobal('OffscreenCanvas', canvasThatReads(new Uint8ClampedArray(8 * 8 * 4)));
        await expect(loadMassif()).resolves.toMatchObject({ source: 'plan' });
        expect(String(warn.mock.calls[0][1])).toMatch(/8×8/);
    });
});
