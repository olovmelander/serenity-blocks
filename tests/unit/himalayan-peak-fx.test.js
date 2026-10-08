import {
    afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HimalayanPeakWorld } from '../../src/themes/himalayan-peak/himalayan-peak-world.js';
import { planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import {
    BLESS_HOLD, BLESS_MAX, GUST_SPEED, LUNG_TA, SUN_ELEVATION, pieceColor,
} from '../../src/themes/himalayan-peak/himalayan-peak-core.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/himalayan-peak/himalayan-peak-composition.js';
import { MAX_LINES } from '../../src/themes/himalayan-peak/himalayan-peak-flags.js';
import { BEAM_ROWS, PAPER_WIND, paperPoint } from '../../src/themes/himalayan-peak/himalayan-peak-fx.js';
import { linePoint } from '../../src/themes/himalayan-peak/himalayan-peak-layout.js';
import { QUALITY } from '../../src/themes/himalayan-peak/himalayan-peak-quality.js';

/** One small stand-in amphitheatre for every world in this file. */
let massif;
beforeAll(() => {
    massif = planMassif(64);
});

function makeWorld(quality = 'High', { width = 1600, height = 900 } = {}) {
    const scene = new THREE.Scene();
    const world = new HimalayanPeakWorld({
        scene, quality, capture: true, massif, eagle: false,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 60000);
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    // As the theme does before its first frame: the camera stands where events aim through it.
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    return { world, scene, camera };
}

/** A pool's per-instance array, and how often it has been flagged for upload. */
const data = (part, name) => part.geometry.getAttribute(name).array;
const uploads = (part, names) => names.map((name) => part.geometry.getAttribute(name).version);
const lengthOf = (line) => Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1], line.b[2] - line.a[2]);
/** The live flags of a line, each with its slot in the pool. */
const flagsOn = (flags, id) => flags.info.map((flag, index) => ({ ...flag, index })).filter((flag) => flag.line === id);
const PARKED = [-1000, 1e6, 0, 0];

describe('himalayan peak flags: stringing the lines', () => {
    let world;
    beforeAll(() => {
        ({ world } = makeWorld('High'));
    });
    afterAll(() => world.dispose());

    it('hangs at least the flags the lines ask for, side by side, five colours in their order', () => {
        const { flags, lines } = world;
        const wanted = lines.reduce((sum, line) => sum + line.count, 0);
        expect(flags.count).toBe(QUALITY.High.flags);
        // This tier's pool is larger than what the lines ask for: it strings them closer.
        expect(wanted).toBeLessThanOrEqual(flags.count);
        const strung = flags.string(lines);
        expect(strung).toBeGreaterThanOrEqual(wanted);
        expect(strung).toBeLessThanOrEqual(flags.count);
        expect(flags.live).toBe(strung);
        expect(flags.info).toHaveLength(strung);
        expect(flags.geometry.instanceCount).toBe(strung);
        expect(world.getState().flags).toBe(strung);
        expect(flags.string(lines)).toBe(strung);
        lines.forEach((line, id) => {
            const mine = flagsOn(flags, id);
            const length = lengthOf(line);
            expect(mine.length, line.name).toBeGreaterThanOrEqual(line.count);
            // However rich the tier, never closer than edge to edge: no flag hangs over the next.
            for (let k = 1; k < mine.length; k++) {
                expect(mine[k].along - mine[k - 1].along, line.name).toBeGreaterThanOrEqual(line.size);
            }
            mine.forEach((flag, k) => {
                // Sky, air, fire, water, earth, and round again.
                expect(flag.tint, line.name).toBe(k % 5);
                // In order along the line, clear of the knots at both ends.
                expect(flag.along, line.name).toBeGreaterThan(length * 0.06);
                expect(flag.along, line.name).toBeLessThan(length * 0.96);
                if (k > 0) expect(flag.along, line.name).toBeGreaterThan(mine[k - 1].along);
                // On the line itself.
                const p = linePoint(line, flag.along / length);
                expect(flag.x).toBeCloseTo(p[0], 9);
                expect(flag.y).toBeCloseTo(p[1], 9);
                expect(flag.z).toBeCloseTo(p[2], 9);
            });
        });
    });

    it('writes the same into the pool the GPU reads, slot for slot', () => {
        const { flags, lines } = world;
        flags.string(lines);
        const anchor = data(flags, 'aAnchor');
        const axis = data(flags, 'aAxis');
        const kind = data(flags, 'aKind');
        const held = data(flags, 'aHeld');
        const when = data(flags, 'aWhen');
        flags.info.forEach((flag, i) => {
            const o = i * 4;
            expect(anchor[o]).toBeCloseTo(flag.x, 3);
            expect(anchor[o + 1]).toBeCloseTo(flag.y, 3);
            expect(anchor[o + 2]).toBeCloseTo(flag.z, 3);
            expect(anchor[o + 3]).toBeCloseTo(flag.along, 4);
            // The cord's direction there (unit), and the flag's size.
            expect(Math.hypot(axis[o], axis[o + 1], axis[o + 2])).toBeCloseTo(1, 5);
            expect(axis[o + 3]).toBeCloseTo(lines[flag.line].size, 6);
            // (colour, phase, line, how far the wind pushes the cord there)
            expect(kind[o]).toBe(flag.tint);
            expect(kind[o + 1]).toBeGreaterThanOrEqual(0);
            expect(kind[o + 1]).toBeLessThan(1);
            expect(kind[o + 2]).toBe(flag.line);
            expect(kind[o + 3]).toBeGreaterThan(0);
            // Nothing held yet.
            expect(Array.from(held.slice(o, o + 4))).toEqual([1, 1, 1, 0]);
            expect(Array.from(when.slice(o, o + 4))).toEqual(PARKED);
        });
        // A cord's tangent follows its line from a to b.
        lines.forEach((line, id) => {
            const [first] = flagsOn(flags, id);
            const o = first.index * 4;
            const along = axis[o] * (line.b[0] - line.a[0]) + axis[o + 1] * (line.b[1] - line.a[1])
                + axis[o + 2] * (line.b[2] - line.a[2]);
            expect(along, line.name).toBeGreaterThan(0);
        });
    });

    it('never strings more than the pool holds, and still hangs something on every line', () => {
        const small = makeWorld('Minimal').world;
        const { flags, lines } = small;
        const wanted = lines.reduce((sum, line) => sum + line.count, 0);
        expect(flags.count).toBe(QUALITY.Minimal.flags);
        expect(wanted).toBeGreaterThan(flags.count);
        expect(flags.live).toBeLessThanOrEqual(flags.count);
        expect(flags.live).toBeGreaterThan(flags.count * 0.9);
        expect(flags.info).toHaveLength(flags.live);
        lines.forEach((line, id) => {
            const mine = flagsOn(flags, id);
            expect(mine.length, line.name).toBeGreaterThanOrEqual(1);
            expect(mine.length, line.name).toBeLessThan(line.count);
            mine.forEach((flag, k) => expect(flag.tint).toBe(k % 5));
            // A richer tier strings the same line (the same frame, the same anchors) no thinner.
            expect(lines[id].count).toBe(world.lines[id].count);
            expect(mine.length, line.name).toBeLessThanOrEqual(flagsOn(world.flags, id).length);
        });
        // More lines than there are flags: the pool is the limit.
        const crowd = Array.from({ length: flags.count + 30 }, (_, k) => ({
            a: [k, 340, -10], b: [k + 1, 341, -12], sag: 0.2, count: 1, size: 0.4,
        }));
        const pool = ['aAnchor', 'aAxis', 'aKind', 'aHeld', 'aWhen'];
        const before = uploads(flags, pool);
        expect(flags.string(crowd)).toBe(flags.count);
        expect(flags.live).toBe(flags.count);
        expect(flags.info).toHaveLength(flags.count);
        expect(flags.geometry.instanceCount).toBe(flags.count);
        expect(flags.geometry.getAttribute('aAnchor').count).toBe(flags.count);
        // Every attribute of the pool was flagged for upload.
        uploads(flags, pool).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        // No lines at all: nothing is drawn.
        expect(flags.string([])).toBe(0);
        expect(flags.geometry.instanceCount).toBe(0);
        expect(flags.totalHeld(5)).toBe(0);
        small.dispose();
    });

    it('lays a cord under every line, and hangs every flag on it', () => {
        const { cords, flags, lines } = world;
        flags.string(lines);
        cords.string(lines);
        const from = data(cords, 'aFrom');
        const to = data(cords, 'aTo');
        const segments = cords.geometry.instanceCount / lines.length;
        expect(Number.isInteger(segments)).toBe(true);
        expect(segments).toBeGreaterThanOrEqual(12);
        const point = (array, n) => [array[n * 4], array[n * 4 + 1], array[n * 4 + 2]];
        /** How far `p` is from the piece of cord between `a` and `b`. */
        const awayFrom = (p, a, b) => {
            const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const along = (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2];
            const k = Math.max(0, Math.min(1, along / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2])));
            return Math.hypot(p[0] - a[0] - d[0] * k, p[1] - a[1] - d[1] * k, p[2] - a[2] - d[2] * k);
        };
        lines.forEach((line, id) => {
            const base = id * segments;
            // From knot to knot, each piece starting where the last ended.
            point(from, base).forEach((v, k) => expect(v).toBeCloseTo(line.a[k], 3));
            point(to, base + segments - 1).forEach((v, k) => expect(v).toBeCloseTo(line.b[k], 3));
            for (let s = 0; s < segments; s++) {
                expect(Math.floor(to[(base + s) * 4 + 3]), line.name).toBe(id);
                if (s > 0) expect(point(from, base + s)).toEqual(point(to, base + s - 1));
                // The wind pushes the belly, never the knots.
                expect(from[(base + s) * 4 + 3]).toBeGreaterThanOrEqual(0);
            }
            expect(from[base * 4 + 3]).toBe(0);
            expect(to[(base + segments - 1) * 4 + 3] - id).toBeLessThan(1e-6);
            // Every flag of the line hangs within a centimetre of one of its pieces.
            flagsOn(flags, id).forEach((flag) => {
                let nearest = Infinity;
                for (let s = 0; s < segments; s++) {
                    const gap = awayFrom([flag.x, flag.y, flag.z], point(from, base + s), point(to, base + s));
                    nearest = Math.min(nearest, gap);
                }
                expect(nearest, line.name).toBeLessThan(0.01);
            });
        });
        // More lines than it has cords for: the first of them, and no more.
        const many = Array.from({ length: MAX_LINES + 2 }, (_, k) => ({
            a: [k, 340, -10], b: [k + 4, 342, -14], sag: 0.5, count: 3, size: 0.4,
        }));
        const before = uploads(cords, ['aFrom', 'aTo']);
        cords.string(many);
        expect(cords.geometry.instanceCount).toBe(MAX_LINES * segments);
        expect(cords.geometry.getAttribute('aFrom').count).toBe(MAX_LINES * segments);
        uploads(cords, ['aFrom', 'aTo']).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        cords.string(lines);
        expect(cords.geometry.instanceCount).toBe(lines.length * segments);
    });
});

describe('himalayan peak flags: the light a lock leaves', () => {
    let world;
    let flags;
    let low;
    let centre;
    beforeAll(() => {
        ({ world } = makeWorld('High'));
        ({ flags } = world);
    });
    beforeEach(() => {
        flags.string(world.lines);
        // The line between the spire and the pole, and the flag in the middle of it.
        low = world.lines.findIndex((line) => line.a === world.anchors.spire && line.b === world.anchors.pole);
        const mine = flagsOn(flags, low);
        centre = mine[Math.floor(mine.length / 2)];
    });
    /** The two other lines that carry the most flags. */
    const otherLines = () => world.lines.map((line, id) => id).filter((id) => id !== low)
        .sort((a, b) => flagsOn(flags, b).length - flagsOn(flags, a).length);
    afterAll(() => world.dispose());

    it('touches only the named line, within its spread, as the gust reaches each flag', () => {
        expect(low).toBeGreaterThanOrEqual(0);
        const rgb = [0.9, 0.25, 0.125];
        const spread = 3.2;
        const before = uploads(flags, ['aHeld', 'aWhen']);
        const blessed = flags.bless(low, centre.along, rgb, 3, 1, spread);
        const within = flagsOn(flags, low).filter((flag) => Math.abs(flag.along - centre.along) <= spread);
        expect(blessed).toBe(within.length);
        expect(blessed).toBeGreaterThan(2);
        expect(blessed).toBeLessThan(flagsOn(flags, low).length);
        uploads(flags, ['aHeld', 'aWhen']).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        const held = data(flags, 'aHeld');
        const when = data(flags, 'aWhen');
        flags.info.forEach((flag, i) => {
            const o = i * 4;
            const d = Math.abs(flag.along - centre.along);
            if (flag.line !== low || d > spread) {
                // Other lines, and this one beyond the spread: as they were.
                expect(Array.from(when.slice(o, o + 4))).toEqual(PARKED);
                expect(flags.heldAt(i, 3)).toBe(0);
                expect(flags.heldAt(i, 30)).toBe(0);
                return;
            }
            // The front runs out both ways at the gust's speed.
            const arrive = 3 + d / GUST_SPEED;
            expect(when[o]).toBeCloseTo(arrive, 5);
            expect(when[o + 1]).toBe(1e6);
            // Nothing before it gets there; then its share, less the farther from the middle.
            const share = 1 - (d / spread) ** 2;
            expect(flags.heldAt(i, arrive - 1e-3)).toBe(0);
            expect(flags.heldAt(i, arrive + 1e-3)).toBeCloseTo(share, 3);
            expect(when[o + 2]).toBeCloseTo(share, 5);
            // It fades to 1/e in a hold.
            expect(flags.heldAt(i, when[o] + BLESS_HOLD)).toBeCloseTo(flags.heldAt(i, when[o]) / Math.E, 9);
            expect(flags.heldAt(i, when[o] + BLESS_HOLD * 12)).toBeLessThan(1e-4);
            // In the piece's colour.
            rgb.forEach((c, k) => expect(held[o + k]).toBeCloseTo(c, 6));
        });
        // The flag it started from holds a whole lock at once.
        expect(flags.heldAt(centre.index, 3)).toBe(1);
        // What the lines hold is the sum of it.
        const sum = within.reduce((total, flag) => total + flags.heldAt(flag.index, 4), 0);
        expect(flags.totalHeld(4)).toBeCloseTo(sum, 9);
        expect(flags.totalHeld(2.9)).toBe(0);
        expect(sum).toBeGreaterThan(1);
    });

    it('scales with the amount and reaches as far as its spread', () => {
        const narrow = flags.bless(low, centre.along, [1, 1, 1], 1, 0.5, 1.5);
        expect(flags.heldAt(centre.index, 1)).toBe(0.5);
        flags.string(world.lines);
        const wide = flags.bless(low, centre.along, [1, 1, 1], 1, 1.3, 4.4);
        expect(wide).toBeGreaterThan(narrow);
        expect(flags.heldAt(centre.index, 1)).toBeCloseTo(1.3, 6);
        // A line that is not strung, and a place no flag hangs: nothing, and nothing uploaded.
        const before = uploads(flags, ['aHeld', 'aWhen']);
        expect(flags.bless(99, centre.along, [1, 0, 0], 2)).toBe(0);
        expect(flags.bless(-1, centre.along, [1, 0, 0], 2)).toBe(0);
        expect(flags.bless(low, centre.along + 500, [1, 0, 0], 2)).toBe(0);
        expect(uploads(flags, ['aHeld', 'aWhen'])).toEqual(before);
    });

    it('carries over what a flag still holds, mixes the colours by their shares, and caps the light', () => {
        const first = [1, 0, 0];
        const second = [0, 0, 1];
        flags.bless(low, centre.along, first, 1, 1);
        flags.bless(low, centre.along, second, 5, 1);
        // Four seconds on, the first lock's light has faded a little; the second adds a whole one.
        const carried = Math.exp(-4 / BLESS_HOLD);
        expect(flags.heldAt(centre.index, 5)).toBeCloseTo(carried + 1, 5);
        const held = data(flags, 'aHeld');
        const k = 1 / (carried + 1);
        expect(held[centre.index * 4]).toBeCloseTo(1 - k, 5);
        expect(held[centre.index * 4 + 1]).toBeCloseTo(0, 6);
        expect(held[centre.index * 4 + 2]).toBeCloseTo(k, 5);
        // However many pieces lock there, a flag holds only so much.
        for (let n = 0; n < 8; n++) flags.bless(low, centre.along, second, 6, 1.3);
        expect(flags.heldAt(centre.index, 6)).toBeCloseTo(BLESS_MAX, 5);
        const most = Math.max(...flags.info.map((flag, i) => flags.heldAt(i, 6.5)));
        expect(most).toBeLessThanOrEqual(BLESS_MAX);
        expect(most).toBeGreaterThan(BLESS_MAX * 0.9);
        // The colour has gone over to the later piece's.
        expect(held[centre.index * 4 + 2]).toBeGreaterThan(0.9);
        expect(held[centre.index * 4]).toBeLessThan(0.1);
    });

    it('lets go of every flag that holds something, each a moment after its neighbour', () => {
        const [over, far] = otherLines();
        expect(flagsOn(flags, far).length).toBeGreaterThan(8);
        const other = flagsOn(flags, over)[4];
        const faint = flagsOn(flags, far)[6];
        flags.bless(low, centre.along, [1, 0.5, 0.25], 1, 1);
        flags.bless(over, other.along, [0.25, 0.5, 1], 1.5, 1.3, 4.4);
        // Too little to be worth a paper.
        flags.bless(far, faint.along, [1, 1, 1], 1, 0.04);
        const from = [centre.x, centre.y, centre.z];
        const stagger = 0.012;
        const when = data(flags, 'aWhen');
        const held = data(flags, 'aHeld');
        // What each flag holds at its own moment, worked out before anything is let go.
        const expected = [];
        flags.info.forEach((flag, index) => {
            const time = 3 + Math.hypot(flag.x - from[0], flag.y - from[1], flag.z - from[2]) * stagger;
            const amount = flags.heldAt(index, time);
            if (amount >= 0.05) expected.push({ index, time, amount });
        });
        expect(expected.length).toBeGreaterThan(8);
        const before = uploads(flags, ['aHeld', 'aWhen']);
        const freed = flags.release(3, from, stagger);
        uploads(flags, ['aHeld', 'aWhen']).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        expect(freed.map((f) => f.index)).toEqual(expected.map((e) => e.index));
        freed.forEach((f, n) => {
            const flag = flags.info[f.index];
            expect(f.time).toBeCloseTo(expected[n].time, 9);
            expect(f.amount).toBeCloseTo(expected[n].amount, 9);
            expect([f.x, f.y, f.z]).toEqual([flag.x, flag.y, flag.z]);
            // Each takes the colour it held with it.
            expect(f.rgb).toEqual(Array.from(held.slice(f.index * 4, f.index * 4 + 3)));
            expect(flag.line === low || flag.line === over).toBe(true);
            // From its own moment on it holds nothing; until then it still glows.
            expect(when[f.index * 4 + 1]).toBeCloseTo(f.time, 5);
            expect(flags.heldAt(f.index, f.time + 1e-3)).toBe(0);
            expect(flags.heldAt(f.index, f.time + 60)).toBe(0);
            if (f.time > 3.002) expect(flags.heldAt(f.index, f.time - 1e-3)).toBeGreaterThan(0);
        });
        // The flag the clear starts from goes at once, the others later the farther off they hang.
        const first = freed.find((f) => f.index === centre.index);
        expect(first.time).toBe(3);
        expect(first.rgb).toEqual([1, 0.5, 0.25]);
        const distant = freed.find((f) => f.index === other.index);
        expect(distant.time).toBeGreaterThan(3.02);
        expect(distant.rgb[2]).toBeGreaterThan(distant.rgb[0]);
        // The faint ones were not worth letting go, and keep the little they have.
        const kept = flagsOn(flags, far).filter((flag) => flags.heldAt(flag.index, 20) > 0);
        expect(kept.length).toBeGreaterThan(0);
        expect(freed.some((f) => flags.info[f.index].line === far)).toBe(false);
        const last = Math.max(...freed.map((f) => f.time));
        expect(flags.totalHeld(last + 0.01)).toBeLessThan(0.05 * kept.length);
        expect(flags.totalHeld(last + 0.01)).toBeGreaterThan(0);
        // A second clear finds nothing to let go, and uploads nothing.
        const after = uploads(flags, ['aHeld', 'aWhen']);
        expect(flags.release(last + 1, from, stagger)).toEqual([]);
        expect(uploads(flags, ['aHeld', 'aWhen'])).toEqual(after);
        // A flag that has let go can be blessed again.
        const later = Math.ceil(last) + 2;
        flags.bless(low, centre.along, [0, 1, 0], later, 1);
        expect(flags.heldAt(centre.index, later)).toBe(1);
        expect(flags.heldAt(centre.index, later + 30)).toBeGreaterThan(0.2);
    });

    it('lets go of all of them in the same instant when no place is given', () => {
        flags.bless(low, centre.along, [1, 1, 0], 1, 1);
        const holding = flags.info.filter((flag, i) => flags.heldAt(i, 4) >= 0.05).length;
        const freed = flags.release(4);
        expect(freed).toHaveLength(holding);
        expect(freed.every((f) => f.time === 4)).toBe(true);
        expect(flags.totalHeld(4)).toBeLessThan(0.05);
        expect(flags.totalHeld(3.99)).toBeGreaterThan(1);
    });

    it('leaves a flag showing what it held until its own moment of the clear', () => {
        flags.bless(low, centre.along, [1, 0.5, 0.25], 1, 1);
        const held = data(flags, 'aHeld');
        const when = data(flags, 'aWhen');
        const o = centre.index * 4;
        const took = [held[o + 3], when[o]];
        // A clear at t = 25 that starts fifty metres off: this flag's turn comes 0.6 s later.
        const from = [centre.x + 50, centre.y, centre.z];
        const times = [25, 25.2, 25.4, 25.599];
        const shown = flags.info.map((flag, i) => times.map((time) => flags.heldAt(i, time)));
        const total = times.map((time) => flags.totalHeld(time));
        // (A hold after it took the light: 1/e of a lock.)
        expect(shown[centre.index][0]).toBeCloseTo(Math.exp(-1), 6);
        const freed = flags.release(25, from, 0.012);
        const mine = freed.find((f) => f.index === centre.index);
        expect(mine.time).toBeCloseTo(25.6, 9);
        expect(freed.length).toBeGreaterThan(3);
        // Until its moment comes nothing about a flag has changed, to the last bit.
        expect(times.map((time) => flags.heldAt(centre.index, time))).toEqual(shown[centre.index]);
        let compared = 0;
        freed.forEach((f) => {
            expect(f.time).toBeGreaterThan(25.4);
            times.forEach((time, n) => {
                if (time > f.time - 1e-4) return;
                expect(flags.heldAt(f.index, time), `flag ${f.index} at ${time}`).toBe(shown[f.index][n]);
                compared += 1;
            });
        });
        expect(compared).toBeGreaterThanOrEqual(freed.length * 3);
        // So the lines as a whole do not dim when the clear is called, only as it reaches them.
        expect(times.slice(0, 3).map((time) => flags.totalHeld(time))).toEqual(total.slice(0, 3));
        // What it lets go with is what it had left at that moment...
        expect(mine.amount).toBeCloseTo(Math.exp(-24.6 / BLESS_HOLD), 6);
        expect(mine.amount).toBeLessThan(shown[centre.index][2]);
        // ...and from then on it holds nothing.
        expect(flags.heldAt(centre.index, 25.601)).toBe(0);
        const last = Math.max(...freed.map((f) => f.time));
        expect(flags.totalHeld(last + 1e-3)).toBeLessThan(0.05 * flagsOn(flags, low).length);
        // The pool still carries what the flag took and when: the shader works what was left
        // out of the two times, and only the moment of release was written.
        expect(held[o + 3]).toBe(took[0]);
        expect(when[o]).toBe(took[1]);
        expect(when[o + 1]).toBeCloseTo(25.6, 5);
    });

    it('keeps a flag glowing while the next gust is still on its way to it', () => {
        flags.bless(low, centre.along, [1, 0, 0], 1, 1);
        // A neighbour some two and a half metres along the line, which a gust takes a tenth of a
        // second to reach.
        const neighbour = flagsOn(flags, low).reduce((best, flag) => {
            const off = (f) => Math.abs(Math.abs(f.along - centre.along) - 2.5);
            return off(flag) < off(best) ? flag : best;
        });
        const d = Math.abs(neighbour.along - centre.along);
        expect(d).toBeGreaterThan(2);
        expect(d).toBeLessThan(3);
        const arrive = 5 + d / GUST_SPEED;
        expect(arrive - 5).toBeGreaterThan(0.07);
        const travelling = [5.001, 5 + (arrive - 5) * 0.5, arrive - 1e-3];
        const shown = travelling.map((time) => flags.heldAt(neighbour.index, time));
        const carried = flags.heldAt(neighbour.index, arrive);
        const total = flags.totalHeld(travelling[1]);
        expect(carried).toBeGreaterThan(0.2);
        // A second piece locks at t = 5, in another colour.
        flags.bless(low, centre.along, [0, 0, 1], 5, 1);
        const when = data(flags, 'aWhen');
        // While its gust travels the flag shows what it will still hold when the gust arrives:
        // never dark, and within a hundredth of what it showed before the lock.
        travelling.forEach((time, n) => {
            const now = flags.heldAt(neighbour.index, time);
            expect(now, `at ${time}`).toBeCloseTo(carried, 6);
            expect(Math.abs(now - shown[n]), `at ${time}`).toBeLessThan(shown[n] * 0.01);
        });
        expect(when[neighbour.index * 4 + 3]).toBeCloseTo(carried, 6);
        for (let time = 5; time < arrive + 0.05; time += 0.004) {
            expect(flags.heldAt(neighbour.index, time), `at ${time}`).toBeGreaterThanOrEqual(carried - 1e-6);
        }
        // The lines as a whole never dip either: the flag it started from has its share already.
        expect(flags.totalHeld(travelling[1])).toBeGreaterThan(total);
        // Then the gust arrives, and its share is added to what was carried.
        const share = 1 - (d / 3.2) ** 2;
        expect(flags.heldAt(neighbour.index, arrive + 1e-3)).toBeCloseTo(carried + share, 3);
        // A flag that held nothing shows nothing until its first gust arrives.
        const [fresh] = otherLines();
        const far = flagsOn(flags, fresh)[3];
        flags.bless(fresh, far.along + 2.5, [0, 1, 0], 5, 1);
        expect(when[far.index * 4 + 3]).toBe(0);
        expect(flags.heldAt(far.index, 5 + 2.5 / GUST_SPEED - 1e-3)).toBe(0);
        expect(flags.heldAt(far.index, 5 + 2.5 / GUST_SPEED + 1e-3)).toBeGreaterThan(0.3);
        // A clear while a gust is on its way lets go of what the flag held before it.
        flags.string(world.lines);
        flags.bless(low, centre.along, [1, 0, 0], 1, 1);
        flags.bless(low, centre.along, [0, 0, 1], 5, 1);
        const early = flags.release(5.02).find((f) => f.index === neighbour.index);
        expect(early.amount).toBeCloseTo(carried, 6);
        expect(flags.heldAt(neighbour.index, arrive + 0.5)).toBe(0);
    });

    it('forgets everything on a reset and keeps the flags strung', () => {
        flags.bless(low, centre.along, [1, 0, 1], 1, 1.3, 4.4);
        flags.release(2, [centre.x, centre.y, centre.z]);
        flags.bless(low, centre.along + 2, [0, 1, 1], 2.5, 1);
        const { live } = flags;
        const info = flags.info.slice();
        const before = uploads(flags, ['aHeld', 'aWhen']);
        flags.reset();
        uploads(flags, ['aHeld', 'aWhen']).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        for (const time of [0, 1, 2.5, 3, 30]) expect(flags.totalHeld(time)).toBe(0);
        const held = data(flags, 'aHeld');
        const when = data(flags, 'aWhen');
        for (let i = 0; i < flags.count; i++) {
            expect(held[i * 4 + 3]).toBe(0);
            expect(Array.from(when.slice(i * 4, i * 4 + 4))).toEqual(PARKED);
        }
        expect(flags.live).toBe(live);
        expect(flags.info).toEqual(info);
        expect(flags.geometry.instanceCount).toBe(live);
        // Stringing the lines again drops what they held as well.
        flags.bless(low, centre.along, [1, 0, 1], 1, 1);
        expect(flags.totalHeld(1.5)).toBeGreaterThan(1);
        flags.string(world.lines);
        expect(flags.totalHeld(1.5)).toBe(0);
        // And the next lock's colour is its own: nothing of the old one is mixed in.
        flags.bless(low, centre.along, [0.2, 0.4, 0.6], 4, 1);
        [0.2, 0.4, 0.6].forEach((c, k) => expect(held[centre.index * 4 + k]).toBeCloseTo(c, 6));
    });
});

describe('himalayan peak papers: the pool', () => {
    let world;
    let papers;
    const ALL = ['aBirth', 'aVel', 'aTint', 'aTurn'];
    beforeAll(() => {
        ({ world } = makeWorld('Minimal'));
        ({ papers } = world);
    });
    beforeEach(() => papers.reset());
    afterAll(() => world.dispose());

    it('throws a handful: so many slots, from where it was thrown, inside its speeds, lives and sizes', () => {
        expect(papers.count).toBe(QUALITY.Minimal.papers);
        expect(papers.geometry.instanceCount).toBe(papers.count);
        const before = uploads(papers, ALL);
        const from = [1.5, 341, -5];
        const toward = [0.9, 0.55, -0.35];
        const rgb = [0.2, 0.5, 1];
        const written = papers.emit({
            from,
            toward,
            n: 40,
            rgb,
            time: 7,
            speed: [2, 6],
            cone: 0.4,
            life: [3, 5],
            size: 0.1,
            side: -1,
            glow: 1.2,
            stagger: 0.05,
            jitter: 0.12,
        });
        expect(written).toBe(40);
        uploads(papers, ALL).forEach((v, k) => expect(v).toBeGreaterThan(before[k]));
        const birth = data(papers, 'aBirth');
        const vel = data(papers, 'aVel');
        const tint = data(papers, 'aTint');
        const turn = data(papers, 'aTurn');
        const heading = [0, 0, 0];
        const unit = Math.hypot(...toward);
        for (let i = 0; i < 40; i++) {
            const o = i * 4;
            // Within the handful's own scatter of where it left, a moment apart.
            for (let k = 0; k < 3; k++) expect(Math.abs(birth[o + k] - from[k])).toBeLessThanOrEqual(0.0601);
            expect(birth[o + 3]).toBeGreaterThanOrEqual(7);
            expect(birth[o + 3]).toBeLessThanOrEqual(7.0501);
            const speed = Math.hypot(vel[o], vel[o + 1], vel[o + 2]);
            expect(speed).toBeGreaterThanOrEqual(2 - 1e-5);
            expect(speed).toBeLessThanOrEqual(6 + 1e-5);
            for (let k = 0; k < 3; k++) heading[k] += vel[o + k] / speed / 40;
            // How long it lasts.
            expect(vel[o + 3]).toBeGreaterThanOrEqual(3);
            expect(vel[o + 3]).toBeLessThanOrEqual(5);
            // The piece's hue, a little brighter or duller from paper to paper, and its size.
            const gain = tint[o] / rgb[0];
            expect(gain).toBeGreaterThanOrEqual(0.8 - 1e-5);
            expect(gain).toBeLessThanOrEqual(1.2 + 1e-5);
            expect(tint[o + 1] / rgb[1]).toBeCloseTo(gain, 5);
            expect(tint[o + 2] / rgb[2]).toBeCloseTo(gain, 5);
            expect(tint[o + 3]).toBeGreaterThanOrEqual(0.07 - 1e-6);
            expect(tint[o + 3]).toBeLessThanOrEqual(0.13 + 1e-6);
            // (seed, turns a second, which way round the viewer, how long it glows)
            expect(turn[o]).toBeGreaterThanOrEqual(0);
            expect(turn[o]).toBeLessThan(1);
            expect(turn[o + 1]).toBeGreaterThanOrEqual(0.6);
            expect(turn[o + 1]).toBeLessThanOrEqual(2.1001);
            expect(turn[o + 2]).toBe(-1);
            expect(turn[o + 3]).toBeGreaterThanOrEqual(1.2 * 0.6 - 1e-5);
            expect(turn[o + 3]).toBeLessThanOrEqual(1.2 * 1.4 + 1e-5);
        }
        // On the whole they go the way they were thrown.
        const along = (heading[0] * toward[0] + heading[1] * toward[1] + heading[2] * toward[2]) / unit;
        expect(along).toBeGreaterThan(0.7);
        // No two alike.
        expect(new Set(Array.from({ length: 40 }, (_, i) => turn[i * 4])).size).toBe(40);
        // The rest of the pool sleeps on.
        for (let i = 40; i < papers.count; i++) expect(birth[i * 4 + 3]).toBe(-100);
    });

    it('throws a jet when the cone is shut, and the five colours when none is given', () => {
        papers.emit({
            from: [0, 340, -5], toward: [3, 0, -4], n: 12, rgb: [1, 1, 1], time: 1, speed: [4, 4], cone: 0, jitter: 0,
        });
        const vel = data(papers, 'aVel');
        const birth = data(papers, 'aBirth');
        // Along the throw, lifted a little: (0.6, 0.12, −0.8), every one of them.
        const lift = Math.hypot(0.6, 0.12, 0.8);
        for (let i = 0; i < 12; i++) {
            expect(vel[i * 4]).toBeCloseTo((0.6 / lift) * 4, 5);
            expect(vel[i * 4 + 1]).toBeCloseTo((0.12 / lift) * 4, 5);
            expect(vel[i * 4 + 2]).toBeCloseTo((-0.8 / lift) * 4, 5);
            // No scatter, no stagger: all from the one point at the one moment.
            expect(Array.from(birth.slice(i * 4, i * 4 + 4))).toEqual([0, 340, -5, 1]);
        }
        papers.reset();
        papers.emit({
            from: [0, 340, -5], n: 80, rgb: null, time: 2,
        });
        const tint = data(papers, 'aTint');
        const seen = new Set();
        for (let i = 0; i < 80; i++) {
            const o = i * 4;
            const match = LUNG_TA.findIndex((c) => {
                const gain = Math.max(tint[o], tint[o + 1], tint[o + 2]) / Math.max(...c);
                return gain > 0.79 && gain < 1.21 && c.every((v, k) => Math.abs(tint[o + k] - v * gain) < 1e-5);
            });
            expect(match, `paper ${i}`).toBeGreaterThanOrEqual(0);
            seen.add(match);
        }
        expect(seen.size).toBe(5);
        // Thrown with nothing said: upward, on the downwind side.
        expect(data(papers, 'aTurn')[2]).toBe(1);
        expect(vel[1]).toBeGreaterThan(0);
    });

    it('goes round its pool as a ring and never grows', () => {
        const { count } = papers;
        const birth = data(papers, 'aBirth');
        const quiet = { from: [0, 340, -5], rgb: [1, 1, 1], stagger: 0 };
        expect(papers.emit({ ...quiet, n: count - 3, time: 1 })).toBe(count - 3);
        expect(papers.emit({ ...quiet, n: 8, time: 2 })).toBe(8);
        // The last three slots, then round to the first five.
        for (const i of [count - 3, count - 2, count - 1, 0, 1, 2, 3, 4]) expect(birth[i * 4 + 3], `slot ${i}`).toBe(2);
        for (let i = 5; i < count - 3; i++) expect(birth[i * 4 + 3]).toBe(1);
        // More than it holds: the whole pool, once.
        expect(papers.emit({ ...quiet, n: count + 40, time: 3 })).toBe(count);
        for (let i = 0; i < count; i++) expect(birth[i * 4 + 3]).toBe(3);
        expect(papers.emit({ ...quiet, n: 0, time: 4 })).toBe(0);
        expect(birth.some((v, k) => k % 4 === 3 && v === 4)).toBe(false);
        expect(papers.count).toBe(count);
        expect(papers.geometry.instanceCount).toBe(count);
        expect(papers.geometry.getAttribute('aBirth').count).toBe(count);
    });

    it('parks every slot on a reset and throws the same handful again afterwards', () => {
        const burst = {
            from: [2, 341, -6], toward: [-1, 0.5, -0.3], n: 30, rgb: null, time: 5, stagger: 0.2,
        };
        papers.emit(burst);
        const first = ALL.map((name) => Array.from(data(papers, name).slice(0, 30 * 4)));
        papers.emit({ ...burst, time: 6 });
        const before = uploads(papers, ['aBirth']);
        papers.reset();
        expect(uploads(papers, ['aBirth'])[0]).toBeGreaterThan(before[0]);
        const birth = data(papers, 'aBirth');
        for (let i = 0; i < papers.count; i++) expect(birth[i * 4 + 3]).toBe(-100);
        // From the first slot, with the first handful's own scatter: a replay throws the same papers.
        papers.emit(burst);
        expect(ALL.map((name) => Array.from(data(papers, name).slice(0, 30 * 4)))).toEqual(first);
        // The handful after it is another one.
        papers.emit(burst);
        const second = Array.from(data(papers, 'aVel').slice(30 * 4, 60 * 4));
        expect(second).not.toEqual(first[1]);
    });
});

describe('himalayan peak papers: a paper\'s flight', () => {
    const from = [1, 340, -5];
    const vel = [4, 3, -2];
    const DRAG = 2.4;

    it('starts where it was thrown and never jumps', () => {
        expect(paperPoint(from, vel, 0)).toEqual(from);
        const reach = Math.hypot(...vel) + Math.hypot(...PAPER_WIND) * (0.7 + 0.25);
        let previous = paperPoint(from, vel, 0);
        for (let tau = 0.01; tau <= 6; tau += 0.01) {
            const p = paperPoint(from, vel, tau);
            expect(p.every((v) => Number.isFinite(v))).toBe(true);
            // Never faster than its throw and the wind together.
            const moved = Math.hypot(p[0] - previous[0], p[1] - previous[1], p[2] - previous[2]);
            expect(moved).toBeLessThan(reach * 0.01 * 1.001);
            previous = p;
        }
        // In its first instant it moves as it was thrown.
        const soon = paperPoint(from, vel, 1e-4);
        vel.forEach((v, k) => expect((soon[k] - from[k]) / 1e-4).toBeCloseTo(v, 2));
    });

    it('spends its throw and is carried off on the wind, harder in a gale, round the viewer\'s side', () => {
        for (const [side, gale] of [[1, 0.25], [-1, 0.25], [1, 1.1], [-1, 0]]) {
            const a = paperPoint(from, vel, 20, side, gale);
            const b = paperPoint(from, vel, 21, side, gale);
            const drift = 0.7 + gale;
            expect(b[0] - a[0]).toBeCloseTo(PAPER_WIND[0] * side * drift, 6);
            expect(b[1] - a[1]).toBeCloseTo(PAPER_WIND[1] * drift, 6);
            expect(b[2] - a[2]).toBeCloseTo(PAPER_WIND[2] * drift, 6);
            // The throw itself took it v / drag and no farther.
            const carried = (20 - 1 / DRAG) * drift;
            expect(a[0]).toBeCloseTo(from[0] + vel[0] / DRAG + PAPER_WIND[0] * side * carried, 6);
            expect(a[1]).toBeCloseTo(from[1] + vel[1] / DRAG + PAPER_WIND[1] * carried, 6);
            expect(a[2]).toBeCloseTo(from[2] + vel[2] / DRAG + PAPER_WIND[2] * carried, 6);
        }
        // Up and away from the viewer, whichever side.
        expect(PAPER_WIND[1]).toBeGreaterThan(0);
        expect(PAPER_WIND[2]).toBeLessThan(0);
        // By default: the downwind side, in the wind at rest.
        expect(paperPoint(from, vel, 3)).toEqual(paperPoint(from, vel, 3, 1, 0.25));
        expect(paperPoint(from, vel, 3, -1)[0]).toBeLessThan(paperPoint(from, vel, 3, 1)[0]);
        expect(paperPoint(from, vel, 3, -1)[1]).toBe(paperPoint(from, vel, 3, 1)[1]);
        const out = [0, 0, 0];
        expect(paperPoint(from, vel, 2, 1, 0.25, out)).toBe(out);
        expect(out).toEqual(paperPoint(from, vel, 2));
    });
});

describe('himalayan peak row beams', () => {
    let world;
    let camera;
    beforeAll(() => {
        ({ world, camera } = makeWorld('High'));
    });
    afterAll(() => world.dispose());

    it('fires the rows it is given from the card\'s edges and parks again', () => {
        const { beams } = world;
        const { rows, frame, color } = beams.uniforms;
        // Two strips a row, one to each side.
        expect(beams.geometry.instanceCount).toBe(BEAM_ROWS * 2);
        const strips = data(beams, 'aRow');
        for (let i = 0; i < BEAM_ROWS * 2; i++) {
            expect(strips[i * 2]).toBe(Math.floor(i / 2));
            expect(strips[i * 2 + 1]).toBe(i % 2 ? 1 : -1);
        }
        // Dark until fired.
        expect(frame.value.w).toBe(0);
        expect(frame.value.z).toBe(-100);
        beams.fire([0.7, 0.66], 0.41, 0.59, [1, 0.8, 0.5], 12, 0.9);
        expect(rows.value.toArray()).toEqual([0.7, 0.66, -1, -1]);
        expect(frame.value.toArray()).toEqual([0.41, 0.59, 12, 0.9]);
        expect(color.value.toArray()).toEqual([1, 0.8, 0.5]);
        // Four rows at most; full strength unless told.
        beams.fire([0.8, 0.76, 0.72, 0.68, 0.64], 0.3, 0.7, [0.5, 0.5, 1], 13);
        expect(rows.value.toArray()).toEqual([0.8, 0.76, 0.72, 0.68]);
        expect(frame.value.toArray()).toEqual([0.3, 0.7, 13, 1]);
        beams.fire([0.5], 0.3, 0.7, [1, 1, 1], 14);
        expect(rows.value.toArray()).toEqual([0.5, -1, -1, -1]);
        beams.reset();
        expect(frame.value.w).toBe(0);
        expect(frame.value.z).toBe(-100);
    });

    it('is fired by a clear at the cleared rows\' heights, and only with a board on screen', () => {
        const { beams } = world;
        const { rows, frame, color } = beams.uniforms;
        const layout = fallbackLayout(1600, 900);
        world.setLayout(layout, 1600 / 900);
        world.update({ time: 4, delta: 0 }, camera);
        world.onClear({ rows: [19, 18], lines: 2 });
        const card = cardUnion(layout);
        const board = boardFor(layout, 0);
        expect(frame.value.x).toBeCloseTo(card.x0, 9);
        expect(frame.value.y).toBeCloseTo(card.x1, 9);
        expect(frame.value.z).toBe(4);
        expect(frame.value.w).toBeGreaterThan(0.5);
        // Row 19 is the floor row, row 18 the one above it; the other two strips stay unused.
        expect(rows.value.x).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(rows.value.y).toBeCloseTo(boardPoint(board, 0.5, 18).y, 9);
        expect(rows.value.x).toBeGreaterThan(rows.value.y);
        expect(rows.value.x).toBeLessThan(board.y1);
        expect(rows.value.z).toBe(-1);
        expect(rows.value.w).toBe(-1);
        expect(Math.max(...color.value.toArray())).toBeCloseTo(1, 6);
        // More lines hit harder.
        const two = frame.value.w;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(frame.value.w).toBeGreaterThan(two);
        expect(rows.value.w).toBeCloseTo(boardPoint(board, 0.5, 16).y, 9);
        // A new session parks them.
        world.resetSession();
        expect(frame.value.w).toBe(0);
        expect(frame.value.z).toBe(-100);
        // No board on screen (menus, the meditation mode): the wave runs, the beams stay dark.
        world.setLayout(null);
        world.onClear({ rows: [19], lines: 1 });
        expect(world.counts.clears).toBe(1);
        expect(world.u.waveA[0].value.z).toBeGreaterThan(0);
        expect(frame.value.w).toBe(0);
    });
});

describe('himalayan peak world: lines, gusts and what a session leaves behind', () => {
    const FRAMES = [[1600, 900], [430, 932]];

    it('binds no more vertex buffers on any part than a WebGPU pipeline may, at any tier', () => {
        // Every attribute is its own buffer there, and a pipeline may bind eight.
        let strung = 0;
        for (const quality of Object.keys(QUALITY)) {
            const { world } = makeWorld(quality);
            Object.keys(world.parts).forEach((name) => {
                const buffers = Object.keys(world.parts[name].geometry.attributes);
                expect(buffers.length, `${quality} ${name}: ${buffers.join(', ')}`).toBeLessThanOrEqual(8);
                expect(buffers).toContain('position');
            });
            // The pools are always drawn, whole: a dormant slot is a quad of no size.
            expect(world.papers.geometry.instanceCount).toBe(QUALITY[quality].papers);
            expect(world.beams.geometry.instanceCount).toBe(BEAM_ROWS * 2);
            // The flags are the one pool drawn only as far as it is strung: more of them the
            // richer the tier, never more than it has.
            expect(world.flags.live, quality).toBeLessThanOrEqual(QUALITY[quality].flags);
            expect(world.flags.live, quality).toBeGreaterThanOrEqual(strung);
            expect(world.flags.live, quality).toBeGreaterThan(20);
            expect(world.flags.geometry.instanceCount, quality).toBe(world.flags.live);
            strung = world.flags.live;
            world.dispose();
        }
    });

    it('strings the lines again for an upright screen and still knows where a gust can start', () => {
        const { world } = makeWorld('High');
        const wide = { flags: world.flags.live, samples: world.lineSamples.length, lines: world.lines };
        expect(wide.samples).toBeGreaterThan(0);
        world.flags.bless(0, world.flags.info[0].along, [1, 0, 0], 0, 1);
        const segments = world.cords.geometry.instanceCount / world.lines.length;
        world.setViewport(430, 932, 430 / 932);
        expect(world.aspect).toBeCloseTo(430 / 932, 9);
        expect(world.lines).not.toBe(wide.lines);
        expect(world.lines.length).toBeGreaterThanOrEqual(4);
        expect(world.flags.live).toBeGreaterThan(20);
        expect(world.flags.info).toHaveLength(world.flags.live);
        expect(world.cords.geometry.instanceCount).toBe(world.lines.length * segments);
        // Strung afresh: on the new lines, holding nothing.
        expect(world.flags.totalHeld(1)).toBe(0);
        world.flags.info.forEach((flag) => {
            const line = world.lines[flag.line];
            const p = linePoint(line, flag.along / lengthOf(line));
            expect(Math.hypot(flag.x - p[0], flag.y - p[1], flag.z - p[2])).toBeLessThan(1e-9);
        });
        // Where a gust can start: points of the lines as the rest camera sees them.
        expect(world.lineSamples.length).toBeGreaterThan(0);
        const camera = world.restCamera();
        const seen = new THREE.Vector3();
        world.lineSamples.forEach((sample) => {
            const line = world.lines[sample.line];
            expect(line).toBeTruthy();
            expect(sample.along).toBeGreaterThan(0);
            expect(sample.along).toBeLessThan(lengthOf(line));
            const p = linePoint(line, sample.along / lengthOf(line));
            seen.set(p[0], p[1], p[2]).project(camera);
            expect(sample.sx).toBeCloseTo(seen.x * 0.5 + 0.5, 9);
            expect(sample.sy).toBeCloseTo(0.5 - seen.y * 0.5, 9);
            expect(seen.z).toBeLessThanOrEqual(1); // in front of the camera
        });
        expect(world.getState()).toMatchObject({
            flags: world.flags.live, lines: world.lines.length, gustStarts: world.lineSamples.length, held: 0,
        });
        // The same shape again changes nothing; a degenerate one is ignored.
        const { lines } = world;
        world.setViewport(860, 1864, 430 / 932);
        world.setViewport(0, 0, NaN);
        expect(world.lines).toBe(lines);
        expect(world.u.viewport.value.toArray()).toEqual([860, 1864]);
        world.dispose();
    });

    it('finds the nearest point of a line on the asked side of the card, or none', () => {
        for (const [width, height] of FRAMES) {
            const { world } = makeWorld('High', { width, height });
            const frame = `${width}x${height}`;
            const card = cardUnion(world.layout);
            const eligible = (side) => world.lineSamples.filter((s) => s.sx >= -0.05 && s.sx <= 1.05 && s.sy >= -0.1
                && s.sy <= 1.05 && (side < 0 ? s.sx <= card.x0 : s.sx >= card.x1));
            for (const side of [-1, 1]) {
                const candidates = eligible(side);
                expect(candidates.length, `${frame}, side ${side}`).toBeGreaterThan(0);
                const asked = [
                    [card.x0, 0.3], [card.x1, 0.3], [0.5, 0.6], [0.05, 0.1], [0.95, 0.9], [card.x0, card.y0],
                ];
                for (const [sx, sy] of asked) {
                    const found = world.nearestLinePoint(sx, sy, side);
                    const label = `${frame}, side ${side}, from ${sx.toFixed(2)}, ${sy}`;
                    // One of the world's own samples, on the side that was asked for...
                    expect(world.lineSamples, label).toContain(found);
                    if (side < 0) expect(found.sx, label).toBeLessThan(card.x0);
                    else expect(found.sx, label).toBeGreaterThan(card.x1);
                    // ...and none of the others on that side is nearer on screen.
                    const away = (s) => Math.hypot((s.sx - sx) * world.aspect, s.sy - sy);
                    expect(Math.min(...candidates.map(away)), label).toBeCloseTo(away(found), 12);
                }
            }
            // Nothing strung on one side: no gust starts there.
            const all = world.lineSamples;
            world.lineSamples = eligible(-1);
            expect(world.nearestLinePoint(card.x1, 0.3, 1)).toBeNull();
            expect(world.nearestLinePoint(card.x0, 0.3, -1)).toBeTruthy();
            world.lineSamples = [];
            expect(world.nearestLinePoint(0.2, 0.3, -1)).toBeNull();
            world.lineSamples = all;
            world.dispose();
        }
    });

    it('starts a lock\'s gust on the piece\'s side, and only the line it runs along takes the colour', () => {
        for (const [width, height] of FRAMES) {
            const { world, camera } = makeWorld('High', { width, height });
            const frame = `${width}x${height}`;
            const card = cardUnion(world.layout);
            const board = boardFor(world.layout, 0);
            world.update({ time: 2, delta: 0 }, camera);
            const sides = [[0.1, -1, card.x0, '#e84118'], [0.9, 1, card.x1, '#00a8ff']];
            sides.forEach(([u, side, edge, colour], n) => {
                world.flags.reset();
                const start = world.nearestLinePoint(edge, boardPoint(board, u, 8).y, side);
                expect(start, frame).toBeTruthy();
                const thrown = world.counts.papers;
                world.onLock({ u, rows: [8], color: colour });
                // The gust: (line, where along it, when, how hard).
                const gust = world.u.gustA[n].value;
                expect(gust.x, frame).toBe(start.line);
                expect(gust.y, frame).toBeCloseTo(start.along, 9);
                expect(gust.z, frame).toBe(2);
                expect(gust.w, frame).toBeGreaterThan(0);
                // The flags it lit: on that line, within reach of where it started...
                const when = data(world.flags, 'aWhen');
                const held = data(world.flags, 'aHeld');
                const lit = world.flags.info.map((flag, index) => ({ ...flag, index }))
                    .filter((flag) => when[flag.index * 4] > -1000);
                expect(lit.length, frame).toBeGreaterThan(0);
                const astray = lit.filter((flag) => flag.line !== start.line || Math.abs(flag.along - start.along) > 5);
                expect(astray, frame).toHaveLength(0);
                expect(lit.length, frame).toBeLessThan(flagsOn(world.flags, start.line).length);
                expect(world.flags.totalHeld(3), frame).toBeGreaterThan(0);
                // ...in the piece's colour.
                const rgb = pieceColor(colour);
                lit.forEach((flag) => rgb.forEach((c, k) => expect(held[flag.index * 4 + k]).toBeCloseTo(c, 6)));
                // Its papers left at that moment, to go the same way round the viewer.
                expect(world.counts.papers - thrown, frame).toBeGreaterThan(5);
                for (let slot = thrown; slot < world.counts.papers; slot++) {
                    expect(data(world.papers, 'aTurn')[slot * 4 + 2], frame).toBe(side);
                    expect(data(world.papers, 'aBirth')[slot * 4 + 3], frame).toBeGreaterThanOrEqual(2);
                    expect(data(world.papers, 'aBirth')[slot * 4 + 3], frame).toBeLessThan(2.5);
                }
            });
            expect(world.counts.locks).toBe(2);
            expect(world.counts.blessed).toBeGreaterThan(0);
            // A hard drop reaches farther along the line and leaves more.
            world.flags.reset();
            world.onLock({ u: 0.1, rows: [8], color: '#e84118' });
            const soft = world.flags.totalHeld(3);
            world.flags.reset();
            world.onLock({
                u: 0.1, rows: [8], color: '#e84118', hardDrop: true,
            });
            expect(world.flags.totalHeld(3)).toBeGreaterThan(soft);
            world.dispose();
        }
    });

    it('drops everything in flight for a new session and for a seek', () => {
        const fill = (world, camera) => {
            world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
            world.update({ time: 3, delta: 0 }, camera);
            for (let n = 0; n < 5; n++) {
                world.onLock({
                    u: n % 2 ? 0.85 : 0.15, rows: [6 + n], color: '#fbc531', hardDrop: n === 4,
                });
            }
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            world.onCombo(5);
            // (At 3.2 s every gust has arrived and the clear has not yet reached a flag.)
            expect(world.flags.totalHeld(3.2)).toBeGreaterThan(0);
            expect(data(world.papers, 'aBirth').some((v, k) => k % 4 === 3 && v > -100)).toBe(true);
            expect(world.beams.uniforms.frame.value.w).toBeGreaterThan(0);
        };
        const expectEmpty = (world) => {
            for (const time of [0, 3, 3.5, 10]) expect(world.flags.totalHeld(time)).toBe(0);
            expect(data(world.papers, 'aBirth').every((v, k) => k % 4 !== 3 || v === -100)).toBe(true);
            expect(world.beams.uniforms.frame.value.w).toBe(0);
            // No ring, wave, gust or avalanche is still running.
            world.u.ringA.forEach((slot) => expect(slot.value.toArray()).toEqual([0, 0, -100, 0]));
            world.u.gustA.forEach((slot) => expect(slot.value.toArray()).toEqual([0, 0, -100, 0]));
            world.u.waveA.forEach((slot) => expect(slot.value.z).toBe(0));
            expect(world.u.avalanche.value.toArray()).toEqual([-100, 0]);
            expect(world.counts).toEqual({
                locks: 0, clears: 0, quads: 0, papers: 0, blessed: 0,
            });
            expect(world.combo).toBe(0);
            // The flags stay strung.
            expect(world.flags.live).toBeGreaterThan(20);
        };
        const session = makeWorld('Medium');
        fill(session.world, session.camera);
        session.world.resetSession();
        expectEmpty(session.world);
        expect(session.world.time).toBe(3); // the clock runs on
        const sought = makeWorld('Medium');
        fill(sought.world, sought.camera);
        sought.world.seek(1.5);
        expectEmpty(sought.world);
        expect(sought.world.time).toBe(1.5);
        // After either, the first lock throws the first handful again: the same papers.
        const replay = (world, camera) => {
            world.update({ time: 8, delta: 0 }, camera);
            world.onLock({ u: 0.3, rows: [10], color: '#9c88ff' });
            const thrown = world.counts.papers;
            expect(thrown).toBeGreaterThan(5);
            return ['aBirth', 'aVel', 'aTint', 'aTurn']
                .map((name) => Array.from(data(world.papers, name).slice(0, thrown * 4)));
        };
        expect(replay(session.world, session.camera)).toEqual(replay(sought.world, sought.camera));
        session.world.dispose();
        sought.world.dispose();
    });
});

describe('himalayan peak world: the frame, the session and what arrives late', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** One frame as the theme runs it: the camera, then the world. */
    const frame = (world, camera, time, delta = 1 / 60) => {
        world.updateCamera(camera, { time, delta });
        world.update({ time, delta }, camera);
    };
    const advance = (world, camera, from, to, delta = 1 / 60) => {
        for (let time = from + delta; time <= to + 1e-9; time += delta) frame(world, camera, time, delta);
    };

    it('stamps an event with the frame it is fired in', () => {
        const { world, camera } = makeWorld('High');
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        advance(world, camera, 0, 5);
        // The theme's frame: the camera first, then the gameplay staged since the last frame,
        // then the world. What is staged belongs to this frame, not to the one before it.
        const sim = { time: 5.25, delta: 0.05 };
        world.updateCamera(camera, sim);
        expect(world.time).toBe(5.25);
        world.onLock({ u: 0.2, rows: [10], color: '#e84118' });
        world.onClear({ rows: [19, 18], lines: 2 });
        // The ring on the snow, the lock's gust and the clear's, the wave and the row beams.
        expect(world.u.ringA[0].value.z).toBe(5.25);
        expect(world.u.gustA[0].value.z).toBe(5.25);
        expect(world.u.gustA[1].value.z).toBe(5.25);
        expect(world.u.waveA[0].value.x).toBe(5.25);
        expect(world.beams.uniforms.frame.value.z).toBe(5.25);
        // The papers leave from now on; none was thrown a frame ago.
        const births = data(world.papers, 'aBirth');
        expect(world.counts.papers).toBeGreaterThan(10);
        for (let slot = 0; slot < world.counts.papers; slot++) {
            expect(births[slot * 4 + 3]).toBeGreaterThanOrEqual(5.25);
            expect(births[slot * 4 + 3]).toBeLessThan(5.75);
        }
        // The flags take the light from now on, too.
        const when = data(world.flags, 'aWhen');
        const lit = world.flags.info.map((flag, i) => when[i * 4]).filter((arrive) => arrive > -1000);
        expect(lit.length).toBeGreaterThan(0);
        expect(Math.min(...lit)).toBeGreaterThanOrEqual(5.25);
        world.update(sim, camera);
        // On the frame it is first drawn in, nothing is already a frame old.
        expect(world.u.time.value).toBe(5.25);
        expect(world.u.time.value - world.u.ringA[0].value.z).toBe(0);
        expect(world.getState().time).toBe(5.25);
        world.dispose();
    });

    it('lets nothing jump when a new session begins: the wind, the halo and the spark fade on', () => {
        const { world, camera } = makeWorld('High');
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        advance(world, camera, 0, 1);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        advance(world, camera, 1, 1.8);
        world.onLock({
            u: 0.3, rows: [12], color: '#00a8ff', hardDrop: true,
        });
        advance(world, camera, 1.8, 1.9);
        const kept = ['storm', 'halo', 'spark', 'windRun', 'power', 'surge', 'swell', 'elevation', 'breath'];
        const before = Object.fromEntries(kept.map((key) => [key, world[key]]));
        // A storm is blowing, the halo is up, the spire is lit, the sun is over the wall.
        expect(before.storm).toBeGreaterThan(0.5);
        expect(before.halo).toBeGreaterThan(0.2);
        expect(before.spark).toBeGreaterThan(0.3);
        expect(before.surge).toBeGreaterThan(0.5);
        const gale = world.u.gale.value;
        const halo = world.u.halo.value;
        world.resetSession();
        kept.forEach((key) => expect(world[key], key).toBe(before[key]));
        // The run itself is forgotten.
        expect(world.combo).toBe(0);
        expect(world.level).toBe(1);
        expect(world.counts).toEqual({
            locks: 0, clears: 0, quads: 0, papers: 0, blessed: 0,
        });
        // On the next frame the wind blows as hard as on the last (no plume changes length at
        // a stroke) and the ring round the sun is still there.
        frame(world, camera, 1.9 + 1 / 60);
        expect(world.u.gale.value).toBeLessThanOrEqual(gale);
        expect(world.u.gale.value).toBeGreaterThan(gale * 0.97);
        expect(world.u.halo.value).toBeGreaterThan(halo * 0.9);
        expect(world.u.spark.value.w).toBeGreaterThan(before.spark * 0.9);
        // And it all sinks back on its own.
        advance(world, camera, 1.9 + 1 / 60, 40);
        expect(world.storm).toBeLessThan(0.01);
        expect(world.halo).toBeLessThan(0.01);
        expect(world.surge).toBeLessThan(0.01);
        expect(world.getState().elevation).toBeLessThan(world.getState().sunClears);
        world.dispose();
    });

    it('does not lose a four-line clear\'s lift to a clear that follows inside its hush', () => {
        const run = (second) => {
            const { world, camera } = makeWorld('High');
            advance(world, camera, 0, 1);
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            // The mountain holds its breath: nothing has risen yet.
            expect(world.swell).toBe(0);
            expect(world.surge).toBe(0);
            advance(world, camera, 1, 1.05);
            expect(world.swell).toBe(0);
            if (second) world.onClear({ rows: [19], lines: 1, player: 2 });
            const at = { swell: world.swell, surge: world.surge };
            advance(world, camera, 1.05, 2.6);
            const state = world.getState();
            world.dispose();
            return { at, state };
        };
        const alone = run(false);
        const followed = run(true);
        // Another board's single line arrives a twentieth of a second into the hush. The four
        // lines' lift and overdrive are handed over at once instead of being overwritten.
        expect(followed.at.swell).toBeCloseTo(SUN_ELEVATION.clear[4], 12);
        expect(followed.at.surge).toBeGreaterThanOrEqual(1);
        expect(alone.at).toEqual({ swell: 0, surge: 0 });
        // A second and a half on the sun stands clear of the wall either way, as high as it would
        // have stood after the four lines alone (to a degree or two).
        expect(alone.state.elevation).toBeGreaterThan(alone.state.sunClears);
        expect(followed.state.elevation).toBeGreaterThan(followed.state.sunClears);
        expect(Math.abs(followed.state.elevation - alone.state.elevation)).toBeLessThan(2);
        expect(followed.state.surge).toBeGreaterThan(0.4);
        expect(followed.state.counts).toMatchObject({ clears: 2, quads: 1 });
        // A single line on its own never brings the sun over the wall.
        const { world, camera } = makeWorld('High');
        advance(world, camera, 0, 1.05);
        world.onClear({ rows: [19], lines: 1 });
        advance(world, camera, 1.05, 2.6);
        expect(world.getState().elevation).toBeLessThan(world.getState().sunClears);
        expect(world.surge).toBe(0);
        world.dispose();
    });

    it('cuts the massif\'s mesh while it loads, and keeps nothing if it is gone by then', async () => {
        const world = new HimalayanPeakWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, massif, eagle: false,
        });
        expect(world.field).toBeNull();
        await expect(world.load()).resolves.toEqual({ source: 'plan' });
        // The field, and the mesh for this tier's stride, are there before anything is built.
        expect(world.field.mesh.stride).toBe(QUALITY.Low.stride);
        const { positions, indices, kept } = world.field.mesh;
        expect(kept).toBeGreaterThan(0);
        world.build();
        const { geometry } = world.parts.massif;
        expect(geometry.getAttribute('position').array).toBe(positions);
        expect(geometry.index.array).toBe(indices);
        expect(world.getState()).toMatchObject({
            source: 'plan', massifCells: kept, massifVertices: positions.length / 3,
        });
        world.dispose();
        // Stopped while the massif was on its way: load() still resolves, and leaves no field.
        const late = new HimalayanPeakWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, massif, eagle: false,
        });
        const pending = late.load();
        late.dispose();
        await expect(pending).resolves.toEqual({ source: 'plan' });
        expect(late.field).toBeNull();
        // A world built without load() cuts its own mesh, the same one.
        const direct = makeWorld('Low').world;
        expect(direct.field.mesh).toBeUndefined();
        expect(direct.getState().massifCells).toBe(kept);
        direct.dispose();
    });

    it('never lands a lock behind the eye, whatever the camera it is handed', () => {
        const world = new HimalayanPeakWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, massif, eagle: false,
        }).build();
        // A camera that has been bound but never posed: at the origin, far under the pass.
        const bare = new THREE.PerspectiveCamera(50, 16 / 9, 1, 60000);
        world.bindCamera(bare);
        world.setViewport(1600, 900, 16 / 9);
        for (const [sx, sy] of [[0.5, 0.95], [0.2, 0.92], [0.8, 0.99], [0.5, 0.1]]) {
            const strike = world.screenToSnow(sx, sy);
            const away = Math.hypot(strike.x - bare.position.x, strike.z - bare.position.z);
            // Ahead of it, within the reach: under the horizon, at the reach itself.
            expect(strike.z, `${sx}, ${sy}`).toBeLessThan(bare.position.z);
            expect(away, `${sx}, ${sy}`).toBeLessThanOrEqual(13 + 1e-9);
            if (sy > 0.9) expect(away, `${sx}, ${sy}`).toBeCloseTo(13, 6);
        }
        world.onLock({ u: 0.3, rows: [12], color: '#e84118' });
        expect(world.u.ringA[0].value.y).toBeLessThan(0);
        expect(Math.hypot(world.u.ringA[0].value.x, world.u.ringA[0].value.y)).toBeLessThan(13.001);
        // Posed, it finds the snow under the foot of the board, a few metres ahead...
        world.updateCamera(bare, { time: 0, delta: 0 });
        const foot = world.screenToSnow(0.5, 0.95);
        expect(foot.z).toBeLessThan(-3);
        expect(foot.z).toBeGreaterThan(-13);
        expect(Math.abs(foot.x - bare.position.x)).toBeLessThan(1);
        expect(world.screenToSnow(0.2, 0.95).x).toBeLessThan(foot.x);
        // ...and for a point in the sky, the reach along that ray instead: still ahead.
        const sky = world.screenToSnow(0.5, 0.1);
        const reach = Math.hypot(sky.x - bare.position.x, sky.z - bare.position.z);
        expect(reach).toBeGreaterThan(8);
        expect(reach).toBeLessThanOrEqual(13);
        expect(sky.z).toBeLessThan(foot.z);
        // A shorter reach is kept to.
        const near = world.screenToSnow(0.5, 0.6, 4);
        expect(Math.hypot(near.x - bare.position.x, near.z - bare.position.z)).toBeLessThanOrEqual(4 + 1e-9);
        world.dispose();
    });

    it('takes the eagle in when it arrives, hidden if it was not among the parts asked for', async () => {
        // A stand-in for the model: createEagle() takes any scene with a mesh in it.
        const model = () => {
            const bird = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 2), new THREE.MeshBasicMaterial());
            return { scene: new THREE.Group().add(bird), animations: [] };
        };
        const arrivals = [];
        vi.stubGlobal('document', {});
        const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise((resolve) => {
            arrivals.push(resolve);
        }));
        const build = () => new HimalayanPeakWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, massif,
        }).build();

        // Nothing waits for it: the world is built and running without.
        const world = build();
        expect(load).toHaveBeenCalledTimes(1);
        expect(world.parts.eagle).toBeUndefined();
        expect(world.getState().eagle).toBe(false);
        // A capture bisecting a look asks for two parts only, before the bird is there.
        world.showOnlyParts(['sky', 'massif']);
        arrivals[0](model());
        await expect(world.eagleReady).resolves.toBe(true);
        expect(world.getState().eagle).toBe(true);
        expect(world.root.children).toContain(world.parts.eagle.mesh);
        expect(world.parts.eagle.mesh.visible).toBe(false);
        expect(world.parts.sky.mesh.visible).toBe(true);
        expect(world.parts.pass.mesh.visible).toBe(false);
        world.showOnlyParts(['eagle']);
        expect(world.parts.eagle.mesh.visible).toBe(true);
        expect(world.parts.sky.mesh.visible).toBe(false);
        world.dispose();
        expect(world.eagle).toBeNull();

        // No part list: it is simply there, on its round.
        const open = build();
        arrivals[1](model());
        await expect(open.eagleReady).resolves.toBe(true);
        expect(open.parts.eagle.mesh.visible).toBe(true);
        expect(open.parts.eagle.mesh.position.y).toBeGreaterThan(300);
        open.dispose();

        // A model that arrives after the world has gone is not taken in.
        const gone = build();
        gone.dispose();
        arrivals[2](model());
        await expect(gone.eagleReady).resolves.toBe(false);
        expect(gone.eagle).toBeNull();
        expect(gone.parts).toEqual({});

        // A model that never arrives: the mountain does without, and says so once.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        load.mockImplementation(async () => {
            throw new Error('offline');
        });
        const without = build();
        await expect(without.eagleReady).resolves.toBe(false);
        expect(without.getState().eagle).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        without.dispose();

        // A world told not to fetch it never asks.
        const calls = load.mock.calls.length;
        const { world: quiet } = makeWorld('Low');
        await expect(quiet.eagleReady).resolves.toBe(false);
        expect(load.mock.calls.length).toBe(calls);
        quiet.dispose();
    });
});
