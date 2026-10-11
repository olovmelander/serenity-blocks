/**
 * Stellar Velocity — the core's maths, the baked cloud and the tiers, on the CPU.
 *
 * These pin relations (ordered, bounded, monotonic, periodic), never a tuning number: constants
 * are imported from the modules under test.
 */
import { describe, expect, it } from 'vitest';
import {
    BOLT_FLIGHT, CANYON, CRUISE, FRONT_END, FRONT_SPEED, FRONT_START, GEAR_CHAIN, HOOP_HOLD, HOOP_LIFE, HOOP_OPEN,
    HOOP_SLOTS, HUSH_HOLD, JUMP_EXIT, JUMP_TUNNEL, JUMP_TUNNEL_PERFECT, NEBULA_PALETTES, PALETTE_HOME, PALETTE_KEYS,
    PALETTE_REST, PALETTE_STEP, STARBOW, WARP_CHAIN, WARP_JUMP, aberrate, approach, clamp01, courseAnchors, doppler,
    frontDepth, gearForCombo, hoopDepth, hoopFiredDepth, hoopHeld, hoopRadius, hoopRun, jumpPhase, lerp, linRGB,
    mulberry32, paletteAt, paletteName, palettePhase, palettePlace, pieceColor, smooth, starbowColor, warpForCombo,
} from '../../src/themes/stellar-velocity/stellar-velocity-core.js';
import {
    BOW_COS, bakeCanyonNoise, bakeFbm, sampleCanyonNoise,
} from '../../src/themes/stellar-velocity/stellar-velocity-tsl.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/stellar-velocity/stellar-velocity-quality.js';
import { POST_LOOK } from '../../src/themes/stellar-velocity/stellar-velocity-post.js';
import { STELLAR_VELOCITY_TETROMINOS } from '../../src/themes/stellar-velocity/stellar-velocity-tetrominos.js';

const hueOf = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 1e-6) return 0;
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    return ((h * 60) + 360) % 360;
};
const saturationOf = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    return max > 0 ? (max - Math.min(r, g, b)) / max : 0;
};

describe('stellar velocity core: speed', () => {
    it('a glide at rest, and every step of a chain is a higher gear, always short of GEAR_CHAIN', () => {
        expect(gearForCombo(0)).toBe(1);
        expect(gearForCombo(-3)).toBe(1);
        let last = 1;
        for (let combo = 1; combo <= 30; combo++) {
            const gear = gearForCombo(combo);
            expect(gear).toBeGreaterThan(last);
            expect(gear).toBeLessThan(GEAR_CHAIN);
            last = gear;
        }
        expect(CRUISE).toBeGreaterThan(0);
    });

    it('the sky is not bunched at rest, barely by one clear, and never past WARP_CHAIN by a chain', () => {
        expect(warpForCombo(0)).toBe(0);
        expect(warpForCombo(1)).toBeLessThan(0.25);
        let last = 0;
        for (let combo = 1; combo <= 30; combo++) {
            const warp = warpForCombo(combo);
            expect(warp).toBeGreaterThan(last);
            expect(warp).toBeLessThan(WARP_CHAIN);
            last = warp;
        }
        expect(WARP_JUMP).toBeGreaterThan(WARP_CHAIN);
        expect(WARP_JUMP).toBeLessThan(1);
    });

    it('aberration bunches the sky toward the course and leaves the course itself where it is', () => {
        for (const beta of [0.2, 0.5, 0.9]) {
            expect(aberrate(1, beta)).toBeCloseTo(1, 10);
            expect(aberrate(-1, beta)).toBeCloseTo(-1, 10);
            for (const c of [-0.8, -0.3, 0, 0.4, 0.9]) {
                // Seen nearer the course than it truly is.
                expect(aberrate(c, beta)).toBeGreaterThan(c);
                expect(aberrate(c, beta)).toBeLessThanOrEqual(1);
            }
        }
        expect(aberrate(0.3, 0)).toBeCloseTo(0.3, 12);
    });

    it('light is bluer ahead and redder behind, and unchanged at rest', () => {
        expect(doppler(0.4, 0)).toBeCloseTo(1, 12);
        for (const beta of [0.3, 0.6, 0.9]) {
            expect(doppler(1, beta)).toBeGreaterThan(1);
            expect(doppler(-1, beta)).toBeLessThan(1);
            expect(doppler(1, beta)).toBeGreaterThan(doppler(0.5, beta));
            expect(doppler(0.5, beta)).toBeGreaterThan(doppler(-0.5, beta));
        }
    });

    it('the starbow runs from red far off the course through white to violet dead ahead', () => {
        for (let i = 1; i < STARBOW.length; i++) expect(STARBOW[i][0]).toBeGreaterThan(STARBOW[i - 1][0]);
        const red = starbowColor(STARBOW[0][0] - 5);
        const blue = starbowColor(STARBOW[STARBOW.length - 1][0] + 5);
        expect(red[0]).toBeGreaterThan(red[2] * 5);
        expect(blue[2]).toBeGreaterThan(blue[0]);
        const white = starbowColor(0);
        expect(Math.min(...white)).toBeGreaterThan(0.5);
        const out = [9, 9, 9];
        expect(starbowColor(0.3, out)).toBe(out);
        // The ring the bow is read against lies inside the frame.
        expect(BOW_COS).toBeGreaterThan(0.7);
        expect(BOW_COS).toBeLessThan(1);
    });
});

describe('stellar velocity core: the course', () => {
    it('hoops stand one behind another, a little wider the further off', () => {
        for (let slot = 1; slot < HOOP_SLOTS; slot++) {
            expect(hoopDepth(slot)).toBeGreaterThan(hoopDepth(slot - 1));
            expect(hoopRadius(slot)).toBeGreaterThan(hoopRadius(slot - 1));
        }
        // Every hoop stands inside the open channel.
        expect(hoopRadius(HOOP_SLOTS - 1)).toBeLessThan(CANYON.clear);
    });

    it('a hoop holds nothing before its lock, opens, then loses its light and is gone by HOOP_LIFE', () => {
        expect(hoopHeld(-1)).toBe(0);
        expect(hoopHeld(0)).toBe(0);
        expect(hoopHeld(HOOP_OPEN)).toBeGreaterThan(0.9);
        expect(hoopHeld(HOOP_HOLD)).toBeLessThan(hoopHeld(HOOP_OPEN));
        expect(hoopHeld(HOOP_HOLD)).toBeGreaterThan(0.2);
        expect(hoopHeld(HOOP_LIFE)).toBe(0);
        expect(hoopHeld(HOOP_LIFE + 1)).toBe(0);
        let last = hoopHeld(HOOP_OPEN);
        for (let age = HOOP_OPEN + 1; age < HOOP_LIFE; age += 1) {
            expect(hoopHeld(age)).toBeLessThanOrEqual(last);
            last = hoopHeld(age);
        }
    });

    it('a fired hoop comes at us ever faster, passes the camera at hoopRun and goes on behind', () => {
        for (let slot = 0; slot < HOOP_SLOTS; slot += 3) {
            const depth = hoopDepth(slot);
            const run = hoopRun(depth);
            expect(hoopFiredDepth(depth, 0)).toBe(depth);
            expect(hoopFiredDepth(depth, -1)).toBe(depth);
            expect(hoopFiredDepth(depth, run)).toBeCloseTo(0, 9);
            expect(hoopFiredDepth(depth, run * 1.5)).toBeLessThan(0);
            let last = depth;
            let lastStep = 0;
            for (let k = 1; k <= 10; k++) {
                const now = hoopFiredDepth(depth, (run * k) / 10);
                expect(now).toBeLessThan(last);
                expect(last - now).toBeGreaterThan(lastStep - 1e-9);
                lastStep = last - now;
                last = now;
            }
        }
        // The far ones take a little longer.
        expect(hoopRun(hoopDepth(HOOP_SLOTS - 1))).toBeGreaterThan(hoopRun(hoopDepth(0)));
    });

    it('a front leaves the far end of the canyon and comes down it at its own speed', () => {
        expect(frontDepth(0, FRONT_SPEED.clear)).toBe(FRONT_START);
        expect(frontDepth(-1, FRONT_SPEED.clear)).toBe(FRONT_START);
        expect(frontDepth(1, FRONT_SPEED.lock)).toBeLessThan(frontDepth(1, FRONT_SPEED.level));
        expect(frontDepth(FRONT_START / FRONT_SPEED.clear, FRONT_SPEED.clear)).toBeCloseTo(0, 9);
        expect(FRONT_END).toBeLessThan(0);
        expect(FRONT_SPEED.level).toBeLessThan(FRONT_SPEED.clear);
        expect(BOLT_FLIGHT).toBeGreaterThan(0);
    });

    it('the jump is nothing before it opens, the whole frame in the tunnel, and closes over JUMP_EXIT', () => {
        expect(jumpPhase(-1)).toBe(0);
        expect(jumpPhase(0)).toBe(0);
        expect(jumpPhase(JUMP_TUNNEL * 0.5)).toBe(1);
        expect(jumpPhase(JUMP_TUNNEL + JUMP_EXIT * 0.5)).toBeGreaterThan(0);
        expect(jumpPhase(JUMP_TUNNEL + JUMP_EXIT * 0.5)).toBeLessThan(1);
        expect(jumpPhase(JUMP_TUNNEL + JUMP_EXIT)).toBe(0);
        expect(jumpPhase(JUMP_TUNNEL_PERFECT - 0.01, JUMP_TUNNEL_PERFECT)).toBe(1);
        expect(JUMP_TUNNEL_PERFECT).toBeGreaterThan(JUMP_TUNNEL);
        expect(HUSH_HOLD).toBeGreaterThan(0);
        expect(HUSH_HOLD).toBeLessThan(0.5);
    });

    it('the small helpers are what they say', () => {
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(3)).toBe(1);
        expect(lerp(2, 4, 0.5)).toBe(3);
        expect(smooth(0, 1, 0.5)).toBe(0.5);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, 100)).toBeCloseTo(1, 9);
        const a = mulberry32(7);
        const b = mulberry32(7);
        for (let i = 0; i < 5; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});

describe('stellar velocity core: colour', () => {
    it('linRGB decodes sRGB', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff)[1]).toBeCloseTo(1, 6);
        expect(linRGB(0x808080)[0]).toBeGreaterThan(0.2);
        expect(linRGB(0x808080)[0]).toBeLessThan(0.23);
    });

    it('every piece is a different band of the bow, however the colour is written', () => {
        const { colors } = STELLAR_VELOCITY_TETROMINOS;
        const hues = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((key) => {
            const rgb = pieceColor(colors[key]);
            expect(Math.max(...rgb)).toBeCloseTo(1, 1);
            expect(Math.min(...rgb)).toBeGreaterThanOrEqual(0.05 - 1e-9);
            expect(saturationOf(rgb)).toBeGreaterThan(0.5);
            return hueOf(rgb);
        });
        const sorted = [...hues].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(12);
        expect(pieceColor('#7fe9ff')).toEqual(pieceColor('7FE9FF'));
        expect(pieceColor(0x7fe9ff)).toEqual(pieceColor('#7fe9ff'));
        expect(pieceColor('nonsense')).toEqual(pieceColor(null));
    });

    it('every palette is whole, and its two glows belong to different families', () => {
        expect(NEBULA_PALETTES.length).toBeGreaterThanOrEqual(5);
        const names = new Set();
        NEBULA_PALETTES.forEach((palette) => {
            names.add(palette.name);
            PALETTE_KEYS.forEach((key) => {
                expect(palette[key]).toHaveLength(3);
                palette[key].forEach((c) => {
                    expect(c).toBeGreaterThanOrEqual(0);
                    expect(c).toBeLessThanOrEqual(1);
                });
            });
            const between = Math.abs(hueOf(palette.glow) - hueOf(palette.deep));
            expect(Math.min(between, 360 - between)).toBeGreaterThan(20);
            // The deep sky is dark.
            expect(Math.max(...palette.sky)).toBeLessThan(0.02);
        });
        expect(names.size).toBe(NEBULA_PALETTES.length);
        expect(NEBULA_PALETTES[PALETTE_HOME].name).toBe('ion');
    });

    it('neighbours on the line of palettes mix without passing through grey', () => {
        for (let i = 0; i < NEBULA_PALETTES.length - 1; i++) {
            const a = NEBULA_PALETTES[i];
            const b = NEBULA_PALETTES[i + 1];
            ['glow', 'deep'].forEach((key) => {
                const mid = a[key].map((c, k) => (c + b[key][k]) * 0.5);
                expect(saturationOf(mid)).toBeGreaterThan(0.55);
            });
        }
    });

    it('half-way between two palettes the two glows are still two colours', () => {
        for (let i = 0; i < NEBULA_PALETTES.length - 1; i++) {
            const a = NEBULA_PALETTES[i];
            const b = NEBULA_PALETTES[i + 1];
            const glow = a.glow.map((c, k) => (c + b.glow[k]) * 0.5);
            const deep = a.deep.map((c, k) => (c + b.deep[k]) * 0.5);
            const between = Math.abs(hueOf(glow) - hueOf(deep));
            expect(Math.min(between, 360 - between)).toBeGreaterThan(15);
        }
    });
});

describe('stellar velocity core: the palette follows the level AND the clock', () => {
    it('with no gameplay and a fixed level the nebula has moved within the first minute', () => {
        const start = paletteAt(palettePlace(0, 0));
        const later = paletteAt(palettePlace(0, 55));
        const moved = Math.hypot(...start.glow.map((c, k) => c - later.glow[k]));
        expect(moved).toBeGreaterThan(0.05);
        expect(paletteName(palettePlace(0, 0))).toBe('ion');
    });

    it('one PALETTE_STEP later it stands on the next palette, with the level never changing', () => {
        const home = NEBULA_PALETTES[PALETTE_HOME];
        const next = NEBULA_PALETTES[PALETTE_HOME + 1];
        expect(paletteAt(palettePlace(0, 0)).glow).toEqual(home.glow);
        const after = paletteAt(palettePlace(0, PALETTE_STEP));
        after.glow.forEach((c, k) => expect(c).toBeCloseTo(next.glow[k], 9));
        expect(paletteName(palettePlace(0, PALETTE_STEP))).toBe(next.name);
    });

    it('a level-up is one step added to wherever the clock has carried it', () => {
        for (const time of [0, 30, 200, 900]) {
            expect(palettePlace(1, time) - palettePlace(0, time)).toBeCloseTo(1, 12);
            expect(palettePlace(3, time)).toBeCloseTo(3 + time / PALETTE_STEP, 12);
        }
        expect(paletteName(palettePlace(1, 0))).toBe(NEBULA_PALETTES[PALETTE_HOME + 1].name);
    });

    it('the light is on its way for most of every step: it only rests a small share at each end', () => {
        expect(PALETTE_REST).toBeLessThanOrEqual(0.2);
        expect(PALETTE_STEP).toBeGreaterThanOrEqual(60);
        expect(PALETTE_STEP).toBeLessThanOrEqual(120);
        expect(palettePhase(PALETTE_REST * 0.5).mix).toBe(0);
        expect(palettePhase(0.5).mix).toBeCloseTo(0.5, 9);
        expect(palettePhase(1 - PALETTE_REST * 0.5).mix).toBe(1);
        let moving = 0;
        for (let i = 0; i < 100; i++) {
            const { mix } = palettePhase(i / 100);
            if (mix > 0.001 && mix < 0.999) moving += 1;
        }
        expect(moving).toBeGreaterThanOrEqual(65);
    });

    it('walks the whole line there and back: every palette is reached and every step is between neighbours', () => {
        const seen = new Set();
        const period = (NEBULA_PALETTES.length - 1) * 2;
        for (let place = 0; place <= period; place += 0.25) {
            const { index, next, mix } = palettePhase(place);
            expect(next - index).toBe(1);
            expect(mix).toBeGreaterThanOrEqual(0);
            expect(mix).toBeLessThanOrEqual(1);
            seen.add(paletteName(place));
        }
        expect(seen.size).toBe(NEBULA_PALETTES.length);
        // It comes round whole.
        expect(paletteAt(period).glow).toEqual(paletteAt(0).glow);
        expect(paletteName(-1)).toBe(NEBULA_PALETTES[PALETTE_HOME - 1].name);
    });

    it('fills the object it is given', () => {
        const out = {};
        expect(paletteAt(0.4, out)).toBe(out);
        PALETTE_KEYS.forEach((key) => expect(out[key]).toHaveLength(3));
    });
});

describe('stellar velocity core: where the sun hangs', () => {
    it('in landscape the sun stands left of the card, near the middle of the height', () => {
        for (const aspect of [1.5, 16 / 9, 1.95, 2.4]) {
            const a = courseAnchors(aspect);
            expect(a.x).toBeGreaterThan(0.12);
            expect(a.x).toBeLessThan(0.3);
            expect(a.y).toBeGreaterThan(0.35);
            expect(a.y).toBeLessThan(0.55);
            expect(a.hFov).toBeGreaterThan(60);
            expect(a.hFov).toBeLessThan(100);
        }
    });

    it('on an upright phone it rises into the sky above the card', () => {
        const a = courseAnchors(430 / 932);
        expect(a.y).toBeLessThan(0.2);
        expect(a.x).toBeGreaterThan(0.25);
        expect(a.x).toBeLessThan(0.6);
    });

    it('moves smoothly between the two, and survives nonsense', () => {
        let last = courseAnchors(0.4);
        for (let aspect = 0.42; aspect < 2.6; aspect += 0.02) {
            const a = courseAnchors(aspect);
            expect(Math.abs(a.x - last.x)).toBeLessThan(0.03);
            expect(Math.abs(a.y - last.y)).toBeLessThan(0.05);
            last = a;
        }
        expect(courseAnchors(NaN)).toEqual(courseAnchors(16 / 9));
        expect(courseAnchors(-1)).toEqual(courseAnchors(16 / 9));
    });
});

describe('stellar velocity noise', () => {
    it('bakes the cloud twice from the same lattices: every octave, and without the finest', () => {
        const size = 16;
        const baked = bakeCanyonNoise(4177, size);
        expect(baked.near).toHaveLength(size ** 3 * 4);
        expect(baked.farSize).toBe(size / 2);
        expect(baked.far).toHaveLength(baked.farSize ** 3 * 4);
        // The near volume spans its whole byte range in every field.
        for (let c = 0; c < 4; c++) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < baked.near.length; i += 4) {
                lo = Math.min(lo, baked.near[i]);
                hi = Math.max(hi, baked.near[i]);
            }
            expect(lo).toBe(0);
            expect(hi).toBe(255);
        }
        // The same seed bakes the same cloud; another seed another.
        expect(bakeCanyonNoise(4177, size).near).toEqual(baked.near);
        expect(bakeCanyonNoise(4178, size).near).not.toEqual(baked.near);
    });

    it('the far volume is the near one with its fine detail gone: they agree on the masses', () => {
        const size = 32;
        const baked = bakeCanyonNoise(4177, size);
        let sum = 0;
        let count = 0;
        const near = [0, 0, 0, 0];
        const far = [0, 0, 0, 0];
        for (let i = 0; i < 200; i++) {
            const x = (i * 0.137) % 1;
            const y = (i * 0.311) % 1;
            const z = (i * 0.573) % 1;
            sampleCanyonNoise(baked.near, size, x, y, z, near);
            sampleCanyonNoise(baked.far, baked.farSize, x, y, z, far);
            // The slow field has no finest octave to lose.
            sum += Math.abs(near[3] - far[3]);
            count += 1;
            expect(Math.abs(near[0] - far[0])).toBeLessThan(0.3);
        }
        expect(sum / count).toBeLessThan(0.06);
    });

    it('the cloud tiles: a read one tile on is the same read', () => {
        const size = 16;
        const { near } = bakeCanyonNoise(11, size);
        const a = sampleCanyonNoise(near, size, 0.13, 0.57, 0.91);
        const b = sampleCanyonNoise(near, size, 1.13, -0.43, 2.91);
        a.forEach((v, c) => expect(b[c]).toBeCloseTo(v, 9));
    });

    it('bakes four different fBm fields, each spanning exactly [0, 1]', () => {
        const size = 32;
        const field = bakeFbm(2718, size);
        expect(field).toHaveLength(size * size * 4);
        for (let c = 0; c < 4; c++) {
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = c; i < field.length; i += 4) {
                lo = Math.min(lo, field[i]);
                hi = Math.max(hi, field[i]);
            }
            expect(lo).toBeCloseTo(0, 6);
            expect(hi).toBeCloseTo(1, 6);
        }
        expect(field[0]).not.toBe(field[1]);
    });
});

describe('stellar velocity tiers', () => {
    const ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

    it('defines every tier with every key, and falls back to High', () => {
        expect([...QUALITY_NAMES].sort()).toEqual([...ORDER].sort());
        const keys = Object.keys(QUALITY.High).sort();
        ORDER.forEach((name) => expect(Object.keys(QUALITY[name]).sort()).toEqual(keys));
        expect(tierFor('nonsense')).toBe(QUALITY.High);
        expect(tierFor('Low')).toBe(QUALITY.Low);
    });

    it('never asks less of a higher tier', () => {
        for (let i = 1; i < ORDER.length; i++) {
            const lower = QUALITY[ORDER[i - 1]];
            const higher = QUALITY[ORDER[i]];
            ['march', 'taps', 'canyonScale', 'noise', 'skyLayers', 'stars', 'motes'].forEach((key) => {
                expect(higher[key]).toBeGreaterThanOrEqual(lower[key]);
            });
            expect(Number(higher.detail)).toBeGreaterThanOrEqual(Number(lower.detail));
            expect(Number(higher.lights)).toBeGreaterThanOrEqual(Number(lower.lights));
        }
        // The cloud volume halves cleanly for its far copy.
        ORDER.forEach((name) => expect(QUALITY[name].noise % 2).toBe(0));
        ORDER.forEach((name) => expect(QUALITY[name].canyonScale).toBeLessThanOrEqual(1));
    });

    it('gives the post a look for every tier, heavier as the tier rises', () => {
        ORDER.forEach((name) => expect(POST_LOOK[name]).toBeTruthy());
        for (let i = 1; i < ORDER.length; i++) {
            const lower = POST_LOOK[ORDER[i - 1]];
            const higher = POST_LOOK[ORDER[i]];
            expect(higher.rays).toBeGreaterThanOrEqual(lower.rays);
            expect(higher.rush).toBeGreaterThanOrEqual(lower.rush);
            expect(Number(higher.bloom)).toBeGreaterThanOrEqual(Number(lower.bloom));
        }
        expect(POST_LOOK.Minimal.bloom).toBe(false);
    });
});
