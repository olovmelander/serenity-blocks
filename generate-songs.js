#!/usr/bin/env node

/**
 * Regenerate the collectible soundtrack from the canonical theme catalog:
 *
 *   node generate-songs.js
 *
 * Each theme has one independent recording. Unassigned legacy MP3s remain on disk
 * for compatibility, but do not become free music or extra collectible tracks.
 * Canonical identity is enforced; other curated metadata survives regeneration.
 */

import {
    readdirSync, readFileSync, writeFileSync, existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_MUSIC_CATALOG } from './src/core/progression/theme-music-catalog.js';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const MUSIC_FOLDER = join(dirname(SCRIPT_FILE), 'public', 'assets', 'music');
const OUTPUT_FILE = join(MUSIC_FOLDER, 'songs.json');

export function buildSongsManifest(files, existing = []) {
    const shippedFiles = new Set(files);
    const missing = THEME_MUSIC_CATALOG.filter((song) => !shippedFiles.has(song.file));
    if (missing.length) {
        throw new Error(`Missing theme recordings: ${missing.map((song) => song.file).join(', ')}`);
    }
    const existingByFile = new Map(
        (Array.isArray(existing) ? existing : []).filter((song) => song?.file).map((song) => [song.file, song]),
    );
    return THEME_MUSIC_CATALOG.map((song) => ({
        ...(existingByFile.get(song.file) || {}),
        ...song,
    })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function generateSongsJson() {
    try {
        // Invalid existing JSON must abort: rebuilding silently loses curated metadata.
        const existing = existsSync(OUTPUT_FILE) ? JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) : [];
        const songs = buildSongsManifest(readdirSync(MUSIC_FOLDER), existing);
        writeFileSync(OUTPUT_FILE, `${JSON.stringify(songs, null, 2)}\n`, 'utf8');
        console.log(`✅ Generated songs.json with ${songs.length} theme soundtracks.`);
    } catch (error) {
        console.error('❌ Error generating songs.json:', error.message);
        process.exitCode = 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_FILE) generateSongsJson();
