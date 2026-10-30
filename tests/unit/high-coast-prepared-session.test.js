import { describe, expect, it } from 'vitest';
import { FIELD_ORDER } from '../../src/themes/high-coast/high-coast-core.js';
import { HighCoastWorld } from '../../src/themes/high-coast/high-coast-world.js';

/**
 * High Coast read, decoded and prepared its coast again on every visit. A coast read from the baked assets
 * is kept for the session per quality now; one drawn from the plan (an asset that could not be
 * read) is not, so the next visit tries the assets again.
 */
describe('High Coast keeps only a coast read from its assets', () => {
    it('keeps no coast drawn from the plan, and prepares the same one again', async () => {
        const a = await HighCoastWorld.prepare('Low');
        const b = await HighCoastWorld.prepare('Low');
        expect(a.source).not.toBe('asset');
        expect(b).not.toBe(a);
        for (const name of FIELD_ORDER) {
            expect(Buffer.compare(Buffer.from(a.textures[name].buffer), Buffer.from(b.textures[name].buffer))).toBe(0);
        }
    }, 120_000);
});
