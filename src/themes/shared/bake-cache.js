/**
 * Deterministic CPU bakes (noise fields, volumes, height maps) are pure functions of their
 * arguments and cost tens to hundreds of milliseconds of main thread each. A theme rebuild
 * (coming back to it, a level-up that revisits it, a quality change, a GPU recovery) takes them
 * from here instead of baking again; the first visit is unchanged.
 *
 * - Results are shared and READ-ONLY: a texture may wrap them, nothing may write into them.
 * - Keys must name every argument the bake depends on (`theme:field:seed:size`). A bake that
 *   draws from a theme's live random stream is not deterministic and does not belong here.
 * - Entries past a byte budget go least recently used first, so a long session that visits
 *   every theme holds the recent ones, not all of them.
 */

const DEFAULT_BUDGET_BYTES = 96 * 1024 * 1024;
let budgetBytes = DEFAULT_BUDGET_BYTES;
/** key -> { value, bytes }, in least-recently-used-first order. */
const entries = new Map();
let totalBytes = 0;
/** source -> Map(tag -> value): what was derived from a cached bake (mip chains, conversions). */
let derived = new WeakMap();

/** Bytes held by a bake result: typed arrays, arrays and plain objects of them. */
function sizeOf(value, depth = 0) {
    if (!value || depth > 3) return 0;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + sizeOf(item, depth + 1), 0);
    if (typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + sizeOf(item, depth + 1), 0);
    return 0;
}

function evict() {
    while (totalBytes > budgetBytes && entries.size > 1) {
        const [key, entry] = entries.entries().next().value;
        entries.delete(key);
        totalBytes -= entry.bytes;
    }
}

/**
 * The result of `make()` for `key`, baked once and kept while it fits the budget.
 * @template T
 * @param {string} key  names the bake and every argument it depends on
 * @param {() => T} make
 * @returns {T}
 */
export function bakeOnce(key, make) {
    const hit = entries.get(key);
    if (hit) {
        // Most recently used goes last.
        entries.delete(key);
        entries.set(key, hit);
        return hit.value;
    }
    const value = make();
    const bytes = sizeOf(value);
    entries.set(key, { value, bytes });
    totalBytes += bytes;
    evict();
    return value;
}

/**
 * Something built from a cached bake (a half-float mip chain, a byte conversion), kept as long
 * as its source is: `make(source)` runs once per source and tag.
 * @template T
 * @param {object} source  the cached bake it is made from
 * @param {string} tag
 * @param {(source: object) => T} make
 * @returns {T}
 */
export function derivedOnce(source, tag, make) {
    let byTag = derived.get(source);
    if (!byTag) {
        byTag = new Map();
        derived.set(source, byTag);
    }
    if (byTag.has(tag)) return byTag.get(tag);
    const value = make(source);
    byTag.set(tag, value);
    return value;
}

/** What the cache holds (diagnostics and tests). */
export function bakeCacheStats() {
    return { entries: entries.size, bytes: totalBytes, budgetBytes };
}

/** Empty the cache, and optionally set its budget (tests). */
export function resetBakeCache({ budget = DEFAULT_BUDGET_BYTES } = {}) {
    entries.clear();
    totalBytes = 0;
    derived = new WeakMap();
    budgetBytes = budget;
}
