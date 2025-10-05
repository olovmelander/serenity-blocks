#!/usr/bin/env node

/**
 * Automatically generates songs.json from .mp3 files in the songs folder
 * Run this script whenever you add or remove songs: node generate-songs.js
 */

const fs = require('fs');
const path = require('path');

const SONGS_FOLDER = path.join(__dirname, 'songs');
const OUTPUT_FILE = path.join(SONGS_FOLDER, 'songs.json');

function generateSongsJson() {
    try {
        // Read all files in the songs directory
        const files = fs.readdirSync(SONGS_FOLDER);

        // Filter for .mp3 files and create song objects
        const songs = files
            .filter(file => file.toLowerCase().endsWith('.mp3'))
            .map(file => {
                // Extract display name by removing .mp3 extension
                const displayName = file.replace(/\.mp3$/i, '');

                return {
                    name: displayName,
                    file: file,
                    path: `songs/${file}`
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

        // Write to songs.json
        fs.writeFileSync(
            OUTPUT_FILE,
            JSON.stringify(songs, null, 2),
            'utf8'
        );

        console.log(`✅ Generated songs.json with ${songs.length} songs:`);
        songs.forEach(song => console.log(`   - ${song.name}`));

    } catch (error) {
        console.error('❌ Error generating songs.json:', error.message);
        process.exit(1);
    }
}

generateSongsJson();
