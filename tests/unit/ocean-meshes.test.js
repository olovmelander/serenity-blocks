/**
 * Ocean — the meshes grown in code. Every surface is shaded by its own varying normal, so a
 * triangle wound against its normals is lit from behind with no error to show for it (the trap
 * Koi Pond's fish fell into). Each shape is checked numerically.
 */
import { describe, expect, it } from 'vitest';
import {
    anemone, brainCoral, branchingCoral, seaFan, spongeCluster, tableCoral,
} from '../../src/themes/ocean/ocean-reef.js';
import { fishShape, jellyShape } from '../../src/themes/ocean/ocean-fauna.js';
import { mantaShape, turtleShape, whaleShape } from '../../src/themes/ocean/ocean-giants.js';

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
    whale: [whaleShape(), 1200],
    manta: [mantaShape(), 600],
    turtle: [turtleShape(), 800],
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
        ['fish', 'whale', 'turtle'].forEach((name) => {
            const [shape] = SHAPES[name];
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
