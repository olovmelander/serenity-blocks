import { describe, expect, it } from 'vitest';
import { cloneBoardGrid, createBoardGrid } from '../board.js';
import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { getBotDifficultyConfig, normalizeDifficultyTier } from './bot-difficulty.js';
import { analyzeCascadePreparation, evaluateCandidate, measureBoard } from './board-evaluator.js';
import { simulatePlacement } from './cascade-simulator.js';
import { canPlaceCandidate, findReachablePlacements } from './reachability-pathfinder.js';
import { PuzzleBotController } from './puzzle-bot-controller.js';

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function cell(id = 'test') {
    return {
        color: 'I',
        id,
        type: 'I',
    };
}

function fillColumn(boardGrid, column, height, prefix = 'stack') {
    const bottom = boardGrid.length - 1;
    for (let offset = 0; offset < height; offset++) {
        boardGrid[bottom - offset][column] = cell(`${prefix}-${column}-${offset}`);
    }
}

function makeCombSurface(height) {
    const boardGrid = createBoardGrid();
    for (let x = 0; x < COLS; x += 2) {
        fillColumn(boardGrid, x, height, `comb-${height}`);
    }
    return boardGrid;
}

function makeLeftSideLane(height = 8) {
    const boardGrid = createBoardGrid();
    for (let x = 1; x <= 3; x++) {
        fillColumn(boardGrid, x, height, 'left-lane-support');
    }
    return boardGrid;
}

function addHorizontalI(boardGrid, y, startX = 0, id = 'i-bridge') {
    for (let x = startX; x < startX + 4; x++) {
        boardGrid[y][x] = cell(`${id}-${x}`);
    }
}

describe('bot difficulty', () => {
    it('normalizes tiers and derives an action interval', () => {
        expect(normalizeDifficultyTier(-4)).toBe(1);
        expect(normalizeDifficultyTier(12)).toBe(10);
        expect(normalizeDifficultyTier(undefined)).toBe(10);

        const config = getBotDifficultyConfig(7);
        expect(config.tier).toBe(7);
        expect(config.actionIntervalMs).toBeGreaterThan(0);
        expect(config.hardDropChance).toBe(1);
        expect(getBotDifficultyConfig(10).comboAggression).toBe(1);
        expect(getBotDifficultyConfig(10).survivalInstinct).toBeGreaterThan(1);
        expect(getBotDifficultyConfig(10).lookaheadDepth).toBeGreaterThan(1);
    });
});
describe('board evaluator', () => {
    it('detects holes and column height features', () => {
        const boardGrid = createBoardGrid();
        const bottom = boardGrid.length - 1;
        boardGrid[bottom - 2][0] = cell('cap');
        boardGrid[bottom][0] = cell('floor');

        const metrics = measureBoard(boardGrid);

        expect(metrics.holes).toBe(1);
        expect(metrics.heights[0]).toBe(3);
        expect(metrics.maxHeight).toBe(3);
    });

    it('recognizes trigger rows with payload and upcoming-piece step matches', () => {
        const boardGrid = createBoardGrid();
        const bottom = boardGrid.length - 1;

        for (let x = 1; x < COLS; x++) {
            boardGrid[bottom][x] = cell(`trigger-${x}`);
        }
        for (let x = 3; x <= 7; x++) {
            boardGrid[bottom - 3][x] = cell(`payload-${x}`);
        }

        const preparation = analyzeCascadePreparation(boardGrid, ['I', 'T']);

        expect(preparation.triggerRows).toBeGreaterThan(0);
        expect(preparation.triggerPayloadCells).toBeGreaterThan(0);
        expect(preparation.preparationScore).toBeGreaterThan(0);
    });

    it('scores multi-wave cascade afterstates above isolated single clears', () => {
        const boardGrid = createBoardGrid();
        const config = getBotDifficultyConfig(10);
        const single = evaluateCandidate({
            boardGrid,
            cascadeCount: 1,
            cascadeLineScore: 12,
            cascadeWeightedLines: 1,
            landingHeight: 4,
            maxWaveLines: 1,
            totalLines: 1,
        }, config, () => 0.5);
        const chain = evaluateCandidate({
            boardGrid,
            cascadeCount: 3,
            cascadeLineScore: 150,
            cascadeWeightedLines: 9,
            landingHeight: 4,
            maxWaveLines: 2,
            totalLines: 4,
        }, config, () => 0.5);

        expect(chain.score).toBeGreaterThan(single.score + 100);
    });

    it('measures ceiling pressure when a stack enters the danger band', () => {
        const boardGrid = makeCombSurface(18);

        const metrics = measureBoard(boardGrid);

        expect(metrics.maxHeight).toBe(18);
        expect(metrics.dangerHeight).toBeLessThan(metrics.maxHeight);
        expect(metrics.ceilingPressure).toBeGreaterThan(0);
        expect(metrics.dangerZoneCells).toBeGreaterThan(0);
        expect(metrics.safeStackMargin).toBeLessThan(4);
        expect(metrics.pressureRatio).toBeGreaterThan(0.5);
    });

    it('devalues trigger rows that are built too close to the ceiling', () => {
        const lowFuse = createBoardGrid();
        const highFuse = createBoardGrid();
        const bottom = lowFuse.length - 1;
        const highY = HIDDEN_ROWS + 2;

        for (let x = 1; x < COLS; x++) {
            lowFuse[bottom][x] = cell(`low-trigger-${x}`);
            highFuse[highY][x] = cell(`high-trigger-${x}`);
        }

        for (let x = 3; x <= 7; x++) {
            lowFuse[bottom - 3][x] = cell(`low-payload-${x}`);
            highFuse[highY - 1][x] = cell(`high-payload-${x}`);
        }

        const lowPreparation = analyzeCascadePreparation(lowFuse, ['I']);
        const highPreparation = analyzeCascadePreparation(highFuse, ['I']);

        expect(highPreparation.triggerDangerScore).toBeGreaterThan(0);
        expect(lowPreparation.preparationScore).toBeGreaterThan(highPreparation.preparationScore);
    });

    it('prefers clearing down over no-clear setup under ceiling pressure', () => {
        const config = getBotDifficultyConfig(10);
        const overbuiltBoard = makeCombSurface(18);
        const loweredBoard = makeCombSurface(12);

        const setup = evaluateCandidate({
            boardGrid: overbuiltBoard,
            cascadeCount: 0,
            landingHeight: 18,
            totalLines: 0,
        }, config, () => 0.5);
        const clear = evaluateCandidate({
            boardGrid: loweredBoard,
            cascadeCount: 1,
            cascadeLineScore: 42,
            cascadeWeightedLines: 2,
            landingHeight: 12,
            maxWaveLines: 2,
            totalLines: 2,
        }, config, () => 0.5);

        expect(clear.score).toBeGreaterThan(setup.score);
        expect(setup.metrics.pressureRatio).toBeGreaterThan(clear.metrics.pressureRatio);
    });

    it('treats a plugged side lane as a better cascade setup than a naked empty edge column', () => {
        const emptyLane = makeLeftSideLane(8);
        const pluggedLane = makeLeftSideLane(8);
        pluggedLane[pluggedLane.length - 1][0] = cell('lane-stopper');

        const emptyPreparation = analyzeCascadePreparation(emptyLane, ['I']);
        const pluggedPreparation = analyzeCascadePreparation(pluggedLane, ['I']);

        expect(emptyPreparation.emptySideLanePenalty).toBeGreaterThan(0);
        expect(pluggedPreparation.sideLaneStopperScore).toBeGreaterThan(0);
        expect(pluggedPreparation.preparationScore).toBeGreaterThan(emptyPreparation.preparationScore);
    });

    it('rewards a green I bridge over a prepared left cascade lane', () => {
        const config = getBotDifficultyConfig(10);
        const before = makeLeftSideLane(7);
        const bridge = cloneBoardGrid(before);
        const bridgeY = bridge.length - 8;
        const preparationBefore = analyzeCascadePreparation(before, ['I']);

        addHorizontalI(bridge, bridgeY, 0, 'left-i-bridge');

        const waiting = evaluateCandidate({
            boardGrid: before,
            cascadeCount: 0,
            landingHeight: 5,
            preparationBefore,
            totalLines: 0,
        }, config, () => 0.5);
        const iBridge = evaluateCandidate({
            boardGrid: bridge,
            cascadeCount: 0,
            landingHeight: 8,
            pieceCells: [
                { x: 0, y: bridgeY },
                { x: 1, y: bridgeY },
                { x: 2, y: bridgeY },
                { x: 3, y: bridgeY },
            ],
            preparationBefore,
            shapeKey: 'I',
            totalLines: 0,
        }, config, () => 0.5);

        expect(iBridge.metrics.preparationAfter.sideLaneIPayloadScore).toBeGreaterThan(0);
        expect(iBridge.metrics.sideLaneAction.sideLaneBridgePlacementScore).toBeGreaterThan(0);
        expect(iBridge.score).toBeGreaterThan(waiting.score);
    });
});

describe('cascade simulator', () => {
    it('clears a direct line after placing the candidate piece', () => {
        const boardGrid = createBoardGrid();
        const bottom = boardGrid.length - 1;
        for (let x = 1; x < COLS; x++) {
            boardGrid[bottom][x] = cell(`floor-${x}`);
        }

        const result = simulatePlacement({ boardGrid }, {
            shape: [[1]],
            shapeKey: 'I',
            x: 0,
            y: bottom,
        });

        expect(result.totalLines).toBe(1);
        expect(result.cascadeCount).toBe(1);
        expect(result.perfectClear).toBe(true);
    });

    it('scores a second wave when falling components complete another line', () => {
        const boardGrid = createBoardGrid();
        const bottom = boardGrid.length - 1;

        for (let x = 1; x < COLS; x++) {
            boardGrid[bottom][x] = cell(`first-${x}`);
            boardGrid[bottom - 1][x] = cell('shelf');
        }
        boardGrid[bottom - 2][0] = cell('cap');

        const result = simulatePlacement({ boardGrid }, {
            shape: [[1]],
            shapeKey: 'I',
            x: 0,
            y: bottom,
        });

        expect(result.totalLines).toBe(2);
        expect(result.cascadeCount).toBe(2);
        expect(result.cascadeLineScore).toBeGreaterThan(0);
        expect(result.cascadeWeightedLines).toBeGreaterThan(result.totalLines);
        expect(result.perfectClear).toBe(true);
    });
});

describe('reachability pathfinder', () => {
    it('finds grounded placements from the spawn state', () => {
        const boardGrid = createBoardGrid();
        const state = {
            boardGrid,
            currentPiece: {
                shape: cloneShape(SHAPES.T),
                shapeKey: 'T',
                rotation: 0,
                x: 3,
                y: HIDDEN_ROWS - 2,
            },
        };

        const placements = findReachablePlacements(state);

        expect(placements.length).toBeGreaterThan(0);
        for (const placement of placements) {
            expect(placement.actions.some((action) => action.type === 'softDrop')).toBe(false);
            expect(canPlaceCandidate(boardGrid, placement)).toBe(true);
            expect(canPlaceCandidate(boardGrid, {
                ...placement,
                y: placement.y + 1,
            })).toBe(false);
        }
    });
});

describe('puzzle bot controller', () => {
    it('uses lookahead and ends high-skill plans with hard drop', () => {
        const boardGrid = createBoardGrid();
        const state = {
            boardGrid,
            currentPiece: {
                shape: cloneShape(SHAPES.T),
                shapeKey: 'T',
                rotation: 0,
                x: 3,
                y: HIDDEN_ROWS - 2,
            },
            nextPieces: ['I', 'O'],
        };
        const bot = new PuzzleBotController({
            actions: {},
            difficulty: 10,
            playerIndex: 0,
            playerState: state,
            rng: () => 0.5,
        });

        const plan = bot.plan();

        expect(plan.actions[plan.actions.length - 1]).toEqual({ type: 'hardDrop' });
        expect(plan.actions.some((action) => action.type === 'softDrop')).toBe(false);
        expect(plan.candidate.nextCandidate).toBeTruthy();
        expect(plan.candidate.futurePlan.depth).toBeGreaterThan(1);
    });

    it('replans when the active piece object is reused by the piece pool', () => {
        const boardGrid = createBoardGrid();
        const reusedPiece = {
            shape: cloneShape(SHAPES.T),
            shapeKey: 'T',
            rotation: 0,
            x: 3,
            y: HIDDEN_ROWS - 2,
        };
        const state = {
            boardGrid,
            currentPiece: reusedPiece,
            isAlive: true,
            nextPieces: ['I', 'O'],
            piecesPlaced: 1,
        };
        const bot = new PuzzleBotController({
            actions: {},
            difficulty: 10,
            playerIndex: 0,
            playerState: state,
            rng: () => 0,
        });

        bot.update(16, 0);
        const firstPlan = bot.lastPlan;

        state.isProcessingPhysics = true;
        state.currentPiece = null;
        bot.update(16, 16);

        reusedPiece.shape = cloneShape(SHAPES.O);
        reusedPiece.shapeKey = 'O';
        reusedPiece.rotation = 0;
        reusedPiece.x = 4;
        reusedPiece.y = HIDDEN_ROWS - 2;
        state.currentPiece = reusedPiece;
        state.isProcessingPhysics = false;
        state.nextPieces = ['S', 'Z'];
        state.piecesPlaced = 2;

        bot.update(16, 32);

        expect(bot.lastPlan).toBeTruthy();
        expect(bot.lastPlan).not.toBe(firstPlan);
        expect(bot.lastPlan.candidate.shapeKey).toBe('O');
        expect(bot.lastPlan.actions[bot.lastPlan.actions.length - 1]).toEqual({ type: 'hardDrop' });
    });

    it('uses an available I piece to work the left cascade lane instead of ignoring it', () => {
        const boardGrid = makeLeftSideLane(7);
        const state = {
            boardGrid,
            currentPiece: {
                shape: cloneShape(SHAPES.I),
                shapeKey: 'I',
                rotation: 0,
                x: 3,
                y: HIDDEN_ROWS - 2,
            },
            nextPieces: ['T', 'O'],
        };
        const bot = new PuzzleBotController({
            actions: {},
            difficulty: 10,
            playerIndex: 0,
            playerState: state,
            rng: () => 0.5,
        });

        const plan = bot.plan();

        expect(plan.candidate.pieceCells.some((pieceCell) => pieceCell.x === 0)).toBe(true);
    });
});
