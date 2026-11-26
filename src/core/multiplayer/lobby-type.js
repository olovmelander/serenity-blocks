// @ts-check
/**
 * Who can find and join an online match, and what follows from it for the players in it.
 *
 * - `public`: in the match list; anyone can join.
 * - `friends`: not in the list; the host's Steam friends join from their friends list.
 * - `private`: not in the list and not offered to friends; players join by invite only. The
 *   game shows no lobby ID for one (lobbySharesItsId). Whether Steam itself refuses a join by
 *   a bare ID to its Private lobby type is for the two-account test to show: the game has no
 *   admission check of its own.
 *
 * The host picks the type (ui/match-config-modal.js) and publishes it as lobby data
 * (`LOBBY_TYPE_KEY`), which every player who joins reads. Three things follow it:
 *
 * - The waiting room shows the lobby ID, to pass on, for public and friends matches only.
 * - "Join game" on a player's Steam profile and friends list (the `connect` rich-presence key)
 *   is offered for public and friends matches only. A private match, or one whose type is not
 *   known, never offers it.
 * - Chat with players you do not know is opt-in (ui/chat-moderation.js): a match counts as
 *   among friends only when it is known to be `friends` or `private`. A match that came from
 *   the public list, or whose type is not known, counts as public.
 *
 * The electron side maps the type to Steam's lobby type (electron/steam-lobby-type.js).
 */

export const LOBBY_TYPE_KEY = 'lobby_type';
export const DEFAULT_LOBBY_TYPE = 'friends';

/** @typedef {'public' | 'friends' | 'private'} LobbyType */

/**
 * @param {unknown} value
 * @returns {LobbyType | null} null for anything that is not a lobby type
 */
export function normalizeLobbyType(value) {
    return value === 'public' || value === 'friends' || value === 'private' ? value : null;
}

/**
 * The type a match is created with, as the transport and Steam take it: `friends` when none
 * is chosen, and `private`, the narrowest, for anything that is not a lobby type.
 * @param {unknown} chosen
 * @returns {LobbyType}
 */
export function createdLobbyType(chosen) {
    if (chosen === undefined) return DEFAULT_LOBBY_TYPE;
    return normalizeLobbyType(chosen) ?? 'private';
}

/**
 * The type of a match this player joined: `public` when it was in the public list (whatever
 * its host says), otherwise what its host published, or null when that is missing.
 * @param {{ declared?: unknown, listed?: boolean }} [lobby]
 * @returns {LobbyType | null}
 */
export function joinedLobbyType({ declared, listed = false } = {}) {
    return listed ? 'public' : normalizeLobbyType(declared);
}

/**
 * Whether friends may be offered "Join game" for a match of this type.
 * @param {unknown} type
 */
export function lobbyOffersJoinToFriends(type) {
    return type === 'public' || type === 'friends';
}

/**
 * How chat treats a match of this type: among friends (`friends`, `private`) or `public`.
 * @param {unknown} type
 * @returns {LobbyType}
 */
export function chatLobbyType(type) {
    return type === 'friends' || type === 'private' ? type : 'public';
}

/**
 * Whether a match of this type shows its lobby ID for players to pass on. A private match is
 * invite only, so its waiting room offers the Invite button and no ID. A match whose type is
 * not known shows none either.
 * @param {unknown} type
 */
export function lobbySharesItsId(type) {
    return type === 'public' || type === 'friends';
}
