// @ts-check
/**
 * Pause the run when the game loses focus (audit R-08: INPUT-10, UI-03, LIFE-06).
 *
 * Alt-tab, a click on another window, minimizing, hiding the tab or a controller
 * disconnecting used to leave a Single Player, Infinity, Odyssey or local multiplayer run
 * going, so the player came back to a lost board. Now the run pauses the way Escape does,
 * with Settings open, and continues when the player closes it. An online match never
 * pauses: freezing one peer's simulation desyncs the session. "Pause when the game loses
 * focus" in Settings turns this off.
 */
export const FOCUS_PAUSE_MODES = Object.freeze(['single', 'local-multiplayer', 'infinity', 'odyssey', 'fault-lines']);

/**
 * @param {{
 *   enabled?: boolean, modeId?: string | null, isRunning?: boolean, isPaused?: boolean,
 *   isGameOver?: boolean, modalOpen?: boolean, hubOpen?: boolean,
 * }} state
 * @returns {boolean}
 */
export function shouldPauseOnFocusLoss({
    enabled, modeId, isRunning, isPaused, isGameOver, modalOpen, hubOpen,
}) {
    return enabled !== false
        && FOCUS_PAUSE_MODES.includes(modeId ?? '')
        && isRunning === true
        && isPaused !== true
        && isGameOver !== true
        // A results screen or Settings already has the player's attention, and the
        // Serenity hub holds the game paused on its own.
        && modalOpen !== true
        && hubOpen !== true;
}

/** @param {any} app @param {Document} doc */
function readFocusPauseState(app, doc) {
    const manager = app.gameModeManager;
    const mode = manager?.getCurrentMode?.();
    const modals = app.modalManager;
    return {
        enabled: app.settingsManager?.get?.()?.pauseOnFocusLoss,
        modeId: manager?.getCurrentModeId?.() ?? null,
        isRunning: mode?.isRunning === true,
        isPaused: mode?.isPaused === true,
        isGameOver: app.gameState?.isGameOver === true,
        modalOpen: Object.keys(modals?.modals || {}).some((name) => modals.isVisible(name)),
        hubOpen: doc.body?.classList?.contains('serenity-hub-open') === true,
    };
}

/**
 * @param {any} app the SerenityBlocks app: gameModeManager, modalManager, settingsManager,
 *   gameState, openSettingsMenu() and cleanupHandlers
 * @param {{ win?: any, doc?: Document }} [options]
 */
export function installFocusPause(app, { win = window, doc = document } = {}) {
    const pauseIfPlaying = (/** @type {string} */ reason) => {
        if (!shouldPauseOnFocusLoss(readFocusPauseState(app, doc))) return;
        console.log(`[FocusPause] Pausing the run: ${reason}`);
        app.openSettingsMenu();
    };
    const onBlur = () => pauseIfPlaying('the window lost focus');
    const onVisibilityChange = () => { if (doc.hidden) pauseIfPlaying('the window was hidden'); };
    const onGamepadDisconnected = () => pauseIfPlaying('a controller disconnected');
    win.addEventListener('blur', onBlur);
    doc.addEventListener('visibilitychange', onVisibilityChange);
    win.addEventListener('gamepaddisconnected', onGamepadDisconnected);
    // Electron reports focus from the main process too: on Windows an alt-tab does not
    // always reach the page as a blur.
    const stopRuntimeEvents = win.electronAPI?.onRuntimeEvent?.((/** @type {any} */ event) => {
        if (event?.type === 'window-focus-changed' && event.payload?.focused === false) onBlur();
    });
    app.cleanupHandlers.push(() => {
        win.removeEventListener('blur', onBlur);
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        win.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
        if (typeof stopRuntimeEvents === 'function') stopRuntimeEvents();
    });
}
