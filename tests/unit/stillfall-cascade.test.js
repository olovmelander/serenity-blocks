/**
 * The solver's fast cascade (src/core/stillfall/stillfall-cascade.js) against the real resolver
 * (resolveCascade, itself held to the live physics by cascade-resolver-differential.test.js):
 * the same bodies after, in the same order and colours, the same board, waves and lines, on
 * every lock that clears in the bank's search trees (each puzzle's first two locks, every
 * landing the controls reach) and on seeded tall boards of multi-cell bodies, hanging bodies
 * and fragments of one body that must fuse again. The solver's shortcuts are held to the
 * runs they stand for: runAfter to applyPlacement, outcomeAfter to judging the run after, and
 * couldSolveAfter's "no" to a search that finds nothing.
 */
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { RandomStream } from '../../src/core/rng.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { resolveStillfallCascade, stillfallCascadeCells } from '../../src/core/stillfall/stillfall-cascade.js';
import { buildPuzzle, STILLFALL_BOARD_HEIGHT } from '../../src/core/stillfall/stillfall-puzzle.js';
import {
    applyPlacement, boardOf, cellsOf, completesRow, couldSolveAfter, createRun, listPlacements,
    outcomeAfter, runAfter,
} from '../../src/core/stillfall/stillfall-sim.js';
import { STILLFALL_PUZZLES, TIERS } from '../../src/core/stillfall/puzzle-bank.js';

const HEIGHT = ROWS + HIDDEN_ROWS;
const BOTTOM = HEIGHT - 1;

const clonePieces = (pieces) => pieces.map((piece) => ({ ...piece, shape: piece.shape.map((row) => row.slice()) }));

/** Expects equal values; a deep comparison first, the diff only when they differ. */
function expectSame(actual, expected, label) {
    if (!isDeepStrictEqual(actual, expected)) expect(actual, label).toEqual(expected);
}

/** Both resolvers on the same bodies; the fast one must not touch its input. */
function expectSameCascade(pieces, label) {
    const before = JSON.stringify(pieces);
    const reference = resolveCascade(clonePieces(pieces), {
        boardHeight: HEIGHT, level: 1, lines: 0, linesUntilNextLevel: 15, disableLevelProgression: true,
    });
    const fast = resolveStillfallCascade(pieces, HEIGHT);
    expect(JSON.stringify(pieces), `${label}: input untouched`).toBe(before);
    expect(fast.cascadeCount, `${label}: waves`).toBe(reference.cascadeCount);
    expect(fast.linesClearedThisTurn, `${label}: lines`).toBe(reference.linesClearedThisTurn);
    expectSame(fast.lockedPiecesAfter, reference.lockedPiecesAfter, `${label}: bodies after`);
    expectSame(fast.boardAfter, reference.boardAfter, `${label}: board after`);
    const { cells } = stillfallCascadeCells(pieces, HEIGHT);
    expectSame([...cells], reference.boardAfter.flat().map((cell) => (cell ? cell.id : 0)), `${label}: cells`);
    return reference;
}

/** The locked body a placement becomes, as stillfall-sim locks it. */
const lockedBody = (run, placement) => ({
    x: placement.x,
    y: placement.y,
    shape: placement.shape.map((row) => row.slice()),
    pieceId: run.nextPieceId,
    shapeKey: placement.shapeKey,
    type: placement.shapeKey,
    rotation: placement.rotation,
});

describe('Stillfall fast cascade ≡ resolveCascade', () => {
    // Every landing the controls reach for each puzzle's first two pieces; each lock that clears
    // is resolved both ways, and its run after made both ways (a lock that clears nothing
    // resolves no cascade on either path).
    const tally = { compared: 0, deep: 0 };
    it.each(TIERS.map(({ tier, name }) => [name, tier]))('agrees on every lock that clears in %s\'s first two locks', (name, tier) => {
        const walk = (run, depth) => {
            if (run.outcome !== 'open' || depth >= 2) return;
            const grid = boardOf(run);
            for (const placement of listPlacements(run)) {
                const fast = runAfter(run, placement);
                if (completesRow(grid, placement)) {
                    const label = `${run.puzzle.id} ${placement.footprint}`;
                    const reference = expectSameCascade([...run.lockedPieces, lockedBody(run, placement)], label);
                    tally.compared += 1;
                    if (reference.cascadeCount >= 3) tally.deep += 1;
                    const step = applyPlacement(run, placement);
                    expect(outcomeAfter(run, placement), `${label}: outcome`).toBe(step.run.outcome);
                    // The solver's run after is the one applyPlacement makes, board included.
                    expectSame(fast.lockedPieces, step.run.lockedPieces, `${label}: run after`);
                    expect([fast.lines, fast.bestWaves, fast.dealt, fast.outcome], label)
                        .toEqual([step.run.lines, step.run.bestWaves, step.run.dealt, step.run.outcome]);
                    expectSame(boardOf(fast), boardOf(step.run), `${label}: board`);
                }
                walk(fast, depth + 1);
            }
        };
        for (const definition of STILLFALL_PUZZLES.filter((entry) => entry.tier === tier)) {
            walk(createRun(buildPuzzle(definition)), 0);
        }
    }, 60000);

    it('compared enough locks, deep cascades among them', () => {
        expect(tally.compared).toBeGreaterThan(2000);
        expect(tally.deep).toBeGreaterThan(50);
    });

    // Seeded towers: up to fourteen rows of multi-cell bodies with one to three holes a row,
    // bodies hanging above, and some bodies cut in two (a fragment of one body elsewhere), then a
    // lock that fills the last holes of a row.
    const CASES = 400;

    function partition(rng, cells, maxSize) {
        const bodies = [];
        const free = new Set(cells);
        while (free.size > 0) {
            const keys = [...free];
            const start = keys[rng.nextInt(keys.length)];
            const body = [start];
            free.delete(start);
            const size = 1 + rng.nextInt(maxSize);
            while (body.length < size) {
                const frontier = [];
                for (const key of body) {
                    const [x, y] = key.split(',').map(Number);
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        if (free.has(`${x + dx},${y + dy}`)) frontier.push(`${x + dx},${y + dy}`);
                    }
                }
                if (frontier.length === 0) break;
                const next = frontier[rng.nextInt(frontier.length)];
                free.delete(next);
                body.push(next);
            }
            bodies.push(body.map((key) => key.split(',').map(Number)));
        }
        return bodies;
    }

    function bodyPiece(cells, id, coloured) {
        const xs = cells.map(([x]) => x);
        const ys = cells.map(([, y]) => y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const shape = Array.from({ length: Math.max(...ys) - minY + 1 }, () => Array(Math.max(...xs) - minX + 1).fill(0));
        cells.forEach(([x, y]) => { shape[y - minY][x - minX] = 1; });
        const type = 'IOTSZJL'[id % 7];
        // Authored bodies carry a colour; a dealt piece does not (the resolver gives it one).
        return {
            pieceId: id, ...(coloured ? { color: `#${type}` } : {}), type, shapeKey: type, x: minX, y: minY, shape,
        };
    }

    function towerScenario(rng) {
        const stackRows = 6 + rng.nextInt(9);
        const cells = new Set();
        for (let r = 0; r < stackRows; r += 1) {
            const holes = new Set();
            const holeCount = 1 + rng.nextInt(3);
            while (holes.size < holeCount) holes.add(rng.nextInt(COLS));
            for (let x = 0; x < COLS; x += 1) if (!holes.has(x)) cells.add(`${x},${BOTTOM - r}`);
        }
        const hanging = new Set();
        for (let k = 1 + rng.nextInt(3); k > 0; k -= 1) {
            const x = rng.nextInt(COLS - 1);
            const y = BOTTOM - stackRows - 2 - rng.nextInt(3);
            hanging.add(`${x},${y}`);
            if (rng.nextInt(2)) hanging.add(`${x + 1},${y}`);
        }
        const bodies = [...partition(rng, cells, 8), ...partition(rng, hanging, 2)];
        const pieces = bodies.map((body, index) => bodyPiece(body, index + 1, true));
        // A fragment of one body elsewhere, as a clear leaves a cut body: same id, apart.
        if (pieces.length > 4 && rng.nextInt(2)) {
            const from = pieces[rng.nextInt(pieces.length)];
            const to = pieces[rng.nextInt(pieces.length)];
            if (from !== to) Object.assign(to, { pieceId: from.pieceId, type: from.type, shapeKey: from.shapeKey, color: from.color });
        }
        // The lock: a dealt piece filling the last holes of a row (its own cells, no colour).
        const grid = Array.from({ length: HEIGHT }, () => Array(COLS).fill(false));
        pieces.forEach((piece) => cellsOf(piece).forEach(([x, y]) => { grid[y][x] = true; }));
        const rows = [];
        for (let y = BOTTOM; y > BOTTOM - stackRows; y -= 1) {
            const empty = grid[y].map((filled, x) => (filled ? -1 : x)).filter((x) => x >= 0);
            if (empty.length > 0) rows.push({ y, empty });
        }
        const target = rows[rng.nextInt(rows.length)];
        const lock = bodyPiece(target.empty.map((x) => [x, target.y]), pieces.length + 1, false);
        return [...pieces, lock];
    }

    it(`agrees on ${CASES} seeded towers, cut bodies and hanging bodies included`, () => {
        const rng = new RandomStream('stillfall-fast-cascade', 'towers');
        let deep = 0;
        let fused = 0;
        for (let i = 0; i < CASES; i += 1) {
            const pieces = towerScenario(rng);
            const reference = expectSameCascade(pieces, `tower-${i}`);
            if (reference.cascadeCount >= 3) deep += 1;
            const ids = reference.lockedPiecesAfter.map((piece) => piece.pieceId);
            if (new Set(pieces.map((piece) => piece.pieceId)).size < pieces.length && new Set(ids).size === ids.length) fused += 1;
        }
        // The corpus must exercise what it exists for.
        expect(deep).toBeGreaterThan(20);
        expect(fused).toBeGreaterThan(5);
    }, 60000);

    it('fuses two fragments of one body that touch, and keeps apart two bodies that touch', () => {
        // Row 22 clears; both halves of body 1 fall onto row 23 side by side and fuse, while body
        // 2 lands beside them and stays its own.
        const full = (y, id) => ({
            pieceId: id, type: 'I', shapeKey: 'I', color: '#I', x: 0, y, shape: [[1, 1, 1, 1, 1, 1, 0, 1, 1, 1]],
        });
        const pieces = [
            full(BOTTOM - 1, 9),
            {
                pieceId: 1, type: 'T', shapeKey: 'T', color: '#T', x: 0, y: BOTTOM - 2, shape: [[1, 1]],
            },
            {
                pieceId: 1, type: 'T', shapeKey: 'T', color: '#T', x: 2, y: BOTTOM - 2, shape: [[1]],
            },
            {
                pieceId: 2, type: 'S', shapeKey: 'S', color: '#S', x: 3, y: BOTTOM - 2, shape: [[1]],
            },
            {
                pieceId: 3, type: 'O', shapeKey: 'O', x: 6, y: BOTTOM - 1, shape: [[1]],
            },
        ];
        const after = expectSameCascade(pieces, 'fuse').lockedPiecesAfter;
        expect(after.map((piece) => piece.pieceId)).toEqual([1, 2]);
    });
});

describe('Stillfall solver shortcuts', () => {
    it("says a landing before the last piece cannot lead to a solve only when nothing after it solves", () => {
        let refused = 0;
        // Two-piece puzzles: their first piece is the one before the last.
        for (const definition of STILLFALL_PUZZLES.filter((entry) => entry.supply.length === 2)) {
            const start = createRun(buildPuzzle(definition));
            for (const placement of listPlacements(start)) {
                if (couldSolveAfter(start, placement)) continue;
                refused += 1;
                const after = applyPlacement(start, placement).run;
                for (const last of listPlacements(after)) {
                    expect(applyPlacement(after, last).run.outcome, `${definition.id} ${placement.footprint}`).not.toBe('solved');
                }
            }
        }
        expect(refused).toBeGreaterThan(200);
    });

    it('builds its board at the height the puzzles use', () => {
        expect(STILLFALL_BOARD_HEIGHT).toBe(HEIGHT);
    });
});
