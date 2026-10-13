/**
 * Rainbark — the three-free core: the bark palette and its gate, the piece codes, the Climb,
 * the tide, the sun and the shared tables. Relations, not tuning numbers: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    AGE_PHASE_STOPS,
    ATLAS_RIBBONS,
    BARK_ACCENT,
    BARK_ALBEDO,
    BARK_CHROMA,
    BARK_FRESH_DIM,
    CLIMB_BASE,
    GROUP_CYCLE,
    PATCH_LIFE,
    PATCH_WRAP_RATE,
    CLIMB_LEVELS,
    HERO_REF_Y,
    HERO_TRUNKS,
    MATRIX_AGE,
    EVENT_ROWS,
    EVENT_ROWS_PER,
    EVENT_SLOTS,
    MISTFALL,
    MIST_DRIFT,
    MIST_GRAIN,
    MIST_SHEETS,
    MIST_WISPS,
    PALETTE_ROWS,
    PIECE_AGE,
    PIECE_CODE,
    RAMP_STOPS,
    SHAPES,
    SHAPE_KEYS,
    STOREY,
    TIDE_LIGHT,
    TIDE_PERIOD,
    TIDE_PHASES,
    ZONES,
    ZONE_COLOR_KEYS,
    ageOfPhase,
    barkAlbedo,
    barkChroma,
    buildMips,
    freshDim,
    cellsFromMatrix,
    climbHeight,
    hexToLinear,
    laneX,
    levelCycle,
    mistDrift,
    mistGrainAt,
    billowContrast,
    mistOnset,
    mistSheetHeight,
    mulberry32,
    groupMean,
    pieceCode,
    rampAt,
    smooth,
    smoother,
    sunDirection,
    tideAt,
    tideClock,
    trunkBowAzimuth,
    trunkRecord,
    warpAge,
    wispHeight,
    wrapsPerSecond,
    zoneIndex,
} from '../../src/themes/rainbark/rainbark-core.js';
import { RAINBARK_TETROMINOS } from '../../src/themes/rainbark/rainbark-tetrominos.js';
import { MIST_BILLOWS, MIST_INTERIOR } from '../../src/themes/rainbark/rainbark-tsl.js';
import { QUALITY } from '../../src/themes/rainbark/rainbark-quality.js';

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

    it('runs the tide clock: its top is tideAt, its phases come round in order, its light follows the water', () => {
        const out = tideClock(0);
        ZONES.forEach((zone) => {
            for (let t = -40; t <= 2 * TIDE_PERIOD; t += 7.3) {
                expect(tideClock(t, zone, out).tide).toBeCloseTo(tideAt(t, zone), 9);
                expect(out.high).toBeGreaterThanOrEqual(0);
                expect(out.high).toBeLessThanOrEqual(1);
            }
        });
        // Clearing at low water, immersion at high, rising and draining between (a quarter each).
        expect(tideClock(0).name).toBe('clearing');
        expect(tideClock(TIDE_PERIOD / 4).name).toBe('rising');
        expect(tideClock(TIDE_PERIOD / 2).name).toBe('immersion');
        expect(tideClock((3 * TIDE_PERIOD) / 4).name).toBe('draining');
        expect(TIDE_PHASES).toEqual(['clearing', 'rising', 'immersion', 'draining']);
        const seen = [];
        for (let t = 0; t < TIDE_PERIOD; t += 1) {
            const { phase } = tideClock(t);
            if (seen[seen.length - 1] !== phase) seen.push(phase);
        }
        expect(seen).toEqual([0, 1, 2, 3, 0]);
        // The water rises while it is rising and falls while it drains.
        expect(tideClock(TIDE_PERIOD / 4).rate).toBeGreaterThan(0);
        expect(tideClock((3 * TIDE_PERIOD) / 4).rate).toBeLessThan(0);
        const dt = 1e-3;
        [12, 50, 101, 140].forEach((t) => {
            const slope = (tideAt(t + dt) - tideAt(t - dt)) / (2 * dt);
            expect(tideClock(t).rate).toBeCloseTo(slope, 4);
        });
        // Clearing: more fleck light, the least sheen, clear air; immersion: the reverse.
        const low = tideClock(0);
        const high = tideClock(TIDE_PERIOD / 2);
        expect(low.fleckGain).toBeCloseTo(TIDE_LIGHT.fleckGain[0], 9);
        expect(high.fleckGain).toBeCloseTo(TIDE_LIGHT.fleckGain[1], 9);
        expect(low.fleckGain).toBeGreaterThan(high.fleckGain);
        expect(low.sheen).toBeLessThan(high.sheen);
        expect(low.air).toBeLessThan(high.air);
        expect(low.air).toBeCloseTo(1, 9);
        // Smooth: no step at a phase's edge.
        for (let t = 0; t < TIDE_PERIOD; t += 0.5) {
            const { air, sheen } = tideClock(t);
            const b = tideClock(t + 0.5);
            expect(Math.abs(b.air - air)).toBeLessThan(0.01);
            expect(Math.abs(b.sheen - sheen)).toBeLessThan(0.01);
        }
        // The vapour begins higher over a risen tide; the rise is the rate's shape, −1 … 1.
        expect(low.onset).toBeCloseTo(TIDE_LIGHT.onset[0], 9);
        expect(high.onset).toBeCloseTo(TIDE_LIGHT.onset[1], 9);
        expect(tideClock(TIDE_PERIOD / 4).rise).toBeCloseTo(1, 9);
        expect(tideClock((3 * TIDE_PERIOD) / 4).rise).toBeCloseTo(-1, 9);
        expect(TIDE_LIGHT.sheets[0]).toBeLessThan(TIDE_LIGHT.sheets[1]);
        // Allocation-free with `out`, and finite for a bad clock.
        expect(tideClock(33, ZONES[1], out)).toBe(out);
        expect(Number.isFinite(tideClock(NaN).tide)).toBe(true);
    });

    it('keeps the vapour\'s onset clear of the eye, never under the low-water onset', () => {
        const [lo, hi] = TIDE_LIGHT.onset;
        // Far over the tide the clock's onset stands.
        expect(mistOnset(hi, 30, 56)).toBeCloseTo(hi, 9);
        expect(mistOnset(lo, 30, 56)).toBeCloseTo(lo, 9);
        // Near the eye it stops short of it by onsetEye…
        const camY = 20;
        const tide = 15;
        expect(mistOnset(hi, tide, camY)).toBeCloseTo(camY - tide - TIDE_LIGHT.onsetEye, 9);
        expect(tide + mistOnset(hi, tide, camY)).toBeLessThanOrEqual(camY - TIDE_LIGHT.onsetEye + 1e-9);
        // …and with the eye in the mist it is the low-water onset.
        expect(mistOnset(hi, camY + 15, camY)).toBeCloseTo(lo, 9);
        // Continuous in the tide.
        for (let y = 0; y < 40; y += 0.25) {
            expect(Math.abs(mistOnset(hi, y + 0.25, camY) - mistOnset(hi, y, camY))).toBeLessThanOrEqual(0.25 + 1e-9);
        }
    });

    it('drifts the mist and wraps the drift where every noise it moves repeats exactly', () => {
        const at = mistDrift(10);
        expect(Math.hypot(at[0], at[1])).toBeCloseTo(MIST_DRIFT.speed * 10, 6);
        expect(Math.hypot(...MIST_DRIFT.heading)).toBeCloseTo(1, 9);
        // Every rate the drift is read at (the billows' two octaves at every zone's grain, the
        // vapour's density seen from inside the mist, each sheet's sheared rate up to the most
        // sheets a tier draws) times the wrap is a whole number of lattice periods (256 cells), and
        // x and z wrap each on their own, so a wrapped component lands on the same cell.
        const sheets = Math.max(...Object.values(QUALITY).map((tier) => tier.mistSheets));
        const rates = [1 / MIST_INTERIOR.grain];
        for (let grain = 1; grain <= MIST_GRAIN.most; grain++) {
            rates.push(MIST_BILLOWS.scale * grain, MIST_BILLOWS.scale * MIST_BILLOWS.second * grain);
        }
        for (let i = 0; i < sheets; i++) rates.push(MIST_SHEETS.scale * (1 + MIST_SHEETS.shear * i));
        rates.forEach((rate) => {
            const periods = (MIST_DRIFT.wrap * rate) / 256;
            expect(Math.abs(periods - Math.round(periods)), `rate ${rate}`).toBeLessThan(1e-6);
        });
        const wrapT = (axis) => MIST_DRIFT.wrap / (MIST_DRIFT.speed * Math.abs(MIST_DRIFT.heading[axis]));
        [0, 1].forEach((axis) => {
            const before = mistDrift(wrapT(axis) - 1)[axis];
            const after = mistDrift(wrapT(axis) + 1)[axis];
            expect(Math.abs(after)).toBeLessThan(Math.abs(before));
            rates.forEach((rate) => {
                // Across the wrap the noise reads the same place (to a float's rounding).
                const step = MIST_DRIFT.speed * MIST_DRIFT.heading[axis] * 2;
                const cells = ((before + step) - after) * rate;
                expect(Math.abs(cells / 256 - Math.round(cells / 256))).toBeLessThan(1e-6);
            });
        });
        // The boil stays on the lattice's 256 cells and is read only at whole multiples of itself.
        expect(mistDrift(1e7)[2]).toBeLessThan(256);
        [...MIST_BILLOWS.boil, MIST_SHEETS.boil].forEach((k) => expect(Number.isInteger(k)).toBe(true));
        mistDrift(-5).forEach((v) => expect(v).toBeCloseTo(0, 12));
        const out = [0, 0, 0];
        expect(mistDrift(3, out)).toBe(out);
    });

    it('stacks the mist sheets from just under the tide upward, three metres apart', () => {
        const tide = 30;
        expect(mistSheetHeight(0, tide)).toBeLessThan(tide);
        for (let i = 1; i < 6; i++) {
            expect(mistSheetHeight(i, tide) - mistSheetHeight(i - 1, tide)).toBeCloseTo(MIST_SHEETS.step, 9);
        }
        expect(mistSheetHeight(0, tide)).toBeCloseTo(tide + MIST_SHEETS.base, 9);
        // A sheet edge-on fades out before it is a line; the fades have room to be smooth.
        expect(MIST_SHEETS.grazing[0]).toBeGreaterThan(0);
        expect(MIST_SHEETS.grazing[1]).toBeGreaterThan(MIST_SHEETS.grazing[0]);
        expect(MIST_SHEETS.eye[1]).toBeGreaterThan(MIST_SHEETS.eye[0]);
        expect(MIST_SHEETS.above).toBeLessThan(1);
    });

    it('puts the wisps in the lanes either side of the card, never within the keep-out of it', () => {
        const keep = MIST_WISPS.keepOut;
        const bands = [[0.407, 0.593], [0.43, 0.57], [0.164, 0.836], [0.05, 0.4], [0.6, 0.97]];
        bands.forEach(([x0, x1]) => {
            let left = 0;
            let right = 0;
            for (let q = 0; q < 1; q += 0.01) {
                const x = laneX(q, x0, x1, keep);
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(1);
                expect(x < x0 - keep + 1e-9 || x > x1 + keep - 1e-9).toBe(true);
                if (x < x0) left += 1;
                else right += 1;
            }
            // Spread over both lanes by their widths.
            const share = Math.max(0, x0 - keep) / (Math.max(0, x0 - keep) + Math.max(0, 1 - x1 - keep));
            expect(left / (left + right)).toBeCloseTo(share, 1);
        });
        // Monotonic in q, and NaN when neither lane has room (that wisp collapses).
        let last = -1;
        for (let q = 0; q < 1; q += 0.05) {
            const x = laneX(q, 0.3, 0.7);
            expect(x).toBeGreaterThan(last);
            last = x;
        }
        expect(laneX(0.5, 0.01, 0.99)).toBeNaN();
        // Their lives are the spec's (§4.6), at most a quarter opaque.
        expect(MIST_WISPS.life).toEqual([8, 14]);
        expect(MIST_WISPS.alpha).toBeLessThanOrEqual(0.25);
        MIST_WISPS.gaps.forEach(([lo, hi]) => expect(hi).toBeGreaterThan(lo));
        // A gap's odds for each gap, summing to one, the middle gaps likelier than the nearest and
        // the farthest (a thread's upper part stands in front of the blue air there).
        expect(MIST_WISPS.odds).toHaveLength(MIST_WISPS.gaps.length);
        expect(MIST_WISPS.odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        expect(MIST_WISPS.odds[1] + MIST_WISPS.odds[2]).toBeGreaterThan(MIST_WISPS.odds[0] + MIST_WISPS.odds[3]);
        // The tide raises the share of lives that show while it rises, never above all of them.
        expect(MIST_WISPS.rising.share[0]).toBeLessThan(MIST_WISPS.rising.share[1]);
        expect(MIST_WISPS.rising.share[1]).toBeLessThanOrEqual(1);
        expect(MIST_WISPS.keepSoft).toBeGreaterThan(0);
    });

    it('grains the billows finer from a storey just over the mist, in whole numbers', () => {
        for (let level = 1; level <= 12; level++) {
            const zone = ZONES[zoneIndex(level)];
            const grain = mistGrainAt(climbHeight(level), zone);
            expect(Number.isInteger(grain), `L${level}`).toBe(true);
            expect(grain).toBeGreaterThanOrEqual(1);
            expect(grain).toBeLessThanOrEqual(MIST_GRAIN.most);
        }
        // The Bole's reference storey keeps the plain billows; its first, and Buttress Deep's
        // first (a few metres over the mist), finer; never finer the higher the eye.
        expect(mistGrainAt(climbHeight(4), ZONES[1])).toBe(1);
        expect(mistGrainAt(climbHeight(3), ZONES[1])).toBeGreaterThan(1);
        expect(mistGrainAt(climbHeight(1), ZONES[0])).toBe(MIST_GRAIN.most);
        for (let y = 20; y < 200; y += 1) {
            expect(mistGrainAt(y + 1, ZONES[1])).toBeLessThanOrEqual(mistGrainAt(y, ZONES[1]));
        }
    });

    it('dips the billows\' contrast to 0 where a Climb swaps their grain, and only there', () => {
        expect(billowContrast(0.5, 1, 2)).toBe(0);
        expect(billowContrast(0.5, 2, 2)).toBe(1);
        for (let k = 0; k <= 1.0001; k += 0.05) expect(billowContrast(k, 3, 3)).toBe(1);
        expect(billowContrast(0.5 - MIST_GRAIN.dip, 1, 3)).toBe(1);
        expect(billowContrast(0.5 + MIST_GRAIN.dip, 3, 1)).toBe(1);
        // Falling smoothly toward the midpoint from either side, and symmetric.
        for (let k = 0.4; k < 0.5; k += 0.01) {
            expect(billowContrast(k + 0.005, 1, 2)).toBeLessThanOrEqual(billowContrast(k, 1, 2));
            expect(billowContrast(1 - k, 1, 2)).toBeCloseTo(billowContrast(k, 1, 2), 6);
        }
    });

    it('sizes the wisps to the gap between the mist and the eye, never reaching the eye', () => {
        const H = MIST_WISPS.height;
        const foot = (tide) => tide - MIST_WISPS.sink;
        // Every storey of the Climb, at low and high water: at most `most` metres, at least the
        // least (where there is room), and the top never within H.eye of the eye.
        for (let level = 1; level <= 12; level++) {
            const camY = climbHeight(level);
            const zone = ZONES[zoneIndex(level)];
            [0, TIDE_PERIOD / 4, TIDE_PERIOD / 2].forEach((t) => {
                const tide = tideAt(t, zone);
                [0, 0.5, 1].forEach((h) => {
                    const height = wispHeight(camY, tide, h);
                    expect(height).toBeGreaterThanOrEqual(0);
                    expect(height).toBeLessThanOrEqual(H.most + 1e-9);
                    // (None at all with the eye inside the mist.)
                    if (height > 0) expect(foot(tide) + height).toBeLessThanOrEqual(camY - H.eye + 1e-9);
                    else expect(foot(tide)).toBeGreaterThan(camY - H.eye - H.least);
                    // Never taller than the gap between the mist and the eye, plus the sunk foot.
                    expect(height).toBeLessThanOrEqual(Math.max(0, camY - tide) + MIST_WISPS.sink + 1e-9);
                });
            });
        }
        // Scaled to the gap: the Bole's reference storey stands them ~20 m tall, Buttress Deep's
        // first storey (the eye a few metres over the mist) only a few metres.
        const bole = wispHeight(climbHeight(4), tideAt(55, ZONES[1]), 1);
        const deep = wispHeight(climbHeight(1), tideAt(55, ZONES[0]), 1);
        expect(bole).toBeGreaterThan(15);
        expect(bole).toBeLessThan(30);
        expect(deep).toBeLessThan(10);
        expect(deep).toBeLessThan(bole);
        // The life's hash spreads them, the rising tide grows them, a foot risen to the eye has none.
        expect(wispHeight(56, 30, 0)).toBeLessThan(wispHeight(56, 30, 1));
        expect(wispHeight(56, 30, 0.5, 1.2)).toBeGreaterThan(wispHeight(56, 30, 0.5, 1));
        expect(wispHeight(56, 30, 1, 1, 56)).toBe(0);
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

    it('lays the palette table out: zone colours, four group means, eight piece-age rows, the ribbons\' places', () => {
        ZONE_COLOR_KEYS.forEach((key, i) => expect(PALETTE_ROWS[key]).toBe(i));
        expect(PALETTE_ROWS.groupMean).toBe(ZONE_COLOR_KEYS.length);
        expect(PALETTE_ROWS.pieceAge).toBe(PALETTE_ROWS.groupMean + 4);
        expect(PALETTE_ROWS.phases).toBe(PALETTE_ROWS.pieceAge + PIECE_AGE.length);
        expect(PALETTE_ROWS.used).toBe(PALETTE_ROWS.phases + Math.ceil(ATLAS_RIBBONS / 4));
        expect(PALETTE_ROWS.used).toBeLessThanOrEqual(PALETTE_ROWS.total);
    });
});

describe('Rainbark core: the bark\'s ages', () => {
    it('maps a life phase onto the ramp through its stops, monotonic, stopping short of the matrix', () => {
        AGE_PHASE_STOPS.forEach(([w, age]) => expect(ageOfPhase(w)).toBeCloseTo(age, 9));
        let last = -1;
        for (let i = 0; i <= 200; i++) {
            const age = ageOfPhase(i / 200);
            expect(age).toBeGreaterThanOrEqual(last);
            last = age;
        }
        expect(ageOfPhase(-1)).toBe(0);
        expect(ageOfPhase(2)).toBeCloseTo(AGE_PHASE_STOPS[AGE_PHASE_STOPS.length - 1][1], 9);
        expect(ageOfPhase(1)).toBeLessThan(MATRIX_AGE);
        expect(Number.isFinite(ageOfPhase(NaN))).toBe(true);
    });

    it('lands the grove at rest mostly fresh and ember-to-rust, with ruby and the blue and violet phases rare', () => {
        // Uniform phases warped by the resting bias: the share of ages in each band.
        const edges = [0.14, 0.6, 0.7, 0.75, 0.86];
        const bands = new Array(edges.length + 1).fill(0);
        const n = 20000;
        for (let i = 0; i < n; i++) {
            const age = ageOfPhase(warpAge((i + 0.5) / n, 0.4));
            let b = 0;
            while (b < edges.length && age >= edges[b]) b += 1;
            bands[b] += 1;
        }
        const [fresh, mid, ruby, turning, ember, old] = bands.map((b) => b / n);
        expect(fresh).toBeCloseTo(0.26, 1);
        expect(mid).toBeCloseTo(0.1, 1);
        // Ruby (and the turn to ember) is a rare accent; ember and rust hold a third and more.
        expect(ruby + turning).toBeLessThanOrEqual(0.05);
        expect(ember).toBeGreaterThanOrEqual(0.3);
        expect(old).toBeCloseTo(0.2, 1);
        expect(mid).toBeLessThan(fresh);
        expect(fresh + ember).toBeGreaterThan(0.6);
    });

    it('warps a cyclic age by the grove\'s bias: monotonic, the identity at 0, older for b > 0', () => {
        for (const b of [-0.6, -0.2, 0, 0.3, 0.8, 1.2]) {
            let last = -1;
            for (let i = 0; i <= 100; i++) {
                const a = warpAge(i / 100, b);
                expect(a).toBeGreaterThanOrEqual(last);
                last = a;
            }
            expect(warpAge(0, b)).toBeCloseTo(0, 9);
            expect(warpAge(1, b)).toBeCloseTo(1, 9);
        }
        expect(warpAge(0.37, 0)).toBeCloseTo(0.37, 9);
        expect(warpAge(0.5, 0.6)).toBeGreaterThan(0.5);
        expect(warpAge(0.5, -0.6)).toBeLessThan(0.5);
    });

    it('wears the ramp at the ambient chroma and the dry albedo, keeping its luma', () => {
        const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const spread = (c) => Math.max(...c) - Math.min(...c);
        for (const age of [0, 0.26, 0.38, 0.66, 0.8, 0.95]) {
            const ramp = rampAt(age);
            const bark = barkAlbedo(age);
            const k = BARK_ALBEDO * freshDim(age);
            expect(luma(bark)).toBeCloseTo(luma(ramp) * k, 9);
            // Less saturated than the ramp (the gameplay bands wear the full colour).
            expect(spread(bark)).toBeLessThanOrEqual(spread(ramp) * k * barkChroma(age) + 1e-9);
        }
        // Fresh bark is dimmed (First Skin is a highlighter at the ambient chroma), ember is not.
        expect(freshDim(0)).toBeCloseTo(BARK_FRESH_DIM.k, 9);
        expect(freshDim(0.8)).toBe(1);
        // The rare middle (teal, cobalt, violet, ruby) is muted further and a little darker; ember
        // and rust keep the ambient chroma; fresh bark keeps more of the ramp's (a deep satin lime,
        // never mint), dimmed in value only.
        expect(barkChroma(0.38)).toBeCloseTo(BARK_CHROMA - BARK_ACCENT.mute, 9);
        expect(freshDim(0.5)).toBeCloseTo(BARK_ACCENT.dim, 9);
        for (const age of [0.79, 0.84, 0.95]) expect(barkChroma(age)).toBe(BARK_CHROMA);
        expect(barkChroma(0)).toBeCloseTo(BARK_FRESH_DIM.chroma, 9);
        expect(BARK_FRESH_DIM.chroma).toBeGreaterThan(BARK_CHROMA);
    });

    it('keeps the ambient ember and rust in the photographs\' warm red, never coral or pink', () => {
        // CIE LCh hue of the ambient bark through the ember-to-rust band (the reds the grove
        // shows most): from ember's orange down to rust, never toward ruby's pink.
        const hue = (c) => {
            const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
            const X = (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047;
            const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            const Z = (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883;
            return (Math.atan2(200 * (f(Y) - f(Z)), 500 * (f(X) - f(Y))) * 180) / Math.PI;
        };
        for (let age = 0.77; age <= 0.855; age += 0.01) {
            const h = hue(barkAlbedo(age));
            expect(h, `age ${age.toFixed(2)}`).toBeGreaterThan(35);
            expect(h, `age ${age.toFixed(2)}`).toBeLessThan(58);
        }
    });

    it('averages a group\'s bark: finite, inside the ramp\'s range, older as the bias grows', () => {
        const young = groupMean(-0.6, 0.38);
        const rest = groupMean(0.4, 0.38);
        const old = groupMean(1.2, 0.38);
        for (const m of [young, rest, old]) {
            expect(m).toHaveLength(4);
            m.forEach((v) => expect(Number.isFinite(v)).toBe(true));
            for (let c = 0; c < 3; c++) {
                expect(m[c]).toBeGreaterThan(0);
                expect(m[c]).toBeLessThan(1);
            }
        }
        expect(young[3]).toBeLessThan(rest[3]);
        expect(rest[3]).toBeLessThan(old[3]);
        // More matrix, older mean.
        expect(groupMean(0.4, 0.6)[3]).toBeGreaterThan(rest[3]);
        // The same answer twice (the world recomputes it only when the bias moves).
        expect(groupMean(0.4, 0.38)).toEqual(rest);
        // Pale islands in the matrix lighten it.
        const islands = groupMean(0.4, 0.38, [0, 0, 0, 0], 0.05);
        for (let c = 0; c < 3; c++) expect(islands[c]).toBeGreaterThan(rest[c]);
    });

    it('wraps a patch round its cycle at a rate set by its group\'s life scale and cycling share', () => {
        // E[1 / life] of a life uniform on [min, min + span].
        let mean = 0;
        const n = 10000;
        for (let i = 0; i < n; i++) mean += 1 / (PATCH_LIFE.min + (PATCH_LIFE.span * (i + 0.5)) / n);
        expect(PATCH_WRAP_RATE).toBeCloseTo(mean / n, 6);
        // One patch per square metre in the Elder's group: every patch cycles, at scale 1.
        expect(wrapsPerSecond([{ group: 0, area: 1 }], 1)).toBeCloseTo(PATCH_WRAP_RATE, 9);
        // The other groups wrap more rarely (fewer of their patches cycle, and more slowly).
        for (let g = 1; g < 4; g++) {
            const rate = wrapsPerSecond([{ group: g, area: 1 }], 1);
            expect(rate).toBeCloseTo((PATCH_WRAP_RATE * GROUP_CYCLE.share[g]) / GROUP_CYCLE.lifeScale[g], 9);
            expect(rate).toBeLessThan(PATCH_WRAP_RATE);
        }
        expect(wrapsPerSecond([], 1)).toBe(0);
    });
});

describe('Rainbark core: the trunks the composition names', () => {
    it('gives each near trunk its own code, and every trunk a group, a height and a radius', () => {
        const near = HERO_TRUNKS.filter((t) => t.code > 0).map((t) => t.code);
        expect(new Set(near).size).toBe(near.length);
        expect(Math.max(...near)).toBeLessThanOrEqual(8);
        expect(HERO_TRUNKS.find((t) => t.name === 'Elder')).toMatchObject({ code: 1, group: 0 });
        HERO_TRUNKS.forEach((t) => {
            expect(t.group).toBeGreaterThanOrEqual(0);
            expect(t.group).toBeLessThanOrEqual(3);
            expect(t.top).toBeGreaterThan(HERO_REF_Y);
            expect(t.radius).toBeGreaterThan(0);
            expect(t.taper).toBeGreaterThan(0);
            expect(t.taper).toBeLessThan(1);
        });
    });

    it('packs a record whose leaning, bowing spine passes through the table\'s axis at the reference height', () => {
        HERO_TRUNKS.forEach((trunk, i) => {
            const seed = 37 + i * 101;
            const r = trunkRecord(trunk, seed);
            expect(r).toHaveLength(16);
            const span = r[5] - r[4];
            const yy = HERO_REF_Y - r[4];
            const az = trunkBowAzimuth(seed);
            const x = r[0] + r[8] * yy + (Math.cos(az) * r[10] * yy * yy) / span;
            const z = r[1] + r[9] * yy + (Math.sin(az) * r[10] * yy * yy) / span;
            // (A record is single precision.)
            expect(x).toBeCloseTo(trunk.x, 4);
            expect(z).toBeCloseTo(trunk.z, 4);
            // R(y) = R0·(1 − taper·(y − y0)/span) is the table's radius there, wider at the floor.
            expect(r[2] * (1 - (r[3] * yy) / span)).toBeCloseTo(trunk.radius, 4);
            expect(r[2]).toBeGreaterThan(trunk.radius);
            // The lean's slope is the table's angle.
            expect(Math.hypot(r[8], r[9])).toBeCloseTo(Math.tan((trunk.lean * Math.PI) / 180), 6);
            const codes = [trunk.code, trunk.group, seed, trunk.fins * 16 + trunk.flutes];
            expect(Array.from(r.slice(12))).toEqual(codes);
            expect(az).toBeGreaterThanOrEqual(0);
            expect(az).toBeLessThan(Math.PI * 2);
        });
        // Written in place at an offset, leaving the rest alone.
        const out = new Float32Array(40).fill(-1);
        trunkRecord(HERO_TRUNKS[0], 5, out, 16);
        expect(out[15]).toBe(-1);
        expect(out[32]).toBe(-1);
        expect(out[16 + 14]).toBe(5);
    });

    it('box-filters a mip chain down to one texel', () => {
        const data = new Uint8Array(4 * 4 * 4);
        for (let i = 0; i < 16; i++) data[i * 4] = i * 16;
        const mips = buildMips(data, 4, 4);
        expect(mips.map((m) => m.width)).toEqual([4, 2, 1]);
        expect(mips[0].data).toBe(data);
        // The last level is the mean of every texel (rounded).
        expect(mips[2].data[0]).toBe(Math.round(data.reduce((s, v, i) => (i % 4 ? s : s + v), 0) / 16));
    });
});
