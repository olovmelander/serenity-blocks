import { describe, expect, it } from 'vitest';
import { RAINBARK_SEEDS, bakeAtlasSet, bakeCanopySet } from '../../src/themes/rainbark/rainbark-bake.js';
import { rainbarkBakes } from '../../src/themes/rainbark/rainbark-world.js';

const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

describe('Rainbark bakes its first visit in a worker', () => {
    it('bakes the same sets wherever they run (the worker posts what the build would make)', () => {
        const a = bakeAtlasSet(256);
        const b = bakeAtlasSet(256);
        expect(Object.keys(a).sort()).toEqual(['atlas', 'fbm', 'lattice', 'ramp']);
        for (const key of Object.keys(a)) {
            const left = a[key].data ?? a[key];
            const right = b[key].data ?? b[key];
            if (ArrayBuffer.isView(left)) expect(bytes(left).equals(bytes(right)), key).toBe(true);
        }
        expect(Object.keys(bakeCanopySet()).sort()).toEqual(['crowns', 'gap', 'lace']);
        expect(Object.isFrozen(RAINBARK_SEEDS)).toBe(true);
    });

    it('resolves without a Worker, leaving the build to bake as before', async () => {
        await expect(rainbarkBakes('High')).resolves.toMatchObject({ viaWorker: false });
    });
});
