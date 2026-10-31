/**
 * Grainfields builds its first visit in steps (2026-10-31): the barley's planting, the fells' mesh
 * and the shelterbelts pause by a clock, and the old functions drain the steps. Paused at every
 * chance, they build what one call builds.
 */
import { describe, expect, it } from 'vitest';
import { CLOSE_STAND, grainSites, grainSitesSteps } from '../../src/themes/grainfields/grainfields-plan.js';
import { createGateGeometry, createGateGeometrySteps } from '../../src/themes/grainfields/grainfields-lapporten.js';
import { fanSteps } from '../../src/themes/grainfields/grainfields-land.js';
import { drainSteps } from '../../src/themes/shared/build-steps.js';

/** A clock that is always due: the steps yield at every chance they have. */
const always = () => ({ due: () => true, restart() {} });
const drainCounting = (steps) => {
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
        yields += 1;
        next = steps.next();
    }
    return { value: next.value, yields };
};

describe('Grainfields first build in steps', () => {
    it('plants the same barley, drawing the same numbers, however often it pauses', () => {
        for (const options of [
            {
                count: 3000, near: 2.5, far: 60, knee: 7, seed: 0x6a7e,
            },
            {
                count: 40,
                near: CLOSE_STAND.near,
                far: CLOSE_STAND.far,
                bearings: CLOSE_STAND.bearings,
                bank: false,
                fade: false,
                seed: 0x6a7d,
            },
        ]) {
            const once = grainSites(options);
            const paused = drainCounting(grainSitesSteps(options, always()));
            expect(paused.yields).toBeGreaterThan(0);
            expect(paused.value.count).toBe(once.count);
            expect(paused.value.data).toEqual(once.data);
        }
    });

    it('lays the land\'s posts and the fells\' mesh the same, paused at every chance', () => {
        const whole = drainSteps(fanSteps(60, 40));
        const paused = drainCounting(fanSteps(60, 40, always()));
        expect(paused.yields).toBe(39);
        expect(paused.value.positions).toEqual(whole.positions);
        expect(paused.value.cover).toEqual(whole.cover);

        const gate = createGateGeometry(48, 20);
        const steps = drainCounting(createGateGeometrySteps(48, 20, always()));
        expect(steps.yields).toBeGreaterThanOrEqual(21);
        for (const name of ['position', 'aShape', 'normal']) {
            expect(steps.value.attributes[name].array, name).toEqual(gate.attributes[name].array);
        }
        expect(steps.value.index.array).toEqual(gate.index.array);
    });
});
