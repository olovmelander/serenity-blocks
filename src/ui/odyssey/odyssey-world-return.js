import { JourneyReturnTransition } from '../../rendering/transitions/JourneyReturnTransition.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

/** The retained world is scenery only while its exact campaign operation owns it. */
export function isOdysseyScenicJourney(mode) {
    const operation = mode._scenicJourneyOperation;
    return Boolean(operation && operation === mode._journeyFlowOperation
        && !operation.cancelled && !operation.mapRequested);
}

/** Return presentation stays in UI; the mode retains simulation/session ownership. */
export async function returnToOdysseyWorld(mode, options = {}) {
    console.log('[Odyssey] Returning to board view...');
    mode._perfMark('odyssey-return-start');
    const operation = {};
    mode._boardReturnOperation = operation;
    const scenicOwner = options.scenicJourney && options.preserveJourneyFlow === mode._journeyFlowOperation
        ? options.preserveJourneyFlow : null;
    mode._scenicJourneyOperation = scenicOwner;
    const ownsReturn = () => mode._boardReturnOperation === operation;
    const isCurrent = () => ownsReturn() && (!scenicOwner || isOdysseyScenicJourney(mode));
    if (scenicOwner) {
        mode._lockOdysseyBoardForLaunch();
        mode._setBoardOverlaySuppressed(true);
    }
    const completedLevelId = options.focusLevelId ?? mode.currentLevelId;
    const completedLevelConfig = mode.currentLevelConfig;
    const departureAnchor = mode._resolveJourneyReturnDepartureAnchor();
    const palette = mode._buildJourneyEntryPalette(completedLevelConfig);
    const timings = mode._buildJourneyReturnTimings(completedLevelConfig);
    const qualityPreset = window.settings?.effectQuality || 'High';
    const session = mode._retireLevelSession();
    const retirementGeneration = session?.retirementGeneration;
    if (session?.gameState?.latestPhysicsPromise) {
        await mode._drainLevelSession(session);
    }
    if (!isCurrent() || (session && !mode._isLevelSessionCurrent(session, retirementGeneration))) return false;

    mode.entryPhase = 'idle';
    mode.themeRevealToken += 1;
    mode.pendingThemeFullReadyPromise = null;
    mode._clearNeutralThemeFallbackBackdrop({ immediate: true });
    mode._clearLevelThemePrefetchTimer();
    mode._clearGameplayRevealState();
    mode._clearLevelStartCue({ resolveValue: false });
    mode._clearBoardReturnFallbackVeil({ immediate: true });

    if (!mode.journeyReturnTransition) {
        mode.journeyReturnTransition = new JourneyReturnTransition();
    }

    const transitionResult = await mode.journeyReturnTransition.play({
        departureAnchor,
        arrivalAnchor: {
            x: 0.5, y: 0.5, radius: 0.14, onScreen: true,
        },
        palette,
        timings,
        qualityPreset,
        reducedMotion: prefersOdysseyReducedMotion(mode, mode.deps.settingsManager?.get?.() || {}),
        callbacks: {
            onBlackoutReached: async () => {
                if (!isCurrent()) return false;
                mode._hideGameplaySurfaceForBoardReturn();
                options.onCovered?.();
                mode.deps?.themeManager?.suspendThemes?.();

                await mode.onStop(options);
                if (!isCurrent()) return false;

                mode.currentLevelId = null;
                mode.currentLevelConfig = null;
                mode.gameState = null;
                mode.isInBoardView = true;

                if (!scenicOwner) await mode._applyBoardAudioPolicy({ restoreTrack: true });
                if (!isCurrent()) return false;
                const shown = await mode._showBoardView({
                    showLoadingOverlay: false,
                    minOverlayDisplayMs: 0,
                    focusLevelId: completedLevelId,
                    keepBoardLocked: true,
                });
                if (shown === false || !isCurrent()) return false;
                if (await options.onWorldReady?.() === false || !isCurrent()) return false;
                // Phase 0 metric: how long the board took to become ready on return.
                // Parked (kept-alive) = a few hundred ms; full rebuild = ~3.5-4.2s.
                mode._perfMeasure('odyssey-return-board-ready', 'odyssey-return-start');

                return {
                    arrivalAnchor: mode._resolveJourneyReturnArrivalAnchor(completedLevelId),
                };
            },
            onRevealStart: async () => {
                if (!isCurrent()) return false;
                if (!options.preserveJourneyFlow || options.preserveJourneyFlow !== mode._journeyFlowOperation) {
                    mode._unlockOdysseyBoardAfterLaunchAttempt();
                    mode.setOdysseyNavigatorButtonVisible(true);
                }
                return true;
            },
            onComplete: async () => {
                if (!isCurrent()) return;
                mode.entryPhase = 'idle';
                mode._clearBoardReturnFallbackVeil({ immediate: true });
                if (!scenicOwner) mode._restoreInputs();
            },
            onAbort: async (abortResult) => {
                if (!isCurrent()) return;
                console.warn(
                    '[Odyssey] Journey return aborted:',
                    abortResult?.reason || 'unknown',
                    abortResult?.error || '',
                );
                mode.entryPhase = 'idle';
                // Fallback intentionally ends the journey in onStop. Its map
                // recovery remains owned by this return until exit/replacement.
                await mode._fallbackToBoardAfterReturnAbort(completedLevelId, ownsReturn);
                if (ownsReturn()) mode._restoreInputs();
            },
        },
    });

    const succeeded = isCurrent() && !!transitionResult?.success;
    if (mode._boardReturnOperation === operation) mode._boardReturnOperation = null;
    return succeeded;
}
