/**
 * Rainbow Terraces — the flash governor: whatever the world asks for, what it is granted keeps
 * WCAG 2.3.1 with margin (no more than three onsets a second, gentle ramps, small routine
 * swings, bounded set pieces, little saturated red), and the iris closes and reopens.
 */
import { describe, expect, it } from 'vitest';
import { FLASH_LIMITS, FlashGovernor, flashEnvelope } from '../../src/themes/rainbow-terraces/rainbow-terraces-flash.js';
import { mulberry32 } from '../../src/themes/rainbow-terraces/rainbow-terraces-core.js';

/** A storm of requests at random moments over `seconds`, in time order; returns copies of the grants. */
function storm(governor, {
    seconds = 4, count = 60, kind = 'routine', strength = 2, area = 0.3, red = 0, seed = 1,
} = {}) {
    const rand = mulberry32(seed);
    const times = Array.from({ length: count }, () => rand() * seconds).sort((a, b) => a - b);
    return times.map((now) => {
        const g = governor.request(kind, strength * (0.5 + rand()), area * (0.5 + rand()), red, now);
        return { ...g, now };
    });
}

describe('Rainbow Terraces flash governor', () => {
    it('never lets more than three flash onsets into any one-second window', () => {
        const governor = new FlashGovernor();
        const grants = [
            ...storm(governor, { seed: 1 }),
            ...storm(governor, { seed: 2, kind: 'set' }).map((g) => ({ ...g })),
        ];
        const onsets = grants.filter((g) => g.strength !== 0).map((g) => g.at).sort((a, b) => a - b);
        onsets.forEach((start) => {
            const inside = onsets.filter((t) => t >= start && t <= start + FLASH_LIMITS.window).length;
            expect(inside).toBeLessThanOrEqual(FLASH_LIMITS.onsets);
        });
    });

    it('queues extra onsets, never sooner than asked, at least 0.11 s apart, never long', () => {
        const governor = new FlashGovernor();
        // Small flashes, so the routine allowance never runs out and only the timing is tested.
        const grants = storm(governor, {
            count: 30, seconds: 1, strength: 0.1, area: 0.1,
        });
        const flashes = grants.filter((g) => g.strength !== 0);
        expect(flashes.length).toBeGreaterThanOrEqual(5);
        for (let k = 0; k < flashes.length; k++) {
            expect(flashes[k].at).toBeGreaterThanOrEqual(flashes[k].now);
            expect(flashes[k].at - flashes[k].now).toBeLessThanOrEqual(FLASH_LIMITS.maxDelay);
            if (k > 0) expect(flashes[k].at - flashes[k - 1].at).toBeGreaterThanOrEqual(FLASH_LIMITS.gap - 1e-12);
        }
        // What could not be placed in time is folded: no strength, no wait.
        grants.filter((g) => g.strength === 0).forEach((g) => expect(g.at).toBe(g.now));
        // A lone request is granted at once.
        const calm = new FlashGovernor();
        expect(calm.request('routine', 0.2, 0.1, 0, 3).at).toBe(3);
    });

    it('ramps every flash up over ≥ 60 ms and down over ≥ 150 ms; under reduced motion ≥ 0.6 s', () => {
        const governor = new FlashGovernor();
        storm(governor, { count: 20 }).forEach((g) => {
            expect(g.ramp).toBeGreaterThanOrEqual(0.06);
            expect(g.decay).toBeGreaterThanOrEqual(0.15);
        });
        expect(governor.request('set', 0.3, 0.5, 0, 50).ramp).toBeGreaterThanOrEqual(FLASH_LIMITS.setRise);
        const gentle = new FlashGovernor({ reducedMotion: true });
        storm(gentle, { count: 20 }).forEach((g) => {
            expect(g.ramp).toBeGreaterThanOrEqual(0.6);
            expect(g.decay).toBeGreaterThanOrEqual(0.6);
        });
        gentle.setReducedMotion(false);
        expect(gentle.request('routine', 0.1, 0.1, 0, 99).ramp).toBeLessThan(0.6);
    });

    it('keeps the routine flashes\' swing of the frame-mean luminance within 10 % after the iris', () => {
        const governor = new FlashGovernor();
        storm(governor, {
            count: 80, seconds: 6, strength: 3, area: 0.4,
        });
        for (let t = 0; t < 12; t += 1 / 120) {
            governor.iris(t);
            expect(governor.swing(t)).toBeLessThanOrEqual(FLASH_LIMITS.routine + 1e-9);
        }
        // A flash well within the allowance is granted as asked.
        const calm = new FlashGovernor();
        const g = calm.request('routine', 0.5, 0.1, 0, 1);
        expect(g.strength).toBe(0.5);
        expect(g.area).toBe(0.1);
    });

    it('allows a set piece one transition pair of at most 35 %, dips included', () => {
        const governor = new FlashGovernor();
        const flare = governor.request('set', 3, 0.5, 0, 1);
        expect(flare.strength * flare.area).toBeLessThanOrEqual(FLASH_LIMITS.set + 1e-12);
        expect(flare.strength).toBeGreaterThan(0);
        const dip = governor.request('set', -0.3, 1, 0, 2);
        expect(dip.strength).toBeCloseTo(-0.3, 12);
        const deep = governor.request('set', -0.9, 1, 0, 3);
        expect(Math.abs(deep.strength * deep.area)).toBeLessThanOrEqual(FLASH_LIMITS.set + 1e-12);
    });

    it('keeps saturated red flash area within a quarter of the frame', () => {
        const governor = new FlashGovernor();
        const grants = storm(governor, {
            count: 40, seconds: 5, area: 0.35, red: 1, kind: 'set',
        });
        for (let t = 0; t < 20; t += 0.01) {
            expect(governor.redArea(t)).toBeLessThanOrEqual(FLASH_LIMITS.red + 1e-9);
        }
        // A large red flash keeps only the red the cap allows; the rest goes to gold.
        const big = new FlashGovernor().request('set', 0.3, 0.6, 1, 0);
        expect(big.red * big.area).toBeLessThanOrEqual(FLASH_LIMITS.red + 1e-12);
        expect(big.red).toBeLessThan(1);
        expect(grants.some((g) => g.red > 0)).toBe(true);
    });

    it('closes the iris on a surge and opens it again', () => {
        const governor = new FlashGovernor();
        expect(governor.iris(0)).toBe(1);
        const g = { ...governor.request('set', 0.6, 0.5, 0, 1, 0.5) };
        let t = 0;
        let lowest = 1;
        for (; t < g.at + g.ramp + g.hold; t += 1 / 60) lowest = Math.min(lowest, governor.iris(t));
        expect(lowest).toBeLessThan(1);
        expect(lowest).toBeCloseTo(1 / (1 + FLASH_LIMITS.irisGain * g.strength * g.area), 2);
        // Once the flash is over the iris only opens, and is all but open again within seconds.
        let last = governor.iris(t);
        for (t += 1 / 60; t < g.at + 8; t += 1 / 60) {
            const now = governor.iris(t);
            if (t > g.at + g.ramp + g.hold + g.decay) expect(now).toBeGreaterThanOrEqual(last - 1e-12);
            last = now;
        }
        expect(last).toBeGreaterThan(0.99);
    });

    it('forgets everything on reset', () => {
        const governor = new FlashGovernor();
        storm(governor, { count: 20, seconds: 1 });
        governor.iris(0.5);
        governor.reset();
        expect(governor.request('routine', 0.2, 0.1, 0, 0.5).at).toBe(0.5);
        expect(governor.irisValue).toBe(1);
    });

    it('shapes an envelope that rises, holds and falls back to nothing', () => {
        const g = {
            at: 2, ramp: 0.1, hold: 0.3, decay: 0.2,
        };
        expect(flashEnvelope(g, 1.9)).toBe(0);
        expect(flashEnvelope(g, 2.05)).toBeCloseTo(0.5, 9);
        expect(flashEnvelope(g, 2.2)).toBe(1);
        expect(flashEnvelope(g, 2.5)).toBeCloseTo(0.5, 9);
        expect(flashEnvelope(g, 2.7)).toBe(0);
    });
});
