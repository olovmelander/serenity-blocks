// @ts-check
/**
 * Pure fixed-tick scheduling policy (remediation plan §5.3).
 *
 * This module decides only how many canonical simulation ticks are owed. It
 * deliberately owns no RAF/timer, pause policy, callbacks, or gameplay state;
 * callers remain responsible for advancing the simulation in the returned
 * order. That keeps render cadence separate from the deterministic 60 Hz
 * clock and gives each migration path an explicit catch-up policy.
 */

export const FIXED_TICK_HZ = 60;
export const FIXED_TICK_MS = 1000 / FIXED_TICK_HZ;

const DEFAULT_MAX_STEPS = 5;
const MIN_TICK_MS = 1;
const BOUNDARY_EPSILON_MS = 0.0001;

function normalizeTickMs(tickMs) {
    const numericTickMs = Number(tickMs);
    return Number.isFinite(numericTickMs) && numericTickMs > 0
        ? Math.max(MIN_TICK_MS, numericTickMs)
        : FIXED_TICK_MS;
}

/**
 * Quantize a configured duration upward so the fixed-tick path never expires
 * a gameplay timer earlier than its public millisecond value.
 *
 * @param {number} durationMs
 * @param {number} [tickMs]
 * @returns {number}
 */
export function durationMsToTicks(durationMs, tickMs = FIXED_TICK_MS) {
    const numericDurationMs = Number(durationMs);
    if (!Number.isFinite(numericDurationMs) || numericDurationMs <= 0) return 0;

    const safeTickMs = normalizeTickMs(tickMs);
    const epsilonMs = Number.EPSILON * Math.max(1, numericDurationMs, safeTickMs) * 8;
    return Math.max(1, Math.ceil((numericDurationMs - epsilonMs) / safeTickMs));
}

/**
 * Derive the number of fully elapsed ticks represented by legacy millisecond
 * state. Used only to shadow/restore old snapshots during the fixed-tick
 * migration; it must not round a partial tick up.
 *
 * @param {number} elapsedMs
 * @param {number} [tickMs]
 * @returns {number}
 */
export function elapsedMsToTicks(elapsedMs, tickMs = FIXED_TICK_MS) {
    const numericElapsedMs = Number(elapsedMs);
    if (!Number.isFinite(numericElapsedMs) || numericElapsedMs <= 0) return 0;

    const safeTickMs = normalizeTickMs(tickMs);
    const epsilonMs = Number.EPSILON * Math.max(1, numericElapsedMs, safeTickMs) * 8;
    return Math.max(0, Math.floor((numericElapsedMs + epsilonMs) / safeTickMs));
}

/**
 * @typedef {Object} FixedTickPolicy
 * @property {number} [tickMs] Canonical duration of one simulation tick.
 * @property {number} [maxSteps] Maximum ticks to execute for this update.
 * @property {number} [maxElapsedMs] Clamp applied to newly elapsed wall time.
 * @property {number} [maxCarryTicks] Owed ticks retained after step overflow.
 * @property {number} [boundaryEpsilonMs] Floating-point tolerance (may reduce/disable the default).
 */

/**
 * @typedef {Object} FixedTickPlan
 * @property {number} steps
 * @property {number} tickMs
 * @property {number} maxSteps
 * @property {number} acceptedElapsedMs
 * @property {boolean} elapsedWasClamped
 * @property {number} accumulatedMs Total owed time before executing steps.
 * @property {number} remainderBeforeCarryCapMs Owed time after steps, before overflow policy.
 *   May be a tiny negative correction when epsilon admits a boundary tick early.
 * @property {number} remainderMs Owed time to carry into the next update (including correction debt).
 * @property {boolean} overflowed Whether the step budget left at least one full tick owed.
 * @property {number} discardedMs Owed catch-up time dropped by the overflow policy.
 */

/**
 * Plan fixed simulation ticks without invoking the simulation.
 *
 * Invalid/negative elapsed values contribute no time. Positive infinity is
 * treated as the configured elapsed clamp (when finite), matching the current
 * background-resume safety behavior instead of attempting an infinite catch-up.
 *
 * @param {number} accumulatorMs Previously owed time.
 * @param {number} elapsedMs Newly elapsed wall time.
 * @param {FixedTickPolicy} [policy]
 * @returns {FixedTickPlan}
 */
export function planFixedTicks(accumulatorMs, elapsedMs, policy = {}) {
    const tickMs = normalizeTickMs(policy.tickMs);

    const requestedMaxSteps = Number(policy.maxSteps);
    const maxSteps = Number.isFinite(requestedMaxSteps) && requestedMaxSteps !== 0
        ? Math.max(1, Math.ceil(requestedMaxSteps))
        : DEFAULT_MAX_STEPS;

    const requestedMaxElapsedMs = Number(policy.maxElapsedMs);
    const maxElapsedMs = Number.isFinite(requestedMaxElapsedMs) && requestedMaxElapsedMs >= 0
        ? requestedMaxElapsedMs
        : Number.POSITIVE_INFINITY;

    const requestedCarryTicks = Number(policy.maxCarryTicks);
    const maxCarryTicks = Number.isFinite(requestedCarryTicks) && requestedCarryTicks >= 0
        ? requestedCarryTicks
        : 1;

    const requestedEpsilonMs = Number(policy.boundaryEpsilonMs);
    const configuredEpsilonMs = Number.isFinite(requestedEpsilonMs) && requestedEpsilonMs >= 0
        ? requestedEpsilonMs
        : BOUNDARY_EPSILON_MS;
    // At most half a tick: tolerance may admit a boundary tick slightly early,
    // but can never manufacture a tick from an empty accumulator. Any early
    // admission remains time-conserving via the signed remainder below.
    const boundaryEpsilonMs = Math.min(configuredEpsilonMs, BOUNDARY_EPSILON_MS, tickMs / 2);

    const numericAccumulatorMs = Number(accumulatorMs);
    const safeAccumulatorMs = Number.isFinite(numericAccumulatorMs)
        ? numericAccumulatorMs
        : 0;

    const numericElapsedMs = Number(elapsedMs);
    let safeElapsedMs = Number.isFinite(numericElapsedMs) && numericElapsedMs > 0
        ? numericElapsedMs
        : 0;
    if (numericElapsedMs === Number.POSITIVE_INFINITY && Number.isFinite(maxElapsedMs)) {
        safeElapsedMs = maxElapsedMs;
    }
    const acceptedElapsedMs = Math.min(safeElapsedMs, maxElapsedMs);
    const elapsedWasClamped = !Number.isFinite(numericElapsedMs)
        || numericElapsedMs !== acceptedElapsedMs;

    const accumulatedCandidateMs = safeAccumulatorMs + acceptedElapsedMs;
    const accumulatedMs = Number.isFinite(accumulatedCandidateMs)
        ? accumulatedCandidateMs
        : acceptedElapsedMs;
    const owedSteps = Math.max(0, Math.floor((accumulatedMs + boundaryEpsilonMs) / tickMs));
    const steps = Math.min(owedSteps, maxSteps);

    // Do not round this signed remainder to zero. The epsilon can admit a tick
    // a few microseconds early; carrying the resulting negative debt is what
    // preserves elapsed time over long sessions and across render rates.
    const remainderBeforeCarryCapMs = accumulatedMs - (steps * tickMs);
    const overflowed = steps >= maxSteps && remainderBeforeCarryCapMs >= tickMs;
    const remainderMs = overflowed
        ? Math.min(remainderBeforeCarryCapMs, tickMs * maxCarryTicks)
        : remainderBeforeCarryCapMs;

    return {
        steps,
        tickMs,
        maxSteps,
        acceptedElapsedMs,
        elapsedWasClamped,
        accumulatedMs,
        remainderBeforeCarryCapMs,
        remainderMs,
        overflowed,
        discardedMs: remainderBeforeCarryCapMs - remainderMs,
    };
}
