import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    FBM_SIZE, LATTICE_SIZE, OCULUS_TEX, bakeAllSunfallTextures, bakeFbm, bakeLattice, bakeOculus,
} from '../../src/themes/sunfall/sunfall-bake.js';
import { sunfallBakeJobs, sunfallBakeKey, sunfallBakes } from '../../src/themes/sunfall/sunfall-bakes.js';
import { SUNFALL_SEED } from '../../src/themes/sunfall/sunfall-core.js';
import { isBaked, primeBake } from '../../src/themes/shared/bake-cache.js';

/**
 * Sunfall baked its lattice, fBm and oculus on every visit (~60 ms, up to 90 cold). They are kept
 * for the session now (the bake cache), and a first visit bakes them in a module Worker while the
 * authored assets load. A job keyed other than bakeAllSunfallTextures' own calls would be baked
 * again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/sunfall/${name}`, import.meta.url), 'utf8');

describe('Sunfall bakes its textures once a session, ahead of the build', () => {
    it('runs three-free bakes in its worker, started while the assets load', () => {
        expect(source('sunfall-bake-data.js')).not.toMatch(/from 'three/);
        expect(source('sunfall-core.js')).not.toMatch(/from 'three/);
        expect(source('sunfall-bake.worker.js')).toMatch(/lattice: bakeLattice, fbm: bakeFbm, oculus: bakeOculus/);
        expect(source('sunfall-world.js')).toContain('const baking = sunfallBakes();');
        expect(sunfallBakeJobs()).toEqual([
            { kind: 'lattice', args: [SUNFALL_SEED >>> 0, LATTICE_SIZE] },
            { kind: 'fbm', args: [SUNFALL_SEED >>> 0, FBM_SIZE] },
            { kind: 'oculus', args: [SUNFALL_SEED >>> 0] },
        ]);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(sunfallBakes()).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('draws what the worker posted, and every later visit draws the same arrays', () => {
        const seed = 4242;
        const jobs = sunfallBakeJobs(seed);
        const bakes = { lattice: bakeLattice, fbm: bakeFbm, oculus: bakeOculus };
        const posted = {};
        for (const job of jobs) {
            const key = sunfallBakeKey(job);
            expect(isBaked(key)).toBe(false);
            posted[job.kind] = bakes[job.kind](...job.args);
            primeBake(key, posted[job.kind]);
        }
        const first = bakeAllSunfallTextures(seed);
        expect(first.lattice.image.data).toBe(posted.lattice);
        expect(first.fbm.image.data).toBe(posted.fbm);
        expect(first.oculus.image.data).toBe(posted.oculus);
        const again = bakeAllSunfallTextures(seed);
        expect(again.oculus.image.data).toBe(posted.oculus);
        expect(again.oculus).not.toBe(first.oculus);
        // The same seed bakes the same bytes: the worker's textures are the page's.
        expect(Buffer.compare(Buffer.from(bakeOculus(seed, OCULUS_TEX)), Buffer.from(posted.oculus))).toBe(0);
        expect(Buffer.compare(Buffer.from(bakeFbm(seed, FBM_SIZE)), Buffer.from(posted.fbm))).toBe(0);
        first.dispose();
        again.dispose();
    });
});
