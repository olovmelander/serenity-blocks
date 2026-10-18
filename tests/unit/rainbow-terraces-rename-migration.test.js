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
import { getOdysseyCompletionThemeIds } from '../../src/core/odyssey/odyssey-progress-schema.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

const STORAGE_KEY = 'serenityBlocksSettings';
const OLD_THEME = 'sky-children';
const OLDER_THEME = 'sky-children-v2';
const OLD_TRACK = 'SkyChildren';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Sky Children was renamed Rainbow Terraces: what a player already has now means Rainbow Terraces', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with both old ids resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('rainbow-terraces');
        expect(ids).not.toContain(OLD_THEME);
        expect(ids).not.toContain(OLDER_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('rainbow-terraces');
        expect(resolveThemeId(OLDER_THEME)).toBe('rainbow-terraces');
        expect(resolveThemeId('rainbow-terraces')).toBe('rainbow-terraces');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('rainbow-terraces'));
        expect(getThemeMeta('rainbow-terraces')).toMatchObject({
            displayName: 'Rainbow Terraces',
            module: './rainbow-terraces/rainbow-terraces-theme.js',
            icon: './rainbow-terraces/rainbow-terraces-theme-icon.png',
        });
    });

    it('retitles the placeholder song with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('rainbow-terraces');
        expect(song).toMatchObject({
            name: 'Rainbow Terraces',
            file: 'rainbow-terraces-placeholder-song.mp3',
            trackKey: 'RainbowTerraces',
            placeholder: true,
        });
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(getThemeMusic(OLDER_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('RainbowTerraces');
        expect(resolveMusicTrackKey('RainbowTerraces')).toBe('RainbowTerraces');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('rainbow-terraces');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('rainbow-terraces');
        expect(loaded.musicTrack).toBe('RainbowTerraces');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('rainbow-terraces');
        expect(persisted.musicTrack).toBe('RainbowTerraces');

        // A save from the V2 days heals the same way.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundMode: 'Specific', backgroundTheme: OLDER_THEME }));
        expect(new SettingsManager().load().backgroundTheme).toBe('rainbow-terraces');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('rainbow-terraces'))).toBe('RainbowTerraces');
        expect(resolveOwnedMusicPreference('RainbowTerraces', owns('rainbow-terraces'))).toBe('RainbowTerraces');
        // Not owned: the default track, as for any other song.
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns())).toBe('EchoesOfTheSoul');
    });

    it('carries an earned collection entry and a seen mark over to the new id', () => {
        const earnedAt = '2026-09-01T10:00:00.000Z';
        const collection = normalizeThemeCollection({
            version: THEME_COLLECTION_VERSION,
            grants: { [OLD_THEME]: { source: 'odyssey', levelId: 34, earnedAt } },
            seenThemeIds: [OLD_THEME],
        }, resolveThemeId);
        expect(collection.grants['rainbow-terraces']).toEqual({ source: 'odyssey', levelId: 34, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('rainbow-terraces');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under either old id as this theme', () => {
        // The frozen v2 table never stamped this theme, so only saved completions name it.
        for (const id of [OLD_THEME, OLDER_THEME]) {
            const saved = { stars: 3, themeId: id, themeIds: [id] };
            expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId), id).toEqual(['rainbow-terraces']);
        }
    });

    it('keeps the orb, renamed for the terraces it now plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'rainbow-terraces');
        expect(orb).toBeDefined();
        // Orb 34 of the shipped campaign (authored as 33; chapter 5 ends on it): the chapter's rival
        // duel, whose briefing is written from the campaign rules and opens with the orb's name.
        expect(orb.id).toBe(34);
        expect(orb.name).toBe('Where Color Falls');
        expect(orb.metadata.description).toMatch(/^Where Color Falls: /);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/sky-children|Sky Children|Ethereal Heights/);
    });
});
