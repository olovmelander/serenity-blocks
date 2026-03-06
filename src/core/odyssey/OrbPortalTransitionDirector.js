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
    ORB_LOCK: 650,
    PORTAL_BREACH: 850,
    TUNNEL: 1800,
    ARRIVAL_HOLD_BASE: 300,
    ARRIVAL_HOLD_MAX_EXTRA: 1200,
    REVEAL: 600,
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
            this.compositor.setArrivalFlash(0);
            this.compositor.setRevealMask(0);
            this.compositor.setCoverageMode?.('live');

            hooks.prepareGameplayContainers?.();

            // Start readiness tasks immediately in PREPARE to minimize ARRIVAL_HOLD extension.
            const loadingTask = Promise.resolve(
                hooks.loadLevelInBackground?.(levelConfig, { hideBoard: false }),
            )
                .then(() => true)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Background loading failed:', error);
                    degraded = true;
                    return false;
                });

            const themeReadyTask = Promise.resolve(
                deps.themeManager?.waitForThemeReady?.(
                    timings.ORB_LOCK
                    + timings.PORTAL_BREACH
                    + timings.TUNNEL
                    + holdBaseMs
                    + holdMaxExtraMs
                    + 200,
                ) ?? true,
            )
                .then((ready) => !!ready)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] Theme readiness gate failed:', error);
                    degraded = true;
                    return false;
                });

            setState(ORB_PORTAL_STATES.ORB_LOCK);
            this.compositor.showLiveOrbLock?.(portalAnchor);
            hooks.pulseOrbNode?.(levelId);
            const zoomLeadDuration = Math.max(900, timings.ORB_LOCK + 320);
            hooks.startCameraZoom?.(levelId, zoomLeadDuration);
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
            const breachAnchor = this.computePortalAnchor(boardController, levelId);
            this.compositor.setPortalAnchor(breachAnchor);
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

            const totalWarpDuration = timings.PORTAL_BREACH + timings.TUNNEL;
            const warpPromise = this.transitionManager?.playOrbPortal?.({
                duration: totalWarpDuration,
                profile: qualityProfile,
                themeConfig,
                portalAnchor: breachAnchor,
                compositor: this.compositor,
            }) || this.transitionManager?.playWarp?.(totalWarpDuration, themeConfig)
                || wait(totalWarpDuration);

            this.compositor.attachWarpContainer(this.transitionManager?.warpRenderer?.container);

            setState(ORB_PORTAL_STATES.TUNNEL);
            hooks.playTransitionCue?.('breach');
            const warpRushDelayMs = Math.floor(timings.PORTAL_BREACH + (timings.TUNNEL * 0.5));
            setTimeout(() => {
                if (this.isRunning && this.currentState === ORB_PORTAL_STATES.TUNNEL) {
                    hooks.playTransitionCue?.('warpRush');
                }
            }, warpRushDelayMs);

            const warpResult = await warpPromise;
            if (warpResult && warpResult.success === false) {
                degraded = true;
            }

            setState(ORB_PORTAL_STATES.ARRIVAL_HOLD);
            hooks.playTransitionCue?.('arrivalHit');
            this.compositor.setArrivalFlash(0.84);
            this.compositor.setRevealMask(0.2);
            this.compositor.startArrivalHoldAnimation?.();

            hooks.setBoardViewMode?.(false);
            hooks.hideBoardBackdrop?.();
            await hooks.showGameplayView?.({ underPortalFlash: true });
            await hooks.showLevelIntro?.(levelConfig);
            await hooks.startLevel?.();

            const firstGameplayFrameGate = Promise.resolve(
                hooks.waitForFirstGameplayFrame?.(holdBaseMs + holdMaxExtraMs) ?? true,
            )
                .then((ready) => !!ready)
                .catch((error) => {
                    console.warn('[OrbPortalDirector] First gameplay frame gate failed:', error);
                    degraded = true;
                    return false;
                });

            // Hold for a short cinematic beat even if gates are already ready.
            await wait(holdBaseMs);

            const gateResults = await withTimeout(
                Promise.all([loadingTask, themeReadyTask, firstGameplayFrameGate]),
                holdMaxExtraMs,
                [false, false, false],
            );

            const [boardReady, themeReady, firstGameplayFrame] = gateResults;
            if (!boardReady || !themeReady || !firstGameplayFrame) {
                degraded = true;
                console.warn('[OrbPortalDirector] Readiness gate timeout/degradation', {
                    boardReady,
                    themeReady,
                    firstGameplayFrame,
                });
            }

            setState(ORB_PORTAL_STATES.REVEAL);
            this.transitionManager?.warpRenderer?.hideContainer?.();
            await this.compositor.playReveal(timings.REVEAL);
            await this.compositor.hide(140);

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
            return { success: false, degraded, error };
        } finally {
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
            };
        }

        return {
            chapterColor: new THREE.Color(0x00ccff),
            accentColor: new THREE.Color(0xff55aa),
        };
    }

    computePortalAnchor(boardController, levelId) {
        if (!boardController?.nodeManager || !boardController?.camera) {
            return { x: 0.5, y: 0.5, radius: 0.16 };
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
