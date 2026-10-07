import { describe, expect, it } from 'vitest';
import {
    repairMasteryPath, MASTERY_PATH_REPAIR_DEFAULTS,
} from '../../scripts/odyssey-benchmark/mastery-path-repair.mjs';
import { createVirtualClock } from '../../scripts/odyssey-benchmark/virtual-clock.mjs';
import {
    canPlacePiece, move, rotate, rotateShapeMatrix, softDrop,
} from '../../src/core/game.js';
import { SHAPES } from '../../src/core/constants.js';

const budget = { maxNodes: 4096, wallBudgetMs: 1000 };
const emptyBoard = () => Array.from({ length: 24 }, () => Array(10).fill(null));
function piece(shapeKey = 'I', x = 3, y = 2, rotation = 0) {
    let shape = structuredClone(SHAPES[shapeKey]);
    for (let index = 0; index < rotation; index++) shape = rotateShapeMatrix(shape, 'right');
    return {
        shapeKey, x, y, rotation, shape,
    };
}
const pose = (value) => ({
    shapeKey: value.shapeKey, x: value.x, y: value.y, rotation: value.rotation,
});

/** Validate every pre-lock input with production movement, never accepting a grounded soft drop. */
function executeSpatialPath(observation, actions) {
    const state = {
        boardGrid: structuredClone(observation.boardGrid),
        lockedPieces: [],
        currentPiece: structuredClone(observation.currentPiece),
        lockResetCount: 0,
    };
    expect(actions.at(-1)).toEqual({ type: 'hardDrop' });
    for (const action of actions.slice(0, -1)) {
        const before = pose(state.currentPiece);
        if (action.type === 'move') expect(move(state, action.dir)).toBe(true);
        else if (action.type === 'rotate') expect(rotate(state, action.dir)).toBe(true);
        else {
            expect(action.type).toBe('softDrop');
            expect(softDrop(state)).toBe(true);
        }
        expect(pose(state.currentPiece)).not.toEqual(before);
    }
    while (canPlacePiece(state, state.currentPiece, state.currentPiece.x, state.currentPiece.y + 1)) {
        state.currentPiece.y++;
    }
    return pose(state.currentPiece);
}

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

describe('bounded Odyssey exact-target path repair', () => {
    it('repairs a gravity-drifted pose without enumerating/scoring future placements', () => {
        const observation = { currentPiece: piece('I', 3, 12), boardGrid: emptyBoard() };
        const target = pose(piece('I', 0, 22));
        const repaired = repairMasteryPath(observation, target, budget);
        expect(repaired.status).toBe('reachable');
        expect(repaired.target).toEqual(target);
        expect(repaired.actions).toEqual([
            { type: 'move', dir: -1 }, { type: 'move', dir: -1 }, { type: 'move', dir: -1 },
            { type: 'hardDrop' },
        ]);
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(target);
        expect(repaired.diagnostics.nodes).toBeLessThan(4096);
        expect(repaired.diagnostics).toMatchObject({
            targetPolicy: 'exact-pose-and-shape', timingFeasibility: 'unverified', scoringHistoryPreserved: false,
        });
    });

    it('reports an exact target lost below a wall after gravity, rather than substituting another placement', () => {
        const boardGrid = emptyBoard();
        for (let y = 10; y < 24; y++) boardGrid[y][4] = { id: `wall:${y}` };
        const target = pose(piece('O', 6, 22));
        const before = { boardGrid, currentPiece: piece('O', 1, 7) };
        const after = { boardGrid, currentPiece: piece('O', 1, 11) };
        const original = repairMasteryPath(before, target, budget);
        expect(original.status).toBe('reachable');
        expect(executeSpatialPath(before, original.actions)).toEqual(target);
        const lost = repairMasteryPath(after, target, budget);
        expect(lost).toMatchObject({
            status: 'unreachable', reason: 'no-spatial-path', target, actions: [],
        });
        expect(lost.diagnostics.stoppedByNodes).toBe(false);
    });

    it('uses production I wall kicks from the observed orientation', () => {
        const observation = { currentPiece: piece('I', -2, 8, 1), boardGrid: emptyBoard() };
        const target = pose(piece('I', 0, 22));
        const repaired = repairMasteryPath(observation, target, budget);
        expect(repaired.status).toBe('reachable');
        expect(repaired.actions).toEqual([{ type: 'rotate', dir: 'left' }, { type: 'hardDrop' }]);
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(target);
    });

    it('retains necessary soft drops before sliding under a supported overhang', () => {
        const boardGrid = emptyBoard();
        for (let x = 4; x <= 6; x++) boardGrid[20][x] = { id: 'overhang' };
        for (let y = 21; y < 24; y++) boardGrid[y][6] = { id: 'support' };
        const observation = { currentPiece: piece('O', 2, 18), boardGrid };
        const target = pose(piece('O', 4, 22));
        const repaired = repairMasteryPath(observation, target, budget);
        expect(repaired.status).toBe('reachable');
        expect(repaired.actions.filter((action) => action.type === 'softDrop')).toHaveLength(3);
        expect(repaired.actions.at(-2)).toEqual({ type: 'move', dir: 1 });
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(target);
    });

    it('keeps exact equivalent-footprint rotations and never treats O quarter-turn no-ops as edges', () => {
        const observation = { currentPiece: piece('O', 3, 22), boardGrid: emptyBoard() };
        const flipped = pose(piece('O', 3, 22, 2));
        const repaired = repairMasteryPath(observation, flipped, budget);
        expect(repaired.status).toBe('reachable');
        expect(repaired.actions).toEqual([{ type: 'rotate', dir: 'flip' }, { type: 'hardDrop' }]);
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(flipped);
        const impossibleOrientation = repairMasteryPath(observation, pose(piece('O', 3, 22, 1)), budget);
        expect(impossibleOrientation).toMatchObject({
            status: 'unreachable', reason: 'no-spatial-path', actions: [],
        });
    });

    it('hard-drops an already grounded exact target instead of issuing a grounded soft-drop stop', () => {
        const observation = { currentPiece: piece('O', 0, 22), boardGrid: emptyBoard() };
        const target = pose(observation.currentPiece);
        const repaired = repairMasteryPath(observation, target, { ...budget, maxNodes: 1 });
        expect(repaired).toMatchObject({
            status: 'reachable', actions: [{ type: 'hardDrop' }], diagnostics: { nodes: 1, expandedNodes: 1 },
        });
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(target);
    });

    it('does not confuse symmetric I rotations with the same physical footprint', () => {
        const observation = { currentPiece: piece('I', 3, 22), boardGrid: emptyBoard() };
        // Orientation 2 occupies matrix row 2 instead of row 1, so identical cells use y=21.
        const target = pose(piece('I', 3, 21, 2));
        const repaired = repairMasteryPath(observation, target, budget);
        expect(repaired.status).toBe('reachable');
        expect(repaired.actions).not.toEqual([{ type: 'hardDrop' }]);
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(target);
    });

    it('distinguishes a capped search from exhausted reachability and never exceeds admitted-state budget', () => {
        const observation = { currentPiece: piece('I'), boardGrid: emptyBoard() };
        const target = pose(piece('I', 0, 22));
        for (const maxNodes of [1, 2, 3, 7]) {
            const result = repairMasteryPath(observation, target, { ...budget, maxNodes });
            expect(result).toMatchObject({
                status: 'budget',
                reason: 'node-budget',
                actions: [],
                diagnostics: { nodes: maxNodes, stoppedByNodes: true, truncatedByNodes: true },
            });
            expect(result.diagnostics.expandedNodes).toBeLessThanOrEqual(maxNodes);
        }
    });

    it('uses native elapsed time for its wall cap while virtual gameplay time is frozen', () => {
        const clock = createVirtualClock().install();
        try {
            const result = repairMasteryPath(
                { currentPiece: piece(), boardGrid: emptyBoard() },
                pose(piece('I', 0, 22)),
                { maxNodes: 4096, wallBudgetMs: 0.000001 },
            );
            expect(result).toMatchObject({
                status: 'budget',
                reason: 'wall-budget',
                actions: [],
                diagnostics: { stoppedByWall: true, stoppedByNodes: false },
            });
            expect(clock.now).toBe(0);
            expect(performance.now()).toBe(0);
        } finally { clock.restore(); }
    });

    it('leaves deeply frozen inputs intact and never reads previews or hidden state/options', () => {
        const observation = {
            currentPiece: freeze(piece('T', 3, 8)), boardGrid: freeze(emptyBoard()),
        };
        const target = freeze(pose(piece('T', 2, 21)));
        const options = { ...budget };
        for (const name of ['seed', 'randomGenerator', 'nextPieces', 'preview', 'lockedPieces', 'metrics']) {
            Object.defineProperty(observation, name, { get() { throw new Error(`Forbidden observation ${name}`); } });
            Object.defineProperty(options, name, { get() { throw new Error(`Forbidden option ${name}`); } });
        }
        Object.freeze(observation);
        Object.freeze(options);
        const before = JSON.stringify({ currentPiece: observation.currentPiece, boardGrid: observation.boardGrid });
        const repaired = repairMasteryPath(observation, target, options);
        expect(repaired.status).toBe('reachable');
        expect(executeSpatialPath(observation, repaired.actions)).toEqual(target);
        const after = JSON.stringify({ currentPiece: observation.currentPiece, boardGrid: observation.boardGrid });
        expect(after).toBe(before);
        expect(repaired.target).not.toBe(target);
    });

    it('rejects malformed geometry/budgets and explicitly reports invalidated targets', () => {
        const observation = { currentPiece: piece('I'), boardGrid: emptyBoard() };
        const target = pose(piece('I', 0, 22));
        for (const maxNodes of [0, -1, 1.5, 100001]) {
            expect(() => repairMasteryPath(observation, target, { maxNodes })).toThrow(/maxNodes/);
        }
        for (const wallBudgetMs of [0, -1, Infinity, NaN]) {
            expect(() => repairMasteryPath(observation, target, { wallBudgetMs })).toThrow(/wallBudgetMs/);
        }
        expect(MASTERY_PATH_REPAIR_DEFAULTS.maxNodes).toBeGreaterThan(0);
        expect(() => repairMasteryPath({ ...observation, currentPiece: { ...piece(), shape: [[1]] } }, target))
            .toThrow(/shape must match/);
        expect(() => repairMasteryPath(observation, { ...target, x: 0.5 })).toThrow(/target/);
        expect(repairMasteryPath(observation, pose(piece('O', 0, 22)), budget))
            .toMatchObject({ status: 'unreachable', reason: 'different-piece-shape', actions: [] });
        expect(repairMasteryPath(observation, { ...target, y: 10 }, budget))
            .toMatchObject({ status: 'unreachable', reason: 'target-not-grounded', actions: [] });
        observation.boardGrid[23][0] = { id: 'new-obstruction' };
        expect(repairMasteryPath(observation, target, budget))
            .toMatchObject({ status: 'unreachable', reason: 'target-collision', actions: [] });
    });
});
