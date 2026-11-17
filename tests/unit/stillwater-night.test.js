/**
 * Stillwater — the night's own weather and its visitors (stillwater-night.js).
 *
 * What is pinned is how the night behaves, not its tuning: the first air is the still one the
 * theme is known by, no air follows itself, every round tells all of them, the melt from one to
 * the next never jumps, and the visitors are a pure function of the clock (the same night for
 * the same seconds, however the frames fall), each kind with its own rest between two visits.
 */
import { describe, expect, it } from 'vitest';
import {
    AIRS, AIR_KEYS, AIR_NAMES, AIR_REST, AIR_SECONDS, VISITOR_NAMES, VISITOR_SPAN, VISIT_SLOT, airAt, airOfSlot,
    nightHash, visitorOfSlot, visitorsBetween,
} from '../../src/themes/stillwater/stillwater-night.js';

describe('stillwater night: the airs', () => {
    it('opens still, tells every air in each round, and never lets one follow itself', () => {
        expect(airOfSlot(0)).toBe('still');
        const n = AIR_NAMES.length;
        for (let round = 0; round < 12; round++) {
            const told = Array.from({ length: n }, (_, i) => airOfSlot(round * n + i));
            expect([...told].sort(), `round ${round}`).toEqual([...AIR_NAMES].sort());
        }
        for (let slot = 0; slot < 12 * n; slot++) expect(airOfSlot(slot + 1), `slot ${slot}`).not.toBe(airOfSlot(slot));
        // The rounds are not one order told over and over.
        const roundOf = (r) => Array.from({ length: n }, (unused, i) => airOfSlot(r * n + i)).join();
        const orders = new Set(Array.from({ length: 12 }, (unused, r) => roundOf(r)));
        expect(orders.size).toBeGreaterThan(4);
    });

    it('gives every air the same numbers to turn, each in a sane range', () => {
        for (const name of AIR_NAMES) {
            expect(Object.keys(AIRS[name]), name).toEqual(AIR_KEYS);
            expect(AIRS[name].mist, name).toBeGreaterThan(0.2);
            expect(AIRS[name].mist, name).toBeLessThanOrEqual(2);
            expect(AIRS[name].rain, name).toBeGreaterThanOrEqual(0);
            expect(AIRS[name].rain, name).toBeLessThanOrEqual(1);
            expect(AIRS[name].cloud, name).toBeGreaterThanOrEqual(0);
        }
        // The still air is the theme's own picture: it changes nothing.
        expect(AIRS.still).toMatchObject({
            mist: 1, stars: 0, rain: 0, wind: 0, shafts: 0,
        });
        // Only one of them rains.
        expect(AIR_NAMES.filter((name) => AIRS[name].rain > 0)).toEqual(['rain']);
    });

    it('rests on an air, then melts into the next without a jump, and is the air itself on a whole slot', () => {
        const at = airAt(0);
        AIR_KEYS.forEach((key) => expect(at[key], key).toBe(AIRS.still[key]));
        expect(at).toMatchObject({ from: 'still', melt: 0 });
        // Through the rest it does not move.
        const resting = airAt(AIR_SECONDS * AIR_REST * 0.98);
        AIR_KEYS.forEach((key) => expect(resting[key], key).toBe(AIRS.still[key]));
        // From there to the next slot it moves on in steps no frame could see.
        const steps = [];
        for (let t = 0; t <= AIR_SECONDS * 3; t += 0.1) steps.push({ t, air: airAt(t, {}) });
        steps.slice(1).forEach(({ t, air }, i) => {
            AIR_KEYS.forEach((key) => {
                expect(Math.abs(air[key] - steps[i].air[key]), `${key} at ${t.toFixed(1)}`).toBeLessThan(0.02);
            });
        });
        const next = airAt(AIR_SECONDS);
        AIR_KEYS.forEach((key) => expect(next[key], key).toBeCloseTo(AIRS[airOfSlot(1)][key], 9));
    });

    it('holds one air when asked, whatever the clock says, and takes an unknown name for none', () => {
        for (const name of AIR_NAMES) {
            const held = airAt(12345.6, {}, name);
            AIR_KEYS.forEach((key) => expect(held[key], `${name}.${key}`).toBe(AIRS[name][key]));
            expect(held).toMatchObject({ from: name, to: name, melt: 0 });
        }
        expect(airAt(30, {}, 'hurricane')).toMatchObject(airAt(30, {}));
        // A time that is no time is the night's beginning.
        expect(airAt(Number.NaN)).toMatchObject({ from: 'still', melt: 0 });
        expect(airAt(-50)).toMatchObject({ from: 'still', melt: 0 });
    });
});

describe('stillwater night: who comes by', () => {
    it('hashes the same number for the same place, and spreads them', () => {
        expect(nightHash(7, 3)).toBe(nightHash(7, 3));
        const seen = Array.from({ length: 200 }, (_, i) => nightHash(i, 11));
        seen.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
        expect(new Set(seen.map((v) => Math.floor(v * 10))).size).toBe(10);
    });

    it('brings at most one visitor a slot, inside its slot, the same on every asking', () => {
        expect(visitorOfSlot(0)).toBeNull();
        for (let slot = 1; slot < 400; slot++) {
            const v = visitorOfSlot(slot);
            expect(visitorOfSlot(slot)).toBe(v);
            if (!v) continue;
            expect(VISITOR_NAMES).toContain(v.kind);
            expect(v.time).toBeGreaterThanOrEqual(slot * VISIT_SLOT);
            expect(v.time).toBeLessThan((slot + 1) * VISIT_SLOT);
            expect(v.seed).toBeGreaterThanOrEqual(0);
            expect(v.seed).toBeLessThan(1);
        }
    });

    it('brings every kind in a long night, the fish often and the elk seldom, and leaves quiet slots', () => {
        const count = Object.fromEntries(VISITOR_NAMES.map((name) => [name, 0]));
        let quiet = 0;
        for (let slot = 1; slot <= 600; slot++) {
            const v = visitorOfSlot(slot);
            if (v) count[v.kind] += 1;
            else quiet += 1;
        }
        VISITOR_NAMES.forEach((name) => expect(count[name], name).toBeGreaterThan(8));
        expect(count.fish).toBeGreaterThan(count.elk * 2);
        expect(quiet).toBeGreaterThan(60);
        expect(quiet).toBeLessThan(400);
    });

    it('never brings the elk in the night\'s first minute and a half, nor twice while it would still be there', () => {
        const elks = [];
        for (let slot = 1; slot <= 600; slot++) {
            const v = visitorOfSlot(slot);
            if (v && v.kind === 'elk') elks.push(v.time);
        }
        expect(elks[0]).toBeGreaterThan(95);
        for (let i = 1; i < elks.length; i++) expect(elks[i] - elks[i - 1]).toBeGreaterThan(VISITOR_SPAN.elk * 2);
        // No star falls in the rain or the thick mist: there are none to see then.
        for (let slot = 1; slot <= 600; slot++) {
            const v = visitorOfSlot(slot);
            if (v && v.kind === 'star') expect(['rain', 'mist']).not.toContain(airAt(v.time).from);
        }
    });

    it('hands out each visitor once, whatever the frames: one long step or many short ones', () => {
        const whole = visitorsBetween(0, 300, []).map((v) => `${v.kind}@${v.time}`);
        expect(whole.length).toBeGreaterThan(5);
        const stepped = [];
        const list = [];
        for (let t = 0; t < 300; t += 1 / 30) {
            visitorsBetween(t, Math.min(300, t + 1 / 30), list).forEach((v) => stepped.push(`${v.kind}@${v.time}`));
        }
        expect(stepped).toEqual(whole);
        // Nothing for a step that goes nowhere or backward.
        expect(visitorsBetween(50, 50, [])).toEqual([]);
        expect(visitorsBetween(80, 40, [])).toEqual([]);
        // A step of many minutes (a seek's replay) hands out only the last few minutes of them.
        const leap = visitorsBetween(0, 5000, []);
        expect(leap.length).toBeGreaterThan(0);
        leap.forEach((v) => expect(v.time).toBeGreaterThan(5000 - 26 * VISIT_SLOT));
    });
});
