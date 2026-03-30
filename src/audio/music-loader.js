/**
 * @fileoverview Music Loading and Management for Serenity Blocks
 * Handles loading music tracks from songs.json and managing track metadata
 */

import songsManifest from '../../public/assets/music/songs.json';

/**
 * Global storage for available songs
 * @type {Array<Object>}
 */
let availableSongs = [];

/**
 * Loads songs from the songs.json file
 * @returns {Promise<Array<Object>>} Array of song objects
 */
export async function loadSongs() {
    try {
        const songs = Array.isArray(songsManifest)
            ? songsManifest.map((song) => ({ ...song }))
            : [];
        availableSongs = songs;
        console.log(`✅ Loaded ${songs.length} songs from songs.json`);
        return songs;
    } catch (error) {
        console.error('❌ Failed to load songs.json:', error);
        // Fallback to default songs
        availableSongs = [
            {
                name: 'Echoes of the Soul',
                file: 'echoes-of-the-soul.mp3',
                path: './assets/music/echoes-of-the-soul.mp3',
            },
        ];
        return availableSongs;
    }
}

/**
 * Gets the currently available songs
 * @returns {Array<Object>} Array of song objects
 */
export function getAvailableSongs() {
    return availableSongs;
}

/**
 * Converts a display name to an internal key
 * @param {string} name - Display name (e.g., "Ocean Deep")
 * @returns {string} Internal key (e.g., "OceanDeep")
 */
export function nameToKey(name) {
    return name.replace(/\s+/g, '');
}

/**
 * Gets the path for a song by its track name
 * @param {string} trackName - Track name/key
 * @param {Array<Object>} songsData - Array of song objects
 * @returns {string} Path to the song file
 */
export function getSongPath(trackName, songsData) {
    const song = songsData.find((s) => nameToKey(s.name) === trackName);
    return song ? song.path : songsData[0]?.path || '/assets/music/echoes-of-the-soul.mp3';
}

/**
 * Finds a song that matches a theme name
 * @param {string} themeName - Theme name (e.g., 'moonlit-forest')
 * @param {Array<Object>} songsData - Array of song objects
 * @returns {string|null} Track key or null if no match
 */
export function getSongForTheme(themeName, songsData) {
    const explicitThemeSongMap = {
        'electric-dreams': 'ElectricDreams',
        'chromadelic-highway': 'ElectricDreams',
        'black-hole': 'BlackHole',
    };
    const explicitTrack = explicitThemeSongMap[themeName];
    if (explicitTrack && songsData.some((s) => nameToKey(s.name) === explicitTrack)) {
        return explicitTrack;
    }

    // Normalize theme name: remove hyphens and convert to camelCase for matching
    const normalizedTheme = themeName
        .split('-')
        .map((word, index) => (index === 0
            ? word.charAt(0).toUpperCase() + word.slice(1)
            : word.charAt(0).toUpperCase() + word.slice(1)))
        .join('');

    // Try exact match first
    let song = songsData.find(
        (s) => nameToKey(s.name).toLowerCase() === normalizedTheme.toLowerCase(),
    );

    // If no exact match, try partial match BUT exclude shorter substrings
    // This prevents "forest" from matching "moonlit-forest"
    if (!song) {
        const themeKey = themeName.replace(/-/g, '').toLowerCase();
        song = songsData.find((s) => {
            const songKey = nameToKey(s.name).toLowerCase();
            // Only match if the song name contains the theme OR if the theme contains the song name
            // AND they're close in length (increased tolerance to 5 to support "Ocean" -> "Ocean Deep")
            const songContainsTheme = songKey.includes(themeKey);
            const themeContainsSong = themeKey.includes(songKey);
            const lengthSimilar = Math.abs(songKey.length - themeKey.length) <= 5;

            return (songContainsTheme || themeContainsSong) && lengthSimilar;
        });
    }

    return song ? nameToKey(song.name) : null;
}

/**
 * Finds a theme that matches a song
 * @param {string} trackName - Track name/key
 * @param {Array<string>} themes - Array of theme names
 * @returns {string|null} Theme name or null if no match
 */
export function getThemeForSong(trackName, themes) {
    // Explicit reverse map: when a song is shared by multiple themes,
    // do NOT auto-switch (return null) to avoid overriding user's choice
    const sharedSongs = ['ElectricDreams'];
    if (sharedSongs.includes(trackName)) {
        return null;
    }

    // Try exact match first
    let theme = themes.find((t) => {
        const normalizedTheme = t
            .split('-')
            .map((word, index) => (index === 0
                ? word.charAt(0).toUpperCase() + word.slice(1)
                : word.charAt(0).toUpperCase() + word.slice(1)))
            .join('');
        return normalizedTheme.toLowerCase() === trackName.toLowerCase();
    });

    // If no exact match, try partial match BUT exclude shorter substrings
    // This prevents "Forest" song from matching "moonlit-forest" theme
    if (!theme) {
        const trackKey = trackName.toLowerCase();
        theme = themes.find((t) => {
            const themeKey = t.replace(/-/g, '').toLowerCase();
            // Only match if similar length AND one fully contains the other
            // Increased tolerance to 5 to support "Ocean Deep" -> "Ocean"
            const themeContainsTrack = themeKey.includes(trackKey);
            const trackContainsTheme = trackKey.includes(themeKey);
            const lengthSimilar = Math.abs(themeKey.length - trackKey.length) <= 5;

            return (themeContainsTrack || trackContainsTheme) && lengthSimilar;
        });
    }

    return theme || null;
}
