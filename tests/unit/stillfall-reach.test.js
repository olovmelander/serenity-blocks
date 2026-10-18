/**
 * The Stillfall lister (stillfall-reach.js) must find exactly what the bot pathfinder
 * finds: every landing, and for each the same rotation, column, row and input path. The
 * solver, the certifier and the hint all trust it, so it is held to findReachablePlacements
 * on every bank puzzle's opening boards and the boards after each first landing, and on
 * random boards with caves and overhangs where tucks and kicks matter.
 */
import { describe, expect, it } from 'vitest';
import { COLS, PIECE_KEYS } from '../../src/core/constants.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { buildPuzzle } from '../../src/core/stillfall/stillfall-puzzle.js';
import {
    applyPlacement, boardFor, cellsOf, createRun, currentShapeKey, listPlacements, spawnPiece,
} from '../../src/core/stillfall/stillfall-sim.js';
import { STILLFALL_PUZZLES } from '../../src/core/stillfall/puzzle-bank.js';

/** listPlacements as it was built on the bot pathfinder: the oracle. */
function referencePlacements(run) {
    const shapeKey = currentShapeKey(run);
    if (!shapeKey || run.outcome !== 'open') return [];
    const boardGrid = boardFor(run.lockedPieces);
    const byFootprint = new Map();
    for (const placement of findReachablePlacements({ boardGrid, currentPiece: spawnPiece(shapeKey, boardGrid) })) {
        const footprint = cellsOf(placement).map(([x, y]) => `${x},${y}`).sort().join(';');
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

/** A seeded board: a ragged floor with caves under ledges, so tucks and kicks exist. */
function randomBoardRun(seed, shapeKey) {
    let state = seed;
    const rand = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
    // Each run of cells in a row is one body, so every definition is valid.
    const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
    let next = 0;
    const rows = [];
    const height = 4 + Math.floor(rand() * 7);
    for (let y = 0; y < height; y += 1) {
        const density = y < 2 ? 0.35 : 0.7;
        const filled = Array.from({ length: COLS }, () => rand() < density);
        if (filled.every(Boolean)) filled[Math.floor(rand() * COLS)] = false;
        let row = '';
        for (let x = 0; x < COLS; x += 1) {
            if (!filled[x]) row += '.';
            else {
                if (x === 0 || !filled[x - 1]) next += 1;
                row += letters[next - 1];
            }
        }
        rows.push(row);
    }
    const puzzle = buildPuzzle({
        id: `random-${seed}`,
        title: 'Random',
        rows,
        supply: [shapeKey],
        goal: { type: 'clear-all' },
    });
    return createRun(puzzle);
}

describe('Stillfall reachability', () => {
    it.each(STILLFALL_PUZZLES.map((definition) => [definition.id, definition]))(
        'finds what the bot pathfinder finds on %s and after each opening',
        (id, definition) => {
            const start = createRun(buildPuzzle(definition));
            const openings = listPlacements(start);
            expect(openings).toEqual(referencePlacements(start));
            for (const placement of openings) {
                const { run } = applyPlacement(start, placement);
                expect(listPlacements(run), `${id} after ${placement.footprint}`).toEqual(referencePlacements(run));
            }
        },
    );

    it('finds what the bot pathfinder finds on boards with caves, tucks and kicks', () => {
        let tucks = 0;
        let spins = 0;
        for (let seed = 1; seed <= 24; seed += 1) {
            for (const shapeKey of PIECE_KEYS) {
                const run = randomBoardRun(seed * 7919, shapeKey);
                const placements = listPlacements(run);
                expect(placements, `seed ${seed} ${shapeKey}`).toEqual(referencePlacements(run));
                for (const { actions } of placements) {
                    const drop = actions.findIndex((action) => action.type === 'softDrop');
                    if (drop >= 0 && drop < actions.length - 1) tucks += 1;
                    if (drop >= 0 && actions.slice(drop).some((action) => action.type === 'rotate')) spins += 1;
                }
            }
        }
        // The corpus really exercises the paths a straight drop never takes.
        expect(tucks).toBeGreaterThan(20);
        expect(spins).toBeGreaterThan(5);
    });
});
