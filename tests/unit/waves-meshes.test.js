/**
 * Waves — the meshes face the right way.
 *
 * The water is one sheet, folded into the wave by the vertex stage and drawn front side only: the
 * rider is inside the tube, so a quad wound the wrong way is a hole in the wall, and one flipped
 * column is a slit the sky shows through. The sea life is built in Blender and read from one small
 * pack (src/themes/waves/assets/sea-life.glb, waves-cast.js): each animal is drawn front side only
 * and lit by its own normals, so a triangle wound against them is an animal lit from inside, and a
 * vertex that does not say what it is (which animal, which fin, how far along the body) is swum by
 * the wrong body plan. None of these mistakes throws; these tests fold the grid on the CPU, with
 * the same shape the shader mirrors (waves-core.js `wavePoint`), read the pack from disk the way
 * the theme reads it, and pin the facing of both.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    WAVE, axisOffset, sectionScale, shoulderWeight, wavePoint,
} from '../../src/themes/waves/waves-core.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import { buildWaveGrid } from '../../src/themes/waves/waves-water.js';
import { KINDS } from '../../src/themes/waves/waves-acts.js';
import { parseSeaLife } from '../../src/themes/waves/waves-cast.js';

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

describe('waves: the sea life pack', () => {
    const bytes = readFileSync(new URL('../../src/themes/waves/assets/sea-life.glb', import.meta.url));
    const pack = parseSeaLife(bytes);
    /** What the pack says of itself: the JSON chunk of the file (its first), as written by the build. */
    const said = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    const node = (name) => said.nodes.find((entry) => entry.name === name);
    const body = (name) => pack.kinds[name].geometry;

    /** How wide, tall and long a body is, and where its ends are. */
    function boxOf(name) {
        const position = body(name).getAttribute('position');
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < position.count; v++) {
            [position.getX(v), position.getY(v), position.getZ(v)].forEach((value, axis) => {
                min[axis] = Math.min(min[axis], value);
                max[axis] = Math.max(max[axis], value);
            });
        }
        return { min, max, size: max.map((value, axis) => value - min[axis]) };
    }

    /** Which part of the animal a vertex belongs to (the pack's own code: waves-fauna.js reads it so). */
    const partOf = (shape, v) => Math.floor(Math.round(shape.getY(v) * 255) / 3 + 0.01);
    const [BODY, FLIPPER, TAIL, DORSAL, , REAR] = [0, 1, 2, 3, 4, 5];
    /** The parts each body plan is swum by: without them the animal is a statue. */
    const SWUM_BY = {
        bottlenose: [FLIPPER, TAIL],
        spinner: [FLIPPER, TAIL],
        humpback: [FLIPPER, TAIL],
        manta: [TAIL],
        turtle: [FLIPPER, REAR],
        seabird: [FLIPPER],
    };

    it('holds the six animals, each one body with what the shaders read of every vertex', () => {
        expect(Object.keys(pack.kinds)).toEqual(KINDS);
        expect(said.scenes[0].extras.kinds).toEqual(KINDS);
        expect(pack.bytes).toBe(bytes.length);
        expect(pack.triangles).toBe(KINDS.reduce((sum, name) => sum + pack.kinds[name].triangles, 0));
        // One small file for the whole cast: far lighter than one frame's worth of the wave's mesh.
        expect(pack.bytes).toBeLessThan(1024 * 1024);
        KINDS.forEach((name, number) => {
            const geometry = body(name);
            expect(Object.keys(geometry.attributes).sort(), name).toEqual(['aPivot', 'aShape', 'aSkin', 'normal', 'position']);
            const { count } = geometry.getAttribute('position');
            expect(count, name).toBeGreaterThan(100);
            for (const [attribute, width] of [['position', 3], ['normal', 3], ['aShape', 4], ['aSkin', 4], ['aPivot', 4]]) {
                expect(geometry.getAttribute(attribute).count, `${name}.${attribute}`).toBe(count);
                expect(geometry.getAttribute(attribute).itemSize, `${name}.${attribute}`).toBe(width);
            }
            // The packed ones are whole numbers the GPU turns back into shares of one.
            for (const attribute of ['aShape', 'aSkin', 'aPivot']) {
                expect(geometry.getAttribute(attribute).normalized, `${name}.${attribute}`).toBe(true);
            }
            expect(geometry.getIndex(), name).toBeTruthy();
            expect(geometry.boundingSphere.radius, name).toBeGreaterThan(0.4);
            // Its place in the cast, which every vertex carries: the vertex stage picks the body
            // plan, and the fragment stage the skin, by it.
            expect(pack.kinds[name].kind, name).toBe(number);
            const shape = geometry.getAttribute('aShape');
            const numbers = new Set();
            for (let v = 0; v < count; v++) numbers.add(Math.round(shape.getW(v) * 255));
            expect([...numbers], name).toEqual([number]);
        });
    });

    it('gives the sun-crossing bottlenose a dorsal that stands clear of its back in silhouette', () => {
        const geometry = body('bottlenose');
        const position = geometry.getAttribute('position');
        const shape = geometry.getAttribute('aShape');
        let tip = 0;
        let back = 0;
        for (let v = 0; v < position.count; v++) {
            const part = partOf(shape, v);
            if (part === DORSAL) tip = Math.max(tip, position.getY(v));
            if (part === BODY) back = Math.max(back, position.getY(v));
        }
        expect(tip - back).toBeGreaterThan(0.085);
    });

    it.each(KINDS)('%s: one unit long from tail to nose, nose along +z, the same on both sides', (name) => {
        const { nose, tail } = pack.kinds[name];
        const { min, max, size } = boxOf(name);
        expect(min.concat(max).every(Number.isFinite)).toBe(true);
        // Its nose and its tail are where the pack says they are, about a unit apart.
        expect(max[2]).toBeGreaterThan(0);
        expect(min[2]).toBeLessThan(0);
        expect(Math.abs(max[2] - nose)).toBeLessThan(0.03);
        expect(Math.abs(min[2] - tail)).toBeLessThan(0.03);
        // (An act gives an animal its length in metres: the body is the unit it scales. The manta
        // is as short as it is because its unit is the span of its wings.)
        if (name === 'manta') {
            expect(size[0]).toBeGreaterThan(0.97);
            expect(size[0]).toBeLessThan(1.03);
            expect(size[2]).toBeGreaterThan(0.75);
        } else {
            expect(size[2]).toBeGreaterThan(0.95);
            expect(size[2]).toBeLessThan(1.1);
        }
        // The bird's wings are about twice its length across; nothing else is as wide.
        if (name === 'seabird') {
            expect(size[0]).toBeGreaterThan(2);
            expect(size[0]).toBeLessThan(2.25);
        } else {
            expect(size[0]).toBeLessThan(1.35);
        }
        // Flatter than it is long, and mirrored about its spine.
        expect(size[1]).toBeLessThan(0.4);
        expect(Math.abs(min[0] + max[0])).toBeLessThan(0.01);
        // What the build wrote down of its size is what is read back.
        const { extent } = node(name).extras;
        extent[0].forEach((value, axis) => expect(min[axis]).toBeCloseTo(value, 2));
        extent[1].forEach((value, axis) => expect(max[axis]).toBeCloseTo(value, 2));
    });

    it.each(KINDS)('%s: as many triangles as the pack says, indexing only its own vertices, each of them once', (name) => {
        const geometry = body(name);
        const index = geometry.getIndex();
        const { count } = geometry.getAttribute('position');
        expect(index.count % 3).toBe(0);
        expect(index.count / 3).toBe(node(name).extras.triangles);
        expect(pack.kinds[name].triangles).toBe(index.count / 3);
        // Small enough to draw a pod of: no animal costs more than a few thousand triangles.
        expect(index.count / 3).toBeLessThanOrEqual(6000);
        const used = new Uint8Array(count);
        let outOfRange = 0;
        for (let k = 0; k < index.count; k++) {
            const v = index.getX(k);
            if (v >= count) outOfRange += 1;
            else used[v] = 1;
        }
        expect(outOfRange).toBe(0);
        expect(used.every((flag) => flag === 1)).toBe(true);
    });

    it.each(KINDS)('%s: every triangle faces the way its normals do, and every normal is a direction', (name) => {
        const geometry = body(name);
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const index = geometry.getIndex();
        let agree = 0;
        let against = 0;
        let folded = 0;
        for (let k = 0; k < index.count; k += 3) {
            const [a, b, c] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
            const ux = position.getX(b) - position.getX(a);
            const uy = position.getY(b) - position.getY(a);
            const uz = position.getZ(b) - position.getZ(a);
            const vx = position.getX(c) - position.getX(a);
            const vy = position.getY(c) - position.getY(a);
            const vz = position.getZ(c) - position.getZ(a);
            // The face's own normal (counter-clockwise is the front) against its corners' normals.
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            const agreement = nx * (normal.getX(a) + normal.getX(b) + normal.getX(c))
                + ny * (normal.getY(a) + normal.getY(b) + normal.getY(c))
                + nz * (normal.getZ(a) + normal.getZ(b) + normal.getZ(c));
            if (Math.hypot(nx, ny, nz) < 1e-12) folded += 1;
            else if (agreement > 0) agree += 1;
            else against += 1;
        }
        // Essentially all of them: a fin's knife edge may hold a sliver that faces neither way.
        expect(agree / (index.count / 3)).toBeGreaterThan(0.995);
        expect(against).toBeLessThanOrEqual(index.count / 3 / 400);
        expect(folded).toBe(0);
        const bad = [];
        for (let v = 0; v < normal.count; v++) {
            const length = Math.hypot(normal.getX(v), normal.getY(v), normal.getZ(v));
            // (Stored as bytes: a direction to within a hundredth.)
            if (!(Math.abs(length - 1) < 0.02)) bad.push(`vertex ${v}: |normal| ${length}`);
        }
        expect(bad).toEqual([]);
    });

    it.each(KINDS)('%s: tells each vertex where along the body it is, which part it is and where that part turns from', (name) => {
        const geometry = body(name);
        const position = geometry.getAttribute('position');
        const shape = geometry.getAttribute('aShape');
        const skin = geometry.getAttribute('aSkin');
        const pivot = geometry.getAttribute('aPivot');
        const { min, max } = boxOf(name);
        const parts = new Map();
        const wrong = [];
        for (let v = 0; v < position.count; v++) {
            const part = partOf(shape, v);
            if (!parts.has(part)) parts.set(part, []);
            parts.get(part).push(v);
            const packed = [shape, skin].flatMap((attribute) => [attribute.getX(v), attribute.getY(v), attribute.getZ(v), attribute.getW(v)]);
            if (!packed.every((value) => value >= 0 && value <= 1)) wrong.push(`vertex ${v}: ${packed}`);
            // A part turns from somewhere inside the animal, never from a point off in the sea.
            const turnsFrom = [pivot.getX(v), pivot.getY(v), pivot.getZ(v)];
            if (!turnsFrom.every((value, axis) => value >= min[axis] - 0.05 && value <= max[axis] + 0.05)) {
                wrong.push(`vertex ${v}: turns from ${turnsFrom}`);
            }
        }
        expect(wrong.slice(0, 5)).toEqual([]);
        // Along the body: 0 at the nose, 1 at the tail, falling in step with z all the way.
        const trunk = parts.get(BODY);
        expect(trunk.length).toBeGreaterThan(position.count / 3);
        const along = Array.from({ length: position.count }, (_, v) => shape.getX(v));
        expect(Math.min(...along)).toBeLessThan(0.1);
        expect(Math.max(...along)).toBeGreaterThan(0.9);
        const front = trunk.filter((v) => shape.getX(v) < 0.25).map((v) => position.getZ(v));
        const rear = trunk.filter((v) => shape.getX(v) > 0.75).map((v) => position.getZ(v));
        expect(Math.min(...front)).toBeGreaterThan(Math.max(...rear));
        // The parts its body plan is swum by are there, on both sides where it has two of them,
        // each side turning from its own side of the spine.
        for (const part of SWUM_BY[name]) {
            const vertices = parts.get(part) || [];
            expect(vertices.length, `part ${part}`).toBeGreaterThan(20);
            if (part === TAIL) continue;
            const left = vertices.filter((v) => position.getX(v) < -0.02);
            const right = vertices.filter((v) => position.getX(v) > 0.02);
            expect(left.length, `part ${part}`).toBeGreaterThan(10);
            expect(right.length, `part ${part}`).toBeGreaterThan(10);
            expect(left.filter((v) => pivot.getX(v) < 0).length / left.length, `part ${part}`).toBeGreaterThan(0.95);
            expect(right.filter((v) => pivot.getX(v) >= 0).length / right.length, `part ${part}`).toBeGreaterThan(0.95);
            // How far out along the fin a vertex is: from its root to its tip.
            const out = vertices.map((v) => shape.getZ(v));
            expect(Math.max(...out), `part ${part}`).toBeGreaterThan(0.9);
            expect(Math.min(...out), `part ${part}`).toBeLessThan(0.3);
        }
        // The manta's wings are its body: the plan flies them by how far out from the spine they are.
        if (name === 'manta') expect(Math.max(...trunk.map((v) => Math.abs(position.getX(v))))).toBeGreaterThan(0.45);
    });
});
