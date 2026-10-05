/**
 * Breath timing as pure functions: where a pattern is at a given moment, and how full the
 * lungs are there. No DOM, no clock of its own — the guide, the playground and the tests all
 * resolve the same numbers.
 *
 * A pattern is [inhale, hold full, exhale, hold empty] in seconds; a zero skips that phase.
 */
export const BREATH_PHASES = Object.freeze(['inhale', 'hold1', 'exhale', 'hold2']);

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Cosine ease: a breath starts and ends gently, and meets its holds without a corner. */
export function easeBreath(progress) {
    return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(progress));
}

/** Lung fill 0..1 for a phase index and its progress. */
export function breathLevel(phase, progress) {
    if (phase === 0) return easeBreath(progress);
    if (phase === 1) return 1;
    if (phase === 2) return 1 - easeBreath(progress);
    return 0;
}

export function isValidPattern(pattern) {
    return Array.isArray(pattern) && pattern.length === 4
        && pattern.every((seconds) => Number.isFinite(seconds) && seconds >= 0)
        && pattern.some((seconds) => seconds > 0);
}

export function cycleSeconds(pattern) {
    return pattern.reduce((total, seconds) => total + seconds, 0);
}

/** Index of the first phase with a duration, searching forward from `from` (wrapping). */
export function nextPhase(pattern, from = 0) {
    for (let step = 0; step < 4; step++) {
        const index = (from + step) % 4;
        if (pattern[index] > 0) return index;
    }
    return 0;
}

/**
 * Resolve a pattern at `elapsed` seconds since the start of an inhale.
 * @returns {{phase: number, progress: number, breath: number, remaining: number, duration: number, cycle: number}}
 */
export function resolveBreath(pattern, elapsed) {
    const cycle = isValidPattern(pattern) ? cycleSeconds(pattern) : 0;
    if (!(cycle > 0)) {
        return {
            phase: 0, progress: 0, breath: 0, remaining: 0, duration: 0, cycle: 0,
        };
    }
    let t = ((elapsed % cycle) + cycle) % cycle;
    let last = 0;
    for (let phase = 0; phase < 4; phase++) {
        const duration = pattern[phase];
        if (duration > 0) {
            last = phase;
            if (t < duration) {
                const progress = t / duration;
                return {
                    phase, progress, breath: breathLevel(phase, progress), remaining: duration - t, duration, cycle,
                };
            }
            t -= duration;
        }
    }
    // Floating-point remainder landed exactly on the cycle boundary.
    return {
        phase: last, progress: 1, breath: breathLevel(last, 1), remaining: 0, duration: pattern[last], cycle,
    };
}
