// @ts-check
/**
 * The photosensitivity warning: the first screen of every launch (ADR-0021).
 *
 * The markup and its style live in index.html (`#photosensitivity-warning`, the first element of
 * <body>, styled inline), so the warning is on screen from the first frame and owes nothing to the
 * stylesheets or the bundle; this module only runs its clock and owns its input. It is plain white
 * on black and still: nothing animates on it or behind it (`body.photosensitivity-warning-active`
 * pauses the loading screen's loops underneath, public/styles/photosensitivity.css). The boot never
 * waits for it: the game keeps loading underneath, and main.js starts the loading screen's own
 * clock when it lifts.
 *
 * It leaves on the first of:
 *   - a key, a pad button, a click or a tap once MIN_VISIBLE_MS have passed. A press before that
 *     is remembered and honoured at the minimum, so a launch-time key mash cannot skip it unread
 *     and the player never sees a press do nothing;
 *   - AUTO_CONTINUE_MS on screen (time while the window is hidden does not count), so an
 *     unattended launch never sits on it.
 *
 * While it is up, every key and pointer event is its own: none reaches the opening behind it (a
 * press that continues the warning must not also skip the title). Function keys and shortcuts
 * with Ctrl, Alt or Meta are left alone.
 *
 * Skipped by `?photosensitivityWarning=0`, localStorage `serenity.photosensitivityWarning=0` (the
 * shared flag idiom, src/core/flags.js: the toggle a developer has in an installed game) and
 * `?skipIntro=1`: harnesses and captures. The player always sees it.
 *
 * Dependency-free on purpose: index.html imports this module directly, so it must stay off the
 * main bundle's graph (scripts/check-boot-closure.mjs).
 */

export const PHOTOSENSITIVITY_WARNING_ID = 'photosensitivity-warning';
export const PHOTOSENSITIVITY_WARNING_FLAG = 'photosensitivityWarning';
export const PHOTOSENSITIVITY_WARNING_BODY_CLASS = 'photosensitivity-warning-active';
export const PHOTOSENSITIVITY_WARNING_EVENT = 'serenity:photosensitivity-warning';
/** Input is accepted after this long on screen (a press before it is honoured then). */
export const PHOTOSENSITIVITY_WARNING_MIN_VISIBLE_MS = 2500;
/** It continues by itself after this long visible. */
export const PHOTOSENSITIVITY_WARNING_AUTO_CONTINUE_MS = 10000;
/** The leaving fade (none under reduced motion). */
export const PHOTOSENSITIVITY_WARNING_FADE_MS = 320;
export const PHOTOSENSITIVITY_WARNING_GAMEPAD_POLL_MS = 80;

/** Events the warning owns while it covers the page. */
const OWNED_EVENTS = Object.freeze([
    'keydown', 'keyup', 'keypress',
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
    'touchstart', 'touchend',
]);
/** The events that count as a press (the rest are swallowed only). */
const PRESS_VIA = Object.freeze({
    keydown: 'key',
    pointerdown: 'pointer',
    mousedown: 'pointer',
    touchstart: 'pointer',
    // A screen reader activates the Continue button with a click alone.
    click: 'pointer',
});
const MODIFIER_KEYS = new Set([
    'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock',
    'AltGraph', 'Dead', 'Unidentified', 'Hyper', 'Super', 'Symbol', 'SymbolLock',
]);
const FUNCTION_KEY = /^F\d{1,2}$/;

/**
 * @typedef {Object} PhotosensitivityWarningResult
 * @property {'input'|'auto'|'skipped'|'disposed'|'manual'} reason
 * @property {'key'|'pointer'|'gamepad'|null} via
 * @property {number} visibleMs
 * @property {number} dismissedAtMs
 */

/**
 * @typedef {Object} PhotosensitivityWarningController
 * @property {HTMLElement | null} element
 * @property {number} shownAtMs
 * @property {Promise<PhotosensitivityWarningResult>} dismissed resolves when the warning starts
 *   to leave (the page behind it is visible from then on)
 * @property {() => boolean} isActive true until it starts to leave
 * @property {() => boolean} isCovering true until it is gone (it owns input until then)
 * @property {(reason?: PhotosensitivityWarningResult['reason'], via?: PhotosensitivityWarningResult['via']) => Promise<PhotosensitivityWarningResult>} dismiss
 * @property {() => void} dispose
 * @property {() => { state: string, shownAtMs: number, result: PhotosensitivityWarningResult | null, pendingPress: string | null }} snapshot
 */

/**
 * Whether the warning shows: `?photosensitivityWarning=1|0` → `?skipIntro=1` (skips) →
 * localStorage `serenity.photosensitivityWarning` ('1' / '0') → shown.
 * @param {{ search?: string, storage?: { getItem?: (key: string) => string | null } | null }} [source]
 * @returns {boolean}
 */
export function isPhotosensitivityWarningEnabled({ search = '', storage = null } = {}) {
    const query = String(search || '');
    if (new RegExp(`[?&]${PHOTOSENSITIVITY_WARNING_FLAG}=1\\b`).test(query)) return true;
    if (new RegExp(`[?&]${PHOTOSENSITIVITY_WARNING_FLAG}=0\\b`).test(query)) return false;
    if (/[?&]skipIntro=1\b/.test(query)) return false;
    try {
        const saved = storage?.getItem?.(`serenity.${PHOTOSENSITIVITY_WARNING_FLAG}`);
        if (saved === '1') return true;
        if (saved === '0') return false;
    } catch {
        // storage unavailable: shown
    }
    return true;
}

function defaultNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function prefersReducedMotionIn(win) {
    try {
        return win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
        return false;
    }
}

function defaultReport(win, phase, payload = {}) {
    try {
        win?.electronAPI?.invoke?.('desktop:startup-mark', { phase, payload });
    } catch {
        // diagnostics only
    }
    try {
        if (typeof CustomEvent === 'function' && typeof win?.dispatchEvent === 'function') {
            win.dispatchEvent(new CustomEvent(PHOTOSENSITIVITY_WARNING_EVENT, { detail: { phase, ...payload } }));
        }
    } catch {
        // listeners only
    }
}

function safeStorage(win) {
    try {
        return win?.localStorage ?? null;
    } catch {
        return null;
    }
}

/**
 * A key the warning leaves alone: a function key (F5, F11, F12 and the rest) or a shortcut with
 * Ctrl, Alt or Meta.
 * @param {KeyboardEvent} event
 */
function isSystemKey(event) {
    return FUNCTION_KEY.test(String(event.key || '')) || event.ctrlKey === true || event.metaKey === true
        || event.altKey === true;
}

/**
 * Run the warning that index.html painted.
 * @param {Object} [options]
 * @param {Window | any} [options.window]
 * @param {Document | any} [options.document]
 * @param {HTMLElement | any} [options.element]
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimeout]
 * @param {(id: any) => void} [options.clearTimeout]
 * @param {(fn: () => void, ms: number) => any} [options.setInterval]
 * @param {(id: any) => void} [options.clearInterval]
 * @param {number} [options.minVisibleMs]
 * @param {number} [options.autoContinueMs]
 * @param {number} [options.fadeMs]
 * @param {number} [options.gamepadPollMs]
 * @param {boolean | (() => boolean)} [options.reduceMotion]
 * @param {() => ArrayLike<any>} [options.getGamepads]
 * @param {(phase: string, payload?: object) => void} [options.reportPhase]
 * @returns {PhotosensitivityWarningController}
 */
export function createPhotosensitivityWarning(options = {}) {
    const win = options.window ?? (typeof window !== 'undefined' ? window : null);
    const doc = options.document ?? win?.document ?? (typeof document !== 'undefined' ? document : null);
    const element = options.element ?? doc?.getElementById?.(PHOTOSENSITIVITY_WARNING_ID) ?? null;
    const now = options.now ?? defaultNow;
    const setTimer = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimeout ?? ((id) => clearTimeout(id));
    const setTicker = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    const clearTicker = options.clearInterval ?? ((id) => clearInterval(id));
    const minVisibleMs = Math.max(0, options.minVisibleMs ?? PHOTOSENSITIVITY_WARNING_MIN_VISIBLE_MS);
    const autoContinueMs = Math.max(minVisibleMs, options.autoContinueMs ?? PHOTOSENSITIVITY_WARNING_AUTO_CONTINUE_MS);
    const fadeMs = Math.max(0, options.fadeMs ?? PHOTOSENSITIVITY_WARNING_FADE_MS);
    const gamepadPollMs = Math.max(16, options.gamepadPollMs ?? PHOTOSENSITIVITY_WARNING_GAMEPAD_POLL_MS);
    const reduceMotion = typeof options.reduceMotion === 'function'
        ? options.reduceMotion
        : () => (typeof options.reduceMotion === 'boolean' ? options.reduceMotion : prefersReducedMotionIn(win));
    const getGamepads = options.getGamepads ?? (() => {
        try {
            return win?.navigator?.getGamepads?.() ?? [];
        } catch {
            return [];
        }
    });
    const report = options.reportPhase ?? ((phase, payload) => defaultReport(win, phase, payload));

    const shownAtMs = now();
    /** @type {'shown'|'ready'|'leaving'|'done'} */
    let state = 'shown';
    /** @type {PhotosensitivityWarningResult['via'] | null} */
    let pendingPress = null;
    /** @type {PhotosensitivityWarningResult | null} */
    let result = null;
    let minTimer = null;
    let autoTimer = null;
    let autoRemainingMs = autoContinueMs;
    let autoArmedAt = null;
    let poll = null;
    /** @type {Map<number, Set<number>>} */
    const padButtons = new Map();
    const listeners = [];

    /** @type {(value: PhotosensitivityWarningResult) => void} */
    let resolveDismissed = () => {};
    const dismissed = new Promise((resolve) => { resolveDismissed = resolve; });

    const setState = (next) => {
        state = next;
        try {
            if (element?.dataset) element.dataset.state = next;
        } catch {
            // cosmetic only
        }
    };

    const isActive = () => state === 'shown' || state === 'ready';
    const isCovering = () => state !== 'done';

    const listen = (target, type, handler, capture) => {
        if (typeof target?.addEventListener !== 'function') return;
        target.addEventListener(type, handler, capture ? { capture: true } : undefined);
        listeners.push(() => target.removeEventListener(type, handler, capture ? { capture: true } : undefined));
    };

    const stopPoll = () => {
        if (poll !== null) {
            clearTicker(poll);
            poll = null;
        }
    };

    const disarmAuto = () => {
        if (autoTimer !== null) {
            clearTimer(autoTimer);
            autoTimer = null;
        }
        if (autoArmedAt !== null) {
            autoRemainingMs = Math.max(0, autoRemainingMs - (now() - autoArmedAt));
            autoArmedAt = null;
        }
    };

    const finish = () => {
        if (state === 'done') return;
        setState('done');
        stopPoll();
        disarmAuto();
        if (minTimer !== null) {
            clearTimer(minTimer);
            minTimer = null;
        }
        listeners.splice(0).forEach((off) => off());
        try {
            element?.remove?.();
        } catch {
            // already gone
        }
        report('photosensitivity-warning:gone', { reason: result?.reason ?? null });
    };

    /** @type {PhotosensitivityWarningController['dismiss']} */
    const dismiss = (reason = 'manual', via = null) => {
        if (result) return dismissed;
        const at = now();
        result = {
            reason, via, visibleMs: Math.max(0, at - shownAtMs), dismissedAtMs: at,
        };
        if (minTimer !== null) {
            clearTimer(minTimer);
            minTimer = null;
        }
        disarmAuto();
        stopPoll();
        setState('leaving');
        try {
            element?.classList?.add?.('is-leaving');
            element?.setAttribute?.('aria-hidden', 'true');
            doc?.body?.classList?.remove?.(PHOTOSENSITIVITY_WARNING_BODY_CLASS);
        } catch {
            // cosmetic only
        }
        report('photosensitivity-warning:dismissed', result);
        resolveDismissed(result);
        const leaveMs = reduceMotion() ? 0 : fadeMs;
        if (leaveMs > 0) setTimer(finish, leaveMs);
        else finish();
        return dismissed;
    };

    const press = (via) => {
        if (state === 'ready') {
            dismiss('input', via);
        } else if (state === 'shown' && pendingPress === null) {
            pendingPress = via;
        }
    };

    const onMinVisible = () => {
        minTimer = null;
        if (state !== 'shown') return;
        setState('ready');
        try {
            element?.classList?.add?.('is-ready');
        } catch {
            // cosmetic only
        }
        report('photosensitivity-warning:ready', { visibleMs: Math.max(0, now() - shownAtMs) });
        if (pendingPress !== null) dismiss('input', pendingPress);
    };

    const armAuto = () => {
        if (!isActive() || autoTimer !== null) return;
        autoArmedAt = now();
        autoTimer = setTimer(() => {
            autoTimer = null;
            autoArmedAt = null;
            if (isActive()) dismiss('auto');
        }, autoRemainingMs);
    };

    const hidden = () => {
        try {
            return doc?.visibilityState === 'hidden' || doc?.hidden === true;
        } catch {
            return false;
        }
    };

    const onVisibility = () => {
        if (hidden()) disarmAuto();
        else armAuto();
    };

    const onEvent = (event) => {
        if (!isCovering() || !event) return;
        const type = String(event.type || '');
        const keyboard = type.startsWith('key');
        if (keyboard && isSystemKey(event)) return;
        event.stopImmediatePropagation?.();
        event.preventDefault?.();
        if (!isActive()) return;
        const via = PRESS_VIA[type];
        if (!via) return;
        if (keyboard) {
            if (event.repeat === true || MODIFIER_KEYS.has(String(event.key || ''))) return;
        }
        press(via);
    };

    const pollGamepads = () => {
        if (!isActive()) return;
        let pads;
        try {
            pads = getGamepads() || [];
        } catch {
            return;
        }
        for (let i = 0; i < pads.length; i += 1) {
            const pad = pads[i];
            if (!pad || !pad.buttons || !pad.buttons.length) continue;
            const index = Number.isInteger(pad.index) ? pad.index : i;
            const down = new Set();
            for (let b = 0; b < pad.buttons.length; b += 1) {
                const button = pad.buttons[b];
                if (button && (button.pressed === true || Number(button.value) > 0.5)) down.add(b);
            }
            const before = padButtons.get(index);
            padButtons.set(index, down);
            // A button held when the pad was first seen (or at launch) is not a press.
            if (!before) continue;
            let pressed = false;
            down.forEach((b) => {
                if (!before.has(b)) pressed = true;
            });
            if (pressed) {
                press('gamepad');
                return;
            }
        }
    };

    // ---- up ----
    setState('shown');
    try {
        doc?.body?.classList?.add?.(PHOTOSENSITIVITY_WARNING_BODY_CLASS);
        element?.focus?.({ preventScroll: true });
    } catch {
        // cosmetic only
    }
    OWNED_EVENTS.forEach((type) => listen(win, type, onEvent, true));
    listen(doc, 'visibilitychange', onVisibility, false);
    minTimer = minVisibleMs > 0 ? setTimer(onMinVisible, minVisibleMs) : null;
    if (minVisibleMs === 0) onMinVisible();
    if (!hidden()) armAuto();
    poll = setTicker(pollGamepads, gamepadPollMs);
    report('photosensitivity-warning:shown', { minVisibleMs, autoContinueMs });

    return {
        element,
        shownAtMs,
        dismissed,
        isActive,
        isCovering,
        dismiss,
        dispose() {
            if (!result) {
                result = {
                    reason: 'disposed', via: null, visibleMs: Math.max(0, now() - shownAtMs), dismissedAtMs: now(),
                };
                try {
                    doc?.body?.classList?.remove?.(PHOTOSENSITIVITY_WARNING_BODY_CLASS);
                } catch {
                    // cosmetic only
                }
                resolveDismissed(result);
            }
            finish();
        },
        snapshot: () => ({
            state, shownAtMs, result, pendingPress,
        }),
    };
}

/**
 * A warning that is not shown (skipped by flag, or no markup): the same shape, already over.
 * @param {'skipped'} reason
 * @param {object} detail
 * @param {(phase: string, payload?: object) => void} report
 * @returns {PhotosensitivityWarningController}
 */
function skippedWarning(reason, detail, report) {
    const at = defaultNow();
    /** @type {PhotosensitivityWarningResult} */
    const result = {
        reason, via: null, visibleMs: 0, dismissedAtMs: at,
    };
    report('photosensitivity-warning:skipped', { ...detail });
    return {
        element: null,
        shownAtMs: at,
        dismissed: Promise.resolve(result),
        isActive: () => false,
        isCovering: () => false,
        dismiss: () => Promise.resolve(result),
        dispose() {},
        snapshot: () => ({
            state: 'skipped', shownAtMs: at, result, pendingPress: null,
        }),
    };
}

/**
 * Wire the warning index.html painted, or take it down when a flag skips it. Idempotent: the
 * controller is kept on `window.__serenityPhotosensitivityWarning` for main.js.
 * @param {Parameters<typeof createPhotosensitivityWarning>[0] & { enabled?: boolean, force?: boolean }} [options]
 * @returns {PhotosensitivityWarningController}
 */
export function installPhotosensitivityWarning(options = {}) {
    const win = options.window ?? (typeof window !== 'undefined' ? window : null);
    const doc = options.document ?? win?.document ?? (typeof document !== 'undefined' ? document : null);
    const existing = win?.__serenityPhotosensitivityWarning;
    if (existing && options.force !== true) return existing;

    const element = options.element ?? doc?.getElementById?.(PHOTOSENSITIVITY_WARNING_ID) ?? null;
    const report = options.reportPhase ?? ((phase, payload) => defaultReport(win, phase, payload));
    const enabled = options.enabled ?? isPhotosensitivityWarningEnabled({
        search: win?.location?.search ?? '',
        storage: safeStorage(win),
    });

    let controller;
    if (!element || !enabled) {
        try {
            element?.remove?.();
            doc?.body?.classList?.remove?.(PHOTOSENSITIVITY_WARNING_BODY_CLASS);
        } catch {
            // cosmetic only
        }
        controller = skippedWarning('skipped', { markup: Boolean(element), enabled }, report);
    } else {
        controller = createPhotosensitivityWarning({
            ...options, window: win, document: doc, element, reportPhase: report,
        });
    }
    if (win) win.__serenityPhotosensitivityWarning = controller;
    return controller;
}
