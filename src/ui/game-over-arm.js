// @ts-check
/**
 * The results sheet ignores keyboard and controller "play again" and "main menu" for a
 * moment after it opens (audit LIFE-12). A player still hammering hard drop as the stack
 * tops out otherwise restarted on the next press: the sheet focuses Play again, so Space
 * activates it, and never saw the results. A mouse click is deliberate and works at once.
 */
export const GAME_OVER_ARM_MS = 800;

/** @param {HTMLElement | null | undefined} modal @param {number} [now] */
export function markGameOverShown(modal, now = performance.now()) {
    if (modal?.dataset) modal.dataset.armedAt = String(now + GAME_OVER_ARM_MS);
}

/**
 * True once the sheet has been up long enough to act on a key or button press. A sheet
 * that was never marked (shown some other way) is armed, as before.
 * @param {any} modal @param {number} [now]
 */
export function isGameOverArmed(modal, now = performance.now()) {
    const armedAt = Number(modal?.dataset?.armedAt);
    return !Number.isFinite(armedAt) || now >= armedAt;
}
