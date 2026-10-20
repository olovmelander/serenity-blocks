// @ts-check
/**
 * The loading screen's clock, and the photosensitivity warning's handoff to it (ADR-0021).
 *
 * The warning (src/ui/photosensitivity-warning.js) covers the loading screen for the first seconds
 * of a launch and keeps its controller on `window.__serenityPhotosensitivityWarning`, because it
 * runs before this bundle. The boot never waits for it; only what the player must SEE does: the
 * ident's minimum on screen and its entrance reveal count from the moment the warning lifts.
 * main.js marks when the shell is up and asks here how long it has been seen.
 */
import { markStartup } from './startup-debug.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

export { applyReduceFlashingClass } from '../utils/photosensitivity.js';

let shown = false;
let shownAtMs = 0;

function now() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

/** The warning's controller while the page has one. */
export function photosensitivityWarning() {
    if (typeof window === 'undefined') return null;
    return /** @type {any} */ (window).__serenityPhotosensitivityWarning || null;
}

/** True while the warning covers the loading screen. */
export function photosensitivityWarningActive() {
    return photosensitivityWarning()?.isActive?.() === true;
}

/** Resolves once the warning has lifted (at once when there is none). */
export function waitForPhotosensitivityWarning() {
    const warning = photosensitivityWarning();
    if (!warning?.isActive?.()) return Promise.resolve();
    return Promise.resolve(warning.dismissed).then(() => undefined, () => undefined);
}

/**
 * Run `callback` when the warning lifts, with the moment it did (performance.now()).
 * @param {(liftedAtMs: number) => void} callback
 * @returns {boolean} whether the warning was up (false: the callback will not run)
 */
export function onPhotosensitivityWarningLift(callback) {
    const warning = photosensitivityWarning();
    if (!warning?.isActive?.()) return false;
    Promise.resolve(warning.dismissed).then((result) => {
        const liftedAt = Number(result?.dismissedAtMs);
        callback(Number.isFinite(liftedAt) ? liftedAt : now());
    }).catch(() => {});
    return true;
}

/** The loading screen is up. Under the warning it is first SEEN when the warning lifts. */
export function markStartupShellShown() {
    shown = true;
    shownAtMs = now();
    onPhotosensitivityWarningLift((liftedAt) => {
        shownAtMs = Math.max(shownAtMs, liftedAt);
    });
    return shownAtMs;
}

/** When the loading screen was (first) seen, performance.now(); 0 before it is up. */
export function startupShellShownAtMs() {
    return shownAtMs;
}

/**
 * Resolves once the loading screen has been seen for `ms` (never before the warning lifts), so
 * the ident reads as an intentional ident, not a flash, even when the boot is fast.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function waitForStartupShellSeen(ms) {
    return waitForPhotosensitivityWarning().then(() => {
        const remaining = shown ? ms - (now() - shownAtMs) : 0;
        if (remaining <= 0) return undefined;
        return new Promise((resolve) => { setTimeout(resolve, remaining); });
    });
}

/**
 * Run `callback` once the loading screen's entrance reveal (`ms`) has played. Under the warning
 * the loading screen is covered and its loops are paused, so the reveal plays once the warning
 * lifts: the callback is parked for then and this returns at once (the warm may begin behind a
 * still, opaque screen, where nothing seen can freeze). Otherwise it waits.
 * @param {number} ms
 * @param {() => void} callback
 * @returns {Promise<boolean>} whether the callback has already run
 */
export async function afterStartupShellReveal(ms, callback) {
    if (onPhotosensitivityWarningLift(() => { setTimeout(callback, ms); })) return false;
    await waitForStartupShellSeen(ms);
    callback();
    return true;
}

/**
 * Trace the warning like any boot milestone (nothing waits for it).
 * @returns {boolean} whether the page has a warning to trace
 */
export function tracePhotosensitivityWarning() {
    const warning = photosensitivityWarning();
    if (!warning) return false;
    markStartup('photosensitivity-warning:observed', {
        state: warning.snapshot?.()?.state ?? 'unknown',
        shownAtMs: Math.round(warning.shownAtMs || 0),
    });
    Promise.resolve(warning.dismissed).then((result) => {
        const detail = {
            reason: result?.reason || 'unknown',
            via: result?.via || null,
            visibleMs: Math.round(result?.visibleMs || 0),
        };
        markStartup('photosensitivity-warning:dismissed', detail);
        performanceMonitor.recordEvent('photosensitivity_warning_dismissed', detail);
    }).catch(() => {});
    return true;
}

export function resetStartupShellClockForTests() {
    shown = false;
    shownAtMs = 0;
}
