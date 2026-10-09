/**
 * Voltage Storm — lightning without a GPU: the plan of the ribbon every bolt is drawn with, its
 * mesh, and the table that owns the slots (what fires where, how a bolt's light runs in time, a
 * chain's standing arcs, the frame's lights).
 *
 * Nothing here pins a width, a gain or a duration: the look is still being tuned.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BOLT_DETAIL, BoltTable, boltGeometry, boltStrips,
} from '../../src/themes/voltage-storm/voltage-storm-bolts.js';
import {
    BOLT_RANGES, BOLT_ROWS, BOLT_SLOTS, FLASH_SLOTS, hash2, strokeLife, strokeLight, strokePlan,
} from '../../src/themes/voltage-storm/voltage-storm-core.js';

const DETAILS = BOLT_DETAIL.map((_, detail) => detail);
const KINDS = Object.keys(BOLT_RANGES);

/** A row as the table needs it when no renderer is about. */
function plainRow() {
    return {
        x: 0,
        y: 0,
        z: 0,
        w: 0,
        set(x, y, z, w) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
            return this;
        },
    };
}

function makeTable({ plain = false } = {}) {
    const rows = Array.from({ length: BOLT_SLOTS * BOLT_ROWS }, () => (plain ? plainRow() : new THREE.Vector4()));
    return { rows, table: new BoltTable(rows) };
}

/** A bolt with every number the table needs and nothing left to a default that may be tuned. */
function bolt(over = {}) {
    return {
        kind: 'strike',
        start: [10, 300, -500],
        end: [40, 0, -420],
        rgb: [0.5, 0.6, 1.0],
        time: 0,
        reach: 0.05,
        width: 3,
        power: 1,
        leader: 0.125,
        strokes: 3,
        branches: 0.75,
        glow: 400,
        glowGain: 2,
        ...over,
    };
}

const read = (row) => [row.x, row.y, row.z, row.w];
/** Row `k` (0 = A … 4 = E) of a slot. */
const rowOf = (rows, slot, k) => rows[slot * BOLT_ROWS + k];
const lightRow = (rows, slot) => read(rowOf(rows, slot, 3));
const everyRow = (rows) => rows.map(read);
const ZERO = [0, 0, 0, 0];

/** One vertex attribute as an array of tuples. */
function tuples(geometry, name) {
    const attribute = geometry.getAttribute(name);
    const out = [];
    for (let i = 0; i < attribute.count; i++) {
        out.push(Array.from({ length: attribute.itemSize }, (_, k) => attribute.array[i * attribute.itemSize + k]));
    }
    return out;
}

describe('voltage storm bolts: the plan of the ribbon', () => {
    it('plans the same strips every time, more of them at every detail level', () => {
        for (const detail of DETAILS) expect(boltStrips(detail)).toEqual(boltStrips(detail));
        expect(boltStrips()).toEqual(boltStrips(DETAILS.length - 1));
        const quads = DETAILS.map((detail) => boltStrips(detail).reduce((sum, strip) => sum + strip.segments, 0));
        const counts = DETAILS.map((detail) => boltStrips(detail).length);
        for (let i = 1; i < DETAILS.length; i++) {
            expect(quads[i]).toBeGreaterThan(quads[i - 1]);
            expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        }
        // A level it does not have is the nearest one it has.
        expect(boltStrips(-4)).toEqual(boltStrips(0));
        expect(boltStrips(99)).toEqual(boltStrips(DETAILS.length - 1));
    });

    it('has one main channel, first, running the whole bolt, and an id of its own for every strip', () => {
        for (const detail of DETAILS) {
            const strips = boltStrips(detail);
            const mains = strips.filter((strip) => strip.depth === 0);
            expect(mains).toHaveLength(1);
            expect(strips[0]).toBe(mains[0]);
            expect(mains[0].length).toBe(1);
            expect(mains[0].segments).toBe(BOLT_DETAIL[detail].main);
            for (const strip of strips) {
                expect([0, 1, 2]).toContain(strip.depth);
                expect(Number.isInteger(strip.segments)).toBe(true);
                expect(strip.segments).toBeGreaterThan(0);
            }
            // The id seeds a limb's shape: two strips with one id would be drawn on top of each other.
            expect(new Set(strips.map((strip) => strip.id)).size).toBe(strips.length);
        }
    });

    it('lets every branch leave the channel between its ends, shorter than the channel', () => {
        for (const detail of DETAILS) {
            const branches = boltStrips(detail).filter((strip) => strip.depth === 1);
            expect(branches).toHaveLength(BOLT_DETAIL[detail].branches);
            for (const branch of branches) {
                expect(branch.s0).toBeGreaterThan(0);
                expect(branch.s0).toBeLessThan(1);
                expect(branch.length).toBeGreaterThan(0);
                expect(branch.length).toBeLessThan(1);
            }
            // They leave it one after another down its length, never two from one place.
            for (let i = 1; i < branches.length; i++) expect(branches[i].s0).toBeGreaterThan(branches[i - 1].s0);
        }
    });

    it('hangs every twig on a branch that exists, part of the way along it', () => {
        for (const detail of DETAILS) {
            const strips = boltStrips(detail);
            const branches = new Map(strips.filter((strip) => strip.depth === 1).map((strip) => [strip.id, strip]));
            const twigs = strips.filter((strip) => strip.depth === 2);
            expect(twigs).toHaveLength(BOLT_DETAIL[detail].twigs);
            for (const twig of twigs) {
                const parent = branches.get(twig.parentId);
                expect(parent, `twig ${twig.id}`).toBeDefined();
                expect(twig.s0).toBe(parent.s0);
                expect(twig.parentLength).toBe(parent.length);
                expect(twig.u0).toBeGreaterThan(0);
                expect(twig.u0).toBeLessThan(1);
                expect(twig.length).toBeGreaterThan(0);
                expect(twig.length).toBeLessThan(parent.length);
            }
        }
    });
});

describe('voltage storm bolts: the ribbon mesh', () => {
    it('has attributes that agree with the plan, an index inside them and no NaN', () => {
        for (const detail of DETAILS) {
            const strips = boltStrips(detail);
            const geometry = boltGeometry(detail);
            const vertices = strips.reduce((sum, strip) => sum + (strip.segments + 1) * 2, 0);
            const quads = strips.reduce((sum, strip) => sum + strip.segments, 0);
            for (const name of ['position', 'aRib', 'aLink', 'aParent']) {
                expect(geometry.getAttribute(name).count, name).toBe(vertices);
                expect(geometry.getAttribute(name).array.every((v) => Number.isFinite(v)), name).toBe(true);
            }
            const index = geometry.getIndex();
            expect(index.count).toBe(quads * 6);
            expect(geometry.userData.quads).toBe(quads);
            expect(geometry.userData.strips).toBe(strips.length);
            // The index is 16-bit: the whole ribbon has to fit in it.
            expect(vertices).toBeLessThanOrEqual(65536);
            expect(Math.min(...index.array)).toBeGreaterThanOrEqual(0);
            expect(Math.max(...index.array)).toBeLessThan(vertices);
        }
    });

    it('gives every rib both edges of the ribbon, and runs each strip from its root to its end', () => {
        for (const detail of DETAILS) {
            const strips = boltStrips(detail);
            const rib = tuples(boltGeometry(detail), 'aRib');
            let v = 0;
            for (const strip of strips) {
                for (let i = 0; i <= strip.segments; i++) {
                    const [alongA, sideA, depthA, idA] = rib[v];
                    const [alongB, sideB, depthB, idB] = rib[v + 1];
                    expect([sideA, sideB]).toEqual([-1, 1]);
                    expect(alongA).toBe(alongB);
                    expect(alongA).toBeCloseTo(i / strip.segments, 6);
                    expect([depthA, depthB]).toEqual([strip.depth, strip.depth]);
                    expect([idA, idB]).toEqual([strip.id, strip.id]);
                    v += 2;
                }
            }
            expect(v).toBe(rib.length);
        }
    });

    it('tells every vertex where its strip leaves its parent', () => {
        for (const detail of DETAILS) {
            const strips = new Map(boltStrips(detail).map((strip) => [strip.id, strip]));
            const geometry = boltGeometry(detail);
            const rib = tuples(geometry, 'aRib');
            const link = tuples(geometry, 'aLink');
            const parent = tuples(geometry, 'aParent');
            for (let v = 0; v < rib.length; v++) {
                const strip = strips.get(rib[v][3]);
                expect(link[v][0]).toBeCloseTo(strip.s0, 6);
                expect(link[v][1]).toBeCloseTo(strip.length, 6);
                expect(link[v][2]).toBeCloseTo(strip.u0, 6);
                expect(link[v][3]).toBe(strip.parentId);
                expect(parent[v][0]).toBeCloseTo(strip.parentLength, 6);
            }
        }
    });

    it('joins neighbouring ribs of one strip into two triangles, and never joins two strips', () => {
        for (const detail of DETAILS) {
            const geometry = boltGeometry(detail);
            const rib = tuples(geometry, 'aRib');
            const index = geometry.getIndex().array;
            const perStrip = new Map();
            for (let t = 0; t < index.length; t += 3) {
                const corners = [index[t], index[t + 1], index[t + 2]];
                expect(new Set(corners).size).toBe(3);
                const ids = new Set(corners.map((i) => rib[i][3]));
                expect(ids.size).toBe(1);
                // Two ribs next to each other, and both edges of the ribbon.
                const ribs = [...new Set(corners.map((i) => Math.floor(i / 2)))].sort((a, b) => a - b);
                expect(ribs).toHaveLength(2);
                expect(ribs[1] - ribs[0]).toBe(1);
                expect(new Set(corners.map((i) => rib[i][1])).size).toBe(2);
                const [id] = ids;
                perStrip.set(id, (perStrip.get(id) || 0) + 1);
            }
            for (const strip of boltStrips(detail)) expect(perStrip.get(strip.id)).toBe(strip.segments * 2);
        }
    });
});

describe('voltage storm bolts: firing into the table', () => {
    it('fires each kind into its own range, one slot after another, and round again over the oldest', () => {
        const { table, rows } = makeTable();
        expect(table.liveCount()).toBe(0);
        for (const kind of KINDS) {
            const [from, to] = BOLT_RANGES[kind];
            const size = to - from;
            expect(table.isLive(kind, 0)).toBe(false);
            for (let i = 0; i < size + 2; i++) {
                const slot = table.fire(bolt({ kind, start: [i, 0, 0] }));
                expect(slot, `${kind} ${i}`).toBe(from + (i % size));
            }
            // The first two slots hold the newest two bolts now; the rest are untouched.
            expect(rowOf(rows, from, 0).x).toBe(size);
            expect(rowOf(rows, from + 1, 0).x).toBe(size + 1);
            if (size > 2) expect(rowOf(rows, from + 2, 0).x).toBe(2);
        }
        expect(table.liveCount()).toBe(BOLT_SLOTS);
        // One kind's turn is not another's.
        const fresh = makeTable().table;
        fresh.fire(bolt({ kind: 'strike' }));
        fresh.fire(bolt({ kind: 'strike' }));
        expect(fresh.fire(bolt({ kind: 'arc' }))).toBe(BOLT_RANGES.arc[0]);
    });

    it('pins a bolt to the slot it names, without taking a turn', () => {
        const { table } = makeTable();
        const [from, to] = BOLT_RANGES.chain;
        expect(table.fire(bolt({ kind: 'chain', index: 3 }))).toBe(from + 3);
        expect(table.fire(bolt({ kind: 'chain', index: 3 }))).toBe(from + 3);
        expect(table.liveCount()).toBe(1);
        expect(table.isLive('chain', 3)).toBe(true);
        expect(table.isLive('chain', 2)).toBe(false);
        // A slot beyond the range comes back round inside it, never into the next kind's.
        const wrapped = table.fire(bolt({ kind: 'chain', index: to - from + 1 }));
        expect(wrapped).toBe(from + 1);
        expect(table.fire(bolt({ kind: 'chain' }))).toBe(from);
    });

    it('writes where a bolt runs, its seed, its colour and its width into its own rows', () => {
        const { table, rows } = makeTable();
        const pinned = {};
        const veiled = {};
        for (const kind of KINDS) {
            const fired = bolt({
                kind, seed: 123, start: [1, 2, 3], end: [4, 5, 6], rgb: [0.25, 0.5, 0.75], reach: 0.0625, width: 2.5,
            });
            const slot = table.fire(fired);
            expect(read(rowOf(rows, slot, 0)), kind).toEqual([1, 2, 3, 123]);
            expect(read(rowOf(rows, slot, 1)), kind).toEqual([4, 5, 6, 0.0625]);
            expect(read(rowOf(rows, slot, 2)), kind).toEqual([0.25, 0.5, 0.75, 2.5]);
            expect(lightRow(rows, slot), kind).toEqual(ZERO);
            expect(rowOf(rows, slot, 4).y, kind).toBe(fired.branches);
            pinned[kind] = rowOf(rows, slot, 4).x;
            veiled[kind] = rowOf(rows, slot, 4).z;
        }
        // An arc and a chain's arc are held at both ends; a strike's foot is free to wander, and
        // only a strike comes down out of the cloud.
        expect(pinned).toMatchObject({ strike: 0, arc: 1, chain: 1 });
        expect(veiled).toMatchObject({ strike: 1, arc: 0, chain: 0 });
    });

    it('never touches another slot\'s rows', () => {
        for (const kind of KINDS) {
            const { table, rows } = makeTable();
            rows.forEach((row, i) => row.set(7 + i, 8, 9, 10));
            const before = everyRow(rows);
            const slot = table.fire(bolt({ kind, held: kind === 'chain' }));
            for (let time = -0.5; time < 6; time += 1 / 30) table.update(time);
            table.release(kind, slot - BOLT_RANGES[kind][0], 6);
            for (let time = 6; time < 12; time += 1 / 30) table.update(time);
            const after = everyRow(rows);
            for (let i = 0; i < after.length; i++) {
                if (Math.floor(i / BOLT_ROWS) !== slot) expect(after[i], `${kind}: row ${i}`).toEqual(before[i]);
            }
            expect(table.liveCount()).toBe(0);
        }
    });

    it('gives every bolt a shape of its own unless one is asked for, the same ones after a reset', () => {
        const { table, rows } = makeTable();
        const fire = (i) => table.fire(bolt({ kind: KINDS[i % KINDS.length] }));
        const seeds = () => Array.from({ length: 30 }, (_, i) => rowOf(rows, fire(i), 0).w);
        const first = seeds();
        for (const seed of first) {
            expect(Number.isFinite(seed)).toBe(true);
            expect(seed).toBeGreaterThan(0);
        }
        expect(new Set(first).size).toBe(first.length);
        expect(rowOf(rows, table.fire(bolt({ seed: 77.5 })), 0).w).toBe(77.5);
        table.reset();
        expect(seeds()).toEqual(first);
    });

    it('accepts plain rows as well as vectors', () => {
        const { table, rows } = makeTable({ plain: true });
        const plan = strokePlan(9, { leader: 0.125, strokes: 2, power: 1.5 });
        const slot = table.fire(bolt({
            kind: 'arc', seed: 9, strokes: 2, power: 1.5, start: [1, 2, 3],
        }));
        const lights = table.update(0.125);
        expect(read(rowOf(rows, slot, 0))).toEqual([1, 2, 3, 9]);
        expect(lightRow(rows, slot)).toEqual([1, plan.gains[0], plan.gains[0], 0]);
        expect(lights).toHaveLength(1);
        table.reset();
        for (const row of everyRow(rows)) expect(row).toEqual(ZERO);
    });
});

describe('voltage storm bolts: a bolt\'s life in the table', () => {
    it('is dark, and keeps its slot, until its time comes', () => {
        const { table, rows } = makeTable();
        const slot = table.fire(bolt({ time: 8 }));
        for (const time of [-3, 0, 7.5, 7.999]) {
            expect(table.update(time)).toHaveLength(0);
            expect(lightRow(rows, slot)).toEqual(ZERO);
            expect(table.liveCount()).toBe(1);
        }
        table.update(8.0625);
        expect(rowOf(rows, slot, 3).x).toBeGreaterThan(0);
    });

    it('writes the light of its own plan at every age: leader, strokes, branches, afterglow', () => {
        const { table, rows } = makeTable();
        const options = { leader: 0.125, strokes: 4, power: 1.25 };
        const plan = strokePlan(41, options);
        // Times a float holds exactly, so an age is the same number here and in the table.
        const slot = table.fire(bolt({ time: 8, seed: 41, ...options }));
        for (let k = 0; k <= 96; k++) {
            const age = k / 64;
            table.update(8 + age);
            const light = strokeLight(plan, age);
            expect(lightRow(rows, slot), `age ${age}`).toEqual([light.grow, light.main, light.branch, light.after]);
        }
    });

    it('grows with the leader and is brightest as the leader lands', () => {
        const { table, rows } = makeTable();
        const slot = table.fire(bolt({ time: 8, strokes: 1, power: 0.75 }));
        let grown = 0;
        let brightest = 0;
        for (let k = 0; k <= 8; k++) {
            table.update(8 + k / 64);
            const [grow, main] = lightRow(rows, slot);
            expect(grow).toBeGreaterThanOrEqual(grown);
            if (k < 8) expect(main).toBe(0);
            grown = grow;
        }
        expect(lightRow(rows, slot).slice(0, 2)).toEqual([1, 0.75]);
        for (let k = 0; k <= 128; k++) {
            table.update(8 + k / 64);
            brightest = Math.max(brightest, rowOf(rows, slot, 3).y);
        }
        expect(brightest).toBe(0.75);
    });

    it('frees its slot once its life is over, and not a moment before', () => {
        const { table, rows } = makeTable();
        const options = { leader: 0.125, strokes: 3, power: 1 };
        const life = strokeLife(strokePlan(5, options));
        const slot = table.fire(bolt({
            kind: 'arc', time: 2, seed: 5, ...options,
        }));
        table.fire(bolt({ kind: 'crawler', time: 50 }));
        table.fire(bolt({ kind: 'chain', index: 2, held: true }));
        table.update(2 + life - 0.01);
        expect(table.liveCount()).toBe(3);
        expect(table.isLive('arc', slot - BOLT_RANGES.arc[0])).toBe(true);
        // The arc is spent; the crawler is still to come and the chain's arc is held.
        expect(table.update(2 + life + 0.01)).toHaveLength(1);
        expect(table.liveCount()).toBe(2);
        expect(table.isLive('arc', slot - BOLT_RANGES.arc[0])).toBe(false);
        expect(lightRow(rows, slot)).toEqual(ZERO);
        // A dead bolt stays dead, even asked about a moment when it was alight.
        table.update(2 + options.leader);
        expect(lightRow(rows, slot)).toEqual(ZERO);
    });

    it('empties one kind at once when asked, and everything on reset', () => {
        const { table, rows } = makeTable();
        for (const kind of KINDS) table.fire(bolt({ kind, held: kind === 'chain' }));
        table.fire(bolt({ kind: 'chain', index: 3, held: true }));
        expect(table.update(0.125).length).toBeGreaterThan(0);
        // A kind: no afterglow, the others as they were.
        table.clear('chain');
        expect(table.liveCount()).toBe(KINDS.length - 1);
        expect(table.isLive('chain', 3)).toBe(false);
        const [from, to] = BOLT_RANGES.chain;
        for (let slot = from; slot < to; slot++) expect(lightRow(rows, slot)).toEqual(ZERO);
        expect(table.update(0.25)).toHaveLength(KINDS.length - 1);
        expect(() => table.clear('no such kind')).not.toThrow();
        expect(table.liveCount()).toBe(KINDS.length - 1);

        table.reset();
        expect(table.liveCount()).toBe(0);
        for (const row of everyRow(rows)) expect(row).toEqual(ZERO);
        expect(table.update(0.125)).toHaveLength(0);
        expect(table.update(100)).toHaveLength(0);
        for (const row of everyRow(rows)) expect(row).toEqual(ZERO);
        // Every kind takes its turns from the start again.
        for (const kind of KINDS) expect(table.fire(bolt({ kind }))).toBe(BOLT_RANGES[kind][0]);
    });
});

describe('voltage storm bolts: a chain\'s standing arc', () => {
    const options = { leader: 0.125, strokes: 3, power: 0.75 };
    const tail = strokeLife(strokePlan(31, options)) - strokePlan(31, options).last;
    const hold = (table, time = 2) => table.fire(bolt({
        kind: 'chain', index: 1, held: true, time, seed: 31, ...options,
    }));

    it('rises from nothing and stands, lit, for as long as it is held', () => {
        const { table, rows } = makeTable();
        const slot = hold(table);
        table.update(2);
        expect(rowOf(rows, slot, 3).y).toBe(0);
        for (const time of [2.5, 3, 10, 500, 5000]) {
            const lights = table.update(time);
            expect(table.isLive('chain', 1)).toBe(true);
            // Drawn end to end, never as a leader on its way.
            expect(rowOf(rows, slot, 3).x).toBe(1);
            expect(rowOf(rows, slot, 3).y).toBeGreaterThan(0);
            expect(lights).toHaveLength(1);
            expect(lights[0].level).toBeGreaterThan(0);
        }
    });

    it('flickers but never goes out, and never outshines its own power', () => {
        const { table, rows } = makeTable();
        const slot = hold(table);
        const seen = new Set();
        for (let time = 3; time < 6; time += 1 / 120) {
            table.update(time);
            const { y } = rowOf(rows, slot, 3);
            expect(y).toBeGreaterThan(0);
            expect(y).toBeLessThanOrEqual(options.power);
            seen.add(y.toFixed(4));
        }
        expect(seen.size).toBeGreaterThan(20);
    });

    it('is redrawn as it stands: its seed keeps changing, its ends and its colour stay', () => {
        const { table, rows } = makeTable();
        const slot = hold(table);
        const ends = [read(rowOf(rows, slot, 0)).slice(0, 3), read(rowOf(rows, slot, 1)), read(rowOf(rows, slot, 2))];
        const seeds = [];
        for (let time = 2; time < 4; time += 1 / 120) {
            table.update(time);
            seeds.push(rowOf(rows, slot, 0).w);
            expect(Number.isFinite(rowOf(rows, slot, 0).w)).toBe(true);
        }
        const changes = seeds.filter((seed, i) => i > 0 && seed !== seeds[i - 1]).length;
        expect(changes).toBeGreaterThanOrEqual(2);
        expect(new Set(seeds).size).toBeGreaterThan(2);
        const now = [read(rowOf(rows, slot, 0)).slice(0, 3), read(rowOf(rows, slot, 1)), read(rowOf(rows, slot, 2))];
        expect(now).toEqual(ends);
    });

    it('cools when it is let go, then frees its slot; asking again does not hold it any longer', () => {
        const { table, rows } = makeTable();
        const slot = hold(table);
        table.update(9.99);
        table.release('chain', 1, 10);
        table.update(10);
        expect(table.isLive('chain', 1)).toBe(true);
        let previous = Infinity;
        for (let time = 10 + tail / 40; time < 10 + tail; time += tail / 40) {
            if (time > 10 + tail / 2) table.release('chain', 1, time);
            table.update(time);
            const glow = rowOf(rows, slot, 3).w;
            expect(glow).toBeGreaterThan(0);
            expect(glow).toBeLessThan(previous);
            previous = glow;
        }
        expect(table.update(10 + tail + 0.01)).toHaveLength(0);
        expect(table.isLive('chain', 1)).toBe(false);
        expect(lightRow(rows, slot)).toEqual(ZERO);
    });

    it('ignores being let go when it holds nothing, or when the bolt was never held', () => {
        const { table, rows } = makeTable();
        expect(() => table.release('chain', 4, 3)).not.toThrow();
        expect(table.isLive('chain', 4)).toBe(false);
        expect(table.liveCount()).toBe(0);
        // An arc that was fired to run its course runs it, whatever is asked of its slot.
        const plan = strokePlan(31, options);
        const slot = table.fire(bolt({
            kind: 'chain', index: 0, time: 8, seed: 31, ...options,
        }));
        table.release('chain', 0, 8.0625);
        table.update(8.25);
        const light = strokeLight(plan, 0.25);
        expect(lightRow(rows, slot)).toEqual([light.grow, light.main, light.branch, light.after]);
    });
});

describe('voltage storm bolts: the frame\'s lights', () => {
    it('lists at most FLASH_SLOTS lights, the brightest, brightest first', () => {
        const { table } = makeTable();
        // More bolts than the flash table has rows, a slot each, whatever kind the slot is.
        const kinds = KINDS.flatMap((kind) => new Array(BOLT_RANGES[kind][1] - BOLT_RANGES[kind][0]).fill(kind));
        const count = Math.min(BOLT_SLOTS, FLASH_SLOTS + 5);
        expect(count).toBeGreaterThan(FLASH_SLOTS);
        // Powers in no order at all.
        const powers = Array.from({ length: count }, (_, i) => 0.2 + i * 0.1)
            .sort((a, b) => hash2(a * 10, 9) - hash2(b * 10, 9));
        powers.forEach((power, i) => table.fire(bolt({
            kind: kinds[i], strokes: 1, power, start: [i, 0, 0], end: [i, 0, 0], glowGain: 1,
        })));
        const lights = table.update(0.125);
        expect(lights).toHaveLength(FLASH_SLOTS);
        for (let i = 1; i < lights.length; i++) expect(lights[i].level).toBeLessThanOrEqual(lights[i - 1].level);
        // Each light is where its bolt is: the ones listed are the ones with the most power.
        const listed = lights.map((light) => powers[light.x]);
        expect(listed).toEqual([...powers].sort((a, b) => b - a).slice(0, FLASH_SLOTS));
        // And a light's level follows its bolt's power.
        for (const light of lights) expect(light.level / lights[0].level).toBeCloseTo(powers[light.x] / listed[0], 9);

        // Fewer are listed when fewer are alight, and none once they have gone out.
        table.reset();
        table.fire(bolt({ kind: 'strike' }));
        table.fire(bolt({ kind: 'crawler' }));
        table.fire(bolt({ kind: 'arc', time: 40 }));
        expect(table.update(0.125)).toHaveLength(2);
        expect(table.update(30)).toHaveLength(0);
        expect(table.update(40.125)).toHaveLength(1);
    });

    it('throws no light from a bolt with no glow, though the bolt itself is drawn', () => {
        const { table, rows } = makeTable();
        const slot = table.fire(bolt({ glow: 0 }));
        let drawn = 0;
        for (let k = 0; k <= 200; k++) {
            expect(table.update(k / 64)).toHaveLength(0);
            drawn = Math.max(drawn, rowOf(rows, slot, 3).y);
        }
        expect(drawn).toBeGreaterThan(0);
    });

    it('reports each light with its bolt\'s reach, gain and colour', () => {
        const { table } = makeTable();
        table.fire(bolt({
            kind: 'arc', rgb: [0.2, 0.5, 1.0], glow: 321, glowGain: 1.75,
        }));
        const [light] = table.update(0.125);
        expect(light.reach).toBe(321);
        expect(light.gain).toBe(1.75);
        for (const channel of [light.r, light.g, light.b]) {
            expect(channel).toBeGreaterThan(0);
            expect(channel).toBeLessThanOrEqual(1);
        }
        expect(light.b).toBeGreaterThan(light.g);
        expect(light.g).toBeGreaterThan(light.r);
    });

    it('throws a strike\'s light from up where it leaves the cloud, and an arc\'s from between its ends', () => {
        const { table } = makeTable();
        const start = [0, 300, -600];
        const end = [90, 0, -420];
        /** How far along start → end a light stands, and how far off that line. */
        const place = (light) => {
            const along = (light.y - start[1]) / (end[1] - start[1]);
            const off = Math.hypot(
                light.x - (start[0] + (end[0] - start[0]) * along),
                light.z - (start[2] + (end[2] - start[2]) * along),
            );
            return { along, off };
        };
        table.fire(bolt({ kind: 'strike', start, end }));
        const strike = place(table.update(0.125)[0]);
        table.reset();
        table.fire(bolt({ kind: 'arc', start, end }));
        const arc = place(table.update(0.125)[0]);
        expect(strike.off).toBeCloseTo(0, 9);
        expect(arc.off).toBeCloseTo(0, 9);
        expect(strike.along).toBeGreaterThanOrEqual(0);
        expect(strike.along).toBeLessThan(0.5);
        expect(arc.along).toBeGreaterThan(strike.along);
        expect(arc.along).toBeLessThan(1);
    });
});
