// @ts-check

/**
 * One number for everything two builds must share to play an online match together.
 *
 * The protocol versions (protocol-version.js) choose an envelope and a snapshot frame. They do
 * not move when the packed snapshot body, the resync sidecar's fields or the versus rules
 * change, and each of those breaks a match between two builds. A body or sidecar the other side
 * cannot decode used to end in a kick that blamed the host. A rules change is worse: every
 * client simulates its own board with its own build's rules, so two builds would play on, out
 * of sync.
 *
 * Raise MATCH_COMPATIBILITY whenever an older build can no longer play a match with this one.
 * tests/unit/match-compatibility.test.js watches the wire formats, the versus rules and the
 * pinned rule fixtures, and fails with instructions when one of them changes.
 *
 * The number travels two ways. A host publishes it in its lobby data, so the match list marks a
 * room from another version instead of offering Join (ui/lobby-browser.js). The join handshake
 * carries it both ways (multiplayer/ffa/join-handshake.js), so a join by invite or lobby ID is
 * refused with the update message.
 */
export const MATCH_COMPATIBILITY = 1;

/** The lobby data key a host publishes MATCH_COMPATIBILITY under. */
export const LOBBY_COMPATIBILITY_KEY = 'compat';

/**
 * A compatibility number as it arrives in lobby data (a string) or a handshake (a number).
 * @param {unknown} value
 * @returns {number | null} null for anything that is not a positive integer
 */
export function readMatchCompatibility(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d{1,9}$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * How the other build's number stands against this one's. A build that sends none predates the
 * number, so it is older.
 * @param {unknown} remote
 * @param {number} [local]
 * @returns {'same' | 'older' | 'newer'}
 */
export function compareMatchCompatibility(remote, local = MATCH_COMPATIBILITY) {
    const number = readMatchCompatibility(remote);
    if (number === null || number < local) return 'older';
    return number > local ? 'newer' : 'same';
}
