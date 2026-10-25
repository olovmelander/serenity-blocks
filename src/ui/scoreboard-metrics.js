/**
 * @fileoverview What the online scoreboards show and in what order — shared by the
 * in-game scoreboard (online-scoreboard.js) and the Tab scoreboard
 * (multiplayer-scoreboard-overlay.js).
 *
 * Each match is decided by one number (the end condition, frag-tracker.js): frags, or
 * score ("points", and "time" — the highest score when time runs out), or lines. The
 * scoreboards rank by it and show it first; the second number beside it is frags, or
 * score when frags decide.
 */
import { describeGoal } from './components/mp-sheet.js';
import { csIconInner } from './components/cosmic-icons.js';

/** Each metric's glyph from the game's icon set, so a column reads like the stats under a board. */
const ICON_PATHS = { frags: csIconInner('crossed-swords'), score: csIconInner('trophy'), lines: csIconInner('line-stack') };

export const METRIC_LABELS = Object.freeze({ frags: 'Frags', score: 'Score', lines: 'Lines' });

/** The number that decides a match with this end condition. */
export function primaryMetric(endCondition) {
    if (endCondition === 'points' || endCondition === 'time') return 'score';
    if (endCondition === 'lines') return 'lines';
    return 'frags';
}

/** The number shown beside the deciding one. */
export function secondaryMetric(primary) {
    return primary === 'frags' ? 'score' : 'frags';
}

/** The win condition in words, for the scoreboard heads: the sentence every surface uses. */
export function goalText(endCondition, value) {
    return endCondition ? describeGoal(endCondition, value) : '';
}

/**
 * Deterministic total order: the deciding metric, then frags → score → lines, then a
 * stable id tiebreak, so tied players never swap on the host snapshot's order wobble.
 */
export function compareStandings(a, b, primary) {
    const first = (b[primary] || 0) - (a[primary] || 0);
    if (first) return first;
    if ((b.frags || 0) !== (a.frags || 0)) return (b.frags || 0) - (a.frags || 0);
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    if ((b.lines || 0) !== (a.lines || 0)) return (b.lines || 0) - (a.lines || 0);
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

/** A late joiner waiting to spawn is isAlive:false but not eliminated. */
export function playerStatus(player) {
    const isWaiting = player.awaitingSpawn === true;
    const isDead = player.isAlive === false && !isWaiting;
    let label = 'Alive';
    if (isWaiting) label = 'Waiting';
    else if (isDead) label = 'Out';
    return { label, isDead, isWaiting };
}

/** A metric's value as the scoreboards print it. */
export function metricValue(player, metric) {
    const value = Number(player?.[metric]) || 0;
    return metric === 'score' ? value.toLocaleString() : String(value);
}

/** A metric's icon (decorative: the column header names it in aria-label and title). */
export function metricIcon(metric) {
    return '<svg class="sb-metric-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"'
        + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        + `${ICON_PATHS[metric] || ''}</svg>`;
}
