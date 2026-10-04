/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CHROMADELIC HIGHWAY
 *  A prism-glass rainbow highway racing through a neon-lit cosmos.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Renderer: ONE node-material path on both WebGPURenderer backends (ADR-0019) — WebGPU where
 * available, its WebGL2 backend otherwise (or with ?forceWebGL=1). The classic WebGLRenderer +
 * GLSL ShaderMaterial + EffectComposer twin is retired (ADR-0008 Phase 7), so the fallback lane
 * now renders the same look instead of a second, older one.
 *
 * Content: ChromadelicWorld (chromadelic-highway-world.js) — shared with the playground effect
 * src/playground/effects/chromadelic-highway.effect.js, so what is iterated there is what ships.
 * This class owns the lifecycle, gameplay events → reactive envelope + travelling light waves,
 * the adaptive resolution scaler, the post stack and the release/baseline tooling.
 */

import * as THREE from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { resolveTargetFps } from '../theme-frame-pacer.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { CHROMADELIC_HIGHWAY_TETROMINOS } from './chromadelic-highway-tetrominos.js';
import { ChromadelicHighwayPost, POST_LOOK, createPassThroughPipeline } from './chromadelic-highway-post.js';
import { CAMERA_RIG, ChromadelicWorld, WORLD_TIERS } from './chromadelic-highway-world.js';
import {
    BOARD_SELECTOR, HUD_SELECTOR, layoutsDiffer, readLayoutRects, restVerticalFov,
} from './chromadelic-highway-composition.js';

// ─────────────────────────────────────────────────────────────────────────────
// Debug Flags
// ─────────────────────────────────────────────────────────────────────────────

function parseChromadelicFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noCompute: false,
            noMRT: false,
            mrtAudit: false,
            noShootingStarCompute: false,
            noPost: false,
            baseline: false,
            falseColor: false,
            parts: null,
            msaa: null,
            seed: null,
            fixedDeltaMs: null,
            captureTime: null,
            playback: null,
            playbackLoops: 1,
        };
    }
    const params = new URLSearchParams(window.location.search);
    const hasFlag = (name) => params.has(name)
        || params.get(name) === '1'
        || params.get(name) === 'true';

    const seedValue = Number(params.get('chromadelicSeed') || params.get('seed'));
    const fixedDeltaValue = Number(params.get('chromadelicFixedDt') || params.get('fixedDt'));
    // `chromadelicTime=<seconds>` seeks the simulation to t and freezes it there (rendering
    // continues), so before/after screenshots compare the exact same moment — the in-app
    // equivalent of the playground's `?t=`.
    const captureTimeRaw = params.get('chromadelicTime');
    const captureTimeValue = captureTimeRaw === null ? NaN : Number(captureTimeRaw);
    const playbackValue = params.get('chromadelicPlayback');
    const playbackLoopsValue = Number(params.get('chromadelicPlaybackLoops'));

    return {
        forceWebGL: hasFlag('forceWebGL'),
        // Compute and MRT are no longer used by this theme (closed-form GPU animation, a
        // threshold bloom designed for the non-MRT path). The flags stay parseable so existing
        // harness permutations keep running; they are no-ops.
        noCompute: hasFlag('chromadelicNoCompute'),
        noMRT: hasFlag('chromadelicNoMRT'),
        mrtAudit: hasFlag('chromadelicMrtAudit'),
        noShootingStarCompute: hasFlag('chromadelicNoShootingStarCompute'),
        noPost: hasFlag('chromadelicNoPost'),
        baseline: hasFlag('chromadelicBaseline'),
        // Debug view: band the pre-tone-map max channel (only thin emitters should bloom).
        falseColor: hasFlag('chromadelicFalseColor'),
        // Debug/perf only: draw just these world parts (sky,stars,planets,road,rails,rings,
        // streaks,motes,meteors) and override the scene-pass MSAA sample count.
        parts: params.get('chromadelicParts') ? params.get('chromadelicParts').split(',').map((p) => p.trim()) : null,
        msaa: Number.isFinite(Number(params.get('chromadelicMsaa'))) && params.get('chromadelicMsaa') !== null
            ? Number(params.get('chromadelicMsaa'))
            : null,
        seed: Number.isFinite(seedValue) ? seedValue : null,
        fixedDeltaMs: Number.isFinite(fixedDeltaValue) && fixedDeltaValue > 0 ? fixedDeltaValue : null,
        captureTime: Number.isFinite(captureTimeValue) && captureTimeValue >= 0 ? captureTimeValue : null,
        playback: playbackValue && playbackValue.trim() ? playbackValue.trim() : null,
        playbackLoops: Number.isFinite(playbackLoopsValue) && playbackLoopsValue > 0
            ? Math.floor(playbackLoopsValue)
            : 1,
    };
}

function createSeededRandom(seed) {
    if (!Number.isFinite(seed)) return Math.random;
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state === 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality: the look (post) per tier. Content budgets live in WORLD_TIERS.
// ─────────────────────────────────────────────────────────────────────────────

const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

const QUALITY_BUDGETS = {
    Extreme: {
        maxDrawCalls: 560,
        maxPostCostMs: 4.8,
        maxActiveShootingStars: 10,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.74,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.028,
        adaptiveUpRate: 0.024,
        minResolutionScale: 0.74,
        maxResolutionScale: 1.0,
        baseResolutionScale: 1.0,
        minEffectScale: 0.58,
    },
    Ultra: {
        maxDrawCalls: 500,
        maxPostCostMs: 4.5,
        maxActiveShootingStars: 8,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.72,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.03,
        adaptiveUpRate: 0.023,
        minResolutionScale: 0.72,
        maxResolutionScale: 1.0,
        baseResolutionScale: 1.0,
        minEffectScale: 0.54,
    },
    High: {
        maxDrawCalls: 430,
        maxPostCostMs: 4.0,
        maxActiveShootingStars: 6,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.68,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.034,
        adaptiveUpRate: 0.02,
        minResolutionScale: 0.68,
        maxResolutionScale: 1.0,
        baseResolutionScale: 0.98,
        minEffectScale: 0.5,
    },
    Medium: {
        maxDrawCalls: 350,
        maxPostCostMs: 3.2,
        maxActiveShootingStars: 4,
        targetFrameMs: 17.4,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.64,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.038,
        adaptiveUpRate: 0.018,
        minResolutionScale: 0.62,
        maxResolutionScale: 0.94,
        baseResolutionScale: 0.9,
        minEffectScale: 0.44,
    },
    Low: {
        maxDrawCalls: 260,
        maxPostCostMs: 2.6,
        maxActiveShootingStars: 3,
        targetFrameMs: 18.8,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.58,
        adaptiveMaxScale: 0.96,
        adaptiveDownRate: 0.042,
        adaptiveUpRate: 0.016,
        minResolutionScale: 0.56,
        maxResolutionScale: 0.84,
        baseResolutionScale: 0.8,
        minEffectScale: 0.36,
    },
    Minimal: {
        maxDrawCalls: 200,
        maxPostCostMs: 2.2,
        maxActiveShootingStars: 2,
        targetFrameMs: 20.0,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.52,
        adaptiveMaxScale: 0.92,
        adaptiveDownRate: 0.045,
        adaptiveUpRate: 0.015,
        minResolutionScale: 0.5,
        maxResolutionScale: 0.78,
        baseResolutionScale: 0.72,
        minEffectScale: 0.3,
    },
};

// Reactive envelope: a fast attack (14/s, τ ≈ 70 ms) and exponential decays (τ in seconds).
// Hoisted so the per-frame update never allocates.
/** GPU losses a session survives (rebuilt on WebGL2) before the theme reports a runtime failure. */
const MAX_DEVICE_LOSS_RECOVERIES = 2;

/**
 * After a WebGL context loss (WebGLBackend already called preventDefault), give the browser a
 * moment to restore it before building a new context: one created mid-reset is lost again.
 */
function waitForContextRestored(canvas, timeoutMs) {
    return new Promise((resolve) => {
        if (!canvas?.addEventListener) {
            resolve();
            return;
        }
        let timer = null;
        const done = () => {
            clearTimeout(timer);
            canvas.removeEventListener('webglcontextrestored', done);
            resolve();
        };
        timer = setTimeout(done, timeoutMs);
        canvas.addEventListener('webglcontextrestored', done);
    });
}

const REACTIVE_CHANNELS = ['pulse', 'bloom', 'ring', 'particle', 'ambient'];
const REACTIVE_ATTACK = 14;
const REACTIVE_DECAY_TAU = {
    pulse: 0.35, bloom: 0.5, ring: 0.35, particle: 0.5, ambient: 0.8,
};

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class ChromadelicHighwayTheme extends BaseTheme {
    constructor() {
        super('chromadelic-highway');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.world = null;
        this.postProcessing = null;
        this.animationFrameId = null;
        this.loopGeneration = 0;
        this.consecutiveFrameErrors = 0;
        this.resizeHandler = null;
        this.lastFrameTime = null;
        this.time = 0;
        this.simFrozen = false;
        this.drawingBufferSize = new THREE.Vector2();

        // Renderer kind vs backend (ADR-0019): node materials always; isWebGPU gates only
        // genuine backend capabilities (timestamps). Device loss is handled on both backends:
        // r185's WebGLBackend routes 'webglcontextlost' to renderer.onDeviceLost too.
        this.isWebGPU = false;
        this.isWebGL = false;
        this.usesNodeMaterials = true;
        this.flags = parseChromadelicFlags();
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.fixedElapsed = 0;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            maxColorAttachments: 1,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
            post: false,
            mrt: false,
            compute: false,
        };
        this.deviceLossRecoveryInProgress = false;
        this.deviceLossRecoveries = 0;

        // Effect intensities
        this.pulseIntensity = 0;
        this.bloomBoost = 0;
        this.particleGlow = 0;
        this.ringGlow = 0;
        this.ambientSpeedBoost = 0;
        this.ambientSpeedTarget = 0;

        // Play pace tracking
        this.pieceLockTimes = [];
        this.playPaceMultiplier = 1.0;
        this.targetPaceMultiplier = 1.0;
        this.reactiveState = {
            pulse: 0,
            bloom: 0,
            ring: 0,
            particle: 0,
            ambient: 0,
        };
        this.reactiveTarget = {
            pulse: 0,
            bloom: 0,
            ring: 0,
            particle: 0,
            ambient: 0,
        };
        this.reactiveCaps = {
            pulse: 1.2,
            bloom: 0.4,
            ring: 1.0,
            particle: 1.6,
            ambient: 1.6,
        };

        this.activeQualityLevel = 'High';
        this.look = POST_LOOK.High;
        this.performanceBudget = { ...QUALITY_BUDGETS.High };
        this.adaptiveScalerState = {
            frameTimeEmaMs: this.performanceBudget.targetFrameMs,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: 1,
            resolutionScale: this.performanceBudget.baseResolutionScale,
            baseResolutionScale: this.performanceBudget.baseResolutionScale,
            effectScale: 1,
        };
        this.lastPostCostMs = 0;
        this.lastRenderPath = 'none';

        this.eventUnsubscribers = [];

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 3600;
        this.baselineTimeouts = new Set();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
        this.baselineSoakAbortRequested = false;
        this.baselineSoakWaitTimeoutId = null;
        this.baselineSoakWaitResolver = null;
        this.lastBaselineSoakReport = null;
        this.lastBaselineSignoffReport = null;

        console.log('[ChromadelicHighway] Theme constructed');
    }

    getTetrominoConfig() {
        return CHROMADELIC_HIGHWAY_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    isShowcaseTier() {
        return this.activeQualityLevel === 'Extreme' || this.activeQualityLevel === 'Ultra';
    }

    getBaselinePresetOrder() {
        return [...BASELINE_PRESET_ORDER];
    }

    resolveQualityBudget(quality) {
        const normalized = normalizeQuality(quality);
        return {
            ...(QUALITY_BUDGETS[normalized] || QUALITY_BUDGETS.High),
        };
    }

    resetAdaptiveScalerState() {
        const budget = this.performanceBudget || QUALITY_BUDGETS.High;
        const q = Math.min(1, budget.adaptiveMaxScale ?? 1);
        const base = budget.baseResolutionScale ?? 1.0;
        this.adaptiveScalerState = {
            frameTimeEmaMs: budget.targetFrameMs ?? 16.7,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: q,
            resolutionScale: THREE.MathUtils.clamp(base * q, budget.minResolutionScale, budget.maxResolutionScale),
            baseResolutionScale: base,
            effectScale: THREE.MathUtils.clamp((q - 0.25) / 0.75, budget.minEffectScale, 1.0),
            warmupFrames: 30,
            stableMs: 0,
            cooldownMs: 0,
            missRate: 0,
            cadenceMs: 0,
            clockMs: 0,
            probe: null,
            ceiling: Infinity,
            ceilingUntil: 0,
            backoffMs: 30000,
            upStep: budget.adaptiveUpRate ?? 0.02,
            lastTotalDraws: 0,
        };
        this.lastPostCostMs = 0;
        this.lastRenderPath = 'none';
    }

    getRendererPixelRatio(maxRatio = 1.5) {
        const baseRatio = this.getEffectivePixelRatio(maxRatio);
        const resolutionScale = this.adaptiveScalerState?.resolutionScale ?? 1;
        return THREE.MathUtils.clamp(baseRatio * resolutionScale, 0.35, maxRatio);
    }

    applyAdaptiveScalerState() {
        if (!this.renderer || typeof window === 'undefined') return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        // One canvas write (setPixelRatio + setSize would resize the drawing buffer twice).
        this.renderer.setDrawingBufferSize(width, height, this.getRendererPixelRatio(1.5));
        this.syncViewport(width, height);
    }

    /** Pixel-sized content (stars, ring strips, motes) + post terms follow the drawing buffer. */
    syncViewport(width, height) {
        if (!this.renderer) return;
        this.renderer.getDrawingBufferSize(this.drawingBufferSize);
        this.syncedBufferWidth = this.drawingBufferSize.x;
        this.syncedBufferHeight = this.drawingBufferSize.y;
        if (this.camera) this.world?.setViewport(this.drawingBufferSize.y, this.camera, this.drawingBufferSize.x, height);
        this.world?.setEffectScale(this.adaptiveScalerState?.effectScale ?? 1);
        this.postProcessing?.setSize(width, height, this.drawingBufferSize.x, this.drawingBufferSize.y);
    }

    /**
     * Adaptive resolution. Frame intervals are vsync-locked, so headroom cannot be read from
     * them: the scaler steps DOWN on a sustained overrun or a missed-frame rate above 2 %, and
     * probes UP after 6 s at the target. A probe that fails within 3 s returns straight to the
     * last good scale and blocks probes above it with exponential backoff (30 s up to 8 min), so
     * a GPU-bound machine settles instead of cycling through resizes. The budget is the player's
     * target frame rate, but never faster than the display actually presents.
     */
    updateAdaptiveScaler(frameMs) {
        if (
            !Number.isFinite(frameMs)
            || frameMs <= 0
            || this.fixedDeltaSeconds !== null
            || this.flags.baseline
            || this.simFrozen
        ) {
            return;
        }

        const state = this.adaptiveScalerState;
        const budget = this.performanceBudget;
        if (!state || !budget || budget.adaptiveEnabled === false) return;
        state.clockMs += frameMs;

        // Telemetry: per-frame draws (Info auto-resets every rAF unless a harness owns it).
        const info = this.renderer?.info;
        const drawCalls = info?.render?.drawCalls ?? 0;
        const frameDraws = info?.autoReset !== false
            ? drawCalls
            : Math.max(0, drawCalls - (state.lastTotalDraws ?? 0));
        state.lastTotalDraws = drawCalls;
        state.drawCallEma = state.drawCallEma * 0.9 + frameDraws * 0.1;
        state.postCostEmaMs = state.postCostEmaMs * 0.9 + (this.lastPostCostMs || 0) * 0.1;

        // The first frames after (re)start include pipeline compiles: never let them steer.
        if (state.warmupFrames > 0) {
            state.warmupFrames -= 1;
            return;
        }

        // Display cadence: the fastest recent interval, forgetting slowly. It can only RAISE the
        // budget toward 60 Hz (a 165 Hz panel asked for 240 fps); a GPU-bound 30 fps must still
        // read as an overrun. The detected refresh rate, when known, takes precedence.
        state.cadenceMs = state.cadenceMs > 0 ? Math.min(state.cadenceMs * 1.002, frameMs) : frameMs;
        const refreshHz = typeof window !== 'undefined'
            ? window.serenityBlocks?.frameRateController?.monitorRefreshRate
            : 0;
        const targetFps = resolveTargetFps();
        let targetFrameMs = targetFps > 0 ? 1000 / targetFps : budget.targetFrameMs;
        if (refreshHz > 0) targetFrameMs = Math.max(targetFrameMs, 1000 / refreshHz);
        targetFrameMs = Math.max(targetFrameMs, Math.min(state.cadenceMs * 0.98, 1000 / 60));

        state.frameTimeEmaMs = state.frameTimeEmaMs * 0.92 + Math.min(frameMs, targetFrameMs * 2.5) * 0.08;
        const missAlpha = 1 - Math.exp(-frameMs / 2000);
        state.missRate += ((frameMs > targetFrameMs * 1.5 ? 1 : 0) - state.missRate) * missAlpha;

        const overrun = state.frameTimeEmaMs > targetFrameMs * 1.12 || state.missRate > 0.02;
        const atTarget = state.frameTimeEmaMs < targetFrameMs * 1.04 && state.missRate < 0.005;
        state.stableMs = atTarget ? state.stableMs + frameMs : 0;
        state.cooldownMs = Math.max(0, state.cooldownMs - frameMs);

        let nextScale = state.qualityScale;
        if (overrun && state.probe && state.clockMs - state.probe.at < 3000) {
            // The probe failed: back to the last good scale; block probes above it for a while.
            nextScale = state.probe.from;
            state.ceiling = state.probe.to - 0.001;
            state.ceilingUntil = state.clockMs + state.backoffMs;
            state.backoffMs = Math.min(state.backoffMs * 2, 480000);
            state.upStep = budget.adaptiveUpRate;
            state.probe = null;
            state.cooldownMs = 1000;
            state.stableMs = 0;
        } else if (overrun && state.cooldownMs === 0) {
            nextScale -= budget.adaptiveDownRate;
            state.cooldownMs = 750;
            state.stableMs = 0;
            state.probe = null;
            state.upStep = budget.adaptiveUpRate;
        } else if (state.stableMs > 6000) {
            const up = Math.min(nextScale + state.upStep, budget.adaptiveMaxScale);
            const blocked = state.clockMs < state.ceilingUntil && up > state.ceiling;
            if (!blocked && up > nextScale + 1e-4) {
                state.probe = { from: nextScale, to: up, at: state.clockMs };
                nextScale = up;
            }
            state.stableMs = 0;
        }
        if (state.probe && state.clockMs - state.probe.at >= 3000) {
            // The probe held: relax the backoff and climb faster next time.
            state.backoffMs = Math.max(30000, state.backoffMs / 2);
            state.upStep = Math.min(state.upStep * 2, 0.08);
            state.probe = null;
        }

        nextScale = THREE.MathUtils.clamp(nextScale, budget.adaptiveMinScale, budget.adaptiveMaxScale);
        if (budget.adaptiveMaxScale - nextScale < 0.01) nextScale = budget.adaptiveMaxScale;
        if (Math.abs(nextScale - state.qualityScale) < 1e-4) return;

        state.qualityScale = nextScale;
        // Judge the new scale on fresh frames only.
        state.frameTimeEmaMs = targetFrameMs;
        state.missRate = 0;
        state.resolutionScale = THREE.MathUtils.clamp(
            state.baseResolutionScale * nextScale,
            budget.minResolutionScale,
            budget.maxResolutionScale,
        );
        state.effectScale = THREE.MathUtils.clamp(
            (nextScale - 0.25) / 0.75,
            budget.minEffectScale,
            1.0,
        );

        this.applyAdaptiveScalerState();
    }

    getBudgetSnapshot() {
        const state = this.adaptiveScalerState || {};
        const budget = this.performanceBudget || {};
        const tier = WORLD_TIERS[this.activeQualityLevel] || WORLD_TIERS.High;
        return {
            quality: this.activeQualityLevel,
            renderPath: this.lastRenderPath,
            drawCalls: {
                budget: budget.maxDrawCalls ?? null,
                ema: Number((state.drawCallEma ?? 0).toFixed(1)),
            },
            postCostMs: {
                budget: budget.maxPostCostMs ?? null,
                ema: Number((state.postCostEmaMs ?? 0).toFixed(3)),
            },
            particles: {
                streaks: tier.streaks,
                motes: tier.motes,
                stars: tier.stars,
                shootingStarBudget: budget.maxActiveShootingStars ?? null,
            },
            scaler: {
                frameTimeEmaMs: Number((state.frameTimeEmaMs ?? 0).toFixed(3)),
                qualityScale: Number((state.qualityScale ?? 1).toFixed(3)),
                resolutionScale: Number((state.resolutionScale ?? 1).toFixed(3)),
                effectScale: Number((state.effectScale ?? 1).toFixed(3)),
            },
        };
    }

    applyQualityPreset(quality) {
        const normalized = normalizeQuality(quality);
        this.activeQualityLevel = normalized;
        this.look = POST_LOOK[normalized] || POST_LOOK.High;
        this.performanceBudget = this.resolveQualityBudget(normalized);
        this.resetAdaptiveScalerState();
        this.updateReactiveCaps();
        console.log('[ChromadelicHighway] Applied quality profile', {
            quality: normalized,
            drawCallBudget: this.performanceBudget.maxDrawCalls,
            postCostBudgetMs: this.performanceBudget.maxPostCostMs,
        });
    }

    rand() {
        return this.random ? this.random() : Math.random();
    }

    updateReactiveCaps() {
        const showcase = this.isShowcaseTier() ? 1.1 : 1.0;
        this.reactiveCaps = {
            pulse: 1.2 * showcase,
            bloom: 0.4 * showcase,
            ring: 1.0 * showcase,
            particle: 1.6 * showcase,
            ambient: 1.6 * showcase,
        };
    }

    resetReactiveEnvelope() {
        for (const key of REACTIVE_CHANNELS) {
            this.reactiveState[key] = 0;
            this.reactiveTarget[key] = 0;
        }
        this.pulseIntensity = 0;
        this.bloomBoost = 0;
        this.ringGlow = 0;
        this.particleGlow = 0;
        this.ambientSpeedTarget = 0;
    }

    pushReactiveEnvelope(boosts = {}) {
        for (const channel of REACTIVE_CHANNELS) {
            const amount = Number.isFinite(boosts[channel]) ? boosts[channel] : 0;
            if (amount > 0) {
                const cap = this.reactiveCaps[channel] ?? 1;
                this.reactiveTarget[channel] = THREE.MathUtils.clamp(
                    this.reactiveTarget[channel] + amount,
                    0,
                    cap,
                );
            }
        }
    }

    updateReactiveEnvelope(delta) {
        const attack = approach(REACTIVE_ATTACK, delta);
        for (const channel of REACTIVE_CHANNELS) {
            this.reactiveState[channel] += (this.reactiveTarget[channel] - this.reactiveState[channel]) * attack;
            this.reactiveTarget[channel] *= Math.exp(-delta / REACTIVE_DECAY_TAU[channel]);
        }

        this.pulseIntensity = this.reactiveState.pulse;
        this.bloomBoost = this.reactiveState.bloom;
        this.ringGlow = this.reactiveState.ring;
        this.particleGlow = this.reactiveState.particle;
        this.ambientSpeedTarget = this.reactiveState.ambient;
    }

    getBloomStrength() {
        return this.look?.bloom ? this.look.bloomStrength : 0;
    }

    probeCapabilities() {
        const supportsPost = typeof (THREE.RenderPipeline ?? THREE.PostProcessing) === 'function';
        this.capabilities = {
            webgpu: this.isWebGPU,
            webgl: this.isWebGL,
            maxColorAttachments: 1,
            supportsPost,
            supportsMRT: false,
            supportsCompute: false,
            post: !this.flags.noPost && supportsPost,
            mrt: false,
            compute: false,
        };
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        // The post graph owns tone mapping; the direct path (noPost / post failure) uses the
        // closest built-in curve (Khronos Neutral, the base of the post's neon-neutral curve).
        this.renderer.toneMapping = this.capabilities.post ? THREE.NoToneMapping : THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    cancelAnimationLoop() {
        this.loopGeneration += 1;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    clearEventSubscriptions() {
        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];
    }

    removeResizeListener() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    disposePostProcessingStack() {
        for (const key of ['postProcessing', 'passThrough']) {
            const stack = this[key];
            if (stack?.dispose) {
                try {
                    stack.dispose();
                } catch (error) {
                    console.warn(`[ChromadelicHighway] ${key} dispose failed:`, error);
                }
            }
            this[key] = null;
        }
    }

    disposeWorld() {
        if (!this.world) return;
        try {
            this.world.dispose();
        } catch (error) {
            console.warn('[ChromadelicHighway] world dispose failed:', error);
        }
        this.world = null;
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.renderer.onDeviceLost = () => {};
        const { domElement } = this.renderer;
        try {
            this.disposeRenderer(this.renderer, { nullInstance: false });
        } catch (error) {
            console.warn('[ChromadelicHighway] renderer dispose failed:', error);
        }
        if (removeCanvas && domElement?.parentNode) {
            domElement.parentNode.removeChild(domElement);
        }
        this.renderer = null;
    }

    resetRuntimeReferences() {
        this.scene = null;
        this.camera = null;
        this.postProcessing = null;
        this.passThrough = null;
        this.world = null;
        this.layoutState = null;
        this.pieceLockTimes = [];
        this.pulseIntensity = 0;
        this.bloomBoost = 0;
        this.particleGlow = 0;
        this.ringGlow = 0;
        this.ambientSpeedBoost = 0;
        this.ambientSpeedTarget = 0;
        this.playPaceMultiplier = 1.0;
        this.targetPaceMultiplier = 1.0;
        this.reactiveState = {
            pulse: 0,
            bloom: 0,
            ring: 0,
            particle: 0,
            ambient: 0,
        };
        this.reactiveTarget = {
            pulse: 0,
            bloom: 0,
            ring: 0,
            particle: 0,
            ambient: 0,
        };
        this.activeQualityLevel = normalizeQuality(this.activeQualityLevel || 'High');
        this.performanceBudget = this.resolveQualityBudget(this.activeQualityLevel);
        this.resetAdaptiveScalerState();
        this.updateReactiveCaps();
        this.time = 0;
        this.fixedElapsed = 0;
        this.lastFrameTime = null;
        this.simFrozen = false;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            maxColorAttachments: 1,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
            post: false,
            mrt: false,
            compute: false,
        };
        this.baselineSoakAbortRequested = false;
        this.baselineSoakWaitTimeoutId = null;
        this.baselineSoakWaitResolver = null;
        this.lastBaselineSoakReport = null;
        this.lastBaselineSignoffReport = null;
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposePostProcessingStack();
        this.disposeWorld();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        this.deviceLossRecoveries += 1;
        const generation = this.lifecycleGeneration;
        const lostWebGL = info?.api === 'WebGL';
        console.error(`[ChromadelicHighway] ${lostWebGL ? 'WebGL2 context' : 'WebGPU device'} lost:`, info);

        try {
            if (this.deviceLossRecoveries > MAX_DEVICE_LOSS_RECOVERIES) {
                throw new Error(`[ChromadelicHighway] GPU lost ${this.deviceLossRecoveries} times this session; giving up.`);
            }
            console.warn('[ChromadelicHighway] Attempting controlled recovery on the WebGL2 backend...');
            this.removeLayoutWatch();
            this.cancelAnimationLoop();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.requestBaselineSoakStop();
            this.removeBaselineHelpers();
            // Dispose while the context is still lost (GL deletes are no-ops then; after a
            // restore they would hit a context that does not own the objects).
            const lostCanvas = this.renderer?.domElement;
            this.disposeRuntimeResources({ removeCanvas: true });
            if (lostWebGL) {
                await waitForContextRestored(lostCanvas, 1500);
                // stop() (and maybe a new start()) may have run meanwhile: that one owns the theme.
                if (generation !== this.lifecycleGeneration || !this.isActive || this.cleanupComplete) return;
            }

            // Same node path, stable backend: WebGPURenderer on WebGL2.
            this.flags.forceWebGL = true;

            await this.createScene();
            if (!this.renderer) throw new Error('WebGL2 rebuild produced no renderer');
            console.log('[ChromadelicHighway] Recovery complete: running on the WebGL2 backend.');
        } catch (error) {
            const stillOwned = generation === this.lifecycleGeneration && this.isActive && !this.cleanupComplete;
            console.error('[ChromadelicHighway] Device-loss recovery failed:', error);
            this.isActive = false;
            if (stillOwned) {
                try {
                    this.onRuntimeFailure?.(error);
                } catch (notifyError) {
                    console.error('[ChromadelicHighway] runtime-failure notify failed:', notifyError);
                }
            }
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    trackBaselineFrame(deltaSeconds) {
        const frameMs = deltaSeconds * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }

        const renderInfo = this.renderer?.info?.render;
        if (renderInfo) {
            // Info auto-resets every rAF (three's own loop), so these are per-frame values;
            // `calls` counts render() invocations since start, `drawCalls` the frame's draws.
            this.baselineRenderStats.push({
                calls: renderInfo.drawCalls || 0,
                triangles: renderInfo.triangles || 0,
                lines: renderInfo.lines || 0,
                points: renderInfo.points || 0,
            });
            if (this.baselineRenderStats.length > this.baselineMaxFrames) {
                this.baselineRenderStats.shift();
            }
        }
    }

    resetBaseline() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
    }

    reportBaseline() {
        if (!this.baselineFrames.length) {
            console.log('[ChromadelicBaseline] No frames collected yet.');
            return null;
        }

        const sortedFrames = [...this.baselineFrames].sort((a, b) => a - b);
        const frameCount = this.baselineFrames.length;
        const avgMs = this.baselineFrames.reduce((sum, v) => sum + v, 0) / frameCount;
        const avgFps = 1000 / avgMs;
        const varianceMs2 = this.baselineFrames.reduce((sum, frameMs) => {
            const diff = frameMs - avgMs;
            return sum + diff * diff;
        }, 0) / frameCount;
        const stdDevMs = Math.sqrt(varianceMs2);
        const p99Index = Math.max(0, Math.floor(sortedFrames.length * 0.99) - 1);
        const p99Ms = sortedFrames[p99Index];
        const low1Fps = 1000 / p99Ms;
        const renderSamples = this.baselineRenderStats.length || 1;
        const totals = this.baselineRenderStats.reduce((acc, s) => {
            acc.calls += s.calls;
            acc.triangles += s.triangles;
            acc.lines += s.lines;
            acc.points += s.points;
            return acc;
        }, {
            calls: 0,
            triangles: 0,
            lines: 0,
            points: 0,
        });

        const memoryInfo = this.renderer?.info?.memory || {};
        const heapMb = (typeof performance !== 'undefined' && performance.memory?.usedJSHeapSize)
            ? performance.memory.usedJSHeapSize / (1024 * 1024)
            : null;
        const gpuEstimateMb = (memoryInfo.textures !== undefined || memoryInfo.geometries !== undefined)
            ? Number((((memoryInfo.textures ?? 0) * 1.5) + ((memoryInfo.geometries ?? 0) * 0.25)).toFixed(1))
            : null;

        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            preset: this.activeQualityLevel,
            frames: frameCount,
            avgFps: Number(avgFps.toFixed(1)),
            p99Ms: Number(p99Ms.toFixed(2)),
            low1Fps: Number(low1Fps.toFixed(1)),
            frameTimeStdDevMs: Number(stdDevMs.toFixed(3)),
            frameTimeVarianceMs2: Number(varianceMs2.toFixed(4)),
            avgDrawCalls: Number((totals.calls / renderSamples).toFixed(1)),
            avgTriangles: Number((totals.triangles / renderSamples).toFixed(0)),
            avgLines: Number((totals.lines / renderSamples).toFixed(0)),
            avgPoints: Number((totals.points / renderSamples).toFixed(0)),
            textures: memoryInfo.textures ?? null,
            geometries: memoryInfo.geometries ?? null,
            gpuMemoryEstimateMb: gpuEstimateMb,
            heapUsedMb: heapMb !== null ? Number(heapMb.toFixed(1)) : null,
            capabilities: { ...this.capabilities },
            flags: { ...this.flags },
            sequence: { ...this.baselineSequenceStats },
            budget: this.getBudgetSnapshot(),
        };

        console.log('[ChromadelicBaseline] Report:', report);
        return report;
    }

    captureBaseline(label = 'chromadelic') {
        if (!this.renderer?.domElement) {
            console.warn('[ChromadelicBaseline] No renderer canvas available.');
            return null;
        }

        // WebGPURenderer ignores preserveDrawingBuffer on both backends: draw a frame and take the
        // snapshot in the same task (toBlob/toDataURL snapshot synchronously).
        this.renderFrame();
        const canvas = this.renderer.domElement;
        const name = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.png`;
        if (canvas.toBlob) {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                link.click();
                URL.revokeObjectURL(url);
            });
        } else {
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = name;
            link.click();
        }
        return name;
    }

    clearBaselinePlaybackTimers() {
        this.baselineTimeouts.forEach((id) => clearTimeout(id));
        this.baselineTimeouts.clear();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
    }

    scheduleBaselineTimeout(callback, delayMs) {
        if (typeof window === 'undefined') return null;
        const timeoutId = window.setTimeout(() => {
            this.baselineTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.baselineTimeouts.add(timeoutId);
        return timeoutId;
    }

    waitForBaseline(delayMs) {
        return new Promise((resolve) => {
            this.scheduleBaselineTimeout(resolve, delayMs);
        });
    }

    getBaselineSequenceDurationMs(name = 'default', loops = 1, stepMs = 260) {
        const sequence = this.getBaselineSequence(name);
        return sequence.length * loops * stepMs + 50;
    }

    getBaselineSequence(name = 'default') {
        const sequences = {
            default: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 1 } },
                { event: EVENTS.COMBO, payload: { comboCount: 2 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
                { event: EVENTS.COMBO, payload: { comboCount: 4 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.LEVEL_UP, payload: { level: 2 } },
            ],
            stress: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 3 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.LEVEL_UP, payload: { level: 3 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 8 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 3 } },
            ],
        };
        return sequences[name] || sequences.default;
    }

    playBaselineSequence(name = 'default', options = {}) {
        if (typeof window === 'undefined') return false;

        const sequence = this.getBaselineSequence(name);
        const loops = Number.isFinite(options.loops) && options.loops > 0
            ? Math.floor(options.loops)
            : this.flags.playbackLoops;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0
            ? options.stepMs
            : 260;

        this.clearBaselinePlaybackTimers();
        this.baselineSequenceStats = {
            sequence: name,
            loops,
            startedAt: Date.now(),
        };

        for (let loop = 0; loop < loops; loop++) {
            sequence.forEach((step, index) => {
                const delayMs = (loop * sequence.length + index) * stepMs;
                this.scheduleBaselineTimeout(() => {
                    if (!this.isActive) return;
                    let { payload } = step;
                    if (payload && typeof payload === 'object') {
                        payload = { ...payload };
                    }
                    if (step.event === EVENTS.PIECE_LOCK) {
                        payload = { ...(payload || {}), timestamp: delayMs };
                    }
                    eventBus.emit(step.event, payload);
                }, delayMs);
            });
        }

        const endDelay = sequence.length * loops * stepMs + 50;
        this.scheduleBaselineTimeout(() => { }, endDelay);

        console.log('[ChromadelicBaseline] Playing sequence', {
            name,
            loops,
            stepMs,
        });
        return true;
    }

    downloadJson(filename, payload) {
        if (typeof window === 'undefined') return;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    downloadBaselineReport(label = 'chromadelic-baseline') {
        const report = this.reportBaseline();
        if (!report) return null;
        const filename = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.json`;
        this.downloadJson(filename, report);
        return report;
    }

    async captureBaselinePack(options = {}) {
        const {
            label = 'chromadelic-pack',
            stepMs = 260,
            warmupMs = 1200,
            settleMs = 250,
            defaultLoops = 2,
            stressLoops = 2,
            downloadReport = true,
        } = options;

        if (!this.isActive) {
            console.warn('[ChromadelicBaseline] capturePack skipped: theme is not active.');
            return null;
        }

        this.clearBaselinePlaybackTimers();
        this.resetBaseline();

        await this.waitForBaseline(warmupMs);
        this.captureBaseline(`${label}-idle`);

        this.playBaselineSequence('default', { loops: defaultLoops, stepMs });
        await this.waitForBaseline(this.getBaselineSequenceDurationMs('default', defaultLoops, stepMs) + settleMs);
        this.captureBaseline(`${label}-default`);

        this.playBaselineSequence('stress', { loops: stressLoops, stepMs });
        await this.waitForBaseline(this.getBaselineSequenceDurationMs('stress', stressLoops, stepMs) + settleMs);
        this.captureBaseline(`${label}-stress`);

        const report = this.reportBaseline();
        if (downloadReport && report) {
            const filename = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.json`;
            this.downloadJson(filename, report);
        }

        console.log('[ChromadelicBaseline] capturePack complete', {
            label,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            defaultLoops,
            stressLoops,
            stepMs,
        });
        return report;
    }

    async captureReadabilityAnchors(options = {}) {
        const {
            label = 'chromadelic-readability',
            settleMs = 260,
            includeReport = true,
        } = options;

        if (!this.isActive) {
            console.warn('[ChromadelicBaseline] captureReadability skipped: theme is not active.');
            return null;
        }

        this.clearBaselinePlaybackTimers();

        const anchors = [
            { id: 'line-clear-1', event: EVENTS.LINE_CLEAR, payload: { lineCount: 1 } },
            { id: 'line-clear-4', event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
            { id: 'combo-4', event: EVENTS.COMBO, payload: { comboCount: 4 } },
            { id: 'combo-8', event: EVENTS.COMBO, payload: { comboCount: 8 } },
            { id: 'piece-lock', event: EVENTS.PIECE_LOCK, payload: { timestamp: 9999 } },
        ];

        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            eventBus.emit(anchor.event, { ...anchor.payload });
            // Sequential by design: each capture/sample must settle before the next.
            // eslint-disable-next-line no-await-in-loop
            await this.waitForBaseline(settleMs);
            this.captureBaseline(`${label}-${anchor.id}`);
        }

        const report = includeReport ? this.reportBaseline() : null;
        console.log('[ChromadelicBaseline] captureReadability complete', {
            label,
            anchors: anchors.map((a) => a.id),
        });
        return report;
    }

    clearBaselineSoakWait() {
        if (this.baselineSoakWaitTimeoutId !== null) {
            clearTimeout(this.baselineSoakWaitTimeoutId);
            this.baselineSoakWaitTimeoutId = null;
        }
        if (this.baselineSoakWaitResolver) {
            const resolve = this.baselineSoakWaitResolver;
            this.baselineSoakWaitResolver = null;
            resolve();
        }
    }

    requestBaselineSoakStop() {
        this.baselineSoakAbortRequested = true;
        this.clearBaselinePlaybackTimers();
        this.clearBaselineSoakWait();
    }

    waitForBaselineSoakInterval(delayMs) {
        if (typeof window === 'undefined') return Promise.resolve();

        const timeoutMs = Math.max(0, Math.floor(delayMs));
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                this.baselineSoakWaitResolver = null;
                resolve();
            };

            this.clearBaselineSoakWait();
            this.baselineSoakWaitResolver = finish;
            this.baselineSoakWaitTimeoutId = window.setTimeout(() => {
                this.baselineSoakWaitTimeoutId = null;
                finish();
            }, timeoutMs);
        });
    }

    summarizeSoakTrend(samples, key, fallbackIntervalMs = 30000) {
        const points = samples
            .map((sample, index) => {
                const value = sample?.[key];
                if (!Number.isFinite(value)) return null;
                const elapsedMinutes = Number.isFinite(sample.elapsedMinutes)
                    ? sample.elapsedMinutes
                    : (index * fallbackIntervalMs) / 60000;
                return { elapsedMinutes, value };
            })
            .filter(Boolean);

        if (points.length < 2) {
            return {
                sampleCount: points.length,
                delta: null,
                slopePerHour: null,
            };
        }

        const first = points[0];
        const last = points[points.length - 1];
        const delta = last.value - first.value;
        const elapsedMinutes = Math.max(0.0001, last.elapsedMinutes - first.elapsedMinutes);
        const slopePerHour = (delta / elapsedMinutes) * 60;

        return {
            sampleCount: points.length,
            first: Number(first.value.toFixed(3)),
            last: Number(last.value.toFixed(3)),
            delta: Number(delta.toFixed(3)),
            slopePerHour: Number(slopePerHour.toFixed(3)),
        };
    }

    async runBaselineSoak(options = {}) {
        if (!this.isActive) {
            console.warn('[ChromadelicBaseline] runSoak skipped: theme is not active.');
            return null;
        }

        const durationMinutes = Number.isFinite(options.durationMinutes) && options.durationMinutes > 0
            ? options.durationMinutes
            : 30;
        const sampleSeconds = Number.isFinite(options.sampleSeconds) && options.sampleSeconds > 0
            ? options.sampleSeconds
            : 30;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0
            ? options.stepMs
            : 220;
        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0
            ? options.settleMs
            : 260;
        const maxHeapGrowthMb = Number.isFinite(options.maxHeapGrowthMb)
            ? options.maxHeapGrowthMb
            : 140;
        const maxGpuGrowthMb = Number.isFinite(options.maxGpuGrowthMb)
            ? options.maxGpuGrowthMb
            : 120;
        const maxHeapSlopeMbPerHour = Number.isFinite(options.maxHeapSlopeMbPerHour)
            ? options.maxHeapSlopeMbPerHour
            : 180;
        const maxFpsDrop = Number.isFinite(options.maxFpsDrop) ? options.maxFpsDrop : 10;
        const maxP99IncreaseMs = Number.isFinite(options.maxP99IncreaseMs) ? options.maxP99IncreaseMs : 4.5;

        const durationMs = durationMinutes * 60 * 1000;
        const sampleIntervalMs = sampleSeconds * 1000;

        this.clearBaselinePlaybackTimers();
        this.clearBaselineSoakWait();
        this.baselineSoakAbortRequested = false;
        this.lastBaselineSoakReport = null;
        this.resetBaseline();

        const samples = [];
        const startedAt = Date.now();
        const minWaitMs = this.getBaselineSequenceDurationMs('stress', 1, stepMs) + settleMs;

        while (
            this.isActive
            && !this.baselineSoakAbortRequested
            && (Date.now() - startedAt) < durationMs
        ) {
            this.playBaselineSequence('stress', { loops: 1, stepMs });

            const waitMs = Math.max(sampleIntervalMs, minWaitMs);
            // Sequential by design: each capture/sample must settle before the next.
            // eslint-disable-next-line no-await-in-loop
            await this.waitForBaselineSoakInterval(waitMs);

            if (!this.isActive || this.baselineSoakAbortRequested) break;

            const report = this.reportBaseline();
            if (report) {
                samples.push({
                    elapsedMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(3)),
                    avgFps: report.avgFps,
                    p99Ms: report.p99Ms,
                    avgDrawCalls: report.avgDrawCalls,
                    heapUsedMb: report.heapUsedMb,
                    gpuMemoryEstimateMb: report.gpuMemoryEstimateMb,
                    budget: report.budget,
                });
            }
        }

        this.clearBaselinePlaybackTimers();
        this.clearBaselineSoakWait();

        const endedAt = Date.now();
        const elapsedMinutes = Number(((endedAt - startedAt) / 60000).toFixed(3));
        const completed = !this.baselineSoakAbortRequested && this.isActive && elapsedMinutes >= durationMinutes;
        const first = samples[0] || null;
        const last = samples[samples.length - 1] || null;
        const heapTrend = this.summarizeSoakTrend(samples, 'heapUsedMb', sampleIntervalMs);
        const gpuTrend = this.summarizeSoakTrend(samples, 'gpuMemoryEstimateMb', sampleIntervalMs);
        const fpsDrop = first && last ? Number((first.avgFps - last.avgFps).toFixed(3)) : null;
        const p99IncreaseMs = first && last ? Number((last.p99Ms - first.p99Ms).toFixed(3)) : null;

        const memoryTrendStable = (
            (heapTrend.delta === null || heapTrend.delta <= maxHeapGrowthMb)
            && (heapTrend.slopePerHour === null || heapTrend.slopePerHour <= maxHeapSlopeMbPerHour)
            && (gpuTrend.delta === null || gpuTrend.delta <= maxGpuGrowthMb)
        );
        const thermalTrendStable = (
            (fpsDrop === null || fpsDrop <= maxFpsDrop)
            && (p99IncreaseMs === null || p99IncreaseMs <= maxP99IncreaseMs)
        );

        const soakReport = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            preset: this.activeQualityLevel,
            completed,
            aborted: this.baselineSoakAbortRequested,
            durationMinutesRequested: durationMinutes,
            durationMinutesElapsed: elapsedMinutes,
            sampleSeconds,
            stepMs,
            sampleCount: samples.length,
            thresholds: {
                maxHeapGrowthMb,
                maxGpuGrowthMb,
                maxHeapSlopeMbPerHour,
                maxFpsDrop,
                maxP99IncreaseMs,
            },
            trends: {
                heap: heapTrend,
                gpu: gpuTrend,
                fpsDrop,
                p99IncreaseMs,
            },
            memoryTrendStable,
            thermalTrendStable,
            pass: completed && memoryTrendStable && thermalTrendStable,
            samples,
        };

        this.lastBaselineSoakReport = soakReport;
        this.baselineSoakAbortRequested = false;
        console.log('[ChromadelicBaseline] Soak report:', soakReport);
        return soakReport;
    }

    downloadBaselineSoakReport(label = 'chromadelic-soak') {
        const report = this.lastBaselineSoakReport;
        if (!report) {
            console.warn('[ChromadelicBaseline] No soak report available.');
            return null;
        }
        const filename = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.json`;
        this.downloadJson(filename, report);
        return report;
    }

    async runBaselineSignoffPack(options = {}) {
        if (!this.isActive) {
            console.warn('[ChromadelicBaseline] runSignoffPack skipped: theme is not active.');
            return null;
        }

        const {
            label = 'chromadelic-signoff',
            stepMs = 240,
            settleMs = 260,
            warmupMs = 1200,
            defaultLoops = 2,
            stressLoops = 2,
            includeReadability = true,
            includeSoakReport = true,
            downloadReport = true,
        } = options;

        const captures = [];
        const captureLabels = [];
        const capture = (captureLabel) => {
            const filename = this.captureBaseline(captureLabel);
            if (!filename) return null;
            captures.push({
                id: captureLabel,
                filename,
            });
            captureLabels.push(captureLabel);
            return filename;
        };

        this.requestBaselineSoakStop();
        this.baselineSoakAbortRequested = false;
        this.clearBaselinePlaybackTimers();
        this.lastBaselineSignoffReport = null;
        this.resetBaseline();

        await this.waitForBaseline(warmupMs);
        capture(`${label}-hero-idle`);

        this.playBaselineSequence('default', { loops: defaultLoops, stepMs });
        await this.waitForBaseline(this.getBaselineSequenceDurationMs('default', defaultLoops, stepMs) + settleMs);
        capture(`${label}-hero-default`);

        this.playBaselineSequence('stress', { loops: stressLoops, stepMs });
        await this.waitForBaseline(this.getBaselineSequenceDurationMs('stress', stressLoops, stepMs) + settleMs);
        capture(`${label}-hero-stress`);

        const readabilityAnchors = [];
        if (includeReadability) {
            const anchors = [
                { id: 'hero-readability-line-clear-4', event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { id: 'hero-readability-combo-8', event: EVENTS.COMBO, payload: { comboCount: 8 } },
            ];

            for (let i = 0; i < anchors.length; i++) {
                const anchor = anchors[i];
                eventBus.emit(anchor.event, { ...anchor.payload });
                // Sequential by design: each capture/sample must settle before the next.
                // eslint-disable-next-line no-await-in-loop
                await this.waitForBaseline(settleMs);
                const captureLabel = `${label}-${anchor.id}`;
                const filename = capture(captureLabel);
                readabilityAnchors.push({
                    id: anchor.id,
                    filename,
                });
            }
        }

        this.clearBaselinePlaybackTimers();
        const baselineReport = this.reportBaseline();

        const signoffReport = {
            generatedAt: new Date().toISOString(),
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            preset: this.activeQualityLevel,
            flags: { ...this.flags },
            capabilities: { ...this.capabilities },
            budget: this.getBudgetSnapshot(),
            config: {
                stepMs,
                settleMs,
                warmupMs,
                defaultLoops,
                stressLoops,
                includeReadability,
                includeSoakReport,
            },
            captureLabels,
            captures,
            readabilityAnchors,
            baselineReport,
            soakReport: includeSoakReport ? this.lastBaselineSoakReport : null,
        };

        this.lastBaselineSignoffReport = signoffReport;

        if (downloadReport) {
            const filename = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.json`;
            this.downloadJson(filename, signoffReport);
        }

        console.log('[ChromadelicBaseline] Signoff pack complete', {
            label,
            backend: signoffReport.backend,
            captures: captures.length,
            includeReadability,
            hasSoakReport: !!signoffReport.soakReport,
        });
        return signoffReport;
    }

    downloadBaselineSignoffReport(label = 'chromadelic-signoff') {
        const report = this.lastBaselineSignoffReport;
        if (!report) {
            console.warn('[ChromadelicBaseline] No signoff report available.');
            return null;
        }
        const filename = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.json`;
        this.downloadJson(filename, report);
        return report;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.chromadelicBaseline = {
            capture: (label) => this.captureBaseline(label),
            report: () => this.reportBaseline(),
            downloadReport: (label) => this.downloadBaselineReport(label),
            reset: () => this.resetBaseline(),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            capturePack: (options = {}) => this.captureBaselinePack(options),
            captureReadability: (options = {}) => this.captureReadabilityAnchors(options),
            runSoak: (options = {}) => this.runBaselineSoak(options),
            getSoakReport: () => this.lastBaselineSoakReport,
            downloadSoakReport: (label) => this.downloadBaselineSoakReport(label),
            runSignoffPack: (options = {}) => this.runBaselineSignoffPack(options),
            getSignoffReport: () => this.lastBaselineSignoffReport,
            downloadSignoffReport: (label) => this.downloadBaselineSignoffReport(label),
            getPresetOrder: () => this.getBaselinePresetOrder(),
            stop: () => this.requestBaselineSoakStop(),
            // Deterministic capture: seek the world to t (pace 1) and hold it there.
            setTime: (t, { freeze = true } = {}) => {
                this.setSimulationTime(t);
                this.setSimulationFrozen(freeze);
                return this.time;
            },
            freeze: (frozen = true) => this.setSimulationFrozen(frozen),
            state: () => ({
                time: this.time,
                frozen: this.simFrozen,
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                renderPath: this.lastRenderPath,
                quality: this.activeQualityLevel,
                pace: this.playPaceMultiplier,
                drawCalls: this.lastFrameDrawCalls ?? null,
                budget: this.getBudgetSnapshot(),
                composition: this.world?.composition.getDiagnostics() ?? null,
            }),
            composition: () => this.world?.composition.getDiagnostics() ?? null,
        };
        console.log('[ChromadelicBaseline] Helpers: window.chromadelicBaseline.capture(label), report(), downloadReport(label), reset(), play(sequence, options), capturePack(options), captureReadability(options), runSoak(options), getSoakReport(), downloadSoakReport(label), runSignoffPack(options), getSignoffReport(), downloadSignoffReport(label), getPresetOrder(), stop(), setTime(t), freeze(bool), state()');
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.chromadelicBaseline) {
            delete window.chromadelicBaseline;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene
    // ─────────────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        console.log('[ChromadelicHighway] Creating scene...');
        this.requestBaselineSoakStop();
        this.baselineSoakAbortRequested = false;
        this.random = createSeededRandom(this.flags.seed);
        this.fixedElapsed = 0;
        this.resetBaseline();
        this.resetReactiveEnvelope();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('chromadelic-highway-theme');
        if (!container) {
            throw new Error('[ChromadelicHighway] Container #chromadelic-highway-theme not found');
        }

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;
        if (!this.renderer || !this.scene || !this.camera) {
            throw new Error('[ChromadelicHighway] Renderer initialization produced no scene.');
        }

        this.probeCapabilities();
        this.configureRendererColorPipeline();

        const captureMode = this.flags.baseline || this.flags.captureTime !== null;
        this.world = new ChromadelicWorld({
            scene: this.scene,
            quality: this.activeQualityLevel,
            random: () => this.rand(),
            textureBase: './textures/',
            capture: captureMode,
        }).build();
        if (this.flags.parts) this.world.showOnlyParts(this.flags.parts);
        this.layoutState = { applied: undefined, pending: undefined, veil: 0 };
        this.world.setLayout(window.innerWidth / Math.max(1, window.innerHeight), null, {
            width: window.innerWidth, height: window.innerHeight,
        });

        this.setupPostProcessing();
        this.resize(window.innerWidth, window.innerHeight);
        this.setupEventListeners();
        // A parked theme (pre-warmed, or rebuilt behind the menu) watches nothing; resume() installs it.
        if (!this.isPaused) this.installLayoutWatch();

        console.log('[ChromadelicHighway] Runtime', {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            post: this.capabilities.post,
            quality: this.activeQualityLevel,
            budget: this.getBudgetSnapshot(),
            composition: this.world.composition.getDiagnostics(),
        });

        if (this.flags.baseline) {
            this.installBaselineHelpers();
            console.log('[ChromadelicBaseline] Baseline capture enabled', {
                preset: quality,
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                seed: this.flags.seed,
                fixedDeltaMs: this.flags.fixedDeltaMs,
                captureTime: this.flags.captureTime,
            });
        }

        if (this.flags.captureTime !== null) {
            this.setSimulationTime(this.flags.captureTime);
            this.setSimulationFrozen(true);
        }

        // A paused/parked theme (e.g. rebuilt by handleDeviceLoss behind the menu) must own no
        // live loop; resume() restarts it through restartRenderLoop() -> startAnimation().
        if (!this.isPaused) this.startAnimation();

        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, {
                loops: this.flags.playbackLoops,
            });
        }
        console.log('[ChromadelicHighway] Scene created');
    }

    /**
     * Keep the composition and the board veil in step with the live DOM layout, WITHOUT reading
     * the DOM from the frame loop: resize observers, window resizes (via resize()) and a slow 1 s
     * timer (card shown/hidden) trigger a debounced read (120 ms); a read commits only after the
     * rects have been stable for 0.5 s, so boot/warp transitions never make the planets jump.
     * Only a running theme watches: pause() removes the watch and resume() reinstalls it.
     */
    installLayoutWatch() {
        this.removeLayoutWatch();
        if (typeof window === 'undefined' || !this.world) return;
        const watch = {
            debounce: null, stable: null, interval: null, observer: null, observed: new Set(),
        };
        this.layoutWatch = watch;
        const schedule = () => {
            if (this.layoutWatch !== watch) return;
            clearTimeout(watch.debounce);
            watch.debounce = setTimeout(() => this.readLayoutCandidate(watch), 120);
        };
        watch.schedule = schedule;
        if (typeof ResizeObserver === 'function') watch.observer = new ResizeObserver(schedule);
        watch.interval = setInterval(schedule, 1000);
        this.observeLayoutElements(watch);
        schedule();
    }

    observeLayoutElements(watch) {
        if (!watch.observer || typeof document === 'undefined') return;
        // Drop elements the page has replaced (so detached nodes are not held).
        for (const el of watch.observed) {
            if (!el.isConnected) {
                watch.observer.unobserve(el);
                watch.observed.delete(el);
            }
        }
        document.querySelectorAll(`${BOARD_SELECTOR}, ${HUD_SELECTOR}`).forEach((el) => {
            if (watch.observed.has(el)) return;
            watch.observed.add(el);
            watch.observer.observe(el);
        });
    }

    readLayoutCandidate(watch) {
        if (this.layoutWatch !== watch || !this.world || !this.isActive) return;
        const rects = readLayoutRects();
        const ls = this.layoutState;
        if (ls.pending === undefined || layoutsDiffer(rects, ls.pending)) {
            ls.pending = rects;
            clearTimeout(watch.stable);
            watch.stable = setTimeout(() => this.commitLayout(watch), 500);
        }
    }

    commitLayout(watch) {
        if (this.layoutWatch !== watch || !this.world || !this.isActive) return;
        const ls = this.layoutState;
        const rects = readLayoutRects();
        if (layoutsDiffer(rects, ls.pending)) {
            // Still moving: wait for another stable window.
            ls.pending = rects;
            watch.stable = setTimeout(() => this.commitLayout(watch), 500);
            return;
        }
        this.observeLayoutElements(watch);
        if (ls.applied !== undefined && !layoutsDiffer(rects, ls.applied)) return;
        ls.applied = rects;
        this.world.setLayout(window.innerWidth / Math.max(1, window.innerHeight), rects, {
            width: window.innerWidth, height: window.innerHeight,
        });
    }

    removeLayoutWatch() {
        const watch = this.layoutWatch;
        if (!watch) return;
        this.layoutWatch = null;
        clearTimeout(watch.debounce);
        clearTimeout(watch.stable);
        clearInterval(watch.interval);
        watch.observer?.disconnect();
        watch.observed.clear();
    }

    pause() {
        const paused = super.pause();
        if (paused) this.removeLayoutWatch();
        return paused;
    }

    resume() {
        const resumed = super.resume();
        if (resumed && this.world && this.layoutState) this.installLayoutWatch();
        return resumed;
    }

    /** Per frame: ease the board veil in once a board is on screen, out when it leaves. */
    easeVeil(deltaSeconds) {
        if (!this.world || !this.layoutState) return;
        const res = this.world.composition.result;
        const ls = this.layoutState;
        const target = res.veil.board ? 1 : 0;
        ls.veil += (target - ls.veil) * approach(3, deltaSeconds);
        this.postProcessing?.setLayout(res.veil.board, res.veil.hud, ls.veil);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer: WebGPURenderer on either backend (ADR-0019)
    // ─────────────────────────────────────────────────────────────────────────

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        // MSAA and depth live in the scene pass (MSAA on High and up); the canvas only receives
        // one full-screen quad, so it gets neither.
        const makeCandidate = (forceWebGL) => new THREE.WebGPURenderer({
            antialias: false,
            depth: false,
            alpha: false,
            forceWebGL,
        });
        // r185 falls back to WebGL2 by itself when WebGPU rejects; the explicit second
        // candidate covers an adapter/device request that hangs past the init timeout.
        const backends = this.flags.forceWebGL === true ? [true] : [false, true];
        let renderer = null;
        let lastError = null;
        for (const forceWebGL of backends) {
            const candidate = makeCandidate(forceWebGL);
            try {
                // eslint-disable-next-line no-await-in-loop
                await this.initializeRendererCandidate(candidate, {
                    label: `Chromadelic Highway ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
                    ownerGeneration,
                });
                renderer = candidate;
                break;
            } catch (err) {
                try { this.disposeRenderer(candidate, { nullInstance: false }); } catch { /* already retired */ }
                if (!ownsLifecycle()) return false;
                lastError = err;
                console.warn(`[ChromadelicHighway] ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init failed:`, err?.message || err);
            }
        }
        if (!renderer) {
            throw new Error('[ChromadelicHighway] Renderer initialization failed.', { cause: lastError });
        }
        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = !this.isWebGPU;
        // Both backends: WebGPU's device.lost and WebGL2's 'webglcontextlost' land here.
        renderer.onDeviceLost = (info) => {
            if (!ownsLifecycle() || this.renderer !== renderer) return;
            this.handleDeviceLoss(info);
        };
        console.log(`[ChromadelicHighway] WebGPURenderer on the ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

        renderer.setClearColor(0x04030a, 1);
        renderer.setPixelRatio(this.getRendererPixelRatio(1.5));
        renderer.setSize(width, height);
        renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(renderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(CAMERA_RIG.fov, width / height, 1, 12000);
        this.camera.position.copy(CAMERA_RIG.position);
        this.camera.lookAt(CAMERA_RIG.lookAt);
        this.updateCameraProjection(width, height);
        return true;
    }

    /**
     * Hor+ lens: 60° vertical, the horizontal FOV widening with the aspect and capped at 104°
     * (the composition is authored in viewport heights). The world adds pace widening and the
     * Tetris surge on top each frame.
     */
    updateCameraProjection(width, height) {
        if (!this.camera) return;
        const aspect = Math.max(0.1, width / Math.max(1, height));
        this.camera.aspect = aspect;
        this.camera.fov = restVerticalFov(aspect);
        this.camera.updateProjectionMatrix();
    }

    setupPostProcessing() {
        this.disposePostProcessingStack();
        if (!this.capabilities.post) {
            this.setupPassThrough();
            return;
        }

        try {
            const captureMode = this.flags.baseline || this.flags.captureTime !== null;
            this.postProcessing = new ChromadelicHighwayPost(this.renderer, this.scene, this.camera, {
                look: this.look,
                samples: this.flags.msaa ?? (this.getAntialiasEnabled() ? this.look.msaa : 0),
                aspect: window.innerWidth / Math.max(1, window.innerHeight),
                grain: !captureMode,
                falseColor: this.flags.falseColor,
            });
            console.log(`[ChromadelicHighway] Post stack ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
        } catch (err) {
            console.warn('[ChromadelicHighway] Post stack failed, rendering pass-through:', err?.message || err);
            this.capabilities.post = false;
            this.postProcessing = null;
            this.configureRendererColorPipeline();
            this.setupPassThrough();
        }
    }

    /**
     * The canvas has no depth buffer (the scene always renders into a pass), so the no-post and
     * post-failure paths render through a pass-through pipeline instead of drawing directly.
     */
    setupPassThrough() {
        try {
            this.passThrough = createPassThroughPipeline(this.renderer, this.scene, this.camera);
        } catch (err) {
            console.warn('[ChromadelicHighway] Pass-through pipeline failed:', err?.message || err);
            this.passThrough = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Play pace + cinematic punctuation
    // ─────────────────────────────────────────────────────────────────────────

    updatePlayPace() {
        if (this.pieceLockTimes.length < 2) return;

        const times = this.pieceLockTimes;
        let totalInterval = 0;
        for (let i = 1; i < times.length; i++) {
            totalInterval += times[i] - times[i - 1];
        }
        const avgInterval = totalInterval / (times.length - 1);
        const ppm = 60000 / avgInterval;
        this.targetPaceMultiplier = Math.min(Math.max(ppm / 40, 0.5), 2.5);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gameplay events: a capped reactive envelope + travelling light (never full-frame bloom)
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        this.clearEventSubscriptions();
        this.removeResizeListener();
        const reactive = () => this.isActive && window.settings?.backgroundComboEffects !== false;

        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (!this.isActive) return;
            const now = Number.isFinite(data?.timestamp) ? data.timestamp : performance.now();
            this.pieceLockTimes.push(now);
            if (this.pieceLockTimes.length > 10) this.pieceLockTimes.shift();
            this.updatePlayPace();
            if (reactive()) {
                // The most frequent event is the quietest: a rail tick and a faint chevron.
                this.pushReactiveEnvelope({ particle: 0.15, ambient: 0.1 });
                this.world?.onPieceLock();
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!reactive()) return;
            const combo = Number.isFinite(data?.comboCount) ? data.comboCount : 0;
            const intensity = Math.min(combo * 0.16, 1.0);
            this.pushReactiveEnvelope({
                pulse: 0.15 + intensity * 0.3,
                bloom: 0.1 + intensity * 0.3,
                ring: 0.14 + intensity * 0.45,
                particle: 0.11 + intensity * 0.3,
                ambient: 0.2 + intensity * 0.4,
            });
            this.world?.onCombo(combo);
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!reactive()) return;
            const lines = Number.isFinite(data?.lineCount) ? data.lineCount : 0;
            const intensity = Math.min(lines * 0.25, 1.0);
            this.pushReactiveEnvelope({
                pulse: 0.2 + intensity * 0.25,
                bloom: 0.1 + intensity * 0.4,
                ring: 0.1 + intensity * 0.4,
                particle: 0.1 + intensity * 0.5,
                ambient: 0.12 + intensity * 0.25,
            });
            this.world?.onLineClear(lines);
        });

        const levelUpUnsub = eventBus.on(EVENTS.LEVEL_UP, (data) => {
            if (!reactive()) return;
            this.pushReactiveEnvelope({
                pulse: 0.3, bloom: 0.3, ring: 0.3, particle: 0.25, ambient: 0.4,
            });
            this.world?.onLevelUp(Number.isFinite(data?.level) ? data.level : undefined);
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lockUnsub, comboUnsub, lineClearUnsub, levelUpUnsub, pointerUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Simulation clock (seekable, freezable) + animation loop
    // ─────────────────────────────────────────────────────────────────────────

    /** Seek the whole world to time t (pace 1, no events) — deterministic captures. */
    setSimulationTime(t) {
        const time = Math.max(0, Number(t) || 0);
        this.time = time;
        this.fixedElapsed = time;
        this.playPaceMultiplier = 1;
        this.targetPaceMultiplier = 1;
        this.resetReactiveEnvelope();
        this.world?.seek(time);
        if (this.camera && this.world) {
            const sim = this.buildSim(0);
            this.world.updateCamera(this.camera, sim);
            this.world.update(sim, this.camera);
        }
    }

    /** Frozen: rendering continues, simulation time does not advance. */
    setSimulationFrozen(frozen) {
        this.simFrozen = frozen === true;
        this.lastFrameTime = null;
    }

    buildSim(delta) {
        const sim = this._sim || (this._sim = {});
        sim.time = this.time;
        sim.delta = delta;
        sim.pace = this.playPaceMultiplier;
        sim.pulse = this.pulseIntensity;
        sim.ring = this.ringGlow;
        sim.particle = this.particleGlow;
        sim.ambient = this.ambientSpeedBoost;
        sim.pointerX = this.smoothedPointerX;
        sim.pointerY = this.smoothedPointerY;
        return sim;
    }

    /**
     * rAF loop with BaseTheme pacing (target-FPS cap, background throttling via
     * shouldRenderFrame) and a generation guard so a device-loss rebuild can restart it cleanly.
     */
    startAnimation() {
        this.cancelAnimationLoop();
        const generation = this.loopGeneration;
        this.lastFrameTime = null;
        this.consecutiveFrameErrors = 0;
        // Frames right after a (re)start carry compiles and resume gaps: keep them away from the
        // scaler, but keep the scale it learned.
        if (this.adaptiveScalerState) {
            this.adaptiveScalerState.warmupFrames = 30;
            this.adaptiveScalerState.frameTimeEmaMs = this.performanceBudget?.targetFrameMs ?? 16.7;
            this.adaptiveScalerState.stableMs = 0;
            this.adaptiveScalerState.cooldownMs = 0;
        }

        const loop = (now) => {
            if (!this.isActive || generation !== this.loopGeneration || !this.renderer) return;
            this.animationFrameId = requestAnimationFrame(loop);
            this.registerAnimation(this.animationFrameId);
            if (!this.shouldRenderFrame()) return;
            try {
                this.stepFrame(now);
                this.consecutiveFrameErrors = 0;
            } catch (error) {
                this.consecutiveFrameErrors += 1;
                console.error('[ChromadelicHighway] Frame failed:', error);
                if (this.consecutiveFrameErrors >= 5) {
                    console.error('[ChromadelicHighway] Too many consecutive frame errors; stopping the loop.');
                    this.cancelAnimationLoop();
                }
            }
        };

        this.animationFrameId = requestAnimationFrame(loop);
        this.registerAnimation(this.animationFrameId);
    }

    stepFrame(now) {
        if (!this.renderer || !this.scene || !this.camera || !this.world) return;
        const t = Number.isFinite(now) ? now : performance.now();
        const wallDelta = this.lastFrameTime === null ? 1 / 60 : Math.max(0, (t - this.lastFrameTime) / 1000);
        this.lastFrameTime = t;

        let delta;
        if (this.simFrozen) {
            delta = 0;
        } else if (this.fixedDeltaSeconds !== null) {
            delta = this.fixedDeltaSeconds;
            this.fixedElapsed += delta;
        } else {
            delta = Math.min(wallDelta, 0.05);
        }
        this.time = this.fixedDeltaSeconds !== null && !this.simFrozen ? this.fixedElapsed : this.time + delta;

        // Other code (e.g. the Serenity hub's low-quality toggle) may resize our renderer:
        // pixel-sized content must follow the real drawing buffer.
        this.renderer.getDrawingBufferSize(this.drawingBufferSize);
        if (this.drawingBufferSize.x !== this.syncedBufferWidth || this.drawingBufferSize.y !== this.syncedBufferHeight) {
            this.syncViewport(window.innerWidth, window.innerHeight);
        }
        this.easeVeil(wallDelta);

        // Play pace eases back to cruise; all smoothing is frame-rate independent.
        this.targetPaceMultiplier += (1.0 - this.targetPaceMultiplier) * approach(0.12, delta);
        this.playPaceMultiplier += (this.targetPaceMultiplier - this.playPaceMultiplier) * approach(1.8, delta);
        this.updateReactiveEnvelope(delta);
        this.ambientSpeedBoost += (this.ambientSpeedTarget - this.ambientSpeedBoost) * approach(1.2, delta);
        const pointerK = approach(2.2, delta);
        this.smoothedPointerX += (this.pointerX - this.smoothedPointerX) * pointerK;
        this.smoothedPointerY += (this.pointerY - this.smoothedPointerY) * pointerK;

        const sim = this.buildSim(delta);
        this.world.updateCamera(this.camera, sim);
        this.world.update(sim, this.camera);

        if (this.postProcessing) {
            const pp = this._postParams || (this._postParams = { time: 0, dip: 0, bloomBoost: 0 });
            pp.time = this.time;
            pp.dip = this.world.fx.dip;
            pp.bloomBoost = Math.min(1, this.bloomBoost);
            this.postProcessing.update(pp);
        }

        this.renderFrame();
        // Info auto-resets every rAF: latch this frame's draws for state()/reports.
        this.lastFrameDrawCalls = this.renderer.info?.render?.drawCalls ?? 0;
        this.updateAdaptiveScaler(wallDelta * 1000);

        if (this.flags.baseline) {
            this.trackBaselineFrame(wallDelta);
        }
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        const canMeasure = typeof performance !== 'undefined' && typeof performance.now === 'function';
        this.lastPostCostMs = 0;

        if (this.capabilities.post && this.postProcessing) {
            try {
                const postStart = canMeasure ? performance.now() : 0;
                this.postProcessing.render();
                this.lastPostCostMs = canMeasure ? Math.max(0, performance.now() - postStart) : 0;
                this.lastRenderPath = this.isWebGPU ? 'webgpu-post' : 'webgl2-post';
                return;
            } catch (error) {
                console.warn('[ChromadelicHighway] Post render failed, rendering pass-through:', error);
                this.capabilities.post = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
                this.setupPassThrough();
            }
        }

        if (this.passThrough) {
            this.passThrough.render();
            this.lastRenderPath = this.isWebGPU ? 'webgpu-passthrough' : 'webgl2-passthrough';
            return;
        }
        this.renderer.render(this.scene, this.camera);
        this.lastRenderPath = this.isWebGPU ? 'webgpu-direct' : 'webgl2-direct';
    }

    resize(width, height) {
        this.updateCameraProjection(width, height);
        if (this.renderer) {
            this.renderer.setPixelRatio(this.getRendererPixelRatio(1.5));
            this.renderer.setSize(width, height);
        }
        this.syncViewport(width, height);
        // The composition is solved per aspect now; the DOM rects are re-read (debounced) after.
        if (this.world && this.layoutState) {
            this.world.setLayout(width / Math.max(1, height), this.layoutState.applied ?? null, { width, height });
        }
        this.layoutWatch?.schedule?.();
    }

    stop() {
        this.removeLayoutWatch();
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearBaselinePlaybackTimers();
        this.clearBaselineSoakWait();
        this.requestBaselineSoakStop();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });
        this.deviceLossRecoveryInProgress = false;
        super.stop();
    }

    cleanup() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.removeBaselineHelpers();

        super.cleanup();
    }
}
