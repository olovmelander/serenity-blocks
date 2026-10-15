import {
    afterEach, describe, expect, it,
} from 'vitest';
import { isBaked, resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { bakeSeabed, seabedKey } from '../../src/themes/ocean/ocean-core.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/ocean/ocean-quality.js';
import { createSeabed } from '../../src/themes/ocean/ocean-seabed.js';
import { oceanBakes } from '../../src/themes/ocean/ocean-bakes.js';

afterEach(() => resetBakeCache());

describe('Ocean bakes its seabed sheet ahead of the build', () => {
    it.each(QUALITY_NAMES)('names, at %s, exactly the sheet the world builds', (quality) => {
        const { seabed } = tierFor(quality);
        expect(isBaked(seabedKey(seabed))).toBe(false);
        const part = createSeabed({ noise: () => 0 }, { detail: seabed });
        expect(isBaked(seabedKey(seabed))).toBe(true);
        // The mesh is laid on the kept arrays, read-only.
        const position = part.mesh?.geometry?.getAttribute('position') ?? part.geometry?.getAttribute('position');
        if (position) expect(position.array).toBe(bakeSeabed(seabed).position);
    });

    it('resolves at once without a Worker, leaving the build to bake as before', async () => {
        await expect(oceanBakes('High')).resolves.toEqual({ viaWorker: false, baked: 0, cached: 0 });
    });
});
