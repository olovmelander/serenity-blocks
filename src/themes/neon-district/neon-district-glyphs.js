/**
 * Neon District — the sign-maker's alphabet (CPU only).
 *
 * Every tube sign in the district is bent from these strokes: digits and Latin capitals for the
 * trade words, twenty-eight characters of the district's own script (built from the strokes a
 * brush-written sign would use, spelling nothing), and the punctuation the shop fascias and the
 * adverts' lines need. Strokes live on a 4 × 6 grid (y up); the atlas is a signed-distance field,
 * so a tube stays a clean line of light at any size.
 */

import { bakeOnce } from '../shared/bake-cache.js';

const LATIN = {
    0: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|0.7,1.1 3.3,4.9',
    1: '1,5 2,6 2,0|1,0 3,0',
    2: '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
    3: '0,5 1,6 3,6 4,5 4,4 3,3 1.6,3|3,3 4,2 4,1 3,0 1,0 0,1',
    4: '3,0 3,6 0,2 4,2',
    5: '4,6 0,6 0,3.4 3,3.4 4,2.4 4,1 3,0 1,0 0,1',
    6: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.4 3,3.4 0,3.4',
    7: '0,6 4,6 1.6,0',
    8: '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
    9: '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,3.6 1,2.6 4,2.6',
    A: '0,0 0,4 2,6 4,4 4,0|0,2.6 4,2.6',
    B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0',
    C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
    D: '0,0 0,6 2.6,6 4,4.6 4,1.4 2.6,0 0,0',
    E: '4,6 0,6 0,0 4,0|0,3 3,3',
    F: '4,6 0,6 0,0|0,3 3,3',
    G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2.2,3',
    H: '0,0 0,6|4,0 4,6|0,3 4,3',
    I: '1,6 3,6|2,6 2,0|1,0 3,0',
    J: '1,6 4,6|3,6 3,1 2,0 1,0 0,1',
    K: '0,0 0,6|4,6 0,2.6|1.4,3.6 4,0',
    L: '0,6 0,0 4,0',
    M: '0,0 0,6 2,3 4,6 4,0',
    N: '0,0 0,6 4,0 4,6',
    O: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0',
    P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
    Q: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2.4,1.6 4,0',
    R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
    S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
    T: '0,6 4,6|2,6 2,0',
    U: '0,6 0,1 1,0 3,0 4,1 4,6',
    V: '0,6 2,0 4,6',
    W: '0,6 1,0 2,3.4 3,0 4,6',
    X: '0,0 4,6|0,6 4,0',
    Y: '0,6 2,3 4,6|2,3 2,0',
    Z: '0,6 4,6 0,0 4,0',
};

/** The district's own script: twenty-eight characters that spell nothing. */
const SCRIPT = [
    '0,5 4,5|2,6 2,0|0,2.6 4,2.6',
    '0,6 4,6|0,3 4,3|0,0 4,0|2,6 2,0',
    '0,6 4,6 4,0 0,0 0,6|0,3 4,3',
    '0,5 4,5 4,1 0,1 0,5|2,6 2,0',
    '0,6 4,6 4,0 0,0 0,6|0,3 4,3|2,6 2,0',
    '0,4.4 4,4.4|2,6 2,4.4|2,4.4 0,0|2,4.4 4,0',
    '0,5 4,5|0,3.4 4,3.4|2,3.4 0,0|2,3.4 4,0',
    '2,6 2,0|0,4.4 4,4.4|2,4.4 0,1|2,4.4 4,1',
    '0,6 0,0 4,0|0,3 3,3|3,6 3,3',
    '0,6 4,6|4,6 4,3 1,0|0,3 2.4,3',
    '0,5 3,5|4,6 4,2 2,0',
    '0,6 1,5|0,3.6 1,2.6|4,6 4,3 1.4,0',
    '0,4.6 4,4.6|1,6 1,3|3,6 3,2 1.6,0',
    '0,5 4,5 4,3|2,5 2,2 0.6,0',
    '0,6 4,6|0,0 4,0|2,6 2,0|0.6,3 3.4,3',
    '0,0 0,6 4,6 4,0|1.2,3.6 2.8,3.6 2.8,1.6 1.2,1.6 1.2,3.6',
    '0,6 4,6 2,3.6|2,3.6 2,0|0,2 4,2',
    '1,6 0,3.4|1,4.6 4,4.6|2.6,4.6 2.6,0|0,0 4,0',
    '0,5.4 4,5.4|0,5.4 0,2.6 4,2.6 4,5.4|2,2.6 2,0|0,0 4,0',
    '0,3 4,3|2,6 2,3|0,0 2,3 4,0|0.6,5 3.4,5',
    '0,6 0,0|1.6,6 4,6 4,0 1.6,0 1.6,6|1.6,3 4,3',
    '0,6 4,6|1,6 1,0|3,6 3,0|0,0 4,0|1,3 3,3',
    '0,4 2,6 4,4|2,6 2,0|0,1.6 4,1.6',
    '0,6 4,6|0,6 0,0|0,3 4,3 4,0',
    '0,5 1.4,6|2,5 3.4,6|0,3.6 4,3.6|2,3.6 2,0|0.4,0 3.6,0',
    '0,6 4,6 4,4 0,4 0,6|0,2.6 4,2.6|1,2.6 0,0|3,2.6 4,0',
    '2,6 0,3 4,3|2,3 2,0|0,0 4,0',
    '0,6 0,2 2,0 4,2 4,6|0,4 4,4',
];

/** Punctuation, in atlas order after the script. A dot is a tiny closed loop. */
const PUNCTUATION = [
    ['&', '4,0 1,4.2 1,5.2 2,6 3,5.2 3,4.4 0,2 0,0.8 1,0 2.4,0 4,2'],
    ['-', '0.8,3 3.2,3'],
    ['.', '1.8,0 2.2,0 2.2,0.4 1.8,0.4 1.8,0'],
    ['!', '2,6 2,1.6|2,0.4 2,0'],
    ['?', '0,5 1,6 3,6 4,5 4,4 2,2.6 2,1.6|2,0.4 2,0'],
    ["'", '2,6 2,4.6'],
    [':', '2,4.2 2,3.8|2,1.2 2,0.8'],
    ['/', '0,0 4,6'],
    ['+', '2,1 2,5|0,3 4,3'],
    ['#', '1,0 1.6,6|2.4,0 3,6|0,2 4,2|0,4 4,4'],
    ['%', '0,0 4,6|0,6 0,5 1,5 1,6 0,6|3,0 3,1 4,1 4,0 3,0'],
    ['*', '2,1.4 2,4.6|0.6,2.2 3.4,3.8|0.6,3.8 3.4,2.2'],
    ['<', '4,5 0,3 4,1'],
    ['>', '0,5 4,3 0,1'],
    ['=', '0,2 4,2|0,4 4,4'],
    ['·', '1.8,2.8 2.2,2.8 2.2,3.2 1.8,3.2 1.8,2.8'],
    ['(', '2.8,6 1.6,4.8 1.2,3 1.6,1.2 2.8,0'],
];

/** Atlas layout: 0-9 A-Z, then the script, then the punctuation. */
export const GLYPH_LATIN = 36;
export const GLYPH_SCRIPT = SCRIPT.length;
export const GLYPH_PUNCT = GLYPH_LATIN + GLYPH_SCRIPT;
export const GLYPH_COUNT = GLYPH_PUNCT + PUNCTUATION.length;
/** The id a space (or any character the atlas lacks) encodes to: the shaders draw nothing. */
export const GLYPH_BLANK = 255;

const PUNCT_INDEX = new Map(PUNCTUATION.map(([ch], i) => [ch, GLYPH_PUNCT + i]));

/** The atlas cell for one character of a sign's text (GLYPH_BLANK for a space). */
export function glyphFor(ch) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return 10 + code - 65;
    if (code >= 97 && code <= 122) return 10 + code - 97;
    return PUNCT_INDEX.get(ch) ?? GLYPH_BLANK;
}

export const GLYPH_GRID = 9;
export const GLYPH_CELL = 64;
/** Distance (in cells) that maps to 0 in the atlas; 255 is the stroke's centre line. */
export const GLYPH_RANGE = 0.25;
/** The stroke box inside a cell (cell units): the 4 × 6 grid is fitted into it. */
export const GLYPH_BOX = Object.freeze({
    x0: 0.2, x1: 0.8, y0: 0.14, y1: 0.86,
});

function parse(spec) {
    const segments = [];
    spec.split('|').forEach((line) => {
        const points = line.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
        for (let i = 0; i + 1 < points.length; i++) {
            segments.push([points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]]);
        }
    });
    return segments;
}

/** Segment lists for every glyph: 0-9, A-Z, the district's script, then the punctuation. */
export function glyphSegments() {
    const order = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const glyphs = Array.from(order, (ch) => parse(LATIN[ch]));
    SCRIPT.forEach((spec) => glyphs.push(parse(spec)));
    PUNCTUATION.forEach(([, spec]) => glyphs.push(parse(spec)));
    return glyphs;
}

/**
 * Bake the atlas: GLYPH_GRID² cells of GLYPH_CELL² texels, one byte per texel
 * (255 = on a stroke, 0 = GLYPH_RANGE cells away or more). Row 0 of the data is the BOTTOM row of
 * cell row 0 (texture v up), so glyph g sits at column g % GLYPH_GRID, row floor(g / GLYPH_GRID).
 * @returns {{ data: Uint8Array, size: number }}
 */
function computeGlyphAtlas() {
    const glyphs = glyphSegments();
    const size = GLYPH_GRID * GLYPH_CELL;
    const data = new Uint8Array(size * size);
    const sx = (GLYPH_BOX.x1 - GLYPH_BOX.x0) / 4;
    const sy = (GLYPH_BOX.y1 - GLYPH_BOX.y0) / 6;
    for (let g = 0; g < glyphs.length; g++) {
        const col = g % GLYPH_GRID;
        const row = Math.floor(g / GLYPH_GRID);
        const segs = glyphs[g].map(([ax, ay, bx, by]) => [
            GLYPH_BOX.x0 + ax * sx, GLYPH_BOX.y0 + ay * sy, GLYPH_BOX.x0 + bx * sx, GLYPH_BOX.y0 + by * sy,
        ]);
        for (let py = 0; py < GLYPH_CELL; py++) {
            const y = (py + 0.5) / GLYPH_CELL;
            for (let px = 0; px < GLYPH_CELL; px++) {
                const x = (px + 0.5) / GLYPH_CELL;
                let best = Infinity;
                for (let s = 0; s < segs.length; s++) {
                    const [ax, ay, bx, by] = segs[s];
                    const dx = bx - ax;
                    const dy = by - ay;
                    const len2 = dx * dx + dy * dy;
                    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
                    const ex = x - (ax + dx * t);
                    const ey = y - (ay + dy * t);
                    const d2 = ex * ex + ey * ey;
                    if (d2 < best) best = d2;
                }
                const d = Math.sqrt(best);
                const v = Math.max(0, 1 - d / GLYPH_RANGE);
                data[(row * GLYPH_CELL + py) * size + col * GLYPH_CELL + px] = Math.round(v * 255);
            }
        }
    }
    return { data, size };
}

/** The bake cache's key for the atlas (it depends on nothing but this module). */
export const GLYPH_ATLAS_KEY = 'neon-district:glyph-atlas';

/** The atlas, baked once (read-only: the texture's bytes). */
export function bakeGlyphAtlas() {
    return bakeOnce(GLYPH_ATLAS_KEY, computeGlyphAtlas);
}
