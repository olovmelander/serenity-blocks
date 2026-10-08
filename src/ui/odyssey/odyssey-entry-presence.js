/* eslint-disable no-await-in-loop -- A resumed entry must show a complete, visible ready cue. */
import { createJourneyFlowOverlay } from './JourneyFlowOverlay.js';
import { showRetryVeil, hideRetryVeil, clearRetryVeil } from './retry-veil.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

/** Cancel before stop/deactivation's first await, including an untimed Resume wait. */
export function cancelOdysseyEntryPresence(mode) {
    mode._odysseyEntryPresence?.dispose();
}

/**
 * Ordinary entry and retry own input/presence from preparation through the first
 * live tick. The existing portal is transparent unless the player leaves; it
 * supplies the same deliberate Resume and Map controls as an inter-orb handoff.
 */
export function createOdysseyEntryPresence(mode, level, { isCurrent = () => true, onMap = () => {} } = {}) {
    cancelOdysseyEntryPresence(mode);
    const presence = {
        modal: null,
        disposed: false,
        mapRequested: false,
        isCurrent: () => !presence.disposed && mode._odysseyEntryPresence === presence && isCurrent(),
        canProceed: () => presence.isCurrent() && !presence.mapRequested,
        dispose: () => {
            if (presence.disposed) return;
            presence.disposed = true;
            presence.modal?.dispose();
            if (mode._odysseyEntryPresence === presence) mode._odysseyEntryPresence = null;
        },
    };
    mode._odysseyEntryPresence = presence;
    mode.deps.inputController?.clearTimers?.();
    presence.modal = createJourneyFlowOverlay({
        variant: 'transit',
        nextLevel: level,
        chapter: mode.levelRegistry?.getChapter?.(level.chapter),
        autoContinue: false,
        reducedMotion: prefersOdysseyReducedMotion(mode),
        onChoose: (choice) => {
            if (choice !== 'map' || !presence.canProceed()) return;
            presence.mapRequested = true;
            presence.modal.retainCover();
            mode._clearLevelStartCue({ resolveValue: false });
            onMap();
        },
    });
    // Preparation has its own cover. Keep this input owner transparent until a
    // blur/hidden event makes its explicit Resume control necessary.
    presence.modal.dataset.revealing = 'true';
    presence.modal.inert = presence.modal.dataset.visibilityHeld !== 'true';
    document.body.appendChild(presence.modal);
    return presence;
}

/** A partly seen cue never starts gameplay; Resume always receives a fresh cue. */
export async function runOdysseyEntryReadyCue(mode, presence, isCurrent = () => true) {
    const { modal } = presence;
    const generation = mode._levelSessionGeneration;
    const { gameState } = mode;
    const ownsPrepared = () => isCurrent()
        && mode._levelSessionGeneration === generation && mode.gameState === gameState;
    while (presence.canProceed() && ownsPrepared()) {
        if (!await modal.waitUntilVisible() || !presence.canProceed() || !ownsPrepared()) return false;
        const visibilityGeneration = modal.visibilityGeneration || 0;
        const ready = await mode.showLevelStartCue(mode.currentLevelConfig, mode.gameState);
        if (!presence.canProceed() || !ownsPrepared()) return false;
        if (document.hidden || document.hasFocus?.() === false
            || modal.dataset.visibilityHeld === 'true'
            || (modal.visibilityGeneration || 0) !== visibilityGeneration) continue;
        if (!ready) return false;
        mode.deps.inputController?.clearTimers?.();
        presence.dispose();
        return mode.beginLevelRun();
    }
    return false;
}

/** Retry reuses its board/theme while preserving the same presence contract as entry. */
export async function restartOdysseyLevelInPlace(mode, failureModal = null) {
    if (!mode.currentLevelConfig) {
        console.warn('[Odyssey] Retry requested without an active level — returning to board');
        failureModal?.remove?.();
        await mode.returnToBoard();
        return;
    }
    mode._levelAttemptNumber = (Number(mode._levelAttemptNumber) || 1) + 1;
    mode.entryPhase = 'preparing';
    const presence = createOdysseyEntryPresence(mode, mode.currentLevelConfig);
    const retryGeneration = mode._levelSessionGeneration;
    try {
        await showRetryVeil();
        if (!presence.canProceed() || retryGeneration !== mode._levelSessionGeneration) return;
        failureModal?.remove?.();
        const preparation = mode.prepareLevelStart();
        const preparationGeneration = mode._levelSessionGeneration;
        const prepared = await preparation;
        if (!presence.canProceed() || preparationGeneration !== mode._levelSessionGeneration) return;
        if (!prepared) {
            clearRetryVeil();
            if (mode.isActive) await mode.returnToBoard();
            return;
        }
        const session = mode._activeLevelSession;
        await hideRetryVeil();
        if (!presence.canProceed() || !mode._isLevelSessionActive(session)) return;
        await runOdysseyEntryReadyCue(mode, presence, () => mode._isLevelSessionActive(session));
    } finally {
        if (presence.isCurrent() && presence.mapRequested && mode.isActive) {
            clearRetryVeil();
            await mode.returnToBoard({ onCovered: () => presence.dispose() });
        }
        presence.dispose();
    }
}
