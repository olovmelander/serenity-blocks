// @ts-check

/**
 * Protocol-v2 raw snapshot frame.
 *
 * The existing binary-v7 full/delta snapshot remains an opaque body. This
 * outer frame replaces the protocol-v1 JSON/base64 envelope for snapshots:
 *
 *   0..3   magic "SBSF"                    uint32, big endian
 *   4      frame version (2)               uint8
 *   5      kind/channel/ack-count control  uint8
 *   6..9   logical packet sequence         uint32, little endian
 *   10..17 session nonce tag               uint64, little endian
 *   18..19 round generation                uint16, little endian
 *   20..21 migration epoch                 uint16, little endian
 *   22..25 state digest                    uint32, little endian
 *   26..27 opaque body byte length         uint16, little endian
 *   28..   positional input ACKs            ackCount * uint32, little endian
 *           opaque binary-v7 body           bodyLength bytes
 *
 * Control byte: bits 7..6 are the kind code (01 full, 10 delta), bits 5..4
 * are the logical channel (0..3), and bits 3..0 are the ACK/player count.
 * ACKs use the exact player order in the packed snapshot body. That order is
 * already load-bearing for the binary-v7 delta codec, and avoids repeating a
 * player identifier in every 30 Hz frame.
 */

export const SNAPSHOT_FRAME_V2_MAGIC = 0x5342_5346; // "SBSF"
export const SNAPSHOT_FRAME_V2_VERSION = 2;
export const SNAPSHOT_FRAME_V2_FIXED_BYTES = 28;
export const MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS = 8;
export const MAX_SNAPSHOT_FRAME_BYTES = 64 * 1024;
export const MAX_SNAPSHOT_FRAME_BODY_BYTES = MAX_SNAPSHOT_FRAME_BYTES
    - SNAPSHOT_FRAME_V2_FIXED_BYTES;

export const SnapshotFrameKind = Object.freeze({
    FULL: 'full',
    DELTA: 'delta',
});

const FULL_KIND_CODE = 1;
const DELTA_KIND_CODE = 2;
const KIND_SHIFT = 6;
const KIND_MASK = 0xc0;
const CHANNEL_SHIFT = 4;
const CHANNEL_MASK = 0x30;
const ACK_COUNT_MASK = 0x0f;
const MAX_LOGICAL_CHANNEL = 3;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffff_ffff;
const MAX_UINT64 = 0xffff_ffff_ffff_ffffn;
const BINARY_V7_FULL_MAGIC = 0x5342_4e45; // "SBNE"
const BINARY_V7_DELTA_MAGIC = 0x5342_4e44; // "SBND"
const BINARY_V7_FORMAT_VERSION = 7;
const BINARY_V7_PREFIX_BYTES = 6;
const FNV64_OFFSET_BASIS = 0xcbf2_9ce4_8422_2325n;
const FNV64_PRIME = 0x0000_0100_0000_01b3n;

/** @typedef {'full'|'delta'} SnapshotFrameKindValue */

/**
 * @typedef {object} SnapshotFrameV2Input
 * @property {SnapshotFrameKindValue} kind
 * @property {number} logicalChannel
 * @property {number} seq
 * @property {bigint} sessionNonceTag
 * @property {number} roundGeneration
 * @property {number} migrationEpoch
 * @property {string} digest
 * @property {number[]} acknowledgements
 * @property {ArrayBuffer|ArrayBufferView} body
 */

/**
 * @typedef {object} DecodedSnapshotFrameV2
 * @property {SnapshotFrameKindValue} kind
 * @property {number} logicalChannel
 * @property {number} seq
 * @property {bigint} sessionNonceTag
 * @property {number} roundGeneration
 * @property {number} migrationEpoch
 * @property {string} digest
 * @property {number} digest32
 * @property {number[]} acknowledgements
 * @property {Uint8Array} body
 */

/**
 * Convert the live, unpadded DJB2 hex digest to its stable wire uint32.
 * The wire value is numeric, so leading zeroes and hex letter case are not
 * preserved; decode returns lower-case, unpadded hex to match the producer.
 *
 * @param {string} digest
 * @returns {number}
 */
export function digestHexToUint32(digest) {
    if (typeof digest !== 'string' || !/^[0-9a-fA-F]{1,8}$/.test(digest)) {
        throw new TypeError('Snapshot digest must be 1-8 hexadecimal characters');
    }
    return Number.parseInt(digest, 16) >>> 0;
}

/**
 * @param {number} digest
 * @returns {string}
 */
export function digestUint32ToHex(digest) {
    assertUint(digest, MAX_UINT32, 'Snapshot digest');
    return digest.toString(16);
}

/**
 * Derive the non-cryptographic 64-bit stale-session fence carried per frame.
 * FNV-1a over UTF-8 is deterministic across platforms. This tag is not peer
 * authentication; Steam transport identity remains the trust boundary.
 *
 * @param {string} sessionNonce
 * @returns {bigint}
 */
export function sessionNonceToTag(sessionNonce) {
    if (typeof sessionNonce !== 'string' || sessionNonce.length === 0) {
        throw new TypeError('Session nonce must be a non-empty string');
    }

    let hash = FNV64_OFFSET_BASIS;
    const bytes = new TextEncoder().encode(sessionNonce);
    for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = (hash * FNV64_PRIME) & MAX_UINT64;
    }
    return hash;
}

/**
 * Frame an opaque binary-v7 full or delta snapshot body.
 *
 * @param {SnapshotFrameV2Input} input
 * @returns {Uint8Array}
 */
export function encodeSnapshotFrameV2(input) {
    if (!input || typeof input !== 'object') {
        throw new TypeError('Snapshot frame input is required');
    }

    const kindCode = encodeKind(input.kind);
    const logicalChannel = assertUint(input.logicalChannel, MAX_LOGICAL_CHANNEL, 'Logical channel');
    assertKindChannel(input.kind, logicalChannel);
    const seq = assertUint(input.seq, MAX_UINT32, 'Snapshot sequence');
    const roundGeneration = assertUint(input.roundGeneration, MAX_UINT16, 'Round generation');
    const migrationEpoch = assertUint(input.migrationEpoch, MAX_UINT16, 'Migration epoch');
    const digest32 = digestHexToUint32(input.digest);
    const sessionNonceTag = assertSessionNonceTag(input.sessionNonceTag);
    const { acknowledgements } = input;
    if (!Array.isArray(acknowledgements)) {
        throw new TypeError('Snapshot acknowledgements must be an array');
    }
    if (acknowledgements.length > MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS) {
        throw new RangeError(
            `Snapshot acknowledgement count exceeds ${MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS}`,
        );
    }
    for (let index = 0; index < acknowledgements.length; index += 1) {
        if (!Object.hasOwn(acknowledgements, index)) {
            throw new TypeError(`Snapshot acknowledgement ${index} is required`);
        }
        assertUint(
            acknowledgements[index],
            MAX_UINT32,
            `Snapshot acknowledgement ${index}`,
        );
    }

    const body = toByteView(input.body, 'Snapshot body');
    if (body.byteLength === 0 || body.byteLength > MAX_SNAPSHOT_FRAME_BODY_BYTES) {
        throw new RangeError(
            `Snapshot body length must be between 1 and ${MAX_SNAPSHOT_FRAME_BODY_BYTES} bytes`,
        );
    }
    assertBinaryV7Body(body, input.kind, acknowledgements.length);

    const headerBytes = SNAPSHOT_FRAME_V2_FIXED_BYTES + (acknowledgements.length * 4);
    if (headerBytes + body.byteLength > MAX_SNAPSHOT_FRAME_BYTES) {
        throw new RangeError(`Snapshot frame exceeds ${MAX_SNAPSHOT_FRAME_BYTES} bytes`);
    }
    const frame = new Uint8Array(headerBytes + body.byteLength);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const control = (kindCode << KIND_SHIFT)
        | (logicalChannel << CHANNEL_SHIFT)
        | acknowledgements.length;

    view.setUint32(0, SNAPSHOT_FRAME_V2_MAGIC, false);
    view.setUint8(4, SNAPSHOT_FRAME_V2_VERSION);
    view.setUint8(5, control);
    view.setUint32(6, seq, true);
    view.setBigUint64(10, sessionNonceTag, true);
    view.setUint16(18, roundGeneration, true);
    view.setUint16(20, migrationEpoch, true);
    view.setUint32(22, digest32, true);
    view.setUint16(26, body.byteLength, true);

    let offset = SNAPSHOT_FRAME_V2_FIXED_BYTES;
    for (const acknowledgement of acknowledgements) {
        view.setUint32(offset, acknowledgement, true);
        offset += 4;
    }
    frame.set(body, offset);
    return frame;
}

/**
 * Parse a protocol-v2 snapshot frame without inspecting its binary-v7 body.
 * The returned body is an exact copy, isolated from the untrusted input view.
 *
 * @param {ArrayBuffer|ArrayBufferView} input
 * @returns {DecodedSnapshotFrameV2}
 */
export function decodeSnapshotFrameV2(input) {
    const bytes = toByteView(input, 'Snapshot frame');
    if (bytes.byteLength > MAX_SNAPSHOT_FRAME_BYTES) {
        throw new RangeError(`Snapshot frame exceeds ${MAX_SNAPSHOT_FRAME_BYTES} bytes`);
    }
    if (bytes.byteLength < SNAPSHOT_FRAME_V2_FIXED_BYTES + 1) {
        throw new RangeError('Snapshot frame is truncated');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, false) !== SNAPSHOT_FRAME_V2_MAGIC) {
        throw new Error('Snapshot frame has invalid magic');
    }
    if (view.getUint8(4) !== SNAPSHOT_FRAME_V2_VERSION) {
        throw new Error('Snapshot frame has unsupported version');
    }

    const control = view.getUint8(5);
    const kind = decodeKind((control & KIND_MASK) >>> KIND_SHIFT);
    const logicalChannel = (control & CHANNEL_MASK) >>> CHANNEL_SHIFT;
    assertKindChannel(kind, logicalChannel);
    const acknowledgementCount = control & ACK_COUNT_MASK;
    if (acknowledgementCount > MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS) {
        throw new RangeError(
            `Snapshot acknowledgement count exceeds ${MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS}`,
        );
    }

    const headerBytes = SNAPSHOT_FRAME_V2_FIXED_BYTES + (acknowledgementCount * 4);
    if (bytes.byteLength < headerBytes + 1) {
        throw new RangeError('Snapshot frame acknowledgement table is truncated');
    }

    const bodyLength = view.getUint16(26, true);
    if (bodyLength === 0 || bodyLength > MAX_SNAPSHOT_FRAME_BODY_BYTES) {
        throw new RangeError('Snapshot frame has invalid body length');
    }
    const expectedFrameBytes = headerBytes + bodyLength;
    if (bytes.byteLength !== expectedFrameBytes) {
        const reason = bytes.byteLength < expectedFrameBytes ? 'truncated' : 'has trailing bytes';
        throw new RangeError(`Snapshot frame ${reason}`);
    }

    const sessionNonceTag = view.getBigUint64(10, true);
    if (sessionNonceTag === 0n) {
        throw new RangeError('Snapshot frame session nonce tag must be non-zero');
    }

    /** @type {number[]} */
    const acknowledgements = [];
    let offset = SNAPSHOT_FRAME_V2_FIXED_BYTES;
    for (let index = 0; index < acknowledgementCount; index += 1) {
        acknowledgements.push(view.getUint32(offset, true));
        offset += 4;
    }

    const digest32 = view.getUint32(22, true);
    const body = new Uint8Array(bodyLength);
    body.set(bytes.subarray(offset, offset + bodyLength));
    assertBinaryV7Body(body, kind, acknowledgementCount);

    return {
        kind,
        logicalChannel,
        seq: view.getUint32(6, true),
        sessionNonceTag,
        roundGeneration: view.getUint16(18, true),
        migrationEpoch: view.getUint16(20, true),
        digest: digestUint32ToHex(digest32),
        digest32,
        acknowledgements,
        body,
    };
}

/**
 * @param {SnapshotFrameKindValue} kind
 * @returns {number}
 */
function encodeKind(kind) {
    if (kind === SnapshotFrameKind.FULL) return FULL_KIND_CODE;
    if (kind === SnapshotFrameKind.DELTA) return DELTA_KIND_CODE;
    throw new TypeError(`Unsupported snapshot frame kind: ${String(kind)}`);
}

/**
 * @param {number} kindCode
 * @returns {SnapshotFrameKindValue}
 */
function decodeKind(kindCode) {
    if (kindCode === FULL_KIND_CODE) return SnapshotFrameKind.FULL;
    if (kindCode === DELTA_KIND_CODE) return SnapshotFrameKind.DELTA;
    throw new Error(`Snapshot frame has invalid kind code ${kindCode}`);
}

/**
 * Protocol v2 has exactly two snapshot lanes: reliable keyframes on channel 0
 * and low-latency deltas on channel 1. Rejecting crossed metadata keeps replay
 * sequence tracking and delivery semantics unambiguous.
 *
 * @param {SnapshotFrameKindValue} kind
 * @param {number} logicalChannel
 */
function assertKindChannel(kind, logicalChannel) {
    const expectedChannel = kind === SnapshotFrameKind.FULL ? 0 : 1;
    if (logicalChannel !== expectedChannel) {
        throw new Error(`Snapshot ${kind} frames require logical channel ${expectedChannel}`);
    }
}

/**
 * Inspect only the stable binary-v7 prefix. The payload remains opaque to this
 * framing layer, but kind, exact body format, and positional ACK cardinality
 * must agree before ingress can use the metadata.
 *
 * @param {Uint8Array} body
 * @param {SnapshotFrameKindValue} kind
 * @param {number} acknowledgementCount
 */
function assertBinaryV7Body(body, kind, acknowledgementCount) {
    if (body.byteLength < BINARY_V7_PREFIX_BYTES) {
        throw new RangeError('Snapshot binary-v7 body is truncated');
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const expectedMagic = kind === SnapshotFrameKind.FULL
        ? BINARY_V7_FULL_MAGIC
        : BINARY_V7_DELTA_MAGIC;
    if (view.getUint32(0, false) !== expectedMagic) {
        throw new Error(`Snapshot ${kind} frame has mismatched binary-v7 magic`);
    }
    if (view.getUint8(4) !== BINARY_V7_FORMAT_VERSION) {
        throw new Error(`Snapshot frame requires binary format v${BINARY_V7_FORMAT_VERSION}`);
    }
    const playerCount = view.getUint8(5);
    if (playerCount > MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS) {
        throw new RangeError(
            `Snapshot binary-v7 player count exceeds ${MAX_SNAPSHOT_FRAME_ACKNOWLEDGEMENTS}`,
        );
    }
    if (playerCount !== acknowledgementCount) {
        throw new Error(
            `Snapshot acknowledgement count ${acknowledgementCount} does not match player count ${playerCount}`,
        );
    }
}

/**
 * @param {number} value
 * @param {number} maximum
 * @param {string} label
 * @returns {number}
 */
function assertUint(value, maximum, label) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
        throw new RangeError(`${label} must be an integer between 0 and ${maximum}`);
    }
    return value;
}

/**
 * @param {bigint} value
 * @returns {bigint}
 */
function assertSessionNonceTag(value) {
    if (typeof value !== 'bigint' || value <= 0n || value > MAX_UINT64) {
        throw new RangeError('Session nonce tag must be a non-zero uint64');
    }
    return value;
}

/**
 * @param {ArrayBuffer|ArrayBufferView} value
 * @param {string} label
 * @returns {Uint8Array}
 */
function toByteView(value, label) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError(`${label} must be an ArrayBuffer or typed-array view`);
}
