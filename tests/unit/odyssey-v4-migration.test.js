import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyStateManager, migrateOdysseyProgressData } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_SAVE_VERSION, migrateV3OdysseyLevelId } from '../../src/core/odyssey/odyssey-progress-schema.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { ThemeCollectionService } from '../../src/core/progression/theme-collection-service.js';
import { THEME_REGISTRY, resolveThemeId } from '../../src/themes/theme-registry.js';
import {
    ODYSSEY_PROGRESS_STORAGE_KEY, THEME_COLLECTION_STORAGE_KEY, createThemeCollectionData,
} from '../../src/core/progression/theme-collection-model.js';

let storage;
beforeEach(() => {
    const values = new Map();
    storage = {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, value)),
        removeItem: vi.fn((key) => values.delete(key)),
    };
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const completed = (themeId, stars = 3) => ({ stars, themeId, themeIds: [themeId] });
function collection() {
    return new ThemeCollectionService({
        catalog: THEME_REGISTRY,
        levels: new LevelRegistry().getAllLevels(),
        storage,
        resolveThemeId,
        migrateProgress: migrateOdysseyProgressData,
    });
}

describe('Odyssey v4 challenge identity migration', () => {
    it('maps every surviving authored identity once and leaves both new orbs incomplete', () => {
        const prior = {
            version: 3,
            currentLevel: 59,
            unlockedLevels: Array.from({ length: 59 }, (_, index) => index + 1),
            completedLevels: Object.fromEntries(Array.from({ length: 59 }, (_, index) => [
                index + 1, { ...completed('cinder-drift'), bestScore: (index + 1) * 100 },
            ])),
            statistics: { totalStars: 177, chaptersCompleted: 8, totalPlayTime: 4200 },
        };
        const migrated = migrateOdysseyProgressData(prior);
        expect(migrated.version).toBe(ODYSSEY_SAVE_VERSION);
        expect(Object.keys(migrated.completedLevels)).toHaveLength(58);
        for (let oldId = 1; oldId <= 59; oldId++) {
            const newId = migrateV3OdysseyLevelId(oldId);
            if (newId) expect(migrated.completedLevels[newId].bestScore).toBe(oldId * 100);
        }
        expect(migrated.completedLevels[43]).toBeUndefined();
        expect(migrated.completedLevels[55]).toBeUndefined();
        expect(migrated.retiredCompletions['v3:10'].bestScore).toBe(1000);
        expect(migrated.unlockedLevels).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
        expect(migrated.currentLevel).toBe(60);
        expect(migrated.statistics).toEqual({ totalStars: 174, chaptersCompleted: 6, totalPlayTime: 4200 });
        const once = JSON.stringify(migrated);
        expect(JSON.stringify(migrateOdysseyProgressData(migrated))).toBe(once);
    });

    it('preserves orb identity even when a prior theme snapshot matches a newly inserted theme', () => {
        const migrated = migrateOdysseyProgressData({
            version: 3, completedLevels: { 19: completed('vesper-chrysalis'), 59: completed('serenity-warp') },
        });
        expect(migrated.completedLevels[18].themeId).toBe('vesper-chrysalis');
        expect(migrated.completedLevels[60].themeId).toBe('serenity-warp');
        expect(migrated.completedLevels[43]).toBeUndefined();
        expect(migrated.completedLevels[55]).toBeUndefined();
    });

    it.each([[43, 43], [54, 55]])('opens inserted orb after successful preceding old orb %i', (oldId, newId) => {
        const prior = {
            version: 3, currentLevel: oldId, unlockedLevels: [oldId], completedLevels: {},
        };
        expect(migrateOdysseyProgressData(structuredClone(prior)).unlockedLevels).not.toContain(newId);
        prior.completedLevels[oldId] = completed('cinder-drift');
        expect(migrateOdysseyProgressData(prior).unlockedLevels).toContain(newId);
    });

    it('moves a player at the removed reef to Stillwater without inventing a clear', () => {
        const migrated = migrateOdysseyProgressData({ version: 3, currentLevel: 10, unlockedLevels: [9, 10] });
        expect(migrated.currentLevel).toBe(10);
        expect(migrated.currentChapter).toBe(2);
        expect(migrated.unlockedLevels).toEqual([9, 10]);
        expect(migrated.completedLevels).toEqual({});
    });

    it('does not open inserted orbs from malformed out-of-range progress', () => {
        const migrated = migrateOdysseyProgressData({ version: 3, currentLevel: 999, unlockedLevels: [999, 'bad'] });
        expect(migrated.unlockedLevels).toEqual([1]);
        expect(migrated.currentLevel).toBe(1);
    });

    it('retains the retired completion through a later state save without counting its stars', () => {
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 3, completedLevels: { 10: completed('bioluminescence-2'), 11: completed('stillwater', 2) },
        }));
        const state = new OdysseyStateManager();
        expect(state.isLevelCompleted(10)).toBe(true);
        expect(state.getTotalStars()).toBe(2);
        state.completeLevel(1, { stars: 1 });
        const saved = JSON.parse(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY));
        expect(saved.retiredCompletions['v3:10'].themeIds).toEqual(['bioluminescence-2']);
        expect(saved.completedLevels['10'].themeId).toBe('stillwater');
        expect(saved.statistics.totalStars).toBe(3);
    });

    it('recovers a genuinely played known theme from a retired v2 orb without granting its new identity', () => {
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 2, completedLevels: { 10: { stars: 1 } },
        }));
        const owned = collection();
        expect(owned.isUnlocked('misty-lake')).toBe(true);
        expect(owned.isUnlocked('stillwater')).toBe(false);
        expect(owned.isUnlocked('bioluminescence')).toBe(false);
        expect(owned.exportData().grants['misty-lake'].levelId).toBeUndefined();
    });

    it('keeps retired BioII grants as evidence without counting or replacing them', () => {
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify({
            ...createThemeCollectionData(),
            grants: { 'bioluminescence-2': { source: 'odyssey', levelId: 10 } },
        }));
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 3, completedLevels: { 10: completed('bioluminescence-2') },
        }));
        const owned = collection();
        expect(owned.getSummary()).toEqual({ owned: 1, total: 61, newCount: 0 });
        expect(owned.isUnlocked('bioluminescence-2')).toBe(false);
        expect(owned.isUnlocked('bioluminescence')).toBe(false);
        expect(owned.exportData().grants['bioluminescence-2']).toEqual({ source: 'odyssey', levelId: 10 });
    });

    it.each([
        { 'future:10': completed('misty-lake') },
        { 'v3:10': completed('misty-lake', 0) },
        { 'v3:10': { stars: 1, themeIds: [null, {}, 'bad id'] } },
    ])('does not recover unrecognized or malformed retired evidence: %j', (retiredCompletions) => {
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: ODYSSEY_SAVE_VERSION, retiredCompletions,
        }));
        expect(collection().getOwnedThemeIds()).toEqual(['forest']);
    });
});
