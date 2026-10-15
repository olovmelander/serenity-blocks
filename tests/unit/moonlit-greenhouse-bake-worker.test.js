import {
    afterEach, describe, expect, it,
} from 'vitest';
import { bakeCacheStats, isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { GARDEN_NOISE_SEED, gardenNoiseKey } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';
import { createGardenNoise } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-tsl.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { moonlitGreenhouseBakes } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-theme.js';

afterEach(() => resetBakeCache());

describe('Moonlit Greenhouse bakes its garden noise ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, exactly the noise the world asks for', (quality) => {
        const key = gardenNoiseKey(tierFor(quality).noise, GARDEN_NOISE_SEED);
        expect(isBaked(key)).toBe(false);
        createGardenNoise(tierFor(quality).noise).dispose();
        expect(isBaked(key)).toBe(true);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(moonlitGreenhouseBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
        expect(bakeCacheStats().entries).toBe(0);
    });
});
