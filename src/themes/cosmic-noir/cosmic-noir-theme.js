/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌑 COSMIC NOIR 🌑
 *  A Stunning 3D Cosmic Noir Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Deep 3D Starfield with twinkling grayscale stars
 * - 3D Black Planet sphere with subtle surface texture and silver rim glow
 * - Multiple glow layers around the planet for ethereal noir atmosphere
 * - Drifting nebula clouds at varying depths (grayscale)
 * - Floating noir particles throughout 3D space
 * - Gameplay effects: cosmic waves, void pulses, stellar dust
 * - Post-processing: Bloom + Vignette for cinematic noir depth
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mrt, vec3 } from 'three/tsl';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { COSMIC_NOIR_TETROMINOS } from './cosmic-noir-tetrominos.js';
import { CosmicNoirPost } from './cosmic-noir-post.js';
import { CosmicNoirSparkCompute } from './cosmic-noir-compute.js';
import {
    createAmbientDustNodeMaterial,
    createAtmosphereNodeMaterial,
    createCosmicWaveNodeMaterial,
    createNebulaNodeMaterial,
    createPlanetNodeMaterial,
    createPlanetGlowNodeMaterial,
    createPlanetGlowSpriteNodeMaterial,
    createStarfieldNodeMaterial,
    createVoidSparkNodeMaterial,
    createGasSwirlNodeMaterial,
    createAccretionDiskNodeMaterial,
    createAnamorphicFlareNodeMaterial,
    createUnifiedVoidSparkNodeMaterial,
} from './cosmic-noir-materials.js';
import {
    planetVertexShader,
    planetFragmentShader,
    waveVertexShader,
    waveFragmentShader,
    starVertexShader,
    starFragmentShader,
    atmosphereVertexShader,
    atmosphereFragmentShader,
    voidSparkVertexShader,
    voidSparkFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    ChromaticAberrationShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    gasSwirlVertexShader,
    gasSwirlFragmentShader,
    accretionDiskVertexShader,
    accretionDiskFragmentShader,
} from './cosmic-noir-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Debug Flags
// ─────────────────────────────────────────────────────────────────────────────
function parseCosmicNoirFlags() {
    const defaults = {
        forceWebGL: false,
        noCompute: false,
        noMRT: false,
        noPost: false,
        noAdaptiveScale: false,
        mrtAudit: false,
        baseline: false,
        seed: null,
        fixedDeltaMs: null,
        fixedPixelRatio: null,
        atmoShells: null,
        renderScale: null,
        usePost: false,
        useMRT: false,
        useCompute: false,
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

    const seed = readNumber('cosmicNoirSeed', 'seed');
    const fixedDeltaMs = readNumber(
        'cosmicNoirFixedDeltaMs',
        'cosmicNoirFixedDt',
        'fixedDeltaMs',
        'fixedDt',
    );
    const fixedPixelRatio = readNumber('cosmicNoirFixedPixelRatio', 'fixedPixelRatio');
    // A/B override for the atmosphere shell count (perf vs. depth). Falls back to the preset.
    const atmoShells = readNumber('cosmicNoirAtmoShells');
    // A/B override for the scene-buffer render scale (perf vs. sharpness). Falls back to the preset.
    const renderScale = readNumber('cosmicNoirRenderScale');

    return {
        ...defaults,
        forceWebGL: readBool('forceWebGL'),
        noCompute: readBool('cosmicNoirNoCompute', 'noCompute'),
        noMRT: readBool('cosmicNoirNoMRT', 'noMRT'),
        noPost: readBool('cosmicNoirNoPost', 'noPost'),
        noAdaptiveScale: readBool('cosmicNoirNoAdaptiveScale'),
        mrtAudit: readBool('cosmicNoirMrtAudit'),
        baseline: readBool('cosmicNoirBaseline', 'baseline'),
        seed: Number.isFinite(seed) ? seed : null,
        fixedDeltaMs: Number.isFinite(fixedDeltaMs) && fixedDeltaMs > 0 ? fixedDeltaMs : null,
        fixedPixelRatio: Number.isFinite(fixedPixelRatio) && fixedPixelRatio > 0
            ? fixedPixelRatio
            : null,
        atmoShells: Number.isFinite(atmoShells) && atmoShells > 0
            ? Math.round(atmoShells)
            : null,
        renderScale: Number.isFinite(renderScale) && renderScale > 0
            ? Math.min(2.0, Math.max(0.5, renderScale))
            : null,
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

function createCosmicNoirNoiseTexture(randomFn = Math.random, size = 64) {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.floor(randomFn() * 255);
        data[i + 1] = Math.floor(randomFn() * 255);
        data[i + 2] = Math.floor(randomFn() * 255);
        data[i + 3] = 255;
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 80000,
        nebulaCount: 25,
        ambientParticles: 400,
        voidSparks: 24000,
        computeSparkCount: 50000,
        bloomStrength: 0.5,
        bloomRadius: 0.45,
        // Bloom is a heavily-blurred glow, so a lower internal buffer is near-invisible but cuts
        // bloom pixel work ~(0.9/0.65)^2 ≈ 1.9x. 0.65 = Winter/chromadelic parity. The adaptive
        // shedder (Math.min(base, floor) below) only steps this further DOWN under load.
        bloomDownsample: 0.65,
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 64,
        glowLayers: 8,
        atmosphereLayers: 2,
        dustParticles: 500,
        // Shader FBM octave counts — baked at material creation time
        atmosphereFbmOctaves: 5, // gasA=5, gasB=4, tendril=4
        diskFbmOctaves: 5,
        planetFbmOctaves: 4,
        // Geometry tessellation
        atmosphereDetail: 48,
        diskSegments: 96,
    },
    Ultra: {
        starCount: 50000,
        nebulaCount: 20,
        ambientParticles: 300,
        voidSparks: 18000,
        computeSparkCount: 36000,
        bloomStrength: 0.45,
        bloomRadius: 0.4,
        bloomDownsample: 0.65, // Winter/chromadelic parity (was 0.85); near-invisible blurred glow
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 56,
        glowLayers: 7,
        atmosphereLayers: 2,
        dustParticles: 380,
        atmosphereFbmOctaves: 5,
        diskFbmOctaves: 4,
        planetFbmOctaves: 4,
        atmosphereDetail: 48,
        diskSegments: 72,
    },
    High: {
        starCount: 30000,
        nebulaCount: 15,
        ambientParticles: 200,
        voidSparks: 15000,
        computeSparkCount: 26000,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        bloomDownsample: 0.65, // Winter/chromadelic parity (was 0.8); near-invisible blurred glow
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 48,
        glowLayers: 6,
        // 1 shell by default on High (perf); ?cosmicNoirAtmoShells=2 restores the double shell.
        atmosphereLayers: 1,
        dustParticles: 280,
        atmosphereFbmOctaves: 4, // gasA=4, gasB=3, tendril=3
        diskFbmOctaves: 3,
        planetFbmOctaves: 4,
        atmosphereDetail: 40,
        diskSegments: 48,
        // Scene buffer rendered at 0.92x then upscaled (perf); ?cosmicNoirRenderScale=1 = native.
        postRenderScale: 0.92,
    },
    Medium: {
        starCount: 15000,
        nebulaCount: 10,
        ambientParticles: 120,
        voidSparks: 10000,
        computeSparkCount: 16000,
        bloomStrength: 0.35,
        bloomRadius: 0.3,
        bloomDownsample: 0.7,
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 36,
        glowLayers: 5,
        atmosphereLayers: 2,
        dustParticles: 0,
        atmosphereFbmOctaves: 3, // gasA=3, gasB=2, tendril=2
        diskFbmOctaves: 3,
        planetFbmOctaves: 3,
        atmosphereDetail: 36,
        diskSegments: 40,
    },
    Low: {
        starCount: 8000,
        nebulaCount: 6,
        ambientParticles: 60,
        voidSparks: 6000,
        computeSparkCount: 0,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        bloomDownsample: 0.6,
        enablePostProcessing: false,
        enableCompute: false,
        planetDetail: 24,
        glowLayers: 4,
        atmosphereLayers: 1,
        dustParticles: 0,
        atmosphereFbmOctaves: 3, // gasA=3, gasB=2, tendril=2
        diskFbmOctaves: 2,
        planetFbmOctaves: 3,
        atmosphereDetail: 32,
        diskSegments: 32,
    },
    Minimal: {
        starCount: 4000,
        nebulaCount: 4,
        ambientParticles: 30,
        voidSparks: 3500,
        computeSparkCount: 0,
        bloomStrength: 0.2,
        bloomRadius: 0.2,
        bloomDownsample: 0.5,
        enablePostProcessing: false,
        enableCompute: false,
        planetDetail: 16,
        glowLayers: 3,
        atmosphereLayers: 1,
        dustParticles: 0,
        atmosphereFbmOctaves: 2, // gasA=2, gasB=2, tendril=2
        diskFbmOctaves: 2,
        planetFbmOctaves: 3,
        atmosphereDetail: 24,
        diskSegments: 24,
    },
};

const ADAPTIVE_PIXEL_RATIO_CAPS = {
    Extreme: 1.5,
    Ultra: 1.5,
    High: 1.35,
    Medium: 1.2,
    Low: 1.2,
    Minimal: 1.2,
};

// Reactive envelope channels + decay rates. Hoisted to module scope so the per-frame
// updateReactiveEnvelope() does not allocate a fresh object + Object.keys() array every frame.
const REACTIVE_ENVELOPE_KEYS = ['pulse', 'bloom', 'spark', 'atmosphere', 'star', 'shake'];
const REACTIVE_ENVELOPE_DECAY_RATES = {
    pulse: 3.0,
    bloom: 2.6,
    spark: 3.4,
    atmosphere: 2.2,
    star: 4.2,
    shake: 8.0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.8 },
        offset: { value: 1.2 },
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
            float vig = smoothstep(offset, offset - 0.7, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class CosmicNoirTheme extends BaseTheme {
    constructor() {
        super('cosmic-noir');

        this.flags = parseCosmicNoirFlags();
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.fixedElapsed = 0;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            isWebGPU: false,
            maxColorAttachments: 0,
            supportsCompute: false,
            supportsPost: false,
        };
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;
        this.animationFrameId = null;
        this.resizeHandler = null;
        this.deferredTimeouts = new Set();

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.bloomPass = null;
        this.chromaticPass = null;

        // Scene elements
        this.planet = null;
        this.planetUniforms = null;
        this.planetGroup = null;
        this.starfield = null;
        this.starfieldLayers = [];
        this.starfieldUniforms = [];
        this.starTwinkleComputes = [];
        this.starTwinkleCompute = null;
        this.ambientDust = null;
        this.ambientDustUniforms = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.comboFlash = null;
        this.comboFlashUniforms = null;
        this.comboLensFlare = null;
        this.comboLensFlareUniforms = null;
        this.atmosphere = null;
        this.atmosphereUniforms = null;
        this.atmosphereInner = null;
        this.atmosphereInnerUniforms = null;
        this.atmosphereFlowCompute = null;
        this.cosmicWaves = [];
        this.cosmicWavePool = [];
        this.voidSparks = []; // Fallback pool, or single compute-backed points system
        this.voidSparkIndex = 0; // Cycle index for pooled fallback
        this.sparkCompute = null;
        this.computeSparkPoints = null; // Cached compute-backed Points for idle-gating
        this.unifiedSparkData = null;
        this.sharedNoiseTexture = null;

        // Effect states
        this.planetPulseIntensity = 0;
        this.starEventBoost = 0; // Flash stars on events
        this.planetGlowIntensity = 1.0;
        this.comboMultiplier = 1.0;
        this.gasExplosionTimer = -10.0; // Timer for atmosphere gas explosion
        this.gasExplosionIntensity = 0.0; // Intensity based on combo
        this.comboFlashIntensity = 0.0;
        this.comboLensFlareIntensity = 0.0;
        this.reactiveEnvelope = {
            pulse: 0,
            bloom: 0,
            spark: 0,
            atmosphere: 0,
            star: 0,
            shake: 0,
        };

        // Planet drift animation (Lissajous curves for organic movement)
        this.planetPhaseX = 0;
        this.planetPhaseY = 0;
        this.planetPhaseX2 = 0;
        this.planetPhaseY2 = 0;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.tempCameraForward = new THREE.Vector3();
        this.tempScreenVector = new THREE.Vector3();
        this.tempBhScreenPos = new THREE.Vector2(0.5, 0.5);

        // Reusable scratch objects for the per-frame hot path (avoid GC churn).
        this._adaptivePostParams = {
            resolutionScale: 1.0,
            bloomDownsample: 0.8,
            chromaticEnabled: true,
            lensingStrength: 1.0,
        };
        this._postUpdatePayload = {
            bhScreenPos: null,
            bloomStrength: 0,
            bloomRadius: 0,
            bloomThreshold: 0,
            chromaticStrength: 0,
            chromaticEnabled: true,
            lensingStrength: 1.0,
            resolutionScale: 1.0,
            bloomDownsample: 0.8,
            vignetteDarkness: 0.8,
        };

        // State
        this.eventUnsubscribers = [];

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        this.qualityPreset = QUALITY_PRESETS.High;
        this.activeQualityLevel = 'High';
        this.qualityRebuildInProgress = false;
        this.pendingQualityRebuild = null;
        this.pendingComboCount = 0;

        // Pre-allocated colors reused during combo/spawn hot paths to avoid GC churn.
        this._comboShockwaveColor = new THREE.Color(0xb8b8c8);
        this._wavePoolScratchColor = new THREE.Color(0x888888);
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 3600;
        this.compileStats = {
            status: 'idle',
            durationMs: 0,
            message: null,
        };
        this.lastMrtDowngrade = null;
        this.loggedMrtPlatformGuard = false;
        this.adaptiveBudgetState = null;
        this.baseRenderScale = 1.0;
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedPostResolutionScale = 1;
        this.lastAppliedAdaptiveLodKey = -1;

        console.log('[CosmicNoir] Hybrid WebGPU/WebGL theme constructed');
    }

    getTetrominoConfig() {
        return COSMIC_NOIR_TETROMINOS;
    }

    getCurrentQualityLevel() {
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

    applyQualityPreset(quality) {
        const normalized = normalizeQuality(quality);
        this.activeQualityLevel = normalized;
        this.qualityPreset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
    }

    getAdaptiveTargetFrameMs() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        const targetFps = Number(settings?.targetFrameRate);
        const resolvedFps = Number.isFinite(targetFps) && targetFps > 0
            ? targetFps
            : 90;
        return THREE.MathUtils.clamp(1000 / resolvedFps, 8.33, 16.67);
    }

    getBasePixelRatioCap() {
        const quality = this.getCurrentQualityLevel();
        return ADAPTIVE_PIXEL_RATIO_CAPS[quality] ?? 1.35;
    }

    initializeAdaptiveBudgetState() {
        const baseCap = this.getBasePixelRatioCap();
        // Baseline scene-buffer render scale (flag override → preset → native). Multiplied into the
        // adaptive resolution scale in getAdaptivePostParams(), so adaptive load-shedding stacks on
        // top of it. ?cosmicNoirRenderScale=1 forces native for A/B.
        this.baseRenderScale = THREE.MathUtils.clamp(
            this.flags.renderScale ?? this.qualityPreset.postRenderScale ?? 1.0,
            0.5,
            2.0,
        );
        this.adaptiveBudgetState = {
            basePixelRatioCap: baseCap,
            targetFrameMs: this.getAdaptiveTargetFrameMs(),
            pixelRatioScale: 1.0,
            minPixelRatioScale: 0.78,
            frameTimeEmaMs: 0,
            overBudgetMs: 0,
            underBudgetMs: 0,
            postResolutionScale: 1.0,
            bloomDownsample: this.qualityPreset.bloomDownsample ?? 0.8,
            chromaticEnabled: true,
            lensingStrength: 1.0,
            transientScale: 1.0,
            sparkScale: 1.0,
            gasSwirlScale: 1.0,
            waveScale: 1.0,
            farStarScale: 1.0,
        };
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedPostResolutionScale = 1;
        this.lastAppliedAdaptiveLodKey = -1;
    }

    getRendererPixelRatio() {
        const budget = this.adaptiveBudgetState;
        const baseCap = budget?.basePixelRatioCap ?? this.getBasePixelRatioCap();
        const baseRatio = this.flags.fixedPixelRatio ?? this.getEffectivePixelRatio(baseCap);
        if (!budget || this.flags.noAdaptiveScale || Number.isFinite(this.flags.fixedPixelRatio)) {
            return Number(baseRatio.toFixed(2));
        }

        const pixelRatio = THREE.MathUtils.clamp(
            baseRatio * (budget.pixelRatioScale ?? 1.0),
            0.35,
            baseCap,
        );
        return Number(pixelRatio.toFixed(2));
    }

    getAdaptivePostParams() {
        const budget = this.adaptiveBudgetState;
        // Reuse a single scratch object — callers read it synchronously and never retain it.
        const params = this._adaptivePostParams;
        // Baseline render scale × adaptive load-shed scale = effective scene-buffer resolution.
        params.resolutionScale = (budget?.postResolutionScale ?? 1.0) * (this.baseRenderScale ?? 1.0);
        params.bloomDownsample = budget?.bloomDownsample ?? this.qualityPreset.bloomDownsample ?? 0.8;
        params.chromaticEnabled = budget?.chromaticEnabled ?? true;
        params.lensingStrength = budget?.lensingStrength ?? 1.0;
        return params;
    }

    applyAdaptiveBudgetState(force = false) {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRendererPixelRatio();
        const postResolutionScale = this.adaptiveBudgetState?.postResolutionScale ?? 1.0;

        const sizeChanged = force
            || width !== this.lastRendererWidth
            || height !== this.lastRendererHeight;
        const pixelRatioChanged = force
            || Math.abs(pixelRatio - this.lastRendererPixelRatio) >= 0.02;
        const postResolutionChanged = force
            || Math.abs(postResolutionScale - this.lastAppliedPostResolutionScale) >= 0.01;

        if (pixelRatioChanged) {
            this.renderer.setPixelRatio(pixelRatio);
            this.lastRendererPixelRatio = pixelRatio;
        }

        if (sizeChanged || pixelRatioChanged) {
            this.renderer.setSize(width, height, false);
            this.lastRendererWidth = width;
            this.lastRendererHeight = height;
        }

        if (this.postProcessing?.setSize && (sizeChanged || pixelRatioChanged || postResolutionChanged)) {
            this.postProcessing.setSize(width, height);
        }

        if (this.composer && (sizeChanged || pixelRatioChanged)) {
            this.composer.setSize(width, height);
        }

        if (postResolutionChanged) {
            this.lastAppliedPostResolutionScale = postResolutionScale;
        }

        if (Array.isArray(this.starfieldUniforms)) {
            this.starfieldUniforms.forEach((uniforms) => {
                if (uniforms?.uPixelRatio) {
                    uniforms.uPixelRatio.value = pixelRatio;
                }
            });
        }

        if (this.ambientDustUniforms?.uPixelRatio) {
            this.ambientDustUniforms.uPixelRatio.value = pixelRatio;
        }

        this.applyAdaptiveLodState(force);
    }

    updateAdaptiveBudgetState(frameMs) {
        const budget = this.adaptiveBudgetState;
        if (
            !budget
            || this.flags.noAdaptiveScale
            || !Number.isFinite(frameMs)
            || frameMs <= 0
        ) {
            return;
        }

        budget.frameTimeEmaMs = budget.frameTimeEmaMs <= 0
            ? frameMs
            : (budget.frameTimeEmaMs * 0.88) + (frameMs * 0.12);

        budget.targetFrameMs = this.getAdaptiveTargetFrameMs();
        const ema = budget.frameTimeEmaMs;
        const targetMs = budget.targetFrameMs;
        const pressure = targetMs > 0 ? ema / targetMs : 1.0;
        const baseBloomDownsample = this.qualityPreset.bloomDownsample ?? 0.8;

        budget.postResolutionScale = 1.0;
        budget.bloomDownsample = baseBloomDownsample;
        budget.chromaticEnabled = true;
        budget.lensingStrength = 1.0;
        budget.transientScale = 1.0;
        budget.sparkScale = 1.0;
        budget.gasSwirlScale = 1.0;
        budget.waveScale = 1.0;
        budget.farStarScale = 1.0;

        if (pressure > 1.05) {
            budget.postResolutionScale = 0.94;
            budget.bloomDownsample = Math.min(baseBloomDownsample, 0.75);
            budget.lensingStrength = 0.88;
        }
        if (pressure > 1.16) {
            budget.postResolutionScale = 0.9;
            budget.bloomDownsample = Math.min(baseBloomDownsample, 0.7);
            budget.lensingStrength = 0.76;
            budget.transientScale = 0.92;
            budget.sparkScale = 0.9;
            budget.gasSwirlScale = 0.9;
            budget.farStarScale = 0.96;
        }
        if (pressure > 1.32) {
            budget.postResolutionScale = 0.85;
            budget.bloomDownsample = Math.min(baseBloomDownsample, 0.65);
            budget.chromaticEnabled = false;
            budget.lensingStrength = 0.62;
            budget.transientScale = 0.82;
            budget.sparkScale = 0.78;
            budget.gasSwirlScale = 0.76;
            budget.waveScale = 0.86;
            budget.farStarScale = 0.9;
        }
        if (pressure > 1.48) {
            budget.postResolutionScale = 0.8;
            budget.bloomDownsample = Math.min(baseBloomDownsample, 0.6);
            budget.chromaticEnabled = false;
            budget.lensingStrength = 0.5;
            budget.transientScale = 0.72;
            budget.sparkScale = 0.66;
            budget.gasSwirlScale = 0.64;
            budget.waveScale = 0.72;
            budget.farStarScale = 0.84;
        }
        if (pressure > 1.7) {
            budget.postResolutionScale = 0.72;
            budget.bloomDownsample = Math.min(baseBloomDownsample, 0.55);
            budget.transientScale = 0.62;
            budget.sparkScale = 0.56;
            budget.gasSwirlScale = 0.54;
            budget.waveScale = 0.62;
            budget.farStarScale = 0.78;
        }

        if (!Number.isFinite(this.flags.fixedPixelRatio)) {
            if (pressure > 1.5) {
                budget.overBudgetMs += frameMs;
                budget.underBudgetMs = 0;
            } else if (pressure < 0.82) {
                budget.underBudgetMs += frameMs;
                budget.overBudgetMs = 0;
            } else {
                budget.overBudgetMs = 0;
                budget.underBudgetMs = 0;
            }

            if (budget.overBudgetMs >= 650) {
                budget.pixelRatioScale = Math.max(
                    budget.minPixelRatioScale,
                    Number((budget.pixelRatioScale - 0.05).toFixed(2)),
                );
                budget.overBudgetMs = 0;
            } else if (budget.underBudgetMs >= 1500) {
                budget.pixelRatioScale = Math.min(
                    1.0,
                    Number((budget.pixelRatioScale + 0.05).toFixed(2)),
                );
                budget.underBudgetMs = 0;
            }
        }
    }

    getAdaptiveScale(key, fallback = 1.0) {
        const value = this.adaptiveBudgetState?.[key];
        return Number.isFinite(value) ? value : fallback;
    }

    scaleTransientCount(count, scaleKey, minCount = 0) {
        if (!Number.isFinite(count) || count <= 0) return 0;
        const scale = this.getAdaptiveScale(scaleKey, 1.0);
        return Math.max(minCount, Math.floor(count * scale));
    }

    markAttributeRange(attribute, startIndex, itemCount) {
        if (!attribute || !Number.isFinite(startIndex) || !Number.isFinite(itemCount) || itemCount <= 0) {
            return;
        }
        const itemSize = attribute.itemSize || 1;
        attribute.addUpdateRange(startIndex * itemSize, itemCount * itemSize);
        attribute.needsUpdate = true;
    }

    markGeometryAttributeRange(geometry, startIndex, itemCount, attributeNames) {
        if (!geometry || !Array.isArray(attributeNames) || itemCount <= 0) return;
        attributeNames.forEach((name) => {
            this.markAttributeRange(geometry.attributes?.[name], startIndex, itemCount);
        });
    }

    applyAdaptiveLodState(force = false) {
        const budget = this.adaptiveBudgetState;
        if (!budget) return;

        // Numeric signature (each scale rounded to 0.01, same granularity as the old toFixed(2)
        // key) packed into one integer — avoids the per-frame array + 5 strings + join allocation.
        const q = (value) => Math.round((value || 1) * 100);
        const lodSig = ((((q(budget.transientScale) * 256
            + q(budget.sparkScale)) * 256
            + q(budget.gasSwirlScale)) * 256
            + q(budget.waveScale)) * 256
            + q(budget.farStarScale));
        if (!force && lodSig === this.lastAppliedAdaptiveLodKey) return;
        this.lastAppliedAdaptiveLodKey = lodSig;

        if (Array.isArray(this.starfieldLayers)) {
            this.starfieldLayers.forEach((layer) => {
                const baseCount = layer?.userData?.baseCount
                    ?? layer?.geometry?.attributes?.position?.count
                    ?? 0;
                if (!baseCount || !layer?.geometry?.setDrawRange) return;

                const layerId = layer.userData?.layerId;
                let factor = 1.0;
                if (layerId === 'far') {
                    factor = budget.farStarScale ?? 1.0;
                } else if (layerId === 'mid') {
                    factor = Math.max(0.94, ((budget.farStarScale ?? 1.0) + 1.0) * 0.5);
                }

                const targetCount = Math.max(256, Math.floor(baseCount * factor));
                if ((layer.geometry.drawRange?.count ?? baseCount) !== targetCount) {
                    layer.geometry.setDrawRange(0, targetCount);
                }
            });
        }

        if (this.ambientDust?.geometry?.setDrawRange) {
            const baseCount = this.ambientDust.userData?.baseCount
                ?? this.ambientDust.geometry.attributes?.position?.count
                ?? 0;
            if (baseCount > 0) {
                const targetCount = Math.max(20, Math.floor(baseCount * (budget.transientScale ?? 1.0)));
                this.ambientDust.geometry.setDrawRange(0, targetCount);
            }
        }
    }

    ensureSharedNoiseTexture() {
        if (!this.sharedNoiseTexture) {
            this.sharedNoiseTexture = createCosmicNoirNoiseTexture(() => this.rand());
        }
        return this.sharedNoiseTexture;
    }

    rand() {
        return this.random ? this.random() : Math.random();
    }

    refreshFlagsForScene() {
        const previous = this.flags || {};
        const parsed = parseCosmicNoirFlags();
        parsed.forceWebGL = parsed.forceWebGL || previous.forceWebGL === true;
        parsed.noCompute = parsed.noCompute || previous.noCompute === true;
        parsed.noMRT = parsed.noMRT || previous.noMRT === true;
        parsed.noPost = parsed.noPost || previous.noPost === true;
        parsed.noAdaptiveScale = parsed.noAdaptiveScale || previous.noAdaptiveScale === true;
        parsed.mrtAudit = parsed.mrtAudit || previous.mrtAudit === true;
        parsed.baseline = parsed.baseline || previous.baseline === true;
        if (!Number.isFinite(parsed.seed) && Number.isFinite(previous.seed)) {
            parsed.seed = previous.seed;
        }
        if (!Number.isFinite(parsed.fixedDeltaMs) && Number.isFinite(previous.fixedDeltaMs)) {
            parsed.fixedDeltaMs = previous.fixedDeltaMs;
        }
        if (!Number.isFinite(parsed.fixedPixelRatio) && Number.isFinite(previous.fixedPixelRatio)) {
            parsed.fixedPixelRatio = previous.fixedPixelRatio;
        }
        if (!Number.isFinite(parsed.atmoShells) && Number.isFinite(previous.atmoShells)) {
            parsed.atmoShells = previous.atmoShells;
        }
        if (!Number.isFinite(parsed.renderScale) && Number.isFinite(previous.renderScale)) {
            parsed.renderScale = previous.renderScale;
        }
        this.flags = parsed;
    }

    initializeDeterministicState() {
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.fixedElapsed = 0;
        this.time = 0;
        this.planetPhaseX = this.rand() * Math.PI * 2;
        this.planetPhaseY = this.rand() * Math.PI * 2;
        this.planetPhaseX2 = this.rand() * Math.PI * 2;
        this.planetPhaseY2 = this.rand() * Math.PI * 2;
    }

    getWebGPUBlockers() {
        return [];
    }

    hasWebGLOnlyDependencies() {
        return this.getWebGPUBlockers().length > 0;
    }

    resetBaselineCapture() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.compileStats = {
            status: 'idle',
            durationMs: 0,
            message: null,
        };
        this.lastMrtDowngrade = null;
    }

    recordBaselineSample(frameMs) {
        if (!this.flags.baseline || !Number.isFinite(frameMs) || frameMs <= 0) return;

        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }

        this.baselineRenderStats.push({
            calls: this.renderer?.info?.render?.calls ?? 0,
            triangles: this.renderer?.info?.render?.triangles ?? 0,
            points: this.renderer?.info?.render?.points ?? 0,
            textures: this.renderer?.info?.memory?.textures ?? 0,
            geometries: this.renderer?.info?.memory?.geometries ?? 0,
        });
        if (this.baselineRenderStats.length > this.baselineMaxFrames) {
            this.baselineRenderStats.shift();
        }
    }

    getBaselineReport() {
        if (!this.baselineFrames.length) return null;

        const sortedFrames = [...this.baselineFrames].sort((a, b) => a - b);
        const frameCount = sortedFrames.length;
        const getPercentile = (ratio) => {
            const index = Math.min(frameCount - 1, Math.floor(frameCount * ratio));
            return sortedFrames[index];
        };
        const avgMs = this.baselineFrames.reduce((sum, value) => sum + value, 0) / frameCount;
        const p50Ms = getPercentile(0.5);
        const p95Ms = getPercentile(0.95);
        const p99Ms = getPercentile(0.99);
        const lowSampleCount = Math.max(1, Math.ceil(frameCount * 0.01));
        const slowestFrames = sortedFrames.slice(Math.max(0, frameCount - lowSampleCount));
        const low1AvgMs = slowestFrames.reduce((sum, value) => sum + value, 0) / slowestFrames.length;
        const low1Fps = low1AvgMs > 0 ? 1000 / low1AvgMs : 0;

        const totals = this.baselineRenderStats.reduce((acc, sample) => ({
            calls: acc.calls + sample.calls,
            triangles: acc.triangles + sample.triangles,
            points: acc.points + sample.points,
            textures: acc.textures + sample.textures,
            geometries: acc.geometries + sample.geometries,
        }), {
            calls: 0,
            triangles: 0,
            points: 0,
            textures: 0,
            geometries: 0,
        });

        const peaks = this.baselineRenderStats.reduce((acc, sample) => ({
            calls: Math.max(acc.calls, sample.calls),
            triangles: Math.max(acc.triangles, sample.triangles),
            points: Math.max(acc.points, sample.points),
            textures: Math.max(acc.textures, sample.textures),
            geometries: Math.max(acc.geometries, sample.geometries),
        }), {
            calls: 0,
            triangles: 0,
            points: 0,
            textures: 0,
            geometries: 0,
        });

        const renderSamples = Math.max(1, this.baselineRenderStats.length);
        const starfieldDrawCount = this.starfieldLayers.reduce((sum, layer) => {
            const count = layer?.geometry?.drawRange?.count
                ?? layer?.userData?.baseCount
                ?? layer?.geometry?.attributes?.position?.count
                ?? 0;
            return sum + count;
        }, 0);
        const ambientDustDrawCount = this.ambientDust?.geometry?.drawRange?.count
            ?? this.ambientDust?.userData?.baseCount
            ?? 0;
        const adaptive = this.adaptiveBudgetState || {};

        return {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.getCurrentQualityLevel(),
            frameCount,
            avgFrameMs: avgMs,
            avgFps: avgMs > 0 ? 1000 / avgMs : 0,
            low1Fps,
            p50FrameMs: p50Ms,
            p95FrameMs: p95Ms,
            p99FrameMs: p99Ms,
            avgDrawCalls: totals.calls / renderSamples,
            avgTriangles: totals.triangles / renderSamples,
            avgPoints: totals.points / renderSamples,
            avgTextures: totals.textures / renderSamples,
            avgGeometries: totals.geometries / renderSamples,
            peakDrawCalls: peaks.calls,
            peakTriangles: peaks.triangles,
            peakPoints: peaks.points,
            peakTextures: peaks.textures,
            peakGeometries: peaks.geometries,
            seed: this.flags.seed,
            fixedDeltaMs: this.flags.fixedDeltaMs,
            compile: { ...this.compileStats },
            runtimeFeatures: {
                usePost: this.flags.usePost,
                useMRT: this.flags.useMRT,
                useCompute: this.flags.useCompute,
                qualityAllowsCompute: this.qualityPreset?.enableCompute !== false,
                sparkMode: this.sparkCompute?.computeNode ? 'compute' : 'unified-fallback',
                atmosphereLayers: this.qualityPreset?.atmosphereLayers ?? 1,
                dustParticles: this.qualityPreset?.dustParticles ?? 0,
                pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
                postResolutionScale: this.adaptiveBudgetState?.postResolutionScale ?? 1.0,
            },
            adaptiveState: {
                targetFrameMs: adaptive.targetFrameMs ?? null,
                frameTimeEmaMs: adaptive.frameTimeEmaMs ?? null,
                pixelRatioScale: adaptive.pixelRatioScale ?? 1.0,
                postResolutionScale: adaptive.postResolutionScale ?? 1.0,
                bloomDownsample: adaptive.bloomDownsample ?? this.qualityPreset?.bloomDownsample ?? null,
                chromaticEnabled: adaptive.chromaticEnabled ?? true,
                lensingStrength: adaptive.lensingStrength ?? 1.0,
                transientScale: adaptive.transientScale ?? 1.0,
                sparkScale: adaptive.sparkScale ?? 1.0,
                gasSwirlScale: adaptive.gasSwirlScale ?? 1.0,
                waveScale: adaptive.waveScale ?? 1.0,
                farStarScale: adaptive.farStarScale ?? 1.0,
            },
            activeEffects: {
                gasSwirlParticles: this.gasSwirlData?.activeEstimate ?? this.gasSwirlData?.activeCount ?? 0,
                voidSparkParticles: this.unifiedSparkData?.activeEstimate
                    ?? (this.sparkCompute?.count ?? 0),
                activeCosmicWaves: this.cosmicWaves.length,
                pooledCosmicWaves: this.cosmicWavePool.length,
                starfieldDrawCount,
                ambientDustDrawCount,
                postScale: adaptive.postResolutionScale ?? 1.0,
                pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
            },
            mrtDowngrade: this.lastMrtDowngrade ? { ...this.lastMrtDowngrade } : null,
            flags: {
                forceWebGL: this.flags.forceWebGL,
                noPost: this.flags.noPost,
                noMRT: this.flags.noMRT,
                noCompute: this.flags.noCompute,
                noAdaptiveScale: this.flags.noAdaptiveScale,
                fixedPixelRatio: this.flags.fixedPixelRatio,
            },
            capturedAt: new Date().toISOString(),
        };
    }

    downloadBaselineReport(label = 'cosmic-noir-baseline') {
        const report = this.getBaselineReport();
        if (!report || typeof window === 'undefined' || typeof document === 'undefined') {
            return null;
        }

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${label}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        return report;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;

        window.cosmicNoirBaseline = {
            report: () => this.getBaselineReport(),
            capture: (label = 'runtime') => {
                const report = this.getBaselineReport();
                if (!report) {
                    console.log('[CosmicNoirBaseline] No baseline frames collected yet.');
                    return null;
                }
                console.log(`[CosmicNoirBaseline] ${label}`, report);
                return report;
            },
            downloadReport: (label = 'cosmic-noir-baseline') => this.downloadBaselineReport(label),
            reset: () => this.resetBaselineCapture(),
            getSamples: () => ({
                frames: [...this.baselineFrames],
                render: [...this.baselineRenderStats],
            }),
        };

        console.log(
            '[CosmicNoirBaseline] Helpers: window.cosmicNoirBaseline.capture(label), '
            + 'report(), downloadReport(label), reset(), getSamples()',
        );
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.cosmicNoirBaseline) {
            delete window.cosmicNoirBaseline;
        }
    }

    probeCapabilities() {
        if (!this.isWebGPU || !this.renderer?.backend?.isWebGPUBackend) {
            this.capabilities = {
                isWebGPU: false,
                maxColorAttachments: 0,
                supportsCompute: false,
                supportsPost: false,
            };
            return;
        }

        const { backend } = this.renderer;
        const device = backend?.device;
        this.capabilities = {
            isWebGPU: true,
            maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
            supportsCompute: typeof this.renderer.compute === 'function',
            supportsPost: typeof THREE_WEBGPU.PostProcessing === 'function',
        };
    }

    updateCapabilityFlags() {
        const usePost = this.isWebGPU
            && this.capabilities?.supportsPost
            && this.qualityPreset.enablePostProcessing
            && !this.flags.noPost;
        const supportsMRT = this.capabilities?.maxColorAttachments > 1;
        const guardMrtOnPlatform = this.shouldGuardMrtOnPlatform();
        const useMRT = usePost && !this.flags.noMRT && supportsMRT && !guardMrtOnPlatform;
        const qualityAllowsCompute = this.qualityPreset.enableCompute !== false;
        const useCompute = this.isWebGPU
            && this.capabilities?.supportsCompute
            && qualityAllowsCompute
            && !this.flags.noCompute;

        if (
            guardMrtOnPlatform
            && usePost
            && supportsMRT
            && !this.flags.noMRT
            && !this.loggedMrtPlatformGuard
        ) {
            console.log('[CosmicNoir] MRT disabled on Windows WebGPU (RC5 stability guard).');
            this.loggedMrtPlatformGuard = true;
        }

        this.flags.usePost = usePost;
        this.flags.useMRT = useMRT;
        this.flags.useCompute = useCompute;
        this.normalizeRuntimeFeatureFlags();
    }

    shouldGuardMrtOnPlatform() {
        if (!this.isWebGPU || typeof navigator === 'undefined') {
            return false;
        }
        const ua = navigator.userAgent || '';
        return /Windows/i.test(ua);
    }

    normalizeRuntimeFeatureFlags() {
        if (!this.isWebGPU) {
            this.flags.usePost = false;
            this.flags.useMRT = false;
            this.flags.useCompute = false;
            return;
        }

        if (this.flags.noPost || !this.flags.usePost) {
            this.flags.usePost = false;
            this.flags.useMRT = false;
        }

        if (this.flags.noMRT) {
            this.flags.useMRT = false;
        }

        if (this.qualityPreset?.enableCompute === false) {
            this.flags.useCompute = false;
        }

        if (this.flags.noCompute || !this.capabilities?.supportsCompute) {
            this.flags.useCompute = false;
        }
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        const postOwnsToneMapping = this.isWebGPU && this.flags.usePost && !!this.postProcessing;
        if (postOwnsToneMapping) {
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1.0;
        } else {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.0;
        }
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;
        if (
            material.isMeshBasicNodeMaterial
            || material.isMeshStandardNodeMaterial
            || material.isMeshPhysicalNodeMaterial
            || material.isMeshPhongNodeMaterial
            || material.isPointsNodeMaterial
            || material.isSpriteNodeMaterial
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    clearSceneMrtNodes() {
        if (!this.scene) return;

        const visited = new Set();
        const clearMaterial = (material) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach(clearMaterial);
                return;
            }
            if (visited.has(material) || !this.isNodeMaterial(material)) return;
            visited.add(material);
            material.mrtNode = null;
            material.needsUpdate = true;
        };

        if (this.scene.material) {
            clearMaterial(this.scene.material);
        }
        this.scene.traverse((child) => {
            if (child.material) clearMaterial(child.material);
        });
    }

    disableMrtRuntime(reason, details = null, options = {}) {
        if (!this.isWebGPU) return;

        const { rebuildPost = true, clearNodes = true } = options;
        const wasEnabled = this.flags.useMRT === true;

        this.flags.useMRT = false;
        this.flags.noMRT = true;
        this.lastMrtDowngrade = {
            reason,
            details,
            at: new Date().toISOString(),
        };

        if (clearNodes) {
            this.clearSceneMrtNodes();
        }

        if (wasEnabled) {
            console.warn('[CosmicNoir] MRT fail-safe downgrade applied:', this.lastMrtDowngrade);
        }

        if (rebuildPost && this.postProcessing && this.flags.usePost && !this.flags.noPost) {
            try {
                this.setupPostProcessing();
                this.configureRendererColorPipeline();
            } catch (error) {
                console.warn('[CosmicNoir] Failed to rebuild post stack after MRT downgrade:', error);
            }
        }

        if (this.flags.mrtAudit) {
            this.auditMrtMaterials();
        }
    }

    applyMrtPatchToMaterial(material) {
        if (!this.isWebGPU || !this.flags.useMRT || !material) return true;

        const materials = Array.isArray(material) ? material : [material];
        const zeroEmissive = vec3(0.0, 0.0, 0.0);

        for (let i = 0; i < materials.length; i += 1) {
            const entry = materials[i];
            if (!entry || !this.isNodeMaterial(entry)) {
                return false;
            }
        }

        materials.forEach((entry) => {
            const hadEmissiveNode = Boolean(entry.emissiveNode);

            if (!entry.userData) {
                entry.userData = {};
            }
            if (typeof entry.userData.emitsBloom !== 'boolean') {
                entry.userData.emitsBloom = hadEmissiveNode;
            }
            if (!entry.userData.mrtRole) {
                entry.userData.mrtRole = hadEmissiveNode ? 'auto-emissive' : 'auto-zero-emissive';
            }

            if (!entry.emissiveNode) {
                entry.emissiveNode = zeroEmissive;
            }
            entry.mrtNode = mrt({ emissive: entry.emissiveNode || zeroEmissive });
            entry.needsUpdate = true;
        });

        return true;
    }

    ensureMrtMaterials() {
        if (!this.isWebGPU || !this.scene || !this.flags.useMRT) return;

        const seen = new Set();
        const nonNode = [];
        const patched = [];
        const nodeMaterials = [];

        const recordMaterial = (material, object) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach((mat) => recordMaterial(mat, object));
                return;
            }
            if (seen.has(material)) return;
            seen.add(material);

            const objectName = object?.name || object?.type || 'UnknownObject';
            const materialName = material.name || material.type || material.constructor?.name || 'UnknownMaterial';

            if (!this.isNodeMaterial(material)) {
                nonNode.push({ objectName, materialName });
                return;
            }

            nodeMaterials.push(material);
            const hadEmissiveNode = Boolean(material.emissiveNode);
            if (!this.applyMrtPatchToMaterial(material)) {
                nonNode.push({ objectName, materialName });
                return;
            }
            if (!hadEmissiveNode) {
                patched.push({ objectName, materialName });
            }
        };

        if (this.scene.material) {
            recordMaterial(this.scene.material, this.scene);
        }
        this.scene.traverse((child) => {
            if (child.material) {
                recordMaterial(child.material, child);
            }
        });

        if (patched.length && this.flags.baseline) {
            console.log('[CosmicNoir] Patched emissiveNode on MRT materials:', patched);
        }

        if (nonNode.length) {
            this.disableMrtRuntime(
                'non-node-materials-detected',
                {
                    nonNode,
                    nodeMaterialCount: nodeMaterials.length,
                },
                { rebuildPost: Boolean(this.postProcessing) },
            );
        }
    }

    auditMrtMaterials() {
        if (!this.flags.mrtAudit || !this.scene) return;

        const rows = [];
        const seen = new Set();
        let totalNodeMaterials = 0;
        let bloomMaterials = 0;
        let zeroEmissiveMaterials = 0;
        let missingIntent = 0;
        let missingRole = 0;
        let missingEmissive = 0;
        let missingMrtNode = 0;
        const byRole = {};

        this.scene.traverse((object) => {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                if (!material || seen.has(material)) return;
                seen.add(material);
                const role = material.userData?.mrtRole || 'unclassified';
                const emitsBloom = material.userData?.emitsBloom;
                const nodeMaterial = this.isNodeMaterial(material);
                const hasEmissiveNode = !!material.emissiveNode;
                const hasMrtNode = !!material.mrtNode;

                if (nodeMaterial) {
                    totalNodeMaterials += 1;
                    byRole[role] = (byRole[role] || 0) + 1;

                    if (typeof emitsBloom !== 'boolean') {
                        missingIntent += 1;
                    } else if (emitsBloom) {
                        bloomMaterials += 1;
                    } else {
                        zeroEmissiveMaterials += 1;
                    }

                    if (!material.userData?.mrtRole) {
                        missingRole += 1;
                    }
                    if (!hasEmissiveNode) {
                        missingEmissive += 1;
                    }
                    if (this.flags.useMRT && !hasMrtNode) {
                        missingMrtNode += 1;
                    }
                }

                rows.push({
                    object: object.name || object.type || 'Unknown',
                    material: material.name || material.type || material.constructor?.name || 'Unknown',
                    nodeMaterial,
                    role,
                    emitsBloom: typeof emitsBloom === 'boolean' ? emitsBloom : null,
                    hasEmissiveNode,
                    hasMrtNode,
                });
            });
        });

        console.log('[CosmicNoir] MRT audit summary', {
            totalNodeMaterials,
            bloomMaterials,
            zeroEmissiveMaterials,
            missingIntent,
            missingRole,
            missingEmissive,
            missingMrtNode,
            byRole,
            lastMrtDowngrade: this.lastMrtDowngrade,
        });
        console.log('[CosmicNoir] MRT audit rows', rows);
    }

    async precompileSceneWithTimeout() {
        if (!this.isWebGPU || !this.renderer?.compileAsync || !this.scene || !this.camera) {
            this.compileStats = {
                status: 'skipped',
                durationMs: 0,
                message: 'compileAsync unavailable or non-WebGPU path',
            };
            return;
        }

        const timeoutMs = 3000;
        const compileStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let timeoutId = null;

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('compile timeout')), timeoutMs);
                }),
            ]);
            const durationMs = (
                (typeof performance !== 'undefined' ? performance.now() : Date.now()) - compileStartMs
            );
            this.compileStats = {
                status: 'success',
                durationMs,
                message: null,
            };
            console.log('[CosmicNoir] Scene pre-compiled');
        } catch (error) {
            const durationMs = (
                (typeof performance !== 'undefined' ? performance.now() : Date.now()) - compileStartMs
            );
            this.compileStats = {
                status: 'fallback',
                durationMs,
                message: error.message,
            };
            console.warn('[CosmicNoir] compileAsync skipped:', error.message);
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }

    async createScene() {
        console.log('[CosmicNoir] Creating stunning 3D cosmic noir scene...');

        this.cancelAnimationLoop();
        this.clearDeferredTimeouts();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.removeRendererResilience();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        this.refreshFlagsForScene();
        this.initializeDeterministicState();
        this.resetBaselineCapture();
        this.clock = new THREE.Clock();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        this.initializeAdaptiveBudgetState();

        let container = document.getElementById('cosmic-noir-theme');
        if (!container) {
            console.warn('[CosmicNoir] Container not found, creating it...');
            container = document.createElement('div');
            container.id = 'cosmic-noir-theme';
            container.className = 'theme-container';
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
                pointerEvents: 'none',
                opacity: '0', // Start hidden, fade in later
            });
            // Insert as first child to be behind UI
            if (document.body.firstChild) {
                document.body.insertBefore(container, document.body.firstChild);
            } else {
                document.body.appendChild(container);
            }
        }

        container.innerHTML = '';

        await this.initRenderer(container);
        if (!this.renderer || !this.scene || !this.camera) {
            console.error('[CosmicNoir] Renderer initialization failed');
            return;
        }

        this.probeCapabilities();
        this.updateCapabilityFlags();
        this.ensureSharedNoiseTexture();

        this.createStarfield();
        this.createNebulaClouds();
        this.createAmbientDust();
        this.createPlanet();
        this.createAtmosphere();
        this.createVoidSparks();
        this.createGasSwirlParticles();
        this.ensureMrtMaterials();
        this.auditMrtMaterials();
        this.setupPostProcessing();
        this.normalizeRuntimeFeatureFlags();
        this.configureRendererColorPipeline();
        this.setupResizeHandler();
        this.setupEventListeners();

        if (this.flags.baseline) {
            this.installBaselineHelpers();
            console.log('[CosmicNoirBaseline] Baseline capture enabled', {
                preset: quality,
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                seed: this.flags.seed,
                fixedDeltaMs: this.flags.fixedDeltaMs,
            });
        }

        await this.precompileSceneWithTimeout();
        this.startAnimation();

        console.log('[CosmicNoir] Runtime capabilities', {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            maxColorAttachments: this.capabilities.maxColorAttachments,
            supportsCompute: this.capabilities.supportsCompute,
            supportsPost: this.capabilities.supportsPost,
            usePost: this.flags.usePost,
            useMRT: this.flags.useMRT,
            useCompute: this.flags.useCompute,
            lastMrtDowngrade: this.lastMrtDowngrade,
            presetFeatures: {
                enableCompute: this.qualityPreset.enableCompute !== false,
                atmosphereLayers: this.qualityPreset.atmosphereLayers ?? 1,
                dustParticles: this.qualityPreset.dustParticles ?? 0,
                computeSparkCount: this.qualityPreset.computeSparkCount ?? null,
            },
            flags: {
                forceWebGL: this.flags.forceWebGL,
                noPost: this.flags.noPost,
                noMRT: this.flags.noMRT,
                noCompute: this.flags.noCompute,
                noAdaptiveScale: this.flags.noAdaptiveScale,
                fixedPixelRatio: this.flags.fixedPixelRatio,
            },
        });
        console.log('[CosmicNoir] Scene created successfully');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
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
            } catch (error) {
                console.warn('[CosmicNoir] WebGPU init failed, falling back to WebGL2:', error.message);
                if (webgpuRenderer) {
                    webgpuRenderer.dispose();
                    webgpuRenderer = null;
                }
            }
        }

        const hasWebGPUBackend = webgpuRenderer?.backend?.isWebGPUBackend === true;
        const compatibilityGuardEnabled = this.hasWebGLOnlyDependencies();

        if (hasWebGPUBackend && compatibilityGuardEnabled) {
            console.warn(
                '[CosmicNoir] WebGPU available, but Phase 1 compatibility guard keeps WebGL path:',
                this.getWebGPUBlockers(),
            );
        }

        if (hasWebGPUBackend && !compatibilityGuardEnabled) {
            this.renderer = webgpuRenderer;
            this.isWebGPU = true;
            this.isWebGL = false;
        } else {
            if (webgpuRenderer) {
                webgpuRenderer.dispose();
                webgpuRenderer = null;
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

        if (!this.renderer) return;

        this.renderer.setClearColor(0x000000, 1); // Pure black background
        this.renderer.setPixelRatio(this.getRendererPixelRatio());
        this.renderer.setSize(width, height, false);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);

        this.setupRendererResilience(this.renderer, {
            webgpuDevice: this.isWebGPU ? this.renderer?.backend?.device : null,
            onDeviceLost: (info) => {
                this.handleDeviceLoss(info);
            },
        });
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x010101, 0.00026); // Deep-space depth without haze lift

        // Camera positioned for depth
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000);
        this.camera.position.set(0, 0, 1200);
        this.camera.lookAt(0, 0, 0);

        // Key light - cinematic side lighting to reveal planet texture
        const planetLight = new THREE.PointLight(0x9ea3be, 2.2, 3500);
        planetLight.position.set(350, 200, 600);
        this.scene.add(planetLight);

        // Fill light from opposite side - prevents pure-black night side
        const fillLight = new THREE.PointLight(0x3a3d52, 0.6, 3000);
        fillLight.position.set(-250, -100, 300);
        this.scene.add(fillLight);

        // Subtle ambient to lift overall darkness
        const ambientLight = new THREE.AmbientLight(0x101218, 0.35);
        this.scene.add(ambientLight);

        console.log(`[CosmicNoir] Renderer initialized (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Deep 3D grayscale stars
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        if (Array.isArray(this.starTwinkleComputes) && this.starTwinkleComputes.length > 0) {
            this.starTwinkleComputes.forEach((compute) => compute?.dispose?.());
        } else if (this.starTwinkleCompute?.dispose) {
            this.starTwinkleCompute.dispose();
        }
        this.starTwinkleComputes = [];
        this.starTwinkleCompute = null;
        this.starfieldUniforms = [];
        this.starfieldLayers = [];

        const { starCount } = this.qualityPreset;
        const layerConfigs = [
            {
                id: 'near',
                ratio: 0.22,
                radiusMin: 1800,
                radiusMax: 3800,
                sizeMin: 30,
                sizeMax: 56,
                brightnessMin: 0.55,
                brightnessMax: 1.0,
                twinkleMin: 1.1,
                twinkleMax: 2.7,
                parallax: 0.62,
                spinY: 0.0038,
                spinZ: 0.0014,
            },
            {
                id: 'mid',
                ratio: 0.36,
                radiusMin: 3500,
                radiusMax: 7600,
                sizeMin: 20,
                sizeMax: 40,
                brightnessMin: 0.4,
                brightnessMax: 0.82,
                twinkleMin: 0.9,
                twinkleMax: 2.2,
                parallax: 0.38,
                spinY: 0.0028,
                spinZ: 0.001,
            },
            {
                id: 'far',
                ratio: 0.42,
                radiusMin: 6800,
                radiusMax: 12500,
                sizeMin: 12,
                sizeMax: 26,
                brightnessMin: 0.24,
                brightnessMax: 0.56,
                twinkleMin: 0.6,
                twinkleMax: 1.6,
                parallax: 0.16,
                spinY: 0.0017,
                spinZ: 0.0007,
            },
        ];

        // Grayscale star colors - pure noir palette
        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xf0f0f0), // Near white
            new THREE.Color(0xe0e0e0), // Light gray
            new THREE.Color(0xd0d0d0), // Medium-light gray
            new THREE.Color(0xc0c0c8), // Silver tint
            new THREE.Color(0xb0b0b8), // Cooler silver
        ];

        const layerCounts = layerConfigs.map((config, index) => {
            if (index === layerConfigs.length - 1) return 0;
            return Math.floor(starCount * config.ratio);
        });
        const assigned = layerCounts.reduce((sum, count) => sum + count, 0);
        layerCounts[layerCounts.length - 1] = Math.max(0, starCount - assigned);

        this.starfield = new THREE.Group();

        layerConfigs.forEach((config, layerIndex) => {
            const layerCount = layerCounts[layerIndex];
            if (layerCount <= 0) return;

            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(layerCount * 3);
            const colors = new Float32Array(layerCount * 3);
            const sizes = new Float32Array(layerCount);
            const twinkleData = new Float32Array(layerCount * 2); // phase + speed
            const brightness = new Float32Array(layerCount);

            for (let i = 0; i < layerCount; i++) {
                const i3 = i * 3;
                const i2 = i * 2;

                // Spherical distribution with band-specific radius.
                const radius = config.radiusMin + this.rand() * (config.radiusMax - config.radiusMin);
                const theta = this.rand() * Math.PI * 2;
                const phi = Math.acos(2 * this.rand() - 1);

                positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
                positions[i3 + 2] = radius * Math.cos(phi);

                const color = starColors[Math.floor(this.rand() * starColors.length)];
                colors[i3] = color.r;
                colors[i3 + 1] = color.g;
                colors[i3 + 2] = color.b;

                sizes[i] = config.sizeMin + this.rand() * (config.sizeMax - config.sizeMin);
                twinkleData[i2] = this.rand() * Math.PI * 2;
                twinkleData[i2 + 1] = config.twinkleMin
                    + this.rand() * (config.twinkleMax - config.twinkleMin);
                brightness[i] = config.brightnessMin
                    + this.rand() * (config.brightnessMax - config.brightnessMin);
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
            geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

            let material;
            let uniforms;
            if (this.isWebGPU) {
                ({ material, uniforms } = createStarfieldNodeMaterial({
                    pixelRatio: this.renderer.getPixelRatio(),
                    isWebGPU: this.isWebGPU,
                }));
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uPixelRatio: { value: this.renderer.getPixelRatio() },
                        uEventBoost: { value: 0 },
                    },
                    vertexShader: starVertexShader,
                    fragmentShader: starFragmentShader,
                    transparent: true,
                    vertexColors: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                ({ uniforms } = material);
            }

            this.starfieldUniforms.push(uniforms);
            const points = new THREE.Points(geometry, material);
            points.userData = {
                layerId: config.id,
                baseCount: layerCount,
                parallax: config.parallax,
                spinY: config.spinY,
                spinZ: config.spinZ,
                uniforms,
            };
            this.starfieldLayers.push(points);
            this.starfield.add(points);
        });

        this.starTwinkleCompute = this.starTwinkleComputes[0] || null;
        this.scene.add(this.starfield);
        console.log('[CosmicNoir] Starfield depth layers created with', starCount, 'total stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Grayscale/silver clouds at varying depths
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/cosmic-noir/';

        const textures = [
            textureLoader.load(`${texturePath}nebula-noir-1.png`),
            textureLoader.load(`${texturePath}nebula-noir-2.png`),
            textureLoader.load(`${texturePath}nebula-noir-3.png`),
        ];
        const noiseMap = this.ensureSharedNoiseTexture();

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Mirror Blood Moon layer structure for similar gas motion silhouette.
        const nebulaConfigs = [
            // Deep background layer
            {
                texture: textures[0], size: 14000, z: -4500, opacity: 0.5, speed: 0.0001, parallaxX: 0.08, parallaxY: 0.08, rotationSpeed: 0.0,
            },
            {
                texture: textures[1], size: 16000, z: -4000, opacity: 0.42, speed: 0.00015, parallaxX: 0.08, parallaxY: 0.08, rotationSpeed: 0.0,
            },
            // Mid layer
            {
                texture: textures[2], size: 11000, z: -3000, opacity: 0.34, speed: 0.0002, parallaxX: 0.2, parallaxY: 0.15, rotationSpeed: 0.0,
            },
            {
                texture: textures[0], size: 12500, z: -2500, opacity: 0.28, speed: 0.00025, parallaxX: 0.2, parallaxY: 0.15, rotationSpeed: 0.0,
            },
        ];

        this.nebulaClouds = [];

        nebulaConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
            let material;
            let uniforms = null;
            if (this.isWebGPU) {
                ({ material, uniforms } = createNebulaNodeMaterial({
                    map: config.texture,
                    noiseMap,
                    opacity: config.opacity,
                }));
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        tDiffuse: { value: config.texture },
                        uNoiseMap: { value: noiseMap },
                        uOpacity: { value: config.opacity },
                        uPulse: { value: 0 },
                        uTime: { value: 0 },
                    },
                    vertexShader: nebulaVertexShader,
                    fragmentShader: nebulaFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                ({ uniforms } = material);
            }

            const mesh = new THREE.Mesh(geometry, material);
            // Random position spread
            mesh.position.x = (this.rand() - 0.5) * (config.size * 0.35);
            mesh.position.y = (this.rand() - 0.5) * (config.size * 0.18);
            mesh.position.z = config.z;
            mesh.rotation.z = this.rand() * Math.PI * 2;

            mesh.userData = {
                driftSpeed: config.speed,
                driftRange: config.size * 0.75,
                baseOpacity: config.opacity,
                pulsePhase: this.rand() * Math.PI * 2,
                parallaxX: config.parallaxX ?? 0.3,
                parallaxY: config.parallaxY ?? 0.2,
                rotationSpeed: config.rotationSpeed ?? 0.0,
                uniforms,
            };

            this.nebulaClouds.push(mesh);
            this.scene.add(mesh);
        });

        console.log('[CosmicNoir] Nebula clouds created with high-def textures');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Black Planet - 3D Sphere with subtle texture and silver glow
    // ─────────────────────────────────────────────────────────────────────────

    createPlanet() {
        const planetSize = 280;

        // Create planet group for drifting
        this.planetGroup = new THREE.Group();
        this.scene.add(this.planetGroup);

        // Load Planet Texture
        const textureLoader = new THREE.TextureLoader();
        const planetTexture = textureLoader.load('./textures/2k_haumea_fictional_black.png');
        planetTexture.wrapS = THREE.ClampToEdgeWrapping;
        planetTexture.wrapT = THREE.ClampToEdgeWrapping;
        const sunDirection = new THREE.Vector3(0.6, 0.4, 0.7).normalize();

        // Planet sphere with shader material
        const geometry = new THREE.SphereGeometry(
            planetSize,
            this.qualityPreset.planetDetail,
            this.qualityPreset.planetDetail,
        );
        let material;
        if (this.isWebGPU) {
            const { material: nodeMaterial, uniforms } = createPlanetNodeMaterial({
                map: planetTexture,
                sunDirection,
                fbmOctaves: this.qualityPreset.planetFbmOctaves ?? 4,
            });
            material = nodeMaterial;
            this.planetUniforms = uniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPulseIntensity: { value: 0 },
                    uGlowIntensity: { value: 1.0 },
                    uMap: { value: planetTexture },
                    uSunDirection: { value: sunDirection }, // Cinematic side lighting
                },
                vertexShader: planetVertexShader,
                fragmentShader: planetFragmentShader,
            });
            const { uniforms } = material;
            this.planetUniforms = uniforms;
        }

        this.planet = new THREE.Mesh(geometry, material);
        this.planet.renderOrder = 100;
        this.planetGroup.add(this.planet);

        // Create glow layers around the planet
        this.createPlanetGlowLayers(planetSize);
        this.createComboFlashLayer(planetSize);
        this.createComboLensFlareLayer();
        this.createAccretionDisk();

        console.log('[CosmicNoir] 3D Black Planet created with texture and accretion disk');
    }

    createPlanetGlowLayers(planetSize) {
        const config = {
            size: planetSize * 2.45,
            color: 0x1a1a22,
            opacity: 0.16,
            z: -12,
        };

        const geometry = this.isWebGPU ? null : new THREE.PlaneGeometry(config.size, config.size);
        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            ({ material, uniforms } = createPlanetGlowSpriteNodeMaterial({
                color: new THREE.Color(config.color),
                opacity: config.opacity,
            }));
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.7)');
            gradient.addColorStop(0.18, 'rgba(220, 220, 230, 0.42)');
            gradient.addColorStop(0.46, 'rgba(150, 150, 165, 0.22)');
            gradient.addColorStop(0.74, 'rgba(80, 80, 95, 0.08)');
            gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            material = new THREE.MeshBasicMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        const glow = this.isWebGPU
            ? new THREE.Sprite(material)
            : new THREE.Mesh(geometry, material);
        if (this.isWebGPU) {
            glow.scale.set(config.size, config.size, 1.0);
        }
        glow.position.set(0, 0, config.z);
        glow.renderOrder = 50;
        glow.userData.baseOpacity = config.opacity;
        glow.userData.uniforms = uniforms;
        this.planetGlowLayers.push(glow);
        this.planetGroup.add(glow);
    }

    createComboFlashLayer(planetSize) {
        if (this.comboFlash) {
            this.planetGroup?.remove(this.comboFlash);
            this.comboFlash.geometry?.dispose?.();
            this.comboFlash.material?.dispose?.();
        }
        this.comboFlash = null;
        this.comboFlashUniforms = null;

        const size = planetSize * 2.7;
        const geometry = this.isWebGPU ? null : new THREE.PlaneGeometry(size, size);
        let material;
        let uniforms = null;

        if (this.isWebGPU) {
            ({ material, uniforms } = createPlanetGlowSpriteNodeMaterial({
                color: new THREE.Color(0xe6e6ff),
                opacity: 0.0,
            }));
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
            gradient.addColorStop(0.2, 'rgba(225, 225, 245, 0.78)');
            gradient.addColorStop(0.5, 'rgba(170, 170, 190, 0.32)');
            gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            material = new THREE.MeshBasicMaterial({
                map: texture,
                color: 0xffffff,
                transparent: true,
                opacity: 0.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: false,
            });
        }

        const mesh = this.isWebGPU
            ? new THREE.Sprite(material)
            : new THREE.Mesh(geometry, material);
        if (this.isWebGPU) {
            mesh.scale.set(size, size, 1.0);
        }
        mesh.position.set(0, 0, 15);
        mesh.renderOrder = 170;
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.userData.uniforms = uniforms;
        this.comboFlash = mesh;
        this.comboFlashUniforms = uniforms;
        this.planetGroup.add(mesh);
    }

    createAccretionDisk() {
        if (this.accretionDisk) {
            this.planetGroup?.remove(this.accretionDisk);
            this.accretionDisk.geometry?.dispose?.();
            this.accretionDisk.material?.dispose?.();
        }

        const innerRadius = 210; // Starts right outside the singularity core
        const outerRadius = 1200; // Massive sweeping disk
        const diskSegments = this.qualityPreset.diskSegments ?? 128;
        const radialSegments = Math.max(24, Math.floor(diskSegments / 2));
        const geometry = new THREE.RingGeometry(innerRadius, outerRadius, diskSegments, radialSegments);

        // Rewrite UVs so uv.x = angle (0..1) and uv.y = radius (0..1)
        const posAttribute = geometry.attributes.position;
        const uvAttribute = geometry.attributes.uv;
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const rad = Math.sqrt(x * x + y * y);
            const rNorm = (rad - innerRadius) / (outerRadius - innerRadius);

            let angle = Math.atan2(y, x);
            if (angle < 0) angle += Math.PI * 2;
            const aNorm = angle / (Math.PI * 2);

            uvAttribute.setXY(i, aNorm, rNorm);
        }

        let material;
        let uniforms;
        const noiseMap = this.ensureSharedNoiseTexture();

        if (this.isWebGPU) {
            ({ material, uniforms } = createAccretionDiskNodeMaterial({
                noiseMap,
            }));
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPulseIntensity: { value: 0 },
                    uNoiseMap: { value: noiseMap },
                },
                vertexShader: accretionDiskVertexShader,
                fragmentShader: accretionDiskFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            ({ uniforms } = material);
        }

        const mesh = new THREE.Mesh(geometry, material);
        // Tilt the disk for a cinematic angle
        mesh.rotation.x = Math.PI * 0.42;
        mesh.rotation.y = Math.PI * 0.12;
        mesh.renderOrder = 102; // Under the gas swirl and behind combo flares

        this.accretionDisk = mesh;
        this.accretionDiskUniforms = uniforms;
        this.planetGroup.add(mesh);
    }

    createComboLensFlareLayer() {
        if (this.comboLensFlare) {
            this.scene?.remove(this.comboLensFlare);
            this.comboLensFlare.geometry?.dispose?.();
            this.comboLensFlare.material?.dispose?.();
        }
        this.comboLensFlare = null;
        this.comboLensFlareUniforms = null;

        const geometry = new THREE.PlaneGeometry(1100, 420);
        let material;
        let uniforms = null;

        if (this.isWebGPU) {
            ({ material, uniforms } = createAnamorphicFlareNodeMaterial({
                opacity: 0.0,
            }));
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const centerGradient = ctx.createRadialGradient(256, 128, 10, 256, 128, 180);
            centerGradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
            centerGradient.addColorStop(0.3, 'rgba(210, 210, 225, 0.58)');
            centerGradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = centerGradient;
            ctx.fillRect(0, 0, 512, 256);

            const streakGradient = ctx.createLinearGradient(0, 128, 512, 128);
            streakGradient.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
            streakGradient.addColorStop(0.25, 'rgba(180, 180, 205, 0.08)');
            streakGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.18)');
            streakGradient.addColorStop(0.75, 'rgba(180, 180, 205, 0.08)');
            streakGradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = streakGradient;
            ctx.fillRect(0, 96, 512, 64);

            const texture = new THREE.CanvasTexture(canvas);
            material = new THREE.MeshBasicMaterial({
                map: texture,
                color: 0xffffff,
                transparent: true,
                opacity: 0.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: false,
            });
        }

        material.depthWrite = false;
        material.depthTest = false;
        const flare = new THREE.Mesh(geometry, material);
        flare.renderOrder = 2000;
        flare.frustumCulled = false;
        flare.visible = false;
        flare.userData.uniforms = uniforms;
        this.comboLensFlare = flare;
        this.comboLensFlareUniforms = uniforms;
        this.scene.add(flare);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating grayscale particles
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientDust() {
        if (this.ambientDust) {
            this.scene?.remove(this.ambientDust);
            this.ambientDust.geometry?.dispose?.();
            this.ambientDust.material?.dispose?.();
        }
        this.ambientDust = null;
        this.ambientDustUniforms = null;

        const configuredDustParticles = Number.isFinite(this.qualityPreset.dustParticles)
            ? this.qualityPreset.dustParticles
            : 0;
        if (configuredDustParticles <= 0) return;

        const dustCount = Math.max(80, Math.floor(configuredDustParticles));
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(dustCount * 3);
        const randoms = new Float32Array(dustCount);
        const sizes = new Float32Array(dustCount);

        for (let i = 0; i < dustCount; i += 1) {
            const i3 = i * 3;
            const radius = 550 + this.rand() * 2200;
            const theta = this.rand() * Math.PI * 2;
            const phi = Math.acos(2 * this.rand() - 1);
            const sinPhi = Math.sin(phi);

            positions[i3] = radius * sinPhi * Math.cos(theta);
            positions[i3 + 1] = radius * sinPhi * Math.sin(theta);
            positions[i3 + 2] = (this.rand() - 0.5) * 1800;
            randoms[i] = this.rand();
            sizes[i] = 8 + this.rand() * 18;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        let material;
        let uniforms = null;

        if (this.isWebGPU) {
            ({ material, uniforms } = createAmbientDustNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
            }));
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                },
                vertexShader: particleVertexShader,
                fragmentShader: particleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            ({ uniforms } = material);
        }

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 45;
        points.userData.uniforms = uniforms;
        points.userData.parallax = 0.09;
        points.userData.baseCount = dustCount;
        this.ambientDust = points;
        this.ambientDustUniforms = uniforms;
        this.scene.add(points);

        console.log('[CosmicNoir] Ambient dust enabled with', dustCount, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Atmosphere - Volumetric gas shell with explosion support
    // ─────────────────────────────────────────────────────────────────────────

    createAtmosphere() {
        // Create an atmosphere slightly larger than the planet
        const planetSize = 280;
        const atmosphereSize = planetSize * 1.25;
        const innerAtmosphereSize = planetSize * 1.12;
        // Shell count: preset default, overridable via ?cosmicNoirAtmoShells=N for live A/B.
        // The inner shell is a full additive sphere of near-planet overdraw; High ships with 1 by
        // default (dropping it is a fill win with only a subtle loss of atmospheric depth).
        const atmosphereLayerCount = Math.max(
            1,
            this.flags.atmoShells ?? this.qualityPreset.atmosphereLayers ?? 2,
        );
        const noiseMap = this.ensureSharedNoiseTexture();

        const atmosphereDetail = this.qualityPreset.atmosphereDetail ?? 64;
        const createAtmosphereLayer = (radius, opacity, renderOrder) => {
            const geometry = new THREE.SphereGeometry(radius, atmosphereDetail, atmosphereDetail);
            let material;
            let uniforms;

            if (this.isWebGPU) {
                ({ material, uniforms } = createAtmosphereNodeMaterial({
                    noiseMap,
                }));
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uPulseIntensity: { value: 0 },
                        uExplosionTimer: { value: -10.0 },
                        uExplosionIntensity: { value: 0 },
                        uNoiseMap: { value: noiseMap },
                    },
                    vertexShader: atmosphereVertexShader,
                    fragmentShader: atmosphereFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.FrontSide, // Render outside only
                });
                ({ uniforms } = material);
            }

            material.opacity = opacity;
            const mesh = new THREE.Mesh(geometry, material);
            mesh.renderOrder = renderOrder;
            return { mesh, uniforms };
        };

        const outerLayer = createAtmosphereLayer(atmosphereSize, 0.32, 101);
        this.atmosphere = outerLayer.mesh;
        this.atmosphereUniforms = outerLayer.uniforms;
        this.planetGroup.add(this.atmosphere);

        if (atmosphereLayerCount > 1) {
            const innerLayer = createAtmosphereLayer(innerAtmosphereSize, 0.18, 100);
            this.atmosphereInner = innerLayer.mesh;
            this.atmosphereInnerUniforms = innerLayer.uniforms;
            this.planetGroup.add(this.atmosphereInner);
        } else {
            this.atmosphereInner = null;
            this.atmosphereInnerUniforms = null;
        }

        console.log(
            '[CosmicNoir] Atmosphere shell(s) created:',
            atmosphereLayerCount,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gas Shell Swirl Particles - Tangential particles from atmosphere on combo
    // ─────────────────────────────────────────────────────────────────────────

    createGasSwirlParticles() {
        if (this.gasSwirl) {
            this.planetGroup?.remove(this.gasSwirl);
            this.gasSwirl.geometry?.dispose?.();
            this.gasSwirl.material?.dispose?.();
        }
        this.gasSwirl = null;
        this.gasSwirlData = null;

        const count = 24000;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const alphas = new Float32Array(count);
        const sizes = new Float32Array(count);
        const velocities = new Float32Array(count * 4);
        const noiseSeeds = new Float32Array(count * 3);
        const births = new Float32Array(count);
        const lifetimes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            alphas[i] = 0;
            sizes[i] = 55 + this.rand() * 105;
            velocities[i * 4 + 3] = 0;
            noiseSeeds[i * 3] = this.rand();
            noiseSeeds[i * 3 + 1] = this.rand();
            noiseSeeds[i * 3 + 2] = this.rand();
            births[i] = -1000;
            lifetimes[i] = 1;
        }

        const positionAttr = new THREE.BufferAttribute(positions, 3);
        positionAttr.setUsage(THREE.DynamicDrawUsage);
        const alphaAttr = new THREE.BufferAttribute(alphas, 1);
        alphaAttr.setUsage(THREE.DynamicDrawUsage);
        const sizeAttr = new THREE.BufferAttribute(sizes, 1);
        sizeAttr.setUsage(THREE.DynamicDrawUsage);
        const velocityAttr = new THREE.BufferAttribute(velocities, 4);
        velocityAttr.setUsage(THREE.DynamicDrawUsage);
        const seedAttr = new THREE.BufferAttribute(noiseSeeds, 3);
        seedAttr.setUsage(THREE.DynamicDrawUsage);
        const birthAttr = new THREE.BufferAttribute(births, 1);
        birthAttr.setUsage(THREE.DynamicDrawUsage);
        const lifeAttr = new THREE.BufferAttribute(lifetimes, 1);
        lifeAttr.setUsage(THREE.DynamicDrawUsage);

        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('aAlpha', alphaAttr);
        geometry.setAttribute('aSize', sizeAttr);
        geometry.setAttribute('aVelocity', velocityAttr);
        geometry.setAttribute('aSeed', seedAttr);
        geometry.setAttribute('aBirth', birthAttr);
        geometry.setAttribute('aLife', lifeAttr);
        geometry.setDrawRange(0, 0);

        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            const { material: nodeMaterial, uniforms: nodeUniforms } = createGasSwirlNodeMaterial();
            material = nodeMaterial;
            uniforms = nodeUniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                },
                vertexShader: gasSwirlVertexShader,
                fragmentShader: gasSwirlFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            ({ uniforms } = material);
        }

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 102;
        points.visible = false;
        points.userData.uniforms = uniforms;

        this.gasSwirl = points;
        this.gasSwirlData = {
            count,
            positions,
            alphas,
            sizes,
            velocities,
            noiseSeeds,
            births,
            lifetimes,
            nextIndex: 0,
            highWaterMark: 0,
            activeWindows: [],
            activeEstimate: 0,
        };
        this.planetGroup.add(points);

        console.log('[CosmicNoir] Gas swirl particle system created with', count, 'shader-driven particles');
    }

    triggerGasSwirlBurst(comboCount) {
        if (!this.gasSwirl || !this.gasSwirlData) return;

        const d = this.gasSwirlData;
        const baseBatch = Math.floor(2200 + comboCount * 450);
        const batchSize = Math.min(
            d.count,
            this.scaleTransientCount(baseBatch, 'gasSwirlScale', Math.min(600, baseBatch)),
        );
        if (batchSize <= 0) return;

        const shellRadius = 350; // atmosphere outer shell radius
        const screenTargetZ = 1200;
        const startIndex = d.nextIndex;
        const visualCompensation = THREE.MathUtils.clamp(
            1 / Math.sqrt(this.getAdaptiveScale('gasSwirlScale', 1.0)),
            1.0,
            1.28,
        );
        let maxExpiresAt = this.time;

        for (let b = 0; b < batchSize; b++) {
            const idx = (startIndex + b) % d.count;

            const theta = this.rand() * Math.PI * 2;
            const cosPhi = 2 * this.rand() - 1;
            const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));

            const px = shellRadius * sinPhi * Math.cos(theta);
            const py = shellRadius * sinPhi * Math.sin(theta);
            const pz = shellRadius * cosPhi;

            d.positions[idx * 3] = px;
            d.positions[idx * 3 + 1] = py;
            d.positions[idx * 3 + 2] = pz;
            d.sizes[idx] = (55 + this.rand() * 105) * visualCompensation;
            d.noiseSeeds[idx * 3] = this.rand();
            d.noiseSeeds[idx * 3 + 1] = this.rand();
            d.noiseSeeds[idx * 3 + 2] = this.rand();

            const isShooter = this.rand() < (0.2 + comboCount * 0.05);
            let lifeSeconds;

            if (isShooter) {
                const dx = (this.rand() - 0.5) * 800; // Spread across screen width
                const dy = (this.rand() - 0.5) * 600; // Spread across screen height
                const dz = screenTargetZ;

                const vx = dx - px;
                const vy = dy - py;
                const vz = dz - pz;

                const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
                const speed = 150.0 + this.rand() * 100.0; // Very fast

                d.velocities[idx * 4] = (vx / len) * speed;
                d.velocities[idx * 4 + 1] = (vy / len) * speed;
                d.velocities[idx * 4 + 2] = (vz / len) * speed;
                d.velocities[idx * 4 + 3] = 1.0;
                lifeSeconds = 4.4 + this.rand() * 1.8;
            } else {
                const radialLen = Math.sqrt(px * px + pz * pz) || 1;
                const tangX = -pz / radialLen;
                const tangZ = px / radialLen;

                const tangSpeed = (160 + comboCount * 22) * (0.85 + this.rand() * 0.5);
                const outwardSpeed = (30 + comboCount * 10) * (0.5 + this.rand() * 0.8);
                const helixPhase = Math.atan2(pz, px);
                const upDrift = Math.sin(helixPhase * 2.0) * 35.0 * (this.rand() * 0.6 + 0.7);

                d.velocities[idx * 4] = tangX * tangSpeed + (px / shellRadius) * outwardSpeed;
                d.velocities[idx * 4 + 1] = py / shellRadius * outwardSpeed + upDrift;
                d.velocities[idx * 4 + 2] = tangZ * tangSpeed + (pz / shellRadius) * outwardSpeed;
                d.velocities[idx * 4 + 3] = 1.0;
                lifeSeconds = 10.0 + this.rand() * 8.0;
            }

            const birthTime = this.time + this.rand() * 0.22;
            d.births[idx] = birthTime;
            d.lifetimes[idx] = lifeSeconds;
            d.alphas[idx] = Math.min(1.0, (0.75 + this.rand() * 0.25) * visualCompensation);
            maxExpiresAt = Math.max(maxExpiresAt, birthTime + lifeSeconds);
        }

        d.nextIndex = (startIndex + batchSize) % d.count;
        d.highWaterMark = Math.max(d.highWaterMark, startIndex + Math.min(batchSize, d.count - startIndex));
        if (startIndex + batchSize > d.count) {
            d.highWaterMark = d.count;
        }
        d.activeWindows.push({ count: batchSize, expiresAt: maxExpiresAt });

        const firstCount = Math.min(batchSize, d.count - startIndex);
        const secondCount = batchSize - firstCount;
        this.markGeometryAttributeRange(this.gasSwirl.geometry, startIndex, firstCount, [
            'position',
            'aAlpha',
            'aSize',
            'aVelocity',
            'aSeed',
            'aBirth',
            'aLife',
        ]);
        if (secondCount > 0) {
            this.markGeometryAttributeRange(this.gasSwirl.geometry, 0, secondCount, [
                'position',
                'aAlpha',
                'aSize',
                'aVelocity',
                'aSeed',
                'aBirth',
                'aLife',
            ]);
        }

        this.gasSwirl.visible = true;
        this.gasSwirl.geometry.setDrawRange(0, Math.max(1, d.highWaterMark));
    }

    updateGasSwirlParticles() {
        if (!this.gasSwirl || !this.gasSwirlData) return;

        const d = this.gasSwirlData;
        const uniforms = this.gasSwirl.userData?.uniforms || this.gasSwirl.material?.uniforms;
        if (uniforms?.uTime) {
            uniforms.uTime.value = this.time;
        }

        // Idle fast-path: with no live bursts, skip the per-frame filter()/reduce() allocation.
        // End state (estimate 0, invisible, draw range 0) is identical to the general path.
        if (d.activeWindows.length === 0) {
            d.activeEstimate = 0;
            if (this.gasSwirl.visible) {
                this.gasSwirl.visible = false;
                this.gasSwirl.geometry.setDrawRange(0, 0);
            }
            return;
        }

        // Compact expired windows in place (no new array) and sum counts in the same pass.
        let writeIdx = 0;
        let estimate = 0;
        for (let i = 0; i < d.activeWindows.length; i += 1) {
            const entry = d.activeWindows[i];
            if (entry.expiresAt > this.time) {
                d.activeWindows[writeIdx] = entry;
                writeIdx += 1;
                estimate += entry.count;
            }
        }
        d.activeWindows.length = writeIdx;
        d.activeEstimate = estimate;
        this.gasSwirl.visible = d.activeEstimate > 0;
        if (this.gasSwirl.visible) {
            this.gasSwirl.geometry.setDrawRange(0, Math.max(1, d.highWaterMark));
        } else {
            this.gasSwirl.geometry.setDrawRange(0, 0);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Void Sparks - Explosive silver/gray burst from planet surface outward
    // Creates a pool of particle systems to allow overlapping bursts
    // ─────────────────────────────────────────────────────────────────────────

    createVoidSparks() {
        if (this.sparkCompute) {
            this.sparkCompute.dispose();
            this.sparkCompute = null;
        }
        this.voidSparks = [];
        this.voidSparkIndex = 0;

        const planetRadius = 180; // Start at planet surface

        // Color palette for void sparks - silver/gray noir aesthetic
        const colorOptions = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xe0e0e8), // Light silver
            new THREE.Color(0xc0c0c8), // Medium silver
            new THREE.Color(0xa0a0b0), // Gray silver
            new THREE.Color(0x9090a0), // Darker silver
        ];

        const canUseSparkCompute = Boolean(
            this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute,
        );

        if (canUseSparkCompute) {
            const configuredComputeCount = Number.isFinite(this.qualityPreset.computeSparkCount)
                ? this.qualityPreset.computeSparkCount
                : null;
            const sparkCount = Math.min(
                50000,
                Math.max(configuredComputeCount ?? this.qualityPreset.voidSparks * 2, 12000),
            );

            try {
                this.sparkCompute = new CosmicNoirSparkCompute(sparkCount, {
                    randomFn: () => this.rand(),
                    planetRadius,
                    colorPalette: colorOptions,
                });
                this.sparkCompute.createComputeNode();

                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute(
                    'position',
                    new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3),
                );

                const { material, uniforms } = createVoidSparkNodeMaterial({
                    isWebGPU: this.isWebGPU,
                    sparkCompute: this.sparkCompute,
                });

                const sparks = new THREE.Points(geometry, material);
                sparks.userData = {
                    ...(sparks.userData || {}),
                    uniforms,
                    computeBacked: true,
                    sparkCount,
                };
                // Start hidden with an empty draw range; the animate loop reveals the
                // points only while a burst is alive (idle-gate, see animate()).
                sparks.visible = false;
                geometry.setDrawRange(0, 0);
                this.computeSparkPoints = sparks;
                this.planetGroup.add(sparks);
                this.voidSparks.push(sparks);

                console.log(
                    '[CosmicNoir] Void spark compute system created with',
                    sparkCount,
                    'particles in one draw call',
                );
                return;
            } catch (error) {
                console.warn(
                    '[CosmicNoir] Spark compute init failed, using pooled fallback:',
                    error,
                );
                if (this.sparkCompute) {
                    this.sparkCompute.dispose();
                    this.sparkCompute = null;
                }
            }
        }

        const sparkCount = Math.min(
            48000,
            Math.max(Math.floor(this.qualityPreset.voidSparks * 2), 8000),
        );
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(sparkCount * 3);
        const velocities = new Float32Array(sparkCount * 4);
        const births = new Float32Array(sparkCount);
        const lifetimes = new Float32Array(sparkCount);
        const colors = new Float32Array(sparkCount * 3);
        const sizes = new Float32Array(sparkCount);

        for (let i = 0; i < sparkCount; i += 1) {
            births[i] = -1000;
            lifetimes[i] = 1;
            sizes[i] = 38 + this.rand() * 44;
            const color = colorOptions[i % colorOptions.length];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        const positionAttr = new THREE.BufferAttribute(positions, 3);
        const velocityAttr = new THREE.BufferAttribute(velocities, 4);
        const birthAttr = new THREE.BufferAttribute(births, 1);
        const lifeAttr = new THREE.BufferAttribute(lifetimes, 1);
        const colorAttr = new THREE.BufferAttribute(colors, 3);
        const sizeAttr = new THREE.BufferAttribute(sizes, 1);
        [
            positionAttr,
            velocityAttr,
            birthAttr,
            lifeAttr,
            colorAttr,
            sizeAttr,
        ].forEach((attribute) => attribute.setUsage(THREE.DynamicDrawUsage));

        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('aVelocity', velocityAttr);
        geometry.setAttribute('aBirth', birthAttr);
        geometry.setAttribute('aLife', lifeAttr);
        geometry.setAttribute('aColor', colorAttr);
        geometry.setAttribute('aSize', sizeAttr);
        geometry.setDrawRange(0, 0);

        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            ({ material, uniforms } = createUnifiedVoidSparkNodeMaterial());
            if (this.flags.useMRT && !this.applyMrtPatchToMaterial(material)) {
                this.disableMrtRuntime('unified-void-spark-not-mrt-compatible');
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                },
                vertexShader: voidSparkVertexShader,
                fragmentShader: voidSparkFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            ({ uniforms } = material);
        }

        const sparks = new THREE.Points(geometry, material);
        sparks.userData = {
            uniforms,
            unifiedFallback: true,
        };
        sparks.visible = false;
        this.planetGroup.add(sparks);
        this.voidSparks.push(sparks);
        this.unifiedSparkData = {
            count: sparkCount,
            planetRadius,
            positions,
            velocities,
            births,
            lifetimes,
            colors,
            sizes,
            nextIndex: 0,
            highWaterMark: 0,
            activeWindows: [],
            activeEstimate: 0,
            colorOptions,
        };

        console.log('[CosmicNoir] Unified void spark fallback created with', sparkCount, 'particles in one draw call');
    }

    triggerUnifiedVoidSparkBurst(comboCount, burstIndex = 0, intensity = 1.0) {
        if (!this.unifiedSparkData || !this.voidSparks.length) return;

        const d = this.unifiedSparkData;
        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.75, 2.25);
        const normalizedIntensity = (clampedIntensity - 0.75) / 1.5;
        const minBatch = Math.max(700, Math.floor(d.count * 0.06));
        const maxBatch = Math.max(minBatch, Math.floor(d.count * 0.22));
        const baseBatch = Math.floor(minBatch + (maxBatch - minBatch) * normalizedIntensity);
        const targetBatch = Math.min(
            d.count,
            this.scaleTransientCount(baseBatch, 'sparkScale', Math.min(600, baseBatch)),
        );
        if (targetBatch <= 0) return;

        const startIndex = d.nextIndex;
        const visualCompensation = THREE.MathUtils.clamp(
            1 / Math.sqrt(this.getAdaptiveScale('sparkScale', 1.0)),
            1.0,
            1.3,
        );
        let maxExpiresAt = this.time;

        for (let i = 0; i < targetBatch; i += 1) {
            const index = (startIndex + i) % d.count;
            const i3 = index * 3;
            const i4 = index * 4;

            const theta = this.rand() * Math.PI * 2;
            const cosPhi = 2 * this.rand() - 1;
            const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
            const radialX = sinPhi * Math.cos(theta);
            const radialY = sinPhi * Math.sin(theta);
            const radialZ = cosPhi;

            const spreadX = (this.rand() - 0.5) * 0.45;
            const spreadY = (this.rand() - 0.5) * 0.45;
            const spreadZ = (this.rand() - 0.5) * 0.45;
            let burstX = radialX + spreadX;
            let burstY = radialY + spreadY;
            let burstZ = radialZ + spreadZ;
            const invLen = 1 / Math.max(1e-5, Math.hypot(burstX, burstY, burstZ));
            burstX *= invLen;
            burstY *= invLen;
            burstZ *= invLen;

            const localIntensity = clampedIntensity * (0.88 + this.rand() * 0.24);
            const speed = (34 + this.rand() * 28) * localIntensity;

            d.positions[i3] = radialX * d.planetRadius;
            d.positions[i3 + 1] = radialY * d.planetRadius;
            d.positions[i3 + 2] = radialZ * d.planetRadius;
            d.velocities[i4] = burstX * speed;
            d.velocities[i4 + 1] = burstY * speed;
            d.velocities[i4 + 2] = burstZ * speed;
            d.velocities[i4 + 3] = localIntensity;

            const birthTime = this.time + this.rand() * 0.7 + burstIndex * 0.03;
            const life = 3.1 + this.rand() * 1.9;
            d.births[index] = birthTime;
            d.lifetimes[index] = life;
            d.sizes[index] = (38 + this.rand() * 44) * visualCompensation;

            const paletteRoll = this.rand();
            let colorIndex = 0;
            if (paletteRoll <= 0.5) colorIndex = 0;
            else if (paletteRoll <= 0.7) colorIndex = 1;
            else if (paletteRoll <= 0.85) colorIndex = 2;
            else if (paletteRoll <= 0.95) colorIndex = 3;
            else colorIndex = 4;
            const color = d.colorOptions[colorIndex] || d.colorOptions[0];
            d.colors[i3] = color.r;
            d.colors[i3 + 1] = color.g;
            d.colors[i3 + 2] = color.b;
            maxExpiresAt = Math.max(maxExpiresAt, birthTime + life);
        }

        d.nextIndex = (startIndex + targetBatch) % d.count;
        d.highWaterMark = Math.max(d.highWaterMark, startIndex + Math.min(targetBatch, d.count - startIndex));
        if (startIndex + targetBatch > d.count) {
            d.highWaterMark = d.count;
        }
        d.activeWindows.push({ count: targetBatch, expiresAt: maxExpiresAt });

        const sparkSystem = this.voidSparks.find((entry) => entry?.userData?.unifiedFallback);
        const geometry = sparkSystem?.geometry;
        const firstCount = Math.min(targetBatch, d.count - startIndex);
        const secondCount = targetBatch - firstCount;
        this.markGeometryAttributeRange(geometry, startIndex, firstCount, [
            'position',
            'aVelocity',
            'aBirth',
            'aLife',
            'aColor',
            'aSize',
        ]);
        if (secondCount > 0) {
            this.markGeometryAttributeRange(geometry, 0, secondCount, [
                'position',
                'aVelocity',
                'aBirth',
                'aLife',
                'aColor',
                'aSize',
            ]);
        }
        if (sparkSystem) {
            sparkSystem.visible = true;
            sparkSystem.geometry.setDrawRange(0, Math.max(1, d.highWaterMark));
        }
    }

    updateUnifiedVoidSparks() {
        if (!this.unifiedSparkData) return;
        const sparkSystem = this.voidSparks.find((entry) => entry?.userData?.unifiedFallback);
        if (!sparkSystem) return;

        const uniforms = sparkSystem.userData?.uniforms || sparkSystem.material?.uniforms;
        if (uniforms?.time) {
            uniforms.time.value = this.time;
        }

        const d = this.unifiedSparkData;
        d.activeWindows = d.activeWindows.filter((entry) => entry.expiresAt > this.time);
        d.activeEstimate = d.activeWindows.reduce((sum, entry) => sum + entry.count, 0);
        sparkSystem.visible = d.activeEstimate > 0;
        if (sparkSystem.visible) {
            sparkSystem.geometry.setDrawRange(0, Math.max(1, d.highWaterMark));
        } else {
            sparkSystem.geometry.setDrawRange(0, 0);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        this.disposePostProcessingStack();

        if (this.flags.noPost || !this.qualityPreset.enablePostProcessing) {
            console.log('[CosmicNoir] Post-processing disabled for quality level');
            this.flags.usePost = false;
            this.flags.useMRT = false;
            return;
        }

        if (this.isWebGPU) {
            if (!this.flags.usePost) {
                this.flags.useMRT = false;
                return;
            }

            const width = window.innerWidth;
            const height = window.innerHeight;
            const adaptivePost = this.getAdaptivePostParams();

            try {
                this.postProcessing = new CosmicNoirPost(
                    this.renderer,
                    this.scene,
                    this.camera,
                    {
                        useMRT: this.flags.useMRT,
                        bloomStrength: this.flags.useMRT
                            ? this.qualityPreset.bloomStrength
                            : this.qualityPreset.bloomStrength * 0.42,
                        bloomRadius: this.qualityPreset.bloomRadius,
                        bloomThreshold: this.flags.useMRT ? 0.0 : 0.88,
                        bloomDownsample: adaptivePost.bloomDownsample,
                        resolutionScale: adaptivePost.resolutionScale,
                        chromaticEnabled: adaptivePost.chromaticEnabled,
                        chromaticStrength: this.flags.useMRT ? 0.004 : 0.0022,
                        lensingStrength: adaptivePost.lensingStrength,
                        vignetteOffset: 1.2,
                        vignetteDarkness: this.flags.useMRT ? 0.82 : 0.86,
                        exposure: this.flags.useMRT ? 1.0 : 1.04,
                        contrast: this.flags.useMRT ? 1.05 : 1.04,
                        saturation: this.flags.useMRT ? 0.96 : 1.0,
                        blackFloor: this.flags.useMRT ? 0.06 : 0.0,
                        ditherStrength: 0.003,
                    },
                );
                this.postProcessing.setSize(width, height);
                console.log(`[CosmicNoir] WebGPU PostProcessing ready (MRT: ${this.flags.useMRT})`);
            } catch (error) {
                console.warn('[CosmicNoir] WebGPU PostProcessing failed:', error.message);
                this.postProcessing = null;
                this.flags.usePost = false;
                this.flags.useMRT = false;
            }
            return;
        }

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.15,
        );
        this.composer.addPass(this.bloomPass);

        // Chromatic Aberration for cinematic effect
        const chromaticPass = new ShaderPass(ChromaticAberrationShader);
        chromaticPass.uniforms.uIntensity.value = this.getAdaptivePostParams().chromaticEnabled
            ? 0.004
            : 0.0;
        this.composer.addPass(chromaticPass);
        this.chromaticPass = chromaticPass;

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[CosmicNoir] Post-processing configured (with chromatic aberration)');
    }

    disablePostRuntime(reason = 'runtime-post-disable', error = null) {
        const wasUsingMrt = this.flags.useMRT === true;
        console.warn(`[CosmicNoir] Disabling WebGPU post path (${reason})`, error || '');

        if (this.postProcessing?.dispose) {
            try {
                this.postProcessing.dispose();
            } catch (disposeError) {
                console.warn('[CosmicNoir] postProcessing dispose failed during runtime disable:', disposeError);
            }
        }

        this.postProcessing = null;
        this.flags.noPost = true;
        this.flags.usePost = false;
        this.flags.useMRT = false;

        if (wasUsingMrt) {
            this.clearSceneMrtNodes();
        }

        this.configureRendererColorPipeline();
    }

    async requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.renderFallbackInProgress || !this.isActive || !this.isWebGPU) return;

        this.renderFallbackInProgress = true;
        console.warn(`[CosmicNoir] Switching to WebGL fallback (${reason})`, error || '');

        try {
            this.flags.forceWebGL = true;
            this.flags.noCompute = true;
            this.flags.noMRT = true;
            await this.createScene();
            console.log('[CosmicNoir] Recovery complete: running on WebGL fallback.');
        } catch (fallbackError) {
            console.error('[CosmicNoir] Runtime fallback failed:', fallbackError);
            this.isActive = false;
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        this.cancelAnimationLoop();
        this.clock.start();
        this.animate();
    }

    animate() {
        if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;

        this.animationFrameId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(this.animationFrameId);

        if (!this.shouldRenderFrame()) return;

        const frameStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const measuredDelta = this.clock.getDelta();
        const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : measuredDelta;
        const delta = this.fixedDeltaSeconds !== null ? rawDelta : Math.min(rawDelta, 0.05);
        if (this.fixedDeltaSeconds !== null) {
            this.fixedElapsed += this.fixedDeltaSeconds;
            this.time = this.fixedElapsed;
        } else {
            this.time += delta;
        }
        this.runDeterministicDeferredTimeouts();
        this.updateReactiveEnvelope(delta);
        const idlePlanetPulse = 0.2;
        this.planetPulseIntensity = Math.max(
            this.planetPulseIntensity,
            this.reactiveEnvelope.pulse,
            idlePlanetPulse,
        );
        this.starEventBoost = Math.max(this.starEventBoost, this.reactiveEnvelope.star * 2.0);
        this.gasExplosionIntensity = Math.max(
            this.gasExplosionIntensity,
            this.reactiveEnvelope.atmosphere * 1.2,
        );

        // Update shader uniforms
        if (this.planet && this.planetUniforms) {
            if (this.planetUniforms.uTime) {
                this.planetUniforms.uTime.value = this.time;
            }
            if (this.planetUniforms.uPulseIntensity) {
                this.planetUniforms.uPulseIntensity.value = this.planetPulseIntensity;
            }
            if (this.planetUniforms.uGlowIntensity) {
                this.planetUniforms.uGlowIntensity.value = this.planetGlowIntensity;
            }

            // Spin planet around own axis
            this.planet.rotation.y += delta * 0.05; // Slow, majestic rotation
        }

        if (this.accretionDisk && this.accretionDiskUniforms) {
            if (this.accretionDiskUniforms.uTime) {
                this.accretionDiskUniforms.uTime.value = this.time;
            }
            if (this.accretionDiskUniforms.uPulseIntensity) {
                this.accretionDiskUniforms.uPulseIntensity.value = this.planetPulseIntensity;
            }
        }

        if (this.starfield && Array.isArray(this.starfieldUniforms)) {
            for (let i = 0; i < this.starfieldUniforms.length; i += 1) {
                const uniforms = this.starfieldUniforms[i];
                if (!uniforms) continue;
                if (uniforms.uTime) {
                    uniforms.uTime.value = this.time;
                }
                if (uniforms.uEventBoost) {
                    uniforms.uEventBoost.value = this.starEventBoost;
                }
            }
        }

        if (this.ambientDust && this.ambientDustUniforms) {
            if (this.ambientDustUniforms.uTime) {
                this.ambientDustUniforms.uTime.value = this.time;
            }
            if (this.ambientDustUniforms.uPulse) {
                this.ambientDustUniforms.uPulse.value = this.reactiveEnvelope.pulse;
            }
        }

        // Update atmosphere shader
        if (this.atmosphere && this.atmosphereUniforms) {
            if (this.atmosphereUniforms.uTime) {
                this.atmosphereUniforms.uTime.value = this.time;
            }
            if (this.atmosphereUniforms.uPulseIntensity) {
                this.atmosphereUniforms.uPulseIntensity.value = this.planetPulseIntensity;
            }

            // Update gas explosion timer
            if (this.gasExplosionTimer > -5.0) {
                this.gasExplosionTimer += delta;
                if (this.atmosphereUniforms.uExplosionTimer) {
                    this.atmosphereUniforms.uExplosionTimer.value = this.gasExplosionTimer;
                }
                if (this.atmosphereUniforms.uExplosionIntensity) {
                    this.atmosphereUniforms.uExplosionIntensity.value = this.gasExplosionIntensity;
                }

                // Reset after explosion completes
                if (this.gasExplosionTimer > 5.0) {
                    this.gasExplosionTimer = -10.0;
                    this.gasExplosionIntensity = 0;
                }
            }
        }

        if (this.atmosphereInner && this.atmosphereInnerUniforms) {
            if (this.atmosphereInnerUniforms.uTime) {
                this.atmosphereInnerUniforms.uTime.value = this.time * 0.72;
            }
            if (this.atmosphereInnerUniforms.uPulseIntensity) {
                this.atmosphereInnerUniforms.uPulseIntensity.value = this.planetPulseIntensity * 0.75;
            }
            if (this.atmosphereInnerUniforms.uExplosionTimer) {
                this.atmosphereInnerUniforms.uExplosionTimer.value = this.gasExplosionTimer;
            }
            if (this.atmosphereInnerUniforms.uExplosionIntensity) {
                this.atmosphereInnerUniforms.uExplosionIntensity.value = this.gasExplosionIntensity * 0.72;
            }
        }

        if (
            this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute
            && this.sparkCompute?.computeNode
        ) {
            // Idle-gate: only dispatch the spark compute and draw the points while a
            // burst's particles are still alive. No spark is visible when idle, so
            // skipping the dispatch + draw is pixel-identical and reclaims the full
            // particle count in compute + vertex work every idle frame.
            const sparksActive = this.time <= this.sparkCompute.lastActiveUntil;
            const sparkPoints = this.computeSparkPoints;
            if (sparksActive) {
                this.sparkCompute.update(delta, this.time);
                this.renderer.compute(this.sparkCompute.computeNode);
                if (sparkPoints && !sparkPoints.visible) {
                    sparkPoints.visible = true;
                    sparkPoints.geometry.setDrawRange(
                        0,
                        sparkPoints.userData?.sparkCount ?? this.sparkCompute.count,
                    );
                }
            } else if (sparkPoints && sparkPoints.visible) {
                sparkPoints.visible = false;
                sparkPoints.geometry.setDrawRange(0, 0);
            }
        }

        this.updateUnifiedVoidSparks();

        // Update compute-backed or legacy void spark systems.
        for (const sparks of this.voidSparks) {
            const sparkUniforms = sparks?.userData?.uniforms || sparks?.material?.uniforms;
            if (sparks && sparkUniforms) {
                if (sparkUniforms.time) {
                    sparkUniforms.time.value = this.time;
                }

                if (
                    sparks?.userData?.computeBacked
                    || sparks?.userData?.unifiedFallback
                    || this.sparkCompute?.computeNode
                ) {
                    continue;
                }

                // Update pulse wave
                if (sparkUniforms.uPulseTimer?.value > -50.0) {
                    sparks.visible = true;
                    // Move wave outwards - speed increased for more explosive look
                    sparkUniforms.uPulseTimer.value += delta * 18.0;

                    // Turn off when wave completes
                    if (sparkUniforms.uPulseTimer.value > 85.0) {
                        sparkUniforms.uPulseTimer.value = -100.0;
                        sparks.visible = false;
                    }
                } else {
                    sparks.visible = false;
                }
            }
        }

        // Update gas shell swirl particles
        this.updateGasSwirlParticles(delta);

        // Slow drift planet across entire screen (Lissajous curves for organic movement)
        // `sinWithHalfAngle = sin(x + 0.5)` equivalent tricks aren't worth it here -
        // each sin/cos is independent and cheap; the only win is hoisting the scaled-time constants.
        if (this.planetGroup) {
            const t = this.time;
            const driftX = Math.sin(t * 0.025 + this.planetPhaseX) * 550
                + Math.cos(t * 0.018 + this.planetPhaseX2) * 250;
            const driftY = Math.cos(t * 0.02 + this.planetPhaseY) * 350
                + Math.sin(t * 0.012 + this.planetPhaseY2) * 150;

            this.planetGroup.position.x = driftX;
            this.planetGroup.position.y = driftY;

            // Gentle rotation
            this.planetGroup.rotation.z = Math.sin(t * 0.008) * 0.04;
        }

        // Slow camera orbit for parallax depth (independent of planet)
        if (this.camera) {
            const cameraTime = this.time * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 420; // Tighter horizontal sway
            const orbitRadiusY = 320; // Tighter vertical sway

            // Precompute shared scaled-time terms so each sin/cos has a hoisted argument.
            const ct05 = cameraTime * 0.5;
            const ct07 = cameraTime * 0.7;
            const ct08 = cameraTime * 0.8;
            const ct018 = cameraTime * 0.18;

            // Orbital sway - creates parallax with starfield/nebula
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX
                + Math.cos(ct07) * orbitRadiusX * 0.4;
            this.camera.position.y = Math.cos(ct08) * orbitRadiusY
                + Math.sin(ct05) * orbitRadiusY * 0.3;

            // Deep z-breathing: sweeping from far out to EXTREMELY close
            // Base 800, primary ±600 -> Min theoretically 200 (inside atmosphere)
            this.camera.position.z = 800
                + Math.sin(ct05) * 600
                + Math.sin(ct018 + 1.2) * 200;

            // Safety clamp: Prevent clipping into planet (radius 240)
            // Surface skim distance: ~280
            if (this.camera.position.length() < 280) {
                this.camera.position.setLength(280);
            }

            // Smooth pointer tracking (frame-rate independent damping)
            this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, measuredDelta * 2.2);
            this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, measuredDelta * 2.2);

            const parallaxX = this.smoothedPointerX * 120.0;
            const parallaxY = -this.smoothedPointerY * 60.0;

            // Apply mouse parallax after the safety clamp so it always perturbs the camera
            this.camera.position.x += parallaxX;
            this.camera.position.y += parallaxY;

            // LookAt drift for dynamic framing (also nudged by mouse at 0.4x).
            // Reuse `ct05` from the y-orbit above - same scaled time.
            const lookOffsetX = Math.sin(cameraTime * 0.4) * 150 + parallaxX * 0.4;
            const lookOffsetY = Math.cos(ct05) * 100 + parallaxY * 0.4;

            if (this.reactiveEnvelope.shake > 0) {
                const shakeAmplitude = this.reactiveEnvelope.shake * 3.0;
                this.camera.position.x += (this.rand() - 0.5) * shakeAmplitude;
                this.camera.position.y += (this.rand() - 0.5) * shakeAmplitude;
            }

            this.camera.lookAt(lookOffsetX, lookOffsetY, 0);
        }

        if (
            this.comboLensFlare
            && this.camera
            && (this.comboLensFlareIntensity > 0.001 || this.comboLensFlare.visible)
        ) {
            this.camera.getWorldDirection(this.tempCameraForward);
            this.comboLensFlare.position
                .copy(this.camera.position)
                .add(this.tempCameraForward.multiplyScalar(900));
            this.comboLensFlare.quaternion.copy(this.camera.quaternion);

            const flarePulse = 1.0 + Math.sin(this.time * 18.0) * 0.08;
            const flareOpacity = this.comboLensFlareIntensity * 0.42 * flarePulse;
            this.comboLensFlare.visible = flareOpacity > 0.001;
            if (this.comboLensFlareUniforms?.uOpacity) {
                this.comboLensFlareUniforms.uOpacity.value = flareOpacity;
            } else if (this.comboLensFlare.material) {
                this.comboLensFlare.material.opacity = flareOpacity;
            }

            const widthScale = 1.0 + this.comboLensFlareIntensity * 0.75;
            const heightScale = 1.0 + this.comboLensFlareIntensity * 0.2;
            this.comboLensFlare.scale.set(widthScale, heightScale, 1.0);
        }

        if (
            this.comboFlash
            && this.camera
            && (this.comboFlashIntensity > 0.001 || this.comboFlash.visible)
        ) {
            const flashPulse = 1.0 + Math.sin(this.time * 24.0) * 0.06;
            const flashOpacity = this.comboFlashIntensity * 0.75 * flashPulse;
            this.comboFlash.visible = flashOpacity > 0.001;
            if (this.comboFlashUniforms?.uOpacity) {
                this.comboFlashUniforms.uOpacity.value = flashOpacity;
            } else if (this.comboFlash.material) {
                this.comboFlash.material.opacity = flashOpacity;
            }
            const flashScale = 1.0 + this.comboFlashIntensity * 0.65;
            this.comboFlash.scale.setScalar(flashScale);
            this.comboFlash.lookAt(this.camera.position);
        }

        // Pulse glow layers with planet pulse intensity
        const glowPulse = Math.sin(this.time * 1.5) * 0.12 + 1.0;
        for (const glow of this.planetGlowLayers) {
            const pulse = (1 + this.planetPulseIntensity * 0.4) * glowPulse;
            const glowOpacity = glow.userData.baseOpacity * pulse;
            const glowUniforms = glow.userData?.uniforms || glow.material?.uniforms;
            if (glowUniforms?.uOpacity) {
                glowUniforms.uOpacity.value = glowOpacity;
            } else if (glow.material) {
                glow.material.opacity = glowOpacity;
            }
        }

        // Nebula drift and pulse
        // Nebula drift and pulse (synced with camera for seamless coverage)
        for (const cloud of this.nebulaClouds) {
            // Move nebulas with camera so they always cover the view
            // Plus gentle drift for atmosphere
            const driftRange = cloud.userData.driftRange ?? 6000;
            cloud.userData.driftOffset = (cloud.userData.driftOffset || 0) + cloud.userData.driftSpeed * 50;
            if (cloud.userData.driftOffset > driftRange) cloud.userData.driftOffset = -driftRange;

            // Sync base position with camera, add drift offset
            const parallaxX = cloud.userData.parallaxX ?? 0.3;
            const parallaxY = cloud.userData.parallaxY ?? 0.2;
            cloud.position.x = (this.camera?.position.x || 0) * parallaxX + cloud.userData.driftOffset;
            cloud.position.y = (this.camera?.position.y || 0) * parallaxY;
            cloud.rotation.z += (cloud.userData.rotationSpeed ?? 0) * delta;

            cloud.userData.pulsePhase += 0.005;
            // Pulse: -1 to 1 for subtle breathing
            const pulse = Math.sin(cloud.userData.pulsePhase);

            const nebulaUniforms = cloud.userData?.uniforms || cloud.material?.uniforms;
            if (nebulaUniforms?.uPulse) {
                nebulaUniforms.uPulse.value = pulse + (this.planetPulseIntensity * 2.0); // React to gameplay
            }
            if (nebulaUniforms?.uTime) {
                nebulaUniforms.uTime.value = this.time;
            }
        }

        // Starfield depth layers with independent parallax and drift.
        if (this.starfield && this.camera) {
            const camPos = this.camera.position;
            for (let i = 0; i < this.starfieldLayers.length; i += 1) {
                const layer = this.starfieldLayers[i];
                const parallax = layer.userData?.parallax ?? 1.0;
                const spinY = layer.userData?.spinY ?? 0.003;
                const spinZ = layer.userData?.spinZ ?? 0.001;
                layer.position.set(
                    camPos.x * parallax,
                    camPos.y * parallax,
                    camPos.z * parallax,
                );
                layer.rotation.y = this.time * spinY;
                layer.rotation.z = this.time * spinZ;
            }
        }

        if (this.ambientDust && this.camera) {
            const dustParallax = this.ambientDust.userData?.parallax ?? 0.09;
            this.ambientDust.position.set(
                this.camera.position.x * dustParallax,
                this.camera.position.y * dustParallax,
                this.camera.position.z * dustParallax - 400,
            );
        }

        // Decay pulse intensity
        if (this.planetPulseIntensity > 0) {
            this.planetPulseIntensity *= 0.94;
            if (this.planetPulseIntensity < 0.01) this.planetPulseIntensity = 0;
        }

        if (this.starEventBoost > 0) {
            this.starEventBoost *= 0.92; // Fast decay for quick flash
            if (this.starEventBoost < 0.01) this.starEventBoost = 0;
        }

        if (this.comboFlashIntensity > 0) {
            this.comboFlashIntensity *= Math.max(0.0, 1.0 - delta * 7.0);
            if (this.comboFlashIntensity < 0.01) this.comboFlashIntensity = 0;
        }

        if (this.comboLensFlareIntensity > 0) {
            this.comboLensFlareIntensity *= Math.max(0.0, 1.0 - delta * 4.8);
            if (this.comboLensFlareIntensity < 0.01) this.comboLensFlareIntensity = 0;
        }

        // Update cosmic waves
        this.updateCosmicWaves(delta);

        if (this.isWebGPU && this.flags.usePost && this.postProcessing?.update) {
            this.tempBhScreenPos.set(0.5, 0.5);
            if (this.planetGroup && this.camera) {
                this.planetGroup.getWorldPosition(this.tempScreenVector);
                this.tempScreenVector.project(this.camera);
                this.tempBhScreenPos.set(
                    this.tempScreenVector.x * 0.5 + 0.5,
                    this.tempScreenVector.y * 0.5 + 0.5,
                );
            }

            const reactiveBloomBoost = Math.min(
                this.flags.useMRT ? 0.6 : 0.28,
                this.planetPulseIntensity * 0.32
                + this.gasExplosionIntensity * 0.28
                + this.starEventBoost * 0.07
                + this.reactiveEnvelope.bloom * 0.45,
            );
            const bloomBaseStrength = this.flags.useMRT
                ? this.qualityPreset.bloomStrength
                : this.qualityPreset.bloomStrength * 0.42;
            const adaptivePost = this.getAdaptivePostParams();
            // Fill the reusable payload object instead of allocating a fresh literal every frame.
            const payload = this._postUpdatePayload;
            payload.bhScreenPos = this.tempBhScreenPos;
            payload.bloomStrength = bloomBaseStrength * (1.0 + reactiveBloomBoost);
            payload.bloomRadius = this.qualityPreset.bloomRadius;
            payload.bloomThreshold = this.flags.useMRT ? 0.0 : 0.88;
            payload.chromaticStrength = (this.flags.useMRT ? 0.004 : 0.0022) + reactiveBloomBoost * 0.0012;
            payload.chromaticEnabled = adaptivePost.chromaticEnabled;
            payload.lensingStrength = adaptivePost.lensingStrength;
            payload.resolutionScale = adaptivePost.resolutionScale;
            payload.bloomDownsample = adaptivePost.bloomDownsample;
            payload.vignetteDarkness = (this.flags.useMRT ? 0.82 : 0.86) - reactiveBloomBoost * 0.03;
            this.postProcessing.update(payload);
        } else if (this.bloomPass) {
            const fallbackBloomBoost = Math.min(
                0.65,
                this.planetPulseIntensity * 0.3
                + this.gasExplosionIntensity * 0.25
                + this.reactiveEnvelope.bloom * 0.45,
            );
            const adaptivePost = this.getAdaptivePostParams();
            this.bloomPass.strength = this.qualityPreset.bloomStrength * (1.0 + fallbackBloomBoost);
            if (this.chromaticPass?.uniforms?.uIntensity) {
                this.chromaticPass.uniforms.uIntensity.value = adaptivePost.chromaticEnabled
                    ? 0.004 + fallbackBloomBoost * 0.0012
                    : 0.0;
            }
        }

        this.renderFrame();

        const frameEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const frameMs = frameEndMs - frameStartMs;
        this.updateAdaptiveBudgetState(frameMs);
        this.applyAdaptiveBudgetState();
        // Record the REAL frame interval (rAF delta), not the CPU dispatch span, so the baseline
        // report's FPS reflects actual presented frame rate. (The adaptive controller still uses the
        // dispatch span — driving it off the vsync-capped real interval would falsely shed quality on
        // displays whose refresh is below the target FPS.) Clamp stall spikes out of the stats.
        const realFrameMs = Math.min(measuredDelta * 1000, 100);
        this.recordBaselineSample(realFrameMs);
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderer.clear();

        if (this.isWebGPU) {
            if (this.postProcessing && this.flags.usePost) {
                try {
                    this.postProcessing.render();
                    return;
                } catch (error) {
                    this.disablePostRuntime('webgpu-post-render-failure', error);
                }
            }

            try {
                this.renderer.render(this.scene, this.camera);
            } catch (error) {
                this.requestWebGLFallback('webgpu-render-failure', error);
            }
            return;
        }

        if (this.composer && this.qualityPreset.enablePostProcessing && !this.flags.noPost) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cosmic Waves - Expanding silver/gray torus rings
    // ─────────────────────────────────────────────────────────────────────────

    getCosmicWavePoolKey(options = {}) {
        const radius = options.radius ?? 30;
        const tube = options.tube ?? 2;
        const radialSegments = options.radialSegments ?? 8;
        const tubularSegments = options.tubularSegments ?? 48;
        let waveColor;
        if (options.color instanceof THREE.Color) {
            waveColor = options.color;
        } else {
            // Reuse the scratch Color to avoid allocating one per pool-key lookup.
            waveColor = this._wavePoolScratchColor;
            waveColor.set(options.color ?? 0x888888);
        }
        return [
            this.isWebGPU ? 'wgpu' : 'webgl',
            radius.toFixed(2),
            tube.toFixed(2),
            radialSegments,
            tubularSegments,
            waveColor.getHexString(),
        ].join(':');
    }

    acquireCosmicWave(options = {}) {
        const poolKey = this.getCosmicWavePoolKey(options);
        const pooledIndex = this.cosmicWavePool.findIndex((wave) => wave.userData?.poolKey === poolKey);
        if (pooledIndex >= 0) {
            const wave = this.cosmicWavePool.splice(pooledIndex, 1)[0];
            wave.visible = true;
            wave.scale.setScalar(1.0);
            if (!wave.parent) {
                this.planetGroup?.add(wave);
            }
            return wave;
        }

        const radius = options.radius ?? 30;
        const tube = options.tube ?? 2;
        const radialSegments = options.radialSegments ?? 8;
        const tubularSegments = options.tubularSegments ?? 48;
        const waveColor = options.color instanceof THREE.Color
            ? options.color
            : new THREE.Color(options.color ?? 0x888888);
        const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            ({ material, uniforms } = createCosmicWaveNodeMaterial({
                color: waveColor,
            }));
            if (uniforms.uTime) {
                uniforms.uTime.value = this.time;
            }
            if (this.flags.useMRT && !this.applyMrtPatchToMaterial(material)) {
                this.disableMrtRuntime(
                    'dynamic-cosmic-wave-not-mrt-compatible',
                    {
                        material: material?.name || material?.type || material?.constructor?.name || 'Unknown',
                    },
                );
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: this.time },
                    uOpacity: { value: 1.0 },
                    uColor: { value: waveColor },
                },
                vertexShader: waveVertexShader,
                fragmentShader: waveFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            ({ uniforms } = material);
        }

        const wave = new THREE.Mesh(geometry, material);
        wave.userData = {
            ...(wave.userData || {}),
            poolKey,
            uniforms,
        };
        this.planetGroup?.add(wave);
        return wave;
    }

    releaseCosmicWave(wave) {
        if (!wave) return;

        this.planetGroup?.remove(wave);
        wave.visible = false;
        wave.scale.setScalar(1.0);

        const waveUniforms = wave.userData?.uniforms || wave.material?.uniforms;
        if (waveUniforms?.uOpacity) {
            waveUniforms.uOpacity.value = 0.0;
        }

        if (this.cosmicWavePool.length >= 16) {
            wave.geometry?.dispose?.();
            wave.material?.dispose?.();
            return;
        }

        this.cosmicWavePool.push(wave);
    }

    disposeCosmicWavePool() {
        this.cosmicWavePool.forEach((wave) => {
            wave.geometry?.dispose?.();
            wave.material?.dispose?.();
        });
        this.cosmicWavePool = [];
    }

    disposeSharedNoiseTexture() {
        if (this.sharedNoiseTexture?.dispose) {
            try {
                this.sharedNoiseTexture.dispose();
            } catch (error) {
                console.warn('[CosmicNoir] sharedNoiseTexture dispose failed:', error);
            }
        }
        this.sharedNoiseTexture = null;
    }

    createCosmicWave(intensity, options = {}) {
        const radius = options.radius ?? 30;
        const tube = options.tube ?? 2;
        const radialSegments = options.radialSegments ?? 8;
        const tubularSegments = options.tubularSegments ?? 48;
        const waveColor = options.color ?? new THREE.Color(0x888888);
        const wave = this.acquireCosmicWave({
            radius,
            tube,
            radialSegments,
            tubularSegments,
            color: waveColor,
        });
        wave.rotation.x = this.rand() * Math.PI * 0.3;
        wave.rotation.y = this.rand() * Math.PI * 2;

        wave.userData = {
            ...(wave.userData || {}),
            speed: (70 + intensity * 18) * (options.speedMultiplier ?? 1.0),
            life: 1.0,
            maxLife: 1.0,
            lifeDecay: 0.7 / (options.lifeMultiplier ?? 1.0),
            uniforms: wave.userData?.uniforms || wave.material?.uniforms || null,
        };

        this.cosmicWaves.push(wave);
    }

    updateCosmicWaves(delta) {
        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];
            wave.scale.addScalar(wave.userData.speed * delta * 0.1);
            wave.userData.life -= delta * (wave.userData.lifeDecay ?? 0.7);

            const waveUniforms = wave.userData?.uniforms || wave.material?.uniforms;
            if (waveUniforms?.uOpacity) {
                waveUniforms.uOpacity.value = wave.userData.life;
            }
            if (waveUniforms?.uTime) {
                waveUniforms.uTime.value = this.time;
            }

            if (wave.userData.life <= 0) {
                this.releaseCosmicWave(wave);
                this.cosmicWaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Void Orbs - Glowing particles drifting outward
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────

    registerDeferredTimeout(callback, delayMs) {
        if (this.fixedDeltaSeconds !== null) {
            const normalizedDelayMs = Number.isFinite(delayMs) ? delayMs : 0;
            const timeoutToken = {
                __deterministicTimeout: true,
                triggerTime: this.time + Math.max(0, normalizedDelayMs) / 1000,
                callback,
            };
            this.deferredTimeouts.add(timeoutToken);
            return timeoutToken;
        }

        const normalizedDelayMs = Number.isFinite(delayMs) ? delayMs : 0;
        const timerId = setTimeout(() => {
            this.deferredTimeouts.delete(timerId);
            callback();
        }, normalizedDelayMs);
        this.deferredTimeouts.add(timerId);
        return timerId;
    }

    runDeterministicDeferredTimeouts() {
        if (this.fixedDeltaSeconds === null || this.deferredTimeouts.size === 0) return;

        const dueTokens = [];
        this.deferredTimeouts.forEach((entry) => {
            if (!entry || entry.__deterministicTimeout !== true) return;
            if (this.time >= entry.triggerTime) {
                dueTokens.push(entry);
            }
        });

        dueTokens.forEach((token) => {
            this.deferredTimeouts.delete(token);
            try {
                token.callback?.();
            } catch (error) {
                console.warn('[CosmicNoir] Deferred callback failed:', error);
            }
        });
    }

    clearDeferredTimeouts() {
        this.deferredTimeouts.forEach((entry) => {
            if (entry && entry.__deterministicTimeout === true) return;
            clearTimeout(entry);
        });
        this.deferredTimeouts.clear();
    }

    pushReactiveEnvelope(values = {}) {
        Object.entries(values).forEach(([key, value]) => {
            if (!(key in this.reactiveEnvelope)) return;
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return;
            this.reactiveEnvelope[key] = Math.min(
                (this.reactiveEnvelope[key] || 0) + numericValue,
                1.0,
            );
        });
    }

    updateReactiveEnvelope(delta) {
        const envelope = this.reactiveEnvelope;
        for (let i = 0; i < REACTIVE_ENVELOPE_KEYS.length; i += 1) {
            const key = REACTIVE_ENVELOPE_KEYS[i];
            const decay = Math.max(0.0, 1.0 - delta * REACTIVE_ENVELOPE_DECAY_RATES[key]);
            const next = envelope[key] * decay;
            envelope[key] = next < 0.01 ? 0 : next;
        }
    }

    setupEventListeners() {
        this.clearEventSubscriptions();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock();
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

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
    }

    handlePieceLock() {
        this.planetPulseIntensity = Math.min(this.planetPulseIntensity + 0.12, 0.45);
        this.starEventBoost = 2.0; // Strong flash on lock
        this.pushReactiveEnvelope({
            pulse: 0.12,
            star: 0.2,
        });
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
            this.pushReactiveEnvelope({
                pulse: Math.min(0.05 + comboCount * 0.05, 0.5),
                bloom: Math.min(0.04 + comboCount * 0.05, 0.55),
                spark: Math.min(0.05 + comboCount * 0.06, 0.6),
                atmosphere: Math.min(0.04 + comboCount * 0.05, 0.5),
                star: Math.min(0.05 + comboCount * 0.04, 0.45),
            });
        }
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    onLineClear(lineCount, comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 2.5);
        this.planetPulseIntensity = Math.min(0.5 + comboCount * 0.18, 1.3);
        if (comboCount >= 6) {
            this.comboFlashIntensity = Math.min(
                1.0,
                this.comboFlashIntensity + 0.45 + comboCount * 0.04,
            );
            this.comboLensFlareIntensity = Math.min(
                1.0,
                this.comboLensFlareIntensity + 0.3 + comboCount * 0.05,
            );
        }
        this.pushReactiveEnvelope({
            pulse: Math.min(0.15 + lineCount * 0.1 + comboCount * 0.08, 1.0),
            bloom: Math.min(0.05 + lineCount * 0.08 + comboCount * 0.06, 1.0),
            spark: Math.min(0.14 + comboCount * 0.12, 1.0),
            atmosphere: Math.min(0.12 + comboCount * 0.1, 1.0),
            star: Math.min(0.08 + comboCount * 0.06, 1.0),
            shake: comboCount >= 6 ? Math.min(0.2 + comboCount * 0.08, 1.0) : 0,
        });
        const usingSparkCompute = Boolean(
            this.isWebGPU
            && this.flags.useCompute
            && this.sparkCompute?.computeNode,
        );

        // === COMBO EFFECTS: Void Sparks + Gas Explosion ===
        if (comboCount >= 2 && (usingSparkCompute || this.voidSparks.length > 0)) {
            // Calculate how many burst pulses to trigger based on combo
            let burstsToTrigger = 1;
            if (comboCount >= 10) burstsToTrigger = 4;
            else if (comboCount >= 8) burstsToTrigger = 3;
            else if (comboCount >= 4) burstsToTrigger = 2;
            const extraTrailBursts = comboCount >= 6 ? 2 : 0;

            if (usingSparkCompute) {
                for (let s = 0; s < burstsToTrigger; s++) {
                    const triggerComputeBurst = () => {
                        if (this.sparkCompute?.computeNode) {
                            const sparkBoost = this.reactiveEnvelope.spark * 0.7;
                            const burstIntensity = Math.min(
                                1.0 + comboCount * 0.14 + s * 0.08 + sparkBoost,
                                2.25,
                            );
                            this.sparkCompute.triggerBurst(
                                this.time,
                                burstIntensity,
                                this.getAdaptiveScale('sparkScale', 1.0),
                            );
                        }
                    };

                    if (s === 0) {
                        triggerComputeBurst();
                    } else {
                        this.registerDeferredTimeout(triggerComputeBurst, s * 150);
                    }
                }

                for (let t = 0; t < extraTrailBursts; t++) {
                    this.registerDeferredTimeout(() => {
                        if (!this.sparkCompute?.computeNode) return;
                        const trailingIntensity = Math.min(
                            1.4 + comboCount * 0.05 + t * 0.08,
                            2.1,
                        );
                        this.sparkCompute.triggerBurst(
                            this.time,
                            trailingIntensity,
                            this.getAdaptiveScale('sparkScale', 1.0),
                        );
                    }, 320 + t * 140);
                }
            } else {
                for (let s = 0; s < burstsToTrigger; s++) {
                    const triggerFallbackBurst = () => {
                        const sparkBoost = this.reactiveEnvelope.spark * 0.7;
                        const burstIntensity = Math.min(
                            1.0 + comboCount * 0.14 + s * 0.08 + sparkBoost,
                            2.25,
                        );
                        this.triggerUnifiedVoidSparkBurst(comboCount, s, burstIntensity);
                    };

                    if (s === 0) {
                        triggerFallbackBurst();
                    } else {
                        this.registerDeferredTimeout(triggerFallbackBurst, s * 150);
                    }
                }

                for (let t = 0; t < extraTrailBursts; t++) {
                    this.registerDeferredTimeout(() => {
                        const trailingIntensity = Math.min(
                            1.4 + comboCount * 0.05 + t * 0.08,
                            2.1,
                        );
                        this.triggerUnifiedVoidSparkBurst(comboCount, t + burstsToTrigger, trailingIntensity);
                    }, 320 + t * 140);
                }
            }

            // Trigger gas explosion on atmosphere
            this.gasExplosionTimer = 0.0;
            this.gasExplosionIntensity = Math.min(0.5 + comboCount * 0.15, 1.2);

            // Trigger gas shell swirl particles
            this.triggerGasSwirlBurst(comboCount);
        }

        // Create cosmic waves
        const baseWaveCount = Math.min(lineCount + Math.floor(comboCount / 2), 4);
        const waveCount = this.scaleTransientCount(baseWaveCount, 'waveScale', Math.min(1, baseWaveCount));
        for (let i = 0; i < waveCount; i++) {
            this.registerDeferredTimeout(() => this.createCosmicWave(comboCount), i * 100);
        }

        if (comboCount >= 6) {
            const baseExtraShockwaves = Math.min(3, Math.floor(comboCount / 3));
            const extraShockwaves = this.scaleTransientCount(
                baseExtraShockwaves,
                'waveScale',
                Math.min(1, baseExtraShockwaves),
            );
            for (let i = 0; i < extraShockwaves; i += 1) {
                const tube = 1.2 + this.rand() * 2.2;
                const radius = 36 + i * 12 + this.rand() * 8;
                const speedMultiplier = 1.25 + i * 0.12;
                this.registerDeferredTimeout(() => {
                    this.createCosmicWave(comboCount, {
                        radius,
                        tube,
                        radialSegments: 10,
                        tubularSegments: 64,
                        speedMultiplier,
                        lifeMultiplier: 1.25,
                        color: this._comboShockwaveColor,
                    });
                }, 60 + i * 120);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────

    setupResizeHandler() {
        this.removeResizeListener();
        this.resizeHandler = () => this.onWindowResize();
        window.addEventListener('resize', this.resizeHandler);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.applyAdaptiveBudgetState(true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

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

    disposePostProcessingStack() {
        if (this.postProcessing?.dispose) {
            try {
                this.postProcessing.dispose();
            } catch (error) {
                console.warn('[CosmicNoir] postProcessing dispose failed:', error);
            }
        }
        this.postProcessing = null;

        if (this.composer?.dispose) {
            try {
                this.composer.dispose();
            } catch (error) {
                console.warn('[CosmicNoir] composer dispose failed:', error);
            }
        }
        this.composer = null;
        this.bloomPass = null;
        this.chromaticPass = null;
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
        this.scene.traverse((object) => {
            if (object.geometry?.dispose) {
                object.geometry.dispose();
            }

            if (!object.material) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                this.disposeMaterialTextures(material, disposedTextures);
                material?.dispose?.();
            });
        });
    }

    disposeComputeResources() {
        if (Array.isArray(this.starTwinkleComputes)) {
            this.starTwinkleComputes.forEach((compute) => {
                if (!compute?.dispose) return;
                try {
                    compute.dispose();
                } catch (error) {
                    console.warn('[CosmicNoir] starTwinkleCompute dispose failed:', error);
                }
            });
        } else if (this.starTwinkleCompute?.dispose) {
            try {
                this.starTwinkleCompute.dispose();
            } catch (error) {
                console.warn('[CosmicNoir] starTwinkleCompute dispose failed:', error);
            }
        }
        this.starTwinkleComputes = [];
        this.starTwinkleCompute = null;

        if (this.atmosphereFlowCompute?.dispose) {
            try {
                this.atmosphereFlowCompute.dispose();
            } catch (error) {
                console.warn('[CosmicNoir] atmosphereFlowCompute dispose failed:', error);
            }
        }
        this.atmosphereFlowCompute = null;

        if (this.sparkCompute?.dispose) {
            try {
                this.sparkCompute.dispose();
            } catch (error) {
                console.warn('[CosmicNoir] sparkCompute dispose failed:', error);
            }
        }
        this.sparkCompute = null;
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.renderer.onDeviceLost = null;
        const { domElement } = this.renderer;
        try {
            this.disposeRenderer(this.renderer, { nullInstance: false });
        } catch (error) {
            console.warn('[CosmicNoir] renderer dispose failed:', error);
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
        this.chromaticPass = null;
        this.planet = null;
        this.planetUniforms = null;
        this.planetGroup = null;
        this.starfield = null;
        this.starfieldLayers = [];
        this.starfieldUniforms = [];
        this.starTwinkleComputes = [];
        this.starTwinkleCompute = null;
        this.ambientDust = null;
        this.ambientDustUniforms = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.comboFlash = null;
        this.comboFlashUniforms = null;
        this.comboLensFlare = null;
        this.comboLensFlareUniforms = null;
        this.atmosphere = null;
        this.atmosphereUniforms = null;
        this.atmosphereInner = null;
        this.atmosphereInnerUniforms = null;
        this.atmosphereFlowCompute = null;
        this.cosmicWaves = [];
        this.cosmicWavePool = [];
        this.voidSparks = [];
        this.voidSparkIndex = 0;
        this.sparkCompute = null;
        this.computeSparkPoints = null;
        this.sharedNoiseTexture = null;
        this.gasSwirl = null;
        this.gasSwirlData = null;
        this.pendingComboCount = 0;
        this.planetPulseIntensity = 0;
        this.starEventBoost = 0;
        this.planetGlowIntensity = 1.0;
        this.comboMultiplier = 1.0;
        this.gasExplosionTimer = -10.0;
        this.gasExplosionIntensity = 0.0;
        this.comboFlashIntensity = 0.0;
        this.comboLensFlareIntensity = 0.0;
        this.reactiveEnvelope = {
            pulse: 0,
            bloom: 0,
            spark: 0,
            atmosphere: 0,
            star: 0,
            shake: 0,
        };
        this.time = 0;
        this.fixedElapsed = 0;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            isWebGPU: false,
            maxColorAttachments: 0,
            supportsCompute: false,
            supportsPost: false,
        };
        this.compileStats = {
            status: 'idle',
            durationMs: 0,
            message: null,
        };
        this.loggedMrtPlatformGuard = false;
        this.adaptiveBudgetState = null;
        this.baseRenderScale = 1.0;
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedPostResolutionScale = 1;
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposePostProcessingStack();
        this.disposeComputeResources();
        this.disposeCosmicWavePool();
        this.disposeSceneResources();
        this.disposeSharedNoiseTexture();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        console.error('[CosmicNoir] WebGPU device lost:', info);

        try {
            await this.requestWebGLFallback('device-loss', info);
        } catch (error) {
            console.error('[CosmicNoir] Device-loss recovery failed:', error);
            this.isActive = false;
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    stop() {
        this.cancelAnimationLoop();
        this.clock.stop();
        this.clearDeferredTimeouts();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.removeRendererResilience();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        super.stop();
    }
}
