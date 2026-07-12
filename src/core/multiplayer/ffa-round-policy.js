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

/** Validate and apply one peer-side host restart command. */
export function handleFfaRoundRestart(game, msg) {
    if (game?.isHost) return false;
    if (!game?._isFromHost?.(msg)) {
        game?._rejectSpoof?.('GAME_ROUND_RESTART', msg);
        return false;
    }
    const generation = readFfaRoundAdvance(
        game.roundGeneration,
        msg.data?.roundGeneration,
    );
    if (generation === null) return false;
    game.performRoundRestart({ ...msg.data, roundGeneration: generation });
    return true;
}
