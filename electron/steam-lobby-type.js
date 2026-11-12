/**
 * Who can find and join a match, as Steam's lobby type (steamworks.js matchmaking.LobbyType).
 *
 * - `public`  -> Public (2): in the match list, and visible to friends.
 * - `friends` -> FriendsOnly (1): not in the list; friends and invited players join.
 * - `private` -> Private (0): not in the list and not shown to friends; players join by
 *   invite or by the lobby ID the host shares.
 *
 * Anything else is treated as private, the narrowest. The game's own words for each are
 * src/ui/match-config-modal.js (LOBBY_TYPE_HELP).
 *
 * Pure (no Electron, no steamworks): electron/steam-integration.js uses it.
 */
export const STEAM_LOBBY_TYPE = Object.freeze({ private: 0, friends: 1, public: 2 });

/** @param {unknown} lobbyType 'public' | 'friends' | 'private' */
export function steamLobbyType(lobbyType) {
    return Object.hasOwn(STEAM_LOBBY_TYPE, String(lobbyType))
        ? STEAM_LOBBY_TYPE[String(lobbyType)]
        : STEAM_LOBBY_TYPE.private;
}
