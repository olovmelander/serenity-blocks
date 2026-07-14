import { describe, expect, it } from 'vitest';
import { fillBag, spawnPiece } from '../../src/core/game.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { computeBoardDigest } from '../../src/core/demo/demo-state.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import {
    createLocalMultiplayerFixedTickRuntime,
    runLocalMultiplayerFixedTicks,
    startLocalMultiplayerFixedTickRuntime,
} from '../../src/core/game-modes/local-multiplayer-fixed-tick.js';
import { applyLocalMultiplayerFixedCommand } from '../../src/core/game-modes/local-multiplayer-loop.js';

const PRESENTATION_RATES = [30, 60, 144];

function projectPiece(piece) {
    if (!piece) return null;
    return {
        rotation: piece.rotation,
        type: piece.type,
        x: piece.x,
        y: piece.y,
    };
}

const COMMANDS = [
    [{ tick: 1, action: 'hardDrop' }, { tick: 12, action: 'move', value: -1 }],
    [{ tick: 1, action: 'move', value: 1 }, { tick: 3, action: 'hardDrop' }],
    [{ tick: 1, action: 'rotate', value: 'right' }, { tick: 5, action: 'hardDrop' }],
    [{ tick: 1, action: 'softDrop' }, { tick: 7, action: 'hardDrop' }],
];

function runSeededLocalMatch(presentationRate) {
    const multiplayerState = new MultiPlayerState(4);
    multiplayerState.reset();
    multiplayerState.isPaused = false;
    const randoms = multiplayerState.players.map((player) => {
        bindLegacySessionRng(player, 0x10ca1ca1);
        const { randomGenerator: random } = player;
        fillBag(player.nextPieces, random);
        spawnPiece(player);
        return random;
    });
    const runtime = createLocalMultiplayerFixedTickRuntime();
    const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
    const callbackLog = [];
    const inputLog = [];
    const physicsCallbacks = multiplayerState.players.map((player, playerIndex) => ({
        spawnPiece: () => {
            const piece = spawnPiece(player);
            callbackLog.push({
                frame: player.simFrame,
                playerIndex,
                piece: projectPiece(piece),
            });
            return piece;
        },
    }));

    const tickOptions = {
        ownership,
        advanceInput: (playerIndex, { tick, emit }) => {
            COMMANDS[playerIndex]
                .filter((command) => command.tick === tick)
                .forEach((command) => emit(command));
        },
        applyInput: (playerIndex, command) => applyLocalMultiplayerFixedCommand(command, {
            gameState: multiplayerState.players[playerIndex],
            isEnabled: () => true,
            physicsCallbacks: physicsCallbacks[playerIndex],
        }),
        getPhysicsCallbacks: (playerIndex) => physicsCallbacks[playerIndex],
        afterPlayerTick: (playerIndex, result) => {
            result.input.forEach(({ command, disposition }) => {
                inputLog.push({
                    action: command.action,
                    disposition,
                    playerIndex,
                    tick: result.tick,
                    value: command.value ?? null,
                });
            });
        },
    };

    for (let frame = 0; frame < presentationRate; frame += 1) {
        runLocalMultiplayerFixedTicks(runtime, 1000 / presentationRate, tickOptions);
    }

    return {
        accumulatorMs: Math.abs(runtime.accumulatorMs) < 1e-9 ? 0 : runtime.accumulatorMs,
        callbackLog,
        inputLog,
        matchFrame: runtime.simFrame,
        matchTimeMs: runtime.simTimeMs,
        players: multiplayerState.players.map((player, index) => ({
            boardDigest: computeBoardDigest(player.boardGrid),
            currentPiece: projectPiece(player.currentPiece),
            fixedInputSpawnFrame: player._fixedInputSpawnFrame,
            lockedPieces: player.lockedPieces.map(projectPiece),
            nextPieces: player.nextPieces.slice(),
            piecesPlaced: player.piecesPlaced,
            rngState: randoms[index].getState(),
            simFrame: player.simFrame,
            simTimeMs: player.simTimeMs,
        })),
    };
}

describe('Local Multiplayer fixed-tick composition determinism', () => {
    it('matches four real seeded boards at 30/60/144 Hz presentation rates', () => {
        const [at30, at60, at144] = PRESENTATION_RATES.map(runSeededLocalMatch);

        expect(at30).toEqual(at60);
        expect(at60).toEqual(at144);
        expect(at60.matchFrame).toBe(60);
        expect(at60.matchTimeMs).toBeCloseTo(1000, 8);
        expect(at60.accumulatorMs).toBe(0);
        expect(at60.players.every(({ simFrame }) => simFrame === 60)).toBe(true);
        expect(at60.players.every(({ piecesPlaced }) => piecesPlaced === 2)).toBe(true);
        expect(at60.players.every(({ rngState }) => Number.isFinite(rngState))).toBe(true);
        expect(at60.callbackLog.map(({ playerIndex }) => playerIndex)).toEqual([0, 1, 2, 3]);
        expect(at60.inputLog).toHaveLength(8);
        expect(at60.inputLog.every(({ disposition }) => disposition === 'applied')).toBe(true);
    });
});
