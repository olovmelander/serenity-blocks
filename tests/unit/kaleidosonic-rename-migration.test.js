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
const OLD_THEME = 'singing-bowl';
const OLD_TRACK = 'SingingBowl';
// The orb is authored as id 55 in levels.js and plays as orb 56 of the 60-orb campaign.
const ORB_ID = 56;
// The frozen v2 table (odyssey-progress-schema.js) stamps the old id at index 55.
const V2_ORB_INDEX = 55;

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Kaleidosonic took the Singing Bowl orb: what a player already has now means Kaleidosonic', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the theme under one id, with the old id resolving to it', () => {
        const ids = THEME_REGISTRY.map((entry) => entry.id);
        expect(ids).toContain('kaleidosonic');
        expect(ids).not.toContain(OLD_THEME);
        expect(resolveThemeId(OLD_THEME)).toBe('kaleidosonic');
        expect(resolveThemeId('kaleidosonic')).toBe('kaleidosonic');
        expect(getThemeMeta(OLD_THEME)).toBe(getThemeMeta('kaleidosonic'));
        expect(getThemeMeta('kaleidosonic')).toMatchObject({
            displayName: 'Kaleidosonic',
            module: './kaleidosonic/kaleidosonic-theme.js',
            icon: './kaleidosonic/kaleidosonic-theme-icon.png',
            group: 'meditation',
            resourceProfile: 'heavy-gpu',
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('renames the placeholder song with the theme and keeps the old track key selectable', () => {
        const song = getThemeMusic('kaleidosonic');
        expect(song).toMatchObject({
            name: 'Kaleidosonic',
            file: 'kaleidosonic-placeholder-song.mp3',
            trackKey: 'Kaleidosonic',
            placeholder: true,
            placeholderSource: 'blood-moon.mp3',
        });
        expect(getThemeMusic(OLD_THEME)).toBe(song);
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Kaleidosonic');
        expect(resolveMusicTrackKey('Kaleidosonic')).toBe('Kaleidosonic');
        expect(resolveMusicTrackKey('NoSuchTrack')).toBe('NoSuchTrack');
        expect(getThemeForMusic(OLD_TRACK)).toBe('kaleidosonic');
    });

    it('heals a saved background theme and a saved track on load, and writes the healed values back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            backgroundMode: 'Specific', backgroundTheme: OLD_THEME, musicTrack: OLD_TRACK, musicVolume: 0.4,
        }));
        const loaded = new SettingsManager().load();
        expect(loaded.backgroundTheme).toBe('kaleidosonic');
        expect(loaded.musicTrack).toBe('Kaleidosonic');
        expect(loaded.musicVolume).toBe(0.4);
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.backgroundTheme).toBe('kaleidosonic');
        expect(persisted.musicTrack).toBe('Kaleidosonic');

        // Settings that never named either are left as they were.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ backgroundTheme: 'lunara', musicTrack: 'Lunara' }));
        const other = new SettingsManager().load();
        expect(other.backgroundTheme).toBe('lunara');
        expect(other.musicTrack).toBe('Lunara');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('kaleidosonic'))).toBe('Kaleidosonic');
        expect(resolveOwnedMusicPreference('Kaleidosonic', owns('kaleidosonic'))).toBe('Kaleidosonic');
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
        expect(collection.grants.kaleidosonic).toEqual({ source: 'odyssey', levelId: ORB_ID, earnedAt });
        expect(collection.grants[OLD_THEME]).toBeUndefined();
        expect(collection.seenThemeIds).toContain('kaleidosonic');
        expect(collection.seenThemeIds).not.toContain(OLD_THEME);
    });

    it('still reads an Odyssey completion recorded under the old id as this theme', () => {
        // A completion saved by an earlier build, and one stamped from the frozen v2 table.
        const saved = { stars: 3, themeId: OLD_THEME, themeIds: [OLD_THEME] };
        expect(getOdysseyCompletionThemeIds(saved).map(resolveThemeId)).toEqual(['kaleidosonic']);
        const legacy = snapshotLegacyOdysseyThemes({ completedLevels: { [V2_ORB_INDEX]: { stars: 2 } } });
        const stamped = legacy.completedLevels[V2_ORB_INDEX];
        expect(stamped.themeId).toBe(OLD_THEME);
        expect(getOdysseyCompletionThemeIds(stamped).map(resolveThemeId)).toEqual(['kaleidosonic']);
    });

    it('keeps the orb\'s place, renamed and described for the temple it now plays', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'kaleidosonic');
        expect(orb).toBeDefined();
        expect(orb.id).toBe(ORB_ID);
        expect(orb.chapter).toBe(7);
        expect(orb.isChapterEnd).toBe(true);
        expect(orb.name).toBe('Indra\'s Net');
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/Recursive Infinity/);
        expect(orb.metadata.description).toBe('The final abstract challenge. A kaleidoscopic temple of folded light '
            + 'rings with every piece you lock, and folds deeper with every cascade you build.');
        expect(LEVEL_CONFIGS.some((level) => level.theme?.primary === OLD_THEME)).toBe(false);
        expect(LEVEL_CONFIGS.some((level) => (level.theme?.overlays || []).includes(OLD_THEME))).toBe(false);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/singing-bowl|Singing Bowl|Reflected geometric branches/);
    });
});
