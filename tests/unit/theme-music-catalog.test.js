import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { buildSongsManifest } from '../../generate-songs.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import {
    DEFAULT_MUSIC_TRACK, THEME_MUSIC_CATALOG, getThemeMusic, getThemeForMusic,
} from '../../src/core/progression/theme-music-catalog.js';
import {
    getSongForTheme, getThemeForSong, getSongPath, nameToKey, loadSongs,
} from '../../src/audio/music-loader.js';
import { getMusicManifest, getAllowedTrackKeys } from '../../src/audio/music-manifest.js';

const musicFolder = fileURLToPath(new URL('../../public/assets/music/', import.meta.url));
const files = readdirSync(musicFolder);
const shippedManifest = JSON.parse(readFileSync(`${musicFolder}/songs.json`, 'utf8'));
const hashFile = (file) => createHash('sha256').update(readFileSync(`${musicFolder}/${file}`)).digest('hex');

afterEach(() => vi.unstubAllGlobals());

describe('one soundtrack per collectible theme', () => {
    it('covers every current theme exactly once with distinct keys and file paths', () => {
        expect(THEME_MUSIC_CATALOG).toHaveLength(61);
        expect(THEME_MUSIC_CATALOG.map((song) => song.themeId)).toEqual(THEME_REGISTRY.map((theme) => theme.id));
        for (const field of ['themeId', 'trackKey', 'file', 'path']) {
            expect(new Set(THEME_MUSIC_CATALOG.map((song) => song[field])).size).toBe(61);
        }
        expect(THEME_MUSIC_CATALOG.filter((song) => !song.placeholder)).toHaveLength(31);
        expect(THEME_MUSIC_CATALOG.filter((song) => song.placeholder)).toHaveLength(30);
    });

    it('keeps Forest’s existing default recording and stable default key', () => {
        const forest = getThemeMusic('forest');
        expect(forest).toMatchObject({
            name: 'Echoes of the Soul',
            file: 'echoes-of-the-soul.mp3',
            trackKey: DEFAULT_MUSIC_TRACK,
            placeholder: false,
        });
        expect(DEFAULT_MUSIC_TRACK).toBe('EchoesOfTheSoul');
        expect(nameToKey(forest.name)).toBe(DEFAULT_MUSIC_TRACK);
    });

    it.each([
        ['ocean', 'OceanDeep'], ['geode', 'GeodeCrystalline'],
        ['electric-dreams-v3', 'ElectricDreams'], ['parhelion', 'EtherealEchoes'],
    ])('preserves the authored %s recording as %s', (themeId, trackKey) => {
        expect(getThemeMusic(themeId)).toMatchObject({ trackKey, placeholder: false });
    });

    it('replaces the former Electric Dreams sharing with an independent Chromadelic file', () => {
        expect(getThemeMusic('chromadelic-highway')).toMatchObject({
            trackKey: 'ChromadelicHighway', file: 'chromadelic-highway-placeholder-song.mp3', placeholder: true,
        });
        expect(getThemeForMusic('ElectricDreams')).toBe('electric-dreams-v3');
    });

    it('resolves known retired aliases, but never revives Bioluminescence II', () => {
        expect(getThemeMusic('sky-children-v2')).toBe(getThemeMusic('sky-children'));
        expect(getThemeMusic('pyrestorm-v2')).toBe(getThemeMusic('pyrestorm'));
        expect(getThemeMusic('bioluminescence-2')).toBeNull();
        expect(getThemeForMusic('Bioluminescence2')).toBeNull();
        expect(getThemeMusic('unknown')).toBeNull();
    });

    it('ships each independent placeholder as an exact copy of the Blood Moon source', () => {
        const sourceHash = hashFile('blood-moon.mp3');
        for (const song of THEME_MUSIC_CATALOG) {
            expect(statSync(`${musicFolder}/${song.file}`).size).toBeGreaterThan(0);
            if (song.placeholder) {
                expect(song.file).toBe(`${song.themeId}-placeholder-song.mp3`);
                expect(song.placeholderSource).toBe('blood-moon.mp3');
                expect(hashFile(song.file)).toBe(sourceHash);
            }
        }
    });

    it('provides an unambiguous forward/reverse runtime lookup for every song', () => {
        const themes = THEME_REGISTRY.map((theme) => theme.id);
        for (const song of THEME_MUSIC_CATALOG) {
            expect(getSongForTheme(song.themeId, shippedManifest)).toBe(song.trackKey);
            expect(getThemeForSong(song.trackKey, themes)).toBe(song.themeId);
            expect(nameToKey(song.name)).toBe(song.trackKey);
            expect(getSongPath(song.trackKey, shippedManifest)).toBe(song.path);
        }
        expect(getSongForTheme('forest', [])).toBeNull();
        expect(getSongForTheme('moonlit', shippedManifest)).toBeNull();
        expect(getThemeForSong('Ocean', themes)).toBeNull();
        expect(getThemeForSong('OceanDeep', ['forest'])).toBeNull();
        expect(getSongPath('removed-track', shippedManifest)).toBe(getThemeMusic('forest').path);
    });

    it('keeps runtime and Odyssey test manifests on the same canonical contract', () => {
        expect(shippedManifest).toEqual(buildSongsManifest(files, []));
        expect(getMusicManifest()).toEqual(THEME_MUSIC_CATALOG);
        expect(getAllowedTrackKeys()).toEqual(THEME_MUSIC_CATALOG.map((song) => song.trackKey));
    });

    it('generates deterministically without adding unassigned legacy recordings to the collection', () => {
        expect(buildSongsManifest([...files].reverse(), shippedManifest)).toEqual(shippedManifest);
        const legacy = [
            'candlelit-monastery.mp3', 'cherry-blossom-garden.mp3', 'falling-pieces.mp3',
            'floating-islands.mp3', 'meditation-temple.mp3',
        ];
        for (const file of legacy) {
            expect(files).toContain(file);
            expect(shippedManifest.some((song) => song.file === file)).toBe(false);
        }
    });

    it('preserves other curated metadata while enforcing canonical ownership and paths', () => {
        const songs = buildSongsManifest(files, [{
            file: 'echoes-of-the-soul.mp3',
            name: 'Wrong title',
            path: '/wrong.mp3',
            themeId: 'blood-moon',
            trackKey: 'WrongKey',
            artist: 'Curated artist',
        }]);
        expect(songs.find((song) => song.themeId === 'forest')).toEqual({
            artist: 'Curated artist', ...getThemeMusic('forest'),
        });
    });

    it('refuses to emit a manifest if a collectible recording is missing', () => {
        expect(() => buildSongsManifest(files.filter((file) => file !== 'vesper-chrysalis-placeholder-song.mp3')))
            .toThrow('Missing theme recordings: vesper-chrysalis-placeholder-song.mp3');
    });

    it('falls back to Forest’s owned song with complete identity metadata when loading fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        const songs = await loadSongs();
        expect(songs).toEqual([{ ...getThemeMusic('forest') }]);
    });

    it.each([[], {}, null, [null], [{ name: 'Forest' }]])(
        'falls back to Forest when a successful response has no usable song entries: %j',
        async (manifest) => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => manifest }));
            expect(await loadSongs()).toEqual([{ ...getThemeMusic('forest') }]);
        },
    );

    it.each([
        { path: './assets/music/blood-moon.mp3' },
        { file: 'blood-moon.mp3' },
        { name: 'Blood Moon' },
        { trackKey: 'BloodMoon' },
        { themeId: 'blood-moon' },
    ])('rejects mismatched manifest identity %j without redirecting an owned song', async (changes) => {
        const forged = { ...getThemeMusic('forest'), ...changes };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [forged] }));
        expect(await loadSongs()).toEqual([{ ...getThemeMusic('forest') }]);
    });

    it('retains Forest in a partial manifest, canonicalizes legacy metadata and deduplicates entries', async () => {
        const ocean = getThemeMusic('ocean');
        const legacy = {
            name: ocean.name, file: ocean.file, path: ocean.path, artist: 'Curated artist',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, json: async () => [legacy, legacy, { name: 'Unknown', path: '/wrong.mp3' }],
        }));
        expect(await loadSongs()).toEqual([
            { ...getThemeMusic('forest') }, { artist: 'Curated artist', ...ocean },
        ]);
    });
});
