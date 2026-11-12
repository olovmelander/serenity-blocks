/**
 * A player's Steam Community profile page, for the Steam overlay's browser: Steam's own
 * block and report tools are there. steamworks.js 0.4.0 has no "profile" overlay dialog for a
 * user (its user dialogs open only that user's stats or achievements).
 * @param {unknown} steamId a SteamID64
 * @returns {string | null} null for anything that is not a SteamID64
 */
export function steamProfileUrl(steamId) {
    const id = typeof steamId === 'bigint' ? steamId.toString() : String(steamId ?? '').trim();
    return /^\d{17}$/.test(id) ? `https://steamcommunity.com/profiles/${id}` : null;
}
