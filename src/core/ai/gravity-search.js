import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { rotateShapeMatrix } from '../game.js';
import { calculateLineClearScore } from '../scoring.js';
import { settleLabelledBoard } from '../stillfall/stillfall-cascade.js';
import { reachableLandings } from '../stillfall/stillfall-reach.js';
import { computeProjectedAttack } from './cascade-simulator.js';

// Joint fit on 77201–77208; both score and attack selected this vector on
// 78401–78412. All values are for this game's cascade and reward rules.
export const GRAVITY_WEIGHTS = Object.freeze({
    balance: 7.4475, density: 0.1853, material: 2.6611, height: 1.1333, danger: 2.8952, holes: 0.9625,
    virtualWaves: 84.2213, virtualLines: 6.4749, virtualGap: 6.3162,
    triggerWaves: 68.0756, triggerLines: 8.1249, unseen: 0.3405,
    score: 0.0197, attack: 6.5905, waves: 9.2633, garbage: 30.7469, effort: 0.1054,
});
const FULL = (1 << COLS) - 1;
const bits = new Uint8Array(FULL + 1);
for (let i = 1; i <= FULL; i++) bits[i] = bits[i >> 1] + (i & 1);

const shapes = new Map();
for (const [key, matrix] of Object.entries(SHAPES)) {
    let shape = matrix;
    const rotations = [];
    for (let rotation = 0; rotation < 4; rotation++) {
        const dx = [], dy = [], offsets = [], masks = [];
        shape.forEach((row, y) => row.forEach((filled, x) => {
            if (!filled) return;
            dx.push(x); dy.push(y); offsets.push(y * COLS + x);
            masks[y] = (masks[y] || 0) | (1 << x);
        }));
        const left = Math.min(...dx), top = Math.min(...dy);
        const footprint = offsets.map(v => v - top * COLS - left).join(',');
        rotations.push({ shape, rotation, dx, dy, offsets, masks, left, right: Math.max(...dx),
            top, footprint, distinct: !rotations.some(r => r.footprint === footprint) });
        shape = rotateShapeMatrix(shape, 'right');
    }
    shapes.set(key, rotations);
}

export function readGravityBoard(grid, first = HIDDEN_ROWS) {
    const cells = new Int32Array(grid.length * COLS);
    const labels = new Map();
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < COLS; x++) {
            const cell = grid[y][x];
            if (!cell) continue;
            const key = cell.id ?? cell;
            if (!labels.has(key)) {
                const garbage = cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE';
                labels.set(key, (labels.size + 1) * (garbage ? -1 : 1));
            }
            cells[y * COLS + x] = labels.get(key);
        }
    }
    return describe(cells, first);
}

// Canonical connectivity and garbage identity. Actual body labels can change after
// a clear or between observations. Equal occupancy alone is insufficient for gravity.
export function gravityBoardKey(cells) {
    const names = new Map();
    let key = '';
    for (const id of cells) {
        if (id && !names.has(id)) names.set(id, (names.size + 1) * Math.sign(id));
        key += String.fromCharCode(32768 + (names.get(id) || 0));
    }
    return key;
}

function describe(cells, first) {
    const height = cells.length / COLS;
    const tops = new Int16Array(COLS).fill(height);
    const counts = new Uint16Array(COLS), rows = new Uint16Array(height);
    let stock = 0, garbage = 0, density = 0, holes = 0, top = height;
    for (let y = height - 1; y >= 0; y--) {
        let mask = 0;
        for (let x = 0; x < COLS; x++) {
            const id = cells[y * COLS + x];
            if (!id) continue;
            mask |= 1 << x; counts[x]++; tops[x] = y; stock++;
            if (id < 0) garbage++;
        }
        if (mask) top = y;
        rows[y] = mask;
        density += bits[mask] ** 2;
    }
    for (let x = 0; x < COLS; x++) holes += height - tops[x] - counts[x];
    return { cells, first, height, tops, counts, rows, top, stock, garbage, density, holes, minimum: Math.min(...counts) };
}

// Non-clearing siblings change only four cells. Reuse the parent's measurements
// instead of scanning all 240 cells at every branch of the beam.
function afterQuietLock(board, cells, form, x, y) {
    const tops = board.tops.slice(), counts = board.counts.slice(), rows = board.rows.slice();
    let { density, holes, top, stock } = board;
    for (let i = 0; i < 4; i++) {
        const column = x + form.dx[i], row = y + form.dy[i];
        if (row < 0) continue;
        density += 2 * bits[rows[row]] + 1;
        rows[row] |= 1 << column;
        holes += Math.max(0, tops[column] - row) - 1;
        tops[column] = Math.min(tops[column], row);
        counts[column]++;
        stock++;
        top = Math.min(top, row);
    }
    return { ...board, cells, tops, counts, rows, stock, top, density, holes, minimum: Math.min(...counts) };
}

function dropY(board, form, x) {
    let y = board.height;
    for (let i = 0; i < 4; i++) y = Math.min(y, board.tops[x + form.dx[i]] - form.dy[i] - 1);
    return y;
}

function completes(board, form, x, y) {
    for (let row = 0; row < form.masks.length; row++) {
        if (!form.masks[row] || y + row < board.first) continue;
        const mask = x < 0 ? form.masks[row] >>> -x : form.masks[row] << x;
        if ((board.rows[y + row] | mask) === FULL) return true;
    }
    return false;
}

function stamp(board, form, x, y, id) {
    const cells = board.cells.slice();
    const origin = y * COLS + x;
    for (const offset of form.offsets) {
        if (origin + offset >= 0) cells[origin + offset] = id;
    }
    return cells;
}

function value(board, weights, pending, virtual) {
    const height = board.height - board.top;
    const pressure = Math.max(0, height + pending - (board.height - board.first - 6));
    if (board.garbage > 0) {
        // Expose the holes in the uppermost surviving garbage row. Extra blocks
        // above its holes cost a real dig, even on an otherwise flat surface.
        let covered = 0;
        for (let y = board.top; y < board.height; y++) {
            const start = y * COLS;
            let marked = false;
            for (let x = 0; x < COLS; x++) if (board.cells[start + x] < 0) marked = true;
            if (!marked) continue;
            for (let x = 0; x < COLS; x++) if (!board.cells[start + x]) {
                for (let iy = board.tops[x]; iy < y; iy++) if (board.cells[iy * COLS + x]) covered++;
            }
            break;
        }
        return -board.garbage * weights.garbage - covered * weights.virtualGap * 2
            - board.stock * weights.material - board.holes * weights.holes - height * weights.height
            - pressure ** 2 * weights.danger;
    }
    let best = 0, tested = 0;
    if (virtual) for (let y = board.height - 1; y >= Math.max(board.first, board.top) && tested < 2; y--) {
        const missing = FULL ^ board.rows[y];
        const gaps = bits[missing];
        if (!gaps || gaps > 3) continue;
        tested++;
        const cells = board.cells.slice();
        for (let x = 0; x < COLS; x++) if (missing & (1 << x)) cells[y * COLS + x] = cells.length + x + 8;
        const waves = settleLabelledBoard(cells, board.first);
        const lines = waves.reduce((sum, n) => sum + n, 0);
        best = Math.max(best, waves.length * weights.virtualWaves + lines * weights.virtualLines - gaps * weights.virtualGap);
    }
    return best + board.minimum * weights.balance + board.density * weights.density + board.stock * weights.material
        - height * weights.height - pressure ** 2 * weights.danger - board.holes * weights.holes
        - board.garbage * weights.garbage;
}

// On a clear skyline, rotating in open air and moving to the target column gives
// a legal hard drop. A high stack or a tuck needs the full movement search.
function skylineLandings(board, key) {
    const placements = [];
    for (const form of shapes.get(key)) {
        if (!form.distinct) continue;
        for (let x = -form.left; x < COLS - form.right; x++) {
            const y = dropY(board, form, x);
            if (y + form.top >= board.first - 2) placements.push({ x, y, rotation: form.rotation, form });
        }
    }
    return placements;
}

function actualLandings(grid, piece) {
    const seen = new Set(), result = [];
    for (const landing of reachableLandings(grid, piece)) {
        const form = shapes.get(piece.shapeKey)[landing.rotation];
        const key = (landing.y + form.top) + '/' + (landing.x + form.left) + '/' + form.footprint;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...landing, form });
    }
    return result;
}

function futureLandings(board, key) {
    if (board.top > board.first + 3) return skylineLandings(board, key);
    const grid = Array.from({ length: board.height }, (_, y) =>
        Array.from(board.cells.subarray(y * COLS, (y + 1) * COLS), id => id || null));
    const shape = SHAPES[key];
    return actualLandings(grid, { shape, shapeKey: key, rotation: 0,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: board.first - 2 });
}

// Test only poses that fill a real row. Every near-complete row must receive
// a cell at its first empty column. Aligning each of the piece's four cells to
// that gap bounds the cost independently of the board width.
export function reachableTrigger(board, known, weights = GRAVITY_WEIGHTS, allowUnknown = true) {
    let best = 0;
    const high = board.top <= board.first + 3;
    const reachable = new Map();
    for (let y = Math.max(board.top, board.first); y < board.height; y++) {
        const missing = FULL ^ board.rows[y];
        if (!missing || bits[missing] > 4) continue;
        const gap = 31 - Math.clz32(missing & -missing);
        for (const [key, rotations] of shapes) {
            const discount = known.includes(key) ? 1 : allowUnknown ? weights.unseen : 0;
            if (!discount) continue;
            for (const form of rotations) {
                if (!form.distinct) continue;
                for (let i = 0; i < 4; i++) {
                    const x = gap - form.dx[i], py = y - form.dy[i];
                    if (x < -form.left || x >= COLS - form.right || py + form.top < board.first - 2) continue;
                    const mask = x < 0 ? form.masks[form.dy[i]] >>> -x : form.masks[form.dy[i]] << x;
                    if ((mask & missing) !== missing || dropY(board, form, x) !== py) continue;
                    if (high) {
                        if (!reachable.has(key)) reachable.set(key, futureLandings(board, key));
                        if (!reachable.get(key).some(p => p.x === x && p.y === py && p.rotation === form.rotation)) continue;
                    }
                    const cells = stamp(board, form, x, py, board.cells.length + 1);
                    const waves = settleLabelledBoard(cells, board.first);
                    const lines = waves.reduce((sum, n) => sum + n, 0);
                    best = Math.max(best, discount * (waves.length ** 2 * weights.triggerWaves + lines * weights.triggerLines));
                }
            }
        }
    }
    return best;
}

export function gravityReward(waves, perfect, context) {
    let level = context.level ?? 1, remaining = context.linesUntilNextLevel ?? 15, score = 0, lines = 0;
    const multiplier = context.comboMultiplierEnabled ? (context.comboMultiplier || 1) : 1;
    for (let i = 0; i < waves.length; i++) {
        const rows = waves[i];
        remaining -= rows; lines += rows;
        if (remaining <= 0) { remaining += 15; if (!context.disableLevelProgression) level++; }
        score += Math.round(calculateLineClearScore(rows, level, i + 1) * multiplier);
    }
    if (perfect && lines) {
        score += Math.round((calculateLineClearScore(lines, level, waves.length, true)
            - calculateLineClearScore(lines, level, waves.length)) * multiplier);
    }
    return { score, lines, attack: computeProjectedAttack(lines, perfect), levelAfter: level, remainingAfter: remaining };
}

function route(node) {
    const result = [];
    for (let p = node; p.move; p = p.parent) result.unshift(p);
    return result;
}

const descending = (a, b) => b.quality - a.quality;

/** A yield is one bounded batch. No shared solver buffer survives it. */
export function* searchGravity(state, config, pending, weights = GRAVITY_WEIGHTS, checkpoint) {
    const grid = state.boardGrid || state.board;
    const start = readGravityBoard(grid);
    const keys = [state.currentPiece.shapeKey, ...state.nextPieces.slice(0, config.previews).map(p => p.shapeKey || p)];
    const initial = { board: start, reward: 0, context: state };
    let beam = [initial], fire = null, attackFire = null, goalFire = null, dig = null, bestRoot = null, alternatives = [];
    const danger = start.top - start.first - pending < (config.safetyMargin || 6);
    const fireFloor = danger ? 1 : start.garbage ? 2 : config.fireWaves;
    const result = (best) => {
        const attack = config.attackStock && start.stock >= config.attackStock && attackFire?.move.attack >= (config.minAttack || 3)
            ? attackFire : null;
        const chosen = goalFire || dig || attack || (fire && fire.move.waves.length >= fireFloor ? fire : best);
        return chosen?.move ? { route: route(chosen), start, danger, pending, alternatives } : null;
    };
    for (let ply = 0; ply < keys.length; ply++) {
        const next = [];
        const key = keys[ply];
        for (const parent of beam) {
            const landings = ply ? futureLandings(parent.board, key) : actualLandings(grid, state.currentPiece);
            yield;
            const siblings = [];
            let count = 0;
            for (const landing of landings) {
                const { form, x, y } = landing;
                const source = parent.board;
                const cells = stamp(source, form, x, y, start.cells.length + 8 + ply);
                const waves = completes(source, form, x, y) ? settleLabelledBoard(cells, source.first) : [];
                const board = waves.length ? describe(cells, source.first) : afterQuietLock(source, cells, form, x, y);
                const paid = gravityReward(waves, !board.stock, parent.context);
                const context = { ...initialContext(state), level: paid.levelAfter, linesUntilNextLevel: paid.remainingAfter,
                    comboCount: waves.length ? (parent.context.comboCount || 0) + 1 : 0 };
                context.comboMultiplier = 1 + context.comboCount * 0.5;
                const reward = parent.reward + paid.score * weights.score + paid.attack * weights.attack
                    + waves.length ** 2 * weights.waves;
                const move = { shapeKey: key, x, y, rotation: form.rotation, actions: landing.actions, waves, ...paid };
                const node = { board, parent, context, reward, move, quality: value(board, weights, pending, config.virtual)
                    + reward - (landing.pathCost || 0) * weights.effort };
                siblings.push(node);
                const goal = config.goal;
                if (goal && !goalFire && ((goal.type === 'combo' && waves.length >= goal.target)
                    || (goal.type === 'cascade' && waves.length >= 2)
                    || (goal.type === 'quads' && waves.some(n => n >= 4))
                    || (goal.type === 'rubble' && board.garbage === 0 && start.garbage > 0))) goalFire = node;
                if (paid.attack && (!attackFire || paid.attack > attackFire.move.attack
                    || (paid.attack === attackFire.move.attack && paid.score > attackFire.move.score))) attackFire = node;
                if (board.garbage < start.garbage && (!dig || board.garbage < dig.board.garbage
                    || (board.garbage === dig.board.garbage && node.quality > dig.quality))) dig = node;
                if (waves.length && (!fire || waves.length > fire.move.waves.length
                    || (waves.length === fire.move.waves.length && node.quality > fire.quality))) fire = node;
                if (++count % 8 === 0) yield;
            }
            siblings.sort(descending);
            if (ply === 0) { alternatives = siblings; checkpoint?.(result(siblings[0])); }
            next.push(...siblings.slice(0, Math.max(6, Math.ceil(config.width / 2))));
        }
        if (!next.length) break;
        next.sort(descending);
        next.length = Math.min(next.length, config.width * 2);
        if (config.trigger) {
            const known = keys.slice(ply + 1);
            for (const node of next) {
                node.quality += reachableTrigger(node.board, known, weights);
                yield;
            }
            next.sort(descending);
        }
        if (ply === 0) bestRoot = next[0];
        beam = next.slice(0, config.width);
        checkpoint?.(result(beam[0]));
    }
    return result(beam[0]?.move ? beam[0] : bestRoot);
}

function initialContext(state) {
    return { disableLevelProgression: state.disableLevelProgression, comboMultiplierEnabled: state.comboMultiplierEnabled };
}
