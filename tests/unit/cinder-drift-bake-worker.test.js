import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeNoise, bakePlates } from '../../src/themes/cinder-drift/cinder-drift-tsl.js';
import {
    CINDER_DRIFT_BAKE_JOBS, cinderDriftBakeKey, cinderDriftBakes,
} from '../../src/themes/cinder-drift/cinder-drift-bakes.js';

/**
 * Cinder Drift's noise and plates bake in a module Worker on a first visit (about 0.14 s of main
 * thread, play-feel probe 2026-10-16; its stepped build: build-steps.test.js). The jobs must name
 * exactly the bakes the world's build asks for, under the keys those bakes keep.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/cinder-drift/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Cinder Drift bakes its fields ahead of the build', () => {
    it('names the two bakes the world builds from, under the keys they keep', () => {
        for (const job of CINDER_DRIFT_BAKE_JOBS) expect(isBaked(cinderDriftBakeKey(job))).toBe(false);
        // What the world calls (cinder-drift-world.js: both at their defaults).
        expect(source('cinder-drift-world.js')).toContain('createFieldTexture(bakeNoise(), NOISE_SIZE');
        expect(source('cinder-drift-world.js')).toContain('createFieldTexture(bakePlates(), PLATE_SIZE');
        bakeNoise();
        bakePlates();
        for (const job of CINDER_DRIFT_BAKE_JOBS) expect(isBaked(cinderDriftBakeKey(job)), job.kind).toBe(true);
    });

    it('bakes in a module that imports no three, served by its worker under the jobs\' kinds', () => {
        expect(source('cinder-drift-bake.js')).not.toMatch(/from 'three/);
        const worker = source('cinder-drift-bake.worker.js');
        for (const { kind } of CINDER_DRIFT_BAKE_JOBS) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(cinderDriftBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
