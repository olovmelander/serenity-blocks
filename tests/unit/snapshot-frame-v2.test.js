import { describe, expect, it } from 'vitest';
import {
    MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS,
    MAX_SNAPSHOT_FRAME_BODY_BYTES,
    MAX_SNAPSHOT_FRAME_BYTES,
    SNAPSHOT_FRAME_V2_FIXED_BYTES,
    SnapshotFrameKind,
    decodeSnapshotFrameV2,
    digestHexToUint32,
    digestUint32ToHex,
    encodeSnapshotFrameV2,
    sessionNonceToTag,
} from '../../src/core/network/snapshot-frame-v2.js';

const SESSION_TAG = 0x0123_4567_89ab_cdefn;

function makeBody(kind = SnapshotFrameKind.DELTA, playerCount = 2, length = 44) {
    const body = Uint8Array.from({ length }, (_, index) => index);
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    view.setUint32(0, kind === SnapshotFrameKind.FULL ? 0x5342_4e45 : 0x5342_4e44, false);
    view.setUint8(4, 7);
    view.setUint8(5, playerCount);
    return body;
}

function makeFrame(overrides = {}) {
    const kind = overrides.kind ?? SnapshotFrameKind.DELTA;
    const acknowledgements = overrides.acknowledgements ?? [0x1020_3040, 0xa0b0_c0d0];
    return encodeSnapshotFrameV2({
        kind,
        logicalChannel: overrides.logicalChannel ?? (kind === SnapshotFrameKind.FULL ? 0 : 1),
        seq: 0xfedc_ba98,
        sessionNonceTag: SESSION_TAG,
        roundGeneration: 17,
        migrationEpoch: 4,
        digest: '89ABCDEF',
        acknowledgements,
        body: overrides.body ?? makeBody(kind, acknowledgements.length),
        ...overrides,
    });
}

describe('protocol-v2 raw snapshot framing', () => {
    it.each([
        [SnapshotFrameKind.FULL, 0],
        [SnapshotFrameKind.DELTA, 1],
    ])('round-trips an opaque %s binary-v7 body', (kind, logicalChannel) => {
        const frame = makeFrame({ kind, logicalChannel });
        const decoded = decodeSnapshotFrameV2(frame);

        expect(decoded).toEqual({
            kind,
            logicalChannel,
            seq: 0xfedc_ba98,
            sessionNonceTag: SESSION_TAG,
            roundGeneration: 17,
            migrationEpoch: 4,
            digest: '89abcdef',
            digest32: 0x89ab_cdef,
            acknowledgements: [0x1020_3040, 0xa0b0_c0d0],
            body: makeBody(kind),
        });
    });

    it('keeps a two-player 44-byte delta at or below the 80-byte wire target', () => {
        const frame = makeFrame();

        expect(SNAPSHOT_FRAME_V2_FIXED_BYTES).toBe(28);
        expect(frame.byteLength).toBe(80);
    });

    it('honors byteOffset and byteLength for both the body and input frame', () => {
        const body = makeBody();
        const bodyStorage = new Uint8Array(body.byteLength + 5).fill(99);
        bodyStorage.set(body, 2);
        const frame = makeFrame({
            body: new DataView(bodyStorage.buffer, 2, body.byteLength),
        });
        const frameStorage = new Uint8Array(frame.byteLength + 5).fill(88);
        frameStorage.set(frame, 3);
        const decoded = decodeSnapshotFrameV2(frameStorage.subarray(3, 3 + frame.byteLength));

        expect(decoded.body).toEqual(body);
        frameStorage.fill(0);
        expect(decoded.body).toEqual(body);
    });

    it('pins digest hex conversion and the UTF-8 nonce-tag derivation', () => {
        expect(digestHexToUint32('0000000A')).toBe(10);
        expect(digestUint32ToHex(10)).toBe('a');
        expect(sessionNonceToTag('hello')).toBe(0xa430_d846_80aa_bd0bn);
    });
});

describe('snapshot frame bounds and malformed input rejection', () => {
    it('rejects every truncation of a valid frame', () => {
        const frame = makeFrame();
        for (let length = 0; length < frame.byteLength; length += 1) {
            expect(() => decodeSnapshotFrameV2(frame.subarray(0, length))).toThrow();
        }
    });

    it.each([
        ['wrong magic', 0, 0],
        ['wrong version', 4, 99],
        ['reserved kind zero', 5, 0x01],
        ['reserved kind three', 5, 0xc1],
        ['too many players/ACKs', 5, 0x49],
    ])('rejects %s', (_label, byteOffset, value) => {
        const frame = makeFrame({ acknowledgements: [1] });
        frame[byteOffset] = value;
        expect(() => decodeSnapshotFrameV2(frame)).toThrow();
    });

    it('rejects a declared body length that leaves trailing bytes', () => {
        const frame = makeFrame();
        const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
        view.setUint16(26, 43, true);

        expect(() => decodeSnapshotFrameV2(frame)).toThrow(/trailing bytes/);
    });

    it.each([
        ['full metadata around a delta body', SnapshotFrameKind.FULL, makeBody(SnapshotFrameKind.DELTA)],
        ['delta metadata around a full body', SnapshotFrameKind.DELTA, makeBody(SnapshotFrameKind.FULL)],
    ])('rejects %s', (_label, kind, body) => {
        expect(() => makeFrame({ kind, body })).toThrow(/magic/);
    });

    it.each([
        ['full metadata around a delta body', 0x42],
        ['delta metadata around a full body', 0x92],
    ])('rejects decoded %s', (_label, control) => {
        const frame = control === 0x42
            ? makeFrame()
            : makeFrame({ kind: SnapshotFrameKind.FULL });
        frame[5] = control;

        expect(() => decodeSnapshotFrameV2(frame)).toThrow(/magic/);
    });

    it('rejects crossed kind/channel metadata', () => {
        expect(() => makeFrame({ kind: SnapshotFrameKind.FULL, logicalChannel: 1 }))
            .toThrow(/channel/);
        expect(() => makeFrame({ kind: SnapshotFrameKind.DELTA, logicalChannel: 0 }))
            .toThrow(/channel/);

        const crossedInput = makeFrame();
        crossedInput[5] &= ~0x30;
        expect(() => decodeSnapshotFrameV2(crossedInput)).toThrow(/channel/);
    });

    it('rejects a non-v7 body and a positional ACK/player mismatch', () => {
        const wrongVersion = makeBody();
        wrongVersion[4] = 6;
        expect(() => makeFrame({ body: wrongVersion })).toThrow(/format v7/);
        expect(() => makeFrame({ acknowledgements: [1], body: makeBody() }))
            .toThrow(/does not match player count/);

        const malformedInputs = [makeFrame(), makeFrame(), makeFrame()];
        const bodyOffset = SNAPSHOT_FRAME_V2_FIXED_BYTES + (2 * 4);
        malformedInputs[0][bodyOffset] = 0;
        malformedInputs[1][bodyOffset + 4] = 6;
        malformedInputs[2][bodyOffset + 5] = 1;
        expect(() => decodeSnapshotFrameV2(malformedInputs[0])).toThrow(/magic/);
        expect(() => decodeSnapshotFrameV2(malformedInputs[1])).toThrow(/format v7/);
        expect(() => decodeSnapshotFrameV2(malformedInputs[2])).toThrow(/does not match player count/);
    });

    it('rejects oversized frames before parsing their contents', () => {
        const oversized = new Uint8Array(MAX_SNAPSHOT_FRAME_BYTES + 1);
        expect(() => decodeSnapshotFrameV2(oversized)).toThrow(/exceeds/);

        expect(() => makeFrame({
            acknowledgements: Array(MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS).fill(0),
            body: makeBody(
                SnapshotFrameKind.DELTA,
                MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS,
                MAX_SNAPSHOT_FRAME_BODY_BYTES,
            ),
        })).toThrow(/frame exceeds/);
    });

    it('accepts an exact 64 KiB zero-player frame at the Electron ingress boundary', () => {
        const frame = makeFrame({
            acknowledgements: [],
            body: makeBody(SnapshotFrameKind.DELTA, 0, MAX_SNAPSHOT_FRAME_BODY_BYTES),
        });

        expect(frame.byteLength).toBe(64 * 1024);
        expect(frame.byteLength).toBe(MAX_SNAPSHOT_FRAME_BYTES);
        expect(decodeSnapshotFrameV2(frame).body.byteLength)
            .toBe(MAX_SNAPSHOT_FRAME_BODY_BYTES);
    });

    it('rejects empty and oversized bodies', () => {
        expect(() => makeFrame({ body: new Uint8Array() })).toThrow(/body length/i);
        expect(() => makeFrame({
            body: new Uint8Array(MAX_SNAPSHOT_FRAME_BODY_BYTES + 1),
        })).toThrow(/body length/i);
    });

    it('rejects invalid metadata and acknowledgement bounds', () => {
        const sparseAcknowledgements = [1];
        sparseAcknowledgements.length = 2;

        expect(() => makeFrame({ kind: 'unknown' })).toThrow(/kind/i);
        expect(() => makeFrame({ logicalChannel: 4 })).toThrow(/channel/i);
        expect(() => makeFrame({ seq: 0x1_0000_0000 })).toThrow(/sequence/i);
        expect(() => makeFrame({ sessionNonceTag: 0n })).toThrow(/nonce/i);
        expect(() => makeFrame({ roundGeneration: 0x1_0000 })).toThrow(/generation/i);
        expect(() => makeFrame({ migrationEpoch: -1 })).toThrow(/epoch/i);
        expect(() => makeFrame({ digest: 'not-hex' })).toThrow(/digest/i);
        expect(() => makeFrame({ acknowledgements: [0x1_0000_0000] })).toThrow(/acknowledgement/i);
        expect(() => makeFrame({ acknowledgements: [1, undefined] }))
            .toThrow(/acknowledgement 1/i);
        expect(() => makeFrame({ acknowledgements: sparseAcknowledgements }))
            .toThrow(/acknowledgement 1/i);
        expect(() => makeFrame({
            acknowledgements: Array(MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS + 1).fill(0),
        })).toThrow(/count/i);
    });
});
