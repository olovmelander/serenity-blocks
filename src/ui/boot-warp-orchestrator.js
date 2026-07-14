import { performanceMonitor } from '../utils/performance-monitor.js';
import { markStartup } from './startup-debug.js';
import {
    BOOT_WARP_MAX_PREWARM_ATTEMPTS,
    BOOT_WARP_PREWARM_TIMEOUT_MS,
    BOOT_WARP_REQUIRED_TITLE_SAFETY_MS,
    playBootWarpHandoff,
    waitForIntroRendererDecision,
    waitForStartupThemeIdle,
} from './boot-warp-startup.js';

function recordBootWarpSkip(reason, details = {}, level = undefined) {
    const payload = { reason, ...details };
    performanceMonitor.recordEvent('startup_boot_warp_skipped', payload);
    markStartup('boot-warp:skip', payload, level ? { level } : undefined);
}

/**
 * Own the optional WebGPU boot-warp lifecycle from support decision through
 * prewarm, playback, and CSS fallback. Main only coordinates the surrounding
 * intro states; every warp resource is registered with the startup controller.
 */
export async function playBootWarpStartupSequence(options = {}) {
    const {
        app = null,
        urlParams = null,
        introAnimation = null,
        soundManager = null,
        dismissStartupShell = null,
        isStartupShellDismissed = () => false,
        startupPipeline,
    } = options;
    const waitForStep = startupPipeline?.waitForStep || ((value) => Promise.resolve(value));
    const signal = startupPipeline?.signal || null;
    let surfaceReadyPromise = Promise.resolve();
    const requestCssFallback = () => {
        markStartup('startup-shell:dismiss-request', { reason: 'intro-begin-css-fallback' });
        surfaceReadyPromise = Promise.resolve(dismissStartupShell?.('intro-begin'));
        return surfaceReadyPromise;
    };
    let warpTransition = null;
    let handoffResult = {
        status: 'css-fallback',
        shellDismissed: false,
        firstFrameRendered: false,
    };

    try {
        const { BootWarpTransition } = await import('./boot-warp-transition.js');
        const bootWarpSupported = !signal?.aborted && BootWarpTransition.isSupported(urlParams);
        markStartup('boot-warp:support-check', { supported: bootWarpSupported });
        if (!bootWarpSupported) {
            const reason = signal?.aborted ? 'startup-pipeline-aborted' : 'unsupported-or-disabled';
            recordBootWarpSkip(reason);
            console.info('[Startup] Boot warp skipped:', reason);
        }

        if (bootWarpSupported) {
            introAnimation?.postponeTitleSafety?.(BOOT_WARP_REQUIRED_TITLE_SAFETY_MS);
            markStartup('boot-warp:title-safety-held', {
                ms: BOOT_WARP_REQUIRED_TITLE_SAFETY_MS,
            });
            markStartup('boot-warp:intro-decision-start');
            const introWarpDecision = await waitForStep(
                waitForIntroRendererDecision(introAnimation),
                { canAttemptWarp: false, reason: 'startup-pipeline-aborted' },
            );
            markStartup('boot-warp:intro-decision-complete', introWarpDecision);

            if (introWarpDecision.canAttemptWarp) {
                const getStartupTheme = () => app?.themeManager?.pendingThemeInstance
                    || app?.themeManager?.activeTheme
                    || null;
                markStartup('boot-warp:theme-wait-start');
                const themeIdleState = await waitForStep(
                    waitForStartupThemeIdle(getStartupTheme, {
                        signal,
                        onProgress: (event, state) => {
                            const level = event === 'still-busy' ? 'warn' : undefined;
                            markStartup(`boot-warp:theme-wait-${event}`, state, { level });
                            if (event === 'still-busy') {
                                introAnimation?.postponeTitleSafety?.(
                                    BOOT_WARP_REQUIRED_TITLE_SAFETY_MS,
                                );
                                console.info('[Startup] Waiting for startup theme before warp', state);
                            }
                        },
                    }),
                    { aborted: true },
                );
                markStartup('boot-warp:theme-ready', themeIdleState);

                const retryableStatuses = new Set([
                    'prewarm-timeout',
                    'prewarm-exception',
                    'setup-failed',
                    'webgpu-init-failed',
                ]);
                let prewarmAttempt = 0;

                while (!signal?.aborted
                    && !warpTransition
                    && prewarmAttempt < BOOT_WARP_MAX_PREWARM_ATTEMPTS) {
                    prewarmAttempt += 1;
                    const prewarmTimeoutMs = Math.min(
                        BOOT_WARP_PREWARM_TIMEOUT_MS + ((prewarmAttempt - 1) * 3500),
                        20000,
                    );
                    const candidate = new BootWarpTransition({
                        device: introAnimation?.getWebGPUDevice?.() || null,
                    });
                    startupPipeline?.trackVisual?.(candidate);
                    markStartup('boot-warp:prewarm-requested', {
                        attempt: prewarmAttempt,
                        sharedDevice: Boolean(introAnimation?.getWebGPUDevice?.()),
                        timeoutMs: prewarmTimeoutMs,
                    });
                    // eslint-disable-next-line no-await-in-loop -- retry attempts are sequential
                    const primed = await waitForStep(
                        candidate.prewarm({ timeoutMs: prewarmTimeoutMs }),
                        false,
                    );
                    markStartup('boot-warp:prewarm-result', {
                        attempt: prewarmAttempt,
                        primed,
                        status: candidate.lastPrewarmStatus,
                    });

                    if (primed && !signal?.aborted) {
                        warpTransition = candidate;
                        introAnimation?.postponeTitleSafety?.(20000);
                        performanceMonitor.recordEvent('startup_boot_warp_committed', {
                            introDecision: introWarpDecision.reason,
                            attempt: prewarmAttempt,
                            timeoutMs: prewarmTimeoutMs,
                        });
                        markStartup('boot-warp:committed', {
                            introDecision: introWarpDecision.reason,
                            attempt: prewarmAttempt,
                            timeoutMs: prewarmTimeoutMs,
                        });
                    } else {
                        const status = candidate.lastPrewarmStatus || 'prewarm-failed';
                        startupPipeline?.releaseVisual?.(candidate);
                        candidate.dispose();
                        if (!retryableStatuses.has(status)) {
                            recordBootWarpSkip(status, {
                                introDecision: introWarpDecision.reason,
                                attempt: prewarmAttempt,
                            }, 'warn');
                            console.info('[Startup] Boot warp unavailable:', status);
                            break;
                        }

                        markStartup('boot-warp:prewarm-retry', {
                            reason: status,
                            attempt: prewarmAttempt,
                        }, { level: 'warn' });
                        if (prewarmAttempt < BOOT_WARP_MAX_PREWARM_ATTEMPTS) {
                            // eslint-disable-next-line no-await-in-loop -- retry attempts are sequential
                            await waitForStep(waitForStartupThemeIdle(getStartupTheme, {
                                signal,
                                onProgress: (event, state) => {
                                    if (event !== 'still-busy') return;
                                    introAnimation?.postponeTitleSafety?.(
                                        BOOT_WARP_REQUIRED_TITLE_SAFETY_MS,
                                    );
                                    markStartup(
                                        'boot-warp:theme-wait-still-busy',
                                        state,
                                        { level: 'warn' },
                                    );
                                },
                            }));
                        }
                    }
                }

                if (!warpTransition && prewarmAttempt >= BOOT_WARP_MAX_PREWARM_ATTEMPTS) {
                    recordBootWarpSkip('prewarm-retries-exhausted', {
                        attempts: prewarmAttempt,
                    }, 'warn');
                }
            } else {
                recordBootWarpSkip(introWarpDecision.reason, {}, 'warn');
            }
        }
    } catch (error) {
        console.warn('[Startup] Boot warp prewarm failed; using CSS reveal:', error);
        recordBootWarpSkip('prewarm-exception', {
            message: error?.message || String(error),
        }, 'warn');
        startupPipeline?.disposeVisuals?.();
        warpTransition = null;
    }

    if (!warpTransition) {
        requestCssFallback();
        return { ...handoffResult, surfaceReadyPromise };
    }

    try {
        handoffResult = await waitForStep(
            playBootWarpHandoff({
                warpTransition,
                urlParams,
                introAnimation,
                soundManager,
                dismissStartupShell,
                signal,
            }),
            {
                status: 'startup-pipeline-aborted',
                shellDismissed: isStartupShellDismissed(),
                firstFrameRendered: false,
            },
        );
        if (!handoffResult.shellDismissed) {
            markStartup('boot-warp:handoff-fallback', {
                status: handoffResult.status,
                firstFrameRendered: handoffResult.firstFrameRendered,
            }, { level: 'warn' });
            requestCssFallback();
        }
    } catch (error) {
        console.warn('[Startup] Boot warp play failed:', error);
        performanceMonitor.recordEvent('startup_boot_warp_play_failed', {
            message: error?.message || String(error),
        });
        markStartup('boot-warp:play-failed', {
            message: error?.message || String(error),
        }, { level: 'warn' });
        if (!isStartupShellDismissed()) requestCssFallback();
        handoffResult = {
            status: 'play-failed',
            shellDismissed: isStartupShellDismissed(),
            firstFrameRendered: false,
        };
    } finally {
        startupPipeline?.releaseVisual?.(warpTransition);
        warpTransition.dispose();
    }

    return { ...handoffResult, surfaceReadyPromise };
}
