import { describe, it, expect } from 'vitest';
import { createEmptyMatchMetrics, accumulateMatchMetrics } from '../match-metrics.js';

describe('match-metrics — end-of-match aggregation', () => {
    it('starts from a zeroed record', () => {
        const m = createEmptyMatchMetrics();
        expect(m.attacksSent).toBe(0);
        expect(m.maxComboDepth).toBe(0);
        expect(m.potatoPasses).toBe(0);
    });

    it('sums additive fields and takes the max of max-fields across rounds', () => {
        const total = createEmptyMatchMetrics();
        accumulateMatchMetrics(total, {
            attacksSent: 3,
            attackLinesSent: 7,
            cleanLinesSent: 2,
            potatoPasses: 1,
            maxComboComplexity: 4,
            maxComboDepth: 3,
        });
        accumulateMatchMetrics(total, {
            attacksSent: 2,
            attackLinesSent: 5,
            cleanLinesSent: 1,
            potatoPasses: 2,
            maxComboComplexity: 2,
            maxComboDepth: 6,
        });

        // additive
        expect(total.attacksSent).toBe(5);
        expect(total.attackLinesSent).toBe(12);
        expect(total.cleanLinesSent).toBe(3);
        expect(total.potatoPasses).toBe(3);
        // max
        expect(total.maxComboComplexity).toBe(4); // max(4, 2)
        expect(total.maxComboDepth).toBe(6); // max(3, 6)
    });

    it('tolerates missing/partial source records', () => {
        const total = createEmptyMatchMetrics();
        accumulateMatchMetrics(total, undefined);
        accumulateMatchMetrics(total, { attacksSent: 1 });
        expect(total.attacksSent).toBe(1);
        expect(total.attackLinesSent).toBe(0);
    });
});
