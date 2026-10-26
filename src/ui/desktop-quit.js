// @ts-check
/**
 * Quit for the desktop game: the main menu's dock and the pause sheet both end with it.
 *
 * Only the desktop build can close itself (`desktop:quit` over the preload bridge; the main
 * process still runs the game's cleanup and the Steam shutdown on the way out). A browser tab
 * cannot close itself, so the web build offers no Quit at all.
 *
 * Quit takes two presses: the first arms it (the label asks for the second press and the
 * button turns the warning colour), the second quits. It disarms after a few seconds or when
 * focus leaves it, so a stray controller press or a misclick never closes the game.
 */

export const QUIT_CONFIRM_MS = 4000;
export const QUIT_CONFIRM_TEXT = 'Press again to quit';

/**
 * @typedef {{ electronAPI?: { invoke?: (channel: string, ...args: unknown[]) => unknown } }} DesktopWindow
 */

/**
 * @param {DesktopWindow | undefined} [win]
 * @returns {boolean}
 */
export function canQuitDesktop(win = /** @type {DesktopWindow | undefined} */ (globalThis.window)) {
    return typeof win?.electronAPI?.invoke === 'function';
}

/**
 * Asks the desktop shell to quit. Never throws (the bridge throws on an unknown channel).
 * @param {DesktopWindow | undefined} [win]
 * @returns {Promise<void>}
 */
export function requestDesktopQuit(win = /** @type {DesktopWindow | undefined} */ (globalThis.window)) {
    return Promise.resolve()
        .then(() => win?.electronAPI?.invoke?.('desktop:quit'))
        .then(() => {}, () => {});
}

/**
 * Makes `button` a two-press Quit.
 * @param {HTMLElement} button
 * @param {{
 *   label: HTMLElement,
 *   confirmText?: string,
 *   confirmMs?: number,
 *   quit?: () => unknown,
 *   signal?: AbortSignal,
 * }} options `label` is the element whose text names the button. Pass `signal` when the
 *   button outlives its wiring (the settings sheet is wired again on re-init): two sets of
 *   listeners on one button would arm and quit on the same press.
 * @returns {{ disarm: () => void, isArmed: () => boolean }}
 */
export function armTwoPressQuit(button, {
    label,
    confirmText = QUIT_CONFIRM_TEXT,
    confirmMs = QUIT_CONFIRM_MS,
    quit = requestDesktopQuit,
    signal,
}) {
    const idleText = label.textContent;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    const isArmed = () => button.classList.contains('is-confirming');
    const disarm = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        button.classList.remove('is-confirming');
        label.textContent = idleText;
    };
    button.addEventListener('click', () => {
        if (!isArmed()) {
            button.classList.add('is-confirming');
            label.textContent = confirmText;
            timer = setTimeout(disarm, confirmMs);
            return;
        }
        disarm();
        quit();
    }, { signal });
    button.addEventListener('blur', disarm, { signal });
    signal?.addEventListener('abort', disarm, { once: true });
    return { disarm, isArmed };
}
