/**
 * High Coast — the trail sign's lettering (CPU only, three-free).
 *
 * The sign on the summit reads HÖGA KUSTEN, and an arrow board below it VÄRLDSARV (World
 * Heritage). The letters are a small stroke font (polylines in an em box: x 0..0.62, y 0..1,
 * baseline at 0) baked into a signed-distance texture once, so the boards' shader can carve them
 * crisp at any size (no canvas: a theme draws no 2D context).
 */

/** Stroke half-width, em units; extra space between letters (carved letters need room). */
export const TRACKING = 0.09;
export const STROKE = 0.085;
const ARC = 14;

const arc = (cx, cy, rx, ry, a0, a1, n = ARC) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
        const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
        out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return out;
};
const dots = [[[0.16, 1.2], [0.165, 1.205]], [[0.44, 1.2], [0.445, 1.205]]];

/** The glyphs: a list of polylines each, and the advance (em). */
const glyphs = {
    A: { lines: [[[0, 0], [0.31, 1], [0.62, 0]], [[0.12, 0.36], [0.5, 0.36]]], advance: 0.74 },
    D: { lines: [[[0, 0], [0, 1], [0.28, 1], ...arc(0.28, 0.5, 0.32, 0.5, 90, -90).slice(1), [0, 0]]], advance: 0.74 },
    E: { lines: [[[0.56, 1], [0, 1], [0, 0], [0.58, 0]], [[0, 0.52], [0.46, 0.52]]], advance: 0.68 },
    G: {
        lines: [arc(0.31, 0.5, 0.31, 0.5, 38, 340), [[0.36, 0.44], [0.62, 0.44], [0.62, 0.12]]], advance: 0.74,
    },
    H: { lines: [[[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.52], [0.6, 0.52]]], advance: 0.72 },
    K: { lines: [[[0, 0], [0, 1]], [[0.58, 1], [0, 0.4]], [[0.18, 0.58], [0.6, 0]]], advance: 0.7 },
    L: { lines: [[[0, 1], [0, 0], [0.55, 0]]], advance: 0.64 },
    N: { lines: [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]], advance: 0.72 },
    O: { lines: [arc(0.31, 0.5, 0.31, 0.5, 0, 360, 24)], advance: 0.74 },
    R: {
        lines: [[[0, 0], [0, 1], [0.36, 1], ...arc(0.36, 0.76, 0.22, 0.24, 90, -90, 10).slice(1), [0, 0.52]], [[0.3, 0.52], [0.6, 0]]],
        advance: 0.7,
    },
    S: {
        lines: [[[0.58, 0.86], [0.48, 0.98], [0.3, 1.0], [0.12, 0.97], [0.03, 0.86], [0.04, 0.68], [0.16, 0.57], [0.44, 0.45],
            [0.57, 0.33], [0.59, 0.16], [0.5, 0.04], [0.3, 0.0], [0.11, 0.03], [0.01, 0.15]]],
        advance: 0.7,
    },
    T: { lines: [[[0, 1], [0.62, 1]], [[0.31, 1], [0.31, 0]]], advance: 0.7 },
    U: { lines: [[[0, 1], [0, 0.32], ...arc(0.3, 0.32, 0.3, 0.32, 180, 360).slice(1), [0.6, 1]]], advance: 0.72 },
    V: { lines: [[[0, 1], [0.31, 0], [0.62, 1]]], advance: 0.72 },
    ' ': { lines: [], advance: 0.42 },
};
glyphs.Ö = { lines: [...glyphs.O.lines, ...dots], advance: glyphs.O.advance };
glyphs.Ä = { lines: [...glyphs.A.lines, ...dots], advance: glyphs.A.advance };
export const GLYPHS = Object.freeze(glyphs);

/** The text's strokes laid out on one line from x = 0 (em units), and its width. */
export function layoutText(text) {
    const segments = [];
    let x = 0;
    const laid = [];
    for (const ch of String(text).toUpperCase()) {
        const g = GLYPHS[ch] || GLYPHS[' '];
        const segs = [];
        for (const line of g.lines) {
            for (let i = 0; i < line.length - 1; i++) {
                segs.push([line[i][0] + x, line[i][1], line[i + 1][0] + x, line[i + 1][1]]);
            }
        }
        if (segs.length) laid.push({ x0: x - 0.2, x1: x + g.advance + 0.2, segs });
        segments.push(...segs);
        x += g.advance + TRACKING;
    }
    return { glyphs: laid, segments, width: Math.max(0, x - 0.1) };
}

function segmentDistance(px, py, s) {
    const dx = s[2] - s[0];
    const dy = s[3] - s[1];
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / len2));
    return Math.hypot(px - (s[0] + dx * t), py - (s[1] + dy * t));
}

/**
 * The text as an 8-bit signed-distance field `width × height` (row 0 at the BOTTOM, as a DataTexture maps uv.y = 0): 128 on the
 * stroke's edge, higher inside. The text is centred, its cap height `cap` of the board's height.
 */
export function bakeSignField(text, width = 512, height = 96, { cap = 0.56 } = {}) {
    const { glyphs: laid, width: textWidth } = layoutText(text);
    const em = height * cap;
    const left = (width - textWidth * em) / 2;
    const base = (height - em) / 2 + em * 0.04;
    const out = new Uint8Array(width * height);
    const range = 0.14;
    for (let j = 0; j < height; j++) {
        // Row 0 is the bottom of the board (a DataTexture's first row is at uv.y = 0).
        const py = (j + 0.5 - base) / em;
        for (let i = 0; i < width; i++) {
            const px = (i + 0.5 - left) / em;
            let d = 1e9;
            for (const g of laid) {
                if (px < g.x0 || px > g.x1) continue;
                for (const s of g.segs) d = Math.min(d, segmentDistance(px, py, s));
            }
            const signed = STROKE - d;
            out[j * width + i] = Math.max(0, Math.min(255, Math.round((0.5 + signed / (2 * range)) * 255)));
        }
    }
    return out;
}
