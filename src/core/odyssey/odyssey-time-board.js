// @ts-check
/**
 * Which Odyssey runs race on an orb's time board (Steam `OdysseyLevelTime_v6_<id>`, fastest finish first).
 */

/**
 * Whether the orb has a fastest-first time board at all. A survival orb's time is how long the player lasted,
 * where longer is better, so it has none (level design audit 2026-11, phase 3).
 * @param {{ victory?: { primary?: { type?: string } } } | null | undefined} levelConfig
 * @returns {boolean}
 */
export function hasOdysseyTimeBoard(levelConfig) {
    return levelConfig?.victory?.primary?.type !== 'time';
}

/**
 * Whether a finished run races on the orb's time board. A run that used a charm does not race plain runs (audit
 * 2026-10-18); its stars count in full.
 * @param {{ victory?: { primary?: { type?: string } } } | null | undefined} levelConfig
 * @param {{ charms?: unknown[] } | null | undefined} results
 * @returns {boolean}
 */
export function isOdysseyTimeBoardRun(levelConfig, results) {
    return hasOdysseyTimeBoard(levelConfig) && !(results?.charms?.length);
}
