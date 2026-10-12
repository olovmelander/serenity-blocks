/**
 * Thermal Bloom — the three-free core: the piece palette and its gate (and its separation under
 * colour-vision deficiency), the piece codes, the temperature ramp and its seasons, the breath,
 * the gusts, the Chalice's idle clock, the eruption envelopes, the blooms under slot pressure,
 * the combo's gauges, the sun solver and the shared tables. Relations, not tuning numbers:
 * constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    BOW,
    COLORS,
    FAR_PLUME_REACH,
    FUMAROLES,
    FUMAROLE_PERIOD,
    JEWEL_KIND,
    PINE_STANDS,
    PLUME_KIND,
    STEAM_SLOTS,
    composeWorld,
    fumarolePlan,
    jewelPlan,
    pinePlan,
    projectToScreen,
    plumePlan,
    ERUPTIONS,
    EVENT_ROWS,
    EVENT_ROWS_PER,
    EVENT_SLOTS,
    GUST_CROSS,
    IDLE_PERIOD,
    PIECE_CODE,
    PIECE_HEX,
    RAMP_WIDTH,
    REACH_NOTCHES,
    SEASONS,
    SHAPES,
    SHAPE_KEYS,
    SUN_RANGES,
    T_BANDS,
    antisolarAngle,
    bleachAt,
    bloomLife,
    breathAt,
    cellsFromMatrix,
    chaliceSchedule,
    columnHeight,
    eruptionLength,
    eyeHeat,
    fingerReach,
    gustAt,
    hash1,
    hexToLinear,
    mulberry32,
    pieceCode,
    preplayHeight,
    rampAt,
    seasonForLevel,
    smooth,
    smoother,
    solveSun,
    steamForBreath,
    steamPhaseLength,
    sunVector,
    windAt,
} from '../../src/themes/thermal-bloom/thermal-bloom-core.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';
import { THERMAL_BLOOM_TETROMINOS } from '../../src/themes/thermal-bloom/thermal-bloom-tetrominos.js';

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

function hexToRgb(hex) {
    const n = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
}

function hexToHue(hex) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

const inBands = (hue, bands) => hue !== null && bands.some(([lo, hi]) => hue >= lo && hue <= hi);
const HEX = /^#[0-9a-f]{6}$/i;

// CIELAB ΔE76 under Machado 2009 full-severity simulation, applied in linear RGB (PLAYBOOK §2.8).
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};
function lab(rgbS) {
    const [r, g, b] = rgbS.map(lin);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const CVD = {
    none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (rgbS, m) => {
    const l = rgbS.map(lin);
    return m.map((row) => gam(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
};

describe('Thermal Bloom core: the piece palette', () => {
    it('passes the palette gate at 0/7: no piece wears the hue its shape is known by', () => {
        const hue = (key) => hexToHue(THERMAL_BLOOM_TETROMINOS.colors[key]);
        expect(SHAPE_KEYS.filter((key) => inBands(hue(key), GUIDELINE_BANDS[key]))).toEqual([]);
        expect(THERMAL_BLOOM_TETROMINOS.version).toBe(2);
        expect(THERMAL_BLOOM_TETROMINOS.renderMode).toBe('solid');
        expect(Object.keys(THERMAL_BLOOM_TETROMINOS.colors))
            .toEqual(expect.arrayContaining([...SHAPE_KEYS, 'GARBAGE', 'CLEAN_GARBAGE']));
        Object.values(THERMAL_BLOOM_TETROMINOS.colors).forEach((hex) => expect(hex).toMatch(HEX));
    });

    it('keeps the seven pieces apart under every colour-vision simulation (worst pair ΔE ≥ 17)', () => {
        for (const [mode, matrix] of Object.entries(CVD)) {
            const labs = SHAPE_KEYS.map((key) => lab(simulate(hexToRgb(THERMAL_BLOOM_TETROMINOS.colors[key]), matrix)));
            let worst = Infinity;
            for (let i = 0; i < labs.length; i++) {
                for (let j = i + 1; j < labs.length; j++) {
                    worst = Math.min(worst, Math.hypot(...labs[i].map((v, k) => v - labs[j][k])));
                }
            }
            expect(worst, mode).toBeGreaterThanOrEqual(17);
        }
    });

    it('blooms each lock in the piece’s own colour: PIECE_HEX is the board palette by code', () => {
        for (const key of SHAPE_KEYS) {
            expect(PIECE_HEX[PIECE_CODE[key]], key).toBe(THERMAL_BLOOM_TETROMINOS.colors[key]);
        }
        expect(PIECE_HEX[PIECE_CODE.GARBAGE]).toBe(THERMAL_BLOOM_TETROMINOS.colors.GARBAGE);
        expect(PIECE_HEX[PIECE_CODE.GARBAGE]).toBe(COLORS.bleachedSinter);
    });

    it('scours every piece onto cream it stands clear of (ΔE ≥ 45 from Sinter Cream)', () => {
        const cream = lab(hexToRgb(COLORS.sinterCream));
        for (const key of SHAPE_KEYS) {
            const c = lab(hexToRgb(THERMAL_BLOOM_TETROMINOS.colors[key]));
            expect(Math.hypot(...c.map((v, k) => v - cream[k])), key).toBeGreaterThanOrEqual(45);
        }
    });

    it('codes the shapes the shadow well uses, tolerant of case and junk', () => {
        expect(pieceCode('t')).toBe(PIECE_CODE.T);
        expect(pieceCode(' L ')).toBe(PIECE_CODE.L);
        expect(pieceCode('Q')).toBe(PIECE_CODE.GARBAGE);
        expect(pieceCode(null)).toBe(PIECE_CODE.GARBAGE);
        expect(new Set(Object.values(PIECE_CODE)).size).toBe(8);
    });

    it('turns a matrix into four centred cell offsets, and rejects junk', () => {
        const cells = cellsFromMatrix(SHAPES.T);
        expect(cells).toHaveLength(8);
        const sx = cells.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
        expect(Math.abs(sx)).toBeLessThan(1e-9);
        expect(cellsFromMatrix([[0, 0], [0, 0]])).toBeNull();
        expect(cellsFromMatrix('x')).toBeNull();
    });
});

describe('Thermal Bloom core: the temperature ramp and the seasons', () => {
    it('has six seasons, each a ramp rising from dry sinter to the vent with strictly increasing stops', () => {
        expect(SEASONS).toHaveLength(6);
        for (const season of SEASONS) {
            const ts = season.ramp.map(([t]) => t);
            expect(ts[0], season.name).toBe(0);
            expect(ts[ts.length - 1], season.name).toBe(1);
            for (let i = 1; i < ts.length; i++) expect(ts[i], season.name).toBeGreaterThan(ts[i - 1]);
            season.ramp.forEach(([, hex]) => expect(hex).toMatch(HEX));
            expect(season.steam).toBeGreaterThan(0);
        }
        expect(RAMP_WIDTH).toBeGreaterThanOrEqual(128);
    });

    it('keeps the cobalt, turquoise and cream core in every season (only the living bands change)', () => {
        const at = (s, t) => rampAt(s, t, [0, 0, 0]);
        const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.02);
        for (let s = 0; s < SEASONS.length; s++) {
            expect(close(at(s, 1), hexToLinear(COLORS.irisCobalt)), SEASONS[s].name).toBe(true);
            expect(close(at(s, 0.9), hexToLinear(COLORS.ventTurquoise)), SEASONS[s].name).toBe(true);
            expect(close(at(s, 0.83), hexToLinear(COLORS.sinterCream)), SEASONS[s].name).toBe(true);
        }
        // …and the mats do change from season to season.
        const orange = SEASONS.map((_, s) => at(s, (T_BANDS.orange + T_BANDS.lemon) / 2));
        expect(new Set(orange.map((c) => c.map((v) => v.toFixed(2)).join())).size).toBeGreaterThanOrEqual(4);
    });

    it('orders the bands hot to cold as the concept does', () => {
        expect(T_BANDS.eye).toBeGreaterThan(T_BANDS.water);
        expect(T_BANDS.water).toBeGreaterThan(T_BANDS.cream);
        expect(T_BANDS.cream).toBeGreaterThan(T_BANDS.lemon);
        expect(T_BANDS.lemon).toBeGreaterThan(T_BANDS.orange);
        expect(T_BANDS.orange).toBeGreaterThan(T_BANDS.rust);
        expect(T_BANDS.rust).toBeGreaterThan(T_BANDS.olive);
        // The lemon band is thin, the orange the widest.
        expect(T_BANDS.cream - T_BANDS.lemon).toBeLessThan(T_BANDS.lemon - T_BANDS.orange);
    });

    it('turns the year one step a level and wraps after six', () => {
        expect([1, 2, 3, 4, 5, 6, 7, 13].map(seasonForLevel)).toEqual([0, 1, 2, 3, 4, 5, 0, 0]);
        expect(seasonForLevel(undefined)).toBe(0);
        expect(seasonForLevel(-3)).toBe(0);
    });
});

describe('Thermal Bloom core: weather and the ambient clocks (closed form, seek-safe)', () => {
    it('breathes inside 0..1 and scales the steam from ×0.7 to ×1.35', () => {
        let lo = 1;
        let hi = 0;
        for (let t = 0; t < 1500; t += 0.7) {
            const b = breathAt(t);
            lo = Math.min(lo, b);
            hi = Math.max(hi, b);
        }
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(1);
        expect(hi - lo).toBeGreaterThan(0.6);
        expect(steamForBreath(0)).toBeCloseTo(0.7);
        expect(steamForBreath(1)).toBeCloseTo(1.35);
        expect(breathAt(NaN)).toBe(breathAt(0));
    });

    it('swings the wind ±20° at 1.5–4 m/s', () => {
        for (let t = 0; t < 1500; t += 1.3) {
            const w = windAt(t);
            expect(Math.abs(w.angle)).toBeLessThanOrEqual((20 * Math.PI) / 180 + 1e-9);
            expect(w.speed).toBeGreaterThanOrEqual(1.5 - 1e-9);
            expect(w.speed).toBeLessThanOrEqual(4 + 1e-9);
        }
    });

    it('tears a gust through the steam every 20–40 s, each crossing in GUST_CROSS seconds', () => {
        const starts = [];
        let prev = -1;
        for (let t = 0; t < 1200; t += 0.05) {
            const g = gustAt(t);
            if (g.phase >= 0 && prev < 0) starts.push(t);
            if (g.phase >= 0) expect(g.phase).toBeLessThan(1);
            prev = g.phase;
        }
        expect(starts.length).toBeGreaterThan(25);
        for (let i = 1; i < starts.length; i++) {
            expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(20);
            expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(40);
        }
        expect(gustAt(starts[3] + GUST_CROSS * 0.5).phase).toBeCloseTo(0.5, 1);
    });

    it('runs the Chalice’s preplay 35–50 s apart and its first idle eruption at IDLE_PERIOD, none earlier', () => {
        const starts = [];
        let prev = -1;
        for (let t = 0; t < 900; t += 0.05) {
            const s = chaliceSchedule(t);
            if (s.preplayAge >= 0 && prev < 0) starts.push(t);
            if (s.preplayAge >= 0) expect(s.splashes).toBeGreaterThanOrEqual(2);
            prev = s.preplayAge;
        }
        for (let i = 1; i < starts.length; i++) {
            expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(35 - 0.1);
            expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(50 + 0.1);
        }
        for (let t = 0; t < IDLE_PERIOD; t += 0.5) expect(chaliceSchedule(t).eruptionAge).toBe(-1);
        expect(chaliceSchedule(IDLE_PERIOD + 6).eruptionAge).toBeCloseTo(6);
        expect(chaliceSchedule(2 * IDLE_PERIOD + 1).eruptionAge).toBeCloseTo(1);
        // Deterministic: the same time always gives the same answer.
        expect(chaliceSchedule(123.4)).toEqual(chaliceSchedule(123.4));
    });

    it('hashes integers to [0, 1) deterministically', () => {
        const seen = new Set();
        for (let i = 0; i < 200; i++) {
            const h = hash1(i, 7);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(1);
            expect(hash1(i, 7)).toBe(h);
            seen.add(h.toFixed(6));
        }
        expect(seen.size).toBeGreaterThan(195);
        const rand = mulberry32(5);
        expect(rand()).toBe(mulberry32(5)());
    });
});

describe('Thermal Bloom core: eruptions', () => {
    it('launches every column after its delay, holds at its peak and falls back to nothing', () => {
        for (const [kind, e] of Object.entries(ERUPTIONS)) {
            expect(columnHeight(kind, 0), kind).toBe(0);
            expect(columnHeight(kind, e.delay * 0.99), kind).toBe(0);
            const top = e.delay + e.rise + Math.min(e.hold, 1) * 0.5;
            expect(columnHeight(kind, top), kind).toBeCloseTo(e.height, 6);
            if (e.hold < 1e5) expect(columnHeight(kind, e.delay + e.rise + e.hold + e.fall + 0.01), kind).toBe(0);
            expect(eruptionLength(kind)).toBeGreaterThan(0);
        }
    });

    it('raises the four-line column to 90 m in 0.8 s after a 0.35 s surge (rising monotonically)', () => {
        const q = ERUPTIONS.quad;
        expect(q.height).toBe(90);
        expect(q.delay).toBeCloseTo(0.35);
        expect(q.rise).toBeCloseTo(0.8);
        let prev = 0;
        for (let a = q.delay; a <= q.delay + q.rise; a += 0.02) {
            const h = columnHeight('quad', a);
            expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = h;
        }
        expect(q.steam).toBeGreaterThanOrEqual(12);
    });

    it('counts a chain in preplay splashes: none below a link of two, taller per link, capped', () => {
        expect(preplayHeight(1)).toBe(0);
        for (let n = 2; n < 14; n++) expect(preplayHeight(n + 1)).toBeGreaterThanOrEqual(preplayHeight(n));
        expect(preplayHeight(2)).toBeLessThanOrEqual(4);
        expect(preplayHeight(4)).toBeGreaterThanOrEqual(8);
        expect(preplayHeight(6)).toBeGreaterThanOrEqual(25);
        expect(preplayHeight(40)).toBe(60);
        expect(steamPhaseLength(6)).toBe(16);
    });
});

describe('Thermal Bloom core: blooms and the combo’s gauges', () => {
    it('compresses a bloom’s life under slot pressure: clamp(0.9·N/λ, 6, 60), monotonic in λ', () => {
        expect(bloomLife(24, 0)).toBe(60);
        expect(bloomLife(24, 1)).toBeCloseTo(21.6);
        expect(bloomLife(24, 2)).toBeCloseTo(10.8);
        expect(bloomLife(24, 3)).toBeCloseTo(7.2);
        expect(bloomLife(8, 100)).toBe(6);
        let prev = Infinity;
        for (let r = 0.05; r < 8; r += 0.05) {
            const L = bloomLife(16, r);
            expect(L).toBeLessThanOrEqual(prev);
            prev = L;
        }
    });

    it('bleaches saturated → cream → recolonised over its life', () => {
        const L = 60;
        expect(bleachAt(0, L).sat).toBe(1);
        expect(bleachAt(0.13 * L * 0.9, L).sat).toBe(1);
        expect(bleachAt(0.5 * L, L).sat).toBe(0);
        expect(bleachAt(0.5 * L, L).alive).toBe(1);
        expect(bleachAt(L, L).alive).toBe(0);
    });

    it('pushes the fingers’ wet front one notch a link from a chain of two, capped', () => {
        expect(fingerReach(0)).toBe(1);
        expect(fingerReach(1)).toBe(1);
        expect(fingerReach(2)).toBeGreaterThan(1);
        for (let n = 2; n < 20; n++) expect(fingerReach(n + 1)).toBeGreaterThanOrEqual(fingerReach(n));
        expect(fingerReach(50)).toBeCloseTo(1 + 0.12 * REACH_NOTCHES);
    });

    it('widens the eye 6% a link (cap 40%) plus 3% a level (cap 15%), at most 50% together', () => {
        expect(eyeHeat(0, 1)).toBe(0);
        expect(eyeHeat(2, 1)).toBeCloseTo(0.06);
        expect(eyeHeat(30, 1)).toBeCloseTo(0.4);
        expect(eyeHeat(1, 30)).toBeCloseTo(0.15);
        expect(eyeHeat(30, 30)).toBeCloseTo(0.5);
    });
});

describe('Thermal Bloom core: the sun and the one bow', () => {
    it('places the sun behind the camera’s left at 180° and level at elevation 0', () => {
        const back = sunVector(180, 0, 0, -1);
        expect(back[2]).toBeCloseTo(1);
        const left = sunVector(90, 0, 0, -1);
        expect(left[0]).toBeCloseTo(-1);
        const right = sunVector(90, 0, 0, -1, true);
        expect(right[0]).toBeCloseTo(1);
        const up = sunVector(120, 90, 0, -1);
        expect(up[1]).toBeCloseTo(1);
    });

    it('measures the antisolar angle: 0 looking straight away from the sun', () => {
        const sun = sunVector(180, 30, 0, -1);
        const eye = [0, 0, 0];
        expect(antisolarAngle(eye, [-sun[0] * 10, -sun[1] * 10, -sun[2] * 10], sun)).toBeCloseTo(0, 6);
        expect(BOW.inner).toBeLessThan(BOW.outer);
    });

    it('solves the sun inside its ranges for every preset, mirrored or not', () => {
        for (const preset of ['desktop', 'portrait']) {
            for (const mirrored of [false, true]) {
                const s = solveSun({
                    eye: [0, 44, 0],
                    forward: [0, -0.3, -1],
                    base: [mirrored ? -150 : 150, 8, -260],
                    height: 90,
                    preset,
                    mirrored,
                });
                const r = SUN_RANGES[preset];
                expect(s.azimuth).toBeGreaterThanOrEqual(r.azimuth[0]);
                expect(s.azimuth).toBeLessThanOrEqual(r.azimuth[1]);
                expect(s.elevation).toBeGreaterThanOrEqual(r.elevation[0]);
                expect(s.elevation).toBeLessThanOrEqual(r.elevation[1]);
            }
        }
    });

    it('puts the bow across a desktop Chalice column at 55–70% of its height', () => {
        const s = solveSun({
            eye: [0, 44, 0], forward: [0, -0.3, -1], base: [147, 10, -255], height: 90,
        });
        expect(s.onColumn).toBe(true);
        expect(s.crossing / 90).toBeGreaterThanOrEqual(0.55);
        expect(s.crossing / 90).toBeLessThanOrEqual(0.7);
    });
});

describe('Thermal Bloom core: the shared tables and the maths', () => {
    it('lays the event table out in blocks that fit inside it', () => {
        let at = 0;
        for (const block of Object.keys(EVENT_SLOTS)) {
            expect(EVENT_ROWS[block], block).toBe(at);
            at += EVENT_SLOTS[block] * EVENT_ROWS_PER[block];
        }
        expect(EVENT_ROWS.used).toBe(at);
        expect(EVENT_ROWS.used).toBeLessThanOrEqual(EVENT_ROWS.total);
        expect(EVENT_ROWS.total).toBeLessThanOrEqual(128);
    });

    it('steps and eases between its edges, and never divides by equal ones', () => {
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5);
        expect(smooth(2, 2, 1)).toBe(0);
        expect(smooth(2, 2, 3)).toBe(1);
        expect(smoother(0)).toBe(0);
        expect(smoother(1)).toBe(1);
        expect(hexToLinear('nope')).toEqual([0, 0, 0]);
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
    });
});

describe('Thermal Bloom core: the steam, pine and jewel plans', () => {
    const ASPECTS = [390 / 844, 1, 4 / 3, 16 / 9, 2560 / 1080];

    it('lays the Iris dome first, the Chalice thread second, then far columns on the ground', () => {
        for (const aspect of ASPECTS) {
            const plan = composeWorld(aspect, false);
            const plumes = plumePlan(plan, STEAM_SLOTS);
            expect(plumes.length).toBeLessThanOrEqual(STEAM_SLOTS);
            expect(plumes[0].kind).toBe(PLUME_KIND.dome);
            expect(plumes[0].x).toBeCloseTo(plan.eye[0], 6);
            expect(plumes[1].kind).toBe(PLUME_KIND.thread);
            expect(plumes[1].base).toBeGreaterThan(plan.chalice[1]);
            for (const p of plumes.slice(2)) {
                expect(p.kind).toBe(PLUME_KIND.column);
                expect(p.base).toBe(0);
                // Each column stands in front of the far rim, inside the basin.
                expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(FAR_PLUME_REACH + 1e-6);
                expect(p.r1).toBeGreaterThan(p.r0);
            }
        }
        // A tier's count is respected, the dome and the thread kept first.
        const few = plumePlan(composeWorld(16 / 9, false), 3);
        expect(few.map((p) => p.kind)).toEqual([PLUME_KIND.dome, PLUME_KIND.thread, PLUME_KIND.column]);
        expect(plumePlan(composeWorld(16 / 9, false), 0)).toEqual([]);
    });

    it('mirrors the far columns with the layout', () => {
        const a = plumePlan(composeWorld(16 / 9, false), 6);
        const b = plumePlan(composeWorld(16 / 9, true), 6);
        // The camera looks down −z with x to the right: a mirrored column stands at −x.
        expect(Math.sign(a[2].x)).toBe(-Math.sign(b[2].x));
    });

    it('spreads exactly the tier’s pines over the stands, deterministically', () => {
        const plan = composeWorld(16 / 9, false);
        for (const n of [24, 40, 72]) {
            const trees = pinePlan(plan, n);
            expect(trees).toHaveLength(n);
            trees.forEach((t) => {
                expect(t.height).toBeGreaterThan(8);
                expect(t.height).toBeLessThan(21);
                expect(Number.isFinite(t.x) && Number.isFinite(t.z)).toBe(true);
            });
        }
        expect(pinePlan(plan, 24)).toEqual(pinePlan(plan, 24));
        expect(PINE_STANDS.length).toBeGreaterThan(3);
    });

    it('puts one pool of each jewel kind on the far apron', () => {
        const jewels = jewelPlan(composeWorld(16 / 9, false));
        const kinds = [JEWEL_KIND.lime, JEWEL_KIND.champagne, JEWEL_KIND.opal];
        expect(jewels.map((j) => j.kind).sort()).toEqual(kinds.sort());
        jewels.forEach((j) => {
            expect(j.radius).toBeGreaterThan(4);
            expect(j.z).toBeLessThan(0);
        });
    });
});

describe('Thermal Bloom core: the heroes stay clear of the card and the HUD', () => {
    const ASPECTS = [0.46, 1.0, 1.33, 1.78, 2.37];
    const H = 900;
    /** The solo fallback layout at an aspect, mirrored by the world's own HUD rule. */
    const layoutAt = (aspect) => {
        const { cards: [card], hud } = fallbackLayout(Math.round(H * aspect), H);
        return { rects: [card, hud], mirrored: (hud.x0 + hud.x1) / 2 < (card.x0 + card.x1) / 2 };
    };
    const clear = (p, rects, margin) => rects.every((r) => p[0] < r.x0 - margin || p[0] > r.x1 + margin
        || p[1] < r.y0 - margin || p[1] > r.y1 + margin);
    const onScreen = (plan, key) => projectToScreen(plan.rig, plan.aspect, plan[key]);

    it('never puts the eye under the card or the HUD, at any aspect', () => {
        ASPECTS.forEach((aspect) => {
            const { rects, mirrored } = layoutAt(aspect);
            const eye = onScreen(composeWorld(aspect, mirrored), 'eye');
            expect(clear(eye, rects, 0), `eye at ${aspect}`).toBe(true);
        });
    });

    it('keeps the Sleeper and the Consort in frame, clear of the card and HUD by 0.02', () => {
        ASPECTS.forEach((aspect) => {
            const { rects, mirrored } = layoutAt(aspect);
            const plan = composeWorld(aspect, mirrored);
            ['sleeper', 'consort'].forEach((key) => {
                const p = onScreen(plan, key);
                expect(p, `${key} at ${aspect}`).not.toBeNull();
                expect(p[0] > 0.01 && p[0] < 0.99 && p[1] > plan.horizon && p[1] < 0.99, `${key} at ${aspect}`)
                    .toBe(true);
                expect(clear(p, rects, 0.02), `${key} at ${aspect}: ${p}`).toBe(true);
            });
        });
    });

    it('lays out the fumaroles on the ground in frame, each on its own clock', () => {
        const plan = composeWorld(16 / 9);
        const vents = fumarolePlan(plan);
        expect(vents).toHaveLength(FUMAROLES.length);
        vents.forEach((v) => {
            const p = projectToScreen(plan.rig, plan.aspect, [v.x, 0, v.z]);
            expect(p[0] > 0 && p[0] < 1 && p[1] > plan.horizon && p[1] < 1).toBe(true);
            expect(v.period).toBeGreaterThanOrEqual(FUMAROLE_PERIOD[0]);
            expect(v.period).toBeLessThanOrEqual(FUMAROLE_PERIOD[1]);
        });
        expect(new Set(vents.map((v) => v.period.toFixed(3))).size).toBe(vents.length);
    });
});
