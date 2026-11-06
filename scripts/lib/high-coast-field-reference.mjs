import * as THREE from 'three';

// The High Coast field-texture conversion as it was before 2026-10-31, and the
// seeded inputs used to compare it with the current one. The unit suite checks
// that both give identical data; scripts/bench-high-coast-field.mjs times them.

/** A seeded generator, so a failure repeats. */
export function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** High Coast's fieldTextureData as it was before 2026-10-31: the reference the new one must equal. */
export function fieldTextureDataBefore(heights, sky, field) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const range = field.hi - field.lo;
    const toHalf = THREE.DataUtils.toHalfFloat;
    const data = new Uint16Array(size * size * 4);
    const at = (i, j) => heights[Math.max(0, Math.min(size - 1, j)) * size + Math.max(0, Math.min(size - 1, i))];
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const gx = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1)
                - at(i - 1, j - 1) - 2 * at(i - 1, j) - at(i - 1, j + 1)) / (8 * cell);
            const gz = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1)
                - at(i - 1, j - 1) - 2 * at(i, j - 1) - at(i + 1, j - 1)) / (8 * cell);
            const o = (j * size + i) * 4;
            data[o] = toHalf((heights[j * size + i] - field.lo) / range);
            data[o + 1] = toHalf(gx);
            data[o + 2] = toHalf(gz);
            data[o + 3] = toHalf(sky[j * size + i] / 255);
        }
    }
    return data;
}

export function makeField(size, seed) {
    const random = rng(seed);
    const field = {
        name: `t${size}`, size, span: 2500 * (size / 1024) + 1, lo: -70, hi: 270,
    };
    const heights = new Float32Array(size * size);
    const sky = new Uint8Array(size * size);
    for (let k = 0; k < heights.length; k++) {
        heights[k] = -70 + random() * 340 + (random() < 0.01 ? 4000 * (random() - 0.5) : 0); // a few cliffs
        sky[k] = Math.floor(random() * 256);
    }
    return { field, heights, sky };
}
