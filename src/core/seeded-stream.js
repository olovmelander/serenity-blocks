// @ts-check

/**
 * Small seeded streams for authoring choices (a road's stops, a charm draft), never for the
 * piece bag (that stays on the session RNG, src/core/session-rng.js). Shared by Waystones
 * and Odyssey so a seed means the same draw in both.
 */

/** FNV-1a over the seed's characters: any string becomes a 32-bit state. */
export function hashSeed(seed) {
    let hash = 0x811c9dc5;
    const text = String(seed);
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * mulberry32: a small, well-mixed generator.
 * @param {number} state
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(state) {
    let a = state >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A stream of one seed for one purpose, so each purpose's draw is stable on its own. */
export function seededRng(seed, purpose) {
    return mulberry32(hashSeed(`${seed}:${purpose}`));
}

/**
 * Draw `count` distinct items from `items`, in the stream's order.
 * @template T
 * @param {() => number} rng
 * @param {readonly T[]} items
 * @param {number} count
 * @param {(item: T) => boolean} [allowed]
 */
export function pickDistinct(rng, items, count, allowed = () => true) {
    const pool = items.filter(allowed);
    const picked = [];
    while (picked.length < count && pool.length > 0) {
        const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
        picked.push(pool.splice(index, 1)[0]);
    }
    return picked;
}

/** A fresh, shareable seed for a new road or journey. */
export function freshSeed(random = Math.random) {
    return Math.floor(random() * 0xffffffff).toString(36);
}
