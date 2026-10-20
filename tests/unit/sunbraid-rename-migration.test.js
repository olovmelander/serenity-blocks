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
const OLD_THEME = 'rainy-window';
const OLD_TRACK = 'RainyWindow';
const OLD_NAME = 'Rainy Window';
const OLD_ORB_NAME = 'Storm Surge';
// The orb is authored as id 32 in levels.js and plays as orb 31 of the 60-orb campaign.
const ORB_ID = 31;
// The frozen v2 table (odyssey-progress-schema.js) stamps the old id at index 32.
const V2_ORB_INDEX = 32;

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Sunbraid took the Rainy Window orb: what a player already has now means Sunbraid', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('sunbraid');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('sunbraid');
        expect(resolveThemeId('sunbraid')).toBe('sunbraid');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('sunbraid'));
        expect(getThemeMeta('sunbraid')).toMatchObject({
            displayName: 'Sunbraid',
            module: './sunbraid/sunbraid-theme.js',
            icon: './sunbraid/sunbraid-theme-icon.png',
            group: 'fantasy',
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('retitles the recording with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('sunbraid');
        expect(song).toMatchObject({
            name: 'Sunbraid',
            file: 'sunbraid.mp3',
            trackKey: 'Sunbraid',
            placeholder: false,
        });
        expect(song).not.toHaveProperty('placeholderSource');
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.name === OLD_NAME)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Sunbraid');
        expect(resolveMusicTrackKey('Sunbraid')).toBe('Sunbraid');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('sunbraid');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('sunbraid');
        expect(loaded.musicTrack).toBe('Sunbraid');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('sunbraid');
        expect(persisted.musicTrack).toBe('Sunbraid');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('sunbraid'))).toBe('Sunbraid');
        expect(resolveOwnedMusicPreference('Sunbraid', owns('sunbraid'))).toBe('Sunbraid');
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
        expect(collection.grants.sunbraid).toEqual({ source: 'odyssey', levelId: ORB_ID, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('sunbraid');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['sunbraid']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { [V2_ORB_INDEX]: { stars: 2 } } });
        const stamped = legacy.completedLevels[V2_ORB_INDEX];
        expect(stamped.themeId).toBe(OLD_THEME);
        expect(getOdysseyCompletionThemeIds(stamped).map(resolveThemeId)).toEqual(['sunbraid']);
    });

    it('keeps the orb and its mechanics, renamed for the suns it now plays under', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'sunbraid');
        expect(orb).toBeDefined();
        expect(orb.id).toBe(ORB_ID);
        expect(orb.chapter).toBe(5);
        expect(orb.chapterLevel).toBe(5);
        expect(orb.isChapterStart).toBe(false);
        expect(orb.name).toBe('The Turning Suns');
        expect(orb.theme.transitionIn).toBe('crossfade');
        // Still the chapter's sprint test: lines against the clock, pieces falling fast.
        expect(orb.role).toBe('test');
        expect(orb.modifiers.active).toEqual(['time-attack']);
        expect(orb.victory.primary.type).toBe('lines');
        expect(orb.metadata.description).toMatch(/Three coloured suns/);
        expect(orb.metadata.description).toMatch(/every shadow takes a colour/);
        expect(orb.metadata.description).not.toMatch(/storm|rain|window/i);
        expect(orb.metadata.tip).toMatch(/suns/);
        expect(orb.metadata.tip).not.toMatch(/storm|rain/i);
        // The chapter's theme list names it in the orb's own slot.
        expect(CHAPTER_CONFIGS.find((chapter) => chapter.id === 5).themes.primary[4]).toBe('sunbraid');
        expect(LEVEL_CONFIGS.some((level) => level.theme?.primary === OLD_THEME)).toBe(false);
        expect(LEVEL_CONFIGS.some((level) => (level.theme?.overlays || []).includes(OLD_THEME))).toBe(false);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain(OLD_THEME);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain(OLD_NAME);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain(OLD_ORB_NAME);
        expect(JSON.stringify(CHAPTER_CONFIGS)).not.toContain(OLD_THEME);
    });
});
