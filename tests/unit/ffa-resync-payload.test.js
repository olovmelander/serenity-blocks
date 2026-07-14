import {
    describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { GarbageQueue } from '../../src/core/garbage.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { buildFfaResyncPayload } from '../../src/core/multiplayer/ffa/resync-payload.js';
import { validateFfaResyncSidecar } from '../../src/core/multiplayer/ffa/resync-sidecar.js';
import { getBinaryDecoder } from '../../src/core/network/binary-encoding.js';
import { decodeBase64 } from '../../src/core/multiplayer/ffa/resync-coordinator.js';
import { seededRandom } from '../../src/utils/helpers.js';

function makeGame() {
    const gameState = new GameState();
    gameState.randomGenerator = seededRandom(0);
    const player = {
        steamId: 'HOST',
        name: 'Host',
        color: '#ffffff',
        gameState,
        garbageQueue: new GarbageQueue(),
        frags: 0,
        isAlive: true,
        awaitingSpawn: false,
        lastInputSeq: 0,
        lastAttackerId: null,
        _lockSeq: 0,
        _clearSeq: 0,
    };
    const game = Object.assign(Object.create(FFAGameStateP2P.prototype), {
        players: new Map([['HOST', player]]),
        gamePhase: 'playing',
        winner: null,
        hotPotatoState: null,
        simTick: 42,
        roundGeneration: 3,
        snapshotSeq: 17,
        hostTick: 51,
        migrationEpoch: 2,
        matchConfig: { simulationClock: 'legacy' },
        sharedSeed: 0,
        matchStartTime: 0,
        _attackSeq: 0,
        attackRouter: { attackHistory: [] },
        fragTracker: { deathLog: [], killFeed: [] },
        _networkDispatch: { depth: 0 },
        _fixedTickApplicationDepth: 0,
    });
    game.buildStateSnapshot = vi.fn(
        FFAGameStateP2P.prototype.buildStateSnapshot.bind(game),
    );
    return game;
}

function decodeSnapshot(payload) {
    const bytes = decodeBase64(payload.snapshot);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return getBinaryDecoder().decodeSnapshot(buffer);
}

describe('FFA resync payload capture', () => {
    it('keeps binary-v1 compatible while carrying an exact validated sidecar', () => {
        const game = makeGame();
        const payload = buildFfaResyncPayload(game, {
            resyncId: 'R1',
            downloadEpoch: 'D1',
        });
        const packedSnapshot = decodeSnapshot(payload);

        expect(payload.encoding).toBe('binary-v1');
        expect(payload.header).toMatchObject({
            sharedSeed: 0,
            matchStartTime: 0,
            roundGeneration: 3,
            simTick: 42,
            snapshotSeq: 18,
            hostTick: 51,
            migrationEpoch: 2,
            resyncId: 'R1',
            downloadEpoch: 'D1',
            joinSyncpoint: {
                status: 'idle',
                safe: true,
                blockers: [],
            },
        });
        expect(packedSnapshot.players.map(({ steamId }) => steamId)).toEqual(['HOST']);
        expect(() => validateFfaResyncSidecar(payload.sidecar, {
            header: payload.header,
            packedSnapshot,
        })).not.toThrow();
        expect(game.snapshotSeq).toBe(18);
    });

    it('assigns every stable resync capture a distinct monotonic fence', () => {
        const game = makeGame();

        const first = buildFfaResyncPayload(game);
        const second = buildFfaResyncPayload(game);

        expect(first.header.snapshotSeq).toBe(18);
        expect(second.header.snapshotSeq).toBe(19);
        expect(first.header.simTick).toBe(second.header.simTick);
    });

    it('canonicalizes a compatible legacy seed before writing the resync envelope', () => {
        const game = makeGame();
        game.sharedSeed = ' 0 ';

        const payload = buildFfaResyncPayload(game);

        expect(payload.header.sharedSeed).toBe(0);
        expect(payload.sidecar.players[0].rng.seed).toBe(0);
        expect(validateFfaResyncSidecar(payload.sidecar, {
            header: payload.header,
            packedSnapshot: decodeSnapshot(payload),
        }).players[0].rng.seed).toBe(0);
    });

    it('rejects an invalid seed before advancing the capture fence or reading state', () => {
        [false, true, '', 'not-a-seed', Number.NaN, Number.POSITIVE_INFINITY, [], {}]
            .forEach((sharedSeed) => {
                const game = makeGame();
                game.sharedSeed = sharedSeed;

                expect(() => buildFfaResyncPayload(game)).toThrow(/invalid round seed/);
                expect(game.snapshotSeq).toBe(17);
                expect(game.buildStateSnapshot).not.toHaveBeenCalled();
            });
    });

    it('refuses capture before reading snapshot state while physics is active', () => {
        const game = makeGame();
        game.players.get('HOST').gameState.isProcessingPhysics = true;

        expect(() => buildFfaResyncPayload(game)).toThrow(/syncpoint is busy/);
        expect(game.buildStateSnapshot).not.toHaveBeenCalled();
    });

    it('rejects an envelope when a capture fence changes mid-capture', () => {
        const game = makeGame();
        const captureSnapshot = game.buildStateSnapshot;
        game.buildStateSnapshot = vi.fn(() => {
            const snapshot = captureSnapshot();
            game.snapshotSeq += 1;
            return snapshot;
        });

        expect(() => buildFfaResyncPayload(game)).toThrow(/changed during capture/);
    });
});
