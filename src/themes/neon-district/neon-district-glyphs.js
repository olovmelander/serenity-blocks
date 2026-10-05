/**
 * Neon District — the sign-maker's alphabet (CPU only).
 *
 * Every tube sign in the district is bent from these strokes: digits and Latin capitals for the
 * trade words, and twenty-eight characters of the district's own script (built from the strokes a
 * brush-written sign would use, spelling nothing). Strokes live on a 4 × 6 grid (y up); the
 * atlas is a signed-distance field, so a tube stays a clean line of light at any size.
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

export const GLYPH_GRID = 8;
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

/** Segment lists for all 64 glyphs: 0-9, A-Z, then the district's script. */
export function glyphSegments() {
    const order = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const glyphs = Array.from(order, (ch) => parse(LATIN[ch]));
    SCRIPT.forEach((spec) => glyphs.push(parse(spec)));
    return glyphs;
}

/**
 * Bake the atlas: GLYPH_GRID² cells of GLYPH_CELL² texels, one byte per texel
 * (255 = on a stroke, 0 = GLYPH_RANGE cells away or more). Row 0 of the data is the BOTTOM row of
 * cell row 0 (texture v up), so glyph g sits at column g % 8, row floor(g / 8).
 * @returns {{ data: Uint8Array, size: number }}
 */
export function bakeGlyphAtlas() {
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
