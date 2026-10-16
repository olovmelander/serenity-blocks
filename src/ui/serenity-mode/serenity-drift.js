/**
 * Drift: Serenity Mode moving between themes by itself, so you can simply watch.
 *
 * Two paces:
 *   - **with the music**: the world follows the song. When a song ends the next one starts
 *     (SoundManager.onAudioEnded) and its theme comes with it; choosing a song yourself brings
 *     its world as well. If no song changes for SILENT_MUSIC_MS (music muted or paused), the
 *     world moves on by itself.
 *   - **a timer** (10, 20, 30 minutes): the next theme from the shuffle deck, counted from the
 *     last change, so a theme you just chose gets its full time.
 *
 * Drift holds while the theme cannot be seen or you are choosing (the Hub, Settings, a
 * breathing world over the theme, a Hale session, the rest veil) and picks up where it was.
 * Everything it needs is passed in, so it runs in tests without a DOM or a renderer.
 */
import { driftMinutes, normalizeDrift } from './serenity-options.js';

/** With the music and no song change for this long, the world moves on anyway. */
export const SILENT_MUSIC_MS = 8 * 60 * 1000;

export class SerenityDrift {
    /**
     * @param {object} options
     * @param {() => string|null} options.activeTheme the theme on screen
     * @param {() => string|null} options.pickNextTheme the next theme for a timed drift
     * @param {(trackKey: string) => string|null} options.themeForTrack the theme a song belongs to
     * @param {(themeId: string) => boolean} options.canUse whether that theme may be shown
     * @param {(themeId: string, reason: string) => void} options.applyTheme switch to it
     * @param {(callback: () => void, ms: number) => any} [options.schedule]
     * @param {(handle: any) => void} [options.cancel]
     * @param {() => number} [options.now]
     */
    constructor({
        activeTheme, pickNextTheme, themeForTrack, canUse, applyTheme,
        schedule = (callback, ms) => setTimeout(callback, ms),
        cancel = (handle) => clearTimeout(handle),
        now = () => Date.now(),
    }) {
        this.activeTheme = activeTheme;
        this.pickNextTheme = pickNextTheme;
        this.themeForTrack = themeForTrack;
        this.canUse = canUse;
        this.applyTheme = applyTheme;
        this.schedule = schedule;
        this.cancel = cancel;
        this.now = now;
        this.pace = 'off';
        this.holds = new Set();
        this.timer = null;
        this.dueAt = 0;
        this.remaining = 0;
        this.lastTrack = null;
    }

    get isOn() {
        return this.pace !== 'off';
    }

    get isHeld() {
        return this.holds.size > 0;
    }

    /** @param {string} pace 'off', 'music' or minutes ('10', '20', '30') */
    setPace(pace) {
        this.pace = normalizeDrift(pace);
        this.remaining = 0;
        this._restart();
        if (this.pace === 'music') this._followTrack(this.lastTrack);
    }

    /** Stop drifting for a reason (the Hub is open, the theme is covered…) until released. */
    hold(reason) {
        if (this.holds.has(reason)) return;
        this.holds.add(reason);
        if (this.holds.size === 1) this._pause();
    }

    release(reason) {
        if (!this.holds.delete(reason) || this.holds.size > 0) return;
        if (this.pace === 'music') this._followTrack(this.lastTrack);
        this._restart(this.remaining || undefined);
        this.remaining = 0;
    }

    /** The theme changed (by drift, an arrow, the Hub): a timed drift counts from now. */
    noteThemeChanged() {
        if (this.isOn && !this.isHeld) this._restart();
        else this.remaining = 0;
    }

    /** The song changed: with the music, its world follows. */
    noteTrackChanged(trackKey) {
        this.lastTrack = trackKey || null;
        if (this.pace !== 'music') return;
        if (this.isHeld) {
            this.remaining = 0;
            return;
        }
        this._followTrack(this.lastTrack);
        this._restart();
    }

    destroy() {
        this._clear();
        this.holds.clear();
        this.pace = 'off';
    }

    _interval() {
        if (this.pace === 'music') return SILENT_MUSIC_MS;
        return driftMinutes(this.pace) * 60 * 1000;
    }

    _clear() {
        if (this.timer !== null) this.cancel(this.timer);
        this.timer = null;
    }

    _restart(ms = this._interval()) {
        this._clear();
        if (!this.isOn) return;
        if (this.isHeld) {
            this.remaining = ms;
            return;
        }
        this.dueAt = this.now() + ms;
        this.timer = this.schedule(() => this._fire(), ms);
    }

    _pause() {
        if (this.timer === null) return;
        this.remaining = Math.max(1000, this.dueAt - this.now());
        this._clear();
    }

    _fire() {
        this.timer = null;
        if (!this.isOn || this.isHeld) return;
        const next = this.pickNextTheme();
        if (next && next !== this.activeTheme() && this.canUse(next)) this.applyTheme(next, 'drift');
        this._restart();
    }

    _followTrack(trackKey) {
        if (!trackKey || this.isHeld) return;
        const theme = this.themeForTrack(trackKey);
        if (theme && theme !== this.activeTheme() && this.canUse(theme)) this.applyTheme(theme, 'drift-music');
    }
}
