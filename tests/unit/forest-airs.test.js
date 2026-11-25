import { describe, expect, it } from 'vitest';
import {
    FOREST_AIR_HOLD, FOREST_AIR_SCALARS, FOREST_AIR_SECONDS, FOREST_AIRS, createForestAir, forestAirAt, forestAirDrift,
    forestAirIndex, forestAirName,
} from '../../src/themes/forest/forest-airs.js';
import {
    FOREST_HOUR_PERIOD, FOREST_HOURS, forestHourDrift, forestHourName,
} from '../../src/themes/forest/forest-hours.js';
import { FOREST_VEIL_DIM, ForestLight } from '../../src/themes/forest/forest-light.js';
import { forestTier } from '../../src/themes/forest/forest-quality.js';

// The airs of the night are plain numbers: these tests assert what the light rig, the world and a
// capture rely on (the rest and the melt, the seam where the wheel comes round, what each air is
// the most of), not the numbers an air is tuned to today.
const AIRS = FOREST_AIRS.length;
const STEP = 1 / 60;
const byName = (name) => FOREST_AIRS.find((air) => air.name === name);
/** The air with the most (or the least) of a number, by name. */
const most = (key) => FOREST_AIRS.reduce((best, air) => (air[key] > best[key] ? air : best)).name;
const least = (key) => FOREST_AIRS.reduce((best, air) => (air[key] < best[key] ? air : best)).name;
/** Numbers that only scale what the hour or the tier already has: 1 leaves it as it is. */
const AGAINST_REST = ['mist', 'banks', 'drift', 'rays', 'motes', 'stars'];
/** Shares: nothing of it at 0, all of it at 1. */
const SHARES = ['veil', 'cloud', 'life', 'dance'];

describe('Forest airs: the five airs of the night', () => {
    it('are five, each named, each with every number an air sets', () => {
        expect(AIRS).toBe(5);
        expect(Object.isFrozen(FOREST_AIRS)).toBe(true);
        expect(Object.isFrozen(FOREST_AIR_SCALARS)).toBe(true);
        expect(new Set(FOREST_AIR_SCALARS).size).toBe(FOREST_AIR_SCALARS.length);
        // A capture asks for them by these names (?air=), and the diagnostics say them.
        expect(FOREST_AIRS.map((air) => air.name))
            .toEqual(['still', 'rising mist', 'night wind', 'clouded moon', 'the dance']);
        for (const air of FOREST_AIRS) {
            expect(Object.isFrozen(air)).toBe(true);
            expect(Object.keys(air).sort()).toEqual(['name', ...FOREST_AIR_SCALARS].sort());
            for (const key of FOREST_AIR_SCALARS) {
                expect(Number.isFinite(air[key]) && air[key] >= 0, `${air.name}.${key}`).toBe(true);
            }
        }
    });

    it('open still: the night as it was before there were airs', () => {
        const still = FOREST_AIRS[0];
        // What only scales the hour's own numbers leaves them alone, and nothing of the weather is up.
        for (const key of AGAINST_REST) expect(still[key], key).toBe(1);
        expect(still).toMatchObject({
            wind: 0, veil: 0, cloud: 0, dance: 0,
        });
    });

    it('keep to their ranges: a share is a share, and no air blows the night away', () => {
        for (const air of FOREST_AIRS) {
            for (const key of SHARES) expect(air[key], `${air.name}.${key}`).toBeLessThanOrEqual(1);
            expect(air.wind, air.name).toBeLessThanOrEqual(1);
            for (const key of AGAINST_REST) expect(air[key], `${air.name}.${key}`).toBeLessThan(10);
            // The wood's own light never goes out altogether, and the moon is never wholly taken.
            expect(air.veil).toBeLessThan(1);
        }
    });

    it('differ: every air is the most of what it is named for', () => {
        // Rising mist: the mist comes up and fills the ride, and the moon's beams widen in it.
        expect(most('mist')).toBe('rising mist');
        expect(most('banks')).toBe('rising mist');
        expect(byName('rising mist').rays).toBeGreaterThan(byName('still').rays);
        // Night wind: the wind gets up, the mist is torn off the floor, dust blows through the beams.
        expect(most('wind')).toBe('night wind');
        expect(most('drift')).toBe('night wind');
        expect(most('motes')).toBe('night wind');
        expect(least('mist')).toBe('night wind');
        // Clouded moon: cloud takes the moon and its beams, and what glows by itself takes the night.
        expect(most('veil')).toBe('clouded moon');
        expect(most('cloud')).toBe('clouded moon');
        expect(most('life')).toBe('clouded moon');
        expect(least('rays')).toBe('clouded moon');
        expect(least('stars')).toBe('clouded moon');
        // The dance: the cloud clears to a starry sky and the fireflies fall into step by themselves.
        expect(most('dance')).toBe('the dance');
        expect(most('stars')).toBe('the dance');
        expect(byName('the dance').veil).toBeLessThan(byName('clouded moon').veil);
        // No two airs are the same weather.
        for (let a = 0; a < AIRS; a++) {
            for (let b = a + 1; b < AIRS; b++) {
                const apart = FOREST_AIR_SCALARS.filter((key) => FOREST_AIRS[a][key] !== FOREST_AIRS[b][key]);
                expect(apart.length, `${FOREST_AIRS[a].name} and ${FOREST_AIRS[b].name}`).toBeGreaterThan(3);
            }
        }
    });

    it('hand out a place of the caller\'s own to keep an air in', () => {
        const one = createForestAir();
        const other = createForestAir();
        expect(one).not.toBe(other);
        expect(Object.keys(one).sort()).toEqual([...FOREST_AIR_SCALARS].sort());
        for (const key of FOREST_AIR_SCALARS) expect(one[key]).toBe(FOREST_AIRS[0][key]);
        // It is the caller's: writing to it does not change the airs.
        one.mist = 40;
        expect(FOREST_AIRS[0].mist).toBe(other.mist);
        expect(createForestAir().mist).toBe(other.mist);
    });
});

describe('Forest airs: the clock', () => {
    const rest = FOREST_AIR_SECONDS * FOREST_AIR_HOLD;

    it('rests, then melts into the next air', () => {
        expect(FOREST_AIR_SECONDS).toBeGreaterThan(30);
        expect(FOREST_AIR_HOLD).toBeGreaterThan(0);
        expect(FOREST_AIR_HOLD).toBeLessThan(1);
        for (let air = 0; air < 12; air++) {
            const start = air * FOREST_AIR_SECONDS;
            // The air rests: nothing moves until its rest is over.
            for (const into of [0, 1, rest * 0.5, rest - 1e-6]) expect(forestAirDrift(start + into)).toBe(air);
            expect(forestAirDrift(start + rest)).toBeCloseTo(air, 12);
            // Then it melts: on its way, and exactly there when its time is out.
            const half = forestAirDrift(start + rest + (FOREST_AIR_SECONDS - rest) / 2);
            expect(half).toBeCloseTo(air + 0.5, 10);
            expect(forestAirDrift(start + FOREST_AIR_SECONDS - 1e-9)).toBeCloseTo(air + 1, 6);
            expect(forestAirDrift(start + FOREST_AIR_SECONDS)).toBe(air + 1);
        }
    });

    it('never jumps and never turns back', () => {
        let previous = 0;
        let fastest = 0;
        for (let time = 0; time <= FOREST_AIR_SECONDS * (AIRS + 1); time += STEP) {
            const turned = forestAirDrift(time);
            expect(turned).toBeGreaterThanOrEqual(previous);
            fastest = Math.max(fastest, (turned - previous) / STEP);
            previous = turned;
        }
        // At its quickest a melt is a matter of tens of seconds, never a cut.
        expect(fastest).toBeLessThan(1 / 15);
        expect(fastest).toBeGreaterThan(1 / FOREST_AIR_SECONDS);
    });

    it('is a function of the time alone, so a seek and a night lived through agree', () => {
        for (const rate of [24, 60, 144]) {
            // A moment in the middle of a melt, reached frame by frame at this rate.
            const seconds = FOREST_AIR_SECONDS * (2 + FOREST_AIR_HOLD + (1 - FOREST_AIR_HOLD) * 0.7);
            const frames = Math.round(seconds * rate);
            let time = 0;
            for (let frame = 0; frame < frames; frame++) time += 1 / rate;
            const lived = forestAirDrift(time);
            expect(lived).toBeGreaterThan(2.5);
            expect(lived).toBeLessThan(3);
            expect(lived).toBeCloseTo(forestAirDrift(frames / rate), 8);
        }
        // No time at all, or a time before the night began, is its beginning.
        for (const nothing of [NaN, undefined, null, -40, -Infinity, 'soon', {}]) {
            expect(forestAirDrift(nothing), String(nothing)).toBe(0);
        }
        for (const late of [1e9, 1e15, Number.MAX_SAFE_INTEGER]) {
            expect(Number.isFinite(forestAirDrift(late))).toBe(true);
            expect(forestAirDrift(late)).toBeGreaterThan(0);
        }
    });

    it('turns on a clock of its own beside the hours, so an hour is not always the same weather', () => {
        expect(FOREST_AIR_SECONDS).not.toBe(FOREST_HOUR_PERIOD);
        // Lived through a few nights, every hour is seen under several airs (and every air in several hours).
        const airsOf = new Map(FOREST_HOURS.map((hour) => [hour.name, new Set()]));
        const hoursOf = new Map(FOREST_AIRS.map((air) => [air.name, new Set()]));
        const nights = 4 * FOREST_HOUR_PERIOD * FOREST_HOURS.length;
        for (let time = 0; time < nights; time += 2) {
            const hour = forestHourName(forestHourDrift(time));
            const air = forestAirName(forestAirDrift(time));
            airsOf.get(hour).add(air);
            hoursOf.get(air).add(hour);
        }
        for (const [hour, airs] of airsOf) expect(airs.size, hour).toBeGreaterThanOrEqual(3);
        for (const [air, hours] of hoursOf) expect(hours.size, air).toBeGreaterThanOrEqual(3);
    });
});

describe('Forest airs: the air at any moment', () => {
    it('is an air\'s own at a whole number, and comes round', () => {
        const out = createForestAir();
        for (let air = 0; air < AIRS; air++) {
            for (const turn of [0, 1, -1, 7, -40]) {
                expect(forestAirAt(air + turn * AIRS, out)).toBe(out);
                for (const key of FOREST_AIR_SCALARS) expect(out[key], key).toBe(FOREST_AIRS[air][key]);
                expect(forestAirName(air + turn * AIRS)).toBe(FOREST_AIRS[air].name);
            }
        }
        // Somewhere of its own when none is given, and still air for a phase that is no number.
        const fresh = forestAirAt(2);
        expect(fresh).not.toBe(out);
        expect(forestAirAt(2)).not.toBe(fresh);
        expect(fresh).toEqual(Object.fromEntries(FOREST_AIR_SCALARS.map((key) => [key, FOREST_AIRS[2][key]])));
        for (const nothing of [NaN, undefined, null, Infinity, -Infinity, 'windy', {}]) {
            expect(forestAirAt(nothing, out)).toEqual(createForestAir());
            expect(forestAirName(nothing)).toBe('still');
        }
    });

    it('lies between two airs otherwise: every number between its two neighbours\'', () => {
        const out = createForestAir();
        for (let air = 0; air < AIRS; air++) {
            const a = FOREST_AIRS[air];
            const b = FOREST_AIRS[(air + 1) % AIRS];
            for (const part of [0.1, 0.5, 0.93]) {
                forestAirAt(air + part, out);
                for (const key of FOREST_AIR_SCALARS) {
                    expect(out[key], `${a.name} + ${part}: ${key}`).toBeCloseTo(a[key] + (b[key] - a[key]) * part, 12);
                }
            }
            // The name is the nearer air's.
            expect(forestAirName(air + 0.4)).toBe(a.name);
            expect(forestAirName(air + 0.6)).toBe(b.name);
        }
    });

    it('comes round for a phase before the night began, or far beyond it', () => {
        const out = createForestAir();
        const last = FOREST_AIRS[AIRS - 1];
        const first = FOREST_AIRS[0];
        // A quarter of an air before the start: three quarters of the way from the last air to the first.
        forestAirAt(-0.25, out);
        for (const key of FOREST_AIR_SCALARS) {
            expect(out[key], key).toBeCloseTo(last[key] + (first[key] - last[key]) * 0.75, 12);
        }
        expect(forestAirName(-0.25)).toBe(first.name);
        expect(forestAirName(-0.75)).toBe(last.name);
        // However far round, it is still one of the airs or between two of them: every number in its range.
        const reach = (pick) => Object.fromEntries(FOREST_AIR_SCALARS
            .map((key) => [key, pick(...FOREST_AIRS.map((air) => air[key]))]));
        const low = reach(Math.min);
        const high = reach(Math.max);
        const names = FOREST_AIRS.map((air) => air.name);
        for (const phase of [-1e9, -12345.678, -AIRS, -0, 1e-12, 4.999999, 1e6 + 0.3, 1e15, 2 ** 53, -(2 ** 53), 1e300,
            -1e300, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE]) {
            forestAirAt(phase, out);
            for (const key of FOREST_AIR_SCALARS) {
                expect(Number.isFinite(out[key]), `${phase}: ${key}`).toBe(true);
                expect(out[key], `${phase}: ${key}`).toBeGreaterThanOrEqual(low[key] - 1e-12);
                expect(out[key], `${phase}: ${key}`).toBeLessThanOrEqual(high[key] + 1e-12);
            }
            expect(names).toContain(forestAirName(phase));
        }
    });

    it('moves slowly through a whole round, the seam back to still air included', () => {
        const out = createForestAir();
        const previous = forestAirAt(0);
        const melt = FOREST_AIR_SECONDS * (1 - FOREST_AIR_HOLD);
        // The widest step each number takes between two neighbours on the wheel.
        const widest = Object.fromEntries(FOREST_AIR_SCALARS.map((key) => [key, Math.max(...FOREST_AIRS
            .map((air, index) => Math.abs(FOREST_AIRS[(index + 1) % AIRS][key] - air[key])))]));
        const step = 0.25;
        const moved = Object.fromEntries(FOREST_AIR_SCALARS.map((key) => [key, 0]));
        for (let time = step; time <= FOREST_AIR_SECONDS * AIRS * 2; time += step) {
            forestAirAt(forestAirDrift(time), out);
            for (const key of FOREST_AIR_SCALARS) {
                const rate = Math.abs(out[key] - previous[key]) / step;
                // An eased melt is at its quickest half-way: one and a half times its mean pace.
                expect(rate, `${key} at ${time}s`).toBeLessThanOrEqual((widest[key] * 1.5) / melt + 1e-9);
                moved[key] = Math.max(moved[key], rate);
                previous[key] = out[key];
            }
        }
        // And everything an air changes really is on the move at some time of the night.
        for (const key of FOREST_AIR_SCALARS) if (widest[key] > 0) expect(moved[key], key).toBeGreaterThan(0);
        // Two rounds on, the night is back in still air, to the last digit.
        expect(forestAirAt(forestAirDrift(FOREST_AIR_SECONDS * AIRS * 2))).toEqual(createForestAir());
    });
});

describe('Forest airs: an air by its name or its number', () => {
    it('knows every air by name, however a capture spells it', () => {
        FOREST_AIRS.forEach((air, index) => {
            const spellings = [air.name, air.name.toUpperCase(), `  ${air.name}  `, air.name.replace(/ /g, '-'),
                air.name.replace(/ /g, '_'), air.name.replace(/ /g, ''), air.name.replace(/ /g, '   ')];
            for (const spelling of spellings) expect(forestAirIndex(spelling), spelling).toBe(index);
            expect(forestAirIndex(index)).toBe(index);
            expect(forestAirIndex(String(index))).toBe(index);
            expect(forestAirIndex(` ${index} `)).toBe(index);
            // And back: the name of that number is that air's.
            expect(forestAirName(forestAirIndex(air.name))).toBe(air.name);
        });
    });

    it('reads a number as an air the way the wheel does: the nearest, and round', () => {
        expect(forestAirIndex(AIRS)).toBe(0);
        expect(forestAirIndex(AIRS + 2)).toBe(2);
        expect(forestAirIndex(-1)).toBe(AIRS - 1);
        expect(forestAirIndex(2.4)).toBe(2);
        expect(forestAirIndex(2.6)).toBe(3);
        expect(forestAirIndex('7')).toBe(7 % AIRS);
        expect(forestAirIndex(-0)).toBe(0);
        for (const number of [1e9, -1e9, 1e300, -1e300, 123456.7]) {
            const index = forestAirIndex(number);
            expect(Number.isInteger(index) && index >= 0 && index < AIRS, String(number)).toBe(true);
        }
    });

    it.each([
        ['null', null], ['nothing', undefined], ['an empty name', ''], ['a blank', '   '], ['fog', 'fog'],
        ['still air', 'still air'], ['mist', 'mist'], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity],
        ['true', true], ['false', false], ['an empty list', []], ['a list', [2]], ['an object', {}],
        ['an air itself', FOREST_AIRS[0]], ['a function', () => 1], ['a symbol', Symbol('still')], ['a bigint', 2n],
    ])('says there is no such air as %s', (_label, which) => {
        expect(forestAirIndex(which)).toBe(-1);
    });

    it('names the nearest air for any phase', () => {
        for (let air = 0; air < AIRS; air++) {
            for (const off of [-0.49, -0.2, 0, 0.2, 0.49]) expect(forestAirName(air + off)).toBe(FOREST_AIRS[air].name);
        }
        const names = FOREST_AIRS.map((air) => air.name);
        for (const phase of [-1e12, 1e12, 1e300, -1e300, Number.MAX_VALUE]) {
            expect(names).toContain(forestAirName(phase));
        }
        for (const nothing of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
            expect(forestAirName(nothing), String(nothing)).toBe('still');
        }
    });
});

describe('Forest airs: the light rig', () => {
    function rig(quality = 'Minimal') {
        return new ForestLight({ tier: forestTier(quality), rng: () => 0.5 });
    }
    /** Every number of the weather the rig hands the shaders. */
    const weather = (light) => ({
        haze: light.uHaze.value,
        stars: light.uStars.value,
        cloud: light.uCloud.value,
        banks: light.uBanks.value,
        motes: light.uMotes.value,
        life: light.uLife.value,
        veil: light.uVeil.value,
        wind: light.uWind.value,
        gust: light.uGust.value,
    });

    it('starts in still air, the hour\'s own numbers untouched', () => {
        const light = rig();
        expect(light.air).toEqual(createForestAir());
        expect(light.uHaze.value).toBe(FOREST_HOURS[0].haze);
        expect(light.uStars.value).toBe(FOREST_HOURS[0].stars);
        expect(weather(light)).toMatchObject({
            cloud: 0, banks: 1, motes: 1, veil: 0, life: FOREST_AIRS[0].life,
        });
        expect([light.uCloudScroll.value, light.uMistScroll.value, light.uFoxfire.value]).toEqual([0, 0, 0]);
        // A frame of still air leaves the moon and the wind exactly as an airless night had them.
        const gain = light.uMoonGain.value;
        light.update(1, STEP, {});
        expect(light.uMoonGain.value).toBe(gain);
        expect(light.uGust.value).toBe(0);
        expect(light.uVeil.value).toBe(0);
        light.dispose();
    });

    it('takes an air by copying its numbers: the same uniforms, its own record', () => {
        const light = rig();
        const record = light.air;
        const names = ['uHaze', 'uStars', 'uCloud', 'uBanks', 'uMotes', 'uLife', 'uVeil'];
        const uniforms = names.map((name) => light[name]);
        const values = uniforms.map((uniform) => uniform.value);
        const air = forestAirAt(3);
        light.setAir(air);
        expect(light.air).toBe(record);
        expect(light.air).toEqual(air);
        expect(light.air).not.toBe(air);
        // The caller's air can be filled again without the rig's changing under it.
        forestAirAt(1, air);
        expect(light.air).toEqual(forestAirAt(3));
        // Values only: no uniform was replaced, and at least one of them changed.
        names.forEach((name, index) => expect(light[name] === uniforms[index], name).toBe(true));
        expect(uniforms.map((uniform) => uniform.value)).not.toEqual(values);
        light.dispose();
    });

    it('lays the air over the hour, whichever of the two turns last', () => {
        const light = rig();
        const expected = (hourPhase, airPhase) => {
            const hour = FOREST_HOURS[hourPhase];
            const air = forestAirAt(airPhase);
            return {
                haze: hour.haze * air.mist,
                stars: hour.stars * air.stars,
                cloud: air.cloud,
                banks: air.banks,
                motes: air.motes,
                life: air.life,
            };
        };
        for (let hour = 0; hour < FOREST_HOURS.length; hour++) {
            for (const airPhase of [0, 1, 2, 3, 4, 1.5, 3.25]) {
                for (const hourFirst of [true, false]) {
                    if (hourFirst) light.setHour(hour);
                    light.setAir(forestAirAt(airPhase));
                    if (!hourFirst) light.setHour(hour);
                    const now = weather(light);
                    for (const [key, value] of Object.entries(expected(hour, airPhase))) {
                        expect(now[key], `hour ${hour}, air ${airPhase}: ${key}`).toBeCloseTo(value, 12);
                    }
                }
            }
        }
        // More mist in the air is thicker night air; fewer stars under cloud: in every hour.
        for (let hour = 0; hour < FOREST_HOURS.length; hour++) {
            light.setHour(hour);
            light.setAir(forestAirAt(forestAirIndex('still')));
            const still = weather(light);
            light.setAir(forestAirAt(forestAirIndex('rising mist')));
            expect(light.uHaze.value).toBeGreaterThan(still.haze);
            light.setAir(forestAirAt(forestAirIndex('clouded moon')));
            expect(light.uStars.value).toBeLessThanOrEqual(still.stars);
            expect(light.uCloud.value).toBeGreaterThan(still.cloud);
        }
        light.dispose();
    });

    it('keeps the air it has when handed what is no air, and takes only the numbers it knows', () => {
        const light = rig();
        light.setAir(forestAirAt(2));
        const held = { ...light.air };
        const before = weather(light);
        for (const nothing of [null, undefined, {}, 7, 'windy', [], { mist: NaN }, { mist: Infinity, wind: '0.3' },
            { fog: 3 }, { mist: null, stars: undefined }]) {
            expect(() => light.setAir(nothing)).not.toThrow();
            expect(light.air).toEqual(held);
            expect(weather(light)).toEqual(before);
        }
        expect(Object.keys(light.air).sort()).toEqual([...FOREST_AIR_SCALARS].sort());
        // Part of an air changes that part.
        light.setAir({ mist: held.mist * 2 });
        expect(light.air).toEqual({ ...held, mist: held.mist * 2 });
        expect(light.uHaze.value).toBeCloseTo(before.haze * 2, 12);
        expect(light.uStars.value).toBe(before.stars);
        light.dispose();
    });

    it('bounds what an air may do to the night', () => {
        const light = rig();
        light.setAir({
            mist: -4, stars: -4, banks: -4, motes: -4, cloud: -4, life: -4,
        });
        expect(weather(light)).toMatchObject({
            haze: 0, stars: 0, banks: 0, motes: 0, cloud: 0, life: 0,
        });
        light.setAir({ cloud: 40, life: 40, veil: 40 });
        light.update(1, STEP, {});
        expect(weather(light)).toMatchObject({ cloud: 1, life: 1, veil: 1 });
        // The moon wholly behind cloud is dimmed, never put out.
        expect(light.uMoonGain.value).toBeCloseTo(1 - FOREST_VEIL_DIM, 12);
        expect(light.uMoonGain.value).toBeGreaterThan(0);
        light.setAir({ veil: -40 });
        light.update(1, STEP, {});
        expect(light.uVeil.value).toBe(0);
        expect(light.uMoonGain.value).toBe(1);
        light.dispose();
    });

    it('draws cloud over the moon by the air\'s share, and dims the moon by as much', () => {
        const light = rig();
        const gains = [0, 0.25, 0.5, 0.75, 1].map((veil) => {
            light.setAir({ veil });
            light.update(1, STEP, {});
            expect(light.uVeil.value).toBeCloseTo(veil, 12);
            return light.uMoonGain.value;
        });
        expect(gains[0]).toBe(1);
        for (let index = 1; index < gains.length; index++) expect(gains[index]).toBeLessThan(gains[index - 1]);
        expect(gains.at(-1)).toBeCloseTo(1 - FOREST_VEIL_DIM, 12);
        // An event still lifts a veiled moon, in proportion: the cloud takes its share of whatever light there is.
        light.setAir({ veil: 0.5 });
        light.update(1, STEP, { moon: 1 });
        const lifted = light.uMoonGain.value;
        light.setAir({ veil: 0 });
        light.update(1, STEP, { moon: 1 });
        expect(lifted).toBeCloseTo(light.uMoonGain.value * (1 - FOREST_VEIL_DIM * 0.5), 12);
        light.dispose();
    });

    it('raises the wind with the air: a standing wind, and swells of it that come and go', () => {
        const light = rig();
        light.update(0, STEP, {});
        const rest = light.uWind.value;
        expect(rest).toBeGreaterThan(0);
        const blowing = [0.1, 0.3, 0.6].map((wind) => {
            light.setAir({ wind });
            const gusts = [];
            const standing = [];
            for (let second = 0; second < 240; second++) {
                light.update(second, 1, {});
                gusts.push(light.uGust.value);
                standing.push(light.uWind.value);
            }
            // The standing wind does not flutter: it is the air's, whatever the clock says.
            expect(new Set(standing).size).toBe(1);
            return { standing: standing[0], low: Math.min(...gusts), high: Math.max(...gusts) };
        });
        blowing.forEach((air, index) => {
            expect(air.standing).toBeGreaterThan(index ? blowing[index - 1].standing : rest);
            // The swells never die away altogether, and never turn the wind round.
            expect(air.low).toBeGreaterThan(0);
            expect(air.high).toBeGreaterThan(air.low * 1.5);
            if (index) expect(air.high).toBeGreaterThan(blowing[index - 1].high);
        });
        // An event's gust comes on top of the air's wind, and still air adds nothing to it.
        light.setAir({ wind: 0.3 });
        light.update(10, STEP, {});
        const airOnly = light.uGust.value;
        light.update(10, STEP, { gust: 0.5 });
        const both = light.uGust.value;
        expect(both).toBeGreaterThan(airOnly);
        light.setAir({ wind: 0 });
        light.update(10, STEP, { gust: 0.5 });
        expect(light.uGust.value).toBeCloseTo(both - airOnly, 12);
        expect(light.uWind.value).toBe(rest);
        light.dispose();
    });

    it('moves the mist and the cloud at the air\'s pace, summed so a change of pace never jumps them', () => {
        const light = rig();
        light.setAir({ drift: 1 });
        for (let frame = 0; frame < 120; frame++) light.update(frame * STEP, STEP, {});
        const calm = light.uMistScroll.value;
        expect(calm).toBeCloseTo(2, 9);
        expect(light.uCloudScroll.value).toBeCloseTo(calm, 12);
        // The wind gets up: from the next frame the drift runs faster, from where it had got to.
        light.setAir({ drift: 4 });
        expect(light.uMistScroll.value).toBe(calm);
        light.update(2, STEP, {});
        expect(light.uMistScroll.value).toBeCloseTo(calm + 4 * STEP, 12);
        for (let frame = 1; frame < 60; frame++) light.update(2 + frame * STEP, STEP, {});
        expect(light.uMistScroll.value).toBeCloseTo(calm + 4, 9);
        // By the time lived, not by the frames: one long step is the same drift.
        const hitch = rig();
        hitch.setAir({ drift: 4 });
        hitch.update(1, 1, {});
        expect(hitch.uMistScroll.value).toBeCloseTo(4, 12);
        // A step that is no time moves nothing.
        const held = light.uMistScroll.value;
        for (const step of [0, -1, NaN, Infinity, undefined, null, '1']) {
            light.update(3, step, {});
            expect(light.uMistScroll.value, String(step)).toBe(held);
            expect(light.uCloudScroll.value, String(step)).toBe(held);
        }
        // Forgetting the effects in flight leaves the drift where it is; a rewind starts it again.
        light.reset();
        expect(light.uMistScroll.value).toBe(held);
        light.rewind();
        expect([light.uMistScroll.value, light.uCloudScroll.value]).toEqual([0, 0]);
        hitch.dispose();
        light.dispose();
    });

    it('lets the wood burn with its own light by the air, or for a moment by three lines', () => {
        const light = rig();
        light.setAir({ life: 0.2 });
        light.update(1, STEP, {});
        expect(light.uLife.value).toBeCloseTo(0.2, 12);
        expect(light.uFoxfire.value).toBe(0);
        // Three lines light it brighter than the night does: the greater of the two, never their sum.
        light.update(1, STEP, { foxfire: 0.7 });
        expect(light.uFoxfire.value).toBeCloseTo(0.7, 12);
        expect(light.uLife.value).toBeCloseTo(0.7, 12);
        // On a clouded night a faint foxfire changes nothing: it already burns.
        light.setAir({ life: 0.9 });
        light.update(1, STEP, { foxfire: 0.3 });
        expect(light.uLife.value).toBeCloseTo(0.9, 12);
        expect(light.uFoxfire.value).toBeCloseTo(0.3, 12);
        // It falls back to the air's when the moment has passed, and junk is no light at all.
        light.setAir({ life: 0.2 });
        for (const foxfire of [undefined, NaN, -3, Infinity, null, 'lit']) {
            light.update(1, STEP, { foxfire });
            expect(light.uFoxfire.value, String(foxfire)).toBe(0);
            expect(light.uLife.value, String(foxfire)).toBeCloseTo(0.2, 12);
        }
        light.update(1, STEP, { foxfire: 40 });
        expect([light.uFoxfire.value, light.uLife.value]).toEqual([1, 1]);
        light.dispose();
    });
});
