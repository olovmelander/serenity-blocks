import { describe, expect, it } from 'vitest';
import {
    createMasteryGeometryObjective, drainedTerminalInventoryBound, masteryGeometryUtility,
    measureQuadWell, orb49InventoryRoutes,
} from '../../scripts/odyssey-benchmark/mastery-geometry.mjs';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

function boardWithWell(rows = 4, well = 9) {
    return Array.from({ length: 24 }, (_, y) => Array.from({ length: 10 }, (unused, x) => (
        y >= 24 - rows && x !== well ? { id: `${x}:${y}` } : null
    )));
}

function node(overrides = {}) {
    return {
        boardGrid: boardWithWell(0),
        context: {
            level: 7, linesUntilNextLevel: 15, disableLevelProgression: false, isInfinityMode: false,
        },
        metrics: {
            score: 0, lines: 0, tetrises: 0, maxCombo: 0, maxCascadeDepth: 0, cascades: 0,
        },
        pathCost: 0,
        ...overrides,
    };
}

function observation(levelId, metrics = {}) {
    const level = getLevelById(levelId);
    const state = node();
    state.metrics = { ...state.metrics, ...metrics };
    state.rules = { levelId, stars: level.stars, victory: level.victory };
    state.context.isInfinityMode = levelId !== 49;
    return state;
}

describe('structural mastery setup guidance', () => {
    it('uses the drained-board bound to exclude five final Quads without asserting construction', () => {
        const bound = drainedTerminalInventoryBound();
        expect(bound).toMatchObject({
            preLockMaximumCells: 220,
            terminalMaximumCells: 224,
            maximumTerminalLines: 22,
            maximumTerminalQuads: 4,
            minimumPriorQuads: 8,
            minimumTotalLines: 52,
            minimumPiecesFromEmpty: 130,
        });
        expect((8 + 3 * 5) * 10).toBeGreaterThan(bound.terminalMaximumCells);
        expect((8 + 3 * 4) * 10).toBeLessThanOrEqual(bound.terminalMaximumCells);
        expect(bound.assumptions.join(' ')).toContain('fully drained');
        expect(bound.interpretation).toContain('neither legal construction nor timing');
        expect(drainedTerminalInventoryBound({ totalQuads: 0 }).minimumTotalLines).toBe(8);
        expect(drainedTerminalInventoryBound({ totalQuads: 2 }).minimumTotalLines).toBe(14);
        expect(drainedTerminalInventoryBound({ boardRows: 104, hiddenRows: 0 }).maximumTerminalQuads).toBe(23);
    });

    it('separates the untimed lock-bonus restriction from smaller timed bonuses and retains extra-Quad routes', () => {
        const untimed = orb49InventoryRoutes(node(), { minimumFutureLockBonus: 50 });
        expect(untimed.routes[0]).toMatchObject({
            priorQuads: 8,
            minimumFinalQuads: 4,
            terminalLines: 20,
            minimumFutureLocks: 130,
            minimumQuadScore: 28400,
            minimumPreterminalScore: 34850,
        });
        expect(untimed.routes.filter((route) => route.scoreRelaxationSurvives).map((route) => route.priorQuads))
            .toEqual([8]);
        const timed = orb49InventoryRoutes(node(), { minimumFutureLockBonus: 0 });
        expect(timed.routes.filter((route) => route.scoreRelaxationSurvives).map((route) => route.priorQuads))
            .toEqual([8, 9]);
        expect(timed.routes[1].minimumFinalQuads).toBe(3);
        expect(timed.interpretation).toContain('Additional final Quads remain possible');
    });

    it('measures an actual open edge shaft and contiguous Quad rows without adding trigger cells', () => {
        const board = boardWithWell();
        const before = structuredClone(board);
        expect(measureQuadWell(board)).toMatchObject({
            readyRows: 4, longestReadyRun: 4, wellCells: 0, outsideHoles: 0, outsideBumpiness: 0,
        });
        expect(board).toEqual(before);
        board[22][9] = { id: 'blocked-shaft' };
        expect(measureQuadWell(board)).toMatchObject({ readyRows: 3, longestReadyRun: 2, wellCells: 1 });
    });

    it('prioritizes eight prefix Quads at 49, then stored material, retaining the authored goal', () => {
        const objective = createMasteryGeometryObjective(observation(49));
        expect(objective).toMatchObject({
            phase: 'quad-prefix', priorQuadTarget: 8, chainDepth: 8, wellColumn: 9,
        });
        const quad = node({
            metrics: {
                ...node().metrics, tetrises: 1, lines: 4, score: 3400,
            },
        });
        const single = node({
            metrics: {
                ...node().metrics, singles: 1, lines: 1, score: 425,
            },
        });
        expect(masteryGeometryUtility(quad, objective)).toBeGreaterThan(masteryGeometryUtility(single, objective));
        expect(createMasteryGeometryObjective(observation(49, { tetrises: 8 })))
            .toMatchObject({ phase: 'chain-storage', minimumStoredCells: 200, chainDepth: 8 });
    });

    it('keeps showcase depth milestones distinct from authored mastery and skips independent Quad bonuses', () => {
        const initial = createMasteryGeometryObjective(observation(56));
        expect(initial).toMatchObject({
            phase: 'chain-storage', buildDepth: 6, chainDepth: 18, targetCascades: 35,
        });
        expect(initial.priorQuadTarget).toBe(0);
        expect(createMasteryGeometryObjective(observation(56, { maxCombo: 6, maxCascadeDepth: 6 })))
            .toMatchObject({ phase: 'chain-storage', buildDepth: 8, chainDepth: 18 });
        expect(createMasteryGeometryObjective(observation(60, { maxCombo: 12, maxCascadeDepth: 12 })))
            .toMatchObject({ phase: 'sequence-collection', targetCascades: 25 });
    });
});
