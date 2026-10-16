import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeCacheStats, isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { KOI_PEBBLES_SEED, bakePebbles, pebblesKey } from '../../src/themes/koi-pond/koi-pond-pebbles.js';
import { bakePebbles as bedPebbles } from '../../src/themes/koi-pond/koi-pond-bed.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/koi-pond/koi-pond-quality.js';
import { KoiPondWorld } from '../../src/themes/koi-pond/koi-pond-world.js';
import { koiPondBakeJobs, koiPondBakeKey, koiPondBakes } from '../../src/themes/koi-pond/koi-pond-theme.js';
import { planGarden } from '../../src/themes/koi-pond/koi-pond-garden.js';
import { PondLight } from '../../src/themes/koi-pond/koi-pond-light.js';
import { PondSurface } from '../../src/themes/koi-pond/koi-pond-surface.js';

const source = (name) => readFileSync(new URL(`../../src/themes/koi-pond/${name}`, import.meta.url), 'utf8');

afterEach(() => resetBakeCache());

describe('Koi Pond bakes its pebble field ahead of the build', () => {
    it('keeps the bed\'s bake in a three-free module the worker can load', () => {
        expect(bedPebbles).toBe(bakePebbles);
    });

    it.each(QUALITY_NAMES)('names, at %s, exactly the field the bed asks for', (quality) => {
        const key = pebblesKey(tierFor(quality).pebbles, KOI_PEBBLES_SEED);
        expect(isBaked(key)).toBe(false);
        bakePebbles(tierFor(quality).pebbles);
        expect(isBaked(key)).toBe(true);
    });

    it.each(QUALITY_NAMES)('names, at %s, the noise and the water mask the light and the surface bake', (quality) => {
        const tier = tierFor(quality);
        const jobs = koiPondBakeJobs(quality);
        expect(jobs.map((job) => job.kind)).toEqual(['pebbles', 'noise', 'mask']);
        for (const job of jobs) expect(isBaked(koiPondBakeKey(job)), job.kind).toBe(false);
        // What the world builds them from: the stones standing in the water of its own garden.
        const world = source('koi-pond-world.js');
        expect(world).toContain('const garden = planGarden();');
        expect(world).toContain('this.rocks = garden.standing;');
        expect(world).toContain('new PondSurface({ light, tier, rocks: this.rocks })');
        const light = new PondLight({ tier });
        const surface = new PondSurface({ light, tier, rocks: planGarden().standing });
        bakePebbles(tier.pebbles, KOI_PEBBLES_SEED);
        for (const job of jobs) expect(isBaked(koiPondBakeKey(job)), job.kind).toBe(true);
        surface.dispose();
        light.dispose();
    });

    it('serves every job from a worker whose bakes import no three', () => {
        const worker = source('koi-pond-bake.worker.js');
        for (const kind of ['pebbles', 'noise', 'mask']) expect(worker).toMatch(new RegExp(`\\b${kind}: `));
        expect(source('koi-pond-core.js')).not.toMatch(/from 'three/);
    });

    it('leaves a world nothing to bake once the job\'s result is kept', () => {
        bakePebbles(tierFor('Minimal').pebbles, KOI_PEBBLES_SEED);
        const before = bakeCacheStats().entries;
        const world = new KoiPondWorld({ scene: new THREE.Scene(), quality: 'Minimal', capture: true }).build();
        // The bed took the kept field (the world's other bakes are not the worker's).
        expect(isBaked(pebblesKey(tierFor('Minimal').pebbles, KOI_PEBBLES_SEED))).toBe(true);
        expect(bakeCacheStats().entries).toBeGreaterThanOrEqual(before);
        world.dispose();
    });

    it('resolves at once without a Worker, leaving the bed to bake as before', async () => {
        await expect(koiPondBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
        expect(bakeCacheStats().entries).toBe(0);
    });
});
