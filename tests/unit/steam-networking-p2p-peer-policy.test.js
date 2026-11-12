/**
 * A match is a star through its host, so a player's computer opens a P2P session with the host
 * alone (electron/p2p-session-gate.js). The transport tells the main process its role as it
 * changes, and host migration says when the host looks gone, the one time another member (the
 * player taking over) may reach this one.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { HOST_SUSPECT_MS, HostMigration } from '../../src/core/network/host-migration.js';

const POLICY = 'steam:setP2PPeerPolicy';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

async function makeNetwork({ steam = true } = {}) {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const invoke = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', {
        ...(steam ? { electronAPI: { invoke } } : {}), location: { search: '' },
    });
    const { SteamNetworking } = await import('../../src/core/steam/steam-networking.js');
    const network = new SteamNetworking();
    const policies = () => invoke.mock.calls.filter(([channel]) => channel === POLICY).map(([, policy]) => policy);
    return { network, invoke, policies };
}

describe('SteamNetworking tells the main process who it talks to', () => {
    it('says nothing until it has a role, then reports each change once', async () => {
        const { network, policies } = await makeNetwork();
        expect(network.mockMode).toBe(false);
        expect(policies()).toEqual([]);

        network.isHost = false;
        network.hostSteamId = '76561198000000001';
        network.hostSteamId = '76561198000000001'; // no change: nothing sent
        network.isHost = false;
        expect(policies()).toEqual([
            { isHost: false, hostSteamId: null, hostSuspected: false },
            { isHost: false, hostSteamId: '76561198000000001', hostSuspected: false },
        ]);
        expect(network.isHost).toBe(false);
        expect(network.hostSteamId).toBe('76561198000000001');
    });

    it('opens to the member taking over only while the host looks gone, and closes on following a host', async () => {
        const { network, policies } = await makeNetwork();
        network.isHost = false;
        network.hostSteamId = '76561198000000001';
        network.setHostSuspected(true);
        network.setHostSuspected(true);
        expect(policies().at(-1)).toEqual({
            isHost: false, hostSteamId: '76561198000000001', hostSuspected: true,
        });

        network.hostSteamId = '76561198000000002'; // the new host is followed
        expect(policies().at(-1)).toEqual({
            isHost: false, hostSteamId: '76561198000000002', hostSuspected: false,
        });
        expect(policies()).toHaveLength(4);

        network.setHostSuspected(true);
        network.setHostSuspected(false); // the host spoke again
        expect(policies().at(-1).hostSuspected).toBe(false);
    });

    it('reports a promotion to host, and tells the role afresh in the next lobby', async () => {
        const { network, policies } = await makeNetwork();
        network.isHost = false;
        network.hostSteamId = '76561198000000001';
        network.setHostSuspected(true);
        network.isHost = true;
        network.hostSteamId = '76561198000000009';
        expect(policies().at(-1)).toEqual({
            isHost: true, hostSteamId: '76561198000000009', hostSuspected: false,
        });

        const before = policies().length;
        network._resetLobbySession();
        network.isHost = true;
        // The main process forgot the role with the lobby, so an unchanged one is sent again.
        expect(policies().length).toBeGreaterThan(before);
        expect(policies().at(-1)).toEqual({ isHost: true, hostSteamId: null, hostSuspected: false });
    });

    it('survives an IPC that fails, and sends nothing in a test lobby without Steam', async () => {
        const failing = await makeNetwork();
        failing.invoke.mockImplementation(() => { throw new Error('no main process'); });
        expect(() => { failing.network.isHost = true; }).not.toThrow();
        failing.invoke.mockReturnValue(undefined);
        expect(() => { failing.network.hostSteamId = '76561198000000001'; }).not.toThrow();

        const mock = await makeNetwork({ steam: false });
        expect(mock.network.mockMode).toBe(true);
        mock.network.isHost = true;
        mock.network.hostSteamId = 'mock_host';
        mock.network.setHostSuspected(true);
        expect(mock.network.isHost).toBe(true);
        expect(mock.network.hostSteamId).toBe('mock_host');
    });
});

describe('host migration says when the host looks gone', () => {
    function makeMigration({ phase = 'playing', silenceMs = 0 } = {}) {
        const network = {
            hostSteamId: 'HOST',
            isHost: false,
            connectedPeers: new Map(),
            peerSilenceMs: vi.fn(() => silenceMs),
            setHostSuspected: vi.fn(),
            broadcastToAll: vi.fn(),
        };
        const game = {
            network,
            isHost: false,
            handshakeComplete: true,
            gamePhase: phase,
            localPlayerId: 'ZED',
            players: new Map([
                ['HOST', { steamId: 'HOST' }], ['ANN', { steamId: 'ANN' }], ['ZED', { steamId: 'ZED' }],
            ]),
        };
        return { migration: new HostMigration(game), network, game };
    }

    it('not while the host is heard from, nor outside a match', () => {
        const quiet = makeMigration({ silenceMs: HOST_SUSPECT_MS - 1 });
        quiet.migration.check(10_000);
        expect(quiet.network.setHostSuspected).toHaveBeenLastCalledWith(false);

        const lobby = makeMigration({ phase: 'waiting', silenceMs: HOST_SUSPECT_MS + 500 });
        lobby.migration.check(10_000);
        expect(lobby.network.setHostSuspected).toHaveBeenLastCalledWith(false);
    });

    it('once the host has been quiet mid-match for as long as a claim is believed after', () => {
        const { migration, network } = makeMigration({ silenceMs: HOST_SUSPECT_MS });
        migration.check(10_000);
        expect(network.setHostSuspected).toHaveBeenLastCalledWith(true);
        expect(migration.isElectionInProgress).toBe(false);
    });

    it('at once when the host is reported gone, before the claim goes out', () => {
        const { migration, network, game } = makeMigration();
        game.localPlayerId = 'ANN'; // first in line: claims at once
        game.promoteToHost = vi.fn();
        const order = [];
        network.setHostSuspected.mockImplementation((value) => order.push(`suspected:${value}`));
        network.broadcastToAll.mockImplementation((type) => order.push(`send:${type}`));

        migration.onHostGone('left', 10_000);

        expect(order[0]).toBe('suspected:true');
        expect(order.findIndex((entry) => entry.startsWith('send:'))).toBeGreaterThan(0);
        migration.dispose();
    });

    it('keeps saying so through an election, and leaves a transport without the hook alone', () => {
        const { migration, network, game } = makeMigration();
        migration.onHostGone('left', 10_000); // ZED is last in line: waits for ANN's claim
        expect(migration.isElectionInProgress).toBe(true);
        network.setHostSuspected.mockClear();
        migration.check(10_500);
        expect(network.setHostSuspected).toHaveBeenLastCalledWith(true);

        delete network.setHostSuspected;
        game.gamePhase = 'playing';
        expect(() => migration.check(11_000)).not.toThrow();
        migration.dispose();
    });
});
