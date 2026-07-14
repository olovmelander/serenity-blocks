/** Parse one host-stamped, non-negative FFA round generation. */
export function parseFfaRoundGeneration(value) {
    const generation = Number(value);
    return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

/** Accept only a strict host round advance for a board-reset lifecycle event. */
export function readFfaRoundAdvance(currentGeneration, incomingGeneration) {
    const current = parseFfaRoundGeneration(currentGeneration) ?? 0;
    const incoming = parseFfaRoundGeneration(incomingGeneration);
    return incoming !== null && incoming > current ? incoming : null;
}

/**
 * Canonicalize the legacy FFA LCG seed before any lifecycle mutation. Numeric
 * strings remain accepted because the legacy seededRandom seam historically
 * coerced them with Number(); all live state and new wire output use numbers.
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeFfaRoundSeed(value) {
    let numeric = null;
    if (typeof value === 'number') {
        numeric = value;
    } else if (typeof value === 'string' && value.trim().length > 0) {
        numeric = Number(value);
    }
    if (!Number.isFinite(numeric)) return null;
    return Object.is(numeric, -0) ? 0 : numeric;
}

/** Validate and apply one peer-side host restart command. */
export function handleFfaRoundRestart(game, msg) {
    if (game?.isHost) return false;
    if (!game?._isFromHost?.(msg)) {
        game?._rejectSpoof?.('GAME_ROUND_RESTART', msg);
        return false;
    }
    const roundSeed = normalizeFfaRoundSeed(msg.data?.newSeed);
    if (roundSeed === null) return false;
    const generation = readFfaRoundAdvance(
        game.roundGeneration,
        msg.data?.roundGeneration,
    );
    if (generation === null) return false;
    game.performRoundRestart({
        ...msg.data,
        newSeed: roundSeed,
        roundGeneration: generation,
    });
    return true;
}
