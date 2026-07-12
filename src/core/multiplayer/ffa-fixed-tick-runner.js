import { planFixedTicks } from '../fixed-tick-clock.js';
import {
    createFfaFixedInputAdapter,
    finishFfaFixedBufferedInputs,
    takeFfaFixedBufferedInputs,
} from './ffa-fixed-input-adapter.js';
import { drainFfaInputBatches } from './ffa-input-batching.js';

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

    const tickPlan = planFixedTicks(game._simTickAccumulatorMs, frameDelta, {
        tickMs: game.SIM_TICK_MS,
        maxSteps: game.MAX_SIM_STEPS_PER_FRAME,
        maxElapsedMs: 250,
        maxCarryTicks: 1,
    });
    game._simTickAccumulatorMs = tickPlan.accumulatedMs;
    if (!Number.isFinite(game._fixedInputTimeMs)) {
        const frameTime = Number(currentTime);
        game._fixedInputTimeMs = Number.isFinite(frameTime)
            ? frameTime - (tickPlan.steps * tickPlan.tickMs)
            : 0;
    }

    for (let step = 0; step < tickPlan.steps; step += 1) {
        let bufferedInputs = null;
        if (game.isHost) {
            game.simTick = (Number(game.simTick) || 0) + 1;
            drainFfaInputBatches(game);
            bufferedInputs = takeFfaFixedBufferedInputs(game);
        }
        let peerInputSimTick = null;
        if (!game.isHost) {
            const authoritativeTick = Math.max(0, Math.floor(Number(game.simTick) || 0));
            const projectedTick = Number.isInteger(game._peerFixedInputSimTick)
                ? game._peerFixedInputSimTick
                : authoritativeTick;
            peerInputSimTick = Math.max(authoritativeTick, projectedTick) + 1;
            game._peerFixedInputSimTick = peerInputSimTick;
        }
        try {
            game.unifiedLoop.updatePlayersFixedTick(createFfaFixedInputAdapter(game, {
                bufferedInputs,
                peerInputSimTick,
            }));
        } finally {
            if (game.isHost) {
                // Advance after local held ingress so commands produced on this
                // canonical tick use the current jitter slot, matching the legacy
                // held-before-buffer ordering and the configured buffer depth.
                finishFfaFixedBufferedInputs(game, bufferedInputs);
            }
            // A partially applied multi-board tick is unsafe to replay. Count it
            // before propagating so the sim clock and jitter cursor stay aligned.
            game._simTickAccumulatorMs -= tickPlan.tickMs;
        }
        if (game.isHost) {
            game.updateAllPlayers();
            game.attackRouter?.updateHotPotato?.(wallTime);
        }
    }

    game._simTickAccumulatorMs = tickPlan.remainderBeforeCarryCapMs;
    if (tickPlan.overflowed) {
        game._recordNetEvent?.('sim_tick_clamped', {
            accumulatorMs: Math.round(game._simTickAccumulatorMs),
            maxSteps: tickPlan.maxSteps,
            tickMs: Math.round(tickPlan.tickMs * 1000) / 1000,
        });
    }
    game._simTickAccumulatorMs = tickPlan.remainderMs;
    return tickPlan.steps;
}
