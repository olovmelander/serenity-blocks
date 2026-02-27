/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CHROMADELIC HIGHWAY - WebGPU Hybrid Edition
 *  A Psychedelic Rainbow Road Theme - Dynamic Infinite Road
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Hybrid WebGPU/WebGL architecture:
 * - Attempts WebGPURenderer (TSL materials, compute shaders, MRT post-processing)
 * - Silently falls back to WebGL 2.0 if WebGPU is unsupported
 * - Enhanced visuals: multiple planets, more particles, volumetric effects
 *
 * Based on Black Hole theme hybrid pattern (gold standard)
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
import { CHROMADELIC_HIGHWAY_TETROMINOS } from './chromadelic-highway-tetrominos.js';
import { ChromadelicHighwayPost } from './chromadelic-highway-post.js';
import {
    SpeedParticleCompute,
    AmbientParticleCompute,
    ShootingStarCompute,
} from './chromadelic-highway-compute.js';
import {
    createRoadNodeMaterial,
    createTunnelRingNodeMaterial,
    createPlanetNodeMaterial,
    createPlanetGlowNodeMaterial,
    createSpeedParticleNodeMaterial,
    createAmbientParticleNodeMaterial,
    createShootingStarNodeMaterial,
    createStarfieldNodeMaterial,
    createEdgeGlowNodeMaterial,
    createGasGiantNodeMaterial,
    createIceMoonNodeMaterial,
    createAtmosphericOrbNodeMaterial,
    createBinaryStarNodeMaterial,
    createNebulaNodeMaterial,
} from './chromadelic-highway-materials.js';

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
            seed: null,
            fixedDeltaMs: null,
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
    const playbackValue = params.get('chromadelicPlayback');
    const playbackLoopsValue = Number(params.get('chromadelicPlaybackLoops'));

    return {
        forceWebGL: hasFlag('forceWebGL'),
        noCompute: hasFlag('chromadelicNoCompute'),
        noMRT: hasFlag('chromadelicNoMRT'),
        mrtAudit: hasFlag('chromadelicMrtAudit'),
        noShootingStarCompute: hasFlag('chromadelicNoShootingStarCompute'),
        noPost: hasFlag('chromadelicNoPost'),
        baseline: hasFlag('chromadelicBaseline'),
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
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 7600,
        ringCount: 12,
        speedParticleCount: 3000,
        ambientParticleCount: 2000,
        roadSegments: 200,
        planetCount: 9,
        bloomStrength: 0.5,
        bloomRadius: 0.3,
        bloomThreshold: 0.65,
        enableBloom: true,
        enableCompute: true,
    },
    Ultra: {
        starCount: 5600,
        ringCount: 10,
        speedParticleCount: 2000,
        ambientParticleCount: 1500,
        roadSegments: 150,
        planetCount: 7,
        bloomStrength: 0.45,
        bloomRadius: 0.25,
        bloomThreshold: 0.7,
        enableBloom: true,
        enableCompute: true,
    },
    High: {
        starCount: 3800,
        ringCount: 8,
        speedParticleCount: 800,
        ambientParticleCount: 800,
        roadSegments: 100,
        planetCount: 5,
        bloomStrength: 0.4,
        bloomRadius: 0.2,
        bloomThreshold: 0.75,
        enableBloom: true,
        enableCompute: true,
    },
    Medium: {
        starCount: 2400,
        ringCount: 6,
        speedParticleCount: 300,
        ambientParticleCount: 400,
        roadSegments: 70,
        planetCount: 3,
        bloomStrength: 0.35,
        bloomRadius: 0.2,
        bloomThreshold: 0.8,
        enableBloom: true,
        enableCompute: false,
    },
    Low: {
        starCount: 1300,
        ringCount: 4,
        speedParticleCount: 100,
        ambientParticleCount: 150,
        roadSegments: 40,
        planetCount: 2,
        bloomStrength: 0.3,
        bloomRadius: 0.15,
        bloomThreshold: 0.85,
        enableBloom: false,
        enableCompute: false,
    },
    Minimal: {
        starCount: 700,
        ringCount: 3,
        speedParticleCount: 50,
        ambientParticleCount: 80,
        roadSegments: 30,
        planetCount: 1,
        bloomStrength: 0.2,
        bloomRadius: 0.1,
        bloomThreshold: 0.9,
        enableBloom: false,
        enableCompute: false,
    },
};

const BLOOM_TUNING = {
    baseScale: 1.15,
    reactiveScale: 0.85,
    thresholdLift: 0.10,
};

const RING_GLOW_TUNING = {
    pulseGlowScale: 0.8,
    uniformGlowScale: 0.66,
    saturation: 0.88,
    baseLightness: 0.51,
    lightnessGlowScale: 0.14,
};

const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

const QUALITY_BUDGETS = {
    Extreme: {
        maxDrawCalls: 560,
        maxPostCostMs: 4.8,
        maxSpeedParticles: 3000,
        maxAmbientParticles: 2000,
        maxActiveShootingStars: 6,
        allowUnderRoadGlow: true,
        underRoadGlowBaseOpacity: 0.2,
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
        compileTimeoutMs: 3600,
    },
    Ultra: {
        maxDrawCalls: 500,
        maxPostCostMs: 4.5,
        maxSpeedParticles: 2200,
        maxAmbientParticles: 1500,
        maxActiveShootingStars: 5,
        allowUnderRoadGlow: true,
        underRoadGlowBaseOpacity: 0.18,
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
        compileTimeoutMs: 3400,
    },
    High: {
        maxDrawCalls: 430,
        maxPostCostMs: 4.0,
        maxSpeedParticles: 900,
        maxAmbientParticles: 820,
        maxActiveShootingStars: 4,
        allowUnderRoadGlow: true,
        underRoadGlowBaseOpacity: 0.14,
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
        compileTimeoutMs: 3200,
    },
    Medium: {
        maxDrawCalls: 350,
        maxPostCostMs: 3.2,
        maxSpeedParticles: 340,
        maxAmbientParticles: 420,
        maxActiveShootingStars: 3,
        allowUnderRoadGlow: false,
        underRoadGlowBaseOpacity: 0.0,
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
        compileTimeoutMs: 3000,
    },
    Low: {
        maxDrawCalls: 260,
        maxPostCostMs: 2.6,
        maxSpeedParticles: 120,
        maxAmbientParticles: 160,
        maxActiveShootingStars: 2,
        allowUnderRoadGlow: false,
        underRoadGlowBaseOpacity: 0.0,
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
        compileTimeoutMs: 2600,
    },
    Minimal: {
        maxDrawCalls: 200,
        maxPostCostMs: 2.2,
        maxSpeedParticles: 60,
        maxAmbientParticles: 90,
        maxActiveShootingStars: 1,
        allowUnderRoadGlow: false,
        underRoadGlowBaseOpacity: 0.0,
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
        compileTimeoutMs: 2200,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader (WebGL fallback path)
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(offset, offset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class ChromadelicHighwayTheme extends BaseTheme {
    constructor() {
        super('chromadelic-highway');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null; // WebGL post-processing
        this.postProcessing = null; // WebGPU post-processing
        this.bloomPass = null;
        this.animationFrameId = null;
        this.resizeHandler = null;
        this.clock = new THREE.Clock();
        this.time = 0;

        // Hybrid renderer state
        this.isWebGPU = false;
        this.isWebGL = false;
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

        // Dynamic road state
        this.roadProgress = 0;
        this.curvePhase = 0;
        this.roadMesh = null;
        this.underRoadGlow = null;
        this.roadGeometry = null;
        this.roadMaterialData = null; // { material, uniforms }
        this.roadMaterial = null;

        // Scene elements
        this.tunnelRings = [];
        this.edgeStrips = [];
        this.starfield = null;
        this.nebulaPlanes = [];
        this.depthHazeLayers = [];
        this.speedParticles = null;
        this.ambientParticles = null;
        this.speedParticleMaterialData = null;
        this.ambientParticleMaterialData = null;

        // Multi-planet system
        this.planet = null;
        this.planetGlows = [];
        this.neonGasGiant = null;
        this.neonGasGiantGlows = [];
        this.crystalMoon = null;
        this.crystalMoonGlows = [];
        this.binaryStars = [];
        this.venusOrb = null;
        this.venusOrbGlows = [];

        // Shooting stars
        this.shootingStars = [];
        this.shootingStarTimer = 0;
        this.nextShootingStarDelay = 3;

        // Planet journey - focal corridor anchored and intentionally paced
        this.journeyTime = 0;
        this.journeyDuration = 180;
        this.planetStartPos = new THREE.Vector3(940, 360, -2150);
        this.planetClosePos = new THREE.Vector3(540, 170, 240);
        this.planetEndPos = new THREE.Vector3(820, 310, 640);
        this.celestialCorridor = {
            centerX: 720,
            halfWidth: 300,
        };

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
            pulse: 1.25,
            bloom: 0.2,  // Reduced from 0.3
            ring: 0.5,   // Reduced from 0.6
            particle: 1.8,
            ambient: 1.9,
        };

        this.activeQualityLevel = 'High';
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

        // Compute shaders (WebGPU only)
        this.speedParticleCompute = null;
        this.ambientParticleCompute = null;
        this.useShootingStarCompute = false;

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.updateReactiveCaps();
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

        console.log('[ChromadelicHighway] Hybrid WebGPU/WebGL theme constructed');
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
        const targetFrameMs = this.performanceBudget?.targetFrameMs ?? 16.7;
        const baseResolutionScale = this.performanceBudget?.baseResolutionScale ?? 1.0;
        this.adaptiveScalerState = {
            frameTimeEmaMs: targetFrameMs,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: 1,
            resolutionScale: baseResolutionScale,
            baseResolutionScale,
            effectScale: 1,
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

        this.renderer.setPixelRatio(this.getRendererPixelRatio(1.5));
        this.renderer.setSize(width, height);

        if (this.isWebGPU && this.postProcessing) {
            this.postProcessing.bloomDownsample = THREE.MathUtils.clamp(
                0.62 + (this.adaptiveScalerState.effectScale ?? 1) * 0.22,
                0.58,
                0.84,
            );
            this.postProcessing.setSize(width, height);
        } else if (this.isWebGL && this.composer) {
            this.composer.setSize(width, height);
            if (this.bloomPass?.resolution) {
                this.bloomPass.resolution.set(width, height);
            }
        }
    }

    updateAdaptiveScaler(frameMs) {
        if (
            !Number.isFinite(frameMs)
            || frameMs <= 0
            || this.fixedDeltaSeconds !== null
            || this.flags.baseline
        ) {
            return;
        }

        const state = this.adaptiveScalerState;
        const budget = this.performanceBudget;
        if (!state || !budget || budget.adaptiveEnabled === false) return;

        state.frameTimeEmaMs = state.frameTimeEmaMs * 0.92 + frameMs * 0.08;
        const drawCalls = this.renderer?.info?.render?.calls ?? 0;
        state.drawCallEma = state.drawCallEma * 0.9 + drawCalls * 0.1;
        state.postCostEmaMs = state.postCostEmaMs * 0.9 + (this.lastPostCostMs || 0) * 0.1;

        let nextScale = state.qualityScale;
        const frameOverBudget = state.frameTimeEmaMs > budget.targetFrameMs * 1.08;
        const drawOverBudget = state.drawCallEma > budget.maxDrawCalls * 1.05;
        const postOverBudget = state.postCostEmaMs > budget.maxPostCostMs * 1.08;
        const frameUnderBudget = state.frameTimeEmaMs < budget.targetFrameMs * 0.9;
        const drawUnderBudget = state.drawCallEma < budget.maxDrawCalls * 0.84;
        const postUnderBudget = state.postCostEmaMs < budget.maxPostCostMs * 0.75;

        if (frameOverBudget || drawOverBudget || postOverBudget) {
            nextScale -= budget.adaptiveDownRate;
        } else if (frameUnderBudget && drawUnderBudget && postUnderBudget) {
            nextScale += budget.adaptiveUpRate;
        }

        nextScale = THREE.MathUtils.clamp(nextScale, budget.adaptiveMinScale, budget.adaptiveMaxScale);
        if (Math.abs(nextScale - state.qualityScale) < 0.01) return;

        state.qualityScale = nextScale;
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
                speedBudget: budget.maxSpeedParticles ?? null,
                ambientBudget: budget.maxAmbientParticles ?? null,
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
        this.qualityPreset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
        this.performanceBudget = this.resolveQualityBudget(normalized);
        this.resetAdaptiveScalerState();
        this.updateReactiveCaps();
        console.log('[ChromadelicHighway] Applied quality profile', {
            quality: normalized,
            drawCallBudget: this.performanceBudget.maxDrawCalls,
            postCostBudgetMs: this.performanceBudget.maxPostCostMs,
            speedParticles: this.performanceBudget.maxSpeedParticles,
            ambientParticles: this.performanceBudget.maxAmbientParticles,
        });
    }

    rand() {
        return this.random ? this.random() : Math.random();
    }

    updateReactiveCaps() {
        const qualityScale = (() => {
            const baselineStars = QUALITY_PRESETS.High.starCount || 1;
            const starScale = (this.qualityPreset?.starCount || baselineStars) / baselineStars;
            return THREE.MathUtils.clamp(0.75 + starScale * 0.25, 0.75, 1.2);
        })();

        this.reactiveCaps = {
            pulse: 1.2 * qualityScale,
            bloom: 0.55 * qualityScale,
            ring: 1.1 * qualityScale,
            particle: 1.7 * qualityScale,
            ambient: 1.8 * qualityScale,
        };
    }

    resetReactiveEnvelope() {
        Object.keys(this.reactiveState).forEach((key) => {
            this.reactiveState[key] = 0;
            this.reactiveTarget[key] = 0;
        });
        this.pulseIntensity = 0;
        this.bloomBoost = 0;
        this.ringGlow = 0;
        this.particleGlow = 0;
        this.ambientSpeedTarget = 0;
    }

    pushReactiveEnvelope(boosts = {}) {
        const channels = ['pulse', 'bloom', 'ring', 'particle', 'ambient'];
        channels.forEach((channel) => {
            const amount = Number.isFinite(boosts[channel]) ? boosts[channel] : 0;
            if (amount <= 0) return;
            const cap = this.reactiveCaps[channel] ?? 1;
            this.reactiveTarget[channel] = THREE.MathUtils.clamp(
                this.reactiveTarget[channel] + amount,
                0,
                cap,
            );
        });
    }

    updateReactiveEnvelope(delta) {
        const attackRates = {
            pulse: 4.0, // Smoother (was 8.5)
            bloom: 3.0, // Smoother (was 6.0)
            ring: 3.5,  // Smoother (was 7.0)
            particle: 3.0, // Smoother (was 5.5)
            ambient: 2.5, // Smoother (was 4.5)
        };
        const decayRates = {
            pulse: 1.25,
            bloom: 0.95,
            ring: 1.05,
            particle: 0.8,
            ambient: 0.7,
        };

        Object.keys(this.reactiveState).forEach((channel) => {
            const attack = Math.min(1, attackRates[channel] * delta);
            this.reactiveState[channel] += (this.reactiveTarget[channel] - this.reactiveState[channel]) * attack;
            this.reactiveTarget[channel] = Math.max(0, this.reactiveTarget[channel] - decayRates[channel] * delta);
        });

        this.pulseIntensity = this.reactiveState.pulse;
        this.bloomBoost = this.reactiveState.bloom;
        this.ringGlow = this.reactiveState.ring;
        this.particleGlow = this.reactiveState.particle;
        this.ambientSpeedTarget = this.reactiveState.ambient;
    }

    getBloomStrength(effectScale = 1) {
        return this.qualityPreset.bloomStrength
            * BLOOM_TUNING.baseScale
            * effectScale
            * (1 + this.bloomBoost * BLOOM_TUNING.reactiveScale * effectScale);
    }

    getBloomThreshold() {
        return THREE.MathUtils.clamp(
            this.qualityPreset.bloomThreshold + BLOOM_TUNING.thresholdLift,
            0.55,
            0.96,
        );
    }

    probeCapabilities() {
        const maxColorAttachments = this.renderer?.capabilities?.maxColorAttachments ?? 1;
        const supportsPost = this.isWebGPU ? typeof THREE_WEBGPU.PostProcessing === 'function' : true;
        const supportsMRT = this.isWebGPU && maxColorAttachments > 1;
        const supportsCompute = this.isWebGPU && typeof this.renderer?.compute === 'function';

        this.capabilities = {
            webgpu: this.isWebGPU,
            webgl: this.isWebGL,
            maxColorAttachments,
            supportsPost,
            supportsMRT,
            supportsCompute,
            post: !this.flags.noPost && supportsPost,
            mrt: !this.flags.noMRT && supportsMRT,
            compute: !this.flags.noCompute && this.qualityPreset.enableCompute && supportsCompute,
        };
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (this.isWebGPU && this.capabilities.post) {
            // Post graph includes explicit grading/tonemapping.
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1.0;
        } else {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.0;
        }
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
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    disposeComputeSystems() {
        if (this.speedParticleCompute) {
            this.speedParticleCompute.dispose();
            this.speedParticleCompute = null;
        }
        if (this.ambientParticleCompute) {
            this.ambientParticleCompute.dispose();
            this.ambientParticleCompute = null;
        }
        if (this.shootingStars?.length) {
            this.shootingStars.forEach((star) => {
                star.userData?.compute?.dispose?.();
            });
        }
    }

    disposePostProcessingStack() {
        if (this.postProcessing?.dispose) {
            try {
                this.postProcessing.dispose();
            } catch (error) {
                console.warn('[ChromadelicHighway] postProcessing dispose failed:', error);
            }
        }
        this.postProcessing = null;

        if (this.composer?.dispose) {
            try {
                this.composer.dispose();
            } catch (error) {
                console.warn('[ChromadelicHighway] composer dispose failed:', error);
            }
        }
        this.composer = null;
        this.bloomPass = null;
    }

    disposeMaterialTextures(material, disposedTextures) {
        if (!material) return;

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
            'clearcoatMap',
            'clearcoatNormalMap',
            'clearcoatRoughnessMap',
            'sheenColorMap',
            'sheenRoughnessMap',
            'transmissionMap',
            'thicknessMap',
            'iridescenceMap',
            'iridescenceThicknessMap',
            'anisotropyMap',
            'matcap',
        ];

        textureKeys.forEach((key) => {
            const texture = material[key];
            if (texture?.isTexture && !disposedTextures.has(texture.uuid)) {
                disposedTextures.add(texture.uuid);
                texture.dispose();
            }
        });
    }

    disposeSceneResources() {
        if (!this.scene) return;

        const disposedTextures = new Set();
        const backgroundTexture = this.scene.background;
        if (backgroundTexture?.isTexture && !disposedTextures.has(backgroundTexture.uuid)) {
            disposedTextures.add(backgroundTexture.uuid);
            backgroundTexture.dispose();
        }
        const environmentTexture = this.scene.environment;
        if (environmentTexture?.isTexture && !disposedTextures.has(environmentTexture.uuid)) {
            disposedTextures.add(environmentTexture.uuid);
            environmentTexture.dispose();
        }

        this.scene.traverse((obj) => {
            if (obj.geometry?.dispose) {
                obj.geometry.dispose();
            }
            if (!obj.material) return;

            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            materials.forEach((material) => {
                this.disposeMaterialTextures(material, disposedTextures);
                if (material?.dispose) {
                    material.dispose();
                }
            });
        });
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.renderer.onDeviceLost = null;
        const domElement = this.renderer.domElement;
        try {
            this.renderer.dispose();
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
        this.composer = null;
        this.postProcessing = null;
        this.bloomPass = null;
        this.roadMesh = null;
        this.underRoadGlow = null;
        this.roadGeometry = null;
        this.roadMaterialData = null;
        this.roadMaterial = null;
        this.tunnelRings = [];
        this.edgeStrips = [];
        this.starfield = null;
        this.nebulaPlanes = [];
        this.depthHazeLayers = [];
        this.speedParticles = null;
        this.ambientParticles = null;
        this.speedParticleMaterialData = null;
        this.ambientParticleMaterialData = null;
        this.useShootingStarCompute = false;
        this.planet = null;
        this.planetGlows = [];
        this.neonGasGiant = null;
        this.neonGasGiantGlows = [];
        this.crystalMoon = null;
        this.crystalMoonGlows = [];
        this.binaryStars = [];
        this.venusOrb = null;
        this.venusOrbGlows = [];
        this.shootingStars = [];
        this.pieceLockTimes = [];
        this.roadProgress = 0;
        this.curvePhase = 0;
        this.journeyTime = 0;
        this.shootingStarTimer = 0;
        this.nextShootingStarDelay = 3;
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
        this.disposeComputeSystems();
        this.disposePostProcessingStack();
        this.disposeSceneResources();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        this.deviceLossRecoveries += 1;
        console.error('[ChromadelicHighway] WebGPU device lost:', info);
        console.warn('[ChromadelicHighway] Attempting controlled recovery via WebGL fallback...');

        try {
            this.cancelAnimationLoop();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.requestBaselineSoakStop();
            this.removeBaselineHelpers();
            this.disposeRuntimeResources({ removeCanvas: true });

            // Force stable fallback route after device loss.
            this.flags.forceWebGL = true;
            this.flags.noCompute = true;
            this.flags.noMRT = true;

            await this.createScene();
            console.log('[ChromadelicHighway] Recovery complete: running on WebGL fallback.');
        } catch (error) {
            console.error('[ChromadelicHighway] Device-loss recovery failed:', error);
            this.isActive = false;
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
            ],
            stress: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 3 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
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
                    let payload = step.payload;
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
        };
        console.log('[ChromadelicBaseline] Helpers: window.chromadelicBaseline.capture(label), report(), downloadReport(label), reset(), play(sequence, options), capturePack(options), captureReadability(options), runSoak(options), getSoakReport(), downloadSoakReport(label), runSignoffPack(options), getSignoffReport(), downloadSignoffReport(label), getPresetOrder(), stop()');
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.chromadelicBaseline) {
            delete window.chromadelicBaseline;
        }
    }

    async precompileSceneWithTimeout() {
        if (!this.isWebGPU || !this.renderer?.compileAsync || !this.scene || !this.camera) {
            return false;
        }

        const timeoutMs = Math.max(600, this.performanceBudget?.compileTimeoutMs ?? 3000);
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`compileAsync timeout (${timeoutMs}ms)`));
            }, timeoutMs);
        });

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                timeoutPromise,
            ]);
            return true;
        } catch (err) {
            console.warn('[ChromadelicHighway] compileAsync prewarm skipped:', err.message);
            return false;
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }

    async createScene() {
        console.log('[ChromadelicHighway] Creating hybrid scene...');
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
            console.error('[ChromadelicHighway] Container not found');
            return;
        }

        await this.initRenderer(container);
        if (!this.renderer || !this.scene || !this.camera) {
            console.error('[ChromadelicHighway] Renderer initialization failed.');
            return;
        }

        this.probeCapabilities();
        this.configureRendererColorPipeline();
        const useCompute = this.capabilities.compute;
        this.useShootingStarCompute = useCompute && !this.flags.noShootingStarCompute;

        console.log('[ChromadelicHighway] Runtime capabilities', {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            post: this.capabilities.post,
            mrt: this.capabilities.mrt,
            compute: this.capabilities.compute,
            shootingStarCompute: this.useShootingStarCompute,
            maxColorAttachments: this.capabilities.maxColorAttachments,
            budget: this.getBudgetSnapshot(),
        });

        this.createDynamicRoad();
        this.createTunnelRings();
        this.createStarfield();
        this.createRainbowPlanet();
        this.createAdditionalPlanets();
        this.createSpeedParticles(useCompute);
        this.createAmbientParticles(useCompute);
        this.createShootingStars();
        this.auditMrtMaterials();
        this.setupPostProcessing();
        this.resize(window.innerWidth, window.innerHeight);
        this.applyAdaptiveScalerState();
        this.setupEventListeners();

        if (this.flags.baseline) {
            this.installBaselineHelpers();
            console.log('[ChromadelicBaseline] Baseline capture enabled', {
                preset: quality,
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                seed: this.flags.seed,
                fixedDeltaMs: this.flags.fixedDeltaMs,
            });
        }

        await this.precompileSceneWithTimeout();

        this.startAnimation();

        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, {
                loops: this.flags.playbackLoops,
            });
        }
        console.log('[ChromadelicHighway] Hybrid scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hybrid Renderer Init
    // ─────────────────────────────────────────────────────────────────────────

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const preserveDrawingBuffer = this.flags.baseline === true;

        let webgpuRenderer = null;

        if (!this.flags.forceWebGL) {
            try {
                webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    preserveDrawingBuffer,
                });
                await webgpuRenderer.init();
            } catch (err) {
                console.warn('[ChromadelicHighway] WebGPU init failed, falling back:', err.message);
                if (webgpuRenderer) {
                    try { webgpuRenderer.dispose(); } catch { /* ignore */ }
                }
                webgpuRenderer = null;
            }
        }

        if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
            this.renderer = webgpuRenderer;
            this.isWebGPU = true;
            this.isWebGL = false;

            // Handle device loss
            this.renderer.onDeviceLost = (info) => {
                this.handleDeviceLoss(info);
            };
        } else {
            // Dispose failed WebGPU renderer if it initialized but fell back to WebGL backend
            if (webgpuRenderer) {
                try { webgpuRenderer.dispose(); } catch { /* ignore */ }
            }

            this.renderer = new THREE.WebGLRenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
                preserveDrawingBuffer,
            });
            this.isWebGPU = false;
            this.isWebGL = true;
        }

        console.log(`[ChromadelicHighway] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

        this.renderer.setClearColor(0x020008, 1);
        this.renderer.setPixelRatio(this.getRendererPixelRatio(1.5));
        this.renderer.setSize(width, height);

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020008, 0.0004);

        // Camera: Lower, closer to road - immersive racing view
        this.camera = new THREE.PerspectiveCamera(80, width / height, 1, 12000);
        this.camera.position.set(0, 55, 280);
        this.camera.lookAt(0, 20, -600);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dynamic Road
    // ─────────────────────────────────────────────────────────────────────────

    createDynamicRoad() {
        const segments = this.qualityPreset.roadSegments;
        const roadWidth = 200;
        const roadLength = 2500;

        if (this.capabilities.compute) {
            // Phase 4 policy: keep road deformation on CPU until profiling proves bottleneck.
            console.log('[ChromadelicHighway] Road deformation compute deferred; using CPU road curve updates.');
        }

        this.roadGeometry = new THREE.PlaneGeometry(roadWidth, roadLength, 1, segments);
        this.roadGeometry.rotateX(-Math.PI / 2);

        if (this.isWebGPU) {
            this.roadMaterialData = createRoadNodeMaterial();
            this.roadMesh = new THREE.Mesh(this.roadGeometry, this.roadMaterialData.material);
        } else {
            // WebGL fallback: ShaderMaterial
            this.roadMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uProgress: { value: 0 },
                    uPulse: { value: 0 },
                    uPace: { value: 1.0 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    varying float vDepth;
                    void main() {
                        vUv = uv;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        vDepth = -mvPosition.z;
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform float uProgress;
                    uniform float uPulse;
                    uniform float uPace;
                    varying vec2 vUv;
                    varying float vDepth;

                    vec3 hsv2rgb(vec3 c) {
                        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                    }

                    void main() {
                        float hue = fract((1.0 - vUv.y) * 4.0 + uProgress * 0.5);
                        vec3 rainbow = hsv2rgb(vec3(hue, 0.9, 0.7));
                        float laneFrequency = 86.0 + (uPace - 1.0) * 34.0;
                        float laneFlow = uProgress * (18.0 + uPace * 6.0) + uTime * 0.15;
                        float lanes = abs(sin((1.0 - vUv.y) * laneFrequency + laneFlow));
                        float laneLow = clamp(0.68 - (uPace - 1.0) * 0.08, 0.5, 0.85);
                        float laneHigh = clamp(0.9 - (uPace - 1.0) * 0.04, 0.74, 0.97);
                        lanes = smoothstep(laneLow, laneHigh, lanes);
                        rainbow += lanes * (0.12 + uPace * 0.05);
                        float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                        rainbow *= edge * 0.8 + 0.2;
                        rainbow += (1.0 - edge) * 0.1;
                        float depthFade = smoothstep(2000.0, 200.0, vDepth);
                        rainbow *= 0.3 + depthFade * 0.7;
                        rainbow *= 0.85 + uPulse * 0.25;
                        rainbow *= 1.0 + (uPace - 1.0) * 0.12;
                        rainbow = min(rainbow, vec3(0.95));
                        gl_FragColor = vec4(rainbow, 1.0);
                    }
                `,
                side: THREE.DoubleSide,
            });
            this.roadMesh = new THREE.Mesh(this.roadGeometry, this.roadMaterial);
        }

        this.scene.add(this.roadMesh);
        this.createUnderRoadGlow();
        console.log('[ChromadelicHighway] Dynamic road created');
    }

    createUnderRoadGlow() {
        this.underRoadGlow = null;
        if (!this.performanceBudget?.allowUnderRoadGlow) return;

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, 'rgba(255,120,220,0.0)');
        gradient.addColorStop(0.25, 'rgba(255,120,220,0.22)');
        gradient.addColorStop(0.5, 'rgba(120,220,255,0.32)');
        gradient.addColorStop(0.75, 'rgba(70,130,255,0.2)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 64);

        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(320, 2600);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: this.performanceBudget.underRoadGlowBaseOpacity ?? 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            color: new THREE.Color(0xff8aff),
        });

        this.underRoadGlow = new THREE.Mesh(geometry, material);
        this.underRoadGlow.position.set(0, -18, -980);
        this.underRoadGlow.renderOrder = -12;
        this.underRoadGlow.userData.baseOpacity = material.opacity;
        this.underRoadGlow.userData.baseY = this.underRoadGlow.position.y;
        this.scene.add(this.underRoadGlow);
    }

    updateRoadCurve() {
        if (!this.roadGeometry) return;

        const positions = this.roadGeometry.attributes.position.array;
        const segments = this.qualityPreset.roadSegments;
        const time = this.time * 0.12;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const z = 400 - t * 2900;
            const curveStrength = t * t;

            const curve1 = Math.sin(t * 2.5 + time) * 200 * curveStrength;
            const curve2 = Math.sin(t * 1.2 + time * 0.6) * 120 * curveStrength;
            const curve3 = Math.cos(t * 1.8 + time * 0.9) * 80 * curveStrength;
            const xOffset = curve1 + curve2 + curve3;
            const yOffset = Math.sin(t * 1.5 + time * 0.4) * 25 * curveStrength;

            const leftIdx = (i * 2) * 3;
            positions[leftIdx] = -100 + xOffset;
            positions[leftIdx + 1] = yOffset;
            positions[leftIdx + 2] = z;

            const rightIdx = (i * 2 + 1) * 3;
            positions[rightIdx] = 100 + xOffset;
            positions[rightIdx + 1] = yOffset;
            positions[rightIdx + 2] = z;
        }

        this.roadGeometry.attributes.position.needsUpdate = true;
        this.roadGeometry.computeVertexNormals();

        if (this.underRoadGlow) {
            const centerSeg = Math.floor(segments * 0.65);
            const leftIdx = (centerSeg * 2) * 3;
            const rightIdx = (centerSeg * 2 + 1) * 3;
            const centerX = (positions[leftIdx] + positions[rightIdx]) * 0.5;
            this.underRoadGlow.position.x = centerX * 0.35;
        }
    }

    updateUnderRoadGlow() {
        if (!this.underRoadGlow?.material) return;

        const baseOpacity = this.underRoadGlow.userData.baseOpacity ?? 0;
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
        const readabilityGate = THREE.MathUtils.clamp(
            1.0 - (this.bloomBoost * 0.85 + this.ringGlow * 0.35),
            0.15,
            1.0,
        );
        const paceLift = THREE.MathUtils.clamp(0.84 + (this.playPaceMultiplier - 1.0) * 0.16, 0.72, 1.08);
        const targetOpacity = baseOpacity * effectScale * readabilityGate * paceLift;

        this.underRoadGlow.material.opacity += (targetOpacity - this.underRoadGlow.material.opacity) * 0.08;
        const baseY = this.underRoadGlow.userData.baseY ?? -18;
        this.underRoadGlow.position.y = baseY - this.pulseIntensity * 1.1;
    }

    applyParticleDrawBudgets() {
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;

        if (this.speedParticles?.geometry?.attributes?.position) {
            const maxSpeed = this.speedParticles.geometry.attributes.position.count;
            const targetSpeed = Math.max(32, Math.floor(maxSpeed * effectScale));
            const current = this.speedParticles.geometry.drawRange?.count ?? maxSpeed;
            if (Math.abs(current - targetSpeed) >= 8) {
                this.speedParticles.geometry.setDrawRange(0, targetSpeed);
            }
        }

        if (this.ambientParticles?.geometry?.attributes?.position) {
            const maxAmbient = this.ambientParticles.geometry.attributes.position.count;
            const targetAmbient = Math.max(24, Math.floor(maxAmbient * effectScale));
            const current = this.ambientParticles.geometry.drawRange?.count ?? maxAmbient;
            if (Math.abs(current - targetAmbient) >= 6) {
                this.ambientParticles.geometry.setDrawRange(0, targetAmbient);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tunnel Rings
    // ─────────────────────────────────────────────────────────────────────────

    createTunnelRings() {
        const { ringCount } = this.qualityPreset;
        const ringProfiles = [
            { radius: 214, tube: 4.5, tubeSegments: 14, radialSegments: 78, speed: 2.9, spin: 0.28 },
            { radius: 220, tube: 5.0, tubeSegments: 16, radialSegments: 82, speed: 3.1, spin: 0.32 },
            { radius: 227, tube: 5.8, tubeSegments: 18, radialSegments: 74, speed: 3.25, spin: 0.35 },
            { radius: 222, tube: 5.2, tubeSegments: 16, radialSegments: 88, speed: 3.0, spin: 0.3 },
        ];

        // Neon glow shader for rings (WebGL fallback)
        const neonRingShader = {
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uTime;
                uniform float uPulse;
                uniform float uGlow;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                void main() {
                    vec3 viewDir = normalize(vViewPosition);
                    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
                    fresnel = pow(fresnel, 2.0);
                    float pulse = 1.0 + sin(uTime * 3.0) * 0.15 * uPulse;
                    vec3 coreColor = uColor * (1.1 + uGlow * 0.4) * pulse;
                    vec3 glowColor = uColor * (0.5 + fresnel * 0.7);
                    vec3 finalColor = mix(coreColor, glowColor, fresnel * 0.5);
                    finalColor += uColor * fresnel * 0.25 * (1.0 + uGlow);
                    finalColor = clamp(finalColor, 0.0, 1.0);
                    float alpha = (0.7 + fresnel * 0.3) * (0.8 + uPulse * 0.2);
                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
        };

        for (let i = 0; i < ringCount; i++) {
            const profile = ringProfiles[i % ringProfiles.length];
            const geometry = new THREE.TorusGeometry(
                profile.radius,
                profile.tube,
                profile.tubeSegments,
                profile.radialSegments,
            );
            const hue = i / ringCount;
            const color = new THREE.Color().setHSL(hue, RING_GLOW_TUNING.saturation, 0.55);

            let material;
            let materialData = null;

            if (this.isWebGPU) {
                materialData = createTunnelRingNodeMaterial(color);
                material = materialData.material;
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uColor: { value: color },
                        uTime: { value: 0 },
                        uPulse: { value: 0 },
                        uGlow: { value: 0 },
                    },
                    vertexShader: neonRingShader.vertexShader,
                    fragmentShader: neonRingShader.fragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const ring = new THREE.Mesh(geometry, material);
            const z = 150 - (i / ringCount) * 2800;
            ring.position.set(0, 25, z);
            ring.userData.baseZ = z;
            ring.userData.hue = hue;
            ring.userData.speed = profile.speed + this.rand() * 0.25;
            ring.userData.rotationSpeed = (profile.spin + this.rand() * 0.08) * (this.rand() > 0.5 ? 1 : -1);
            ring.userData.profile = profile;
            ring.userData.materialData = materialData;

            this.tunnelRings.push(ring);
            this.scene.add(ring);
        }

        this.createEdgeGlowStrips();
        console.log(`[ChromadelicHighway] ${ringCount} neon tunnel rings created`);
    }

    createEdgeGlowStrips() {
        this.edgeStrips = [];

        [-1, 1].forEach((side, sideIdx) => {
            const lineCount = 3;
            for (let i = 0; i < lineCount; i++) {
                const geometry = new THREE.BufferGeometry();
                const points = [];
                const segments = 60;
                for (let j = 0; j <= segments; j++) {
                    const t = j / segments;
                    const z = 350 - t * 2600;
                    const xBase = side * (110 + i * 25);
                    points.push(new THREE.Vector3(xBase, 2 + i * 3, z));
                }
                geometry.setFromPoints(points);

                const hue = sideIdx === 0 ? (0.0 + i * 0.1) : (0.7 - i * 0.1);
                const color = new THREE.Color().setHSL(hue, 0.9, 0.6);
                const opacity = 0.6 - i * 0.15;

                let material;
                let materialData = null;

                if (this.isWebGPU) {
                    materialData = createEdgeGlowNodeMaterial(color, opacity);
                    material = materialData.material;
                } else {
                    material = new THREE.LineBasicMaterial({
                        color,
                        transparent: true,
                        opacity,
                        blending: THREE.AdditiveBlending,
                    });
                }

                const line = new THREE.Line(geometry, material);
                line.userData.side = side;
                line.userData.offset = i;
                line.userData.hue = hue;
                line.userData.materialData = materialData;

                this.edgeStrips.push(line);
                this.scene.add(line);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkles = new Float32Array(starCount * 2);

        // Full sky dome (360 degrees) centered on the scene
        const skyCenter = new THREE.Vector3(0, 0, 0);
        const minRadius = 6000;
        const maxRadius = 11500;
        const azimuthSpan = Math.PI * 2.0;
        const elevationMin = -Math.PI * 0.5;
        const elevationMax = Math.PI * 0.5;
        const starPalette = [
            new THREE.Color(0xffffff), // white
            new THREE.Color(0xe8f1ff), // cool white
            new THREE.Color(0xfff2d4), // warm white
            new THREE.Color(0xc8deff), // blue
            new THREE.Color(0xd6f9ff), // cyan
            new THREE.Color(0xe7ddff), // violet
            new THREE.Color(0xd5ffe8), // mint
            new THREE.Color(0xfff7b3), // pale yellow
            new THREE.Color(0xffddb8), // peach
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const azimuth = (this.rand() - 0.5) * azimuthSpan;
            const elevation = elevationMin + this.rand() * (elevationMax - elevationMin);
            const radius = minRadius + this.rand() * (maxRadius - minRadius);

            const cosElevation = Math.cos(elevation);
            const dirX = Math.sin(azimuth) * cosElevation;
            const dirY = Math.sin(elevation);
            const dirZ = -Math.cos(azimuth) * cosElevation;

            positions[i3] = skyCenter.x + dirX * radius;
            positions[i3 + 1] = skyCenter.y + dirY * radius;
            positions[i3 + 2] = skyCenter.z + dirZ * radius;

            const brightnessClass = this.rand();
            let brightness;
            if (brightnessClass < 0.05) {
                brightness = 0.95 + this.rand() * 0.22;
                sizes[i] = 30 + this.rand() * 34;
            } else if (brightnessClass < 0.32) {
                brightness = 0.58 + this.rand() * 0.34;
                sizes[i] = 16 + this.rand() * 24;
            } else {
                brightness = 0.34 + this.rand() * 0.34;
                sizes[i] = 9 + this.rand() * 16;
            }

            const colorIndex = this.rand() < 0.5
                ? Math.floor(this.rand() * 3)
                : 3 + Math.floor(this.rand() * (starPalette.length - 3));
            const starColor = starPalette[colorIndex];
            const tint = 0.9 + this.rand() * 0.18;
            colors[i3] = Math.min(1.0, starColor.r * brightness * tint);
            colors[i3 + 1] = Math.min(1.0, starColor.g * brightness * tint);
            colors[i3 + 2] = Math.min(1.0, starColor.b * brightness * tint);

            twinkles[i2] = this.rand() * Math.PI * 2;
            twinkles[i2 + 1] = 0.75 + this.rand() * 1.9;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('twinkle', new THREE.BufferAttribute(twinkles, 2));
        geometry.computeBoundingSphere();

        let material;
        let starMaterialData = null;
        if (this.isWebGPU) {
            starMaterialData = createStarfieldNodeMaterial();
            material = starMaterialData.material;
        } else {
            const starSpriteCanvas = document.createElement('canvas');
            starSpriteCanvas.width = 64;
            starSpriteCanvas.height = 64;
            const ctx = starSpriteCanvas.getContext('2d');
            const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.25, 'rgba(255,255,255,0.9)');
            gradient.addColorStop(0.65, 'rgba(255,255,255,0.18)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);
            const starSprite = new THREE.CanvasTexture(starSpriteCanvas);

            material = new THREE.PointsMaterial({
                size: 24,
                vertexColors: true,
                transparent: true,
                opacity: 0.88,
                map: starSprite,
                alphaMap: starSprite,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                sizeAttenuation: true,
                fog: false,
            });
        }

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.userData.materialData = starMaterialData;
        this.starfield.renderOrder = -140;
        this.starfield.frustumCulled = false;
        this.scene.add(this.starfield);
        this.createNebulaBackdrop();
        console.log(`[ChromadelicHighway] Starfield: ${starCount} stars`);
    }

    createNebulaBackdrop() {
        this.nebulaPlanes = [];

        // Use fewer, larger planes for the rainbow nebula effect
        // The texture handles color diversity, so we don't need the color palette loop
        const planeCount = 3;

        // Load the rainbow nebula texture
        const textureLoader = new THREE.TextureLoader();
        const rainbowTexture = textureLoader.load('./textures/rainbow-nebula.png');
        rainbowTexture.wrapS = THREE.RepeatWrapping;
        rainbowTexture.wrapT = THREE.RepeatWrapping;

        for (let i = 0; i < planeCount; i++) {
            const size = 4500 + this.rand() * 2000; // Moderate size

            // Fallback texture generation for WebGL or if texture fails (optional, keeping it simple for now)
            // For WebGL fallback we might need a simple color or the same texture if compatible.
            // Let's assume texture works for both, but shader differs.

            const geo = new THREE.PlaneGeometry(size, size);

            let mat;
            let matData = null;

            if (this.isWebGPU) {
                matData = createNebulaNodeMaterial(rainbowTexture);
                mat = matData.material;
            } else {
                mat = new THREE.MeshBasicMaterial({
                    map: rainbowTexture,
                    transparent: true,
                    opacity: 0.45,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const plane = new THREE.Mesh(geo, mat);
            plane.position.set(
                -2500 + (this.rand() - 0.5) * 2000, // Left but visible
                500 + this.rand() * 700,
                -3300 - i * 900, // Consistent visible depth
            );
            // Random rotation for variety
            plane.rotation.z = this.rand() * Math.PI * 2;

            plane.userData.basePosition = plane.position.clone();
            plane.userData.driftAmplitude = 40 + this.rand() * 40;
            plane.userData.driftSpeed = 0.03 + this.rand() * 0.02;
            plane.userData.phase = this.rand() * Math.PI * 2;
            plane.userData.baseOpacity = mat.opacity ?? 1;
            plane.userData.materialData = matData; // Store material data for uniform updates
            plane.lookAt(this.camera.position);
            this.nebulaPlanes.push(plane);
            this.scene.add(plane);
        }

        this.createDepthHazeLayers();
    }

    createDepthHazeLayers() {
        this.depthHazeLayers = [];

        const layerCount = Math.max(2, Math.min(6, Math.floor(this.qualityPreset.ringCount / 2)));
        for (let i = 0; i < layerCount; i++) {
            const size = 1800 + i * 450;
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 160;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(80, 80, 0, 80, 80, 80);
            const hue = (0.58 + i * 0.11) % 1;
            const color = new THREE.Color().setHSL(hue, 0.45, 0.32);
            gradient.addColorStop(0, `rgba(${Math.floor(color.r * 255)},${Math.floor(color.g * 255)},${Math.floor(color.b * 255)},0.085)`);
            gradient.addColorStop(0.55, `rgba(${Math.floor(color.r * 255)},${Math.floor(color.g * 255)},${Math.floor(color.b * 255)},0.03)`);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 160, 160);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(size, size * 0.6);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0.16 - i * 0.02,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const haze = new THREE.Mesh(geometry, material);
            haze.position.set(
                (this.rand() - 0.5) * 1100,
                130 + i * 80 + this.rand() * 70,
                -900 - i * 520,
            );
            haze.renderOrder = -120 - i;
            haze.userData.basePosition = haze.position.clone();
            haze.userData.baseOpacity = material.opacity;
            haze.userData.driftAmplitude = 26 + i * 12;
            haze.userData.verticalAmplitude = 14 + i * 6;
            haze.userData.driftSpeed = 0.03 + i * 0.01;
            haze.userData.phase = this.rand() * Math.PI * 2;
            haze.lookAt(this.camera.position);

            this.depthHazeLayers.push(haze);
            this.scene.add(haze);
        }
    }

    animateDepthHaze() {
        if (!this.camera) return;

        this.nebulaPlanes.forEach((plane) => {
            const base = plane.userData.basePosition;
            if (!base) return;
            const phase = plane.userData.phase || 0;
            const speed = plane.userData.driftSpeed || 0.05;
            const amp = plane.userData.driftAmplitude || 30;
            plane.position.x = base.x + Math.sin(this.time * speed + phase) * amp;
            plane.position.y = base.y + Math.cos(this.time * speed * 0.8 + phase) * amp * 0.2;
            plane.lookAt(this.camera.position);

            // Update nebula shader uniforms
            if (plane.userData.materialData && plane.userData.materialData.uniforms) {
                const { uTime, uPulse } = plane.userData.materialData.uniforms;
                if (uTime) uTime.value = this.time;
                if (uPulse) uPulse.value = this.pulseIntensity;
            }
        });

        this.depthHazeLayers.forEach((haze) => {
            const base = haze.userData.basePosition;
            if (!base) return;
            const phase = haze.userData.phase || 0;
            const speed = haze.userData.driftSpeed || 0.04;
            const ampX = haze.userData.driftAmplitude || 30;
            const ampY = haze.userData.verticalAmplitude || 14;
            haze.position.x = base.x + Math.sin(this.time * speed + phase) * ampX;
            haze.position.y = base.y + Math.cos(this.time * speed * 0.7 + phase) * ampY;
            haze.material.opacity = THREE.MathUtils.clamp(
                haze.userData.baseOpacity * (0.9 + this.pulseIntensity * 0.14),
                0.03,
                0.22,
            );
            haze.lookAt(this.camera.position);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rainbow Planet (Primary)
    // ─────────────────────────────────────────────────────────────────────────

    createRainbowPlanet() {
        const planetSize = 450;
        const geometry = new THREE.SphereGeometry(planetSize, 48, 48);

        const textureLoader = new THREE.TextureLoader();
        const planetTexture = textureLoader.load('./textures/2k_rainbow_planet.png');
        planetTexture.wrapS = THREE.ClampToEdgeWrapping;
        planetTexture.wrapT = THREE.ClampToEdgeWrapping;

        let material;
        let materialData = null;

        if (this.isWebGPU) {
            materialData = createPlanetNodeMaterial(planetTexture);
            material = materialData.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uMap: { value: planetTexture },
                    uPulse: { value: 0 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;
                    void main() {
                        vUv = uv;
                        vNormal = normalize(normalMatrix * normal);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        vViewPosition = -mvPosition.xyz;
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform sampler2D uMap;
                    uniform float uPulse;
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;
                    vec3 hsv2rgb(vec3 c) {
                        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                    }
                    void main() {
                        vec3 viewDir = normalize(vViewPosition);
                        vec4 texColor = texture2D(uMap, vUv);
                        vec3 baseColor = texColor.rgb;
                        vec3 lightDir = normalize(vec3(0.6, 0.4, 0.5));
                        float NdotL = dot(vNormal, lightDir);
                        float shadow = smoothstep(-0.2, 0.4, NdotL);
                        vec3 shadowColor = baseColor * 0.15;
                        vec3 litColor = baseColor;
                        vec3 finalColor = mix(shadowColor, litColor, shadow);
                        float viewDot = abs(dot(vNormal, viewDir));
                        float fresnel = pow(1.0 - viewDot, 3.0);
                        float hue = fract(uTime * 0.1 + fresnel * 2.0);
                        vec3 rainbowRim = hsv2rgb(vec3(hue, 0.9, 1.0));
                        finalColor += rainbowRim * fresnel * 0.8 * (1.0 + uPulse * 0.5);
                        float innerFresnel = pow(1.0 - viewDot, 1.5);
                        finalColor += baseColor * innerFresnel * 0.3;
                        finalColor *= 1.0 + uPulse * 0.2;
                        gl_FragColor = vec4(finalColor, 1.0);
                    }
                `,
            });
        }

        this.planet = new THREE.Mesh(geometry, material);
        this.planet.position.copy(this.planetStartPos);
        this.planet.renderOrder = -50;
        this.planet.userData.materialData = materialData;
        this.scene.add(this.planet);

        // Glow layers
        const glowConfigs = [
            { size: planetSize * 2.1, opacity: 0.32, z: -28 },
            { size: planetSize * 2.85, opacity: 0.19, z: -56 },
            { size: planetSize * 3.7, opacity: 0.095, z: -92 },
        ];

        glowConfigs.forEach((config, index) => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.2, 'rgba(255, 200, 255, 0.8)');
            gradient.addColorStop(0.5, 'rgba(150, 100, 255, 0.4)');
            gradient.addColorStop(0.8, 'rgba(100, 200, 255, 0.15)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const glowGeo = new THREE.PlaneGeometry(config.size, config.size);

            let glowMat;
            if (this.isWebGPU) {
                const glowData = createPlanetGlowNodeMaterial(texture, config.opacity);
                glowMat = glowData.material;
            } else {
                glowMat = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: config.opacity,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
            }

            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.copy(this.planet.position);
            glow.position.z += config.z;
            glow.renderOrder = -60 - index;
            glow.userData.baseOpacity = config.opacity;
            glow.userData.zOffset = config.z;
            this.planetGlows.push(glow);
            this.scene.add(glow);
        });

        console.log('[ChromadelicHighway] Rainbow planet created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional Planets (Enhanced Visuals)
    // ─────────────────────────────────────────────────────────────────────────

    createAdditionalPlanets() {
        const planetCount = this.qualityPreset.planetCount;
        if (planetCount < 2) return;

        const textureLoader = new THREE.TextureLoader();

        // Neon Gas Giant - far left background (Jupiter texture)
        if (planetCount >= 2) {
            const gasGiantSize = 350;
            const gasGiantGeo = new THREE.SphereGeometry(gasGiantSize, 40, 40);

            const jupiterTexture = textureLoader.load('./textures/2k_makemake_fictional.jpg');
            jupiterTexture.wrapS = THREE.ClampToEdgeWrapping;
            jupiterTexture.wrapT = THREE.ClampToEdgeWrapping;

            let gasGiantMat;
            let gasGiantMatData = null;

            if (this.isWebGPU) {
                gasGiantMatData = createGasGiantNodeMaterial(jupiterTexture);
                gasGiantMat = gasGiantMatData.material;
            } else {
                gasGiantMat = new THREE.MeshBasicMaterial({
                    map: jupiterTexture,
                });
            }

            this.neonGasGiant = new THREE.Mesh(gasGiantGeo, gasGiantMat);
            this.neonGasGiant.position.set(-2520, 560, -3340);
            this.neonGasGiant.renderOrder = -68;
            this.neonGasGiant.scale.setScalar(0.88);
            this.neonGasGiant.userData.materialData = gasGiantMatData;
            this.neonGasGiant.userData.basePosition = this.neonGasGiant.position.clone();
            this.neonGasGiant.userData.baseScale = 0.88;
            this.neonGasGiant.userData.approachProfile = {
                start: new THREE.Vector3(-2520, 560, -3340),
                close: new THREE.Vector3(-1140, 250, -840),
                end: new THREE.Vector3(-1860, 430, 520),
                phaseOffset: 36,
                approachEnd: 114,
                flybyEnd: 154,
                arcAmplitudeX: 74,
                arcAmplitudeY: 34,
                arcFrequencyX: 0.5,
                arcFrequencyY: 0.82,
                arcPhaseY: 1.4,
                corridorCenterX: -1200,
                corridorHalfWidth: 980,
            };
            this.neonGasGiant.userData.scaleProfile = {
                minScale: 0.62,
                maxScale: 1.26,
                nearDistance: 780,
                farDistance: 5200,
                glowScale: 0.22,
                pulseScale: 0.04,
                paceScale: 0.06,
            };
            this.neonGasGiant.userData.driftPhase = this.rand() * Math.PI * 2;
            this.neonGasGiant.userData.driftSpeed = 0.03;
            this.neonGasGiant.userData.driftAmplitudeX = 52;
            this.neonGasGiant.userData.driftAmplitudeY = 22;
            this.scene.add(this.neonGasGiant);

            // Glow for gas giant
            this.createPlanetGlowLayers(this.neonGasGiant, gasGiantSize, this.neonGasGiantGlows, 'rgba(120, 80, 200,');
        }

        // Ice Moon - orbits the main rainbow planet (Neptune texture)
        if (planetCount >= 3) {
            const moonSize = 80;
            const moonGeo = new THREE.SphereGeometry(moonSize, 32, 32);

            const neptuneTexture = textureLoader.load('./textures/2k_neptune.jpg');
            neptuneTexture.wrapS = THREE.ClampToEdgeWrapping;
            neptuneTexture.wrapT = THREE.ClampToEdgeWrapping;

            let moonMat;
            let moonMatData = null;

            if (this.isWebGPU) {
                moonMatData = createIceMoonNodeMaterial(neptuneTexture);
                moonMat = moonMatData.material;
            } else {
                moonMat = new THREE.MeshBasicMaterial({
                    map: neptuneTexture,
                });
            }

            this.crystalMoon = new THREE.Mesh(moonGeo, moonMat);
            this.crystalMoon.position.copy(this.planetStartPos);
            this.crystalMoon.renderOrder = -45;
            this.crystalMoon.userData.materialData = moonMatData;
            this.crystalMoon.userData.baseScale = 1.0;
            this.crystalMoon.userData.orbitRadius = 850;
            this.crystalMoon.userData.orbitSpeed = 0.052;
            this.crystalMoon.userData.verticalScale = 0.18;
            this.crystalMoon.userData.depthScale = 0.62;
            this.crystalMoon.userData.scaleProfile = {
                minScale: 0.64,
                maxScale: 1.34,
                nearDistance: 520,
                farDistance: 4200,
                glowScale: 0.16,
                pulseScale: 0.05,
                paceScale: 0.06,
            };
            this.scene.add(this.crystalMoon);
            this.createPlanetGlowLayers(
                this.crystalMoon,
                moonSize,
                this.crystalMoonGlows,
                'rgba(120, 190, 255,',
                {
                    renderOrderBase: -58,
                    glowConfigs: [
                        { size: moonSize * 2.25, opacity: 0.19, z: -16 },
                        { size: moonSize * 3.2, opacity: 0.095, z: -30 },
                    ],
                },
            );
        }

        // Binary Dwarf Stars - far background
        if (planetCount >= 4) {
            const starSize = 60;
            const starHues = [0.1, 0.6]; // Orange and Cyan

            starHues.forEach((hue, idx) => {
                const starGeo = new THREE.SphereGeometry(starSize, 24, 24);

                let starMat;
                let starMatData = null;

                if (this.isWebGPU) {
                    starMatData = createBinaryStarNodeMaterial(hue);
                    starMat = starMatData.material;
                } else {
                    const color = new THREE.Color().setHSL(hue, 0.8, 0.7);
                    starMat = new THREE.MeshBasicMaterial({
                        color,
                        transparent: true,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    });
                }

                const star = new THREE.Mesh(starGeo, starMat);
                star.position.set(
                    -1320 + idx * 92,
                    760,
                    -4200,
                );
                star.renderOrder = -70;
                star.userData.materialData = starMatData;
                star.userData.hue = hue;
                star.userData.orbitOffset = idx * Math.PI;
                star.userData.baseCenter = new THREE.Vector3(-1274, 760, -4200);
                star.userData.orbitRadius = 46;
                star.userData.orbitSpeed = 0.085;
                star.userData.baseScale = 1.0;
                star.userData.scaleProfile = {
                    minScale: 0.7,
                    maxScale: 1.08,
                    nearDistance: 1200,
                    farDistance: 6800,
                    glowScale: 0.1,
                    pulseScale: 0.02,
                    paceScale: 0.02,
                };
                this.binaryStars.push(star);
                this.scene.add(star);
            });
        }

        // Venus Atmospheric Orb - far right background (Extreme quality only)
        if (planetCount >= 5) {
            const venusSize = 180;
            const venusGeo = new THREE.SphereGeometry(venusSize, 36, 36);

            const venusTexture = textureLoader.load('./textures/2k_venus_atmosphere.jpg');
            venusTexture.wrapS = THREE.RepeatWrapping;
            venusTexture.wrapT = THREE.ClampToEdgeWrapping;

            let venusMat;
            let venusMatData = null;

            if (this.isWebGPU) {
                venusMatData = createAtmosphericOrbNodeMaterial(venusTexture);
                venusMat = venusMatData.material;
            } else {
                venusMat = new THREE.MeshBasicMaterial({
                    map: venusTexture,
                });
            }

            this.venusOrb = new THREE.Mesh(venusGeo, venusMat);
            this.venusOrb = new THREE.Mesh(venusGeo, venusMat);
            this.venusOrb.position.set(-1500, 800, -4200);
            this.venusOrb.renderOrder = -66;
            this.venusOrb.userData.materialData = venusMatData;
            this.venusOrb.userData.basePosition = this.venusOrb.position.clone();
            this.venusOrb.userData.baseScale = 1.2;
            this.venusOrb.userData.approachProfile = {
                start: new THREE.Vector3(-1500, 800, -4200),
                close: new THREE.Vector3(-1800, 900, -3800),
                end: new THREE.Vector3(-1200, 700, -4000),
                phaseOffset: 86,
                approachEnd: 118,
                flybyEnd: 160,
                arcAmplitudeX: 70,
                arcAmplitudeY: 42,
                arcFrequencyX: 0.58,
                arcFrequencyY: 0.9,
                arcPhaseY: 0.9,
                corridorCenterX: -1260,
                corridorHalfWidth: 980,
            };
            this.venusOrb.userData.scaleProfile = {
                minScale: 0.58,
                maxScale: 1.24,
                nearDistance: 760,
                farDistance: 5000,
                glowScale: 0.2,
                pulseScale: 0.04,
                paceScale: 0.05,
            };
            this.venusOrb.userData.driftPhase = this.rand() * Math.PI * 2;
            this.venusOrb.userData.driftSpeed = 0.02;
            this.venusOrb.userData.driftAmplitudeX = 40;
            this.venusOrb.userData.driftAmplitudeY = 30;
            this.scene.add(this.venusOrb);

            // Glow for venus orb
            this.createPlanetGlowLayers(this.venusOrb, venusSize, this.venusOrbGlows, 'rgba(255, 170, 80,');
        }

        // Mars - right side, medium depth
        if (planetCount >= 6) {
            const marsSize = 140;
            const marsGeo = new THREE.SphereGeometry(marsSize, 32, 32);
            const marsTex = textureLoader.load('./textures/2k_mars.jpg');

            let marsMat;
            let marsMatData = null;
            if (this.isWebGPU) {
                // Reuse gas giant material for simplified shader logic that supports pulse
                marsMatData = createGasGiantNodeMaterial(marsTex);
                marsMat = marsMatData.material;
            } else {
                marsMat = new THREE.MeshBasicMaterial({ map: marsTex });
            }

            this.marsPlanet = new THREE.Mesh(marsGeo, marsMat);
            this.marsPlanet.position.set(1300, 600, -2800);
            this.marsPlanet.renderOrder = -63;
            this.marsPlanet.userData.materialData = marsMatData;
            this.marsPlanet.userData.basePosition = this.marsPlanet.position.clone();
            this.marsPlanet.userData.approachProfile = {
                start: new THREE.Vector3(1300, 500, -5000),
                close: new THREE.Vector3(1800, 600, -1800),
                end: new THREE.Vector3(2600, 800, 800),
                phaseOffset: 90,
                approachEnd: 140,
                flybyEnd: 170,
                arcAmplitudeX: 30,
                arcAmplitudeY: 15,
            };
            this.marsPlanet.userData.baseScale = 1.0;
            this.marsPlanet.userData.scaleProfile = {
                minScale: 0.7, maxScale: 1.3,
                nearDistance: 600, farDistance: 4500,
                glowScale: 0.15, pulseScale: 0.03, paceScale: 0.04,
            };
            this.marsPlanet.userData.driftPhase = this.rand() * Math.PI * 2;
            this.marsPlanet.userData.driftSpeed = 0.025;
            this.marsPlanet.userData.driftAmplitudeX = 50;
            this.marsPlanet.userData.driftAmplitudeY = 40;
            this.scene.add(this.marsPlanet);
            this.marsGlows = [];
            this.createPlanetGlowLayers(this.marsPlanet, marsSize, this.marsGlows, 'rgba(255, 80, 50,');
        }

        // Mercury - left side, closer depth
        if (planetCount >= 7) {
            const mercurySize = 200;
            const mercuryGeo = new THREE.SphereGeometry(mercurySize, 40, 40);
            const mercuryTex = textureLoader.load('./textures/2k_mercury.jpg');

            let mercuryMat;
            let mercuryMatData = null;
            if (this.isWebGPU) {
                mercuryMatData = createGasGiantNodeMaterial(mercuryTex);
                mercuryMat = mercuryMatData.material;
            } else {
                mercuryMat = new THREE.MeshBasicMaterial({ map: mercuryTex });
            }

            this.mercuryPlanet = new THREE.Mesh(mercuryGeo, mercuryMat);
            this.mercuryPlanet.position.set(-1800, 400, -2100);
            this.mercuryPlanet.renderOrder = -60;
            this.mercuryPlanet.userData.materialData = mercuryMatData;
            this.mercuryPlanet.userData.basePosition = this.mercuryPlanet.position.clone();

            // Approach profile to make it get closer over time
            this.mercuryPlanet.userData.approachProfile = {
                start: new THREE.Vector3(-1800, 400, -4500),
                close: new THREE.Vector3(-2400, 500, -1500),
                end: new THREE.Vector3(-3200, 700, 1000),
                phaseOffset: 60,
                approachEnd: 140,
                flybyEnd: 170,
                arcAmplitudeX: 40,
                arcAmplitudeY: 20,
            };

            this.mercuryPlanet.userData.baseScale = 1.1;
            this.mercuryPlanet.userData.scaleProfile = {
                minScale: 0.6, maxScale: 1.4,
                nearDistance: 500, farDistance: 3500,
                glowScale: 0.18, pulseScale: 0.04, paceScale: 0.05,
            };
            this.mercuryPlanet.userData.driftPhase = this.rand() * Math.PI * 2;
            this.mercuryPlanet.userData.driftSpeed = 0.035;
            this.mercuryPlanet.userData.driftAmplitudeX = 60;
            this.mercuryPlanet.userData.driftAmplitudeY = 50;
            this.scene.add(this.mercuryPlanet);
            this.mercuryGlows = [];
            this.createPlanetGlowLayers(this.mercuryPlanet, mercurySize, this.mercuryGlows, 'rgba(150, 150, 150,');
        }

        // Saturn - far right background
        if (planetCount >= 8) {
            const saturnSize = 280;
            const saturnGeo = new THREE.SphereGeometry(saturnSize, 40, 40);
            const saturnTex = textureLoader.load('./textures/2k_saturn.jpg');

            let saturnMat;
            let saturnMatData = null;
            if (this.isWebGPU) {
                saturnMatData = createGasGiantNodeMaterial(saturnTex);
                saturnMat = saturnMatData.material;
            } else {
                saturnMat = new THREE.MeshBasicMaterial({ map: saturnTex });
            }

            this.saturnPlanet = new THREE.Group();
            const saturnBody = new THREE.Mesh(saturnGeo, saturnMat);
            this.saturnPlanet.add(saturnBody);

            // Saturn Rings
            const ringGeo = new THREE.RingGeometry(saturnSize * 1.3, saturnSize * 2.4, 64);
            const ringTex = textureLoader.load('./textures/2k_saturn_ring_alpha.png');
            let ringMat;
            if (this.isWebGPU) {
                // Reuse gas giant material for simplified shader logic
                const ringMatData = createGasGiantNodeMaterial(ringTex);
                ringMat = ringMatData.material;
                ringMat.transparent = true;
                ringMat.side = THREE.DoubleSide;
            } else {
                ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide });
            }
            const saturnRings = new THREE.Mesh(ringGeo, ringMat);
            saturnRings.rotation.x = Math.PI / 2.5;
            saturnRings.rotation.y = Math.PI / 8;
            this.saturnPlanet.add(saturnRings);

            this.saturnPlanet.position.set(2200, 700, -4500);
            this.saturnPlanet.renderOrder = -68;
            this.saturnPlanet.userData.materialData = saturnMatData;
            this.saturnPlanet.userData.basePosition = this.saturnPlanet.position.clone();
            this.saturnPlanet.userData.approachProfile = {
                start: new THREE.Vector3(2200, 700, -5500),
                close: new THREE.Vector3(2900, 800, -2200),
                end: new THREE.Vector3(3800, 1000, 1200),
                phaseOffset: 30,
                approachEnd: 140,
                flybyEnd: 170,
                arcAmplitudeX: 50,
                arcAmplitudeY: 30,
            };
            this.saturnPlanet.userData.baseScale = 0.9;
            this.saturnPlanet.userData.scaleProfile = {
                minScale: 0.6, maxScale: 1.2,
                nearDistance: 800, farDistance: 5500,
                glowScale: 0.2, pulseScale: 0.05, paceScale: 0.05,
            };
            this.saturnPlanet.userData.driftPhase = this.rand() * Math.PI * 2;
            this.saturnPlanet.userData.driftSpeed = 0.015;
            this.saturnPlanet.userData.driftAmplitudeX = 40;
            this.saturnPlanet.userData.driftAmplitudeY = 30;
            this.scene.add(this.saturnPlanet);
            this.saturnGlows = [];
            this.createPlanetGlowLayers(this.saturnPlanet, saturnSize * 1.5, this.saturnGlows, 'rgba(230, 200, 130,');
        }

        // Uranus - far deep center/left
        if (planetCount >= 9) {
            const uranusSize = 220;
            const uranusGeo = new THREE.SphereGeometry(uranusSize, 32, 32);
            const uranusTex = textureLoader.load('./textures/2k_uranus.jpg');

            let uranusMat;
            let uranusMatData = null;
            if (this.isWebGPU) {
                uranusMatData = createGasGiantNodeMaterial(uranusTex);
                uranusMat = uranusMatData.material;
            } else {
                uranusMat = new THREE.MeshBasicMaterial({ map: uranusTex });
            }

            this.uranusPlanet = new THREE.Mesh(uranusGeo, uranusMat);
            this.uranusPlanet.position.set(-800, 900, -5000);
            this.uranusPlanet.renderOrder = -70;
            this.uranusPlanet.userData.materialData = uranusMatData;
            this.uranusPlanet.userData.basePosition = this.uranusPlanet.position.clone();
            this.uranusPlanet.userData.approachProfile = {
                start: new THREE.Vector3(-800, 900, -6000),
                close: new THREE.Vector3(-1400, 1100, -2800),
                end: new THREE.Vector3(-2200, 1400, 1500),
                phaseOffset: 0,
                approachEnd: 140,
                flybyEnd: 170,
                arcAmplitudeX: 60,
                arcAmplitudeY: 35,
            };
            this.uranusPlanet.userData.baseScale = 1.0;
            this.uranusPlanet.userData.scaleProfile = {
                minScale: 0.5, maxScale: 1.1,
                nearDistance: 1000, farDistance: 6000,
                glowScale: 0.15, pulseScale: 0.03, paceScale: 0.04,
            };
            this.uranusPlanet.userData.driftPhase = this.rand() * Math.PI * 2;
            this.uranusPlanet.userData.driftSpeed = 0.018;
            this.uranusPlanet.userData.driftAmplitudeX = 80;
            this.uranusPlanet.userData.driftAmplitudeY = 60;
            this.scene.add(this.uranusPlanet);
            this.uranusGlows = [];
            this.createPlanetGlowLayers(this.uranusPlanet, uranusSize, this.uranusGlows, 'rgba(150, 230, 255,');
        }

        console.log(`[ChromadelicHighway] ${planetCount - 1} additional celestial bodies created`);
    }

    createPlanetGlowLayers(planet, planetSize, glowArray, colorPrefix, options = {}) {
        const glowConfigs = options.glowConfigs || [
            { size: planetSize * 1.95, opacity: 0.23, z: -22 },
            { size: planetSize * 2.65, opacity: 0.11, z: -44 },
        ];
        const renderOrderBase = options.renderOrderBase ?? -65;

        glowConfigs.forEach((config, index) => {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            gradient.addColorStop(0, `${colorPrefix} 0.8)`);
            gradient.addColorStop(0.5, `${colorPrefix} 0.2)`);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);

            const texture = new THREE.CanvasTexture(canvas);
            const glowGeo = new THREE.PlaneGeometry(config.size, config.size);
            const glowMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.copy(planet.position);
            glow.position.z += config.z;
            glow.renderOrder = renderOrderBase - index;
            glow.userData.baseOpacity = config.opacity;
            glow.userData.zOffset = config.z;
            glowArray.push(glow);
            this.scene.add(glow);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Speed Particles
    // ─────────────────────────────────────────────────────────────────────────

    createSpeedParticles(useCompute) {
        this.speedParticleCompute = null;
        const particleCount = Math.min(
            this.qualityPreset.speedParticleCount,
            this.performanceBudget?.maxSpeedParticles ?? this.qualityPreset.speedParticleCount,
        );
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const palette = [
            new THREE.Color(0xFF3366),
            new THREE.Color(0x00FFFF),
            new THREE.Color(0xFFFF00),
            new THREE.Color(0xFF6600),
            new THREE.Color(0x9933FF),
            new THREE.Color(0x00FF66),
            new THREE.Color(0xFF0099),
            new THREE.Color(0x3399FF),
        ];

        // Add deep cosmic purples for intense swirling in Extreme/Ultra modes
        if (this.qualityPreset.speedParticleCount >= 2000) {
            palette.push(
                new THREE.Color(0x6600cc),
                new THREE.Color(0xcc00ff),
                new THREE.Color(0xb84dff),
                new THREE.Color(0x5c00e6)
            );
        }

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            const side = this.rand() > 0.5 ? 1 : -1;
            positions[i3] = side * (80 + this.rand() * 60);
            positions[i3 + 1] = this.rand() * 60 + 5;
            positions[i3 + 2] = -this.rand() * 2200;

            const color = palette[Math.floor(this.rand() * palette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 4 + this.rand() * 5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Setup compute if available
        if (useCompute) {
            try {
                this.speedParticleCompute = new SpeedParticleCompute(particleCount, () => this.rand());
                this.speedParticleCompute.setInitialState(positions, colors, sizes);
                this.speedParticleCompute.createComputeNode();
            } catch (err) {
                console.warn('[ChromadelicHighway] Speed particle compute init failed:', err.message);
                this.speedParticleCompute = null;
            }
        }

        let material;
        if (this.isWebGPU) {
            const matData = createSpeedParticleNodeMaterial({ particleCompute: this.speedParticleCompute });
            material = matData.material;
            this.speedParticleMaterialData = matData;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: { uPulse: { value: 0 } },
                vertexShader: `
                    uniform float uPulse;
                    attribute float size;
                    attribute vec3 color;
                    varying vec3 vColor;
                    void main() {
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        float baseSize = size * (1.0 + uPulse * 0.5);
                        gl_PointSize = baseSize * (300.0 / -mvPosition.z);
                        gl_PointSize = clamp(gl_PointSize, 1.0, 25.0);
                        vColor = color;
                    }
                `,
                fragmentShader: `
                    varying vec3 vColor;
                    void main() {
                        vec2 center = gl_PointCoord - vec2(0.5);
                        float dist = length(center);
                        float alpha = smoothstep(0.5, 0.1, dist) * 0.7;
                        float core = smoothstep(0.3, 0.0, dist) * 0.6;
                        vec3 finalColor = vColor + core;
                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        }

        this.speedParticles = new THREE.Points(geometry, material);
        this.scene.add(this.speedParticles);
        console.log(`[ChromadelicHighway] ${particleCount} speed particles (compute: ${!!this.speedParticleCompute})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles(useCompute) {
        this.ambientParticleCompute = null;
        const particleCount = Math.min(
            this.qualityPreset.ambientParticleCount,
            this.performanceBudget?.maxAmbientParticles ?? this.qualityPreset.ambientParticleCount,
        );
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);

        const palette = [
            new THREE.Color(0xFF3366),
            new THREE.Color(0x00FFFF),
            new THREE.Color(0xFFFF00),
            new THREE.Color(0xFF6600),
            new THREE.Color(0x9933FF),
            new THREE.Color(0x00FF66),
            new THREE.Color(0xFF0099),
            new THREE.Color(0x3399FF),
        ];

        // Add deep cosmic purples for intense swirling in Extreme/Ultra modes
        if (this.qualityPreset.ambientParticleCount >= 1500) {
            palette.push(
                new THREE.Color(0x6600cc),
                new THREE.Color(0xcc00ff),
                new THREE.Color(0xb84dff),
                new THREE.Color(0x5c00e6)
            );
        }

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            const distribution = this.rand();

            if (distribution < 0.4) {
                const angle = this.rand() * Math.PI * 2;
                const radius = 150 + this.rand() * 200;
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = 50 + this.rand() * 150;
                positions[i3 + 2] = Math.sin(angle) * radius - 400;
            } else if (distribution < 0.7) {
                const theta = this.rand() * Math.PI * 2;
                const phi = this.rand() * Math.PI * 0.5;
                const radius = 300 + this.rand() * 400;
                positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = radius * Math.cos(phi) + 100;
                positions[i3 + 2] = -radius * Math.sin(phi) * Math.sin(theta) - 600;
            } else {
                const side = this.rand() > 0.5 ? 1 : -1;
                positions[i3] = side * (150 + this.rand() * 150);
                positions[i3 + 1] = 30 + this.rand() * 100;
                positions[i3 + 2] = -this.rand() * 1800 - 200;
            }

            const color = palette[Math.floor(this.rand() * palette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            randoms[i] = this.rand();
            sizes[i] = 3 + this.rand() * 5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        if (useCompute) {
            try {
                this.ambientParticleCompute = new AmbientParticleCompute(particleCount);
                this.ambientParticleCompute.setInitialState(positions, colors, randoms, sizes);
                this.ambientParticleCompute.createComputeNode();
            } catch (err) {
                console.warn('[ChromadelicHighway] Ambient particle compute init failed:', err.message);
                this.ambientParticleCompute = null;
            }
        }

        let material;
        if (this.isWebGPU) {
            const matData = createAmbientParticleNodeMaterial({ particleCompute: this.ambientParticleCompute });
            material = matData.material;
            this.ambientParticleMaterialData = matData;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPulse: { value: 0 },
                    uSpeedMultiplier: { value: 1.0 },
                },
                vertexShader: `
                    uniform float uTime;
                    uniform float uPulse;
                    uniform float uSpeedMultiplier;
                    attribute float aRandom;
                    attribute float size;
                    attribute vec3 color;
                    varying vec3 vColor;
                    varying float vAlpha;
                    void main() {
                        vec3 pos = position;
                        float orbitSpeed = (0.05 + aRandom * 0.05) * uSpeedMultiplier;
                        float angle = uTime * orbitSpeed;
                        float s = sin(angle);
                        float c = cos(angle);
                        vec3 rotatedPos = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
                        rotatedPos.y += sin(uTime * 0.3 + aRandom * 10.0) * 15.0;
                        rotatedPos.x += sin(uTime * 0.2 + aRandom * 5.0) * 10.0;
                        vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        float baseSize = size * (1.0 + uPulse * 0.5);
                        gl_PointSize = baseSize * (300.0 / -mvPosition.z);
                        gl_PointSize = clamp(gl_PointSize, 1.0, 20.0);
                        vAlpha = 0.4 + 0.4 * sin(uTime * 1.5 + aRandom * 10.0) + uPulse * 0.3;
                        vColor = color;
                    }
                `,
                fragmentShader: `
                    varying vec3 vColor;
                    varying float vAlpha;
                    void main() {
                        vec2 center = gl_PointCoord - vec2(0.5);
                        float dist = length(center);
                        float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
                        float core = smoothstep(0.3, 0.0, dist) * 0.5;
                        vec3 finalColor = vColor + core;
                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        }

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);
        console.log(`[ChromadelicHighway] ${particleCount} ambient particles (compute: ${!!this.ambientParticleCompute})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shooting Stars
    // ─────────────────────────────────────────────────────────────────────────

    createShootingStars() {
        console.log('[ChromadelicHighway] Shooting star system initialized');
    }

    spawnShootingStar() {
        const baseBudget = this.performanceBudget?.maxActiveShootingStars ?? 8;
        const starBudget = baseBudget * 3; // Tripled budget to allow meteor showers
        if (this.shootingStars.length >= starBudget) return;

        const startX = (this.rand() - 0.5) * 3000;
        const startY = 200 + this.rand() * 600;
        const startZ = -1200 - this.rand() * 1500;

        const angle = this.rand() * Math.PI * 2;
        const dirX = Math.cos(angle) * (0.5 + this.rand() * 0.5);
        const dirY = -0.2 - this.rand() * 0.4;
        const dirZ = 0.2 + this.rand() * 0.3;

        const trailLength = 400 + this.rand() * 250;
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
        const particleCount = Math.max(48, Math.floor(100 * effectScale));

        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const t = i / (particleCount - 1);
            const trailOffset = -t * trailLength;
            const spread = t * 14;
            const offsetX = (this.rand() - 0.5) * spread;
            const offsetY = (this.rand() - 0.5) * spread;

            positions[i * 3] = startX + dirX * trailOffset + offsetX;
            positions[i * 3 + 1] = startY + dirY * trailOffset + offsetY;
            positions[i * 3 + 2] = startZ + dirZ * trailOffset;

            // Vivid Rainbow Gradient (Full Spectrum along the tail)
            // t goes from 0 (head) to 1 (tail)
            // Head is now pure color instead of white-ish

            // Start hue is random for each star, then cycles along the tail
            const hue = (t * 3.0 + this.rand()) % 1.0;
            const saturation = 1.0; // Max saturation for vividness
            const lightness = 0.5; // Pure vivid color

            const color = new THREE.Color().setHSL(hue, saturation, lightness);

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            const baseSize = 45 + this.rand() * 30; // Slightly larger for impact
            sizes[i] = baseSize * (1 - t * 0.4); // Less taper closer to head
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        const randoms = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) {
            randoms[i] = this.rand();
        }
        geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1));

        let material;
        let materialData = null;
        let starCompute = null;
        if (this.useShootingStarCompute && this.isWebGPU) {
            try {
                starCompute = new ShootingStarCompute(particleCount);
                starCompute.setInitialState(positions);
                starCompute.createComputeNode();
            } catch (error) {
                console.warn('[ChromadelicHighway] Shooting star compute init failed:', error.message);
                starCompute = null;
            }
        }
        if (this.isWebGPU) {
            materialData = createShootingStarNodeMaterial({ particleCompute: starCompute });
            material = materialData.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uOpacity: { value: 1.0 },
                    uTime: { value: 0.0 },
                },
                vertexShader: `
                    attribute float size;
                    attribute vec3 color;
                    attribute float aRandom;
                    varying vec3 vColor;
                    uniform float uTime;
                    void main() {
                        vColor = color;
                        vec3 pos = position;
                        float tailFactor = 1.0 - size / 50.0;
                        pos.x += sin(uTime * 12.0 + aRandom * 20.0) * tailFactor * 10.0;
                        pos.y += cos(uTime * 10.0 + aRandom * 20.0) * tailFactor * 10.0;
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        gl_PointSize = size * (400.0 / -mvPosition.z);
                        gl_PointSize = clamp(gl_PointSize, 2.0, 100.0);
                    }
                `,
                fragmentShader: `
                    uniform float uOpacity;
                    varying vec3 vColor;
                    void main() {
                        vec2 center = gl_PointCoord - vec2(0.5);
                        float dist = length(center);
                        float alpha = smoothstep(0.5, 0.0, dist) * uOpacity;
                        // Reduced white core intensity to keep colors vivid
                        float core = smoothstep(0.25, 0.0, dist) * 0.3; 
                        vec3 finalColor = vColor + core * 0.5; // Less white add
                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        const points = new THREE.Points(geometry, material);
        points.userData = {
            velocity: new THREE.Vector3(dirX, dirY, dirZ).multiplyScalar(180 + this.rand() * 80), // Slightly slower for longer view
            life: 0,
            maxLife: 10 + this.rand() * 5, // Longer lifetime (was 6-10)
            materialData,
            compute: starCompute,
        };

        this.shootingStars.push(points);
        this.scene.add(points);
    }

    updateShootingStars(delta) {
        this.shootingStarTimer += delta;
        if (this.shootingStarTimer >= this.nextShootingStarDelay) {

            // 20% chance for a meteor shower
            const isMeteorShower = this.rand() > 0.8;
            const spawnCount = isMeteorShower ? 3 + Math.floor(this.rand() * 4) : 1;

            for (let s = 0; s < spawnCount; s++) {
                const baseBudget = this.performanceBudget?.maxActiveShootingStars ?? 8;
                if (this.shootingStars.length < baseBudget * 3) {
                    this.spawnShootingStar();
                }
            }

            this.shootingStarTimer = 0;
            const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
            const delayScale = THREE.MathUtils.clamp(1.42 - effectScale * 0.4, 1.0, 1.4);

            if (isMeteorShower) {
                // Wait longer if a shower just happened
                this.nextShootingStarDelay = (2.0 + this.rand() * 2.0) * delayScale;
            } else {
                // Short wait for frequent single stars
                this.nextShootingStarDelay = (0.15 + this.rand() * 0.5) * delayScale;
            }
        }

        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            star.userData.life += delta;
            if (star.userData.compute?.computeNode) {
                star.userData.compute.update(delta, star.userData.velocity);
            } else {
                const positions = star.geometry.attributes.position.array;
                for (let j = 0; j < positions.length; j += 3) {
                    positions[j] += star.userData.velocity.x * delta;
                    positions[j + 1] += star.userData.velocity.y * delta;
                    positions[j + 2] += star.userData.velocity.z * delta;
                }
                star.geometry.attributes.position.needsUpdate = true;
            }

            const materialData = star.userData.materialData;
            if (materialData?.uniforms?.uTime) {
                materialData.uniforms.uTime.value = this.time;
            } else if (star.material.uniforms?.uTime) {
                star.material.uniforms.uTime.value = this.time;
            }

            const lifeRatio = star.userData.life / star.userData.maxLife;
            if (lifeRatio > 0.7) {
                const opacity = 1.0 * (1 - (lifeRatio - 0.7) / 0.3);
                if (materialData?.uniforms?.uOpacity) {
                    materialData.uniforms.uOpacity.value = opacity;
                } else if (star.material.uniforms?.uOpacity) {
                    star.material.uniforms.uOpacity.value = opacity;
                }
            }

            if (star.userData.life >= star.userData.maxLife) {
                this.scene.remove(star);
                star.userData.compute?.dispose?.();
                star.geometry.dispose();
                star.material.dispose();
                this.shootingStars.splice(i, 1);
            }
        }
    }

    auditMrtMaterials() {
        if (!this.flags.mrtAudit || !this.isWebGPU || !this.capabilities.mrt || !this.scene) return;

        let totalNodeMaterials = 0;
        let bloomMaterials = 0;
        let zeroEmissiveMaterials = 0;
        let missingIntent = 0;
        let missingRole = 0;
        let missingEmissive = 0;
        const byRole = {};

        this.scene.traverse((object) => {
            const materials = object.material
                ? (Array.isArray(object.material) ? object.material : [object.material])
                : [];

            for (const material of materials) {
                if (!material || material.isNodeMaterial !== true) continue;
                totalNodeMaterials += 1;

                const role = material.userData?.mrtRole || 'unclassified';
                byRole[role] = (byRole[role] || 0) + 1;

                if (!material.userData || typeof material.userData.emitsBloom !== 'boolean') {
                    missingIntent += 1;
                } else if (material.userData.emitsBloom) {
                    bloomMaterials += 1;
                } else {
                    zeroEmissiveMaterials += 1;
                }

                if (!material.userData?.mrtRole) {
                    missingRole += 1;
                }

                if (material.emissiveNode === undefined || material.emissiveNode === null) {
                    missingEmissive += 1;
                }
            }
        });

        console.log('[ChromadelicHighway] MRT material audit', {
            totalNodeMaterials,
            bloomMaterials,
            zeroEmissiveMaterials,
            missingIntent,
            missingRole,
            missingEmissive,
            byRole,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing (Hybrid)
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        this.disposePostProcessingStack();
        if (!this.capabilities.post) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        if (this.isWebGPU) {
            // WebGPU: MRT-based emissive bloom + chromatic aberration + vignette + ACES
            const useMRT = this.capabilities.mrt;
            try {
                this.postProcessing = new ChromadelicHighwayPost(
                    this.renderer, this.scene, this.camera,
                    {
                        useMRT,
                        bloomStrength: this.getBloomStrength(1),
                        bloomRadius: this.qualityPreset.bloomRadius,
                        bloomThreshold: this.getBloomThreshold(),
                        chromaticStrength: 0.0015,
                        vignetteOffset: 1.0,
                        vignetteDarkness: 0.5,
                        exposure: 1.1,
                        contrast: 1.06,
                        saturation: 1.15,
                    },
                );
                this.postProcessing.setSize(width, height);
                console.log(`[ChromadelicHighway] WebGPU PostProcessing (MRT: ${useMRT})`);
            } catch (err) {
                console.warn('[ChromadelicHighway] WebGPU PostProcessing failed:', err.message);
                this.capabilities.post = false;
                this.postProcessing = null;
                this.configureRendererColorPipeline();
            }
        } else if (this.isWebGL) {
            try {
                // WebGL: EffectComposer
                this.composer = new EffectComposer(this.renderer);
                this.composer.addPass(new RenderPass(this.scene, this.camera));

                if (this.qualityPreset.enableBloom) {
                    this.bloomPass = new UnrealBloomPass(
                        new THREE.Vector2(width, height),
                        this.getBloomStrength(1),
                        this.qualityPreset.bloomRadius,
                        this.getBloomThreshold(),
                    );
                    this.composer.addPass(this.bloomPass);
                }

                const vignettePass = new ShaderPass(VignetteShader);
                this.composer.addPass(vignettePass);
                this.composer.setSize(width, height);

                console.log('[ChromadelicHighway] WebGL EffectComposer ready');
            } catch (err) {
                console.warn('[ChromadelicHighway] WebGL EffectComposer setup failed:', err.message);
                this.capabilities.post = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Play Pace Tracking
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
        const targetSpeed = Math.min(Math.max(ppm / 40, 0.5), 2.5);
        this.targetPaceMultiplier = targetSpeed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        this.clearEventSubscriptions();
        this.removeResizeListener();

        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) {
                const now = Number.isFinite(data?.timestamp) ? data.timestamp : performance.now();
                this.pieceLockTimes.push(now);
                if (this.pieceLockTimes.length > 10) {
                    this.pieceLockTimes.shift();
                }
                this.updatePlayPace();

                if (window.settings?.backgroundComboEffects !== false) {
                    this.pushReactiveEnvelope({
                        pulse: 0.26,
                        particle: 0.34,
                        ambient: 0.16,
                    });
                }
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                const combo = Number.isFinite(data?.comboCount) ? data.comboCount : 0;
                const intensity = Math.min(combo * 0.16, 1.0);
                this.pushReactiveEnvelope({
                    pulse: 0.24 + intensity * 0.34,
                    bloom: 0.08 + intensity * 0.24,
                    ring: 0.14 + intensity * 0.45,
                    particle: 0.11 + intensity * 0.28,
                    ambient: 0.22 + intensity * 0.4,
                });
            }
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                const lines = Number.isFinite(data?.lineCount) ? data.lineCount : 0;
                const intensity = Math.min(lines * 0.25, 1.0);
                this.pushReactiveEnvelope({
                    pulse: 0.22 + intensity * 0.3,
                    bloom: 0.05 + intensity * 0.16,
                    ring: 0.08 + intensity * 0.22,
                    particle: 0.08 + intensity * 0.18,
                    ambient: 0.12 + intensity * 0.2,
                });
            }
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        this.eventUnsubscribers.push(lockUnsub, comboUnsub, lineClearUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        this.cancelAnimationLoop();
        this.clock.start();

        const animate = () => {
            if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;

            const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : this.clock.getDelta();
            const delta = this.fixedDeltaSeconds !== null ? rawDelta : Math.min(rawDelta, 0.05);
            if (this.fixedDeltaSeconds !== null) {
                this.fixedElapsed += this.fixedDeltaSeconds;
                this.time = this.fixedElapsed;
            } else {
                this.time += delta;
            }

            // Play pace
            this.targetPaceMultiplier += (1.0 - this.targetPaceMultiplier) * 0.002;
            this.playPaceMultiplier += (this.targetPaceMultiplier - this.playPaceMultiplier) * 0.03;
            this.roadProgress += delta * 0.3 * this.playPaceMultiplier;

            // Unified reactive envelope with capped boosts and deterministic decay.
            this.updateReactiveEnvelope(delta);
            this.ambientSpeedBoost += (this.ambientSpeedTarget - this.ambientSpeedBoost) * 0.02;
            this.applyParticleDrawBudgets();

            // Update road curve
            this.updateRoadCurve();

            // Update shooting stars
            this.updateShootingStars(delta);
            this.updateUnderRoadGlow();

            // Update road shader uniforms
            if (this.isWebGPU && this.roadMaterialData) {
                this.roadMaterialData.uniforms.uTime.value = this.time;
                this.roadMaterialData.uniforms.uProgress.value = this.roadProgress;
                this.roadMaterialData.uniforms.uPulse.value = this.pulseIntensity;
                this.roadMaterialData.uniforms.uPace.value = this.playPaceMultiplier;
            } else if (this.roadMaterial) {
                this.roadMaterial.uniforms.uTime.value = this.time;
                this.roadMaterial.uniforms.uProgress.value = this.roadProgress;
                this.roadMaterial.uniforms.uPulse.value = this.pulseIntensity;
                this.roadMaterial.uniforms.uPace.value = this.playPaceMultiplier;
            }

            // Animate rings
            this.tunnelRings.forEach((ring) => {
                ring.position.z += ring.userData.speed * 0.35 * this.playPaceMultiplier;

                if (ring.position.z > 300) {
                    ring.position.z = -2500;
                    ring.userData.hue = (ring.userData.hue + 0.1) % 1.0;
                }

                const t = Math.max(0, (200 - ring.position.z) / 2700);
                const curveStrength = t * t;
                const curve1 = Math.sin(t * 2.5 + this.time * 0.12) * 200 * curveStrength;
                const curve2 = Math.sin(t * 1.2 + this.time * 0.08) * 120 * curveStrength;
                ring.position.x = curve1 + curve2;
                ring.position.y = 25 + Math.sin(t * 1.5 + this.time * 0.06) * 20 * curveStrength;

                const rotSpeed = ring.userData.rotationSpeed * this.playPaceMultiplier;
                ring.rotation.z += rotSpeed * 0.015;

                const scale = 0.5 + (1 - t) * 0.8 + this.ringGlow * 0.10;
                ring.scale.set(scale, scale, 1);

                // Update uniforms (both WebGPU TSL and WebGL ShaderMaterial)
                const md = ring.userData.materialData;
                const ringPulse = this.pulseIntensity + this.ringGlow * RING_GLOW_TUNING.pulseGlowScale;
                const ringGlowStrength = this.ringGlow * RING_GLOW_TUNING.uniformGlowScale;
                const ringLightness = RING_GLOW_TUNING.baseLightness
                    + this.ringGlow * RING_GLOW_TUNING.lightnessGlowScale;
                const color = new THREE.Color().setHSL(
                    ring.userData.hue,
                    RING_GLOW_TUNING.saturation,
                    ringLightness,
                );
                if (md) {
                    // WebGPU path
                    md.uniforms.uTime.value = this.time;
                    md.uniforms.uPulse.value = ringPulse;
                    md.uniforms.uGlow.value = ringGlowStrength;
                    md.uniforms.uColor.value = color;
                } else if (ring.material.uniforms) {
                    // WebGL path
                    ring.material.uniforms.uTime.value = this.time;
                    ring.material.uniforms.uPulse.value = ringPulse;
                    ring.material.uniforms.uGlow.value = ringGlowStrength;
                    ring.material.uniforms.uColor.value = color;
                }
            });

            // Animate edge glow lines
            if (this.edgeStrips) {
                this.edgeStrips.forEach((line) => {
                    line.userData.hue = (line.userData.hue + 0.0002) % 1.0;
                    const md = line.userData.materialData;
                    if (md) {
                        md.uniforms.uColor.value = new THREE.Color().setHSL(line.userData.hue, 0.9, 0.55);
                        md.uniforms.uOpacity.value = (0.5 - line.userData.offset * 0.12) + this.pulseIntensity * 0.25;
                    } else {
                        line.material.color.setHSL(line.userData.hue, 0.9, 0.55);
                        const baseOpacity = 0.5 - line.userData.offset * 0.12;
                        line.material.opacity = baseOpacity + this.pulseIntensity * 0.25;
                    }
                });
            }

            this.animateDepthHaze();

            // Animate primary planet (3 min journey)
            this.animatePrimaryPlanet(delta);

            // Animate additional planets
            this.animateAdditionalPlanets(delta);

            // Animate speed particles
            this.animateSpeedParticles(delta);

            // Animate ambient particles
            this.animateAmbientParticles(delta);

            // Subtle starfield drift + twinkle uniform (WebGPU) for desktop readability.
            if (this.starfield) {
                this.starfield.rotation.y += delta * 0.00035;
                this.starfield.rotation.x = Math.sin(this.time * 0.012) * 0.01;
                this.starfield.position.x = 0;
                this.starfield.position.y = 0;
                const starMd = this.starfield.userData?.materialData;
                if (starMd?.uniforms?.uTime) {
                    starMd.uniforms.uTime.value = this.time;
                }
            }

            // Camera sway
            this.camera.position.x = Math.sin(this.time * 0.25) * 4;
            this.camera.position.y = 55 + Math.sin(this.time * 0.2) * 3;

            // Update bloom
            const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
            const bloomStrength = this.getBloomStrength(effectScale);
            if (this.isWebGPU && this.postProcessing) {
                this.postProcessing.update({
                    bloomStrength,
                    chromaticStrength: 0.0012 * effectScale,
                    vignetteDarkness: 0.42 + (1 - effectScale) * 0.12,
                });
            } else if (this.bloomPass) {
                this.bloomPass.strength = bloomStrength;
            }

            this.renderFrame(delta);
            this.updateAdaptiveScaler(rawDelta * 1000);

            if (this.flags.baseline) {
                this.trackBaselineFrame(rawDelta);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    sampleCelestialJourney(profile) {
        if (!profile?.start || !profile?.close || !profile?.end) return null;

        const smoothstepFn = (t) => t * t * (3 - 2 * t);
        const duration = Math.max(1, profile.duration ?? this.journeyDuration);
        const phaseOffset = profile.phaseOffset ?? 0;
        const localTime = ((this.journeyTime + phaseOffset) % duration + duration) % duration;
        const approachEnd = THREE.MathUtils.clamp(profile.approachEnd ?? 120, 1, duration - 1);
        const flybyEnd = THREE.MathUtils.clamp(profile.flybyEnd ?? 160, approachEnd + 1, duration - 0.001);

        const targetPos = new THREE.Vector3();
        let glowBoost = 0;

        if (localTime < approachEnd) {
            const t = smoothstepFn(localTime / approachEnd);
            targetPos.lerpVectors(profile.start, profile.close, t);
            glowBoost = t * 0.5;
        } else if (localTime < flybyEnd) {
            const phaseTime = (localTime - approachEnd) / (flybyEnd - approachEnd);
            const t = smoothstepFn(phaseTime);
            targetPos.lerpVectors(profile.close, profile.end, t);
            glowBoost = 0.5 - t * 0.3;
        } else {
            const phaseTime = (localTime - flybyEnd) / (duration - flybyEnd);
            const t = smoothstepFn(phaseTime);
            targetPos.lerpVectors(profile.end, profile.start, t);
            glowBoost = 0.2 * (1 - t);
        }

        const arcPhase = (localTime / duration) * Math.PI * 2;
        targetPos.x += Math.sin(
            arcPhase * (profile.arcFrequencyX ?? 0.55) + (profile.arcPhaseX ?? 0),
        ) * (profile.arcAmplitudeX ?? 0);
        targetPos.y += Math.sin(
            arcPhase * (profile.arcFrequencyY ?? 1.0) + (profile.arcPhaseY ?? 1.1),
        ) * (profile.arcAmplitudeY ?? 0);

        if (profile.corridorHalfWidth !== undefined) {
            const centerX = profile.corridorCenterX ?? this.celestialCorridor.centerX;
            targetPos.x = THREE.MathUtils.clamp(
                targetPos.x,
                centerX - profile.corridorHalfWidth,
                centerX + profile.corridorHalfWidth,
            );
        }

        return { targetPos, glowBoost };
    }

    computeCelestialScale(position, scaleProfile = {}, glowBoost = 0) {
        const nearDistance = scaleProfile.nearDistance ?? 700;
        const farDistance = Math.max(nearDistance + 1, scaleProfile.farDistance ?? 5200);
        const minScale = scaleProfile.minScale ?? 0.62;
        const maxScale = scaleProfile.maxScale ?? 1.24;
        const distance = this.camera
            ? this.camera.position.distanceTo(position)
            : farDistance;
        const distanceMix = THREE.MathUtils.clamp(
            (farDistance - distance) / (farDistance - nearDistance),
            0,
            1,
        );
        const distanceScale = THREE.MathUtils.lerp(minScale, maxScale, distanceMix);
        const pulseScale = 1 + this.pulseIntensity * (scaleProfile.pulseScale ?? 0.05);
        const glowScale = 1 + glowBoost * (scaleProfile.glowScale ?? 0.2);
        const paceScale = 1 + THREE.MathUtils.clamp(
            (this.playPaceMultiplier - 1.0) * (scaleProfile.paceScale ?? 0.06),
            -0.05,
            0.1,
        );

        return distanceScale * pulseScale * glowScale * paceScale;
    }

    syncCelestialGlowLayers(glowLayers, sourceObject, { readabilityScale = 1, glowBoost = 0 } = {}) {
        if (!sourceObject || !Array.isArray(glowLayers) || glowLayers.length === 0) return;
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
        const sourceScale = sourceObject.scale?.x ?? 1;

        glowLayers.forEach((glow) => {
            glow.position.x = sourceObject.position.x;
            glow.position.y = sourceObject.position.y;
            glow.position.z = sourceObject.position.z + (glow.userData.zOffset ?? 0);
            glow.scale.setScalar(sourceScale);
            if (glow.material?.opacity !== undefined) {
                glow.material.opacity = glow.userData.baseOpacity
                    * readabilityScale
                    * effectScale
                    * (1 + this.pulseIntensity * 0.22 + glowBoost * 0.35);
            }
        });
    }

    animatePrimaryPlanet(delta) {
        if (!this.planet) return;

        this.planet.rotation.y += 0.0008;
        const paceInfluence = THREE.MathUtils.clamp((this.playPaceMultiplier - 1.0) * 0.06, -0.03, 0.05);
        this.journeyTime += delta * (1.0 + paceInfluence);
        if (this.journeyTime >= this.journeyDuration) {
            this.journeyTime = 0;
        }

        const smoothstepFn = (t) => t * t * (3 - 2 * t);

        const approachEnd = 120;
        const flybyEnd = 160;
        const targetPos = new THREE.Vector3();
        let glowBoost = 0;

        if (this.journeyTime < approachEnd) {
            const t = smoothstepFn(this.journeyTime / approachEnd);
            targetPos.lerpVectors(this.planetStartPos, this.planetClosePos, t);
            glowBoost = t * 0.5;
        } else if (this.journeyTime < flybyEnd) {
            const phaseTime = (this.journeyTime - approachEnd) / (flybyEnd - approachEnd);
            const t = smoothstepFn(phaseTime);
            targetPos.lerpVectors(this.planetClosePos, this.planetEndPos, t);
            glowBoost = 0.5 - t * 0.3;
        } else {
            const phaseTime = (this.journeyTime - flybyEnd) / (this.journeyDuration - flybyEnd);
            const t = smoothstepFn(phaseTime);
            targetPos.lerpVectors(this.planetEndPos, this.planetStartPos, t);
            glowBoost = 0.2 * (1 - t);
        }

        const arcPhase = (this.journeyTime / this.journeyDuration) * Math.PI * 2;
        targetPos.x += Math.sin(arcPhase * 0.55) * 76;
        targetPos.y += Math.sin(arcPhase + 1.1) * 34;
        targetPos.x = THREE.MathUtils.clamp(
            targetPos.x,
            this.celestialCorridor.centerX - this.celestialCorridor.halfWidth,
            this.celestialCorridor.centerX + this.celestialCorridor.halfWidth,
        );

        this.planet.position.copy(targetPos);

        // Update shader uniforms
        const md = this.planet.userData.materialData;
        if (md) {
            md.uniforms.uTime.value = this.time;
            md.uniforms.uPulse.value = this.pulseIntensity + glowBoost;
        } else if (this.planet.material.uniforms) {
            this.planet.material.uniforms.uTime.value = this.time;
            this.planet.material.uniforms.uPulse.value = this.pulseIntensity + glowBoost;
        }

        // Sync glow layers
        this.planetGlows.forEach((glow) => {
            glow.position.x = this.planet.position.x;
            glow.position.y = this.planet.position.y;
            glow.position.z = this.planet.position.z + glow.userData.zOffset;
            if (glow.material.opacity !== undefined) {
                const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
                glow.material.opacity = glow.userData.baseOpacity
                    * effectScale
                    * (1.0 + this.pulseIntensity * 0.3 + glowBoost);
            }
        });
    }

    animateAdditionalPlanets(delta) {
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
        const readabilityScale = THREE.MathUtils.clamp(
            1.0 - (this.bloomBoost * 0.32 + this.ringGlow * 0.14),
            0.42,
            1.0,
        );

        // Neon Gas Giant - hero-style approach path with distance scaling.
        if (this.neonGasGiant) {
            this.neonGasGiant.rotation.y += 0.0002;
            let glowBoost = 0;
            const pathSample = this.sampleCelestialJourney(this.neonGasGiant.userData.approachProfile);
            if (pathSample) {
                this.neonGasGiant.position.copy(pathSample.targetPos);
                glowBoost = pathSample.glowBoost * 0.72;
            } else if (this.neonGasGiant.userData.basePosition) {
                this.neonGasGiant.position.copy(this.neonGasGiant.userData.basePosition);
            }

            const phase = this.neonGasGiant.userData.driftPhase || 0;
            const speed = this.neonGasGiant.userData.driftSpeed || 0.03;
            const ampX = this.neonGasGiant.userData.driftAmplitudeX || 90;
            const ampY = this.neonGasGiant.userData.driftAmplitudeY || 22;
            this.neonGasGiant.position.x += Math.sin(this.time * speed + phase) * ampX * 0.28;
            this.neonGasGiant.position.y += Math.cos(this.time * speed * 0.7 + phase) * ampY * 0.34;
            this.neonGasGiant.position.z += Math.sin(this.time * speed * 0.5 + phase) * 24;

            const baseScale = this.neonGasGiant.userData.baseScale ?? 1;
            const dynamicScale = this.computeCelestialScale(
                this.neonGasGiant.position,
                this.neonGasGiant.userData.scaleProfile,
                glowBoost,
            );
            this.neonGasGiant.scale.setScalar(baseScale * dynamicScale);

            const md = this.neonGasGiant.userData.materialData;
            if (md) {
                md.uniforms.uTime.value = this.time;
                md.uniforms.uPulse.value = this.pulseIntensity * 0.24 * readabilityScale + glowBoost * 0.45;
            }
            this.syncCelestialGlowLayers(this.neonGasGiantGlows, this.neonGasGiant, {
                readabilityScale,
                glowBoost,
            });
        }

        // Crystal Moon - stays in orbit but inherits dynamic distance scaling and glow sync.
        if (this.crystalMoon && this.planet) {
            const orbitRadius = this.crystalMoon.userData.orbitRadius;
            const orbitSpeed = this.crystalMoon.userData.orbitSpeed;
            const depthScale = this.crystalMoon.userData.depthScale ?? 0.62;
            const verticalScale = this.crystalMoon.userData.verticalScale ?? 0.18;
            const paceInfluence = THREE.MathUtils.clamp((this.playPaceMultiplier - 1.0) * 0.08, -0.03, 0.06);
            const orbitAngle = this.time * orbitSpeed * (1.0 + paceInfluence);

            this.crystalMoon.position.x = this.planet.position.x + Math.cos(orbitAngle) * orbitRadius;
            this.crystalMoon.position.y = this.planet.position.y
                + Math.sin(orbitAngle * 0.46) * orbitRadius * verticalScale;
            this.crystalMoon.position.z = this.planet.position.z + Math.sin(orbitAngle) * orbitRadius * depthScale;

            this.crystalMoon.rotation.y += 0.0032;
            this.crystalMoon.rotation.x += 0.0017;

            const md = this.crystalMoon.userData.materialData;
            if (md) {
                md.uniforms.uTime.value = this.time;
                md.uniforms.uPulse.value = this.pulseIntensity * 0.35 * readabilityScale;
            }

            const moonGlowBoost = THREE.MathUtils.clamp(
                this.pulseIntensity * 0.24 + this.ringGlow * 0.08,
                0,
                0.45,
            );
            const baseScale = this.crystalMoon.userData.baseScale ?? 1;
            const dynamicScale = this.computeCelestialScale(
                this.crystalMoon.position,
                this.crystalMoon.userData.scaleProfile,
                moonGlowBoost,
            );
            this.crystalMoon.scale.setScalar(baseScale * dynamicScale);
            this.syncCelestialGlowLayers(this.crystalMoonGlows, this.crystalMoon, {
                readabilityScale,
                glowBoost: moonGlowBoost,
            });
        }

        // Binary stars - keep orbit but add subtle distance-aware scaling.
        if (this.binaryStars.length === 2) {
            this.binaryStars.forEach((star) => {
                const baseCenter = star.userData.baseCenter || new THREE.Vector3(-1274, 760, -4200);
                const orbitRadius = star.userData.orbitRadius || 46;
                const orbitSpeed = star.userData.orbitSpeed || 0.085;
                const angle = this.time * orbitSpeed + star.userData.orbitOffset;
                star.position.x = baseCenter.x + Math.cos(angle) * orbitRadius;
                star.position.z = baseCenter.z + Math.sin(angle) * orbitRadius;
                star.position.y = baseCenter.y + Math.sin(angle * 0.5) * 16;

                const md = star.userData.materialData;
                if (md) {
                    md.uniforms.uTime.value = this.time;
                }

                const starScale = this.computeCelestialScale(
                    star.position,
                    star.userData.scaleProfile,
                    0.05,
                );
                star.scale.setScalar((star.userData.baseScale ?? 1) * starScale);

                if (star.material?.opacity !== undefined) {
                    star.material.opacity = 0.7 * readabilityScale * effectScale;
                }
            });
        }

        // Venus Atmospheric Orb - hero-style approach path with distance scaling.
        if (this.venusOrb) {
            this.venusOrb.rotation.y += 0.00015;
            let glowBoost = 0;
            const pathSample = this.sampleCelestialJourney(this.venusOrb.userData.approachProfile);
            if (pathSample) {
                this.venusOrb.position.copy(pathSample.targetPos);
                glowBoost = pathSample.glowBoost * 0.58;
            } else if (this.venusOrb.userData.basePosition) {
                this.venusOrb.position.copy(this.venusOrb.userData.basePosition);
            }

            const phase = this.venusOrb.userData.driftPhase || 0;
            const speed = this.venusOrb.userData.driftSpeed || 0.02;
            const ampX = this.venusOrb.userData.driftAmplitudeX || 60;
            const ampY = this.venusOrb.userData.driftAmplitudeY || 30;
            this.venusOrb.position.x += Math.sin(this.time * speed + phase) * ampX * 0.34;
            this.venusOrb.position.y += Math.cos(this.time * speed * 0.7 + phase) * ampY * 0.34;

            const baseScale = this.venusOrb.userData.baseScale ?? 1;
            const dynamicScale = this.computeCelestialScale(
                this.venusOrb.position,
                this.venusOrb.userData.scaleProfile,
                glowBoost,
            );
            this.venusOrb.scale.setScalar(baseScale * dynamicScale);

            const md = this.venusOrb.userData.materialData;
            if (md) {
                md.uniforms.uTime.value = this.time;
                md.uniforms.uPulse.value = this.pulseIntensity * 0.18 * readabilityScale + glowBoost * 0.4;
            }
            this.syncCelestialGlowLayers(this.venusOrbGlows, this.venusOrb, {
                readabilityScale,
                glowBoost,
            });
        }

        // Animate the new custom celestial bodies using a helper
        const animateNewPlanet = (planet, glows, rotSpeed) => {
            if (!planet) return;
            planet.rotation.y += rotSpeed;

            const phase = planet.userData.driftPhase || 0;
            const speed = planet.userData.driftSpeed || 0.02;
            const ampX = planet.userData.driftAmplitudeX || 50;
            const ampY = planet.userData.driftAmplitudeY || 30;

            let glowBoost = 0;
            if (planet.userData.approachProfile) {
                const pathSample = this.sampleCelestialJourney(planet.userData.approachProfile);
                if (pathSample) {
                    planet.position.copy(pathSample.targetPos);
                    glowBoost = pathSample.glowBoost;
                }
            } else if (planet.userData.basePosition) {
                planet.position.copy(planet.userData.basePosition);
            }

            planet.position.x += Math.sin(this.time * speed + phase) * ampX * 0.6;
            planet.position.y += Math.cos(this.time * speed * 0.8 + phase) * ampY * 0.6;

            const baseScale = planet.userData.baseScale ?? 1.0;
            const dynamicScale = this.computeCelestialScale(
                planet.position,
                planet.userData.scaleProfile,
                0
            );
            planet.scale.setScalar(baseScale * dynamicScale);

            const md = planet.userData.materialData;
            if (md && md.uniforms && md.uniforms.uTime) {
                md.uniforms.uTime.value = this.time;
            }
            if (md && md.uniforms && md.uniforms.uPulse) {
                md.uniforms.uPulse.value = this.pulseIntensity * 0.15 * readabilityScale;
            }

            if (glows) {
                this.syncCelestialGlowLayers(glows, planet, { readabilityScale, glowBoost: 0 });
            }
        };

        animateNewPlanet(this.marsPlanet, this.marsGlows, 0.0004);
        animateNewPlanet(this.mercuryPlanet, this.mercuryGlows, 0.0003);
        animateNewPlanet(this.saturnPlanet, this.saturnGlows, 0.0002);
        animateNewPlanet(this.uranusPlanet, this.uranusGlows, 0.00018);
    }

    animateSpeedParticles(delta) {
        if (!this.speedParticles) return;

        if (this.speedParticleCompute?.computeNode) {
            // GPU compute updates positions
            this.speedParticleCompute.update(delta, this.time, this.pulseIntensity, this.playPaceMultiplier);
        } else {
            // CPU fallback
            const positions = this.speedParticles.geometry.attributes.position.array;
            const particleSpeed = (3 + this.pulseIntensity * 5) * this.playPaceMultiplier;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 2] += particleSpeed;
                if (positions[i + 2] > 300) {
                    const side = this.rand() > 0.5 ? 1 : -1;
                    positions[i] = side * (80 + this.rand() * 60);
                    positions[i + 1] = this.rand() * 60 + 5;
                    positions[i + 2] = -2200;
                }
            }
            this.speedParticles.geometry.attributes.position.needsUpdate = true;
        }

        // Update material uniforms
        if (this.isWebGPU && this.speedParticleMaterialData) {
            this.speedParticleMaterialData.uniforms.uPulse.value = this.pulseIntensity + this.particleGlow * 0.8;
        } else if (this.speedParticles.material.uniforms) {
            this.speedParticles.material.uniforms.uPulse.value = this.pulseIntensity + this.particleGlow * 0.8;
        }
    }

    animateAmbientParticles(delta) {
        if (!this.ambientParticles) return;

        if (this.ambientParticleCompute?.computeNode) {
            this.ambientParticleCompute.update(
                delta,
                this.time,
                this.pulseIntensity + this.particleGlow * 0.5,
                1.0 + this.ambientSpeedBoost,
            );
        }

        if (this.isWebGPU && this.ambientParticleMaterialData) {
            this.ambientParticleMaterialData.uniforms.uTime.value = this.time;
            this.ambientParticleMaterialData.uniforms.uPulse.value = this.pulseIntensity + this.particleGlow * 0.5;
            this.ambientParticleMaterialData.uniforms.uSpeedMultiplier.value = 1.0 + this.ambientSpeedBoost;
        } else if (this.ambientParticles.material.uniforms) {
            this.ambientParticles.material.uniforms.uTime.value = this.time;
            this.ambientParticles.material.uniforms.uPulse.value = this.pulseIntensity + this.particleGlow * 0.5;
            this.ambientParticles.material.uniforms.uSpeedMultiplier.value = 1.0 + this.ambientSpeedBoost;
        }
    }

    renderFrame(delta) {
        if (!this.renderer || !this.scene || !this.camera) return;
        const canMeasure = typeof performance !== 'undefined' && typeof performance.now === 'function';
        this.lastPostCostMs = 0;
        this.lastRenderPath = this.isWebGPU ? 'webgpu-direct' : 'webgl-direct';

        if (this.isWebGPU) {
            if (this.speedParticleCompute?.computeNode && this.renderer?.compute) {
                this.renderer.compute(this.speedParticleCompute.computeNode);
            }
            if (this.ambientParticleCompute?.computeNode && this.renderer?.compute) {
                this.renderer.compute(this.ambientParticleCompute.computeNode);
            }
            if (this.shootingStars?.length && this.renderer?.compute) {
                this.shootingStars.forEach((star) => {
                    if (star.userData.compute?.computeNode) {
                        this.renderer.compute(star.userData.compute.computeNode);
                    }
                });
            }

            this.renderer.clear();
            if (this.capabilities.post && this.postProcessing) {
                try {
                    const postStart = canMeasure ? performance.now() : 0;
                    this.postProcessing.render();
                    this.lastPostCostMs = canMeasure ? Math.max(0, performance.now() - postStart) : 0;
                    this.lastRenderPath = 'webgpu-post';
                    return;
                } catch (error) {
                    console.warn('[ChromadelicHighway] WebGPU post render failed, using direct render:', error);
                    this.capabilities.post = false;
                    this.disposePostProcessingStack();
                    this.configureRendererColorPipeline();
                }
            }

            this.renderer.render(this.scene, this.camera);
            this.lastRenderPath = 'webgpu-direct';
            return;
        }

        if (this.isWebGL && this.composer) {
            try {
                const postStart = canMeasure ? performance.now() : 0;
                this.composer.render(delta);
                this.lastPostCostMs = canMeasure ? Math.max(0, performance.now() - postStart) : 0;
                this.lastRenderPath = 'webgl-post';
                return;
            } catch (error) {
                console.warn('[ChromadelicHighway] WebGL post render failed, using direct render:', error);
                this.capabilities.post = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
            }
        }

        this.renderer.render(this.scene, this.camera);
        this.lastRenderPath = 'webgl-direct';
    }

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        if (this.renderer) {
            this.renderer.setPixelRatio(this.getRendererPixelRatio(1.5));
            this.renderer.setSize(width, height);
        }
        if (this.isWebGPU && this.postProcessing) {
            this.postProcessing.bloomDownsample = THREE.MathUtils.clamp(
                0.62 + (this.adaptiveScalerState?.effectScale ?? 1) * 0.22,
                0.58,
                0.84,
            );
            this.postProcessing.setSize(width, height);
        }
        if (!this.isWebGPU && this.composer) {
            this.composer.setSize(width, height);
            if (this.bloomPass?.resolution) {
                this.bloomPass.resolution.set(width, height);
            }
        }
    }

    stop() {
        this.cancelAnimationLoop();
        this.clock.stop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
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
