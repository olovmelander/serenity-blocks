/**
 * Dark veil that masks an Odyssey in-place retry's board reset (fail → instant
 * restart of the SAME level, see OdysseyMode._restartLevelInPlace). Owns the
 * mount / fade / teardown DOM lifecycle so the game mode stays free of direct
 * document access.
 */

export const RETRY_VEIL_FADE_MS = 260;

let activeVeil = null;

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, ms));
    });
}

/**
 * Mount the veil over everything (including any open modal) and fade it to
 * opaque. Resolves once the fade completes and the screen is fully covered.
 */
export async function showRetryVeil() {
    clearRetryVeil();
    const veil = document.createElement('div');
    veil.id = 'odyssey-retry-veil';
    veil.dataset.odysseyWheelLock = 'true';
    veil.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: auto;
        opacity: 0;
        z-index: 10001;
        background:
            radial-gradient(circle at 50% 42%, rgba(255, 150, 120, 0.05), rgba(0, 0, 0, 0) 22%),
            radial-gradient(circle at 50% 50%, rgba(16, 10, 16, 0.94), rgba(0, 0, 0, 0.99) 72%);
        transition: opacity ${RETRY_VEIL_FADE_MS}ms ease-out;
    `;
    document.body.appendChild(veil);
    activeVeil = veil;
    veil.getBoundingClientRect(); // force reflow so the opacity transition actually plays
    veil.style.opacity = '1';
    await wait(RETRY_VEIL_FADE_MS);
}

/**
 * Fade the veil back out and remove it. Resolves once the fade completes and
 * the board beneath is fully revealed.
 */
export async function hideRetryVeil() {
    if (!activeVeil) return;
    activeVeil.style.opacity = '0';
    await wait(RETRY_VEIL_FADE_MS);
    clearRetryVeil();
}

/** Remove the veil immediately (no fade), if present. */
export function clearRetryVeil() {
    if (activeVeil) {
        activeVeil.remove();
        activeVeil = null;
    }
}
