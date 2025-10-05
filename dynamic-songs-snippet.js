// ====================================================================
// DYNAMIC SONG LOADING - Copy this code into your script.js
// ====================================================================

// ADD THIS NEAR THE TOP OF YOUR SCRIPT.JS (before SoundManager class)
// --------------------------------------------------------------------

// Global variable to store available songs
let availableSongs = [];

// Load songs from JSON file
async function loadSongs() {
    try {
        const response = await fetch('songs/songs.json');
        const songs = await response.json();
        availableSongs = songs;
        console.log(`✅ Loaded ${songs.length} songs from songs.json`);
        return songs;
    } catch (error) {
        console.error('❌ Failed to load songs.json:', error);
        // Fallback to default songs
        availableSongs = [
            { name: 'Echoes of the Soul', file: 'Echoes of the Soul.mp3', path: 'songs/Echoes of the Soul.mp3' }
        ];
        return availableSongs;
    }
}


// ADD THESE METHODS TO YOUR SOUNDMANAGER CLASS
// --------------------------------------------------------------------

// In constructor (replace the hardcoded trackNames):
/*
    this.trackNames = []; // Will be populated from songs.json
    this.songsData = []; // Store full song data
*/

// Add these new methods to SoundManager class:
/*
    async initializeTracks() {
        const songs = await loadSongs();
        this.songsData = songs;
        // Convert song names to camelCase for compatibility
        this.trackNames = songs.map(song => this.nameToKey(song.name));

        // Set default track if current track doesn't exist
        if (!this.trackNames.includes(this.musicTrack) && this.trackNames.length > 0) {
            this.musicTrack = this.trackNames[0];
        }

        // Populate the dropdown
        this.populateMusicDropdown();

        return this;
    }

    // Convert display name to internal key (e.g., "Ocean Deep" -> "OceanDeep")
    nameToKey(name) {
        return name.replace(/\s+/g, '');
    }

    // Get song path from track name
    getSongPath(trackName) {
        const song = this.songsData.find(s => this.nameToKey(s.name) === trackName);
        return song ? song.path : this.songsData[0]?.path || 'songs/Echoes of the Soul.mp3';
    }

    // Populate the music track dropdown
    populateMusicDropdown() {
        const dropdown = document.getElementById('music-track');
        if (!dropdown) return;

        dropdown.innerHTML = ''; // Clear existing options

        this.songsData.forEach(song => {
            const option = document.createElement('option');
            option.value = this.nameToKey(song.name);
            option.textContent = song.name;
            dropdown.appendChild(option);
        });

        dropdown.value = this.musicTrack;
    }
*/

// REPLACE YOUR startBackgroundMusic METHOD WITH:
// --------------------------------------------------------------------
/*
    startBackgroundMusic() {
        if (this.isMuted) return;
        this.stopBackgroundMusic();
        this.currentTrackId = Symbol();
        const trackId = this.currentTrackId;

        // Get the song path dynamically from songs.json
        const songPath = this.getSongPath(this.musicTrack);
        this.playAudioFile(songPath);
    }
*/


// UPDATE YOUR SOUNDMANAGER INITIALIZATION TO:
// --------------------------------------------------------------------
/*
    const soundManager = new SoundManager();

    // Initialize tracks asynchronously before starting game
    soundManager.initializeTracks().then(() => {
        console.log('🎵 Sound manager ready with', soundManager.trackNames.length, 'tracks');
        // Continue with rest of your initialization here...
    });
*/


// ====================================================================
// USAGE INSTRUCTIONS
// ====================================================================
/*

1. Copy the code sections above into your script.js at the appropriate locations

2. When you add/remove songs:
   - Drop .mp3 files into the songs/ folder
   - Run: node generate-songs.js
   - Refresh your game

3. That's it! The game will automatically detect all songs.

*/
