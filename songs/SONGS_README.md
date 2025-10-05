# Dynamic Song Loading

The game now automatically detects all MP3 files in the `songs/` folder and makes them available for playback.

## How It Works

1. All `.mp3` files in the `songs/` folder are automatically detected
2. Song names are derived from the filename (without the `.mp3` extension)
3. The music track dropdown is populated dynamically when the game loads

## Adding New Songs

To add new songs to the game:

1. Simply place your `.mp3` file in the `songs/` folder
2. Run `npm run update-songs` to regenerate the song list
3. The new song will appear in the music track selection

## Removing Songs

To remove songs:

1. Delete the `.mp3` file from the `songs/` folder
2. Run `npm run update-songs` to regenerate the song list
3. The song will no longer appear in the music track selection

## Manual Song List Update

If you don't have npm installed, you can manually run:
```bash
node generate-songs-list.js
```

This will regenerate the `songs.json` file with all current songs.
