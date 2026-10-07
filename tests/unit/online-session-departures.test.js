/**
 * Departures, end to end: real game states over a loopback wire (helpers/session-wire.js).
 * A player who leaves, crashes or goes silent is noticed by the host, knocked out if a
 * round is on, held for a while and then dropped, on every roster. Nothing did any of
 * this before: a leaver stayed on every roster, alive, soaking garbage, revived each
 * round, and a duel whose other player left never ended.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    buildSession, disposeSession, installSessionDom, startSessionMatch, step,
} from './helpers/session-wire.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import {
    DEPARTED_AFTER_MS, DEPARTED_IDLE_AFTER_MS, DEPARTED_SEAT_HOLD_MS, adoptHostRoster, presentPlayers,
} from '../../src/core/multiplayer/ffa/presence.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';

let session = null;
const unsubscribes = [];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installSessionDom(vi);
});

afterEach(() => {
    unsubscribes.splice(0).forEach((off) => off());
    if (session) disposeSession(session);
    session = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const rosterOf = (state) => Array.from(state.players.keys()).sort();

describe('departures in the waiting room', () => {
    it('a peer who leaves is gone from every roster at once', async () => {
        session = await buildSession(vi);
        const { wire, host, peers: [p1, p2] } = session;
        expect(rosterOf(host)).toEqual(['H0', 'P1', 'P2']);

        // What the Leave button does: the transport says goodbye, then the state goes.
        p2.network.leaveLobby();
        p2.cleanup();
        wire.cut('P2');
        wire.drain();

        expect(wire.count(MessageTypes.LOBBY_PLAYER_LEFT)).toBe(1);
        expect(rosterOf(host)).toEqual(['H0', 'P1']);
        expect(rosterOf(p1)).toEqual(['H0', 'P1']);
    });

    it('a peer who crashes is gone once it has been silent for the waiting-room limit', async () => {
        session = await buildSession(vi);
        const { wire, host, peers: [p1] } = session;
        wire.cut('P2');

        // Outside a round a busy peer (loading the match) must not lose its place.
        await step(vi, wire, DEPARTED_IDLE_AFTER_MS - 1000, 500);
        expect(host.players.has('P2')).toBe(true);
        await step(vi, wire, 2000, 500);
        expect(rosterOf(host)).toEqual(['H0', 'P1']);
        expect(rosterOf(p1)).toEqual(['H0', 'P1']);
    });

    it('a quiet peer is not taken for gone: it pings the host every second', async () => {
        session = await buildSession(vi);
        const { wire, host } = session;
        await step(vi, wire, 30_000, 1000);
        expect(rosterOf(host)).toEqual(['H0', 'P1', 'P2']);
        expect(wire.count(MessageTypes.NET_PING, (m) => m.from === 'P1')).toBeGreaterThanOrEqual(25);
        expect(wire.count(MessageTypes.NET_PONG, (m) => m.to === 'P1')).toBeGreaterThanOrEqual(25);
    });
});

describe('departures mid-match', () => {
    it('a crashed player is knocked out, held, then dropped; never revived or targeted', async () => {
        session = await buildSession(vi);
        const { wire, host, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        expect(host.gamePhase).toBe('playing');
        const deaths = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, (d) => deaths.push(d)));

        wire.cut('P2');
        await step(vi, wire, DEPARTED_AFTER_MS + 1500, 500);

        const ghost = host.players.get('P2');
        expect(ghost).toMatchObject({ isDisconnected: true, isAlive: false });
        expect(deaths.map((d) => [d.steamId, d.departed])).toEqual([['P2', true]]);
        expect(p1.players.get('P2')?.isDisconnected).toBe(true);
        // Attacks go only to the players still in the match.
        const targets = presentPlayers(host).filter((p) => p.steamId !== 'P1' && p.isAlive).map((p) => p.steamId);
        expect(targets).toEqual(['H0']);
        expect(host.gamePhase).toBe('playing'); // two players are still in

        // The next round does not bring the departed player back.
        host.players.get('P1').isAlive = false;
        host.fragTracker.checkMatchEnd();
        host.restartMatch();
        wire.drain();
        expect(host.players.get('P2').isAlive).toBe(false);

        await step(vi, wire, DEPARTED_SEAT_HOLD_MS, 500);
        expect(rosterOf(host)).toEqual(['H0', 'P1']);
        expect(rosterOf(p1)).toEqual(['H0', 'P1']);
    });

    it('in a duel, the player who leaves loses the match', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { wire, host, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        const ends = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, (d) => ends.push(d)));

        p1.network.leaveLobby();
        p1.cleanup();
        wire.cut('P1');
        wire.drain();

        expect(host.gamePhase).toBe('finished');
        expect(host.winner?.steamId).toBe('H0');
        expect(ends).toHaveLength(1);
        expect(ends[0].isGameOver).toBe(true);
        // No next round is coming.
        expect(host._roundRestartTimer ?? null).toBeNull();
    });

    it('a duel whose other player leaves during the round-over beat ends there', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { wire, host, peers: [p1] } = session;
        await startSessionMatch(vi, session);
        host.matchConfig.endConditionValue = 99;
        const overs = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, (d) => overs.push(d)));

        host.players.get('P1').isAlive = false;
        host.fragTracker.checkMatchEnd(); // the round goes to the host; the beat begins
        wire.drain();
        expect(host.gamePhase).toBe('finished');
        expect(host._roundRestartTimer).not.toBeNull();

        p1.network.leaveLobby();
        p1.cleanup();
        wire.cut('P1');
        wire.drain();
        expect(overs).toHaveLength(1);
        expect(host._roundRestartTimer ?? null).toBeNull();
        await step(vi, wire, 5000, 500);
        expect(host.gamePhase).toBe('finished'); // no round for one player
    });

    it('a player whose packets come back after a blip has their seat back for the next round', async () => {
        session = await buildSession(vi);
        const { wire, host, peers: [, p2] } = session;
        await startSessionMatch(vi, session);
        // Host loss is its own story: keep P2 from electing itself while it hears nothing.
        p2.hostMigration.stopMonitoring();

        wire.blackhole('P2');
        await step(vi, wire, DEPARTED_AFTER_MS + 1500, 500);
        expect(host.players.get('P2')).toMatchObject({ isDisconnected: true, isAlive: false });

        wire.restore('P2');
        await step(vi, wire, 3000, 500);
        expect(host.players.get('P2')).toMatchObject({ isDisconnected: false, awaitingSpawn: true });
        await step(vi, wire, DEPARTED_SEAT_HOLD_MS, 500);
        expect(rosterOf(host)).toEqual(['H0', 'P1', 'P2']); // the hold never ran out
    });

    it('a watcher who crashes is dropped too', async () => {
        session = await buildSession(vi, { watcherIds: ['W9'] });
        const { wire, host } = session;
        expect(host.spectators.has('W9')).toBe(true);
        await step(vi, wire, 10_000, 1000);
        expect(host.spectators.has('W9')).toBe(true); // watching quietly is not leaving
        wire.cut('W9');
        await step(vi, wire, DEPARTED_IDLE_AFTER_MS + 1500, 500);
        expect(host.spectators.has('W9')).toBe(false);
    });
});

describe('the host\'s roster is the roster', () => {
    const entry = (steamId, extra = {}) => ({ steamId, name: steamId, color: '#88aaff', isReady: false, isAlive: true, ...extra });

    function peerState(localPlayerId) {
        const players = new Map();
        return {
            localPlayerId,
            isSpectator: false,
            players,
            addPlayer(steamId, name) {
                players.set(steamId, { steamId, name, isAlive: true });
                return true;
            },
        };
    }

    it('drops the players the host no longer lists and adopts its departed flags', () => {
        const game = peerState('P1');
        adoptHostRoster(game, [entry('H0'), entry('P1'), entry('P2'), entry('P3')]);
        adoptHostRoster(game, [entry('H0'), entry('P1'), entry('P2', { isDisconnected: true, isAlive: false })]);
        expect(Array.from(game.players.keys()).sort()).toEqual(['H0', 'P1', 'P2']);
        expect(game.players.get('P2')).toMatchObject({ isDisconnected: true, isAlive: false });
    });

    it('a peer the host stops listing has lost its seat and leaves', () => {
        const game = peerState('P1');
        const kicked = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.KICKED, (d) => kicked.push(d.reason)));
        // A roster sent before the host added us is not a lost seat.
        adoptHostRoster(game, [entry('H0')]);
        expect(kicked).toEqual([]);
        adoptHostRoster(game, [entry('H0'), entry('P1')]);
        adoptHostRoster(game, [entry('H0')]);
        expect(kicked).toEqual(['connection_lost']);
    });

    it('never marks ourselves departed', () => {
        const game = peerState('P1');
        adoptHostRoster(game, [entry('H0'), entry('P1', { isDisconnected: true })]);
        expect(game.players.get('P1').isDisconnected).toBe(false);
    });
});
