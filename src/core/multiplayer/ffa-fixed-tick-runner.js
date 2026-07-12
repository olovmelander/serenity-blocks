import {
    FIXED_TICK_MAX_DEBT_MS,
    FIXED_TICK_MS,
    planFixedTicks,
} from '../fixed-tick-clock.js';
import {
    createFfaFixedInputAdapter,
    finishFfaFixedBufferedInputs,
    takeFfaFixedBufferedInputs,
} from './ffa-fixed-input-adapter.js';
import { drainFfaInputBatches } from './ffa-input-batching.js';

function roundMilliseconds(value) {
    return Math.round(value * 1000) / 1000;
}

function fixedTickOwnershipContinues(game) {
    const phaseContinues = game.gamePhase === undefined || game.gamePhase === 'playing';
    const clockContinues = game._fixedTickEnabled === undefined || game._fixedTickEnabled === true;
    return phaseContinues && clockContinues;
}

/** Run the default-off canonical clock for one FFA render update. */
export function runFfaFixedTicks(game, frameDelta, currentTime, wallTime = 0) {
    if (!game?.unifiedLoop) return 0;
    if (game.useJitterBuffer === false) {
        game._recordNetEvent?.('fixed_tick_rollback', {
            reason: 'jitter_buffer_required',
        });
        game._transitionSimulationClock?.('legacy-variable-v1');
        return 0;
    }

    const configuredTickMs = Number(game.SIM_TICK_MS);
    const tickMs = Number.isFinite(configuredTickMs) && configuredTickMs > 0
        ? configuredTickMs
        : FIXED_TICK_MS;
    const tickPlan = planFixedTicks(game._simTickAccumulatorMs, frameDelta, {
        tickMs,
        maxSteps: game.MAX_SIM_STEPS_PER_FRAME,
        maxDebtMs: FIXED_TICK_MAX_DEBT_MS,
        maxCarryTicks: FIXED_TICK_MAX_DEBT_MS / tickMs,
    });
    game._simTickAccumulatorMs = tickPlan.accumulatedMs;
    if (tickPlan.debtWasClamped) {
        game._recordNetEvent?.('sim_clock_warp', {
            requestedDebtMs: roundMilliseconds(tickPlan.requestedAccumulatedMs),
            retainedDebtMs: roundMilliseconds(tickPlan.accumulatedMs),
            warpedMs: roundMilliseconds(tickPlan.warpedMs),
            maxDebtMs: tickPlan.maxDebtMs,
            maxSteps: tickPlan.maxSteps,
            tickMs: roundMilliseconds(tickPlan.tickMs),
        });
    }
    if (!Number.isFinite(game._fixedInputTimeMs)) {
        const frameTime = Number(currentTime);
        game._fixedInputTimeMs = Number.isFinite(frameTime)
            ? frameTime - (tickPlan.steps * tickPlan.tickMs)
            : 0;
    }

    let executedSteps = 0;
    for (let step = 0; step < tickPlan.steps; step += 1) {
        let bufferedInputs = null;
        let tickStarted = false;
        let peerInputSimTick = null;
        try {
            if (game.isHost) {
                drainFfaInputBatches(game);
                bufferedInputs = takeFfaFixedBufferedInputs(game);
            }
            tickStarted = true;
            if (game.isHost) {
                game.simTick = (Number(game.simTick) || 0) + 1;
            } else {
                const authoritativeTick = Math.max(0, Math.floor(Number(game.simTick) || 0));
                const projectedTick = Number.isInteger(game._peerFixedInputSimTick)
                    ? game._peerFixedInputSimTick
                    : authoritativeTick;
                peerInputSimTick = Math.max(authoritativeTick, projectedTick) + 1;
                game._peerFixedInputSimTick = peerInputSimTick;
            }
            game.unifiedLoop.updatePlayersFixedTick(createFfaFixedInputAdapter(game, {
                bufferedInputs,
                peerInputSimTick,
            }));
        } finally {
            try {
                if (game.isHost && tickStarted) {
                    // Advance after local held ingress so commands produced on this
                    // canonical tick use the current jitter slot, matching the legacy
                    // held-before-buffer ordering and the configured buffer depth.
                    finishFfaFixedBufferedInputs(game, bufferedInputs);
                }
            } finally {
                if (tickStarted) {
                    // A partially applied multi-board tick is unsafe to replay. Count it
                    // before propagating so the sim clock and jitter cursor stay aligned.
                    game._simTickAccumulatorMs -= tickPlan.tickMs;
                }
            }
        }
        executedSteps += 1;
        if (game.isHost) {
            game.updateAllPlayers();
            game.attackRouter?.updateHotPotato?.(wallTime);
        }
        if (!fixedTickOwnershipContinues(game)) break;
    }

    if (executedSteps === tickPlan.steps) game._simTickAccumulatorMs = tickPlan.remainderMs;
    return executedSteps;
}
