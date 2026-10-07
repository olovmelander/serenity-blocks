// @ts-check

/** Timers a game state keeps on itself that must not outlive it. */
const SESSION_TIMERS = ['_announceTimer', '_readyBarrierTimer', '_rematchRestartTimer'];

/**
 * Stop what a game state left running on timers and listeners, so a disposed host stops
 * broadcasting and a disposed peer never starts a round or a rematch. The session pulse
 * and the transport's peer-gone subscription go too, and the in-game chat's key
 * listener; it kept every old game state alive, one per lobby.
 * @param {Record<string, any>} game
 */
export function disposeFfaSessionTimers(game) {
    SESSION_TIMERS.forEach((key) => {
        if (game[key]) clearTimeout(game[key]);
        game[key] = null;
    });
    game._pendingRoundStart = null;
    game.stopHeartbeatLoop?.(); // the session pulse
    game._offPeerGone?.();
    game._offPeerGone = null;
    game.chat?.destroy?.();
}

/**
 * A rematch vote counts only after a match has ended: a vote arriving mid-match used to
 * restart the live match for everyone.
 * @param {Record<string, any>} game
 */
export function acceptsRematchVote(game) {
    return game.gamePhase === 'finished' && game._disposed !== true;
}
