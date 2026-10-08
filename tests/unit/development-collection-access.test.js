import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeCollectionService } from '../../src/core/progression/theme-collection-service.js';
import {
    THEME_COLLECTION_STORAGE_KEY, createThemeCollectionData,
} from '../../src/core/progression/theme-collection-model.js';
import { THEME_MUSIC_CATALOG, DEFAULT_MUSIC_TRACK } from '../../src/core/progression/theme-music-catalog.js';
import { MusicPlaybackAccess } from '../../src/audio/music-playback-access.js';
import { THEME_REGISTRY, resolveThemeId } from '../../src/themes/theme-registry.js';
import { isDevelopmentCollectionUnlocked } from '../../src/themes/theme-collection.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager, migrateOdysseyProgressData } from '../../src/core/odyssey/OdysseyStateManager.js';
import { sanitizeCollectionThemeSetting } from '../../src/ui/theme-collection-integration.js';

let storage;
let registry;
function createCollection(developmentUnlockAll = false) {
    return new ThemeCollectionService({
        catalog: THEME_REGISTRY,
        levels: registry.getAllLevels(),
        resolveThemeId,
        migrateProgress: migrateOdysseyProgressData,
        storage,
        now: () => Date.parse('2026-10-08T12:00:00Z'),
        developmentUnlockAll,
    });
}

beforeEach(() => {
    const values = new Map();
    storage = {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, value)),
        removeItem: vi.fn((key) => values.delete(key)),
    };
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    registry = new LevelRegistry();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('URL-only development collection access', () => {
    it.each([
        ['?unlockAll=1', true],
        ['?forceWebGL=1&unlockAll=1', true],
        ['', false],
        ['?unlockAll=0', false],
        ['?unlockAll', false],
        ['?unlockAll=true', false],
        ['?unlockAll=10', false],
        ['?unlockAll=1-extra', false],
        ['?other=unlockAll=1', false],
        ['?UnlockAll=1', false],
    ])('parses %s as %s', (search, expected) => {
        expect(isDevelopmentCollectionUnlocked(search)).toBe(expected);
    });

    it('wires the actual page URL into the factory and forgets it on the next boot', async () => {
        storage.setItem('serenity.unlockAll', '1');
        vi.stubGlobal('location', { search: '?quality=low&unlockAll=1' });
        vi.resetModules();
        const enabled = (await import('../../src/themes/theme-collection.js')).getThemeCollection();
        expect(enabled.getOwnedThemeIds()).toHaveLength(61);
        expect(enabled.exportData()).toEqual(createThemeCollectionData());
        vi.stubGlobal('location', { search: '' });
        vi.resetModules();
        const disabled = (await import('../../src/themes/theme-collection.js')).getThemeCollection();
        expect(disabled.getOwnedThemeIds()).toEqual(['forest']);
    });

    it('opens every known theme and song without fake grants, seen writes or notifications', () => {
        const collection = createCollection(true);
        const access = new MusicPlaybackAccess();
        access.collection = collection;
        const listener = vi.fn();
        collection.subscribe(listener);
        THEME_MUSIC_CATALOG.forEach(({ themeId, trackKey }) => {
            expect(collection.isUnlocked(themeId)).toBe(true);
            expect(access.canPlay(trackKey)).toBe(true);
            expect(collection.markSeen(themeId)).toBe(themeId === 'forest');
        });
        expect(collection.getSummary()).toEqual({
            owned: 61, total: 61, newCount: 0, developmentUnlockAll: true, earned: 1,
        });
        expect(collection.getThemeStatus('cinder-drift')).toMatchObject({
            owned: true, isNew: false, developmentAccess: true,
        });
        expect(collection.getThemeStatus('forest')).not.toHaveProperty('developmentAccess');
        expect(collection.exportData()).toEqual(createThemeCollectionData());
        expect(collection.applyCloudData(collection.exportData())).toBe(true);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        ['unknown-theme', 'bioluminescence-2'].forEach((id) => expect(collection.isUnlocked(id)).toBe(false));
        expect(access.canPlay('UnknownSong')).toBe(false);
    });

    it('keeps authored Odyssey playback authoritative even during development access', () => {
        const access = new MusicPlaybackAccess();
        access.collection = createCollection(true);
        const token = access.begin({ trackKey: 'CinderDrift' });
        expect(access.canPlay('CinderDrift')).toBe(true);
        expect(access.canPlay('BloodMoon')).toBe(false);
        access.end(token);
        expect(access.canPlay('BloodMoon')).toBe(true);
    });

    it('still earns genuine orb rewards, exports only those grants, and retains them without the flag', () => {
        const collection = createCollection(true);
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const result = state.completeLevel(1, {
            stars: 1, score: 1000, time: 60, lines: 20, bonuses: [],
        });
        const receipt = collection.awardCompletion({
            levelId: 1, themeId: 'cinder-drift', progressPersisted: result.persisted,
        });
        expect(receipt).toMatchObject({ themeIds: ['cinder-drift'], totalOwned: 2, persisted: true });
        expect(collection.getSummary()).toMatchObject({ owned: 61, earned: 2, newCount: 1 });
        expect(collection.getThemeStatus('cinder-drift')).not.toHaveProperty('developmentAccess');
        expect(Object.keys(collection.exportData().grants).sort()).toEqual(['cinder-drift', 'forest']);
        const saved = JSON.parse(storage.getItem(THEME_COLLECTION_STORAGE_KEY));
        expect(saved).not.toHaveProperty('developmentUnlockAll');
        const normal = createCollection();
        expect(normal.getOwnedThemeIds().sort()).toEqual(['cinder-drift', 'forest']);
        const access = new MusicPlaybackAccess();
        access.collection = normal;
        expect(access.canPlay('CinderDrift')).toBe(true);
        expect(access.canPlay('BloodMoon')).toBe(false);
    });

    it('restores default selections when a preview-only theme and song are saved then reloaded normally', () => {
        const settings = { backgroundTheme: 'blood-moon', musicTrack: 'BloodMoon' };
        const app = {
            themeCollection: createCollection(true),
            settingsManager: {
                get: () => settings,
                update: vi.fn((changes) => Object.assign(settings, changes)),
                save: vi.fn(),
            },
            soundManager: { setThemeCollection: vi.fn(), setTrack: vi.fn() },
        };
        sanitizeCollectionThemeSetting(app);
        expect(app.settingsManager.update).not.toHaveBeenCalled();
        expect(app.soundManager.setTrack).toHaveBeenLastCalledWith('BloodMoon', { persist: false });
        app.themeCollection = createCollection();
        sanitizeCollectionThemeSetting(app);
        expect(settings).toEqual({ backgroundTheme: 'forest', musicTrack: DEFAULT_MUSIC_TRACK });
        expect(app.soundManager.setTrack).toHaveBeenLastCalledWith(DEFAULT_MUSIC_TRACK, { persist: false });
        expect(Object.keys(app.themeCollection.exportData().grants)).toEqual(['forest']);
    });
});
