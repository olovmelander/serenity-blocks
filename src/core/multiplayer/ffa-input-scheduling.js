const MAX_ADAPTIVE_INPUT_LATE_TICKS = 30;
const MAX_ADAPTIVE_INPUT_FUTURE_TICKS = 8;

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
