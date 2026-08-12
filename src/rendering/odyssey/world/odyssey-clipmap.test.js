import { describe, expect, it } from 'vitest';

import {
    MORPH_END,
    buildOdysseyClipmap,
    morphEndCeiling,
    spacingForReach,
} from './odyssey-clipmap.js';

// The clipmap has two failure modes that produce NO error and NO warning: rings that crack
// because the morph runs past the overlap band, and bounds computed from the fake vertex data
// that make three cull the ground away. Both are cheap to assert and expensive to debug.

const LANE_A = {
    gridN: 128, levels: 9, baseSpacing: 1.6, holeShrink: 3,
};
const LANE_B = {
    gridN: 96, levels: 7, baseSpacing: 1.5, holeShrink: 2,
};

describe('the morph invariant', () => {
    it('is satisfied by both shipped lane configurations', () => {
        [LANE_A, LANE_B].forEach((cfg) => {
            expect(MORPH_END).toBeLessThanOrEqual(morphEndCeiling(cfg.gridN, cfg.holeShrink));
        });
    });

    it('THROWS rather than cracking silently when a config violates it', () => {
        // The obvious water configuration - a coarse lattice with the usual overlap - lands
        // at a ceiling of 0.75 against a morph end of 0.86, and would have torn.
        expect(morphEndCeiling(32, 2)).toBeCloseTo(0.75, 6);
        expect(() => buildOdysseyClipmap({
            gridN: 32, levels: 7, baseSpacing: 4, holeShrink: 2,
        })).toThrow(/crack/i);
    });

    it('accepts the corrected coarse configuration', () => {
        expect(morphEndCeiling(32, 1)).toBeCloseTo(0.875, 6);
        expect(() => buildOdysseyClipmap({
            gridN: 32, levels: 7, baseSpacing: 4, holeShrink: 1,
        })).not.toThrow();
    });

    it('rejects a gridN the lattice cannot be built from', () => {
        expect(() => buildOdysseyClipmap({ ...LANE_A, gridN: 30 })).toThrow(/multiple of 4/);
        expect(() => buildOdysseyClipmap({ ...LANE_A, levels: 0 })).toThrow(/positive integer/);
    });
});

describe('geometry', () => {
    it('carries no positions — only (gridIndex, ringLevel, gridIndex)', () => {
        const { geometry, gridN, levels } = buildOdysseyClipmap(LANE_B);
        const pos = geometry.attributes.position;
        expect(pos.count).toBe(levels * (gridN + 1) * (gridN + 1));
        // The Y channel is the ring level, never a height: it must be an integer in range.
        const seen = new Set();
        for (let i = 0; i < pos.count; i += 997) seen.add(pos.getY(i));
        seen.forEach((v) => {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(levels);
        });
        // And X/Z are lattice indices centred on zero, not world units.
        expect(pos.getX(0)).toBe(-gridN / 2);
        expect(pos.getZ(0)).toBe(-gridN / 2);
    });

    it('cuts a hole in every ring except level 0', () => {
        const solid = buildOdysseyClipmap({ ...LANE_B, levels: 1 });
        const nested = buildOdysseyClipmap({ ...LANE_B, levels: 2 });
        const ringTris = nested.triangles - solid.triangles;
        // A ring with a hole must carry FEWER triangles than the solid square it surrounds.
        expect(ringTris).toBeGreaterThan(0);
        expect(ringTris).toBeLessThan(solid.triangles);
    });

    it('assigns real bounds, not bounds derived from the fake vertex data', () => {
        const { geometry, reach } = buildOdysseyClipmap(LANE_A);
        // Left to itself three would compute a radius of ~113 grid units from (i, level, j).
        expect(geometry.boundingSphere.radius).toBeGreaterThan(reach);
        expect(geometry.boundingBox.max.x).toBeCloseTo(reach, 3);
        expect(geometry.boundingBox.min.y).toBeLessThan(0);
    });

    it('doubles reach per level for a fixed per-ring triangle cost', () => {
        // This is the property that made the plan's pre-baked far-range LUTs unnecessary:
        // measured, LEVELS 7 -> 10 took reach 6,554 -> 52,429 at byte-identical GPU time.
        const a = buildOdysseyClipmap({ ...LANE_B, levels: 7 });
        const b = buildOdysseyClipmap({ ...LANE_B, levels: 10 });
        expect(b.reach / a.reach).toBeCloseTo(8, 6);
        const perRingA = (a.triangles - 0) / a.levels;
        const perRingB = (b.triangles - 0) / b.levels;
        // Cost per ring is near-constant, so 8x the reach costs well under 2x the triangles.
        expect(perRingB / perRingA).toBeGreaterThan(0.9);
        expect(perRingB / perRingA).toBeLessThan(1.1);
        expect(b.triangles / a.triangles).toBeLessThan(1.6);
    });
});

describe('spacingForReach', () => {
    it('holds the horizon fixed while the lattice changes density', () => {
        const REACH = 26214.4;
        [64, 96, 128, 192].forEach((gridN) => {
            const baseSpacing = spacingForReach(REACH, gridN, 9);
            const built = buildOdysseyClipmap({
                gridN, levels: 9, baseSpacing, holeShrink: 1,
            });
            expect(built.reach).toBeCloseTo(REACH, 3);
        });
    });

    it('lets a coarser lane trade triangles for detail without moving the horizon', () => {
        const REACH = 26214.4;
        const fine = buildOdysseyClipmap({
            gridN: 128, levels: 9, holeShrink: 1, baseSpacing: spacingForReach(REACH, 128, 9),
        });
        const coarse = buildOdysseyClipmap({
            gridN: 64, levels: 9, holeShrink: 1, baseSpacing: spacingForReach(REACH, 64, 9),
        });
        expect(coarse.reach).toBeCloseTo(fine.reach, 3);
        expect(coarse.triangles).toBeLessThan(fine.triangles / 3);
    });
});
