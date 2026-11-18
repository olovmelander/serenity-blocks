/**
 * The pad press that answers a Settings binding capture is the capture's alone (audit
 * 2026-11-18, A18-UI-2).
 *
 * The capture (settings.js) reads the pads on its own timer and ends as soon as it takes a
 * press, so menu navigation could see that same press, still held, a frame later as a fresh
 * one: View bound to Pause also closed Settings and opened the Hub, Start could close
 * Settings and LB/RB switch its tab.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

const BUTTON = Object.freeze({
    RB: 5, VIEW: 8, START: 9,
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

function classes(...names) {
    const set = new Set(names);
    return {
        add: (name) => set.add(name),
        remove: (name) => set.delete(name),
        contains: (name) => set.has(name),
    };
}

/** Settings open with one binding tile, and the gear's close button. */
function openSettings() {
    const tile = { id: 'gamepad-pause', classList: classes('key-input') };
    const attributes = {};
    const settings = {
        id: 'settings-modal',
        classList: classes('modal', 'visible'),
        getAttribute: (name) => attributes[name] ?? null,
        setAttribute: (name, value) => { attributes[name] = String(value); },
        querySelector: (selector) => (selector === '.listening' && tile.classList.contains('listening') ? tile : null),
        querySelectorAll: () => [],
        contains: () => false,
    };
    const close = { click: vi.fn() };
    const activeTab = { classList: classes('settings-tab', 'active'), click: vi.fn(), focus() {} };
    const nextTab = { classList: classes('settings-tab'), click: vi.fn(), focus() {} };
    const elements = { 'settings-modal': settings, 'close-settings': close };
    vi.stubGlobal('document', {
        addEventListener() {},
        removeEventListener() {},
        getElementById: (id) => elements[id] || null,
        querySelector: (selector) => {
            if (selector === '#settings-modal .key-input.listening') {
                return tile.classList.contains('listening') ? tile : null;
            }
            return selector === '.settings-tab.active' ? activeTab : null;
        },
        querySelectorAll: (selector) => (selector === '.settings-tab' ? [activeTab, nextTab] : []),
        body: { classList: classes() },
        activeElement: null,
    });
    vi.stubGlobal('window', {});
    // What settings.js does when the capture takes its press (cancel → noteCaptureEnded).
    const endCapture = () => {
        tile.classList.remove('listening');
        settings.setAttribute('data-capture-ended', Date.now());
    };
    return {
        tile, close, nextTab, endCapture,
    };
}

let now = 10000;

/** Both clocks: the controller's (performance) and the capture stamp's (Date). */
function later(ms) {
    now += ms;
    vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
    now = 10000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the press that answers a binding capture', () => {
    it('does not also close Settings and open the Hub (View bound to Pause)', () => {
        const { tile, close, endCapture } = openSettings();
        const controller = new GamepadController();
        const toggleHub = vi.fn();
        controller.enableSerenityMode({ toggleHub, isHubOpen: () => false });
        const gamepad = pad();

        tile.classList.add('listening');
        hold(gamepad, BUTTON.VIEW);
        controller.processMenuNavigation(gamepad, 0); // the poll sees View while listening
        endCapture(); // the capture's timer takes View for Pause
        later(16);
        controller.processMenuNavigation(gamepad, 0); // View still held

        expect(close.click).not.toHaveBeenCalled();
        expect(toggleHub).not.toHaveBeenCalled();
    });

    it('does not also close Settings when the capture takes Start before the poll sees it', () => {
        const { tile, close, endCapture } = openSettings();
        const controller = new GamepadController();
        const gamepad = pad();

        tile.classList.add('listening');
        controller.processMenuNavigation(gamepad, 0); // nothing held yet
        hold(gamepad, BUTTON.START);
        endCapture(); // the capture's timer runs first
        later(16);
        controller.processMenuNavigation(gamepad, 0);
        later(400); // past the moment the capture ended, Start still held
        controller.processMenuNavigation(gamepad, 0);

        expect(close.click).not.toHaveBeenCalled();
    });

    it('does not also switch the Settings tab (RB taken first by the capture)', () => {
        const { tile, nextTab, endCapture } = openSettings();
        const controller = new GamepadController();
        const gamepad = pad();

        tile.classList.add('listening');
        controller.processMenuNavigation(gamepad, 0);
        hold(gamepad, BUTTON.RB);
        endCapture();
        later(16);
        controller.processMenuNavigation(gamepad, 0);
        expect(nextTab.click).not.toHaveBeenCalled();

        // Released, then pressed again: RB is the menu's again.
        hold(gamepad);
        later(400);
        controller.processMenuNavigation(gamepad, 0);
        hold(gamepad, BUTTON.RB);
        later(16);
        controller.processMenuNavigation(gamepad, 0);
        expect(nextTab.click).toHaveBeenCalledTimes(1);
    });
});
