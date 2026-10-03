import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { SettingsManager } from '../../src/ui/settings.js';

const steam = vi.hoisted(() => ({
    getCapabilities: vi.fn(() => ({ cloud: true })),
    isAvailable: vi.fn(() => true),
    cloudWrite: vi.fn(async () => ({ supported: true, success: true })),
    cloudRead: vi.fn(),
    on: vi.fn(),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

let managers;
let subscriptions;
beforeEach(() => {
    vi.useFakeTimers();
    managers = [];
    subscriptions = [];
    const store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => store.get(key) || null,
        setItem: vi.fn((key, value) => store.set(key, value)),
    });
    // Use the synchronous fallback hash so deferred work is easy to inspect.
    vi.stubGlobal('crypto', {});
    steam.cloudWrite.mockReset().mockResolvedValue({ supported: true, success: true });
    steam.cloudRead.mockReset();
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
function createManager() {
    const settings = { musicVolume: 0.5, sfxVolume: 0.4, keyBindings: { moveLeft: 'a' } };
    const manager = new SteamCloudSyncManager({ settingsManager: { get: () => settings } });
    managers.push(manager);
    return { settings, manager };
}
function settingsWrites() {
    return steam.cloudWrite.mock.calls.filter(([file]) => file === 'settings.json');
}

describe('Steam Cloud coalesced settings saves', () => {
    it('exports and hashes once after the debounce, syncing only changed cloud categories', async () => {
        const { manager, settings } = createManager();
        manager._registerEventHandlers();
        const build = vi.spyOn(manager, '_buildLocalPayload');
        const hash = vi.spyOn(manager, '_computeHash');
        for (const volume of [0.2, 0.4, 0.7]) {
            settings.musicVolume = volume;
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['musicVolume'] });
        }
        const changedAt = Date.now();
        expect(build).not.toHaveBeenCalled();
        expect(hash).not.toHaveBeenCalled();
        expect([...manager.pendingUploads.keys()]).toEqual(['settings.json']);
        await vi.advanceTimersByTimeAsync(1500);
        expect(build).toHaveBeenCalledTimes(1);
        expect(hash).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(settingsWrites()[0][1]);
        expect(payload.settings.musicVolume).toBe(0.7);
        expect(payload.updatedAt).toBe(changedAt);
        expect(manager.manifest.files['settings.json'].updatedAt).toBe(changedAt);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['keyBindings'] });
        expect([...manager.pendingUploads.keys()]).toEqual(['keybinds.json']);
        await vi.advanceTimersByTimeAsync(1500);
        expect(build).toHaveBeenLastCalledWith('keybinds.json', expect.any(Object));
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { dirtyKeys: ['renderScale'] });
        expect(manager.pendingUploads.size).toBe(0);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, {});
        expect([...manager.pendingUploads.keys()]).toEqual(['settings.json', 'keybinds.json']);
    });

    it('retains exact failed payloads for retry and uses final values after newer edits', async () => {
        const { manager, settings } = createManager();
        steam.cloudWrite.mockImplementation(async (file) => (
            file === 'settings.json' ? { supported: true, queued: true } : { supported: true, success: true }
        ));
        await manager.queueUpload('settings.json', { flush: true });
        const firstPayload = manager.pendingUploads.get('settings.json').payload;
        const build = vi.spyOn(manager, '_buildLocalPayload');
        steam.cloudWrite.mockResolvedValue({ supported: true, success: true });
        await manager._flushPendingUploads();
        expect(build).not.toHaveBeenCalled();
        expect(settingsWrites()[1][1]).toBe(firstPayload.json);
        settings.musicVolume = 0.8;
        await manager.queueUpload('settings.json', { flush: true });
        expect(JSON.parse(settingsWrites().at(-1)[1]).settings.musicVolume).toBe(0.8);
        expect(manager.pendingUploads.size).toBe(0);
    });

    it('makes flush:true wait for newer edits queued during an asynchronous upload', async () => {
        const { manager, settings } = createManager();
        let release;
        steam.cloudWrite.mockImplementation((file) => {
            if (file === 'settings.json' && settingsWrites().length === 1) {
                return new Promise((resolve) => { release = resolve; });
            }
            return Promise.resolve({ supported: true, success: true });
        });
        settings.musicVolume = 0.2;
        const first = manager.queueUpload('settings.json', { flush: true });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        settings.musicVolume = 0.9;
        const second = manager.queueUpload('settings.json', { flush: true });
        release({ supported: true, success: true });
        await Promise.all([first, second]);
        expect(settingsWrites()).toHaveLength(2);
        expect(JSON.parse(settingsWrites()[1][1]).settings.musicVolume).toBe(0.9);
        expect(manager.pendingUploads.size).toBe(0);
        expect(manager.manifest.files['settings.json'].hash).toBe(
            await manager._computeHash(settingsWrites()[1][1]),
        );
    });

    it.each(['settings.json', 'keybinds.json'])('keeps unflushed local edits made during a deferred %s read', async (fileName) => {
        const settingsManager = new SettingsManager();
        settingsManager.save({ emitEvent: false });
        const manager = new SteamCloudSyncManager({ settingsManager });
        managers.push(manager);
        let release;
        steam.cloudRead.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const download = manager._downloadAndApply(fileName, { updatedAt: 1, hash: 'cloud' });
        const update = fileName === 'settings.json'
            ? { musicVolume: 0.73 } : { keyBindings: { moveLeft: 'j' } };
        settingsManager.update(update, false);
        settingsManager.scheduleSave();
        release({ supported: true, data: JSON.stringify(fileName === 'settings.json'
            ? { settings: { musicVolume: 0.1 } } : { keyBindings: { moveLeft: 'q' } }) });
        await download;
        expect(settingsManager.get().musicVolume).toBe(fileName === 'settings.json' ? 0.73 : 1);
        if (fileName === 'keybinds.json') expect(settingsManager.get().keyBindings.moveLeft).toBe('j');
        expect(manager.manifest.files[fileName]).toBeUndefined();
        settingsManager.dispose();
        const persisted = JSON.parse(localStorage.getItem(settingsManager.STORAGE_KEY));
        if (fileName === 'settings.json') expect(persisted.musicVolume).toBe(0.73);
        else expect(persisted.keyBindings.moveLeft).toBe('j');
    });

    it('keeps a pending music save queued when unrelated downloaded keybindings are applied', async () => {
        const settingsManager = new SettingsManager();
        settingsManager.save({ emitEvent: false });
        const manager = new SteamCloudSyncManager({ settingsManager });
        managers.push(manager);
        manager._registerEventHandlers();
        let release;
        steam.cloudRead.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const download = manager._downloadAndApply('keybinds.json', { updatedAt: 1, hash: 'cloud-keys' });
        settingsManager.update({ musicVolume: 0.61 }, false);
        settingsManager.scheduleSave();
        release({ supported: true, data: JSON.stringify({ keyBindings: { moveLeft: 'j' } }) });
        await download;
        expect(settingsManager.get().keyBindings.moveLeft).toBe('j');
        expect(settingsManager.get().musicVolume).toBe(0.61);
        expect(manager.pendingUploads.has('settings.json')).toBe(true);
        expect(manager.pendingUploads.has('keybinds.json')).toBe(false);
        expect(manager.manifest.files['keybinds.json'].hash).toBeTruthy();
        await manager._flushPendingUploads();
        expect(JSON.parse(settingsWrites()[0][1]).settings.musicVolume).toBe(0.61);
        settingsManager.dispose();
    });

    it('ignores a stale cloud response after a concurrent local upload has already completed', async () => {
        const { manager, settings } = createManager();
        let release;
        steam.cloudRead.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const apply = vi.spyOn(manager, '_applyCloudData');
        const download = manager._downloadAndApply('settings.json', { updatedAt: 1, hash: 'cloud' });
        settings.musicVolume = 0.82;
        await manager.queueUpload('settings.json', { flush: true });
        const localEntry = manager.manifest.files['settings.json'];
        release({ supported: true, data: JSON.stringify({ settings: { musicVolume: 0.1 } }) });
        await download;
        expect(apply).not.toHaveBeenCalled();
        expect(manager.manifest.files['settings.json']).toBe(localEntry);
        expect(settings.musicVolume).toBe(0.82);
    });

    it('retains newer acknowledged local manifest metadata while an incoming hash is deferred', async () => {
        const { manager, settings } = createManager();
        let release;
        steam.cloudRead.mockResolvedValue({ supported: true, data: JSON.stringify({ settings: { musicVolume: 0.1 } }) });
        vi.spyOn(manager, '_computeHash').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const apply = vi.spyOn(manager, '_applyCloudData');
        const download = manager._downloadAndApply('settings.json', { updatedAt: 1, hash: 'incoming' });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        settings.musicVolume = 0.88;
        await manager.queueUpload('settings.json', { flush: true });
        const localEntry = manager.manifest.files['settings.json'];
        release('incoming-hash');
        await download;
        expect(apply).not.toHaveBeenCalled();
        expect(manager.manifest.files['settings.json']).toBe(localEntry);
        expect(settings.musicVolume).toBe(0.88);
    });

    it('does not download cloud state over pending local values when the upload is unavailable', async () => {
        const { manager, settings } = createManager();
        manager.manifest.files['settings.json'] = { updatedAt: 1, hash: 'old' };
        steam.cloudWrite.mockResolvedValue({ supported: false });
        settings.musicVolume = 0.75;
        await manager.queueUpload('settings.json');
        const apply = vi.spyOn(manager, '_downloadAndApply');
        await manager._syncFile('settings.json', { files: {
            'settings.json': { updatedAt: Date.now() + 1000, hash: 'incoming' },
        } });
        expect(apply).not.toHaveBeenCalled();
        expect(steam.cloudRead).not.toHaveBeenCalled();
        expect(manager.pendingUploads.get('settings.json').payload).toBeTruthy();
        expect(settings.musicVolume).toBe(0.75);
    });
});
