/**
 * @fileoverview The sign-maker's alphabet for chapter 8's neon (CPU only, three-free).
 *
 * Copied and trimmed from Neon District's alphabet (src/themes/neon-district/neon-district-glyphs.js
 * — strokes on a 4 x 6 grid, y up, baked into a signed-distance atlas so a tube stays a clean line
 * of light at any size). Not imported from the theme: Rollup puts a theme's folder in one chunk.
 * Kept here: digits, Latin capitals and twenty of the district's own script characters (they
 * spell nothing); dropped: the punctuation the theme's shop fascias need. The cell is 48 texels
 * (the theme's 64): the city's tubes are seen from tens of metres away, and the bake runs at
 * chapter creation, so it is small and done once per session.
 */

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

/** Twenty characters of Neon District's own script (they spell nothing). */
const SCRIPT = [
    '0,5 4,5|2,6 2,0|0,2.6 4,2.6',
    '0,6 4,6|0,3 4,3|0,0 4,0|2,6 2,0',
    '0,6 4,6 4,0 0,0 0,6|0,3 4,3',
    '0,5 4,5 4,1 0,1 0,5|2,6 2,0',
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
    '0,6 4,6 2,3.6|2,3.6 2,0|0,2 4,2',
    '1,6 0,3.4|1,4.6 4,4.6|2.6,4.6 2.6,0|0,0 4,0',
    '0,3 4,3|2,6 2,3|0,0 2,3 4,0|0.6,5 3.4,5',
    '0,6 4,6|1,6 1,0|3,6 3,0|0,0 4,0|1,3 3,3',
    '0,4 2,6 4,4|2,6 2,0|0,1.6 4,1.6',
    '2,6 0,3 4,3|2,3 2,0|0,0 4,0',
];

/** Atlas layout: 0-9 A-Z, then the script. */
export const NEON_GLYPH_LATIN = 36;
export const NEON_GLYPH_SCRIPT = SCRIPT.length;
export const NEON_GLYPH_COUNT = NEON_GLYPH_LATIN + NEON_GLYPH_SCRIPT;
/** A space (or a character the atlas lacks): the shaders draw nothing. */
export const NEON_GLYPH_BLANK = 255;
export const NEON_GLYPH_GRID = 8;
export const NEON_GLYPH_CELL = 48;
/** Distance (in cells) that maps to 0 in the atlas; 255 is a stroke's centre line. */
export const NEON_GLYPH_RANGE = 0.25;
const BOX = Object.freeze({
    x0: 0.2, x1: 0.8, y0: 0.14, y1: 0.86,
});

/** The atlas cell for one character of a sign's text. */
export function neonGlyphFor(ch) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return 10 + code - 65;
    if (code >= 97 && code <= 122) return 10 + code - 97;
    return NEON_GLYPH_BLANK;
}

function parse(spec) {
    const segments = [];
    spec.split('|').forEach((line) => {
        const points = line.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
        for (let i = 0; i + 1 < points.length; i += 1) {
            segments.push([points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]]);
        }
    });
    return segments;
}

let cachedAtlas = null;

/**
 * Bake the atlas once: GRID^2 cells of CELL^2 texels, one byte per texel (255 = on a stroke,
 * 0 = RANGE cells away or more). Row 0 of the data is the BOTTOM row of cell row 0 (texture v
 * up), so glyph g sits at column g % GRID, row floor(g / GRID).
 * @returns {{data: Uint8Array, size: number}}
 */
export function bakeNeonGlyphAtlas() {
    if (cachedAtlas) return cachedAtlas;
    const order = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const glyphs = Array.from(order, (ch) => parse(LATIN[ch]));
    SCRIPT.forEach((spec) => glyphs.push(parse(spec)));
    const size = NEON_GLYPH_GRID * NEON_GLYPH_CELL;
    const data = new Uint8Array(size * size);
    const sx = (BOX.x1 - BOX.x0) / 4;
    const sy = (BOX.y1 - BOX.y0) / 6;
    const reach = NEON_GLYPH_RANGE;
    for (let g = 0; g < glyphs.length; g += 1) {
        const col = g % NEON_GLYPH_GRID;
        const row = Math.floor(g / NEON_GLYPH_GRID);
        // Flat segment table (a, b - a, |b - a|^2): no destructuring in the inner loop.
        const list = glyphs[g];
        const seg = new Float64Array(list.length * 5);
        list.forEach(([ax, ay, bx, by], i) => {
            const x0 = BOX.x0 + ax * sx;
            const y0 = BOX.y0 + ay * sy;
            const dx = BOX.x0 + bx * sx - x0;
            const dy = BOX.y0 + by * sy - y0;
            seg.set([x0, y0, dx, dy, dx * dx + dy * dy], i * 5);
        });
        const nSeg = list.length;
        const base = row * NEON_GLYPH_CELL * size + col * NEON_GLYPH_CELL;
        for (let py = 0; py < NEON_GLYPH_CELL; py += 1) {
            const y = (py + 0.5) / NEON_GLYPH_CELL;
            for (let px = 0; px < NEON_GLYPH_CELL; px += 1) {
                const x = (px + 0.5) / NEON_GLYPH_CELL;
                let best = reach * reach;
                for (let s = 0, o = 0; s < nSeg; s += 1, o += 5) {
                    const len2 = seg[o + 4];
                    let t = len2 > 0 ? ((x - seg[o]) * seg[o + 2] + (y - seg[o + 1]) * seg[o + 3]) / len2 : 0;
                    t = Math.min(1, Math.max(0, t));
                    const ex = x - seg[o] - seg[o + 2] * t;
                    const ey = y - seg[o + 1] - seg[o + 3] * t;
                    const d2 = ex * ex + ey * ey;
                    if (d2 < best) best = d2;
                }
                const v = 1 - Math.sqrt(best) / reach;
                data[base + py * size + px] = v > 0 ? Math.round(v * 255) : 0;
            }
        }
    }
    cachedAtlas = { data, size };
    return cachedAtlas;
}
