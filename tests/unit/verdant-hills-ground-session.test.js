import { describe, expect, it } from 'vitest';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { verdantHillsTier } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import { VerdantHillsTerrain, prepareGroundSteps } from '../../src/themes/verdant-hills/verdant-hills-terrain.js';

/**
 * Verdant Hills built its ground mesh (the wedge's rings over the height function) in one 43 ms
 * build step on every start. It is built in steps once a session now, and each start gets its own
 * geometry over the kept arrays.
 */
const run = (steps) => {
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
};

describe('Verdant Hills keeps its ground for the session', () => {
    it('prepares once, then every terrain shares the kept arrays in a geometry of its own', () => {
        const light = new VerdantHillsLight({ tier: verdantHillsTier('Low'), rng: () => 0.5 });
        run(prepareGroundSteps());
        expect(run(prepareGroundSteps())).toBe(false);
        const a = new VerdantHillsTerrain({ light }).build();
        const b = new VerdantHillsTerrain({ light }).build();
        expect(b.mesh.geometry).not.toBe(a.mesh.geometry);
        for (const name of ['position', 'normal']) {
            expect(b.mesh.geometry.getAttribute(name).array).toBe(a.mesh.geometry.getAttribute(name).array);
        }
        expect(b.triangles).toBe(a.triangles);
        expect(a.triangles).toBeGreaterThan(0);
    }, 60_000);
});
