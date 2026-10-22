// @ts-check
/**
 * The theme keys: N steps to the next theme you have collected and Shift+N back, in every
 * mode, without opening the Hub. On the first controller RB and LB do the same, outside
 * Serenity Mode (there the shoulders change the song, and the D-pad and ← → the theme).
 *
 * A step is your choice, as in the Hub: the stepper (serenity-mode/serenity-world-stepper.js)
 * waits for the last of a run of presses, switches once, and saves it as your background
 * theme. Serenity Mode steps its own world, which its bar names; elsewhere a notice names it.
 *
 * Quiet where the theme is not yours to change or the keys are not the game's: the menu,
 * the Odyssey (each orb keeps its own theme), an open Hub, Settings or another sheet, a text
 * field, and a key or button bound to a game control.
 */
import { DEFAULT_SETTINGS } from '../core/constants.js';
import { SerenityWorldStepper, themeName } from './serenity-mode/serenity-world-stepper.js';
import { showSerenityNotice } from './serenity-mode/serenity-notice.js';

export const THEME_KEY = 'n';

/**
 * Where a theme step goes now: 'serenity' (the mode's own world), 'theme' (the stepper),
 * 'odyssey' (refused: the orb's theme), or null (not in play).
 * @param {any} app @param {Document} doc
 * @returns {'serenity'|'theme'|'odyssey'|null}
 */
export function themeStepTarget(app, doc) {
    const { body } = doc;
    if (!body || body.classList.contains('start-modal-open') || body.classList.contains('serenity-hub-open')) {
        return null;
    }
    if (doc.querySelector('.modal.visible')) return null;
    const manager = app.gameModeManager;
    const mode = manager?.getCurrentMode?.();
    if (!mode?.isRunning) return null;
    const modeId = manager.getCurrentModeId?.() ?? mode.getModeId?.();
    if (modeId === 'serenity') return 'serenity';
    if (modeId === 'odyssey' || app.themeManager?.isOdysseyThemeScopeActive?.()) return 'odyssey';
    if (!app.themeManager || app.themeManager.themesSuspended) return null;
    return 'theme';
}

/**
 * Whether `key` already does something in the mode: a game control (both players), or in
 * Serenity Mode one of its own keys.
 * @param {any} settings @param {string} key @param {boolean} serenity
 */
export function keyIsTaken(settings, key, serenity) {
    const groups = serenity
        ? [{ ...DEFAULT_SETTINGS.serenityKeyBindings, ...settings?.serenityKeyBindings }]
        : [settings?.keyBindings, settings?.player2KeyBindings];
    const wanted = key.toLowerCase();
    return groups.some((bindings) => Object.values(bindings || {})
        .some((bound) => typeof bound === 'string' && bound.toLowerCase() === wanted));
}

/**
 * @param {any} app the SerenityBlocks app: gameModeManager, themeManager, settingsManager,
 *   gamepadController and cleanupHandlers
 * @param {{ doc?: Document }} [options]
 */
export function installThemeKeys(app, { doc = document } = {}) {
    /** @type {SerenityWorldStepper|null} */
    let stepper = null;
    const stepperFor = () => {
        stepper ??= new SerenityWorldStepper({
            themeManager: app.themeManager,
            settingsManager: app.settingsManager,
            onPreview: (id, { index, total }) => showSerenityNotice(`${themeName(id)} · ${index + 1} of ${total}`),
            onSettled: (_id, ok) => { if (!ok) showSerenityNotice('That theme could not open'); },
            onAlone: () => showSerenityNotice('Your only theme so far · the Odyssey brings more home'),
        });
        return stepper;
    };

    /**
     * @param {number} direction -1 previous, 1 next
     * @param {{ fromPad?: boolean }} [options]
     * @returns {boolean} whether the press was taken
     */
    const step = (direction, { fromPad = false } = {}) => {
        const target = themeStepTarget(app, doc);
        if (target === 'theme') {
            stepperFor().step(direction);
            return true;
        }
        // The pad's shoulders are an orb's charms there, and Serenity's songs.
        if (fromPad) return false;
        if (target === 'serenity') {
            app.gameModeManager.getCurrentMode().stepWorld?.(direction);
            return true;
        }
        if (target === 'odyssey') {
            showSerenityNotice('Each Odyssey orb keeps its own theme');
            return true;
        }
        return false;
    };

    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
        if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (String(event.key || '').toLowerCase() !== THEME_KEY) return;
        const { target } = event;
        const element = /** @type {Element|null} */ (target);
        if (element?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const serenity = app.gameModeManager?.getCurrentModeId?.() === 'serenity';
        if (keyIsTaken(app.settingsManager?.get?.(), THEME_KEY, serenity)) return;
        // Shift, not the letter's case: Caps Lock must not turn the key around.
        if (step(event.shiftKey ? -1 : 1)) event.preventDefault();
    };

    const cancel = () => stepper?.cancel();
    doc.addEventListener('keydown', onKeyDown);
    app.gameModeManager?.on?.('modeStopped', cancel);
    app.gameModeManager?.on?.('modeDeactivated', cancel);
    app.gamepadController?.setThemeStepper?.((/** @type {number} */ direction) => step(direction, { fromPad: true }));
    app.cleanupHandlers.push(() => {
        doc.removeEventListener('keydown', onKeyDown);
        app.gamepadController?.setThemeStepper?.(null);
        cancel();
    });
}
