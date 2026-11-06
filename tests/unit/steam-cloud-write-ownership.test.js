import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { STEAM_STORAGE_KEYS } from '../../src/core/steam/steam-config.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const steam = vi.hoisted(() => ({
    getCapabilities: vi.fn(() => ({ cloud: true })),
    isAvailable: vi.fn(() => true),
    cloudWrite: vi.fn(),
    cloudRead: vi.fn(),
    on: vi.fn(),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

let disk;
let clock;
let subscriptions;
let managers;
const success = { supported: true, success: true };
const pendingFiles = () => JSON.parse(disk.get(STEAM_STORAGE_KEYS.CLOUD_PENDING)).files;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function device() {
    let values = {
        musicVolume: 0.7, dasDelay: 167,
        keyBindings: { moveLeft: 'a' }, player2KeyBindings: {},
        serenityKeyBindings: {}, serenityGamepadBindings: {},
    };
    const settingsManager = {
        get: () => values,
        update: (next) => { values = next; },
        save: () => true,
        flushPendingSave: () => false,
    };
    const boot = () => {
        const manager = new SteamCloudSyncManager({ settingsManager, now: () => clock });
        managers.push(manager);
        return manager;
    };
    const manager = boot();
    ['settings.json', 'keybinds.json'].forEach((file) => manager.reconciledFiles.add(file));
    manager._registerEventHandlers();
    return {
        manager,
        settings: () => values,
        edit(changes) {
            clock += 1;
            values = { ...values, ...changes };
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: Object.keys(changes) });
        },
        restart() {
            subscriptions.splice(0).forEach((off) => off());
            clearTimeout(manager.flushTimer);
            return boot();
        },
    };
}

function deferWrite(fileName) {
    const writing = deferred();
    let captured;
    steam.cloudWrite.mockImplementation(async (file, json) => {
        if (file === fileName && !captured) {
            captured = JSON.parse(json);
            return writing.promise;
        }
        return success;
    });
    return { ...writing, captured: () => captured };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', {});
    disk = new Map();
    clock = 1000;
    subscriptions = [];
    managers = [];
    vi.stubGlobal('localStorage', {
        getItem: (key) => disk.get(key) ?? null,
        setItem: (key, value) => disk.set(key, String(value)),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    steam.cloudWrite.mockReset().mockResolvedValue(success);
    steam.cloudRead.mockReset();
    const on = eventBus.on.bind(eventBus);
    vi.spyOn(eventBus, 'on').mockImplementation((...args) => {
        const unsubscribe = on(...args);
        subscriptions.push(unsubscribe);
        return unsubscribe;
    });
});

afterEach(() => {
    subscriptions.forEach((off) => off());
    managers.forEach((manager) => clearTimeout(manager.flushTimer));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Steam Cloud upload acknowledgment ownership', () => {
    it('persists the active upload and every unacknowledged entry waiting behind it', async () => {
        const d = device();
        d.edit({ musicVolume: 0.7, keyBindings: { moveLeft: 'j' } });
        const write = deferWrite('settings.json');
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        await d.manager.queueUpload('odyssey.json');
        const stored = pendingFiles();
        const restarted = d.restart();
        write.resolve(success);
        await flushing;

        expect(Object.keys(stored).sort()).toEqual(['keybinds.json', 'odyssey.json', 'settings.json']);
        expect(stored['settings.json'].edits).toEqual(['musicVolume']);
        expect(stored['keybinds.json'].edits).toEqual(['keyBindings']);
        expect([...restarted.pendingUploads.keys()].sort()).toEqual(Object.keys(stored).sort());
    });

    it('drops acknowledged entries while retaining the rest of an active batch on restart', async () => {
        const d = device();
        d.edit({ musicVolume: 0.7, keyBindings: { moveLeft: 'j' } });
        const write = deferWrite('keybinds.json');
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        await d.manager.queueUpload('odyssey.json');
        const stored = pendingFiles();
        write.resolve(success);
        await flushing;

        expect(Object.keys(stored).sort()).toEqual(['keybinds.json', 'odyssey.json']);
        expect(stored['keybinds.json'].edits).toEqual(['keyBindings']);
    });

    it('protects a queued-behind edit that returns to its earlier value while a cloud read waits', async () => {
        const d = device();
        const read = deferred();
        steam.cloudRead.mockReturnValueOnce(read.promise);
        const downloading = d.manager._downloadAndApply('keybinds.json', { updatedAt: 100, hash: 'remote' });
        d.edit({ musicVolume: 0.9 });
        d.edit({ keyBindings: { moveLeft: 'j' } });
        d.edit({ keyBindings: { moveLeft: 'a' } });
        const write = deferWrite('settings.json');
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        read.resolve({ ...success, data: JSON.stringify({ keyBindings: { moveLeft: 'q' } }) });
        await downloading;
        const retained = d.settings().keyBindings.moveLeft;
        write.resolve(success);
        await flushing;

        expect(retained).toBe('a');
        const keyWrite = steam.cloudWrite.mock.calls.find(([file]) => file === 'keybinds.json');
        expect(JSON.parse(keyWrite[1]).keyBindings.moveLeft).toBe('a');
    });

    it.each([
        ['settings.json', { musicVolume: 0.9 }],
        ['keybinds.json', { keyBindings: { moveLeft: 'j' } }],
    ])('preserves a newer same-key edit after an old %s acknowledgment and restart', async (fileName, latest) => {
        const d = device();
        const key = Object.keys(latest)[0];
        d.edit({ [key]: d.settings()[key] });
        const write = deferWrite(fileName);
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        d.edit(latest);
        const newestQueuedAt = clock;
        write.resolve(success);
        await flushing;
        const stored = pendingFiles();
        const restarted = d.restart();
        steam.cloudRead.mockResolvedValue({ ...success, data: JSON.stringify(write.captured()) });
        await restarted._syncFile(fileName, { files: { [fileName]: { updatedAt: 100, hash: 'earlier' } } });

        expect(stored[fileName]).toEqual({ queuedAt: newestQueuedAt, edits: [key] });
        expect(d.settings()).toMatchObject(latest);
        expect(JSON.parse(steam.cloudWrite.mock.calls.at(-1)[1])).toMatchObject(
            fileName === 'settings.json' ? { settings: latest } : latest,
        );
    });

    it('keeps newer edit ownership when the earlier snapshot is still being hashed', async () => {
        const d = device();
        d.edit({ musicVolume: 0.7 });
        const hash = deferred();
        vi.spyOn(d.manager, '_computeHash').mockReturnValueOnce(hash.promise);
        const flushing = d.manager._flushPendingUploads();
        d.edit({ musicVolume: 0.9 });
        hash.resolve('earlier-hash');
        await flushing;

        expect(JSON.parse(steam.cloudWrite.mock.calls[0][1]).settings.musicVolume).toBe(0.7);
        expect(pendingFiles()['settings.json'].edits).toEqual(['musicVolume']);
    });

    it('retires acknowledged keys without claiming unrelated remote edits after restart', async () => {
        const d = device();
        d.edit({ musicVolume: 0.7 });
        const write = deferWrite('settings.json');
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        d.edit({ dasDelay: 99 });
        write.resolve(success);
        await flushing;
        const stored = pendingFiles();
        const restarted = d.restart();
        steam.cloudRead.mockResolvedValue({ ...success, data: JSON.stringify({
            settings: { musicVolume: 0.2, dasDelay: 167 },
        }) });
        await restarted._syncFile('settings.json', { files: { 'settings.json': { updatedAt: 100, hash: 'other-device' } } });

        expect(stored['settings.json'].edits).toEqual(['dasDelay']);
        expect(d.settings()).toMatchObject({ musicVolume: 0.2, dasDelay: 99 });
    });

    it.each(['unsupported', 'rejected'])('retains the newer queued entry when the old upload is %s', async (outcome) => {
        const d = device();
        d.edit({ musicVolume: 0.7 });
        const write = deferWrite('settings.json');
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        d.edit({ musicVolume: 0.9 });
        const queuedAt = clock;
        const storedDuringWrite = pendingFiles();
        if (outcome === 'rejected') write.reject(new Error('offline'));
        else write.resolve({ supported: false, success: false });
        await flushing;

        expect(storedDuringWrite['settings.json']).toEqual({ queuedAt, edits: ['musicVolume'] });
        expect(pendingFiles()['settings.json']).toEqual({ queuedAt, edits: ['musicVolume'] });
        expect(d.manager.pendingUploads.get('settings.json').payload).toBeUndefined();
        await d.manager._flushPendingUploads();
        expect(JSON.parse(steam.cloudWrite.mock.calls.at(-1)[1]).settings.musicVolume).toBe(0.9);
        expect(pendingFiles()).toEqual({});
    });

    it('acknowledges legacy pending edit arrays without changing the persisted format', async () => {
        disk.set(STEAM_STORAGE_KEYS.CLOUD_PENDING, JSON.stringify({ version: 1, files: {
            'settings.json': { queuedAt: 123, edits: ['musicVolume'] },
        } }));
        const d = device();
        expect([...d.manager.localEdits.get('settings.json')]).toEqual(['musicVolume']);
        await d.manager._flushPendingUploads();
        expect(d.manager.localEdits.has('settings.json')).toBe(false);
        expect(JSON.parse(disk.get(STEAM_STORAGE_KEYS.CLOUD_PENDING))).toEqual({ version: 1, files: {} });
    });

    it('protects legacy pending ownership when the same key is edited during its upload', async () => {
        disk.set(STEAM_STORAGE_KEYS.CLOUD_PENDING, JSON.stringify({ version: 1, files: {
            'settings.json': { queuedAt: 123, edits: ['musicVolume'] },
        } }));
        const d = device();
        const write = deferWrite('settings.json');
        const flushing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(write.captured()).toBeTruthy());
        d.edit({ musicVolume: 0.9 });
        write.resolve(success);
        await flushing;
        expect(pendingFiles()['settings.json'].edits).toEqual(['musicVolume']);
    });

    it('does not acknowledge newer edits with a cached retry waiting behind another file', async () => {
        const d = device();
        d.edit({ musicVolume: 0.7 });
        const first = deferWrite('settings.json');
        const failing = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(first.captured()).toBeTruthy());
        d.edit({ keyBindings: { moveLeft: 'j' } });
        first.resolve({ supported: false, success: false });
        await failing;
        expect([...d.manager.pendingUploads.keys()]).toEqual(['keybinds.json', 'settings.json']);

        const second = deferWrite('keybinds.json');
        const retrying = d.manager._flushPendingUploads();
        await vi.waitFor(() => expect(second.captured()).toBeTruthy());
        d.edit({ musicVolume: 0.9 });
        second.resolve(success);
        await retrying;
        const stored = pendingFiles();
        const lastSettingsWrite = steam.cloudWrite.mock.calls.filter(([file]) => file === 'settings.json').at(-1);
        expect(JSON.parse(lastSettingsWrite[1]).settings.musicVolume).toBe(0.7);
        const restarted = d.restart();
        steam.cloudRead.mockResolvedValue({ ...success, data: lastSettingsWrite[1] });
        await restarted._syncFile('settings.json', {
            files: { 'settings.json': { updatedAt: 100, hash: 'cached-value' } },
        });

        expect(stored['settings.json'].edits).toEqual(['musicVolume']);
        expect(d.settings().musicVolume).toBe(0.9);
    });
});
