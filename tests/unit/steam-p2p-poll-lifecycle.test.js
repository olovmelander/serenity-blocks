import { readFileSync } from 'node:fs';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

// Audit SB-02: the 60Hz P2P packet poll must stop when Online MP deactivates
// and re-arm when it activates — it previously ran for the rest of the
// session (menus, single player) after one visit to Online MP.

describe('SteamNetworking P2P poll lifecycle (SB-02)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function makeNetwork() {
        const network = new SteamNetworking();
        network.initialized = true;
        network.mockMode = false;
        return network;
    }

    it('startP2PPolling arms the interval and stopP2PPolling clears it', () => {
        const network = makeNetwork();
        expect(network.pollInterval).toBeFalsy();

        network.startP2PPolling();
        expect(network.pollInterval).toBeTruthy();

        const clearSpy = vi.spyOn(globalThis, 'clearInterval');
        network.stopP2PPolling();
        expect(clearSpy).toHaveBeenCalled();
        expect(network.pollInterval).toBeNull();

        // Idempotent: a second stop must not throw or double-clear.
        const callsAfterFirstStop = clearSpy.mock.calls.length;
        network.stopP2PPolling();
        expect(clearSpy.mock.calls.length).toBe(callsAfterFirstStop);
        network.stopP2PPolling();
        expect(network.pollInterval).toBeNull();
    });

    it('startP2PPolling is re-armable after a stop and never leaks a second interval', () => {
        const network = makeNetwork();
        network.startP2PPolling();
        const first = network.pollInterval;

        // Re-arming without a stop replaces (not duplicates) the interval —
        // pre-existing guard against double-init.
        const clearSpy = vi.spyOn(globalThis, 'clearInterval');
        network.startP2PPolling();
        expect(clearSpy).toHaveBeenCalledWith(first);
        expect(network.pollInterval).toBeTruthy();

        network.stopP2PPolling();
        expect(network.pollInterval).toBeNull();

        network.startP2PPolling();
        expect(network.pollInterval).toBeTruthy();
        network.stopP2PPolling();
    });

    it('mock mode never arms the poll, so stop is a safe no-op', () => {
        const network = new SteamNetworking();
        network.mockMode = true;
        network.startP2PPolling();
        expect(network.pollInterval).toBeFalsy();
        network.stopP2PPolling();
        expect(network.pollInterval).toBeFalsy();
    });
});

describe('OnlineMultiplayerMode P2P poll wiring (SB-02 source contract)', () => {
    const source = readFileSync(
        new URL('../../src/core/game-modes/OnlineMultiplayerMode.js', import.meta.url),
        'utf8',
    );

    it('onDeactivate stops the poll after leaving the lobby', () => {
        const deactivate = source.slice(source.indexOf('async onDeactivate()'));
        const leaveIdx = deactivate.indexOf('.leaveLobby()');
        const stopIdx = deactivate.indexOf('.stopP2PPolling()');
        expect(leaveIdx).toBeGreaterThan(-1);
        expect(stopIdx).toBeGreaterThan(leaveIdx);
    });

    it('onActivate re-arms the poll for the cached networking instance', () => {
        const activate = source.slice(
            source.indexOf('async onActivate()'),
            source.indexOf('async onDeactivate()'),
        );
        expect(activate).toMatch(/steamNetworking\??\.startP2PPolling\(\)/);
    });
});
