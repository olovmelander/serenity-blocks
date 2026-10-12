/**
 * Rainbark — the three-free core: the bark palette and its gate, the piece codes, the Climb,
 * the tide, the sun and the shared tables. Relations, not tuning numbers: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    CLIMB_BASE,
    CLIMB_LEVELS,
    EVENT_ROWS,
    EVENT_ROWS_PER,
    EVENT_SLOTS,
    MISTFALL,
    PALETTE_ROWS,
    PIECE_AGE,
    PIECE_CODE,
    RAMP_STOPS,
    SHAPES,
    SHAPE_KEYS,
    STOREY,
    TIDE_PERIOD,
    ZONES,
    ZONE_COLOR_KEYS,
    cellsFromMatrix,
    climbHeight,
    hexToLinear,
    levelCycle,
    mulberry32,
    pieceCode,
    rampAt,
    smooth,
    smoother,
    sunDirection,
    tideAt,
    zoneIndex,
} from '../../src/themes/rainbark/rainbark-core.js';
import { RAINBARK_TETROMINOS } from '../../src/themes/rainbark/rainbark-tetrominos.js';

/** The familiar shape → hue bands, and the hue maths, of scripts/palette-guideline-check.mjs. */
const GUIDELINE_BANDS = {
    I: [[160, 210]],
    O: [[32, 75]],
    T: [[245, 315]],
    S: [[90, 170]],
    Z: [[320, 360], [0, 20]],
    J: [[200, 250]],
    L: [[20, 50]],
};

function hexToHue(hex) {
    const n = hex.replace('#', '');
    const r = parseInt(n.slice(0, 2), 16) / 255;
    const g = parseInt(n.slice(2, 4), 16) / 255;
    const b = parseInt(n.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return (h + 360) % 360;
}

const inBands = (hue, bands) => hue !== null && bands.some(([lo, hi]) => hue >= lo && hue <= hi);
const HEX = /^#[0-9a-f]{6}$/i;

describe('Rainbark core: the bark palette', () => {
    it('passes the palette gate at 0/7: no piece wears the hue its shape is known by', () => {
        const hue = (key) => hexToHue(RAINBARK_TETROMINOS.colors[key]);
        const matched = SHAPE_KEYS.filter((key) => inBands(hue(key), GUIDELINE_BANDS[key]));
        expect(matched).toEqual([]);
        expect(RAINBARK_TETROMINOS.version).toBe(2);
        expect(Object.keys(RAINBARK_TETROMINOS.colors)).toEqual(expect.arrayContaining([...SHAPE_KEYS, 'GARBAGE']));
        Object.values(RAINBARK_TETROMINOS.colors).forEach((hex) => expect(hex).toMatch(HEX));
    });

    it('deals every piece one age of the bark: ramp stops 0..6 are the seven piece colours', () => {
        const byCode = Object.keys(PIECE_CODE).filter((key) => key !== 'GARBAGE')
            .sort((a, b) => PIECE_CODE[a] - PIECE_CODE[b]);
        expect(byCode).toEqual(['I', 'T', 'Z', 'L', 'S', 'J', 'O']);
        for (let code = 0; code < 7; code++) {
            const [age, hex] = RAMP_STOPS[code];
            expect(hex.toLowerCase()).toBe(RAINBARK_TETROMINOS.colors[byCode[code]].toLowerCase());
            expect(age).toBeCloseTo(PIECE_AGE[code], 9);
        }
        // Seven colours, seven different hues.
        expect(new Set(byCode.map((key) => RAINBARK_TETROMINOS.colors[key].toLowerCase())).size).toBe(7);
    });

    it('ages the ramp from fresh to old, with the old husk at its end', () => {
        const ages = RAMP_STOPS.map(([age]) => age);
        for (let i = 1; i < ages.length; i++) expect(ages[i]).toBeGreaterThanOrEqual(ages[i - 1]);
        expect(ages[0]).toBe(0);
        expect(ages[ages.length - 1]).toBe(1);
        RAMP_STOPS.forEach(([, hex]) => expect(hex).toMatch(HEX));
        expect(PIECE_AGE).toHaveLength(8);
        expect(PIECE_AGE[PIECE_CODE.GARBAGE]).toBeGreaterThan(PIECE_AGE[PIECE_CODE.O]);
    });

    it('reads the ramp in linear light, exactly at its stops and between them', () => {
        RAMP_STOPS.forEach(([age, hex]) => {
            const at = rampAt(age);
            const want = hexToLinear(hex);
            for (let c = 0; c < 3; c++) expect(at[c]).toBeCloseTo(want[c], 6);
        });
        const a = hexToLinear(RAMP_STOPS[0][1]);
        const b = hexToLinear(RAMP_STOPS[1][1]);
        const mid = rampAt((RAMP_STOPS[0][0] + RAMP_STOPS[1][0]) / 2);
        for (let c = 0; c < 3; c++) expect(mid[c]).toBeCloseTo((a[c] + b[c]) / 2, 6);
        // Out of range and nonsense are clamped, never NaN.
        expect(rampAt(-3)).toEqual(rampAt(0));
        expect(rampAt(7)).toEqual(rampAt(1));
        expect(rampAt(NaN).every(Number.isFinite)).toBe(true);
    });

    it('converts sRGB hexes to linear light', () => {
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
        const grey = hexToLinear('#808080');
        expect(grey[0]).toBeCloseTo(0.2158605, 5);
        expect(hexToLinear('not a colour')).toEqual([0, 0, 0]);
        const out = [9, 9, 9];
        expect(hexToLinear('#FF0000', out)).toBe(out);
        expect(out).toEqual([1, 0, 0]);
    });
});

describe('Rainbark core: pieces', () => {
    it('codes a piece by its shape, whatever the case, and anything else as old husk', () => {
        SHAPE_KEYS.forEach((key) => {
            expect(pieceCode(key)).toBe(PIECE_CODE[key]);
            expect(pieceCode(key.toLowerCase())).toBe(PIECE_CODE[key]);
            expect(pieceCode(` ${key} `)).toBe(PIECE_CODE[key]);
        });
        expect(pieceCode('GARBAGE')).toBe(7);
        for (const odd of ['X', '', null, undefined, 3, {}, 'toString', '__proto__']) {
            expect(pieceCode(odd), String(odd)).toBe(PIECE_CODE.GARBAGE);
        }
    });

    it('turns a matrix into four cells centred on their own box, y up', () => {
        expect(cellsFromMatrix(SHAPES.I)).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(cellsFromMatrix(SHAPES.O)).toEqual([-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
        // T: the stem on top (row 0), the bar below (row 1): y up puts the stem above.
        expect(cellsFromMatrix(SHAPES.T)).toEqual([0, 0.5, -1, -0.5, 0, -0.5, 1, -0.5]);
        // A padded matrix centres on the occupied cells, never on its padding.
        const padded = cellsFromMatrix([[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]]);
        expect(padded).toEqual(cellsFromMatrix(SHAPES.I));
        SHAPE_KEYS.forEach((key) => {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells).toHaveLength(8);
            let sx = 0;
            let sy = 0;
            for (let i = 0; i < 8; i += 2) {
                sx += cells[i];
                sy += cells[i + 1];
            }
            // Centred on the box: the cells' extremes are symmetric.
            const xs = cells.filter((_, i) => i % 2 === 0);
            const ys = cells.filter((_, i) => i % 2 === 1);
            expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs), 9);
            expect(Math.min(...ys)).toBeCloseTo(-Math.max(...ys), 9);
            expect(Number.isFinite(sx + sy)).toBe(true);
        });
        for (const odd of [null, undefined, 'T', [], [[0, 0], [0, 0]], [null, 'x']]) {
            expect(cellsFromMatrix(odd), JSON.stringify(odd)).toBeNull();
        }
    });
});

describe('Rainbark core: maths', () => {
    it('steps smoothly between two edges, with equal and reversed edges defined', () => {
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBe(0.5);
        expect(smooth(0, 1, 0.25)).toBeCloseTo(0.15625, 12);
        // Equal edges: a step, never NaN.
        expect(smooth(2, 2, 1)).toBe(0);
        expect(smooth(2, 2, 2)).toBe(1);
        expect(smooth(2, 2, 3)).toBe(1);
        // Reversed edges fall instead of rise (as the shader's smoothstep does).
        expect(smooth(1, 0, 0)).toBe(1);
        expect(smooth(1, 0, 1)).toBe(0);
        expect(smooth(1, 0, 0.75)).toBeCloseTo(1 - smooth(0, 1, 0.75), 12);
        // Smootherstep is flat at both ends and symmetric.
        expect(smoother(0)).toBe(0);
        expect(smoother(1)).toBe(1);
        expect(smoother(0.5)).toBeCloseTo(0.5, 12);
        expect(smoother(-2)).toBe(0);
        expect(smoother(9)).toBe(1);
    });

    it('draws the same numbers from the same seed, and different ones from another', () => {
        const a = mulberry32(1234);
        const b = mulberry32(1234);
        const c = mulberry32(1235);
        const seqA = Array.from({ length: 64 }, a);
        const seqB = Array.from({ length: 64 }, b);
        const seqC = Array.from({ length: 64 }, c);
        expect(seqA).toEqual(seqB);
        expect(seqA).not.toEqual(seqC);
        seqA.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
        // Spread over the unit interval, not bunched.
        const mean = seqA.reduce((s, v) => s + v, 0) / seqA.length;
        expect(mean).toBeGreaterThan(0.3);
        expect(mean).toBeLessThan(0.7);
    });
});

describe('Rainbark core: the Climb, the tide and the sun', () => {
    it('climbs a storey a level, from the lowest storey on level one, and wraps after twelve', () => {
        expect(climbHeight(1)).toBe(CLIMB_BASE);
        for (let level = 2; level <= CLIMB_LEVELS; level++) {
            expect(climbHeight(level) - climbHeight(level - 1)).toBe(STOREY);
        }
        expect(climbHeight(12)).toBe(152);
        expect(climbHeight(13)).toBe(climbHeight(1));
        expect(climbHeight(25)).toBe(climbHeight(1));
        expect(levelCycle(13)).toBe(0);
        // Nonsense stands on level one.
        for (const odd of [0, -4, NaN, undefined, 'x']) expect(climbHeight(odd), String(odd)).toBe(CLIMB_BASE);
    });

    it('stands every level in one of the five zones, in order, with every storey covered once', () => {
        expect(ZONES.map((z) => z.name)).toEqual(['Buttress Deep', 'Bole', 'Fog Line', 'Limb Storey', 'Crown Light']);
        const cycles = ZONES.flatMap((z) => z.cycles).sort((a, b) => a - b);
        expect(cycles).toEqual(Array.from({ length: CLIMB_LEVELS }, (_, i) => i));
        expect([1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13].map(zoneIndex)).toEqual([0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 0]);
        // The sun only climbs, and never sinks to golden-hour heights.
        for (let i = 1; i < ZONES.length; i++) expect(ZONES[i].sunElevation).toBeGreaterThan(ZONES[i - 1].sunElevation);
        ZONES.forEach((zone) => {
            expect(zone.sunElevation).toBeGreaterThanOrEqual(50);
            ZONE_COLOR_KEYS.forEach((key) => expect(zone.colors[key], `${zone.name}.${key}`).toMatch(HEX));
            expect(zone.sigmaA).toBeGreaterThan(0);
            expect(zone.scaleHeight).toBeGreaterThan(0);
        });
        ZONE_COLOR_KEYS.forEach((key) => expect(MISTFALL.colors[key], `Mistfall.${key}`).toMatch(HEX));
        expect(MISTFALL.sat).toBeLessThan(1);
    });

    it('breathes the tide over its period: low at zero, high at half, about the zone\'s top', () => {
        ZONES.forEach((zone) => {
            expect(tideAt(0, zone)).toBeCloseTo(zone.tideTop - zone.tideAmp, 9);
            expect(tideAt(TIDE_PERIOD / 2, zone)).toBeCloseTo(zone.tideTop + zone.tideAmp, 9);
            expect(tideAt(TIDE_PERIOD, zone)).toBeCloseTo(tideAt(0, zone), 9);
            expect(tideAt(TIDE_PERIOD / 4, zone)).toBeCloseTo(zone.tideTop, 9);
        });
        expect(Number.isFinite(tideAt(NaN))).toBe(true);
    });

    it('points at the Bole sun (0.539, 0.819, −0.196), a unit vector, on the right and in front', () => {
        const sun = sunDirection(ZONES[1].sunElevation);
        expect(sun[0]).toBeCloseTo(0.539, 3);
        expect(sun[1]).toBeCloseTo(0.819, 3);
        expect(sun[2]).toBeCloseTo(-0.196, 3);
        ZONES.forEach((zone) => {
            const s = sunDirection(zone.sunElevation);
            expect(Math.hypot(s[0], s[1], s[2])).toBeCloseTo(1, 9);
            expect(s[0]).toBeGreaterThan(0);
            expect(s[2]).toBeLessThan(0);
        });
    });
});

describe('Rainbark core: the shared tables', () => {
    it('lays the event table out in its blocks, under its 112 rows', () => {
        let at = 0;
        Object.keys(EVENT_SLOTS).forEach((block) => {
            expect(EVENT_ROWS[block], block).toBe(at);
            at += EVENT_SLOTS[block] * EVENT_ROWS_PER[block];
        });
        expect(EVENT_ROWS.used).toBe(108);
        expect(EVENT_ROWS.total).toBe(112);
        expect(EVENT_SLOTS).toMatchObject({
            peels: 16, girdles: 12, helices: 6, knocks: 4, gaps: 7, moult: 1,
        });
    });

    it('lays the palette table out: zone colours, four group means, eight piece-age rows', () => {
        ZONE_COLOR_KEYS.forEach((key, i) => expect(PALETTE_ROWS[key]).toBe(i));
        expect(PALETTE_ROWS.groupMean).toBe(ZONE_COLOR_KEYS.length);
        expect(PALETTE_ROWS.pieceAge).toBe(PALETTE_ROWS.groupMean + 4);
        expect(PALETTE_ROWS.used).toBe(PALETTE_ROWS.pieceAge + PIECE_AGE.length);
        expect(PALETTE_ROWS.used).toBeLessThanOrEqual(PALETTE_ROWS.total);
    });
});
