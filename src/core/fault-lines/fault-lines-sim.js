// @ts-check

/**
 * Pure Fault Lines simulation: deal the next piece, list every landing the real controls
 * can reach, lock one, and resolve its cascade with the same resolver the game is
 * differential-tested against (cascade-resolver.js). Nothing here writes a GameState;
 * every step returns a new run.
 */

import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { createBoardGrid, invalidateGhostCache, rebuildBoardGridFromPieces } from '../board.js';
import { canPlacePiece } from '../game.js';
import { resolveCascade } from '../cascade-resolver.js';
import { findReachablePlacements } from '../ai/reachability-pathfinder.js';
import { FAULT_LINES_BOARD_HEIGHT } from './fault-lines-puzzle.js';

/** @typedef {import('./fault-lines-puzzle.js').FaultLinesPuzzle} FaultLinesPuzzle */
/** @typedef {import('./fault-lines-puzzle.js').LockedBody} LockedBody */

/**
 * @typedef {Object} FaultLinesRun
 * @property {FaultLinesPuzzle} puzzle
 * @property {LockedBody[]} lockedPieces
 * @property {number} dealt how many supply pieces have been locked
 * @property {number} nextPieceId
 * @property {number} lines lines cleared so far
 * @property {number} bestWaves deepest cascade from one lock so far
 * @property {'open'|'solved'|'failed'} outcome
 */

/**
 * @typedef {Object} FaultLinesPlacement
 * @property {string} shapeKey
 * @property {number[][]} shape
 * @property {number} rotation
 * @property {number} x
 * @property {number} y
 * @property {Array<{type: string, dir?: number|string}>} actions from spawn, before the hard drop
 * @property {string} footprint sorted landing cells, `x,y` joined by ';'
 */

/**
 * @param {FaultLinesPuzzle} puzzle
 * @returns {FaultLinesRun}
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
export function currentShapeKey(/** @type {FaultLinesRun} */ run) {
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

/**
 * Every distinct landing for the piece in hand. Landings that fill the same cells are one
 * outcome; the cheapest input path is kept.
 * @param {FaultLinesRun} run
 * @returns {FaultLinesPlacement[]}
 */
export function listPlacements(run) {
    const shapeKey = currentShapeKey(run);
    if (!shapeKey || run.outcome !== 'open') return [];
    const boardGrid = boardFor(run.lockedPieces);
    const placements = findReachablePlacements({
        boardGrid,
        currentPiece: spawnPiece(shapeKey, boardGrid),
    });
    /** @type {Map<string, FaultLinesPlacement & {pathCost: number}>} */
    const byFootprint = new Map();
    for (const placement of placements) {
        const footprint = footprintOf(placement);
        const existing = byFootprint.get(footprint);
        if (!existing || placement.pathCost < existing.pathCost) {
            byFootprint.set(footprint, {
                shapeKey,
                shape: placement.shape.map((row) => row.slice()),
                rotation: placement.rotation ?? 0,
                x: placement.x,
                y: placement.y,
                actions: placement.actions.map((action) => ({ ...action })),
                footprint,
                pathCost: placement.pathCost,
            });
        }
    }
    return [...byFootprint.values()]
        .sort((a, b) => (a.footprint < b.footprint ? -1 : 1))
        .map(({ pathCost, ...placement }) => placement);
}

/**
 * Locks a placement and resolves its cascade.
 * @param {FaultLinesRun} run
 * @param {FaultLinesPlacement} placement
 * @returns {{ run: FaultLinesRun, resolution: ReturnType<typeof resolveCascade> }}
 */
export function applyPlacement(run, placement) {
    if (run.outcome !== 'open') throw new Error('[FaultLines] The run has ended');
    const shapeKey = currentShapeKey(run);
    if (placement.shapeKey !== shapeKey) throw new Error('[FaultLines] That is not the piece in hand');

    const locked = {
        x: placement.x,
        y: placement.y,
        shape: placement.shape.map((row) => row.slice()),
        pieceId: run.nextPieceId,
        shapeKey,
        type: shapeKey,
        rotation: placement.rotation,
    };
    const lockFootprint = cellsOf(locked).map(([x, y]) => ({ x, y }));
    const manualColumns = [...new Set(lockFootprint.map((cell) => cell.x))].sort((a, b) => a - b);
    const resolution = resolveCascade([...run.lockedPieces, locked], {
        boardHeight: FAULT_LINES_BOARD_HEIGHT,
        level: 1,
        lines: run.lines,
        linesUntilNextLevel: 15,
        disableLevelProgression: true,
        comboState: {
            lockFootprint, manualColumns, depth: 0, complexity: 0,
        },
        lastPlacedPieceX: manualColumns,
    });

    /** @type {FaultLinesRun} */
    const next = {
        ...run,
        lockedPieces: resolution.lockedPiecesAfter,
        dealt: run.dealt + 1,
        nextPieceId: run.nextPieceId + 1,
        lines: run.lines + resolution.linesClearedThisTurn,
        bestWaves: Math.max(run.bestWaves, resolution.cascadeCount),
    };
    next.outcome = judge(next);
    return { run: next, resolution };
}

/**
 * Whether the goal is met, still open, or out of reach (supply spent, or the relic gone).
 * @param {FaultLinesRun} run
 * @returns {'open'|'solved'|'failed'}
 */
export function judge(run) {
    const { goal } = run.puzzle;
    let solved = false;
    if (goal.type === 'waves') solved = run.bestWaves >= /** @type {number} */ (goal.atLeast);
    else if (goal.type === 'lines') solved = run.lines >= /** @type {number} */ (goal.atLeast);
    else if (goal.type === 'clear-all') solved = run.lockedPieces.length === 0;
    else if (goal.type === 'relic-floor') {
        const relicId = run.puzzle.bodyIds[/** @type {string} */ (goal.body)];
        const relic = run.lockedPieces.filter((piece) => piece.pieceId === relicId);
        if (relic.length === 0) return 'failed';
        solved = relic.some((piece) => cellsOf(piece).some(([, y]) => y === run.puzzle.boardHeight - 1));
    }
    if (solved) return 'solved';
    return run.dealt >= run.puzzle.supply.length ? 'failed' : 'open';
}

/**
 * Why a failed run failed: the relic body was cleared away, or the supply ran out short
 * of the goal. A deal the structure blocks is the mode's to report ('blocked').
 * @param {FaultLinesRun} run
 * @returns {'relic-lost' | 'spent' | null}
 */
export function failReason(run) {
    const { goal } = run.puzzle;
    if (goal.type === 'relic-floor') {
        const relicId = run.puzzle.bodyIds[/** @type {string} */ (goal.body)];
        if (!run.lockedPieces.some((piece) => piece.pieceId === relicId)) return 'relic-lost';
    }
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
 * @param {FaultLinesRun} run
 * @param {{ piece: string, rotation: number, x: number }} step
 * @returns {FaultLinesPlacement | null}
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
