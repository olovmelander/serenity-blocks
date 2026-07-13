import { describe, expect, it } from 'vitest';
import {
    fillBag,
    GameState,
    hardDrop,
    spawnPiece,
} from '../../src/core/game.js';
import { computeBoardDigest } from '../../src/core/demo/demo-state.js';
import {
    createSinglePlayerFixedTickRuntime,
    runSinglePlayerFixedTicks,
    startSinglePlayerFixedTickRuntime,
} from '../../src/core/game-modes/single-player-fixed-tick.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
} from '../../src/core/infinity-spawn-policy.js';
import { maintainInfinitySimulation } from '../../src/core/infinity-simulation-maintenance.js';
import { createSfc32Random } from '../../src/core/rng.js';

const PRESENTATION_RATES = [30, 60, 144];

function projectPiece(piece) {
    if (!piece) return null;
    return {
        type: piece.type,
        x: piece.x,
        y: piece.y,
        rotation: piece.rotation,
    };
}

function projectInfinityStats(stats) {
    return {
        blocksPlaced: stats.blocksPlaced,
        maxCascadeScore: stats.maxCascadeScore,
        maxCombo: stats.maxCombo,
        maxComboComplexity: stats.maxComboComplexity,
        maxComboDepth: stats.maxComboDepth,
        rowsReached: stats.rowsReached,
        totalCascades: stats.totalCascades,
    };
}

function runSeededInfinitySession(presentationRate) {
    const gameState = new GameState({
        isInfinityMode: true,
        initialInfinityRows: 32,
        infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
        infinityVisibleRows: 20,
        maxRows: 52,
    });
    const random = createSfc32Random('infinity-fixed-tick-seed', 'pieces:P1');
    gameState.randomGenerator = random;
    fillBag(gameState.nextPieces, random);
    spawnPiece(gameState);

    const runtime = createSinglePlayerFixedTickRuntime();
    const ownership = startSinglePlayerFixedTickRuntime(runtime, gameState);
    const spawnEvents = [];
    const maintenanceEvents = [];
    const inputEvents = [];
    let hardDropIssued = false;
    const physicsCallbacks = {
        spawnPiece: () => {
            const piece = spawnPiece(gameState);
            spawnEvents.push({
                frame: gameState.simFrame,
                processingPhysics: gameState.isProcessingPhysics,
                piece: projectPiece(piece),
            });
            return piece;
        },
    };
    const tickOptions = {
        ownership,
        shouldContinue: () => true,
        advanceInput: ({ emit }) => {
            if (hardDropIssued) return;
            hardDropIssued = true;
            emit({ action: 'hardDrop' });
        },
        applyInput: (command) => {
            if (command.action !== 'hardDrop') return false;
            return hardDrop(gameState, null, physicsCallbacks, {
                fixedTick: true,
                inputPhase: true,
            });
        },
        physicsCallbacks,
        afterTick: (result) => {
            inputEvents.push(...result.input.map(({ command, disposition }) => ({
                action: command.action,
                disposition,
                frame: result.tick,
            })));
            if (gameState.isProcessingPhysics) return;
            const maintenance = maintainInfinitySimulation(gameState);
            maintenanceEvents.push({
                currentTopRow: maintenance.currentTopRow,
                frame: result.tick,
                rowCount: maintenance.rowCount,
                rowsAdded: maintenance.rowsAdded,
            });
        },
    };

    for (let frame = 0; frame < presentationRate; frame += 1) {
        runSinglePlayerFixedTicks(runtime, 1000 / presentationRate, tickOptions);
    }

    return {
        boardDigest: computeBoardDigest(gameState.boardGrid),
        boardLength: gameState.boardGrid.length,
        cameraCenterRow: gameState.cameraCenterRow,
        cameraRow: gameState.cameraRow,
        comboSequence: gameState.comboState.sequence,
        currentPiece: projectPiece(gameState.currentPiece),
        currentTopRow: gameState.currentTopRow,
        dropPhase: {
            counter: gameState.dropCounter,
            fixedInputSpawnFrame: gameState._fixedInputSpawnFrame,
            grounded: gameState.isGrounded,
            lockTimerTicks: gameState.lockTimerTicks,
        },
        infinityStats: projectInfinityStats(gameState.infinityStats),
        inputEvents,
        latestPhysicsPromise: gameState.latestPhysicsPromise ?? null,
        lines: gameState.lines,
        lockedPieces: gameState.lockedPieces.map(projectPiece),
        maintenanceEvents,
        nextPieces: gameState.nextPieces.slice(),
        physicsStable: gameState.isProcessingPhysics === false,
        pieceCounts: { ...gameState.pieceCounts },
        piecesPlaced: gameState.piecesPlaced,
        rngState: random.getState(),
        runtimeAccumulatorMs: Math.abs(runtime.accumulatorMs) < 1e-9
            ? 0
            : runtime.accumulatorMs,
        score: gameState.score,
        simFrame: gameState.simFrame,
        simTimeMs: gameState.simTimeMs,
        spawnEvents,
    };
}

describe('Infinity fixed-tick composition determinism', () => {
    it('matches canonical state after one second at 30/60/144 Hz presentation rates', () => {
        const [at30, at60, at144] = PRESENTATION_RATES.map(runSeededInfinitySession);

        expect(at30).toEqual(at60);
        expect(at60).toEqual(at144);
        expect(at60).toMatchObject({
            boardLength: 42,
            currentTopRow: 40,
            infinityStats: { rowsReached: 42 },
            inputEvents: [{
                action: 'hardDrop',
                disposition: 'applied',
                frame: 1,
            }],
            latestPhysicsPromise: null,
            physicsStable: true,
            piecesPlaced: 2,
            simFrame: 60,
            spawnEvents: [{
                frame: 1,
                processingPhysics: false,
            }],
        });
        expect(at60.maintenanceEvents).toHaveLength(60);
        expect(at60.maintenanceEvents[0]).toMatchObject({
            frame: 1,
            rowCount: 42,
            rowsAdded: 10,
        });
        expect(at60.maintenanceEvents.slice(1).every(({ rowsAdded }) => rowsAdded === 0))
            .toBe(true);
        expect(at60.runtimeAccumulatorMs).toBeCloseTo(0, 8);
        expect(at60.simTimeMs).toBeCloseTo(1000, 8);
        expect(at60.rngState.drawCount).toBeGreaterThan(0);
    });
});
