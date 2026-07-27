// @ts-nocheck
/**
 * P0-6 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18 §2.4) — chunked base64.
 *
 * The host base64-wraps every snapshot inside the frame callback on the default (protocol-v1)
 * wire. The old encoder appended one char per byte (O(n) string growth per broadcast). The
 * chunked version must produce BYTE-IDENTICAL output to the naive per-byte reference across
 * empty, sub-chunk, exact-chunk-boundary, and multi-chunk sizes.
 */
import { describe, it, expect } from 'vitest';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

// The encoder uses no instance state — invoke the prototype method against a bare object so we
// don't run the (side-effectful) constructor.
const encode = (buffer) => SteamNetworking.prototype._arrayBufferToBase64.call(null, buffer);

/** The original one-char-per-byte implementation, kept here as the equivalence oracle. */
function naiveBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function buildBytes(n) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff; // deterministic spread across 0..255
    return bytes.buffer;
}

describe('_arrayBufferToBase64 chunked encoding (P0-6 §2.4)', () => {
    // 0x8000 is the chunk size; test the boundaries around it plus a large multi-chunk buffer.
    for (const size of [0, 1, 2, 255, 256, 0x8000 - 1, 0x8000, 0x8000 + 1, 100000]) {
        it(`matches the naive per-byte encoding for ${size} bytes`, () => {
            const buffer = buildBytes(size);
            expect(encode(buffer)).toBe(naiveBase64(buffer));
        });
    }

    it('round-trips back to the original bytes via atob', () => {
        const buffer = buildBytes(5000);
        const b64 = encode(buffer);
        const decoded = atob(b64);
        const out = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
        expect(Array.from(out)).toEqual(Array.from(new Uint8Array(buffer)));
    });
});
