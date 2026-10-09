/* eslint-disable no-await-in-loop -- A player-controlled pause must settle before the next lifecycle step. */
import { createJourneyFlowOverlay } from './JourneyFlowOverlay.js';
import { showOdysseyCampaignFinale } from './odyssey-campaign-finale.js';
import { mountOdysseyOutcome } from './odyssey-outcome-owner.js';
import { createCinematicLoadingSurface } from '../cinematic-loading-surface.js';
import { canWriteLegacySimulationResults } from '../../core/game-modes/single-player-result-compatibility.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';
import { getThemeMusic } from '../../core/progression/theme-music-catalog.js';

export {
    createOdysseyEntryPresence, cancelOdysseyEntryPresence,
    runOdysseyEntryReadyCue, restartOdysseyLevelInPlace,
} from './odyssey-entry-presence.js';
export { returnToOdysseyWorld, isOdysseyScenicJourney, isOdysseyWorldInterlude } from './odyssey-world-return.js';

/** Only a saved, unlocked successor belongs to the automatic campaign journey. */
export function getOdysseyFlowDestination(mode, session) {
    if (!session || !canWriteLegacySimulationResults(session.simulationClock)) return null;
    const next = mode.levelRegistry.getNextLevel(Number(session.levelId));
    if (!next || !mode.odysseyState.isLevelUnlocked(next.id)) return null;
    return mode.levelRegistry.resolveLevelPresentation(next.id);
}

function clearHeldInput(mode) {
    mode.deps.inputController?.clearTimers?.();
}

function prefetchDestination(mode, nextLevel) {
    if (!nextLevel) return;
    Promise.resolve(mode.transitionManager?.prefetchLevelTheme?.(nextLevel, { priority: 'high' }))
        .catch((error) => console.warn('[Odyssey] Journey prefetch failed:', error));
}

/** The song a completion unlocks is only "playing now" when the player can actually hear it. */
export function isOdysseyRewardSongAudible(mode, themeId) {
    const sound = mode.deps?.soundManager;
    const trackKey = getThemeMusic(themeId)?.trackKey;
    if (!sound || !trackKey || sound.isMuted) return false;
    if (!(Number(sound.getMusicVolume?.()) > 0)) return false;
    return sound.isTrackActuallyPlaying?.(trackKey) === true;
}

/** Recognition for a chapter left behind: its orbs and stars as the save now records them. */
export function summarizeOdysseyChapter(mode, chapterId) {
    if (!Number.isFinite(chapterId)) return null;
    const levels = mode.levelRegistry?.getLevelsInChapter?.(chapterId) || [];
    if (!levels.length) return { id: chapterId };
    const state = mode.odysseyState;
    return {
        id: chapterId,
        total: levels.length,
        completed: levels.filter((level) => state?.isLevelCompleted?.(level.id)).length,
        stars: levels.reduce((sum, level) => sum + (Number(state?.getLevelStars?.(level.id)) || 0), 0),
        maxStars: levels.length * 3,
    };
}

function mountCompletion(mode, results, session, nextLevel, autoContinue) {
    const { retirementGeneration } = session;
    const level = session.levelConfig;
    return new Promise((resolve) => {
        let settled = false;
        let releaseOutcome;
        const modal = createJourneyFlowOverlay({
            variant: 'completion',
            level,
            nextLevel,
            chapter: mode.levelRegistry.getChapter(nextLevel.chapter),
            fromChapter: level?.chapter !== nextLevel.chapter ? mode.levelRegistry.getChapter(level?.chapter) : null,
            results,
            autoContinue,
            nowPlaying: Boolean(results?.themeUnlock?.persisted)
                && isOdysseyRewardSongAudible(mode, level?.theme?.primary),
            reducedMotion: prefersOdysseyReducedMotion(mode),
            onChoose: (choice) => {
                if (settled) return;
                settled = true;
                if (choice === 'next' && mode._isLevelSessionCurrent(session, retirementGeneration)) {
                    const operation = createOperation(mode, nextLevel);
                    operation.modal = modal;
                    operation.completionSession = session;
                    releaseOutcome?.();
                } else modal.dispose();
                resolve(choice);
            },
            onAutoContinueChange: (enabled) => {
                mode.deps.settingsManager?.update?.({ odysseyAutoContinue: enabled });
                mode.deps.settingsManager?.save?.();
            },
        });
        releaseOutcome = mountOdysseyOutcome(modal, session, () => {
            if (settled) return;
            settled = true;
            resolve(false);
        });
    });
}

/** Compact success feedback; the full leaderboard sheet is an explicit detour. */
export async function showOdysseyFlowResults(mode, results, session) {
    const presentedResults = results.themeUnlock
        ? { ...results, reducedMotion: prefersOdysseyReducedMotion(mode) } : results;
    if (results.campaignCompleted) {
        const finale = await showOdysseyCampaignFinale(mode, presentedResults, session);
        if (finale !== null) return finale;
    }
    const nextLevel = getOdysseyFlowDestination(mode, session);
    if (!nextLevel) {
        const outcome = await mode._showDetailedLevelResults(presentedResults, session);
        return outcome === false ? false : 'map';
    }
    mode._cleanupOdysseyHUD();
    mode._cleanupMinimap();
    clearHeldInput(mode);
    prefetchDestination(mode, nextLevel);
    const { retirementGeneration } = session;
    let autoContinue = mode.deps.settingsManager?.get?.()?.odysseyAutoContinue !== false
        && session.isReplay !== true;
    while (mode._isLevelSessionCurrent(session, retirementGeneration)) {
        const choice = await mountCompletion(mode, presentedResults, session, nextLevel, autoContinue);
        if (!mode._isLevelSessionCurrent(session, retirementGeneration) || choice === false) return false;
        if (choice !== 'details') return choice === 'next' ? 'next' : 'map';
        const outcome = await mode._showDetailedLevelResults(presentedResults, session);
        if (outcome === false || !mode._isLevelSessionCurrent(session, retirementGeneration)) return false;
        // Reading results is a deliberate pause: never restart its automatic countdown.
        autoContinue = false;
    }
    return false;
}

function isCurrent(mode, operation) {
    return mode.isActive && mode._journeyFlowOperation === operation && !operation.cancelled;
}

function canProceed(mode, operation) {
    return isCurrent(mode, operation) && !operation.mapRequested;
}

/** The mode calls this before its first stop/deactivation await. */
export function cancelOdysseyJourneyFlow(mode) {
    const operation = mode._journeyFlowOperation;
    if (!operation) return;
    mode._journeyFlowOperation = null;
    if (mode._scenicJourneyOperation === operation) mode._scenicJourneyOperation = null;
    operation.cancelled = true;
    mode.boardController?.cancelTravel?.();
    restoreWorldCamera(operation);
    operation.modal?.dispose();
    operation.loadingSurface?.cancel();
    operation.resolveChoice?.(false);
    mode._chapterFlowActive = false;
    mode._clearLevelStartCue({ resolveValue: false });
    mode._clearGameplayRevealState();
}

function createOperation(mode, nextLevel) {
    cancelOdysseyJourneyFlow(mode);
    const operation = {
        nextLevel,
        previousLevel: mode.currentLevelConfig,
        cancelled: false,
        mapRequested: false,
        modal: null,
        loadingSurface: null,
    };
    mode._journeyFlowOperation = operation;
    clearHeldInput(mode);
    return operation;
}

function requestMap(mode, operation) {
    if (!isCurrent(mode, operation)) return;
    operation.mapRequested = true;
    mode.boardController?.cancelTravel?.();
    // Settles any visibility/fade wait without uncovering partially rebuilt gameplay.
    operation.modal.retainCover();
    mode._clearLevelStartCue({ resolveValue: false });
    if (['world-entry', 'chapter-entry'].includes(operation.phase)) {
        mode.journeyEntryTransition?.abort?.('map-requested');
    }
}

function holdWorldCamera(mode, operation) {
    const camera = mode.boardController?.cameraController;
    if (!camera?.config || operation.worldCamera === camera) return;
    restoreWorldCamera(operation);
    operation.worldCamera = camera;
    operation.idleAutoDrift = camera.config.idleAutoDrift;
    camera.config.idleAutoDrift = false;
}

function restoreWorldCamera(operation) {
    if (!operation.worldCamera) return;
    operation.worldCamera.config.idleAutoDrift = operation.idleAutoDrift;
    operation.worldCamera = null;
}

function restoreWorldControls(mode, operation, restoreAudio) {
    mode.isEnteringLevel = false;
    mode._scenicJourneyOperation = null;
    mode._unlockOdysseyBoardAfterLaunchAttempt();
    mode._setBoardOverlaySuppressed?.(false);
    mode.setOdysseyNavigatorButtonVisible(true);
    mode._updateLevelPreview(operation.nextLevel.id);
    mode._restoreInputs?.();
    if (restoreAudio) {
        // Music can settle in its own owner while the map is immediately usable.
        Promise.resolve(mode._applyBoardAudioPolicy?.({ restoreTrack: true }))
            .catch((error) => console.warn('[Odyssey] Map music restore failed:', error));
        mode._restoreTransitionMusicDuck?.(250);
    }
}

function createTransitOverlay(mode, operation) {
    const onChoose = (choice) => {
        if (choice === 'map') requestMap(mode, operation);
    };
    if (operation.modal) {
        operation.modal.beginTransit({ onChoose });
        return operation.modal;
    }
    const modal = createJourneyFlowOverlay({
        variant: 'transit',
        level: mode.currentLevelConfig,
        nextLevel: operation.nextLevel,
        chapter: mode.levelRegistry.getChapter(operation.nextLevel.chapter),
        autoContinue: false,
        reducedMotion: prefersOdysseyReducedMotion(mode),
        onChoose,
    });
    operation.modal = modal;
    document.body.appendChild(modal);
    return modal;
}

/** Keep presence ownership until the prepared session receives its first live tick. */
export async function runOdysseyFlowReadyCue(mode, operation, session = mode._activeLevelSession) {
    const { modal, nextLevel } = operation;
    while (canProceed(mode, operation) && mode._isLevelSessionActive(session)) {
        if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
        if (!mode._isLevelSessionActive(session)) return false;
        const visibilityGeneration = modal.visibilityGeneration || 0;
        const cueComplete = await mode.showLevelStartCue(nextLevel, session.gameState);
        if (!cueComplete || !canProceed(mode, operation) || !mode._isLevelSessionActive(session)) return false;
        if (document.hidden || document.hasFocus?.() === false
            || modal.dataset?.visibilityHeld === 'true'
            || (modal.visibilityGeneration || 0) !== visibilityGeneration) {
            // A cue seen only partly is not a fair handoff. Resume always gets a fresh one.
            continue;
        }
        clearHeldInput(mode);
        modal.dispose();
        mode._clearGameplayRevealState();
        return mode.beginLevelRun();
    }
    return false;
}

async function continueWithinChapter(mode, operation) {
    const { nextLevel } = operation;
    const modal = createTransitOverlay(mode, operation);
    const reducedMotion = prefersOdysseyReducedMotion(mode);
    operation.phase = 'world-return';
    modal.setScenic('emerging');
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    const returned = await mode.returnToBoard({
        preserveJourneyFlow: operation,
        scenicJourney: true,
        focusLevelId: operation.previousLevel?.id,
        onWorldReady: () => {
            if (canProceed(mode, operation)) holdWorldCamera(mode, operation);
        },
    });
    operation.worldReady = mode.isInBoardView && mode.currentLevelId === null && !!mode.boardController;
    if (!canProceed(mode, operation)) return false;
    if (!returned) throw new Error('The journey world could not be revealed');
    holdWorldCamera(mode, operation);
    mode._lockOdysseyBoardForLaunch();
    mode._setBoardOverlaySuppressed?.(true);
    mode._updateLevelPreview(null);
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    operation.phase = 'world-travel';
    modal.setScenic('travel');
    // Reduced motion retains a stable world view. Move to the destination only
    // beneath an opaque cover so a zero-duration seek cannot become a visible jump.
    if (reducedMotion && (!await modal.cover() || !canProceed(mode, operation))) return false;
    const traveled = await mode.boardController.travelToLevel(nextLevel.id, {
        pathTravel: true,
        travelDuration: reducedMotion ? 0 : 1500,
        focus: false,
        isCurrent: () => canProceed(mode, operation),
        isPaused: () => modal.dataset.visibilityHeld === 'true' || document.hidden,
    });
    if (!canProceed(mode, operation)) return false;
    if (!traveled) throw new Error('The next orb could not be reached');
    mode.selectedLevelId = nextLevel.id;
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    operation.phase = 'world-entry';
    modal.setScenic('entering');
    return launchJourneyDestination(mode, operation, 'journey-flow');
}

/** Loading lease and visible handoff are shared by orb and chapter entry. */
async function launchJourneyDestination(mode, operation, source) {
    const { modal, nextLevel } = operation;
    const launched = await mode.launchOdysseyLevel(nextLevel.id, {
        source,
        isCurrent: () => canProceed(mode, operation),
        onBlackoutReached: async () => {
            if (!canProceed(mode, operation)) return false;
            operation.loadingSurface = createCinematicLoadingSurface(mode.deps.themeManager);
            await operation.loadingSurface.ready;
            return canProceed(mode, operation);
        },
        onRevealStart: () => {
            if (!canProceed(mode, operation)) return false;
            operation.loadingSurface?.uncover();
            // The board reveal has its own readiness gate. Fade the retained
            // briefing alongside it, then await both before any Ready/live tick.
            operation.revealPromise = modal.reveal();
            return true;
        },
        beginPreparedRun: async () => {
            if (!canProceed(mode, operation)) return false;
            const session = mode._activeLevelSession;
            if (!await operation.revealPromise || !canProceed(mode, operation)) return false;
            return runOdysseyFlowReadyCue(mode, operation, session);
        },
    });
    operation.mapAlreadyRestored = !launched && mode.isInBoardView
        && mode.currentLevelId === null && !!mode.boardController;
    return launched;
}

async function continueAcrossChapter(mode, operation) {
    const { nextLevel } = operation;
    const modal = createTransitOverlay(mode, operation);
    const reducedMotion = prefersOdysseyReducedMotion(mode);
    mode._chapterFlowActive = true;
    operation.phase = 'chapter-return';
    modal.setScenic('emerging');
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    // onStop preserves only this exact operation during its own map return.
    const returned = await mode.returnToBoard({
        preserveJourneyFlow: operation,
        settlePath: true,
        onWorldReady: () => {
            if (canProceed(mode, operation)) holdWorldCamera(mode, operation);
        },
    });
    operation.worldReady = mode.isInBoardView && mode.currentLevelId === null && !!mode.boardController;
    operation.worldAudioRestored = true;
    if (!canProceed(mode, operation)) return false;
    if (!returned) throw new Error('The chapter map could not be revealed');
    holdWorldCamera(mode, operation);
    mode._lockOdysseyBoardForLaunch();
    mode._setBoardOverlaySuppressed?.(true);
    mode._updateLevelPreview(null);
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    operation.phase = 'chapter-travel';
    modal.setScenic('travel');
    if (reducedMotion && (!await modal.cover() || !canProceed(mode, operation))) return false;
    const traveled = await mode.boardController?.travelToLevel?.(nextLevel.id, {
        chapterArrival: true,
        travelDuration: reducedMotion ? 0 : 2200,
        focusDuration: reducedMotion ? 0 : 450,
        focus: false,
        isCurrent: () => canProceed(mode, operation),
        isPaused: () => modal.dataset.visibilityHeld === 'true' || document.hidden,
    });
    if (!canProceed(mode, operation)) return false;
    if (traveled === false) throw new Error('The next chapter could not be reached');
    mode.selectedLevelId = nextLevel.id;
    mode._updateLevelPreview(null);
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    operation.phase = 'chapter-reading';
    const completedChapter = summarizeOdysseyChapter(mode, operation.previousLevel?.chapter);
    const choice = await new Promise((resolve) => {
        operation.resolveChoice = resolve;
        modal.showChapter({ onChoose: resolve, completedChapter });
    });
    if (!canProceed(mode, operation)) return false;
    if (choice !== 'next') {
        mode._chapterFlowActive = false;
        restoreWorldControls(mode, operation, false);
        return true;
    }
    operation.phase = 'chapter-entry';
    modal.beginTransit({ onChoose: (selected) => { if (selected === 'map') requestMap(mode, operation); } });
    modal.setScenic('entering');
    if (!await modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    mode._chapterFlowActive = false;
    return launchJourneyDestination(mode, operation, 'chapter-flow');
}

/** Automatic world travel between orbs, or one deliberate chapter arrival. */
export async function continueOdysseyJourney(mode, nextLevel, { chapterBreak } = {}) {
    if (!mode.isActive || !nextLevel || !mode.odysseyState.isLevelUnlocked(nextLevel.id)) return false;
    const changesChapter = chapterBreak ?? (mode.currentLevelConfig?.chapter !== nextLevel.chapter);
    const retained = mode._journeyFlowOperation;
    const operation = retained && !retained.cancelled
        && retained.completionSession === mode._activeLevelSession && retained.nextLevel.id === nextLevel.id
        ? retained : createOperation(mode, nextLevel);
    let recover = false;
    try {
        const succeeded = await (changesChapter
            ? continueAcrossChapter(mode, operation)
            : continueWithinChapter(mode, operation));
        if (!succeeded && canProceed(mode, operation)) recover = true;
        return succeeded;
    } catch (error) {
        if (isCurrent(mode, operation)) {
            console.warn('[Odyssey] Journey handoff failed; returning to map:', error);
            recover = true;
        }
        return false;
    } finally {
        const current = isCurrent(mode, operation);
        operation.loadingSurface?.cancel();
        restoreWorldCamera(operation);
        if (mode._scenicJourneyOperation === operation) mode._scenicJourneyOperation = null;
        if (current) {
            mode._chapterFlowActive = false;
            mode.isEnteringLevel = false;
            const residentWorld = operation.worldReady && !['world-entry', 'chapter-entry'].includes(operation.phase);
            if ((recover || operation.mapRequested) && (residentWorld || operation.mapAlreadyRestored)) {
                restoreWorldControls(mode, operation, residentWorld && !operation.worldAudioRestored);
                operation.modal?.dispose();
                mode._journeyFlowOperation = null;
            } else if ((recover || operation.mapRequested) && !operation.mapAlreadyRestored) {
                operation.modal?.retainCover();
                try {
                    await mode.returnToBoard({
                        focusLevelId: nextLevel.id,
                        onCovered: () => operation.modal?.dispose(),
                    });
                } finally {
                    operation.modal?.dispose();
                    if (mode._journeyFlowOperation === operation) mode._journeyFlowOperation = null;
                }
            } else {
                operation.modal?.dispose();
                mode._journeyFlowOperation = null;
            }
        } else operation.modal?.dispose();
    }
}
