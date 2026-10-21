/**
 * Spring — the waterfall's third pass: the splash plumes where the tongues land (spring-mist.js),
 * the spray bow (spring-light.js), the falling water's clumps (spring-fall.js) and the pool's boil
 * (spring-river.js). The shaders are judged by eye; these pin the tables they are built from.
 */
import { describe, expect, it } from 'vitest';
import { MIST_BOW, PUFF, mistLayout } from '../../src/themes/spring/spring-mist.js';
import { BOW } from '../../src/themes/spring/spring-light.js';
import { PACKET } from '../../src/themes/spring/spring-fall.js';
import { BOIL } from '../../src/themes/spring/spring-river.js';
import {
    FALL_FRAME, LANDINGS, POOL_Y, worldToFall,
} from '../../src/themes/spring/spring-fall-plan.js';

describe('spring waterfall: the splash where the tongues land', () => {
    const rows = mistLayout(600);
    const splashes = rows.filter((r) => r[9] === PUFF.splash);

    it('throws quick, crisp plumes up out of the pool where the water lands', () => {
        expect(splashes.length).toBeGreaterThan(60);
        const landed = LANDINGS.filter((row) => row.power > 0.05);
        const frame = {};
        for (const r of splashes) {
            // Born at the pool's surface, short-lived, opaque, and rising.
            expect(r[1]).toBeCloseTo(POOL_Y + 0.3, 6);
            expect(r[3]).toBeGreaterThan(1.2);
            expect(r[3]).toBeLessThan(2.3);
            expect(r[10]).toBeGreaterThan(0.29);
            expect(r[6]).toBeGreaterThan(0);
            // Each stands within a couple of metres of where some tongue lands.
            worldToFall(r[0], r[2], frame);
            const near = landed.some((row) => Math.abs(row.across - frame.across) < 1.6
                && frame.along > row.along - 0.1 && frame.along < row.along + 1.6);
            expect(near, `splash at across ${frame.across.toFixed(2)}`).toBe(true);
        }
    });

    it('keeps the rest of the cloud: feet, boil, bursts and the rapids\' spray', () => {
        for (const kind of [PUFF.foot, PUFF.boil, PUFF.ledge]) {
            expect(rows.some((r) => r[9] === kind), `kind ${kind}`).toBe(true);
        }
        expect(rows.length).toBe(600);
        expect(FALL_FRAME.halfWidth).toBeGreaterThan(0);
    });
});

describe('spring waterfall: the spray bow', () => {
    it('stands where a rainbow does: the primary inside the secondary, the band between dark', () => {
        expect(BOW.primary[0]).toBeGreaterThan(39);
        expect(BOW.primary[1]).toBeLessThan(43);
        expect(BOW.secondary[0]).toBeGreaterThan(BOW.primary[1] + 6);
        expect(BOW.secondary[1]).toBeLessThan(54);
        // The secondary is the fainter, and the bow is a share of the sun's light, not a glow.
        expect(BOW.second).toBeLessThan(0.5);
        expect(MIST_BOW).toBeGreaterThan(0);
        expect(MIST_BOW).toBeLessThan(0.6);
    });
});

describe('spring waterfall: the water', () => {
    it('breaks into clumps a column at a time, a clump or so a second', () => {
        expect(PACKET.width).toBeGreaterThan(0.3);
        expect(PACKET.width).toBeLessThan(2);
        expect(PACKET.rate[0]).toBeGreaterThan(0.3);
        expect(PACKET.rate[1]).toBeGreaterThan(PACKET.rate[0]);
        expect(PACKET.rate[1]).toBeLessThan(3);
    });

    it('heaps the pool where the tongues land, and lets the boil out downstream', () => {
        expect(BOIL.height).toBeGreaterThan(0.3);
        expect(BOIL.height).toBeLessThan(2);
        for (let k = 1; k < BOIL.reach.length; k++) expect(BOIL.reach[k]).toBeGreaterThan(BOIL.reach[k - 1]);
        // Full where the main tongue lands (about eight metres out from the lip).
        const main = LANDINGS.reduce((best, row) => (row.power > best.power ? row : best), LANDINGS[0]);
        expect(main.along).toBeGreaterThanOrEqual(BOIL.reach[0]);
        expect(main.along).toBeLessThanOrEqual(BOIL.reach[2]);
    });
});
