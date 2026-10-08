import { getThemeMusic } from '../progression/theme-music-catalog.js';

/** Keep temporary journey playback separate from the player's saved music choice. */
export function captureOdysseyBoardTrack(mode) {
    const sound = mode.deps?.soundManager;
    if (!sound) return;
    mode.boardTrackKey = sound.getActualTrackKey?.() || sound.musicTrack || mode.boardTrackKey;
    mode.boardTrackWasPlaying = sound.isMusicPlaying?.() ?? mode.boardTrackWasPlaying;
}

export function releaseOdysseyLevelMusic(mode, { token = mode._odysseyMusicScope, restore = true } = {}) {
    if (!token) return false;
    if (mode._odysseyMusicScope === token) mode._odysseyMusicScope = null;
    return mode.deps?.soundManager?.clearOdysseyMusicContext?.(token, { restore }) || false;
}

export function startOdysseyLevelMusic(mode, themeId, isCurrent) {
    const trackKey = getThemeMusic(themeId)?.trackKey;
    if (!trackKey || !isCurrent()) return null;
    const token = mode.deps?.soundManager?.setOdysseyMusicContext?.({
        trackKey,
        isCurrent,
        reason: 'odyssey-level-entry',
        restoreTrack: mode.deps?.settingsManager?.get?.()?.musicTrack,
    });
    mode._odysseyMusicScope = token || null;
    return token || null;
}

export function releaseOdysseyBoardMusic(board, { restore = true } = {}) {
    const token = board._odysseyMusicScope;
    board._odysseyMusicScope = null;
    return token ? board.soundManager?.clearOdysseyMusicContext?.(token, { restore }) || false : false;
}

/** A reason string never grants playback: the visible world's owner must still be alive. */
export function applyOdysseyChapterMusic(board, trackKey, options = {}) {
    const sound = board.soundManager;
    const isCurrent = () => board.isActive === true && !board.isRenderingPaused && !board._disposed
        && board.isMusicContextActive?.() !== false;
    if (!trackKey || trackKey === 'Ambient' || !isCurrent() || !sound?.setOdysseyMusicContext) return false;
    if (sound.trackNames?.length && !sound.trackNames.includes(trackKey)) return false;
    try {
        const token = sound.setOdysseyMusicContext({
            ...options, trackKey, isCurrent, reason: options.reason || 'odyssey-chapter-music',
        });
        if (!token) return false;
        board._odysseyMusicScope = token;
        return true;
    } catch (error) {
        console.warn('[OdysseyBoard] Failed to apply chapter music:', error);
        return false;
    }
}

export async function applyOdysseyBoardAudioPolicy(mode, { restoreTrack = false } = {}) {
    const sound = mode.deps?.soundManager;
    if (!sound) return;
    sound.suspendThemeLinkedMusic?.();
    releaseOdysseyLevelMusic(mode);
    if (!restoreTrack || !mode.isActive || !mode.isInBoardView) return;
    const board = mode.boardController;
    // A parked board acquires its context in resumeRendering, once it is actually active.
    board?._applyChapterMusic?.(board._odysseyMusicChapter || mode.odysseyState?.currentChapter || 1, {
        reason: 'odyssey-board-view', forcePlayback: true,
    });
}
