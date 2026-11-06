import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { STEAM_EVENTS, STEAM_STORAGE_KEYS } from '../../src/core/steam/steam-config.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { cleanupApplication } from '../../src/utils/application-cleanup.js';
import { prepareForQuit } from '../../src/utils/page-teardown.js';

const steam = vi.hoisted(() => ({
    getCapabilities: vi.fn(),
    isAvailable: vi.fn(),
    waitForInit: vi.fn(),
    cloudRead: vi.fn(),
    cloudWrite: vi.fn(),
    on: vi.fn(),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

let storage;
let busSubscriptions;
let steamListeners;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function drainMicrotasks() {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function fixture({ initialize = true } = {}) {
    const values = { musicVolume: 0.7, keyBindings: { moveLeft: 'a' } };
    const collectionListeners = new Set();
    let grants = { local: { source: 'test' } };
    const collection = {
        subscribe: vi.fn((callback) => {
            collectionListeners.add(callback);
            return vi.fn(() => collectionListeners.delete(callback));
        }),
        exportData: () => ({ version: 1, grants }),
        applyCloudData: vi.fn((data) => {
            grants = { ...grants, ...data.grants };
            collectionListeners.forEach((callback) => callback({ source: 'cloud' }));
            return true;
        }),
    };
    const settings = {
        get: () => values,
        update: vi.fn((incoming) => Object.assign(values, incoming)),
        save: vi.fn(() => true),
        flushPendingSave: vi.fn(() => false),
        dispose: vi.fn(),
    };
    const manager = new SteamCloudSyncManager({ settingsManager: settings, themeCollection: collection });
    const app = { settingsManager: settings, cloudSyncManager: manager, cleanupHandlers: [] };
    app.cleanup = () => cleanupApplication(app);
    if (initialize) manager.initialize();
    return {
        app, manager, settings, values, collection, collectionListeners,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    busSubscriptions = [];
    steamListeners = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    });
    vi.stubGlobal('crypto', {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const on = eventBus.on.bind(eventBus);
    vi.spyOn(eventBus, 'on').mockImplementation((...args) => {
        const unsubscribe = on(...args);
        busSubscriptions.push(unsubscribe);
        return unsubscribe;
    });
    steam.getCapabilities.mockReset().mockReturnValue({ cloud: true });
    steam.isAvailable.mockReset().mockReturnValue(true);
    steam.waitForInit.mockReset().mockResolvedValue();
    steam.cloudRead.mockReset().mockResolvedValue({ supported: false, success: false });
    steam.cloudWrite.mockReset().mockResolvedValue({ supported: false, success: false });
    steam.on.mockReset().mockImplementation((event, callback) => {
        const listeners = steamListeners.get(event) || new Set();
        listeners.add(callback);
        steamListeners.set(event, listeners);
        return vi.fn(() => listeners.delete(callback));
    });
});

afterEach(() => {
    busSubscriptions.forEach((unsubscribe) => unsubscribe());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Steam Cloud application lifetime', () => {
    it('owns only one set of timers and subscriptions when initialization is repeated', async () => {
        const { app, manager, collectionListeners } = fixture();
        manager.initialize();
        expect(vi.getTimerCount()).toBe(2);
        expect(steam.on).toHaveBeenCalledTimes(2);
        expect(collectionListeners.size).toBe(1);
        await app.cleanup();
        manager.initialize();
        expect(vi.getTimerCount()).toBe(0);
        expect(collectionListeners.size).toBe(0);
    });

    it('retires timers and callbacks while retaining final local saves through asynchronous mode cleanup', async () => {
        const { app, manager, collectionListeners } = fixture();
        const modeCleanup = deferred();
        app.gameModeManager = { cleanup: () => modeCleanup.promise };
        const oldReconnect = [...steamListeners.get(STEAM_EVENTS.RECONNECTED)][0];
        const oldCapabilities = [...steamListeners.get(STEAM_EVENTS.CAPABILITIES_UPDATED)][0];
        const oldCollection = [...collectionListeners][0];
        await manager.queueUpload('settings.json');
        const cleanup = app.cleanup();

        expect(vi.getTimerCount()).toBe(0);
        expect([...steamListeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
        oldReconnect();
        oldCapabilities({ cloud: true });
        await drainMicrotasks();
        expect(steam.cloudRead).not.toHaveBeenCalled();
        expect(steam.cloudWrite).not.toHaveBeenCalled();

        eventBus.emit(EVENTS.ODYSSEY_SAVED, {});
        expect(manager.pendingUploads.has('odyssey.json')).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        modeCleanup.resolve();
        await cleanup;
        const before = [...manager.pendingUploads.keys()];
        eventBus.emit(EVENTS.HIGH_SCORE_SAVED, {});
        oldCollection({ source: 'local' });
        expect([...manager.pendingUploads.keys()]).toEqual(before);
        expect(collectionListeners.size).toBe(0);
        await app.cleanup();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['settings.json', 'keybinds.json'])('does not apply a late %s download after cleanup', async (fileName) => {
        const { app, manager, settings, values } = fixture();
        const read = deferred();
        steam.cloudRead.mockReturnValue(read.promise);
        const download = manager._downloadAndApply(fileName, { updatedAt: 100 });
        await app.cleanup();
        read.resolve({
            supported: true, success: true,
            data: JSON.stringify(fileName === 'settings.json'
                ? { settings: { musicVolume: 0.2 } } : { keyBindings: { moveLeft: 'z' } }),
        });
        await download;
        expect(settings.update).not.toHaveBeenCalled();
        expect(settings.save).not.toHaveBeenCalled();
        expect(settings.flushPendingSave).not.toHaveBeenCalled();
        expect(values.musicVolume).toBe(0.7);
        expect(values.keyBindings.moveLeft).toBe('a');
    });

    it('checks ownership again after download hashing finishes', async () => {
        const { app, manager, settings } = fixture();
        const hash = deferred();
        steam.cloudRead.mockResolvedValue({ supported: true, data: '{"settings":{"musicVolume":0.2}}' });
        const hashing = vi.spyOn(manager, '_computeHash').mockReturnValue(hash.promise);
        const download = manager._downloadAndApply('settings.json', { updatedAt: 100 });
        await drainMicrotasks();
        expect(hashing).toHaveBeenCalledOnce();
        await app.cleanup();
        hash.resolve('remote');
        await download;
        expect(settings.update).not.toHaveBeenCalled();
        expect(manager.manifest.files['settings.json']).toBeUndefined();
    });

    it.each(['_mergeConflict', '_adoptCloudUnderLocalEdits'])('retires an awaiting %s settings read', async (operation) => {
        const { app, manager, settings } = fixture();
        const read = deferred();
        steam.cloudRead.mockReturnValue(read.promise);
        const applying = manager[operation]('settings.json', { updatedAt: 100 });
        await app.cleanup();
        read.resolve({ supported: true, data: '{"settings":{"musicVolume":0.2}}' });
        await applying;
        expect(settings.update).not.toHaveBeenCalled();
        expect(settings.flushPendingSave).not.toHaveBeenCalled();
        expect(steam.cloudWrite).not.toHaveBeenCalled();
    });

    it('retires an awaiting passive collection read', async () => {
        const { app, manager, collection } = fixture();
        const read = deferred();
        steam.cloudRead.mockReturnValue(read.promise);
        const syncing = manager._mergeUnlocksFromCloud();
        await app.cleanup();
        read.resolve({ supported: true, data: '{"grants":{"remote":{"source":"test"}}}' });
        await syncing;
        expect(collection.applyCloudData).not.toHaveBeenCalled();
        expect(steam.cloudWrite).not.toHaveBeenCalled();
    });

    it('does not begin reading after a retired Steam initialization wait', async () => {
        const { app, manager } = fixture();
        const initializing = deferred();
        steam.waitForInit.mockReturnValue(initializing.promise);
        const syncing = manager.syncFromCloud();
        await app.cleanup();
        initializing.resolve();
        await syncing;
        expect(steam.cloudRead).not.toHaveBeenCalled();
        expect(manager.syncInProgress).toBe(false);
    });

    it('does not authorize or start uploads after a retired manifest read', async () => {
        const { app, manager } = fixture();
        const read = deferred();
        steam.cloudRead.mockReturnValue(read.promise);
        const pushAll = vi.spyOn(manager, '_pushAllLocal').mockResolvedValue();
        const syncing = manager.syncFromCloud();
        await drainMicrotasks();
        expect(steam.cloudRead).toHaveBeenCalledOnce();
        await app.cleanup();
        read.resolve({ supported: true, data: null });
        await syncing;
        expect(manager.cloudManifestSeen).toBeNull();
        expect(manager.reconciledFiles.size).toBe(0);
        expect(pushAll).not.toHaveBeenCalled();
    });

    it('does not publish a manifest bootstrap snapshot after retirement', async () => {
        const { app, manager } = fixture();
        const payload = deferred();
        vi.spyOn(manager, '_buildLocalPayload').mockReturnValue(payload.promise);
        const bootstrap = manager._bootstrapLocalManifest();
        await app.cleanup();
        payload.resolve({ json: '{}', hash: 'late', updatedAt: 1 });
        await bootstrap;
        expect(manager.manifest.files).toEqual({});
    });

    it('preserves final cleanup-generated saves for a failed explicit quit flush and restart', async () => {
        const { app, manager, settings } = fixture();
        const order = [];
        settings.dispose.mockImplementation(() => {
            order.push('settings');
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['musicVolume'] });
        });
        app.gameModeManager = { cleanup: async () => {
            order.push('mode');
            eventBus.emit(EVENTS.ODYSSEY_SAVED, {});
        } };
        const flush = manager.flushPendingUploads.bind(manager);
        vi.spyOn(manager, 'flushPendingUploads').mockImplementation(async () => {
            order.push('flush');
            await flush();
        });
        await prepareForQuit(app);
        expect(order).toEqual(['settings', 'mode', 'flush']);
        const saved = JSON.parse(storage.get(STEAM_STORAGE_KEYS.CLOUD_PENDING));
        expect(Object.keys(saved.files).sort()).toEqual(['odyssey.json', 'settings.json']);
        const restarted = new SteamCloudSyncManager({ settingsManager: settings });
        expect([...restarted.pendingUploads.keys()].sort()).toEqual(['odyssey.json', 'settings.json']);
    });

    it.each([
        ['highscores.json', 'importHighScores', { highScores: [] }],
        ['stats.json', 'importStatistics', { stats: { totalGames: 1 } }],
    ])('captures final saves while an already-started %s import drains', async (fileName, method, data) => {
        const { app, manager, settings } = fixture();
        const importing = deferred();
        manager.highScoreManager = { [method]: vi.fn(() => importing.promise) };
        const application = manager._applyCloudData(fileName, data);
        expect(manager.highScoreManager[method]).toHaveBeenCalledOnce();
        settings.dispose.mockImplementation(() => eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['musicVolume'] }));
        app.gameModeManager = { cleanup: async () => eventBus.emit(EVENTS.ODYSSEY_SAVED, {}) };

        await prepareForQuit(app);
        importing.resolve();
        await application;

        expect([...manager.pendingUploads.keys()].sort()).toEqual(['odyssey.json', 'settings.json']);
        const saved = JSON.parse(storage.get(STEAM_STORAGE_KEYS.CLOUD_PENDING));
        expect(Object.keys(saved.files).sort()).toEqual(['odyssey.json', 'settings.json']);
    });

    it('keeps explicit final uploads and their remote collection union usable after cleanup', async () => {
        const { app, manager, settings, collectionListeners } = fixture();
        manager.reconciledFiles.add('settings.json');
        manager.cloudManifestSeen = { files: {} };
        settings.dispose.mockImplementation(() => eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['musicVolume'] }));
        app.gameModeManager = { cleanup: async () => {
            collectionListeners.forEach((callback) => callback({ source: 'local' }));
        } };
        steam.cloudRead.mockResolvedValue({ supported: true, data: '{"grants":{"remote":{"source":"test"}}}' });
        steam.cloudWrite.mockResolvedValue({ supported: true, success: true });
        await prepareForQuit(app);
        const settingsUpload = steam.cloudWrite.mock.calls.find(([file]) => file === 'settings.json');
        const collectionUpload = steam.cloudWrite.mock.calls.find(([file]) => file === 'unlocks.json');
        expect(JSON.parse(settingsUpload[1]).settings.musicVolume).toBe(0.7);
        expect(JSON.parse(collectionUpload[1]).grants).toHaveProperty('local');
        expect(JSON.parse(collectionUpload[1]).grants).toHaveProperty('remote');
        expect(manager.pendingUploads.size).toBe(0);
    });

    it('does not bypass first-read protection for whole documents at quit', async () => {
        const { app, manager } = fixture();
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['musicVolume'] });
        await prepareForQuit(app);
        expect(steam.cloudWrite).not.toHaveBeenCalled();
        expect(manager.pendingUploads.has('settings.json')).toBe(true);
        expect(manager.reconciledFiles.has('settings.json')).toBe(false);
    });

    it('retires the app before waiting for an active upload, then flushes its final queued save', async () => {
        const { app, manager, settings } = fixture();
        manager.reconciledFiles.add('settings.json');
        manager.reconciledFiles.add('keybinds.json');
        manager.cloudManifestSeen = { files: {} };
        const writing = deferred();
        steam.cloudWrite.mockImplementation((file) => (file === 'settings.json'
            ? writing.promise : Promise.resolve({ supported: true, success: true })));
        await manager.queueUpload('settings.json');
        const upload = manager._flushPendingUploads();
        await drainMicrotasks();
        expect(steam.cloudWrite).toHaveBeenCalledWith('settings.json', expect.any(String), expect.any(Object));
        settings.dispose.mockImplementation(() => eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['keyBindings'] }));
        app.gameModeManager = { cleanup: vi.fn(async () => {}) };

        const quitting = prepareForQuit(app);
        await drainMicrotasks();
        expect(settings.dispose).toHaveBeenCalledOnce();
        expect(app.gameModeManager.cleanup).toHaveBeenCalledOnce();
        expect(app.isInitialized).toBe(false);
        expect(manager.pendingUploads.has('keybinds.json')).toBe(true);
        writing.resolve({ supported: true, success: true });
        await Promise.all([upload, quitting]);
        expect(steam.cloudWrite.mock.calls.map(([file]) => file)).toContain('keybinds.json');
        expect(manager.pendingUploads.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
