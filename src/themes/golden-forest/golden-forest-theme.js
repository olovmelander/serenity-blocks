/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌲 GOLDEN FOREST THEME - Three.js 3D Implementation 🌲
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A mystical Nordic forest with layered triangular spruce trees, fireflies,
 * god rays, forest spirits, aurora borealis, stars, and atmospheric mist.
 * Inspired by Golden forest landscapes with deep blue-green atmosphere.
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { reflector } from 'three/tsl';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { GOLDEN_FOREST_TETROMINOS } from './golden-forest-tetrominos.js';
import { GoldenForestWater } from './GoldenForestWater.js';
import { GoldenForestBirds } from './golden-forest-birds.js';
import { GoldenForestPost } from './golden-forest-post.js';

// PBR textures removed - using simple Firewatch-style ground
import {
    groundVertexShader,
    groundFragmentShader,
    mistVertexShader,
    mistFragmentShader,
    godRayVertexShader,
    godRayFragmentShader,
    fireflyVertexShader,
    fireflyFragmentShader,
    starVertexShader,
    starFragmentShader,
    spiritVertexShader,
    spiritFragmentShader,
    auroraVertexShader,
    auroraFragmentShader,
    spiritWindVertexShader,
    spiritWindFragmentShader,
    leafVertexShader,
    leafFragmentShader,
    instancedFoliageVertexShader,
    instancedFoliageFragmentShader,
    instancedTrunkVertexShader,
    instancedTrunkFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    skyDomeVertexShader,
    skyDomeFragmentShader,
    cloudCardVertexShader,
    cloudCardFragmentShader,
    dustVertexShader,
    dustFragmentShader,
    mountainVertexShader,
    mountainFragmentShader,
    hazeVertexShader,
    hazeFragmentShader,
    branchVertexShader,
    branchFragmentShader,
    lensFlareVertexShader,
    lensFlareFragmentShader,
} from './golden-forest-shaders.js';
import {
    createSkyNodeMaterial,
    createSunNodeMaterial,
    createGodRayNodeMaterial,
    createCloudNodeMaterial,
    createHazeNodeMaterial,
    createInstancedFoliageNodeMaterial,
    createInstancedTrunkNodeMaterial,
    createGrassNodeMaterial,
    createSilhouetteGrassNodeMaterial,
    createShoreReedNodeMaterial,
    createFramingTreeFoliageNodeMaterial,
    createFramingTreeTrunkNodeMaterial,
    createMountainLayerNodeMaterial,
    createMountainPeakNodeMaterial,
    createGroundNodeMaterial,
    createFireflyNodeMaterial,
    createDustMoteNodeMaterial,
    createSpiritNodeMaterial,
    createLensFlareNodeMaterial,
    createSpiritWindNodeMaterial,
    createAuroraNodeMaterial,
    createGoldenLakeNodeMaterial,
    createMistNodeMaterial,
    createShoreFoamNodeMaterial,
} from './golden-forest-materials.js';

// Objects tagged with this layer are what the WebGPU lake mirrors (sky, trees,
// mountains, sun). The lake surface + reflector plane are deliberately excluded.
const GOLDEN_FOREST_REFLECTION_LAYER = 2;

// ═══════════════════════════════════════════════════════════════════════════
// THEME CONSTANTS - Nordic forest color palette
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Sky gradient - TRUE Firewatch style (deep red-orange, NO purple)
    skyTop: new THREE.Color(0x8B2010), // Deep burnt red-orange at top
    skyMid: new THREE.Color(0xDD5522), // Rich orange
    skyHorizon: new THREE.Color(0xFFAA44), // Bright golden-orange at horizon

    // Tree layers (front to back) - Firewatch layered depth
    // Front trees are nearly black silhouettes, back trees warmer/hazier
    treeLayers: [
        new THREE.Color(0x180604), // Front - nearly black with warm hint
        new THREE.Color(0x2A1008), // Mid-front - dark brown
        new THREE.Color(0x4A2015), // Mid - warm brown
        new THREE.Color(0x7A4028), // Mid-back - brown-orange
        new THREE.Color(0xAA6040), // Back - warm orange
        new THREE.Color(0xCC8055), // Far back - light orange (for horizon layers)
    ],

    // Trunk colors matching tree layers
    trunkLayers: [
        new THREE.Color(0x100402), // Darkened to match new front trees
        new THREE.Color(0x1A0804),
        new THREE.Color(0x2A1008),
        new THREE.Color(0x4A2015),
        new THREE.Color(0x6A3520),
        new THREE.Color(0x8A5035),
    ],

    // Ground floor colors - Firewatch warm aesthetic
    groundBase: new THREE.Color(0x24120A), // Deepest Charcoal Brown
    groundMoss: new THREE.Color(0x8B5A2B), // Muted Warm Brown (was bright gold)
    groundDirt: new THREE.Color(0x150805), // Almost Black

    // Effects - warm golden tones
    mist: new THREE.Color(0xFFAA55), // Rich golden mist
    godRay: new THREE.Color(0xFFBB66), // Warm golden god rays
    firefly: new THREE.Color(0xFFAA44), // Amber-gold fireflies

    // Spirit colors - warm ethereal
    spiritBase: new THREE.Color(0xFFAA66), // Warm amber
    spiritGlow: new THREE.Color(0xFFDD88), // Golden glow

    // Aurora colors - repurposed for warm wisps (optional use)
    aurora1: new THREE.Color(0xFF9966), // Warm orange
    aurora2: new THREE.Color(0xFFBB44), // Golden
    aurora3: new THREE.Color(0xFF6644), // Deep orange

    // Spirit wind - warm tones
    windColor: new THREE.Color(0xFFBB77),

    // Fog - warm atmospheric haze
    fog: new THREE.Color(0x3A2510),

    // Cloud palette - warm, low-contrast Firewatch tones
    cloud: {
        base: new THREE.Color(0xFFC89E),
        highlight: new THREE.Color(0xFFE2C4),
        fog: new THREE.Color(0xFFB274),
    },

    // Sun colors (NEW)
    sun: {
        core: new THREE.Color(0xFFFFEE), // Bright white-yellow core
        corona: new THREE.Color(0xFFAA22), // Deep golden corona
        edge: new THREE.Color(0xFF6600), // Orange edge
        halo: new THREE.Color(0xFF4400), // Outer red-orange halo
    },

    // Mountain palettes for layered silhouettes
    mountains: {
        fog: new THREE.Color(0xFF9944),
        layers: [
            {
                shadow: new THREE.Color(0x3B110A),
                mid: new THREE.Color(0x8C4025),
                highlight: new THREE.Color(0xF28A45),
                rim: new THREE.Color(0xFFB067),
                mist: new THREE.Color(0xFFAA6A),
                mistStrength: 0.65,
            },
            {
                shadow: new THREE.Color(0x2C0C07),
                mid: new THREE.Color(0x722D1A),
                highlight: new THREE.Color(0xD56B35),
                rim: new THREE.Color(0xFF9C55),
                mist: new THREE.Color(0xF68A54),
                mistStrength: 0.55,
            },
            {
                shadow: new THREE.Color(0x1F0805),
                mid: new THREE.Color(0x592113),
                highlight: new THREE.Color(0xB45330),
                rim: new THREE.Color(0xFF8644),
                mist: new THREE.Color(0xDF7443),
                mistStrength: 0.45,
            },
        ],
    },
};

const QUALITY_PRESETS = {
    Extreme: {
        enablePostProcessing: true,
        birdCount: 1024,
        fireflyCount: 200,
        dustMoteCount: 150,
        spiritCount: 45,
        spiritLodDistance: 200,
        grassCount: 400,
        fogBandCount: 3,
        bloomStrength: 0.18,
        bloomRadius: 0.35,
        waterReflectionRes: 1024,
        enableFilmGrain: true,
    },
    Ultra: {
        enablePostProcessing: true,
        birdCount: 512,
        fireflyCount: 160,
        dustMoteCount: 120,
        spiritCount: 35,
        grassCount: 350,
        fogBandCount: 3,
        bloomStrength: 0.18,
        bloomRadius: 0.35,
        waterReflectionRes: 1024,
        enableFilmGrain: true,
    },
    High: {
        enablePostProcessing: true,
        birdCount: 256,
        fireflyCount: 120,
        dustMoteCount: 100,
        spiritCount: 25,
        grassCount: 300,
        fogBandCount: 3,
        bloomStrength: 0.16,
        bloomRadius: 0.30,
        waterReflectionRes: 768,
        enableFilmGrain: false,
    },
    Medium: {
        enablePostProcessing: true,
        birdCount: 128,
        fireflyCount: 80,
        dustMoteCount: 60,
        spiritCount: 15,
        grassCount: 200,
        fogBandCount: 4,
        bloomStrength: 0.14,
        bloomRadius: 0.28,
        waterReflectionRes: 512,
        enableFilmGrain: false,
    },
    Low: {
        enablePostProcessing: false,
        birdCount: 64,
        fireflyCount: 40,
        dustMoteCount: 30,
        spiritCount: 8,
        grassCount: 120,
        fogBandCount: 3,
        bloomStrength: 0,
        bloomRadius: 0,
        waterReflectionRes: 256,
        enableFilmGrain: false,
    },
    Minimal: {
        enablePostProcessing: false,
        birdCount: 0,
        fireflyCount: 15,
        dustMoteCount: 0,
        spiritCount: 0,
        grassCount: 0,
        fogBandCount: 2,
        bloomStrength: 0,
        bloomRadius: 0,
        waterReflectionRes: 256,
        enableFilmGrain: false,
    },
};

const MAX_FRAME_DELTA_SECONDS = 1 / 30;

function parseGoldenForestFlags() {
    const defaults = {
        forceWebGL: false,
        forceWebGPU: false,
        forceMRT: false,
        noPost: false,
        noMRT: false,
        noCompute: false,
        baseline: false,
        debug: false,
        seed: null,
        fixedDtMs: null,
        usePost: false,
        useMRT: false,
        useCompute: false,
        useBloom: false,
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

    const fixedDtMs = readNumber('goldenForestFixedDt', 'fixedDt');
    const seed = readNumber('goldenForestSeed', 'seed');

    return {
        forceWebGL: readBool('forceWebGL'),
        forceWebGPU: readBool('goldenForestForceWebGPU', 'forceWebGPU'),
        forceMRT: readBool('goldenForestForceMRT', 'forceMRT', 'goldenForestMRT'),
        noPost: readBool('goldenForestNoPost', 'noPost'),
        noMRT: readBool('goldenForestNoMRT', 'noMRT'),
        noCompute: readBool('goldenForestNoCompute', 'noCompute'),
        baseline: readBool('goldenForestBaseline', 'baseline'),
        debug: readBool('goldenForestDebug', 'debug'),
        seed: Number.isFinite(seed) ? seed : null,
        fixedDtMs: Number.isFinite(fixedDtMs) && fixedDtMs > 0 ? fixedDtMs : null,
        usePost: false,
        useMRT: false,
        useCompute: false,
        useBloom: false,
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

export default class GoldenForestTheme extends BaseTheme {
    constructor() {
        super('golden-forest');

        this.flags = parseGoldenForestFlags();
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
        this.isWebGPU = false;
        this.capabilities = {};
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 5400;
        this.distanceFogMode = 'off';
        this.postComposer = null;
        this.postPasses = null;
        this.postToneMappingState = null;
        this.qualityPreset = QUALITY_PRESETS.High;
        this.handleDisplaySettingsChange = null;
        this.waterNormalsTexture = null;
        this.waterNormalsFallbackTexture = null;
        this.waterNormalsLoadVersion = 0;
        this.forceWebGL = false; // Backward-compatible debug override

        // Event handling
        this.eventUnsubscribers = [];
        this.boundOnResize = this.onWindowResize.bind(this);
        this.boundAnimate = this.animate.bind(this);

        // Resolution handling
        this.targetResolution = null;
        this.resolutionMode = 'auto';

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;
        this.frameCount = 0;
        // Reusable temp objects for per-frame matrix updates (avoid GC pressure)
        this._tempMat = new THREE.Matrix4();
        this._rotMat = new THREE.Matrix4();
        this._scaleVec = new THREE.Vector3();
        this._postUpdateParams = {
            time: 0,
            sunScreenX: 0.5,
            sunScreenY: 0.5,
            sunGlowVisibility: 0,
        };
        this._sunDirection = new THREE.Vector3();
        this._sunNdc = new THREE.Vector3();
        this._skySunDirection = new THREE.Vector3();
        this._lensSunPosition = new THREE.Vector3();
        this._lensCameraPosition = new THREE.Vector3();
        this._lensSunToCamera = new THREE.Vector3();
        this._lensCameraForward = new THREE.Vector3();
        this._lensToSun = new THREE.Vector3();
        this._lensFlarePosition = new THREE.Vector3();
        this.birds = null;

        // Scene elements
        this.foliageInstancedMesh = null; // Single InstancedMesh for all tree foliage
        this.trunkInstancedMesh = null; // Single InstancedMesh for all tree trunks
        this.foliageNodeUniforms = null;
        this.trunkNodeUniforms = null;
        this.mountainLayerNodeUniforms = [];
        this.silhouetteMountainNodeUniforms = null;
        this.groundPlane = null;
        this.groundMaterial = null;
        this.groundNodeUniforms = null;
        this.starfield = null;
        this.skyDome = null;
        this.skyMaterial = null;
        this.skyNodeUniforms = null;
        this.clouds = [];
        this.cloudMaterials = [];
        this.cloudNodeUniforms = [];
        this.mistPlanes = [];
        this.mistNodeUniforms = [];
        this.godRays = [];
        this.godRayMaterial = null;
        this.godRayNodeUniforms = null;
        this.fireflySystem = null;
        this.fireflyNodes = [];
        this.fireflyInstancedMesh = null;
        this.fireflyInstanceData = null;
        this.fireflyNodeUniforms = null;
        this.fireflyBoostUniform = null;
        this.dustMoteNodes = [];
        this.dustInstancedMesh = null;
        this.dustInstanceData = null;
        this.dustNodeUniforms = null;
        this.spiritNodeUniforms = [];
        this.spiritWindNodeUniforms = [];
        this.lensFlareNodeUniforms = [];
        this.spirits = [];
        this.auroraPlanes = [];
        this.spiritWinds = [];
        this.fallingLeaves = null;

        // New features - grass and mushrooms
        this.grassMesh = null;
        this.grassMaterial = null;
        this.grassTexture = null;
        this.grassNodeUniforms = null;
        this.silhouetteGrassMesh = null;
        this.silhouetteGrassTexture = null;
        this.silhouetteGrassNodeUniforms = null;
        this.shoreReeds = [];
        this.shoreReedInstances = [];
        this.shoreReedNodeUniforms = [];
        this.framingTrees = [];
        this.framingTreeFoliageNodeUniforms = [];
        this.framingTreeTrunkNodeUniforms = null;
        this.framingTreeTrunkNodeMaterial = null;
        this.mushrooms = [];
        this.mushroomLights = [];
        this.mushroomPulse = 0;

        // Sun and atmospheric effects
        this.sun = null;
        this.sunNodeUniforms = null;
        this.sunGlowLayers = [];
        this.sunPosition = new THREE.Vector3(0, 30, -140); // Y=35, Z=-140
        this.sunBaseY = 30; // Update base Y for animation
        this.dustMotes = null;
        this.lensFlares = []; // Lens flare elements

        // Mountains, haze, and foreground
        this.mountains = [];
        this.hazeLayers = [];
        this.hazeNodeUniforms = [];
        this.distanceFogBands = [];
        this.distanceFogBandUniforms = [];
        this.shoreFoamMesh = null;
        this.shoreFoamNodeUniforms = null;
        this.foregroundBranches = [];
        this.lakeMesh = null;
        this.lakeMaterial = null;
        this.webgpuWater = null;
        this.waterNodeUniforms = null;
        this.waterReflection = null;
        this.shoreRocks = [];
        this.rockTextureSet = null;
        this.rockMaterials = [];
        this.rockShadowCatcher = null;

        // 3D Silhouette Mountain (Firewatch-style)
        this.silhouetteMountain = null;
        this.silhouetteMountainMaterial = null;
        this.tallMountainPeak = null;
        this.farLeftMountain = null;
        this.extremeLeftMountain = null;
        this.rightHill = null;
        this.farRightMountain = null;

        // Random camera movement offsets - different every time theme starts
        this.cameraRandomOffsets = {
            posX1: this.random() * Math.PI * 2,
            posX2: this.random() * Math.PI * 2,
            posX3: this.random() * Math.PI * 2,
            posY: this.random() * Math.PI * 2,
            posZ1: this.random() * Math.PI * 2,
            posZ2: this.random() * Math.PI * 2,
            lookX1: this.random() * Math.PI * 2,
            lookX2: this.random() * Math.PI * 2,
            lookY: this.random() * Math.PI * 2,
            // Random speed multipliers for variety
            speedMult: 0.7 + this.random() * 0.6,
        };

        // Shared uniforms
        this.uniforms = {
            time: { value: 0 },
            glowIntensity: { value: 0 },
            mistIntensity: { value: 0.6 },
            auroraIntensity: { value: 0.85 }, // Increased baseline intensity for the spirit wisps
            windSpeed: { value: 0 },
        };

        // Pointer tracking for parallax
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        // Effect targets for smooth transitions
        this.targetGlowIntensity = 0;
        this.targetMistIntensity = 0.6;
        this.targetAuroraIntensity = 0;
        this.targetWindSpeed = 0;
        this.comboMultiplier = 1.0;
    }

    random() {
        return this.randomFn();
    }

    resetBaselineSampling() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
    }

    recordBaselineSample(deltaSeconds) {
        if (!this.flags.baseline) return;
        const frameMs = deltaSeconds * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }

        this.baselineRenderStats.push({
            calls: this.renderer?.info?.render?.calls ?? 0,
            triangles: this.renderer?.info?.render?.triangles ?? 0,
            textures: this.renderer?.info?.memory?.textures ?? 0,
        });
        if (this.baselineRenderStats.length > this.baselineMaxFrames) {
            this.baselineRenderStats.shift();
        }
    }

    getBaselineReport() {
        if (!this.baselineFrames.length) return null;
        const sorted = [...this.baselineFrames].sort((a, b) => a - b);
        const count = sorted.length;
        const avgMs = this.baselineFrames.reduce((sum, value) => sum + value, 0) / count;
        const p95Ms = sorted[Math.min(count - 1, Math.floor(count * 0.95))];
        const p99Ms = sorted[Math.min(count - 1, Math.floor(count * 0.99))];

        const totals = this.baselineRenderStats.reduce((acc, sample) => ({
            calls: acc.calls + sample.calls,
            triangles: acc.triangles + sample.triangles,
            textures: acc.textures + sample.textures,
        }), { calls: 0, triangles: 0, textures: 0 });
        const renderCount = Math.max(1, this.baselineRenderStats.length);

        return {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            frames: count,
            avgMs,
            avgFps: avgMs > 0 ? 1000 / avgMs : 0,
            p95Ms,
            p99Ms,
            onePercentLowFps: p99Ms > 0 ? 1000 / p99Ms : 0,
            avgCalls: totals.calls / renderCount,
            avgTriangles: totals.triangles / renderCount,
            avgTextures: totals.textures / renderCount,
            seed: this.flags.seed,
            fixedDtMs: this.flags.fixedDtMs,
        };
    }

    logBaselineReport(context = 'runtime') {
        if (!this.flags.baseline) return;
        const report = this.getBaselineReport();
        if (!report) {
            console.log('[GoldenForestBaseline] No baseline frames recorded yet.');
            return;
        }
        console.log(`[GoldenForestBaseline] ${context}`, report);
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    updateFeatureFlags() {
        const supportsPost = this.capabilities?.supportsPost === true;
        const supportsMRT = this.capabilities?.supportsMRT === true;
        const supportsCompute = this.capabilities?.supportsCompute === true;
        const postEnabledByPreset = this.qualityPreset?.enablePostProcessing !== false;

        this.flags.usePost = supportsPost && postEnabledByPreset && !this.flags.noPost;
        // Keep MRT opt-in while WebGPU migration is still stabilizing.
        this.flags.useMRT = this.flags.usePost
            && supportsMRT
            && !this.flags.noMRT
            && this.flags.forceMRT === true;
        this.flags.useCompute = supportsCompute && !this.flags.noCompute;
        this.flags.useBloom = this.flags.usePost;
    }

    probeCapabilities() {
        if (this.isWebGPU && this.renderer?.backend?.isWebGPUBackend === true) {
            const device = this.renderer.backend?.device;
            const maxColorAttachments = device?.limits?.maxColorAttachments ?? 0;
            const supportsMRT = maxColorAttachments > 1;
            const supportsPost = true;
            const supportsCompute = typeof this.renderer.compute === 'function';

            this.capabilities = {
                isWebGPU: true,
                isWebGL2: false,
                maxColorAttachments,
                supportsMRT,
                supportsCompute,
                supportsPost,
                supportsTimestampQuery: this.renderer.hasFeature?.('timestamp-query') ?? false,
                supportsFloat32Filterable: this.renderer.hasFeature?.('float32-filterable') ?? false,
            };

            this.updateFeatureFlags();
            return;
        }

        const gl = this.renderer?.getContext?.();
        const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined'
            && gl instanceof WebGL2RenderingContext;
        const maxColorAttachments = gl?.MAX_COLOR_ATTACHMENTS
            ? gl.getParameter(gl.MAX_COLOR_ATTACHMENTS)
            : 1;
        const supportsMRT = isWebGL2 && Number.isFinite(maxColorAttachments) && maxColorAttachments > 1;
        const supportsPost = this.renderer?.isWebGLRenderer === true;
        const supportsCompute = this.renderer?.isWebGLRenderer === true; // Bird flocking compute uses GPUComputationRenderer on WebGL.

        this.capabilities = {
            isWebGPU: false,
            isWebGL2,
            maxColorAttachments: Number.isFinite(maxColorAttachments) ? maxColorAttachments : 1,
            supportsMRT,
            supportsCompute,
            supportsPost,
            supportsTimestampQuery: false,
            supportsFloat32Filterable: false,
        };

        this.updateFeatureFlags();
    }

    logPhaseZeroState() {
        if (!this.flags.baseline && !this.flags.debug) return;
        const webgpuBlockers = this.getWebGPUBlockers();
        console.log('[GoldenForest][Phase0] Flags', {
            forceWebGL: this.flags.forceWebGL,
            forceWebGPU: this.flags.forceWebGPU,
            forceMRT: this.flags.forceMRT,
            noPost: this.flags.noPost,
            noMRT: this.flags.noMRT,
            noCompute: this.flags.noCompute,
            baseline: this.flags.baseline,
            seed: this.flags.seed,
            fixedDtMs: this.flags.fixedDtMs,
        });
        console.log('[GoldenForest][Phase0] Capability Matrix', {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            capabilities: this.capabilities,
            usePost: this.flags.usePost,
            useMRT: this.flags.useMRT,
            useCompute: this.flags.useCompute,
            useBloom: this.flags.useBloom,
            webgpuBlockers,
        });
    }

    getWebGPUBlockers() {
        return [];
    }

    hasWebGLOnlyDependencies() {
        return this.getWebGPUBlockers().length > 0;
    }

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;
        let webgpuRenderer = null;
        let renderer = null;
        const shouldTryWebGPU = !this.flags.forceWebGL;

        if (shouldTryWebGPU) {
            try {
                const isWindows = typeof navigator !== 'undefined'
                    && /win/i.test(navigator.userAgent || '');
                const webgpuOptions = {
                    alpha: true,
                    antialias: this.getAntialiasEnabled(),
                    preserveDrawingBuffer: this.flags.baseline === true,
                };
                if (!isWindows) {
                    webgpuOptions.powerPreference = 'high-performance';
                }
                webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                    ...webgpuOptions,
                });
                await this.initializeRendererCandidate(webgpuRenderer, {
                    label: 'Golden Forest WebGPU renderer init',
                    ownerGeneration,
                });
            } catch (error) {
                if (!ownsLifecycle()) return false;
                console.warn('[GoldenForest] WebGPU init failed, falling back to WebGL:', error);
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
                '[GoldenForest] WebGPU available, but Phase 1 compatibility guard keeps WebGL path:',
                this.getWebGPUBlockers(),
            );
            if (this.flags.forceWebGPU) {
                console.warn(
                    '[GoldenForest] ?goldenForestForceWebGPU=1 was requested, '
                    + 'but is blocked until remaining WebGPU material/compute migrations are complete.',
                );
            }
        }

        if (hasWebGPUBackend && !compatibilityGuardEnabled) {
            renderer = webgpuRenderer;
            this.isWebGPU = true;
            renderer.onDeviceLost = (info) => {
                if (!ownsLifecycle() || this.renderer !== renderer) return;
                // Terminal for this renderer: halt the theme loop so it stops
                // polling error scopes on a dead device (see ocean-theme.js).
                console.error('[GoldenForest] WebGPU device lost — halting theme rendering:', info);
                if (this.animationFrame) {
                    cancelAnimationFrame(this.animationFrame);
                    this.animationFrame = null;
                }
            };
        } else {
            if (webgpuRenderer) {
                webgpuRenderer.dispose();
                webgpuRenderer = null;
            }

            if (!ownsLifecycle()) return false;
            renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                preserveDrawingBuffer: this.flags.baseline === true,
            });
            this.isWebGPU = false;
        }

        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        // PCFShadowMap (not PCFSoft): on r185's WebGPURenderer PCFShadowFilter is
        // already soft — 5 Vogel-disk taps rotated per-pixel by interleaved
        // gradient noise, each a hardware-compared 2x2 tap, disk scaled by
        // shadow.radius * texelSize (ShadowFilterNode.js). PCFSoftShadowMap is
        // removed for WebGPURenderer in r186 (mrdoob/three.js#33987); the classic
        // WebGLRenderer fallback already coerced it to PCFShadowMap with a warning.
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.probeCapabilities();
        this.logPhaseZeroState();

        const quality = this.getCurrentQualityLevel();
        console.log(
            `[GoldenForest] Backend: ${this.isWebGPU ? 'WebGPU' : 'WebGL2'}`
            + ` | Post: ${this.flags.usePost ? 'on' : 'off'}`
            + ` | MRT: ${this.flags.useMRT ? 'on' : 'off'}`
            + ` | Compute: ${this.flags.useCompute ? 'on' : 'off'}`
            + ` | Bloom: ${this.flags.useBloom ? 'on' : 'off'}`
            + ` | Quality: ${quality}`,
        );
        return true;
    }

    getTetrominoConfig() {
        return GOLDEN_FOREST_TETROMINOS;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        console.log('[GoldenForest] Initializing Three.js scene...');
        this.flags = { ...this.flags, ...parseGoldenForestFlags() };
        if (this.forceWebGL === true) {
            this.flags.forceWebGL = true;
        }
        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
        this.resetBaselineSampling();
        this.clock = new THREE.Clock();

        const container = document.getElementById('golden-forest-theme');
        if (!container) {
            console.error('[GoldenForest] Container not found');
            return;
        }

        container.innerHTML = '';

        // ─────────────────────────────────────────────────────────────────────
        // SCENE SETUP
        // ─────────────────────────────────────────────────────────────────────

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), 0.008); // Reduced fog for sunset visibility
        this.scene.background = null;

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA
        // ─────────────────────────────────────────────────────────────────────

        this.camera = new THREE.PerspectiveCamera(
            55,
            window.innerWidth / window.innerHeight,
            0.1,
            800,
        );
        this.camera.position.set(0, 5, 160); // Even further back (z=160) to see entire shore
        this.camera.lookAt(0, 6, -20); // Look at lake and distant tree line
        this.baseFov = 55; // Store base FOV for breathing effect

        // ─────────────────────────────────────────────────────────────────────
        // RENDERER
        // ─────────────────────────────────────────────────────────────────────

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;
        if (this.isWebGPU) {
            this.uniforms.mistIntensity.value = Math.min(this.uniforms.mistIntensity.value, 0.38);
            this.targetMistIntensity = Math.min(this.targetMistIntensity, 0.42);
        }

        this.createSkyDome(); // Procedural sky base (gradient + sun halo)

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP (for drift animation)
        // ─────────────────────────────────────────────────────────────────────

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SCENE ELEMENTS (order matters for depth)
        // ─────────────────────────────────────────────────────────────────────

        // this.createStarfield();      // Disabled - sunset is too bright for stars
        this.createMountains(); // Distant mountain silhouettes (Firewatch style)
        this.createSilhouetteMountain(); // 3D heightmap mountain on left side
        this.createSun(); // Large glowing sun at horizon
        this.createAuroraLayers(); // Repurposed for massive warm spirit winds in the upper sky
        this.createGodRays(); // Light beams from sun
        this.createLensFlares(); // Camera lens flare from sun
        this.createTrees(); // Layered trees
        this.createHazeLayers(); // Atmospheric haze between tree layers
        this.createForestFloor(); // Warm gradient ground (Firewatch style)
        // this.createFarShore();       // Removed - merged into ForestFloor
        this.createLake(); // Firewatch-style lake on right side
        this.createShoreFoam(); // Animated foam ring at water's edge
        this.createWaterLogs(); // Wooden dock posts in the water
        this.createShoreRocks(); // Warm-colored silhouette boulders along shoreline
        this.createShoreReeds(); // Dried grass/reeds at water's edge
        this.createLakeFramingTrees(); // Silhouette trees framing lake edges
        if (!this.isWebGPU) {
            this.createGrass(); // Golden sunset grass
        } else if (this.flags.debug || this.flags.baseline) {
            console.log('[GoldenForest] Skipping near-shore grass on WebGPU to avoid lake occlusion artifacts.');
        }
        // this.createGlowingMushrooms(); // Disabled - cleaner Firewatch look
        this.createMistLayers(); // Atmospheric golden fog
        this.createStylizedClouds(); // Flat cloud layers near horizon
        if (!this.isWebGPU) {
            this.createSilhouetteGrass(); // Dense foreground grass framing
        } else if (this.flags.debug || this.flags.baseline) {
            console.log('[GoldenForest] Skipping silhouette foreground grass on WebGPU to prevent lake occlusion artifacts.');
        }

        await this.initBirds();

        this.createSpiritWinds(); // Flowing warm energy
        this.createDustMotes(); // Floating particles in sunlight
        this.createFireflySystem(); // Glowing amber particles
        this.createForestSpirits(); // Warm ethereal orbs
        // this.createForegroundBranches(); // Disabled - foreground branch silhouettes
        // this.createFallingLeavesSystem();  // Disabled - no falling leaves
        this.setupLighting();
        this.setupDistanceFog();
        this.setupPostProcessing();

        // Tag the finished environment so the WebGPU lake reflector mirrors it.
        this.applyReflectionLayer();

        const shouldCompileAsync = this.isWebGPU
            && this.renderer?.compileAsync
            && !this.flags.useMRT
            && !this.webgpuWater?.renderTarget;
        if (shouldCompileAsync) {
            try {
                await this.renderer.compileAsync(this.scene, this.camera);
            } catch (error) {
                console.warn('[GoldenForest] WebGPU compileAsync failed:', error);
            }
        } else if (this.isWebGPU && this.renderer?.compileAsync && this.webgpuWater?.renderTarget) {
            if (this.flags.debug || this.flags.baseline) {
                console.log('[GoldenForest] Skipping compileAsync for WebGPU reflection render-target path.');
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // EVENT LISTENERS
        // ─────────────────────────────────────────────────────────────────────

        this.setupEventListeners();
        window.addEventListener('resize', this.boundOnResize);

        // Listen for resolution changes
        this.handleDisplaySettingsChange = (e) => {
            const { width, height, resolution } = e.detail;
            const mode = resolution === 'auto' ? 'auto' : 'fixed';
            this.setInternalResolution(width, height, mode);
        };
        window.addEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);

        // ─────────────────────────────────────────────────────────────────────
        // START ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        this.createDebugOverlay();
        this.animate();

        console.log(`[GoldenForest] Scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
    }

    async initBirds() {
        if (!this.mainGroup || !this.renderer || !this.scene) return;

        if (!this.flags.useCompute) {
            console.warn('[GoldenForest] Bird compute disabled by Phase 1 kill switch (?goldenForestNoCompute=1).');
            return;
        }

        const birdCount = Math.max(0, Math.floor(this.qualityPreset?.birdCount ?? 256));
        if (birdCount <= 0) {
            if (this.flags.debug || this.flags.baseline) {
                console.log('[GoldenForest] Bird system skipped for this quality preset (birdCount=0).');
            }
            return;
        }

        this.birds = new GoldenForestBirds(this.renderer, this.scene, {
            randomFn: this.random.bind(this),
            birdCount,
        });
        try {
            this.birds.init();
        } catch (error) {
            console.warn('[GoldenForest] Bird system init failed; continuing without birds:', error);
            this.birds.dispose();
            this.birds = null;
            return;
        }
        if (this.birds.mesh) {
            this.mainGroup.add(this.birds.mesh);
            if (this.flags.debug || this.flags.baseline) {
                console.log(
                    `[GoldenForest] Birds initialized (${this.isWebGPU ? 'WebGPU' : 'WebGL'} compute): ${this.birds.BIRDS}`,
                );
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GRADIENT BACKGROUND - Dark top to lighter horizon
    // ═══════════════════════════════════════════════════════════════════════════

    createGradientBackground() {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Saturated Firewatch sunset - deep orange to golden
        const gradient = ctx.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, '#4A1005'); // Very deep burnt orange at top
        gradient.addColorStop(0.12, '#6A1808'); // Dark burnt orange
        gradient.addColorStop(0.25, '#8A2510'); // Rich dark orange
        gradient.addColorStop(0.40, '#BB4015'); // Deep orange
        gradient.addColorStop(0.55, '#DD5520'); // Bright orange
        gradient.addColorStop(0.70, '#FF7725'); // Vivid orange
        gradient.addColorStop(0.85, '#FFAA40'); // Golden orange
        gradient.addColorStop(1, '#FFCC50'); // Bright golden at horizon

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 2, 512);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROCEDURAL SKY DOME - Sunset gradient with sun disc and subtle halo
    // ═══════════════════════════════════════════════════════════════════════════

    createSkyDome() {
        if (!this.scene || !this.camera) return;

        const geometry = new THREE.SphereGeometry(600, 32, 20);
        const sunDir = new THREE.Vector3()
            .subVectors(this.sunPosition, this.camera.position)
            .normalize();

        this.skyNodeUniforms = null;
        if (this.isWebGPU) {
            const nodeSky = createSkyNodeMaterial({
                time: this.uniforms.time.value,
                topColor: COLORS.skyTop.clone(),
                upperColor: new THREE.Color(0xB7381F),
                midColor: COLORS.skyMid.clone(),
                lowerColor: new THREE.Color(0xF57834),
                horizonColor: COLORS.skyHorizon.clone(),
                sunColor: new THREE.Color(0xFFF1C8),
                haloColor: new THREE.Color(0xFFB46A),
                horizonHaloColor: new THREE.Color(0xFFD08A),
                sunDirection: sunDir.clone(),
                sunDiscRadius: 0.0125,
                sunHaloRadius: 0.2,
                sunDiscIntensity: 0.26,
                sunHaloIntensity: 0.28,
                horizonHaloIntensity: 0.2,
                horizonHaloFalloff: 2.35,
                wispScale: 3.8,
                wispIntensity: 0.08,
            });
            this.skyMaterial = nodeSky.material;
            this.skyNodeUniforms = nodeSky.uniforms;
        } else {
            this.skyMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uTopColor: { value: COLORS.skyTop },
                    uUpperColor: { value: new THREE.Color(0xB7381F) },
                    uMidColor: { value: COLORS.skyMid },
                    uLowerColor: { value: new THREE.Color(0xF57834) },
                    uHorizonColor: { value: COLORS.skyHorizon },
                    uSunColor: { value: new THREE.Color(0xFFF1C8) },
                    uHaloColor: { value: new THREE.Color(0xFFB46A) },
                    uHorizonHaloColor: { value: new THREE.Color(0xFFD08A) },
                    uSunDirection: { value: sunDir },
                    uSunDiscRadius: { value: 0.0125 },
                    uSunHaloRadius: { value: 0.2 },
                    uSunDiscIntensity: { value: 0.26 },
                    uSunHaloIntensity: { value: 0.28 },
                    uHorizonHaloIntensity: { value: 0.2 },
                    uHorizonHaloFalloff: { value: 2.35 },
                    uWispScale: { value: 3.8 },
                    uWispIntensity: { value: 0.08 },
                },
                vertexShader: skyDomeVertexShader,
                fragmentShader: skyDomeFragmentShader,
                side: THREE.BackSide,
                depthWrite: false,
            });
        }

        this.skyDome = new THREE.Mesh(geometry, this.skyMaterial);
        this.skyDome.frustumCulled = false;
        this.skyDome.renderOrder = -100;
        this.skyDome.position.copy(this.camera.position);

        this.scene.add(this.skyDome);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STARFIELD - Twinkling stars in the night sky
    // ═══════════════════════════════════════════════════════════════════════════

    createStarfield() {
        const starCount = 300;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const randoms = new Float32Array(starCount);
        const phases = new Float32Array(starCount);
        const brightness = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Spread stars across upper sky dome
            const theta = this.random() * Math.PI * 2;
            const phi = this.random() * Math.PI * 0.4; // Upper hemisphere
            const radius = 150 + this.random() * 50;

            positions[i3] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[i3 + 1] = Math.cos(phi) * radius + 20; // Shift up
            positions[i3 + 2] = Math.sin(phi) * Math.sin(theta) * radius - 80;

            randoms[i] = this.random();
            phases[i] = this.random() * Math.PI * 2;
            brightness[i] = 0.3 + this.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield); // Add to scene (not mainGroup) for fixed background
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUN - Large glowing sun for Firewatch-style sunset atmosphere
    // ═══════════════════════════════════════════════════════════════════════════

    createSun() {
        // LARGE sun sphere - Firewatch style prominent sun
        const sunGeometry = new THREE.SphereGeometry(38, 32, 32);
        let sunMaterial = null;
        this.sunNodeUniforms = null;

        if (this.isWebGPU) {
            const nodeSun = createSunNodeMaterial({
                time: this.uniforms.time.value,
                intensity: 1.25,
                coreColor: new THREE.Color(0xFFFEE7),
                coronaColor: new THREE.Color(0xFFCC5A),
                edgeColor: new THREE.Color(0xFF8C2E),
                haloColor: new THREE.Color(0xFF7A34),
                haloIntensity: 0.9,
                emissiveStrength: 1.15,
            });
            sunMaterial = nodeSun.material;
            this.sunNodeUniforms = nodeSun.uniforms;
        } else {
            sunMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uIntensity: { value: 1.25 },
                    uCoreColor: { value: new THREE.Color(0xFFFEE7) },
                    uCoronaColor: { value: new THREE.Color(0xFFCC5A) },
                    uEdgeColor: { value: new THREE.Color(0xFF8C2E) },
                    uHaloColor: { value: new THREE.Color(0xFF7A34) },
                    uHaloIntensity: { value: 0.9 },
                },
                vertexShader: sunVertexShader,
                fragmentShader: sunFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sun.position.copy(this.sunPosition);
        this.sun.userData.phase2BloomEmitter = true;
        this.scene.add(this.sun); // Add to scene, not mainGroup for fixed position

        // Multi-layer glow sprites - BIGGER for Firewatch atmospheric look
        const glowTexture = this.createSunGlowTexture();
        this.sunGlowLayers = [];

        const glowConfigs = [
            { scale: 90, opacity: 1.0, color: new THREE.Color(0xFFDD66) },
            { scale: 150, opacity: 0.7, color: new THREE.Color(0xFFAA44) },
            { scale: 220, opacity: 0.45, color: new THREE.Color(0xFF8833) },
            { scale: 320, opacity: 0.25, color: new THREE.Color(0xFF6622) },
            { scale: 450, opacity: 0.12, color: new THREE.Color(0xFF4411) },
        ];

        glowConfigs.forEach((config) => {
            const material = new THREE.SpriteMaterial({
                map: glowTexture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(config.scale, config.scale, 1);
            sprite.position.copy(this.sunPosition);
            this.scene.add(sprite);
            this.sunGlowLayers.push(sprite);
        });
    }

    createSunGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 240, 1)');
        gradient.addColorStop(0.1, 'rgba(255, 220, 150, 0.95)');
        gradient.addColorStop(0.25, 'rgba(255, 160, 80, 0.7)');
        gradient.addColorStop(0.5, 'rgba(255, 100, 40, 0.35)');
        gradient.addColorStop(0.75, 'rgba(255, 60, 20, 0.12)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        return new THREE.CanvasTexture(canvas);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LENS FLARES - Camera lens flare elements from sun
    // ═══════════════════════════════════════════════════════════════════════════

    createLensFlares() {
        if (!this.scene) return;

        console.log('[GoldenForest] Creating lens flares...');

        this.lensFlares = [];
        this.lensFlareNodeUniforms = [];

        // Lens flare configurations - subtle flares that flicker like sun peeking through trees
        // Offset is relative to sun position (0 = at sun, 1 = at camera, negative = beyond sun)
        const flareConfigs = [
            // Main flares near sun - very subtle, appearing only briefly
            {
                offset: 0.08, scale: 18, opacity: 0.12, color: new THREE.Color(0xFFDD88), type: 0,
            }, // Circle
            {
                offset: 0.12, scale: 8, opacity: 0.08, color: new THREE.Color(0xFF9955), type: 1,
            }, // Ring
            // Secondary flares - even more subtle
            {
                offset: 0.25, scale: 5, opacity: 0.06, color: new THREE.Color(0xFFAA66), type: 0,
            }, // Circle
            {
                offset: 0.35, scale: 10, opacity: 0.05, color: new THREE.Color(0xFF8844), type: 1,
            }, // Ring
            {
                offset: 0.5, scale: 4, opacity: 0.06, color: new THREE.Color(0xFFCC88), type: 2,
            }, // Hexagon
            {
                offset: 0.65, scale: 6, opacity: 0.04, color: new THREE.Color(0xFFBB77), type: 0,
            }, // Circle
            // Anamorphic horizontal streak - subtle light streaking through branches
            {
                offset: 0.03, scale: 50, opacity: 0.06, color: new THREE.Color(0xFFAA55), type: 3, scaleY: 0.05,
            }, // Streak
        ];

        flareConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(1, 1);
            let material;
            let nodeUniforms = null;
            if (this.isWebGPU) {
                const nodeFlare = createLensFlareNodeMaterial({
                    time: this.uniforms.time.value,
                    opacity: config.opacity,
                    flareColor: config.color.clone(),
                    flareType: config.type,
                });
                material = nodeFlare.material;
                nodeUniforms = nodeFlare.uniforms;
                this.lensFlareNodeUniforms.push(nodeUniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uOpacity: { value: config.opacity },
                        uFlareColor: { value: config.color },
                        uFlareType: { value: config.type },
                    },
                    vertexShader: lensFlareVertexShader,
                    fragmentShader: lensFlareFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    depthTest: false,
                    side: THREE.DoubleSide,
                });
            }

            const flare = new THREE.Mesh(geometry, material);

            // Scale - handle special case for anamorphic streak
            const scaleY = config.scaleY ? config.scale * config.scaleY : config.scale;
            flare.scale.set(config.scale, scaleY, 1);

            // Store offset and flicker phase for animation
            flare.userData.offset = config.offset;
            flare.userData.baseOpacity = config.opacity;
            flare.userData.flickerPhase = this.random() * Math.PI * 2; // Random phase for each flare
            flare.userData.flickerSpeed = 2.0 + this.random() * 3.0; // Variable flicker speed
            flare.userData.nodeUniforms = nodeUniforms;

            // Initial position (will be updated in animate)
            flare.position.copy(this.sunPosition);

            this.lensFlares.push(flare);
            this.scene.add(flare);
        });

        console.log('[GoldenForest] Lens flares created:', this.lensFlares.length);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DUST MOTES - Floating particles in sunlight beams
    // ═══════════════════════════════════════════════════════════════════════════

    createDustMotes() {
        const dustCount = this.qualityPreset?.dustMoteCount ?? 150;
        if (dustCount <= 0) return;

        if (this.isWebGPU) {
            this.dustMoteNodes = [];
            const nodeDust = createDustMoteNodeMaterial({
                time: this.uniforms.time.value,
                opacity: 0.7,
                sunDirection: this.sunPosition.clone().normalize(),
                baseColor: new THREE.Color(0xFFCA66),
                highlightColor: new THREE.Color(0xFFE8B2),
            });
            this.dustNodeUniforms = nodeDust.uniforms;

            const dustGeometry = new THREE.PlaneGeometry(1, 1);

            // ── InstancedMesh: single draw call for all dust motes ──
            const instancedMesh = new THREE.InstancedMesh(dustGeometry, nodeDust.material, dustCount);
            instancedMesh.renderOrder = 120;

            this.dustInstanceData = new Float32Array(dustCount * 4); // x, y, z, scale
            const tempMatrix = new THREE.Matrix4();

            for (let i = 0; i < dustCount; i++) {
                const px = (this.random() - 0.5) * 400;
                const py = 5 + this.random() * 25;
                const pz = 10 - this.random() * 100;
                const scale = 0.35 + this.random() * 1.1;

                const i4 = i * 4;
                this.dustInstanceData[i4] = px;
                this.dustInstanceData[i4 + 1] = py;
                this.dustInstanceData[i4 + 2] = pz;
                this.dustInstanceData[i4 + 3] = scale;

                tempMatrix.makeScale(scale, scale, 1);
                tempMatrix.setPosition(px, py, pz);
                instancedMesh.setMatrixAt(i, tempMatrix);
            }
            instancedMesh.instanceMatrix.needsUpdate = true;

            this.dustInstancedMesh = instancedMesh;
            this.dustMotes = instancedMesh;
            this.mainGroup.add(instancedMesh);
            return;
        }

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(dustCount * 3);
        const phases = new Float32Array(dustCount);
        const randoms = new Float32Array(dustCount);

        for (let i = 0; i < dustCount; i++) {
            const i3 = i * 3;
            // Spread dust wider across the scene and deeper
            positions[i3] = (this.random() - 0.5) * 400; // Width: 400 (-200 to 200)
            positions[i3 + 1] = 5 + this.random() * 25;
            positions[i3 + 2] = 10 - this.random() * 100; // Depth: +10 to -90

            phases[i] = this.random() * Math.PI * 2;
            randoms[i] = this.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 5.0 },
            },
            vertexShader: dustVertexShader,
            fragmentShader: dustFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.dustNodeUniforms = null;
        this.dustMoteNodes = [];
        this.dustMotes = new THREE.Points(geometry, material);
        this.mainGroup.add(this.dustMotes);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MOUNTAINS - Firewatch-style layered silhouettes with atmospheric perspective
    // ═══════════════════════════════════════════════════════════════════════════

    createMountains() {
        this.mountains = [];
        this.mountainLayerNodeUniforms = [];

        // Mountain layer configurations - Firewatch style prominent silhouettes
        const mountainConfigs = [
            {
                x: 0, z: -88, height: 55, fogAmount: 0.75, layerIndex: 0, width: 280, y: 22,
            }, // Far - warmest, haziest
            {
                x: 0, z: -80, height: 50, fogAmount: 0.55, layerIndex: 1, width: 280, y: 24,
            }, // Mid
            {
                x: 0, z: -73, height: 45, fogAmount: 0.35, layerIndex: 2, width: 280, y: 26,
            }, // Near - darker
        ];

        const fogColor = COLORS.mountains.fog.clone();
        const lightDirection = this.sunPosition.clone().normalize();

        mountainConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height, 1, 1);
            const palette = COLORS.mountains.layers[Math.min(config.layerIndex, COLORS.mountains.layers.length - 1)];
            let material;
            if (this.isWebGPU) {
                const nodeMountain = createMountainLayerNodeMaterial({
                    time: this.uniforms.time.value,
                    shadowColor: palette.shadow.clone(),
                    midColor: palette.mid.clone(),
                    highlightColor: palette.highlight.clone(),
                    rimColor: palette.rim.clone(),
                    mistColor: palette.mist.clone(),
                    fogColor: fogColor.clone(),
                    lightDirection: lightDirection.clone(),
                    fogAmount: config.fogAmount,
                    layer: index / (mountainConfigs.length - 1),
                    mistStrength: palette.mistStrength,
                });
                material = nodeMountain.material;
                this.mountainLayerNodeUniforms.push(nodeMountain.uniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uShadowColor: { value: palette.shadow },
                        uMidColor: { value: palette.mid },
                        uHighlightColor: { value: palette.highlight },
                        uRimColor: { value: palette.rim },
                        uMistColor: { value: palette.mist },
                        uFogColor: { value: fogColor },
                        uLightDirection: { value: lightDirection },
                        uFogAmount: { value: config.fogAmount },
                        uLayer: { value: index / (mountainConfigs.length - 1) },
                        uTime: this.uniforms.time,
                        uMistStrength: { value: palette.mistStrength },
                    },
                    vertexShader: mountainVertexShader,
                    fragmentShader: mountainFragmentShader,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                });
            }

            const mountain = new THREE.Mesh(geometry, material);
            // Position mountains higher so peaks are visible above tree line
            mountain.position.set(config.x, config.y, config.z);
            mountain.renderOrder = -24 + index;

            this.mountains.push(mountain);
            this.scene.add(mountain); // Add to scene, not mainGroup
        });
    }

    mountainNoise2D(x, y) {
        const dot = x * 12.9898 + y * 78.233;
        const noise = Math.sin(dot) * 43758.5453;
        return noise - Math.floor(noise);
    }

    mountainSmoothNoise2D(x, y) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;

        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);

        const n00 = this.mountainNoise2D(ix, iy);
        const n10 = this.mountainNoise2D(ix + 1, iy);
        const n01 = this.mountainNoise2D(ix, iy + 1);
        const n11 = this.mountainNoise2D(ix + 1, iy + 1);

        const nx0 = THREE.MathUtils.lerp(n00, n10, sx);
        const nx1 = THREE.MathUtils.lerp(n01, n11, sx);
        return THREE.MathUtils.lerp(nx0, nx1, sy);
    }

    mountainFBM2D(x, y, octaves = 4) {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i += 1) {
            value += amplitude * (this.mountainSmoothNoise2D(x * frequency, y * frequency) * 2 - 1);
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return maxValue > 0 ? value / maxValue : 0;
    }

    createMountainPeakGeometry(config) {
        const geometry = new THREE.PlaneGeometry(
            config.size,
            config.size,
            config.segments,
            config.segments,
        );
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        const heights = new Float32Array(positions.count);

        const peakRadius = config.peakRadius ?? 0.45;
        const steepness = config.steepness ?? 1.2;
        const asymmetryFrequency = config.asymmetryFrequency ?? 1.0;
        const asymmetryPhase = config.asymmetryPhase ?? 0.0;
        const asymmetryStrength = config.asymmetryStrength ?? 0.12;
        const ridgeFrequency = config.ridgeFrequency ?? 4.0;
        const ridgePhase = config.ridgePhase ?? 0.0;
        const ridgeStrength = config.ridgeStrength ?? 0.08;
        const ridgeFalloff = config.ridgeFalloff ?? 1.0;
        const noiseScale = config.noiseScale ?? 0.01;
        const noiseSeed = config.noiseSeed ?? 0.0;
        const noiseStrength = config.noiseStrength ?? 0.05;
        const noiseOctaves = config.noiseOctaves ?? 3;

        for (let i = 0; i < positions.count; i += 1) {
            vertex.fromBufferAttribute(positions, i);
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDistance = config.size * peakRadius;
            const normalizedDistance = distance / maxDistance;

            let height = 0;

            if (normalizedDistance < 1.0) {
                const peakProfile = (1.0 - normalizedDistance) ** steepness;
                height = peakProfile * config.peakHeight;

                const angle = Math.atan2(dz, dx);
                height *= 1.0 + Math.sin(angle * asymmetryFrequency + asymmetryPhase) * asymmetryStrength;

                const ridges = Math.sin(angle * ridgeFrequency + ridgePhase)
                    * ridgeStrength
                    * (1.0 - normalizedDistance * ridgeFalloff);
                height += ridges * config.peakHeight;

                const rockNoise = this.mountainFBM2D(
                    vertex.x * noiseScale + noiseSeed,
                    vertex.z * noiseScale + noiseSeed,
                    noiseOctaves,
                );
                height += rockNoise
                    * config.peakHeight
                    * noiseStrength
                    * (1.0 - normalizedDistance * 0.5);
            }

            const finalHeight = Math.max(0, height);
            positions.setY(i, finalHeight);
            heights[i] = finalHeight / config.peakHeight;
        }

        geometry.computeVertexNormals();
        geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
        return geometry;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 3D SILHOUETTE MOUNTAIN - Firewatch-style heightmap mountain on left side
    // ═══════════════════════════════════════════════════════════════════════════

    createSilhouetteMountain() {
        const peakConfigs = [
            {
                name: 'mainPeak',
                size: 300,
                segments: 64,
                peakHeight: 100,
                position: new THREE.Vector3(-90, -15, -160),
                renderOrder: -5,
                steepness: 1.2,
                peakRadius: 0.45,
                asymmetryFrequency: 1.0,
                asymmetryPhase: 0.5,
                asymmetryStrength: 0.15,
                ridgeFrequency: 3.0,
                ridgeStrength: 0.08,
                noiseScale: 0.01,
                noiseSeed: 0,
                noiseStrength: 0.08,
                noiseOctaves: 5,
            },
            {
                name: 'tallPeak',
                size: 380,
                segments: 64,
                peakHeight: 170,
                position: new THREE.Vector3(-180, -15, -185),
                renderOrder: -6,
                steepness: 1.4,
                peakRadius: 0.42,
                asymmetryFrequency: 1.0,
                asymmetryPhase: 0.8,
                asymmetryStrength: 0.12,
                ridgeFrequency: 4.0,
                ridgeStrength: 0.1,
                noiseScale: 0.012,
                noiseSeed: 100,
                noiseStrength: 0.05,
                noiseOctaves: 3,
            },
            {
                name: 'farLeftPeak',
                size: 350,
                segments: 64,
                peakHeight: 140,
                position: new THREE.Vector3(-270, -15, -200),
                renderOrder: -8,
                steepness: 1.3,
                peakRadius: 0.45,
                asymmetryFrequency: 1.0,
                asymmetryPhase: 2.0,
                asymmetryStrength: 0.1,
                ridgeFrequency: 5.0,
                ridgeStrength: 0.08,
                noiseScale: 0.01,
                noiseSeed: 500,
                noiseStrength: 0.05,
                noiseOctaves: 3,
            },
            {
                name: 'extremeLeftRidge',
                size: 360,
                segments: 64,
                peakHeight: 165,
                position: new THREE.Vector3(-320, -12, -185),
                renderOrder: -7,
                steepness: 1.28,
                peakRadius: 0.43,
                asymmetryFrequency: 1.0,
                asymmetryPhase: 1.15,
                asymmetryStrength: 0.15,
                ridgeFrequency: 5.2,
                ridgeStrength: 0.085,
                ridgeFalloff: 0.85,
                noiseScale: 0.01,
                noiseSeed: 640,
                noiseStrength: 0.06,
                noiseOctaves: 3,
            },
            {
                name: 'rightHill',
                size: 320,
                segments: 64,
                peakHeight: 115,
                position: new THREE.Vector3(120, -15, -160),
                renderOrder: -15,
                steepness: 1.1,
                peakRadius: 0.45,
                asymmetryFrequency: 2.0,
                asymmetryPhase: 1.0,
                asymmetryStrength: 0.1,
                ridgeFrequency: 3.0,
                ridgeStrength: 0.06,
                noiseScale: 0.008,
                noiseSeed: 200,
                noiseStrength: 0.04,
                noiseOctaves: 3,
            },
            {
                name: 'farRightPeak',
                size: 300,
                segments: 64,
                peakHeight: 135,
                position: new THREE.Vector3(215, -12, -185),
                renderOrder: -16,
                steepness: 1.35,
                peakRadius: 0.44,
                asymmetryFrequency: 1.5,
                asymmetryPhase: 2.4,
                asymmetryStrength: 0.12,
                ridgeFrequency: 4.0,
                ridgePhase: 0.8,
                ridgeStrength: 0.08,
                noiseScale: 0.011,
                noiseSeed: 320,
                noiseStrength: 0.045,
                noiseOctaves: 3,
            },
        ];

        if (this.isWebGPU) {
            const nodePeakMaterial = createMountainPeakNodeMaterial({
                time: this.uniforms.time.value,
                shadowColor: new THREE.Color(0x2A1518),
                midColor: new THREE.Color(0x6B3525),
                highlightColor: new THREE.Color(0xCC6633),
                rimColor: new THREE.Color(0xFF8844),
                fogColor: new THREE.Color(0xDD7744),
                sunDirection: this.sunPosition.clone().normalize(),
            });
            this.silhouetteMountainMaterial = nodePeakMaterial.material;
            this.silhouetteMountainNodeUniforms = nodePeakMaterial.uniforms;
        } else {
            this.silhouetteMountainMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uShadowColor: { value: new THREE.Color(0x2A1518) }, // Deep shadow (facing camera)
                    uMidColor: { value: new THREE.Color(0x6B3525) }, // Mid-tone warm brown
                    uHighlightColor: { value: new THREE.Color(0xCC6633) }, // Warm orange highlight
                    uRimColor: { value: new THREE.Color(0xFF8844) }, // Bright orange rim
                    uFogColor: { value: new THREE.Color(0xDD7744) }, // Warm atmospheric fog
                },
                vertexShader: `
                    varying vec2 vUv;
                    varying float vHeight;
                    varying vec3 vWorldPosition;
                    varying vec3 vNormal;
                    varying vec3 vViewDir;
                    attribute float aHeight;

                    void main() {
                        vUv = uv;
                        vHeight = aHeight;
                        vNormal = normalize(normalMatrix * normal);
                        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPosition.xyz;
                        vViewDir = normalize(cameraPosition - worldPosition.xyz);
                        gl_Position = projectionMatrix * viewMatrix * worldPosition;
                    }
                `,
                fragmentShader: `
                    uniform vec3 uShadowColor;
                    uniform vec3 uMidColor;
                    uniform vec3 uHighlightColor;
                    uniform vec3 uRimColor;
                    uniform vec3 uFogColor;
                    varying float vHeight;
                    varying vec3 vWorldPosition;
                    varying vec3 vNormal;
                    varying vec3 vViewDir;

                    void main() {
                        vec3 sunDir = normalize(vec3(0.0, 0.3, -1.0));
                        float facingCamera = max(0.0, dot(vNormal, vViewDir));
                        float facingSun = max(0.0, dot(vNormal, -sunDir));
                        float facingUp = max(0.0, vNormal.y);

                        vec3 mountainColor = uShadowColor;
                        float midBlend = vHeight * 0.6 + facingUp * 0.3;
                        mountainColor = mix(mountainColor, uMidColor, midBlend);
                        float highlightBlend = facingSun * 0.5 + facingUp * vHeight * 0.4;
                        mountainColor = mix(mountainColor, uHighlightColor, highlightBlend * 0.6);

                        float rim = pow(1.0 - facingCamera, 2.0);
                        float rimStrength = rim * (0.5 + facingUp * 0.3 + facingSun * 0.4);
                        mountainColor = mix(mountainColor, uRimColor, rimStrength * 0.5 * vHeight);

                        float dist = length(vWorldPosition - cameraPosition);
                        float fogFactor = smoothstep(100.0, 280.0, dist);
                        mountainColor = mix(mountainColor, uFogColor, fogFactor * 0.5);

                        float baseMist = smoothstep(0.25, 0.0, vHeight);
                        mountainColor = mix(mountainColor, uFogColor * 0.7, baseMist * 0.6);

                        float peakGlow = smoothstep(0.7, 1.0, vHeight);
                        mountainColor = mix(mountainColor, uRimColor * 0.9, peakGlow * 0.25);

                        gl_FragColor = vec4(mountainColor, 1.0);
                    }
                `,
                side: THREE.DoubleSide,
            });
            this.silhouetteMountainNodeUniforms = null;
        }

        peakConfigs.forEach((peakConfig) => {
            const geometry = this.createMountainPeakGeometry(peakConfig);
            const mountainMesh = new THREE.Mesh(geometry, this.silhouetteMountainMaterial);
            mountainMesh.position.copy(peakConfig.position);
            mountainMesh.renderOrder = peakConfig.renderOrder;
            this.scene.add(mountainMesh);

            switch (peakConfig.name) {
            case 'mainPeak':
                this.silhouetteMountain = mountainMesh;
                break;
            case 'tallPeak':
                this.tallMountainPeak = mountainMesh;
                break;
            case 'farLeftPeak':
                this.farLeftMountain = mountainMesh;
                break;
            case 'extremeLeftRidge':
                this.extremeLeftMountain = mountainMesh;
                break;
            case 'rightHill':
                this.rightHill = mountainMesh;
                break;
            case 'farRightPeak':
                this.farRightMountain = mountainMesh;
                break;
            default:
                break;
            }
        });

        console.log('[GoldenForest] 3D silhouette mountains created (4 left + 2 right, refactored configs)');
    }

    /* REMOVED DUPLICATE CODE

        const smoothNoise = (x, y) => {
            const ix = Math.floor(x);
            const iy = Math.floor(y);
            const fx = x - ix;
            const fy = y - iy;

            const sx = fx * fx * (3 - 2 * fx);
            const sy = fy * fy * (3 - 2 * fy);

            const n00 = noise2D(ix, iy);
            const n10 = noise2D(ix + 1, iy);
            const n01 = noise2D(ix, iy + 1);
            const n11 = noise2D(ix + 1, iy + 1);

            const nx0 = n00 + sx * (n10 - n00);
            const nx1 = n01 + sx * (n11 - n01);

            return nx0 + sy * (nx1 - nx0);
        };

        const fbm = (x, y, octaves = 5) => {
            let value = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxValue = 0;

            for (let i = 0; i < octaves; i++) {
                value += amplitude * (smoothNoise(x * frequency, y * frequency) * 2 - 1);
                maxValue += amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }

            return value / maxValue;
        };

        // --- APPLY HEIGHTMAP DISPLACEMENT - CLASSIC MOUNTAIN PEAK ---
        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        const heights = [];

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);

            // Distance from center
            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = config.size * 0.45;
            const normDist = distance / maxDist;

            // === CLASSIC TRIANGULAR PEAK ===
            let height = 0;

            if (normDist < 1.0) {
                // Simple conical peak with smooth falloff
                const peakProfile = Math.pow(1.0 - normDist, 1.2);
                height = peakProfile * config.peakHeight;

                // Add asymmetry - slightly steeper on one side
                const angle = Math.atan2(dz, dx);
                const asymmetry = 1.0 + Math.sin(angle + 0.5) * 0.15;
                height *= asymmetry;

                // Add subtle ridges running down from peak
                const ridges = Math.sin(angle * 5) * 0.08 * (1.0 - normDist);
                height += ridges * config.peakHeight;

                // Add subtle FBM noise for natural rock texture
                const noiseScale = 0.01;
                const rockNoise = fbm(vertex.x * noiseScale + 50, vertex.z * noiseScale + 50, 3);
                height += rockNoise * config.peakHeight * 0.06 * (1.0 - normDist * 0.5);
            }

            heights.push(Math.max(0, height));
            positions.setY(i, Math.max(0, height));
        }

        // Recompute normals
        geometry.computeVertexNormals();

        // Add height attribute for shader
        const heightAttr = new Float32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
            heightAttr[i] = heights[i] / config.peakHeight;
        }
        geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

        // --- CUSTOM SHADER MATERIAL - Firewatch silhouette style ---
        this.silhouetteMountainMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uBaseColor: { value: new THREE.Color(0x4A2818) },      // Dark warm brown base
                uPeakColor: { value: new THREE.Color(0x8A5535) },      // Lighter warm brown peak
                uFogColor: { value: new THREE.Color(0xFF9955) },       // Warm orange fog
                uSkyColor: { value: new THREE.Color(0xFFAA55) },       // Golden sky blend
                uSunDirection: { value: new THREE.Vector3(0.2, 0.6, -0.8).normalize() },
            },
            vertexShader: `
                attribute float aHeight;

                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying float vHeight;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vHeight = aHeight;

                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uBaseColor;
                uniform vec3 uPeakColor;
                uniform vec3 uFogColor;
                uniform vec3 uSkyColor;
                uniform vec3 uSunDirection;
                uniform float uTime;

                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying float vHeight;

                // Simple noise for detail
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);

                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));

                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }

                void main() {
                    // Discard pixels below ground
                    if (vHeight < 0.02) discard;

                    // === LIGHTING ===
                    float NdotL = dot(vNormal, uSunDirection);
                    float lighting = max(0.4, NdotL * 0.5 + 0.5);

                    // === HEIGHT-BASED COLOR ===
                    // Darker at base, lighter toward peak (Firewatch style)
                    vec3 mountainColor = mix(uBaseColor, uPeakColor, vHeight * 0.8);

                    // Add subtle lighting variation
                    mountainColor *= lighting;

                    // Add noise variation for texture
                    float noiseVal = noise(vWorldPosition.xz * 0.03);
                    mountainColor += vec3(noiseVal * 0.05 - 0.025);

                    // === ATMOSPHERIC FOG ===
                    float dist = length(vWorldPosition - cameraPosition);
                    float fogFactor = smoothstep(80.0, 200.0, dist);

                    // Height-aware atmosphere (higher = more sky color)
                    vec3 atmosphereColor = mix(uFogColor, uSkyColor, vHeight * 0.5);
                    mountainColor = mix(mountainColor, atmosphereColor, fogFactor * 0.6);

                    // === BASE FOG/MIST ===
                    float baseFog = smoothstep(0.3, 0.0, vHeight);
                    baseFog *= 0.8;
                    mountainColor = mix(mountainColor, uFogColor, baseFog);

                    // === RIM LIGHTING (edge glow from sun) ===
                    float rim = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 3.0);
                    vec3 rimColor = vec3(1.0, 0.6, 0.3); // Warm orange rim
                    mountainColor += rimColor * rim * 0.15 * vHeight;

                    gl_FragColor = vec4(mountainColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });

        // Create the mountain mesh (original peak)
        this.silhouetteMountain = new THREE.Mesh(geometry, this.silhouetteMountainMaterial);
        this.silhouetteMountain.position.copy(config.position);
        this.silhouetteMountain.renderOrder = -5;

        this.scene.add(this.silhouetteMountain);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SECOND TALLER PEAK (to the left of the first one)
        // ─────────────────────────────────────────────────────────────────────

        const tallPeakConfig = {
            size: 380,           // Wide base
            segments: 64,
            peakHeight: 170,     // Reduced height
            position: new THREE.Vector3(-260, -15, -175),  // Further left
        };

        // Create geometry for tall peak
        const tallGeometry = new THREE.PlaneGeometry(
            tallPeakConfig.size,
            tallPeakConfig.size,
            tallPeakConfig.segments,
            tallPeakConfig.segments
        );
        tallGeometry.rotateX(-Math.PI / 2);

        // Apply heightmap to tall peak (reusing same noise functions)
        const tallPositions = tallGeometry.attributes.position;
        const tallHeights = [];

        for (let i = 0; i < tallPositions.count; i++) {
            vertex.fromBufferAttribute(tallPositions, i);

            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = tallPeakConfig.size * 0.42;  // Slightly steeper
            const normDist = distance / maxDist;

            let height = 0;

            if (normDist < 1.0) {
                // Steeper peak profile for dramatic tall mountain
                const peakProfile = Math.pow(1.0 - normDist, 1.4);
                height = peakProfile * tallPeakConfig.peakHeight;

                // Add asymmetry
                const angle = Math.atan2(dz, dx);
                const asymmetry = 1.0 + Math.sin(angle + 0.8) * 0.12;
                height *= asymmetry;

                // Add ridges
                const ridges = Math.sin(angle * 4) * 0.1 * (1.0 - normDist);
                height += ridges * tallPeakConfig.peakHeight;

                // Add subtle noise
                const noiseScale = 0.012;
                const rockNoise = fbm(vertex.x * noiseScale + 100, vertex.z * noiseScale + 100, 3);
                height += rockNoise * tallPeakConfig.peakHeight * 0.05 * (1.0 - normDist * 0.5);
            }

            tallHeights.push(Math.max(0, height));
            tallPositions.setY(i, Math.max(0, height));
        }

        tallGeometry.computeVertexNormals();

        // Add height attribute
        const tallHeightAttr = new Float32Array(tallPositions.count);
        for (let i = 0; i < tallPositions.count; i++) {
            tallHeightAttr[i] = tallHeights[i] / tallPeakConfig.peakHeight;
        }
        tallGeometry.setAttribute('aHeight', new THREE.BufferAttribute(tallHeightAttr, 1));

        // Create tall peak mesh (reuse same material)
        this.tallMountainPeak = new THREE.Mesh(tallGeometry, this.silhouetteMountainMaterial);
        this.tallMountainPeak.position.copy(tallPeakConfig.position);
        this.tallMountainPeak.renderOrder = -6;  // Render behind the first mountain

        this.scene.add(this.tallMountainPeak);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE THIRD PEAK (FAR LEFT) (to complete the 3-tops request)
        // ─────────────────────────────────────────────────────────────────────

        const farLeftConfig = {
            size: 350,
            segments: 64,
            peakHeight: 140,     // Intermediate height
            position: new THREE.Vector3(-380, -15, -190),  // Far left of the tall peak
        };

        const farLeftGeometry = new THREE.PlaneGeometry(
            farLeftConfig.size,
            farLeftConfig.size,
            farLeftConfig.segments,
            farLeftConfig.segments
        );
        farLeftGeometry.rotateX(-Math.PI / 2);

        // Apply heightmap to far left peak
        const farLeftPositions = farLeftGeometry.attributes.position;
        const farLeftHeights = [];

        for (let i = 0; i < farLeftPositions.count; i++) {
            vertex.fromBufferAttribute(farLeftPositions, i);

            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = farLeftConfig.size * 0.45;
            const normDist = distance / maxDist;

            let height = 0;

            if (normDist < 1.0) {
                // Slightly broader profile
                const peakProfile = Math.pow(1.0 - normDist, 1.3);
                height = peakProfile * farLeftConfig.peakHeight;

                // Asymmetry
                const angle = Math.atan2(dz, dx);
                height *= (1.0 + Math.sin(angle + 2.0) * 0.1);

                // Ridges
                const ridges = Math.sin(angle * 5) * 0.08 * (1.0 - normDist);
                height += ridges * farLeftConfig.peakHeight;

                // Noise
                const noiseScale = 0.01;
                const rockNoise = fbm(vertex.x * noiseScale + 500, vertex.z * noiseScale + 500, 3);
                height += rockNoise * farLeftConfig.peakHeight * 0.05;
            }

            farLeftHeights.push(Math.max(0, height));
            farLeftPositions.setY(i, Math.max(0, height));
        }

        farLeftGeometry.computeVertexNormals();

        const farLeftHeightAttr = new Float32Array(farLeftPositions.count);
        for (let i = 0; i < farLeftPositions.count; i++) {
            farLeftHeightAttr[i] = farLeftHeights[i] / farLeftConfig.peakHeight;
        }
        farLeftGeometry.setAttribute('aHeight', new THREE.BufferAttribute(farLeftHeightAttr, 1));

        this.farLeftMountain = new THREE.Mesh(farLeftGeometry, this.silhouetteMountainMaterial);
        this.farLeftMountain.position.copy(farLeftConfig.position);
        this.farLeftMountain.renderOrder = -8; // Behind tall peak
        this.scene.add(this.farLeftMountain);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE RIGHT SIDE MOUNTAIN (Background silhouette matching left mountain depth)
        // Positioned far back to blend with other background mountains
        // ─────────────────────────────────────────────────────────────────────

        const rightHillConfig = {
            size: 320,           // Similar to left mountain
            segments: 64,
            peakHeight: 115,     // Natural height, not looming
            position: new THREE.Vector3(120, -15, -160),   // Balanced position on right side
        };

        const rightGeometry = new THREE.PlaneGeometry(
            rightHillConfig.size,
            rightHillConfig.size,
            rightHillConfig.segments,
            rightHillConfig.segments
        );
        rightGeometry.rotateX(-Math.PI / 2);

        const rightPositions = rightGeometry.attributes.position;
        const rightHeights = [];

        for (let i = 0; i < rightPositions.count; i++) {
            vertex.fromBufferAttribute(rightPositions, i);

            const dx = vertex.x;
            const dz = vertex.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const maxDist = rightHillConfig.size * 0.45;
            const normDist = distance / maxDist;

            let height = 0;

            if (normDist < 1.0) {
                // Rounder, softer profile for hills
                const peakProfile = Math.pow(1.0 - normDist, 1.1);
                height = peakProfile * rightHillConfig.peakHeight;

                // Asymmetry
                const angle = Math.atan2(dz, dx);
                height *= (1.0 + Math.sin(angle * 2.0 + 1.0) * 0.1);

                // Rolling ridges
                const ridges = Math.sin(angle * 3) * 0.06 * (1.0 - normDist);
                height += ridges * rightHillConfig.peakHeight;

                // Noise
                const noiseScale = 0.008;
                const rockNoise = fbm(vertex.x * noiseScale + 200, vertex.z * noiseScale + 200, 3);
                height += rockNoise * rightHillConfig.peakHeight * 0.04;
            }

            rightHeights.push(Math.max(0, height));
            rightPositions.setY(i, Math.max(0, height));
        }

        rightGeometry.computeVertexNormals();

        const rightHeightAttr = new Float32Array(rightPositions.count);
        for (let i = 0; i < rightPositions.count; i++) {
            rightHeightAttr[i] = rightHeights[i] / rightHillConfig.peakHeight;
        }
        rightGeometry.setAttribute('aHeight', new THREE.BufferAttribute(rightHeightAttr, 1));

        this.rightHill = new THREE.Mesh(rightGeometry, this.silhouetteMountainMaterial);
        this.rightHill.position.copy(rightHillConfig.position);
        this.rightHill.renderOrder = -15; // Far behind trees and other elements
        this.scene.add(this.rightHill);

    */

    // ═══════════════════════════════════════════════════════════════════════════
    // HAZE LAYERS - Atmospheric haze between tree depth layers
    // ═══════════════════════════════════════════════════════════════════════════

    createHazeLayers() {
        this.hazeLayers = [];
        this.hazeNodeUniforms = [];

        // Haze configurations between tree layers
        const hazeConfigs = [
            {
                z: -62, y: 9, width: 150, height: 30, density: 0.34, color: new THREE.Color(0xFFC08E), drift: new THREE.Vector2(0.018, 0.004),
            },
            {
                z: -46, y: 7, width: 130, height: 24, density: 0.29, color: new THREE.Color(0xFFB27A), drift: new THREE.Vector2(0.025, -0.003),
            },
            {
                z: -31, y: 5.2, width: 108, height: 19, density: 0.24, color: new THREE.Color(0xFFA06A), drift: new THREE.Vector2(0.032, 0.006),
            },
            {
                z: -18, y: 4.2, width: 84, height: 14, density: 0.19, color: new THREE.Color(0xFF935D), drift: new THREE.Vector2(0.039, -0.004),
            },
        ];

        hazeConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            let material = null;
            if (this.isWebGPU) {
                const nodeHaze = createHazeNodeMaterial({
                    time: this.uniforms.time.value,
                    hazeColor: config.color.clone(),
                    density: config.density,
                    layerDepth: index / Math.max(1, hazeConfigs.length - 1),
                    drift: config.drift.clone(),
                });
                material = nodeHaze.material;
                this.hazeNodeUniforms.push(nodeHaze.uniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uHazeColor: { value: config.color },
                        uDensity: { value: config.density },
                        uLayerDepth: { value: index / Math.max(1, hazeConfigs.length - 1) },
                        uDrift: { value: config.drift },
                    },
                    vertexShader: hazeVertexShader,
                    fragmentShader: hazeFragmentShader,
                    transparent: true,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const haze = new THREE.Mesh(geometry, material);
            haze.position.set(0, config.y, config.z);
            haze.renderOrder = -25 + index;

            this.hazeLayers.push(haze);
            this.mainGroup.add(haze);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREGROUND BRANCHES - Silhouette frame at screen edges (Firewatch style)
    // ═══════════════════════════════════════════════════════════════════════════

    createForegroundBranches() {
        this.foregroundBranches = [];

        // Very dark silhouette color (almost black)
        const branchColor = new THREE.Color(0x0A0502);

        // Branch configurations for both sides
        const branchConfigs = [
            {
                side: -1, x: -22, y: 12, z: 8, width: 18, height: 25, rotZ: 0.2, opacity: 0.95,
            }, // Left top
            {
                side: -1, x: -25, y: 3, z: 6, width: 15, height: 18, rotZ: 0.35, opacity: 0.9,
            }, // Left bottom
            {
                side: 1, x: 24, y: 14, z: 7, width: 16, height: 22, rotZ: -0.15, opacity: 0.95,
            }, // Right top
            {
                side: 1, x: 26, y: 5, z: 5, width: 14, height: 16, rotZ: -0.3, opacity: 0.85,
            }, // Right bottom
        ];

        branchConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uBranchColor: { value: branchColor },
                    uOpacity: { value: config.opacity },
                    uSide: { value: config.side },
                },
                vertexShader: branchVertexShader,
                fragmentShader: branchFragmentShader,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const branch = new THREE.Mesh(geometry, material);
            branch.position.set(config.x, config.y, config.z);
            branch.rotation.z = config.rotZ;

            this.foregroundBranches.push(branch);
            this.mainGroup.add(branch);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREST FLOOR - Simple dark ground (Firewatch style)
    // ═══════════════════════════════════════════════════════════════════════════

    createForestFloor() {
        // Extended geometry to cover from lake edge to mountains
        const geometry = new THREE.PlaneGeometry(300, 250, 64, 64);
        let material;

        if (this.isWebGPU) {
            const groundNodeMaterial = createGroundNodeMaterial({
                time: this.uniforms.time.value,
                groundColor: COLORS.groundBase.clone(),
                mossColor: COLORS.groundMoss.clone(),
                dirtColor: COLORS.groundDirt.clone(),
                glowIntensity: this.uniforms.glowIntensity.value,
                fogColor: COLORS.fog.clone(),
            });
            material = groundNodeMaterial.material;
            this.groundNodeUniforms = groundNodeMaterial.uniforms;
            this.groundMaterial = null;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uGroundColor: { value: COLORS.groundBase },
                    uMossColor: { value: COLORS.groundMoss },
                    uDirtColor: { value: COLORS.groundDirt },
                    uGlowIntensity: { value: 0 },
                    uFogColor: { value: COLORS.fog },
                },
                vertexShader: groundVertexShader,
                fragmentShader: groundFragmentShader,
                side: THREE.DoubleSide,
            });
            this.groundMaterial = material;
            this.groundNodeUniforms = null;
        }

        this.groundPlane = new THREE.Mesh(geometry, material);
        this.groundPlane.rotation.x = -Math.PI / 2;
        // Lowered to -0.55 so water wave troughs (up to -0.2 displacement) never intersect the ground
        this.groundPlane.position.set(0, -0.55, -40);

        this.mainGroup.add(this.groundPlane);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3D ANIMATED GRASS - Billboard clumps with wind animation
    // ═══════════════════════════════════════════════════════════════════════════

    createGrass() {
        if (!this.scene) return;

        if (this.grassTexture) {
            this.grassTexture.dispose();
            this.grassTexture = null;
        }

        // Generate procedural grass texture
        const grassTexture = this.createGrassTexture();
        this.grassTexture = grassTexture;

        // Billboard geometry - 4 quads at 45° intervals for fluffy look
        const clumpSize = 2.5;
        const clumpHeight = 0.8;
        const numPlanes = 4;

        const positions = [];
        const uvs = [];
        const normals = [];

        const uvTop = 0.85;

        for (let i = 0; i < numPlanes; i++) {
            const angle = (i / numPlanes) * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const halfSize = clumpSize / 2;

            // Two triangles per plane
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, 0, halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, clumpHeight, -halfSize * sin);

            uvs.push(0, 0, 1, 0, 1, uvTop);
            uvs.push(0, 0, 1, uvTop, 0, uvTop);

            for (let j = 0; j < 6; j++) {
                normals.push(0, 1, 0);
            }
        }

        const clumpGeo = new THREE.BufferGeometry();
        clumpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        clumpGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        clumpGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        const grassCount = this.qualityPreset?.grassCount ?? 400;
        if (grassCount <= 0) return;
        const grassWindOffsets = new Float32Array(grassCount);
        clumpGeo.setAttribute(
            'aWindOffset',
            new THREE.InstancedBufferAttribute(grassWindOffsets, 1),
        );

        let grassMat;
        if (this.isWebGPU) {
            const grassNodeMaterial = createGrassNodeMaterial({
                time: this.uniforms.time.value,
                windStrength: 0.18,
                spiritGlow: 0.0,
                grassTexture,
                baseColor: new THREE.Color(0x4A3015),
                tipColor: new THREE.Color(0xDDAA44),
                fogColor: COLORS.fog,
                glowColor: new THREE.Color(0xFFB067),
                alphaCutoff: 0.5,
            });
            grassMat = grassNodeMaterial.material;
            this.grassNodeUniforms = grassNodeMaterial.uniforms;
            this.grassMaterial = null;
        } else {
            // Forest grass shader material - bright golden Firewatch sunset tones
            grassMat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uWindStrength: { value: 0.18 },
                    uGrassTexture: { value: grassTexture },
                    uBaseColor: { value: new THREE.Color(0x4A3015) }, // Warm brown base
                    uTipColor: { value: new THREE.Color(0xDDAA44) }, // Bright golden tips (Firewatch)
                    uFogColor: { value: COLORS.fog },
                    uSpiritGlow: { value: 0.0 }, // Reactive to spirits
                },
                vertexShader: `
                    uniform float uTime;
                    uniform float uWindStrength;
                    uniform float uSpiritGlow;

                    varying vec2 vUv;
                    varying float vFogDepth;
                    varying float vGlow;

                    void main() {
                        vUv = uv;
                        vec3 pos = position;

                        #ifdef USE_INSTANCING
                            vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
                        #else
                            vec4 worldPos = modelMatrix * vec4(position, 1.0);
                        #endif

                        // Wind animation
                        float windPhase = worldPos.x * 0.3 + worldPos.z * 0.25 + uTime * 1.5;
                        float wind = sin(windPhase) * uWindStrength;
                        float wind2 = sin(windPhase * 0.6 + 1.5) * uWindStrength * 0.6;

                        float heightFactor = uv.y * uv.y;
                        pos.x += wind * heightFactor;
                        pos.z += wind2 * heightFactor;

                        // Spirit glow effect - tips glow when spirits are nearby
                        float glowPattern = sin(worldPos.x * 0.2) * sin(worldPos.z * 0.15) * 0.5 + 0.5;
                        vGlow = glowPattern * heightFactor * uSpiritGlow;

                        #ifdef USE_INSTANCING
                            vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                        #else
                            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        #endif

                        vFogDepth = -mvPosition.z;
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D uGrassTexture;
                    uniform vec3 uBaseColor;
                    uniform vec3 uTipColor;
                    uniform vec3 uFogColor;

                    varying vec2 vUv;
                    varying float vFogDepth;
                    varying float vGlow;

                    void main() {
                        vec4 texColor = texture2D(uGrassTexture, vUv);
                        if (texColor.a < 0.5) discard;

                        // Dark base to lighter tips gradient
                        float gradient = smoothstep(0.0, 0.7, vUv.y);
                        vec3 grassColor = mix(uBaseColor, uTipColor, gradient);

                        vec3 finalColor = grassColor * texColor.rgb * 1.3;

                        // Add warm sunset tint at tips
                        vec3 sunsetTint = vec3(1.0, 0.85, 0.6);
                        finalColor = mix(finalColor, finalColor * sunsetTint, gradient * 0.4);

                        // Add warm spirit glow (golden amber)
                        finalColor += vec3(1.0, 0.7, 0.3) * vGlow * 0.4;

                        // Fog
                        float fogFactor = smoothstep(15.0, 60.0, vFogDepth);
                        finalColor = mix(finalColor, uFogColor, fogFactor);

                        gl_FragColor = vec4(finalColor, 1.0);
                    }
                `,
                side: THREE.DoubleSide,
                depthWrite: true,
                alphaTest: 0.5,
            });

            this.grassMaterial = grassMat;
            this.grassNodeUniforms = null;
        }

        // Create instanced grass mesh
        const grassMesh = new THREE.InstancedMesh(clumpGeo, grassMat, grassCount);
        const dummy = new THREE.Object3D();

        // Lake clearing parameters (matches lake at z=5, radius 70, scale 2.5x0.45)
        const lakeCenter = { x: 0, z: 5 };
        const lakeRadiusX = 95; // 70 * 2.5 * 0.55 margin
        const lakeRadiusZ = 38; // 70 * 0.45 + margin

        for (let i = 0; i < grassCount; i++) {
            // Distribute grass only on near shore (positive z, in front of lake)
            const angle = (this.random() - 0.5) * Math.PI * 0.9;
            const dist = 5 + this.random() * 55;

            const x = Math.sin(angle) * dist;
            const z = 40 + Math.cos(angle) * dist * 0.4; // Keep grass on near shore (z > 40)

            // Check if inside lake zone
            const dx = (x - lakeCenter.x) / lakeRadiusX;
            const dz = (z - lakeCenter.z) / lakeRadiusZ;
            const inLake = (dx * dx + dz * dz) < 1.0;

            if (inLake) {
                // Hide grass in lake area
                dummy.scale.set(0, 0, 0);
            } else {
                const scale = 0.6 + this.random() * 0.6;
                dummy.scale.set(scale, scale * (0.8 + this.random() * 0.4), scale);
            }

            dummy.position.set(x, -0.5, z);
            dummy.rotation.y = this.random() * Math.PI * 2;
            grassWindOffsets[i] = x * 0.3 + z * 0.25;

            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        clumpGeo.getAttribute('aWindOffset').needsUpdate = true;
        grassMesh.frustumCulled = false;

        this.mainGroup.add(grassMesh);
        this.grassMesh = grassMesh;
    }

    createSilhouetteGrass() {
        if (!this.scene) return;

        if (this.silhouetteGrassTexture) {
            this.silhouetteGrassTexture.dispose();
            this.silhouetteGrassTexture = null;
        }

        const grassTexture = this.createGrassTexture();
        this.silhouetteGrassTexture = grassTexture;

        // Billboard geometry - 4 quads at 45° intervals
        const clumpSize = 3.5; // Larger for foreground
        const clumpHeight = 1.6; // Taller
        const numPlanes = 3; // Less dense planes, but more instances

        const positions = [];
        const uvs = [];
        const normals = [];

        const uvTop = 0.85;

        for (let i = 0; i < numPlanes; i++) {
            const angle = (i / numPlanes) * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const halfSize = clumpSize / 2;

            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, 0, halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, 0, -halfSize * sin);
            positions.push(halfSize * cos, clumpHeight, halfSize * sin);
            positions.push(-halfSize * cos, clumpHeight, -halfSize * sin);

            uvs.push(0, 0, 1, 0, 1, uvTop);
            uvs.push(0, 0, 1, uvTop, 0, uvTop);

            for (let j = 0; j < 6; j++) {
                normals.push(0, 1, 0);
            }
        }

        const clumpGeo = new THREE.BufferGeometry();
        clumpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        clumpGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        clumpGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        const instanceCount = 800;
        const grassWindOffsets = new Float32Array(instanceCount);
        clumpGeo.setAttribute(
            'aWindOffset',
            new THREE.InstancedBufferAttribute(grassWindOffsets, 1),
        );

        let grassMat;
        if (this.isWebGPU) {
            const silhouetteGrassNodeMaterial = createSilhouetteGrassNodeMaterial({
                time: this.uniforms.time.value,
                windStrength: 0.15,
                grassTexture,
                baseColor: new THREE.Color(0x150505),
                tipColor: new THREE.Color(0x2A1005),
                alphaCutoff: 0.6,
            });
            grassMat = silhouetteGrassNodeMaterial.material;
            this.silhouetteGrassNodeUniforms = silhouetteGrassNodeMaterial.uniforms;
        } else {
            // Dark silhouette shader material
            grassMat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uWindStrength: { value: 0.15 },
                    uGrassTexture: { value: grassTexture },
                    uBaseColor: { value: new THREE.Color(0x150505) }, // Very dark brown/black
                    uTipColor: { value: new THREE.Color(0x2A1005) }, // Slightly warmer tip
                },
                vertexShader: `
                    uniform float uTime;
                    uniform float uWindStrength;
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        #ifdef USE_INSTANCING
                            vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
                        #else
                            vec4 worldPos = modelMatrix * vec4(position, 1.0);
                        #endif
                        float windPhase = worldPos.x * 0.2 + worldPos.z * 0.15 + uTime * 1.0;
                        float wind = sin(windPhase) * uWindStrength;
                        float heightFactor = uv.y * uv.y;
                        pos.x += wind * heightFactor;
                        #ifdef USE_INSTANCING
                            vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                        #else
                            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        #endif
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D uGrassTexture;
                    uniform vec3 uBaseColor;
                    uniform vec3 uTipColor;
                    varying vec2 vUv;
                    void main() {
                        vec4 texColor = texture2D(uGrassTexture, vUv);
                        if (texColor.a < 0.6) discard; // Sharper cutout
                        vec3 color = mix(uBaseColor, uTipColor, vUv.y);
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.DoubleSide,
            });
            this.silhouetteGrassNodeUniforms = null;
        }

        // Dense foreground instances
        const grassMesh = new THREE.InstancedMesh(clumpGeo, grassMat, instanceCount);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < instanceCount; i++) {
            // Keep silhouette grass at far left/right edges so it frames the scene without occluding the lake center.
            const leftSide = this.random() < 0.52;
            const x = leftSide
                ? (-155 + this.random() * 70)
                : (85 + this.random() * 70);
            const z = 102 + this.random() * 36;

            const scale = 0.8 + this.random() * 0.7;
            dummy.scale.set(scale, scale * (0.9 + this.random() * 0.3), scale);
            dummy.position.set(x, -2.5, z); // Slightly lower
            dummy.rotation.y = this.random() * Math.PI * 2;
            grassWindOffsets[i] = x * 0.2 + z * 0.15;
            dummy.updateMatrix();
            grassMesh.setMatrixAt(i, dummy.matrix);
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        clumpGeo.getAttribute('aWindOffset').needsUpdate = true;
        grassMesh.frustumCulled = false;
        this.mainGroup.add(grassMesh);
        this.silhouetteGrassMesh = grassMesh;
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        const size = 512;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, size, size);

        // Draw multiple grass blades
        const bladeCount = 20;
        for (let i = 0; i < bladeCount; i++) {
            const x = (i / bladeCount) * size + (this.random() - 0.5) * 30;
            const height = size * (0.6 + this.random() * 0.35);
            const baseWidth = 8 + this.random() * 6;
            const lean = (this.random() - 0.5) * 40;

            // Gradient from dark base to golden tip (warm sunset tones)
            const gradient = ctx.createLinearGradient(x, size, x + lean, size - height);
            gradient.addColorStop(0, '#1a1508');
            gradient.addColorStop(0.3, '#3a2a15');
            gradient.addColorStop(0.6, '#5a4a25');
            gradient.addColorStop(1.0, '#8a7a40');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(x - baseWidth / 2, size);
            ctx.lineTo(x + baseWidth / 2, size);

            // Curved blade with bezier
            const midX = x + lean * 0.6;
            const midY = size - height * 0.5;
            const tipX = x + lean;
            const tipY = size - height;

            ctx.quadraticCurveTo(midX + baseWidth * 0.3, midY, tipX, tipY);
            ctx.quadraticCurveTo(midX - baseWidth * 0.3, midY, x - baseWidth / 2, size);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAKE - Firewatch-style stylized water with gradient and ripples
    // ═══════════════════════════════════════════════════════════════════════════

    createFallbackWaterNormalTexture() {
        // Flat normal (0.5, 0.5, 1.0) avoids "no image data" warnings before JPG load completes.
        const data = new Uint8Array([128, 128, 255, 255]);
        const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        return texture;
    }

    loadWaterNormalTexture(loadVersion) {
        const candidatePaths = ['/textures/water-normal.jpg', 'textures/water-normal.jpg'];
        const loader = new THREE.TextureLoader();

        const applyTexture = (texture, path) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;

            if (
                loadVersion !== this.waterNormalsLoadVersion
                || !this.isActive
                || !this.lakeMesh?.material?.uniforms?.normalSampler
            ) {
                texture.dispose();
                return;
            }

            const previous = this.lakeMesh.material.uniforms.normalSampler.value;
            this.lakeMesh.material.uniforms.normalSampler.value = texture;
            this.waterNormalsTexture = texture;

            if (previous && previous !== texture) {
                previous.dispose();
                if (previous === this.waterNormalsFallbackTexture) {
                    this.waterNormalsFallbackTexture = null;
                }
            }

            console.log(`[GoldenForest] Water normals loaded from ${path}`);
        };

        const tryLoad = (index) => {
            if (index >= candidatePaths.length) {
                console.warn('[GoldenForest] Failed to load water normals; keeping fallback normal texture.');
                return;
            }

            const path = candidatePaths[index];
            loader.load(
                path,
                (texture) => applyTexture(texture, path),
                undefined,
                () => {
                    if (index + 1 < candidatePaths.length) {
                        console.warn(`[GoldenForest] Failed loading water normals at ${path}, retrying...`);
                    }
                    tryLoad(index + 1);
                },
            );
        };

        tryLoad(0);
    }

    createLakeGeometry() {
        const baseRadius = 70;
        // Denser than before so the WebGPU lake's vertical wave displacement
        // reads as smooth 3D swells instead of coarse facets (static geometry —
        // built once, negligible per-frame cost even on modest GPUs).
        const angularSegments = 192;
        const radialSegments = 72;

        const positions = [];
        const uvs = [];
        const indices = [];

        const noise = (x, y, seed = 0) => {
            const n1 = Math.sin(x * 2.3 + seed) * Math.cos(y * 1.7 + seed * 0.7);
            const n2 = Math.sin(x * 5.1 + seed * 1.3) * Math.cos(y * 4.2 + seed * 0.5) * 0.5;
            const n3 = Math.sin(x * 8.7 + seed * 2.1) * Math.cos(y * 7.3 + seed * 1.1) * 0.25;
            return (n1 + n2 + n3) / 1.75;
        };

        // Precompute shoreline radius per angle so each ring follows the same organic contour.
        const shorelineRadius = new Array(angularSegments + 1);
        for (let i = 0; i <= angularSegments; i++) {
            const angle = (i / angularSegments) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const nearShoreBoost = sin > 0 ? 0.15 : 0;
            const variation = noise(cos * 3, sin * 3, 42) * (0.12 + nearShoreBoost);
            shorelineRadius[i] = baseRadius * (1 + variation);
        }

        for (let ring = 0; ring <= radialSegments; ring++) {
            const t = ring / radialSegments;
            for (let i = 0; i <= angularSegments; i++) {
                const angle = (i / angularSegments) * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const radius = shorelineRadius[i] * t;

                positions.push(cos * radius, sin * radius, 0);
                // Keep UVs radially uniform so edge effects stay stable with the irregular shoreline.
                uvs.push((cos * t + 1) / 2, (sin * t + 1) / 2);
            }
        }

        const rowSize = angularSegments + 1;
        for (let ring = 0; ring < radialSegments; ring++) {
            const row = ring * rowSize;
            const nextRow = (ring + 1) * rowSize;
            for (let i = 0; i < angularSegments; i++) {
                const a = row + i;
                const b = row + i + 1;
                const c = nextRow + i;
                const d = nextRow + i + 1;

                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        const lakeGeometry = new THREE.BufferGeometry();
        lakeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        lakeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        lakeGeometry.setIndex(indices);
        lakeGeometry.computeVertexNormals();
        return lakeGeometry;
    }

    getWaterReflectionResolution() {
        return this.qualityPreset?.waterReflectionRes ?? 512;
    }

    createWebGPUWater(lakeGeometry) {
        // Real planar reflection of the environment (sky + treeline + sun) is
        // what makes the lake read as a Firewatch lake rather than a bright
        // sheet. A ReflectorNode mirrors everything tagged REFLECTION_LAYER
        // (applied to the scene in applyReflectionLayer()); the water samples it
        // rippled by its analytic wave normal. Verified in isolation via the
        // `golden-forest-water` playground effect (both share the factory).
        const reflectionScale = this.qualityPreset?.waterReflectionScale
            ?? (this.qualityLevel === 'low' ? 0.3 : 0.45);
        let reflection = null;
        if (this.camera) {
            reflection = reflector({
                resolutionScale: reflectionScale,
                bounces: false,
                generateMipmaps: false,
            });
            reflection.target.rotateX(-Math.PI / 2);
            reflection.target.position.set(0, -0.3, 5);
            reflection.target.name = 'golden-forest-lake-reflector';
            this.scene.add(reflection.target);
            reflection.reflector
                .getVirtualCamera(this.camera)
                .layers.set(GOLDEN_FOREST_REFLECTION_LAYER);
            this.waterReflection = reflection;
        }

        const nodeWater = createGoldenLakeNodeMaterial({
            time: this.uniforms.time.value,
            sunDirection: this.sunPosition.clone().normalize(),
            sunColor: new THREE.Color(0xffaa33),
            reflection,
            // Emissive stays modest — the theme post pipeline owns the bloom.
            emissiveStrength: 0.42,
        });

        this.lakeMesh = new THREE.Mesh(lakeGeometry, nodeWater.material);
        this.lakeMesh.rotation.x = -Math.PI / 2;
        this.lakeMesh.scale.set(2.5, 0.45, 1.0);
        this.lakeMesh.position.set(0, -0.3, 5);
        this.lakeMesh.castShadow = false;
        this.lakeMesh.receiveShadow = false;
        this.mainGroup.add(this.lakeMesh);

        this.waterNodeUniforms = nodeWater.uniforms;
        this.webgpuWater = null;
        console.log(
            `[GoldenForest] Golden lake created (WebGPU planar reflection ${reflection ? 'on' : 'off'})`,
        );
    }

    // Tag the built environment (sky, trees, mountains, sun, …) so the lake's
    // ReflectorNode mirrors it. The water surface and the reflector plane are
    // excluded to avoid the mirror feeding back on itself.
    applyReflectionLayer() {
        if (!this.isWebGPU || !this.waterReflection) return;
        const excluded = new Set([this.lakeMesh, this.waterReflection.target]);
        this.scene.traverse((object) => {
            if (!object.isObject3D || excluded.has(object)) return;
            object.layers.enable(GOLDEN_FOREST_REFLECTION_LAYER);
        });
    }

    updateWebGPUWaterReflection(renderer, scene, camera) {
        if (!this.webgpuWater || !this.lakeMesh || !this.isActive) return;
        if (camera !== this.camera) return;
        const state = this.webgpuWater;
        if (state.isRendering || camera === state.mirrorCamera) return;

        const waterMesh = this.lakeMesh;
        const mirrorCamera = state.mirrorCamera;
        const renderTarget = state.renderTarget;

        state.isRendering = true;
        let previousRenderTarget = null;
        let previousXrEnabled = null;
        let previousShadowAutoUpdate = null;
        try {
            waterMesh.getWorldPosition(state.worldPos);
            const waterY = state.worldPos.y;

            mirrorCamera.position.copy(camera.position);
            mirrorCamera.position.y = waterY - (camera.position.y - waterY);

            camera.getWorldDirection(state.worldDir);
            state.worldTarget.copy(camera.position).add(state.worldDir);
            state.reflectionTarget.copy(state.worldTarget);
            state.reflectionTarget.y = waterY - (state.worldTarget.y - waterY);

            mirrorCamera.up.copy(camera.up);
            mirrorCamera.up.y *= -1;
            mirrorCamera.near = camera.near;
            mirrorCamera.far = camera.far;
            mirrorCamera.aspect = camera.aspect;
            mirrorCamera.fov = camera.fov;
            mirrorCamera.updateProjectionMatrix();
            mirrorCamera.lookAt(state.reflectionTarget);
            mirrorCamera.updateMatrixWorld(true);

            state.textureMatrix.set(
                0.5,
                0.0,
                0.0,
                0.5,
                0.0,
                0.5,
                0.0,
                0.5,
                0.0,
                0.0,
                0.5,
                0.5,
                0.0,
                0.0,
                0.0,
                1.0,
            );
            state.textureMatrix.multiply(mirrorCamera.projectionMatrix);
            state.textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

            previousRenderTarget = renderer.getRenderTarget();
            previousXrEnabled = renderer.xr?.enabled;
            previousShadowAutoUpdate = renderer.shadowMap?.autoUpdate;

            waterMesh.visible = false;

            if (renderer.xr) renderer.xr.enabled = false;
            if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;

            renderer.setRenderTarget(renderTarget);
            renderer.clear();
            renderer.render(scene, mirrorCamera);
        } finally {
            if (renderer.xr && previousXrEnabled !== null) renderer.xr.enabled = previousXrEnabled;
            if (renderer.shadowMap && previousShadowAutoUpdate !== null) {
                renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
            }
            if (previousRenderTarget !== null) {
                renderer.setRenderTarget(previousRenderTarget);
            }
            waterMesh.visible = true;
            state.isRendering = false;
        }
    }

    createWebGLWater(lakeGeometry) {
        const waterNormals = this.createFallbackWaterNormalTexture();
        this.waterNormalsFallbackTexture = waterNormals;
        this.waterNormalsTexture = waterNormals;
        const loadVersion = ++this.waterNormalsLoadVersion;
        const reflectionResolution = this.getWaterReflectionResolution();

        this.lakeMesh = new GoldenForestWater(lakeGeometry, {
            textureWidth: this.getWaterReflectionResolution(),
            textureHeight: this.getWaterReflectionResolution(),
            waterNormals: this.waterNormalsTexture || this.waterNormalsFallbackTexture,
            sunDirection: this.sunPosition.clone().normalize(),
            sunColor: 0xffaa33, // Slightly warmer gold
            waterColor: 0x220800, // Almost black/dark brown base
            distortionScale: 1.2, // Smoother reflections
            fog: this.scene.fog !== undefined,
        });

        this.lakeMesh.rotation.x = -Math.PI / 2;
        this.lakeMesh.scale.set(2.5, 0.45, 1.0);
        this.lakeMesh.position.set(0, -0.3, 5);
        this.lakeMesh.material.uniforms.size.value = 4.0;
        this.lakeMesh.castShadow = false;
        this.lakeMesh.receiveShadow = false;

        this.mainGroup.add(this.lakeMesh);
        this.loadWaterNormalTexture(loadVersion);
        console.log('[GoldenForest] Organic shoreline lake created');
    }

    createLake() {
        if (!this.scene) return;

        console.log('[GoldenForest] Creating Three.js Water lake with organic shoreline...');
        const lakeGeometry = this.createLakeGeometry();

        if (this.isWebGPU) {
            this.createWebGPUWater(lakeGeometry);
            return;
        }

        this.createWebGLWater(lakeGeometry);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHORE FOAM - Animated gradient ring around lake edge
    // ═══════════════════════════════════════════════════════════════════════════

    createShoreFoam() {
        if (!this.scene) return;

        console.log('[GoldenForest] Creating shore foam ring...');
        this.shoreFoamNodeUniforms = null;

        const baseRadius = 70;
        const segments = 128;
        const foamWidth = 5; // Width of foam ring in local units

        // Same noise function as lake for matching edges
        const noise = (x, y, seed = 0) => {
            const n1 = Math.sin(x * 2.3 + seed) * Math.cos(y * 1.7 + seed * 0.7);
            const n2 = Math.sin(x * 5.1 + seed * 1.3) * Math.cos(y * 4.2 + seed * 0.5) * 0.5;
            const n3 = Math.sin(x * 8.7 + seed * 2.1) * Math.cos(y * 7.3 + seed * 1.1) * 0.25;
            return (n1 + n2 + n3) / 1.75;
        };

        // Build ring geometry with inner and outer edges
        const positions = [];
        const uvs = [];
        const indices = [];

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Match lake's organic variation
            const nearShoreBoost = sin > 0 ? 0.15 : 0;
            const variation = noise(cos * 3, sin * 3, 42) * (0.12 + nearShoreBoost);

            // Inner edge (matches lake exactly)
            const innerRadius = baseRadius * (1 + variation);
            // Outer edge (extends onto land)
            const outerRadius = innerRadius + foamWidth;

            // Inner vertex
            positions.push(cos * innerRadius, sin * innerRadius, 0);
            uvs.push(i / segments, 0.0); // v=0 at inner edge

            // Outer vertex
            positions.push(cos * outerRadius, sin * outerRadius, 0);
            uvs.push(i / segments, 1.0); // v=1 at outer edge
        }

        // Create quad strip indices
        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = i * 2 + 2;
            const d = i * 2 + 3;
            // Two triangles per quad
            indices.push(a, b, c);
            indices.push(b, d, c);
        }

        const foamGeometry = new THREE.BufferGeometry();
        foamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        foamGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        foamGeometry.setIndex(indices);
        foamGeometry.computeVertexNormals();

        let foamMaterial;
        if (this.isWebGPU) {
            const nodeFoam = createShoreFoamNodeMaterial({
                time: this.uniforms.time.value,
                foamColor: new THREE.Color(0.95, 0.75, 0.45),
                opacity: 0.4,
            });
            foamMaterial = nodeFoam.material;
            this.shoreFoamNodeUniforms = nodeFoam.uniforms;
        } else {
            // Foam shader material
            foamMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0.0 },
                    foamColor: { value: new THREE.Color(0.95, 0.75, 0.45) }, // Warm golden (subtle)
                    opacity: { value: 0.4 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform vec3 foamColor;
                    uniform float opacity;
                    varying vec2 vUv;

                    void main() {
                        // vUv.y: 0.0 at water edge (inner), 1.0 at land edge (outer)
                        // Fade from water edge outward
                        float alpha = 1.0 - smoothstep(0.0, 0.8, vUv.y);

                        // Very subtle shimmer
                        float shimmer = 0.9 + 0.1 * sin(time * 1.0 + vUv.x * 10.0);
                        alpha *= shimmer;

                        gl_FragColor = vec4(foamColor, alpha * opacity);
                    }
                `,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
        }

        this.shoreFoamMesh = new THREE.Mesh(foamGeometry, foamMaterial);

        // Match lake transform
        this.shoreFoamMesh.rotation.x = -Math.PI / 2;
        this.shoreFoamMesh.scale.set(2.5, 0.45, 1.0);
        this.shoreFoamMesh.position.set(0, -0.25, 5); // Just above water surface

        this.mainGroup.add(this.shoreFoamMesh);

        console.log('[GoldenForest] Shore foam ring created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WATER LOGS - Wooden dock posts sticking out of water (Firewatch style)
    // ═══════════════════════════════════════════════════════════════════════════

    createWaterLogs() {
        if (!this.scene) return;

        console.log('[GoldenForest] Creating fallen logs...');

        this.waterLogs = new THREE.Group();

        // Dark wood silhouette color
        const woodColor = new THREE.Color(0x1A0D08);
        const woodMaterial = new THREE.MeshBasicMaterial({ color: woodColor });

        // ─────────────────────────────────────────────────────────────────────
        // FALLEN LOGS - Horizontal tree trunks lying at the far shore near trees
        // Lake is centered at z=5, far shore (near trees) is around z=-20 to -10
        // ─────────────────────────────────────────────────────────────────────
        const fallenLogs = [
            // Left side - larger log at far shore
            {
                x: -45, z: -15, length: 12, radius: 0.5, rotY: 0.15, tilt: 0.04,
            },
            // Center-left - medium log
            {
                x: -15, z: -12, length: 8, radius: 0.4, rotY: -0.2, tilt: 0.03,
            },
            // Center - small log (near the right shoreline stone)
            {
                x: 22, z: -15, length: 6, radius: 0.35, rotY: 0.2, tilt: -0.02,
            },
            // Right side - near the rocks, in the water
            {
                x: 85, z: 5, length: 9, radius: 0.45, rotY: -0.25, tilt: 0.02,
            },
            // Far right - close to right rock cluster
            {
                x: 100, z: 12, length: 6, radius: 0.5, rotY: 0.35, tilt: 0.03,
            },
        ];

        fallenLogs.forEach((config) => {
            // Create a group for log + branch stubs
            const logGroup = new THREE.Group();

            // Main trunk - oriented along X-axis (horizontal log lying down)
            // Use rotated geometry so branches can attach properly
            const geometry = new THREE.CylinderGeometry(
                config.radius * 0.85, // Slight taper at one end
                config.radius,
                config.length,
                8,
            );
            // Rotate geometry to lie along X-axis before creating mesh
            geometry.rotateZ(Math.PI / 2);

            const log = new THREE.Mesh(geometry, woodMaterial);
            logGroup.add(log);

            // Add cut-off branch stubs along the log
            const numBranches = 3 + Math.floor(config.length / 3);
            for (let i = 0; i < numBranches; i++) {
                const branchRadius = config.radius * (0.25 + this.random() * 0.15);
                const branchLength = config.radius * (1.0 + this.random() * 0.6);

                const branchGeom = new THREE.CylinderGeometry(
                    branchRadius * 0.4, // Tapered end (cut-off look)
                    branchRadius, // Base matches log
                    branchLength,
                    6,
                );
                // Translate geometry so the base (wider end) is at origin
                // Cylinder is centered, so move it up by half length
                branchGeom.translate(0, branchLength / 2, 0);

                const branch = new THREE.Mesh(branchGeom, woodMaterial);

                // Position along the log length (X-axis)
                const alongLog = (i / Math.max(numBranches - 1, 1) - 0.5) * config.length * 0.8;

                // Angle around the log - alternate top/sides, with randomness
                // 0 = top, PI/2 = side, PI = bottom
                const baseAngle = (i % 3) * (Math.PI * 2 / 3); // Distribute around circumference
                const circumAngle = baseAngle + (this.random() - 0.5) * 0.6;

                // Position branch base exactly at log surface
                const surfaceY = Math.cos(circumAngle) * config.radius;
                const surfaceZ = Math.sin(circumAngle) * config.radius;

                branch.position.set(alongLog, surfaceY, surfaceZ);

                // Rotate branch to point outward from log surface
                // The branch cylinder's Y-axis should point outward from the log center
                branch.rotation.x = circumAngle - Math.PI / 2;
                branch.rotation.z = (this.random() - 0.5) * 0.3; // Slight random tilt

                logGroup.add(branch);
            }

            // Position the whole group - partially submerged
            logGroup.position.set(config.x, -0.15, config.z);

            // Apply rotation for variety (no need for Z rotation since geometry is pre-rotated)
            logGroup.rotation.y = config.rotY;
            logGroup.rotation.x = config.tilt;

            this.waterLogs.add(logGroup);
        });

        this.mainGroup.add(this.waterLogs);

        console.log('[GoldenForest] Fallen logs created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FAR SHORE - Visible ground strip between lake and distant trees
    // ═══════════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
    // FAR SHORE - REMOVED (Merged into Forest Floor)
    // ═══════════════════════════════════════════════════════════════════════════

    createFarShore() {
        // Function intentionally left empty or removed
        if (this.farShore) {
            this.mainGroup.remove(this.farShore);
            this.farShore = null;
        }
    }

    loadRockTextureSet() {
        const loader = new THREE.TextureLoader();
        const maxAnisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1;

        const albedo = loader.load(
            new URL('./assets/mossy-ground1-albedo.png', import.meta.url).href,
        );
        const normal = loader.load(
            new URL('./assets/mossy-groundnormal.png', import.meta.url).href,
        );
        const roughness = loader.load(
            new URL('./assets/mossy-ground1-roughness.png', import.meta.url).href,
        );
        const ao = loader.load(
            new URL('./assets/mossy-ground1-ao.png', import.meta.url).href,
        );

        albedo.colorSpace = THREE.SRGBColorSpace;

        const repeat = new THREE.Vector2(1.8, 1.8);
        [albedo, normal, roughness, ao].forEach((texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.copy(repeat);
            texture.anisotropy = maxAnisotropy;
        });

        return {
            albedo,
            normal,
            roughness,
            ao,
            repeat,
        };
    }

    createRockMaterials(rockColors) {
        if (this.isWebGPU) {
            return rockColors.map((tint) => new THREE.MeshStandardMaterial({
                color: tint,
                roughness: 0.92,
                metalness: 0.0,
            }));
        }

        if (!this.rockTextureSet) {
            this.rockTextureSet = this.loadRockTextureSet();
        }

        const {
            albedo, normal, roughness, ao, repeat,
        } = this.rockTextureSet;
        const maxAnisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
        const offsets = [
            new THREE.Vector2(0.05, 0.1),
            new THREE.Vector2(0.38, 0.22),
            new THREE.Vector2(0.17, 0.46),
        ];

        const makeTextureVariant = (source, offset, isColor = false) => {
            const texture = source.clone();
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.copy(repeat);
            texture.offset.copy(offset);
            texture.anisotropy = maxAnisotropy;
            if (isColor) {
                texture.colorSpace = THREE.SRGBColorSpace;
            }
            texture.needsUpdate = true;
            return texture;
        };

        return rockColors.map((tint, index) => {
            const offset = offsets[index % offsets.length];

            return new THREE.MeshStandardMaterial({
                color: tint,
                map: makeTextureVariant(albedo, offset, true),
                normalMap: makeTextureVariant(normal, offset),
                roughnessMap: makeTextureVariant(roughness, offset),
                aoMap: makeTextureVariant(ao, offset),
                roughness: 0.92,
                metalness: 0.0,
                normalScale: new THREE.Vector2(0.9, 0.9),
                aoMapIntensity: 1.15,
            });
        });
    }

    createRockShadowCatcher() {
        if (this.rockShadowCatcher || !this.mainGroup) return;
        if (this.isWebGPU) {
            // Avoid a large transparent shadow plane in WebGPU; it produces faceted dark artifacts over the lake.
            return;
        }

        const geometry = new THREE.PlaneGeometry(300, 250);
        const material = new THREE.ShadowMaterial({ opacity: 0.28 });
        material.transparent = true;
        material.depthWrite = false;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -0.2;
        material.polygonOffsetUnits = -0.2;

        const shadowCatcher = new THREE.Mesh(geometry, material);
        shadowCatcher.rotation.x = -Math.PI / 2;
        shadowCatcher.position.set(0, -0.34, -40);
        shadowCatcher.receiveShadow = true;
        shadowCatcher.castShadow = false;
        shadowCatcher.renderOrder = 1;

        this.rockShadowCatcher = shadowCatcher;
        this.mainGroup.add(shadowCatcher);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHORE ROCKS - Warm-colored silhouette boulders along the shoreline
    // ═══════════════════════════════════════════════════════════════════════════

    createShoreRocks() {
        if (!this.scene) return;

        this.shoreRocks = [];

        const rockColors = [
            new THREE.Color(0x5A3926), // Dark warm
            new THREE.Color(0x6B4631), // Medium warm
            new THREE.Color(0x7C5740), // Lighter warm
        ];

        if (!this.rockMaterials || this.rockMaterials.length === 0) {
            this.rockMaterials = this.createRockMaterials(rockColors);
        }
        this.createRockShadowCatcher();

        // Rock positions along the near shore and lake edges for natural framing
        // Lake edges visible in camera are around x=±120-160, near shore around z=35-55
        const rockPositions = [
            // NEAR SHORE CENTER - close to camera, breaking up foreground
            {
                x: -20, z: 42, scale: 6.0, rotY: 0.3, colorIdx: 0,
            },
            {
                x: 15, z: 45, scale: 5.0, rotY: 1.2, colorIdx: 1,
            },
            {
                x: -35, z: 38, scale: 5.5, rotY: 0.8, colorIdx: 2,
            },
            {
                x: 40, z: 40, scale: 7.0, rotY: 0.8, colorIdx: 0,
            },
            // LEFT EDGE framing rocks - at visible left lake edge (x=-100 to -140)
            {
                x: -105, z: 48, scale: 8.0, rotY: 0.9, colorIdx: 0,
            },
            {
                x: -120, z: 42, scale: 10.0, rotY: 1.5, colorIdx: 1,
            },
            {
                x: -110, z: 35, scale: 7.0, rotY: 2.2, colorIdx: 2,
            },
            {
                x: -130, z: 50, scale: 12.0, rotY: 0.4, colorIdx: 0,
            },
            {
                x: -115, z: 28, scale: 9.0, rotY: 1.8, colorIdx: 1,
            },
            {
                x: -140, z: 45, scale: 11.0, rotY: 0.6, colorIdx: 2,
            },
            // RIGHT EDGE framing rocks - at visible right lake edge (x=100 to 140)
            {
                x: 105, z: 45, scale: 8.0, rotY: 1.1, colorIdx: 0,
            },
            {
                x: 120, z: 40, scale: 10.0, rotY: 0.7, colorIdx: 1,
            },
            {
                x: 110, z: 32, scale: 7.5, rotY: 1.9, colorIdx: 2,
            },
            {
                x: 130, z: 52, scale: 12.0, rotY: 2.6, colorIdx: 0,
            },
            {
                x: 115, z: 25, scale: 9.0, rotY: 0.3, colorIdx: 1,
            },
            {
                x: 140, z: 48, scale: 11.0, rotY: 1.4, colorIdx: 2,
            },
            // LEFT DENSE SHORE ROCKS (foreground detail)
            {
                x: -85, z: 20, scale: 5.0, rotY: 0.5, colorIdx: 0,
            },
            {
                x: -95, z: 12, scale: 6.5, rotY: 1.8, colorIdx: 1,
            },
            {
                x: -88, z: 5, scale: 5.5, rotY: 2.5, colorIdx: 2,
            },
            {
                x: -100, z: -5, scale: 7.0, rotY: 0.9, colorIdx: 0,
            },
            // RIGHT DENSE SHORE ROCKS (foreground detail)
            {
                x: 85, z: 18, scale: 5.5, rotY: 1.2, colorIdx: 0,
            },
            {
                x: 95, z: 10, scale: 6.0, rotY: 2.1, colorIdx: 1,
            },
            {
                x: 88, z: 2, scale: 5.0, rotY: 0.3, colorIdx: 2,
            },
            {
                x: 100, z: -8, scale: 7.5, rotY: 1.6, colorIdx: 0,
            },
            // FAR SHORELINE STONES - where forest meets water (z around -10 to -18)
            {
                x: -25, z: -12, scale: 4.0, rotY: 0.7, colorIdx: 1,
            }, // Left of center, near logs
            {
                x: 30, z: -14, scale: 5.0, rotY: 1.4, colorIdx: 0,
            }, // Right of center, breaking up shore
        ];

        rockPositions.forEach((config) => {
            // ═══════════════════════════════════════════════════════════════════
            // ANGULAR BOULDER: Sharp edges, cracks, asymmetric shape
            // ═══════════════════════════════════════════════════════════════════

            // Higher subdivision (2) for more detail and sharper features
            const geometry = new THREE.IcosahedronGeometry(1, 2);

            const positions = geometry.attributes.position;

            // Random seed per rock for variety
            const seed = config.x * 0.1 + config.z * 0.2;

            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const z = positions.getZ(i);

                // ─── ANGULAR BOULDER DISTORTION ───
                // Large-scale asymmetric stretching (not uniform sphere)
                const stretchX = 0.9 + Math.sin(seed * 3.7) * 0.3; // 0.6 to 1.2
                const stretchZ = 0.85 + Math.cos(seed * 2.3) * 0.25; // 0.6 to 1.1

                // Sharp angular noise (not smooth sine waves)
                const angularNoise = (px, py, pz) => {
                    const n = Math.sin(px * 5.0 + seed) * Math.sin(py * 4.0 + pz * 3.0);
                    // Make it sharper by squaring and preserving sign
                    return Math.sign(n) * Math.abs(n) ** 0.5;
                };

                // Crack detection - sharp indentations
                const crackNoise = (px, py, pz) => {
                    const crack1 = Math.sin(px * 8.0 + py * 3.0 + seed * 2.0);
                    const crack2 = Math.sin(pz * 7.0 + px * 4.0 + seed * 1.5);
                    // Ridge function for sharp V-shaped cracks
                    const ridge = Math.abs(crack1 * crack2);
                    return ridge < 0.15 ? (0.15 - ridge) * 3.0 : 0; // Crack depth
                };

                // Facet-like bumps for angular appearance
                const facetNoise = Math.floor(Math.sin(x * 3.0 + y * 2.0 + z * 4.0 + seed) * 3) / 3;

                // Combine distortions
                const angular = angularNoise(x, y, z) * 0.2;
                const crack = crackNoise(x, y, z);
                const facet = facetNoise * 0.1;

                // Base scale with angular features
                const scale = 1.0 + angular + facet - crack * 0.25;

                // Apply asymmetric stretching
                let nx = x * scale * stretchX;
                const ny = y * scale * 0.5; // Flattened
                let nz = z * scale * stretchZ;

                // Add large-scale irregular bumps for boulder silhouette
                const bumpAngle = Math.atan2(z, x);
                const bump = Math.sin(bumpAngle * 3.0 + seed * 5.0) * 0.15;
                const bumpRadius = Math.sqrt(x * x + z * z);
                if (bumpRadius > 0.3) {
                    nx += Math.cos(bumpAngle) * bump * bumpRadius;
                    nz += Math.sin(bumpAngle) * bump * bumpRadius;
                }

                positions.setX(i, nx);
                positions.setY(i, ny);
                positions.setZ(i, nz);
            }

            geometry.computeVertexNormals();
            if (geometry.attributes.uv && !geometry.attributes.uv2) {
                geometry.setAttribute('uv2', geometry.attributes.uv.clone());
            }

            const material = this.rockMaterials[config.colorIdx % this.rockMaterials.length];

            const rock = new THREE.Mesh(geometry, material);
            rock.position.set(config.x, -0.3, config.z);
            rock.scale.setScalar(config.scale);
            rock.rotation.y = config.rotY;
            rock.rotation.x = (this.random() - 0.5) * 0.15; // Less random tilt
            rock.rotation.z = (this.random() - 0.5) * 0.1;
            rock.castShadow = true;
            rock.receiveShadow = true;

            this.shoreRocks.push(rock);
            this.mainGroup.add(rock);
        });

        console.log('[GoldenForest] Firewatch-style shore rocks created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHORE REEDS - Dried grass/reeds at the water's edge
    // ═══════════════════════════════════════════════════════════════════════════

    createShoreReeds() {
        if (!this.scene) return;

        this.shoreReeds = [];

        // Reed cluster positions along shore and lake edges
        // Visible lake edges are around x=±100-140, near shore around z=35-55
        const reedClusters = [
            // NEAR SHORE CENTER - visible along waterline
            {
                x: -25, z: 42, count: 14, height: 5.0,
            },
            {
                x: 30, z: 45, count: 16, height: 5.5,
            },
            {
                x: -45, z: 38, count: 12, height: 4.8,
            },
            {
                x: 50, z: 40, count: 14, height: 5.2,
            },
            {
                x: 5, z: 44, count: 10, height: 4.5,
            },
            // LEFT EDGE reeds - frame the left shoreline at visible edge
            {
                x: -100, z: 48, count: 18, height: 6.5,
            },
            {
                x: -115, z: 42, count: 16, height: 6.0,
            },
            {
                x: -105, z: 35, count: 14, height: 5.5,
            },
            {
                x: -125, z: 50, count: 20, height: 7.0,
            },
            {
                x: -110, z: 28, count: 15, height: 5.8,
            },
            // RIGHT EDGE reeds - frame the right shoreline at visible edge
            {
                x: 100, z: 45, count: 17, height: 6.2,
            },
            {
                x: 115, z: 40, count: 15, height: 5.8,
            },
            {
                x: 105, z: 32, count: 14, height: 5.5,
            },
            {
                x: 125, z: 52, count: 20, height: 7.0,
            },
            {
                x: 110, z: 25, count: 16, height: 6.0,
            },
        ];

        // Reed colors - dried golden brown
        const reedColors = [
            new THREE.Color(0x8A6A35),
            new THREE.Color(0x7A5A30),
            new THREE.Color(0x6A4A28),
        ];
        const reedNodeVariants = [];
        this.shoreReedNodeUniforms = [];
        if (this.isWebGPU) {
            reedColors.forEach((reedColor) => {
                const tipColor = reedColor.clone().offsetHSL(0, 0.05, 0.08);
                const reedNodeMaterial = createShoreReedNodeMaterial({
                    time: this.uniforms.time.value,
                    windStrength: 0.2,
                    baseColor: reedColor,
                    tipColor,
                    heightScale: 7.0,
                });
                reedNodeVariants.push(reedNodeMaterial);
                this.shoreReedNodeUniforms.push(reedNodeMaterial.uniforms);
            });
        }

        // ── InstancedMesh: batch reeds by color variant (~219 → 3 draw calls) ──
        // First pass: count reeds per color variant
        const reedCountPerColor = [0, 0, 0];
        const reedAssignments = []; // { clusterIdx, reedIdx, colorIdx, height, localX, localZ, rotX, rotZ }
        reedClusters.forEach((cluster, ci) => {
            for (let i = 0; i < cluster.count; i++) {
                const height = cluster.height * (0.7 + this.random() * 0.6);
                const colorIdx = Math.floor(this.random() * reedColors.length);
                const localX = (this.random() - 0.5) * 2.5;
                const localZ = (this.random() - 0.5) * 2.5;
                const rotX = (this.random() - 0.5) * 0.3;
                const rotZ = (this.random() - 0.5) * 0.3;
                reedCountPerColor[colorIdx]++;
                reedAssignments.push({
                    clusterX: cluster.x,
                    clusterZ: cluster.z,
                    colorIdx,
                    height,
                    localX,
                    localZ,
                    rotX,
                    rotZ,
                });
            }
        });

        // Reference cone geometry (unit height, will be scaled per-instance)
        const refHeight = 5.5; // Average reference height
        const refConeGeo = new THREE.ConeGeometry(0.03, refHeight, 4);
        refConeGeo.translate(0, refHeight / 2, 0);

        // Create one InstancedMesh per color variant
        this.shoreReedInstances = [];
        const instanceIndices = [0, 0, 0]; // Current index per color
        const instancedMeshes = [];

        for (let c = 0; c < 3; c++) {
            if (reedCountPerColor[c] === 0) continue;
            let material;
            if (this.isWebGPU) {
                material = reedNodeVariants[c].material;
            } else {
                material = new THREE.MeshBasicMaterial({
                    color: reedColors[c],
                    side: THREE.DoubleSide,
                });
            }
            const instancedMesh = new THREE.InstancedMesh(refConeGeo, material, reedCountPerColor[c]);
            instancedMeshes[c] = instancedMesh;
            this.shoreReedInstances.push(instancedMesh);
            this.mainGroup.add(instancedMesh);
        }

        // Second pass: set instance matrices
        const tempMatrix = new THREE.Matrix4();
        const rotMatrix = new THREE.Matrix4();
        const euler = new THREE.Euler();
        reedAssignments.forEach((reed) => {
            const c = reed.colorIdx;
            const idx = instanceIndices[c]++;
            const heightScale = reed.height / refHeight;

            // Build transform: position + rotation + height-scale
            euler.set(reed.rotX, 0, reed.rotZ);
            rotMatrix.makeRotationFromEuler(euler);
            tempMatrix.copy(rotMatrix);
            tempMatrix.scale(new THREE.Vector3(1, heightScale, 1));
            tempMatrix.setPosition(
                reed.clusterX + reed.localX,
                -0.5,
                reed.clusterZ + reed.localZ,
            );
            instancedMeshes[c].setMatrixAt(idx, tempMatrix);
        });

        // Finalize
        instancedMeshes.forEach((mesh) => {
            if (mesh) mesh.instanceMatrix.needsUpdate = true;
        });

        console.log('[GoldenForest] Shore reeds created (instanced)');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAKE FRAMING TREES - Dark silhouette trees at the lake edges
    // Creates visual containment so lake feels nestled in a forest clearing
    // ═══════════════════════════════════════════════════════════════════════════

    createLakeFramingTrees() {
        if (!this.scene) return;

        this.framingTrees = [];

        // Dark silhouette colors for framing trees (foreground, so darker)
        const treeColors = [
            new THREE.Color(0x150805), // Very dark (closest)
            new THREE.Color(0x1A0A06), // Dark
            new THREE.Color(0x200C08), // Medium dark
        ];
        const framingFoliageNodeMaterials = [];
        this.framingTreeFoliageNodeUniforms = [];
        this.framingTreeTrunkNodeUniforms = null;
        if (this.isWebGPU) {
            treeColors.forEach((treeColor) => {
                const foliageNodeMaterial = createFramingTreeFoliageNodeMaterial({
                    time: this.uniforms.time.value,
                    windStrength: 0.12,
                    baseColor: treeColor,
                    rimColor: new THREE.Color(0xB86C3A),
                    sunDirection: this.sunPosition.clone().normalize(),
                    heightScale: 40.0,
                    rimStrength: 0.08,
                });
                framingFoliageNodeMaterials.push(foliageNodeMaterial);
                this.framingTreeFoliageNodeUniforms.push(foliageNodeMaterial.uniforms);
            });

            const trunkNodeMaterial = createFramingTreeTrunkNodeMaterial({
                time: this.uniforms.time.value,
                windStrength: 0.08,
                baseColor: new THREE.Color(0x0A0402),
                heightScale: 12.0,
            });
            this.framingTreeTrunkNodeUniforms = trunkNodeMaterial.uniforms;
            this.framingTreeTrunkNodeMaterial = trunkNodeMaterial.material;
        } else {
            this.framingTreeTrunkNodeMaterial = null;
        }

        // Tree positions at left and right lake edges
        // Camera is at z=160, looking at z=-20.
        // We want these trees to act as an intimate, dark foreground frame.
        const treePositions = [
            // LEFT EDGE FRAMING TREES
            {
                x: -55, z: 155, height: 45, scale: 2.5, colorIdx: 0,
            },
            {
                x: -80, z: 145, height: 60, scale: 3.0, colorIdx: 1,
            },
            {
                x: -40, z: 162, height: 35, scale: 2.2, colorIdx: 0,
            },
            {
                x: -95, z: 135, height: 55, scale: 2.8, colorIdx: 2,
            },
            {
                x: -65, z: 150, height: 50, scale: 2.6, colorIdx: 1,
            },
            {
                x: -110, z: 125, height: 65, scale: 3.2, colorIdx: 0,
            },
            {
                x: -45, z: 148, height: 40, scale: 2.0, colorIdx: 2,
            },

            // RIGHT EDGE FRAMING TREES
            {
                x: 50, z: 158, height: 42, scale: 2.4, colorIdx: 0,
            },
            {
                x: 75, z: 148, height: 55, scale: 2.9, colorIdx: 1,
            },
            {
                x: 35, z: 165, height: 32, scale: 2.1, colorIdx: 0,
            },
            {
                x: 90, z: 138, height: 50, scale: 2.7, colorIdx: 2,
            },
            {
                x: 60, z: 152, height: 48, scale: 2.5, colorIdx: 1,
            },
            {
                x: 105, z: 128, height: 60, scale: 3.1, colorIdx: 0,
            },
            {
                x: 42, z: 150, height: 38, scale: 1.9, colorIdx: 2,
            },
        ];

        treePositions.forEach((config) => {
            // Create simple spruce silhouette (Firewatch-style cone shape)
            const treeGroup = new THREE.Group();

            // Trunk
            const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, config.height * 0.25, 6);
            const trunkMat = this.isWebGPU
                ? this.framingTreeTrunkNodeMaterial
                : new THREE.MeshBasicMaterial({
                    color: new THREE.Color(0x0A0402),
                });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = config.height * 0.125;
            treeGroup.add(trunk);

            // Create layered foliage cones for spruce look
            const numLayers = 4;
            for (let i = 0; i < numLayers; i++) {
                const layerHeight = config.height * (0.3 - i * 0.05);
                const layerRadius = config.height * (0.22 - i * 0.04);
                const layerY = config.height * (0.2 + i * 0.2);

                const coneGeo = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
                const coneMat = this.isWebGPU
                    ? framingFoliageNodeMaterials[config.colorIdx].material
                    : new THREE.MeshBasicMaterial({
                        color: treeColors[config.colorIdx],
                    });
                const cone = new THREE.Mesh(coneGeo, coneMat);
                cone.position.y = layerY;
                treeGroup.add(cone);
            }

            // Position and scale
            treeGroup.position.set(config.x, -0.5, config.z);
            treeGroup.scale.setScalar(config.scale);
            treeGroup.rotation.y = this.random() * Math.PI * 0.5;

            this.framingTrees.push(treeGroup);
            this.mainGroup.add(treeGroup);
        });

        console.log('[GoldenForest] Lake framing trees created');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GLOWING MUSHROOMS - Bioluminescent fungi
    // ═══════════════════════════════════════════════════════════════════════════

    createGlowingMushrooms() {
        this.mushrooms = [];
        this.mushroomLights = [];

        // Mushroom positions - scattered around the forest floor
        // Hue 0.03-0.08 = warm orange/amber for sunset atmosphere
        const mushroomData = [
            {
                x: -8, z: 2, scale: 0.4, hue: 0.05,
            },
            {
                x: 12, z: -5, scale: 0.5, hue: 0.07,
            },
            {
                x: -15, z: -8, scale: 0.35, hue: 0.04,
            },
            {
                x: 5, z: 5, scale: 0.45, hue: 0.06,
            },
            {
                x: -3, z: -3, scale: 0.3, hue: 0.05,
            },
            {
                x: 18, z: 0, scale: 0.4, hue: 0.08,
            },
            {
                x: -20, z: 3, scale: 0.5, hue: 0.03,
            },
            {
                x: 8, z: 8, scale: 0.35, hue: 0.06,
            },
            {
                x: -12, z: 6, scale: 0.4, hue: 0.07,
            },
            {
                x: 15, z: -10, scale: 0.45, hue: 0.05,
            },
        ];

        mushroomData.forEach((data, idx) => {
            // Create mushroom geometry - cap and stem
            const capGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
            const stemGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 6);

            // Bioluminescent material with emissive glow
            const glowColor = new THREE.Color().setHSL(data.hue, 0.8, 0.5);
            const emissiveColor = new THREE.Color().setHSL(data.hue, 0.9, 0.4);

            const capMat = new THREE.MeshStandardMaterial({
                color: glowColor,
                emissive: emissiveColor,
                emissiveIntensity: 1.5,
                roughness: 0.3,
                metalness: 0.1,
                transparent: true,
                opacity: 0.9,
            });

            const stemMat = new THREE.MeshStandardMaterial({
                color: 0x4a3a2a, // Warm brown stem
                emissive: emissiveColor,
                emissiveIntensity: 0.3,
                roughness: 0.8,
            });

            const cap = new THREE.Mesh(capGeo, capMat);
            cap.scale.y = 0.5; // Flatten the cap
            cap.position.y = 0.6;

            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.y = 0.3;

            // Group mushroom parts
            const mushroom = new THREE.Group();
            mushroom.add(cap);
            mushroom.add(stem);

            mushroom.position.set(data.x, -0.5, data.z);
            mushroom.scale.setScalar(data.scale);
            mushroom.rotation.y = this.random() * Math.PI * 2;

            // Store for animation
            mushroom.userData = {
                baseEmissive: 1.5,
                phase: idx * 0.7,
                capMat,
            };

            this.mushrooms.push(mushroom);
            this.mainGroup.add(mushroom);

            // PointLights removed for performance — emissive cap material provides the glow
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAYERED SPRUCE TREES - InstancedMesh Optimization (2 draw calls vs 400+)
    // ═══════════════════════════════════════════════════════════════════════════

    createTrees() {
        // Layer configurations - trees arranged by depth (Firewatch-style layers)
        // BACK TREES: Far side of lake, all at z < -40
        const layers = [
            {
                count: 150, z: -42, height: 18, spacing: 3, colorIdx: 0, sway: 0.25,
            }, // Front tree line (dark, dense)
            {
                count: 140, z: -48, height: 22, spacing: 3.5, colorIdx: 0, sway: 0.22,
            }, // Dense dark layer
            {
                count: 130, z: -55, height: 26, spacing: 4, colorIdx: 1, sway: 0.20,
            }, // Mid layer
            {
                count: 120, z: -62, height: 30, spacing: 4.5, colorIdx: 2, sway: 0.18,
            }, // Mid-back
            {
                count: 100, z: -70, height: 35, spacing: 5, colorIdx: 3, sway: 0.15,
            }, // Back layer
            {
                count: 80, z: -80, height: 42, spacing: 6, colorIdx: 4, sway: 0.12,
            }, // Far back
            {
                count: 60, z: -92, height: 50, spacing: 8, colorIdx: 5, sway: 0.10,
            }, // Horizon
        ];

        // SIDE FRAMING TREES: Wrap around left and right edges of lake
        // These trees extend forward to frame the visible lake area
        const sideFramingTrees = [
            // LEFT SIDE - Trees coming forward along left edge
            {
                x: -140, z: 50, height: 22, colorIdx: 0,
            },
            {
                x: -145, z: 40, height: 26, colorIdx: 0,
            },
            {
                x: -135, z: 30, height: 20, colorIdx: 0,
            },
            {
                x: -150, z: 45, height: 28, colorIdx: 0,
            },
            {
                x: -140, z: 20, height: 24, colorIdx: 0,
            },
            {
                x: -155, z: 35, height: 30, colorIdx: 0,
            },
            {
                x: -145, z: 10, height: 22, colorIdx: 0,
            },
            {
                x: -160, z: 50, height: 32, colorIdx: 0,
            },
            {
                x: -135, z: 0, height: 20, colorIdx: 0,
            },
            {
                x: -150, z: -10, height: 25, colorIdx: 0,
            },
            {
                x: -140, z: -20, height: 23, colorIdx: 0,
            },
            {
                x: -155, z: -30, height: 27, colorIdx: 0,
            },
            // LEFT SHORE DENSE AREA (matching right side)
            // Smaller, closer trees for foreground density
            {
                x: -95, z: 25, height: 16, colorIdx: 0,
            },
            {
                x: -100, z: 18, height: 18, colorIdx: 0,
            },
            {
                x: -105, z: 10, height: 15, colorIdx: 0,
            },
            {
                x: -110, z: 22, height: 17, colorIdx: 0,
            },
            {
                x: -98, z: 5, height: 14, colorIdx: 0,
            },
            {
                x: -115, z: 15, height: 19, colorIdx: 0,
            },
            {
                x: -102, z: -5, height: 16, colorIdx: 0,
            },
            {
                x: -120, z: 8, height: 18, colorIdx: 0,
            },
            {
                x: -108, z: -12, height: 15, colorIdx: 0,
            },
            {
                x: -125, z: 0, height: 20, colorIdx: 0,
            },
            {
                x: -112, z: -20, height: 17, colorIdx: 0,
            },
            {
                x: -118, z: -28, height: 19, colorIdx: 0,
            },
            {
                x: -105, z: -35, height: 16, colorIdx: 0,
            },
            {
                x: -122, z: -38, height: 21, colorIdx: 0,
            },
            {
                x: -130, z: -25, height: 22, colorIdx: 0,
            },
            {
                x: -128, z: -15, height: 20, colorIdx: 0,
            },
            // RIGHT SIDE - Trees coming forward along right edge
            {
                x: 140, z: 48, height: 21, colorIdx: 0,
            },
            {
                x: 145, z: 38, height: 25, colorIdx: 0,
            },
            {
                x: 135, z: 28, height: 19, colorIdx: 0,
            },
            {
                x: 150, z: 42, height: 27, colorIdx: 0,
            },
            {
                x: 140, z: 18, height: 23, colorIdx: 0,
            },
            {
                x: 155, z: 32, height: 29, colorIdx: 0,
            },
            {
                x: 145, z: 8, height: 21, colorIdx: 0,
            },
            {
                x: 160, z: 48, height: 31, colorIdx: 0,
            },
            {
                x: 135, z: -2, height: 19, colorIdx: 0,
            },
            {
                x: 150, z: -12, height: 24, colorIdx: 0,
            },
            {
                x: 140, z: -22, height: 22, colorIdx: 0,
            },
            {
                x: 155, z: -32, height: 26, colorIdx: 0,
            },
            // RIGHT SHORE DENSE AREA (user's green marked region)
            // Smaller, closer trees for foreground density
            {
                x: 95, z: 25, height: 16, colorIdx: 0,
            },
            {
                x: 100, z: 18, height: 18, colorIdx: 0,
            },
            {
                x: 105, z: 10, height: 15, colorIdx: 0,
            },
            {
                x: 110, z: 22, height: 17, colorIdx: 0,
            },
            {
                x: 98, z: 5, height: 14, colorIdx: 0,
            },
            {
                x: 115, z: 15, height: 19, colorIdx: 0,
            },
            {
                x: 102, z: -5, height: 16, colorIdx: 0,
            },
            {
                x: 120, z: 8, height: 18, colorIdx: 0,
            },
            {
                x: 108, z: -12, height: 15, colorIdx: 0,
            },
            {
                x: 125, z: 0, height: 20, colorIdx: 0,
            },
            {
                x: 112, z: -20, height: 17, colorIdx: 0,
            },
            {
                x: 118, z: -28, height: 19, colorIdx: 0,
            },
            {
                x: 105, z: -35, height: 16, colorIdx: 0,
            },
            {
                x: 122, z: -38, height: 21, colorIdx: 0,
            },
            {
                x: 130, z: -25, height: 22, colorIdx: 0,
            },
            {
                x: 128, z: -15, height: 20, colorIdx: 0,
            },
        ];

        // Calculate total tree count (layers + side framing trees)
        const layerTreeCount = layers.reduce((sum, layer) => sum + layer.count, 0);
        const totalTreeCount = layerTreeCount + sideFramingTrees.length;
        console.log(`[GoldenForest] Creating ${totalTreeCount} trees(${layerTreeCount} layered + ${sideFramingTrees.length} side framing)`);

        // Generate ONE merged spruce geometry (foliage + trunk will be separate)
        const { foliageGeometry, trunkGeometry } = this.createMergedSpruceGeometry();

        // Create per-instance attribute arrays
        const instanceColors = new Float32Array(totalTreeCount * 3);
        const instanceSways = new Float32Array(totalTreeCount);
        const instancePhases = new Float32Array(totalTreeCount);
        const instanceWindOffsets = new Float32Array(totalTreeCount);
        const trunkColors = new Float32Array(totalTreeCount * 3);

        // Create instanced meshes
        let foliageMaterial;
        let trunkMaterial;
        this.foliageNodeUniforms = null;
        this.trunkNodeUniforms = null;

        if (this.isWebGPU) {
            const foliageNodeMaterial = createInstancedFoliageNodeMaterial({
                time: this.uniforms.time.value,
                glowIntensity: this.uniforms.glowIntensity.value,
                windStrength: 0.24,
                sunDirection: this.sunPosition.clone().normalize(),
                rimColor: new THREE.Color(0xA35A2E),
                glowColor: new THREE.Color(0xffb067),
                rimStrength: 0.08,
                alphaNearCutoff: 0.0,
                alphaFarCutoff: 0.0,
            });
            foliageMaterial = foliageNodeMaterial.material;
            this.foliageNodeUniforms = foliageNodeMaterial.uniforms;

            const trunkNodeMaterial = createInstancedTrunkNodeMaterial({
                time: this.uniforms.time.value,
                glowIntensity: this.uniforms.glowIntensity.value,
                windStrength: 0.16,
                glowColor: new THREE.Color(0xff8f5a),
            });
            trunkMaterial = trunkNodeMaterial.material;
            this.trunkNodeUniforms = trunkNodeMaterial.uniforms;
        } else {
            foliageMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: this.uniforms.time,
                    uGlowIntensity: this.uniforms.glowIntensity,
                },
                vertexShader: instancedFoliageVertexShader,
                fragmentShader: instancedFoliageFragmentShader,
                side: THREE.DoubleSide,
            });

            trunkMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uGlowIntensity: this.uniforms.glowIntensity,
                },
                vertexShader: instancedTrunkVertexShader,
                fragmentShader: instancedTrunkFragmentShader,
            });
        }

        this.foliageInstancedMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, totalTreeCount);
        this.trunkInstancedMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTreeCount);

        // Set up transforms and per-instance data
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        let instanceIdx = 0;

        layers.forEach((layer) => {
            // Use layer.colorIdx to look up color (allows multiple layers to share colors)
            const treeColor = COLORS.treeLayers[layer.colorIdx];
            const trunkColor = COLORS.trunkLayers[layer.colorIdx];

            for (let i = 0; i < layer.count; i++) {
                const x = (i - layer.count / 2) * layer.spacing + (this.random() - 0.5) * 5;
                const z = layer.z + (this.random() - 0.5) * 3;
                const y = 0;

                // Random scale variation
                const scaleVal = 0.7 + this.random() * 0.5;
                const heightScale = layer.height / 20; // Normalize to base height of 20

                position.set(x, y, z);
                quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (this.random() - 0.5) * 0.2);

                // ─────────────────────────────────────────────────────────────
                // LAKE CLEARING LOGIC (ellipse-based)
                // Clear trees inside the elliptical lake zone, but keep trees behind
                // Reduced size to allow more trees around lake edges (Firewatch style)
                // ─────────────────────────────────────────────────────────────
                const lakeCenter = { x: 0, z: -15 }; // Moved center forward slightly
                const lakeRadiusX = 90; // Reduced from 130 for denser tree framing
                const lakeRadiusZ = 35; // Reduced from 50

                // Ellipse distance formula
                const dx = (x - lakeCenter.x) / lakeRadiusX;
                const dz = (z - lakeCenter.z) / lakeRadiusZ;
                const ellipseDist = dx * dx + dz * dz;

                // STRICTLY clear everything inside the lake water area
                const inLakeZone = ellipseDist < 1.0;

                if (inLakeZone) {
                    scale.set(0, 0, 0); // Hide tree
                } else {
                    scale.set(scaleVal, scaleVal * heightScale, scaleVal);
                }

                matrix.compose(position, quaternion, scale);
                this.foliageInstancedMesh.setMatrixAt(instanceIdx, matrix);
                this.trunkInstancedMesh.setMatrixAt(instanceIdx, matrix);

                // Per-instance color (foliage)
                instanceColors[instanceIdx * 3] = treeColor.r;
                instanceColors[instanceIdx * 3 + 1] = treeColor.g;
                instanceColors[instanceIdx * 3 + 2] = treeColor.b;

                // Per-instance trunk color
                trunkColors[instanceIdx * 3] = trunkColor.r;
                trunkColors[instanceIdx * 3 + 1] = trunkColor.g;
                trunkColors[instanceIdx * 3 + 2] = trunkColor.b;

                // Per-instance sway amount
                instanceSways[instanceIdx] = layer.sway;

                // Per-instance random phase for wind variation
                instancePhases[instanceIdx] = this.random() * Math.PI * 2;
                // Shared world-space wind offset so nearby trees sway coherently.
                instanceWindOffsets[instanceIdx] = x * 0.15 + z * 0.1;

                instanceIdx++;
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // SIDE FRAMING TREES - Place trees at specific positions along lake edges
        // These create the visual "forest wrapping around the lake" effect
        // ─────────────────────────────────────────────────────────────────────
        const darkestTreeColor = COLORS.treeLayers[0]; // Use darkest color for foreground trees
        const darkestTrunkColor = COLORS.trunkLayers[0];

        sideFramingTrees.forEach((tree) => {
            const x = tree.x + (this.random() - 0.5) * 5;
            const z = tree.z + (this.random() - 0.5) * 3;
            const y = 0;

            // Scale based on height
            const scaleVal = 0.8 + this.random() * 0.4;
            const heightScale = tree.height / 20;

            position.set(x, y, z);
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (this.random() - 0.5) * 0.3);
            scale.set(scaleVal, scaleVal * heightScale, scaleVal);

            matrix.compose(position, quaternion, scale);
            this.foliageInstancedMesh.setMatrixAt(instanceIdx, matrix);
            this.trunkInstancedMesh.setMatrixAt(instanceIdx, matrix);

            // Use darkest color for foreground framing trees
            instanceColors[instanceIdx * 3] = darkestTreeColor.r;
            instanceColors[instanceIdx * 3 + 1] = darkestTreeColor.g;
            instanceColors[instanceIdx * 3 + 2] = darkestTreeColor.b;

            trunkColors[instanceIdx * 3] = darkestTrunkColor.r;
            trunkColors[instanceIdx * 3 + 1] = darkestTrunkColor.g;
            trunkColors[instanceIdx * 3 + 2] = darkestTrunkColor.b;

            instanceSways[instanceIdx] = 0.20; // Moderate sway
            instancePhases[instanceIdx] = this.random() * Math.PI * 2;
            instanceWindOffsets[instanceIdx] = x * 0.15 + z * 0.1;

            instanceIdx++;
        });

        // Set up instanced buffer attributes
        foliageGeometry.setAttribute(
            'aInstanceColor',
            new THREE.InstancedBufferAttribute(instanceColors, 3),
        );
        foliageGeometry.setAttribute(
            'aInstanceSway',
            new THREE.InstancedBufferAttribute(instanceSways, 1),
        );
        foliageGeometry.setAttribute(
            'aInstancePhase',
            new THREE.InstancedBufferAttribute(instancePhases, 1),
        );
        foliageGeometry.setAttribute(
            'aInstanceWindOffset',
            new THREE.InstancedBufferAttribute(instanceWindOffsets, 1),
        );

        trunkGeometry.setAttribute(
            'aInstanceColor',
            new THREE.InstancedBufferAttribute(trunkColors, 3),
        );
        trunkGeometry.setAttribute(
            'aInstanceSway',
            new THREE.InstancedBufferAttribute(instanceSways, 1),
        );
        trunkGeometry.setAttribute(
            'aInstancePhase',
            new THREE.InstancedBufferAttribute(instancePhases, 1),
        );
        trunkGeometry.setAttribute(
            'aInstanceWindOffset',
            new THREE.InstancedBufferAttribute(instanceWindOffsets, 1),
        );

        this.foliageInstancedMesh.instanceMatrix.needsUpdate = true;
        this.trunkInstancedMesh.instanceMatrix.needsUpdate = true;

        this.mainGroup.add(this.trunkInstancedMesh);
        this.mainGroup.add(this.foliageInstancedMesh);

        console.log(`[GoldenForest] Trees created: ${totalTreeCount} instances(2 draw calls)`);
    }

    /**
     * Create a merged spruce tree geometry with all foliage layers combined
     * This geometry is shared across all instances
     */
    createMergedSpruceGeometry() {
        const foliageLayers = [];
        const numLayers = 5; // 5 layers of cones
        const baseHeight = 20; // Normalized base height
        const trunkHeight = baseHeight * 0.15;
        const maxRadius = baseHeight * 0.25; // Base width of the widest cone

        // Create foliage layers (Cones)
        for (let j = 0; j < numLayers; j++) {
            // Tapering logic: Bottom layer is widest, top is narrowest
            const layerProgress = j / (numLayers - 1); // 0 at bottom, 1 at top

            const bottomRadius = maxRadius * (1.0 - layerProgress * 0.8);
            const coneHeight = (baseHeight / numLayers) * 1.8; // Overlap layers

            // Position: Stack them up
            const y = trunkHeight + (j * (baseHeight * 0.85 / numLayers));

            // Create 3D Cone for this layer
            // radialSegments: 7 for a nice low-poly geometric look, or 16 for smooth
            const geometry = new THREE.ConeGeometry(bottomRadius, coneHeight, 7);

            // Translate to correct position (Cone origin is at center)
            geometry.translate(0, y + coneHeight / 2, 0);

            foliageLayers.push(geometry);
        }

        // Merge all foliage layers into one geometry
        const foliageGeometry = BufferGeometryUtils.mergeGeometries(foliageLayers, false);

        // Compute normals for proper 3D lighting
        foliageGeometry.computeVertexNormals();

        // Create trunk geometry (cylinder)
        const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.4, trunkHeight, 6);
        trunkGeometry.translate(0, trunkHeight / 2, 0);
        trunkGeometry.computeVertexNormals();

        // Clean up individual layer geometries
        foliageLayers.forEach((geo) => geo.dispose());

        return { foliageGeometry, trunkGeometry };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MIST LAYERS - Atmospheric ground fog
    // ═══════════════════════════════════════════════════════════════════════════

    createMistLayers() {
        this.mistNodeUniforms = [];
        const mistConfigs = [
            // Distant mist at tree line
            {
                y: 7, z: -35, width: 2500, height: 18, density: 0.4,
            },
            {
                y: 5, z: -15, width: 2500, height: 15, density: 0.35,
            },
            // Mid-ground lake mist
            {
                y: 3, z: 20, width: 2500, height: 12, density: 0.3,
            },
            {
                y: 2, z: 60, width: 2500, height: 10, density: 0.25,
            },
            // Foreground lake mist
            {
                y: 1.5, z: 100, width: 2500, height: 8, density: 0.2,
            },
            {
                y: 1.0, z: 140, width: 2500, height: 6, density: 0.15,
            },
        ];

        for (const config of mistConfigs) {
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            let material;
            if (this.isWebGPU) {
                const nodeMist = createMistNodeMaterial({
                    time: this.uniforms.time.value,
                    density: config.density,
                    mistColor: COLORS.mist.clone(),
                    intensity: this.uniforms.mistIntensity.value,
                });
                material = nodeMist.material;
                this.mistNodeUniforms.push(nodeMist.uniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uDensity: { value: config.density },
                        uMistColor: { value: COLORS.mist },
                        uIntensity: this.uniforms.mistIntensity,
                    },
                    vertexShader: mistVertexShader,
                    fragmentShader: mistFragmentShader,
                    transparent: true,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, config.y, config.z);
            mist.rotation.x = -0.15;

            this.mistPlanes.push(mist);
            this.mainGroup.add(mist);
        }
    }

    createStylizedClouds() {
        // Firewatch-style cloud cards layered into the upper sky
        this.clouds = [];
        this.cloudMaterials = [];
        this.cloudNodeUniforms = [];

        const cloudFog = COLORS.cloud.fog;
        const cloudBase = COLORS.cloud.base;
        const cloudHighlight = COLORS.cloud.highlight;

        const cloudLayers = [
            {
                size: new THREE.Vector2(700, 140),
                position: new THREE.Vector3(-10, 88, -340),
                color: cloudBase.clone().lerp(cloudFog, 0.4),
                highlight: cloudHighlight.clone().lerp(cloudFog, 0.5),
                opacity: 0.12,
                noiseScale: 1.05,
                softness: 0.42,
                coverage: 0.52,
                drift: new THREE.Vector2(0.0011, 0.0002),
                seed: 1.2,
            },
            {
                size: new THREE.Vector2(600, 110),
                position: new THREE.Vector3(18, 76, -270),
                color: cloudBase.clone().lerp(cloudFog, 0.25),
                highlight: cloudHighlight.clone().lerp(cloudFog, 0.35),
                opacity: 0.17,
                noiseScale: 1.2,
                softness: 0.35,
                coverage: 0.49,
                drift: new THREE.Vector2(0.0018, 0.0003),
                seed: 2.6,
            },
            {
                size: new THREE.Vector2(520, 90),
                position: new THREE.Vector3(-32, 64, -220),
                color: cloudBase.clone().lerp(cloudFog, 0.1),
                highlight: cloudHighlight.clone().lerp(cloudFog, 0.2),
                opacity: 0.22,
                noiseScale: 1.35,
                softness: 0.3,
                coverage: 0.46,
                drift: new THREE.Vector2(0.0026, 0.0004),
                seed: 4.1,
            },
        ];

        cloudLayers.forEach((layer, index) => {
            const geometry = new THREE.PlaneGeometry(layer.size.x, layer.size.y, 1, 1);

            let material = null;
            if (this.isWebGPU) {
                const nodeCloud = createCloudNodeMaterial({
                    time: this.uniforms.time.value,
                    cloudColor: layer.color.clone(),
                    highlightColor: layer.highlight.clone(),
                    fogColor: cloudFog.clone(),
                    opacity: layer.opacity,
                    noiseScale: layer.noiseScale,
                    softness: layer.softness,
                    coverage: layer.coverage,
                    drift: layer.drift.clone(),
                    seed: layer.seed,
                    fogStart: 100,
                    fogEnd: 420,
                });
                material = nodeCloud.material;
                this.cloudNodeUniforms.push(nodeCloud.uniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uCloudColor: { value: layer.color },
                        uHighlightColor: { value: layer.highlight },
                        uFogColor: { value: cloudFog },
                        uOpacity: { value: layer.opacity },
                        uNoiseScale: { value: layer.noiseScale },
                        uSoftness: { value: layer.softness },
                        uCoverage: { value: layer.coverage },
                        uDrift: { value: layer.drift },
                        uSeed: { value: layer.seed },
                        uFogStart: { value: 100 },
                        uFogEnd: { value: 420 },
                    },
                    vertexShader: cloudCardVertexShader,
                    fragmentShader: cloudCardFragmentShader,
                    transparent: true,
                    premultipliedAlpha: true,
                    depthWrite: false,
                    blending: THREE.NormalBlending,
                    alphaTest: 0.02,
                    side: THREE.DoubleSide,
                });
            }

            const cloud = new THREE.Mesh(geometry, material);
            cloud.position.copy(layer.position);
            cloud.quaternion.copy(this.camera.quaternion);
            cloud.renderOrder = -35 + index;

            this.scene.add(cloud);
            this.clouds.push(cloud);
            this.cloudMaterials.push(material);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOD RAYS - Advanced volumetric light shafts from sun
    // ═══════════════════════════════════════════════════════════════════════════

    createGodRays() {
        // Large plane covering entire view with volumetric god ray shader
        // Position FORWARD of trees so rays overlay the scene
        const width = 800; // Scaled up massive size to cover full width from sun
        const height = 450;
        const geometry = new THREE.PlaneGeometry(width, height);

        // Create volumetric god ray material using advanced shader
        this.godRayNodeUniforms = null;
        if (this.isWebGPU) {
            const nodeGodRays = createGodRayNodeMaterial({
                time: this.uniforms.time.value,
                opacity: 0.35, // Stronger presence
                rayColor: new THREE.Color(0xFFBB44), // Warmer golden rays
                sunScreenPos: new THREE.Vector2(0.5, 0.5),
                emissiveStrength: 1.6, // Brighter rays
            });
            this.godRayMaterial = nodeGodRays.material;
            this.godRayNodeUniforms = nodeGodRays.uniforms;
        } else {
            this.godRayMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0.35 },
                    uSunPosition: { value: this.sunPosition.clone() },
                    uSunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
                    uRayColor: { value: new THREE.Color(0xFFBB44) },
                    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                },
                vertexShader: godRayVertexShader,
                fragmentShader: godRayFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: false, // Ignore depth - render on top of everything
                side: THREE.DoubleSide,
            });
        }

        const godRayPlane = new THREE.Mesh(geometry, this.godRayMaterial);
        godRayPlane.userData.phase2BloomEmitter = true;

        // Position plane slightly in front of the sun
        godRayPlane.position.copy(this.sunPosition);
        godRayPlane.position.z += 20; // Place slightly in front

        // Face the camera
        godRayPlane.rotation.x = 0;

        // Very high render order to draw after everything else
        godRayPlane.renderOrder = 999;

        this.godRays.push(godRayPlane);
        this.scene.add(godRayPlane);

        console.log('[GoldenForest] Created advanced volumetric god rays (overlay mode)');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIREFLIES - Glowing particle system
    // ═══════════════════════════════════════════════════════════════════════════

    createFireflySystem() {
        // Many fireflies distributed across scene INCLUDING deep in forest between trees
        const fireflyCount = this.qualityPreset?.fireflyCount ?? 200;
        if (fireflyCount <= 0) return;

        if (this.isWebGPU) {
            this.fireflyNodes = [];
            const nodeFirefly = createFireflyNodeMaterial({
                time: this.uniforms.time.value,
                boost: 0.0,
                baseColor: new THREE.Color(0xFFAA44),
                tipColor: new THREE.Color(0xFFE7A0),
            });
            this.fireflyNodeUniforms = nodeFirefly.uniforms;
            this.fireflyBoostUniform = nodeFirefly.uniforms.uBoost;

            const fireflyGeometry = new THREE.PlaneGeometry(1, 1);

            // ── InstancedMesh: single draw call for all fireflies ──
            const instancedMesh = new THREE.InstancedMesh(fireflyGeometry, nodeFirefly.material, fireflyCount);
            instancedMesh.renderOrder = 130;

            // Pre-compute per-instance positions and scales
            this.fireflyInstanceData = new Float32Array(fireflyCount * 4); // x, y, z, scale
            const tempMatrix = new THREE.Matrix4();

            for (let i = 0; i < fireflyCount; i++) {
                const gridX = (i % 20) / 19;
                const gridZ = Math.floor(i / 20) / 9;
                const randOffsetX = (this.random() - 0.5) * 25;
                const randOffsetZ = (this.random() - 0.5) * 18;

                const px = -250 + gridX * 500 + randOffsetX;
                const py = 1 + this.random() * 30;
                const pz = -120 + gridZ * 140 + randOffsetZ;
                const scale = 0.7 + this.random() * 1.4;

                const i4 = i * 4;
                this.fireflyInstanceData[i4] = px;
                this.fireflyInstanceData[i4 + 1] = py;
                this.fireflyInstanceData[i4 + 2] = pz;
                this.fireflyInstanceData[i4 + 3] = scale;

                tempMatrix.makeScale(scale, scale, 1);
                tempMatrix.setPosition(px, py, pz);
                instancedMesh.setMatrixAt(i, tempMatrix);
            }
            instancedMesh.instanceMatrix.needsUpdate = true;

            this.fireflyInstancedMesh = instancedMesh;
            this.fireflySystem = instancedMesh;
            this.mainGroup.add(instancedMesh);
            return;
        }

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(fireflyCount * 3);
        const randoms = new Float32Array(fireflyCount);
        const phases = new Float32Array(fireflyCount);
        const velocities = new Float32Array(fireflyCount * 3);

        for (let i = 0; i < fireflyCount; i++) {
            const i3 = i * 3;

            // Distribute evenly across the FULL scene width
            // Grid covers more width and depth
            const gridX = (i % 20) / 19; // 0 to 1 across 20 columns
            const gridZ = Math.floor(i / 20) / 9; // 0 to 1 across 10 rows

            // Add randomness to grid positions for natural look
            const randOffsetX = (this.random() - 0.5) * 25;
            const randOffsetZ = (this.random() - 0.5) * 18;

            // Map to scene coordinates - extend deeper and WIDER
            // Width: 500 units (-250 to +250)
            positions[i3] = -250 + gridX * 500 + randOffsetX; // x: -250 to +250
            positions[i3 + 1] = 1 + this.random() * 30; // y: 1 to 31
            positions[i3 + 2] = -120 + gridZ * 140 + randOffsetZ; // z: -120 to +20

            randoms[i] = this.random();
            phases[i] = this.random() * Math.PI * 2;

            // Gentle local movement (won't drift far from starting position)
            velocities[i3] = (this.random() - 0.5) * 0.4; // Gentle X drift
            velocities[i3 + 1] = (this.random() - 0.5) * 0.15; // Very gentle Y
            velocities[i3 + 2] = (this.random() - 0.5) * 0.2; // Gentle Z drift
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uSize: { value: 5.0 }, // Slightly larger for visibility across scene
                uBoost: { value: 0.0 }, // Boost from piece lock effect
            },
            vertexShader: fireflyVertexShader,
            fragmentShader: fireflyFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.fireflyNodeUniforms = null;
        this.fireflyNodes = [];
        this.fireflyBoostUniform = material.uniforms.uBoost;
        this.fireflySystem = new THREE.Points(geometry, material);
        this.mainGroup.add(this.fireflySystem);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FOREST SPIRITS - Ethereal orbs spread across the entire scene
    // ═══════════════════════════════════════════════════════════════════════════

    createForestSpirits() {
        // More spirits distributed across the entire scene, deep in forest and high in sky
        const spiritCount = this.qualityPreset?.spiritCount ?? 45;
        if (spiritCount <= 0) return;
        this.spiritNodeUniforms = [];

        for (let i = 0; i < spiritCount; i++) {
            // Varied sizes - some small, some larger
            const size = 0.8 + this.random() * 2.5;
            const geometry = new THREE.PlaneGeometry(size, size);

            // Vary hue for each spirit - warm amber/golden for sunset
            const hueShift = (this.random() - 0.5) * 0.1;
            const spiritColor = new THREE.Color().setHSL(
                0.08 + hueShift, // Warm amber hue
                0.8 + this.random() * 0.15,
                0.6 + this.random() * 0.15,
            );

            let material;
            let nodeUniforms = null;
            if (this.isWebGPU) {
                const nodeSpirit = createSpiritNodeMaterial({
                    time: this.uniforms.time.value,
                    opacity: 0.25 + this.random() * 0.3,
                    spiritColor,
                });
                material = nodeSpirit.material;
                nodeUniforms = nodeSpirit.uniforms;
                this.spiritNodeUniforms.push(nodeUniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uOpacity: { value: 0.25 + this.random() * 0.3 },
                        uSpiritColor: { value: spiritColor },
                    },
                    vertexShader: spiritVertexShader,
                    fragmentShader: spiritFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const spirit = new THREE.Mesh(geometry, material);

            // Spread across FULL scene width and height
            spirit.position.set(
                (this.random() - 0.5) * 500, // Very wide horizontal spread (-250 to 250)
                3 + this.random() * 52, // From near ground to high above canopy
                -120 + this.random() * 140, // Deep forest (-120) to lake (+20)
            );

            spirit.userData = {
                basePosition: spirit.position.clone(),
                targetX: spirit.position.x,
                targetY: spirit.position.y,
                velocity: new THREE.Vector2(0, 0),
                wanderPhase: this.random() * 100,
                wanderSpeed: 0.3 + this.random() * 0.4, // Varied wander speeds
                nodeUniforms,
            };

            spirit.lookAt(this.camera.position);

            this.spirits.push(spirit);
            this.mainGroup.add(spirit);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA BOREALIS - Combo effect in sky
    // ═══════════════════════════════════════════════════════════════════════════

    createAuroraLayers() {
        const auroraConfigs = [
            {
                offset: 0, color1: COLORS.aurora1, color2: COLORS.aurora2, color3: COLORS.aurora3,
            },
            {
                offset: 1.5, color1: COLORS.aurora2, color2: COLORS.aurora3, color3: COLORS.aurora1,
            },
            {
                offset: 3.0, color1: COLORS.aurora3, color2: COLORS.aurora1, color3: COLORS.aurora2,
            },
        ];

        for (const config of auroraConfigs) {
            // Open-ended cylinder wraps 360° around the camera — no visible edges when panning
            const geometry = new THREE.CylinderGeometry(380, 380, 150, 64, 12, true);

            let material;
            let nodeUniforms = null;
            if (this.isWebGPU) {
                const nodeAurora = createAuroraNodeMaterial({
                    time: this.uniforms.time.value,
                    intensity: this.uniforms.auroraIntensity.value,
                    color1: config.color1,
                    color2: config.color2,
                    color3: config.color3,
                    offset: config.offset,
                });
                ({ material, uniforms: nodeUniforms } = nodeAurora);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uIntensity: this.uniforms.auroraIntensity,
                        uColor1: { value: config.color1 },
                        uColor2: { value: config.color2 },
                        uColor3: { value: config.color3 },
                        uOffset: { value: config.offset },
                    },
                    vertexShader: auroraVertexShader,
                    fragmentShader: auroraFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.BackSide,
                });
            }

            const aurora = new THREE.Mesh(geometry, material);
            // Fixed sky height; X/Z follow camera each frame (see update loop)
            aurora.position.set(0, 75 + config.offset * 8, 0);
            aurora.userData.nodeUniforms = nodeUniforms;

            this.auroraPlanes.push(aurora);
            this.scene.add(aurora);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPIRIT WINDS - Flowing energy ribbons
    // ═══════════════════════════════════════════════════════════════════════════

    createSpiritWinds() {
        // More wind ribbons spread across the entire scene, moving slowly
        const windCount = 12;
        this.spiritWindNodeUniforms = [];

        for (let i = 0; i < windCount; i++) {
            const width = 80 + this.random() * 50; // Wider ribbons
            const height = 2.0 + this.random() * 2.5;

            const geometry = new THREE.PlaneGeometry(width, height, 48, 2);
            let material;
            let nodeUniforms = null;
            if (this.isWebGPU) {
                const nodeWind = createSpiritWindNodeMaterial({
                    time: this.uniforms.time.value,
                    opacity: 0.18 + this.random() * 0.12,
                    windColor: COLORS.windColor.clone(),
                    offset: i * 1.5,
                });
                material = nodeWind.material;
                nodeUniforms = nodeWind.uniforms;
                this.spiritWindNodeUniforms.push(nodeUniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uOpacity: { value: 0.18 + this.random() * 0.12 }, // Slightly varied opacity
                        uWindColor: { value: COLORS.windColor },
                        uOffset: { value: i * 1.5 },
                    },
                    vertexShader: spiritWindVertexShader,
                    fragmentShader: spiritWindFragmentShader,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const wind = new THREE.Mesh(geometry, material);

            // Spread across entire scene width and depth
            wind.position.set(
                (this.random() - 0.5) * 500, // Full scene width (-250 to 250)
                3 + this.random() * 25, // Various heights from low to high
                -60 + this.random() * 100, // Deep into scene and near camera
            );
            wind.rotation.z = (this.random() - 0.5) * 0.15;
            wind.rotation.y = (this.random() - 0.5) * 0.1; // Slight angle variation

            wind.userData = {
                baseX: wind.position.x,
                speed: 0.15 + this.random() * 0.2, // SLOWER speed (was 0.6-0.9)
                verticalDrift: (this.random() - 0.5) * 0.02, // Gentle vertical movement
                nodeUniforms,
            };

            this.spiritWinds.push(wind);
            this.mainGroup.add(wind);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FALLING LEAVES
    // ═══════════════════════════════════════════════════════════════════════════

    createFallingLeavesSystem() {
        const maxLeaves = 50;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(maxLeaves * 3);
        const randoms = new Float32Array(maxLeaves);
        const phases = new Float32Array(maxLeaves);
        const velocities = new Float32Array(maxLeaves * 3);
        const rotations = new Float32Array(maxLeaves);

        for (let i = 0; i < maxLeaves; i++) {
            const i3 = i * 3;
            positions[i3] = (this.random() - 0.5) * 60;
            positions[i3 + 1] = 60 + this.random() * 20;
            positions[i3 + 2] = -10 - this.random() * 30;

            randoms[i] = this.random();
            phases[i] = this.random() * Math.PI * 2;

            velocities[i3] = (this.random() - 0.5) * 0.3;
            velocities[i3 + 1] = 1.5 + this.random() * 1.0;
            velocities[i3 + 2] = (this.random() - 0.5) * 0.2;

            rotations[i] = this.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aRotation', new THREE.BufferAttribute(rotations, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 10.0 },
            },
            vertexShader: leafVertexShader,
            fragmentShader: leafFragmentShader,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
        });

        this.fallingLeaves = new THREE.Points(geometry, material);
        this.fallingLeaves.userData = {
            activeLeaves: 0,
            startTime: 0,
        };
        this.mainGroup.add(this.fallingLeaves);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING - Warm sunset atmosphere
    // ═══════════════════════════════════════════════════════════════════════════

    setupLighting() {
        // Warm sunset ambient
        const ambient = new THREE.AmbientLight(0x3A2010, 0.4);
        this.scene.add(ambient);

        // Sunset directional light from sun position
        const sunLight = new THREE.DirectionalLight(0xFFAA44, 0.7);
        sunLight.position.set(0, 30, -60);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(1024, 1024);
        sunLight.shadow.camera.near = 10;
        sunLight.shadow.camera.far = 220;
        sunLight.shadow.camera.left = -180;
        sunLight.shadow.camera.right = 180;
        sunLight.shadow.camera.top = 160;
        sunLight.shadow.camera.bottom = -120;
        sunLight.shadow.bias = -0.00035;
        sunLight.shadow.normalBias = 0.02;
        sunLight.shadow.camera.updateProjectionMatrix();
        this.scene.add(sunLight);

        // Warm rim light for tree silhouette edges
        const rimLight = new THREE.DirectionalLight(0xFF8833, 0.4);
        rimLight.position.set(-30, 15, 20);
        this.scene.add(rimLight);

        // Hemisphere light - warm sky to warm ground
        const hemiLight = new THREE.HemisphereLight(
            0xFF8844, // Sky - warm orange
            0x2A1A0A, // Ground - dark warm brown
            0.5,
        );
        this.scene.add(hemiLight);

        // Spirit PointLight removed for performance — spirit materials use additive blending for glow
        this.spiritLight = null;

        // Floor illumination light - warm tones
        const floorLight = new THREE.DirectionalLight(0xAA7744, 0.5);
        floorLight.position.set(0, 30, 10);
        floorLight.target.position.set(0, 0, -20);
        this.scene.add(floorLight);
        this.scene.add(floorLight.target);
    }

    createDistanceFogBands() {
        if (!this.scene) return;

        this.distanceFogBands = [];
        this.distanceFogBandUniforms = [];

        const allFogBands = [
            {
                z: -110, y: 16, width: 520, height: 120, density: 0.24, color: new THREE.Color(0xFFCC88), drift: new THREE.Vector2(0.012, 0.004),
            },
            {
                z: -92, y: 14, width: 500, height: 108, density: 0.26, color: new THREE.Color(0xFFB772), drift: new THREE.Vector2(0.016, -0.003),
            },
            {
                z: -74, y: 11, width: 470, height: 96, density: 0.28, color: new THREE.Color(0xFFA15D), drift: new THREE.Vector2(0.021, 0.005),
            },
            {
                z: -56, y: 8.5, width: 430, height: 80, density: 0.3, color: new THREE.Color(0xF9894A), drift: new THREE.Vector2(0.026, -0.004),
            },
            {
                z: -38, y: 6.5, width: 380, height: 64, density: 0.32, color: new THREE.Color(0xE36E38), drift: new THREE.Vector2(0.031, 0.006),
            },
        ];

        const maxBands = this.qualityPreset?.fogBandCount ?? allFogBands.length;
        const fogBands = allFogBands.slice(0, maxBands);

        fogBands.forEach((band, index) => {
            const geometry = new THREE.PlaneGeometry(band.width, band.height);

            let material;
            if (this.isWebGPU) {
                const nodeBand = createHazeNodeMaterial({
                    time: this.uniforms.time.value,
                    hazeColor: band.color.clone(),
                    density: band.density,
                    layerDepth: index / Math.max(1, fogBands.length - 1),
                    drift: band.drift.clone(),
                });
                material = nodeBand.material;
                this.distanceFogBandUniforms.push(nodeBand.uniforms);
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: this.uniforms.time,
                        uHazeColor: { value: band.color.clone() },
                        uDensity: { value: band.density },
                        uLayerDepth: { value: index / Math.max(1, fogBands.length - 1) },
                        uDrift: { value: band.drift.clone() },
                    },
                    vertexShader: hazeVertexShader,
                    fragmentShader: hazeFragmentShader,
                    transparent: true,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const fogBand = new THREE.Mesh(geometry, material);
            fogBand.position.set(0, band.y, band.z);
            fogBand.rotation.x = -0.08;
            fogBand.renderOrder = -45 + index;

            this.distanceFogBands.push(fogBand);
            this.scene.add(fogBand);
        });
    }

    setupDistanceFog() {
        if (!this.scene) return;

        if (!this.scene.fog) {
            this.scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), 0.008);
        }
        this.createDistanceFogBands();
        this.distanceFogMode = 'layered-color-bands+exp2';

        if (this.flags.debug || this.flags.baseline) {
            console.log('[GoldenForest] Distance fog mode:', this.distanceFogMode);
        }
    }

    ensureMrtMaterials() {
        if (!this.isWebGPU || !this.flags.useMRT || !this.scene) {
            return true;
        }

        const nonNodeMaterials = [];
        this.scene.traverse((object) => {
            if (!object?.material) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material, index) => {
                if (!material || material.isNodeMaterial === true) return;
                const objectLabel = object.name || object.type || 'Object3D';
                const materialLabel = material.name || material.type || 'Material';
                const slot = Array.isArray(object.material) ? `[${index}]` : '';
                nonNodeMaterials.push(`${objectLabel}${slot}:${materialLabel}`);
            });
        });

        if (!nonNodeMaterials.length) {
            return true;
        }

        this.flags.useMRT = false;
        const preview = nonNodeMaterials.slice(0, 12);
        console.warn(
            '[GoldenForest] MRT disabled because scene still contains non-NodeMaterial entries.',
            preview,
        );
        if (nonNodeMaterials.length > preview.length) {
            console.warn(
                `[GoldenForest] ${nonNodeMaterials.length - preview.length} additional non-NodeMaterial entries omitted.`,
            );
        }
        return false;
    }

    setPostToneMappingNeutral() {
        if (!this.renderer || this.postToneMappingState) return;
        this.postToneMappingState = {
            toneMapping: this.renderer.toneMapping,
            toneMappingExposure: this.renderer.toneMappingExposure,
        };
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    restorePostToneMapping() {
        if (!this.renderer || !this.postToneMappingState) return;
        this.renderer.toneMapping = this.postToneMappingState.toneMapping;
        this.renderer.toneMappingExposure = this.postToneMappingState.toneMappingExposure;
        this.postToneMappingState = null;
    }

    setupPostProcessing() {
        this.disposePostProcessing();

        if (!this.flags.usePost) {
            if (this.flags.noPost) {
                console.log('[GoldenForest] Post-processing disabled via kill switch (?goldenForestNoPost=1).');
            }
            return;
        }

        if (!this.renderer || !this.scene || !this.camera) {
            return;
        }

        try {
            if (this.isWebGPU && this.flags.useMRT) {
                this.ensureMrtMaterials();
            }

            const presetBloom = this.qualityPreset?.bloomStrength ?? 0.18;
            const presetRadius = this.qualityPreset?.bloomRadius ?? 0.35;
            const filmGrain = this.qualityPreset?.enableFilmGrain !== false;

            const postParams = this.isWebGPU
                ? {
                    useMRT: this.flags.useMRT,
                    useBloom: this.flags.useBloom,
                    bloomStrength: presetBloom,
                    bloomRadius: presetRadius,
                    bloomThreshold: 0.92,
                    exposure: 0.97,
                    contrast: 1.01,
                    saturation: 1.04,
                    warmTint: new THREE.Color(1.02, 0.98, 0.92),
                    crushBlacks: new THREE.Color(0.015, 0.008, 0.004),
                    vignetteOffset: 1.28,
                    vignetteDarkness: 0.34,
                    grainStrength: filmGrain ? 0.008 : 0,
                    ditherStrength: 0.0012,
                    sunGlowStrength: 0.045,
                }
                : {
                    useMRT: this.flags.useMRT,
                    useBloom: this.flags.useBloom,
                    bloomStrength: presetBloom || 0.35,
                    bloomRadius: presetRadius || 0.5,
                    bloomThreshold: 0.8,
                    exposure: 1.05,
                    contrast: 1.04,
                    saturation: 1.12,
                    warmTint: new THREE.Color(1.08, 0.98, 0.88),
                    crushBlacks: new THREE.Color(0.02, 0.01, 0.005),
                    vignetteOffset: 1.3,
                    vignetteDarkness: 0.4,
                    grainStrength: filmGrain ? 0.015 : 0,
                };

            this.postComposer = new GoldenForestPost(this.renderer, this.scene, this.camera, {
                ...postParams,
            });

            if (!this.postComposer?.isEnabled?.()) {
                console.warn(
                    '[GoldenForest] Post-processing requested but no compatible post backend initialized.',
                );
                this.flags.usePost = false;
                this.flags.useBloom = false;
                this.flags.useMRT = false;
                this.disposePostProcessing();
                return;
            }

            this.setPostToneMappingNeutral();

            this.onWindowResize();
            console.log(
                `[GoldenForest] Post-processing initialized (${this.isWebGPU ? 'WebGPU' : 'WebGL'}; MRT=${this.flags.useMRT ? 'on' : 'off'}).`,
            );
        } catch (error) {
            console.warn(
                '[GoldenForest] Post-processing init failed; continuing with direct renderer path:',
                error,
            );
            this.flags.usePost = false;
            this.flags.useBloom = false;
            this.flags.useMRT = false;
            this.disposePostProcessing();
        }
    }

    disposePostProcessing() {
        if (typeof this.postComposer?.dispose === 'function') {
            this.postComposer.dispose();
        }
        this.postComposer = null;
        this.postPasses = null;
        this.restorePostToneMapping();
    }

    getSpiritOpacityUniform(spirit) {
        if (!spirit) return null;
        if (spirit.userData?.nodeUniforms?.uOpacity) return spirit.userData.nodeUniforms.uOpacity;
        if (spirit.material?.uniforms?.uOpacity) return spirit.material.uniforms.uOpacity;
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEBUG OVERLAY
    // ═══════════════════════════════════════════════════════════════════════════

    createDebugOverlay() {
        if (!this.flags.debug) return;

        const container = document.getElementById('golden-forest-theme');
        if (!container) return;

        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;top:8px;left:8px;z-index:9999;'
            + 'background:rgba(0,0,0,0.65);color:#ffd080;font:11px/1.5 monospace;'
            + 'padding:6px 10px;border-radius:4px;pointer-events:none;white-space:pre;';
        container.appendChild(el);
        this.debugOverlay = el;
        this.debugFrameCounter = 0;
    }

    updateDebugOverlay(delta) {
        if (!this.debugOverlay) return;
        this.debugFrameCounter = (this.debugFrameCounter || 0) + 1;
        if (this.debugFrameCounter % 30 !== 0) return;

        const fps = delta > 0 ? (1 / delta).toFixed(0) : '--';
        const info = this.renderer?.info;
        const calls = info?.render?.calls ?? '--';
        const tris = info?.render?.triangles ?? '--';
        const textures = info?.memory?.textures ?? '--';
        const backend = this.isWebGPU ? 'WebGPU' : 'WebGL2';
        const post = this.flags.usePost ? 'on' : 'off';
        const mrtLabel = this.flags.useMRT ? 'on' : 'off';
        const compute = this.flags.useCompute ? 'on' : 'off';

        this.debugOverlay.textContent = `${backend} | FPS: ${fps}\n`
            + `Draw: ${calls} | Tris: ${tris} | Tex: ${textures}\n`
            + `Post: ${post} | MRT: ${mrtLabel} | Compute: ${compute}`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMEPLAY EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount || 0);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data);
            }
        });

        // Pointer tracking for parallax
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
    }

    onLineClear(lineCount) {
        this.targetGlowIntensity = Math.min(lineCount * 0.35, 1.0);
        this.targetMistIntensity = Math.min(0.6 + lineCount * 0.12, 1.0);

        this.spawnLeaves(lineCount * 4);

        this.spirits.forEach((spirit) => {
            spirit.userData.velocity.x += (this.random() - 0.5) * 2.5;
            spirit.userData.velocity.y += (this.random() - 0.5) * 2.5;
            const spiritOpacity = this.getSpiritOpacityUniform(spirit);
            if (spiritOpacity) {
                spiritOpacity.value = Math.min(spiritOpacity.value + 0.25, 0.95);
            }
        });

        // Boost spirit light
        if (this.spiritLight) {
            this.spiritLight.intensity = 0.8 + lineCount * 0.2;
        }
    }

    onCombo(comboCount) {
        if (comboCount < 1) return;

        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.targetGlowIntensity = Math.min(comboCount * 0.3, 1.0);
        this.targetWindSpeed = Math.min(comboCount * 0.012, 0.06);

        if (comboCount >= 3) {
            this.targetAuroraIntensity = Math.min(comboCount * 0.18, 0.9);
        }

        if (this.comboMultiplier > 1.5) {
            const centerX = 0;
            const centerY = 12;
            this.spirits.forEach((spirit) => {
                spirit.userData.velocity.x += (centerX - spirit.position.x) * 0.012 * this.comboMultiplier;
                spirit.userData.velocity.y += (centerY - spirit.position.y) * 0.012 * this.comboMultiplier;
            });
        }

        // Boost fireflies based on combo count (stronger boost for higher combos)
        if (this.fireflyBoostUniform) {
            const boostAmount = Math.min(0.5 + comboCount * 0.25, 1.0);
            this.fireflyBoostUniform.value = boostAmount;
        }
    }

    onPieceLock(data) {
        this.targetGlowIntensity += 0.1;

        this.spirits.forEach((spirit) => {
            const spiritOpacity = this.getSpiritOpacityUniform(spirit);
            if (spiritOpacity) {
                spiritOpacity.value += 0.06;
            }
        });

        // Boost fireflies to twinkle and shine
        if (this.fireflyBoostUniform) {
            this.fireflyBoostUniform.value = 1.0;
        }
    }

    spawnLeaves(count) {
        if (!this.fallingLeaves) return;

        const positions = this.fallingLeaves.geometry.attributes.position.array;
        const start = this.fallingLeaves.userData.activeLeaves;
        const maxLeaves = positions.length / 3;

        this.fallingLeaves.userData.startTime = this.uniforms.time.value;
        this.fallingLeaves.material.uniforms.uTime.value = 0;

        for (let i = 0; i < count && (start + i) < maxLeaves; i++) {
            const idx = ((start + i) % maxLeaves) * 3;
            positions[idx] = (this.random() - 0.5) * 70;
            positions[idx + 1] = 45 + this.random() * 15;
            positions[idx + 2] = -8 - this.random() * 35;
        }

        this.fallingLeaves.geometry.attributes.position.needsUpdate = true;
        this.fallingLeaves.userData.activeLeaves = Math.min(start + count, maxLeaves);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.boundAnimate);

        if (!this.shouldRenderFrame()) return;

        const rawDelta = this.clock.getDelta();
        const delta = this.fixedDeltaSeconds !== null
            ? this.fixedDeltaSeconds
            : Math.min(rawDelta, MAX_FRAME_DELTA_SECONDS);
        if (this.fixedDeltaSeconds !== null) {
            this.fixedElapsedTime += this.fixedDeltaSeconds;
        }
        const elapsed = this.fixedDeltaSeconds !== null ? this.fixedElapsedTime : this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;
        this.frameCount++;
        this.recordBaselineSample(delta);

        if (this.skyNodeUniforms?.uTime) {
            this.skyNodeUniforms.uTime.value = elapsed;
        }
        if (this.sunNodeUniforms?.uTime) {
            this.sunNodeUniforms.uTime.value = elapsed;
        }
        if (this.godRayNodeUniforms?.uTime) {
            this.godRayNodeUniforms.uTime.value = elapsed;
        }
        if (this.cloudNodeUniforms?.length) {
            this.cloudNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
            });
        }
        if (this.hazeNodeUniforms?.length) {
            this.hazeNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
            });
        }
        if (this.distanceFogBandUniforms?.length) {
            this.distanceFogBandUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
            });
        }
        if (this.mountainLayerNodeUniforms?.length) {
            this.mountainLayerNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
            });
        }
        if (this.silhouetteMountainNodeUniforms?.uTime) {
            this.silhouetteMountainNodeUniforms.uTime.value = elapsed;
        }
        if (this.fireflyNodeUniforms?.uTime) {
            this.fireflyNodeUniforms.uTime.value = elapsed;
        }
        if (this.dustNodeUniforms?.uTime) {
            this.dustNodeUniforms.uTime.value = elapsed;
        }
        if (this.spiritNodeUniforms?.length) {
            this.spiritNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
            });
        }
        if (this.spiritWindNodeUniforms?.length) {
            this.spiritWindNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
            });
        }
        if (this.mistNodeUniforms?.length) {
            this.mistNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
                if (uniforms?.uIntensity) {
                    uniforms.uIntensity.value = this.uniforms.mistIntensity.value;
                }
            });
        }

        // Update Water Waves
        const waterTimeScale = this.isWebGPU ? 0.38 : 0.25;
        if (this.lakeMesh?.material?.uniforms?.time) {
            this.lakeMesh.material.uniforms.time.value += delta * waterTimeScale;
        }
        if (this.waterNodeUniforms?.uTime) {
            this.waterNodeUniforms.uTime.value += delta * waterTimeScale;
        }

        // Update Shore Foam animation
        if (this.shoreFoamMesh?.material?.uniforms?.time) {
            this.shoreFoamMesh.material.uniforms.time.value = elapsed;
        }
        if (this.shoreFoamNodeUniforms?.uTime) {
            this.shoreFoamNodeUniforms.uTime.value = elapsed;
        }

        // ─────────────────────────────────────────────────────────────────────
        // SMOOTH EFFECT TRANSITIONS
        // ─────────────────────────────────────────────────────────────────────

        this.uniforms.glowIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.glowIntensity.value,
            this.targetGlowIntensity,
            delta * 3,
        );
        this.targetGlowIntensity *= 0.95;

        this.uniforms.mistIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.mistIntensity.value,
            this.targetMistIntensity,
            delta * 2,
        );
        if (this.targetMistIntensity > 0.6) {
            this.targetMistIntensity -= delta * 0.04;
        }

        this.uniforms.auroraIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.auroraIntensity.value,
            this.targetAuroraIntensity,
            delta * 2,
        );
        this.targetAuroraIntensity *= 0.97;

        this.uniforms.windSpeed.value = THREE.MathUtils.lerp(
            this.uniforms.windSpeed.value,
            this.targetWindSpeed,
            delta * 2,
        );
        this.targetWindSpeed *= 0.96;

        if (this.foliageNodeUniforms) {
            if (this.foliageNodeUniforms.uTime) {
                this.foliageNodeUniforms.uTime.value = elapsed;
            }
            if (this.foliageNodeUniforms.uGlowIntensity) {
                this.foliageNodeUniforms.uGlowIntensity.value = this.uniforms.glowIntensity.value;
            }
            if (this.foliageNodeUniforms.uWindStrength) {
                this.foliageNodeUniforms.uWindStrength.value = 0.24 + this.uniforms.windSpeed.value * 0.45;
            }
        }
        if (this.trunkNodeUniforms) {
            if (this.trunkNodeUniforms.uTime) {
                this.trunkNodeUniforms.uTime.value = elapsed;
            }
            if (this.trunkNodeUniforms.uGlowIntensity) {
                this.trunkNodeUniforms.uGlowIntensity.value = this.uniforms.glowIntensity.value;
            }
            if (this.trunkNodeUniforms.uWindStrength) {
                this.trunkNodeUniforms.uWindStrength.value = 0.16 + this.uniforms.windSpeed.value * 0.3;
            }
        }

        this.comboMultiplier = Math.max(1, this.comboMultiplier - delta * 0.25);

        // Spirit light decay
        if (this.spiritLight && this.spiritLight.intensity > 0.4) {
            this.spiritLight.intensity -= delta * 0.2;
        }

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP DRIFT - very subtle
        // ─────────────────────────────────────────────────────────────────────

        const driftTime = elapsed * 0.025;
        this.mainGroup.position.x = Math.sin(driftTime) * 0.4;
        this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.15;
        this.mainGroup.rotation.y = Math.sin(driftTime * 0.5) * 0.005;

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA EXPLORATORY MOVEMENT - wandering through the forest
        // Different random path every time theme starts
        // ─────────────────────────────────────────────────────────────────────

        const ro = this.cameraRandomOffsets; // Random offsets
        const camTime = elapsed * 0.05 * ro.speedMult; // Randomized exploration pace
        const baseX = 0;
        const baseY = 8;
        const baseZ = 30;

        // Smooth pointer tracking for parallax
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX || 0, delta * 2.2);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY || 0, delta * 2.2);
        const parallaxX = this.smoothedPointerX * 25.0; // Increased from 15.0
        const parallaxY = -this.smoothedPointerY * 10.0; // Increased from 5.5

        // Exploratory camera position - uses random phase offsets for unique movement each time
        // Added deep forward/backward drift and enhanced organic breathing
        this.camera.position.x = baseX
            + Math.sin(camTime * 1.0 + ro.posX1) * 18.0
            + Math.sin(camTime * 0.37 + ro.posX2) * 10.0
            + Math.cos(camTime * 0.71 + ro.posX3) * 6.0
            + parallaxX;
        this.camera.position.y = Math.max(1.5, baseY
            + Math.sin(camTime * 0.43 + ro.posY) * 3.0
            + Math.cos(elapsed * 0.25) * 1.5 // Added subtle breathing float
            + parallaxY);
        this.camera.position.z = baseZ
            + Math.cos(camTime * 0.31 + ro.posZ1) * 8.0
            + Math.sin(camTime * 0.53 + ro.posZ2) * 4.0
            + Math.sin(camTime * 0.22) * 22.0; // Deep forward/backward drift

        // Look target wanders independently with random offsets
        const lookX = Math.sin(camTime * 0.47 + ro.lookX1) * 22.0 + Math.cos(camTime * 0.29 + ro.lookX2) * 12.0 + parallaxX * 0.4;
        const lookY = 12 + Math.cos(camTime * 0.23 + ro.lookY) * 5.0 + parallaxY * 0.4;
        this.camera.lookAt(lookX, lookY, -30);

        // ─────────────────────────────────────────────────────────────────────
        // SUN MOVEMENT - Slow rise/fall with gentle pulse
        // ─────────────────────────────────────────────────────────────────────

        if (this.sun) {
            this._postUpdateParams.sunGlowVisibility = 0;

            // Slow vertical oscillation (like sun slowly setting/rising)
            const sunTime = elapsed * 0.02;
            const sunY = this.sunBaseY + Math.sin(sunTime) * 3.0;
            const sunX = Math.sin(sunTime * 0.3) * 2.0;

            this.sun.position.y = sunY;
            this.sun.position.x = sunX;

            // Update glow layers to follow sun
            this.sunGlowLayers.forEach((sprite) => {
                sprite.position.y = sunY;
                sprite.position.x = sunX;
            });

            if (this.godRayMaterial?.uniforms?.uSunPosition) {
                this.godRayMaterial.uniforms.uSunPosition.value.copy(this.sun.position);
            }

            if ((this.godRayMaterial?.uniforms?.uSunScreenPos || this.godRayNodeUniforms?.uSunScreenPos) && this.camera) {
                const sunNdc = this._sunNdc.copy(this.sun.position).project(this.camera);
                const sunScreenX = sunNdc.x * 0.5 + 0.5;
                const sunScreenY = sunNdc.y * 0.5 + 0.5;
                this._postUpdateParams.sunScreenX = sunScreenX;
                this._postUpdateParams.sunScreenY = sunScreenY;
                if (this.godRayMaterial?.uniforms?.uSunScreenPos) {
                    this.godRayMaterial.uniforms.uSunScreenPos.value.set(sunScreenX, sunScreenY);
                }
                if (this.godRayNodeUniforms?.uSunScreenPos) {
                    this.godRayNodeUniforms.uSunScreenPos.value.set(sunScreenX, sunScreenY);
                }
            }

            // Update Lens Flares - position along camera-to-sun axis
            if (this.lensFlares && this.lensFlares.length > 0) {
                const sunScreenPos = this._lensSunPosition.copy(this.sun.position);
                const cameraPos = this._lensCameraPosition.copy(this.camera.position);

                // Calculate direction from sun to camera
                const sunToCam = this._lensSunToCamera.copy(cameraPos).sub(sunScreenPos);

                // Check if sun is roughly in front of camera (dot product > 0 means behind)
                const cameraDir = this._lensCameraForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
                const toSun = this._lensToSun.copy(sunScreenPos).sub(cameraPos).normalize();
                const sunVisibility = Math.max(0, cameraDir.dot(toSun));
                this._postUpdateParams.sunGlowVisibility = sunVisibility ** 2.0;

                this.lensFlares.forEach((flare) => {
                    if (flare.userData?.nodeUniforms?.uTime) {
                        flare.userData.nodeUniforms.uTime.value = elapsed;
                    }
                    // Position flare along sun-to-camera axis
                    const { offset } = flare.userData;
                    const flarePos = this._lensFlarePosition.copy(sunToCam).multiplyScalar(offset).add(sunScreenPos);
                    flare.position.copy(flarePos);

                    // Make flare always face camera (billboarding)
                    flare.quaternion.copy(this.camera.quaternion);

                    // Intermittent flicker - simulates sun peeking through tree gaps
                    const { flickerPhase } = flare.userData;
                    const { flickerSpeed } = flare.userData;

                    // Multi-frequency flicker for organic light-through-trees effect
                    const flicker1 = Math.sin(elapsed * flickerSpeed + flickerPhase);
                    const flicker2 = Math.sin(elapsed * flickerSpeed * 0.37 + flickerPhase * 1.7);
                    const flicker3 = Math.sin(elapsed * flickerSpeed * 0.61 + flickerPhase * 2.3);

                    // Combine flickers - creates irregular on/off pattern
                    let flickerIntensity = (flicker1 + flicker2 * 0.5 + flicker3 * 0.3) / 1.8;
                    // Sharpen the flicker - mostly off, occasionally bright
                    flickerIntensity = Math.max(0, flickerIntensity) ** 2.5;

                    // Only show when camera is mostly facing sun AND flickering is active
                    const { baseOpacity } = flare.userData;
                    const viewFactor = sunVisibility ** 2.0; // Sharper falloff when not looking at sun
                    const flareOpacity = baseOpacity * viewFactor * flickerIntensity;
                    if (flare.material?.uniforms?.uOpacity) {
                        flare.material.uniforms.uOpacity.value = flareOpacity;
                    }
                    if (flare.userData?.nodeUniforms?.uOpacity) {
                        flare.userData.nodeUniforms.uOpacity.value = flareOpacity;
                    }
                });
            }

            // Subtle pulse on sun intensity
            const pulse = 1.0 + Math.sin(elapsed * 0.8) * 0.05;
            if (this.sun.material.uniforms?.uIntensity) {
                this.sun.material.uniforms.uIntensity.value = pulse;
            }
            if (this.sunNodeUniforms?.uIntensity) {
                this.sunNodeUniforms.uIntensity.value = pulse;
            }

            // Update Realistic Water Reflection
            const sunDirection = this._sunDirection.copy(this.sun.position).normalize();
            if (this.lakeMesh?.material?.uniforms?.sunDirection) {
                this.lakeMesh.material.uniforms.sunDirection.value.copy(sunDirection);
            }
            if (this.waterNodeUniforms?.uSunDirection) {
                this.waterNodeUniforms.uSunDirection.value.copy(sunDirection);
            }
            if (this.foliageNodeUniforms?.uSunDirection) {
                this.foliageNodeUniforms.uSunDirection.value.copy(sunDirection);
            }
            if (this.dustNodeUniforms?.uSunDirection) {
                this.dustNodeUniforms.uSunDirection.value.copy(sunDirection);
            }
            if (this.silhouetteMountainNodeUniforms?.uSunDirection) {
                this.silhouetteMountainNodeUniforms.uSunDirection.value.copy(sunDirection);
            }
            if (this.mountainLayerNodeUniforms?.length) {
                this.mountainLayerNodeUniforms.forEach((uniforms) => {
                    if (uniforms?.uLightDirection) {
                        uniforms.uLightDirection.value.copy(sunDirection);
                    }
                });
            }
        }

        // Keep sky dome centered on camera and aligned to sun direction
        if (this.skyDome && (this.skyDome.material?.uniforms?.uSunDirection || this.skyNodeUniforms?.uSunDirection)) {
            const sunTarget = this.sun ? this.sun.position : this.sunPosition;
            const skySunDirection = this._skySunDirection.copy(sunTarget).sub(this.camera.position).normalize();
            if (this.skyDome.material?.uniforms?.uSunDirection) {
                this.skyDome.material.uniforms.uSunDirection.value.copy(skySunDirection);
            }
            if (this.skyNodeUniforms?.uSunDirection) {
                this.skyNodeUniforms.uSunDirection.value.copy(skySunDirection);
            }
            this.skyDome.position.copy(this.camera.position);
        }

        // Keep aurora cylinders centered on camera to prevent edge artifacts when panning
        if (this.auroraPlanes?.length) {
            for (const plane of this.auroraPlanes) {
                plane.position.x = this.camera.position.x;
                plane.position.z = this.camera.position.z;
                const nodeUniforms = plane.userData?.nodeUniforms;
                if (nodeUniforms?.uTime) {
                    nodeUniforms.uTime.value = elapsed;
                }
                if (nodeUniforms?.uIntensity) {
                    nodeUniforms.uIntensity.value = this.uniforms.auroraIntensity.value;
                }
            }
        }

        // Billboard cloud cards to camera — stride: every 4th frame (nearly static)
        if (this.clouds && this.camera && (this.frameCount % 4 === 0)) {
            this.clouds.forEach((cloud) => {
                cloud.quaternion.copy(this.camera.quaternion);
            });
        }
        // Update firefly InstancedMesh billboarding (single draw call path)
        // Stride: every 2nd frame — slow drift tolerates 30Hz update
        if (this.fireflyInstancedMesh && this.fireflyInstanceData && this.camera && (this.frameCount % 2 === 0)) {
            const camQuat = this.camera.quaternion;
            const tempMat = this._tempMat;
            const rotMat = this._rotMat.makeRotationFromQuaternion(camQuat);
            const scaleVec = this._scaleVec;
            const count = this.fireflyInstanceData.length / 4;
            for (let i = 0; i < count; i++) {
                const i4 = i * 4;
                const s = this.fireflyInstanceData[i4 + 3];
                tempMat.copy(rotMat);
                scaleVec.set(s, s, 1);
                tempMat.scale(scaleVec);
                tempMat.setPosition(
                    this.fireflyInstanceData[i4],
                    this.fireflyInstanceData[i4 + 1],
                    this.fireflyInstanceData[i4 + 2],
                );
                this.fireflyInstancedMesh.setMatrixAt(i, tempMat);
            }
            this.fireflyInstancedMesh.instanceMatrix.needsUpdate = true;
        }
        // Update dust mote InstancedMesh billboarding (single draw call path)
        // Stride: every 2nd frame — slow drift tolerates 30Hz update
        if (this.dustInstancedMesh && this.dustInstanceData && this.camera && (this.frameCount % 2 === 1)) {
            const camQuat = this.camera.quaternion;
            const tempMat = this._tempMat;
            const rotMat = this._rotMat.makeRotationFromQuaternion(camQuat);
            const scaleVec = this._scaleVec;
            const count = this.dustInstanceData.length / 4;
            for (let i = 0; i < count; i++) {
                const i4 = i * 4;
                const s = this.dustInstanceData[i4 + 3];
                tempMat.copy(rotMat);
                scaleVec.set(s, s, 1);
                tempMat.scale(scaleVec);
                tempMat.setPosition(
                    this.dustInstanceData[i4],
                    this.dustInstanceData[i4 + 1],
                    this.dustInstanceData[i4 + 2],
                );
                this.dustInstancedMesh.setMatrixAt(i, tempMat);
            }
            this.dustInstancedMesh.instanceMatrix.needsUpdate = true;
        }

        // ─────────────────────────────────────────────────────────────────────
        // GOD RAY SHADER UPDATE
        // ─────────────────────────────────────────────────────────────────────

        if (this.godRayMaterial?.uniforms?.uTime) {
            this.godRayMaterial.uniforms.uTime.value = elapsed;
        }
        if (this.godRayNodeUniforms?.uTime) {
            this.godRayNodeUniforms.uTime.value = elapsed;
        }

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT MOVEMENT
        // ─────────────────────────────────────────────────────────────────────

        // Spirit movement — stride: every 2nd frame (slow wander)
        if (this.frameCount % 2 === 0) {
            const spiritLodDistSq = Math.pow(this.qualityPreset?.spiritLodDistance ?? 200, 2);
            this.spirits.forEach((spirit) => {
                spirit.userData.wanderPhase += delta * 0.4;

                spirit.userData.targetX += Math.cos(spirit.userData.wanderPhase) * 0.08;
                spirit.userData.targetY += Math.sin(spirit.userData.wanderPhase * 1.3) * 0.04;

                const dx = spirit.userData.targetX - spirit.position.x;
                const dy = spirit.userData.targetY - spirit.position.y;
                spirit.userData.velocity.x += dx * 0.0015;
                spirit.userData.velocity.y += dy * 0.0015;

                spirit.userData.velocity.x *= 0.97;
                spirit.userData.velocity.y *= 0.97;

                spirit.position.x += spirit.userData.velocity.x;
                spirit.position.y += spirit.userData.velocity.y;

                // LOD cull: hide spirits far from camera
                const distSq = spirit.position.distanceToSquared(this.camera.position);
                if (distSq > spiritLodDistSq) {
                    spirit.visible = false;
                    return;
                }
                spirit.visible = true;

                const spiritOpacity = this.getSpiritOpacityUniform(spirit);
                if (spiritOpacity) {
                    spiritOpacity.value *= 0.997;
                    if (spiritOpacity.value < 0.25) {
                        spiritOpacity.value = 0.25;
                    }
                }

                spirit.lookAt(this.camera.position);
            });
        } // end spirit stride

        // ─────────────────────────────────────────────────────────────────────
        // SPIRIT WIND MOVEMENT
        // ─────────────────────────────────────────────────────────────────────

        this.spiritWinds.forEach((wind) => {
            // Slower, more graceful movement
            wind.position.x += wind.userData.speed * (1 + this.uniforms.windSpeed.value * 8);

            // Add gentle vertical drift
            if (wind.userData.verticalDrift) {
                wind.position.y += Math.sin(elapsed * 0.3 + wind.userData.baseX) * wind.userData.verticalDrift;
            }

            // Wrap around when reaching edge - wider range for full scene coverage
            if (wind.position.x > 150) {
                wind.position.x = -150;
                wind.position.y = 3 + this.random() * 25;
                wind.position.z = -60 + this.random() * 100;
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // FALLING LEAVES UPDATE
        // ─────────────────────────────────────────────────────────────────────

        if (this.fallingLeaves && this.fallingLeaves.userData.startTime > 0) {
            const leafTime = elapsed - this.fallingLeaves.userData.startTime;
            this.fallingLeaves.material.uniforms.uTime.value = leafTime;

            if (leafTime > 18) {
                this.fallingLeaves.userData.startTime = 0;
                this.fallingLeaves.userData.activeLeaves = 0;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // GRASS ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        if (this.groundMaterial && this.groundMaterial.uniforms) {
            this.groundMaterial.uniforms.uTime.value = elapsed;
            this.groundMaterial.uniforms.uGlowIntensity.value = this.uniforms.glowIntensity.value;
        }
        if (this.groundNodeUniforms) {
            if (this.groundNodeUniforms.uTime) {
                this.groundNodeUniforms.uTime.value = elapsed;
            }
            if (this.groundNodeUniforms.uGlowIntensity) {
                this.groundNodeUniforms.uGlowIntensity.value = this.uniforms.glowIntensity.value;
            }
        }

        if (this.grassMaterial) {
            this.grassMaterial.uniforms.uTime.value = elapsed;
            // Subtle spirit glow triggered by combo effects
            this.grassMaterial.uniforms.uSpiritGlow.value = THREE.MathUtils.lerp(
                this.grassMaterial.uniforms.uSpiritGlow.value,
                this.uniforms.glowIntensity.value,
                delta * 2,
            );
        }
        if (this.grassNodeUniforms) {
            if (this.grassNodeUniforms.uTime) {
                this.grassNodeUniforms.uTime.value = elapsed;
            }
            if (this.grassNodeUniforms.uWindStrength) {
                this.grassNodeUniforms.uWindStrength.value = 0.18 + this.uniforms.windSpeed.value * 0.32;
            }
            if (this.grassNodeUniforms.uSpiritGlow) {
                this.grassNodeUniforms.uSpiritGlow.value = THREE.MathUtils.lerp(
                    this.grassNodeUniforms.uSpiritGlow.value,
                    this.uniforms.glowIntensity.value,
                    delta * 2,
                );
            }
        }
        if (this.silhouetteGrassNodeUniforms) {
            if (this.silhouetteGrassNodeUniforms.uTime) {
                this.silhouetteGrassNodeUniforms.uTime.value = elapsed;
            }
            if (this.silhouetteGrassNodeUniforms.uWindStrength) {
                this.silhouetteGrassNodeUniforms.uWindStrength.value = 0.15 + this.uniforms.windSpeed.value * 0.24;
            }
        }
        if (this.shoreReedNodeUniforms?.length) {
            this.shoreReedNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
                if (uniforms?.uWindStrength) {
                    uniforms.uWindStrength.value = 0.2 + this.uniforms.windSpeed.value * 0.28;
                }
            });
        }
        if (this.framingTreeFoliageNodeUniforms?.length) {
            const sunDirection = this.sun ? this._sunDirection.copy(this.sun.position).normalize() : null;
            this.framingTreeFoliageNodeUniforms.forEach((uniforms) => {
                if (uniforms?.uTime) {
                    uniforms.uTime.value = elapsed;
                }
                if (uniforms?.uWindStrength) {
                    uniforms.uWindStrength.value = 0.12 + this.uniforms.windSpeed.value * 0.22;
                }
                if (uniforms?.uSunDirection && sunDirection) {
                    uniforms.uSunDirection.value.copy(sunDirection);
                }
            });
        }
        if (this.framingTreeTrunkNodeUniforms) {
            if (this.framingTreeTrunkNodeUniforms.uTime) {
                this.framingTreeTrunkNodeUniforms.uTime.value = elapsed;
            }
            if (this.framingTreeTrunkNodeUniforms.uWindStrength) {
                this.framingTreeTrunkNodeUniforms.uWindStrength.value = 0.08 + this.uniforms.windSpeed.value * 0.18;
            }
        }

        // Decay firefly boost for piece lock twinkle effect
        if (this.fireflyBoostUniform) {
            const boost = this.fireflyBoostUniform;
            boost.value *= 0.94; // Smooth decay
            if (boost.value < 0.01) boost.value = 0;
        }

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA BREATHING
        // ─────────────────────────────────────────────────────────────────────
        if (this.camera && this.baseFov) {
            const breathingSpeed = 0.5; // Slow, meditative cycle
            const breathingRange = 0.5; // +/- 0.5 degrees
            this.camera.fov = this.baseFov + Math.sin(elapsed * breathingSpeed) * breathingRange;
            this.camera.updateProjectionMatrix();
        }

        // ─────────────────────────────────────────────────────────────────────
        // RENDER
        // ─────────────────────────────────────────────────────────────────────

        // Update GPGPU Birds — stride: every 2nd frame (smooth flocking)
        if (this.birds && (this.frameCount % 2 === 0)) {
            this.birds.update(elapsed, delta);
        }

        if (this.postComposer && this.flags.usePost) {
            try {
                this._postUpdateParams.time = elapsed;
                this.postComposer.update?.(this._postUpdateParams);
                this.postComposer.render(delta);
            } catch (error) {
                console.warn(
                    '[GoldenForest] Post-processing render failed; disabling post pipeline and falling back to direct render:',
                    error,
                );
                this.flags.usePost = false;
                this.flags.useMRT = false;
                this.disposePostProcessing();
                this.renderer.render(this.scene, this.camera);
            }
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        this.updateDRS(delta);
        this.updateDebugOverlay(delta);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DYNAMIC RESOLUTION SCALING (DRS)
    // ═══════════════════════════════════════════════════════════════════════════

    updateDRS(delta) {
        if (!this.renderer) return;
        // Skip DRS when fixed resolution mode is active
        if (this.resolutionMode === 'fixed' && this.targetResolution) return;

        // Initialize DRS state on first call
        if (!this.drsState) {
            this.drsState = {
                scale: 1.0,
                frameTimeSamples: [],
                maxSamples: 10,
                lastAdjustFrame: 0,
                basePixelRatio: this.getEffectivePixelRatio(),
            };
        }

        const state = this.drsState;

        // Track frame time
        state.frameTimeSamples.push(delta);
        if (state.frameTimeSamples.length > state.maxSamples) {
            state.frameTimeSamples.shift();
        }

        // Only adjust every 30 frames to avoid oscillation
        if (this.frameCount - state.lastAdjustFrame < 30) return;
        if (state.frameTimeSamples.length < state.maxSamples) return;

        // Calculate average FPS from rolling window
        const avgDelta = state.frameTimeSamples.reduce((a, b) => a + b, 0) / state.frameTimeSamples.length;
        const avgFps = 1 / avgDelta;

        let changed = false;

        if (avgFps < 50 && state.scale > 0.6) {
            // Scale down by 5%
            state.scale = Math.max(state.scale - 0.05, 0.6);
            changed = true;
        } else if (avgFps > 58 && state.scale < 1.0) {
            // Scale up by 2%
            state.scale = Math.min(state.scale + 0.02, 1.0);
            changed = true;
        }

        if (changed) {
            state.lastAdjustFrame = this.frameCount;
            const newRatio = state.basePixelRatio * state.scale;
            this.renderer.setPixelRatio(newRatio);
            this.renderer.setSize(window.innerWidth, window.innerHeight);

            if (this.postComposer) {
                this.postComposer.setPixelRatio?.(newRatio);
                this.postComposer.setSize?.(window.innerWidth, window.innerHeight);
            }

            if (this.flags.debug) {
                console.log(`[GoldenForest DRS] scale=${state.scale.toFixed(2)} ratio=${newRatio.toFixed(2)} fps=${avgFps.toFixed(1)}`);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WINDOW RESIZE
    // ═══════════════════════════════════════════════════════════════════════════

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        let renderWidth = window.innerWidth;
        let renderHeight = window.innerHeight;
        let pixelRatio = this.getEffectivePixelRatio();

        if (this.resolutionMode === 'fixed' && this.targetResolution) {
            // FORCE pixel ratio to 1 to ensure we actually render at the requested resolution
            renderWidth = this.targetResolution.width;
            renderHeight = this.targetResolution.height;
            pixelRatio = 1;
            this.renderer.setPixelRatio(pixelRatio);
            this.renderer.setSize(renderWidth, renderHeight, false);

            // We must set the DOM element size to window size (CSS handles this, but ThreeJS might set explicit style)
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
        } else {
            // Auto mode: use the same pixel-ratio policy as renderer initialization.
            this.renderer.setPixelRatio(pixelRatio);
            this.renderer.setSize(renderWidth, renderHeight);
        }

        if (this.postComposer) {
            this.postComposer.setPixelRatio?.(pixelRatio);
            this.postComposer.setSize?.(renderWidth, renderHeight);
        }

        if (this.godRayMaterial?.uniforms?.uResolution) {
            this.godRayMaterial.uniforms.uResolution.value.set(renderWidth, renderHeight);
        }

        if (this.webgpuWater?.renderTarget) {
            const resolution = this.getWaterReflectionResolution();
            this.webgpuWater.renderTarget.setSize(resolution, resolution);
        }
    }

    setInternalResolution(width, height, mode = 'auto') {
        console.log(`[GoldenForest] Setting internal resolution: ${width}x${height} (${mode})`);
        this.targetResolution = { width, height };
        this.resolutionMode = mode;
        this.onWindowResize(); // Apply changes
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════

    stop() {
        super.stop();
        this.waterNormalsLoadVersion += 1;

        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];

        window.removeEventListener('resize', this.boundOnResize);
        window.removeEventListener('displaySettingsChanged', this.handleDisplaySettingsChange);
        this.handleDisplaySettingsChange = null;

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.disposePostProcessing();
        this.logBaselineReport('stop');

        if (this.birds) {
            this.birds.dispose();
            this.birds = null;
        }

        // Dispose scene objects BEFORE the renderer so the WebGPU node manager
        // is still alive when MeshBasicNodeMaterial.dispose() triggers internal
        // Nodes.delete() cleanup.
        if (typeof this.lakeMesh?.dispose === 'function') {
            this.lakeMesh.dispose();
        }
        if (this.webgpuWater?.renderTarget) {
            this.webgpuWater.renderTarget.dispose();
        }

        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((m) => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        // Renderer disposed AFTER scene materials so WebGPU node tracking is intact.
        if (this.renderer) {
            this.disposeRenderer(this.renderer, { nullInstance: false });
            const container = document.getElementById('golden-forest-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.rockMaterials && this.rockMaterials.length) {
            this.rockMaterials.forEach((material) => {
                material.map?.dispose();
                material.normalMap?.dispose();
                material.roughnessMap?.dispose();
                material.aoMap?.dispose();
            });
        }
        if (this.rockTextureSet) {
            this.rockTextureSet.albedo?.dispose();
            this.rockTextureSet.normal?.dispose();
            this.rockTextureSet.roughness?.dispose();
            this.rockTextureSet.ao?.dispose();
        }
        const waterTextures = new Set([
            this.waterNormalsTexture,
            this.waterNormalsFallbackTexture,
        ].filter(Boolean));
        waterTextures.forEach((texture) => texture.dispose());
        const generatedMaskTextures = new Set([
            this.grassTexture,
            this.silhouetteGrassTexture,
        ].filter(Boolean));
        generatedMaskTextures.forEach((texture) => texture.dispose());

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.foliageInstancedMesh = null;
        this.trunkInstancedMesh = null;
        this.foliageNodeUniforms = null;
        this.trunkNodeUniforms = null;
        this.mountainLayerNodeUniforms = [];
        this.silhouetteMountainNodeUniforms = null;
        this.groundPlane = null;
        this.groundMaterial = null;
        this.groundNodeUniforms = null;
        this.grassMesh = null;
        this.grassMaterial = null;
        this.grassTexture = null;
        this.grassNodeUniforms = null;
        this.silhouetteGrassMesh = null;
        this.silhouetteGrassTexture = null;
        this.silhouetteGrassNodeUniforms = null;
        this.shoreReeds = [];
        this.shoreReedInstances = [];
        this.shoreReedNodeUniforms = [];
        this.framingTrees = [];
        this.framingTreeFoliageNodeUniforms = [];
        this.framingTreeTrunkNodeUniforms = null;
        this.framingTreeTrunkNodeMaterial = null;
        this.starfield = null;
        this.skyDome = null;
        this.skyMaterial = null;
        this.skyNodeUniforms = null;
        this.distanceFogMode = 'off';
        this.distanceFogBands = [];
        this.distanceFogBandUniforms = [];
        this.postComposer = null;
        this.postPasses = null;
        this.postToneMappingState = null;
        this.clouds = [];
        this.cloudMaterials = [];
        this.cloudNodeUniforms = [];
        this.mistPlanes = [];
        this.mistNodeUniforms = [];
        this.godRays = [];
        this.godRayMaterial = null;
        this.godRayNodeUniforms = null;
        this.fireflySystem = null;
        this.fireflyNodes = [];
        this.fireflyInstancedMesh = null;
        this.fireflyInstanceData = null;
        this.fireflyNodeUniforms = null;
        this.fireflyBoostUniform = null;
        this.dustMoteNodes = [];
        this.dustInstancedMesh = null;
        this.dustInstanceData = null;
        this.dustNodeUniforms = null;
        this.drsState = null;
        this.frameCount = 0;
        this.spiritNodeUniforms = [];
        this.spiritWindNodeUniforms = [];
        this.lensFlareNodeUniforms = [];
        this.spirits = [];
        this.auroraPlanes = [];
        this.spiritWinds = [];
        this.fallingLeaves = null;
        this.spiritLight = null;
        this.sun = null;
        this.sunNodeUniforms = null;
        this.sunGlowLayers = [];
        this.dustMotes = null;
        this.mountains = [];
        this.hazeLayers = [];
        this.hazeNodeUniforms = [];
        this.foregroundBranches = [];
        this.silhouetteMountain = null;
        this.silhouetteMountainMaterial = null;
        this.tallMountainPeak = null;
        this.farLeftMountain = null;
        this.extremeLeftMountain = null;
        this.rightHill = null;
        this.farRightMountain = null;
        this.shoreRocks = [];
        this.rockTextureSet = null;
        this.rockMaterials = [];
        this.rockShadowCatcher = null;
        this.webgpuWater = null;
        this.waterNodeUniforms = null;
        if (this.waterReflection) {
            this.waterReflection.target?.removeFromParent?.();
            this.waterReflection.dispose?.();
            this.waterReflection = null;
        }
        this.lakeMesh = null;
        this.shoreFoamMesh = null;
        this.shoreFoamNodeUniforms = null;
        this.lensFlares = [];
        this.mushrooms = [];
        this.mushroomLights = [];
        this.waterNormalsTexture = null;
        this.waterNormalsFallbackTexture = null;

        if (this.debugOverlay?.parentNode) {
            this.debugOverlay.parentNode.removeChild(this.debugOverlay);
        }
        this.debugOverlay = null;
    }
}
