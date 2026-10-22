/**
 * @fileoverview A supply piece as a small glyph, as it spawns: the puzzle atlas shows a puzzle's
 * supply with them (stillfall-atlas.js), and the panel beside the well shows a supply longer than
 * the queue can (stillfall-hud.js). Each piece is one solid shape, as the queue and the board
 * draw it: an SVG polygon round its cells' outline, never four separate squares. Each surface
 * sizes and colours its own class (the polygon fills with `currentColor`).
 */

/** Each piece as it spawns. */
export const PIECE_ROWS = Object.freeze({
    I: ['####'],
    O: ['##', '##'],
    T: ['.#.', '###'],
    S: ['.##', '##.'],
    Z: ['##.', '.##'],
    J: ['#..', '###'],
    L: ['..#', '###'],
});

/**
 * The outline of a shape's cells as polygon corners, in cell units: each cell's edges run
 * clockwise, an edge two cells share cancels out, and the rest chain into one loop (a
 * tetromino has no holes), with straight runs merged into one side.
 * @param {string[]} rows '#' for a cell
 * @returns {Array<[number, number]>}
 */
export function shapeOutline(rows) {
    /** @type {Set<string>} each cell edge as `from>to`; an edge two cells share cancels out */
    const edges = new Set();
    const add = (/** @type {string} */ from, /** @type {string} */ to) => {
        if (edges.has(`${to}>${from}`)) edges.delete(`${to}>${from}`);
        else edges.add(`${from}>${to}`);
    };
    rows.forEach((row, y) => [...row].forEach((mark, x) => {
        if (mark !== '#') return;
        add(`${x},${y}`, `${x + 1},${y}`);
        add(`${x + 1},${y}`, `${x + 1},${y + 1}`);
        add(`${x + 1},${y + 1}`, `${x},${y + 1}`);
        add(`${x},${y + 1}`, `${x},${y}`);
    }));
    // The outer edges, each corner to the next (a tetromino's corners each start one).
    const next = new Map([...edges].map((edge) => /** @type {[string, string]} */ (edge.split('>'))));
    const start = /** @type {string} */ (next.keys().next().value);
    /** @type {Array<[number, number]>} */
    const corners = [];
    let at = start;
    do {
        corners.push(/** @type {[number, number]} */ (at.split(',').map(Number)));
        at = /** @type {string} */ (next.get(at));
    } while (at !== start && corners.length <= next.size);
    // Keep the corners where the outline turns.
    return corners.filter((point, index) => {
        const before = corners[(index + corners.length - 1) % corners.length];
        const after = corners[(index + 1) % corners.length];
        return (point[0] - before[0]) * (after[1] - point[1]) !== (point[1] - before[1]) * (after[0] - point[0]);
    });
}

/** Each piece's glyph markup inside its span, built once. */
const GLYPHS = new Map();

function glyphSvg(/** @type {string} */ key) {
    let svg = GLYPHS.get(key);
    if (!svg) {
        const rows = PIECE_ROWS[/** @type {keyof typeof PIECE_ROWS} */ (key)] || PIECE_ROWS.O;
        const points = shapeOutline(rows).map(([x, y]) => `${x},${y}`).join(' ');
        svg = `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" aria-hidden="true" focusable="false">`
            + `<polygon points="${points}"/></svg>`;
        GLYPHS.set(key, svg);
    }
    return svg;
}

/**
 * @param {string} key a piece letter
 * @param {string} className the surface's class for a glyph
 * @param {string} [state] an extra class: where the piece stands in the supply
 */
export function pieceGlyphHtml(key, className, state = '') {
    const rows = PIECE_ROWS[/** @type {keyof typeof PIECE_ROWS} */ (key)] || PIECE_ROWS.O;
    const classes = state ? `${className} ${state}` : className;
    const size = `--piece-cols:${rows[0].length};--piece-rows:${rows.length}`;
    return `<span class="${classes}" style="${size}" title="${key}">${glyphSvg(key)}</span>`;
}
