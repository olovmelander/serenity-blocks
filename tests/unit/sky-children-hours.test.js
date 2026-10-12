/**
 * Sky Children — the hours: the wheel of light the high country is seen in, and how the clock,
 * the levels and a new run move round it. The clock alone must move it (in every mode); a level
 * adds a whole hour; nothing ever runs the light backward; no crossing passes through grey.
 */
import { describe, expect, it } from 'vitest';
import {
    COLOUR_ROWS, HOURS, HOUR_COLOURS, HOUR_GRADES, HOUR_NAMES, HOUR_REST, HOUR_SCALARS, HOUR_SECONDS, HourWheel,
    TURN_SECONDS, clockPlace, forwardTarget, hourAt, hourMix, levelPlace, turnSeconds,
} from '../../src/themes/sky-children/sky-children-hours.js';
import { hexToLinear, toOklch } from '../../src/themes/sky-children/sky-children-core.js';

/** HSL hue of a hex colour, as the palette gate computes it. */
function hexToHue(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

/** Every number hourAt hands out, flattened in a fixed order. */
function channels(light) {
    const out = [];
    COLOUR_ROWS.forEach((key) => out.push(...light.colour[key]));
    Object.keys(HOUR_SCALARS).forEach((key) => out.push(light.scalar[key]));
    out.push(...light.gradeShadow, ...light.gradeLight);
    return out;
}

describe('Sky Children hours: the wheel', () => {
    it('names five hours in day order, from Jade Morning', () => {
        expect(HOUR_NAMES).toEqual(['jade', 'gilded', 'rose', 'night', 'pearl']);
        expect(HOURS.map((h) => h.name)).toEqual(HOUR_NAMES);
        expect(HOUR_SECONDS).toBe(110);
        expect(HOUR_REST).toBe(0.15);
        expect(TURN_SECONDS).toBe(3.6);
    });

    it('gives every hour every colour row, number and grade the shaders and the post read', () => {
        expect(COLOUR_ROWS).toEqual([
            'zenith', 'mid', 'horizon', 'belt', 'earthShadow', 'key', 'shadow', 'rim', 'cloudLit', 'cloudShade',
            'shower', 'stone', 'rock', 'water', 'mistLit', 'mistShade', 'deep', 'hearth', 'accent', 'accentB',
        ]);
        expect(Object.keys(HOUR_SCALARS)).toEqual([
            'exposure', 'keyGain', 'keyNudge', 'twilight', 'polar', 'stars', 'milky', 'bowGain', 'bowSat', 'fogbow',
            'hearth', 'gliderGlow', 'aloft', 'cloud', 'shower', 'spray', 'shadowDepth', 'albedoSat',
        ]);
        COLOUR_ROWS.forEach((key) => {
            expect(HOUR_COLOURS[key], key).toHaveLength(5);
            HOUR_COLOURS[key].forEach((hex) => expect(hex, key).toMatch(/^#[0-9a-f]{6}$/));
        });
        Object.entries(HOUR_SCALARS).forEach(([key, row]) => {
            expect(row, key).toHaveLength(5);
            row.forEach((v) => expect(Number.isFinite(v), key).toBe(true));
        });
        ['shadow', 'light'].forEach((key) => {
            expect(HOUR_GRADES[key]).toHaveLength(5);
            HOUR_GRADES[key].forEach((c) => expect(c).toHaveLength(3));
        });
        HOURS.forEach((h, i) => {
            COLOUR_ROWS.forEach((key) => expect(h.colour[key]).toEqual(hexToLinear(HOUR_COLOURS[key][i])));
            Object.keys(HOUR_SCALARS).forEach((key) => expect(h.scalar[key]).toBe(HOUR_SCALARS[key][i]));
        });
    });

    it('orders the hours by hue: the accent falls strictly round the wheel, one whole turn', () => {
        let total = 0;
        for (let i = 0; i < 5; i++) {
            const a = hexToHue(HOUR_COLOURS.accent[i]);
            const b = hexToHue(HOUR_COLOURS.accent[(i + 1) % 5]);
            const fall = (((a - b) % 360) + 360) % 360;
            expect(fall, `${HOUR_NAMES[i]} → ${HOUR_NAMES[(i + 1) % 5]}`).toBeGreaterThan(0);
            expect(fall).toBeLessThan(180);
            total += fall;
        }
        expect(total).toBeCloseTo(360, 6);
    });

    it('never mixes two neighbouring hours through grey', () => {
        for (let i = 0; i < 5; i++) {
            const a = HOURS[i];
            const b = HOURS[(i + 1) % 5];
            COLOUR_ROWS.forEach((key) => {
                const ca = toOklch(a.colour[key])[1];
                const cb = toOklch(b.colour[key])[1];
                for (let s = 0; s <= 20; s++) {
                    const light = hourAt(i + HOUR_REST + (s / 20) * (1 - 2 * HOUR_REST));
                    const c = toOklch(light.colour[key])[1];
                    const label = `${a.name} → ${b.name} ${key} ${s}/20`;
                    expect(c, label).toBeGreaterThanOrEqual(0.6 * Math.min(ca, cb));
                    if (ca > 0.05 && cb > 0.05) expect(c, label).toBeGreaterThanOrEqual(0.03);
                    light.colour[key].forEach((v) => expect(v, label).toBeGreaterThanOrEqual(0));
                }
            });
        }
    });

    it('is darkest at Moonbow Night and brightest in its mist at Pearl Dawn', () => {
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const night = HOURS.find((h) => h.name === 'night');
        HOURS.filter((h) => h !== night).forEach((h) => {
            expect(lum(h.colour.zenith)).toBeGreaterThan(lum(night.colour.zenith));
            expect(lum(h.colour.deep)).toBeGreaterThan(lum(night.colour.deep));
        });
        expect(night.scalar.stars).toBe(1);
        expect(night.scalar.bowSat).toBeLessThan(0.5);
        const pearl = HOURS.find((h) => h.name === 'pearl');
        HOURS.filter((h) => h !== pearl).forEach((h) => expect(pearl.scalar.fogbow).toBeGreaterThan(h.scalar.fogbow));
    });

    it('wraps the wheel both ways and reuses what it is given', () => {
        expect(hourMix(5).from).toBe(0);
        expect(hourMix(-1).from).toBe(4);
        expect(hourMix(-0.5).to).toBe(0);
        expect(hourAt(5 + 0.05).colour.zenith).toEqual(hourAt(0.05).colour.zenith);
        expect(hourAt(-1 + 0.05).colour.zenith).toEqual(hourAt(4.05).colour.zenith);
        const out = {};
        hourAt(1.37, out);
        const {
            colour, scalar, gradeShadow, gradeLight,
        } = out;
        const { zenith } = colour;
        hourAt(3.81, out);
        expect(out.colour).toBe(colour);
        expect(out.colour.zenith).toBe(zenith);
        expect(out.scalar).toBe(scalar);
        expect(out.gradeShadow).toBe(gradeShadow);
        expect(out.gradeLight).toBe(gradeLight);
        expect(out.place).toBe(3.81);
        expect(out.from).toBe(3);
        expect(out.to).toBe(4);
    });
});

describe('Sky Children hours: the clock, the levels and new runs', () => {
    it('rests on each hour for the first and last 15 % of it, and crosses in between', () => {
        for (let i = 0; i < 5; i++) {
            const own = channels(hourAt(i));
            const next = channels(hourAt(i + 1));
            [0, 0.05, 0.1, 0.149].forEach((f) => {
                channels(hourAt(i + f)).forEach((v, k) => expect(Math.abs(v - own[k])).toBeLessThan(1e-6));
            });
            [0.851, 0.9, 0.95, 0.999].forEach((f) => {
                channels(hourAt(i + f)).forEach((v, k) => expect(Math.abs(v - next[k])).toBeLessThan(1e-6));
            });
            expect(hourMix(i + 0.5).mix).toBeCloseTo(0.5, 9);
        }
    });

    it('drifts with the clock alone no faster than 1/20 of a unit a second, in every channel', () => {
        const wheel = new HourWheel();
        const a = {};
        const b = {};
        for (let t = 0; t < 5 * HOUR_SECONDS; t += 0.7) {
            const ca = channels(hourAt(wheel.placeAt(t), a));
            const cb = channels(hourAt(wheel.placeAt(t + 0.1), b));
            ca.forEach((v, k) => expect(Math.abs(cb[k] - v) / 0.1).toBeLessThanOrEqual(1 / 20));
        }
        // ... and it does move: within the first minute the light has left Jade Morning.
        expect(hourAt(wheel.placeAt(60)).colour.zenith).not.toEqual(hourAt(wheel.placeAt(0)).colour.zenith);
        expect(hourMix(wheel.placeAt(HOUR_SECONDS)).from).toBe(1);
    });

    it('starts level one on Jade Morning and lands level L on hour (L − 1) mod 5 after its turn', () => {
        expect(levelPlace(1)).toBe(0);
        expect(clockPlace(HOUR_SECONDS)).toBe(1);
        expect(hourAt(levelPlace(1)).name).toBe('jade');
        for (let L = 1; L <= 12; L++) {
            const at = hourAt(levelPlace(L));
            expect(at.from).toBe((L - 1) % 5);
            expect(at.mix).toBe(0);
        }
        const wheel = new HourWheel();
        let time = 7;
        for (let L = 2; L <= 9; L++) {
            wheel.levelUp(L, time);
            const settled = time + turnSeconds(1) + 1e-6;
            expect(wheel.placeAt(settled) - clockPlace(settled)).toBeCloseTo(L - 1, 9);
            time += 20;
        }
    });

    it('turns a level over TURN_SECONDS, eased, a long way a little longer, and never backward', () => {
        expect(turnSeconds(1)).toBe(TURN_SECONDS);
        expect(turnSeconds(4)).toBeCloseTo(2 * TURN_SECONDS, 9);
        expect(turnSeconds(-4)).toBe(turnSeconds(4));
        const wheel = new HourWheel();
        wheel.levelUp(2, 10);
        const mid = wheel.placeAt(10 + TURN_SECONDS / 2) - clockPlace(10 + TURN_SECONDS / 2);
        expect(mid).toBeGreaterThan(0.2);
        expect(mid).toBeLessThan(0.8);
        expect(wheel.turning(10 + 1)).toBe(true);
        expect(wheel.turning(10 + TURN_SECONDS + 0.1)).toBe(false);
        // A lower level reported later still turns forward (round the wheel to that hour).
        wheel.levelUp(4, 20);
        const before = wheel.placeAt(30);
        wheel.levelUp(2, 30);
        let last = before;
        for (let t = 30; t < 45; t += 0.05) {
            const p = wheel.placeAt(t);
            expect(p).toBeGreaterThanOrEqual(last - 1e-12);
            last = p;
        }
        expect(hourMix(wheel.placeAt(45) - clockPlace(45)).from).toBe(1);
        // A silent level arrives at once (a rebuild carrying the level over).
        const carried = new HourWheel();
        carried.levelUp(3, 5, { silent: true });
        expect(carried.placeAt(5) - clockPlace(5)).toBe(2);
    });

    it('runs a new run forward to the next Jade Morning: the place never decreases', () => {
        expect(forwardTarget(0)).toBe(0);
        expect(forwardTarget(0.01)).toBe(5);
        expect(forwardTarget(5)).toBe(5);
        expect(forwardTarget(7.3)).toBe(10);
        expect(forwardTarget(-2)).toBe(0);
        [1, 2, 3, 4, 5, 6, 9].forEach((level) => {
            [0, 33, 200].forEach((start) => {
                const wheel = new HourWheel();
                wheel.levelUp(level, start);
                const end = start + 70;
                wheel.newRun(end);
                let last = wheel.placeAt(start);
                for (let t = start; t < end + 12; t += 0.05) {
                    const p = wheel.placeAt(t);
                    expect(p, `level ${level} from ${start}`).toBeGreaterThanOrEqual(last - 1e-12);
                    last = p;
                }
                // Landed on Jade Morning, at rest.
                const landed = hourAt(wheel.placeAt(end + 12));
                expect(landed.from, `level ${level} from ${start}`).toBe(0);
                expect(landed.mix).toBe(0);
                // The new run's level 2 is the hour after Jade Morning.
                wheel.levelUp(2, end + 20);
                expect(hourMix(wheel.placeAt(end + 30)).from).toBe(1);
            });
        });
    });

    it('is deterministic in time, holds a pin, and lets go of it', () => {
        const a = new HourWheel();
        const b = new HourWheel();
        [a, b].forEach((w) => {
            w.levelUp(3, 12);
            w.newRun(80);
            w.levelUp(2, 95);
        });
        // b is asked every frame, a only now: the same answers.
        for (let t = 0; t < 120; t += 1 / 60) b.placeAt(t);
        [13, 50, 82, 97, 119].forEach((t) => expect(a.placeAt(t)).toBe(b.placeAt(t)));
        a.pin(2.5);
        expect(a.placeAt(10)).toBe(2.5);
        expect(a.placeAt(1000)).toBe(2.5);
        a.pin(null);
        expect(a.placeAt(119)).toBe(b.placeAt(119));
        a.reset(40);
        expect(a.placeAt(40)).toBeCloseTo(clockPlace(40), 12);
    });

    it('carries a run over a rebuild: a snapshot restored on a reset wheel answers every time the same', () => {
        const a = new HourWheel();
        a.levelUp(3, 20);
        a.newRun(60);
        a.levelUp(2, 70);
        const b = new HourWheel();
        b.reset(75);
        expect(b.restore(a.snapshot())).toBe(true);
        for (const t of [75, 78, 90, 140, 400]) expect(b.placeAt(t)).toBe(a.placeAt(t));
        // The playground's pin is never part of a run, and a broken snapshot changes nothing.
        a.pin(2.5);
        expect(a.snapshot()).not.toHaveProperty('pinned');
        const before = b.snapshot();
        expect(b.restore({ ...before, base: Number.NaN })).toBe(false);
        expect(b.restore(null)).toBe(false);
        expect(b.snapshot()).toEqual(before);
    });
});
