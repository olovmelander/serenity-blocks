import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import {
    MULTIPLAYER_EVENTS,
    onMultiplayerEvent,
} from '../../src/events/multiplayer-events.js';

const HOST_ID = 'HOST';
const PEER_ID = 'PEER';
const MATCH_ID = 'golden-match';
const MATCH_NONCE = 'golden-nonce';
const FIXED_NOW = new Date('2030-01-01T00:00:00.000Z');

function installCountdownDom() {
    const countdownElement = {
        offsetHeight: 100,
        style: {},
        textContent: '',
    };
    vi.stubGlobal('document', {
        activeElement: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getElementById: (id) => (id === 'multiplayer-countdown' ? countdownElement : null),
        querySelector: vi.fn(() => null),
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => (
        setTimeout(() => callback(Date.now()), 0)
    ));
    return countdownElement;
}

function makeNetwork({ steamId, playerName, isHost }) {
    const network = new SteamNetworking();
    network.initialized = true;
    network.mockMode = true;
    network.steamId = steamId;
    network.playerName = playerName;
    network.isHost = isHost;
    network.hostSteamId = HOST_ID;
    network.matchId = MATCH_ID;
    network.matchNonce = MATCH_NONCE;
    if (isHost) network.lockProtocolSession();
    network.setNetworkImpairment({ enabled: false });
    network.setLobbyPlayerCount = vi.fn();
    network.setLobbyStatus = vi.fn();
    network.refreshMatchSession = () => ({
        matchId: MATCH_ID,
        matchNonce: MATCH_NONCE,
        hostSteamId: HOST_ID,
        protocolVersion: network.protocolVersion,
    });
    return network;
}

class SerializedLoopbackWire {
    constructor() {
        this.endpoints = new Map();
        this.pending = [];
        this.messages = [];
    }

    attach(network) {
        this.endpoints.set(network.steamId, network);
        network.broadcastChannel = {
            close: vi.fn(),
            postMessage: (message) => {
                // BroadcastChannel crosses a serialization boundary. JSON is sufficient
                // for the current plain-data envelope and prevents this harness from
                // accidentally sharing payload references between the two state machines.
                const serialized = JSON.stringify(message);
                const recorded = JSON.parse(serialized);
                this.messages.push(recorded);
                for (const [targetId] of this.endpoints) {
                    if (targetId === recorded.from) continue;
                    if (recorded.to !== 'all' && recorded.to !== targetId) continue;
                    this.pending.push({ targetId, serialized });
                }
            },
        };
    }

    drain() {
        let deliveries = 0;
        while (this.pending.length > 0) {
            deliveries += 1;
            if (deliveries > 200) throw new Error('Serialized loopback failed to quiesce');
            const { targetId, serialized } = this.pending.shift();
            this.endpoints.get(targetId)?.handleMockP2PMessage(JSON.parse(serialized));
        }
    }
}

function rosterSummary(players = []) {
    return players.map((player) => ({
        steamId: player.steamId,
        name: player.name,
        isReady: player.isReady,
        isAlive: player.isAlive,
        awaitingSpawn: player.awaitingSpawn,
    }));
}

function normalizeWireTrace(messages) {
    const resyncIds = new Map();
    const resyncToken = (id) => {
        if (!resyncIds.has(id)) resyncIds.set(id, `R${resyncIds.size + 1}`);
        return resyncIds.get(id);
    };

    return messages.map((message) => {
        const payload = message.payload || {};
        let data;
        switch (message.msgType) {
        case MessageTypes.NET_HELLO:
            data = {
                protocolVersion: payload.protocolVersion,
                name: payload.name,
                asSpectator: payload.asSpectator,
            };
            break;
        case MessageTypes.NET_WELCOME:
            data = {
                accepted: payload.accepted,
                reason: payload.reason,
                hostSteamId: payload.hostSteamId,
            };
            break;
        case MessageTypes.LOBBY_PLAYER_JOINED:
            data = payload.players
                ? { players: rosterSummary(payload.players), spectatorCount: payload.spectatorCount }
                : {
                    steamId: payload.steamId,
                    name: payload.name,
                    asSpectator: payload.asSpectator,
                };
            break;
        case MessageTypes.GAME_STATE_RESYNC:
            data = {
                resyncId: resyncToken(payload.resyncId),
                chunkIndex: payload.chunkIndex,
                chunkCount: payload.chunkCount,
                baselineSnapshotSeq: payload.baselineSnapshotSeq,
                baselineSimTick: payload.baselineSimTick,
                roundGeneration: payload.roundGeneration,
            };
            break;
        case MessageTypes.GAME_STATE_RESYNC_ACK:
            data = {
                resyncId: resyncToken(payload.resyncId),
                chunkIndex: payload.chunkIndex,
                isFinal: payload.isFinal,
            };
            break;
        case MessageTypes.LOBBY_PLAYER_READY:
            data = { steamId: payload.steamId, isReady: payload.isReady };
            break;
        case MessageTypes.LOBBY_GAME_START:
            data = {
                sharedSeed: payload.sharedSeed,
                roundGeneration: payload.roundGeneration,
                simulationClock: payload.config?.simulationClock,
            };
            break;
        case MessageTypes.GAME_INPUT_BATCH:
            data = {
                inputs: payload.inputs?.map((input) => ({
                    type: input.type,
                    data: input.data,
                    seq: input.seq,
                })),
                roundGeneration: payload.fixedTickRoundGeneration,
            };
            break;
        case MessageTypes.GAME_STATE_FULL:
            data = {
                binary: payload._binary,
                delta: payload._delta,
                roundGeneration: payload._gen,
                migrationEpoch: payload._migrationEpoch,
                acknowledgements: payload._acks,
                digest: payload._digest,
                encodedSize: payload._encodedSize,
            };
            break;
        default:
            data = payload;
        }
        return {
            route: `${message.from}->${message.to}`,
            channel: message.channel ?? 0,
            type: message.msgType,
            data,
        };
    });
}

function normalizeNetEventTrace(state) {
    return state.getNetEventLogSnapshot().map((event) => {
        const { data } = event;
        switch (event.type) {
        case 'resync_queued':
            return {
                type: event.type,
                data: { steamId: data.steamId, phase: data.phase, syncpoint: data.syncpoint },
            };
        case 'resync_started':
            return {
                type: event.type,
                data: { steamId: data.steamId, chunkCount: data.chunkCount },
            };
        case 'resync_completed':
            return { type: event.type, data: { steamId: data.steamId } };
        case 'input_batch_accepted':
            return {
                type: event.type,
                data: {
                    steamId: data.steamId,
                    count: data.count,
                    minSeq: data.minSeq,
                    maxSeq: data.maxSeq,
                    clientTick: data.clientTick,
                    lastAck: data.lastAck,
                },
            };
        case 'input_applied':
            return {
                type: event.type,
                data: {
                    steamId: data.steamId,
                    inputType: data.inputType,
                    seq: data.seq,
                    buffered: data.buffered,
                },
            };
        default:
            return { type: event.type, data };
        }
    });
}

function silenceRuntimeLoops(state) {
    state.startGameLoop = vi.fn(() => { state.loopRunning = true; });
    state.stopGameLoop = vi.fn(() => { state.loopRunning = false; });
    state.startStateSyncLoop = vi.fn();
    state.stopStateSyncLoop = vi.fn();
    state.startHeartbeatLoop = vi.fn();
    state.stopHeartbeatLoop = vi.fn();
}

function stateRoster(state) {
    return Array.from(state.players.values())
        .map((player) => ({
            steamId: player.steamId,
            name: player.name,
            color: player.color,
            isReady: player.isReady,
        }))
        .sort((a, b) => a.steamId.localeCompare(b.steamId));
}

let activeStates = [];
let activeUnsubscribes = [];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.spyOn(Math, 'random').mockReturnValue(0.424242);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installCountdownDom();
});

afterEach(() => {
    activeUnsubscribes.forEach((unsubscribe) => unsubscribe());
    activeUnsubscribes = [];
    activeStates.forEach((state) => {
        state.hostMigration?.stopMonitoring?.();
        state.chat?.destroy?.();
        state.stopHeartbeatLoop?.();
        state.stopStateSyncLoop?.();
        state.network?._clearNetworkImpairmentTimers?.();
    });
    activeStates = [];
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('FFA scripted two-peer serialized event golden', () => {
    it('pins join, ready, countdown-gated start, input relay, and one binary snapshot', async () => {
        const wire = new SerializedLoopbackWire();
        const hostNetwork = makeNetwork({ steamId: HOST_ID, playerName: 'Host', isHost: true });
        const host = new FFAGameStateP2P(hostNetwork, HOST_ID);
        activeStates.push(host);
        host.stopHeartbeatLoop();
        wire.attach(hostNetwork);

        const peerNetwork = makeNetwork({ steamId: PEER_ID, playerName: 'Peer', isHost: false });
        wire.attach(peerNetwork);
        const peer = new FFAGameStateP2P(peerNetwork, PEER_ID);
        activeStates.push(peer);
        peer.hostMigration.stopMonitoring();
        peer.announceJoin();

        wire.drain();
        silenceRuntimeLoops(host);
        silenceRuntimeLoops(peer);

        expect(peer.handshakeComplete).toBe(true);
        expect(peer.joinState).toBe('live');
        expect(stateRoster(peer)).toEqual(stateRoster(host));

        peer.setReady(true);
        wire.drain();
        host.setReady(true);
        wire.drain();
        expect(host.allPlayersReady()).toBe(true);
        expect(peer.allPlayersReady()).toBe(true);

        const lifecycle = [];
        const unsubs = [
            onMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_PREPARING, ({ gameState }) => {
                lifecycle.push(`prepare:${gameState.localPlayerId}`);
            }),
            onMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, ({ count }) => {
                lifecycle.push(`count:${count}`);
            }),
            onMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_STARTED, ({ gameState }) => {
                lifecycle.push(`started:${gameState.localPlayerId}`);
            }),
        ];
        activeUnsubscribes.push(...unsubs);

        host.startMatch();
        wire.drain();
        expect(host.gamePhase).toBe('waiting');
        expect(peer.gamePhase).toBe('waiting');

        await vi.advanceTimersByTimeAsync(5000);
        expect(host.gamePhase).toBe('playing');
        expect(peer.gamePhase).toBe('playing');
        expect(host.sharedSeed).toBe(424242);
        expect(peer.sharedSeed).toBe(host.sharedSeed);

        host.useJitterBuffer = false;
        peer.sendInput('move', { direction: -1 });
        peer.flushInputBatch();
        wire.drain();
        host.broadcastGameState();
        wire.drain();
        unsubs.forEach((unsubscribe) => unsubscribe());

        expect(host.players.get(PEER_ID).lastInputSeq).toBe(1);
        expect(hostNetwork.getPacketStats()).toMatchObject({
            decodeFailures: 0,
            validationFailures: 0,
            keyframesSent: 1,
        });
        expect(peerNetwork.getPacketStats()).toMatchObject({
            decodeFailures: 0,
            validationFailures: 0,
            keyframesReceived: 1,
        });

        expect(lifecycle).toEqual([
            'prepare:HOST',
            'prepare:PEER',
            'count:5', 'count:5',
            'count:4', 'count:4',
            'count:3', 'count:3',
            'count:2', 'count:2',
            'count:1', 'count:1',
            'count:0', 'count:0',
            'count:GO', 'count:GO',
            'started:HOST',
            'started:PEER',
        ]);

        const waitingRoster = [
            {
                steamId: HOST_ID,
                name: 'Host',
                isReady: false,
                isAlive: true,
                awaitingSpawn: false,
            },
            {
                steamId: PEER_ID,
                name: 'Peer',
                isReady: false,
                isAlive: true,
                awaitingSpawn: false,
            },
        ];
        const readyRoster = waitingRoster.map((player) => ({ ...player, isReady: true }));

        expect(normalizeWireTrace(wire.messages)).toEqual([
            {
                route: 'PEER->HOST',
                channel: 0,
                type: MessageTypes.NET_HELLO,
                data: { protocolVersion: '1.0.0', name: 'Peer', asSpectator: false },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.NET_WELCOME,
                data: { accepted: true, reason: 'ok', hostSteamId: HOST_ID },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.LOBBY_PLAYER_JOINED,
                data: { players: waitingRoster, spectatorCount: 0 },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.GAME_STATE_RESYNC,
                data: {
                    resyncId: 'R1',
                    chunkIndex: 0,
                    chunkCount: 1,
                    baselineSnapshotSeq: 1,
                    baselineSimTick: 0,
                    roundGeneration: 0,
                },
            },
            {
                route: 'PEER->HOST',
                channel: 0,
                type: MessageTypes.GAME_STATE_RESYNC_ACK,
                data: { resyncId: 'R1', chunkIndex: 0, isFinal: false },
            },
            {
                route: 'PEER->HOST',
                channel: 0,
                type: MessageTypes.GAME_STATE_RESYNC_ACK,
                data: { resyncId: 'R1', chunkIndex: null, isFinal: true },
            },
            {
                route: 'PEER->HOST',
                channel: 0,
                type: MessageTypes.LOBBY_PLAYER_READY,
                data: { steamId: PEER_ID, isReady: true },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.LOBBY_PLAYER_JOINED,
                data: { players: readyRoster, spectatorCount: 0 },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.NET_WELCOME,
                data: { accepted: true, reason: 'match_start', hostSteamId: HOST_ID },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.LOBBY_GAME_START,
                data: {
                    sharedSeed: 424242,
                    roundGeneration: 0,
                    simulationClock: 'legacy-variable-v1',
                },
            },
            {
                route: 'PEER->HOST',
                channel: 0,
                type: MessageTypes.GAME_INPUT_BATCH,
                data: {
                    inputs: [{ type: 'move', data: { direction: -1 }, seq: 1 }],
                    roundGeneration: 0,
                },
            },
            {
                route: 'HOST->PEER',
                channel: 0,
                type: MessageTypes.GAME_STATE_FULL,
                data: {
                    binary: true,
                    delta: false,
                    roundGeneration: 0,
                    migrationEpoch: 0,
                    acknowledgements: { HOST: 0, PEER: 1 },
                    digest: '8a2bf791',
                    encodedSize: 389,
                },
            },
        ]);

        expect(normalizeNetEventTrace(host)).toEqual([
            {
                type: 'resync_queued',
                // Admission queues inside NET_HELLO, so capture is fenced until
                // the tracked packet stack drains after the handler returns.
                data: { steamId: PEER_ID, phase: 'waiting', syncpoint: 'busy' },
            },
            {
                type: 'resync_started',
                data: { steamId: PEER_ID, chunkCount: 1 },
            },
            {
                type: 'resync_completed',
                data: { steamId: PEER_ID },
            },
            {
                type: 'input_batch_accepted',
                data: {
                    steamId: PEER_ID,
                    count: 1,
                    minSeq: 1,
                    maxSeq: 1,
                    clientTick: 0,
                    lastAck: -1,
                },
            },
            {
                type: 'input_applied',
                data: {
                    steamId: PEER_ID,
                    inputType: 'move',
                    seq: 1,
                    buffered: false,
                },
            },
        ]);
    });

    it('preserves seed zero at match start and owns the current seed across restart/resync', () => {
        const wire = new SerializedLoopbackWire();
        const hostNetwork = makeNetwork({ steamId: HOST_ID, playerName: 'Host', isHost: true });
        const host = new FFAGameStateP2P(hostNetwork, HOST_ID);
        activeStates.push(host);
        host.stopHeartbeatLoop();
        wire.attach(hostNetwork);

        const peerNetwork = makeNetwork({ steamId: PEER_ID, playerName: 'Peer', isHost: false });
        wire.attach(peerNetwork);
        const peer = new FFAGameStateP2P(peerNetwork, PEER_ID);
        activeStates.push(peer);
        peer.hostMigration.stopMonitoring();
        peer.announceJoin();
        wire.drain();
        silenceRuntimeLoops(host);
        silenceRuntimeLoops(peer);

        // Explicit zero must not fall through to host generation or peer rejection.
        host.startMatch(0);
        wire.drain();

        expect(host.sharedSeed).toBe(0);
        expect(peer.sharedSeed).toBe(0);
        expect(host.players.get(HOST_ID).gameState.randomGenerator.seed).toBe(0);
        expect(host.players.get(PEER_ID).gameState.randomGenerator.seed).toBe(0);
        expect(peer.players.get(PEER_ID).gameState.randomGenerator.seed).toBe(0);
        expect(peer.players.get(PEER_ID).gameState.nextPieces).toEqual(
            host.players.get(PEER_ID).gameState.nextPieces,
        );

        // Retire both pending initial countdowns before exercising instant restart.
        host.hideCountdownOverlay();
        peer.hideCountdownOverlay();
        host.gamePhase = 'playing';
        peer.gamePhase = 'playing';
        vi.spyOn(Math, 'random').mockReturnValue(0.271828);

        host.restartMatch();
        expect(host.sharedSeed).toBe(271828);
        expect(host.players.get(HOST_ID).gameState.randomGenerator.seed).toBe(271828);

        // A reliable capture made before the peer receives the restart must already
        // advertise the new round seed, matching every exact RNG descriptor.
        const resyncPayload = host._buildResyncPayload();
        expect(resyncPayload.header.sharedSeed).toBe(271828);
        expect(resyncPayload.sidecar.players.map((player) => player.rng.seed))
            .toEqual([271828, 271828]);

        wire.drain();
        expect(peer.sharedSeed).toBe(271828);
        expect(peer.players.get(PEER_ID).gameState.randomGenerator.seed).toBe(271828);
        expect(peer.players.get(PEER_ID).gameState.nextPieces).toEqual(
            host.players.get(PEER_ID).gameState.nextPieces,
        );
    });

    it('pins the local countdown semantic timeline and missing-overlay fallback', async () => {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = onMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, ({ count }) => {
            events.push({ at: Date.now() - startedAt, count });
        });
        activeUnsubscribes.push(unsubscribe);
        const callback = vi.fn(() => events.push({ at: Date.now() - startedAt, count: 'callback' }));

        FFAGameStateP2P.prototype.showCountdown.call({}, callback, null, 2, true);
        await vi.advanceTimersByTimeAsync(3000);
        unsubscribe();

        expect(events.map(({ count }) => count)).toEqual([2, 1, 0, 'GO', 'callback']);
        expect(events.at(-1).at).toBeGreaterThanOrEqual(2400);

        document.getElementById = () => null;
        const fallback = vi.fn();
        FFAGameStateP2P.prototype.showCountdown.call({}, fallback);
        expect(fallback).toHaveBeenCalledOnce();
    });
});
