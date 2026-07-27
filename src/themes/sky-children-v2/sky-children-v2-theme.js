import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { clamp } from '@utils/helpers.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SKY_CHILDREN_V2_TETROMINOS } from './sky-children-v2-tetrominos.js';
import { MoodDirector } from './composition/mood-director.js';
import { createSkyMoodDebugOverlay } from './composition/sky-mood-debug-overlay.js';
import { CameraDirector } from './composition/camera-director.js';
import { createSkyDome as buildSkyDome } from './rendering/sky-dome.js';
import { createCloudSea } from './rendering/cloud-sea.js';
import { createValleyTerrainMaterial, createValleyCliffMaterial } from './rendering/valley-terrain.js';
import { createFarRangeMaterial, createSummitLight } from './rendering/far-ranges.js';
import { createMeadowFlowers } from './rendering/meadow-flowers.js';
import { createFloatingIslands } from './rendering/floating-islands.js';
import { createIslandBushes, createIslandArches } from './rendering/island-props.js';
import { createIslandTrees } from './rendering/island-trees.js';
import { createSkyDetailTextureSet, disposeSkyDetailTextureSet } from './rendering/detail-texture.js';
import { createGlints } from './sim/glints.js';
import { createSpirits } from './sim/spirits.js';
import { createSkyBirds } from './sim/sky-birds.js';
import { createSkyTerrainField } from '../shared/sky-core/sky-core-terrain-field.js';
import {
    updateVegetation,
    disposeVegetation,
} from '../shared/sky-core/sky-core-vegetation.js';
import { SkyPipeline } from './post/sky-pipeline.js';

const HERO_SHOTS = Object.freeze([
    'hero-sunset-ridge',
    'hero-sunset-cloud-rim',
    'hero-cloud-sea-wide',
    'hero-cloud-sea-silhouette',
    'hero-interior-haze-entry',
    'hero-interior-haze-depth',
    'hero-swedish-meadow-wide',
    'hero-swedish-meadow-haze',
]);

// Mood-arc sky palette endpoints, lerped by MoodDirector.radiance (cool Reverie
// cloud-sea → warm Triumph sunset). Grounded in the look bible's Cloud Sea +
// Sunset palettes (docs/SKY_CHILDREN_ART_DIRECTION.md). See §2.3 / §3.2.
const SKY_PALETTE = Object.freeze({
    reverie: Object.freeze({
        zenith: new THREE.Color(0x3ea7d8), // beautiful cyan-blue day sky
        mid: new THREE.Color(0x7ad2f2), // light turquoise mid
        horizon: new THREE.Color(0xc6effc), // bright white-blue horizon glow
        sun: new THREE.Color(0xffffff), // brilliant white sun
    }),
    triumph: Object.freeze({
        zenith: new THREE.Color(0x2d6894), // deep sky-blue
        mid: new THREE.Color(0xe69c73), // warm sunset peach
        horizon: new THREE.Color(0xffcca3), // warm glow
        sun: new THREE.Color(0xffe8d1), // soft cream
    }),
});
// Colored shadow fill stays soft grey-cyan (look-bible anchor #1).
const SHADOW_COOL = new THREE.Color(0x576b88);
const SHADOW_WARM = new THREE.Color(0x6e5e80);
const WHITE = new THREE.Color(0xffffff);

const QUALITY_PRESETS = Object.freeze({
    Minimal: Object.freeze({
        renderScale: 0.55,
        terrainSegments: 80,
        mountainMeshes: 3,
        cloudClusters: 2,
        cloudPuffsPerCluster: 2,
        grassNearCount: 2000,
        grassMidCount: 2000,
        flowerHeadsCount: 1000,
        flowerNearCount: 1000,
        flowerInstances: 1000,
        flowerStemsCount: 1200,
        flowerCarpetStrength: 0.9,
        farCoverageStrength: 0.35,
        fogDensity: 0.0012,
        post: Object.freeze({
            enabled: false,
            bloomStrength: 0.35,
            bloomRadius: 0.7,
            bloomThreshold: 0.86,
            exposure: 0.94,
            contrast: 1.14,
            saturation: 1.18,
            vignetteDarkness: 0.32,
            grainStrength: 0.0,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.5,
        adaptiveMaxScale: 0.65,
        adaptiveDownRate: 0.035,
        adaptiveUpRate: 0.018,
    }),
    Low: Object.freeze({
        renderScale: 0.7,
        terrainSegments: 120,
        mountainMeshes: 4,
        cloudClusters: 3,
        cloudPuffsPerCluster: 3,
        grassNearCount: 4000,
        grassMidCount: 3000,
        flowerHeadsCount: 1800,
        flowerNearCount: 1800,
        flowerInstances: 1800,
        flowerStemsCount: 2200,
        flowerCarpetStrength: 0.95,
        farCoverageStrength: 0.42,
        fogDensity: 0.0010,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.45,
            bloomRadius: 0.8,
            bloomThreshold: 0.86,
            exposure: 0.94,
            contrast: 1.14,
            saturation: 1.18,
            vignetteDarkness: 0.32,
            grainStrength: 0.002,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.56,
        adaptiveMaxScale: 0.75,
        adaptiveDownRate: 0.034,
        adaptiveUpRate: 0.018,
    }),
    Medium: Object.freeze({
        renderScale: 0.85,
        terrainSegments: 160,
        mountainMeshes: 5,
        cloudClusters: 4,
        cloudPuffsPerCluster: 4,
        grassNearCount: 8000,
        grassMidCount: 6000,
        flowerHeadsCount: 3000,
        flowerNearCount: 3000,
        flowerInstances: 3000,
        flowerStemsCount: 4000,
        flowerCarpetStrength: 1.0,
        farCoverageStrength: 0.46,
        fogDensity: 0.0008,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.6,
            bloomRadius: 0.95,
            bloomThreshold: 0.86,
            exposure: 0.94,
            contrast: 1.14,
            saturation: 1.18,
            vignetteDarkness: 0.32,
            grainStrength: 0.003,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.64,
        adaptiveMaxScale: 0.9,
        adaptiveDownRate: 0.032,
        adaptiveUpRate: 0.019,
    }),
    High: Object.freeze({
        renderScale: 1.0,
        terrainSegments: 200,
        mountainMeshes: 6,
        cloudClusters: 5,
        cloudPuffsPerCluster: 4,
        grassNearCount: 15000,
        grassMidCount: 12000,
        flowerHeadsCount: 6000,
        flowerNearCount: 6000,
        flowerInstances: 6000,
        flowerStemsCount: 7500,
        flowerCarpetStrength: 1.12,
        farCoverageStrength: 0.58,
        fogDensity: 0.0006,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.85,
            bloomRadius: 1.1,
            bloomThreshold: 0.86,
            exposure: 0.94,
            contrast: 1.14,
            saturation: 1.18,
            vignetteDarkness: 0.32,
            grainStrength: 0.0038,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.72,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.03,
        adaptiveUpRate: 0.02,
    }),
    Ultra: Object.freeze({
        renderScale: 1.0,
        terrainSegments: 250,
        mountainMeshes: 6,
        cloudClusters: 5,
        cloudPuffsPerCluster: 5,
        grassNearCount: 25000,
        grassMidCount: 20000,
        flowerHeadsCount: 10000,
        flowerNearCount: 10000,
        flowerInstances: 10000,
        flowerStemsCount: 12000,
        flowerCarpetStrength: 1.3,
        farCoverageStrength: 0.68,
        fogDensity: 0.0005,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 1.0,
            bloomRadius: 1.25,
            bloomThreshold: 0.86,
            exposure: 0.94,
            contrast: 1.14,
            saturation: 1.18,
            vignetteDarkness: 0.32,
            grainStrength: 0.004,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.8,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.028,
        adaptiveUpRate: 0.021,
    }),
    Extreme: Object.freeze({
        renderScale: 1.0,
        terrainSegments: 300,
        mountainMeshes: 6,
        cloudClusters: 5,
        cloudPuffsPerCluster: 6,
        grassNearCount: 40000,
        grassMidCount: 30000,
        flowerHeadsCount: 15000,
        flowerNearCount: 15000,
        flowerInstances: 15000,
        flowerStemsCount: 18000,
        flowerCarpetStrength: 1.4,
        farCoverageStrength: 0.72,
        fogDensity: 0.0005,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 1.0,
            bloomRadius: 1.35,
            bloomThreshold: 0.86,
            exposure: 0.94,
            contrast: 1.14,
            saturation: 1.18,
            vignetteDarkness: 0.32,
            grainStrength: 0.004,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.8,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.028,
        adaptiveUpRate: 0.021,
    }),
});

function normalizeQualityTier(value, fallback = 'High') {
    const valid = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
    if (!value) return fallback;
    const normalized = String(value).trim().toLowerCase();
    const matched = valid.find((v) => v.toLowerCase() === normalized);
    return matched || fallback;
}

function resolveTierFromEffectQuality(effectQuality = 'High') {
    const normalized = String(effectQuality || 'High').trim().toLowerCase();
    if (normalized === 'minimal') return 'Minimal';
    if (normalized === 'low') return 'Low';
    if (normalized === 'medium') return 'Medium';
    if (normalized === 'ultra') return 'Ultra';
    if (normalized === 'extreme') return 'Extreme';
    return 'High';
}

function listQualityPresets() {
    return Object.keys(QUALITY_PRESETS).map((key) => ({
        tier: key.toLowerCase(),
        label: key,
        ...QUALITY_PRESETS[key],
    }));
}

function percentile(values, ratio = 0.95) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = clamp(Math.ceil(sorted.length * ratio) - 1, 0, sorted.length - 1);
    return sorted[index];
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isWindowsPlatform() {
    if (typeof navigator === 'undefined') return false;
    const platform = String(navigator.userAgentData?.platform || navigator.platform || '');
    return /win/i.test(platform);
}

function getWebGPUAdapterOptions() {
    return isWindowsPlatform() ? undefined : { powerPreference: 'high-performance' };
}

function parseSkyV2Flags() {
    const defaults = {
        forceWebGL: false,
        noPost: false,
        noMRT: false,
        useMRTOptIn: false,
        noCompute: false,
        debug: false,
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
        if (value === '' || value === null) return true;
        const normalized = value.toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    });

    return {
        forceWebGL: readBool('forceWebGL'),
        noPost: readBool('skyV2NoPost', 'noPost'),
        noMRT: readBool('skyV2NoMRT', 'noMRT'),
        useMRTOptIn: readBool('skyV2UseMRT'),
        noCompute: readBool('skyV2NoCompute', 'noCompute'),
        debug: readBool('skyV2Debug'),
        usePost: false,
        useMRT: false,
        useCompute: false,
    };
}

export default class SkyChildrenV2Theme extends BaseTheme {
    constructor(themeName = 'sky-children') {
        super(themeName);

        this.flags = parseSkyV2Flags();
        this.eventUnsubscribers = [];
        this.clock = new THREE.Clock();

        // AAA rebuild spine (Phase 0): one master scalar drives the whole mood arc.
        // Wired additively here — it tracks game activity and feeds the `?skyV2Debug`
        // overlay; subsystems start reading it in later phases.
        this.moodDirector = new MoodDirector();
        this.moodDebugOverlay = null;
        this.cameraDirector = null;

        // Shared uniform block (created in buildScene): sky + fog + every surface
        // read the SAME handles → aerial-perspective fog == sky horizon. Phase 1
        // wires the sky dome; later phases point terrain/clouds/foliage at it too.
        this.u = null;
        this.skyRuntime = null;
        this.cloudSeaRuntime = null;
        this.glintsRuntime = null;
        this.spiritsRuntime = null;
        this.summitLight = null;
        this.meadowRuntime = null;
        this.birdsRuntime = null;
        this.floatingIslandsRuntime = null;
        this.bushesRuntime = null;
        this.archesRuntime = null;
        this.treesRuntime = null;
        // Poly Haven CC0 greyscale detail textures (luminance "tooth" on terrain /
        // cliff / mountains). Tier-gated; null on Minimal/Low. See detail-texture.js.
        this.skyDetailTextures = null;
        this._tmpColor = new THREE.Color();
        this._fogColor = new THREE.Color();

        // Scratch for projecting the sun to screen UV (god-rays/flare) + the cached
        // per-frame post-dynamics object (no per-frame allocation).
        this._sunScreen = new THREE.Vector2(0.5, 0.5);
        this._sunWorld = new THREE.Vector3();
        this._sunNdc = new THREE.Vector3();
        this._camForward = new THREE.Vector3();
        this._warmTint = new THREE.Color(0xffb070);
        this._dynPost = {
            time: 0,
            warmth: 0,
            warmTint: this._warmTint,
            sunScreen: this._sunScreen,
            sunVisible: 0,
            bloomBoost: 0,
            chromaBoost: 0,
            godrayBoost: 0,
        };
        this.animationFrameId = null;
        this.renderAsyncInFlight = false;
        this.fallbackInProgress = false;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.postComposer = null;
        this.isWebGPU = false;
        this.capabilities = {
            isWebGPU: false,
            maxColorAttachments: 1,
            supportsMRT: false,
        };

        this.qualityTier = normalizeQualityTier(
            resolveTierFromEffectQuality(this.getGraphicsQuality()),
            'High',
        );
        this.qualityPreset = QUALITY_PRESETS[this.qualityTier];
        this.dynamicResolutionScale = this.qualityPreset?.renderScale ?? 1;

        this.sunDirection = new THREE.Vector3(0.35, 0.48, -0.72).normalize();
        this.cameraBasePosition = new THREE.Vector3(0, 28, 95);
        this.cameraTarget = new THREE.Vector3(0, 12, -42);

        this.skyMesh = null;
        this.terrainMesh = null;
        this.terrainUnderlayMesh = null;
        this.terrainSkirtMesh = null;
        this.mountainGroup = null;
        this.cloudGroup = null;
        this.grassMesh = null;
        this.flowerMesh = null;

        this.terrainSize = 640;
        this.terrainField = null;
        this.terrainMaterialUniforms = null;
        this.pathDebugEnabled = false;
        this.pathDebugGroup = null;
        this.carpetDebugEnabled = false;
        this.carpetDebugGroup = null;
        this.vegetationDensityScale = 1;
        this.grassDensityScale = 1;
        this.flowerDensityScale = 1;
        this.flowerCarpetStrength = this.qualityPreset?.flowerCarpetStrength ?? 1;
        this.flowerPalettePreset = 'prairie';
        this.flowerGroundLiftHead = this.qualityPreset?.flowerGroundLiftHead ?? 0.66;
        this.flowerGroundLiftStem = this.qualityPreset?.flowerGroundLiftStem ?? 0.34;
        this.flowerSlopeLift = 0.12;
        this.flowerDiagnosticsState = null;
        this.flowerVisibilityGatePassed = false;
        this.flowerDensityValidationFloor = 0.7;
        this.vegetation = {
            grass: null,
            flowers: null,
            motes: null,
            wind: null,
        };

        this.edgeDiagnostics = {
            nearPlane: 0.06,
            clearance: 0,
            groundHere: 0,
            groundAhead: 0,
            skirtEnabled: false,
        };

        this.uniformSets = [];
        this.skyUniforms = null;
        this.cloudRuntime = [];

        this.runtime = {
            time: 0,
            windStrength: 2.5, // Much higher base wind
            windTarget: 2.5,
            eventEnergy: 0,
            eventEnergyTarget: 0,
            comboEnergy: 0,
            comboEnergyTarget: 0,
            cameraPhaseX: Math.random() * Math.PI * 2,
            cameraPhaseY: Math.random() * Math.PI * 2,
        };

        this._vegetationCallbackId = null;
        this._asyncTimeouts = new Set();
        this._asyncWaitResolvers = new Map();

        this.performance = {
            frameTimes: [],
            postTimes: [],
            maxSamples: 720,
            lastFrameNow: 0,
            adaptiveAccumulator: 0,
            lastAdaptiveScale: this.dynamicResolutionScale,
        };

        this.validation = {
            lastVisualGate: null,
            lastPerformanceGate: null,
            lastReport: null,
        };
    }

    async init() {
        // No preload assets required.
    }

    isLifecycleCurrent(generation) {
        return generation === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;
    }

    scheduleAsyncTimeout(callback, delayMs = 0) {
        const timeoutId = window.setTimeout(() => {
            this._asyncTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this._asyncTimeouts.add(timeoutId);
        return timeoutId;
    }

    waitForAsyncTurn(delayMs = 0, generation = this.lifecycleGeneration) {
        return new Promise((resolve) => {
            const timeoutId = window.setTimeout(() => {
                this._asyncTimeouts.delete(timeoutId);
                this._asyncWaitResolvers.delete(timeoutId);
                resolve(this.isLifecycleCurrent(generation));
            }, delayMs);
            this._asyncTimeouts.add(timeoutId);
            this._asyncWaitResolvers.set(timeoutId, resolve);
        });
    }

    clearAsyncTimeouts() {
        [...this._asyncTimeouts].forEach((timeoutId) => {
            window.clearTimeout(timeoutId);
            const resolveWait = this._asyncWaitResolvers.get(timeoutId);
            this._asyncWaitResolvers.delete(timeoutId);
            resolveWait?.(false);
        });
        this._asyncTimeouts.clear();
        this._asyncWaitResolvers.clear();
    }

    getTetrominoConfig() {
        return SKY_CHILDREN_V2_TETROMINOS;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    refreshRuntimeFlags() {
        const parsed = parseSkyV2Flags();
        this.flags = {
            ...this.flags,
            ...parsed,
            // Keep fallbacks sticky through runtime recovery.
            forceWebGL: parsed.forceWebGL || this.flags.forceWebGL,
            noPost: parsed.noPost || this.flags.noPost,
            noMRT: parsed.noMRT || this.flags.noMRT,
            noCompute: parsed.noCompute || this.flags.noCompute,
        };
    }

    applyQualityFromSettings() {
        const requested = resolveTierFromEffectQuality(this.getGraphicsQuality());
        this.qualityTier = normalizeQualityTier(requested, this.qualityTier || 'High');
        this.qualityPreset = QUALITY_PRESETS[this.qualityTier];
        this.dynamicResolutionScale = clamp(
            this.qualityPreset?.renderScale ?? 1,
            this.qualityPreset?.adaptiveMinScale ?? 0.56,
            this.qualityPreset?.adaptiveMaxScale ?? 1,
        );
    }

    getOrCreateThemeContainer() {
        const containerId = `${this.name}-theme`;
        let container = document.getElementById(containerId);
        if (container) return container;

        const backgroundRoot = document.querySelector('.background-container');
        if (!backgroundRoot) {
            console.error('[SkyChildrenV2] Missing .background-container');
            return null;
        }

        container = document.createElement('div');
        container.id = containerId;
        container.className = 'theme-container';
        backgroundRoot.appendChild(container);
        return container;
    }

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        const generation = ownerGeneration;
        this.removeDebugHelpers();
        this.refreshRuntimeFlags();
        this.applyQualityFromSettings();
        this.vegetationDensityScale = 1;
        this.grassDensityScale = 1;
        this.flowerDensityScale = 1;
        this.flowerCarpetStrength = this.qualityPreset?.flowerCarpetStrength ?? this.flowerCarpetStrength ?? 1;
        this.flowerGroundLiftHead = this.qualityPreset?.flowerGroundLiftHead ?? this.flowerGroundLiftHead ?? 0.66;
        this.flowerGroundLiftStem = this.qualityPreset?.flowerGroundLiftStem ?? this.flowerGroundLiftStem ?? 0.34;
        this.flowerDiagnosticsState = null;
        this.flowerVisibilityGatePassed = false;
        this.teardownRuntime();

        const container = this.getOrCreateThemeContainer();
        if (!container) {
            return;
        }
        container.innerHTML = '';

        const rendererReady = await this.initRenderer(container, generation);
        if (!this.isLifecycleCurrent(generation)) {
            return;
        }
        if (!rendererReady) {
            console.error('[SkyChildrenV2] Unable to initialize renderer.');
            container.innerHTML = '<div style="color:#c8d2f0;text-align:center;padding:2em;'
                + 'font-family:sans-serif;">Sky Children V2 requires WebGPU or WebGL node support.</div>';
            return;
        }

        this.setupEventListeners();
        this.handleResize();

        this.performance.lastFrameNow = performance.now();
        this.clock.start();
        this.startAnimation();

        const sceneReady = await this.buildScene(generation);
        if (sceneReady === false || !this.isLifecycleCurrent(generation)) {
            return;
        }
        this.setupPostProcessing();

        // Defer vegetation so the first frame (mountains, sky, terrain) renders immediately
        if (this._vegetationCallbackId !== null) {
            clearTimeout(this._vegetationCallbackId);
        }
        this._vegetationCallbackId = this.scheduleAsyncTimeout(() => {
            this._vegetationCallbackId = null;
            if (this.isLifecycleCurrent(generation) && this.scene && this.terrainField) {
                this.createVegetation();
                this.syncCarpetDebug();
            }
        }, 0);

        this.installDebugHelpers();
        this.installCompatibilityHelpers();

        if (this.flags.debug) {
            this.moodDebugOverlay?.dispose?.();
            this.moodDebugOverlay = createSkyMoodDebugOverlay();
        }

        console.log(
            `[SkyChildrenV2] Scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL'} | tier=${this.qualityTier})`,
        );
    }

    async initRenderer(container, generation = this.lifecycleGeneration) {
        const antialias = this.getAntialiasEnabled();
        const forceWebGL = this.flags.forceWebGL === true;
        const adapterOptions = getWebGPUAdapterOptions();
        let renderer = null;

        if (!forceWebGL) {
            try {
                const webgpuRenderer = new THREE.WebGPURenderer({
                    antialias,
                    forceWebGL: false,
                    powerPreference: adapterOptions?.powerPreference,
                });
                await this.initializeRendererCandidate(webgpuRenderer, {
                    label: 'Sky Children V2 WebGPU renderer init',
                    ownerGeneration: generation,
                });
                if (!this.isLifecycleCurrent(generation)) {
                    this.disposeRenderer(webgpuRenderer, { nullInstance: false });
                    return false;
                }
                renderer = webgpuRenderer;
            } catch (error) {
                if (!this.isLifecycleCurrent(generation)) {
                    return false;
                }
                console.warn('[SkyChildrenV2] WebGPU init failed, trying fallback:', error);
            }
        }

        if (!renderer) {
            try {
                const webgpuFallbackRenderer = new THREE.WebGPURenderer({
                    antialias,
                    forceWebGL: true,
                });
                await this.initializeRendererCandidate(webgpuFallbackRenderer, {
                    label: 'Sky Children V2 WebGL fallback renderer init',
                    ownerGeneration: generation,
                });
                if (!this.isLifecycleCurrent(generation)) {
                    this.disposeRenderer(webgpuFallbackRenderer, { nullInstance: false });
                    return false;
                }
                renderer = webgpuFallbackRenderer;
            } catch (fallbackError) {
                if (!this.isLifecycleCurrent(generation)) {
                    return false;
                }
                console.warn('[SkyChildrenV2] WebGPURenderer forceWebGL fallback failed:', fallbackError);
            }
        }

        if (!renderer) {
            console.error('[SkyChildrenV2] No WebGPURenderer backend available.');
            return false;
        }

        if (!this.isLifecycleCurrent(generation)) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }

        this.renderer = renderer;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.capabilities = {
            isWebGPU: this.isWebGPU,
            maxColorAttachments: renderer?.capabilities?.maxColorAttachments ?? 1,
            supportsMRT: this.isWebGPU && (renderer?.capabilities?.maxColorAttachments ?? 1) > 1,
        };

        this.flags.usePost = !this.flags.noPost && this.qualityPreset?.post?.enabled !== false;
        // MRT selective bloom is OFF by default: it hits pipeline errors on
        // WebGPU/ANGLE-D3D11 (same finding as neon-district). Full-scene bloom with
        // a high threshold is used instead. Opt back in with ?skyV2UseMRT=1.
        this.flags.useMRT = this.flags.usePost
            && this.flags.useMRTOptIn === true
            && this.capabilities.supportsMRT;
        this.flags.useCompute = this.isWebGPU && !this.flags.noCompute;

        if (this.isWebGPU && typeof renderer.onDeviceLost === 'function') {
            renderer.onDeviceLost = (info) => {
                if (!this.isLifecycleCurrent(generation) || this.renderer !== renderer) {
                    return;
                }
                this.requestWebGLFallback('device-lost', info);
            };
        }

        const canvas = renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '0';
        container.appendChild(canvas);

        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x9ec0de, 1.0);

        if (typeof renderer.setAnimationLoop === 'function') {
            renderer.setAnimationLoop(null);
        }

        this.applyRendererScale();
        return true;
    }

    applyRendererScale() {
        if (!this.renderer) return;

        const basePixelRatio = this.getEffectivePixelRatio(2);
        const scaledPixelRatio = clamp(basePixelRatio * this.dynamicResolutionScale, 0.45, 2);

        this.renderer.setPixelRatio(scaledPixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        if (this.postComposer) {
            this.postComposer.setPixelRatio(scaledPixelRatio);
            this.postComposer.setSize(window.innerWidth, window.innerHeight);
            this.postComposer.update({
                resolutionScale: clamp(this.dynamicResolutionScale, 0.5, 1),
            });
        }
    }

    async buildScene(generation = this.lifecycleGeneration) {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xb8d0df, this.qualityPreset.fogDensity);

        this.camera = new THREE.PerspectiveCamera(
            56,
            window.innerWidth / Math.max(window.innerHeight, 1),
            0.06,
            1400,
        );
        this.cameraDirector = new CameraDirector(this.camera);
        this.cameraDirector.snapToRest();

        this.uniformSets = [];

        this.createSharedUniforms();
        this.createDetailTextures();
        this.createLighting();
        this.createSkyDome();
        this.syncUniforms(); // prime palettes before the first frame
        if (!await this.waitForAsyncTurn(0, generation)) return false;

        await this.createTerrainField();
        if (!this.isLifecycleCurrent(generation)) return false;
        if (!await this.waitForAsyncTurn(0, generation)) return false;

        if (!await this.createTerrain(generation)) return false;
        if (!await this.waitForAsyncTurn(0, generation)) return false;

        if (!await this.createMountains(generation)) return false;
        if (!await this.waitForAsyncTurn(0, generation)) return false;

        this.createClouds();
        this.createGlintField();
        this.createMeadowField();
        this.createBirdFlock();
        this.createIslandProps();
        // Vegetation is deferred — see createScene()
        this.syncPathDebug();
        this.syncCarpetDebug();
        return true;
    }

    /** Detail textures are only worth their bandwidth/fetches at Medium tier and up. */
    useDetailTextures() {
        return ['Medium', 'High', 'Ultra', 'Extreme'].includes(this.qualityTier);
    }

    /** Build (or clear) the CC0 luminance detail texture set, gated by tier. */
    createDetailTextures() {
        disposeSkyDetailTextureSet(this.skyDetailTextures);
        this.skyDetailTextures = this.useDetailTextures() ? createSkyDetailTextureSet() : null;
    }

    createMeadowField() {
        if (this.meadowRuntime) {
            if (this.meadowRuntime.mesh?.parent) this.scene.remove(this.meadowRuntime.mesh);
            this.meadowRuntime.dispose();
            this.meadowRuntime = null;
        }
        if (!this.terrainField) return;
        // Colored flower fields on the green islands (Phase 7.1). Count scales with
        // tier; placement reads the flower oracle + anchors to the exact terrain.
        const count = clamp(
            Math.round((this.qualityPreset.grassNearCount ?? 9000) * 0.08),
            800,
            6000,
        );
        const meadow = createMeadowFlowers(this.u, this.terrainField, { count, cloudY: 10 });
        this.meadowRuntime = meadow;
        this.scene.add(meadow.mesh);
    }

    createIslandProps() {
        // Floating islands (7.5), bushes (7.3), arches (7.4), trees — the "alive" props.
        [this.floatingIslandsRuntime, this.bushesRuntime, this.archesRuntime, this.treesRuntime].forEach((rt) => {
            if (rt) {
                if (rt.group?.parent) this.scene.remove(rt.group);
                if (rt.mesh?.parent) this.scene.remove(rt.mesh);
                rt.dispose();
            }
        });

        // Solid rock undersides carry the CC0 skirt rock tooth (when available).
        this.floatingIslandsRuntime = createFloatingIslands(this.u, {
            detailTex: this.skyDetailTextures?.skirt ?? null,
        });
        this.scene.add(this.floatingIslandsRuntime.group);

        if (this.terrainField) {
            const bushCount = clamp(
                Math.round((this.qualityPreset.grassNearCount ?? 9000) * 0.006),
                80,
                500,
            );
            this.bushesRuntime = createIslandBushes(this.u, { count: bushCount, cloudY: 10 });
            this.scene.add(this.bushesRuntime.mesh);

            this.archesRuntime = createIslandArches(this.u, { cloudY: 10, count: 3 });
            this.scene.add(this.archesRuntime.mesh);

            // Stylized trees — scales with tier, fewer at low quality.
            const treeCount = clamp(
                Math.round((this.qualityPreset.grassNearCount ?? 9000) * 0.0035),
                18,
                90,
            );
            this.treesRuntime = createIslandTrees(this.u, { count: treeCount, cloudY: 10 });
            this.scene.add(this.treesRuntime.mesh);
        }
    }

    createBirdFlock() {
        if (this.birdsRuntime) {
            if (this.birdsRuntime.mesh?.parent) this.scene.remove(this.birdsRuntime.mesh);
            this.birdsRuntime.dispose();
            this.birdsRuntime = null;
        }
        const count = clamp(Math.round((this.qualityPreset.mountainMeshes ?? 6) + 5), 5, 12);
        const birds = createSkyBirds(this.u, { count, size: 18 });
        this.birdsRuntime = birds;
        this.scene.add(birds.mesh);
    }

    createGlintField() {
        if (this.glintsRuntime) {
            if (this.glintsRuntime.mesh?.parent) this.scene.remove(this.glintsRuntime.mesh);
            this.glintsRuntime.dispose();
            this.glintsRuntime = null;
        }
        const count = clamp(
            Math.round((this.qualityPreset.grassNearCount ?? 9000) * 0.04),
            300,
            2000,
        );
        const glints = createGlints(this.u, { count });
        this.glintsRuntime = glints;
        this.scene.add(glints.mesh);

        // Colored light-spirits / butterflies drifting over the flower islands.
        if (this.spiritsRuntime) {
            if (this.spiritsRuntime.mesh?.parent) this.scene.remove(this.spiritsRuntime.mesh);
            this.spiritsRuntime.dispose();
            this.spiritsRuntime = null;
        }
        if (this.terrainField) {
            const spiritCount = clamp(Math.round((this.qualityPreset.mountainMeshes ?? 6) * 4 + 14), 16, 48);
            this.spiritsRuntime = createSpirits(this.u, { count: spiritCount });
            this.scene.add(this.spiritsRuntime.mesh);
        }
    }

    createLighting() {
        // Deep purple/blue ambient shadow fill
        const ambient = new THREE.AmbientLight(0xdbe3ff, 0.28);
        this.scene.add(ambient);

        // Strong contrast between warm sky and cool ground
        const hemisphere = new THREE.HemisphereLight(0xffdfb2, 0x4a5373, 0.95);
        this.scene.add(hemisphere);

        // Punchy, very warm golden hour key light
        const sun = new THREE.DirectionalLight(0xffebb2, 0.9); // Reigned in from 1.4 to let the sky colors show
        sun.position.set(110, 80, -180); // Lowering the sun slightly for longer shadows
        this.scene.add(sun);

        this.keyLight = sun;
    }

    createSharedUniforms() {
        // One source of truth for sky/sun/fog/mood. Every surface reads these
        // handles so the aerial-perspective fog == the sky horizon by construction.
        this.u = {
            uTime: uniform(0),
            uRadiance: uniform(0),
            uIgnite: uniform(0),
            uGust: uniform(0),
            uSparkle: uniform(0),
            uSunDir: uniform(this.sunDirection.clone()),
            uSunColor: uniform(SKY_PALETTE.reverie.sun.clone()),
            uSkyZenith: uniform(SKY_PALETTE.reverie.zenith.clone()),
            uSkyMid: uniform(SKY_PALETTE.reverie.mid.clone()),
            uSkyHorizon: uniform(SKY_PALETTE.reverie.horizon.clone()),
            uFogColor: uniform(SKY_PALETTE.reverie.horizon.clone()),
            uRimColor: uniform(new THREE.Color(0xf6c063)),
            uShadowTint: uniform(SHADOW_COOL.clone()),
            uStarFade: uniform(1),
            uCameraPos: uniform(new THREE.Vector3()),
        };
    }

    /** Push MoodDirector state into the shared sky/sun/fog/palette uniforms. */
    syncUniforms() {
        if (!this.u) return;
        const d = this.moodDirector;
        const w = d.radiance;

        this._tmpColor.lerpColors(SKY_PALETTE.reverie.zenith, SKY_PALETTE.triumph.zenith, w);
        this.u.uSkyZenith.value.copy(this._tmpColor);
        this._tmpColor.lerpColors(SKY_PALETTE.reverie.mid, SKY_PALETTE.triumph.mid, w);
        this.u.uSkyMid.value.copy(this._tmpColor);
        this._tmpColor.lerpColors(SKY_PALETTE.reverie.horizon, SKY_PALETTE.triumph.horizon, w);
        this.u.uSkyHorizon.value.copy(this._tmpColor);

        // Aerial-perspective fog = sky horizon, only barely nudged toward white.
        this._fogColor.copy(this._tmpColor).lerp(WHITE, 0.05);
        this.u.uFogColor.value.copy(this._fogColor);
        if (this.scene?.fog) this.scene.fog.color.copy(this._fogColor);

        // Sun color warms + brightens on ignition.
        this._tmpColor.lerpColors(SKY_PALETTE.reverie.sun, SKY_PALETTE.triumph.sun, w)
            .multiplyScalar(1 + d.ignite * 0.5);
        this.u.uSunColor.value.copy(this._tmpColor);

        // Sunset rim accent from the director (dawn-gold → fuchsia tiers).
        this.u.uRimColor.value.setRGB(d.accent.r, d.accent.g, d.accent.b);
        // Colored-shadow fill stays cool-violet.
        this._tmpColor.lerpColors(SHADOW_COOL, SHADOW_WARM, w);
        this.u.uShadowTint.value.copy(this._tmpColor);

        this.u.uRadiance.value = w;
        this.u.uIgnite.value = d.ignite;
        this.u.uGust.value = d.gust;
        this.u.uSparkle.value = d.sparkle;
        this.u.uStarFade.value = Math.max(0, Math.min(1, 1 - w * 2.2));
        this.u.uTime.value = this.runtime.time;
        this.u.uSunDir.value.copy(this.sunDirection);
        if (this.camera) this.u.uCameraPos.value.copy(this.camera.position);
    }

    /** Project the sun to screen UV and gate god-rays/flare on visibility. */
    updateSunScreen() {
        if (!this.camera) return 0;
        this.camera.getWorldDirection(this._camForward);
        const inFront = this.sunDirection.dot(this._camForward) > 0;
        this._sunWorld.copy(this.sunDirection).multiplyScalar(1500).add(this.camera.position);
        this._sunNdc.copy(this._sunWorld).project(this.camera);
        const ux = this._sunNdc.x * 0.5 + 0.5;
        const uy = this._sunNdc.y * 0.5 + 0.5;
        this._sunScreen.set(ux, uy);
        const onScreen = inFront && ux > -0.15 && ux < 1.15 && uy > -0.15 && uy < 1.15;
        return onScreen ? 1 : 0;
    }

    /** Build the cached per-frame post-dynamics object from the MoodDirector. */
    computePostDynamics() {
        const d = this.moodDirector;
        const dp = this._dynPost;
        dp.time = this.runtime.time;
        dp.warmth = d.radiance;
        dp.warmTint = this._warmTint;
        dp.sunScreen = this._sunScreen;
        dp.sunVisible = this.updateSunScreen();
        dp.bloomBoost = d.bloomPunch * 0.5 + d.ignite * 0.3;
        dp.chromaBoost = d.chromaPunch * 0.004;
        dp.godrayBoost = d.flare * 0.5;
        return dp;
    }

    createSkyDome() {
        if (this.skyRuntime) {
            if (this.skyMesh?.parent) this.skyMesh.parent.remove(this.skyMesh);
            this.skyRuntime.dispose();
            this.skyRuntime = null;
        }

        // Sit just inside the camera far plane (1400), enclosing the camera sweep.
        const skyRuntime = buildSkyDome(this.u, { radius: 1200 });
        this.skyMesh = skyRuntime.mesh;
        this.skyRuntime = skyRuntime;
        this.skyUniforms = null; // the new dome reads the shared block, not uniformSets
        this.scene.add(skyRuntime.mesh);
    }

    async createTerrainField() {
        // Gentle rolling meadow: soft, smooth swells (the sharp path/valley carving
        // created steep creases that tessellate into visible stair-steps at the
        // grazing low camera). Trail aesthetic isn't needed for the cloud-sea look.
        this.terrainField = createSkyTerrainField({
            size: this.terrainSize,
            minHeight: -70,
            maxHeight: 90,
            pathWidth: 96,
            pathDepth: 2.4,
            shoulderLift: 1.2,
            pathCenterOffset: -18,
            pathNearSoftening: 0.8,
            nearSofteningStart: 52,
            nearSofteningEnd: 236,
            valleyStrength: 4.5,
        });
    }

    sampleTerrainHeight(x, z) {
        if (!this.terrainField) return 0;
        return this.terrainField.sampleHeight(x, z);
    }

    sampleTerrainNormal(x, z, target = new THREE.Vector3()) {
        if (!this.terrainField) {
            return target.set(0, 1, 0);
        }
        return this.terrainField.sampleNormal(x, z, target);
    }

    createTerrainSkirtGeometry(segments = 96) {
        const half = this.terrainSize * 0.5;
        const minHeight = (this.terrainField?.config?.minHeight ?? -48) - 64;
        const positions = [];
        const uvs = [];

        const pushQuad = (a, b, c, d) => {
            positions.push(
                a.x,
                a.y,
                a.z,
                b.x,
                b.y,
                b.z,
                c.x,
                c.y,
                c.z,
                c.x,
                c.y,
                c.z,
                b.x,
                b.y,
                b.z,
                d.x,
                d.y,
                d.z,
            );
            uvs.push(
                0,
                1,
                1,
                1,
                0,
                0,
                0,
                0,
                1,
                1,
                1,
                0,
            );
        };

        const sampleEdgePoint = (edge, t) => {
            let x = 0;
            let z = 0;
            if (edge === 0) {
                x = -half + (this.terrainSize * t);
                z = -half;
            } else if (edge === 1) {
                x = half;
                z = -half + (this.terrainSize * t);
            } else if (edge === 2) {
                x = half - (this.terrainSize * t);
                z = half;
            } else {
                x = -half;
                z = half - (this.terrainSize * t);
            }

            return new THREE.Vector3(x, this.sampleTerrainHeight(x, z), z);
        };

        for (let edge = 0; edge < 4; edge += 1) {
            for (let i = 0; i < segments; i += 1) {
                const t0 = i / segments;
                const t1 = (i + 1) / segments;
                const topA = sampleEdgePoint(edge, t0);
                const topB = sampleEdgePoint(edge, t1);
                const botA = new THREE.Vector3(topA.x, minHeight, topA.z);
                const botB = new THREE.Vector3(topB.x, minHeight, topB.z);
                pushQuad(topA, topB, botA, botB);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        return geometry;
    }

    async createTerrain(generation = this.lifecycleGeneration) {
        if (this.terrainMesh) {
            if (this.terrainMesh.parent) {
                this.terrainMesh.parent.remove(this.terrainMesh);
            }
            this.disposeObject3D(this.terrainMesh);
            this.terrainMesh = null;
        }
        if (this.terrainUnderlayMesh) {
            if (this.terrainUnderlayMesh.parent) {
                this.terrainUnderlayMesh.parent.remove(this.terrainUnderlayMesh);
            }
            this.disposeObject3D(this.terrainUnderlayMesh);
            this.terrainUnderlayMesh = null;
        }
        if (this.terrainSkirtMesh) {
            if (this.terrainSkirtMesh.parent) {
                this.terrainSkirtMesh.parent.remove(this.terrainSkirtMesh);
            }
            this.disposeObject3D(this.terrainSkirtMesh);
            this.terrainSkirtMesh = null;
        }

        // Denser tessellation than the base preset → smoother ridge silhouettes
        // (the low camera grazes the terrain, exaggerating coarse facets/steps).
        const segments = Math.round((this.qualityPreset.terrainSegments ?? 200) * 1.35);
        const geometry = new THREE.PlaneGeometry(this.terrainSize, this.terrainSize, segments, segments);
        geometry.rotateX(-Math.PI / 2);
        if (!await this.waitForAsyncTurn(0, generation)
            || !this.isLifecycleCurrent(generation)
            || !this.scene) {
            geometry.dispose();
            return false;
        }

        // Painterly terrain material reads the shared uniform block (colored
        // shadows, soft wrap, warm rim, dew glints, aerial perspective == sky).
        // CC0 grass/dirt luminance detail (when present) breaks up the flat green.
        const terrainDetail = this.skyDetailTextures
            ? { grass: this.skyDetailTextures.grass, dirt: this.skyDetailTextures.dirt }
            : null;
        const terrain = new THREE.Mesh(geometry, createValleyTerrainMaterial(this.u, terrainDetail));
        terrain.receiveShadow = false;

        this.terrainMesh = terrain;
        this.terrainMaterialUniforms = null; // no per-material uniforms — reads this.u
        this.scene.add(terrain);

        const underlay = new THREE.Mesh(
            new THREE.PlaneGeometry(this.terrainSize * 2.1, this.terrainSize * 2.1, 1, 1),
            new THREE.MeshBasicMaterial({ color: 0x2e3a4a }),
        );
        underlay.rotation.x = -Math.PI / 2;
        underlay.position.y = (this.terrainField?.config?.minHeight ?? -110) - 56;
        underlay.renderOrder = -2;
        this.terrainUnderlayMesh = underlay;
        this.scene.add(underlay);

        const skirt = new THREE.Mesh(
            this.createTerrainSkirtGeometry(Math.max(32, Math.floor(segments * 0.5))),
            createValleyCliffMaterial(this.u, this.skyDetailTextures?.skirt ?? null),
        );
        skirt.renderOrder = -1;
        this.terrainSkirtMesh = skirt;
        this.scene.add(skirt);
        return true;
    }

    distortMountainGeometry(geometry, seed = 0) {
        geometry.computeBoundingBox();
        const minY = geometry.boundingBox.min.y;
        const maxY = geometry.boundingBox.max.y;
        const height = (maxY - minY) || 1;
        const pos = geometry.attributes.position;

        // Smooth hash for value noise
        const hash = (n) => { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s); };

        // 2D value noise
        const vnoise = (x, z) => {
            const ix = Math.floor(x); const iz = Math.floor(z);
            const fx = x - ix; const fz = z - iz;
            const ux = fx * fx * (3 - 2 * fx); const uz = fz * fz * (3 - 2 * fz);
            const s = seed * 17.431;
            const a = hash(ix + iz * 127.1 + s);
            const b = hash(ix + 1 + iz * 127.1 + s);
            const c = hash(ix + (iz + 1) * 127.1 + s);
            const d = hash(ix + 1 + (iz + 1) * 127.1 + s);
            return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
        };

        // FBM: sum of octaves
        const fbm = (x, z, oct = 5) => {
            let v = 0; let amp = 1; let freq = 1; let sum = 0;
            for (let o = 0; o < oct; o += 1) {
                v += vnoise(x * freq, z * freq) * amp;
                sum += amp; amp *= 0.5; freq *= 2.07;
            }
            return v / sum;
        };

        // Ridge noise: sharp crests via inverted absolute value
        const ridgeN = (x, z) => 1 - Math.abs(fbm(x, z, 3) * 2 - 1);

        for (let i = 0; i < pos.count; i += 1) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            const yNorm = (y - minY) / height;

            const dist = Math.sqrt(x * x + z * z) || 1;
            const dirX = x / dist;
            const dirZ = z / dist;

            // Taper all displacement to zero at the apex — kills the top artifact
            const apexMask = Math.max(0, 1 - yNorm) ** 0.55;

            // Large-scale asymmetric body warping (low-freq, high-amplitude)
            const b = fbm(x * 0.005 + seed * 1.7, z * 0.005 + seed * 2.3, 2);
            const bodyDisplace = (b - 0.5) * height * 0.42
                * apexMask * (Math.sin(yNorm * Math.PI) ** 0.65);

            // Sharp vertical ridges running up the slopes
            const r = ridgeN(x * 0.014 + seed * 4.7, z * 0.014 + seed * 6.1);
            const ridgeDisplace = r * r * height * 0.20 * apexMask * ((1 - yNorm) ** 0.35);

            // High-frequency surface faceting for rocky texture
            const d = fbm(x * 0.048 + seed * 8.3, z * 0.048 + seed * 11.7, 2);
            const detailDisplace = (d - 0.5) * height * 0.065 * apexMask;

            // Rock strata: horizontal banding with noise warp
            const warp = fbm(x * 0.008 + seed * 3.1, z * 0.008 + seed * 4.8, 2) * 5;
            const strataDisplace = Math.sin(yNorm * 16 + warp) * height * 0.028 * apexMask * (1 - yNorm);

            const totalRadial = bodyDisplace + ridgeDisplace + detailDisplace + strataDisplace;
            pos.setX(i, x + dirX * totalRadial);
            pos.setZ(i, z + dirZ * totalRadial);
        }

        pos.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    async createMountains(generation = this.lifecycleGeneration) {
        if (!this.isLifecycleCurrent(generation) || !this.scene) {
            return false;
        }

        if (this.mountainGroup) {
            this.scene.remove(this.mountainGroup);
            this.disposeObject3D(this.mountainGroup);
            this.mountainGroup = null;
        }

        // Far-range silhouette material reads the shared uniform block, so the
        // distant ranges fade into the SAME haze/sky color as everything else.
        // CC0 rock luminance (when present) adds faint painterly tooth to the massif.
        const mountainMaterial = createFarRangeMaterial(this.u, this.skyDetailTextures?.mountain ?? null);

        const group = new THREE.Group();
        let summitLight = null;
        const disposePendingMountains = () => {
            if (summitLight) {
                if (summitLight.group?.parent === group) {
                    group.remove(summitLight.group);
                }
                summitLight.dispose?.();
                summitLight = null;
            }
            this.disposeObject3D(group);
        };
        const yieldToLifecycle = async () => {
            const canContinue = await this.waitForAsyncTurn(0, generation);
            if (!canContinue || !this.isLifecycleCurrent(generation) || !this.scene) {
                disposePendingMountains();
                return false;
            }
            return true;
        };

        // Fewer peaks, spread WIDE with gaps, pushed far back and anchored low so
        // only their upper ridges crest the horizon — open sky + haze between them
        // (the look bible's "far atmosphere" depth band), not a continuous wall.
        const mountainCount = Math.min(this.qualityPreset.mountainMeshes ?? 6, 6);
        const arcStart = -1.4;
        const arcEnd = 1.4;

        for (let i = 0; i < mountainCount; i += 1) {
            const t = mountainCount <= 1 ? 0.5 : i / (mountainCount - 1);
            // Jitter each angle so they don't sit at regular intervals (natural gaps).
            const angle = arcStart + (arcEnd - arcStart) * t + (Math.random() - 0.5) * 0.18;

            const radius = 240 + Math.random() * 160; // wide, gentle bases
            const height = 180 + Math.random() * 120; // lower peaks → leave horizon open
            const geometry = new THREE.ConeGeometry(radius, height, 80, 48, true);
            this.distortMountainGeometry(geometry, (i + 1) * 3.14);

            const mountain = new THREE.Mesh(geometry, mountainMaterial);
            const distance = 540 + Math.random() * 140; // closer Z plane
            mountain.position.set(
                Math.sin(angle) * distance,
                -120 + (Math.random() - 0.5) * 30, // adjusted base elevation
                -Math.cos(angle) * distance - 80,
            );
            mountain.rotation.y = (Math.random() - 0.5) * 0.6;
            mountain.scale.set(
                1.5 + Math.random() * 0.6,
                0.85 + Math.random() * 0.3, // flatter → distant-range read
                1.5 + Math.random() * 0.6,
            );
            group.add(mountain);
            // eslint-disable-next-line no-await-in-loop
            if (!await yieldToLifecycle()) return false;
        }

        // A single centerpiece peak, centered like the holy mountain in the look photo.
        const heroGeometry = new THREE.ConeGeometry(460, 720, 110, 64, true);
        this.distortMountainGeometry(heroGeometry, 12.7);
        const heroPeak = new THREE.Mesh(heroGeometry, mountainMaterial);
        heroPeak.position.set(0, -175, -820);
        heroPeak.scale.set(1.25, 1.55, 1.25); // taller, pointier hero summit (Sky-COTL)
        group.add(heroPeak);
        // eslint-disable-next-line no-await-in-loop
        if (!await yieldToLifecycle()) return false;

        // Summit Light Beam & Horizontal Lens Flare Wings
        const apexPos = new THREE.Vector3(0, 213, -820);
        summitLight = createSummitLight(this.u, apexPos);
        group.add(summitLight.group);

        // A mid-ground peak poking directly through the cloud-sea in the mid-distance on the left.
        const midGeometry = new THREE.ConeGeometry(130, 300, 60, 36, true);
        this.distortMountainGeometry(midGeometry, 42.1);
        const midPeak = new THREE.Mesh(midGeometry, mountainMaterial);
        midPeak.position.set(-150, -80, -480);
        midPeak.scale.set(1.4, 1.3, 1.4);
        group.add(midPeak);
        // eslint-disable-next-line no-await-in-loop
        if (!await yieldToLifecycle()) return false;

        const wingConfigs = [
            {
                x: -720, y: -120, z: -600, radius: 320, height: 380, seed: 21.4, rotY: -0.45,
            },
            {
                x: 740, y: -130, z: -620, radius: 350, height: 410, seed: 24.1, rotY: 0.38,
            },
        ];
        for (let i = 0; i < wingConfigs.length; i += 1) {
            const config = wingConfigs[i];
            const wingGeometry = new THREE.ConeGeometry(config.radius, config.height, 80, 48, true);
            this.distortMountainGeometry(wingGeometry, config.seed);
            const wing = new THREE.Mesh(wingGeometry, mountainMaterial);
            wing.position.set(config.x, config.y, config.z);
            wing.rotation.y = config.rotY;
            wing.scale.set(1.5, 0.9, 1.5);
            group.add(wing);
            // eslint-disable-next-line no-await-in-loop
            if (!await yieldToLifecycle()) return false;
        }

        this.summitLight = summitLight;
        this.mountainGroup = group;
        this.scene.add(group);
        return true;
    }

    clearPathDebug() {
        if (!this.pathDebugGroup) return;
        if (this.pathDebugGroup.parent) {
            this.pathDebugGroup.parent.remove(this.pathDebugGroup);
        }
        this.disposeObject3D(this.pathDebugGroup);
        this.pathDebugGroup = null;
    }

    syncPathDebug() {
        if (!this.pathDebugEnabled || !this.scene || !this.terrainField) {
            this.clearPathDebug();
            return;
        }

        this.clearPathDebug();
        const group = new THREE.Group();
        const laneOffsets = [0, -this.terrainField.config.pathWidth * 0.36, this.terrainField.config.pathWidth * 0.36];
        const xMin = -this.terrainSize * 0.5;
        const xMax = this.terrainSize * 0.5;
        const sampleCount = 96;

        laneOffsets.forEach((offset, index) => {
            const points = [];
            for (let i = 0; i <= sampleCount; i += 1) {
                const t = i / sampleCount;
                const x = xMin + ((xMax - xMin) * t);
                const z = this.terrainField.samplePathCenter(x) + offset;
                const y = this.sampleTerrainHeight(x, z) + 0.4 + index * 0.03;
                points.push(new THREE.Vector3(x, y, z));
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: index === 0 ? 0xffd4ad : 0xf5e2c5,
                transparent: true,
                opacity: index === 0 ? 0.95 : 0.62,
            });
            const line = new THREE.Line(geometry, material);
            group.add(line);
        });

        group.name = 'sky-v2-path-debug';
        this.pathDebugGroup = group;
        this.scene.add(group);
    }

    clearCarpetDebug() {
        if (!this.carpetDebugGroup) return;
        if (this.carpetDebugGroup.parent) {
            this.carpetDebugGroup.parent.remove(this.carpetDebugGroup);
        }
        this.disposeObject3D(this.carpetDebugGroup);
        this.carpetDebugGroup = null;
    }

    syncCarpetDebug() {
        if (!this.carpetDebugEnabled || !this.scene || !this.terrainField) {
            this.clearCarpetDebug();
            return;
        }

        const sampleCarpet = this.vegetation.flowers?.sampleCarpet;
        if (typeof sampleCarpet !== 'function') {
            this.clearCarpetDebug();
            return;
        }

        this.clearCarpetDebug();

        const positions = [];
        const colors = [];
        const size = this.terrainSize;
        const xMin = -size * 0.5;
        const xMax = size * 0.5;
        const zMin = -size * 0.44;
        const zMax = size * 0.2;
        const step = 14;

        for (let x = xMin; x <= xMax; x += step) {
            for (let z = zMin; z <= zMax; z += step) {
                const sample = sampleCarpet.call(this.vegetation.flowers, x, z);
                if (!sample || sample.density < 0.24) continue;

                positions.push(x, this.sampleTerrainHeight(x, z) + 0.72, z);
                if (sample.family === 'pink') {
                    colors.push(0.96, 0.56, 0.78);
                } else if (sample.family === 'yellow') {
                    colors.push(0.96, 0.86, 0.46);
                } else {
                    colors.push(0.95, 0.94, 0.88);
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: 2.6,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
        });
        const points = new THREE.Points(geometry, material);
        points.name = 'sky-v2-carpet-debug-points';

        const group = new THREE.Group();
        group.name = 'sky-v2-carpet-debug';
        group.add(points);
        this.carpetDebugGroup = group;
        this.scene.add(group);
    }

    createClouds() {
        if (this.cloudGroup?.parent) {
            this.scene.remove(this.cloudGroup);
        }
        if (this.cloudSeaRuntime) {
            this.cloudSeaRuntime.dispose();
            this.cloudSeaRuntime = null;
        }
        this.cloudGroup = null;
        this.cloudRuntime = [];

        // HERO: the cloud sea (deck + drifting hero puffs) reads the shared uniform
        // block, so it warms/cools with the MoodDirector automatically. The deck
        // scrolls via u.uTime; the puff clusters drift via updateCloudDrift().
        const cloudSea = createCloudSea(this.u, {
            deck: true, // cloud-sea floor re-enabled with the P5 high-vantage camera
            clusterCount: Math.min(this.qualityPreset.cloudClusters ?? 6, 6),
            puffsPerCluster: this.qualityPreset.cloudPuffsPerCluster,
        });
        this.cloudSeaRuntime = cloudSea;
        this.cloudGroup = cloudSea.group;
        this.cloudRuntime = cloudSea.clusters;
        this.scene.add(cloudSea.group);
    }

    disposeVegetationSystems() {
        disposeVegetation(this.vegetation);
        this.vegetation = {
            grass: null,
            flowers: null,
        };
        this.grassMesh = null;
        this.flowerMesh = null;
        this.clearCarpetDebug();
    }

    applyVegetationDensityScale() {
        const grassScale = clamp(this.grassDensityScale, 0.1, 2);
        const flowerScale = clamp(this.flowerDensityScale, 0.1, 2);
        this.grassDensityScale = grassScale;
        this.flowerDensityScale = flowerScale;
        this.vegetationDensityScale = (grassScale + flowerScale) * 0.5;

        if (this.vegetation.grass?.setDensityScale) {
            this.vegetation.grass.setDensityScale(grassScale);
        }
        if (this.vegetation.flowers?.setDensityScale) {
            this.vegetation.flowers.setDensityScale(flowerScale);
        }

        const baseFarCoverage = this.qualityPreset?.farCoverageStrength ?? 0.56;
        if (this.terrainMaterialUniforms?.uFarCoverageStrength) {
            this.terrainMaterialUniforms.uFarCoverageStrength.value = clamp(
                baseFarCoverage * Math.sqrt((grassScale + flowerScale) * 0.5),
                0.22,
                1.2,
            );
        }
        if (this.terrainMaterialUniforms?.uFlowerFarTintStrength) {
            const baseFarTint = this.qualityPreset?.flowerFarTintStrength ?? 0.42;
            const targetCoverage = Math.max(0.01, this.qualityPreset?.flowerCarpetCoverageTarget ?? 0.1);
            const coverageRatio = (this.flowerDiagnosticsState?.coverage10 ?? targetCoverage) / targetCoverage;
            const coverageBoost = clamp(coverageRatio, 0.45, 1.45);
            this.terrainMaterialUniforms.uFlowerFarTintStrength.value = clamp(
                baseFarTint * Math.sqrt(flowerScale) * coverageBoost,
                0.08,
                1.4,
            );
        }
    }

    createVegetation() {
        if (!this.scene || !this.terrainField) return;

        this.disposeVegetationSystems();

        // The legacy sky-core vegetation renders broken under this rebuild (missing
        // aPhase/aLean/aColor instance attrs → stray white sprites; 0 flower anchors).
        // Disabled wholesale; the painterly terrain carries the ground and a proper
        // analytic meadow + glints is the Phase-4 follow-up (sim/glints.js, meadow.js).
        // See docs/SKY_CHILDREN_V2_AAA_PLAN.md §4.
        this.vegetation = { grass: null, flowers: null };
        this.grassMesh = null;
        this.flowerMesh = null;

        this.refreshFlowerDiagnostics();
        this.applyVegetationDensityScale();
        this.syncCarpetDebug();
    }

    refreshFlowerDiagnostics() {
        const diagnostics = this.vegetation.flowers?.diagnostics?.() || null;
        if (!diagnostics) {
            this.flowerDiagnosticsState = null;
            this.flowerVisibilityGatePassed = false;
            return null;
        }

        const anchorMin = this.qualityPreset?.flowerAnchorMin ?? 0;
        const coverageTarget = this.qualityPreset?.flowerCarpetCoverageTarget ?? 0.1;
        const anchors = diagnostics.acceptedAnchors ?? diagnostics.anchors ?? 0;
        const coveragePrimary = diagnostics.coverage05 ?? diagnostics.coverage10 ?? 0;
        const coverage20 = diagnostics.coverage20 ?? 0;
        const coverage20Target = Math.min(0.04, coverageTarget * 0.12);
        const familyAccepted = diagnostics.familyShareAccepted || { yellow: 0, pink: 0, white: 1 };
        const whiteShareCap = this.qualityPreset?.flowerWhiteShareMax ?? 0.1;
        const pass = anchors >= anchorMin
            && coveragePrimary >= coverageTarget
            && familyAccepted.white <= whiteShareCap + 0.02;

        this.flowerVisibilityGatePassed = pass;
        this.flowerDiagnosticsState = {
            ...diagnostics,
            tier: this.qualityTier,
            anchorMin,
            coverageTarget,
            coveragePrimary,
            coverage20Target,
            whiteShareCap,
            pass,
            timestamp: new Date().toISOString(),
        };

        if (anchors < anchorMin) {
            console.warn(
                '[SkyChildrenV2] Flower anchors below tier minimum '
                + `(${anchors} < ${anchorMin}) on tier=${this.qualityTier}`,
                this.flowerDiagnosticsState,
            );
        }

        if (coveragePrimary < coverageTarget) {
            console.warn(
                '[SkyChildrenV2] Flower carpet coverage below target '
                + `(${coveragePrimary.toFixed(3)} < ${coverageTarget.toFixed(3)})`,
                this.flowerDiagnosticsState,
            );
        }

        if (coverage20 < coverage20Target) {
            console.warn(
                '[SkyChildrenV2] Dense flower coverage too low '
                + `(${coverage20.toFixed(3)} < ${coverage20Target.toFixed(3)})`,
                this.flowerDiagnosticsState,
            );
        }

        return this.flowerDiagnosticsState;
    }

    getVegetationState() {
        return {
            densityScale: this.vegetationDensityScale,
            grassDensityScale: this.grassDensityScale,
            flowerDensityScale: this.flowerDensityScale,
            flowerCarpetStrength: this.flowerCarpetStrength,
            flowerPalettePreset: this.flowerPalettePreset,
            flowerGroundLiftHead: this.flowerGroundLiftHead,
            flowerGroundLiftStem: this.flowerGroundLiftStem,
            flowerSlopeLift: this.flowerSlopeLift,
            grass: this.vegetation.grass?.state?.() || null,
            flowers: this.vegetation.flowers?.state?.() || null,
            flowerDiagnostics: this.flowerDiagnosticsState,
            farCoverageStrength: this.terrainMaterialUniforms?.uFarCoverageStrength?.value ?? null,
            flowerFarTintStrength: this.terrainMaterialUniforms?.uFlowerFarTintStrength?.value ?? null,
        };
    }

    setVegetationDensity(scale = 1) {
        const normalized = clamp(Number(scale) || 1, 0.1, 2);
        this.grassDensityScale = normalized;
        this.flowerDensityScale = normalized;
        this.applyVegetationDensityScale();
        return this.getVegetationState();
    }

    setCarpetStrength(value = 1) {
        const normalized = clamp(Number(value) || 1, 0.2, 2.4);
        this.flowerCarpetStrength = normalized;
        if (this.vegetation.flowers?.setCarpetStrength) {
            this.vegetation.flowers.setCarpetStrength(normalized);
            this.refreshFlowerDiagnostics();
            this.applyVegetationDensityScale();
            this.syncCarpetDebug();
            return this.getVegetationState();
        }
        this.createVegetation();
        return this.getVegetationState();
    }

    setFlowerPalette(preset = 'prairie') {
        const normalized = String(preset || 'prairie').trim().toLowerCase();
        this.flowerPalettePreset = normalized || 'prairie';
        if (this.vegetation.flowers?.setPalette) {
            this.vegetation.flowers.setPalette(this.flowerPalettePreset);
            this.refreshFlowerDiagnostics();
            this.applyVegetationDensityScale();
            this.syncCarpetDebug();
            return this.getVegetationState();
        }
        this.createVegetation();
        return this.getVegetationState();
    }

    rebuildFlowers() {
        if (this.vegetation.flowers?.rebuild) {
            this.vegetation.flowers.rebuild();
            this.refreshFlowerDiagnostics();
            this.applyVegetationDensityScale();
            this.syncCarpetDebug();
            return this.getVegetationState();
        }
        this.createVegetation();
        return this.getVegetationState();
    }

    setFlowerLift(headLift = this.flowerGroundLiftHead, stemLift = this.flowerGroundLiftStem) {
        const nextHead = clamp(Number(headLift) || this.flowerGroundLiftHead, 0.2, 1.8);
        const nextStem = clamp(Number(stemLift) || this.flowerGroundLiftStem, 0.15, 1.4);
        this.flowerGroundLiftHead = nextHead;
        this.flowerGroundLiftStem = nextStem;

        if (this.vegetation.flowers?.setGroundLift) {
            this.vegetation.flowers.setGroundLift(nextHead, nextStem, this.flowerSlopeLift);
            this.refreshFlowerDiagnostics();
            this.applyVegetationDensityScale();
            this.syncCarpetDebug();
            return this.getVegetationState();
        }

        this.createVegetation();
        return this.getVegetationState();
    }

    flowerDiagnostics() {
        return this.flowerDiagnosticsState;
    }

    setPathDebug(enabled = true) {
        this.pathDebugEnabled = enabled === true;
        this.syncPathDebug();
        return this.pathDebugEnabled;
    }

    setCarpetDebug(enabled = true) {
        this.carpetDebugEnabled = enabled === true;
        this.syncCarpetDebug();
        return this.carpetDebugEnabled;
    }

    getEdgeState() {
        return {
            ...this.edgeDiagnostics,
            nearPlane: this.camera?.near ?? this.edgeDiagnostics.nearPlane,
            skirtEnabled: !!this.terrainSkirtMesh,
            underlayEnabled: !!this.terrainUnderlayMesh,
        };
    }

    setupPostProcessing() {
        if (this.postComposer) {
            this.postComposer.dispose();
            this.postComposer = null;
        }

        if (!this.flags.usePost) {
            return;
        }

        const postPreset = this.qualityPreset?.post || {};
        // Sky-specific cinematic extras (god-rays / CA / soft-focus diffusion)
        // scale gently with tier via the bloom radius as a proxy for "richness".
        const richness = clamp((postPreset.bloomRadius ?? 1.0) - 0.6, 0, 1);
        this.postComposer = new SkyPipeline(this.renderer, this.scene, this.camera, {
            useMRT: this.flags.useMRT,
            // CRISP bright-day look (Sky-COTL reference): minimal bloom/diffusion
            // veil, threshold HIGH so only the sun disc blooms, vivid saturation.
            bloomStrength: (postPreset.bloomStrength ?? 0.85) * 0.3,
            bloomRadius: postPreset.bloomRadius,
            bloomThreshold: Math.max(postPreset.bloomThreshold ?? 0.5, 0.92),
            exposure: 0.95,
            contrast: Math.max(postPreset.contrast ?? 1.12, 1.2),
            saturation: Math.max(postPreset.saturation ?? 1.2, 1.42),
            vignette: Math.max(postPreset.vignetteDarkness ?? 0.26, 0.48),
            grain: (postPreset.grainStrength ?? 0.004) * 0.6,
            // Tight, subtle optics — the heavy CA/diffusion/god-rays were the haze veil.
            chromatic: 0.0002 + richness * 0.0002,
            godray: 0.1 + richness * 0.12,
            diffusion: 0.012 + richness * 0.012,
            dither: 0.0015,
        });

        if (!this.postComposer?.isEnabled?.()) {
            this.flags.usePost = false;
            this.postComposer?.dispose?.();
            this.postComposer = null;
            return;
        }

        this.postComposer.setPixelRatio(this.renderer.getPixelRatio?.() || 1);
        this.postComposer.setSize(window.innerWidth, window.innerHeight);
    }

    setupEventListeners() {
        const onResize = () => this.handleResize();
        window.addEventListener('resize', onResize);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', onResize));

        const onPointerMove = (e) => {
            if (this.cameraDirector) {
                const nx = (e.clientX / window.innerWidth) * 2 - 1;
                const ny = (e.clientY / window.innerHeight) * 2 - 1;
                this.cameraDirector.setPointer(nx, ny);
            }
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        this.eventUnsubscribers.push(() => window.removeEventListener('pointermove', onPointerMove));

        const onWindowSettings = () => this.handleSettingsChanged();
        window.addEventListener('settingsChanged', onWindowSettings);
        this.eventUnsubscribers.push(() => window.removeEventListener('settingsChanged', onWindowSettings));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.SETTINGS_CHANGED, () => this.handleSettingsChanged()));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.LINE_CLEAR, (payload = {}) => {
            const lineCount = Number(payload.lineCount) || 1;
            this.runtime.eventEnergyTarget = clamp(
                this.runtime.eventEnergyTarget + lineCount * 0.2,
                0,
                3,
            );
            this.runtime.windTarget = clamp(this.runtime.windTarget + lineCount * 0.14, 0.74, 2.8);
            this.moodDirector.onLineClear(lineCount, Number(payload.comboCount) || 0);
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.COMBO, (payload = {}) => {
            const comboCount = Number(payload.comboCount) || 1;
            if (comboCount <= 1) return;
            this.runtime.comboEnergyTarget = clamp(this.runtime.comboEnergyTarget + comboCount * 0.14, 0, 3);
            this.runtime.windTarget = clamp(this.runtime.windTarget + comboCount * 0.1, 0.74, 3.0);
            this.moodDirector.onCombo(comboCount);
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.PIECE_LOCK, () => {
            this.runtime.eventEnergyTarget = clamp(this.runtime.eventEnergyTarget + 0.07, 0, 3);
            this.moodDirector.onPieceLock();
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.HARD_DROP, () => {
            this.moodDirector.onHardDrop();
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.LEVEL_UP, () => {
            this.moodDirector.onLevelUp();
        }));
    }

    handleSettingsChanged() {
        const requestedTier = resolveTierFromEffectQuality(this.getGraphicsQuality());
        this.setQualityTier(requestedTier, { rebuild: true });
    }

    setQualityTier(tier, options = {}) {
        const normalized = normalizeQualityTier(tier, this.qualityTier);
        if (normalized === this.qualityTier && options.rebuild !== true) {
            return false;
        }

        this.qualityTier = normalized;
        this.qualityPreset = QUALITY_PRESETS[normalized];
        this.flowerCarpetStrength = this.qualityPreset?.flowerCarpetStrength ?? this.flowerCarpetStrength ?? 1;
        this.flowerGroundLiftHead = this.qualityPreset?.flowerGroundLiftHead ?? this.flowerGroundLiftHead ?? 0.66;
        this.flowerGroundLiftStem = this.qualityPreset?.flowerGroundLiftStem ?? this.flowerGroundLiftStem ?? 0.34;
        this.flowerDiagnosticsState = null;
        this.flowerVisibilityGatePassed = false;
        this.dynamicResolutionScale = clamp(
            this.dynamicResolutionScale,
            this.qualityPreset.adaptiveMinScale,
            this.qualityPreset.adaptiveMaxScale,
        );

        if (this.scene?.fog) {
            this.scene.fog.density = this.qualityPreset.fogDensity;
        }

        this.flags.usePost = !this.flags.noPost && this.qualityPreset?.post?.enabled !== false;
        this.flags.useMRT = this.flags.usePost
            && this.flags.useMRTOptIn === true
            && this.capabilities.supportsMRT;

        this.applyRendererScale();
        this.applyVegetationDensityScale();

        if (options.rebuild === true && this.scene) {
            const generation = this.lifecycleGeneration;
            // The sky dome reads the shared uniform block (not uniformSets) and is
            // tier-independent, so it survives the rebuild untouched.
            this.uniformSets = [];
            (async () => {
                await this.createTerrainField();
                if (!this.isLifecycleCurrent(generation)) return;
                if (!await this.createTerrain(generation)) return;
                if (!await this.createMountains(generation)) return;
                if (!this.isLifecycleCurrent(generation)) return;
                this.createClouds();

                if (!await this.waitForAsyncTurn(0, generation)) return;
                this.createVegetation();
                this.syncPathDebug();
                this.syncCarpetDebug();
                this.setupPostProcessing();
            })().catch((error) => {
                if (this.isLifecycleCurrent(generation)) {
                    console.error('[SkyChildrenV2] Quality rebuild failed:', error);
                }
            });
        }

        return true;
    }

    handleResize() {
        if (!this.renderer || !this.camera) return;

        const width = window.innerWidth;
        const height = Math.max(1, window.innerHeight);

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
        this.applyRendererScale();
    }

    updateUniforms() {
        const { time, windStrength } = this.runtime;

        for (let i = 0; i < this.uniformSets.length; i += 1) {
            const uniforms = this.uniformSets[i];
            if (!uniforms) continue;
            if (uniforms.uTime) uniforms.uTime.value = time;
            if (uniforms.uWindStrength) uniforms.uWindStrength.value = windStrength;
            if (uniforms.uSunDirection) uniforms.uSunDirection.value.copy(this.sunDirection);
        }

        updateVegetation(this.vegetation, time, {
            strength: windStrength,
            gust: this.runtime.eventEnergy * 0.12 + this.runtime.comboEnergy * 0.16,
            sunDirection: this.sunDirection,
        });

        if (this.vegetation.motes) {
            this.vegetation.motes.update(time, windStrength, this.terrainField);
        }

        if (this.vegetation.wind) {
            this.vegetation.wind.update(time, windStrength, this.terrainField);
        }
    }

    updateCloudDrift(deltaSeconds) {
        for (let i = 0; i < this.cloudRuntime.length; i += 1) {
            const cluster = this.cloudRuntime[i];
            const driftSpeed = cluster.userData?.driftSpeed ?? 0.8;
            const driftSpan = cluster.userData?.driftSpan ?? 380;
            const baseY = cluster.userData?.baseY ?? 72;
            const bobPhase = cluster.userData?.bobPhase ?? 0;
            const bobAmp = cluster.userData?.bobAmp ?? 1.0;

            cluster.position.x += driftSpeed * deltaSeconds;
            if (cluster.position.x > driftSpan) {
                cluster.position.x = -driftSpan;
            }

            const targetY = baseY + Math.sin(this.runtime.time * 0.34 + bobPhase) * bobAmp;
            cluster.position.y += (targetY - cluster.position.y) * clamp(deltaSeconds * 1.4, 0, 1);
            // Keep puffs above the terrain hills (maxHeight ~90) but allow them
            // down toward the horizon as a cloud bank — never into the ground.
            cluster.position.y = clamp(cluster.position.y, 110, 300);
        }
    }

    updateCamera() {
        if (!this.camera) return;

        if (this.cameraDirector) {
            const nextX = this.camera.position.x;
            const nextY = this.camera.position.y;
            const nextZ = this.camera.position.z;
            const groundHere = this.sampleTerrainHeight(nextX, nextZ);
            const groundAhead = this.sampleTerrainHeight(nextX * 0.72, nextZ - 34);

            this.edgeDiagnostics = {
                nearPlane: this.camera.near,
                cameraY: nextY,
                clearance: Math.min(nextY - groundHere, nextY - groundAhead),
                clearanceHere: nextY - groundHere,
                clearanceAhead: nextY - groundAhead,
                groundHere,
                groundAhead,
                skirtEnabled: !!this.terrainSkirtMesh,
                underlayEnabled: !!this.terrainUnderlayMesh,
            };
        }
    }

    updateSunDirection() {
        // Low, warm sunset sun, off to one side and into the scene (sits near the
        // horizon for the golden-hour read + drives the horizon glow / god-rays).
        const yaw = -0.58 + Math.sin(this.runtime.time * 0.03) * 0.06;
        const lift = 0.18 + Math.sin(this.runtime.time * 0.05) * 0.03;

        this.sunDirection.set(
            Math.sin(yaw),
            lift,
            -Math.cos(yaw),
        ).normalize();

        if (this.keyLight) {
            this.keyLight.position.copy(this.sunDirection).multiplyScalar(260);
        }
        if (this.u) {
            this.u.uSunDir.value.copy(this.sunDirection);
        }
    }

    recordPerformanceSample(value, scope = 'frame') {
        if (!Number.isFinite(value) || value <= 0) return;

        const samples = scope === 'post' ? this.performance.postTimes : this.performance.frameTimes;
        samples.push(value);
        if (samples.length > this.performance.maxSamples) {
            samples.splice(0, samples.length - this.performance.maxSamples);
        }
    }

    applyAdaptiveQuality(deltaSeconds, frameMs) {
        this.performance.adaptiveAccumulator += deltaSeconds;
        if (this.performance.adaptiveAccumulator < 0.8) return;
        this.performance.adaptiveAccumulator = 0;

        const recent = this.performance.frameTimes.slice(-90);
        const avgFrameMs = average(recent);
        if (!Number.isFinite(avgFrameMs) || avgFrameMs <= 0) return;

        const targetFrameMs = this.qualityPreset.targetFrameMs ?? 16.7;
        let nextScale = this.dynamicResolutionScale;

        if (avgFrameMs > targetFrameMs + 3.0 || frameMs > targetFrameMs + 5.0) {
            nextScale -= this.qualityPreset.adaptiveDownRate ?? 0.03;
            // Adaptive post processing bypass: if we hit minimum render scale and are still struggling, turn off post processing.
            if (nextScale <= (this.qualityPreset.adaptiveMinScale ?? 0.56) + 0.01 && this.flags.usePost) {
                this.flags.usePost = false;
                this.setupPostProcessing();
            }
        } else if (avgFrameMs < targetFrameMs - 1.2) {
            if (nextScale < (this.qualityPreset.adaptiveMaxScale ?? 1.0) - 0.01) {
                nextScale += this.qualityPreset.adaptiveUpRate ?? 0.02;
            } else if (!this.flags.usePost && !this.flags.noPost && this.qualityPreset?.post?.enabled !== false) {
                // Re-enable post processing once performance recovers and resolution scale maxes out.
                this.flags.usePost = true;
                this.setupPostProcessing();
            }
        }

        nextScale = clamp(
            nextScale,
            this.qualityPreset.adaptiveMinScale ?? 0.56,
            this.qualityPreset.adaptiveMaxScale ?? 1.0,
        );

        if (Math.abs(nextScale - this.dynamicResolutionScale) > 0.01) {
            this.dynamicResolutionScale = nextScale;
            this.applyRendererScale();
            this.performance.lastAdaptiveScale = nextScale;
        }
    }

    renderScene(deltaSeconds) {
        if (!this.renderer || !this.scene || !this.camera) return;

        try {
            if (this.postComposer && this.flags.usePost) {
                const start = performance.now();
                this.postComposer.update(this.computePostDynamics());
                this.postComposer.render(deltaSeconds);
                const postMs = performance.now() - start;
                this.recordPerformanceSample(postMs, 'post');
                return;
            }

            // Synchronous render — the renderer is already awaited-init in
            // initRenderer, so render() is correct (renderAsync() is deprecated).
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.warn('[SkyChildrenV2] Render failed:', error);
            this.requestWebGLFallback('render-failure', error);
        }
    }

    startAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        const loop = (now) => {
            if (!this.isActive) return;

            const previousNow = this.performance.lastFrameNow || now;
            const frameMs = Math.max(0.001, now - previousNow);
            this.performance.lastFrameNow = now;

            const deltaSeconds = clamp(frameMs / 1000, 0.0001, 0.06);
            this.runtime.time += deltaSeconds;
            const ambientGust = 0.12
                + Math.sin(this.runtime.time * 0.46) * 0.11
                + Math.sin(this.runtime.time * 1.18) * 0.05;
            const baseWind = 0.86 + ambientGust;

            this.runtime.eventEnergy += (this.runtime.eventEnergyTarget - this.runtime.eventEnergy) * 0.12;
            this.runtime.comboEnergy += (this.runtime.comboEnergyTarget - this.runtime.comboEnergy) * 0.1;
            this.runtime.windStrength += (this.runtime.windTarget - this.runtime.windStrength) * 0.08;

            this.runtime.eventEnergyTarget *= 0.92;
            this.runtime.comboEnergyTarget *= 0.9;
            const energeticLift = this.runtime.eventEnergy * 0.04 + this.runtime.comboEnergy * 0.05;
            this.runtime.windTarget += (baseWind + energeticLift - this.runtime.windTarget) * 0.03;

            // AAA spine (Phase 0): advance the mood arc + reflect it in the debug overlay.
            // Visuals are unchanged until later phases read this director.
            this.moodDirector.update(deltaSeconds);

            if (this.cameraDirector) {
                this.cameraDirector.update(deltaSeconds);
                this.cameraDirector.punchFromDirector(this.moodDirector.cameraPunch);
            }

            this.updateSunDirection();
            this.updateUniforms();
            this.updateCloudDrift(deltaSeconds);
            this.updateCamera(deltaSeconds);
            if (this.summitLight) {
                this.summitLight.update(this.camera);
            }
            if (this.birdsRuntime) {
                const flockScatter = Math.max(this.moodDirector.scatter, this.moodDirector.gust * 0.6);
                this.birdsRuntime.update(this.runtime.time, flockScatter);
            }
            if (this.floatingIslandsRuntime) {
                this.floatingIslandsRuntime.update(this.runtime.time);
            }
            this.syncUniforms();

            if (this.moodDebugOverlay) {
                this.moodDebugOverlay.update(this.moodDirector, {
                    windStrength: this.runtime.windStrength,
                });
            }

            this.renderScene(deltaSeconds);

            this.recordPerformanceSample(frameMs, 'frame');
            this.applyAdaptiveQuality(deltaSeconds, frameMs);

            this.animationFrameId = requestAnimationFrame(loop);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(loop);
        this.registerAnimation(this.animationFrameId);
    }

    requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.fallbackInProgress || this.flags.forceWebGL) {
            return;
        }

        this.fallbackInProgress = true;
        this.flags.forceWebGL = true;
        console.warn(`[SkyChildrenV2] Switching to forced WebGL fallback (${reason})`, error || '');

        this.teardownRuntime();
        this.createScene()
            .catch((fallbackError) => {
                console.error('[SkyChildrenV2] Failed to recover with WebGL fallback:', fallbackError);
            })
            .finally(() => {
                this.fallbackInProgress = false;
            });
    }

    createVisualGateReport(options = {}) {
        const grassBudget = (this.qualityPreset.grassNearCount ?? this.qualityPreset.grassInstances ?? 0)
            + ((this.qualityPreset.grassMidCount ?? 0) * 0.62);
        const flowerHeadsBudget = this.qualityPreset.flowerHeadsCount
            ?? this.qualityPreset.flowerNearCount
            ?? this.qualityPreset.flowerInstances
            ?? 0;
        const flowerBudget = (
            flowerHeadsBudget * 0.72
            + (this.qualityPreset.flowerStemsCount ?? 0) * 0.32
        )
            * (this.flowerCarpetStrength ?? this.qualityPreset.flowerCarpetStrength ?? 1.0)
            * this.flowerDensityScale;

        const budgetCoverageEstimate = clamp(
            (flowerBudget / Math.max(1, grassBudget)) * 5.8,
            0,
            1,
        );
        const carpetCoverageTarget = Math.max(0.01, this.qualityPreset?.flowerCarpetCoverageTarget ?? 0.1);
        const carpetCoverageMeasured = this.flowerDiagnosticsState?.coverage10 ?? 0;
        const carpetCoverageEstimate = clamp((carpetCoverageMeasured / carpetCoverageTarget) * 0.4, 0, 1);
        const flowerCoverageEstimate = Math.max(budgetCoverageEstimate, carpetCoverageEstimate);

        const mountainReadability = clamp(
            ((this.qualityPreset.mountainMeshes || 0) / 8) * (1 - (this.scene?.fog?.density || 0) * 280),
            0,
            1,
        );

        const cloudVolumeReadability = clamp(
            ((this.qualityPreset.cloudClusters || 0) / 14)
            * ((this.qualityPreset.cloudPuffsPerCluster || 0) / 5),
            0,
            1,
        );

        const atmosphereClarity = clamp(
            1 - ((this.scene?.fog?.density || 0) / 0.0016),
            0,
            1,
        );

        const terrainVariation = clamp(
            ((this.qualityPreset.terrainSegments || 0) / 220) * 0.68
            + (this.qualityPreset.farCoverageStrength ?? 0.56) * 0.45,
            0,
            1,
        );

        const groundContinuity = this.terrainField ? 1 : 0;

        const pass = flowerCoverageEstimate >= 0.32
            && mountainReadability >= 0.62
            && cloudVolumeReadability >= 0.7
            && atmosphereClarity >= 0.5
            && terrainVariation >= 0.62
            && groundContinuity >= 0.9;

        const report = {
            phase: options.phase || 'sky-v2',
            pass,
            metrics: {
                flowerCoverageEstimate,
                carpetCoverageMeasured,
                mountainReadability,
                cloudVolumeReadability,
                atmosphereClarity,
                terrainVariation,
                groundContinuity,
            },
            targets: {
                flowerCoverageEstimateMin: 0.32,
                carpetCoverageMeasuredMin: carpetCoverageTarget,
                mountainReadabilityMin: 0.62,
                cloudVolumeReadabilityMin: 0.7,
                atmosphereClarityMin: 0.5,
                terrainVariationMin: 0.62,
                groundContinuityMin: 0.9,
            },
            tier: this.qualityTier,
            heroShots: [...HERO_SHOTS],
            timestamp: new Date().toISOString(),
        };

        this.validation.lastVisualGate = report;
        return report;
    }

    createPerformanceGateReport(options = {}) {
        const renderP95 = percentile(this.performance.frameTimes, 0.95);
        const postP95 = percentile(this.performance.postTimes, 0.95);
        const renderAvg = average(this.performance.frameTimes);

        const targetRenderMs = Number.isFinite(options.targetRenderMs)
            ? options.targetRenderMs
            : 10.5;
        const targetPostMs = Number.isFinite(options.targetPostMs)
            ? options.targetPostMs
            : 2.0;

        const pass = renderP95 <= targetRenderMs
            && (this.flags.usePost === false || postP95 <= targetPostMs || this.performance.postTimes.length < 20);

        const report = {
            pass,
            metrics: {
                renderP95,
                renderAvg,
                postP95,
                sampleCount: this.performance.frameTimes.length,
                postSampleCount: this.performance.postTimes.length,
            },
            targets: {
                renderP95Max: targetRenderMs,
                postP95Max: targetPostMs,
            },
            tier: this.qualityTier,
            resolutionScale: this.dynamicResolutionScale,
            timestamp: new Date().toISOString(),
        };

        this.validation.lastPerformanceGate = report;
        return report;
    }

    createValidationReport(options = {}) {
        const visualGate = this.createVisualGateReport({ phase: options.phase });
        const performanceGate = this.createPerformanceGateReport({
            targetRenderMs: options.targetRenderMs,
            targetPostMs: options.targetPostMs,
        });

        const report = {
            phase: options.phase || 'sky-v2',
            pass: visualGate.pass && performanceGate.pass,
            visualGate,
            performanceGate,
            state: this.getRuntimeState(),
            timestamp: new Date().toISOString(),
        };

        this.validation.lastReport = report;
        return report;
    }

    captureSnapshot(label = 'sky-children-v2') {
        const canvas = this.renderer?.domElement;
        let dataUrl = null;

        try {
            if (canvas && typeof canvas.toDataURL === 'function') {
                dataUrl = canvas.toDataURL('image/png');
            }
        } catch (error) {
            console.warn('[SkyChildrenV2] Snapshot capture failed:', error);
        }

        return {
            label,
            tier: this.qualityTier,
            resolutionScale: this.dynamicResolutionScale,
            timestamp: new Date().toISOString(),
            dataUrl,
        };
    }

    getRuntimeState() {
        return {
            tier: this.qualityTier,
            preset: this.qualityPreset ? { ...this.qualityPreset } : null,
            isWebGPU: this.isWebGPU,
            flags: {
                ...this.flags,
            },
            capabilities: {
                ...this.capabilities,
            },
            dynamicResolutionScale: this.dynamicResolutionScale,
            postEnabled: this.flags.usePost && !!this.postComposer,
            clouds: this.cloudRuntime.length,
            vegetation: this.getVegetationState(),
            pathDebugEnabled: this.pathDebugEnabled,
            carpetDebugEnabled: this.carpetDebugEnabled,
            edgeState: this.getEdgeState(),
            heroShots: [...HERO_SHOTS],
        };
    }

    installDebugHelpers() {
        if (typeof window === 'undefined') return;

        window.skyChildrenV2 = {
            tiers: () => listQualityPresets(),
            tier: () => this.qualityTier,
            setTier: (tier, options = {}) => this.setQualityTier(tier, options),
            state: () => this.getRuntimeState(),
            snapshot: (label = 'sky-children-v2') => this.captureSnapshot(label),
            visualGate: (options = {}) => this.createVisualGateReport(options),
            perfGate: (options = {}) => this.createPerformanceGateReport(options),
            validate: (options = {}) => this.createValidationReport(options),
            report: () => this.validation.lastReport,
            heroShots: () => [...HERO_SHOTS],
            vegetationState: () => this.getVegetationState(),
            setVegetationDensity: (scale = 1) => this.setVegetationDensity(scale),
            setCarpetStrength: (value = 1) => this.setCarpetStrength(value),
            setFlowerPalette: (preset = 'prairie') => this.setFlowerPalette(preset),
            setFlowerLift: (headLift, stemLift) => this.setFlowerLift(headLift, stemLift),
            rebuildFlowers: () => this.rebuildFlowers(),
            flowerDiagnostics: () => this.flowerDiagnostics(),
            setPathDebug: (enabled = true) => this.setPathDebug(enabled),
            showCarpetDebug: (enabled = true) => this.setCarpetDebug(enabled),
            edgeState: () => this.getEdgeState(),
        };

        console.log(
            '[SkyChildrenV2] Helpers: window.skyChildrenV2.tiers(), tier(), setTier(), state(),'
            + ' snapshot(label), visualGate(options), perfGate(options), validate(options), report(), heroShots(),'
            + ' vegetationState(), setVegetationDensity(scale), setCarpetStrength(value), setFlowerPalette(preset),'
            + ' setFlowerLift(headLift, stemLift), rebuildFlowers(), flowerDiagnostics(),'
            + ' setPathDebug(enabled), showCarpetDebug(enabled), edgeState()',
        );
    }

    installCompatibilityHelpers() {
        if (typeof window === 'undefined') return;

        const compat = {
            snapshot: (label) => this.captureSnapshot(label || 'sky-children-v2-compat'),
            visualGate: (options = {}) => this.createVisualGateReport(options),
            perfGate: (options = {}) => this.createPerformanceGateReport(options),
            validate: (options = {}) => this.createValidationReport(options),
            report: () => this.validation.lastReport,
            heroShots: () => [...HERO_SHOTS],
        };

        window.skyChildrenPhase1 = { ...compat };
        window.skyChildrenPhase2 = { ...compat };
        window.skyChildrenPhase3 = { ...compat };
        window.skyChildrenPhase4 = { ...compat };
        window.skyChildrenPhase5 = {
            ...compat,
            postState: () => this.qualityPreset?.post || null,
            postSignals: () => ({
                enabled: this.flags.usePost,
                postP95: percentile(this.performance.postTimes, 0.95),
            }),
        };
        window.skyChildrenPhase6 = { ...compat };
        window.skyChildrenPhase7 = {
            ...compat,
            tiers: () => listQualityPresets(),
            tier: () => this.qualityTier,
            setTier: (tier, options = {}) => this.setQualityTier(tier, options),
            state: () => this.getRuntimeState(),
        };
    }

    removeDebugHelpers() {
        if (typeof window === 'undefined') return;

        delete window.skyChildrenV2;
        delete window.skyChildrenPhase1;
        delete window.skyChildrenPhase2;
        delete window.skyChildrenPhase3;
        delete window.skyChildrenPhase4;
        delete window.skyChildrenPhase5;
        delete window.skyChildrenPhase6;
        delete window.skyChildrenPhase7;
    }

    disposeObject3D(object) {
        if (!object) return;

        object.traverse((entry) => {
            if (entry.geometry) {
                entry.geometry.dispose();
            }
            if (entry.material) {
                if (Array.isArray(entry.material)) {
                    entry.material.forEach((material) => material?.dispose?.());
                } else {
                    entry.material.dispose?.();
                }
            }
        });
    }

    teardownRuntime() {
        this.clearAsyncTimeouts();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.moodDebugOverlay) {
            this.moodDebugOverlay.dispose();
            this.moodDebugOverlay = null;
        }
        this.moodDirector.reset();

        if (this.summitLight) {
            this.summitLight.dispose?.();
            this.summitLight = null;
        }

        if (this.birdsRuntime) {
            if (this.birdsRuntime.mesh?.parent) this.scene.remove(this.birdsRuntime.mesh);
            this.birdsRuntime.dispose();
            this.birdsRuntime = null;
        }

        [this.floatingIslandsRuntime, this.bushesRuntime, this.archesRuntime, this.treesRuntime, this.spiritsRuntime]
            .forEach((rt) => {
                if (!rt) return;
                if (rt.group?.parent) this.scene.remove(rt.group);
                if (rt.mesh?.parent) this.scene.remove(rt.mesh);
                rt.dispose();
            });
        this.floatingIslandsRuntime = null;
        this.bushesRuntime = null;
        this.archesRuntime = null;
        this.treesRuntime = null;
        this.spiritsRuntime = null;

        disposeSkyDetailTextureSet(this.skyDetailTextures);
        this.skyDetailTextures = null;

        if (this._vegetationCallbackId !== null) {
            clearTimeout(this._vegetationCallbackId);
            this._vegetationCallbackId = null;
        }

        this.clearEventUnsubscribers();

        if (this.postComposer) {
            this.postComposer.dispose();
            this.postComposer = null;
        }

        this.clearPathDebug();
        this.clearCarpetDebug();
        this.disposeVegetationSystems();

        if (this.scene) {
            this.disposeObject3D(this.scene);
            this.scene.clear();
            this.scene = null;
        }

        if (this.renderer) {
            this.disposeRenderer(this.renderer, { nullInstance: false });
            this.renderer = null;
        }

        this.camera = null;
        this.cameraDirector = null;
        this.skyMesh = null;
        this.skyRuntime = null;
        this.u = null;
        this.terrainMesh = null;
        this.terrainUnderlayMesh = null;
        this.terrainSkirtMesh = null;
        this.terrainField = null;
        this.terrainMaterialUniforms = null;
        this.mountainGroup = null;
        this.cloudGroup = null;
        this.cloudSeaRuntime = null;
        this.glintsRuntime = null;
        this.meadowRuntime = null;
        this.grassMesh = null;
        this.flowerMesh = null;
        this.pathDebugGroup = null;
        this.carpetDebugGroup = null;

        this.uniformSets = [];
        this.skyUniforms = null;
        this.cloudRuntime = [];
        this.renderAsyncInFlight = false;
        this.flowerDiagnosticsState = null;
        this.flowerVisibilityGatePassed = false;
    }

    stop() {
        super.stop();
        this.teardownRuntime();
        this.removeDebugHelpers();

        const container = document.getElementById(`${this.name}-theme`);
        if (container) {
            container.innerHTML = '';
        }
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}
