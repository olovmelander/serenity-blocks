import { describe, expect, it } from 'vitest';
import { ODYSSEY_MASSIFS, ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from './odyssey-world-height.js';
import { ODYSSEY_VALLEY_MIST, bakeValleyMist, sampleValleyMist } from './odyssey-valley-mist.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

describe('mist in the hollows', () => {
    const t0 = Date.now();
    const plate = bakeValleyMist(odysseyWorldHeight, ODYSSEY_SEA_LEVEL);
    const ms = Date.now() - t0;

    it('bakes a finite plate, the top never under the ground, the pools never past their cap', () => {
        expect(plate.data.length).toBe(ODYSSEY_VALLEY_MIST.res * ODYSSEY_VALLEY_MIST.res * 4);
        for (let t = 0; t < plate.data.length; t += 4) {
            expect(Number.isFinite(plate.data[t])).toBe(true);
            expect(plate.data[t + 1]).toBeGreaterThanOrEqual(0);
            expect(plate.data[t + 1]).toBeLessThanOrEqual(ODYSSEY_VALLEY_MIST.maxDepth);
        }
    });

    it('holds no mist on the summit, and pools in the hollows the chapter 3-4 eye looks over', () => {
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        expect(sampleValleyMist(plate, hero.x, hero.z).depth).toBe(0);
        // Round the meadows' stretch of the rail, out to the hero's foot and the far forest.
        let pooled = 0;
        for (let p = 0.18; p <= 0.34; p += 0.02) {
            const pt = getOdysseyPathPointAt(p);
            for (let dx = -1500; dx <= 1500; dx += 100) {
                for (let dz = -1500; dz <= 1500; dz += 100) {
                    if (sampleValleyMist(plate, pt.x + dx, pt.z + dz).depth > 8) pooled += 1;
                }
            }
        }
        expect(pooled).toBeGreaterThan(100);
    });

    it('lays its pools on floors, not on the steep flanks', () => {
        // Rings round the hero's summit cone: no mist clings there (under a unit feathers in from
        // the floors, too thin to see). Its benches lower down, ~320 u out, may hold a little.
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        for (const r of [120, 220]) {
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
                const at = sampleValleyMist(plate, hero.x + (Math.cos(a) * r), hero.z + (Math.sin(a) * r));
                expect(at.depth).toBeLessThan(1);
            }
        }
    });

    it('bakes fast enough for the world build', () => {
        expect(ms).toBeLessThan(1500);
    });
});
