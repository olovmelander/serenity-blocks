/**
 * @fileoverview The board's quality preset, collapsed to the three cost tiers chapters gate on.
 *
 * Seamless pass (2026-10). Chapters used to receive only `{ particleCount }` from the
 * environment manager, so nothing in ch6-8 could tell Lane B (Medium on the iGPU) from Lane A
 * (High on the RTX) — every chapter paid its full High cost everywhere. The board now hands
 * its `qualityName` through as `options.qualityTier`; this maps it onto the three budgets the
 * chapter builders actually distinguish.
 *
 *   high   — High / Ultra / Extreme, and anything unknown (headless tests, pilots): the
 *            authored look, unchanged.
 *   medium — Medium (the Lane B iGPU tier): the same composition with the finest octaves and
 *            the densest sprite fields trimmed.
 *   low    — Low / Minimal: the outermost set dressing goes too.
 */

const TIER_BY_QUALITY = Object.freeze({
    minimal: 'low',
    low: 'low',
    medium: 'medium',
    high: 'high',
    ultra: 'high',
    extreme: 'high',
});

/**
 * @param {string|{qualityTier?: string}|null|undefined} input the board's qualityName, or a
 *   chapter `create()` options object carrying it as `qualityTier`
 * @returns {'high'|'medium'|'low'}
 */
export function resolveQualityTier(input) {
    const name = typeof input === 'string' ? input : input?.qualityTier;
    if (typeof name !== 'string') return 'high';
    return TIER_BY_QUALITY[name.toLowerCase()] ?? 'high';
}

/**
 * Pick a per-tier value from `{ high, medium, low }` (missing tiers fall back toward `high`).
 * @template T
 * @param {string|object} input see resolveQualityTier
 * @param {{high: T, medium?: T, low?: T}} table
 * @returns {T}
 */
export function pickByQualityTier(input, table) {
    const tier = resolveQualityTier(input);
    if (tier === 'low') return table.low ?? table.medium ?? table.high;
    if (tier === 'medium') return table.medium ?? table.high;
    return table.high;
}
