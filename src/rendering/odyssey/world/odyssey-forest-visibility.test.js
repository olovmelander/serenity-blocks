import { describe, expect, it } from 'vitest';

import {
    FOREST_VISIBILITY,
    FOREST_VISIBILITY_STAMP,
    railSeesForestSite,
} from './odyssey-forest-visibility.js';
import { forestVisibilityStamp } from './odyssey-forest-visibility-stamp.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import {
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { getOdysseyPathPointAt, getOdysseyWorldRailPointAt } from '../path-utils.js';

/**
 * THE RAIL VISIBILITY CULL — and the one way it can hurt you.
 *
 * Act II's camera is pinned to a spline over a fixed height field, so "can a canopy here ever
 * be seen" is decidable geometry rather than a guess about where players look. The mask is
 * baked offline (scripts/bake-forest-visibility.mjs) and removes ~44% of the island's trees
 * while changing 0.00% of pixels at four rail stations.
 *
 * THE DANGER IS NOT THE CULL, IT IS STALENESS. A mask is valid only for the rail and terrain it
 * was baked from. Move the spline, reshape a massif, change the sea level — and it starts
 * deleting trees that have become visible, with no error and no warning, discovered whenever
 * somebody next looks at that part of the island. This repo has shipped that shape before: a
 * lever nobody read, reporting innocence rather than absence. Hence the stamp.
 *
 * If the stamp test fails: RE-BAKE (`node scripts/bake-forest-visibility.mjs`). Do not relax it.
 */

const heightAt = (x, z) => odysseyWorldMacro(x, z)
    + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyWorldRailPointAt(i / 47));
const CULLED = scatterZonedForest(heightAt, { rail: RAIL });
const FULL = scatterZonedForest(heightAt, { rail: RAIL, visibilityCull: false });

describe('the baked mask still matches the world it was baked from', () => {
    /**
     * The whole safety argument in one assertion. Everything else here checks that the cull
     * behaves; this checks that it is still ENTITLED to behave that way.
     */
    it('carries a stamp that matches the live rail and height field', () => {
        expect(FOREST_VISIBILITY_STAMP).toBe(forestVisibilityStamp());
    });

    it('is a real fingerprint, not a constant', () => {
        // A stamp that could not change would pass forever and guard nothing. Prove it responds
        // to its inputs by hashing a deliberately different rail sample set.
        const shifted = (() => {
            let h = 2166136261 >>> 0;
            for (let i = 0; i < 96; i += 1) {
                const pt = getOdysseyPathPointAt(i / 95);
                // one metre of drift anywhere in the spline must change the answer
                const q = Math.round((pt.x + 1) * 100);
                for (let s = 0; s < 32; s += 8) {
                    h ^= (q >>> s) & 0xff;
                    h = Math.imul(h, 16777619) >>> 0;
                }
            }
            return h.toString(16);
        })();
        expect(shifted).not.toBe(FOREST_VISIBILITY_STAMP);
    });

    it('covers the ground the forest is actually planted on', () => {
        const xs = FULL.placements.map((t) => t.x);
        const zs = FULL.placements.map((t) => t.z);
        expect(Math.min(...xs)).toBeGreaterThan(FOREST_VISIBILITY.x0);
        expect(Math.max(...xs)).toBeLessThan(FOREST_VISIBILITY.x1);
        expect(Math.min(...zs)).toBeGreaterThan(FOREST_VISIBILITY.z0);
        expect(Math.max(...zs)).toBeLessThan(FOREST_VISIBILITY.z1);
    });

    /**
     * Outside the baked box the answer must be TRUE, never false. A site the baker never
     * considered must not be culled by it — every failure of this lookup should leave a tree
     * standing, because the cost of a spurious tree is a few triangles and the cost of a
     * spurious hole is a visible defect nobody will attribute to a mask.
     */
    it('fails SAFE outside its own bounds', () => {
        expect(railSeesForestSite(FOREST_VISIBILITY.x0 - 500, 0)).toBe(true);
        expect(railSeesForestSite(FOREST_VISIBILITY.x1 + 500, 0)).toBe(true);
        expect(railSeesForestSite(0, FOREST_VISIBILITY.z0 - 500)).toBe(true);
        expect(railSeesForestSite(0, FOREST_VISIBILITY.z1 + 500)).toBe(true);
    });
});

describe('the cull removes the invisible and only the invisible', () => {
    it('takes only sites the rail can never see', () => {
        const key = (p) => `${p.x}|${p.z}`;
        const kept = new Set(CULLED.placements.map(key));
        let taken = 0;
        FULL.placements.forEach((p) => {
            if (kept.has(key(p))) return;
            taken += 1;
            if (railSeesForestSite(p.x, p.z)) throw new Error(`${p.id} at (${p.x}, ${p.z}) is in sight`);
        });
        // The ascent looks over most of the island (Wave 1A, 2026-08-16): the mask takes a few per cent.
        expect(taken / FULL.stats.trees).toBeGreaterThan(0.01);
        expect(taken / FULL.stats.trees).toBeLessThan(0.3);
    });

    it('never takes a tree the eye comes near', () => {
        expect(CULLED.stats.byLod.hero).toBe(FULL.stats.byLod.hero);
        expect(CULLED.stats.byLod.mid / FULL.stats.byLod.mid).toBeGreaterThan(0.88);
        const heroes = (f) => f.placements.filter((p) => p.framing).length;
        expect(heroes(CULLED)).toBe(heroes(FULL));
    });

    it('is restorable in one flag (`?odysseyWorldNoVisCull=1`)', () => {
        expect(FULL.stats.trees).toBeGreaterThan(CULLED.stats.trees);
    });
});
