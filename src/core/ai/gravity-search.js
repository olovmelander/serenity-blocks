import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { rotateShapeMatrix } from '../game.js';
import { calculateLineClearScore } from '../scoring.js';
import { settleLabelledBoard } from '../stillfall/stillfall-cascade.js';
import { reachableLandings, visitReachableLandings } from '../stillfall/stillfall-reach.js';
import { computeProjectedAttack } from './cascade-simulator.js';
import {
    versusCalm, versusContext, versusReward, versusTrigger, versusValue,
} from './versus-evaluation.js';

// Joint fit on 77201–77208; both score and attack selected this vector on
// 78401–78412. All values are for this game's cascade and reward rules.
export const GRAVITY_WEIGHTS = Object.freeze({
    balance: 7.4475,
    density: 0.1853,
    material: 2.6611,
    height: 1.1333,
    danger: 2.8952,
    holes: 0.9625,
    virtualWaves: 84.2213,
    virtualLines: 6.4749,
    virtualGap: 6.3162,
    triggerWaves: 68.0756,
    triggerLines: 8.1249,
    unseen: 0.3405,
    score: 0.0197,
    attack: 6.5905,
    waves: 9.2633,
    garbage: 30.7469,
    effort: 0.1054,
});
const FULL = (1 << COLS) - 1;
// The four central columns cover the spawn footprint of every standard piece.
const SPAWN_LEFT = Math.floor(COLS / 2) - 2;
const bits = new Uint8Array(FULL + 1);
for (let i = 1; i <= FULL; i++) bits[i] = bits[i >> 1] + (i & 1);

const shapes = new Map();
for (const [key, matrix] of Object.entries(SHAPES)) {
    let shape = matrix;
    const rotations = [];
    for (let rotation = 0; rotation < 4; rotation++) {
        const dx = [];
        const dy = [];
        const offsets = [];
        const masks = [];
        shape.forEach((row, y) => row.forEach((filled, x) => {
            if (!filled) return;
            dx.push(x); dy.push(y); offsets.push(y * COLS + x);
            masks[y] = (masks[y] || 0) | (1 << x);
        }));
        const left = Math.min(...dx);
        const top = Math.min(...dy);
        const footprint = offsets.map((v) => v - top * COLS - left).join(',');
        const equivalent = rotations.find((form) => form.footprint === footprint);
        const columnAdds = new Uint8Array(shape[0].length);
        for (const column of dx) columnAdds[column]++;
        rotations.push({
            shape,
            rotation,
            columnAdds,
            dx,
            dy,
            offsets,
            masks,
            left,
            right: Math.max(...dx),
            top,
            footprint,
            equivalentRotation: equivalent?.rotation ?? rotation,
            distinct: !equivalent,
        });
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

function minimumColumnCount(counts) {
    let smallest = counts[0];
    for (let x = 1; x < COLS; x++) smallest = Math.min(smallest, counts[x]);
    return smallest;
}

function describe(cells, first) {
    const height = cells.length / COLS;
    const tops = new Int16Array(COLS).fill(height);
    const counts = new Uint16Array(COLS);
    const rows = new Uint16Array(height);
    let stock = 0;
    let garbage = 0;
    let density = 0;
    let holes = 0;
    let top = height;
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
    return {
        cells,
        first,
        height,
        tops,
        counts,
        rows,
        top,
        stock,
        garbage,
        density,
        holes,
        minimum: minimumColumnCount(counts),
    };
}

// Non-clearing siblings change only four cells. Reuse the parent's measurements
// instead of scanning all 240 cells at every branch of the beam.
function afterQuietLock(board, cells, form, x, y, scratch) {
    const { tops, counts, rows } = scratch;
    tops.set(board.tops); counts.set(board.counts); rows.set(board.rows);
    let {
        density, holes, top, stock,
    } = board;
    for (let i = 0; i < 4; i++) {
        const column = x + form.dx[i];
        const row = y + form.dy[i];
        if (row < 0) continue;
        density += 2 * bits[rows[row]] + 1;
        rows[row] |= 1 << column;
        holes += Math.max(0, tops[column] - row) - 1;
        tops[column] = Math.min(tops[column], row);
        counts[column]++;
        stock++;
        top = Math.min(top, row);
    }
    return {
        cells,
        first: board.first,
        height: board.height,
        tops,
        counts,
        rows,
        top,
        stock,
        garbage: board.garbage,
        density,
        holes,
        minimum: minimumColumnCount(counts),
    };
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

function stamp(board, form, x, y, id, target) {
    const cells = target || new Int32Array(board.cells.length);
    cells.set(board.cells);
    const origin = y * COLS + x;
    for (const offset of form.offsets) {
        if (origin + offset >= 0) cells[origin + offset] = id;
    }
    return cells;
}

function value(board, weights, pending, virtual, probe, supportPlanning) {
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
            for (let x = 0; x < COLS; x++) {
                if (!board.cells[start + x]) {
                    for (let iy = board.tops[x]; iy < y; iy++) if (board.cells[iy * COLS + x]) covered++;
                }
            }
            break;
        }
        return -board.garbage * weights.garbage - covered * weights.virtualGap * 2
            - board.stock * weights.material - board.holes * weights.holes - height * weights.height
            - pressure ** 2 * weights.danger;
    }
    let best = 0;
    let tested = 0;
    if (virtual) {
        for (let y = board.height - 1; y >= Math.max(board.first, board.top) && tested < 2; y--) {
            const missing = FULL ^ board.rows[y];
            const gaps = bits[missing];
            if (!gaps || gaps > 3) continue;
            // A roofed row cannot be triggered by dropping filler into it. The
            // support above it can still release it. Real tucks get scored at lock.
            if (supportPlanning && board.holes) {
                let open = false;
                for (let x = 0; x < COLS && !open; x++) open = Boolean(missing & (1 << x)) && board.tops[x] >= y;
                if (!open) continue;
            }
            tested++;
            // Gravity preserves columns. Every cleared line consumes one cell
            // from each. Filling these gaps guarantees the first line.
            let maxLines = board.minimum + 1;
            for (let x = 0; x < COLS; x++) {
                if (board.counts[x] === board.minimum && !(missing & (1 << x))) { maxLines--; break; }
            }
            const maximum = maxLines * (Math.max(0, weights.virtualWaves) + Math.max(0, weights.virtualLines));
            if (best >= maximum - gaps * weights.virtualGap) continue;
            let capacity = weights.virtualWaves + weights.virtualLines;
            if (maxLines > 1) {
                probe.set(board.cells);
                for (let x = 0; x < COLS; x++) if (missing & (1 << x)) probe[y * COLS + x] = probe.length + x + 8;
                const waves = settleLabelledBoard(probe, board.first, board.top);
                const lines = waves.reduce((sum, n) => sum + n, 0);
                capacity = waves.length * weights.virtualWaves + lines * weights.virtualLines;
            }
            best = Math.max(best, capacity - gaps * weights.virtualGap);
        }
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
            if (y + form.top >= board.first - 2) {
                placements.push({
                    x, y, rotation: form.rotation, form,
                });
            }
        }
    }
    return placements;
}

const landingCache = new Map();
export function gravityLandings(grid, piece) {
    // Movement depends only on occupied cells. Body identity is still required
    // for every cascade result. The cache contains no board evaluations.
    const masks = grid.map((row) => row.reduce((mask, cell, x) => mask | (cell ? 1 << x : 0), 0));
    const key = [piece.shapeKey, piece.x, piece.y, piece.rotation ?? 0, piece.shape.join('/'),
        String.fromCharCode(...masks)].join('|');
    let landings = landingCache.get(key);
    if (!landings) {
        landings = reachableLandings(grid, piece);
        if (landingCache.size >= 48) landingCache.delete(landingCache.keys().next().value);
        landingCache.set(key, landings);
    }
    return landings;
}

// Equal occupied cells can have different origins and rotation numbers. Both
// movement searches keep the first representative reached by the real controls.
function footprintPosition(form, x, y) {
    return ((y + form.top) * COLS + x + form.left) * 4 + form.equivalentRotation;
}

function actualLandings(grid, piece) {
    const seen = new Set();
    const result = [];
    for (const landing of gravityLandings(grid, piece)) {
        const form = shapes.get(piece.shapeKey)[landing.rotation];
        const key = footprintPosition(form, landing.x, landing.y);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...landing, form });
    }
    return result;
}

/**
 * Where a versus seat may set its piece down now: nothing above the spawn rows, and nothing more
 * than a row above where the piece is (kicks can climb a tower a row at a time, and a piece that
 * keeps climbing never lands). dropHere leaves only where it would fall without another key.
 */
export function steadyLandings(landings, piece, first, dropHere) {
    const steady = landings.filter(({ form, y }) => y + form.top >= first - 2 && y >= Math.floor(piece.y) - 1);
    const kept = dropHere
        ? landings.filter(({ actions }) => !actions.some(({ type }) => type === 'move' || type === 'rotate'))
        : steady;
    return kept.length ? kept : landings;
}

function movementGrid(board) {
    board.movementGrid ??= Array.from({ length: board.height }, (_, y) => (
        Array.from(board.cells.subarray(y * COLS, (y + 1) * COLS), (id) => id || null)
    ));
    return board.movementGrid;
}

function futurePiece(board, key) {
    const shape = SHAPES[key];
    return {
        shape,
        shapeKey: key,
        rotation: 0,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: board.first - 2,
    };
}

/**
 * Whether pieces may have to steer near the top. Versus play stands towers on an edge column,
 * which nothing steers past, so only the columns between the edges count there.
 */
export function nearRoof(board, versus) {
    if (!versus) return board.top <= board.first + 3;
    for (let x = 1; x < COLS - 1; x++) if (board.tops[x] <= board.first + 3) return true;
    return false;
}

function futureLandings(board, key, versus) {
    if (!nearRoof(board, versus)) return skylineLandings(board, key);
    return actualLandings(movementGrid(board), futurePiece(board, key));
}

const triggerPositionCache = new Map();
// Only straight drops that fill a row can enter this trigger test. Once the
// control search has encountered each requested footprint, its remaining paths
// cannot change their membership. Body connectivity is read later by the settle.
function reachableTriggersAtRoof(board, key) {
    const cacheKey = `${key}/${board.first}/${String.fromCharCode(...board.rows)}`;
    const cached = triggerPositionCache.get(cacheKey);
    if (cached) return cached;

    const targets = new Set();
    for (const { form, x, y } of skylineLandings(board, key)) {
        if (completes(board, form, x, y)) targets.add(footprintPosition(form, x, y));
    }
    const reached = [];
    if (targets.size) {
        const rotations = shapes.get(key);
        visitReachableLandings(movementGrid(board), futurePiece(board, key), (x, y, rotation) => {
            if (targets.delete(footprintPosition(rotations[rotation], x, y))) reached.push({ x, y, rotation });
            return targets.size === 0;
        });
    }
    if (triggerPositionCache.size >= 48) triggerPositionCache.delete(triggerPositionCache.keys().next().value);
    triggerPositionCache.set(cacheKey, reached);
    return reached;
}

// For each missing-cell mask, the game's own shapes give the same small set
// of horizontal alignments on every board. Check vertical reach on the live board.
const alignmentsByGap = new Map();
function triggerAlignments(missing) {
    if (alignmentsByGap.has(missing)) return alignmentsByGap.get(missing);
    const result = [];
    const gap = 31 - Math.clz32(missing & -missing);
    for (const [key, rotations] of shapes) {
        for (const form of rotations) {
            if (!form.distinct) continue;
            for (let i = 0; i < 4; i++) {
                const x = gap - form.dx[i];
                if (x < -form.left || x >= COLS - form.right) continue;
                const dy = form.dy[i];
                const mask = x < 0 ? form.masks[dy] >>> -x : form.masks[dy] << x;
                if ((mask & missing) === missing) {
                    result.push({
                        key, form, x, dy,
                    });
                }
            }
        }
    }
    alignmentsByGap.set(missing, result);
    return result;
}

function* triggerSteps(board, known, weights, allowUnknown, probe, sliced, observe, node, play = null) {
    let best = 0;
    const high = nearRoof(board, Boolean(play));
    const reachable = new Map();
    let previewShots;
    for (let y = Math.max(board.top, board.first); y < board.height; y++) {
        const missing = FULL ^ board.rows[y];
        if (!missing || bits[missing] > 4) continue;
        for (const {
            key, form, x, dy,
        } of triggerAlignments(missing)) {
            const py = y - dy;
            if (py + form.top < board.first - 2 || dropY(board, form, x) !== py) continue;
            let discount = 1;
            if (!known.includes(key)) discount = allowUnknown ? weights.unseen : 0;
            if (!discount) continue;
            if (high) {
                if (!reachable.has(key)) {
                    reachable.set(key, reachableTriggersAtRoof(board, key));
                    if (sliced) yield;
                }
                if (!reachable.get(key).some((p) => p.x === x && p.y === py && p.rotation === form.rotation)) continue;
            }
            // This reachable placement completes at least one row. A sparse
            // column can prove its exact payout or exclude it from the maximum.
            let maxLines = board.minimum + 4;
            for (let col = 0; col < COLS && maxLines > board.minimum; col++) {
                const count = board.counts[col];
                if (count >= maxLines) continue;
                maxLines = Math.min(maxLines, count + (form.columnAdds[col - x] || 0));
            }
            const maximum = maxLines ** 2 * Math.max(0, weights.triggerWaves)
                + maxLines * Math.max(0, weights.triggerLines);
            const nextPreview = observe && key === known[0] && maxLines > 1;
            if (!play && !nextPreview && discount > 0 && best >= discount * maximum) continue;
            if (nextPreview) {
                // One landing can fill several rows. Inspect it once, even when
                // a later preview already owns the positional upper bound.
                previewShots ??= new Set();
                const position = footprintPosition(form, x, py);
                if (previewShots.has(position)) continue;
                previewShots.add(position);
            }
            if (maxLines === 1) {
                if (!play) best = Math.max(best, discount * (weights.triggerWaves + weights.triggerLines));
                continue;
            }
            stamp(board, form, x, py, board.cells.length + 1, probe);
            const waves = settleLabelledBoard(probe, board.first, Math.max(0, Math.min(board.top, py + form.top)));
            const lines = waves.reduce((sum, n) => sum + n, 0);
            best = Math.max(best, discount * (play ? versusTrigger(play, lines)
                : waves.length ** 2 * weights.triggerWaves + lines * weights.triggerLines));
            if (observe && key === known[0] && waves.length >= 2) observe(node, key, form, x, py, waves, lines);
        }
    }
    return best;
}

export function reachableTrigger(
    board,
    known,
    weights = GRAVITY_WEIGHTS,
    allowUnknown = true,
    probe = new Int32Array(board.cells.length),
) {
    return triggerSteps(board, known, weights, allowUnknown, probe, false).next().value;
}

export function gravityReward(waves, perfect, context) {
    let level = context.level ?? 1;
    let remaining = context.linesUntilNextLevel ?? 15;
    let score = 0;
    let lines = 0;
    const multiplier = context.comboMultiplierEnabled && context.comboMultiplier > 1 ? context.comboMultiplier : 1;
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
    return {
        score, lines, attack: computeProjectedAttack(lines, perfect), levelAfter: level, remainingAfter: remaining,
    };
}

function route(node) {
    const result = [];
    for (let p = node; p.move; p = p.parent) result.unshift(p);
    return result;
}

const descending = (a, b) => b.quality - a.quality;

// Two nearly full floors can accept material falling through a common gap.
// This only allocates attention. An actual reachable lock must prove the payout.
function hasReceivingRows(board) {
    let previous = FULL;
    for (let y = Math.max(board.top, board.first); y < board.height; y++) {
        const gap = FULL ^ board.rows[y];
        if ((gap & previous) && bits[gap] <= 2 && bits[previous] <= 2) return true;
        previous = gap;
    }
    return false;
}

/** A yield is one bounded batch. No shared solver buffer survives it. */
export function* searchGravity(state, config, pending, weights = GRAVITY_WEIGHTS, checkpoint = null, observed = null) {
    const grid = state.boardGrid || state.board;
    const start = observed || readGravityBoard(grid);
    const keys = [state.currentPiece.shapeKey, ...(state.nextPieces || []).slice(0, config.previews)
        .map((p) => (typeof p === 'string' ? p : p?.shapeKey || p?.type)).filter((key) => shapes.has(key))];
    const initial = { board: start, reward: 0, context: state };
    const scratch = {
        cells: new Int32Array(start.cells.length),
        probe: new Int32Array(start.cells.length),
        tops: new Int16Array(COLS),
        counts: new Uint16Array(COLS),
        rows: new Uint16Array(start.height),
    };
    let beam = [initial];
    let fire = null;
    let attackFire = null;
    let dig = null;
    let bestRoot = null;
    let release = null;
    let finish = null;
    let recovery = null;
    let overflowPossible = false;
    let alternatives = [];
    const danger = start.top - start.first - pending < (config.safetyMargin || 6);
    const studyRelease = config.supportPlanning && hasReceivingRows(start);
    const safeFloor = start.garbage ? 2 : config.fireWaves;
    const fireFloor = danger ? 1 : safeFloor;
    const sustained = state.lines >= 8;
    const scoreMode = config.supportPlanning && !config.versus;
    // Versus play (versus-evaluation.js): the whole plan is chosen by rows sent and by what the
    // board has put by. The rules below for digging, firing and finishing are not consulted.
    const play = config.versusPlay || null;
    const calm = play ? versusCalm(start, pending, play) : 0;
    const startContext = play ? versusContext(start) : null;
    const payout = (move) => (config.versus ? move.attack : move.score);
    const qualifiesRelease = (waves, lines, perfect) => waves.length >= 2
        && ((studyRelease && lines - waves[0] >= 2) || perfect);
    const observePreview = (node, key, shape, x, y, waves, lines) => {
        const perfect = node.board.stock + 4 === lines * COLS;
        const strongerFire = waves.length >= fireFloor && (!fire || waves.length > fire.move.waves.length);
        const eligible = qualifiesRelease(waves, lines, perfect);
        if (!strongerFire && !eligible) return;
        const paid = gravityReward(waves, perfect, node.context);
        if (!strongerFire && release && payout(paid) <= payout(release.move)) return;
        const topIndex = scratch.probe.findIndex((id) => id !== 0);
        const top = topIndex < 0 ? start.height : Math.floor(topIndex / COLS);
        const shot = {
            parent: node,
            move: {
                shapeKey: key, x, y, rotation: shape.rotation, waves, ...paid,
            },
            roomAfter: top - start.first,
            quality: node.quality,
        };
        if (strongerFire) fire = shot;
        if (eligible && (!release || payout(paid) > payout(release.move))) release = shot;
    };
    const result = (best) => {
        if (!play && (overflowPossible || finish)) {
            const choice = finish && (!overflowPossible || finish.roomAfter >= pending) ? finish : recovery;
            return {
                route: route(choice), start, danger, pending, alternatives,
            };
        }
        if (config.protectSpawn && best?.move) {
            return {
                route: route(best), start, danger, pending, alternatives,
            };
        }
        if (play) {
            return best?.move ? {
                route: route(best), start, danger, pending, alternatives,
            } : null;
        }
        const ordinaryAttack = config.minAttack ?? (pending || state.lines >= 4 ? 2 : 3);
        const minAttack = sustained ? config.sustainedAttack ?? ordinaryAttack : ordinaryAttack;
        const stock = config.attackStock && (sustained ? config.sustainedStock ?? 24 : config.attackStock);
        const attack = !scoreMode && stock && start.stock >= stock && attackFire?.move.attack >= minAttack
            ? attackFire : null;
        let chosen = dig || attack || (fire && fire.move.waves.length >= fireFloor ? fire : best);
        // Compare a demonstrated second clear with the planned discharge. Both
        // candidates have been settled; a hypothetical trigger cannot win here.
        if (release && !dig && !danger) {
            if (payout(release.move) > payout(chosen.move)) chosen = release;
        }
        return chosen?.move ? {
            route: route(chosen), start, danger, pending, alternatives,
        } : null;
    };
    for (let ply = 0; ply < keys.length; ply++) {
        const next = [];
        const key = keys[ply];
        for (const parent of beam) {
            let landings;
            if (ply) landings = futureLandings(parent.board, key, Boolean(play));
            else landings = actualLandings(grid, state.currentPiece);
            if (!ply && play) landings = steadyLandings(landings, state.currentPiece, start.first, play.dropHere);
            yield;
            const siblings = [];
            // All non-clearing siblings have identical reward and reset the combo.
            const quiet = gravityReward([], false, parent.context);
            const quietContext = {
                disableLevelProgression: state.disableLevelProgression,
                comboMultiplierEnabled: state.comboMultiplierEnabled,
                level: quiet.levelAfter,
                linesUntilNextLevel: quiet.remainingAfter,
                comboCount: 0,
                comboMultiplier: 1,
            };
            let count = 0;
            for (const landing of landings) {
                const { form, x, y } = landing;
                const source = parent.board;
                const label = start.cells.length + 8 + ply;
                const cells = stamp(source, form, x, y, label, scratch.cells);
                const waves = completes(source, form, x, y)
                    ? settleLabelledBoard(cells, source.first, Math.max(0, Math.min(source.top, y + form.top))) : [];
                const board = waves.length ? describe(cells, source.first)
                    : afterQuietLock(source, cells, form, x, y, scratch);
                const paid = waves.length ? gravityReward(waves, !board.stock, parent.context) : quiet;
                const comboCount = (parent.context.comboCount || 0) + 1;
                const context = waves.length ? {
                    ...quietContext,
                    level: paid.levelAfter,
                    linesUntilNextLevel: paid.remainingAfter,
                    comboCount,
                    comboMultiplier: 1 + comboCount * 0.5,
                } : quietContext;
                // Summed in this order: Odyssey's rivals replay to the last rounding.
                const reward = play
                    ? parent.reward + versusReward(play, paid.lines, waves.length > 0 && !board.stock, calm, startContext)
                    : parent.reward + paid.score * weights.score + (scoreMode ? 0 : paid.attack * weights.attack)
                        + waves.length ** 2 * weights.waves;
                const move = {
                    shapeKey: key, x, y, rotation: form.rotation, actions: landing.actions, waves, ...paid,
                };
                // Retain full boards only for roots that survive the immediate cut.
                // Every child can reconstruct its exact labelled lock from its parent.
                let quality;
                if (config.protectSpawn) {
                    const { tops } = board;
                    const lowestCeiling = Math.min(
                        tops[SPAWN_LEFT],
                        tops[SPAWN_LEFT + 1],
                        tops[SPAWN_LEFT + 2],
                        tops[SPAWN_LEFT + 3],
                    );
                    const room = lowestCeiling - (board.first - 2);
                    quality = Math.min(8, room) * weights.virtualWaves - board.holes * weights.holes
                        - (board.height - board.top) * weights.danger + reward;
                } else {
                    quality = (play ? versusValue(board, play, pending, scratch.probe)
                        : value(board, weights, pending, config.virtual, scratch.probe, studyRelease)) + reward;
                }
                const node = {
                    parent,
                    context,
                    reward,
                    move,
                    form,
                    label,
                    garbage: board.garbage,
                    roomAfter: board.top - board.first,
                    quality: quality - (landing.pathCost || 0) * weights.effort,
                };
                siblings.push(node);
                if (config.supportPlanning) {
                    if (!ply && pending && danger) {
                        const room = node.roomAfter - pending;
                        if (room < 0) overflowPossible = true;
                        // Local bursts enter together after the lock. The public
                        // row count proves overflow without revealing the holes.
                        if (!recovery || Math.min(0, room) > Math.min(0, recovery.roomAfter - pending)
                            || (Math.min(0, room) === Math.min(0, recovery.roomAfter - pending) && node.quality > recovery.quality)) {
                            recovery = node;
                        }
                    }
                    if (!ply && paid.attack >= config.finishRows && (!finish || node.quality > finish.quality)) finish = node;
                    if (qualifiesRelease(waves, paid.lines, !board.stock) && (!release || payout(move) > payout(release.move))) release = node;
                }
                if (paid.attack && (!attackFire || paid.attack > attackFire.move.attack
                    || (paid.attack === attackFire.move.attack && paid.score > attackFire.move.score))) {
                    attackFire = node;
                }
                if (board.garbage < start.garbage && (!dig || board.garbage < dig.garbage
                    || (board.garbage === dig.garbage && node.quality > dig.quality))) dig = node;
                if (waves.length && (!fire || waves.length > fire.move.waves.length
                    || (waves.length === fire.move.waves.length && node.quality > fire.quality))) fire = node;
                if (++count % 8 === 0) yield;
            }
            siblings.sort(descending);
            if (ply === 0) {
                alternatives = siblings;
                checkpoint?.(result(siblings[0]));
            } else if (fire || dig || attackFire) {
                checkpoint?.(result(beam[0]));
            }
            if (!play && !ply && (overflowPossible || finish)) return result(siblings[0]);
            next.push(...siblings.slice(0, Math.max(6, Math.ceil(config.width / 2))));
        }
        if (!next.length) break;
        next.sort(descending);
        next.length = Math.min(next.length, config.width * 2);
        const known = keys.slice(ply + 1);
        for (const node of next) {
            const {
                parent, form, label, move,
            } = node;
            const cells = stamp(parent.board, form, move.x, move.y, label);
            if (move.waves.length) {
                settleLabelledBoard(cells, start.first, Math.max(0, Math.min(parent.board.top, move.y + form.top)));
            }
            node.board = describe(cells, start.first);
            if (config.trigger) {
                // A probe for the *next* preview is also a playable continuation.
                // Other shapes only contribute discounted positional value.
                const witness = !play && config.supportPlanning && !pending && known.length ? observePreview : null;
                const trigger = triggerSteps(node.board, known, weights, true, scratch.probe, config.sliceRoofProbes, witness, node, play);
                node.quality += yield* trigger;
                yield;
            }
        }
        if (config.trigger) next.sort(descending);
        if (ply === 0) bestRoot = next[0];
        beam = next.slice(0, config.width);
        checkpoint?.(result(beam[0]));
    }
    return result(beam[0]?.move ? beam[0] : bestRoot);
}
