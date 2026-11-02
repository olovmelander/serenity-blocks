// @ts-check
/**
 * @fileoverview Open the Serenity Hub from anywhere, building it first if it has not loaded yet.
 *
 * The Hub starts with the deferred services, a moment after the main menu appears; until then
 * its tile (and the dock's Serenity Hub button, which clicks the tile) and a controller's View had
 * nothing to open. Both come here (play-rail.js, gamepad-controller.js), so an early press is
 * never lost. Once the Hub exists its own handlers toggle it.
 */

/** @returns {any} the SerenityBlocks app (window.serenityBlocks), if it is up */
function currentApp() {
    return /** @type {any} */ (globalThis.window)?.serenityBlocks;
}

/**
 * @param {any} [app] the SerenityBlocks app
 * @returns {Promise<boolean>} whether the Hub is open
 */
export async function openSerenityHub(app = currentApp()) {
    const hub = app?.serenityHub || (await app?.initializeGlobalSerenityHub?.());
    if (!hub || app?.isCleaningUp) return false;
    hub.show?.();
    return hub.isOpen === true;
}

/** Whether the app can build the Hub on demand (it has not loaded yet). @param {any} [app] */
export function canOpenSerenityHub(app = currentApp()) {
    return Boolean(app?.serenityHub || typeof app?.initializeGlobalSerenityHub === 'function');
}
