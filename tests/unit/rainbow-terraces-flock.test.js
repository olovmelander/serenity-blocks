/**
 * Rainbow Terraces — the children's flight in closed form (rainbow-terraces-flock.js, three-free).
 *
 * The flock is a function of the flight clock and the event times: sampling is deterministic and
 * keeps no hidden state, a child painting a stroke flies the bow's own circle at PAINT_DISTANCE (so
 * its screen position lies on the bow, just inside the primary), the T-spin helix and the level-up
 * launch play in their windows, and an aloft share below one parks the rest out of sight.
 */
import { describe, expect, it } from 'vitest';
import { GliderFlock, PAINT_DISTANCE } from '../../src/themes/rainbow-terraces/rainbow-terraces-flock.js';
import { frameFor, nominalLayout } from '../../src/themes/rainbow-terraces/rainbow-terraces-frame.js';
import { placePlan } from '../../src/themes/rainbow-terraces/rainbow-terraces-plan.js';

const DEG = Math.PI / 180;
const CAPACITY = 20;
const frame = frameFor(16 / 9, nominalLayout(16 / 9), {});
const placement = placePlan(frame, {});
const LINKS = Array.from({ length: 12 }, (_, i) => [0.1 + i * 0.07, 0.9 - i * 0.05, 0.4]);

function bowAt(dial) {
    return {
        A: frame.A,
        basis: frame.basis,
        R1: frame.R1,
        R2: frame.R2,
        strokes: [...frame.strokes1, ...frame.strokes2],
        dial,
        links: LINKS,
    };
}

function flock(seed = 33) {
    const f = new GliderFlock(CAPACITY, seed);
    f.setThermals(placement.thermals);
    return f;
}

/** A deep copy of the poses (the flock reuses its pose objects). */
/** Horizontal distance between two points. */
const across = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const snapshot = (poses) => poses.map((p) => JSON.parse(JSON.stringify(p)));
const angleBetween = (a, b) => {
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, c)));
};

describe('rainbow terraces flock', () => {
    it('samples a pure function of the flight clock: twins agree, and asking out of order changes nothing', () => {
        const a = flock();
        const b = flock();
        const times = [0, 3.7, 12.5, 60, 333.3];
        const first = times.map((t) => snapshot(a.sample(t, bowAt(4.5), 1)));
        expect(times.map((t) => snapshot(b.sample(t, bowAt(4.5), 1)))).toEqual(first);
        expect([...times].reverse().map((t) => snapshot(a.sample(t, bowAt(4.5), 1))).reverse()).toEqual(first);
        // It moves with the clock.
        expect(first[1]).not.toEqual(first[2]);
        // A different seed is a different flock.
        expect(snapshot(flock(7).sample(12.5, bowAt(4.5), 1))).not.toEqual(first[2]);
        // The same pose objects come back every time (nothing allocated per frame for the poses).
        expect(a.sample(1, bowAt(0), 1)).toBe(a.poses);
        expect(a.poses).toHaveLength(CAPACITY);
    });

    it('circles the thermals at rest, banked into the turn, white and trail-less', () => {
        const f = flock();
        const poses = f.sample(20, bowAt(0), 1);
        poses.forEach((p, i) => {
            expect(p.mode, `glider ${i}`).toBe(0);
            expect(p.scale, `glider ${i}`).toBeGreaterThan(0);
            expect(p.trail, `glider ${i}`).toBe(0);
            expect(p.colour, `glider ${i}`).toEqual([1, 1, 1]);
            const near = Math.min(...placement.thermals.map((t) => across(p.pos, t.pos)));
            expect(near, `glider ${i}`).toBeLessThanOrEqual(30 * 1.3 + 1e-6);
            expect(Math.abs(p.bank), `glider ${i}`).toBeGreaterThan(0);
        });
    });

    it('flies a painting child on the bow\'s circle at PAINT_DISTANCE, just inside the primary, in its colour', () => {
        const f = flock();
        for (const dial of [0.5, 2.5, 6.25, 7.5, 11.4]) {
            const poses = f.sample(9, bowAt(dial), 1);
            const painting = poses.filter((p) => p.mode === 1);
            // One child for the stroke being painted (a whole number of strokes: none in flight).
            expect(painting, `dial ${dial}`).toHaveLength(1);
            const p = painting[0];
            const stroke = Math.floor(dial);
            const R = stroke < 7 ? frame.R1 : frame.R2;
            expect(Math.hypot(...p.pos), `dial ${dial}`).toBeCloseTo(PAINT_DISTANCE, 6);
            expect(angleBetween(p.pos, frame.A) / DEG, `dial ${dial}`).toBeCloseTo((R - 0.6 * DEG) / DEG, 6);
            expect(p.colour, `dial ${dial}`).toEqual(LINKS[stroke]);
            expect(p.trail, `dial ${dial}`).toBe(1);
        }
        expect(f.sample(9, bowAt(3), 1).filter((p) => p.mode === 1)).toHaveLength(0);
    });

    it('moves the brush along its stroke from phi0 toward phi1 as the dial rises', () => {
        const f = flock();
        const s = frame.strokes1[1];
        const at = (dial) => f.sample(5, bowAt(dial), 1).find((p) => p.mode === 1).pos.slice();
        const first = at(1.1);
        const mid = at(1.5);
        const last = at(1.9);
        const start = angleBetween(first, frame.A);
        expect(angleBetween(mid, frame.A)).toBeCloseTo(start, 9);
        // Further round the circle each step, in the stroke's own direction.
        const phiOf = (pos) => Math.atan2(
            pos[0] * frame.basis.right[0] + pos[1] * frame.basis.right[1] + pos[2] * frame.basis.right[2],
            pos[0] * frame.basis.down[0] + pos[1] * frame.basis.down[1] + pos[2] * frame.basis.down[2],
        );
        const dir = Math.sign(s.phi1 - s.phi0);
        expect(Math.sign(phiOf(mid) - phiOf(first))).toBe(dir);
        expect(Math.sign(phiOf(last) - phiOf(mid))).toBe(dir);
    });

    it('raises the T-spin\'s double helix only in its window', () => {
        const f = flock();
        const from = [-80, -10, -120];
        f.helix(from, 50);
        const before = f.sample(49.9, bowAt(0), 1).filter((p) => p.mode === 2);
        expect(before).toHaveLength(0);
        const during = f.sample(50.8, bowAt(0), 1).filter((p) => p.mode === 2);
        expect(during).toHaveLength(2);
        // Two children round one axis, opposite each other, rising.
        const [a, b] = during;
        expect(Math.hypot(a.pos[0] - from[0], a.pos[2] - from[2])).toBeCloseTo(4, 6);
        expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2])).toBeCloseTo(8, 6);
        const risen = a.pos[1];
        expect(risen).toBeGreaterThan(from[1]);
        const higher = f.sample(51.4, bowAt(0), 1).find((p) => p.mode === 2);
        expect(higher.pos[1]).toBeGreaterThan(risen);
        expect(f.sample(52.3, bowAt(0), 1).filter((p) => p.mode === 2)).toHaveLength(0);
    });

    it('sails the level-up flight out from the isle only in its window', () => {
        const f = flock();
        const from = [-250, 60, -460];
        f.launch(from, 30);
        expect(f.sample(29.9, bowAt(0), 1).filter((p) => p.mode === 3)).toHaveLength(0);
        const early = f.sample(30.5, bowAt(0), 1).filter((p) => p.mode === 3);
        expect(early.length).toBeGreaterThan(0);
        const later = f.sample(34, bowAt(0), 1).filter((p) => p.mode === 3);
        expect(later).toHaveLength(Math.min(12, CAPACITY));
        // Out over the gulf: further from where they left as the flight goes on.
        const spread = (set) => Math.max(...set.map((p) => Math.hypot(p.pos[0] - from[0], p.pos[2] - from[2])));
        expect(spread(later)).toBeGreaterThan(spread(early));
        expect(f.sample(36.6, bowAt(0), 1).filter((p) => p.mode === 3)).toHaveLength(0);
    });

    it('parks the children the hour keeps home: scale 0, out of sight, whatever share is aloft', () => {
        const f = flock();
        for (const aloft of [1, 0.75, 0.5, 0.2, 0]) {
            const poses = f.sample(15, bowAt(0), aloft);
            const flying = Math.max(2, Math.round(CAPACITY * aloft));
            poses.forEach((p, i) => {
                if (i < flying) {
                    expect(p.scale, `aloft ${aloft} glider ${i}`).toBeGreaterThan(0);
                } else {
                    expect(p.scale, `aloft ${aloft} glider ${i}`).toBe(0);
                    expect(p.pos[1], `aloft ${aloft} glider ${i}`).toBeLessThan(-1e4);
                }
            });
        }
        // No thermals yet: every child is parked.
        const homeless = new GliderFlock(CAPACITY, 33);
        expect(homeless.sample(15, null, 1).every((p) => p.scale === 0)).toBe(true);
    });

    it('keeps the long-wing on the bow\'s leg while a back-to-back holds', () => {
        const f = flock();
        expect(f.sample(10, bowAt(0), 1).filter((p) => p.mode === 4)).toHaveLength(0);
        f.longWing = true;
        const wing = f.sample(10, bowAt(0), 1).filter((p) => p.mode === 4);
        expect(wing).toHaveLength(1);
        expect(angleBetween(wing[0].pos, frame.A) / DEG).toBeCloseTo((frame.R1 - 1.2 * DEG) / DEG, 6);
        expect(wing[0].scale).toBeGreaterThan(1);
    });
});
