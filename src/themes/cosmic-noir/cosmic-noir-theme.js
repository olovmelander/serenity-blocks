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
import {
    CosmicNoirAtmosphereFlowCompute,
    CosmicNoirSparkCompute,
    CosmicNoirStarTwinkleCompute,
} from './cosmic-noir-compute.js';
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
        mrtAudit: false,
        baseline: false,
        seed: null,
        fixedDeltaMs: null,
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

    return {
        ...defaults,
        forceWebGL: readBool('forceWebGL'),
        noCompute: readBool('cosmicNoirNoCompute', 'noCompute'),
        noMRT: readBool('cosmicNoirNoMRT', 'noMRT'),
        noPost: readBool('cosmicNoirNoPost', 'noPost'),
        mrtAudit: readBool('cosmicNoirMrtAudit'),
        baseline: readBool('cosmicNoirBaseline', 'baseline'),
        seed: Number.isFinite(seed) ? seed : null,
        fixedDeltaMs: Number.isFinite(fixedDeltaMs) && fixedDeltaMs > 0 ? fixedDeltaMs : null,
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
        bloomDownsample: 0.9,
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 64,
        glowLayers: 8,
        atmosphereLayers: 2,
        dustParticles: 500,
    },
    Ultra: {
        starCount: 50000,
        nebulaCount: 20,
        ambientParticles: 300,
        voidSparks: 18000,
        computeSparkCount: 36000,
        bloomStrength: 0.45,
        bloomRadius: 0.4,
        bloomDownsample: 0.85,
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 56,
        glowLayers: 7,
        atmosphereLayers: 2,
        dustParticles: 380,
    },
    High: {
        starCount: 30000,
        nebulaCount: 15,
        ambientParticles: 200,
        voidSparks: 15000,
        computeSparkCount: 26000,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        bloomDownsample: 0.8,
        enablePostProcessing: true,
        enableCompute: true,
        planetDetail: 48,
        glowLayers: 6,
        atmosphereLayers: 2,
        dustParticles: 280,
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
    },
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
        this.animationFrameId = null;
        this.resizeHandler = null;
        this.deferredTimeouts = new Set();

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.bloomPass = null;

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
        this.voidSparks = []; // Fallback pool, or single compute-backed points system
        this.voidSparkIndex = 0; // Cycle index for pooled fallback
        this.sparkCompute = null;

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

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingComboCount = 0;
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

        console.log('[CosmicNoir] Hybrid WebGPU/WebGL theme constructed');
    }

    getTetrominoConfig() {
        return COSMIC_NOIR_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
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
        parsed.mrtAudit = parsed.mrtAudit || previous.mrtAudit === true;
        parsed.baseline = parsed.baseline || previous.baseline === true;
        if (!Number.isFinite(parsed.seed) && Number.isFinite(previous.seed)) {
            parsed.seed = previous.seed;
        }
        if (!Number.isFinite(parsed.fixedDeltaMs) && Number.isFinite(previous.fixedDeltaMs)) {
            parsed.fixedDeltaMs = previous.fixedDeltaMs;
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

        return {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.getCurrentQualityLevel(),
            frameCount,
            avgFrameMs: avgMs,
            avgFps: avgMs > 0 ? 1000 / avgMs : 0,
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
                sparkMode: this.sparkCompute?.computeNode ? 'compute' : 'fallback-pool',
                atmosphereLayers: this.qualityPreset?.atmosphereLayers ?? 1,
                dustParticles: this.qualityPreset?.dustParticles ?? 0,
            },
            mrtDowngrade: this.lastMrtDowngrade ? { ...this.lastMrtDowngrade } : null,
            flags: {
                forceWebGL: this.flags.forceWebGL,
                noPost: this.flags.noPost,
                noMRT: this.flags.noMRT,
                noCompute: this.flags.noCompute,
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
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        this.refreshFlagsForScene();
        this.initializeDeterministicState();
        this.resetBaselineCapture();
        this.clock = new THREE.Clock();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('cosmic-noir-theme');
        if (!container) {
            console.error('[CosmicNoir] Container not found');
            return;
        }

        container.innerHTML = '';

        await this.initRenderer(container);
        if (!this.renderer || !this.scene || !this.camera) {
            console.error('[CosmicNoir] Renderer initialization failed');
            return;
        }

        this.probeCapabilities();
        this.updateCapabilityFlags();

        this.createStarfield();
        this.createNebulaClouds();
        this.createAmbientDust();
        this.createPlanet();
        this.createAtmosphere();
        this.createVoidSparks();
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
            this.renderer.onDeviceLost = (info) => {
                this.handleDeviceLoss(info);
            };
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
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
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

        const canUseStarCompute = Boolean(
            this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute,
        );

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

            let starCompute = null;
            if (canUseStarCompute) {
                try {
                    starCompute = new CosmicNoirStarTwinkleCompute(layerCount);
                    starCompute.setInitialData(twinkleData, brightness, sizes);
                    starCompute.createComputeNode();
                    this.starTwinkleComputes.push(starCompute);
                } catch (error) {
                    console.warn(`[CosmicNoir] ${config.id} star twinkle compute init failed:`, error);
                    starCompute?.dispose?.();
                    starCompute = null;
                }
            }

            let material;
            let uniforms;
            if (this.isWebGPU) {
                ({ material, uniforms } = createStarfieldNodeMaterial({
                    pixelRatio: this.renderer.getPixelRatio(),
                    isWebGPU: this.isWebGPU,
                    starCompute,
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
                parallax: config.parallax,
                spinY: config.spinY,
                spinZ: config.spinZ,
                uniforms,
                starCompute,
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

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Configure nebula planes at different depths
        const nebulaConfigs = [
            // Deep background layer (Parallax factor low)
            {
                texture: textures[0], size: 6000, z: -5200, opacity: 0.045, speed: 0.00007, parallaxX: 0.12, parallaxY: 0.08, rotationSpeed: 0.000025,
            },
            {
                texture: textures[1], size: 7000, z: -4400, opacity: 0.036, speed: 0.00009, parallaxX: 0.16, parallaxY: 0.11, rotationSpeed: -0.00002,
            },
            // Mid layer
            {
                texture: textures[2], size: 5200, z: -3300, opacity: 0.028, speed: 0.00013, parallaxX: 0.24, parallaxY: 0.16, rotationSpeed: 0.00003,
            },
            {
                texture: textures[0], size: 5600, z: -2600, opacity: 0.022, speed: 0.00018, parallaxX: 0.3, parallaxY: 0.2, rotationSpeed: -0.000035,
            },
            // Near haze layers
            {
                texture: textures[1], size: 4200, z: -1800, opacity: 0.016, speed: 0.00024, parallaxX: 0.38, parallaxY: 0.26, rotationSpeed: 0.00004,
            },
            {
                texture: textures[2], size: 3800, z: -1300, opacity: 0.013, speed: 0.00028, parallaxX: 0.46, parallaxY: 0.31, rotationSpeed: -0.00005,
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
                    opacity: config.opacity,
                }));
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
                ({ uniforms } = material);
            }

            const mesh = new THREE.Mesh(geometry, material);
            // Random position spread
            mesh.position.x = (this.rand() - 0.5) * 2000;
            mesh.position.y = (this.rand() - 0.5) * 1000;
            mesh.position.z = config.z;
            mesh.rotation.z = this.rand() * Math.PI * 2;

            mesh.userData = {
                driftSpeed: config.speed,
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

        console.log('[CosmicNoir] 3D Black Planet created with texture');
    }

    createPlanetGlowLayers(planetSize) {
        const glowConfigs = [];
        const layerCount = this.qualityPreset.glowLayers;

        for (let i = 0; i < layerCount; i++) {
            const sizeMult = 1.18 + i * 0.2;
            const opacity = 0.09 - i * 0.012;
            let color = 0x101016;
            if (i < 2) {
                color = 0x24242c;
            } else if (i < 4) {
                color = 0x1a1a22;
            }
            glowConfigs.push({
                size: planetSize * sizeMult,
                color, // Grayscale glow
                opacity: Math.max(0.012, opacity),
                z: -5 * (i + 1),
            });
        }

        for (const config of glowConfigs) {
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
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(0.15, 'rgba(220, 220, 230, 0.5)');
                gradient.addColorStop(0.4, 'rgba(150, 150, 160, 0.25)');
                gradient.addColorStop(0.7, 'rgba(80, 80, 90, 0.1)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
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
        mesh.userData.uniforms = uniforms;
        this.comboFlash = mesh;
        this.comboFlashUniforms = uniforms;
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
            ({ material, uniforms } = createPlanetGlowNodeMaterial({
                color: new THREE.Color(0xdedeea),
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
        this.ambientDust = points;
        this.ambientDustUniforms = uniforms;
        this.scene.add(points);

        console.log('[CosmicNoir] Ambient dust enabled with', dustCount, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Atmosphere - Volumetric gas shell with explosion support
    // ─────────────────────────────────────────────────────────────────────────

    createAtmosphere() {
        if (this.atmosphereFlowCompute) {
            this.atmosphereFlowCompute.dispose();
            this.atmosphereFlowCompute = null;
        }

        // Create an atmosphere slightly larger than the planet
        const planetSize = 280;
        const atmosphereSize = planetSize * 1.25;
        const innerAtmosphereSize = planetSize * 1.12;
        const atmosphereLayerCount = Math.max(1, this.qualityPreset.atmosphereLayers ?? 2);

        const canUseFlowCompute = Boolean(
            this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute,
        );
        if (canUseFlowCompute) {
            try {
                this.atmosphereFlowCompute = new CosmicNoirAtmosphereFlowCompute();
                this.atmosphereFlowCompute.createComputeNode();
            } catch (error) {
                console.warn('[CosmicNoir] Atmosphere flow compute init failed, using direct flow:', error);
                if (this.atmosphereFlowCompute) {
                    this.atmosphereFlowCompute.dispose();
                    this.atmosphereFlowCompute = null;
                }
            }
        }

        const createAtmosphereLayer = (radius, opacity, renderOrder) => {
            const geometry = new THREE.SphereGeometry(radius, 64, 64);
            let material;
            let uniforms;

            if (this.isWebGPU) {
                ({ material, uniforms } = createAtmosphereNodeMaterial({
                    isWebGPU: this.isWebGPU,
                    atmosphereFlowCompute: this.atmosphereFlowCompute,
                }));
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uPulseIntensity: { value: 0 },
                        uExplosionTimer: { value: -10.0 },
                        uExplosionIntensity: { value: 0 },
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
                };
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

        const poolSize = 24; // Increased number of overlapping bursts allowed
        const countPerSystem = Math.floor(this.qualityPreset.voidSparks / 3);

        for (let p = 0; p < poolSize; p++) {
            const geometry = new THREE.BufferGeometry();

            const thetas = new Float32Array(countPerSystem);
            const phis = new Float32Array(countPerSystem);
            const radii = new Float32Array(countPerSystem);
            const randoms = new Float32Array(countPerSystem);
            const colors = new Float32Array(countPerSystem * 3);
            const positions = new Float32Array(countPerSystem * 3);

            for (let i = 0; i < countPerSystem; i++) {
                // Distribute particles evenly on planet surface
                const theta = this.rand() * Math.PI * 2;
                const phi = Math.acos(2 * this.rand() - 1);

                thetas[i] = theta;
                phis[i] = phi;
                radii[i] = planetRadius;
                randoms[i] = this.rand();

                // Color selection - mostly white/silver with some gray
                const colorType = this.rand();
                let c;
                if (colorType > 0.5) c = colorOptions[0]; // White
                else if (colorType > 0.3) c = colorOptions[1]; // Light silver
                else if (colorType > 0.15) c = colorOptions[2]; // Medium silver
                else if (colorType > 0.05) c = colorOptions[3]; // Gray silver
                else c = colorOptions[4]; // Darker silver

                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = 0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aTheta', new THREE.BufferAttribute(thetas, 1));
            geometry.setAttribute('aPhi', new THREE.BufferAttribute(phis, 1));
            geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            let material;
            let uniforms = null;
            if (this.isWebGPU) {
                ({ material, uniforms } = createVoidSparkNodeMaterial());
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        time: { value: 0 },
                        uPulseTimer: { value: -100.0 },
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
            sparks.userData.uniforms = uniforms;
            this.planetGroup.add(sparks);
            this.voidSparks.push(sparks);
        }

        console.log(
            '[CosmicNoir] Void sparks pool created with',
            poolSize,
            'systems,',
            countPerSystem,
            'particles each',
        );
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
                        bloomDownsample: this.qualityPreset.bloomDownsample ?? 0.8,
                        chromaticStrength: this.flags.useMRT ? 0.004 : 0.0022,
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
        chromaticPass.uniforms.uIntensity.value = 0.004;
        this.composer.addPass(chromaticPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[CosmicNoir] Post-processing configured (with chromatic aberration)');
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

        if (this.starfield && Array.isArray(this.starfieldUniforms)) {
            this.starfieldUniforms.forEach((uniforms) => {
                if (!uniforms) return;
                if (uniforms.uTime) {
                    uniforms.uTime.value = this.time;
                }
                if (uniforms.uEventBoost) {
                    uniforms.uEventBoost.value = this.starEventBoost;
                }
            });
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
        ) {
            if (Array.isArray(this.starTwinkleComputes)) {
                this.starTwinkleComputes.forEach((compute) => {
                    if (!compute?.computeNode) return;
                    compute.update(delta);
                    this.renderer.compute(compute.computeNode);
                });
            }

            if (this.atmosphereFlowCompute?.computeNode) {
                this.atmosphereFlowCompute.update({
                    time: this.time,
                    pulseIntensity: this.planetPulseIntensity,
                    explosionIntensity: this.gasExplosionIntensity,
                });
                this.renderer.compute(this.atmosphereFlowCompute.computeNode);
            }

            if (this.sparkCompute?.computeNode) {
                this.sparkCompute.update(delta, this.time);
                this.renderer.compute(this.sparkCompute.computeNode);
            }
        }

        // Update all void spark systems in the pool
        for (const sparks of this.voidSparks) {
            const sparkUniforms = sparks?.userData?.uniforms || sparks?.material?.uniforms;
            if (sparks && sparkUniforms) {
                if (sparkUniforms.time) {
                    sparkUniforms.time.value = this.time;
                }

                if (sparks?.userData?.computeBacked || this.sparkCompute?.computeNode) {
                    continue;
                }

                // Update pulse wave
                if (sparkUniforms.uPulseTimer?.value > -50.0) {
                    // Move wave outwards - speed increased for more explosive look
                    sparkUniforms.uPulseTimer.value += delta * 18.0;

                    // Turn off when wave completes
                    if (sparkUniforms.uPulseTimer.value > 85.0) {
                        sparkUniforms.uPulseTimer.value = -100.0;
                    }
                }
            }
        }

        // Slow drift planet across entire screen (Lissajous curves for organic movement)
        if (this.planetGroup) {
            const driftX = Math.sin(this.time * 0.025 + this.planetPhaseX) * 550
                + Math.cos(this.time * 0.018 + this.planetPhaseX2) * 250;
            const driftY = Math.cos(this.time * 0.02 + this.planetPhaseY) * 350
                + Math.sin(this.time * 0.012 + this.planetPhaseY2) * 150;

            this.planetGroup.position.x = driftX;
            this.planetGroup.position.y = driftY;

            // Gentle rotation
            this.planetGroup.rotation.z = Math.sin(this.time * 0.008) * 0.04;
        }

        // Slow camera orbit for parallax depth (independent of planet)
        if (this.camera) {
            const cameraTime = this.time * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 400; // Wide horizontal sway
            const orbitRadiusY = 300; // Vertical sway range
            const orbitRadiusZ = 200; // Depth breathing

            // Orbital sway - creates parallax with starfield/nebula
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX
                + Math.cos(cameraTime * 0.7) * orbitRadiusX * 0.4;
            this.camera.position.y = Math.cos(cameraTime * 0.8) * orbitRadiusY
                + Math.sin(cameraTime * 0.5) * orbitRadiusY * 0.3;
            this.camera.position.z = 1200 + Math.sin(cameraTime * 0.6) * orbitRadiusZ;

            // LookAt drift for dynamic framing (not following planet)
            const lookOffsetX = Math.sin(cameraTime * 0.4) * 150;
            const lookOffsetY = Math.cos(cameraTime * 0.5) * 100;

            if (this.reactiveEnvelope.shake > 0) {
                const shakeAmplitude = this.reactiveEnvelope.shake * 3.0;
                this.camera.position.x += (this.rand() - 0.5) * shakeAmplitude;
                this.camera.position.y += (this.rand() - 0.5) * shakeAmplitude;
            }

            this.camera.lookAt(lookOffsetX, lookOffsetY, 0);
        }

        if (this.comboLensFlare && this.camera) {
            this.camera.getWorldDirection(this.tempCameraForward);
            this.comboLensFlare.position
                .copy(this.camera.position)
                .add(this.tempCameraForward.multiplyScalar(900));
            this.comboLensFlare.quaternion.copy(this.camera.quaternion);

            const flarePulse = 1.0 + Math.sin(this.time * 18.0) * 0.08;
            const flareOpacity = this.comboLensFlareIntensity * 0.42 * flarePulse;
            if (this.comboLensFlareUniforms?.uOpacity) {
                this.comboLensFlareUniforms.uOpacity.value = flareOpacity;
            } else if (this.comboLensFlare.material) {
                this.comboLensFlare.material.opacity = flareOpacity;
            }

            const widthScale = 1.0 + this.comboLensFlareIntensity * 0.75;
            const heightScale = 1.0 + this.comboLensFlareIntensity * 0.2;
            this.comboLensFlare.scale.set(widthScale, heightScale, 1.0);
        }

        if (this.comboFlash && this.camera) {
            const flashPulse = 1.0 + Math.sin(this.time * 24.0) * 0.06;
            const flashOpacity = this.comboFlashIntensity * 0.75 * flashPulse;
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
            cloud.userData.driftOffset = (cloud.userData.driftOffset || 0) + cloud.userData.driftSpeed * 50;
            if (cloud.userData.driftOffset > 6000) cloud.userData.driftOffset = -6000;

            // Sync base position with camera, add drift offset
            const parallaxX = cloud.userData.parallaxX ?? 0.3;
            const parallaxY = cloud.userData.parallaxY ?? 0.2;
            cloud.position.x = (this.camera?.position.x || 0) * parallaxX + cloud.userData.driftOffset;
            cloud.position.y = (this.camera?.position.y || 0) * parallaxY;
            cloud.rotation.z += (cloud.userData.rotationSpeed ?? 0) * delta;

            cloud.userData.pulsePhase += 0.003;
            // Pulse: -1 to 1 for subtle breathing
            const pulse = Math.sin(cloud.userData.pulsePhase);

            const nebulaUniforms = cloud.userData?.uniforms || cloud.material?.uniforms;
            if (nebulaUniforms?.uPulse) {
                nebulaUniforms.uPulse.value = pulse + (this.planetPulseIntensity * 2.0); // React to gameplay
            }
        }

        // Starfield depth layers with independent parallax and drift.
        if (this.starfield && this.camera) {
            this.starfieldLayers.forEach((layer) => {
                const parallax = layer.userData?.parallax ?? 1.0;
                const spinY = layer.userData?.spinY ?? 0.003;
                const spinZ = layer.userData?.spinZ ?? 0.001;
                layer.position.set(
                    this.camera.position.x * parallax,
                    this.camera.position.y * parallax,
                    this.camera.position.z * parallax,
                );
                layer.rotation.y = this.time * spinY;
                layer.rotation.z = this.time * spinZ;
            });
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
            this.postProcessing.update({
                bloomStrength: bloomBaseStrength * (1.0 + reactiveBloomBoost),
                bloomRadius: this.qualityPreset.bloomRadius,
                bloomThreshold: this.flags.useMRT ? 0.0 : 0.88,
                chromaticStrength: (this.flags.useMRT ? 0.004 : 0.0022) + reactiveBloomBoost * 0.0012,
                vignetteDarkness: (this.flags.useMRT ? 0.82 : 0.86) - reactiveBloomBoost * 0.03,
            });
        } else if (this.bloomPass) {
            const fallbackBloomBoost = Math.min(
                0.65,
                this.planetPulseIntensity * 0.3
                + this.gasExplosionIntensity * 0.25
                + this.reactiveEnvelope.bloom * 0.45,
            );
            this.bloomPass.strength = this.qualityPreset.bloomStrength * (1.0 + fallbackBloomBoost);
        }

        this.renderFrame();

        const frameEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.recordBaselineSample(frameEndMs - frameStartMs);
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderer.clear();

        if (this.isWebGPU) {
            if (this.postProcessing && this.flags.usePost) {
                this.postProcessing.render();
            } else {
                this.renderer.render(this.scene, this.camera);
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

    createCosmicWave(intensity, options = {}) {
        const radius = options.radius ?? 30;
        const tube = options.tube ?? 2;
        const radialSegments = options.radialSegments ?? 8;
        const tubularSegments = options.tubularSegments ?? 48;
        const waveColor = options.color ?? new THREE.Color(0x888888);
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
                    uColor: { value: waveColor }, // Gray wave
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
        wave.rotation.x = this.rand() * Math.PI * 0.3;
        wave.rotation.y = this.rand() * Math.PI * 2;

        wave.userData = {
            speed: (70 + intensity * 18) * (options.speedMultiplier ?? 1.0),
            life: 1.0,
            maxLife: 1.0,
            lifeDecay: 0.7 / (options.lifeMultiplier ?? 1.0),
            uniforms,
        };

        this.planetGroup.add(wave);
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
                this.planetGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
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
        const decayRates = {
            pulse: 3.0,
            bloom: 2.6,
            spark: 3.4,
            atmosphere: 2.2,
            star: 4.2,
            shake: 8.0,
        };

        Object.keys(this.reactiveEnvelope).forEach((key) => {
            const decayRate = decayRates[key] ?? 3.0;
            const decay = Math.max(0.0, 1.0 - delta * decayRate);
            this.reactiveEnvelope[key] *= decay;
            if (this.reactiveEnvelope[key] < 0.01) {
                this.reactiveEnvelope[key] = 0;
            }
        });
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

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
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
        const getSparkUniforms = (sparkSystem) => sparkSystem?.userData?.uniforms
            || sparkSystem?.material?.uniforms
            || null;

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
                            this.sparkCompute.triggerBurst(this.time, burstIntensity);
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
                        this.sparkCompute.triggerBurst(this.time, trailingIntensity);
                    }, 320 + t * 140);
                }
            } else {
                for (let s = 0; s < burstsToTrigger; s++) {
                    // Find an inactive spark system (one that has finished animating)
                    let sparkSystem = null;
                    for (let i = 0; i < this.voidSparks.length; i++) {
                        const idx = (this.voidSparkIndex + i) % this.voidSparks.length;
                        const candidate = this.voidSparks[idx];
                        const sparkUniforms = getSparkUniforms(candidate);
                        if (candidate && sparkUniforms?.uPulseTimer) {
                            const timer = sparkUniforms.uPulseTimer.value;
                            if (timer < -50.0 || timer > 85.0) {
                                sparkSystem = candidate;
                                this.voidSparkIndex = (idx + 1) % this.voidSparks.length;
                                break;
                            }
                        }
                    }

                    // If all systems are active, fallback to the oldest one (cycle through)
                    if (!sparkSystem) {
                        sparkSystem = this.voidSparks[this.voidSparkIndex];
                        this.voidSparkIndex = (this.voidSparkIndex + 1) % this.voidSparks.length;
                    }

                    // Trigger the spark burst with a slight delay for staggered effect
                    const sparkUniforms = getSparkUniforms(sparkSystem);
                    if (sparkUniforms?.uPulseTimer) {
                        if (s === 0) {
                            sparkUniforms.uPulseTimer.value = 0.0;
                        } else {
                            this.registerDeferredTimeout(() => {
                                const deferredUniforms = getSparkUniforms(sparkSystem);
                                if (deferredUniforms?.uPulseTimer) {
                                    deferredUniforms.uPulseTimer.value = 0.0;
                                }
                            }, s * 150);
                        }
                    }
                }

                for (let t = 0; t < extraTrailBursts; t++) {
                    this.registerDeferredTimeout(() => {
                        if (!this.voidSparks.length) return;
                        const candidate = this.voidSparks[this.voidSparkIndex];
                        this.voidSparkIndex = (this.voidSparkIndex + 1) % this.voidSparks.length;
                        const trailingUniforms = getSparkUniforms(candidate);
                        if (trailingUniforms?.uPulseTimer) {
                            trailingUniforms.uPulseTimer.value = 0.0;
                        }
                    }, 320 + t * 140);
                }
            }

            // Trigger gas explosion on atmosphere
            this.gasExplosionTimer = 0.0;
            this.gasExplosionIntensity = Math.min(0.5 + comboCount * 0.15, 1.2);
        }

        // Create cosmic waves
        const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), 4);
        for (let i = 0; i < waveCount; i++) {
            this.registerDeferredTimeout(() => this.createCosmicWave(comboCount), i * 100);
        }

        if (comboCount >= 6) {
            const extraShockwaves = Math.min(3, Math.floor(comboCount / 3));
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
                        color: new THREE.Color(0xb8b8c8),
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
        this.renderer.setSize(width, height);

        if (this.postProcessing?.setSize) {
            this.postProcessing.setSize(width, height);
        }

        if (this.composer) {
            this.composer.setSize(width, height);
        }

        if (Array.isArray(this.starfieldUniforms)) {
            this.starfieldUniforms.forEach((uniforms) => {
                if (uniforms?.uPixelRatio) {
                    uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
                }
            });
        }

        if (this.ambientDustUniforms?.uPixelRatio) {
            this.ambientDustUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
        }
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
            this.renderer.dispose();
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
        this.voidSparks = [];
        this.voidSparkIndex = 0;
        this.sparkCompute = null;
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
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposePostProcessingStack();
        this.disposeComputeResources();
        this.disposeSceneResources();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        console.error('[CosmicNoir] WebGPU device lost:', info);

        try {
            this.cancelAnimationLoop();
            this.clearDeferredTimeouts();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.disposeRuntimeResources({ removeCanvas: true });

            // Force WebGL fallback after device loss.
            this.flags.forceWebGL = true;
            this.flags.noCompute = true;
            this.flags.noMRT = true;

            await this.createScene();
            console.log('[CosmicNoir] Recovery complete: running on WebGL fallback.');
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
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        super.stop();
    }
}
