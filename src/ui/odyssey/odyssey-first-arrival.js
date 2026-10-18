/**
 * The chapter arrivals the map itself must offer. Two cases share one overlay (the same chapter
 * composition every chapter opens with):
 *
 * - A fresh journey: the Chapter 1 arrival with a short orientation and the journey's first
 *   draft of charms. Without it the first thing a new player saw was "Orb 1 · Play" on a map
 *   that explained nothing. It shows once per journey.
 * - A reached chapter whose draft still waits (the player left the ceremony for the map before
 *   the chapter flow could offer it, or the save predates charms): the arrival returns as "the
 *   road offers a charm" so no chapter's pick is ever lost.
 */
import { createJourneyFlowOverlay } from './JourneyFlowOverlay.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';
import { odysseyChapterDraftKey } from '../../core/odyssey/odyssey-charms.js';

/** What a new traveller needs to know, in the order they will meet it. */
export const ODYSSEY_FIRST_ARRIVAL_NOTES = Object.freeze([
    'Each orb is one short puzzle with a goal. Clear it and the path opens to the next.',
    'Every orb offers three stars. Its panel on the map shows what each star asks before you play.',
    'At every chapter’s arrival the road offers three charms. Take one and keep it for the rest of the way.',
    'Pause any time for Retry orb, Back to map and Settings.',
]);

/** A journey nothing has been played in, which the arrival has not welcomed yet. */
export function shouldOfferOdysseyFirstArrival(mode) {
    const state = mode?.odysseyState;
    return Boolean(state?.isFreshJourney?.() && !state.hasSeenArrival?.());
}

function charmDraftFor(mode, draft) {
    if (!draft?.charms?.length) return null;
    return {
        charms: draft.charms,
        onTake: (charmId) => mode.odysseyState?.takeCharm?.(draft.key, charmId),
        onPass: () => mode.odysseyState?.passCharm?.(draft.key),
    };
}

/**
 * The chapter the player is in, when its arrival draft still waits and the chapter is open.
 * @returns {{ chapterId: number, chapter: object, level: object, draft: object }|null}
 */
export function pendingOdysseyChapterArrival(mode) {
    const state = mode?.odysseyState;
    const registry = mode?.levelRegistry;
    const chapterId = Number(state?.currentChapter) || 0;
    if (!chapterId || !state?.getCharmDraft || !registry?.getChapter) return null;
    const draft = state.getCharmDraft(odysseyChapterDraftKey(chapterId));
    if (!draft) return null;
    const chapter = registry.getChapter(chapterId);
    const firstId = chapter?.levelRange?.[0];
    if (!chapter || !firstId) return null;
    const current = registry.getLevel?.(Number(state.currentLevel));
    const level = current?.chapter === chapterId ? current : registry.getLevel?.(firstId);
    if (!level) return null;
    return {
        chapterId, chapter, level, draft, fresh: false,
    };
}

/** Which arrival the map owes: the fresh journey's, a pending chapter draft's, or none. */
export function describeOdysseyArrival(mode, { onlyPending = false } = {}) {
    if (!onlyPending && shouldOfferOdysseyFirstArrival(mode)) {
        const level = mode.levelRegistry?.getLevel?.(1);
        const chapter = mode.levelRegistry?.getChapter?.(level?.chapter || 1);
        if (!level || !chapter) return null;
        const draft = mode.odysseyState.getCharmDraft?.(odysseyChapterDraftKey(chapter.id)) || null;
        return {
            chapterId: chapter.id, chapter, level, draft, fresh: true,
        };
    }
    if (onlyPending && mode?.odysseyState?.isFreshJourney?.()) return null;
    return pendingOdysseyChapterArrival(mode);
}

/**
 * Show the arrival the map owes, holding the map until the player has chosen.
 * @param {object} mode
 * @param {{ onlyPending?: boolean }} [options] only a pending chapter draft, never the fresh welcome
 * @returns {Promise<'next'|'map'|null>} 'next' launched the orb, 'map' kept the map, null when
 *   nothing showed or the mode left while it was up
 */
export async function presentOdysseyArrival(mode, options = {}) {
    if (!mode?.isActive || !mode.isInBoardView || mode.isEnteringLevel || mode._chapterFlowActive) return null;
    if (mode._journeyFlowOperation || mode._firstArrival) return null;
    const arrival = describeOdysseyArrival(mode, options);
    if (!arrival) return null;
    const { level, chapter } = arrival;
    const firstOfChapter = level.id === chapter.levelRange?.[0];
    // A pending draft returns as the road's offer; its action names where the player stands.
    let arrivalPrimary = null;
    if (!arrival.fresh) arrivalPrimary = firstOfChapter ? 'Begin chapter' : 'Continue';

    if (arrival.fresh) mode.odysseyState.markArrivalSeen?.();
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
            orientation: arrival.fresh ? ODYSSEY_FIRST_ARRIVAL_NOTES : [],
            charmDraft: charmDraftFor(mode, arrival.draft),
            destinationPrefix: firstOfChapter ? 'First' : 'Next',
            arrivalEyebrow: arrival.fresh ? null : `Chapter ${chapter.id} · The road offers a charm`,
            arrivalPrimary,
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
        await mode.launchOdysseyLevel(level.id, { source: arrival.fresh ? 'first-arrival' : 'chapter-arrival' });
    }
    return choice;
}

/** The fresh journey's welcome by its older name. */
export const presentOdysseyFirstArrival = presentOdysseyArrival;
