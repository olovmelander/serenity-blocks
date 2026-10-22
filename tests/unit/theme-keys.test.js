import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/ui/serenity-mode/serenity-notice.js', () => ({ showSerenityNotice: vi.fn() }));

const { showSerenityNotice } = await import('../../src/ui/serenity-mode/serenity-notice.js');
const { installThemeKeys } = await import('../../src/ui/theme-keys.js');
const { DELAY_MS } = await import('../../src/ui/serenity-mode/serenity-world-stepper.js');
const { THEME_REGISTRY } = await import('../../src/themes/theme-registry.js');
const { GamepadController } = await import('../../src/ui/gamepad-controller.js');

// Three collected themes, in the Hub's order; the first is on screen.
const [FIRST, SECOND, THIRD] = THEME_REGISTRY.map((entry) => entry.id);
const LB = 4;
const RB = 5;

function setup({ modeId = 'single', settings = {}, bodyClasses = [] } = {}) {
    const classes = new Set(bodyClasses);
    let keydown = null;
    let visibleModal = null;
    const doc = {
        body: { classList: { contains: (name) => classes.has(name) } },
        querySelector: (selector) => (selector === '.modal.visible' ? visibleModal : null),
        addEventListener: (type, handler) => { if (type === 'keydown') keydown = handler; },
        removeEventListener: vi.fn(),
    };
    const themeManager = {
        activeThemeName: FIRST,
        themesSuspended: false,
        isThemeUnlocked: (id) => [FIRST, SECOND, THIRD].includes(id),
        canSelectTheme: () => true,
        isOdysseyThemeScopeActive: () => false,
        switchTheme: vi.fn(async (id) => {
            themeManager.activeThemeName = id;
            return id;
        }),
    };
    const mode = { isRunning: true, stepWorld: vi.fn() };
    const handlers = new Map();
    const app = {
        themeManager,
        settingsManager: { get: () => settings, update: vi.fn(), save: vi.fn() },
        gameModeManager: {
            getCurrentMode: () => mode,
            getCurrentModeId: () => modeId,
            on: (event, handler) => handlers.set(event, handler),
        },
        gamepadController: { setThemeStepper: vi.fn() },
        cleanupHandlers: [],
    };
    installThemeKeys(app, { doc });
    const press = (key, { shiftKey = false, repeat = false, target = { closest: () => null } } = {}) => {
        const event = {
            key,
            shiftKey,
            repeat,
            target,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
        };
        keydown(event);
        return event;
    };
    const padStep = app.gamepadController.setThemeStepper.mock.calls[0][0];
    return {
        app,
        mode,
        themeManager,
        handlers,
        press,
        padStep,
        showModal: (modal) => { visibleModal = modal; },
    };
}

describe('theme keys', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        showSerenityNotice.mockClear();
    });
    afterEach(() => vi.useRealTimers());

    it('N opens the next theme you have collected, names it, and keeps it as your choice', async () => {
        const { app, themeManager, press } = setup();

        expect(press('n').defaultPrevented).toBe(true);
        expect(showSerenityNotice).toHaveBeenCalledWith(expect.stringContaining('2 of 3'));
        expect(themeManager.switchTheme).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(DELAY_MS);
        expect(themeManager.switchTheme).toHaveBeenCalledWith(SECOND);
        expect(app.settingsManager.update)
            .toHaveBeenCalledWith({ backgroundTheme: SECOND, backgroundMode: 'Specific' });
    });

    it('Shift+N goes back (wrapping round), and Caps Lock does not turn N around', async () => {
        const { themeManager, press } = setup();

        press('N', { shiftKey: true });
        await vi.advanceTimersByTimeAsync(DELAY_MS);
        expect(themeManager.switchTheme).toHaveBeenLastCalledWith(THIRD);

        press('N');
        await vi.advanceTimersByTimeAsync(DELAY_MS);
        expect(themeManager.switchTheme).toHaveBeenLastCalledWith(FIRST);
    });

    it('builds only the theme a run of presses stops on', async () => {
        const { themeManager, press } = setup();

        press('n');
        press('n');
        await vi.advanceTimersByTimeAsync(DELAY_MS);

        expect(themeManager.switchTheme).toHaveBeenCalledTimes(1);
        expect(themeManager.switchTheme).toHaveBeenCalledWith(THIRD);
    });

    it('stays quiet on the menu, under the Hub, Settings or a sheet, in a text field and on a held key', () => {
        const menu = setup({ bodyClasses: ['start-modal-open'] });
        expect(menu.press('n').defaultPrevented).toBe(false);

        const hub = setup({ bodyClasses: ['serenity-hub-open'] });
        expect(hub.press('n').defaultPrevented).toBe(false);

        const sheet = setup();
        sheet.showModal({});
        expect(sheet.press('n').defaultPrevented).toBe(false);

        const typing = setup();
        expect(typing.press('n', { target: { closest: () => ({}) } }).defaultPrevented).toBe(false);
        expect(typing.press('n', { repeat: true }).defaultPrevented).toBe(false);

        expect(showSerenityNotice).not.toHaveBeenCalled();
    });

    it('leaves N to the game when a control is bound to it', () => {
        const { press } = setup({ settings: { player2KeyBindings: { hardDrop: 'N' } } });
        expect(press('n').defaultPrevented).toBe(false);
    });

    it('leaves the Odyssey its orb\'s theme, and says so', async () => {
        const { themeManager, press } = setup({ modeId: 'odyssey' });

        press('n');
        await vi.advanceTimersByTimeAsync(DELAY_MS);

        expect(themeManager.switchTheme).not.toHaveBeenCalled();
        expect(showSerenityNotice).toHaveBeenCalledWith('Each Odyssey orb keeps its own theme');
    });

    it('steps Serenity Mode\'s own world, unless N is one of its keys', () => {
        const { mode, press } = setup({ modeId: 'serenity' });
        press('n', { shiftKey: true });
        expect(mode.stepWorld).toHaveBeenCalledWith(-1);

        const rebound = setup({ modeId: 'serenity', settings: { serenityKeyBindings: { toggleMute: 'n' } } });
        rebound.press('n');
        expect(rebound.mode.stepWorld).not.toHaveBeenCalled();
    });

    it('forgets a pending step when the mode stops', async () => {
        const { themeManager, handlers, press } = setup();

        press('n');
        handlers.get('modeStopped')();
        await vi.advanceTimersByTimeAsync(DELAY_MS);

        expect(themeManager.switchTheme).not.toHaveBeenCalled();
    });

    it('gives the pad the same steps, but not in Serenity Mode or the Odyssey', () => {
        expect(setup().padStep(1)).toBe(true);
        expect(setup({ modeId: 'serenity' }).padStep(1)).toBe(false);
        showSerenityNotice.mockClear();
        const odyssey = setup({ modeId: 'odyssey' });
        expect(odyssey.padStep(1)).toBe(false);
        expect(showSerenityNotice).not.toHaveBeenCalled();
    });
});

describe('theme shoulders on the pad', () => {
    function pad() {
        return {
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
            axes: [0, 0, 0, 0],
        };
    }

    function controllerSetup(bodyClasses = new Set()) {
        vi.spyOn(performance, 'now').mockReturnValue(10000);
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', { body: { classList: { contains: (name) => bodyClasses.has(name) } } });
        const controller = new GamepadController();
        const step = vi.fn(() => true);
        controller.setThemeStepper(step);
        return { controller, step };
    }

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('RB steps forward and LB back, once per press', () => {
        const { controller, step } = controllerSetup();
        const gamepad = pad();

        gamepad.buttons[RB].pressed = true;
        controller.processGamepadInput(gamepad, 0);
        controller.processGamepadInput(gamepad, 0);
        gamepad.buttons[RB].pressed = false;
        gamepad.buttons[LB].pressed = true;
        controller.processGamepadInput(gamepad, 0);

        expect(step.mock.calls).toEqual([[1], [-1]]);
    });

    it('leaves the shoulders to the game when a control is bound there, and to player 1 only', () => {
        const { controller, step } = controllerSetup();
        controller.customBindings[0] = { hardDrop: RB };
        const gamepad = pad();
        gamepad.buttons[RB].pressed = true;

        controller.processGamepadInput(gamepad, 0);
        controller.processGamepadInput(gamepad, 1);

        expect(step).not.toHaveBeenCalled();
    });

    it('does not step on a shoulder still held from a menu', () => {
        const { controller, step } = controllerSetup();
        const gamepad = pad();
        gamepad.buttons[RB].pressed = true;

        controller.latchMenuButtons(gamepad, 0);
        controller.processGamepadInput(gamepad, 0);

        expect(step).not.toHaveBeenCalled();
    });

    it('stays out of Serenity Mode, where the shoulders change the song', () => {
        const { controller, step } = controllerSetup(new Set(['serenity-mode']));
        controller.enableSerenityMode({ isHubOpen: () => false });
        const gamepad = pad();
        gamepad.buttons[RB].pressed = true;

        controller.processGamepadInput(gamepad, 0);

        expect(step).not.toHaveBeenCalled();
    });
});
