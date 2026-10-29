import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { drainSteps } from '../../src/themes/shared/build-steps.js';
import { lakeMapDataSteps } from '../../src/themes/summer/summer-terrain.js';

/**
 * Summer baked its lake map (512 × 384 samples of the ground and the shore) in one 70-90 ms step on
 * every start. It is kept for the session now, and a session's first bake runs in steps of ~24 ms;
 * the steps must bake exactly what one pass bakes.
 */
describe('Summer lake map', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('bakes in steps the same bytes as in one pass', () => {
        const whole = drainSteps(lakeMapDataSteps());
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => {
            now += 30;
            return now;
        });
        const steps = lakeMapDataSteps();
        let count = 0;
        let next = steps.next();
        while (!next.done) {
            count += 1;
            next = steps.next();
        }
        expect(count).toBeGreaterThan(100);
        expect(Buffer.compare(Buffer.from(next.value), Buffer.from(whole))).toBe(0);
    }, 30_000);
});
