import { describe, expect, it } from 'vitest';
import {
    decodeP2PPacketBody,
    encodeP2PPacketBody,
} from '../../electron/p2p-packet-codec.js';
import {
    SnapshotFrameKind,
    decodeSnapshotFrameV2,
    encodeSnapshotFrameV2,
} from '../../src/core/network/snapshot-frame-v2.js';

describe('Steam P2P packet body encoding', () => {
    it('preserves the legacy JSON packet body', () => {
        const payload = { msgType: 'net:ping', seq: 7, payload: { at: 42 } };
        expect(encodeP2PPacketBody(payload).toString('utf8')).toBe(JSON.stringify(payload));
    });

    it('passes a pre-serialized UTF-8 body through unchanged', () => {
        const payload = '{"msgType":"net:ping","label":"räv"}';
        expect(encodeP2PPacketBody(payload)).toEqual(Buffer.from(payload, 'utf8'));
    });

    it('preserves typed-array byteOffset and byteLength', () => {
        const storage = Uint8Array.from([99, 98, 1, 2, 3, 4, 97]);
        const frame = storage.subarray(2, 6);
        expect([...encodeP2PPacketBody(frame)]).toEqual([1, 2, 3, 4]);
    });

    it('preserves sliced Buffer bounds', () => {
        const storage = Buffer.from([99, 98, 5, 6, 7, 97]);
        const frame = storage.subarray(2, 5);
        expect([...encodeP2PPacketBody(frame)]).toEqual([5, 6, 7]);
    });
});

describe('Steam P2P packet body decoding', () => {
    it('preserves the protocol-v1 UTF-8 string contract', () => {
        const payload = '{"msgType":"net:ping","label":"räv"}';

        expect(decodeP2PPacketBody(Buffer.from(payload, 'utf8'))).toBe(payload);
    });

    it('classifies a valid SBSF frame as exact owned bytes across sliced Buffer storage', () => {
        const body = new Uint8Array(44);
        const bodyView = new DataView(body.buffer);
        bodyView.setUint32(0, 0x5342_4e44, false); // "SBND"
        bodyView.setUint8(4, 7);
        bodyView.setUint8(5, 2);
        const frame = encodeSnapshotFrameV2({
            kind: SnapshotFrameKind.DELTA,
            logicalChannel: 1,
            seq: 19,
            sessionNonceTag: 0x0123_4567_89ab_cdefn,
            roundGeneration: 3,
            migrationEpoch: 1,
            digest: 'abc123',
            acknowledgements: [7, 11],
            body,
        });
        const storage = Buffer.alloc(frame.byteLength + 6, 0xee);
        Buffer.from(frame).copy(storage, 3);
        const packetSlice = storage.subarray(3, 3 + frame.byteLength);

        const decodedBody = decodeP2PPacketBody(packetSlice);

        expect(decodedBody).toBeInstanceOf(Uint8Array);
        expect(Buffer.isBuffer(decodedBody)).toBe(false);
        expect([...decodedBody]).toEqual([...frame]);
        storage.fill(0);
        expect(decodeSnapshotFrameV2(/** @type {Uint8Array} */ (decodedBody))).toMatchObject({
            kind: SnapshotFrameKind.DELTA,
            logicalChannel: 1,
            seq: 19,
            acknowledgements: [7, 11],
            body,
        });
    });

    it('honors typed-view byteOffset when classifying raw packets', () => {
        const storage = Uint8Array.from([0xff, 0x53, 0x42, 0x53, 0x46, 2, 0xee]);
        const packet = new DataView(storage.buffer, 1, 5);

        expect(decodeP2PPacketBody(packet)).toEqual(Uint8Array.from([
            0x53, 0x42, 0x53, 0x46, 2,
        ]));
    });

    it('rejects an oversized body before decoding or classifying it', () => {
        expect(() => decodeP2PPacketBody(new Uint8Array((64 * 1024) + 1)))
            .toThrow(/exceeds 65536 bytes/);
    });
});
