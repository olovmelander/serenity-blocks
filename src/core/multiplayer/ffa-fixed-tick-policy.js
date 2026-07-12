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
        game._simTickAccumulatorMs = 0;
        game._fixedInputTimeMs = null;
        game._peerFixedInputSimTick = null;
        game._activeFixedInputStamp = null;
        game.localInputHooks?.reset?.();
    }

    return changed;
}
