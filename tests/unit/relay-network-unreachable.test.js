/**
 * Steam's relay network out of reach while lobbies still work, as when a firewall blocks Valve's
 * relays (audit 2026-11-18, A18-MP-1, the owner's option A). Play is never refused on the relay
 * status: Steam retries a failed relay network when it is next asked, so a negative status can be
 * stale. Instead a join the host never answers, or a session with the host that fails outside a
 * match, says the relay network cannot be reached, and a host is warned once for each lobby.
 * Before, every join ended "The host did not answer" and a host's waiting room just stayed empty.
 *
 * The page talks to a main process that answers `steam:getNetworkTransport` as
 * electron/steam-integration.js does (its real describeNetworkTransport).
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { RELAY_UNAVAILABLE_MESSAGE, describeNetworkTransport } from '../../electron/steam-network-transport.js';
import {
    JOIN_ANSWER_GRACE_MS, scheduleUnansweredJoinRejection,
} from '../../src/core/multiplayer/ffa/join-handshake.js';
import { HostMigration } from '../../src/core/network/host-migration.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));

const { OnlineMultiplayerMode } = await import('../../src/core/game-modes/OnlineMultiplayerMode.js');
const { LobbyWaitingRoom } = await import('../../src/ui/lobby-waiting-room.js');

const HOST = '76561198012345678';
const LOBBY = '109775240000000001';
const HOST_DID_NOT_ANSWER = 'The host did not answer. The lobby may have closed, so try another match.';
const HOST_LEFT = 'The host left, so the lobby closed.';
const NEGATIVE = ['cannot-try', 'failed', 'previously', 'retrying'];

class TestCustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
    }
}

let invoke;
let dispatchEvent;
/** Steam's relay network status, as the main process will report it when next asked. */
let relayNetwork;
let transportMode;
const unsubscribes = [];

const asked = () => invoke.mock.calls.filter(([channel]) => channel === 'steam:getNetworkTransport').length;
const toasts = () => dispatchEvent.mock.calls.map(([event]) => event)
    .filter((event) => event?.type === 'serenity:toast')
    .map((event) => event.detail);

/** The page's real networking, in Electron, with Steam running and the relay transport open. */
async function steamNetworking() {
    invoke = vi.fn(async (channel) => {
        if (channel === 'steam:getNetworkTransport') {
            return describeNetworkTransport({ mode: transportMode, relayNetwork });
        }
        if (channel === 'steam:createLobby') return LOBBY;
        if (channel === 'steam:getLobbyOwner') return HOST;
        return true;
    });
    dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
        electronAPI: { invoke },
        location: { search: '' },
        dispatchEvent,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    vi.resetModules();
    const { SteamNetworking } = await import('../../src/core/steam/steam-networking.js');
    const network = new SteamNetworking();
    expect(network.mockMode).toBe(false);
    network.steamId = '76561198087654321';
    return network;
}

/** The online mode, as far as a session that ends needs it. */
function onlineMode(network) {
    const mode = Object.create(OnlineMultiplayerMode.prototype);
    mode.steamNetworking = network;
    mode._handledSessionExit = null;
    mode._handleExitToMenu = vi.fn(async () => {});
    return mode;
}

/** Join, then hear nothing back: the join gives up as host_unreachable (ffa/join-handshake.js). */
async function joinTheHostNeverAnswers(network, mode, meanwhile = () => {}) {
    await network.joinLobby(LOBBY);
    meanwhile();
    let exit = null;
    unsubscribes.push(onMultiplayerEvent(
        MULTIPLAYER_EVENTS.JOIN_REJECTED,
        (detail) => { exit = mode._handleJoinRejected(detail); },
    ));
    const game = {
        isHost: false, handshakeComplete: false, _disposed: false, _joinHandshakeNonce: 'join-1', network,
    };
    game._announceTimer = scheduleUnansweredJoinRejection(game);
    await vi.advanceTimersByTimeAsync(JOIN_ANSWER_GRACE_MS);
    expect(exit).not.toBeNull();
    await exit;
}

/** Steam reports the session with the host failed, in the waiting room (ffa-p2p-game-state.js's wiring). */
async function sessionWithTheHostFails(network, mode, reason = null) {
    await network.joinLobby(LOBBY);
    const handlers = {};
    network._listenForSteamPeerEvents({ on: (channel, callback) => { handlers[channel] = callback; } });
    const migration = new HostMigration({
        network, isHost: false, _disposed: false, gamePhase: 'waiting', players: new Map(),
    });
    unsubscribes.push(network.onPeerGone((steamId, why) => {
        if (steamId === network.hostSteamId) migration.onHostGone(why);
    }));
    let exit = null;
    unsubscribes.push(onMultiplayerEvent(
        MULTIPLAYER_EVENTS.KICKED,
        (detail) => { exit = mode._handleKicked(detail); },
    ));
    if (reason) migration.onHostGone(reason);
    else handlers['steam:p2pSessionFailed']({ steamId: HOST, error: 5 });
    expect(exit).not.toBeNull();
    await exit;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    relayNetwork = 'current';
    transportMode = 'relay';
});

afterEach(() => {
    unsubscribes.splice(0).forEach((off) => off());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a join or a session that fails while Steam\'s relay network cannot be reached', () => {
    it('a join the host never answers says the relay network cannot be reached, asking Steam afresh', async () => {
        const network = await steamNetworking();
        const mode = onlineMode(network);
        relayNetwork = 'current'; // as the join starts
        let joined = 0;
        await joinTheHostNeverAnswers(network, mode, () => {
            joined = asked();
            relayNetwork = 'failed'; // by the time the join gives up
        });

        expect(toasts()).toHaveLength(1);
        expect(toasts()[0].message).not.toBe(HOST_DID_NOT_ANSWER);
        expect(toasts()[0].message).toMatch(/^Steam's relay network cannot be reached from this computer/);
        expect(toasts()[0].message).toMatch(/firewall/);
        expect(mode._handleExitToMenu).toHaveBeenCalledOnce();
        expect(asked()).toBe(joined + 1); // asked afresh when the join gave up
    });

    it.each(NEGATIVE)('says so for every status Steam counts as a problem: %s', async (status) => {
        const network = await steamNetworking();
        const mode = onlineMode(network);
        relayNetwork = status;
        await joinTheHostNeverAnswers(network, mode);
        expect(toasts().map((toast) => toast.message)).toEqual([
            expect.stringMatching(/^Steam's relay network cannot be reached/),
        ]);
    });

    it.each(['current', 'attempting', 'never-tried', 'unknown'])(
        'still says the host did not answer when the relay network is %s',
        async (status) => {
            const network = await steamNetworking();
            const mode = onlineMode(network);
            relayNetwork = status;
            await joinTheHostNeverAnswers(network, mode);
            expect(toasts()).toEqual([{ message: HOST_DID_NOT_ANSWER, type: 'warning' }]);
        },
    );

    it('a session with the host that fails in the waiting room says the relay network cannot be reached', async () => {
        const network = await steamNetworking();
        const mode = onlineMode(network);
        relayNetwork = 'failed';
        await sessionWithTheHostFails(network, mode);
        expect(toasts()).toHaveLength(1);
        expect(toasts()[0].message).toMatch(/^Steam's relay network cannot be reached/);
    });

    it('the same session failure is the host leaving while the relay network is current', async () => {
        const network = await steamNetworking();
        const mode = onlineMode(network);
        relayNetwork = 'current';
        await sessionWithTheHostFails(network, mode);
        expect(toasts()).toEqual([{ message: HOST_LEFT, type: 'warning' }]);
    });

    it('a host who left the lobby is the host leaving, whatever the relay network says', async () => {
        const network = await steamNetworking();
        const mode = onlineMode(network);
        relayNetwork = 'failed';
        await sessionWithTheHostFails(network, mode, 'lobby_left');
        expect(toasts()).toEqual([{ message: HOST_LEFT, type: 'warning' }]);
    });
});

describe('a host whose relay network cannot be reached is warned once, and still hosts', () => {
    /** The waiting room for a lobby the page's networking created or joined. */
    function waitingRoom(network, isHost) {
        vi.stubGlobal('document', { activeElement: null, body: {} });
        const room = Object.assign(Object.create(LobbyWaitingRoom.prototype), {
            container: {
                classList: { add() {}, remove() {} }, contains: () => false, querySelector: () => null,
            },
            gameState: { isHost, network, players: new Map() },
        });
        unsubscribes.push(() => room.hide());
        room.show();
        return room;
    }

    async function host() {
        const network = await steamNetworking();
        await network.createLobby({ gameName: 'Friday night' });
        return waitingRoom(network, true);
    }
    const notices = () => toasts().filter((toast) => /^Players may not be able to join/.test(toast.message));

    it('warns once for the lobby when Steam reports the relay network failed, and the room stays open', async () => {
        relayNetwork = 'failed';
        const room = await host();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toMatchObject({ type: 'warning' });
        expect(notices()[0].message).toMatch(/relay network cannot be reached from this computer/);
        expect(toasts()).toHaveLength(1);
        expect(room.isVisible).toBe(true);

        room.hide(); // a match, then back to the same lobby
        room.show();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(notices()).toHaveLength(1);
    });

    it('says nothing when the relay network is current, and stops asking', async () => {
        relayNetwork = 'current';
        await host();
        await vi.advanceTimersByTimeAsync(1000);
        const settled = asked();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(toasts()).toEqual([]);
        expect(asked()).toBe(settled);
    });

    it('asks again while the relay network is still starting, and warns once it fails', async () => {
        relayNetwork = 'attempting';
        await host();
        await vi.advanceTimersByTimeAsync(1000);
        expect(notices()).toHaveLength(0);
        relayNetwork = 'failed';
        await vi.advanceTimersByTimeAsync(60_000);
        expect(notices()).toHaveLength(1);
    });

    it('stops asking once the host has left the room', async () => {
        relayNetwork = 'attempting';
        const room = await host();
        await vi.advanceTimersByTimeAsync(1000);
        room.hide();
        relayNetwork = 'failed';
        const before = asked();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(notices()).toHaveLength(0);
        expect(asked()).toBe(before);
    });

    it('never asks for a player in someone else\'s lobby', async () => {
        relayNetwork = 'failed';
        const network = await steamNetworking();
        await network.joinLobby(LOBBY);
        const before = asked();
        waitingRoom(network, false);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(notices()).toHaveLength(0);
        expect(asked()).toBe(before);
    });
});

describe('play is never refused on the relay network\'s status (ADR-0023, unchanged)', () => {
    it.each(NEGATIVE)('lobbies are still created and joined while it is %s', async (status) => {
        const network = await steamNetworking();
        relayNetwork = status;
        await expect(network.createLobby({ gameName: 'Friday night' })).resolves.toBe(LOBBY);
        await expect(network.joinLobby(LOBBY)).resolves.toBeUndefined();
        const channels = invoke.mock.calls.map(([channel]) => channel);
        expect(channels).toContain('steam:createLobby');
        expect(channels).toContain('steam:joinLobby');
    });

    it('a relay transport that did not open is still refused, with the main process\'s message', async () => {
        const network = await steamNetworking();
        transportMode = 'unavailable';
        await expect(network.createLobby({ gameName: 'Friday night' })).rejects.toThrow(RELAY_UNAVAILABLE_MESSAGE);
        await expect(network.joinLobby(LOBBY)).rejects.toThrow(RELAY_UNAVAILABLE_MESSAGE);
        const channels = invoke.mock.calls.map(([channel]) => channel);
        expect(channels).not.toContain('steam:createLobby');
        expect(channels).not.toContain('steam:joinLobby');
    });
});

describe('the page reads the relay network\'s status as the main process names it', () => {
    it('counts exactly Steam\'s negative availability values as the relay network out of reach', async () => {
        // Imported here, so the rest of the file still runs where the module does not exist yet.
        const {
            RELAY_NETWORK_TROUBLE, relayNetworkUnreachable,
        } = await import('../../src/core/steam/relay-network.js');
        const source = readFileSync(new URL('../../electron/steam-relay-transport.js', import.meta.url), 'utf8');
        const start = source.indexOf('const AVAILABILITY');
        const map = source.slice(start, source.indexOf(']);', start));
        const named = Array.from(map.matchAll(/\[(-?\d+), '([a-z-]+)'\]/g), ([, value, name]) => ({
            value: Number(value), name,
        }));
        expect(named).toHaveLength(8);
        const negative = named.filter(({ value }) => value < 0).map(({ name }) => name);
        expect([...RELAY_NETWORK_TROUBLE].sort()).toEqual([...negative].sort());
        named.forEach(({ value, name }) => expect(relayNetworkUnreachable(name), name).toBe(value < 0));
        expect(relayNetworkUnreachable(null)).toBe(false);
        expect(relayNetworkUnreachable('unknown (7)')).toBe(false);
    });
});
