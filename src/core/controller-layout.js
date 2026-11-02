// @ts-check
/**
 * @fileoverview The controller layout's version, and the step that brings older saves to it.
 *
 * Version 2 (2026-11, docs/CONTROLLER_UX_2026-11.md): View opens the Serenity Hub in every
 * mode, so Serenity's own pad layout gave View to the Hub and Y to the button hints (it was Y
 * for the Hub and View for the hints). A save that still holds that old default pair takes
 * the new one; a player's own choice of either button is kept.
 *
 * Headless: settings (src/ui/settings.js) and Steam Cloud's keybind merge
 * (src/core/steam/steam-cloud-sync.js) both run it.
 */

export const CONTROLLER_LAYOUT_VERSION = 2;

const Y = 3;
const VIEW = 8;

/**
 * @param {Record<string, unknown> | null | undefined} bindings saved serenityGamepadBindings
 * @param {unknown} version the save's controllerLayoutVersion (absent: 1)
 * @returns {Record<string, unknown>} the bindings in this version's layout (a new object
 *   when they changed, else the same one)
 */
export function migrateSerenityPadLayout(bindings, version) {
    const saved = bindings && typeof bindings === 'object' ? bindings : {};
    const from = Number.isInteger(version) ? Number(version) : 1;
    if (from >= CONTROLLER_LAYOUT_VERSION) return saved;
    if (saved.toggleHub === Y && saved.toggleControlHints === VIEW) {
        return { ...saved, toggleHub: VIEW, toggleControlHints: Y };
    }
    return saved;
}
