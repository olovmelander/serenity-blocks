import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    NetworkImpairmentHarness,
    normalizeNetworkImpairmentConfig,
} from '../../src/core/network/network-impairment.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

function makeMockNetwork({ isHost = true } = {}) {
    const network = new SteamNetworking();
    network.mockMode = true;
    network.steamId = isHost ? 'HOST' : 'PEER';
    network.isHost = isHost;
    network.hostSteamId = 'HOST';
    network.matchId = 'match-1';
    network.matchNonce = 'nonce-1';
    network.broadcastChannel = {
        postMessage: vi.fn(),
        close: vi.fn(),
    };
    network.lockProtocolSession();
    network.connectedPeers.set('PEER', { steamId: 'PEER' });
    network.seedNegotiatedProtocolPeers(['PEER']);
    return network;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('NetworkImpairmentHarness', () => {
    it('normalizes DevTools-friendly aliases and delay ranges', () => {
        const config = normalizeNetworkImpairmentConfig({
            enabled: '1',
            loss: '5',
            dupPct: '2',
            delay: '50-150',
            reliableDelayMs: '25',
        });

        expect(config.enabled).toBe(true);
        expect(config.lossPct).toBe(5);
        expect(config.duplicatePct).toBe(2);
        expect(config.minDelayMs).toBe(50);
        expect(config.maxDelayMs).toBe(150);
        expect(config.reliableDelayMs).toBe(25);
    });

    it('drops unreliable packets without dropping reliable packets unless reliable loss is explicit', () => {
        const harness = new NetworkImpairmentHarness({ enabled: true, lossPct: 100, seed: 123 });

        expect(harness.planDelivery({ delivery: 'unreliable_no_delay', channel: 1 }).drop).toBe(true);
        expect(harness.planDelivery({ delivery: 'reliable', channel: 0 }).drop).toBe(false);

        const stats = harness.getStats();
        expect(stats.dropped).toBe(1);
        expect(stats.delivered).toBe(1);
    });
});

describe('SteamNetworking network impairment integration', () => {
    it('applies unreliable loss but still delivers reliable messages by default', () => {
        const network = makeMockNetwork();
        network.setNetworkImpairment({ enabled: true, lossPct: 100, seed: 1 });

        network.sendUnreliableNoDelay('PEER', MessageTypes.GAME_STATE_FULL, { tick: 1 });
        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();

        network.sendP2PMessage('PEER', MessageTypes.NET_PONG, { at: 1 });
        expect(network.broadcastChannel.postMessage).toHaveBeenCalledTimes(1);
        expect(network.broadcastChannel.postMessage.mock.calls[0][0]).toMatchObject({
            msgType: MessageTypes.NET_PONG,
            from: 'HOST',
            to: 'PEER',
        });

        const stats = network.getPacketStats().netImpairment;
        expect(stats.dropped).toBe(1);
        expect(stats.delivered).toBe(1);
    });

    it('can delay reliable packets deterministically', () => {
        vi.useFakeTimers();
        const network = makeMockNetwork();
        network.setNetworkImpairment({
            enabled: true,
            minDelayMs: 10,
            maxDelayMs: 10,
            reliableDelayMs: 20,
            seed: 2,
        });

        network.sendP2PMessage('PEER', MessageTypes.NET_PONG, { at: 1 });
        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(29);
        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(network.broadcastChannel.postMessage).toHaveBeenCalledTimes(1);

        const stats = network.getPacketStats().netImpairment;
        expect(stats.reliableDelayed).toBe(1);
        expect(stats.delayed).toBe(1);
    });

    it('can reorder and duplicate packets while preserving the original envelope sequence', () => {
        vi.useFakeTimers();
        const network = makeMockNetwork({ isHost: false });
        network.setNetworkImpairment({
            enabled: true,
            duplicatePct: 100,
            duplicateDelayMs: 5,
            reorderPct: 100,
            reorderDelayMs: 50,
            seed: 3,
        });

        network.sendUnreliableNoDelay('HOST', MessageTypes.GAME_INPUT_BATCH, { inputs: [] });
        vi.advanceTimersByTime(49);
        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(network.broadcastChannel.postMessage).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5);
        expect(network.broadcastChannel.postMessage).toHaveBeenCalledTimes(2);
        const first = network.broadcastChannel.postMessage.mock.calls[0][0];
        const second = network.broadcastChannel.postMessage.mock.calls[1][0];
        expect(second.seq).toBe(first.seq);
        expect(second.msgType).toBe(first.msgType);

        const stats = network.getPacketStats().netImpairment;
        expect(stats.duplicated).toBe(1);
        expect(stats.reordered).toBe(1);
        expect(stats.delayed).toBe(2);
    });

    it('routes mock broadcasts through the same impairment wrapper', () => {
        const network = makeMockNetwork();
        network.setNetworkImpairment({ enabled: true, reliableLossPct: 100, seed: 4 });

        network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, { roundGeneration: 2 });

        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();
        expect(network.getPacketStats().netImpairment.dropped).toBe(1);
    });
});
