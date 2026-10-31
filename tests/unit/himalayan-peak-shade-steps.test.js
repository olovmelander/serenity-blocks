import { describe, expect, it } from 'vitest';
import { deriveField, deriveFieldInSteps, planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import {
    buildMassifMesh, buildMassifMeshSteps, horizonMap, horizonMapSteps, shadeMap, shadeRows, shadowSlices,
    shadowSlicesSteps,
} from '../../src/themes/himalayan-peak/himalayan-peak-field.js';

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
const same = (a, b) => a.constructor === b.constructor
    && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

/**
 * Himalayan Peak's shading map was one ~105 ms call in its stepped first build; it is filled a few
 * rows at a time now, and the horizon map, the shadow in the air and the mesh pause by the clock
 * too. Every texel is its own and every pause keeps its loop's state, so the steps write exactly
 * what one call does.
 */
describe('Himalayan Peak shades its massif in bands', () => {
    it('any split of the rows writes the bytes one call writes', () => {
        const { heights, sky, size } = planMassif();
        const whole = shadeMap(heights, sky, size);
        const banded = new Uint8Array(size * size * 4);
        for (let j = 0; j < size; j += 37) shadeRows(banded, heights, sky, size, j, Math.min(size, j + 37));
        expect(Buffer.compare(Buffer.from(banded), Buffer.from(whole))).toBe(0);
    }, 60_000);

    it('the stepped field shades as the one-call field does', async () => {
        const massif = planMassif();
        const stepped = await deriveFieldInSteps(massif, 4);
        const once = deriveField(massif);
        expect(Buffer.compare(Buffer.from(stepped.shade), Buffer.from(once.shade))).toBe(0);
    }, 120_000);

    it('the horizon, the shadow in the air and the mesh, paused at every chance, are the one-call ones', () => {
        const { heights, size } = planMassif(96);
        const horizon = drainCounting(horizonMapSteps(heights, size, always()));
        expect(horizon.yields).toBeGreaterThan(size);
        expect(same(horizon.value, horizonMap(heights, size))).toBe(true);
        const slices = drainCounting(shadowSlicesSteps(heights, size, 48, always()));
        expect(slices.yields).toBeGreaterThan(size * 4);
        const once = shadowSlices(heights, size, 48);
        expect(same(slices.value.volume, once.volume) && same(slices.value.low, once.low)).toBe(true);
        for (const stride of [1, 2]) {
            const mesh = drainCounting(buildMassifMeshSteps(heights, size, { stride }, always()));
            const whole = buildMassifMesh(heights, size, { stride });
            expect(mesh.yields).toBeGreaterThan(0);
            expect(same(mesh.value.positions, whole.positions) && same(mesh.value.indices, whole.indices)).toBe(true);
            expect([mesh.value.cells, mesh.value.kept]).toEqual([whole.cells, whole.kept]);
        }
    }, 60_000);
});
