/**
 * Rainbow Terraces — the paper birds (rainbow-terraces-gliders.js).
 *
 * A bird of folded paper whose wing hinges at the shoulder and whose hand hinges at the wrist:
 * the CPU twin of the vertex stage's wingbeat keeps every fold joined at any beat, the bird is its
 * own mirror, reads as a bird (span about twice its length, a head ahead and a tail behind), and
 * the instance buffer carries each bird's wings and presence.
 */
import { describe, expect, it } from 'vitest';
import {
    BIRD_HINGE, BIRD_PART, GLIDER_STRIDE, beatPoint, birdFacets, buildGliderGeometry, createGliders,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-gliders.js';
import { WING } from '../../src/themes/rainbow-terraces/rainbow-terraces-flock.js';

const key = (p) => p.map((v) => v.toFixed(6)).join(',');

describe('rainbow terraces paper birds', () => {
    it('folds 30 facets: a body, and on each side a wing and a hand', () => {
        const facets = birdFacets();
        expect(facets).toHaveLength(30);
        const count = (part) => facets.filter((f) => f.part === part).length;
        expect(count(BIRD_PART.body)).toBe(16);
        expect(count(BIRD_PART.wing)).toBe(8);
        expect(count(BIRD_PART.hand)).toBe(6);
        // Its own mirror: every point has its twin across the body's plane.
        const points = new Set(facets.flatMap((f) => f.points.map(key)));
        for (const f of facets) for (const p of f.points) expect(points.has(key([-p[0], p[1], p[2]]))).toBe(true);
        // A wing's facets lie between the shoulder and the wrist, a hand's beyond the wrist.
        for (const f of facets) {
            for (const p of f.points) {
                const ax = Math.abs(p[0]);
                if (f.part === BIRD_PART.wing) {
                    expect(ax).toBeGreaterThanOrEqual(BIRD_HINGE.shoulder - 1e-9);
                    expect(ax).toBeLessThanOrEqual(BIRD_HINGE.wrist + 1e-9);
                }
                if (f.part === BIRD_PART.hand) expect(ax).toBeGreaterThanOrEqual(BIRD_HINGE.wrist - 1e-9);
            }
        }
    });

    it('reads as a bird: span 1 tip to tip, about twice its length, the head ahead and the tail behind', () => {
        const points = birdFacets().flatMap((f) => f.points);
        const xs = points.map((p) => p[0]);
        const zs = points.map((p) => p[2]);
        expect(Math.max(...xs)).toBeCloseTo(0.5, 9);
        expect(Math.min(...xs)).toBeCloseTo(-0.5, 9);
        const length = Math.max(...zs) - Math.min(...zs);
        expect(length).toBeGreaterThan(0.45);
        expect(length).toBeLessThan(0.65);
        expect(Math.max(...zs)).toBeGreaterThan(0.2); // the head
        expect(Math.min(...zs)).toBeLessThan(-0.25); // the tail
    });

    it('keeps every fold joined at any wingbeat (the hinges run along the creases)', () => {
        const facets = birdFacets();
        const beats = [[WING.dihedral, 0], [0.74, 0.5], [-0.5, -0.4], [WING.tuckShoulder, WING.tuckWrist], [1.3, -1.6]];
        for (const [shoulder, wrist] of beats) {
            const at = new Map();
            for (const f of facets) {
                for (const p of f.points) {
                    const q = key(beatPoint(p, f.part, shoulder, wrist));
                    const k = key(p);
                    if (at.has(k)) expect(at.get(k), `point ${k} at ${shoulder}, ${wrist}`).toBe(q);
                    else at.set(k, q);
                }
            }
        }
    });

    it('beats its tips up and down, and folds them in for the dive', () => {
        const tip = [0.5, 0, -0.13];
        const at = (s, w) => beatPoint(tip, BIRD_PART.hand, s, w);
        expect(at(0.6, 0.3)[1]).toBeGreaterThan(0.25);
        expect(at(-0.5, -0.4)[1]).toBeLessThan(-0.25);
        // The tuck draws the tips in toward the body: a narrow dart.
        expect(Math.abs(at(WING.tuckShoulder, WING.tuckWrist)[0])).toBeLessThan(0.35);
        // The body never moves.
        expect(beatPoint([0, 0.03, 0.27], BIRD_PART.body, 1, 1)).toEqual([0, 0.03, 0.27]);
    });

    it('builds the geometry with each vertex\'s part, and writes wings and presence per bird', () => {
        const g = buildGliderGeometry();
        expect(g.getAttribute('position').count).toBe(90);
        const seg = g.getAttribute('aSeg');
        expect(seg.count).toBe(90);
        const facets = birdFacets();
        facets.forEach((f, i) => expect(seg.getX(i * 3)).toBe(f.part));
        const n = g.getAttribute('normal');
        for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
        g.dispose();

        const U = { pixelAngle: { value: 0.001 } };
        const birds = createGliders({ capacity: 3, U });
        const pose = {
            pos: [1, 2, 3],
            vel: [0, 0, -1],
            bank: 0.2,
            colour: [1, 0.5, 0.25],
            glow: 0.4,
            scale: 1.1,
            wings: [0.5, -0.3],
            presence: 0.75,
        };
        birds.write([pose, pose, null]);
        const d = birds.data;
        expect(d).toHaveLength(3 * GLIDER_STRIDE);
        expect(Array.from(d.slice(12, 16))).toEqual([0.5, Math.fround(-0.3), 0.75, 0]);
        expect(d[2 * GLIDER_STRIDE + 3]).toBe(0);
        birds.dispose();
    });
});
