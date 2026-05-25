/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ STELLAR VELOCITY ✧
 *  A 3D Warp Drive Space Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - GPU-accelerated 3D starfield with dynamic warp trails
 * - Volumetric nebula backdrop with procedural shaders
 * - Central warp core with pulsing energy effects
 * - Asteroid field for depth and parallax
 * - Post-processing: Bloom, Vignette, Chromatic Aberration
 * - Event-driven effects (combos, line clears, piece locks)
 * - Multiple color scheme cycling
 *
 * Architecture inspired by stellar-drift, identity unique to stellar-velocity.
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { STELLAR_VELOCITY_TETROMINOS } from './stellar-velocity-tetrominos.js';
import {
    VignetteShader,
    ChromaticAberrationShader,
} from './stellar-velocity-shaders.js';
import { StellarVelocityPost } from './stellar-velocity-post.js';
import {
    createStellarVelocityStarfieldMaterial,
    createStellarVelocityWarpCoreMaterial,
    createStellarVelocityNebulaMaterial,
    createStellarVelocityAsteroidMaterial,
    createStellarVelocityEnergyRingMaterial,
    createStellarVelocityBurstParticleMaterial,
    createStellarVelocityShockwaveMaterial,
    createStellarVelocityCoreGlowMaterial,
    auditStellarVelocityMaterialReadiness,
} from './stellar-velocity-materials.js';
import {
    getStellarVelocityComputeBudget,
    StellarVelocityStarfieldCompute,
    StellarVelocityBurstCompute,
} from './stellar-velocity-compute.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 5000,
        asteroidCount: 500,
        nebulaCount: 9,
        bloomStrength: 0.30,
        bloomRadius: 0.42,
        enableChromatic: true,
        enablePostProcessing: true,
    },
    Ultra: {
        starCount: 4000,
        asteroidCount: 400,
        nebulaCount: 7,
        bloomStrength: 0.27,
        bloomRadius: 0.40,
        enableChromatic: true,
        enablePostProcessing: true,
    },
    High: {
        starCount: 3000,
        asteroidCount: 300,
        nebulaCount: 6,
        bloomStrength: 0.24,
        bloomRadius: 0.37,
        enableChromatic: true,
        enablePostProcessing: true,
    },
    Medium: {
        starCount: 2000,
        asteroidCount: 200,
        nebulaCount: 4,
        bloomStrength: 0.20,
        bloomRadius: 0.34,
        enableChromatic: false,
        enablePostProcessing: true,
    },
    Low: {
        starCount: 1000,
        asteroidCount: 100,
        nebulaCount: 3,
        bloomStrength: 0.16,
        bloomRadius: 0.30,
        enableChromatic: false,
        enablePostProcessing: false,
    },
    Minimal: {
        starCount: 500,
        asteroidCount: 50,
        nebulaCount: 2,
        bloomStrength: 0.10,
        bloomRadius: 0.24,
        enableChromatic: false,
        enablePostProcessing: false,
    },
};

const WEBGPU_POST_PRESETS = {
    Extreme: {
        bloomStrength: 0.32,
        bloomRadius: 0.36,
        bloomThreshold: 0.06,
        bloomDownsample: 0.82,
    },
    Ultra: {
        bloomStrength: 0.29,
        bloomRadius: 0.34,
        bloomThreshold: 0.06,
        bloomDownsample: 0.80,
    },
    High: {
        bloomStrength: 0.26,
        bloomRadius: 0.31,
        bloomThreshold: 0.08,
        bloomDownsample: 0.76,
    },
    Medium: {
        bloomStrength: 0.22,
        bloomRadius: 0.30,
        bloomThreshold: 0.10,
        bloomDownsample: 0.70,
    },
    Low: {
        bloomStrength: 0.17,
        bloomRadius: 0.26,
        bloomThreshold: 0.72,
        bloomDownsample: 0.6,
    },
    Minimal: {
        bloomStrength: 0.12,
        bloomRadius: 0.22,
        bloomThreshold: 0.74,
        bloomDownsample: 0.5,
    },
};

const STAR_DEPTH_BANDS = {
    nearCutoff: 0.22,
    midCutoff: 0.70,
    near: {
        radiusMin: 80,
        radiusScale: 0.55,
        zMin: -600,
        zSpan: 2600,
    },
    mid: {
        radiusMin: 120,
        radiusScale: 0.85,
        zMin: -1200,
        zSpan: 4200,
    },
    far: {
        radiusMin: 260,
        radiusScale: 1.25,
        zMin: -2500,
        zSpan: 6500,
    },
};

const HYPERDRIVE_PHASES = {
    IDLE: 'IDLE',
    MAP_LOCK: 'MAP_LOCK',
    HYPERDRIVE_SPOOL: 'HYPERDRIVE_SPOOL',
    FTL_TRANSIT: 'FTL_TRANSIT',
    REENTRY_SETTLE: 'REENTRY_SETTLE',
};

const HYPERDRIVE_PHASE_ORDER = [
    HYPERDRIVE_PHASES.MAP_LOCK,
    HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL,
    HYPERDRIVE_PHASES.FTL_TRANSIT,
    HYPERDRIVE_PHASES.REENTRY_SETTLE,
];

const HYPERDRIVE_TIMING_WINDOWS = {
    [HYPERDRIVE_PHASES.MAP_LOCK]: { min: 0.35, max: 0.65 },
    [HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL]: { min: 0.55, max: 0.95 },
    [HYPERDRIVE_PHASES.FTL_TRANSIT]: { min: 1.20, max: 2.80 },
    [HYPERDRIVE_PHASES.REENTRY_SETTLE]: { min: 0.40, max: 0.90 },
};

const HYPERDRIVE_READABILITY_LIMITS = {
    chromaticMax: 0.34,
    bloomPulseMax: 0.48,
    vignetteDarknessMax: 0.68,
    minFov: 48,
};

const PERFORMANCE_BUDGETS = {
    Extreme: {
        maxDrawCalls: 520,
        maxPostCostMs: 4.5,
        maxStars: 8000,
        maxBurstParticles: 50000,
        maxAsteroids: 600,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.74,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.03,
        adaptiveUpRate: 0.022,
        minResolutionScale: 0.74,
        maxResolutionScale: 1.0,
        baseResolutionScale: 0.96,
        minEffectScale: 0.58,
        compileTimeoutMs: 4200,
    },
    Ultra: {
        maxDrawCalls: 450,
        maxPostCostMs: 4.2,
        maxStars: 6000,
        maxBurstParticles: 40000,
        maxAsteroids: 500,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.72,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.032,
        adaptiveUpRate: 0.021,
        minResolutionScale: 0.72,
        maxResolutionScale: 1.0,
        baseResolutionScale: 0.94,
        minEffectScale: 0.56,
        compileTimeoutMs: 3900,
    },
    High: {
        maxDrawCalls: 380,
        maxPostCostMs: 3.8,
        maxStars: 5000,
        maxBurstParticles: 30000,
        maxAsteroids: 400,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.68,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.035,
        adaptiveUpRate: 0.02,
        minResolutionScale: 0.68,
        maxResolutionScale: 1.0,
        baseResolutionScale: 0.91,
        minEffectScale: 0.52,
        compileTimeoutMs: 3600,
    },
    Medium: {
        maxDrawCalls: 280,
        maxPostCostMs: 3.0,
        maxStars: 3000,
        maxBurstParticles: 15000,
        maxAsteroids: 250,
        targetFrameMs: 17.4,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.62,
        adaptiveMaxScale: 0.94,
        adaptiveDownRate: 0.04,
        adaptiveUpRate: 0.018,
        minResolutionScale: 0.62,
        maxResolutionScale: 0.94,
        baseResolutionScale: 0.86,
        minEffectScale: 0.45,
        compileTimeoutMs: 3200,
    },
    Low: {
        maxDrawCalls: 200,
        maxPostCostMs: 2.5,
        maxStars: 1500,
        maxBurstParticles: 5000,
        maxAsteroids: 120,
        targetFrameMs: 18.8,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.56,
        adaptiveMaxScale: 0.84,
        adaptiveDownRate: 0.043,
        adaptiveUpRate: 0.016,
        minResolutionScale: 0.56,
        maxResolutionScale: 0.84,
        baseResolutionScale: 0.76,
        minEffectScale: 0.36,
        compileTimeoutMs: 2800,
    },
    Minimal: {
        maxDrawCalls: 150,
        maxPostCostMs: 2.0,
        maxStars: 800,
        maxBurstParticles: 2000,
        maxAsteroids: 60,
        targetFrameMs: 20.0,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.5,
        adaptiveMaxScale: 0.78,
        adaptiveDownRate: 0.046,
        adaptiveUpRate: 0.014,
        minResolutionScale: 0.5,
        maxResolutionScale: 0.78,
        baseResolutionScale: 0.68,
        minEffectScale: 0.3,
        compileTimeoutMs: 2400,
    },
};

const HIGH_ENHANCEMENT_QUALITY_LEVELS = new Set(['High', 'Ultra', 'Extreme']);

function parseStellarVelocityFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noPost: false,
            noMRT: false,
            noCompute: false,
            noDrs: false,
            noEnhancements: false,
            gpuTiming: false,
            mrtAudit: false,
            baseline: false,
            seed: null,
            fixedDeltaMs: null,
            playback: null,
            playbackLoops: 1,
        };
    }

    const params = new URLSearchParams(window.location.search);
    const readBool = (name) => {
        if (!params.has(name)) return false;
        const value = params.get(name);
        if (value === '' || value === null) return true;
        const normalized = value.toLowerCase();
        return normalized === '1'
            || normalized === 'true'
            || normalized === 'yes'
            || normalized === 'on';
    };

    const seedValue = Number(params.get('stellarVelSeed') || params.get('seed'));
    const fixedDeltaValue = Number(params.get('stellarVelFixedDt') || params.get('fixedDt'));
    const playbackValue = params.get('stellarVelPlayback');
    const playbackLoopsValue = Number(params.get('stellarVelPlaybackLoops'));

    return {
        forceWebGL: readBool('forceWebGL'),
        noPost: readBool('stellarVelNoPost'),
        noMRT: readBool('stellarVelNoMRT'),
        noCompute: readBool('stellarVelNoCompute'),
        noDrs: readBool('stellarVelNoDrs'),
        noEnhancements: readBool('stellarVelNoEnhancements'),
        gpuTiming: readBool('stellarVelGpuTiming'),
        mrtAudit: readBool('stellarVelMrtAudit'),
        baseline: readBool('stellarVelBaseline'),
        seed: Number.isFinite(seedValue) ? seedValue : null,
        fixedDeltaMs: Number.isFinite(fixedDeltaValue) && fixedDeltaValue > 0 ? fixedDeltaValue : null,
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
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class StellarVelocityTheme extends BaseTheme {
    constructor() {
        super('stellar-velocity');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.animationFrameId = null;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;
        this.resizeHandler = null;
        this.boundResizeHandler = null;
        this.webglContextLostHandler = null;
        this.webglContextRestoredHandler = null;
        this.rendererResilienceToken = 0;
        this.bloomPass = null;
        this.vignettePass = null;
        this.chromaticPass = null;

        // Scene elements
        this.starfield = null;
        this.warpStreakLines = null;
        this.warpStreakState = null;
        this.tunnelLattice = null;
        this.warpCore = null;
        this.warpCoreGlow = null;
        this.warpCoreGlowPlanes = [];
        this.glowTextures = [];
        this.warpCoreRings = [];
        this.routeGuides = [];
        this.warpAccretionDisc = null;
        this.energyDischargeArcs = [];
        this.nebulaMeshes = [];
        this.galaxyClusters = [];
        this.dustLaneMeshes = [];
        this.asteroids = [];
        this.asteroidGeometries = [];
        this.asteroidMaterial = null;
        this.asteroidMatrixScratch = new THREE.Object3D();
        this.asteroidReadMatrix = new THREE.Matrix4();
        this.asteroidReadPosition = new THREE.Vector3();
        this.asteroidReadQuaternion = new THREE.Quaternion();
        this.asteroidReadScale = new THREE.Vector3();
        this.asteroidMicroDebris = null;
        this.starfieldCompute = null;
        this.burstCompute = null;
        this.burstParticlePool = null;
        this.burstParticles = [];
        this.shockwaveRings = [];
        this.cometStreaks = [];
        this.cometCounter = 0;
        this.coreLight = null;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.fixedElapsed = 0;

        // Warp drive state
        this.baseSpeed = 0.03;
        this.currentSpeed = this.baseSpeed;
        this.targetSpeed = this.baseSpeed;
        this.maxSpeed = 12.0;
        this.acceleration = 0.05;

        // FOV and tunnel effects
        this.baseFOV = 75;
        this.currentFOV = this.baseFOV;
        this.targetFOV = this.baseFOV;
        this.baseTunnelRadius = 1500;
        this.tunnelRadius = this.baseTunnelRadius;
        this.targetTunnelRadius = this.baseTunnelRadius;

        // Color scheme cycling
        this.currentColorScheme = 0;
        this.colorSchemes = [
            {
                name: 'classic', primary: new THREE.Color(0xffffff), secondary: new THREE.Color(0x88ccff), bg: 0x000000,
            },
            {
                name: 'nebula', primary: new THREE.Color(0x00ffff), secondary: new THREE.Color(0x0088ff), bg: 0x000510,
            },
            {
                name: 'solar', primary: new THREE.Color(0xffd700), secondary: new THREE.Color(0xff8800), bg: 0x001020,
            },
            {
                name: 'aurora', primary: new THREE.Color(0x00ff88), secondary: new THREE.Color(0x00ffcc), bg: 0x000815,
            },
            {
                name: 'crimson', primary: new THREE.Color(0xff4466), secondary: new THREE.Color(0xff0044), bg: 0x100005,
            },
        ];
        this.colorCycleInterval = null;

        // Effect intensities (smooth interpolation)
        this.bloomPulseIntensity = 0;
        this.chromaticIntensity = 0;
        this.warpCoreGlowIntensity = 0.5;
        this.starTwinkleBoost = 0;
        this.cameraShake = new THREE.Vector3(0, 0, 0);
        this.starWarpBoost = 0;
        this.hyperdriveSequence = {
            active: false,
            phase: HYPERDRIVE_PHASES.IDLE,
            phaseElapsed: 0,
            intensity: 0,
            timeline: this.createHyperdriveTimeline(0),
            routeVector: new THREE.Vector3(0, 0, -1),
            routeYaw: 0,
            routePitch: 0,
            routeRoll: 0,
            lastTriggerAt: -Infinity,
        };
        this.hyperdriveFrame = this.createIdleHyperdriveFrame();
        this.reactiveEnvelope = {
            pulse: 0,
            bloom: 0,
            warp: 0,
            chromatic: 0,
            shake: 0,
            star: 0,
            nebula: 0,
        };
        this.reactiveCaps = {
            pulse: 1.2,
            bloom: 0.8,
            warp: 1.8,
            chromatic: 0.9,
            shake: 1.0,
            star: 1.0,
            nebula: 1.0,
        };
        this.reactiveDecayRates = {
            pulse: 1.45,
            bloom: 1.75,
            warp: 1.35,
            chromatic: 2.1,
            shake: 2.3,
            star: 2.4,
            nebula: 1.3,
        };
        this.reactiveEnergyCap = 3.0;
        this.idleSeconds = 0;
        this.nextCometAt = 10;
        this.activePalette = {
            primary: this.colorSchemes[0].primary.clone(),
            secondary: this.colorSchemes[0].secondary.clone(),
            bg: new THREE.Color(this.colorSchemes[0].bg),
        };
        this.tunnelTintScratch = new THREE.Color(0xffffff);
        this.colorTransition = {
            active: false,
            duration: 2.4,
            elapsed: 0,
            fromPrimary: this.activePalette.primary.clone(),
            fromSecondary: this.activePalette.secondary.clone(),
            fromBg: this.activePalette.bg.clone(),
            toPrimary: this.activePalette.primary.clone(),
            toSecondary: this.activePalette.secondary.clone(),
            toBg: this.activePalette.bg.clone(),
        };

        // State
        this.eventUnsubscribers = [];

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        this.qualityPreset = { ...QUALITY_PRESETS.High };
        this.qualityBudget = getStellarVelocityComputeBudget('High');
        this.activeQualityLevel = 'High';
        this.performanceBudget = { ...PERFORMANCE_BUDGETS.High };
        this.adaptiveScalerState = {
            frameTimeEmaMs: this.performanceBudget.targetFrameMs,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: 1,
            resolutionScale: this.performanceBudget.baseResolutionScale,
            baseResolutionScale: this.performanceBudget.baseResolutionScale,
            effectScale: 1,
        };
        this.lastRenderPath = 'none';
        this.lastPostCostMs = 0;
        this.lastFrameCostMs = 0;
        this.hardwareClass = 'unknown';
        this.gpuTiming = {
            requested: false,
            enabled: false,
            supportsTimestampQuery: false,
            backend: 'none',
            resolveIntervalMs: 750,
            lastResolve: 0,
            renderMs: 0,
            postMs: 0,
            computeMs: 0,
            computePassMs: {},
            method: 'cpu',
        };
        this.hotPathProfile = {
            sampleStride: 6,
            frameCounter: 0,
            asteroidGateCounter: 0,
            starfieldEmaMs: 0,
            burstEmaMs: 0,
            asteroidEmaMs: 0,
        };
        this.performanceStreaks = {
            drawOverBudgetFrames: 0,
            postOverBudgetFrames: 0,
            sustainedDegradeFrames: 0,
        };
        this.runtimeBudgetControls = {
            suppressChromatic: false,
            asteroidStride: 1,
            maxTransientDraws: 48,
        };
        this.flags = parseStellarVelocityFlags();
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.activeTimers = new Set();
        this.baselineTimeouts = new Set();
        this.baselineMaxFrames = 3600;
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
        this.materialAuditReport = null;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            post: false,
            mrt: false,
            compute: false,
            maxColorAttachments: 1,
            supportsTimestampQuery: false,
        };

        console.log('[StellarVelocity] Theme constructed (Three.js)');
    }

    getTetrominoConfig() {
        return STELLAR_VELOCITY_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        const resolvedQuality = quality in QUALITY_PRESETS ? quality : 'High';
        this.activeQualityLevel = resolvedQuality;
        this.qualityPreset = { ...(QUALITY_PRESETS[resolvedQuality] || QUALITY_PRESETS.High) };
        this.qualityBudget = getStellarVelocityComputeBudget(resolvedQuality);
        this.performanceBudget = this.resolvePerformanceBudget(resolvedQuality);
        this.qualityPreset.starCount = Math.min(
            this.qualityPreset.starCount,
            this.qualityBudget.maxStars,
            this.performanceBudget.maxStars,
        );
        this.qualityPreset.asteroidCount = Math.min(
            this.qualityPreset.asteroidCount,
            this.qualityBudget.maxAsteroids,
            this.performanceBudget.maxAsteroids,
        );
        this.resetAdaptiveScalerState();
    }

    isEnhancementsEnabled() {
        return this.flags?.noEnhancements !== true;
    }

    isHighEnhancementQuality() {
        return HIGH_ENHANCEMENT_QUALITY_LEVELS.has(this.activeQualityLevel);
    }

    detectHardwareClass() {
        if (typeof navigator === 'undefined') return 'mid';
        const memoryGb = Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : 8;
        const cores = Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 8;
        const userAgent = navigator.userAgent || '';
        const isMobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);

        if (isMobile || memoryGb <= 4 || cores <= 4) return 'entry';
        if (memoryGb >= 12 && cores >= 12) return 'high';
        return 'mid';
    }

    resolvePerformanceBudget(quality) {
        const normalized = normalizeQuality(quality);
        const budget = {
            ...(PERFORMANCE_BUDGETS[normalized] || PERFORMANCE_BUDGETS.High),
        };
        const hardwareClass = this.detectHardwareClass();
        this.hardwareClass = hardwareClass;

        const devicePixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        if (devicePixelRatio > 1.6) {
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 0.92);
            budget.maxResolutionScale = Math.min(budget.maxResolutionScale, 0.98);
        }

        if (hardwareClass === 'entry') {
            budget.maxStars = Math.floor(budget.maxStars * 0.86);
            budget.maxBurstParticles = Math.floor(budget.maxBurstParticles * 0.82);
            budget.maxAsteroids = Math.floor(budget.maxAsteroids * 0.9);
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 0.88);
            budget.maxResolutionScale = Math.min(budget.maxResolutionScale, 0.94);
            budget.targetFrameMs += 0.9;
            budget.minEffectScale = Math.min(budget.minEffectScale, 0.48);
        } else if (hardwareClass === 'high' && this.isWebGPU) {
            budget.baseResolutionScale = Math.min(1.0, budget.baseResolutionScale + 0.03);
            budget.maxResolutionScale = Math.min(1.0, budget.maxResolutionScale);
            budget.targetFrameMs = Math.max(16.2, budget.targetFrameMs - 0.2);
        }

        if (this.isWebGL) {
            budget.maxPostCostMs *= 0.82;
            budget.targetFrameMs += 0.8;
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 0.9);
            budget.maxResolutionScale = Math.min(budget.maxResolutionScale, 0.94);
            budget.minEffectScale = Math.min(budget.minEffectScale, 0.5);
        }

        if (this.flags?.noDrs) {
            budget.adaptiveEnabled = false;
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 1.0);
            budget.maxResolutionScale = Math.min(1.0, budget.maxResolutionScale);
        }

        return budget;
    }

    resetAdaptiveScalerState() {
        const targetFrameMs = this.performanceBudget?.targetFrameMs ?? 16.7;
        const baseResolutionScale = this.performanceBudget?.baseResolutionScale ?? 1;
        this.adaptiveScalerState = {
            frameTimeEmaMs: targetFrameMs,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: 1,
            resolutionScale: baseResolutionScale,
            baseResolutionScale,
            effectScale: 1,
        };
        this.lastRenderPath = 'none';
        this.lastPostCostMs = 0;
        this.lastFrameCostMs = 0;
        this.performanceStreaks.drawOverBudgetFrames = 0;
        this.performanceStreaks.postOverBudgetFrames = 0;
        this.performanceStreaks.sustainedDegradeFrames = 0;
        this.runtimeBudgetControls.suppressChromatic = false;
        this.runtimeBudgetControls.asteroidStride = 1;
        this.runtimeBudgetControls.maxTransientDraws = Math.max(
            8,
            Math.floor((this.performanceBudget?.maxDrawCalls || 220) * 0.10),
        );
        this.hotPathProfile.frameCounter = 0;
        this.hotPathProfile.asteroidGateCounter = 0;
        this.hotPathProfile.starfieldEmaMs = 0;
        this.hotPathProfile.burstEmaMs = 0;
        this.hotPathProfile.asteroidEmaMs = 0;
    }

    getRendererPixelRatio(maxRatio = 1.75) {
        const baseRatio = this.getEffectivePixelRatio(maxRatio);
        const resolutionScale = this.adaptiveScalerState?.resolutionScale ?? 1;
        return THREE.MathUtils.clamp(baseRatio * resolutionScale, 0.35, maxRatio);
    }

    getAdaptiveEffectScale() {
        if (!this.isEnhancementsEnabled()) return 0.0;
        return this.adaptiveScalerState?.effectScale ?? 1.0;
    }

    applyAdaptiveScalerState() {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRendererPixelRatio();

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height);
        this.setMaterialUniformValue(this.starfield?.material, 'uPixelRatio', pixelRatio);

        if (this.postProcessing?.setSize) {
            this.postProcessing.setSize(width, height);
        }

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    getPostCostSampleMs() {
        if (this.gpuTiming?.enabled && Number.isFinite(this.gpuTiming.postMs) && this.gpuTiming.postMs > 0) {
            return this.gpuTiming.postMs;
        }
        return this.lastPostCostMs;
    }

    computeBudgetPressure(state = this.adaptiveScalerState, budget = this.performanceBudget) {
        if (!state || !budget) return 0;
        let pressure = 0;
        const frameOverrun = (state.frameTimeEmaMs - budget.targetFrameMs) / Math.max(1, budget.targetFrameMs);
        if (frameOverrun > 0) {
            pressure += frameOverrun;
        } else {
            pressure += frameOverrun * 0.4;
        }
        if (budget.maxDrawCalls && state.drawCallEma > budget.maxDrawCalls) {
            pressure += ((state.drawCallEma - budget.maxDrawCalls) / budget.maxDrawCalls) * 0.75;
        }
        if (budget.maxPostCostMs && state.postCostEmaMs > budget.maxPostCostMs) {
            pressure += ((state.postCostEmaMs - budget.maxPostCostMs) / budget.maxPostCostMs) * 0.6;
        }
        return pressure;
    }

    updateRuntimeBudgetControls(pressure = 0) {
        const budget = this.performanceBudget;
        const state = this.adaptiveScalerState;
        if (!budget || !state) return;

        const drawOver = budget.maxDrawCalls > 0 && state.drawCallEma > budget.maxDrawCalls;
        const postOver = budget.maxPostCostMs > 0 && state.postCostEmaMs > budget.maxPostCostMs;
        this.performanceStreaks.drawOverBudgetFrames = drawOver
            ? this.performanceStreaks.drawOverBudgetFrames + 1
            : 0;
        this.performanceStreaks.postOverBudgetFrames = postOver
            ? this.performanceStreaks.postOverBudgetFrames + 1
            : 0;
        this.performanceStreaks.sustainedDegradeFrames = pressure > 0.45
            ? this.performanceStreaks.sustainedDegradeFrames + 1
            : Math.max(0, this.performanceStreaks.sustainedDegradeFrames - 2);

        const severe = pressure > 0.9 || this.performanceStreaks.sustainedDegradeFrames > 240;
        this.runtimeBudgetControls.suppressChromatic = severe
            || this.performanceStreaks.postOverBudgetFrames > 120;
        this.runtimeBudgetControls.asteroidStride = severe
            ? 3
            : pressure > 0.45
                ? 2
                : 1;
        const drawBudget = Math.max(80, budget.maxDrawCalls || 220);
        const transientBase = Math.max(8, Math.floor(drawBudget * 0.10));
        this.runtimeBudgetControls.maxTransientDraws = Math.max(
            6,
            Math.floor(transientBase * (0.60 + (state.effectScale || 1) * 0.50)),
        );
    }

    getTransientDrawEstimate() {
        const burstPoolDraw = this.burstParticlePool ? 1 : 0;
        return this.burstParticles.length
            + this.shockwaveRings.length
            + this.cometStreaks.length
            + burstPoolDraw;
    }

    canSpawnTransientFx(requiredDraws = 1) {
        const maxTransient = this.runtimeBudgetControls?.maxTransientDraws ?? 32;
        const estimated = this.getTransientDrawEstimate();
        return estimated + Math.max(1, requiredDraws) <= maxTransient;
    }

    recordHotPathSample(channel, durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) return;
        const weight = 0.14;
        if (channel === 'starfield') {
            this.hotPathProfile.starfieldEmaMs = this.hotPathProfile.starfieldEmaMs * (1 - weight) + durationMs * weight;
            return;
        }
        if (channel === 'burst') {
            this.hotPathProfile.burstEmaMs = this.hotPathProfile.burstEmaMs * (1 - weight) + durationMs * weight;
            return;
        }
        if (channel === 'asteroid') {
            this.hotPathProfile.asteroidEmaMs = this.hotPathProfile.asteroidEmaMs * (1 - weight) + durationMs * weight;
        }
    }

    runHotPathStep(channel, callback, profileFrame) {
        if (!profileFrame || typeof performance === 'undefined') {
            callback();
            return;
        }
        const startMs = performance.now();
        callback();
        const durationMs = performance.now() - startMs;
        this.recordHotPathSample(channel, durationMs);
    }

    configureGpuTiming() {
        const requested = this.flags.gpuTiming === true || this.flags.baseline === true;
        const supportsTimestampQuery = this.capabilities.supportsTimestampQuery === true
            && typeof this.renderer?.resolveTimestampsAsync === 'function'
            && Boolean(this.renderer?.backend);
        this.gpuTiming.requested = requested;
        this.gpuTiming.supportsTimestampQuery = this.capabilities.supportsTimestampQuery === true;
        this.gpuTiming.enabled = requested && supportsTimestampQuery;
        this.gpuTiming.backend = this.getBackendLabel();
        this.gpuTiming.lastResolve = 0;
        this.gpuTiming.renderMs = 0;
        this.gpuTiming.postMs = 0;
        this.gpuTiming.computeMs = 0;
        this.gpuTiming.computePassMs = {};
        this.gpuTiming.method = this.gpuTiming.enabled ? 'gpu-timestamp-query' : 'cpu-timer';

        if (this.renderer?.backend) {
            this.renderer.backend.trackTimestamp = this.gpuTiming.enabled;
        }
    }

    async updateGpuTimings() {
        if (!this.gpuTiming?.enabled || !this.renderer?.backend || !THREE_WEBGPU?.TimestampQuery) return;
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (nowMs - this.gpuTiming.lastResolve < this.gpuTiming.resolveIntervalMs) return;
        this.gpuTiming.lastResolve = nowMs;

        try {
            const renderTotalMs = await this.renderer.resolveTimestampsAsync(THREE_WEBGPU.TimestampQuery.RENDER);
            if (Number.isFinite(renderTotalMs)) {
                this.gpuTiming.renderMs = renderTotalMs;
                if (this.lastRenderPath === 'webgpu-post' || this.lastRenderPath === 'webgl-composer') {
                    this.gpuTiming.postMs = renderTotalMs;
                }
            }
        } catch (_error) {
            // Timestamp queries are optional. Runtime continues on CPU timers.
        }

        try {
            const computeTotalMs = await this.renderer.resolveTimestampsAsync(THREE_WEBGPU.TimestampQuery.COMPUTE);
            if (Number.isFinite(computeTotalMs)) {
                this.gpuTiming.computeMs = computeTotalMs;
            }
            const backend = this.renderer.backend;
            const computePassMs = {};
            const collectPassTiming = (label, computeNode) => {
                if (!computeNode || !backend?.getTimestampUID || !backend?.hasTimestamp || !backend?.getTimestamp) return;
                try {
                    const uid = backend.getTimestampUID(computeNode);
                    if (uid && backend.hasTimestamp(uid)) {
                        computePassMs[label] = backend.getTimestamp(uid);
                    }
                } catch (_error) {
                    // Pass-level timestamp may not be available each resolve cycle.
                }
            };
            collectPassTiming('starfield', this.starfieldCompute?.computeNode);
            collectPassTiming('burst', this.burstCompute?.computeNode);
            if (Object.keys(computePassMs).length > 0) {
                this.gpuTiming.computePassMs = computePassMs;
            }
        } catch (_error) {
            // Compute timing unavailable on current backend/runtime. Continue without it.
        }
    }

    updateAdaptiveScaler(frameMs) {
        if (!Number.isFinite(frameMs) || frameMs <= 0 || !this.renderer) return;

        const state = this.adaptiveScalerState;
        const budget = this.performanceBudget;
        if (!state || !budget) return;

        state.frameTimeEmaMs = state.frameTimeEmaMs * 0.92 + frameMs * 0.08;
        const drawCalls = this.renderer?.info?.render?.calls;
        if (Number.isFinite(drawCalls)) {
            state.drawCallEma = state.drawCallEma * 0.9 + drawCalls * 0.1;
        }
        state.postCostEmaMs = state.postCostEmaMs * 0.88 + this.getPostCostSampleMs() * 0.12;

        const pressure = this.computeBudgetPressure(state, budget);
        this.updateRuntimeBudgetControls(pressure);
        if (!budget.adaptiveEnabled || this.flags.noDrs) {
            return;
        }

        if (pressure > 0) {
            state.qualityScale = THREE.MathUtils.clamp(
                state.qualityScale - budget.adaptiveDownRate * Math.min(1.8, pressure),
                budget.adaptiveMinScale,
                budget.adaptiveMaxScale,
            );
        } else {
            state.qualityScale = THREE.MathUtils.clamp(
                state.qualityScale + budget.adaptiveUpRate,
                budget.adaptiveMinScale,
                budget.adaptiveMaxScale,
            );
        }

        const targetResolutionScale = THREE.MathUtils.clamp(
            state.baseResolutionScale * state.qualityScale,
            budget.minResolutionScale,
            budget.maxResolutionScale,
        );
        const targetEffectScale = THREE.MathUtils.clamp(
            0.56 + state.qualityScale * 0.52,
            budget.minEffectScale,
            1.0,
        );

        const previousResolutionScale = state.resolutionScale;
        const previousEffectScale = state.effectScale;
        state.resolutionScale = THREE.MathUtils.lerp(state.resolutionScale, targetResolutionScale, 0.16);
        state.effectScale = THREE.MathUtils.lerp(state.effectScale, targetEffectScale, 0.14);

        if (Math.abs(previousResolutionScale - state.resolutionScale) > 0.01
            || Math.abs(previousEffectScale - state.effectScale) > 0.015) {
            this.applyAdaptiveScalerState();
        }
    }

    rand() {
        return this.random ? this.random() : Math.random();
    }

    getStarDepthBandSample(tunnelRadius = this.baseTunnelRadius) {
        const roll = this.rand();
        const nearBand = roll < STAR_DEPTH_BANDS.nearCutoff;
        const midBand = roll >= STAR_DEPTH_BANDS.nearCutoff && roll < STAR_DEPTH_BANDS.midCutoff;
        const profile = nearBand
            ? STAR_DEPTH_BANDS.near
            : midBand
                ? STAR_DEPTH_BANDS.mid
                : STAR_DEPTH_BANDS.far;
        return {
            band: nearBand ? 'near' : midBand ? 'mid' : 'far',
            radius: profile.radiusMin + this.rand() * (tunnelRadius * profile.radiusScale),
            z: profile.zMin - this.rand() * profile.zSpan,
        };
    }

    getAsteroidCoreProximity(radius, zPosition) {
        const radial = Number.isFinite(radius) ? Math.max(0, radius) : 0;
        const depth = Math.abs(Number.isFinite(zPosition) ? zPosition : 0);
        const distance = Math.hypot(radial, depth);
        return THREE.MathUtils.clamp(1 - ((distance - 1400) / 6200), 0, 1);
    }

    getMaterialUniforms(material) {
        if (!material) return null;
        if (material.userData?.uniforms && typeof material.userData.uniforms === 'object') {
            return material.userData.uniforms;
        }
        if (material.uniforms && typeof material.uniforms === 'object') {
            return material.uniforms;
        }
        return null;
    }

    setMaterialUniformValue(material, uniformName, value) {
        const uniforms = this.getMaterialUniforms(material);
        const uniformRef = uniforms?.[uniformName];
        if (!uniformRef || typeof uniformRef !== 'object' || !('value' in uniformRef)) {
            return false;
        }

        if (uniformRef.value?.isColor && value?.isColor) {
            uniformRef.value.copy(value);
            return true;
        }

        uniformRef.value = value;
        return true;
    }

    setMaterialColor(material, uniformName, colorValue) {
        if (!material || colorValue === undefined || colorValue === null) return;
        const color = colorValue?.isColor ? colorValue : new THREE.Color(colorValue);
        if (this.setMaterialUniformValue(material, uniformName, color)) return;
        if (material.color?.isColor) {
            material.color.copy(color);
        }
    }

    setMaterialOpacity(material, uniformName, opacityValue) {
        if (!material || !Number.isFinite(opacityValue)) return;
        if (this.setMaterialUniformValue(material, uniformName, opacityValue)) return;
        if (typeof material.opacity === 'number') {
            material.opacity = opacityValue;
        }
    }

    getReactiveImpulseForEvent(eventName, intensity = 1) {
        const n = Math.max(1, Number.isFinite(intensity) ? intensity : 1);
        if (eventName === 'PIECE_LOCK') {
            return { star: 0.1, pulse: 0.05 };
        }
        if (eventName === 'LINE_CLEAR') {
            return {
                pulse: 0.08 + n * 0.05,
                warp: 0.05 + n * 0.03,
                bloom: 0.03 + n * 0.03,
            };
        }
        if (eventName === 'COMBO') {
            return {
                pulse: 0.14 + n * 0.07,
                bloom: 0.05 + n * 0.04,
                warp: 0.08 + n * 0.10,
                chromatic: 0.03 + n * 0.05,
                shake: 0.02 + n * 0.04,
                star: 0.1 + n * 0.1,
                nebula: 0.1 + n * 0.05,
            };
        }
        return {};
    }

    enforceReactiveBudget() {
        const e = this.reactiveEnvelope;
        if (!e) return;

        const weightedEnergy = e.pulse * 0.48
            + e.bloom * 0.42
            + e.warp * 0.58
            + e.chromatic * 0.38
            + e.shake * 0.30
            + e.star * 0.34
            + e.nebula * 0.30;

        if (weightedEnergy <= this.reactiveEnergyCap || weightedEnergy <= 0) return;
        const scale = this.reactiveEnergyCap / weightedEnergy;
        Object.keys(e).forEach((key) => {
            e[key] *= scale;
        });
    }

    applyReactiveImpulse(impulse = {}) {
        if (!this.isEnhancementsEnabled()) return;
        const envelope = this.reactiveEnvelope;
        Object.keys(envelope).forEach((key) => {
            if (!Number.isFinite(impulse[key])) return;
            const cap = this.reactiveCaps[key] ?? 1;
            envelope[key] = Math.min(cap, Math.max(0, envelope[key] + impulse[key]));
        });
        this.enforceReactiveBudget();
        this.idleSeconds = 0;
    }

    triggerReactiveEvent(eventName, intensity = 1) {
        if (!this.isEnhancementsEnabled()) return;
        this.applyReactiveImpulse(this.getReactiveImpulseForEvent(eventName, intensity));
    }

    decayReactiveEnvelope(delta) {
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
        if (dt <= 0) return;
        Object.keys(this.reactiveEnvelope).forEach((key) => {
            const decayRate = this.reactiveDecayRates[key] ?? 1.0;
            const decay = Math.exp(-decayRate * dt);
            this.reactiveEnvelope[key] *= decay;
            if (this.reactiveEnvelope[key] < 0.0001) this.reactiveEnvelope[key] = 0;
        });
        this.enforceReactiveBudget();
    }

    beginColorTransition(nextIndex, durationSeconds = 2.4) {
        const target = this.colorSchemes[nextIndex];
        if (!target) return;

        this.currentColorScheme = nextIndex;
        this.colorTransition.active = true;
        this.colorTransition.elapsed = 0;
        this.colorTransition.duration = Math.max(0.2, durationSeconds);
        this.colorTransition.fromPrimary.copy(this.activePalette.primary);
        this.colorTransition.fromSecondary.copy(this.activePalette.secondary);
        this.colorTransition.fromBg.copy(this.activePalette.bg);
        this.colorTransition.toPrimary.copy(target.primary);
        this.colorTransition.toSecondary.copy(target.secondary);
        this.colorTransition.toBg.set(target.bg);

        console.log('[StellarVelocity] Color scheme transition started:', target.name);
    }

    updateColorTransition(delta) {
        if (!this.colorTransition.active) return;
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
        this.colorTransition.elapsed += dt;
        const t = Math.min(1, this.colorTransition.elapsed / Math.max(this.colorTransition.duration, 0.001));
        this.activePalette.primary.copy(this.colorTransition.fromPrimary).lerp(this.colorTransition.toPrimary, t);
        this.activePalette.secondary.copy(this.colorTransition.fromSecondary).lerp(this.colorTransition.toSecondary, t);
        this.activePalette.bg.copy(this.colorTransition.fromBg).lerp(this.colorTransition.toBg, t);

        if (t >= 1) {
            this.colorTransition.active = false;
        }
    }

    getTunnelTintColor() {
        this.tunnelTintScratch.copy(this.activePalette.primary).lerp(this.activePalette.secondary, 0.35);
        return this.tunnelTintScratch;
    }

    applyActivePalette() {
        if (this.renderer) {
            this.renderer.setClearColor(this.activePalette.bg, 1);
        }

        if (this.warpCore?.material) {
            this.setMaterialColor(this.warpCore.material, 'uColor', this.activePalette.primary);
        }
        if (this.coreLight) {
            this.coreLight.color.copy(this.activePalette.primary);
        }
        this.warpCoreRings.forEach((ring) => {
            this.setMaterialColor(ring.material, 'uColor', this.activePalette.primary);
        });
        this.routeGuides.forEach((guide) => {
            this.tunnelTintScratch.copy(this.activePalette.primary).lerp(this.activePalette.secondary, 0.65);
            this.setMaterialColor(guide.material, 'uColor', this.tunnelTintScratch);
        });
        if (this.warpStreakLines?.material?.color?.copy) {
            this.tunnelTintScratch.copy(this.activePalette.primary).lerp(this.activePalette.secondary, 0.72);
            this.warpStreakLines.material.color.copy(this.tunnelTintScratch);
        }
        if (this.tunnelLattice?.material?.color?.copy) {
            this.tunnelTintScratch.copy(this.activePalette.secondary).lerp(this.activePalette.primary, 0.28);
            this.tunnelLattice.material.color.copy(this.tunnelTintScratch);
        }
        if (this.warpAccretionDisc?.material) {
            this.setMaterialColor(this.warpAccretionDisc.material, 'uColor', this.activePalette.secondary);
        }
        this.warpCoreGlowPlanes.forEach((glow, index) => {
            const glowColor = index === 0 ? this.activePalette.primary : this.activePalette.secondary;
            this.setMaterialColor(glow.material, 'uColor', glowColor);
        });
        this.galaxyClusters.forEach((cluster, index) => {
            this.tunnelTintScratch.copy(this.activePalette.secondary).lerp(this.activePalette.primary, index % 2 ? 0.45 : 0.68);
            this.setMaterialColor(cluster.material, 'uColor', this.tunnelTintScratch);
        });
        this.dustLaneMeshes.forEach((lane) => {
            this.tunnelTintScratch.copy(this.activePalette.bg).multiplyScalar(0.34);
            this.setMaterialColor(lane.material, 'uColor', this.tunnelTintScratch);
        });
        this.energyDischargeArcs.forEach((arc) => {
            this.setMaterialColor(arc.material, 'uColor', this.activePalette.primary);
        });
        if (this.asteroidMicroDebris?.mesh?.material) {
            this.tunnelTintScratch.copy(this.activePalette.secondary).lerp(this.activePalette.primary, 0.35);
            this.setMaterialColor(this.asteroidMicroDebris.mesh.material, 'uColor', this.tunnelTintScratch);
        }
        if (this.burstParticlePool?.material) {
            this.setMaterialColor(this.burstParticlePool.material, 'uColor', this.activePalette.primary);
        }
    }

    runMaterialAudit({ log = this.flags.mrtAudit === true } = {}) {
        if (!this.scene) return null;
        const requireNodeMaterials = this.isWebGPU && this.capabilities.mrt;

        const report = auditStellarVelocityMaterialReadiness(this.scene, {
            requireNodeMaterials,
            enforcePointSizePolicy: this.isWebGPU,
        });
        this.materialAuditReport = report;

        if (!report.ready && this.capabilities.mrt) {
            this.capabilities.mrt = false;
            this.flags.useMRT = false;
        }

        if (log || !report.ready) {
            const level = report.ready ? 'info' : 'warn';
            console[level]('[StellarVelocity] Material audit report', report);
        }

        return report;
    }

    ensureMrtMaterials({ log = this.flags.mrtAudit === true } = {}) {
        if (!this.isWebGPU || !this.capabilities.mrt) {
            return true;
        }

        const report = this.runMaterialAudit({ log });
        if (report?.ready) {
            return true;
        }

        this.capabilities.mrt = false;
        this.flags.useMRT = false;

        if (this.postProcessing?.useMRT === true && this.capabilities.post) {
            console.warn('[StellarVelocity] MRT disabled at runtime due to material readiness; rebuilding post path.');
            this.setupPostProcessing();
        }

        return false;
    }

    getWebGPUPostPreset() {
        const quality = this.getCurrentQualityLevel();
        return WEBGPU_POST_PRESETS[quality] || WEBGPU_POST_PRESETS.High;
    }

    createHyperdriveTimeline(intensity = 0.5) {
        const n = THREE.MathUtils.clamp(Number.isFinite(intensity) ? intensity : 0.5, 0, 1);
        const timeline = {};
        HYPERDRIVE_PHASE_ORDER.forEach((phase) => {
            const window = HYPERDRIVE_TIMING_WINDOWS[phase];
            timeline[phase] = THREE.MathUtils.lerp(window.min, window.max, n);
        });
        return timeline;
    }

    createIdleHyperdriveFrame() {
        return {
            active: false,
            phase: HYPERDRIVE_PHASES.IDLE,
            progress: 0,
            intensity: 0,
            routeGuidance: 0,
            ringShimmerBoost: 0,
            corePulseBoost: 0,
            warpRatioBoost: 0,
            pulseRatioBoost: 0,
            tunnelCompression: 0,
            fovNarrow: 0,
            bloomBoost: 0,
            chromaticBoost: 0,
            shakeBoost: 0,
            shakeDamping: 0,
            starStretchBoost: 0,
            lensHaloBoost: 0,
            reentryFlash: 0,
            routeBiasX: 0,
            routeBiasY: 0,
        };
    }

    getHyperdriveEventIntensity(eventName, intensity = 1) {
        const n = Math.max(1, Number.isFinite(intensity) ? intensity : 1);
        if (eventName === 'PIECE_LOCK') {
            return 0.26;
        }
        if (eventName === 'LINE_CLEAR') {
            return THREE.MathUtils.clamp(0.28 + n * 0.12, 0.32, 0.82);
        }
        if (eventName === 'COMBO') {
            return THREE.MathUtils.clamp(0.36 + n * 0.08, 0.4, 1.0);
        }
        return 0.48;
    }

    sampleHyperdriveRoute(intensity = 0.5) {
        const n = THREE.MathUtils.clamp(Number.isFinite(intensity) ? intensity : 0.5, 0, 1);
        const spread = 0.22 + n * 0.16;
        const yaw = (this.rand() - 0.5) * spread;
        const pitch = (this.rand() - 0.5) * spread * 0.7;
        const roll = (this.rand() - 0.5) * spread * 1.2;
        this.hyperdriveSequence.routeYaw = yaw;
        this.hyperdriveSequence.routePitch = pitch;
        this.hyperdriveSequence.routeRoll = roll;
        this.hyperdriveSequence.routeVector.set(Math.sin(yaw), Math.sin(pitch), -1).normalize();
    }

    setHyperdrivePhase(phase) {
        if (!this.hyperdriveSequence) return;
        if (!HYPERDRIVE_PHASE_ORDER.includes(phase)) {
            this.hyperdriveSequence.active = false;
            this.hyperdriveSequence.phase = HYPERDRIVE_PHASES.IDLE;
            this.hyperdriveSequence.phaseElapsed = 0;
            return;
        }
        this.hyperdriveSequence.phase = phase;
        this.hyperdriveSequence.phaseElapsed = 0;
        this.hyperdriveSequence.active = true;
    }

    advanceHyperdrivePhase() {
        if (!this.hyperdriveSequence?.active) return;
        const currentIndex = HYPERDRIVE_PHASE_ORDER.indexOf(this.hyperdriveSequence.phase);
        if (currentIndex === -1 || currentIndex >= HYPERDRIVE_PHASE_ORDER.length - 1) {
            this.hyperdriveSequence.active = false;
            this.hyperdriveSequence.phase = HYPERDRIVE_PHASES.IDLE;
            this.hyperdriveSequence.phaseElapsed = 0;
            return;
        }
        this.hyperdriveSequence.phase = HYPERDRIVE_PHASE_ORDER[currentIndex + 1];
        this.hyperdriveSequence.phaseElapsed = 0;
    }

    startHyperdriveSequence({
        eventName = 'COMBO',
        intensity = 0.5,
        startPhase = HYPERDRIVE_PHASES.MAP_LOCK,
        forceRestart = false,
    } = {}) {
        if (!this.isEnhancementsEnabled()) return false;

        const sequence = this.hyperdriveSequence;
        const eventIntensity = this.getHyperdriveEventIntensity(eventName, intensity);
        const normalizedIntensity = THREE.MathUtils.clamp(eventIntensity, 0.2, 1.0);
        const requestedStartPhase = HYPERDRIVE_PHASE_ORDER.includes(startPhase)
            ? startPhase
            : HYPERDRIVE_PHASES.MAP_LOCK;
        const now = Number.isFinite(this.time) ? this.time : 0;

        if (!forceRestart && sequence.active) {
            const retriggerDelta = now - (sequence.lastTriggerAt ?? -Infinity);
            if (retriggerDelta < 0.08 && normalizedIntensity <= sequence.intensity) {
                return false;
            }
        }

        sequence.lastTriggerAt = now;

        if (!sequence.active || forceRestart) {
            sequence.intensity = normalizedIntensity;
            sequence.timeline = this.createHyperdriveTimeline(normalizedIntensity);
            this.sampleHyperdriveRoute(normalizedIntensity);
            this.setHyperdrivePhase(requestedStartPhase);
            return true;
        }

        sequence.intensity = THREE.MathUtils.clamp(Math.max(sequence.intensity, normalizedIntensity), 0.2, 1.0);
        sequence.timeline = this.createHyperdriveTimeline(sequence.intensity);
        this.sampleHyperdriveRoute(sequence.intensity);

        if (requestedStartPhase === HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL && sequence.phase === HYPERDRIVE_PHASES.MAP_LOCK) {
            this.setHyperdrivePhase(HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL);
        } else if (sequence.phase === HYPERDRIVE_PHASES.REENTRY_SETTLE && normalizedIntensity >= 0.55) {
            this.setHyperdrivePhase(HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL);
        } else if (sequence.phase === HYPERDRIVE_PHASES.FTL_TRANSIT) {
            const transitDuration = sequence.timeline[HYPERDRIVE_PHASES.FTL_TRANSIT] ?? 1.2;
            sequence.phaseElapsed = Math.min(sequence.phaseElapsed, transitDuration * 0.82);
        }

        return true;
    }

    stopHyperdriveSequence() {
        if (!this.hyperdriveSequence) return;
        this.hyperdriveSequence.active = false;
        this.hyperdriveSequence.phase = HYPERDRIVE_PHASES.IDLE;
        this.hyperdriveSequence.phaseElapsed = 0;
        this.hyperdriveSequence.intensity = 0;
        this.hyperdriveFrame = this.createIdleHyperdriveFrame();
        this.routeGuides.forEach((guide) => {
            guide.visible = false;
            this.setMaterialOpacity(guide.material, 'uOpacity', 0);
        });
    }

    updateHyperdriveChoreography(delta) {
        const frame = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        frame.active = false;
        frame.phase = HYPERDRIVE_PHASES.IDLE;
        frame.progress = 0;
        frame.intensity = 0;
        frame.routeGuidance = 0;
        frame.ringShimmerBoost = 0;
        frame.corePulseBoost = 0;
        frame.warpRatioBoost = 0;
        frame.pulseRatioBoost = 0;
        frame.tunnelCompression = 0;
        frame.fovNarrow = 0;
        frame.bloomBoost = 0;
        frame.chromaticBoost = 0;
        frame.shakeBoost = 0;
        frame.shakeDamping = 0;
        frame.starStretchBoost = 0;
        frame.lensHaloBoost = 0;
        frame.reentryFlash = 0;
        frame.routeBiasX = 0;
        frame.routeBiasY = 0;
        this.hyperdriveFrame = frame;

        if (!this.isEnhancementsEnabled() || !this.hyperdriveSequence?.active) {
            return frame;
        }

        const sequence = this.hyperdriveSequence;
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
        sequence.phaseElapsed += dt;

        let phase = sequence.phase;
        let duration = sequence.timeline?.[phase] ?? 0;
        while (sequence.active && duration > 0 && sequence.phaseElapsed >= duration) {
            sequence.phaseElapsed -= duration;
            this.advanceHyperdrivePhase();
            phase = sequence.phase;
            duration = sequence.timeline?.[phase] ?? 0;
        }

        if (!sequence.active) {
            return frame;
        }

        phase = sequence.phase;
        duration = Math.max(sequence.timeline?.[phase] ?? 0.001, 0.001);
        const linearProgress = THREE.MathUtils.clamp(sequence.phaseElapsed / duration, 0, 1);
        const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
        const smoothDecay = 1 - smoothProgress;
        const intensity = THREE.MathUtils.clamp(sequence.intensity, 0, 1);

        frame.active = true;
        frame.phase = phase;
        frame.progress = smoothProgress;
        frame.intensity = intensity;

        switch (phase) {
        case HYPERDRIVE_PHASES.MAP_LOCK:
            frame.routeGuidance = smoothProgress * intensity;
            frame.ringShimmerBoost = 0.12 + smoothProgress * 0.26 * intensity;
            frame.corePulseBoost = 0.10 + smoothProgress * 0.20 * intensity;
            frame.warpRatioBoost = smoothProgress * 0.08 * intensity;
            frame.tunnelCompression = smoothProgress * 0.08 * intensity;
            frame.fovNarrow = smoothProgress * 0.08 * intensity;
            frame.bloomBoost = smoothProgress * 0.06 * intensity;
            frame.chromaticBoost = smoothProgress * 0.02 * intensity;
            frame.shakeBoost = 0.006 * intensity;
            frame.shakeDamping = 0.55 * smoothProgress;
            frame.starStretchBoost = smoothProgress * 0.08 * intensity;
            frame.lensHaloBoost = smoothProgress * 0.14 * intensity;
            break;
        case HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL:
            frame.routeGuidance = intensity * (0.5 + smoothDecay * 0.35);
            frame.ringShimmerBoost = 0.28 + smoothProgress * 0.46 * intensity;
            frame.corePulseBoost = 0.24 + smoothProgress * 0.46 * intensity;
            frame.warpRatioBoost = 0.14 + smoothProgress * 0.24 * intensity;
            frame.tunnelCompression = 0.14 + smoothProgress * 0.16 * intensity;
            frame.fovNarrow = 0.10 + smoothProgress * 0.12 * intensity;
            frame.bloomBoost = 0.12 + smoothProgress * 0.20 * intensity;
            frame.chromaticBoost = 0.05 + smoothProgress * 0.08 * intensity;
            frame.shakeBoost = 0.02 + smoothProgress * 0.04 * intensity;
            frame.shakeDamping = 0.12 * smoothDecay;
            frame.starStretchBoost = 0.12 + smoothProgress * 0.22 * intensity;
            frame.lensHaloBoost = 0.20 + smoothProgress * 0.20 * intensity;
            break;
        case HYPERDRIVE_PHASES.FTL_TRANSIT:
            frame.routeGuidance = smoothDecay * 0.12 * intensity;
            frame.ringShimmerBoost = 0.34 + intensity * 0.28;
            frame.corePulseBoost = 0.42 + smoothProgress * 0.26 * intensity;
            frame.warpRatioBoost = 0.42 + intensity * 0.30;
            frame.tunnelCompression = 0.34 + smoothProgress * 0.22 * intensity;
            frame.fovNarrow = 0.24 + smoothProgress * 0.14 * intensity;
            frame.bloomBoost = 0.28 + smoothProgress * 0.24 * intensity;
            frame.chromaticBoost = 0.12 + smoothProgress * 0.16 * intensity;
            frame.shakeBoost = 0.08 + smoothProgress * 0.10 * intensity;
            frame.shakeDamping = 0.04;
            frame.starStretchBoost = 0.34 + smoothProgress * 0.32 * intensity;
            frame.lensHaloBoost = 0.34 + smoothProgress * 0.26 * intensity;
            break;
        case HYPERDRIVE_PHASES.REENTRY_SETTLE: {
            const flash = smoothDecay * smoothDecay * intensity;
            frame.reentryFlash = flash;
            frame.ringShimmerBoost = smoothDecay * 0.24 * intensity;
            frame.corePulseBoost = smoothDecay * 0.36 * intensity + flash * 0.45;
            frame.warpRatioBoost = smoothDecay * 0.24 * intensity;
            frame.tunnelCompression = smoothDecay * 0.20;
            frame.fovNarrow = smoothDecay * 0.16;
            frame.bloomBoost = smoothDecay * 0.18 * intensity + flash * 0.38;
            frame.chromaticBoost = smoothDecay * 0.10 * intensity;
            frame.shakeBoost = smoothDecay * 0.08 * intensity;
            frame.shakeDamping = 0.18 * smoothProgress;
            frame.starStretchBoost = smoothDecay * 0.22 * intensity;
            frame.lensHaloBoost = smoothDecay * 0.18 * intensity + flash * 0.24;
            break;
        }
        default:
            break;
        }

        frame.routeBiasX = sequence.routeVector.x * frame.routeGuidance * 0.55;
        frame.routeBiasY = sequence.routeVector.y * frame.routeGuidance * 0.45;
        frame.warpRatioBoost = THREE.MathUtils.clamp(frame.warpRatioBoost, 0, 0.95);
        frame.pulseRatioBoost = THREE.MathUtils.clamp(frame.corePulseBoost * 0.9, 0, 0.95);
        frame.tunnelCompression = THREE.MathUtils.clamp(frame.tunnelCompression, 0, 0.78);
        frame.fovNarrow = THREE.MathUtils.clamp(frame.fovNarrow, 0, 0.62);
        frame.bloomBoost = THREE.MathUtils.clamp(frame.bloomBoost, 0, 1.0);
        frame.chromaticBoost = THREE.MathUtils.clamp(frame.chromaticBoost, 0, 0.9);
        frame.starStretchBoost = THREE.MathUtils.clamp(frame.starStretchBoost, 0, 1.0);
        frame.shakeBoost = THREE.MathUtils.clamp(frame.shakeBoost, 0, 0.36);
        frame.shakeDamping = THREE.MathUtils.clamp(frame.shakeDamping, 0, 0.9);
        frame.lensHaloBoost = THREE.MathUtils.clamp(frame.lensHaloBoost, 0, 1.0);

        return frame;
    }

    scheduleThemeTimeout(callback, delayMs) {
        if (typeof window === 'undefined') return null;
        const timeoutId = window.setTimeout(() => {
            this.activeTimers.delete(timeoutId);
            callback();
        }, delayMs);
        this.activeTimers.add(timeoutId);
        return timeoutId;
    }

    clearThemeTimeouts() {
        this.activeTimers.forEach((id) => clearTimeout(id));
        this.activeTimers.clear();
        this.baselineTimeouts.clear();
        this.colorCycleInterval = null;
    }

    getBackendLabel() {
        if (this.isWebGPU) return 'WebGPU';
        return 'WebGL2';
    }

    getBackendSlug() {
        return this.getBackendLabel().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    shouldForceWebGL() {
        return this.flags.forceWebGL === true;
    }

    refreshRuntimeFlags() {
        const parsedFlags = parseStellarVelocityFlags();
        const previousFlags = this.flags || {};

        // Keep fallback/debug overrides sticky for the lifetime of this theme instance.
        parsedFlags.forceWebGL = parsedFlags.forceWebGL || previousFlags.forceWebGL === true;
        parsedFlags.noPost = parsedFlags.noPost || previousFlags.noPost === true;
        parsedFlags.noMRT = parsedFlags.noMRT || previousFlags.noMRT === true;
        parsedFlags.noCompute = parsedFlags.noCompute || previousFlags.noCompute === true;
        parsedFlags.noDrs = parsedFlags.noDrs || previousFlags.noDrs === true;
        parsedFlags.noEnhancements = parsedFlags.noEnhancements || previousFlags.noEnhancements === true;
        parsedFlags.gpuTiming = parsedFlags.gpuTiming || previousFlags.gpuTiming === true;
        parsedFlags.mrtAudit = parsedFlags.mrtAudit || previousFlags.mrtAudit === true;
        parsedFlags.baseline = parsedFlags.baseline || previousFlags.baseline === true;

        this.flags = parsedFlags;
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
    }

    probeCapabilities() {
        const maxColorAttachments = this.renderer?.capabilities?.maxColorAttachments ?? 1;
        const supportsCompute = this.isWebGPU && typeof this.renderer?.compute === 'function';
        const supportsTimestampQuery = this.renderer?.hasFeature?.('timestamp-query') ?? false;
        const supportsPost = this.isWebGPU
            ? this.renderer?.backend?.isWebGPUBackend === true
                && typeof THREE_WEBGPU.PostProcessing === 'function'
            : this.isWebGL && this.renderer?.isWebGLRenderer === true;
        const enhancementsEnabled = !this.flags.noEnhancements;
        const postEnabledByFlags = !this.flags.noPost && enhancementsEnabled;
        const mrtEnabledByFlags = !this.flags.noMRT && enhancementsEnabled;
        const computeEnabledByFlags = !this.flags.noCompute && enhancementsEnabled;
        this.capabilities = {
            webgpu: this.isWebGPU,
            webgl: this.isWebGL,
            post: this.qualityPreset.enablePostProcessing
                && postEnabledByFlags
                && supportsPost,
            mrt: this.isWebGPU && mrtEnabledByFlags && maxColorAttachments >= 2,
            compute: this.isWebGPU
                && computeEnabledByFlags
                && supportsCompute
                && this.qualityBudget.computeEnabled === true,
            maxColorAttachments,
            supportsTimestampQuery,
        };

        this.flags.usePost = this.capabilities.post;
        this.flags.useMRT = this.capabilities.mrt;
        this.flags.useCompute = this.capabilities.compute;
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (this.isWebGPU && this.capabilities.post) {
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1.0;
            return;
        }

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    cancelAnimationLoop() {
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
        if (this.boundResizeHandler && typeof window !== 'undefined') {
            window.removeEventListener('resize', this.boundResizeHandler);
        }
        this.boundResizeHandler = null;
        this.resizeHandler = null;
    }

    removeRendererResilienceListeners() {
        if (!this.renderer?.domElement) return;

        if (this.webglContextLostHandler) {
            this.renderer.domElement.removeEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.webglContextLostHandler = null;
        }
        if (this.webglContextRestoredHandler) {
            this.renderer.domElement.removeEventListener('webglcontextrestored', this.webglContextRestoredHandler, false);
            this.webglContextRestoredHandler = null;
        }
    }

    setupRendererResilience() {
        if (!this.renderer?.domElement) return;
        const resilienceToken = this.rendererResilienceToken;

        if (this.isWebGL) {
            this.webglContextLostHandler = (event) => {
                if (resilienceToken !== this.rendererResilienceToken || !this.isActive) return;
                event.preventDefault();
                console.warn('[StellarVelocity] WebGL context lost');
            };
            this.webglContextRestoredHandler = () => {
                if (resilienceToken !== this.rendererResilienceToken || !this.isActive) return;
                console.warn('[StellarVelocity] WebGL context restored');
                this.resize(window.innerWidth, window.innerHeight);
            };
            this.renderer.domElement.addEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.renderer.domElement.addEventListener('webglcontextrestored', this.webglContextRestoredHandler, false);
            return;
        }

        this.renderer.onDeviceLost = (info) => {
            if (resilienceToken !== this.rendererResilienceToken || !this.isActive) return;
            void this.handleDeviceLoss(info);
        };

        const deviceLostPromise = this.renderer?.backend?.device?.lost;
        if (deviceLostPromise && typeof deviceLostPromise.then === 'function') {
            deviceLostPromise.then((info) => {
                if (resilienceToken !== this.rendererResilienceToken || !this.isActive) return;
                void this.handleDeviceLoss(info);
            }).catch(() => {
                // Ignore teardown races.
            });
        }
    }

    disposePostProcessingStack() {
        this.bloomPass?.dispose?.();
        this.vignettePass?.dispose?.();
        this.chromaticPass?.dispose?.();
        this.bloomPass = null;
        this.vignettePass = null;
        this.chromaticPass = null;

        if (this.postProcessing?.dispose) {
            try {
                this.postProcessing.dispose();
            } catch (error) {
                console.warn('[StellarVelocity] postProcessing dispose failed:', error);
            }
        }
        this.postProcessing = null;

        if (this.composer?.dispose) {
            try {
                this.composer.dispose();
            } catch (error) {
                console.warn('[StellarVelocity] composer dispose failed:', error);
            }
        }
        this.composer = null;
    }

    disposeSceneResources() {
        if (!this.scene) return;

        const disposedGeometries = new Set();
        const disposedMaterials = new Set();
        const disposedTextures = new Set();
        const disposeTexture = (texture) => {
            if (!texture?.isTexture) return;
            if (disposedTextures.has(texture.uuid)) return;
            disposedTextures.add(texture.uuid);
            texture.dispose();
        };
        const disposeMaterial = (material) => {
            if (!material) return;
            if (disposedMaterials.has(material.uuid)) return;
            disposedMaterials.add(material.uuid);

            const textureKeys = [
                'map',
                'alphaMap',
                'aoMap',
                'bumpMap',
                'displacementMap',
                'emissiveMap',
                'envMap',
                'lightMap',
                'metalnessMap',
                'normalMap',
                'roughnessMap',
                'specularMap',
                'gradientMap',
                'matcap',
            ];

            textureKeys.forEach((key) => disposeTexture(material[key]));
            if (material.uniforms && typeof material.uniforms === 'object') {
                Object.values(material.uniforms).forEach((uniform) => {
                    disposeTexture(uniform?.value);
                });
            }
            material.dispose?.();
        };

        this.scene.traverse((object) => {
            if (object.geometry?.uuid && !disposedGeometries.has(object.geometry.uuid)) {
                disposedGeometries.add(object.geometry.uuid);
                object.geometry.dispose?.();
            }

            if (!object.material) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => disposeMaterial(material));
        });
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.rendererResilienceToken += 1;
        this.renderer.onDeviceLost = null;
        if (this.renderer?.backend) {
            this.renderer.backend.trackTimestamp = false;
        }
        this.removeRendererResilienceListeners();
        const domElement = this.renderer.domElement;
        try {
            this.renderer.dispose();
        } catch (error) {
            console.warn('[StellarVelocity] renderer dispose failed:', error);
        }

        if (removeCanvas && domElement?.parentNode) {
            domElement.parentNode.removeChild(domElement);
        }
        this.renderer = null;
    }

    disposeComputeResources() {
        this.starfieldCompute?.dispose?.();
        this.burstCompute?.dispose?.();
        this.starfieldCompute = null;
        this.burstCompute = null;
        this.burstParticlePool = null;
    }

    resetRuntimeReferences() {
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.starfield = null;
        this.warpStreakLines = null;
        this.warpStreakState = null;
        this.tunnelLattice = null;
        this.warpCore = null;
        this.warpCoreGlow = null;
        this.warpCoreGlowPlanes = [];
        this.glowTextures = [];
        this.warpCoreRings = [];
        this.routeGuides = [];
        this.warpAccretionDisc = null;
        this.energyDischargeArcs = [];
        this.nebulaMeshes = [];
        this.galaxyClusters = [];
        this.dustLaneMeshes = [];
        this.asteroids = [];
        this.asteroidGeometries = [];
        this.asteroidMaterial = null;
        this.asteroidMatrixScratch = new THREE.Object3D();
        this.asteroidReadMatrix = new THREE.Matrix4();
        this.asteroidReadPosition = new THREE.Vector3();
        this.asteroidReadQuaternion = new THREE.Quaternion();
        this.asteroidReadScale = new THREE.Vector3();
        this.asteroidMicroDebris = null;
        this.starfieldCompute = null;
        this.burstCompute = null;
        this.burstParticlePool = null;
        this.burstParticles = [];
        this.shockwaveRings = [];
        this.cometStreaks = [];
        this.cometCounter = 0;
        this.coreLight = null;
        this.bloomPass = null;
        this.vignettePass = null;
        this.chromaticPass = null;
        this._starTexture = null;
        this.animationFrameId = null;
        this.time = 0;
        this.fixedElapsed = 0;
        this.currentSpeed = this.baseSpeed;
        this.targetSpeed = this.baseSpeed;
        this.currentFOV = this.baseFOV;
        this.targetFOV = this.baseFOV;
        this.tunnelRadius = this.baseTunnelRadius;
        this.targetTunnelRadius = this.baseTunnelRadius;
        this.starWarpBoost = 0;
        this.idleSeconds = 0;
        this.nextCometAt = 10;
        this.hyperdriveSequence = {
            active: false,
            phase: HYPERDRIVE_PHASES.IDLE,
            phaseElapsed: 0,
            intensity: 0,
            timeline: this.createHyperdriveTimeline(0),
            routeVector: new THREE.Vector3(0, 0, -1),
            routeYaw: 0,
            routePitch: 0,
            routeRoll: 0,
            lastTriggerAt: -Infinity,
        };
        this.hyperdriveFrame = this.createIdleHyperdriveFrame();
        this.reactiveEnvelope = {
            pulse: 0,
            bloom: 0,
            warp: 0,
            chromatic: 0,
            shake: 0,
            star: 0,
            nebula: 0,
        };
        this.activePalette = {
            primary: this.colorSchemes[this.currentColorScheme].primary.clone(),
            secondary: this.colorSchemes[this.currentColorScheme].secondary.clone(),
            bg: new THREE.Color(this.colorSchemes[this.currentColorScheme].bg),
        };
        this.tunnelTintScratch = new THREE.Color(0xffffff);
        this.colorTransition = {
            active: false,
            duration: 2.4,
            elapsed: 0,
            fromPrimary: this.activePalette.primary.clone(),
            fromSecondary: this.activePalette.secondary.clone(),
            fromBg: this.activePalette.bg.clone(),
            toPrimary: this.activePalette.primary.clone(),
            toSecondary: this.activePalette.secondary.clone(),
            toBg: this.activePalette.bg.clone(),
        };
        this.materialAuditReport = null;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.qualityBudget = getStellarVelocityComputeBudget('High');
        this.activeQualityLevel = 'High';
        this.performanceBudget = this.resolvePerformanceBudget('High');
        this.resetAdaptiveScalerState();
        this.gpuTiming = {
            requested: false,
            enabled: false,
            supportsTimestampQuery: false,
            backend: 'none',
            resolveIntervalMs: 750,
            lastResolve: 0,
            renderMs: 0,
            postMs: 0,
            computeMs: 0,
            computePassMs: {},
            method: 'cpu',
        };
        this.hardwareClass = 'unknown';
        this.capabilities = {
            webgpu: false,
            webgl: false,
            post: false,
            mrt: false,
            compute: false,
            maxColorAttachments: 1,
            supportsTimestampQuery: false,
        };
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposeComputeResources();
        this.disposePostProcessingStack();
        this.disposeSceneResources();
        this.asteroidGeometries.forEach((geometry) => geometry?.dispose?.());
        this.glowTextures.forEach((texture) => texture?.dispose?.());
        this._starTexture?.dispose?.();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async precompileSceneWithTimeout(timeoutMs = 3000) {
        if (!this.renderer?.compileAsync || !this.scene || !this.camera) return false;
        let timeoutId = null;

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                new Promise((_, reject) => {
                    timeoutId = this.scheduleThemeTimeout(() => {
                        reject(new Error(`compileAsync timeout after ${timeoutMs}ms`));
                    }, timeoutMs);
                }),
            ]);
            console.log('[StellarVelocity] compileAsync warmup complete');
            return true;
        } catch (error) {
            console.warn('[StellarVelocity] compileAsync warmup skipped/fallback:', error);
            return false;
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                this.activeTimers.delete(timeoutId);
            }
        }
    }

    async requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.renderFallbackInProgress || !this.isActive) return;
        if (this.shouldForceWebGL() && this.isWebGL) return;
        this.renderFallbackInProgress = true;

        console.warn('[StellarVelocity] Requesting WebGL fallback', {
            reason,
            error: error?.message || error || null,
        });

        try {
            this.cancelAnimationLoop();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.clearThemeTimeouts();
            this.clearBaselinePlaybackTimers();
            this.disposeRuntimeResources({ removeCanvas: true });

            this.flags.forceWebGL = true;
            this.flags.noMRT = true;
            this.flags.noCompute = true;

            await this.createScene();
            console.log('[StellarVelocity] WebGL fallback active');
        } catch (fallbackError) {
            console.error('[StellarVelocity] WebGL fallback failed:', fallbackError);
            this.isActive = false;
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;
        this.deviceLossRecoveryInProgress = true;

        console.error('[StellarVelocity] WebGPU device lost:', info);
        try {
            await this.requestWebGLFallback('device-loss', info);
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
            this.baselineRenderStats.push({
                calls: renderInfo.calls || 0,
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
            console.log('[StellarVelocityBaseline] No frames collected yet.');
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
            backend: this.getBackendLabel(),
            preset: this.getCurrentQualityLevel(),
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
            performanceBudget: {
                targetFrameMs: this.performanceBudget?.targetFrameMs ?? null,
                maxDrawCalls: this.performanceBudget?.maxDrawCalls ?? null,
                maxPostCostMs: this.performanceBudget?.maxPostCostMs ?? null,
                maxStars: this.performanceBudget?.maxStars ?? null,
                maxBurstParticles: this.performanceBudget?.maxBurstParticles ?? null,
                maxAsteroids: this.performanceBudget?.maxAsteroids ?? null,
                hardwareClass: this.hardwareClass,
            },
            adaptiveState: {
                frameTimeEmaMs: Number((this.adaptiveScalerState?.frameTimeEmaMs ?? 0).toFixed(3)),
                drawCallEma: Number((this.adaptiveScalerState?.drawCallEma ?? 0).toFixed(2)),
                postCostEmaMs: Number((this.adaptiveScalerState?.postCostEmaMs ?? 0).toFixed(3)),
                resolutionScale: Number((this.adaptiveScalerState?.resolutionScale ?? 1).toFixed(3)),
                effectScale: Number((this.adaptiveScalerState?.effectScale ?? 1).toFixed(3)),
                lastRenderPath: this.lastRenderPath,
                lastPostCostMs: Number((this.lastPostCostMs ?? 0).toFixed(3)),
            },
            gpuTiming: {
                requested: this.gpuTiming?.requested ?? false,
                enabled: this.gpuTiming?.enabled ?? false,
                supportsTimestampQuery: this.gpuTiming?.supportsTimestampQuery ?? false,
                method: this.gpuTiming?.method ?? 'cpu',
                renderMs: Number((this.gpuTiming?.renderMs ?? 0).toFixed(3)),
                postMs: Number((this.gpuTiming?.postMs ?? 0).toFixed(3)),
                computeMs: Number((this.gpuTiming?.computeMs ?? 0).toFixed(3)),
                computePassMs: this.gpuTiming?.computePassMs || {},
            },
            hotPathProfile: {
                starfieldEmaMs: Number((this.hotPathProfile?.starfieldEmaMs ?? 0).toFixed(4)),
                burstEmaMs: Number((this.hotPathProfile?.burstEmaMs ?? 0).toFixed(4)),
                asteroidEmaMs: Number((this.hotPathProfile?.asteroidEmaMs ?? 0).toFixed(4)),
            },
            runtimeBudgetControls: {
                suppressChromatic: this.runtimeBudgetControls?.suppressChromatic ?? false,
                asteroidStride: this.runtimeBudgetControls?.asteroidStride ?? 1,
                maxTransientDraws: this.runtimeBudgetControls?.maxTransientDraws ?? null,
            },
            sceneFx: {
                burstCount: this.burstParticles.length,
                shockwaveCount: this.shockwaveRings.length,
                energyArcCount: this.energyDischargeArcs.length,
                cometCount: this.cometStreaks.length,
                warpStreakLines: this.warpStreakState?.count ?? 0,
                tunnelLatticeEnabled: this.tunnelLattice?.visible === true,
                galaxyClusterCount: this.galaxyClusters.length,
                dustLaneCount: this.dustLaneMeshes.length,
                asteroidMicroDebrisCount: this.asteroidMicroDebris?.count ?? 0,
            },
            hyperdrive: {
                active: this.hyperdriveSequence?.active ?? false,
                phase: this.hyperdriveSequence?.phase ?? HYPERDRIVE_PHASES.IDLE,
                intensity: Number((this.hyperdriveSequence?.intensity ?? 0).toFixed(3)),
                progress: Number((this.hyperdriveFrame?.progress ?? 0).toFixed(3)),
                routeGuidance: Number((this.hyperdriveFrame?.routeGuidance ?? 0).toFixed(3)),
                reentryFlash: Number((this.hyperdriveFrame?.reentryFlash ?? 0).toFixed(3)),
            },
            flags: { ...this.flags },
            sequence: { ...this.baselineSequenceStats },
        };

        console.log('[StellarVelocityBaseline] Report:', report);
        return report;
    }

    captureBaseline(label = 'stellar-velocity') {
        if (!this.renderer?.domElement) {
            console.warn('[StellarVelocityBaseline] No renderer canvas available.');
            return;
        }

        const canvas = this.renderer.domElement;
        const name = `${label}-${this.getBackendSlug()}-${Date.now()}.png`;
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
            return;
        }

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = name;
        link.click();
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

    downloadBaselineReport(label = 'stellar-velocity-baseline') {
        const report = this.reportBaseline();
        if (!report) return null;
        const filename = `${label}-${this.getBackendSlug()}-${Date.now()}.json`;
        this.downloadJson(filename, report);
        return report;
    }

    clearBaselinePlaybackTimers() {
        this.baselineTimeouts.forEach((id) => {
            clearTimeout(id);
            this.activeTimers.delete(id);
        });
        this.baselineTimeouts.clear();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
    }

    scheduleBaselineTimeout(callback, delayMs) {
        let timeoutId = null;
        timeoutId = this.scheduleThemeTimeout(() => {
            this.baselineTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        if (timeoutId !== null) {
            this.baselineTimeouts.add(timeoutId);
        }
        return timeoutId;
    }

    waitForBaseline(delayMs) {
        return new Promise((resolve) => {
            this.scheduleBaselineTimeout(resolve, delayMs);
        });
    }

    getBaselineSequence(name = 'default') {
        const sequences = {
            default: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
                { event: EVENTS.COMBO, payload: { comboCount: 3 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.COMBO, payload: { comboCount: 5 } },
            ],
            stress: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.COMBO, payload: { comboCount: 8 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 10 } },
            ],
        };
        return sequences[name] || sequences.default;
    }

    getBaselineSequenceDurationMs(name = 'default', loops = 1, stepMs = 320) {
        const sequence = this.getBaselineSequence(name);
        return sequence.length * loops * stepMs + 50;
    }

    playBaselineSequence(name = 'default', options = {}) {
        if (typeof window === 'undefined') return false;

        const sequence = this.getBaselineSequence(name);
        const loops = Number.isFinite(options.loops) && options.loops > 0
            ? Math.floor(options.loops)
            : this.flags.playbackLoops;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0
            ? options.stepMs
            : 320;

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
                    const payload = step.payload && typeof step.payload === 'object'
                        ? { ...step.payload }
                        : step.payload;
                    eventBus.emit(step.event, payload);
                }, delayMs);
            });
        }

        this.scheduleBaselineTimeout(() => { }, this.getBaselineSequenceDurationMs(name, loops, stepMs));

        console.log('[StellarVelocityBaseline] Playing sequence', {
            name,
            loops,
            stepMs,
        });
        return true;
    }

    async captureBaselinePack(options = {}) {
        const {
            label = 'stellar-velocity-pack',
            stepMs = 320,
            warmupMs = 1200,
            settleMs = 280,
            defaultLoops = 2,
            stressLoops = 2,
            captureWarpPhases = true,
            downloadReport = true,
        } = options;

        if (!this.isActive) {
            console.warn('[StellarVelocityBaseline] capturePack skipped: theme is not active.');
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

        if (captureWarpPhases) {
            const warpIntensity = this.getHyperdriveEventIntensity('COMBO', 6);
            const timeline = this.createHyperdriveTimeline(warpIntensity);
            eventBus.emit(EVENTS.COMBO, { comboCount: 6 });
            const spoolDelayMs = Math.round(
                (timeline[HYPERDRIVE_PHASES.MAP_LOCK] + timeline[HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL] * 0.5) * 1000,
            );
            await this.waitForBaseline(spoolDelayMs + settleMs);
            this.captureBaseline(`${label}-warp-spool`);

            const transitDelayMs = Math.round(
                (timeline[HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL] * 0.45 + timeline[HYPERDRIVE_PHASES.FTL_TRANSIT] * 0.45) * 1000,
            );
            await this.waitForBaseline(transitDelayMs + Math.floor(settleMs * 0.5));
            this.captureBaseline(`${label}-warp-transit`);
        }

        const report = this.reportBaseline();
        if (downloadReport && report) {
            const filename = `${label}-${this.getBackendSlug()}-${Date.now()}.json`;
            this.downloadJson(filename, report);
        }

        console.log('[StellarVelocityBaseline] capturePack complete', {
            label,
            defaultLoops,
            stressLoops,
            captureWarpPhases,
            stepMs,
        });
        return report;
    }

    async captureReadabilityAnchors(options = {}) {
        const {
            label = 'stellar-velocity-readability',
            settleMs = 300,
            includeReport = true,
        } = options;

        if (!this.isActive) {
            console.warn('[StellarVelocityBaseline] captureReadability skipped: theme is not active.');
            return null;
        }

        this.clearBaselinePlaybackTimers();

        const anchors = [
            { id: 'piece-lock', event: EVENTS.PIECE_LOCK, payload: {} },
            { id: 'combo-3', event: EVENTS.COMBO, payload: { comboCount: 3 } },
            { id: 'combo-6', event: EVENTS.COMBO, payload: { comboCount: 6 } },
            { id: 'combo-8', event: EVENTS.COMBO, payload: { comboCount: 8 } },
            { id: 'combo-10', event: EVENTS.COMBO, payload: { comboCount: 10 } },
        ];

        for (const anchor of anchors) {
            eventBus.emit(anchor.event, { ...(anchor.payload || {}) });
            await this.waitForBaseline(settleMs);
            this.captureBaseline(`${label}-${anchor.id}`);
        }

        const report = includeReport ? this.reportBaseline() : null;
        console.log('[StellarVelocityBaseline] captureReadability complete', {
            label,
            anchors: anchors.map((anchor) => anchor.id),
        });
        return report;
    }

    async runPresetSwitchStress(options = {}) {
        if (typeof window === 'undefined') return null;
        if (!this.isActive) {
            console.warn('[StellarVelocityBaseline] presetSwitchStress skipped: theme is not active.');
            return null;
        }

        const {
            sequence = ['High', 'Medium', 'Low', 'High', 'Ultra', 'Minimal', 'High'],
            loops = 2,
            settleMs = 700,
            stepMs = 220,
            fullRebuild = false,
            runStressSequence = true,
        } = options;

        const normalizedSequence = (Array.isArray(sequence) ? sequence : ['High'])
            .map((tier) => normalizeQuality(tier))
            .filter((tier) => QUALITY_PRESETS[tier]);
        if (!normalizedSequence.length) {
            return { ok: false, reason: 'no-valid-quality-sequence' };
        }

        const originalQuality = window.settings?.graphicsQuality;
        if (!window.settings) {
            window.settings = {};
        }

        const samples = [];
        const startedAt = Date.now();
        const iterations = Math.max(1, Math.floor(loops));
        try {
            for (let loop = 0; loop < iterations; loop++) {
                for (const tier of normalizedSequence) {
                    window.settings.graphicsQuality = tier;

                    if (fullRebuild) {
                        await this.createScene();
                        if (!this.isActive) {
                            return { ok: false, reason: 'theme-inactive-during-rebuild', samples };
                        }
                    } else {
                        this.applyQualityPreset(tier);
                        this.performanceBudget = this.resolvePerformanceBudget(this.activeQualityLevel);
                        this.resetAdaptiveScalerState();
                        this.applyAdaptiveScalerState();
                        this.updatePostProcessing();
                    }

                    if (runStressSequence) {
                        this.playBaselineSequence('stress', { loops: 1, stepMs });
                    }
                    await this.waitForBaseline(settleMs);

                    samples.push({
                        loop,
                        tier,
                        backend: this.getBackendLabel(),
                        frameTimeEmaMs: Number((this.adaptiveScalerState?.frameTimeEmaMs ?? 0).toFixed(3)),
                        drawCallEma: Number((this.adaptiveScalerState?.drawCallEma ?? 0).toFixed(2)),
                        postCostEmaMs: Number((this.adaptiveScalerState?.postCostEmaMs ?? 0).toFixed(3)),
                        resolutionScale: Number((this.adaptiveScalerState?.resolutionScale ?? 1).toFixed(3)),
                        effectScale: Number((this.adaptiveScalerState?.effectScale ?? 1).toFixed(3)),
                        maxDrawCalls: this.performanceBudget?.maxDrawCalls ?? null,
                        maxPostCostMs: this.performanceBudget?.maxPostCostMs ?? null,
                        renderPath: this.lastRenderPath,
                    });
                }
            }
        } finally {
            window.settings.graphicsQuality = originalQuality;
            if (fullRebuild) {
                await this.createScene();
            }
        }

        const failures = samples.filter((sample) => {
            const drawFail = Number.isFinite(sample.maxDrawCalls) && sample.drawCallEma > sample.maxDrawCalls * 1.20;
            const postFail = Number.isFinite(sample.maxPostCostMs) && sample.postCostEmaMs > sample.maxPostCostMs * 1.35;
            return drawFail || postFail;
        });

        const summary = {
            ok: failures.length === 0,
            startedAt,
            completedAt: Date.now(),
            fullRebuild,
            iterations,
            sequence: normalizedSequence,
            samples,
            failures,
        };
        console.log('[StellarVelocityBaseline] presetSwitchStress', summary);
        return summary;
    }

    captureValidationSnapshot(label = 'snapshot') {
        const memoryInfo = this.renderer?.info?.memory || {};
        return {
            label,
            timestamp: Date.now(),
            backend: this.getBackendLabel(),
            renderPath: this.lastRenderPath,
            activeTimers: this.activeTimers.size,
            baselineTimers: this.baselineTimeouts.size,
            sceneChildren: this.scene?.children?.length ?? 0,
            textures: memoryInfo.textures ?? null,
            geometries: memoryInfo.geometries ?? null,
            burstCount: this.burstParticles.length,
            shockwaveCount: this.shockwaveRings.length,
            energyArcCount: this.energyDischargeArcs.length,
            cometCount: this.cometStreaks.length,
            microDebrisCount: this.asteroidMicroDebris?.count ?? 0,
            capabilities: { ...this.capabilities },
            flags: { ...this.flags },
        };
    }

    getValidationMatrixRows() {
        return [
            {
                id: 'default',
                label: 'Default Runtime',
                flags: {},
                requiresReload: false,
            },
            {
                id: 'no-post',
                label: 'No Post Runtime',
                flags: { noPost: true },
                requiresReload: false,
            },
            {
                id: 'no-mrt',
                label: 'No MRT Runtime',
                flags: { noMRT: true },
                requiresReload: false,
            },
            {
                id: 'no-compute',
                label: 'No Compute Runtime',
                flags: { noCompute: true },
                requiresReload: false,
            },
            {
                id: 'no-enhancements',
                label: 'No Enhancements Runtime',
                flags: { noEnhancements: true },
                requiresReload: false,
            },
            {
                id: 'force-webgl',
                label: 'Force WebGL Runtime',
                flags: { forceWebGL: true },
                requiresReload: true,
                query: '?stellarVelBaseline=1&stellarVelSeed=1234&stellarVelFixedDt=16.666&forceWebGL=1',
            },
        ];
    }

    applyValidationFlags(baseFlags, overrides = {}) {
        this.flags = {
            ...baseFlags,
            forceWebGL: baseFlags.forceWebGL === true,
            noPost: overrides.noPost === true,
            noMRT: overrides.noMRT === true,
            noCompute: overrides.noCompute === true,
            noEnhancements: overrides.noEnhancements === true,
            noDrs: overrides.noDrs === true ? true : baseFlags.noDrs === true,
        };
    }

    async runValidationMatrix(options = {}) {
        if (!this.isActive) {
            console.warn('[StellarVelocityBaseline] validationMatrix skipped: theme is not active.');
            return null;
        }

        const rows = Array.isArray(options.rows) && options.rows.length
            ? options.rows
            : this.getValidationMatrixRows();
        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0
            ? Math.floor(options.settleMs)
            : 460;
        const emitEvents = options.emitEvents !== false;
        const baseFlags = { ...this.flags };
        const startedAt = Date.now();
        const results = [];
        const pendingReload = [];

        try {
            for (const row of rows) {
                if (row.requiresReload) {
                    pendingReload.push(row);
                    continue;
                }

                this.clearBaselinePlaybackTimers();
                this.applyValidationFlags(baseFlags, row.flags || {});
                this.probeCapabilities();
                this.configureRendererColorPipeline();
                this.setupPostProcessing();
                this.applyAdaptiveScalerState();
                if (this.capabilities.mrt) {
                    this.ensureMrtMaterials({ log: this.flags.mrtAudit });
                } else if (this.flags.mrtAudit) {
                    this.runMaterialAudit({ log: true });
                }

                if (emitEvents) {
                    eventBus.emit(EVENTS.PIECE_LOCK, {});
                    eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
                    eventBus.emit(EVENTS.COMBO, { comboCount: 4 });
                }
                await this.waitForBaseline(settleMs);

                const snapshot = this.captureValidationSnapshot(row.id);
                const ok = Boolean(
                    this.renderer
                    && this.scene
                    && this.camera
                    && this.lastRenderPath !== 'none',
                );
                results.push({
                    id: row.id,
                    label: row.label || row.id,
                    ok,
                    renderPath: this.lastRenderPath,
                    backend: this.getBackendLabel(),
                    capabilities: { ...this.capabilities },
                    flags: { ...this.flags },
                    snapshot,
                });
            }
        } finally {
            this.flags = { ...baseFlags };
            this.probeCapabilities();
            this.configureRendererColorPipeline();
            this.setupPostProcessing();
            this.applyAdaptiveScalerState();
            this.clearBaselinePlaybackTimers();
        }

        const failed = results.filter((result) => !result.ok);
        const summary = {
            ok: failed.length === 0,
            startedAt,
            completedAt: Date.now(),
            resultCount: results.length,
            failedCount: failed.length,
            results,
            pendingReload,
        };
        console.log('[StellarVelocityBaseline] validationMatrix', summary);
        return summary;
    }

    async runSoakValidation(options = {}) {
        if (!this.isActive) {
            console.warn('[StellarVelocityBaseline] soakValidation skipped: theme is not active.');
            return null;
        }

        const cycles = Number.isFinite(options.cycles) ? Math.max(1, Math.floor(options.cycles)) : 180;
        const stepMs = Number.isFinite(options.stepMs) ? Math.max(80, Math.floor(options.stepMs)) : 220;
        const snapshotEvery = Number.isFinite(options.snapshotEvery)
            ? Math.max(1, Math.floor(options.snapshotEvery))
            : 24;
        const presetSequence = Array.isArray(options.presetSequence) && options.presetSequence.length
            ? options.presetSequence.map((tier) => normalizeQuality(tier)).filter((tier) => QUALITY_PRESETS[tier])
            : ['High', 'Medium', 'Ultra', 'Low', 'High'];
        const fullRebuild = options.fullRebuild === true;
        const originalQuality = this.activeQualityLevel;
        const originalSettingsQuality = typeof window !== 'undefined' ? window.settings?.graphicsQuality : null;
        const originalFlags = { ...this.flags };
        const snapshots = [this.captureValidationSnapshot('start')];
        let qualityCursor = 0;
        const startedAt = Date.now();

        try {
            for (let cycle = 0; cycle < cycles; cycle++) {
                if (!this.isActive) break;
                eventBus.emit(EVENTS.PIECE_LOCK, {});
                if (cycle % 2 === 0) {
                    eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: (cycle % 4) + 1 });
                }
                if (cycle % 3 === 0) {
                    eventBus.emit(EVENTS.COMBO, { comboCount: 4 + (cycle % 7) });
                }

                if (cycle > 0 && cycle % 18 === 0 && presetSequence.length > 0) {
                    const nextQuality = presetSequence[qualityCursor % presetSequence.length];
                    qualityCursor += 1;
                    if (fullRebuild) {
                        if (typeof window !== 'undefined') {
                            if (!window.settings) window.settings = {};
                            window.settings.graphicsQuality = nextQuality;
                        }
                        await this.createScene();
                    } else {
                        this.applyQualityPreset(nextQuality);
                        this.performanceBudget = this.resolvePerformanceBudget(this.activeQualityLevel);
                        this.resetAdaptiveScalerState();
                        this.probeCapabilities();
                        this.configureRendererColorPipeline();
                        this.setupPostProcessing();
                        this.applyAdaptiveScalerState();
                    }
                }

                await this.waitForBaseline(stepMs);
                if ((cycle + 1) % snapshotEvery === 0 || cycle === cycles - 1) {
                    snapshots.push(this.captureValidationSnapshot(`cycle-${cycle + 1}`));
                }
            }
        } finally {
            this.flags = { ...originalFlags };
            if (typeof window !== 'undefined') {
                if (!window.settings) window.settings = {};
                window.settings.graphicsQuality = originalSettingsQuality || originalQuality;
            }
            if (fullRebuild) {
                await this.createScene();
            } else {
                this.applyQualityPreset(originalQuality);
                this.performanceBudget = this.resolvePerformanceBudget(this.activeQualityLevel);
                this.resetAdaptiveScalerState();
                this.probeCapabilities();
                this.configureRendererColorPipeline();
                this.setupPostProcessing();
                this.applyAdaptiveScalerState();
            }
            this.clearBaselinePlaybackTimers();
        }

        const first = snapshots[0] || {};
        const last = snapshots[snapshots.length - 1] || {};
        const leakSummary = {
            textureDelta: (last.textures ?? 0) - (first.textures ?? 0),
            geometryDelta: (last.geometries ?? 0) - (first.geometries ?? 0),
            timerDelta: (last.activeTimers ?? 0) - (first.activeTimers ?? 0),
        };
        const summary = {
            ok: leakSummary.textureDelta <= 2
                && leakSummary.geometryDelta <= 4
                && leakSummary.timerDelta <= 0,
            startedAt,
            completedAt: Date.now(),
            cycles,
            stepMs,
            fullRebuild,
            snapshots,
            leakSummary,
        };
        console.log('[StellarVelocityBaseline] soakValidation', summary);
        return summary;
    }

    exposeBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.stellarVelocityBaseline = {
            capture: (label) => this.captureBaseline(label),
            report: () => this.reportBaseline(),
            downloadReport: (label) => this.downloadBaselineReport(label),
            reset: () => this.resetBaseline(),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            capturePack: (options = {}) => this.captureBaselinePack(options),
            captureReadability: (options = {}) => this.captureReadabilityAnchors(options),
            presetSwitchStress: (options = {}) => this.runPresetSwitchStress(options),
            validationMatrix: (options = {}) => this.runValidationMatrix(options),
            soakValidation: (options = {}) => this.runSoakValidation(options),
            validationRows: () => this.getValidationMatrixRows(),
            validationSnapshot: (label = 'snapshot') => this.captureValidationSnapshot(label),
            stop: () => this.clearBaselinePlaybackTimers(),
            getHeroFrames: () => [
                'hero-idle',
                'hero-default',
                'hero-stress',
                'hero-readability-piece-lock',
                'hero-readability-combo-10',
                'hero-warp-spool',
                'hero-warp-transit',
            ],
        };
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.stellarVelocityBaseline) {
            delete window.stellarVelocityBaseline;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[StellarVelocity] Creating Three.js warp drive scene...');

        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearThemeTimeouts();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });
        this.refreshRuntimeFlags();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        this.fixedElapsed = 0;
        this.time = 0;
        this.idleSeconds = 0;
        this.nextCometAt = 8 + this.rand() * 10;
        this.starWarpBoost = 0;
        this.stopHyperdriveSequence();
        this.hyperdriveSequence.timeline = this.createHyperdriveTimeline(0);
        this.hyperdriveSequence.lastTriggerAt = -Infinity;
        this.resetBaseline();
        this.clock.stop();
        this.clock = new THREE.Clock();
        const scheme = this.colorSchemes[this.currentColorScheme];
        this.activePalette.primary.copy(scheme.primary);
        this.activePalette.secondary.copy(scheme.secondary);
        this.activePalette.bg.set(scheme.bg);
        this.colorTransition.active = false;
        this.colorTransition.elapsed = 0;
        this.colorTransition.fromPrimary.copy(this.activePalette.primary);
        this.colorTransition.fromSecondary.copy(this.activePalette.secondary);
        this.colorTransition.fromBg.copy(this.activePalette.bg);
        this.colorTransition.toPrimary.copy(this.activePalette.primary);
        this.colorTransition.toSecondary.copy(this.activePalette.secondary);
        this.colorTransition.toBg.copy(this.activePalette.bg);

        const container = document.getElementById('stellar-velocity-theme');
        if (!container) {
            console.error('[StellarVelocity] Container not found');
            return;
        }

        const rendererReady = await this.initRenderer(container);
        if (!rendererReady || !this.renderer || !this.scene || !this.camera) {
            console.error('[StellarVelocity] Renderer initialization failed.');
            return;
        }
        this.probeCapabilities();
        this.configureGpuTiming();
        this.performanceBudget = this.resolvePerformanceBudget(this.activeQualityLevel);
        this.qualityPreset.starCount = Math.min(
            this.qualityPreset.starCount,
            this.qualityBudget.maxStars,
            this.performanceBudget.maxStars,
        );
        this.qualityPreset.asteroidCount = Math.min(
            this.qualityPreset.asteroidCount,
            this.qualityBudget.maxAsteroids,
            this.performanceBudget.maxAsteroids,
        );
        this.resetAdaptiveScalerState();
        this.configureRendererColorPipeline();
        this.setupRendererResilience();
        this.createStarfield();
        this.createWarpStreakLines();
        this.createTunnelLattice();
        this.createNebulaBackdrop();
        this.createWarpCore();
        this.createAsteroidField();
        this.createAsteroidMicroDebris();
        this.applyActivePalette();
        if (this.capabilities.mrt) {
            this.ensureMrtMaterials();
        } else if (this.flags.mrtAudit) {
            this.runMaterialAudit({ log: true });
        }
        this.setupPostProcessing();
        this.applyAdaptiveScalerState();
        this.resize(window.innerWidth, window.innerHeight);
        const compileTimeoutMs = this.performanceBudget?.compileTimeoutMs ?? 3000;
        await this.precompileSceneWithTimeout(compileTimeoutMs);
        this.setupEventListeners();
        this.startAnimation();
        this.startColorCycle();
        this.exposeBaselineHelpers();

        if (this.flags.baseline) {
            console.log('[StellarVelocityBaseline] Baseline mode enabled', {
                seed: this.flags.seed,
                fixedDeltaMs: this.flags.fixedDeltaMs,
                playback: this.flags.playback,
                playbackLoops: this.flags.playbackLoops,
            });
        }
        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, {
                loops: this.flags.playbackLoops,
            });
        }

        console.log('[StellarVelocity] Scene created successfully');
    }

    async initRenderer(container) {
        if (!container || typeof window === 'undefined') return false;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const preserveDrawingBuffer = this.flags.baseline === true;
        let renderer = null;

        if (!this.shouldForceWebGL()) {
            let webgpuRenderer = null;
            try {
                webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    preserveDrawingBuffer,
                });
                await webgpuRenderer.init();
                if (webgpuRenderer.backend?.isWebGPUBackend === true) {
                    renderer = webgpuRenderer;
                } else {
                    webgpuRenderer.dispose();
                }
            } catch (error) {
                console.warn('[StellarVelocity] WebGPU init failed, falling back to WebGL2:', error);
                webgpuRenderer?.dispose?.();
            }
        }

        if (!renderer) {
            try {
                renderer = new THREE.WebGLRenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    preserveDrawingBuffer,
                });
            } catch (error) {
                console.error('[StellarVelocity] WebGL renderer initialization failed:', error);
                return false;
            }
        }

        this.renderer = renderer;
        this.rendererResilienceToken += 1;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = renderer.isWebGLRenderer === true
            || renderer.backend?.isWebGLBackend === true
            || !this.isWebGPU;

        this.renderer.setClearColor(this.activePalette.bg, 1);
        this.renderer.setPixelRatio(this.getRendererPixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = true;

        const staleCanvas = container.querySelector('#stellar-velocity-renderer');
        if (staleCanvas && staleCanvas.parentNode === container) {
            container.removeChild(staleCanvas);
        }
        this.renderer.domElement.id = 'stellar-velocity-renderer';
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Camera positioned behind the warp tunnel looking forward
        this.camera = new THREE.PerspectiveCamera(this.baseFOV, width / height, 0.1, 100000);
        this.camera.position.set(0, 0, 1000);
        this.camera.lookAt(0, 0, 0);

        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404060, 0.3);
        this.scene.add(ambientLight);

        // Point light at warp core
        this.coreLight = new THREE.PointLight(0xffffff, 1.0, 2000);
        this.coreLight.position.set(0, 0, 0);
        this.scene.add(this.coreLight);

        console.log('[StellarVelocity] Renderer and camera initialized', {
            backend: this.getBackendLabel(),
        });
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield with Warp Trails (GPU Shader)
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const velocities = new Float32Array(starCount); // Z velocity factor
        const twinkleData = new Float32Array(starCount * 2);

        const colorScheme = {
            primary: this.activePalette.primary,
            secondary: this.activePalette.secondary,
        };

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const band = this.getStarDepthBandSample(this.baseTunnelRadius);
            const isNearBand = band.band === 'near';
            const isMidBand = band.band === 'mid';

            // Cylindrical depth-band distribution around the tunnel.
            const angle = this.rand() * Math.PI * 2;
            const radius = band.radius;
            const z = band.z;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.sin(angle) * radius;
            positions[i3 + 2] = z;

            // Color with slight variation
            const colorLerp = this.rand();
            const starColor = colorScheme.primary.clone().lerp(colorScheme.secondary, colorLerp);
            const brightness = isNearBand ? 1.15 : isMidBand ? 0.92 : 0.74;
            colors[i3] = starColor.r * brightness;
            colors[i3 + 1] = starColor.g * brightness;
            colors[i3 + 2] = starColor.b * brightness;

            // Size
            sizes[i] = isNearBand
                ? 28 + this.rand() * 46
                : isMidBand
                    ? 18 + this.rand() * 28
                    : 10 + this.rand() * 16;

            // Near band moves faster for strong parallax cues.
            velocities[i] = isNearBand
                ? 0.95 + this.rand() * 0.35
                : isMidBand
                    ? 0.65 + this.rand() * 0.28
                    : 0.35 + this.rand() * 0.22;

            // Twinkle
            twinkleData[i2] = this.rand() * Math.PI * 2;
            twinkleData[i2 + 1] = isNearBand
                ? 1.8 + this.rand() * 1.6
                : isMidBand
                    ? 1.2 + this.rand() * 1.5
                    : 0.7 + this.rand() * 1.2;
        }

        this.starfieldCompute?.dispose?.();
        this.starfieldCompute = null;
        const canUseStarCompute = this.isWebGPU
            && this.capabilities.compute
            && this.flags.useCompute
            && this.qualityBudget.computeEnabled === true;
        if (canUseStarCompute) {
            try {
                this.starfieldCompute = new StellarVelocityStarfieldCompute(starCount, {
                    random: () => this.rand(),
                    minRadius: 100,
                    tunnelRadius: this.tunnelRadius,
                    resetZ: 1000,
                    spawnZ: -8000,
                    nearBandCutoff: STAR_DEPTH_BANDS.nearCutoff,
                    midBandCutoff: STAR_DEPTH_BANDS.midCutoff,
                    nearRadiusMin: STAR_DEPTH_BANDS.near.radiusMin,
                    midRadiusMin: STAR_DEPTH_BANDS.mid.radiusMin,
                    farRadiusMin: STAR_DEPTH_BANDS.far.radiusMin,
                    nearRadiusScale: STAR_DEPTH_BANDS.near.radiusScale,
                    midRadiusScale: STAR_DEPTH_BANDS.mid.radiusScale,
                    farRadiusScale: STAR_DEPTH_BANDS.far.radiusScale,
                    nearZMin: STAR_DEPTH_BANDS.near.zMin,
                    midZMin: STAR_DEPTH_BANDS.mid.zMin,
                    farZMin: STAR_DEPTH_BANDS.far.zMin,
                    nearZSpan: STAR_DEPTH_BANDS.near.zSpan,
                    midZSpan: STAR_DEPTH_BANDS.mid.zSpan,
                    farZSpan: STAR_DEPTH_BANDS.far.zSpan,
                });
                this.starfieldCompute.setInitialState(positions, velocities, twinkleData);
                this.starfieldCompute.createComputeNode();
            } catch (error) {
                console.warn('[StellarVelocity] Starfield compute setup failed, using CPU fallback:', error);
                this.starfieldCompute?.dispose?.();
                this.starfieldCompute = null;
            }
        }

        let geometry = null;
        if (this.isWebGPU) {
            const quadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            geometry = new THREE.InstancedBufferGeometry();
            geometry.setIndex(quadGeometry.getIndex().clone());
            geometry.setAttribute('position', quadGeometry.getAttribute('position').clone());
            geometry.setAttribute('normal', quadGeometry.getAttribute('normal').clone());
            geometry.setAttribute('uv', quadGeometry.getAttribute('uv').clone());
            quadGeometry.dispose();

            const offsetAttribute = new THREE.InstancedBufferAttribute(positions, 3);
            offsetAttribute.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('aOffset', offsetAttribute);
            geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));
            geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
            geometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(velocities, 1));
            geometry.setAttribute('aTwinkle', new THREE.InstancedBufferAttribute(twinkleData, 2));
            geometry.instanceCount = starCount;
        } else {
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 1));
            geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        }

        const {
            material,
        } = createStellarVelocityStarfieldMaterial({
            isWebGPU: this.isWebGPU,
            pixelRatio: this.renderer.getPixelRatio(),
            starTexture: this.isWebGPU ? null : this.getStarTexture(),
            starCompute: this.starfieldCompute,
            tunnelTint: this.getTunnelTintColor(),
        });

        this.starfield = this.isWebGPU
            ? new THREE.Mesh(geometry, material)
            : new THREE.Points(geometry, material);
        this.starfield.name = 'stellar-velocity-starfield';
        this.starfield.frustumCulled = false;
        this.starfield.userData.instancedBillboards = this.isWebGPU;
        this.starfield.userData.cameraFacing = this.isWebGPU;
        this.starfield.userData.starCount = starCount;
        this.starfield.userData.computeBacked = Boolean(this.starfieldCompute?.computeNode);
        this.scene.add(this.starfield);
        console.log(
            `[StellarVelocity] Starfield created with ${starCount} stars`
            + (this.starfieldCompute?.computeNode ? ' (compute)' : ' (cpu)'),
        );
    }

    randomizeWarpStreakLine(state, index, initial = false) {
        const count = Math.max(1, state?.count || 1);
        if (!state || index < 0 || index >= count) return;
        state.angles[index] = this.rand() * Math.PI * 2;
        state.radii[index] = 20 + this.rand() * 170;
        state.lengths[index] = 90 + this.rand() * 320;
        state.speeds[index] = 0.45 + this.rand() * 1.55;
        state.drifts[index] = 0.18 + this.rand() * 1.35;
        state.z[index] = initial
            ? -7800 + this.rand() * 9000
            : -9200 - this.rand() * 2000;
    }

    createWarpStreakLines() {
        if (!this.scene) return;

        if (this.warpStreakLines) {
            this.scene.remove(this.warpStreakLines);
            this.warpStreakLines.geometry?.dispose?.();
            this.warpStreakLines.material?.dispose?.();
            this.warpStreakLines = null;
            this.warpStreakState = null;
        }

        const count = Math.max(120, Math.min(1400, Math.floor(this.qualityPreset.starCount * 0.22)));
        const positions = new Float32Array(count * 6);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);

        const material = new THREE.LineBasicMaterial({
            color: this.activePalette.secondary.clone(),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.warpStreakState = {
            count,
            positions,
            angles: new Float32Array(count),
            radii: new Float32Array(count),
            lengths: new Float32Array(count),
            speeds: new Float32Array(count),
            drifts: new Float32Array(count),
            z: new Float32Array(count),
        };

        for (let i = 0; i < count; i++) {
            this.randomizeWarpStreakLine(this.warpStreakState, i, true);
        }

        this.warpStreakLines = new THREE.LineSegments(geometry, material);
        this.warpStreakLines.name = 'stellar-velocity-warp-streak-lines';
        this.warpStreakLines.frustumCulled = false;
        this.warpStreakLines.visible = false;
        this.scene.add(this.warpStreakLines);
    }

    updateWarpStreakLines(delta) {
        if (!this.warpStreakLines?.geometry || !this.warpStreakState) return;
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const warpRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(this.maxSpeed, 0.0001), 0, 1);
        const accelerationBoost = THREE.MathUtils.clamp(
            (this.targetSpeed - this.currentSpeed) / Math.max(this.maxSpeed, 0.0001),
            0,
            1,
        );
        const visibility = this.isEnhancementsEnabled()
            ? THREE.MathUtils.clamp(
                (warpRatio - 0.08) * 1.12
                + accelerationBoost * 1.45
                + (choreography.starStretchBoost || 0) * 0.72
                + (choreography.warpRatioBoost || 0) * 0.32,
                0,
                1,
            )
            : 0;
        const material = this.warpStreakLines.material;
        const opacity = THREE.MathUtils.clamp(visibility * 0.42, 0, 0.45);
        material.opacity = opacity;
        this.warpStreakLines.visible = opacity > 0.002;
        if (!this.warpStreakLines.visible) {
            return;
        }

        this.tunnelTintScratch
            .copy(this.activePalette.secondary)
            .lerp(this.activePalette.primary, 0.30 + visibility * 0.28);
        material.color.copy(this.tunnelTintScratch);

        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        const state = this.warpStreakState;
        const positions = state.positions;
        const velocityMul = 36 + this.currentSpeed * 48;

        for (let i = 0; i < state.count; i++) {
            state.z[i] += dt * velocityMul * state.speeds[i];
            if (state.z[i] > 1200) {
                this.randomizeWarpStreakLine(state, i, false);
            }

            const angle = state.angles[i] + this.time * 0.025 * state.speeds[i];
            const radiusWave = Math.sin(this.time * state.drifts[i] + state.angles[i]) * 11;
            const radial = Math.max(8, state.radii[i] * (0.38 + visibility * 0.68) + radiusWave);
            const innerRadius = radial * 0.15;
            const outerRadius = innerRadius + state.lengths[i] * (
                0.34
                + visibility * 1.85
                + (choreography.starStretchBoost || 0) * 0.52
            );
            const xInner = Math.cos(angle) * innerRadius;
            const yInner = Math.sin(angle) * innerRadius;
            const xOuter = Math.cos(angle) * outerRadius;
            const yOuter = Math.sin(angle) * outerRadius;
            const z = state.z[i];
            const streakDepth = state.lengths[i] * (0.08 + visibility * 0.26);

            const base = i * 6;
            positions[base] = xInner;
            positions[base + 1] = yInner;
            positions[base + 2] = z - streakDepth * 0.45;
            positions[base + 3] = xOuter;
            positions[base + 4] = yOuter;
            positions[base + 5] = z + streakDepth;
        }

        this.warpStreakLines.geometry.getAttribute('position').needsUpdate = true;
    }

    createTunnelLattice() {
        if (!this.scene) return;
        if (this.tunnelLattice) {
            this.scene.remove(this.tunnelLattice);
            this.tunnelLattice.geometry?.dispose?.();
            this.tunnelLattice.material?.dispose?.();
            this.tunnelLattice = null;
        }

        const geometry = new THREE.CylinderGeometry(1, 1, 14000, 56, 18, true);
        const material = new THREE.MeshBasicMaterial({
            color: this.activePalette.secondary.clone(),
            wireframe: true,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide,
        });
        const lattice = new THREE.Mesh(geometry, material);
        lattice.name = 'stellar-velocity-tunnel-lattice';
        lattice.position.set(0, 0, -5400);
        lattice.rotation.x = Math.PI / 2;
        lattice.scale.set(this.baseTunnelRadius * 1.04, this.baseTunnelRadius * 1.04, 1);
        lattice.visible = false;
        lattice.frustumCulled = false;
        lattice.userData.baseOpacity = 0.12;
        this.scene.add(lattice);
        this.tunnelLattice = lattice;
    }

    updateTunnelLattice(delta) {
        if (!this.tunnelLattice?.material) return;
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const warpRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(this.maxSpeed, 0.0001), 0, 1);
        const visibility = this.isEnhancementsEnabled()
            ? THREE.MathUtils.clamp(
                (warpRatio - 0.18) * 1.55
                + (choreography.tunnelCompression || 0) * 0.95
                + (choreography.warpRatioBoost || 0) * 0.45,
                0,
                1,
            )
            : 0;
        const material = this.tunnelLattice.material;
        const opacity = THREE.MathUtils.clamp(
            (this.tunnelLattice.userData.baseOpacity || 0.12)
            * visibility
            * (0.62 + (choreography.lensHaloBoost || 0) * 0.35),
            0,
            0.18,
        );
        material.opacity = opacity;
        this.tunnelLattice.visible = opacity > 0.002;
        if (!this.tunnelLattice.visible) {
            return;
        }

        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        this.tunnelLattice.rotation.z += dt * (0.02 + warpRatio * 0.10 + (choreography.warpRatioBoost || 0) * 0.05);
        this.tunnelLattice.position.z = -5400 + Math.sin(this.time * 0.12) * 110;
        const latticeRadius = Math.max(220, this.tunnelRadius * (1.02 + visibility * 0.10));
        this.tunnelLattice.scale.set(latticeRadius, latticeRadius, 1);
        this.tunnelTintScratch
            .copy(this.activePalette.secondary)
            .lerp(this.activePalette.primary, 0.18 + visibility * 0.22);
        material.color.copy(this.tunnelTintScratch);
    }

    getStarTexture() {
        if (this._starTexture) return this._starTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const center = 64;

        ctx.clearRect(0, 0, 128, 128);

        // Outer glow
        const outerGlow = ctx.createRadialGradient(center, center, 0, center, center, 64);
        outerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        outerGlow.addColorStop(0.2, 'rgba(255, 255, 255, 0.15)');
        outerGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
        outerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = outerGlow;
        ctx.fillRect(0, 0, 128, 128);

        // Bright core
        const coreGlow = ctx.createRadialGradient(center, center, 0, center, center, 20);
        coreGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
        coreGlow.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        coreGlow.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)');
        coreGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = coreGlow;
        ctx.fillRect(0, 0, 128, 128);

        this._starTexture = new THREE.CanvasTexture(canvas);
        return this._starTexture;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Backdrop (Procedural Shader)
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaBackdrop() {
        const { nebulaCount } = this.qualityPreset;
        const nebulaColors = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0x0066ff), // Blue
            new THREE.Color(0x6600ff), // Purple
            new THREE.Color(0xff0066), // Magenta
            new THREE.Color(0xff6600), // Orange
            new THREE.Color(0x00ff66), // Green
            new THREE.Color(0xff0044), // Crimson
            new THREE.Color(0xffcc00), // Gold
            new THREE.Color(0x8800ff), // Violet
        ];

        for (let i = 0; i < nebulaCount; i++) {
            const size = 60000 + this.rand() * 40000;
            const color = nebulaColors[i % nebulaColors.length];
            const opacity = 0.25 + this.rand() * 0.15;
            const seed = this.rand() * 100;
            const flowAngle = this.rand() * Math.PI * 2;
            const flowDir = new THREE.Vector2(Math.cos(flowAngle), Math.sin(flowAngle));
            const flowOffset = new THREE.Vector2(this.rand() * 12.0, this.rand() * 12.0);
            const flowSpeed = 0.028 + this.rand() * 0.055;
            const warpAmount = 0.16 + this.rand() * 0.22;
            const detailScale = 2.1 + this.rand() * 2.0;
            const morphRate = 0.24 + this.rand() * 0.28;

            const geometry = new THREE.PlaneGeometry(size, size * 0.6);
            const {
                material,
            } = createStellarVelocityNebulaMaterial({
                isWebGPU: this.isWebGPU,
                color,
                opacity,
                seed,
                flowDir,
                flowOffset,
                flowSpeed,
                warpAmount,
                detailScale,
                morphRate,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `stellar-velocity-nebula-${i}`;

            // Position nebulas in a ring around the tunnel
            const angle = (i / nebulaCount) * Math.PI * 2 + this.rand() * 0.5;
            const distance = 20000 + this.rand() * 15000;
            mesh.position.x = Math.cos(angle) * distance;
            mesh.position.y = Math.sin(angle) * distance * 0.3 + (this.rand() - 0.5) * 5000;
            mesh.position.z = -30000 - this.rand() * 20000;

            mesh.rotation.z = this.rand() * Math.PI;
            mesh.userData.driftSpeed = 0.5 + this.rand() * 0.5;
            mesh.userData.driftPhase = this.rand() * Math.PI * 2;
            mesh.userData.baseY = mesh.position.y;
            mesh.userData.baseOpacity = opacity;
            mesh.userData.baseRotation = mesh.rotation.z;
            mesh.userData.rotationDriftSpeed = 0.016 + this.rand() * 0.03;
            mesh.userData.rotationDriftAmplitude = 0.06 + this.rand() * 0.07;
            mesh.userData.scalePhase = this.rand() * Math.PI * 2;
            mesh.userData.scaleOscillation = 0.05 + this.rand() * 0.05;
            mesh.userData.baseScaleX = 1.0;
            mesh.userData.baseScaleY = 1.0;
            mesh.userData.flowDir = flowDir;
            mesh.userData.flowOffset = flowOffset;
            mesh.userData.flowSpeed = flowSpeed;
            mesh.userData.warpAmount = warpAmount;
            mesh.userData.detailScale = detailScale;
            mesh.userData.morphRate = morphRate;
            mesh.userData.flowDrift = 0.18 + this.rand() * 0.35;
            mesh.userData.flowPulse = 0.12 + this.rand() * 0.18;

            this.nebulaMeshes.push(mesh);
            this.scene.add(mesh);
        }

        this.createDistantGalaxyClusters();
        this.createDustLanes();
        console.log(`[StellarVelocity] ${nebulaCount} procedural nebulas created`);
    }

    createDistantGalaxyClusters() {
        this.galaxyClusters = [];
        if (!this.scene) return;

        const clusterCount = this.activeQualityLevel === 'Extreme'
            ? 8
            : this.activeQualityLevel === 'Ultra'
                ? 7
                : this.activeQualityLevel === 'High'
                    ? 6
                    : this.activeQualityLevel === 'Medium'
                        ? 4
                        : this.activeQualityLevel === 'Low'
                            ? 3
                            : 2;

        for (let i = 0; i < clusterCount; i++) {
            const clusterColor = this.activePalette.secondary
                .clone()
                .lerp(this.activePalette.primary, 0.35 + this.rand() * 0.45);
            const {
                material,
            } = createStellarVelocityCoreGlowMaterial({
                isWebGPU: this.isWebGPU,
                color: clusterColor,
                opacity: 0.06 + this.rand() * 0.08,
            });
            const cluster = this.isWebGPU
                ? new THREE.Sprite(material)
                : new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
            cluster.name = `stellar-velocity-galaxy-cluster-${i}`;
            cluster.position.set(
                (this.rand() - 0.5) * 38000,
                (this.rand() - 0.5) * 18000,
                -45000 - this.rand() * 70000,
            );
            const size = 3400 + this.rand() * 7800;
            cluster.scale.set(size, size, 1);
            cluster.userData.baseOpacity = 0.06 + this.rand() * 0.08;
            cluster.userData.phase = this.rand() * Math.PI * 2;
            cluster.userData.driftSpeed = 0.02 + this.rand() * 0.05;
            cluster.userData.pulseSpeed = 0.08 + this.rand() * 0.12;
            cluster.userData.colorMix = 0.25 + this.rand() * 0.55;
            cluster.frustumCulled = false;
            this.galaxyClusters.push(cluster);
            this.scene.add(cluster);
        }
    }

    updateGalaxyClusters(delta) {
        if (!this.galaxyClusters.length) return;
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const warpRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(this.maxSpeed, 0.0001), 0, 1);
        this.galaxyClusters.forEach((cluster, index) => {
            const phase = cluster.userData.phase || 0;
            const pulse = Math.sin(this.time * (cluster.userData.pulseSpeed || 0.1) + phase) * 0.5 + 0.5;
            const opacity = THREE.MathUtils.clamp(
                (cluster.userData.baseOpacity || 0.08)
                * (0.72 + pulse * 0.38 + this.reactiveEnvelope.nebula * 0.22 + (choreography.lensHaloBoost || 0) * 0.20),
                0.01,
                0.24,
            );
            this.setMaterialOpacity(cluster.material, 'uOpacity', opacity);
            this.tunnelTintScratch
                .copy(this.activePalette.secondary)
                .lerp(this.activePalette.primary, cluster.userData.colorMix || 0.5);
            this.setMaterialColor(cluster.material, 'uColor', this.tunnelTintScratch);
            cluster.position.z += dt * (8 + warpRatio * 22) * (cluster.userData.driftSpeed || 0.04);
            if (cluster.position.z > -14000) {
                cluster.position.z = -70000 - this.rand() * 50000;
                cluster.position.x = (this.rand() - 0.5) * 38000;
                cluster.position.y = (this.rand() - 0.5) * 18000;
            }
            if (cluster.isSprite && this.camera) {
                cluster.quaternion.copy(this.camera.quaternion);
            }
            if (!cluster.isSprite) {
                cluster.rotation.z += dt * (0.002 + index * 0.0007);
            }
        });
    }

    createDustLanes() {
        this.dustLaneMeshes = [];
        if (!this.scene) return;

        const laneCount = this.activeQualityLevel === 'Extreme'
            ? 5
            : this.activeQualityLevel === 'Ultra'
                ? 4
                : this.activeQualityLevel === 'High'
                    ? 4
                    : this.activeQualityLevel === 'Medium'
                        ? 3
                        : 2;

        for (let i = 0; i < laneCount; i++) {
            const size = 32000 + this.rand() * 22000;
            const geometry = new THREE.PlaneGeometry(size, size * (0.32 + this.rand() * 0.22));
            const {
                material,
            } = createStellarVelocityNebulaMaterial({
                isWebGPU: this.isWebGPU,
                color: this.activePalette.bg.clone().multiplyScalar(0.32),
                opacity: 0.09 + this.rand() * 0.06,
                seed: this.rand() * 100,
                flowDir: new THREE.Vector2((this.rand() - 0.5) * 0.8, (this.rand() - 0.5) * 0.8),
                flowOffset: new THREE.Vector2(this.rand() * 12, this.rand() * 12),
                flowSpeed: 0.010 + this.rand() * 0.018,
                warpAmount: 0.28 + this.rand() * 0.16,
                detailScale: 2.8 + this.rand() * 1.8,
                morphRate: 0.12 + this.rand() * 0.15,
            });
            material.blending = THREE.NormalBlending;

            const lane = new THREE.Mesh(geometry, material);
            lane.name = `stellar-velocity-dust-lane-${i}`;
            lane.position.set(
                (this.rand() - 0.5) * 22000,
                (this.rand() - 0.5) * 7000,
                -24000 - this.rand() * 26000,
            );
            lane.rotation.z = this.rand() * Math.PI;
            lane.userData.baseOpacity = 0.09 + this.rand() * 0.06;
            lane.userData.baseY = lane.position.y;
            lane.userData.phase = this.rand() * Math.PI * 2;
            lane.userData.driftSpeed = 0.05 + this.rand() * 0.09;
            lane.userData.depthDrift = 0.9 + this.rand() * 0.8;
            lane.userData.baseScaleX = 1.0;
            lane.userData.baseScaleY = 1.0;
            lane.frustumCulled = false;
            this.dustLaneMeshes.push(lane);
            this.scene.add(lane);
        }
    }

    updateDustLanes(delta) {
        if (!this.dustLaneMeshes.length) return;
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const warpRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(this.maxSpeed, 0.0001), 0, 1);
        this.dustLaneMeshes.forEach((lane) => {
            const phase = lane.userData.phase || 0;
            const wave = Math.sin(this.time * (lane.userData.driftSpeed || 0.08) + phase) * 0.5 + 0.5;
            lane.position.y = (lane.userData.baseY || 0) + (wave - 0.5) * 260;
            lane.position.z += dt * (6 + warpRatio * 16) * (lane.userData.depthDrift || 1.2);
            if (lane.position.z > -12000) {
                lane.position.z = -42000 - this.rand() * 22000;
            }
            lane.rotation.z += dt * (0.004 + wave * 0.005);
            lane.scale.x = (lane.userData.baseScaleX || 1) * (0.96 + wave * 0.08);
            lane.scale.y = (lane.userData.baseScaleY || 1) * (0.94 + wave * 0.10);
            this.setMaterialUniformValue(lane.material, 'uTime', this.time);
            const laneOpacity = THREE.MathUtils.clamp(
                (lane.userData.baseOpacity || 0.1)
                * (0.68 + wave * 0.22 + (choreography.tunnelCompression || 0) * 0.22)
                * (1 + this.reactiveEnvelope.nebula * 0.08),
                0.03,
                0.26,
            );
            this.setMaterialOpacity(lane.material, 'uOpacity', laneOpacity);
            this.tunnelTintScratch.copy(this.activePalette.bg).multiplyScalar(0.34);
            this.setMaterialColor(lane.material, 'uColor', this.tunnelTintScratch);
            this.setMaterialUniformValue(lane.material, 'uPulse', 0);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Warp Core (Central Energy Vortex)
    // ─────────────────────────────────────────────────────────────────────────

    createWarpCore() {
        // Inner energy sphere
        const coreGeometry = new THREE.SphereGeometry(80, 32, 32);
        const {
            material: coreMaterial,
        } = createStellarVelocityWarpCoreMaterial({
            isWebGPU: this.isWebGPU,
            glowIntensity: 0.5,
            pulseBoost: 0.0,
            color: this.activePalette.primary,
        });

        this.warpCore = new THREE.Mesh(coreGeometry, coreMaterial);
        this.warpCore.name = 'stellar-velocity-warp-core';
        this.warpCore.position.set(0, 0, -500);
        this.scene.add(this.warpCore);

        // Glow planes
        this.createGlowPlane(400, this.activePalette.primary, 0.6, -500, 0, 'small');
        this.createGlowPlane(700, this.activePalette.secondary, 0.4, -510, 0, 'big');

        // Energy rings
        for (let i = 0; i < 3; i++) {
            const tubeRadius = 2.2 + i * 1.05 + this.rand() * 0.9;
            const radialSegments = 16 + i * 2;
            const tubularSegments = 64 + i * 10;
            const ringGeometry = new THREE.TorusGeometry(120 + i * 40, tubeRadius, radialSegments, tubularSegments);
            const {
                material: ringMaterial,
            } = createStellarVelocityEnergyRingMaterial({
                isWebGPU: this.isWebGPU,
                shimmer: 0.15 + i * 0.08,
                color: this.activePalette.primary,
                opacity: 0.6 - i * 0.15,
            });

            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.name = `stellar-velocity-energy-ring-${i}`;
            ring.position.set(0, 0, -500);
            ring.rotation.x = Math.PI / 2 + this.rand() * 0.3;
            ring.userData.rotationSpeed = 0.5 + this.rand() * 0.5;
            ring.userData.rotationAxis = this.rand() > 0.5 ? 'x' : 'y';
            ring.userData.shimmerPhase = this.rand() * Math.PI * 2;
            ring.userData.baseOpacity = 0.6 - i * 0.15;

            this.warpCoreRings.push(ring);
            this.scene.add(ring);
        }

        this.createRouteGuides();

        // Inner accretion disc to reinforce core energy layering.
        const discGeometry = new THREE.TorusGeometry(96, 1.6, 12, 120);
        const { material: discMaterial } = createStellarVelocityEnergyRingMaterial({
            isWebGPU: this.isWebGPU,
            shimmer: 0.55,
            color: this.activePalette.secondary,
            opacity: 0.52,
        });
        this.warpAccretionDisc = new THREE.Mesh(discGeometry, discMaterial);
        this.warpAccretionDisc.name = 'stellar-velocity-accretion-disc';
        this.warpAccretionDisc.position.set(0, 0, -500);
        this.warpAccretionDisc.rotation.x = Math.PI / 2;
        this.warpAccretionDisc.userData.rotationSpeed = 2.2;
        this.warpAccretionDisc.userData.baseOpacity = 0.52;
        this.scene.add(this.warpAccretionDisc);

        console.log('[StellarVelocity] Warp core created');
    }

    createRouteGuides() {
        this.routeGuides = [];
        const routeGuideCount = 4;
        for (let i = 0; i < routeGuideCount; i++) {
            const radius = 186 + i * 24;
            const tube = 1.6 + i * 0.3;
            const arc = Math.PI * (0.38 + this.rand() * 0.2);
            const geometry = new THREE.TorusGeometry(radius, tube, 8 + i * 2, 84 + i * 8, arc);
            const {
                material,
            } = createStellarVelocityEnergyRingMaterial({
                isWebGPU: this.isWebGPU,
                color: this.activePalette.secondary,
                opacity: 0,
                shimmer: 0.22 + i * 0.08,
            });

            const guide = new THREE.Mesh(geometry, material);
            guide.name = `stellar-velocity-route-guide-${i}`;
            guide.position.set(0, 0, -500 + (i - 1.5) * 2.5);
            guide.rotation.x = Math.PI / 2 + (this.rand() - 0.5) * 0.35;
            guide.rotation.y = (this.rand() - 0.5) * 0.28;
            guide.rotation.z = this.rand() * Math.PI * 2;
            guide.visible = false;
            guide.userData.baseOpacity = 0.22 + i * 0.04;
            guide.userData.baseScale = 1 + i * 0.03;
            guide.userData.spinSpeed = 0.3 + this.rand() * 0.28;
            guide.userData.spinDirection = this.rand() > 0.5 ? 1 : -1;
            guide.userData.tiltSpeed = 0.08 + this.rand() * 0.06;
            guide.userData.phaseOffset = this.rand() * Math.PI * 2;
            guide.userData.origin = guide.position.clone();
            this.routeGuides.push(guide);
            this.scene.add(guide);
        }
    }

    updateRouteGuides(delta) {
        if (!this.routeGuides.length) return;

        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        const frame = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const visibility = THREE.MathUtils.clamp(frame.routeGuidance, 0, 1);
        const routeVector = this.hyperdriveSequence?.routeVector || new THREE.Vector3(0, 0, -1);

        this.routeGuides.forEach((guide, index) => {
            const wave = Math.sin(this.time * 3.8 + (guide.userData.phaseOffset || 0)) * 0.5 + 0.5;
            const baseOpacity = guide.userData.baseOpacity ?? 0.2;
            const opacity = visibility <= 0.001
                ? 0
                : THREE.MathUtils.clamp(
                    baseOpacity
                    * visibility
                    * (0.75 + wave * 0.35 + frame.lensHaloBoost * 0.18 + frame.reentryFlash * 0.22),
                    0,
                    0.72,
                );

            guide.visible = opacity > 0.001;
            if (guide.visible) {
                const spinSpeed = guide.userData.spinSpeed || 0.3;
                const spinDirection = guide.userData.spinDirection || 1;
                const tiltSpeed = guide.userData.tiltSpeed || 0.08;
                const spinBoost = 1 + frame.ringShimmerBoost * 1.4 + frame.routeGuidance * 0.8;
                guide.rotation.z += spinSpeed * spinDirection * dt * spinBoost;
                guide.rotation.y += tiltSpeed * dt * (1 + frame.routeGuidance * 1.2);

                const origin = guide.userData.origin || guide.position;
                const routeInfluence = visibility * (12 + index * 3.5);
                guide.position.x = origin.x + routeVector.x * routeInfluence;
                guide.position.y = origin.y + routeVector.y * routeInfluence * 0.85;

                const scale = (guide.userData.baseScale || 1)
                    + visibility * 0.08
                    + frame.tunnelCompression * 0.05
                    + wave * 0.02;
                guide.scale.setScalar(scale);
            } else if (guide.userData.origin) {
                guide.position.copy(guide.userData.origin);
                guide.scale.setScalar(guide.userData.baseScale || 1);
            }

            this.setMaterialUniformValue(guide.material, 'uTime', this.time + index * 0.18);
            this.setMaterialUniformValue(
                guide.material,
                'uShimmer',
                THREE.MathUtils.clamp(
                    0.16 + wave * 0.22 + frame.ringShimmerBoost * 0.55,
                    0.05,
                    1.2,
                ),
            );
            this.setMaterialOpacity(guide.material, 'uOpacity', opacity);
            this.tunnelTintScratch
                .copy(this.activePalette.primary)
                .lerp(this.activePalette.secondary, 0.62 + visibility * 0.22);
            this.setMaterialColor(guide.material, 'uColor', this.tunnelTintScratch);
        });
    }

    createGlowPlane(size, color, opacity, zPos, yPos, name) {
        const {
            material,
            meta,
        } = createStellarVelocityCoreGlowMaterial({
            isWebGPU: this.isWebGPU,
            color,
            opacity,
        });

        const glowObject = this.isWebGPU
            ? new THREE.Sprite(material)
            : new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);

        glowObject.name = `stellar-velocity-core-glow-${name}`;
        glowObject.position.set(0, yPos, zPos);
        glowObject.scale.set(size, size, 1);
        glowObject.userData = {
            ...(glowObject.userData || {}),
            materialMeta: meta || null,
        };

        this.scene.add(glowObject);
        this.warpCoreGlowPlanes.push(glowObject);

        if (name === 'small') {
            this.warpCoreGlow = glowObject;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Asteroid Field
    // ─────────────────────────────────────────────────────────────────────────

    createAsteroidVariantGeometry(size, distortion) {
        const geometry = new THREE.IcosahedronGeometry(size, 0);
        const positions = geometry.attributes.position;
        const jitter = size * distortion;

        for (let i = 0; i < positions.count; i++) {
            positions.setXYZ(
                i,
                positions.getX(i) + (this.rand() - 0.5) * jitter,
                positions.getY(i) + (this.rand() - 0.5) * jitter,
                positions.getZ(i) + (this.rand() - 0.5) * jitter,
            );
        }
        geometry.computeVertexNormals();
        return geometry;
    }

    createAsteroidField() {
        const count = this.qualityPreset.asteroidCount;

        const {
            material,
        } = createStellarVelocityAsteroidMaterial({
            isWebGPU: this.isWebGPU,
            color: 0x444444,
            emissive: 0x111122,
            coreGlow: 0.0,
            roughness: 0.8,
            metalness: 0.2,
        });
        this.asteroidMaterial = material;
        this.asteroids = [];
        this.asteroidGeometries = [];

        // 3 geometry buckets keep draw calls low while preserving shape variety.
        const lodBuckets = [
            { name: 'near', ratio: 0.34, size: 24, distortion: 0.30, scaleMin: 0.9, scaleMax: 1.35 },
            { name: 'mid', ratio: 0.38, size: 16, distortion: 0.27, scaleMin: 0.8, scaleMax: 1.2 },
            { name: 'far', ratio: 0.28, size: 10, distortion: 0.24, scaleMin: 0.7, scaleMax: 1.05 },
        ];

        const groupCounts = [];
        let assignedCount = 0;
        lodBuckets.forEach((bucket, index) => {
            const remaining = count - assignedCount;
            const bucketCount = index === lodBuckets.length - 1
                ? Math.max(remaining, 0)
                : Math.max(0, Math.floor(count * bucket.ratio));
            groupCounts.push(bucketCount);
            assignedCount += bucketCount;
        });

        const matrixScratch = this.asteroidMatrixScratch || new THREE.Object3D();
        this.asteroidMatrixScratch = matrixScratch;

        lodBuckets.forEach((bucket, groupIndex) => {
            const groupCount = groupCounts[groupIndex];
            if (groupCount <= 0) return;

            const geometry = this.createAsteroidVariantGeometry(bucket.size, bucket.distortion);
            const orbitData = new Float32Array(groupCount * 4);
            const rotationData = new Float32Array(groupCount * 4);
            const scaleData = new Float32Array(groupCount);
            const coreProximity = new Float32Array(groupCount);
            geometry.setAttribute('aOrbitData', new THREE.InstancedBufferAttribute(orbitData, 4));
            geometry.setAttribute('aRotationData', new THREE.InstancedBufferAttribute(rotationData, 4));
            geometry.setAttribute('aScaleData', new THREE.InstancedBufferAttribute(scaleData, 1));
            geometry.setAttribute('aCoreProximity', new THREE.InstancedBufferAttribute(coreProximity, 1));

            const mesh = new THREE.InstancedMesh(geometry, material, groupCount);
            mesh.name = `stellar-velocity-asteroid-group-${bucket.name}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;

            const angles = new Float32Array(groupCount);
            const radii = new Float32Array(groupCount);
            const zPositions = new Float32Array(groupCount);
            const scales = new Float32Array(groupCount);
            const orbitSpeeds = new Float32Array(groupCount);
            const rotations = new Float32Array(groupCount * 3);
            const rotationSpeeds = new Float32Array(groupCount * 3);

            for (let i = 0; i < groupCount; i++) {
                const i3 = i * 3;
                const i4 = i * 4;
                const angle = this.rand() * Math.PI * 2;
                const radius = this.baseTunnelRadius + 200 + this.rand() * 800;
                const z = -1000 - this.rand() * 6000;
                const scale = bucket.scaleMin + this.rand() * (bucket.scaleMax - bucket.scaleMin);
                const orbitSpeed = (this.rand() - 0.5) * 0.0005;
                const rotX = this.rand() * Math.PI;
                const rotY = this.rand() * Math.PI;
                const rotZ = this.rand() * Math.PI;
                const rotSpeedX = (this.rand() - 0.5) * 0.01;
                const rotSpeedY = (this.rand() - 0.5) * 0.01;
                const rotSpeedZ = (this.rand() - 0.5) * 0.01;

                angles[i] = angle;
                radii[i] = radius;
                zPositions[i] = z;
                scales[i] = scale;
                orbitSpeeds[i] = orbitSpeed;
                rotations[i3] = rotX;
                rotations[i3 + 1] = rotY;
                rotations[i3 + 2] = rotZ;
                rotationSpeeds[i3] = rotSpeedX;
                rotationSpeeds[i3 + 1] = rotSpeedY;
                rotationSpeeds[i3 + 2] = rotSpeedZ;

                orbitData[i4] = radius;
                orbitData[i4 + 1] = angle;
                orbitData[i4 + 2] = orbitSpeed;
                orbitData[i4 + 3] = z;
                rotationData[i4] = rotSpeedX;
                rotationData[i4 + 1] = rotSpeedY;
                rotationData[i4 + 2] = rotSpeedZ;
                rotationData[i4 + 3] = 0;
                scaleData[i] = scale;
                coreProximity[i] = this.getAsteroidCoreProximity(radius, z);

                matrixScratch.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
                matrixScratch.rotation.set(rotX, rotY, rotZ);
                matrixScratch.scale.setScalar(scale);
                matrixScratch.updateMatrix();
                mesh.setMatrixAt(i, matrixScratch.matrix);
            }

            mesh.instanceMatrix.needsUpdate = true;
            geometry.getAttribute('aOrbitData').needsUpdate = true;
            geometry.getAttribute('aRotationData').needsUpdate = true;
            geometry.getAttribute('aScaleData').needsUpdate = true;
            geometry.getAttribute('aCoreProximity').needsUpdate = true;

            this.scene.add(mesh);
            this.asteroidGeometries.push(geometry);
            this.asteroids.push({
                mesh,
                count: groupCount,
                angles,
                radii,
                zPositions,
                scales,
                orbitSpeeds,
                rotations,
                rotationSpeeds,
            });
        });

        console.log(`[StellarVelocity] ${count} asteroids instanced across ${this.asteroids.length} draw groups`);
    }

    createAsteroidMicroDebris() {
        if (this.asteroidMicroDebris?.mesh) {
            this.scene?.remove?.(this.asteroidMicroDebris.mesh);
            this.asteroidMicroDebris.mesh.geometry?.dispose?.();
            this.asteroidMicroDebris.mesh.material?.dispose?.();
            this.asteroidMicroDebris = null;
        }

        if (!this.scene || !this.asteroids.length) return;
        if (!this.isEnhancementsEnabled() || !this.isHighEnhancementQuality()) return;

        const count = Math.max(240, Math.min(960, Math.floor(this.qualityPreset.asteroidCount * 1.35)));
        const leaderGroup = new Uint16Array(count);
        const leaderIndex = new Uint16Array(count);
        const tailOffset = new Float32Array(count * 3);
        const trailPhase = new Float32Array(count);
        const baseSize = new Float32Array(count);
        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const groupIndex = Math.floor(this.rand() * this.asteroids.length) % this.asteroids.length;
            const group = this.asteroids[groupIndex];
            const instanceIndex = Math.floor(this.rand() * Math.max(1, group?.count || 1));
            leaderGroup[i] = groupIndex;
            leaderIndex[i] = instanceIndex;
            const i3 = i * 3;
            tailOffset[i3] = (this.rand() - 0.5) * 20;
            tailOffset[i3 + 1] = (this.rand() - 0.5) * 20;
            tailOffset[i3 + 2] = -8 - this.rand() * 48;
            trailPhase[i] = this.rand() * Math.PI * 2;
            baseSize[i] = 0.42 + this.rand() * 0.9;
        }

        let geometry = null;
        let mesh = null;
        if (this.isWebGPU) {
            const quadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            geometry = new THREE.InstancedBufferGeometry();
            geometry.setIndex(quadGeometry.getIndex().clone());
            geometry.setAttribute('position', quadGeometry.getAttribute('position').clone());
            geometry.setAttribute('normal', quadGeometry.getAttribute('normal').clone());
            geometry.setAttribute('uv', quadGeometry.getAttribute('uv').clone());
            quadGeometry.dispose();
            const offsetAttribute = new THREE.InstancedBufferAttribute(positions, 3);
            offsetAttribute.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('aOffset', offsetAttribute);
            geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(baseSize, 1));
            geometry.instanceCount = count;

            const {
                material,
            } = createStellarVelocityBurstParticleMaterial({
                isWebGPU: true,
                color: this.activePalette.secondary,
                size: 7.2,
                opacity: 0.42,
                starTexture: null,
            });
            mesh = new THREE.Mesh(geometry, material);
        } else {
            geometry = new THREE.BufferGeometry();
            const positionAttribute = new THREE.BufferAttribute(positions, 3);
            positionAttribute.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('position', positionAttribute);
            const {
                material,
            } = createStellarVelocityBurstParticleMaterial({
                isWebGPU: false,
                color: this.activePalette.secondary,
                size: 7,
                opacity: 0.4,
                starTexture: this.getStarTexture(),
            });
            mesh = new THREE.Points(geometry, material);
        }

        mesh.name = 'stellar-velocity-asteroid-micro-debris';
        mesh.frustumCulled = false;
        mesh.userData.cameraFacing = this.isWebGPU;
        this.scene.add(mesh);
        this.asteroidMicroDebris = {
            mesh,
            count,
            positions,
            leaderGroup,
            leaderIndex,
            tailOffset,
            trailPhase,
            baseSize,
        };
        if (this.postProcessing?.useMRT === true) {
            this.ensureMrtMaterials({ log: this.flags.mrtAudit });
        } else if (this.flags.mrtAudit) {
            this.runMaterialAudit({ log: true });
        }
    }

    updateAsteroidMicroDebris(delta) {
        const debris = this.asteroidMicroDebris;
        if (!debris?.mesh?.geometry) return;
        const enhancementsReady = this.isEnhancementsEnabled() && this.isHighEnhancementQuality();
        debris.mesh.visible = enhancementsReady;
        if (!enhancementsReady || !this.asteroids.length) {
            return;
        }

        if (debris.mesh.userData.cameraFacing === true && this.camera) {
            debris.mesh.quaternion.copy(this.camera.quaternion);
        }

        const activePositionAttribute = debris.mesh.geometry.getAttribute('aOffset')
            || debris.mesh.geometry.getAttribute('position');
        if (!activePositionAttribute?.array) return;
        const sizeAttribute = debris.mesh.geometry.getAttribute('aSize');
        const positions = activePositionAttribute.array;
        const warpRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(this.maxSpeed, 0.0001), 0, 1);
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;

        this.tunnelTintScratch
            .copy(this.activePalette.secondary)
            .lerp(this.activePalette.primary, 0.18 + warpRatio * 0.28);
        this.setMaterialColor(debris.mesh.material, 'uColor', this.tunnelTintScratch);
        const debrisOpacity = THREE.MathUtils.clamp(0.22 + warpRatio * 0.44, 0.16, 0.72);
        this.setMaterialOpacity(debris.mesh.material, 'uOpacity', debrisOpacity);

        for (let i = 0; i < debris.count; i++) {
            const groupIndex = debris.leaderGroup[i] % this.asteroids.length;
            const group = this.asteroids[groupIndex];
            if (!group?.mesh || group.count <= 0) continue;

            const instanceIndex = debris.leaderIndex[i] % group.count;
            group.mesh.getMatrixAt(instanceIndex, this.asteroidReadMatrix);
            this.asteroidReadMatrix.decompose(
                this.asteroidReadPosition,
                this.asteroidReadQuaternion,
                this.asteroidReadScale,
            );

            const phase = debris.trailPhase[i];
            const orbitAngle = group.angles?.[instanceIndex] ?? phase;
            const trailDistance = (14 + warpRatio * 54) * (0.68 + Math.sin(this.time * 0.8 + phase) * 0.22);
            const trailDirX = -Math.cos(orbitAngle);
            const trailDirY = -Math.sin(orbitAngle);
            const jitter = Math.sin(this.time * (2.4 + phase * 0.15) + phase) * 6.5;
            const i3 = i * 3;

            positions[i3] = this.asteroidReadPosition.x
                + debris.tailOffset[i3]
                + trailDirX * trailDistance
                + jitter * 0.24;
            positions[i3 + 1] = this.asteroidReadPosition.y
                + debris.tailOffset[i3 + 1]
                + trailDirY * trailDistance
                + jitter * 0.18;
            positions[i3 + 2] = this.asteroidReadPosition.z
                + debris.tailOffset[i3 + 2]
                - warpRatio * (10 + Math.sin(this.time * 1.7 + phase) * 6)
                - dt * 14;

            if (sizeAttribute?.array?.length) {
                sizeAttribute.array[i] = debris.baseSize[i] * (
                    0.38
                    + warpRatio * 0.95
                    + (Math.sin(this.time * 5.2 + phase) * 0.5 + 0.5) * 0.22
                );
            }
        }

        activePositionAttribute.needsUpdate = true;
        if (sizeAttribute?.array) {
            sizeAttribute.needsUpdate = true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        this.disposePostProcessingStack();
        if (!this.capabilities.post) {
            return;
        }
        if (!this.isWebGPU) {
            this.flags.useMRT = false;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;
        const preset = this.getWebGPUPostPreset();

        if (this.isWebGPU) {
            const buildPostParams = (useMRT) => ({
                useMRT,
                bloomStrength: preset.bloomStrength,
                bloomRadius: preset.bloomRadius,
                bloomThreshold: useMRT ? Math.max(0.05, preset.bloomThreshold) : Math.max(preset.bloomThreshold, 0.7),
                bloomDownsample: preset.bloomDownsample,
                vignetteOffset: 1.12,
                vignetteDarkness: 0.34,
                chromaticStrength: 0.0,
                exposure: 0.96,
                contrast: 1.04,
                saturation: 1.04,
                tintStrength: 0.08,
                ditherStrength: 0.0014,
                enableTiming: true,
            });

            const requestedMRT = this.capabilities.mrt === true
                && this.ensureMrtMaterials({ log: this.flags.mrtAudit });
            try {
                this.postProcessing = new StellarVelocityPost(
                    this.renderer,
                    this.scene,
                    this.camera,
                    buildPostParams(requestedMRT),
                );

                if (requestedMRT && this.postProcessing?.useMRT !== true) {
                    this.capabilities.mrt = false;
                    this.flags.useMRT = false;
                    console.warn('[StellarVelocity] WebGPU MRT request downgraded to non-MRT post path.');
                } else {
                    this.flags.useMRT = requestedMRT && this.postProcessing?.useMRT === true;
                }

                this.postProcessing.setSize(width, height);
                if (this.flags.mrtAudit) {
                    console.info('[StellarVelocity] WebGPU post diagnostics', this.postProcessing.getDiagnostics?.());
                }
                console.log(`[StellarVelocity] WebGPU post-processing setup complete (MRT: ${this.flags.useMRT ? 'on' : 'off'})`);
                return;
            } catch (error) {
                if (requestedMRT) {
                    console.warn('[StellarVelocity] WebGPU MRT post setup failed, retrying without MRT:', error);
                    try {
                        this.postProcessing = new StellarVelocityPost(
                            this.renderer,
                            this.scene,
                            this.camera,
                            buildPostParams(false),
                        );
                        this.capabilities.mrt = false;
                        this.flags.useMRT = false;
                        this.postProcessing.setSize(width, height);
                        if (this.flags.mrtAudit) {
                            console.info('[StellarVelocity] WebGPU post diagnostics', this.postProcessing.getDiagnostics?.());
                        }
                        console.log('[StellarVelocity] WebGPU post-processing setup complete (MRT fallback: off)');
                        return;
                    } catch (fallbackError) {
                        error = fallbackError;
                    }
                }

                console.warn('[StellarVelocity] WebGPU post setup failed, using direct rendering:', error);
                this.capabilities.post = false;
                this.flags.usePost = false;
                this.flags.useMRT = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
                return;
            }
        }

        try {
            this.composer = new EffectComposer(this.renderer);
            const fallbackBloomThreshold = Math.max(preset.bloomThreshold, 0.7);

            const renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);

            // Bloom
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.qualityPreset.bloomStrength,
                this.qualityPreset.bloomRadius,
                fallbackBloomThreshold,
            );
            this.composer.addPass(this.bloomPass);

            // Vignette
            this.vignettePass = new ShaderPass(VignetteShader);
            this.vignettePass.uniforms.darkness.value = 0.4;
            this.vignettePass.uniforms.offset.value = 1.1;
            this.composer.addPass(this.vignettePass);

            // Chromatic Aberration (only on high quality)
            if (this.qualityPreset.enableChromatic) {
                this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
                this.chromaticPass.uniforms.intensity.value = 0;
                this.composer.addPass(this.chromaticPass);
            }
            this.composer.setSize(width, height);
            console.log('[StellarVelocity] WebGL post-processing setup complete');
        } catch (error) {
            console.warn('[StellarVelocity] WebGL post setup failed, using direct rendering:', error);
            this.capabilities.post = false;
            this.flags.usePost = false;
            this.disposePostProcessingStack();
            this.configureRendererColorPipeline();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        if (!this.boundResizeHandler) {
            this.boundResizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        }
        window.addEventListener('resize', this.boundResizeHandler);
        this.resizeHandler = this.boundResizeHandler;

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
        console.log('[StellarVelocity] Event listeners set up');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────

    onLineClear(lineCount) {
        if (!this.isEnhancementsEnabled()) return;
        const safeCount = Math.max(1, Math.floor(lineCount || 1));
        this.triggerReactiveEvent('LINE_CLEAR', safeCount);
        this.startHyperdriveSequence({
            eventName: 'LINE_CLEAR',
            intensity: safeCount,
            startPhase: safeCount >= 2 ? HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL : HYPERDRIVE_PHASES.MAP_LOCK,
            forceRestart: safeCount >= 4,
        });
        if (safeCount >= 4) {
            this.createBurstParticles(24);
            this.createShockwaveRing();
        } else if (safeCount >= 2) {
            this.createBurstParticles(12);
        }
        if (safeCount >= 3) {
            this.createEnergyDischargeArc(safeCount);
        }
    }

    onCombo(comboCount) {
        if (!this.isEnhancementsEnabled()) return;
        const safeCombo = Math.max(1, Math.floor(comboCount || 1));
        this.triggerReactiveEvent('COMBO', safeCombo);
        this.startHyperdriveSequence({
            eventName: 'COMBO',
            intensity: safeCombo,
            startPhase: safeCombo >= 5 ? HYPERDRIVE_PHASES.HYPERDRIVE_SPOOL : HYPERDRIVE_PHASES.MAP_LOCK,
            forceRestart: safeCombo >= 8,
        });

        if (safeCombo >= 8) {
            this.createBurstParticles(220);
            this.createShockwaveRing();
        } else if (safeCombo >= 5) {
            this.createBurstParticles(120);
            if (safeCombo >= 7) this.createShockwaveRing();
        } else if (safeCombo >= 3) {
            this.createBurstParticles(60);
        } else {
            this.createBurstParticles(28);
        }
        if (safeCombo >= 4) {
            const arcBursts = safeCombo >= 8 ? 3 : safeCombo >= 6 ? 2 : 1;
            for (let i = 0; i < arcBursts; i++) {
                this.createEnergyDischargeArc(safeCombo);
            }
        }
    }

    onPieceLock() {
        if (!this.isEnhancementsEnabled()) return;
        this.triggerReactiveEvent('PIECE_LOCK', 1);
        if (!this.hyperdriveSequence.active && this.rand() < 0.18) {
            this.startHyperdriveSequence({
                eventName: 'PIECE_LOCK',
                intensity: 1,
                startPhase: HYPERDRIVE_PHASES.MAP_LOCK,
            });
        }
        if (this.rand() < 0.12) {
            this.createBurstParticles(8);
        }
        if (this.rand() < 0.08) {
            this.createEnergyDischargeArc(1);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effect Creation
    // ─────────────────────────────────────────────────────────────────────────

    initializeBurstComputePool() {
        const canUseBurstCompute = this.isWebGPU
            && this.capabilities.compute
            && this.flags.useCompute
            && this.qualityBudget.computeEnabled === true;
        if (!canUseBurstCompute) {
            return false;
        }
        if (this.burstParticlePool && this.burstCompute?.computeNode) {
            return true;
        }

        this.burstCompute?.dispose?.();
        this.burstCompute = null;
        if (this.burstParticlePool) {
            this.scene?.remove?.(this.burstParticlePool);
            this.burstParticlePool.geometry?.dispose?.();
            this.burstParticlePool.material?.dispose?.();
            this.burstParticlePool = null;
        }

        const burstPoolBudget = Math.min(
            this.qualityBudget?.maxBurstParticles ?? 256,
            this.performanceBudget?.maxBurstParticles ?? 256,
        );
        const poolCount = Math.max(256, Math.floor(burstPoolBudget));
        try {
            this.burstCompute = new StellarVelocityBurstCompute(poolCount, {
                random: () => this.rand(),
                damping: 0.986,
                speedScale: 60,
            });
            this.burstCompute.createComputeNode();

            const quadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            const geometry = new THREE.InstancedBufferGeometry();
            geometry.setIndex(quadGeometry.getIndex().clone());
            geometry.setAttribute('position', quadGeometry.getAttribute('position').clone());
            geometry.setAttribute('normal', quadGeometry.getAttribute('normal').clone());
            geometry.setAttribute('uv', quadGeometry.getAttribute('uv').clone());
            quadGeometry.dispose();

            const sizes = new Float32Array(poolCount);
            for (let i = 0; i < poolCount; i++) {
                sizes[i] = 0.7 + this.rand() * 0.8;
            }
            geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
            geometry.instanceCount = poolCount;

            const { material } = createStellarVelocityBurstParticleMaterial({
                isWebGPU: this.isWebGPU,
                color: this.activePalette.primary,
                size: 16,
                opacity: 1.0,
                burstCompute: this.burstCompute,
                starTexture: null,
            });

            const poolMesh = new THREE.Mesh(geometry, material);
            poolMesh.name = 'stellar-velocity-burst-pool';
            poolMesh.frustumCulled = false;
            poolMesh.userData = {
                cameraFacing: true,
                computeBacked: true,
                count: poolCount,
            };
            this.scene.add(poolMesh);
            this.burstParticlePool = poolMesh;

            if (this.postProcessing?.useMRT === true) {
                this.ensureMrtMaterials({ log: this.flags.mrtAudit });
            } else if (this.flags.mrtAudit) {
                this.runMaterialAudit({ log: true });
            }

            console.log(`[StellarVelocity] Burst compute pool initialized (${poolCount} particles)`);
            return true;
        } catch (error) {
            console.warn('[StellarVelocity] Burst compute pool setup failed, using dynamic fallback:', error);
            this.burstCompute?.dispose?.();
            this.burstCompute = null;
            if (this.burstParticlePool) {
                this.scene?.remove?.(this.burstParticlePool);
                this.burstParticlePool.geometry?.dispose?.();
                this.burstParticlePool.material?.dispose?.();
                this.burstParticlePool = null;
            }
            return false;
        }
    }

    createBurstParticles(count) {
        if (!this.scene || !this.isEnhancementsEnabled()) return;
        if (!this.canSpawnTransientFx(1)) return;
        const adaptiveScale = this.getAdaptiveEffectScale();
        const scaledCountInput = Number.isFinite(count) ? Math.floor(count * adaptiveScale) : 0;
        const burstBudget = Math.min(
            this.qualityBudget?.maxBurstParticles ?? scaledCountInput,
            this.performanceBudget?.maxBurstParticles ?? scaledCountInput,
        );
        const activeParticleCount = this.burstParticles.reduce(
            (sum, burst) => sum + (burst?.userData?.count || 0),
            0,
        );
        const availableCount = Math.max(0, burstBudget - activeParticleCount);
        const requestedCount = Math.max(0, scaledCountInput);
        const safeCount = Math.max(0, Math.min(requestedCount, availableCount));
        if (safeCount <= 0) return;

        if (this.initializeBurstComputePool() && this.burstCompute?.computeNode) {
            this.burstCompute.triggerBurst({
                origin: { x: 0, y: 0, z: -500 },
                count: safeCount,
                speedMin: 30,
                speedMax: 80,
                lifeMin: 1.6,
                lifeMax: 3.2,
                zBias: 0.3,
                time: this.time,
            });
            return;
        }

        const positions = new Float32Array(safeCount * 3);
        const scales = new Float32Array(safeCount);
        const velocities = [];

        const colorScheme = {
            primary: this.activePalette.primary,
        };

        for (let i = 0; i < safeCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = -500; // At warp core

            // Radial velocity
            const angle = this.rand() * Math.PI * 2;
            const speed = 30 + this.rand() * 50;
            velocities.push({
                x: Math.cos(angle) * speed,
                y: Math.sin(angle) * speed,
                z: (this.rand() - 0.3) * speed * 0.5,
            });
            scales[i] = 0.7 + this.rand() * 0.8;
        }

        let geometry = null;
        if (this.isWebGPU) {
            const quadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            geometry = new THREE.InstancedBufferGeometry();
            geometry.setIndex(quadGeometry.getIndex().clone());
            geometry.setAttribute('position', quadGeometry.getAttribute('position').clone());
            geometry.setAttribute('normal', quadGeometry.getAttribute('normal').clone());
            geometry.setAttribute('uv', quadGeometry.getAttribute('uv').clone());
            quadGeometry.dispose();

            const offsetAttribute = new THREE.InstancedBufferAttribute(positions, 3);
            offsetAttribute.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('aOffset', offsetAttribute);
            geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(scales, 1));
            geometry.instanceCount = safeCount;
        } else {
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        }

        const {
            material,
        } = createStellarVelocityBurstParticleMaterial({
            isWebGPU: this.isWebGPU,
            color: colorScheme.primary,
            size: 15 + this.rand() * 10,
            opacity: 1.0,
            starTexture: this.isWebGPU ? null : this.getStarTexture(),
        });

        const burst = this.isWebGPU
            ? new THREE.Mesh(geometry, material)
            : new THREE.Points(geometry, material);
        burst.name = `stellar-velocity-burst-${Date.now()}`;
        burst.frustumCulled = false;
        burst.userData = {
            velocities,
            life: 3.0,
            maxLife: 3.0,
            count: safeCount,
            cameraFacing: this.isWebGPU,
        };

        this.scene.add(burst);
        this.burstParticles.push(burst);
        if (this.postProcessing?.useMRT === true) {
            this.ensureMrtMaterials({ log: this.flags.mrtAudit });
        } else if (this.flags.mrtAudit) {
            this.runMaterialAudit({ log: true });
        }
    }

    createShockwaveRing() {
        if (!this.scene || !this.isEnhancementsEnabled()) return;
        if (this.getAdaptiveEffectScale() < 0.52) return;
        if (!this.canSpawnTransientFx(1)) return;
        const geometry = new THREE.RingGeometry(80, 100, 64);
        const {
            material,
        } = createStellarVelocityShockwaveMaterial({
            isWebGPU: this.isWebGPU,
            color: this.activePalette.primary,
            opacity: 0.8,
        });

        const ring = new THREE.Mesh(geometry, material);
        ring.name = `stellar-velocity-shockwave-${Date.now()}`;
        ring.position.set(0, 0, -450);
        ring.userData.speed = 0.15;
        ring.userData.life = 1.0;

        this.scene.add(ring);
        this.shockwaveRings.push(ring);
        if (this.postProcessing?.useMRT === true) {
            this.ensureMrtMaterials({ log: this.flags.mrtAudit });
        } else if (this.flags.mrtAudit) {
            this.runMaterialAudit({ log: true });
        }
    }

    createEnergyDischargeArc(intensity = 1) {
        if (!this.scene || !this.isEnhancementsEnabled()) return;
        if (this.getAdaptiveEffectScale() < 0.46) return;
        if (!this.canSpawnTransientFx(1)) return;

        const safeIntensity = THREE.MathUtils.clamp(
            Number.isFinite(intensity) ? intensity : 1,
            1,
            12,
        );
        const angle = this.rand() * Math.PI * 2;
        const corePos = new THREE.Vector3(0, 0, -500);
        const edgeRadius = 150 + this.rand() * 120;
        const edgePoint = new THREE.Vector3(
            Math.cos(angle) * edgeRadius,
            Math.sin(angle) * edgeRadius,
            -500 + (this.rand() - 0.5) * 32,
        );
        const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0);
        const normal = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
        const points = [corePos.clone()];
        const controlPoints = 6;
        for (let i = 1; i < controlPoints - 1; i++) {
            const t = i / (controlPoints - 1);
            const point = corePos.clone().lerp(edgePoint, t);
            const centerBias = 1 - Math.abs(t - 0.5) * 1.7;
            const jitterScale = (16 + safeIntensity * 3.8) * centerBias;
            point.addScaledVector(tangent, (this.rand() - 0.5) * jitterScale);
            point.addScaledVector(normal, (this.rand() - 0.5) * jitterScale * 0.58);
            point.z += (this.rand() - 0.5) * jitterScale * 0.42;
            points.push(point);
        }
        points.push(edgePoint);

        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
        const radius = 0.85 + safeIntensity * 0.09;
        const geometry = new THREE.TubeGeometry(curve, 28, radius, 7, false);
        const {
            material,
        } = createStellarVelocityShockwaveMaterial({
            isWebGPU: this.isWebGPU,
            color: this.activePalette.primary,
            opacity: 0.85,
        });

        const arc = new THREE.Mesh(geometry, material);
        arc.name = `stellar-velocity-discharge-arc-${Date.now()}-${Math.floor(this.rand() * 1000)}`;
        arc.frustumCulled = false;
        arc.userData.life = 0.18 + this.rand() * 0.16 + safeIntensity * 0.01;
        arc.userData.maxLife = arc.userData.life;
        arc.userData.phase = this.rand() * Math.PI * 2;
        arc.userData.baseScale = 1.0;
        this.scene.add(arc);
        this.energyDischargeArcs.push(arc);
    }

    updateEnergyDischargeArcs(delta) {
        if (!this.energyDischargeArcs.length) return;
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        for (let i = this.energyDischargeArcs.length - 1; i >= 0; i--) {
            const arc = this.energyDischargeArcs[i];
            arc.userData.life -= dt;
            const lifeAlpha = THREE.MathUtils.clamp(
                arc.userData.life / Math.max(arc.userData.maxLife || 0.0001, 0.0001),
                0,
                1,
            );
            const flicker = Math.sin(this.time * 58 + (arc.userData.phase || 0)) * 0.5 + 0.5;
            const opacity = lifeAlpha * (0.52 + flicker * 0.58);
            this.setMaterialOpacity(arc.material, 'uOpacity', opacity);
            this.tunnelTintScratch
                .copy(this.activePalette.primary)
                .lerp(this.activePalette.secondary, 0.28 + flicker * 0.26);
            this.setMaterialColor(arc.material, 'uColor', this.tunnelTintScratch);
            const scale = (arc.userData.baseScale || 1.0) + (1 - lifeAlpha) * 0.10;
            arc.scale.setScalar(scale);

            if (arc.userData.life <= 0) {
                this.scene.remove(arc);
                arc.geometry?.dispose?.();
                arc.material?.dispose?.();
                this.energyDischargeArcs.splice(i, 1);
            }
        }
    }

    createCometStreak() {
        if (!this.scene || !this.renderer || !this.isEnhancementsEnabled()) return;
        const effectScale = this.getAdaptiveEffectScale();
        if (effectScale < 0.42) return;
        if (!this.canSpawnTransientFx(1)) return;
        if ((this.qualityPreset?.starCount ?? 0) < 900) return;

        const startX = (this.rand() - 0.5) * this.baseTunnelRadius * 1.8;
        const startY = (this.rand() - 0.5) * this.baseTunnelRadius * 0.9;
        const startZ = -1800 - this.rand() * 4200;
        const dirX = startX > 0 ? -1 : 1;
        const velocity = new THREE.Vector3(
            dirX * (360 + this.rand() * 260),
            (this.rand() - 0.5) * 130,
            600 + this.rand() * 260,
        );
        const life = (0.75 + this.rand() * 0.55) * THREE.MathUtils.clamp(effectScale, 0.45, 1.0);
        const size = (1.35 + this.rand() * 0.95) * THREE.MathUtils.clamp(effectScale, 0.5, 1.0);

        let comet = null;
        if (this.isWebGPU) {
            const quadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            const geometry = new THREE.InstancedBufferGeometry();
            geometry.setIndex(quadGeometry.getIndex().clone());
            geometry.setAttribute('position', quadGeometry.getAttribute('position').clone());
            geometry.setAttribute('normal', quadGeometry.getAttribute('normal').clone());
            geometry.setAttribute('uv', quadGeometry.getAttribute('uv').clone());
            quadGeometry.dispose();
            geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array([startX, startY, startZ]), 3));
            geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array([size]), 1));
            geometry.instanceCount = 1;

            const { material } = createStellarVelocityBurstParticleMaterial({
                isWebGPU: true,
                color: this.activePalette.secondary,
                size: 34,
                opacity: 0.92,
                starTexture: null,
            });

            comet = new THREE.Mesh(geometry, material);
            comet.userData.cameraFacing = true;
        } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([startX, startY, startZ]), 3));
            const { material } = createStellarVelocityBurstParticleMaterial({
                isWebGPU: false,
                color: this.activePalette.secondary,
                size: 24,
                opacity: 0.92,
                starTexture: this.getStarTexture(),
            });
            comet = new THREE.Points(geometry, material);
            comet.userData.cameraFacing = false;
        }

        this.cometCounter += 1;
        comet.name = `stellar-velocity-comet-${this.cometCounter}`;
        comet.frustumCulled = false;
        comet.userData.velocity = velocity;
        comet.userData.life = life;
        comet.userData.maxLife = life;
        comet.userData.baseSize = size;
        this.scene.add(comet);
        this.cometStreaks.push(comet);
    }

    updateCometStreaks(delta) {
        if (!this.cometStreaks.length) return;
        for (let i = this.cometStreaks.length - 1; i >= 0; i--) {
            const comet = this.cometStreaks[i];
            const velocity = comet.userData.velocity;
            if (!velocity) continue;

            if (comet.userData.cameraFacing === true && this.camera) {
                comet.quaternion.copy(this.camera.quaternion);
            }

            const offsetAttribute = comet.geometry.getAttribute('aOffset');
            const positionAttribute = comet.geometry.getAttribute('position');
            const activePositionAttribute = offsetAttribute || positionAttribute;
            if (activePositionAttribute?.array) {
                activePositionAttribute.array[0] += velocity.x * delta;
                activePositionAttribute.array[1] += velocity.y * delta;
                activePositionAttribute.array[2] += velocity.z * delta;
                activePositionAttribute.needsUpdate = true;
            }

            velocity.multiplyScalar(0.992);
            comet.userData.life -= delta;
            const lifeAlpha = Math.max(0, comet.userData.life / Math.max(comet.userData.maxLife, 0.0001));
            const cometOpacity = Math.min(1, lifeAlpha * 1.12);
            this.setMaterialOpacity(comet.material, 'uOpacity', cometOpacity);
            if (typeof comet.material.opacity === 'number') {
                comet.material.opacity = cometOpacity;
            }
            this.setMaterialColor(comet.material, 'uColor', this.activePalette.secondary);

            const sizeAttribute = comet.geometry.getAttribute('aSize');
            if (sizeAttribute?.array?.length) {
                sizeAttribute.array[0] = comet.userData.baseSize * (0.65 + lifeAlpha * 1.3);
                sizeAttribute.needsUpdate = true;
            }

            if (comet.userData.life <= 0) {
                this.scene.remove(comet);
                comet.geometry?.dispose?.();
                comet.material?.dispose?.();
                this.cometStreaks.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Color Cycling
    // ─────────────────────────────────────────────────────────────────────────

    startColorCycle() {
        const cycleColors = () => {
            if (!this.isActive) return;

            const nextScheme = (this.currentColorScheme + 1) % this.colorSchemes.length;
            this.beginColorTransition(nextScheme, 2.2 + this.rand() * 0.8);

            // Schedule next cycle
            const delay = 30000 + this.rand() * 15000;
            this.colorCycleInterval = this.scheduleThemeTimeout(cycleColors, delay);
        };

        // Start first cycle after 20 seconds
        this.colorCycleInterval = this.scheduleThemeTimeout(cycleColors, 20000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        if (!this.isActive) return;
        this.clock.start();

        const animate = () => {
            if (!this.isActive) return;

            const measuredDelta = this.clock.getDelta();
            const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : measuredDelta;
            if (this.fixedDeltaSeconds !== null) {
                this.fixedElapsed += rawDelta;
                this.time = this.fixedElapsed;
            } else {
                this.time += rawDelta;
            }
            const profileFrame = (this.hotPathProfile.frameCounter++ % this.hotPathProfile.sampleStride) === 0;

            this.updateWarpState(rawDelta);
            this.runHotPathStep('starfield', () => this.updateStarfield(rawDelta), profileFrame);
            this.updateWarpStreakLines(rawDelta);
            this.updateNebulas(rawDelta);
            this.updateWarpCore(rawDelta);
            this.updateTunnelLattice(rawDelta);
            this.runHotPathStep('asteroid', () => this.updateAsteroids(rawDelta), profileFrame);
            this.updateAsteroidMicroDebris(rawDelta);
            this.runHotPathStep('burst', () => this.updateBurstParticles(rawDelta), profileFrame);
            this.updateShockwaveRings(rawDelta);
            this.updateEnergyDischargeArcs(rawDelta);
            this.updateCometStreaks(rawDelta);
            this.updatePostProcessing();
            this.updateCamera(rawDelta);

            this.render();
            this.updateAdaptiveScaler(rawDelta * 1000);
            void this.updateGpuTimings();
            if (this.flags.baseline) {
                this.trackBaselineFrame(rawDelta);
            }

            const animationId = requestAnimationFrame(animate);
            this.animationFrameId = animationId;
            this.registerAnimation(animationId);
        };

        const animationId = requestAnimationFrame(animate);
        this.animationFrameId = animationId;
        this.registerAnimation(animationId);
    }

    updateWarpState(delta) {
        const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0.016;
        this.decayReactiveEnvelope(dt);
        this.updateColorTransition(dt);
        this.applyActivePalette();

        const enhancementsEnabled = this.isEnhancementsEnabled();
        let choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        if (!enhancementsEnabled) {
            Object.keys(this.reactiveEnvelope).forEach((key) => {
                this.reactiveEnvelope[key] = 0;
            });
            if (this.hyperdriveSequence.active || this.hyperdriveFrame?.active) {
                this.stopHyperdriveSequence();
            }
            choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        } else {
            choreography = this.updateHyperdriveChoreography(dt);
        }

        const envelope = this.reactiveEnvelope;
        const effectScale = this.getAdaptiveEffectScale();
        const warpRatioReactive = Math.min(1, envelope.warp / Math.max(this.reactiveCaps.warp, 0.0001));
        const pulseRatioReactive = Math.min(1, envelope.pulse / Math.max(this.reactiveCaps.pulse, 0.0001));
        const warpRatio = THREE.MathUtils.clamp(warpRatioReactive + (choreography.warpRatioBoost || 0), 0, 1);
        const pulseRatio = THREE.MathUtils.clamp(pulseRatioReactive + (choreography.pulseRatioBoost || 0), 0, 1);
        const bloomReactive = Math.min(0.95, envelope.bloom * 0.85);
        const chromaticReactive = Math.min(1.6, envelope.chromatic);
        const starReactive = Math.min(0.95, envelope.star * 0.9);
        const nebulaReactive = Math.min(0.95, envelope.nebula * 0.9);

        this.targetSpeed = enhancementsEnabled
            ? this.baseSpeed + warpRatio * (this.maxSpeed * 1.12 - this.baseSpeed)
            : this.baseSpeed;
        this.targetTunnelRadius = enhancementsEnabled
            ? Math.max(
                180,
                this.baseTunnelRadius
                - warpRatio * 1180
                - (choreography.tunnelCompression || 0) * 360,
            )
            : this.baseTunnelRadius;
        this.targetFOV = enhancementsEnabled
            ? Math.max(
                HYPERDRIVE_READABILITY_LIMITS.minFov,
                this.baseFOV
                - warpRatio * 20
                - (choreography.fovNarrow || 0) * 8,
            )
            : this.baseFOV;
        this.chromaticIntensity = enhancementsEnabled
            ? THREE.MathUtils.clamp(
                (chromaticReactive * 0.72 + (choreography.chromaticBoost || 0) * 0.34) * effectScale,
                0,
                HYPERDRIVE_READABILITY_LIMITS.chromaticMax,
            )
            : 0;
        this.bloomPulseIntensity = enhancementsEnabled
            ? THREE.MathUtils.clamp(
                (bloomReactive * 0.55 + (choreography.bloomBoost || 0) * 0.24) * effectScale,
                0,
                HYPERDRIVE_READABILITY_LIMITS.bloomPulseMax,
            )
            : 0;
        this.starTwinkleBoost = enhancementsEnabled
            ? THREE.MathUtils.clamp(
                (starReactive + (choreography.starStretchBoost || 0) * 0.42) * effectScale,
                0,
                0.97,
            )
            : 0;
        this.starWarpBoost = enhancementsEnabled
            ? THREE.MathUtils.clamp(
                ((choreography.starStretchBoost || 0) * 0.58 + (choreography.reentryFlash || 0) * 0.12) * effectScale,
                0,
                0.55,
            )
            : 0;
        this.warpCoreGlowIntensity = enhancementsEnabled
            ? THREE.MathUtils.clamp(
                0.42
                + pulseRatio * 0.62 * effectScale
                + (choreography.corePulseBoost || 0) * 0.14
                + (choreography.reentryFlash || 0) * 0.16,
                0.40,
                1.05,
            )
            : 0.42;

        const speedLerp = this.acceleration * (0.7 + warpRatio * 0.55 + (choreography.warpRatioBoost || 0) * 0.2);
        this.currentSpeed += (this.targetSpeed - this.currentSpeed) * speedLerp;
        this.tunnelRadius += (this.targetTunnelRadius - this.tunnelRadius) * (0.04 + warpRatio * 0.05);
        this.currentFOV += (this.targetFOV - this.currentFOV) * (0.05 + warpRatio * 0.05);
        if (this.camera) {
            this.camera.fov = this.currentFOV;
            this.camera.updateProjectionMatrix();
        }

        const nebulaPulse = THREE.MathUtils.clamp(
            (nebulaReactive * 0.82 + (choreography.lensHaloBoost || 0) * 0.10) * effectScale,
            0,
            0.72,
        );
        this.nebulaMeshes.forEach((mesh) => {
            this.setMaterialUniformValue(mesh.material, 'uPulse', nebulaPulse);
        });

        const idleEnergy = envelope.pulse
            + envelope.bloom
            + envelope.warp
            + envelope.chromatic
            + envelope.shake
            + envelope.star
            + envelope.nebula;
        const choreographyEnergy = (choreography.warpRatioBoost || 0)
            + (choreography.bloomBoost || 0) * 0.8
            + (choreography.chromaticBoost || 0) * 0.65
            + (choreography.shakeBoost || 0) * 0.5
            + (choreography.starStretchBoost || 0) * 0.45
            + (choreography.reentryFlash || 0);
        if (
            enhancementsEnabled
            && idleEnergy < 0.08
            && this.burstParticles.length === 0
            && this.shockwaveRings.length === 0
            && this.energyDischargeArcs.length === 0
        ) {
            if (choreographyEnergy <= 0.04) {
                this.idleSeconds += dt;
            } else {
                this.idleSeconds = 0;
            }
        } else {
            this.idleSeconds = 0;
        }
        if (enhancementsEnabled && effectScale > 0.42 && this.idleSeconds >= 4 && this.time >= this.nextCometAt) {
            this.createCometStreak();
            this.nextCometAt = this.time + (8 + this.rand() * 12) / Math.max(0.45, effectScale);
        }
    }

    updateStarfield(delta) {
        if (!this.starfield?.material) return;

        this.setMaterialUniformValue(this.starfield.material, 'uTime', this.time);
        this.setMaterialUniformValue(
            this.starfield.material,
            'uWarpSpeed',
            THREE.MathUtils.clamp(
                Math.max((this.currentSpeed / this.baseSpeed - 1) * 0.1, 0) + (this.starWarpBoost || 0),
                0,
                1.0,
            ),
        );
        this.setMaterialUniformValue(this.starfield.material, 'uTwinkleBoost', this.starTwinkleBoost);
        this.setMaterialUniformValue(this.starfield.material, 'uTunnelTint', this.getTunnelTintColor());
        this.setMaterialUniformValue(
            this.starfield.material,
            'uPixelRatio',
            this.renderer?.getPixelRatio?.() || 1,
        );

        if (this.starfieldCompute?.computeNode && this.renderer?.compute && this.isWebGPU) {
            const frameScale = Number.isFinite(delta) ? delta * 60 : 1;
            this.starfieldCompute.update({
                warpStep: this.currentSpeed * 10 * frameScale,
                delta,
                tunnelRadius: this.tunnelRadius,
                minRadius: 100,
                resetZ: 1000,
                spawnZ: -8000,
                time: this.time,
                nearBandCutoff: STAR_DEPTH_BANDS.nearCutoff,
                midBandCutoff: STAR_DEPTH_BANDS.midCutoff,
                nearRadiusMin: STAR_DEPTH_BANDS.near.radiusMin,
                midRadiusMin: STAR_DEPTH_BANDS.mid.radiusMin,
                farRadiusMin: STAR_DEPTH_BANDS.far.radiusMin,
                nearRadiusScale: STAR_DEPTH_BANDS.near.radiusScale,
                midRadiusScale: STAR_DEPTH_BANDS.mid.radiusScale,
                farRadiusScale: STAR_DEPTH_BANDS.far.radiusScale,
                nearZMin: STAR_DEPTH_BANDS.near.zMin,
                midZMin: STAR_DEPTH_BANDS.mid.zMin,
                farZMin: STAR_DEPTH_BANDS.far.zMin,
                nearZSpan: STAR_DEPTH_BANDS.near.zSpan,
                midZSpan: STAR_DEPTH_BANDS.mid.zSpan,
                farZSpan: STAR_DEPTH_BANDS.far.zSpan,
            });
            this.renderer.compute(this.starfieldCompute.computeNode);
            return;
        }

        // Move stars toward camera (warp effect)
        const offsetAttribute = this.starfield.geometry.getAttribute('aOffset');
        const positionAttribute = this.starfield.geometry.getAttribute('position');
        const activePositionAttribute = offsetAttribute || positionAttribute;
        if (!activePositionAttribute?.array) return;
        const positions = activePositionAttribute.array;
        const starCount = positions.length / 3;

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Move toward camera
            positions[i3 + 2] += this.currentSpeed * 10;

            // Reset if past camera
            if (positions[i3 + 2] > 1000) {
                const band = this.getStarDepthBandSample(this.tunnelRadius);
                const angle = this.rand() * Math.PI * 2;
                positions[i3] = Math.cos(angle) * band.radius;
                positions[i3 + 1] = Math.sin(angle) * band.radius;
                positions[i3 + 2] = band.z;
            }
        }

        activePositionAttribute.needsUpdate = true;
    }

    updateNebulas(delta) {
        const dt = Number.isFinite(delta) ? Math.max(0.001, delta) : 0.016;
        this.nebulaMeshes.forEach((mesh) => {
            this.setMaterialUniformValue(mesh.material, 'uTime', this.time);
            const driftSpeed = mesh.userData.driftSpeed ?? 1;
            const driftPhase = mesh.userData.driftPhase ?? 0;
            const baseY = mesh.userData.baseY ?? mesh.position.y;
            const baseOpacity = mesh.userData.baseOpacity ?? 0.25;
            const driftOffset = Math.sin(this.time * 0.08 * driftSpeed + driftPhase) * 160;
            mesh.position.y = baseY + driftOffset;

            const hazePulse = 0.9 + Math.sin(this.time * 0.11 + driftPhase) * 0.08;
            const reactiveBoost = 1.0 + Math.min(0.25, this.reactiveEnvelope.nebula * 0.2);
            this.setMaterialOpacity(
                mesh.material,
                'uOpacity',
                Math.min(0.9, Math.max(0.05, baseOpacity * hazePulse * reactiveBoost)),
            );

            const flowDir = mesh.userData.flowDir;
            const flowOffset = mesh.userData.flowOffset;
            const baseFlowSpeed = mesh.userData.flowSpeed ?? 0.045;
            const baseWarpAmount = mesh.userData.warpAmount ?? 0.22;
            const baseDetailScale = mesh.userData.detailScale ?? 2.8;
            const baseMorphRate = mesh.userData.morphRate ?? 0.36;
            const flowDrift = mesh.userData.flowDrift ?? 0.3;
            const flowPulse = mesh.userData.flowPulse ?? 0.15;

            if (flowDir?.isVector2 && flowOffset?.isVector2) {
                const flowBoost = 1.0 + Math.min(0.5, this.reactiveEnvelope.nebula * 0.22 + this.reactiveEnvelope.warp * 0.08);
                flowOffset.x += flowDir.x * dt * baseFlowSpeed * flowBoost;
                flowOffset.y += flowDir.y * dt * baseFlowSpeed * flowBoost;
                this.setMaterialUniformValue(mesh.material, 'uFlowOffset', flowOffset);
                this.setMaterialUniformValue(mesh.material, 'uFlowDir', flowDir);
                this.setMaterialUniformValue(
                    mesh.material,
                    'uFlowSpeed',
                    baseFlowSpeed * (1.0 + Math.sin(this.time * flowDrift + driftPhase) * flowPulse),
                );
                this.setMaterialUniformValue(
                    mesh.material,
                    'uWarpAmount',
                    baseWarpAmount * (1.0 + Math.min(0.45, this.reactiveEnvelope.nebula * 0.25)),
                );
                this.setMaterialUniformValue(
                    mesh.material,
                    'uDetailScale',
                    baseDetailScale * (0.96 + Math.sin(this.time * 0.12 + driftPhase) * 0.04),
                );
                this.setMaterialUniformValue(
                    mesh.material,
                    'uMorphRate',
                    baseMorphRate * (1.0 + Math.min(0.30, this.reactiveEnvelope.nebula * 0.2 + this.reactiveEnvelope.warp * 0.08)),
                );
            }

            const scalePhase = mesh.userData.scalePhase ?? 0;
            const scaleOscillation = mesh.userData.scaleOscillation ?? 0.06;
            const scaleWaveA = Math.sin(this.time * 0.22 * driftSpeed + scalePhase);
            const scaleWaveB = Math.cos(this.time * 0.17 * driftSpeed + scalePhase * 0.81);
            const reactiveScaleBoost = Math.min(0.06, this.reactiveEnvelope.nebula * 0.03);
            mesh.scale.x = (mesh.userData.baseScaleX ?? 1.0)
                * (1.0 + scaleWaveA * scaleOscillation + reactiveScaleBoost);
            mesh.scale.y = (mesh.userData.baseScaleY ?? 1.0)
                * (1.0 + scaleWaveB * (scaleOscillation * 0.75) + reactiveScaleBoost);

            const baseRotation = mesh.userData.baseRotation ?? mesh.rotation.z;
            const rotationDriftSpeed = mesh.userData.rotationDriftSpeed ?? 0.02;
            const rotationDriftAmplitude = mesh.userData.rotationDriftAmplitude ?? 0.08;
            mesh.rotation.z = baseRotation
                + Math.sin(this.time * rotationDriftSpeed + driftPhase) * rotationDriftAmplitude;
        });
        this.updateDustLanes(dt);
        this.updateGalaxyClusters(dt);
    }

    updateWarpCore(delta) {
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const pulseIntensity = Math.min(
            1.35,
            this.reactiveEnvelope.pulse
            + (choreography.corePulseBoost || 0) * 0.7
            + (choreography.reentryFlash || 0) * 0.45,
        );
        const warpRatio = THREE.MathUtils.clamp(
            Math.min(1, this.reactiveEnvelope.warp / Math.max(this.reactiveCaps.warp, 0.0001))
            + (choreography.warpRatioBoost || 0),
            0,
            1,
        );

        if (this.warpCore?.material) {
            this.setMaterialUniformValue(this.warpCore.material, 'uTime', this.time);
            this.setMaterialUniformValue(this.warpCore.material, 'uGlowIntensity', this.warpCoreGlowIntensity);
            this.setMaterialUniformValue(this.warpCore.material, 'uPulseBoost', pulseIntensity);
            const coreScale = 1.0
                + pulseIntensity * 0.06
                + (choreography.corePulseBoost || 0) * 0.03
                + (choreography.reentryFlash || 0) * 0.07;
            this.warpCore.scale.setScalar(coreScale);
        }

        // Rotate rings
        this.warpCoreRings.forEach((ring) => {
            this.setMaterialUniformValue(ring.material, 'uTime', this.time);
            const shimmer = 0.22
                + pulseIntensity * 0.16
                + (Math.sin(this.time * 2.1 + (ring.userData.shimmerPhase || 0)) * 0.5 + 0.5) * 0.20
                + (choreography.ringShimmerBoost || 0) * 0.22;
            this.setMaterialUniformValue(ring.material, 'uShimmer', shimmer);
            const reactiveRotation = 1.0 + warpRatio * 0.65 + (choreography.warpRatioBoost || 0) * 0.55;
            if (ring.userData.rotationAxis === 'x') {
                ring.rotation.x += ring.userData.rotationSpeed * 0.01 * reactiveRotation;
            } else {
                ring.rotation.y += ring.userData.rotationSpeed * 0.01 * reactiveRotation;
            }

            const baseOpacity = ring.userData.baseOpacity ?? 0.45;
            const ringOpacity = Math.min(
                0.52,
                baseOpacity
                * (0.72 + pulseIntensity * 0.10 + (choreography.routeGuidance || 0) * 0.07),
            );
            this.setMaterialOpacity(ring.material, 'uOpacity', ringOpacity);
        });

        if (this.warpAccretionDisc?.material) {
            this.setMaterialUniformValue(this.warpAccretionDisc.material, 'uTime', this.time * 1.3);
            this.setMaterialUniformValue(
                this.warpAccretionDisc.material,
                'uShimmer',
                0.34 + pulseIntensity * 0.22 + (choreography.ringShimmerBoost || 0) * 0.24,
            );
            this.warpAccretionDisc.rotation.z += (this.warpAccretionDisc.userData.rotationSpeed || 2.2)
                * 0.01
                * (1 + warpRatio * 0.7 + (choreography.warpRatioBoost || 0) * 0.4);
            const discOpacity = Math.min(
                0.42,
                (this.warpAccretionDisc.userData.baseOpacity || 0.52)
                * (0.66 + pulseIntensity * 0.10 + (choreography.corePulseBoost || 0) * 0.05 + (choreography.reentryFlash || 0) * 0.12),
            );
            this.setMaterialOpacity(this.warpAccretionDisc.material, 'uOpacity', discOpacity);
        }

        const smallGlowOpacity = 0.14
            + this.warpCoreGlowIntensity * 0.10
            + (choreography.reentryFlash || 0) * 0.10;
        const largeGlowOpacity = 0.08
            + this.warpCoreGlowIntensity * 0.08
            + (choreography.lensHaloBoost || 0) * 0.05;
        this.warpCoreGlowPlanes.forEach((glow, index) => {
            const targetOpacity = index === 0 ? smallGlowOpacity : largeGlowOpacity;
            this.setMaterialOpacity(glow.material, 'uOpacity', targetOpacity);
        });

        // Update core light intensity
        if (this.coreLight) {
            this.coreLight.intensity = 0.22
                + this.warpCoreGlowIntensity * 0.62
                + pulseIntensity * 0.16
                + (choreography.reentryFlash || 0) * 0.22;
        }

        this.updateRouteGuides(delta);
    }

    updateAsteroids(delta) {
        if (!this.asteroids.length) return;
        const stride = Math.max(1, this.runtimeBudgetControls?.asteroidStride || 1);
        if (stride > 1) {
            this.hotPathProfile.asteroidGateCounter += 1;
            const gateCounter = this.hotPathProfile.asteroidGateCounter % stride;
            if (gateCounter !== 0) return;
        }
        const frameScale = Number.isFinite(delta) ? delta * 60 : 1;
        const matrixScratch = this.asteroidMatrixScratch || new THREE.Object3D();
        this.asteroidMatrixScratch = matrixScratch;
        const warpRatio = Math.min(1, this.reactiveEnvelope.warp / Math.max(this.reactiveCaps.warp, 0.0001));
        const enhancementsEnabled = this.isEnhancementsEnabled();
        const tumbleBoost = enhancementsEnabled ? 1 + warpRatio * 0.35 : 1;
        const coreGlow = enhancementsEnabled
            ? Math.min(1.2, this.warpCoreGlowIntensity * 0.75 + warpRatio * 0.35)
            : 0;

        const coreGlowWritten = this.setMaterialUniformValue(this.asteroidMaterial, 'uCoreGlow', coreGlow);
        if (!coreGlowWritten && typeof this.asteroidMaterial?.emissiveIntensity === 'number') {
            this.asteroidMaterial.emissiveIntensity = 0.08 + coreGlow * 0.18;
        }

        this.asteroids.forEach((group) => {
            const {
                mesh,
                count,
                angles,
                radii,
                zPositions,
                scales,
                orbitSpeeds,
                rotations,
                rotationSpeeds,
            } = group;

            const orbitAttribute = mesh.geometry.getAttribute('aOrbitData');
            const orbitArray = orbitAttribute?.array;

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                const i4 = i * 4;

                angles[i] += orbitSpeeds[i] * frameScale;
                rotations[i3] += rotationSpeeds[i3] * frameScale * tumbleBoost;
                rotations[i3 + 1] += rotationSpeeds[i3 + 1] * frameScale * tumbleBoost;
                rotations[i3 + 2] += rotationSpeeds[i3 + 2] * frameScale * tumbleBoost;

                matrixScratch.position.set(
                    Math.cos(angles[i]) * radii[i],
                    Math.sin(angles[i]) * radii[i],
                    zPositions[i],
                );
                matrixScratch.rotation.set(
                    rotations[i3],
                    rotations[i3 + 1],
                    rotations[i3 + 2],
                );
                matrixScratch.scale.setScalar(scales[i]);
                matrixScratch.updateMatrix();
                mesh.setMatrixAt(i, matrixScratch.matrix);

                if (orbitArray) {
                    orbitArray[i4 + 1] = angles[i];
                }
            }

            mesh.instanceMatrix.needsUpdate = true;
            if (orbitAttribute) orbitAttribute.needsUpdate = true;
        });
    }

    updateBurstParticles(delta) {
        if (this.burstParticlePool?.userData?.computeBacked === true) {
            if (this.burstParticlePool.userData.cameraFacing === true && this.camera) {
                this.burstParticlePool.quaternion.copy(this.camera.quaternion);
            }
            if (this.burstCompute?.computeNode && this.renderer?.compute && this.isWebGPU) {
                this.burstCompute.update({
                    delta,
                    time: this.time,
                    damping: 0.986,
                    speedScale: 60,
                });
                this.burstCompute.dispatch(this.renderer, this.time);
            }
        }

        for (let i = this.burstParticles.length - 1; i >= 0; i--) {
            const burst = this.burstParticles[i];
            if (burst.userData.cameraFacing === true && this.camera) {
                burst.quaternion.copy(this.camera.quaternion);
            }
            const offsetAttribute = burst.geometry.getAttribute('aOffset');
            const positionAttribute = burst.geometry.getAttribute('position');
            const activePositionAttribute = offsetAttribute || positionAttribute;
            if (!activePositionAttribute?.array) {
                continue;
            }
            const positions = activePositionAttribute.array;

            for (let j = 0; j < burst.userData.velocities.length; j++) {
                const vel = burst.userData.velocities[j];
                positions[j * 3] += vel.x * delta * 60;
                positions[j * 3 + 1] += vel.y * delta * 60;
                positions[j * 3 + 2] += vel.z * delta * 60;
            }

            activePositionAttribute.needsUpdate = true;
            burst.userData.life -= delta;
            const alpha = burst.userData.life / burst.userData.maxLife;
            this.setMaterialOpacity(burst.material, 'uOpacity', alpha);
            if (typeof burst.material.opacity === 'number') {
                burst.material.opacity = alpha;
            }

            if (burst.userData.life <= 0) {
                this.scene.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.burstParticles.splice(i, 1);
            }
        }
    }

    updateShockwaveRings(delta) {
        for (let i = this.shockwaveRings.length - 1; i >= 0; i--) {
            const ring = this.shockwaveRings[i];

            ring.scale.x += ring.userData.speed * 5;
            ring.scale.y += ring.userData.speed * 5;
            ring.userData.life -= delta * 0.5;
            this.setMaterialOpacity(ring.material, 'uOpacity', ring.userData.life);
            if (typeof ring.material.opacity === 'number') {
                ring.material.opacity = ring.userData.life;
            }

            if (ring.userData.life <= 0) {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
                this.shockwaveRings.splice(i, 1);
            }
        }
    }

    updatePostProcessing() {
        const effectScale = this.getAdaptiveEffectScale();
        const effectMix = 0.42 + effectScale * 0.34;
        const useWebGPUPreset = this.isWebGPU === true;
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const preset = useWebGPUPreset ? this.getWebGPUPostPreset() : null;
        const bloomStrength = (useWebGPUPreset ? preset.bloomStrength : this.qualityPreset.bloomStrength) * effectMix
            + this.bloomPulseIntensity * 0.48
            + (choreography.bloomBoost || 0) * 0.16;
        const bloomRadius = useWebGPUPreset ? preset.bloomRadius : this.qualityPreset.bloomRadius;
        const bloomThreshold = this.postProcessing?.useMRT === true
            ? Math.max(0.05, useWebGPUPreset ? preset.bloomThreshold : 0.05)
            : useWebGPUPreset
                ? Math.max(preset.bloomThreshold, 0.7)
                : 0.7;
        const postBudget = this.performanceBudget?.maxPostCostMs ?? 0;
        const postOverBudgetRatio = postBudget > 0
            ? Math.max(0, (this.adaptiveScalerState?.postCostEmaMs ?? 0) - postBudget) / postBudget
            : 0;
        const postCostSuppression = THREE.MathUtils.clamp(postOverBudgetRatio * 0.45, 0, 0.5);
        const bloomStrengthCapped = THREE.MathUtils.clamp(
            bloomStrength * (1 - postCostSuppression),
            0,
            0.72,
        );
        const warpRatio = THREE.MathUtils.clamp(this.currentSpeed / Math.max(this.maxSpeed, 0.0001), 0, 1);
        const vignetteDarkness = THREE.MathUtils.clamp(
            0.34 + warpRatio * 0.38 + (choreography.tunnelCompression || 0) * 0.15,
            0.30,
            HYPERDRIVE_READABILITY_LIMITS.vignetteDarknessMax,
        );
        const vignetteOffset = THREE.MathUtils.clamp(
            1.12 - (choreography.fovNarrow || 0) * 0.08,
            0.98,
            1.12,
        );
        const chromaticSuppressed = this.runtimeBudgetControls?.suppressChromatic === true || postOverBudgetRatio > 0.12;
        const chromaticStrength = (this.qualityPreset.enableChromatic && !chromaticSuppressed)
            ? THREE.MathUtils.clamp(
                this.chromaticIntensity * effectMix + (choreography.chromaticBoost || 0) * 0.08,
                0,
                HYPERDRIVE_READABILITY_LIMITS.chromaticMax,
            )
            : 0;
        const exposure = THREE.MathUtils.clamp(0.95 + (choreography.reentryFlash || 0) * 0.03, 0.90, 1.00);
        const saturation = THREE.MathUtils.clamp(1.02 + (choreography.lensHaloBoost || 0) * 0.03, 0.98, 1.08);
        const tintStrength = THREE.MathUtils.clamp(
            0.07 + (choreography.routeGuidance || 0) * 0.03 + (choreography.lensHaloBoost || 0) * 0.02,
            0.04,
            0.14,
        );
        const ditherStrength = THREE.MathUtils.clamp(
            0.0014 + (choreography.bloomBoost || 0) * 0.0002,
            0.0010,
            0.0019,
        );

        if (this.postProcessing?.update) {
            const postParams = {
                bloomStrength: bloomStrengthCapped,
                bloomRadius,
                bloomThreshold,
                vignetteOffset,
                vignetteDarkness,
                chromaticStrength,
                exposure,
                contrast: 1.04,
                saturation,
                tintStrength,
                tintColor: this.getTunnelTintColor(),
                ditherStrength,
                warpSpeed: warpRatio,
                time: this.time,
            };
            if (useWebGPUPreset) {
                postParams.bloomDownsample = THREE.MathUtils.clamp(
                    preset.bloomDownsample - (1 - effectScale) * 0.16,
                    0.5,
                    0.92,
                );
            }
            this.postProcessing.update(postParams);
        }

        if (this.bloomPass) {
            this.bloomPass.strength = bloomStrengthCapped;
            this.bloomPass.radius = bloomRadius;
            this.bloomPass.threshold = bloomThreshold;
        }

        if (this.vignettePass) {
            this.vignettePass.uniforms.darkness.value = vignetteDarkness;
            this.vignettePass.uniforms.offset.value = vignetteOffset;
        }

        if (this.chromaticPass) {
            this.chromaticPass.uniforms.intensity.value = chromaticStrength;
        }
    }

    updateCamera(delta = 0) {
        const choreography = this.hyperdriveFrame || this.createIdleHyperdriveFrame();
        const warpShake = this.isEnhancementsEnabled()
            ? Math.max(0, (this.currentSpeed / Math.max(this.maxSpeed, 0.0001)) * 0.35) + (choreography.shakeBoost || 0)
            : 0;
        const shakeIntensity = (this.reactiveEnvelope.shake * 1.6 + warpShake)
            * (1 - (choreography.shakeDamping || 0) * 0.75);
        if (shakeIntensity > 0.01) {
            this.cameraShake.set(
                (this.rand() - 0.5) * shakeIntensity,
                (this.rand() - 0.5) * shakeIntensity,
                0,
            );
        } else {
            this.cameraShake.multiplyScalar(0.9);
        }

        if (this.camera) {
            // Smooth pointer tracking for subtle mouse parallax (additive on top of shake + choreography)
            this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 2.2);
            this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 2.2);
            const parallaxX = this.smoothedPointerX * 100.0;
            const parallaxY = -this.smoothedPointerY * 50.0;

            this.camera.position.x = this.cameraShake.x + (choreography.routeBiasX || 0) + parallaxX;
            this.camera.position.y = this.cameraShake.y + (choreography.routeBiasY || 0) + parallaxY;
            if (this.starfield?.userData?.cameraFacing === true) {
                this.starfield.quaternion.copy(this.camera.quaternion);
            }
        }
    }

    renderFrame() {
        const nowMs = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
        if (this.isWebGPU && this.postProcessing && this.capabilities.post) {
            const postStart = nowMs();
            this.postProcessing.render();
            const measuredPostCost = this.postProcessing.getLastRenderCostMs?.();
            this.lastPostCostMs = Number.isFinite(measuredPostCost) ? measuredPostCost : (nowMs() - postStart);
            this.lastRenderPath = 'webgpu-post';
            return;
        }

        if (this.isWebGL && this.composer && this.capabilities.post) {
            const postStart = nowMs();
            this.composer.render();
            this.lastPostCostMs = nowMs() - postStart;
            this.lastRenderPath = 'webgl-composer';
            return;
        }

        this.renderer.render(this.scene, this.camera);
        this.lastPostCostMs = 0;
        this.lastRenderPath = this.isWebGPU ? 'webgpu-direct' : 'webgl-direct';
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) return;

        const frameStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try {
            this.renderFrame();
            const frameEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.lastFrameCostMs = Math.max(0, frameEndMs - frameStartMs);
        } catch (error) {
            const usingPostPath = this.capabilities.post
                && ((this.isWebGPU && this.postProcessing) || (this.isWebGL && this.composer));

            if (usingPostPath) {
                console.warn('[StellarVelocity] Post render path failed, using direct render:', error);
                this.capabilities.post = false;
                this.flags.usePost = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
                try {
                    this.renderFrame();
                    const frameEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    this.lastFrameCostMs = Math.max(0, frameEndMs - frameStartMs);
                    return;
                } catch (directError) {
                    error = directError;
                }
            }

            if (this.isWebGPU) {
                void this.requestWebGLFallback('webgpu-render-failure', error);
            } else {
                console.error('[StellarVelocity] Render failed:', error);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────

    resize(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        if (width <= 0 || height <= 0) return;

        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        if (this.renderer) {
            this.renderer.setPixelRatio(this.getRendererPixelRatio());
            this.renderer.setSize(width, height);
            this.setMaterialUniformValue(this.starfield?.material, 'uPixelRatio', this.renderer.getPixelRatio());
        }

        if (this.postProcessing?.setSize) {
            this.postProcessing.setSize(width, height);
        }

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stop / Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        console.log('[StellarVelocity] stop() called');

        if (!this.isActive) return;

        this.clock.stop();
        this.cancelAnimationLoop();
        this.clearBaselinePlaybackTimers();
        this.clearThemeTimeouts();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.removeBaselineHelpers();
        this.stopHyperdriveSequence();
        this.starWarpBoost = 0;
        super.stop();
        console.log('[StellarVelocity] Stopped successfully');
    }

    cleanup() {
        console.log('[StellarVelocity] cleanup() called');

        this.stop();
        this.clearBaselinePlaybackTimers();
        this.clearThemeTimeouts();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });
        this.resetBaseline();
        this.clearBaselinePlaybackTimers();
        this.clock = new THREE.Clock();

        super.cleanup();
        console.log('[StellarVelocity] Cleaned up successfully');
    }

    update() {
        // Animation updates happen in animation loop
    }
}
