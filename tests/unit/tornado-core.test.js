/**
 * Tornado — the scene's numbers (three-free): the hours, the funnel's profile, lightning paths,
 * the chain's fury, and the tie between the live controls' defaults and the world's reference.
 */
import { describe, expect, it } from 'vitest';
import {
    HOUR_REST, HOUR_SECONDS, PALETTES, PALETTE_KEYS, WORLD, approach, boltPath, funnelRadius, furyFor, hexToLinear,
    mulberry32, paletteAt,
} from '../../src/themes/tornado/tornado-core.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/tornado/tornado-quality.js';
import { TORNADO_PARAM_DEFAULTS, TORNADO_PARAM_RANGES } from '../../src/themes/tornado/params.ts';
import { LIVE_REFERENCE } from '../../src/themes/tornado/tornado-world.js';
import { TORNADO_TETROMINOS } from '../../src/themes/tornado/tornado-tetrominos.js';

describe('tornado hours', () => {
    it('gives every palette every colour and scalar', () => {
        expect(PALETTES.length).toBeGreaterThanOrEqual(4);
        PALETTES.forEach((p) => {
            PALETTE_KEYS.forEach((key) => {
                expect(p[key], `${p.name}.${key}`).toHaveLength(3);
                p[key].forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
            });
            expect(p.sunPower).toBeGreaterThan(0);
            expect(p.sunElev).toBeGreaterThan(0);
            expect(p.flicker).toBeGreaterThan(0);
        });
        expect(HOUR_SECONDS).toBeGreaterThan(30);
    });

    it('rests briefly on an hour, is on its way for most of the step, and wraps', () => {
        const resting = paletteAt(HOUR_REST * 0.5);
        expect(resting.index).toBe(0);
        expect(resting.turn).toBe(0);
        expect(resting.sun).toEqual(PALETTES[0].sun);

        // Half-way through the step the light is half-way to the next hour.
        const half = paletteAt(0.5);
        expect(half.turn).toBeCloseTo(0.5, 6);
        expect(half.sun[1]).toBeCloseTo((PALETTES[0].sun[1] + PALETTES[1].sun[1]) / 2, 6);

        const arrived = paletteAt(1 - HOUR_REST * 0.5);
        expect(arrived.turn).toBe(1);
        expect(arrived.sun).toEqual(PALETTES[1].sun);

        // The light moves for most of every step: the rests are the small part.
        expect(HOUR_REST).toBeLessThanOrEqual(0.2);
        let moving = 0;
        for (let i = 0; i < 100; i += 1) {
            const { turn } = paletteAt((i + 0.5) / 100);
            if (turn > 0.001 && turn < 0.999) moving += 1;
        }
        expect(moving).toBeGreaterThanOrEqual(60);

        expect(paletteAt(PALETTES.length + 0.1).index).toBe(0);
        expect(paletteAt(-0.5).index).toBe(PALETTES.length - 1);
    });

    it('reuses the object it is given', () => {
        const out = {};
        expect(paletteAt(0.3, out)).toBe(out);
        const { sun } = out;
        paletteAt(1.3, out);
        expect(out.sun).toBe(sun);
    });
});

describe('tornado funnel profile', () => {
    it('is a stem that flares into the wall cloud', () => {
        const foot = funnelRadius(0);
        const waist = funnelRadius(0.3);
        const top = funnelRadius(1);
        expect(foot).toBeGreaterThan(WORLD.radiusGround);
        expect(waist).toBeLessThan(top);
        expect(top).toBeGreaterThan(WORLD.radiusTop + WORLD.flare * 0.9);
        // The foot spreads a little where it meets the ground.
        expect(funnelRadius(0)).toBeGreaterThan(funnelRadius(0.08));
    });

    it('scales its stem with girth and its crown with flare', () => {
        expect(funnelRadius(0.3, 2) - funnelRadius(0.3, 1)).toBeCloseTo(WORLD.radiusGround, 5);
        expect(funnelRadius(1, 1, 0)).toBeLessThan(funnelRadius(1, 1, 1));
        expect(funnelRadius(-1)).toBe(funnelRadius(0));
        expect(funnelRadius(2)).toBe(funnelRadius(1));
    });
});

describe('tornado lightning path', () => {
    it('starts and lands exactly where it is aimed and only goes down', () => {
        const out = new Float32Array(30 * 3);
        const from = [120, 336, -640];
        const to = [80, 0, -700];
        boltPath(mulberry32(7), from, to, 12, 30, out);
        expect([out[0], out[1], out[2]]).toEqual(from);
        expect(out[87]).toBeCloseTo(to[0], 4);
        expect(out[88]).toBeCloseTo(to[1], 4);
        expect(out[89]).toBeCloseTo(to[2], 4);
        let wandered = 0;
        for (let i = 1; i < 30; i += 1) {
            expect(out[i * 3 + 1]).toBeLessThan(out[(i - 1) * 3 + 1]);
            wandered = Math.max(wandered, Math.abs(out[i * 3] - (from[0] + ((to[0] - from[0]) * i) / 29)));
        }
        expect(wandered).toBeGreaterThan(2);
    });

    it('is the same path for the same seed', () => {
        const a = boltPath(mulberry32(3), [0, 300, 0], [10, 0, 10], 9, 12, new Float32Array(36));
        const b = boltPath(mulberry32(3), [0, 300, 0], [10, 0, 10], 9, 12, new Float32Array(36));
        expect(Array.from(a)).toEqual(Array.from(b));
    });
});

describe('tornado small helpers', () => {
    it('builds fury from the second clear of a chain on, toward 1', () => {
        expect(furyFor(0)).toBe(0);
        expect(furyFor(1)).toBe(0);
        let last = 0;
        for (let n = 2; n < 20; n += 1) {
            const f = furyFor(n);
            expect(f).toBeGreaterThan(last);
            expect(f).toBeLessThan(1);
            last = f;
        }
    });

    it('reads hex colours into linear light and refuses anything else', () => {
        const out = [0, 0, 0];
        expect(hexToLinear('#ffffff', out)).toBe(true);
        expect(out).toEqual([1, 1, 1]);
        expect(hexToLinear('808080', out)).toBe(true);
        expect(out[0]).toBeCloseTo(0.2158, 3);
        expect(hexToLinear('red', out)).toBe(false);
        expect(hexToLinear(null, out)).toBe(false);
    });

    it('eases by the same share however the time is cut', () => {
        const whole = approach(2, 0.5);
        const halves = 1 - (1 - approach(2, 0.25)) ** 2;
        expect(whole).toBeCloseTo(halves, 10);
        expect(approach(2, 0)).toBe(0);
    });
});

describe('tornado tiers and live controls', () => {
    it('keeps every part in every tier and grows the counts', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        let last = null;
        QUALITY_NAMES.forEach((name) => {
            const t = QUALITY[name];
            ['wheat', 'debris', 'motes', 'poles', 'shells'].forEach((key) => {
                expect(t[key], `${name}.${key}`).toBeGreaterThan(0);
                if (last) expect(t[key]).toBeGreaterThanOrEqual(last[key]);
            });
            expect(t.radial).toHaveLength(2);
            last = t;
        });
        expect(tierFor('nonsense')).toBe(QUALITY.High);
    });

    it("leaves the scene as authored at the settings' defaults", () => {
        Object.keys(LIVE_REFERENCE).forEach((key) => {
            expect(TORNADO_PARAM_DEFAULTS[key], key).toBe(LIVE_REFERENCE[key]);
        });
        Object.keys(TORNADO_PARAM_DEFAULTS).forEach((key) => {
            expect(TORNADO_PARAM_RANGES[key], key).toBeTruthy();
        });
    });

    it('gives the seven pieces seven different colours', () => {
        const { colors } = TORNADO_TETROMINOS;
        const seven = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((k) => colors[k].toLowerCase());
        expect(new Set(seven).size).toBe(7);
        seven.forEach((hex) => expect(hexToLinear(hex, [0, 0, 0])).toBe(true));
    });
});
