/**
 * The ONE DAS engine (plan §5.4) — pure, per-player, config-explicit.
 *
 * Extracted from the two drifting clones:
 * - keyboard: InputController.processDasDirection/processSoftDrop
 *   (src/ui/controls.js — reads window.settings LIVE each frame)
 * - gamepad: GamepadController.processDasTimers
 *   (src/ui/gamepad-controller.js — caches config with explicit updates)
 *
 * The algorithm here is the shared semantics of both, verbatim:
 * - hold accumulates delayAccumulator; the first auto-repeat fires exactly at
 *   the dasDelay threshold, with the overshoot carried into the interval
 *   accumulator (a lag spike can fire several catch-up repeats immediately);
 * - repeats then fire once per dasInterval on a subtract-loop (no drift);
 * - interval <= 0 means "instant DAS": up to `instantLimit` repeats per
 *   advance, stopping early when the action reports it can't move
 *   (action() === false — wall contact);
 * - soft drop has no delay phase, only the interval loop.
 *
 * Config is an explicit parameter (plan decision: cache + explicit update
 * wins; live global reads violate the §3d core boundary). State is a plain
 * object so it can be keyed per-player into each GameState (the singleton's
 * p2_* slots belong to a different player's board) and serialized into the
 * §5.7 match artifact. Deltas are the caller's clock — under §5.3 this
 * becomes integer ticks × simTickMs without touching this module.
 *
 * Ships dark: nothing imports this yet. Wiring replaces the two clones in a
 * later slice; the differential table tests pin engine ≡ live-keyboard-clone
 * semantics until then.
 */

/** @returns {{active: boolean, delayAccumulator: number, intervalAccumulator: number, isRepeating: boolean}} */
export function createDasDirectionState() {
    return {
        active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false,
    };
}

/** @returns {{active: boolean, intervalAccumulator: number}} */
export function createSoftDropState() {
    return { active: false, intervalAccumulator: 0 };
}

/** Begin a hold (key/pad edge down). Resets all accumulators. */
export function startDas(state) {
    state.active = true;
    state.delayAccumulator = 0;
    state.intervalAccumulator = 0;
    state.isRepeating = false;
}

/** End a hold (key/pad edge up). */
export function stopDas(state) {
    state.active = false;
}

/**
 * Clear timers without ending the hold intent — the pause/resume/visibility
 * semantics the four legacy call sites rely on (no burst on resume).
 */
export function clearDasTimers(state) {
    state.delayAccumulator = 0;
    state.intervalAccumulator = 0;
    state.isRepeating = false;
}

/**
 * Advance one held direction by deltaMs.
 * @param {ReturnType<typeof createDasDirectionState>} state
 * @param {number} deltaMs - elapsed time (caller-clamped, like the legacy 100ms cap)
 * @param {{dasDelay: number, dasInterval: number, instantLimit: number}} config
 * @param {() => (boolean|void)} action - performs one move; `false` = blocked
 * @returns {number} how many times action fired
 */
export function advanceDas(state, deltaMs, config, action) {
    if (!state.active) return 0;
    const { dasDelay, dasInterval, instantLimit } = config;
    let fired = 0;
    const act = () => { fired += 1; return action(); };

    const runInstantRepeat = () => {
        for (let i = 0; i < instantLimit; i += 1) {
            if (act() === false) break;
        }
        state.intervalAccumulator = 0;
    };

    if (!state.isRepeating) {
        state.delayAccumulator += deltaMs;
        if (state.delayAccumulator >= dasDelay) {
            state.isRepeating = true;
            // First repeat exactly at the delay threshold; overshoot carries.
            state.intervalAccumulator = state.delayAccumulator - dasDelay;

            if (dasInterval <= 0) {
                runInstantRepeat();
                return fired;
            }

            act();

            // Massive lag spike: execute the owed catch-up repeats now.
            while (state.intervalAccumulator >= dasInterval) {
                state.intervalAccumulator -= dasInterval;
                act();
            }
        }
    } else {
        if (dasInterval <= 0) {
            runInstantRepeat();
            return fired;
        }

        state.intervalAccumulator += deltaMs;
        while (state.intervalAccumulator >= dasInterval) {
            state.intervalAccumulator -= dasInterval;
            act();
        }
    }
    return fired;
}

/**
 * Advance a held soft drop by deltaMs (no delay phase).
 * @param {ReturnType<typeof createSoftDropState>} state
 * @param {number} deltaMs
 * @param {{softDropInterval: number, instantLimit: number}} config
 * @param {() => (boolean|void)} action
 * @returns {number} how many times action fired
 */
export function advanceSoftDrop(state, deltaMs, config, action) {
    if (!state.active) return 0;
    const { softDropInterval, instantLimit } = config;
    let fired = 0;
    const act = () => { fired += 1; return action(); };

    if (softDropInterval <= 0) {
        for (let i = 0; i < instantLimit; i += 1) {
            if (act() === false) break;
        }
        state.intervalAccumulator = 0;
        return fired;
    }
    state.intervalAccumulator += deltaMs;
    while (state.intervalAccumulator >= softDropInterval) {
        state.intervalAccumulator -= softDropInterval;
        act();
    }
    return fired;
}
