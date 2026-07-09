import { describe, expect, it } from 'vitest';
import { cloneBoardGrid, createBoardGrid } from '../board.js';
import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { getBotDifficultyConfig } from './bot-difficulty.js';
import {
    analyzeCascadePreparation,
    evaluateCandidate,
    measureBoard,
} from './board-evaluator.js';
import { analyzeSideCascade } from './side-cascade-analyzer.js';
import { estimateLatentDischarge } from './latent-chain.js';
import { simulatePlacement, computeProjectedAttack } from './cascade-simulator.js';
import { PuzzleBotController } from './puzzle-bot-controller.js';

const VERTICAL_I = [[1], [1], [1], [1]];

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function cell(id = 'x', type = 'S') {
    return { color: type, id, type };
}

function fillColumn(boardGrid, column, height, prefix = 'stack') {
    const bottom = boardGrid.length - 1;
    for (let offset = 0; offset < height; offset++) {
        boardGrid[bottom - offset][column] = cell(`${prefix}-${column}-${offset}`);
    }
}

function makeSideLane(side, height = 8) {
    const boardGrid = createBoardGrid();
    const supportColumns = side === 'left' ? [1, 2, 3] : [COLS - 2, COLS - 3, COLS - 4];
    for (const column of supportColumns) {
        fillColumn(boardGrid, column, height, `${side}-support`);
    }
    return boardGrid;
}

// Bottom `rows` rows full EXCEPT the edge column — the fireable I-well machine.
function makeFullRowsExceptEdge(edgeColumn, rows) {
    const boardGrid = createBoardGrid();
    const bottom = boardGrid.length - 1;
    for (let r = 0; r < rows; r++) {
        for (let x = 0; x < COLS; x++) {
            if (x === edgeColumn) continue;
            boardGrid[bottom - r][x] = cell(`fr-${r}-${x}`);
        }
    }
    return boardGrid;
}

function makeStaircase(stepHeights) {
    const boardGrid = createBoardGrid();
    stepHeights.forEach((height, column) => fillColumn(boardGrid, column, height, 'stair'));
    return boardGrid;
}

describe('cascade simulator — projected attack (fidelity)', () => {
    it('reports depth-1 + clean bonus garbage for a clearing placement', () => {
        const boardGrid = makeFullRowsExceptEdge(0, 1);
        const result = simulatePlacement({ boardGrid }, {
            shape: [[1]],
            shapeKey: 'I',
            x: 0,
            y: boardGrid.length - 1,
        });

        expect(result.totalLines).toBe(1);
        expect(result.perfectClear).toBe(true);
        // single + clean: (1-1) + floor((1+1)/2) = 0 + 1 = 1
        expect(result.projectedAttack).toBe(1);
        expect(result.projectedAttack).toBe(computeProjectedAttack(1, true));
    });

    it('scales projected attack with cascade depth', () => {
        const boardGrid = makeFullRowsExceptEdge(COLS - 1, 4);
        const result = simulatePlacement({ boardGrid }, {
            shape: VERTICAL_I,
            shapeKey: 'I',
            x: COLS - 1,
            y: boardGrid.length - 4,
        });

        expect(result.totalLines).toBe(4);
        // quad + clean: (4-1) + floor((1+4)/2) = 3 + 2 = 5
        expect(result.projectedAttack).toBe(5);
    });
});

describe('latent-chain (hypothetical-trigger) evaluation', () => {
    it('detects a fireable side-well discharge by simulating the trigger', () => {
        const boardGrid = makeFullRowsExceptEdge(COLS - 1, 4);
        const { sideLanes } = analyzeSideCascade(boardGrid, measureBoard(boardGrid), []);

        const latent = estimateLatentDischarge(boardGrid, sideLanes, ['I']);

        expect(latent.latentDepth).toBeGreaterThanOrEqual(4);
        expect(latent.latentAttack).toBeGreaterThan(0);
        expect(latent.hasTrigger).toBe(true);
    });

    it('returns no latent discharge on a flat board with no well', () => {
        const boardGrid = createBoardGrid();
        for (let x = 0; x < COLS; x++) fillColumn(boardGrid, x, 3, 'flat');
        const { sideLanes } = analyzeSideCascade(boardGrid, measureBoard(boardGrid), []);

        const latent = estimateLatentDischarge(boardGrid, sideLanes, ['I']);

        expect(latent.latentDepth).toBe(0);
    });

    it('values a fire-low row-completion trigger that is reachable from the top', () => {
        // Near-full rows whose only gap is an OPEN mid-column well (col 5, empty from
        // the top down) — no edge well, so the I-drop probe finds nothing; only the
        // row-completion trigger fires. Completing the reachable gap clears a line.
        const boardGrid = createBoardGrid();
        const bottom = boardGrid.length - 1;
        for (let r = 0; r < 3; r++) {
            for (let x = 0; x < COLS; x++) {
                if (x === 5) continue; // col 5 = open mid-well, reachable from the top
                boardGrid[bottom - r][x] = cell(`field-${r}-${x}`);
            }
        }
        const { sideLanes } = analyzeSideCascade(boardGrid, measureBoard(boardGrid), []);

        // No I in the queue — the row-completion trigger is completable by any piece.
        const latent = estimateLatentDischarge(boardGrid, sideLanes, ['T']);

        expect(latent.latentDepth).toBeGreaterThanOrEqual(1);
        expect(latent.hasTrigger).toBe(true);
    });

    it('does NOT value a sealed (capped/unreachable) trigger row — no re-validated trap', () => {
        // Full-except-edge rows BELOW a cap: the gap column is filled above (the cap),
        // so the trigger is unreachable from the top. Neither probe reports a discharge.
        const boardGrid = makeFullRowsExceptEdge(COLS - 1, 4);
        const bottom = boardGrid.length - 1;
        boardGrid[bottom - 4][COLS - 1] = cell('cap', 'I'); // cap sealing the edge well
        const { sideLanes } = analyzeSideCascade(boardGrid, measureBoard(boardGrid), []);

        const latent = estimateLatentDischarge(boardGrid, sideLanes, ['T']);

        expect(latent.latentDepth).toBe(0);
    });

    it('values an in-progress machine board above an equivalently tall flat board', () => {
        const config = getBotDifficultyConfig(10);
        const machineBoard = makeFullRowsExceptEdge(COLS - 1, 4);
        const flatBoard = createBoardGrid();
        for (let x = 0; x < COLS; x++) fillColumn(flatBoard, x, 4, 'flat');

        const machine = evaluateCandidate({
            boardGrid: machineBoard,
            cascadeCount: 0,
            landingHeight: 4,
            nextShapeKeys: ['I'],
            totalLines: 0,
        }, config, () => 0.5);
        const flat = evaluateCandidate({
            boardGrid: flatBoard,
            cascadeCount: 0,
            landingHeight: 4,
            nextShapeKeys: ['I'],
            totalLines: 0,
        }, config, () => 0.5);

        expect(machine.metrics.latentDischarge.latentDepth).toBeGreaterThan(0);
        expect(machine.score).toBeGreaterThan(flat.score);
    });
});

describe('side-cascade analyzer — both edges & safety', () => {
    it('flags a naked empty lane and rewards a stopper on the RIGHT edge', () => {
        const emptyLane = makeSideLane('right', 8);
        const pluggedLane = cloneBoardGrid(emptyLane);
        pluggedLane[pluggedLane.length - 1][COLS - 1] = cell('right-stopper');

        const emptyPreparation = analyzeCascadePreparation(emptyLane, ['I']);
        const pluggedPreparation = analyzeCascadePreparation(pluggedLane, ['I']);

        expect(emptyPreparation.emptySideLanePenalty).toBeGreaterThan(0);
        expect(pluggedPreparation.sideLaneStopperScore).toBeGreaterThan(0);
        expect(pluggedPreparation.preparationScore)
            .toBeGreaterThan(emptyPreparation.preparationScore);
    });

    it('marks an over-deep well as unsafe', () => {
        const deep = makeSideLane('right', 14); // col 9 empty all the way down
        const shallow = makeSideLane('right', 5);

        const deepLanes = analyzeSideCascade(deep, measureBoard(deep), []).sideLanes;
        const shallowLanes = analyzeSideCascade(shallow, measureBoard(shallow), []).sideLanes;

        const deepRight = deepLanes.find((lane) => lane.edgeColumn === COLS - 1);
        const shallowRight = shallowLanes.find((lane) => lane.edgeColumn === COLS - 1);

        expect(deepRight.unsafe).toBe(true);
        expect(shallowRight.unsafe).toBe(false);
    });
});

describe('staircase tactic (T2/T3)', () => {
    it('rewards a homogeneous unit-step staircase', () => {
        const boardGrid = makeStaircase([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const preparation = analyzeCascadePreparation(boardGrid, []);

        expect(preparation.staircaseMatch).toBeGreaterThan(0);
        expect(preparation.staircaseAlternation).toBe(0);
    });

    it('penalizes an alternating (S<->Z merging) zigzag surface', () => {
        const boardGrid = makeStaircase([2, 3, 2, 3, 2, 3, 2, 3, 2, 3]);
        const preparation = analyzeCascadePreparation(boardGrid, []);

        expect(preparation.staircaseAlternation).toBeGreaterThan(0);
    });
});

describe('clean-route reward', () => {
    it('prefers a board-clearing cascade over an identical non-clean one', () => {
        const config = getBotDifficultyConfig(10);
        const base = {
            boardGrid: createBoardGrid(),
            cascadeCount: 1,
            landingHeight: 4,
            maxWaveLines: 2,
            totalLines: 4,
        };
        const clean = evaluateCandidate({ ...base, perfectClear: true }, config, () => 0.5);
        const dirty = evaluateCandidate({ ...base, perfectClear: false }, config, () => 0.5);

        expect(clean.score).toBeGreaterThan(dirty.score);
    });
});

describe('fire vs sealed-trap (the core fix)', () => {
    it('fires a loaded open I-well with the trigger in hand instead of stalling', () => {
        const boardGrid = makeFullRowsExceptEdge(COLS - 1, 4);
        const bot = new PuzzleBotController({
            actions: {},
            difficulty: 10,
            playerIndex: 0,
            playerState: {
                boardGrid,
                isAlive: true,
                currentPiece: {
                    shape: cloneShape(SHAPES.I),
                    shapeKey: 'I',
                    type: 'I',
                    rotation: 0,
                    x: 3,
                    y: HIDDEN_ROWS - 2,
                },
                nextPieces: ['T', 'O'],
            },
            rng: () => 0.5,
        });

        const { candidate } = bot.plan();

        expect(candidate.totalLines).toBeGreaterThanOrEqual(4);
        expect(candidate.pieceCells.every((pieceCell) => pieceCell.x === COLS - 1)).toBe(true);
    });

    it('values firing a cascade above sealing the well into an unfireable trap', () => {
        const config = getBotDifficultyConfig(10);

        // Sealed trap: 4 full-except-edge rows with a horizontal I capping the well.
        const trap = makeFullRowsExceptEdge(COLS - 1, 4);
        const bottom = trap.length - 1;
        for (let x = COLS - 4; x < COLS; x++) trap[bottom - 4][x] = cell(`cap-${x}`, 'I');

        const sealed = evaluateCandidate({
            boardGrid: trap,
            cascadeCount: 0,
            landingHeight: 5,
            nextShapeKeys: ['T'],
            totalLines: 0,
        }, config, () => 0.5);

        const fired = evaluateCandidate({
            boardGrid: createBoardGrid(),
            cascadeCount: 1,
            landingHeight: 2,
            maxWaveLines: 4,
            perfectClear: true,
            totalLines: 4,
        }, config, () => 0.5);

        expect(sealed.metrics.latentDischarge.latentDepth).toBe(0);
        expect(fired.score).toBeGreaterThan(sealed.score);
    });
});

describe('hole classification (cavity vs overhang) & cleanliness', () => {
    it('classifies covered cells into cavities + overhangs that sum to total holes', () => {
        const boardGrid = createBoardGrid();
        const bottom = boardGrid.length - 1;
        // cols 3 & 5 height 4; col 4 filled rows bottom-3..bottom-1 with bottom EMPTY
        // -> enclosed cavity (both neighbours filled at the bottom row).
        fillColumn(boardGrid, 3, 4);
        fillColumn(boardGrid, 5, 4);
        for (let o = 1; o <= 3; o++) boardGrid[bottom - o][4] = cell(`c4-${o}`);

        const m = measureBoard(boardGrid);
        expect(m.cavityCells).toBeGreaterThanOrEqual(1);
        expect(m.holes).toBe(m.cavityCells + m.overhangCells);
    });

    it('penalizes a cavity-laden board far below a clean board of equal height', () => {
        const config = getBotDifficultyConfig(10);
        const clean = createBoardGrid();
        for (let x = 0; x < COLS - 1; x++) fillColumn(clean, x, 5); // cols 0-8 high, col9 well

        const holey = cloneBoardGrid(clean);
        const bottom = holey.length - 1;
        for (const x of [1, 3, 5, 7]) holey[bottom][x] = null; // 4 buried cavities, same heights

        const cleanEval = evaluateCandidate({ boardGrid: clean, landingHeight: 5, totalLines: 0 }, config, () => 0.5);
        const holeyEval = evaluateCandidate({ boardGrid: holey, landingHeight: 5, totalLines: 0 }, config, () => 0.5);

        expect(cleanEval.metrics.cavityCells).toBe(0);
        expect(holeyEval.metrics.cavityCells).toBeGreaterThanOrEqual(4);
        expect(cleanEval.score).toBeGreaterThan(holeyEval.score);
    });
});

describe('build-vs-fire controller', () => {
    function makeController(boardGrid, overrides = {}) {
        return new PuzzleBotController({
            actions: {},
            difficulty: 10,
            playerIndex: 0,
            playerState: { boardGrid, isAlive: true, ...overrides },
            rng: () => 0.5,
        });
    }

    it('trips the danger gate when spare rows minus pending garbage is low', () => {
        const tallBoard = createBoardGrid();
        for (let x = 0; x < COLS; x += 2) fillColumn(tallBoard, x, 18, 'tall');
        const bot = makeController(tallBoard, { pendingGarbage: 5 });

        const preparation = analyzeCascadePreparation(tallBoard, []);
        const tactics = bot.assessTactics(tallBoard, preparation);

        expect(tactics.danger).toBe(true);
    });

    it('stays calm with ample spare rows and no incoming garbage', () => {
        const lowBoard = createBoardGrid();
        for (let x = 0; x < COLS; x += 2) fillColumn(lowBoard, x, 4, 'low');
        const bot = makeController(lowBoard, { pendingGarbage: 0 });

        const preparation = analyzeCascadePreparation(lowBoard, []);
        const tactics = bot.assessTactics(lowBoard, preparation);

        expect(tactics.danger).toBe(false);
    });
});

describe('persistent machine plan', () => {
    it('commits a multi-piece plan when working a side lane', () => {
        const boardGrid = makeSideLane('left', 7);
        const bot = new PuzzleBotController({
            actions: {},
            difficulty: 10,
            playerIndex: 0,
            playerState: {
                boardGrid,
                currentPiece: {
                    shape: cloneShape(SHAPES.I),
                    shapeKey: 'I',
                    rotation: 0,
                    x: 3,
                    y: HIDDEN_ROWS - 2,
                },
                nextPieces: ['I', 'T'],
            },
            rng: () => 0.5,
        });

        const plan = bot.plan();

        expect(plan.candidate.pieceCells.some((pieceCell) => pieceCell.x === 0)).toBe(true);
        expect(bot.machinePlan).toBeTruthy();
        expect(bot.machinePlan.steps.length).toBeGreaterThan(0);
    });

    it('low tiers do not run cascade planning', () => {
        const config = getBotDifficultyConfig(1);
        expect(config.cascadePlanning).toBe(false);
        expect(config.latentChainEval).toBe(false);
        expect(config.buildVsFire).toBe(false);

        const high = getBotDifficultyConfig(10);
        expect(high.cascadePlanning).toBe(true);
        expect(high.triggerDepthTarget).toBeGreaterThanOrEqual(6);
    });
});
