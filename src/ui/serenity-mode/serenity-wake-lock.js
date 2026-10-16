/**
 * Keep the screen awake while Serenity Mode is watched (Screen Wake Lock API; Electron grants
 * it, a browser may refuse without a gesture). The lock is dropped when the page is hidden,
 * so it is asked for again when the page comes back. Released when the mode leaves and when
 * the rest timer ends, so the screen may sleep then.
 */
export class ScreenWakeLock {
    constructor() {
        this.wanted = false;
        this.lock = null;
        this.token = 0;
        this.onVisibility = () => {
            if (this.wanted && !document.hidden && !this.lock) this._request();
        };
    }

    acquire() {
        if (this.wanted) return;
        this.wanted = true;
        document.addEventListener('visibilitychange', this.onVisibility);
        this._request();
    }

    release() {
        if (!this.wanted) return;
        this.wanted = false;
        this.token += 1;
        document.removeEventListener('visibilitychange', this.onVisibility);
        const { lock } = this;
        this.lock = null;
        Promise.resolve(lock?.release?.()).catch(() => {});
    }

    _request() {
        const { wakeLock } = globalThis.navigator || {};
        if (typeof wakeLock?.request !== 'function' || document.hidden) return;
        this.token += 1;
        const { token } = this;
        Promise.resolve(wakeLock.request('screen')).then((lock) => {
            if (token !== this.token || !this.wanted) {
                Promise.resolve(lock?.release?.()).catch(() => {});
                return;
            }
            this.lock = lock;
            lock?.addEventListener?.('release', () => {
                if (this.lock === lock) this.lock = null;
            });
        }).catch(() => { /* not allowed here: the screen may dim */ });
    }
}
