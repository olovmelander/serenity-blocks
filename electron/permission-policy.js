/**
 * Which permissions a page in the game window gets (audit R-07 step 5). With no handler
 * Electron grants every request, so a release build gave the camera, the microphone, the
 * location, notifications and clipboard reading to anything that ran in the window. The game
 * itself asks for three: fullscreen, writing to the clipboard (the copy buttons) and the
 * screen wake lock (Serenity mode). Everything else is refused, and these three only go to the
 * game's own page.
 */
export const GAME_PERMISSIONS = Object.freeze([
    'fullscreen',
    'clipboard-sanitized-write',
    'screen-wake-lock',
]);

/**
 * Checks (never requests) Chromium makes when the sound manager listens for audio device
 * changes (src/audio/sound-manager.js): without them the page may not see a headset come or go,
 * and the music analysis is not rebuilt. Granting the check exposes the device list to the game
 * page; capturing a microphone or camera is a request, and stays refused.
 */
export const GAME_PERMISSION_CHECKS = Object.freeze([
    ...GAME_PERMISSIONS,
    'media',
    'speaker-selection',
]);

/**
 * @param {{
 *   kind: 'request' | 'check',
 *   permission: string,
 *   requestingUrl?: string | null,
 *   isGameUrl: (url: string) => boolean,
 * }} query
 * @returns {boolean}
 */
export function isPermissionAllowed({
    kind, permission, requestingUrl, isGameUrl,
}) {
    const allowed = kind === 'check' ? GAME_PERMISSION_CHECKS : GAME_PERMISSIONS;
    return allowed.includes(permission)
        && typeof requestingUrl === 'string'
        && isGameUrl(requestingUrl);
}
