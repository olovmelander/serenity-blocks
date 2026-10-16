/**
 * Rest: Serenity Mode for falling asleep to. Choose how long to stay (15 to 60 minutes); when
 * the time is up the music fades away and the screen dims over REST_FADE_MS, then the theme
 * stops drawing (window.isThemeCovered, as under the breathing guide) and the screen is let
 * go, so the machine can rest too. Any key, a pointer or a controller brings everything back.
 *
 * SerenityRestTimer is the clock alone (no DOM, timers passed in); the dimming layer is
 * SerenityRestVeil (serenity-rest-veil.js).
 */

export const REST_FADE_MS = 45000;

export class SerenityRestTimer {
    /**
     * @param {object} options
     * @param {() => void} options.onEnd
     * @param {(callback: () => void, ms: number) => any} [options.schedule]
     * @param {(handle: any) => void} [options.cancel]
     * @param {() => number} [options.now]
     */
    constructor({
        onEnd,
        schedule = (callback, ms) => setTimeout(callback, ms),
        cancel = (handle) => clearTimeout(handle),
        now = () => Date.now(),
    }) {
        this.onEnd = onEnd;
        this.schedule = schedule;
        this.cancelTimer = cancel;
        this.now = now;
        this.minutes = 0;
        this.dueAt = 0;
        this.timer = null;
    }

    get isSet() {
        return this.minutes > 0;
    }

    /** @returns {number} milliseconds left, 0 when no timer runs */
    get msLeft() {
        return this.isSet ? Math.max(0, this.dueAt - this.now()) : 0;
    }

    /** @param {number} minutes 0 turns the timer off */
    set(minutes) {
        this.cancel();
        const m = Number(minutes);
        if (!(Number.isFinite(m) && m > 0)) return;
        this.minutes = m;
        this.dueAt = this.now() + m * 60000;
        this.timer = this.schedule(() => {
            this.timer = null;
            this.minutes = 0;
            this.onEnd();
        }, m * 60000);
    }

    cancel() {
        if (this.timer !== null) this.cancelTimer(this.timer);
        this.timer = null;
        this.minutes = 0;
    }
}
