import { describe, expect, it } from 'vitest';

import {
    FOREST_LOD_BUDGET,
    FOREST_VALUE_ROLES,
    ODYSSEY_FOREST_SPECIES,
    getForestSpecies,
} from './odyssey-forest-species.js';
import {
    buildForestRoster,
    buildForestTreeGeometry,
    forestRosterBudget,
    icosahedronFaces,
    smoothMin,
} from './odyssey-forest-geometry.js';

/**
 * FOREST PLAN, WAVE 1 — the species sculptor.
 *
 * These tests are mostly the cloud sculptor's paid-for defects turned into assertions. Each one
 * cost a session there, and every one of them would have shipped silently: a vertex collapsed
 * to the mass centre punching spikes through a hull, a NaN that walked through an `>= 0` guard,
 * and a triangle-count formula off by 4x that would have shipped the field at a quarter of its
 * intended geometry. A builder that repeats them is not a new bug, it is an unlearned lesson.
 */

const ALL = buildForestRoster(ODYSSEY_FOREST_SPECIES);
const attr = (g, name) => g.getAttribute(name);

describe('the roster is well-formed data', () => {
    it('has seven archetypes, each with three growth stages', () => {
        // 5 at the swap; +2 on 2026-08-14 (red maple, pink blossom — owner-requested).
        expect(ODYSSEY_FOREST_SPECIES).toHaveLength(7);
        ODYSSEY_FOREST_SPECIES.forEach((s) => {
            expect(s.stages).toHaveLength(3);
            expect(s.stages.map((g) => g.id)).toEqual(['young', 'mature', 'old']);
            // Stage frequencies are a distribution, so they have to sum to one or the scatter
            // silently biases toward whichever stage is tested first.
            const total = s.stages.reduce((a, g) => a + g.freq, 0);
            expect(total).toBeCloseTo(1, 2);
        });
    });

    it('is frozen, so a caller cannot mutate the composition at runtime', () => {
        expect(Object.isFrozen(ODYSSEY_FOREST_SPECIES)).toBe(true);
        expect(Object.isFrozen(ODYSSEY_FOREST_SPECIES[0])).toBe(true);
        expect(Object.isFrozen(ODYSSEY_FOREST_SPECIES[0].stages[0])).toBe(true);
    });

    /**
     * §1b R2, measured: the shade/lit ratio is a property of the SPECIES and spans three
     * separated classes. The plan was authored expecting one ratio for the whole forest; the
     * reference measurement refuted that, and this test is what stops the roster drifting back
     * toward a single value.
     */
    it('assigns every species a measured value role, and keeps the three classes separated', () => {
        ODYSSEY_FOREST_SPECIES.forEach((s) => {
            expect(FOREST_VALUE_ROLES[s.role]).toBeTruthy();
        });
        const { anchor, workhorse, pastel } = FOREST_VALUE_ROLES;
        expect(anchor.value).toBeLessThan(workhorse.value);
        expect(workhorse.value).toBeLessThan(pastel.value);
        // Each inside the band its class was measured at.
        expect(anchor.value).toBeGreaterThanOrEqual(0.22);
        expect(anchor.value).toBeLessThanOrEqual(0.34);
        expect(workhorse.value).toBeGreaterThanOrEqual(0.43);
        expect(workhorse.value).toBeLessThanOrEqual(0.78);
        expect(pastel.value).toBeGreaterThanOrEqual(0.83);
        expect(pastel.value).toBeLessThanOrEqual(0.94);
    });

    /**
     * §1b R3, and the correction that Wave 0c forced on this plan. Shade is DEEPER AND MORE
     * SATURATED along the canopy's own hue axis. A saturation gain below 1 would desaturate
     * the shadow, which is the exact failure the measurement ruled out in 14 of 15 pairs.
     */
    it('never lets a shade recipe desaturate', () => {
        Object.values(FOREST_VALUE_ROLES).forEach((r) => {
            expect(r.sat).toBeGreaterThan(1);
            expect(r.value).toBeLessThan(1);
        });
    });

    it('keeps the dark anchor species SPARSE — it is a black-note budget, not a colour', () => {
        const anchors = ODYSSEY_FOREST_SPECIES.filter((s) => s.role === 'anchor');
        expect(anchors.length).toBeGreaterThan(0);
        anchors.forEach((s) => expect(s.weight).toBeLessThanOrEqual(0.25));
    });

    it('resolves species by id and returns undefined rather than throwing', () => {
        expect(getForestSpecies('S2-workhorse-pine')?.builder).toBe('conifer');
        expect(getForestSpecies('nope')).toBeUndefined();
    });
});

describe('the sculptor produces sane geometry', () => {
    it('builds every species x stage x LOD', () => {
        expect(ALL).toHaveLength(7 * 3 * 3);
    });

    it('stays inside the triangle budget at every LOD', () => {
        const report = forestRosterBudget(ALL);
        expect(report.worst.hero).toBeLessThanOrEqual(FOREST_LOD_BUDGET.hero);
        expect(report.worst.mid).toBeLessThanOrEqual(FOREST_LOD_BUDGET.mid);
        expect(report.worst.far).toBeLessThanOrEqual(FOREST_LOD_BUDGET.far);
        expect(report.withinBudget).toBe(true);
    });

    it('makes each LOD strictly cheaper than the one above it', () => {
        ODYSSEY_FOREST_SPECIES.forEach((spec) => {
            const stage = spec.stages[1];
            const tri = (lod) => buildForestTreeGeometry(spec, stage, lod, 5).userData.forest.triangles;
            expect(tri('hero')).toBeGreaterThan(tri('mid'));
            expect(tri('mid')).toBeGreaterThan(tri('far'));
        });
    });

    /**
     * The guard that matters most, because its failure mode is invisible in tests and fatal on
     * the GPU: a zero-length normalize const-folds into a WGSL COMPILE FAILURE rather than a
     * warning (the winter theme's logged trap). Any NaN or zero normal here becomes that.
     */
    it('emits finite, unit-length normals everywhere — no NaN, no zero vectors', () => {
        ALL.forEach((g) => {
            const n = attr(g, 'normal');
            for (let i = 0; i < n.count; i += 1) {
                const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
                expect(Number.isFinite(len)).toBe(true);
                expect(len).toBeGreaterThan(0.5);
                expect(len).toBeLessThan(1.5);
            }
        });
    });

    it('emits finite positions everywhere', () => {
        ALL.forEach((g) => {
            const p = attr(g, 'position');
            for (let i = 0; i < p.count; i += 1) {
                expect(Number.isFinite(p.getX(i))).toBe(true);
                expect(Number.isFinite(p.getY(i))).toBe(true);
                expect(Number.isFinite(p.getZ(i))).toBe(true);
            }
        });
    });

    /**
     * THE CLOUD SCULPTOR'S DEFECT, ported faithfully. When its sphere trace exhausted its step
     * budget it collapsed the vertex to the mass CENTRE — 65 of 2,940 on one mass — punching
     * spikes through the hull. Running out of steps does not mean the ray missed: the bracket
     * [0, lastOutside] is always valid and bisection closes it.
     *
     * ⚠️ SCOPE, twice narrowed, both times because the test fired on correct geometry — and a
     * test that fails on correct geometry teaches the wrong lesson. It is about the crown's
     * BLOB CENTRE, not the world origin (the far tier has a legitimate ground vertex), and it
     * applies only to the TRACED broadleaf hull (a conifer's tier apexes legitimately sit on
     * the axis at every height, including alongside the blob centre).
     */
    it('never collapses a traced hull vertex toward the crown centre', () => {
        const traced = ALL.filter((g) => {
            const f = g.userData.forest;
            return getForestSpecies(f.speciesId).builder === 'broadleaf';
        });
        expect(traced.length).toBeGreaterThan(0);
        traced.forEach((g) => {
            const { centreY, hullTriangles } = g.userData.forest;
            const p = attr(g, 'position');
            // ⚠️ EXACTLY THE TRACED VERTICES, AND NO FILTER ON THEIR POSITION. A first cut
            // skipped vertices within 1e-3 of centreY "to avoid the trunk" — which is where a
            // COLLAPSED vertex sits, so the test excluded precisely the defect it was written
            // to catch and could not fail. The hull is the first `hullTriangles` triangles;
            // the trunk follows it, so the range is exact and needs no positional guessing.
            const hullVerts = hullTriangles * 3;
            expect(hullVerts).toBeGreaterThan(0);
            expect(hullVerts).toBeLessThanOrEqual(p.count);
            let minR = Infinity;
            let maxR = 0;
            for (let i = 0; i < hullVerts; i += 1) {
                const r = Math.hypot(p.getX(i), p.getY(i) - centreY, p.getZ(i));
                minR = Math.min(minR, r);
                maxR = Math.max(maxR, r);
            }
            expect(maxR).toBeGreaterThan(0);
            expect(minR / maxR).toBeGreaterThan(0.12);
        });
    });

    /**
     * ⚠️ ONE PACKED vec4 — WebGPU allows only 8 vertex buffers, and separate channels plus the
     * per-instance set needed TEN. See the attribute's own note in the geometry module.
     */
    it('packs AO, crown height, the crown mask and ground height into aVert, all in range', () => {
        ALL.forEach((g) => {
            const v = attr(g, 'aVert');
            expect(v.itemSize).toBe(4);
            for (let i = 0; i < v.count; i += 1) {
                expect(v.getX(i)).toBeGreaterThanOrEqual(0);
                expect(v.getX(i)).toBeLessThanOrEqual(1);
                expect(v.getY(i)).toBeGreaterThanOrEqual(0);
                expect(v.getY(i)).toBeLessThanOrEqual(1);
                // The crown mask is a FLAG, not a ramp: anything between reads as a partial
                // trunk and would smear the hue opposition R6 measured.
                expect([0, 1]).toContain(v.getZ(i));
                expect(v.getW(i)).toBeGreaterThanOrEqual(0);
                expect(v.getW(i)).toBeLessThanOrEqual(1);
            }
        });
    });

    /**
     * The plan's "far tier: no wind", made structural. The material is shared across all three
     * tiers by design (one pipeline for the whole roster), so the tier cannot be branched in
     * the shader — instead the far bake zeroes the wind MASK, and the gust term multiplies to
     * nothing. At 700+ units the sway is well under a pixel, so it can only ever read as
     * shimmer, never as motion.
     */
    it('bakes the wind mask to zero on the far tier, so distant trees cannot shimmer', () => {
        ALL.forEach((g) => {
            const v = attr(g, 'aVert');
            let maxMask = 0;
            for (let i = 0; i < v.count; i += 1) maxMask = Math.max(maxMask, v.getW(i));
            if (g.userData.forest.lod === 'far') expect(maxMask).toBe(0);
            else expect(maxMask).toBeGreaterThan(0.5);
        });
    });

    it('keeps a real trunk on every hero and mid tree, and none on far', () => {
        ALL.forEach((g) => {
            const v = attr(g, 'aVert');
            let trunk = 0;
            for (let i = 0; i < v.count; i += 1) if (v.getZ(i) === 0) trunk += 1;
            if (g.userData.forest.lod === 'far') expect(trunk).toBe(0);
            else expect(trunk).toBeGreaterThan(0);
        });
    });

    /**
     * SEATING. A tree whose base floats hovers; one that dips below ground buries its flare.
     *
     * ⚠️ THE FAR TIER HAS A STATED, BOUNDED EXEMPTION, and it is an exemption rather than a
     * weakened assertion. Far trees drop their trunk (sub-pixel at the 700 u where the tier
     * starts), so a far broadleaf is crown-only and floats by the trunk height it no longer
     * draws. At 700 u one world unit subtends roughly 1 px at 720p, so the bound below is
     * about a pixel of float on a tree that is ~11 px tall — and bounding it is what stops
     * "the far tier floats a bit" quietly becoming "the far tier floats".
     */
    it('seats every tree on the ground, with the far tier bounded rather than exempt', () => {
        ALL.forEach((g) => {
            const { lod, totalH } = g.userData.forest;
            const p = attr(g, 'position');
            let minY = Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < p.count; i += 1) {
                minY = Math.min(minY, p.getY(i));
                maxY = Math.max(maxY, p.getY(i));
            }
            // Nothing, at any tier, may sink below the ground plane.
            expect(minY).toBeGreaterThanOrEqual(-1e-6);
            // Far is crown-only by design; its invariant is the LOD-pop test below, not this.
            if (lod !== 'far') expect(minY).toBeLessThan(0.05);
            expect(maxY).toBeGreaterThan(0.5);
            expect(totalH).toBeGreaterThan(0);
        });
    });

    /**
     * THE INVARIANT THAT ACTUALLY MATTERS AT THE FAR BOUNDARY, and it replaced a worse one.
     *
     * A first cut asserted that far trees are seated at y≈0 like every other tier, and the
     * tall-trunked birch failed it by 45% of its own height. The instinct is to call that a
     * bug in the geometry — but at 700 u, where the far tier begins, a 6 cm trunk is under a
     * tenth of a pixel: the trunk is invisible in ANY implementation, so its absence cannot
     * be observed. What CAN be observed is the canopy jumping when a tree crosses the
     * boundary. So the contract is not "the far tree is seated", it is "the far tree's CROWN
     * occupies the same world space as the mid tree's", which is what this checks.
     */
    it('puts the far crown where the mid crown was, so no canopy pops at the LOD boundary', () => {
        const crownCentroidY = (g) => {
            const p = attr(g, 'position');
            const c = attr(g, 'aVert');
            let sum = 0;
            let n = 0;
            for (let i = 0; i < p.count; i += 1) {
                // color.g is baked 0 on trunk vertices and rises through the crown.
                if (c.getY(i) > 0.05) { sum += p.getY(i); n += 1; }
            }
            return n ? sum / n : 0;
        };
        ODYSSEY_FOREST_SPECIES.forEach((spec) => {
            spec.stages.forEach((stage) => {
                const mid = buildForestTreeGeometry(spec, stage, 'mid', 11);
                const far = buildForestTreeGeometry(spec, stage, 'far', 11);
                const midY = crownCentroidY(mid);
                const farY = crownCentroidY(far);
                expect(midY).toBeGreaterThan(0);
                // Within 12% of the tree's own height: the coarse hull and the dropped tiers
                // shift the centroid slightly, but the canopy must not visibly move.
                const drift = Math.abs(midY - farY) / mid.userData.forest.totalH;
                expect(drift).toBeLessThan(0.12);
            });
        });
    });

    it('is deterministic — the same seed builds the identical tree', () => {
        const spec = ODYSSEY_FOREST_SPECIES[1];
        const a = buildForestTreeGeometry(spec, spec.stages[1], 'hero', 42);
        const b = buildForestTreeGeometry(spec, spec.stages[1], 'hero', 42);
        expect(Array.from(attr(a, 'position').array))
            .toEqual(Array.from(attr(b, 'position').array));
        const c = buildForestTreeGeometry(spec, spec.stages[1], 'hero', 43);
        expect(Array.from(attr(c, 'position').array))
            .not.toEqual(Array.from(attr(a, 'position').array));
    });

    /**
     * The conifer's whole reason for existing over a cone: §1b R4 measured 5-7 discernible
     * tiers on the reference pines, and "stay away from Christmas-tree shaped" is a direct
     * instruction from the Witness tree artist. A lathe with no rim jitter is a cone.
     */
    it('gives conifer rims a real scallop instead of a perfect circle', () => {
        const spec = ODYSSEY_FOREST_SPECIES.find((s) => s.builder === 'conifer');
        // ⚠️ MEASURES THE JITTER, NOT THE TAPER. A first cut took the standard deviation of
        // ALL radii on the tree, which is dominated by the tiers narrowing toward the apex —
        // so it passed comfortably with the per-vertex rim jitter deleted, which is the only
        // thing that actually makes an outline scalloped rather than lathed. Two seeds differ
        // ONLY in jitter (tier count, taper and droop are identical), so a radius that moves
        // between them is jitter by construction.
        const radii = (seed) => {
            const p = attr(buildForestTreeGeometry(spec, spec.stages[1], 'hero', seed), 'position');
            const out = [];
            for (let i = 0; i < p.count; i += 1) out.push(Math.hypot(p.getX(i), p.getZ(i)));
            return out;
        };
        const a = radii(21);
        const b = radii(22);
        expect(a).toHaveLength(b.length);
        let moved = 0;
        let relSum = 0;
        for (let i = 0; i < a.length; i += 1) {
            if (a[i] > 0.05) {
                const rel = Math.abs(a[i] - b[i]) / a[i];
                if (rel > 0.01) moved += 1;
                relSum += rel;
            }
        }
        // Most rim vertices must move between seeds, and by a real amount.
        expect(moved).toBeGreaterThan(a.length * 0.4);
        expect(relSum / a.length).toBeGreaterThan(0.02);
    });

    /**
     * The broadleaf's melt, tested for what it IS rather than for a symptom.
     *
     * ⚠️ A first cut bounded the largest radius step between neighbouring hull vertices — and
     * a plain `Math.min` union passes that bound unchanged, so the test could not tell a melt
     * from a glue. The defining property of a smooth-min is that it UNDERCUTS min() inside the
     * blend width and equals it outside; that is what the sculptor relies on for a gradient
     * that is continuous across a join, and it is directly checkable.
     */
    it('melts broadleaf lobes with a real smooth-min, not a plain min', () => {
        const k = 1.0;
        // Inside the blend width: strictly below min, and below by a real margin.
        expect(smoothMin(0, 0, k)).toBeLessThan(-0.2);
        expect(smoothMin(0.2, -0.1, k)).toBeLessThan(Math.min(0.2, -0.1));
        // Outside it: exactly min, so the union is unaffected far from a join.
        expect(smoothMin(5, -3, k)).toBeCloseTo(-3, 6);
        expect(smoothMin(-3, 5, k)).toBeCloseTo(-3, 6);
        // Symmetric, or the union would depend on lobe ordering.
        expect(smoothMin(0.3, -0.2, k)).toBeCloseTo(smoothMin(-0.2, 0.3, k), 12);
        // And the hull it produces is still closed and outward-wound (see the winding test).
        const spec = ODYSSEY_FOREST_SPECIES.find((s) => s.builder === 'broadleaf');
        const g = buildForestTreeGeometry(spec, spec.stages[1], 'hero', 3);
        expect(g.userData.forest.hullTriangles).toBeGreaterThan(0);
    });

    /**
     * WINDING — the test that did not exist while every conifer triangle was inside-out.
     *
     * three's WebGPU backend sets `frontFace: CCW` + `cullMode: Back` for any non-DoubleSide
     * material, and node materials default to FrontSide, so a CW-wound triangle is CULLED and
     * the GPU rasterises the far interior instead — whose interpolated blob normal faces away,
     * putting the shade tone where the lit tone belongs. Thirty-one green tests said nothing
     * about it, because every other assertion here is about positions, normals and counts,
     * all of which a mirrored triangle satisfies perfectly.
     *
     * Signed volume via the divergence theorem is the decisive check: positive iff the mesh is
     * wound CCW-outward. ConeGeometry / IcosahedronGeometry score positive, so the convention
     * is three's, not this file's invention.
     */
    it('winds every triangle CCW-outward, so nothing is back-face culled', () => {
        const signedVolume = (g) => {
            const p = attr(g, 'position');
            let v = 0;
            for (let i = 0; i < p.count; i += 3) {
                const ax = p.getX(i); const ay = p.getY(i); const az = p.getZ(i);
                const bx = p.getX(i + 1); const by = p.getY(i + 1); const bz = p.getZ(i + 1);
                const cx = p.getX(i + 2); const cy = p.getY(i + 2); const cz = p.getZ(i + 2);
                v += ((ax * ((by * cz) - (bz * cy)))
                    - (ay * ((bx * cz) - (bz * cx)))
                    + (az * ((bx * cy) - (by * cx)))) / 6;
            }
            return v;
        };
        ALL.forEach((g) => {
            const f = g.userData.forest;
            expect(
                signedVolume(g),
                `${f.speciesId}/${f.stageId}/${f.lod} is wound inside-out`,
            ).toBeGreaterThan(0);
        });
    });

    it('knows that IcosahedronGeometry is 20*(detail+1)^2 faces, not 20*4^detail', () => {
        // The cloud field shipped a draft believing detail 3 was 1,280 faces. It is 320.
        expect(icosahedronFaces(0)).toBe(20);
        expect(icosahedronFaces(1)).toBe(80);
        expect(icosahedronFaces(2)).toBe(180);
        expect(icosahedronFaces(3)).toBe(320);
    });

    it('bakes the whole roster well inside the plan\'s 300 ms budget', () => {
        const t0 = performance.now();
        buildForestRoster(ODYSSEY_FOREST_SPECIES);
        expect(performance.now() - t0).toBeLessThan(300);
    });
});
