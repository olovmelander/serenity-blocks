import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { bakeCacheStats, isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { KOI_PEBBLES_SEED, bakePebbles, pebblesKey } from '../../src/themes/koi-pond/koi-pond-pebbles.js';
import { bakePebbles as bedPebbles } from '../../src/themes/koi-pond/koi-pond-bed.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/koi-pond/koi-pond-quality.js';
import { KoiPondWorld } from '../../src/themes/koi-pond/koi-pond-world.js';
import { koiPondBakes } from '../../src/themes/koi-pond/koi-pond-theme.js';

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
