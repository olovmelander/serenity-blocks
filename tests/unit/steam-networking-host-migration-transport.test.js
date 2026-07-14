import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { HostMigration } from '../../src/core/network/host-migration.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const NEW_HOST_ID = '10';
const PEER_ID = '20';
const OTHER_PEER_ID = '30';
const OLD_HOST_ID = '99';
const MATCH_ID = 'migration-transport-match';
const MATCH_NONCE = 'migration-transport-nonce';

function makeNetwork({
    steamId = NEW_HOST_ID,
    hostSteamId = OLD_HOST_ID,
    isHost = false,
    mockMode = false,
} = {}) {
    const network = new SteamNetworking();
    network.steamId = steamId;
    network.hostSteamId = hostSteamId;
    network.isHost = isHost;
    network.mockMode = mockMode;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    network.lockProtocolSession();
    if (isHost) {
        network.seedNegotiatedProtocolPeers([NEW_HOST_ID, PEER_ID, OTHER_PEER_ID]);
    } else {
        network.setNegotiatedProtocol(hostSteamId, network.protocolVersion);
    }
    return network;
}

function makeEnvelope(network, type, {
    hostSteamId = network.hostSteamId,
    payload = {},
    seq = 1,
} = {}) {
    return {
        envelopeVersion: network.envelopeVersion,
        msgType: type,
        matchId: network.matchId,
        matchNonce: network.matchNonce,
        hostSteamId,
        channel: 0,
        seq,
        tick: null,
        sentAt: 1_000 + seq,
        protocolVersion: network.protocolVersion,
        payload,
    };
}

function deliver(network, envelope, sender, mode) {
    if (mode === 'mock') {
        network.handleMockP2PMessage({
            ...envelope,
            from: sender,
            to: network.steamId,
        });
        return;
    }
    network.handleP2PPacket({ steamId: sender, data: envelope }, envelope.channel);
}

function configureBroadcastProbe(mode) {
    const network = makeNetwork({ mockMode: mode === 'mock' });
    if (mode === 'mock') {
        network._sendEnvelope = vi.fn();
        return {
            network,
            sent: network._sendEnvelope,
        };
    }

    network.connectedPeers.set(PEER_ID, { steamId: PEER_ID });
    network._sendMessage = vi.fn();
    return {
        network,
        sent: network._sendMessage,
    };
}

function makeSuccessorSyncEnvelope(network, overrides = {}) {
    const payload = overrides.payload || {
        newHostId: NEW_HOST_ID,
        migrationEpoch: 1,
        snapshot: { players: [] },
    };
    return {
        ...makeEnvelope(network, MessageTypes.GAME_HOST_MIGRATION_SYNC, {
            hostSteamId: NEW_HOST_ID,
            payload,
            seq: 1,
        }),
        ...overrides,
        payload,
    };
}

describe('Steam host-migration transport', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['mock', 'real'])(
        'lets a non-host broadcast only the migration claim with %s transport semantics',
        (mode) => {
            const { network, sent } = configureBroadcastProbe(mode);
            const payload = { newHostId: NEW_HOST_ID, migrationEpoch: 1 };

            network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_CLAIM, payload);

            expect(sent).toHaveBeenCalledOnce();
            if (mode === 'mock') {
                expect(sent).toHaveBeenCalledWith(
                    'all',
                    MessageTypes.GAME_HOST_MIGRATION_CLAIM,
                    expect.objectContaining({
                        msgType: MessageTypes.GAME_HOST_MIGRATION_CLAIM,
                        hostSteamId: OLD_HOST_ID,
                        payload,
                    }),
                    expect.objectContaining({ delivery: 'reliable' }),
                );
            } else {
                expect(sent).toHaveBeenCalledWith(
                    PEER_ID,
                    MessageTypes.GAME_HOST_MIGRATION_CLAIM,
                    payload,
                    expect.objectContaining({ delivery: 'reliable' }),
                );
            }
        },
    );

    it.each(['mock', 'real'])(
        'still rejects an ordinary non-host broadcast with %s transport semantics',
        (mode) => {
            const { network, sent } = configureBroadcastProbe(mode);

            network.broadcastToAll(MessageTypes.GAME_ROUND_START, { roundGeneration: 4 });

            expect(sent).not.toHaveBeenCalled();
        },
    );

    it('seeds real-transport recipients from the roster before broadcasting CLAIM and SYNC', () => {
        const network = makeNetwork();
        network._sendMessage = vi.fn();
        const gameState = {
            _migrationEpochEnabled: true,
            migrationEpoch: 0,
            localPlayerId: NEW_HOST_ID,
            isHost: false,
            players: new Map([
                [NEW_HOST_ID, { steamId: NEW_HOST_ID, name: 'Candidate', isDisconnected: false }],
                [PEER_ID, { steamId: PEER_ID, name: 'Peer', isDisconnected: false }],
                [OTHER_PEER_ID, { steamId: OTHER_PEER_ID, name: 'Other', isDisconnected: false }],
            ]),
            network,
            matchConfig: { simulationClock: 'legacy-variable-v1' },
            prepareMigrationClaim() {
                this.migrationEpoch += 1;
                return this.migrationEpoch;
            },
            promoteToHost: vi.fn(() => {
                gameState.isHost = true;
                network.isHost = true;
                network.hostSteamId = NEW_HOST_ID;
            }),
            buildStateSnapshot: vi.fn(() => ({ players: [], migrationEpoch: 1 })),
            broadcastGameState: vi.fn(),
        };
        const migration = new HostMigration(gameState);

        migration.claimHost();

        expect(Array.from(network.connectedPeers.keys()).sort()).toEqual([
            PEER_ID,
            OTHER_PEER_ID,
        ].sort());
        expect(network._sendMessage.mock.calls.map(([target, type]) => [target, type])).toEqual([
            [PEER_ID, MessageTypes.GAME_HOST_MIGRATION_CLAIM],
            [OTHER_PEER_ID, MessageTypes.GAME_HOST_MIGRATION_CLAIM],
            [PEER_ID, MessageTypes.GAME_HOST_MIGRATION_SYNC],
            [OTHER_PEER_ID, MessageTypes.GAME_HOST_MIGRATION_SYNC],
        ]);
        expect(gameState.promoteToHost).toHaveBeenCalledOnce();
    });

    it.each(['mock', 'p2p'])(
        'accepts an old-host-header CLAIM followed by a new-host-header SYNC on %s ingress',
        (mode) => {
            const network = makeNetwork({
                steamId: PEER_ID,
                mockMode: mode === 'mock',
            });
            const gameState = {
                _migrationEpochEnabled: true,
                migrationEpoch: 0,
                localPlayerId: PEER_ID,
                isHost: false,
                players: new Map([
                    [NEW_HOST_ID, { steamId: NEW_HOST_ID, name: 'Candidate', isDisconnected: false }],
                    [PEER_ID, { steamId: PEER_ID, name: 'Peer', isDisconnected: false }],
                ]),
                network,
                _acceptMigrationEpoch(epoch) {
                    if (!Number.isFinite(epoch) || epoch < this.migrationEpoch) return false;
                    this.migrationEpoch = epoch;
                    return true;
                },
                onHostAuthorityChanged: vi.fn(),
            };
            const migration = new HostMigration(gameState);
            migration.isElectionInProgress = true;
            const syncHandler = vi.fn();
            network.on(MessageTypes.GAME_HOST_MIGRATION_CLAIM, (msg) => migration.handleClaim(msg));
            network.on(MessageTypes.GAME_HOST_MIGRATION_SYNC, syncHandler);

            deliver(
                network,
                makeEnvelope(network, MessageTypes.GAME_HOST_MIGRATION_CLAIM, {
                    hostSteamId: OLD_HOST_ID,
                    payload: { newHostId: NEW_HOST_ID, migrationEpoch: 1 },
                    seq: 1,
                }),
                NEW_HOST_ID,
                mode,
            );

            expect(network.hostSteamId).toBe(NEW_HOST_ID);
            expect(gameState.onHostAuthorityChanged).toHaveBeenCalledWith({
                previousHostId: OLD_HOST_ID,
                newHostId: NEW_HOST_ID,
                source: 'migration_claim',
            });

            deliver(
                network,
                makeEnvelope(network, MessageTypes.GAME_HOST_MIGRATION_SYNC, {
                    hostSteamId: NEW_HOST_ID,
                    payload: { newHostId: NEW_HOST_ID, migrationEpoch: 1, snapshot: { players: [] } },
                    seq: 2,
                }),
                NEW_HOST_ID,
                mode,
            );

            expect(syncHandler).toHaveBeenCalledOnce();
            expect(syncHandler).toHaveBeenCalledWith(expect.objectContaining({
                from: NEW_HOST_ID,
                type: MessageTypes.GAME_HOST_MIGRATION_SYNC,
            }));
        },
    );

    it.each(['mock', 'p2p'])(
        'admits self-identifying SYNC before CLAIM without adopting authority on %s ingress',
        (mode) => {
            const network = makeNetwork({
                steamId: PEER_ID,
                mockMode: mode === 'mock',
            });
            const handler = vi.fn();
            network.on(MessageTypes.GAME_HOST_MIGRATION_SYNC, handler);

            deliver(
                network,
                makeSuccessorSyncEnvelope(network),
                NEW_HOST_ID,
                mode,
            );

            expect(handler).toHaveBeenCalledOnce();
            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                from: NEW_HOST_ID,
                type: MessageTypes.GAME_HOST_MIGRATION_SYNC,
                data: expect.objectContaining({ newHostId: NEW_HOST_ID }),
            }));
            // Transport admission is deliberately not authority adoption. The FFA
            // election/epoch verifier remains the only component allowed to do that.
            expect(network.hostSteamId).toBe(OLD_HOST_ID);
            expect(network.getPacketStats()).toMatchObject({
                received: 1,
                validationFailures: 0,
            });
        },
    );

    const invalidSuccessorSyncCases = [
        {
            name: 'a forged claimed successor id',
            sender: NEW_HOST_ID,
            overrides: {
                payload: {
                    newHostId: OTHER_PEER_ID,
                    migrationEpoch: 1,
                    snapshot: { players: [] },
                },
            },
        },
        {
            name: 'an envelope that still names the old host',
            sender: NEW_HOST_ID,
            overrides: { hostSteamId: OLD_HOST_ID },
        },
        {
            name: 'a mismatched match id',
            sender: NEW_HOST_ID,
            overrides: { matchId: 'different-match' },
        },
        {
            name: 'a mismatched match nonce',
            sender: NEW_HOST_ID,
            overrides: { matchNonce: 'different-nonce' },
        },
        {
            name: 'a missing transport sender',
            sender: undefined,
            overrides: {},
        },
    ];

    it.each(
        ['mock', 'p2p'].flatMap((mode) => invalidSuccessorSyncCases.map((testCase) => [
            mode,
            testCase.name,
            testCase.sender,
            testCase.overrides,
        ])),
    )('rejects SYNC-before-CLAIM on %s ingress for %s', (mode, _name, sender, overrides) => {
        const network = makeNetwork({
            steamId: PEER_ID,
            mockMode: mode === 'mock',
        });
        const handler = vi.fn();
        network.on(MessageTypes.GAME_HOST_MIGRATION_SYNC, handler);

        deliver(
            network,
            makeSuccessorSyncEnvelope(network, overrides),
            sender,
            mode,
        );

        expect(handler).not.toHaveBeenCalled();
        expect(network.hostSteamId).toBe(OLD_HOST_ID);
        expect(network.getPacketStats()).toMatchObject({
            received: 0,
            validationFailures: 1,
        });
    });

    it.each(['mock', 'p2p'])(
        'rejects successor SYNC at a host receiver on %s ingress',
        (mode) => {
            const network = makeNetwork({
                steamId: OLD_HOST_ID,
                hostSteamId: OLD_HOST_ID,
                isHost: true,
                mockMode: mode === 'mock',
            });
            const handler = vi.fn();
            network.on(MessageTypes.GAME_HOST_MIGRATION_SYNC, handler);

            deliver(
                network,
                makeSuccessorSyncEnvelope(network),
                NEW_HOST_ID,
                mode,
            );

            expect(handler).not.toHaveBeenCalled();
            expect(network.getPacketStats()).toMatchObject({
                received: 0,
                validationFailures: 1,
            });
        },
    );

    it.each(['mock', 'p2p'])(
        'rejects migration CLAIM at a host receiver on %s ingress',
        (mode) => {
            const network = makeNetwork({
                steamId: OLD_HOST_ID,
                hostSteamId: OLD_HOST_ID,
                isHost: true,
                mockMode: mode === 'mock',
            });
            const handler = vi.fn();
            network.on(MessageTypes.GAME_HOST_MIGRATION_CLAIM, handler);

            deliver(
                network,
                makeEnvelope(network, MessageTypes.GAME_HOST_MIGRATION_CLAIM, {
                    hostSteamId: OLD_HOST_ID,
                    payload: { newHostId: NEW_HOST_ID, migrationEpoch: 1 },
                }),
                NEW_HOST_ID,
                mode,
            );

            expect(handler).not.toHaveBeenCalled();
            expect(network.getPacketStats()).toMatchObject({
                received: 0,
                validationFailures: 1,
                roleValidationDropsByType: {
                    [MessageTypes.GAME_HOST_MIGRATION_CLAIM]: 1,
                },
            });
        },
    );
});
