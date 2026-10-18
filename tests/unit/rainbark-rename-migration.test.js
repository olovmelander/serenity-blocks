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

const STORAGE_KEY = 'serenityBlocksSettings';
const OLD_THEME = 'cosmic-chimes';
const OLD_TRACK = 'CosmicChimes';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Rainbark took the Cosmic Chimes orb: what a player already has now means Rainbark', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('rainbark');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('rainbark');
        expect(resolveThemeId('rainbark')).toBe('rainbark');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('rainbark'));
        expect(getThemeMeta('rainbark')).toMatchObject({
            displayName: 'Rainbark',
            module: './rainbark/rainbark-theme.js',
            icon: './rainbark/rainbark-theme-icon.png',
        });
    });

    it('retitles the song with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('rainbark');
        expect(song).toMatchObject({
            name: 'Rainbark', file: 'rainbark.mp3', trackKey: 'Rainbark', placeholder: false,
        });
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Rainbark');
        expect(resolveMusicTrackKey('Rainbark')).toBe('Rainbark');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('rainbark');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('rainbark');
        expect(loaded.musicTrack).toBe('Rainbark');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('rainbark');
        expect(persisted.musicTrack).toBe('Rainbark');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('rainbark'))).toBe('Rainbark');
        expect(resolveOwnedMusicPreference('Rainbark', owns('rainbark'))).toBe('Rainbark');
        // Not owned: the default track, as for any other song.
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns())).toBe('EchoesOfTheSoul');
    });

    it('carries an earned collection entry and a seen mark over to the new id', () => {
        const earnedAt = '2026-09-01T10:00:00.000Z';
        const collection = normalizeThemeCollection({
            version: THEME_COLLECTION_VERSION,
            grants: { [OLD_THEME]: { source: 'odyssey', levelId: 47, earnedAt } },
            seenThemeIds: [OLD_THEME],
        }, resolveThemeId);
        expect(collection.grants.rainbark).toEqual({ source: 'odyssey', levelId: 47, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('rainbark');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['rainbark']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { 47: { stars: 2 } } });
        expect(getOdysseyCompletionThemeIds(legacy.completedLevels[47]).map(resolveThemeId)).toEqual(['rainbark']);
    });

    it('keeps the orb, renamed for the grove it now plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'rainbark');
        expect(orb).toBeDefined();
        // Orb 46 since the chapter 6 rival duel took the chapter's last slot.
        expect(orb.id).toBe(46);
        expect(orb.name).toBe('The Painted Giants');
        expect(orb.metadata.description).toMatch(/pocket of quiet/);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/cosmic-chimes|Cosmic Chimes/);
    });
});
