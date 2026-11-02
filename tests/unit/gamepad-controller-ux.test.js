/**
 * The controller's whole-game contract (docs/CONTROLLER_UX_2026-11.md): View opens the
 * Serenity Hub in every mode, Menu (Start) always reaches Settings, the right stick scrolls a
 * menu, a held direction repeats in the Hub, a Steam invite answers to A and B, and a surface
 * that holds Escape from Settings holds Start too.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { CONTROLLER_LAYOUT_VERSION, migrateSerenityPadLayout } from '../../src/core/controller-layout.js';

const BUTTON = Object.freeze({
    A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, VIEW: 8, START: 9, R3: 11, D_LEFT: 14, D_RIGHT: 15,
});

function pad() {
    return {
        index: 0,
        id: 'pad',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
}

function hold(gamepad, ...indices) {
    gamepad.buttons.forEach((button, index) => {
        button.pressed = indices.includes(index);
        button.value = button.pressed ? 1 : 0;
    });
}

/** A document with only what the controller reads: ids, body classes, a few selectors. */
function stubDocument({
    elements = {}, bodyClasses = new Set(), selectors = {}, activeElement = null,
} = {}) {
    const doc = {
        addEventListener() {},
        removeEventListener() {},
        getElementById: (id) => elements[id] || null,
        querySelector: (selector) => selectors[selector] || null,
        querySelectorAll: () => [],
        body: {
            classList: {
                contains: (name) => bodyClasses.has(name),
                add: (name) => bodyClasses.add(name),
                remove: (name) => bodyClasses.delete(name),
            },
        },
        activeElement,
    };
    vi.stubGlobal('document', doc);
    return doc;
}

let now = 10000;

beforeEach(() => {
    now = 10000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('View opens the Serenity Hub in every mode', () => {
    it('in play outside Serenity, once per press', () => {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });
        const gamepad = pad();

        hold(gamepad, BUTTON.VIEW);
        controller.processGamepadInput(gamepad, 0);
        controller.processGamepadInput(gamepad, 0);

        expect(toggleHub).toHaveBeenCalledTimes(1);
    });

    it('leaves View to the game when the player bound a game control to it', () => {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });
        controller.updateBindings({ hardDrop: BUTTON.VIEW });
        const gamepad = pad();

        hold(gamepad, BUTTON.VIEW);
        controller.processGamepadInput(gamepad, 0);

        expect(toggleHub).not.toHaveBeenCalled();
    });

    it('falls back to View when an old Hub binding plays the game (Y rotates outside Serenity)', () => {
        vi.stubGlobal('window', { settings: { serenityGamepadBindings: { toggleHub: BUTTON.Y } } });
        stubDocument();
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });
        const gamepad = pad();

        hold(gamepad, BUTTON.Y);
        controller.processGamepadInput(gamepad, 0);
        expect(toggleHub).not.toHaveBeenCalled();

        hold(gamepad, BUTTON.VIEW);
        controller.processGamepadInput(gamepad, 0);
        expect(toggleHub).toHaveBeenCalledTimes(1);
    });

    it('builds the Hub on the first press before it has loaded, and opens it', async () => {
        const hub = { isOpen: false, show: vi.fn(() => { hub.isOpen = true; }) };
        const initializeGlobalSerenityHub = vi.fn(() => Promise.resolve(hub));
        vi.stubGlobal('window', { serenityBlocks: { initializeGlobalSerenityHub } });
        stubDocument();
        const controller = new GamepadController();

        expect(controller.toggleSerenityHub()).toBe(true);
        await vi.waitFor(() => expect(hub.show).toHaveBeenCalledTimes(1));
        expect(initializeGlobalSerenityHub).toHaveBeenCalledTimes(1);
    });

    it('over Settings, closes Settings and opens the Hub in its place', () => {
        vi.stubGlobal('window', {});
        const order = [];
        const close = { click: vi.fn(() => order.push('close-settings')) };
        stubDocument({ elements: { 'close-settings': close } });
        const controller = new GamepadController();
        controller.enableSerenityMode({ toggleHub: () => order.push('hub'), isHubOpen: () => false });
        const gamepad = pad();

        hold(gamepad, BUTTON.VIEW);
        controller.processMenuHubButton(gamepad, 0, { name: 'settings', element: {}, sheet: {} });

        expect(order).toEqual(['close-settings', 'hub']);
    });

    it('does nothing over a multiplayer screen (as H does nothing there)', () => {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });
        const gamepad = pad();

        hold(gamepad, BUTTON.VIEW);
        controller.processMenuHubButton(gamepad, 0, { name: 'multiplayer', element: {}, sheet: {} });

        expect(toggleHub).not.toHaveBeenCalled();
    });

    it('keeps one press one toggle across routes (the Hub cooldown is shared)', () => {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });

        expect(controller.toggleSerenityHub()).toBe(true);
        now += 100;
        expect(controller.toggleSerenityHub()).toBe(false);
        now += 500;
        expect(controller.toggleSerenityHub()).toBe(true);
        expect(toggleHub).toHaveBeenCalledTimes(2);
    });
});

describe('the open Hub', () => {
    function openHub() {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        let open = true;
        const callbacks = {
            isHubOpen: () => open,
            navigate: vi.fn(),
            closeHub: vi.fn(() => { open = false; }),
            closeForSettings: vi.fn(() => { open = false; }),
        };
        controller.enableSerenityMode(callbacks);
        const toggleSettings = vi.spyOn(controller, 'toggleSettings').mockImplementation(() => {});
        return { controller, callbacks, toggleSettings };
    }

    it('gives way to Settings on Start (it did nothing), without resuming play between', () => {
        const { controller, callbacks, toggleSettings } = openHub();
        const gamepad = pad();

        hold(gamepad, BUTTON.START);
        controller.processGamepadInput(gamepad, 0);

        expect(callbacks.closeForSettings).toHaveBeenCalledTimes(1);
        expect(callbacks.closeHub).not.toHaveBeenCalled();
        expect(toggleSettings).toHaveBeenCalledWith(0);
    });

    it('repeats a held direction, as the menus do', () => {
        const { controller, callbacks } = openHub();
        const gamepad = pad();

        hold(gamepad, BUTTON.D_RIGHT);
        controller.processGamepadInput(gamepad, 0); // the press
        now += 200;
        controller.processGamepadInput(gamepad, 0); // still waiting for the repeat
        now += 300;
        controller.processGamepadInput(gamepad, 0); // repeat 1 (after 420 ms)
        now += 200;
        controller.processGamepadInput(gamepad, 0); // repeat 2 (180 ms later)

        expect(callbacks.navigate.mock.calls).toEqual([['right'], ['right'], ['right']]);
    });

    it('waits for a direction held from play to be released before it walks the Hub', () => {
        const { controller, callbacks } = openHub();
        const gamepad = pad();
        hold(gamepad, BUTTON.D_LEFT, BUTTON.VIEW);
        controller.latchHubButtons(gamepad, 0);

        controller.processGamepadInput(gamepad, 0);
        expect(callbacks.navigate).not.toHaveBeenCalled();

        hold(gamepad);
        controller.processGamepadInput(gamepad, 0);
        hold(gamepad, BUTTON.D_LEFT);
        controller.processGamepadInput(gamepad, 0);
        expect(callbacks.navigate).toHaveBeenCalledWith('left');
    });
});

describe('Menu (Start) reaches Settings', () => {
    it('is held back while a surface holds Escape from Settings (the Odyssey return)', () => {
        vi.stubGlobal('window', {});
        const gear = { click: vi.fn() };
        stubDocument({
            elements: { 'settings-btn-global': gear },
            selectors: { '[data-blocks-settings]': {} },
        });
        const controller = new GamepadController();

        controller.toggleSettings(0);

        expect(gear.click).not.toHaveBeenCalled();
    });

    it('opens through the gear otherwise', () => {
        vi.stubGlobal('window', {});
        const gear = { click: vi.fn() };
        stubDocument({ elements: { 'settings-btn-global': gear } });
        const controller = new GamepadController();

        controller.toggleSettings(0);

        expect(gear.click).toHaveBeenCalledTimes(1);
    });
});

describe('the right stick scrolls a menu', () => {
    it('scrolls the scroll area that holds the focused control', () => {
        vi.stubGlobal('window', { getComputedStyle: (element) => ({ overflowY: element.overflowY || 'visible' }) });
        const area = {
            overflowY: 'auto', scrollHeight: 900, clientHeight: 300, scrollTop: 0, isConnected: true,
        };
        const focused = { parentElement: area, scrollHeight: 20, clientHeight: 20 };
        const root = {
            contains: (node) => node === area || node === focused,
            querySelectorAll: () => [area],
            scrollHeight: 300,
            clientHeight: 300,
        };
        area.parentElement = root;
        stubDocument({ activeElement: focused });
        const controller = new GamepadController();
        const gamepad = pad();
        gamepad.axes[3] = 1;

        expect(controller.processMenuScroll(gamepad, root)).toBe(true);
        expect(area.scrollTop).toBe(15);
        controller.processMenuScroll(gamepad, root);
        expect(area.scrollTop).toBe(30);

        gamepad.axes[3] = 0.1; // inside the deadzone: nothing moves
        expect(controller.processMenuScroll(gamepad, root)).toBe(false);
        expect(area.scrollTop).toBe(30);
    });
});

describe('a Steam invite on a controller', () => {
    function inviteHarness({ live }) {
        vi.stubGlobal('window', {});
        const accept = { click: vi.fn() };
        const decline = { click: vi.fn() };
        const container = { dataset: {} };
        const toast = {
            classList: { contains: (name) => name === 'invite-toast' },
            parentElement: container,
            querySelector: (selector) => (selector === '.invite-toast-accept' ? accept : decline),
        };
        container.lastElementChild = toast;
        stubDocument({ elements: { 'invite-toast-container': container } });
        const controller = new GamepadController();
        vi.spyOn(controller, 'isInLivePlay').mockReturnValue(live);
        return {
            controller, accept, decline, container,
        };
    }

    it('joins on A and declines on B outside play, and the press goes no further', () => {
        const {
            controller, accept, decline, container,
        } = inviteHarness({ live: false });
        const gamepad = pad();

        hold(gamepad, BUTTON.A);
        expect(controller.processInviteToast(gamepad, 0)).toBe(true);
        expect(accept.click).toHaveBeenCalledTimes(1);
        expect(container.dataset.padAnswers).toBe('buttons');

        hold(gamepad);
        controller.processInviteToast(gamepad, 0);
        now += 100;
        hold(gamepad, BUTTON.B);
        expect(controller.processInviteToast(gamepad, 0)).toBe(true);
        expect(decline.click).toHaveBeenCalledTimes(1);
    });

    it('leaves A and B to the game in play and says Menu first', () => {
        const { controller, accept, container } = inviteHarness({ live: true });
        const gamepad = pad();

        hold(gamepad, BUTTON.A);
        expect(controller.processInviteToast(gamepad, 0)).toBe(false);
        expect(accept.click).not.toHaveBeenCalled();
        expect(container.dataset.padAnswers).toBe('pause');
    });

    it('does not take an A that was already held when the invite appeared', () => {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        const gamepad = pad();
        hold(gamepad, BUTTON.A);
        controller.processInviteToast(gamepad, 0); // no toast yet: A is tracked

        const accept = { click: vi.fn() };
        const container = { dataset: {} };
        container.lastElementChild = {
            classList: { contains: () => true }, parentElement: container, querySelector: () => accept,
        };
        stubDocument({ elements: { 'invite-toast-container': container } });
        vi.spyOn(controller, 'isInLivePlay').mockReturnValue(false);

        expect(controller.processInviteToast(gamepad, 0)).toBe(false);
        expect(accept.click).not.toHaveBeenCalled();
    });
});

describe('a multiplayer screen with nothing focused', () => {
    it('A only places focus (it used to press the first control: Leave)', () => {
        vi.stubGlobal('window', {});
        const leave = {
            click: vi.fn(), focus: vi.fn(), matches: () => false, checkVisibility: () => true,
        };
        const ready = {
            click: vi.fn(), focus: vi.fn(), matches: (selector) => selector.includes('sb-btn--primary'),
            checkVisibility: () => true,
        };
        const layer = {
            contains: () => false,
            querySelectorAll: () => [leave, ready],
        };
        stubDocument({ activeElement: null });
        const controller = new GamepadController();
        vi.spyOn(controller, 'getMenuSheet').mockReturnValue({ name: 'multiplayer', element: layer, sheet: {} });

        controller.activateMenuItem();

        expect(ready.focus).toHaveBeenCalled();
        expect(leave.click).not.toHaveBeenCalled();
        expect(ready.click).not.toHaveBeenCalled();
    });
});

describe('R3 in play: the mode\'s overview', () => {
    it('calls the registered handler once per press (online versus: the scoreboard)', () => {
        vi.stubGlobal('window', {});
        stubDocument();
        const controller = new GamepadController();
        const handler = vi.fn();
        controller.setInfoButtonHandler(handler);
        const gamepad = pad();

        hold(gamepad, BUTTON.R3);
        controller.processGamepadInput(gamepad, 0);
        controller.processGamepadInput(gamepad, 0);
        expect(handler).toHaveBeenCalledTimes(1);

        controller.setInfoButtonHandler(null);
        hold(gamepad);
        controller.processGamepadInput(gamepad, 0);
        hold(gamepad, BUTTON.R3);
        controller.processGamepadInput(gamepad, 0);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('Serenity\'s pad layout v2', () => {
    it('gives an untouched old layout View for the Hub and Y for the hints', () => {
        const old = { toggleHub: BUTTON.Y, toggleControlHints: BUTTON.VIEW, toggleBreathing: BUTTON.X };
        expect(migrateSerenityPadLayout(old, undefined)).toEqual({
            toggleHub: BUTTON.VIEW, toggleControlHints: BUTTON.Y, toggleBreathing: BUTTON.X,
        });
    });

    it('keeps a player\'s own choice, and never runs twice', () => {
        const own = { toggleHub: BUTTON.Y, toggleControlHints: BUTTON.LB };
        expect(migrateSerenityPadLayout(own, 1)).toBe(own);
        const chosenAfter = { toggleHub: BUTTON.Y, toggleControlHints: BUTTON.VIEW };
        expect(migrateSerenityPadLayout(chosenAfter, CONTROLLER_LAYOUT_VERSION)).toBe(chosenAfter);
    });

    it('is the controller\'s default: View is the Hub, Y the hints', () => {
        vi.stubGlobal('window', {});
        const bindings = new GamepadController().getSerenityGamepadBindings();
        expect(bindings.toggleHub).toBe(BUTTON.VIEW);
        expect(bindings.toggleControlHints).toBe(BUTTON.Y);
    });
});

describe('a saved settings file from before View was the Hub\'s button', () => {
    async function loadSaved(saved) {
        const { SettingsManager } = await import('../../src/ui/settings.js');
        const store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key),
        });
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        const manager = new SettingsManager();
        store.set(manager.STORAGE_KEY, JSON.stringify(saved));
        manager.load();
        return { manager, stored: () => JSON.parse(store.get(manager.STORAGE_KEY)) };
    }

    it('takes the new layout once, and saves it with the layout version', async () => {
        const { manager, stored } = await loadSaved({
            serenityGamepadBindings: { toggleHub: BUTTON.Y, toggleControlHints: BUTTON.VIEW },
        });
        const bindings = manager.get().serenityGamepadBindings;

        expect(bindings.toggleHub).toBe(BUTTON.VIEW);
        expect(bindings.toggleControlHints).toBe(BUTTON.Y);
        expect(stored().controllerLayoutVersion).toBe(CONTROLLER_LAYOUT_VERSION);
    });

    it('keeps the old pair when the player chose it after the change', async () => {
        const { manager } = await loadSaved({
            controllerLayoutVersion: CONTROLLER_LAYOUT_VERSION,
            serenityGamepadBindings: { toggleHub: BUTTON.Y, toggleControlHints: BUTTON.VIEW },
        });

        expect(manager.get().serenityGamepadBindings.toggleHub).toBe(BUTTON.Y);
    });
});

describe('a menu over a look around the tower', () => {
    it('ends the look before the mode pauses (the gear, Start and the Hub, as Escape does)', async () => {
        const { GameModeManager } = await import('../../src/core/game-modes/GameModeManager.js');
        const order = [];
        const mode = {
            isRunning: true,
            endExplorationForMenu: vi.fn(() => order.push('end look')),
            onPause: vi.fn((options) => order.push(['pause', options])),
        };
        const manager = Object.create(GameModeManager.prototype);
        manager.currentMode = mode;
        manager.currentModeId = 'infinity';
        manager._emitEvent = () => {};

        manager.pauseCurrentMode({ endLook: true });
        manager.pauseCurrentMode();

        expect(order).toEqual(['end look', ['pause', {}], ['pause', {}]]);
    });
});

describe('the online scoreboard on a controller', () => {
    it('takes R3 while it lives, and lets it go when destroyed', async () => {
        const { MultiplayerScoreboardOverlay } = await import('../../src/ui/multiplayer-scoreboard-overlay.js');
        stubDocument();
        const controller = new GamepadController();
        vi.stubGlobal('window', { gamepadController: controller });
        vi.spyOn(MultiplayerScoreboardOverlay.prototype, 'createUI').mockImplementation(() => {});
        const toggle = vi.spyOn(MultiplayerScoreboardOverlay.prototype, 'toggle').mockImplementation(() => {});

        const overlay = new MultiplayerScoreboardOverlay();
        controller.infoButtonHandler();
        expect(toggle).toHaveBeenCalledTimes(1);

        overlay.destroy();
        expect(controller.infoButtonHandler).toBe(null);
    });
});
