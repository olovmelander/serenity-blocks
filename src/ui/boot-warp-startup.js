/* eslint-disable no-await-in-loop, no-constant-condition */
import { performanceMonitor } from '../utils/performance-monitor.js';
import { markStartup } from './startup-debug.js';

export const INTRO_RENDERER_READY_TIMEOUT_MS = 8000;
export const BOOT_WARP_PREWARM_TIMEOUT_MS = 6500;
export const BOOT_WARP_MIN_VISIBLE_MS = 5000;
export const BOOT_WARP_DEFAULT_DURATION_MS = 6500;
export const BOOT_WARP_REVEAL_PROGRESS = 0.06;
export const BOOT_WARP_FADE_PROGRESS = 0.9;
export const BOOT_WARP_TITLE_PROGRESS = 0.84;
export const BOOT_WARP_FADE_OUT_MS = 880;
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

function roundMs(value) {
    return Math.round(value * 10) / 10;
}

function getParam(params, key) {
    if (!params || typeof params.get !== 'function') {
        return null;
    }
    return params.get(key);
}

/**
 * Resolve the boot-warp play timings from URL params while preserving the visible
 * minimum. A short ?warpDur= is useful for repros, but it must not collapse the
 * production handoff into a half-second flash.
 *
 * @param {URLSearchParams} [params]
 * @returns {object}
 */
export function resolveBootWarpTiming(params = null) {
    const rawDuration = parseInt(getParam(params, 'warpDur') || '', 10);
    const requestedDurationMs = Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : null;
    const progressSpan = Math.max(0.01, BOOT_WARP_FADE_PROGRESS - BOOT_WARP_REVEAL_PROGRESS);
    const minDurationMs = Math.ceil(BOOT_WARP_MIN_VISIBLE_MS / progressSpan);
    const baseDurationMs = requestedDurationMs || BOOT_WARP_DEFAULT_DURATION_MS;
    const durationMs = Math.max(minDurationMs, baseDurationMs);

    return {
        durationMs,
        requestedDurationMs,
        minDurationMs,
        minVisibleMs: BOOT_WARP_MIN_VISIBLE_MS,
        revealProgress: BOOT_WARP_REVEAL_PROGRESS,
        fadeProgress: BOOT_WARP_FADE_PROGRESS,
        titleProgress: BOOT_WARP_TITLE_PROGRESS,
        fadeOutMs: BOOT_WARP_FADE_OUT_MS,
    };
}

/**
 * Play the committed WebGPU warp handoff with a hard visible-duration contract.
 * The shell is only dismissed after a successful warp frame, and the intro title /
 * canvas fade cannot happen until the player has seen the warp long enough.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function playBootWarpHandoff(options = {}) {
    const {
        warpTransition,
        urlParams = null,
        introAnimation = null,
        soundManager = null,
        dismissStartupShell = null,
        setTimeoutFn = setTimeout,
    } = options;
    const timing = resolveBootWarpTiming(urlParams);
    const startedAt = nowMs();

    if (!warpTransition || typeof warpTransition.play !== 'function') {
        return {
            status: 'missing-transition',
            shellDismissed: false,
            firstFrameRendered: false,
            visibleMs: 0,
            timing,
        };
    }

    let shellDismissed = false;
    let titleRevealed = false;
    let fadePromise = null;
    let visibleStartedAt = null;
    let minVisibleMarked = false;
    let latestProgress = 0;
    let warpAudioStarted = false;

    const visibleMs = () => (visibleStartedAt === null ? 0 : Math.max(0, nowMs() - visibleStartedAt));

    const markMinVisibleIfReady = () => {
        if (minVisibleMarked || visibleStartedAt === null || visibleMs() < timing.minVisibleMs) {
            return false;
        }

        minVisibleMarked = true;
        const elapsedVisibleMs = roundMs(visibleMs());
        markStartup('boot-warp:min-visible-met', {
            visibleMs: elapsedVisibleMs,
            minVisibleMs: timing.minVisibleMs,
        });
        return true;
    };

    const revealTitle = (source) => {
        if (titleRevealed) {
            return;
        }
        titleRevealed = true;
        markStartup('intro:title-reveal-request', { source });
        introAnimation?.revealTitle?.(source);
    };

    const beginFade = () => {
        if (fadePromise) {
            return fadePromise;
        }
        fadePromise = typeof warpTransition.fadeOut === 'function'
            ? warpTransition.fadeOut(timing.fadeOutMs)
            : Promise.resolve();
        return fadePromise;
    };

    const maybeRelease = (source) => {
        if (!shellDismissed) {
            return;
        }
        markMinVisibleIfReady();
        if (visibleMs() < timing.minVisibleMs) {
            return;
        }
        if (latestProgress >= timing.fadeProgress) {
            beginFade();
        }
        if (latestProgress >= timing.titleProgress) {
            revealTitle(source);
        }
    };

    markStartup('boot-warp:handoff-start', {
        durationMs: timing.durationMs,
        minVisibleMs: timing.minVisibleMs,
        requestedDurationMs: timing.requestedDurationMs,
    });

    const playResult = await warpTransition.play({
        durationMs: timing.durationMs,
        onProgress: (progress, state = {}) => {
            latestProgress = progress;
            if (!shellDismissed
                && state.firstFrameRendered !== false
                && progress >= timing.revealProgress) {
                shellDismissed = true;
                visibleStartedAt = nowMs();
                markStartup('boot-warp:visible-start', {
                    progress,
                    durationMs: timing.durationMs,
                    firstFrameRendered: state.firstFrameRendered === true,
                });
                if (!warpAudioStarted) {
                    warpAudioStarted = true;
                    soundManager?.playOneShotFile?.('assets/audio/intro/warp.ogg', { volume: 0.9 });
                }
                markStartup('startup-shell:dismiss-request', { reason: 'warp-handoff' });
                dismissStartupShell?.('warp-handoff', { quick: true });
            }
            maybeRelease('warp-progress');
        },
    });

    const normalizedResult = playResult || {
        status: 'unknown',
        firstFrameRendered: false,
        durationMs: timing.durationMs,
    };

    if (!shellDismissed) {
        const fallbackStatus = {
            ...normalizedResult,
            shellDismissed: false,
            titleRevealed: false,
            visibleMs: 0,
            timing,
        };
        markStartup('boot-warp:handoff-status', fallbackStatus, { level: 'warn' });
        return fallbackStatus;
    }

    const remainingVisibleMs = timing.minVisibleMs - visibleMs();
    if (remainingVisibleMs > 0) {
        await waitMs(remainingVisibleMs, setTimeoutFn);
    }

    markMinVisibleIfReady();
    beginFade();
    revealTitle('warp-progress');
    await fadePromise;

    const elapsedVisibleMs = roundMs(visibleMs());
    performanceMonitor.recordEvent('startup_boot_warp_visible_ms', {
        visibleMs: elapsedVisibleMs,
        minVisibleMs: timing.minVisibleMs,
        durationMs: timing.durationMs,
        status: normalizedResult.status,
    });
    markStartup('boot-warp:visible-duration', {
        visibleMs: elapsedVisibleMs,
        minVisibleMs: timing.minVisibleMs,
        durationMs: timing.durationMs,
    });

    const handoffStatus = {
        ...normalizedResult,
        status: normalizedResult.status || 'complete',
        shellDismissed: true,
        titleRevealed,
        firstFrameRendered: normalizedResult.firstFrameRendered === true,
        visibleMs: elapsedVisibleMs,
        durationMs: timing.durationMs,
        totalHandoffMs: roundMs(nowMs() - startedAt),
        timing,
    };
    markStartup('boot-warp:handoff-status', handoffStatus);
    markStartup('boot-warp:handoff-complete', handoffStatus);
    return handoffStatus;
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
