/* eslint-disable import/no-unresolved, prefer-destructuring, no-nested-ternary */
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { ASTRAL_WEAVE_TETROMINOS } from './astral-weave-tetrominos.js';
import { AstralWeaveFXController } from './astral-weave-fx-controller.js';
import * as AstralWeaveMaterialFactories from './astral-weave-materials.js';
import * as AstralWeaveComputeFactories from './astral-weave-compute.js';
import * as AstralWeavePostFactories from './astral-weave-post.js';
import {
    ribbonVertexShader,
    ribbonFragmentShader,
    weaveParticleVertexShader,
    weaveParticleFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    pulseVertexShader,
    pulseFragmentShader,
    dustVertexShader,
    dustFragmentShader,
    lightShaftVertexShader,
    lightShaftFragmentShader,
    constellationVertexShader,
    constellationFragmentShader,
} from './astral-weave-shaders.js';

const TAU = Math.PI * 2;
const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

const QUALITY_PRESETS = {
    Minimal: {
        ribbons: 12,
        ribbonSegments: 64,
        starCount: 4000,
        flowParticles: 1200,
        dustParticles: 80,
        burstParticles: 180,
        nebulaLayers: 3,
        enablePost: false,
        enableMRT: false,
        enableCompute: false,
        enableFilmGrain: false,
        enableLensing: false,
        bloomStrength: 0,
        bloomRadius: 0.45,
        bloomDownsample: 0.6,
        cameraShakeScale: 0.22,
        webglFlowParticles: 1000,
        webglDustParticles: 60,
    },
    Low: {
        ribbons: 16,
        ribbonSegments: 72,
        starCount: 8000,
        flowParticles: 1800,
        dustParticles: 140,
        burstParticles: 240,
        nebulaLayers: 4,
        enablePost: false,
        enableMRT: false,
        enableCompute: false,
        enableFilmGrain: false,
        enableLensing: false,
        bloomStrength: 0,
        bloomRadius: 0.46,
        bloomDownsample: 0.62,
        cameraShakeScale: 0.3,
        webglFlowParticles: 1500,
        webglDustParticles: 100,
    },
    Medium: {
        ribbons: 24,
        ribbonSegments: 84,
        starCount: 15000,
        flowParticles: 4000,
        dustParticles: 300,
        burstParticles: 320,
        nebulaLayers: 5,
        enablePost: true,
        enableMRT: true,
        enableCompute: true,
        enableFilmGrain: false,
        enableLensing: false,
        bloomStrength: 0.3,
        bloomRadius: 0.48,
        bloomDownsample: 0.64,
        cameraShakeScale: 0.42,
        webglFlowParticles: 2200,
        webglDustParticles: 180,
    },
    High: {
        ribbons: 32,
        ribbonSegments: 96,
        starCount: 28000,
        flowParticles: 10000,
        dustParticles: 600,
        burstParticles: 640,
        nebulaLayers: 6,
        enablePost: true,
        enableMRT: true,
        enableCompute: true,
        enableFilmGrain: true,
        enableLensing: false,
        bloomStrength: 0.45,
        bloomRadius: 0.52,
        bloomDownsample: 0.7,
        cameraShakeScale: 0.58,
        webglFlowParticles: 3800,
        webglDustParticles: 280,
    },
    Ultra: {
        ribbons: 40,
        ribbonSegments: 112,
        starCount: 45000,
        flowParticles: 18000,
        dustParticles: 1100,
        burstParticles: 960,
        nebulaLayers: 8,
        enablePost: true,
        enableMRT: true,
        enableCompute: true,
        enableFilmGrain: true,
        enableLensing: true,
        bloomStrength: 0.58,
        bloomRadius: 0.56,
        bloomDownsample: 0.76,
        cameraShakeScale: 0.8,
        webglFlowParticles: 5200,
        webglDustParticles: 420,
    },
    Extreme: {
        ribbons: 48,
        ribbonSegments: 128,
        starCount: 60000,
        flowParticles: 28000,
        dustParticles: 1600,
        burstParticles: 1400,
        nebulaLayers: 10,
        enablePost: true,
        enableMRT: true,
        enableCompute: true,
        enableFilmGrain: true,
        enableLensing: true,
        bloomStrength: 0.72,
        bloomRadius: 0.6,
        bloomDownsample: 0.8,
        cameraShakeScale: 1,
        webglFlowParticles: 7000,
        webglDustParticles: 520,
    },
};

const QUALITY_BUDGETS = {
    Minimal: {
        targetFps: 30,
        maxDrawCalls: 16,
        maxTriangles: 120000,
        maxPoints: 18000,
    },
    Low: {
        targetFps: 60,
        maxDrawCalls: 20,
        maxTriangles: 260000,
        maxPoints: 36000,
    },
    Medium: {
        targetFps: 60,
        maxDrawCalls: 26,
        maxTriangles: 520000,
        maxPoints: 70000,
    },
    High: {
        targetFps: 60,
        maxDrawCalls: 30,
        maxTriangles: 1000000,
        maxPoints: 120000,
    },
    Ultra: {
        targetFps: 60,
        maxDrawCalls: 35,
        maxTriangles: 1500000,
        maxPoints: 180000,
    },
    Extreme: {
        targetFps: 60,
        maxDrawCalls: 40,
        maxTriangles: 2000000,
        maxPoints: 260000,
    },
};

const WEBGPU_RENDER_SCALE = 1.0;
const WEBGL_RENDER_SCALE = 1.25;

const WEBGPU_BILLBOARD_PARTICLE_BUDGETS = {
    Minimal: { flow: 900, dust: 72, burst: 96 },
    Low: { flow: 1400, dust: 96, burst: 120 },
    Medium: { flow: 2400, dust: 140, burst: 160 },
    High: { flow: 3600, dust: 220, burst: 220 },
    Ultra: { flow: 5200, dust: 320, burst: 300 },
    Extreme: { flow: 6800, dust: 420, burst: 380 },
};

function parseAstralWeaveFlags() {
    const defaults = {
        forceWebGL: false,
        noPost: false,
        noMRT: false,
        noCompute: false,
        baseline: false,
        seed: null,
        fixedDtMs: null,
        playback: null,
        playbackLoops: 1,
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
            const value = params.get(keys[i]);
            if (value == null || value === '') continue;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric;
        }
        return null;
    };

    const readString = (...keys) => {
        for (let i = 0; i < keys.length; i += 1) {
            const value = params.get(keys[i]);
            if (value != null && value !== '') return value;
        }
        return null;
    };

    const fixedDtMs = readNumber('astralWeaveFixedDt', 'fixedDt');
    const seed = readNumber('astralWeaveSeed', 'seed');
    const playbackLoops = readNumber('astralWeavePlaybackLoops', 'playbackLoops');

    return {
        forceWebGL: readBool('astralWeaveForceWebGL', 'forceWebGL'),
        noPost: readBool('astralWeaveNoPost', 'noPost'),
        noMRT: readBool('astralWeaveNoMRT', 'noMRT'),
        noCompute: readBool('astralWeaveNoCompute', 'noCompute'),
        baseline: readBool('astralWeaveBaseline', 'baseline'),
        seed: Number.isFinite(seed) ? seed : null,
        fixedDtMs: Number.isFinite(fixedDtMs) && fixedDtMs > 0 ? fixedDtMs : null,
        playback: readString('astralWeavePlayback', 'playback'),
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

function createCanvasTexture(width, height, drawFn, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = options.wrapS ?? THREE.ClampToEdgeWrapping;
    texture.wrapT = options.wrapT ?? THREE.ClampToEdgeWrapping;
    texture.minFilter = options.minFilter ?? THREE.LinearFilter;
    texture.magFilter = options.magFilter ?? THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

function copyUniformValue(uniformTarget, value) {
    if (!uniformTarget) return;
    if (uniformTarget.value?.copy && value?.isColor) {
        uniformTarget.value.copy(value);
        return;
    }
    if (uniformTarget.value?.copy && value?.isVector2) {
        uniformTarget.value.copy(value);
        return;
    }
    if (uniformTarget.value?.copy && value?.isVector3) {
        uniformTarget.value.copy(value);
        return;
    }
    uniformTarget.value = value;
}

function createIdentityInstancedBillboardMesh(material, count, attributes = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(quad, material, count);
    const identity = new THREE.Object3D();
    identity.updateMatrix();
    for (let i = 0; i < count; i += 1) {
        mesh.setMatrixAt(i, identity.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    Object.entries(attributes).forEach(([name, config]) => {
        if (!config?.array || !Number.isFinite(config.itemSize)) return;
        mesh.geometry.setAttribute(
            name,
            new THREE.InstancedBufferAttribute(
                config.array,
                config.itemSize,
                config.normalized === true,
            ),
        );
    });

    return mesh;
}

export default class AstralWeaveTheme extends BaseTheme {
    constructor() {
        super('astral-weave');

        this.flags = parseAstralWeaveFlags();
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;

        this.fxController = new AstralWeaveFXController();
        this.clock = new THREE.Clock();
        this.time = 0;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.container = null;
        this.postProcessing = null;

        this.materialFactories = null;
        this.computeFactories = null;
        this.postFactories = null;

        this.rootGroup = null;
        this.nexusGroup = null;
        this.centerVeil = null;
        this.starfield = null;
        this.flowParticles = null;
        this.dustParticles = null;
        this.burstParticles = null;

        this.nexusNodeData = [];
        this.ribbonMeshes = [];
        this.ribbonNodeData = [];
        this.nebulaLayers = [];
        this.nebulaNodeData = [];
        this.starfieldNodeData = null;
        this.flowNodeData = null;
        this.dustNodeData = null;
        this.burstNodeData = null;
        this.shockwaves = [];
        this.lightShafts = [];
        this.lightShaftNodeData = [];
        this.constellations = null;
        this.constellationNodeData = null;

        this.flowCompute = null;
        this.dustCompute = null;
        this.burstCompute = null;

        this.resizeHandler = null;
        this.qualityChangeHandler = null;
        this.webglContextLostHandler = null;
        this.renderLoop = null;
        this.eventUnsubscribers = [];

        this.qualityRebuildPending = false;
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;

        this.activeQualityLevel = 'High';
        this.qualityPreset = QUALITY_PRESETS.High;
        this.performanceBudget = { ...QUALITY_BUDGETS.High };
        this.baselineQualityOverride = null;
        this.baselineTimeouts = new Set();
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineSequenceStats = { sequence: null, loops: 0, startedAt: 0 };
        this.lastPostCostMs = 0;
        this.lastFrameCostMs = 0;
        this.lastRenderPath = 'uninitialized';
        this.liveParticleCounts = { flow: 0, dust: 0, burst: 0 };

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

        this.palette = {
            cyan: new THREE.Color(0x73f8ff),
            magenta: new THREE.Color(0xd95bff),
            gold: new THREE.Color(0xffd96d),
            blue: new THREE.Color(0x3b8dff),
            pink: new THREE.Color(0xff82d2),
            violet: new THREE.Color(0x7b58ff),
            white: new THREE.Color(0xf7fbff),
            void: new THREE.Color(0x030611),
        };

        this.textures = {};
        this.nexusLocalPosition = new THREE.Vector3(0, 7.5, -12);
        this.cameraBasePosition = new THREE.Vector3(0, 5.6, 34);
        this.cameraShake = new THREE.Vector3();
    }

    getTetrominoConfig() {
        return ASTRAL_WEAVE_TETROMINOS;
    }

    random() {
        return this.randomFn();
    }

    getCurrentQualityLevel() {
        if (this.baselineQualityOverride) {
            return normalizeQuality(this.baselineQualityOverride);
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

    getWebGPUBillboardBudget() {
        return WEBGPU_BILLBOARD_PARTICLE_BUDGETS[this.activeQualityLevel]
            || WEBGPU_BILLBOARD_PARTICLE_BUDGETS.High;
    }

    getActiveParticleCounts() {
        const webgpuBudget = this.getWebGPUBillboardBudget();
        return {
            flow: this.isWebGPU
                ? Math.min(this.qualityPreset.flowParticles, webgpuBudget.flow)
                : this.qualityPreset.webglFlowParticles,
            dust: this.isWebGPU
                ? Math.min(this.qualityPreset.dustParticles, webgpuBudget.dust)
                : this.qualityPreset.webglDustParticles,
            burst: this.isWebGPU
                ? Math.min(this.qualityPreset.burstParticles, webgpuBudget.burst)
                : Math.max(128, Math.floor(this.qualityPreset.burstParticles * 0.4)),
        };
    }

    refreshFlags() {
        const currentFlags = { ...this.flags };
        const parsedFlags = parseAstralWeaveFlags();
        this.flags = {
            ...parsedFlags,
            forceWebGL: currentFlags.forceWebGL === true || parsedFlags.forceWebGL === true,
            noPost: currentFlags.noPost === true || parsedFlags.noPost === true,
            noMRT: currentFlags.noMRT === true || parsedFlags.noMRT === true,
            noCompute: currentFlags.noCompute === true || parsedFlags.noCompute === true,
            baseline: currentFlags.baseline === true || parsedFlags.baseline === true,
            seed: parsedFlags.seed ?? currentFlags.seed,
            fixedDtMs: parsedFlags.fixedDtMs ?? currentFlags.fixedDtMs,
            playback: parsedFlags.playback ?? currentFlags.playback,
            playbackLoops: parsedFlags.playbackLoops ?? currentFlags.playbackLoops,
            usePost: false,
            useMRT: false,
            useCompute: false,
        };

        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
    }

    applyQualityPreset(quality) {
        const normalized = normalizeQuality(quality);
        this.activeQualityLevel = normalized;
        this.qualityPreset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
        this.performanceBudget = { ...(QUALITY_BUDGETS[normalized] || QUALITY_BUDGETS.High) };
    }

    ensureContainer() {
        let container = document.getElementById('astral-weave-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'astral-weave-theme';
            container.className = 'theme-container';
            const backgroundContainer = document.querySelector('.background-container');
            Object.assign(container.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '1',
                pointerEvents: 'none',
                overflow: 'hidden',
            });
            (backgroundContainer || document.body).appendChild(container);
        }
        this.registerContainer(container);
        container.innerHTML = '';
        if (this.isActive) {
            document.querySelectorAll('.theme-container').forEach((themeContainer) => {
                themeContainer.classList.remove('active');
            });
            container.classList.add('active');
        }
        container.style.background = 'radial-gradient(circle at 50% 42%, rgba(35,44,78,0.18), rgba(3,6,17,0.9) 45%, rgba(1,2,8,1) 100%)';
        this.container = container;
        return container;
    }

    installPointUvWarningFilter() {
        if (this._origConsoleWarn) return;
        const origWarn = console.warn;
        this._origConsoleWarn = origWarn;
        console.warn = function filteredAstralWarn(...args) {
            if (typeof args[0] === 'string'
                && args[0].includes('Vertex attribute "uv" not found on geometry')) return;
            origWarn.apply(console, args);
        };
    }

    restorePointUvWarningFilter() {
        if (this._origConsoleWarn) {
            console.warn = this._origConsoleWarn;
            this._origConsoleWarn = null;
        }
    }

    async createScene() {
        this.refreshFlags();
        this.installPointUvWarningFilter();
        this.cleanupRuntime();
        this.fxController.reset();
        this.resetBaselineSamples();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = this.ensureContainer();
        const rendererReady = await this.initRenderer(container);
        if (!rendererReady) {
            console.error('[AstralWeave] Failed to initialize renderer');
            return;
        }

        await this.loadRuntimeModules();
        this.createGeneratedTextures();
        this.createSceneGraph();
        this.setupEventListeners();
        this.setupResizeListener();
        this.setupQualityListener();
        this.setupPostProcessing();
        this.configureRendererColorPipeline();
        this.startAnimation();

        if (this.flags.baseline) {
            this.installBaselineHelpers();
        }
        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, { loops: this.flags.playbackLoops });
        }
    }

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

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

        if (!this.flags.forceWebGL && navigator.gpu) {
            try {
                const renderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    preserveDrawingBuffer: this.flags.baseline === true,
                    powerPreference: 'high-performance',
                });
                await renderer.init();
                if (renderer.backend?.isWebGPUBackend === true) {
                    this.renderer = renderer;
                    this.isWebGPU = true;
                    this.capabilities.webgpu = true;
                    this.capabilities.maxColorAttachments = renderer.capabilities?.maxColorAttachments ?? 8;
                    this.capabilities.supportsPost = true;
                    this.capabilities.supportsMRT = this.capabilities.maxColorAttachments > 1;
                    this.capabilities.supportsCompute = typeof renderer.compute === 'function';
                } else {
                    renderer.dispose();
                    renderer.forceContextLoss?.();
                    renderer.domElement?.remove?.();
                }
            } catch (error) {
                console.warn('[AstralWeave] WebGPU init failed, using WebGL fallback:', error);
            }
        }

        if (!this.renderer) {
            try {
                this.renderer = new THREE.WebGLRenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    powerPreference: 'high-performance',
                    preserveDrawingBuffer: this.flags.baseline === true,
                });
                this.isWebGL = true;
                this.capabilities.webgl = true;
                this.capabilities.supportsPost = true;
                this.capabilities.supportsMRT = false;
                this.capabilities.supportsCompute = false;
                this.capabilities.maxColorAttachments = 1;
            } catch (error) {
                console.error('[AstralWeave] WebGL init failed:', error);
                return false;
            }
        }

        this.flags.usePost = this.capabilities.supportsPost
            && this.qualityPreset.enablePost === true
            && !this.flags.noPost;
        this.flags.useMRT = this.capabilities.supportsMRT
            && this.qualityPreset.enableMRT === true
            && !this.flags.noMRT;
        this.flags.useCompute = this.capabilities.supportsCompute
            && this.qualityPreset.enableCompute === true
            && !this.flags.noCompute;

        this.renderer.setPixelRatio(this.getEffectivePixelRatio(this.isWebGPU ? WEBGPU_RENDER_SCALE : WEBGL_RENDER_SCALE));
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setClearColor(this.palette.void, 1);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = true;
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x040612, 0.008);

        this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 500);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(0, 3.8, -8);

        if (this.isWebGPU && this.renderer?.backend?.device?.lost) {
            this.renderer.backend.device.lost.then((info) => {
                this.handleDeviceLost(info);
            });
        }

        this.webglContextLostHandler = (event) => {
            event.preventDefault();
            this.handleDeviceLost(event);
        };
        this.renderer.domElement.addEventListener('webglcontextlost', this.webglContextLostHandler, false);
        return true;
    }

    async loadRuntimeModules() {
        this.materialFactories = null;
        this.computeFactories = null;
        this.postFactories = null;

        if (this.isWebGPU) {
            this.materialFactories = AstralWeaveMaterialFactories;

            if (this.materialFactories && this.flags.useCompute) {
                this.computeFactories = AstralWeaveComputeFactories;
            }
        }

        this.postFactories = AstralWeavePostFactories;
    }

    createGeneratedTextures() {
        this.disposeTextures();

        this.textures.glow = createCanvasTexture(512, 512, (ctx, width, height) => {
            const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.45);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.18, 'rgba(186,240,255,0.95)');
            gradient.addColorStop(0.42, 'rgba(116,118,255,0.42)');
            gradient.addColorStop(0.72, 'rgba(42,18,92,0.12)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        });

        this.textures.nebula = createCanvasTexture(1024, 1024, (ctx, width, height) => {
            ctx.fillStyle = '#090515';
            ctx.fillRect(0, 0, width, height);
            for (let i = 0; i < 36; i += 1) {
                const x = this.random() * width;
                const y = this.random() * height;
                const radius = 80 + this.random() * 260;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                const colorA = `hsla(${200 + this.random() * 120}, 90%, ${45 + this.random() * 20}%, ${0.12 + this.random() * 0.14})`;
                const colorB = `hsla(${260 + this.random() * 90}, 90%, ${48 + this.random() * 18}%, ${0.06 + this.random() * 0.12})`;
                gradient.addColorStop(0, colorA);
                gradient.addColorStop(0.55, colorB);
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, TAU);
                ctx.fill();
            }
        }, {
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.RepeatWrapping,
        });

        this.textures.lensDirt = createCanvasTexture(512, 512, (ctx, width, height) => {
            ctx.clearRect(0, 0, width, height);
            for (let i = 0; i < 26; i += 1) {
                const x = this.random() * width;
                const y = this.random() * height;
                const radius = 18 + this.random() * 90;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                gradient.addColorStop(0, `rgba(255,255,255,${0.05 + this.random() * 0.04})`);
                gradient.addColorStop(0.4, `rgba(142,176,255,${0.02 + this.random() * 0.04})`);
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, TAU);
                ctx.fill();
            }
        });

        this.textures.centerVeil = createCanvasTexture(512, 512, (ctx, width, height) => {
            const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.46);
            gradient.addColorStop(0, 'rgba(5, 9, 18, 0.72)');
            gradient.addColorStop(0.55, 'rgba(4, 8, 16, 0.38)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        });
    }

    createSceneGraph() {
        this.rootGroup = new THREE.Group();
        this.rootGroup.position.set(0, 0.8, 0);
        this.scene.add(this.rootGroup);

        this.createCenterVeil();
        this.createNexus();
        this.createRibbons();
        this.createStarfield();
        this.createConstellations();
        this.createLightShafts();
        this.createNebulaLayers();
        this.createFlowParticles();
        this.createDustParticles();
        this.createBurstParticles();
        this.createShockwavePool();
    }

    createCenterVeil() {
        if (!this.textures.centerVeil || !this.scene) return;
        const geometry = new THREE.PlaneGeometry(28, 22);
        const material = new THREE.MeshBasicMaterial({
            map: this.textures.centerVeil,
            color: 0x050811,
            transparent: true,
            opacity: 0.54,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });
        this.centerVeil = new THREE.Mesh(geometry, material);
        this.centerVeil.position.set(0, 2, -2.5);
        this.scene.add(this.centerVeil);
    }

    createNexus() {
        this.nexusGroup = new THREE.Group();
        this.nexusGroup.position.copy(this.nexusLocalPosition);
        this.rootGroup.add(this.nexusGroup);
        this.nexusNodeData = [];

        if (this.isWebGPU && this.materialFactories) {
            const coreGeo = new THREE.IcosahedronGeometry(1.75, 3);
            const shellGeo = new THREE.TorusKnotGeometry(2.95, 0.13, 180, 20, 2, 3);
            const haloGeo = new THREE.TorusGeometry(4.35, 0.17, 12, 96);
            const halo2Geo = new THREE.TorusGeometry(5.2, 0.1, 12, 96);
            const halo3Geo = new THREE.TorusGeometry(6.0, 0.07, 12, 96);

            const coreData = this.materialFactories.createAstralNexusCoreNodeMaterial({
                colorA: this.palette.cyan,
                colorB: this.palette.magenta,
                colorC: this.palette.gold,
            });
            const shellData = this.materialFactories.createAstralNexusShellNodeMaterial({
                colorA: this.palette.blue,
                colorB: this.palette.pink,
                opacity: 0.11,
                pulseBias: 0.16,
            });
            const haloData = this.materialFactories.createAstralNexusShellNodeMaterial({
                colorA: this.palette.magenta,
                colorB: this.palette.cyan,
                opacity: 0.045,
                pulseBias: 0.1,
                additive: true,
            });
            const halo2Data = this.materialFactories.createAstralNexusShellNodeMaterial({
                colorA: this.palette.gold,
                colorB: this.palette.pink,
                opacity: 0.038,
                pulseBias: 0.08,
                additive: true,
            });
            const halo3Data = this.materialFactories.createAstralNexusShellNodeMaterial({
                colorA: this.palette.violet,
                colorB: this.palette.cyan,
                opacity: 0.032,
                pulseBias: 0.06,
                additive: true,
            });

            const core = new THREE.Mesh(coreGeo, coreData.material);
            const shell = new THREE.Mesh(shellGeo, shellData.material);
            const halo = new THREE.Mesh(haloGeo, haloData.material);
            const halo2 = new THREE.Mesh(halo2Geo, halo2Data.material);
            const halo3 = new THREE.Mesh(halo3Geo, halo3Data.material);
            
            shell.rotation.set(0.86, 0.18, 0.42);
            shell.scale.set(1, 0.94, 1.06);
            halo.rotation.set(Math.PI * 0.56, 0, 0.18);
            halo.scale.set(1, 0.72, 1);
            halo2.rotation.set(Math.PI * 0.25, Math.PI * 0.35, 0.5);
            halo3.rotation.set(-Math.PI * 0.3, -Math.PI * 0.15, 0.8);

            core.userData.baseRotation = new THREE.Euler(0, 0, 0);
            shell.userData.baseRotation = shell.rotation.clone();
            halo.userData.baseRotation = halo.rotation.clone();
            halo2.userData.baseRotation = halo2.rotation.clone();
            halo3.userData.baseRotation = halo3.rotation.clone();

            this.nexusGroup.add(core, shell, halo, halo2, halo3);
            this.nexusNodeData.push(coreData, shellData, haloData, halo2Data, halo3Data);
            return;
        }

        const isHighResNexus = this.activeQualityLevel !== 'Minimal' && this.activeQualityLevel !== 'Low';
        if (isHighResNexus) {
            const coreGeo = new THREE.IcosahedronGeometry(1.75, 3);
            const shellGeo = new THREE.TorusKnotGeometry(2.95, 0.13, 90, 12, 2, 3);
            const haloGeo = new THREE.TorusGeometry(4.35, 0.12, 8, 48);
            const halo2Geo = new THREE.TorusGeometry(5.2, 0.08, 8, 48);
            const halo3Geo = new THREE.TorusGeometry(6.0, 0.06, 8, 48);

            const coreMat = new THREE.MeshBasicMaterial({
                color: 0x73f8ff,
                transparent: true,
                opacity: 0.26,
                depthWrite: false,
            });
            const shellMat = new THREE.MeshBasicMaterial({
                color: 0xd95bff,
                transparent: true,
                opacity: 0.12,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const haloMat = new THREE.MeshBasicMaterial({
                color: 0x3b8dff,
                transparent: true,
                opacity: 0.08,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const halo2Mat = new THREE.MeshBasicMaterial({
                color: 0xff82d2,
                transparent: true,
                opacity: 0.06,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const halo3Mat = new THREE.MeshBasicMaterial({
                color: 0xffd96d,
                transparent: true,
                opacity: 0.04,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const core = new THREE.Mesh(coreGeo, coreMat);
            const shell = new THREE.Mesh(shellGeo, shellMat);
            const halo = new THREE.Mesh(haloGeo, haloMat);
            const halo2 = new THREE.Mesh(halo2Geo, halo2Mat);
            const halo3 = new THREE.Mesh(halo3Geo, halo3Mat);

            shell.rotation.set(0.86, 0.18, 0.42);
            shell.scale.set(1, 0.94, 1.06);
            halo.rotation.set(Math.PI * 0.56, 0, 0.18);
            halo.scale.set(1, 0.72, 1);
            halo2.rotation.set(Math.PI * 0.25, Math.PI * 0.35, 0.5);
            halo3.rotation.set(-Math.PI * 0.3, -Math.PI * 0.15, 0.8);

            core.userData.baseRotation = new THREE.Euler(0, 0, 0);
            shell.userData.baseRotation = shell.rotation.clone();
            halo.userData.baseRotation = halo.rotation.clone();
            halo2.userData.baseRotation = halo2.rotation.clone();
            halo3.userData.baseRotation = halo3.rotation.clone();

            this.nexusGroup.add(core, shell, halo, halo2, halo3);
            return;
        }

        const glowTexture = this.textures.glow;
        const sizes = [6, 10, 16, 23];
        const colors = [0xffffff, 0x73f8ff, 0xd95bff, 0xffd96d];
        sizes.forEach((size, index) => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: colors[index],
                transparent: true,
                opacity: index === 0 ? 0.95 : 0.32 + index * 0.08,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            }));
            sprite.scale.set(size, size, 1);
            sprite.userData.baseScale = size;
            this.nexusGroup.add(sprite);
        });
    }

    createLightShafts() {
        this.lightShafts = [];
        this.lightShaftNodeData = [];

        if (this.activeQualityLevel === 'Minimal' || this.activeQualityLevel === 'Low') {
            return;
        }

        const count = 8;
        const radius = 18;
        const height = 48;
        const geometry = new THREE.CylinderGeometry(0.1, radius, height, 16, 1, true);
        geometry.translate(0, -height / 2, 0);

        for (let i = 0; i < count; i += 1) {
            let material = null;
            let nodeData = null;

            const speed = 0.12 + (i % 3) * 0.06;
            if (this.isWebGPU && this.materialFactories?.createAstralLightShaftNodeMaterial) {
                nodeData = this.materialFactories.createAstralLightShaftNodeMaterial({
                    colorA: this.palette.cyan,
                    colorB: this.palette.magenta,
                    opacity: 0.045 + (i % 3) * 0.015,
                    scrollSpeed: speed,
                });
                material = nodeData.material;
                this.lightShaftNodeData.push(nodeData);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        time: { value: 0 },
                        opacity: { value: 0.065 + (i % 3) * 0.015 },
                        colorA: { value: this.palette.cyan },
                        colorB: { value: this.palette.magenta },
                    },
                    vertexShader: lightShaftVertexShader,
                    fragmentShader: lightShaftFragmentShader,
                    transparent: true,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    blending: THREE.AdditiveBlending,
                });
            }

            const shaft = new THREE.Mesh(geometry, material);
            const theta = (i / count) * TAU + this.random() * 0.3;
            const phi = Math.acos(2 * this.random() - 1);
            shaft.rotation.set(phi, theta, this.random() * TAU);
            
            shaft.userData = {
                baseRotation: shaft.rotation.clone(),
                rotSpeedX: (this.random() - 0.5) * 0.06,
                rotSpeedY: (this.random() - 0.5) * 0.06,
                rotSpeedZ: 0.04 + this.random() * 0.06,
            };

            this.nexusGroup.add(shaft);
            this.lightShafts.push(shaft);
        }
    }

    createConstellations() {
        if (this.activeQualityLevel === 'Minimal' || this.activeQualityLevel === 'Low') {
            return;
        }

        const positionAttr = this.starfield?.geometry?.getAttribute('position');
        if (!positionAttr) return;

        const count = positionAttr.count;
        const searchCount = Math.min(250, count);
        const pairs = [];
        const maxDist = 20.0;
        const minDist = 8.0;

        for (let i = 0; i < searchCount; i += 1) {
            const x1 = positionAttr.getX(i);
            const y1 = positionAttr.getY(i);
            const z1 = positionAttr.getZ(i);
            const p1 = new THREE.Vector3(x1, y1, z1);

            let connections = 0;
            const neighbors = [];
            for (let j = i + 1; j < searchCount; j += 1) {
                const x2 = positionAttr.getX(j);
                const y2 = positionAttr.getY(j);
                const z2 = positionAttr.getZ(j);
                const p2 = new THREE.Vector3(x2, y2, z2);

                const d = p1.distanceTo(p2);
                if (d > minDist && d < maxDist) {
                    neighbors.push({ pos: p2, dist: d });
                }
            }

            neighbors.sort((a, b) => a.dist - b.dist);
            for (let k = 0; k < Math.min(2, neighbors.length); k += 1) {
                pairs.push(p1.x, p1.y, p1.z);
                pairs.push(neighbors[k].pos.x, neighbors[k].pos.y, neighbors[k].pos.z);
            }
        }

        if (pairs.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pairs, 3));

        const lineCount = pairs.length / 6;
        const uvs = new Float32Array(lineCount * 2 * 2);
        for (let i = 0; i < lineCount; i += 1) {
            uvs[i * 4] = 0; uvs[i * 4 + 1] = 0.5;
            uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = 0.5;
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        let material = null;
        if (this.isWebGPU && this.materialFactories?.createAstralConstellationNodeMaterial) {
            this.constellationNodeData = this.materialFactories.createAstralConstellationNodeMaterial({
                colorA: this.palette.cyan,
                colorB: this.palette.magenta,
                opacity: 0.18,
            });
            material = this.constellationNodeData.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    opacity: { value: 0.22 },
                    colorA: { value: this.palette.cyan },
                    colorB: { value: this.palette.magenta },
                },
                vertexShader: constellationVertexShader,
                fragmentShader: constellationFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        }

        this.constellations = new THREE.LineSegments(geometry, material);
        this.constellations.frustumCulled = false;
        this.constellations.renderOrder = 5;
        this.scene.add(this.constellations);
    }

    buildRibbonCurve(index, total) {
        const angle = (index / total) * TAU;
        const drift = Math.sin(index * 0.73);
        const start = this.nexusLocalPosition.clone().add(new THREE.Vector3(
            Math.cos(angle) * 1.8,
            Math.sin(index * 0.3) * 1.2,
            Math.sin(angle) * 1.6,
        ));
        const control1 = new THREE.Vector3(
            Math.cos(angle) * 7 + Math.sin(index * 0.42) * 3.2,
            8 + Math.sin(index * 0.55) * 3.5,
            -14 + Math.sin(angle) * 7,
        );
        const control2 = new THREE.Vector3(
            Math.cos(angle + drift * 0.15) * 16,
            2 + Math.cos(index * 0.37) * 10,
            -20 + Math.sin(angle + 0.6) * 13,
        );
        const end = new THREE.Vector3(
            Math.cos(angle + 0.85) * 28,
            -8 + Math.sin(index * 0.41) * 12,
            -26 + Math.sin(angle + 1.2) * 18,
        );
        return new THREE.CatmullRomCurve3([start, control1, control2, end]);
    }

    createRibbons() {
        this.ribbonMeshes = [];
        this.ribbonNodeData = [];
        const count = this.qualityPreset.ribbons;
        const palette = [
            [this.palette.cyan, this.palette.magenta, this.palette.gold],
            [this.palette.blue, this.palette.cyan, this.palette.white],
            [this.palette.magenta, this.palette.violet, this.palette.cyan],
            [this.palette.gold, this.palette.magenta, this.palette.pink],
        ];

        for (let i = 0; i < count; i += 1) {
            const curve = this.buildRibbonCurve(i, count);
            const geometry = new THREE.TubeGeometry(
                curve,
                this.qualityPreset.ribbonSegments,
                0.12 + (i % 4) * 0.016,
                10,
                false,
            );
            const colors = palette[i % palette.length];
            let material = null;
            let nodeData = null;

            if (this.isWebGPU && this.materialFactories) {
                nodeData = this.materialFactories.createAstralRibbonNodeMaterial({
                    colorA: colors[0],
                    colorB: colors[1],
                    colorC: colors[2],
                    flowSpeed: 0.8 + (i % 7) * 0.11,
                    pulseOffset: i * 0.31,
                });
                material = nodeData.material;
                this.ribbonNodeData.push(nodeData);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        time: { value: 0 },
                        intensity: { value: 1 },
                        flowSpeed: { value: 1.1 + (i % 7) * 0.11 },
                        waveIntensity: { value: 0.36 + (i % 5) * 0.04 },
                        colorA: { value: colors[0] },
                        colorB: { value: colors[1] },
                        colorC: { value: colors[2] },
                    },
                    vertexShader: ribbonVertexShader,
                    fragmentShader: ribbonFragmentShader,
                    transparent: true,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    blending: THREE.AdditiveBlending,
                });
            }

            const ribbon = new THREE.Mesh(geometry, material);
            ribbon.userData.rotationSeed = i * 0.23;
            ribbon.userData.baseScale = 1 + (i % 5) * 0.015;
            this.rootGroup.add(ribbon);
            this.ribbonMeshes.push(ribbon);
        }
    }

    createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const brightness = new Float32Array(starCount);
        const twinkle = new Float32Array(starCount * 2);
        const randoms = new Float32Array(starCount);
        const colorOptions = [
            this.palette.white,
            this.palette.cyan.clone().lerp(this.palette.white, 0.55),
            this.palette.magenta.clone().lerp(this.palette.white, 0.45),
            this.palette.gold.clone().lerp(this.palette.white, 0.35),
        ];

        for (let i = 0; i < starCount; i += 1) {
            let x = 0;
            let y = 0;
            let z = 0;
            let tries = 0;
            do {
                const band = i % 3;
                const radius = band === 0 ? 110 + this.random() * 70 : band === 1 ? 150 + this.random() * 80 : 210 + this.random() * 100;
                const theta = this.random() * TAU;
                const phi = Math.acos(2 * this.random() - 1);
                x = radius * Math.sin(phi) * Math.cos(theta);
                y = radius * Math.sin(phi) * Math.sin(theta);
                z = -radius * 0.25 + radius * Math.cos(phi);
                tries += 1;
            } while (Math.abs(x) < 14 && y > -10 && y < 12 && z > -90 && tries < 5);

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            const starColor = colorOptions[i % colorOptions.length];
            const intensity = 0.76 + this.random() * 0.4;
            colors[i * 3] = starColor.r * intensity;
            colors[i * 3 + 1] = starColor.g * intensity;
            colors[i * 3 + 2] = starColor.b * intensity;

            sizes[i] = 1 + this.random() * 3.4;
            brightness[i] = 0.6 + this.random() * 0.75;
            twinkle[i * 2] = this.random() * TAU;
            twinkle[i * 2 + 1] = 0.6 + this.random() * 2.4;
            randoms[i] = this.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 2));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        let material = null;
        if (this.isWebGPU && this.materialFactories) {
            this.starfieldNodeData = this.materialFactories.createAstralStarfieldNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                diffractionStrength: this.activeQualityLevel === 'Medium' ? 0.18 : 0.3,
            });
            material = this.starfieldNodeData.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: { time: { value: 0 } },
                vertexShader: starsVertexShader,
                fragmentShader: starsFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });
        }

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.frustumCulled = false;
        this.scene.add(this.starfield);
    }

    createNebulaLayers() {
        this.nebulaLayers = [];
        this.nebulaNodeData = [];
        const count = this.qualityPreset.nebulaLayers;
        const tints = [
            [new THREE.Color(0x2374ff), new THREE.Color(0xd95bff)],
            [new THREE.Color(0x6d5bff), new THREE.Color(0xff74d1)],
            [new THREE.Color(0x43b8ff), new THREE.Color(0xffc966)],
        ];

        for (let i = 0; i < count; i += 1) {
            const size = 20 + i * 5 + this.random() * 6;
            const geometry = new THREE.PlaneGeometry(size, size * (0.68 + this.random() * 0.2));
            const tint = tints[i % tints.length];
            let material = null;
            let nodeData = null;

            if (this.isWebGPU && this.materialFactories) {
                nodeData = this.materialFactories.createAstralNebulaNodeMaterial({
                    texture: this.textures.nebula,
                    opacity: 0.06 + this.random() * 0.03,
                    drift: 0.12 + this.random() * 0.18,
                    tintA: tint[0],
                    tintB: tint[1],
                });
                material = nodeData.material;
                this.nebulaNodeData.push(nodeData);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        time: { value: 0 },
                        opacity: { value: 0.14 + this.random() * 0.1 },
                        colorA: { value: tint[0] },
                        colorB: { value: tint[1] },
                    },
                    vertexShader: nebulaVertexShader,
                    fragmentShader: nebulaFragmentShader,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                });
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                (this.random() - 0.5) * 40,
                -6 + this.random() * 26,
                -26 - i * 8 - this.random() * 26,
            );
            mesh.rotation.z = this.random() * TAU;
            mesh.userData.rotationSpeed = (this.random() - 0.5) * 0.012;
            this.scene.add(mesh);
            this.nebulaLayers.push(mesh);
        }
    }

    createFlowParticles() {
        const particleCounts = this.getActiveParticleCounts();
        const count = particleCounts.flow;
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const seeds = new Float32Array(count);
        const tones = new Float32Array(count);
        const positions = new Float32Array(count * 3);
        const angles = new Float32Array(count);
        const radii = new Float32Array(count);
        const speeds = new Float32Array(count);
        const palette = [this.palette.cyan, this.palette.magenta, this.palette.gold, this.palette.white];

        for (let i = 0; i < count; i += 1) {
            const color = palette[i % palette.length];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            sizes[i] = 1.3 + this.random() * 2.5;
            seeds[i] = this.random();
            tones[i] = this.random();
            angles[i] = this.random() * TAU;
            radii[i] = 4 + this.random() ** 0.6 * 20;
            speeds[i] = 0.5 + this.random() * 1.1;
            positions[i * 3] = (this.random() - 0.5) * 20;
            positions[i * 3 + 1] = (this.random() - 0.5) * 10;
            positions[i * 3 + 2] = -10 + (this.random() - 0.5) * 16;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aCenter', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1));
        geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
        geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(seeds, 1));

        if (this.isWebGPU && this.materialFactories && this.flags.useCompute && this.computeFactories?.AstralWeaveFlowParticleCompute) {
            this.flowCompute = new this.computeFactories.AstralWeaveFlowParticleCompute(
                count,
                {
                    laneCount: this.qualityPreset.ribbons,
                    radiusMin: 6,
                    radiusMax: 26,
                    verticalScale: 8,
                    depthScale: 13,
                    center: this.getNexusWorldPosition(new THREE.Vector3()),
                    swirlScale: 1,
                },
                () => this.random(),
            );
            this.flowCompute.createComputeNode();
        }

        let material = null;
        if (this.isWebGPU && this.materialFactories) {
            this.flowNodeData = this.materialFactories.createAstralFlowParticleNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                flowCompute: this.flowCompute,
                colorA: this.palette.cyan,
                colorB: this.palette.magenta,
                colorC: this.palette.gold,
                opacity: 0.32,
                emissiveScale: 0.09,
            });
            material = this.flowNodeData.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: { time: { value: 0 } },
                vertexShader: weaveParticleVertexShader,
                fragmentShader: weaveParticleFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });
        }
        this.flowParticles = new THREE.Points(geometry, material);
        this.flowParticles.frustumCulled = false;
        this.flowParticles.renderOrder = 18;
        this.scene.add(this.flowParticles);
        this.liveParticleCounts.flow = count;
    }

    createDustParticles() {
        const particleCounts = this.getActiveParticleCounts();
        const count = particleCounts.dust;
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const seeds = new Float32Array(count);
        const tones = new Float32Array(count);
        const positions = new Float32Array(count * 3);
        const palette = [this.palette.white, this.palette.cyan, this.palette.gold];

        for (let i = 0; i < count; i += 1) {
            const color = palette[i % palette.length];
            const brightness = 0.75 + this.random() * 0.2;
            colors[i * 3] = color.r * brightness;
            colors[i * 3 + 1] = color.g * brightness;
            colors[i * 3 + 2] = color.b * brightness;
            sizes[i] = 1.2 + this.random() * 2.2;
            seeds[i] = this.random();
            tones[i] = this.random();
            positions[i * 3] = (this.random() - 0.5) * 26;
            positions[i * 3 + 1] = (this.random() - 0.5) * 18;
            positions[i * 3 + 2] = -2 + (this.random() - 0.5) * 12;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aCenter', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(seeds, 1));

        if (this.isWebGPU && this.materialFactories && this.flags.useCompute && this.computeFactories?.AstralWeaveFlowParticleCompute) {
            this.dustCompute = new this.computeFactories.AstralWeaveFlowParticleCompute(
                count,
                {
                    laneCount: Math.max(6, Math.floor(this.qualityPreset.ribbons / 2)),
                    radiusMin: 10,
                    radiusMax: 28,
                    verticalScale: 11,
                    depthScale: 6,
                    center: this.getDustWorldPosition(new THREE.Vector3()),
                    swirlScale: 0.55,
                },
                () => this.random(),
            );
            this.dustCompute.createComputeNode();
        }

        let material = null;
        if (this.isWebGPU && this.materialFactories) {
            this.dustNodeData = this.materialFactories.createAstralFlowParticleNodeMaterial({
                pixelRatio: this.renderer.getPixelRatio(),
                flowCompute: this.dustCompute,
                colorA: this.palette.white,
                colorB: this.palette.cyan,
                colorC: this.palette.gold,
                opacity: 0.18,
                emissiveScale: 0.05,
            });
            material = this.dustNodeData.material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    color: { value: this.palette.cyan },
                },
                vertexShader: dustVertexShader,
                fragmentShader: dustFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        }
        this.dustParticles = new THREE.Points(geometry, material);
        this.dustParticles.frustumCulled = false;
        this.dustParticles.renderOrder = 16;
        this.scene.add(this.dustParticles);
        this.liveParticleCounts.dust = count;
    }

    createBurstParticles() {
        if (!(this.isWebGPU && this.materialFactories)) return;

        const particleCounts = this.getActiveParticleCounts();
        const count = particleCounts.burst;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const seeds = new Float32Array(count);
        const palette = [this.palette.cyan, this.palette.magenta, this.palette.gold, this.palette.white];

        for (let i = 0; i < count; i += 1) {
            const color = palette[i % palette.length];
            positions[i * 3 + 2] = -9999;
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            sizes[i] = 2.8 + this.random() * 4.2;
            seeds[i] = this.random();
        }

        if (this.flags.useCompute && this.computeFactories?.AstralWeaveBurstCompute) {
            this.burstCompute = new this.computeFactories.AstralWeaveBurstCompute(
                count,
                () => this.random(),
            );
            this.burstCompute.createComputeNode();
        }

        this.burstNodeData = this.materialFactories.createAstralBurstNodeMaterial({
            pixelRatio: this.renderer.getPixelRatio(),
            burstCompute: this.burstCompute,
            colorA: this.palette.cyan,
            colorB: this.palette.magenta,
            colorC: this.palette.gold,
        });

        this.burstParticles = createIdentityInstancedBillboardMesh(this.burstNodeData.material, count, {
            aCenter: { array: positions, itemSize: 3 },
            color: { array: colors, itemSize: 3 },
            aSize: { array: sizes, itemSize: 1 },
            aSeed: { array: seeds, itemSize: 1 },
        });
        this.burstParticles.frustumCulled = false;
        this.burstParticles.renderOrder = 20;
        this.scene.add(this.burstParticles);
        this.liveParticleCounts.burst = count;
    }

    createShockwavePool() {
        this.shockwaves = [];
        const poolSize = Math.min(8, Math.max(4, Math.floor(this.qualityPreset.ribbons / 8)));
        const origin = this.getNexusWorldPosition(new THREE.Vector3());

        for (let i = 0; i < poolSize; i += 1) {
            let mesh = null;
            let uniforms = null;

            if (this.isWebGPU && this.materialFactories) {
                const nodeData = this.materialFactories.createAstralShockwaveNodeMaterial({
                    colorA: this.palette.cyan,
                    colorB: this.palette.magenta,
                });
                mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), nodeData.material);
                uniforms = nodeData.uniforms;
                mesh.rotation.x = -Math.PI * 0.5;
            } else {
                mesh = new THREE.Mesh(
                    new THREE.TorusGeometry(2.2, 0.08, 12, 72),
                    new THREE.ShaderMaterial({
                        uniforms: {
                            time: { value: 0 },
                            opacity: { value: 0 },
                            color: { value: this.palette.cyan.clone() },
                        },
                        vertexShader: pulseVertexShader,
                        fragmentShader: pulseFragmentShader,
                        transparent: true,
                        blending: THREE.AdditiveBlending,
                        side: THREE.DoubleSide,
                    }),
                );
                uniforms = mesh.material.uniforms;
            }

            mesh.visible = false;
            mesh.position.copy(origin);
            mesh.userData = {
                active: false,
                progress: 1,
                speed: 1.2,
                baseScale: 1,
            };
            this.scene.add(mesh);
            this.shockwaves.push({ mesh, uniforms });
        }
    }

    setupPostProcessing() {
        if (!this.flags.usePost || !this.postFactories?.AstralWeavePost) {
            this.postProcessing = null;
            this.flags.usePost = false;
            return;
        }

        try {
            this.postProfile = this.postFactories.getAstralWeavePostProfile(this.activeQualityLevel);
            if (this.postProfile.enabled !== true) {
                this.postProcessing = null;
                return;
            }

            this.postProcessing = new this.postFactories.AstralWeavePost(
                this.renderer,
                this.scene,
                this.camera,
                {
                    ...this.postProfile,
                    useMRT: this.flags.useMRT === true,
                    lensDirtTexture: this.textures.lensDirt,
                },
            );
            this.postProcessing.setSize(window.innerWidth, window.innerHeight);
        } catch (error) {
            console.warn('[AstralWeave] Post-processing init failed, disabling post:', error);
            this.postProcessing = null;
            this.flags.usePost = false;
        }
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;
        const postOwnsToneMapping = this.isWebGPU && this.flags.usePost && this.postProcessing;
        if (postOwnsToneMapping) {
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1;
            return;
        }
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.03;
    }

    startAnimation() {
        if (!this.renderer) return;
        this.clock.start();
        this.renderLoop = () => {
            if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;
            if (!this.shouldRenderFrame()) return;

            const delta = this.getDelta();
            this.time += delta;
            this.fxController.step(delta);

            const signals = this.fxController.getSignals();
            this.spawnPendingReactiveEffects();
            this.updateSceneMotion(delta, signals);
            this.updateCamera(delta, signals);
            this.updateCompute(delta, signals);
            this.updateUniforms(signals);
            this.updateShockwaves(delta);
            this.render();
            this.trackBaselineFrame(delta);
        };
        this.renderer.setAnimationLoop(this.renderLoop);
    }

    getDelta() {
        if (this.fixedDeltaSeconds) {
            this.fixedElapsedTime += this.fixedDeltaSeconds;
            return this.fixedDeltaSeconds;
        }
        return Math.min(0.05, this.clock.getDelta());
    }

    updateSceneMotion(_delta, signals) {
        if (!this.rootGroup) return;
        const driftTime = this.time * 0.18;
        const braidMotion = 1 + signals.braidVelocity * 0.24;
        this.rootGroup.position.x = Math.sin(driftTime) * 2.8 + Math.cos(driftTime * 0.6) * 1.2;
        this.rootGroup.position.y = 0.6 + Math.cos(driftTime * 0.7) * 1.1 + signals.comboEnergy * 0.22;
        this.rootGroup.position.z = Math.sin(driftTime * 0.5) * 1.8;
        this.rootGroup.rotation.y = Math.sin(driftTime * 0.4) * 0.12 + signals.braidVelocity * 0.018;
        this.rootGroup.rotation.z = Math.cos(driftTime * 0.3) * 0.025 + signals.comboEnergy * 0.008;

        if (this.nexusGroup) {
            const scale = 1 + signals.linePulse * 0.1 + signals.comboEnergy * 0.05;
            this.nexusGroup.scale.setScalar(scale);
            this.nexusGroup.rotation.y = this.time * (0.08 + signals.braidVelocity * 0.06);
            this.nexusGroup.rotation.x = Math.sin(this.time * 0.42) * 0.08;

            const [core, shell, halo, halo2, halo3] = this.nexusGroup.children;
            if (core) {
                core.rotation.x = Math.sin(this.time * 0.58) * 0.12;
                core.rotation.y = this.time * 0.24;
            }
            if (shell?.userData?.baseRotation) {
                shell.rotation.x = shell.userData.baseRotation.x + Math.sin(this.time * 0.32) * 0.18;
                shell.rotation.y = shell.userData.baseRotation.y + this.time * 0.22;
                shell.rotation.z = shell.userData.baseRotation.z + Math.cos(this.time * 0.38) * 0.14;
            }
            if (halo?.userData?.baseRotation) {
                halo.rotation.x = halo.userData.baseRotation.x + Math.sin(this.time * 0.18) * 0.08;
                halo.rotation.y = halo.userData.baseRotation.y - this.time * 0.12;
                halo.rotation.z = halo.userData.baseRotation.z + Math.cos(this.time * 0.24) * 0.1;
            }
            if (halo2?.userData?.baseRotation) {
                halo2.rotation.x = halo2.userData.baseRotation.x + Math.sin(this.time * 0.22) * 0.08;
                halo2.rotation.y = halo2.userData.baseRotation.y + this.time * 0.16;
                halo2.rotation.z = halo2.userData.baseRotation.z + Math.cos(this.time * 0.28) * 0.08;
            }
            if (halo3?.userData?.baseRotation) {
                halo3.rotation.x = halo3.userData.baseRotation.x + Math.sin(this.time * 0.14) * 0.06;
                halo3.rotation.y = halo3.userData.baseRotation.y - this.time * 0.2;
                halo3.rotation.z = halo3.userData.baseRotation.z + Math.cos(this.time * 0.18) * 0.06;
            }
        }

        this.ribbonMeshes.forEach((ribbon, index) => {
            const localDrift = this.time * (0.18 + signals.braidVelocity * 0.08);
            ribbon.rotation.z = Math.sin(localDrift + ribbon.userData.rotationSeed) * 0.05 * braidMotion;
            ribbon.rotation.x = Math.cos(localDrift * 1.2 + index * 0.37) * 0.035 * braidMotion;
            ribbon.rotation.y = Math.sin(localDrift * 0.9 + index * 0.29) * 0.05 * braidMotion;
            ribbon.position.x = Math.sin(localDrift * 0.7 + index * 0.41) * 0.18 * braidMotion;
            ribbon.position.y = Math.cos(localDrift * 0.58 + index * 0.33) * 0.14 * (1 + signals.linePulse * 0.2);
            ribbon.position.z = Math.sin(localDrift * 0.52 + index * 0.27) * 0.16 * braidMotion;
            ribbon.scale.setScalar(
                ribbon.userData.baseScale
                + Math.sin(this.time * 0.42 + index * 0.31) * 0.028
                + signals.comboEnergy * 0.012,
            );
        });

        if (this.lightShafts) {
            this.lightShafts.forEach((shaft) => {
                shaft.rotation.x = shaft.userData.baseRotation.x + Math.sin(this.time * 0.2) * shaft.userData.rotSpeedX;
                shaft.rotation.y = shaft.userData.baseRotation.y + this.time * shaft.userData.rotSpeedY;
                shaft.rotation.z = shaft.userData.baseRotation.z + this.time * shaft.userData.rotSpeedZ;
            });
        }

        if (this.constellations) {
            this.constellations.rotation.y = this.time * 0.005;
            this.constellations.rotation.x = Math.sin(this.time * 0.02) * 0.015;
        }

        if (this.starfield) {
            this.starfield.rotation.y = this.time * 0.01;
            this.starfield.rotation.x = Math.sin(this.time * 0.04) * 0.03;
        }

        this.nebulaLayers.forEach((mesh, index) => {
            mesh.rotation.z += mesh.userData.rotationSpeed;
            mesh.position.x += Math.sin(this.time * 0.08 + index) * 0.002;
            mesh.position.y += Math.cos(this.time * 0.05 + index * 0.3) * 0.001;
        });
    }

    updateCamera(_delta, signals) {
        const sway = this.time * 0.13;
        const shakeScale = (this.qualityPreset.cameraShakeScale || 1) * signals.cameraImpulse;
        this.cameraShake.x = (this.random() - 0.5) * shakeScale * 0.85;
        this.cameraShake.y = (this.random() - 0.5) * shakeScale * 0.55;

        this.camera.position.x = Math.sin(sway) * 2.2 + this.cameraShake.x;
        this.camera.position.y = this.cameraBasePosition.y + Math.sin(sway * 0.6) * 1.2 + this.cameraShake.y;
        this.camera.position.z = this.cameraBasePosition.z + Math.cos(sway * 0.5) * 2.4;
        this.camera.lookAt(Math.sin(sway * 0.4) * 1.2, 3.4 + signals.linePulse * 0.25, -8);
    }

    updateCompute(delta, signals) {
        if (!(this.isWebGPU && this.renderer?.compute)) return;

        const nexusWorld = this.getNexusWorldPosition(new THREE.Vector3());
        const dustWorld = this.getDustWorldPosition(new THREE.Vector3());
        const energy = Math.min(
            3.2,
            signals.linePulse + signals.comboEnergy + signals.pieceLockPulse + signals.braidVelocity * 0.45,
        );

        if (this.flowCompute?.computeNode) {
            this.flowCompute.update(delta, this.time, {
                energy,
                center: nexusWorld,
                swirlScale: 1 + signals.comboEnergy * 0.26 + signals.braidVelocity * 0.22,
                verticalScale: 8.5 + signals.linePulse * 2.2 + signals.comboEnergy * 0.8,
                depthScale: 13.5 + signals.comboEnergy * 2.4 + signals.linePulse * 0.9,
            });
            this.renderer.compute(this.flowCompute.computeNode);
        }

        if (this.dustCompute?.computeNode) {
            this.dustCompute.update(delta, this.time, {
                energy: signals.comboEnergy * 0.55 + signals.linePulse * 0.12,
                center: dustWorld,
                swirlScale: 0.65 + signals.linePulse * 0.12 + signals.braidVelocity * 0.08,
                verticalScale: 11.5 + signals.pieceLockPulse * 1.5,
                depthScale: 7.6,
            });
            this.renderer.compute(this.dustCompute.computeNode);
        }

        if (this.burstCompute?.computeNode) {
            this.burstCompute.update(delta, {
                gravity: -11.5,
                drag: 0.985,
            });
            this.renderer.compute(this.burstCompute.computeNode);
        }
    }

    updateUniforms(signals) {
        const effectMix = Math.min(
            3.0,
            signals.linePulse + signals.comboEnergy + signals.pieceLockPulse + signals.braidVelocity * 0.35,
        );

        this.nexusNodeData.forEach((nodeData) => {
            copyUniformValue(nodeData.uniforms?.uTime, this.time);
            copyUniformValue(nodeData.uniforms?.uEnergy, effectMix);
            copyUniformValue(nodeData.uniforms?.uLinePulse, signals.linePulse);
            copyUniformValue(nodeData.uniforms?.uComboEnergy, signals.comboEnergy);
        });

        this.ribbonNodeData.forEach((nodeData) => {
            copyUniformValue(nodeData.uniforms?.uTime, this.time);
            copyUniformValue(nodeData.uniforms?.uEnergy, effectMix);
            copyUniformValue(nodeData.uniforms?.uLinePulse, signals.linePulse);
            copyUniformValue(nodeData.uniforms?.uComboEnergy, signals.comboEnergy);
        });

        this.nebulaNodeData.forEach((nodeData, index) => {
            copyUniformValue(nodeData.uniforms?.uTime, this.time);
            copyUniformValue(nodeData.uniforms?.uPulse, Math.min(1.4, signals.comboEnergy * 0.3 + signals.linePulse * 0.4 + index * 0.03));
        });

        if (this.starfieldNodeData) {
            copyUniformValue(this.starfieldNodeData.uniforms.uTime, this.time);
            copyUniformValue(this.starfieldNodeData.uniforms.uScintillation, signals.starScintillation);
        }

        if (this.flowNodeData) {
            copyUniformValue(this.flowNodeData.uniforms.uTime, this.time);
            copyUniformValue(this.flowNodeData.uniforms.uLinePulse, signals.linePulse);
            copyUniformValue(this.flowNodeData.uniforms.uComboEnergy, signals.comboEnergy);
        }

        if (this.dustNodeData) {
            copyUniformValue(this.dustNodeData.uniforms.uTime, this.time);
            copyUniformValue(this.dustNodeData.uniforms.uLinePulse, signals.pieceLockPulse);
            copyUniformValue(this.dustNodeData.uniforms.uComboEnergy, signals.comboEnergy * 0.4);
        }

        if (this.burstNodeData) {
            copyUniformValue(this.burstNodeData.uniforms.uTime, this.time);
            copyUniformValue(this.burstNodeData.uniforms.uEnergy, effectMix);
        }

        this.lightShaftNodeData.forEach((nodeData) => {
            copyUniformValue(nodeData.uniforms?.uTime, this.time);
            copyUniformValue(nodeData.uniforms?.uPulse, signals.linePulse);
        });

        if (this.constellationNodeData) {
            copyUniformValue(this.constellationNodeData.uniforms.uTime, this.time);
            copyUniformValue(this.constellationNodeData.uniforms.uScintillation, signals.starScintillation);
        }

        this.shockwaves.forEach(({ uniforms, mesh }) => {
            if (!mesh.userData.active) return;
            copyUniformValue(uniforms?.uProgress, mesh.userData.progress);
            copyUniformValue(uniforms?.uOpacity, 1 - mesh.userData.progress);
            copyUniformValue(uniforms?.time, this.time);
            copyUniformValue(uniforms?.opacity, 1 - mesh.userData.progress);
        });

        if (!this.isWebGPU) {
            this.ribbonMeshes.forEach((mesh) => {
                if (mesh.material?.uniforms?.time) mesh.material.uniforms.time.value = this.time;
                if (mesh.material?.uniforms?.intensity) mesh.material.uniforms.intensity.value = 1 + effectMix * 0.16;
            });
            if (this.starfield?.material?.uniforms?.time) this.starfield.material.uniforms.time.value = this.time;
            if (this.flowParticles?.material?.uniforms?.time) this.flowParticles.material.uniforms.time.value = this.time;
            if (this.dustParticles?.material?.uniforms?.time) this.dustParticles.material.uniforms.time.value = this.time;
            this.nebulaLayers.forEach((mesh) => {
                if (mesh.material?.uniforms?.time) mesh.material.uniforms.time.value = this.time;
            });
            if (this.lightShafts) {
                this.lightShafts.forEach((shaft) => {
                    if (shaft.material?.uniforms?.time) shaft.material.uniforms.time.value = this.time;
                    if (shaft.material?.uniforms?.opacity) {
                        // Base opacity mod speedZ to differentiate, multiplied by linePulse impact
                        shaft.material.uniforms.opacity.value = (0.045 + (shaft.userData.rotSpeedZ * 10.0 % 0.015)) * (1.0 + signals.linePulse * 0.4);
                    }
                });
            }
            if (this.constellations?.material?.uniforms?.time) {
                this.constellations.material.uniforms.time.value = this.time;
                this.constellations.material.uniforms.opacity.value = 0.22 * (1.0 + signals.starScintillation * 0.5);
            }
        }

        if (this.postProcessing?.updateDynamic) {
            this.postProcessing.updateDynamic({
                time: this.time,
                bloomStrength: (this.postProfile?.bloomStrength ?? this.qualityPreset.bloomStrength)
                    * (1 + effectMix * 0.07),
                lensingStrength: this.qualityPreset.enableLensing ? Math.min(1, signals.centerLensing * 0.55 + signals.comboEnergy * 0.12) : 0,
            });
        }
    }

    spawnPendingReactiveEffects() {
        const bursts = this.fxController.drainBursts();
        const nexusWorld = this.getNexusWorldPosition(new THREE.Vector3());
        const dustWorld = this.getDustWorldPosition(new THREE.Vector3());

        if (this.burstCompute) {
            if (bursts.flowShards > 0) {
                this.burstCompute.spawnBurst(bursts.flowShards, nexusWorld, {
                    spread: 5.5,
                    verticalBoost: 5.2,
                    speedMin: 3.8,
                    speedMax: 12.8,
                });
            }
            if (bursts.dustPops > 0) {
                this.burstCompute.spawnBurst(bursts.dustPops, dustWorld, {
                    spread: 6.5,
                    verticalBoost: 3.2,
                    speedMin: 1.8,
                    speedMax: 6.5,
                    sizeMin: 2.6,
                    sizeMax: 6,
                    lifeMin: 0.35,
                    lifeMax: 0.8,
                });
            }
        }

        const totalShockwaves = bursts.shockwaves + bursts.constellationFractures;
        for (let i = 0; i < totalShockwaves; i += 1) {
            this.spawnShockwave(nexusWorld, bursts.constellationFractures > 0 && i === totalShockwaves - 1);
        }
    }

    spawnShockwave(origin, fracture = false) {
        const slot = this.shockwaves.find((entry) => entry.mesh.userData.active !== true);
        if (!slot) return;

        const scale = fracture ? 1.45 : 1;
        slot.mesh.visible = true;
        slot.mesh.position.copy(origin);
        slot.mesh.userData.active = true;
        slot.mesh.userData.progress = 0;
        slot.mesh.userData.speed = fracture ? 0.82 : 1.06;
        slot.mesh.userData.baseScale = fracture ? 1.3 : 1;
        slot.mesh.scale.setScalar(fracture ? 1.05 : 0.82);

        if (slot.uniforms?.color) {
            copyUniformValue(slot.uniforms.color, fracture ? this.palette.gold : this.palette.cyan);
        }
        if (slot.uniforms?.uColorA) {
            copyUniformValue(slot.uniforms.uColorA, fracture ? this.palette.gold : this.palette.cyan);
        }
        if (slot.uniforms?.uColorB) {
            copyUniformValue(slot.uniforms.uColorB, fracture ? this.palette.magenta : this.palette.pink);
        }
        slot.mesh.userData.baseScale = scale;
    }

    updateShockwaves(delta) {
        this.shockwaves.forEach(({ mesh }) => {
            if (!mesh.userData.active) return;
            mesh.userData.progress += delta * mesh.userData.speed;
            const progress = mesh.userData.progress;
            const scale = mesh.userData.baseScale * (1 + progress * 13.5);
            mesh.scale.set(scale, scale, scale);
            if (progress >= 1) {
                mesh.userData.active = false;
                mesh.visible = false;
                mesh.userData.progress = 1;
            }
        });
    }

    renderFrame() {
        const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

        if (this.postProcessing?.isEnabled?.()) {
            this.postProcessing.render();
            this.lastPostCostMs = this.postProcessing.getLastRenderCostMs?.() ?? 0;
            this.lastRenderPath = this.isWebGPU ? 'webgpu-post' : 'webgl-post';
        } else {
            this.renderer.render(this.scene, this.camera);
            this.lastPostCostMs = 0;
            this.lastRenderPath = this.isWebGPU ? 'webgpu-direct' : 'webgl-direct';
        }

        const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.lastFrameCostMs = Math.max(0, end - start);
    }

    render() {
        try {
            this.renderFrame();
        } catch (error) {
            const usingPost = this.postProcessing?.isEnabled?.() === true;
            if (usingPost) {
                console.warn('[AstralWeave] Post render failed, disabling post path:', error);
                this.postProcessing?.dispose?.();
                this.postProcessing = null;
                this.flags.usePost = false;
                this.configureRendererColorPipeline();
                try {
                    this.renderFrame();
                    return;
                } catch (directError) {
                    console.error('[AstralWeave] Direct render path failed after post fallback:', directError);
                }
            }

            if (this.isWebGPU) {
                this.requestWebGLFallback('webgpu-render-failure', error);
            } else {
                console.error('[AstralWeave] Render failed:', error);
            }
        }
    }

    getNexusWorldPosition(target = new THREE.Vector3()) {
        target.copy(this.nexusLocalPosition);
        if (this.rootGroup) target.add(this.rootGroup.position);
        return target;
    }

    getDustWorldPosition(target = new THREE.Vector3()) {
        target.set(0, 1.2, 3.5);
        if (this.rootGroup) target.add(this.rootGroup.position);
        return target;
    }

    setupEventListeners() {
        this.clearEventSubscriptions();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.fxController.onLineClear(data?.lineCount || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.fxController.onCombo(data?.comboCount || 1);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.fxController.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    clearEventSubscriptions() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
    }

    setupResizeListener() {
        this.removeResizeListener();
        this.resizeHandler = () => this.onResize();
        window.addEventListener('resize', this.resizeHandler);
    }

    removeResizeListener() {
        if (!this.resizeHandler) return;
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const changed = event?.detail || {};
            if (
                !Object.prototype.hasOwnProperty.call(changed, 'effectQuality')
                && !Object.prototype.hasOwnProperty.call(changed, 'graphicsQuality')
            ) {
                return;
            }
            const runtimeQuality = this.getCurrentQualityLevel();
            if (runtimeQuality === this.activeQualityLevel) return;
            this.requestRuntimeQualityRebuild('settingsChanged');
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (!this.qualityChangeHandler) return;
        window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        this.qualityChangeHandler = null;
    }

    requestRuntimeQualityRebuild(reason = 'settingsChanged') {
        if (!this.isActive || this.qualityRebuildPending) return;
        this.qualityRebuildPending = true;
        console.log(`[AstralWeave] Rebuilding scene after quality update (${reason})`);
        setTimeout(async () => {
            this.qualityRebuildPending = false;
            if (!this.isActive) return;
            await this.createScene();
        }, 0);
    }

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(this.isWebGPU ? WEBGPU_RENDER_SCALE : WEBGL_RENDER_SCALE));
        this.renderer.setSize(width, height);
        if (this.postProcessing?.setSize) this.postProcessing.setSize(width, height);
    }

    handleDeviceLost(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;
        this.deviceLossRecoveryInProgress = true;
        console.warn('[AstralWeave] Device/context lost, recovering:', info);

        setTimeout(async () => {
            this.deviceLossRecoveryInProgress = false;
            if (!this.isActive) return;
            if (this.isWebGPU) {
                await this.requestWebGLFallback('device-lost', info);
                return;
            }
            await this.createScene();
        }, 0);
    }

    async requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.renderFallbackInProgress) return;
        this.renderFallbackInProgress = true;
        console.warn('[AstralWeave] Switching to WebGL fallback:', reason, error || '');
        this.flags.forceWebGL = true;
        try {
            if (this.isActive) {
                await this.createScene();
            }
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    trackBaselineFrame(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
        const frameMs = deltaSeconds * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > 3600) this.baselineFrames.shift();

        this.baselineRenderStats.push({
            calls: this.renderer?.info?.render?.calls ?? 0,
            triangles: this.renderer?.info?.render?.triangles ?? 0,
            points: this.renderer?.info?.render?.points ?? 0,
            textures: this.renderer?.info?.memory?.textures ?? 0,
            geometries: this.renderer?.info?.memory?.geometries ?? 0,
        });
        if (this.baselineRenderStats.length > 3600) this.baselineRenderStats.shift();
    }

    resetBaselineSamples() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.lastPostCostMs = 0;
        this.lastFrameCostMs = 0;
    }

    estimateGpuMemoryMb(memoryInfo = this.renderer?.info?.memory) {
        if (!memoryInfo) return null;
        const textures = memoryInfo.textures ?? 0;
        const geometries = memoryInfo.geometries ?? 0;
        return Number((textures * 1.5 + geometries * 0.25).toFixed(1));
    }

    getRuntimeFeatureSnapshot() {
        const particleCounts = this.getActiveParticleCounts();
        return {
            usePost: this.flags.usePost === true,
            useMRT: this.flags.useMRT === true,
            useCompute: this.flags.useCompute === true,
            ribbons: this.qualityPreset.ribbons,
            stars: this.qualityPreset.starCount,
            flowParticles: this.liveParticleCounts.flow || particleCounts.flow,
            dustParticles: this.liveParticleCounts.dust || particleCounts.dust,
            burstParticles: this.liveParticleCounts.burst || particleCounts.burst,
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
        const renderSamples = Math.max(1, this.baselineRenderStats.length);
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
        const budget = this.performanceBudget || QUALITY_BUDGETS.High;

        return {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: this.activeQualityLevel,
            frameCount,
            avgFrameMs,
            avgFps: avgFrameMs > 0 ? 1000 / avgFrameMs : 0,
            p50FrameMs: percentile(0.5),
            p95FrameMs: percentile(0.95),
            p99FrameMs: percentile(0.99),
            avgDrawCalls: totals.calls / renderSamples,
            avgTriangles: totals.triangles / renderSamples,
            avgPoints: totals.points / renderSamples,
            peakDrawCalls: peaks.calls,
            peakTriangles: peaks.triangles,
            peakPoints: peaks.points,
            textures: peaks.textures,
            geometries: peaks.geometries,
            gpuMemoryEstimateMb: this.estimateGpuMemoryMb(),
            capabilities: { ...this.capabilities },
            runtimeFeatures: this.getRuntimeFeatureSnapshot(),
            budget: { ...budget },
            lastRenderPath: this.lastRenderPath,
            lastFrameCostMs: this.lastFrameCostMs,
            lastPostCostMs: this.lastPostCostMs,
            capturedAt: new Date().toISOString(),
        };
    }

    downloadBaselineReport(label = 'astral-weave-baseline') {
        const report = this.getBaselineReport();
        if (!report) return null;
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

    captureBaseline(label = 'astral-weave') {
        const canvas = this.renderer?.domElement;
        if (!canvas) return null;
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
        }

        return filename;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.astralWeaveBaseline = {
            report: () => this.getBaselineReport(),
            downloadReport: (label) => this.downloadBaselineReport(label),
            capture: (label) => this.captureBaseline(label),
            reset: () => this.resetBaselineSamples(),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            getPresetOrder: () => this.getBaselinePresetOrder(),
            stop: () => this.clearBaselinePlaybackTimers(),
        };
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.astralWeaveBaseline) {
            delete window.astralWeaveBaseline;
        }
    }

    clearBaselinePlaybackTimers() {
        this.baselineTimeouts.forEach((timer) => clearTimeout(timer));
        this.baselineTimeouts.clear();
        this.baselineSequenceStats = { sequence: null, loops: 0, startedAt: 0 };
    }

    playBaselineSequence(sequence = 'default', options = {}) {
        this.clearBaselinePlaybackTimers();
        const loops = Number.isFinite(options.loops) && options.loops > 0 ? Math.floor(options.loops) : 1;
        const presetSequence = Array.isArray(options.presetSequence) && options.presetSequence.length
            ? options.presetSequence.map((tier) => normalizeQuality(tier)).filter((tier) => QUALITY_PRESETS[tier])
            : ['Medium', 'High', 'Ultra'];
        if (!presetSequence.length) return;

        this.baselineSequenceStats = {
            sequence,
            loops,
            startedAt: Date.now(),
        };

        let delay = 0;
        for (let loop = 0; loop < loops; loop += 1) {
            for (let index = 0; index < presetSequence.length; index += 1) {
                const preset = presetSequence[index];
                const currentDelay = delay;
                const rebuildTimer = setTimeout(() => {
                    this.baselineQualityOverride = preset;
                    this.requestRuntimeQualityRebuild(`baseline-${sequence}-${preset}`);
                }, currentDelay);
                this.baselineTimeouts.add(rebuildTimer);

                const eventTimer = setTimeout(() => {
                    this.fxController.onPieceLock();
                    this.fxController.onLineClear(index % 3 === 0 ? 4 : 2);
                    this.fxController.onCombo(2 + index);
                }, currentDelay + 1300);
                this.baselineTimeouts.add(eventTimer);

                delay += 4200;
            }
        }

        const clearTimer = setTimeout(() => {
            this.baselineQualityOverride = null;
            this.clearBaselinePlaybackTimers();
        }, delay + 1000);
        this.baselineTimeouts.add(clearTimer);
    }

    cleanupRuntime() {
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.teardownQualityListener();
        this.clearBaselinePlaybackTimers();

        if (this.renderer?.setAnimationLoop) {
            this.renderer.setAnimationLoop(null);
        }
        this.renderLoop = null;
        this.clock.stop();

        if (this.postProcessing?.dispose) {
            this.postProcessing.dispose();
        }
        this.postProcessing = null;
        this.postProfile = null;

        this.flowCompute?.dispose?.();
        this.dustCompute?.dispose?.();
        this.burstCompute?.dispose?.();
        this.flowCompute = null;
        this.dustCompute = null;
        this.burstCompute = null;

        if (this.renderer?.domElement && this.webglContextLostHandler) {
            this.renderer.domElement.removeEventListener('webglcontextlost', this.webglContextLostHandler, false);
        }
        this.webglContextLostHandler = null;

        if (this.scene) {
            const geometries = new Set();
            const materials = new Set();
            this.scene.traverse((object) => {
                if (object.geometry) geometries.add(object.geometry);
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((mat) => materials.add(mat));
                    } else {
                        materials.add(object.material);
                    }
                }
            });
            geometries.forEach((geometry) => geometry.dispose?.());
            materials.forEach((material) => material.dispose?.());
        }

        if (this.renderer) {
            const { domElement } = this.renderer;
            this.renderer.dispose?.();
            if (domElement?.parentNode) {
                domElement.parentNode.removeChild(domElement);
            }
        }

        this.disposeTextures();

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.postFactories = null;
        this.materialFactories = null;
        this.computeFactories = null;
        this.rootGroup = null;
        this.nexusGroup = null;
        this.centerVeil = null;
        this.starfield = null;
        this.lightShafts = [];
        this.lightShaftNodeData = [];
        this.constellations = null;
        this.constellationNodeData = null;
        this.flowParticles = null;
        this.dustParticles = null;
        this.burstParticles = null;
        this.nexusNodeData = [];
        this.ribbonMeshes = [];
        this.ribbonNodeData = [];
        this.nebulaLayers = [];
        this.nebulaNodeData = [];
        this.starfieldNodeData = null;
        this.flowNodeData = null;
        this.dustNodeData = null;
        this.burstNodeData = null;
        this.shockwaves = [];
        this.lastRenderPath = 'disposed';
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
    }

    disposeTextures() {
        Object.values(this.textures).forEach((texture) => texture?.dispose?.());
        this.textures = {};
    }

    stop() {
        this.cleanupRuntime();
        this.removeBaselineHelpers();
        this.restorePointUvWarningFilter();
        super.stop();
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
