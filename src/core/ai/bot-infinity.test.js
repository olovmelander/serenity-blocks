import {
    describe, expect, it, vi,
} from 'vitest';
import { cloneBoardGrid, createBoardGrid, rebuildBoardGridFromPieces } from '../board.js';
import { resolveCascade } from '../cascade-resolver.js';
import { GameState, spawnPiece } from '../game.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    INFINITY_SPAWN_POLICY_CAMERA_V1,
} from '../infinity-spawn-policy.js';
import { getBotDifficultyConfig } from './bot-difficulty.js';
import { analyzeCascadePreparation, evaluateCandidate } from './board-evaluator.js';
import { simulateCellFill, simulatePlacement } from './cascade-simulator.js';
import { estimateLatentDischarge } from './latent-chain.js';
import { PuzzleBotController } from './puzzle-bot-controller.js';
import { canPlaceCandidate } from './reachability-pathfinder.js';

function makeInfinityState(policy = INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1) {
    const state = new GameState({
        isInfinityMode: true,
        initialInfinityRows: 44,
        infinitySpawnPolicy: policy,
        infinityVisibleRows: 18,
        infinitySpawnOffsetRows: 3,
    });
    state.piecesPlaced = 1;
    state.cameraRow = 42;
    for (let row = 20; row < state.boardGrid.length; row++) {
        for (const column of [4, 5]) {
            state.boardGrid[row][column] = { id: `tower:${column}:${row}`, type: 'I' };
        }
    }
    return state;
}

function makeBot(state) {
    return new PuzzleBotController({
        actions: {},
        difficulty: 1,
        playerIndex: 0,
        playerState: state,
        rng: () => 0.5,
    });
}

function makeRoofClear(row) {
    const pieces = [{
        color: 'I',
        pieceId: 'roof',
        type: 'I',
        x: 0,
        y: row,
        shape: [[0, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    }, {
        color: 'I',
        pieceId: 'support',
        type: 'I',
        x: 0,
        y: row + 1,
        shape: [[1]],
    }];
    const boardGrid = createBoardGrid();
    rebuildBoardGridFromPieces(pieces, boardGrid);
    return { boardGrid, pieces };
}

describe('Infinity bot lookahead', () => {
    it('spawns future pieces from the predicted board using the live Infinity rules', () => {
        const state = makeInfinityState();
        const futureBoard = cloneBoardGrid(state.boardGrid);
        for (let row = 16; row < 20; row++) {
            for (const column of [4, 5]) {
                futureBoard[row][column] = { id: `future:${column}:${row}`, type: 'I' };
            }
        }

        const bot = makeBot(state);
        const evaluation = vi.spyOn(bot, 'evaluatePlacements');
        const future = bot.evaluateFuture(futureBoard, ['O'], 1, getBotDifficultyConfig(1), new Map());

        expect(future.candidate).toBeTruthy();
        const searchState = evaluation.mock.calls[0][0];
        const liveState = makeInfinityState();
        liveState.board = futureBoard;
        liveState.boardGrid = futureBoard;
        liveState.nextPieces = ['O'];
        const livePiece = spawnPiece(liveState, null, null);

        expect(livePiece).toBeTruthy();
        expect(searchState.currentPiece.y).toBe(livePiece.y);
        expect(searchState.currentPiece.y).toBe(10);
        expect(canPlaceCandidate(futureBoard, future.candidate)).toBe(true);
        expect(canPlaceCandidate(futureBoard, {
            ...future.candidate,
            y: future.candidate.y + 1,
        })).toBe(false);
    });

    it('preserves camera-based spawning for legacy Infinity sessions', () => {
        const state = makeInfinityState(INFINITY_SPAWN_POLICY_CAMERA_V1);
        const bot = makeBot(state);

        // This camera puts the legacy spawn inside the tower, just as in live play.
        const future = bot.evaluateFuture(state.boardGrid, ['O'], 1, getBotDifficultyConfig(1), new Map());
        state.nextPieces = ['O'];

        expect(future.candidate).toBeNull();
        expect(spawnPiece(state, null, null)).toBeNull();
        expect(state.isGameOver).toBe(true);
    });
});

describe('Infinity bot roof rows', () => {
    it('penalizes the absolute Infinity roof while preserving playable rows below it', () => {
        const boardGrid = createBoardGrid();
        boardGrid[1][4] = { id: 'playable', type: 'I' };
        const config = getBotDifficultyConfig(10);
        const infinityBefore = evaluateCandidate({ boardGrid, hiddenRows: 0 }, config);

        expect(infinityBefore.metrics.topOutRisk).toBe(0);

        boardGrid[0][4] = { id: 'roof', type: 'I' };
        const infinityAtRoof = evaluateCandidate({ boardGrid, hiddenRows: 0 }, config);

        expect(infinityAtRoof.metrics.topOutRisk).toBe(1);
        expect(infinityAtRoof.metrics.pressureRatio).toBe(1);
        expect(evaluateCandidate({ boardGrid }, config).metrics.topOutRisk).toBe(2);
    });

    it.each([0, 1, 3])('predicts the same clear as live physics at Infinity row %i', (row) => {
        const { boardGrid, pieces } = makeRoofClear(row);
        const placement = {
            shape: [[1]], shapeKey: 'I', type: 'I', x: 0, y: row,
        };
        const infinity = simulatePlacement({ boardGrid, isInfinityMode: true }, placement);
        const standard = simulatePlacement({ boardGrid }, placement);
        const live = resolveCascade([...pieces, { ...placement, color: 'I', pieceId: 'filler' }], {
            boardHeight: boardGrid.length,
            dropInterval: 1000,
            isInfinityMode: true,
            level: 1,
        });

        expect(infinity.totalLines).toBe(1);
        expect(infinity.totalLines).toBe(live.linesClearedThisTurn);
        expect(infinity.boardGrid).toEqual(live.boardAfter);
        expect(standard.totalLines).toBe(0);
        expect(simulateCellFill({ boardGrid, isInfinityMode: true }, [{ x: 0, y: row }]).totalLines).toBe(1);
    });

    it('recognizes playable roof rows in its danger metrics, preparation and latent trigger probes', () => {
        const { boardGrid } = makeRoofClear(3);
        const boardOptions = { hiddenRows: 0 };
        const preparation = analyzeCascadePreparation(boardGrid, ['I'], boardOptions);
        const evaluation = evaluateCandidate({ boardGrid, hiddenRows: 0 }, getBotDifficultyConfig(1));
        const bot = makeBot({ boardGrid, isInfinityMode: true });
        bot.config = getBotDifficultyConfig(10);

        expect(evaluation.metrics.topOutRisk).toBe(0);
        expect(evaluation.metrics.heights[9]).toBe(boardGrid.length - 3);
        expect(bot.assessTactics(boardGrid, preparation).spareRows).toBe(3);
        expect(preparation.triggerRows).toBe(1);
        expect(preparation.sideLanes.find((lane) => lane.side === 'right').capY).toBe(3);
        expect(estimateLatentDischarge(boardGrid, preparation.sideLanes, ['I'], boardOptions).latentDepth).toBe(1);

        expect(evaluateCandidate({ boardGrid }, getBotDifficultyConfig(1)).metrics.topOutRisk).toBe(9);
        expect(analyzeCascadePreparation(boardGrid, ['I']).triggerRows).toBe(0);
        expect(estimateLatentDischarge(boardGrid, [], ['I']).latentDepth).toBe(0);
    });
});
