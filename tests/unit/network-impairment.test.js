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
        vi.useFakeTimers();
        const network = makeMockNetwork();
        network.setNetworkImpairment({ enabled: true, lossPct: 100, seed: 1 });

        network.sendUnreliableNoDelay('PEER', MessageTypes.GAME_STATE_FULL, { tick: 1 });
        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();

        // Every datagram is lost, so the reliable message arrives after its resends.
        network.sendP2PMessage('PEER', MessageTypes.NET_PONG, { at: 1 });
        vi.advanceTimersByTime(150);
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

    it('keeps reliable messages in order and whole under jitter, reorder and duplication', () => {
        vi.useFakeTimers();
        const network = makeMockNetwork();
        network.setNetworkImpairment({
            enabled: true,
            minDelayMs: 0,
            maxDelayMs: 120,
            reorderPct: 50,
            duplicatePct: 50,
            lossPct: 20,
            seed: 7,
        });

        for (let at = 1; at <= 40; at += 1) {
            network.sendP2PMessage('PEER', MessageTypes.NET_PONG, { at });
        }
        vi.advanceTimersByTime(2000);

        const arrived = network.broadcastChannel.postMessage.mock.calls.map(([message]) => message.payload.at);
        expect(arrived).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
        const stats = network.getPacketStats().netImpairment;
        expect(stats.duplicated).toBe(0);
        expect(stats.reordered).toBe(0);
        expect(stats.reliableResent).toBeGreaterThan(0);
    });

    it('makes a lost reliable datagram cost a resend that later messages wait behind', () => {
        vi.useFakeTimers();
        const harness = new NetworkImpairmentHarness({
            enabled: true, minDelayMs: 20, maxDelayMs: 20, lossPct: 100, seed: 9,
        });

        // Three resends of one round trip (2 × 20 ms, at least 50 ms) on top of the trip.
        const first = harness.planDelivery({ delivery: 'reliable', target: 'PEER', nowMs: 1000 });
        expect(first.deliveries).toEqual([{ delayMs: 20 + 3 * 50, duplicateIndex: 0 }]);

        harness.setConfig({ enabled: true, minDelayMs: 20, maxDelayMs: 20, seed: 9 });
        const lost = harness.planDelivery({ delivery: 'reliable', target: 'PEER', nowMs: 1000 });
        expect(lost.deliveries[0].delayMs).toBe(20);
        harness.config.lossPct = 0;
        harness._reliableTailAt.set('PEER', 1200);
        const behind = harness.planDelivery({ delivery: 'reliable', target: 'PEER', nowMs: 1010 });
        expect(behind.deliveries[0].delayMs).toBe(190);
        const otherTarget = harness.planDelivery({ delivery: 'reliable', target: 'OTHER', nowMs: 1010 });
        expect(otherTarget.deliveries[0].delayMs).toBe(20);
        expect(harness.getStats().reliableQueued).toBe(1);
    });

    it('keeps a broadcast in order with the direct messages around it', () => {
        const harness = new NetworkImpairmentHarness({
            enabled: true, minDelayMs: 0, maxDelayMs: 0, seed: 13,
        });
        harness._reliableTailAt.set('PEER', 1300);
        const broadcast = harness.planDelivery({ delivery: 'reliable', target: 'all', nowMs: 1000 });
        expect(broadcast.deliveries[0].delayMs).toBe(300);
        const direct = harness.planDelivery({ delivery: 'reliable', target: 'OTHER', nowMs: 1000 });
        expect(direct.deliveries[0].delayMs).toBe(300);
    });

    it('still reorders and duplicates reliable messages in the opt-in chaos mode', () => {
        const harness = new NetworkImpairmentHarness({
            enabled: true, reliableChaos: true, reorderPct: 100, duplicatePct: 100, seed: 11,
        });
        const plan = harness.planDelivery({ delivery: 'reliable', target: 'PEER', nowMs: 0 });
        expect(plan.deliveries).toHaveLength(2);
        expect(harness.getStats().reordered).toBe(1);
    });

    it('routes mock broadcasts through the same impairment wrapper', () => {
        const network = makeMockNetwork();
        network.setNetworkImpairment({ enabled: true, reliableLossPct: 100, seed: 4 });

        network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, { roundGeneration: 2 });

        expect(network.broadcastChannel.postMessage).not.toHaveBeenCalled();
        expect(network.getPacketStats().netImpairment.dropped).toBe(1);
    });
});
