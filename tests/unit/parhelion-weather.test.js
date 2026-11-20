import { describe, expect, it } from 'vitest';

import {
    AIR_FIELDS,
    AIR_HOLD,
    AIR_NAMES,
    AIR_SECONDS,
    AIRS,
    HAPPENING_KINDS,
    HAPPENING_SECONDS,
    NIGHT_WALK,
    airAt,
    createAir,
    createHappening,
    duskOf,
    happeningAt,
    nightOf,
} from '../../src/themes/parhelion/sim/parhelion-weather.js';
import {
    LOWER_SUN_WALK,
    PARHELION_OPTICS_IDLE,
} from '../../src/themes/parhelion/sim/parhelion-optics-state.js';

/**
 * Parhelion weather (src/themes/parhelion/sim/parhelion-weather.js): the wheel of airs, the night
 * on the Lower Sun's walk and the happenings' schedule. All three are pure functions of the time,
 * so these tests read them as relations (rests, melts, bounds, periods) and never as a copy of an
 * air's tuning: a re-tuned row must not turn this file red, a broken promise must.
 */

/** What an air MULTIPLIES into the hour (1 changes nothing) and what it ADDS (0 changes nothing). */
const MULTIPLIERS = ['veil', 'drift', 'dust', 'halo', 'veilRate', 'driftRate', 'dustRate', 'sat'];
const ADDITIONS = ['fog', 'glow', 'rays', 'density', 'pillar', 'warm'];
/** Mother-of-pearl is neither: it shows only through the afterglow, whatever the air holds. */
const THROUGH_DUSK = ['nacre'];
/** Fields the shaders read as a share (0..1). */
const SHARES = ['fog', 'glow', 'rays', 'nacre'];

const COUNT = AIR_NAMES.length;
const WHEEL_SECONDS = COUNT * AIR_SECONDS;
const MELT_SECONDS = AIR_SECONDS * (1 - AIR_HOLD);
const rowOf = (index) => AIRS[AIR_NAMES[((index % COUNT) + COUNT) % COUNT]];
const fieldsOf = (air) => Object.fromEntries(AIR_FIELDS.map((key) => [key, air[key]]));

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

describe('Parhelion airs: the wheel', () => {
    it('names its airs once each, the clear one first, each a frozen row of every field', () => {
        expect(COUNT).toBeGreaterThanOrEqual(2);
        expect(new Set(AIR_NAMES).size).toBe(COUNT);
        expect(Object.keys(AIRS).sort()).toEqual([...AIR_NAMES].sort());
        expect(AIR_NAMES[0]).toBe('clear');
        expect(Object.isFrozen(AIRS)).toBe(true);
        expect(Object.isFrozen(AIR_NAMES)).toBe(true);
        expect(Object.isFrozen(AIR_FIELDS)).toBe(true);
        for (const name of AIR_NAMES) {
            const row = AIRS[name];
            expect(Object.isFrozen(row), name).toBe(true);
            expect(Object.keys(row).sort(), name).toEqual([...AIR_FIELDS].sort());
            for (const key of AIR_FIELDS) expect(Number.isFinite(row[key]), `${name}.${key}`).toBe(true);
        }
        // Every field is one of the three kinds the next tests speak of (a new one must be placed).
        expect([...MULTIPLIERS, ...ADDITIONS, ...THROUGH_DUSK].sort()).toEqual([...AIR_FIELDS].sort());
    });

    it('keeps the clear air the display as designed: every multiplier 1, every addition 0', () => {
        for (const key of MULTIPLIERS) expect(AIRS.clear[key], key).toBe(1);
        for (const key of ADDITIONS) expect(AIRS.clear[key], key).toBe(0);
    });

    it('keeps every air inside what the optics and the shaders can take', () => {
        for (const name of AIR_NAMES) {
            const row = AIRS[name];
            for (const key of MULTIPLIERS) expect(row[key], `${name}.${key}`).toBeGreaterThan(0);
            for (const key of SHARES) {
                expect(row[key], `${name}.${key}`).toBeGreaterThanOrEqual(0);
                expect(row[key], `${name}.${key}`).toBeLessThanOrEqual(1);
            }
            expect(Math.abs(row.warm), `${name}.warm`).toBeLessThanOrEqual(1);
            expect(row.pillar, `${name}.pillar`).toBeGreaterThanOrEqual(0);
            // No air empties the diamond dust or fills it past the "every crystal shown" mark.
            const density = PARHELION_OPTICS_IDLE.density + row.density;
            expect(density, `${name}.density`).toBeGreaterThan(0);
            expect(density, `${name}.density`).toBeLessThanOrEqual(1);
        }
    });

    it('gives every air but the clear one something it has most of, and no two the same row', () => {
        for (const name of AIR_NAMES.slice(1)) {
            const leads = AIR_FIELDS.filter((key) => AIR_NAMES
                .every((other) => other === name || AIRS[name][key] > AIRS[other][key]));
            expect(leads.length, `${name} leads the wheel in nothing`).toBeGreaterThanOrEqual(2);
        }
        const rows = AIR_NAMES.map((name) => JSON.stringify(fieldsOf(AIRS[name])));
        expect(new Set(rows).size).toBe(COUNT);
    });

    it('rests on each air, pure, for AIR_HOLD of AIR_SECONDS', () => {
        expect(AIR_HOLD).toBeGreaterThan(0);
        expect(AIR_HOLD).toBeLessThan(1);
        for (let k = 0; k < 2 * COUNT; k++) {
            for (const share of [0, AIR_HOLD * 0.5, AIR_HOLD * 0.999]) {
                const air = airAt((k + share) * AIR_SECONDS);
                expect(fieldsOf(air), `air ${k}, ${share}`).toEqual(fieldsOf(rowOf(k)));
                expect(air.index).toBe(k % COUNT);
                expect(air.next).toBe((k + 1) % COUNT);
                expect(air.melt).toBe(0);
            }
        }
        // The theme opens in the clear air.
        expect(fieldsOf(airAt(0))).toEqual(fieldsOf(AIRS.clear));
    });

    it('melts into the next air half way at the middle of the melt, and never past either row', () => {
        for (let k = 0; k < COUNT; k++) {
            const a = rowOf(k);
            const b = rowOf(k + 1);
            const middle = airAt((k + AIR_HOLD + (1 - AIR_HOLD) / 2) * AIR_SECONDS);
            expect(middle.melt).toBeCloseTo(0.5, 9);
            for (const key of AIR_FIELDS) expect(middle[key], key).toBeCloseTo((a[key] + b[key]) / 2, 9);
            for (let u = 0; u <= 1; u += 0.02) {
                const air = airAt((k + AIR_HOLD + (1 - AIR_HOLD) * u) * AIR_SECONDS);
                for (const key of AIR_FIELDS) {
                    expect(air[key], `${key} at ${u}`).toBeGreaterThanOrEqual(Math.min(a[key], b[key]) - 1e-12);
                    expect(air[key], `${key} at ${u}`).toBeLessThanOrEqual(Math.max(a[key], b[key]) + 1e-12);
                }
            }
        }
    });

    it('never jumps, at a melt, at a rest or where the wheel comes round', () => {
        const dt = 0.05;
        // A smoothstep's steepest slope is 1.5 over its length.
        const stepOf = (key) => {
            let widest = 0;
            for (let k = 0; k < COUNT; k++) widest = Math.max(widest, Math.abs(rowOf(k + 1)[key] - rowOf(k)[key]));
            return (1.5 * widest * dt) / MELT_SECONDS + 1e-9;
        };
        const limit = Object.fromEntries(AIR_FIELDS.map((key) => [key, stepOf(key)]));
        const row = createAir();
        let last = fieldsOf(airAt(0, row));
        for (let t = dt; t <= WHEEL_SECONDS + AIR_SECONDS; t += dt) {
            const now = fieldsOf(airAt(t, row));
            for (const key of AIR_FIELDS) {
                expect(Math.abs(now[key] - last[key]), `${key} at ${t.toFixed(2)} s`).toBeLessThanOrEqual(limit[key]);
            }
            last = now;
        }
        // One turn of the wheel later the air is the same.
        for (const t of [3, 40.5, 97, 211.25, WHEEL_SECONDS - 1]) {
            const a = airAt(t);
            const b = airAt(t + WHEEL_SECONDS);
            for (const key of AIR_FIELDS) expect(b[key], `${key} at ${t}`).toBeCloseTo(a[key], 9);
            expect(b.index).toBe(a.index);
        }
    });

    it('holds a pinned air exactly, whatever the time, and gives the clock back at -1', () => {
        for (let index = 0; index < COUNT; index++) {
            for (const t of [0, 17.3, AIR_SECONDS * 0.7, 1234.5, 1e6]) {
                const air = airAt(t, createAir(), index);
                expect(fieldsOf(air), `${AIR_NAMES[index]} at ${t}`).toEqual(fieldsOf(rowOf(index)));
                expect(air.index).toBe(index);
                expect(air.melt).toBe(0);
            }
        }
        const melting = (AIR_HOLD + 0.3) * AIR_SECONDS;
        expect(fieldsOf(airAt(melting, createAir(), -1))).toEqual(fieldsOf(airAt(melting)));
        expect(airAt(melting, createAir(), -1).melt).toBeGreaterThan(0);
    });

    it('writes into the row it is handed and keeps nothing between calls', () => {
        const row = createAir();
        expect(fieldsOf(row)).toEqual(fieldsOf(AIRS.clear));
        expect(createAir()).not.toBe(row);
        expect(airAt(100, row)).toBe(row);
        const order = [250, 3, 97.5, 3, 250, 0];
        const fresh = order.map((t) => ({ ...airAt(t) }));
        const reused = order.map((t) => ({ ...airAt(t, row) }));
        expect(reused).toEqual(fresh);
        // The frozen rows are never written to.
        expect(() => airAt(60, row, 2)).not.toThrow();
        expect(fieldsOf(AIRS.clear)).toEqual(fieldsOf(rowOf(0)));
    });

    it('answers odd times with a whole air (the clear one before the clock starts)', () => {
        for (const t of [-5, -1e9, Number.NaN, undefined, null]) {
            expect(fieldsOf(airAt(t)), String(t)).toEqual(fieldsOf(AIRS.clear));
        }
        for (const t of [Infinity, -Infinity, 1e15, '12']) {
            const air = airAt(t);
            for (const key of AIR_FIELDS) expect(Number.isFinite(air[key]), `${key} at ${t}`).toBe(true);
        }
    });

    it('turns on a period that takes long to fall back in step with the walk', () => {
        const { seconds, stops } = LOWER_SUN_WALK;
        const walkSeconds = 2 * stops * seconds;
        expect(Number.isInteger(WHEEL_SECONDS) && Number.isInteger(walkSeconds)).toBe(true);
        expect(WHEEL_SECONDS).not.toBe(walkSeconds);
        // An air and an hour meet again in the same phase only after their common multiple.
        const together = (WHEEL_SECONDS * walkSeconds) / gcd(WHEEL_SECONDS, walkSeconds);
        expect(together).toBeGreaterThanOrEqual(3600);
        expect(together).toBeGreaterThanOrEqual(10 * Math.max(WHEEL_SECONDS, walkSeconds));
    });
});

describe('Parhelion night on the Lower Sun\'s walk', () => {
    const {
        fall, deep, lift, day,
    } = NIGHT_WALK;

    it('lies on the way back from the golden sun, in the order fall, deep, lift, day', () => {
        // 0 is noon, 1 the golden sun, 2 noon again.
        expect(fall).toBeGreaterThan(1);
        expect(deep).toBeGreaterThan(fall);
        expect(lift).toBeGreaterThan(deep);
        expect(day).toBeGreaterThan(lift);
        expect(day).toBeLessThan(2);
    });

    it('is day out to the golden sun and a little past it, the moonlit night between deep and lift', () => {
        for (let x = 0; x <= fall; x += 0.01) expect(nightOf(x), `walk ${x}`).toBe(0);
        for (let x = deep; x <= lift; x += 0.01) expect(nightOf(x), `walk ${x}`).toBe(1);
        for (let x = day; x <= 2; x += 0.01) expect(nightOf(x), `walk ${x}`).toBe(0);
    });

    it('gives the moon one stop of the walk and leaves every other stop in full day', () => {
        const { stops } = LOWER_SUN_WALK;
        const nights = [];
        for (let k = 0; k <= 2 * stops; k++) nights.push(nightOf(k / stops));
        expect(nights.filter((n) => n === 1)).toHaveLength(1);
        expect(nights.filter((n) => n === 0)).toHaveLength(2 * stops);
        // It is on the way back, never on the way out.
        expect(nights.indexOf(1)).toBeGreaterThan(stops);
    });

    it('falls and lifts without a jump, never outside 0..1', () => {
        const dx = 0.001;
        const steepest = (1.5 * dx) / Math.min(deep - fall, day - lift) + 1e-9;
        let last = nightOf(0);
        for (let x = dx; x <= 2 + dx / 2; x += dx) {
            const n = nightOf(x);
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThanOrEqual(1);
            expect(Math.abs(n - last), `walk ${x}`).toBeLessThanOrEqual(steepest);
            if (x > fall && x <= deep) expect(n, `falling at ${x}`).toBeGreaterThanOrEqual(last);
            if (x > lift && x <= day) expect(n, `lifting at ${x}`).toBeLessThanOrEqual(last);
            last = n;
        }
        expect(nightOf((fall + deep) / 2)).toBeCloseTo(0.5, 9);
        expect(nightOf((lift + day) / 2)).toBeCloseTo(0.5, 9);
    });

    it('folds any real walk onto the there-and-back, with no seam where it wraps', () => {
        for (const x of [0, 0.3, 1.2, 1.25, 1.5, 1.77, 1.95]) {
            for (const turns of [-3, -1, 1, 2, 7]) {
                expect(nightOf(x + 2 * turns), `${x} + ${turns} walks`).toBeCloseTo(nightOf(x), 9);
            }
        }
        expect(nightOf(2 - 1e-9)).toBe(0);
        expect(nightOf(2 + 1e-9)).toBe(0);
        expect(nightOf(-1e-9)).toBe(0);
        for (const x of [Number.NaN, Infinity, -Infinity, undefined]) expect(nightOf(x), String(x)).toBe(0);
    });

    it('leaves an afterglow on either side of the night and none by day or in the deep night', () => {
        expect(duskOf(0)).toBe(0);
        expect(duskOf(1)).toBe(0);
        expect(duskOf(0.5)).toBe(1);
        let last = 0;
        for (let n = 0; n <= 1.0001; n += 0.01) {
            const d = duskOf(n);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThanOrEqual(1);
            // The same going in as coming out.
            expect(duskOf(1 - n)).toBeCloseTo(d, 12);
            if (n <= 0.5) expect(d).toBeGreaterThanOrEqual(last);
            if (n <= 0.5) last = d;
        }
        // A night out of range is the nearest end's: no afterglow, never a negative one.
        for (const n of [-0.5, -1e9, 1.5, 1e9, Infinity, -Infinity]) expect(duskOf(n), String(n)).toBe(0);
    });

    // Was FAULT 7 (nit) (found by this test, fixed 2026-11-20; what follows is what the code did then): duskOf(NaN) is NaN (nightOf guards a non-finite walk, duskOf guards nothing).
    // No caller hands it one today; a NaN uniform would black the dome out if one ever did.
    it('answers a number in 0..1 for a night that is not a number', () => {
        const d = duskOf(Number.NaN);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
    });
});

describe('Parhelion happenings: the schedule', () => {
    const SLOTS = 3000;
    const slotStart = (slot) => slot * HAPPENING_SECONDS;
    /** The happening of a slot, read a little way into it. */
    const ofSlot = (slot, out) => happeningAt(slotStart(slot) + 0.5, out);

    it('opens at rest: the first slot is quiet', () => {
        for (let t = 0; t < HAPPENING_SECONDS; t += 0.25) {
            const h = happeningAt(t);
            expect(h.slot).toBe(0);
            expect(h.kind).toBe('');
            expect(h.kindIndex).toBe(-1);
            expect(h.live, `at ${t}`).toBe(false);
            expect(h.length).toBe(0);
        }
    });

    it('gives every later slot one happening that starts and ends inside it', () => {
        const row = createHappening();
        for (let slot = 1; slot <= SLOTS; slot++) {
            const h = ofSlot(slot, row);
            expect(h.slot).toBe(slot);
            expect(HAPPENING_KINDS, `slot ${slot}`).toContain(h.kind);
            expect(HAPPENING_KINDS[h.kindIndex]).toBe(h.kind);
            expect(h.length).toBeGreaterThan(0);
            // A breath of rest before it and after it: happenings never run into each other.
            expect(h.at, `slot ${slot} starts`).toBeGreaterThan(slotStart(slot));
            expect(h.at + h.length, `slot ${slot} ends`).toBeLessThan(slotStart(slot + 1));
            expect([-1, 1]).toContain(h.side);
        }
    });

    it('never plays the same kind twice running, and lets none go missing', () => {
        const row = createHappening();
        const kinds = [];
        for (let slot = 1; slot <= SLOTS; slot++) kinds.push(ofSlot(slot, row).kind);
        const repeats = [];
        for (let i = 1; i < kinds.length; i++) if (kinds[i] === kinds[i - 1]) repeats.push(i + 1);
        expect(repeats).toEqual([]);
        // Every kind comes round within a few slots, wherever one starts counting.
        const span = 4 * HAPPENING_KINDS.length;
        for (let from = 0; from + span <= kinds.length; from += 7) {
            expect(new Set(kinds.slice(from, from + span)).size, `slots ${from + 1}..`).toBe(HAPPENING_KINDS.length);
        }
    });

    it('is live from its start for its length, and counts its age from its own start', () => {
        for (const slot of [1, 2, 3, 4, 5, 17, 240]) {
            const { at, length, kind } = ofSlot(slot);
            let liveSeconds = 0;
            const dt = 0.05;
            for (let t = slotStart(slot); t < slotStart(slot + 1); t += dt) {
                const h = happeningAt(t);
                expect(h.kind).toBe(kind);
                expect(h.at).toBe(at);
                expect(h.age).toBeCloseTo(t - at, 9);
                expect(h.live, `slot ${slot} at ${t}`).toBe(h.age >= 0 && h.age < length);
                if (h.live) liveSeconds += dt;
            }
            expect(liveSeconds).toBeCloseTo(length, 0);
        }
    });

    it('is a pure function of the time: any order, a reused row, the same answer', () => {
        const row = createHappening();
        expect(happeningAt(100, row)).toBe(row);
        const times = [500.5, 38, 2000.25, 38, 0, 500.5, 76.9, 1e6 + 0.5];
        const fresh = times.map((t) => ({ ...happeningAt(t) }));
        const reused = times.map((t) => ({ ...happeningAt(t, row) }));
        const reversed = [...times].reverse().map((t) => ({ ...happeningAt(t, row) })).reverse();
        expect(reused).toEqual(fresh);
        expect(reversed).toEqual(fresh);
    });

    it('lets the hash say when in its slot each starts and on which side', () => {
        const row = createHappening();
        const starts = new Set();
        let left = 0;
        const n = 400;
        for (let slot = 1; slot <= n; slot++) {
            const h = ofSlot(slot, row);
            starts.add(Math.round((h.at - slotStart(slot)) * 10));
            if (h.side < 0) left += 1;
        }
        // Not a metronome, and neither hound is the only one that ever flares.
        expect(starts.size).toBeGreaterThan(40);
        expect(left).toBeGreaterThan(n * 0.25);
        expect(left).toBeLessThan(n * 0.75);
    });

    it('answers a time before the clock, or one that is not a number, with the quiet first slot', () => {
        for (const t of [-1, -1e9, Number.NaN, undefined, null]) {
            const h = happeningAt(t);
            expect(h.slot, String(t)).toBe(0);
            expect(h.live).toBe(false);
            expect(h.kind).toBe('');
        }
        // Far into a long session the schedule is still whole.
        for (const t of [1e7 + 3, 1e9 + 0.5, 1e12]) {
            const h = happeningAt(t);
            expect(HAPPENING_KINDS, String(t)).toContain(h.kind);
            expect(Number.isFinite(h.at) && Number.isFinite(h.age) && Number.isFinite(h.length)).toBe(true);
        }
    });

    // Was FAULT 8 (nit) (found by this test, fixed 2026-11-20; what follows is what the code did then): happeningAt(Infinity) answers kind undefined, at NaN and length undefined.
    // The optics state never hands it a non-finite time (update() falls back to its last one).
    it('answers a whole row at a time without end', () => {
        const h = happeningAt(Infinity);
        expect(typeof h.kind).toBe('string');
        expect(Number.isFinite(h.at)).toBe(true);
        expect(Number.isFinite(h.length)).toBe(true);
        expect(h.live).toBe(false);
    });
});
