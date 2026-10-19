// @ts-check

/**
 * Pure Stillfall simulation: deal the next piece, list every landing the real controls
 * can reach, lock one, and resolve its cascade with the same resolver the game is
 * differential-tested against (cascade-resolver.js). Nothing here writes a GameState;
 * every step returns a new run.
 */

import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { createBoardGrid, invalidateGhostCache, rebuildBoardGridFromPieces } from '../board.js';
import { canPlacePiece, rotateShapeMatrix } from '../game.js';
import { resolveCascade } from '../cascade-resolver.js';
import { reachableLandings } from './stillfall-reach.js';
import { STILLFALL_BOARD_HEIGHT, goalParts } from './stillfall-puzzle.js';

/** @typedef {import('./stillfall-puzzle.js').StillfallPuzzle} StillfallPuzzle */
/** @typedef {import('./stillfall-puzzle.js').StillfallGoal} StillfallGoal */
/** @typedef {import('./stillfall-puzzle.js').LockedBody} LockedBody */

/**
 * @typedef {Object} StillfallRun
 * @property {StillfallPuzzle} puzzle
 * @property {LockedBody[]} lockedPieces
 * @property {number} dealt how many supply pieces have been locked
 * @property {number} nextPieceId
 * @property {number} lines lines cleared so far
 * @property {number} bestWaves deepest cascade from one lock so far
 * @property {'open'|'solved'|'failed'} outcome
 */

/**
 * @typedef {Object} StillfallPlacement
 * @property {string} shapeKey
 * @property {number[][]} shape
 * @property {number} rotation
 * @property {number} x
 * @property {number} y
 * @property {Array<{type: string, dir?: number|string}>} actions from spawn, before the hard drop
 * @property {string} footprint sorted landing cells, `x,y` joined by ';'
 */

/**
 * @param {StillfallPuzzle} puzzle
 * @returns {StillfallRun}
 */
export function createRun(puzzle) {
    return {
        puzzle,
        lockedPieces: clonePieces(puzzle.lockedPieces),
        dealt: 0,
        nextPieceId: puzzle.nextPieceId,
        lines: 0,
        bestWaves: 0,
        outcome: 'open',
    };
}

/** The supply piece in hand, or null once the supply is spent. */
export function currentShapeKey(/** @type {StillfallRun} */ run) {
    return run.puzzle.supply[run.dealt] ?? null;
}

/**
 * The row a dealt piece waits on. The game spawns pieces in the hidden rows above the
 * well and lets gravity bring them into view; gravity waits here, so the mode lowers
 * each dealt piece to the first visible row instead (dealIntoView).
 */
export const DEAL_ROW = HIDDEN_ROWS;

/**
 * A dealt piece as the live game places it: game.js createActivePiece's column and spawn
 * row, lowered to DEAL_ROW when the board leaves that row free (dealIntoView). A board
 * that blocks the spawn row itself blocks the deal, and listPlacements finds nothing.
 * @param {string} shapeKey
 * @param {Array<Array<unknown>>} [boardGrid]
 */
export function spawnPiece(shapeKey, boardGrid) {
    const shape = SHAPES[shapeKey].map((row) => row.slice());
    const piece = {
        shapeKey,
        type: shapeKey,
        shape,
        rotation: 0,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: HIDDEN_ROWS - 2,
    };
    if (boardGrid && fits(boardGrid, piece, piece.x, DEAL_ROW)) piece.y = DEAL_ROW;
    return piece;
}

/** The pathfinder's placement test, for the deal row. */
function fits(boardGrid, piece, atX, atY) {
    return piece.shape.every((row, localY) => row.every((cell, localX) => {
        if (cell <= 0) return true;
        const x = atX + localX;
        const y = atY + localY;
        if (x < 0 || x >= COLS || y >= boardGrid.length) return false;
        return y < 0 || boardGrid[y][x] === null;
    }));
}

/**
 * Lowers the piece the game just spawned onto DEAL_ROW, where the player can see it.
 * @param {{ currentPiece: { x: number, y: number } | null }} gameState a live GameState
 */
export function dealIntoView(gameState) {
    const piece = gameState?.currentPiece;
    if (!piece || piece.y >= DEAL_ROW || !canPlacePiece(gameState, piece, piece.x, DEAL_ROW)) return;
    piece.y = DEAL_ROW;
    invalidateGhostCache(gameState);
}

/**
 * The board grid a run's bodies occupy.
 * @param {LockedBody[]} lockedPieces
 */
export function boardFor(lockedPieces) {
    return rebuildBoardGridFromPieces(lockedPieces, createBoardGrid());
}

/** Each run's board, built once: by the cascade that made the run, or on first ask. */
const RUN_BOARDS = new WeakMap();

/**
 * A run's board grid, shared: read it, never write it.
 * @param {StillfallRun} run
 * @returns {Array<Array<{ id: unknown, type: string, color: string } | null>>}
 */
export function boardOf(run) {
    let grid = RUN_BOARDS.get(run);
    if (!grid) {
        grid = boardFor(run.lockedPieces);
        RUN_BOARDS.set(run, grid);
    }
    return grid;
}

/**
 * Every distinct landing for the piece in hand. Landings that fill the same cells are one
 * outcome; the cheapest input path is kept. The search is the bot pathfinder's
 * (stillfall-reach.js mirrors findReachablePlacements, and a test holds it to it).
 * @param {StillfallRun} run
 * @returns {StillfallPlacement[]}
 */
export function listPlacements(run) {
    const shapeKey = currentShapeKey(run);
    if (!shapeKey || run.outcome !== 'open') return [];
    const boardGrid = boardOf(run);
    const placements = reachableLandings(boardGrid, spawnPiece(shapeKey, boardGrid));
    // The landings are this call's own objects (shape and path included), so they are kept
    // as they come rather than copied.
    /** @type {Map<string, { placement: StillfallPlacement, pathCost: number }>} */
    const byFootprint = new Map();
    for (const landing of placements) {
        const footprint = footprintOf(landing);
        const existing = byFootprint.get(footprint);
        if (!existing || landing.pathCost < existing.pathCost) {
            byFootprint.set(footprint, {
                placement: {
                    shapeKey,
                    shape: landing.shape,
                    rotation: landing.rotation ?? 0,
                    x: landing.x,
                    y: landing.y,
                    actions: landing.actions,
                    footprint,
                },
                pathCost: landing.pathCost,
            });
        }
    }
    return [...byFootprint.values()]
        .map((entry) => entry.placement)
        .sort((a, b) => (a.footprint < b.footprint ? -1 : 1));
}

/**
 * Locks a placement and resolves its cascade.
 * @param {StillfallRun} run
 * @param {StillfallPlacement} placement
 * @returns {{ run: StillfallRun, resolution: ReturnType<typeof resolveCascade> }}
 */
export function applyPlacement(run, placement) {
    const locked = lockedBodyFor(run, placement);
    const lockFootprint = cellsOf(locked).map(([x, y]) => ({ x, y }));
    const manualColumns = [...new Set(lockFootprint.map((cell) => cell.x))].sort((a, b) => a - b);
    const resolution = resolveCascade([...run.lockedPieces, locked], {
        boardHeight: STILLFALL_BOARD_HEIGHT,
        level: 1,
        lines: run.lines,
        linesUntilNextLevel: 15,
        disableLevelProgression: true,
        comboState: {
            lockFootprint, manualColumns, depth: 0, complexity: 0,
        },
        lastPlacedPieceX: manualColumns,
    });

    /** @type {StillfallRun} */
    const next = {
        ...run,
        lockedPieces: resolution.lockedPiecesAfter,
        dealt: run.dealt + 1,
        nextPieceId: run.nextPieceId + 1,
        lines: run.lines + resolution.linesClearedThisTurn,
        bestWaves: Math.max(run.bestWaves, resolution.cascadeCount),
    };
    next.outcome = judge(next);
    RUN_BOARDS.set(next, resolution.boardAfter);
    return { run: next, resolution };
}

/**
 * The body a placement locks as: the next piece id, the piece's own colour.
 * @param {StillfallRun} run
 * @param {{ shapeKey: string, x: number, y: number, shape: number[][], rotation: number }} placement
 */
function lockedBodyFor(run, placement) {
    if (run.outcome !== 'open') throw new Error('[Stillfall] The run has ended');
    const shapeKey = currentShapeKey(run);
    if (placement.shapeKey !== shapeKey) throw new Error('[Stillfall] That is not the piece in hand');
    return {
        x: placement.x,
        y: placement.y,
        shape: placement.shape.map((row) => row.slice()),
        pieceId: run.nextPieceId,
        shapeKey,
        type: shapeKey,
        rotation: placement.rotation,
    };
}

/**
 * The run after a placement, as applyPlacement makes it, for the solver. A lock that
 * completes no row skips the cascade resolver, whose answer for it is known: nothing
 * clears, nothing falls, and the bodies are the ones before plus the new piece.
 * @param {StillfallRun} run
 * @param {StillfallPlacement} placement
 * @returns {StillfallRun}
 */
export function runAfter(run, placement) {
    const before = boardOf(run);
    if (completesRow(before, placement)) return applyPlacement(run, placement).run;
    const locked = lockedBodyFor(run, placement);
    /** @type {StillfallRun} */
    const next = {
        ...run,
        // As the resolver returns them: a dealt piece carries no colour of its own.
        lockedPieces: /** @type {LockedBody[]} */ ([...run.lockedPieces, locked]),
        dealt: run.dealt + 1,
        nextPieceId: run.nextPieceId + 1,
    };
    next.outcome = judge(next);
    const grid = before.map((row) => row.slice());
    for (const [x, y] of cellsOf(locked)) {
        if (y >= 0 && y < grid.length) grid[y][x] = { color: locked.shapeKey, id: locked.pieceId, type: locked.type };
    }
    RUN_BOARDS.set(next, grid);
    return next;
}

/**
 * Whether a landing fills the last empty cells of some row, so that its lock clears one.
 * @param {Array<Array<unknown>>} boardGrid the board before the lock
 * @param {{ x: number, y: number, shape: number[][] }} placement
 */
export function completesRow(boardGrid, placement) {
    const cells = cellsOf(placement);
    for (const [, y] of cells) {
        if (y < 0 || y >= boardGrid.length) continue;
        let full = true;
        for (let x = 0; x < COLS && full; x += 1) {
            full = boardGrid[y][x] !== null || cells.some(([cx, cy]) => cx === x && cy === y);
        }
        if (full) return true;
    }
    return false;
}

/**
 * Whether the goal is met, still open, or out of reach (supply spent, or a relic gone).
 * Every part of an `all` goal must hold after the same lock.
 * @param {StillfallRun} run
 * @returns {'open'|'solved'|'failed'}
 */
export function judge(run) {
    const parts = goalParts(run.puzzle.goal);
    if (parts.some((part) => part.type === 'relic-floor' && bodyCellsOf(run, part).length === 0)) return 'failed';
    if (parts.every((part) => goalPartMet(run, part))) return 'solved';
    return run.dealt >= run.puzzle.supply.length ? 'failed' : 'open';
}

/**
 * Whether one single goal holds on this run.
 * @param {StillfallRun} run
 * @param {StillfallGoal} part
 */
export function goalPartMet(run, part) {
    if (part.type === 'waves') return run.bestWaves >= /** @type {number} */ (part.atLeast);
    if (part.type === 'lines') return run.lines >= /** @type {number} */ (part.atLeast);
    if (part.type === 'clear-all') return run.lockedPieces.length === 0;
    if (part.type === 'seal') return bodyCellsOf(run, part).length === 0;
    if (part.type === 'relic-floor') {
        return bodyCellsOf(run, part).some(([, y]) => y === run.puzzle.boardHeight - 1);
    }
    return false;
}

/**
 * The cells a goal's marked body holds now (a cut body's fragments keep its id).
 * @param {StillfallRun} run
 * @param {StillfallGoal} part
 * @returns {Array<[number, number]>}
 */
export function bodyCellsOf(run, part) {
    const id = run.puzzle.bodyIds[/** @type {string} */ (part.body)];
    return run.lockedPieces.filter((piece) => piece.pieceId === id).flatMap((piece) => cellsOf(piece));
}

/**
 * Why a failed run failed: a relic body was cleared away, or the supply ran out short
 * of the goal. A deal the structure blocks is the mode's to report ('blocked').
 * @param {StillfallRun} run
 * @returns {'relic-lost' | 'spent' | null}
 */
export function failReason(run) {
    const parts = goalParts(run.puzzle.goal);
    if (parts.some((part) => part.type === 'relic-floor' && bodyCellsOf(run, part).length === 0)) return 'relic-lost';
    return run.dealt >= run.puzzle.supply.length ? 'spent' : null;
}

/**
 * How many cells the bodies on the board hold.
 * @param {Array<{ shape: number[][] }>} pieces
 */
export function countCells(pieces) {
    return pieces.reduce((sum, piece) => sum + cellsOf(/** @type {any} */ (piece)).length, 0);
}

/**
 * The reachable landing a stored solution step names, or null if the controls cannot
 * reach it on this board. Steps name the piece, how many right rotations, and the column
 * (the shape matrix's origin, as listPlacements reports it); the landing row follows.
 * @param {StillfallRun} run
 * @param {{ piece: string, rotation: number, x: number }} step
 * @returns {StillfallPlacement | null}
 */
export function solutionPlacement(run, step) {
    if (!step || currentShapeKey(run) !== step.piece) return null;
    return listPlacements(run).find((placement) => (
        placement.rotation === step.rotation && placement.x === step.x
    )) || null;
}

/**
 * Whether two boards hold the same bodies in the same cells.
 * @param {Array<Array<{ id?: unknown } | null>>} a
 * @param {Array<Array<{ id?: unknown } | null>>} b
 */
export function sameBoard(a, b) {
    if (a.length !== b.length) return false;
    return a.every((row, y) => row.length === b[y].length
        && row.every((cell, x) => (cell ? cell.id : null) === (b[y][x] ? b[y][x].id : null)));
}

/** @type {Map<string, Array<{ shape: number[][], cells: Array<[number, number]> }>>} each rotation */
const ROTATIONS = new Map();

/** The piece's shape after 0–3 right turns from the dealt one, as the controls turn it. */
function rotationsOf(/** @type {string} */ shapeKey) {
    let rotations = ROTATIONS.get(shapeKey);
    if (!rotations) {
        rotations = [];
        let shape = SHAPES[shapeKey].map((row) => row.slice());
        for (let turn = 0; turn < 4; turn += 1) {
            /** @type {Array<[number, number]>} */
            const cells = [];
            shape.forEach((row, dy) => row.forEach((cell, dx) => { if (cell > 0) cells.push([dx, dy]); }));
            rotations.push({ shape, cells });
            shape = rotateShapeMatrix(shape, 'right');
        }
        ROTATIONS.set(shapeKey, rotations);
    }
    return rotations;
}

/**
 * Every place the piece in hand could come to rest and fill the last empty cells of a row,
 * whether the controls can reach it or not: a superset of its landings that clear a line.
 * A lock that clears nothing moves nothing (no body falls, no goal changes), so for the
 * last piece these are the only landings that can still solve the puzzle, and the solver
 * plays them before it pays for the full search of what the controls reach.
 * @param {StillfallRun} run an open run
 * @param {Array<Array<unknown>>} boardGrid the run's board
 * @returns {StillfallPlacement[]} one per footprint, without a path (`actions` is empty)
 */
export function lineClearingRests(run, boardGrid) {
    const shapeKey = /** @type {string} */ (currentShapeKey(run));
    const height = boardGrid.length;
    const free = (/** @type {number} */ x, /** @type {number} */ y) => (
        x >= 0 && x < COLS && y < height && (y < 0 || boardGrid[y][x] === null));
    /** @type {Map<string, StillfallPlacement>} */
    const found = new Map();
    for (let y = 0; y < height; y += 1) {
        const row = boardGrid[y];
        let first = -1;
        let last = -1;
        let empty = 0;
        for (let x = 0; x < COLS; x += 1) {
            if (row[x] !== null) continue;
            if (first < 0) first = x;
            last = x;
            empty += 1;
        }
        if (empty === 0 || empty > 4 || last - first > 3) continue;
        // A piece that completes the row covers its first gap with one of its cells.
        rotationsOf(shapeKey).forEach(({ shape, cells }, rotation) => {
            for (const [ax, ay] of cells) {
                const x = first - ax;
                const top = y - ay;
                if (!cells.every(([dx, dy]) => free(x + dx, top + dy))) continue;
                if (cells.filter(([, dy]) => top + dy === y).length !== empty) continue;
                if (cells.every(([dx, dy]) => free(x + dx, top + dy + 1))) continue; // it would fall on
                const placement = {
                    shapeKey, shape, rotation, x, y: top, actions: [], footprint: '',
                };
                placement.footprint = footprintOf(placement);
                if (!found.has(placement.footprint)) found.set(placement.footprint, placement);
            }
        });
    }
    return [...found.values()];
}

/**
 * Occupied board cells of a piece.
 * @param {{ x: number, y: number, shape: number[][] }} piece
 * @returns {Array<[number, number]>}
 */
export function cellsOf(piece) {
    /** @type {Array<[number, number]>} */
    const cells = [];
    piece.shape.forEach((row, localY) => row.forEach((cell, localX) => {
        if (cell > 0) cells.push([piece.x + localX, piece.y + localY]);
    }));
    return cells;
}

/** @param {{ x: number, y: number, shape: number[][] }} piece */
function footprintOf(piece) {
    return cellsOf(piece).map(([x, y]) => `${x},${y}`).sort().join(';');
}

/** @param {LockedBody[]} pieces */
function clonePieces(pieces) {
    return pieces.map((piece) => ({ ...piece, shape: piece.shape.map((row) => row.slice()) }));
}
