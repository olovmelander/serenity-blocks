import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    HOURS, HOUR_COUNT, HourWheel, LIGHT_COLOUR_KEYS, LIGHT_SCALAR_KEYS, SKYLINE, TIMETABLE, blendLight, chroma,
    createLight,
    dayHourAt, hourMix, hourPlace, lightAt, skylineAt, sunBearingAt, sunHeightAt,
} from '../../src/themes/spring/spring-hours.js';
import { EYE } from '../../src/themes/spring/spring-plan.js';
import { TIMING } from '../../src/themes/spring/spring-core.js';
import { decodeValley, groundHeight } from '../../src/themes/spring/spring-terrain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('spring day: the stations and the sun', () => {
    it('authors six stations with every colour and scalar, in the order the day runs', () => {
        expect(HOURS.map((h) => h.name)).toEqual([
            'morning', 'afternoon', 'golden evening', 'sunset', 'light night', 'dawn mist',
        ]);
        expect(HOUR_COUNT).toBe(6);
        for (const hour of HOURS) {
            for (const key of LIGHT_COLOUR_KEYS) expect(hour[key], `${hour.name} ${key}`).toHaveLength(3);
            for (const key of LIGHT_SCALAR_KEYS.filter((k) => k !== 'day')) {
                expect(Number.isFinite(hour[key]), `${hour.name} ${key}`).toBe(true);
            }
        }
        // The timetable never runs back, and the sun's bearing walks one way round.
        for (let k = 1; k < TIMETABLE.length; k++) expect(TIMETABLE[k][1]).toBeGreaterThan(TIMETABLE[k - 1][1]);
    });

    it('stands the sun at its real height for the end of May at 65° north: light all night', () => {
        expect(sunHeightAt(12)).toBeCloseTo(46.3, 0);
        expect(sunHeightAt(0)).toBeCloseTo(-2.7, 0);
        for (let h = 0; h < 24; h += 0.25) expect(sunHeightAt(h)).toBeGreaterThan(-4);
        const light = createLight();
        for (const hour of HOURS) {
            lightAt(HOURS.indexOf(hour), light);
            expect(light.el, hour.name).toBeCloseTo(sunHeightAt(hour.at), 6);
            expect(sunBearingAt(hour.at), hour.name).toBeCloseTo((((hour.az % 360) + 540) % 360) - 180, 6);
        }
    });

    it('lights the valley in the golden evening, puts it in shade behind the rim at sunset, and back at dawn', () => {
        const at = (k) => lightAt(k, createLight());
        expect(at(2).sunUp).toBeGreaterThan(0.95);
        expect(at(3).sunUp).toBe(0);
        expect(at(4).sunUp).toBe(0);
        expect(at(4).day).toBeLessThan(0.15);
        // The sun comes back through the gap in the fells soon after the dawn station.
        expect(at(5.25).sunUp).toBeGreaterThan(0.5);
        expect(at(0).sunUp).toBe(1);
    });

    it('turns smoothly: never holds, never switches (worst under 0.15 stops a second of clock)', () => {
        const light = createLight();
        const reads = () => {
            const e = light.exposure;
            const floor = lum(light.sun) * Math.max(light.dir[1], 0) * light.sunUp * 0.6
                + lum(light.fill) * 0.9 + lum(light.bounce) * 0.4;
            const sunward = lum(light.horizon) + lum(light.glow) * 0.8 * (0.55 + 0.45 * light.day);
            return [floor, lum(light.zenith) * 2, lum(light.horizon), sunward]
                .map((v) => Math.log2(Math.max(1e-5, v * e)));
        };
        let previous = null;
        let previousHour = null;
        for (let t = 0; t <= TIMING.hour * HOUR_COUNT; t += 1) {
            lightAt(hourPlace(1, t), light);
            const r = reads();
            const before = previous;
            if (before) r.forEach((v, i) => expect(Math.abs(v - before[i]), `t ${t} read ${i}`).toBeLessThan(0.15));
            // The hour of the day moves every second (no rest).
            if (previousHour !== null) expect(light.hour === previousHour, `t ${t}`).toBe(false);
            previous = r;
            previousHour = light.hour;
        }
    });

    it('never passes through grey between neighbouring stations', () => {
        for (let k = 0; k < HOUR_COUNT; k++) {
            const light = lightAt(k + 0.5, createLight());
            expect(chroma(light.zenith), `zenith ${k}`).toBeGreaterThan(0.45);
            expect(chroma(light.horizon), `horizon ${k}`).toBeGreaterThan(0.08);
        }
    });

    it('blends toward another light without moving the sun', () => {
        const a = lightAt(1, createLight());
        const b = lightAt(4, createLight());
        const out = blendLight(a, b, 0.5, createLight());
        expect(out.az).toBe(a.az);
        expect(out.sun[0]).toBeCloseTo((a.sun[0] + b.sun[0]) / 2, 9);
    });

    it('measures its skyline off the baked valley (re-measure after the terrain changes)', () => {
        const file = path.resolve(here, '../../src/themes/spring/assets/spring-valley.bin');
        const baked = decodeValley(new Uint8Array(zlib.inflateSync(fs.readFileSync(file))));
        for (let k = 0; k < SKYLINE.length; k += 3) {
            const bearing = -180 + k * 10;
            const a = (bearing * Math.PI) / 180;
            let best = -90;
            for (let d = 3; d < 30000; d *= 1.006) {
                const h = groundHeight(baked, EYE.x + Math.sin(a) * d, EYE.z - Math.cos(a) * d);
                const drop = (d * d) / (2 * 6371000 * 1.15);
                best = Math.max(best, (Math.atan2(h - drop - EYE.y, d) * 180) / Math.PI);
            }
            expect(Math.abs(skylineAt(bearing) - (best + 0.5)), `bearing ${bearing}`).toBeLessThan(0.3);
        }
    });
});

describe('spring day wheel: the level and the clock', () => {
    it('drifts with the clock alone at a fixed level', () => {
        const wheel = new HourWheel();
        const start = lightAt(wheel.place(0), createLight());
        const minute = lightAt(wheel.place(60), createLight());
        expect(minute.mix).toBeGreaterThan(0);
        expect(minute.sun[0]).not.toBeCloseTo(start.sun[0], 3);
        expect(dayHourAt(wheel.place(60))).toBeGreaterThan(dayHourAt(wheel.place(0)));
        expect(wheel.place(TIMING.hour)).toBeCloseTo(1, 9);
        expect(hourMix(wheel.place(TIMING.hour + 5)).from).toBe(1);
        expect(hourPlace(1, TIMING.hour)).toBeCloseTo(1, 9);
        expect(hourPlace(3, 0)).toBe(2);
    });

    it('steps forward a whole station on top of the clock at a level-up, eased', () => {
        const wheel = new HourWheel();
        wheel.levelUp(2, 30);
        expect(wheel.place(30)).toBeCloseTo(0.3, 9);
        expect(wheel.place(30 + TIMING.levelTurn)).toBeCloseTo(1 + (30 + TIMING.levelTurn) / TIMING.hour, 9);
        // A silent level-up (a rebuild in place) is there at once.
        const silent = new HourWheel();
        silent.levelUp(3, 10, true);
        expect(silent.place(10)).toBeCloseTo(2 + 10 / TIMING.hour, 9);
    });

    it('never turns the light back for a new run, and steps on from where it was heading', () => {
        const wheel = new HourWheel();
        wheel.levelUp(4, 0, true);
        wheel.newRun();
        expect(wheel.place(50)).toBeCloseTo(3 + 0.5, 9);
        wheel.levelUp(2, 50, true);
        expect(wheel.place(50)).toBeCloseTo(4 + 0.5, 9);
        wheel.levelUp(1, 60);
        expect(wheel.place(60)).toBeCloseTo(4 + 0.6, 9);
    });

    it('carries its state across a rebuild', () => {
        const wheel = new HourWheel();
        wheel.levelUp(3, 12);
        const copy = new HourWheel();
        copy.importState(wheel.exportState());
        expect(copy.place(20)).toBe(wheel.place(20));
        copy.importState(null);
        expect(copy.place(20)).toBe(wheel.place(20));
    });
});
