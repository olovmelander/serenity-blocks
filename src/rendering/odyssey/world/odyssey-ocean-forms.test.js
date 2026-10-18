import { describe, expect, it } from 'vitest';
import {
    OCEAN_FORMS, buildKelpGeometry, buildSpireGeometry, planOceanForms,
} from './odyssey-ocean-forms.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from './odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

/** The open-water rail the world renderer seeds life from: under the surface, above the bed. */
function openWaterRail() {
    const rail = [];
    for (let i = 0; i < 47; i += 1) {
        const a = getOdysseyPathPointAt(i / 47);
        const b = getOdysseyPathPointAt((i + 1) / 47);
        for (let k = 0; k < 8; k += 1) {
            const t = k / 8;
            const p = { x: a.x + ((b.x - a.x) * t), y: a.y + ((b.y - a.y) * t), z: a.z + ((b.z - a.z) * t) };
            if (p.y < ODYSSEY_SEA_LEVEL - 6 && p.y > odysseyWorldHeight(p.x, p.z) + 2) rail.push(p);
        }
    }
    return rail;
}

describe("chapter 2's open water", () => {
    const rail = openWaterRail();
    const plan = planOceanForms({ heightAt: odysseyWorldHeight, rail, seaLevel: ODYSSEY_SEA_LEVEL });

    it('stands spires in the deep bowl and kelp on the shelf, the same every time', () => {
        expect(plan.spires).toHaveLength(OCEAN_FORMS.spires);
        expect(plan.kelp.length).toBeGreaterThan(120);
        const again = planOceanForms({ heightAt: odysseyWorldHeight, rail, seaLevel: ODYSSEY_SEA_LEVEL });
        expect(again).toEqual(plan);
    });

    it('keeps the rail, the orbs and their close-ups clear', () => {
        const clearance = (f) => Math.min(...rail.map((p) => Math.hypot(p.x - f.x, p.z - f.z)));
        plan.spires.forEach((s) => expect(clearance(s)).toBeGreaterThan(OCEAN_FORMS.corridor + s.radius));
        plan.kelp.forEach((k) => expect(clearance(k)).toBeGreaterThan(OCEAN_FORMS.corridor - 0.5));
    });

    it('stops every spire and frond under the surface, standing on the drawn bed', () => {
        plan.spires.forEach((s) => {
            expect(s.y + s.height).toBeLessThan(ODYSSEY_SEA_LEVEL - OCEAN_FORMS.spireHeadroom + 1);
            expect(s.y).toBeLessThan(odysseyWorldHeight(s.x, s.z));
        });
        plan.kelp.forEach((k) => {
            expect(k.y + k.height).toBeLessThan(ODYSSEY_SEA_LEVEL - 4);
            expect(k.y).toBeLessThanOrEqual(odysseyWorldHeight(k.x, k.z));
        });
    });

    it('plants half as much on the low tier, and nothing without a rail', () => {
        const low = planOceanForms({
            heightAt: odysseyWorldHeight, rail, seaLevel: ODYSSEY_SEA_LEVEL, quality: 'low',
        });
        expect(low.spires.length).toBe(Math.round(OCEAN_FORMS.spires * OCEAN_FORMS.lowShare));
        expect(low.kelp.length).toBeLessThan(plan.kelp.length);
        expect(planOceanForms({ heightAt: odysseyWorldHeight, rail: [], seaLevel: ODYSSEY_SEA_LEVEL }))
            .toEqual({ spires: [], kelp: [] });
    });

    it('builds a closed faceted spire and a tapering frond in unit space', () => {
        const spire = buildSpireGeometry();
        spire.computeBoundingBox();
        expect(spire.boundingBox.min.y).toBeCloseTo(0, 5);
        expect(spire.boundingBox.max.y).toBeCloseTo(1.08, 5);
        const frond = buildKelpGeometry();
        frond.computeBoundingBox();
        expect(frond.boundingBox.max.y).toBe(1);
        expect(frond.boundingBox.max.x).toBeCloseTo(0.5, 5);
    });
});
