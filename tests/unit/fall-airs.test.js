/**
 * Fall — the airs (the grove's weather, fall-airs.js) and the happenings (what comes by,
 * fall-happenings.js): both functions of the clock alone. Their world wiring is in
 * fall-world.test.js, where a world can be built with its assets. Timings are read from the
 * modules, never copied.
 */

import { describe, expect, it } from 'vitest';
import {
    FALL_AIRS, FALL_AIR_HOLD, FALL_AIR_SCALARS, FALL_AIR_SECONDS, FALL_WORLD_TIERS, createFallAir, fallAirAt,
    fallAirDrift, fallAirName, fallWorldTier,
} from '../../src/themes/fall/fall-airs.js';
import {
    FALL_HAPPENINGS, FALL_HAPPENING_FIRST, FALL_HAPPENING_JITTER, FALL_HAPPENING_LENGTH, FALL_HAPPENING_SECONDS,
    createFallHappening, fallHappeningAt, fallHappeningHeld, fallHappeningKind, fallHappeningStart, fallShaftAt,
} from '../../src/themes/fall/fall-happenings.js';
import { FALL_MOODS, FALL_MOOD_SECONDS } from '../../src/themes/fall/fall-moods.js';

const N = FALL_AIRS.length;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

describe('Fall airs', () => {
    it('opens on the grove as it was built: no mist, rain, cloud or shedding, the old breeze', () => {
        const [first] = FALL_AIRS;
        expect(first.name).toBe('still gold');
        expect(first).toMatchObject({
            mist: 0,
            rain: 0,
            wet: 0,
            shed: 0,
            cover: 0,
            scud: 0,
            gusts: 0,
            wind: 0.3,
            dust: 1,
            sun: 1,
            shafts: 1,
            exposure: 1,
        });
        expect(createFallAir()).toEqual(Object.fromEntries(FALL_AIR_SCALARS.map((key) => [key, first[key]])));
    });

    it('gives every air every number, finite and in its range, and each its own weather', () => {
        for (const air of FALL_AIRS) {
            for (const key of FALL_AIR_SCALARS) {
                expect(Number.isFinite(air[key]), `${air.name}.${key}`).toBe(true);
                expect(air[key], `${air.name}.${key}`).toBeGreaterThanOrEqual(0);
            }
            for (const key of ['mist', 'gusts', 'rain', 'wet', 'shed', 'cover', 'scud']) {
                expect(air[key], `${air.name}.${key}`).toBeLessThanOrEqual(1);
            }
            // Never a lens or a sun far from rest: an air changes form and motion, not the exposure.
            expect(Math.abs(air.exposure - 1)).toBeLessThan(0.1);
            expect(Math.abs(air.sun - 1)).toBeLessThan(0.15);
        }
        // Each air is the one that brings its own thing at its fullest.
        const most = (key) => FALL_AIRS.reduce((best, air) => (air[key] > best[key] ? air : best)).name;
        expect(most('mist')).toBe('ground mist');
        expect(most('wind')).toBe('windy day');
        expect(most('rain')).toBe('sun shower');
        expect(most('shed')).toBe('the great fall');
        // The names are all different.
        expect(new Set(FALL_AIRS.map((air) => air.name)).size).toBe(N);
    });

    it('turns on a clock of its own that never keeps step with the lights', () => {
        // The pairing of a light and an air comes round only after many of both.
        const lights = FALL_MOOD_SECONDS * FALL_MOODS.length;
        const airs = FALL_AIR_SECONDS * N;
        const together = (lights * airs) / gcd(lights, airs);
        expect(together).toBeGreaterThan(3600);
        expect(FALL_MOOD_SECONDS % FALL_AIR_SECONDS).not.toBe(0);
        expect(FALL_AIR_SECONDS % FALL_MOOD_SECONDS).not.toBe(0);
    });

    it('rests pure in each air, then melts into the next, and comes round', () => {
        for (let k = 0; k < N; k += 1) {
            const rest = (k + FALL_AIR_HOLD * 0.5) * FALL_AIR_SECONDS;
            expect(fallAirDrift(rest)).toBeCloseTo(k, 9);
            expect(fallAirName(fallAirDrift(rest))).toBe(FALL_AIRS[k].name);
            const melt = (k + FALL_AIR_HOLD + (1 - FALL_AIR_HOLD) * 0.5) * FALL_AIR_SECONDS;
            const between = fallAirDrift(melt);
            expect(between).toBeGreaterThan(k);
            expect(between).toBeLessThan(k + 1);
        }
        // The wheel comes round: the air after the last is the first.
        expect(fallAirName(N)).toBe(FALL_AIRS[0].name);
        expect(fallAirName(-1)).toBe(FALL_AIRS[N - 1].name);
        expect(fallAirName(Number.NaN)).toBe(FALL_AIRS[0].name);
    });

    it('is each air exactly on a whole phase and mixes the two between', () => {
        const out = createFallAir();
        for (let k = 0; k < N; k += 1) {
            fallAirAt(k, out);
            for (const key of FALL_AIR_SCALARS) expect(out[key], `${FALL_AIRS[k].name}.${key}`).toBe(FALL_AIRS[k][key]);
        }
        // Half way from the mist to the wind: every number between the two.
        fallAirAt(1.5, out);
        for (const key of FALL_AIR_SCALARS) {
            const [a, b] = [FALL_AIRS[1][key], FALL_AIRS[2][key]];
            expect(out[key]).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
            expect(out[key]).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
        }
    });

    it('scales its own things by tier, never more on a lower tier', () => {
        const order = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
        expect(Object.keys(FALL_WORLD_TIERS).sort()).toEqual([...order].sort());
        for (const key of ['caps', 'fireflies', 'dust', 'rain', 'threads', 'geese', 'jays', 'acorns']) {
            for (let i = 1; i < order.length; i += 1) {
                expect(FALL_WORLD_TIERS[order[i]][key], `${order[i]}.${key}`)
                    .toBeLessThanOrEqual(FALL_WORLD_TIERS[order[i - 1]][key]);
            }
            expect(FALL_WORLD_TIERS.Minimal[key], `Minimal.${key}`).toBeGreaterThanOrEqual(0);
        }
        // A skein is a V: an odd count, a leader and two arms.
        for (const name of order) expect(FALL_WORLD_TIERS[name].geese % 2, name).toBe(1);
        expect(fallWorldTier('Nonsense')).toBe(FALL_WORLD_TIERS.High);
    });
});

describe('Fall happenings', () => {
    const SEEDS = [0, 271, 7, 12345, 0xdeadbeef];

    it('waits a while into a session, then brings one at a time, each over before the next', () => {
        for (const seed of SEEDS) {
            expect(fallHappeningAt(FALL_HAPPENING_FIRST - 0.01, seed).kind).toBe(null);
            for (let slot = 0; slot < 60; slot += 1) {
                const start = fallHappeningStart(slot, seed);
                const kind = fallHappeningKind(slot, seed);
                expect(start).toBeGreaterThanOrEqual(FALL_HAPPENING_FIRST + slot * FALL_HAPPENING_SECONDS);
                const latest = FALL_HAPPENING_FIRST + slot * FALL_HAPPENING_SECONDS + FALL_HAPPENING_JITTER;
                expect(start).toBeLessThan(latest);
                // It ends before the next slot can begin.
                expect(start + FALL_HAPPENING_LENGTH[kind])
                    .toBeLessThan(FALL_HAPPENING_FIRST + (slot + 1) * FALL_HAPPENING_SECONDS);
                const during = fallHappeningAt(start + FALL_HAPPENING_LENGTH[kind] * 0.5, seed);
                expect(during.kind).toBe(kind);
                expect(during.slot).toBe(slot);
                expect(during.u).toBeCloseTo(0.5, 6);
                expect(during.roll).toBeGreaterThanOrEqual(0);
                expect(during.roll).toBeLessThan(1);
                expect(fallHappeningAt(start + FALL_HAPPENING_LENGTH[kind] + 0.01, seed).kind).toBe(null);
            }
        }
    });

    it('deals every kind once a round, never the same twice running, and differently by seed', () => {
        const n = FALL_HAPPENINGS.length;
        const orders = new Set();
        for (const seed of SEEDS) {
            const kinds = Array.from({ length: n * 40 }, (_, slot) => fallHappeningKind(slot, seed));
            for (let round = 0; round < 40; round += 1) {
                expect(new Set(kinds.slice(round * n, round * n + n)).size).toBe(n);
            }
            for (let i = 1; i < kinds.length; i += 1) expect(kinds[i], `${seed} slot ${i}`).not.toBe(kinds[i - 1]);
            orders.add(kinds.slice(0, n * 3).join());
        }
        expect(orders.size).toBeGreaterThan(1);
    });

    it('is a function of the clock alone: the same answer however it is asked', () => {
        const a = createFallHappening();
        const b = createFallHappening();
        for (let t = 0; t < 600; t += 0.37) {
            fallHappeningAt(t, 271, a);
            fallHappeningAt(t, 271, b);
            expect(a).toEqual(b);
        }
        // Junk never throws or plays.
        for (const junk of [Number.NaN, -5, Infinity, -Infinity]) {
            expect(fallHappeningAt(junk, 271).kind).toBe(null);
        }
    });

    it('holds one for a capture, and lets it go when it is over', () => {
        const held = fallHappeningHeld('geese', 10, 12, 0.2);
        expect(held).toMatchObject({ kind: 'geese', age: 2, roll: 0.2 });
        expect(fallHappeningHeld('geese', 10, 10 + FALL_HAPPENING_LENGTH.geese + 0.1).kind).toBe(null);
        expect(fallHappeningHeld('geese', 10, 9).kind).toBe(null);
        expect(fallHappeningHeld('dragons', 10, 11).kind).toBe(null);
    });

    it('sends the gap in the cloud across the grove on the wind, the cloud first and last', () => {
        for (const roll of [0, 0.37, 0.99]) {
            const start = fallShaftAt(0, roll);
            const end = fallShaftAt(1, roll);
            // No shaft and no cloud at either end: it comes and goes softly.
            expect(start.strength).toBeCloseTo(0, 9);
            expect(end.strength).toBeCloseTo(0, 9);
            expect(start.cloud).toBeCloseTo(0, 9);
            expect(end.cloud).toBeCloseTo(0, 9);
            // Downwind (+x) as it goes.
            expect(fallShaftAt(0.8, roll).x).toBeGreaterThan(fallShaftAt(0.2, roll).x);
            // At its height: a shaft and a cloud over the rest, never the sun put out.
            const mid = fallShaftAt(0.5, roll);
            expect(mid.strength).toBeGreaterThan(0.5);
            expect(mid.cloud).toBeGreaterThan(0.2);
            expect(mid.cloud).toBeLessThan(0.6);
            for (let u = 0; u <= 1; u += 0.05) {
                const at = fallShaftAt(u, roll);
                expect([at.x, at.z, at.radius, at.strength, at.cloud].every(Number.isFinite)).toBe(true);
                expect(at.radius).toBeGreaterThan(1);
            }
        }
    });
});
