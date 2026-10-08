import { DEFAULT_MUSIC_TRACK, getThemeForMusic } from './theme-music-catalog.js';

/** Saved choices never borrow Odyssey's temporary permission to play an authored song. */
export function resolveOwnedMusicPreference(trackKey, collection) {
    const themeId = getThemeForMusic(trackKey);
    return themeId && (themeId === 'forest' || collection?.isUnlocked(themeId))
        ? trackKey : DEFAULT_MUSIC_TRACK;
}
