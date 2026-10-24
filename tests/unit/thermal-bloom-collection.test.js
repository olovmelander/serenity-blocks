import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeCollectionService } from '../../src/core/progression/theme-collection-service.js';
import {
    THEME_COLLECTION_STORAGE_KEY, ODYSSEY_PROGRESS_STORAGE_KEY, createThemeCollectionData,
} from '../../src/core/progression/theme-collection-model.js';
import { getThemeForMusic, getThemeMusic } from '../../src/core/progression/theme-music-catalog.js';
import { MusicPlaybackAccess } from '../../src/audio/music-playback-access.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager, migrateOdysseyProgressData } from '../../src/core/odyssey/OdysseyStateManager.js';
import { ODYSSEY_SAVE_VERSION } from '../../src/core/odyssey/odyssey-progress-schema.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { getOdysseyThemePresentationPalette } from '../../src/core/odyssey/theme-presentation.js';
import { ODYSSEY_COLLECTION_REWARDS } from '../../src/themes/theme-collection.js';
import { THEME_REGISTRY, getThemeMeta, resolveThemeId } from '../../src/themes/theme-registry.js';
import {
    getCollectionCardPresentation, getRequirementShortLabel,
} from '../../src/ui/serenity-hub/ThemeCollectionView.js';

// Thermal Bloom has no orb: it is the bonus for completing every orb of Odyssey chapter 1.
const THEME = 'thermal-bloom';
const CHAPTER_ONE = CHAPTER_CONFIGS.find((chapter) => chapter.id === 1);
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const success = {
    stars: 1, score: 1000, time: 60, lines: 20, bonuses: [],
};

let storage;
let registry;

function createCollection() {
    return new ThemeCollectionService({
        catalog: THEME_REGISTRY,
        levels: registry.getAllLevels(),
        rules: ODYSSEY_COLLECTION_REWARDS,
        resolveThemeId,
        migrateProgress: migrateOdysseyProgressData,
        storage,
        now: () => NOW,
    });
}

function complete(collection, state, levelId) {
    const result = state.completeLevel(levelId, success);
    return collection.awardCompletion({
        levelId,
        themeId: registry.getLevel(levelId).theme.primary,
        progressPersisted: result.persisted,
    });
}

/** A current (v4) Odyssey save in the shape OdysseyStateManager.getSaveData() writes. */
function odysseySave(completedIds) {
    const completion = (levelId) => {
        const themeId = registry.getLevel(levelId).theme.primary;
        return {
            stars: 2,
            bestScore: 4200,
            bestTime: 180,
            completedBonuses: [],
            completionDate: '2026-09-01T10:00:00.000Z',
            attempts: 1,
            themeId,
            themeIds: [themeId],
        };
    };
    const last = Math.max(0, ...completedIds);
    return {
        version: ODYSSEY_SAVE_VERSION,
        currentChapter: registry.getLevel(last + 1)?.chapter ?? 1,
        currentLevel: last + 1,
        unlockedLevels: Array.from({ length: last + 1 }, (_, index) => index + 1),
        completedLevels: Object.fromEntries(completedIds.map((id) => [String(id), completion(id)])),
        retiredCompletions: {},
        statistics: {
            totalPlayTime: 900,
            totalAttempts: completedIds.length,
            totalLinesCleared: 100,
            totalScore: 4200 * completedIds.length,
            highestCombo: 3,
            maxCascadeDepth: 1,
            chaptersCompleted: 0,
            totalStars: 2 * completedIds.length,
        },
        lastSaveDate: '2026-09-01T10:05:00.000Z',
    };
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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registry = new LevelRegistry();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Thermal Bloom, the chapter 1 collection bonus', () => {
    it('is a registered theme with no orb and exactly one frozen chapter 1 rule', () => {
        expect(getThemeMeta(THEME)).toMatchObject({
            id: THEME, displayName: 'Thermal Bloom', group: 'biomes', performanceClass: 'heavy',
        });
        expect(registry.getAllLevels().some((level) => level.theme.primary === THEME)).toBe(false);
        const rules = ODYSSEY_COLLECTION_REWARDS.filter((rule) => rule.themeIds.includes(THEME));
        expect(rules).toEqual([{
            type: 'chapter',
            chapterId: 1,
            themeIds: [THEME],
            label: 'Complete every orb in Odyssey Chapter 1 · Earth Core & Subterranean Origins.',
        }]);
        // Chapter 1 has no other bonus.
        expect(ODYSSEY_COLLECTION_REWARDS.filter((rule) => rule.chapterId === 1)).toEqual(rules);
        expect(Object.isFrozen(ODYSSEY_COLLECTION_REWARDS)).toBe(true);
        expect(Object.isFrozen(rules[0])).toBe(true);
        expect(Object.isFrozen(rules[0].themeIds)).toBe(true);
        // The label names the chapter as the campaign does, and the chapter is orbs 1-5.
        expect(rules[0].label).toContain(CHAPTER_ONE.name);
        expect(CHAPTER_ONE.levelRange).toEqual([1, 5]);
        expect(registry.getLevelsInChapter(1).map((level) => level.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it('is not granted by orbs 1-4 or by other chapters, and arrives with orb 5', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        for (const levelId of [1, 2, 3, 4, 6]) {
            expect(complete(collection, state, levelId).themeIds)
                .toEqual([registry.getLevel(levelId).theme.primary]);
        }
        expect(collection.isUnlocked(THEME)).toBe(false);

        const receipt = complete(collection, state, 5);
        expect(receipt).toEqual({
            themeIds: ['pyrestorm', THEME], totalOwned: 8, totalThemes: 63, persisted: true, sourceLevelId: 5,
        });
        expect(collection.isUnlocked(THEME)).toBe(true);
        expect(collection.exportData().grants[THEME]).toEqual({
            source: 'chapter', levelId: 5, earnedAt: new Date(NOW).toISOString(),
        });
        expect(collection.getThemeStatus(THEME).isNew).toBe(true);
        // Replaying an orb of the finished chapter grants nothing twice.
        expect(complete(collection, state, 3).themeIds).toEqual([]);
        expect(createCollection().isUnlocked(THEME)).toBe(true);
    });

    it('is granted quietly on reconcile to a player whose save already finished chapter 1', () => {
        // The collection a player had before Thermal Bloom existed: Forest and chapter 1's five orbs.
        const before = createThemeCollectionData();
        registry.getLevelsInChapter(1).forEach((level) => {
            before.grants[level.theme.primary] = {
                source: 'odyssey', levelId: level.id, earnedAt: '2026-09-01T10:00:00.000Z',
            };
            before.seenThemeIds.push(level.theme.primary);
        });
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify(before));
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify(odysseySave([1, 2, 3, 4, 5])));

        const collection = createCollection();
        expect(collection.isUnlocked(THEME)).toBe(true);
        expect(collection.exportData().grants[THEME]).toEqual({
            source: 'chapter', earnedAt: new Date(NOW).toISOString(),
        });
        expect(collection.getSummary()).toEqual({ owned: 7, total: 63, newCount: 0 });
        expect(collection.getThemeStatus(THEME)).toMatchObject({ owned: true, isNew: false });
        expect(JSON.parse(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).grants[THEME].source).toBe('chapter');
    });

    it('is not granted on reconcile while one orb of chapter 1 is unfinished', () => {
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify(odysseySave([1, 2, 3, 4, 6])));
        const collection = createCollection();
        expect(collection.getOwnedThemeIds()).toHaveLength(6);
        expect(collection.isUnlocked(THEME)).toBe(false);
    });

    it('names the chapter route on its card and in its details', () => {
        const collection = createCollection();
        const status = collection.getThemeStatus(THEME);
        expect(status).toEqual({
            themeId: THEME,
            owned: false,
            isNew: false,
            requirement: {
                type: 'chapter',
                chapterId: 1,
                label: `Complete every orb in Odyssey Chapter 1 · ${CHAPTER_ONE.name}.`,
            },
        });
        expect(getRequirementShortLabel(status.requirement)).toBe('Odyssey Chapter 1');
        expect(getCollectionCardPresentation(getThemeMeta(THEME), collection, 'forest')).toMatchObject({
            label: 'Locked',
            requirement: status.requirement.label,
            requirementShort: 'Odyssey Chapter 1',
            requirementType: 'chapter',
            accessibleLabel: 'Thermal Bloom, locked. View theme details',
        });
    });

    it('brings its song home with the theme', () => {
        expect(getThemeMusic(THEME)).toEqual({
            themeId: THEME,
            trackKey: 'ThermalBloom',
            name: 'Thermal Bloom',
            file: 'thermal-bloom.mp3',
            path: './assets/music/thermal-bloom.mp3',
            placeholder: false,
        });
        expect(getThemeForMusic('ThermalBloom')).toBe(THEME);

        const collection = createCollection();
        const access = new MusicPlaybackAccess();
        access.collection = collection;
        expect(access.canPlay('ThermalBloom')).toBe(false);
        const state = new OdysseyStateManager({ levelRegistry: registry });
        for (let levelId = 1; levelId <= 5; levelId++) complete(collection, state, levelId);
        expect(access.canPlay('ThermalBloom')).toBe(true);
    });

    it('has an Odyssey presentation palette in Vent Turquoise', () => {
        expect(getOdysseyThemePresentationPalette(THEME)).toMatchObject({ primary: '#14b3c8' });
    });
});
