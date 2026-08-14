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
import { ODYSSEY_PEAK_SPECS, PEAK_CONE_RADIUS_FRAC } from './odyssey-peak-specs.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathPointAt,
} from '../path-utils.js';

// Act II's world is one surface. These guards hold it to two things it must not break:
// the compositions already validated in-game, and the rail the camera actually rides.

describe('the canonical peaks survive as terms in the height field', () => {
    // The user has explicitly praised the far-left flank and the Ch4 hero massif silhouette.
    // Moving to a height field must not quietly re-site them.
    //
    // SPEC-AUTHORITY FLIP (2026-08-12): expectations come from the WORLD's own frozen spec
    // table + the live path, not from the legacy diorama module. This is the test that used
    // to import chapter-environments — the truth direction it enforced pointed at code Wave
    // 4 deletes. Now ODYSSEY_MASSIFS (the pinned absolutes the bake needs) is verified
    // against ODYSSEY_PEAK_SPECS (offsets, the geometry authority) + the real chapter
    // centres, so a re-sited path or an edited offset fails HERE, world-side.
    const chapter3Center = getChapterPathRange(3).center;
    const chapter4Center = getChapterPathRange(4).center;
    const expected = ODYSSEY_PEAK_SPECS.map((peak) => ({
        id: peak.id,
        x: chapter4Center.x + peak.dx,
        z: chapter4Center.z + peak.dz,
        footY: chapter3Center.y + peak.footDy,
        radius: peak.size * PEAK_CONE_RADIUS_FRAC,
        height: peak.height,
    }));

    it('carries one term per shipped canonical peak', () => {
        expect(ODYSSEY_MASSIFS).toHaveLength(expected.length);
    });

    it.each(expected.map((s) => [s.id, s]))('%s keeps its world position and crown', (_id, spec) => {
        const term = ODYSSEY_MASSIFS.find(
            (m) => Math.hypot(m.x - spec.x, m.z - spec.z) < 1,
        );
        expect(term).toBeTruthy();

        // Footprint radius must match the SHIPPED displaced extent (size * coneRadiusFrac),
        // not the plane the cone was drawn on — that difference is what made the old rim fade
        // eat 147u of standing mountain per side.
        expect(term.radius).toBeCloseTo(spec.radius, 0);

        // The transcription's foot datum must agree with the authority's derivation.
        expect(term.footY).toBeCloseTo(spec.footY, 1);

        // And the summit lands where the shipped crown does.
        const summit = odysseyWorldMacro(term.x, term.z);
        const shippedCrown = spec.footY + spec.height;
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

describe('the landmass is an island', () => {
    // Before 2026-08-14 the shelf/inland ramps saturated past z=-900 and never came back
    // down: the "island" was an infinite peninsula running 26 km north at a constant 97.7 u
    // above sea level, and the owner photographed it from the layout editor. Worse than the
    // shape itself: the macro bake covers only ±4500 with ClampToEdgeWrapping, so any LAND
    // crossing the plate boundary is extruded to the lattice horizon by the sampler. These
    // guards hold the fix from both ends — the coast exists, and the boundary the clamp
    // extrudes is ocean everywhere.

    it('returns to open ocean north of the coast', () => {
        // The rail's northernmost point is z=-743.5 and the last massif halo dies at
        // z≈-2483, so everything past -3400 must be honestly underwater — including the
        // relief bake's worst case (±150 at the 0.16 base weight = ±24 u around the macro).
        for (let x = -4400; x <= 4400; x += 200) {
            for (let z = -3400; z >= -4400; z -= 200) {
                expect(
                    odysseyWorldHeight(x, z),
                    `expected open water at (${x}, ${z})`,
                ).toBeLessThan(ODYSSEY_SEA_LEVEL - 100);
            }
        }
    });

    it('keeps the entire baked-plate boundary underwater, so the edge clamp extrudes ocean', () => {
        // RELIEF_EXTENT is 9000 (renderer-side), so the plate boundary is the ±4500 square.
        // Every land sample here becomes a 21,700 u streak of land on the horizon.
        const HALF_PLATE = 4500;
        const offenders = [];
        for (let t = -HALF_PLATE; t <= HALF_PLATE; t += 90) {
            [[t, -HALF_PLATE], [t, HALF_PLATE], [-HALF_PLATE, t], [HALF_PLATE, t]].forEach(([x, z]) => {
                if (odysseyWorldHeight(x, z) >= ODYSSEY_SEA_LEVEL - 100) {
                    offenders.push({ x, z, h: +odysseyWorldHeight(x, z).toFixed(1) });
                }
            });
        }
        expect(offenders).toEqual([]);
    });

    it('did not eat the inhabited land — the interior heights are exactly the pre-coast field', () => {
        // The taper must be 1 (not 0.999) everywhere anything stands: the whole rail, every
        // massif footprint + relief halo, the tree disc (centre -620, radius 1750). All of
        // that lies south of z=-2483; assert the coast term cannot have touched it by
        // checking values that only hold if northT is exactly 1.
        expect(odysseyWorldMacro(-220, -1500)).toBeCloseTo(386.1, 1); // bare inland plateau
        expect(odysseyWorldMacro(-220, -2400)).toBeCloseTo(385.0, 1); // last land before the coast
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        expect(odysseyWorldMacro(hero.x, hero.z)).toBeGreaterThan(1000); // crown untouched
    });

    it('has a real north shore, not a cliff — the coast slope stays under the mesh bar', () => {
        // Same bar as the global continuity test (slope < 4), applied where the new taper
        // actually releases its 305 u.
        //
        // ⚠️ THE z STRIDE MUST EQUAL THE MEASUREMENT WINDOW. This test first advanced z by 47
        // while differencing over 6, so it inspected 132 u of the 987 u it iterates (13.4%)
        // and left 41 u blind between probes — and a cliff that lands in a gap is invisible.
        // MEASURED, on this exact loop: replacing the taper with a hard step
        // (`northT = z > -3000 ? 1 : 0`), a 305 u VERTICAL WALL, reported 0.3004 and PASSED.
        // Worse, 0.3004 is the same figure a FULL REVERT of the coast produces, at the same
        // point — proof the taper never entered the measurement at all. It also inverted the
        // test's sensitivity: a mild 100 u narrowing was caught at 4.33 while a severe 20 u
        // narrowing passed. Contiguous probes cost 7,348 iterations (~8 ms) and restore it:
        // the shipped coast measures 0.7882 (5x headroom), the wall 50.81, the 20 u taper
        // 22.00. Do not re-widen the stride to "speed this up".
        let worstSlope = 0;
        const step = 6;
        for (let x = -2400; x <= 1800; x += 97) {
            for (let z = -2500; z >= -3500; z -= step) {
                const d = Math.abs(odysseyWorldHeight(x, z + step) - odysseyWorldHeight(x, z));
                worstSlope = Math.max(worstSlope, d / step);
            }
        }
        expect(worstSlope).toBeLessThan(4);
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
