/**
 * The Fault Lines certifier. Every shipped puzzle must be valid and solvable by straight
 * drops (rotate and move at the top, then drop: no tuck, no kick), its stored solution
 * must be one such line, two-piece puzzles must need every piece, and every solution must
 * play out the same through the real game: the real controls from the deal row, a real
 * hard drop, and the live async cascade physics, cell for cell after every lock. A rules
 * change (kicks, spawn, gravity, cascade order) that breaks a shipped puzzle fails here.
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
    applyPlacement, boardFor, createRun, dealIntoView, judge, listPlacements, solutionPlacement,
} from '../../src/core/fault-lines/fault-lines-sim.js';
import { everyPieceMatters, isStraight, solvePuzzle } from '../../src/core/fault-lines/fault-lines-solver.js';
import {
    FAULT_LINES_PUZZLES, SOLVES_TO_OPEN_NEXT_TIER, TIERS, openPuzzleIds,
} from '../../src/core/fault-lines/puzzle-bank.js';

/** The share of first landings that may lead to a solution, per tier. */
const MAX_WINNING_OPENINGS = {
    1: 0.25, 2: 0.25, 3: 0.1, 4: 0.1, 5: 0.06, 6: 0.06,
};
/** From this tier on, exactly one first landing leads to a solution. */
const ONE_WAY_IN_FROM_TIER = 5;

/** Every cell as `type:id`, so two boards match only if the same bodies hold the same cells. */
function cellMap(grid) {
    return grid.map((row) => row.map((cell) => (cell ? `${cell.type}:${cell.id}` : '.')).join(' '));
}

/** Loads a puzzle into a real GameState, as the mode does, with its supply dealt in order. */
function liveGame(puzzle) {
    const gameState = new GameState({ hitStopEnabled: false, finiteSupply: true, gravityWaits: true });
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
    dealIntoView(gameState);
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
    if (gameState.nextPieces.length > 0) {
        spawnPiece(gameState);
        dealIntoView(gameState);
    }
}

/** Replays one line of play through the live game, checking the board after each lock. */
async function certifyLine(puzzle, line, label) {
    const live = liveGame(puzzle);
    let run = createRun(puzzle);
    expect(cellMap(live.gameState.boardGrid)).toEqual(cellMap(boardFor(run.lockedPieces)));
    for (const placement of line) {
        const step = applyPlacement(run, placement);
        const wavesBefore = live.waves.length;
        // eslint-disable-next-line no-await-in-loop
        await playLive(live, placement);
        expect(live.waves.length - wavesBefore, `${label}: waves`).toBe(step.resolution.cascadeCount);
        expect(cellMap(live.gameState.boardGrid), `${label}: board`)
            .toEqual(cellMap(boardFor(step.run.lockedPieces)));
        ({ run } = step);
    }
    expect(run.outcome, label).toBe('solved');
    // Every goal needs at least one clear, so the live game must have cascaded.
    expect(live.waves.length, label).toBeGreaterThan(0);
}

describe('Fault Lines puzzle bank', () => {
    it('holds valid puzzles with unique ids, lessons and stored solutions', () => {
        const ids = FAULT_LINES_PUZZLES.map((puzzle) => puzzle.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const definition of FAULT_LINES_PUZZLES) {
            expect(validatePuzzleDefinition(definition), definition.id).toEqual([]);
            expect(definition.lesson, definition.id).toBeTruthy();
            expect(definition.solution?.length, definition.id).toBe(definition.supply.length);
        }
    });

    it('opens a tier once three puzzles in the tier below are solved, so lanterns come first', () => {
        const tierOf = (tier) => FAULT_LINES_PUZZLES.filter((p) => p.tier === tier).map((p) => p.id);
        const tiers = [...new Set(FAULT_LINES_PUZZLES.map((p) => p.tier))];
        expect(tiers).toEqual(TIERS.map((entry) => entry.tier));
        expect(SOLVES_TO_OPEN_NEXT_TIER).toBe(3);
        expect([...openPuzzleIds([])]).toEqual(tierOf(1));
        expect([...openPuzzleIds(tierOf(1).slice(0, 2))]).toEqual(tierOf(1));
        // Three in each tier below opens the next one, and only that one.
        for (let index = 1; index < tiers.length; index += 1) {
            const below = tiers.slice(0, index);
            const solved = below.flatMap((tier) => tierOf(tier).slice(0, 3));
            expect([...openPuzzleIds(solved)]).toEqual([...below, tiers[index]].flatMap(tierOf));
            expect([...openPuzzleIds(solved.slice(0, -1))]).toEqual(below.flatMap(tierOf));
        }
        // Any three of the five first-light puzzles include a lantern puzzle.
        const lanternPuzzles = FAULT_LINES_PUZZLES.filter((p) => p.tier === 1 && p.rows.some((row) => /[a-z]/.test(row)));
        expect(lanternPuzzles.length).toBeGreaterThanOrEqual(3);
    });

    describe.each(FAULT_LINES_PUZZLES.map((definition) => [definition.id, definition]))('%s', (id, definition) => {
        const puzzle = buildPuzzle(definition);
        const report = solvePuzzle(puzzle);

        it('is solvable by straight drops, and not by most openings', () => {
            expect(report.solvable).toBe(true);
            expect(report.straightSolutions.length, 'a solution with no tuck or kick').toBeGreaterThan(0);
            expect(report.winningOpenings / report.openingMoves)
                .toBeLessThanOrEqual(MAX_WINNING_OPENINGS[definition.tier]);
            if (definition.tier >= ONE_WAY_IN_FROM_TIER) expect(report.winningOpenings, 'one way in').toBe(1);
        });

        it('needs every piece, and is not solved before the last one lands', () => {
            expect(report.minPieces).toBe(definition.supply.length);
            if (definition.supply.length > 1) expect(everyPieceMatters(puzzle)).toBe(true);
        });

        it('stores a straight solution the controls reach, for the hint', () => {
            let run = createRun(puzzle);
            for (const step of puzzle.solution) {
                const placement = solutionPlacement(run, step);
                expect(placement, `${id}: step ${JSON.stringify(step)}`).not.toBeNull();
                expect(isStraight(placement), `${id}: step ${JSON.stringify(step)} is straight`).toBe(true);
                ({ run } = applyPlacement(run, placement));
            }
            expect(run.outcome).toBe('solved');
        });

        it('plays every solution out identically through the real controls and live physics', async () => {
            for (const [index, line] of report.solutions.entries()) {
                // eslint-disable-next-line no-await-in-loop
                await certifyLine(puzzle, line, `${id} #${index}`);
            }
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
        expect(validatePuzzleDefinition({
            ...definition, goal: { type: 'clear-all' }, solution: [{ piece: 'O', rotation: 0, x: 4 }],
        })).toEqual(['solution must list one step per supply piece']);
        expect(validatePuzzleDefinition({
            ...definition,
            goal: { type: 'clear-all' },
            solution: [{ piece: 'I', rotation: 0, x: 4 }, { piece: 'O', rotation: 4, x: 0 }],
        })).toHaveLength(2);
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

    it('tells a straight placement from a tuck', () => {
        const run = createRun(buildPuzzle({ ...definition, goal: { type: 'clear-all' } }));
        const placements = listPlacements(run);
        expect(placements.some(isStraight)).toBe(true);
        const tuck = { ...placements[0], actions: [{ type: 'softDrop' }, { type: 'move', dir: 1 }] };
        expect(isStraight(tuck)).toBe(false);
    });
});
