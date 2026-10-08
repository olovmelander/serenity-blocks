/**
 * @fileoverview Test-facing music contract — NOT loaded at runtime.
 *
 * The running game fetches './assets/music/songs.json' (see
 * src/audio/music-loader.js; regenerate with `node generate-songs.js`), and
 * Odyssey chapter/stinger track keys are literals in
 * src/core/odyssey/data/chapters.js. The runtime and this test-facing adapter
 * share core/progression/theme-music-catalog.js so those track keys correspond to shipped songs:
 * src/rendering/odyssey/composition/OdysseyDirector.test.js imports it to
 * cross-validate the chapter/threshold audio wiring. Keep it in sync with
 * songs.json when tracks change; delete it only together with a rework of
 * that test. (Dead-code audit 2026-07-16: production-unreachable by design.)
 */
import { THEME_MUSIC_CATALOG } from '../core/progression/theme-music-catalog.js';

export const ODYSSEY_CHAPTER_TRACKS = Object.freeze({
    1: 'CinderDrift',
    2: 'OceanDeep',
    3: 'MoonlitForest',
    4: 'HimalayanPeak',
    5: 'Starlight',
    6: 'Galaxy',
    7: 'BlackHole',
    8: 'NeonDistrict',
});

export const ODYSSEY_THRESHOLD_STINGERS = Object.freeze({
    '1-2': 'steam-quench',
    '2-3': 'surface-breach',
    '3-4': 'ridgeline-rise',
    '4-5': 'summit-liftoff',
    '5-6': 'atmosphere-edge',
    '6-7': 'lensing-engage',
    '7-8': 'neon-snap',
});

export const FULL_SONGS_MANIFEST = THEME_MUSIC_CATALOG;
export const DEMO_SONGS_MANIFEST = FULL_SONGS_MANIFEST;
export const ACTIVE_SONGS_MANIFEST = FULL_SONGS_MANIFEST;

export function getMusicManifest() {
    return ACTIVE_SONGS_MANIFEST.map((song) => ({ ...song }));
}

export function getAllowedTrackKeys() {
    return FULL_SONGS_MANIFEST.map((song) => song.trackKey);
}
