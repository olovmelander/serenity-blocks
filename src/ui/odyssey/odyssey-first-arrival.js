/**
 * The fresh journey's welcome: the Chapter 1 arrival (the same chapter composition every chapter
 * opens with) with a short orientation. Without it the first thing a new player saw was
 * "Orb 1 · Play" on a map that explained nothing. It shows once per journey; the mark rides on
 * the next save.
 */
import { createJourneyFlowOverlay } from './JourneyFlowOverlay.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';
import { ODYSSEY_CHARM_ARRIVAL_NOTE } from './odyssey-charm-copy.js';

/** What a new traveller needs to know, in the order they will meet it. */
export const ODYSSEY_FIRST_ARRIVAL_NOTES = Object.freeze([
    'Each orb is one short puzzle with a goal. Clear it and the path opens to the next.',
    'Every orb offers three stars. Its panel on the map shows what each star asks before you play.',
    ODYSSEY_CHARM_ARRIVAL_NOTE,
    'Pause any time for Retry orb, Back to map and Settings.',
]);

/** A journey nothing has been played in, which the arrival has not welcomed yet. */
export function shouldOfferOdysseyFirstArrival(mode) {
    const state = mode?.odysseyState;
    return Boolean(state?.isFreshJourney?.() && !state.hasSeenArrival?.());
}

/**
 * Show the welcome, holding the map until the player has chosen.
 * @param {object} mode
 * @returns {Promise<'next'|'map'|null>} 'next' launched Orb 1, 'map' kept the map, null when
 *   nothing showed or the mode left while it was up
 */
export async function presentOdysseyFirstArrival(mode) {
    if (!mode?.isActive || !mode.isInBoardView || mode.isEnteringLevel || mode._chapterFlowActive) return null;
    if (mode._journeyFlowOperation || mode._firstArrival) return null;
    if (!shouldOfferOdysseyFirstArrival(mode)) return null;
    const level = mode.levelRegistry?.getLevel?.(1);
    const chapter = mode.levelRegistry?.getChapter?.(level?.chapter || 1);
    if (!level || !chapter) return null;

    mode.odysseyState.markArrivalSeen?.();
    mode._chapterFlowActive = true;
    mode._lockOdysseyBoardForLaunch?.();
    mode._setBoardOverlaySuppressed?.(true);
    mode._updateLevelPreview?.(null);
    const generation = mode._boardPresentationGeneration || 0;

    let modal = null;
    const choice = await new Promise((resolve) => {
        modal = createJourneyFlowOverlay({
            variant: 'chapter',
            nextLevel: level,
            chapter,
            orientation: ODYSSEY_FIRST_ARRIVAL_NOTES,
            destinationPrefix: 'First',
            reducedMotion: prefersOdysseyReducedMotion(mode),
            onChoose: resolve,
        });
        mode._firstArrival = { modal, cancel: () => resolve(null) };
        document.body.appendChild(modal);
    });
    modal.dispose();
    mode._firstArrival = null;
    mode._chapterFlowActive = false;
    const stillCurrent = mode.isActive && (mode._boardPresentationGeneration || 0) === generation;
    if (choice === null || !stillCurrent) return null;

    mode._setBoardOverlaySuppressed?.(false);
    mode._unlockOdysseyBoardAfterLaunchAttempt?.();
    mode.setOdysseyNavigatorButtonVisible?.(true);
    mode.selectedLevelId = level.id;
    mode._updateLevelPreview?.(level.id);
    if (choice === 'next') {
        await mode.launchOdysseyLevel(level.id, { source: 'first-arrival' });
    }
    return choice;
}
