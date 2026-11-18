/**
 * A binding capture (settings.js) takes its answer on its own pad timer, so the press that ended
 * it can reach the menu's poll a frame later, still held. For this long after a capture ends, a
 * press still belongs to it.
 */
export const CAPTURE_SETTLE_MS = 300;

/**
 * Whether a capture that ended at `endedAt` (Date.now() milliseconds; 0 or missing for never)
 * ended within CAPTURE_SETTLE_MS of `now`. A clock set back since then does not count as
 * recent: the menus would otherwise ignore the pad until the clock caught up.
 * @param {number|string|null|undefined} endedAt
 * @param {number} [now]
 */
export function captureEndedRecently(endedAt, now = Date.now()) {
    const since = now - (Number(endedAt) || 0);
    return since >= 0 && since < CAPTURE_SETTLE_MS;
}
