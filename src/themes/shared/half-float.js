// @ts-check
/**
 * Half floats without three: a float as IEEE binary16 bits, bit for bit what three's
 * DataUtils.toHalfFloat returns (its clamp to ±65504, then its base/shift tables). Bake modules
 * that run in a Worker (shared/bake-worker-host.js) import this instead of three.
 */

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
const _base = new Uint32Array(512);
const _shift = new Uint32Array(512);
for (let i = 0; i < 256; ++i) {
    const e = i - 127;
    if (e < -27) {
        _base[i] = 0x0000;
        _base[i | 0x100] = 0x8000;
        _shift[i] = 24;
        _shift[i | 0x100] = 24;
    } else if (e < -14) {
        _base[i] = 0x0400 >> (-e - 14);
        _base[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
        _shift[i] = -e - 1;
        _shift[i | 0x100] = -e - 1;
    } else if (e <= 15) {
        _base[i] = (e + 15) << 10;
        _base[i | 0x100] = ((e + 15) << 10) | 0x8000;
        _shift[i] = 13;
        _shift[i | 0x100] = 13;
    } else if (e < 128) {
        _base[i] = 0x7c00;
        _base[i | 0x100] = 0xfc00;
        _shift[i] = 24;
        _shift[i | 0x100] = 24;
    } else {
        _base[i] = 0x7c00;
        _base[i | 0x100] = 0xfc00;
        _shift[i] = 13;
        _shift[i | 0x100] = 13;
    }
}

/** A float as IEEE half bits, bit for bit what three's DataUtils.toHalfFloat returns. */
export function toHalfFloat(value) {
    _f32[0] = Math.max(-65504, Math.min(65504, value));
    const f = _u32[0];
    const e = (f >> 23) & 0x1ff;
    return _base[e] + ((f & 0x007fffff) >> _shift[e]);
}
