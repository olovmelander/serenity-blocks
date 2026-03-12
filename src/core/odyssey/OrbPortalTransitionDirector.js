import * as THREE from 'three';
import { OrbPortalCompositor } from '../../rendering/transitions/OrbPortalCompositor.js';
import { resolveWarpQualityProfile } from '../../rendering/transitions/warp-quality-profiles.js';

export const ORB_PORTAL_STATES = Object.freeze({
    PREPARE: 'PREPARE',
    ORB_LOCK: 'ORB_LOCK',
    PORTAL_BREACH: 'PORTAL_BREACH',
    TUNNEL: 'TUNNEL',
    ARRIVAL_HOLD: 'ARRIVAL_HOLD',
    REVEAL: 'REVEAL',
    CLEANUP: 'CLEANUP',
});

const BASE_TIMINGS = Object.freeze({
    // Phase 1: The Gathering (dolly zoom + squish)
    ORB_LOCK: 800,
    // Phase 2: Ignition & Fracture (flash + handover)
    PORTAL_BREACH: 300,
    // Phase 3: Hyperspace Glide (smooth transit)
    TUNNEL: 1600,
    // Phase 4 & 5: Atmospheric Re-entry & Landing
    ARRIVAL_HOLD_BASE: 900,
    ARRIVAL_HOLD_MAX_EXTRA: 500,
    REVEAL: 0, // Merged into the arrival burn-away
});

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function withTimeout(promise, timeoutMs, fallbackValue = false) {
    let timerId = null;

    return Promise.race([
        Promise.resolve(promise)
            .then((value) => {
                if (timerId) clearTimeout(timerId);
                return value;
            })
            .catch(() => {
                if (timerId) clearTimeout(timerId);
                return fallbackValue;
            }),
        new Promise((resolve) => {
            timerId = setTimeout(() => resolve(fallbackValue), timeoutMs);
        }),
    ]);
}

function scheduleFrame(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        return globalThis.requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(typeof performance !== 'undefined' ? performance.now() : Date.now()), 16);
}

function cancelFrame(frameId) {
    if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(frameId);
        return;
    }
    clearTimeout(frameId);
}

/**
 * Utility for projecting a world-space point to normalized screen-space.
 * Exported for deterministic testing.
 */
export function projectWorldToNormalizedScreen(worldPosition, camera) {
    if (!worldPosition || !camera) {
        return { x: 0.5, y: 0.5, onScreen: false };
    }

    const projected = worldPosition.clone().project(camera);
    const x = (projected.x + 1) * 0.5;
    const y = (1 - projected.y) * 0.5;
    const onScreen = projected.z >= -1 && projected.z <= 1 && x >= 0 && x <= 1 && y >= 0 && y <= 1;

    return { x, y, onScreen };
}

/**
 * Deterministic state-machine transition controller for Odyssey level entry.
 */
export class OrbPortalTransitionDirector {
    constructor({ transitionManager = null, compositor = null } = {}) {
        this.transitionManager = transitionManager;
        this.compositor = compositor || new OrbPortalCompositor();
        this.currentState = null;
        this.isRunning = false;
    }

    async startLevelEntry({
        levelId,
        levelConfig,
        boardController,
        deps = {},
        qualityPreset = 'High',
    }) {
        if (this.isRunning) {
            return { success: false, degraded: true, reason: 'already-running' };
        }

        this.isRunning = true;
        let degraded = false;
        let warpRushTimerId = null;

        const hooks = deps.modeHooks || {};
        const timings = {
            ...BASE_TIMINGS,
            ...(deps.timings || {}),
        };
        // Compatibility with previous single ARRIVAL_HOLD_MAX timing override.
        const incomingTimings = deps.timings || {};
        const hasLegacyHold = Object.prototype.hasOwnProperty.call(incomingTimings, 'ARRIVAL_HOLD_MAX');
        const hasNewHold = Object.prototype.hasOwnProperty.call(incomingTimings, 'ARRIVAL_HOLD_MAX_EXTRA');
        if (hasLegacyHold && !hasNewHold && Number.isFinite(timings.ARRIVAL_HOLD_MAX)) {
            timings.ARRIVAL_HOLD_MAX_EXTRA = Math.max(
                0,
                timings.ARRIVAL_HOLD_MAX - (timings.ARRIVAL_HOLD_BASE || BASE_TIMINGS.ARRIVAL_HOLD_BASE),
            );
        }

        const setState = (state) => {
            this.currentState = state;
            hooks.onStateChange?.(state);
            console.log(`[OrbPortalDirector] State: ${state}`);
        };

        try {
            setState(ORB_PORTAL_STATES.PREPARE);

            const portalAnchor = this.computePortalAnchor(boardController, levelId);
            const themeConfig = this.buildThemeConfig(levelConfig, boardController);
            const qualityProfile = resolveWarpQualityProfile(qualityPreset);
            const holdBaseMs = timings.ARRIVAL_HOLD_BASE;
            const holdMaxExtraMs = timings.ARRIVAL_HOLD_MAX_EXTRA;

            this.compositor.setPortalAnchor(portalAnchor);
            this.compositor.setArrivalPalette?.(themeConfig);
            this.compositor.setArrivalFlash(0);
            this.compositor.setArrivalSilhouette?.(0);
            this.compositor.setRevealMask(0);
            this.compositor.setCoverageMode?.('live');

            const prepareContainersTask = Promise.resolve(
                hooks.prepareGameplayContainers?.() ?? true,
            )
                .then((ready) => ready !== false)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Gameplay container preparation failed:', error);
                    degraded = true;
                    return false;
                });

            const prefetchTask = Promise.resolve(
                hooks.prefetchLevelAssets?.(levelConfig)
                ?? hooks.loadLevelInBackground?.(levelConfig, { hideBoard: false })
                ?? true,
            )
                .then((ready) => ready !== false)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Asset prefetch failed:', error);
                    degraded = true;
                    return false;
                });

            setState(ORB_PORTAL_STATES.ORB_LOCK);
            this.compositor.showLiveOrbLock?.(portalAnchor);
            hooks.pulseOrbNode?.(levelId);
            hooks.startCameraZoom?.(levelId, timings.ORB_LOCK);
            hooks.playTransitionCue?.('orbCharge');
            let anchorTrackerId = null;
            const trackLiveAnchor = () => {
                if (!this.isRunning || this.currentState !== ORB_PORTAL_STATES.ORB_LOCK) {
                    return;
                }
                const liveAnchor = this.computePortalAnchor(boardController, levelId);
                this.compositor.setPortalAnchor(liveAnchor);
                anchorTrackerId = scheduleFrame(trackLiveAnchor);
            };
            trackLiveAnchor();
            await wait(timings.ORB_LOCK);
            if (anchorTrackerId !== null) {
                cancelFrame(anchorTrackerId);
                anchorTrackerId = null;
            }

            setState(ORB_PORTAL_STATES.PORTAL_BREACH);
            this.compositor.hideLiveOrbLock?.(90);
            boardController?.renderOnce?.(1 / 60);
            const breachAnchor = this.computePortalAnchor(boardController, levelId);
            const snapshotCanvas = boardController?.captureFrame?.();
            const shown = this.compositor.showWithSnapshot?.(snapshotCanvas, breachAnchor);
            if (shown === false) {
                degraded = true;
                this.compositor.setPortalAnchor(breachAnchor);
                this.compositor.setCoverageMode?.('frozen');
                this.compositor.setBoardSnapshot(snapshotCanvas);
                this.compositor.show({ allowWithoutSnapshot: true });
            }
            boardController?.pauseRendering?.();
            hooks.hideGameUIForTransition?.();

            const themeVisualsTask = Promise.resolve(
                hooks.activateThemeVisuals?.(levelConfig)
                ?? deps.themeManager?.waitForThemeReady?.(
                    timings.PORTAL_BREACH + timings.TUNNEL + holdBaseMs + holdMaxExtraMs,
                )
                ?? true,
            )
                .then((ready) => ready !== false)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Theme activation failed:', error);
                    degraded = true;
                    return false;
                });

            const totalWarpDuration = timings.PORTAL_BREACH + timings.TUNNEL;
            this.compositor.attachWarpContainer(this.transitionManager?.warpRenderer?.container);
            const warpPromise = this.transitionManager?.playOrbPortal?.({
                duration: totalWarpDuration,
                profile: qualityProfile,
                themeConfig,
                portalAnchor: breachAnchor,
                compositor: this.compositor,
            }) || this.transitionManager?.playWarp?.(totalWarpDuration, themeConfig)
                || wait(totalWarpDuration);

            setState(ORB_PORTAL_STATES.TUNNEL);
            hooks.playTransitionCue?.('breach');
            const warpRushDelayMs = Math.floor(timings.PORTAL_BREACH + (timings.TUNNEL * 0.5));
            warpRushTimerId = setTimeout(() => {
                if (this.isRunning && this.currentState === ORB_PORTAL_STATES.TUNNEL) {
                    hooks.playTransitionCue?.('warpRush');
                }
            }, warpRushDelayMs);

            hooks.setBoardViewMode?.(false);
            const gameplayPrepareTask = Promise.all([prepareContainersTask, prefetchTask])
                .then(async ([containersReady]) => {
                    if (!containersReady) {
                        return false;
                    }
                    const prepared = await Promise.resolve(hooks.prepareGameplayReveal?.(levelConfig) ?? true);
                    return prepared !== false;
                })
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Gameplay preparation failed:', error);
                    degraded = true;
                    return false;
                });

            const gameplayBootstrapTask = Promise.all([themeVisualsTask, gameplayPrepareTask])
                .then(async ([themeReady, gameplayPrepared]) => {
                    if (!themeReady || !gameplayPrepared) {
                        return false;
                    }

                    const introTask = Promise.resolve(hooks.showLevelIntro?.(levelConfig))
                        .catch((error) => {
                            console.warn('[OrbPortalDirector] Level intro failed:', error);
                            degraded = true;
                            return false;
                        });

                    const levelStarted = await Promise.resolve(hooks.startLevel?.() ?? true)
                        .then((value) => value !== false)
                        .catch((error) => {
                            console.warn('[OrbPortalDirector] Gameplay bootstrap failed:', error);
                            degraded = true;
                            return false;
                        });

                    await introTask;
                    return levelStarted;
                });

            const firstGameplayCompositeTask = gameplayBootstrapTask.then((bootstrapped) => {
                if (!bootstrapped) {
                    return false;
                }
                return Promise.resolve(
                    hooks.confirmFirstGameplayComposite?.(holdBaseMs + holdMaxExtraMs)
                    ?? hooks.waitForFirstGameplayFrame?.(holdBaseMs + holdMaxExtraMs)
                    ?? true,
                )
                    .then((ready) => !!ready)
                    .catch((error) => {
                        console.warn('[OrbPortalDirector] First gameplay composite gate failed:', error);
                        degraded = true;
                        return false;
                    });
            });

            const warpResult = await warpPromise;
            if (warpResult && warpResult.success === false) {
                degraded = true;
            }

            setState(ORB_PORTAL_STATES.ARRIVAL_HOLD);
            hooks.playTransitionCue?.('arrivalHit');
            this.compositor.setArrivalFlash(0.76);
            this.compositor.setArrivalSilhouette?.(0.42);
            this.compositor.setRevealMask(0.14);
            this.compositor.startArrivalHoldAnimation?.();
            const gameplayViewTask = Promise.resolve(
                hooks.showGameplayView?.({ underPortalFlash: true }) ?? true,
            )
                .then((ready) => ready !== false)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Gameplay view reveal failed:', error);
                    degraded = true;
                    return false;
                });

            // Hold for a short cinematic beat even if gates are already ready.
            await wait(holdBaseMs);

            const gateResults = await withTimeout(
                Promise.all([
                    prefetchTask,
                    themeVisualsTask,
                    gameplayViewTask,
                    firstGameplayCompositeTask,
                ]),
                holdMaxExtraMs,
                [false, false, false, false],
            );

            const [
                assetsPrefetched,
                themeVisualsStable,
                gameplayContainersReady,
                firstGameplayFrame,
            ] = gateResults;
            if (!assetsPrefetched || !themeVisualsStable || !gameplayContainersReady || !firstGameplayFrame) {
                degraded = true;
                console.warn('[OrbPortalDirector] Readiness gate timeout/degradation', {
                    assetsPrefetched,
                    themeVisualsStable,
                    gameplayContainersReady,
                    firstGameplayFrame,
                });
            }

            setState(ORB_PORTAL_STATES.REVEAL);
            this.transitionManager?.warpRenderer?.hideContainer?.();
            this.compositor?.playReveal?.(0); // instant cleanup

            setState(ORB_PORTAL_STATES.CLEANUP);
            this.compositor.clear();
            hooks.scheduleBoardDispose?.();

            return { success: true, degraded };
        } catch (error) {
            console.error('[OrbPortalDirector] Transition failed, aborting to safe fallback:', error);
            degraded = true;
            this.compositor.clear();
            await this.compositor.hide(120);
            boardController?.resumeRendering?.();
            hooks.restoreUIAfterAbort?.();
            return { success: false, degraded, error };
        } finally {
            if (warpRushTimerId) {
                clearTimeout(warpRushTimerId);
            }
            this.currentState = null;
            this.isRunning = false;
        }
    }

    buildThemeConfig(levelConfig, boardController) {
        const chapterId = levelConfig?.chapter || 1;
        const chapterColor = boardController?.nodeManager?.getChapterColor?.(chapterId);

        if (chapterColor instanceof THREE.Color) {
            return {
                chapterColor: chapterColor.clone(),
                accentColor: chapterColor.clone().offsetHSL(0.13, 0.05, 0.08),
                shadowColor: chapterColor.clone().offsetHSL(0.02, 0.08, -0.26),
            };
        }

        return {
            chapterColor: new THREE.Color(0x00ccff),
            accentColor: new THREE.Color(0xff55aa),
            shadowColor: new THREE.Color(0x113355),
        };
    }

    computePortalAnchor(boardController, levelId) {
        if (!boardController?.nodeManager || !boardController?.camera) {
            return { x: 0.5, y: 0.5, radius: 0.16 };
        }

        const cinematicMetrics = boardController.nodeManager.getNodeCinematicMetrics?.(
            levelId,
            boardController.camera,
        );
        if (cinematicMetrics) {
            return {
                x: Math.max(0.05, Math.min(0.95, cinematicMetrics.center.x)),
                y: Math.max(0.05, Math.min(0.95, cinematicMetrics.center.y)),
                radius: cinematicMetrics.onScreen
                    ? Math.max(0.06, Math.min(0.28, cinematicMetrics.radius * 1.08))
                    : 0.16,
            };
        }

        const nodePos = boardController.nodeManager.getNodePosition?.(levelId);
        if (!nodePos) {
            return { x: 0.5, y: 0.5, radius: 0.16 };
        }

        const projected = projectWorldToNormalizedScreen(nodePos, boardController.camera);

        return {
            x: Math.max(0.05, Math.min(0.95, projected.x)),
            y: Math.max(0.05, Math.min(0.95, projected.y)),
            radius: projected.onScreen ? 0.14 : 0.16,
        };
    }

    dispose() {
        this.compositor?.dispose?.();
    }
}

export default OrbPortalTransitionDirector;
