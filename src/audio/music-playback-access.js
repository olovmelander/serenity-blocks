import { DEFAULT_MUSIC_TRACK, getThemeForMusic } from '../core/progression/theme-music-catalog.js';

/** Songs inherit the theme grant. Odyssey playback never creates a second grant. */
export class MusicPlaybackAccess {
    constructor() {
        this.collection = null;
        this.context = null;
        this.preferredTrack = DEFAULT_MUSIC_TRACK;
    }

    isOwned(trackKey) {
        const themeId = getThemeForMusic(trackKey);
        return Boolean(themeId) && (themeId === 'forest' || this.collection?.isUnlocked(themeId) === true);
    }

    getActiveContext() {
        try { return this.context?.isCurrent() === true ? this.context : null; } catch { return null; }
    }

    canPlay(trackKey) {
        const context = this.getActiveContext();
        return context ? context.token.trackKey === trackKey : this.isOwned(trackKey);
    }

    remember(trackKey) {
        if (this.isOwned(trackKey)) this.preferredTrack = trackKey;
    }

    getRestoreTrack() {
        return this.isOwned(this.preferredTrack) ? this.preferredTrack : DEFAULT_MUSIC_TRACK;
    }

    begin({ trackKey, isCurrent = () => true, restoreTrack } = {}) {
        if (!getThemeForMusic(trackKey)) return null;
        try { if (isCurrent() !== true) return null; } catch { return null; }
        this.remember(restoreTrack);
        const token = Object.freeze({ trackKey });
        this.context = { token, isCurrent };
        return token;
    }

    end(token) {
        if (!token || this.context?.token !== token) return false;
        this.context = null;
        return true;
    }
}
