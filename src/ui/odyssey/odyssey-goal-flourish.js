/**
 * The moment an orb's goal is reached, the well answers before any sheet appears: the theme
 * receives the same celebration events a big clear sends, the well's border flares in the
 * chapter's colour with a sweep of light, and the level-up chime plays. It lasts well under a
 * second and runs while the attempt drains and saves, so it adds a beat of payoff (the peak
 * the ceremony then confirms) rather than a wait. A showcase that already celebrated its goal
 * at the start of its lap, a hidden page and reduced motion all keep it short and still.
 * Styles: `.odyssey-goal-flare` in public/styles/odyssey-flow.css.
 */
import { emitCombo, emitLineClear } from '../../events/gameplay-events.js';

export const GOAL_FLOURISH_MS = 720;
const REDUCED_FLOURISH_MS = 280;
/** The CSS flare and sweep finish within this; the ceremony covers the well by then. */
const FLARE_LIFETIME_MS = 1600;
const CHAPTER_COLORS = [
    '#f3ac77', '#8cd3ed', '#b5d4a2', '#c8d3f0',
    '#c8b2ed', '#b5a0ee', '#e6a9dd', '#f3b29d',
];

/**
 * @param {object} mode the Odyssey mode (sound and level ownership)
 * @param {object} session the retired, completing attempt
 * @param {{reducedMotion?: boolean}} [options]
 * @returns {Promise<void>} settles when the flourish has had its moment
 */
export function playOdysseyGoalFlourish(mode, session, { reducedMotion = false } = {}) {
    if (!session || typeof document === 'undefined' || document.hidden
        || session.gameState?.victoryLapStartTime) return Promise.resolve();
    const levelId = session.levelId ?? session.levelConfig?.id;
    emitLineClear({
        lineCount: 4, comboCount: 6, source: 'odyssey-goal', levelId,
    });
    emitCombo({ comboCount: 6, source: 'odyssey-goal', levelId });
    mode.deps?.soundManager?.sfxPlayer?.playLevelUp?.();
    const border = document.getElementById?.('single-player-border');
    const well = border?.parentElement;
    // No rendered well (a duel layout, a test harness): the theme still celebrates, nothing waits.
    const unrendered = typeof border?.getClientRects === 'function' && border.getClientRects().length === 0;
    if (!border || !well || unrendered) return Promise.resolve();
    clearOdysseyGoalFlourish();
    const color = CHAPTER_COLORS[(session.levelConfig?.chapter || 1) - 1] || CHAPTER_COLORS[0];
    well.style.setProperty('--odyssey-goal-color', color);
    well.dataset.goalReducedMotion = String(reducedMotion);
    // Restart cleanly if an earlier flare is still settling.
    well.getBoundingClientRect?.();
    well.classList.add('odyssey-goal-sweep');
    border.classList.add('odyssey-goal-flare');
    // A stage hidden mid-flare would replay it when shown again: always retire the classes.
    setTimeout(clearOdysseyGoalFlourish, FLARE_LIFETIME_MS);
    return new Promise((resolve) => {
        setTimeout(resolve, reducedMotion ? REDUCED_FLOURISH_MS : GOAL_FLOURISH_MS);
    });
}

/** A new attempt or the map must not inherit a flaring well. */
export function clearOdysseyGoalFlourish() {
    const border = document.getElementById?.('single-player-border');
    border?.classList.remove('odyssey-goal-flare');
    border?.parentElement?.classList.remove('odyssey-goal-sweep');
}
