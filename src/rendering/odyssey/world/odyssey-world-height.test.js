import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_MASSIFS,
    ODYSSEY_MASSIF_FOOT_Y,
    ODYSSEY_NORTH_LAKE,
    ODYSSEY_SEA_LEVEL,
    massifTerm,
    odysseyNorthLakeRn,
    odysseyWaterDepth,
    odysseyWorldDetailWeight,
    odysseyWorldHeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
    smoothMax,
} from './odyssey-world-height.js';
import { ODYSSEY_PEAK_SPECS, PEAK_CONE_RADIUS_FRAC } from './odyssey-peak-specs.js';
import { deriveOdysseyChapterPositions } from '../../../core/odyssey/data/odyssey-layout.js';
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
        // The world must be underwater before the ch2->ch3 boundary and above it after, or
        // the breach stops being a moment.
        //
        // DERIVED, not hardcoded. This used to sample p=0.16 and p=0.24 around a boundary
        // that sat at 0.204. Wave 1A's ascent lengthened the journey 1767.65 -> 2276.62, so
        // every p re-normalised (the boundary is now ~0.159) and the literal 0.16 landed on
        // the wrong side of it. The breach is a fact about the BOUNDARY, so ask the layout
        // where the boundary is.
        const boundary = getChapterPathRange(3).start;
        const span = 0.04;
        const boundaryP = deriveOdysseyChapterPositions()[2];
        const before = getOdysseyPathPointAt(Math.max(0, boundaryP - span));
        const after = getOdysseyPathPointAt(Math.min(1, boundaryP + span));
        expect(boundary.y).toBeGreaterThan(0);
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
        // ⚠️ PIN RE-SITED (-220,-1500) -> (-700,-1900), DELIBERATELY (north-island, owner
        // direction 2026-08-16): the lake grew to rx 320 and its outer feather reaches the
        // old probe point. The new point is a PURER pin — outside every massif halo, every
        // hill and the lake, it is the bare pre-coast field to the digit
        // (80 + 305 x lateral(x=-700) = 372.8 exactly), so it guards the same claim with
        // less incidental coupling. It remains the lake/hill profiles' compactness guard.
        expect(odysseyWorldMacro(-700, -1900)).toBeCloseTo(372.8, 1); // bare inland plateau
        expect(odysseyWorldMacro(-220, -2400)).toBeCloseTo(385.0, 1); // last land before the coast
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        expect(odysseyWorldMacro(hero.x, hero.z)).toBeGreaterThan(1000); // crown untouched
    });

    /**
     * THE NORTH LAKE'S REAL CONTRACT — and why it is not "open water at every azimuth".
     *
     * The first version of this test walked each lobe's own ellipse and demanded water at
     * rn 0.4 and dry rim at rn 1.05. That is the shape of an ellipse sitting in a bowl,
     * and the lake stopped being one the moment the shore got its noise meander and the
     * body grew west into the massif's skirt: 13% of the disc interior is now dry MOUNTAIN
     * — the shoreline there is drawn by the mountainside, which is precisely the natural
     * form the owner asked for. A per-azimuth interior assertion fails on that and would
     * have to be "fixed" by flattening the mountain back out of the lake.
     *
     * So this asserts what the picture actually depends on:
     *   1. the paint never shows its own geometry — the disc edge is buried everywhere;
     *   2. the water is ONE body, not a chain of ponds;
     *   3. no isolated dry specks — the stipple a shoal at water level would produce;
     *   4. the body is the size the owner approved, within a band;
     *   5. the waterline MEANDERS — revert the shore noise and this fails.
     */
    it('holds the north lake: one body, buried paint, meandering shore, no stipple', () => {
        const L = ODYSSEY_NORTH_LAKE;
        const height = (x, z) => odysseyWorldMacro(x, z)
            + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));

        // 1. THE DISC EDGE IS BURIED. Each painted disc ends at raw rn = 1; where the
        // terrain there sits below the water plane the disc's own arc becomes the
        // waterline — a hard geometric edge (the owner reported exactly that, and it
        // measured -0.8 u before the banks went in). Points inside another lobe are
        // interior water, not outline, and are skipped.
        let worstBurial = Infinity;
        L.lobes.forEach((lb, li) => {
            for (let a = 0; a < 360; a += 6) {
                const x = lb.x + Math.cos((a * Math.PI) / 180) * lb.rx;
                const z = lb.z + Math.sin((a * Math.PI) / 180) * lb.rz;
                const insideOther = L.lobes.some((ob, oi) => {
                    if (oi === li) return false;
                    const ox = (x - ob.x) / ob.rx;
                    const oz = (z - ob.z) / ob.rz;
                    return Math.sqrt((ox * ox) + (oz * oz)) < 1;
                });
                if (insideOther) continue;
                worstBurial = Math.min(worstBurial, height(x, z) - L.waterY);
            }
        });
        expect(worstBurial, 'disc edge must sit under terrain at every outline azimuth')
            .toBeGreaterThan(1);

        // Rasterise the water once for 2-4: inside a disc AND under the water plane.
        const S = 10;
        const X0 = -700; const X1 = 900; const Z0 = -2300; const Z1 = -1000;
        const NX = Math.floor((X1 - X0) / S) + 1;
        const NZ = Math.floor((Z1 - Z0) / S) + 1;
        const inDisc = (x, z) => L.lobes.some((lb) => {
            const lx = (x - lb.x) / lb.rx;
            const lz = (z - lb.z) / lb.rz;
            return Math.sqrt((lx * lx) + (lz * lz)) <= 1;
        });
        const water = new Uint8Array(NX * NZ);
        for (let i = 0; i < NX; i += 1) {
            for (let j = 0; j < NZ; j += 1) {
                const x = X0 + (i * S); const z = Z0 + (j * S);
                water[(j * NX) + i] = (inDisc(x, z) && height(x, z) < L.waterY) ? 1 : 0;
            }
        }

        // 2. ONE BODY. A two-lobe union once read as TWO lakes because the neck stood
        // above water; the waist lobe fixed it, and this is the guard that keeps it fixed.
        const seen = new Uint8Array(NX * NZ);
        const sizes = [];
        for (let k = 0; k < NX * NZ; k += 1) {
            if (!water[k] || seen[k]) continue;
            let size = 0;
            const stack = [k];
            seen[k] = 1;
            while (stack.length) {
                const c = stack.pop();
                size += 1;
                const ci = c % NX;
                const cj = (c - ci) / NX;
                [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([da, db]) => {
                    const ni = ci + da; const nj = cj + db;
                    if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) return;
                    const nk = (nj * NX) + ni;
                    if (water[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
                });
            }
            sizes.push(size);
        }
        sizes.sort((a, b) => b - a);
        const totalWater = sizes.reduce((s, v) => s + v, 0);
        expect(sizes[0] / totalWater, 'the lake must be ONE connected body').toBeGreaterThan(0.98);

        // 3. NO STIPPLE: dry cells ringed by water are shoals at water level, which relief
        // turns into a scatter of specks across the surface.
        let specks = 0;
        for (let i = 1; i < NX - 1; i += 1) {
            for (let j = 1; j < NZ - 1; j += 1) {
                if (water[(j * NX) + i]) continue;
                let w = 0;
                for (let a = -1; a <= 1; a += 1) {
                    for (let b = -1; b <= 1; b += 1) {
                        if (a === 0 && b === 0) continue;
                        w += water[((j + b) * NX) + (i + a)];
                    }
                }
                if (w >= 7) specks += 1;
            }
        }
        expect(specks, 'isolated dry specks inside the water').toBe(0);

        // 4. SIZE, as a band around what the owner approved (228k u^2 for the bean, then
        // the sculpt pass measured 250k). Collapse and runaway both fail.
        const areaK = (totalWater * S * S) / 1000;
        expect(areaK).toBeGreaterThan(190);
        expect(areaK).toBeLessThan(320);

        // 5. THE SHORE MEANDERS — asserted on the METRIC, not on the picture.
        //
        // ⚠️ This was first written as "the waterline crossing radius varies across
        // azimuths", and a mutation check (delete the inset, re-run) showed it PASSED:
        // the body reaches into the massif's skirt, so the crossing radius varies plenty
        // from base terrain alone. The assertion that actually bites reads the lake
        // metric along a ring of CONSTANT raw ellipse radius: a pure ellipse returns the
        // same value at every azimuth, the meander returns a spread. Deleting
        // `northLakeShoreInset` now fails HERE, which is what a guard is for.
        const lb0 = L.lobes[0];
        const onRing = [];
        for (let a = 0; a < 360; a += 4) {
            const c = Math.cos((a * Math.PI) / 180); const s = Math.sin((a * Math.PI) / 180);
            const x = lb0.x + (c * lb0.rx * 0.9);
            const z = lb0.z + (s * lb0.rz * 0.9);
            // Only where lobe 0 is the nearest lobe, or the min() would read a sibling.
            const nearestIsLobe0 = L.lobes.every((ob, oi) => {
                if (oi === 0) return true;
                const ox = (x - ob.x) / ob.rx;
                const oz = (z - ob.z) / ob.rz;
                return Math.sqrt((ox * ox) + (oz * oz)) >= 0.9;
            });
            if (nearestIsLobe0) onRing.push(odysseyNorthLakeRn(x, z));
        }
        const metricSpread = Math.max(...onRing) - Math.min(...onRing);
        expect(metricSpread, 'lake metric must vary along a constant-radius ring')
            .toBeGreaterThan(0.08);
        // ...and that spread is real shoreline travel, not a rounding wobble.
        expect(metricSpread * lb0.rx, 'shoreline travel across azimuths (u)').toBeGreaterThan(30);
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
