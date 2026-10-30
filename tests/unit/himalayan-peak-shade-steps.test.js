import { describe, expect, it } from 'vitest';
import { deriveField, deriveFieldInSteps, planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import { shadeMap, shadeRows } from '../../src/themes/himalayan-peak/himalayan-peak-field.js';

/**
 * Himalayan Peak's shading map was one ~105 ms call in its stepped first build; it is filled a band
 * of rows at a time now. Every texel is its own, so the bands write exactly what one call does.
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
});
