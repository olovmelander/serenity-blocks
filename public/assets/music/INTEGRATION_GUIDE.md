# Dynamic Song Loading - Integration Guide

This guide shows you how to integrate automatic song detection into your game.

## 🎵 How It Works

1. **`generate-songs.js`** - Scans the `songs/` folder and creates `songs/songs.json`
2. **`songs/songs.json`** - Contains all available songs (automatically generated)
3. **Your game** - Loads `songs.json` and populates the music selector dynamically

## 📝 Step 1: Generate songs.json

Whenever you add or remove `.mp3` files from the `songs/` folder, run:

```bash
node generate-songs.js
```

This will update `songs/songs.json` with all available songs.

## 🔧 Step 2: Update Your Game Code

### Option A: Fetch the JSON at Runtime (Recommended)

Add this code near the beginning of your `script.js`, before the `SoundManager` class:

```javascript
// Global variable to store available songs
let availableSongs = [];

// Load songs from JSON file
async function loadSongs() {
    try {
        const response = await fetch('songs/songs.json');
        const songs = await response.json();
        availableSongs = songs;
        console.log(`Loaded ${songs.length} songs from songs.json`);
        return songs;
    } catch (error) {
        console.error('Failed to load songs.json:', error);
        // Fallback to default songs
        availableSongs = [
            { name: 'Echoes of the Soul', file: 'Echoes of the Soul.mp3', path: 'songs/Echoes of the Soul.mp3' }
        ];
        return availableSongs;
    }
}
```

### Update SoundManager Constructor

Replace the hardcoded `trackNames` array (around line 1329) with:

```javascript
this.trackNames = []; // Will be populated from songs.json
this.songsData = []; // Store full song data
```

Add an async initialization method to `SoundManager`:

```javascript
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
```

### Update startBackgroundMusic Method

Replace the hardcoded tracks object (around line 1392) with:

```javascript
startBackgroundMusic() {
    if (this.isMuted) return;
    this.stopBackgroundMusic();
    this.currentTrackId = Symbol();
    const trackId = this.currentTrackId;

    // Get the song path dynamically
    const songPath = this.getSongPath(this.musicTrack);
    this.playAudioFile(songPath);
}
```

### Initialize on Game Load

In your main initialization code (where you create `soundManager`), change it to:

```javascript
const soundManager = new SoundManager();

// Initialize tracks asynchronously
soundManager.initializeTracks().then(() => {
    // Continue with rest of initialization
    console.log('Sound manager ready with', soundManager.trackNames.length, 'tracks');
});
```

## 🎮 Usage

### Adding New Songs

1. Drop `.mp3` files into the `songs/` folder
2. Run: `node generate-songs.js`
3. Refresh your game - new songs appear automatically!

### Removing Songs

1. Delete `.mp3` files from the `songs/` folder
2. Run: `node generate-songs.js`
3. Refresh your game - songs are removed!

## 🔄 Optional: Auto-generate on Start

Add this to your `package.json` scripts to auto-generate before running:

```json
{
  "scripts": {
    "start": "node generate-songs.js && your-start-command",
    "songs": "node generate-songs.js"
  }
}
```

## 📁 File Structure

```
/workspaces/quadra/
├── songs/
│   ├── songs.json          (auto-generated)
│   ├── Aurora.mp3
│   ├── Ocean Deep.mp3
│   └── ... (all your .mp3 files)
├── generate-songs.js       (run this to update songs.json)
├── script.js              (your game code)
└── index.html
```

## 🐛 Troubleshooting

**Songs not loading?**
- Check browser console for errors
- Ensure `songs.json` exists: `ls songs/songs.json`
- Verify JSON format: `cat songs/songs.json`

**Songs not playing?**
- Check file paths in `songs.json` are correct
- Ensure `.mp3` files are in the `songs/` folder
- Check browser console for 404 errors

**Dropdown empty?**
- Run `node generate-songs.js` to regenerate
- Check that `songs/` folder has `.mp3` files
- Verify `initializeTracks()` is being called
