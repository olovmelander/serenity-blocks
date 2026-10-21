import { describe, expect, it } from 'vitest';
import {
    FIRE, HEAT_EXPONENT, SWARM_PALETTE, heatWarmth, samplePalette, turnHue,
} from '../../src/themes/murmuration/composition/swarm-palette.js';
import { SwarmShow } from '../../src/themes/murmuration/composition/swarm-show.js';

/** Hue angle about the grey axis, degrees 0..360 (red 0, green 120, blue 240). */
function hueOf([r, g, b]) {
    const m = (r + g + b) / 3;
    const deg = (Math.atan2((g - b) * 0.8660254, (r - m) * 1.5) * 180) / Math.PI;
    return (deg + 360) % 360;
}

const CYAN = SWARM_PALETTE[2];

describe('murmuration palette: the hot swarm\'s turn of hue', () => {
    it('starts at its first colour and ends at its second', () => {
        const start = turnHue(CYAN, FIRE.gold, 0);
        const end = turnHue(CYAN, FIRE.gold, 1);
        start.forEach((c, i) => expect(c).toBeCloseTo(CYAN[i], 6));
        end.forEach((c, i) => expect(c).toBeCloseTo(FIRE.gold[i], 6));
    });

    it('takes cyan to fire through blue, violet and rose: never through green, never through grey', () => {
        // The short way from cyan (180°) to gold (~40°) runs through green and yellow; a straight
        // blend of the two is grey half way. The turn goes up the wheel instead.
        let last = hueOf(CYAN);
        for (let k = 0.05; k < 1; k += 0.05) {
            const c = turnHue(CYAN, FIRE.gold, k);
            const h = hueOf(c);
            const unwrapped = h < last - 180 ? h + 360 : h;
            expect(unwrapped).toBeGreaterThan(last - 1e-6); // hue only rises
            expect(h < 60 || h > 175).toBe(true); // no yellow-green, no green
            const chroma = Math.max(...c) - Math.min(...c);
            expect(chroma).toBeGreaterThan(0.5); // a colour all the way, not a grey
            last = unwrapped;
        }
    });

    it('turns every palette hue toward every fire, without negative light', () => {
        Object.values(FIRE).forEach((fire) => {
            SWARM_PALETTE.forEach((colour) => {
                [0.25, 0.5, 0.75].forEach((k) => {
                    const out = turnHue(colour, fire, k);
                    out.forEach((c) => {
                        expect(Number.isFinite(c)).toBe(true);
                        expect(c).toBeGreaterThanOrEqual(0);
                    });
                });
            });
        });
    });

    it('writes into the colour it was given when asked to', () => {
        const colour = [...CYAN];
        const out = turnHue(colour, FIRE.ember, 0.5, colour);
        expect(out).toBe(colour);
        expect(hueOf(colour)).not.toBeCloseTo(hueOf(CYAN), 0);
    });

    it('warms from nothing at no heat to most of the way at full, less in a formation', () => {
        expect(heatWarmth(0)).toBe(0);
        expect(heatWarmth(-1)).toBe(0);
        expect(heatWarmth(1)).toBeCloseTo(0.9 ** HEAT_EXPONENT, 9);
        expect(heatWarmth(0.25)).toBeGreaterThan(0.25); // a short chain already shows
        expect(heatWarmth(1, 1)).toBeLessThan(heatWarmth(1) * 0.6);
        let last = 0;
        for (let h = 0.1; h <= 1; h += 0.1) {
            expect(heatWarmth(h)).toBeGreaterThan(last);
            last = heatWarmth(h);
        }
    });
});

describe('murmuration show: what the swarm lights warms with it', () => {
    const stubColor = () => {
        const value = { r: 0, g: 0, b: 0 };
        value.setRGB = (r, g, b) => Object.assign(value, { r, g, b });
        return { value };
    };
    const makeShow = () => {
        const sky = {
            uniforms: {
                uHeat: { value: 0 },
                uPulse: { value: 0 },
                uFlash: { value: 0 },
                uTintA: stubColor(),
                uTintB: stubColor(),
                uWingA: stubColor(),
                uWingB: stubColor(),
            },
        };
        const show = new SwarmShow({ sim: null, sky, random: () => 0 });
        return { show, sky };
    };
    const rgb = ({ value }) => [value.r, value.g, value.b];
    const toFire = (colour) => {
        const h = hueOf(colour);
        return Math.min(Math.abs(h - 20), Math.abs(h - 380)); // degrees from amber
    };

    it('lights the dust round each wing in that wing\'s colour', () => {
        const { show, sky } = makeShow();
        show.update(1 / 60, 10);
        const a = rgb(sky.uniforms.uWingA);
        const b = rgb(sky.uniforms.uWingB);
        // The two wings wear different hues, and they are the palette's (full strength).
        expect(hueOf(a)).not.toBeCloseTo(hueOf(b), 0);
        expect(Math.max(...a)).toBeGreaterThan(0.5);
        const expected = samplePalette(10 * 0.006 - 0.34 * 0.7);
        a.forEach((c, i) => expect(c).toBeCloseTo(expected[i], 6));
    });

    it('turns the board\'s halo, the sky\'s tints and the wings toward fire as a chain heats the swarm', () => {
        const { show, sky } = makeShow();
        show.update(1 / 60, 10);
        const cold = {
            halo: [...show.haloTint],
            tint: rgb(sky.uniforms.uTintA),
            wing: rgb(sky.uniforms.uWingA),
        };
        show.combo(9);
        let time = 10;
        for (let i = 0; i < 360; i += 1) {
            time += 1 / 60;
            show.update(1 / 60, time);
        }
        expect(show.heat).toBeGreaterThan(0.9);
        expect(toFire(show.haloTint)).toBeLessThan(toFire(cold.halo));
        expect(toFire(rgb(sky.uniforms.uTintA))).toBeLessThan(toFire(cold.tint));
        expect(toFire(rgb(sky.uniforms.uWingA))).toBeLessThan(toFire(cold.wing));
        expect(toFire(show.haloTint)).toBeLessThan(30);
    });
});
