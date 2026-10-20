// @ts-check
/**
 * Photosensitivity: the player's "Reduce flashing effects" choice (Settings > Visual), read live.
 *
 * It is separate from Reduce motion. A photosensitive player wants the strobes, the lightning and
 * the frame-wide flashes held back, not the worlds held still; a motion-sensitive player wants the
 * opposite. No system preference exists for flashing (prefers-reduced-motion is about motion), so
 * the setting is the only source. ADR-0021.
 *
 * What it means wherever a frame-wide flash is written:
 *   - a theme's post flash (`post.update({ flash })`, every `*-post.js`) keeps REDUCED_FLASH_SCALE
 *     of its strength: under the 10 % relative-luminance step that WCAG 2.3.1 counts as a flash;
 *   - lightning fires one stroke and never flickers; a strobe becomes steady light;
 *   - the board's screen flashes become a slow, soft glow (rendering/phaser/shared-effects.js);
 *   - the DOM flashes (line-clear bars, meters, chips) are stilled by `html.sb-reduce-flashing`
 *     (public/styles/photosensitivity.css, kept in step by main.js).
 *
 * Settings UI: index.html `#reduce-flashing`; the persisted key is `reduceFlashing`.
 */

/** What a frame-wide flash keeps of its strength under Reduce flashing (0..1). */
export const REDUCED_FLASH_SCALE = 0.08;

/** The persisted settings key. */
export const REDUCE_FLASHING_SETTING = 'reduceFlashing';

/** The class main.js keeps on <html> while the setting is on (the stylesheet's hook). */
export const REDUCE_FLASHING_CLASS = 'sb-reduce-flashing';

/**
 * The live settings object main.js keeps on `window.settings` (or the manager's, before that).
 * @returns {{ reduceFlashing?: boolean } | null}
 */
function liveSettings() {
    if (typeof window === 'undefined') return null;
    const w = /** @type {any} */ (window);
    return w.settings ?? w.settingsManager?.get?.() ?? null;
}

/**
 * Settings > Reduce flashing effects. Reads the live settings so a world can call it every frame;
 * pass `settings` where the object is already at hand (a scene's game state).
 * @param {{ reduceFlashing?: boolean } | null} [settings]
 * @returns {boolean}
 */
export function prefersReducedFlashing(settings = liveSettings()) {
    return settings?.[REDUCE_FLASHING_SETTING] === true;
}

/**
 * How much of a frame-wide flash to show: 1 = all of it, REDUCED_FLASH_SCALE under Reduce
 * flashing. Multiply a post flash, a sky flash or a strobe amount by it where it is written.
 * @param {{ reduceFlashing?: boolean } | null} [settings]
 * @returns {number}
 */
export function flashScale(settings = liveSettings()) {
    return prefersReducedFlashing(settings) ? REDUCED_FLASH_SCALE : 1;
}

/**
 * Keep the stylesheet's hook on the document root in step with the setting.
 * @param {boolean} enabled
 * @param {{ classList?: { toggle: (name: string, force?: boolean) => unknown } } | null} [root]
 * @returns {boolean} what the root now says
 */
export function applyReduceFlashingClass(enabled, root = typeof document !== 'undefined' ? document.documentElement : null) {
    const on = enabled === true;
    try {
        root?.classList?.toggle(REDUCE_FLASHING_CLASS, on);
    } catch {
        // cosmetic only
    }
    return on;
}
