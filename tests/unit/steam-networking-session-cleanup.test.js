import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';

let network;
let invoke;

beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('window', { electronAPI: { invoke } });
    const { SteamNetworking } = await import('../../src/core/steam/steam-networking.js');
    network = new SteamNetworking();
    network.mockMode = false;
    network.currentLobbyId = 'old-lobby';
    network._sendLeaveNotice = vi.fn();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Steam snapshot queue ownership', () => {
    it.each(['resetSnapshotBaselines', 'leaveLobby', 'shutdown'])(
        '%s cancels the queued old delta and lets the next stream send immediately',
        (reset) => {
            network._sendMessage = vi.fn();
            network._queueSnapshot('PEER', MessageTypes.GAME_STATE_FULL, { tick: 1 });
            network._queueSnapshot('PEER', MessageTypes.GAME_STATE_FULL, { tick: 2 });
            expect(network._sendMessage).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(1);

            network[reset]();
            vi.advanceTimersByTime(100);
            expect(network._sendMessage).toHaveBeenCalledTimes(1);
            expect(network.outgoingSnapshotState.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);

            network._queueSnapshot('PEER', MessageTypes.GAME_STATE_FULL, { tick: 3 });
            expect(network._sendMessage).toHaveBeenCalledTimes(2);
            expect(network._sendMessage).toHaveBeenLastCalledWith(
                'PEER', MessageTypes.GAME_STATE_FULL, { tick: 3 }, expect.any(Object),
            );
        },
    );
});

describe('Steam lobby best-effort IPC', () => {
    function rejectIpc() {
        const failure = new Error('Steam connection lost');
        invoke.mockImplementation(() => {
            const rejected = Promise.reject(failure);
            // Observe the rejection so a regression fails on the missing warning,
            // rather than creating unrelated global unhandled-rejection failures.
            rejected.catch(() => {});
            return rejected;
        });
        return failure;
    }

    it('handles a rejected lobby-status write without an unhandled promise', async () => {
        const failure = rejectIpc();
        network.setLobbyStatus('playing');
        await Promise.resolve();
        expect(invoke).toHaveBeenCalledWith('steam:setLobbyData', 'old-lobby', 'status', 'playing');
        expect(console.warn).toHaveBeenCalledWith('⚠️ Failed to set lobby status:', failure);
    });

    it('handles rejected peer closures and lobby leave while resetting local state', async () => {
        const failure = rejectIpc();
        network.isHost = true;
        network.connectedPeers.set('P1', {});
        network.connectedPeers.set('P2', {});
        network.leaveLobby();
        await Promise.resolve();
        // The role this player has is told to the main process as it changes
        // (steam:setP2PPeerPolicy); those calls are apart from the leave itself.
        const isRole = ([channel]) => channel === 'steam:setP2PPeerPolicy';
        expect(invoke.mock.calls.filter((call) => !isRole(call))).toEqual([
            ['steam:closeP2PSession', 'P1'],
            ['steam:closeP2PSession', 'P2'],
            ['steam:leaveLobby'],
        ]);
        expect(invoke.mock.calls.filter(isRole).at(-1)[1]).toEqual({
            isHost: false, hostSteamId: null, hostSuspected: false,
        });
        expect(network.currentLobbyId).toBeNull();
        expect(network.connectedPeers.size).toBe(0);
        expect(network.isHost).toBe(false);
        expect(console.warn).toHaveBeenCalledWith('⚠️ Failed to close P2P session:', failure);
        expect(console.warn).toHaveBeenCalledWith('⚠️ Failed to leave lobby:', failure);
    });
});
