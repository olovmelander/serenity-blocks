/**
 * Alt-tab, minimize or a controller disconnect left a local run going, so the player came
 * back to a lost board (audit R-08: INPUT-10, UI-03, LIFE-06). The run now pauses the way
 * Escape does; an online match never pauses.
 */
import { describe, expect, it, vi } from 'vitest';
import { FOCUS_PAUSE_MODES, installFocusPause, shouldPauseOnFocusLoss } from '../../src/ui/focus-pause.js';

const playing = {
    enabled: true, modeId: 'single', isRunning: true, isPaused: false, isGameOver: false, modalOpen: false, hubOpen: false,
};

describe('when losing focus pauses the run', () => {
    it('pauses a running Single Player, Infinity, Odyssey or local multiplayer run', () => {
        expect(FOCUS_PAUSE_MODES).toEqual(['single', 'local-multiplayer', 'infinity', 'odyssey']);
        FOCUS_PAUSE_MODES.forEach((modeId) => expect(shouldPauseOnFocusLoss({ ...playing, modeId })).toBe(true));
    });

    it('never pauses an online match or Serenity', () => {
        expect(shouldPauseOnFocusLoss({ ...playing, modeId: 'online-multiplayer' })).toBe(false);
        expect(shouldPauseOnFocusLoss({ ...playing, modeId: 'serenity' })).toBe(false);
        expect(shouldPauseOnFocusLoss({ ...playing, modeId: null })).toBe(false);
    });

    it('leaves alone a run that is not in play, or a screen that already has the player', () => {
        expect(shouldPauseOnFocusLoss({ ...playing, isRunning: false })).toBe(false);
        expect(shouldPauseOnFocusLoss({ ...playing, isPaused: true })).toBe(false);
        expect(shouldPauseOnFocusLoss({ ...playing, isGameOver: true })).toBe(false);
        expect(shouldPauseOnFocusLoss({ ...playing, modalOpen: true })).toBe(false);
        expect(shouldPauseOnFocusLoss({ ...playing, hubOpen: true })).toBe(false);
    });

    it('is on unless the player turned it off', () => {
        expect(shouldPauseOnFocusLoss({ ...playing, enabled: undefined })).toBe(true);
        expect(shouldPauseOnFocusLoss({ ...playing, enabled: false })).toBe(false);
    });
});

function harness({ modeId = 'single', settings = {}, visibleModals = [] } = {}) {
    let runtimeListener = null;
    const stopRuntimeEvents = vi.fn();
    const win = Object.assign(new EventTarget(), {
        electronAPI: {
            onRuntimeEvent: (listener) => { runtimeListener = listener; return stopRuntimeEvents; },
        },
    });
    const doc = Object.assign(new EventTarget(), { hidden: false, body: { classList: { contains: () => false } } });
    const mode = { isRunning: true, isPaused: false };
    const app = {
        gameModeManager: { getCurrentMode: () => mode, getCurrentModeId: () => modeId },
        modalManager: {
            modals: { start: {}, gameOver: {}, settings: {} },
            isVisible: (name) => visibleModals.includes(name),
        },
        settingsManager: { get: () => settings },
        gameState: { isGameOver: false },
        openSettingsMenu: vi.fn(() => { mode.isPaused = true; }),
        cleanupHandlers: [],
    };
    installFocusPause(app, { win, doc });
    return {
        app, win, doc, mode, stopRuntimeEvents, runtime: (event) => runtimeListener(event),
    };
}

describe('focus pause wiring', () => {
    it('pauses with Settings open when the window loses focus, once', () => {
        const { app, win } = harness();
        win.dispatchEvent(new Event('blur'));
        win.dispatchEvent(new Event('blur'));
        expect(app.openSettingsMenu).toHaveBeenCalledTimes(1);
    });

    it('pauses when the window is hidden or a controller disconnects', () => {
        const hidden = harness();
        hidden.doc.dispatchEvent(new Event('visibilitychange'));
        expect(hidden.app.openSettingsMenu).not.toHaveBeenCalled();
        hidden.doc.hidden = true;
        hidden.doc.dispatchEvent(new Event('visibilitychange'));
        expect(hidden.app.openSettingsMenu).toHaveBeenCalledTimes(1);

        const pad = harness();
        pad.win.dispatchEvent(new Event('gamepaddisconnected'));
        expect(pad.app.openSettingsMenu).toHaveBeenCalledTimes(1);
    });

    it('also listens to the desktop window focus reported by the main process', () => {
        const { app, runtime } = harness();
        runtime({ type: 'window-focus-changed', payload: { focused: true } });
        expect(app.openSettingsMenu).not.toHaveBeenCalled();
        runtime({ type: 'window-focus-changed', payload: { focused: false } });
        expect(app.openSettingsMenu).toHaveBeenCalledTimes(1);
    });

    it('does nothing online, when turned off, or over the results screen', () => {
        const online = harness({ modeId: 'online-multiplayer' });
        online.win.dispatchEvent(new Event('blur'));
        expect(online.app.openSettingsMenu).not.toHaveBeenCalled();

        const off = harness({ settings: { pauseOnFocusLoss: false } });
        off.win.dispatchEvent(new Event('blur'));
        expect(off.app.openSettingsMenu).not.toHaveBeenCalled();

        const results = harness({ visibleModals: ['gameOver'] });
        results.win.dispatchEvent(new Event('blur'));
        expect(results.app.openSettingsMenu).not.toHaveBeenCalled();
    });

    it('stops listening when the app is cleaned up', () => {
        const { app, win, stopRuntimeEvents } = harness();
        app.cleanupHandlers.forEach((dispose) => dispose());
        win.dispatchEvent(new Event('blur'));
        expect(app.openSettingsMenu).not.toHaveBeenCalled();
        expect(stopRuntimeEvents).toHaveBeenCalledTimes(1);
    });
});
