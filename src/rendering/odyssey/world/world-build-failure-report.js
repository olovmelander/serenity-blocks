/**
 * LOUD failure reporting for a One World build failure.
 *
 * Why this exists (Wave 4/6 audit, 2026-08-12; ADR-0022): the board's catch around
 * `createOdysseyWorld()` plays on without the world. Chapters 2-5 then have no ground, against
 * the corridor's sheets and the atmosphere, and that state is self-consistent enough to pass a
 * smoke test and to look to a player like a quieter map.
 *
 * So the failure must be LOUD in two directions:
 *  - to the PLAYER: a dismissible on-screen banner naming what happened, so "the game
 *    looks different" has an explanation attached;
 *  - to US: a persisted localStorage log (capped ring) that a later session can read to
 *    answer "has this machine ever failed to build the world?" with data instead of hope.
 *
 * Deliberately dependency-free and DOM-guarded: it must work when the renderer is in an
 * arbitrary broken state (that is precisely when it runs), and it must be a no-op under
 * vitest/node where there is no document.
 */

export const WORLD_BUILD_FAILURE_STORAGE_KEY = 'odysseyWorldBuildFailures';
const MAX_STORED_FAILURES = 20;
const BANNER_ID = 'odyssey-world-build-failure-banner';

/**
 * Read the persisted failure log. Returns [] when storage is unavailable, empty, or
 * corrupt — a diagnostic helper must never itself throw.
 */
export function readWorldBuildFailures(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem?.(WORLD_BUILD_FAILURE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function persistFailure(error, storage) {
    try {
        const entries = readWorldBuildFailures(storage);
        entries.push({
            at: new Date().toISOString(),
            message: String(error?.message ?? error ?? 'unknown'),
            // The stack head is what distinguishes "TSL compile failed" from "bad asset"
            // in a report a user pastes; the whole stack is noise at this altitude.
            stackHead: String(error?.stack ?? '').split('\n').slice(0, 3).join('\n'),
        });
        const capped = entries.slice(-MAX_STORED_FAILURES);
        storage?.setItem?.(WORLD_BUILD_FAILURE_STORAGE_KEY, JSON.stringify(capped));
        return capped.length;
    } catch {
        return 0;
    }
}

function showBanner(failureCount, doc) {
    // One banner AT A TIME. Re-entry while it is up is a no-op (the first failure is the
    // story, and the running count lives in storage); after the player dismisses it, a later
    // failure is allowed to raise a fresh one rather than being silently swallowed.
    if (!doc || doc.getElementById(BANNER_ID)) return;

    const banner = doc.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'alert');
    // Inline styles on purpose: this must render with zero dependence on the app's
    // stylesheet having loaded, and must never be restyled into invisibility by accident.
    banner.style.cssText = [
        'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
        // border-box so the declared max-width is the RENDERED width. With the default
        // content-box the 54px of horizontal padding is added on top, and the banner
        // measured 695px against its own stated 640px cap.
        'box-sizing:border-box',
        'z-index:99999', 'max-width:min(92vw,640px)', 'padding:10px 40px 10px 14px',
        'background:rgba(64,18,22,0.96)', 'color:#ffd9d9',
        'border:1px solid #a04048', 'border-radius:8px',
        'font:13px/1.45 system-ui,sans-serif', 'box-shadow:0 4px 18px rgba(0,0,0,0.5)',
    ].join(';');
    banner.textContent = 'Odyssey: the world could not be built on this device, so chapters '
        + '2 to 5 will play without their scenery. The journey remains fully playable. '
        + `(Recorded failure #${failureCount} — please report this.)`;

    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.style.cssText = [
        'position:absolute', 'top:4px', 'right:8px', 'background:none', 'border:none',
        'color:#ffd9d9', 'font-size:18px', 'cursor:pointer', 'padding:2px 6px',
    ].join(';');
    dismiss.addEventListener('click', () => banner.remove());
    banner.appendChild(dismiss);

    (doc.body ?? doc.documentElement)?.appendChild(banner);
}

/**
 * Report a One World build failure loudly. Call from the board's catch AFTER the world is
 * out of the scene — reporting must never be able to stand in the way of playing on.
 * Safe in every environment: no DOM → storage only; no storage → banner only; neither →
 * silent no-op (the console.error at the call site still fires).
 */
export function reportWorldBuildFailure(error, {
    doc = globalThis.document,
    storage = globalThis.localStorage,
} = {}) {
    const failureCount = persistFailure(error, storage);
    showBanner(failureCount || 1, doc);
}
