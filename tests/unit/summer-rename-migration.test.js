import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { SettingsManager } from '../../src/ui/settings.js';
import { THEME_REGISTRY, getThemeMeta } from '../../src/themes/theme-registry.js';
import {
    THEME_MUSIC_CATALOG, getThemeForMusic, getThemeMusic, resolveMusicTrackKey,
} from '../../src/core/progression/theme-music-catalog.js';
import { resolveOwnedMusicPreference } from '../../src/core/progression/music-preference.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { TRANSIT_NAMES, tickerLine } from '../../src/themes/neon-district/neon-district-campaigns.js';
import { BILLBOARD_CELLS } from '../../src/themes/neon-district/neon-district-atlas.js';

const STORAGE_KEY = 'serenityBlocksSettings';
const OLD_TRACK = 'Midsommar';
const musicFolder = fileURLToPath(new URL('../../public/assets/music/', import.meta.url));

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

/** The TIT2 (title) frame of an ID3v2.4 tag. */
function id3Title(file) {
    const head = readFileSync(file).subarray(0, 4096);
    expect(head.subarray(0, 4).toString('latin1')).toBe('ID3\u0004');
    const at = head.indexOf('TIT2', 10, 'latin1');
    expect(at).toBeGreaterThan(9);
    const body = head.subarray(at + 10, at + 10 + head.readUInt32BE(at + 4));
    expect(body[0]).toBe(3); // UTF-8
    return body.subarray(1).toString('utf8');
}

describe('Midsommar is now called Summer: the theme, its song and what a player already has', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('keeps the theme id and shows the theme as Summer', () => {
        expect(getThemeMeta('summer')).toMatchObject({ id: 'summer', displayName: 'Summer' });
        expect(THEME_REGISTRY.some((entry) => /midsommar|midsummer/i.test(entry.displayName))).toBe(false);
    });

    it('retitles the recording, its file and its own title tag, and keeps the old track key', () => {
        const song = getThemeMusic('summer');
        expect(song).toMatchObject({
            name: 'Summer',
            file: 'summer.mp3',
            path: './assets/music/summer.mp3',
            trackKey: 'Summer',
            placeholder: false,
        });
        expect(THEME_MUSIC_CATALOG.some((entry) => entry.trackKey === OLD_TRACK)).toBe(false);
        expect(resolveMusicTrackKey(OLD_TRACK)).toBe('Summer');
        expect(resolveMusicTrackKey('Summer')).toBe('Summer');
        expect(getThemeForMusic(OLD_TRACK)).toBe('summer');
        expect(readdirSync(musicFolder)).not.toContain('midsommar.mp3');
        expect(id3Title(`${musicFolder}/summer.mp3`)).toBe('Summer');
        const shipped = JSON.parse(readFileSync(`${musicFolder}/songs.json`, 'utf8'));
        expect(shipped.find((entry) => entry.themeId === 'summer')).toMatchObject({
            name: 'Summer', trackKey: 'Summer', file: 'summer.mp3',
        });
        expect(JSON.stringify(shipped)).not.toMatch(/midsommar/i);
    });

    it('heals a saved track on load, and writes the healed value back', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicTrack: OLD_TRACK, musicVolume: 0.4 }));
        const loaded = new SettingsManager().load();
        expect(loaded.musicTrack).toBe('Summer');
        expect(loaded.musicVolume).toBe(0.4);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).musicTrack).toBe('Summer');
    });

    it('keeps an owned track owned through a cloud copy that still names the old key', () => {
        const owns = (...themes) => ({ isUnlocked: (id) => themes.includes(id) });
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns('summer'))).toBe('Summer');
        expect(resolveOwnedMusicPreference(OLD_TRACK, owns())).toBe('EchoesOfTheSoul');
    });

    it('names the Odyssey orb and the Neon District poster after Summer', () => {
        const orb = LEVEL_CONFIGS.find((level) => level.theme?.primary === 'summer');
        expect(orb.name).toBe('Summer Glow');
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toMatch(/midsommar|midsummer/i);
        expect(TRANSIT_NAMES.summer).toBe('SUMMER');
        const poster = BILLBOARD_CELLS.find((cell) => cell.id === 'transit-summer');
        expect(tickerLine(poster)).toBe('SERENITY TRANSIT · NOW BOARDING: SUMMER');
    });
});
