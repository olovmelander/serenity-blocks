/**
 * Neon Dusk Theme - Three.js Masterpiece Edition
 *
 * A stunning 3D synthwave experience featuring:
 * - Gradient sky with twinkling neon stars
 * - Procedural FBM mountains with signature neon rim lighting
 * - Multi-layer glowing sun with drift animation
 * - Perspective synthwave grid with tetromino highlights
 * - Dynamic particle effects and hologram rings
 * - Post-processing bloom and VHS effects
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { NEON_DUSK_TETROMINOS } from './neon-dusk-tetrominos.js';
import {
    createGridNodeMaterial,
    createSunNodeMaterial,
    createSunGlowNodeMaterial,
    createMountainNodeMaterial,
    createHighlightNodeMaterial,
    createStarNodeMaterial,
    createParticleNodeMaterial,
    createRetroPixelNodeMaterial,
    createPixelTrailNodeMaterial,
    createRingNodeMaterial,
} from './neon-dusk-materials.js';
import { NeonDuskPost } from './neon-dusk-post.js';
import {
    NeonDuskParticleCompute,
    NeonDuskPixelCompute,
    NeonDuskHighlightCompute,
    NeonDuskStarCompute,
} from './neon-dusk-compute.js';

import {
    skyVertexShader,
    skyFragmentShader,
    starVertexShader,
    starFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    sunGlowVertexShader,
    sunGlowFragmentShader,
    mountainVertexShader,
    mountainFragmentShader,
    gridVertexShader,
    gridFragmentShader,
    highlightVertexShader,
    highlightFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    ringVertexShader,
    ringFragmentShader,
    VHSShader,
    VignetteShader,
} from './neon-dusk-shaders.js';

// ============================================================================
// QUALITY PRESETS
// ============================================================================

const QUALITY_PRESETS = {
    Minimal: {
        starCount: 800,
        mountainSegments: 32,
        glowLayers: 2,
        maxBurstParticles: 100,
        maxGridHighlights: 20,
        maxRings: 3,
        enableBloom: false,
        enableVHS: false,
        bloomStrength: 0,
        enableSSR: false,
        ssrStrength: 0.35,
        rayIntensity: 0.15,
        gridScrollSpeed: 4.0,
    },
    Low: {
        starCount: 1200,
        mountainSegments: 64,
        glowLayers: 3,
        maxBurstParticles: 200,
        maxGridHighlights: 40,
        maxRings: 5,
        enableBloom: false,
        enableVHS: true,
        bloomStrength: 0,
        enableSSR: false,
        ssrStrength: 0.35,
        rayIntensity: 0.2,
        gridScrollSpeed: 4.5,
        pixelCount: 100, // Added for retro pixels
    },
    Medium: {
        starCount: 1800,
        mountainSegments: 128,
        glowLayers: 4,
        maxBurstParticles: 400,
        maxGridHighlights: 60,
        maxRings: 8,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.15,
        bloomThreshold: 0.6,
        bloomRadius: 0.3,
        enableSSR: true,
        ssrStrength: 0.4,
        rayIntensity: 0.25,
        gridScrollSpeed: 5.0,
        pixelCount: 200, // Added for retro pixels
    },
    High: {
        starCount: 2500,
        mountainSegments: 192,
        glowLayers: 5,
        maxBurstParticles: 600,
        maxGridHighlights: 80,
        maxRings: 10,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.2,
        bloomThreshold: 0.55,
        bloomRadius: 0.35,
        enableSSR: true,
        ssrStrength: 0.45,
        rayIntensity: 0.3,
        gridScrollSpeed: 10.0, // Increased to 10.0
        pixelCount: 300, // Added for retro pixels
    },
    Ultra: {
        starCount: 3500,
        mountainSegments: 256,
        glowLayers: 6,
        maxBurstParticles: 800,
        maxGridHighlights: 100,
        maxRings: 12,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.25,
        bloomThreshold: 0.5,
        bloomRadius: 0.4,
        enableSSR: true,
        ssrStrength: 0.5,
        rayIntensity: 0.35,
        gridScrollSpeed: 10.0, // Increased to 10.0
        pixelCount: 400, // Added for retro pixels
    },
    Extreme: {
        starCount: 5000,
        mountainSegments: 512,
        glowLayers: 8,
        maxBurstParticles: 1000,
        maxGridHighlights: 150,
        maxRings: 15,
        enableBloom: true,
        enableVHS: true,
        bloomStrength: 0.3,
        bloomThreshold: 0.45,
        bloomRadius: 0.45,
        enableSSR: true,
        ssrStrength: 0.55,
        rayIntensity: 0.4,
        gridScrollSpeed: 10.0, // Increased to 10.0
        pixelCount: 500, // Added for retro pixels
    },
};

// ============================================================================
// MAIN THEME CLASS
// ============================================================================

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.clock = new THREE.Clock();
        this.container = null;
        this.isWebGPU = false;
        this.webgpuMaterialsReady = true;
        this.noCompute = false;
        this.particleCompute = null;
        this.pixelCompute = null;
        this.highlightCompute = null;
        this.starCompute = null;
        this.highlightInstanced = null;
        this.highlightInstancedAttributes = null;
        this.highlightInstancedMode = 'none';
        this.highlightData = [];
        this.activeHighlightCount = 0;

        // Scene elements
        this.skyGradient = null;
        this.starfield = null;
        this.sun = null;
        this.sunGlow = null;
        this.mountains = [];
        this.mountainBatch = null;
        this.mountainMaterial = null;
        this.grid = null;
        this.gridHighlights = [];
        this.highlightPool = [];
        this.retroPixels = null; // New: Retro pixels

        // Particle systems (minimal - only burst for effects)
        this.burstParticles = null;
        this.burstParticleData = [];
        this.hologramRings = [];
        this.hologramRingInstanced = null;
        this.hologramRingData = [];
        this.hologramRingAttributes = null;
        this.hologramRingNeedsMatrixUpdate = false;
        this.hologramRingNeedsAttributeUpdate = false;

        // Post-processing
        this.bloomPass = null;
        this.vhsPass = null;
        this.vignettePass = null;

        // Animation state
        this.time = 0;
        this.timeOffset = 0;
        this.sunPosition = { x: 0, y: 0 };
        this.sunScreen = new THREE.Vector2(0.5, 0.5);

        // Effect state
        this.effectState = {
            gridPulseIntensity: 0,
            gridWaveIntensity: 0,
            sunPulseIntensity: 0,
            mountainPulseIntensity: 0,
            mountainShockwave: 0,
            rimGlowIntensity: 1.0,
            highlightTwinkle: 0,
            colorShift: 0,
            vhsIntensity: 0,
            pixelTwinkle: 0, // NEW: Pixel twinkle intensity
        };

        this.gridWaveOrigin = new THREE.Vector2(0, 0);
        this.gridWaveTime = 0;

        // Event handlers
        this.eventUnsubscribers = [];
        this.resizeHandler = null;

        // Debug / baseline
        this.debugConfig = null;
        this.fixedDelta = null;
        this.forceWebGL = false;
        this.seed = null;
        this.rng = null;
        this.baselineStats = null;
        this.baselineLogged = false;
        this.deviceLostPromise = null;
        this.starBaseCount = 0;
        this.starDrawCount = 0;
        this.gpuTimeMs = 0;
        this.gpuTimingElapsed = 0;
        this.gpuTimingPending = false;
        this.profileAcc = { compute: 0, update: 0, render: 0, total: 0 };
        this.profileFrames = 0;
        this.profileLastLog = 0;

        this.retroPixelTrails = null;
        this.retroPixelTrailPositions = null;
        this.constellationLines = null;
        this.shootingStars = [];

        // Performance / scaling
        this.maxPixelRatio = 1.5;
        this.postProcessingScale = 1.0;
        this.dynamicResolutionScale = 1.0;
        this.dynamicResolutionMin = 0.7;
        this.dynamicResolutionMax = 1.0;
        this.dynamicResolutionStep = 0.05;
        this.dynamicResolutionAdjustInterval = 1.5;
        this.dynamicResolutionLowerFPS = 55;
        this.dynamicResolutionUpperFPS = 70;
        this.dynamicResolutionElapsed = 0;
        this.dynamicResolutionFrames = 0;
        this.dynamicResolutionCooldown = 6.0;
        this.dynamicResolutionCooldownRemaining = 0;
        this.dynamicResolutionIncreaseEnabled = false;
        this.renderMetrics = null;
        this.slowFrameThreshold = 0.05;
        this.slowFrameLimit = 3;
        this.slowFrameCount = 0;

        this.starDrawCount = 0;
        this.starBaseCount = 0;
        this.starLodScale = 1.0;
        this.starLodElapsed = 0;
        this.starLodInterval = 0.75;

        // GPU timing (WebGPU)
        this.gpuTimeMs = 0;
        this.gpuTimingElapsed = 0;
        this.gpuTimingInterval = 0.5;
        this.gpuTimingPending = false;

        // Lightweight profiler
        this.profileEnabled = false;
        this.profileFrameStart = 0;
        this.profileFrameLast = 0;
        this.profileAcc = { compute: 0, update: 0, render: 0, total: 0 };
        this.profileFrames = 0;
        this.profileLastLog = 0;
        this.profileLogInterval = 1000;
        this.profileWarnMs = 24;

        // Quality
        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;

        // Colors - classic synthwave sunset palette (like reference images)
        this.colors = {
            skyTop: new THREE.Color(0x1a0528), // Deep purple/black
            skyMid: new THREE.Color(0x550044), // Dark magenta
            skyBottom: new THREE.Color(0xaa2266), // Deep pinkish-red
            sunTop: new THREE.Color(0xffff66), // Bright retro yellow
            sunMid: new THREE.Color(0xff8822), // Deep orange
            sunBottom: new THREE.Color(0xff4477), // Hot pink/red
            gridColor: new THREE.Color(0xff00ff), // Magenta grid
            gridGlow: new THREE.Color(0x00ffff), // Cyan glow
            mountainDark: new THREE.Color(0x1a0525), // Dark purple (visible against black fog)
            mountainRim: new THREE.Color(0xcc44ff), // Bright neon violet rim
        };

        // Neon palette for highlights/effects
        this.neonColors = [
            new THREE.Color(0xff00ff), // Magenta
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0xff0088), // Hot pink
            new THREE.Color(0xffff00), // Yellow
            new THREE.Color(0xff4400), // Orange
        ];

        // Tetromino shapes for grid highlights
        this.tetrominoShapes = {
            I: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
            J: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            L: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            O: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            S: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            T: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            Z: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
        };

        console.log('[NeonDusk] Theme constructed');
    }

    getTetrominoConfig() {
        return NEON_DUSK_TETROMINOS;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        console.log(`[NeonDusk] Applied ${quality} quality preset`);
    }

    // =========================================================================
    // DEBUG / BASELINE
    // =========================================================================

    initDebugConfig() {
        if (this.debugConfig) return this.debugConfig;

        const params =
            typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const readBool = (key) => {
            if (!params) return false;
            const value = params.get(key);
            return value === '1' || value === 'true' || value === 'yes';
        };
        const readNumber = (key) => {
            if (!params) return null;
            const value = params.get(key);
            if (value === null || value === '') return null;
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };

        const seed = readNumber('neonDuskSeed');
        const fixedDtMs = readNumber('neonDuskFixedDt');
        const noPost = readBool('neonDuskNoPost');
        const noMRT = readBool('neonDuskNoMRT');
        const noCompute = readBool('neonDuskNoCompute');
        const noSSR = readBool('neonDuskNoSSR');
        const noRays = readBool('neonDuskNoRays');
        const profile = readBool('neonDuskProfile');

        this.debugConfig = {
            baseline: readBool('neonDuskBaseline'),
            forceWebGL: readBool('forceWebGL'),
            seed,
            fixedDtMs,
            noPost,
            noMRT,
            noCompute,
            noSSR,
            noRays,
            profile,
        };

        this.forceWebGL = this.debugConfig.forceWebGL;
        this.fixedDelta = Number.isFinite(fixedDtMs) ? fixedDtMs / 1000 : null;
        this.noCompute = this.debugConfig.noCompute;
        this.profileEnabled = this.debugConfig.profile;

        return this.debugConfig;
    }

    shouldForceWebGL() {
        const debug = this.initDebugConfig();
        return debug.forceWebGL || this.forceWebGL === true;
    }

    initDeterministicRandom() {
        const debug = this.initDebugConfig();
        if (Number.isFinite(debug.seed)) {
            const seed = Math.floor(debug.seed);
            this.seed = seed;
            this.rng = this.seededRandom(seed);
            this.timeOffset = this.rng() * 10000;
            console.log(`[NeonDusk] Deterministic RNG seed: ${seed}`);
        } else {
            this.seed = null;
            this.rng = null;
            this.timeOffset = Math.random() * 10000;
        }
    }

    random(min, max) {
        const value = this.rng ? this.rng() : Math.random();
        if (typeof min === 'number' && typeof max === 'number') {
            return value * (max - min) + min;
        }
        if (typeof min === 'number') {
            return value * min;
        }
        return value;
    }

    getRendererInfo() {
        if (!this.renderer) return {};

        if (this.isWebGPU) {
            const adapter = this.renderer.backend?.device?.adapter || this.renderer.backend?.adapter;
            return {
                backend: 'WebGPU',
                adapterInfo: adapter?.info || null,
            };
        }

        const gl = this.renderer.getContext();
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
            : gl.getParameter(gl.VENDOR);
        const renderer = debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER);

        return {
            backend: 'WebGL2',
            vendor,
            renderer,
        };
    }

    logBaselineIfNeeded() {
        const debug = this.initDebugConfig();
        if (!debug.baseline || this.baselineLogged) return;

        this.baselineLogged = true;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpr = this.renderer ? this.renderer.getPixelRatio() : window.devicePixelRatio || 1;
        const rendererInfo = this.getRendererInfo();
        const versions = typeof window !== 'undefined' ? window.process?.versions : null;

        console.log('[NeonDusk] Baseline start', {
            date: new Date().toISOString(),
            quality: this.currentQuality,
            preset: this.activePreset,
            resolution: `${width}x${height}`,
            pixelRatio: dpr,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            threeRevision: THREE.REVISION,
            electron: versions?.electron || null,
            chrome: versions?.chrome || null,
            seed: debug.seed,
            fixedDtMs: debug.fixedDtMs,
            noPost: debug.noPost,
            noMRT: debug.noMRT,
            noCompute: debug.noCompute,
            noSSR: debug.noSSR,
            noRays: debug.noRays,
            rendererInfo,
        });

        this.baselineStats = {
            frameTimes: [],
            elapsed: 0,
            reportInterval: 5,
        };
    }

    updateBaselineStats(delta) {
        if (!this.baselineStats) return;

        const stats = this.baselineStats;
        stats.frameTimes.push(delta * 1000);
        stats.elapsed += delta;

        if (stats.elapsed >= stats.reportInterval) {
            const times = stats.frameTimes;
            if (times.length > 0) {
                const totalMs = times.reduce((sum, value) => sum + value, 0);
                const avgFps = (1000 * times.length) / totalMs;
                const sorted = times.slice().sort((a, b) => a - b);
                const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
                const p99 = sorted[idx] || totalMs / times.length;
                const lowFps = p99 > 0 ? 1000 / p99 : avgFps;

                console.log(
                    `[NeonDusk] Baseline FPS avg=${avgFps.toFixed(1)} 1%low=${lowFps.toFixed(1)}`,
                );
            }

            stats.frameTimes = [];
            stats.elapsed = 0;
        }
    }

    attachWebGPUDeviceLostHandler() {
        if (!this.isWebGPU || this.deviceLostPromise || !this.renderer?.backend?.device?.lost) {
            return;
        }

        this.deviceLostPromise = this.renderer.backend.device.lost.then((info) => {
            this.deviceLostPromise = null;
            this.handleWebGPUDeviceLost(info);
        });
    }

    async handleWebGPUDeviceLost(info) {
        console.warn('[NeonDusk] WebGPU device lost, falling back to WebGL2', info);
        if (!this.container || !this.isActive) return;

        this.forceWebGL = true;
        await this.initRenderer(this.container);
        this.setupPostProcessing();
        this.onResize();
    }

    getMaterialUniformRef(material, key) {
        if (!material) return null;
        if (material.uniforms && material.uniforms[key]) {
            return material.uniforms[key];
        }
        if (material.userData && material.userData[key]) {
            return material.userData[key];
        }
        return null;
    }

    getMaterialUniformValue(material, key) {
        const ref = this.getMaterialUniformRef(material, key);
        if (!ref) return null;
        return ref.value !== undefined ? ref.value : ref;
    }

    setMaterialUniform(material, key, value) {
        const ref = this.getMaterialUniformRef(material, key);
        if (!ref) return;

        if (ref.value !== undefined) {
            const current = ref.value;
            if (current === value) return;
            if (typeof current === 'number' || typeof current === 'boolean') {
                if (current === value) return;
            } else if (
                current
                && value
                && typeof current.equals === 'function'
                && typeof value.equals === 'function'
                && current.equals(value)
            ) {
                return;
            }
            if (ref.value && ref.value.copy && value) {
                ref.value.copy(value);
            } else {
                ref.value = value;
            }
        } else if (ref.copy && value) {
            if (typeof ref.equals === 'function' && typeof value.equals === 'function' && ref.equals(value)) {
                return;
            }
            ref.copy(value);
        }
    }

    updatePixelRatioUniforms() {
        const pixelRatio = this.renderer ? this.renderer.getPixelRatio() : this.getEffectivePixelRatio();
        this.setMaterialUniform(this.starfield?.material, 'uPixelRatio', pixelRatio);
        this.setMaterialUniform(this.ambientParticles?.material, 'uPixelRatio', pixelRatio);
        this.setMaterialUniform(this.burstParticles?.material, 'uPixelRatio', pixelRatio);
        this.setMaterialUniform(this.retroPixels?.material, 'uPixelRatio', pixelRatio);
        this.setMaterialUniform(this.retroPixelTrails?.material, 'uPixelRatio', pixelRatio);
    }

    getRenderPixelRatio() {
        const baseRatio = this.getEffectivePixelRatio(this.maxPixelRatio);
        const scaled = baseRatio * this.dynamicResolutionScale;
        return Math.max(0.25, Math.min(this.maxPixelRatio, scaled));
    }

    getPostProcessingScale() {
        return this.postProcessingScale || 1.0;
    }

    applyRenderScale(force = false) {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRenderPixelRatio();
        const postScale = this.getPostProcessingScale();

        if (
            !force
            && this.renderMetrics
            && this.renderMetrics.width === width
            && this.renderMetrics.height === height
            && this.renderMetrics.pixelRatio === pixelRatio
            && this.renderMetrics.postScale === postScale
        ) {
            return;
        }

        this.renderMetrics = {
            width,
            height,
            pixelRatio,
            postScale,
        };

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height);

        const targetWidth = Math.max(1, Math.floor(width * pixelRatio * postScale));
        const targetHeight = Math.max(1, Math.floor(height * pixelRatio * postScale));

        if (this.postProcessing) {
            this.postProcessing.setSize(targetWidth, targetHeight);
        }

        if (this.composer) {
            this.composer.setSize(targetWidth, targetHeight);
            if (this.bloomPass?.resolution) {
                this.bloomPass.resolution.set(targetWidth, targetHeight);
            }
        }

        if (this.vhsPass?.uniforms?.uResolution?.value) {
            this.vhsPass.uniforms.uResolution.value.set(targetWidth, targetHeight);
        }

        this.updatePixelRatioUniforms();
    }

    updateDynamicResolution(delta) {
        if (!this.renderer) return;

        if (this.dynamicResolutionCooldownRemaining > 0) {
            this.dynamicResolutionCooldownRemaining = Math.max(0, this.dynamicResolutionCooldownRemaining - delta);
            return;
        }

        this.dynamicResolutionElapsed += delta;
        this.dynamicResolutionFrames += 1;

        if (this.dynamicResolutionElapsed < this.dynamicResolutionAdjustInterval) return;

        let fps = this.dynamicResolutionFrames / this.dynamicResolutionElapsed;
        if (this.gpuTimeMs > 0) {
            const gpuFps = 1000 / this.gpuTimeMs;
            fps = Math.min(fps, gpuFps);
        }
        this.dynamicResolutionElapsed = 0;
        this.dynamicResolutionFrames = 0;

        let nextScale = this.dynamicResolutionScale;
        if (fps < this.dynamicResolutionLowerFPS) {
            nextScale = Math.max(this.dynamicResolutionMin, nextScale - this.dynamicResolutionStep);
        } else if (this.dynamicResolutionIncreaseEnabled && fps > this.dynamicResolutionUpperFPS) {
            nextScale = Math.min(this.dynamicResolutionMax, nextScale + this.dynamicResolutionStep);
        }

        if (nextScale !== this.dynamicResolutionScale) {
            this.dynamicResolutionScale = nextScale;
            this.applyRenderScale();
            this.dynamicResolutionCooldownRemaining = this.dynamicResolutionCooldown;
        }
    }

    updatePerformanceGuards(delta) {
        if (delta > this.slowFrameThreshold) {
            this.slowFrameCount += 1;
        } else if (this.slowFrameCount > 0) {
            this.slowFrameCount -= 1;
        }

        if (this.slowFrameCount >= this.slowFrameLimit) {
            this.slowFrameCount = 0;
            const nextScale = Math.max(this.dynamicResolutionMin, this.dynamicResolutionScale - 0.1);
            if (nextScale !== this.dynamicResolutionScale) {
                this.dynamicResolutionScale = nextScale;
                this.applyRenderScale();
            }
        }
    }

    updateGpuTiming(delta) {
        if (!this.isWebGPU || this.gpuTimingPending) return;
        if (!this.renderer?.backend?.device?.queue?.onSubmittedWorkDone) return;

        this.gpuTimingElapsed += delta;
        if (this.gpuTimingElapsed < this.gpuTimingInterval) return;

        this.gpuTimingElapsed = 0;
        this.gpuTimingPending = true;

        const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.renderer.backend.device.queue.onSubmittedWorkDone().then(() => {
            const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const sample = Math.max(0, end - start);
            const smoothing = 0.2;
            this.gpuTimeMs = this.gpuTimeMs > 0 ? this.gpuTimeMs * (1 - smoothing) + sample * smoothing : sample;
            this.gpuTimingPending = false;
        }).catch(() => {
            this.gpuTimingPending = false;
        });
    }

    beginProfileFrame() {
        if (!this.profileEnabled || typeof performance === 'undefined') return;
        this.profileFrameStart = performance.now();
        this.profileFrameLast = this.profileFrameStart;
    }

    markProfile(label) {
        if (!this.profileEnabled || typeof performance === 'undefined') return;
        const now = performance.now();
        const delta = now - this.profileFrameLast;
        if (this.profileAcc[label] !== undefined) {
            this.profileAcc[label] += delta;
        } else {
            this.profileAcc[label] = delta;
        }
        this.profileFrameLast = now;
    }

    endProfileFrame() {
        if (!this.profileEnabled || typeof performance === 'undefined') return;
        const now = performance.now();
        const total = now - this.profileFrameStart;
        this.profileAcc.total += total;
        this.profileFrames += 1;

        if (total > this.profileWarnMs) {
            console.warn(`[NeonDusk] Slow frame ${total.toFixed(1)}ms`);
        }

        if (now - this.profileLastLog >= this.profileLogInterval) {
            const frames = Math.max(1, this.profileFrames);
            const avg = {
                compute: (this.profileAcc.compute / frames).toFixed(2),
                update: (this.profileAcc.update / frames).toFixed(2),
                render: (this.profileAcc.render / frames).toFixed(2),
                total: (this.profileAcc.total / frames).toFixed(2),
            };
            console.log('[NeonDusk] Profile avg (ms)', avg);
            this.profileAcc = { compute: 0, update: 0, render: 0, total: 0 };
            this.profileFrames = 0;
            this.profileLastLog = now;
        }
    }

    updateStarLOD(delta) {
        if (!this.starfield?.geometry || !this.camera) return;

        this.starLodElapsed += delta;
        if (this.starLodElapsed < this.starLodInterval) return;
        this.starLodElapsed = 0;

        const baseCount = this.starBaseCount || this.activePreset.starCount || this.starDrawCount || 0;
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        const tiltFactor = 0.7 + Math.max(0, dir.y) * 0.3;
        const perfFactor = Math.max(0.55, Math.min(1.0, this.dynamicResolutionScale));
        const targetScale = Math.max(0.55, Math.min(1.0, tiltFactor * perfFactor));
        const targetCount = Math.min(baseCount, Math.max(200, Math.floor(baseCount * targetScale)));

        if (targetCount !== this.starDrawCount) {
            this.starDrawCount = targetCount;
            this.starfield.geometry.setDrawRange(0, targetCount);
        }
        this.starLodScale = targetScale;
    }

    isComputeEnabled() {
        const debug = this.initDebugConfig();
        return this.isWebGPU && !debug.noCompute;
    }

    updateCompute(delta) {
        if (!this.isComputeEnabled()) return;
        if (!this.renderer || typeof this.renderer.compute !== 'function') return;

        if (this.starCompute?.computeNode) {
            this.starCompute.update(delta);
            this.renderer.compute(this.starCompute.computeNode);
        }

        if (this.particleCompute?.computeNode) {
            this.particleCompute.update(delta, { gravity: 20.0, squareDamping: 0.98 });
            this.renderer.compute(this.particleCompute.computeNode);
        }

        if (this.pixelCompute?.computeNode) {
            const sunPos = this.sun ? this.sun.position : new THREE.Vector3();
            const attraction = 0.4 + this.effectState.colorShift * 0.6 + this.effectState.sunPulseIntensity * 0.4;
            this.pixelCompute.update(delta, {
                maxY: 150.0,
                minY: 0.0,
                time: this.time,
                sun: sunPos,
                attraction,
                drag: 0.98,
            });
            this.renderer.compute(this.pixelCompute.computeNode);
        }

        if (this.highlightCompute?.computeNode && this.activeHighlightCount > 0) {
            const maxZ = (this.grid?.position?.z ?? -50) + 320;
            this.highlightCompute.update(delta, {
                scrollSpeed: this.activePreset.gridScrollSpeed,
                maxZ,
            });
            this.renderer.compute(this.highlightCompute.computeNode);
        }
    }

    // =========================================================================
    // SCENE CREATION
    // =========================================================================

    async createScene() {
        console.log('[NeonDusk] Creating Three.js scene...');

        const container = document.getElementById('neon-dusk-theme');
        if (!container) {
            console.error('[NeonDusk] Container not found');
            return;
        }

        container.innerHTML = '';

        // Debug config + deterministic RNG
        this.initDebugConfig();
        this.initDeterministicRandom();
        this.time = 0;
        this.clock = new THREE.Clock();

        // Apply quality
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        this.dynamicResolutionScale = 1.0;
        this.dynamicResolutionElapsed = 0;
        this.dynamicResolutionFrames = 0;
        this.dynamicResolutionCooldownRemaining = 0;
        this.renderMetrics = null;

        // Initialize renderer
        const rendererReady = await this.initRenderer(container);
        if (!rendererReady) {
            console.error('[NeonDusk] Renderer initialization failed');
            return;
        }

        this.logBaselineIfNeeded();

        // Create scene elements
        this.createSkyGradient();
        this.createStarfield();
        this.createSun();
        this.createMountains();
        this.createGrid();
        this.createHighlightPool();
        this.createBurstParticleSystem();
        this.createHologramRingPool();
        this.createRetroPixels(); // New: Create retro pixels

        this.updatePixelRatioUniforms();

        // Setup post-processing
        this.setupPostProcessing();

        // Setup events
        this.setupEventListeners();
        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);

        // Start animation
        this.animate();

        console.log(`[NeonDusk] Scene created with ${quality} quality`);
    }

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.container = container;

        // Tear down previous renderer canvas if re-initializing
        if (this.renderer?.domElement && container.contains(this.renderer.domElement)) {
            container.removeChild(this.renderer.domElement);
        }
        if (this.renderer) {
            this.renderer.dispose();
        }

        let renderer = null;

        // Try WebGPU first unless forced to WebGL
        if (!this.shouldForceWebGL()) {
            try {
                renderer = new WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                });
                await renderer.init();
            } catch (error) {
                console.warn('[NeonDusk] WebGPU init failed, falling back to WebGL2:', error);
                renderer = null;
            }
        }

        // Guard WebGPU until TSL materials are ready
        if (renderer && renderer.backend?.isWebGPUBackend === true && !this.webgpuMaterialsReady) {
            console.warn('[NeonDusk] WebGPU available but materials not ready, using WebGL2');
            renderer.dispose();
            renderer = null;
        }

        if (renderer && renderer.backend?.isWebGPUBackend === true) {
            this.isWebGPU = true;
            this.renderer = renderer;
        } else {
            this.isWebGPU = false;
            this.renderer = new THREE.WebGLRenderer({
                antialias: this.getAntialiasEnabled(),
                alpha: false,
                powerPreference: 'high-performance',
            });
        }

        if (!this.renderer) {
            return false;
        }

        this.renderer.setClearColor(0x08000f, 1);
        this.renderer.sortObjects = true;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        // Create or refresh scene
        if (!this.scene) {
            this.scene = new THREE.Scene();
        }
        this.scene.background = new THREE.Color(0x08000f);

        // Create or refresh camera
        if (!this.camera) {
            this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
            this.camera.position.set(0, 25, 50);
            this.camera.lookAt(0, 10, -100);
        } else {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        this.applyRenderScale(true);

        if (this.isWebGPU) {
            this.attachWebGPUDeviceLostHandler();
        }

        console.log(`[NeonDusk] Renderer initialized (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
        return true;
    }

    // =========================================================================
    // SKY GRADIENT
    // =========================================================================

    createSkyGradient() {
        const geometry = new THREE.PlaneGeometry(3000, 1600);

        // Use vertex colors for gradient
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        const positions = geometry.attributes.position.array;

        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const y = positions[i * 3 + 1];
            const t = (y + 800) / 1600;

            let color;
            if (t < 0.4) {
                color = this.colors.skyBottom.clone().lerp(this.colors.skyMid, t / 0.4);
            } else {
                color = this.colors.skyMid.clone().lerp(this.colors.skyTop, (t - 0.4) / 0.6);
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.skyGradient = new THREE.Mesh(geometry, material);
        this.skyGradient.position.z = -900;
        this.skyGradient.position.y = 50;
        this.skyGradient.renderOrder = -5000;
        this.scene.add(this.skyGradient);
    }

    // =========================================================================
    // STARFIELD
    // =========================================================================

    createStarfield() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinkleData = new Float32Array(count * 2);
        const brightness = new Float32Array(count);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0x00ffff),
            new THREE.Color(0xff00ff),
            new THREE.Color(0xff88ff),
            new THREE.Color(0x88ffff),
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const theta = this.random() * Math.PI * 2;
            const phi = Math.acos(2 * this.random() - 1);

            // Distribute in layers - further back
            const layerRand = this.random();
            let radius;
            if (layerRand < 0.33) {
                radius = 500 + this.random() * 150;
            } else if (layerRand < 0.66) {
                radius = 700 + this.random() * 200;
            } else {
                radius = 950 + this.random() * 250;
            }

            // Only upper hemisphere (above horizon)
            if (phi > Math.PI * 0.5) {
                positions[i3] = 0;
                positions[i3 + 1] = -10000;
                positions[i3 + 2] = 0;
                continue;
            }

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi) * 0.4 + 30;
            positions[i3 + 2] = -Math.abs(radius * Math.sin(phi) * Math.sin(theta)) - 200;

            const color = starColors[Math.floor(this.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 8 + this.random() * 17; // LARGER stars (8-25 pixels)
            twinkleData[i2] = this.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 0.5 + this.random() * 2.0;
            brightness[i] = 0.4 + this.random() * 0.6; // Much brighter stars
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
        geometry.setDrawRange(0, count);

        this.starBaseCount = count;
        this.starDrawCount = count;

        if (this.starCompute) {
            this.starCompute.dispose();
            this.starCompute = null;
        }

        if (this.isComputeEnabled()) {
            this.starCompute = new NeonDuskStarCompute(count);
            this.starCompute.setInitialData(twinkleData, brightness, sizes);
            this.starCompute.createComputeNode();
        }

        const material = this.isWebGPU
            ? createStarNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                isWebGPU: true,
                starCompute: this.starCompute,
            })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uEventBoost: { value: 0 },
                },
                vertexShader: starVertexShader,
                fragmentShader: starFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                vertexColors: true,
            });

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.renderOrder = -4000;
        this.starfield.frustumCulled = false;
        this.scene.add(this.starfield);

        this.createConstellations(positions);
        this.createShootingStarPool();
    }

    createConstellations(positions) {
        if (this.constellationLines) {
            this.scene.remove(this.constellationLines);
            this.constellationLines.geometry.dispose();
            this.constellationLines.material.dispose();
            this.constellationLines = null;
        }

        // Constellation lines removed for a cleaner sky.
    }

    createShootingStarPool() {
        if (this.shootingStars.length) {
            this.shootingStars.forEach((star) => {
                this.scene.remove(star.mesh);
                star.mesh.geometry.dispose();
                star.mesh.material.dispose();
            });
            this.shootingStars = [];
        }

        const poolSize = 6;
        for (let i = 0; i < poolSize; i++) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));

            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const line = new THREE.Line(geometry, material);
            line.visible = false;
            line.renderOrder = -3985;
            line.frustumCulled = false;
            this.scene.add(line);

            this.shootingStars.push({
                mesh: line,
                active: false,
                life: 0,
                maxLife: 1,
                length: 60,
                velocity: new THREE.Vector3(),
                head: new THREE.Vector3(),
            });
        }
    }

    spawnShootingStar() {
        const star = this.shootingStars.find((item) => !item.active);
        if (!star) return;

        const startX = (this.random() - 0.5) * 600;
        const startY = 120 + this.random() * 120;
        const startZ = -300 - this.random() * 700;

        const dir = new THREE.Vector3(
            this.random() > 0.5 ? -1 : 1,
            -0.3 - this.random() * 0.3,
            -0.6 - this.random() * 0.4,
        ).normalize();

        const speed = 220 + this.random() * 220;

        star.velocity.copy(dir).multiplyScalar(speed);
        star.head.set(startX, startY, startZ);
        star.life = 0;
        star.maxLife = 0.8 + this.random() * 0.6;
        star.length = 60 + this.random() * 60;
        star.active = true;
        star.mesh.visible = true;
        star.mesh.material.opacity = 0.85;

        const positions = star.mesh.geometry.attributes.position.array;
        positions[0] = star.head.x;
        positions[1] = star.head.y;
        positions[2] = star.head.z;
        positions[3] = star.head.x - dir.x * star.length;
        positions[4] = star.head.y - dir.y * star.length;
        positions[5] = star.head.z - dir.z * star.length;
        star.mesh.geometry.attributes.position.needsUpdate = true;
    }

    updateShootingStars(delta) {
        if (!this.shootingStars.length) return;

        for (const star of this.shootingStars) {
            if (!star.active) continue;

            star.life += delta;
            const progress = star.life / star.maxLife;
            if (progress >= 1.0) {
                star.active = false;
                star.mesh.visible = false;
                star.mesh.material.opacity = 0;
                continue;
            }

            star.head.addScaledVector(star.velocity, delta);
            const dir = star.velocity.clone().normalize();

            const positions = star.mesh.geometry.attributes.position.array;
            positions[0] = star.head.x;
            positions[1] = star.head.y;
            positions[2] = star.head.z;
            positions[3] = star.head.x - dir.x * star.length;
            positions[4] = star.head.y - dir.y * star.length;
            positions[5] = star.head.z - dir.z * star.length;
            star.mesh.geometry.attributes.position.needsUpdate = true;
            star.mesh.material.opacity = (1.0 - progress) * 0.85;
        }
    }

    // =========================================================================
    // NEBULA CLOUDS
    // =========================================================================

    createNebulaClouds() {
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/wolfhour/';

        // Reuse wolfhour textures with neon tinting
        const textures = [
            textureLoader.load(`${texturePath}nebula-silver-1.png`),
            textureLoader.load(`${texturePath}nebula-silver-2.png`),
            textureLoader.load(`${texturePath}nebula-silver-3.png`),
        ];

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        const nebulaConfigs = [
            {
                texture: textures[0], x: 0, y: 60, z: -750, size: 700, speed: 2, opacity: 0.06,
            },
            {
                texture: textures[1], x: -80, y: 70, z: -800, size: 800, speed: 1.5, opacity: 0.05,
            },
            {
                texture: textures[2], x: 80, y: 80, z: -850, size: 850, speed: 1, opacity: 0.04,
            },
        ];

        const count = Math.min(this.activePreset.nebulaCount, nebulaConfigs.length);

        for (let i = 0; i < count; i++) {
            const config = nebulaConfigs[i];
            const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.6);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: config.texture },
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

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(config.x, config.y, config.z);
            mesh.renderOrder = -3500 - i;

            mesh.userData.speed = config.speed;
            mesh.userData.startX = config.x;
            mesh.userData.wrapBoundary = config.size;

            this.nebulaClouds.push(mesh);
            this.scene.add(mesh);
        }
    }

    // =========================================================================
    // MASSIVE BANDED SUN (Classic Synthwave)
    // =========================================================================

    createSun() {
        // Very large sun sphere - positioned FAR BACK behind mountains
        const sunGeometry = new THREE.SphereGeometry(300, 64, 64); // MASSIVE sun
        const sunMaterial = this.isWebGPU
            ? createSunNodeMaterial(this.colors)
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColorTop: { value: this.colors.sunTop },
                    uColorMid: { value: this.colors.sunMid },
                    uColorBottom: { value: this.colors.sunBottom },
                    uPulseIntensity: { value: 0 },
                    uStripeCount: { value: 8.0 },
                },
                vertexShader: sunVertexShader,
                fragmentShader: sunFragmentShader,
                transparent: true,
                side: THREE.FrontSide,
                depthWrite: false,
            });

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        // Position sun FAR behind mountains (mountains are at z=-250 to -550)
        this.sun.position.set(0, 50, -900);
        this.sun.renderOrder = -2000; // Render before mountains
        this.scene.add(this.sun);

        // Large atmospheric glow behind sun
        const glowGeometry = new THREE.PlaneGeometry(1200, 1200); // MASSIVE glow
        const glowMaterial = this.isWebGPU
            ? createSunGlowNodeMaterial({
                color: new THREE.Color(0xff6688),
                opacity: 0.4,
            })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uGlowColor: { value: new THREE.Color(0xff6688) },
                    uOpacity: { value: 0.4 },
                    uPulseIntensity: { value: 0 },
                },
                vertexShader: sunGlowVertexShader,
                fragmentShader: sunGlowFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

        this.sunGlow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.sunGlow.position.copy(this.sun.position);
        this.sunGlow.position.z -= 10;
        this.sunGlow.renderOrder = -2100; // Render before sun
        this.scene.add(this.sunGlow);
    }

    // =========================================================================
    // SILHOUETTE MOUNTAINS (Valley Formation)
    // =========================================================================

    createMountains() {
        // Configure mountains to form a valley - left and right sides
        // Mountains extend far to the edges to fill screen when camera moves
        const mountainConfigs = [
            // LEFT SIDE - FOREGROUND (closest, largest, fill edge)
            // LEFT SIDE - EXTREME FOREGROUND (New framing mountains)
            {
                x: -550, z: 30, size: 700, height: 160, layer: -0.1, seed: 10001,
            },

            // LEFT SIDE - FOREGROUND (closest, largest, fill edge)
            {
                x: -350, z: -10, size: 500, height: 110, layer: 0.0, seed: 11111,
            },
            {
                x: -380, z: -80, size: 500, height: 120, layer: 0.05, seed: 11112,
            },
            {
                x: -180, z: -140, size: 350, height: 90, layer: 0.1, seed: 22222,
            },

            // LEFT SIDE - MIDGROUND
            {
                x: -280, z: -240, size: 450, height: 110, layer: 0.25, seed: 33333,
            },
            {
                x: -200, z: -340, size: 400, height: 100, layer: 0.4, seed: 33334,
            },

            // LEFT SIDE - BACKGROUND (further, hazier)
            {
                x: -150, z: -460, size: 500, height: 130, layer: 0.6, seed: 44444,
            },
            {
                x: -250, z: -560, size: 550, height: 140, layer: 0.75, seed: 44445,
            },

            // RIGHT SIDE - EXTREME FOREGROUND (New framing mountains)
            {
                x: 550, z: 30, size: 700, height: 160, layer: -0.1, seed: 50001,
            },

            // RIGHT SIDE - FOREGROUND (closest, largest, fill edge)
            {
                x: 350, z: -10, size: 500, height: 110, layer: 0.0, seed: 55555,
            },
            {
                x: 380, z: -80, size: 500, height: 120, layer: 0.05, seed: 55556,
            },
            {
                x: 180, z: -140, size: 350, height: 90, layer: 0.1, seed: 66666,
            },

            // RIGHT SIDE - MIDGROUND
            {
                x: 280, z: -240, size: 450, height: 110, layer: 0.25, seed: 77777,
            },
            {
                x: 200, z: -340, size: 400, height: 100, layer: 0.4, seed: 77778,
            },

            // RIGHT SIDE - BACKGROUND (further, hazier)
            {
                x: 150, z: -460, size: 500, height: 130, layer: 0.6, seed: 88888,
            },
            {
                x: 250, z: -560, size: 550, height: 140, layer: 0.75, seed: 88889,
            },

            // CENTER PEAKS near horizon - REMOVED to clear sun view
            // { x: -60, z: -750, size: 300, height: 80, layer: 0.85, seed: 99999 },
            // { x: 60, z: -750, size: 300, height: 80, layer: 0.85, seed: 99998 },
            // { x: 0, z: -800, size: 350, height: 90, layer: 0.9, seed: 99997 },
        ];

        // Clean up previous mountains
        this.mountains.forEach((mountain) => {
            this.scene?.remove(mountain);
            mountain.geometry?.dispose();
        });
        this.mountains = [];

        if (this.mountainBatch) {
            this.scene?.remove(this.mountainBatch);
            this.mountainBatch.geometry?.dispose();
            this.mountainBatch = null;
        }

        const segments = Math.min(this.activePreset.mountainSegments, 128);
        const geometries = mountainConfigs.map((config) =>
            this.createSilhouetteMountainGeometry(config, segments),
        );

        // Shared mountain material (reduces uniform updates)
        if (this.mountainMaterial) {
            this.mountainMaterial.dispose?.();
        }
        this.mountainMaterial = this.isWebGPU
            ? createMountainNodeMaterial(this.colors, 0)
            : new THREE.ShaderMaterial({
                uniforms: {
                    uBaseColor: { value: this.colors.mountainDark },
                    uRimColor: { value: this.colors.mountainRim },
                    uMountainLayer: { value: 0 },
                    uTime: { value: 0 },
                    uRimIntensity: { value: 1.0 },
                    uShockwave: { value: 0 },
                },
                vertexShader: mountainVertexShader,
                fragmentShader: mountainFragmentShader,
                transparent: false,
            });

        const canBatch = typeof THREE.BatchedMesh === 'function';
        if (canBatch) {
            const maxInstances = mountainConfigs.length;
            let totalVertices = 0;
            let totalIndices = 0;
            geometries.forEach((geometry) => {
                totalVertices += geometry.attributes.position.count;
                totalIndices += geometry.index ? geometry.index.count : geometry.attributes.position.count;
            });

            const batched = new THREE.BatchedMesh(
                maxInstances,
                totalVertices,
                totalIndices,
                this.mountainMaterial,
            );
            batched.perObjectFrustumCulled = true;
            batched.sortObjects = false;
            batched.renderOrder = -500;

            const matrix = new THREE.Matrix4();
            geometries.forEach((geometry, index) => {
                const geometryId = batched.addGeometry(geometry);
                const instanceId = batched.addInstance(geometryId);
                const config = mountainConfigs[index];
                matrix.makeTranslation(config.x, -30, config.z);
                batched.setMatrixAt(instanceId, matrix);
                geometry.dispose();
            });

            batched.computeBoundingSphere();
            this.mountainBatch = batched;
            this.scene.add(batched);
            return;
        }

        mountainConfigs.forEach((config, index) => {
            const geometry = geometries[index];
            const mesh = new THREE.Mesh(geometry, this.mountainMaterial);
            mesh.position.set(config.x, -30, config.z);
            mesh.renderOrder = -500 + Math.round(config.layer * 100);
            this.mountains.push(mesh);
            this.scene.add(mesh);
        });
    }

    createSilhouetteMountainGeometry(config, segments) {
        const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        // CPU-side procedural mountain shape
        const posAttribute = geometry.attributes.position;
        const { seed } = config;

        const fract = (n) => n - Math.floor(n);
        const mix = (a, b, t) => a * (1 - t) + b * t;
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
            let v = 0.0;
            let a = 0.5;
            for (let i = 0; i < 4; i++) {
                v += a * noise(x, y);
                x *= 2.0;
                y *= 2.0;
                a *= 0.5;
            }
            return v;
        };

        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const z = posAttribute.getZ(i);

            // Create jagged mountain shape
            const dist = Math.sqrt(x * x + z * z);
            const maxDist = config.size * 0.45;

            if (dist > maxDist) {
                posAttribute.setY(i, -500);
                continue;
            }

            const normDist = dist / maxDist;
            const base = (1.0 - normDist) ** 1.2 * config.height;
            const jagged = fbm(x * 0.02, z * 0.02) * config.height * 0.5 * (1.0 - normDist);

            posAttribute.setY(i, base + jagged);
        }

        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    // =========================================================================
    // SYNTHWAVE GRID
    // =========================================================================

    createGrid() {
        const geometry = new THREE.PlaneGeometry(400, 300, 100, 75);
        geometry.rotateX(-Math.PI / 2);

        const debug = this.initDebugConfig();
        const enableSSR = this.isWebGPU && !debug.noSSR && (this.activePreset.enableSSR ?? true);

        const material = this.isWebGPU
            ? createGridNodeMaterial(this.colors, {
                gridScrollSpeed: this.activePreset.gridScrollSpeed,
                enableSSR,
                ssrStrength: this.activePreset.ssrStrength ?? 0.45,
            })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uSpeed: { value: this.activePreset.gridScrollSpeed },
                    uGridColor: { value: this.colors.gridColor },
                    uGlowIntensity: { value: 1.0 },
                    uPulseIntensity: { value: 0 },
                    uColorShift: { value: this.colors.gridGlow },
                    uSunPosition: { value: new THREE.Vector3(0, 50, -900) }, // Reflection target
                    uWaveTime: { value: 0 },
                    uWaveOrigin: { value: new THREE.Vector2(0, 0) },
                    uWaveIntensity: { value: 0 },
                },
                vertexShader: gridVertexShader,
                fragmentShader: gridFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

        this.grid = new THREE.Mesh(geometry, material);
        this.grid.position.y = 0;
        this.grid.position.z = -50;
        this.grid.renderOrder = -200;
        this.scene.add(this.grid);
    }

    // =========================================================================
    // GRID HIGHLIGHT POOL
    // =========================================================================

    createHighlightPool() {
        const poolSize = this.activePreset.maxGridHighlights;
        this.highlightPool = [];
        this.gridHighlights = [];
        this.activeHighlightCount = 0;

        if (this.highlightInstanced) {
            this.scene.remove(this.highlightInstanced);
            this.highlightInstanced.geometry.dispose();
            if (this.highlightInstanced.material) {
                this.highlightInstanced.material.dispose();
            }
            this.highlightInstanced = null;
            this.highlightInstancedAttributes = null;
            this.highlightInstancedMode = 'none';
        }

        if (this.highlightCompute) {
            this.highlightCompute.dispose();
            this.highlightCompute = null;
        }

        if (this.isComputeEnabled()) {
            const geometry = new THREE.PlaneGeometry(6.1, 6.1);
            geometry.rotateX(-Math.PI / 2);

            const maxZ = (this.grid?.position?.z ?? -50) + 320;
            this.highlightCompute = new NeonDuskHighlightCompute(poolSize, {
                scrollSpeed: this.activePreset.gridScrollSpeed,
                maxZ,
            });
            this.highlightCompute.createComputeNode();

            const material = createHighlightNodeMaterial({
                isWebGPU: true,
                highlightCompute: this.highlightCompute,
            });

            this.highlightInstanced = new THREE.InstancedMesh(geometry, material, poolSize);
            this.highlightInstanced.frustumCulled = false;
            this.highlightInstanced.renderOrder = 10;

            this.highlightData = [];
            const identity = new THREE.Matrix4();
            for (let i = 0; i < poolSize; i++) {
                this.highlightInstanced.setMatrixAt(i, identity);
                this.highlightData.push({
                    active: false,
                    x: 0,
                    y: 0,
                    z: 0,
                    intensity: 0,
                    phase: 0,
                    color: new THREE.Color(0x00ffff),
                });
            }
            this.highlightInstanced.instanceMatrix.needsUpdate = true;
            this.scene.add(this.highlightInstanced);
            this.highlightInstancedMode = 'compute';
            return;
        }
        const geometry = new THREE.PlaneGeometry(6.1, 6.1); // Updated for 6.0 grid size
        geometry.rotateX(-Math.PI / 2);

        const material = this.isWebGPU
            ? createHighlightNodeMaterial({ useInstancing: true })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0x00ffff) },
                    uIntensity: { value: 0 },
                    uTime: { value: 0 },
                    uTwinkle: { value: 0 },
                },
                vertexShader: highlightVertexShader,
                fragmentShader: highlightFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

        if (!this.isWebGPU) {
            material.defines = { USE_INSTANCING: '' };
        }

        const instanced = new THREE.InstancedMesh(geometry, material, poolSize);
        instanced.frustumCulled = false;
        instanced.renderOrder = 10;
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const colors = new Float32Array(poolSize * 3);
        const intensities = new Float32Array(poolSize);
        const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
        const intensityAttr = new THREE.InstancedBufferAttribute(intensities, 1);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        intensityAttr.setUsage(THREE.DynamicDrawUsage);

        geometry.setAttribute('aColor', colorAttr);
        geometry.setAttribute('aIntensity', intensityAttr);

        this.highlightInstanced = instanced;
        this.highlightInstancedAttributes = { color: colorAttr, intensity: intensityAttr };
        this.highlightInstancedMode = 'instanced';

        this.highlightData = [];
        const identity = new THREE.Matrix4();
        for (let i = 0; i < poolSize; i++) {
            instanced.setMatrixAt(i, identity);
            this.highlightData.push({
                active: false,
                life: 0,
                maxLife: 15.0,
                intensity: 0,
                gridZ: 0,
                scrollOffset: 0,
                phase: 0,
                color: new THREE.Color(0x00ffff),
                x: 0,
                y: 0,
                z: 0,
            });
        }

        instanced.instanceMatrix.needsUpdate = true;
        this.scene.add(instanced);
    }

    // =========================================================================
    // AMBIENT PARTICLES
    // =========================================================================

    createAmbientParticles() {
        const count = this.activePreset.ambientParticles;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const types = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            positions[i3] = (this.random() - 0.5) * 200;
            positions[i3 + 1] = this.random() * 100 + 10;
            positions[i3 + 2] = (this.random() - 0.5) * 150 - 30;

            const color = this.neonColors[Math.floor(this.random() * this.neonColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 8 + this.random() * 15;
            lives[i] = 1.0;
            types[i] = 0; // Circle type

            this.ambientParticleData.push({
                vx: (this.random() - 0.5) * 0.3,
                vy: (this.random() - 0.5) * 0.2,
                vz: (this.random() - 0.5) * 0.3,
                baseSize: sizes[i],
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

        const material = this.isWebGPU
            ? createParticleNodeMaterial({ pixelRatio: this.renderer.getPixelRatio() })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uTwinkle: { value: 0 }, // Added uTwinkle uniform
                    uColorShift: { value: 0 },
                },
                vertexShader: particleVertexShader,
                fragmentShader: particleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.ambientParticles.renderOrder = 200;
        this.scene.add(this.ambientParticles);
    }

    // =========================================================================
    // BURST PARTICLE SYSTEM
    // =========================================================================

    createBurstParticleSystem() {
        const count = this.activePreset.maxBurstParticles;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const types = new Float32Array(count);

        // Initialize all particles as inactive (off-screen)
        for (let i = 0; i < count; i++) {
            positions[i * 3 + 1] = -10000;
            lives[i] = 0;
            this.burstParticleData.push({
                active: false,
                x: 0,
                y: 0,
                z: 0,
                vx: 0,
                vy: 0,
                vz: 0,
                life: 0,
                maxLife: 1,
                size: 1,
                type: 0,
                color: new THREE.Color(0xffffff),
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }
        if (this.isComputeEnabled()) {
            this.particleCompute = new NeonDuskParticleCompute(count, { gravity: 20.0, squareDamping: 0.98 });
            this.particleCompute.createComputeNode();
        }

        const material = this.isWebGPU
            ? createParticleNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                isWebGPU: true,
                particleCompute: this.particleCompute,
            })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uTwinkle: { value: 0 }, // Added uTwinkle uniform
                    uColorShift: { value: 0 },
                },
                vertexShader: particleVertexShader,
                fragmentShader: particleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });

        this.burstParticles = new THREE.Points(geometry, material);
        this.burstParticles.renderOrder = 300;
        this.scene.add(this.burstParticles);
    }

    // =========================================================================
    // POST-PROCESSING
    // =========================================================================

    setupPostProcessing() {
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.postProcessing) {
            this.postProcessing.dispose?.();
            this.postProcessing = null;
        }

        if (this.isWebGPU) {
            const debug = this.initDebugConfig();
            const enablePost = this.activePreset.enableBloom || this.activePreset.enableVHS;
            if (debug.noPost || !enablePost) {
                this.composer = null;
                this.bloomPass = null;
                this.vhsPass = null;
                this.vignettePass = null;
                return;
            }

            const bloomStrength = this.activePreset.enableBloom ? this.activePreset.bloomStrength ?? 0.2 : 0.0;
            const bloomRadius = this.activePreset.bloomRadius ?? 0.35;
            const bloomThreshold = this.activePreset.bloomThreshold ?? 0.55;
            const rayIntensity = debug.noRays ? 0 : this.activePreset.rayIntensity ?? 0.35;

            this.postProcessing = new NeonDuskPost(this.renderer, this.scene, this.camera, {
                useMRT: !debug.noMRT,
                bloomStrength,
                bloomRadius,
                bloomThreshold,
                bloomDownsample: 0.85,
                vignetteOffset: 1.0,
                vignetteDarkness: 0.4,
                grainIntensity: 0.02,
                grainScale: 120.0,
                saturation: 1.08,
                rayIntensity,
                enableRays: !debug.noRays,
            });
            this.applyRenderScale(true);

            this.composer = null;
            this.bloomPass = null;
            this.vhsPass = null;
            this.vignettePass = null;
            return;
        }

        const debug = this.initDebugConfig();
        if (debug.noPost) {
            return;
        }

        if (!this.activePreset.enableBloom && !this.activePreset.enableVHS) {
            return;
        }

        // Use a multisampled render target to enable MSAA with post-processing (WebGL 2)
        // This is critical for preventing aliasing/flickering on the grid lines
        const renderTarget = new THREE.WebGLRenderTarget(
            window.innerWidth,
            window.innerHeight,
            {
                samples: 4, // 4x MSAA
                type: THREE.HalfFloatType, // HDR support
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                stencilBuffer: false,
                depthBuffer: true,
            },
        );

        this.composer = new EffectComposer(this.renderer, renderTarget);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        if (this.activePreset.enableBloom) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                this.activePreset.bloomStrength,
                this.activePreset.bloomRadius || 0.3,
                this.activePreset.bloomThreshold || 0.6,
            );
            this.composer.addPass(this.bloomPass);
        }

        /*
        if (this.activePreset.enableVHS) {
            this.vhsPass = new ShaderPass(VHSShader);
            this.vhsPass.uniforms.uResolution.value = new THREE.Vector2(
                window.innerWidth,
                window.innerHeight
            );
            this.vhsPass.uniforms.uIntensity.value = 0.6;
            this.composer.addPass(this.vhsPass);
        }
        */

        // Vignette pass
        this.vignettePass = new ShaderPass(VignetteShader);
        this.vignettePass.uniforms.uDarkness.value = 0.5;
        this.vignettePass.uniforms.uOffset.value = 1.2;
        this.composer.addPass(this.vignettePass);

        this.applyRenderScale(true);
    }

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================

    setupEventListeners() {
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock(data);
            }
        });

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

        this.eventUnsubscribers.push(pieceLockUnsub, lineClearUnsub, comboUnsub);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    handlePieceLock(data) {
        const piece = data?.piece;
        const currentTime = this.time;
        const scrollSpeed = this.activePreset.gridScrollSpeed;
        const scrollOffset = (currentTime * scrollSpeed) / 6.0; // Convert distance to cells (spacing 6.0)

        // Spawn grid highlights for tetromino shape
        if (piece) {
            const pieceType = piece.type;
            const shape = this.tetrominoShapes[pieceType] || this.tetrominoShapes.T;
            const color = this.getPieceColor(pieceType);

            let gridX = piece.x !== undefined ? (piece.x - 4.5) : (this.random() - 0.5) * 10;
            // Spread pieces across the fuller grid (multiply by 4) while keeping shape contiguous
            const spreadFactor = 4.0;
            gridX = Math.round(gridX * spreadFactor);

            const gridZ = Math.floor(scrollOffset + 5 + this.random() * 10);
            const rotation = piece.rotation || 0;

            // Trigger pixel twinkle
            // Trigger pixel twinkle/glitch
            this.effectState.pixelTwinkle = 2.0;
            this.effectState.highlightTwinkle = 1.2; // Medium glitch effect (was 0.8)

            for (const block of shape) {
                let rx = block.x;
                let ry = block.y;

                for (let r = 0; r < rotation; r++) {
                    const temp = rx;
                    rx = -ry;
                    ry = temp;
                }

                this.spawnHighlightCell(gridX + rx, gridZ + ry, color, scrollOffset);
            }

            const waveWorldX = gridX * 6.0 + 3.0;
            const waveWorldZ = -(gridZ - scrollOffset) * 6.0 + this.grid.position.z - 1.0;
            this.gridWaveOrigin.set(waveWorldX, waveWorldZ);
            this.gridWaveTime = 0;
            this.effectState.gridWaveIntensity = Math.min(
                1,
                this.effectState.gridWaveIntensity + 0.8,
            );
        }

        // Create rising squares burst
        this.createRisingSquares((this.random() - 0.5) * 100);

        // Effect state updates
        this.effectState.gridPulseIntensity = Math.min(1, this.effectState.gridPulseIntensity + 0.25);
        this.effectState.mountainShockwave = 0.5;

        if (this.starfield) {
            this.setMaterialUniform(this.starfield.material, 'uEventBoost', 0.3);
        }
    }

    handleLineClear(data) {
        const lineCount = data?.lineCount || 1;

        this.effectState.gridPulseIntensity = Math.min(1, this.effectState.gridPulseIntensity + 0.3 * lineCount);
        this.effectState.mountainPulseIntensity = Math.min(1, lineCount * 0.25);

        // Spawn hologram rings from sun
        if (lineCount >= 2) {
            this.createHologramRing();
        }
        if (lineCount >= 3) {
            this.effectState.sunPulseIntensity = Math.min(1, this.effectState.sunPulseIntensity + 0.4);
            this.createHologramRing();
        }
        if (lineCount >= 4) {
            this.effectState.sunPulseIntensity = 1.0;
            this.createHologramRing();
            this.createHologramRing();
        }
    }

    handleCombo(data) {
        const comboCount = data?.comboCount || 0;

        this.effectState.rimGlowIntensity = Math.min(2.0, 1.0 + comboCount * 0.15);
        this.effectState.highlightTwinkle = Math.min(1.5, comboCount * 0.2);
        this.effectState.colorShift = Math.min(1, comboCount * 0.12);

        if (comboCount >= 2) {
            this.effectState.sunPulseIntensity = Math.min(1, this.effectState.sunPulseIntensity + 0.2);
        }

        if (comboCount >= 2 && this.random() < 0.35) {
            this.spawnShootingStar();
        }

        if (this.starfield) {
            this.setMaterialUniform(
                this.starfield.material,
                'uEventBoost',
                Math.min(0.5, comboCount * 0.08),
            );
        }

        // Trigger VHS glitch on combos
        this.effectState.vhsIntensity = Math.min(1.5, this.effectState.vhsIntensity + 0.5 + comboCount * 0.1);
    }

    // =========================================================================
    // EFFECT HELPERS
    // =========================================================================

    getPieceColor(pieceType) {
        const colorMap = {
            I: new THREE.Color(0x00ffff),
            O: new THREE.Color(0xffff00),
            T: new THREE.Color(0xff00ff),
            S: new THREE.Color(0x00ff88),
            Z: new THREE.Color(0xff0088),
            J: new THREE.Color(0x00aaff),
            L: new THREE.Color(0xff8800),
        };
        return colorMap[pieceType] || this.neonColors[0];
    }

    getInactiveHighlightIndex() {
        if (!this.highlightData) return -1;
        for (let i = 0; i < this.highlightData.length; i++) {
            if (!this.highlightData[i].active) return i;
        }
        return -1;
    }

    spawnHighlightCell(gridX, gridZ, color, scrollOffset) {
        if (this.isComputeEnabled() && this.highlightCompute && this.highlightData?.length) {
            const index = this.getInactiveHighlightIndex();
            if (index === -1) return;

            const intensity = 2.0 + this.random() * 0.5;
            const phase = gridZ * 0.5 + intensity * 2.0;
            const worldX = gridX * 6.0 + 3.0;
            const worldY = 0.06;
            const worldZ = -(gridZ - scrollOffset) * 6.0 + this.grid.position.z - 1.0;

            const highlight = this.highlightData[index];
            if (!highlight.active) {
                this.activeHighlightCount += 1;
            }
            highlight.active = true;
            highlight.x = worldX;
            highlight.y = worldY;
            highlight.z = worldZ;
            highlight.intensity = intensity;
            highlight.phase = phase;
            highlight.color = color.clone();

            this.highlightCompute.spawn(index, {
                x: worldX,
                y: worldY,
                z: worldZ,
                intensity,
                color,
                phase,
            });
            return;
        }

        if (this.highlightInstanced && this.highlightInstancedMode === 'instanced' && this.highlightData?.length) {
            const index = this.getInactiveHighlightIndex();
            if (index === -1) return;

            const intensity = 2.0 + this.random() * 0.5;
            const phase = gridZ * 0.5 + intensity * 2.0;
            const worldX = gridX * 6.0 + 3.0;
            const worldY = 0.06;
            const worldZ = -(gridZ - scrollOffset) * 6.0 + this.grid.position.z - 1.0;

            const data = this.highlightData[index];
            if (!data.active) {
                this.activeHighlightCount += 1;
            }
            data.active = true;
            data.life = 1.0;
            data.maxLife = 15.0 + this.random() * 10.0;
            data.intensity = intensity;
            data.gridZ = gridZ;
            data.scrollOffset = scrollOffset;
            data.phase = phase;
            data.color.copy(color);
            data.x = worldX;
            data.y = worldY;
            data.z = worldZ;

            const matrix = new THREE.Matrix4();
            matrix.makeTranslation(worldX, worldY, worldZ);
            this.highlightInstanced.setMatrixAt(index, matrix);

            const colorAttr = this.highlightInstancedAttributes?.color;
            const intensityAttr = this.highlightInstancedAttributes?.intensity;
            if (colorAttr) {
                const i3 = index * 3;
                colorAttr.array[i3] = color.r;
                colorAttr.array[i3 + 1] = color.g;
                colorAttr.array[i3 + 2] = color.b;
                colorAttr.needsUpdate = true;
            }
            if (intensityAttr) {
                intensityAttr.array[index] = intensity;
                intensityAttr.needsUpdate = true;
            }
            this.highlightInstanced.instanceMatrix.needsUpdate = true;
            return;
        }

        const highlight = this.highlightPool.find((h) => !h.userData.active);
        if (!highlight) return;

        highlight.userData.active = true;
        highlight.userData.life = 1.0;
        highlight.userData.maxLife = 15.0 + this.random() * 10.0;
        highlight.userData.intensity = 2.0 + this.random() * 0.5;
        highlight.userData.gridZ = gridZ;
        highlight.userData.scrollOffset = scrollOffset;

        highlight.position.x = gridX * 6.0; // Centered on grid line or cell?
        // If grid lines are at 0, 6, 12... and we want to fill the cell between 0 and 6, center is 3.
        // Actually, the shader draws lines based on gridSpacing.
        // Let's assume gridX is the cell index.
        // gridX * 6.0 is the line position.
        // We probably want to be ON the cell, so + 3.0?
        // Old was * 3.0 + 1.5. So it was centered in the 3.0 cell.
        // New should be * 6.0 + 3.0.
        highlight.position.x = gridX * 6.0 + 3.0;
        highlight.position.y = 0.06; // Raised from 0.02 to 0.06 to prevent Z-fighting/flickering
        highlight.position.z = -(gridZ - scrollOffset) * 6.0 + this.grid.position.z - 1.0; // Adjusted offset for grid alignment

        this.setMaterialUniform(highlight.material, 'uColor', color);
        this.setMaterialUniform(highlight.material, 'uIntensity', highlight.userData.intensity);

        highlight.visible = true;
        this.gridHighlights.push(highlight);
    }

    createRisingSquares(x) {
        const count = 8;
        const positions = this.burstParticles.geometry.attributes.position.array;
        const colors = this.burstParticles.geometry.attributes.color.array;
        const sizes = this.burstParticles.geometry.attributes.aSize.array;
        const lives = this.burstParticles.geometry.attributes.aLife.array;
        const types = this.burstParticles.geometry.attributes.aType.array;

        for (let i = 0; i < count; i++) {
            const idx = this.burstParticleData.findIndex((p) => !p.active);
            if (idx === -1) break;

            const p = this.burstParticleData[idx];
            const color = this.neonColors[Math.floor(this.random() * this.neonColors.length)];

            p.active = true;
            p.x = x + (this.random() - 0.5) * 30;
            p.y = -10;
            p.z = (this.random() - 0.5) * 20 - 30;
            p.vx = (this.random() - 0.5) * 1;
            p.vy = 15 + this.random() * 10;
            p.vz = (this.random() - 0.5) * 1;
            p.life = 1.0;
            p.maxLife = 2.0 + this.random() * 1.0;
            p.size = 15 + this.random() * 10;
            p.type = 2; // Square
            p.color = color;

            if (this.isComputeEnabled() && this.particleCompute) {
                this.particleCompute.spawn(idx, p);
            }

            const i3 = idx * 3;
            positions[i3] = p.x;
            positions[i3 + 1] = p.y;
            positions[i3 + 2] = p.z;
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
            sizes[idx] = p.size;
            lives[idx] = p.life;
            types[idx] = p.type;
        }

        this.burstParticles.geometry.attributes.position.needsUpdate = true;
        this.burstParticles.geometry.attributes.color.needsUpdate = true;
        this.burstParticles.geometry.attributes.aSize.needsUpdate = true;
        this.burstParticles.geometry.attributes.aLife.needsUpdate = true;
        this.burstParticles.geometry.attributes.aType.needsUpdate = true;
    }

    createHologramRingPool() {
        const poolSize = this.activePreset.maxRings;

        if (this.hologramRingInstanced) {
            this.scene?.remove(this.hologramRingInstanced);
            this.hologramRingInstanced.geometry?.dispose();
            if (this.hologramRingInstanced.material) {
                this.hologramRingInstanced.material.dispose();
            }
            this.hologramRingInstanced = null;
            this.hologramRingAttributes = null;
            this.hologramRingData = [];
        }

        if (this.hologramRings.length) {
            this.hologramRings.forEach((ring) => {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
            });
            this.hologramRings = [];
        }

        if (!poolSize || poolSize <= 0) {
            this.hologramRingAttributes = null;
            this.hologramRingData = [];
            return;
        }

        const geometry = new THREE.PlaneGeometry(1200, 1200);
        const material = this.isWebGPU
            ? createRingNodeMaterial({ useInstancing: true })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0xff00ff) },
                    uLife: { value: 1.0 },
                    uRadius: { value: 0.05 },
                    uMaxRadius: { value: 1.0 },
                },
                vertexShader: ringVertexShader,
                fragmentShader: ringFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

        if (!this.isWebGPU) {
            material.defines = { USE_INSTANCING: '' };
        }

        const instanced = new THREE.InstancedMesh(geometry, material, poolSize);
        instanced.frustumCulled = false;
        instanced.renderOrder = 100;
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const colors = new Float32Array(poolSize * 3);
        const lives = new Float32Array(poolSize);
        const radii = new Float32Array(poolSize);
        const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
        const lifeAttr = new THREE.InstancedBufferAttribute(lives, 1);
        const radiusAttr = new THREE.InstancedBufferAttribute(radii, 1);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        lifeAttr.setUsage(THREE.DynamicDrawUsage);
        radiusAttr.setUsage(THREE.DynamicDrawUsage);

        geometry.setAttribute('aColor', colorAttr);
        geometry.setAttribute('aLife', lifeAttr);
        geometry.setAttribute('aRadius', radiusAttr);

        this.hologramRingInstanced = instanced;
        this.hologramRingAttributes = { color: colorAttr, life: lifeAttr, radius: radiusAttr };
        this.hologramRingData = [];

        const identity = new THREE.Matrix4();
        for (let i = 0; i < poolSize; i++) {
            instanced.setMatrixAt(i, identity);
            this.hologramRingData.push({
                active: false,
                startTime: 0,
                duration: 1.0,
                maxRadius: 1.0,
                color: new THREE.Color(0xff00ff),
            });
        }

        instanced.instanceMatrix.needsUpdate = true;
        this.scene.add(instanced);
    }

    createHologramRing() {
        if (!this.hologramRingInstanced) {
            this.createHologramRingPool();
        }

        if (this.hologramRingInstanced && this.hologramRingData.length) {
            const index = this.hologramRingData.findIndex((ring) => !ring.active);
            if (index === -1) return;

            const color = this.neonColors[Math.floor(this.random() * this.neonColors.length)];
            const data = this.hologramRingData[index];
            data.active = true;
            data.startTime = this.time;
            data.duration = 1.5 + this.random() * 0.5;
            data.maxRadius = 1.0;
            data.color.copy(color);

            const pos = this.sun ? this.sun.position : new THREE.Vector3(this.sunPosition.x, this.sunPosition.y, 0);
            const matrix = new THREE.Matrix4();
            matrix.compose(
                new THREE.Vector3(pos.x, pos.y, pos.z + 10),
                new THREE.Quaternion(),
                new THREE.Vector3(1, 1, 1),
            );
            this.hologramRingInstanced.setMatrixAt(index, matrix);

            const colorAttr = this.hologramRingAttributes?.color;
            const lifeAttr = this.hologramRingAttributes?.life;
            const radiusAttr = this.hologramRingAttributes?.radius;
            if (colorAttr) {
                const i3 = index * 3;
                colorAttr.array[i3] = color.r;
                colorAttr.array[i3 + 1] = color.g;
                colorAttr.array[i3 + 2] = color.b;
                colorAttr.needsUpdate = true;
            }
            if (lifeAttr) {
                lifeAttr.array[index] = 1.0;
                lifeAttr.needsUpdate = true;
            }
            if (radiusAttr) {
                radiusAttr.array[index] = 0.05;
                radiusAttr.needsUpdate = true;
            }
            this.hologramRingInstanced.instanceMatrix.needsUpdate = true;
            return;
        }

        if (this.hologramRings.length >= this.activePreset.maxRings) return;

        const geometry = new THREE.PlaneGeometry(1200, 1200); // Much BIGGER rings
        const color = this.neonColors[Math.floor(this.random() * this.neonColors.length)];

        const material = this.isWebGPU
            ? createRingNodeMaterial()
            : new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: color },
                    uLife: { value: 1.0 },
                    uRadius: { value: 0.05 },
                    uMaxRadius: { value: 1.0 },
                },
                vertexShader: ringVertexShader,
                fragmentShader: ringFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

        if (this.isWebGPU) {
            this.setMaterialUniform(material, 'uColor', color);
            this.setMaterialUniform(material, 'uRadius', 0.05);
            this.setMaterialUniform(material, 'uMaxRadius', 1.0);
            this.setMaterialUniform(material, 'uLife', 1.0);
        }

        const ring = new THREE.Mesh(geometry, material);
        ring.position.copy(this.sun.position);
        ring.position.z += 10;
        ring.renderOrder = 100;

        ring.userData = {
            startTime: this.time,
            duration: 1.5 + this.random() * 0.5,
            maxRadius: 1.0,
        };

        this.hologramRings.push(ring);
        this.scene.add(ring);
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    animate() {
        if (!this.isActive) return;

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);

        const delta = this.fixedDelta !== null ? this.fixedDelta : this.clock.getDelta();
        this.time += delta;

        this.beginProfileFrame();

        this.updateDynamicResolution(delta);
        this.updatePerformanceGuards(delta);
        this.updateStarLOD(delta);

        this.updateCompute(delta);
        this.markProfile('compute');

        this.updateCamera();
        this.updateSun(delta);
        this.updateMountains(delta);
        this.updateGrid(delta);
        this.updateHighlights(delta);
        this.updateRetroPixels(delta); // Update pixels
        this.updateBurstParticles(delta);
        this.updateHologramRings(delta);
        this.updateStars(delta);
        this.decayEffects(delta);
        this.updateBaselineStats(delta);
        this.markProfile('update');

        if (this.postProcessing) {
            if (this.postProcessing.updateTime) {
                this.postProcessing.updateTime(this.time);
            }
            this.postProcessing.render();
        } else if (this.composer) {
            if (this.vhsPass) {
                this.vhsPass.uniforms.uTime.value = this.time;
                this.vhsPass.uniforms.uIntensity.value = this.effectState.vhsIntensity; // Update intensity
            }
            this.composer.render();
        } else if (this.isWebGPU && typeof this.renderer.renderAsync === 'function') {
            this.renderer.renderAsync(this.scene, this.camera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        this.markProfile('render');
        this.endProfileFrame();
        this.updateGpuTiming(delta);
    }

    updateCamera() {
        // Gentle sway animation - REDUCED to prevent grid aliasing movement
        const t = this.time * 0.02; // Slower
        this.camera.position.x = Math.sin(t) * 0.5; // Was 4 - drastically reduced
        this.camera.position.y = 25 + Math.cos(t * 0.7) * 1.0;
        this.camera.position.z = 50 + Math.sin(t * 0.5) * 1.0;

        this.camera.lookAt(
            Math.sin(t * 0.4) * 3,
            10 + Math.cos(t * 0.3),
            -100,
        );
    }

    updateSun(delta) {
        // Sun stays centered - no drift for clean look
        this.setMaterialUniform(this.sun?.material, 'uTime', this.time);
        this.setMaterialUniform(this.sun?.material, 'uPulseIntensity', this.effectState.sunPulseIntensity);

        // Update single glow layer
        if (this.sunGlow) {
            this.setMaterialUniform(this.sunGlow.material, 'uPulseIntensity', this.effectState.sunPulseIntensity);
            const scale = 1 + Math.sin(this.time * 0.3) * 0.03 + this.effectState.sunPulseIntensity * 0.1;
            this.sunGlow.scale.setScalar(scale);
        }

        this.sunPosition = { x: this.sun.position.x, y: this.sun.position.y };

        if (this.postProcessing?.updateSun && this.sun) {
            const projected = this.sun.position.clone().project(this.camera);
            this.sunScreen.set((projected.x + 1) * 0.5, (projected.y + 1) * 0.5);
            const debug = this.initDebugConfig();
            const baseIntensity = debug.noRays ? 0 : this.activePreset.rayIntensity ?? 0.35;
            const intensity = baseIntensity * (0.6 + this.effectState.sunPulseIntensity * 0.8);
            this.postProcessing.updateSun(this.sunScreen, intensity);
        }
    }

    updateMountains(delta) {
        const material = this.mountainMaterial || this.mountains[0]?.material;
        if (!material) return;

        this.setMaterialUniform(material, 'uTime', this.time);
        this.setMaterialUniform(material, 'uRimIntensity', this.effectState.rimGlowIntensity);
        this.setMaterialUniform(material, 'uShockwave', this.effectState.mountainShockwave);
    }

    updateGrid(delta) {
        this.setMaterialUniform(this.grid?.material, 'uTime', this.time);
        this.setMaterialUniform(this.grid?.material, 'uPulseIntensity', this.effectState.gridPulseIntensity);

        // Update sun position for reflection
        if (this.sun) {
            this.setMaterialUniform(this.grid?.material, 'uSunPosition', this.sun.position);
        }

        this.gridWaveTime += delta;
        this.setMaterialUniform(this.grid?.material, 'uWaveTime', this.gridWaveTime);
        this.setMaterialUniform(this.grid?.material, 'uWaveOrigin', this.gridWaveOrigin);
        this.setMaterialUniform(this.grid?.material, 'uWaveIntensity', this.effectState.gridWaveIntensity);
    }

    updateHighlights(delta) {
        if (this.isComputeEnabled() && this.highlightCompute?.computeNode) {
            if (this.activeHighlightCount <= 0) return;
            this.setMaterialUniform(this.highlightInstanced?.material, 'uTime', this.time);
            this.setMaterialUniform(
                this.highlightInstanced?.material,
                'uTwinkle',
                this.effectState.highlightTwinkle,
            );

            const scrollSpeed = this.activePreset.gridScrollSpeed;
            const maxZ = (this.grid?.position?.z ?? -50) + 320;
            const stateData = this.highlightCompute?.stateData;
            for (let i = 0; i < this.highlightData.length; i++) {
                const data = this.highlightData[i];
                if (!data.active) continue;
                data.z += scrollSpeed * delta;
                if (stateData) {
                    const base = i * 4;
                    stateData[base] = data.x;
                    stateData[base + 1] = data.y;
                    stateData[base + 2] = data.z;
                    stateData[base + 3] = data.intensity;
                }
                if (data.z > maxZ) {
                    data.active = false;
                    data.intensity = 0;
                    this.activeHighlightCount = Math.max(0, this.activeHighlightCount - 1);
                    if (this.highlightCompute) {
                        this.highlightCompute.deactivate(i);
                    }
                }
            }
            return;
        }

        if (this.highlightInstanced && this.highlightInstancedMode === 'instanced' && this.highlightData?.length) {
            if (this.activeHighlightCount <= 0) return;

            this.setMaterialUniform(this.highlightInstanced.material, 'uTime', this.time);
            this.setMaterialUniform(this.highlightInstanced.material, 'uTwinkle', this.effectState.highlightTwinkle);

            const scrollSpeed = this.activePreset.gridScrollSpeed;
            const intensityAttr = this.highlightInstancedAttributes?.intensity;
            const matrix = new THREE.Matrix4();
            let matrixUpdate = false;
            let intensityUpdate = false;

            for (let i = 0; i < this.highlightData.length; i++) {
                const data = this.highlightData[i];
                if (!data.active) continue;

                data.z += scrollSpeed * delta;
                const relativeZ = -(data.z - this.grid.position.z + 1.0) / 6.0;

                const distanceFade = Math.max(0.3, 1.0 - Math.max(0, -relativeZ - 30) / 50);

                let twinkle = 1.0;
                if (this.effectState.highlightTwinkle > 0) {
                    const glitch = Math.sin(this.time * 20.0 + data.phase);
                    twinkle = 1.0 + glitch * this.effectState.highlightTwinkle * 0.4;
                }

                const intensity = data.intensity * distanceFade * twinkle;
                if (intensityAttr) {
                    intensityAttr.array[i] = intensity;
                    intensityUpdate = true;
                }

                matrix.makeTranslation(data.x, data.y, data.z);
                this.highlightInstanced.setMatrixAt(i, matrix);
                matrixUpdate = true;

                if (relativeZ < -60) {
                    data.active = false;
                    if (intensityAttr) {
                        intensityAttr.array[i] = 0;
                        intensityUpdate = true;
                    }
                    this.activeHighlightCount = Math.max(0, this.activeHighlightCount - 1);
                }
            }

            if (matrixUpdate) {
                this.highlightInstanced.instanceMatrix.needsUpdate = true;
            }
            if (intensityAttr && intensityUpdate) {
                intensityAttr.needsUpdate = true;
            }
            return;
        }

        const scrollSpeed = this.activePreset.gridScrollSpeed;

        for (let i = this.gridHighlights.length - 1; i >= 0; i--) {
            const highlight = this.gridHighlights[i];
            const data = highlight.userData;

            // Update position with grid scroll (world-space, independent per highlight)
            highlight.position.z += scrollSpeed * delta;
            const relativeZ = -(highlight.position.z - this.grid.position.z + 1.0) / 6.0;

            // Distance fade
            const distanceFade = Math.max(0.3, 1.0 - Math.max(0, -relativeZ - 30) / 50);

            // Twinkle effect (Glitchy blink)
            let twinkle = 1.0;
            if (this.effectState.highlightTwinkle > 0) {
                // Medium frequency blink - visible glitch feel
                const phase = (data.gridZ * 0.5 + data.intensity * 2.0);
                // Faster wave (20.0) for glitch feel
                const glitch = Math.sin(this.time * 20.0 + phase);
                twinkle = 1.0 + glitch * this.effectState.highlightTwinkle * 0.4;
            }

            this.setMaterialUniform(
                highlight.material,
                'uIntensity',
                data.intensity * distanceFade * twinkle,
            );
            this.setMaterialUniform(highlight.material, 'uTime', this.time);
            this.setMaterialUniform(
                highlight.material,
                'uTwinkle',
                this.effectState.highlightTwinkle,
            );
            // Remove when past horizon
            if (relativeZ < -60) {
                highlight.visible = false;
                data.active = false;
                this.gridHighlights.splice(i, 1);
            }
        }
    }

    // =========================================================================
    // RETRO PIXELS (Floating Squares)
    // =========================================================================

    createRetroPixels() {
        const count = this.activePreset.pixelCount || 150;
        const geometry = new THREE.BufferGeometry();

        if (this.retroPixels) {
            this.scene.remove(this.retroPixels);
            this.retroPixels.geometry.dispose();
            if (this.retroPixels.material) {
                this.retroPixels.material.dispose();
            }
            this.retroPixels = null;
        }

        if (this.retroPixelTrails) {
            this.scene.remove(this.retroPixelTrails);
            this.retroPixelTrails.geometry.dispose();
            if (this.retroPixelTrails.material) {
                this.retroPixelTrails.material.dispose();
            }
            this.retroPixelTrails = null;
        }

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3); // Missing color attribute!
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const types = new Float32Array(count); // All type 2 (square)

        const palette = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0xff00ff), // Magenta
            new THREE.Color(0xffff00), // Yellow
            new THREE.Color(0xffffff), // White
        ];

        this.retroPixelData = [];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread across the world
            // Spread across the world - closer to camera
            const x = (this.random() - 0.5) * 500;
            const y = this.random() * 100 + 10;
            // Z from 50 (camera) to -600 (horizon)
            const z = 50 - this.random() * 650;

            positions[i3] = x;
            positions[i3 + 1] = y;
            positions[i3 + 2] = z;

            const col = palette[Math.floor(this.random() * palette.length)];
            colors[i3] = col.r;
            colors[i3 + 1] = col.g;
            colors[i3 + 2] = col.b;

            sizes[i] = 0.5 + this.random() * 1.5; // Tiny specks (0.5-2 base size)
            lives[i] = this.random();
            types[i] = 2.0; // Square type

            this.retroPixelData.push({
                vx: (this.random() - 0.5) * 5, // Subtle drift x
                vy: 5 + this.random() * 10, // Float UP
                vz: (this.random() - 0.5) * 5, // Subtle drift z
                maxLife: 1.0,
                colorType: Math.floor(this.random() * 5),
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

        const trailGeometry = new THREE.BufferGeometry();
        const trailPositions = new Float32Array(positions.length);
        const trailColors = new Float32Array(colors.length);
        const trailSizes = new Float32Array(sizes.length);
        const trailLives = new Float32Array(lives.length);
        trailPositions.set(positions);
        trailColors.set(colors);
        trailSizes.set(sizes);
        trailLives.set(lives);

        trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
        trailGeometry.setAttribute('aSize', new THREE.BufferAttribute(trailSizes, 1));
        trailGeometry.setAttribute('aLife', new THREE.BufferAttribute(trailLives, 1));
        trailGeometry.setAttribute('aType', new THREE.BufferAttribute(types.slice(0), 1));

        this.retroPixelTrailPositions = trailPositions;

        if (this.pixelCompute) {
            this.pixelCompute.dispose();
            this.pixelCompute = null;
        }
        if (this.isComputeEnabled()) {
            this.pixelCompute = new NeonDuskPixelCompute(count, { maxY: 150.0, minY: 0.0 });
            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                const pixel = {
                    x: positions[i3],
                    y: positions[i3 + 1],
                    z: positions[i3 + 2],
                    vx: this.retroPixelData[i]?.vx ?? 0,
                    vy: this.retroPixelData[i]?.vy ?? 0,
                    vz: this.retroPixelData[i]?.vz ?? 0,
                    life: lives[i],
                    size: sizes[i],
                    type: types[i],
                    color: new THREE.Color(colors[i3], colors[i3 + 1], colors[i3 + 2]),
                };
                this.pixelCompute.spawn(i, pixel);
            }
            this.pixelCompute.createComputeNode();
        }

        const material = this.isWebGPU
            ? createRetroPixelNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                isWebGPU: true,
                particleCompute: this.pixelCompute,
                colorShift: this.effectState.colorShift,
            })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uColor: { value: new THREE.Color(0xffffff) },
                    uTwinkle: { value: 0 }, // NEW
                    uColorShift: { value: 0 },
                },
                vertexShader: particleVertexShader,
                fragmentShader: particleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true, // Required for vColor attribute
            });

        this.retroPixels = new THREE.Points(geometry, material);
        this.retroPixels.renderOrder = 0; // Render properly in scene
        this.retroPixels.frustumCulled = false;
        this.scene.add(this.retroPixels);

        const trailMaterial = this.isWebGPU
            ? createPixelTrailNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                isWebGPU: true,
                particleCompute: this.pixelCompute,
                trailLength: 0.7,
                colorShift: this.effectState.colorShift,
                enableColorShift: true,
            })
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uColor: { value: new THREE.Color(0xffffff) },
                    uTwinkle: { value: 0 },
                    uColorShift: { value: 0 },
                },
                vertexShader: particleVertexShader,
                fragmentShader: particleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });

        this.retroPixelTrails = new THREE.Points(trailGeometry, trailMaterial);
        this.retroPixelTrails.renderOrder = -5;
        this.retroPixelTrails.frustumCulled = false;
        this.scene.add(this.retroPixelTrails);
    }

    updateRetroPixels(delta) {
        if (!this.retroPixels) return;

        if (this.isComputeEnabled() && this.pixelCompute?.computeNode) {
            this.setMaterialUniform(this.retroPixels.material, 'uTime', this.time);
            this.setMaterialUniform(this.retroPixels.material, 'uTwinkle', this.effectState.pixelTwinkle);
            this.setMaterialUniform(this.retroPixels.material, 'uColorShift', this.effectState.colorShift);
            if (this.retroPixelTrails) {
                this.setMaterialUniform(this.retroPixelTrails.material, 'uTwinkle', this.effectState.pixelTwinkle);
                this.setMaterialUniform(this.retroPixelTrails.material, 'uColorShift', this.effectState.colorShift);
            }
            return;
        }

        const positions = this.retroPixels.geometry.attributes.position.array;
        const lives = this.retroPixels.geometry.attributes.aLife.array;
        const baseSizes = this.retroPixels.geometry.attributes.aSize.array;
        const trailPositions = this.retroPixelTrails?.geometry.attributes.position.array;
        const trailLives = this.retroPixelTrails?.geometry.attributes.aLife.array;
        const trailSizes = this.retroPixelTrails?.geometry.attributes.aSize.array;

        const sunPos = this.sun ? this.sun.position : null;
        const attraction = 0.4 + this.effectState.colorShift * 0.6 + this.effectState.sunPulseIntensity * 0.4;
        const trailLength = 0.7;

        for (let i = 0; i < this.retroPixelData.length; i++) {
            const p = this.retroPixelData[i];
            const i3 = i * 3;

            if (sunPos) {
                const dx = sunPos.x - positions[i3];
                const dy = sunPos.y - positions[i3 + 1];
                const dz = sunPos.z - positions[i3 + 2];
                const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
                p.vx += (dx / dist) * attraction * delta;
                p.vy += (dy / dist) * attraction * delta;
                p.vz += (dz / dist) * attraction * delta;
                p.vx *= 0.98;
                p.vy *= 0.98;
                p.vz *= 0.98;
            }

            // Move up
            positions[i3] += p.vx * delta;
            positions[i3 + 1] += p.vy * delta;
            positions[i3 + 2] += p.vz * delta;

            // Wrap around
            if (positions[i3 + 1] > 150) {
                positions[i3 + 1] = 0;
                positions[i3] = (this.random() - 0.5) * 500;
                positions[i3 + 2] = 50 - this.random() * 650; // Random Z including close
            }

            // Pulse life
            lives[i] = 0.5 + 0.5 * Math.sin(this.time * 2 + i * 10);

            if (trailPositions && trailLives && trailSizes) {
                trailPositions[i3] = positions[i3] - p.vx * trailLength;
                trailPositions[i3 + 1] = positions[i3 + 1] - p.vy * trailLength;
                trailPositions[i3 + 2] = positions[i3 + 2] - p.vz * trailLength;
                trailLives[i] = lives[i] * 0.35;
                trailSizes[i] = baseSizes[i] * 0.6;
            }
        }

        this.retroPixels.geometry.attributes.position.needsUpdate = true;
        this.retroPixels.geometry.attributes.aLife.needsUpdate = true;
        this.setMaterialUniform(this.retroPixels.material, 'uTime', this.time);
        this.setMaterialUniform(this.retroPixels.material, 'uTwinkle', this.effectState.pixelTwinkle);
        this.setMaterialUniform(this.retroPixels.material, 'uColorShift', this.effectState.colorShift);

        if (this.retroPixelTrails) {
            this.retroPixelTrails.geometry.attributes.position.needsUpdate = true;
            this.retroPixelTrails.geometry.attributes.aLife.needsUpdate = true;
            this.retroPixelTrails.geometry.attributes.aSize.needsUpdate = true;
            this.setMaterialUniform(this.retroPixelTrails.material, 'uTwinkle', this.effectState.pixelTwinkle);
            this.setMaterialUniform(this.retroPixelTrails.material, 'uColorShift', this.effectState.colorShift);
        }
    }

    updateBurstParticles(delta) {
        if (!this.burstParticles) return;

        if (this.isComputeEnabled() && this.particleCompute?.computeNode) {
            return;
        }

        const positions = this.burstParticles.geometry.attributes.position.array;
        const lives = this.burstParticles.geometry.attributes.aLife.array;

        for (let i = 0; i < this.burstParticleData.length; i++) {
            const p = this.burstParticleData[i];
            if (!p.active) continue;

            // Physics
            p.x += p.vx * delta;
            p.y += p.vy * delta;
            p.z += p.vz * delta;

            // Rising squares: no gravity, just slow down
            if (p.type === 2) {
                p.vy *= 0.98;
            } else {
                p.vy -= 20 * delta;
            }

            p.life -= delta / p.maxLife;

            if (p.life <= 0) {
                p.active = false;
                p.life = 0;
            }

            const i3 = i * 3;
            positions[i3] = p.x;
            positions[i3 + 1] = p.y;
            positions[i3 + 2] = p.z;
            lives[i] = Math.max(0, p.life);
        }

        this.burstParticles.geometry.attributes.position.needsUpdate = true;
        this.burstParticles.geometry.attributes.aLife.needsUpdate = true;
    }

    updateHologramRings(delta) {
        if (this.hologramRingInstanced && this.hologramRingData.length) {
            const lifeAttr = this.hologramRingAttributes?.life;
            const radiusAttr = this.hologramRingAttributes?.radius;
            const matrix = new THREE.Matrix4();
            let matrixUpdate = false;
            let attrUpdate = false;

            const basePos = this.sun ? this.sun.position : new THREE.Vector3(this.sunPosition.x, this.sunPosition.y, 0);

            for (let i = 0; i < this.hologramRingData.length; i++) {
                const data = this.hologramRingData[i];
                if (!data.active) continue;

                const elapsed = this.time - data.startTime;
                const progress = elapsed / data.duration;

                if (progress >= 1.0) {
                    data.active = false;
                    if (lifeAttr) lifeAttr.array[i] = 0;
                    if (radiusAttr) radiusAttr.array[i] = 0;
                    attrUpdate = true;
                    continue;
                }

                const life = 1.0 - progress;
                const radius = progress;
                if (lifeAttr) lifeAttr.array[i] = life;
                if (radiusAttr) radiusAttr.array[i] = radius;
                attrUpdate = true;

                const scale = 1 + progress * 6;
                matrix.compose(
                    new THREE.Vector3(basePos.x, basePos.y, basePos.z + 10),
                    new THREE.Quaternion(),
                    new THREE.Vector3(scale, scale, scale),
                );
                this.hologramRingInstanced.setMatrixAt(i, matrix);
                matrixUpdate = true;
            }

            if (matrixUpdate) {
                this.hologramRingInstanced.instanceMatrix.needsUpdate = true;
            }
            if (attrUpdate) {
                if (lifeAttr) lifeAttr.needsUpdate = true;
                if (radiusAttr) radiusAttr.needsUpdate = true;
            }
            return;
        }

        for (let i = this.hologramRings.length - 1; i >= 0; i--) {
            const ring = this.hologramRings[i];
            const data = ring.userData;
            const elapsed = this.time - data.startTime;
            const progress = elapsed / data.duration;

            if (progress >= 1.0) {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
                this.hologramRings.splice(i, 1);
                continue;
            }

            this.setMaterialUniform(ring.material, 'uLife', 1.0 - progress);
            this.setMaterialUniform(ring.material, 'uRadius', progress);

            // Expand and follow sun
            ring.position.x = this.sunPosition.x;
            const scale = 1 + progress * 6; // Expand much further (6x instead of 2x)
            ring.scale.setScalar(scale);
        }
    }

    updateNebulas(delta) {
        this.nebulaClouds.forEach((nebula) => {
            nebula.position.x += nebula.userData.speed * delta;
            if (nebula.position.x > nebula.userData.wrapBoundary) {
                nebula.position.x = -nebula.userData.wrapBoundary;
            }
            nebula.material.uniforms.uPulse.value = this.effectState.gridPulseIntensity * 0.5;
            nebula.material.uniforms.uTime.value = this.time;
        });
    }

    updateStars(delta) {
        const parallaxX = -this.camera.position.x * 0.08;
        const parallaxY = -this.camera.position.y * 0.03;

        if (this.starfield) {
            this.starfield.position.x = parallaxX;
            this.starfield.position.y = parallaxY;
            this.setMaterialUniform(this.starfield.material, 'uTime', this.time);
        }

        if (this.constellationLines) {
            this.constellationLines.position.x = parallaxX;
            this.constellationLines.position.y = parallaxY;
        }

        this.updateShootingStars(delta);
    }

    decayEffects(delta) {
        const decay = 0.92 ** (delta * 60);

        this.effectState.gridPulseIntensity *= decay;
        this.effectState.gridWaveIntensity *= decay;
        this.effectState.sunPulseIntensity *= decay;
        this.effectState.mountainPulseIntensity *= decay;
        this.effectState.mountainShockwave *= decay;
        this.effectState.highlightTwinkle *= decay;
        this.effectState.colorShift *= decay;
        this.effectState.vhsIntensity *= 0.85 ** (delta * 60);
        this.effectState.pixelTwinkle *= 0.95 ** (delta * 60); // Slower decay for visible flash

        // Rim glow decays back to 1.0
        this.effectState.rimGlowIntensity = 1.0 + (this.effectState.rimGlowIntensity - 1.0) * decay;

        // Star boost decay
        if (this.starfield) {
            const currentBoost = this.getMaterialUniformValue(this.starfield.material, 'uEventBoost');
            if (typeof currentBoost === 'number') {
                this.setMaterialUniform(this.starfield.material, 'uEventBoost', currentBoost * decay);
            }
        }

        // Clamp small values
        if (this.effectState.gridPulseIntensity < 0.01) this.effectState.gridPulseIntensity = 0;
        if (this.effectState.gridWaveIntensity < 0.01) this.effectState.gridWaveIntensity = 0;
        if (this.effectState.sunPulseIntensity < 0.01) this.effectState.sunPulseIntensity = 0;
        if (this.effectState.mountainPulseIntensity < 0.01) this.effectState.mountainPulseIntensity = 0;
        if (this.effectState.mountainShockwave < 0.01) this.effectState.mountainShockwave = 0;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    onResize() {
        if (!this.camera || !this.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.applyRenderScale(true);
    }

    stop() {
        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Remove resize handler
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Clear highlights
        this.gridHighlights = [];
        this.activeHighlightCount = 0;
        this.hologramRings.forEach((ring) => {
            this.scene.remove(ring);
            ring.geometry.dispose();
            ring.material.dispose();
        });
        this.hologramRings = [];

        if (this.hologramRingInstanced) {
            this.scene?.remove(this.hologramRingInstanced);
            this.hologramRingInstanced.geometry.dispose();
            if (this.hologramRingInstanced.material) {
                this.hologramRingInstanced.material.dispose();
            }
            this.hologramRingInstanced = null;
            this.hologramRingAttributes = null;
            this.hologramRingData = [];
        }

        if (this.mountainBatch) {
            this.scene?.remove(this.mountainBatch);
            this.mountainBatch.geometry?.dispose();
            this.mountainBatch = null;
        }

        if (this.mountainMaterial) {
            this.mountainMaterial.dispose?.();
            this.mountainMaterial = null;
        }
        this.mountains = [];

        if (this.constellationLines) {
            this.scene.remove(this.constellationLines);
            this.constellationLines.geometry.dispose();
            this.constellationLines.material.dispose();
            this.constellationLines = null;
        }

        if (this.shootingStars.length) {
            this.shootingStars.forEach((star) => {
                this.scene.remove(star.mesh);
                star.mesh.geometry.dispose();
                star.mesh.material.dispose();
            });
            this.shootingStars = [];
        }

        if (this.highlightInstanced) {
            this.scene?.remove(this.highlightInstanced);
            this.highlightInstanced.geometry.dispose();
            if (this.highlightInstanced.material) {
                this.highlightInstanced.material.dispose();
            }
            this.highlightInstanced = null;
            this.highlightInstancedAttributes = null;
            this.highlightInstancedMode = 'none';
        }

        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.postProcessing) {
            this.postProcessing.dispose?.();
            this.postProcessing = null;
        }

        if (this.highlightCompute) {
            this.highlightCompute.dispose();
            this.highlightCompute = null;
        }
        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }
        if (this.pixelCompute) {
            this.pixelCompute.dispose();
            this.pixelCompute = null;
        }
        if (this.starCompute) {
            this.starCompute.dispose();
            this.starCompute = null;
        }

        // Dispose Three.js resources LAST to avoid WebGPU errors
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('neon-dusk-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        this.baselineStats = null;
        this.baselineLogged = false;
        this.deviceLostPromise = null;

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        super.stop();
        console.log('[NeonDusk] Theme stopped');
    }
}
