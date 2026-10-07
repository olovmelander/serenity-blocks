/**
 * Host loss, end to end: real game states over a loopback wire (helpers/session-wire.js).
 * Outside a match the lobby ends for everyone; in a match the players still present
 * elect a successor, by rank, with a step for each candidate that does not claim, and
 * nobody is left behind. Before, host loss was noticed only mid-round, an election had
 * no timeout and could pick a departed player, and a claim counted only if the
 * receiver's own monitor had fired first: survivors hung, or split into two matches.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    buildSession, disposeSession, installSessionDom, startSessionMatch, step,
} from './helpers/session-wire.js';
import { ELECTION_STEP_MS, HOST_GONE_IDLE_MS, HOST_GONE_MS } from '../../src/core/network/host-migration.js';
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

function exits() {
    const seen = [];
    unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.KICKED, (detail) => seen.push(detail.reason)));
    return seen;
}

/** The host vanishes: nothing in or out, and its own timers stop. */
function crashHost({ wire, host }) {
    wire.cut(host.localPlayerId);
    host.cleanup();
}

const view = (state) => ({ isHost: state.isHost, host: state.network.hostSteamId, phase: state.gamePhase });

describe('host loss outside a match', () => {
    it('a host who leaves the waiting room ends it for everyone at once', async () => {
        session = await buildSession(vi);
        const left = exits();
        session.host.network.leaveLobby();
        session.wire.drain();
        expect(left).toEqual(['host_left', 'host_left']);
    });

    it('a host who crashes in the waiting room ends it after the idle limit, not before', async () => {
        session = await buildSession(vi);
        const left = exits();
        crashHost(session);
        await step(vi, session.wire, HOST_GONE_IDLE_MS - 1000, 500);
        expect(left).toEqual([]);
        await step(vi, session.wire, 2000, 500);
        expect(left).toEqual(['host_left', 'host_left']);
        expect(session.peers.every((peer) => !peer.isHost)).toBe(true); // nobody took over a lobby
    });
});

describe('host loss in a match', () => {
    it('the first-ranked survivor takes over and everyone follows; the old host is out', async () => {
        session = await buildSession(vi);
        await startSessionMatch(vi, session);
        const [p1, p2] = session.peers;
        crashHost(session);
        await step(vi, session.wire, HOST_GONE_MS + 1500, 250);

        expect(view(p1)).toEqual({ isHost: true, host: 'P1', phase: 'playing' });
        expect(view(p2)).toEqual({ isHost: false, host: 'P1', phase: 'playing' });
        expect(p1.players.get('H0')).toMatchObject({ isDisconnected: true, isAlive: false });
        expect(p2.players.get('H0')?.isDisconnected).toBe(true);
        // The new host keeps the peer: it is still in after the departure limit.
        await step(vi, session.wire, HOST_GONE_MS * 2, 500);
        expect(p1.players.get('P2')).toMatchObject({ isDisconnected: false, isAlive: true });
    });

    it('a candidate that died with the host costs one election step, not the match', async () => {
        session = await buildSession(vi, { peerIds: ['P1', 'P2', 'P3'] });
        await startSessionMatch(vi, session);
        const [p1, p2, p3] = session.peers;
        session.wire.cut('P1'); // the first-ranked survivor goes down with the host
        p1.cleanup();
        crashHost(session);
        await step(vi, session.wire, HOST_GONE_MS + ELECTION_STEP_MS + 1500, 250);

        expect(view(p2)).toMatchObject({ isHost: true, host: 'P2' });
        expect(view(p3)).toMatchObject({ isHost: false, host: 'P2' });
    });

    it('a survivor whose monitor fires late still follows the successor (no split)', async () => {
        session = await buildSession(vi);
        await startSessionMatch(vi, session);
        const [p1, p2] = session.peers;
        p2.hostMigration.stopMonitoring(); // its own monitor never fires
        crashHost(session);
        await step(vi, session.wire, HOST_GONE_MS + 1500, 250);
        expect(view(p2)).toMatchObject({ isHost: false, host: 'P1' });
        expect(p1.isHost).toBe(true);
    });

    it('in a duel the host who leaves loses: the one who stayed wins the match', async () => {
        session = await buildSession(vi, { peerIds: ['P1'] });
        await startSessionMatch(vi, session);
        const [p1] = session.peers;
        const overs = [];
        unsubscribes.push(onMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, (detail) => overs.push(detail)));
        session.host.network.leaveLobby();
        session.wire.drain();
        session.host.cleanup();
        await step(vi, session.wire, 1000, 250);

        expect(p1.isHost).toBe(true);
        expect(p1.gamePhase).toBe('finished');
        expect(p1.winner?.steamId).toBe('P1');
        expect(overs.at(-1)?.isGameOver).toBe(true);
    });

    it('a host lost during the round-over beat: the successor starts the next round', async () => {
        session = await buildSession(vi);
        await startSessionMatch(vi, session);
        const { host, wire } = session;
        const [p1, p2] = session.peers;
        host.matchConfig.endConditionValue = 99;
        host.players.get('P2').isAlive = false;
        host.players.get('H0').isAlive = false;
        host.fragTracker.checkMatchEnd(); // P1 takes the round; the beat begins
        wire.drain();
        expect(p1.gamePhase).toBe('finished');
        crashHost(session);
        await step(vi, wire, HOST_GONE_MS + 6000, 250);

        expect(p1.isHost).toBe(true);
        expect(p1.gamePhase).toBe('playing');
        expect(p2.gamePhase).toBe('playing');
        expect(p1.players.get('P2').isAlive).toBe(true);
        expect(p1.players.has('H0')).toBe(false); // gone between rounds: off the roster at once
    });

    it('a host quiet for less than the limit is still the host', async () => {
        session = await buildSession(vi);
        await startSessionMatch(vi, session);
        session.wire.blackhole('H0');
        await step(vi, session.wire, HOST_GONE_MS - 1500, 250);
        session.wire.restore('H0');
        await step(vi, session.wire, 4000, 250);
        session.peers.forEach((peer) => expect(view(peer)).toMatchObject({ isHost: false, host: 'H0' }));
    });
});
