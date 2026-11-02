import { describe, expect, it } from 'vitest';

import {
    FOREST_GREENS_SPECIES, ODYSSEY_FOREST_GREENS, ODYSSEY_FOREST_GREENS_DEFAULT, forestGreensCrown, resolveForestGreens,
} from './odyssey-forest-greens.js';
import { getForestSpecies } from './odyssey-forest-species.js';

/** THE BROADLEAF GREENS: the per-tree palettes offered for the lowland broadleaf (owner's choice). */
describe('the broadleaf greens', () => {
    const trees = Array.from({ length: 400 }, (_, i) => ({
        x: -600 + ((i % 20) * 31.7), z: -300 - (Math.floor(i / 20) * 27.3), speciesId: 'S1-shore-broadleaf',
    }));
    const luma = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);

    it('resolves names: mosaic by default, today one lever away', () => {
        expect(ODYSSEY_FOREST_GREENS_DEFAULT).toBe('mosaic');
        expect(resolveForestGreens(undefined)).toBe('mosaic');
        expect(resolveForestGreens('nonsense')).toBe('mosaic');
        expect(resolveForestGreens(' DEEP ')).toBe('deep');
        expect(forestGreensCrown(trees[0], 'today')).toBeNull();
    });

    it('touches only the green broadleaf', () => {
        ['S4-gold-birch', 'S6-red-maple', 'S7-pink-blossom', 'S2-workhorse-pine'].forEach((speciesId) => {
            expect(forestGreensCrown({ x: 1, z: 2, speciesId }, 'mosaic')).toBeNull();
        });
        FOREST_GREENS_SPECIES.forEach((id) => expect(getForestSpecies(id)).toBeTruthy());
    });

    it('stays green, varies from tree to tree, and keeps the mosaic\'s mean near the species\' lime', () => {
        ['mosaic', 'deep'].forEach((id) => {
            const crowns = trees.map((t) => forestGreensCrown(t, id));
            crowns.forEach((c) => {
                expect(c[1]).toBeGreaterThan(c[0]);
                expect(c[1]).toBeGreaterThan(c[2]);
            });
            const l = crowns.map(luma);
            expect(Math.max(...l) / Math.min(...l)).toBeGreaterThan(1.3);
            expect(new Set(crowns.map((c) => c.map((v) => v.toFixed(3)).join())).size).toBeGreaterThan(300);
        });
        const mean = (id) => luma(trees.map((t) => forestGreensCrown(t, id))
            .reduce((a, c) => a.map((v, k) => v + (c[k] / trees.length)), [0, 0, 0]));
        const lime = luma(getForestSpecies('S1-shore-broadleaf').crown);
        expect(Math.abs(mean('mosaic') - lime) / lime).toBeLessThan(0.12);
        expect(mean('deep')).toBeLessThan(mean('mosaic'));
    });
});
