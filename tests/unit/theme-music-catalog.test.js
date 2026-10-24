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

afterEach(() => vi.unstubAllGlobals());

describe('one soundtrack per collectible theme', () => {
    it('covers every current theme exactly once with distinct keys and URLs', () => {
        expect(THEME_MUSIC_CATALOG).toHaveLength(63);
        expect(THEME_MUSIC_CATALOG.map((song) => song.themeId)).toEqual(THEME_REGISTRY.map((theme) => theme.id));
        for (const field of ['themeId', 'trackKey', 'path']) {
            expect(new Set(THEME_MUSIC_CATALOG.map((song) => song[field])).size).toBe(63);
        }
        // Placeholders share Blood Moon's file; every recording is its own.
        expect(new Set(THEME_MUSIC_CATALOG.map((song) => song.file)).size).toBe(56);
        expect(THEME_MUSIC_CATALOG.filter((song) => !song.placeholder)).toHaveLength(56);
        expect(THEME_MUSIC_CATALOG.filter((song) => song.placeholder).map((song) => song.themeId)).toEqual([
            'winter', 'tornado', 'verdant-hills', 'chromatic-impasto', 'voltage-storm', 'void-ember',
            'vesper-chrysalis',
        ]);
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
        ['murmuration', 'Murmuration'], ['parhelion', 'EtherealEchoes'],
        ['rainbark', 'Rainbark'], ['grainfields', 'Grainfields'], ['spring', 'Spring'],
        ['sunbraid', 'Sunbraid'],
    ])('preserves the authored %s recording as %s', (themeId, trackKey) => {
        expect(getThemeMusic(themeId)).toMatchObject({ trackKey, placeholder: false });
    });

    it('replaces the former sharing of the Murmuration recording with a Chromadelic song of its own', () => {
        expect(getThemeMusic('chromadelic-highway')).toMatchObject({
            trackKey: 'ChromadelicHighway', path: './assets/music/chromadelic-highway.mp3', placeholder: false,
        });
        expect(getThemeForMusic('Murmuration')).toBe('murmuration');
    });

    it('keeps the key and the theme id the Murmuration recording had before it was retitled', () => {
        expect(getThemeForMusic('ElectricDreams')).toBe('murmuration');
        expect(getThemeMusic('electric-dreams-v3')).toBe(getThemeMusic('murmuration'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('ElectricDreams');
    });

    it('keeps the key and the theme id the Rainbark recording had before it was retitled', () => {
        expect(getThemeForMusic('CosmicChimes')).toBe('rainbark');
        expect(getThemeMusic('cosmic-chimes')).toBe(getThemeMusic('rainbark'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('CosmicChimes');
    });

    it('keeps the key and the theme id the High Coast placeholder had while it was titled Mountain', () => {
        expect(getThemeMusic('high-coast')).toMatchObject({
            name: 'High Coast',
            trackKey: 'HighCoast',
            path: './assets/music/high-coast.mp3',
            placeholder: false,
        });
        expect(getThemeForMusic('Mountain')).toBe('high-coast');
        expect(getThemeMusic('mountain')).toBe(getThemeMusic('high-coast'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('Mountain');
        expect(files).not.toContain('mountain-placeholder-song.mp3');
    });

    it('keeps the key and the theme id the Kaleidosonic placeholder had while it was titled Singing Bowl', () => {
        expect(getThemeMusic('kaleidosonic')).toMatchObject({
            name: 'Kaleidosonic',
            trackKey: 'Kaleidosonic',
            path: './assets/music/kaleidosonic.mp3',
            placeholder: false,
        });
        expect(getThemeForMusic('SingingBowl')).toBe('kaleidosonic');
        expect(getThemeMusic('singing-bowl')).toBe(getThemeMusic('kaleidosonic'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('SingingBowl');
        expect(files).not.toContain('singing-bowl-placeholder-song.mp3');
    });

    it('keeps the key and the theme id the Grainfields recording had while it was titled Misty Lake', () => {
        expect(getThemeMusic('grainfields')).toMatchObject({
            name: 'Grainfields',
            trackKey: 'Grainfields',
            file: 'grainfields.mp3',
            placeholder: false,
        });
        expect(getThemeForMusic('MistyLake')).toBe('grainfields');
        expect(getThemeMusic('misty-lake')).toBe(getThemeMusic('grainfields'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('MistyLake');
        expect(files).not.toContain('misty-lake.mp3');
        // The recording's own title tag was retitled with it: ID3v2.3, TIT2 in UTF-16 with a BOM.
        const head = readFileSync(`${musicFolder}/grainfields.mp3`).subarray(0, 4096);
        expect(head.subarray(0, 4).toString('latin1')).toBe('ID3\u0003');
        const at = head.indexOf('TIT2', 10, 'latin1');
        expect(at).toBeGreaterThan(9);
        const body = head.subarray(at + 10, at + 10 + head.readUInt32BE(at + 4));
        expect([...body.subarray(0, 3)]).toEqual([1, 0xff, 0xfe]);
        expect(body.subarray(3).toString('utf16le')).toBe('Grainfields');
    });

    it('keeps the key and the theme id the Spring recording had before it was retitled', () => {
        expect(getThemeMusic('spring')).toMatchObject({
            name: 'Spring',
            trackKey: 'Spring',
            file: 'spring.mp3',
            placeholder: false,
        });
        expect(getThemeForMusic('MoonlitForest')).toBe('spring');
        expect(getThemeMusic('moonlit-forest')).toBe(getThemeMusic('spring'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('MoonlitForest');
        expect(files).not.toContain('moonlit-forest.mp3');
    });

    it('keeps the key and the theme id the Sunbraid recording had while it was titled Rainy Window', () => {
        expect(getThemeMusic('sunbraid')).toMatchObject({
            name: 'Sunbraid',
            trackKey: 'Sunbraid',
            file: 'sunbraid.mp3',
            placeholder: false,
        });
        expect(getThemeForMusic('RainyWindow')).toBe('sunbraid');
        expect(getThemeMusic('rainy-window')).toBe(getThemeMusic('sunbraid'));
        expect(THEME_MUSIC_CATALOG.map((song) => song.trackKey)).not.toContain('RainyWindow');
        expect(files).not.toContain('rainy-window.mp3');
        // The recording's own title tag was retitled with it: ID3v2.3, TIT2 in UTF-16 with a BOM.
        const head = readFileSync(`${musicFolder}/sunbraid.mp3`).subarray(0, 4096);
        expect(head.subarray(0, 4).toString('latin1')).toBe('ID3\u0003');
        const at = head.indexOf('TIT2', 10, 'latin1');
        expect(at).toBeGreaterThan(9);
        const body = head.subarray(at + 10, at + 10 + head.readUInt32BE(at + 4));
        expect([...body.subarray(0, 3)]).toEqual([1, 0xff, 0xfe]);
        expect(body.subarray(3).toString('utf16le')).toBe('Sunbraid');
    });

    it('resolves known retired aliases, but never revives Bioluminescence II', () => {
        expect(getThemeMusic('sky-children-v2')).toBe(getThemeMusic('rainbow-terraces'));
        expect(getThemeMusic('sky-children')).toBe(getThemeMusic('rainbow-terraces'));
        expect(getThemeMusic('pyrestorm-v2')).toBe(getThemeMusic('pyrestorm'));
        expect(getThemeMusic('bioluminescence-2')).toBeNull();
        expect(getThemeForMusic('Bioluminescence2')).toBeNull();
        expect(getThemeMusic('unknown')).toBeNull();
    });

    // Thirty-two byte-identical 8 MB copies of it shipped before (2026-10-22).
    it('plays the one Blood Moon file for every placeholder, each under a URL of its own', () => {
        for (const song of THEME_MUSIC_CATALOG) {
            expect(statSync(`${musicFolder}/${song.file}`).size, song.file).toBeGreaterThan(0);
            if (song.placeholder) {
                expect(song.file).toBe('blood-moon.mp3');
                expect(song.placeholderSource).toBe('blood-moon.mp3');
                expect(song.path).toBe(`./assets/music/blood-moon.mp3?song=${song.themeId}`);
            }
        }
        expect(files.filter((file) => file.endsWith('-placeholder-song.mp3'))).toEqual([]);
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
        expect(() => buildSongsManifest(files.filter((file) => file !== 'wolfhour.mp3')))
            .toThrow('Missing theme recordings: wolfhour.mp3');
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
