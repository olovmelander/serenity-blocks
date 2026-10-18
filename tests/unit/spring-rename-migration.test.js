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
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

const STORAGE_KEY = 'serenityBlocksSettings';
const OLD_THEME = 'moonlit-forest';
const OLD_TRACK = 'MoonlitForest';
// The orb is authored as id 13 in levels.js and plays as orb 12 of the 60-orb campaign.
const ORB_ID = 12;
// The frozen v2 table (odyssey-progress-schema.js) stamps the old id at index 13.
const V2_ORB_INDEX = 13;

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Spring took the Moonlit Forest orb: what a player already has now means Spring', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('spring');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('spring');
        expect(resolveThemeId('spring')).toBe('spring');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('spring'));
        expect(getThemeMeta('spring')).toMatchObject({
            displayName: 'Spring',
            module: './spring/spring-theme.js',
            icon: './spring/spring-theme-icon.png',
            group: 'biomes',
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('retitles the song with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('spring');
        expect(song).toMatchObject({
            name: 'Spring', file: 'spring.mp3', trackKey: 'Spring', placeholder: false,
        });
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Spring');
        expect(resolveMusicTrackKey('Spring')).toBe('Spring');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('spring');
        // The recording is also Odyssey Chapter 3's music: the chapter names it by its new key.
        expect(CHAPTER_CONFIGS.find((chapter) => chapter.id === 3).music.track).toBe('Spring');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('spring');
        expect(loaded.musicTrack).toBe('Spring');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('spring');
        expect(persisted.musicTrack).toBe('Spring');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('spring'))).toBe('Spring');
        expect(resolveOwnedMusicPreference('Spring', owns('spring'))).toBe('Spring');
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
        expect(collection.grants.spring).toEqual({ source: 'odyssey', levelId: ORB_ID, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('spring');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['spring']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { [V2_ORB_INDEX]: { stars: 2 } } });
        const stamped = legacy.completedLevels[V2_ORB_INDEX];
        expect(stamped.themeId).toBe(OLD_THEME);
        expect(getOdysseyCompletionThemeIds(stamped).map(resolveThemeId)).toEqual(['spring']);
    });

    it('keeps the orb, renamed for the river in flood it now plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'spring');
        expect(orb).toBeDefined();
        expect(orb.id).toBe(ORB_ID);
        expect(orb.chapter).toBe(3);
        expect(orb.chapterLevel).toBe(2);
        expect(orb.name).toBe('Spring Flood');
        expect(orb.theme.transitionIn).toBe('crossfade');
        expect(orb.metadata.description).toMatch(/^A northern river runs high with the spring melt/);
        expect(orb.metadata.tip).toMatch(/rapids/);
        // Chapter 3's theme list follows the orb order, so the chapter names the new theme at its place.
        expect(CHAPTER_CONFIGS.find((chapter) => chapter.id === 3).themes.primary[1]).toBe('spring');
        expect(LEVEL_CONFIGS.some((level) => level.theme?.primary === OLD_THEME)).toBe(false);
        expect(LEVEL_CONFIGS.some((level) => (level.theme?.overlays || []).includes(OLD_THEME))).toBe(false);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/moonlit-forest|Moonlit Grove|Moonlit Forest/);
    });
});
