import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEAM_EVENTS, STEAM_IPC } from '../../src/core/steam/steam-config.js';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => {
            store.set(key, String(value));
        }),
        removeItem: vi.fn((key) => {
            store.delete(key);
        }),
        clear: vi.fn(() => {
            store.clear();
        }),
    };
}

function createElectronApiHarness(initialStatus) {
    const listeners = new Map();
    let status = { ...initialStatus };

    const emit = async (channel, payload) => {
        const channelListeners = listeners.get(channel) || [];
        await Promise.all(channelListeners.map((listener) => listener(payload)));
    };

    return {
        electronAPI: {
            invoke: vi.fn(async (channel) => {
                const usable = Boolean(status.connected || (status.initialized && status.pending));
                if (channel === STEAM_IPC.GET_CONNECTION_STATUS) {
                    return {
                        ...status,
                        isOnline: usable,
                    };
                }
                if (channel === STEAM_IPC.GET_CAPABILITIES) {
                    return {
                        leaderboards: usable,
                        cloud: usable,
                        friends: usable,
                        achievements: usable,
                    };
                }
                if (channel === STEAM_IPC.GET_STATS) {
                    return {};
                }
                if (channel === STEAM_IPC.CHECK_CONNECTION) {
                    return usable;
                }
                if (channel === STEAM_IPC.IS_INITIALIZED) {
                    return Boolean(status.initialized);
                }
                return null;
            }),
            on: vi.fn((channel, callback) => {
                const channelListeners = listeners.get(channel) || [];
                channelListeners.push(callback);
                listeners.set(channel, channelListeners);
                return () => {
                    const nextListeners = (listeners.get(channel) || []).filter((entry) => entry !== callback);
                    listeners.set(channel, nextListeners);
                };
            }),
        },
        setStatus(nextStatus) {
            status = {
                ...status,
                ...nextStatus,
            };
        },
        emit,
    };
}

describe('SteamService startup state handling', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.stubGlobal('localStorage', createLocalStorageMock());
        vi.stubGlobal('setInterval', vi.fn(() => 1));
        vi.stubGlobal('clearInterval', vi.fn());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reports connecting while main-process Steam bootstrap is still pending', async () => {
        const harness = createElectronApiHarness({
            initialized: false,
            connected: false,
            pending: true,
            steamId: null,
            playerName: 'Player',
            appId: 480,
        });
        vi.stubGlobal('window', {
            electronAPI: harness.electronAPI,
        });

        const { SteamService } = await import('../../src/core/steam/steam-service.js');
        const service = new SteamService();

        const connected = await service.initialize();

        expect(connected).toBe(false);
        expect(service.getConnectionState()).toBe('connecting');
        expect(service.getStatus().pending).toBe(true);
    });

    it('treats an initialized Steam client as connected even while startup verification is pending', async () => {
        const harness = createElectronApiHarness({
            initialized: true,
            connected: false,
            pending: true,
            steamId: '76561198000000000',
            playerName: 'Melolo',
            appId: 480,
        });
        vi.stubGlobal('window', {
            electronAPI: harness.electronAPI,
        });

        const { SteamService } = await import('../../src/core/steam/steam-service.js');
        const service = new SteamService();

        const connected = await service.initialize();

        expect(connected).toBe(true);
        expect(service.getConnectionState()).toBe('connected');
        expect(service.getStatus()).toMatchObject({
            initialized: true,
            isOnline: true,
            pending: false,
            steamId: '76561198000000000',
            playerName: 'Melolo',
        });
    });

    it('becomes connected from a delayed main-process steam:status event without polling', async () => {
        const harness = createElectronApiHarness({
            initialized: false,
            connected: false,
            pending: true,
            steamId: null,
            playerName: 'Player',
            appId: 480,
        });
        vi.stubGlobal('window', {
            electronAPI: harness.electronAPI,
        });

        const { SteamService } = await import('../../src/core/steam/steam-service.js');
        const service = new SteamService();
        const readySpy = vi.fn();
        const connectedSpy = vi.fn();
        service.on(STEAM_EVENTS.READY, readySpy);
        service.on(STEAM_EVENTS.CONNECTED, connectedSpy);

        await service.initialize();
        harness.setStatus({
            initialized: true,
            connected: true,
            pending: false,
            steamId: '76561198000000000',
            playerName: 'Melolo',
            appId: 480,
        });
        await harness.emit('steam:status', {
            initialized: true,
            connected: true,
            pending: false,
            steamId: '76561198000000000',
            playerName: 'Melolo',
            appId: 480,
            source: 'test-status',
        });

        expect(service.getConnectionState()).toBe('connected');
        expect(service.getStatus()).toMatchObject({
            initialized: true,
            isOnline: true,
            pending: false,
            steamId: '76561198000000000',
            playerName: 'Melolo',
        });
        expect(readySpy).toHaveBeenCalledTimes(1);
        expect(connectedSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to no_steam after init failure', async () => {
        const harness = createElectronApiHarness({
            initialized: false,
            connected: false,
            pending: false,
            steamId: null,
            playerName: 'Player',
            appId: 480,
        });
        vi.stubGlobal('window', {
            electronAPI: harness.electronAPI,
        });

        const { SteamService } = await import('../../src/core/steam/steam-service.js');
        const service = new SteamService();

        const initPromise = service.initialize();
        await vi.advanceTimersByTimeAsync(4000);
        const connected = await initPromise;

        expect(connected).toBe(false);
        expect(service.getConnectionState()).toBe('no_steam');
        expect(service.getStatus().pending).toBe(false);
    });
});
