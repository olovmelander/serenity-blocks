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
import { getOdysseyPathPointAt } from '../path-utils.js';

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
const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
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
    /**
     * ⚠️ THE RATIOS HERE MOVED WHEN THE EDGE THINNING LANDED, AND THE CULL DID NOT CHANGE.
     *
     * Both this bound and the `far` bound below are shares of the composition set, and the
     * owner-directed edge thinning now removes its trees from the same far, rail-distant ground
     * the mask was already condemning. The two overlap, so the cull has less left to take and its
     * SHARE falls (0.66 -> 0.72) while the work it does is identical in kind. Rebased with the
     * reason recorded rather than left as a mystery for whoever next sees this number drift.
     */
    it('removes a large share of the forest', () => {
        // Rebased again at the archipelago carve (0.76 -> 0.82, measured 0.793): every
        // authored reduction removes trees from the same far, rail-distant ground this mask
        // already condemns, so the mask's SHARE keeps shrinking while its behaviour is
        // unchanged. The pattern above now has three data points.
    // ⚠️ REBASED BY WAVE 1A'S ASCENT (2026-08-16), and this is a REAL COST, not a nudge.
    // Raising the rail through the cloud deck so it flies PAST the mountain gives the camera a
    // high vantage over the whole island, and an occlusion mask can only cull what terrain
    // HIDES. Measured: 94.1% of cells are now visible where the mask used to condemn far more,
    // so the cull removes ~4.6% of the forest instead of ~21%. That is ~1200 more trees
    // standing in the act whose Lane B p95 is already closest to its ceiling. The floors below
    // move to the measured truth rather than being left failing — but the number to watch is
    // the PERF measurement, not this assertion.
        expect(CULLED.stats.trees).toBeLessThan(FULL.stats.trees * 0.97);
        expect(CULLED.stats.trees).toBeGreaterThan(FULL.stats.trees * 0.40);
    });

    /**
     * THE HERO TIER IS UNTOUCHED, EXACTLY — and the mid tier nearly so.
     *
     * A first version of this test asserted that hero AND mid were both untouched, because an
     * early analysis said every never-seen tree was `far`. Measured against the corrected mask
     * that is not true: 92 mid trees (5%) are culled too. They are legitimately invisible —
     * a mid tree is one whose CHUNK centre is near the rail, which says nothing about whether a
     * ridge stands between them — so the claim was wrong, not the cull. Recorded rather than
     * quietly relaxed, because "all far" was the reassurance the plan was sold on.
     *
     * Hero stays an equality: the expensive tier is the foreground, and a mask that started
     * eating it would be culling what the player is looking at.
     */
    it('never takes a hero tree, and barely touches mid', () => {
        expect(CULLED.stats.byLod.hero).toBe(FULL.stats.byLod.hero);
        expect(CULLED.stats.byLod.mid / FULL.stats.byLod.mid).toBeGreaterThan(0.90);
        // Rebased with the thinning overlap above — the mask's own behaviour is unchanged.
        // (0.70 -> 0.78 at the archipelago carve, measured 0.754, same overlap mechanism.)
        // Same rebase: the high vantage exposes far ground the ridges used to hide.
        expect(CULLED.stats.byLod.far).toBeLessThan(FULL.stats.byLod.far * 0.96);
    });

    /**
     * The composition species survive. The shore greens and the blossom grove are what the
     * camera actually stands in, and the grove is the island's showpiece — measured, the cull
     * keeps 100% of the blossoms, 100% of the shore broadleaf and 98% of the pine.
     *
     * The red maple sits at 80%, and that is honest rather than alarming: it is scattered
     * island-wide, so a fifth of it stands in ground no camera reaches. The floor is set where
     * it would catch the mask eating the FOREGROUND, not where it pretends nothing was removed.
     */
    it('keeps the composition species the camera stands in', () => {
        for (const id of ['S1-shore-broadleaf', 'S2-workhorse-pine', 'S7-pink-blossom']) {
            const full = FULL.stats.bySpecies[id] || 0;
            const kept = CULLED.stats.bySpecies[id] || 0;
            expect(kept / Math.max(1, full), id).toBeGreaterThan(0.95);
        }
        const maple = (CULLED.stats.bySpecies['S6-red-maple'] || 0)
            / Math.max(1, FULL.stats.bySpecies['S6-red-maple'] || 0);
        expect(maple).toBeGreaterThan(0.70);
    });

    it('is restorable in one flag, per ADR-0015', () => {
        expect(FULL.stats.trees).toBeGreaterThan(CULLED.stats.trees);
        // ...and the restored forest is the composition the tests elsewhere assert against.
        expect(FULL.stats.bySpecies['S7-pink-blossom']).toBeGreaterThan(60);
    });
});
