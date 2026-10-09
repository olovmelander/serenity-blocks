/**
 * Waves — the generated meshes face the right way.
 *
 * The water is one sheet, folded into the wave by the vertex stage and drawn front side only: the
 * rider is inside the tube, so a quad wound the wrong way is a hole in the wall, and one flipped
 * column is a slit the sky shows through. The dolphin is lofted in code and lit by normals computed
 * from its triangles, so a ring wound the wrong way is a fish lit from inside. Neither mistake
 * throws; these tests fold the grid on the CPU, with the same shape the shader mirrors
 * (waves-core.js `wavePoint`), and pin the facing of both.
 */
import { describe, expect, it } from 'vitest';
import {
    WAVE, axisOffset, sectionScale, shoulderWeight, wavePoint,
} from '../../src/themes/waves/waves-core.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import { buildWaveGrid } from '../../src/themes/waves/waves-water.js';
import { DOLPHIN_LENGTH, buildDolphin } from '../../src/themes/waves/waves-life.js';

/** The grid's vertices where the still wave puts them (x, y, z per vertex). */
function fold(grid, open = 0) {
    const flat = grid.geometry.getAttribute('position').array;
    const folded = new Float64Array(flat.length);
    const p = { x: 0, y: 0, z: 0 };
    for (let at = 0; at < flat.length; at += 3) {
        wavePoint(flat[at], -flat[at + 2], open, p);
        folded[at] = p.x;
        folded[at + 1] = p.y;
        folded[at + 2] = p.z;
    }
    return folded;
}

/**
 * Walk the grid's triangles in index order: `visit(face)` gets the three rows, the centre and the
 * unit normal the winding gives (counter-clockwise is the front). The face object is reused.
 */
function eachFace(grid, folded, visit) {
    const flat = grid.geometry.getAttribute('position').array;
    const index = grid.geometry.getIndex().array;
    const face = {
        rowMin: 0, rowMax: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, area: 0, triangle: 0,
    };
    for (let k = 0; k < index.length; k += 3) {
        const a = index[k] * 3;
        const b = index[k + 1] * 3;
        const c = index[k + 2] * 3;
        const ux = folded[b] - folded[a];
        const uy = folded[b + 1] - folded[a + 1];
        const uz = folded[b + 2] - folded[a + 2];
        const vx = folded[c] - folded[a];
        const vy = folded[c + 1] - folded[a + 1];
        const vz = folded[c + 2] - folded[a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz);
        face.triangle = k / 3;
        face.rowMin = Math.min(flat[a], flat[b], flat[c]);
        face.rowMax = Math.max(flat[a], flat[b], flat[c]);
        face.x = (folded[a] + folded[b] + folded[c]) / 3;
        face.y = (folded[a + 1] + folded[b + 1] + folded[c + 1]) / 3;
        face.z = (folded[a + 2] + folded[b + 2] + folded[c + 2]) / 3;
        face.area = length / 2;
        face.nx = nx / (length || 1);
        face.ny = ny / (length || 1);
        face.nz = nz / (length || 1);
        visit(face);
    }
}

/** What is wrong with the facing of a folded grid, and how much of it was looked at. */
function facing(grid, open) {
    const folded = fold(grid, open);
    const count = { tube: 0, trough: 0, swell: 0 };
    const wrong = [];
    eachFace(grid, folded, (face) => {
        const d = -face.z;
        const where = `triangle ${face.triangle} at d ${d.toFixed(2)}, rows ${face.rowMin}..${face.rowMax}`;
        if (face.rowMax <= 0) {
            // The trough and the sea in front of the wave: seen from above.
            count.trough += 1;
            if (!(face.area > 0) || !(face.ny > 0)) wrong.push(`${where}: the trough faces down`);
        } else if (d > 0 && d < 10) {
            // The tube round the rider: every wall faces its axis, where the rider is.
            count.tube += 1;
            const tx = axisOffset(d) - face.x;
            const ty = WAVE.b - face.y;
            const inward = (face.nx * tx + face.ny * ty) / (Math.hypot(tx, ty) || 1);
            if (!(face.area > 0) || !(inward > 0)) wrong.push(`${where}: the wall faces out of the tube (${inward})`);
        } else if (shoulderWeight(d, open) === 1) {
            // The unbroken shoulder ahead: a hump of sea, seen from above and from in front of it.
            count.swell += 1;
            if (!(face.area > 0) || !(face.ny > 0) || !(face.nx <= 0)) wrong.push(`${where}: the swell faces away`);
        }
    });
    return { count, wrong };
}

describe('waves: the folded grid', () => {
    it('lays its rows round the section and its columns down the line', () => {
        const tier = tierFor('Minimal');
        const grid = buildWaveGrid(tier);
        const { rows, columns } = grid;
        // Rows: the trough from far out up to the foot of the face, then the wave to the lip's edge.
        expect(rows).toHaveLength(tier.floorRows + tier.arcRows + 1);
        expect(rows[0]).toBe(-1);
        expect(rows[tier.floorRows]).toBe(0);
        expect(rows[rows.length - 1]).toBe(1);
        expect(rows.filter((r) => r === 0)).toHaveLength(1);
        expect(rows.every((r, i) => i === 0 || r > rows[i - 1])).toBe(true);
        // Columns: from behind the eye to the far end of the line, never closer than the tier's step.
        expect(columns[0]).toBe(WAVE.backReach);
        expect(columns[columns.length - 1]).toBe(-WAVE.aheadReach);
        expect(columns.every((z, i) => i === 0 || z < columns[i - 1])).toBe(true);
        expect(columns.some((z) => z > 0)).toBe(true);
        const steps = columns.slice(1).map((z, i) => columns[i] - z);
        expect(steps[0]).toBeCloseTo(tier.nearStep, 9);
        // Wider with distance (the very last column is the far end itself, wherever the stride fell).
        const stride = steps.slice(0, -1);
        expect(stride.every((s, i) => i === 0 || s >= stride[i - 1] - 1e-9)).toBe(true);
        expect(stride[stride.length - 1]).toBeGreaterThan(stride[0] * 4);

        // One vertex a row a column, holding its row and its column's z; two triangles a cell.
        const position = grid.geometry.getAttribute('position');
        const index = grid.geometry.getIndex();
        expect(position.count).toBe(rows.length * columns.length);
        expect(index.count).toBe((rows.length - 1) * (columns.length - 1) * 6);
        const stray = [];
        for (let j = 0; j < columns.length; j++) {
            for (let i = 0; i < rows.length; i++) {
                const v = j * rows.length + i;
                if (position.getX(v) !== Math.fround(rows[i]) || position.getY(v) !== 0
                    || position.getZ(v) !== Math.fround(columns[j])) stray.push(v);
            }
        }
        expect(stray).toEqual([]);
        const used = new Uint8Array(position.count);
        let outOfRange = 0;
        for (let k = 0; k < index.count; k++) {
            const v = index.getX(k);
            if (v >= position.count) outOfRange += 1;
            else used[v] = 1;
        }
        expect(outOfRange).toBe(0);
        expect(used.every((flag) => flag === 1)).toBe(true);
    });

    it('winds the tube so its walls face the rider, and the trough so it faces up', () => {
        const grid = buildWaveGrid(tierFor('Minimal'));
        const { count, wrong } = facing(grid, 0);
        expect(wrong).toEqual([]);
        expect(count.tube).toBeGreaterThan(1000);
        expect(count.trough).toBeGreaterThan(1000);
        expect(count.swell).toBeGreaterThan(1000);
    });

    it('keeps facing the rider while the barrel is open', () => {
        const grid = buildWaveGrid(tierFor('Minimal'));
        for (const open of [0.5, 1]) {
            const { count, wrong } = facing(grid, open);
            expect(wrong, `open ${open}`).toEqual([]);
            expect(count.tube).toBeGreaterThan(1000);
        }
    });

    it.each(QUALITY_NAMES)('folds the %s tier the same way round, from a finer grid for a dearer tier', (quality) => {
        const tier = QUALITY[quality];
        const grid = buildWaveGrid(tier);
        expect(grid.rows).toHaveLength(tier.floorRows + tier.arcRows + 1);
        expect(grid.geometry.getIndex().count % 3).toBe(0);
        const { count, wrong } = facing(grid, 0);
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(count.tube).toBeGreaterThan(1000);
        // Never fewer triangles than the tier below it.
        const below = QUALITY_NAMES[QUALITY_NAMES.indexOf(quality) - 1];
        if (below) {
            const cheaper = buildWaveGrid(QUALITY[below]);
            expect(grid.geometry.getIndex().count).toBeGreaterThanOrEqual(cheaper.geometry.getIndex().count);
        }
    });

    it('folds no triangle of the tube to nothing, and keeps the tube\'s cells small beside the tube', () => {
        const grid = buildWaveGrid(tierFor('Minimal'));
        const folded = fold(grid, 0);
        let smallest = Infinity;
        let largest = 0;
        eachFace(grid, folded, (face) => {
            const d = -face.z;
            if (face.rowMin < 0 || !(d > 0 && d < 10)) return;
            if (!(shoulderWeight(d, 0) === 0 && sectionScale(d, 0) === 1)) return;
            smallest = Math.min(smallest, face.area);
            largest = Math.max(largest, face.area);
        });
        expect(smallest).toBeGreaterThan(0);
        // Even the cheapest tier's cells are a fraction of the tube's own section.
        expect(largest).toBeLessThan(WAVE.a * WAVE.b * 0.1);
    });
});

describe('waves: the dolphin', () => {
    const model = buildDolphin();
    const vertices = model.positions.length / 3;

    it('lofts a body whose skin faces away from its spine', () => {
        // The body's rings stand at one x each: the middle of a ring is on the spine.
        const rings = new Map();
        for (let v = 0; v < model.body; v++) {
            const x = model.positions[v * 3];
            if (!rings.has(x)) rings.set(x, []);
            rings.get(x).push(v);
        }
        expect(rings.size).toBeGreaterThan(8);
        let checked = 0;
        const wrong = [];
        for (const [x, ring] of rings) {
            expect(ring.length, `ring at x ${x}`).toBeGreaterThanOrEqual(3);
            if (Math.abs(x) > 0.9) continue; // the tips of the nose and the tail stock close to a point
            let cy = 0;
            let cz = 0;
            for (const v of ring) {
                cy += model.positions[v * 3 + 1] / ring.length;
                cz += model.positions[v * 3 + 2] / ring.length;
            }
            for (const v of ring) {
                const ry = model.positions[v * 3 + 1] - cy;
                const rz = model.positions[v * 3 + 2] - cz;
                const outward = (model.normals[v * 3 + 1] * ry + model.normals[v * 3 + 2] * rz) / Math.hypot(ry, rz);
                if (!(outward > 0)) wrong.push(`vertex ${v} at x ${x}: its normal points at the spine (${outward})`);
                checked += 1;
            }
        }
        expect(wrong).toEqual([]);
        expect(checked).toBeGreaterThan(100);
    });

    it('turns its back up and its belly down', () => {
        let back = 0;
        let belly = 0;
        const wrong = [];
        for (let v = 0; v < model.body; v++) {
            const x = model.positions[v * 3];
            const z = model.positions[v * 3 + 2];
            if (Math.abs(x) > 0.9 || Math.abs(z) > 1e-6) continue; // the ridge of the back and the keel
            const y = model.positions[v * 3 + 1];
            const ny = model.normals[v * 3 + 1];
            if (y > 0) {
                back += 1;
                if (!(ny > 0.5)) wrong.push(`back vertex ${v}: normal.y ${ny}`);
            } else {
                belly += 1;
                if (!(ny < -0.5)) wrong.push(`belly vertex ${v}: normal.y ${ny}`);
            }
        }
        expect(wrong).toEqual([]);
        expect(back).toBeGreaterThan(8);
        expect(belly).toBeGreaterThan(8);
    });

    it('spans from its nose at +1 to its flukes a little past -1, the same on both sides', () => {
        let minX = Infinity;
        let maxX = -Infinity;
        let bodyMin = Infinity;
        let bodyMax = -Infinity;
        let lean = 0;
        for (let v = 0; v < vertices; v++) {
            const x = model.positions[v * 3];
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            if (v < model.body) {
                bodyMin = Math.min(bodyMin, x);
                bodyMax = Math.max(bodyMax, x);
            }
            lean += model.positions[v * 3 + 2];
        }
        // The lofted body is the two units DOLPHIN_LENGTH is the size of; the flukes trail behind it.
        expect(bodyMax).toBe(1);
        expect(bodyMin).toBe(-1);
        expect(maxX).toBe(1);
        expect(minX).toBeLessThan(-1.05);
        expect(minX).toBeGreaterThan(-1.4);
        expect(Math.abs(lean)).toBeLessThan(1e-4); // left and right mirror each other
        expect(DOLPHIN_LENGTH).toBeGreaterThan(0);
        // Slim: nowhere is it as thick as it is long.
        for (let v = 0; v < model.body; v++) {
            expect(Math.hypot(model.positions[v * 3 + 1], model.positions[v * 3 + 2])).toBeLessThan(0.5);
        }
    });

    it('indexes only its own vertices and gives every one of them a finite unit normal', () => {
        expect(model.normals).toHaveLength(model.positions.length);
        expect(model.indices.length % 3).toBe(0);
        expect(model.indices.length).toBeGreaterThan(0);
        const used = new Uint8Array(vertices);
        for (const v of model.indices) {
            expect(v).toBeLessThan(vertices);
            used[v] = 1;
        }
        expect(used.every((flag) => flag === 1)).toBe(true);
        const bad = [];
        for (let v = 0; v < vertices; v++) {
            const length = Math.hypot(model.normals[v * 3], model.normals[v * 3 + 1], model.normals[v * 3 + 2]);
            if (!(Math.abs(length - 1) < 1e-4)) bad.push(`vertex ${v}: |normal| ${length}`);
        }
        expect(bad).toEqual([]);
        // The fins come after the body, and every triangle of a fin is a fin's.
        expect(model.body).toBeGreaterThan(0);
        expect(model.body).toBeLessThan(vertices);
        let mixed = 0;
        for (let k = 0; k < model.indices.length; k += 3) {
            const inBody = [0, 1, 2].filter((i) => model.indices[k + i] < model.body).length;
            if (inBody !== 0 && inBody !== 3) mixed += 1;
        }
        expect(mixed).toBe(0);
        // What is drawn is what is returned.
        expect(Array.from(model.geometry.getAttribute('position').array)).toEqual(Array.from(model.positions));
        expect(Array.from(model.geometry.getAttribute('normal').array)).toEqual(Array.from(model.normals));
        expect(Array.from(model.geometry.getIndex().array)).toEqual(Array.from(model.indices));
    });

    it('lofts as many rings and sides as it is asked for', () => {
        const coarse = buildDolphin(8, 6);
        expect(coarse.body).toBe(9 * 6);
        expect(coarse.positions.length / 3).toBeGreaterThan(coarse.body);
        expect(coarse.indices.length % 3).toBe(0);
        expect(Math.max(...coarse.indices)).toBe(coarse.positions.length / 3 - 1);
        const fine = buildDolphin(40, 16);
        expect(fine.body).toBe(41 * 16);
        // The fins are the same fins whatever the body is lofted from.
        expect(fine.positions.length / 3 - fine.body).toBe(coarse.positions.length / 3 - coarse.body);
        expect(vertices - model.body).toBe(coarse.positions.length / 3 - coarse.body);
    });
});
