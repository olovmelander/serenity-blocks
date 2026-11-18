/**
 * The relayed sessions' upkeep (electron/relay-session-pump.js, ADR-0023), driven with a fake
 * relay transport: who is accepted, how often, what is closed and reported, and the log lines the
 * two-account test reads (docs/ONLINE_RELAY_TRANSPORT_2026-11.md).
 *
 * Audit 2026-11-18 A18-MP-3: this lived inside electron/steam-integration.js, where only regexes
 * over its source reached it.
 */
import { describe, expect, it } from 'vitest';
import {
    RELAY_ACCEPT_EVERY_MS, RELAY_CHECK_EVERY_MS, createRelaySessionPump,
} from '../../electron/relay-session-pump.js';
import { createP2PSessionGate } from '../../electron/p2p-session-gate.js';
import { SESSION_STATE } from '../../electron/steam-relay-transport.js';

const HOST = '76561198012345678';
const PLAYER = '76561198087654321';
const OTHER = '76561198000000003';

const connected = ({ relayed = true, layoutOk = true } = {}) => ({
    state: SESSION_STATE.connected, relayed, addressKnown: !relayed, layoutOk,
});

/**
 * A pump over a fake transport. Every player has a session request pending (Steam accepts it)
 * unless listed in `notAsking`; a session reads as `sessions` holds it, or as none.
 */
function setup({ members = [PLAYER], allows = () => true } = {}) {
    let t = 10_000;
    const calls = [];
    const logs = [];
    const reports = [];
    const sessions = new Map();
    const notAsking = new Set();
    const failingClose = new Set();
    const fake = {
        acceptFrom(steamId) {
            calls.push(['accept', steamId]);
            return !notAsking.has(steamId);
        },
        session(steamId) {
            calls.push(['session', steamId]);
            return sessions.get(steamId) ?? {
                state: SESSION_STATE.none, relayed: false, addressKnown: false, layoutOk: false,
            };
        },
        close(steamId) {
            calls.push(['close', steamId]);
            if (failingClose.has(steamId)) throw new Error('boom');
            return true;
        },
    };
    const env = {
        transport: fake,
        gate: { allowsSession: allows },
        inLobby: true,
        members,
    };
    const pump = createRelaySessionPump({
        transport: () => env.transport,
        gate: () => env.gate,
        inLobby: () => env.inLobby,
        members: () => env.members,
        now: () => t,
        report: (failure) => reports.push(failure),
        log: (message) => logs.push(message),
    });
    const count = (kind, steamId) => calls
        .filter((call) => call[0] === kind && (steamId === undefined || call[1] === steamId)).length;
    return {
        pump,
        env,
        calls,
        logs,
        reports,
        sessions,
        notAsking,
        failingClose,
        count,
        advance: (ms) => { t += ms; },
        setClock: (ms) => { t = ms; },
    };
}

describe('the relayed sessions (electron/relay-session-pump.js)', () => {
    it('accepts the session of every lobby member the gate allows, and asks for no one else', () => {
        const lobby = new Set([HOST, PLAYER, OTHER]);
        const gate = createP2PSessionGate({ accept: () => {}, isMember: (id) => lobby.has(id) });
        const s = setup({ members: [HOST, OTHER] });
        s.env.gate = null;
        s.pump.pump();
        expect(s.count('accept')).toBe(0); // no gate yet: no one

        // We play in HOST's match: the host alone.
        s.env.gate = gate;
        gate.setPolicy({ isHost: false, hostSteamId: HOST });
        s.advance(RELAY_ACCEPT_EVERY_MS);
        s.pump.pump();
        expect(s.calls.filter((call) => call[0] === 'accept')).toEqual([['accept', HOST]]);
        expect(s.logs).toEqual([`Accepted a relayed session from lobby member ${HOST}`]);

        // We host: every member, each logged once.
        gate.setPolicy({ isHost: true, hostSteamId: PLAYER });
        s.advance(RELAY_ACCEPT_EVERY_MS);
        s.pump.pump();
        expect(s.calls.filter((call) => call[0] === 'accept').slice(1)).toEqual([['accept', HOST], ['accept', OTHER]]);
        expect(s.logs.filter((line) => line.startsWith('Accepted'))).toEqual([
            `Accepted a relayed session from lobby member ${HOST}`,
            `Accepted a relayed session from lobby member ${OTHER}`,
        ]);
    });

    it('watches only a session Steam accepted, or a player it sent to or heard from', () => {
        const s = setup({ members: [PLAYER, OTHER] });
        s.notAsking.add(OTHER);
        s.pump.notePeer(HOST);
        s.pump.pump();
        expect(s.logs).toEqual([`Accepted a relayed session from lobby member ${PLAYER}`]);
        expect(s.calls.filter((call) => call[0] === 'session')).toEqual([['session', HOST], ['session', PLAYER]]);
    });

    it('runs one accept round per accept interval and one session check per check interval', () => {
        const s = setup();
        s.pump.pump();
        expect([s.count('accept'), s.count('session')]).toEqual([1, 1]);
        s.advance(RELAY_ACCEPT_EVERY_MS - 1);
        s.pump.pump();
        expect([s.count('accept'), s.count('session')]).toEqual([1, 1]);
        s.advance(1);
        s.pump.pump();
        expect([s.count('accept'), s.count('session')]).toEqual([2, 1]);
        s.advance(RELAY_CHECK_EVERY_MS - RELAY_ACCEPT_EVERY_MS);
        s.pump.pump();
        expect([s.count('accept'), s.count('session')]).toEqual([3, 2]);
        expect([RELAY_ACCEPT_EVERY_MS, RELAY_CHECK_EVERY_MS]).toEqual([200, 1000]);
    });

    it('accepts and checks at once when the clock went back, then keeps its intervals from there', () => {
        const s = setup();
        s.setClock(100_000);
        s.pump.pump();
        s.setClock(40_000);
        s.pump.pump();
        expect([s.count('accept'), s.count('session')]).toEqual([2, 2]);
        s.advance(RELAY_ACCEPT_EVERY_MS - 1);
        s.pump.pump();
        expect([s.count('accept'), s.count('session')]).toEqual([2, 2]);
    });

    it('closes and reports, once, a session found connected but not relayed', () => {
        const s = setup();
        s.notAsking.add(PLAYER);
        s.pump.notePeer(PLAYER);
        s.sessions.set(PLAYER, connected({ relayed: false }));
        s.pump.pump();
        expect(s.logs).toEqual([
            `Session with ${PLAYER}: connected, relayed=false, peer address known=true`,
            `WARN: session with ${PLAYER} is not relayed; closing it`,
        ]);
        expect(s.count('close', PLAYER)).toBe(1);
        expect(s.reports).toEqual([{ steamId: PLAYER, error: 'not-relayed' }]);
        for (let i = 0; i < 3; i += 1) {
            s.advance(RELAY_CHECK_EVERY_MS);
            s.pump.pump();
        }
        expect(s.count('session', PLAYER)).toBe(1);
        expect(s.count('close', PLAYER)).toBe(1);
        expect(s.reports).toHaveLength(1);
    });

    it('keeps a relayed session, and one whose session info it cannot trust, logging each once', () => {
        const s = setup({ members: [] });
        s.pump.notePeer(HOST);
        s.pump.notePeer(PLAYER);
        s.sessions.set(HOST, connected());
        s.sessions.set(PLAYER, connected({ relayed: false, layoutOk: false }));
        s.pump.pump();
        s.advance(RELAY_CHECK_EVERY_MS);
        s.pump.pump();
        expect(s.logs).toEqual([
            `Session with ${HOST}: connected, relayed=true, peer address known=false`,
            `Session with ${PLAYER}: connected, relayed=false, peer address known=true`,
        ]);
        expect(s.count('close')).toBe(0);
        expect(s.reports).toEqual([]);
        expect(s.count('session')).toBe(4);
    });

    it('reports, once, a session that ended, and again only when its state changes', () => {
        const s = setup({ members: [] });
        s.pump.notePeer(PLAYER);
        s.sessions.set(PLAYER, connected());
        s.pump.pump();
        s.sessions.set(PLAYER, { ...connected(), state: SESSION_STATE.closedByPeer });
        s.advance(RELAY_CHECK_EVERY_MS);
        s.pump.pump();
        s.advance(RELAY_CHECK_EVERY_MS);
        s.pump.pump();
        expect(s.reports).toEqual([{ steamId: PLAYER, error: SESSION_STATE.closedByPeer }]);
        expect(s.logs.at(-1)).toBe(`WARN: relayed session with ${PLAYER} ended (state 4)`);
        s.sessions.set(PLAYER, { ...connected(), state: SESSION_STATE.problem });
        s.advance(RELAY_CHECK_EVERY_MS);
        s.pump.pump();
        expect(s.reports).toEqual([
            { steamId: PLAYER, error: SESSION_STATE.closedByPeer },
            { steamId: PLAYER, error: SESSION_STATE.problem },
        ]);
        expect(s.count('close')).toBe(0);
    });

    it('closes every session it knows of when the lobby is left, and then forgets them', () => {
        const s = setup({ members: [PLAYER] });
        s.pump.notePeer(HOST);
        s.pump.pump();
        s.pump.notePeer(OTHER);
        s.failingClose.add(HOST);
        const checked = s.count('session');
        s.pump.closeAll();
        expect(s.calls.filter((call) => call[0] === 'close')).toEqual([
            ['close', HOST], ['close', PLAYER], ['close', OTHER],
        ]);
        expect(s.logs.at(-1)).toBe(`WARN: closing the relayed session with ${HOST} failed: boom`);
        s.pump.closeAll();
        expect(s.count('close')).toBe(3);
        s.advance(RELAY_CHECK_EVERY_MS);
        s.env.members = [];
        s.pump.pump();
        expect(s.count('session')).toBe(checked);
    });

    it('closes one player\'s session at once, and stops watching it', () => {
        const s = setup({ members: [] });
        s.pump.notePeer(PLAYER);
        s.pump.notePeer(HOST);
        s.failingClose.add(HOST);
        expect(s.pump.close(BigInt(PLAYER))).toBeUndefined();
        s.pump.close(HOST);
        s.pump.close(null);
        expect(s.calls).toEqual([['close', PLAYER], ['close', HOST]]);
        expect(s.logs).toEqual([`WARN: closing the relayed session with ${HOST} failed: boom`]);
        s.pump.pump();
        expect(s.count('session')).toBe(0);
    });

    it('does nothing outside a lobby or without the relay transport, and loses no turn for it', () => {
        const s = setup();
        s.env.inLobby = false;
        s.pump.pump();
        expect(s.calls).toEqual([]);
        s.env.inLobby = true;
        s.pump.pump();
        expect(s.count('accept')).toBe(1);

        s.env.transport = null;
        s.advance(RELAY_CHECK_EVERY_MS);
        expect(() => {
            s.pump.pump();
            s.pump.close(PLAYER);
            s.pump.closeAll();
        }).not.toThrow();
        expect(s.calls).toEqual([['accept', PLAYER], ['session', PLAYER]]);
    });

    it('forgets, without closing, the sessions of a transport that is gone', () => {
        const s = setup({ members: [] });
        s.pump.notePeer(PLAYER);
        s.pump.forgetAll();
        s.pump.closeAll();
        s.pump.pump();
        expect(s.calls).toEqual([]);
    });

    // As things stand (audit 2026-11-18): the gate still allows a lobby member whose session was
    // closed for not being relayed, so while they keep sending they are accepted again within an
    // accept interval, then closed and reported again at each check. Pinned, not endorsed.
    it('accepts, closes and reports again a player closed for not being relayed who keeps sending', () => {
        const s = setup();
        s.sessions.set(PLAYER, connected({ relayed: false }));
        s.pump.pump();
        expect(s.reports).toEqual([{ steamId: PLAYER, error: 'not-relayed' }]);
        s.advance(RELAY_ACCEPT_EVERY_MS);
        s.pump.pump();
        expect(s.logs.filter((line) => line.startsWith('Accepted'))).toHaveLength(2);
        s.advance(RELAY_CHECK_EVERY_MS - RELAY_ACCEPT_EVERY_MS);
        s.pump.pump();
        expect(s.count('close', PLAYER)).toBe(2);
        expect(s.reports).toEqual([
            { steamId: PLAYER, error: 'not-relayed' },
            { steamId: PLAYER, error: 'not-relayed' },
        ]);
    });
});
