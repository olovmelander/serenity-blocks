import { DEFAULT_MUSIC_TRACK, getThemeForMusic, resolveMusicTrackKey } from './theme-music-catalog.js';

/** Saved choices never borrow Odyssey's temporary permission to play an authored song. */
export function resolveOwnedMusicPreference(trackKey, collection) {
    // A save or a cloud copy written before a song was retitled still names its old key.
    const key = resolveMusicTrackKey(trackKey);
    const themeId = getThemeForMusic(key);
    return themeId && (themeId === 'forest' || collection?.isUnlocked(themeId))
        ? key : DEFAULT_MUSIC_TRACK;
}
