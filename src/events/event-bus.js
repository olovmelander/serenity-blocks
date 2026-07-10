// @ts-check
/**
 * The single event bus (remediation plan §4.1 — one bus, optimizer retired).
 *
 * Ordering guarantee (load-bearing — 222 theme subscriptions rely on it):
 * option-less listeners run SYNCHRONOUSLY, in registration order, the same
 * frame they are emitted. Only listeners that opt into throttle/debounce/raf
 * defer.
 *
 * Isolation: emit() try/catches per listener, so one throwing handler can no
 * longer abort later handlers or propagate into gameplay code (the previous
 * sync-bus footgun the plan flags). Failures route to onListenerError.
 *
 * emit() no-ops on names with no listeners. setKnownEvents() opts into a
 * dev/test guard that throws on an unknown/undefined name at emit AND
 * subscribe time (would have caught the HOST_MIGRATED-undefined bug); the
 * static event-name contract test (tests/unit/event-contract.test.js) is the
 * CI-time guard.
 */

/** @param {(payload?: any) => void} fn */
function rafThrottleWrap(fn) {
    let scheduled = null;
    let lastPayload;
    const hasRaf = typeof requestAnimationFrame === 'function';
    const wrapped = (/** @type {any} */ payload) => {
        lastPayload = payload;
        if (scheduled !== null) return;
        const run = () => { scheduled = null; fn(lastPayload); };
        scheduled = hasRaf ? requestAnimationFrame(run) : setTimeout(run, 16);
    };
    wrapped.cancel = () => {
        if (scheduled === null) return;
        if (hasRaf) cancelAnimationFrame(scheduled); else clearTimeout(scheduled);
        scheduled = null;
    };
    return wrapped;
}

/** @param {(payload?: any) => void} fn @param {number} ms */
function throttleWrap(fn, ms) {
    let last = 0;
    let timer = null;
    let lastPayload;
    const wrapped = (/** @type {any} */ payload) => {
        lastPayload = payload;
        const now = Date.now();
        const remaining = ms - (now - last);
        if (remaining <= 0) {
            last = now;
            fn(lastPayload);
        } else if (timer === null) {
            timer = setTimeout(() => { last = Date.now(); timer = null; fn(lastPayload); }, remaining);
        }
    };
    wrapped.cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    return wrapped;
}

/** @param {(payload?: any) => void} fn @param {number} ms */
function debounceWrap(fn, ms) {
    let timer = null;
    let lastPayload;
    const wrapped = (/** @type {any} */ payload) => {
        lastPayload = payload;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(lastPayload); }, ms);
    };
    wrapped.cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    return wrapped;
}

/**
 * @typedef {Object} ListenerOptions
 * @property {number} [throttleMs]
 * @property {number} [debounceMs]
 * @property {boolean} [rafThrottle]
 */

/**
 * @typedef {Object} ListenerEntry
 * @property {(payload?: any) => void} original
 * @property {(payload?: any) => void} deliver
 * @property {(() => void) | undefined} cancel
 */

class EventBus {
    constructor() {
        /** @type {Map<string, Set<ListenerEntry>>} */
        this.listeners = new Map();
        /** @type {Set<string> | null} */
        this.knownEvents = null;
    }

    /**
     * DEV/TEST only: after this is called, an unknown or undefined event name
     * throws at subscribe and emit time. Not called in production.
     * @param {Iterable<string>} names
     */
    setKnownEvents(names) {
        this.knownEvents = new Set(names);
    }

    /** @param {string} eventName @param {string} where */
    _assertKnown(eventName, where) {
        if (this.knownEvents && !this.knownEvents.has(eventName)) {
            throw new Error(`[EventBus] ${where}: unknown event name "${eventName}" — register it in the event map.`);
        }
    }

    /**
     * @param {string} eventName
     * @param {(payload?: any) => void} handler
     * @param {ListenerOptions} [options]
     * @returns {() => void} unsubscribe
     */
    on(eventName, handler, options = {}) {
        this._assertKnown(eventName, 'on');
        let deliver = handler;
        if (options.debounceMs) deliver = debounceWrap(handler, options.debounceMs);
        else if (options.throttleMs) deliver = throttleWrap(handler, options.throttleMs);
        else if (options.rafThrottle) deliver = rafThrottleWrap(handler);
        // The wrappers expose .cancel; a bare handler does not.
        const cancel = deliver === handler ? undefined : /** @type {any} */ (deliver).cancel;
        /** @type {ListenerEntry} */
        const entry = { original: handler, deliver, cancel };
        if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
        const set = this.listeners.get(eventName);
        if (set) set.add(entry);
        return () => this._removeEntry(eventName, entry);
    }

    /**
     * @param {string} eventName
     * @param {(payload?: any) => void} handler
     * @returns {() => void} unsubscribe
     */
    once(eventName, handler) {
        /** @type {ListenerEntry} */
        let entry;
        const wrapper = (/** @type {any} */ payload) => {
            this._removeEntry(eventName, entry); // off by WRAPPER identity — fixes the optimizer once() bug
            handler(payload);
        };
        this._assertKnown(eventName, 'once');
        entry = { original: wrapper, deliver: wrapper, cancel: undefined };
        if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
        const set = this.listeners.get(eventName);
        if (set) set.add(entry);
        return () => this._removeEntry(eventName, entry);
    }

    /**
     * Off by the ORIGINAL handler (wrapper-aware) — removes every entry whose
     * caller-supplied handler matches.
     * @param {string} eventName
     * @param {(payload?: any) => void} handler
     */
    off(eventName, handler) {
        const set = this.listeners.get(eventName);
        if (!set) return;
        for (const entry of set) {
            if (entry.original === handler) {
                entry.cancel?.();
                set.delete(entry);
            }
        }
        if (set.size === 0) this.listeners.delete(eventName);
    }

    /** @param {string} eventName @param {ListenerEntry} entry */
    _removeEntry(eventName, entry) {
        const set = this.listeners.get(eventName);
        if (!set) return;
        entry.cancel?.();
        set.delete(entry);
        if (set.size === 0) this.listeners.delete(eventName);
    }

    /**
     * @param {string} eventName
     * @param {unknown} [payload]
     */
    emit(eventName, payload) {
        this._assertKnown(eventName, 'emit');
        const set = this.listeners.get(eventName);
        if (!set || set.size === 0) return;
        // Copy so a handler that (un)subscribes mid-emit can't corrupt iteration.
        for (const entry of [...set]) {
            try {
                entry.deliver(payload);
            } catch (err) {
                this.onListenerError(eventName, err, entry.original);
            }
        }
    }

    /**
     * @param {string} eventName @param {unknown} err
     * @param {(payload?: any) => void} handler
     */
    // eslint-disable-next-line class-methods-use-this
    onListenerError(eventName, err, handler) {
        console.error(`[EventBus] listener for "${eventName}" threw:`, err, handler);
    }

    /** @param {string} eventName @returns {number} */
    listenerCount(eventName) {
        return this.listeners.get(eventName)?.size ?? 0;
    }
}

export const eventBus = new EventBus();

export const EVENTS = {
    THEME_CHANGED: 'themeChanged',
    THEME_LOADING: 'themeLoading',
    BACKGROUND_READY: 'backgroundReady',
    LINE_CLEAR: 'lineClear',
    COMBO: 'combo',
    PERFECT_CLEAR: 'perfectClear',
    CASCADE: 'cascade',
    B2B: 'b2b',
    TSPIN: 'tspin',
    PIECE_LOCK: 'pieceLock',
    PIECE_MOVE: 'pieceMove',
    PIECE_ROTATE: 'pieceRotate',
    HARD_DROP: 'hardDrop',
    LEVEL_UP: 'levelUp',
    SETTINGS_CHANGED: 'settingsChanged',
    ODYSSEY_SAVED: 'odysseySaved',
    HIGH_SCORE_SAVED: 'highScoreSaved',
    // Odyssey Mode Victory Lap
    ODYSSEY_GOAL_COMPLETE: 'odysseyGoalComplete',
    ODYSSEY_VICTORY_LAP_END: 'odysseyVictoryLapEnd',
    // Demo System
    OPEN_DEMO_BROWSER: 'openDemoBrowser',
    EXIT_TO_MAIN_MENU: 'exitToMainMenu',
    PLAY_DEMO: 'playDemo',
    // GPU Context Resilience
    CONTEXT_LOST: 'contextLost',
    CONTEXT_RESTORED: 'contextRestored',

    // Performance Adapters
    PERFORMANCE_DOWNSCALE: 'performanceDownscale',
};
