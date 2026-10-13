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
const OLD_THEME = 'mountain';
const OLD_TRACK = 'Mountain';
// The orb is authored as id 25 in levels.js and plays as orb 24 of the 60-orb campaign.
const ORB_ID = 24;
// The frozen v2 table (odyssey-progress-schema.js) stamps the old id at index 25.
const V2_ORB_INDEX = 25;

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('High Coast took the Mountain orb: what a player already has now means High Coast', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('high-coast');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('high-coast');
        expect(resolveThemeId('high-coast')).toBe('high-coast');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('high-coast'));
        expect(getThemeMeta('high-coast')).toMatchObject({
            displayName: 'High Coast',
            module: './high-coast/high-coast-theme.js',
            icon: './high-coast/high-coast-theme-icon.png',
            group: 'biomes',
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('renames the placeholder song with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('high-coast');
        expect(song).toMatchObject({
            name: 'High Coast',
            file: 'high-coast-placeholder-song.mp3',
            trackKey: 'HighCoast',
            placeholder: true,
            placeholderSource: 'blood-moon.mp3',
        });
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('HighCoast');
        expect(resolveMusicTrackKey('HighCoast')).toBe('HighCoast');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('high-coast');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('high-coast');
        expect(loaded.musicTrack).toBe('HighCoast');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('high-coast');
        expect(persisted.musicTrack).toBe('HighCoast');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('high-coast'))).toBe('HighCoast');
        expect(resolveOwnedMusicPreference('HighCoast', owns('high-coast'))).toBe('HighCoast');
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
        expect(collection.grants['high-coast']).toEqual({ source: 'odyssey', levelId: ORB_ID, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('high-coast');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['high-coast']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { [V2_ORB_INDEX]: { stars: 2 } } });
        const stamped = legacy.completedLevels[V2_ORB_INDEX];
        expect(stamped.themeId).toBe(OLD_THEME);
        expect(getOdysseyCompletionThemeIds(stamped).map(resolveThemeId)).toEqual(['high-coast']);
    });

    it('keeps the orb, renamed for the coast it now plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'high-coast');
        expect(orb).toBeDefined();
        expect(orb.id).toBe(ORB_ID);
        expect(orb.chapter).toBe(4);
        expect(orb.name).toBe('The High Coast');
        expect(orb.theme.transitionIn).toBe('crossfade');
        expect(orb.metadata.description).toMatch(/High Coast/);
        expect(orb.metadata.description).toMatch(/let the land rise/);
        // Other orbs legitimately say "mountain" (orb 19 is "Mountain Base"), so look for the old
        // theme id and the old orb name rather than the word.
        expect(LEVEL_CONFIGS.some((level) => level.theme?.primary === OLD_THEME)).toBe(false);
        expect(LEVEL_CONFIGS.some((level) => (level.theme?.overlays || []).includes(OLD_THEME))).toBe(false);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/"mountain"|Mountain Stillness/);
    });
});
