/**
 * Painted Ages — the hours of light.
 *
 * The house rule (the owner's, for every theme): the palette drifts with the CLOCK by itself,
 * whatever the level, resting only a small share of each step on an hour's own light; a level-up
 * adds a whole hour on top, stepping forward from where the light was heading, never back.
 *
 * Measured once and pinned a little below: the half-way mixes of neighbouring hours keep their
 * colour (chroma of the sun ≥ 0.36, the horizon ≥ 0.12, the haze ≥ 0.09 at the time of writing).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TIMING } from '../../src/themes/painted-ages/painted-ages-core.js';
import {
    HOURS, HOUR_COUNT, HourWheel, blendLight, chroma, copyLight, createLight, hourMix, hourPlace, lightAt,
} from '../../src/themes/painted-ages/painted-ages-hours.js';
import { PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';

const COLOUR_KEYS = [
    'sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'snow',
];
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity'];
const ARRAY_KEYS = [...COLOUR_KEYS, 'dir'];
const BLUE_HOUR = HOURS.findIndex((hour) => hour.name === 'blue hour');

/** How far two lights are apart: the largest difference of any colour channel or scalar. */
function distance(a, b) {
    let d = 0;
    for (const key of COLOUR_KEYS) for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[key][c] - b[key][c]));
    for (const key of SCALAR_KEYS) d = Math.max(d, Math.abs(a[key] - b[key]));
    return d;
}

/** True when a light is exactly an hour's own palette. */
function isHour(light, index) {
    const hour = HOURS[index];
    return COLOUR_KEYS.every((key) => hour[key].every((v, c) => Math.abs(light[key][c] - v) < 1e-9))
        && SCALAR_KEYS.every((key) => Math.abs(light[key] - hour[key]) < 1e-9);
}

const lightOf = (wheel, t) => lightAt(wheel.place(t));

describe('Painted Ages hours: the wheel', () => {
    it('is a day of six hours, each with every colour and scalar the world reads', () => {
        expect(HOUR_COUNT).toBe(6);
        expect(HOURS.map((hour) => hour.name)).toEqual([
            'first light', 'morning', 'high day', 'afternoon', 'sunset', 'blue hour',
        ]);
        HOURS.forEach((hour) => {
            COLOUR_KEYS.forEach((key) => {
                expect(hour[key], `${hour.name}.${key}`).toHaveLength(3);
                hour[key].forEach((v) => expect(v >= 0 && Number.isFinite(v), `${hour.name}.${key}`).toBe(true));
            });
            SCALAR_KEYS.forEach((key) => expect(Number.isFinite(hour[key]), `${hour.name}.${key}`).toBe(true));
        });
    });

    it('places the wheel at the clock plus the level: one hour per TIMING.hour seconds', () => {
        expect(hourPlace(1, 0)).toBe(0);
        expect(hourPlace(1, TIMING.hour)).toBeCloseTo(1, 12);
        expect(hourPlace(3, TIMING.hour / 2)).toBeCloseTo(2.5, 12);
        expect(hourPlace(1, -50)).toBe(0);
        expect(hourPlace(1, Number.NaN)).toBe(0);
        expect(hourPlace(undefined, 0)).toBe(0);
    });

    it('rests TIMING.hourRest of each step at each end, and is on its way the rest of it', () => {
        const rest = TIMING.hourRest;
        expect(rest).toBe(0.15);
        for (let k = 0; k < 6; k++) {
            // (A hair inside each edge: k + 0.15 − k is not exactly 0.15 in floating point.)
            for (const f of [0, rest * 0.5, rest - 1e-9]) expect(hourMix(k + f).mix, `${k} + ${f}`).toBe(0);
            for (const f of [1 - rest + 1e-9, 1 - rest * 0.5, 0.999]) expect(hourMix(k + f).mix, `${k} + ${f}`).toBe(1);
            let previous = 0;
            for (let f = rest + 0.01; f < 1 - rest; f += 0.01) {
                const { mix } = hourMix(k + f);
                expect(mix, `${k} + ${f}`).toBeGreaterThan(previous);
                expect(mix).toBeLessThan(1);
                previous = mix;
            }
            expect(hourMix(k + 0.5).mix).toBeCloseTo(0.5, 12);
        }
    });

    it('wraps round the day', () => {
        expect(hourMix(5.5)).toMatchObject({ from: 5, to: 0 });
        expect(hourMix(6.2)).toMatchObject({ from: 0, to: 1 });
        expect(hourMix(-0.5)).toMatchObject({ from: 5, to: 0 });
        expect(hourMix(Number.NaN)).toMatchObject({ from: 0, to: 1, mix: 0 });
        expect(distance(lightAt(1.3), lightAt(1.3 + 6 * 7))).toBeLessThan(1e-9);
    });
});

describe('Painted Ages hours: the clock alone', () => {
    it('has moved the light within the first minute, at a fixed level with no gameplay', () => {
        const wheel = new HourWheel();
        const start = lightOf(wheel, 0);
        expect(isHour(start, 0)).toBe(true);
        expect(distance(lightOf(wheel, 60), start)).toBeGreaterThan(0.1);
        // It starts moving as soon as the rest is over...
        const restEnds = TIMING.hourRest * TIMING.hour;
        expect(restEnds).toBeLessThan(60);
        expect(distance(lightOf(wheel, restEnds + 5), start)).toBeGreaterThan(0);
        // ...and keeps moving: no five seconds of the step's middle hold still.
        for (let t = restEnds + 1; t < TIMING.hour - restEnds - 5; t += 5) {
            expect(distance(lightOf(wheel, t + 5), lightOf(wheel, t)), `t = ${t}`).toBeGreaterThan(1e-4);
        }
    });

    it('stands on the next hour one TIMING.hour later, and on each hour after it', () => {
        const wheel = new HourWheel();
        for (let k = 0; k <= 7; k++) {
            const light = lightOf(wheel, k * TIMING.hour);
            expect(isHour(light, k % HOUR_COUNT), `after ${k} hours`).toBe(true);
            expect(light.from).toBe(k % HOUR_COUNT);
        }
    });

    it('drifts the same at every level: the level is added on top of the clock, never instead of it', () => {
        for (const level of [1, 2, 4, 7, 12]) {
            const wheel = new HourWheel();
            wheel.levelUp(level, 0, true);
            for (const t of [0, 15, 37, 60, 100, 250, 999]) {
                expect(wheel.place(t), `level ${level}, t = ${t}`).toBeCloseTo(level - 1 + t / TIMING.hour, 9);
            }
            expect(distance(lightOf(wheel, 60), lightOf(wheel, 0)), `level ${level}`).toBeGreaterThan(0.05);
        }
    });

    it('drifts in the world too: the world\'s own light moves with the clock at level 1 and at level 6', () => {
        for (const level of [1, 6]) {
            // No build is needed: the light is CPU state the update writes into the uniforms.
            const world = new PaintedAgesWorld({ scene: new THREE.Scene(), quality: 'Low' });
            world.levelUp(level, { silent: true, time: 0 });
            const at = (time) => {
                world.update({ time, delta: 1 / 30 });
                return copyLight(world.light, createLight());
            };
            const first = at(0);
            expect(first.place).toBeCloseTo(level - 1, 9);
            expect(distance(at(60), first), `level ${level}`).toBeGreaterThan(0.05);
            const later = at(TIMING.hour);
            expect(isHour(later, level % HOUR_COUNT), `level ${level}`).toBe(true);
            expect(world.getState().level).toBe(level);
            // The uniforms follow the light.
            expect(world.u.sun.value.toArray()).toEqual(later.sun);
            world.dispose();
        }
    });
});

describe('Painted Ages hours: level-ups', () => {
    it('add a whole hour on top of the clock, eased over TIMING.levelTurn from where the light stood', () => {
        const wheel = new HourWheel();
        const t0 = 30;
        const before = wheel.place(t0);
        wheel.levelUp(2, t0);
        expect(wheel.place(t0)).toBeCloseTo(before, 12); // no jump at the instant
        let previous = before;
        for (let k = 1; k <= 20; k++) {
            const t = t0 + (k / 20) * TIMING.levelTurn;
            const place = wheel.place(t);
            expect(place, `step ${k}`).toBeGreaterThan(previous);
            previous = place;
        }
        expect(wheel.levelShare(t0 + TIMING.levelTurn / 2)).toBeCloseTo(0.5, 9);
        for (const t of [t0 + TIMING.levelTurn, t0 + 60, t0 + 400]) {
            expect(wheel.place(t)).toBeCloseTo(1 + t / TIMING.hour, 9);
        }
    });

    it('step forward from where the light was heading when a second level comes mid-turn', () => {
        const wheel = new HourWheel();
        wheel.levelUp(2, 10);
        const t1 = 10 + TIMING.levelTurn * 0.4;
        const before = wheel.place(t1);
        wheel.levelUp(3, t1);
        expect(wheel.place(t1)).toBeCloseTo(before, 12);
        const done = t1 + TIMING.levelTurn;
        // Both hours arrive: the second is added to where the first was heading, not to where it was.
        expect(wheel.place(done)).toBeCloseTo(2 + done / TIMING.hour, 9);
    });

    it('step by every level gained at once', () => {
        const wheel = new HourWheel();
        wheel.levelUp(4, 0);
        expect(wheel.place(TIMING.levelTurn)).toBeCloseTo(3 + TIMING.levelTurn / TIMING.hour, 9);
    });

    it('never step back: a new run keeps the light, and its first level-up steps on from it', () => {
        const wheel = new HourWheel();
        const samples = [];
        const sample = (t) => samples.push([t, wheel.place(t)]);
        wheel.levelUp(4, 5);
        for (let t = 5; t <= 20; t += 0.5) sample(t);
        const atRun = wheel.place(20);
        wheel.newRun();
        expect(wheel.level).toBe(1);
        expect(wheel.place(20)).toBeCloseTo(atRun, 12);
        for (let t = 20; t <= 40; t += 0.5) sample(t);
        // The level going back to 1 (the director re-announces it) changes nothing either.
        wheel.levelUp(1, 40);
        expect(wheel.place(40)).toBeCloseTo(atRun + 20 / TIMING.hour, 9);
        wheel.levelUp(2, 40);
        for (let t = 40; t <= 60; t += 0.5) sample(t);
        expect(wheel.place(60)).toBeCloseTo(4 + 60 / TIMING.hour, 9);
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i][1], `t = ${samples[i][0]}`).toBeGreaterThanOrEqual(samples[i - 1][1] - 1e-12);
        }
    });

    it('a silent level-up (a rebuild restoring the run) lands at once', () => {
        const wheel = new HourWheel();
        wheel.levelUp(3, 50, true);
        expect(wheel.place(50)).toBeCloseTo(2 + 50 / TIMING.hour, 9);
    });

    it('export and import restore the place, mid-turn and after it', () => {
        const wheel = new HourWheel();
        wheel.levelUp(3, 12);
        wheel.newRun();
        wheel.levelUp(2, 14);
        const copy = new HourWheel();
        copy.importState(JSON.parse(JSON.stringify(wheel.exportState())));
        for (const t of [14, 15.5, 17, 19, 60, 500]) expect(copy.place(t), `t = ${t}`).toBeCloseTo(wheel.place(t), 12);
        expect(copy.level).toBe(wheel.level);
        // Nonsense restores a fresh wheel; nothing at all changes nothing.
        copy.importState(null);
        expect(copy.place(60)).toBeCloseTo(wheel.place(60), 12);
        copy.importState({ turnAt: Number.NaN, level: -4 });
        expect(copy.level).toBe(1);
        expect(copy.place(0)).toBe(0);
        wheel.reset();
        expect(wheel.place(0)).toBe(0);
        expect(wheel.level).toBe(1);
    });
});

describe('Painted Ages hours: the palettes', () => {
    it('keeps its colour half-way between every pair of neighbouring hours', () => {
        for (let h = 0; h < HOUR_COUNT; h++) {
            const light = lightAt(h + 0.5);
            const label = `${HOURS[h].name} → ${HOURS[(h + 1) % HOUR_COUNT].name}`;
            expect(light.mix, label).toBeCloseTo(0.5, 12);
            expect(chroma(light.sun), `${label}: sun`).toBeGreaterThan(0.3);
            expect(chroma(light.horizon), `${label}: horizon`).toBeGreaterThan(0.1);
            expect(chroma(light.haze), `${label}: haze`).toBeGreaterThan(0.08);
            COLOUR_KEYS.forEach((key) => light[key].forEach((v) => {
                expect(v >= 0 && Number.isFinite(v), `${label}: ${key}`).toBe(true);
            }));
        }
        expect(chroma([0, 0, 0])).toBe(0);
        expect(chroma([0.5, 0.5, 0.5])).toBe(0);
        expect(chroma([1, 0, 0])).toBe(1);
    });

    it('stands the sun above the horizon at every hour except the blue hour', () => {
        expect(BLUE_HOUR).toBeGreaterThanOrEqual(0);
        HOURS.forEach((hour, i) => {
            const light = lightAt(i);
            expect(Math.hypot(...light.dir), hour.name).toBeCloseTo(1, 9);
            if (i === BLUE_HOUR) {
                expect(light.el, hour.name).toBeLessThan(0);
                expect(light.dir[1]).toBeLessThan(0);
                expect(light.sunUp).toBe(0);
            } else {
                expect(light.el, hour.name).toBeGreaterThan(0);
                expect(light.dir[1]).toBeGreaterThan(0);
                expect(light.sunUp, hour.name).toBe(1);
            }
        });
    });

    it('walks the sun the increasing way round the sky', () => {
        let previous = lightAt(0).az;
        for (let place = 0.05; place <= 6.001; place += 0.05) {
            const { az } = lightAt(place);
            const step = (((az - previous) % 360) + 360) % 360;
            expect(step, `place ${place.toFixed(2)}`).toBeLessThan(90);
            previous = az;
        }
    });
});

describe('Painted Ages hours: lights share nothing', () => {
    it('copyLight copies values, never arrays', () => {
        const src = lightAt(2.4);
        const dst = copyLight(src, createLight());
        ARRAY_KEYS.forEach((key) => {
            expect(dst[key], key).not.toBe(src[key]);
            expect(dst[key], key).toEqual(src[key]);
        });
        expect(distance(dst, src)).toBe(0);
        ['az', 'el', 'sunUp', 'from', 'to', 'mix', 'place'].forEach((key) => expect(dst[key], key).toBe(src[key]));
        src.sun[0] = 99;
        src.dir[1] = 99;
        expect(dst.sun[0]).not.toBe(99);
        expect(dst.dir[1]).not.toBe(99);
    });

    it('blendLight writes fresh values into its own arrays and leaves both inputs alone', () => {
        const a = lightAt(1.5);
        const b = lightAt(5);
        const aBefore = JSON.stringify(a);
        const bBefore = JSON.stringify(b);
        const out = createLight();
        const arrays = Object.fromEntries(ARRAY_KEYS.map((key) => [key, out[key]]));
        expect(blendLight(a, b, 0.4, out)).toBe(out);
        ARRAY_KEYS.forEach((key) => {
            expect(out[key], key).toBe(arrays[key]);
            expect(out[key], key).not.toBe(a[key]);
            expect(out[key], key).not.toBe(b[key]);
        });
        out.sun[0] = 77;
        out.dir[2] = 77;
        expect(JSON.stringify(a)).toBe(aBefore);
        expect(JSON.stringify(b)).toBe(bBefore);
        // Its ends are its inputs' colours; the elevation follows.
        const zero = blendLight(a, b, 0);
        const one = blendLight(a, b, 1);
        COLOUR_KEYS.forEach((key) => {
            zero[key].forEach((v, c) => expect(v).toBeCloseTo(a[key][c], 12));
            one[key].forEach((v, c) => expect(v).toBeCloseTo(b[key][c], 12));
        });
        expect(one.el).toBeCloseTo(b.el, 12);
        expect(Math.hypot(...blendLight(a, b, 0.7).dir)).toBeCloseTo(1, 9);
        // Separate calls never share their arrays either.
        const again = blendLight(a, b, 0);
        ARRAY_KEYS.forEach((key) => expect(again[key], key).not.toBe(zero[key]));
    });

    it('lightAt fills the light it is handed and never writes into the hours', () => {
        const hours = JSON.stringify(HOURS);
        const out = createLight();
        const { sun } = out;
        for (let place = 0; place < 12; place += 0.37) {
            expect(lightAt(place, out)).toBe(out);
            out.sun[0] += 1;
            out.horizon[1] += 1;
            blendLight(out, lightAt(place + 1), 0.5, out);
        }
        expect(out.sun).toBe(sun);
        expect(JSON.stringify(HOURS)).toBe(hours);
        const fresh = [createLight(), createLight()];
        ARRAY_KEYS.forEach((key) => expect(fresh[0][key]).not.toBe(fresh[1][key]));
    });
});
