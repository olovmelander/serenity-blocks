import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { SettingsManager } from '../../src/ui/settings.js';
import { THEME_REGISTRY, getThemeMeta, resolveThemeId } from '../../src/themes/theme-registry.js';
import {
    THEME_MUSIC_CATALOG, getThemeForMusic, getThemeMusic, resolveMusicTrackKey,
} from '../../src/core/progression/theme-music-catalog.js';
import { resolveOwnedMusicPreference } from '../../src/core/progression/music-preference.js';
import { normalizeThemeCollection, THEME_COLLECTION_VERSION } from '../../src/core/progression/theme-collection-model.js';
import { getOdysseyCompletionThemeIds, snapshotLegacyOdysseyThemes } from '../../src/core/odyssey/odyssey-progress-schema.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

const STORAGE_KEY = 'serenityBlocksSettings';
const OLD_THEME = 'electric-dreams-v3';
const OLD_TRACK = 'ElectricDreams';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Electric Dreams V3 became Murmuration: what a player already has still means it', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('murmuration');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('murmuration');
        expect(resolveThemeId('murmuration')).toBe('murmuration');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('murmuration'));
        expect(getThemeMeta('murmuration')).toMatchObject({
            displayName: 'Murmuration',
            module: './murmuration/murmuration-theme.js',
            icon: './murmuration/murmuration-theme-icon.png',
        });
    });

    it('retitles the song with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('murmuration');
        expect(song).toMatchObject({
            name: 'Murmuration', file: 'murmuration.mp3', trackKey: 'Murmuration', placeholder: false,
        });
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Murmuration');
        expect(resolveMusicTrackKey('Murmuration')).toBe('Murmuration');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('murmuration');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('murmuration');
        expect(loaded.musicTrack).toBe('Murmuration');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('murmuration');
        expect(persisted.musicTrack).toBe('Murmuration');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('murmuration'))).toBe('Murmuration');
        expect(resolveOwnedMusicPreference('Murmuration', owns('murmuration'))).toBe('Murmuration');
        // Not owned: the default track, as for any other song.
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns())).toBe('EchoesOfTheSoul');
    });

    it('carries an earned collection entry and a seen mark over to the new id', () => {
        const earnedAt = '2026-09-01T10:00:00.000Z';
        const collection = normalizeThemeCollection({
            version: THEME_COLLECTION_VERSION,
            grants: { [OLD_THEME]: { source: 'odyssey', levelId: 54, earnedAt } },
            seenThemeIds: [OLD_THEME],
        }, resolveThemeId);
        expect(collection.grants.murmuration).toEqual({ source: 'odyssey', levelId: 54, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('murmuration');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['murmuration']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { 54: { stars: 2 } } });
        expect(getOdysseyCompletionThemeIds(legacy.completedLevels[54]).map(resolveThemeId)).toEqual(['murmuration']);
    });

    it('names the Odyssey orb after the theme it plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'murmuration');
        expect(orb).toBeDefined();
        expect(orb.name).toBe('Murmuration');
        expect(orb.metadata.description).toMatch(/flock of light/);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/electric-dreams|Electric Dreams/);
    });
});
