// What a board looks like, in the terms the playbook uses: tall columns, rows one cell short,
// roofed shafts and the straights parked on them. Boards are labelled cells (garbage negative),
// with the piece kind of each body kept beside them.
import { COLS, HIDDEN_ROWS, SHAPES } from '../../src/core/constants.js';
import { rotateShapeMatrix } from '../../src/core/game.js';
import { settleLabelledBoard } from '../../src/core/stillfall/stillfall-cascade.js';

const forms = new Map(Object.entries(SHAPES).map(([key, matrix]) => {
    const list = [];
    const seen = new Set();
    let shape = matrix;
    for (let rotation = 0; rotation < 4; rotation++) {
        const cells = shape.flatMap((row, y) => row.flatMap((v, x) => (v ? [[y, x]] : [])));
        const top = Math.min(...cells.map(([y]) => y));
        const left = Math.min(...cells.map(([, x]) => x));
        const name = cells.map(([y, x]) => `${y - top},${x - left}`).join(' ');
        if (!seen.has(name)) {
            seen.add(name);
            list.push(cells.map(([y, x]) => [y - top, x - left]));
        }
        shape = rotateShapeMatrix(shape, 'right');
    }
    return [key, list];
}));

export function readBoard(grid) {
    const cells = new Int32Array(grid.length * COLS);
    const kinds = new Map();
    const ids = new Map();
    grid.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell) return;
        const key = cell.id ?? cell;
        const garbage = cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE';
        if (!ids.has(key)) {
            ids.set(key, (ids.size + 1) * (garbage ? -1 : 1));
            kinds.set(ids.get(key), cell.type);
        }
        cells[y * COLS + x] = ids.get(key);
    }));
    return { cells, kinds, height: grid.length };
}

export function heights({ cells, height }) {
    return Array.from({ length: COLS }, (_, x) => {
        let y = 0;
        while (y < height && !cells[y * COLS + x]) y++;
        return height - y;
    });
}

export function covered({ cells, height }) {
    let n = 0;
    for (let x = 0; x < COLS; x++) {
        let roof = false;
        for (let y = 0; y < height; y++) {
            if (cells[y * COLS + x]) roof = true;
            else if (roof) n++;
        }
    }
    return n;
}

export function garbageRows({ cells, height }) {
    let n = 0;
    for (let y = 0; y < height; y++) {
        let g = 0;
        for (let x = 0; x < COLS; x++) if (cells[y * COLS + x] < 0) g++;
        if (g >= 5) n++;
    }
    return n;
}

/** Per column: the rows whose only gap it is, whether something covers the gap, straights standing over it. */
export function shafts({ cells, kinds, height }) {
    const gaps = new Map();
    for (let y = 0; y < height; y++) {
        let at = -1;
        let n = 0;
        for (let x = 0; x < COLS; x++) {
            if (!cells[y * COLS + x]) { at = x; n++; }
        }
        if (n === 1) gaps.set(at, [...gaps.get(at) ?? [], y]);
    }
    return [...gaps].map(([col, rows]) => {
        const top = Math.min(...rows);
        let roof = top - 1;
        while (roof >= 0 && !cells[roof * COLS + col]) roof--;
        let straights = 0;
        for (let y = roof; y >= 0;) {
            const id = cells[y * COLS + col];
            if (!id) break;
            let end = y;
            while (end > 0 && cells[(end - 1) * COLS + col] === id) end--;
            if (id > 0 && kinds.get(id) === 'I' && y - end >= 2) straights++;
            y = end - 1;
        }
        return { col, rows: rows.length, roofed: roof >= 0, straights };
    }).sort((a, b) => b.rows - a.rows);
}

/** The most rows any straight drop of this piece would clear at once. */
export function bestClear({ cells, height }, key) {
    let best = 0;
    for (const form of forms.get(key)) {
        const right = Math.max(...form.map(([, x]) => x));
        for (let col = 0; col + right < COLS; col++) {
            const fits = (at) => form.every(([dy, dx]) => at + dy < height && !cells[(at + dy) * COLS + col + dx]);
            let y = 0;
            if (!fits(y)) continue;
            while (fits(y + 1)) y++;
            const copy = Int32Array.from(cells);
            for (const [dy, dx] of form) copy[(y + dy) * COLS + col + dx] = 1 << 24;
            const full = form.some(([dy]) => {
                for (let x = 0; x < COLS; x++) if (!copy[(y + dy) * COLS + x]) return false;
                return true;
            });
            if (full) best = Math.max(best, settleLabelledBoard(copy, HIDDEN_ROWS).reduce((t, n) => t + n, 0));
        }
    }
    return best;
}
