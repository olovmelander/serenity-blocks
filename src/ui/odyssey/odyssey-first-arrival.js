/**
 * The Chapter 1 arrival for a fresh journey. Without it the first thing a new player saw was
 * "Orb 1 · Play" on a map that explained nothing. The welcome is the same chapter overlay every
 * later chapter opens with, plus a short orientation, and it shows once per journey.
 */
import { createJourneyFlowOverlay } from './JourneyFlowOverlay.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

/** What a new traveller needs to know, in the order they will meet it. */
export const ODYSSEY_FIRST_ARRIVAL_NOTES = Object.freeze([
    'Each orb is one short puzzle with a goal. Clear it and the path opens to the next.',
    'Every orb offers three stars. Its panel on the map shows what each star asks before you play.',
    'Finishing or falling earns gems. Spend one during an orb to ease a hard moment.',
    'Pause any time for Retry orb, Back to map and Settings.',
]);

/** A journey nothing has been played in, which the arrival has not welcomed yet. */
export function shouldOfferOdysseyFirstArrival(mode) {
    const state = mode?.odysseyState;
    return Boolean(state?.isFreshJourney?.() && !state.hasSeenArrival?.());
}

/**
 * Welcome a fresh journey with the Chapter 1 arrival before the map is handed over.
 * @returns {Promise<'next'|'map'|null>} 'next' launched Orb 1, 'map' kept the map, null when
 *   nothing showed or the mode left while it was up
 */
export async function presentOdysseyFirstArrival(mode) {
    if (!shouldOfferOdysseyFirstArrival(mode)) return null;
    if (!mode.isActive || !mode.isInBoardView || mode.isEnteringLevel || mode._chapterFlowActive) return null;
    const firstLevel = mode.levelRegistry?.getLevel?.(1);
    const chapter = mode.levelRegistry?.getChapter?.(firstLevel?.chapter || 1);
    if (!firstLevel || !chapter) return null;

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
            nextLevel: firstLevel,
            chapter,
            orientation: ODYSSEY_FIRST_ARRIVAL_NOTES,
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
    mode.selectedLevelId = firstLevel.id;
    mode._updateLevelPreview?.(firstLevel.id);
    if (choice === 'next') await mode.launchOdysseyLevel(firstLevel.id, { source: 'first-arrival' });
    return choice;
}
