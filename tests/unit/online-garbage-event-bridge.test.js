import {
    describe, expect, it, vi,
} from 'vitest';
import { GarbageQueue } from '../../src/core/garbage.js';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { FFAAttackRouter } from '../../src/core/multiplayer/ffa-attack-router.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';
import {
    buildSession, disposeSession, installSessionDom, startSessionMatch,
} from './helpers/session-wire.js';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));

function readNode(steamId, players, deliver) {
    const network = Object.assign(new SteamNetworking(), { steamId, isHost: steamId === 'host' });
    const mode = Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        ffaGameState: { players, isSpectator: !players.has(steamId) },
        steamNetworking: network,
        cleanupHandlers: [],
        playerColors: new Map(),
        killFeed: { addGarbageSent: vi.fn() },
        _flashGarbageIndicator: vi.fn(),
    });
    const seen = [];
    const stop = onMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_SENT, (data) => seen.push(data));
    try {
        // Match preparation and activation both call this registration.
        mode._registerNetworkHandlers();
        mode._registerNetworkHandlers();
        deliver(network);
        expect(seen.map(({ from, isLocal }) => [from, isLocal])).toEqual([
            ['host', steamId === 'host'], ['peer', steamId === 'peer'],
        ]);
        expect(mode.killFeed.addGarbageSent.mock.calls).toEqual(['host', 'peer'].map((id) => [{
            sender: id, target: '1 player', lines: 2, senderColor: players.get(id).color,
        }]));
    } finally {
        stop();
        mode.cleanupHandlers.forEach((off) => off());
    }
}

describe('outgoing garbage feedback', () => {
    it('delivers one battle-log entry per attack everywhere and marks only the local sender', () => {
        const players = new Map([['host', '#33f'], ['peer', '#f33']].map(([id, color]) => [
            id, {
                steamId: id, name: id, color, isAlive: true, garbageQueue: new GarbageQueue(), gameState: {},
            },
        ]));
        const packets = [];
        readNode('host', players, (network) => {
            vi.spyOn(network, 'broadcastToAll').mockImplementation((type, payload) => packets.push([type, payload]));
            const router = new FFAAttackRouter({
                players, isHost: true, localPlayerId: 'host', network, matchConfig: {}, applyGarbageCounter: () => 0,
            });
            const clear = { depth: 3, holeMask: [1, 2] };
            router.routeAttack('host', clear);
            router.routeAttack('peer', clear);
        });
        expect(packets).toHaveLength(2);
        for (const [type, payload] of packets) {
            expect(type).toBe(MessageTypes.GAME_GARBAGE_SENT);
            expect(payload).not.toHaveProperty('isLocal');
        }
        for (const id of ['peer', 'spectator']) {
            readNode(id, players, (network) => {
                for (const [type, payload] of packets) network._dispatchEnvelope({ msgType: type }, 'host', payload);
            });
        }
    });
});

describe('counter feedback across the reliable presentation lane', () => {
    it('reaches the countering peer once for both full and partial cancellation', async () => {
        vi.useFakeTimers();
        installSessionDom(vi);
        const session = await buildSession(vi, { peerIds: ['P1'], watcherIds: ['watcher'] });
        const { host, peers: [peer, watcher], wire } = session;
        const seen = vi.fn();
        const otherClear = vi.fn();
        const stop = onMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_COUNTERED, seen);
        const stopClear = onMultiplayerEvent(MULTIPLAYER_EVENTS.OPPONENT_CLEAR, otherClear);
        try {
            host.matchConfig.garbageCancellation = 'full';
            await startSessionMatch(vi, session);
            peer._opponentClearEvents = false;
            const hostQueue = host.players.get('P1').garbageQueue;
            const peerQueue = peer.players.get('P1').garbageQueue;
            const queueRow = (queue) => queue.enqueue({ type: 'line', holeMask: 1 });
            queueRow(peerQueue);
            const clear = { depth: 3, holeMask: [1, 2] };
            for (const queued of [3, 1]) {
                hostQueue.clear();
                for (let i = 0; i < queued; i++) queueRow(hostQueue);
                const sentBefore = wire.count(MessageTypes.GAME_GARBAGE_SENT);
                host.attackRouter.routeAttack('P1', clear);
                const cues = wire.pending.filter(({ serialized }) => JSON.parse(serialized).payload?.counter);
                expect(cues.map(({ targetId }) => targetId)).toEqual(['P1']);
                const packet = JSON.parse(cues[0].serialized);
                wire.drain();
                peer.network.handleMockP2PMessage(packet); // replay, same reliable sequence
                const counter = {
                    steamId: 'P1',
                    playerName: 'P1',
                    linesCanceled: Math.min(2, queued),
                    remainingGarbage: Math.max(queued - 2, 0),
                };
                expect(seen.mock.calls).toEqual([[{ ...counter, isLocal: false }], [{ ...counter, isLocal: true }]]);
                expect(wire.count(MessageTypes.GAME_GARBAGE_SENT) - sentBefore).toBe(queued < 2 ? 2 : 0);
                seen.mockClear();
                peer._applyPlayerClear({ ...packet.payload, roundGeneration: peer.roundGeneration - 1 });
                watcher._applyPlayerClear(packet.payload);
                expect(seen).not.toHaveBeenCalled();
            }
            expect(peerQueue.getTotalLines()).toBe(1);
            expect(otherClear).not.toHaveBeenCalled();
        } finally {
            stop();
            stopClear();
            disposeSession(session);
            vi.clearAllTimers();
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
    });
});
