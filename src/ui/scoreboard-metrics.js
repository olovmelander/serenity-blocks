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

const SWORDS = '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/>'
    + '<line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/>'
    + '<polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="11" x2="11" y2="5"/>'
    + '<line x1="3" y1="13" x2="5" y2="15"/><line x1="8" y1="8" x2="4" y2="12"/>';
const TROPHY = '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>'
    + '<path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>'
    + '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>'
    + '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>';
const BARS = '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/>'
    + '<line x1="6" y1="20" x2="6" y2="16"/>';

/** The stat bar's own icons (index.html), so a column reads like the numbers under a board. */
const ICON_PATHS = { frags: SWORDS, score: TROPHY, lines: BARS };

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

/** The win condition in words, for the scoreboard heads. */
export function goalText(endCondition, value) {
    const conditions = {
        frags: `First to ${value} frags`,
        time: `${value} minutes`,
        points: `First to ${value}k points`,
        lines: `First to ${value} lines`,
        never: 'Endless',
    };
    return conditions[endCondition] || '';
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
