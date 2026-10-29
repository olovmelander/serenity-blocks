import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    WORLD_SEED, bakeBandMeta, bakeFbm, bakeLattice, bakeRingProfile,
} from '../../src/themes/stellar-drift/stellar-drift-bake.js';
import {
    stellarDriftBakeJobs, stellarDriftBakeKey, stellarDriftBakes,
} from '../../src/themes/stellar-drift/stellar-drift-bakes.js';
import { tierFor } from '../../src/themes/stellar-drift/stellar-drift-quality.js';
import { isBaked, primeBake } from '../../src/themes/shared/bake-cache.js';

/**
 * Stellar Drift's first visit baked its lattice, clouds, rings and bands on the page (~60 ms at
 * High). A worker bakes them while the renderer comes up and primes the bake cache under the keys
 * the world's own calls use; a job that names other arguments would be baked again on the page.
 */
const source = (name) => readFileSync(new URL(`../../src/themes/stellar-drift/${name}`, import.meta.url), 'utf8');

describe('Stellar Drift bakes ahead of the build', () => {
    it('asks for exactly what the world builds from, served by its worker from a three-free module', () => {
        const world = source('stellar-drift-world.js');
        expect(world).toContain('createLatticeTexture(bakeLattice(this.seed + 11))');
        expect(world).toContain('bakeFbm(this.seed + 23, tier.fbmSize, tier.fbmOctaves)');
        expect(world).toContain('bakeRingProfile(tier.ringSize, this.seed + 37)');
        expect(world).toContain('bakeBandMeta(512, this.seed + 41)');
        expect(world).toContain('seed = WORLD_SEED,');
        expect(source('stellar-drift-bake.js')).not.toMatch(/from 'three/);
        expect(source('stellar-drift-core.js')).not.toMatch(/from 'three/);
        expect(source('stellar-drift-theme.js')).toContain('const baking = stellarDriftBakes(this.quality);');
        const tier = tierFor('High');
        expect(stellarDriftBakeJobs('High')).toEqual([
            { kind: 'lattice', args: [WORLD_SEED + 11, 256] },
            { kind: 'fbm', args: [WORLD_SEED + 23, tier.fbmSize, tier.fbmOctaves] },
            { kind: 'ring', args: [tier.ringSize, WORLD_SEED + 37] },
            { kind: 'bands', args: [512, WORLD_SEED + 41] },
        ]);
        expect(source('stellar-drift-bake.worker.js'))
            .toMatch(/lattice: bakeLattice, fbm: bakeFbm, ring: bakeRingProfile, bands: bakeBandMeta/);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(stellarDriftBakes('Low')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });

    it('keys each job where the world\'s own call looks, so a primed bake is not baked again', () => {
        const bakes = {
            lattice: bakeLattice, fbm: bakeFbm, ring: bakeRingProfile, bands: bakeBandMeta,
        };
        for (const job of stellarDriftBakeJobs('Low', 4242)) {
            const key = stellarDriftBakeKey(job);
            expect(isBaked(key)).toBe(false);
            const posted = { posted: job.kind };
            primeBake(key, posted);
            // The world's call with the job's arguments finds the primed value, not a fresh bake.
            expect(bakes[job.kind](...job.args)).toBe(posted);
        }
    });
});
