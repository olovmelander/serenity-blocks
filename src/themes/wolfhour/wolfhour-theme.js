/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ WOLFHOUR ✧
 *  A Three.js Mystical Mountain Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { readLockViewportOrigin } from '../../events/lock-origin.js';
import { normalizeQuality } from '../../utils/quality.js';
import { WOLFHOUR_TETROMINOS } from './wolfhour-tetrominos.js';

// Import shaders
import {
    VignetteShader,
    SilverTintShader,
    mountainVertexShader,
    mountainFragmentShader,
    starfieldVertexShader,
    starfieldFragmentShader,
    spiritVertexShader,
    spiritFragmentShader,
    burstVertexShader,
    burstFragmentShader,
    beamVertexShader,
    beamFragmentShader,
    riftVertexShader,
    riftFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    waveVertexShader,
    waveFragmentShader,
    meteorTrailVertexShader,
    meteorTrailFragmentShader,
    meteorHeadVertexShader,
    meteorHeadFragmentShader,
    // Meteor crash effect shaders
    debrisVertexShader,
    debrisFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
    dustCloudVertexShader,
    dustCloudFragmentShader,
    crashMeteorHeadVertexShader,
    crashMeteorHeadFragmentShader,
    crashMeteorTrailVertexShader,
    crashMeteorTrailFragmentShader,
    fogVertexShader,
    fogFragmentShader,
} from './wolfhour-shaders.js';
import * as WolfhourMaterialFactories from './wolfhour-materials.js';
import * as WolfhourComputeFactories from './wolfhour-compute.js';
import * as WolfhourPostFactories from './wolfhour-post.js';
import { createLunarHaloFallbackMaterial } from './wolfhour-fallback-materials.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Minimal: {
        starCount: 3200,
        mountainSegments: 28,
        nebulaResolution: 512,
        spiritCount: 0,
        spiritComputeCount: 0,
        ambientParticles: 0,
        enableBloom: false,
        enableNodePost: false,
        enableMRT: false,
        enableFilmGrain: false,
        enableCompute: false,
        computeStarTwinkle: false,
        computeSpirits: false,
        computeMeteorTrails: false,
        computeDebris: false,
        bloomStrength: 0,
        bloomDownsample: 0.58,
        debrisPerCrash: 40,
        meteorTrailSegments: 40,
        maxStarBursts: 5,
        maxCosmicRifts: 1,
        maxCelestialBeams: 0,
        maxMeteorCrashes: 0,
        starTwinkleSpeed: 0.5,
        enableDiffraction: false,
        enableGroundFog: false,
        enableVolumetricBeams: false,
        meteorAtmosphereGlow: 0.0,
        cameraShakeScale: 0.15,
    },
    Low: {
        starCount: 6500,
        mountainSegments: 52,
        nebulaResolution: 512,
        spiritCount: 3,
        spiritComputeCount: 0,
        ambientParticles: 0,
        enableBloom: false,
        enableNodePost: false,
        enableMRT: false,
        enableFilmGrain: false,
        enableCompute: false,
        computeStarTwinkle: false,
        computeSpirits: false,
        computeMeteorTrails: false,
        computeDebris: false,
        bloomStrength: 0,
        bloomDownsample: 0.58,
        debrisPerCrash: 40,
        meteorTrailSegments: 40,
        maxStarBursts: 8,
        maxCosmicRifts: 2,
        maxCelestialBeams: 0,
        maxMeteorCrashes: 0,
        starTwinkleSpeed: 0.7,
        enableDiffraction: false,
        enableGroundFog: false,
        enableVolumetricBeams: false,
        meteorAtmosphereGlow: 0.0,
        cameraShakeScale: 0.2,
    },
    Medium: {
        starCount: 14000,
        mountainSegments: 92,
        nebulaResolution: 1024,
        spiritCount: 8,
        spiritComputeCount: 24,
        ambientParticles: 600,
        enableBloom: true,
        enableNodePost: true,
        enableMRT: true,
        enableFilmGrain: false,
        enableCompute: true,
        computeStarTwinkle: false,
        computeSpirits: true,
        computeMeteorTrails: false,
        computeDebris: false,
        bloomStrength: 0.3,
        bloomDownsample: 0.58,
        debrisPerCrash: 72,
        meteorTrailSegments: 52,
        maxStarBursts: 14,
        maxCosmicRifts: 3,
        maxCelestialBeams: 2,
        maxMeteorCrashes: 0,
        starTwinkleSpeed: 1.0,
        enableDiffraction: true,
        enableGroundFog: true,
        enableVolumetricBeams: true,
        meteorAtmosphereGlow: 0.35,
        cameraShakeScale: 0.45,
    },
    High: {
        starCount: 26000,
        mountainSegments: 144,
        nebulaResolution: 1024,
        spiritCount: 15,
        spiritComputeCount: 48,
        ambientParticles: 1000,
        enableBloom: true,
        enableNodePost: true,
        enableMRT: true,
        enableFilmGrain: true,
        enableCompute: true,
        computeStarTwinkle: false,
        computeSpirits: true,
        computeMeteorTrails: false,
        computeDebris: false,
        bloomStrength: 0.5,
        bloomDownsample: 0.58,
        debrisPerCrash: 96,
        meteorTrailSegments: 56,
        maxStarBursts: 20,
        maxCosmicRifts: 4,
        maxCelestialBeams: 4,
        maxMeteorCrashes: 1,
        starTwinkleSpeed: 1.0,
        enableDiffraction: true,
        enableGroundFog: true,
        enableVolumetricBeams: true,
        meteorAtmosphereGlow: 0.5,
        cameraShakeScale: 0.6,
    },
    Ultra: {
        starCount: 38000,
        mountainSegments: 176,
        nebulaResolution: 2048,
        spiritCount: 25,
        spiritComputeCount: 72,
        ambientParticles: 1600,
        enableBloom: true,
        enableNodePost: true,
        enableMRT: true,
        enableFilmGrain: true,
        enableCompute: true,
        computeStarTwinkle: false,
        computeSpirits: true,
        computeMeteorTrails: false,
        computeDebris: false,
        bloomStrength: 0.6,
        bloomDownsample: 0.61,
        debrisPerCrash: 128,
        meteorTrailSegments: 60,
        maxStarBursts: 25,
        maxCosmicRifts: 5,
        maxCelestialBeams: 6,
        maxMeteorCrashes: 2,
        starTwinkleSpeed: 1.0,
        enableDiffraction: true,
        enableGroundFog: true,
        enableVolumetricBeams: true,
        meteorAtmosphereGlow: 0.65,
        cameraShakeScale: 0.8,
    },
    Extreme: {
        starCount: 52000,
        mountainSegments: 224,
        nebulaResolution: 2048,
        spiritCount: 80,
        spiritComputeCount: 96,
        ambientParticles: 3000,
        enableBloom: true,
        enableNodePost: true,
        enableMRT: true,
        enableFilmGrain: true,
        enableCompute: true,
        computeStarTwinkle: false,
        computeSpirits: true,
        computeMeteorTrails: false,
        computeDebris: false,
        bloomStrength: 0.8,
        bloomDownsample: 0.64,
        debrisPerCrash: 150,
        meteorTrailSegments: 64,
        maxStarBursts: 30,
        maxCosmicRifts: 6,
        maxCelestialBeams: 8,
        maxMeteorCrashes: 2,
        starTwinkleSpeed: 1.2,
        enableDiffraction: true,
        enableGroundFog: true,
        enableVolumetricBeams: true,
        meteorAtmosphereGlow: 0.8,
        cameraShakeScale: 1.0,
    },
};

const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

const QUALITY_BUDGETS = {
    Extreme: {
        targetFps: 60,
        maxDrawCalls: 46,
        maxTriangles: 2000000,
        maxPoints: 250000,
    },
    Ultra: {
        targetFps: 60,
        maxDrawCalls: 46,
        maxTriangles: 1500000,
        maxPoints: 150000,
    },
    High: {
        targetFps: 60,
        maxDrawCalls: 42,
        maxTriangles: 1000000,
        maxPoints: 100000,
    },
    Medium: {
        targetFps: 60,
        maxDrawCalls: 34,
        maxTriangles: 500000,
        maxPoints: 60000,
    },
    Low: {
        targetFps: 60,
        maxDrawCalls: 20,
        maxTriangles: 250000,
        maxPoints: 30000,
    },
    Minimal: {
        targetFps: 30,
        maxDrawCalls: 15,
        maxTriangles: 100000,
        maxPoints: 15000,
    },
};

const REACTIVE_BUDGET_CREDITS = Object.freeze({
    Minimal: 1,
    Low: 1,
    Medium: 2,
    High: 3,
    Ultra: 4,
    Extreme: 5,
});

const REACTIVE_TOKEN_COSTS = Object.freeze({
    starBurst: 1,
    beam: 1,
    rift: 1,
    wave: 1,
    meteor: 2,
    crash: 3,
});

const REACTIVE_TOKEN_EXPIRY_MS = Object.freeze({
    starBurst: 200,
    beam: 200,
    rift: 200,
    wave: 200,
    meteor: 900,
    crash: 900,
});

const MAX_LUNAR_REACTION_SLOTS = 6;
const LUNAR_REACTION_SLOTS_BY_QUALITY = Object.freeze({
    Minimal: 2,
    Low: 2,
    Medium: 3,
    High: 4,
    Ultra: 6,
    Extreme: 6,
});

const EFFECT_STATE_CAPS = Object.freeze({
    starBurstIntensity: 1.35,
    cosmicRiftIntensity: 1.2,
    celestialBeamIntensity: 1.0,
    mountainPulse: 1.4,
    mountainShockwave: 1.8,
    spiritSurge: 1.0,
    bloomBoost: 0.9,
    nebulaBoost: 0.7,
    nebulaColorShift: 1.0,
    nebulaDefinition: 1.25,
    ambientScatter: 1.0,
    ambientSwirl: 1.0,
    cameraShake: 0.9,
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Flags Pipeline
// ─────────────────────────────────────────────────────────────────────────────
function parseWolfhourFlags() {
    const defaults = {
        forceWebGL: false,
        noPost: false,
        noMRT: false,
        noCompute: false,
        noAdaptivePacing: false,
        noPrewarm: false,
        baseline: false,
        seed: null,
        fixedDtMs: null,
        playback: null,
        playbackLoops: 1,
    };

    if (typeof window === 'undefined') {
        return defaults;
    }

    const params = new URLSearchParams(window.location.search);
    const readBool = (...keys) => keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        if (value === null || value === '') return true;
        const normalized = value.toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes';
    });

    const readNumber = (...keys) => {
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (!params.has(key)) continue;
            const value = params.get(key);
            if (value === null || value === '') continue;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric;
        }
        return null;
    };

    const readString = (...keys) => {
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (!params.has(key)) continue;
            const value = params.get(key);
            if (value !== null && value !== '') return value;
        }
        return null;
    };

    const fixedDtMs = readNumber('wolfhourFixedDt', 'fixedDt');
    const seed = readNumber('wolfhourSeed', 'seed');
    const playbackLoops = readNumber('wolfhourPlaybackLoops', 'playbackLoops');

    return {
        forceWebGL: readBool('forceWebGL', 'wolfhourForceWebGL'),
        noPost: readBool('noPost', 'wolfhourNoPost'),
        noMRT: readBool('noMRT', 'wolfhourNoMRT'),
        noCompute: readBool('noCompute', 'wolfhourNoCompute'),
        noAdaptivePacing: readBool('wolfhourNoAdaptivePacing', 'noAdaptivePacing'),
        noPrewarm: readBool('wolfhourNoPrewarm', 'noPrewarm'),
        baseline: readBool('wolfhourBaseline', 'baseline'),
        seed: Number.isFinite(seed) ? seed : null,
        fixedDtMs: Number.isFinite(fixedDtMs) && fixedDtMs > 0 ? fixedDtMs : null,
        playback: readString('wolfhourPlayback', 'playback'),
        playbackLoops: Number.isFinite(playbackLoops) && playbackLoops > 0
            ? Math.floor(playbackLoops)
            : 1,
        usePost: false,
        useMRT: false,
        useCompute: false,
    };
}

function createSeededRandom(seed) {
    if (!Number.isFinite(seed)) return Math.random;
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state <= 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class WolfhourTheme extends BaseTheme {
    constructor() {
        super('wolfhour');

        this.flags = parseWolfhourFlags();
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;

        // Baseline sequence tracking
        this.baselineTimeouts = new Set();
        this.baselineSequenceStats = { sequence: null, loops: 0, startedAt: 0 };
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 3600;
        this.baselineTimestampFrame = 0;
        this.baselineTimestampResolvePending = false;
        this.baselineGpuTimings = { renderMs: null, computeMs: null };

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.clock = new THREE.Clock();

        // Scene elements
        this.mountains = [];
        this.mountainBaseFill = null;
        this.starfield = null;
        this.nebulaPlanes = [];
        this.moon = null;
        this.moonHalo = null;
        this.moonTexture = null;
        this.moonNodeData = null;
        this.moonHaloNodeData = null;
        this.groundFog = null;
        this.spirits = null;
        this.ambientParticles = null;
        this.bloomPass = null;
        this.silverTintPass = null;

        // Effect systems
        this.starBursts = [];
        this.cosmicRifts = [];
        this.celestialBeams = [];
        this.cosmicWaves = [];
        this.meteors = []; // Shooting star meteors
        this.lastMeteorTime = 0; // Time of last meteor spawn
        this.nextMeteorDelay = 4 + this.random() * 3; // 4-7 seconds
        this.meteorCrashes = []; // Dramatic meteor crash impacts
        this.effectPools = {
            starBurst: [],
            beam: [],
            rift: [],
            wave: [],
            meteor: [],
            crash: [],
        };
        this.geometryCache = {
            unitQuad: null,
            shockwavePlane: null,
            trailGeometry: null,
            crashTrailGeometry: null,
            waveGeometry: null,
        };
        this.reactiveQueue = [];
        this.reactiveMetrics = {
            queueMaxDepth: 0,
            tokensDropped: 0,
            poolMisses: 0,
            spawnDurationsMs: [],
        };
        this.reactiveTokenCosts = { ...REACTIVE_TOKEN_COSTS };
        this.reactiveBudgetCredits = { ...REACTIVE_BUDGET_CREDITS };
        this.reactiveTokenExpiryMs = { ...REACTIVE_TOKEN_EXPIRY_MS };
        this.meteorTrailBatchCompute = null;
        this.debrisBatchCompute = null;
        this.lunarReactions = Array.from(
            { length: MAX_LUNAR_REACTION_SLOTS },
            () => ({
                active: false,
                startTime: Number.NEGATIVE_INFINITY,
                duration: 1.1,
                strength: 0,
                combo: 0,
                serial: 0,
            }),
        );
        this.lunarReactionSerial = 0;
        this.lastReactiveOrigin = null;
        this.reactiveOriginsByPlayer = new Map();
        this.comboProgressByPlayer = new Map();
        this.reactiveOriginScratch = {
            raycaster: new THREE.Raycaster(),
            plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -100),
            ndc: new THREE.Vector2(),
            world: new THREE.Vector3(),
        };

        // Effect state (smooth decay)
        this.effectState = {
            starBurstIntensity: 0,
            cosmicRiftIntensity: 0,
            celestialBeamIntensity: 0,
            mountainPulse: 0,
            mountainShockwave: 0, // Vertex displacement
            spiritSurge: 0,
            bloomBoost: 0,
            nebulaBoost: 0,
            nebulaColorShift: 0,
            nebulaDefinition: 0,
            ambientScatter: 0,
            ambientSwirl: 0,
            cameraShake: 0,
        };
        this.effectStateCaps = { ...EFFECT_STATE_CAPS };

        // Animation
        this.time = 0;
        this.animationFrameId = null;
        this.eventUnsubscribers = [];

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;
        this.qualityChangeHandler = null;
        this.performancePolicyChangeHandler = null;
        this.qualityRebuildPending = false;
        this.runtimeRebuildInFlight = false;
        this.runtimeRebuildTimeouts = new Set();
        this.lastCameraFrustum = null;

        // Quality
        this.activeQualityLevel = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.performanceBudget = { ...QUALITY_BUDGETS.High };
        this.computeBudget = null;

        // Compute systems (WebGPU only)
        this.computeFactories = null;
        this.spiritCompute = null;
        this.starTwinkleCompute = null;
        this.ambientParticleCompute = null;
        this.computeFallbackPending = false;

        // Post-processing systems (WebGPU node post)
        this.postFactories = null;
        this.postProfile = null;

        // Renderer Capabilities
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            maxColorAttachments: 1,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
        };

        // Resize handler reference
        this.resizeHandler = null;

        console.log('[Wolfhour] Theme constructed');
    }

    getTetrominoConfig() {
        return WOLFHOUR_TETROMINOS;
    }

    random() {
        return this.randomFn();
    }

    getCurrentQualityLevel() {
        const policyTier = typeof window !== 'undefined'
            ? window.desktopPerformancePolicy?.qualityTier
            : null;
        if (policyTier) {
            return normalizeQuality(policyTier);
        }
        if (typeof window !== 'undefined' && window.settings) {
            if (window.settings.effectQuality) {
                return normalizeQuality(window.settings.effectQuality);
            }
            if (window.settings.graphicsQuality) {
                return normalizeQuality(window.settings.graphicsQuality);
            }
        }
        return 'High';
    }

    getBaselinePresetOrder() {
        return [...BASELINE_PRESET_ORDER];
    }

    resolvePerformanceBudget(quality) {
        const normalized = normalizeQuality(quality);
        return {
            ...(QUALITY_BUDGETS[normalized] || QUALITY_BUDGETS.High),
        };
    }

    applyQualityPreset(quality) {
        const normalized = normalizeQuality(quality);
        this.activeQualityLevel = normalized;
        this.qualityPreset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
        this.performanceBudget = this.resolvePerformanceBudget(normalized);
    }

    resetBaselineSamples() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineLastWallTimeMs = null;
        this.baselineTimestampFrame = 0;
        this.baselineTimestampResolvePending = false;
        this.baselineGpuTimings = { renderMs: null, computeMs: null };
        this.reactiveQueue.length = 0;
        this.reactiveMetrics.queueMaxDepth = 0;
        this.reactiveMetrics.tokensDropped = 0;
        this.reactiveMetrics.poolMisses = 0;
        this.reactiveMetrics.spawnDurationsMs = [];
    }

    trackBaselineFrame(wallDeltaSeconds) {
        if (!Number.isFinite(wallDeltaSeconds) || wallDeltaSeconds <= 0) return;

        const frameMs = wallDeltaSeconds * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }

        this.baselineRenderStats.push({
            calls: this.renderer?.info?.render?.drawCalls
                ?? this.renderer?.info?.render?.calls
                ?? 0,
            triangles: this.renderer?.info?.render?.triangles ?? 0,
            points: this.renderer?.info?.render?.points ?? 0,
            lines: this.renderer?.info?.render?.lines ?? 0,
            textures: this.renderer?.info?.memory?.textures ?? 0,
            geometries: this.renderer?.info?.memory?.geometries ?? 0,
        });
        if (this.baselineRenderStats.length > this.baselineMaxFrames) {
            this.baselineRenderStats.shift();
        }
    }

    resolveBaselineGpuTimestamps() {
        if (
            this.flags.baseline !== true
            || typeof this.renderer?.resolveTimestampsAsync !== 'function'
            || this.baselineTimestampResolvePending
        ) {
            return;
        }

        this.baselineTimestampFrame += 1;
        if (this.baselineTimestampFrame % 60 !== 0) return;
        this.baselineTimestampResolvePending = true;

        const renderQuery = this.renderer.resolveTimestampsAsync(THREE_WEBGPU.TimestampQuery.RENDER);
        const computeQuery = this.renderer.resolveTimestampsAsync(THREE_WEBGPU.TimestampQuery.COMPUTE);
        Promise.all([renderQuery, computeQuery])
            .then(([renderMs, computeMs]) => {
                if (Number.isFinite(renderMs)) this.baselineGpuTimings.renderMs = renderMs;
                if (Number.isFinite(computeMs)) this.baselineGpuTimings.computeMs = computeMs;
            })
            .catch((error) => {
                console.warn('[WolfhourBaseline] GPU timestamp resolve failed.', error);
            })
            .finally(() => {
                this.baselineTimestampResolvePending = false;
            });
    }

    estimateGpuMemoryMb(memoryInfo = this.renderer?.info?.memory) {
        if (!memoryInfo) return null;
        const textures = memoryInfo.textures ?? 0;
        const geometries = memoryInfo.geometries ?? 0;
        return Number((textures * 1.5 + geometries * 0.25).toFixed(1));
    }

    getRuntimeFeatureSnapshot() {
        return {
            usePost: this.flags.usePost === true,
            useMRT: this.flags.useMRT === true,
            useCompute: this.flags.useCompute === true,
            qualityAllowsCompute: this.qualityPreset.enableCompute === true,
            qualityAllowsPost: this.qualityPreset.enableNodePost === true,
            qualityAllowsMRT: this.qualityPreset.enableMRT === true,
            spirits: this.spiritCompute?.computeNode ? 'compute' : 'material',
            ambient: this.ambientParticleCompute?.computeNode ? 'compute' : 'off',
            starTwinkle: this.starTwinkleCompute?.computeNode ? 'compute' : 'material',
            meteorTrail: this.qualityPreset.computeMeteorTrails ? 'compute-capable' : 'cpu',
            debris: this.qualityPreset.computeDebris ? 'compute-capable' : 'shader',
            postProfile: this.postProfile?.profile || 'off',
            cameraShakeScale: this.qualityPreset.cameraShakeScale ?? 1,
            starCount: this.qualityPreset.starCount ?? 0,
            ambientParticles: this.qualityPreset.ambientParticles ?? 0,
        };
    }

    recordReactiveSpawnDuration(ms) {
        if (!Number.isFinite(ms)) return;
        const samples = this.reactiveMetrics.spawnDurationsMs;
        samples.push(ms);
        if (samples.length > 512) {
            samples.shift();
        }
    }

    getReactivePerformanceSnapshot() {
        const durations = this.reactiveMetrics.spawnDurationsMs;
        if (!durations.length) {
            return {
                queueMaxDepth: this.reactiveMetrics.queueMaxDepth,
                tokensDropped: this.reactiveMetrics.tokensDropped,
                poolMisses: this.reactiveMetrics.poolMisses,
                avgSpawnMs: 0,
                p95SpawnMs: 0,
            };
        }

        const sorted = [...durations].sort((a, b) => a - b);
        const avgSpawnMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
        const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
        return {
            queueMaxDepth: this.reactiveMetrics.queueMaxDepth,
            tokensDropped: this.reactiveMetrics.tokensDropped,
            poolMisses: this.reactiveMetrics.poolMisses,
            avgSpawnMs: Number(avgSpawnMs.toFixed(3)),
            p95SpawnMs: Number(sorted[p95Index].toFixed(3)),
        };
    }

    getBaselineReport() {
        if (!this.baselineFrames.length) return null;

        const sortedFrames = [...this.baselineFrames].sort((a, b) => a - b);
        const frameCount = sortedFrames.length;
        const percentile = (ratio) => {
            const index = Math.min(frameCount - 1, Math.floor(frameCount * ratio));
            return sortedFrames[index];
        };

        const avgFrameMs = this.baselineFrames.reduce((sum, value) => sum + value, 0) / frameCount;
        const p50FrameMs = percentile(0.50);
        const p95FrameMs = percentile(0.95);
        const p99FrameMs = percentile(0.99);

        const renderSamples = Math.max(1, this.baselineRenderStats.length);
        const totals = this.baselineRenderStats.reduce((acc, sample) => ({
            calls: acc.calls + sample.calls,
            triangles: acc.triangles + sample.triangles,
            points: acc.points + sample.points,
            lines: acc.lines + sample.lines,
            textures: acc.textures + sample.textures,
            geometries: acc.geometries + sample.geometries,
        }), {
            calls: 0,
            triangles: 0,
            points: 0,
            lines: 0,
            textures: 0,
            geometries: 0,
        });

        const peaks = this.baselineRenderStats.reduce((acc, sample) => ({
            calls: Math.max(acc.calls, sample.calls),
            triangles: Math.max(acc.triangles, sample.triangles),
            points: Math.max(acc.points, sample.points),
            lines: Math.max(acc.lines, sample.lines),
            textures: Math.max(acc.textures, sample.textures),
            geometries: Math.max(acc.geometries, sample.geometries),
        }), {
            calls: 0,
            triangles: 0,
            points: 0,
            lines: 0,
            textures: 0,
            geometries: 0,
        });

        const budget = this.performanceBudget || QUALITY_BUDGETS.High;
        const targetFps = budget.targetFps ?? 60;
        const avgFps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
        const minAvgFps = budget.minAvgFps ?? targetFps * 0.9;
        const maxP95FrameMs = budget.maxP95FrameMs ?? (1000 / targetFps) * 1.35;
        const budgetResult = {
            targetFps,
            minAvgFps,
            maxP95FrameMs,
            maxDrawCalls: budget.maxDrawCalls ?? null,
            maxTriangles: budget.maxTriangles ?? null,
            maxPoints: budget.maxPoints ?? null,
            avgFps,
            p95FrameMs,
            avgDrawCalls: totals.calls / renderSamples,
            avgTriangles: totals.triangles / renderSamples,
            avgPoints: totals.points / renderSamples,
            peakDrawCalls: peaks.calls,
            peakTriangles: peaks.triangles,
            peakPoints: peaks.points,
            pass: true,
        };

        if (Number.isFinite(budget.maxDrawCalls)) {
            budgetResult.pass = budgetResult.pass && peaks.calls <= budget.maxDrawCalls;
        }
        if (Number.isFinite(budget.maxTriangles)) {
            budgetResult.pass = budgetResult.pass && peaks.triangles <= budget.maxTriangles;
        }
        if (Number.isFinite(budget.maxPoints)) {
            budgetResult.pass = budgetResult.pass && peaks.points <= budget.maxPoints;
        }
        budgetResult.pass = budgetResult.pass
            && avgFps >= minAvgFps
            && p95FrameMs <= maxP95FrameMs;

        const memoryInfo = this.renderer?.info?.memory || {};
        const heapUsedMb = (typeof performance !== 'undefined' && performance.memory?.usedJSHeapSize)
            ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1))
            : null;

        return {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.activeQualityLevel,
            frameCount,
            avgFrameMs,
            avgFps,
            p50FrameMs,
            p95FrameMs,
            p99FrameMs,
            avgDrawCalls: totals.calls / renderSamples,
            avgTriangles: totals.triangles / renderSamples,
            avgPoints: totals.points / renderSamples,
            avgLines: totals.lines / renderSamples,
            peakDrawCalls: peaks.calls,
            peakTriangles: peaks.triangles,
            peakPoints: peaks.points,
            peakLines: peaks.lines,
            textures: memoryInfo.textures ?? null,
            geometries: memoryInfo.geometries ?? null,
            gpuMemoryEstimateMb: this.estimateGpuMemoryMb(memoryInfo),
            gpuTimings: { ...this.baselineGpuTimings },
            heapUsedMb,
            flags: {
                forceWebGL: this.flags.forceWebGL === true,
                noPost: this.flags.noPost === true,
                noMRT: this.flags.noMRT === true,
                noCompute: this.flags.noCompute === true,
                noAdaptivePacing: this.flags.noAdaptivePacing === true,
                noPrewarm: this.flags.noPrewarm === true,
                baseline: this.flags.baseline === true,
            },
            capabilities: { ...this.capabilities },
            runtimeFeatures: this.getRuntimeFeatureSnapshot(),
            reactivePerformance: this.getReactivePerformanceSnapshot(),
            computeBudget: this.computeBudget ? { ...this.computeBudget } : null,
            sequence: { ...this.baselineSequenceStats },
            budget: budgetResult,
            seed: this.flags.seed,
            fixedDtMs: this.flags.fixedDtMs,
            capturedAt: new Date().toISOString(),
        };
    }

    downloadBaselineReport(label = 'wolfhour-baseline') {
        const report = this.getBaselineReport();
        if (!report || typeof window === 'undefined' || typeof document === 'undefined') {
            return null;
        }

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        return report;
    }

    captureBaseline(label = 'wolfhour') {
        const canvas = this.renderer?.domElement;
        if (!canvas || typeof window === 'undefined' || typeof document === 'undefined') {
            return null;
        }

        const filename = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.png`;
        if (canvas.toBlob) {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = filename;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                URL.revokeObjectURL(url);
            });
        } else {
            const anchor = document.createElement('a');
            anchor.href = canvas.toDataURL('image/png');
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
        }

        return filename;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.wolfhourBaseline = {
            report: () => this.getBaselineReport(),
            downloadReport: (label) => this.downloadBaselineReport(label),
            capture: (label) => this.captureBaseline(label),
            reset: () => this.resetBaselineSamples(),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            getPresetOrder: () => this.getBaselinePresetOrder(),
            stop: () => this.clearBaselinePlaybackTimers(),
        };
        console.log(
            '[WolfhourBaseline] Helpers: window.wolfhourBaseline.capture(label), report(), '
            + 'downloadReport(label), reset(), play(sequence, options), getPresetOrder(), stop()',
        );
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.wolfhourBaseline) {
            delete window.wolfhourBaseline;
        }
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;

        if (this.renderer.outputColorSpace !== undefined) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        const postOwnsToneMapping = this.isWebGPU === true
            && this.flags.usePost === true
            && !!this.postProcessing;

        if (postOwnsToneMapping) {
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1.0;
            return;
        }

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    resolvePostProfile() {
        if (!this.postFactories?.getWolfhourPostProfile) {
            return { enabled: false, profile: 'off' };
        }
        return this.postFactories.getWolfhourPostProfile(this.getCurrentQualityLevel());
    }

    disablePostRuntime(stage, error) {
        console.warn(`[Wolfhour] Post-processing failure at ${stage}; disabling post stack.`, error);

        if (this.postProcessing) {
            try {
                this.postProcessing.dispose?.();
            } catch (disposeError) {
                console.warn('[Wolfhour] Post-processing dispose failed during runtime fallback:', disposeError);
            }
        }

        this.postProcessing = null;
        this.postProfile = null;
        this.flags.noPost = true;
        this.flags.usePost = false;
        this.configureRendererColorPipeline();
    }

    enforceMRTRuntimeCompatibility() {
        if (!this.isWebGPU) return;
        if (this.flags.useMRT !== true) return;
        // Wolfhour relies heavily on unlit node materials (MeshBasic/Points) that can
        // produce invalid dual-target pipelines on Chromium WebGPU when MRT is enabled.
        // Keep node post path active, but force single target to avoid pipeline failures.
        this.flags.useMRT = false;
    }

    shouldUseCompute() {
        return this.isWebGPU === true
            && this.flags.useCompute === true
            && this.qualityPreset.enableCompute === true
            && typeof this.renderer?.compute === 'function'
            && !!this.computeFactories;
    }

    shouldEnableStarTwinkleCompute() {
        const benchmarkGainMs = Number(this.computeBenchmark?.starTwinkleGainMs ?? 0);
        return this.shouldUseCompute()
            && this.qualityPreset.computeStarTwinkle === true
            && benchmarkGainMs > 0.5;
    }

    getComputeBoundsFromCamera() {
        if (!this.camera) {
            return {
                xMin: -1000,
                xMax: 1000,
                yMin: -700,
                yMax: 700,
                zMin: -2200,
                zMax: 350,
            };
        }

        return {
            xMin: this.camera.left - 180,
            xMax: this.camera.right + 180,
            yMin: this.camera.bottom - 240,
            yMax: this.camera.top + 260,
            zMin: -2200,
            zMax: 350,
        };
    }

    updateComputeBoundsFromCamera() {
        const bounds = this.getComputeBoundsFromCamera();
        this.spiritCompute?.setBounds?.(bounds);
        this.ambientParticleCompute?.setBounds?.(bounds);
    }

    setupComputeSystems() {
        this.disposeComputeSystems();
        this.computeBudget = this.computeFactories?.getWolfhourComputeBudget?.(this.getCurrentQualityLevel()) || null;
        this.flags.useCompute = this.flags.useCompute
            && this.qualityPreset.enableCompute === true
            && !!this.computeFactories;

        if (!this.shouldUseCompute()) return;

        this.updateComputeBoundsFromCamera();

        if (this.shouldEnableStarTwinkleCompute()) {
            try {
                this.starTwinkleCompute = new this.computeFactories.WolfhourStarTwinkleCompute(
                    this.qualityPreset.starCount,
                    () => this.random(),
                );
                this.starTwinkleCompute.createComputeNode();
            } catch (error) {
                console.warn('[Wolfhour] Star twinkle compute init failed; keeping material twinkle path.', error);
                this.starTwinkleCompute?.dispose?.();
                this.starTwinkleCompute = null;
            }
        }

        if (
            this.qualityPreset.computeMeteorTrails === true
            && this.computeFactories?.WolfhourMeteorTrailBatchCompute
        ) {
            try {
                this.meteorTrailBatchCompute = new this.computeFactories.WolfhourMeteorTrailBatchCompute(
                    10,
                    this.qualityPreset.meteorTrailSegments,
                );
                this.meteorTrailBatchCompute.createComputeNode();
            } catch (error) {
                console.warn('[Wolfhour] Meteor trail batch compute init failed; using CPU updates.', error);
                this.meteorTrailBatchCompute?.dispose?.();
                this.meteorTrailBatchCompute = null;
            }
        }

        if (
            this.qualityPreset.computeDebris === true
            && this.computeFactories?.WolfhourDebrisBatchCompute
        ) {
            try {
                this.debrisBatchCompute = new this.computeFactories.WolfhourDebrisBatchCompute(
                    this.qualityPreset.maxMeteorCrashes,
                    this.qualityPreset.debrisPerCrash,
                    () => this.random(),
                );
                this.debrisBatchCompute.createComputeNode();
            } catch (error) {
                console.warn('[Wolfhour] Debris batch compute init failed; using shader fallback.', error);
                this.debrisBatchCompute?.dispose?.();
                this.debrisBatchCompute = null;
            }
        }

        const hasComputeWork = this.starTwinkleCompute
            || this.meteorTrailBatchCompute
            || this.debrisBatchCompute;
        if (!hasComputeWork) {
            this.flags.useCompute = false;
        }
    }

    disposeComputeSystems() {
        if (this.starTwinkleCompute) {
            this.starTwinkleCompute.dispose?.();
            this.starTwinkleCompute = null;
        }
        if (this.spiritCompute) {
            this.spiritCompute.dispose?.();
            this.spiritCompute = null;
        }
        if (this.ambientParticleCompute) {
            this.ambientParticleCompute.dispose?.();
            this.ambientParticleCompute = null;
        }
        if (this.meteorTrailBatchCompute) {
            this.meteorTrailBatchCompute.dispose?.();
            this.meteorTrailBatchCompute = null;
        }
        if (this.debrisBatchCompute) {
            this.debrisBatchCompute.dispose?.();
            this.debrisBatchCompute = null;
        }

        this.meteors.forEach((meteor) => {
            if (meteor.userData) meteor.userData.trailSlot = -1;
        });
        this.meteorCrashes.forEach((crash) => {
            if (crash.userData) {
                crash.userData.trailSlot = -1;
                crash.userData.debrisSlot = -1;
            }
        });
    }

    requestComputeFallbackRebuild(stage, error) {
        if (this.computeFallbackPending) return;
        this.computeFallbackPending = true;

        console.warn(`[Wolfhour] Compute failure at ${stage}; rebuilding with compute disabled.`, error);
        this.flags.noCompute = true;
        this.flags.useCompute = false;
        this.disposeComputeSystems();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.scheduleRuntimeRebuild(() => {
            this.computeFallbackPending = false;
            this.rebuildRuntimeScene('computeFallback').catch((rebuildError) => {
                console.error('[Wolfhour] Compute fallback rebuild failed.', rebuildError);
            });
        }, 0);
    }

    scheduleRuntimeRebuild(callback, delayMs = 0) {
        if (typeof window === 'undefined') return null;

        const timeoutId = window.setTimeout(() => {
            this.runtimeRebuildTimeouts.delete(timeoutId);
            callback();
        }, delayMs);

        this.runtimeRebuildTimeouts.add(timeoutId);
        return timeoutId;
    }

    clearRuntimeRebuildTimers() {
        this.runtimeRebuildTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.runtimeRebuildTimeouts.clear();
    }

    updateComputeSystems(deltaTime) {
        if (!this.shouldUseCompute()) return;

        try {
            if (this.starTwinkleCompute?.computeNode) {
                this.starTwinkleCompute.update(deltaTime, {
                    twinkleScale: this.qualityPreset.starTwinkleSpeed || 1,
                });
                this.renderer.compute(this.starTwinkleCompute.computeNode);
            }

            if (this.spiritCompute?.computeNode) {
                this.spiritCompute.update(deltaTime, this.time, {
                    surge: this.effectState.spiritSurge,
                    scatter: this.effectState.ambientScatter * 0.35,
                });
                this.renderer.compute(this.spiritCompute.computeNode);
            }

            if (this.ambientParticleCompute?.computeNode) {
                this.ambientParticleCompute.update(deltaTime, this.time, {
                    scatter: this.effectState.ambientScatter,
                    swirl: this.effectState.ambientSwirl,
                });
                this.renderer.compute(this.ambientParticleCompute.computeNode);
            }
            if (this.meteorTrailBatchCompute?.computeNode && this.meteorTrailBatchCompute.hasActiveSlots?.()) {
                this.meteorTrailBatchCompute.update(deltaTime);
                this.renderer.compute(this.meteorTrailBatchCompute.computeNode);
            }
            if (this.debrisBatchCompute?.computeNode && this.debrisBatchCompute.hasActiveSlots?.()) {
                this.debrisBatchCompute.update(deltaTime, {
                    drag: 0.983,
                    gravity: -380.0,
                });
                this.renderer.compute(this.debrisBatchCompute.computeNode);
            }
        } catch (error) {
            this.requestComputeFallbackRebuild('updateComputeSystems', error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        console.log('[Wolfhour] Creating Three.js scene...');
        this.computeFallbackPending = false;

        // Filter benign Three.js warning: PointsNodeMaterial internally provides
        // point UVs via quad geometry, but the node compiler warns because the
        // original BufferGeometry has no "uv" attribute. This is a known Three.js
        // bug (PointUVNode hardcodes GLSL gl_PointCoord instead of using the
        // builder's backend-appropriate getBuiltin).
        if (!this._origConsoleWarn) {
            const origWarn = console.warn;
            this._origConsoleWarn = origWarn;
            this._filteredConsoleWarn = function filteredWolfhourWarn(...args) {
                if (typeof args[0] === 'string'
                    && args[0].includes('Vertex attribute "uv" not found on geometry')) return;
                origWarn.apply(console, args);
            };
            console.warn = this._filteredConsoleWarn;
        }

        const previousFlags = { ...this.flags };
        const parsedFlags = parseWolfhourFlags();
        this.flags = { ...previousFlags, ...parsedFlags };
        this.flags.forceWebGL = previousFlags.forceWebGL === true || parsedFlags.forceWebGL === true;
        this.flags.noPost = previousFlags.noPost === true || parsedFlags.noPost === true;
        this.flags.noMRT = previousFlags.noMRT === true || parsedFlags.noMRT === true;
        this.flags.noCompute = previousFlags.noCompute === true || parsedFlags.noCompute === true;
        this.flags.noAdaptivePacing = previousFlags.noAdaptivePacing === true || parsedFlags.noAdaptivePacing === true;
        this.flags.noPrewarm = previousFlags.noPrewarm === true || parsedFlags.noPrewarm === true;
        if (!this.flags.playback && previousFlags.playback) {
            this.flags.playback = previousFlags.playback;
        }
        if (!Number.isFinite(this.flags.playbackLoops) || this.flags.playbackLoops <= 0) {
            this.flags.playbackLoops = Number.isFinite(previousFlags.playbackLoops) && previousFlags.playbackLoops > 0
                ? Math.floor(previousFlags.playbackLoops)
                : 1;
        }
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
        this.resetBaselineSamples();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('wolfhour-theme');
        if (!container) {
            console.error('[Wolfhour] Container not found');
            return;
        }
        this.container = container;

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;

        this.materialFactories = null;
        this.computeFactories = null;
        this.postFactories = null;
        this.postProfile = null;

        // WebGPU path: dynamically import node material factories + compute module
        if (this.isWebGPU) {
            this.materialFactories = WolfhourMaterialFactories;
            console.log('[Wolfhour] TSL node material factories loaded');

            if (this.materialFactories) {
                this.computeFactories = WolfhourComputeFactories;
            } else {
                this.computeFactories = null;
                this.flags.noCompute = true;
            }

            this.postFactories = WolfhourPostFactories;
        }

        this.setupComputeSystems();
        this.enforceMRTRuntimeCompatibility();

        this.createStarfield();
        this.createNebulaBackdrop();
        this.createMoonHero();
        this.createMountains();
        this.createGroundFog();
        this.setupPostProcessing();
        this.configureRendererColorPipeline();
        this.setupReactivePools();
        this.runReactivePrewarm();
        this.setupEventListeners();
        this.setupQualityListener();
        this.startAnimation();

        if (this.flags.baseline) {
            this.installBaselineHelpers();
            console.log('[WolfhourBaseline] Baseline mode enabled', {
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                quality,
                seed: this.flags.seed,
                fixedDtMs: this.flags.fixedDtMs,
                playback: this.flags.playback,
                playbackLoops: this.flags.playbackLoops,
                budget: this.performanceBudget,
            });
        }
        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, {
                loops: this.flags.playbackLoops,
            });
        }

        const materialMode = this.isWebGPU && this.materialFactories ? 'node' : 'legacy';
        const computeEnabled = this.shouldUseCompute();
        console.log('[Wolfhour] Scene created', {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            materialMode,
            compute: computeEnabled,
            post: this.flags.usePost,
            mrt: this.flags.useMRT,
            performanceBudget: this.performanceBudget,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;
        let selectedRenderer = null;

        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            maxColorAttachments: 1,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
        };

        const useWebGPU = !this.flags.forceWebGL && navigator.gpu;

        if (useWebGPU) {
            try {
                const renderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    powerPreference: 'high-performance',
                    preserveDrawingBuffer: this.flags.baseline === true,
                    trackTimestamp: this.flags.baseline === true,
                });

                await this.initializeRendererCandidate(renderer, {
                    label: 'Wolfhour WebGPU renderer init',
                    ownerGeneration,
                });

                if (renderer.backend && renderer.backend.isWebGPUBackend) {
                    selectedRenderer = renderer;
                    this.isWebGPU = true;

                    this.capabilities.webgpu = true;
                    this.capabilities.supportsPost = true;
                    this.capabilities.maxColorAttachments = 8;
                    this.capabilities.supportsMRT = true;
                    this.capabilities.supportsCompute = typeof renderer.compute === 'function';

                    console.log('[Wolfhour] WebGPU backend initialized successfully');
                } else {
                    console.log('[Wolfhour] WebGPU backend not acquired, falling back to WebGL');
                    if (renderer.dispose) renderer.dispose();
                    renderer.forceContextLoss?.();
                    renderer.domElement?.remove?.();
                }
            } catch (err) {
                if (!ownsLifecycle()) return false;
                console.warn('[Wolfhour] WebGPU initialization failed:', err);
            }
        }

        if (!selectedRenderer) {
            if (!ownsLifecycle()) return false;
            console.log('[Wolfhour] Initializing WebGL fallback renderer');
            selectedRenderer = new THREE.WebGLRenderer({
                antialias: this.getAntialiasEnabled(),
                alpha: false,
                powerPreference: 'high-performance',
                preserveDrawingBuffer: this.flags.baseline === true,
            });
            this.isWebGL = true;
            this.capabilities.webgl = true;
            this.capabilities.maxColorAttachments = 1;
            this.capabilities.supportsPost = true; // via EffectComposer
            this.capabilities.supportsMRT = false;
            this.capabilities.supportsCompute = false;
        }

        if (!ownsLifecycle()) {
            this.disposeRenderer(selectedRenderer, { nullInstance: false });
            return false;
        }
        this.renderer = selectedRenderer;
        // Apply policy flags
        this.flags.usePost = this.capabilities.supportsPost
            && !this.flags.noPost
            && this.qualityPreset.enableNodePost !== false;
        this.flags.useMRT = this.capabilities.supportsMRT
            && !this.flags.noMRT
            && this.qualityPreset.enableMRT !== false;
        this.flags.useCompute = this.capabilities.supportsCompute
            && !this.flags.noCompute
            && this.qualityPreset.enableCompute === true;

        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // Setup Device-Loss handling
        if (this.isWebGPU && this.renderer.backend && this.renderer.backend.device) {
            const rendererAtRegistration = this.renderer;
            const ownerGenerationAtRegistration = ownerGeneration;
            rendererAtRegistration.onDeviceLost = (info) => {
                if (ownerGenerationAtRegistration !== this.lifecycleGeneration
                    || !this.isActive
                    || this.cleanupComplete
                    || this.renderer !== rendererAtRegistration) return;
                this.handleDeviceLost(info, rendererAtRegistration);
            };
        }
        const rendererAtRegistration = this.renderer;
        const ownerGenerationAtRegistration = ownerGeneration;
        this.webglContextLostHandler = (e) => {
            e.preventDefault();
            if (ownerGenerationAtRegistration !== this.lifecycleGeneration
                || !this.isActive
                || this.cleanupComplete
                || this.renderer !== rendererAtRegistration) return;
            this.handleDeviceLost(e, rendererAtRegistration);
        };
        this.renderer.domElement.addEventListener('webglcontextlost', this.webglContextLostHandler);

        // Orthographic camera for 2D-style layered scene
        const aspect = width / height;
        const frustumSize = 1000;
        this.camera = new THREE.OrthographicCamera(
            (frustumSize * aspect) / -2,
            (frustumSize * aspect) / 2,
            frustumSize / 2,
            frustumSize / -2,
            0.1,
            10000,
        );
        this.camera.position.set(0, 0, 1000);
        this.camera.lookAt(0, 0, 0);

        // Setup resize handler
        this.resizeHandler = () => this.handleResize();
        window.addEventListener('resize', this.resizeHandler);

        this.configureRendererColorPipeline();

        console.log(`[Wolfhour] Renderer initialized (WebGPU: ${this.isWebGPU}, WebGL: ${this.isWebGL})`);
        return true;
    }

    handleDeviceLost(info, rendererAtLoss = this.renderer) {
        if (!this.isActive || this.renderer !== rendererAtLoss) return;
        console.error('[Wolfhour] Device lost detected!', info);

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.flags.forceWebGL = true;
        this.flags.noMRT = true;
        this.flags.noCompute = true;
        this.flags.useCompute = false;
        this.disposeComputeSystems();

        this.scheduleRuntimeRebuild(() => {
            if (!this.isActive || this.renderer !== rendererAtLoss) return;
            console.log('[Wolfhour] Rebuilding scene on fallback renderer after device loss...');
            this.rebuildRuntimeScene('deviceLoss').catch((rebuildError) => {
                console.error('[Wolfhour] Device-loss fallback rebuild failed.', rebuildError);
            });
        }, 1000);
    }

    updateNodePixelRatio(nodeData, pixelRatio) {
        if (nodeData?.uniforms?.uPixelRatio && typeof nodeData.uniforms.uPixelRatio.value === 'number') {
            nodeData.uniforms.uPixelRatio.value = pixelRatio;
        }
    }

    updatePixelRatioUniforms(pixelRatio) {
        const withPool = (active, pooled) => [...active, ...(pooled || [])];

        this.updateNodePixelRatio(this.starfieldNodeData, pixelRatio);
        this.updateNodePixelRatio(this.spiritNodeData, pixelRatio);
        this.updateNodePixelRatio(this.ambientParticles?.userData?.nodeData, pixelRatio);
        this.updateNodePixelRatio(this.groundFog?.userData?.nodeData, pixelRatio);

        this.nebulaPlanes.forEach((nebula) => this.updateNodePixelRatio(nebula?.userData?.nodeData, pixelRatio));
        this.mountains.forEach((mountain) => this.updateNodePixelRatio(mountain?.userData?.nodeData, pixelRatio));
        withPool(this.starBursts, this.effectPools.starBurst)
            .forEach((burst) => this.updateNodePixelRatio(burst?.userData?.nodeData, pixelRatio));
        withPool(this.celestialBeams, this.effectPools.beam)
            .forEach((beam) => this.updateNodePixelRatio(beam?.userData?.nodeData, pixelRatio));
        withPool(this.cosmicRifts, this.effectPools.rift)
            .forEach((rift) => this.updateNodePixelRatio(rift?.userData?.nodeData, pixelRatio));
        withPool(this.cosmicWaves, this.effectPools.wave)
            .forEach((wave) => this.updateNodePixelRatio(wave?.userData?.nodeData, pixelRatio));

        withPool(this.meteors, this.effectPools.meteor).forEach((meteor) => {
            this.updateNodePixelRatio(meteor?.userData?.trailNodeData, pixelRatio);
            this.updateNodePixelRatio(meteor?.userData?.headNodeData, pixelRatio);
        });
        withPool(this.meteorCrashes, this.effectPools.crash).forEach((crash) => {
            this.updateNodePixelRatio(crash?.userData?.trailNodeData, pixelRatio);
            this.updateNodePixelRatio(crash?.userData?.headNodeData, pixelRatio);
            this.updateNodePixelRatio(crash?.userData?.debrisNodeData, pixelRatio);
            this.updateNodePixelRatio(crash?.userData?.dustNodeData, pixelRatio);
            this.updateNodePixelRatio(crash?.userData?.shockwaveNodeData, pixelRatio);
        });

        if (!this.scene) return;
        this.scene.traverse((object) => {
            const material = object?.material;
            if (!material) return;
            const materials = Array.isArray(material) ? material : [material];
            materials.forEach((entry) => {
                if (entry?.uniforms?.uPixelRatio && typeof entry.uniforms.uPixelRatio.value === 'number') {
                    entry.uniforms.uPixelRatio.value = pixelRatio;
                }
            });
        });
    }

    handleResize() {
        if (!this.camera || !this.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspect = width / height;
        const frustumSize = 1000;

        this.camera.left = (frustumSize * aspect) / -2;
        this.camera.right = (frustumSize * aspect) / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();
        this.lastCameraFrustum = {
            left: this.camera.left,
            right: this.camera.right,
            top: this.camera.top,
            bottom: this.camera.bottom,
        };

        const heroX = THREE.MathUtils.clamp(this.camera.right * 0.43, 300, 410);
        if (this.moon) this.moon.position.x = heroX;
        if (this.moonHalo) {
            this.moonHalo.position.x = heroX;
            this.moonHalo.updateMatrix();
        }

        const pixelRatio = this.getEffectivePixelRatio();
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height);
        this.updatePixelRatioUniforms(pixelRatio);
        if (this.postProcessing && this.postProcessing.setSize) {
            this.postProcessing.setSize(width, height);
        }
        if (this.composer) {
            this.composer.setSize(width, height);
        }

        if (this.shouldUseCompute()) {
            this.updateComputeBoundsFromCamera();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GPU-Driven Starfield
    // ─────────────────────────────────────────────────────────────────────────

    createStarfieldGeometry() {
        const count = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinkleData = new Float32Array(count * 2);
        const brightness = new Float32Array(count);

        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xe0e0ff), // Cool white
            new THREE.Color(0xd0d0e0), // Silver
            new THREE.Color(0xc0c0d0), // Dim silver
            new THREE.Color(0xf0f0ff), // Blue-white
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const theta = this.random() * Math.PI * 2;
            const phi = Math.acos(2 * this.random() - 1);

            // 3 depth layers: Z = -1000 to -4500
            const layerRand = this.random();
            let radius;
            if (layerRand < 0.33) {
                radius = 1200 + this.random() * 300;
            } else if (layerRand < 0.66) {
                radius = 2500 + this.random() * 500;
            } else {
                radius = 3500 + this.random() * 1000;
            }

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.6;
            positions[i3 + 2] = -Math.abs(radius * Math.cos(phi)) - 1700;

            const color = starColors[Math.floor(this.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 20 + this.random() * 40;
            twinkleData[i2] = this.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 1.0 + this.random() * 2.5;
            brightness[i] = 0.3 + this.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        return geometry;
    }

    /**
     * Converts a points geometry into an InstancedMesh using a quad for WebGPU compatibility.
     * WebGPU doesn't support variable point sizes for Points, so we use billboarding on InstancedMesh.
     */
    _createInstancedParticleMesh(pointsGeometry, material) {
        if (!this.isWebGPU) {
            return new THREE.Points(pointsGeometry, material);
        }

        const count = pointsGeometry.attributes.position.count;
        const quad = new THREE.PlaneGeometry(1, 1);
        const instancedMesh = new THREE.InstancedMesh(quad, material, count);

        // Translation-only instances: fill the matrices directly. This avoids tens of
        // thousands of Object3D.updateMatrix()/setMatrixAt() calls for the starfield.
        const posAttr = pointsGeometry.attributes.position;
        const matrices = instancedMesh.instanceMatrix.array;
        for (let i = 0; i < count; i++) {
            const offset = i * 16;
            matrices[offset] = 1;
            matrices[offset + 5] = 1;
            matrices[offset + 10] = 1;
            matrices[offset + 12] = posAttr.getX(i);
            matrices[offset + 13] = posAttr.getY(i);
            matrices[offset + 14] = posAttr.getZ(i);
            matrices[offset + 15] = 1;
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
        instancedMesh.userData.sourcePositions = posAttr.array;
        instancedMesh.frustumCulled = false;
        instancedMesh.updateMatrix();
        instancedMesh.matrixAutoUpdate = false;

        // Copy all other explicit attributes as InstancedBufferAttributes
        for (const key in pointsGeometry.attributes) {
            if (key !== 'position') {
                const attr = pointsGeometry.attributes[key];
                instancedMesh.geometry.setAttribute(key, new THREE.InstancedBufferAttribute(attr.array, attr.itemSize, attr.normalized));
            }
        }

        return instancedMesh;
    }

    getParticlePositionArray(particleObject) {
        if (particleObject?.isInstancedMesh && particleObject.userData?.sourcePositions) {
            return particleObject.userData.sourcePositions;
        }
        return particleObject?.geometry?.attributes?.position?.array || null;
    }

    syncInstancedParticlePositions(particleObject) {
        if (!particleObject?.isInstancedMesh) {
            if (particleObject?.geometry?.attributes?.position) {
                particleObject.geometry.attributes.position.needsUpdate = true;
            }
            return;
        }

        const positions = particleObject.userData?.sourcePositions;
        if (!positions) return;
        const matrices = particleObject.instanceMatrix.array;
        const count = Math.min(particleObject.count, Math.floor(positions.length / 3));
        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const i16 = i * 16;
            matrices[i16 + 12] = positions[i3];
            matrices[i16 + 13] = positions[i3 + 1];
            matrices[i16 + 14] = positions[i3 + 2];
        }
        particleObject.instanceMatrix.needsUpdate = true;
    }

    createStarfield() {
        const geometry = this.createStarfieldGeometry();

        if (this.isWebGPU && this.materialFactories) {
            const result = this.materialFactories.createStarfieldNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                enableDiffraction: this.qualityPreset.enableDiffraction === true,
                diffractionStrength: this.qualityPreset.enableDiffraction ? 0.18 : 0.0,
                depthGlowStrength: this.qualityPreset.enableDiffraction ? 0.95 : 0.55,
            });
            this.starfieldNodeData = result;
            this.starfield = this._createInstancedParticleMesh(geometry, result.material);
        } else {
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uEventBoost: { value: 0 },
                },
                vertexShader: starfieldVertexShader,
                fragmentShader: starfieldFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                vertexColors: true,
            });
            this.starfield = new THREE.Points(geometry, material);
        }

        this.starfield.renderOrder = 1000;
        this.scene.add(this.starfield);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Silver Nebula Backdrop
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaBackdrop() {
        const textureLoader = new THREE.TextureLoader();
        // Correct path for Vite public folder
        const texturePath = './textures/wolfhour/';

        const textures = [
            textureLoader.load(`${texturePath}nebula-silver-1.png`),
            textureLoader.load(`${texturePath}nebula-silver-2.png`),
            textureLoader.load(`${texturePath}nebula-silver-3.png`),
        ];

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Layer configs for parallax - LARGE sizes to fill screen completely
        const nebulaConfigs = [
            // Near layer (Z -2000)
            {
                texture: textures[0],
                x: 0,
                y: 150,
                z: -2000,
                size: 4000,
                speed: 8,
                opacity: 0.25,
            },
            // Mid layer (Z -3000)
            {
                texture: textures[1],
                x: 0,
                y: 100,
                z: -3000,
                size: 5000,
                speed: 5,
                opacity: 0.2,
            },
            // Far layer (Z -4000)
            {
                texture: textures[2],
                x: 0,
                y: 200,
                z: -4000,
                size: 6000,
                speed: 3,
                opacity: 0.15,
            },
        ];

        this.nebulaPlanes = [];

        nebulaConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.6);

            let material;
            let nodeData = null;
            if (this.isWebGPU && this.materialFactories) {
                const result = this.materialFactories.createNebulaNodeMaterial({
                    texture: config.texture,
                    opacity: config.opacity,
                });
                material = result.material;
                nodeData = result;
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        tDiffuse: { value: config.texture },
                        uOpacity: { value: config.opacity },
                        uPulse: { value: 0 },
                    },
                    vertexShader: nebulaVertexShader,
                    fragmentShader: nebulaFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(config.x, config.y, config.z);
            mesh.renderOrder = -2000 - index;

            mesh.userData.speed = config.speed;
            mesh.userData.startX = config.x;
            mesh.userData.wrapBoundary = config.size * 1.5;
            mesh.userData.texture = config.texture;
            if (nodeData) mesh.userData.nodeData = nodeData;

            this.nebulaPlanes.push(mesh);
            this.scene.add(mesh);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FBM Mountain System
    // ─────────────────────────────────────────────────────────────────────────

    createMoonHero() {
        const textureLoader = new THREE.TextureLoader();
        const moonTexture = textureLoader.load('./textures/2k_moon.jpg');
        moonTexture.colorSpace = THREE.SRGBColorSpace;
        moonTexture.anisotropy = Math.min(8, this.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
        this.moonTexture = moonTexture;

        let moonMaterial;
        let haloMaterial;
        let moonNodeData = null;
        let haloNodeData = null;

        if (
            this.isWebGPU
            && this.materialFactories?.createMoonNodeMaterial
            && this.materialFactories?.createLunarHaloNodeMaterial
        ) {
            moonNodeData = this.materialFactories.createMoonNodeMaterial({ texture: moonTexture });
            haloNodeData = this.materialFactories.createLunarHaloNodeMaterial({
                maxPulses: this.getLunarReactionSlotCapacity(),
            });
            moonMaterial = moonNodeData.material;
            haloMaterial = haloNodeData.material;
        } else {
            moonMaterial = new THREE.MeshBasicMaterial({
                map: moonTexture,
                color: new THREE.Color(0xb8c6e2),
            });
            haloMaterial = createLunarHaloFallbackMaterial(THREE);
        }

        const segments = ['Minimal', 'Low'].includes(this.activeQualityLevel) ? 32 : 48;
        const moon = new THREE.Mesh(
            new THREE.SphereGeometry(225, segments, Math.max(20, Math.floor(segments * 0.58))),
            moonMaterial,
        );
        const heroX = THREE.MathUtils.clamp((this.camera?.right || 900) * 0.43, 300, 410);
        moon.position.set(heroX, 175, -1620);
        moon.rotation.y = -0.34;
        moon.renderOrder = -1610;
        moon.frustumCulled = false;
        if (moonNodeData) moon.userData.nodeData = moonNodeData;

        const halo = new THREE.Mesh(new THREE.PlaneGeometry(1180, 1180), haloMaterial);
        halo.position.set(heroX, 175, -1655);
        halo.renderOrder = -1645;
        halo.frustumCulled = false;
        halo.updateMatrix();
        halo.matrixAutoUpdate = false;
        if (haloNodeData) halo.userData.nodeData = haloNodeData;

        this.moon = moon;
        this.moonHalo = halo;
        this.moonNodeData = moonNodeData;
        this.moonHaloNodeData = haloNodeData;
        this.scene.add(halo, moon);
    }

    createMountains() {
        // Mountain range with 8 peaks - atmospheric depth via layer value and position
        // Lower layer = closer/darker, higher layer = further/hazier
        const configs = [
            // === FOREGROUND LAYER (Z -400 to -700) - Darkest ===
            // Main dramatic center peak
            {
                x: 0,
                z: -500,
                size: 4000,
                height: 520,
                layer: 0.0,
                seed: 11111,
                peakRadius: 0.45,
                coverageRadius: 0.86,
                frontCoverageBias: 0.32,
                skirtFloor: -120,
                skirtNoiseStrength: 0.16,
            },
            // Right side mid peak
            {
                x: 650,
                z: -550,
                size: 3200,
                height: 380,
                layer: 0.1,
                seed: 44444,
                peakRadius: 0.44,
                coverageRadius: 0.84,
                frontCoverageBias: 0.3,
                skirtFloor: -110,
                skirtNoiseStrength: 0.15,
            },
            // Left side mid peak
            {
                x: -750,
                z: -650,
                size: 3200,
                height: 380,
                layer: 0.15,
                seed: 55555,
                peakRadius: 0.44,
                coverageRadius: 0.84,
                frontCoverageBias: 0.3,
                skirtFloor: -110,
                skirtNoiseStrength: 0.15,
            },

            // === MID LAYER (Z -800 to -1200) - Medium gray ===
            // Far left peak
            {
                x: -1100,
                z: -950,
                size: 3600,
                height: 450,
                layer: 0.4,
                seed: 66666,
                peakRadius: 0.45,
                coverageRadius: 0.79,
                frontCoverageBias: 0.22,
                skirtFloor: -150,
                skirtNoiseStrength: 0.1,
            },
            // Far right peak
            {
                x: 1000,
                z: -1000,
                size: 3600,
                height: 420,
                layer: 0.45,
                seed: 77777,
                peakRadius: 0.45,
                coverageRadius: 0.79,
                frontCoverageBias: 0.22,
                skirtFloor: -145,
                skirtNoiseStrength: 0.1,
            },

            // === BACKGROUND LAYER (Z -1200 to -1600) - Lightest/haziest ===
            // Distant left cluster
            {
                x: -500,
                z: -1300,
                size: 3400,
                height: 400,
                layer: 0.7,
                seed: 22222,
                peakRadius: 0.46,
                coverageRadius: 0.72,
                frontCoverageBias: 0.14,
                skirtFloor: -175,
                skirtNoiseStrength: 0.08,
            },
            // Distant right
            {
                x: 700,
                z: -1350,
                size: 3200,
                height: 380,
                layer: 0.75,
                seed: 88888,
                peakRadius: 0.46,
                coverageRadius: 0.72,
                frontCoverageBias: 0.14,
                skirtFloor: -175,
                skirtNoiseStrength: 0.08,
            },
            // Far background center-right
            {
                x: 150,
                z: -1550,
                size: 4200,
                height: 520,
                layer: 0.95,
                seed: 33333,
                peakRadius: 0.46,
                coverageRadius: 0.74,
                frontCoverageBias: 0.12,
                skirtFloor: -185,
                skirtNoiseStrength: 0.07,
            },
        ];

        configs.forEach((config) => {
            const mountain = this.createFBMMountain(config);
            this.mountains.push(mountain);
            this.scene.add(mountain);
        });

        this.createMountainBaseFill();
    }

    createFBMMountain(config) {
        const segments = this.qualityPreset.mountainSegments;
        const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        // CPU-side FBM displacement
        const posAttribute = geometry.attributes.position;
        const heights = [];
        const baseMasks = [];
        const { seed } = config;
        const peakRadius = config.size * (config.peakRadius ?? 0.45);
        const coverageRadius = config.size * (config.coverageRadius ?? 0.8);
        const frontCoverageBias = config.frontCoverageBias ?? 0.22;
        const skirtFloor = config.skirtFloor ?? -150;
        const skirtNoiseStrength = config.skirtNoiseStrength ?? 0.12;
        const hardFalloffFloor = config.hardFalloffFloor ?? (skirtFloor - 1800);

        const fract = (n) => n - Math.floor(n);
        const mix = (a, b, t) => a * (1 - t) + b * t;
        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        const smoothstep = (edge0, edge1, value) => {
            const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
            return t * t * (3 - 2 * t);
        };
        const rand = (x, y) => Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;

        const noise = (x, y) => {
            const i = Math.floor(x);
            const j = Math.floor(y);
            const f = fract(x);
            const g = fract(y);
            const u = f * f * (3.0 - 2.0 * f);
            const v = g * g * (3.0 - 2.0 * g);
            return mix(
                mix(fract(rand(i, j)), fract(rand(i + 1, j)), u),
                mix(fract(rand(i, j + 1)), fract(rand(i + 1, j + 1)), u),
                v,
            );
        };

        const fbm = (x, y) => {
            let xCoord = x;
            let yCoord = y;
            let v = 0.0;
            let a = 0.5;
            for (let i = 0; i < 5; i++) {
                v += a * noise(xCoord, yCoord);
                xCoord *= 2.0;
                yCoord *= 2.0;
                a *= 0.5;
            }
            return v;
        };

        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const z = posAttribute.getZ(i);

            const dist = Math.sqrt(x * x + z * z);
            const frontness = clamp((z / Math.max(coverageRadius, 1)) * 0.5 + 0.5, 0, 1);
            const biasedCoverageRadius = Math.max(
                peakRadius + 1,
                coverageRadius * (1 + frontCoverageBias * ((frontness - 0.5) * 2.0)),
            );
            const baseMask = dist >= peakRadius
                ? smoothstep(peakRadius * 0.82, biasedCoverageRadius, dist)
                : 0;

            if (dist > biasedCoverageRadius) {
                posAttribute.setY(i, hardFalloffFloor);
                heights.push(hardFalloffFloor);
                baseMasks.push(1);
                continue;
            }

            let h = 0;

            if (dist <= peakRadius) {
                const normDist = dist / peakRadius;
                const cone = (1.0 - normDist) ** 1.5 * config.height;

                const n = fbm(x * 0.01, z * 0.01);
                const n2 = fbm(x * 0.04, z * 0.04);
                const detail = (n * 0.7 + n2 * 0.3) * config.height * 0.4 * (1.0 - normDist);
                h = cone + detail;
            } else {
                const skirtT = clamp(
                    (dist - peakRadius) / Math.max(biasedCoverageRadius - peakRadius, 1),
                    0,
                    1,
                );
                const shoulderFade = (1.0 - skirtT);
                const frontLift = frontness * config.height * frontCoverageBias * 0.42;
                const skirtBase = skirtFloor + frontLift;
                const shoulder = config.height * 0.16 * (shoulderFade ** 1.8);
                const terrace = config.height * 0.08 * shoulderFade;
                const skirtNoise = (
                    fbm((x + seed * 0.17) * 0.0035, (z - seed * 0.13) * 0.0035) - 0.5
                ) * config.height * skirtNoiseStrength * (0.35 + shoulderFade * 0.65);

                h = Math.max(skirtBase - config.height * 0.05, skirtBase + shoulder + terrace + skirtNoise);
            }

            posAttribute.setY(i, h);
            heights.push(h);
            baseMasks.push(baseMask);
        }

        posAttribute.needsUpdate = true;
        geometry.computeVertexNormals();

        const heightAttr = new Float32Array(posAttribute.count);
        const baseMaskAttr = new Float32Array(posAttribute.count);
        for (let i = 0; i < posAttribute.count; i++) {
            heightAttr[i] = heights[i] / config.height;
            baseMaskAttr[i] = baseMasks[i];
        }
        geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));
        geometry.setAttribute('aBaseMask', new THREE.BufferAttribute(baseMaskAttr, 1));

        let material;
        let nodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const result = this.materialFactories.createMountainNodeMaterial({
                layer: config.layer,
                ridgeStrength: 0.18 + (1.0 - config.layer) * 0.28,
                snowAmount: 0.2 + config.layer * 0.15,
            });
            ({ material } = result);
            nodeData = result;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uRockColorDark: { value: new THREE.Color(0x151515) },
                    uRockColorMid: { value: new THREE.Color(0x202020) },
                    uRockColorLight: { value: new THREE.Color(0x303030) },
                    uMountainLayer: { value: config.layer },
                    uPulseIntensity: { value: 0 },
                    uShockwave: { value: 0 },
                    uTime: { value: 0 },
                },
                vertexShader: mountainVertexShader,
                fragmentShader: mountainFragmentShader,
                transparent: false,
            });
        }

        const mesh = new THREE.Mesh(geometry, material);
        const xPos = config.x || 0;
        mesh.position.set(xPos, -450, config.z);
        mesh.renderOrder = -100 + Math.round(config.layer * 10);
        if (nodeData) {
            mesh.userData.nodeData = nodeData;
            mesh.userData.baseRidgeStrength = nodeData.uniforms?.uRidgeStrength?.value ?? 0.25;
            mesh.userData.baseSnowAmount = nodeData.uniforms?.uSnowAmount?.value ?? 0.22;
        }
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        return mesh;
    }

    createMountainBaseFill() {
        let material;
        let nodeData = null;

        if (this.isWebGPU && this.materialFactories?.createMountainBaseFillNodeMaterial) {
            const result = this.materialFactories.createMountainBaseFillNodeMaterial({
                color: new THREE.Color(0x03040a),
            });
            ({ material } = result);
            nodeData = result;
        } else {
            material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0x03040a),
            });
        }

        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7600, 3200), material);
        mesh.position.set(0, -1840, -1825);
        mesh.renderOrder = -120;
        mesh.frustumCulled = false;
        if (nodeData) {
            mesh.userData.nodeData = nodeData;
        }
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;

        this.mountainBaseFill = mesh;
        this.scene.add(mesh);
    }

    createGroundFog() {
        if (this.qualityPreset.enableGroundFog !== true) return;

        const geometry = new THREE.PlaneGeometry(6200, 2200);
        let material;
        let fogResult = null;

        if (
            this.isWebGPU
            && this.materialFactories
            && typeof this.materialFactories.createGroundFogNodeMaterial === 'function'
        ) {
            fogResult = this.materialFactories.createGroundFogNodeMaterial({
                opacity: 0.18,
            });
            material = fogResult.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0.18 },
                    uPulse: { value: 0 },
                    uSwirl: { value: 0 },
                },
                vertexShader: fogVertexShader,
                fragmentShader: fogFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
            });
        }

        const fog = new THREE.Mesh(geometry, material);
        fog.position.set(0, -340, -840);
        fog.renderOrder = -55;
        fog.frustumCulled = false;
        if (fogResult) {
            fog.userData.nodeData = fogResult;
        }
        fog.updateMatrix();
        fog.matrixAutoUpdate = false;

        this.groundFog = fog;
        this.scene.add(fog);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Spirit Particle System
    // ─────────────────────────────────────────────────────────────────────────

    createSpirits() {
        // Removed as per user request
    }

    createAmbientParticles() {
        // Removed as per user request
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (this.postProcessing) {
            this.postProcessing.dispose?.();
            this.postProcessing = null;
        }
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }
        this.bloomPass = null;
        this.silverTintPass = null;
        this.postProfile = null;

        if (!this.flags.usePost) {
            this.configureRendererColorPipeline();
            return;
        }

        if (this.isWebGPU) {
            if (!this.postFactories?.WolfhourPost) {
                this.flags.usePost = false;
                this.configureRendererColorPipeline();
                return;
            }

            const profile = this.resolvePostProfile();
            this.postProfile = profile;
            if (profile.enabled !== true) {
                this.configureRendererColorPipeline();
                return;
            }

            try {
                this.postProcessing = new this.postFactories.WolfhourPost(
                    this.renderer,
                    this.scene,
                    this.camera,
                    {
                        useMRT: this.flags.useMRT === true,
                        profile: profile.profile,
                        bloomStrength: this.qualityPreset.bloomStrength,
                        bloomRadius: profile.bloomRadius,
                        bloomThreshold: profile.bloomThreshold,
                        bloomDownsample: profile.bloomDownsample,
                        silverTintStrength: profile.silverTintStrength,
                        tintDesaturation: profile.tintDesaturation,
                        vignetteOffset: profile.vignetteOffset,
                        vignetteDarkness: profile.vignetteDarkness,
                        exposure: profile.exposure,
                        contrast: profile.contrast,
                        saturation: profile.saturation,
                        useFilmGrain: profile.useFilmGrain,
                        grainStrength: profile.grainStrength,
                        ditherStrength: profile.ditherStrength,
                    },
                );
                this.postProcessing.updateStaticProfile?.({
                    bloomRadius: profile.bloomRadius,
                    bloomThreshold: profile.bloomThreshold,
                    bloomDownsample: profile.bloomDownsample,
                    silverTintStrength: profile.silverTintStrength,
                    tintDesaturation: profile.tintDesaturation,
                    vignetteOffset: profile.vignetteOffset,
                    vignetteDarkness: profile.vignetteDarkness,
                    exposure: profile.exposure,
                    contrast: profile.contrast,
                    saturation: profile.saturation,
                    useFilmGrain: profile.useFilmGrain,
                    grainStrength: profile.grainStrength,
                    ditherStrength: profile.ditherStrength,
                });
                this.postProcessing.setSize(window.innerWidth, window.innerHeight);
            } catch (error) {
                this.disablePostRuntime('setupPostProcessing', error);
                return;
            }

            this.configureRendererColorPipeline();
            return;
        }

        this.setupPostProcessingLegacy();
        this.configureRendererColorPipeline();
    }

    setupPostProcessingLegacy() {
        if (!this.flags.usePost || !this.qualityPreset.enableBloom) return;

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.5,
            0.4,
        );
        this.composer.addPass(this.bloomPass);

        // Silver Tint Pass (custom)
        this.silverTintPass = new ShaderPass(SilverTintShader);
        this.silverTintPass.uniforms.uAmount.value = 0.3;
        this.composer.addPass(this.silverTintPass);

        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.darkness.value = 0.6;
        vignettePass.uniforms.offset.value = 1.2;
        this.composer.addPass(vignettePass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const { settings } = window;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const { settings } = window;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const { settings } = window;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data);
            }
        });

        const levelUpUnsub = eventBus.on(EVENTS.LEVEL_UP, (data) => {
            const { settings } = window;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLevelUp(data);
            }
        });

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, levelUpUnsub, pointerUnsub);
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const changed = event?.detail || {};
            const qualityChanged = Object.prototype.hasOwnProperty.call(changed, 'effectQuality')
                || Object.prototype.hasOwnProperty.call(changed, 'graphicsQuality');
            const renderScaleChanged = Object.prototype.hasOwnProperty.call(changed, 'renderScale')
                || changed?.type === 'renderScale';
            if (!qualityChanged && !renderScaleChanged) return;

            if (renderScaleChanged) {
                this.handleResize();
            }

            if (!qualityChanged) return;
            const runtimeQuality = this.getCurrentQualityLevel();
            if (runtimeQuality === this.activeQualityLevel) return;
            this.requestRuntimeQualityRebuild('settingsChanged');
        };
        this.performancePolicyChangeHandler = (event) => {
            const policy = event?.detail || window.desktopPerformancePolicy;
            const runtimeQuality = normalizeQuality(policy?.qualityTier || this.getCurrentQualityLevel());
            if (runtimeQuality !== this.activeQualityLevel) {
                this.requestRuntimeQualityRebuild('desktopPerformancePolicyChanged');
                return;
            }
            // main.js publishes the policy event immediately before it updates the
            // shared render scale. Resize on the next task so we read the new scale.
            this.scheduleRuntimeRebuild(() => {
                if (this.isActive) this.handleResize();
            }, 0);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
        window.addEventListener('desktopPerformancePolicyChanged', this.performancePolicyChangeHandler);
    }

    teardownQualityListener() {
        if (typeof window === 'undefined') return;
        if (!this.qualityChangeHandler) return;
        window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        if (this.performancePolicyChangeHandler) {
            window.removeEventListener(
                'desktopPerformancePolicyChanged',
                this.performancePolicyChangeHandler,
            );
        }
        this.qualityChangeHandler = null;
        this.performancePolicyChangeHandler = null;
    }

    requestRuntimeQualityRebuild(reason = 'settingsChanged') {
        if (!this.isActive || this.qualityRebuildPending) return;
        this.qualityRebuildPending = true;
        console.log(`[Wolfhour] Rebuilding scene after quality update (${reason})`);
        this.scheduleRuntimeRebuild(() => {
            this.qualityRebuildPending = false;
            this.rebuildRuntimeScene(reason).catch((rebuildError) => {
                console.error('[Wolfhour] Quality rebuild failed.', rebuildError);
            });
        }, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gameplay Effects
    // ─────────────────────────────────────────────────────────────────────────

    getVisibleBoardRect(data = {}) {
        if (typeof document === 'undefined') return null;
        const detail = data?.detail || data;
        const player = detail?.player ?? detail?.playerId ?? null;
        const selectors = [];
        if (player !== null && player !== undefined) {
            selectors.push(`#p${player}-phaser-container canvas`);
        }
        selectors.push(
            '#phaser-game-container canvas',
            '#main-game-canvas',
            '#single-player-game-canvas',
        );

        for (let i = 0; i < selectors.length; i += 1) {
            const element = document.querySelector(selectors[i]);
            if (!element) continue;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (
                style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity || 1) > 0
                && rect.width > 32
                && rect.height > 64
            ) {
                return rect;
            }
        }
        return null;
    }

    screenToReactionWorld(screenX, screenY, z = 100) {
        if (!this.camera || typeof window === 'undefined') return null;
        const scratch = this.reactiveOriginScratch;
        scratch.ndc.set(
            (screenX / Math.max(1, window.innerWidth)) * 2 - 1,
            1 - (screenY / Math.max(1, window.innerHeight)) * 2,
        );
        scratch.plane.constant = -z;
        this.camera.updateMatrixWorld();
        scratch.raycaster.setFromCamera(scratch.ndc, this.camera);
        const hit = scratch.raycaster.ray.intersectPlane(scratch.plane, scratch.world);
        if (!hit) return null;
        return { x: hit.x, y: hit.y, z };
    }

    resolvePieceLockOrigin(data = {}) {
        const detail = data?.detail || data;
        const piece = detail?.piece;
        const shape = Array.isArray(piece?.shape) ? piece.shape : null;
        let centroidX = Number(piece?.x) + 0.5;
        let centroidY = Number(piece?.y) + 0.5;

        if (shape && Number.isFinite(piece?.x) && Number.isFinite(piece?.y)) {
            let sumX = 0;
            let sumY = 0;
            let occupied = 0;
            shape.forEach((row, rowIndex) => {
                if (!Array.isArray(row)) return;
                row.forEach((cell, columnIndex) => {
                    if (!cell) return;
                    sumX += piece.x + columnIndex + 0.5;
                    sumY += piece.y + rowIndex + 0.5;
                    occupied += 1;
                });
            });
            if (occupied > 0) {
                centroidX = sumX / occupied;
                centroidY = sumY / occupied;
            }
        }

        // A scrolling/nonstandard mode (Infinity) supplies the ON-SCREEN normalized lock
        // position; prefer it over the fixed-board centroid, which pins to the bottom lane in
        // Infinity (piece.y is an absolute row that grows into the hundreds).
        const viewport = readLockViewportOrigin(detail);
        const u = viewport
            ? viewport.x
            : THREE.MathUtils.clamp(Number.isFinite(centroidX) ? centroidX / 10 : 0.5, 0, 1);
        const visibleY = Number.isFinite(centroidY) ? centroidY - 4 : 10;
        const v = viewport ? viewport.y : THREE.MathUtils.clamp(visibleY / 20, 0, 1);
        const side = u < 0.5 ? -1 : 1;
        const rect = this.getVisibleBoardRect(data);
        const margin = rect ? Math.max(32, rect.width * 0.14) : window.innerWidth * 0.07;
        const sideLaneX = side < 0 ? 0.31 : 0.69;
        let boardEdgeX = window.innerWidth * sideLaneX;
        if (rect) boardEdgeX = side < 0 ? rect.left - margin : rect.right + margin;
        const screenX = rect
            ? boardEdgeX
            : window.innerWidth * sideLaneX;
        const screenY = rect
            ? rect.top + v * rect.height
            : window.innerHeight * (0.18 + v * 0.64);

        return this.screenToReactionWorld(
            THREE.MathUtils.clamp(screenX, 24, window.innerWidth - 24),
            THREE.MathUtils.clamp(screenY, 24, window.innerHeight - 24),
            100,
        );
    }

    resolveLineClearOrigin(data = {}) {
        const detail = data?.detail || data;
        const explicit = detail?.position;
        if (Number.isFinite(explicit?.x) && Number.isFinite(explicit?.y)) {
            return this.screenToReactionWorld(explicit.x, explicit.y, 100);
        }

        const rows = Array.isArray(detail?.clearedRows) ? detail.clearedRows : [];
        if (!rows.length) {
            return this.reactiveOriginsByPlayer.get(this.getReactivePlayerKey(data))
                || this.lastReactiveOrigin;
        }
        const meanRow = rows.reduce((sum, row) => sum + Number(row || 0), 0) / rows.length;
        // Infinity supplies the ON-SCREEN clear origin; prefer its Y over the fixed-board row
        // normalization (clearedRows are absolute rows in Infinity → the fallback pins to bottom).
        const viewport = readLockViewportOrigin(detail);
        const v = viewport ? viewport.y : THREE.MathUtils.clamp((meanRow - 4 + 0.5) / 20, 0, 1);
        const rect = this.getVisibleBoardRect(data);
        const screenX = rect ? rect.right + Math.max(32, rect.width * 0.14) : window.innerWidth * 0.69;
        const screenY = rect ? rect.top + v * rect.height : window.innerHeight * (0.18 + v * 0.64);
        return this.screenToReactionWorld(
            THREE.MathUtils.clamp(screenX, 24, window.innerWidth - 24),
            THREE.MathUtils.clamp(screenY, 24, window.innerHeight - 24),
            100,
        );
    }

    getReactivePlayerKey(data = {}) {
        const detail = data?.detail || data;
        return String(detail?.player ?? detail?.playerId ?? 'local');
    }

    getLunarReactionSlotCapacity() {
        const quality = normalizeQuality(this.activeQualityLevel || this.getCurrentQualityLevel());
        return LUNAR_REACTION_SLOTS_BY_QUALITY[quality]
            ?? LUNAR_REACTION_SLOTS_BY_QUALITY.High;
    }

    addEffectState(changes = {}) {
        Object.entries(changes).forEach(([key, amount]) => {
            if (!Object.hasOwn(this.effectState, key) || !Number.isFinite(amount) || amount <= 0) {
                return;
            }
            const cap = this.effectStateCaps[key] ?? 1;
            this.effectState[key] = Math.min(cap, this.effectState[key] + amount);
        });
    }

    triggerLunarReaction({ strength = 1, combo = 0, duration = 1.1 } = {}) {
        const capacity = Math.min(
            this.getLunarReactionSlotCapacity(),
            this.moonHaloNodeData?.maxPulses ?? MAX_LUNAR_REACTION_SLOTS,
        );
        const safeDuration = Math.max(0.001, Number(duration) || 1.1);

        for (let i = 0; i < capacity; i += 1) {
            const reaction = this.lunarReactions[i];
            if (reaction.active && this.time - reaction.startTime >= reaction.duration) {
                reaction.active = false;
            }
        }

        let slotIndex = this.lunarReactions
            .slice(0, capacity)
            .findIndex((reaction) => !reaction.active);

        if (slotIndex < 0) {
            // The pool is deliberately bounded. If every ring is live, replace the one
            // nearest natural expiry so the strongest/newest reactions remain intact.
            let leastRemainingLife = Number.POSITIVE_INFINITY;
            let leastStrength = Number.POSITIVE_INFINITY;
            for (let i = 0; i < capacity; i += 1) {
                const reaction = this.lunarReactions[i];
                const remainingLife = Math.max(
                    0,
                    reaction.duration - (this.time - reaction.startTime),
                );
                if (
                    remainingLife < leastRemainingLife
                    || (remainingLife === leastRemainingLife && reaction.strength < leastStrength)
                ) {
                    slotIndex = i;
                    leastRemainingLife = remainingLife;
                    leastStrength = reaction.strength;
                }
            }
        }

        const reaction = this.lunarReactions[Math.max(0, slotIndex)];
        reaction.active = true;
        reaction.startTime = this.time;
        reaction.duration = safeDuration;
        reaction.strength = THREE.MathUtils.clamp(Number(strength) || 0, 0, 1.35);
        reaction.combo = THREE.MathUtils.clamp(Number(combo) || 0, 0, 1);
        reaction.serial = ++this.lunarReactionSerial;

        this.moonHaloNodeData?.pulseValues?.[slotIndex]?.set(
            reaction.startTime,
            1 / reaction.duration,
            reaction.strength,
            reaction.combo,
        );
        return slotIndex;
    }

    updateLunarReaction() {
        if (this.moonHaloNodeData?.uniforms) {
            this.moonHaloNodeData.uniforms.uTime.value = this.time;
        }

        const capacity = Math.min(
            this.getLunarReactionSlotCapacity(),
            this.moonHaloNodeData?.maxPulses ?? MAX_LUNAR_REACTION_SLOTS,
        );
        let moonEnergy = 0;
        let fallbackEnergy = 0;

        for (let i = 0; i < MAX_LUNAR_REACTION_SLOTS; i += 1) {
            const reaction = this.lunarReactions[i];
            const pulseValue = this.moonHaloNodeData?.pulseValues?.[i];
            if (i >= capacity || !reaction.active) {
                pulseValue?.set(0, 0, 0, 0);
                continue;
            }

            const elapsed = this.time - reaction.startTime;
            const progress = THREE.MathUtils.clamp(
                elapsed / Math.max(0.001, reaction.duration),
                0,
                1,
            );
            if (progress >= 1) {
                reaction.active = false;
                pulseValue?.set(0, 0, 0, 0);
                continue;
            }

            const envelope = Math.sin(progress * Math.PI);
            moonEnergy += envelope
                * reaction.strength
                * (0.42 + reaction.combo * 0.45);
            fallbackEnergy += envelope
                * reaction.strength
                * (0.12 + reaction.combo * 0.12);
            pulseValue?.set(
                reaction.startTime,
                1 / reaction.duration,
                reaction.strength,
                reaction.combo,
            );
        }

        if (!this.moonHaloNodeData && this.moonHalo?.material) {
            this.moonHalo.material.opacity = Math.min(0.42, 0.075 + fallbackEnergy);
        }
        if (this.moonNodeData?.uniforms?.uPulse) {
            this.moonNodeData.uniforms.uPulse.value = Math.min(1.8, moonEnergy);
        }
        if (this.moon) {
            this.moon.rotation.y = -0.34 + Math.sin(this.time * 0.05) * 0.025;
        }
    }

    getReactiveBudgetCredits() {
        const quality = normalizeQuality(this.activeQualityLevel || this.getCurrentQualityLevel());
        return this.reactiveBudgetCredits[quality] ?? REACTIVE_BUDGET_CREDITS.High;
    }

    enqueueReactiveToken(type, payload = {}, createdAtMs = performance.now()) {
        const expiryMs = this.reactiveTokenExpiryMs[type];
        if (!Number.isFinite(expiryMs)) return;
        if (this.getReactivePoolCapacity(type) <= 0) return;

        this.reactiveQueue.push({
            type,
            payload,
            createdAtMs,
            expiresAtMs: createdAtMs + expiryMs,
        });
        this.reactiveMetrics.queueMaxDepth = Math.max(
            this.reactiveMetrics.queueMaxDepth,
            this.reactiveQueue.length,
        );
    }

    enqueueReactiveBurst(type, count, payload = {}) {
        const burstCount = Math.max(0, Math.floor(count));
        const startAt = performance.now();
        for (let i = 0; i < burstCount; i += 1) {
            let spacing = 35;
            if (type === 'meteor') spacing = 120;
            else if (type === 'crash') spacing = 380;
            const createdAtMs = startAt + (i * spacing);
            this.enqueueReactiveToken(type, payload, createdAtMs);
        }
    }

    applyReactiveExpiryEnvelope(token) {
        this.reactiveMetrics.tokensDropped += 1;
        const heavy = token.type === 'meteor' || token.type === 'crash';
        this.addEffectState({
            bloomBoost: heavy ? 0.18 : 0.08,
            nebulaDefinition: heavy ? 0.65 : 0.45,
            cameraShake: heavy ? 0.42 : 0.16,
        });
    }

    spawnReactiveToken(token) {
        let created = false;
        if (token.type === 'starBurst') {
            const before = this.starBursts.length;
            this.createStarBurst(token.payload);
            created = this.starBursts.length > before;
        } else if (token.type === 'beam') {
            const before = this.celestialBeams.length;
            this.createCelestialBeam(token.payload);
            created = this.celestialBeams.length > before;
        } else if (token.type === 'rift') {
            const before = this.cosmicRifts.length;
            this.createCosmicRift(token.payload);
            created = this.cosmicRifts.length > before;
        } else if (token.type === 'wave') {
            const before = this.cosmicWaves.length;
            this.createCosmicWave(token.payload);
            created = this.cosmicWaves.length > before;
        } else if (token.type === 'meteor') {
            const before = this.meteors.length;
            this.createMeteor(token.payload);
            created = this.meteors.length > before;
        } else if (token.type === 'crash') {
            const before = this.meteorCrashes.length;
            this.createMeteorCrash(token.payload);
            created = this.meteorCrashes.length > before;
        }

        return created;
    }

    processReactiveQueue() {
        if (!this.reactiveQueue.length) return;

        const now = performance.now();
        const adaptivePacingEnabled = this.flags.noAdaptivePacing !== true;
        const maxCredits = this.getReactiveBudgetCredits();
        let credits = adaptivePacingEnabled ? maxCredits : Number.POSITIVE_INFINITY;
        const attemptedTokens = new Set();

        while (this.reactiveQueue.length > 0 && credits > 0) {
            for (let i = this.reactiveQueue.length - 1; i >= 0; i -= 1) {
                const queuedToken = this.reactiveQueue[i];
                const queuedCost = this.reactiveTokenCosts[queuedToken.type] ?? 1;
                if (queuedToken.expiresAtMs <= now
                    || (adaptivePacingEnabled && queuedCost > maxCredits)) {
                    this.reactiveQueue.splice(i, 1);
                    this.applyReactiveExpiryEnvelope(queuedToken);
                }
            }

            let tokenIndex = -1;
            for (let i = 0; i < this.reactiveQueue.length; i += 1) {
                const queuedToken = this.reactiveQueue[i];
                if (attemptedTokens.has(queuedToken) || queuedToken.createdAtMs > now) continue;
                const queuedCost = this.reactiveTokenCosts[queuedToken.type] ?? 1;
                if (!adaptivePacingEnabled || queuedCost <= credits) {
                    tokenIndex = i;
                    break;
                }
            }
            if (tokenIndex < 0) break;

            const token = this.reactiveQueue[tokenIndex];
            const cost = this.reactiveTokenCosts[token.type] ?? 1;

            const spawnStart = performance.now();
            const created = this.spawnReactiveToken(token);
            const spawnDuration = performance.now() - spawnStart;
            this.recordReactiveSpawnDuration(spawnDuration);

            if (created) {
                this.reactiveQueue.splice(tokenIndex, 1);
                if (adaptivePacingEnabled) {
                    credits -= cost;
                }
                continue;
            }

            // A saturated effect type must not block unrelated ready reactions. Record
            // one miss per token, then try other ready work this frame.
            if (!token.poolMissRecorded) {
                token.poolMissRecorded = true;
                this.reactiveMetrics.poolMisses += 1;
            }
            attemptedTokens.add(token);
        }
    }

    onPieceLock(data = {}) {
        const playerKey = this.getReactivePlayerKey(data);
        const origin = this.resolvePieceLockOrigin(data);
        if (origin) {
            this.lastReactiveOrigin = { ...origin };
            this.reactiveOriginsByPlayer.set(playerKey, { ...origin });
        }
        this.comboProgressByPlayer.set(playerKey, 0);
        this.enqueueReactiveToken('starBurst', { origin });

        this.addEffectState({
            starBurstIntensity: 0.72,
            mountainPulse: 0.8,
            mountainShockwave: 1.0,
            ambientScatter: 0.85,
            nebulaDefinition: 0.35,
        });
        this.triggerLunarReaction({ strength: 1.0, combo: 0.12, duration: 1.25 });
    }

    onLineClear(data = {}) {
        const lineCount = Math.max(
            1,
            Number(data?.detail?.lineCount ?? data?.lineCount) || 1,
        );
        const playerKey = this.getReactivePlayerKey(data);
        const origin = this.resolveLineClearOrigin(data);
        if (origin) {
            this.lastReactiveOrigin = { ...origin };
            this.reactiveOriginsByPlayer.set(playerKey, { ...origin });
        }
        const payload = { origin };

        this.enqueueReactiveBurst('beam', Math.min(lineCount, 2), payload);

        // Create horizontal ripple
        this.enqueueReactiveToken('wave', payload);

        this.addEffectState({
            nebulaBoost: 0.1 + lineCount * 0.02,
            bloomBoost: 0.05 + lineCount * 0.02,
            mountainPulse: Math.min(lineCount * 0.3, 1.0),
            nebulaDefinition: Math.min(0.35 + lineCount * 0.1, 0.9),
            nebulaColorShift: Math.min(0.18 + lineCount * 0.08, 0.85),
        });
        this.triggerLunarReaction({
            strength: Math.min(0.5 + lineCount * 0.09, 0.86),
            combo: Math.min(lineCount / 8, 0.5),
            duration: 1.25,
        });
    }

    onCombo(data = {}) {
        const comboCount = Math.max(
            0,
            Math.floor(Number(data?.detail?.comboCount ?? data?.comboCount) || 0),
        );
        const playerKey = this.getReactivePlayerKey(data);
        if (comboCount <= 0) {
            this.comboProgressByPlayer.set(playerKey, 0);
            return;
        }

        const storedCombo = this.comboProgressByPlayer.get(playerKey) || 0;
        const previousCombo = comboCount < storedCombo ? 0 : storedCombo;
        if (comboCount === previousCombo) return;
        this.comboProgressByPlayer.set(playerKey, comboCount);

        const origin = this.reactiveOriginsByPlayer.get(playerKey) || this.lastReactiveOrigin;
        const payload = { origin, reactive: true };
        const newlyCrossedComboSteps = Math.max(0, comboCount - Math.max(previousCombo, 2));

        if (comboCount >= 3) {
            // Preserve every active meteor. Delaying the next ambient spawn protects the
            // bounded pool while the authored combo shower accumulates alongside it.
            this.lastMeteorTime = this.time;
            this.nextMeteorDelay = 4 + this.random() * 3;
            const riftCount = Math.min(Math.max(1, newlyCrossedComboSteps), 2);
            this.enqueueReactiveBurst('rift', riftCount, payload);
            const maxComboMeteors = ['Ultra', 'Extreme'].includes(this.activeQualityLevel) ? 4 : 3;
            const meteorCount = Math.min(
                newlyCrossedComboSteps + (previousCombo < 3 ? 1 : 0),
                maxComboMeteors,
            );
            this.enqueueReactiveBurst('meteor', meteorCount, payload);
        }

        const crashCapacity = this.getReactivePoolCapacity('crash');
        let crashCount = 0;
        if (previousCombo < 5 && comboCount >= 5 && crashCapacity >= 1) crashCount += 1;
        if (previousCombo < 10 && comboCount >= 10 && crashCapacity >= 2) crashCount += 1;
        if (crashCount > 0) {
            this.enqueueReactiveBurst('crash', crashCount, payload);
        }

        this.addEffectState({
            cosmicRiftIntensity: comboCount >= 3 ? Math.min(comboCount * 0.2, 1.0) : 0,
            nebulaDefinition: Math.min(0.28 + comboCount * 0.08, 1.0),
            nebulaColorShift: Math.min(0.2 + comboCount * 0.1, 1.0),
            mountainPulse: Math.min(comboCount * 0.1, 0.8),
            starBurstIntensity: Math.min(0.25 + comboCount * 0.065, 0.82),
            cameraShake: Math.min(comboCount * 0.045, 0.48),
        });
        this.triggerLunarReaction({
            strength: Math.min(0.62 + comboCount * 0.045, 1),
            combo: Math.min(comboCount / 8, 1),
            duration: 1.9,
        });
    }

    onLevelUp() {
        this.addEffectState({
            bloomBoost: 0.2,
            spiritSurge: 0.3,
            mountainPulse: 0.3,
            ambientSwirl: 0.5,
            nebulaDefinition: 0.5,
            nebulaColorShift: 0.35,
        });
        this.triggerLunarReaction({ strength: 0.7, combo: 0.45, duration: 1.55 });
        // Trigger multiple beams
        this.enqueueReactiveBurst('beam', 3);
    }

    ensureSharedGeometries() {
        if (!this.geometryCache.unitQuad) {
            this.geometryCache.unitQuad = new THREE.PlaneGeometry(1, 1);
        }
        if (!this.geometryCache.shockwavePlane) {
            this.geometryCache.shockwavePlane = new THREE.PlaneGeometry(1000, 1000);
        }

        const resizeWaveGeometry = !this.geometryCache.waveGeometry
            || this.geometryCache.waveGeometry.parameters?.width !== window.innerWidth
            || this.geometryCache.waveGeometry.parameters?.height !== window.innerHeight;
        if (resizeWaveGeometry) {
            this.geometryCache.waveGeometry?.dispose?.();
            this.geometryCache.waveGeometry = new THREE.PlaneGeometry(window.innerWidth, window.innerHeight);
        }
    }

    getReactivePoolCapacity(type) {
        if (type === 'starBurst') return this.qualityPreset.maxStarBursts;
        if (type === 'beam') return this.qualityPreset.maxCelestialBeams;
        if (type === 'rift') return this.qualityPreset.maxCosmicRifts;
        if (type === 'wave') return 4;
        if (type === 'meteor') {
            return ['Minimal', 'Low'].includes(this.activeQualityLevel) ? 3 : 6;
        }
        if (type === 'crash') return this.qualityPreset.maxMeteorCrashes;
        return 0;
    }

    getReactivePoolWarmCount(type) {
        const capacity = this.getReactivePoolCapacity(type);
        if (capacity <= 0) return 0;
        if (type === 'starBurst') return Math.min(capacity, 3);
        if (type === 'meteor') return Math.min(capacity, 2);
        if (type === 'crash') return Math.min(capacity, 1);
        return Math.min(capacity, 1);
    }

    getReactivePoolTotal(type, activeList) {
        const pool = this.effectPools[type] || [];
        return activeList.length + pool.length;
    }

    acquireReactiveEffect(type, activeList, buildFn, resetFn, payload = {}) {
        const pool = this.effectPools[type] || [];
        const capacity = this.getReactivePoolCapacity(type);

        let effect = pool.pop();
        if (!effect) {
            if (this.getReactivePoolTotal(type, activeList) >= capacity) {
                return null;
            }
            effect = buildFn.call(this);
            if (!effect) return null;
            effect.visible = false;
            effect.userData.active = false;
            this.scene.add(effect);
        }

        resetFn.call(this, effect, payload);
        effect.userData.active = true;
        effect.visible = true;
        activeList.push(effect);
        return effect;
    }

    releaseReactiveEffect(type, activeList, index, effect) {
        effect.visible = false;
        effect.userData.active = false;
        activeList.splice(index, 1);
        this.effectPools[type].push(effect);
    }

    preallocateReactivePool(type, count, buildFn) {
        const clamped = Math.max(0, Math.floor(count));
        for (let i = 0; i < clamped; i += 1) {
            const effect = buildFn.call(this);
            if (!effect) continue;
            effect.visible = false;
            effect.userData.active = false;
            this.scene.add(effect);
            this.effectPools[type].push(effect);
        }
    }

    setupReactivePools() {
        this.ensureSharedGeometries();
        this.reactiveQueue.length = 0;
        this.starBursts.length = 0;
        this.celestialBeams.length = 0;
        this.cosmicRifts.length = 0;
        this.cosmicWaves.length = 0;
        this.meteors.length = 0;
        this.meteorCrashes.length = 0;
        this.effectPools.starBurst.length = 0;
        this.effectPools.beam.length = 0;
        this.effectPools.rift.length = 0;
        this.effectPools.wave.length = 0;
        this.effectPools.meteor.length = 0;
        this.effectPools.crash.length = 0;

        this.preallocateReactivePool(
            'starBurst',
            this.getReactivePoolWarmCount('starBurst'),
            this.buildStarBurstEffect,
        );
        this.preallocateReactivePool(
            'beam',
            this.getReactivePoolWarmCount('beam'),
            this.buildCelestialBeamEffect,
        );
        this.preallocateReactivePool(
            'rift',
            this.getReactivePoolWarmCount('rift'),
            this.buildCosmicRiftEffect,
        );
        this.preallocateReactivePool(
            'wave',
            this.getReactivePoolWarmCount('wave'),
            this.buildCosmicWaveEffect,
        );
        this.preallocateReactivePool(
            'meteor',
            this.getReactivePoolWarmCount('meteor'),
            this.buildMeteorEffect,
        );
        this.preallocateReactivePool(
            'crash',
            this.getReactivePoolWarmCount('crash'),
            this.buildMeteorCrashEffect,
        );
    }

    prewarmReactiveMaterials() {
        const warmList = [
            this.effectPools.starBurst[0],
            this.effectPools.beam[0],
            this.effectPools.rift[0],
            this.effectPools.wave[0],
            this.effectPools.meteor[0],
            this.effectPools.crash[0],
        ].filter(Boolean);

        warmList.forEach((effect) => {
            effect.visible = true;
            effect.visible = false;
        });
    }

    async precompileSceneWithTimeout(timeoutMs = 3000) {
        if (!this.renderer || !this.scene || !this.camera) return false;

        const compilePromise = (async () => {
            if (typeof this.renderer.compileAsync === 'function') {
                await this.renderer.compileAsync(this.scene, this.camera);
                return true;
            }
            if (typeof this.renderer.compile === 'function') {
                this.renderer.compile(this.scene, this.camera);
                return true;
            }
            return false;
        })();

        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve(false), timeoutMs);
        });
        return Promise.race([compilePromise, timeoutPromise]);
    }

    runReactivePrewarm() {
        if (this.flags.noPrewarm === true) return;
        this.prewarmReactiveMaterials();
        this.precompileSceneWithTimeout(3000).catch((error) => {
            console.warn('[Wolfhour] Scene precompile failed; continuing without prewarm compile.', error);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effect Creation Methods
    // ─────────────────────────────────────────────────────────────────────────

    buildStarBurstEffect() {
        const particleCount = 30;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        let material;
        let nodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const result = this.materialFactories.createStarBurstNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
            });
            material = result.material;
            nodeData = result;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: burstVertexShader,
                fragmentShader: burstFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        const burst = this._createInstancedParticleMesh(geometry, material);
        burst.userData.duration = 0.95;
        burst.userData.particleCount = particleCount;
        if (nodeData) burst.userData.nodeData = nodeData;

        return burst;
    }

    resetStarBurstEffect(burst, payload = {}) {
        const positions = this.getParticlePositionArray(burst);
        const velocities = burst.geometry.attributes.aVelocity.array;
        const sizes = burst.geometry.attributes.aSize.array;
        const particleCount = burst.userData.particleCount;
        const origin = payload?.origin || this.lastReactiveOrigin;
        const side = this.random() > 0.5 ? 1 : -1;
        const cx = Number.isFinite(origin?.x) ? origin.x : side * (280 + this.random() * 170);
        const cy = Number.isFinite(origin?.y) ? origin.y : -40 + (this.random() - 0.5) * 220;
        const cz = Number.isFinite(origin?.z) ? origin.z : 100;

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            positions[i3] = cx;
            positions[i3 + 1] = cy;
            positions[i3 + 2] = cz;

            const angle = this.random() * Math.PI * 2;
            const speed = 180 + this.random() * 300;
            velocities[i3] = Math.cos(angle) * speed;
            velocities[i3 + 1] = Math.sin(angle) * speed;
            velocities[i3 + 2] = (this.random() - 0.5) * 100;
            sizes[i] = 18 + this.random() * 28;
        }

        this.syncInstancedParticlePositions(burst);
        burst.geometry.attributes.aVelocity.needsUpdate = true;
        burst.geometry.attributes.aSize.needsUpdate = true;
        burst.userData.startTime = this.time;
        if (burst.userData.nodeData?.uniforms?.uTime) {
            burst.userData.nodeData.uniforms.uTime.value = 0;
        } else if (burst.material?.uniforms?.uTime) {
            burst.material.uniforms.uTime.value = 0;
        }
    }

    createStarBurst(payload = {}) {
        return !!this.acquireReactiveEffect(
            'starBurst',
            this.starBursts,
            this.buildStarBurstEffect,
            this.resetStarBurstEffect,
            payload,
        );
    }

    buildCelestialBeamEffect() {
        const geometry = this.geometryCache.unitQuad.clone();

        let material;
        let nodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const result = this.materialFactories.createCelestialBeamNodeMaterial({
                volumetricStrength: this.qualityPreset.enableVolumetricBeams ? 0.82 : 0.0,
            });
            material = result.material;
            nodeData = result;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 1.0 },
                },
                vertexShader: beamVertexShader,
                fragmentShader: beamFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
        }

        const beam = new THREE.Mesh(geometry, material);
        beam.userData.duration = 1.5;
        if (nodeData) beam.userData.nodeData = nodeData;

        return beam;
    }

    resetCelestialBeamEffect(beam, payload = {}) {
        const beamWidth = 40 + this.random() * 60;
        const origin = payload?.origin || this.lastReactiveOrigin;
        const beamX = Number.isFinite(origin?.x)
            ? origin.x + (this.random() - 0.5) * 50
            : (this.random() - 0.5) * 1000;
        beam.scale.set(beamWidth, 4000, 1);
        beam.position.set(beamX, -200, -800);
        beam.rotation.z = (this.random() - 0.5) * 0.1;
        beam.userData.startTime = this.time;

        if (beam.userData.nodeData?.uniforms) {
            beam.userData.nodeData.uniforms.uTime.value = 0;
            beam.userData.nodeData.uniforms.uOpacity.value = 1;
        } else if (beam.material?.uniforms) {
            beam.material.uniforms.uTime.value = 0;
            beam.material.uniforms.uOpacity.value = 1;
        }
    }

    createCelestialBeam(payload = {}) {
        return !!this.acquireReactiveEffect(
            'beam',
            this.celestialBeams,
            this.buildCelestialBeamEffect,
            this.resetCelestialBeamEffect,
            payload,
        );
    }

    buildCosmicRiftEffect() {
        const geometry = this.geometryCache.unitQuad.clone();

        let material;
        let nodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const result = this.materialFactories.createCosmicRiftNodeMaterial();
            material = result.material;
            nodeData = result;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 1.0 },
                },
                vertexShader: riftVertexShader,
                fragmentShader: riftFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
        }

        const rift = new THREE.Mesh(geometry, material);
        rift.userData.duration = 1.2;
        if (nodeData) rift.userData.nodeData = nodeData;

        return rift;
    }

    resetCosmicRiftEffect(rift, payload = {}) {
        const riftLength = 100 + this.random() * 150;
        const riftWidth = 3 + this.random() * 4;
        const origin = payload?.origin || this.lastReactiveOrigin;
        rift.scale.set(riftLength, riftWidth, 1);
        rift.position.set(
            Number.isFinite(origin?.x) ? origin.x : (this.random() - 0.5) * 1000,
            Number.isFinite(origin?.y) ? origin.y + 80 : this.random() * 300 + 80,
            Number.isFinite(origin?.z) ? origin.z - 300 : -200,
        );
        rift.rotation.z = (this.random() - 0.5) * 0.4;
        rift.userData.startTime = this.time;

        if (rift.userData.nodeData?.uniforms) {
            rift.userData.nodeData.uniforms.uTime.value = 0;
            rift.userData.nodeData.uniforms.uOpacity.value = 1;
        } else if (rift.material?.uniforms) {
            rift.material.uniforms.uTime.value = 0;
            rift.material.uniforms.uOpacity.value = 1;
        }
    }

    createCosmicRift(payload = {}) {
        return !!this.acquireReactiveEffect(
            'rift',
            this.cosmicRifts,
            this.buildCosmicRiftEffect,
            this.resetCosmicRiftEffect,
            payload,
        );
    }

    buildCosmicWaveEffect() {
        const geometry = this.geometryCache.waveGeometry.clone();

        let material;
        let nodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const result = this.materialFactories.createCosmicWaveNodeMaterial();
            material = result.material;
            nodeData = result;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0.5 },
                },
                vertexShader: waveVertexShader,
                fragmentShader: waveFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        const wave = new THREE.Mesh(geometry, material);
        wave.position.z = 50;
        wave.userData.duration = 1.0;
        if (nodeData) wave.userData.nodeData = nodeData;

        return wave;
    }

    resetCosmicWaveEffect(wave, payload = {}) {
        const origin = payload?.origin || this.lastReactiveOrigin;
        wave.position.set(
            Number.isFinite(origin?.x) ? origin.x : 0,
            Number.isFinite(origin?.y) ? origin.y : 0,
            50,
        );
        wave.userData.startTime = this.time;
        if (wave.userData.nodeData?.uniforms) {
            wave.userData.nodeData.uniforms.uTime.value = 0;
            wave.userData.nodeData.uniforms.uOpacity.value = 0.5;
        } else if (wave.material?.uniforms) {
            wave.material.uniforms.uTime.value = 0;
            wave.material.uniforms.uOpacity.value = 0.5;
        }
    }

    createCosmicWave(payload = {}) {
        return !!this.acquireReactiveEffect(
            'wave',
            this.cosmicWaves,
            this.buildCosmicWaveEffect,
            this.resetCosmicWaveEffect,
            payload,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Update Systems
    // ─────────────────────────────────────────────────────────────────────────

    updateNebulas(deltaTime) {
        this.nebulaPlanes.forEach((nebula) => {
            const reactiveSpeed = 1.0 + this.effectState.nebulaDefinition * 0.45;
            nebula.position.x += nebula.userData.speed * reactiveSpeed * deltaTime;
            if (nebula.position.x > nebula.userData.wrapBoundary) {
                nebula.position.x = -nebula.userData.wrapBoundary;
            }
        });
    }

    updateEffects(deltaTime) {
        const decay = 0.95 ** (deltaTime * 60);

        this.effectState.starBurstIntensity *= decay;
        this.effectState.mountainPulse *= decay;
        this.effectState.mountainShockwave *= decay;
        this.effectState.cosmicRiftIntensity *= decay;
        this.effectState.spiritSurge *= decay;
        this.effectState.nebulaBoost *= decay;
        this.effectState.nebulaColorShift *= decay;
        this.effectState.nebulaDefinition *= decay;
        this.effectState.bloomBoost *= decay;
        this.effectState.ambientScatter *= decay;
        this.effectState.ambientSwirl *= decay;
        this.effectState.cameraShake *= 0.9 ** (deltaTime * 60);

        if (this.isWebGPU && this.materialFactories) {
            if (this.starfieldNodeData) {
                this.starfieldNodeData.uniforms.uEventBoost.value = this.effectState.starBurstIntensity;
                if (this.starfieldNodeData.uniforms.uDiffractionStrength) {
                    const baseDiffraction = this.qualityPreset.enableDiffraction ? 0.18 : 0.0;
                    this.starfieldNodeData.uniforms.uDiffractionStrength.value = baseDiffraction
                        + this.effectState.starBurstIntensity * 0.12;
                }
                if (this.starfieldNodeData.uniforms.uDepthGlowStrength) {
                    this.starfieldNodeData.uniforms.uDepthGlowStrength.value = this.qualityPreset.enableDiffraction
                        ? 0.9 + this.effectState.starBurstIntensity * 0.2
                        : 0.55;
                }
            }
            this.mountains.forEach((m) => {
                if (m.userData.nodeData) {
                    m.userData.nodeData.uniforms.uPulseIntensity.value = this.effectState.mountainPulse;
                    m.userData.nodeData.uniforms.uShockwave.value = this.effectState.mountainShockwave;
                    if (m.userData.nodeData.uniforms.uRidgeStrength) {
                        const baseRidge = m.userData.baseRidgeStrength ?? 0.25;
                        m.userData.nodeData.uniforms.uRidgeStrength.value = baseRidge
                            * (0.9 + this.effectState.mountainPulse * 0.8 + this.effectState.cosmicRiftIntensity * 0.4);
                    }
                    if (m.userData.nodeData.uniforms.uSnowAmount) {
                        const baseSnow = m.userData.baseSnowAmount ?? 0.22;
                        m.userData.nodeData.uniforms.uSnowAmount.value = baseSnow
                            * (0.95 + this.effectState.nebulaDefinition * 0.35);
                    }
                }
            });
            if (this.spiritNodeData) {
                this.spiritNodeData.uniforms.uSurgeIntensity.value = this.effectState.spiritSurge;
            }
            this.nebulaPlanes.forEach((n) => {
                if (n.userData.nodeData) {
                    n.userData.nodeData.uniforms.uPulse.value = this.effectState.nebulaBoost;
                    if (n.userData.nodeData.uniforms.uColorShift) {
                        n.userData.nodeData.uniforms.uColorShift.value = this.effectState.nebulaColorShift;
                    }
                    if (n.userData.nodeData.uniforms.uDefinition) {
                        n.userData.nodeData.uniforms.uDefinition.value = this.effectState.nebulaDefinition;
                    }
                }
            });
            if (this.ambientParticles?.userData?.nodeData?.uniforms?.uOpacity) {
                this.ambientParticles.userData.nodeData.uniforms.uOpacity.value = 0.42
                    + this.effectState.ambientSwirl * 0.16;
            }
            if (this.groundFog?.userData?.nodeData?.uniforms) {
                const fogUniforms = this.groundFog.userData.nodeData.uniforms;
                if (fogUniforms.uPulse) {
                    fogUniforms.uPulse.value = this.effectState.nebulaDefinition;
                }
                if (fogUniforms.uSwirl) {
                    fogUniforms.uSwirl.value = this.effectState.ambientSwirl;
                }
            }
        } else {
            if (this.starfield) {
                this.starfield.material.uniforms.uEventBoost.value = this.effectState.starBurstIntensity;
            }
            this.mountains.forEach((m) => {
                m.material.uniforms.uPulseIntensity.value = this.effectState.mountainPulse;
                m.material.uniforms.uShockwave.value = this.effectState.mountainShockwave;
            });
            // Spirit surge updates removed
            this.nebulaPlanes.forEach((n) => {
                n.material.uniforms.uPulse.value = this.effectState.nebulaBoost;
            });
            if (this.groundFog?.material?.uniforms) {
                const fogUniforms = this.groundFog.material.uniforms;
                if (fogUniforms.uPulse) {
                    fogUniforms.uPulse.value = this.effectState.nebulaDefinition;
                }
                if (fogUniforms.uSwirl) {
                    fogUniforms.uSwirl.value = this.effectState.ambientSwirl;
                }
            }
        }

        const dynamicBloomStrength = this.qualityPreset.bloomStrength + this.effectState.bloomBoost * 0.5;
        if (this.bloomPass) {
            this.bloomPass.strength = dynamicBloomStrength;
        }
        if (this.isWebGPU && this.postProcessing && this.postProfile?.enabled) {
            try {
                this.postProcessing.updateDynamic?.({
                    time: this.time,
                    bloomStrength: dynamicBloomStrength,
                });
            } catch (error) {
                this.disablePostRuntime('updateEffects', error);
            }
        }

        this.updateStarBursts();
        this.updateCelestialBeams();
        this.updateCosmicRifts();
        this.updateCosmicWaves();
    }

    updateStarBursts() {
        for (let i = this.starBursts.length - 1; i >= 0; i--) {
            const burst = this.starBursts[i];
            const elapsed = this.time - burst.userData.startTime;
            if (elapsed > burst.userData.duration) {
                this.releaseReactiveEffect('starBurst', this.starBursts, i, burst);
            } else if (burst.userData.nodeData) {
                burst.userData.nodeData.uniforms.uTime.value = elapsed;
            } else {
                burst.material.uniforms.uTime.value = elapsed;
            }
        }
    }

    updateCelestialBeams() {
        for (let i = this.celestialBeams.length - 1; i >= 0; i--) {
            const beam = this.celestialBeams[i];
            const elapsed = this.time - beam.userData.startTime;
            if (elapsed > beam.userData.duration) {
                this.releaseReactiveEffect('beam', this.celestialBeams, i, beam);
            } else {
                const progress = elapsed / beam.userData.duration;
                if (beam.userData.nodeData) {
                    beam.userData.nodeData.uniforms.uTime.value = elapsed;
                    beam.userData.nodeData.uniforms.uOpacity.value = 1.0 - progress;
                    if (beam.userData.nodeData.uniforms.uVolumetricPulse) {
                        beam.userData.nodeData.uniforms.uVolumetricPulse.value = this.effectState.cosmicRiftIntensity;
                    }
                } else {
                    beam.material.uniforms.uTime.value = elapsed;
                    beam.material.uniforms.uOpacity.value = 1.0 - progress;
                }
            }
        }
    }

    updateCosmicRifts() {
        for (let i = this.cosmicRifts.length - 1; i >= 0; i--) {
            const rift = this.cosmicRifts[i];
            const elapsed = this.time - rift.userData.startTime;
            if (elapsed > rift.userData.duration) {
                this.releaseReactiveEffect('rift', this.cosmicRifts, i, rift);
            } else {
                const progress = elapsed / rift.userData.duration;
                if (rift.userData.nodeData) {
                    rift.userData.nodeData.uniforms.uTime.value = elapsed;
                    rift.userData.nodeData.uniforms.uOpacity.value = 1.0 - progress;
                } else {
                    rift.material.uniforms.uTime.value = elapsed;
                    rift.material.uniforms.uOpacity.value = 1.0 - progress;
                }
            }
        }
    }

    updateCosmicWaves() {
        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];
            const elapsed = this.time - wave.userData.startTime;
            if (elapsed > wave.userData.duration) {
                this.releaseReactiveEffect('wave', this.cosmicWaves, i, wave);
            } else {
                const progress = elapsed / wave.userData.duration;
                if (wave.userData.nodeData) {
                    wave.userData.nodeData.uniforms.uTime.value = elapsed;
                    wave.userData.nodeData.uniforms.uOpacity.value = 0.5 * (1.0 - progress);
                } else {
                    wave.material.uniforms.uTime.value = elapsed;
                    wave.material.uniforms.uOpacity.value = 0.5 * (1.0 - progress);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Meteor / Shooting Star System
    // ─────────────────────────────────────────────────────────────────────────

    createTrailGeometry(trailSegments) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(trailSegments * 3);
        const trailPositions = new Float32Array(trailSegments);
        const slotOffsets = new Float32Array(trailSegments);

        const denom = Math.max(1, trailSegments - 1);
        for (let i = 0; i < trailSegments; i += 1) {
            trailPositions[i] = i / denom;
            slotOffsets[i] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aTrailPosition', new THREE.BufferAttribute(trailPositions, 1));
        geometry.setAttribute('aSlotOffset', new THREE.BufferAttribute(slotOffsets, 1));
        return geometry;
    }

    setScalarAttribute(attribute, value) {
        if (!attribute) return;
        const array = attribute.array;
        for (let i = 0; i < array.length; i += 1) {
            array[i] = value;
        }
        attribute.needsUpdate = true;
    }

    setTrailSlotOffset(geometry, slotOffset) {
        this.setScalarAttribute(geometry?.attributes?.aSlotOffset, slotOffset);
    }

    setDebrisSlotOffset(geometry, slotOffset) {
        this.setScalarAttribute(geometry?.attributes?.aComputeOffset, slotOffset);
    }

    setTrailPositions(geometry, trailSegments, headX, headY, headZ, angle, direction, trailLength) {
        const positionAttribute = geometry?.attributes?.position;
        if (!positionAttribute) return;
        const positions = positionAttribute.array;
        const denom = Math.max(1, trailSegments - 1);
        // angle is constant for the meteor's lifetime — hoist cos/sin out of the per-segment loop
        // (40-64 iters/meteor/frame on the CPU-fallback path). Multiply order is preserved, so the
        // written positions are bit-identical.
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        for (let i = 0; i < trailSegments; i += 1) {
            const t = i / denom;
            const offset = t * trailLength;
            positions[i * 3] = headX - cosA * offset * direction;
            positions[i * 3 + 1] = headY - sinA * offset;
            positions[i * 3 + 2] = headZ;
        }
        positionAttribute.needsUpdate = true;
    }

    setHeadPosition(head, x, y, z) {
        if (head?.isInstancedMesh) {
            // count=1 head with permanently-identity rotation/scale (only translation changes). The
            // instanceMatrix is initialised to identity+translation in _createInstancedParticleMesh
            // and only this method updates it, so write the translation directly into columns
            // 12/13/14 instead of composing a full Object3D matrix (skips 4 method calls + a 4x4
            // compose per head per frame). Byte-identical to the dummy.compose(pos, identity, 1) path.
            const m = head.instanceMatrix.array;
            m[12] = x;
            m[13] = y;
            m[14] = z;
            head.instanceMatrix.needsUpdate = true;
            return;
        }
        const positionAttribute = head?.geometry?.attributes?.position ?? head?.attributes?.position;
        if (!positionAttribute) return;
        const position = positionAttribute.array;
        position[0] = x;
        position[1] = y;
        position[2] = z;
        positionAttribute.needsUpdate = true;
    }

    buildMeteorEffect() {
        const trailSegments = this.qualityPreset.meteorTrailSegments || 40;
        const trailGeometry = this.createTrailGeometry(trailSegments);

        let trailMaterial;
        let headMaterial;
        let trailNodeData = null;
        let headNodeData = null;

        if (this.isWebGPU && this.materialFactories) {
            const trailResult = this.materialFactories.createMeteorTrailNodeMaterial({
                meteorTrailCompute: this.meteorTrailBatchCompute,
                atmosphereGlow: this.qualityPreset.meteorAtmosphereGlow || 0,
                slotAttributeName: 'aSlotOffset',
            });
            trailMaterial = trailResult.material;
            trailNodeData = trailResult;

            const headResult = this.materialFactories.createMeteorHeadNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                atmosphereGlow: this.qualityPreset.meteorAtmosphereGlow || 0,
            });
            headMaterial = headResult.material;
            headNodeData = headResult;
        } else {
            trailMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uProgress: { value: 0 },
                },
                vertexShader: meteorTrailVertexShader,
                fragmentShader: meteorTrailFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            headMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uProgress: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: meteorHeadVertexShader,
                fragmentShader: meteorHeadFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        const trail = new THREE.Line(trailGeometry, trailMaterial);
        trail.renderOrder = 500;

        const headGeometry = new THREE.BufferGeometry();
        headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -9999]), 3));
        const head = this._createInstancedParticleMesh(headGeometry, headMaterial);
        head.renderOrder = 501;

        const meteor = new THREE.Group();
        meteor.add(trail);
        meteor.add(head);

        meteor.userData = {
            startTime: 0,
            duration: 0,
            startX: 0,
            startY: 0,
            startZ: 0,
            angle: 0,
            direction: 1,
            speed: 0,
            trailLength: 0,
            trailSegments,
            trail,
            head,
            trailNodeData,
            headNodeData,
            trailSlot: -1,
            reactive: false,
        };

        return meteor;
    }

    resetMeteorEffect(meteor, payload = {}) {
        const data = meteor.userData;
        const origin = payload?.origin || this.lastReactiveOrigin;
        data.reactive = payload?.reactive === true;
        data.startTime = this.time;
        data.duration = 2.5 + this.random() * 1.5;
        data.startZ = -1800 - this.random() * 500;
        data.direction = this.random() > 0.5 ? 1 : -1;
        if (Number.isFinite(origin?.x) && Number.isFinite(origin?.y)) {
            const approachDistance = 420 + this.random() * 280;
            data.startX = origin.x - data.direction * approachDistance;
            data.startY = THREE.MathUtils.clamp(origin.y + 300 + this.random() * 160, 180, 470);
            data.angle = Math.atan2(origin.y - data.startY, approachDistance);
        } else {
            data.startX = (this.random() - 0.5) * 1200;
            data.startY = 200 + this.random() * 250;
            data.angle = -0.3 - this.random() * 0.5;
        }
        data.speed = 400 + this.random() * 200;
        data.trailLength = 150 + this.random() * 100;

        if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
            this.meteorTrailBatchCompute.releaseSlot(data.trailSlot);
            data.trailSlot = -1;
        }

        if (
            this.meteorTrailBatchCompute
            && this.shouldUseCompute()
            && this.qualityPreset.computeMeteorTrails === true
        ) {
            const slot = this.meteorTrailBatchCompute.acquireSlot();
            if (slot >= 0) {
                data.trailSlot = slot;
                this.setTrailSlotOffset(
                    data.trail.geometry,
                    this.meteorTrailBatchCompute.getSlotOffset(slot),
                );
                this.meteorTrailBatchCompute.setLinearTrailState(slot, {
                    headX: data.startX,
                    headY: data.startY,
                    headZ: data.startZ,
                    angle: data.angle,
                    direction: data.direction,
                    trailLength: data.trailLength,
                });
            } else {
                this.reactiveMetrics.poolMisses += 1;
                this.setTrailSlotOffset(data.trail.geometry, 0);
            }
        } else {
            this.setTrailSlotOffset(data.trail.geometry, 0);
        }

        this.setTrailPositions(
            data.trail.geometry,
            data.trailSegments,
            data.startX,
            data.startY,
            data.startZ,
            data.angle,
            data.direction,
            data.trailLength,
        );
        this.setHeadPosition(data.head, data.startX, data.startY, data.startZ);

        if (data.trailNodeData) {
            data.trailNodeData.uniforms.uTime.value = this.time;
            data.trailNodeData.uniforms.uProgress.value = 0;
        } else if (data.trail.material?.uniforms) {
            data.trail.material.uniforms.uTime.value = this.time;
            data.trail.material.uniforms.uProgress.value = 0;
        }
        if (data.headNodeData) {
            data.headNodeData.uniforms.uProgress.value = 0;
        } else if (data.head.material?.uniforms) {
            data.head.material.uniforms.uProgress.value = 0;
        }
    }

    createMeteor(payload = {}) {
        return !!this.acquireReactiveEffect(
            'meteor',
            this.meteors,
            this.buildMeteorEffect,
            this.resetMeteorEffect,
            payload,
        );
    }

    releaseMeteor(index, meteor) {
        const data = meteor.userData;
        if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
            this.meteorTrailBatchCompute.releaseSlot(data.trailSlot);
            data.trailSlot = -1;
        }
        this.releaseReactiveEffect('meteor', this.meteors, index, meteor);
    }

    updateMeteors() {
        if (this.time - this.lastMeteorTime > this.nextMeteorDelay) {
            const r = this.random();
            const spawnCount = this.activeQualityLevel === 'Extreme' && r > 0.82 ? 2 : 1;
            for (let s = 0; s < spawnCount; s += 1) {
                this.createMeteor();
            }
            this.lastMeteorTime = this.time;
            this.nextMeteorDelay = 4 + this.random() * 3;
        }

        for (let i = this.meteors.length - 1; i >= 0; i -= 1) {
            const meteor = this.meteors[i];
            const data = meteor.userData;
            const elapsed = this.time - data.startTime;
            const progress = elapsed / data.duration;

            if (progress > 1.0) {
                this.releaseMeteor(i, meteor);
                continue;
            }

            const travelDistance = elapsed * data.speed;
            const headX = data.startX + Math.cos(data.angle) * travelDistance * data.direction;
            const headY = data.startY + Math.sin(data.angle) * travelDistance;
            const headZ = data.startZ;

            if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
                this.meteorTrailBatchCompute.setLinearTrailState(data.trailSlot, {
                    headX,
                    headY,
                    headZ,
                    angle: data.angle,
                    direction: data.direction,
                    trailLength: data.trailLength,
                });
            } else {
                this.setTrailPositions(
                    data.trail.geometry,
                    data.trailSegments,
                    headX,
                    headY,
                    headZ,
                    data.angle,
                    data.direction,
                    data.trailLength,
                );
            }

            if (data.trailNodeData) {
                data.trailNodeData.uniforms.uTime.value = this.time;
                data.trailNodeData.uniforms.uProgress.value = progress;
                if (data.trailNodeData.uniforms.uAtmosphereGlow) {
                    data.trailNodeData.uniforms.uAtmosphereGlow.value = (this.qualityPreset.meteorAtmosphereGlow || 0)
                        * (1.0 - progress * 0.45);
                }
            } else {
                data.trail.material.uniforms.uTime.value = this.time;
                data.trail.material.uniforms.uProgress.value = progress;
            }
            if (data.headNodeData) {
                data.headNodeData.uniforms.uProgress.value = progress;
                if (data.headNodeData.uniforms.uAtmosphereGlow) {
                    data.headNodeData.uniforms.uAtmosphereGlow.value = (this.qualityPreset.meteorAtmosphereGlow || 0)
                        * (1.0 - progress * 0.5);
                }
            } else {
                data.head.material.uniforms.uProgress.value = progress;
            }

            this.setHeadPosition(data.head, headX, headY, headZ);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Meteor Crash System (Combo 6+)
    // ─────────────────────────────────────────────────────────────────────────

    buildMeteorCrashEffect() {
        const trailSegments = this.qualityPreset.meteorTrailSegments || 50;
        const trailGeometry = this.createTrailGeometry(trailSegments);
        const debrisCount = this.qualityPreset.debrisPerCrash || 40;
        const dustCount = 25;

        let trailMaterial;
        let headMaterial;
        let trailNodeData = null;
        let headNodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const trailResult = this.materialFactories.createCrashMeteorTrailNodeMaterial({
                meteorTrailCompute: this.meteorTrailBatchCompute,
                atmosphereGlow: (this.qualityPreset.meteorAtmosphereGlow || 0) + 0.1,
                slotAttributeName: 'aSlotOffset',
            });
            trailMaterial = trailResult.material;
            trailNodeData = trailResult;

            const headResult = this.materialFactories.createCrashMeteorHeadNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                atmosphereGlow: (this.qualityPreset.meteorAtmosphereGlow || 0) + 0.1,
            });
            headMaterial = headResult.material;
            headNodeData = headResult;
        } else {
            trailMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uProgress: { value: 0 },
                },
                vertexShader: crashMeteorTrailVertexShader,
                fragmentShader: crashMeteorTrailFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            headMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uProgress: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: crashMeteorHeadVertexShader,
                fragmentShader: crashMeteorHeadFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        const trail = new THREE.Line(trailGeometry, trailMaterial);
        trail.renderOrder = 510;

        const headGeometry = new THREE.BufferGeometry();
        headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -9999]), 3));
        const head = this._createInstancedParticleMesh(headGeometry, headMaterial);
        head.renderOrder = 511;

        const debrisGeometry = new THREE.BufferGeometry();
        const debrisVelocityArray = new Float32Array(debrisCount * 3);
        const debrisSizeArray = new Float32Array(debrisCount);
        const debrisRotationArray = new Float32Array(debrisCount);
        for (let i = 0; i < debrisCount; i += 1) {
            const i3 = i * 3;
            const angle = this.random() * Math.PI * 2;
            const upAngle = this.random() * Math.PI * 0.6;
            const speed = 250 + this.random() * 400;
            debrisVelocityArray[i3] = Math.cos(angle) * Math.sin(upAngle) * speed;
            debrisVelocityArray[i3 + 1] = Math.cos(upAngle) * speed + 50;
            debrisVelocityArray[i3 + 2] = Math.sin(angle) * Math.sin(upAngle) * speed * 0.3;
            debrisSizeArray[i] = 12 + this.random() * 20;
            debrisRotationArray[i] = this.random() * Math.PI * 2;
        }
        debrisGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(debrisCount * 3), 3));
        debrisGeometry.setAttribute('aVelocity', new THREE.BufferAttribute(debrisVelocityArray, 3));
        debrisGeometry.setAttribute('aSize', new THREE.BufferAttribute(debrisSizeArray, 1));
        debrisGeometry.setAttribute('aRotation', new THREE.BufferAttribute(debrisRotationArray, 1));
        debrisGeometry.setAttribute('aComputeOffset', new THREE.BufferAttribute(new Float32Array(debrisCount), 1));

        let debrisMaterial;
        let debrisNodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const debrisResult = this.materialFactories.createDebrisNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                debrisCompute: this.debrisBatchCompute,
                slotAttributeName: 'aComputeOffset',
            });
            debrisMaterial = debrisResult.material;
            debrisNodeData = debrisResult;
        } else {
            debrisMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: debrisVertexShader,
                fragmentShader: debrisFragmentShader,
                transparent: true,
                depthWrite: false,
            });
        }
        const debris = this._createInstancedParticleMesh(debrisGeometry, debrisMaterial);
        debris.renderOrder = 520;

        let shockwaveMaterial;
        let shockwaveNodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const shockwaveResult = this.materialFactories.createShockwaveNodeMaterial();
            shockwaveMaterial = shockwaveResult.material;
            shockwaveNodeData = shockwaveResult;
        } else {
            shockwaveMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uProgress: { value: 0 },
                    uOpacity: { value: 1.0 },
                },
                vertexShader: shockwaveVertexShader,
                fragmentShader: shockwaveFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
        }
        const shockwave = new THREE.Mesh(this.geometryCache.shockwavePlane, shockwaveMaterial);
        shockwave.renderOrder = 515;

        const dustGeometry = new THREE.BufferGeometry();
        const dustSizeArray = new Float32Array(dustCount);
        const dustPhaseArray = new Float32Array(dustCount);
        const dustVelocityArray = new Float32Array(dustCount * 3);
        for (let i = 0; i < dustCount; i += 1) {
            const i3 = i * 3;
            dustSizeArray[i] = 100 + this.random() * 120;
            dustPhaseArray[i] = this.random() * Math.PI * 2;
            dustVelocityArray[i3] = (this.random() - 0.5) * 80;
            dustVelocityArray[i3 + 1] = this.random() * 40;
            dustVelocityArray[i3 + 2] = this.random() * 20;
        }
        dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
        dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(dustSizeArray, 1));
        dustGeometry.setAttribute('aPhase', new THREE.BufferAttribute(dustPhaseArray, 1));
        dustGeometry.setAttribute('aVelocity', new THREE.BufferAttribute(dustVelocityArray, 3));

        let dustMaterial;
        let dustNodeData = null;
        if (this.isWebGPU && this.materialFactories) {
            const dustResult = this.materialFactories.createDustCloudNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
            });
            dustMaterial = dustResult.material;
            dustNodeData = dustResult;
        } else {
            dustMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: dustCloudVertexShader,
                fragmentShader: dustCloudFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
            });
        }
        const dustCloud = this._createInstancedParticleMesh(dustGeometry, dustMaterial);
        dustCloud.renderOrder = 505;

        const crash = new THREE.Group();
        crash.add(trail);
        crash.add(head);
        crash.add(shockwave);
        crash.add(debris);
        crash.add(dustCloud);

        crash.userData = {
            phase: 'idle',
            startTime: 0,
            duration: 0.8,
            explosionStartTime: 0,
            startX: 0,
            startY: 0,
            startZ: 0,
            targetX: 0,
            targetY: 0,
            targetZ: 0,
            trailLength: 200,
            trailSegments,
            trail,
            head,
            trailNodeData,
            headNodeData,
            trailSlot: -1,
            debris,
            debrisNodeData,
            debrisSlot: -1,
            debrisCount,
            shockwave,
            shockwaveNodeData,
            dustCloud,
            dustNodeData,
        };

        shockwave.visible = false;
        debris.visible = false;
        dustCloud.visible = false;

        return crash;
    }

    resetMeteorCrashEffect(crash, payload = {}) {
        const data = crash.userData;
        // Prefer foreground/mid peaks (z >= -1000) — distant peaks make the trail too small to read.
        const candidateMountains = this.mountains.filter((m) => m.position.z >= -1000);
        const pool = candidateMountains.length > 0 ? candidateMountains : this.mountains;
        const originX = payload?.origin?.x;
        let targetMountain = pool[Math.floor(this.random() * pool.length)];
        if (Number.isFinite(originX)) {
            targetMountain = pool.reduce((closest, mountain) => {
                const currentDistance = Math.abs(mountain.position.x - originX);
                const closestDistance = Math.abs(closest.position.x - originX);
                return currentDistance < closestDistance ? mountain : closest;
            }, pool[0]);
        }
        data.targetX = targetMountain.position.x + (this.random() - 0.5) * 200;
        // Land on the visible peak ridge (mountain.position.y is the base, peaks rise ~380-520 above it).
        data.targetY = targetMountain.position.y + 460 + this.random() * 80;
        data.targetZ = targetMountain.position.z + 100;

        data.startX = data.targetX + (this.random() > 0.5 ? 1 : -1) * (500 + this.random() * 300);
        data.startY = 650 + this.random() * 150;
        data.startZ = data.targetZ;
        data.startTime = this.time;
        data.phase = 'descent';
        data.duration = 1.4;
        data.trailLength = 360;
        data.explosionStartTime = 0;

        data.trail.visible = true;
        data.head.visible = true;
        data.shockwave.visible = false;
        data.debris.visible = false;
        data.dustCloud.visible = false;

        if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
            this.meteorTrailBatchCompute.releaseSlot(data.trailSlot);
            data.trailSlot = -1;
        }
        if (data.debrisSlot >= 0 && this.debrisBatchCompute) {
            this.debrisBatchCompute.releaseSlot(data.debrisSlot);
            data.debrisSlot = -1;
        }

        if (this.meteorTrailBatchCompute && this.shouldUseCompute() && this.qualityPreset.computeMeteorTrails === true) {
            const slot = this.meteorTrailBatchCompute.acquireSlot();
            if (slot >= 0) {
                data.trailSlot = slot;
                this.setTrailSlotOffset(
                    data.trail.geometry,
                    this.meteorTrailBatchCompute.getSlotOffset(slot),
                );
            } else {
                this.reactiveMetrics.poolMisses += 1;
                this.setTrailSlotOffset(data.trail.geometry, 0);
            }
        } else {
            this.setTrailSlotOffset(data.trail.geometry, 0);
        }

        const trailAngle = Math.atan2(data.targetY - data.startY, data.targetX - data.startX);
        this.setTrailPositions(
            data.trail.geometry,
            data.trailSegments,
            data.startX,
            data.startY,
            data.startZ,
            trailAngle,
            1,
            data.trailLength,
        );
        this.setHeadPosition(data.head, data.startX, data.startY, data.startZ);

        if (data.trailNodeData) {
            data.trailNodeData.uniforms.uTime.value = this.time;
            data.trailNodeData.uniforms.uProgress.value = 0;
        } else if (data.trail.material?.uniforms) {
            data.trail.material.uniforms.uTime.value = this.time;
            data.trail.material.uniforms.uProgress.value = 0;
        }
        if (data.headNodeData) {
            data.headNodeData.uniforms.uProgress.value = 0;
        } else if (data.head.material?.uniforms) {
            data.head.material.uniforms.uProgress.value = 0;
        }
    }

    createMeteorCrash(payload = {}) {
        return !!this.acquireReactiveEffect(
            'crash',
            this.meteorCrashes,
            this.buildMeteorCrashEffect,
            this.resetMeteorCrashEffect,
            payload,
        );
    }

    releaseMeteorCrash(index, crash) {
        const data = crash.userData;
        if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
            this.meteorTrailBatchCompute.releaseSlot(data.trailSlot);
            data.trailSlot = -1;
        }
        if (data.debrisSlot >= 0 && this.debrisBatchCompute) {
            this.debrisBatchCompute.releaseSlot(data.debrisSlot);
            data.debrisSlot = -1;
        }
        this.releaseReactiveEffect('crash', this.meteorCrashes, index, crash);
    }

    createImpactExplosion(crash) {
        const data = crash.userData;
        const { targetX, targetY, targetZ } = data;

        if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
            this.meteorTrailBatchCompute.releaseSlot(data.trailSlot);
            data.trailSlot = -1;
        }

        data.phase = 'explosion';
        data.explosionStartTime = this.time;
        data.trail.visible = false;
        data.head.visible = false;
        data.debris.visible = true;
        data.shockwave.visible = true;
        data.dustCloud.visible = true;

        const debrisPositions = this.getParticlePositionArray(data.debris);
        const debrisVelocities = data.debris.geometry.attributes.aVelocity.array;
        const debrisSizes = data.debris.geometry.attributes.aSize.array;
        const debrisRotations = data.debris.geometry.attributes.aRotation.array;
        const debrisZ = targetZ + 50;
        for (let i = 0; i < data.debrisCount; i += 1) {
            const i3 = i * 3;
            debrisPositions[i3] = targetX;
            debrisPositions[i3 + 1] = targetY;
            debrisPositions[i3 + 2] = debrisZ;
        }

        if (this.debrisBatchCompute && this.shouldUseCompute() && this.qualityPreset.computeDebris === true) {
            let slot = data.debrisSlot;
            if (slot < 0) slot = this.debrisBatchCompute.acquireSlot();
            if (slot >= 0) {
                data.debrisSlot = slot;
                this.setDebrisSlotOffset(
                    data.debris.geometry,
                    this.debrisBatchCompute.getSlotOffset(slot),
                );
                this.debrisBatchCompute.triggerDebrisSlot(
                    slot,
                    debrisPositions,
                    debrisVelocities,
                    debrisSizes,
                    debrisRotations,
                );
            } else {
                this.reactiveMetrics.poolMisses += 1;
                this.setDebrisSlotOffset(data.debris.geometry, 0);
            }
        } else {
            this.syncInstancedParticlePositions(data.debris);
            this.setDebrisSlotOffset(data.debris.geometry, 0);
        }

        data.shockwave.position.set(targetX, targetY, targetZ + 60);
        if (data.shockwaveNodeData) {
            data.shockwaveNodeData.uniforms.uProgress.value = 0;
            data.shockwaveNodeData.uniforms.uOpacity.value = 1;
        } else if (data.shockwave.material?.uniforms) {
            data.shockwave.material.uniforms.uProgress.value = 0;
            data.shockwave.material.uniforms.uOpacity.value = 1;
        }

        const dustPositions = this.getParticlePositionArray(data.dustCloud);
        const dustCount = data.dustCloud.geometry.attributes.aSize.count;
        const dustImpactZ = targetZ + 40;
        for (let i = 0; i < dustCount; i += 1) {
            const i3 = i * 3;
            dustPositions[i3] = targetX + (this.random() - 0.5) * 150;
            dustPositions[i3 + 1] = targetY + this.random() * 60;
            dustPositions[i3 + 2] = dustImpactZ;
        }
        this.syncInstancedParticlePositions(data.dustCloud);

        this.addEffectState({
            bloomBoost: 0.3,
            mountainShockwave: 1.5,
            mountainPulse: 1.0,
            cameraShake: 0.85 * (this.qualityPreset.cameraShakeScale || 1.0),
            nebulaDefinition: 0.65,
            nebulaColorShift: 0.45,
        });
    }

    updateMeteorCrashes() {
        for (let i = this.meteorCrashes.length - 1; i >= 0; i -= 1) {
            const crash = this.meteorCrashes[i];
            const data = crash.userData;
            const elapsed = this.time - data.startTime;

            if (data.phase === 'descent') {
                const progress = elapsed / data.duration;
                if (progress >= 1.0) {
                    this.createImpactExplosion(crash);
                    continue;
                }

                const easedProgress = progress * progress;
                const currentX = data.startX + (data.targetX - data.startX) * easedProgress;
                const currentY = data.startY + (data.targetY - data.startY) * easedProgress;
                const currentZ = data.startZ;

                const dx = data.targetX - data.startX;
                const dy = data.targetY - data.startY;
                const trailAngle = Math.atan2(dy, dx);

                if (data.trailSlot >= 0 && this.meteorTrailBatchCompute) {
                    this.meteorTrailBatchCompute.setTargetTrailState(data.trailSlot, {
                        startX: data.startX,
                        startY: data.startY,
                        targetX: data.targetX,
                        targetY: data.targetY,
                        progress,
                        headZ: currentZ,
                        angle: trailAngle,
                        direction: 1,
                        trailLength: data.trailLength,
                    });
                } else {
                    this.setTrailPositions(
                        data.trail.geometry,
                        data.trailSegments,
                        currentX,
                        currentY,
                        currentZ,
                        trailAngle,
                        1,
                        data.trailLength,
                    );
                }

                if (data.trailNodeData) {
                    data.trailNodeData.uniforms.uTime.value = this.time;
                    data.trailNodeData.uniforms.uProgress.value = progress;
                    if (data.trailNodeData.uniforms.uAtmosphereGlow) {
                        data.trailNodeData.uniforms.uAtmosphereGlow.value = ((this.qualityPreset.meteorAtmosphereGlow || 0) + 0.1)
                            * (1.0 - progress * 0.3);
                    }
                } else {
                    data.trail.material.uniforms.uTime.value = this.time;
                    data.trail.material.uniforms.uProgress.value = progress;
                }
                if (data.headNodeData) {
                    data.headNodeData.uniforms.uProgress.value = progress;
                    if (data.headNodeData.uniforms.uAtmosphereGlow) {
                        data.headNodeData.uniforms.uAtmosphereGlow.value = ((this.qualityPreset.meteorAtmosphereGlow || 0) + 0.1)
                            * (1.0 - progress * 0.25);
                    }
                } else {
                    data.head.material.uniforms.uProgress.value = progress;
                }

                this.setHeadPosition(data.head, currentX, currentY, currentZ);
            } else if (data.phase === 'explosion') {
                const explosionElapsed = this.time - data.explosionStartTime;
                const explosionDuration = 4.5;
                if (explosionElapsed > explosionDuration) {
                    this.releaseMeteorCrash(i, crash);
                    continue;
                }

                if (data.debrisNodeData) {
                    if (data.debrisSlot < 0) {
                        data.debrisNodeData.uniforms.uTime.value = explosionElapsed;
                    }
                } else if (data.debris.material?.uniforms) {
                    data.debris.material.uniforms.uTime.value = explosionElapsed;
                }

                const shockwaveProgress = Math.min(explosionElapsed / 2.5, 1.0);
                if (data.shockwaveNodeData) {
                    data.shockwaveNodeData.uniforms.uProgress.value = shockwaveProgress;
                    data.shockwaveNodeData.uniforms.uOpacity.value = 1.0 - shockwaveProgress;
                } else if (data.shockwave.material?.uniforms) {
                    data.shockwave.material.uniforms.uProgress.value = shockwaveProgress;
                    data.shockwave.material.uniforms.uOpacity.value = 1.0 - shockwaveProgress;
                }

                if (data.dustNodeData) {
                    data.dustNodeData.uniforms.uTime.value = explosionElapsed;
                } else if (data.dustCloud.material?.uniforms) {
                    data.dustCloud.material.uniforms.uTime.value = explosionElapsed;
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            this.animationFrameId = requestAnimationFrame(animate);

            // Honor engine-wide background-tab / pause throttling like every other theme's
            // safeAnimate() (window.isRenderingPaused → skip the frame; isRenderingReduced → ~10fps).
            // The rAF is already scheduled above so the loop self-heals; bailing here stops this heavy
            // scene from burning GPU (uniform pushes + 5 compute dispatches + post) while backgrounded.
            // Foreground output is unchanged.
            if (!this.shouldRenderFrame()) {
                this.baselineLastWallTimeMs = null;
                return;
            }

            const wallNowMs = performance.now();
            const wallDeltaSeconds = Number.isFinite(this.baselineLastWallTimeMs)
                ? (wallNowMs - this.baselineLastWallTimeMs) / 1000
                : null;
            this.baselineLastWallTimeMs = wallNowMs;

            let deltaTime;
            if (this.fixedDeltaSeconds) {
                deltaTime = this.fixedDeltaSeconds;
                this.fixedElapsedTime += deltaTime;
                this.time = this.fixedElapsedTime;
            } else {
                // Clamp so a long stall (alt-tab resume, GC hitch, throttled frame) can't teleport
                // nebulas/particles or fire a meteor-spawn storm in one giant catch-up step. Normal
                // frames are far below this cap, so steady-state motion is identical.
                deltaTime = Math.min(this.clock.getDelta(), 1 / 30);
                this.time += deltaTime;
            }

            // Subtle camera drift animation for immersive feel
            this.updateCameraAnimation(deltaTime);
            this.updateLunarReaction();

            // Update time uniforms — branch by backend
            if (this.isWebGPU && this.materialFactories) {
                if (this.starfieldNodeData) {
                    this.starfieldNodeData.uniforms.uTime.value = this.time;
                }
                if (this.spiritNodeData) {
                    this.spiritNodeData.uniforms.uTime.value = this.time;
                }
                if (this.ambientParticles?.userData?.nodeData?.uniforms?.uTime) {
                    this.ambientParticles.userData.nodeData.uniforms.uTime.value = this.time;
                }
                this.mountains.forEach((m) => {
                    if (m.userData.nodeData) {
                        m.userData.nodeData.uniforms.uTime.value = this.time;
                    }
                });
                if (this.groundFog?.userData?.nodeData?.uniforms?.uTime) {
                    this.groundFog.userData.nodeData.uniforms.uTime.value = this.time;
                }
            } else {
                if (this.starfield) this.starfield.material.uniforms.uTime.value = this.time;
                if (this.spirits) this.spirits.material.uniforms.uTime.value = this.time;
                this.mountains.forEach((m) => {
                    m.material.uniforms.uTime.value = this.time;
                });
                if (this.groundFog?.material?.uniforms?.uTime) {
                    this.groundFog.material.uniforms.uTime.value = this.time;
                }
            }

            this.updateNebulas(deltaTime);
            this.updateEffects(deltaTime);
            this.processReactiveQueue();
            this.updateMeteors(deltaTime); // Shooting star system
            this.updateMeteorCrashes(); // Meteor crash system
            this.updateComputeSystems(deltaTime);

            if (this.isWebGPU) {
                if (this.postProcessing) {
                    try {
                        this.postProcessing.render();
                    } catch (error) {
                        this.disablePostRuntime('render', error);
                        this.renderer.render(this.scene, this.camera);
                    }
                } else {
                    this.renderer.render(this.scene, this.camera);
                }
            } else if (this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            if (this.flags.baseline && Number.isFinite(wallDeltaSeconds)) {
                this.resolveBaselineGpuTimestamps();
                this.trackBaselineFrame(wallDeltaSeconds);
            }
        };

        animate();
    }

    updateCameraAnimation(deltaTime = 0) {
        // More pronounced camera movements for immersive, breathing feel
        // Primary drift period: ~30 seconds, secondary: ~50 seconds
        const driftSpeed = 0.04;
        const slowDrift = 0.025;

        // Smooth pointer tracking for subtle mouse parallax (frame-rate independent damping)
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, deltaTime * 2.2);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, deltaTime * 2.2);
        const parallaxX = this.smoothedPointerX * 60.0;
        const parallaxY = -this.smoothedPointerY * 30.0;

        // Horizontal drift with layered motion for organic feel
        const xDrift = Math.sin(this.time * driftSpeed) * 85
            + Math.sin(this.time * slowDrift * 0.6) * 40
            + Math.cos(this.time * 0.018 + 0.8) * 18; // Combined ~±143 units max

        // Vertical breathing movement - stronger inhale/exhale lift/drop.
        const yDrift = Math.sin(this.time * driftSpeed * 0.8 + 1.0) * 70
            + Math.cos(this.time * slowDrift * 0.5) * 35
            + Math.sin(this.time * 0.03 + 0.35) * 20; // Combined ~±125 units max

        // Deep breathing zoom — stronger forward/back movement against the mountains.
        // 1. Slow "approach/retreat" cycle (~25s period)
        const deepBreathe = Math.sin(this.time * 0.08) * 0.14; // ±14% zoom
        // 2. Mid-frequency cinematic swell (~40s period)
        const tidalBreathe = Math.sin(this.time * 0.045 + 1.2) * 0.045; // ±4.5% zoom
        // 3. Faster micro-breath (~15s period)
        const microBreathe = Math.sin(this.time * 0.14 + 0.5) * 0.055; // ±5.5% zoom
        const breathe = deepBreathe + tidalBreathe + microBreathe; // ~±24% peak

        const shakeScale = (this.qualityPreset.cameraShakeScale || 1.0) * this.effectState.cameraShake;
        const shakeX = (
            Math.sin(this.time * 51.0)
            + Math.cos(this.time * 83.0) * 0.6
        ) * shakeScale * 14.0;
        const shakeY = (
            Math.cos(this.time * 47.0)
            + Math.sin(this.time * 79.0) * 0.5
        ) * shakeScale * 11.0;

        // Apply position drift + mouse parallax
        this.camera.position.x = xDrift + shakeX + parallaxX;
        this.camera.position.y = yDrift + shakeY + parallaxY;

        // Deep Immersion: Dynamic Camera Roll (Banking & Tilt)
        // Bank slightly into the direction of the horizontal drift
        const bankTilt = -xDrift * 0.00015;
        // Add chaotic tilt during screen shake events (hard drops, line clears, combos)
        const shakeTilt = (Math.sin(this.time * 61.0) + Math.cos(this.time * 43.0)) * shakeScale * 0.012;
        this.camera.rotation.z = bankTilt + shakeTilt;

        // Apply breathing zoom (adjust frustum size)
        const baseSize = 1000;
        // Impact Zoom: Zoom out slightly during high-impact events for a "push back" visceral feeling
        const impactZoom = shakeScale * 0.04;
        // During pulse-heavy moments, bias slightly toward approaching the mountains.
        const reactiveApproach = this.effectState.mountainPulse * 0.02;
        // Negative breathe = smaller frustum = zoomed IN (closer to mountains)
        const zoomFactor = THREE.MathUtils.clamp(1 - breathe - reactiveApproach + impactZoom, 0.72, 1.3);
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = baseSize * zoomFactor;

        const nextLeft = (frustumSize * aspect) / -2;
        const nextRight = (frustumSize * aspect) / 2;
        const nextTop = frustumSize / 2;
        const nextBottom = frustumSize / -2;
        const previousFrustum = this.lastCameraFrustum;
        const frustumEpsilon = 0.5;
        const needsProjectionUpdate = !previousFrustum
            || Math.abs(previousFrustum.left - nextLeft) > frustumEpsilon
            || Math.abs(previousFrustum.right - nextRight) > frustumEpsilon
            || Math.abs(previousFrustum.top - nextTop) > frustumEpsilon
            || Math.abs(previousFrustum.bottom - nextBottom) > frustumEpsilon;

        if (needsProjectionUpdate) {
            this.camera.left = nextLeft;
            this.camera.right = nextRight;
            this.camera.top = nextTop;
            this.camera.bottom = nextBottom;
            this.camera.updateProjectionMatrix();
            this.lastCameraFrustum = {
                left: nextLeft,
                right: nextRight,
                top: nextTop,
                bottom: nextBottom,
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deterministic Baseline Playback
    // ─────────────────────────────────────────────────────────────────────────

    clearBaselinePlaybackTimers() {
        this.baselineTimeouts.forEach((id) => clearTimeout(id));
        this.baselineTimeouts.clear();
        this.baselineSequenceStats = { sequence: null, loops: 0, startedAt: 0 };
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

    getBaselineSequence(name = 'default') {
        const sequences = {
            default: [
                {
                    event: EVENTS.PIECE_LOCK,
                    payload: {
                        piece: {
                            x: 2, y: 17, shape: [[1, 1, 1], [0, 1, 0]], pieceId: 101,
                        },
                    },
                },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2, clearedRows: [18, 19] } },
                { event: EVENTS.COMBO, payload: { comboCount: 3 } },
                {
                    event: EVENTS.PIECE_LOCK,
                    payload: {
                        piece: {
                            x: 6, y: 18, shape: [[1, 1], [1, 1]], pieceId: 102,
                        },
                    },
                },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [16, 17, 18, 19] } },
                { event: EVENTS.COMBO, payload: { comboCount: 5 } },
            ],
            stress: [
                {
                    event: EVENTS.PIECE_LOCK,
                    payload: {
                        piece: {
                            x: 1, y: 17, shape: [[1, 1, 1, 1]], pieceId: 201,
                        },
                    },
                },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [16, 17, 18, 19] } },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
                {
                    event: EVENTS.PIECE_LOCK,
                    payload: {
                        piece: {
                            x: 7, y: 16, shape: [[1, 0], [1, 0], [1, 1]], pieceId: 202,
                        },
                    },
                },
                { event: EVENTS.COMBO, payload: { comboCount: 8 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [16, 17, 18, 19] } },
                {
                    event: EVENTS.PIECE_LOCK,
                    payload: {
                        piece: {
                            x: 4, y: 18, shape: [[1, 1], [1, 1]], pieceId: 203,
                        },
                    },
                },
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
            : (this.flags.playbackLoops || 1);
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
                    const originalWindow = typeof window !== 'undefined' ? window : {};
                    if (!originalWindow.settings) originalWindow.settings = { backgroundComboEffects: true };

                    const payload = step.payload && typeof step.payload === 'object'
                        ? { ...step.payload }
                        : step.payload;

                    // Manually route sequence events safely
                    if (step.event === EVENTS.PIECE_LOCK) this.onPieceLock(payload);
                    else if (step.event === EVENTS.LINE_CLEAR) this.onLineClear(payload);
                    else if (step.event === EVENTS.COMBO) this.onCombo(payload);
                    else if (step.event === EVENTS.LEVEL_UP) this.onLevelUp(payload);
                }, delayMs);
            });
        }

        // Add dummy timeout to track completion
        this.scheduleBaselineTimeout(() => { }, this.getBaselineSequenceDurationMs(name, loops, stepMs));

        console.log('[WolfhourBaseline] Playing sequence', { name, loops, stepMs });
        return true;
    }

    disposeMaterialResources(material) {
        const disposeSingleMaterial = (entry) => {
            if (!entry) return;

            const textureSlots = [
                'map',
                'alphaMap',
                'emissiveMap',
                'normalMap',
                'metalnessMap',
                'roughnessMap',
                'aoMap',
                'bumpMap',
                'displacementMap',
                'specularMap',
                'clearcoatMap',
                'clearcoatNormalMap',
                'clearcoatRoughnessMap',
            ];

            textureSlots.forEach((slot) => {
                const texture = entry[slot];
                if (texture?.isTexture) {
                    texture.dispose?.();
                }
            });

            if (entry.uniforms && typeof entry.uniforms === 'object') {
                Object.values(entry.uniforms).forEach((uniformValue) => {
                    const value = uniformValue?.value;
                    if (value?.isTexture) {
                        value.dispose?.();
                        return;
                    }
                    if (Array.isArray(value)) {
                        value.forEach((texture) => {
                            if (texture?.isTexture) texture.dispose?.();
                        });
                    }
                });
            }

            entry.dispose?.();
        };

        if (Array.isArray(material)) {
            material.forEach((entry) => disposeSingleMaterial(entry));
            return;
        }
        disposeSingleMaterial(material);
    }

    disposeObjectResources(object) {
        if (!object) return;
        object.geometry?.dispose?.();
        this.disposeMaterialResources(object.material);
    }

    restoreConsoleWarnFilter() {
        if (!this._origConsoleWarn) {
            return;
        }

        if (console.warn === this._filteredConsoleWarn) {
            console.warn = this._origConsoleWarn;
        }
        this._origConsoleWarn = null;
        this._filteredConsoleWarn = null;
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.clearRuntimeRebuildTimers();
        this.restoreConsoleWarnFilter();
        super.stop();
    }

    releaseInactiveResources() {
        this.resetRuntimeScene();
        super.releaseInactiveResources();
    }

    async rebuildRuntimeScene(reason = 'runtimeUpdate') {
        if (!this.isActive || this.runtimeRebuildInFlight) return false;

        const { container } = this;
        if (!container?.isConnected) return false;

        this.runtimeRebuildInFlight = true;
        try {
            this.resetRuntimeScene({ preserveLifecycle: true });
            await this.createScene();
            if (!this.isActive || !this.renderer || !this.scene) {
                throw new Error(`Runtime rebuild did not restore an active scene (${reason})`);
            }
            this.hasStarted = true;
            this.lifecycleState = 'running';
            console.log(`[Wolfhour] Runtime rebuild complete (${reason})`);
            return true;
        } catch (error) {
            console.error(`[Wolfhour] Runtime rebuild failed (${reason}).`, error);
            if (this.isActive) this.resetRuntimeScene();
            throw error;
        } finally {
            this.runtimeRebuildInFlight = false;
        }
    }

    resetRuntimeScene({ preserveLifecycle = false } = {}) {
        const { isActive: wasActive, container } = this;
        this.stop();

        if (preserveLifecycle && wasActive && container?.isConnected) {
            this.isActive = true;
            this.isPaused = false;
            this.lifecycleState = 'starting';
            this.container = container;
            container.classList.add('active');
        }

        // Restore console.warn if we filtered the uv attribute warning
        this.restoreConsoleWarnFilter();

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();

        this.removeBaselineHelpers();
        this.clearBaselinePlaybackTimers();
        this.clearRuntimeRebuildTimers();
        this.resetBaselineSamples();
        this.disposeComputeSystems();

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        if (this.webglContextLostHandler && this.renderer?.domElement) {
            this.renderer.domElement.removeEventListener('webglcontextlost', this.webglContextLostHandler);
            this.webglContextLostHandler = null;
        }

        this.mountains.forEach((m) => {
            m.geometry.dispose();
            this.disposeMaterialResources(m.material);
        });
        this.mountains = [];

        if (this.mountainBaseFill) {
            this.mountainBaseFill.geometry.dispose();
            this.disposeMaterialResources(this.mountainBaseFill.material);
            this.mountainBaseFill = null;
        }

        if (this.starfield) {
            this.starfield.geometry.dispose();
            this.disposeMaterialResources(this.starfield.material);
            this.starfield = null;
        }

        this.nebulaPlanes.forEach((n) => {
            n.geometry.dispose();
            this.disposeMaterialResources(n.material);
            n.userData?.texture?.dispose?.();
        });
        this.nebulaPlanes = [];

        if (this.moon) {
            this.moon.geometry.dispose();
            this.disposeMaterialResources(this.moon.material);
            this.moon = null;
        }
        if (this.moonHalo) {
            this.moonHalo.geometry.dispose();
            this.disposeMaterialResources(this.moonHalo.material);
            this.moonHalo = null;
        }
        this.moonTexture?.dispose?.();
        this.moonTexture = null;
        this.moonNodeData = null;
        this.moonHaloNodeData = null;
        this.lunarReactions.forEach((reaction) => {
            reaction.active = false;
            reaction.startTime = Number.NEGATIVE_INFINITY;
            reaction.duration = 1.1;
            reaction.strength = 0;
            reaction.combo = 0;
            reaction.serial = 0;
        });
        this.lunarReactionSerial = 0;
        this.lastReactiveOrigin = null;
        this.reactiveOriginsByPlayer.clear();
        this.comboProgressByPlayer.clear();

        [...this.starBursts, ...this.effectPools.starBurst].forEach((b) => this.disposeObjectResources(b));
        this.starBursts = [];
        this.effectPools.starBurst = [];
        [...this.celestialBeams, ...this.effectPools.beam].forEach((b) => this.disposeObjectResources(b));
        this.celestialBeams = [];
        this.effectPools.beam = [];
        [...this.cosmicRifts, ...this.effectPools.rift].forEach((b) => this.disposeObjectResources(b));
        this.cosmicRifts = [];
        this.effectPools.rift = [];
        [...this.cosmicWaves, ...this.effectPools.wave].forEach((b) => this.disposeObjectResources(b));
        this.cosmicWaves = [];
        this.effectPools.wave = [];
        [...this.meteors, ...this.effectPools.meteor].forEach((m) => {
            this.disposeObjectResources(m.userData.trail);
            this.disposeObjectResources(m.userData.head);
        });
        this.meteors = [];
        this.effectPools.meteor = [];
        [...this.meteorCrashes, ...this.effectPools.crash].forEach((c) => {
            const d = c.userData;
            this.disposeObjectResources(d.trail);
            this.disposeObjectResources(d.head);
            this.disposeObjectResources(d.debris);
            this.disposeObjectResources(d.shockwave);
            this.disposeObjectResources(d.dustCloud);
        });
        this.meteorCrashes = [];
        this.effectPools.crash = [];
        this.reactiveQueue = [];

        this.geometryCache.waveGeometry?.dispose?.();
        this.geometryCache.shockwavePlane?.dispose?.();
        this.geometryCache.unitQuad?.dispose?.();
        this.geometryCache = {
            unitQuad: null,
            shockwavePlane: null,
            trailGeometry: null,
            crashTrailGeometry: null,
            waveGeometry: null,
        };

        if (this.spirits) {
            this.spirits.geometry.dispose();
            this.disposeMaterialResources(this.spirits.material);
            this.spirits = null;
        }

        if (this.ambientParticles) {
            this.ambientParticles.geometry.dispose();
            this.disposeMaterialResources(this.ambientParticles.material);
            this.ambientParticles = null;
        }

        if (this.groundFog) {
            this.groundFog.geometry.dispose();
            this.disposeMaterialResources(this.groundFog.material);
            this.groundFog = null;
        }

        if (this.postProcessing) {
            this.postProcessing.dispose?.();
            this.postProcessing = null;
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.onDeviceLost = null;
            this.disposeRenderer(this.renderer, { nullInstance: false });
            this.renderer.domElement.remove();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.materialFactories = null;
        this.computeFactories = null;
        this.postFactories = null;
        this.postProfile = null;
        this.starfieldNodeData = null;
        this.spiritNodeData = null;

        console.log('[Wolfhour] Runtime scene reset complete');
    }

    cleanup() {
        super.cleanup();

        console.log('[Wolfhour] Theme cleaned up');
    }
}
