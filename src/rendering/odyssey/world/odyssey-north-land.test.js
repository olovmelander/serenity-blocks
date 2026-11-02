import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_NORTH_BEACH,
    ODYSSEY_NORTH_BEACH_FRAME,
    ODYSSEY_NORTH_LAKE,
    ODYSSEY_SEA_LEVEL,
    odysseyNorthBeachAt,
    odysseyNorthBeachWeight,
    odysseyNorthLakeRn,
    odysseyWorldDetailWeight,
    odysseyWorldHeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import {
    FOREST_PINE_GROVES, forestPineGroveValue, scatterZonedForest, siteOnNorthBeach,
} from './odyssey-forest-scatter.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

// The land behind the mountain (2026-11-02): the north beach and the plain's swells and groves.

const B = ODYSSEY_NORTH_BEACH;
const F = ODYSSEY_NORTH_BEACH_FRAME;
/** A world point in the bay's frame: `un` along the chord (-1..1 between the horns), `s` inland. */
function bayPoint(un, s) {
    const u = un * F.halfChord;
    const v = s + (B.bite * (1 - (un * un)));
    return [F.mx + (F.tx * u) + (F.nx * v), F.mz + (F.tz * u) + (F.nz * v)];
}
function slopeAt(x, z) {
    const e = 3;
    return Math.hypot(
        (odysseyWorldHeight(x + e, z) - odysseyWorldHeight(x - e, z)) / (2 * e),
        (odysseyWorldHeight(x, z + e) - odysseyWorldHeight(x, z - e)) / (2 * e),
    );
}

describe('the north beach', () => {
    it('has a wide, gently shelving beach of sand-height ground between the horns', () => {
        let worst = 0;
        for (let un = -0.7; un <= 0.7; un += 0.05) {
            for (let s = 10; s <= B.beach - 10; s += 5) {
                const [x, z] = bayPoint(un, s);
                const h = odysseyWorldHeight(x, z) - ODYSSEY_SEA_LEVEL;
                expect(h, `beach height at un ${un.toFixed(2)} s ${s}`).toBeGreaterThan(-0.5);
                expect(h, `beach height at un ${un.toFixed(2)} s ${s}`).toBeLessThan(7);
                worst = Math.max(worst, slopeAt(x, z));
            }
        }
        // ~2 degrees on average; never steeper than ~7.
        expect(worst).toBeLessThan(0.12);
    });

    it('shelves gently out to sea, so the shallows exist', () => {
        for (let un = -0.6; un <= 0.6; un += 0.1) {
            let last = 0;
            for (let s = -20; s >= -B.shelf + 20; s -= 20) {
                const [x, z] = bayPoint(un, s);
                const depth = ODYSSEY_SEA_LEVEL - odysseyWorldHeight(x, z);
                expect(depth, `under water at s ${s}`).toBeGreaterThan(0);
                // deepening outward (a hair of tolerance for the half-percent relief left)
                expect(depth).toBeGreaterThan(last - 0.5);
                expect(slopeAt(x, z)).toBeLessThan(0.15);
                last = depth;
            }
            // 100 u out it is still shallow, and the shelf ends tens of metres deep.
            const [x1, z1] = bayPoint(un, -100);
            expect(ODYSSEY_SEA_LEVEL - odysseyWorldHeight(x1, z1)).toBeLessThan(10);
            const [x2, z2] = bayPoint(un, -B.shelf);
            expect(ODYSSEY_SEA_LEVEL - odysseyWorldHeight(x2, z2)).toBeGreaterThan(18);
        }
    });

    it('keeps its dunes low: above the beach, far below the plateau', () => {
        let top = -Infinity;
        for (let un = -0.7; un <= 0.7; un += 0.05) {
            for (let s = B.beach + 10; s <= B.duneBack; s += 5) {
                const [x, z] = bayPoint(un, s);
                const h = odysseyWorldHeight(x, z);
                expect(h).toBeGreaterThan(ODYSSEY_SEA_LEVEL + 2);
                top = Math.max(top, h);
            }
        }
        expect(top).toBeLessThan(ODYSSEY_SEA_LEVEL + 25);
        // The plateau behind (its pinned bare point) stands far above every dune.
        expect(top).toBeLessThan(odysseyWorldMacro(-700, -1900) - 50);
    });

    it('takes the relief off the beach, which would break a 2-degree slope', () => {
        const [x, z] = bayPoint(0, 60);
        expect(odysseyNorthBeachWeight(x, z)).toBe(1);
        expect(odysseyWorldDetailWeight(x, z)).toBeLessThan(0.01);
    });

    it('is compact: zero beyond the horns, far out at sea and far inland', () => {
        expect(odysseyNorthBeachAt(...bayPoint(B.hornOut + 0.01, 50))).toBeNull();
        expect(odysseyNorthBeachAt(...bayPoint(0, -B.shelfOut - 1))).toBeNull();
        expect(odysseyNorthBeachAt(...bayPoint(0, B.bankTo + 1))).toBeNull();
        // Inside the coast's own taper, so the sea past z = -3400 is untouched.
        for (let x = -1000; x <= 2000; x += 25) {
            expect(odysseyNorthBeachWeight(x, -3400)).toBe(0);
        }
        // ...and nowhere near the plateau pins, the lake or the rail.
        expect(odysseyNorthBeachWeight(-700, -1900)).toBe(0);
        expect(odysseyNorthBeachWeight(-220, -2400)).toBe(0);
        ODYSSEY_NORTH_LAKE.lobes.forEach((lb) => {
            expect(odysseyNorthBeachWeight(lb.x, lb.z)).toBe(0);
        });
    });

    it('stands no tree on the sand or the dunes', () => {
        for (let un = -0.7; un <= 0.7; un += 0.1) {
            for (let s = -10; s <= B.duneBack; s += 20) {
                expect(siteOnNorthBeach(...bayPoint(un, s))).toBe(true);
            }
        }
        const rail = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
        const { placements } = scatterZonedForest(odysseyWorldHeight, { rail, visibilityCull: false });
        const onBeach = placements.filter((p) => siteOnNorthBeach(p.x, p.z));
        expect(onBeach).toEqual([]);
    });
});

describe('the plain behind the mountain', () => {
    it('keeps the plateau pins exactly', () => {
        expect(odysseyWorldMacro(-700, -1900)).toBeCloseTo(372.8, 1);
        expect(odysseyWorldMacro(-220, -2400)).toBeCloseTo(385.0, 1);
    });

    it('keeps the lake in its bowl: every rim stays above the water', () => {
        const height = (x, z) => odysseyWorldMacro(x, z)
            + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
        let worst = Infinity;
        ODYSSEY_NORTH_LAKE.lobes.forEach((lb) => {
            for (let a = 0; a < 360; a += 3) {
                const x = lb.x + (Math.cos((a * Math.PI) / 180) * lb.rx);
                const z = lb.z + (Math.sin((a * Math.PI) / 180) * lb.rz);
                if (odysseyNorthLakeRn(x, z) < 1) continue;
                worst = Math.min(worst, height(x, z) - ODYSSEY_NORTH_LAKE.waterY);
            }
        });
        expect(worst).toBeGreaterThan(1);
    });

    it('has real swells and hollows north-east of the lake', () => {
        // Sampled over the plain the climb looks down on, clear of the lake and the bay.
        const hs = [];
        for (let x = 0; x <= 1050; x += 50) {
            for (let z = -1300; z >= -2350; z -= 50) {
                if (odysseyNorthLakeRn(x, z) < 1.3 || odysseyNorthBeachWeight(x, z) > 0) continue;
                hs.push(odysseyWorldMacro(x, z));
            }
        }
        hs.sort((a, b) => a - b);
        const spread = hs[Math.floor(hs.length * 0.95)] - hs[Math.floor(hs.length * 0.05)];
        expect(spread).toBeGreaterThan(25);
    });

    it('stands dark groves of conifer among the autumn trees, on the plain and far from the rail', () => {
        const rail = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
        const { placements } = scatterZonedForest(odysseyWorldHeight, { rail, visibilityCull: false });
        const grove = placements.filter((p) => p.pineGrove);
        expect(grove.length).toBeGreaterThan(200);
        grove.forEach((p) => {
            expect(p.speciesId).toBe(FOREST_PINE_GROVES.species);
            expect(forestPineGroveValue(p.x, p.z)).toBeLessThan(1);
            expect(p.z).toBeLessThan(FOREST_PINE_GROVES.plainZ[0]);
            // Nothing near the rail is touched: the groves are all on the far tier.
            expect(p.lod).toBe('far');
        });
    });
});
