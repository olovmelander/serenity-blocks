import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';

/**
 * A round that a knock-out ends holds this long before the next one starts, so the
 * knocked-out board drains, its Out card rises and every client says who took the round
 * (OnlineMultiplayerMode). It used to restart at once: the last knock-out of a round —
 * every knock-out in a duel — never showed.
 */
export const ROUND_OVER_BEAT_MS = 2400;

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

/** Host: drop a pending round restart (a new match, a full restart, teardown). */
export function cancelFfaRoundRestart(game) {
    if (game?._roundRestartTimer) {
        clearTimeout(game._roundRestartTimer);
        game._roundRestartTimer = null;
    }
}

/**
 * Host: start the next round after the round-over beat. The finished round's boards stay
 * as they ended; the restart is fenced to this round and to a live, still-hosting state.
 * @returns {boolean} whether a restart was scheduled
 */
export function scheduleFfaRoundRestart(game, delayMs = ROUND_OVER_BEAT_MS) {
    if (!game?.isHost) return false;
    cancelFfaRoundRestart(game);
    const generation = game.roundGeneration;
    // Keep beating through the pause, so no peer takes the quiet host for gone.
    game.startHeartbeatLoop?.();
    game._roundRestartTimer = setTimeout(() => {
        game._roundRestartTimer = null;
        if (!game.isHost || game._disposed || game.roundGeneration !== generation
            || game.gamePhase !== 'finished') return;
        game.restartMatch();
    }, Math.max(0, Number(delayMs) || 0));
    return true;
}

/**
 * Peer: the host ended the match, or only the round (GAME_MATCH_END). Either way the
 * board stops; a match over shows the results, a round over its outcome until the
 * host's restart arrives.
 */
export function handleFfaMatchEnd(game, msg) {
    const data = msg?.data || {};
    const winnerName = data.winnerName || 'Draw';
    console.log(`🎊 MATCH OVER! Winner: ${winnerName}`);

    game.gamePhase = 'finished';
    game.winner = data.winner
        ? (game.players.get(data.winner) || { steamId: data.winner, name: winnerName })
        : { steamId: null, name: winnerName };
    game.lastMatchResults = data;

    game.stopGameLoop();
    game.stopStateSyncLoop();

    if (data.isGameOver) {
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, {
            winner: game.winner,
            winnerName,
            finalStats: data.finalStats || [],
            endCondition: data.endCondition,
            endConditionValue: data.endConditionValue,
            duration: data.duration,
            killFeed: data.killFeed || [],
            isGameOver: true,
        });
    } else {
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_OVER, {
            winner: game.winner,
            finalStats: data.finalStats || [],
        });
    }
}
