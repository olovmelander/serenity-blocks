/**
 * @fileoverview OdysseyBoardController - Three.js Odyssey Board Scene
 *
 * Main controller for the Odyssey Mode level selection board.
 * Renders the 3D Odyssey path with themed level nodes.
 */

import * as THREE from 'three/webgpu';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import { LevelNodeManager } from './LevelNodeManager.js';
import { PerfRing } from '../../utils/perf-ring.js';
import { OdysseyCameraController } from './OdysseyCameraController.js';
import { createOdysseyWorld } from './world/odyssey-world-renderer.js';
import {
    ONE_WORLD_APPLY_EXPOSURE,
    ONE_WORLD_OUTPUT_SCALE,
    ONE_WORLD_OUTPUT_SATURATION,
    ONE_WORLD_SKY_RADIUS,
} from './world/odyssey-world-grade.js';
import { ODYSSEY_BREACH_P } from './world/odyssey-world-height.js';
import { reportWorldBuildFailure } from './world/world-build-failure-report.js';
import { isWorldVisibleAtProgress } from './world/odyssey-world-act-gate.js';
import {
    STEAM_QUENCH_EXIT_HALF_WIDTH,
    STEAM_QUENCH_HALF_WIDTH,
    createSteamQuench,
} from './composition/odyssey-steam-quench.js';
import { createCloudBank } from './composition/odyssey-cloud-bank.js';
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
import { setOdysseyGltfRenderer } from './chapter-environments/shared/odyssey-gltf-loader.js';
import { getOdysseyPathPointAt, resetOdysseyPathLayout, setOdysseyPathLayout } from './path-utils.js';
import { createStartupTrace } from './odyssey-startup-trace.js';
import { buildChapterWarmSamples, buildJourneyWarmSamples, buildPointWarmSamples } from './odyssey-warmup-plan.js';
import {
    normalizeOdysseyWarmupMode,
    resolveOdysseyAdaptiveFrameRate,
    resolveOdysseyTargetFrameRate,
} from './odyssey-performance-utils.js';
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
import { gpuResilience } from '../../utils/gpu-context-resilience.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import {
    beginPostTargetCompile,
    endPostTargetCompile,
    compileGroupThroughPost,
} from './warmup/post-target-compile.js';

// Dynamic-resolution (DRS) tuning. The odyssey board pins a static pixel ratio at
// init/resize; here we wire the existing frame-time policy so render scale sheds under
// load and recovers when headroom returns. The policy itself enforces 6s-down/12s-up
// cooldowns + a 0.5..1.25 clamp, so we only need a rolling frame-time window + a 1Hz
// evaluation tick (NEVER per-frame — re-allocating the scene RT every frame can black-frame).
// Hard ceiling on top of the per-tier `odyssey` scene cap. Restored to 1.5 (was QW3's 1.2)
// so it no longer binds BELOW the theme's cap — the per-tier odyssey cap (now theme parity)
// governs, and the adaptive controller rides renderScale beneath it (user low-res report
// 2026-07-05). A DPR>1.5 panel is still clamped so 4K/retina can't runaway the fill cost.
const ODYSSEY_MAX_PIXEL_RATIO = 1.5;
const DRS_FRAME_WINDOW = 60; // rolling frames used for the p95/p99 estimate.
const DRS_EVAL_INTERVAL_MS = 1000; // evaluate at ~1Hz (policy cooldowns gate actual changes).
const DRS_TARGET_FRAME_RATE = 60;

/**
 * Quality presets for the Odyssey Board
 */
// WHAT THESE ACTUALLY CONTROL — the table used to advertise two knobs it did not have.
// `bloomStrength` was declared on all six rows and read NOWHERE (the live value is the
// hardcoded 0.32 at the OdysseyTslPipeline construction below), and `bloomScale` was read as
// `qualityPreset.bloomScale ?? ODYSSEY_BLOOM_SCALE` while no row ever defined it, so the
// fallback always won. Both are removed rather than wired: quality.js's own header says a
// declared-but-unread flag is worse than no flag, and re-tuning bloom per tier is a VISUAL
// change that owes a capture (ADR-0007) — not something to smuggle in as a cleanup.
// So: two real levers per tier, and every value here is read.
const QUALITY_PRESETS = {
    Minimal: { enableBloom: false, particleCount: 100, starCount: 300 },
    Low: { enableBloom: true, particleCount: 200, starCount: 500 },
    Medium: { enableBloom: true, particleCount: 400, starCount: 800 },
    High: { enableBloom: true, particleCount: 600, starCount: 1200 },
    Ultra: { enableBloom: true, particleCount: 900, starCount: 1800 },
    Extreme: { enableBloom: true, particleCount: 1200, starCount: 2500 },
};

/** The bloom downsample every tier actually runs. Was an unreachable `?? 0.25` fallback. */
const ODYSSEY_BLOOM_SCALE = 0.25;

const ODYSSEY_WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
const ODYSSEY_WHEEL_CAPTURE_OPTIONS = { capture: true, passive: false };
const ODYSSEY_WHEEL_LOCK_ATTRIBUTES = [ODYSSEY_WHEEL_LOCK_ATTRIBUTE, 'data-wheel-lock'];

function getUrlSearchParams() {
    if (typeof window === 'undefined') return null;
    try {
        return new URLSearchParams(window.location?.search || '');
    } catch {
        return null;
    }
}

function parseChapterIdList(value, totalChapters = 8) {
    return [...new Set(
        String(value || '')
            .split(',')
            .map((entry) => Number.parseInt(entry.trim(), 10))
            .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= totalChapters),
    )].sort((left, right) => left - right);
}

function readCaptureChapterIdsFromUrl(totalChapters = 8) {
    const search = getUrlSearchParams();
    return parseChapterIdList(search?.get('odysseyCaptureChapters'), totalChapters);
}

function readPixelRatioOverrideFromUrl() {
    const search = getUrlSearchParams();
    const value = Number.parseFloat(search?.get('odysseyPixelRatio'));
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(2, Math.max(0.5, value));
}

/** Chapters whose ground the continuous Act II world replaces. */
const ONE_WORLD_CHAPTERS = [2, 3, 4, 5];
// The world's OUTPUT CONTRACT (output scale, saturation, sky radius, exposure ownership)
// moved 2026-08-13 to world/odyssey-world-grade.js beside the world it configures, so the
// board and the cloud playground rig grade by construction instead of by agreement — the
// same fix the steam quench's half-widths got, and the cure for the deck's "authored flat,
// shipped as navy shards" history.
// The quench's window half-widths (approach 0.06 / exit 0.03, with the full MEASURED
// rationale) moved 2026-08-13 to odyssey-steam-quench.js beside the volume they window, so
// the board and the seam-12-dive playground drive the same quench by construction. The
// ch5->ch6 cloud bank still uses the symmetric STEAM_QUENCH_HALF_WIDTH for both halves.

function readBooleanUrlFlag(name) {
    const value = getUrlSearchParams()?.get(name);
    return value === '1' || value === 'true';
}

function readUrlValue(name) {
    return getUrlSearchParams()?.get(name);
}

function readDetectedRefreshRate() {
    const runtime = typeof window !== 'undefined' ? window : null;
    return runtime?.serenityBlocks?.frameRateController?.monitorRefreshRate
        ?? runtime?.app?.frameRateController?.monitorRefreshRate
        ?? null;
}

function readOdysseyTargetFrameRate(explicit = null) {
    const runtime = typeof window !== 'undefined' ? window : null;
    return resolveOdysseyTargetFrameRate({
        explicit,
        urlValue: readUrlValue('odysseyPerfRefreshTarget'),
        settingsValue: runtime?.settings?.targetFrameRate,
        detectedRefreshRate: readDetectedRefreshRate(),
        fallback: DRS_TARGET_FRAME_RATE,
    });
}

function readOdysseyAdaptiveFrameRate(desiredTargetFrameRate = null) {
    return resolveOdysseyAdaptiveFrameRate({
        desiredTargetFrameRate,
        detectedRefreshRate: readDetectedRefreshRate(),
        fallback: DRS_TARGET_FRAME_RATE,
    });
}

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
        this.adaptiveQualityEnabled = options.adaptiveQuality !== false
            && !readBooleanUrlFlag('odysseyDisableAdaptiveQuality');
        this.debugOverlayActive = false;
        // Diagnostic: un-gate _probeWarmFailure independently of the debug HUD (?odysseyWarmProbe=1).
        // The HUD masks the render-warm setPipeline failure (Heisenbug), so the probe needs its own
        // flag to name the culprit while the bug still reproduces.
        this._warmProbeEnabled = typeof window !== 'undefined' && readBooleanUrlFlag('odysseyWarmProbe');
        this.captureChapterIds = parseChapterIdList(
            options.captureChapterIds || readCaptureChapterIdsFromUrl(),
        );
        this.restrictStartupChapterLoading = this.captureChapterIds.length > 0;
        // Cold-start: only CREATE + COMPILE this window of chapters before reveal (the
        // player's reachable neighbourhood); the rest load + compile in the background.
        // compileAsync is kicked per created chapter, and that async GPU compile is the
        // bulk of cold start — so loading 3 chapters instead of 8 is the real lever.
        // null = load all (full pre-reveal warm). Disable via ?odysseyEagerWindow=0.
        this.startupChapterWindow = (Array.isArray(options.startupChapters) && options.startupChapters.length > 0
            && !readBooleanUrlFlag('odysseyEagerWindowOff'))
            ? options.startupChapters.slice()
            : null;
        // Fast-start (now DEFAULT ON; opt-out ?odysseyFastStartOff=1): reveal the board after
        // warming only the player's current chapter (focusChapter); the rest warm in the
        // post-reveal background render-warm (and, failing that, on first scroll-in). The full
        // pre-reveal journey warm took ~21s (~5.5s/chapter through the post MRT), which is the
        // dominant cold-start cost — far too long for the player to wait before scrolling. The
        // recent material-share pass (~−44 pipeline variants) shrinks each chapter's first-visit
        // compile, so the fast-start trade (a small first-scroll hitch for a ~15s faster reveal)
        // is now clearly worth it. Restore the full pre-reveal warm with ?odysseyFastStartOff=1.
        this.warmupMode = normalizeOdysseyWarmupMode(readUrlValue('odysseyWarmupMode'), {
            fastStartOff: readBooleanUrlFlag('odysseyFastStartOff'),
        });
        this._fastStart = this.warmupMode === 'current';
        this._skipPreRevealWarmup = this.warmupMode === 'off';
        this.focusChapter = Number.isFinite(options.focusChapter) ? options.focusChapter : null;
        // LEVER 2 — chapter LRU eviction (default OFF; opt-in ?odysseyChapterEvict=1, window N=2).
        // Suppressed during capture-restricted runs. When ON it OWNS residency, so the
        // background chapter loader + full background render-warm are disabled (below) to avoid
        // fighting the evictor. NOT auto-enabled on the RTX/keep-alive path — flag-only.
        this.chapterEvictionEnabled = (options.chapterEviction === true
            || readBooleanUrlFlag('odysseyChapterEvict'))
            && !this.restrictStartupChapterLoading;
        this.chapterEvictionWindow = Number.parseInt(readUrlValue('odysseyChapterEvictWindow'), 10) || 2;
        // ONE WORLD (default OFF; opt-in ?odysseyOneWorld=1). Replaces the chapter-2..5 diorama
        // environments with a single continuous surface — see
        // docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md. Flagged rather than switched so the shipped
        // journey is bit-identical until it is capture-verified in the real game.
        // ONE WORLD IS NOW THE DEFAULT PATH for chapters 2-5 (Wave 3). `?odysseyOneWorld=0`
        // forces the legacy dioramas back — a one-URL revert, kept because this replaces the
        // ground under two thirds of the journey and a single query parameter is a cheaper
        // escape hatch than a rebuild.
        const oneWorldParam = getUrlSearchParams()?.get('odysseyOneWorld');
        this.oneWorldEnabled = options.oneWorld === true
            || (options.oneWorld !== false && oneWorldParam !== '0' && oneWorldParam !== 'false');
        this.oneWorld = null;
        this._oneWorldActT = 0;
        // undefined until the first update; `!== false` above keeps pre-gate behaviour then.
        this._oneWorldVisible = undefined;
        this.steamQuench = null;
        this._steamBoundary = NaN;
        this.cloudBank = null;
        this._cloudBankBoundary = NaN;
        // WAVE -1 (docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md §5): GPU-time profiling on its own
        // flag. It used to ride on ?odysseyAAA=1, which meant a measurement run also had to
        // enable the debug overlay — and then measured a frame with the overlay in it.
        this.gpuProfileEnabled = readBooleanUrlFlag('odysseyGpuProfile');
        this.gpuProfileRing = this.gpuProfileEnabled ? new PerfRing(600) : null;
        if (this.gpuProfileRing && typeof window !== 'undefined') {
            // The harness discards everything sampled during startup: a cold pipeline compile
            // is a real cost but a STARTUP cost, and averaging it into steady state hides both.
            window.__ODYSSEY_GPU_RESET__ = () => {
                this.gpuProfileRing.reset();
                // Bump the epoch so a timestamp resolve still in flight from the SETTLE phase
                // cannot land in the freshly-reset measurement window. The harness resets
                // immediately before it starts sampling, so without this exactly one
                // settle-phase frame — the most atypical kind — can enter the window.
                this._gpuTimestampEpoch += 1;
                // Restart the draw-count range with the measurement window (_recordPerfCounters).
                // NOTE: keep this AFTER the epoch bump — odyssey-gpu-profile-sampling.test.js
                // reads the first 700 chars of this function to prove the bump is here.
                this._drawCallsRange = null;
            };
        }
        this._gpuProfileLastSummary = 0;
        // One resolve in flight at a time, and one ring push per RESOLVED query. See
        // _resolveRenderTimestamps for why pushing per FRAME was silently wrong.
        this._gpuTimestampPending = false;
        this._gpuTimestampEpoch = 0;
        // A/B lever for the same wave: 55 nodes x 3 nested transparent shells, never measured.
        this.hideLevelNodes = readBooleanUrlFlag('odysseyHideLevelNodes');
        // LEVER — per-chapter detail LOD (default OFF; opt-in ?odysseyChapterLOD=1). Off-center
        // chapters shed their heaviest sublayers (Ch3's reflector 2nd render, big additive particle
        // clouds) via a detailLevel signal their update() reads — no teardown, no recompile. Stage 1
        // of the lightweight-streaming plan (docs/ODYSSEY_LIGHTWEIGHT_STREAMING_PLAN.md). Suppressed
        // during capture-restricted runs.
        this.chapterLodEnabled = (options.chapterLOD === true
            || readBooleanUrlFlag('odysseyChapterLOD'))
            && !this.restrictStartupChapterLoading;
        this.backgroundChapterLoadingEnabled = options.backgroundChapterLoading !== false
            && !this.restrictStartupChapterLoading
            && !readBooleanUrlFlag('odysseyDisableBackgroundLoading')
            && !this.chapterEvictionEnabled;
        // L8 dome-cull: hide the global atmosphere dome while a single chapter's own
        // full-coverage sky dome fully covers the frame (mid-chapter, not a seam), removing
        // a guaranteed full-screen overdraw layer. Default ON; ?odysseyDomeCullOff=1 reverts
        // to always-visible (today's behaviour). Per-chapter safety (does each chapter's dome
        // fully cover at weight 1?) is capture-verified; the dome is restored at every seam.
        this._domeCullEnabled = !readBooleanUrlFlag('odysseyDomeCullOff');
        this.pixelRatioOverride = Number.isFinite(options.pixelRatioOverride)
            ? Math.min(2, Math.max(0.5, options.pixelRatioOverride))
            : readPixelRatioOverrideFromUrl();
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
        this.targetFrameRateOption = options.targetFrameRate;
        this.targetFrameRate = readOdysseyTargetFrameRate(this.targetFrameRateOption);
        this.adaptiveTargetFrameRate = readOdysseyAdaptiveFrameRate(this.targetFrameRate);

        // GPU-loss resilience (coordinator-registered in initRenderer; see
        // gpu-loss-coordinator.js — Odyssey migration noted there).
        this._gpuMonitorUnsub = null;
        this._gpuSurfaceUnregister = null;

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

        // Interaction/performance tracking
        this.lastInteractionAt = performance.now();
        this.backgroundLoadQuietWindowMs = 700;
        // Frame-health backpressure for speculative background work (chapter creation / prewarm /
        // render-warm). A rolling EMA of the RAW (pre-clamp) frame time: a heavy background build is
        // itself a multi-hundred-ms frame spike, so the EMA jumps and the shared gate closes until
        // the board renders smoothly again → builds self-space instead of back-to-back-freezing the
        // visible board (the post-reveal "feels frozen ~45s" jank). RAW (not the 50ms-clamped delta)
        // so a real build spike is distinguishable from a genuinely slow machine.
        this.frameMsEma = 16.7; // ~60fps seed
        this.frameHealthBudgetMs = 33; // ~30fps floor; above this, pause speculative bg work
        this._bgGateBlockedSince = 0; // starvation escape: force one pass after a long block

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
            targetFrameRate: this.adaptiveTargetFrameRate,
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
            targetFrameRate: this.adaptiveTargetFrameRate,
        };
        this._perfCounters = {
            calls: 0,
            triangles: 0,
            geometries: 0,
            textures: 0,
            programs: 0,
        };
        this._perfSpikeContextCollector = null;
        this._warmupStats = null;
        this._bgRenderWarmStarted = false;
        this._bgRenderWarmComplete = false;
        this._backgroundChapterLoadingStarted = false;
        this._backgroundChapterLoadingTimer = null;
        this._backgroundStartupChapterIds = null;

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
        // WAVE 5: the 2->3 stinger is deferred from ecotone entry and released the frame the
        // eye breaks the surface (ODYSSEY_BREACH_P). Null when nothing is pending.
        this._pendingBreachStinger = null;
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
        const trace = createStartupTrace();
        this._startupTrace = trace;
        this.presentationLayout = derivePresentationLayout(levelData, presentationLayout, this.layoutOverride);
        this.levelData = applyOdysseyLayoutToLevels(levelData, this.presentationLayout);
        this.progressData = progressData;
        setOdysseyPathLayout(this.presentationLayout);

        // Get quality settings
        const quality = window.settings?.effectQuality || 'High';
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.qualityName = quality;
        this.targetFrameRate = readOdysseyTargetFrameRate(this.targetFrameRateOption);
        this.adaptiveTargetFrameRate = readOdysseyAdaptiveFrameRate(this.targetFrameRate);
        this.adaptiveQuality.targetFrameRate = this.adaptiveTargetFrameRate;
        this._adaptiveCtx.targetFrameRate = this.adaptiveTargetFrameRate;

        // STARTUP OPTIMIZATION fallback: ?odysseySerialInit=1 restores the old fully-serial
        // create→compile chain (insurance against a driver that misbehaves when pipeline
        // compiles are launched in parallel).
        const serialInit = new URLSearchParams(window.location.search).get('odysseySerialInit') === '1';

        // ─── Step 1: Lightweight Three.js shell (very fast) ───
        trace.begin('renderer');
        await this.initRenderer();
        // Detect the GPU's KTX2 transcode target now that the renderer exists, so chapter
        // GLBs with KTX2 textures load (no-op for the current uncompressed assets).
        setOdysseyGltfRenderer(this.renderer);
        this.initScene();
        this.initCamera();
        this.createStarfield();
        // Post pipeline is created BEFORE the chapter prewarms (it depends only on
        // renderer/scene/camera): the chapters always render THROUGH the post PassNode's
        // HalfFloat/MRT target, so every prewarm compileAsync below binds that target —
        // building the pipelines that are actually used live, asynchronously, instead of
        // letting them compile SYNCHRONOUSLY inside the warm-up renders (the loading
        // freeze + the bulk of the remaining startup time).
        this.setupPostProcessing();
        trace.end('renderer');

        // Yield — let the loading overlay render & animate smoothly
        await this._yieldToMain();

        // ─── Steps 2+3: Create chapter environments, compiling in PARALLEL ───
        // Default startup creates and warms the whole journey to prevent first-visit hitches.
        // Capture sessions can pass ?odysseyCaptureChapters=... to load only a local chapter
        // window and keep weak GPUs out of the TDR danger zone. compileAsync snapshots its
        // renderables and restores shared renderer state synchronously BEFORE its only await,
        // so launches can overlap safely; the pool barrier sits before the warm-up replay.
        this.environmentManager = new ChapterEnvironmentManager(this.scene, this.renderer, {
            chapterPositions: this.presentationLayout.chapterPositions,
            chapterLOD: this.chapterLodEnabled,
            // Tune the fast-scroll velocity threshold in-game: ?odysseyLodFastSpeed=0.004 (higher =
            // only VERY fast scrolls drop detail; lower = medium scrolls do too). Default 0.0015
            // (must stay below the ~0.0025/frame reachable at the 0.15 maxScrollVelocity cap).
            lodFastThreshold: Number.parseFloat(readUrlValue('odysseyLodFastSpeed')) || undefined,
            suppressedChapters: this.oneWorldEnabled ? ONE_WORLD_CHAPTERS : [],
        });

        if (this.oneWorldEnabled) {
            // A feature flag must never be able to brick boot. If the world fails to build we
            // log it and fall back to the shipped chapter environments rather than leaving the
            // journey with no ground at all — the failure mode that cost a capture cycle here
            // was a silent throw inside init, which just hangs bootstrap with no diagnostic.
            try {
                const weakLane = this.qualityName === 'Minimal' || this.qualityName === 'Low';
                this.oneWorld = createOdysseyWorld({
                    quality: weakLane ? 'low' : 'high',
                    // The post stack owns exposure and applies ACES after it, so the world
                    // must not apply exposure a second time, and must hand over scene-linear
                    // values rather than the display-referred palette the playground wants.
                    applyExposure: ONE_WORLD_APPLY_EXPOSURE,
                    outputScale: ONE_WORLD_OUTPUT_SCALE,
                    outputSaturation: ONE_WORLD_OUTPUT_SATURATION,
                    // Inside the board camera's 9,000 far plane, and inside the shipped
                    // r=4000 atmosphere backstop so the world's sky paints in front of it.
                    skyRadius: ONE_WORLD_SKY_RADIUS,
                    // Bisect lever for the boot-stall investigation (see the plan's BLOCKER
                    // note): ?odysseyWorldNoClouds=1 keeps the deck's pipeline out of the
                    // in-game compile entirely.
                    clouds: !readBooleanUrlFlag('odysseyWorldNoClouds'),
                    // HEROES RETIRED BY THE OWNER, 2026-08-14 — an art-direction call, not a
                    // perf one (they measured 1-2 timer ticks). Two cloud MODELS in one sky do
                    // not cohere: the smooth lobed icosphere masses read as a different object
                    // class next to the deck's flat painted bands, and the owner circled them
                    // in live play twice. Retired per the ADR-0015 pattern (module + tests +
                    // this lever retained, mounting stops): ?odysseyWorldHeroes=1 restores the meshes
                    // AND the deck's hero clearings, which ride the same option.
                    heroes: readBooleanUrlFlag('odysseyWorldHeroes'),
                    // Bisect lever for the Ghibli-water plan's Wave 0: ?odysseyWorldNoWater=1
                    // removes the sea plate entirely. The water is one ungated DoubleSide
                    // transparent clipmap drawing across the whole act window and NOTHING in
                    // the tree could switch it off, so its total cost had never been measured
                    // — and an unmeasured cost cannot fund a water package (ADR-0016).
                    water: !readBooleanUrlFlag('odysseyWorldNoWater'),
                    // Diagnostic re-shades of the deck, for the "keyed to something other than
                    // the camera" defect class: ?odysseyWorldCloudDebug=lattice draws the
                    // clipmap's ring structure over the shipped deck, =alpha draws the opacity
                    // graph alone, =flat leaves only geometry. See createOdysseyWorld.
                    cloudDebug: readUrlValue('odysseyWorldCloudDebug') || null,
                    // WAVE 0 PRICE PROBE for the cloud-field plan: ?odysseyWorldCloudField=1
                    // mounts ~28 probe masses on the retired hero builder + material (zero new
                    // shader code) so the mechanism can be priced before the sculptor exists.
                    cloudField: readBooleanUrlFlag('odysseyWorldCloudField'),
                    cloudFieldCount: Number.parseInt(readUrlValue('odysseyWorldCloudFieldCount'), 10) || 0,
                    // Seat the Ch2 god-ray shafts along the real rail's submerged stretch.
                    railSamples: Array.from(
                        { length: 48 },
                        (_, i) => getOdysseyPathPointAt(i / 47),
                    ),
                });
                this.scene.add(this.oneWorld.group);
                console.log('[OdysseyBoard] One World enabled —', JSON.stringify(this.oneWorld.stats));
            } catch (error) {
                console.error('[OdysseyBoard] One World failed to build; falling back', error);
                this.oneWorld = null;
                this.oneWorldEnabled = false;
                this.environmentManager.suppressedChapters = new Set();
                // LOUD, after the fallback is arranged (Wave 4/6 audit prerequisite): a
                // player-visible banner + a persisted localStorage log. Silent recovery is
                // how we would have retired the fallback while some machine quietly needed
                // it — and how a future world-only build would degrade to a void nobody
                // reports. Reporting must never break the recovery, hence its own guard.
                try {
                    reportWorldBuildFailure(error);
                } catch { /* diagnostic only — never let reporting hurt the fallback */ }
            }
        }
        const compilePool = [];
        this._compilePool = serialInit ? null : compilePool;
        this._compileTimings = {}; // OD-05 scoping: per-item compile ms, emitted after the barrier
        trace.begin('creates');
        this.environmentManager.qualitySettings = {
            ...this.environmentManager.qualitySettings,
            particleCount: this.qualityPreset.particleCount,
        };
        const chapterPositions = this.presentationLayout.chapterPositions || [];
        const totalChapters = Math.max(
            1,
            chapterPositions.length > 0 && chapterPositions[chapterPositions.length - 1] >= 0.999
                ? chapterPositions.length - 1
                : (chapterPositions.length || 8),
        );
        const allChapterIds = Array.from({ length: totalChapters }, (_, index) => index + 1);
        let startupChapterIds = allChapterIds;
        let startupScopeLabel = '';
        // When restricted to a subset, the warm-up must also restrict to it (else it scrolls
        // into deferred chapters and lazily creates them). null = warm the full journey.
        this._activeStartupChapterIds = null;
        if (this.restrictStartupChapterLoading) {
            startupChapterIds = parseChapterIdList(this.captureChapterIds, totalChapters);
            startupScopeLabel = ' (capture scoped)';
        } else if (this.startupChapterWindow && this.backgroundChapterLoadingEnabled) {
            // Only window when background loading is on, so the deferred chapters WILL load.
            const windowed = this.startupChapterWindow
                .filter((id) => Number.isFinite(id) && id >= 1 && id <= totalChapters);
            if (windowed.length > 0 && windowed.length < allChapterIds.length) {
                startupChapterIds = Array.from(new Set(windowed)).sort((a, b) => a - b);
                startupScopeLabel = ` (eager window; ${allChapterIds.length - startupChapterIds.length} deferred to background)`;
                this._activeStartupChapterIds = startupChapterIds;
            }
        }
        console.log(`[OdysseyBoard] Startup chapter set: ${startupChapterIds.join(', ')}${startupScopeLabel}`);

        // A2 EXPERIMENT (?odysseyLightsFirst=1, default OFF): hoist the global atmosphere
        // light rig + build ALL chapter environments (reparenting every chapter's lights into
        // the persistent rig) BEFORE launching any chapter compileAsync, so each prewarm
        // specializes on the FINAL scene light set. The persistent rig "keeps the light set
        // constant" only once every chapter is created — the default interleaved loop compiles
        // chapter 1 before chapters 2..8's lights exist, so the first real render re-specializes
        // the lit pipelines on the grown light-set hash (the ~5.5s/chapter warm suspect). Two
        // passes are required: a single interleaved pass can't see the not-yet-created chapters'
        // lights. Opt-in until a cold Electron boot A/B confirms the win (warm Dawn cache hides
        // the compile cost, so this can only be measured cold).
        const lightsFirst = this.aaaPostActive && readBooleanUrlFlag('odysseyLightsFirst');
        if (lightsFirst) {
            this._createAtmosphereLightRig();
        }

        /* eslint-disable no-await-in-loop */
        for (const ch of startupChapterIds) {
            const createStart = performance.now();
            await this.environmentManager.createChapterEnvironment(ch);
            const createMs = performance.now() - createStart;
            // Diagnostic: surface unusually heavy CPU bakes so the trace pinpoints which
            // chapter to optimize next (only logs outliers — no per-boot spam).
            if (createMs > 150) {
                trace.event(`create ch${ch} took ${Math.round(createMs)}ms`);
            }
            // Default path: launch this chapter's compile immediately (interleaved with the
            // next chapter's create). In lightsFirst mode, defer ALL compiles to pass 2 below.
            if (!lightsFirst) {
                if (serialInit) {
                    await this._prewarmChapterEnvironment(ch);
                } else {
                    compilePool.push(this._timedCompile(`ch${ch}`, this._prewarmChapterEnvironment(ch)));
                }
            }
            await this._yieldToMain();
        }
        if (lightsFirst) {
            // Pass 2 — the full light set (atmosphere + every chapter's reparented lights) is
            // now resident, so every chapter pipeline compiles against the light-set hash it
            // will actually render with. No first-render re-specialization.
            for (const ch of startupChapterIds) {
                if (serialInit) {
                    await this._prewarmChapterEnvironment(ch);
                } else {
                    compilePool.push(this._timedCompile(`ch${ch}`, this._prewarmChapterEnvironment(ch)));
                }
                await this._yieldToMain();
            }
        }
        /* eslint-enable no-await-in-loop */
        this.environmentManager.updateVisibility(this.environmentManager.cameraProgress, { mode: 'progress' });

        // LEVER 2 — hand residency to the manager once the startup window is built. The
        // onRecreated hook re-queues prewarm + an offscreen render-warm so a chapter re-entering
        // the window is GPU-ready before it draws (no first-visit compile hitch on re-approach).
        if (this.chapterEvictionEnabled && this.environmentManager) {
            this.environmentManager.setChapterEviction({
                enabled: true,
                window: this.chapterEvictionWindow,
                onRecreated: (chapterId) => {
                    const env = this.environmentManager.environments.get(chapterId);
                    if (env) env._renderWarmed = false;
                    this._queueChapterPrewarm(chapterId);
                    if (env && this.isActive) {
                        // Warm AFTER the async prewarm compile resolves. Rendering synchronously in
                        // the SAME tick we queued the prewarm is a GUARANTEED (not merely racy)
                        // setPipeline(undefined) throw — the same warm-render-beats-compile bug the
                        // background sweep now guards (compileAsync leaves .pipeline undefined until
                        // its promise resolves). Defer with a bounded prewarmed-poll.
                        this._deferRenderWarm(chapterId, env, 0);
                    }
                },
            });
        }
        trace.end('creates');

        // ─── Step 4: Build path ───
        // Diegetic per-chapter path is part of the default cinematic journey.
        trace.begin('path');
        this.pathRenderer = new OdysseyPathRenderer(this.scene, { aaa: this.cinematicJourneyActive });
        await this.pathRenderer.buildPath({
            ...ODYSSEY_PATH_DATA,
            controlPoints: this.presentationLayout.controlPoints,
            chapterPositions: this.presentationLayout.chapterPositions,
        });
        trace.end('path');

        await this._yieldToMain();

        // ─── Step 5: Create level nodes (55 nodes) ───
        trace.begin('nodes');
        this.nodeManager = new LevelNodeManager(this.scene, this.pathRenderer.pathCurve);
        this.nodeManager.setCamera(this.camera);
        // Node focal hierarchy + per-world shells ride the same always-on spine.
        this.nodeManager.setAAAVisualsEnabled(this.cinematicJourneyActive);
        // ONE WORLD Wave 3: level orbs consult the CPU mirror of the drawn ground, so a node
        // can never sit inside a rise the shader displaced above the spline. Act II only —
        // outside it the chapters own their ground, and Ch1's nodes are UNDER the terrain.
        if (this.oneWorld) {
            const cp = this.presentationLayout.chapterPositions;
            this.nodeManager.setGroundSampler(this.oneWorld.heightAt, {
                clearance: 7,
                rangeStart: cp[1],
                rangeEnd: cp[5],
            });
        }
        await this.nodeManager.createNodes(this.levelData, this._yieldToMain.bind(this));
        this.nodeManager.updateFromProgress(this.progressData);
        // A/B lever, applied HERE so it works on its own (fixed 2026-08-12). It used to be
        // read only inside _sampleGpuProfile, i.e. ?odysseyHideLevelNodes=1 was a silent
        // no-op unless ?odysseyGpuProfile=1 was also passed — so anyone running the
        // comparison by hand from the URL measured two identical frames and concluded the
        // level nodes were free.
        if (this.hideLevelNodes) this.nodeManager.setAllVisible(false);
        trace.end('nodes');

        await this._yieldToMain();

        // ─── Step 6: Camera, post-processing, lighting, interaction ───
        this.cameraController = new OdysseyCameraController(
            this.camera,
            this.pathRenderer.pathCurve,
            {
                levelPositions: this.presentationLayout.levelPositions,
                chapterPositions: this.presentationLayout.chapterPositions,
                startPosition: this.presentationLayout.levelPositions[0] ?? 0,
                // Tune scroll FEEL in-game. scrollSpeed = sensitivity (the primary mousepad "too
                // fast" lever): ?odysseyScrollSpeed=0.05 (slower) .. 0.15 (old). Default 0.09.
                // maxScrollVelocity = the hard-flick cap: ?odysseyMaxScroll=0.1 .. 0.4. Default 0.15.
                scrollSpeed: Number.parseFloat(readUrlValue('odysseyScrollSpeed')) || undefined,
                maxScrollVelocity: Number.parseFloat(readUrlValue('odysseyMaxScroll')) || undefined,
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

        trace.begin('post+director');
        this.setupLighting();
        await this.setupDirector();
        this._applyChapterMusic(1, { reason: 'odyssey-board-initial' });
        trace.end('post+director');

        await this._yieldToMain();

        if (this.editorMode) {
            await this.initializeLayoutEditor();
        }

        // ─── Step 7: Interaction + compile barrier + warm-up + start render loop ───
        this.setupInteraction();
        this._registerPerfMonitorHooks();

        // Barrier: every chapter (and corridor/breach) compileAsync launched above must
        // land before the warm-up replay, so warm renders never serialize on a compile.
        trace.begin('compiles');
        await Promise.all(compilePool);
        this._compilePool = null;
        trace.end('compiles');
        // OD-05 scoping: emit the per-item compile breakdown. The barrier duration is the MAX
        // label; deferring the long-pole neighbor (vs the focus chapter) is the OD-05 win, so
        // this number is what justifies (or kills) the focus-only barrier split.
        const compileBreakdown = Object.entries(this._compileTimings)
            .sort((a, b) => b[1] - a[1])
            .map(([label, ms]) => `${label}=${ms}`)
            .join(' ');
        if (compileBreakdown) trace.event(`compile-breakdown ${compileBreakdown}`);

        // Replay the journey once (behind the loader) so first-visit per-chapter costs
        // (compile-through-post, GPU upload, first update(), the breach) are paid now, not on
        // the first live transition into each new chapter.
        trace.begin('warmup');
        await this._warmUpJourney();
        trace.end('warmup');

        this.isActive = true;
        this.animate();
        if (this.backgroundChapterLoadingEnabled) {
            this._queueChapterPrewarm(2);
            this._backgroundStartupChapterIds = startupChapterIds.slice();
            this.startDeferredBackgroundLoading({
                delayMs: Number.parseFloat(readUrlValue('odysseyBackgroundLoadDelayMs')) || 1800,
            });
        }

        // After reveal, render-warm every chapter we did NOT warm pre-reveal — OFFSCREEN,
        // during idle — so the first live scroll-in never compiles on a visible frame. This
        // is what actually removes the first-visit hitch (the prewarm queue above only does
        // compileAsync, which does not pay the real first-render compile + GPU upload). Fixes
        // the hitch for chapters 4-8 in every mode, and for the deferred chapters in fast-start.
        this._startBackgroundRenderWarm();

        trace.summary();
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

    async _syncGpuQueueForDiagnostics() {
        const queue = this.renderer?.backend?.device?.queue;
        if (typeof queue?.onSubmittedWorkDone !== 'function') return false;
        await queue.onSubmittedWorkDone();
        return true;
    }

    _registerPerfMonitorHooks() {
        const perf = typeof window !== 'undefined' ? window.perfMonitor : null;
        if (!perf?.setSpikeContextCollector) return;

        this._perfSpikeContextCollector = () => this._buildPerfContext({ spike: true });
        perf.setSpikeContextCollector(this._perfSpikeContextCollector);
    }

    _recordPerfCounters() {
        const perf = typeof window !== 'undefined' ? window.perfMonitor : null;
        if (!perf?.recordCounters || !this.renderer?.info) return;

        const { memory = {}, render = {}, programs } = this.renderer.info;
        this._perfCounters.calls = render.drawCalls ?? render.calls ?? 0;
        // FLICKER INSTRUMENT: the harness's content-match check compares ONE frame's draw
        // count per run, which cannot tell a per-frame flicker (frustum edge, timed visibility)
        // from a one-shot settling event (async build landing inside the window). Track the
        // range since the last __ODYSSEY_GPU_RESET__; min==max exonerates the steady state.
        const { calls } = this._perfCounters;
        if (this._drawCallsRange) {
            if (calls < this._drawCallsRange.min) this._drawCallsRange.min = calls;
            if (calls > this._drawCallsRange.max) this._drawCallsRange.max = calls;
        } else {
            this._drawCallsRange = { min: calls, max: calls };
        }
        this._perfCounters.triangles = render.triangles ?? 0;
        this._perfCounters.geometries = memory.geometries ?? 0;
        this._perfCounters.textures = memory.textures ?? 0;
        this._perfCounters.programs = Array.isArray(programs) ? programs.length : (programs ?? 0);
        perf.recordCounters(this._perfCounters);
    }

    _buildPerfContext({ spike = false } = {}) {
        const directorState = this.director?.getState?.() || null;
        const blendState = this.environmentManager?.getBlendState?.(
            this.cameraController?.getCurrentPosition?.() ?? 0,
        ) || null;
        const info = this.renderer?.info || {};
        const canvas = this.renderer?.domElement;
        const render = info.render || {};
        const memory = info.memory || {};

        return {
            source: 'odyssey',
            spike,
            warmupMode: this.warmupMode,
            targetFrameRate: this.targetFrameRate,
            adaptiveTargetFrameRate: this.adaptiveTargetFrameRate,
            detectedRefreshRate: readDetectedRefreshRate(),
            backend: this.isWebGPU ? 'webgpu' : (this.isWebGL ? 'webgl2' : 'unknown'),
            quality: this.qualityName,
            activeChapter: directorState?.activeChapter ?? blendState?.activeChapter ?? this.lastActiveChapter,
            boundaryId: directorState?.boundaryId ?? blendState?.boundaryId ?? null,
            inSeam: !!(directorState?.inSeam || blendState?.inSeam),
            seamProgress: directorState?.seamProgress ?? blendState?.seamProgress ?? null,
            progress: this.cameraController?.getCurrentPosition?.() ?? null,
            settled: this._isCameraSettled(),
            pendingChapterLoads: this.pendingChapterLoads?.size ?? 0,
            prewarmQueue: this.prewarmQueue?.length ?? 0,
            isPrewarming: !!this.isPrewarming,
            bgRenderWarm: {
                started: !!this._bgRenderWarmStarted,
                complete: !!this._bgRenderWarmComplete,
                current: this._bgRenderWarmCurrent ?? null,
                pending: this._bgRenderWarmPending ?? 0,
            },
            adaptive: this.adaptiveQuality?.getState?.() ?? null,
            post: this.postProcessingStack?.getPerfState?.() ?? {
                active: !!this.postProcessingStack,
                bloomEnabled: this.postProcessingStack?._bloomAllowed ?? null,
                bloomScale: this.postProcessingStack?.bloomScale ?? null,
            },
            canvas: canvas ? {
                width: canvas.width,
                height: canvas.height,
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight,
            } : null,
            render: {
                calls: render.drawCalls ?? render.calls ?? 0,
                triangles: render.triangles ?? 0,
                timestamp: render.timestamp ?? null,
            },
            memory: {
                geometries: memory.geometries ?? 0,
                textures: memory.textures ?? 0,
            },
        };
    }

    getPerfSnapshot(extra = {}) {
        return {
            ...extra,
            timestamp: new Date().toISOString(),
            odyssey: this._buildPerfContext(),
            warmup: this._warmupStats,
            startupMeasures: performance.getEntriesByType?.('measure')
                ?.filter((entry) => entry.name.startsWith('odyssey:'))
                ?.map((entry) => ({
                    name: entry.name,
                    duration: Math.round(entry.duration),
                })) || [],
        };
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

    /** @private true when recent frames are smooth enough to steal main-thread time for bg work. */
    _isFrameHealthy() {
        if (typeof document !== 'undefined' && document.hidden) return true; // nothing to stutter
        return this.frameMsEma <= this.frameHealthBudgetMs;
    }

    _canRunBackgroundTask() {
        // Interaction-idle + camera-settled are the "user isn't busy" gate; frame-health is the
        // "board isn't already stuttering" gate — the three background paths (creation, prewarm,
        // render-warm) all funnel through here, so this one term backpressures every speculative
        // build. Starvation escape: if the board is idle+settled but stays frame-unhealthy for a
        // sustained window (e.g. a weak GPU whose ch1 alone exceeds budget), force one pass so
        // loading always completes (otherwise chapters never prebuild → first scroll hard-hitches).
        if (!(this._isInteractionIdle() && this._isCameraSettled())) return false;
        if (this._isFrameHealthy()) {
            this._bgGateBlockedSince = 0;
            return true;
        }
        if (!this._bgGateBlockedSince) this._bgGateBlockedSince = performance.now();
        if (performance.now() - this._bgGateBlockedSince > 8000) {
            this._bgGateBlockedSince = 0;
            return true;
        }
        return false;
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

        // AAA warm pipeline (Stage 3): compile the queued chapters CONCURRENTLY instead of
        // one-at-a-time. compileAsync is a background-thread GPU op that pipelines, so the old
        // serial drain let ONE slow chapter (surface-world's ~15-material compile) block every
        // later chapter's compile for many seconds — the player then scrolls into ch4-8 before
        // they are prewarmed = the first-visit hitch. Firing the whole pending set at once during
        // idle (this path only runs when idle + camera-settled + frame-healthy, so the concurrent
        // GPU burst does not contend with an active scroll) gets them all ready in ~max(compile)
        // instead of sum(compile). Nearest-to-player first so the closest chapters resolve soonest.
        const focus = Number.isFinite(this.focusChapter) ? this.focusChapter : 1;
        this.prewarmQueue.sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus));
        // Bounded concurrency: compile up to N nearest chapters at once so a slow chapter
        // (surface-world's ~15-material compile) never serially blocks the rest, WITHOUT an
        // unbounded GPU burst that would starve the create loop / stutter the orient-pause.
        const batch = this.prewarmQueue.splice(0, 3);
        batch.forEach((ch) => this.queuedPrewarmChapters.delete(ch));
        this.isPrewarming = true;

        try {
            await Promise.all(batch.map((ch) => this._prewarmChapterEnvironment(ch)));
        } finally {
            this.isPrewarming = false;
        }

        if (this.prewarmQueue.length > 0) {
            this._schedulePrewarmDrain(60);
        }
    }

    /**
     * After reveal, render-warm every chapter not warmed pre-reveal — OFFSCREEN, one at a
     * time during idle, nearest the player first — so the first live scroll-in never compiles
     * on a visible frame (the first-visit hitch). Disable with ?odysseyBgWarm=0.
     * @private
     */
    startDeferredBackgroundLoading({ delayMs = 0 } = {}) {
        if (!this.backgroundChapterLoadingEnabled || !this.environmentManager) return;
        if (this._backgroundChapterLoadingStarted) return;

        const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
        if (delay > 0) {
            if (this._backgroundChapterLoadingTimer) return;
            this._backgroundChapterLoadingTimer = setTimeout(() => {
                this._backgroundChapterLoadingTimer = null;
                this.startDeferredBackgroundLoading();
            }, delay);
            return;
        }

        if (this._backgroundChapterLoadingTimer) {
            clearTimeout(this._backgroundChapterLoadingTimer);
            this._backgroundChapterLoadingTimer = null;
        }

        this._backgroundChapterLoadingStarted = true;
        const startupChapterIds = Array.isArray(this._backgroundStartupChapterIds)
            ? this._backgroundStartupChapterIds
            : [];

        this.environmentManager.loadChaptersInBackground(startupChapterIds, {
            canRunTask: () => this._canRunBackgroundTask(),
            onEnvironmentCreated: (chapterId) => {
                this._queueChapterPrewarm(chapterId);
            },
        });
    }

    _startBackgroundRenderWarm() {
        if (this._bgRenderWarmStarted) return;
        // LEVER 2: when chapter eviction owns residency, do NOT sweep-warm all 8 chapters —
        // they would be evicted again moments later. Each chapter is render-warmed on approach
        // via the setChapterEviction onRecreated hook instead.
        if (this.chapterEvictionEnabled) {
            this._bgRenderWarmStarted = true;
            this._bgRenderWarmComplete = true;
            return;
        }
        this._bgRenderWarmStarted = true;
        this._bgRenderWarmComplete = false;
        this._bgRenderWarmCurrent = null;
        this._bgRenderWarmPending = 0;
        // Default ON; opt out with ?odysseyBgWarm=0.
        if (typeof window !== 'undefined') {
            try {
                const v = new URLSearchParams(window.location?.search || '').get('odysseyBgWarm');
                if (v === '0' || v === 'false' || v === 'off' || readBooleanUrlFlag('odysseyPerfDisableBackgroundWarm')) {
                    this._bgRenderWarmComplete = true;
                    return;
                }
            } catch { /* default on */ }
        }

        const chapterPositions = this.presentationLayout?.chapterPositions || [];
        const total = Math.max(
            1,
            chapterPositions.length > 0 && chapterPositions[chapterPositions.length - 1] >= 0.999
                ? chapterPositions.length - 1
                : (chapterPositions.length || 8),
        );
        const focus = Number.isFinite(this.focusChapter) ? this.focusChapter : 1;
        const order = [];
        for (let ch = 1; ch <= total; ch += 1) order.push(ch);
        // Warm the chapters nearest the player's position first.
        order.sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus));
        this._bgRenderWarmPending = order.length;

        let idx = 0;
        const step = () => {
            if (!this.isActive || this.isRenderingPaused) {
                setTimeout(step, 500);
                return;
            }
            if (idx >= order.length) {
                this._bgRenderWarmCurrent = null;
                this._bgRenderWarmPending = 0;
                this._bgRenderWarmComplete = true;
                console.log('[OdysseyWarmup] background render-warm complete');
                return;
            }
            if (!this._canRunBackgroundTask()) {
                setTimeout(step, 200);
                return;
            }
            // WARM AHEAD OF THE CAMERA: re-target toward the player's LIVE position each step —
            // warm the un-warmed chapter nearest the CURRENT focus next (swap it to idx), so the
            // sweep chases the scroll direction instead of following a stale start-time order. The
            // chapter the user is scrolling TOWARD is warmed before arrival, which is the point of
            // killing the first-visit hitch (revisits were already smooth once warmed).
            const liveFocus = Number.isFinite(this.focusChapter) ? this.focusChapter : focus;
            let bestJ = idx;
            for (let j = idx + 1; j < order.length; j += 1) {
                if (Math.abs(order[j] - liveFocus) < Math.abs(order[bestJ] - liveFocus)) bestJ = j;
            }
            if (bestJ !== idx) {
                const swap = order[idx];
                order[idx] = order[bestJ];
                order[bestJ] = swap;
            }
            const ch = order[idx];
            this._bgRenderWarmCurrent = ch;
            this._bgRenderWarmPending = Math.max(0, order.length - idx);
            const env = this.environmentManager?.environments?.get(ch);
            if (!env) {
                // Not created yet. Normally it background-loads shortly — but in capture/restricted
                // startup the deferred chapters are NEVER created (eviction + background loading are
                // forced off) while `order` still spans the full journey, so an UNBOUNDED wait here
                // hangs the sweep forever → _bgRenderWarmComplete never sets → the adaptive controller
                // stays frozen all session (the freeze gate in _tickAdaptiveQuality). Bound it like the
                // prewarm wait below: after a grace window, SKIP a chapter that never materialises so
                // the sweep always reaches completion (session-review finding 2026-07-05).
                if (!this._bgWarmMissWaits) this._bgWarmMissWaits = {};
                this._bgWarmMissWaits[ch] = (this._bgWarmMissWaits[ch] || 0) + 1;
                if (this._bgWarmMissWaits[ch] <= 30) { // ~30 × 300ms = 9s for a real bg create to land
                    setTimeout(step, 300);
                    return;
                }
                idx += 1; // give up on this never-created chapter — advance so the sweep can finish
                setTimeout(step, 60);
                return;
            }
            // Do NOT render-warm until this chapter's async compile (prewarm) has RESOLVED.
            // _renderWarmChapterOffscreen does a SYNCHRONOUS renderer.render(); warming a chapter
            // whose pipelines are still building via compileAsync makes WebGPU bind a not-yet-ready
            // pipeline → "setPipeline … not of type GPURenderPipeline" (the ch3/5/8 warm failures —
            // console showed the warm firing BEFORE "Prewarmed chapter N shaders"). Bounded wait so
            // a stuck/rejected compile can't hang the sweep (which would leave _bgRenderWarmComplete
            // false forever); after the grace window, proceed — the live loop still warms on visit.
            if (!env.prewarmed) {
                if (!this._bgWarmWaits) this._bgWarmWaits = {};
                this._bgWarmWaits[ch] = (this._bgWarmWaits[ch] || 0) + 1;
                if (this._bgWarmWaits[ch] <= 30) { // ~30 × 200ms = 6s for the compile to land
                    setTimeout(step, 200);
                    return;
                }
                console.warn(`[OdysseyWarmup] chapter ${ch} still not prewarmed after grace window — warming anyway`);
            }
            idx += 1;
            if (!env._renderWarmed) {
                const warmed = this._renderWarmChapterOffscreen(ch, env);
                if (warmed) {
                    env._renderWarmed = true;
                } else {
                    // The offscreen warm threw setPipeline(undefined) — a compile-vs-warm race
                    // (ch3/5/8 on a cold GPU). Do NOT mark it warmed; RE-QUEUE it (bounded) so a
                    // later pass — after the pipeline fully resolves — actually warms it, instead of
                    // the chapter compiling on-screen on first visit (the 205ms seam hitch).
                    this._bgWarmRetries = this._bgWarmRetries || {};
                    this._bgWarmRetries[ch] = (this._bgWarmRetries[ch] || 0) + 1;
                    if (this._bgWarmRetries[ch] <= 5) order.push(ch);
                }
            }
            this._bgRenderWarmCurrent = null;
            this._bgRenderWarmPending = Math.max(0, order.length - idx);
            // Tighter cadence (was 120ms) so the orient-pause + each settle-pause warm MORE chapters
            // before the user scrolls on — this delay only runs between successful warms in an idle/
            // settled window (active scroll bails at the _canRunBackgroundTask gate above), so it
            // never bunches warm renders onto a live scroll frame.
            setTimeout(step, 75);
        };
        setTimeout(step, 280); // let the reveal settle briefly, then warm ahead during the orient-pause
    }

    /**
     * Render-warm a chapter once its async prewarm compile has RESOLVED (env.prewarmed). Used by
     * the eviction re-approach hook, where the chapter was just re-created + its prewarm queued in
     * the same tick — warming synchronously then throws setPipeline(undefined). Bounded poll so a
     * stuck/rejected compile never leaves a dangling timer chain. @private
     */
    _deferRenderWarm(chapterId, env, attempt) {
        if (!this.isActive || !env || env._renderWarmed) return;
        if (!env.prewarmed && attempt < 30) { // ~30 × 200ms = 6s grace for the compile to land
            setTimeout(() => this._deferRenderWarm(chapterId, env, attempt + 1), 200);
            return;
        }
        this._renderWarmChapterOffscreen(chapterId, env);
        env._renderWarmed = true;
    }

    /**
     * Render one chapter's group OFFSCREEN (to the post scene-pass target, not the canvas) so
     * its real pipelines compile + geometry/textures upload now. No camera move — just force
     * the group visible — so this never triggers chapter-change/music side effects or a flash.
     * @private
     */
    _renderWarmChapterOffscreen(chapterId, env) {
        const group = env?.group;
        if (!group || !this.renderer || !this.scene || !this.camera) return false;
        // Bind the offscreen post scene-pass target FIRST; if post is inactive (null), skip —
        // rendering would otherwise hit the canvas and FLASH the warming chapter's full-screen
        // sky dome (BackSide, renderOrder -100) for a frame. The live loop warms it in the
        // no-post fallback instead.
        const saved = this._beginPostTargetCompile();
        if (!saved) return false;
        let succeeded = false;
        const prevVisible = group.visible;
        const frustumOverrides = [];
        group.traverse((child) => {
            if (child?.isMesh || child?.isPoints || child?.isLine || child?.isSprite) {
                frustumOverrides.push({ child, frustumCulled: child.frustumCulled });
                child.frustumCulled = false;
            }
        });
        try {
            group.visible = true;
            this.renderer.render(this.scene, this.camera);
            succeeded = true;
        } catch (error) {
            console.warn(`[OdysseyBoard] Background render-warm failed for chapter ${chapterId}:`, error?.message || error);
            // DIAGNOSTIC (debug overlay only, ?odysseyAAA=1): the failure-path probe re-renders the
            // WHOLE scene once PER chapter drawable (~46 renders/chapter) to name the culprit mesh.
            // That is pure main-thread waste in normal play — it fired for ch3/ch5/ch8, adding
            // ~138 stray full-scene renders to the post-reveal background-load window (a real chunk
            // of the "feels frozen for ~45s" jank). Gate it to the debug flag so shipped/normal runs
            // just log the one warning above and move on; ?odysseyAAA=1 still gets the culprit probe.
            if (this.debugOverlayActive || this._warmProbeEnabled) {
                if (!this._warmProbedChapters) this._warmProbedChapters = new Set();
                if (!this._warmProbedChapters.has(chapterId)) {
                    this._warmProbedChapters.add(chapterId);
                    this._probeWarmFailure(chapterId, group);
                }
            }
        } finally {
            this._endPostTargetCompile(saved);
            group.visible = prevVisible;
            frustumOverrides.forEach(({ child, frustumCulled }) => {
                child.frustumCulled = frustumCulled;
            });
        }
        return succeeded;
    }

    /**
     * DIAGNOSTIC: a chapter's render-warm threw an invalid-pipeline error. Find the exact
     * culprit by hiding all of the chapter's drawables, then revealing them ONE at a time and
     * re-rendering — the reveal that re-throws names the offending mesh/material/geometry. Runs
     * once per failing chapter on the rare failure path; renders the scene N times (N = chapter
     * drawables) so it is deliberately gated to that path only. Saves+restores each mesh's
     * visibility. The post target is still bound by the caller. @private
     */
    _probeWarmFailure(chapterId, group) {
        const meshes = [];
        group.traverse((child) => {
            if (child?.isMesh || child?.isPoints || child?.isLine || child?.isSprite) meshes.push(child);
        });
        const savedVisible = meshes.map((m) => m.visible);
        meshes.forEach((m) => { m.visible = false; });
        let culprits = 0;
        for (let i = 0; i < meshes.length; i += 1) {
            const mesh = meshes[i];
            mesh.visible = true;
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (err) {
                culprits += 1;
                const attrs = mesh.geometry?.attributes ? Object.keys(mesh.geometry.attributes) : [];
                const mat = mesh.material;
                console.warn(
                    `[OdysseyBoard][WARM-PROBE] ch${chapterId} CULPRIT #${culprits}: name="${mesh.name || '(unnamed)'}" `
                    + `objType=${mesh.type} matType=${mat?.type} blending=${mat?.blending} side=${mat?.side} `
                    + `transparent=${mat?.transparent} hasPositionNode=${!!mat?.positionNode} `
                    + `attrs(${attrs.length})=[${attrs.join(',')}] instanced=${!!mesh.geometry?.isInstancedBufferGeometry}`,
                    err?.message || err,
                );
                mesh.visible = false; // remove the bad mesh and keep probing for more
            }
        }
        if (culprits === 0) {
            console.warn(`[OdysseyBoard][WARM-PROBE] ch${chapterId}: no single chapter mesh reproduced the error in isolation — culprit is likely a shared/non-chapter object or an inter-object state.`);
        }
        meshes.forEach((m, i) => { m.visible = savedVisible[i]; });
    }

    /**
     * Bind the post scene-pass render target + MRT before a prewarm compileAsync, so the
     * compiled pipelines match the path the chapters ACTUALLY render through live (the
     * PassNode's HalfFloat/MRT target — see Renderer.compileAsync, which reads the
     * currently bound target for its render context, and PassNode.compileAsync upstream,
     * which uses this exact bind/compile/restore recipe). Without this, compileAsync
     * built canvas-format pipelines that the post path never uses, and the REAL pipelines
     * compiled synchronously inside the warm-up renders — the loading-screen freeze.
     * Returns the state to pass to _endPostTargetCompile, or null when post is inactive
     * (direct-to-canvas rendering — the plain compile is then correct as-is).
     * @private
     */
    // E2: the post-target compile mechanics live in warmup/post-target-compile.js (pure, testable,
    // no board state). These stay as thin wrappers so every internal caller is unchanged.
    /** @private */
    _beginPostTargetCompile() {
        return beginPostTargetCompile(this.renderer, this.postProcessingStack, this._renderLoopActive());
    }

    /**
     * Is the rAF loop live? Binding the post scene-pass target for a compileAsync while it is
     * hands WebGPU the same texture as both a sampled binding and a render attachment inside one
     * encoder, which kills the device permanently (see warmup/post-target-compile.js).
     * @private
     */
    _renderLoopActive() {
        return this.animationFrameId !== null && this.animationFrameId !== undefined;
    }

    /** @private */
    _endPostTargetCompile(saved) {
        endPostTargetCompile(this.renderer, saved);
    }

    /** @private */
    _compileGroupThroughPost(group) {
        return compileGroupThroughPost(
            this.renderer,
            this.postProcessingStack,
            this.scene,
            this.camera,
            group,
            this._renderLoopActive(),
        );
    }

    /**
     * OD-05 scoping instrumentation: wrap a compile-pool promise so its wall time
     * (push → resolve) is recorded per label in this._compileTimings. Behavior-neutral —
     * resolves exactly as the wrapped promise. The barrier is bounded by the MAX label; the
     * breakdown reveals the neighbor chapter's true share before an OD-05 focus-only split.
     */
    _timedCompile(label, promise) {
        const start = performance.now();
        return Promise.resolve(promise).then((value) => {
            this._compileTimings[label] = Math.round(performance.now() - start);
            return value;
        });
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
            // scene, against the POST pass target (the pipelines the chapter actually uses
            // live). Compilation is async (createRenderPipelineAsync) — never blocks main.
            await this._compileGroupThroughPost(group);

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
            // Compile against the post pass target (the live render path) — async, never
            // blocks main. See _compileGroupThroughPost.
            await this._compileGroupThroughPost(group);
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

    async initRenderer() {
        const pixelRatio = this.pixelRatioOverride ?? computeScenePixelRatio({
            renderScale: this._drs.renderScale,
            devicePixelRatio: window.devicePixelRatio || 1,
            maxPixelRatio: ODYSSEY_MAX_PIXEL_RATIO,
            sceneType: 'odyssey',
            // Pass the selected quality tier so the user's setting actually governs Odyssey
            // resolution. Without it computeScenePixelRatio defaults to 'High', hard-locking
            // the browser (no desktop policy) to the High cap — Ultra/Extreme were unreachable
            // and the scene stayed soft on capable GPUs (user low-res report 2026-07-05).
            qualityTier: this.qualityName,
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
            // Lane B of the §8 budget is the Radeon 610M iGPU, and a run that asks for
            // 'high-performance' gets handed the discrete part no matter what Chromium's
            // force_low_power_gpu switch says — the measurement would silently be Lane A
            // again, at Lane B's resolution, and nobody would be able to tell from the file.
            powerPreference: readBooleanUrlFlag('odysseyLowPowerGpu') ? 'low-power' : 'high-performance',
            // Batch0: enable GPU timestamp tracking so renderer.info.render.timestamp is
            // populated (resolved after each render). ONLY when the ?odysseyAAA debug overlay is
            // active — otherwise the query pool fills and overflows (the renderer tracks queries
            // that nothing resolves once the per-frame resolve is gated to the overlay too).
            trackTimestamp: isOdysseyAAADebugEnabled() || readBooleanUrlFlag('odysseyGpuProfile'),
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

        // GPU-loss resilience (plan §4.2): a WebGPU device loss is TERMINAL (no restore
        // event) — without this, the board renders black forever with unhandled
        // popErrorScope rejections. Monitor the device so the loss is broadcast on the
        // bus, and register with the coordinator so the loss stops the render loop and
        // routes out through the coordinator's existing path (EXIT_TO_MAIN_MENU). No
        // in-place Odyssey rebuild is attempted: recover() throws so the coordinator's
        // failure path routes out immediately — the same terminal one-attempt-then-out
        // treatment WebGPU losses already get for themes.
        if (this.isWebGPU) {
            const device = this.renderer.backend?.device || null;
            if (device) {
                this._gpuMonitorUnsub = gpuResilience.monitorWebGPU(device, { label: 'odyssey-board' });
            }
            this._gpuSurfaceUnregister = registerGpuSurface('odyssey-board', {
                recover: () => {
                    this.pauseRendering();
                    throw new Error('Odyssey WebGPU device loss is terminal — routing out');
                },
            });
        }
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
            const bloomScaleOverride = Number.parseFloat(readUrlValue('odysseyPerfBloomScale'));
            const postQualityOverride = Number.parseFloat(readUrlValue('odysseyPerfPostQuality'));
            const bloomScale = Number.isFinite(bloomScaleOverride)
                ? Math.min(1, Math.max(0.1, bloomScaleOverride))
                : ODYSSEY_BLOOM_SCALE;
            // WebGPU TSL post graph: bloom + ACES + per-chapter grade + CA + vignette + grain.
            // API-compatible with the old PostProcessingStack (update/render/resize/seam/dispose).
            this.postProcessingStack = new OdysseyTslPipeline(this.renderer, this.scene, this.camera, {
                // Tamed from the preset default: the additive path/node glow was blowing out
                // to pure white (see journey audit). Lower strength + higher threshold so only
                // genuinely bright emitters bloom and the scene keeps its colour/contrast.
                enableBloom: this.qualityPreset.enableBloom !== false
                    && !readBooleanUrlFlag('odysseyPerfDisableBloom'),
                bloomScale,
                bloomStrength: 0.32,
                bloomThreshold: 0.85,
                bloomRadius: 0.7,
                // Scene-pass MSAA (meadow petal aliasing fix), High tier and above only —
                // the sub-pixel wildflower geometry needs real sample coverage; lower tiers
                // keep QW1's zero-sample pass (the iGPU budget that motivated it).
                sceneSamples: ['High', 'Ultra', 'Extreme'].includes(this.qualityName) ? 4 : 0,
            });
            if (Number.isFinite(postQualityOverride)) {
                this.postProcessingStack.setPostQuality(postQualityOverride);
            }
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
     * A2 — create the global atmosphere light rig (ambient + key + fill) so it exists
     * BEFORE the chapter compile pool launches (opt-in via ?odysseyLightsFirst=1). In the
     * default path this rig is born in setupDirector() AFTER the compile barrier, so the
     * first real render re-specializes every lit chapter pipeline on the changed light-set
     * hash (the ~5.5s/chapter warm-render suspect). Idempotent — setupDirector() reuses
     * this.atmosphere when it's already been hoisted. Same motivation as the post-target
     * hoist in initialize() (compiles must see their final render/lighting context).
     */
    _createAtmosphereLightRig() {
        if (this.atmosphere || !this.aaaPostActive) return;
        try {
            this.atmosphere = new OdysseyAtmosphere(this.scene, this.renderer);
            this.environmentManager?.setAtmosphereOwned(true);
            console.log('[OdysseyBoard] Atmosphere light rig hoisted before compile pool (odysseyLightsFirst)');
        } catch (error) {
            console.warn('[OdysseyBoard] Early atmosphere hoist failed (non-fatal):', error);
            this.atmosphere = null;
        }
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
                // Reuse the rig if ?odysseyLightsFirst hoisted it before the compile pool.
                if (!this.atmosphere) {
                    this.atmosphere = new OdysseyAtmosphere(this.scene, this.renderer);
                }
                // Parallax mid/far depth filler so the corridor between chapter set pieces
                // is never empty void (reads chapter-profile + path-utils; one cohesive rig).
                this.corridorField = new OdysseyCorridorField(this.scene, {
                    // Act II is a continuous landscape now, not a set piece with void around
                    // it — its parallax sheets would be overdraw in front of a real horizon.
                    suppressedChapters: this.oneWorldEnabled ? ONE_WORLD_CHAPTERS : [],
                });
                // THE STEAM QUENCH — the ch1 -> Act II occlusion moment (playground-proven in
                // ?effect=seam-12-dive). Earth Core is a molten cavern and the rail enters Act
                // II ~160u below sea level, so the handoff is fire meeting water; the profile
                // already authors it as `stinger: 'steam-quench'`. Seated on the rail AT the
                // boundary so the camera flies through it rather than watching it pass.
                try {
                    const boundary12 = this.presentationLayout?.chapterPositions?.[1];
                    if (Number.isFinite(boundary12)) {
                        this.steamQuench = createSteamQuench();
                        const at = getOdysseyPathPointAt(boundary12);
                        this.steamQuench.mesh.position.set(at.x, at.y, at.z);
                        this.steamQuench.mesh.visible = false; // gated in the update below
                        this.scene.add(this.steamQuench.mesh);
                        this._steamBoundary = boundary12;
                    }
                } catch (error) {
                    console.warn('[OdysseyBoard] steam quench unavailable (non-fatal):', error);
                    this.steamQuench = null;
                }
                // THE CLOUD BANK — the ch5 -> ch6 occlusion moment (summit into cosmos), the
                // quench's sibling at the other act edge. Its colour ramp runs THROUGH the
                // authored SEAM_56_AURORA_BRIDGE tone, so it is continuous with the shipped
                // handoff by construction; the bridge itself stays and colours the frame
                // around the bank (build first — see the plan's occlusion item).
                // BISECT LEVER: ?odysseyNoCloudBank=1. The bank is a separate system from the
                // world deck, so `odysseyWorldNoClouds` never removed it — and a 2026-08-13
                // bisect that used only that flag concluded the mottled ch5 sky at p=0.60 was
                // chapter SIX bleeding in, when in fact the bank's window opens at 0.588. An
                // occluder with no off switch cannot be ruled out of a frame.
                try {
                    const boundary56 = this.presentationLayout?.chapterPositions?.[5];
                    if (Number.isFinite(boundary56) && !readBooleanUrlFlag('odysseyNoCloudBank')) {
                        // The act's own cloud palette, when the world built one — see
                        // createCloudBank's `palette` option and createOdysseyWorld's
                        // `cloudPalette`. Null on the recovery path, which is handled there.
                        this.cloudBank = createCloudBank({
                            palette: this.oneWorld?.cloudPalette || null,
                        });
                        const at56 = getOdysseyPathPointAt(boundary56);
                        this.cloudBank.mesh.position.set(at56.x, at56.y, at56.z);
                        this.cloudBank.mesh.visible = false; // gated in the update below
                        this.scene.add(this.cloudBank.mesh);
                        this._cloudBankBoundary = boundary56;
                    }
                } catch (error) {
                    console.warn('[OdysseyBoard] cloud bank unavailable (non-fatal):', error);
                    this.cloudBank = null;
                }
                this.environmentManager?.setAtmosphereOwned(true);
                this.thresholdDirector = new ChapterThresholdDirector(this.scene, this.pathRenderer?.pathCurve, {
                    chapterPositions: this.presentationLayout?.chapterPositions,
                    qualityName: this.qualityName,
                });
                // FIRST-TRANSITION HITCH FIX: the corridor field + the seam-only breach are
                // NOT chapter env groups, so the per-chapter prewarm misses them and their
                // WebGPU pipelines compile on the FIRST transition (lag once, smooth after).
                // Compile them during load — joining the parallel startup compile pool when
                // one is open (their driver compiles overlap the main-thread setup work; the
                // pool barrier in initialize() awaits them before the warm-up replay).
                const corridorWarm = this._prewarmGroup(this.corridorField?.group, 'corridor field');
                const breachWarm = this._prewarmGroup(this.thresholdDirector?.group, 'threshold breach');
                // The world is not a chapter env group either, so it misses the same prewarm
                // and would compile four materials on the first Act II frame — the whole point
                // of collapsing 66 materials into 4 is lost if they land as a cold stall.
                const worldWarm = this._prewarmGroup(this.oneWorld?.group, 'one world');
                if (this._compilePool) {
                    this._compilePool.push(
                        this._timedCompile('corridor', corridorWarm),
                        this._timedCompile('breach', breachWarm),
                        this._timedCompile('one-world', worldWarm),
                    );
                } else {
                    await corridorWarm;
                    await breachWarm;
                    await worldWarm;
                }
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

    // NOTE (remediation Phase 2): createNebula() and createAmbientParticles()
    // were removed here. createNebula() was the lone remaining raw
    // THREE.ShaderMaterial in the entire odyssey/ tree (a GLSL gradient plane),
    // which the WebGPU backend cannot compile — but it was never called from the
    // live init path (only createStarfield() above is). Both were dead code that
    // falsely signalled an incomplete WebGPU migration. The odyssey render path
    // is now verifiably NodeMaterial/TSL-only.

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
        const pixelRatio = this.pixelRatioOverride ?? computeScenePixelRatio({
            renderScale: this._drs.renderScale, // respect the live DRS scale (QW2/QW3).
            devicePixelRatio: window.devicePixelRatio || 1,
            maxPixelRatio: ODYSSEY_MAX_PIXEL_RATIO,
            sceneType: 'odyssey',
            qualityTier: this.qualityName,
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
        // Odyssey legibility floor (2026-08): the adaptive controller may ride the global
        // policy floor (0.5), but below ~0.65 the browser upscale turns the Ch3 meadow's
        // fine detail into visible pixel blocks. Clamp Odyssey only; when pinned here the
        // adaptive tier ladder escalates to its bloom-shed / post-soften rungs instead.
        const clampedRenderScale = Math.max(renderScale, 0.65);
        this._drs.renderScale = clampedRenderScale;
        const width = this.container?.clientWidth || 1;
        const height = this.container?.clientHeight || 1;
        const pixelRatio = this.pixelRatioOverride ?? computeScenePixelRatio({
            renderScale: clampedRenderScale,
            devicePixelRatio: window.devicePixelRatio || 1,
            maxPixelRatio: ODYSSEY_MAX_PIXEL_RATIO,
            sceneType: 'odyssey',
            qualityTier: this.qualityName,
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
        // Skip while the tab is hidden: rAF throttles to ~1fps when backgrounded and the loop's
        // 50ms delta clamp (animate()) then feeds the controller a stream of "20fps" frames, which
        // would spuriously downscale a board nobody is watching — it would then reveal low-res on
        // return. Quality should only adapt to frames the user actually sees.
        if (typeof document !== 'undefined' && document.hidden) return;
        // Do NOT let the adaptive controller react while the startup background chapter-load +
        // render-warm are still running. Those frames are main-thread-blocked by synchronous JS
        // chapter builds (not GPU fill), so feeding them to the resolution policy makes it slash
        // renderScale for the ENTIRE session — the board then looks low-res even at 200+fps once
        // the load settles, because recovery is a slow +0.05/12s climb (user "feels low-res"
        // report 2026-07-05: measured renderScale stuck at 0.6 @ 222fps). Freeze until the last
        // startup phase (_bgRenderWarmComplete) finishes, then measure from a clean window.
        if (!this._bgRenderWarmComplete) return;
        if (!this._adaptiveResumedAfterLoad) {
            this._adaptiveResumedAfterLoad = true;
            this.adaptiveQuality.resetFrameWindow(performance.now());
        }
        this.adaptiveQuality.recordFrame(frameMs);
        // Refresh the (cheap) pipeline reference each tick — the post stack is built after the
        // controller and can be torn down / re-created; ctx is reused so this is alloc-free.
        this._adaptiveCtx.pipeline = this.postProcessingStack;
        this._adaptiveCtx.targetFrameRate = this.adaptiveTargetFrameRate;
        this.adaptiveQuality.update(performance.now(), this._adaptiveCtx);
    }

    /**
     * Batch0 — resolve GPU timestamp queries so renderer.info.render.timestamp is populated
     * for the debug overlay, AND record one profile sample per resolved query.
     *
     * THE SAMPLE MUST BE TAKEN HERE, not per frame (fixed 2026-08-12). `Info.reset()` clears
     * drawCalls/triangles but deliberately NOT `render.timestamp` — only `dispose()` does — so
     * the field holds the last RESOLVED value indefinitely. The profiler used to read it every
     * frame and push unconditionally, which meant a "600 sample" window was really one resolved
     * value repeated however many frames it happened to dwell for. That is not merely imprecise:
     * a slower lane resolves less often, so its samples are weighted more heavily, biasing the
     * p50 in a direction no post-processing can undo. It is the same shape the playground
     * already got right (src/playground/main.js resolveGpuTimestamp).
     *
     * One resolve in flight at a time; the epoch guard drops a resolve that outlived a ring
     * reset. Guarded for backends/builds without the API.
     * @private
     */
    _resolveRenderTimestamps() {
        const { renderer } = this;
        if (typeof renderer?.resolveTimestampsAsync !== 'function') return;
        if (this._gpuTimestampPending) return;
        const renderType = THREE.TimestampQuery?.RENDER ?? 'render';
        const epoch = this._gpuTimestampEpoch;
        this._gpuTimestampPending = true;
        renderer.resolveTimestampsAsync(renderType)
            .then(() => {
                const ts = renderer.info?.render?.timestamp;
                // The first resolves land as null/0 while the query pool warms; not frames.
                if (this.gpuProfileRing && epoch === this._gpuTimestampEpoch
                    && Number.isFinite(ts) && ts > 0) {
                    this.gpuProfileRing.push(ts);
                }
            })
            .catch(() => {})
            .finally(() => { this._gpuTimestampPending = false; });
    }

    /**
     * WAVE -1 — record this frame's GPU time and publish a throttled percentile summary.
     *
     * `renderer.info.render.timestamp` is one aggregate number per frame, and WebGPU exposes
     * no per-pass scope through three's API, so the "split" the wave asks for is obtained as
     * an A/B MATRIX across runs (bloom off, post off, level nodes hidden, ...) rather than as
     * nested timestamp scopes. Each configuration is one run; the differences are the split.
     *
     * Sampling is per-frame and allocation-free; the O(n log n) summary is throttled to ~4 Hz
     * and parked on window for the harness to read.
     * @private
     */
    _sampleGpuProfile() {
        // NOTE: samples are pushed by _resolveRenderTimestamps, once per RESOLVED query —
        // not here, once per frame. See that method for why the per-frame push was wrong.
        const now = performance.now();
        if (now - this._gpuProfileLastSummary < 250) return;
        this._gpuProfileLastSummary = now;
        // Belt-and-braces re-assert. The primary application now happens right after
        // createNodes (so the flag works without the profiler) and setAllVisible latches
        // against the per-frame write, so this should be a no-op — it stays only to cover a
        // mesh built after node creation, which would otherwise silently rejoin the frame.
        if (this.hideLevelNodes) this.nodeManager?.setAllVisible(false);
        const summary = this.gpuProfileRing.summarize();
        summary.drawCalls = this._perfCounters?.calls ?? null;
        summary.drawCallsMin = this._drawCallsRange?.min ?? null;
        summary.drawCallsMax = this._drawCallsRange?.max ?? null;
        summary.triangles = this._perfCounters?.triangles ?? null;
        summary.oneWorld = !!this.oneWorld;
        summary.levelNodesHidden = !!this.hideLevelNodes;
        summary.quality = this.qualityName ?? null;
        if (typeof window !== 'undefined') window.__ODYSSEY_GPU_PROFILE__ = summary;
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

        // Frame-pacing guard: clamp the rAF delta so a long frame (compile/transition/GC spike —
        // the board logs p99 ~8s cold-start spikes) cannot lurch the camera/director/grade by a
        // multi-second time step on the NEXT frame. 0.05s = 3 frames @60fps; anything longer is a
        // hitch we never want to integrate. Zero visual cost in steady state (delta << 0.05).
        const rawDelta = this.clock.getDelta();
        // Frame-health EMA for background backpressure — feed the RAW delta (pre-clamp) so a long
        // build/compile frame registers as jank and closes the bg gate. Skip when the tab is hidden
        // (rAF throttles to ~1fps → meaningless deltas, and there are no visible frames to protect).
        if (!(typeof document !== 'undefined' && document.hidden)) {
            const rawMs = rawDelta * 1000;
            if (rawMs > 0 && rawMs < 2000) this.frameMsEma += (rawMs - this.frameMsEma) * 0.15;
        }
        const delta = Math.min(rawDelta, 0.05);
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

        // L8 dome-cull: when the dominant chapter's own full-coverage dome is fully opaque
        // (mid-chapter, NOT a seam), hide the global atmosphere dome to drop its full-screen
        // overdraw layer. The clear colour is driven to the horizon every frame regardless
        // (OdysseyAtmosphere.update), so the backdrop stays intact; we keep the dome visible
        // at seams + low max-weight so the zenith→horizon gradient never flattens during a
        // crossfade. Set BEFORE atmosphere.update so its gradient-uniform writes are skipped
        // while hidden. Reversible via ?odysseyDomeCullOff=1.
        if (this.atmosphere && this.oneWorld && this._oneWorldVisible !== false) {
            // ONE SKY (plan 3.4). The world draws its own full-coverage dome driven by the
            // colour script, so the global backstop is pure full-screen overdraw AND it
            // competes for the same pixels with a different palette.
            //
            // Gated on the world actually DRAWING (2026-08-12): this used to cull the global
            // dome whenever a world existed, which outside Act II handed the sky to a world
            // that the act-gate above has now hidden. Whoever draws owns the sky.
            this.atmosphere.setDomeVisible(false);
        } else if (this.atmosphere && this._domeCullEnabled) {
            const weightsMap = blendState?.weights;
            const maxWeight = weightsMap ? Math.max(0, ...Object.values(weightsMap)) : 0;
            const domeInSeam = blendState?.inSeam === true || this.activeSeamBoundaryId !== null;
            this.atmosphere.setDomeVisible(!(!domeInSeam && maxWeight >= 0.995));
        }

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

        // Steam quench: time-driven (it billows) so it runs every frame, not on the throttled
        // position gate. Hidden outside its window so it costs nothing for 94% of the journey.
        if (this.steamQuench && Number.isFinite(this._steamBoundary)) {
            const lo = this._steamBoundary - STEAM_QUENCH_HALF_WIDTH;
            const hi = this._steamBoundary + STEAM_QUENCH_EXIT_HALF_WIDTH;
            const inWindow = cameraProgress > lo && cameraProgress < hi;
            this.steamQuench.mesh.visible = inWindow;
            if (inWindow) this.steamQuench.update(this.time, (cameraProgress - lo) / (hi - lo));
        }
        if (this.cloudBank && Number.isFinite(this._cloudBankBoundary)) {
            const lo = this._cloudBankBoundary - STEAM_QUENCH_HALF_WIDTH;
            const hi = this._cloudBankBoundary + STEAM_QUENCH_HALF_WIDTH;
            const inWindow = cameraProgress > lo && cameraProgress < hi;
            this.cloudBank.mesh.visible = inWindow;
            if (inWindow) this.cloudBank.update(this.time, (cameraProgress - lo) / (hi - lo));
        }

        // WAVE 5: release the deferred breach stinger ON the constant — the frame the eye
        // breaks the surface, not the frame the ecotone begins (see _handleChapterSeam).
        if (this._pendingBreachStinger && cameraProgress >= ODYSSEY_BREACH_P) {
            const { seamIntensity, transition } = this._pendingBreachStinger;
            this._pendingBreachStinger = null;
            this._playThresholdStinger('2-3', seamIntensity, transition);
        }

        // Update chapter environments based on camera position
        if (this.environmentManager && this.camera) {
            if (runPositionWork) {
                this._ensureBoundaryAssets(cameraProgress);
                this._handleChapterSeam(cameraProgress, blendState);
                // LEVER 2: drive windowed residency (evict far chapters, re-create approaching
                // ones) on the same throttled position-work cadence as visibility. Inert unless
                // ?odysseyChapterEvict=1. Runs BEFORE updateVisibility so a just-re-created
                // chapter's opacity is set correctly this frame.
                if (this.chapterEvictionEnabled && blendState) {
                    this.environmentManager.updateResidency(cameraProgress, blendState);
                }
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

            // ONE WORLD: the continuous Act II surface is driven from the GROUND-TRACK point,
            // never the camera eye — centring the clipmap on the eye makes the ground change
            // shape when only the camera moves, which would break the hero framing.
            if (this.oneWorld) {
                const railPoint = getOdysseyPathPointAt(cameraProgress);
                const actStart = this.presentationLayout.chapterPositions[1];
                const actEnd = this.presentationLayout.chapterPositions[5];
                const span = (actEnd - actStart) || 1;
                this._oneWorldActT = (cameraProgress - actStart) / span;

                // ACT-GATE THE WORLD (2026-08-12). This is a CORRECTNESS fix before it is a
                // perf one. The world group was added to the scene once and its `.visible`
                // was never written, so its ground, water, sky dome, cloud deck and god-ray
                // shafts drew through chapters 1, 6, 7 and 8 as well — chapters that own
                // their own frame. Earth Core is the proof: its vault backstop is an OPAQUE
                // BackSide sphere at r=250 with `depthWrite = false` and renderOrder -90, so
                // the world's opaque geometry (renderOrder 0, depth-writing) passes the depth
                // test everywhere and paints straight over it. Captured before/after: the
                // authored ember-lit molten cathedral was rendering as magma columns floating
                // in Act II's blue-teal ocean, complete with god-ray shafts.
                //
                // The margin keeps the world present across the act-edge seams, where the fog
                // handoff ramps and the neighbouring chapter is still co-present.
                const worldVisible = isWorldVisibleAtProgress(cameraProgress, actStart, actEnd);
                this.oneWorld.group.visible = worldVisible;
                this._oneWorldVisible = worldVisible;

                // Only update it while it draws. `heightAt` and `fog` are plain data and stay
                // readable either way, so the level-orb seating and the fog handover below are
                // unaffected by the gate.
                if (worldVisible) {
                    // The EYE decides whether we are under water, not the rail — see the
                    // note in odyssey-world-renderer's update().
                    this.oneWorld.update(this.time, railPoint, this._oneWorldActT, this.camera?.position?.y);
                }
            }

            // Time-driven uniform tick (animated material uniforms) — always 60Hz.
            this.environmentManager.update(
                delta,
                this.camera,
                cameraProgress,
                this.cinematicJourneyActive ? directorState : null,
            );

            // ONE WORLD owns the air. The manager above is still cross-fading scene fog and the
            // clear colour from the profiles of chapters 2-5 — chapters that no longer draw
            // anything — which is a second, contradictory atmosphere laid over the world's own.
            // Hand both to the colour script, ramped at the act edges so chapters 1 and 6 still
            // hand over without a step. The world's own materials opt out of scene fog entirely
            // (they carry applyAerial); this is for everything else in the frame: the path
            // ribbon, the level orbs, the traveller.
            if (this.oneWorld) {
                const t = this._oneWorldActT;
                const e = Math.max(0, Math.min(1, Math.min(t / 0.06, (1 - t) / 0.06)));
                const w = e * e * (3 - (2 * e));
                if (w > 0) {
                    const worldFog = this.oneWorld.fog;
                    if (this.scene.fog) {
                        this.scene.fog.color.lerp(worldFog.color, w);
                        this.scene.fog.density += (worldFog.density - this.scene.fog.density) * w;
                        this.renderer.setClearColor(this.scene.fog.color, 1);
                    } else {
                        this.renderer.setClearColor(worldFog.color, 1);
                    }
                }
            }
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
        this._recordPerfCounters();

        // Batch0: resolve GPU timestamps so the debug overlay can read render.info.timestamp.
        // ONLY when the overlay is active (?odysseyAAA=1) — otherwise this scheduled an async GPU
        // timestamp readback + allocated a Promise + a .catch closure EVERY frame for data that
        // nothing reads (per-frame GC the board never needed in normal play). Zero visual effect.
        if (this.debugOverlayActive || this.gpuProfileEnabled) {
            this._resolveRenderTimestamps();
        }
        if (this.gpuProfileRing) this._sampleGpuProfile();

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
        if (this._skipPreRevealWarmup) {
            this._warmupStats = {
                mode: this.warmupMode,
                skipped: true,
                sampleCount: 0,
                totalMs: 0,
            };
            console.log('[OdysseyWarmup] pre-reveal warm-up skipped (?odysseyWarmupMode=off)');
            return;
        }
        const savedPos = cc.currentPosition;
        const savedTarget = cc.targetPosition;
        const savedTime = this.time;
        const savedSeam = this.activeSeamBoundaryId;
        const savedSound = this.soundManager;
        this._isWarmingUp = true;
        this.soundManager = null; // mute music/stingers during the scrub
        const warmupStartedAt = performance.now();
        const syncGpu = readBooleanUrlFlag('odysseyPerfGpuSync');
        const warmupStats = {
            mode: this.warmupMode,
            skipped: false,
            syncGpu,
            sampleCount: 0,
            renderFrameMs: 0,
            yieldMs: 0,
            gpuSyncMs: 0,
            variantsMs: 0,
            totalMs: 0,
            samples: [],
        };
        this._warmupStats = warmupStats;
        try {
            // SLIMMED warm-up (startup optimization): pipelines specialize per material +
            // pass target, not per camera position, so the old ~40 even samples were mostly
            // redundant. buildJourneyWarmSamples keeps exactly the states that pay first-
            // visit costs: one interior sample per chapter (materials through the post
            // target with real visibility/blend state) + one sample AT each seam (both
            // chapters co-present, ecotone overlap, breach assets, crossfade lights) + the
            // journey ends. ~17 renders instead of ~64. If a seam ever regresses, widen
            // ONLY that boundary to a ±0.02 triplet.
            // Restrict the warm-up to the chapters we actually CREATED. Sampling the full
            // journey scrolls the camera into deferred chapters, which triggers their lazy
            // creation+compile DURING the warm-up (serially) — defeating the eager window.
            let warmChapterIds = this.restrictStartupChapterLoading
                ? this.captureChapterIds
                : (this._activeStartupChapterIds || null);
            // Fast-start (opt-in ?odysseyFastStart=1): warm ONLY the chapter the player reveals
            // into. Other chapters warm on first scroll-in (a brief hitch). Reveals several
            // seconds sooner — trades the warm-up's hitch-prevention for cold-start speed.
            if (this._fastStart && Number.isFinite(this.focusChapter)) {
                warmChapterIds = [this.focusChapter];
            }
            const fastStartPosition = Number.isFinite(cc.currentPosition)
                ? cc.currentPosition
                : (Number.isFinite(savedPos) ? savedPos : 0);
            const steps = this._fastStart
                ? buildPointWarmSamples({ position: fastStartPosition })
                : warmChapterIds
                    ? buildChapterWarmSamples({
                        chapterPositions: this.presentationLayout?.chapterPositions || [],
                        chapterIds: warmChapterIds,
                    })
                    : buildJourneyWarmSamples({
                        chapterPositions: this.presentationLayout?.chapterPositions || [],
                    });
            const shouldYieldDuringWarmup = !this._fastStart;

            // The warm-up renders the whole journey, but only chapters that were actually
            // CREATED have a backdrop to compile/upload — uncreated (deferred) chapters'
            // samples are cheap. So the startup chapter WINDOW (see startupChapterIds) is the
            // real cold-start lever, not truncating samples here.
            warmupStats.sampleCount = steps.length;
            for (let i = 0; i < steps.length; i += 1) {
                cc.currentPosition = steps[i];
                cc.targetPosition = steps[i];
                // Phase 0 instrumentation: time each warm-up render so a capture can
                // attribute warm-up cost to specific samples/chapters. (The ~22s figure
                // this was added for is historical — it predates the slimmed sample set
                // and the fast-start single-sample default above. Re-measure via
                // scripts/odyssey-perf-session.mjs.)
                const sampleStart = performance.now();
                const renderStart = performance.now();
                this.renderFrame(1 / 60);
                const renderFrameMs = performance.now() - renderStart;
                let gpuSyncMs = 0;
                if (syncGpu) {
                    const gpuStart = performance.now();
                    // eslint-disable-next-line no-await-in-loop
                    await this._syncGpuQueueForDiagnostics();
                    gpuSyncMs = performance.now() - gpuStart;
                }
                let yieldMs = 0;
                if (shouldYieldDuringWarmup && i % 2 === 0) {
                    const yieldStart = performance.now();
                    // eslint-disable-next-line no-await-in-loop
                    await this._yieldToMain();
                    yieldMs = performance.now() - yieldStart;
                }
                const sampleMs = Math.round(performance.now() - sampleStart);
                warmupStats.renderFrameMs += renderFrameMs;
                warmupStats.gpuSyncMs += gpuSyncMs;
                warmupStats.yieldMs += yieldMs;
                warmupStats.samples.push({
                    index: i,
                    progress: Number.isFinite(steps[i]) ? +steps[i].toFixed(4) : null,
                    renderFrameMs: Math.round(renderFrameMs),
                    gpuSyncMs: Math.round(gpuSyncMs),
                    yieldMs: Math.round(yieldMs),
                    totalMs: sampleMs,
                });
                if (sampleMs > 120) {
                    const where = typeof steps[i] === 'number' ? steps[i].toFixed(3) : `${i}`;
                    console.log(`[OdysseyWarmup] sample ${i} @progress ${where} took ${sampleMs}ms`);
                }
            }
            // Mark the chapters this pre-reveal warm covered, so the post-reveal background
            // render-warm skips them (no redundant re-render).
            for (const ch of (warmChapterIds || [])) {
                const warmedEnv = this.environmentManager?.environments?.get(ch);
                if (warmedEnv) warmedEnv._renderWarmed = true;
            }
            // Warm every post output-quad variant (lean/ch7-lens × bloom/no-bloom) BEFORE
            // reveal so they never compile on a live frame. (Deferring this for the NORMAL
            // path only moved the multi-second compile onto the first camera-travel frames,
            // which the overlay dismiss waits for — making board-visible WORSE. Keep it
            // pre-reveal there.) Fast-start intentionally skips the full matrix: the focus
            // sample already warmed the ACTIVE variant, and the far variants (ch7 lens /
            // dark no-bloom) warm on first visit to those far chapters — the fast-start trade.
            if (this._fastStart) {
                console.log('[OdysseyWarmup] fast-start: focus chapter warmed; far chapters + post variants warm on first visit');
            } else {
                const variantStart = performance.now();
                await this.postProcessingStack?.warmOutputVariants?.(this._yieldToMain.bind(this));
                warmupStats.variantsMs = performance.now() - variantStart;
                console.log(`[OdysseyWarmup] warmOutputVariants took ${Math.round(warmupStats.variantsMs)}ms`);
            }
            warmupStats.totalMs = performance.now() - warmupStartedAt;
            console.log('[OdysseyBoard] Journey warm-up complete (chapters + seams warmed through render path)');
        } catch (error) {
            console.warn('[OdysseyBoard] Journey warm-up failed:', error);
        } finally {
            warmupStats.totalMs = performance.now() - warmupStartedAt;
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

    /**
     * Phase 0 instrumentation: resident GPU resource counts from the board renderer.
     * These are COUNTS, not bytes — cross-check chrome://gpu for true VRAM. Used to
     * decide how aggressively the board can be kept resident during gameplay.
     * @returns {{geometries:number, textures:number, renderCalls:number}|null}
     */
    getMemorySnapshot() {
        const info = this.renderer?.info;
        if (!info) {
            return null;
        }
        return {
            geometries: info.memory?.geometries ?? 0,
            textures: info.memory?.textures ?? 0,
            renderCalls: info.render?.calls ?? 0,
        };
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
            // WAVE 5: THE BREACH IS AN AUDIO MOMENT, NOT AN ECOTONE ONE. The 2->3 stinger is
            // the surface-break, and it must land the frame the EYE breaks the surface —
            // ODYSSEY_BREACH_P, bisected in Wave 0 — not when the camera enters the ecotone
            // ~0.03 of progress (tens of metres of water) earlier. Deferred here, released in
            // the update loop on the constant; travelling backwards (a re-dive) keeps the
            // immediate stinger, because there is no breach on the way down.
            if (boundaryId === '2-3' && direction > 0) {
                this._pendingBreachStinger = { seamIntensity, transition };
            } else {
                this._playThresholdStinger(boundaryId, seamIntensity, transition);
            }
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
            // Left the seam without crossing the surface (scrubbed back out): the deferred
            // breach stinger must not fire later from stale state.
            if (this._pendingBreachStinger && cameraProgress < ODYSSEY_BREACH_P) {
                this._pendingBreachStinger = null;
            }
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
        if (this.restrictStartupChapterLoading && !this.captureChapterIds.includes(chapterId)) {
            return false;
        }

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
        this._gpuSurfaceUnregister?.();
        this._gpuSurfaceUnregister = null;
        this._gpuMonitorUnsub?.();
        this._gpuMonitorUnsub = null;
        this.teardownInteraction();
        resetOdysseyPathLayout();
        this.layoutEditor?.dispose?.();
        this.layoutEditor = null;
        if (this._perfSpikeContextCollector && typeof window !== 'undefined') {
            window.perfMonitor?.setSpikeContextCollector?.(null);
            this._perfSpikeContextCollector = null;
        }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.prewarmDrainTimer) {
            clearTimeout(this.prewarmDrainTimer);
            this.prewarmDrainTimer = null;
        }
        if (this._backgroundChapterLoadingTimer) {
            clearTimeout(this._backgroundChapterLoadingTimer);
            this._backgroundChapterLoadingTimer = null;
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
        if (this.steamQuench) {
            this.scene.remove(this.steamQuench.mesh);
            this.steamQuench.dispose();
            this.steamQuench = null;
        }
        if (this.cloudBank) {
            this.scene.remove(this.cloudBank.mesh);
            this.cloudBank.dispose();
            this.cloudBank = null;
        }
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
