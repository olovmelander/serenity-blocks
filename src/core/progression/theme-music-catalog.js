import { THEME_REGISTRY, resolveThemeId } from '../../themes/theme-registry.js';

/** Forest and its soundtrack are the starting collection, including offline fallback. */
export const DEFAULT_MUSIC_TRACK = 'EchoesOfTheSoul';

// These recordings already belong to a theme. Explicit titles preserve saved track keys,
// including the names which differ from their theme (Ocean, Geode and Parhelion).
const AUTHORED_SONGS = Object.freeze({
    forest: ['Echoes of the Soul', 'echoes-of-the-soul.mp3'],
    'himalayan-peak': ['Himalayan Peak', 'himalayan-peak.mp3'],
    'ice-temple': ['Ice Temple', 'ice-temple.mp3'],
    'moonlit-forest': ['Moonlit Forest', 'moonlit-forest.mp3'],
    wolfhour: ['Wolfhour', 'wolfhour.mp3'],
    ocean: ['Ocean Deep', 'ocean-deep.mp3'],
    aurora: ['Aurora', 'aurora.mp3'],
    galaxy: ['Galaxy', 'galaxy.mp3'],
    'aether-tides': ['Aether Tides', 'aether-tides.mp3'],
    'rainy-window': ['Rainy Window', 'rainy-window.mp3'],
    'cosmic-chimes': ['Cosmic Chimes', 'cosmic-chimes.mp3'],
    starlight: ['Starlight', 'starlight.mp3'],
    geode: ['Geode Crystalline', 'geode-crystalline.mp3'],
    bioluminescence: ['Bioluminescence', 'bioluminescence.mp3'],
    'shifting-sands': ['Shifting Sands', 'shifting-sands.mp3'],
    'misty-lake': ['Misty Lake', 'misty-lake.mp3'],
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

/** One independent file and one stable selection key for each collectible theme. */
export const THEME_MUSIC_CATALOG = Object.freeze(THEME_REGISTRY.map((theme) => {
    const authored = AUTHORED_SONGS[theme.id];
    const name = authored?.[0] || theme.displayName;
    const file = authored?.[1] || `${theme.id}-placeholder-song.mp3`;
    return Object.freeze({
        themeId: theme.id,
        trackKey: theme.id === 'forest' ? DEFAULT_MUSIC_TRACK : name.replace(/\s+/g, ''),
        name,
        file,
        path: `./assets/music/${file}`,
        placeholder: !authored,
        ...(!authored ? { placeholderSource: 'blood-moon.mp3' } : {}),
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
 * (2026-10-08).
 */
const RETIRED_TRACK_KEYS = new Map([
    ['ElectricDreams', 'Murmuration'],
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
