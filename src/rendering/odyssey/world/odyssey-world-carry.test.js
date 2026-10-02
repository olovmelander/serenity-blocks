import { describe, expect, it } from 'vitest';

import {
    QUENCH_CYAN,
    QUENCH_EMBER,
    QUENCH_WHITE,
    SPRAY_CLIMB_RATE,
    SPRAY_LIFE_S,
    createOdysseyWorld,
    odysseyQuenchCarry,
    odysseySprayEnvelope,
} from './odyssey-world-renderer.js';
import { ODYSSEY_SEA_LEVEL } from './odyssey-world-height.js';

/**
 * THE SEAMLESS PASS'S TWO WORLD-SIDE SEAM CARRIES.
 *
 * 1->2 (embers become bubbles): `setQuenchCarry(t)` takes the steam quench's own seam clock and
 * drives the motes' bubble behaviour and the presence of ocean life. 2->3 (bubbles become spray):
 * the world fires a camera-relative burst when the EYE crosses sea level. Both are uniform-driven,
 * so what is pinned here is the CPU schedule — the part a refactor can silently change.
 */
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('odysseyQuenchCarry — the 1->2 carry schedule', () => {
    it('is the neutral ocean at the exit edge and for a missing value (no caller = today)', () => {
        [1, undefined, Number.NaN].forEach((t) => {
            const c = odysseyQuenchCarry(t);
            expect(c.carry).toBe(0);
            expect(c.bubble).toBe(0);
            expect(c.life).toBe(1);
        });
    });

    it('keeps ocean life out of the cavern side of the boundary', () => {
        [0, 0.1, 0.25, 0.4, 0.5].forEach((t) => {
            expect(odysseyQuenchCarry(t).life).toBe(0);
        });
    });

    it('brings life in only as the veil thins, monotonically, reaching full by the exit edge', () => {
        let prev = 0;
        for (let t = 0.5; t <= 1.0001; t += 0.02) {
            const { life } = odysseyQuenchCarry(t);
            expect(life).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = life;
        }
        expect(prev).toBe(1);
        // Still mostly absent just past the boundary, where the vapour is densest.
        expect(odysseyQuenchCarry(0.55).life).toBeLessThan(0.1);
    });

    it('walks the carried tint ember -> white -> cyan across the boundary', () => {
        const at = (t) => odysseyQuenchCarry(t).tint;
        expect(at(0.1).every((c, i) => near(c, QUENCH_EMBER[i]))).toBe(true);
        expect(at(0.5).every((c, i) => near(c, QUENCH_WHITE[i]))).toBe(true);
        expect(at(0.9).every((c, i) => near(c, QUENCH_CYAN[i]))).toBe(true);
    });

    it('carries the column hardest around the boundary and not at all far from it', () => {
        expect(odysseyQuenchCarry(0.05).carry).toBe(0);
        expect(odysseyQuenchCarry(0.5).carry).toBe(1);
        expect(odysseyQuenchCarry(0.6).carry).toBe(1);
        // Rims (bubbles) arrive with the white and leave before the neutral ocean.
        expect(odysseyQuenchCarry(0.3).bubble).toBe(0);
        expect(odysseyQuenchCarry(0.65).bubble).toBe(1);
    });
});

describe('odysseySprayEnvelope — the 2->3 burst', () => {
    it('is full at birth, gone by its life, and off when nothing fired', () => {
        expect(odysseySprayEnvelope(0)).toBe(1);
        expect(odysseySprayEnvelope(SPRAY_LIFE_S)).toBe(0);
        expect(odysseySprayEnvelope(Infinity)).toBe(0);
        expect(odysseySprayEnvelope(-1)).toBe(0);
        let prev = 1;
        for (let a = 0; a < SPRAY_LIFE_S; a += 0.05) {
            const e = odysseySprayEnvelope(a);
            expect(e).toBeLessThanOrEqual(prev + 1e-9);
            prev = e;
        }
    });
});

describe('the world object honours both handshakes', () => {
    // A lean world (no forest, no cloud field): only the update loop's CPU decisions are read.
    const world = createOdysseyWorld({
        quality: 'low', forest: false, cloudField: false, water: false,
    });
    const rail = { x: 0, y: 150, z: 0 };

    it('exposes setQuenchCarry, consumes each call, and falls back to the neutral ocean', () => {
        expect(typeof world.setQuenchCarry).toBe('function');
        world.setQuenchCarry(0.3);
        world.update(1, rail, 0.05, 160);
        expect(world.state.lifePresence).toBe(0);
        // No call this frame: neutral, whatever the last call was.
        world.update(1.016, rail, 0.05, 160);
        expect(world.state.lifePresence).toBe(1);
    });

    it('fires the spray when the EYE crosses sea level upward, and not on a teleport', () => {
        world.update(2, rail, 0.1, ODYSSEY_SEA_LEVEL - 1);
        expect(world.state.sprayAge).toBe(null);
        world.update(2.016, rail, 0.1, ODYSSEY_SEA_LEVEL + 2);
        // Aged by the climb when the clock has barely moved.
        expect(world.state.sprayAge).toBeCloseTo(2 / SPRAY_CLIMB_RATE, 5);
        // Going back under clears it.
        world.update(2.03, rail, 0.1, ODYSSEY_SEA_LEVEL - 3);
        expect(world.state.sprayAge).toBe(null);
        // A 100 u jump across the surface is a scrub, not a breach.
        world.update(2.05, rail, 0.1, ODYSSEY_SEA_LEVEL + 97);
        expect(world.state.sprayAge).toBe(null);
    });
});
