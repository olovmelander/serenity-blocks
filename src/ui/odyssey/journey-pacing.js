/**
 * How long Odyssey's automatic completion beat lingers before the journey moves on.
 *
 * A fixed 2.6 s raced past every first-time theme and song. The hold now follows what is on
 * screen: the reveal choreography, then reading time for anything the player has never seen.
 * Adults read English non-fiction at about 238 words a minute (Brysbaert 2019, J. Mem. Lang.);
 * a new reward is budgeted at a slower 200 (300 ms a word) so it is never cut off mid-read.
 * The next goal returns in the travel briefing, so it only adds a quarter of its reading time.
 * A familiar orb (nothing new) keeps a brief beat, so a run of replays still flows.
 * Pause, Results, focus and pointer input all hold the beat indefinitely; Continue skips it.
 */

/** Stars landing and the reward bloom, before the first new word is fully readable. */
export const COMPLETION_REVEAL_MS = 2200;
export const MS_PER_NEW_WORD = 300;
export const MS_PER_BRIEFING_WORD = 75;
export const COMPLETION_HOLD_LIMITS = Object.freeze({
    brief: Object.freeze({ base: 2600, min: 3400, max: 6000 }),
    reward: Object.freeze({ base: COMPLETION_REVEAL_MS, min: 6500, max: 11500 }),
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wordCount = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

/** Words a reader actually parses: separators such as "·" and bare numbers still count once. */
export function countWords(...texts) {
    return texts
        .flat()
        .filter((text) => typeof text === 'string')
        .reduce((total, text) => total + (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)?.length || 0), 0);
}

/**
 * @param {{rewardWords?: number, briefingWords?: number, hasReward?: boolean}} copy
 * @returns {number} milliseconds of uninterrupted, visible time before automatic continuation
 */
export function getCompletionHoldMs({ rewardWords = 0, briefingWords = 0, hasReward = false } = {}) {
    const limits = hasReward ? COMPLETION_HOLD_LIMITS.reward : COMPLETION_HOLD_LIMITS.brief;
    const reading = (hasReward ? wordCount(rewardWords) * MS_PER_NEW_WORD : 0)
        + wordCount(briefingWords) * MS_PER_BRIEFING_WORD;
    return Math.round(clamp(limits.base + reading, limits.min, limits.max));
}
