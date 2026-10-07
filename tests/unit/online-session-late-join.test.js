/**
 * Joining while a match is on, end to end (helpers/session-wire.js). A player who
 * arrives during the start countdown or the beat between rounds waits for the next
 * round, like one who arrives mid-round. Added from the phase alone, they were a live
 * player with no board who never got the match start, and a round could not end by
 * last standing while they were in it.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    buildSession, disposeSession, installSessionDom, joinSession, step,
} from './helpers/session-wire.js';
import { ROUND_OVER_BEAT_MS } from '../../src/core/multiplayer/ffa-round-policy.js';
import { matchIsOn } from '../../src/core/multiplayer/ffa/presence.js';

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

/** End the round: everyone but the winner is out. */
function endRound(host, winnerId) {
    host.matchConfig.endConditionValue = 99;
    host.players.forEach((player, id) => { if (id !== winnerId) player.isAlive = false; });
    host.fragTracker.checkMatchEnd();
}

describe('joining while a match is on', () => {
    it('during the start countdown: waits out the round, then plays the next', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire } = session;
        host.startMatch();
        wire.drain();
        expect(host.gamePhase).toBe('waiting'); // counting down
        expect(matchIsOn(host)).toBe(true);

        const late = joinSession(vi, session, 'P2');
        expect(host.players.get('P2')).toMatchObject({ isAlive: false, awaitingSpawn: true });
        await step(vi, wire, 6000);
        expect(host.gamePhase).toBe('playing');
        expect(late.gamePhase).toBe('playing'); // it got the match start, and watches

        endRound(host, 'H0'); // the round ends by last standing without the newcomer
        wire.drain();
        expect(host.gamePhase).toBe('finished');
        await step(vi, wire, ROUND_OVER_BEAT_MS + 500);
        expect(host.players.get('P2')).toMatchObject({ isAlive: true, awaitingSpawn: false });
        expect(late.getLocalPlayer().gameState.currentPiece).toBeTruthy();
    });

    it('during the beat between rounds: plays from the round that follows', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        const { host, wire } = session;
        host.startMatch();
        wire.drain();
        await step(vi, wire, 6000);
        endRound(host, 'H0');
        wire.drain();
        expect(matchIsOn(host)).toBe(true);

        const late = joinSession(vi, session, 'P2');
        expect(host.players.get('P2')).toMatchObject({ isAlive: false, awaitingSpawn: true });
        await step(vi, wire, ROUND_OVER_BEAT_MS + 500);
        expect(host.gamePhase).toBe('playing');
        expect(host.players.get('P2')).toMatchObject({ isAlive: true, awaitingSpawn: false });
        expect(late.getLocalPlayer().gameState.currentPiece).toBeTruthy();
    });

    it('in the waiting room a newcomer is simply a player', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        expect(matchIsOn(session.host)).toBe(false);
        joinSession(vi, session, 'P2');
        expect(session.host.players.get('P2')).toMatchObject({ isAlive: true, awaitingSpawn: false });
    });
});
