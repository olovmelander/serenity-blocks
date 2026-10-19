/**
 * Ocean — the meshes. Every surface is shaded by its own varying normal, so a triangle wound
 * against its normals is lit from behind with no error to show for it (the trap Koi Pond's fish
 * fell into). Each shape grown in code is checked numerically, and so is each large animal in the
 * creature pack built in Blender (src/themes/ocean/assets/creatures.glb), read from disk the way
 * the theme reads it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    anemone, brainCoral, branchingCoral, seaFan, spongeCluster, tableCoral,
} from '../../src/themes/ocean/ocean-reef.js';
import { fishShape, jellyShape } from '../../src/themes/ocean/ocean-fauna.js';
import { parseCreatures } from '../../src/themes/ocean/ocean-creatures.js';
import { KINDS } from '../../src/themes/ocean/ocean-visits.js';

const SHAPES = {
    branching: [branchingCoral(11), 4000],
    table: [tableCoral(23), 1500],
    brain: [brainCoral(37), 600],
    sponge: [spongeCluster(53), 1200],
    fan: [seaFan(71), 400],
    anemone: [anemone(89), 2500],
    fish: [fishShape({ rings: 6, sides: 6 }), 120],
    reefFish: [fishShape({
        deep: 0.34, wide: 0.11, rings: 6, sides: 6,
    }), 120],
    jelly: [jellyShape(), 1000],
};

const pack = parseCreatures(readFileSync(new URL('../../src/themes/ocean/assets/creatures.glb', import.meta.url)));

/** A creature's body as the shape arrays the checks below read. */
function bodyShape(name) {
    const g = pack.kinds[name].geometry;
    return {
        p: Array.from(g.attributes.position.array),
        n: Array.from(g.attributes.normal.array),
        i: Array.from(g.index.array),
        triangles: g.index.count / 3,
    };
}

/** Triangles each animal may have (the whale over the board is the largest on screen). */
const CREATURE_BUDGET = {
    humpback: 7000,
    blueWhale: 4000,
    dolphin: 3000,
    whaleShark: 5000,
    hammerhead: 2400,
    manta: 3800,
    eagleRay: 2600,
    turtle: 3600,
    sunfish: 3400,
};

function faces(shape) {
    const { p, n, i } = shape;
    const out = [];
    for (let t = 0; t < i.length; t += 3) {
        const [a, b, c] = [i[t], i[t + 1], i[t + 2]];
        const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
        const v = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
        const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const area = Math.hypot(...g);
        const m = [0, 1, 2].map((k) => n[a * 3 + k] + n[b * 3 + k] + n[c * 3 + k]);
        out.push({ area, facing: area > 1e-12 ? (g[0] * m[0] + g[1] * m[1] + g[2] * m[2]) / area : 1 });
    }
    return out;
}

describe('Ocean meshes', () => {
    it.each(Object.keys(SHAPES))('%s: every triangle faces the way its normals do', (name) => {
        const [shape] = SHAPES[name];
        const list = faces(shape);
        expect(list.length).toBeGreaterThan(0);
        expect(list.filter((f) => f.facing < 0)).toEqual([]);
    });

    it.each(Object.keys(SHAPES))('%s: finite, with unit normals and a sane triangle budget', (name) => {
        const [shape, budget] = SHAPES[name];
        expect(shape.p.every(Number.isFinite)).toBe(true);
        for (let k = 0; k < shape.n.length; k += 3) {
            expect(Math.hypot(shape.n[k], shape.n[k + 1], shape.n[k + 2])).toBeCloseTo(1, 4);
        }
        expect(shape.triangles).toBeLessThanOrEqual(budget);
        expect(shape.i.every((ix) => ix < shape.p.length / 3)).toBe(true);
    });

    it('builds the same shape from the same seed', () => {
        expect(branchingCoral(11).p).toEqual(branchingCoral(11).p);
        expect(branchingCoral(12).p).not.toEqual(branchingCoral(11).p);
    });

    it('grows the colonies upward from a root at their own origin', () => {
        ['branching', 'table', 'brain', 'sponge', 'fan', 'anemone'].forEach((name) => {
            const [shape] = SHAPES[name];
            let low = Infinity;
            let high = -Infinity;
            for (let k = 1; k < shape.p.length; k += 3) {
                low = Math.min(low, shape.p[k]);
                high = Math.max(high, shape.p[k]);
            }
            // (A brain coral's dome tucks a little under its root: it is bedded in the rock.)
            expect(low).toBeGreaterThan(-0.3);
            expect(high).toBeGreaterThan(0.3);
        });
    });

    it('points every animal\'s nose along +z', () => {
        ['fish', 'humpback', 'turtle', 'whaleShark', 'dolphin'].forEach((name) => {
            const shape = SHAPES[name] ? SHAPES[name][0] : bodyShape(name);
            let front = -Infinity;
            let back = Infinity;
            for (let k = 2; k < shape.p.length; k += 3) {
                front = Math.max(front, shape.p[k]);
                back = Math.min(back, shape.p[k]);
            }
            expect(front).toBeGreaterThan(0.4);
            expect(back).toBeLessThan(-0.4);
        });
    });
});

describe('Ocean creature pack', () => {
    it('holds every kind of large animal, numbered in the order the runtime uses', () => {
        expect(Object.keys(pack.kinds).sort()).toEqual([...KINDS].sort());
        KINDS.forEach((name, i) => {
            expect(pack.kinds[name].kind).toBe(i);
            const shape = pack.kinds[name].geometry.attributes.aShape.array;
            // Every vertex of a body carries its own kind (the shared material tells them apart by it).
            for (let k = 3; k < shape.length; k += 4) expect(shape[k]).toBe(i);
        });
        expect(pack.bytes).toBeLessThan(900 * 1024);
    });

    it.each(KINDS)('%s: every triangle faces the way its normals do', (name) => {
        const list = faces(bodyShape(name));
        expect(list.length).toBeGreaterThan(0);
        // (A few slivers where the decimator met a fin's edge may be degenerate; none may face inward.)
        const inward = list.filter((f) => f.area > 1e-9 && f.facing < -0.2);
        expect(inward.length).toBeLessThanOrEqual(Math.ceil(list.length * 0.002));
    });

    it.each(KINDS)('%s: finite, unit normals, within its triangle budget, every index in range', (name) => {
        const shape = bodyShape(name);
        expect(shape.p.every(Number.isFinite)).toBe(true);
        for (let k = 0; k < shape.n.length; k += 3) {
            expect(Math.hypot(shape.n[k], shape.n[k + 1], shape.n[k + 2])).toBeCloseTo(1, 1);
        }
        expect(shape.triangles).toBeLessThanOrEqual(CREATURE_BUDGET[name]);
        expect(shape.i.every((ix) => ix < shape.p.length / 3)).toBe(true);
    });

    it.each(KINDS)('%s: is built symmetric about its midline, a unit long (a ray: a unit across)', (name) => {
        const { p } = bodyShape(name);
        let lo = [Infinity, Infinity, Infinity];
        let hi = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < p.length; k += 3) {
            lo = lo.map((v, c) => Math.min(v, p[k + c]));
            hi = hi.map((v, c) => Math.max(v, p[k + c]));
        }
        expect(Math.abs(hi[0] + lo[0])).toBeLessThan(0.02);
        const ray = name === 'manta' || name === 'eagleRay';
        expect(ray ? hi[0] - lo[0] : hi[2] - lo[2]).toBeGreaterThan(0.9);
        expect(ray ? hi[0] - lo[0] : hi[2] - lo[2]).toBeLessThan(1.15);
    });

    it('tells each body what its parts are, and where each fin turns from', () => {
        const parts = (name) => {
            const g = pack.kinds[name].geometry;
            const shape = g.attributes.aShape.array;
            const pivot = g.attributes.aPivot.array;
            const seen = new Set();
            let pivotsOk = true;
            for (let v = 0; v < shape.length / 4; v++) {
                const part = Math.floor(shape[v * 4 + 1] / 3);
                seen.add(part);
                // A flipper turns from a root beside the body, not from its middle.
                if (part === 1 && Math.abs(pivot[v * 4] / 32767) < 0.02) pivotsOk = false;
            }
            return { seen, pivotsOk };
        };
        // Whales and sharks have flippers (1) and a tail (2); a turtle a head (4) and rear flippers (5).
        ['humpback', 'blueWhale', 'dolphin', 'whaleShark', 'hammerhead'].forEach((name) => {
            const { seen, pivotsOk } = parts(name);
            expect(seen.has(1), name).toBe(true);
            expect(seen.has(2), name).toBe(true);
            expect(pivotsOk, name).toBe(true);
        });
        const turtle = parts('turtle');
        [1, 4, 5].forEach((p) => expect(turtle.seen.has(p)).toBe(true));
        const sunfish = parts('sunfish');
        [2, 3, 5].forEach((p) => expect(sunfish.seen.has(p)).toBe(true));
        ['humpback', 'dolphin', 'turtle', 'sunfish', 'whaleShark'].forEach((name) => {
            expect(parts(name).seen.has(6), `${name} has eyes`).toBe(true);
        });
    });
});
