#!/usr/bin/env node

/**
 * Regenerates public/assets/music/songs.json from the .mp3 files in
 * public/assets/music/ (the manifest src/audio/music-loader.js fetches at
 * './assets/music/songs.json'). Run whenever tracks are added or removed:
 *
 *   node generate-songs.js
 *
 * Entries for tracks already present in songs.json are PRESERVED in full, so
 * hand-curated titles (e.g. "Echoes of the Soul", not "Echoes Of The Soul")
 * and hand-added metadata (e.g. Electric Dreams' bpm/phraseBeats/energyCurve)
 * survive regeneration; new files get a title-cased name from the filename.
 * Output is sorted alphabetically by display name.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MUSIC_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'public', 'assets', 'music');
const OUTPUT_FILE = join(MUSIC_FOLDER, 'songs.json');

function titleCaseFromFilename(file) {
    return file
        .replace(/\.mp3$/i, '')
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function loadExistingEntries() {
    if (!existsSync(OUTPUT_FILE)) return new Map();
    try {
        const existing = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
        return new Map(
            (Array.isArray(existing) ? existing : [])
                .filter((song) => song?.file)
                .map((song) => [song.file, song]),
        );
    } catch (error) {
        // Abort rather than regenerate: silently rebuilding would discard the
        // curated names/metadata this script promises to preserve. Fix or
        // delete the malformed songs.json first.
        console.error(`❌ Existing songs.json is unreadable (${error.message}) — aborting to protect curated entries.`);
        process.exit(1);
    }
}

function generateSongsJson() {
    try {
        const existingEntries = loadExistingEntries();
        const songs = readdirSync(MUSIC_FOLDER)
            .filter((file) => file.toLowerCase().endsWith('.mp3'))
            .map((file) => ({
                name: titleCaseFromFilename(file),
                // Keep every field of an existing entry (curated name, bpm,
                // phraseBeats, energyCurve, …) — only file/path are enforced.
                ...(existingEntries.get(file) || {}),
                file,
                // Relative './assets/music/…' path — resolves under both the Vite
                // dev server and the packaged Electron file:// origin (see
                // src/audio/music-loader.js).
                path: `./assets/music/${file}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'en'));

        writeFileSync(OUTPUT_FILE, `${JSON.stringify(songs, null, 2)}\n`, 'utf8');

        console.log(`✅ Generated songs.json with ${songs.length} songs:`);
        songs.forEach((song) => console.log(`   - ${song.name}`));
    } catch (error) {
        console.error('❌ Error generating songs.json:', error.message);
        process.exit(1);
    }
}

generateSongsJson();
