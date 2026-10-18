import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { SettingsManager } from '../../src/ui/settings.js';
import { THEME_REGISTRY, getThemeMeta, resolveThemeId } from '../../src/themes/theme-registry.js';
import {
    THEME_MUSIC_CATALOG, getThemeForMusic, getThemeMusic, resolveMusicTrackKey,
} from '../../src/core/progression/theme-music-catalog.js';
import { resolveOwnedMusicPreference } from '../../src/core/progression/music-preference.js';
import {
    normalizeThemeCollection, THEME_COLLECTION_VERSION,
} from '../../src/core/progression/theme-collection-model.js';
import {
    getOdysseyCompletionThemeIds, snapshotLegacyOdysseyThemes,
} from '../../src/core/odyssey/odyssey-progress-schema.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';

const STORAGE_KEY = 'serenityBlocksSettings';
const OLD_THEME = 'misty-lake';
const OLD_TRACK = 'MistyLake';
const OLD_ORB_NAME = 'Lakeside Awakening';
// The orb is authored as id 12 in levels.js and plays as orb 11 of the 60-orb campaign.
const ORB_ID = 11;
// The frozen v2 table (odyssey-progress-schema.js) stamps the old id at index 10.
const V2_ORB_INDEX = 10;

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Grainfields took the Misty Lake orb: what a player already has now means Grainfields', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('grainfields');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('grainfields');
        expect(resolveThemeId('grainfields')).toBe('grainfields');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('grainfields'));
        expect(getThemeMeta('grainfields')).toMatchObject({
            displayName: 'Grainfields',
            module: './grainfields/grainfields-theme.js',
            icon: './grainfields/grainfields-theme-icon.png',
            group: 'biomes',
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('retitles the recording with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('grainfields');
        expect(song).toMatchObject({
            name: 'Grainfields',
            file: 'grainfields.mp3',
            trackKey: 'Grainfields',
            placeholder: false,
        });
        expect(song).not.toHaveProperty('placeholderSource');
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Grainfields');
        expect(resolveMusicTrackKey('Grainfields')).toBe('Grainfields');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('grainfields');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('grainfields');
        expect(loaded.musicTrack).toBe('Grainfields');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('grainfields');
        expect(persisted.musicTrack).toBe('Grainfields');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('grainfields'))).toBe('Grainfields');
        expect(resolveOwnedMusicPreference('Grainfields', owns('grainfields'))).toBe('Grainfields');
        // Not owned: the default track, as for any other song.
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns())).toBe('EchoesOfTheSoul');
    });

    it('carries an earned collection entry and a seen mark over to the new id', () => {
        const earnedAt = '2026-09-01T10:00:00.000Z';
        const collection = normalizeThemeCollection({
            version: THEME_COLLECTION_VERSION,
            grants: { [OLD_THEME]: { source: 'odyssey', levelId: ORB_ID, earnedAt } },
            seenThemeIds: [OLD_THEME],
        }, resolveThemeId);
        expect(collection.grants.grainfields).toEqual({ source: 'odyssey', levelId: ORB_ID, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('grainfields');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['grainfields']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { [V2_ORB_INDEX]: { stars: 2 } } });
        const stamped = legacy.completedLevels[V2_ORB_INDEX];
        expect(stamped.themeId).toBe(OLD_THEME);
        expect(getOdysseyCompletionThemeIds(stamped).map(resolveThemeId)).toEqual(['grainfields']);
    });

    it('keeps the orb, renamed for the fields it now plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'grainfields');
        expect(orb).toBeDefined();
        expect(orb.id).toBe(ORB_ID);
        expect(orb.chapter).toBe(3);
        expect(orb.chapterLevel).toBe(1);
        expect(orb.isChapterStart).toBe(true);
        expect(orb.name).toBe('Grainfields');
        expect(orb.theme.transitionIn).toBe('crossfade');
        // The live briefing is the rebalance table's, written for the new world: ripe barley, the
        // Lapland gate, the storm breaking into sunbeams, the wind in the grain.
        expect(orb.metadata.description).toMatch(/barley/);
        expect(orb.metadata.description).toMatch(/Lapporten/);
        expect(orb.metadata.description).toMatch(/wind run through the grain/);
        expect(orb.metadata.description).not.toMatch(/lake|mist|volcano/i);
        // The chapter's theme list names it in the orb's own slot.
        expect(CHAPTER_CONFIGS.find((chapter) => chapter.id === 3).themes.primary[0]).toBe('grainfields');
        expect(LEVEL_CONFIGS.some((level) => level.theme?.primary === OLD_THEME)).toBe(false);
        expect(LEVEL_CONFIGS.some((level) => (level.theme?.overlays || []).includes(OLD_THEME))).toBe(false);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain(OLD_THEME);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain(OLD_ORB_NAME);
        expect(JSON.stringify(CHAPTER_CONFIGS)).not.toContain(OLD_THEME);
    });
});
