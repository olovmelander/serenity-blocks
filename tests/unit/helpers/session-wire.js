// A loopback wire for online session tests: real FFAGameStateP2P instances over real
// mock-mode SteamNetworking transports, under fake timers. Every message is serialized,
// as on the wire, and delivered when the test drains the wire. A node can crash (cut:
// nothing in or out, ever again) or go quiet for a while (blackhole, then restore).
import { FFAGameStateP2P } from '../../../src/core/multiplayer/ffa-p2p-game-state.js';
import { SteamNetworking } from '../../../src/core/steam/steam-networking.js';

export const LOBBY = 'session-lobby';

/** The countdown element startMatch drives, and an animation frame on a timer. */
export function installSessionDom(vi) {
    const countdownElement = { offsetHeight: 100, style: {}, textContent: '' };
    vi.stubGlobal('document', {
        activeElement: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getElementById: (id) => (id === 'multiplayer-countdown' ? countdownElement : null),
        querySelector: vi.fn(() => null),
    });
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
}

export class SessionWire {
    constructor() {
        this.endpoints = new Map();
        this.down = new Set();
        this.pending = [];
        this.log = [];
    }

    /** @param {SteamNetworking} network */
    attach(network) {
        this.endpoints.set(network.steamId, network);
        this.down.delete(network.steamId);
        network.broadcastChannel = {
            close: () => {},
            postMessage: (message) => {
                const serialized = JSON.stringify(message);
                const record = JSON.parse(serialized);
                if (this.down.has(record.from)) return;
                this.log.push({ from: record.from, to: record.to, type: record.msgType || record.type });
                this.endpoints.forEach((endpoint, targetId) => {
                    if (targetId === record.from) return;
                    if (record.to !== 'all' && record.to !== targetId) return;
                    this.pending.push({ targetId, endpoint, serialized });
                });
            },
        };
    }

    /** Drop a node's traffic both ways, keeping the process alive. */
    blackhole(steamId) { this.down.add(steamId); }

    restore(steamId) { this.down.delete(steamId); }

    /** A crash or a pulled cable: nothing in or out, ever again. */
    cut(steamId) {
        this.down.add(steamId);
        this.endpoints.delete(steamId);
    }

    drain(limit = 5000) {
        let delivered = 0;
        while (this.pending.length) {
            delivered += 1;
            if (delivered > limit) throw new Error('the wire did not quiesce');
            const { targetId, endpoint, serialized } = this.pending.shift();
            if (this.down.has(targetId) || this.endpoints.get(targetId) !== endpoint) continue;
            endpoint.handleMockP2PMessage(JSON.parse(serialized));
        }
        return delivered;
    }

    count(type, filter = () => true) {
        return this.log.filter((message) => message.type === type && filter(message)).length;
    }
}

function makeNetwork(vi, { steamId, isHost, hostId }) {
    const network = new SteamNetworking();
    network.initialized = true;
    network.mockMode = true;
    network.steamId = steamId;
    network.playerName = steamId;
    network.isHost = isHost;
    network.hostSteamId = hostId;
    network.currentLobbyId = LOBBY;
    network.matchId = LOBBY;
    if (isHost) {
        network.matchNonce = 'nonce-0';
        network.lockProtocolSession();
    }
    network.setNetworkImpairment({ enabled: false });
    network.setLobbyPlayerCount = vi.fn();
    network.setLobbyStatus = vi.fn();
    return network;
}

/**
 * The unified loop is a process-wide singleton; nodes in one process must not share it.
 * Its one effect the session relies on, the host's frame count, runs on a timer instead.
 */
function silenceGameLoop(vi, state) {
    state.startGameLoop = vi.fn(() => { state.loopRunning = true; });
    state.stopGameLoop = vi.fn(() => { state.loopRunning = false; });
    state._sessionFrameTimer = setInterval(() => {
        if (state.isHost && state.gamePhase === 'playing' && !state._disposed) {
            state.simTick = (state.simTick || 0) + 1;
        }
    }, 16);
}

/** Advance fake time in ticks, draining the wire after each. */
export async function step(vi, wire, ms, tick = 100) {
    for (let elapsed = 0; elapsed < ms; elapsed += tick) {
        await vi.advanceTimersByTimeAsync(tick);
        wire.drain();
    }
}

/**
 * A host and peers, joined and handshaken, in the waiting room.
 * @returns {Promise<{wire: SessionWire, host: FFAGameStateP2P, peers: FFAGameStateP2P[]}>}
 */
export async function buildSession(vi, { hostId = 'H0', peerIds = ['P1', 'P2'], watcherIds = [] } = {}) {
    const wire = new SessionWire();
    const hostNetwork = makeNetwork(vi, { steamId: hostId, isHost: true, hostId });
    wire.attach(hostNetwork);
    const host = new FFAGameStateP2P(hostNetwork, hostId);
    silenceGameLoop(vi, host);
    const join = (id, asSpectator) => {
        const network = makeNetwork(vi, { steamId: id, isHost: false, hostId });
        wire.attach(network);
        const peer = new FFAGameStateP2P(network, id, { asSpectator });
        silenceGameLoop(vi, peer);
        peer.announceJoin();
        wire.drain();
        return peer;
    };
    const peers = peerIds.map((id) => join(id, false));
    const watchers = watcherIds.map((id) => join(id, true));
    wire.drain();
    return { wire, host, peers: [...peers, ...watchers] };
}

/** A late arrival joins the session (a player, or a watcher). */
export function joinSession(vi, session, steamId, { asSpectator = false } = {}) {
    const network = makeNetwork(vi, { steamId, isHost: false, hostId: session.host.localPlayerId });
    session.wire.attach(network);
    const peer = new FFAGameStateP2P(network, steamId, { asSpectator });
    silenceGameLoop(vi, peer);
    peer.announceJoin();
    session.wire.drain();
    session.peers.push(peer);
    return peer;
}

/** The host starts the match; the countdown runs out. */
export async function startSessionMatch(vi, session) {
    session.host.startMatch();
    session.wire.drain();
    await step(vi, session.wire, 6000);
}

/** Every game state the session built, for teardown. */
export function disposeSession(session) {
    [session.host, ...session.peers].forEach((state) => {
        clearInterval(state._sessionFrameTimer);
        if (!state._disposed) state.cleanup();
    });
}
