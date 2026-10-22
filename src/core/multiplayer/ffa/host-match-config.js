// @ts-check

/** The most players a lobby seats; spectators are not players (FFAGameStateP2P.addSpectator). */
export const MAX_LOBBY_PLAYERS = 8;

/**
 * The host's match config as a peer adopts it, from a game start or a resync. It arrives
 * from the network, and the waiting room draws one open seat per `maxPlayers`: a host
 * that sent 1e8 froze every peer. A seat count outside 2 to 8 is clamped into it.
 * @template {Record<string, any>} T
 * @param {T} current
 * @param {unknown} incoming
 * @returns {T}
 */
export function mergeHostMatchConfig(current, incoming) {
    /** @type {Record<string, any>} */
    const merged = { ...current, ...(incoming && typeof incoming === 'object' ? incoming : {}) };
    if (merged.maxPlayers !== undefined) {
        const seats = Math.trunc(Number(merged.maxPlayers));
        merged.maxPlayers = Number.isFinite(seats)
            ? Math.min(MAX_LOBBY_PLAYERS, Math.max(2, seats))
            : MAX_LOBBY_PLAYERS;
    }
    return /** @type {T} */ (merged);
}
