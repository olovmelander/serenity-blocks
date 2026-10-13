/**
 * High Coast — the trail sign's lettering: a small stroke font laid out on one line and baked into
 * an 8-bit signed-distance field the boards' shader carves (row 0 at the BOTTOM, as a DataTexture
 * maps uv.y = 0; 128 on a stroke's edge, higher inside).
 */
import { describe, expect, it } from 'vitest';
import {
    GLYPHS, STROKE, TRACKING, bakeSignField, layoutText,
} from '../../src/themes/high-coast/high-coast-sign.js';
import { SIGN } from '../../src/themes/high-coast/high-coast-props.js';

const TEXTS = ['HÖGA KUSTEN', 'VÄRLDSARV'];
const INK = 128;

/** Where a bake puts the baseline and the em (the bake's own arithmetic, for its defaults). */
function frame(height, cap = 0.56) {
    const em = height * cap;
    return { em, base: (height - em) / 2 + em * 0.04 };
}

/** The ink of a field: count, horizontal centroid and bounding box. */
function inkOf(field, width, height) {
    let n = 0;
    let sum = 0;
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            if (field[j * width + i] <= INK) continue;
            n += 1;
            sum += i + 0.5;
            x0 = Math.min(x0, i);
            x1 = Math.max(x1, i);
            y0 = Math.min(y0, j);
            y1 = Math.max(y1, j);
        }
    }
    return {
        n, centroid: n ? sum / n : NaN, x0, x1, y0, y1,
    };
}

/** Runs of inked columns among the rows strictly above a height (em units above the baseline). */
function inkRunsAbove(field, width, height, emAbove) {
    const { em, base } = frame(height);
    const columns = new Set();
    for (let j = 0; j < height; j++) {
        if ((j + 0.5 - base) / em <= emAbove) continue;
        for (let i = 0; i < width; i++) if (field[j * width + i] > INK) columns.add(i);
    }
    const sorted = [...columns].sort((a, b) => a - b);
    let runs = sorted.length ? 1 : 0;
    for (let k = 1; k < sorted.length; k++) if (sorted[k] - sorted[k - 1] > 1) runs += 1;
    return runs;
}

describe('High Coast sign: the font', () => {
    it('has a glyph for every character the sign carries', () => {
        for (const text of [...TEXTS, ...SIGN.boards.map((board) => board.text)]) {
            const missing = [...text].filter((ch) => !GLYPHS[ch]);
            expect(missing, text).toEqual([]);
        }
        expect(SIGN.boards.map((board) => board.text)).toEqual(TEXTS);
    });

    it('draws each glyph as polylines inside its em box, with an advance wider than the box', () => {
        for (const [ch, glyph] of Object.entries(GLYPHS)) {
            expect(glyph.advance, ch).toBeGreaterThan(0);
            glyph.lines.forEach((line) => {
                expect(line.length, ch).toBeGreaterThanOrEqual(2);
                line.forEach(([x, y]) => {
                    expect(x, ch).toBeGreaterThanOrEqual(-0.05);
                    expect(x, ch).toBeLessThanOrEqual(glyph.advance);
                    expect(y, ch).toBeGreaterThanOrEqual(-0.05);
                    expect(y, ch).toBeLessThanOrEqual(1.3);
                });
            });
            if (ch !== ' ') expect(glyph.lines.length, ch).toBeGreaterThan(0);
        }
        expect(GLYPHS[' '].lines).toEqual([]);
        // The umlauts are their base letter with two dots above it.
        expect(GLYPHS['Ö'].lines.slice(0, GLYPHS.O.lines.length)).toEqual(GLYPHS.O.lines);
        expect(GLYPHS['Ä'].lines.slice(0, GLYPHS.A.lines.length)).toEqual(GLYPHS.A.lines);
        for (const ch of ['Ö', 'Ä']) {
            const dots = GLYPHS[ch].lines.slice(GLYPHS[ch === 'Ö' ? 'O' : 'A'].lines.length);
            expect(dots, ch).toHaveLength(2);
            dots.forEach((dot) => dot.forEach(([, y]) => expect(y, ch).toBeGreaterThan(1)));
        }
    });

    it('lays a text out on one line, letter by letter, unknown characters as spaces', () => {
        const one = layoutText('H');
        expect(one.glyphs).toHaveLength(1);
        expect(one.segments.length).toBe(3);
        const two = layoutText('HH');
        expect(two.width - one.width).toBeCloseTo(GLYPHS.H.advance + TRACKING, 9);
        // The second letter's strokes are the first's, moved along by an advance.
        two.segments.slice(3).forEach((s, k) => {
            const a = one.segments[k];
            expect(s[0] - a[0]).toBeCloseTo(GLYPHS.H.advance + TRACKING, 9);
            expect(s[1]).toBe(a[1]);
        });
        expect(layoutText('hög').width).toBeCloseTo(layoutText('HÖG').width, 9);
        expect(layoutText('H#H').width).toBeCloseTo(layoutText('H H').width, 9);
        expect(layoutText('').width).toBe(0);
        // A space adds width but no strokes.
        expect(layoutText('H H').glyphs).toHaveLength(2);
        expect(layoutText('H H').width).toBeGreaterThan(two.width);
    });
});

describe('High Coast sign: the baked field', () => {
    it.each(TEXTS)('bakes %s as width × height bytes with ink, centred on the board', (text) => {
        const { w, h } = SIGN.texture;
        const field = bakeSignField(text, w, h);
        expect(field).toBeInstanceOf(Uint8Array);
        expect(field).toHaveLength(w * h);
        const ink = inkOf(field, w, h);
        expect(ink.n).toBeGreaterThan(w * h * 0.05);
        // Mostly board, not ink.
        expect(ink.n).toBeLessThan(w * h * 0.5);
        // Centred: the ink's weight and its box both sit on the middle of the board.
        expect(Math.abs(ink.centroid - w / 2)).toBeLessThan(w * 0.02);
        expect(Math.abs((ink.x0 + ink.x1 + 1) / 2 - w / 2)).toBeLessThan(w * 0.02);
        expect(ink.x0).toBeGreaterThan(0);
        expect(ink.x1).toBeLessThan(w - 1);
        expect(ink.y0).toBeGreaterThan(0);
        expect(ink.y1).toBeLessThan(h - 1);
        // An edge where the strokes are, deep board where they are not.
        expect(Math.max(...field)).toBeGreaterThan(200);
        expect(Math.min(...field)).toBe(0);
        // The same text bakes the same field.
        expect(Buffer.from(bakeSignField(text, w, h)).equals(Buffer.from(field))).toBe(true);
    });

    it('stands the letters on the board\'s baseline with row 0 at the bottom', () => {
        const w = 160;
        const h = 96;
        const { em, base } = frame(h);
        const ink = inkOf(bakeSignField('HEL', w, h), w, h);
        // A cap's foot at the baseline and its top at the cap height (each widened by the stroke).
        expect(ink.y0).toBeCloseTo(base - STROKE * em, -1);
        expect(ink.y1).toBeCloseTo(base + em * (1 + STROKE), -1);
        // L's foot runs right along the bottom row of the text: the bottom rows hold more ink
        // than the top ones would if the field were upside down.
        const field = bakeSignField('L', w, h);
        const rowInk = (j) => Array.from(field.subarray(j * w, (j + 1) * w)).filter((v) => v > INK).length;
        expect(rowInk(Math.round(base))).toBeGreaterThan(rowInk(Math.round(base + em * 0.9)));
    });

    it('carries the two dots of Ö and Ä above the cap height, and nothing above an O or an A', () => {
        const w = 128;
        const h = 96;
        for (const ch of ['Ö', 'Ä']) {
            expect(inkRunsAbove(bakeSignField(ch, w, h), w, h, 1 + STROKE), ch).toBe(2);
        }
        for (const ch of ['O', 'A', 'H']) {
            expect(inkRunsAbove(bakeSignField(ch, w, h), w, h, 1 + STROKE), ch).toBe(0);
        }
        // On the boards themselves too.
        const { w: bw, h: bh } = SIGN.texture;
        expect(inkRunsAbove(bakeSignField(TEXTS[0], bw, bh), bw, bh, 1 + STROKE)).toBe(2);
        expect(inkRunsAbove(bakeSignField(TEXTS[1], bw, bh), bw, bh, 1 + STROKE)).toBe(2);
    });

    it('fits a longer text into the same board by making its letters no larger', () => {
        const { w, h } = SIGN.texture;
        const short = inkOf(bakeSignField('HÖGA', w, h), w, h);
        const long = inkOf(bakeSignField(TEXTS[0], w, h), w, h);
        expect(long.x1 - long.x0).toBeGreaterThan(short.x1 - short.x0);
        expect(long.y1 - long.y0).toBe(short.y1 - short.y0);
    });
});
