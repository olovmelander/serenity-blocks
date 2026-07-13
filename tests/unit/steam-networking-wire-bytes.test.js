import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

function makeSnapshotEnvelope({ delta = true } = {}) {
    return {
        envelopeVersion: 1,
        msgType: MessageTypes.GAME_STATE_FULL,
        matchId: 'wire-metric-match',
        matchNonce: 'wire-metric-nonce',
        hostSteamId: 'HOST',
        channel: delta ? 1 : 0,
        seq: 7,
        tick: 42,
        sentAt: 1_000,
        protocolVersion: '1.0.0',
        payload: {
            _binary: true,
            _delta: delta,
            _data: 'AAECAwQ=',
            _acks: { HOST: 6, PEER: 5 },
            _encodedSize: 44,
        },
    };
}

describe('Steam snapshot wire-byte telemetry', () => {
    it('records the exact successful Electron packet size without serializing again', async () => {
        vi.resetModules();
        const invoke = vi.fn().mockResolvedValue({ sent: true, wireBytes: 490 });
        vi.stubGlobal('window', {
            electronAPI: { invoke },
            location: { search: '' },
        });
        const { SteamNetworking } = await import('../../src/core/steam/steam-networking.js');
        const network = new SteamNetworking();
        network.mockMode = false;
        const envelope = makeSnapshotEnvelope();

        network._deliverEnvelopeNow('PEER', MessageTypes.GAME_STATE_FULL, envelope, {
            channel: 1,
            delivery: 'unreliable_no_delay',
        });

        await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(network.getPacketStats().sent).toBe(1));
        expect(invoke.mock.calls[0][2]).toBe(envelope);
        expect(network.getPacketStats()).toMatchObject({
            snapshotBytesSent: { count: 1, p95: 490 },
            snapshotWireBytesSent: { count: 1, p95: 490 },
            snapshotDeltaWireBytesSent: { count: 1, p95: 490 },
            snapshotKeyframeWireBytesSent: { count: 0, p95: 0 },
            snapshotPayloadBytesSent: { count: 1, p95: 44 },
        });
    });

    it('passes protocol-v2 frame bytes directly to Electron and records physical size', async () => {
        vi.resetModules();
        const invoke = vi.fn().mockResolvedValue({ sent: true, wireBytes: 80 });
        vi.stubGlobal('window', {
            electronAPI: { invoke },
            location: { search: '' },
        });
        const { SteamNetworking } = await import('../../src/core/steam/steam-networking.js');
        const network = new SteamNetworking();
        network.mockMode = false;
        const rawFrame = new Uint8Array(80).fill(7);

        network._deliverRawSnapshotNow('PEER', MessageTypes.GAME_STATE_FULL, rawFrame, {
            channel: 1,
            delivery: 'unreliable_no_delay',
            snapshotKind: 'delta',
            snapshotPayloadBytes: 44,
        });

        await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(network.getPacketStats().sent).toBe(1));
        expect(invoke.mock.calls[0][2]).toBe(rawFrame);
        expect(network.getPacketStats()).toMatchObject({
            snapshotBytesSent: { count: 1, p95: 80 },
            snapshotDeltaWireBytesSent: { count: 1, p95: 80 },
            snapshotPayloadBytesSent: { count: 1, p95: 44 },
        });
    });
});
