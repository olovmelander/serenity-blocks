// @ts-check
import { eventBus, EVENTS } from '../events/event-bus.js';
/**
 * Viewport broadcaster (remediation plan §4.4) — the ONE debounced window
 * resize path. 58 raw `addEventListener('resize')` sites (46 in themes) each
 * re-implement debouncing and independently call renderer.setSize, so a single
 * F11/drag fires a storm of resizes (the freeze symptom the plan flags). This
 * owns the single window listener, debounces once, and broadcasts
 * EVENTS.VIEWPORT_RESIZED { width, height, dpr }. Surfaces subscribe to that (or
 * pull getViewport() at activation) instead of listening to `resize` directly.
 *
 * visibilitychange is intentionally NOT consolidated here: its users gate
 * audio/render loops and need raw event semantics (plan §4.4 descope).
 *
 * Testable without a real window: construct with a fake win + bus.
 */

const DEFAULT_DEBOUNCE_MS = 150; // matches main.js's existing resize debounce

/**
 * @typedef {Object} Viewport
 * @property {number} width
 * @property {number} height
 * @property {number} dpr
 */

export class ViewportBroadcaster {
    /**
     * @param {any} win  window-like (innerWidth/innerHeight/devicePixelRatio/add/removeEventListener)
     * @param {{ emit: Function }} bus
     * @param {{ VIEWPORT_RESIZED: string }} events
     * @param {{ debounceMs?: number }} [opts]
     */
    constructor(win, bus, events, opts = {}) {
        this.win = win;
        this.bus = bus;
        this.events = events;
        this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.installed = false;
        this._timer = null;
        this._onResize = () => this._schedule();
        /** @type {Viewport} */
        this.last = this._read();
    }

    /** @returns {Viewport} */
    _read() {
        const w = this.win;
        if (!w) return { width: 0, height: 0, dpr: 1 };
        return {
            width: w.innerWidth || 0,
            height: w.innerHeight || 0,
            dpr: w.devicePixelRatio || 1,
        };
    }

    /** Install the single debounced resize listener (idempotent). */
    install() {
        if (this.installed || !this.win?.addEventListener) return;
        this.installed = true;
        this.last = this._read();
        this.win.addEventListener('resize', this._onResize);
    }

    _schedule() {
        if (this._timer !== null) clearTimeout(this._timer);
        this._timer = setTimeout(() => { this._timer = null; this._broadcast(); }, this.debounceMs);
    }

    _broadcast() {
        const vp = this._read();
        // Dedup: a resize event can fire with identical dimensions (e.g. a
        // devtools toggle) — don't wake every subscriber for a no-op.
        if (vp.width === this.last.width && vp.height === this.last.height && vp.dpr === this.last.dpr) return;
        this.last = vp;
        this.bus.emit(this.events.VIEWPORT_RESIZED, { ...vp });
    }

    /** Pull API for activation-time reads (no need to wait for a resize event). */
    getViewport() {
        return this.installed ? { ...this.last } : this._read();
    }

    dispose() {
        if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
        if (this.installed && this.win?.removeEventListener) {
            this.win.removeEventListener('resize', this._onResize);
        }
        this.installed = false;
    }
}

// Lazily-built singleton wired to the real window + eventBus. Lazy so importing
// the CLASS in tests doesn't add a live window listener.
let singleton = null;

function getSingleton() {
    if (!singleton) {
        const win = typeof window !== 'undefined' ? window : null;
        singleton = new ViewportBroadcaster(win, eventBus, EVENTS);
    }
    return singleton;
}

/** Install the single broadcaster (idempotent) — call once at boot / first theme. */
export function initViewportBroadcaster() {
    const b = getSingleton();
    b.install();
    return b;
}

/** Current viewport { width, height, dpr }; installs the broadcaster on first use. */
export function getViewport() {
    return getSingleton().getViewport();
}
