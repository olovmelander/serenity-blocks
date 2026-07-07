/* eslint-disable no-await-in-loop, no-constant-condition */
export const INTRO_RENDERER_READY_TIMEOUT_MS = 8000;
export const BOOT_WARP_PREWARM_TIMEOUT_MS = 6500;
export const BOOT_WARP_THEME_IDLE_STABLE_MS = 500;
export const BOOT_WARP_THEME_IDLE_POLL_MS = 100;
export const BOOT_WARP_THEME_IDLE_WARN_MS = 3000;
// Hard ceiling on the dynamic theme-idle wait. Real warms finish in a few seconds
// (heaviest observed ~10s total boot); the cap only exists so a stuck busy flag or a
// background-tab-throttled idle queue degrades to "warp runs a bit contended" instead
// of "studio ident forever". On expiry the caller proceeds — it does not skip the warp.
export const BOOT_WARP_THEME_IDLE_MAX_WAIT_MS = 45000;
// Bound the prewarm retry loop: retryable statuses are meant for transient stalls, but
// a DETERMINISTIC failure (same TSL codegen throw every attempt) must not retry forever.
export const BOOT_WARP_MAX_PREWARM_ATTEMPTS = 3;
export const BOOT_WARP_REQUIRED_TITLE_SAFETY_MS = 120000;

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

export function getStartupThemeBusyState(theme) {
    if (!theme) {
        return {
            busy: false,
            theme: null,
            reasons: [],
        };
    }

    const hasOwn = (prop) => Object.prototype.hasOwnProperty.call(theme, prop);
    const hasBuildingLoadSignal = Boolean(theme.buildingLoadPromise)
        || theme.buildingLoadInProgress === true
        || hasOwn('buildingLoadComplete');
    const hasBackgroundLoadSignal = Boolean(theme.backgroundLoadPromise)
        || theme.backgroundLoadInProgress === true
        || hasOwn('backgroundLoadComplete');
    const hasDeferredMaterialLoadSignal = Boolean(theme.deferredMaterialLoadPromise)
        || theme.deferredMaterialLoadInProgress === true
        || hasOwn('deferredMaterialLoadComplete');
    const reasons = [];
    if (theme.buildingLoadInProgress === true) reasons.push('building-load');
    if (theme.backgroundLoadInProgress === true) reasons.push('background-load');
    if (theme.deferredMaterialLoadInProgress === true) reasons.push('deferred-material-load');
    if (theme.isPrewarming === true) reasons.push('shader-prewarm');
    if (theme.isCreatingScene === true) reasons.push('scene-creation');
    if (theme.buildingLoadPromise && theme.buildingLoadComplete !== true) {
        reasons.push('building-load-promise');
    }
    if (theme.backgroundLoadPromise && theme.backgroundLoadComplete !== true) {
        reasons.push('background-load-promise');
    }
    if (theme.deferredMaterialLoadPromise && theme.deferredMaterialLoadComplete !== true) {
        reasons.push('deferred-material-load-promise');
    }
    if (theme.prewarmPromise && theme.isPrewarming !== false) {
        reasons.push('shader-prewarm-promise');
    }

    return {
        busy: reasons.length > 0,
        theme: theme.name || theme.id || null,
        reasons,
        buildingLoadInProgress: theme.buildingLoadInProgress === true,
        buildingLoadComplete: hasBuildingLoadSignal ? theme.buildingLoadComplete === true : true,
        backgroundLoadInProgress: theme.backgroundLoadInProgress === true,
        backgroundLoadComplete: hasBackgroundLoadSignal ? theme.backgroundLoadComplete === true : true,
        deferredMaterialLoadInProgress: theme.deferredMaterialLoadInProgress === true,
        deferredMaterialLoadComplete: hasDeferredMaterialLoadSignal
            ? theme.deferredMaterialLoadComplete === true
            : true,
        isPrewarming: theme.isPrewarming === true,
        isCreatingScene: theme.isCreatingScene === true,
    };
}

function waitMs(ms, setTimeoutFn = setTimeout) {
    return new Promise((resolve) => {
        setTimeoutFn(resolve, ms);
    });
}

/**
 * Wait until the currently warmed startup theme has stopped doing deferred work.
 * This is intentionally dynamic: heavy themes can keep the studio ident visible
 * longer, while light themes pass through almost immediately.
 *
 * @param {() => object|null} getTheme
 * @param {object} [options]
 * @param {number} [options.pollMs]
 * @param {number} [options.stableMs]
 * @param {number} [options.warnEveryMs]
 * @param {(event: string, state: object) => void} [options.onProgress]
 * @param {typeof setTimeout} [options.setTimeoutFn]
 * @returns {Promise<object>}
 */
export async function waitForStartupThemeIdle(getTheme, options = {}) {
    const pollMs = Math.max(16, options.pollMs ?? BOOT_WARP_THEME_IDLE_POLL_MS);
    const stableMs = Math.max(0, options.stableMs ?? BOOT_WARP_THEME_IDLE_STABLE_MS);
    const warnEveryMs = Math.max(250, options.warnEveryMs ?? BOOT_WARP_THEME_IDLE_WARN_MS);
    const maxWaitMs = Math.max(1000, options.maxWaitMs ?? BOOT_WARP_THEME_IDLE_MAX_WAIT_MS);
    const setTimeoutFn = options.setTimeoutFn || setTimeout;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const startedAt = nowMs();
    let idleSince = null;
    let lastReasonsKey = '';
    let lastWarnAt = startedAt;

    while (true) {
        const theme = typeof getTheme === 'function' ? getTheme() : null;
        const state = {
            ...getStartupThemeBusyState(theme),
            waitMs: Math.round(nowMs() - startedAt),
            stableForMs: idleSince === null ? 0 : Math.round(nowMs() - idleSince),
        };

        // Hard ceiling: never let a stuck busy flag hold the boot hostage. Proceeding
        // (slightly contended) is strictly better than an ident that never dismisses.
        if (state.waitMs >= maxWaitMs) {
            const finalState = { ...state, timedOut: true };
            onProgress?.('idle-timeout', finalState);
            return finalState;
        }
        const reasonsKey = state.reasons.join(',');

        if (reasonsKey !== lastReasonsKey) {
            lastReasonsKey = reasonsKey;
            onProgress?.(state.busy ? 'busy-change' : 'idle-change', state);
        }

        if (!state.busy) {
            if (idleSince === null) {
                idleSince = nowMs();
                onProgress?.('idle-start', {
                    ...state,
                    stableForMs: 0,
                });
            }

            const stableForMs = nowMs() - idleSince;
            if (stableForMs >= stableMs) {
                const finalState = {
                    ...state,
                    waitMs: Math.round(nowMs() - startedAt),
                    stableForMs: Math.round(stableForMs),
                };
                onProgress?.('idle-ready', finalState);
                return finalState;
            }
        } else {
            idleSince = null;
            const currentTime = nowMs();
            if (currentTime - lastWarnAt >= warnEveryMs) {
                lastWarnAt = currentTime;
                onProgress?.('still-busy', state);
            }
        }

        await waitMs(pollMs, setTimeoutFn);
    }
}

/**
 * Wait for the intro renderer readiness gate without letting a stalled WebGPU
 * init make the boot warp create its own device from stale information.
 *
 * @param {object} introAnimation
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {typeof setTimeout} [options.setTimeoutFn]
 * @param {typeof clearTimeout} [options.clearTimeoutFn]
 * @returns {Promise<{canAttemptWarp: boolean, reason: string}>}
 */
export async function waitForIntroRendererDecision(introAnimation, options = {}) {
    const timeoutMs = options.timeoutMs ?? INTRO_RENDERER_READY_TIMEOUT_MS;
    const setTimeoutFn = options.setTimeoutFn || setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
    const rendererReady = introAnimation?.rendererReady;

    if (!rendererReady || typeof rendererReady.then !== 'function') {
        return { canAttemptWarp: true, reason: 'intro-renderer-ready-missing' };
    }

    let timerId = null;
    const settled = await Promise.race([
        Promise.resolve(rendererReady).then(() => true, () => true),
        new Promise((resolve) => {
            timerId = setTimeoutFn(() => resolve(false), timeoutMs);
        }),
    ]);

    if (timerId !== null) {
        clearTimeoutFn(timerId);
    }

    return settled
        ? { canAttemptWarp: true, reason: 'intro-renderer-settled' }
        : { canAttemptWarp: false, reason: 'intro-renderer-timeout' };
}
