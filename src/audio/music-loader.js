/**
 * @fileoverview Music Loading and Management for Serenity Blocks
 * Handles loading music tracks from songs.json and managing track metadata
 */

import {
    THEME_MUSIC_CATALOG, getThemeMusic, getThemeForMusic,
} from '../core/progression/theme-music-catalog.js';

/**
 * Global storage for available songs
 * @type {Array<Object>}
 */
let availableSongs = [];
let pendingSongsLoad = null;
const catalogByFile = new Map(THEME_MUSIC_CATALOG.map((song) => [song.file, song]));

function validateManifestSong(song) {
    if (!song || typeof song !== 'object' || Array.isArray(song)) return null;
    const canonical = catalogByFile.get(song.file);
    if (!canonical || song.name !== canonical.name || song.path !== canonical.path
        || (song.trackKey !== undefined && song.trackKey !== canonical.trackKey)
        || (song.themeId !== undefined && song.themeId !== canonical.themeId)) return null;
    return { ...song, ...canonical };
}

/**
 * Loads songs from the songs.json file
 * @returns {Promise<Array<Object>>} Array of song objects
 */
export function loadSongs() {
    if (pendingSongsLoad) return pendingSongsLoad;

    const pending = loadSongsManifest().finally(() => {
        if (pendingSongsLoad === pending) pendingSongsLoad = null;
    });
    pendingSongsLoad = pending;
    return pending;
}

async function loadSongsManifest() {
    try {
        // Relative path (matches Vite `base: './'`) so the manifest resolves under BOTH
        // http:// dev AND the packaged Electron file:// origin. A leading-slash '/assets/…'
        // resolves to the filesystem root under file://, so the fetch fails in the installed
        // app and the catch below falls back to a 1-song list — the "only one track ships" bug.
        const response = await fetch('./assets/music/songs.json');
        if (!response.ok) throw new Error(`songs.json HTTP ${response.status}`);
        const songsManifest = await response.json();
        if (!Array.isArray(songsManifest)) throw new Error('songs.json must contain a song list');
        const songs = [...new Map(songsManifest.map(validateManifestSong).filter(Boolean)
            .map((song) => [song.trackKey, song])).values()];
        if (!songs.length) throw new Error('songs.json contains no valid theme soundtracks');
        const starter = getThemeMusic('forest');
        if (!songs.some((song) => song.trackKey === starter.trackKey)) songs.unshift({ ...starter });
        availableSongs = songs;
        console.log(`✅ Loaded ${songs.length} songs from songs.json`);
        return songs;
    } catch (error) {
        console.error('❌ Failed to load songs.json:', error);
        // Fallback to default songs
        availableSongs = [{ ...getThemeMusic('forest') }];
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
    return THEME_MUSIC_CATALOG.find((song) => song.name === name)?.trackKey
        || name.replace(/\s+/g, '');
}

/**
 * Gets the path for a song by its track name
 * @param {string} trackName - Track name/key
 * @param {Array<Object>} songsData - Array of song objects
 * @returns {string} Path to the song file
 */
export function getSongPath(trackName, songsData) {
    const song = songsData.find((s) => (s.trackKey || nameToKey(s.name)) === trackName);
    return song ? song.path : getThemeMusic('forest').path;
}

/**
 * Finds a song that matches a theme name
 * @param {string} themeName - Theme name (e.g., 'moonlit-forest')
 * @param {Array<Object>} songsData - Array of song objects
 * @returns {string|null} Track key or null if no match
 */
export function getSongForTheme(themeName, songsData) {
    const song = getThemeMusic(themeName);
    if (!song) return null;
    return songsData.some((entry) => (entry.trackKey || nameToKey(entry.name)) === song.trackKey)
        ? song.trackKey : null;
}

/**
 * Finds a theme that matches a song
 * @param {string} trackName - Track name/key
 * @param {Array<string>} themes - Array of theme names
 * @returns {string|null} Theme name or null if no match
 */
export function getThemeForSong(trackName, themes) {
    const themeId = getThemeForMusic(trackName);
    return themeId && themes.includes(themeId) ? themeId : null;
}
