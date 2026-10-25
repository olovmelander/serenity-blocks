import { describe, expect, it } from 'vitest';

import { ODYSSEY_MEADOW_LIFE, meadowLifeAt } from './odyssey-meadow-life.js';

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
});
