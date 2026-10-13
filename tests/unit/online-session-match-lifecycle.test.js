/**
 * Match lifecycle end to end (helpers/session-wire.js): starting the next match from
 * the waiting room, the lobby listing across rounds, and watchers who arrive while a
 * match is on (audit 2026-10-13: NET-01, NET-05, NET-07).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    buildSession, disposeSession, installSessionDom, joinSession, startSessionMatch, step,
} from './helpers/session-wire.js';
import { ROUND_OVER_BEAT_MS } from '../../src/core/multiplayer/ffa-round-policy.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

let session = null;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installSessionDom(vi);
});

afterEach(() => {
    if (session) disposeSession(session);
    session = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** End the round: everyone but the winner is out, and the match goes on. */
function endRound(host, winnerId) {
    host.matchConfig.endConditionValue = 99;
    host.players.forEach((player, id) => { if (id !== winnerId) player.isAlive = false; });
    host.fragTracker.checkMatchEnd();
}

/** End the match: a one-line race the host has already won. */
function winLinesRace(host) {
    host.matchConfig.endCondition = 'lines';
    host.matchConfig.endConditionValue = 1;
    host.players.get(host.localPlayerId).gameState.lines = 1;
    host.fragTracker.checkMatchEnd();
}

/** OnlineMultiplayerMode._returnToLobbyLocal, on one client. */
function returnToLobby(state) {
    state.gamePhase = 'waiting';
    state.winner = null;
    state.resetReadyStates();
}

/** Count the match starts a client prepares its match view for. */
function countPrepared(state) {
    const prepared = { count: 0 };
    const off = onMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_PREPARING, (data) => {
        if (data?.gameState === state) prepared.count += 1;
    });
    return { prepared, off };
}

describe('the next match from the waiting room', () => {
    it('starts on every peer after a match decided in its first round', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire, peers: [peer] } = session;
        await startSessionMatch(vi, session);
        winLinesRace(host); // no round restart, so nothing else advanced the generation
        wire.drain();
        expect(peer.lastMatchResults?.isGameOver).toBe(true);

        returnToLobby(host);
        returnToLobby(peer);
        wire.drain();
        const starts = vi.spyOn(peer, 'startMatch');
        const { prepared, off } = countPrepared(peer);
        host.startMatch();
        wire.drain();
        await step(vi, wire, 6000);
        off();

        expect(starts).toHaveBeenCalledOnce();
        expect(prepared.count).toBe(1);
        expect(peer.sharedSeed).toBe(host.sharedSeed);
        expect(peer.roundGeneration).toBe(host.roundGeneration);
        expect(peer.gamePhase).toBe('playing');
    });
});

describe('the lobby listing', () => {
    it('stays "playing" through the countdown, every round and the beats, then shows the match over', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2'] });
        const { host, wire } = session;
        const status = () => host.network.setLobbyStatus.mock.calls.at(-1)?.[0];

        host.startMatch();
        wire.drain();
        expect(status()).toBe('playing'); // the start countdown
        await step(vi, wire, 6000);
        expect(host.gamePhase).toBe('playing');
        expect(status()).toBe('playing');

        endRound(host, 'H0');
        wire.drain();
        expect(status()).toBe('playing'); // the beat between rounds
        await step(vi, wire, ROUND_OVER_BEAT_MS + 6000);
        expect(host.gamePhase).toBe('playing');
        expect(host.roundGeneration).toBeGreaterThan(1);
        expect(status()).toBe('playing'); // round 2

        winLinesRace(host);
        wire.drain();
        expect(status()).toBe('finished');
        returnToLobby(host);
        expect(status()).toBe('open');
    });
});

describe('watchers who arrive while a match is on', () => {
    // The wire answers the watcher's handshake inside joinSession, so record the match
    // views prepared from before the join rather than spying on the new client.
    function watchPrepared() {
        const states = [];
        const off = onMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_PREPARING, (data) => states.push(data?.gameState));
        return { count: (state) => states.filter((prepared) => prepared === state).length, off };
    }

    it('during the start countdown: get the match start and open the watch view', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire } = session;
        host.startMatch();
        wire.drain();
        await step(vi, wire, 1000);

        const prepared = watchPrepared();
        const watcher = joinSession(vi, session, 'W1', { asSpectator: true });
        await step(vi, wire, 6000);
        prepared.off();

        expect(host.gamePhase).toBe('playing');
        expect(prepared.count(watcher)).toBe(1);
        expect(watcher.sharedSeed).toBe(host.sharedSeed);
        expect(watcher._lastLobbyStartGeneration).toBe(host.roundGeneration);
    });

    it('during the beat between rounds: get the match start and open the watch view', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire } = session;
        host.startMatch();
        wire.drain();
        await step(vi, wire, 6000);
        endRound(host, 'H0');
        wire.drain();
        const beatGeneration = host.roundGeneration;

        const prepared = watchPrepared();
        const watcher = joinSession(vi, session, 'W2', { asSpectator: true });
        await step(vi, wire, ROUND_OVER_BEAT_MS + 6000);
        prepared.off();

        expect(host.gamePhase).toBe('playing');
        expect(prepared.count(watcher)).toBe(1);
        expect(watcher._lastLobbyStartGeneration).toBe(beatGeneration);
        expect(watcher.roundGeneration).toBe(host.roundGeneration); // and it follows the next round
    });
});

describe('a watcher that spams resync requests', () => {
    it('gets a whole-world capture at most twice in ten seconds (audit NET-09)', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2', 'P3'], watcherIds: ['W1'] });
        const { host, wire } = session;
        const watcher = session.peers.find((peer) => peer.localPlayerId === 'W1');
        host.startMatch();
        wire.drain();
        await step(vi, wire, 6000);
        const captures = vi.spyOn(host, 'queueResync');

        for (let elapsed = 0; elapsed < 10000; elapsed += 50) {
            watcher.network.sendP2PMessage('H0', MessageTypes.GAME_STATE_RESYNC_ACK, { requestResync: true, reason: 'spam' });
            await vi.advanceTimersByTimeAsync(50);
            wire.drain();
        }

        // Before the back-off this was about 40 captures (80 chunks).
        const toWatcher = captures.mock.calls.filter(([steamId]) => steamId === 'W1');
        expect(toWatcher.length).toBeGreaterThan(0);
        expect(toWatcher.length).toBeLessThanOrEqual(2);
        expect(host.gamePhase).toBe('playing');
    });
});
