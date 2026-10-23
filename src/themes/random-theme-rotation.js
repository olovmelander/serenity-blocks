/**
 * The Random background moves to another theme on a timer, during a game: "How the world behind
 * the board changes during a game" (its setting's help). One owner decides when that timer runs:
 * main.js calls syncRandomThemeRotation() when the background settings change, when a mode starts
 * or stops and when the page is shown or hidden. Started from three places before, it ran on the
 * menu from boot (each tick disposed the theme kept warm there, so the next game built a cold
 * one), kept running while the page was hidden, and kept rotating after a switch to Level.
 *
 * Serenity has its own drift and Odyssey its own worlds: neither rotates.
 */

/** GAME_MODES.SERENITY and GAME_MODES.ODYSSEY (core/constants.js pulls in the theme registry). */
const OWN_WORLD_MODES = new Set(['serenity', 'odyssey']);
const DEFAULT_INTERVAL_SECONDS = 60;

/**
 * @param {{ backgroundMode?: string, modeId?: string | null, modeRunning?: boolean, hidden?: boolean }} state
 * @returns {boolean}
 */
export function shouldRotateRandomTheme({
    backgroundMode, modeId, modeRunning, hidden,
}) {
    return backgroundMode === 'Random'
        && modeRunning === true
        && hidden !== true
        && !OWN_WORLD_MODES.has(modeId);
}

/**
 * Start or stop the theme manager's timer to match the state. A timer already running at the
 * same interval is left alone, so its cadence is not reset.
 * @param {{
 *   themeManager: { randomThemeInterval?: any, randomThemeIntervalMinutes?: number,
 *     startRandomThemeInterval: (minutes: number) => void, stopRandomThemeInterval: () => void },
 *   settings: { backgroundMode?: string, randomThemeInterval?: number } | null | undefined,
 *   mode: { getModeId?: () => string, isRunning?: boolean } | null | undefined,
 *   hidden: boolean,
 * }} context
 * @returns {boolean} whether the timer runs
 */
export function applyRandomThemeRotation({
    themeManager, settings, mode, hidden,
}) {
    const rotate = shouldRotateRandomTheme({
        backgroundMode: settings?.backgroundMode,
        modeId: mode?.getModeId?.() ?? null,
        modeRunning: mode?.isRunning === true,
        hidden,
    });
    if (!rotate) {
        themeManager.stopRandomThemeInterval();
        return false;
    }
    const seconds = Number(settings.randomThemeInterval);
    const minutes = (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_INTERVAL_SECONDS) / 60;
    if (!themeManager.randomThemeInterval || themeManager.randomThemeIntervalMinutes !== minutes) {
        themeManager.startRandomThemeInterval(minutes);
    }
    return true;
}

/**
 * main.js's call: the app's theme manager, its settings, the current mode and the page's visibility.
 * @param {{ themeManager: any, settingsManager?: { get?: () => any }, gameModeManager?: { getCurrentMode?: () => any } }} app
 * @returns {boolean} whether the timer runs
 */
export function syncRandomThemeRotation(app) {
    return applyRandomThemeRotation({
        themeManager: app.themeManager,
        settings: app.settingsManager?.get?.(),
        mode: app.gameModeManager?.getCurrentMode?.(),
        hidden: typeof document !== 'undefined' && document.hidden === true,
    });
}
