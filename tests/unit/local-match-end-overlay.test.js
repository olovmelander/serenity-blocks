import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// Just what the results overlay touches: one element, its two buttons, window listeners.
function fakeElement() {
    const classes = new Set();
    const buttons = new Map();
    return {
        id: '',
        className: '',
        innerHTML: '',
        style: { setProperty: vi.fn() },
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute: vi.fn(),
        addEventListener: vi.fn(),
        querySelector(selector) {
            if (!buttons.has(selector)) buttons.set(selector, { addEventListener: vi.fn(), focus: vi.fn() });
            return buttons.get(selector);
        },
        querySelectorAll: () => [],
        remove: vi.fn(),
    };
}

function setup() {
    const listeners = new Map();
    const overlay = fakeElement();
    vi.stubGlobal('document', {
        body: { appendChild: vi.fn() },
        createElement: () => overlay,
        getElementById: () => null,
    });
    vi.stubGlobal('window', {
        addEventListener: (type, handler) => listeners.set(type, [...(listeners.get(type) || []), handler]),
        removeEventListener: (type, handler) => listeners.set(type, (listeners.get(type) || []).filter((h) => h !== handler)),
        matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const emit = (type, detail) => (listeners.get(type) || []).forEach((handler) => handler({ detail }));
    return { overlay, listeners, emit };
}

const PLAYERS = [
    {
        name: 'Ada', color: '#f5aed0', isWinner: true, score: 900, frags: 7,
    },
    {
        name: 'Bot 2', color: '#94c8ff', isWinner: false, score: 400, frags: 2,
    },
];

describe('local versus results overlay', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('leaves with the results when anything else brings back the main menu', async () => {
        const { overlay, listeners, emit } = setup();
        const onMainMenu = vi.fn();
        const onPlayAgain = vi.fn();
        const { showLocalMatchEnd } = await import('../../src/ui/local-match-end-overlay.js');
        showLocalMatchEnd({
            title: 'Ada wins', winCondition: 'First to 7 frags', players: PLAYERS, onPlayAgain, onMainMenu,
        });

        // Another sheet over the results is not the menu.
        emit('modalShown', { modalName: 'settings' });
        expect(overlay.classList.contains('is-leaving')).toBe(false);

        emit('modalShown', { modalName: 'start' });
        expect(overlay.classList.contains('is-leaving')).toBe(true);
        vi.runAllTimers();
        expect(overlay.remove).toHaveBeenCalledTimes(1);
        // The menu is already up: neither choice runs again.
        expect(onMainMenu).not.toHaveBeenCalled();
        expect(onPlayAgain).not.toHaveBeenCalled();
        expect(listeners.get('modalShown')).toEqual([]);
    });

    it('stops listening once a choice on the results has been made', async () => {
        const { overlay, listeners } = setup();
        const onMainMenu = vi.fn();
        const { showLocalMatchEnd } = await import('../../src/ui/local-match-end-overlay.js');
        showLocalMatchEnd({
            title: 'Ada wins', winCondition: 'First to 7 frags', players: PLAYERS, onPlayAgain: vi.fn(), onMainMenu,
        });
        const [[, mainMenuClick]] = overlay.querySelector('#return-to-menu-btn').addEventListener.mock.calls;
        mainMenuClick();
        expect(listeners.get('modalShown')).toEqual([]);
        vi.runAllTimers();
        expect(onMainMenu).toHaveBeenCalledTimes(1);
        expect(overlay.remove).toHaveBeenCalledTimes(1);
    });
});
