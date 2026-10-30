import { describe, expect, it } from 'vitest';
import { FIELD_ORDER } from '../../src/themes/painted-ages/painted-ages-core.js';
import { PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';

/**
 * Painted Ages read, decoded and prepared its land again on every visit. A land read from the baked assets
 * is kept for the session per quality now; one drawn from the plan (an asset that could not be
 * read) is not, so the next visit tries the assets again.
 */
describe('Painted Ages keeps only a land read from its assets', () => {
    it('keeps no land drawn from the plan, and prepares the same one again', async () => {
        const a = await PaintedAgesWorld.prepare('Low');
        const b = await PaintedAgesWorld.prepare('Low');
        expect(a.source).not.toBe('asset');
        expect(b).not.toBe(a);
        for (const name of FIELD_ORDER) {
            expect(Buffer.compare(Buffer.from(a.textures[name].buffer), Buffer.from(b.textures[name].buffer))).toBe(0);
        }
    }, 120_000);
});
