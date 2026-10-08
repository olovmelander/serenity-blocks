import { DEFAULT_MUSIC_TRACK, getThemeForMusic, getThemeMusic } from '../core/progression/theme-music-catalog.js';

/** Intro/menu presentation respects an earned preference without granting any soundtrack. */
export function ensurePreferredMenuMusic(sound) {
    if (!sound) return;
    const saved = sound.settingsManager?.get?.()?.musicTrack;
    const trackKey = [saved, sound.musicTrack].find((key) => key && sound.canSelectTrack?.(key))
        || DEFAULT_MUSIC_TRACK;
    if (sound.trackNames?.includes(trackKey)) {
        if (sound.musicTrack !== trackKey) sound.setTrack(trackKey, { persist: false });
        else if (!sound.isMusicPlaying?.()) sound.startBackgroundMusic?.();
        return;
    }
    if (sound.isMusicPlaying?.() && sound.musicTrack === trackKey) return;
    sound.musicTrack = trackKey;
    sound.playAudioFile?.(getThemeMusic(getThemeForMusic(trackKey)).path, { trackKey });
}
