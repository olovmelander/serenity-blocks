import { THEME_REGISTRY, resolveThemeId } from '../../themes/theme-registry.js';

/** Forest and its soundtrack are the starting collection, including offline fallback. */
export const DEFAULT_MUSIC_TRACK = 'EchoesOfTheSoul';

// These recordings already belong to a theme. Explicit titles preserve saved track keys,
// including the names which differ from their theme (Ocean, Geode and Parhelion).
const AUTHORED_SONGS = Object.freeze({
    forest: ['Echoes of the Soul', 'echoes-of-the-soul.mp3'],
    'himalayan-peak': ['Himalayan Peak', 'himalayan-peak.mp3'],
    'ice-temple': ['Ice Temple', 'ice-temple.mp3'],
    spring: ['Spring', 'spring.mp3'],
    wolfhour: ['Wolfhour', 'wolfhour.mp3'],
    ocean: ['Ocean Deep', 'ocean-deep.mp3'],
    aurora: ['Aurora', 'aurora.mp3'],
    galaxy: ['Galaxy', 'galaxy.mp3'],
    'aether-tides': ['Aether Tides', 'aether-tides.mp3'],
    sunbraid: ['Sunbraid', 'sunbraid.mp3'],
    rainbark: ['Rainbark', 'rainbark.mp3'],
    starlight: ['Starlight', 'starlight.mp3'],
    geode: ['Geode Crystalline', 'geode-crystalline.mp3'],
    bioluminescence: ['Bioluminescence', 'bioluminescence.mp3'],
    'shifting-sands': ['Shifting Sands', 'shifting-sands.mp3'],
    grainfields: ['Grainfields', 'grainfields.mp3'],
    waves: ['Waves', 'waves.mp3'],
    'fluid-dreams': ['Fluid Dreams', 'fluid-dreams.mp3'],
    'crystal-cave': ['Crystal Cave', 'crystal-cave.mp3'],
    'moonlit-greenhouse': ['Moonlit Greenhouse', 'moonlit-greenhouse.mp3'],
    murmuration: ['Murmuration', 'murmuration.mp3'],
    lunara: ['Lunara', 'lunara.mp3'],
    'black-hole': ['Black Hole', 'black-hole.mp3'],
    'cosmic-noir': ['Cosmic Noir', 'cosmic-noir.mp3'],
    'cinder-drift': ['Cinder Drift', 'cinder-drift.mp3'],
    'neon-dusk': ['Neon Dusk', 'neon-dusk.mp3'],
    'neon-district': ['Neon District', 'neon-district.mp3'],
    stillwater: ['Stillwater', 'stillwater.mp3'],
    'blood-moon': ['Blood Moon', 'blood-moon.mp3'],
    'stellar-drift': ['Stellar Drift', 'stellar-drift.mp3'],
    parhelion: ['Ethereal Echoes', 'ethereal-echoes.mp3'],
});

/** What a theme without a recording of its own plays. */
const PLACEHOLDER_SOURCE = 'blood-moon.mp3';

/** One stable selection key and one URL for each collectible theme. */
export const THEME_MUSIC_CATALOG = Object.freeze(THEME_REGISTRY.map((theme) => {
    const authored = AUTHORED_SONGS[theme.id];
    const name = authored?.[0] || theme.displayName;
    const file = authored?.[1] || PLACEHOLDER_SOURCE;
    return Object.freeze({
        themeId: theme.id,
        trackKey: theme.id === 'forest' ? DEFAULT_MUSIC_TRACK : name.replace(/\s+/g, ''),
        name,
        file,
        // A placeholder plays the one Blood Moon file under a URL of its own: the player tells
        // tracks apart by URL (SoundManager.resolveTrackKeyFromUrl), and the query is ignored by
        // file://, app.asar and static servers. Thirty-two byte-identical 8 MB copies of it
        // shipped before (2026-10-22). A theme's own recording goes in AUTHORED_SONGS.
        path: authored ? `./assets/music/${file}` : `./assets/music/${file}?song=${theme.id}`,
        placeholder: !authored,
        ...(!authored ? { placeholderSource: PLACEHOLDER_SOURCE } : {}),
        ...(theme.id === 'murmuration' ? {
            bpm: 96,
            phraseBeats: 16,
            energyCurve: Object.freeze([0.24, 0.58, 0.92]),
        } : {}),
    });
}));

const songsByTheme = new Map(THEME_MUSIC_CATALOG.map((song) => [song.themeId, song]));
const themesByTrack = new Map(THEME_MUSIC_CATALOG.map((song) => [song.trackKey, song.themeId]));

/**
 * Track keys a saved selection may still hold. A key comes from its song's title, so a
 * retitled song gets a new one: "Electric Dreams" became "Murmuration" with its theme
 * (2026-10-08), and "Cosmic Chimes" became "Rainbark" when Rainbark took its orb
 * (2026-10-11). A placeholder song is titled after its theme, so "Mountain" became
 * "High Coast" when High Coast took its orb (2026-10-13), "Singing Bowl" became
 * "Kaleidosonic" when Kaleidosonic took its orb (2026-10-13), and "Sky Children" became
 * "Rainbow Terraces" with its theme (2026-10-18). An authored recording retitled for the theme
 * that took its orb changes key too: "Misty Lake" became "Grainfields" and "Moonlit Forest"
 * became "Spring" (both 2026-10-18), "Rainy Window" became "Sunbraid" (2026-10-20), and
 * "Moonrise Summit" became "Sunfall" (2026-10-20).
 */
const RETIRED_TRACK_KEYS = new Map([
    ['ElectricDreams', 'Murmuration'],
    ['CosmicChimes', 'Rainbark'],
    ['Mountain', 'HighCoast'],
    ['SingingBowl', 'Kaleidosonic'],
    ['SkyChildren', 'RainbowTerraces'],
    ['MistyLake', 'Grainfields'],
    ['MoonlitForest', 'Spring'],
    ['RainyWindow', 'Sunbraid'],
    ['MoonriseSummit', 'Sunfall'],
]);

/**
 * Map a possibly-retired track key onto the key the catalog publishes today.
 * Unknown keys pass through unchanged so callers keep their own guards.
 * @param {string} trackKey
 * @returns {string}
 */
export function resolveMusicTrackKey(trackKey) {
    if (themesByTrack.has(trackKey)) return trackKey;
    return RETIRED_TRACK_KEYS.get(trackKey) ?? trackKey;
}

export function getThemeMusic(themeId) {
    return songsByTheme.get(resolveThemeId(themeId)) || null;
}

export function getThemeForMusic(trackKey) {
    return themesByTrack.get(resolveMusicTrackKey(trackKey)) || null;
}
