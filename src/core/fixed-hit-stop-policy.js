// @ts-check

/**
 * Deterministic hit-stop producer policy for fixed-tick simulation.
 *
 * The policy deliberately writes the public millisecond field. During the
 * fixed-tick migration, `consumeFixedHitStopTick` owns upward quantization and
 * keeps the integer counter synchronized; legacy loops can continue consuming
 * the same field until their cutover.
 *
 * No renderer, accessibility preference, or wall-clock state is consulted.
 */

export const FIXED_HARD_DROP_HIT_STOP_MS = 30;
export const FIXED_LINE_IMPACT_HIT_STOP_MS = 70;
export const FIXED_PERFECT_CLEAR_HIT_STOP_MS = 110;

/**
 * @typedef {Object} FixedHitStopState
 * @property {boolean} [hitStopEnabled]
 * @property {unknown} [hitStopRemaining]
 */

/**
 * @param {FixedHitStopState|null|undefined} gameState
 * @returns {boolean}
 */
function canApplyFixedHitStop(gameState) {
    return Boolean(gameState) && gameState?.hitStopEnabled !== false;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeRemainingMs(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

/**
 * Hard-drop impact extends a shorter freeze but never truncates a stronger
 * event that already occurred in the same simulation turn.
 *
 * @param {FixedHitStopState|null|undefined} gameState
 * @returns {boolean} Whether the fixed policy accepted the event.
 */
export function applyFixedHardDropHitStop(gameState) {
    if (!canApplyFixedHitStop(gameState) || !gameState) return false;

    gameState.hitStopRemaining = Math.max(
        normalizeRemainingMs(gameState.hitStopRemaining),
        FIXED_HARD_DROP_HIT_STOP_MS,
    );
    return true;
}

/**
 * A four-or-more-line impact replaces the outstanding duration. Line counts
 * are discrete simulation facts, so coercible strings, fractional values,
 * infinities, and unsafe integers are rejected instead of being guessed.
 *
 * @param {FixedHitStopState|null|undefined} gameState
 * @param {unknown} lineCount
 * @returns {boolean} Whether a qualifying impact was applied.
 */
export function applyFixedLineImpactHitStop(gameState, lineCount) {
    if (
        !canApplyFixedHitStop(gameState)
        || !gameState
        || !Number.isSafeInteger(lineCount)
        || Number(lineCount) < 4
    ) {
        return false;
    }

    gameState.hitStopRemaining = FIXED_LINE_IMPACT_HIT_STOP_MS;
    return true;
}

/**
 * Perfect clear is an authoritative replacement event, including when a
 * longer malformed or future duration was already present.
 *
 * @param {FixedHitStopState|null|undefined} gameState
 * @returns {boolean} Whether the fixed policy accepted the event.
 */
export function applyFixedPerfectClearHitStop(gameState) {
    if (!canApplyFixedHitStop(gameState) || !gameState) return false;

    gameState.hitStopRemaining = FIXED_PERFECT_CLEAR_HIT_STOP_MS;
    return true;
}
