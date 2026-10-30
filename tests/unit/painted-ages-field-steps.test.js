import { describe, expect, it } from 'vitest';
import { FIELDS, FIELD_ORDER } from '../../src/themes/painted-ages/painted-ages-core.js';
import { planBadlands } from '../../src/themes/painted-ages/painted-ages-assets.js';
import { fieldTextureData, fieldTextureSteps } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';

/**
 * Painted Ages prepared each field's texture in one step (the near field ~53 ms) and read, decoded
 * and prepared its land again on every visit. The texture is made a band of rows a step now (every
 * texel its own: the same bytes), and a land read from the assets is kept for the session.
 */
const run = (steps) => {
    let yields = 0;
    for (;;) {
        const next = steps.next();
        if (next.done) return { value: next.value, yields };
        yields += 1;
    }
};

describe('Painted Ages prepares its field textures in bands', () => {
    it('the bands write the bytes one pass does', () => {
        const fields = planBadlands();
        for (const name of FIELD_ORDER) {
            const { heights, sky } = fields[name];
            const once = fieldTextureData(heights, sky, FIELDS[name]);
            const banded = run(fieldTextureSteps(heights, sky, FIELDS[name], 37));
            expect(banded.yields).toBe(Math.ceil(FIELDS[name].size / 37) - 1);
            expect(Buffer.compare(Buffer.from(banded.value.buffer), Buffer.from(once.buffer)), name).toBe(0);
        }
    }, 60_000);

    it('keeps no land drawn from the plan (the next visit tries the assets again)', async () => {
        const a = await PaintedAgesWorld.prepare('Low');
        const b = await PaintedAgesWorld.prepare('Low');
        expect(a.source).not.toBe('asset');
        expect(b).not.toBe(a);
        for (const name of FIELD_ORDER) {
            expect(Buffer.compare(Buffer.from(a.textures[name].buffer), Buffer.from(b.textures[name].buffer))).toBe(0);
        }
    }, 120_000);
});
