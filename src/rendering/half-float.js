// @ts-check
/**
 * three's float32 -> float16 conversion (`DataUtils.toHalfFloat`), bit for bit, for bakes that
 * convert millions of values.
 *
 * three's function clamps to ±65504 and looks the bits up in two tables, which is cheap, but each
 * call also tests the range for a warning and reads its tables through a module object: High Coast's
 * field textures (4.2 million values per 1024² field) spent 61-70 ms per field in it, a whole timer
 * task each, the worst frames of its first visit (2026-10-31). `halfBits` is the same clamp, the
 * same tables (copied from three's `_generateTables`) and the same arithmetic, so its output is
 * identical (tests/unit/half-float.test.js checks it against the installed three); it only skips
 * the out-of-range warning. Note three truncates the mantissa (rounds toward zero): this is not
 * IEEE round-to-nearest, and must not be swapped for Float16Array if the bits are to stay the same.
 */

const BASE = new Uint32Array(512);
const SHIFT = new Uint32Array(512);
for (let i = 0; i < 256; ++i) {
    const e = i - 127;
    if (e < -27) { // very small number (0, -0)
        BASE[i] = 0x0000;
        BASE[i | 0x100] = 0x8000;
        SHIFT[i] = 24;
        SHIFT[i | 0x100] = 24;
    } else if (e < -14) { // small number (denorm)
        BASE[i] = 0x0400 >> (-e - 14);
        BASE[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
        SHIFT[i] = -e - 1;
        SHIFT[i | 0x100] = -e - 1;
    } else if (e <= 15) { // normal number
        BASE[i] = (e + 15) << 10;
        BASE[i | 0x100] = ((e + 15) << 10) | 0x8000;
        SHIFT[i] = 13;
        SHIFT[i | 0x100] = 13;
    } else if (e < 128) { // large number (Infinity, -Infinity)
        BASE[i] = 0x7c00;
        BASE[i | 0x100] = 0xfc00;
        SHIFT[i] = 24;
        SHIFT[i | 0x100] = 24;
    } else { // stay (NaN, Infinity, -Infinity)
        BASE[i] = 0x7c00;
        BASE[i | 0x100] = 0xfc00;
        SHIFT[i] = 13;
        SHIFT[i | 0x100] = 13;
    }
}

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/**
 * The float16 bits three's `DataUtils.toHalfFloat(value)` returns, without its range warning.
 * @param {number} value
 * @returns {number}
 */
export function halfBits(value) {
    // three's clamp, in its form: Math.min/Math.max hand back a NaN with the sign bit set, and that
    // sign reaches the half (0xfe00, not 0x7e00).
    F32[0] = Math.max(-65504, Math.min(65504, value));
    const f = U32[0];
    const e = (f >> 23) & 0x1ff;
    return BASE[e] + ((f & 0x007fffff) >> SHIFT[e]);
}
