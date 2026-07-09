import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createSettingsScrollPerformanceController,
} from '../../src/ui/modals.js';
import {
    activateControlsSubtab,
    activateSettingsTab,
    initializeSettingsUI,
} from '../../src/ui/settings.js';

function createClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add(name) {
            classes.add(name);
        },
        remove(name) {
            classes.delete(name);
        },
        toggle(name, force) {
            if (force === undefined) {
                if (classes.has(name)) {
                    classes.delete(name);
                    return false;
                }
                classes.add(name);
                return true;
            }

            if (force) {
                classes.add(name);
                return true;
            }

            classes.delete(name);
            return false;
        },
        contains(name) {
            return classes.has(name);
        },
    };
}

function createNode({ id = null, dataset = {}, active = false } = {}) {
    return {
        id,
        dataset,
        classList: createClassList(active ? ['active'] : []),
    };
}

function createSettingsModalHarness() {
    const gameplayTab = createNode({ dataset: { tab: 'gameplay' }, active: true });
    const controlsTabButton = createNode({ dataset: { tab: 'controls' } });
    const gameplayPanel = createNode({ id: 'settings-gameplay', active: true });
    const controlsPanel = createNode({ id: 'settings-controls' });
    const player1Subtab = createNode({ dataset: { subtab: 'player1' }, active: true });
    const player2Subtab = createNode({ dataset: { subtab: 'player2' } });
    const player1Panel = createNode({ id: 'controls-player1', active: true });
    const player2Panel = createNode({ id: 'controls-player2' });

    controlsPanel.querySelectorAll = (selector) => {
        if (selector === '.controls-subtab') {
            return [player1Subtab, player2Subtab];
        }
        if (selector === '.controls-subtab-content') {
            return [player1Panel, player2Panel];
        }
        return [];
    };
    controlsPanel.querySelector = (selector) => {
        if (selector === '#controls-player1') return player1Panel;
        if (selector === '#controls-player2') return player2Panel;
        if (selector === '.controls-subtab[data-subtab="player1"]') return player1Subtab;
        if (selector === '.controls-subtab[data-subtab="player2"]') return player2Subtab;
        return null;
    };

    const settingsModal = {
        querySelectorAll(selector) {
            if (selector === '.settings-tab') {
                return [gameplayTab, controlsTabButton];
            }
            if (selector === '.settings-tab-content') {
                return [gameplayPanel, controlsPanel];
            }
            return [];
        },
        querySelector(selector) {
            if (selector === '.settings-tab[data-tab="gameplay"]') return gameplayTab;
            if (selector === '.settings-tab[data-tab="controls"]') return controlsTabButton;
            if (selector === '#settings-gameplay') return gameplayPanel;
            if (selector === '#settings-controls') return controlsPanel;
            return null;
        },
    };

    return {
        settingsModal,
        controlsPanel,
        gameplayTab,
        controlsTabButton,
        gameplayPanel,
        player1Subtab,
        player2Subtab,
        player1Panel,
        player2Panel,
    };
}

describe('settings modal interactions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('keeps settings tabs clickable by toggling the active tab in place', () => {
        const harness = createSettingsModalHarness();

        const changed = activateSettingsTab(harness.settingsModal, 'controls');

        expect(changed).toBe(true);
        expect(harness.gameplayTab.classList.contains('active')).toBe(false);
        expect(harness.controlsTabButton.classList.contains('active')).toBe(true);
        expect(harness.gameplayPanel.classList.contains('active')).toBe(false);
        expect(harness.controlsPanel.classList.contains('active')).toBe(true);
    });

    it('keeps controls subtabs clickable while the settings modal is open', () => {
        const harness = createSettingsModalHarness();

        const changed = activateControlsSubtab(harness.controlsPanel, 'player2');

        expect(changed).toBe(true);
        expect(harness.player1Subtab.classList.contains('active')).toBe(false);
        expect(harness.player2Subtab.classList.contains('active')).toBe(true);
        expect(harness.player1Panel.classList.contains('active')).toBe(false);
        expect(harness.player2Panel.classList.contains('active')).toBe(true);
    });

    it('clears settings scroll performance mode when the modal visibility changes', () => {
        const body = { classList: createClassList() };
        const settingsModal = {
            classList: createClassList(['visible']),
        };
        const scrollContainer = {};

        let rafCallback = null;
        vi.stubGlobal('document', { body });
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            rafCallback = callback;
            return 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const controller = createSettingsScrollPerformanceController(settingsModal, scrollContainer);
        controller.onSettingsScroll();
        rafCallback();

        expect(settingsModal.classList.contains('is-scrolling')).toBe(true);
        expect(body.classList.contains('settings-scroll-active')).toBe(true);

        controller.onModalHidden({ detail: { modalName: 'settings' } });
        expect(settingsModal.classList.contains('is-scrolling')).toBe(false);
        expect(body.classList.contains('settings-scroll-active')).toBe(false);

        controller.onSettingsScroll();
        rafCallback();
        expect(settingsModal.classList.contains('is-scrolling')).toBe(true);

        controller.onModalShown({ detail: { modalName: 'settings' } });
        expect(settingsModal.classList.contains('is-scrolling')).toBe(false);
        expect(body.classList.contains('settings-scroll-active')).toBe(false);
    });

    it('synchronizes the background-mode element value when settingsChanged is fired', () => {
        const createDummyElement = (type = 'div') => ({
            style: {},
            classList: createClassList(),
            addEventListener: vi.fn(),
            value: '',
            checked: false,
        });

        const bgModeSelect = createDummyElement('select');
        bgModeSelect.value = 'Level';

        const body = { classList: createClassList() };

        const listeners = [];
        const windowMock = {
            electronAPI: {},
            dispatchEvent: vi.fn((event) => {
                listeners.forEach(({ type, handler }) => {
                    if (type === event.type) {
                        handler(event);
                    }
                });
            }),
            addEventListener: vi.fn((type, handler) => {
                listeners.push({ type, handler });
            }),
            removeEventListener: vi.fn(),
        };

        vi.stubGlobal('window', windowMock);

        vi.stubGlobal('document', {
            body,
            getElementById: vi.fn((id) => {
                if (id === 'background-mode') return bgModeSelect;
                return createDummyElement();
            }),
            querySelectorAll: vi.fn(() => []),
            querySelector: vi.fn(() => null),
        });

        const settings = {
            backgroundMode: 'Level',
            musicVolume: 0.5,
            sfxVolume: 0.5,
            randomThemeInterval: 300,
        };

        const settingsManager = {
            get: vi.fn(() => settings),
            update: vi.fn((newSettings) => {
                Object.assign(settings, newSettings);
            }),
            save: vi.fn(),
        };

        const callbacks = {};

        initializeSettingsUI(settingsManager, callbacks);

        // Update mock settings to have Specific mode
        settings.backgroundMode = 'Specific';

        // Dispatch settingsChanged
        const event = {
            type: 'settingsChanged',
            detail: { backgroundMode: 'Specific' },
        };
        windowMock.dispatchEvent(event);

        expect(bgModeSelect.value).toBe('Specific');
    });
});
