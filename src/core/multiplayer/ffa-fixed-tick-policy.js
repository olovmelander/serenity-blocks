import { readFlag } from '../flags.js';

export function readFfaFixedTick() {
    return readFlag('fixedTick', readFlag('simTickNetcode', false));
}

export function rollbackFixedTickOnPromotion(enabled, recordEvent) {
    if (enabled === true) {
        recordEvent?.('fixed_tick_rollback', {
            reason: 'migration_missing_continuation',
        });
    }
    return false;
}

/**
 * Whether a board event may freeze a board's simulation (its hit stop). Reduced motion
 * turns that off, except under the fixed clock, where the hit stop is part of the
 * deterministic simulation every client runs.
 * @param {boolean} fixedTickEnabled
 * @returns {boolean}
 */
export function allowsSimHitStop(fixedTickEnabled) {
    if (fixedTickEnabled) return true;
    const win = typeof window !== 'undefined' ? window : null;
    const settings = win?.settingsManager ? win.settingsManager.get() : {};
    return !(settings?.reducedMotion || win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Reset projected peer time after an authoritative hard state replacement. */
export function resetFfaFixedClockProjection(game) {
    game._simTickAccumulatorMs = 0;
    game._fixedInputTimeMs = null;
    game._peerFixedInputSimTick = null;
    game._activeFixedInputStamp = null;
    game.localInputHooks?.reset?.();
}

/** Adopt an authoritative FFA clock without leaving a live loop half-switched. */
export function transitionFfaSimulationClock(game, simulationClock) {
    const fixedTickRequested = simulationClock === 'fixed60-v1';
    const fixedTickEnabled = fixedTickRequested && game.useJitterBuffer !== false;
    const normalizedClock = fixedTickEnabled ? 'fixed60-v1' : 'legacy-variable-v1';
    const changed = game._fixedTickEnabled !== fixedTickEnabled;

    if (fixedTickRequested && !fixedTickEnabled) {
        game._recordNetEvent?.('fixed_tick_rollback', {
            reason: 'jitter_buffer_required',
        });
    }

    game.matchConfig.simulationClock = normalizedClock;
    game._fixedTickEnabled = fixedTickEnabled;

    if (game.loopCallbacksConfigured) {
        game._setUnifiedLoopExternalPlayerUpdate(fixedTickEnabled);
    }

    if (changed) {
        resetFfaFixedClockProjection(game);
    }

    return changed;
}
