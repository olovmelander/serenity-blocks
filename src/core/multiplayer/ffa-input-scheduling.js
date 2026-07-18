import { acknowledgeFfaInput } from './ffa-input-batching.js';

const MAX_ADAPTIVE_INPUT_LATE_TICKS = 30;
const MAX_ADAPTIVE_INPUT_FUTURE_TICKS = 8;

/**
 * Drain every input due at the jitter buffer's process cursor and apply it to
 * the owning player. Extracted from FFAGameStateP2P.processBufferedInputs so
 * the wall-clock driver (perf review §2.3) can drain once per advanced tick —
 * a heavy frame that advances 2 ticks drains both in order — without growing
 * the god file. Does NOT advance the buffer; the caller owns cadence.
 * @param {import('./ffa-p2p-game-state.js').FFAGameStateP2P} game
 */
export function drainFfaBufferedInputs(game) {
    const inputsMap = game.inputJitterBuffer.getInputsForTick();

    for (const [steamId, inputs] of inputsMap) {
        if (inputs.length === 0) continue;

        const player = game.players.get(steamId);
        if (!player) continue;
        if (!player.isAlive) {
            inputs.forEach((input) => acknowledgeFfaInput(player, input.data?.seq));
            continue;
        }

        // Build callbacks once per player (local vs remote as appropriate).
        const isRemotePlayer = steamId !== game.localPlayerId;
        const callbacks = isRemotePlayer
            ? game.buildRemotePlayerCallbacks(steamId)
            : game.buildPhysicsCallbacks(steamId);

        for (const input of inputs) {
            // Timestamp validation already ran when the input was buffered;
            // track again here for pattern heuristics only.
            if (game.inputValidator) {
                game.inputValidator.trackInput(steamId, input.type, input.data);
            }

            const applied = game._applyInputToPlayer(
                steamId,
                input.type,
                input.data, // This is the inner data object
                callbacks,
            );
            if (applied) {
                game._recordNetEvent?.('input_applied', {
                    steamId,
                    inputType: input.type,
                    seq: input.data?.seq,
                    buffered: true,
                    tick: input._tick,
                });
            }
            acknowledgeFfaInput(player, input.data?.seq);
        }
    }
}

/**
 * Resolve one validated FFA input onto the host jitter-buffer clock.
 * Fixed peers may include an offset within their current catch-up batch so
 * actions generated on distinct canonical ticks do not collapse onto one host
 * tick when adaptive scheduling is disabled or must fall back.
 */
export function resolveFfaBufferedInputTick(game, steamId, data = {}, policy = {}) {
    const buffer = game.inputJitterBuffer;
    const fallbackTick = Number(buffer?.currentTick) || 0;
    const numericFixedOffset = Number(data?.fixedTickOffset);
    const hasFixedOffset = game._fixedTickEnabled === true
        && Number.isInteger(numericFixedOffset)
        && numericFixedOffset >= 0;
    const bufferDepth = Number(buffer?.bufferDepth) || 2;
    const boundedFixedOffset = hasFixedOffset
        ? Math.min(numericFixedOffset, bufferDepth + 2)
        : 0;
    const fallback = {
        tick: fallbackTick + boundedFixedOffset,
        rawTick: fallbackTick,
        source: hasFixedOffset ? 'fixed_tick_ordinal' : 'buffer',
        lateClamped: false,
        reject: false,
    };

    if (policy.fixedTickCanonical === true && data?.fixedTickCanonical === true) {
        const targetTick = Number(data.fixedTickTargetTick);
        const futureAllowance = Number(data.fixedTickFutureAllowance);
        const rawTick = Number(data.simTick);
        if (
            Number.isSafeInteger(targetTick)
            && targetTick >= 0
            && Number.isSafeInteger(futureAllowance)
            && futureAllowance >= 0
        ) {
            return {
                ...fallback,
                tick: targetTick,
                rawTick: Number.isSafeInteger(rawTick) && rawTick >= 0 ? rawTick : fallbackTick,
                jitterTick: targetTick,
                source: 'fixed_tick_progression',
                maxFutureTicks: futureAllowance,
            };
        }
        return { ...fallback, source: 'fixed_tick_progression_invalid', reject: true };
    }
    if (!game._adaptiveInputJitterEnabled || !buffer) return fallback;
    if (steamId === game.localPlayerId) {
        return { ...fallback, source: 'local_buffer' };
    }

    const rawValue = data?.simTick ?? data?.hostSimTick ?? data?.clientSimTick;
    const rawTick = Math.round(Number(rawValue));
    if (!Number.isFinite(rawTick)) {
        return { ...fallback, source: 'fallback_missing_sim_tick' };
    }

    const processCursor = Number(buffer.processCursor) || 0;
    const currentTick = Number(buffer.currentTick) || 0;
    const maxTick = currentTick + bufferDepth + MAX_ADAPTIVE_INPUT_FUTURE_TICKS;
    if (rawTick > maxTick) {
        return {
            ...fallback,
            rawTick,
            source: hasFixedOffset
                ? 'fixed_tick_ordinal_future_fallback'
                : 'fallback_future_sim_tick',
        };
    }

    const lateBy = processCursor - rawTick;
    if (lateBy > MAX_ADAPTIVE_INPUT_LATE_TICKS) {
        return {
            tick: rawTick,
            rawTick,
            source: 'stale_sim_tick',
            reject: true,
            lateBy,
        };
    }
    if (rawTick < processCursor) {
        return {
            tick: processCursor + boundedFixedOffset,
            rawTick,
            source: hasFixedOffset
                ? 'fixed_tick_ordinal_clamped_late'
                : 'sim_tick_clamped_late',
            lateClamped: true,
            reject: false,
            lateBy,
        };
    }

    return {
        tick: rawTick,
        rawTick,
        source: 'sim_tick',
        lateClamped: false,
        reject: false,
    };
}
