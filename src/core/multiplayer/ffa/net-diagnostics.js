// @ts-check

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function sanitizeFfaNetEventData(value, depth = 0) {
    if (value == null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 3) return '[truncated]';
    if (Array.isArray(value)) {
        return value.slice(0, 16).map((item) => sanitizeFfaNetEventData(item, depth + 1));
    }
    if (typeof value === 'object') {
        /** @type {Record<string, unknown>} */
        const out = {};
        Object.entries(value).slice(0, 32).forEach(([key, item]) => {
            if (typeof item !== 'function') out[key] = sanitizeFfaNetEventData(item, depth + 1);
        });
        return out;
    }
    return String(value);
}

/**
 * @param {unknown} grid
 * @returns {number}
 */
export function countOccupiedFfaCells(grid) {
    if (!Array.isArray(grid)) return 0;
    let cells = 0;
    for (const row of grid) {
        if (Array.isArray(row)) {
            for (const cell of row) if (cell) cells += 1;
        }
    }
    return cells;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stableFfaRuleHash(value) {
    const seen = new WeakSet();
    /**
     * @param {unknown} item
     * @returns {unknown}
     */
    const stable = (item) => {
        if (item == null || typeof item !== 'object') return item;
        if (seen.has(item)) return '[cycle]';
        seen.add(item);
        if (Array.isArray(item)) return item.map(stable);
        return Object.keys(item).sort().reduce((out, key) => {
            out[key] = stable(/** @type {Record<string, unknown>} */ (item)[key]);
            return out;
        }, /** @type {Record<string, unknown>} */ ({}));
    };
    const json = JSON.stringify(stable(value || {}));
    let hash = 5381;
    for (let i = 0; i < json.length; i += 1) {
        hash = ((hash << 5) + hash) + json.charCodeAt(i);
        hash &= hash;
    }
    return (hash >>> 0).toString(16);
}

/**
 * @param {Record<string, unknown>|null|undefined} current
 * @param {Record<string, unknown>|null|undefined} previous
 * @param {string} key
 * @returns {number}
 */
export function ffaCounterDelta(current, previous, key) {
    const nowValue = Number(current?.[key] || 0);
    const prevValue = Number(previous?.[key] || 0);
    return Math.max(0, nowValue - prevValue);
}
