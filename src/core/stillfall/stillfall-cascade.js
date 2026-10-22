// @ts-check

/**
 * The cascade resolver's answer for a Stillfall lock, fast: the bodies after every wave, how
 * many waves and how many lines (cascade-resolver.js resolveCascade's lockedPiecesAfter,
 * boardAfter, cascadeCount and linesClearedThisTurn), without the scoring, hole masks and
 * animation steps a puzzle never reads, on typed arrays.
 *
 * The solver resolves millions of locks to prove that a five-piece puzzle on a tall tower has
 * one way in; through resolveCascade that took minutes a puzzle, and this is what lets CI do
 * it on every run. It follows the resolver step for step: the full rows found bottom-up from
 * the first visible row, cleared cells removed in place, the board split into same-id
 * fragments in reading order (two fragments of one body that touch fuse again), and the
 * settle passes over a bottom-edge-descending order sorted once (stably), each fragment that
 * can fall moving one row, until a pass moves nothing. tests/unit/stillfall-cascade.test.js
 * holds it to resolveCascade lock for lock (every lock in search trees over the bank, and
 * random boards), and the certifier still replays every solution through the real resolver
 * and the live game.
 *
 * resolveStillfallCascade returns the bodies as the resolver does; stillfallCascadeCells only
 * the body id in each cell, which is all the solver needs to judge a last piece. The solver
 * tries every place for one last piece on one board before it moves on, so a board can be
 * loaded once (loadCascadeBase) and each lock played on a copy of it (cascadeCellsOnBase).
 */

import { COLS, COLORS, HIDDEN_ROWS } from '../constants.js';

/** @typedef {import('./stillfall-puzzle.js').LockedBody} LockedBody */

/**
 * A body as the cascade reads it: a puzzle body, or a dealt piece, which carries no colour of
 * its own (the board gives it its shapeKey's).
 * @typedef {{ x: number, y: number, shape: number[][], pieceId: number, shapeKey: string,
 *   type?: string, color?: string }} CascadeBody
 */

/**
 * @typedef {Object} StillfallCascade
 * @property {number} cascadeCount waves
 * @property {number} linesClearedThisTurn
 * @property {LockedBody[]} lockedPiecesAfter as resolveCascade returns them, in its order
 * @property {Array<Array<{ color: string, id: number, type: string } | null>>} boardAfter
 */

/**
 * @typedef {Object} StillfallCascadeCells
 * @property {number} cascadeCount waves
 * @property {number} linesClearedThisTurn
 * @property {Int32Array} cells the body id in each cell after the cascade (0 empty), row by row:
 *   a view of a scratch buffer, to read before the next call
 */

// Scratch buffers, grown on demand and reused: the resolver is synchronous and never re-entered.
let size = 0;
/** Body id per cell (0 empty). */
let ids = new Int32Array(0);
/** The cell's look (an index into LOOKS) as the board grid would hold it. */
let lookOf = new Int32Array(0);
/** Fragment per cell, 1-based (0 empty), while the fragments settle. */
let owner = new Int32Array(0);
/** The split a cell was last visited in. */
let seen = new Int32Array(0);
let stack = new Int32Array(0);
/** Every fragment's cells, at their positions when the split made them. */
let cells = new Int32Array(0);
// The fragments of the last split, in reading order.
let fragId = new Int32Array(0);
let fragLook = new Int32Array(0);
let fragStart = new Int32Array(0);
let fragCount = new Int32Array(0);
let fragTop = new Int32Array(0);
let fragBottom = new Int32Array(0);
let fragLeft = new Int32Array(0);
let fragRight = new Int32Array(0);
let fragFall = new Int32Array(0);
let order = new Int32Array(0);
let fragments = 0;
let stamp = 0;
/** The board loadCascadeBase loaded, and its height (0: none). */
let baseIds = new Int32Array(0);
let baseLooks = new Int32Array(0);
let baseHeight = 0;

function ensure(/** @type {number} */ count) {
    if (count <= size) return;
    size = count;
    ids = new Int32Array(count);
    lookOf = new Int32Array(count);
    owner = new Int32Array(count);
    seen = new Int32Array(count);
    stack = new Int32Array(count);
    cells = new Int32Array(count);
    fragId = new Int32Array(count);
    fragLook = new Int32Array(count);
    fragStart = new Int32Array(count);
    fragCount = new Int32Array(count);
    fragTop = new Int32Array(count);
    fragBottom = new Int32Array(count);
    fragLeft = new Int32Array(count);
    fragRight = new Int32Array(count);
    fragFall = new Int32Array(count);
    order = new Int32Array(count);
    stamp = 0;
}

/** Every colour and type pair a cell has held: a handful (the piece colours), kept for good. */
const LOOKS = /** @type {Array<{ color: string, type: string }>} */ ([]);
/** @type {Map<string, Map<string, number>>} colour → type → index in LOOKS */
const LOOK_INDEX = new Map();

function lookIndex(/** @type {string} */ color, /** @type {string} */ type) {
    let byType = LOOK_INDEX.get(color);
    if (!byType) {
        byType = new Map();
        LOOK_INDEX.set(color, byType);
    }
    let index = byType.get(type);
    if (index === undefined) {
        index = LOOKS.length;
        LOOKS.push({ color, type });
        byType.set(type, index);
    }
    return index;
}

/**
 * Writes a body into the scratch board as the resolver's board holds it: its id in each of its
 * cells (a later body overwrites an earlier one's), with the colour and type
 * rebuildBoardGridFromPieces gives it. Every Stillfall body carries a pieceId from 1 up, so
 * the board holds ids, never a shapeKey.
 * @param {CascadeBody} piece
 * @param {number} boardHeight
 */
function write(piece, boardHeight) {
    const id = piece.pieceId;
    const look = lookIndex(piece.color || piece.shapeKey, piece.type || piece.shapeKey);
    const { shape } = piece;
    for (let localY = 0; localY < shape.length; localY += 1) {
        const row = shape[localY];
        const y = Math.floor(piece.y + localY);
        if (y < 0 || y >= boardHeight) continue;
        for (let localX = 0; localX < row.length; localX += 1) {
            const x = piece.x + localX;
            if (row[localX] > 0 && x >= 0 && x < COLS) {
                ids[y * COLS + x] = id;
                lookOf[y * COLS + x] = look;
            }
        }
    }
}

/**
 * Loads the bodies into the scratch board.
 * @param {CascadeBody[]} lockedPieces not mutated
 * @param {number} boardHeight
 */
function load(lockedPieces, boardHeight) {
    ensure(boardHeight * COLS);
    ids.fill(0, 0, boardHeight * COLS);
    for (const piece of lockedPieces) write(piece, boardHeight);
}

/**
 * Plays the cascade on the scratch board: `ids` then holds the board after it, the fragment
 * arrays the last split's fragments (when it cleared anything).
 * @param {number} boardHeight
 * @returns {{ cascadeCount: number, linesClearedThisTurn: number }}
 */
function settle(boardHeight) {
    const total = boardHeight * COLS;
    let cascadeCount = 0;
    let linesClearedThisTurn = 0;
    fragments = 0;
    for (;;) {
        // detectFullLines: bottom-up, never the hidden rows.
        let cleared = 0;
        for (let y = boardHeight - 1; y >= HIDDEN_ROWS; y -= 1) {
            const base = y * COLS;
            let full = true;
            for (let x = 0; x < COLS && full; x += 1) full = ids[base + x] !== 0;
            if (!full) continue;
            cleared += 1;
            ids.fill(0, base, base + COLS); // removeClearedLines: the survivors keep their cells
        }
        if (cleared === 0) break;
        cascadeCount += 1;
        linesClearedThisTurn += cleared;

        // findConnectedComponents: same-id groups in reading order, each with its first cell's
        // look made the component's own (its type, else its colour; its colour, else the type's).
        stamp += 1;
        fragments = 0;
        let used = 0;
        owner.fill(0, 0, total);
        for (let start = 0; start < total; start += 1) {
            const id = ids[start];
            if (id === 0 || seen[start] === stamp) continue;
            seen[start] = stamp;
            const fragment = fragments;
            fragments += 1;
            let depth = 0;
            stack[depth++] = start;
            let top = boardHeight;
            let bottom = -1;
            let left = COLS;
            let right = -1;
            const first = used;
            while (depth > 0) {
                const cell = stack[--depth];
                cells[used++] = cell;
                owner[cell] = fragment + 1;
                const y = (cell / COLS) | 0;
                const x = cell - y * COLS;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y > 0 && ids[cell - COLS] === id && seen[cell - COLS] !== stamp) {
                    seen[cell - COLS] = stamp;
                    stack[depth++] = cell - COLS;
                }
                if (y < boardHeight - 1 && ids[cell + COLS] === id && seen[cell + COLS] !== stamp) {
                    seen[cell + COLS] = stamp;
                    stack[depth++] = cell + COLS;
                }
                if (x > 0 && ids[cell - 1] === id && seen[cell - 1] !== stamp) {
                    seen[cell - 1] = stamp;
                    stack[depth++] = cell - 1;
                }
                if (x < COLS - 1 && ids[cell + 1] === id && seen[cell + 1] !== stamp) {
                    seen[cell + 1] = stamp;
                    stack[depth++] = cell + 1;
                }
            }
            const look = LOOKS[lookOf[start]];
            const type = look.type || look.color;
            fragId[fragment] = id;
            fragLook[fragment] = lookIndex(look.color || COLORS[type] || '#808080', type);
            fragStart[fragment] = first;
            fragCount[fragment] = used - first;
            fragTop[fragment] = top;
            fragBottom[fragment] = bottom;
            fragLeft[fragment] = left;
            fragRight[fragment] = right;
            fragFall[fragment] = 0;
        }

        // settleGravity: the bottom-edge-descending order is taken once, ties in reading order
        // (the resolver's sort is stable), here a counting sort.
        let placed = 0;
        for (let edge = boardHeight - 1; edge >= 0; edge -= 1) {
            for (let fragment = 0; fragment < fragments; fragment += 1) {
                if (fragBottom[fragment] === edge) order[placed++] = fragment;
            }
        }
        let falling = true;
        while (falling) {
            falling = false;
            for (let k = 0; k < fragments; k += 1) {
                const fragment = order[k];
                const start = fragStart[fragment];
                const end = start + fragCount[fragment];
                const shift = fragFall[fragment] * COLS;
                const self = fragment + 1;
                let canFall = true;
                for (let c = start; c < end && canFall; c += 1) {
                    const below = cells[c] + shift + COLS;
                    if (below >= total || (owner[below] !== 0 && owner[below] !== self)) canFall = false;
                }
                if (!canFall) continue;
                for (let c = start; c < end; c += 1) owner[cells[c] + shift] = 0;
                for (let c = start; c < end; c += 1) owner[cells[c] + shift + COLS] = self;
                fragFall[fragment] += 1;
                falling = true;
            }
        }

        // The board the next wave reads: each fragment's cells where it came to rest.
        ids.fill(0, 0, total);
        for (let fragment = 0; fragment < fragments; fragment += 1) {
            const start = fragStart[fragment];
            const end = start + fragCount[fragment];
            const shift = fragFall[fragment] * COLS;
            const id = fragId[fragment];
            const look = fragLook[fragment];
            for (let c = start; c < end; c += 1) {
                ids[cells[c] + shift] = id;
                lookOf[cells[c] + shift] = look;
            }
        }
    }
    return { cascadeCount, linesClearedThisTurn };
}

/**
 * @param {CascadeBody[]} lockedPieces the bodies before the lock and the locked piece (not mutated)
 * @param {number} boardHeight
 * @returns {StillfallCascade}
 */
export function resolveStillfallCascade(lockedPieces, boardHeight) {
    load(lockedPieces, boardHeight);
    const { cascadeCount, linesClearedThisTurn } = settle(boardHeight);
    /** @type {LockedBody[]} */
    const lockedPiecesAfter = [];
    if (cascadeCount === 0) {
        // As the resolver returns them: copies, a dealt piece still without a colour of its own.
        for (const piece of lockedPieces) {
            const copy = { ...piece, shape: piece.shape.map((row) => row.slice()) };
            lockedPiecesAfter.push(/** @type {LockedBody} */ (copy));
        }
    } else {
        for (let fragment = 0; fragment < fragments; fragment += 1) {
            const top = fragTop[fragment];
            const left = fragLeft[fragment];
            const width = fragRight[fragment] - left + 1;
            const shape = [];
            for (let y = top; y <= fragBottom[fragment]; y += 1) shape.push(new Array(width).fill(0));
            const start = fragStart[fragment];
            for (let c = start; c < start + fragCount[fragment]; c += 1) {
                const y = (cells[c] / COLS) | 0;
                shape[y - top][cells[c] - y * COLS - left] = 1;
            }
            const { type, color } = LOOKS[fragLook[fragment]];
            lockedPiecesAfter.push(/** @type {LockedBody} */ ({
                x: left,
                y: top + fragFall[fragment],
                shape,
                shapeKey: type,
                type,
                color,
                pieceId: fragId[fragment],
            }));
        }
    }

    // rebuildBoardGridFromPieces on the bodies after: after a cascade the cells say it already
    // (a component's cells all hold its id and look; bodies never overlap).
    /** @type {Array<Array<{ color: string, id: number, type: string } | null>>} */
    const boardAfter = [];
    for (let y = 0; y < boardHeight; y += 1) boardAfter.push(new Array(COLS).fill(null));
    if (cascadeCount === 0) {
        for (const piece of lockedPiecesAfter) {
            const color = piece.color || piece.shapeKey;
            const type = piece.type || piece.shapeKey;
            piece.shape.forEach((row, localY) => row.forEach((cell, localX) => {
                const y = Math.floor(piece.y + localY);
                const x = piece.x + localX;
                if (cell > 0 && y >= 0 && y < boardHeight && x >= 0 && x < COLS) {
                    boardAfter[y][x] = { color, id: piece.pieceId, type };
                }
            }));
        }
    } else {
        for (let cell = 0; cell < boardHeight * COLS; cell += 1) {
            if (ids[cell] === 0) continue;
            const { color, type } = LOOKS[lookOf[cell]];
            const y = (cell / COLS) | 0;
            boardAfter[y][cell - y * COLS] = { color, id: ids[cell], type };
        }
    }
    return {
        cascadeCount, linesClearedThisTurn, lockedPiecesAfter, boardAfter,
    };
}

/**
 * The cascade's waves, lines and the body id in each cell after it, without building bodies.
 * The cells are a view of a scratch buffer: read them before the next call.
 * @param {CascadeBody[]} lockedPieces the bodies before the lock and the locked piece (not mutated)
 * @param {number} boardHeight
 * @returns {StillfallCascadeCells}
 */
export function stillfallCascadeCells(lockedPieces, boardHeight) {
    load(lockedPieces, boardHeight);
    const { cascadeCount, linesClearedThisTurn } = settle(boardHeight);
    return { cascadeCount, linesClearedThisTurn, cells: ids.subarray(0, boardHeight * COLS) };
}

/**
 * Loads a board once, to play many different locks on it (cascadeCellsOnBase), until the next
 * load: one board at a time.
 * @param {CascadeBody[]} lockedPieces not mutated
 * @param {number} boardHeight
 */
export function loadCascadeBase(lockedPieces, boardHeight) {
    load(lockedPieces, boardHeight);
    const total = boardHeight * COLS;
    if (baseIds.length < total) {
        baseIds = new Int32Array(total);
        baseLooks = new Int32Array(total);
    }
    baseIds.set(ids.subarray(0, total));
    baseLooks.set(lookOf.subarray(0, total));
    baseHeight = boardHeight;
}

/**
 * stillfallCascadeCells for the loaded base's bodies and one more piece, on a copy of the base.
 * The cells are a view of a scratch buffer: read them before the next call.
 * @param {CascadeBody} piece the lock
 * @returns {StillfallCascadeCells}
 */
export function cascadeCellsOnBase(piece) {
    if (baseHeight === 0) throw new Error('[Stillfall] No cascade base is loaded');
    const total = baseHeight * COLS;
    ids.set(baseIds.subarray(0, total));
    lookOf.set(baseLooks.subarray(0, total));
    write(piece, baseHeight);
    const { cascadeCount, linesClearedThisTurn } = settle(baseHeight);
    return { cascadeCount, linesClearedThisTurn, cells: ids.subarray(0, total) };
}
