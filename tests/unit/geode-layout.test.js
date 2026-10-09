import { describe, expect, it } from 'vitest';
import {
    BAND_EDGE_WANDER, CAVITY, CLEAR_REACH, CLEAR_TRAVEL, CROWN_COLORS, CROWN_RINGS, CROWN_W0, CROWN_W1, DEG,
    GEODE_PALETTES, MINERALS, MINERAL_HOLD, MINERAL_PERIOD, PALETTE_KEYS, PULSE_REACH, TAU, approach, clamp01,
    clearFront, clearPassTime, crownForCombo, lerp, linRGB, mineralDrift, mulberry32, paletteAt, pieceColor,
    powerForCombo, pulseFront, smooth, spectrum, wallNormal, wallPoint, wallW,
} from '../../src/themes/geode/geode-core.js';
import {
    CLUSTERS, CLUSTER_SIZE, bandEdgeAt, buildPlan, reliefAt, zoneAt,
} from '../../src/themes/geode/geode-layout.js';
import { NOISE_SIZE, bakeNoise, sampleNoise } from '../../src/themes/geode/geode-tsl.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/geode/geode-quality.js';
import { GEODE_TETROMINOS } from '../../src/themes/geode/geode-tetrominos.js';

const field = bakeNoise();
const sample = (x, y, channel) => sampleNoise(field, NOISE_SIZE, x, y, channel);
const OPTIONS = Object.freeze({ crownPerRing: 20, druzy: 6000, stars: 400 });
const plan = buildPlan(sample, OPTIONS);

/** The smooth egg's implicit function: 1 on the wall, less inside the cavity, more in the rock. */
const egg = (x, y, z) => (x / CAVITY.a) ** 2 + (y / CAVITY.a) ** 2 + ((z - CAVITY.zc) / CAVITY.c) ** 2;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const peak = (rgb) => Math.max(rgb[0], rgb[1], rgb[2]);

/** The plan lets the lining stand this far inside the agate's ragged edge (`w < edge - 0.02`). */
const EDGE_SLACK = 0.02;
/**
 * A point is stored a little off the wall coordinate it was placed at: it stands on the lumpy
 * wall, not the smooth egg, and its root is buried along its own leaning axis. Measured: 0.03.
 */
const W_TOLERANCE = 0.06;
/** A crown ring's own scatter round its wall coordinate (the plan's jitter plus the relief). */
const RING_TOLERANCE = 0.06;

const WALL_GRID = [];
for (const w of [0.05, CAVITY.wHeart, CAVITY.wBands, 1.6, CROWN_W1, CAVITY.wMax]) {
    for (const phi of [0, 0.7, Math.PI / 2, 2.5, Math.PI, -1.2]) WALL_GRID.push([w, phi]);
}

describe('geode core: the wall', () => {
    it('places a wall coordinate on the egg and reads it back', () => {
        for (const [w, phi] of WALL_GRID) {
            const p = wallPoint(w, phi);
            expect(egg(...p)).toBeCloseTo(1, 9);
            expect(wallW(...p)).toBeCloseTo(w, 9);
            expect(Math.cos(Math.atan2(p[1], p[0]) - phi)).toBeCloseTo(1, 9);
            // Any point between the wall and the cavity's centre stands on the same ring.
            for (const k of [0.2, 0.6]) {
                expect(wallW(p[0] * k, p[1] * k, CAVITY.zc + (p[2] - CAVITY.zc) * k)).toBeCloseTo(w, 9);
            }
        }
        // The heart is the far pole; phi 0 is to the right of the board and a quarter turn is above it.
        const pole = wallPoint(0, 1.3);
        expect(pole[0]).toBeCloseTo(0, 9);
        expect(pole[1]).toBeCloseTo(0, 9);
        expect(pole[2]).toBeCloseTo(CAVITY.zc - CAVITY.c, 9);
        expect(wallW(...pole)).toBeCloseTo(0, 9);
        const right = wallPoint(Math.PI / 2, 0);
        expect(right[0]).toBeCloseTo(CAVITY.a, 9);
        expect(right[1]).toBeCloseTo(0, 9);
        expect(right[2]).toBeCloseTo(CAVITY.zc, 9);
        expect(wallPoint(Math.PI / 2, Math.PI / 2)[1]).toBeCloseTo(CAVITY.a, 9);
        // The viewer floats inside the egg, and the wall is built out past the ring level with them.
        expect(egg(0, 0, 0)).toBeLessThan(1);
        const level = Math.acos(CAVITY.zc / CAVITY.c);
        expect(wallPoint(level, 0)[2]).toBeCloseTo(0, 9);
        expect(level).toBeLessThan(CAVITY.wMax);
        expect(CAVITY.wHeart).toBeLessThan(CAVITY.wBands);
        expect(CAVITY.wBands).toBeLessThan(CAVITY.wMax);
        expect(CAVITY.wMax).toBeLessThan(Math.PI);
        // It writes into the array it is given.
        const out = [9, 9, 9];
        expect(wallPoint(1, 2, out)).toBe(out);
        expect(out).toEqual(wallPoint(1, 2));
    });

    it('points the wall\'s normal into the cavity, a unit vector square to the wall', () => {
        const step = 1e-5;
        for (const [w, phi] of WALL_GRID) {
            const p = wallPoint(w, phi);
            const n = wallNormal(w, phi);
            expect(Math.hypot(...n)).toBeCloseTo(1, 9);
            // A span along it is inside the egg; a span against it is in the rock.
            expect(egg(p[0] + n[0], p[1] + n[1], p[2] + n[2])).toBeLessThan(1);
            expect(egg(p[0] - n[0], p[1] - n[1], p[2] - n[2])).toBeGreaterThan(1);
            // Square to the wall along it and round it.
            const a = wallPoint(w + step, phi);
            const b = wallPoint(w - step, phi);
            const along = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
            expect(dot(n, along) / Math.hypot(...along)).toBeCloseTo(0, 6);
            const c = wallPoint(w, phi + step);
            const d = wallPoint(w, phi - step);
            const round = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
            expect(dot(n, round) / Math.hypot(...round)).toBeCloseTo(0, 6);
        }
        // At the heart it points straight down the axis at the viewer.
        const pole = wallNormal(0, 0.4);
        expect(pole[2]).toBeCloseTo(1, 9);
        expect(Math.hypot(pole[0], pole[1])).toBeCloseTo(0, 9);
        const out = [0, 0, 0];
        expect(wallNormal(1, 2, out)).toBe(out);
    });
});

describe('geode core: waves and charge', () => {
    it('sends a lock\'s ring out from the heart, fast at first, settling inside its reach', () => {
        expect(pulseFront(-1)).toBe(0);
        expect(pulseFront(0)).toBe(0);
        let previous = 0;
        for (let i = 1; i <= 40; i++) {
            const front = pulseFront(i * 0.1);
            expect(front).toBeGreaterThan(previous);
            previous = front;
        }
        // It slows as it goes: the first tenth of a second covers more wall than a later one.
        expect(pulseFront(0.2) - pulseFront(0.1)).toBeGreaterThan(pulseFront(1.1) - pulseFront(1.0));
        expect(pulseFront(600)).toBeLessThanOrEqual(PULSE_REACH);
        expect(pulseFront(600)).toBeGreaterThan(PULSE_REACH * 0.99);
        // A harder lock's ring reaches further, in proportion.
        expect(pulseFront(0.7, 0.5)).toBeCloseTo(pulseFront(0.7) * 0.5, 12);
        expect(pulseFront(600, 1.12)).toBeCloseTo(PULSE_REACH * 1.12, 6);
    });

    it('runs a clear wave down the wall, gathering speed, and knows when it passes a ring', () => {
        expect(clearFront(-1)).toBe(0);
        expect(clearFront(0)).toBe(0);
        expect(clearFront(CLEAR_TRAVEL)).toBeCloseTo(CLEAR_REACH, 9);
        expect(clearFront(CLEAR_TRAVEL * 3)).toBeCloseTo(CLEAR_REACH, 9);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const front = clearFront((CLEAR_TRAVEL * i) / 20);
            expect(front).toBeGreaterThan(previous);
            previous = front;
        }
        // It gathers speed: the second half of its run covers at least as much wall as the first.
        const half = clearFront(CLEAR_TRAVEL / 2);
        expect(CLEAR_REACH - half).toBeGreaterThanOrEqual(half);
        // The pass time is the wave's inverse: a crystal lets go exactly as the front reaches it.
        for (const w of [0.05, CAVITY.wHeart, CAVITY.wBands, CROWN_W1, CLEAR_REACH]) {
            expect(clearFront(clearPassTime(w))).toBeCloseTo(w, 9);
        }
        for (const part of [0.05, 0.3, 0.7, 1]) {
            expect(clearPassTime(clearFront(CLEAR_TRAVEL * part))).toBeCloseTo(CLEAR_TRAVEL * part, 9);
        }
        previous = 0;
        for (let i = 1; i <= 20; i++) {
            const pass = clearPassTime((CLEAR_REACH * i) / 20);
            expect(pass).toBeGreaterThan(previous);
            previous = pass;
        }
        expect(clearPassTime(0)).toBe(0);
        expect(clearPassTime(-3)).toBe(0);
        expect(clearPassTime(CLEAR_REACH * 10)).toBe(CLEAR_TRAVEL);
        // The wave reaches every ring of the wall the geode builds, each at its own moment.
        expect(CLEAR_REACH).toBeGreaterThanOrEqual(CAVITY.wMax);
    });

    it('charges with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        let previous = 0;
        for (let combo = 1; combo <= 12; combo++) {
            expect(powerForCombo(combo)).toBeGreaterThan(previous);
            previous = powerForCombo(combo);
        }
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
        expect(powerForCombo(500)).toBeGreaterThan(0.99);
    });

    it('grows one ring of the crown for every step of a chain past the first, and no more than it has', () => {
        // One clear is not a chain.
        expect(crownForCombo(0)).toBe(0);
        expect(crownForCombo(1)).toBe(0);
        for (let combo = 2; combo <= CROWN_RINGS + 1; combo++) expect(crownForCombo(combo)).toBe(combo - 1);
        expect(crownForCombo(CROWN_RINGS + 2)).toBe(CROWN_RINGS);
        expect(crownForCombo(CROWN_RINGS + 50)).toBe(CROWN_RINGS);
        expect(crownForCombo(-4)).toBe(0);
        expect(crownForCombo(2.6)).toBe(2); // a combo is a whole number of clears
        // Every ring has a colour of its own to burn in.
        expect(CROWN_COLORS).toHaveLength(CROWN_RINGS);
        CROWN_COLORS.forEach((colour, ring) => {
            expect(colour, `ring ${ring + 1}`).toHaveLength(3);
            for (const channel of colour) {
                expect(Number.isFinite(channel), `ring ${ring + 1}`).toBe(true);
                expect(channel, `ring ${ring + 1}`).toBeGreaterThan(0);
            }
            if (ring > 0) {
                const before = CROWN_COLORS[ring - 1];
                expect(Math.hypot(colour[0] - before[0], colour[1] - before[1], colour[2] - before[2]))
                    .toBeGreaterThan(0.05);
            }
        });
    });
});

describe('geode core: colour', () => {
    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const amber = pieceColor('#ffa050');
        expect(peak(amber)).toBeCloseTo(1, 6);
        expect(Math.min(...amber)).toBeGreaterThanOrEqual(0.05);
        // The hue survives: red over green over blue.
        expect(amber[0]).toBeGreaterThan(amber[1]);
        expect(amber[1]).toBeGreaterThan(amber[2]);
        // A pastel is pushed toward its own hue: its weakest channel falls further than it would
        // by normalising alone.
        const pastel = pieceColor('#ffd0e0');
        const plain = linRGB(0xffd0e0);
        expect(pastel[1]).toBeLessThan(plain[1] / peak(plain));
        expect(peak(pastel)).toBeCloseTo(1, 6);
        // A pure primary still reaches all three channels.
        const blue = pieceColor(0x0000ff);
        expect(blue[2]).toBeCloseTo(1, 6);
        expect(blue[0]).toBeGreaterThan(0);
        expect(blue[1]).toBeGreaterThan(0);
        // A hex with or without its hash, in either case, padded or not.
        expect(pieceColor('a8ffe8')).toEqual(pieceColor('#A8FFE8'));
        expect(pieceColor('  #a8ffe8 ')).toEqual(pieceColor(0xa8ffe8));
        // Nonsense falls back to the given colour, or to the geode's own.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor('#12345', 0x00ff00)).toEqual(pieceColor(0x00ff00));
        expect(pieceColor('#gggggg', 0x00ff00)).toEqual(pieceColor(0x00ff00));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(peak(pieceColor(null))).toBeCloseTo(1, 6);
        // Every piece the theme draws gives a spark a colour it can carry.
        for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
            const rgb = pieceColor(GEODE_TETROMINOS.colors[type]);
            expect(rgb, type).toHaveLength(3);
            expect(peak(rgb), type).toBeCloseTo(1, 6);
            expect(Math.min(...rgb), type).toBeGreaterThanOrEqual(0.05);
        }
    });

    it('walks the spectrum by hue: red, green, blue, and round again', () => {
        const brightest = (rgb) => rgb.indexOf(peak(rgb));
        expect(brightest(spectrum(0))).toBe(0);
        expect(brightest(spectrum(1 / 3))).toBe(1);
        expect(brightest(spectrum(2 / 3))).toBe(2);
        // Between red and green lies yellow: both over blue.
        const yellow = spectrum(1 / 6);
        expect(Math.min(yellow[0], yellow[1])).toBeGreaterThan(yellow[2]);
        expect(yellow[0]).toBeCloseTo(yellow[1], 9);
        // The hue is a turn: it wraps.
        for (let k = 0; k < 3; k++) {
            expect(spectrum(1.25)[k]).toBeCloseTo(spectrum(0.25)[k], 9);
            expect(spectrum(-0.75)[k]).toBeCloseTo(spectrum(0.25)[k], 9);
        }
        // Never black in any channel, and the same brightness at every primary.
        for (let i = 0; i <= 24; i++) {
            for (const channel of spectrum(i / 24)) {
                expect(Number.isFinite(channel)).toBe(true);
                expect(channel).toBeGreaterThan(0);
            }
        }
        expect(peak(spectrum(1 / 3))).toBeCloseTo(peak(spectrum(0)), 9);
        expect(peak(spectrum(2 / 3))).toBeCloseTo(peak(spectrum(0)), 9);
    });

    it('turns the minerals by the clock: a rest on each, then a slow eased melt into the next', () => {
        expect(MINERAL_PERIOD).toBeGreaterThanOrEqual(60);
        expect(MINERAL_HOLD).toBeGreaterThan(0);
        expect(MINERAL_HOLD).toBeLessThan(1);
        // Nonsense and the time before the start are the start.
        for (const time of [0, -5, NaN, undefined, null, 'soon']) expect(mineralDrift(time)).toBe(0);
        // It rests on a mineral first.
        expect(mineralDrift(MINERAL_PERIOD * MINERAL_HOLD * 0.99)).toBe(0);
        expect(mineralDrift(MINERAL_PERIOD * (MINERAL_HOLD + 0.05))).toBeGreaterThan(0);
        // A whole mineral every period, and every period like the first.
        for (let k = 1; k <= 8; k++) {
            expect(mineralDrift(MINERAL_PERIOD * k)).toBe(k);
            expect(mineralDrift(MINERAL_PERIOD * (k + MINERAL_HOLD * 0.5))).toBe(k);
            expect(mineralDrift(MINERAL_PERIOD * (k + 0.7))).toBeCloseTo(k + mineralDrift(MINERAL_PERIOD * 0.7), 9);
        }
        // It never goes back and never jumps: at its quickest a mineral would still take 20 s.
        let last = 0;
        let steepest = 0;
        let backwards = 0;
        for (let frame = 1; frame <= MINERAL_PERIOD * 2 * 60; frame++) {
            const now = mineralDrift(frame / 60);
            if (now < last) backwards += 1;
            steepest = Math.max(steepest, now - last);
            last = now;
        }
        expect(backwards).toBe(0);
        expect(last).toBeCloseTo(2, 9);
        expect(steepest * 60).toBeLessThan(1 / 20);
    });

    it('melts one mineral into the next round the colour wheel, as vivid between them as at either end', () => {
        const count = GEODE_PALETTES.length;
        const saturation = (rgb) => (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
        for (let k = 0; k < count * 2; k++) {
            // On a whole phase it is that mineral's own palette, exactly; the cycle closes.
            const pure = paletteAt(k);
            for (const key of PALETTE_KEYS) {
                expect(pure[key], `${k}.${key}`).toEqual([...GEODE_PALETTES[k % count][key]]);
            }
            const from = GEODE_PALETTES[k % count];
            const to = GEODE_PALETTES[(k + 1) % count];
            for (const melt of [0.25, 0.5, 0.75]) {
                const between = paletteAt(k + melt);
                for (const key of PALETTE_KEYS) {
                    const label = `${from.name} > ${to.name} ${key} at ${melt}`;
                    // No colour goes grey or dark on the way: saturation and brightness cross over.
                    const s = [saturation(from[key]), saturation(to[key])];
                    const v = [peak(from[key]), peak(to[key])];
                    expect(saturation(between[key]), label).toBeCloseTo(s[0] + (s[1] - s[0]) * melt, 9);
                    expect(peak(between[key]), label).toBeCloseTo(v[0] + (v[1] - v[0]) * melt, 9);
                    for (const channel of between[key]) {
                        expect(channel, label).toBeGreaterThanOrEqual(0);
                        expect(channel, label).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
        // Where a straight mix would go grey: amethyst's violet lining half-way to citrine's amber.
        const half = paletteAt(0.5).druzy;
        const straight = GEODE_PALETTES[0].druzy.map((channel, c) => (channel + GEODE_PALETTES[1].druzy[c]) / 2);
        expect(saturation(half)).toBeGreaterThan(saturation(straight) + 0.2);
        // It never jumps, at the seams between minerals least of all, and writes into what it is given.
        const out = {};
        const last = PALETTE_KEYS.map((key) => [...paletteAt(0, out)[key]]);
        /** Move `last` on to what `out` holds now: the widest change in any channel. */
        const advance = () => {
            let step = 0;
            PALETTE_KEYS.forEach((key, n) => {
                out[key].forEach((channel, c) => {
                    step = Math.max(step, Math.abs(channel - last[n][c]));
                    last[n][c] = channel;
                });
            });
            return step;
        };
        let widest = 0;
        for (let i = 1; i <= count * 600; i++) {
            expect(paletteAt(i / 600, out)).toBe(out);
            widest = Math.max(widest, advance());
        }
        expect(widest).toBeLessThan(0.02);
        PALETTE_KEYS.forEach((key, n) => {
            GEODE_PALETTES[0][key].forEach((channel, c) => expect(last[n][c], key).toBeCloseTo(channel, 12));
        });
    });

    it('defines every palette key for every level\'s mineral, in scene-linear light', () => {
        expect(GEODE_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(GEODE_PALETTES.map((palette) => palette.name)).size).toBe(GEODE_PALETTES.length);
        for (const palette of GEODE_PALETTES) {
            expect(typeof palette.name).toBe('string');
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                    expect(channel, `${palette.name}.${key}`).toBeLessThanOrEqual(1);
                }
            }
            // The heart is the brightest thing in the geode; the rock between the crystals the darkest.
            expect(peak(palette.heart), palette.name).toBeGreaterThan(peak(palette.rock));
        }
        // The keys name every mineral a cluster can be cut from, and the agate's four bands.
        for (let i = 0; i < MINERALS; i++) expect(PALETTE_KEYS).toContain(`m${i}`);
        for (let i = 0; i < 4; i++) expect(PALETTE_KEYS).toContain(`band${i}`);
        expect(new Set(PALETTE_KEYS).size).toBe(PALETTE_KEYS.length);
    });

    it('converts sRGB hex to scene-linear, seeds a repeatable generator and eases by the clock', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        expect(linRGB(0xff0000)).toEqual([1, 0, 0]);
        const a = mulberry32(7);
        const b = mulberry32(7);
        const c = mulberry32(8);
        let differs = false;
        for (let i = 0; i < 50; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (c() !== v) differs = true;
        }
        expect(differs).toBe(true);
        // The approach closes the same fraction of a gap however the time is cut into frames.
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, 1e9)).toBe(1);
        const one = approach(3, 0.2);
        const two = 1 - (1 - approach(3, 0.1)) ** 2;
        expect(two).toBeCloseTo(one, 12);
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(0.3)).toBe(0.3);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(1, 3, 0)).toBe(0);
        expect(smooth(1, 3, 2)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 3, 9)).toBe(1);
        expect(TAU).toBeCloseTo(360 * DEG, 12);
    });
});

describe('geode noise field', () => {
    it('bakes four tileable channels stretched to the unit range, the same every time', () => {
        expect(field).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const lo = [Infinity, Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < field.length; i++) {
            lo[i % 4] = Math.min(lo[i % 4], field[i]);
            hi[i % 4] = Math.max(hi[i % 4], field[i]);
        }
        for (let c = 0; c < 4; c++) {
            expect(lo[c]).toBeCloseTo(0, 5);
            expect(hi[c]).toBeCloseTo(1, 5);
        }
        const again = bakeNoise();
        for (let i = 0; i < field.length; i += 997) expect(again[i]).toBe(field[i]);
    });

    it('reads the field bilinearly and wraps at its edges', () => {
        for (const [x, y] of [[0.3, 0.7], [0.999, 0.001], [0, 0]]) {
            const v = sample(x, y, 1);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(sample(x + 1, y - 1, 1)).toBeCloseTo(v, 9);
        }
        // At a texel centre it returns the texel.
        const texel = (ix, iy, c) => field[(iy * NOISE_SIZE + ix) * 4 + c];
        expect(sample(10.5 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2)).toBeCloseTo(texel(10, 20, 2), 6);
    });

    it('lumps the wall, wanders the agate\'s edge and zones the lining from it, round the axis without a seam', () => {
        let reliefLo = Infinity;
        let reliefHi = -Infinity;
        for (let i = 0; i < 400; i++) {
            const w = (CAVITY.wMax * (i % 20)) / 19;
            const phi = (TAU * Math.floor(i / 20)) / 20;
            const relief = reliefAt(sample, w, phi);
            reliefLo = Math.min(reliefLo, relief);
            reliefHi = Math.max(reliefHi, relief);
            // A whole turn round the axis comes back to the same wall.
            expect(reliefAt(sample, w, phi + TAU)).toBeCloseTo(relief, 6);
            const edge = bandEdgeAt(sample, w, phi);
            expect(edge).toBeGreaterThanOrEqual(CAVITY.wBands - BAND_EDGE_WANDER / 2 - 1e-9);
            expect(edge).toBeLessThanOrEqual(CAVITY.wBands + BAND_EDGE_WANDER / 2 + 1e-9);
            expect(bandEdgeAt(sample, w, phi + TAU)).toBeCloseTo(edge, 6);
            const zone = zoneAt(sample, w, phi);
            expect(zone).toBeGreaterThanOrEqual(0);
            expect(zone).toBeLessThan(MINERALS);
        }
        // The wall stands both in from the smooth egg and out of it.
        expect(reliefLo).toBeLessThan(0);
        expect(reliefHi).toBeGreaterThan(0);
        // The plan's surface is the smooth egg moved along its own normal by the relief.
        for (const [w, phi] of WALL_GRID) {
            const smoothPoint = wallPoint(w, phi);
            const lumpy = plan.surface(w, phi);
            const n = wallNormal(w, phi);
            const relief = plan.relief(w, phi);
            expect(relief).toBe(reliefAt(sample, w, phi));
            for (let k = 0; k < 3; k++) expect(lumpy[k]).toBeCloseTo(smoothPoint[k] + n[k] * relief, 9);
        }
        const out = [0, 0, 0];
        expect(plan.surface(1.2, 0.4, out)).toBe(out);
    });
});

describe('geode plan: the hero clusters', () => {
    it('is deterministic for a seed and different for another', () => {
        const again = buildPlan(sample, OPTIONS);
        expect(again.seed).toBe(plan.seed);
        expect(JSON.stringify(again.heroes)).toBe(JSON.stringify(plan.heroes));
        expect(JSON.stringify(again.crown)).toBe(JSON.stringify(plan.crown));
        expect(JSON.stringify(again.clusters)).toBe(JSON.stringify(plan.clusters));
        for (const key of ['base', 'axis', 'look']) {
            expect(Array.from(again.druzy[key])).toEqual(Array.from(plan.druzy[key]));
        }
        expect(Array.from(again.stars.pos)).toEqual(Array.from(plan.stars.pos));
        expect(Array.from(again.stars.look)).toEqual(Array.from(plan.stars.look));

        const other = buildPlan(sample, { ...OPTIONS, seed: 1234 });
        expect(other.seed).toBe(1234);
        expect(JSON.stringify(other.heroes)).not.toBe(JSON.stringify(plan.heroes));
        expect(JSON.stringify(other.crown)).not.toBe(JSON.stringify(plan.crown));
        expect(Array.from(other.druzy.base)).not.toEqual(Array.from(plan.druzy.base));
        expect(Array.from(other.stars.pos)).not.toEqual(Array.from(plan.stars.pos));
        // The clusters themselves are placed by hand: a seed only changes how each one grows.
        other.clusters.forEach((cluster, index) => {
            expect(cluster.root).toEqual(plan.clusters[index].root);
            expect(cluster.mineral).toBe(plan.clusters[index].mineral);
        });
        // With no options at all it still plans a whole geode.
        const plain = buildPlan(sample);
        expect(plain.heroes).toHaveLength(CLUSTERS.length * CLUSTER_SIZE);
        expect(plain.crown).toHaveLength(CROWN_RINGS * plain.crownPerRing);
        expect(plain.druzy.count).toBeGreaterThan(0);
    });

    it('roots a cluster where the table puts it, on the lumpy wall, cut from its mineral', () => {
        expect(plan.clusters).toHaveLength(CLUSTERS.length);
        const minerals = new Set();
        plan.clusters.forEach((cluster, index) => {
            const [wDeg, phiDeg, size, mineral] = CLUSTERS[index];
            expect(cluster.w).toBeCloseTo(wDeg * DEG, 12);
            expect(cluster.phi).toBeCloseTo(phiDeg * DEG, 12);
            expect(cluster.size).toBe(size);
            expect(cluster.mineral).toBe(mineral);
            expect(Number.isInteger(mineral)).toBe(true);
            expect(mineral).toBeGreaterThanOrEqual(0);
            expect(mineral).toBeLessThan(MINERALS);
            minerals.add(mineral);
            expect(cluster.root).toEqual(plan.surface(cluster.w, cluster.phi));
            expect(cluster.normal).toEqual(wallNormal(cluster.w, cluster.phi));
            // On the wall that is built, outside the heart's window.
            expect(cluster.w).toBeGreaterThan(CAVITY.wHeart);
            expect(cluster.w).toBeLessThan(CAVITY.wMax);
        });
        // Every mineral of the palette is cut somewhere.
        expect(minerals.size).toBe(MINERALS);
        // The clusters frame the board: some to each side of it, some above and some below.
        const roots = plan.clusters.map((cluster) => cluster.root);
        expect(roots.some((root) => root[0] < -CAVITY.a / 2)).toBe(true);
        expect(roots.some((root) => root[0] > CAVITY.a / 2)).toBe(true);
        expect(roots.some((root) => root[1] < -CAVITY.a / 2)).toBe(true);
        expect(roots.some((root) => root[1] > CAVITY.a / 2)).toBe(true);
    });

    it('grows the same number of crystals in every cluster, its tallest at the heart of it', () => {
        expect(plan.heroes).toHaveLength(CLUSTERS.length * CLUSTER_SIZE);
        for (let index = 0; index < CLUSTERS.length; index++) {
            const cluster = plan.clusters[index];
            const mine = plan.heroes.filter((crystal) => crystal.cluster === index);
            expect(mine, `cluster ${index}`).toHaveLength(CLUSTER_SIZE);
            const mains = mine.filter((crystal) => crystal.main);
            expect(mains, `cluster ${index}`).toHaveLength(1);
            const [main] = mains;
            expect(mine[0]).toBe(main);
            expect(main.mineral).toBe(cluster.mineral);
            // The main rises out of the cluster's root: the root lies on its axis, above its buried foot.
            const up = [cluster.root[0] - main.x, cluster.root[1] - main.y, cluster.root[2] - main.z];
            const along = dot(up, main.axis);
            expect(along).toBeGreaterThan(0);
            expect(along).toBeLessThan(main.height);
            expect(Math.hypot(up[0] - main.axis[0] * along, up[1] - main.axis[1] * along, up[2] - main.axis[2] * along))
                .toBeLessThan(1e-9);
            // It stands nearly square to the wall, into the cavity.
            expect(dot(main.axis, cluster.normal)).toBeGreaterThan(0);
            let own = 0;
            for (let k = 1; k < mine.length; k++) {
                const crystal = mine[k];
                expect(crystal.main).toBe(false);
                // The tallest first; none taller than the main.
                expect(crystal.height).toBeLessThanOrEqual(mine[k - 1].height);
                // A clump, not a scatter: every root within the main's height of the cluster's.
                const away = Math.hypot(
                    crystal.x - cluster.root[0],
                    crystal.y - cluster.root[1],
                    crystal.z - cluster.root[2],
                );
                expect(away).toBeLessThan(main.height);
                // It fans out of the wall, never into it.
                expect(dot(crystal.axis, cluster.normal)).toBeGreaterThan(0);
                if (crystal.mineral === cluster.mineral) own += 1;
            }
            // Now and then a neighbour is cut from another mineral; most are the cluster's own.
            expect(own).toBeGreaterThan((CLUSTER_SIZE - 1) / 2);
        }
    });

    it('lists the heroes by importance: every cluster\'s main, then every cluster\'s second, and on', () => {
        for (let i = 0; i < plan.heroes.length; i++) {
            const crystal = plan.heroes[i];
            expect(crystal.cluster, `hero ${i}`).toBe(i % CLUSTERS.length);
            expect(crystal.main, `hero ${i}`).toBe(i < CLUSTERS.length);
            expect(crystal.ring, `hero ${i}`).toBe(0);
            expect(Number.isInteger(crystal.mineral), `hero ${i}`).toBe(true);
            expect(crystal.mineral, `hero ${i}`).toBeGreaterThanOrEqual(0);
            expect(crystal.mineral, `hero ${i}`).toBeLessThan(MINERALS);
        }
        // So the first N of the list is the same number from each cluster, whenever N is a whole
        // number of rounds: a tier thins every cluster alike and keeps the whole composition.
        for (let rounds = 1; rounds <= CLUSTER_SIZE; rounds++) {
            const first = plan.heroes.slice(0, rounds * CLUSTERS.length);
            for (let index = 0; index < CLUSTERS.length; index++) {
                expect(first.filter((crystal) => crystal.cluster === index)).toHaveLength(rounds);
            }
        }
        // And a round's crystals are no taller than the round before, cluster by cluster.
        for (let i = CLUSTERS.length; i < plan.heroes.length; i++) {
            expect(plan.heroes[i].height, `hero ${i}`).toBeLessThanOrEqual(plan.heroes[i - CLUSTERS.length].height);
        }
    });

    it('hands a tier its first heroes and the whole crown, never fewer than one hero a cluster', () => {
        const total = plan.heroes.length;
        for (const count of [CLUSTERS.length, CLUSTERS.length * 3, 100, total]) {
            const list = plan.crystalsFor(count);
            expect(list).toHaveLength(count + plan.crown.length);
            for (let i = 0; i < count; i++) expect(list[i]).toBe(plan.heroes[i]);
            for (let i = 0; i < plan.crown.length; i++) expect(list[count + i]).toBe(plan.crown[i]);
            // Heroes (ring 0) first, then the crown ring by ring: what the crystals' draw counts on.
            const firstCrown = list.findIndex((crystal) => crystal.ring > 0);
            expect(firstCrown).toBe(count);
            expect(list.slice(count).every((crystal) => crystal.ring > 0)).toBe(true);
        }
        for (const few of [0, 1, -5, CLUSTERS.length - 1]) {
            const list = plan.crystalsFor(few);
            expect(list).toHaveLength(CLUSTERS.length + plan.crown.length);
            expect(list.slice(0, CLUSTERS.length).every((crystal) => crystal.main)).toBe(true);
        }
        expect(plan.crystalsFor(total + 500)).toHaveLength(total + plan.crown.length);
        // A fresh list each time: a caller may keep or cut its own.
        expect(plan.crystalsFor(40)).not.toBe(plan.crystalsFor(40));
    });
});

describe('geode plan: the crown', () => {
    it('stands a ring for every step of a chain, each further from the heart, between its two bounds', () => {
        expect(plan.crownPerRing).toBe(OPTIONS.crownPerRing);
        expect(plan.crown).toHaveLength(CROWN_RINGS * OPTIONS.crownPerRing);
        let previousMean = 0;
        for (let ring = 1; ring <= CROWN_RINGS; ring++) {
            // Ring by ring in the list.
            const mine = plan.crown.slice((ring - 1) * OPTIONS.crownPerRing, ring * OPTIONS.crownPerRing);
            expect(mine.every((crystal) => crystal.ring === ring), `ring ${ring}`).toBe(true);
            const nominal = lerp(CROWN_W0, CROWN_W1, (ring - 1) / (CROWN_RINGS - 1));
            let mean = 0;
            for (const crystal of mine) {
                expect(Math.abs(crystal.w - nominal), `ring ${ring}`).toBeLessThan(RING_TOLERANCE);
                expect(crystal.w).toBeGreaterThan(CROWN_W0 - RING_TOLERANCE);
                expect(crystal.w).toBeLessThan(CROWN_W1 + RING_TOLERANCE);
                // It burns in its ring's colour, and is no cluster's.
                expect(crystal.mineral).toBe(ring - 1);
                expect(crystal.main).toBe(false);
                expect(crystal.cluster).toBe(-1);
                mean += crystal.w / mine.length;
            }
            expect(mean, `ring ${ring}`).toBeGreaterThan(previousMean);
            previousMean = mean;
            // A ring goes all the way round: no gap wider than its jitter allows (a slot and a half).
            const angles = mine.map((crystal) => Math.atan2(crystal.y, crystal.x)).sort((a, b) => a - b);
            let gap = angles[0] + TAU - angles[angles.length - 1];
            for (let k = 1; k < angles.length; k++) gap = Math.max(gap, angles[k] - angles[k - 1]);
            expect(gap, `ring ${ring}`).toBeLessThan((TAU / OPTIONS.crownPerRing) * 1.75);
        }
        // The crown stands in the lining the viewer sees, short of the wall's end.
        expect(CROWN_W0).toBeLessThan(CROWN_W1);
        expect(CROWN_W1 + RING_TOLERANCE).toBeLessThan(CAVITY.wMax);
        // Another tier's rings hold another number of crystals.
        const dense = buildPlan(sample, { ...OPTIONS, crownPerRing: 33 });
        expect(dense.crownPerRing).toBe(33);
        expect(dense.crown).toHaveLength(CROWN_RINGS * 33);
        for (let ring = 1; ring <= CROWN_RINGS; ring++) {
            expect(dense.crown.filter((crystal) => crystal.ring === ring)).toHaveLength(33);
        }
    });
});

describe('geode plan: every crystal', () => {
    it('points along a unit axis into the cavity, from a root in the wall to its tip', () => {
        const all = [...plan.heroes, ...plan.crown];
        all.forEach((crystal, index) => {
            const label = `crystal ${index}`;
            for (const key of ['x', 'y', 'z', 'height', 'radius', 'yaw', 'seed', 'w']) {
                expect(Number.isFinite(crystal[key]), `${label}.${key}`).toBe(true);
            }
            expect(crystal.height, label).toBeGreaterThan(0);
            expect(crystal.radius, label).toBeGreaterThan(0);
            expect(crystal.radius, label).toBeLessThan(crystal.height);
            expect(crystal.yaw, label).toBeGreaterThanOrEqual(0);
            expect(crystal.yaw, label).toBeLessThan(TAU);
            expect(Number.isInteger(crystal.seed), label).toBe(true);
            expect(crystal.seed, label).toBeGreaterThan(0);
            expect(Math.hypot(...crystal.axis), label).toBeCloseTo(1, 9);
            // The tip a spark flies toward and a lance leaves from.
            for (let k = 0; k < 3; k++) {
                const root = [crystal.x, crystal.y, crystal.z][k];
                expect(crystal.tip[k], label).toBeCloseTo(root + crystal.axis[k] * crystal.height, 9);
            }
            // The ring of the wall it stands on: when a clear's wave reaches it.
            expect(crystal.w, label).toBe(wallW(crystal.x, crystal.y, crystal.z));
            expect(crystal.w, label).toBeGreaterThan(CAVITY.wHeart);
            expect(crystal.w, label).toBeLessThan(CAVITY.wMax);
            // It points into the hollow: its tip is deeper inside the egg than its root...
            expect(egg(...crystal.tip), label).toBeLessThan(egg(crystal.x, crystal.y, crystal.z));
            // ...and away from the wall under it.
            const under = wallNormal(crystal.w, Math.atan2(crystal.y, crystal.x));
            expect(dot(crystal.axis, under), label).toBeGreaterThan(0);
        });
        // No two crystals are the same stone.
        const seen = new Set(all.map((crystal) => `${crystal.x},${crystal.y},${crystal.z}`));
        expect(seen.size).toBe(all.length);
    });
});

describe('geode plan: the lining', () => {
    /** Unpack point `i` of the druzy. */
    const druzyAt = (druzy, i) => {
        const o = i * 4;
        return {
            base: [druzy.base[o], druzy.base[o + 1], druzy.base[o + 2]],
            height: druzy.base[o + 3],
            axis: [druzy.axis[o], druzy.axis[o + 1], druzy.axis[o + 2]],
            radius: druzy.axis[o + 3],
            yaw: druzy.look[o],
            zone: druzy.look[o + 1],
            seed: druzy.look[o + 2],
            w: druzy.look[o + 3],
        };
    };

    it('plants every point of the druzy it was asked for, packed four floats a point', () => {
        const { druzy } = plan;
        expect(druzy.count).toBe(OPTIONS.druzy);
        expect(druzy.base).toBeInstanceOf(Float32Array);
        expect(druzy.base).toHaveLength(druzy.count * 4);
        expect(druzy.axis).toHaveLength(druzy.count * 4);
        expect(druzy.look).toHaveLength(druzy.count * 4);
        for (const array of [druzy.base, druzy.axis, druzy.look]) {
            expect(array.every((value) => Number.isFinite(value))).toBe(true);
        }
    });

    it('keeps the druzy off the agate, on the wall, each point standing into the cavity', () => {
        const { druzy } = plan;
        const beyond = [];
        const heights = [];
        for (let i = 0; i < druzy.count; i++) {
            const point = druzyAt(druzy, i);
            const label = `point ${i}`;
            const phi = Math.atan2(point.base[1], point.base[0]);
            // On the wall that is built...
            expect(point.w, label).toBeGreaterThanOrEqual(0);
            expect(point.w, label).toBeLessThanOrEqual(CAVITY.wMax);
            // ...at or beyond the agate's ragged edge there...
            const margin = point.w - bandEdgeAt(sample, point.w, phi);
            expect(margin, label).toBeGreaterThan(-(EDGE_SLACK + 0.02));
            // ...where it says it is: the wall coordinate the waves reach it by.
            expect(Math.abs(wallW(...point.base) - point.w), label).toBeLessThan(W_TOLERANCE);
            // A small pointed stone: a height, a girth, a turn, a seed, a mineral zone.
            expect(point.height, label).toBeGreaterThan(0);
            expect(point.radius, label).toBeGreaterThan(0);
            expect(point.radius, label).toBeLessThan(point.height);
            expect(point.yaw, label).toBeGreaterThanOrEqual(0);
            expect(point.yaw, label).toBeLessThan(TAU + 1e-6);
            expect(Number.isInteger(point.seed), label).toBe(true);
            expect(point.seed, label).toBeGreaterThan(0);
            expect(point.zone, label).toBeGreaterThanOrEqual(0);
            expect(point.zone, label).toBeLessThan(MINERALS);
            // Unit axis (to a float's worth), out of the wall.
            expect(Math.hypot(...point.axis), label).toBeCloseTo(1, 5);
            expect(dot(point.axis, wallNormal(point.w, phi)), label).toBeGreaterThan(0);
            beyond.push(margin);
            heights.push(point.height);
        }
        // The points that border the agate stand tallest.
        const mean = (pick) => {
            let sum = 0;
            let n = 0;
            for (let i = 0; i < heights.length; i++) {
                if (pick(beyond[i])) {
                    sum += heights[i];
                    n += 1;
                }
            }
            expect(n).toBeGreaterThan(20);
            return sum / n;
        };
        expect(mean((margin) => margin < 0.05)).toBeGreaterThan(mean((margin) => margin > 0.4));
        // The lining goes all the way round the axis, and every mineral zones some of it.
        const sectors = new Set();
        const zones = new Set();
        for (let i = 0; i < druzy.count; i++) {
            const point = druzyAt(druzy, i);
            sectors.add(Math.floor(((Math.atan2(point.base[1], point.base[0]) + Math.PI) / TAU) * 12) % 12);
            zones.add(Math.floor(point.zone));
        }
        expect(sectors.size).toBe(12);
        expect(zones.size).toBe(MINERALS);
    });

    it('sets its stars in the lining too, beyond the agate\'s edge, a little proud of the wall', () => {
        const { stars } = plan;
        expect(stars.count).toBe(OPTIONS.stars);
        expect(stars.pos).toBeInstanceOf(Float32Array);
        expect(stars.pos).toHaveLength(stars.count * 4);
        expect(stars.look).toHaveLength(stars.count * 4);
        for (let i = 0; i < stars.count; i++) {
            const o = i * 4;
            const label = `star ${i}`;
            const [x, y, z, w] = stars.pos.subarray(o, o + 4);
            const phi = Math.atan2(y, x);
            expect(w, label).toBeLessThanOrEqual(CAVITY.wMax);
            // (the coordinate is kept as a float: allow it its last digit)
            expect(w - bandEdgeAt(sample, w, phi), label).toBeGreaterThan(-1e-3);
            expect(Math.abs(wallW(x, y, z) - w), label).toBeLessThan(W_TOLERANCE);
            // Proud of the lumpy wall, inside the cavity.
            const wall = plan.surface(w, phi);
            const out = [x - wall[0], y - wall[1], z - wall[2]];
            expect(dot(out, wallNormal(w, phi)), label).toBeGreaterThan(0);
            // (a phase, a mineral zone, two more random numbers for the shader)
            expect(stars.look[o + 1], label).toBeGreaterThanOrEqual(0);
            expect(stars.look[o + 1], label).toBeLessThan(MINERALS);
            for (const k of [0, 2, 3]) {
                expect(stars.look[o + k], label).toBeGreaterThanOrEqual(0);
                expect(stars.look[o + k], label).toBeLessThanOrEqual(1);
            }
        }
    });
});

describe('geode tiers and the plan', () => {
    it('defines every quality tier, falling back to High', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        const keys = Object.keys(QUALITY.High);
        for (const key of ['heroes', 'crownPerRing', 'druzy', 'motes', 'stars', 'shards']) expect(keys).toContain(key);
        for (let i = 0; i < QUALITY_NAMES.length; i++) {
            const tier = QUALITY[QUALITY_NAMES[i]];
            // Every tier answers the same questions: a count, or a switch.
            expect(Object.keys(tier), QUALITY_NAMES[i]).toEqual(keys);
            for (const key of keys) {
                const label = `${QUALITY_NAMES[i]}.${key}`;
                expect(['number', 'boolean'], label).toContain(typeof tier[key]);
                expect(Number(tier[key]), label).toBeGreaterThanOrEqual(0);
                // A switch once on stays on; a count never falls.
                const below = i > 0 ? QUALITY[QUALITY_NAMES[i - 1]][key] : 0;
                expect(Number(tier[key]), label).toBeGreaterThanOrEqual(Number(below));
            }
        }
    });

    it('thins every cluster alike on every tier, and gets every point of lining it asks the plan for', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            // A whole number of rounds of the hero list: the same number from each cluster.
            expect(tier.heroes % CLUSTERS.length, name).toBe(0);
            expect(tier.heroes, name).toBeGreaterThanOrEqual(CLUSTERS.length);
            expect(tier.heroes, name).toBeLessThanOrEqual(CLUSTERS.length * CLUSTER_SIZE);
            // The whole picture and every event: a crown to grow, dust for a crystal to throw.
            expect(tier.crownPerRing, name).toBeGreaterThan(0);
            expect(tier.shards, name).toBeGreaterThan(0);
            expect(tier.druzy, name).toBeGreaterThan(0);
            expect(tier.stars, name).toBeGreaterThan(0);

            const tiered = buildPlan(sample, { crownPerRing: tier.crownPerRing, druzy: tier.druzy, stars: tier.stars });
            expect(tiered.druzy.count, name).toBe(tier.druzy);
            expect(tiered.stars.count, name).toBe(tier.stars);
            expect(tiered.crown, name).toHaveLength(CROWN_RINGS * tier.crownPerRing);
            const list = tiered.crystalsFor(tier.heroes);
            expect(list, name).toHaveLength(tier.heroes + CROWN_RINGS * tier.crownPerRing);
            for (let index = 0; index < CLUSTERS.length; index++) {
                expect(list.filter((crystal) => crystal.cluster === index), `${name} cluster ${index}`)
                    .toHaveLength(tier.heroes / CLUSTERS.length);
            }
            // The heroes do not depend on how much lining a tier affords: the same geode on every tier.
            expect(JSON.stringify(tiered.heroes), name).toBe(JSON.stringify(plan.heroes));
        }
    });
});
