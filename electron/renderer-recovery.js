/**
 * What the main process does when the game's renderer dies, hangs or fails to load
 * (audit ELEC-09). Nothing listened before: a crash left a blank black window and no
 * record of why.
 *
 * - A crash, kill or out-of-memory reloads the game once. A second one within a minute
 *   asks the player (Reload or Quit) instead of reloading in a loop.
 * - 'clean-exit' is a normal teardown (reload, quit) and is ignored, as is the kill the
 *   player asked for by choosing Reload on the "not responding" prompt: that one is
 *   already reloading.
 * - A main-frame load failure of the packaged page asks the player. An aborted load is
 *   not a failure: it is what a reload in flight reports.
 */
export const RENDERER_CRASH_WINDOW_MS = 60_000;
export const REQUESTED_RELOAD_GRACE_MS = 10_000;

const ERR_ABORTED = -3;

/**
 * @param {{ reason: string, now: number, recentCrashes?: number[], reloadRequestedAt?: number | null }} input
 * @returns {{ action: 'ignore' | 'reload' | 'prompt', recentCrashes: number[] }}
 */
export function decideRendererRecovery({
    reason, now, recentCrashes = [], reloadRequestedAt = null,
}) {
    if (reason === 'clean-exit') return { action: 'ignore', recentCrashes };
    if (reloadRequestedAt !== null && now - reloadRequestedAt < REQUESTED_RELOAD_GRACE_MS) {
        return { action: 'ignore', recentCrashes };
    }
    const recent = [...recentCrashes.filter((at) => now - at < RENDERER_CRASH_WINDOW_MS), now];
    return { action: recent.length > 1 ? 'prompt' : 'reload', recentCrashes: recent };
}

/**
 * @param {{ errorCode: number, isMainFrame: boolean }} failure
 * @returns {boolean}
 */
export function isFatalLoadFailure({ errorCode, isMainFrame }) {
    return isMainFrame === true && errorCode !== ERR_ABORTED;
}
