/**
 * Rainbow Terraces — the air and what happens in it by itself (rainbow-terraces-weather.js).
 *
 * The air is numbers on a wheel of its own beside the hours', and a happening is a pure function
 * of the clock: these pin the wheel's shape (it rests, it crosses, it wraps), that every air is a
 * weather of its own, that an air never breaks a colour, and that the slots play what the hour and
 * the air allow, inside their own seconds, the same on every asking.
 */
import { describe, expect, it } from 'vitest';
import {
    AIR_NAMES, AIR_REST, AIR_SCALARS, AIR_SECONDS, HAPPENINGS, HAPPEN_FIRST, SLOT_SECONDS, airAt, airPlace, happeningAt,
    leanColours,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-weather.js';
import { HOURS, HOUR_SECONDS } from '../../src/themes/rainbow-terraces/rainbow-terraces-hours.js';

const copyColours = (hour) => Object.fromEntries(Object.entries(hour.colour).map(([key, c]) => [key, [...c]]));
const DAY = { night: 0, storm: 0.85, rays: true };
const NIGHT = { night: 1, storm: 0.6, rays: true };

describe('Rainbow Terraces weather: the wheel of airs', () => {
    it('names five airs, each with every number', () => {
        expect(AIR_NAMES).toHaveLength(5);
        Object.entries(AIR_SCALARS).forEach(([name, row]) => {
            expect(row, name).toHaveLength(AIR_NAMES.length);
            row.forEach((v) => expect(Number.isFinite(v), name).toBe(true));
        });
    });

    it('starts on the fair air, which changes nothing', () => {
        const air = airAt(0);
        expect(air.name).toBe('fair');
        const s = air.scalar;
        ['shower', 'deck', 'cirrus', 'spray', 'wedge', 'wind', 'swell', 'gain', 'veil', 'polar', 'expose'].forEach((key) => {
            expect(s[key], key).toBe(1);
        });
        ['swing', 'rays', 'bow', 'fogbow', 'haze', 'deepen', 'glow'].forEach((key) => expect(s[key], key).toBe(0));
    });

    it('rests on an air at each end of its time and crosses in between, never stepping', () => {
        for (let k = 0; k < AIR_NAMES.length; k++) {
            const early = airAt(k + AIR_REST * 0.5);
            const late = airAt(k + 1 - AIR_REST * 0.5);
            expect(early.mix).toBe(0);
            expect(late.mix).toBe(1);
            expect(early.name).toBe(AIR_NAMES[k]);
            expect(late.name).toBe(AIR_NAMES[(k + 1) % AIR_NAMES.length]);
        }
        // Along the whole wheel no number moves more than a little in a thirtieth of a second.
        const step = 1 / 30 / AIR_SECONDS;
        const keys = Object.keys(airAt(0).scalar);
        for (let p = step; p < AIR_NAMES.length + 0.01; p += step * 7) {
            const prev = { ...airAt(p - step).scalar };
            const next = airAt(p).scalar;
            for (const key of keys) {
                expect(Math.abs(next[key] - prev[key]), `${key} at ${p.toFixed(3)}`).toBeLessThan(0.004);
            }
        }
    });

    it('wraps: the place after the last air is the first again', () => {
        const a = airAt(0.4);
        const b = airAt(0.4 + AIR_NAMES.length * 3);
        Object.keys(a.scalar).forEach((key) => expect(b.scalar[key], key).toBeCloseTo(a.scalar[key], 9));
        expect(airAt(-0.6).name).toBe(airAt(AIR_NAMES.length - 0.6).name);
        expect(airPlace(AIR_SECONDS * 2.5)).toBeCloseTo(2.5, 9);
    });

    it('turns at its own pace beside the hours: the same pair does not come back for an hour and more', () => {
        // One day of hours and one round of airs are different lengths, with no small common multiple.
        const day = HOUR_SECONDS * HOURS.length;
        const round = AIR_SECONDS * AIR_NAMES.length;
        expect(day).not.toBe(round);
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        expect((day * round) / gcd(day, round)).toBeGreaterThan(3600);
    });

    it('makes every air a weather of its own', () => {
        const at = AIR_NAMES.map((_, k) => airAt(k).scalar);
        for (let a = 0; a < at.length; a++) {
            for (let b = a + 1; b < at.length; b++) {
                const apart = Object.keys(at[a]).filter((key) => Math.abs(at[a][key] - at[b][key]) > 0.1).length;
                expect(apart, `${AIR_NAMES[a]} vs ${AIR_NAMES[b]}`).toBeGreaterThanOrEqual(5);
            }
        }
        const by = (name) => at[AIR_NAMES.indexOf(name)];
        // The showers hold the most storm and the most bow; the crystal air the least of both.
        expect(by('showers').shower).toBeGreaterThan(by('fair').shower);
        expect(by('crystal').shower).toBeLessThan(by('fair').shower);
        expect(by('showers').bow).toBeGreaterThan(by('crystal').bow);
        // The beams hold the deepest rays; the mist the most haze and the flattest, stillest sea.
        expect(by('beams').rays).toBe(Math.max(...at.map((s) => s.rays)));
        expect(by('mist').haze).toBe(Math.max(...at.map((s) => s.haze)));
        expect(by('mist').wind).toBe(Math.min(...at.map((s) => s.wind)));
        expect(by('mist').swell).toBe(Math.min(...at.map((s) => s.swell)));
    });
});

describe('Rainbow Terraces weather: an air leans on the hour\'s colours', () => {
    it('leaves the fair air\'s colours alone', () => {
        HOURS.forEach((hour) => {
            const colour = copyColours(hour);
            leanColours(colour, airAt(0).scalar);
            Object.keys(colour).forEach((key) => expect(colour[key], `${hour.name} ${key}`).toEqual([...hour.colour[key]]));
        });
    });

    it('keeps every colour a colour in every hour and air (finite, never negative, never blown out)', () => {
        HOURS.forEach((hour) => {
            for (let p = 0; p < AIR_NAMES.length; p += 0.125) {
                const colour = copyColours(hour);
                leanColours(colour, airAt(p).scalar);
                Object.entries(colour).forEach(([key, c]) => {
                    c.forEach((v) => {
                        expect(Number.isFinite(v), `${hour.name} ${key} at ${p}`).toBe(true);
                        expect(v, `${hour.name} ${key} at ${p}`).toBeGreaterThanOrEqual(0);
                        expect(v, `${hour.name} ${key} at ${p}`).toBeLessThanOrEqual(1.0001);
                    });
                });
            }
        });
    });

    it('pours the mist into the horizon, and washes it clear in the crystal air', () => {
        const hour = HOURS[0];
        const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const mist = copyColours(hour);
        leanColours(mist, airAt(AIR_NAMES.indexOf('mist')).scalar);
        // Nearer the mist's light than the hour's own horizon was; the zenith paler.
        expect(far(mist.horizon, hour.colour.mistLit)).toBeLessThan(far(hour.colour.horizon, hour.colour.mistLit));
        expect(luma(mist.zenith)).toBeGreaterThan(luma(hour.colour.zenith));
        const clear = copyColours(hour);
        leanColours(clear, airAt(AIR_NAMES.indexOf('crystal')).scalar);
        expect(luma(clear.zenith)).toBeLessThan(luma(hour.colour.zenith));
        const rain = copyColours(hour);
        leanColours(rain, airAt(AIR_NAMES.indexOf('showers')).scalar);
        expect(far(rain.zenith, hour.colour.shower)).toBeLessThan(far(hour.colour.zenith, hour.colour.shower));
    });
});

describe('Rainbow Terraces weather: what happens by itself', () => {
    it('holds its breath at first, then plays one thing a slot, inside the slot', () => {
        expect(happeningAt(HAPPEN_FIRST * 0.5, DAY).kind).toBe(null);
        for (let slot = 0; slot < 400; slot++) {
            const start = HAPPEN_FIRST + slot * SLOT_SECONDS;
            const hap = happeningAt(start + 0.01, DAY);
            expect(hap.slot).toBe(slot);
            if (hap.kind === null) continue;
            expect(Object.keys(HAPPENINGS)).toContain(hap.kind);
            expect(hap.length).toBe(HAPPENINGS[hap.kind].length);
            expect(hap.at).toBeGreaterThanOrEqual(start);
            expect(hap.at + hap.length).toBeLessThanOrEqual(start + SLOT_SECONDS);
        }
    });

    it('is a pure function of the clock (the same asking, the same answer)', () => {
        for (let t = 0; t < 900; t += 3.7) {
            const a = happeningAt(t, DAY, {});
            const b = happeningAt(t, DAY, {});
            expect(b).toEqual(a);
        }
    });

    it('rises and falls slowly: its weight is nothing at both ends and never more than one', () => {
        for (let slot = 0; slot < 120; slot++) {
            const first = happeningAt(HAPPEN_FIRST + slot * SLOT_SECONDS + 0.01, DAY);
            if (first.kind === null) continue;
            const { at, length } = first;
            expect(happeningAt(at - 0.01, DAY).env).toBe(0);
            expect(happeningAt(at + length + 0.01, DAY).env).toBe(0);
            let prev = 0;
            for (let age = 0; age <= length; age += 1 / 30) {
                const { env } = happeningAt(at + age, DAY);
                expect(env).toBeGreaterThanOrEqual(0);
                expect(env).toBeLessThanOrEqual(1);
                expect(Math.abs(env - prev), `${first.kind} at ${age.toFixed(2)}`).toBeLessThan(0.05);
                prev = env;
            }
        }
    });

    it('plays only what the hour and the air allow', () => {
        const kindsIn = (context) => {
            const seen = new Map();
            for (let slot = 0; slot < 1500; slot++) {
                const hap = happeningAt(HAPPEN_FIRST + slot * SLOT_SECONDS + 0.01, context);
                seen.set(hap.kind, (seen.get(hap.kind) || 0) + 1);
            }
            return seen;
        };
        const day = kindsIn(DAY);
        expect(day.has('meteors')).toBe(false); // no shooting stars by day
        ['flight', 'beams', 'plume', 'veil', 'flicker'].forEach((kind) => expect(day.get(kind), kind).toBeGreaterThan(20));
        // About one slot in five rests.
        expect(day.get(null) / 1500).toBeGreaterThan(0.1);
        expect(day.get(null) / 1500).toBeLessThan(0.3);
        // Nothing takes over.
        day.forEach((count, kind) => expect(count / 1500, String(kind)).toBeLessThan(0.45));
        const night = kindsIn(NIGHT);
        expect(night.get('meteors')).toBeGreaterThan(100); // the night's own, and often
        const clearSky = kindsIn({ night: 0, storm: 0.2, rays: true });
        expect(clearSky.has('flicker')).toBe(false); // no lightning without a storm
        const lean = kindsIn({ night: 0, storm: 0.85, rays: false });
        expect(lean.has('beams')).toBe(false); // a tier that draws no rays surges none
    });

    it('seldom plays the same thing twice running', () => {
        let same = 0;
        let pairs = 0;
        let last = null;
        for (let slot = 0; slot < 1500; slot++) {
            const { kind } = happeningAt(HAPPEN_FIRST + slot * SLOT_SECONDS + 0.01, DAY);
            if (kind !== null && last !== null) {
                pairs += 1;
                if (kind === last) same += 1;
            }
            last = kind;
        }
        expect(same / pairs).toBeLessThan(0.3);
    });
});
