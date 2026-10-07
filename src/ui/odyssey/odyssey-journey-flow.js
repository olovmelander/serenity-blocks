/* eslint-disable no-await-in-loop -- A player-controlled pause must settle before the next lifecycle step. */
import { createJourneyFlowOverlay } from './JourneyFlowOverlay.js';
import { mountOdysseyOutcome } from './odyssey-outcome-owner.js';
import { createCinematicLoadingSurface } from '../cinematic-loading-surface.js';
import { canWriteLegacySimulationResults } from '../../core/game-modes/single-player-result-compatibility.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

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

function mountCompletion(mode, results, session, nextLevel, autoContinue) {
    return new Promise((resolve) => {
        let settled = false;
        const modal = createJourneyFlowOverlay({
            variant: 'completion',
            level: session.levelConfig,
            nextLevel,
            chapter: mode.levelRegistry.getChapter(nextLevel.chapter),
            results,
            autoContinue,
            reducedMotion: prefersOdysseyReducedMotion(mode),
            onChoose: (choice) => {
                if (settled) return;
                settled = true;
                modal.dispose();
                resolve(choice);
            },
            onAutoContinueChange: (enabled) => {
                mode.deps.settingsManager?.update?.({ odysseyAutoContinue: enabled });
                mode.deps.settingsManager?.save?.();
            },
        });
        mountOdysseyOutcome(modal, session, () => {
            if (settled) return;
            settled = true;
            resolve(false);
        });
    });
}

/** Compact success feedback; the full leaderboard sheet is an explicit detour. */
export async function showOdysseyFlowResults(mode, results, session) {
    const nextLevel = getOdysseyFlowDestination(mode, session);
    if (!nextLevel) {
        const outcome = await mode._showDetailedLevelResults(results, session);
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
        const choice = await mountCompletion(mode, results, session, nextLevel, autoContinue);
        if (!mode._isLevelSessionCurrent(session, retirementGeneration) || choice === false) return false;
        if (choice !== 'details') return choice === 'next' ? 'next' : 'map';
        const outcome = await mode._showDetailedLevelResults(results, session);
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
    operation.cancelled = true;
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
        nextLevel, cancelled: false, mapRequested: false, modal: null, loadingSurface: null,
    };
    mode._journeyFlowOperation = operation;
    clearHeldInput(mode);
    return operation;
}

function requestMap(mode, operation) {
    if (!isCurrent(mode, operation)) return;
    operation.mapRequested = true;
    // Settles any visibility/fade wait without uncovering partially rebuilt gameplay.
    operation.modal.retainCover();
    mode._clearLevelStartCue({ resolveValue: false });
}

function createTransitOverlay(mode, operation) {
    const modal = createJourneyFlowOverlay({
        variant: 'transit',
        level: mode.currentLevelConfig,
        nextLevel: operation.nextLevel,
        chapter: mode.levelRegistry.getChapter(operation.nextLevel.chapter),
        autoContinue: false,
        reducedMotion: prefersOdysseyReducedMotion(mode),
        onChoose: (choice) => {
            if (choice === 'map') requestMap(mode, operation);
        },
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
    mode.isEnteringLevel = true;
    mode.entryPhase = 'preparing';
    mode._cancelBoardParkTimer();
    mode._hideGoalCompleteOverlay();
    mode._removeVictoryLapInputs();
    mode._clearLevelStartCue({ resolveValue: false });
    mode._clearGameplayRevealState();
    const entryToken = ++mode.themeRevealToken;
    if (!await modal.cover() || !canProceed(mode, operation)) return false;

    operation.loadingSurface = createCinematicLoadingSurface(mode.deps.themeManager);
    await operation.loadingSurface.ready;
    if (!canProceed(mode, operation)) return false;
    mode.currentLevelId = nextLevel.id;
    mode.currentLevelConfig = nextLevel;
    mode.selectedLevelId = nextLevel.id;
    mode._levelAttemptNumber = 1;
    await mode._prepareGameplayReveal();
    if (!canProceed(mode, operation)) return false;
    // Wait for both even on rejection: recovery must not race a late theme activation.
    const prepared = await Promise.allSettled([
        mode._activateLevelThemeVisuals(nextLevel, { isCurrent: () => canProceed(mode, operation) }),
        mode.prepareLevelStart(),
    ]);
    if (!canProceed(mode, operation)) return false;
    if (prepared.some((result) => result.status === 'rejected' || result.value === false)) {
        throw new Error('The next orb could not be prepared');
    }
    const session = mode._activeLevelSession;
    const ready = await mode._waitForEntryRevealReadiness(nextLevel, entryToken);
    if (!canProceed(mode, operation)) return false;
    if (!ready || !mode._isLevelSessionActive(session)) throw new Error('The next orb did not become ready');

    mode.entryPhase = 'revealing';
    mode._playJourneyTransitionCue('arrival');
    const reveal = mode._beginGameplayReveal({ fastReveal: true });
    operation.loadingSurface.uncover();
    if (!await modal.reveal() || !canProceed(mode, operation)) return false;
    if (!await reveal.playablePromise || !canProceed(mode, operation)) return false;
    return runOdysseyFlowReadyCue(mode, operation, session);
}

async function continueAcrossChapter(mode, operation) {
    const { nextLevel } = operation;
    mode._chapterFlowActive = true;
    // onStop preserves only this exact operation during its own map return.
    const returned = await mode.returnToBoard({ preserveJourneyFlow: operation });
    if (!canProceed(mode, operation)) return false;
    if (!returned) throw new Error('The chapter map could not be revealed');
    mode._lockOdysseyBoardForLaunch();
    mode._updateLevelPreview(null);
    const reducedMotion = prefersOdysseyReducedMotion(mode);
    const traveled = await mode.boardController?.travelToLevel?.(nextLevel.id, {
        travelDuration: reducedMotion ? 0 : 2200,
        focusDuration: reducedMotion ? 0 : 450,
    });
    if (!canProceed(mode, operation)) return false;
    if (traveled === false) throw new Error('The next chapter could not be reached');
    mode.selectedLevelId = nextLevel.id;
    mode._updateLevelPreview(null);
    const choice = await new Promise((resolve) => {
        operation.resolveChoice = resolve;
        const modal = createJourneyFlowOverlay({
            variant: 'chapter',
            nextLevel,
            chapter: mode.levelRegistry.getChapter(nextLevel.chapter),
            autoContinue: false,
            reducedMotion,
            onChoose: (selected) => {
                if (operation.phase === 'chapter-entry') {
                    if (selected === 'map') requestMap(mode, operation);
                } else resolve(selected);
            },
        });
        operation.modal = modal;
        document.body.appendChild(modal);
    });
    if (!canProceed(mode, operation)) return false;
    if (choice !== 'next') {
        mode._unlockOdysseyBoardAfterLaunchAttempt();
        mode.setOdysseyNavigatorButtonVisible(true);
        mode._updateLevelPreview(nextLevel.id);
        return true;
    }
    operation.phase = 'chapter-entry';
    operation.modal.beginTransit();
    if (!await operation.modal.waitUntilVisible() || !canProceed(mode, operation)) return false;
    mode._chapterFlowActive = false;
    const launched = await mode.launchOdysseyLevel(nextLevel.id, {
        source: 'chapter-flow',
        isCurrent: () => canProceed(mode, operation),
        beginPreparedRun: async () => {
            if (!canProceed(mode, operation)) return false;
            const session = mode._activeLevelSession;
            if (!await operation.modal.reveal() || !canProceed(mode, operation)) return false;
            return runOdysseyFlowReadyCue(mode, operation, session);
        },
    });
    if (!isCurrent(mode, operation)) return false;
    // The ordinary launcher's abort path already restores its resident map.
    // Do not play a second return portal over that completed recovery.
    operation.mapAlreadyRestored = !launched && mode.isInBoardView
        && mode.currentLevelId === null && !!mode.boardController;
    return launched;
}

/** Direct orb handoff, or one deliberate chapter arrival with no second selection step. */
export async function continueOdysseyJourney(mode, nextLevel, { chapterBreak } = {}) {
    if (!mode.isActive || !nextLevel || !mode.odysseyState.isLevelUnlocked(nextLevel.id)) return false;
    const changesChapter = chapterBreak ?? (mode.currentLevelConfig?.chapter !== nextLevel.chapter);
    const operation = createOperation(mode, nextLevel);
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
        if (current) {
            mode._chapterFlowActive = false;
            mode.isEnteringLevel = false;
            if ((recover || operation.mapRequested) && !operation.mapAlreadyRestored) {
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
