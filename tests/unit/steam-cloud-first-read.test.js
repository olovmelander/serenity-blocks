import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { STEAM_STORAGE_KEYS } from '../../src/core/steam/steam-config.js';
import { createEmptyStatistics, mergeStatisticsSnapshots } from '../../src/core/progression/score-statistics.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

// One Steam Cloud shared by two devices. Writes made while offline go to SteamService's
// persisted queue unless the caller opts out, as the real service does.
const steam = vi.hoisted(() => ({
    cloud: new Map(),
    online: true,
    offlineQueue: [],
    getCapabilities: vi.fn(() => ({ cloud: true })),
    isAvailable: vi.fn(() => true),
    waitForInit: vi.fn(async () => true),
    cloudRead: vi.fn(),
    cloudWrite: vi.fn(),
    on: vi.fn(),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

let clock;
let managers;
let subscriptions;

function createDevice({ settings = {} } = {}) {
    const storage = new Map();
    const local = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    };
    const state = {
        scores: [],
        stats: createEmptyStatistics(),
        settings: {
            musicVolume: 0.7,
            dasDelay: 167,
            keyBindings: { moveLeft: 'ArrowLeft' },
            player2KeyBindings: {},
            serenityKeyBindings: {},
            serenityGamepadBindings: {},
            ...settings,
        },
    };
    const highScoreManager = {
        exportHighScores: async () => state.scores.map((entry) => ({ ...entry })),
        importHighScores: async (entries) => { state.scores = entries.map((entry) => ({ ...entry })); },
        exportStatistics: async () => structuredClone(state.stats),
        importStatistics: async (incoming, { merge = true } = {}) => {
            state.stats = mergeStatisticsSnapshots(merge ? state.stats : null, incoming);
        },
    };
    const settingsManager = {
        get: () => state.settings,
        update: (next) => { state.settings = { ...next }; },
        save: () => true,
        dirtyKeys: new Set(),
        flushPendingSave: () => false,
    };
    const use = () => vi.stubGlobal('localStorage', local);
    const boot = () => {
        use();
        const manager = new SteamCloudSyncManager({ highScoreManager, settingsManager, now: () => clock });
        managers.push(manager);
        return manager;
    };
    const device = {
        state,
        storage,
        manager: boot(),
        listen() {
            use();
            device.manager._registerEventHandlers();
        },
        /** A save from the Settings screen: the settings manager names the keys it changed. */
        edit(changes) {
            use();
            state.settings = { ...state.settings, ...changes };
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: Object.keys(changes) });
        },
        /** The app quits and starts again on the same disk. */
        restart() {
            clearTimeout(device.manager.flushTimer);
            device.manager = boot();
        },
        async sync() {
            clock += 60_000;
            use();
            await device.manager.syncFromCloud();
        },
        async flush() {
            use();
            await device.manager.flushPendingUploads();
        },
    };
    return device;
}

const cloudDoc = (fileName) => JSON.parse(steam.cloud.get(fileName));

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clock = Date.parse('2026-10-01T12:00:00Z');
    managers = [];
    subscriptions = [];
    steam.cloud.clear();
    steam.offlineQueue = [];
    steam.online = true;
    steam.isAvailable.mockImplementation(() => steam.online);
    steam.cloudRead.mockReset().mockImplementation(async (fileName) => (steam.online
        ? { supported: true, success: true, data: steam.cloud.get(fileName) ?? null }
        : { supported: false, data: null }));
    steam.cloudWrite.mockReset().mockImplementation(async (fileName, data, options = {}) => {
        if (!steam.online) {
            const queued = options.queueIfOffline !== false;
            if (queued) steam.offlineQueue.push({ fileName, data });
            return { supported: false, success: false, queued };
        }
        steam.cloud.set(fileName, data);
        return { supported: true, success: true };
    });
    const on = eventBus.on.bind(eventBus);
    vi.spyOn(eventBus, 'on').mockImplementation((...args) => {
        const unsubscribe = on(...args);
        subscriptions.push(unsubscribe);
        return unsubscribe;
    });
});

afterEach(() => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    managers.forEach((manager) => clearTimeout(manager.flushTimer));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Steam Cloud before the session has read the cloud', () => {
    it('a new device that changes one setting before its first read keeps that change and adopts the rest', async () => {
        const a = createDevice({ settings: { musicVolume: 0.2, dasDelay: 99, keyBindings: { moveLeft: 'a' } } });
        await a.sync();
        const b = createDevice();
        b.listen();
        const writesBefore = steam.cloudWrite.mock.calls.length;

        b.edit({ musicVolume: 0.9 });
        await vi.advanceTimersByTimeAsync(2000);
        await b.flush();
        // Neither the settings document nor B's manifest goes up before B has read the cloud.
        expect(steam.cloudWrite.mock.calls.slice(writesBefore)).toEqual([]);

        await b.sync();
        expect(b.state.settings).toMatchObject({ musicVolume: 0.9, dasDelay: 99 });
        expect(b.state.settings.keyBindings.moveLeft).toBe('a');
        expect(cloudDoc('settings.json').settings).toMatchObject({ musicVolume: 0.9, dasDelay: 99 });

        await a.sync();
        expect(a.state.settings).toMatchObject({ musicVolume: 0.9, dasDelay: 99 });
        expect(a.state.settings.keyBindings.moveLeft).toBe('a');
    });

    it('a change made while Steam is offline never enters SteamService\'s blind replay queue', async () => {
        const a = createDevice({ settings: { dasDelay: 99, keyBindings: { moveLeft: 'a' } } });
        await a.sync();
        steam.online = false;
        const b = createDevice();
        b.listen();
        b.edit({ musicVolume: 0.9 });
        await vi.advanceTimersByTimeAsync(2000);
        await b.flush();
        expect(steam.offlineQueue).toEqual([]);

        steam.online = true;
        await b.sync();
        await a.sync();
        expect(a.state.settings).toMatchObject({ dasDelay: 99, musicVolume: 0.9 });
        expect(a.state.settings.keyBindings.moveLeft).toBe('a');
    });

    it('a save that names no cloud keys leaves the cloud copy as it is', async () => {
        const a = createDevice({ settings: { dasDelay: 99 } });
        await a.sync();
        const b = createDevice();
        b.listen();
        b.manager.queueUpload('settings.json');
        const writesBefore = steam.cloudWrite.mock.calls.filter(([file]) => file === 'settings.json').length;
        await b.sync();
        expect(b.state.settings.dasDelay).toBe(99);
        expect(steam.cloudWrite.mock.calls.filter(([file]) => file === 'settings.json')).toHaveLength(writesBefore);
        expect(b.manager.pendingUploads.has('settings.json')).toBe(false);
    });

    it('edits and scores made offline reach the cloud after a restart', async () => {
        const a = createDevice({ settings: { dasDelay: 99 } });
        await a.sync();
        const b = createDevice();
        await b.sync();
        steam.online = false;
        b.listen();
        b.edit({ musicVolume: 0.4 });
        b.state.scores.push({ score: 99999, lines: 40, level: 9, timestamp: clock });
        eventBus.emit(EVENTS.HIGH_SCORE_SAVED, {});
        await vi.advanceTimersByTimeAsync(2000);
        await b.flush();
        expect(steam.offlineQueue).toEqual([]);

        b.restart();
        expect([...b.manager.pendingUploads.keys()].sort()).toEqual(['highscores.json', 'settings.json', 'stats.json']);
        steam.online = true;
        await b.sync();
        expect(cloudDoc('highscores.json').highScores.map((entry) => entry.score)).toContain(99999);
        expect(cloudDoc('settings.json').settings).toMatchObject({ musicVolume: 0.4, dasDelay: 99 });
        expect(JSON.parse(b.storage.get(STEAM_STORAGE_KEYS.CLOUD_PENDING)).files).toEqual({});
    });

    it('a manifest uploaded later keeps the entries this device has not adopted yet', async () => {
        const a = createDevice();
        await a.sync();
        const b = createDevice();
        b.manager.cloudManifestSeen = JSON.parse(steam.cloud.get('cloud_manifest.json'));
        b.manager.manifest.files = {};
        b.manager.reconciledFiles.add('settings.json');
        await b.manager.queueUpload('settings.json', { flush: true });
        const files = Object.keys(cloudDoc('cloud_manifest.json').files);
        expect(files).toEqual(expect.arrayContaining(['settings.json', 'keybinds.json', 'highscores.json', 'stats.json']));
    });
});

describe('SteamService offline queue from an older build', () => {
    it('drops saved cloud writes, which would replay blind before the first cloud read', async () => {
        const values = new Map([[STEAM_STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify([
            { action: 'cloudWrite', data: { filename: 'settings.json', data: '{}' }, timestamp: Date.now() },
            { action: 'uploadScore', data: { leaderboardName: 'SinglePlayerHighScore_v1', score: 10 }, timestamp: Date.now() },
        ])]]);
        vi.stubGlobal('localStorage', {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        });
        vi.stubGlobal('window', {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { SteamService } = await vi.importActual('../../src/core/steam/steam-service.js');
        const service = new SteamService();
        expect(service.offlineQueue.map((entry) => entry.action)).toEqual(['uploadScore']);
    });
});
