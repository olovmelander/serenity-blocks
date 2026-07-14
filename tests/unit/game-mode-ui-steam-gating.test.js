import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEAM_EVENTS } from '../../src/core/steam/steam-config.js';

function createClassList() {
    const values = new Set();
    return {
        add: (...tokens) => tokens.forEach((token) => values.add(token)),
        remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
        toggle: (token, force) => {
            const shouldAdd = force === undefined ? !values.has(token) : !!force;
            if (shouldAdd) {
                values.add(token);
            } else {
                values.delete(token);
            }
        },
        contains: (token) => values.has(token),
    };
}

function createButtonElement() {
    const attributes = new Map();
    return {
        dataset: {},
        classList: createClassList(),
        addEventListener: vi.fn(),
        setAttribute: vi.fn((name, value) => {
            attributes.set(name, String(value));
        }),
        getAttribute: vi.fn((name) => attributes.get(name)),
        title: '',
    };
}

describe('GameModeUI Steam gating', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unmock('../../src/core/steam/steam-service.js');
        vi.unstubAllGlobals();
    });

    it('maps Steam states to the expected card copy', async () => {
        const { resolveOnlineMultiplayerAvailability } = await import('../../src/ui/game-mode-ui.js');

        expect(resolveOnlineMultiplayerAvailability('connecting')).toEqual({
            enabled: false,
            disabledLabel: 'Connecting to Steam',
            title: 'Connecting to Steam',
        });
        expect(resolveOnlineMultiplayerAvailability('offline')).toEqual({
            enabled: false,
            disabledLabel: 'Steam offline',
            title: 'Steam is offline',
        });
        expect(resolveOnlineMultiplayerAvailability('no_steam')).toEqual({
            enabled: false,
            disabledLabel: 'Steam required',
            title: 'Requires Steam connection',
        });
        expect(resolveOnlineMultiplayerAvailability('connected')).toEqual({
            enabled: true,
            disabledLabel: '',
            title: '',
        });
    });

    it('enables the online multiplayer card after a delayed Steam state change', async () => {
        const listeners = new Map();
        let connectionState = 'connecting';
        const fakeSteamService = {
            on: vi.fn((event, callback) => {
                const channelListeners = listeners.get(event) || [];
                channelListeners.push(callback);
                listeners.set(event, channelListeners);
                return () => {
                    const nextListeners = (listeners.get(event) || []).filter((entry) => entry !== callback);
                    listeners.set(event, nextListeners);
                };
            }),
            getConnectionState: vi.fn(() => connectionState),
        };

        vi.doMock('../../src/core/steam/steam-service.js', () => ({
            default: fakeSteamService,
        }));

        const onlineButton = createButtonElement();
        const documentStub = {
            getElementById: vi.fn((id) => (id === 'online-multiplayer-card-btn' ? onlineButton : null)),
        };
        vi.stubGlobal('document', documentStub);

        const { GameModeUI } = await import('../../src/ui/game-mode-ui.js');
        const gameModeUi = new GameModeUI();

        expect(onlineButton.dataset.disabled).toBe('true');
        expect(onlineButton.dataset.disabledLabel).toBe('Connecting to Steam');
        expect(onlineButton.title).toBe('Connecting to Steam');

        connectionState = 'connected';
        const stateChangeListeners = listeners.get(STEAM_EVENTS.STATE_CHANGED) || [];
        stateChangeListeners.forEach((listener) => listener({ state: 'connected' }));

        expect(onlineButton.dataset.disabled).toBe('false');
        expect(onlineButton.dataset.disabledLabel).toBe('');
        expect(onlineButton.title).toBe('');
        expect(gameModeUi.isOnlineMultiplayerDisabled()).toBe(false);
    });

    it('does not attach Odyssey preload intent handlers before the mode starts', async () => {
        const fakeSteamService = {
            on: vi.fn(() => () => {}),
            getConnectionState: vi.fn(() => 'connected'),
        };

        vi.doMock('../../src/core/steam/steam-service.js', () => ({
            default: fakeSteamService,
        }));

        const odysseyButton = createButtonElement();
        const documentStub = {
            getElementById: vi.fn((id) => (id === 'odyssey-card-btn' ? odysseyButton : null)),
        };
        vi.stubGlobal('document', documentStub);

        const { GameModeUI } = await import('../../src/ui/game-mode-ui.js');
        new GameModeUI();

        const odysseyEvents = odysseyButton.addEventListener.mock.calls.map(([eventName]) => eventName);
        // Activation handlers only (pointer click + keyboard Enter/Space); no
        // preload-intent handlers (pointerenter/focus/touchstart) are attached
        // before the mode starts.
        expect(odysseyEvents).toEqual(['click', 'keydown']);
        expect(odysseyEvents).not.toContain('pointerenter');
        expect(odysseyEvents).not.toContain('focus');
        expect(odysseyEvents).not.toContain('touchstart');
    });
});
