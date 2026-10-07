/**
 * Steam's lobby-member callback, as the renderer's transport reads it
 * (src/core/steam/steam-networking.js _listenForSteamPeerEvents).
 */

/** steamworks.js ChatMemberStateChange, in its numeric order. */
const LOBBY_MEMBER_CHANGES = ['entered', 'left', 'disconnected', 'kicked', 'banned'];

/**
 * The change's name. steamworks.js declares the enum as numbers, but a native
 * binding may hand over the variant's name instead; both are read.
 * @param {unknown} value
 * @returns {string|null}
 */
export function lobbyMemberChange(value) {
    if (typeof value === 'number') return LOBBY_MEMBER_CHANGES[value] ?? null;
    if (typeof value === 'string') {
        const name = value.toLowerCase();
        return LOBBY_MEMBER_CHANGES.includes(name) ? name : null;
    }
    return null;
}
