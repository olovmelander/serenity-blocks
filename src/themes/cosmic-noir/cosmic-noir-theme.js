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

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { COSMIC_NOIR_TETROMINOS } from './cosmic-noir-tetrominos.js';
import { CosmicNoirSparkCompute } from './cosmic-noir-compute.js';
import {
    createAtmosphereNodeMaterial,
    createCosmicWaveNodeMaterial,
    createNebulaNodeMaterial,
    createPlanetNodeMaterial,
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
        bloomStrength: 0.5,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        planetDetail: 64,
        glowLayers: 8,
    },
    Ultra: {
        starCount: 50000,
        nebulaCount: 20,
        ambientParticles: 300,
        voidSparks: 18000,
        bloomStrength: 0.45,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        planetDetail: 56,
        glowLayers: 7,
    },
    High: {
        starCount: 30000,
        nebulaCount: 15,
        ambientParticles: 200,
        voidSparks: 15000,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        enablePostProcessing: true,
        planetDetail: 48,
        glowLayers: 6,
    },
    Medium: {
        starCount: 15000,
        nebulaCount: 10,
        ambientParticles: 120,
        voidSparks: 10000,
        bloomStrength: 0.35,
        bloomRadius: 0.3,
        enablePostProcessing: true,
        planetDetail: 36,
        glowLayers: 5,
    },
    Low: {
        starCount: 8000,
        nebulaCount: 6,
        ambientParticles: 60,
        voidSparks: 6000,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        enablePostProcessing: false,
        planetDetail: 24,
        glowLayers: 4,
    },
    Minimal: {
        starCount: 4000,
        nebulaCount: 4,
        ambientParticles: 30,
        voidSparks: 3500,
        bloomStrength: 0.2,
        bloomRadius: 0.2,
        enablePostProcessing: false,
        planetDetail: 16,
        glowLayers: 3,
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

        // Scene elements
        this.planet = null;
        this.planetUniforms = null;
        this.planetGroup = null;
        this.starfield = null;
        this.starfieldUniforms = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.atmosphere = null;
        this.atmosphereUniforms = null;
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

        // Planet drift animation (Lissajous curves for organic movement)
        this.planetPhaseX = 0;
        this.planetPhaseY = 0;
        this.planetPhaseX2 = 0;
        this.planetPhaseY2 = 0;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingComboCount = 0;
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 3600;

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

        const renderSamples = Math.max(1, this.baselineRenderStats.length);

        return {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.getCurrentQualityLevel(),
            frameCount,
            avgFrameMs: avgMs,
            avgFps: avgMs > 0 ? 1000 / avgMs : 0,
            p50FrameMs: p50Ms,
            p95FrameMs: p95Ms,
            avgDrawCalls: totals.calls / renderSamples,
            avgTriangles: totals.triangles / renderSamples,
            avgPoints: totals.points / renderSamples,
            avgTextures: totals.textures / renderSamples,
            avgGeometries: totals.geometries / renderSamples,
            seed: this.flags.seed,
            fixedDeltaMs: this.flags.fixedDeltaMs,
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
            };
            return;
        }

        const { backend } = this.renderer;
        const device = backend?.device;
        this.capabilities = {
            isWebGPU: true,
            maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
            supportsCompute: typeof this.renderer.compute === 'function',
        };
    }

    updateCapabilityFlags() {
        const usePost = this.isWebGPU && this.qualityPreset.enablePostProcessing && !this.flags.noPost;
        const supportsMRT = this.capabilities?.maxColorAttachments > 1;
        const useMRT = usePost && !this.flags.noMRT && supportsMRT;
        const useCompute = this.isWebGPU && this.capabilities?.supportsCompute && !this.flags.noCompute;

        this.flags.usePost = usePost;
        this.flags.useMRT = useMRT;
        this.flags.useCompute = useCompute;
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
            || material.isPointsNodeMaterial
            || material.isSpriteNodeMaterial
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    auditMrtMaterials() {
        if (!this.flags.mrtAudit || !this.scene) return;

        const rows = [];
        const seen = new Set();
        this.scene.traverse((object) => {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                if (!material || seen.has(material)) return;
                seen.add(material);
                rows.push({
                    object: object.name || object.type || 'Unknown',
                    material: material.name || material.type || material.constructor?.name || 'Unknown',
                    nodeMaterial: this.isNodeMaterial(material),
                    hasEmissiveNode: !!material.emissiveNode,
                    hasMrtNode: !!material.mrtNode,
                });
            });
        });

        console.log('[CosmicNoir] MRT audit', rows);
    }

    async precompileSceneWithTimeout() {
        if (!this.isWebGPU || !this.renderer?.compileAsync || !this.scene || !this.camera) return;

        const timeoutMs = 3000;
        let timeoutId = null;

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('compile timeout')), timeoutMs);
                }),
            ]);
            console.log('[CosmicNoir] Scene pre-compiled');
        } catch (error) {
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
        this.createPlanet();
        this.createAtmosphere();
        // Ambient particles removed for cleaner noir star aesthetic
        this.createVoidSparks();
        this.auditMrtMaterials();
        this.setupPostProcessing();
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
            usePost: this.flags.usePost,
            useMRT: this.flags.useMRT,
            useCompute: this.flags.useCompute,
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
                    powerPreference: 'high-performance',
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
        this.scene.fog = new THREE.FogExp2(0x020202, 0.0006); // Very dark, subtle fog

        // Camera positioned for depth
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000);
        this.camera.position.set(0, 0, 1200);
        this.camera.lookAt(0, 0, 0);

        // Very subtle lighting - noir aesthetic
        const planetLight = new THREE.PointLight(0x888888, 1.5, 2500);
        planetLight.position.set(300, 200, 500);
        this.scene.add(planetLight);

        // Dim ambient
        const ambientLight = new THREE.AmbientLight(0x080808, 0.3);
        this.scene.add(ambientLight);

        console.log(`[CosmicNoir] Renderer initialized (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Deep 3D grayscale stars
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2); // phase + speed
        const brightness = new Float32Array(starCount);

        // Grayscale star colors - pure noir palette
        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xf0f0f0), // Near white
            new THREE.Color(0xe0e0e0), // Light gray
            new THREE.Color(0xd0d0d0), // Medium-light gray
            new THREE.Color(0xc0c0c8), // Silver tint
            new THREE.Color(0xb0b0b8), // Cooler silver
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // FIXED: Use Spherical Distribution to prevent black voids on rotation
            // Stars are now placed in a full 360-degree sphere around the origin
            const radius = 2000 + this.rand() * 8000; // Deep depth range
            const theta = this.rand() * Math.PI * 2; // Horizontal angle
            const phi = Math.acos(2 * this.rand() - 1); // Vertical angle (acos for uniform sphere)

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            // Color - grayscale noir palette
            const colorIndex = Math.floor(this.rand() * starColors.length);
            const color = starColors[colorIndex];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Larger sizes for atmospheric appearance
            sizes[i] = 20 + this.rand() * 40;

            // Twinkle: phase offset, varied speed (0.8 to 2.5 Hz)
            twinkleData[i2] = this.rand() * Math.PI * 2; // phase
            twinkleData[i2 + 1] = 0.8 + this.rand() * 1.7; // speed

            brightness[i] = 0.3 + this.rand() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        let material;
        if (this.isWebGPU) {
            const { material: nodeMaterial, uniforms } = createStarfieldNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
            });
            material = nodeMaterial;
            this.starfieldUniforms = uniforms;
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
            const { uniforms } = material;
            this.starfieldUniforms = uniforms;
        }

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[CosmicNoir] Starfield created with', starCount, 'atmospheric stars');
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
                texture: textures[0], size: 6000, z: -4500, opacity: 0.25, speed: 0.00008,
            },
            {
                texture: textures[1], size: 7000, z: -4000, opacity: 0.2, speed: 0.0001,
            },
            // Mid layer
            {
                texture: textures[2], size: 5000, z: -3000, opacity: 0.15, speed: 0.00015,
            },
            {
                texture: textures[0], size: 5500, z: -2500, opacity: 0.12, speed: 0.0002,
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

        console.log('[CosmicNoir] 3D Black Planet created with texture');
    }

    createPlanetGlowLayers(planetSize) {
        const glowConfigs = [];
        const layerCount = this.qualityPreset.glowLayers;

        for (let i = 0; i < layerCount; i++) {
            const sizeMult = 1.25 + i * 0.22;
            const opacity = 0.25 - i * 0.03;
            let color = 0x222222;
            if (i < 3) {
                color = 0x666666;
            } else if (i < 5) {
                color = 0x444444;
            }
            glowConfigs.push({
                size: planetSize * sizeMult,
                color, // Grayscale glow
                opacity: Math.max(0.04, opacity),
                z: -5 * (i + 1),
            });
        }

        for (const config of glowConfigs) {
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
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(geometry, material);
            glow.position.set(0, 0, config.z);
            glow.renderOrder = 50;
            glow.userData.baseOpacity = config.opacity;
            this.planetGlowLayers.push(glow);
            this.planetGroup.add(glow);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating grayscale particles
    // ─────────────────────────────────────────────────────────────────────────

    // Ambient particles method removed

    // ─────────────────────────────────────────────────────────────────────────
    // Atmosphere - Volumetric gas shell with explosion support
    // ─────────────────────────────────────────────────────────────────────────

    createAtmosphere() {
        // Create an atmosphere slightly larger than the planet
        const planetSize = 280;
        const atmosphereSize = planetSize * 1.25;

        const geometry = new THREE.SphereGeometry(atmosphereSize, 64, 64);
        let material;
        if (this.isWebGPU) {
            const { material: nodeMaterial, uniforms } = createAtmosphereNodeMaterial();
            material = nodeMaterial;
            this.atmosphereUniforms = uniforms;
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
            const { uniforms } = material;
            this.atmosphereUniforms = uniforms;
        }

        this.atmosphere = new THREE.Mesh(geometry, material);
        this.atmosphere.renderOrder = 101; // Render after planet

        this.planetGroup.add(this.atmosphere);

        console.log('[CosmicNoir] Atmosphere shell created');
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
            const sparkCount = Math.min(
                50000,
                Math.max(this.qualityPreset.voidSparks * 2, 12000),
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
                this.flags.useCompute = false;
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
            return;
        }

        if (this.isWebGPU) {
            console.log(
                '[CosmicNoir] WebGPU post-processing is scheduled for Phase 4; '
                + 'rendering without post stack for now',
            );
            this.flags.usePost = false;
            return;
        }

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.15,
        );
        this.composer.addPass(bloomPass);

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

        if (this.starfield && this.starfieldUniforms) {
            if (this.starfieldUniforms.uTime) {
                this.starfieldUniforms.uTime.value = this.time;
            }
            if (this.starfieldUniforms.uEventBoost) {
                this.starfieldUniforms.uEventBoost.value = this.starEventBoost;
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

        if (
            this.isWebGPU
            && this.flags.useCompute
            && this.sparkCompute?.computeNode
            && this.renderer?.compute
        ) {
            this.sparkCompute.update(delta, this.time);
            this.renderer.compute(this.sparkCompute.computeNode);
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
            this.camera.lookAt(lookOffsetX, lookOffsetY, 0);
        }

        // Pulse glow layers with planet pulse intensity
        const glowPulse = Math.sin(this.time * 1.5) * 0.12 + 1.0;
        for (const glow of this.planetGlowLayers) {
            const pulse = (1 + this.planetPulseIntensity * 0.4) * glowPulse;
            glow.material.opacity = glow.userData.baseOpacity * pulse;
        }

        // Nebula drift and pulse
        // Nebula drift and pulse (synced with camera for seamless coverage)
        for (const cloud of this.nebulaClouds) {
            // Move nebulas with camera so they always cover the view
            // Plus gentle drift for atmosphere
            cloud.userData.driftOffset = (cloud.userData.driftOffset || 0) + cloud.userData.driftSpeed * 50;
            if (cloud.userData.driftOffset > 6000) cloud.userData.driftOffset = -6000;

            // Sync base position with camera, add drift offset
            cloud.position.x = (this.camera?.position.x || 0) * 0.3 + cloud.userData.driftOffset;
            cloud.position.y = (this.camera?.position.y || 0) * 0.2;

            cloud.userData.pulsePhase += 0.003;
            // Pulse: -1 to 1 for subtle breathing
            const pulse = Math.sin(cloud.userData.pulsePhase);

            const nebulaUniforms = cloud.userData?.uniforms || cloud.material?.uniforms;
            if (nebulaUniforms?.uPulse) {
                nebulaUniforms.uPulse.value = pulse + (this.planetPulseIntensity * 2.0); // React to gameplay
            }
        }

        // Starfield follows camera (appears at infinite distance)
        if (this.starfield && this.camera) {
            // Position starfield at camera location so stars are always visible
            this.starfield.position.copy(this.camera.position);

            // Slowly rotate starfield for subtle animation
            this.starfield.rotation.y = this.time * 0.003;
            this.starfield.rotation.z = this.time * 0.001;
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

        // Update cosmic waves
        this.updateCosmicWaves(delta);

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

    createCosmicWave(intensity) {
        const geometry = new THREE.TorusGeometry(30, 2, 8, 48);
        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            ({ material, uniforms } = createCosmicWaveNodeMaterial({
                color: new THREE.Color(0x888888),
            }));
            if (uniforms.uTime) {
                uniforms.uTime.value = this.time;
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: this.time },
                    uOpacity: { value: 1.0 },
                    uColor: { value: new THREE.Color(0x888888) }, // Gray wave
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
            speed: 70 + intensity * 18,
            life: 1.0,
            maxLife: 1.0,
            uniforms,
        };

        this.planetGroup.add(wave);
        this.cosmicWaves.push(wave);
    }

    updateCosmicWaves(delta) {
        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];
            wave.scale.addScalar(wave.userData.speed * delta * 0.1);
            wave.userData.life -= delta * 0.7;

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
        const timerId = setTimeout(() => {
            this.deferredTimeouts.delete(timerId);
            callback();
        }, delayMs);
        this.deferredTimeouts.add(timerId);
        return timerId;
    }

    clearDeferredTimeouts() {
        this.deferredTimeouts.forEach((timerId) => clearTimeout(timerId));
        this.deferredTimeouts.clear();
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
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
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
            if (comboCount >= 8) burstsToTrigger = 3;
            else if (comboCount >= 4) burstsToTrigger = 2;

            if (usingSparkCompute) {
                for (let s = 0; s < burstsToTrigger; s++) {
                    const triggerComputeBurst = () => {
                        if (this.sparkCompute?.computeNode) {
                            const burstIntensity = Math.min(1.0 + comboCount * 0.14 + s * 0.08, 2.25);
                            this.sparkCompute.triggerBurst(this.time, burstIntensity);
                        }
                    };

                    if (s === 0) {
                        triggerComputeBurst();
                    } else {
                        this.registerDeferredTimeout(triggerComputeBurst, s * 150);
                    }
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

        if (this.starfieldUniforms?.uPixelRatio) {
            this.starfieldUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
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
        this.planet = null;
        this.planetUniforms = null;
        this.planetGroup = null;
        this.starfield = null;
        this.starfieldUniforms = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.atmosphere = null;
        this.atmosphereUniforms = null;
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
        this.time = 0;
        this.fixedElapsed = 0;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            isWebGPU: false,
            maxColorAttachments: 0,
            supportsCompute: false,
        };
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
