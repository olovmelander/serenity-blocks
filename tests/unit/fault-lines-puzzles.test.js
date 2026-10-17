/**
 * The Fault Lines certifier. Every shipped puzzle must be valid and solvable, and its
 * solution must play out the same through the real game: the real controls from spawn,
 * a real hard drop, and the live async cascade physics, cell for cell after every lock.
 * A rules change (kicks, spawn, gravity, cascade order) that breaks a shipped puzzle
 * fails here.
 */
import { describe, expect, it } from 'vitest';
import {
    GameState, hardDrop, move, rotate, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces, markBoardDirty } from '../../src/core/board.js';
import {
    buildPuzzle, validatePuzzleDefinition, MAX_SUPPLY,
} from '../../src/core/fault-lines/fault-lines-puzzle.js';
import {
    applyPlacement, boardFor, createRun, judge, listPlacements,
} from '../../src/core/fault-lines/fault-lines-sim.js';
import { solvePuzzle } from '../../src/core/fault-lines/fault-lines-solver.js';
import { FAULT_LINES_PUZZLES, openPuzzleIds } from '../../src/core/fault-lines/puzzle-bank.js';

/** Every cell as `type:id`, so two boards match only if the same bodies hold the same cells. */
function cellMap(grid) {
    return grid.map((row) => row.map((cell) => (cell ? `${cell.type}:${cell.id}` : '.')).join(' '));
}

/** Loads a puzzle into a real GameState, as the mode does, with its supply dealt in order. */
function liveGame(puzzle) {
    const gameState = new GameState({ hitStopEnabled: false });
    gameState.isSeeking = true; // physics skips its animation delays
    gameState.lockedPieces = puzzle.lockedPieces.map((piece) => ({
        ...piece, shape: piece.shape.map((row) => row.slice()),
    }));
    gameState._pieceIdCounter = puzzle.nextPieceId - 1;
    gameState.nextPieces = puzzle.supply.slice();
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    markBoardDirty(gameState);
    const waves = [];
    const physicsCallbacks = {
        onLineClear: (count, holes, masks, rows, wave) => waves.push(wave),
        spawnPiece: () => {},
    };
    spawnPiece(gameState);
    return { gameState, physicsCallbacks, waves };
}

async function playLive(live, placement) {
    const { gameState, physicsCallbacks } = live;
    expect(gameState.currentPiece?.shapeKey).toBe(placement.shapeKey);
    for (const action of placement.actions) {
        if (action.type === 'move') expect(move(gameState, action.dir)).toBe(true);
        else if (action.type === 'rotate') expect(rotate(gameState, action.dir)).toBe(true);
        else if (action.type === 'softDrop') expect(softDrop(gameState, null, physicsCallbacks)).toBe(true);
    }
    hardDrop(gameState, null, physicsCallbacks);
    await gameState.latestPhysicsPromise;
    if (gameState.nextPieces.length > 0) spawnPiece(gameState);
}

describe('Fault Lines puzzle bank', () => {
    it('holds valid puzzles with unique ids', () => {
        const ids = FAULT_LINES_PUZZLES.map((puzzle) => puzzle.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const definition of FAULT_LINES_PUZZLES) {
            expect(validatePuzzleDefinition(definition), definition.id).toEqual([]);
            expect(definition.lesson, definition.id).toBeTruthy();
        }
    });

    it('opens a tier once two puzzles in the tier below are solved', () => {
        const tierOf = (tier) => FAULT_LINES_PUZZLES.filter((p) => p.tier === tier).map((p) => p.id);
        expect([...openPuzzleIds([])]).toEqual(tierOf(1));
        expect([...openPuzzleIds(tierOf(1).slice(0, 1))]).toEqual(tierOf(1));
        expect([...openPuzzleIds(tierOf(1).slice(0, 2))]).toEqual([...tierOf(1), ...tierOf(2)]);
        expect([...openPuzzleIds([...tierOf(1).slice(0, 2), ...tierOf(2).slice(0, 2)])])
            .toEqual([...tierOf(1), ...tierOf(2), ...tierOf(3)]);
    });

    describe.each(FAULT_LINES_PUZZLES.map((definition) => [definition.id, definition]))('%s', (id, definition) => {
        const puzzle = buildPuzzle(definition);
        const report = solvePuzzle(puzzle);

        it('is solvable, and not by every opening', () => {
            expect(report.solvable).toBe(true);
            expect(report.winningOpenings).toBeLessThan(report.openingMoves);
            if (definition.tier >= 3) {
                // The hard tier: a few openings at most lead anywhere.
                expect(report.winningOpenings / report.openingMoves).toBeLessThanOrEqual(0.1);
            }
        });

        it('plays its solution out identically through the real controls and live physics', async () => {
            const live = liveGame(puzzle);
            let run = createRun(puzzle);
            expect(cellMap(live.gameState.boardGrid)).toEqual(cellMap(boardFor(run.lockedPieces)));
            for (const placement of report.solution) {
                const step = applyPlacement(run, placement);
                const wavesBefore = live.waves.length;
                // eslint-disable-next-line no-await-in-loop
                await playLive(live, placement);
                expect(live.waves.length - wavesBefore, `${id}: waves`).toBe(step.resolution.cascadeCount);
                expect(cellMap(live.gameState.boardGrid), `${id}: board`)
                    .toEqual(cellMap(boardFor(step.run.lockedPieces)));
                ({ run } = step);
            }
            expect(run.outcome).toBe('solved');
            // Every goal needs at least one clear, so the live game must have cascaded.
            expect(live.waves.length).toBeGreaterThan(0);
        });
    });
});

describe('Fault Lines rules', () => {
    const definition = {
        id: 'rules', title: 'Rules', rows: ['....R.....', 'AAAAAAAA..'], supply: ['O', 'O'],
    };

    it('rejects malformed definitions with every problem named', () => {
        expect(validatePuzzleDefinition({
            id: 'Bad Id', title: '', rows: ['AAAA', 'BBBBBBBBBB'], supply: ['Q', 'I', 'I', 'I'], goal: { type: 'win' },
        })).toEqual(expect.arrayContaining([
            'id must be a short kebab-case string',
            'title is required',
            'row 0 must be 10 characters',
            'row 1 is already full',
            `supply must hold 1–${MAX_SUPPLY} pieces`,
            expect.stringContaining('goal.type must be one of'),
        ]));
        const split = { ...definition, rows: ['A.A.......', 'BBBBBBBB..'], goal: { type: 'clear-all' } };
        expect(validatePuzzleDefinition(split)).toEqual(["body 'A' must be one connected group"]);
        expect(validatePuzzleDefinition({ ...definition, goal: { type: 'relic-floor', body: 'Z' } }))
            .toEqual(['goal.body must name a body in rows']);
    });

    it('never gives touching bodies the same colour', () => {
        for (const bank of FAULT_LINES_PUZZLES) {
            const grid = boardFor(buildPuzzle(bank).lockedPieces);
            grid.forEach((row, y) => row.forEach((cell, x) => {
                for (const other of [row[x + 1], grid[y + 1]?.[x]]) {
                    if (cell && other && other.id !== cell.id) {
                        expect(other.type, `${bank.id} ${x},${y}`).not.toBe(cell.type);
                    }
                }
            }));
        }
    });

    it('fails a relic goal once the relic is cleared away, and when the supply runs out', () => {
        const puzzle = buildPuzzle({ ...definition, goal: { type: 'relic-floor', body: 'R' } });
        let run = createRun(puzzle);
        expect(judge(run)).toBe('open');
        // Two O pieces into the right-hand gap clear the row and drop the relic one row.
        for (let i = 0; i < 2 && run.outcome === 'open'; i += 1) {
            const placement = listPlacements(run).find((p) => p.footprint.includes('8,23'));
            if (!placement) break;
            ({ run } = applyPlacement(run, placement));
        }
        expect(run.outcome).toBe('solved');
        const spent = createRun(buildPuzzle({ ...definition, supply: ['I'], goal: { type: 'lines', atLeast: 3 } }));
        expect(applyPlacement(spent, listPlacements(spent)[0]).run.outcome).toBe('failed');
    });
});
