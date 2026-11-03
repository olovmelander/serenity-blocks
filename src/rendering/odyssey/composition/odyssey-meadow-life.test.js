import { describe, expect, it } from 'vitest';

import {
    BUTTERFLY_BEAT, ODYSSEY_MEADOW_LIFE, butterflyBeatAt, meadowLifeAt,
} from './odyssey-meadow-life.js';

/**
 * The meadows' near life (Act II pass, step 5): petals and butterflies over chapters 3-4, gone
 * before the climb and absent on the shore's approach, sized to read at the camera's range.
 */
describe('the meadows\' near life', () => {
    it('lives over the meadows only, and is gone before the climb', () => {
        expect(meadowLifeAt(0.15)).toEqual({ petals: 0, butterflies: 0 });
        expect(meadowLifeAt(0.27).petals).toBeCloseTo(1, 6);
        expect(meadowLifeAt(0.27).butterflies).toBeCloseTo(1, 6);
        expect(meadowLifeAt(0.40)).toEqual({ petals: 0, butterflies: 0 });
    });

    it('keeps the butterflies few and near, and the petals a drift rather than a blizzard', () => {
        const { petals, butterflies } = ODYSSEY_MEADOW_LIFE;
        expect(butterflies.count).toBeLessThan(40);
        expect(butterflies.far).toBeLessThan(petals.far);
        // Wings at least as wide as a petal is tall, so a butterfly reads as one at range.
        expect(butterflies.size[0]).toBeGreaterThan(petals.size[1]);
        // No quad at the lens: both fade in past a few units.
        expect(petals.near).toBeGreaterThanOrEqual(2.5);
        expect(butterflies.near).toBeGreaterThanOrEqual(2.5);
    });

    it('beats a butterfly\'s wings smoothly, the body bobbing up as they come down (2026-11-03)', () => {
        const worstAcc = (f, h) => {
            let worst = 0;
            for (let t = 3; t < 9; t += h) worst = Math.max(worst, Math.abs((f(t - h) - (2 * f(t)) + f(t + h)) / (h * h)));
            return worst;
        };
        [[0.2, 0.7, 0.4, 0.9], [0.8, 0.1, 0.6, 0.3]].forEach(([h2, h3, h4, h5]) => {
            const width = (t) => butterflyBeatAt(t, h2, h3, h4, h5).width;
            const bob = (t) => butterflyBeatAt(t, h2, h3, h4, h5).bob;
            // No corner: the same worst acceleration at 1920 and 480 Hz (|cos| bounced: ~4x).
            expect(worstAcc(width, 1 / 1920) / worstAcc(width, 1 / 480)).toBeLessThan(1.2);
            expect(worstAcc(bob, 1 / 1920) / worstAcc(bob, 1 / 480)).toBeLessThan(1.2);
            let lo = Infinity;
            let hi = -Infinity;
            for (let t = 0; t < 30; t += 0.005) { lo = Math.min(lo, width(t)); hi = Math.max(hi, width(t)); }
            expect(lo).toBeGreaterThan(0.1);
            expect(lo).toBeLessThan(0.25);
            expect(hi).toBeLessThanOrEqual(1.0001);
        });
        // The body is highest as the wings lie flat (the end of the downstroke).
        expect(Math.cos(0) * BUTTERFLY_BEAT.bob).toBeGreaterThan(0);
    });
});
