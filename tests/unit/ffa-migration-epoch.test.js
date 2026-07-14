import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { HostMigration } from '../../src/core/network/host-migration.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { JOIN_LIFECYCLE_STATES } from '../../src/core/multiplayer/ffa/join-lifecycle.js';

function makeEpochState(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        _migrationEpochEnabled: true,
        migrationEpoch: 2,
        _recordNetEvent: vi.fn(),
        _netDiagEnabled: false,
        roundGeneration: 0,
        simTick: 0,
        snapshotSeq: 0,
        players: new Map([['P1', {
            steamId: 'P1',
            isAlive: true,
            frags: 0,
            gameState: {},
            garbageQueue: null,
        }]]),
        localPlayerId: 'P1',
        gamePhase: 'playing',
        renderAllPlayers: vi.fn(),
        ...overrides,
    });
}

describe('FFA migration epoch fencing', () => {
    it('accepts equal/newer epochs and rejects stale or missing epochs when enabled', () => {
        const state = makeEpochState();

        expect(state._acceptMigrationEpoch(2, { source: 'same' })).toBe(true);
        expect(state.migrationEpoch).toBe(2);

        expect(state._acceptMigrationEpoch(4, { source: 'newer' })).toBe(true);
        expect(state.migrationEpoch).toBe(4);

        expect(state._acceptMigrationEpoch(3, { source: 'stale' })).toBe(false);
        expect(state._acceptMigrationEpoch(undefined, { source: 'missing' })).toBe(false);
        expect(state._recordNetEvent).toHaveBeenCalledWith('migration_epoch_rejected', expect.objectContaining({
            reason: 'stale',
            incoming: 3,
        }));
    });

    it('drops stale migration snapshots before they can mutate player state', () => {
        const state = makeEpochState({ migrationEpoch: 5 });
        const player = state.players.get('P1');

        state._applySnapshotState({
            migrationEpoch: 4,
            gamePhase: 'finished',
            players: [{
                steamId: 'P1',
                isAlive: false,
                score: 99,
                lines: 9,
                level: 2,
                frags: 7,
            }],
        }, { forceLocal: true });

        expect(state.gamePhase).toBe('playing');
        expect(player.isAlive).toBe(true);
        expect(player.frags).toBe(0);
        expect(state.renderAllPlayers).not.toHaveBeenCalled();
    });

    it('retires only old-host inbound resync state when authority changes', () => {
        const outboundTransfer = { timer: 9 };
        const state = makeEpochState({
            resyncTransfers: new Map([['OUT', outboundTransfer]]),
            resyncBuffers: new Map([['OLD-R', {}]]),
            joinState: JOIN_LIFECYCLE_STATES.DOWNLOADING,
            downloadJoinInProgress: { resyncId: 'OLD-R', downloadEpoch: 'OLD-R' },
            network: {
                incomingSnapshotBaselines: new Map([['OLD', {}], ['NEW', {}]]),
                lastResyncRequestAt: new Map([['OLD', 100], ['NEW', 200]]),
            },
        });

        expect(state.onHostAuthorityChanged({
            previousHostId: 'OLD',
            newHostId: 'NEW',
            source: 'migration_sync',
        })).toBe(true);

        expect(state.resyncBuffers.size).toBe(0);
        expect(state.downloadJoinInProgress).toBeNull();
        expect(state.joinState).toBe(JOIN_LIFECYCLE_STATES.LIVE);
        expect(state.resyncTransfers.get('OUT')).toBe(outboundTransfer);
        expect(state.network.incomingSnapshotBaselines.has('OLD')).toBe(false);
        expect(state.network.incomingSnapshotBaselines.has('NEW')).toBe(true);
        expect(state.network.lastResyncRequestAt.has('OLD')).toBe(false);
        expect(state.network.lastResyncRequestAt.has('NEW')).toBe(true);
        expect(state._recordNetEvent).toHaveBeenCalledWith('resync_inbound_retired', {
            previousHostId: 'OLD',
            newHostId: 'NEW',
            source: 'migration_sync',
            discardedBuffers: 1,
            discardedDownload: true,
        });

        state.resyncBuffers.set('NEW-R', {});
        state.downloadJoinInProgress = { resyncId: 'NEW-R', downloadEpoch: 'NEW-R' };
        expect(state.onHostAuthorityChanged({
            previousHostId: 'NEW',
            newHostId: 'NEW',
            source: 'migration_sync',
        })).toBe(false);
        expect(state.resyncBuffers.has('NEW-R')).toBe(true);
        expect(state.downloadJoinInProgress).not.toBeNull();
    });

    it('successor claims and syncs with a single advanced epoch', () => {
        const gameState = {
            _migrationEpochEnabled: true,
            migrationEpoch: 0,
            localPlayerId: '10',
            isHost: false,
            players: new Map([['10', { steamId: '10', name: 'NewHost' }]]),
            network: {
                hostSteamId: '99',
                isHost: false,
                broadcastToAll: vi.fn(),
            },
            prepareMigrationClaim: FFAGameStateP2P.prototype.prepareMigrationClaim,
            _recordNetEvent: vi.fn(),
            promoteToHost: vi.fn(function promoteToHost() {
                gameState.isHost = true;
                gameState.network.isHost = true;
                gameState.network.hostSteamId = '10';
            }),
            buildStateSnapshot: vi.fn(() => ({ players: [], migrationEpoch: gameState.migrationEpoch })),
            broadcastGameState: vi.fn(),
        };
        const migration = new HostMigration(gameState);

        migration.claimHost();

        expect(gameState.migrationEpoch).toBe(1);
        expect(gameState.network.broadcastToAll).toHaveBeenCalledWith(
            MessageTypes.GAME_HOST_MIGRATION_CLAIM,
            expect.objectContaining({ newHostId: '10', migrationEpoch: 1 }),
        );
        expect(gameState.network.broadcastToAll).toHaveBeenCalledWith(
            MessageTypes.GAME_HOST_MIGRATION_SYNC,
            expect.objectContaining({ newHostId: '10', migrationEpoch: 1 }),
        );
    });

    it('rejects a stale epoch claim from the elected candidate', () => {
        const gameState = {
            _migrationEpochEnabled: true,
            migrationEpoch: 5,
            localPlayerId: '20',
            isHost: false,
            players: new Map([
                ['10', { steamId: '10', name: 'Winner' }],
                ['20', { steamId: '20', name: 'Local' }],
            ]),
            network: {
                hostSteamId: '99',
                isHost: false,
            },
            _acceptMigrationEpoch: FFAGameStateP2P.prototype._acceptMigrationEpoch,
            _recordNetEvent: vi.fn(),
            onHostAuthorityChanged: vi.fn(),
        };
        const migration = new HostMigration(gameState);
        migration.isElectionInProgress = true;

        migration.handleClaim({ from: '10', data: { newHostId: '10', migrationEpoch: 4 } });
        expect(gameState.network.hostSteamId).toBe('99');
        expect(gameState.onHostAuthorityChanged).not.toHaveBeenCalled();

        migration.handleClaim({ from: '10', data: { newHostId: '10', migrationEpoch: 6 } });
        expect(gameState.network.hostSteamId).toBe('10');
        expect(gameState.migrationEpoch).toBe(6);
        expect(gameState.onHostAuthorityChanged).toHaveBeenCalledWith({
            previousHostId: '99',
            newHostId: '10',
            source: 'migration_claim',
        });
    });
});
