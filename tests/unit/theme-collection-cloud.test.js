import {
    beforeEach, afterEach, describe, expect, it, vi,
} from 'vitest';
import { SteamCloudSyncManager } from '../../src/core/steam/steam-cloud-sync.js';
import { ThemeCollectionService } from '../../src/core/progression/theme-collection-service.js';
import {
    THEME_COLLECTION_STORAGE_KEY, ODYSSEY_PROGRESS_STORAGE_KEY, createThemeCollectionData,
} from '../../src/core/progression/theme-collection-model.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager, migrateOdysseyProgressData } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_SAVE_VERSION } from '../../src/core/odyssey/odyssey-progress-schema.js';
import { THEME_REGISTRY, resolveThemeId } from '../../src/themes/theme-registry.js';
import { eventBus } from '../../src/events/event-bus.js';

const steam = vi.hoisted(() => ({
    getCapabilities: vi.fn(() => ({ cloud: true })),
    isAvailable: vi.fn(() => true),
    cloudWrite: vi.fn(async () => ({ supported: true, success: true })),
    cloudRead: vi.fn(),
    on: vi.fn(),
    waitForInit: vi.fn(async () => {}),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

let storage;
let managers;
let subscriptions;
let registry;
const rewardData = (id, timestamp) => ({
    ...createThemeCollectionData(),
    grants: { forest: { source: 'starter' }, [id]: { source: 'odyssey', levelId: 1 } },
    updatedAt: timestamp,
});

beforeEach(() => {
    vi.useFakeTimers();
    managers = [];
    subscriptions = [];
    const values = new Map();
    storage = {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, value)),
        removeItem: vi.fn((key) => values.delete(key)),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('crypto', {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const on = eventBus.on.bind(eventBus);
    vi.spyOn(eventBus, 'on').mockImplementation((...args) => {
        const unsubscribe = on(...args);
        subscriptions.push(unsubscribe);
        return unsubscribe;
    });
    steam.cloudWrite.mockReset().mockResolvedValue({ supported: true, success: true });
    steam.cloudRead.mockReset();
    registry = new LevelRegistry();
});
afterEach(() => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    managers.forEach((manager) => clearTimeout(manager.flushTimer));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function setup(options = {}) {
    const collection = new ThemeCollectionService({
        catalog: THEME_REGISTRY,
        levels: registry.getAllLevels(),
        storage,
        resolveThemeId,
        migrateProgress: migrateOdysseyProgressData,
    });
    const manager = new SteamCloudSyncManager({ themeCollection: collection, ...options });
    managers.push(manager);
    manager._registerEventHandlers();
    return { collection, manager };
}

describe('Steam Cloud collection reconciliation', () => {
    it.each([[100, 900], [900, 100], [100, 100]])(
        'unions grants for local clock %s / remote clock %s instead of last-writer replacement',
        async (localTime, remoteTime) => {
            storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify(rewardData('pyrestorm', localTime)));
            const { collection, manager } = setup();
            manager.manifest.files['unlocks.json'] = { hash: 'local', updatedAt: localTime };
            steam.cloudRead.mockResolvedValue({
                supported: true, data: JSON.stringify(rewardData('aurora', remoteTime)),
            });
            await manager._syncFile('unlocks.json', {
                files: { 'unlocks.json': { hash: 'remote', updatedAt: remoteTime } },
            });
            expect(collection.isUnlocked('pyrestorm')).toBe(true);
            expect(collection.isUnlocked('aurora')).toBe(true);
            const upload = steam.cloudWrite.mock.calls.find(([file]) => file === 'unlocks.json');
            expect(JSON.parse(upload[1]).grants).toMatchObject({
                forest: { source: 'starter' }, pyrestorm: { source: 'odyssey' }, aurora: { source: 'odyssey' },
            });
        },
    );

    it('keeps a local award made while the remote document is being read and uploads their union', async () => {
        const { collection, manager } = setup();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        let release;
        steam.cloudRead.mockResolvedValue({ supported: true, data: JSON.stringify(rewardData('aurora', 999)) });
        steam.cloudRead.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const sync = manager._syncFile('unlocks.json', {
            files: { 'unlocks.json': { hash: 'remote', updatedAt: 999 } },
        });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const completion = state.completeLevel(1, { stars: 1 });
        collection.awardCompletion({ levelId: 1, themeId: 'cinder-drift', progressPersisted: completion.persisted });
        release({ supported: true, data: JSON.stringify(rewardData('aurora', 999)) });
        await sync;
        expect(collection.getOwnedThemeIds()).toEqual(['forest', 'aurora', 'cinder-drift']);
        const lastUpload = steam.cloudWrite.mock.calls.filter(([file]) => file === 'unlocks.json').at(-1);
        expect(JSON.parse(lastUpload[1]).grants).toHaveProperty('cinder-drift');
        expect(JSON.parse(lastUpload[1]).grants).toHaveProperty('aurora');
    });

    it('does not acknowledge or notify ownership when the local cloud-apply write fails', async () => {
        const { collection, manager } = setup();
        const listener = vi.fn();
        collection.subscribe(listener);
        const before = JSON.stringify(manager.manifest);
        steam.cloudRead.mockResolvedValue({ supported: true, data: JSON.stringify(rewardData('aurora', 100)) });
        storage.setItem.mockImplementation(() => { throw new Error('full'); });
        await manager._syncFile('unlocks.json', { files: { 'unlocks.json': { hash: 'remote', updatedAt: 100 } } });
        expect(collection.isUnlocked('aurora')).toBe(false);
        expect(listener).not.toHaveBeenCalled();
        expect(steam.cloudWrite).not.toHaveBeenCalled();
        expect(JSON.stringify(manager.manifest)).toBe(before);
    });

    it('preserves remote-only ownership when a local grant uploads before the initial cloud sync', async () => {
        const { collection, manager } = setup();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const completion = state.completeLevel(1, { stars: 1 });
        collection.awardCompletion({ levelId: 1, themeId: 'cinder-drift', progressPersisted: completion.persisted });
        steam.cloudRead.mockResolvedValue({ supported: true, data: JSON.stringify(rewardData('aurora', 999)) });
        await manager._flushPendingUploads();
        const upload = steam.cloudWrite.mock.calls.find(([file]) => file === 'unlocks.json');
        expect(JSON.parse(upload[1]).grants).toHaveProperty('aurora');
        expect(JSON.parse(upload[1]).grants).toHaveProperty('cinder-drift');
        expect(collection.isUnlocked('aurora')).toBe(true);
    });

    it('defers collection uploads when the remote collection cannot safely be read', async () => {
        const { manager } = setup();
        steam.cloudRead.mockResolvedValue({ supported: false });
        await manager.queueUpload('unlocks.json', { flush: true });
        expect(steam.cloudWrite.mock.calls.some(([file]) => file === 'unlocks.json')).toBe(false);
        expect(manager.pendingUploads.has('unlocks.json')).toBe(true);
        steam.cloudRead.mockResolvedValue({ supported: true, data: null });
        await manager._flushPendingUploads();
        expect(steam.cloudWrite.mock.calls.some(([file]) => file === 'unlocks.json')).toBe(true);
        expect(manager.pendingUploads.has('unlocks.json')).toBe(false);
    });

    it('refuses to upload over a failed native read that is supported but unsuccessful', async () => {
        const { manager } = setup();
        steam.cloudRead.mockResolvedValue({
            supported: true, success: false, data: null, error: 'read failed',
        });
        await manager.queueUpload('unlocks.json', { flush: true });
        expect(steam.cloudWrite.mock.calls.some(([file]) => file === 'unlocks.json')).toBe(false);
        expect(manager.pendingUploads.has('unlocks.json')).toBe(true);
    });

    it('uploads quiet startup recovery even when stale local and remote manifests have the same hash', async () => {
        const old = rewardData('pyrestorm', 1);
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify(old));
        const { manager: initial, collection: prior } = setup();
        const oldHash = await initial._computeHash(JSON.stringify(prior.exportData()));
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 2, completedLevels: { 1: { stars: 1 } },
        }));
        const { collection, manager } = setup();
        manager.manifest.files['unlocks.json'] = { hash: oldHash, updatedAt: 1 };
        steam.cloudRead.mockResolvedValue({ supported: true, success: true, data: JSON.stringify(old) });
        await manager._syncFile('unlocks.json', { files: { 'unlocks.json': { hash: oldHash, updatedAt: 1 } } });
        expect(collection.isUnlocked('cinder-drift')).toBe(true);
        const upload = steam.cloudWrite.mock.calls.find(([file]) => file === 'unlocks.json');
        expect(JSON.parse(upload[1]).grants).toHaveProperty('cinder-drift');
        expect(upload[2]).toEqual({ queueIfOffline: false });
    });

    it('reconciles Odyssey-only cloud saves and refreshes progress without resetting the attempt', () => {
        const state = new OdysseyStateManager({ levelRegistry: registry });
        state.sessionStartTime = 1234;
        state.currentLevelAttempts = 3;
        const { collection, manager } = setup({ getOdysseyState: () => state });
        const listener = vi.fn();
        collection.subscribe(listener);
        manager._applyOdyssey({ version: 1, completedLevels: { 42: { stars: 1 } }, unlockedLevels: [42] });
        expect(state.isLevelCompleted(46)).toBe(true);
        expect(state.sessionStartTime).toBe(1234);
        expect(state.currentLevelAttempts).toBe(3);
        state.save();
        expect(JSON.parse(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY)).completedLevels['46']).toBeDefined();
        expect(collection.isUnlocked('stellar-velocity')).toBe(true);
        expect(collection.getSummary().newCount).toBe(0);
        expect(listener.mock.calls[0][0].source).toBe('reconcile');
        expect(manager.pendingUploads.has('unlocks.json')).toBe(true);
    });

    it('normalizes retired unlocked selections and falls back from locked cloud selections', () => {
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify(rewardData('pyrestorm', 1)));
        const settings = { backgroundTheme: 'forest' };
        const settingsManager = {
            get: () => settings,
            update: vi.fn((values) => Object.assign(settings, values)),
            save: vi.fn(),
        };
        const { manager } = setup({ settingsManager });
        manager._applySettings({ backgroundTheme: 'pyrestorm-v2' });
        expect(settings.backgroundTheme).toBe('pyrestorm');
        manager._applySettings({ backgroundTheme: 'aurora' });
        expect(settings.backgroundTheme).toBe('forest');
        manager._applySettings({ backgroundTheme: 'missing-theme' });
        expect(settings.backgroundTheme).toBe('forest');
    });

    it.each([false, true])('unions old and replayed theme history in either Cloud direction: %s', (reverse) => {
        const { manager, collection } = setup();
        const old = { version: 2, completedLevels: { 22: { stars: 3, themeId: 'aurora' } } };
        const replayed = {
            version: ODYSSEY_SAVE_VERSION,
            completedLevels: { 21: { stars: 1, themeId: 'ice-temple', themeIds: ['aurora', 'ice-temple'] } },
        };
        const merged = reverse ? manager._mergeOdyssey(old, replayed) : manager._mergeOdyssey(replayed, old);
        expect(merged.version).toBe(ODYSSEY_SAVE_VERSION);
        expect(merged.completedLevels['21']).toMatchObject({
            stars: 3, themeIds: ['aurora', 'ice-temple'],
        });
        manager._applyOdyssey(merged);
        expect(collection.isUnlocked('aurora')).toBe(true);
        expect(collection.isUnlocked('ice-temple')).toBe(true);
        expect(collection.getSummary().newCount).toBe(0);
    });

    it('does not award a new assignment from an old Cloud completion', () => {
        const { manager, collection } = setup();
        manager._applyOdyssey({ version: 2, completedLevels: { 22: { stars: 3 } } });
        expect(collection.isUnlocked('aurora')).toBe(true);
        expect(collection.isUnlocked('ice-temple')).toBe(false);
        expect(collection.getThemeStatus('ice-temple').requirement.label).toMatch(/^Replay /);
    });

    it('rejects future Odyssey schemas before applying or merging progress', () => {
        const { manager, collection } = setup();
        const local = { version: ODYSSEY_SAVE_VERSION, completedLevels: {} };
        const future = { version: ODYSSEY_SAVE_VERSION + 1, completedLevels: { 21: { stars: 3 } } };
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify(local));
        const before = storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY);
        manager._applyOdyssey(future);
        expect(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY)).toBe(before);
        expect(manager._mergeOdyssey(local, future)).toBeNull();
        expect(collection.getOwnedThemeIds()).toEqual(['forest']);
        expect(future.completedLevels['21'].themeId).toBeUndefined();
    });

    it.each([
        [100, 900, false], [900, 100, false], [100, 900, true], [900, 100, true],
    ])('preserves replay recovery for clocks %s/%s, remote replay %s', async (localTime, remoteTime, reverse) => {
        const old = { version: 2, completedLevels: { 22: { stars: 3, themeId: 'aurora' } } };
        const replayed = {
            version: ODYSSEY_SAVE_VERSION,
            completedLevels: { 21: { stars: 1, themeId: 'ice-temple', themeIds: ['aurora', 'ice-temple'] } },
        };
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify(old));
        const { manager, collection } = setup();
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify(reverse ? old : replayed));
        if (!reverse) {
            const write = storage.setItem.getMockImplementation();
            storage.setItem.mockImplementation((key, value) => {
                if (key === THEME_COLLECTION_STORAGE_KEY) throw new Error('collection full');
                write(key, value);
            });
            expect(collection.awardCompletion({
                levelId: 21, themeId: 'ice-temple', progressPersisted: true,
            }).persisted).toBe(false);
            storage.setItem.mockImplementation(write);
        }
        expect(collection.isUnlocked('ice-temple')).toBe(false);
        manager.manifest.files['odyssey.json'] = { hash: 'local', updatedAt: localTime };
        steam.cloudRead.mockImplementation(async (file) => ({
            supported: true,
            data: file === 'odyssey.json' ? JSON.stringify(reverse ? replayed : old) : null,
        }));
        await manager._syncFile('odyssey.json', {
            files: { 'odyssey.json': { hash: 'remote', updatedAt: remoteTime } },
        });
        const saved = JSON.parse(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY));
        expect(saved.completedLevels['21']).toMatchObject({ stars: 3, themeIds: ['aurora', 'ice-temple'] });
        expect(collection.isUnlocked('aurora')).toBe(true);
        expect(collection.isUnlocked('ice-temple')).toBe(true);
        const upload = steam.cloudWrite.mock.calls.find(([file]) => file === 'odyssey.json');
        expect(JSON.parse(upload[1]).completedLevels['21'].themeIds).toEqual(['aurora', 'ice-temple']);
        expect(upload[2]).toEqual({ queueIfOffline: false });
    });

    it('preserves a future local save through download, direct apply, and queued upload', async () => {
        const future = JSON.stringify({ version: ODYSSEY_SAVE_VERSION + 1, futurePayload: 'keep exactly' });
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, future);
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const { manager } = setup({ getOdysseyState: () => state });
        const incoming = { version: 2, completedLevels: { 22: { stars: 1 } } };
        manager.manifest.files['odyssey.json'] = { hash: 'local', updatedAt: 100 };
        const originalEntry = manager.manifest.files['odyssey.json'];
        steam.cloudRead.mockResolvedValue({ supported: true, data: JSON.stringify(incoming) });
        expect(manager._applyOdyssey(incoming)).toBe(false);
        await manager._syncFile('odyssey.json', {
            files: { 'odyssey.json': { hash: 'remote', updatedAt: 900 } },
        });
        await manager.queueUpload('odyssey.json', { flush: true });
        expect(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY)).toBe(future);
        expect(state.unsupportedSaveVersion).toBe(true);
        expect(manager.manifest.files['odyssey.json']).toBe(originalEntry);
        expect(steam.cloudWrite.mock.calls.some(([file]) => file === 'odyssey.json')).toBe(false);
        expect(manager.pendingUploads.has('odyssey.json')).toBe(true);
    });

    it.each([
        { supported: false },
        { supported: true, success: false, data: null },
        { supported: true, data: '{broken' },
        { supported: true, data: JSON.stringify({ version: ODYSSEY_SAVE_VERSION + 1, future: true }) },
    ])('defers Odyssey uploads without a safe remote document: %j', async (response) => {
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION, completedLevels: { 1: { stars: 1, themeId: 'cinder-drift' } },
        }));
        const { manager } = setup();
        const before = storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY);
        steam.cloudRead.mockResolvedValue(response);
        await manager.queueUpload('odyssey.json', { flush: true });
        expect(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY)).toBe(before);
        expect(steam.cloudWrite.mock.calls.some(([file]) => file === 'odyssey.json')).toBe(false);
        expect(manager.pendingUploads.has('odyssey.json')).toBe(true);
    });

    it('does not acknowledge a failed Odyssey disk write or rejected future download', async () => {
        const { manager } = setup();
        manager.manifest.files['odyssey.json'] = { hash: 'local', updatedAt: 100 };
        const originalEntry = manager.manifest.files['odyssey.json'];
        steam.cloudRead.mockResolvedValue({
            supported: true, data: JSON.stringify({ version: ODYSSEY_SAVE_VERSION + 1 }),
        });
        await manager._downloadAndApply('odyssey.json', { hash: 'future', updatedAt: 900 });
        expect(manager.manifest.files['odyssey.json']).toBe(originalEntry);
        steam.cloudRead.mockResolvedValue({
            supported: true, data: JSON.stringify({ version: 2, completedLevels: { 22: { stars: 1 } } }),
        });
        storage.setItem.mockImplementation(() => { throw new Error('full'); });
        await manager._downloadAndApply('odyssey.json', { hash: 'incoming', updatedAt: 900 });
        expect(manager.manifest.files['odyssey.json']).toBe(originalEntry);
        expect(steam.cloudWrite).not.toHaveBeenCalled();
    });

    it('keeps repeated Odyssey unions idempotent and excludes failed completion theme history', () => {
        const { manager, collection } = setup();
        const local = {
            version: ODYSSEY_SAVE_VERSION,
            completedLevels: { 21: { stars: 3, themeId: 'aurora' } },
            statistics: {
                totalPlayTime: 100, totalLinesCleared: 40, totalScore: 900, totalAttempts: 8,
            },
        };
        const incoming = {
            version: ODYSSEY_SAVE_VERSION,
            completedLevels: { 21: { stars: 0, themeId: 'ice-temple', themeIds: ['ice-temple'] } },
            statistics: {
                totalPlayTime: 80, totalLinesCleared: 50, totalScore: 700, totalAttempts: 6,
            },
        };
        const once = manager._mergeOdyssey(local, incoming);
        const twice = manager._mergeOdyssey(once, incoming);
        expect(twice.statistics).toMatchObject({
            totalPlayTime: 100, totalLinesCleared: 50, totalScore: 900, totalAttempts: 8,
        });
        manager._applyOdyssey(twice);
        expect(collection.isUnlocked('aurora')).toBe(true);
        expect(collection.isUnlocked('ice-temple')).toBe(false);
    });

    it('reads collection and Odyssey documents before applying a cloud theme preference', async () => {
        const { manager } = setup();
        steam.cloudRead.mockResolvedValue({ supported: true, data: JSON.stringify({ files: {} }) });
        const files = [];
        vi.spyOn(manager, '_syncFile').mockImplementation(async (file) => { files.push(file); });
        await manager.syncFromCloud();
        expect(files.indexOf('unlocks.json')).toBeLessThan(files.indexOf('settings.json'));
        expect(files.indexOf('odyssey.json')).toBeLessThan(files.indexOf('settings.json'));
    });

    it.each([false, true])('unions retired evidence without aliasing new orbs: %s', (reverse) => {
        const { manager, collection } = setup();
        const old = {
            version: 3,
            completedLevels: {
                10: {
                    stars: 2, bestScore: 200, themeId: 'bioluminescence-2', themeIds: ['bioluminescence-2'],
                },
                11: { stars: 1, themeId: 'stillwater' },
                19: { stars: 3, themeId: 'vesper-chrysalis' },
            },
        };
        const current = {
            version: ODYSSEY_SAVE_VERSION,
            completedLevels: { 10: { stars: 2, themeId: 'stillwater' } },
            retiredCompletions: {
                'v3:10': {
                    stars: 3, bestScore: 100, themeId: 'misty-lake', themeIds: ['misty-lake'],
                },
            },
        };
        const merged = reverse ? manager._mergeOdyssey(old, current) : manager._mergeOdyssey(current, old);
        expect(merged.completedLevels['10']).toMatchObject({ stars: 2, themeId: 'stillwater' });
        expect(merged.completedLevels['18']).toMatchObject({ stars: 3, themeId: 'vesper-chrysalis' });
        expect(merged.completedLevels['43']).toBeUndefined();
        expect(merged.completedLevels['55']).toBeUndefined();
        expect(merged.retiredCompletions['v3:10']).toMatchObject({
            stars: 3, bestScore: 200, themeIds: ['bioluminescence-2', 'misty-lake'],
        });
        const again = manager._mergeOdyssey(merged, reverse ? current : old);
        expect(again.retiredCompletions).toEqual(merged.retiredCompletions);
        manager._applyOdyssey(again);
        expect(collection.isUnlocked('misty-lake')).toBe(true);
        expect(collection.isUnlocked('bioluminescence-2')).toBe(false);
        expect(collection.isUnlocked('bioluminescence')).toBe(false);
        expect(collection.isUnlocked('vesper-chrysalis')).toBe(true);
    });

    it('falls back from a retired BioII cloud selection without transferring its ownership', () => {
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify(rewardData('bioluminescence-2', 10)));
        const settings = { backgroundTheme: 'bioluminescence-2' };
        const settingsManager = {
            get: () => settings, update: (next) => Object.assign(settings, next), save: vi.fn(),
        };
        const { collection, manager } = setup({ settingsManager });
        manager._applySettings({ backgroundTheme: 'bioluminescence-2' });
        expect(settings.backgroundTheme).toBe('forest');
        expect(collection.exportData().grants['bioluminescence-2']).toBeDefined();
        expect(collection.isUnlocked('bioluminescence')).toBe(false);
    });
});
