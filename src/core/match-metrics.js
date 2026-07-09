/**
 * @fileoverview Pure helpers for aggregating per-round player combat metrics
 * (attacks, clean lines, combos, Hot Potato events) into end-of-match totals.
 *
 * Kept dependency-free so the aggregation logic is unit-testable without the
 * DOM/Phaser-heavy game-mode modules that consume it.
 */

/**
 * @returns {Object} a zeroed match-metrics record
 */
export function createEmptyMatchMetrics() {
    return {
        attacksSent: 0,
        attackLinesSent: 0,
        attacksReceived: 0,
        attackLinesReceived: 0,
        cleanLinesSent: 0,
        cleanLinesReceived: 0,
        maxCombo: 0,
        maxComboDepth: 0,
        maxComboComplexity: 0,
        potatoPasses: 0,
        potatoDetonations: 0,
        potatoLinesReceived: 0,
    };
}

// Fields that sum across rounds vs fields that take the maximum.
const ADDITIVE_FIELDS = [
    'attacksSent', 'attackLinesSent', 'attacksReceived', 'attackLinesReceived',
    'cleanLinesSent', 'cleanLinesReceived',
    'potatoPasses', 'potatoDetonations', 'potatoLinesReceived',
];
const MAX_FIELDS = ['maxCombo', 'maxComboDepth', 'maxComboComplexity'];

/**
 * Accumulate one round's player metrics into a running match-total record
 * (mutates and returns `target`). Additive fields are summed; max-style fields
 * take the maximum. Tolerates a missing/partial `src`.
 * @param {Object} target - running totals (from createEmptyMatchMetrics)
 * @param {Object} [src] - one round's metrics
 * @returns {Object} target
 */
export function accumulateMatchMetrics(target, src = {}) {
    if (!target) return target;
    const source = src || {};
    ADDITIVE_FIELDS.forEach((k) => { target[k] = (target[k] || 0) + (source[k] || 0); });
    MAX_FIELDS.forEach((k) => { target[k] = Math.max(target[k] || 0, source[k] || 0); });
    return target;
}
