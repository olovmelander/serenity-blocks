/**
 * The moment an orb's goal is reached, the well answers before any sheet appears: the theme
 * plays its showpiece reel (the events of a quad, a cascade and a perfect clear, compressed
 * into about a second and a half), the well's border flares in the chapter's colour with a
 * sweep of light that returns on the final clear, and the chimes play. It runs while the
 * attempt drains and saves, so it adds a beat of payoff (the peak the ceremony then confirms)
 * rather than a wait, and the ceremony arrives through an afterglow instead of a cut. A
 * showcase that already celebrated its goal at the start of its lap, a hidden page and
 * reduced motion all keep it short and still.
 * Styles: `.odyssey-goal-flare` in public/styles/odyssey-flow.css.
 */
import { emitEffectStep } from '../serenity-mode/serenity-effects.js';
import { buildOdysseyShowpiece, odysseyShowpieceDuration } from './odyssey-showpiece.js';

/** The default reel's length: every theme's showpiece holds the stage this long. */
export const GOAL_FLOURISH_MS = odysseyShowpieceDuration(buildOdysseyShowpiece());
const REDUCED_FLOURISH_MS = 280;
/** The CSS flare and sweep finish within this; the ceremony covers the well by then. */
const FLARE_LIFETIME_MS = GOAL_FLOURISH_MS + 900;

// The flourish in flight: its timers and its promise. Untracked, a player leaving within the
// ~1.5 s reel still sent the theme's showpiece events to whatever theme came next (audit
// 2026-10-18); clearOdysseyGoalFlourish cancels them and settles the promise with false.
let inFlight = null;

function later(callback, ms) {
    const timer = setTimeout(callback, ms);
    inFlight?.timers.push(timer);
    return timer;
}
const CHAPTER_COLORS = [
    '#f3ac77', '#8cd3ed', '#b5d4a2', '#c8d3f0',
    '#c8b2ed', '#b5a0ee', '#e6a9dd', '#f3b29d',
];

function pulseWell(well) {
    if (!well?.classList) return;
    well.classList.remove('odyssey-goal-sweep');
    // Restart the sweep cleanly.
    well.getBoundingClientRect?.();
    well.classList.add('odyssey-goal-sweep');
}

/**
 * @param {object} mode the Odyssey mode (sound and level ownership)
 * @param {object} session the retired, completing attempt
 * @param {{reducedMotion?: boolean}} [options]
 * @returns {Promise<boolean|undefined>} true once the showpiece has had its moment on a rendered
 *   well; undefined when the theme only answered in passing or nothing played
 */
export function playOdysseyGoalFlourish(mode, session, { reducedMotion = false } = {}) {
    if (!session || typeof document === 'undefined' || document.hidden
        || session.gameState?.victoryLapStartTime) return Promise.resolve();
    const levelId = session.levelId ?? session.levelConfig?.id;
    const steps = buildOdysseyShowpiece({
        themeId: session.levelConfig?.theme?.primary, levelId, reducedMotion,
    });
    const sfx = mode.deps?.soundManager?.sfxPlayer;
    sfx?.playLevelUp?.();
    const border = document.getElementById?.('single-player-border');
    const well = border?.parentElement;
    // No rendered well (a duel layout, a test harness): the theme still gets the reel's opening
    // events, nothing waits.
    const unrendered = typeof border?.getClientRects === 'function' && border.getClientRects().length === 0;
    if (!border || !well || unrendered) {
        steps.filter((step) => step.at === 0).forEach(emitEffectStep);
        return Promise.resolve();
    }
    clearOdysseyGoalFlourish();
    inFlight = { timers: [], resolve: null };
    const color = CHAPTER_COLORS[(session.levelConfig?.chapter || 1) - 1] || CHAPTER_COLORS[0];
    well.style.setProperty('--odyssey-goal-color', color);
    well.dataset.goalReducedMotion = String(reducedMotion);
    // Restart cleanly if an earlier flare is still settling.
    well.getBoundingClientRect?.();
    well.classList.add('odyssey-goal-sweep');
    border.classList.add('odyssey-goal-flare');
    steps.forEach((step) => {
        const play = () => {
            emitEffectStep(step);
            if (step.type === 'perfectClear') {
                sfx?.playPerfectClear?.();
                if (!reducedMotion) pulseWell(well);
            }
        };
        if (step.at <= 0) play();
        else later(play, step.at);
    });
    // A stage hidden mid-flare would replay it when shown again: always retire the classes.
    later(removeFlareClasses, FLARE_LIFETIME_MS);
    const flight = inFlight;
    return new Promise((resolve) => {
        flight.resolve = resolve;
        later(() => resolve(true), reducedMotion ? REDUCED_FLOURISH_MS : GOAL_FLOURISH_MS);
    });
}

function removeFlareClasses() {
    const border = document.getElementById?.('single-player-border');
    border?.classList.remove('odyssey-goal-flare');
    border?.parentElement?.classList.remove('odyssey-goal-sweep');
}

/** A new attempt or the map must not inherit a flaring well, nor its pending showpiece. */
export function clearOdysseyGoalFlourish() {
    if (inFlight) {
        const { timers, resolve } = inFlight;
        inFlight = null;
        timers.forEach((timer) => clearTimeout(timer));
        resolve?.(false);
    }
    if (typeof document !== 'undefined') removeFlareClasses();
}
