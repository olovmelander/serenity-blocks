const MAX_P2P_PACKET_BODY_BYTES = 64 * 1024;
const RAW_SNAPSHOT_MAGIC = Uint8Array.of(0x53, 0x42, 0x53, 0x46); // "SBSF"
const utf8Decoder = new TextDecoder('utf-8');

/**
 * Convert renderer IPC payloads to the exact bytes passed to Steam P2P.
 * Protocol v1 sends JSON objects; the protocol-v2 snapshot lane sends byte
 * views. Preserve view offsets so a sliced frame never leaks adjacent bytes.
 *
 * @param {unknown} data
 * @returns {Buffer}
 */
export function encodeP2PPacketBody(data) {
    if (Buffer.isBuffer(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
    }
    if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof data === 'string') {
        return Buffer.from(data, 'utf8');
    }
    return Buffer.from(JSON.stringify(data), 'utf8');
}

/**
 * Classify bytes received from Steam without parsing the protocol-v2 frame.
 * Raw snapshot frames cross IPC as an owned Uint8Array; protocol-v1 JSON keeps
 * its legacy UTF-8 string shape. The core networking layer owns full frame and
 * JSON validation after sender/session admission.
 *
 * @param {ArrayBuffer|ArrayBufferView} data
 * @returns {Uint8Array|string}
 */
export function decodeP2PPacketBody(data) {
    const bytes = toBoundedByteView(data);
    if (!hasRawSnapshotMagic(bytes)) {
        return utf8Decoder.decode(bytes);
    }

    // Copy the exact view. Returning a Buffer (or its pooled backing store)
    // through IPC could expose bytes outside a sliced packet's bounds.
    const frame = new Uint8Array(bytes.byteLength);
    frame.set(bytes);
    return frame;
}

/**
 * @param {ArrayBuffer|ArrayBufferView} data
 * @returns {Uint8Array}
 */
function toBoundedByteView(data) {
    let bytes;
    if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
        throw new TypeError('P2P packet body must be an ArrayBuffer or typed-array view');
    }

    if (bytes.byteLength > MAX_P2P_PACKET_BODY_BYTES) {
        throw new RangeError(`P2P packet body exceeds ${MAX_P2P_PACKET_BODY_BYTES} bytes`);
    }
    return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function hasRawSnapshotMagic(bytes) {
    return bytes.byteLength >= RAW_SNAPSHOT_MAGIC.byteLength
        && RAW_SNAPSHOT_MAGIC.every((byte, index) => bytes[index] === byte);
}
