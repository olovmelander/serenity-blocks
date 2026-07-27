import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    setupClickControls,
    setupKeyboardControls,
} from '../../src/ui/controls.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { SerenityHub } from '../../src/ui/serenity-hub/SerenityHub.js';
import { ThemesTab } from '../../src/ui/serenity-hub/ThemesTab.js';

function installClickDocument({ visibleModal = 'start-modal', hubOpen = false } = {}) {
    const listeners = new Map();
    const visibleModalElement = {
        classList: {
            contains: vi.fn((className) => className === 'visible'),
        },
    };
    const documentStub = {
        body: {
            classList: {
                contains: vi.fn(
                    (className) => hubOpen && className === 'serenity-hub-open',
                ),
            },
        },
        addEventListener: vi.fn((eventName, listener) => {
            listeners.set(eventName, listener);
        }),
        removeEventListener: vi.fn(),
        getElementById: vi.fn(
            (id) => (id === visibleModal ? visibleModalElement : null),
        ),
    };

    vi.stubGlobal('document', documentStub);
    return { documentStub, listeners };
}

function setupGlobalClickHarness(options) {
    const { documentStub, listeners } = installClickDocument(options);
    const inputController = {
        soundInitialized: true,
        removeClickControls: vi.fn(),
        handleClick: null,
    };
    const startGame = vi.fn();

    setupClickControls(inputController, startGame, vi.fn());

    return {
        documentStub,
        handleClick: listeners.get('click'),
        startGame,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('theme selection is isolated from global game-start clicks', () => {
    it('does not start the game when a semantic theme-card button is clicked', () => {
        const { handleClick, startGame } = setupGlobalClickHarness({
            visibleModal: 'start-modal',
        });
        const themeCard = {
            dataset: { theme: 'neon-district' },
        };
        const closest = vi.fn(
            (selector) => (selector === '[role="button"]' ? themeCard : null),
        );

        handleClick({ target: { closest } });

        expect(closest).toHaveBeenCalledWith('[role="button"]');
        expect(startGame).not.toHaveBeenCalled();
    });

    it.each(['start-modal', 'game-over-modal'])(
        'does not start the game from any hub click while %s is visible underneath',
        (visibleModal) => {
            const { documentStub, handleClick, startGame } = setupGlobalClickHarness({
                visibleModal,
                hubOpen: true,
            });

            handleClick({
                target: {
                    closest: vi.fn(() => null),
                },
            });

            expect(documentStub.body.classList.contains)
                .toHaveBeenCalledWith('serenity-hub-open');
            expect(startGame).not.toHaveBeenCalled();
        },
    );

    it('retains the normal background-click start behavior when the hub is closed', () => {
        const { handleClick, startGame } = setupGlobalClickHarness({
            visibleModal: 'start-modal',
        });

        handleClick({
            target: {
                closest: vi.fn(() => null),
            },
        });

        expect(startGame).toHaveBeenCalledOnce();
    });
});

describe('theme selection is isolated from global game-start keys', () => {
    it.each([
        ['Enter', 'start-modal'],
        ['Space', 'start-modal'],
        ['Enter', 'game-over-modal'],
        ['Space', 'game-over-modal'],
    ])(
        'does not start the game on %s while the hub covers a visible %s',
        (label, visibleModal) => {
            const listeners = new Map();
            const documentStub = {
                activeElement: null,
                body: {
                    classList: {
                        contains: vi.fn(
                            (className) => className === 'serenity-hub-open',
                        ),
                    },
                },
                addEventListener: vi.fn((eventName, listener) => {
                    listeners.set(eventName, listener);
                }),
                removeEventListener: vi.fn(),
                getElementById: vi.fn((id) => {
                    if (id === 'settings-modal') return null;
                    if (id === visibleModal) {
                        return {
                            classList: {
                                contains: vi.fn(
                                    (className) => className === 'visible',
                                ),
                            },
                        };
                    }
                    return null;
                }),
            };
            vi.stubGlobal('document', documentStub);
            vi.stubGlobal('window', { settings: null });

            const inputController = {
                soundInitialized: true,
                keyMap: {},
                clearTimers: vi.fn(),
                removeKeyboardControls: vi.fn(),
            };
            const startGame = vi.fn();
            setupKeyboardControls(
                inputController,
                { keyBindings: {} },
                { startGame },
            );

            listeners.get('keydown')({
                key: label === 'Space' ? ' ' : label,
                preventDefault: vi.fn(),
            });

            expect(documentStub.body.classList.contains)
                .toHaveBeenCalledWith('serenity-hub-open');
            expect(startGame).not.toHaveBeenCalled();
        },
    );

    it('does not open Settings underneath the hub when Escape is pressed', () => {
        const listeners = new Map();
        vi.stubGlobal('document', {
            activeElement: null,
            body: {
                classList: {
                    contains: vi.fn(
                        (className) => className === 'serenity-hub-open',
                    ),
                },
            },
            addEventListener: vi.fn((eventName, listener) => {
                listeners.set(eventName, listener);
            }),
            removeEventListener: vi.fn(),
            getElementById: vi.fn(() => null),
        });
        vi.stubGlobal('window', { settings: null });

        const inputController = {
            soundInitialized: true,
            keyMap: {},
            clearTimers: vi.fn(),
            removeKeyboardControls: vi.fn(),
        };
        const openSettingsMenu = vi.fn();
        setupKeyboardControls(
            inputController,
            { keyBindings: {} },
            { openSettingsMenu },
        );

        listeners.get('keydown')({
            key: 'Escape',
            preventDefault: vi.fn(),
        });

        expect(openSettingsMenu).not.toHaveBeenCalled();
    });
});

describe('Serenity Hub owns close navigation', () => {
    it('consumes Escape before mode-level exit handlers can stop the game', () => {
        const listeners = new Map();
        vi.stubGlobal('document', {
            addEventListener: vi.fn((eventName, listener) => {
                listeners.set(eventName, listener);
            }),
        });

        const hub = Object.create(SerenityHub.prototype);
        hub.abortController = new AbortController();
        hub.isOpen = true;
        hub.panel = {
            addEventListener: vi.fn(),
            querySelectorAll: vi.fn(() => []),
        };
        hub.tabAbortControllers = new Map();
        hub.tabElements = [];
        hub.hide = vi.fn();
        hub.attachEventListeners();

        const event = {
            key: 'Escape',
            preventDefault: vi.fn(),
            stopImmediatePropagation: vi.fn(),
        };
        listeners.get('keydown')(event);

        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
        expect(hub.hide).toHaveBeenCalledOnce();
    });
});

describe('ThemesTab owns keyboard activation of theme cards', () => {
    it.each([
        ['Enter', 'Enter'],
        ['Space', ' '],
    ])('claims %s and selects the card exactly once', (_label, key) => {
        const listeners = new Map();
        const themeCard = {
            dataset: { theme: 'neon-district' },
        };
        const tabContainer = {
            addEventListener: vi.fn((eventName, listener) => {
                listeners.set(eventName, listener);
            }),
            contains: vi.fn((element) => element === themeCard),
            querySelector: vi.fn(() => null),
        };
        vi.stubGlobal('document', {
            getElementById: vi.fn(
                (id) => (id === 'tab-themes' ? tabContainer : null),
            ),
        });

        const tab = Object.create(ThemesTab.prototype);
        tab.selectTheme = vi.fn(async () => undefined);
        tab.attachThemeParamListeners = vi.fn();
        tab.attachEventListeners();

        const event = {
            key,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            target: {
                closest: vi.fn(
                    (selector) => (selector === '.theme-card' ? themeCard : null),
                ),
            },
        };

        listeners.get('keydown')(event);

        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(tab.selectTheme).toHaveBeenCalledOnce();
        expect(tab.selectTheme).toHaveBeenCalledWith('neon-district');
    });
});

describe('Serenity Hub owns gamepad theme confirmation', () => {
    it('does not open Settings underneath the Hub when Start is pressed', () => {
        const buttons = Array.from(
            { length: 16 },
            () => ({ pressed: false, value: 0 }),
        );
        buttons[9] = { pressed: true, value: 1 };
        const freshGamepad = {
            axes: [0, 0, 0, 0],
            buttons,
            index: 0,
        };
        vi.stubGlobal('window', { settings: {} });
        vi.stubGlobal('navigator', {
            getGamepads: vi.fn(() => [freshGamepad]),
        });
        vi.stubGlobal('document', {
            body: {
                classList: {
                    contains: vi.fn(() => true),
                },
            },
            getElementById: vi.fn(() => null),
        });

        const controller = new GamepadController();
        controller.enabled = true;
        controller.connected[0] = true;
        controller.gamepads[0] = { index: 0 };
        controller.serenityModeActive = true;
        controller.serenityModeCallbacks = {
            isHubOpen: () => true,
        };
        const settingsSpy = vi.spyOn(controller, 'toggleSettings');

        controller.poll();

        expect(settingsSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['game-over restart', true, false],
        ['game-mode selection', false, true],
    ])(
        'does not leak A to the underlying %s route',
        (_route, gameOverVisible, gameModeSelectionEnabled) => {
            const buttons = Array.from(
                { length: 16 },
                () => ({ pressed: false, value: 0 }),
            );
            buttons[0] = { pressed: true, value: 1 };
            const freshGamepad = {
                axes: [0, 0, 0, 0],
                buttons,
                index: 0,
            };
            const startGame = vi.fn();
            vi.stubGlobal('window', {
                settings: {},
                startGame,
            });
            vi.stubGlobal('navigator', {
                getGamepads: vi.fn(() => [freshGamepad]),
            });
            vi.stubGlobal('document', {
                body: {
                    classList: {
                        contains: vi.fn(() => true),
                    },
                },
                getElementById: vi.fn((id) => {
                    if (id !== 'game-over-modal' || !gameOverVisible) return null;
                    return {
                        classList: {
                            contains: vi.fn(
                                (className) => className === 'visible',
                            ),
                        },
                    };
                }),
            });

            const controller = new GamepadController();
            const confirmSelection = vi.fn();
            controller.enabled = true;
            controller.connected[0] = true;
            controller.gamepads[0] = { index: 0 };
            controller.gameModeSelectionEnabled = gameModeSelectionEnabled;
            controller.serenityModeActive = true;
            controller.serenityModeCallbacks = {
                confirmSelection,
                isHubOpen: () => true,
            };
            const gameOverSpy = vi.spyOn(controller, 'processGameOverInput');
            const gameModeSpy = vi.spyOn(controller, 'processGameModeSelection');

            controller.poll();

            expect(confirmSelection).toHaveBeenCalledOnce();
            expect(gameOverSpy).not.toHaveBeenCalled();
            expect(gameModeSpy).not.toHaveBeenCalled();
            expect(startGame).not.toHaveBeenCalled();
        },
    );

    it('requires a neutral release after B closes over a game-over modal', () => {
        const buttons = Array.from(
            { length: 16 },
            () => ({ pressed: false, value: 0 }),
        );
        buttons[1] = { pressed: true, value: 1 };
        const freshGamepad = {
            axes: [0, 0, 0, 0],
            buttons,
            index: 0,
        };
        const startGame = vi.fn();
        let hubOpen = true;
        vi.stubGlobal('window', {
            settings: {},
            startGame,
        });
        vi.stubGlobal('navigator', {
            getGamepads: vi.fn(() => [freshGamepad]),
        });
        vi.stubGlobal('document', {
            body: {
                classList: {
                    contains: vi.fn(() => hubOpen),
                },
            },
            getElementById: vi.fn((id) => {
                if (id !== 'game-over-modal') return null;
                return {
                    classList: {
                        contains: vi.fn(
                            (className) => className === 'visible',
                        ),
                    },
                };
            }),
        });

        const controller = new GamepadController();
        const closeHub = vi.fn(() => {
            hubOpen = false;
        });
        controller.enabled = true;
        controller.connected[0] = true;
        controller.gamepads[0] = { index: 0 };
        controller.serenityModeActive = true;
        controller.serenityModeCallbacks = {
            closeHub,
            isHubOpen: () => hubOpen,
        };

        controller.poll();
        expect(closeHub).toHaveBeenCalledOnce();

        // The same physical B press is still held on the first poll after the
        // panel closes. It must not be reinterpreted as a fresh restart.
        controller.poll();
        expect(startGame).not.toHaveBeenCalled();

        buttons[1] = { pressed: false, value: 0 };
        controller.poll();
        buttons[1] = { pressed: true, value: 1 };
        controller.poll();

        expect(startGame).toHaveBeenCalledOnce();
    });
});
