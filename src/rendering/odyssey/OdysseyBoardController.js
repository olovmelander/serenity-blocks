/**
 * @fileoverview OdysseyBoardController - Three.js Odyssey Board Scene
 *
 * Main controller for the Odyssey Mode level selection board.
 * Renders the 3D Odyssey path with themed level nodes.
 */

import * as THREE from 'three/webgpu';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import { LevelNodeManager } from './LevelNodeManager.js';
import { OdysseyCameraController } from './OdysseyCameraController.js';
import { ChapterEnvironmentManager } from './ChapterEnvironmentManager.js';
import { ODYSSEY_PATH_DATA } from './path-data.js';
import { OdysseyTslPipeline } from './odyssey-post/odyssey-tsl-pipeline.js';
import { OdysseyDirector } from './composition/OdysseyDirector.js';
import { OdysseyAudioReactor } from './composition/OdysseyAudioReactor.js';
import { OdysseyAtmosphere } from './composition/OdysseyAtmosphere.js';
import { OdysseyCorridorField } from './composition/odyssey-corridor-field.js';
import { OdysseyDebugOverlay, isOdysseyAAADebugEnabled } from './composition/odyssey-debug-overlay.js';
import { OdysseyAdaptiveQuality } from './composition/OdysseyAdaptiveQuality.js';
import { ChapterThresholdDirector, getOdysseyThresholdProfile } from './transitions/ChapterThresholdDirector.js';
import { getChapterProfile } from './chapter-environments/shared/chapter-profile.js';
import { resetOdysseyPathLayout, setOdysseyPathLayout } from './path-utils.js';
import {
    applyOdysseyLayoutToLevels,
    buildOdysseyPresentationLayout,
    normalizeOdysseyLayoutData,
    ODYSSEY_LAYOUT_DATA,
} from '../../core/odyssey/data/odyssey-layout.js';
import {
    findScrollableWheelTarget as findSharedScrollableWheelTarget,
    findWheelLockTarget as findSharedWheelLockTarget,
    normalizeWheelDeltaToPixels,
    shouldCaptureWheelEvent,
} from '../../utils/wheel-routing.js';
import {
    computeScenePixelRatio,
    evaluateDynamicResolutionAdjustment,
} from '../../utils/desktop-performance-policy.js';

// Dynamic-resolution (DRS) tuning. The odyssey board pins a static pixel ratio at
// init/resize; here we wire the existing frame-time policy so render scale sheds under
// load and recovers when headroom returns. The policy itself enforces 6s-down/12s-up
// cooldowns + a 0.5..1.25 clamp, so we only need a rolling frame-time window + a 1Hz
// evaluation tick (NEVER per-frame — re-allocating the scene RT every frame can black-frame).
const ODYSSEY_MAX_PIXEL_RATIO = 1.2; // QW3: lowered 1.5 -> 1.2; the heavy grade/grain masks it.
const DRS_FRAME_WINDOW = 60; // rolling frames used for the p95/p99 estimate.
const DRS_EVAL_INTERVAL_MS = 1000; // evaluate at ~1Hz (policy cooldowns gate actual changes).
const DRS_TARGET_FRAME_RATE = 60;

/**
 * Quality presets for the Odyssey Board
 */
const QUALITY_PRESETS = {
    Minimal: {
        enableBloom: false, bloomStrength: 0.3, particleCount: 100, starCount: 300,
    },
    Low: {
        enableBloom: true, bloomStrength: 0.4, particleCount: 200, starCount: 500,
    },
    Medium: {
        enableBloom: true, bloomStrength: 0.5, particleCount: 400, starCount: 800,
    },
    High: {
        enableBloom: true, bloomStrength: 0.6, particleCount: 600, starCount: 1200,
    },
    Ultra: {
        enableBloom: true, bloomStrength: 0.7, particleCount: 900, starCount: 1800,
    },
    Extreme: {
        enableBloom: true, bloomStrength: 0.8, particleCount: 1200, starCount: 2500,
    },
};

const ODYSSEY_WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
const ODYSSEY_WHEEL_CAPTURE_OPTIONS = { capture: true, passive: false };
const ODYSSEY_WHEEL_LOCK_ATTRIBUTES = [ODYSSEY_WHEEL_LOCK_ATTRIBUTE, 'data-wheel-lock'];

function derivePresentationLayout(levelData = [], presentationLayout = null, layoutOverride = null) {
    const fallbackLevelPositionsById = Object.fromEntries(
        levelData
            .filter((level) => Number.isFinite(level?.id) && Number.isFinite(level?.pathPosition))
            .map((level) => [level.id, level.pathPosition]),
    );
    const fallbackLayout = {
        controlPoints: presentationLayout?.controlPoints
            || layoutOverride?.controlPoints
            || ODYSSEY_LAYOUT_DATA.controlPoints,
        levelPositionsById: {
            ...ODYSSEY_LAYOUT_DATA.levelPositionsById,
            ...fallbackLevelPositionsById,
        },
    };
    const sourceLayout = {
        controlPoints: layoutOverride?.controlPoints
            || presentationLayout?.controlPoints
            || fallbackLayout.controlPoints,
        levelPositionsById: {
            ...fallbackLayout.levelPositionsById,
            ...(presentationLayout?.levelPositionsById || {}),
            ...(layoutOverride?.levelPositionsById || {}),
        },
    };

    return buildOdysseyPresentationLayout(
        levelData,
        normalizeOdysseyLayoutData(sourceLayout, fallbackLayout, levelData),
    );
}

function resolveStyleForElement(element) {
    if (typeof getComputedStyle !== 'function' || !element) {
        return null;
    }

    try {
        return getComputedStyle(element);
    } catch {
        return null;
    }
}

export function findWheelLockTarget(target) {
    return findSharedWheelLockTarget(target, ODYSSEY_WHEEL_LOCK_ATTRIBUTES);
}

export function findScrollableWheelTarget(target, styleResolver = resolveStyleForElement) {
    return findSharedScrollableWheelTarget(target, styleResolver);
}

export function normalizeOdysseyWheelDelta(event, viewportHeight = null) {
    return normalizeWheelDeltaToPixels(event, {
        lineHeight: 16,
        pageHeight: viewportHeight,
        clampPx: 240,
    }) * 0.001;
}

function isPointInsideRect(x, y, rect) {
    if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) {
        return false;
    }

    return x >= rect.left
        && x <= rect.right
        && y >= rect.top
        && y <= rect.bottom;
}

export function shouldRouteOdysseyWheel({
    isActive,
    isRenderingPaused,
    containerRect,
    target,
    clientX,
    clientY,
    styleResolver = resolveStyleForElement,
}) {
    if (!isActive || isRenderingPaused || !containerRect) {
        return false;
    }

    if (!isPointInsideRect(clientX, clientY, containerRect)) {
        return false;
    }

    if (!shouldCaptureWheelEvent({
        event: {
            target,
            clientX,
            clientY,
        },
        styleResolver,
        attributeNames: ODYSSEY_WHEEL_LOCK_ATTRIBUTES,
    })) {
        return false;
    }

    return true;
}

/**
 * OdysseyBoardController - Main Three.js scene for level selection
 */
export class OdysseyBoardController {
    constructor(container, options = {}) {
        this.container = container;
        this.editorMode = !!options.editorMode;
        this.layoutOverride = options.layoutOverride || null;
        this.cinematicJourneyActive = options.cinematicJourneyActive !== false;
        // Master gate for the adaptive-quality controller. Default on; callers (or a future
        // settings toggle) can pass `adaptiveQuality:false` to pin the preset quality and let
        // the user's manual quality choice stand untouched. The Tier-1/2 post knobs only make
        // sense with the cinematic post stack, so the loop also gates on cinematicJourneyActive.
        this.adaptiveQualityEnabled = options.adaptiveQuality !== false;
        this.debugOverlayActive = false;
        const globalSoundManager = typeof window !== 'undefined' ? window.soundManager : null;
        this.soundManager = options.soundManager || globalSoundManager || null;

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.clock = new THREE.Clock();

        // Sub-controllers
        this.pathRenderer = null;
        this.nodeManager = null;
        this.cameraController = null;
        this.environmentManager = null;

        // Cinematic journey spine (director + audio + optional debug overlay).
        this.director = null;
        this.audioReactor = null;
        this.debugOverlay = null;
        this.atmosphere = null; // Director-driven global atmosphere.
        this.corridorField = null; // Parallax mid/far corridor depth filler (void fix).
        this.thresholdDirector = null; // Authored chapter breaches.

        // Enhanced post-processing
        this.postProcessingStack = null;
        this.aaaPostActive = false; // Cinematic OdysseyFallbackPipeline toggle.
        this.qualityName = 'High';

        // State
        this.isActive = false;
        this.isRenderingPaused = false;
        this.animationFrameId = null;
        this.time = 0;
        this.selectedLevelId = null;
        this.hoveredLevelId = null;

        // Quality
        this.qualityPreset = QUALITY_PRESETS.High;

        // Event callbacks
        this.onLevelSelect = null;
        this.onLevelHover = null;
        this.onEmptyClick = null; // Called when clicking on empty space (no node)
        this.onChapterArrival = null; // Called when scrolling arrives in a chapter

        // Raycaster for interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Background elements
        this.stars = null;
        this.nebulaMesh = null;
        this.ambientParticles = null;

        // Interaction/performance tracking
        this.lastInteractionAt = performance.now();
        this.backgroundLoadQuietWindowMs = 700;

        // ── Adaptive quality (Wave 2). One controller owns the whole degrade ladder:
        // Tier 0 resolution (subsumes the old inline QW2 DRS call — there is no longer a
        // second competing resolution controller), Tier 1 bloom, Tier 2 post extras. It
        // reacts to MEASURED frame time, sheds cheapest-first, restores slowest-first, with
        // hysteresis. `_drs` is kept ONLY as the live render-scale the resize paths read
        // (initRenderer / onResize / _applyRenderScale); the controller is the brain and the
        // single source of truth for whether/when the scale changes. `renderScale` here is
        // the per-preset CEILING; the controller rides between it and the policy floor.
        this._drs = {
            renderScale: 1, // current live render scale (1 = full per-tier odyssey cap).
            baselineRenderScale: 1, // ceiling the adaptive controller rides back up to.
        };
        this.adaptiveQuality = new OdysseyAdaptiveQuality({
            enabled: this.adaptiveQualityEnabled,
            targetFrameRate: DRS_TARGET_FRAME_RATE,
            windowSize: DRS_FRAME_WINDOW,
            evalIntervalMs: DRS_EVAL_INTERVAL_MS,
            baselineRenderScale: this._drs.baselineRenderScale,
            renderScale: this._drs.renderScale,
            evaluateResolution: evaluateDynamicResolutionAdjustment,
        });
        // Reused ctx for the per-frame adaptive update (NO per-frame allocation). applyRenderScale
        // is bound once; pipeline is refreshed lazily in the loop (it is built after this).
        this._adaptiveCtx = {
            applyRenderScale: (scale) => this._applyRenderScale(scale),
            pipeline: null,
        };

        // ── Per-frame work gating / throttle state (Batch5).
        // Position-derived work (visibility/blend-state/corridor parallax) is throttled to
        // ~30Hz when the camera is settled and no seam is active; time-driven uniform ticks
        // (env.update / pathRenderer / atmosphere drift) stay at 60Hz.
        this.positionWorkIntervalMs = 33; // ~30Hz cap for position-derived work when settled.
        this.lastPositionWorkAtMs = 0;
        this.lastActiveChapter = 1; // last resolved active chapter (gates BH ch7 work).
        this.cameraSettledThreshold = 0.0008;
        this.globalEnvProgressThreshold = 0.0005;
        this.globalEnvMaxIntervalMs = 33;
        this.lastGlobalEnvUpdateTime = 0;
        this.lastGlobalEnvUpdateProgress = Number.NaN;
        this.globalAmbientLight = null;
        this.prewarmQueue = [];
        this.queuedPrewarmChapters = new Set();
        this.isPrewarming = false;
        this.prewarmDrainTimer = null;
        this.pendingChapterLoads = new Set();
        this.selectionSequence = 0;
        this.activeSeamBoundaryId = null;
        this.seamMusicBoundaryId = null;
        this.lastCameraProgress = 0;
        this.levelData = [];
        this.progressData = null;
        this.layoutEditor = null;
        this.presentationLayout = derivePresentationLayout();
        this.interactionAttached = false;
        // Debounce resize to prevent F11/fullscreen freeze from sync GPU ops
        let resizeTimer;
        const debouncedResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.onResize(), 150);
        };
        this.boundHandlers = {
            mousemove: this.onMouseMove.bind(this),
            click: this.onClick.bind(this),
            wheel: this.onWheel.bind(this),
            touchstart: this.onTouchStart.bind(this),
            touchmove: this.onTouchMove.bind(this),
            touchend: this.onTouchEnd.bind(this),
            resize: debouncedResize,
        };

        console.log('[OdysseyBoard] Controller created');
    }

    // =============================
    // Lifecycle
    // =============================

    /**
     * Initialize the odyssey board
     * Structured to yield to the main thread between heavy steps
     * so the loading overlay CSS animations stay smooth.
     *
     * @param {Object} levelData - Level configurations
     * @param {Object} progressData - Player progress data
     */
    async initialize(levelData, progressData, presentationLayout = null) {
        console.log('[OdysseyBoard] Initializing...');
        this.presentationLayout = derivePresentationLayout(levelData, presentationLayout, this.layoutOverride);
        this.levelData = applyOdysseyLayoutToLevels(levelData, this.presentationLayout);
        this.progressData = progressData;
        setOdysseyPathLayout(this.presentationLayout);

        // Get quality settings
        const quality = window.settings?.effectQuality || 'High';
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.qualityName = quality;

        // ─── Step 1: Lightweight Three.js shell (very fast) ───
        await this.initRenderer();
        this.initScene();
        this.initCamera();
        this.createStarfield();

        // Yield — let the loading overlay render & animate smoothly
        await this._yieldToMain();

        // ─── Step 2: Load chapter 1 environment ───
        this.environmentManager = new ChapterEnvironmentManager(this.scene, this.renderer, {
            chapterPositions: this.presentationLayout.chapterPositions,
        });
        await this.environmentManager.initialize([1], {
            particleCount: this.qualityPreset.particleCount,
        });
        await this._prewarmChapterEnvironment(1);

        await this._yieldToMain();

        // ─── Step 3: Eagerly load all chapter environments ───
        // Trading longer init for smoother scrolling (no on-demand chapter loads during scroll)
        const totalChapters = this.presentationLayout.chapterPositions?.length || 8;
        /* eslint-disable no-await-in-loop */
        for (let ch = 2; ch <= totalChapters; ch++) {
            await this.environmentManager.createChapterEnvironment(ch);
            await this._prewarmChapterEnvironment(ch);
            await this._yieldToMain();
        }
        /* eslint-enable no-await-in-loop */

        // ─── Step 4: Build path ───
        // Diegetic per-chapter path is part of the default cinematic journey.
        this.pathRenderer = new OdysseyPathRenderer(this.scene, { aaa: this.cinematicJourneyActive });
        await this.pathRenderer.buildPath({
            ...ODYSSEY_PATH_DATA,
            controlPoints: this.presentationLayout.controlPoints,
            chapterPositions: this.presentationLayout.chapterPositions,
        });

        await this._yieldToMain();

        // ─── Step 5: Create level nodes (55 nodes) ───
        this.nodeManager = new LevelNodeManager(this.scene, this.pathRenderer.pathCurve);
        this.nodeManager.setCamera(this.camera);
        // Node focal hierarchy + per-world shells ride the same always-on spine.
        this.nodeManager.setAAAVisualsEnabled(this.cinematicJourneyActive);
        await this.nodeManager.createNodes(this.levelData, this._yieldToMain.bind(this));
        this.nodeManager.updateFromProgress(this.progressData);

        await this._yieldToMain();

        // ─── Step 6: Camera, post-processing, lighting, interaction ───
        this.cameraController = new OdysseyCameraController(
            this.camera,
            this.pathRenderer.pathCurve,
            {
                levelPositions: this.presentationLayout.levelPositions,
                chapterPositions: this.presentationLayout.chapterPositions,
                startPosition: this.presentationLayout.levelPositions[0] ?? 0,
            },
        );

        // Optimization: Link camera LUT evaluator to node manager to avoid redundant spline calls
        if (this.nodeManager && this.cameraController) {
            this.nodeManager.setPathEvaluator((t, pos) => {
                const { position } = this.cameraController.getPathDataAt(t, pos);
                return position;
            });
        }

        // Connect chapter change events to camera for FOV pulse and post-processing effects
        if (this.environmentManager && this.cameraController) {
            this.environmentManager.setOnChapterChange((chapterId, previousChapter) => {
                this.cameraController.onChapterChange(chapterId);
                this.onChapterArrival?.({
                    chapterId,
                    previousChapter,
                    profile: getChapterProfile(chapterId),
                });
                if (this.cinematicJourneyActive) {
                    this.director?.onChapterEnter(chapterId, previousChapter);
                    this.cameraController.triggerVistaBeat({
                        chapterId,
                        durationMs: 1450,
                        intensity: chapterId >= 5 ? 1.08 : 0.9,
                    });
                }
                console.log(`[OdysseyBoard] Chapter transition: ${previousChapter} → ${chapterId}`);
            });
        }

        if (this.environmentManager) {
            this.environmentManager.updateVisibility(
                this.cameraController.getCurrentPosition(),
                { mode: 'progress' },
            );
        }

        this.setupPostProcessing();
        this.setupLighting();
        await this.setupDirector();
        this._applyChapterMusic(1, { reason: 'odyssey-board-initial' });

        await this._yieldToMain();

        if (this.editorMode) {
            await this.initializeLayoutEditor();
        }

        // ─── Step 7: Interaction + start render loop ───
        this.setupInteraction();

        // Replay the whole journey once (behind the loader) so first-visit per-chapter costs
        // (compile-through-post, GPU upload, first update(), the breach) are paid now, not on
        // the first live transition into each new chapter.
        await this._warmUpJourney();

        this.isActive = true;
        this.animate();
        this._queueChapterPrewarm(2);

        // Load remaining chapters in background (idle time, one at a time)
        this.environmentManager.loadChaptersInBackground([1, 2], {
            canRunTask: () => this._canRunBackgroundTask(),
            onEnvironmentCreated: (chapterId) => {
                this._queueChapterPrewarm(chapterId);
            },
        });

        console.log('[OdysseyBoard] Initialized successfully');
    }

    async initializeLayoutEditor() {
        const { OdysseyLayoutEditor } = await import('./OdysseyLayoutEditor.js');
        this.layoutEditor = new OdysseyLayoutEditor(this);
        this.layoutEditor.initialize();
    }

    /**
     * Yield to the main thread so CSS animations and repaints can happen.
     * Uses a double-rAF to guarantee a full frame is painted.
     * @private
     */
    _yieldToMain() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }

    _markInteraction() {
        this.lastInteractionAt = performance.now();
    }

    _isInteractionIdle() {
        return (performance.now() - this.lastInteractionAt) >= this.backgroundLoadQuietWindowMs;
    }

    _isCameraSettled() {
        if (!this.cameraController) return true;
        if (this.cameraController.isAnimating) return false;

        const currentPosition = Number.isFinite(this.cameraController.currentPosition)
            ? this.cameraController.currentPosition
            : this.cameraController.getCurrentPosition?.();
        const targetPosition = Number.isFinite(this.cameraController.targetPosition)
            ? this.cameraController.targetPosition
            : currentPosition;

        if (!Number.isFinite(currentPosition) || !Number.isFinite(targetPosition)) {
            return true;
        }

        return Math.abs(targetPosition - currentPosition) <= this.cameraSettledThreshold;
    }

    _canRunBackgroundTask() {
        return this._isInteractionIdle() && this._isCameraSettled();
    }

    _queueChapterPrewarm(chapterId) {
        if (!Number.isFinite(chapterId)) return;
        if (this.queuedPrewarmChapters.has(chapterId)) return;

        const env = this.environmentManager?.environments?.get(chapterId);
        if (env?.prewarmed) return;

        this.queuedPrewarmChapters.add(chapterId);
        this.prewarmQueue.push(chapterId);
        this._schedulePrewarmDrain(80);
    }

    _schedulePrewarmDrain(delayMs = 120) {
        if (this.prewarmDrainTimer || this.prewarmQueue.length === 0) return;

        this.prewarmDrainTimer = setTimeout(() => {
            this.prewarmDrainTimer = null;
            this._drainPrewarmQueue().catch((error) => {
                console.warn('[OdysseyBoard] Prewarm drain failed:', error);
            });
        }, delayMs);
    }

    async _drainPrewarmQueue() {
        if (!this.isActive || this.isPrewarming || this.prewarmQueue.length === 0) return;
        if (!this._canRunBackgroundTask()) {
            this._schedulePrewarmDrain(160);
            return;
        }

        const chapterId = this.prewarmQueue.shift();
        this.queuedPrewarmChapters.delete(chapterId);
        this.isPrewarming = true;

        try {
            await this._prewarmChapterEnvironment(chapterId);
        } finally {
            this.isPrewarming = false;
        }

        if (this.prewarmQueue.length > 0) {
            this._schedulePrewarmDrain(60);
        }
    }

    async _prewarmChapterEnvironment(chapterId) {
        if (!this.environmentManager || !this.renderer || !this.scene || !this.camera) return;

        const env = this.environmentManager.environments.get(chapterId);
        if (!env || env.prewarmed) return;

        const { group } = env;
        const previousGroupVisibility = group.visible;
        const frustumOverrides = [];

        group.traverse((child) => {
            if (child?.isMesh || child?.isPoints || child?.isLine || child?.isSprite) {
                frustumOverrides.push({ child, frustumCulled: child.frustumCulled });
                child.frustumCulled = false;
            }
        });

        try {
            // Temporarily force visibility for shader compilation, then restore.
            group.visible = true;

            // Structural: TARGETED compile of just this chapter's group instead of the whole
            // scene. compileAsync(scene, camera) rebuilds every resident chapter's pipelines
            // (redundant work that grows with 8 chapters); the 3rd `targetScene` arg restricts
            // compilation to `group`, so each prewarm only builds that chapter's pipelines.
            if (typeof this.renderer.compileAsync === 'function') {
                await this.renderer.compileAsync(this.scene, this.camera, group);
            } else if (typeof this.renderer.compile === 'function') {
                this.renderer.compile(this.scene, this.camera, group);
            }

            env.prewarmed = true;
            console.log(`[OdysseyBoard] Prewarmed chapter ${chapterId} shaders`);
        } catch (error) {
            console.warn(`[OdysseyBoard] Shader prewarm failed for chapter ${chapterId}:`, error);
        } finally {
            group.visible = previousGroupVisibility;
            frustumOverrides.forEach(({ child, frustumCulled }) => {
                child.frustumCulled = frustumCulled;
            });
        }
    }

    /**
     * Generic shader/pipeline prewarm for ANY scene group (not just chapter envs).
     * Temporarily makes the group visible + frustum-uncullable, runs a TARGETED
     * compileAsync so every material pipeline in it is built during load, then restores
     * its prior state. Used for the seam-only breach + the corridor field, whose pipelines
     * would otherwise compile on the FIRST chapter transition (the first-transition hitch).
     */
    async _prewarmGroup(group, label = 'group') {
        if (!group || !this.renderer || !this.scene || !this.camera) return;
        const previousVisibility = group.visible;
        // Force EVERY descendant visible + frustum-uncullable during compile: groups like
        // the corridor field toggle per-chapter sub-groups by .visible, and compileAsync
        // skips invisible objects — so we must reveal them all to build every pipeline.
        const overrides = [];
        group.traverse((child) => {
            if (child === group) return;
            overrides.push({ child, visible: child.visible, frustumCulled: child.frustumCulled });
            child.visible = true;
            if (child.isMesh || child.isPoints || child.isLine || child.isSprite) {
                child.frustumCulled = false;
            }
        });
        try {
            group.visible = true;
            if (typeof this.renderer.compileAsync === 'function') {
                await this.renderer.compileAsync(this.scene, this.camera, group);
            } else if (typeof this.renderer.compile === 'function') {
                this.renderer.compile(this.scene, this.camera, group);
            }
            console.log(`[OdysseyBoard] Prewarmed ${label} shaders`);
        } catch (error) {
            console.warn(`[OdysseyBoard] Shader prewarm failed for ${label}:`, error);
        } finally {
            group.visible = previousVisibility;
            overrides.forEach(({ child, visible, frustumCulled }) => {
                child.visible = visible;
                child.frustumCulled = frustumCulled;
            });
        }
    }

    /**
     * THE first-visit hitch fix. We render through a post PassNode (HalfFloat/MRT target),
     * but renderer.compileAsync only warms DIRECT-to-screen pipelines — so each chapter's
     * materials genuinely recompiled the first time they rendered THROUGH post (first visit),
     * then cached (smooth after). Here, during load, we reveal ALL content (every chapter env
     * + corridor + breach, frustum-uncullable) and run a few real renders through the post
     * path so every pipeline is built against the actual target now, not on first transition.
     * Also exercises the ch7 lensing post-variant (it swaps outputNode on Black Hole entry).
     */
    async _warmUpPipelines() {
        const stack = this.postProcessingStack;
        if (!stack || typeof stack.render !== 'function' || !this.environmentManager) return;
        const pp = stack.postProcessing;
        const renderOnce = async () => {
            if (pp && typeof pp.renderAsync === 'function') {
                await pp.renderAsync();
            } else {
                stack.render();
            }
        };
        const overrides = [];
        const reveal = (group) => {
            if (!group) return;
            group.traverse((child) => {
                if (child === group) return;
                overrides.push({ child, visible: child.visible, frustumCulled: child.frustumCulled });
                child.visible = true;
                if (child.isMesh || child.isPoints || child.isLine || child.isSprite) {
                    child.frustumCulled = false;
                }
            });
        };
        this.environmentManager.environments?.forEach?.((env) => reveal(env?.group));
        reveal(this.corridorField?.group);
        reveal(this.thresholdDirector?.group);
        try {
            // Pass 1: compile every chapter/corridor/breach pipeline through the real post target.
            await renderOnce();
            // Pass 2/3: warm both post output-node variants (default + ch7 lensing/CA spike).
            if (typeof stack.update === 'function') {
                stack.update(1 / 60, { activeChapter: 7, seamProgress: 0.5, energy: 0.5 });
                await renderOnce();
                stack.update(1 / 60, { activeChapter: 1, seamProgress: 0 });
                await renderOnce();
            }
            console.log('[OdysseyBoard] Warmed post-path pipelines (all chapters + corridor + breach + ch7 variant)');
        } catch (error) {
            console.warn('[OdysseyBoard] Pipeline warm-up render failed:', error);
        } finally {
            overrides.forEach(({ child, visible, frustumCulled }) => {
                child.visible = visible;
                child.frustumCulled = frustumCulled;
            });
        }
    }

    async initRenderer() {
        const pixelRatio = computeScenePixelRatio({
            renderScale: this._drs.renderScale,
            devicePixelRatio: window.devicePixelRatio || 1,
            maxPixelRatio: ODYSSEY_MAX_PIXEL_RATIO, // QW3: 1.5 -> 1.2.
            sceneType: 'odyssey',
        });
        // WebGPU with automatic WebGL2 fallback (one TSL codebase runs on both backends).
        // ?forceWebGL=1 forces the WebGL2 backend for QA/parity testing.
        const forceWebGL = new URLSearchParams(window.location.search).get('forceWebGL') === '1';
        this.renderer = new THREE.WebGPURenderer({
            // QW1: scene-pass MSAA dropped (antialias:false). Edges are softened by the post
            // graph (ACES + grade + grain); MSAA on a full-res HalfFloat scene RT was a ~4×
            // sample multiplier on the heaviest pass. Biggest steady-state GPU win.
            antialias: false,
            alpha: true,
            forceWebGL,
            powerPreference: 'high-performance',
            // Batch0: enable GPU timestamp tracking so renderer.info.render.timestamp is
            // populated (resolved after each render below). Harmless if the backend lacks it.
            trackTimestamp: true,
        });
        await this.renderer.init();
        this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = this.renderer.backend?.isWebGLBackend === true;
        // Tonemapping happens in the TSL post graph (manual ACES) → renderer stays linear.
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setClearColor(0x050510, 1);
        this.container.appendChild(this.renderer.domElement);
        console.log(`[OdysseyBoard] Renderer backend: ${this.isWebGPU ? 'WebGPU' : 'WebGL2 (fallback)'}`);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.008);
    }

    initCamera() {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 9000);
        this.camera.position.set(0, 5, 30);
        this.camera.lookAt(0, 0, 0);
    }

    setupPostProcessing() {
        // Use enhanced PostProcessingStack instead of basic bloom
        // This provides chromatic aberration, dynamic vignette, and film grain
        // based on quality preset.
        //
        // The cinematic journey uses OdysseyFallbackPipeline by default: the base stack
        // plus exposure, ACES, and director-grade passes for a consistent filmic finish.
        // ?odysseyAAA=1 now controls only the diagnostics overlay.
        this.debugOverlayActive = isOdysseyAAADebugEnabled();
        this.aaaPostActive = this.cinematicJourneyActive;
        try {
            // WebGPU TSL post graph: bloom + ACES + per-chapter grade + CA + vignette + grain.
            // API-compatible with the old PostProcessingStack (update/render/resize/seam/dispose).
            this.postProcessingStack = new OdysseyTslPipeline(this.renderer, this.scene, this.camera, {
                // Tamed from the preset default: the additive path/node glow was blowing out
                // to pure white (see journey audit). Lower strength + higher threshold so only
                // genuinely bright emitters bloom and the scene keeps its colour/contrast.
                bloomStrength: 0.32,
                bloomThreshold: 0.85,
                bloomRadius: 0.7,
            });
            this.postProcessingStack.setSize(this.container.clientWidth, this.container.clientHeight);
            this.composer = null;
            this.bloomPass = null;
            console.log(`[OdysseyBoard] OdysseyTslPipeline initialized (${this.qualityName})`);
        } catch (error) {
            this.aaaPostActive = false;
            this.postProcessingStack = null;
            this.composer = null;
            // No post: render the scene directly (renderFrame falls through to renderer.render).
            console.warn('[OdysseyBoard] OdysseyTslPipeline failed; rendering without post:', error);
        }
    }

    setupLighting() {
        // When the cinematic atmosphere is active it owns the global light rig
        // (key + ambient + fill) via OdysseyAtmosphere, so skip the board's own
        // static globals to avoid double-lighting.
        if (this.aaaPostActive) {
            return;
        }

        // Ambient light
        this.globalAmbientLight = new THREE.AmbientLight(0x404080, 0.3);
        this.scene.add(this.globalAmbientLight);
        this.environmentManager?.registerAmbientLight(this.globalAmbientLight);

        // Main directional light
        const directional = new THREE.DirectionalLight(0xffffff, 0.5);
        directional.position.set(10, 30, 20);
        this.scene.add(directional);

        // Point lights for path glow
        const pathLight1 = new THREE.PointLight(0x6688ff, 0.5, 50);
        pathLight1.position.set(0, 10, 0);
        this.scene.add(pathLight1);
    }

    /**
     * Set up the cinematic Odyssey spine: the director (conductor), the audio
     * reactor, and the optional debug overlay (?odysseyAAA=1).
     */
    async setupDirector() {
        try {
            this.director = new OdysseyDirector({
                chapterPositions: this.presentationLayout?.chapterPositions,
            });
            this.audioReactor = new OdysseyAudioReactor(this.soundManager);

            // The director-driven global atmosphere (graded sky-dome + fog +
            // shared key/ambient/fill light rig). When on,
            // it owns the global look so ChapterEnvironmentManager yields fog/clear/
            // ambient (it still detects chapter changes for the FOV pulse).
            if (this.aaaPostActive) {
                this.atmosphere = new OdysseyAtmosphere(this.scene, this.renderer);
                // Parallax mid/far depth filler so the corridor between chapter set pieces
                // is never empty void (reads chapter-profile + path-utils; one cohesive rig).
                this.corridorField = new OdysseyCorridorField(this.scene);
                this.environmentManager?.setAtmosphereOwned(true);
                this.thresholdDirector = new ChapterThresholdDirector(this.scene, this.pathRenderer?.pathCurve, {
                    chapterPositions: this.presentationLayout?.chapterPositions,
                    qualityName: this.qualityName,
                });
                // FIRST-TRANSITION HITCH FIX: the corridor field + the seam-only breach are
                // NOT chapter env groups, so the per-chapter prewarm misses them and their
                // WebGPU pipelines compile on the FIRST transition (lag once, smooth after).
                // Compile them here during load instead.
                await this._prewarmGroup(this.corridorField?.group, 'corridor field');
                await this._prewarmGroup(this.thresholdDirector?.group, 'threshold breach');
            }

            if (this.debugOverlayActive) {
                this.debugOverlay = new OdysseyDebugOverlay();
                console.log('[OdysseyBoard] Odyssey debug overlay active (?odysseyAAA=1)');
            }
        } catch (error) {
            console.warn('[OdysseyBoard] Director setup failed (non-fatal):', error);
            this.director = null;
            this.audioReactor = null;
            this.debugOverlay = null;
            this.corridorField = null;
            this.thresholdDirector = null;
        }
    }

    // =============================
    // Background Elements
    // =============================

    createGlobalParticleTexture() {
        if (typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        return new THREE.CanvasTexture(canvas);
    }

    createStarfield() {
        const count = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Distribute stars in a large sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 200 + Math.random() * 300;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            // Vary star colors (white to blue to purple)
            const colorMix = Math.random();
            colors[i3] = 0.7 + colorMix * 0.3;
            colors[i3 + 1] = 0.7 + colorMix * 0.3;
            colors[i3 + 2] = 0.9 + colorMix * 0.1;

            sizes[i] = 1 + Math.random() * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            // No `map`: on WebGPU a PointsMaterial map samples the point uv, which a
            // THREE.Points geometry lacks ("uv not found" warning every frame). Solid
            // additive vertex-coloured points read fine for a distant starfield.
            size: 2.0,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.stars = new THREE.Points(geometry, material);
        this.scene.add(this.stars);
    }

    createNebula() {
        // Simple gradient plane for nebula background
        const geometry = new THREE.PlaneGeometry(500, 500);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new THREE.Color(0x1a0a2e) },
                uColor2: { value: new THREE.Color(0x0a1a2e) },
                uColor3: { value: new THREE.Color(0x2e0a1a) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform vec3 uColor3;
                varying vec2 vUv;

                void main() {
                    vec2 uv = vUv;
                    float wave = sin(uv.y * 3.0 + uTime * 0.1) * 0.5 + 0.5;
                    vec3 color = mix(uColor1, uColor2, uv.y);
                    color = mix(color, uColor3, wave * 0.3);
                    gl_FragColor = vec4(color, 0.5);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.nebulaMesh = new THREE.Mesh(geometry, material);
        this.nebulaMesh.position.z = -150;
        this.scene.add(this.nebulaMesh);
    }

    createAmbientParticles() {
        const count = this.qualityPreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = Math.random() * 200 - 50; // Along the vertical path
            positions[i3 + 2] = (Math.random() - 0.5) * 50;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            size: 0.8, // Increased size for texture
            color: 0x8888ff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            map: this.createGlobalParticleTexture(),
            depthWrite: false,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);
    }

    // =============================
    // Interaction
    // =============================

    setupInteraction() {
        if (this.interactionAttached || !this.renderer?.domElement) {
            return;
        }

        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousemove', this.boundHandlers.mousemove);
        canvas.addEventListener('click', this.boundHandlers.click);

        // Touch support
        canvas.addEventListener('touchstart', this.boundHandlers.touchstart);
        canvas.addEventListener('touchmove', this.boundHandlers.touchmove);
        canvas.addEventListener('touchend', this.boundHandlers.touchend);

        // Resize
        document.addEventListener('wheel', this.boundHandlers.wheel, ODYSSEY_WHEEL_CAPTURE_OPTIONS);
        window.addEventListener('resize', this.boundHandlers.resize);

        this.interactionAttached = true;
    }

    teardownInteraction() {
        if (!this.interactionAttached) {
            return;
        }

        const canvas = this.renderer?.domElement;
        if (canvas) {
            canvas.removeEventListener('mousemove', this.boundHandlers.mousemove);
            canvas.removeEventListener('click', this.boundHandlers.click);
            canvas.removeEventListener('touchstart', this.boundHandlers.touchstart);
            canvas.removeEventListener('touchmove', this.boundHandlers.touchmove);
            canvas.removeEventListener('touchend', this.boundHandlers.touchend);
        }

        document.removeEventListener('wheel', this.boundHandlers.wheel, ODYSSEY_WHEEL_CAPTURE_OPTIONS);
        window.removeEventListener('resize', this.boundHandlers.resize);
        this.interactionAttached = false;
    }

    onMouseMove(event) {
        if (this.layoutEditor?.isBoardInteractionBlocked?.()) {
            return;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Check for level node hover
        this.checkHover();
    }

    onClick() {
        if (this.layoutEditor?.isBoardInteractionBlocked?.()) {
            return;
        }

        if (this.hoveredLevelId !== null) {
            this.selectLevel(this.hoveredLevelId);
        } else {
            // Clicked on empty space - deselect and notify
            if (this.selectedLevelId !== null) {
                this.nodeManager?.setNodeSelected(this.selectedLevelId, false);
                this.selectedLevelId = null;
            }
            this.onEmptyClick?.();
        }
    }

    onWheel(event) {
        if (!this.shouldHandleWheelEvent(event)) {
            return;
        }

        const delta = normalizeOdysseyWheelDelta(
            event,
            this.container?.clientHeight || globalThis.window?.innerHeight || 900,
        );
        if (!delta) {
            return;
        }

        event.preventDefault();
        this._markInteraction();
        this.cameraController?.scroll(delta);
    }

    shouldHandleWheelEvent(event) {
        const containerRect = this.container?.getBoundingClientRect?.();
        return shouldRouteOdysseyWheel({
            isActive: this.isActive,
            isRenderingPaused: this.isRenderingPaused,
            containerRect,
            target: event?.target ?? null,
            clientX: event?.clientX,
            clientY: event?.clientY,
        });
    }

    onTouchStart(event) {
        if (event.touches.length === 1) {
            this._markInteraction();
            const touch = event.touches[0];
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
            this.touchStartY = touch.clientY;
        }
    }

    onTouchMove(event) {
        if (event.touches.length === 1) {
            this._markInteraction();
            const touch = event.touches[0];
            const delta = (this.touchStartY - touch.clientY) * 0.005;
            this.cameraController?.scroll(delta);
            this.touchStartY = touch.clientY;
        }
    }

    onTouchEnd() {
        // Check for tap selection
        this.checkHover();
        if (this.hoveredLevelId !== null) {
            this.selectLevel(this.hoveredLevelId);
        }
    }

    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        const pixelRatio = computeScenePixelRatio({
            renderScale: this._drs.renderScale, // respect the live DRS scale (QW2/QW3).
            devicePixelRatio: window.devicePixelRatio || 1,
            maxPixelRatio: ODYSSEY_MAX_PIXEL_RATIO,
            sceneType: 'odyssey',
        });

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(pixelRatio);

        // Resize post-processing stack
        if (this.postProcessingStack) {
            this.postProcessingStack.resize(width, height);
        } else if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    /**
     * QW2 — apply a new DRS render scale: recompute the odyssey pixel ratio and resize the
     * post stack to match. Called by the debounced DRS evaluator (never per-frame) and is the
     * hook Wave 2's adaptive-quality controller drives for its "Tier 0" resolution response.
     * @param {number} renderScale
     * @private
     */
    _applyRenderScale(renderScale) {
        if (!this.renderer) return;
        this._drs.renderScale = renderScale;
        const width = this.container?.clientWidth || 1;
        const height = this.container?.clientHeight || 1;
        const pixelRatio = computeScenePixelRatio({
            renderScale,
            devicePixelRatio: window.devicePixelRatio || 1,
            maxPixelRatio: ODYSSEY_MAX_PIXEL_RATIO,
            sceneType: 'odyssey',
        });
        this.renderer.setPixelRatio(pixelRatio);
        if (this.postProcessingStack?.resize) {
            this.postProcessingStack.resize(width, height);
        } else if (this.composer?.setSize) {
            this.composer.setSize(width, height);
        }
    }

    /**
     * Wave 2 — drive the adaptive-quality controller from the frame loop. Record this frame's
     * wall-clock time into the controller's rolling window (allocation-free) and tick it; the
     * controller self-throttles to ~1Hz and applies any tier change via the reused ctx (Tier 0
     * resolution → this._applyRenderScale; Tier 1 bloom / Tier 2 post extras → the pipeline
     * knobs). Safe + cheap to call every frame. Gated on the cinematic post stack being active
     * (the Tier-1/2 knobs are cinematic-pipeline-only) and on the master enable flag — when
     * disabled this is a no-op and the user's manual quality preset stands untouched.
     * @param {number} frameMs this frame time in milliseconds.
     * @private
     */
    _tickAdaptiveQuality(frameMs) {
        if (!this.adaptiveQuality || !this.adaptiveQualityEnabled || !this.cinematicJourneyActive) return;
        this.adaptiveQuality.recordFrame(frameMs);
        // Refresh the (cheap) pipeline reference each tick — the post stack is built after the
        // controller and can be torn down / re-created; ctx is reused so this is alloc-free.
        this._adaptiveCtx.pipeline = this.postProcessingStack;
        this.adaptiveQuality.update(performance.now(), this._adaptiveCtx);
    }

    /**
     * Batch0 — resolve GPU timestamp queries so renderer.info.render.timestamp is populated
     * for the debug overlay. Fire-and-forget; guarded for backends/builds without the API.
     * @private
     */
    _resolveRenderTimestamps() {
        const { renderer } = this;
        if (typeof renderer?.resolveTimestampsAsync !== 'function') return;
        const renderType = THREE.TimestampQuery?.RENDER ?? 'render';
        renderer.resolveTimestampsAsync(renderType).catch(() => {});
    }

    checkHover() {
        if (!this.nodeManager) return;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const levelId = this.nodeManager.raycast(this.raycaster);

        if (levelId !== this.hoveredLevelId) {
            // Un-hover previous
            if (this.hoveredLevelId !== null) {
                this.nodeManager.setNodeHovered(this.hoveredLevelId, false);
            }

            // Hover new
            this.hoveredLevelId = levelId;
            if (levelId !== null) {
                this.nodeManager.setNodeHovered(levelId, true);
                this.renderer.domElement.style.cursor = 'pointer';
                this.onLevelHover?.(levelId);
            } else {
                this.renderer.domElement.style.cursor = 'default';
                this.onLevelHover?.(null);
            }
        }
    }

    selectLevel(levelId) {
        this.travelToLevel(levelId).catch((error) => {
            console.warn('[OdysseyBoard] Level travel failed:', error);
        });
    }

    async travelToLevel(levelId, options = {}) {
        if (!this.nodeManager || !this.cameraController) return false;

        if (this.selectedLevelId !== null) {
            this.nodeManager.setNodeSelected(this.selectedLevelId, false);
        }

        this.selectedLevelId = levelId;
        this.nodeManager.setNodeSelected(levelId, true);
        this._markInteraction();

        const node = this.nodeManager.nodes.get(levelId);
        const nodePosition = this.nodeManager.getNodePosition(levelId);
        if (!node || !nodePosition) {
            this.onLevelSelect?.(levelId, { settled: false, traveled: false });
            return false;
        }

        const selectionId = ++this.selectionSequence;
        const targetChapter = node.config?.chapter ?? 1;
        const targetProgress = node.pathPosition ?? this.cameraController.getCurrentPosition();
        const currentProgress = this.cameraController.getCurrentPosition();
        const currentBlendState = this.environmentManager?.getBlendState(currentProgress);
        const currentChapter = currentBlendState?.activeChapter ?? targetChapter;
        const traveled = currentChapter !== targetChapter;

        if (traveled) {
            await this._requestChapterEnvironment(targetChapter);
            await this.cameraController.travelToPosition(
                targetProgress,
                options.travelDuration ?? this.computeTravelDuration(currentProgress, targetProgress),
            );
        }

        if (selectionId !== this.selectionSequence) {
            return false;
        }

        this.cameraController.setCurrentPosition(targetProgress);
        await this.cameraController.focusOnNode(
            nodePosition,
            traveled ? (options.focusDuration ?? 520) : (options.focusDuration ?? 800),
        );

        if (selectionId !== this.selectionSequence) {
            return false;
        }

        this.onLevelSelect?.(levelId, {
            chapterId: targetChapter,
            settled: true,
            traveled,
        });
        return true;
    }

    // =============================
    // Navigation
    // =============================

    /**
     * Pan camera to a specific chapter
     * @param {number} chapterId
     * @param {number} duration - Animation duration in ms
     */
    async panToChapter(chapterId, duration = 1500) {
        const chapterPosition = this.presentationLayout.chapterPositions?.[chapterId - 1] || 0;
        await this._requestChapterEnvironment(chapterId);
        return this.cameraController?.panToPosition(chapterPosition, duration);
    }

    /**
     * Focus on a specific level
     * @param {number} levelId
     */
    focusOnLevel(levelId) {
        this.travelToLevel(levelId).catch((error) => {
            console.warn('[OdysseyBoard] Focus-on-level failed:', error);
        });
    }

    // =============================
    // Animation Loop
    // =============================

    animate() {
        if (!this.isActive) return;

        this.animationFrameId = requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        this.renderFrame(delta);
    }

    renderFrame(delta = 0) {
        this.time += delta;
        const previousDirectorState = this.director?.getState?.() || null;

        if (this.director && this.cinematicJourneyActive) {
            this.cameraController?.setDirectorState?.(previousDirectorState);
        }

        // Feed director state to the path so it flows toward the head and reacts to beats.
        this.cameraController?.update(delta);
        const cameraProgress = this.cameraController?.getCurrentPosition() ?? 0;
        const blendState = this.environmentManager?.getBlendState(cameraProgress) || null;
        const audioState = this.audioReactor?.update(delta) || null;
        let directorState = previousDirectorState;

        if (this.director) {
            directorState = this.director.update(delta, {
                ascentProgress: cameraProgress,
                audio: audioState,
                blendState,
            });
        }

        this.pathRenderer?.update(delta, this.cinematicJourneyActive ? directorState : null);

        // Pass camera progress to node manager for distance-based culling
        if (this.nodeManager) {
            this.nodeManager.setCameraProgress(cameraProgress);
        }
        this.nodeManager?.update(delta, this.cinematicJourneyActive ? (directorState?.node?.focalPulse ?? 0) : 0);
        this.layoutEditor?.update(delta);

        // Drive the conductor from camera position + audio (time-driven — every frame).
        this.atmosphere?.update(this.camera, directorState);
        this.debugOverlay?.update(directorState, audioState);

        // ── Batch5: decouple POSITION-DERIVED work from the 60Hz uniform tick.
        // When the camera is settled and no chapter seam is active, the camera-position-
        // dependent work (corridor parallax, visibility/blend-state, boundary preload,
        // global-environment grade) produces no visible change between frames, so throttle
        // it to ~30Hz. Time-driven uniform ticks (env.update drift, atmosphere, path, nodes)
        // continue every frame above/below this gate. During motion or a seam it runs every
        // frame as before (correctness at transitions is preserved).
        const nowMs = performance.now();
        const inSeam = blendState?.inSeam === true || this.activeSeamBoundaryId !== null;
        const settled = this._isCameraSettled() && !inSeam;
        const runPositionWork = !settled
            || (nowMs - this.lastPositionWorkAtMs) >= this.positionWorkIntervalMs;

        if (runPositionWork) {
            this.lastPositionWorkAtMs = nowMs;
            // Parallax corridor depth: cross-fade by active progress, drift, follow camera.
            this.corridorField?.update(this.camera, cameraProgress, delta);
        }

        // Update chapter environments based on camera position
        if (this.environmentManager && this.camera) {
            if (runPositionWork) {
                this._ensureBoundaryAssets(cameraProgress);
                this._handleChapterSeam(cameraProgress, blendState);
                this.environmentManager.updateVisibility(cameraProgress, { mode: 'progress', blendState });

                const progressDelta = Number.isFinite(this.lastGlobalEnvUpdateProgress)
                    ? Math.abs(cameraProgress - this.lastGlobalEnvUpdateProgress)
                    : Infinity;
                const shouldUpdateGlobalEnvironment = progressDelta > this.globalEnvProgressThreshold
                    || (nowMs - this.lastGlobalEnvUpdateTime) >= this.globalEnvMaxIntervalMs;

                if (shouldUpdateGlobalEnvironment) {
                    this.environmentManager.updateGlobalEnvironment(cameraProgress);
                    this.lastGlobalEnvUpdateTime = nowMs;
                    this.lastGlobalEnvUpdateProgress = cameraProgress;
                }
            }

            // Time-driven uniform tick (animated material uniforms) — always 60Hz.
            this.environmentManager.update(
                delta,
                this.camera,
                cameraProgress,
                this.cinematicJourneyActive ? directorState : null,
            );
        }

        // Track the active chapter (used to gate ch7-only Black Hole per-frame work below).
        if (blendState && Number.isFinite(blendState.activeChapter)) {
            this.lastActiveChapter = blendState.activeChapter;
        }

        // Rotate stars slowly
        if (this.stars) {
            this.stars.rotation.y += delta * 0.01;
        }

        this.thresholdDirector?.update(delta, this.camera, directorState);

        // B4 / Batch5: feed the Black Hole (ch7) screen-space lensing centre to the post
        // pipeline — but ONLY when the BH chapter is relevant. The lens centre projection
        // (getWorldDirection-derived world pos → NDC) is ch7-specific work; chapters 1-6/8
        // must not pay it. We gate on activeChapter===7 OR the 6→7 / 7→8 seam (source or
        // target chapter is 7), matching the window where the BH env is on-screen and its
        // lensWorldPos is being maintained. The pipeline still smooths/decays the centre on
        // exit via its internal lerp + the per-frame _lensActive reset.
        const bhRelevant = this.lastActiveChapter === 7
            || (blendState?.inSeam === true
                && (blendState.sourceChapter === 7 || blendState.targetChapter === 7));
        if (bhRelevant && this.postProcessingStack?.setLensTarget && this.cinematicJourneyActive) {
            const bhGroup = this.environmentManager?.environments?.get(7)?.group;
            const lensWorldPos = bhGroup?.userData?.lensWorldPos;
            if (lensWorldPos) {
                this.postProcessingStack.setLensTarget(lensWorldPos);
            }
        }

        // Update and render via PostProcessingStack.
        // When the cinematic pipeline is active it consumes director state (exposure/grade/
        // bloom); the default PostProcessingStack ignores the extra argument.
        if (this.postProcessingStack) {
            this.postProcessingStack.update(delta, this.cinematicJourneyActive ? directorState : undefined);
            this.postProcessingStack.render();
        } else if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        // Batch0: resolve GPU timestamps so the debug overlay can read render.info.timestamp.
        this._resolveRenderTimestamps();

        // Wave 2: feed this frame's wall-clock time into the adaptive-quality controller. It
        // records every frame and self-throttles its evaluation to ~1Hz; the resolution policy's
        // cooldowns gate any actual resolution change (never resizes per-frame), and bloom/post
        // tiers only shed once resolution is pinned at its floor under sustained pressure.
        if (!this._isWarmingUp) {
            this._tickAdaptiveQuality(delta * 1000);
            // Freeze diagnostics (debug-overlay only, ?odysseyAAA=1): log any large hitch + what
            // changed, so a remaining stall can be classified — a jump in geometries/textures =
            // GPU upload; no jump = compile/CPU. Gated so it never spams/over-heads normal runs.
            if (this.debugOverlayActive && delta > 0.05 && this.renderer?.info) {
                const { memory, render } = this.renderer.info;
                console.warn(
                    `[OdysseyPerf] hitch ${(delta * 1000).toFixed(0)}ms @${cameraProgress.toFixed(3)} `
                    + `ch${this.lastActiveChapter ?? '?'} | geom ${memory?.geometries} tex ${memory?.textures} `
                    + `draws ${render?.drawCalls} tris ${render?.triangles}`,
                );
            }
        }
    }

    /**
     * THE robust first-visit fix: replay the real renderFrame() path across the whole journey
     * (progress 0→1) during load, so EVERY one-time per-chapter cost the live scroll triggers —
     * pipeline compile through the post PassNode, GPU geometry/texture upload, the chapter's
     * first-frame update() work, the breach at each seam, and the seam post-variant — happens
     * NOW (behind the loader), not on the first live transition. Sound is muted and all transient
     * state (camera position, seam, breach, time) is restored afterwards.
     */
    async _warmUpJourney() {
        const cc = this.cameraController;
        if (!cc || this._isWarmingUp || typeof this.renderFrame !== 'function') return;
        const savedPos = cc.currentPosition;
        const savedTarget = cc.targetPosition;
        const savedTime = this.time;
        const savedSeam = this.activeSeamBoundaryId;
        const savedSound = this.soundManager;
        this._isWarmingUp = true;
        this.soundManager = null; // mute music/stingers during the scrub
        try {
            // Build the warm-up step list: ~40 even steps PLUS each chapter boundary ±0.02.
            // Even spacing alone can step OVER a narrow chapter's seam (e.g. 7→8 into Urban at
            // ~0.944 sits between 0.917 and 0.958), so that seam's crossfade + neon-snap breach
            // + the incoming chapter's first update() never get exercised → a first-entry hitch.
            // Explicitly sampling each boundary guarantees every seam crossing is warmed.
            const boundaries = this.presentationLayout?.chapterPositions || [];
            const stepSet = new Set();
            const EVEN = 40;
            for (let i = 0; i <= EVEN; i += 1) stepSet.add(i / EVEN);
            boundaries.forEach((b) => {
                if (Number.isFinite(b) && b > 0.001 && b < 0.999) {
                    stepSet.add(Math.max(0, b - 0.02));
                    stepSet.add(b);
                    stepSet.add(Math.min(1, b + 0.02));
                }
            });
            const steps = [...stepSet].sort((a, b) => a - b);
            for (let i = 0; i < steps.length; i += 1) {
                cc.currentPosition = steps[i];
                cc.targetPosition = steps[i];
                this.renderFrame(1 / 60);
                if (i % 3 === 0) {
                    // eslint-disable-next-line no-await-in-loop
                    await this._yieldToMain();
                }
            }
            console.log('[OdysseyBoard] Journey warm-up complete (every chapter + seam exercised through the real render path)');
        } catch (error) {
            console.warn('[OdysseyBoard] Journey warm-up failed:', error);
        } finally {
            this._isWarmingUp = false;
            this.soundManager = savedSound;
            this.time = savedTime;
            this.activeSeamBoundaryId = savedSeam;
            cc.currentPosition = savedPos;
            cc.targetPosition = savedTarget;
            this.thresholdDirector?.clearSeamPhase?.();
            // Re-settle visible chapters for the real start position.
            this.environmentManager?.updateVisibility?.(savedPos ?? 0, { mode: 'progress' });
        }
    }

    /**
     * Force a single synchronous render without restarting the board loop.
     * Used immediately before the portal breach snapshot.
     * @param {number} delta
     */
    renderOnce(delta = 0) {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderFrame(delta);
    }

    /**
     * Capture the current board frame as a canvas snapshot.
     * Used as a frozen underlay during the orb-portal transition.
     * @returns {HTMLCanvasElement|null}
     */
    captureFrame() {
        const sourceCanvas = this.renderer?.domElement;
        if (!sourceCanvas) return null;

        const canvas = document.createElement('canvas');
        const width = Math.max(1, sourceCanvas.width || sourceCanvas.clientWidth || 1);
        const height = Math.max(1, sourceCanvas.height || sourceCanvas.clientHeight || 1);
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        try {
            ctx.drawImage(sourceCanvas, 0, 0, width, height);
            return canvas;
        } catch (error) {
            console.warn('[OdysseyBoard] Failed to capture frame snapshot:', error);
            return null;
        }
    }

    /**
     * Pause board rendering loop without disposing resources.
     * Safe to call repeatedly.
     */
    pauseRendering() {
        if (this.isRenderingPaused) return;
        this.isRenderingPaused = true;
        this.isActive = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Resume board rendering loop after a pause.
     */
    resumeRendering() {
        if (!this.isRenderingPaused) return;
        if (!this.renderer || !this.scene || !this.camera) return;

        this.isRenderingPaused = false;
        this.isActive = true;
        this.clock.getDelta(); // Reset delta to avoid a huge first frame step.
        this.animate();
    }

    // =============================
    // Public API
    // =============================

    /**
     * Update progress visualization
     * @param {Object} progressData
     */
    updateProgress(progressData) {
        this.progressData = progressData;
        this.nodeManager?.updateFromProgress(progressData);
        this.pathRenderer?.setProgress(progressData.furthestLevel / 56);
    }

    getLayoutData() {
        return {
            controlPoints: this.presentationLayout.controlPoints.map((point) => ({ ...point })),
            levelPositionsById: { ...(this.presentationLayout.levelPositionsById || {}) },
        };
    }

    async applyLayoutOverride(layoutOverride) {
        if (!this.pathRenderer || !this.nodeManager || !this.cameraController || !this.environmentManager) {
            return false;
        }

        const currentPosition = this.cameraController.getCurrentPosition();
        const nextPresentationLayout = derivePresentationLayout(
            this.levelData,
            this.presentationLayout,
            layoutOverride,
        );

        this.presentationLayout = nextPresentationLayout;
        this.layoutOverride = {
            controlPoints: nextPresentationLayout.controlPoints,
            levelPositionsById: { ...nextPresentationLayout.levelPositionsById },
        };
        this.levelData = applyOdysseyLayoutToLevels(this.levelData, nextPresentationLayout);

        setOdysseyPathLayout(this.presentationLayout);
        await this.pathRenderer.rebuildPath({
            ...ODYSSEY_PATH_DATA,
            controlPoints: this.presentationLayout.controlPoints,
            chapterPositions: this.presentationLayout.chapterPositions,
        });

        this.nodeManager.updateLayout(this.levelData, this.pathRenderer.pathCurve);
        if (this.progressData) {
            this.nodeManager.updateFromProgress(this.progressData);
        }

        this.cameraController.applyLayout(this.pathRenderer.pathCurve, {
            levelPositions: this.presentationLayout.levelPositions,
            chapterPositions: this.presentationLayout.chapterPositions,
            startPosition: this.presentationLayout.levelPositions[0] ?? 0,
            preservePosition: currentPosition,
        });

        this.environmentManager.setChapterPositions(this.presentationLayout.chapterPositions);
        this.director?.setChapterPositions?.(this.presentationLayout.chapterPositions);
        this.thresholdDirector?.setChapterPositions?.(this.presentationLayout.chapterPositions);
        this.thresholdDirector?.setPathCurve?.(this.pathRenderer.pathCurve);
        this.environmentManager.updateVisibility(currentPosition, { mode: 'progress' });
        this.environmentManager.updateGlobalEnvironment(currentPosition);
        return true;
    }

    computeTravelDuration(fromPosition, toPosition) {
        const distance = Math.abs((toPosition ?? 0) - (fromPosition ?? 0));
        return Math.round(900 + (distance * 2600));
    }

    _handleChapterSeam(cameraProgress, blendState = null) {
        const resolvedBlendState = blendState || this.environmentManager?.getBlendState(cameraProgress);
        if (!resolvedBlendState) return;
        const boundaryId = resolvedBlendState.inSeam ? resolvedBlendState.boundaryId : null;
        const direction = this._resolveTravelDirection(cameraProgress);

        if (boundaryId && this.activeSeamBoundaryId !== boundaryId) {
            this.activeSeamBoundaryId = boundaryId;
            const { transition } = resolvedBlendState;
            let seamIntensity = 0.9;
            if (transition.fxPreset === 'heavy') {
                seamIntensity = 1.15;
            } else if (transition.fxPreset === 'neon') {
                seamIntensity = 1.0;
            }

            this.cameraController?.triggerChapterSeam({
                durationMs: transition.beatDurationMs,
                intensity: seamIntensity,
                direction,
            });
            this.director?.onBoundaryCross(boundaryId, direction);
            this.postProcessingStack?.triggerChapterSeam({
                preset: transition.fxPreset,
                intensity: seamIntensity,
            });
            this.thresholdDirector?.trigger({
                boundaryId,
                boundaryPosition: resolvedBlendState.boundaryPosition,
                durationMs: transition.beatDurationMs,
                direction,
                intensity: seamIntensity,
            });
            this._playThresholdStinger(boundaryId, seamIntensity, transition);
            this._startChapterMusicBridge(resolvedBlendState.targetChapter, transition, boundaryId);
            this.pathRenderer?.triggerChapterTransition({
                fromChapter: resolvedBlendState.sourceChapter,
                toChapter: resolvedBlendState.targetChapter,
                direction,
                boundaryPosition: resolvedBlendState.boundaryPosition,
                durationMs: transition.beatDurationMs,
            });
        }

        if (boundaryId) {
            const { transition } = resolvedBlendState;
            let seamIntensity = 0.9;
            if (transition.fxPreset === 'heavy') seamIntensity = 1.15;
            else if (transition.fxPreset === 'neon') seamIntensity = 1.0;
            const envelope = THREE.MathUtils.clamp(
                resolvedBlendState.seamEnvelope ?? Math.sin((resolvedBlendState.rawSeamProgress || 0) * Math.PI),
                0,
                1,
            );

            this.cameraController?.setSeamPhase?.({
                boundaryId,
                seamPhase: resolvedBlendState.seamPhase,
                envelope,
                direction,
                intensity: seamIntensity,
            });
            this.pathRenderer?.setSeamPhase?.({
                boundaryId,
                fromChapter: resolvedBlendState.sourceChapter,
                toChapter: resolvedBlendState.targetChapter,
                boundaryPosition: resolvedBlendState.boundaryPosition,
                seamWidth: resolvedBlendState.seamWidth,
                seamPhase: resolvedBlendState.seamPhase,
                envelope,
            });
            this.thresholdDirector?.setSeamPhase?.({
                boundaryId,
                boundaryPosition: resolvedBlendState.boundaryPosition,
                seamProgress: resolvedBlendState.rawSeamProgress,
                seamPhase: resolvedBlendState.seamPhase,
                envelope,
                direction,
                intensity: seamIntensity,
            });
            this.postProcessingStack?.setChapterSeamState?.({
                preset: transition.fxPreset,
                intensity: seamIntensity * envelope,
            });
        } else {
            this.activeSeamBoundaryId = null;
            this.seamMusicBoundaryId = null;
            this.cameraController?.clearSeamPhase?.();
            this.pathRenderer?.clearSeamPhase?.();
            this.thresholdDirector?.clearSeamPhase?.();
            this.postProcessingStack?.setChapterSeamState?.({ intensity: 0 });
        }

        this.lastCameraProgress = cameraProgress;
    }

    _applyChapterMusic(chapterId, options = {}) {
        const track = getChapterProfile(chapterId)?.audioTrack;
        if (!track || track === 'Ambient') return false;
        if (!this.soundManager || typeof this.soundManager.setTrack !== 'function') return false;

        const trackNames = Array.isArray(this.soundManager.trackNames) ? this.soundManager.trackNames : [];
        if (trackNames.length > 0 && !trackNames.includes(track)) {
            return false;
        }

        try {
            if (this.soundManager.musicTrack !== track) {
                this.soundManager.setTrack(track, options);
            } else if (
                options.forcePlayback
                && !this.soundManager.isMuted
                && typeof this.soundManager.startBackgroundMusic === 'function'
            ) {
                this.soundManager.startBackgroundMusic({
                    trackKey: track,
                    reason: options.reason || 'odyssey-chapter-music',
                });
            }
            return true;
        } catch (error) {
            console.warn(`[OdysseyBoard] Failed to apply chapter ${chapterId} music:`, error);
            return false;
        }
    }

    _startChapterMusicBridge(chapterId, transition = {}, boundaryId = null) {
        if (!boundaryId || this.seamMusicBoundaryId === boundaryId) {
            return false;
        }

        this.seamMusicBoundaryId = boundaryId;
        const crossfadeDurationMs = transition.crossfadeDurationMs
            || getChapterProfile(chapterId)?.transition?.crossfadeDurationMs
            || 3500;

        return this._applyChapterMusic(chapterId, {
            reason: 'odyssey-seam-music-bridge',
            fadeOutMs: Math.max(250, Math.round(crossfadeDurationMs * 0.48)),
            fadeInMs: Math.max(250, Math.round(crossfadeDurationMs * 0.52)),
        });
    }

    _playThresholdStinger(boundaryId, intensity = 1, transition = null) {
        const profile = getOdysseyThresholdProfile(boundaryId);
        const stinger = transition?.stinger || profile.stinger;
        try {
            if (typeof this.soundManager?.playOdysseyStinger === 'function') {
                this.soundManager.playOdysseyStinger(stinger, { intensity });
            } else {
                this.soundManager?.sfxPlayer?.playOdysseyStinger?.(stinger, { intensity });
            }
        } catch (error) {
            console.warn(`[OdysseyBoard] Threshold stinger failed for ${boundaryId}:`, error);
        }
    }

    _resolveTravelDirection(cameraProgress) {
        const travelDirection = this.cameraController?.getTravelState?.().direction;
        if (travelDirection) {
            return Math.sign(travelDirection) || 1;
        }
        return Math.sign(cameraProgress - this.lastCameraProgress) || 1;
    }

    _ensureBoundaryAssets(cameraProgress) {
        const chapterPositions = this.presentationLayout.chapterPositions || [];
        for (let sourceChapter = 1; sourceChapter < (chapterPositions.length - 1); sourceChapter += 1) {
            const boundaryPosition = chapterPositions[sourceChapter];
            const transition = this.environmentManager?.getBoundaryTransition(sourceChapter);
            if (!Number.isFinite(boundaryPosition) || !transition) continue;

            if (Math.abs(cameraProgress - boundaryPosition) <= transition.preloadDistance) {
                this._requestChapterEnvironment(sourceChapter).catch((error) => {
                    console.warn(`[OdysseyBoard] Boundary preload failed for chapter ${sourceChapter}:`, error);
                });
                this._requestChapterEnvironment(sourceChapter + 1).catch((error) => {
                    console.warn(`[OdysseyBoard] Boundary preload failed for chapter ${sourceChapter + 1}:`, error);
                });
            }
        }
    }

    async _requestChapterEnvironment(chapterId) {
        if (!Number.isFinite(chapterId) || !this.environmentManager) return false;

        const existing = this.environmentManager.environments.get(chapterId);
        if (existing) {
            this._queueChapterPrewarm(chapterId);
            return true;
        }

        if (this.pendingChapterLoads.has(chapterId)) {
            return false;
        }

        this.pendingChapterLoads.add(chapterId);
        try {
            await this.environmentManager.createChapterEnvironment(chapterId);
            this.environmentManager.updateVisibility(this.cameraController?.getCurrentPosition?.() ?? 0, {
                mode: 'progress',
            });
            this._queueChapterPrewarm(chapterId);
            return true;
        } catch (error) {
            console.warn(`[OdysseyBoard] Failed to prepare chapter ${chapterId}:`, error);
            return false;
        } finally {
            this.pendingChapterLoads.delete(chapterId);
        }
    }

    /**
     * Get currently selected level ID
     */
    getSelectedLevelId() {
        return this.selectedLevelId;
    }

    /**
     * Cleanup and dispose
     */
    dispose() {
        this.isActive = false;
        this.isRenderingPaused = false;
        this.teardownInteraction();
        resetOdysseyPathLayout();
        this.layoutEditor?.dispose?.();
        this.layoutEditor = null;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.prewarmDrainTimer) {
            clearTimeout(this.prewarmDrainTimer);
            this.prewarmDrainTimer = null;
        }
        this.prewarmQueue.length = 0;
        this.queuedPrewarmChapters.clear();
        this.isPrewarming = false;
        this.pendingChapterLoads.clear();
        this.activeSeamBoundaryId = null;
        this.seamMusicBoundaryId = null;

        // Dispose AAA spine
        this.debugOverlay?.dispose?.();
        this.debugOverlay = null;
        this.atmosphere?.dispose?.();
        this.atmosphere = null;
        this.corridorField?.dispose?.();
        this.corridorField = null;
        this.thresholdDirector?.dispose?.();
        this.thresholdDirector = null;
        this.audioReactor?.dispose?.();
        this.audioReactor = null;
        this.director?.dispose?.();
        this.director = null;

        // Dispose sub-controllers
        this.environmentManager?.dispose();
        this.pathRenderer?.dispose();
        this.nodeManager?.dispose();

        // Dispose post-processing stack
        this.postProcessingStack?.dispose();

        // Dispose scene objects
        this.scene?.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });

        // Dispose renderer
        this.renderer?.dispose();
        this.composer?.dispose?.();

        // Remove canvas
        if (this.renderer?.domElement?.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }

        console.log('[OdysseyBoard] Disposed');
    }
}

export default OdysseyBoardController;
