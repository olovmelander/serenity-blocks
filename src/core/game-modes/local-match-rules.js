// @ts-check

/** What leads a local versus match by its rule: frags, or score for points and time, or lines. */
const MEASURE = Object.freeze({
    frags: 'frags', points: 'score', lines: 'lines', time: 'score',
});

/**
 * Whether a local versus match is over by its rule, and who won it. The standings are match
 * totals (every round so far plus this one), one per player or team. The winner leads by the
 * rule's measure, not necessarily whoever crossed the line; a tie at the top is a draw.
 * Round-win rules (a team frag goal, a match with no rule set) are not judged here.
 * @param {{ endCondition?: string, endConditionValue?: number | string }} config
 * @param {Array<{ result: any, frags?: number, score?: number, lines?: number }>} standings
 * @param {number} elapsedMs how long the match has run (a pause does not count)
 * @returns {any} the leader's `result`, 'draw', or null while the match goes on
 */
export function resolveLocalMatchEnd(config, standings, elapsedMs) {
    const endCondition = config?.endCondition ?? '';
    const measure = MEASURE[/** @type {keyof typeof MEASURE} */ (endCondition)];
    if (!measure || standings.length === 0) return null;
    const target = Number(config.endConditionValue) || 0;
    const values = standings.map((standing) => Number(standing[measure]) || 0);
    const best = Math.max(...values);
    const over = endCondition === 'time'
        ? elapsedMs >= target * 60000
        : best >= (endCondition === 'points' ? target * 1000 : target);
    if (!over) return null;
    const leaders = standings.filter((_, index) => values[index] === best);
    return leaders.length === 1 ? leaders[0].result : 'draw';
}

/**
 * Where a clock that started at `startedAt` stands after a pause of `pausedMs` that ended at
 * `now`: moved on by the part of the pause after it started (a round can begin, or a Hot
 * Potato be passed, while the game is paused).
 * @param {number} startedAt
 * @param {number} pausedMs
 * @param {number} now
 * @returns {number}
 */
export function resumeClock(startedAt, pausedMs, now) {
    return startedAt + Math.max(0, Math.min(pausedMs, now - startedAt));
}
