/**
 * Painted Ages — the weather's clock (painted-ages-weather.js, three-free): the wheel of airs
 * beside the hours, the wind it adds to the deck's drift, where the far shower hangs, and the
 * small happenings the clock schedules.
 *
 * Held as relations (never backward, never a jump, between its two airs, once per slot), not as
 * the tuning's numbers: an air's cover or wind may be re-tuned without touching this file.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    AIRS, AIR_COUNT, AIR_HOLD, AIR_NAMES, AIR_SECONDS, HAPPENINGS, HAPPENING_SECONDS, airAt, airDrift, airPlace,
    createAir, happeningAt, swellOver, virgaBearing,
} from '../../src/themes/painted-ages/painted-ages-weather.js';
import { TIMING } from '../../src/themes/painted-ages/painted-ages-core.js';
import { HOUR_COUNT } from '../../src/themes/painted-ages/painted-ages-hours.js';

/** The scalars an air carries (the table's columns). */
const SCALARS = Object.keys(AIRS[0]).filter((key) => key !== 'name');
const SHOWERS = AIR_NAMES.indexOf('showers');
/** The windows the world plays a happening in (s): a meteor, a flicker with its echo, a gust's arming. */
const WINDOWS = { meteor: 1.25, flicker: 1.0, gust: 1.2 };

describe('Painted Ages weather: the wheel\'s place by the clock (airPlace)', () => {
    it('starts at 0 and stays there for a clock that has not started (negative, NaN)', () => {
        expect(airPlace(0)).toBe(0);
        expect(airPlace(-5)).toBe(0);
        expect(airPlace(Number.NaN)).toBe(0);
        expect(airPlace(undefined)).toBe(0);
    });

    it('is a pure function of the time: the same place whatever was asked before', () => {
        const times = [0, 1, 36.8, 50, 91.999, 92, 92.001, 300, 643.9, 644, 5000.25, 86399];
        const first = times.map((t) => airPlace(t));
        const backward = [...times].reverse().map((t) => airPlace(t)).reverse();
        expect(backward).toEqual(first);
        expect(times.map((t) => airPlace(t))).toEqual(first);
    });

    it('never runs backward and never jumps: a small step in time is a small step in place', () => {
        // The melt takes (1 − AIR_HOLD) of an air: its mean pace is one air in that long. Eased, it
        // may run a little faster than that in the middle, never several times faster.
        const meanPace = 1 / ((1 - AIR_HOLD) * AIR_SECONDS);
        for (const dt of [1 / 240, 1 / 30, 0.25]) {
            let prev = airPlace(0);
            let back = 0;
            let fastest = 0;
            for (let t = dt; t <= AIR_SECONDS * AIR_COUNT * 2.5; t += dt) {
                const place = airPlace(t);
                back = Math.min(back, place - prev);
                fastest = Math.max(fastest, (place - prev) / dt);
                prev = place;
            }
            expect(back, `dt ${dt}`).toBe(0);
            expect(fastest, `dt ${dt}`).toBeLessThanOrEqual(2 * meanPace);
            expect(fastest, `dt ${dt}`).toBeGreaterThan(0);
        }
    });

    it('rests on a whole air for AIR_HOLD of AIR_SECONDS, then melts into the next', () => {
        expect(AIR_HOLD).toBeGreaterThan(0);
        expect(AIR_HOLD).toBeLessThan(1);
        for (let n = 0; n < AIR_COUNT * 3; n += 1) {
            const from = n * AIR_SECONDS;
            for (const share of [0, 0.25, 0.5, 0.75, 0.999]) {
                expect(airPlace(from + share * AIR_HOLD * AIR_SECONDS), `air ${n}, ${share} of its rest`).toBe(n);
            }
            // Once the rest is over the place is on its way, and it stays short of the next air
            // until the period ends.
            const melting = [0.02, 0.3, 0.6, 0.98]
                .map((share) => airPlace(from + (AIR_HOLD + share * (1 - AIR_HOLD)) * AIR_SECONDS));
            melting.forEach((place, i) => {
                expect(place, `air ${n}, melt sample ${i}`).toBeGreaterThan(i ? melting[i - 1] : n);
                expect(place, `air ${n}, melt sample ${i}`).toBeLessThan(n + 1);
            });
        }
    });

    it('passes one air per AIR_SECONDS', () => {
        for (let n = 0; n <= 200; n += 1) {
            expect(airPlace(n * AIR_SECONDS), `period ${n}`).toBe(n);
            expect(Math.floor(airPlace((n + 0.5) * AIR_SECONDS)), `mid period ${n}`).toBe(n);
            expect(airPlace((n + 1) * AIR_SECONDS - 1e-3), `end of period ${n}`).toBeLessThanOrEqual(n + 1);
            expect(airPlace((n + 1) * AIR_SECONDS - 1e-3), `end of period ${n}`).toBeGreaterThan(n + 0.99);
        }
    });
});

describe('Painted Ages weather: the air at a place (airAt)', () => {
    it('is that air exactly at a whole place, and the wheel has every air once per AIR_COUNT places', () => {
        expect(AIR_COUNT).toBe(AIRS.length);
        expect(new Set(AIR_NAMES).size).toBe(AIR_COUNT);
        for (let n = -AIR_COUNT; n < AIR_COUNT * 3; n += 1) {
            const air = airAt(n);
            const table = AIRS[((n % AIR_COUNT) + AIR_COUNT) % AIR_COUNT];
            expect(air.name, `place ${n}`).toBe(table.name);
            expect(air.mix, `place ${n}`).toBe(0);
            for (const key of SCALARS) expect(air[key], `${key} at place ${n}`).toBe(table[key]);
        }
        for (let start = 0; start < AIR_COUNT * 2; start += 1) {
            const turn = Array.from({ length: AIR_COUNT }, (_, k) => airAt(start + k).name);
            expect([...turn].sort(), `the turn from ${start}`).toEqual([...AIR_NAMES].sort());
        }
    });

    it('keeps every scalar between its two airs while one melts into the other', () => {
        for (let n = 0; n < AIR_COUNT; n += 1) {
            const a = AIRS[n];
            const b = AIRS[(n + 1) % AIR_COUNT];
            let last = null;
            for (let f = 0.02; f < 1; f += 0.07) {
                const air = { ...airAt(n + f) };
                expect(air.from).toBe(n);
                expect(air.to).toBe((n + 1) % AIR_COUNT);
                expect(air.mix).toBeCloseTo(f, 12);
                for (const key of SCALARS) {
                    const lo = Math.min(a[key], b[key]) - 1e-12;
                    const hi = Math.max(a[key], b[key]) + 1e-12;
                    expect(air[key], `${key} at ${n} + ${f.toFixed(2)}`).toBeGreaterThanOrEqual(lo);
                    expect(air[key], `${key} at ${n} + ${f.toFixed(2)}`).toBeLessThanOrEqual(hi);
                    // ... and on its way from the one to the other, never back.
                    const left = Math.abs(air[key] - b[key]);
                    const before = last ? Math.abs(last[key] - b[key]) : Infinity;
                    expect(left, `${key} nears ${b.name}`).toBeLessThanOrEqual(before + 1e-12);
                }
                // It is named after the nearer of the two.
                expect(air.name).toBe(f < 0.5 ? a.name : b.name);
                last = air;
            }
        }
    });

    it('gives finite scalars and a real air for any place: negative, huge, NaN, infinite', () => {
        const places = [
            -0, -0.5, -7.3, -1e9, 1e9, 1e15 + 0.5, 1e300, -1e300, Number.MAX_VALUE, Number.MIN_VALUE, Number.NaN,
            Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null,
        ];
        for (const place of places) {
            const air = airAt(place);
            for (const key of SCALARS) expect(Number.isFinite(air[key]), `${key} at ${place}`).toBe(true);
            expect(AIR_NAMES, `name at ${place}`).toContain(air.name);
            expect(Number.isInteger(air.from) && air.from >= 0 && air.from < AIR_COUNT, `from at ${place}`).toBe(true);
            expect(Number.isInteger(air.to) && air.to >= 0 && air.to < AIR_COUNT, `to at ${place}`).toBe(true);
            expect(air.mix, `mix at ${place}`).toBeGreaterThanOrEqual(0);
            expect(air.mix, `mix at ${place}`).toBeLessThanOrEqual(1);
        }
    });

    // WAS A FAULT (found by this test, fixed in the living pass): airAt echoes the place it was given (out.place = place), so NaN and ±Infinity come back as
    // the air's place, and the world hands that to virgaBearing(A.place): NaN in u.virga and u.bowLeg.
    it('hands back a finite place for a place that is not a number (the world reads air.place)', () => {
        for (const place of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(Number.isFinite(airAt(place).place), `place at ${place}`).toBe(true);
        }
    });

    it('writes into the air it is handed and allocates nothing more', () => {
        const out = createAir();
        expect(airAt(2.25, out)).toBe(out);
        expect(out.place).toBe(2.25);
        expect(Object.keys(out).sort()).toEqual(Object.keys(createAir()).sort());
    });

    it('opens on fair: air 0, the day as it was before the airs', () => {
        expect(AIR_NAMES[0]).toBe('fair');
        const first = airAt(airPlace(0));
        expect(first.name).toBe('fair');
        expect(first.mix).toBe(0);
        // Nothing of the other airs' own: no mist added, no dust, no far shower, the deck at its pace.
        expect(first).toMatchObject({
            mist: 0, dust: 0, virga: 0, wind: 1, haze: 1, mistRise: 1, cirrus: 1, sat: 0,
        });
        const blank = createAir();
        for (const key of SCALARS) expect(blank[key], key).toBe(AIRS[0][key]);
        expect(blank.name).toBe('fair');
    });

    it('keeps every air\'s numbers inside what the shaders can take', () => {
        for (const air of AIRS) {
            for (const key of ['cover', 'shade', 'dust', 'towers', 'virga']) {
                expect(air[key], `${air.name}.${key}`).toBeGreaterThanOrEqual(0);
                expect(air[key], `${air.name}.${key}`).toBeLessThanOrEqual(1);
            }
            // The deck never stands still or runs backward; the haze and the mist layer never vanish.
            for (const key of ['wind', 'haze', 'mistRise']) expect(air[key], `${air.name}.${key}`).toBeGreaterThan(0);
            expect(air.mist, `${air.name}.mist`).toBeGreaterThanOrEqual(0);
            expect(air.cirrus, `${air.name}.cirrus`).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('Painted Ages weather: the airs against the hours', () => {
    it('turns the two wheels at paces that are no multiples of each other', () => {
        const { hour } = TIMING;
        expect(AIR_SECONDS % hour).not.toBe(0);
        expect(hour % AIR_SECONDS).not.toBe(0);
        // Nor do the whole wheels come round together.
        const airs = AIR_SECONDS * AIR_COUNT;
        const day = hour * HOUR_COUNT;
        expect(Math.max(airs, day) % Math.min(airs, day)).not.toBe(0);
    });

    it('meets many pairs of hour and air in the first hour of play', () => {
        const pairs = new Set();
        const byHour = Array.from({ length: HOUR_COUNT }, () => new Set());
        for (let t = 0; t < 3600; t += 0.5) {
            const hour = Math.floor(t / TIMING.hour) % HOUR_COUNT;
            const air = Math.round(airPlace(t)) % AIR_COUNT;
            pairs.add(`${hour}:${air}`);
            byHour[hour].add(air);
        }
        // More than half of all there are, and no hour that only ever saw one or two airs.
        expect(pairs.size).toBeGreaterThan((HOUR_COUNT * AIR_COUNT) / 2);
        byHour.forEach((airs, hour) => expect(airs.size, `hour ${hour}`).toBeGreaterThanOrEqual(3));
    });

    it('does not open every day in the same air', () => {
        const day = TIMING.hour * HOUR_COUNT;
        const dawns = new Set();
        for (let d = 0; d < 14; d += 1) dawns.add(Math.round(airPlace(d * day)) % AIR_COUNT);
        expect(dawns.size).toBeGreaterThanOrEqual(AIR_COUNT - 1);
    });
});

describe('Painted Ages weather: what the winds add to the deck\'s drift (airDrift)', () => {
    /** The integral of (wind − 1) over [0, T], summed finely. */
    function integral(T, step = 0.01) {
        let sum = 0;
        const air = createAir();
        const n = Math.round(T / step);
        for (let i = 0; i < n; i += 1) sum += (airAt(airPlace((i + 0.5) * step), air).wind - 1) * step;
        return sum;
    }
    const strongest = Math.max(...AIRS.map((air) => Math.abs(air.wind - 1)));

    it('is 0 at 0 and for a clock that has not started', () => {
        expect(airDrift(0)).toBe(0);
        expect(airDrift(-3)).toBe(0);
        expect(airDrift(Number.NaN)).toBe(0);
    });

    it('equals the integral of (wind − 1) to within the one-second step it sums in', () => {
        for (const T of [10, AIR_SECONDS * AIR_HOLD, AIR_SECONDS, 137.5, 300, 644, 1000, 2500]) {
            // A step's worth of the strongest wind, at most.
            expect(Math.abs(airDrift(T) - integral(T)), `T = ${T}`).toBeLessThanOrEqual(strongest);
        }
        // It is not nothing: the wheel's winds do not cancel over a turn.
        expect(Math.abs(airDrift(AIR_SECONDS * AIR_COUNT))).toBeGreaterThan(1);
    });

    it('gives the same drift asked in increasing order, in decreasing order, or cold', async () => {
        const times = [0, 0.4, 1, 10, 91, 92, 93, 300, 1000.75, 2500, 5000];
        const rising = times.map((t) => airDrift(t));
        const falling = [...times].reverse().map((t) => airDrift(t)).reverse();
        expect(falling).toEqual(rising);
        const shuffled = [300, 5000, 1, 2500, 0, 93, 0.4, 1000.75, 91, 10, 92];
        shuffled.forEach((t) => expect(airDrift(t), `t = ${t}`).toBe(rising[times.indexOf(t)]));
        // Cold: a module that has summed nothing yet, asked for one time only.
        for (const t of [5000, 93, 1000.75]) {
            vi.resetModules();
            // eslint-disable-next-line no-await-in-loop
            const fresh = await import('../../src/themes/painted-ages/painted-ages-weather.js');
            expect(fresh.airDrift(t), `cold at ${t}`).toBe(rising[times.indexOf(t)]);
        }
    });

    it('never runs the deck backward: the clock plus the drift only grows', () => {
        let prev = 0;
        for (let t = 1; t <= AIR_SECONDS * AIR_COUNT * 2; t += 1) {
            const at = t + airDrift(t);
            expect(at, `t = ${t}`).toBeGreaterThan(prev);
            prev = at;
        }
    });
});

describe('Painted Ages weather: where the far shower hangs (virgaBearing)', () => {
    /** The places of visit `v` of the showers air: from the melt in to the melt out. */
    const visit = (v) => [SHOWERS - 1 + v * AIR_COUNT, SHOWERS + 1 + v * AIR_COUNT];

    it('keeps one side of the board for a whole visit of the showers air', () => {
        expect(SHOWERS).toBeGreaterThanOrEqual(0);
        const sides = [];
        for (let v = 0; v < 60; v += 1) {
            const [from, to] = visit(v);
            const side = Math.sign(virgaBearing(SHOWERS + v * AIR_COUNT));
            expect(Math.abs(side)).toBe(1);
            for (let place = from; place <= to; place += 0.01) {
                // (Only where a curtain shows at all.)
                if (!(airAt(place).virga > 0)) continue;
                expect(Math.sign(virgaBearing(place)), `visit ${v}, place ${place.toFixed(2)}`).toBe(side);
            }
            sides.push(side);
        }
        // Seeded by the visit: both sides get their showers.
        expect(sides).toContain(1);
        expect(sides).toContain(-1);
    });

    it('stays beside the board, never within a quarter radian of the view axis, and finite', () => {
        for (let place = -AIR_COUNT; place < AIR_COUNT * 40; place += 0.013) {
            const bearing = virgaBearing(place);
            expect(Number.isFinite(bearing), `place ${place}`).toBe(true);
            expect(Math.abs(bearing), `place ${place}`).toBeGreaterThanOrEqual(0.25);
            // ... and inside the frame (a lens of 40° shows about ±0.6 rad at 16:9).
            expect(Math.abs(bearing), `place ${place}`).toBeLessThan(0.6);
        }
        expect(virgaBearing(airPlace(1e7))).toSatisfy(Number.isFinite);
    });

    it('is the same bearing for the same place, whatever was asked before', () => {
        const places = [2.2, 3, 3.7, 10, 17.4, 24.01];
        const first = places.map((p) => virgaBearing(p));
        expect([...places].reverse().map((p) => virgaBearing(p)).reverse()).toEqual(first);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): the drift term is the place's own fraction, (place − floor(place)) − 0.5, so it starts over
    // at every whole place. As the wheel comes to rest ON the showers air (place 3, 10, 17 …, the
    // curtains at full strength) the bearing steps back 0.07 rad (4°) in one frame: by the clock at
    // t = 276 s the curtains and the shard of rainbow in them jump about a hundred pixels at 1600 wide.
    it('drifts slowly while the shower lasts: a small step in place is a small step in bearing', () => {
        let worst = 0;
        for (let v = 0; v < 6; v += 1) {
            const [from, to] = visit(v);
            let last = virgaBearing(from + 1e-4);
            for (let place = from + 2e-4; place < to; place += 1e-4) {
                const bearing = virgaBearing(place);
                worst = Math.max(worst, Math.abs(bearing - last));
                last = bearing;
            }
        }
        // A ten-thousandth of an air: the bearing may move a hair, not degrees.
        expect(worst).toBeLessThan(0.001);
    });

    // WAS A FAULT (found by this test, fixed in the living pass): no guard for a place that is not a number (visit and drift become NaN): see airAt's place.
    it('is finite for a place that is not a number', () => {
        for (const place of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(Number.isFinite(virgaBearing(place)), `place ${place}`).toBe(true);
        }
    });
});

describe('Painted Ages weather: the clock\'s happenings (happeningAt)', () => {
    const SLOTS = 3000;

    it('is a pure function of the time, written into the object it is handed', () => {
        const times = [0, 5, 22.99, 23, 100.5, 4000.25, 68999];
        const first = times.map((t) => ({ ...happeningAt(t) }));
        expect([...times].reverse().map((t) => ({ ...happeningAt(t) })).reverse()).toEqual(first);
        const out = {};
        expect(happeningAt(100.5, out)).toBe(out);
        expect(out).toEqual(first[4]);
        // A clock that has not started is the first slot's.
        expect({ ...happeningAt(-10) }).toMatchObject({ slot: 0, kind: first[0].kind, start: first[0].start });
        expect(happeningAt(Number.NaN).slot).toBe(0);
    });

    it('draws exactly once per slot: the same kind, start, side and seed all through it', () => {
        for (let slot = 0; slot < SLOTS; slot += 7) {
            const from = slot * HAPPENING_SECONDS;
            const first = { ...happeningAt(from) };
            expect(first.slot).toBe(slot);
            for (const share of [0.001, 0.2, 0.5, 0.77, 0.9999]) {
                const t = from + share * HAPPENING_SECONDS;
                const again = happeningAt(t);
                expect(again.slot, `slot ${slot} at ${share}`).toBe(slot);
                expect(again.kind).toBe(first.kind);
                expect(again.start).toBe(first.start);
                expect(again.seed).toBe(first.seed);
                expect(again.side).toBe(first.side);
                // Its age runs with the clock from its start.
                expect(again.age).toBeCloseTo(t - first.start, 9);
            }
        }
    });

    it('starts inside its own slot and is over before the slot ends, for every window the world plays', () => {
        const longest = Math.max(...Object.values(WINDOWS));
        for (let slot = 0; slot < SLOTS; slot += 1) {
            const from = slot * HAPPENING_SECONDS;
            const h = happeningAt(from + 1);
            expect(h.start, `slot ${slot}`).toBeGreaterThanOrEqual(from);
            expect(h.start + longest, `slot ${slot}`).toBeLessThan(from + HAPPENING_SECONDS);
            // Not yet begun when its slot opens (age < 0), so nothing is ever cut in at full strength.
            expect(happeningAt(from).age, `slot ${slot}`).toBeLessThan(0);
        }
    });

    it('draws a kind from HAPPENINGS, a side and a seed; over many slots every kind comes', () => {
        const seen = Object.fromEntries(HAPPENINGS.map((kind) => [kind, 0]));
        const sides = new Set();
        for (let slot = 0; slot < SLOTS; slot += 1) {
            const h = happeningAt(slot * HAPPENING_SECONDS);
            expect(HAPPENINGS).toContain(h.kind);
            expect(Object.keys(WINDOWS)).toContain(h.kind);
            expect(Math.abs(h.side)).toBe(1);
            expect(h.seed).toBeGreaterThanOrEqual(0);
            expect(h.seed).toBeLessThan(1);
            seen[h.kind] += 1;
            sides.add(h.side);
        }
        // None of them rare: each comes at least half as often as an even draw would bring it.
        for (const kind of HAPPENINGS) expect(seen[kind], kind).toBeGreaterThan(SLOTS / HAPPENINGS.length / 2);
        expect(sides.size).toBe(2);
        // The draws differ from slot to slot (a stuck seed would start every slot at the same moment).
        const intoSlot = (slot) => happeningAt(slot * HAPPENING_SECONDS).start % HAPPENING_SECONDS;
        const starts = new Set(Array.from({ length: 50 }, (_, slot) => intoSlot(slot).toFixed(3)));
        expect(starts.size).toBeGreaterThan(40);
    });
});

describe('Painted Ages weather: a bump over a happening\'s life (swellOver)', () => {
    const shapes = [[0.07, 1.25], [0.06, 0.6], [0.05, 0.5], [0.5, 2], [1, 1.5], [3, 10]];

    it('is 0 outside (0, life) and for an age that is not a number', () => {
        for (const [rise, life] of shapes) {
            for (const age of [-5, -1e-9, 0, life, life + 1e-9, life * 3, Number.NaN, undefined]) {
                expect(swellOver(age, rise, life), `age ${age} of (${rise}, ${life})`).toBe(0);
            }
        }
    });

    it('stays within 0..1 inside, rises once and falls once', () => {
        for (const [rise, life] of shapes) {
            let prev = 0;
            let turned = false;
            let top = 0;
            for (let i = 1; i < 2000; i += 1) {
                const value = swellOver((i / 2000) * life, rise, life);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
                if (value < prev - 1e-12) turned = true;
                // Once it has begun to fall it never rises again.
                if (turned) expect(value, `(${rise}, ${life}) at ${i}`).toBeLessThanOrEqual(prev + 1e-12);
                top = Math.max(top, value);
                prev = value;
            }
            expect(top, `(${rise}, ${life})`).toBeGreaterThan(0);
        }
        // The windows the world plays reach their full strength and hold it.
        for (const [rise, life] of shapes.slice(0, 3)) expect(swellOver((rise + life * 0.55) / 2, rise, life)).toBe(1);
    });

    it('is continuous at both ends: no step where it begins or where it is gone', () => {
        for (const [rise, life] of shapes) {
            for (const eps of [1e-3, 1e-5, 1e-7].map((k) => k * life)) {
                // A share k of the life in, it has risen by no more than a few k of its rise.
                const shape = `(${rise}, ${life})`;
                expect(swellOver(eps, rise, life), `start of ${shape}`).toBeLessThanOrEqual((3 * eps) / rise);
                expect(swellOver(life - eps, rise, life), `end of ${shape}`).toBeLessThanOrEqual((7 * eps) / life);
            }
        }
    });
});
