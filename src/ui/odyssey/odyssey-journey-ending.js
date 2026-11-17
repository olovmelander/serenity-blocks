/**
 * FIRST LIGHT: the journey's ending on the map (2026-11-17).
 *
 * The campaign's finale sheet (CampaignFinale.js) is shown over the last orb's own theme. When the
 * player then chooses to explore the journey, the map used to open on a close-up of orb 60 against
 * a tower wall, and the world never answered. Now the map opens at the end of the rail (the
 * `journeyEnding` option of the return, odyssey-world-return.js), where the eye rests in follow mode: the camera's arrival shot rises over the roofs and the city plays its
 * ending (the wave of light from the spire, the journey drawn in the stars, lanterns, fireworks,
 * the dawn: rendering/odyssey/chapter-environments/shared/odyssey-journey-ending.js).
 *
 * The map's own UI (header, orb card) stays out of the way while it plays and comes back at the
 * ending's rest, or at once when the player presses, clicks or scrolls: nothing is locked, the
 * moment is theirs to leave. Later visits need none of this: resting at the end of the rail plays
 * the ending again.
 */

import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

/**
 * Seconds of the ending after which the map's UI returns by itself (the world's clock rests at
 * 60). Under reduced motion the eye stays in the street and there is no show: the UI is back as
 * soon as the wave of light has crossed the city.
 */
export const JOURNEY_ENDING_UI = Object.freeze({
    returnAt: 56, reducedReturnAt: 14, pollMs: 400, giveUpMs: 90000, fadeMs: 1600,
});

/** Seconds into the world's ending (0 when it is not running or the chapter is not built). */
export function readOdysseyJourneyEndingSeconds(mode) {
    const environments = mode?.boardController?.environmentManager?.environments;
    const ending = environments?.get?.(8)?.group?.userData?.endingNow;
    return Number.isFinite(ending?.seconds) ? ending.seconds : 0;
}

/**
 * Keep the map's UI out of the ending's way until it rests or the player acts.
 * @param {object} mode OdysseyMode
 * @param {number} levelId the orb the map returns on (the last)
 * @returns {() => void} ends it now (idempotent)
 */
export function presentOdysseyJourneyEnding(mode, levelId) {
    const overlay = typeof document !== 'undefined' ? document.getElementById('odyssey-board-overlay') : null;
    const generation = mode._boardPresentationGeneration || 0;
    let done = false;
    let timer = null;
    let giveUp = null;
    const events = ['pointerdown', 'wheel', 'touchstart'];
    const isCurrent = () => mode.isActive && mode.isInBoardView && !mode.isEnteringLevel
        && (mode._boardPresentationGeneration || 0) === generation;
    const finish = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(giveUp);
        events.forEach((name) => window.removeEventListener(name, finish, true));
        // eslint-disable-next-line no-use-before-define
        window.removeEventListener('keydown', onKey, true);
        if (mode._journeyEnding?.finish === finish) mode._journeyEnding = null;
        if (!isCurrent()) return;
        if (overlay) {
            // Ease the UI back in; the transition is taken off again once it has run.
            overlay.style.transition = `opacity ${JOURNEY_ENDING_UI.fadeMs}ms ease`;
            setTimeout(() => { overlay.style.transition = ''; }, JOURNEY_ENDING_UI.fadeMs + 100);
        }
        mode._setBoardOverlaySuppressed?.(false);
        if (Number.isFinite(levelId)) mode._updateLevelPreview?.(levelId);
    };
    // The card is hidden, so Enter or Space would launch an orb the player cannot see offered:
    // that press brings the map's UI back instead. Every other key acts as it does on the map.
    const onKey = (event) => {
        if (done) return;
        const wasCurrent = isCurrent();
        finish();
        if (wasCurrent && (event?.key === 'Enter' || event?.key === ' ')) {
            event.preventDefault?.();
            event.stopImmediatePropagation?.();
        }
    };
    mode._journeyEnding?.finish?.();
    mode._journeyEnding = { finish };
    // The world's clock started under the return's shut gate: it begins again now that the gate
    // has opened, so the wave of light leaves the spire in front of the player.
    const world = mode.boardController?.environmentManager?.environments?.get?.(8)?.group?.userData;
    if (world?.ending) world.ending.seconds = 0;
    mode._setBoardOverlaySuppressed?.(true);
    events.forEach((name) => window.addEventListener(name, finish, { capture: true, passive: true }));
    window.addEventListener('keydown', onKey, true);
    let reduced = false;
    try { reduced = prefersOdysseyReducedMotion(mode) === true; } catch { reduced = false; }
    const returnAt = reduced ? JOURNEY_ENDING_UI.reducedReturnAt : JOURNEY_ENDING_UI.returnAt;
    timer = setInterval(() => {
        if (!isCurrent() || readOdysseyJourneyEndingSeconds(mode) >= returnAt) finish();
    }, JOURNEY_ENDING_UI.pollMs);
    giveUp = setTimeout(finish, JOURNEY_ENDING_UI.giveUpMs);
    return finish;
}
