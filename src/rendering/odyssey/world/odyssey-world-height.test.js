import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_MASSIFS,
    ODYSSEY_MASSIF_FOOT_Y,
    ODYSSEY_SEA_LEVEL,
    massifTerm,
    odysseyWaterDepth,
    odysseyWorldHeight,
    odysseyWorldMacro,
    smoothMax,
} from './odyssey-world-height.js';
import { getCanonicalMountainRangeWorldSpecs } from '../chapter-environments/shared/canonical-mountain-range.js';
import { getActiveOdysseyChapterPositions, getOdysseyPathPointAt } from '../path-utils.js';

// Act II's world is one surface. These guards hold it to two things it must not break:
// the compositions already validated in-game, and the rail the camera actually rides.

describe('the canonical peaks survive as terms in the height field', () => {
    // The user has explicitly praised the far-left flank and the Ch4 hero massif silhouette.
    // Moving to a height field must not quietly re-site them.
    const specs = getCanonicalMountainRangeWorldSpecs({ includeFarRange: true });

    it('carries one term per shipped canonical peak', () => {
        expect(ODYSSEY_MASSIFS).toHaveLength(specs.length);
    });

    it.each(specs.map((s) => [s.id, s]))('%s keeps its world position and crown', (_id, spec) => {
        const term = ODYSSEY_MASSIFS.find(
            (m) => Math.hypot(m.x - spec.worldPosition.x, m.z - spec.worldPosition.z) < 1,
        );
        expect(term).toBeTruthy();

        // Footprint radius must match the SHIPPED displaced extent (size * coneRadiusFrac),
        // not the plane the cone was drawn on — that difference is what made the old rim fade
        // eat 147u of standing mountain per side.
        expect(term.radius).toBeCloseTo(spec.size * 0.45, 0);

        // And the summit lands where the shipped crown does.
        const summit = odysseyWorldMacro(term.x, term.z);
        const shippedCrown = spec.worldPosition.y + spec.height;
        expect(Math.abs(summit - shippedCrown)).toBeLessThan(30);
    });

    it('puts the hero above every other peak, by a clear margin', () => {
        // The persistent landmark has to stay the landmark.
        const heights = ODYSSEY_MASSIFS.map((m) => ({
            id: m.id, y: odysseyWorldMacro(m.x, m.z),
        }));
        const hero = heights.find((h) => h.id === 'hero');
        heights.filter((h) => h.id !== 'hero').forEach((other) => {
            expect(hero.y).toBeGreaterThan(other.y + 250);
        });
    });
});

describe('peaks join rather than stack or crease', () => {
    it('smoothMax never exceeds the sum and never falls below the hard max', () => {
        for (let a = -100; a <= 100; a += 7) {
            for (let b = -100; b <= 100; b += 11) {
                const sm = smoothMax(a, b, 26);
                expect(sm).toBeGreaterThanOrEqual(Math.max(a, b) - 1e-9);
                expect(sm).toBeLessThanOrEqual(Math.max(a, b) + 26);
            }
        }
    });

    it('does not build a dome between two adjacent peaks', () => {
        // Summing cones is the classic mistake: the saddle between two peaks ends up HIGHER
        // than either shoulder, and the range reads as one lumpy mass.
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        const left = ODYSSEY_MASSIFS.find((m) => m.id === 'left-main');
        const midX = (hero.x + left.x) / 2;
        const midZ = (hero.z + left.z) / 2;
        const saddle = odysseyWorldMacro(midX, midZ);
        const summed = ODYSSEY_MASSIF_FOOT_Y
            + massifTerm(hero, midX, midZ) + massifTerm(left, midX, midZ);
        expect(saddle).toBeLessThan(summed);
        // The saddle must sit below the HIGHER summit. (Not the lower one: left-main's centre
        // is only 243u from the hero, well inside the hero's 603u footprint, so the midpoint
        // is genuinely still the hero's own flank and is legitimately above left-main's peak.
        // Asserting otherwise was testing a geometry these two peaks do not have.)
        expect(saddle).toBeLessThan(
            Math.max(odysseyWorldMacro(hero.x, hero.z), odysseyWorldMacro(left.x, left.z)),
        );
    });
});

describe('the rail clears the world', () => {
    // The single most dangerous failure of a height-field rebuild is the camera flying THROUGH
    // the ground. Replay the real spline across Act II and hold a clearance floor.
    const positions = getActiveOdysseyChapterPositions();
    const actStart = positions[1]; // ch2
    const actEnd = positions[5]; // ch6

    it('never puts terrain above the rail across Act II', () => {
        const breaches = [];
        for (let i = 0; i <= 400; i += 1) {
            const p = actStart + ((actEnd - actStart) * (i / 400));
            const pt = getOdysseyPathPointAt(p);
            const ground = odysseyWorldHeight(pt.x, pt.z);
            if (ground > pt.y) {
                breaches.push({ p: +p.toFixed(4), rail: +pt.y.toFixed(1), ground: +ground.toFixed(1) });
            }
        }
        expect(breaches).toEqual([]);
    });

    it('keeps a real clearance margin, not a hairline', () => {
        let worst = Infinity;
        let worstAt = null;
        for (let i = 0; i <= 400; i += 1) {
            const p = actStart + ((actEnd - actStart) * (i / 400));
            const pt = getOdysseyPathPointAt(p);
            const clearance = pt.y - odysseyWorldHeight(pt.x, pt.z);
            if (clearance < worst) { worst = clearance; worstAt = +p.toFixed(4); }
        }
        expect({ worst: +worst.toFixed(1), worstAt }).toMatchObject({ worstAt: expect.any(Number) });
        expect(worst).toBeGreaterThan(20);
    });
});

describe('the sea', () => {
    it('breaches at the chapter 2 to 3 boundary, not before or long after', () => {
        // The shipped build crosses the water surface at p ~0.192. The world must actually be
        // underwater before that and above it after, or the breach moment stops being a moment.
        const before = getOdysseyPathPointAt(0.16);
        const after = getOdysseyPathPointAt(0.24);
        expect(before.y).toBeLessThan(ODYSSEY_SEA_LEVEL);
        expect(after.y).toBeGreaterThan(ODYSSEY_SEA_LEVEL);
    });

    it('is genuinely deep offshore and genuinely dry on the massif', () => {
        expect(odysseyWaterDepth(2600, 1800)).toBeGreaterThan(60);
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        expect(odysseyWaterDepth(hero.x, hero.z)).toBeLessThan(-600);
    });

    it('has a shoreline — land and water both exist along the approach', () => {
        let wet = 0;
        let dry = 0;
        for (let x = -2200; x <= 1400; x += 60) {
            for (let z = 600; z >= -2200; z -= 60) {
                if (odysseyWaterDepth(x, z) > 0) wet += 1; else dry += 1;
            }
        }
        // Neither a drowned world nor a continent: both need to be a real fraction.
        expect(wet / (wet + dry)).toBeGreaterThan(0.15);
        expect(dry / (wet + dry)).toBeGreaterThan(0.15);
    });
});

describe('the field is well-behaved', () => {
    it('is finite and bounded everywhere the clipmap can reach', () => {
        for (let x = -6000; x <= 6000; x += 400) {
            for (let z = -6000; z <= 6000; z += 400) {
                const h = odysseyWorldHeight(x, z);
                expect(Number.isFinite(h)).toBe(true);
                expect(h).toBeGreaterThan(-500);
                expect(h).toBeLessThan(1600);
            }
        }
    });

    it('is continuous — no cliffs the mesh cannot represent', () => {
        // A clipmap samples at fixed spacing; a discontinuity between adjacent samples shows
        // as a tear. Hold the gradient below a slope the lattice can actually carry.
        let worstSlope = 0;
        const step = 6;
        for (let x = -2600; x <= 1600; x += 53) {
            for (let z = 400; z >= -2400; z -= 53) {
                const d = Math.abs(odysseyWorldHeight(x + step, z) - odysseyWorldHeight(x, z));
                worstSlope = Math.max(worstSlope, d / step);
            }
        }
        expect(worstSlope).toBeLessThan(4);
    });
});
