/**
 * Moonlit Greenhouse — the plan: the garden as numbers. Everything stands where it can (the beds,
 * the canal, over the paths, under the glass), the tiers grow it denser, it is the same garden for
 * the same seed, and the palms' crowns agree with the canopy's shadow.
 */
import { describe, expect, it } from 'vitest';
import {
    BEDS, URNS, palmCrownCentre, palmFrondAngle, planGarden,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-plan.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import {
    FLOOR, HOUSE, ribPositions, vaultHeightAt,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';

describe('moonlit greenhouse plan', () => {
    it('is the same garden for the same seed, and another for another', () => {
        const a = planGarden(QUALITY.High, 1861);
        const b = planGarden(QUALITY.High, 1861);
        const c = planGarden(QUALITY.High, 7);
        expect(b).toEqual(a);
        expect(c.palms[0]).not.toEqual(a.palms[0]);
    });

    it('grows what each tier asks for, densest at the top', () => {
        let lastPalms = 0;
        QUALITY_NAMES.forEach((name) => {
            const tier = QUALITY[name];
            const g = planGarden(tier);
            expect(g.palms).toHaveLength(tier.palms);
            expect(g.treeFerns).toHaveLength(tier.treeFerns);
            expect(g.bananas).toHaveLength(tier.bananas);
            expect(g.monsteras).toHaveLength(tier.monsteras);
            expect(g.groundFerns).toHaveLength(tier.groundFerns);
            expect(g.vines).toHaveLength(tier.vines);
            expect(g.baskets.length).toBeLessThanOrEqual(tier.baskets);
            expect(g.pads.length).toBeLessThanOrEqual(tier.pads);
            expect(g.pads.length).toBeGreaterThan(tier.pads * 0.6);
            expect(Math.abs(g.reeds.length - tier.reeds)).toBeLessThan(tier.reeds * 0.15);
            expect(g.palms.length).toBeGreaterThanOrEqual(lastPalms);
            lastPalms = g.palms.length;
        });
        expect(tierFor('nonsense')).toBe(QUALITY.High);
    });

    it('stands the iron under every rib and hangs the lanterns over the paths', () => {
        const g = planGarden(QUALITY.High);
        expect(g.ribs).toEqual(ribPositions());
        expect(g.columns).toHaveLength(g.ribs.length * 2);
        g.columns.forEach((c) => expect(Math.abs(c.x)).toBeLessThan(HOUSE.halfSpan));
        expect(g.lanterns.length).toBeGreaterThan(6);
        g.lanterns.forEach((l) => {
            expect(Math.abs(l.x)).toBeGreaterThan(FLOOR.canal.half);
            expect(Math.abs(l.x)).toBeLessThan(FLOOR.path.outer);
            expect(l.y).toBeGreaterThan(2.5);
            expect(l.top).toBeLessThan(vaultHeightAt(l.x));
            expect(l.top).toBeGreaterThan(l.y);
        });
    });

    it('keeps the plants in the beds, under the glass, and the palms apart', () => {
        const g = planGarden(QUALITY.Extreme);
        const inBeds = (p) => Math.abs(p.x) >= BEDS.inner - 0.4 && Math.abs(p.x) <= BEDS.outer + 0.1;
        [...g.palms, ...g.treeFerns, ...g.bananas, ...g.monsteras, ...g.groundFerns].forEach((p) => {
            expect(inBeds(p)).toBe(true);
            expect(p.z).toBeLessThan(BEDS.near + 1);
            expect(p.z).toBeGreaterThan(BEDS.far - 6);
        });
        g.palms.forEach((p, i) => {
            const top = palmCrownCentre(p);
            // The crown leans in toward the nave and stays under the vault.
            expect(Math.abs(top.x)).toBeLessThan(Math.abs(p.x));
            expect(top.y + 0.8).toBeLessThan(vaultHeightAt(top.x));
            for (let j = 0; j < i; j += 1) {
                const q = g.palms[j];
                if (Math.sign(q.x) === Math.sign(p.x)) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThan(1.5);
            }
        });
    });

    it('spreads each crown\'s fronds evenly round it, each a little off', () => {
        const palm = planGarden(QUALITY.High).palms[0];
        const step = (Math.PI * 2) / palm.fronds;
        for (let k = 0; k < palm.fronds; k += 1) {
            const a = palmFrondAngle(palm, k);
            const even = palm.twist + k * step;
            expect(Math.abs(a - even)).toBeLessThanOrEqual(0.12 + 1e-9);
        }
    });

    it('floats the pads on the canal without overlapping, and the reeds at its edges', () => {
        const g = planGarden(QUALITY.Extreme);
        expect(g.pads.filter((p) => p.kind === 'victoria').length).toBeGreaterThanOrEqual(2);
        g.pads.forEach((p, i) => {
            expect(Math.abs(p.x) + p.radius).toBeLessThan(FLOOR.canal.half);
            expect(p.z).toBeLessThan(FLOOR.canal.head);
            for (let j = 0; j < i; j += 1) {
                const q = g.pads[j];
                expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThan(q.radius + p.radius);
            }
        });
        g.reeds.forEach((r) => {
            expect(Math.abs(r.x)).toBeLessThan(FLOOR.canal.half);
            expect(Math.abs(r.x)).toBeGreaterThan(FLOOR.canal.half - 1);
            expect(r.height).toBeGreaterThan(0.5);
        });
    });

    it('stands an urn on each path beside the canal, in a lantern\'s pool', () => {
        expect(URNS).toHaveLength(2);
        expect(URNS[0].x).toBeLessThan(0);
        expect(URNS[1].x).toBeGreaterThan(0);
        const { lanterns } = planGarden(tierFor('Minimal'));
        URNS.forEach((u) => {
            // On the path: clear of the water, clear of the bed's kerb.
            expect(Math.abs(u.x) - u.radius).toBeGreaterThan(FLOOR.canal.half);
            expect(Math.abs(u.x) + u.radius).toBeLessThan(FLOOR.path.outer);
            expect(u.z).toBeLessThan(FLOOR.canal.head);
            const lamp = lanterns.filter((l) => Math.sign(l.x) === Math.sign(u.x))
                .reduce((a, l) => (Math.abs(l.z - u.z) < Math.abs(a.z - u.z) ? l : a));
            expect(Math.hypot(lamp.x - u.x, lamp.z - u.z)).toBeLessThan(1.5);
        });
    });
});
