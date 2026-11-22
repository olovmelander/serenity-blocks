/**
 * Online rules that were broken without anyone noticing:
 * - Blind modes (G9): a blind attack at the head of a peer's queue stopped every line
 *   behind it from landing, and a counter stopped at it, cancelling nothing.
 * - Hot potato (G15): a pass went to the attacker's first opponent in roster order, so
 *   the potato bounced between the first two players, and it kept its holder into the next
 *   round. (The potato is now a turn order of teams with row targets: hot-potato.js, pinned in
 *   versus-attack-modes.test.js; the round reset is pinned here.)
 * - Attacker names (G16): garbage carries its attacker as a hash that nothing could
 *   decode, so peers saw `unknown_<hash>`.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { FFAAttackRouter } from '../../src/core/multiplayer/ffa-attack-router.js';
import { cancelIncomingLines } from '../../src/core/multiplayer/ffa/garbage-helpers.js';
import { GarbageQueue } from '../../src/core/garbage.js';
import { GameState } from '../../src/core/game.js';
import { getBinaryDecoder, getBinaryEncoder } from '../../src/core/network/binary-encoding.js';

afterEach(() => vi.restoreAllMocks());

const line = (attackId, lineIndex = 0, extra = {}) => ({
    type: 'line', attackId, lineIndex, holeMask: 1, isLastInBurst: true, ...extra,
});
const blind = (attackId) => ({ type: 'blind', attackId, lineIndex: 0, ticks: 30 });

describe('Blind modes online', () => {
    it('a counter cancels lines behind a blind attack and leaves the blind queued', () => {
        const queue = { entries: [blind('b1'), line('a1'), line('a2'), blind('b2'), line('a3')] };
        expect(cancelIncomingLines(queue, 2)).toBe(2);
        expect(queue.entries.map((e) => e.attackId)).toEqual(['b1', 'b2', 'a3']);
        expect(cancelIncomingLines(queue, 5)).toBe(1);
        expect(queue.entries.map((e) => e.type)).toEqual(['blind', 'blind']);
    });

    it('a peer\'s own board takes the lines queued behind a blind attack', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const gameState = new GameState();
        const garbageQueue = new GarbageQueue();
        garbageQueue.entries = [blind('b1'), line('a1')];
        const peer = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false,
            players: new Map([['P1', { steamId: 'P1', name: 'P1', isAlive: true, gameState, garbageQueue }]]),
            _garbageDrainAll: false,
            _garbageIdempotentEnabled: true,
            _peerConsumedBursts: new Set(),
            renderAllPlayers: () => {},
        });

        peer._insertLocalGarbagePrediction('P1');

        expect(garbageQueue.entries).toEqual([]);
        const bottom = gameState.boardGrid[gameState.boardGrid.length - 1];
        expect(bottom.filter(Boolean)).toHaveLength(9); // one garbage row, one hole
        expect(gameState.blind.pieceTicks).toBe(30); // the blind waits for the piece spawning now
        // The next host snapshot, still listing the blind, does not hand it back.
        expect(peer._peerConsumedBursts.has('b1:0')).toBe(true);
    });
});

describe('Hot potato online', () => {
    function potatoGame(ids) {
        return {
            isHost: true,
            matchConfig: { hotPotato: true },
            players: new Map(ids.map((id) => [id, { steamId: id, isAlive: true }])),
            network: { broadcastToAll: vi.fn() },
        };
    }
    const attack = { getTotalLines: () => 2 };

    it('hands the potato around every seat, never to the same seat twice in a row', () => {
        const router = new FFAAttackRouter(potatoGame(['A', 'B', 'C']));
        router.resetHotPotato(0);
        const holders = [];
        let now = 0;
        for (let turn = 0; turn < 9; turn += 1) {
            now += 2000;
            router.updateHotPotato(now);
            const { holder } = router.gameState.hotPotatoState;
            holders.push(holder);
            router.routeHotPotatoAttack(holder, { getTotalLines: () => 10 }); // past any target
        }
        holders.slice(1).forEach((holder, index) => expect(holder).not.toBe(holders[index]));
        expect(new Set(holders.slice(0, 3)).size).toBe(3); // a whole shuffle before repeats
    });

    it('starts each round fresh: nobody holds it until two seconds into the round', () => {
        const router = new FFAAttackRouter(potatoGame(['A', 'B', 'C']));
        router.resetHotPotato(0);
        router.updateHotPotato(2000);
        router.routeHotPotatoAttack(router.gameState.hotPotatoState.holder, attack);
        router.resetHotPotato(50_000);
        const state = router.gameState.hotPotatoState;
        expect(state.holder).toBeNull();
        expect(state.targets).toEqual({});
        expect(state.generation).toBe(0);
        router.updateHotPotato(51_999);
        expect(router.gameState.hotPotatoState.holder).toBeNull();
        router.updateHotPotato(52_000);
        expect(router.gameState.hotPotatoState.holder).not.toBeNull();
    });
});

describe('Attacker names on peers', () => {
    it('a player added to any roster can be named as an attacker after decoding', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const snapshot = {
            players: [{
                steamId: 'VICTIM',
                name: 'Victim',
                color: '#ff0000',
                score: 0, lines: 0, level: 1, frags: 0,
                isAlive: true,
                awaitingSpawn: false,
                garbagePending: 1,
                dropCounter: 0,
                dropInterval: 800,
                grid: Array.from({ length: 24 }, () => Array(10).fill(null)),
                currentPiece: null,
                nextPieces: ['I', 'O', 'T'],
                garbageEntries: [{ type: 'line', attackerId: '76561198000000777', holeMask: 1, lineIndex: 0 }],
                lockedPieces: [],
                blindTimers: null,
                lastInputSeq: 0,
            }],
            gamePhase: 'playing', winner: null, timestamp: 0, tick: 1, simTick: 1, snapshotSeq: 1,
        };
        const decode = () => getBinaryDecoder()
            .decodeSnapshot(getBinaryEncoder().encodeSnapshot(snapshot)).players[0].garbageEntries[0].attackerId;
        expect(decode()).toMatch(/^unknown_/);

        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false, players: new Map(), network: {}, matchConfig: {},
        });
        state.addPlayer('76561198000000777', 'Attacker');
        expect(decode()).toBe('76561198000000777');
    });
});
