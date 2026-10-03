import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

let network;
let invoke;

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    invoke = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('window', { electronAPI: { invoke } });
    const { SteamNetworking } = await import('../../src/core/steam/steam-networking.js');
    network = new SteamNetworking();
    network.mockMode = false;
    network.handleP2PPacket = vi.fn();
});

afterEach(() => {
    network?.stopP2PPolling();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Steam P2P polling ownership', () => {
    it('keeps the 16 ms cadence and one pending drain across idempotent starts', async () => {
        const read = deferred();
        invoke.mockReturnValueOnce(read.promise);
        network.startP2PPolling();
        const timer = network.pollInterval;
        network.startP2PPolling();
        expect(network.pollInterval).toBe(timer);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(15);
        expect(invoke).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(invoke).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(64);
        expect(invoke).toHaveBeenCalledOnce();

        read.resolve(null);
        await vi.advanceTimersByTimeAsync(16);
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke).toHaveBeenCalledWith('steam:readP2PPacket');
    });

    it('dispatches packets in transport order within a single drain', async () => {
        const first = { steamId: 'first' };
        const second = { steamId: 'second' };
        invoke.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        expect(network.handleP2PPacket.mock.calls).toEqual([[first, 0], [second, 0]]);
        expect(invoke).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(16);
        expect(invoke).toHaveBeenCalledTimes(4);
    });

    it('ignores a deferred response after stop without issuing another read', async () => {
        const read = deferred();
        invoke.mockReturnValueOnce(read.promise);
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        network.stopP2PPolling();
        network.stopP2PPolling();
        read.resolve({ steamId: 'retired' });
        await vi.advanceTimersByTimeAsync(64);
        expect(network.handleP2PPacket).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledOnce();
        expect(network.pollInterval).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a replacement drain locked when its old response finishes', async () => {
        const oldRead = deferred();
        const replacementRead = deferred();
        invoke.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(replacementRead.promise);
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        network.stopP2PPolling();
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        oldRead.resolve({ steamId: 'retired' });
        await vi.advanceTimersByTimeAsync(64);
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(network.handleP2PPacket).not.toHaveBeenCalled();

        const current = { steamId: 'current' };
        replacementRead.resolve(current);
        await vi.advanceTimersByTimeAsync(0);
        expect(network.handleP2PPacket).toHaveBeenCalledExactlyOnceWith(current, 0);
        expect(invoke).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(1);
    });

    it.each(['stop', 'restart'])('fences the next read when a packet handler requests %s', async (action) => {
        const first = { steamId: 'first' };
        const next = { steamId: 'next' };
        invoke.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
        network.handleP2PPacket.mockImplementationOnce(() => {
            network.stopP2PPolling();
            if (action === 'restart') network.startP2PPolling();
        });
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        expect(invoke).toHaveBeenCalledOnce();
        expect(network.handleP2PPacket).toHaveBeenCalledExactlyOnceWith(first, 0);
        await vi.advanceTimersByTimeAsync(16);
        if (action === 'restart') {
            expect(network.handleP2PPacket.mock.calls).toEqual([[first, 0], [next, 0]]);
            expect(invoke).toHaveBeenCalledTimes(3);
        } else {
            expect(invoke).toHaveBeenCalledOnce();
        }
    });

    it.each(['throw', 'reject', 'handler'])('releases the drain lock after a %s failure', async (failure) => {
        const packet = { steamId: 'recovered' };
        if (failure === 'throw') {
            invoke.mockImplementationOnce(() => { throw new Error('read failed'); });
        } else if (failure === 'reject') {
            invoke.mockRejectedValueOnce(new Error('read failed'));
        } else {
            invoke.mockResolvedValueOnce({ steamId: 'failed handler' });
            network.handleP2PPacket.mockImplementationOnce(() => { throw new Error('handler failed'); });
        }
        invoke.mockResolvedValueOnce(packet);
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        expect(invoke).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(16);
        expect(network.handleP2PPacket).toHaveBeenLastCalledWith(packet, 0);
        expect(invoke).toHaveBeenCalledTimes(3);
    });

    it('retires deferred polling through shutdown as well as explicit stop', async () => {
        const read = deferred();
        invoke.mockReturnValueOnce(read.promise);
        network.leaveLobby = vi.fn();
        network.startP2PPolling();
        await vi.advanceTimersByTimeAsync(16);
        network.shutdown();
        read.resolve({ steamId: 'retired' });
        await vi.advanceTimersByTimeAsync(32);
        expect(network.handleP2PPacket).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledOnce();
        expect(network.pollInterval).toBeNull();
    });
});
