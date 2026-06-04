/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ NEON DISTRICT ✧
 *  A 3D Cyberpunk Blade Runner-Style Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Immersive street-level view surrounded by towering neon-lit megastructures.
 * Features:
 * - Procedural cyberpunk buildings with neon signage
 * - Street-level camera perspective looking up at towers
 * - Rain particle system
 * - Colored neon lighting
 * - Post-processing with heavy bloom
 *
 * Inspired by Blade Runner and the SynthCity reference.
 */

import * as THREE from 'three/webgpu';
import { UniformsUtils } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
// Reflector import removed - unused (Phase 0 cleanup)
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { NEON_DISTRICT_TETROMINOS } from './neon-district-tetrominos.js';
import {
    NeonDistrictAssets,
    NEON_DISTRICT_STAR_VERTEX_SHADER,
    NEON_DISTRICT_STAR_FRAGMENT_SHADER,
} from './neon-district-assets.js';
import {
    createSkyNodeMaterial,
    createBuildingNodeMaterial,
    createStarfieldNodeMaterial,
    createMegaTowerNodeMaterial,
    createVhsBillboardNodeMaterial,
    createMoonNodeMaterial,
    createCloudStrataNodeMaterial,
    createSkyFlashNodeMaterial,
    createSkylineNodeMaterial,
    createSearchlightNodeMaterial,
    createHologramNodeMaterial,
    createSplashNodeMaterial,
    createWetGroundNodeMaterial,
} from './neon-district-materials.js';
import {
    createBuildingMaterialMediumLOD,
    createBuildingMaterialLowLOD,
    createBakedWindowTexture,
    createProceduralBuildingNodeMaterialLOD1,
    createProceduralBuildingNodeMaterialLOD2,
} from './neon-district-lod-materials.js';
import { NeonDistrictPost } from './neon-district-post.js';
import {
    attribute,
    uniform,
    uniformTexture,
    vec2,
    vec3,
    float,
    sin,
    cos,
    mod,
    mix,
    step,
    normalLocal,
    positionLocal,
    positionWorld,
    smoothstep,
    uv,
    reflector,
} from 'three/tsl';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets - Balanced: visible window glow without blow-out
// PERF: Reduced particle counts across all tiers for better FPS
// Rain/star reductions give 3-8% FPS boost with minimal visual impact
const QUALITY_PRESETS = {
    Extreme: {
        buildingCount: 50,
        rainParticles: 5000,   // Was 6500 (-23%)
        starCount: 12000,      // Was 15000 (-20%)
        bloomStrength: 0.8,
        bloomRadius: 0.6,
        bloomThreshold: 0.2,
        enablePostProcessing: true,
        flyingVehicles: 60,    // Was 70
        // Phase 1 (AAA): true planar reflections on the wet street (WebGPU only)
        enableReflections: true,
        reflectionResolutionScale: 0.6,
        skyStrataCount: 3,
    },
    Ultra: {
        buildingCount: 30,
        rainParticles: 2800,   // Was 3500 (-20%)
        starCount: 10000,      // Was 12000 (-17%)
        bloomStrength: 0.7,
        bloomRadius: 0.5,
        bloomThreshold: 0.22,
        enablePostProcessing: true,
        flyingVehicles: 45,    // Was 50
        enableReflections: true,
        reflectionResolutionScale: 0.5,
        skyStrataCount: 3,
    },
    High: {
        buildingCount: 20,
        rainParticles: 2000,   // Was 2600 (-23%)
        starCount: 7000,       // Was 9000 (-22%)
        bloomStrength: 0.6,
        bloomRadius: 0.45,
        bloomThreshold: 0.28,
        enablePostProcessing: true,
        flyingVehicles: 30,    // Was 35
        enableReflections: true,
        reflectionResolutionScale: 0.35,
        skyStrataCount: 2,
    },
    Medium: {
        buildingCount: 15,
        rainParticles: 900,    // Was 1300 (-31%)
        starCount: 4000,       // Was 6000 (-33%)
        bloomStrength: 0.6,
        bloomRadius: 0.4,
        bloomThreshold: 0.3,
        enablePostProcessing: false,
        flyingVehicles: 15,    // Was 20
        enableReflections: false, // env-map reflections only below High
        skyStrataCount: 1,
    },
    Low: {
        buildingCount: 10,
        rainParticles: 300,    // Was 500 (-40%)
        starCount: 2000,       // Was 3000 (-33%)
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        bloomThreshold: 1.0,
        enablePostProcessing: false,
        flyingVehicles: 4,     // Was 6
        skyStrataCount: 0,
    },
    Minimal: {
        buildingCount: 8,
        rainParticles: 0,
        starCount: 1000,       // Was 1500 (-33%)
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        bloomThreshold: 1.0,
        enablePostProcessing: false,
        flyingVehicles: 2,     // Was 3
        skyStrataCount: 0,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.3 }, // Reduced darkness for brighter scene
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
// Neon Colors Palette
// ─────────────────────────────────────────────────────────────────────────────
// Synthcity-style neon colors - purple dominant palette
const NEON_COLORS = [
    0xff00ff, // Magenta
    0xaa00ff, // Purple
    0x8800ff, // Deep purple
    0xcc00ff, // Bright purple
    0xff00aa, // Pink-purple
    0x6600ff, // Violet
    0xff66ff, // Light pink
    0x00ffff, // Cyan (accent)
    0xff0066, // Hot pink
    0x9933ff, // Medium purple
];

// Reused scratch vector for projecting the moon to screen space (AAA Phase 2b god-rays)
const _moonProjVec = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class NeonDistrictTheme extends BaseTheme {
    constructor() {
        super('neon-district');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.buildingUniforms = null;
        this.starUniforms = null;
        this.megaTowerUniforms = null;
        this.megaTowerTexture = null;
        this.megaTowerTextureLite = null;
        this.megaTowerOverlayUniforms = null;
        this.megaTowerOverlayMaterial = null;
        this.rainUniforms = null;
        this.splashUniforms = null;
        this.rainInstanceData = null;
        this.rainInstanceDummy = null;
        this.rainStreakTexture = null;
        this.rainForegroundParticles = null;
        this.rainForegroundInstanceData = null;
        this.rainForegroundMaterial = null;
        this.composer = null;
        this.bloomPass = null;
        this.post = null;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.mrtAuditEnabled = false;
        this.debugEnabled = false; // Phase 0: conditional logging via ?ndDebug=1

        // Scene elements
        this.buildings = [];
        this.neonSigns = [];
        this.rainParticles = null;
        this.rainUniforms = null;
        this.splashUniforms = null;
        this.flyingVehicles = [];
        this.streetLights = [];
        this.starfield = null;
        this.moon = null;
        this.moonUniforms = null;
        this.skyStrata = [];
        this.skyStrataUniforms = [];
        // AAA Phase 4c: distant sheet-lightning state
        this.skyFlash = null;
        this.skyFlashUniform = null;
        this.skyFlashIntensity = 0;
        this.skyFlashTimer = 6 + Math.random() * 10;
        this.skyFlashPulse2At = 0;
        this.skyFlashPulse2Amp = 0;
        this.megaTowerUniforms = null;
        this.starUniforms = null;
        this.wetGroundUniforms = null; // WebGPU wet asphalt material uniforms
        this.groundReflector = null;   // AAA Phase 1: planar reflector for wet street
        this.reflectionsEnabled = false;
        this.hdrEnvMap = null;
        this.proceduralEnvMap = null;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.musicSource = null;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        // Effects state
        this.lightPulseIntensity = 0;
        this.rainIntensity = 1.3;
        this.bloomBoost = 0;
        this.glitchIntensity = 0;
        this.fogSettings = {
            color: new THREE.Color(0x1a0b2a),
            colorFar: new THREE.Color(0x0a0518),
            near: 0.18,
            far: 0.92,
            density: 0.85,
            bloomAttenuation: 0.5,
            // AAA Phase 2a: world-space height band over which street fog fades out
            heightBase: 0.0,
            heightTop: 900.0,
            heightFloor: 0.22,
        };

        // AAA Phase 2b: god-ray anchor (moon) screen-space position, projected per frame
        this.moonScreen = new THREE.Vector2(0.5, 0.6);
        this.moonWorldPosition = new THREE.Vector3(-800, 1800, -5000);
        this.godrayBaseIntensity = 0;

        // Combo effect state
        this.neonSignSurgeIntensity = 0;
        this.neonSignSurgeTime = 0;

        // Piece lock effect particles
        this.pieceLockSparks = [];
        this.sparkPool = [];
        this.sparkGeometry = null;

        // Performance: throttle sign updates (every 3rd frame)
        this.signUpdateCounter = 0;

        // Performance: throttle blink updates (every 4th frame = 15Hz)
        this.blinkUpdateCounter = 0;

        // Shared spinner resources (initialized lazily)
        this.spinnerResources = null;
        this.groundCarInstances = null; // ground traffic (driving cars)
        this.groundCarData = null;
        this.groundCarLanes = null;

        // SynthCity Assets Manager
        this.assets = new NeonDistrictAssets();

        // Pointer tracking for parallax
        this.targetPointerX = 0;
        this.targetPointerY = 0;
        this.currentPointerX = 0;
        this.currentPointerY = 0;

        // Camera sway parameters (gentle floating drift)
        // Camera sway parameters (gentle floating drift) - increased movement
        this.cameraBasePosition = new THREE.Vector3(0, 4, 40);
        this.cameraBaseLookAt = new THREE.Vector3(0, 80, -400);
        this.cameraSwayAmplitude = { x: 5.0, y: 7.0, z: 2.0 };
        this.cameraSwaySpeed = { x: 0.1, y: 0.05, z: 0.08 };
        this.cameraLookAtSway = { x: 6.0, y: 4.0 };
        this.cameraSway = new THREE.Vector3(0, 0, 0);
        this.cameraLookTarget = this.cameraBaseLookAt.clone();
        this.cameraCurrentLookTarget = this.cameraBaseLookAt.clone();
        this.cameraRollOffset = 0;
        this.cameraDriftSeed = Math.random() * Math.PI * 2;
        // AAA Phase 7a: reactive camera channel (event-driven dolly + FOV pulse)
        this.cameraDollyZ = 0;     // negative pushes the camera down the canyon
        this.cameraFovPulse = 0;   // transient FOV widen (dolly-zoom), degrees
        this.cameraBaseFov = 70;
        this._fovDirty = false;
        this.baseSaturationAmount = 1.12; // Phase 3 grade base (combo ramps above this)

        // VHS billboards with shader effects
        this.vhsBillboards = [];

        // Building Pool for smart caching
        this.buildingPool = [];

        // Simple building pool for outer rows (better FPS)
        this.simpleOuterBuildingPool = [];

        // Instanced outer buildings
        this.outerBuildingInstances = [];
        this.outerBuildingGeometry = null;
        this.tier2InstanceMesh = null;
        this.tier2InstanceGeometry = null;
        this.tier2Bounds = [];
        this.hlodMeshes = [];
        this.hlodClusterSize = 800;

        // Shared rooftop beacon resources
        this.rooftopBeaconGeometry = null;
        this.rooftopBeaconMaterial = null;

        // Batched rooftop props
        this.rooftopMaterials = null;
        this.rooftopBatchMeshes = [];
        this.rooftopPropsBatched = false;
        this.freeStandingBeacons = [];

        // Flight collision bounds for vehicles
        this.flightCollisionBounds = [];
        this.outerBuildingBounds = [];
        this.vehicleRange = 2500;

        // Render scaling (performance)
        this.maxPixelRatio = 1.5;
        this.postProcessingScale = 0.75;
        this.dynamicResolutionScale = 1.0;
        this.dynamicResolutionMin = 0.7;
        this.dynamicResolutionMax = 1.0;
        this.dynamicResolutionStep = 0.05;
        this.dynamicResolutionAdjustInterval = 1.5;
        this.dynamicResolutionLowerFPS = 55;
        this.dynamicResolutionUpperFPS = 70;
        this.dynamicResolutionElapsed = 0;
        this.dynamicResolutionFrames = 0;
        this.renderMetrics = null;
        this.dynamicResolutionCooldown = 6.0;
        this.dynamicResolutionCooldownRemaining = 0;
        this.dynamicResolutionIncreaseEnabled = false;
        this.maxHighDetailHeight = 0;

        // LOD tuning (distance-based) - PERF: Tightened for faster tier transitions
        // More aggressive LOD switching gives 10-15% FPS boost
        this.buildingLodConfig = {
            mainRoadX: 260,
            outerRoadX: 650,
            nearDistance: 800,   // Was 1500 - switch to medium LOD earlier
            midDistance: 1800,   // Was 3200 - switch to low LOD earlier
        };
        this.signLodConfig = {
            nearDistance: 600,   // Was 900 - reduce sign detail distance
            midDistance: 1200,   // Was 1800
            farDistance: 2000,   // Was 2800
        };
        this.lodScale = 1.0;

        // Frame pacing guards (reduce spikes under load)
        this.slowFrameThreshold = 0.05; // 20fps threshold
        this.slowFrameLimit = 3;
        this.slowFrameCount = 0;

        // Throttled update intervals (seconds)
        this.vehicleUpdateInterval = 1 / 30;
        this.vehicleUpdateAccumulator = 0;
        this.vhsUpdateInterval = 1 / 30;
        this.vhsUpdateAccumulator = 0;
        this.rainUpdateStride = 1;
        this.rainUpdateCursor = 0;

        // Neon sign batching
        this.neonSignUpdateInterval = 3;
        this.neonSignBatchSize = 150;
        this.signUpdateCursor = 0;

        // Lightweight profiler (toggle via ?ndProfile=1)
        this.profileEnabled = false;
        this.profileWarnMs = 24;
        this.profileLogInterval = 1000;
        this.profileLastLog = 0;
        this.profileFrameStart = 0;
        this.profileMarks = [];

        // Billboard cache
        this.billboards = [];
        this.billboardAccumulator = 0;
        this.billboardUpdateInterval = 0.12;
        this.billboardLastCamPos = new THREE.Vector3();
        this.billboardLastCamQuat = new THREE.Quaternion();
        this.billboardCamPosEpsilon = 0.5;
        this.billboardCamQuatEpsilon = 0.0005;
        this.billboardInstances = {
            small: null,
            large: null,
        };
        this.billboardInstanceUniforms = {
            small: null,
            large: null,
        };
        this.instancedBillboardUniforms = [];
        this.billboardLights = [];
        this.adInstanceBuckets = {
            small: [],
            large: [],
        };
        this.adInstanceMeshes = {
            small: null,
            large: null,
        };
        this.searchlightUpdateInterval = 1 / 20;
        this.searchlightUpdateAccumulator = 0;
        this.outerBuildingBasicMaterials = new Map();

        // Vehicle GPU animation
        this.vehicleGPUDriven = false;
        this.vehicleNodeTransforms = null;
        this.vehicleNodeUniforms = null;
        this.prewarmEnabled = false;
        this.isPrewarming = false;
        this.prewarmPromise = null;
        this.prewarmRequested = false;
        this.syncLoadEnabled = false;
        this.backgroundLoadPromise = null;
        this.sceneInitialized = false;
        this.isCreatingScene = false;
        this.isAnimating = false;
        this.mrtPatchedMaterials = new WeakSet();
        this.featureFlags = {
            noPost: false,
            noVehicles: false,
            noRain: false,
            noSparks: false,
            noSigns: false,
            noAdSwitch: false,
            noVhsSwitch: false,
            noBillboardLights: false,
            noStars: false,
            noSky: false,
            noClouds: false,
            noSkyline: false,
            noSearchlights: false,
        };

        // Debug/baseline capture flags (set in createScene)
        this.forceWebGL = false;
        this.baselineCapture = false;
        this.baselineSampleInterval = 5;
        this.baselineElapsed = 0;
        this.baselineFrames = 0;
        this.currentQualityName = 'High';

        console.log('[NeonDistrict] Theme constructed');
    }

    getTetrominoConfig() {
        return NEON_DISTRICT_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.maxPixelRatio = this.qualityPreset.enablePostProcessing ? 1.5 : 1.25;
        this.postProcessingScale = this.qualityPreset.enablePostProcessing ? 0.75 : 1.0;
        this.currentQualityName = quality;
        if (this.currentQualityName === 'Minimal') {
            this.maxPixelRatio = Math.min(this.maxPixelRatio, 1.0);
        }

        // Adjust update intervals based on quality
        switch (this.currentQualityName) {
            case 'Extreme':
            case 'Ultra':
                this.vehicleUpdateInterval = 1 / 30;
                this.neonSignUpdateInterval = 4;
                this.neonSignBatchSize = 120;
                this.vhsUpdateInterval = 1 / 30;
                this.rainUpdateStride = 2;
                this.dynamicResolutionAdjustInterval = 3.0;
                break;
            case 'High':
                this.vehicleUpdateInterval = 1 / 24;
                this.neonSignUpdateInterval = 3;
                this.neonSignBatchSize = 150;
                this.vhsUpdateInterval = 1 / 24;
                this.rainUpdateStride = 2;
                this.dynamicResolutionAdjustInterval = 3.5;
                break;
            case 'Medium':
                this.vehicleUpdateInterval = 1 / 20;
                this.neonSignUpdateInterval = 4;
                this.neonSignBatchSize = 200;
                this.vhsUpdateInterval = 1 / 20;
                this.rainUpdateStride = 3;
                this.dynamicResolutionAdjustInterval = 4.0;
                break;
            case 'Minimal':
                this.vehicleUpdateInterval = 1 / 12;
                this.neonSignUpdateInterval = 6;
                this.neonSignBatchSize = 260;
                this.vhsUpdateInterval = 1 / 12;
                this.rainUpdateStride = 5;
                this.dynamicResolutionAdjustInterval = 6.0;
                break;
            case 'Low':
            default:
                this.vehicleUpdateInterval = 1 / 15;
                this.neonSignUpdateInterval = 5;
                this.neonSignBatchSize = 240;
                this.vhsUpdateInterval = 1 / 15;
                this.rainUpdateStride = 4;
                this.dynamicResolutionAdjustInterval = 5.0;
                break;
        }

        // PERF: More aggressive dynamic resolution for better FPS
        // Lower floor values give 15-25% FPS boost with acceptable "retro" softness
        if (this.currentQualityName === 'Minimal') {
            this.dynamicResolutionMin = 0.4;  // Was 0.5
            this.postProcessingScale = 0.5;
        } else if (this.currentQualityName === 'Low') {
            this.dynamicResolutionMin = 0.5;  // Was 0.6
            this.postProcessingScale = 0.6;
        } else if (this.currentQualityName === 'Medium') {
            this.dynamicResolutionMin = 0.55; // Was 0.7
            this.postProcessingScale = 0.65;
        } else if (this.currentQualityName === 'High') {
            this.dynamicResolutionMin = 0.6;  // Was 0.7
            this.postProcessingScale = 0.7;
        } else {
            // Ultra/Extreme - keep higher quality
            this.dynamicResolutionMin = 0.7;
            this.postProcessingScale = 0.75;
        }

        const lodScaleMap = {
            Extreme: 1.2,
            Ultra: 1.1,
            High: 1.0,
            Medium: 0.9,
            Low: 0.8,
            Minimal: 0.7,
        };
        this.lodScale = lodScaleMap[this.currentQualityName] || 1.0;

        if (this.currentQualityName === 'Minimal') {
            this.slowFrameThreshold = 1 / 30;
        } else if (this.currentQualityName === 'Low') {
            this.slowFrameThreshold = 1 / 28;
        } else {
            this.slowFrameThreshold = 0.05;
        }
    }

    getDebugFlags() {
        if (typeof window === 'undefined') {
            return {
                forceWebGL: false,
                baseline: false,
                profile: false,
                profileMs: null,
                featureFlags: {},
            };
        }

        const params = new URLSearchParams(window.location.search);
        const hasFlag = (name) => params.has(name)
            || params.get(name) === '1'
            || params.get(name) === 'true';
        const forceWebGL = params.has('forceWebGL') || params.get('forceWebGL') === '1' || params.get('forceWebGL') === 'true';
        const baseline = params.has('ndBaseline') || params.get('ndBaseline') === '1' || params.get('ndBaseline') === 'true'
            || params.has('baseline') || params.get('baseline') === '1' || params.get('baseline') === 'true';
        const profile = params.has('ndProfile') || params.get('ndProfile') === '1' || params.get('ndProfile') === 'true'
            || params.has('profile') || params.get('profile') === '1' || params.get('profile') === 'true';
        const profileMs = Number(params.get('ndProfileMs') || params.get('profileMs'));
        const sanitizedProfileMs = Number.isFinite(profileMs) && profileMs > 0 ? profileMs : null;

        const explicitNoBillboardLights = hasFlag('ndNoBillboardLights') || hasFlag('noBillboardLights');
        const billboardLights = hasFlag('ndBillboardLights') || hasFlag('billboardLights');
        const mrtAudit = hasFlag('ndMrtAudit') || hasFlag('mrtAudit');

        // Minimal mode disables most features for performance testing
        // Use positive flags (e.g., buildings=1) to override minimal and enable specific features
        const minimal = hasFlag('ndMinimal') || hasFlag('minimal');
        const enableFlag = (name) => {
            const ndName = `nd${name.charAt(0).toUpperCase()}${name.slice(1)}`;
            const lower = name.toLowerCase();
            const ndLower = `nd${lower}`;
            return hasFlag(name) || hasFlag(lower) || hasFlag(ndName) || hasFlag(ndLower);
        };

        const megaTowerLite = enableFlag('megaTowerLite');
        const megaTowerNoBloom = enableFlag('megaTowerNoBloom');
        // Phase 1 (AAA): wet-street reflections + HDR environment toggles
        const noReflections = hasFlag('ndNoReflections') || hasFlag('noReflections')
            || hasFlag('ndNoSSR') || hasFlag('noSSR');
        const forceReflections = hasFlag('ndReflections') || hasFlag('reflections')
            || hasFlag('ndForceReflections') || hasFlag('forceReflections');
        const noHdrEnv = hasFlag('ndNoHdrEnv') || hasFlag('noHdrEnv');
        // Phase 2 (AAA): volumetric atmosphere toggles
        const noFog = hasFlag('ndNoFog') || hasFlag('noFog');
        const noGodrays = hasFlag('ndNoGodrays') || hasFlag('noGodrays')
            || hasFlag('ndNoGodRays') || hasFlag('noGodRays');
        // Phase 3 (AAA): cinematic post toggles
        const noDof = hasFlag('ndNoDof') || hasFlag('noDof')
            || hasFlag('ndNoDOF') || hasFlag('noDOF');
        const noGrade = hasFlag('ndNoGrade') || hasFlag('noGrade');
        const noAnamorphic = hasFlag('ndNoAnamorphic') || hasFlag('noAnamorphic');
        const forceCinematic = hasFlag('ndCinematic') || hasFlag('cinematic');
        // Phase 4 (AAA): hero-sky smog strata toggles
        const noClouds = hasFlag('ndNoClouds') || hasFlag('noClouds');
        // Phase 5 (AAA): facade/storefront toggles
        const noStorefrontSigns = hasFlag('ndNoStorefrontSigns') || hasFlag('noStorefrontSigns');
        // Ground traffic (driving cars)
        const noGroundTraffic = (minimal && !enableFlag('groundTraffic'))
            || hasFlag('ndNoGroundTraffic') || hasFlag('noGroundTraffic');
        // 6d headlight beam cones
        const noHeadlightCones = hasFlag('ndNoHeadlightCones') || hasFlag('noHeadlightCones');
        const forceHeadlightCones = hasFlag('ndHeadlightCones') || hasFlag('headlightCones');
        // 6b rain-on-lens droplets
        const noLensDrops = hasFlag('ndNoLensDrops') || hasFlag('noLensDrops');
        const forceLensDrops = hasFlag('ndLensDrops') || hasFlag('lensDrops');
        const featureFlags = {
            noPost: hasFlag('ndNoPost') || hasFlag('noPost'),
            noMrt: hasFlag('ndNoMrt') || hasFlag('noMrt'),
            forceMrt: hasFlag('ndForceMrt') || hasFlag('forceMrt'),
            noVehicles: (minimal && !enableFlag('vehicles')) || hasFlag('ndNoVehicles') || hasFlag('noVehicles'),
            noRain: (minimal && !enableFlag('rain')) || hasFlag('ndNoRain') || hasFlag('noRain'),
            noSparks: (minimal && !enableFlag('sparks')) || hasFlag('ndNoSparks') || hasFlag('noSparks'),
            noSigns: (minimal && !enableFlag('signs')) || hasFlag('ndNoSigns') || hasFlag('noSigns'),
            noAdSwitch: hasFlag('ndNoAdSwitch') || hasFlag('noAdSwitch'),
            noVhsSwitch: hasFlag('ndNoVhsSwitch') || hasFlag('noVhsSwitch'),
            noBillboardLights: explicitNoBillboardLights,
            noStars: (minimal && !enableFlag('stars')) || hasFlag('ndNoStars') || hasFlag('noStars'),
            noSky: hasFlag('ndNoSky') || hasFlag('noSky'),
            noClouds: (minimal && !enableFlag('clouds')) || noClouds,
            noSkyline: (minimal && !enableFlag('skyline')) || hasFlag('ndNoSkyline') || hasFlag('noSkyline'),
            noSearchlights: (minimal && !enableFlag('searchlights')) || hasFlag('ndNoSearchlights') || hasFlag('noSearchlights'),
            noGround: (minimal && !enableFlag('ground')) || hasFlag('ndNoGround') || hasFlag('noGround'),
            noBuildings: (minimal && !enableFlag('buildings')) || hasFlag('ndNoBuildings') || hasFlag('noBuildings'),
            noMegaTower: (minimal && !enableFlag('megaTower') && !megaTowerLite && !megaTowerNoBloom)
                || hasFlag('ndNoMegaTower') || hasFlag('noMegaTower'),
            noMoon: (minimal && !enableFlag('moon')) || hasFlag('ndNoMoon') || hasFlag('noMoon'),
            megaTowerLite,
            megaTowerNoBloom,
            noReflections,
            forceReflections,
            noHdrEnv,
            noFog,
            noGodrays,
            noDof,
            noGrade,
            noAnamorphic,
            forceCinematic,
            noStorefrontSigns,
            noGroundTraffic,
            noHeadlightCones,
            forceHeadlightCones,
            noLensDrops,
            forceLensDrops,
        };

        const prewarm = hasFlag('ndPrewarm') || hasFlag('prewarm');
        const noPrewarm = hasFlag('ndNoPrewarm') || hasFlag('noPrewarm');
        const syncLoad = hasFlag('ndSyncLoad') || hasFlag('syncLoad')
            || hasFlag('ndStartAfterLoad') || hasFlag('startAfterLoad');
        const noSyncLoad = hasFlag('ndNoSyncLoad') || hasFlag('noSyncLoad');
        const debug = hasFlag('ndDebug') || hasFlag('debug'); // Phase 0: enable verbose logging

        return {
            forceWebGL,
            baseline,
            profile,
            profileMs: sanitizedProfileMs,
            featureFlags,
            prewarm,
            noPrewarm,
            billboardLights,
            explicitNoBillboardLights,
            syncLoad,
            noSyncLoad,
            mrtAudit,
            debug, // Phase 0: conditional logging
        };
    }

    /**
     * Helper to defer work to the next animation frame.
     * Use for visual updates that need to render immediately.
     */
    deferToNextFrame() {
        return new Promise((resolve) => requestAnimationFrame(resolve));
    }

    /**
     * Helper to defer work to browser idle time.
     * Uses requestIdleCallback to avoid competing with gameplay/animations.
     * Falls back to setTimeout if requestIdleCallback is not available.
     */
    deferToIdleTime(timeout = 100) {
        return new Promise((resolve) => {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(resolve, { timeout });
            } else {
                // Fallback for Safari and older browsers
                setTimeout(resolve, 16);
            }
        });
    }

    /**
     * Freeze static objects to avoid per-frame matrix updates.
     */
    freezeStaticObject(object, includeChildren = false) {
        if (!object) return;
        if (includeChildren && object.traverse) {
            object.traverse((child) => {
                child.matrixAutoUpdate = false;
                child.updateMatrix();
            });
        } else {
            object.matrixAutoUpdate = false;
            object.updateMatrix();
        }
        if (object.updateMatrixWorld) {
            object.updateMatrixWorld(true);
        }
    }

    async createScene() {
        if (this.sceneInitialized && this.scene && this.renderer) {
            console.log('[NeonDistrict] Scene already initialized - resuming');
            this.startAnimation();
            return;
        }
        if (this.isCreatingScene) {
            console.warn('[NeonDistrict] Scene creation already in progress');
            return;
        }
        this.isCreatingScene = true;
        try {
            console.log('[NeonDistrict] Creating cyberpunk cityscape (smart loading)...');

            const quality = this.getCurrentQualityLevel();
            this.applyQualityPreset(quality);

            const debugFlags = this.getDebugFlags();
            this.forceWebGL = debugFlags.forceWebGL;
            this.baselineCapture = debugFlags.baseline;
            this.profileEnabled = debugFlags.profile;
            this.featureFlags = {
                ...this.featureFlags,
                ...(debugFlags.featureFlags || {}),
            };
            this.mrtAuditEnabled = Boolean(debugFlags.mrtAudit);
            this.debugEnabled = Boolean(debugFlags.debug); // Phase 0: console.log only with ?ndDebug=1
            // PERF: Enable prewarming by default for WebGPU to avoid shader compilation stalls
            // Can be disabled with ?noPrewarm for debugging
            this.prewarmEnabled = !debugFlags.noPrewarm;
            this.syncLoadEnabled = Boolean(debugFlags.syncLoad);
            if (debugFlags.profileMs) {
                this.profileWarnMs = debugFlags.profileMs;
            }
            if (this.forceWebGL) {
                console.log('[NeonDistrict] Debug: forceWebGL enabled');
            }
            if (this.baselineCapture) {
                console.log('[NeonDistrict] Baseline capture enabled');
            }
            if (this.profileEnabled) {
                console.log(`[NeonDistrict] Perf profiling enabled (warn >= ${this.profileWarnMs}ms)`);
            }

            const container = document.getElementById('neon-district-theme');
            if (!container) {
                console.error('[NeonDistrict] Container not found');
                return;
            }

            // ═══════════════════════════════════════════════════════════════════════
            // PHASE 1: INSTANT - Core rendering pipeline (< 30ms)
            // ═══════════════════════════════════════════════════════════════════════
            await this.initRenderer(container);
            if (!this.renderer) return;
            this.assets.setRenderer(this.renderer);
            if (!debugFlags.noPrewarm && this.isWebGPU) {
                this.prewarmEnabled = true;
            }
            // Desktop/laptop default: start rendering early and load progressively.
            // Keep sync-load available as an explicit debug/QA opt-in.
            if (this.isWebGPU && !debugFlags.noSyncLoad && debugFlags.syncLoad) {
                this.syncLoadEnabled = true;
            }
            if (debugFlags.noSyncLoad) {
                this.syncLoadEnabled = false;
            }
            if (debugFlags.billboardLights) {
                this.featureFlags.noBillboardLights = false;
            } else if (this.isWebGPU && !debugFlags.explicitNoBillboardLights) {
                this.featureFlags.noBillboardLights = true;
            }
            if (!this.featureFlags.noSky) {
                this.createSkybox();
            }
            if (!this.featureFlags.noStars) {
                this.createStarfield();
            }
            this.setupMaterials();
            this.setupLighting();
            this.setupPostProcessing();
            this.setupEventListeners();

            if (!this.syncLoadEnabled) {
                // START ANIMATION IMMEDIATELY
                this.startAnimation();
                console.log('[NeonDistrict] Phase 1 complete - core rendering active');
            } else {
                console.log('[NeonDistrict] Sync load enabled - delaying animation start');
            }

            // ═══════════════════════════════════════════════════════════════════════
            // PHASE 1.5: LOAD SYNTHCITY TEXTURES (non-blocking)
            // ═══════════════════════════════════════════════════════════════════════
            await this.assets.loadAllTextures();
            if (!this.isActive) return;
            console.log('[NeonDistrict] SynthCity textures loaded and materials created');

            // ═══════════════════════════════════════════════════════════════════════
            // PHASE 2: Progressive Loading (Non-blocking)
            // ═══════════════════════════════════════════════════════════════════════
            // Create street immediately (fast) - required before buildings
            this.createStreet();
            this.createMegaTower(); // Add hero building at horizon
            this.createDistantCityLayers(); // Add silhouette backdrop
            this.createMoon(); // Add Cyber Moon
            this.createSkyStrata(); // Add drifting upper-sky smog bands
            this.createSkyFlash(); // Add distant sheet-lightning
            if (!this.featureFlags.noSkyline) {
                this.createDistantSkyline(); // Add 360-degree city horizon
            }
            if (!this.featureFlags.noSearchlights) {
                this.createSearchlights(); // Add animated sky beams
            }
            this.patchMrtMaterialsForObject(this.scene);

            if (this.syncLoadEnabled) {
                await this.createBuildings();
                if (!this.isActive) return;
                await this.loadRemainingContentInBackground();
                if (!this.isActive) return;
                if (this.prewarmEnabled) {
                    await this.prewarmScene();
                }
                this.startAnimation();
                console.log('[NeonDistrict] Phase 1 complete - core rendering active');
            } else {
                // Start building creation in chunks - DO NOT AWAIT
                // This allows the first frame to render immediately with sky/street
                this.createBuildings().then(() => {
                    if (this.isActive) {
                        this.loadRemainingContentInBackground();
                    }
                });
            }

            console.log(`[Synthwave3D] Scene initialized with ${this.currentQuality} quality`);
            this.sceneInitialized = true;
        } finally {
            this.isCreatingScene = false;
        }

        // Music playback: legacy themes may receive AudioManager (loadBuffer/playBuffer),
        // but modern runtime injects SoundManager and handles global music flow.
        if (this.audioManager) {
            console.log('[NeonDistrict] Attempting to play music...');
            const hasLegacyBufferApi = typeof this.audioManager?.loadBuffer === 'function'
                && typeof this.audioManager?.playBuffer === 'function';

            if (hasLegacyBufferApi) {
                // Use the path from songs.json (verified as ./assets/music/neon-district.mp3)
                // Note: In development, path is relative to public/
                const musicPath = './assets/music/neon-district.mp3';

                this.audioManager.loadBuffer(musicPath).then((buffer) => {
                    if (!this.isActive) {
                        return;
                    }

                    this.stopLegacyMusicSource();
                    this.musicSource = this.audioManager.playBuffer(buffer, {
                        loop: true,
                        volume: 0.5, // Not too loud
                        startTime: 0,
                    });
                    console.log('[NeonDistrict] Music playing:', musicPath);
                }).catch((err) => {
                    console.warn('[NeonDistrict] Music failed to load:', err);
                });
            } else {
                console.info('[NeonDistrict] Skipping theme-local music; using global SoundManager playback flow.');
            }
        }
    }

    // createAllBuildings() removed - deprecated dead code (Phase 0 cleanup)

    /**
     * Creates a neon banner that ALWAYS uses Kanji characters
     * Positioned to face the STREET (toward x=0)
     */
    createNeonBannerKanji(building) {
        const w = 25 + Math.random() * 15; // Wider
        const h = 60 + Math.random() * 40; // Taller
        const geometry = new THREE.PlaneGeometry(w, h);

        // Purple-biased hue
        const hue = 0.75 + Math.random() * 0.2;
        const color = new THREE.Color().setHSL(hue, 1.0, 0.6);
        const texture = this.generateKanjiTexture(color);

        const material = this.createBasicMaterial({
            map: texture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);

        // Position sign to FACE THE STREET (x=0)
        const bx = building.position.x;
        const bz = building.position.z;
        const yPos = 40 + Math.random() * 80; // Lower for visibility

        // Offset from building edge toward street
        const streetOffset = 50; // Distance from building center

        if (bx < 0) {
            // Left side buildings - sign faces RIGHT (toward street center)
            sign.position.set(bx + streetOffset, yPos, bz);
            sign.rotation.y = -Math.PI / 2; // Face right
        } else {
            // Right side buildings - sign faces LEFT (toward street center)
            sign.position.set(bx - streetOffset, yPos, bz);
            sign.rotation.y = Math.PI / 2; // Face left
        }

        this.scene.add(sign);
        this.neonSigns.push(sign);

        // Add point light for glow
        if (!this.featureFlags?.noBillboardLights) {
            const signLight = new THREE.PointLight(color.getHex(), 3.0, 100);
            signLight.position.copy(sign.position);
            this.scene.add(signLight);
        }

        console.log(`[NeonDistrict] Kanji sign at x=${sign.position.x.toFixed(0)}, y=${sign.position.y.toFixed(0)}, z=${sign.position.z.toFixed(0)}`);
    }

    /**
     * Generates a neon texture that ALWAYS uses Kanji
     */
    generateKanjiTexture(baseColor) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 128, 256);

        const colorStr = `#${baseColor.getHexString()}`;
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 120, 248);

        // ALWAYS Kanji
        const kanjis = ['未来', '技術', '電脳', '日本', '東京', '夜', '酒', '愛', '光', '力', '神', '風', '龍', '炎'];
        const text = kanjis[Math.floor(Math.random() * kanjis.length)];

        ctx.fillStyle = colorStr;
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 60px Arial';

        // Vertical Kanji
        ctx.fillText(text.charAt(0), 64, 80);
        if (text.length > 1) ctx.fillText(text.charAt(1), 64, 160);

        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Loads remaining visual elements in background (buildings already created in Phase 2).
     */
    loadRemainingContentInBackground() {
        if (this.backgroundLoadPromise) return this.backgroundLoadPromise;
        const workQueue = [];

        // Holographic billboards removed in Phase 0 cleanup (performance)


        // 2. Rain (Fast)
        workQueue.push(() => {
            if (!this.isActive) return;
            if (!this.featureFlags.noRain) {
                this.createRain();
            }
        });

        // 3. Wires & Vehicles (OPTIMIZED: Now single draw calls, so we can do them at once)
        workQueue.push(async () => {
            if (!this.isActive) return;
            this.createOverheadWires(); // Merged geometry (1 mesh)
            if (!this.featureFlags.noVehicles) {
                this.createFlyingVehicles(); // InstancedMesh (5 meshes)
                this.createGroundTraffic(); // Driving cars on the street
            }
            // PERF: Prewarm after vehicles to compile their shaders off the render path
            if (this.prewarmEnabled && this.renderer?.compileAsync && !this.isPrewarming) {
                this.isPrewarming = true;
                this.renderer.compileAsync(this.scene, this.camera)
                    .catch(() => { /* ignore */ })
                    .finally(() => { this.isPrewarming = false; });
            }
        });

        // Neon signs creation removed in Phase 0 cleanup (disabled for performance)


        // Final touches - run prewarm BEFORE resuming normal render
        workQueue.push(async () => {
            if (!this.isActive) return;
            this.updateGroundReflections();
            this.patchMrtMaterialsForObject(this.scene);
            console.log('[NeonDistrict] Background loading complete - starting prewarm...');

            // PERF: Prewarm shaders before resuming render to avoid compilation stalls
            if (this.prewarmEnabled && this.renderer?.compileAsync && !this.isPrewarming) {
                this.isPrewarming = true;
                this.renderer.compileAsync(this.scene, this.camera)
                    .then(() => {
                        console.log('[NeonDistrict] Shader prewarm complete');
                    })
                    .catch((error) => {
                        console.warn('[NeonDistrict] Prewarm failed:', error);
                    })
                    .finally(() => {
                        this.isPrewarming = false;
                    });
            }

            // Log QA validation summary
            this.logQAValidation();
            if (this.mrtAuditEnabled) {
                this.auditMrtMaterials('MRT Audit - background load complete');
            }
        });

        // Process queue using requestIdleCallback
        this.backgroundLoadPromise = this.processBackgroundQueue(workQueue, 0);
        return this.backgroundLoadPromise;
    }

    /**
     * Process work items using requestIdleCallback with time budget.
     * Supports async work items (for shader prewarm) and ensures consistent loading.
     */
    processBackgroundQueue(queue, index) {
        if (index >= queue.length || !this.isActive) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const finish = () => {
                resolve();
            };

            const processBatch = async (deadline) => {
                if (!this.isActive) {
                    finish();
                    return;
                }

                const startTime = performance.now();
                const budget = deadline?.timeRemaining
                    ? Math.max(2, Math.min(16, deadline.timeRemaining()))
                    : 8;

                // Process items - support async work items
                while (index < queue.length && (performance.now() - startTime) < budget) {
                    const result = queue[index]();
                    // If work item returns a promise (async prewarm), await it
                    if (result instanceof Promise) {
                        await result;
                    }
                    index++;
                }

                if (index < queue.length && this.isActive) {
                    // Schedule next batch
                    if (typeof requestIdleCallback !== 'undefined') {
                        requestIdleCallback(processBatch, { timeout: 200 });
                    } else {
                        requestAnimationFrame(processBatch);
                    }
                } else {
                    finish();
                }
            };

            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(processBatch, { timeout: 200 });
            } else {
                requestAnimationFrame(processBatch);
            }
        });
    }

    // createNeonSignsForBuildings() and createHolographicBillboards() removed - disabled dead code (Phase 0 cleanup)

    // ─────────────────────────────────────────────────────────────────────────
    // Materials
    // ─────────────────────────────────────────────────────────────────────────

    setupMaterials() {
        if (this.isWebGPU) {
            const { material, uniforms } = createBuildingNodeMaterial();
            this.buildingMaterial = material;
            this.buildingUniforms = uniforms;
            this.patchMrtMaterialsForObject(this.buildingMaterial);

            // PHASE 5: Initialize LOD Materials
            if (!this.bakedWindowTexture) {
                this.bakedWindowTexture = createBakedWindowTexture();
            }
            // const lod1 = createBuildingMaterialMediumLOD(this.bakedWindowTexture);
            // Switch to procedural LOD1 for visual consistency
            const lod1 = createProceduralBuildingNodeMaterialLOD1();
            this.buildingMaterialLOD1 = lod1.material;
            this.buildingUniformsLOD1 = lod1.uniforms;
            // const lod2 = createBuildingMaterialLowLOD(this.bakedWindowTexture);
            // Switch to procedural LOD2 as requested
            const lod2 = createProceduralBuildingNodeMaterialLOD2();
            this.buildingMaterialLOD2 = lod2.material;
            this.buildingUniformsLOD2 = lod2.uniforms;

            return;
        }

        // Fallback LOD materials for WebGL (simple standard materials)
        this.buildingMaterialLOD1 = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.8,
        });
        this.buildingMaterialLOD2 = new THREE.MeshBasicMaterial({
            color: 0x0a0a10,
        });

        this.buildingMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uBuildingHeight: { value: 100 },
                uBuildingWidth: { value: 50 },
                uSeed: { value: 0 },
                uGlowIntensity: { value: 1.0 },
                uWindowScale: { value: 1.0 },
                uWindowColor: { value: new THREE.Color(0xffffff) },
            },
            vertexShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                void main() {
                    vPosition = position;
                    vNormal = normal;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uBuildingHeight;
                uniform float uBuildingWidth;
                uniform float uSeed;
                uniform float uGlowIntensity;
                uniform float uWindowScale;
                uniform vec3 uWindowColor;
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                
                // Simple hash function
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                
                void main() {
                    // Base dark color with subtle structural grid
                    vec3 baseColor = vec3(0.01, 0.01, 0.015);
                    
                    // Add concrete noise texture
                    float grunge = noise(vPosition.xy * 0.5 + uSeed * 10.0);
                    baseColor += vec3(0.02) * grunge; // Subtle grime
                    
                    // Structural grid lines (very subtle)
                    float gridX = step(0.98, fract(vPosition.x / 10.0));
                    float gridY = step(0.98, fract(vPosition.y / 10.0));
                    baseColor += vec3(0.03) * max(gridX, gridY);
                    
                    // WINDOW GENERATION
                    // Use seed to vary grid size and aspect ratio per building
                    float aspectParams = hash(vec2(uSeed, 123.45));
                    float gridW = 5.0 + aspectParams * 5.0; // 5-10 width
                    float gridH = 8.0 + hash(vec2(uSeed, 678.90)) * 8.0; // 8-16 height
                    
                    // Adjust by scale uniform
                    gridW *= (0.8 + uWindowScale * 0.4);
                    gridH *= (0.8 + uWindowScale * 0.4);
                    
                    vec2 gridStr = (abs(vNormal.y) < 0.1) ? vPosition.xy : vPosition.xz;
                    gridStr += uSeed * 50.0; // Offset
                    
                    vec2 cell = floor(gridStr / vec2(gridW, gridH));
                    vec2 frac = fract(gridStr / vec2(gridW, gridH));
                    
                    // Window shape - variable gap based on seed
                    float gap = 0.2 + hash(vec2(uSeed, 333.33)) * 0.15; // 0.2 to 0.35 gap
                    bool isWindow = frac.x > gap && frac.x < (1.0 - gap) && 
                                  frac.y > gap && frac.y < (1.0 - gap);
                    
                    // Random lit chance - varied by building logic
                    float buildingLitDensity = 0.2 + hash(vec2(uSeed, 999.0)) * 0.2; // 20-40% density
                    float h = hash(cell + uSeed);
                    bool isLit = isWindow && (h > (1.0 - buildingLitDensity));
                    
                    vec3 finalColor = baseColor;
                    
                    if (isLit) {
                        float hue = hash(cell * 2.0);
                        vec3 pureWhite = vec3(1.0, 1.0, 1.0);
                        vec3 warmWhite = vec3(1.0, 0.94, 0.85);
                        vec3 winColor = mix(pureWhite, warmWhite, step(0.5, hue));

                        // Varied brightness per window (subtle)
                        float wBright = 0.7 + hash(cell * 3.0) * 0.3;
                        finalColor += winColor * wBright * 0.6;
                    }
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });
    }

    shouldUseMrt() {
        if (!this.isWebGPU) return false;
        if (this.featureFlags?.noMrt) return false;
        if (this.featureFlags?.forceMrt) {
            if (!this.sceneSupportsMrt(this.scene)) {
                console.warn('[NeonDistrict] forceMrt enabled but scene contains materials without emissive outputs.');
            }
            return true;
        }
        return false;
    }

    sceneSupportsMrt(object) {
        if (!object) return false;

        let supports = true;
        const checkMaterial = (material) => {
            if (!material || !supports) return;
            if (Array.isArray(material)) {
                material.forEach((mat) => checkMaterial(mat));
                return;
            }
            if (!('emissiveNode' in material)) {
                supports = false;
            }
        };

        const checkObject = (obj) => {
            if (!supports || !obj) return;
            if (obj.material) checkMaterial(obj.material);
        };

        checkObject(object);
        if (object.traverse) {
            object.traverse((child) => {
                if (!supports) return;
                checkObject(child);
            });
        }

        return supports;
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
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    auditMrtMaterials(label = 'MRT Audit') {
        if (!this.isWebGPU || !this.scene) return;

        const seen = new Set();
        const nonNode = [];
        const missingEmissive = [];

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

            if (!('emissiveNode' in material) || !material.emissiveNode) {
                missingEmissive.push({ objectName, materialName });
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

        const formatSample = (entries) => entries
            .slice(0, 12)
            .map((entry) => `- ${entry.objectName}: ${entry.materialName}`)
            .join('\n');

        console.groupCollapsed(`[NeonDistrict][${label}] WebGPU MRT material audit`);
        console.log(`Total unique materials: ${seen.size}`);
        console.log(`Non-NodeMaterials: ${nonNode.length}`);
        if (nonNode.length) {
            console.warn(formatSample(nonNode));
        }
        console.log(`NodeMaterials missing emissiveNode: ${missingEmissive.length}`);
        if (missingEmissive.length) {
            console.warn(formatSample(missingEmissive));
        }
        console.groupEnd();
    }

    colorToVec3(color) {
        const resolved = color?.isColor ? color : new THREE.Color(color ?? 0xffffff);
        return vec3(resolved.r, resolved.g, resolved.b);
    }

    makeEmissiveNode(color, intensity = 1.0) {
        return this.colorToVec3(color).mul(float(intensity));
    }

    createBasicMaterial(params = {}) {
        if (!this.isWebGPU) {
            return new THREE.MeshBasicMaterial(params);
        }

        const {
            color = 0xffffff,
            map = null,
            transparent = false,
            opacity = 1.0,
            blending = THREE.NormalBlending,
            side = THREE.FrontSide,
            depthWrite = true,
            depthTest = true,
        } = params;

        const material = new THREE.MeshBasicNodeMaterial();
        const tintNode = this.colorToVec3(color);
        let colorNode = tintNode;

        if (map) {
            const texNode = uniformTexture(map).sample(uv());
            colorNode = texNode.rgb.mul(tintNode);
            material.opacityNode = texNode.a.mul(float(opacity));
            material.transparent = true;
        } else if (transparent || opacity < 1) {
            material.opacityNode = float(opacity);
            material.transparent = true;
        }

        material.colorNode = colorNode;
        material.emissiveNode = colorNode;
        material.blending = blending;
        material.side = side;
        material.depthWrite = depthWrite;
        material.depthTest = depthTest;

        return material;
    }

    createStandardMaterial(params = {}) {
        if (!this.isWebGPU) {
            return new THREE.MeshStandardMaterial(params);
        }

        const material = new THREE.MeshStandardNodeMaterial(params);
        if (params.emissive) {
            material.emissiveNode = this.makeEmissiveNode(params.emissive, params.emissiveIntensity ?? 1.0);
        } else {
            material.emissiveNode = vec3(0.0, 0.0, 0.0);
        }
        return material;
    }

    createPhongMaterial(params = {}) {
        if (!this.isWebGPU) {
            return new THREE.MeshPhongMaterial(params);
        }

        const material = new THREE.MeshPhongNodeMaterial(params);
        if (params.emissive || params.emissiveMap) {
            const emissiveColor = params.emissive ?? 0xffffff;
            material.emissiveNode = this.makeEmissiveNode(emissiveColor, params.emissiveIntensity ?? 1.0);
        } else {
            material.emissiveNode = vec3(0.0, 0.0, 0.0);
        }
        return material;
    }

    /**
     * Ensure WebGPU MRT has a valid emissive output for every material.
     * Missing emissive outputs cause WebGPU pipeline validation failures and flicker.
     */
    patchMrtMaterial(material) {
        if (!this.isWebGPU || !this.post?.useMRT || !material) return;
        if (this.mrtPatchedMaterials.has(material)) return;
        this.mrtPatchedMaterials.add(material);

        if (!this.isNodeMaterial(material)) return;
        if (material.emissiveNode) return;

        const emissiveIntensity = Number.isFinite(material.emissiveIntensity)
            ? material.emissiveIntensity
            : 1.0;
        const emissiveColor = material.emissive?.isColor
            ? vec3(material.emissive.r, material.emissive.g, material.emissive.b)
            : null;

        let emissiveNode = null;

        if (material.emissiveMap) {
            const emissiveTex = uniformTexture(material.emissiveMap);
            const baseColor = emissiveColor ?? vec3(1.0, 1.0, 1.0);
            emissiveNode = emissiveTex.mul(baseColor).mul(float(emissiveIntensity));
        } else if (emissiveColor) {
            emissiveNode = emissiveColor.mul(float(emissiveIntensity));
        } else if (material.color?.isColor && (
            material.transparent || material.blending === THREE.AdditiveBlending)) {
            emissiveNode = vec3(material.color.r, material.color.g, material.color.b);
        } else {
            emissiveNode = vec3(0.0, 0.0, 0.0);
        }

        material.emissiveNode = emissiveNode;
        material.needsUpdate = true;
    }

    patchMrtMaterialsForObject(object) {
        if (!this.isWebGPU || !this.post?.useMRT || !object) return;

        const patchMaterial = (mat) => {
            if (!mat) return;
            if (Array.isArray(mat)) {
                mat.forEach((m) => this.patchMrtMaterial(m));
            } else {
                this.patchMrtMaterial(mat);
            }
        };

        if (object.material) patchMaterial(object.material);
        if (object.traverse) {
            object.traverse((child) => {
                if (child.material) patchMaterial(child.material);
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera - Street Level Perspective
    // ─────────────────────────────────────────────────────────────────────────

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Use WebGPU renderer with automatic WebGL2 fallback
        this.renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL: this.forceWebGL,
        });
        try {
            await this.renderer.init();
        } catch (error) {
            console.error('[NeonDistrict] Renderer initialization failed:', error);
            return;
        }

        this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = this.renderer.backend?.isWebGLBackend === true;

        this.renderer.setClearColor(0x150820, 1); // Deep Cyberpunk Purple-Black
        // Enable shadow mapping for realistic building shadows on road
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if (this.isWebGPU) {
            this.maxPixelRatio = Math.min(this.maxPixelRatio, 1.25);
            if (this.qualityPreset?.enablePostProcessing) {
                this.postProcessingScale = Math.min(this.postProcessingScale, 0.7);
            }
        }
        this.applyRenderScale(true);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.78;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Street-level camera IN THE ALLEY - more horizontal view
        // Street-level camera IN THE ALLEY - more horizontal view
        // Far clip increased to 10000 to see the horizon tower
        this.camera = new THREE.PerspectiveCamera(70, width / height, 1, 10000);
        this.cameraBaseFov = this.camera.fov; // AAA Phase 7a: rest FOV for dolly-zoom pulse
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraBaseLookAt);
        this.cameraSway.set(0, 0, 0);
        this.cameraLookTarget.copy(this.cameraBaseLookAt);
        this.cameraCurrentLookTarget.copy(this.cameraBaseLookAt);
        this.cameraRollOffset = 0;
        this.cameraDriftSeed = Math.random() * Math.PI * 2;

        console.log('[NeonDistrict] Camera positioned in alley');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Skybox - Dark stormy cyberpunk sky
    // ─────────────────────────────────────────────────────────────────────────

    createSkybox() {
        // Create gradient sky dome - size increased to cover new far clip
        const skyGeometry = new THREE.SphereGeometry(9000, 24, 24);
        let skyMaterial;
        if (this.isWebGPU || this.isWebGL) {
            skyMaterial = createSkyNodeMaterial().material;
        } else {
            skyMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                },
                vertexShader: `
                    varying vec3 vWorldPosition;
                    void main() {
                        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPosition.xyz;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    varying vec3 vWorldPosition;
                    
                    void main() {
                        float height = normalize(vWorldPosition).y;
                        
                        // Deep purple cyberpunk gradient - refined for atmosphere
                        vec3 bottomColor = vec3(0.20, 0.05, 0.30); // Hazy city glow (lighter bottom)
                        vec3 midColor = vec3(0.10, 0.03, 0.20);    // Deep purple mid
                        vec3 topColor = vec3(0.00, 0.00, 0.05);    // Deep space void (dark top)
                        
                        vec3 color;
                        if (height < 0.0) {
                            color = bottomColor;
                        } else if (height < 0.3) {
                            color = mix(bottomColor, midColor, height / 0.3);
                        } else {
                            color = mix(midColor, topColor, (height - 0.3) / 0.7);
                        }
                        
                        // Intense purple atmospheric haze
                        float hazeAmount = 1.0 - smoothstep(-0.2, 0.5, height);
                        vec3 hazeColor = vec3(0.25, 0.08, 0.45); // Vivid purple haze
                        color = mix(color, hazeColor, hazeAmount * 0.6);

                        // AAA Phase 4d: faint animated city light-pollution band.
                        float horizonLower = smoothstep(-0.45, -0.08, height);
                        float horizonUpper = 1.0 - smoothstep(0.0, 0.34, height);
                        float horizonMask = horizonLower * horizonUpper;
                        float shimmer = 1.0
                            + sin(vWorldPosition.x * 0.0012 + uTime * 0.09) * 0.12
                            + sin(vWorldPosition.z * 0.0017 - uTime * 0.055) * 0.08;
                        vec3 glowColor = vec3(0.72, 0.10, 0.62)
                            + vec3(0.05, 0.20, 0.36) * (sin(uTime * 0.12) * 0.5 + 0.5);
                        color += glowColor * horizonMask * shimmer * 0.28;
                        
                        // Stars are rendered separately as a point field
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.BackSide,
            });
        }

        this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(this.sky);
        this.freezeStaticObject(this.sky);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Neon night stars inspired by Blood Moon
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount || 6000;
        if (starCount <= 0) return;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2);
        const brightness = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xcce6ff), // Cool white
            new THREE.Color(0x88ccff), // Soft cyan
            new THREE.Color(0xb388ff), // Violet
            new THREE.Color(0xffb3ff), // Soft pink
            new THREE.Color(0x7aa6ff), // Blue accent
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            const radius = 6000 + Math.random() * 3000;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 18 + Math.random() * 40;
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 0.6 + Math.random() * 1.6;
            brightness[i] = 0.25 + Math.random() * 0.75;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        let material;
        if (this.isWebGPU) {
            const { material: nodeMaterial, uniforms } = createStarfieldNodeMaterial();
            material = nodeMaterial;
            this.starUniforms = uniforms;
            if (this.starUniforms?.uPixelRatio) {
                this.starUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                },
                vertexShader: NEON_DISTRICT_STAR_VERTEX_SHADER,
                fragmentShader: NEON_DISTRICT_STAR_FRAGMENT_SHADER,
                transparent: true,
                vertexColors: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }

        this.starfield = new THREE.Points(geometry, material);
        this.starfield.frustumCulled = false;
        this.scene.add(this.starfield);
        console.log('[NeonDistrict] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Procedural Cyberpunk Buildings
    // ─────────────────────────────────────────────────────────────────────────

    async createBuildings() {
        // Skip buildings if noBuildings flag is set (for performance testing)
        if (this.featureFlags?.noBuildings) {
            console.log('[NeonDistrict] Buildings disabled via noBuildings flag');
            return;
        }

        this.adInstanceBuckets = { small: [], large: [] };
        this.instancedBillboardUniforms = [];

        const { buildingCount } = this.qualityPreset;
        const streetWidth = 180; // Width of the alley corridor
        const buildingSpacing = 120; // Space between buildings along the street
        const CHUNK_SIZE = 2; // Small chunks to avoid ANY lag during gameplay

        // Calculate buildings per side
        const buildingsPerSide = Math.floor(buildingCount / 2);
        const alleyLength = buildingsPerSide * buildingSpacing;

        // Outer row configuration
        const outerAlleyGap = 60; // Gap between inner and outer rows (secondary alleys)
        const avgBuildingWidth = 110; // Average building width for offset calculation
        const outerRowOffset = streetWidth / 2 + 50 + avgBuildingWidth + outerAlleyGap;

        // Prepare all building configs first (fast)
        const buildingConfigs = [];
        // Separate array for outer buildings (100% pooled for max performance)
        const outerBuildingConfigs = [];
        const tier2Instances = [];
        this.tier2Bounds = [];

        // Left side buildings (inner row)
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100;
            const xPos = -(streetWidth / 2 + 50 + Math.random() * 30);
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;
            buildingConfigs.push({
                x: xPos, z: zPos, width, height, depth,
            });
        }

        // Right side buildings (inner row)
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100 - buildingSpacing / 2;
            const xPos = streetWidth / 2 + 50 + Math.random() * 30;
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;
            buildingConfigs.push({
                x: xPos, z: zPos, width, height, depth,
            });

            // FILLER BUILDING: Add extra building to the right of the first one to cover void
            if (i === 0) {
                const gap = 40; // Proper alleyway gap
                const fillerW = 200 + Math.random() * 100; // Wide filler
                // Precise math: Center of Building 1 + Half Width of B1 + Gap + Half Width of Filler
                const fillerX = xPos + (width / 2) + gap + (fillerW / 2);

                // Align Z slightly behind (further from camera) or aligned to create a corner
                // zPos is negative. zPos is center.
                // Let's align it exactly with the street front (zPos)
                const fillerZ = zPos;

                buildingConfigs.push({
                    x: fillerX,
                    z: fillerZ,
                    width: fillerW,
                    height: height * 0.9,
                    depth: depth * 1.5,
                    forceHighDetail: true,
                });
            }
        }

        this.maxHighDetailHeight = buildingConfigs.reduce((max, cfg) => Math.max(max, cfg.height || 0), 0);

        // ═══════════════════════════════════════════════════════════════════════
        // OUTER ROWS - Two additional building rows creating secondary alleys
        // These use 100% pool cloning for maximum performance
        // ═══════════════════════════════════════════════════════════════════════

        // Outer rows layers (left and right) - 8 layers deep to fill voids from high camera (Increased from 3)
        const numOuterLayers = 8;

        for (let layer = 0; layer < numOuterLayers; layer++) {
            const layerSpacing = 150; // Spacing between layers (Tighter)
            const currentOffset = outerRowOffset + (layer * layerSpacing);

            // Left side outer rows
            for (let i = 0; i < buildingsPerSide; i++) {
                const zPos = -i * buildingSpacing - 100 - buildingSpacing * (0.2 + layer * 0.1);
                const xPos = -(currentOffset + 50 + Math.random() * 40);
                outerBuildingConfigs.push({ x: xPos, z: zPos, poolOnly: true });
            }

            // Right side outer rows
            for (let i = 0; i < buildingsPerSide; i++) {
                const zPos = -i * buildingSpacing - 100 - buildingSpacing * (0.7 + layer * 0.1);
                const xPos = currentOffset + 50 + Math.random() * 40;
                outerBuildingConfigs.push({ x: xPos, z: zPos, poolOnly: true });
            }
        }

        // Background buildings (distant, larger) - Increased range and count
        // alleyLength is already defined above
        for (let i = 0; i < 50; i++) {
            const zPos = -alleyLength - 200 - Math.random() * 6000; // Extend way back

            // EXCLUSION ZONE: Keep center clear for Mega Tower visibility
            // Spawn either far left (<-300) or far right (>300)
            const side = Math.random() > 0.5 ? 1 : -1;
            const xPos = side * (300 + Math.random() * 600);

            const width = 150 + Math.random() * 200;
            const depth = 150 + Math.random() * 200;
            const height = 1000 + Math.random() * 2000; // Taller background towers
            const cappedHeight = this.maxHighDetailHeight
                ? Math.min(height, this.maxHighDetailHeight)
                : height;
            buildingConfigs.push({
                x: xPos, z: zPos, width, height: cappedHeight, depth,
            });
        }

        // CREATE BUILDINGS IN SMALL CHUNKS (idle-time loading)
        for (let i = 0; i < buildingConfigs.length; i += CHUNK_SIZE) {
            if (!this.isActive) return; // Check if stopped

            const chunk = buildingConfigs.slice(i, i + CHUNK_SIZE);

            // Use Pool for 80% of buildings (perf), create fresh for 20% (variety)
            chunk.forEach((cfg) => {
                let created = null;
                const lodTier = cfg.forceHighDetail ? 0 : this.determineLODTier(cfg.x, cfg.z);

                if (lodTier === 2) {
                    tier2Instances.push(cfg);
                    return;
                }

                // Only pool Tier 0 buildings to avoid complexity
                if (lodTier === 0 && !cfg.forceHighDetail && Math.random() < 0.8) {
                    created = this.createBuildingFromPool(cfg.x, cfg.z);
                } else {
                    const b = this.createBuilding(cfg.x, cfg.z, cfg.width, cfg.height, cfg.depth, lodTier);
                    this.scene.add(b);
                    this.buildings.push(b);
                    created = b;
                }
                if (created) {
                    this.patchMrtMaterialsForObject(created);
                    this.freezeStaticObject(created, true);
                }
            });

            // Wait for idle time before next chunk - doesn't compete with gameplay
            if (i + CHUNK_SIZE < buildingConfigs.length) {
                await this.deferToIdleTime();
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CREATE OUTER ROW BUILDINGS - Simple boxes for better FPS
        // Single mesh per building, shared materials, no complex features
        // ═══════════════════════════════════════════════════════════════════════
        if (!this.isActive) return;
        this.createTier2Instances(tier2Instances);
        this.createOuterBuildingInstances(outerBuildingConfigs);

        // Merge static rooftop props to reduce draw calls
        this.batchRooftopProps();

        // HLOD for mid-distance buildings (Tier 1)
        this.createHlodClusters();

        this.flushAdInstanceBatches();

        this.finalizeStaticShadows();

        const totalBuildings = buildingConfigs.length + outerBuildingConfigs.length;
        console.log(`[NeonDistrict] Created ${totalBuildings} buildings (${outerBuildingConfigs.length} instanced outer)`);
    }

    determineLODTier(x, z) {
        const absX = Math.abs(x);
        const camPos = this.camera?.position || this.cameraBasePosition;
        const dx = x - camPos.x;
        const dz = z - camPos.z;
        const dist = Math.hypot(dx, dz);
        const scale = this.lodScale || 1.0;
        const nearDist = this.buildingLodConfig.nearDistance * scale;
        const midDist = this.buildingLodConfig.midDistance * scale;

        // Tier 0: Main Road + Near Distance (High Detail)
        if (absX <= this.buildingLodConfig.mainRoadX && dist <= nearDist) return 0;

        // Tier 1: Outer Rows + Mid Distance (Medium Detail - Baked Texture)
        if (absX <= this.buildingLodConfig.outerRoadX && dist <= midDist) return 1;

        // Tier 2: Background (Low Detail - Simple Box)
        return 2;
    }

    determineBillboardLODTier(x, z) {
        const camPos = this.camera?.position || this.cameraBasePosition;
        const dx = x - camPos.x;
        const dz = z - camPos.z;
        const dist = Math.hypot(dx, dz);
        const scale = this.lodScale || 1.0;
        const nearDist = this.signLodConfig.nearDistance * scale;
        const midDist = this.signLodConfig.midDistance * scale;

        if (dist <= nearDist) return 0;
        if (dist <= midDist) return 1;
        return 2;
    }

    createBuilding(x, z, width, height, depth, lodTier = 0) {
        if (lodTier > 0 && this.maxHighDetailHeight) {
            height = Math.min(height, this.maxHighDetailHeight);
        }
        const building = new THREE.Group();
        building.position.set(x, 0, z);
        building.userData.width = width;
        building.userData.height = height;
        building.userData.depth = depth;
        building.userData.lodTier = lodTier;

        // TIER 0: Full Detail (Main Road)
        if (lodTier === 0) {
            // BUILDING VARIETY - all use shader-based windows
            const type = Math.random();

            if (type < 0.5) {
                this.createComplexTower(building, width, height, depth);
            } else if (type < 0.7) {
                this.createSteppedBuilding(building, width, height, depth);
            } else if (type < 0.8) {
                this.createSpireBuilding(building, width, height, depth);
            } else if (type < 0.9) {
                this.createWideBaseBuilding(building, width, height, depth);
            } else {
                this.createStandardTower(building, width, height, depth);
            }

            // Add Storefront (Ground Floor) - Only for Tier 0
            this.createStorefront(building, width, depth);

            // Add building-attached ads - Only for Tier 0
            const shouldAddAds = (z !== 0 && z < -50) || (z === 0 && Math.random() > 0.5);
            if (shouldAddAds && this.assets?.loaded) {
                this.attachAdsToBuilding(building, width, height, depth);
            }

            // TIER 1: Medium Detail (Outskirts) - Baked Texture
        } else if (lodTier === 1) {
            this.createSimplifiedTower(building, width, height, depth);

            // TIER 2: Low Detail (Background) - Simple Box
        } else {
            this.createBasicBox(building, width, height, depth);
        }

        // NOTE: building is NOT added to scene/arrays here anymore. caller must do it.
        return building;
    }

    // TIER 1: Simplified geometry with baked texture
    createSimplifiedTower(parent, width, height, depth) {
        // Keep silhouette variety but collapse to ONE mesh (merged geometry).
        const segments = Math.floor(Math.random() * 2) + 1;
        let currentY = 0;
        const scaleFactor = 0.015;
        const segmentGeometries = [];

        for (let i = 0; i < segments; i++) {
            const sectionHeight = (height / segments) * (0.8 + Math.random() * 0.4);
            const sectionWidth = width * (1.0 - i * 0.1);
            const sectionDepth = depth * (1.0 - i * 0.1);

            const geometry = new THREE.BoxGeometry(sectionWidth, sectionHeight, sectionDepth);
            const uvAttribute = geometry.attributes.uv;

            // BoxGeometry UV mapping:
            // 0-3: Right (+x), 4-7: Left (-x)
            // 8-11: Top (+y), 12-15: Bottom (-y)
            // 16-19: Front (+z), 20-23: Back (-z)
            for (let j = 0; j < uvAttribute.count; j++) {
                const u = uvAttribute.getX(j);
                const v = uvAttribute.getY(j);

                let repeatX; let repeatY;
                if (j < 8) { // Sides (Use Depth x Height)
                    repeatX = sectionDepth * scaleFactor;
                    repeatY = sectionHeight * scaleFactor;
                } else if (j < 16) { // Top/Bottom (Use Width x Depth)
                    repeatX = sectionWidth * scaleFactor;
                    repeatY = sectionDepth * scaleFactor;
                } else { // Front/Back (Use Width x Height)
                    repeatX = sectionWidth * scaleFactor;
                    repeatY = sectionHeight * scaleFactor;
                }

                uvAttribute.setXY(j, u * repeatX, v * repeatY);
            }

            geometry.translate(0, currentY + sectionHeight / 2, 0);
            segmentGeometries.push(geometry);
            currentY += sectionHeight;
        }

        const merged = mergeGeometries(segmentGeometries, false);
        segmentGeometries.forEach((geom) => geom.dispose());
        // PERF: Use procedural material - shader handles distance-based resolution scaling
        const mesh = new THREE.Mesh(merged, this.buildingMaterial || this.buildingMaterialLOD1);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
    }

    // TIER 2: Basic box with emissive color
    createBasicBox(parent, width, height, depth) {
        if (!this.lod2Geometry) {
            this.lod2Geometry = new THREE.BoxGeometry(1, 1, 1);
        }

        const mesh = new THREE.Mesh(this.lod2Geometry, this.buildingMaterial || this.buildingMaterialLOD2);
        mesh.position.y = height / 2;
        mesh.scale.set(width, height, depth);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
    }

    /**
     * Generate a pool of varied building prototypes
     */
    generateBuildingPool() {
        if (this.buildingPool.length > 0) return; // Already generated

        console.log('[NeonDistrict] Generating building pool...');
        const poolSize = 15;

        for (let i = 0; i < poolSize; i++) {
            // Generate generic dimensions
            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;

            // Create building at 0,0 (prototype)
            const building = this.createBuilding(0, 0, width, height, depth);
            this.buildingPool.push(building);
        }
    }

    /**
     * Generate simple box buildings for outer rows (better FPS)
     * Uses SynthCity texture-based materials with proper UV scaling
     */
    generateSimpleOuterBuildingPool() {
        if (this.simpleOuterBuildingPool.length > 0) return;

        console.log('[NeonDistrict] Generating simple outer building pool...');
        const poolSize = 8; // Fewer variations needed for distant buildings
        const scaleFactor = 0.015; // Same as createSimplifiedTower for consistency

        for (let i = 0; i < poolSize; i++) {
            const width = 80 + Math.random() * 100;
            const depth = 80 + Math.random() * 100;
            let height = 400 + Math.random() * 800;
            if (this.maxHighDetailHeight) {
                height = Math.min(height, this.maxHighDetailHeight);
            }

            // Simple box geometry - single mesh, no groups
            const geometry = new THREE.BoxGeometry(width, height, depth);

            // CRITICAL: Scale UVs to match building dimensions
            // Without this, textures appear stretched/distorted (the "swirly" look)
            const uvAttribute = geometry.attributes.uv;
            for (let j = 0; j < uvAttribute.count; j++) {
                const u = uvAttribute.getX(j);
                const v = uvAttribute.getY(j);

                let repeatX, repeatY;
                // BoxGeometry UV mapping:
                // 0-3: Right (+x), 4-7: Left (-x)
                // 8-11: Top (+y), 12-15: Bottom (-y)
                // 16-19: Front (+z), 20-23: Back (-z)
                if (j < 8) { // Sides (Use Depth x Height)
                    repeatX = depth * scaleFactor;
                    repeatY = height * scaleFactor;
                } else if (j < 16) { // Top/Bottom (Use Width x Depth)
                    repeatX = width * scaleFactor;
                    repeatY = depth * scaleFactor;
                } else { // Front/Back (Use Width x Height)
                    repeatX = width * scaleFactor;
                    repeatY = height * scaleFactor;
                }

                uvAttribute.setXY(j, u * repeatX, v * repeatY);
            }
            uvAttribute.needsUpdate = true;

            // Use the same texture-based material as main buildings
            const matIndex = (i % 10) + 1;
            const matId = `building_${matIndex.toString().padStart(2, '0')}`;
            const material = this.assets.getMaterial(matId);

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = height / 2;

            // Store dimensions for reference
            mesh.userData.height = height;
            mesh.userData.width = width;
            mesh.userData.depth = depth;
            mesh.userData.isSimpleBuilding = true;

            this.simpleOuterBuildingPool.push(mesh);
        }
    }

    /**
     * Create a simple outer building by cloning from pool
     */
    createSimpleOuterBuilding(x, z) {
        if (this.simpleOuterBuildingPool.length === 0) {
            this.generateSimpleOuterBuildingPool();
        }

        const prototype = this.simpleOuterBuildingPool[
            Math.floor(Math.random() * this.simpleOuterBuildingPool.length)
        ];
        const clone = prototype.clone();

        clone.position.x = x;
        clone.position.z = z;
        clone.userData.lodTier = 2;

        // Random Y rotation for variety
        clone.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);

        const simpleHeight = clone.userData.height;
        if (simpleHeight) {
            const simpleWidth = clone.userData.width || 60;
            const simpleDepth = clone.userData.depth || 60;
            this.addRooftopBeacons(clone, simpleWidth, simpleHeight / 2, simpleDepth, {
                chance: 0.35,
                minCount: 1,
                maxCount: 2,
                spread: 0.5,
                yOffset: 2,
                heightForBoost: simpleHeight,
            });
        }

        this.scene.add(clone);
        this.buildings.push(clone);
        this.freezeStaticObject(clone, true);

        return clone;
    }

    createOuterBuildingInstances(outerBuildingConfigs) {
        if (!this.assets?.loaded || outerBuildingConfigs.length === 0) return;

        if (!this.outerBuildingGeometry) {
            this.outerBuildingGeometry = new THREE.BoxGeometry(1, 1, 1);
        }

        this.outerBuildingBounds = [];

        const materialBuckets = new Map();

        outerBuildingConfigs.forEach((cfg) => {
            const width = 80 + Math.random() * 100;
            const depth = 80 + Math.random() * 100;
            let height = 400 + Math.random() * 800;
            if (this.maxHighDetailHeight) {
                height = Math.min(height, this.maxHighDetailHeight);
            }
            const rotation = Math.floor(Math.random() * 4) * (Math.PI / 2);

            const matIndex = Math.floor(Math.random() * 10) + 1;
            const matId = `building_${matIndex.toString().padStart(2, '0')}`;

            if (!materialBuckets.has(matId)) {
                materialBuckets.set(matId, []);
            }
            materialBuckets.get(matId).push({
                x: cfg.x,
                z: cfg.z,
                width,
                height,
                depth,
                rotation,
            });

            const rotSteps = Math.round(rotation / (Math.PI / 2)) % 4;
            const swapped = rotSteps % 2 !== 0;
            const halfX = (swapped ? depth : width) / 2;
            const halfZ = (swapped ? width : depth) / 2;
            this.outerBuildingBounds.push({
                minX: cfg.x - halfX,
                maxX: cfg.x + halfX,
                minZ: cfg.z - halfZ,
                maxZ: cfg.z + halfZ,
                height,
            });

            this.addRooftopBeaconsAt(
                cfg.x,
                cfg.z,
                rotation,
                width,
                height,
                depth,
                {
                    chance: 0.25,
                    minCount: 1,
                    maxCount: 2,
                    spread: 0.5,
                    yOffset: 2,
                    heightForBoost: height,
                },
            );
        });

        const dummy = new THREE.Object3D();
        // PERF: Use procedural material with resolution scaling for ALL outer buildings
        // This ensures consistent look with near buildings, just at lower effective resolution
        const allInstances = [];
        materialBuckets.forEach((instances) => {
            allInstances.push(...instances);
        });

        if (allInstances.length > 0) {
            // Use optimized material: same textures but simplified rendering
            // - Lower mip levels for faster sampling
            // - No bump mapping or specular calculations
            // - MeshBasicMaterial instead of MeshPhongMaterial
            const material = this.getOuterBuildingMaterial('building_01')
                || this.assets?.getMaterial('building_01')
                || this.buildingMaterialLOD2;
            const mesh = new THREE.InstancedMesh(this.outerBuildingGeometry, material, allInstances.length);
            mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

            allInstances.forEach((inst, i) => {
                dummy.position.set(inst.x, inst.height / 2, inst.z);
                dummy.rotation.y = inst.rotation;
                dummy.scale.set(inst.width, inst.height, inst.depth);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            });

            mesh.instanceMatrix.needsUpdate = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            // Prevent aggressive frustum culling from popping instanced rows on camera sway
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            this.patchMrtMaterialsForObject(mesh);
            this.outerBuildingInstances.push(mesh);
        }
    }

    createTier2Instances(instances) {
        if (!instances || instances.length === 0) return;
        if (!this.scene) return;

        if (!this.tier2InstanceGeometry) {
            this.tier2InstanceGeometry = new THREE.BoxGeometry(1, 1, 1);
        }

        if (this.tier2InstanceMesh) {
            this.scene.remove(this.tier2InstanceMesh);
            this.tier2InstanceMesh = null;
        }

        // PERF: Use procedural material with resolution scaling for consistent look
        // The shader automatically reduces detail at distance via coordinate quantization
        const material = this.buildingMaterial || this.buildingMaterialLOD2;
        const mesh = new THREE.InstancedMesh(this.tier2InstanceGeometry, material, instances.length);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        const dummy = new THREE.Object3D();
        this.tier2Bounds = [];

        instances.forEach((inst, i) => {
            const width = inst.width;
            const depth = inst.depth;
            const heightCap = this.maxHighDetailHeight || inst.height;
            const height = Math.min(inst.height, heightCap);

            dummy.position.set(inst.x, height / 2, inst.z);
            dummy.rotation.y = 0;
            dummy.scale.set(width, height, depth);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);

            this.tier2Bounds.push({
                minX: inst.x - width / 2,
                maxX: inst.x + width / 2,
                minZ: inst.z - depth / 2,
                maxZ: inst.z + depth / 2,
                height,
            });
        });

        mesh.instanceMatrix.needsUpdate = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.patchMrtMaterialsForObject(mesh);
        this.tier2InstanceMesh = mesh;
    }

    createHlodClusters() {
        if (!this.scene) return;
        if (!this.buildings?.length) return;

        // Merge Tier 1 buildings into clustered HLODs by material + grid cell
        const clusterSize = this.hlodClusterSize || 800;
        const clusters = new Map();
        const lod1Buildings = [];

        this.buildings.forEach((building) => {
            if (building.userData?.lodTier !== 1) return;
            lod1Buildings.push(building);

            building.updateMatrixWorld(true);
            const worldPos = building.position;
            const cellX = Math.floor(worldPos.x / clusterSize);
            const cellZ = Math.floor(worldPos.z / clusterSize);

            building.traverse((child) => {
                if (!child.isMesh || !child.geometry) return;
                const material = child.material;
                if (!material) return;
                const key = `${cellX}:${cellZ}:${material.uuid}`;
                if (!clusters.has(key)) {
                    clusters.set(key, { material, geometries: [] });
                }

                const geom = child.geometry.clone();
                geom.applyMatrix4(child.matrixWorld);
                clusters.get(key).geometries.push(geom);
            });
        });

        if (clusters.size === 0) return;

        // Remove original Tier 1 buildings from scene (keep for bounds/collision)
        lod1Buildings.forEach((building) => {
            if (building.parent) {
                building.parent.remove(building);
            }
        });

        // Build merged HLOD meshes
        clusters.forEach((cluster) => {
            const merged = mergeGeometries(cluster.geometries, false);
            cluster.geometries.forEach((geom) => geom.dispose());
            if (!merged) return;

            const mesh = new THREE.Mesh(merged, cluster.material);
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            this.hlodMeshes.push(mesh);
            this.patchMrtMaterialsForObject(mesh);
        });
    }

    finalizeStaticShadows() {
        if (!this.renderer?.shadowMap?.enabled) return;
        this.renderer.shadowMap.needsUpdate = true;
        this.renderer.shadowMap.autoUpdate = false;
    }

    createMegaTowerWindowOverlayMaterial() {
        if (this.isWebGPU) {
            const { material, uniforms } = createMegaTowerNodeMaterial();
            material.transparent = true;
            material.depthWrite = false;
            material.blending = THREE.AdditiveBlending;
            // Subtle visibility for distant tower windows (minimal bloom)
            if (material.colorNode) {
                material.colorNode = material.colorNode.mul(float(0.4));
            }
            if (material.emissiveNode) {
                material.emissiveNode = material.emissiveNode.mul(float(0.3));
            }
            this.megaTowerOverlayUniforms = uniforms;
            this.megaTowerOverlayMaterial = material;
            return material;
        }

        const overlayMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0.45 },  // Subtle glow
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uIntensity;
                varying vec2 vUv;

                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }

                void main() {
                    vec2 gridUv = vUv * vec2(28.0, 120.0);
                    vec2 cell = floor(gridUv);
                    vec2 st = fract(gridUv);

                    float window = step(0.2, st.x) * step(0.2, st.y) * step(st.x, 0.8) * step(st.y, 0.85);
                    float noise = random(cell);
                    float state = step(0.6, noise);
                    float intensity = 0.3 + random(cell + 10.0) * 0.4;  // Much more subtle

                    // Stable warm/cool window colors (no flickering)
                    vec3 colWarm = vec3(1.0, 0.9, 0.7);   // Warm white
                    vec3 colCool = vec3(0.7, 0.85, 1.0);  // Cool white
                    vec3 mixedColor = mix(colWarm, colCool, noise);  // Static per window

                    float on = window * state;
                    vec3 finalColor = mixedColor * intensity * uIntensity * on;

                    gl_FragColor = vec4(finalColor, on * 0.6);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.megaTowerOverlayUniforms = overlayMaterial.uniforms;
        this.megaTowerOverlayMaterial = overlayMaterial;
        return overlayMaterial;
    }

    createMegaTower() {
        // Skip mega tower if noMegaTower flag is set
        if (this.featureFlags?.noMegaTower) {
            console.log('[NeonDistrict] Mega tower disabled via noMegaTower flag');
            return;
        }

        // Massive hero building at the end of the road
        const width = 400;
        const depth = 400;
        const height = 3300;

        // Positioned dead center at the far end
        // Slightly off-center to the right (refined from 300 to 150)
        const x = 260;
        const z = -6000;

        const building = new THREE.Group();
        building.position.set(x, 0, z);
        let towerBillboard = null;

        // Core tower
        // OPTIMIZED: Use a cached window texture to avoid expensive per-pixel noise
        const megaTowerLite = Boolean(this.featureFlags?.megaTowerLite);
        const megaTowerNoBloom = Boolean(this.featureFlags?.megaTowerNoBloom);
        const useAssetMaterial = this.assets?.loaded && !megaTowerLite && !megaTowerNoBloom;

        if (useAssetMaterial) {
            const baseMaterial = this.assets.getBuildingMaterial(0.35);
            if (baseMaterial) {
                const towerMaterial = baseMaterial.clone();
                const repeatX = Math.max(1, Math.round(width / 130));
                const repeatY = Math.max(1, Math.round(height / 1000));
                const applyRepeat = (tex) => {
                    if (!tex) return null;
                    const cloned = tex.clone();
                    cloned.wrapS = THREE.RepeatWrapping;
                    cloned.wrapT = THREE.RepeatWrapping;
                    cloned.repeat.set(repeatX, repeatY);
                    cloned.needsUpdate = true;
                    return cloned;
                };

                if (towerMaterial.map) {
                    towerMaterial.map = applyRepeat(towerMaterial.map);
                }
                if (towerMaterial.emissiveMap) {
                    towerMaterial.emissiveMap = applyRepeat(towerMaterial.emissiveMap);
                }
                if (towerMaterial.specularMap) {
                    towerMaterial.specularMap = applyRepeat(towerMaterial.specularMap);
                }
                if (towerMaterial.bumpMap) {
                    towerMaterial.bumpMap = applyRepeat(towerMaterial.bumpMap);
                }
                if (Number.isFinite(towerMaterial.emissiveIntensity)) {
                    towerMaterial.emissiveIntensity *= 2.2;
                }
                if (towerMaterial.color?.isColor) {
                    towerMaterial.color.multiplyScalar(0.65);
                }
                if (towerMaterial.specular?.isColor) {
                    towerMaterial.specular.multiplyScalar(0.25);
                }
                if (this.isWebGPU && this.assets?.applyEmissiveNode) {
                    this.assets.applyEmissiveNode(towerMaterial);
                }
                towerMaterial.needsUpdate = true;
                this.megaTowerMaterial = towerMaterial;
                this.megaTowerUniforms = null;
            }
        }

        if (!this.megaTowerMaterial) {
            const useLiteTexture = megaTowerLite || megaTowerNoBloom;
            const megaTexture = this.getMegaTowerTexture(useLiteTexture);
            if (megaTexture) {
                const towerIntensity = megaTowerNoBloom ? 0.65 : megaTowerLite ? 0.85 : 1.2;
                if (this.isWebGPU) {
                    const material = new THREE.MeshBasicNodeMaterial();
                    const texNode = uniformTexture(megaTexture).sample(uv());
                    material.colorNode = texNode.rgb.mul(float(towerIntensity));
                    if (megaTowerNoBloom) {
                        material.emissiveNode = vec3(0.0, 0.0, 0.0);
                    }
                    material.transparent = false;
                    this.megaTowerMaterial = material;
                } else {
                    this.megaTowerMaterial = new THREE.MeshBasicMaterial({
                        map: megaTexture,
                        color: new THREE.Color(towerIntensity, towerIntensity, towerIntensity),
                    });
                }
                this.megaTowerUniforms = null;
            } else if (this.isWebGPU) {
                const { material, uniforms } = createMegaTowerNodeMaterial();
                this.megaTowerMaterial = material;
                this.megaTowerUniforms = uniforms;
            } else {
                this.megaTowerMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uColor: { value: new THREE.Color(0x100018) }, // Darker purple base (almost black)
                        uWindowColor: { value: new THREE.Color(0xff00ff) }, // Bright pink windows
                    },
                    vertexShader: `
                        varying vec2 vUv;
                        varying vec3 vPosition;
                        void main() {
                            vUv = uv;
                            vPosition = position;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `,
                    fragmentShader: `
                        uniform float uTime;
                        uniform vec3 uColor;
                        uniform vec3 uWindowColor;
                        varying vec2 vUv;
                        varying vec3 vPosition;

                        float random(vec2 st) {
                            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                        }

                        void main() {
                            // Create window grid - Higher density for "massive" scale feel
                            // Scale UVs for tiling - Reduced slightly from 40x200 to 20x100 for less noise
                            vec2 gridUv = vUv * vec2(25.0, 100.0); 
                            vec2 cell = floor(gridUv);
                            vec2 st = fract(gridUv);

                            // Window shape (more padding = smaller windows)
                            // step(0.3, st.x) means left gap is 0.3
                            float window = step(0.22, st.x) * step(0.22, st.y) * step(st.x, 0.78) * step(st.y, 0.85);

                            // Randomly turn windows on/off - STATIC placement
                            float noise = random(cell); 
                            // Only light up 15% of windows (was 30%) for much more subtle effect
                            float state = step(0.7, noise); 

                            // Vary intensity - Softer
                            float intensity = 0.8 + random(cell) * 2.2;

                            // COLOR DRIFT ANIMATION
                            // Cycle: Pink -> Purple -> Cyan -> Pink
                            vec3 colPink = vec3(1.0, 0.0, 1.0);
                            vec3 colCyan = vec3(0.0, 1.0, 1.0);
                            vec3 colPurple = vec3(0.6, 0.0, 1.0);
                            
                            // Slow time cycle
                            float t = uTime * 0.2; 
                            vec3 mixedColor = mix(colPink, colPurple, 0.5 + 0.5 * sin(t));
                            mixedColor = mix(mixedColor, colCyan, 0.5 + 0.5 * sin(t * 0.7 + 2.0));

                            vec3 finalColor = uColor;
                            if (window > 0.5 && state > 0.5) {
                                finalColor = mixedColor * intensity;
                            }

                            gl_FragColor = vec4(finalColor, 1.0);
                        }
                    `,
                });
            }
        }

        const geom = new THREE.BoxGeometry(width, height, depth);
        const mesh = new THREE.Mesh(geom, this.megaTowerMaterial);
        mesh.position.y = height / 2;
        building.add(mesh);

        // Boost window visibility with an emissive overlay that matches nearby buildings
        if (useAssetMaterial) {
            const overlayMap = this.megaTowerMaterial?.emissiveMap || this.megaTowerMaterial?.map;
            if (overlayMap) {
                const overlayMat = this.createBasicMaterial({
                    map: overlayMap,
                    color: 0xffffff,
                    transparent: true,
                    opacity: 1.0,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                const overlay = new THREE.Mesh(geom, overlayMat);
                overlay.position.y = height / 2;
                overlay.scale.set(1.006, 1.006, 1.006);
                overlay.renderOrder = 1;
                building.add(overlay);
                this.patchMrtMaterialsForObject(overlay);
            }
        }

        // Always add a bright procedural window overlay for visibility at distance
        const windowOverlayMat = this.createMegaTowerWindowOverlayMaterial();
        if (windowOverlayMat) {
            const windowOverlay = new THREE.Mesh(geom, windowOverlayMat);
            windowOverlay.position.y = height / 2;
            windowOverlay.scale.set(1.01, 1.01, 1.01);
            windowOverlay.renderOrder = 2;
            building.add(windowOverlay);
            this.patchMrtMaterialsForObject(windowOverlay);
        }

        // Add a large, camera-facing VHS billboard on the mega tower
        towerBillboard = this.createVHSBillboardOnBuilding(building, width, height, depth);
        if (towerBillboard) {
            towerBillboard.position.set(0, height * 0.58, depth * 0.5 + 8);
            towerBillboard.scale.set(2.8, 2.8, 1);
            towerBillboard.renderOrder = 3;
            towerBillboard.frustumCulled = false;
            if (towerBillboard.material) {
                towerBillboard.material.depthWrite = false;
            }
            if (this.camera) {
                towerBillboard.quaternion.copy(this.camera.quaternion);
                towerBillboard.updateMatrix();
            }
            this.registerBillboard(towerBillboard);
        }

        // Add some glowing rings or details
        const showRing = !megaTowerLite || megaTowerNoBloom;
        if (showRing) {
            // Simplified ring: flat ring geometry + unlit material (lower bloom impact)
            const ringInner = width * 0.72;
            const ringOuter = width * 0.8;
            const ringSegments = megaTowerLite ? 24 : 32;
            const ringGeom = new THREE.RingGeometry(ringInner, ringOuter, ringSegments);
            const ringIntensity = megaTowerNoBloom ? 0.45 : megaTowerLite ? 0.55 : 0.75;
            const ringColor = new THREE.Color(0xff00ff).multiplyScalar(ringIntensity);
            const ringMat = this.createBasicMaterial({
                color: ringColor,
                side: THREE.DoubleSide,
            });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = height * 0.8;
            building.add(ring);
        }

        // Mast on top for aviation light
        const mastHeight = megaTowerLite ? 160 : 220;
        const mastGeometry = new THREE.CylinderGeometry(6, 10, mastHeight, megaTowerLite ? 6 : 10);
        const mastMaterial = this.createStandardMaterial({
            color: 0x2a2a36,
            metalness: 0.7,
            roughness: 0.4,
            emissive: 0x110011,
            emissiveIntensity: 0.2,
        });
        const mast = new THREE.Mesh(mastGeometry, mastMaterial);
        mast.position.y = height + mastHeight / 2;
        building.add(mast);

        // Add to scene
        this.scene.add(building);
        this.buildings.push(building);
        this.patchMrtMaterialsForObject(building);

        // ─────────────────────────────────────────────────────────────────────
        // Red Blinking Light at the top (Aviation Obstruction Light)
        // ─────────────────────────────────────────────────────────────────────
        const showBlinker = !megaTowerLite || megaTowerNoBloom;
        if (showBlinker) {
            const blinkerSize = megaTowerNoBloom ? 12 : 15;
            const blinkerGeom = new THREE.SphereGeometry(blinkerSize, 16, 16);
            const blinkerColor = megaTowerNoBloom ? 0xcc0000 : 0xff0000;
            const blinkerMat = this.createBasicMaterial({ color: blinkerColor });
            const blinker = new THREE.Mesh(blinkerGeom, blinkerMat);
            blinker.position.set(0, height + mastHeight + 12, 0); // At the mast peak

            // Red glow - lightweight mesh instead of PointLight
            const glowSize = megaTowerNoBloom ? 24 : 36;
            const glowGeom = new THREE.SphereGeometry(glowSize, 12, 12);
            const glowOpacity = megaTowerNoBloom ? 0.35 : 0.6;
            const glowColor = new THREE.Color(blinkerColor).multiplyScalar(0.9);
            const glowMat = this.createBasicMaterial({
                color: glowColor,
                transparent: true,
                opacity: glowOpacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            if (this.isWebGPU && megaTowerNoBloom && glowMat?.isNodeMaterial) {
                glowMat.emissiveNode = vec3(0.0, 0.0, 0.0);
            }
            const blinkerGlow = new THREE.Mesh(glowGeom, glowMat);
            blinkerGlow.position.set(0, height + mastHeight + 20, 0);

            // Animation data for updateBlinkingLights()
            blinker.userData.blinkPhase = 0;
            blinkerGlow.userData.blinkPhase = 0;
            const towerBlinkProfile = this.createBlinkProfile('double', {
                period: 2.4,
                offset: 0,
                pulseOn: 0.14,
                pulseGap: 0.16,
                pulseOn2: 0.14,
                ramp: 0.05,
            });
            Object.assign(blinker.userData, towerBlinkProfile);
            Object.assign(blinkerGlow.userData, towerBlinkProfile);

            building.add(blinker);
            building.add(blinkerGlow);
            this.patchMrtMaterialsForObject(blinker);
            this.patchMrtMaterialsForObject(blinkerGlow);

            // Register for animation
            this.streetLights.push(blinker);
            this.streetLights.push(blinkerGlow);
        }

        this.freezeStaticObject(building, true);
        if (towerBillboard) {
            towerBillboard.matrixAutoUpdate = true;
            towerBillboard.updateMatrix();
        }
        console.log('[NeonDistrict] Mega Tower created at horizon');
    }

    /**
     * Create a building by cloning from the pool
     */
    createBuildingFromPool(x, z) {
        // Ensure pool exists
        if (this.buildingPool.length === 0) {
            this.generateBuildingPool();
        }

        // Pick random prototype
        const prototype = this.buildingPool[Math.floor(Math.random() * this.buildingPool.length)];
        const clone = prototype.clone();

        // Position
        clone.position.set(x, 0, z);

        // Random Y rotation (90 degree increments) for variety
        clone.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);

        const cloneWidth = clone.userData.width;
        const cloneDepth = clone.userData.depth;
        if (cloneWidth && cloneDepth) {
            clone.traverse((child) => {
                if (child.userData?.isVHS || child.userData?.isAd) {
                    this.placeBillboardFacingStreet(clone, child, cloneWidth, cloneDepth, child.position.y);
                }
            });
        }

        // Register animated components from the clone
        clone.traverse((child) => {
            if (child.userData.isAd) {
                this.neonSigns.push(child);
            }
            if (child.userData.isVHS) {
                this.vhsBillboards.push(child);
            }
            if (child.userData.blinkPhase !== undefined) {
                if (child.userData.blinkPeriod) {
                    child.userData.blinkOffset = Math.random() * child.userData.blinkPeriod;
                } else {
                    child.userData.blinkPhase = Math.random() * Math.PI * 2;
                }
                this.streetLights.push(child);
            }
        });

        // Add to scene and tracking array
        this.scene.add(clone);
        this.buildings.push(clone);
        this.patchMrtMaterialsForObject(clone);
        this.freezeStaticObject(clone, true);

        return clone;
    }

    /**
     * Attach ads to building faces like SynthCity does
     */
    attachAdsToBuilding(building, width, height, depth) {
        const isLarge = height > 400;
        const buildingLod = building.userData?.lodTier ?? 0;

        // Only ONE billboard per building to avoid z-fighting
        // 50% chance of VHS billboard for large buildings, otherwise regular ad
        // OPTIMIZATION: If building is far away (z < -600), force simple ad (no VHS shader)
        const isDistant = buildingLod >= 1 || building.position.z < -600;

        if (isLarge && Math.random() < 0.5 && !isDistant) {
            this.createVHSBillboardOnBuilding(building, width, height, depth);
            return;
        }

        const atlasInfo = this.assets?.getAdAtlasInfo(isLarge ? 'large' : 'small');
        if (isDistant && atlasInfo) {
            const adWidth = isLarge ? 60 + Math.random() * 40 : 30 + Math.random() * 25;
            const adHeight = isLarge ? 40 + Math.random() * 30 : 20 + Math.random() * 15;
            const adY = 50 + Math.random() * Math.min(height * 0.6, 300);
            this.queueAdInstance(building, width, depth, adWidth, adHeight, adY, isLarge);
            return;
        }

        const material = isLarge
            ? this.assets.getRandomLargeAdMaterial()
            : this.assets.getRandomAdMaterial();

        if (!material) return;

        // Random ad size based on building
        const adWidth = isLarge ? 60 + Math.random() * 40 : 30 + Math.random() * 25;
        const adHeight = isLarge ? 40 + Math.random() * 30 : 20 + Math.random() * 15;
        const geometry = new THREE.PlaneGeometry(adWidth, adHeight);

        // Create ad mesh
        const ad = new THREE.Mesh(geometry, material);

        // Position on building face (ALWAYS street-facing for visibility per user request)
        const adY = 50 + Math.random() * Math.min(height * 0.6, 300);
        this.placeBillboardFacingStreet(building, ad, width, depth, adY);

        // Store for animation (material switching like SynthCity)
        ad.userData.isAd = true;
        ad.userData.switchInterval = 200 + Math.random() * 800;
        ad.userData.switchCounter = Math.random() * ad.userData.switchInterval;
        ad.userData.switches = !this.featureFlags?.noAdSwitch && Math.random() < 0.7; // 70% of ads switch
        ad.userData.isLarge = isLarge;
        ad.userData.lodTier = buildingLod;

        building.add(ad);
        this.neonSigns.push(ad); // Add to animation list
    }

    /**
     * Create a VHS-style billboard with scanlines, chromatic aberration, and glitch effects
     */
    createVHSBillboardOnBuilding(building, buildingWidth, buildingHeight, buildingDepth) {
        // Get two random ad textures for cycling
        // Updated to use all 18 available large ads
        const adIndex1 = Math.floor(Math.random() * 18) + 1;
        let adIndex2 = Math.floor(Math.random() * 18) + 1;
        while (adIndex2 === adIndex1) adIndex2 = Math.floor(Math.random() * 18) + 1;

        const padNum = (n) => n.toString().padStart(2, '0');
        const tex1 = this.assets?.getTexture(`ads_large_${padNum(adIndex1)}`);
        const tex2 = this.assets?.getTexture(`ads_large_${padNum(adIndex2)}`);

        if (!tex1 || !tex2) return;

        // Billboard dimensions - LARGER for visibility
        const adWidth = 100 + Math.random() * 60;
        const adHeight = 70 + Math.random() * 45;
        const geometry = new THREE.PlaneGeometry(adWidth, adHeight);

        let vhsMaterial;
        let vhsUniforms = null;
        if (this.isWebGPU) {
            const vhs = createVhsBillboardNodeMaterial({
                texture1: tex1,
                texture2: tex2,
                randomOffset: Math.random() * 100.0,
            });
            vhsMaterial = vhs.material;
            vhsUniforms = vhs.uniforms;
        } else {
            // VHS Billboard Shader
            vhsMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uRandomOffset: { value: Math.random() * 100.0 }, // Random start time for each ad
                    uTexture1: { value: tex1 },
                    uTexture2: { value: tex2 },
                    uMixFactor: { value: 0.0 },
                    uGlitchIntensity: { value: 0.0 },
                    uScanlineIntensity: { value: 0.6 },
                    uChromaticAberration: { value: 0.008 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform float uRandomOffset;
                    uniform sampler2D uTexture1;
                    uniform sampler2D uTexture2;
                    uniform float uMixFactor;
                    uniform float uGlitchIntensity;
                    uniform float uScanlineIntensity;
                    uniform float uChromaticAberration;
                    varying vec2 vUv;

                    // Pseudo-random function
                    float rand(vec2 co) {
                        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                    }

                    void main() {
                        // Fix mirroring when viewing from back side
                        vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
                        float time = uTime + uRandomOffset; // Use randomized time

                        // === TRACKING GLITCH - Horizontal offset ===
                        float glitchLine = step(0.99, rand(vec2(floor(time * 3.0), floor(uv.y * 20.0))));
                        float glitchOffset = glitchLine * uGlitchIntensity * (rand(vec2(time, uv.y)) - 0.5) * 0.1;
                        uv.x += glitchOffset;

                        // Occasional full-screen horizontal shift during transitions
                        float transitionGlitch = uGlitchIntensity * sin(time * 50.0) * 0.02;
                        uv.x += transitionGlitch;

                        // === CHROMATIC ABERRATION ===
                        float ca = uChromaticAberration * (1.0 + uGlitchIntensity * 3.0);
                        
                        // Sample with RGB separation
                        vec4 tex1Sample, tex2Sample;
                        tex1Sample.r = texture2D(uTexture1, uv + vec2(ca, 0.0)).a > 0.0 ? texture2D(uTexture1, uv + vec2(ca, 0.0)).r : texture2D(uTexture1, uv).r;
                        tex1Sample.g = texture2D(uTexture1, uv).g;
                        tex1Sample.b = texture2D(uTexture1, uv - vec2(ca, 0.0)).b;
                        tex1Sample.a = 1.0;

                        tex2Sample.r = texture2D(uTexture2, uv + vec2(ca, 0.0)).r;
                        tex2Sample.g = texture2D(uTexture2, uv).g;
                        tex2Sample.b = texture2D(uTexture2, uv - vec2(ca, 0.0)).b;
                        tex2Sample.a = 1.0;

                        // Mix between the two textures
                        vec4 texColor = mix(tex1Sample, tex2Sample, uMixFactor);

                        // === VHS SCANLINES - more visible ===
                        float scanline = sin(vUv.y * 300.0 + time * 2.0) * 0.5 + 0.5;
                        scanline = pow(scanline, 1.6);
                        scanline = 1.0 - scanline * uScanlineIntensity;
                        texColor.rgb *= scanline;

                        // === SCROLLING INTERFERENCE LINE - visible but not overpowering ===
                        float interferenceY = fract(time * 0.12);
                        float interference = smoothstep(interferenceY - 0.04, interferenceY, vUv.y) 
                                           * smoothstep(interferenceY + 0.04, interferenceY, vUv.y);
                        texColor.rgb += interference * 0.15;

                        // === VISIBLE NOISE ===
                        float noise = rand(vUv + time) * 0.05;
                        texColor.rgb += noise;

                        // === BRIGHTNESS FLICKER - more noticeable ===
                        float flicker = 0.92 + sin(time * 8.0) * 0.05 + sin(time * 23.0) * 0.03;
                        texColor.rgb *= flicker;

                        // === EDGE VIGNETTE ===
                        float vignette = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
                        vignette *= smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);

                        // Reduce brightness to show content clearly
                        texColor.rgb *= 0.5;

                        gl_FragColor = vec4(texColor.rgb, vignette * 0.95);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending, // Normal blending to show texture content
            });
        }

        const billboard = new THREE.Mesh(geometry, vhsMaterial);
        if (vhsUniforms) {
            billboard.userData.vhsUniforms = vhsUniforms;
        }

        // Position on the street-facing side (like createAdOnBuilding)
        // Minimum Y = 150 to avoid overlapping storefronts (height 36)
        const adY = 150 + Math.random() * Math.min(buildingHeight * 0.4, 200);
        this.placeBillboardFacingStreet(building, billboard, buildingWidth, buildingDepth, adY);

        // Store cycling data
        billboard.userData.isVHS = true;
        billboard.userData.cycleTime = 8 + Math.random() * 6; // 8-14 seconds per ad
        billboard.userData.cycleProgress = Math.random() * billboard.userData.cycleTime;
        billboard.userData.currentTexture = 0;
        billboard.userData.transitionDuration = 0.5;
        billboard.userData.inTransition = false;
        billboard.userData.lodTier = building.userData?.lodTier ?? 0;

        building.add(billboard);
        this.vhsBillboards.push(billboard);

        return billboard;
    }

    placeBillboardFacingStreet(building, mesh, width, depth, height, options = {}) {
        const offsetScale = options.offsetScale ?? 0.5;
        const offset = options.offset ?? 1;

        const worldPos = this._billboardWorldPos || (this._billboardWorldPos = new THREE.Vector3());
        const worldQuat = this._billboardWorldQuat || (this._billboardWorldQuat = new THREE.Quaternion());
        const worldQuatInv = this._billboardWorldQuatInv || (this._billboardWorldQuatInv = new THREE.Quaternion());
        const toCenterWorld = this._billboardToCenterWorld || (this._billboardToCenterWorld = new THREE.Vector3());
        const toCenterLocal = this._billboardToCenterLocal || (this._billboardToCenterLocal = new THREE.Vector3());

        building.getWorldPosition(worldPos);
        building.getWorldQuaternion(worldQuat);
        worldQuatInv.copy(worldQuat).invert();

        toCenterWorld.set(-worldPos.x, 0, 0);
        if (toCenterWorld.lengthSq() < 0.0001) {
            toCenterWorld.set(1, 0, 0);
        } else {
            toCenterWorld.normalize();
        }

        toCenterLocal.copy(toCenterWorld).applyQuaternion(worldQuatInv);
        const useX = Math.abs(toCenterLocal.x) >= Math.abs(toCenterLocal.z);
        const sign = useX
            ? (toCenterLocal.x >= 0 ? 1 : -1)
            : (toCenterLocal.z >= 0 ? 1 : -1);

        if (useX) {
            mesh.position.set(
                sign * (width / 2 + offset),
                height,
                (Math.random() - 0.5) * depth * offsetScale,
            );
            // Front face (+Z) must point toward the street (the +sign·X side), so the
            // ad text reads correctly instead of showing its mirrored back face.
            // (Was inverted; the non-useX branch below was already correct.)
            mesh.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
            mesh.position.set(
                (Math.random() - 0.5) * width * offsetScale,
                height,
                sign * (depth / 2 + offset),
            );
            mesh.rotation.y = sign > 0 ? 0 : Math.PI;
        }
    }

    createStorefront(building, width, depth) {
        // Try to get a unique storefront material
        const material = this.assets?.getRandomStorefrontMaterial();

        // If no storefront available, skip entirely (no glow on this building)
        if (!material) {
            return;
        }

        const height = 36; // Ground floor height
        const geometry = new THREE.BoxGeometry(width + 2, height, depth + 2);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = height / 2;
        mesh.castShadow = true; // Storefronts cast shadows
        mesh.receiveShadow = true;
        building.add(mesh);

        // AAA Phase 5c: glowing shop signage, lit doorway and a hanging blade sign
        this.enrichStorefront(building, width, depth);

        // Add ground-level grime/debris for natural transition
        this.addGroundLevelDetails(building, width, depth);
    }

    /**
     * AAA Phase 5c — enrich a storefront with street-facing emissive signage: a
     * glowing sign band over the shopfront, a warm lit doorway, and (High+) a tall
     * hanging blade sign. All emissive (so they bloom + feed reflections/god-rays)
     * and additive. Skipped on Low/Minimal to keep draw calls down.
     */
    enrichStorefront(building, width, depth) {
        if (this.featureFlags?.noStorefrontSigns) return;
        const q = this.currentQualityName;
        if (q === 'Low' || q === 'Minimal') return;

        const palette = [0xff2bb0, 0x35e8ff, 0xff8a2b, 0xb14bff, 0x36ff8a];
        const pick = () => palette[Math.floor(Math.random() * palette.length)];
        const faceW = Math.max(width, depth);

        const makeQuad = (w, h, color, opacity) => {
            const mat = this.createBasicMaterial({
                color,
                transparent: true,
                opacity,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        };

        // 1) Glowing sign band just above the shopfront.
        const band = makeQuad(Math.min(faceW * 0.8, 64), 6, pick(), 0.95);
        this.placeBillboardFacingStreet(building, band, width, depth, 34, { offset: 1.2, offsetScale: 0.0 });
        band.renderOrder = 3;
        building.add(band);

        // 2) Warm lit doorway near the base.
        const door = makeQuad(8, 16, 0xffcf8a, 0.8);
        this.placeBillboardFacingStreet(building, door, width, depth, 9, { offset: 1.1, offsetScale: 0.4 });
        door.renderOrder = 3;
        building.add(door);

        // 3) Hanging blade sign (High+ only) — a tall vertical neon strip.
        if (q === 'High' || q === 'Ultra' || q === 'Extreme') {
            const blade = makeQuad(5, 28, pick(), 0.9);
            this.placeBillboardFacingStreet(building, blade, width, depth, 56, { offset: 3.5, offsetScale: 0.35 });
            blade.renderOrder = 3;
            building.add(blade);
        }
    }

    /**
     * Add ground-level details for more natural building-ground transition
     */
    addGroundLevelDetails(building, width, depth) {
        // Dark grime strip at base of building
        const grimeHeight = 3;
        const grimeGeometry = new THREE.BoxGeometry(width + 4, grimeHeight, depth + 4);
        const grimeMaterial = this.createPhongMaterial({
            color: 0x111111,
            emissive: 0x000000,
        });
        const grime = new THREE.Mesh(grimeGeometry, grimeMaterial);
        grime.position.y = grimeHeight / 2;
        grime.castShadow = true; // Ground details cast shadows
        grime.receiveShadow = true;
        building.add(grime);

        // Random debris/clutter around base
        const debrisCount = Math.floor(2 + Math.random() * 4);
        for (let i = 0; i < debrisCount; i++) {
            const size = 1 + Math.random() * 3;
            const debrisGeom = new THREE.BoxGeometry(size, size * 0.5, size);
            const debrisMat = this.createPhongMaterial({
                color: 0x222222 + Math.floor(Math.random() * 0x111111),
            });
            const debris = new THREE.Mesh(debrisGeom, debrisMat);

            // Position around building perimeter
            const side = Math.floor(Math.random() * 4);
            const offset = (Math.random() - 0.5) * (side < 2 ? width : depth) * 0.8;

            if (side === 0) debris.position.set(offset, size * 0.25, depth / 2 + 3 + Math.random() * 2);
            else if (side === 1) debris.position.set(offset, size * 0.25, -depth / 2 - 3 - Math.random() * 2);
            else if (side === 2) debris.position.set(width / 2 + 3 + Math.random() * 2, size * 0.25, offset);
            else debris.position.set(-width / 2 - 3 - Math.random() * 2, size * 0.25, offset);

            debris.rotation.y = Math.random() * Math.PI;
            debris.castShadow = true;
            debris.receiveShadow = true;
            building.add(debris);
        }

    }

    createComplexTower(building, width, height, depth) {
        // "SynthCity" Style: Stacked, offset blocks logic
        const levels = Math.floor(3 + Math.random() * 3); // 3 to 5 levels
        let currentY = 0;

        // Use ONE material for the whole building (like SynthCity)
        const buildingSeed = Math.random();
        const buildingMat = this.getBuildingMaterial(buildingSeed);

        const geometries = [];

        // Base block
        const baseH = height * (0.3 + Math.random() * 0.2);
        const baseGeom = new THREE.BoxGeometry(width, baseH, depth);
        // Translate logic for merged geometry:
        // Position was: y = baseH / 2
        baseGeom.translate(0, baseH / 2, 0);
        geometries.push(baseGeom);

        currentY += baseH;

        // Stacked blocks
        let currentW = width;
        let currentD = depth;

        for (let i = 1; i < levels; i++) {
            // Reduction
            currentW *= 0.6 + Math.random() * 0.4; // Shrink 60-100%
            currentD *= 0.6 + Math.random() * 0.4;

            // Height rest
            const remainingH = height - currentY;
            if (remainingH < 10) break;

            const blockH = (i === levels - 1) ? remainingH : (remainingH * (0.4 + Math.random() * 0.3));

            const geom = new THREE.BoxGeometry(currentW, blockH, currentD);

            // Offset (Cantilever effect)
            const offsetX = (Math.random() - 0.5) * (width - currentW) * 0.8;
            const offsetZ = (Math.random() - 0.5) * (depth - currentD) * 0.8;

            // Translate: position + offset
            geom.translate(offsetX, currentY + blockH / 2, offsetZ);
            geometries.push(geom);

            currentY += blockH;
        }

        // OPTIMIZED: Merge all blocks into one mesh
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const mesh = new THREE.Mesh(merged, buildingMat);
            mesh.castShadow = true; // Buildings cast shadows (critical for road shadows)
            mesh.receiveShadow = true;
            building.add(mesh);
        }

        this.createRooftopDetails(building, currentW, height, currentD);
    }

    createStandardTower(building, width, height, depth) {
        // Standard rectangular tower using SynthCity textures
        // Each building gets ONE material for consistency
        const buildingSeed = Math.random();
        const bodyMaterial = height > 400
            ? this.getBigBuildingMaterial(buildingSeed, Math.random() > 0.8)
            : this.getBuildingMaterial(buildingSeed);

        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height / 2;
        body.userData.material = bodyMaterial;
        building.add(body);

        // Rooftop details
        this.createRooftopDetails(building, width, height, depth);

        // Random chance for step-back design
        if (height > 900 && Math.random() > 0.6) {
            const stepHeight = height * 0.25;
            const stepGeometry = new THREE.BoxGeometry(width * 0.6, stepHeight, depth * 0.6);
            const step = new THREE.Mesh(stepGeometry, bodyMaterial);
            step.position.y = height + stepHeight / 2;
            building.add(step);
        }
    }

    createSteppedBuilding(building, width, height, depth) {
        // Building with stepped setbacks (pyramid-like)
        const levels = 3;
        const levelHeight = height / levels;

        // One material for the whole building
        const buildingMat = this.getBuildingMaterial(Math.random());
        const geometries = [];

        for (let i = 0; i < levels; i++) {
            const scale = 1 - (i * 0.2);
            const h = levelHeight;
            const geometry = new THREE.BoxGeometry(width * scale, h, depth * scale);
            // Translate: y = (i * h) + h / 2
            geometry.translate(0, (i * h) + h / 2, 0);
            geometries.push(geometry);
        }

        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const mesh = new THREE.Mesh(merged, buildingMat);
            building.add(mesh);
        }

        this.createRooftopDetails(building, width * 0.6, height, depth * 0.6);
    }

    createSpireBuilding(building, width, height, depth) {
        // Building with clean rooftop (no poles)
        const bodyMaterial = this.getBuildingMaterial(Math.random());
        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height / 2;
        building.add(body);

        this.createRooftopDetails(building, width, height, depth);
    }

    createWideBaseBuilding(building, width, height, depth) {
        // Building with wide base that narrows - ONE material for whole building
        const buildingMat = this.getBuildingMaterial(Math.random());
        const geometries = [];

        const baseGeometry = new THREE.BoxGeometry(width * 1.3, height * 0.3, depth * 1.3);
        baseGeometry.translate(0, height * 0.15, 0);
        geometries.push(baseGeometry);

        // Upper tower
        const towerGeometry = new THREE.BoxGeometry(width * 0.7, height * 0.7, depth * 0.7);
        // Translate: y = height * 0.3 + height * 0.35
        towerGeometry.translate(0, height * 0.65, 0);
        geometries.push(towerGeometry);

        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries);
            const mesh = new THREE.Mesh(merged, buildingMat);
            building.add(mesh);
        }

        this.createRooftopDetails(building, width * 0.7, height, depth * 0.7);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Get building material (SynthCity-style noise-based selection)
    // Uses texture-based materials for proper UV-mapped building geometry
    // ─────────────────────────────────────────────────────────────────────────
    getBuildingMaterial(seed = Math.random()) {
        // Use SynthCity texture-based materials for main buildings
        // These work correctly with UV-mapped BoxGeometry
        if (this.assets?.loaded) {
            return this.assets.getBuildingMaterial(seed);
        }

        // Fallback to procedural shader if assets not loaded
        if (this.buildingMaterial) {
            if (this.isWebGPU && this.buildingUniforms?.uSeed) {
                this.buildingUniforms.uSeed.value = seed * 1000;
                return this.buildingMaterial;
            }

            const fallback = this.buildingMaterial.clone();
            if (fallback.uniforms) {
                fallback.uniforms = UniformsUtils.clone(this.buildingMaterial.uniforms);
                fallback.uniforms.uSeed.value = seed * 1000;
            }
            return fallback;
        }

        // Last resort: simple dark material
        return this.createPhongMaterial({
            color: 0x1a1a2e,
            shininess: 0,
        });
    }

    /**
     * Get "big building" material (for tall towers)
     * Uses special texture variants for tall structures
     */
    getBigBuildingMaterial(seed = Math.random(), rare = false) {
        if (this.assets?.loaded) {
            return this.assets.getBigBuildingMaterial(seed, rare);
        }
        return this.getBuildingMaterial(seed);
    }

    getOuterBuildingMaterial(matId) {
        if (!this.assets?.loaded) return null;
        const cacheKey = `${matId}:${this.isWebGPU ? 'gpu' : 'gl'}:lod`;
        if (this.outerBuildingBasicMaterials.has(cacheKey)) {
            return this.outerBuildingBasicMaterials.get(cacheKey);
        }

        const baseMat = this.assets.getMaterial(matId);
        if (!baseMat) return null;

        // Clone the base material but simplify it for performance
        // Keep colors similar to main buildings (not too dim)
        if (!this.isWebGPU) {
            const clone = baseMat.clone();

            // PERFORMANCE: Force lower mip levels on textures
            // This uses less detailed versions of textures for distant buildings
            if (clone.map) {
                clone.map = clone.map.clone();
                clone.map.minFilter = THREE.LinearMipmapNearestFilter;
            }
            if (clone.emissiveMap) {
                clone.emissiveMap = clone.emissiveMap.clone();
                clone.emissiveMap.minFilter = THREE.LinearMipmapNearestFilter;
            }

            // Keep colors at full intensity for visual similarity
            // No color/emissive scaling needed since we want same look

            // Darken base color to match high-quality buildings
            if (clone.color?.isColor) {
                clone.color.multiplyScalar(0.1); // Very dark, almost black
            }
            // Reduce emissive for more subtle window lighting
            if (clone.emissive?.isColor) {
                clone.emissive.multiplyScalar(0.4);
            }
            if (Number.isFinite(clone.emissiveIntensity)) {
                clone.emissiveIntensity *= 0.4;
            }

            // Disable expensive specular calculations
            if (clone.specular?.isColor) {
                clone.specular.setHex(0x000000);
            }
            if (Number.isFinite(clone.shininess)) {
                clone.shininess = 0;
            }
            // Disable bump mapping for performance
            clone.bumpMap = null;
            clone.bumpScale = 0;
            this.outerBuildingBasicMaterials.set(cacheKey, clone);
            return clone;
        }

        // WebGPU path: Use MeshBasicNodeMaterial for faster rendering
        // Keep full intensity to match main buildings visually
        const map = baseMat.map || null;
        const emissiveMap = baseMat.emissiveMap || null;
        if (!map) return baseMat;

        const material = new THREE.MeshBasicNodeMaterial();
        const baseTex = uniformTexture(map).sample(uv()).rgb;
        // Darken base color - very dark, almost black (0.1 multiplier)
        let colorNode = baseTex.mul(float(0.1));
        let emissiveNode = vec3(0.0, 0.0, 0.0);
        if (emissiveMap) {
            const emissiveTex = uniformTexture(emissiveMap).sample(uv()).rgb;
            // Harmonize the canyon-wall window strips: the baked emissive map has
            // fully-saturated random hues (garish greens/cyans). Desaturate ~40%
            // toward luma, bias very slightly cool, and dim so they sit in the
            // purple palette instead of fighting it.
            const luma = emissiveTex.x.mul(0.3).add(emissiveTex.y.mul(0.59)).add(emissiveTex.z.mul(0.11));
            const harmonized = mix(emissiveTex, vec3(luma, luma, luma), float(0.4))
                .mul(vec3(0.95, 0.92, 1.08));
            const outerEmissive = harmonized.mul(float(0.28));
            colorNode = colorNode.add(outerEmissive);
            emissiveNode = outerEmissive;
        }
        material.colorNode = colorNode;
        material.emissiveNode = emissiveNode;
        material.transparent = false;

        this.outerBuildingBasicMaterials.set(cacheKey, material);
        return material;
    }

    // No longer the primary method - windows are now textured from SynthCity
    createWindowStrips() {
        // Removed - using texture-based windows now
    }

    getRandomWindowColor() {
        // WARM window lights like the reference - yellows, oranges, warm whites
        const colors = [
            0xffdd88, // Warm golden
            0xffcc66, // Amber yellow
            0xffaa44, // Orange
            0xffeeaa, // Warm white
            0xff9955, // Deep amber
            0xffeedd, // Cream
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    getRenderPixelRatio() {
        const baseRatio = this.getEffectivePixelRatio(this.maxPixelRatio);
        const scaledRatio = baseRatio * this.dynamicResolutionScale;
        return Math.max(0.25, Math.min(this.maxPixelRatio, scaledRatio));
    }

    getPostProcessingScale() {
        return this.qualityPreset?.enablePostProcessing ? this.postProcessingScale : 1.0;
    }

    applyRenderScale(force = false) {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRenderPixelRatio();
        const postScale = this.getPostProcessingScale();

        const metrics = this.renderMetrics;
        if (
            !force
            && metrics
            && metrics.width === width
            && metrics.height === height
            && metrics.pixelRatio === pixelRatio
            && metrics.postScale === postScale
        ) {
            return;
        }

        this.renderMetrics = {
            width, height, pixelRatio, postScale,
        };

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height);

        if (this.post) {
            const targetWidth = Math.max(1, Math.floor(width * pixelRatio * postScale));
            const targetHeight = Math.max(1, Math.floor(height * pixelRatio * postScale));
            this.post.setSize(targetWidth, targetHeight);
        }

        if (this.composer) {
            const targetWidth = Math.max(1, Math.floor(width * pixelRatio * postScale));
            const targetHeight = Math.max(1, Math.floor(height * pixelRatio * postScale));
            this.composer.setSize(targetWidth, targetHeight);

            if (this.bloomPass) {
                this.bloomPass.resolution.set(targetWidth, targetHeight);
            }
        }

        if (this.starUniforms?.uPixelRatio) {
            this.starUniforms.uPixelRatio.value = pixelRatio;
        } else if (this.starfield?.material?.uniforms?.uPixelRatio) {
            this.starfield.material.uniforms.uPixelRatio.value = pixelRatio;
        }
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

        const fps = this.dynamicResolutionFrames / this.dynamicResolutionElapsed;
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

    updateBaselineStats(delta) {
        if (!this.baselineCapture) return;

        this.baselineElapsed += delta;
        this.baselineFrames += 1;

        if (this.baselineElapsed < this.baselineSampleInterval) return;

        const fps = this.baselineFrames / this.baselineElapsed;
        const pixelRatio = this.getRenderPixelRatio();
        const backend = this.isWebGPU ? 'WebGPU' : this.isWebGL ? 'WebGL2' : 'unknown';
        const postPath = this.post ? 'webgpu' : this.composer ? 'webgl' : 'none';

        // Enhanced QA metrics
        const sceneObjects = this.scene?.children?.length || 0;
        const buildingCount = this.buildings?.length || 0;
        const vehicleCount = this.vehicleData?.length || 0;
        const neonSignCount = this.neonSigns?.length || 0;
        const haloCount = this.neonHalos?.length || 0;

        console.log(
            `[NeonDistrict][QA] preset=${this.currentQualityName} backend=${backend} post=${postPath} `
            + `fps=${fps.toFixed(1)} pixelRatio=${pixelRatio.toFixed(2)} `
            + `objects=${sceneObjects} buildings=${buildingCount} vehicles=${vehicleCount} signs=${neonSignCount} halos=${haloCount}`,
        );

        this.baselineElapsed = 0;
        this.baselineFrames = 0;
    }

    registerBillboard(mesh) {
        if (!mesh) return;
        this.billboards.push(mesh);
    }

    updateBillboards(delta) {
        if (!this.billboards.length || !this.camera) return;

        this.billboardAccumulator += delta;
        if (this.billboardAccumulator < this.billboardUpdateInterval) return;
        this.billboardAccumulator = 0;

        const cameraPos = this.camera?.position || this.cameraBasePosition;
        const lodScale = this.lodScale || 1.0;
        const midDist = this.signLodConfig.midDistance * lodScale;
        const midDistSq = midDist * midDist;

        if (this.camera.position.distanceToSquared(this.billboardLastCamPos) < this.billboardCamPosEpsilon) {
            const dot = Math.abs(this.camera.quaternion.dot(this.billboardLastCamQuat));
            if (1 - dot < this.billboardCamQuatEpsilon) {
                return;
            }
        }

        this.billboardLastCamPos.copy(this.camera.position);
        this.billboardLastCamQuat.copy(this.camera.quaternion);

        for (let i = 0; i < this.billboards.length; i++) {
            const billboard = this.billboards[i];
            if (!billboard.visible) continue;
            const data = billboard.userData || (billboard.userData = {});
            if (!data.worldPos) {
                data.worldPos = new THREE.Vector3();
                data.worldPosCached = false;
            }
            if (!data.worldPosCached) {
                billboard.getWorldPosition(data.worldPos);
                data.worldPosCached = true;
            }
            const dx = data.worldPos.x - cameraPos.x;
            const dz = data.worldPos.z - cameraPos.z;
            if ((dx * dx + dz * dz) > midDistSq) continue;
            billboard.quaternion.copy(this.camera.quaternion);
        }
    }

    updateInstancedBillboardsTime() {
        const time = this.time;
        if (!this.instancedBillboardUniforms?.length) return;
        this.instancedBillboardUniforms.forEach((uniforms) => {
            if (uniforms?.uTime) uniforms.uTime.value = time;
        });
    }

    getVehicleNodeTransforms() {
        if (this.vehicleNodeTransforms) return this.vehicleNodeTransforms;

        const uTime = uniform(0);
        const flight0 = attribute('aFlight0');
        const flight1 = attribute('aFlight1');
        const flight2 = attribute('aFlight2');
        const flight3 = attribute('aFlight3');

        const basePos = vec3(flight0.x, flight0.y, flight0.z);
        const speed = flight0.w;
        const dir = vec2(flight1.x, flight1.y);
        const wobbleX = flight1.z;
        const wobbleOffset = flight1.w;
        const wobbleProfile = flight2.x;
        const bankAmp = flight2.y;
        const wrapRange = flight2.z;
        const multiDir = flight2.w;
        const partOffset = vec3(flight3.x, flight3.y, flight3.z);
        const heading = flight3.w;

        const t = uTime.add(wobbleOffset);

        const wobbleXLow = sin(t.mul(0.5)).mul(wobbleX);
        const wobbleYLow = sin(t).mul(5.0);
        const wobbleXMid = cos(t.mul(0.2)).mul(wobbleX);
        const wobbleYMid = sin(t.mul(0.3)).mul(20.0);
        const wobbleXHigh = cos(t.mul(0.1)).mul(wobbleX);
        const wobbleYHigh = sin(t.mul(0.2)).mul(50.0);

        const midMask = step(0.5, wobbleProfile);
        const highMask = step(1.5, wobbleProfile);
        const wobbleXMidHigh = mix(wobbleXMid, wobbleXHigh, highMask);
        const wobbleYMidHigh = mix(wobbleYMid, wobbleYHigh, highMask);
        const wobbleXFinal = mix(wobbleXLow, wobbleXMidHigh, midMask);
        const wobbleYFinal = mix(wobbleYLow, wobbleYMidHigh, midMask);

        const travel = vec2(dir.x, dir.y).mul(speed.mul(uTime));
        const posX = basePos.x.add(travel.x).add(wobbleXFinal);
        const posY = basePos.y.add(wobbleYFinal);
        const posZ = basePos.z.add(travel.y);

        const span = wrapRange.mul(2.0);
        const posZWrapped = mod(posZ.add(wrapRange), span).sub(wrapRange);
        const posXWrapped = mod(posX.add(wrapRange), span).sub(wrapRange);
        const posXFinal = mix(posX, posXWrapped, multiDir);

        const bank = bankAmp.mul(cos(uTime.mul(0.2)).negate());
        const cY = cos(heading);
        const sY = sin(heading);
        const cZ = cos(bank);
        const sZ = sin(bank);

        const localPos = positionLocal.add(partOffset);
        const rotZPos = vec3(
            localPos.x.mul(cZ).sub(localPos.y.mul(sZ)),
            localPos.x.mul(sZ).add(localPos.y.mul(cZ)),
            localPos.z,
        );
        const rotYPos = vec3(
            rotZPos.x.mul(cY).add(rotZPos.z.mul(sY)),
            rotZPos.y,
            rotZPos.z.mul(cY).sub(rotZPos.x.mul(sY)),
        );
        const positionNode = rotYPos.add(vec3(posXFinal, posY, posZWrapped));

        const rotZNormal = vec3(
            normalLocal.x.mul(cZ).sub(normalLocal.y.mul(sZ)),
            normalLocal.x.mul(sZ).add(normalLocal.y.mul(cZ)),
            normalLocal.z,
        );
        const normalNode = vec3(
            rotZNormal.x.mul(cY).add(rotZNormal.z.mul(sY)),
            rotZNormal.y,
            rotZNormal.z.mul(cY).sub(rotZNormal.x.mul(sY)),
        );

        this.vehicleNodeUniforms = { uTime };
        this.vehicleNodeTransforms = { positionNode, normalNode, uniforms: this.vehicleNodeUniforms };
        return this.vehicleNodeTransforms;
    }

    profileStart() {
        if (typeof performance === 'undefined') return 0;
        if (!this.profileEnabled && !this.debugEnabled) return 0;
        this.profileFrameStart = performance.now();
        this.profileMarks.length = 0;
        return this.profileFrameStart;
    }

    profileStep(label, startTime) {
        if (typeof performance === 'undefined') return startTime;
        if (!this.profileEnabled && !this.debugEnabled) return startTime;
        const now = performance.now();
        this.profileMarks.push({ label, ms: now - startTime });
        return now;
    }

    profileEnd() {
        // Only do periodic logging when profileEnabled is true
        if (!this.profileEnabled || typeof performance === 'undefined') return;
        const end = performance.now();
        const total = end - this.profileFrameStart;
        if (total < this.profileWarnMs) return;

        if (end - this.profileLastLog < this.profileLogInterval) return;
        this.profileLastLog = end;

        const top = [...this.profileMarks]
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 6)
            .map((entry) => `${entry.label}=${entry.ms.toFixed(1)}ms`)
            .join(' ');

        console.warn(`[NeonDistrict][Perf] frame=${total.toFixed(1)}ms ${top}`);
    }

    /**
     * Log QA validation summary (called once after scene is fully loaded)
     */
    logQAValidation() {
        const backend = this.isWebGPU ? 'WebGPU' : this.isWebGL ? 'WebGL2' : 'unknown';
        const postPath = this.post ? 'TSL PostProcessing' : this.composer ? 'EffectComposer' : 'Direct render';
        const wetGround = this.wetGroundUniforms ? 'TSL animated' : 'MeshPhysical + GLSL';
        const halosEnabled = (this.neonHalos?.length || 0) > 0;

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('[NeonDistrict] QA Validation Summary');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`  Renderer Backend: ${backend}`);
        console.log(`  Post-Processing: ${postPath}`);
        console.log(`  Quality Preset: ${this.currentQualityName}`);
        console.log(`  Wet Ground: ${wetGround}`);
        console.log(`  Neon Halos: ${halosEnabled ? 'Enabled' : 'Disabled'}`);
        console.log('───────────────────────────────────────────────────────────────');
        console.log(`  Buildings: ${this.buildings?.length || 0}`);
        console.log(`  Flying Vehicles: ${this.vehicleData?.length || 0}`);
        console.log(`  Neon Signs: ${this.neonSigns?.length || 0}`);
        console.log(`  Halos: ${this.neonHalos?.length || 0}`);
        console.log(`  Rain Particles: ${this.qualityPreset.rainParticles}`);
        console.log(`  Star Count: ${this.qualityPreset.starCount}`);
        console.log('───────────────────────────────────────────────────────────────');
        console.log(`  Bloom: strength=${this.qualityPreset.bloomStrength} radius=${this.qualityPreset.bloomRadius}`);
        console.log(`  Pixel Ratio: ${this.getRenderPixelRatio().toFixed(2)}`);
        console.log(`  Post Scale: ${this.postProcessingScale}`);
        console.log('═══════════════════════════════════════════════════════════════');

        // Validation checks
        const issues = [];
        if (!this.renderer) issues.push('Renderer not initialized');
        if (!this.scene) issues.push('Scene not created');
        if (!this.camera) issues.push('Camera not created');
        if (this.isWebGPU && !this.post) issues.push('WebGPU without TSL post-processing');
        if (!this.isWebGPU && !this.composer && this.qualityPreset.enablePostProcessing) {
            issues.push('WebGL without EffectComposer (post-processing expected)');
        }

        if (issues.length > 0) {
            console.warn('[NeonDistrict][QA] Validation Issues:');
            issues.forEach((issue) => console.warn(`  - ${issue}`));
        } else {
            console.log('[NeonDistrict][QA] All validation checks passed');
        }
    }

    getRooftopBeaconResources() {
        if (!this.rooftopBeaconGeometry) {
            this.rooftopBeaconGeometry = new THREE.SphereGeometry(2.5, 10, 10);
        }
        if (!this.rooftopBeaconMaterial) {
            this.rooftopBeaconMaterial = this.createBasicMaterial({ color: 0xff0000 });
        }
        return {
            geometry: this.rooftopBeaconGeometry,
            material: this.rooftopBeaconMaterial,
        };
    }

    async prewarmScene() {
        if (!this.prewarmEnabled || !this.renderer?.compileAsync) return null;
        if (!this.scene || !this.camera) return null;
        if (this.prewarmPromise) return this.prewarmPromise;

        this.isPrewarming = true;
        this.prewarmPromise = (async () => {
            try {
                console.log('[NeonDistrict] Prewarming pipelines...');
                await this.renderer.compileAsync(this.scene, this.camera);

                // PERF: Aggressive warmup renders to force ALL shader compilation
                // WebGPU defers pipeline creation until first actual use
                if (this.isWebGPU) {
                    const warmupFrames = this.debugEnabled ? 20 : 10;
                    console.log(`[NeonDistrict] Performing warmup renders (${warmupFrames} frames)...`);
                    const originalTime = this.time;

                    for (let i = 0; i < warmupFrames; i++) {
                        // Update time to trigger time-dependent shader paths
                        this.time = i * 0.1;
                        if (this.post) {
                            this.post.updateTime(this.time);
                        }

                        // Update uniforms that affect shader behavior
                        if (this.wetGroundUniforms?.uTime) {
                            this.wetGroundUniforms.uTime.value = this.time;
                        }
                        // Update rain intensity for dynamic ripple strength
                        if (this.wetGroundUniforms?.uRainIntensity) {
                            this.wetGroundUniforms.uRainIntensity.value = this.rainIntensity;
                        }
                        if (this.rainUniforms?.uTime) {
                            this.rainUniforms.uTime.value = this.time;
                        }
                        if (this.starfieldUniforms?.uTime) {
                            this.starfieldUniforms.uTime.value = this.time;
                        }

                        // Render frame
                        if (this.post) {
                            this.post.render();
                        } else {
                            this.renderer.render(this.scene, this.camera);
                        }

                        // Longer delay every 5 frames to let GPU catch up
                        if (i % 5 === 4) {
                            await new Promise((r) => setTimeout(r, this.debugEnabled ? 100 : 40));
                        } else {
                            await new Promise((r) => setTimeout(r, this.debugEnabled ? 20 : 8));
                        }
                    }

                    // Restore original time
                    this.time = originalTime;

                    // Final compileAsync to catch any stragglers
                    await this.renderer.compileAsync(this.scene, this.camera);
                }

                console.log('[NeonDistrict] Prewarm complete');
            } catch (error) {
                console.warn('[NeonDistrict] Prewarm failed:', error);
            } finally {
                this.isPrewarming = false;
            }
        })();

        return this.prewarmPromise;
    }

    getSparkMesh() {
        const pooled = this.sparkPool.pop();
        if (pooled) {
            pooled.visible = true;
            return pooled;
        }

        if (!this.sparkGeometry) {
            this.sparkGeometry = new THREE.SphereGeometry(1, 8, 8);
        }

        const material = this.createBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
        });

        const mesh = new THREE.Mesh(this.sparkGeometry, material);
        this.patchMrtMaterialsForObject(mesh);
        return mesh;
    }

    releaseSparkMesh(mesh) {
        if (!mesh) return;
        mesh.visible = false;
        mesh.userData = {};
        mesh.scale.setScalar(1);
        this.sparkPool.push(mesh);
    }

    getComboFxScale() {
        if (this.featureFlags?.noSparks) {
            return 0;
        }
        switch (this.currentQualityName) {
            case 'Minimal':
                return 0;
            case 'Low':
                return 0.35;
            case 'Medium':
                return 0.6;
            case 'High':
                return 0.8;
            default:
                return 1.0;
        }
    }

    getRooftopMaterials() {
        if (!this.rooftopMaterials) {
            this.rooftopMaterials = {
                ac: this.createStandardMaterial({
                    color: 0x444455,
                    metalness: 0.6,
                    roughness: 0.5,
                }),
                tank: this.createStandardMaterial({
                    color: 0x333333,
                    metalness: 0.3,
                    roughness: 0.8,
                }),
                dish: this.createStandardMaterial({
                    color: 0x555566,
                    metalness: 0.7,
                    roughness: 0.4,
                }),
                pipe: this.createStandardMaterial({
                    color: 0x444444,
                    metalness: 0.6,
                    roughness: 0.5,
                }),
            };
        }
        return this.rooftopMaterials;
    }

    addRooftopBeacons(building, width, roofHeight, depth, options = {}) {
        const {
            chance = 0.75,
            minCount = 1,
            maxCount = 3,
            spread = 0.6,
            yOffset = 2.5,
            heightForBoost = roofHeight,
        } = options;

        if (Math.random() > chance) return;

        const heightBoost = heightForBoost > 900 ? 1 : 0;
        const resolvedMax = Math.max(minCount, maxCount + heightBoost);
        const count = minCount + Math.floor(Math.random() * (resolvedMax - minCount + 1));
        const { geometry, material } = this.getRooftopBeaconResources();

        for (let i = 0; i < count; i++) {
            const beacon = new THREE.Mesh(geometry, material);
            beacon.position.set(
                (Math.random() - 0.5) * width * spread,
                roofHeight + yOffset,
                (Math.random() - 0.5) * depth * spread,
            );
            const pattern = Math.random() < 0.35 ? 'double' : 'single';
            Object.assign(beacon.userData, this.createBlinkProfile(pattern));
            beacon.userData.blinkPhase = Math.random() * Math.PI * 2;
            building.add(beacon);
            this.streetLights.push(beacon);
        }
    }

    addRooftopBeaconsAt(x, z, rotationY, width, roofHeight, depth, options = {}) {
        const {
            chance = 0.75,
            minCount = 1,
            maxCount = 3,
            spread = 0.6,
            yOffset = 2.5,
            heightForBoost = roofHeight,
        } = options;

        if (Math.random() > chance) return;

        const heightBoost = heightForBoost > 900 ? 1 : 0;
        const resolvedMax = Math.max(minCount, maxCount + heightBoost);
        const count = minCount + Math.floor(Math.random() * (resolvedMax - minCount + 1));
        const { geometry, material } = this.getRooftopBeaconResources();
        const basePosition = new THREE.Vector3(x, 0, z);
        const rotationAxis = new THREE.Vector3(0, 1, 0);

        for (let i = 0; i < count; i++) {
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * width * spread,
                roofHeight + yOffset,
                (Math.random() - 0.5) * depth * spread,
            );
            offset.applyAxisAngle(rotationAxis, rotationY);

            const beacon = new THREE.Mesh(geometry, material);
            beacon.position.copy(basePosition).add(offset);
            const pattern = Math.random() < 0.35 ? 'double' : 'single';
            Object.assign(beacon.userData, this.createBlinkProfile(pattern));
            beacon.userData.blinkPhase = Math.random() * Math.PI * 2;
            this.scene.add(beacon);
            this.streetLights.push(beacon);
            this.freeStandingBeacons.push(beacon);
        }
    }

    createBlinkProfile(pattern = 'single', options = {}) {
        const resolvedPattern = pattern === 'double' ? 'double' : 'single';
        const fpmMin = resolvedPattern === 'double' ? 20 : 20;
        const fpmMax = resolvedPattern === 'double' ? 30 : 40;
        const fpm = options.fpm ?? (fpmMin + Math.random() * (fpmMax - fpmMin));
        const period = options.period ?? (60 / fpm);
        const profile = {
            blinkPattern: resolvedPattern,
            blinkPeriod: period,
            blinkOffset: options.offset ?? Math.random() * period,
            blinkRamp: options.ramp ?? 0.04,
        };

        if (resolvedPattern === 'double') {
            profile.blinkPulseOn = options.pulseOn ?? (0.11 + Math.random() * 0.05);
            profile.blinkPulseGap = options.pulseGap ?? (0.12 + Math.random() * 0.08);
            profile.blinkPulseOn2 = options.pulseOn2 ?? (0.11 + Math.random() * 0.05);
        } else {
            profile.blinkOnDuration = options.onDuration ?? (0.14 + Math.random() * 0.08);
        }

        return profile;
    }

    buildFlightCollisionBounds() {
        const bounds = [];
        const range = this.vehicleRange || 2500;
        const zMin = -range - 200;
        const zMax = range + 200;
        const box = this._flightBoundsBox || (this._flightBoundsBox = new THREE.Box3());

        this.buildings.forEach((building) => {
            const width = building.userData?.width;
            const depth = building.userData?.depth;
            const height = building.userData?.height;
            let minX; let maxX; let minZ; let maxZ; let
                maxY;

            if (width && depth && height) {
                const rotSteps = Math.round(building.rotation.y / (Math.PI / 2)) % 4;
                const swapped = rotSteps % 2 !== 0;
                const halfX = (swapped ? depth : width) / 2;
                const halfZ = (swapped ? width : depth) / 2;
                minX = building.position.x - halfX;
                maxX = building.position.x + halfX;
                minZ = building.position.z - halfZ;
                maxZ = building.position.z + halfZ;
                maxY = height;
            } else {
                box.setFromObject(building);
                minX = box.min.x;
                maxX = box.max.x;
                minZ = box.min.z;
                maxZ = box.max.z;
                maxY = box.max.y;
            }

            if (maxZ < zMin || minZ > zMax) return;
            bounds.push({
                minX, maxX, minZ, maxZ, height: maxY,
            });
        });

        this.outerBuildingBounds.forEach((bound) => {
            if (bound.maxZ < zMin || bound.minZ > zMax) return;
            bounds.push(bound);
        });

        this.tier2Bounds.forEach((bound) => {
            if (bound.maxZ < zMin || bound.minZ > zMax) return;
            bounds.push(bound);
        });

        this.flightCollisionBounds = bounds;
    }

    getRequiredFlightHeight(x, wobbleX = 0) {
        const bounds = this.flightCollisionBounds;
        if (!bounds || bounds.length === 0) return 0;

        const range = this.vehicleRange || 2500;
        const zMin = -range;
        const zMax = range;
        const lateralBuffer = 12;
        const verticalBuffer = 40;
        const span = wobbleX + lateralBuffer;
        let required = 0;

        for (let i = 0; i < bounds.length; i++) {
            const bound = bounds[i];
            if (x + span < bound.minX || x - span > bound.maxX) continue;
            if (bound.maxZ < zMin || bound.minZ > zMax) continue;
            required = Math.max(required, bound.height + verticalBuffer);
        }

        return required;
    }

    getClearFlightPosition(xRange, yRange, wobbleX = 0, attempts = 16) {
        for (let i = 0; i < attempts; i++) {
            const x = THREE.MathUtils.lerp(xRange.min, xRange.max, Math.random());
            const minY = Math.max(yRange.min, this.getRequiredFlightHeight(x, wobbleX));
            if (minY > yRange.max) continue;

            const y = THREE.MathUtils.lerp(minY, yRange.max, Math.random());
            return { x, y };
        }

        const fallbackX = THREE.MathUtils.lerp(xRange.min, xRange.max, 0.5);
        const fallbackMinY = Math.min(yRange.max, Math.max(yRange.min, this.getRequiredFlightHeight(fallbackX, wobbleX)));
        return { x: fallbackX, y: fallbackMinY };
    }

    computePulseAlpha(timeInPeriod, start, duration, ramp) {
        if (timeInPeriod < start || timeInPeriod >= start + duration) return 0;
        if (!ramp || ramp <= 0) return 1;
        const local = timeInPeriod - start;
        const fade = Math.min(ramp, duration / 2);
        if (local < fade) return local / fade;
        if (local > duration - fade) return (duration - local) / fade;
        return 1;
    }

    computeBlinkAlpha(light, time) {
        const period = light.userData.blinkPeriod;
        const pattern = light.userData.blinkPattern;
        if (!period || !pattern) {
            const blink = Math.sin(time * 2 + (light.userData.blinkPhase || 0)) > 0.7;
            return blink ? 1 : 0;
        }

        const offset = light.userData.blinkOffset
            ?? ((light.userData.blinkPhase || 0) / (Math.PI * 2)) * period;
        const t = (time + offset) % period;
        const ramp = light.userData.blinkRamp ?? 0;

        if (pattern === 'double') {
            const on1 = light.userData.blinkPulseOn ?? 0.12;
            const gap = light.userData.blinkPulseGap ?? 0.12;
            const on2 = light.userData.blinkPulseOn2 ?? on1;
            const alpha1 = this.computePulseAlpha(t, 0, on1, ramp);
            const alpha2 = this.computePulseAlpha(t, on1 + gap, on2, ramp);
            return Math.max(alpha1, alpha2);
        }

        const onDuration = light.userData.blinkOnDuration ?? 0.18;
        return this.computePulseAlpha(t, 0, onDuration, ramp);
    }

    createRooftopDetails(building, width, height, depth) {
        // Rooftop beacons (no poles)
        this.addRooftopBeacons(building, width, height, depth, {
            chance: 0.85,
            minCount: 1,
            maxCount: 3,
            spread: 0.65,
            yOffset: 3,
        });

        const materials = this.getRooftopMaterials();

        // AC units / mechanical
        const acCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < acCount; i++) {
            const acGeometry = new THREE.BoxGeometry(15 + Math.random() * 10, 10, 15 + Math.random() * 10);
            const ac = new THREE.Mesh(acGeometry, materials.ac);
            ac.position.set(
                (Math.random() - 0.5) * width * 0.7,
                height + 5,
                (Math.random() - 0.5) * depth * 0.7,
            );
            ac.userData.rooftopBatch = 'ac';
            building.add(ac);
        }

        // Water tank (cylindrical)
        if (Math.random() > 0.6) {
            const tankRadius = 8 + Math.random() * 6;
            const tankHeight = 20 + Math.random() * 15;
            const tankGeometry = new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 12);
            const tank = new THREE.Mesh(tankGeometry, materials.tank);
            tank.position.set(
                (Math.random() - 0.5) * width * 0.5,
                height + tankHeight / 2,
                (Math.random() - 0.5) * depth * 0.5,
            );
            tank.userData.rooftopBatch = 'tank';
            building.add(tank);
        }

        // Satellite dish
        if (Math.random() > 0.7) {
            const dishSize = 6 + Math.random() * 4;
            const dishGeometry = new THREE.SphereGeometry(dishSize, 12, 8, 0, Math.PI);
            const dish = new THREE.Mesh(dishGeometry, materials.dish);
            dish.position.set(
                (Math.random() - 0.5) * width * 0.6,
                height + 3,
                (Math.random() - 0.5) * depth * 0.6,
            );
            dish.rotation.x = -Math.PI / 4 + Math.random() * 0.3;
            dish.rotation.y = Math.random() * Math.PI * 2;
            dish.userData.rooftopBatch = 'dish';
            building.add(dish);
        }

        // Pipes running along roof edge
        if (Math.random() > 0.5) {
            const pipeRadius = 1 + Math.random();
            const pipeLength = Math.min(width, depth) * 0.8;
            const pipeGeometry = new THREE.CylinderGeometry(pipeRadius, pipeRadius, pipeLength, 8);
            const pipe = new THREE.Mesh(pipeGeometry, materials.pipe);
            pipe.rotation.z = Math.PI / 2;
            pipe.position.set(
                0,
                height + 2,
                (Math.random() > 0.5 ? 1 : -1) * depth * 0.4,
            );
            pipe.userData.rooftopBatch = 'pipe';
            building.add(pipe);
        }
    }

    batchRooftopProps() {
        if (this.rooftopPropsBatched || this.buildings.length === 0) return;

        const batchGeometries = new Map();
        const meshesToRemove = [];
        const geometriesToDispose = new Set();

        this.buildings.forEach((building) => {
            building.updateMatrixWorld(true);
            building.traverse((child) => {
                const batchKey = child.userData?.rooftopBatch;
                if (!batchKey || !child.geometry) return;

                const geom = child.geometry.clone();
                geom.applyMatrix4(child.matrixWorld);

                if (!batchGeometries.has(batchKey)) {
                    batchGeometries.set(batchKey, []);
                }
                batchGeometries.get(batchKey).push(geom);
                meshesToRemove.push(child);
                geometriesToDispose.add(child.geometry);
            });
        });

        if (batchGeometries.size === 0) return;

        const materials = this.getRooftopMaterials();
        const materialMap = {
            ac: materials.ac,
            tank: materials.tank,
            dish: materials.dish,
            pipe: materials.pipe,
        };

        batchGeometries.forEach((geometries, key) => {
            if (!geometries.length || !materialMap[key]) return;
            const merged = mergeGeometries(geometries);
            if (!merged) return;

            merged.computeBoundingSphere();
            const mesh = new THREE.Mesh(merged, materialMap[key]);
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            this.scene.add(mesh);
            this.rooftopBatchMeshes.push(mesh);
        });

        meshesToRemove.forEach((mesh) => {
            if (mesh.parent) mesh.parent.remove(mesh);
        });

        geometriesToDispose.forEach((geom) => geom.dispose());
        this.rooftopPropsBatched = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Street
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Street Lanterns
    // ─────────────────────────────────────────────────────────────────────────
    createStreetLanterns() {
        // Floating Cyberpunk Lanterns - OPTIMIZED: InstancedMesh
        const lanternGeometry = new THREE.CylinderGeometry(1.5, 1.5, 4, 6);
        const lanternMaterial = this.createStandardMaterial({
            color: 0xff4400,
            emissive: 0xff8800,
            emissiveIntensity: 4.0, // Increased intensity to compensate for lack of PointLight
            roughness: 0.4,
            metalness: 0.8,
        });

        // Store positions for instancing
        const instances = [];

        // Place along the street
        for (let z = -300; z < 200; z += 40) {
            // Left Side
            if (Math.random() > 0.3) {
                instances.push({
                    x: -25,
                    y: 20 + Math.random() * 5,
                    z: z + (Math.random() - 0.5) * 10,
                    floatOffset: Math.random() * 100,
                    floatSpeed: 0.5 + Math.random() * 0.5,
                });
            }

            // Right Side
            if (Math.random() > 0.3) {
                instances.push({
                    x: 25,
                    y: 20 + Math.random() * 5,
                    z: z + (Math.random() - 0.5) * 10,
                    floatOffset: Math.random() * 100,
                    floatSpeed: 0.5 + Math.random() * 0.5,
                });
            }
        }

        if (instances.length === 0) return;

        const mesh = new THREE.InstancedMesh(lanternGeometry, lanternMaterial, instances.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Needed for animation

        const dummy = new THREE.Object3D();
        instances.forEach((data, i) => {
            dummy.position.set(data.x, data.y, data.z);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });

        mesh.userData.instances = instances; // Store data for animation
        this.streetLights.push(mesh); // Add to animation loop
        this.scene.add(mesh);
    }

    createStreet() {
        // Skip ground if noGround flag is set (for performance testing)
        if (this.featureFlags?.noGround) {
            console.log('[NeonDistrict] Ground disabled via noGround flag');
            return;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // AAA PHASE 1: True planar reflections on the wet street (WebGPU only)
        // Reflects the ACTUAL neon/buildings/cars/moon instead of the fake 128px
        // purple cube map. Gated by quality preset + ?ndNoReflections / ?ndReflections.
        // ═══════════════════════════════════════════════════════════════════════
        this.reflectionsEnabled = this.isWebGPU
            && !this.featureFlags?.noReflections
            && (this.featureFlags?.forceReflections || this.qualityPreset?.enableReflections === true);
        this.reflectionResolutionScale = this.qualityPreset?.reflectionResolutionScale ?? 0.5;

        if (this.reflectionsEnabled && !this.groundReflector) {
            // bounces:false -> renders once per frame (FRAME update) and won't recurse
            // into other reflectors. generateMipmaps gives soft roughness reflections.
            this.groundReflector = reflector({
                resolutionScale: this.reflectionResolutionScale,
                bounces: false,
                generateMipmaps: true,
            });
            console.log(`[NeonDistrict] Wet-street planar reflections enabled (scale ${this.reflectionResolutionScale})`);
        }
        const reflectorNode = this.reflectionsEnabled ? this.groundReflector : null;

        // ═══════════════════════════════════════════════════════════════════════
        // HIGH QUALITY WET ASPHALT - Extended Road
        // ═══════════════════════════════════════════════════════════════════════
        const groundGeometry = new THREE.PlaneGeometry(2000, 9000, 1, 1);

        // Need UV2 for AO map
        groundGeometry.setAttribute('uv2', groundGeometry.attributes.uv);

        let wetAsphaltMaterial = null;

        if (this.isWebGPU) {
            // WebGPU: Create placeholder material first, then upgrade with textures
            // PHASE 1: Pass quality for shadow gating
            const wetGround = createWetGroundNodeMaterial({ quality: this.currentQualityName, reflectorNode });
            wetAsphaltMaterial = wetGround.material;
            this.wetGroundUniforms = wetGround.uniforms;

            // ASYNC load PBR textures for WebGPU (same as WebGL for visual parity)
            const textureLoader = new THREE.TextureLoader();
            const texturePath = './textures/neon-district/';

            Promise.all([
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_diff_2k.jpg`, resolve, undefined, () => resolve(null))),
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_nor_gl_2k.jpg`, resolve, undefined, () => resolve(null))),
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_rough_2k.jpg`, resolve, undefined, () => resolve(null))),
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_ao_2k.jpg`, resolve, undefined, () => resolve(null))),
            ]).then(async ([diffuseMap, normalMap, roughnessMap, aoMap]) => {
                if (!this.isActive) return;

                // Configure textures for high quality tiling
                [diffuseMap, normalMap, roughnessMap, aoMap].filter((t) => t).forEach((tex) => {
                    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                    tex.repeat.set(4, 18);
                    tex.anisotropy = 8; // Balanced for perf and less shimmer
                });

                // Recreate material with textures
                // PHASE 1: Pass quality for procedural shadow gating
                const upgradedGround = createWetGroundNodeMaterial({
                    diffuseMap,
                    normalMap,
                    roughnessMap,
                    aoMap,
                    quality: this.currentQualityName, // Phase 1: gate shadows
                    reflectorNode: this.reflectionsEnabled ? this.groundReflector : null,
                });

                // Update the ground mesh material
                if (this.ground && upgradedGround.material) {
                    // PERF: Pause rendering while swapping material to avoid mid-frame compilation
                    this.isPrewarming = true;

                    this.ground.material.dispose();
                    this.ground.material = upgradedGround.material;
                    this.wetGroundUniforms = upgradedGround.uniforms;
                    this.groundMaterial = upgradedGround.material;

                    // IMPORTANT: Update groundUniforms references to new uniforms
                    // Otherwise animation loop updates stale uniforms and ripples don't animate
                    if (this.groundUniforms) {
                        if (this.wetGroundUniforms?.uTime) {
                            this.groundUniforms.uTime = this.wetGroundUniforms.uTime;
                        } else if (!this.groundUniforms.uTime) {
                            this.groundUniforms.uTime = { value: 0 };
                        }
                    }

                    // Apply scene environment for reflections
                    if (this.scene.environment) {
                        this.groundMaterial.envMap = this.scene.environment;
                        this.groundMaterial.envMapIntensity = 0.9;
                    }

                    // PERF: Prewarm the new material before resuming render
                    if (this.renderer?.compileAsync) {
                        try {
                            await this.renderer.compileAsync(this.scene, this.camera);
                            console.log('[NeonDistrict] WebGPU wet ground upgraded and prewarmed');
                        } catch (e) {
                            console.warn('[NeonDistrict] Ground prewarm failed:', e);
                        }
                    }

                    this.isPrewarming = false;
                }
            });
        } else {
            // Create PLACEHOLDER material first (instant display)
            wetAsphaltMaterial = new THREE.MeshPhysicalMaterial({
                color: 0x4a4540, // Warm gray asphalt like reference demo
                roughness: 0.2,
                metalness: 0.0,
                envMapIntensity: 1.2, // Higher for wet reflections
                clearcoat: 0.7, // Wet sheen
                clearcoatRoughness: 0.05,
            });

            // ASYNC load PBR textures in background (non-blocking)
            const textureLoader = new THREE.TextureLoader();
            const texturePath = './textures/neon-district/';

            // Use Promise.all to load all textures in parallel
            const texturePromises = [
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_diff_2k.jpg`, resolve, undefined, () => resolve(null))),
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_nor_gl_2k.jpg`, resolve, undefined, () => resolve(null))),
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_rough_2k.jpg`, resolve, undefined, () => resolve(null))),
                new Promise((resolve) => textureLoader.load(`${texturePath}aerial_asphalt_01_ao_2k.jpg`, resolve, undefined, () => resolve(null))),
            ];

            Promise.all(texturePromises).then(([diffuseMap, normalMap, roughnessMap, aoMap]) => {
                if (!this.isActive) return;

                // Configure loaded textures
                [diffuseMap, normalMap, roughnessMap, aoMap].filter((t) => t).forEach((tex) => {
                    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                    tex.repeat.set(4, 18); // Tiling adjusted for much longer road
                });

                // Apply textures to material (upgrade from placeholder)
                if (diffuseMap) wetAsphaltMaterial.map = diffuseMap;
                if (normalMap) {
                    wetAsphaltMaterial.normalMap = normalMap;
                    wetAsphaltMaterial.normalScale = new THREE.Vector2(1.0, 1.0);
                }
                if (roughnessMap) wetAsphaltMaterial.roughnessMap = roughnessMap;
                if (aoMap) {
                    wetAsphaltMaterial.aoMap = aoMap;
                    wetAsphaltMaterial.aoMapIntensity = 1.0;
                }

                wetAsphaltMaterial.needsUpdate = true;
                console.log('[NeonDistrict] PBR textures loaded and applied');
            });
        }

        // Store reference for later use/updates
        this.groundMaterial = wetAsphaltMaterial;

        // Store uniforms for animation
        this.groundUniforms = {
            uTime: this.wetGroundUniforms?.uTime ?? { value: 0 },
            uCameraPos: { value: new THREE.Vector3() },
            uLightPositions: { value: new Array(8).fill(0).map(() => new THREE.Vector3(0, 1000, 0)) },
            uLightColors: { value: new Array(8).fill(0).map(() => new THREE.Color(0x000000)) },
        };

        // ═══════════════════════════════════════════════════════════════════════
        // SHADER INJECTION - Add puddle/ripple effects via onBeforeCompile (WebGL only)
        // ═══════════════════════════════════════════════════════════════════════
        if (!this.isWebGPU) {
            wetAsphaltMaterial.onBeforeCompile = (shader) => {
                // Add our custom uniforms
                shader.uniforms.uTime = this.groundUniforms.uTime;
                shader.uniforms.uCameraPos = this.groundUniforms.uCameraPos;
                shader.uniforms.uLightPositions = this.groundUniforms.uLightPositions;
                shader.uniforms.uLightColors = this.groundUniforms.uLightColors;

                // ─────────────────────────────────────────────────────────────────
                // VERTEX SHADER - Add varyings for world position
                // ─────────────────────────────────────────────────────────────────
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    `#include <common>
                varying vec3 vWorldPos;
                varying vec2 vUvGround;`,
                );

                shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vUvGround = uv;`,
                );

                // ─────────────────────────────────────────────────────────────────
                // FRAGMENT SHADER - Inject puddle/ripple logic
                // ─────────────────────────────────────────────────────────────────
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `#include <common>
                
                uniform float uTime;
                uniform vec3 uCameraPos;
                uniform vec3 uLightPositions[8];
                uniform vec3 uLightColors[8];
                
                varying vec3 vWorldPos;
                varying vec2 vUvGround;
                
                // ═══════════════════════════════════════════════════════════════
                // FARAZ-STYLE HASH FUNCTIONS
                // ═══════════════════════════════════════════════════════════════
                float hash12(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                    p3 += dot(p3, p3.yzx + 19.19);
                    return fract((p3.x + p3.y) * p3.z);
                }
                
                vec2 hash22(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
                    p3 += dot(p3, p3.yzx + 19.19);
                    return fract((p3.xx + p3.yz) * p3.zy);
                }
                
                // ═══════════════════════════════════════════════════════════════
                // FARAZ-STYLE RIPPLES - Grid-based with 3x3 neighbor sampling
                // ═══════════════════════════════════════════════════════════════
                #define MAX_RADIUS 1
                
                vec3 getRipples(vec2 uv, float time) {
                    // Stronger, multi-scale domain warp to break linear artifacts
                    vec2 warp = vec2(
                        sin(uv.y * 0.31 + time * 0.9),
                        sin(uv.x * 0.27 + time * 0.77)
                    ) * 0.55;
                    warp += vec2(
                        sin(uv.y * 0.11 - time * 0.23),
                        sin(uv.x * 0.09 + time * 0.19)
                    ) * 0.35;
                    warp += (hash22(floor(uv * 0.12)) - 0.5) * 0.8;
                    uv += warp;

                    vec2 p0 = floor(uv);
                    float t = time * 2.1;

                    vec2 circles = vec2(0.0);

                    for (int j = -MAX_RADIUS; j <= MAX_RADIUS; ++j) {
                        for (int i = -MAX_RADIUS; i <= MAX_RADIUS; ++i) {
                            vec2 pi = p0 + vec2(float(i), float(j));
                            vec2 hsh = pi;

                            float rnd = hash12(hsh);
                            // Spawn fewer ripples per cell to avoid grid-like bands
                            float spawn = smoothstep(0.25, 0.9, rnd);
                            if (spawn < 0.2) {
                                continue;
                            }

                            vec2 jitter = (hash22(hsh + 19.19) - 0.5) * 0.6;
                            vec2 p = pi + hash22(hsh) + jitter;

                            float speed = mix(0.7, 1.5, rnd);
                            float phase = hash12(hsh + 11.3);
                            float cellTime = fract(0.22 * t * speed + phase);

                            // Randomized drift to de-align ring centers over time
                            vec2 drift = (hash22(hsh + 7.7) - 0.5) * 0.35 * sin(t * speed + phase * 6.2831);
                            p += drift;

                            // Rotate local space per-cell to break directional alignment
                            float ang = hash12(hsh + 2.7) * 6.2831;
                            mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
                            vec2 v = rot * (p - uv);

                            float radius = (float(MAX_RADIUS) + 1.0 + hash12(hsh + 3.7) * 1.1) * cellTime;
                            float d = length(v) - radius;

                            float h = mix(0.007, 0.02, hash12(hsh + 5.1));
                            float d1 = d - h;
                            float d2 = d + h;

                            float freq = mix(14.0, 32.0, hash12(hsh + 2.2));
                            float p1 = sin(freq * d1) * smoothstep(-0.8, -0.25, d1) * smoothstep(0.0, -0.25, d1);
                            float p2 = sin(freq * d2) * smoothstep(-0.8, -0.25, d2) * smoothstep(0.0, -0.25, d2);

                            float vLen = length(v);
                            if (vLen > 0.001) {
                                float amp = mix(0.18, 0.5, hash12(hsh + 9.7));
                                float life = (1.0 - cellTime) * (1.0 - cellTime);
                                circles += amp * 0.5 * (v / vLen) * ((p2 - p1) / (2.0 * h) * life);
                            }
                        }
                    }

                    circles /= float((MAX_RADIUS * 2 + 1) * (MAX_RADIUS * 2 + 1));
                    float circlesDot = clamp(dot(circles, circles), 0.0, 1.0);
                    return vec3(circles, sqrt(1.0 - circlesDot));
                }
                
                // ═══════════════════════════════════════════════════════════════
                // PUDDLE DETECTION using Smooth FBM (like Faraz's gln_sfbm)
                // ═══════════════════════════════════════════════════════════════
                
                // Smooth value noise with interpolation
                float valueNoise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    
                    // Smooth interpolation
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    
                    // Four corners
                    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
                    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
                    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
                    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
                    
                    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                }
                
                // Multi-octave FBM for organic shapes
                float fbmNoise(vec2 p) {
                    float f = 0.0;
                    float amplitude = 0.5;
                    float frequency = 1.0;
                    
                    for(int i = 0; i < 5; i++) {
                        f += amplitude * valueNoise(p * frequency);
                        amplitude *= 0.5;
                        frequency *= 2.0;
                    }
                    return f;
                }
                
                // Faraz-style puddle detection with distinct hotspots
                float getPuddle(vec2 uv) {
                    // Multiple noise layers for organic shape variation
                    float n1 = fbmNoise((uv + vec2(3.0, 0.0)) * 0.2);
                    float n2 = fbmNoise((uv + vec2(-5.0, 2.0)) * 0.35);
                    float combined = (n1 * 0.7 + n2 * 0.3);
                    
                    // Add distinct puddle hotspots at random locations
                    float hotspots = 0.0;
                    
                    // Puddle hotspot positions (in world space scaled by 0.015)
                    vec2 spots[8];
                    spots[0] = vec2(-1.5, -0.8);
                    spots[1] = vec2(2.0, -2.5);
                    spots[2] = vec2(-0.5, -4.0);
                    spots[3] = vec2(1.8, -5.5);
                    spots[4] = vec2(-2.2, -7.0);
                    spots[5] = vec2(0.8, -8.5);
                    spots[6] = vec2(-1.0, -10.0);
                    spots[7] = vec2(2.5, -12.0);
                    
                    for(int i = 0; i < 8; i++) {
                        float dist = length(uv - spots[i] * 100.0);
                        // Organic-shaped hotspot using noise-modulated radius (double size)
                        float radius = 80.0 + fbmNoise(spots[i] * 50.0) * 50.0;
                        float spot = 1.0 - smoothstep(0.0, radius, dist);
                        hotspots = max(hotspots, spot);
                    }
                    
                    // Combine base wetness with distinct hotspots
                    combined = smoothstep(0.35, 0.65, combined);
                    float result = max(combined * 0.6, hotspots);
                    
                    return result;
                }
                
                // Perturb normal with ripple effect
                vec3 perturbNormal(vec3 inputNormal, vec3 noiseNormal, float strength) {
                    vec3 noiseNormalOrthogonal = noiseNormal - (dot(noiseNormal, inputNormal) * inputNormal);
                    return normalize(inputNormal - noiseNormalOrthogonal * strength);
                }
                `,
                );

                // Inject puddle/roughness modifications BEFORE lighting calculation
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <roughnessmap_fragment>',
                    `#include <roughnessmap_fragment>
                
                // ═══════════════════════════════════════════════════════════════
                // PUDDLE & WET SURFACE MODIFICATIONS - Faraz-style
                // ═══════════════════════════════════════════════════════════════
                float puddle = getPuddle(vWorldPos.xz * 0.003);  // Double size puddles
                
                // Moderate wetness for subtler reflections
                float wetness = smoothstep(0.15, 0.6, puddle);
                
                // Keep some texture in wet areas (less mirror-like)
                float wetRoughness = mix(roughnessFactor, 0.05, wetness);
                roughnessFactor = clamp(wetRoughness, 0.05, 0.45);
                `,
                );

                // Inject normal perturbation for ripples
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <normal_fragment_maps>',
                    `#include <normal_fragment_maps>
                
                // ═══════════════════════════════════════════════════════════════
                // RAIN RIPPLE NORMAL PERTURBATION
                // ═══════════════════════════════════════════════════════════════
                float puddle2 = getPuddle(vWorldPos.xz * 0.003);  // Double size puddles
                
                // Smaller ripples (higher frequency) for raindrop-sized circular waves
                // Scale 0.15 = ~300 cells across 2000 units = each cell ~6.7 units
                vec3 rippleNormal = getRipples(vWorldPos.xz * 0.15, uTime);
                vec3 rippleNormal2 = getRipples(vWorldPos.xz * 0.12 + vec2(100.0), uTime * 0.85);
                vec3 combinedRipple = normalize(rippleNormal + rippleNormal2 * 0.5);

                // Subtle ripples, slightly stronger inside puddles
                float rippleStrength = 0.16 + puddle2 * 0.22;
                normal = perturbNormal(normal, combinedRipple, rippleStrength);
                `,
                );

                // Add neon light reflections to final color
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <output_fragment>',
                    `
                // ═══════════════════════════════════════════════════════════════
                // NEON LIGHT REFLECTIONS - Vibrant colored light on wet pavement
                // ═══════════════════════════════════════════════════════════════
                vec3 neonReflection = vec3(0.0);
                vec3 viewDirGround = normalize(uCameraPos - vWorldPos);
                float puddle3 = getPuddle(vWorldPos.xz * 0.003);  // Double size puddles
                
                // Lower base wetness for subtler reflections
                float wetness3 = 0.35 + puddle3 * 0.25;
                
                for(int i = 0; i < 8; i++) {
                    vec3 lightPos = uLightPositions[i];
                    vec3 lightColor = uLightColors[i];
                    
                    // Skip invalid lights (placed far away)
                    if (lightPos.y > 500.0) continue;
                    
                    float dist = distance(vWorldPos, lightPos);
                    
                    // Very gentle falloff for maximum reach
                    float atten = 1.0 / (1.0 + dist * 0.001 + dist * dist * 0.000002);
                    
                    // Wide elongated streaks (like real wet road reflections)
                    float zDist = abs(vWorldPos.z - lightPos.z);
                    float xDist = abs(vWorldPos.x - lightPos.x);
                    float streakFalloff = exp(-xDist * 0.008) * exp(-zDist * 0.001);
                    
                    // Specular reflection
                    vec3 lightDir = normalize(lightPos - vWorldPos);
                    vec3 reflectDir = reflect(-lightDir, normal);
                    float spec = pow(max(dot(reflectDir, -viewDirGround), 0.0), 4.0);
                    
                    // Combine: mostly streak-based for elongated look
                    float totalReflect = spec * 0.2 + streakFalloff * 0.8;
                    
                    // Softer neon tint
                    vec3 saturatedColor = lightColor * 1.6;
                    
                    // Reduced intensity for more natural wet look
                    neonReflection += saturatedColor * totalReflect * atten * 35.0 * wetness3;
                }
                
                // Strong purple/cyan city ambient glow
                float cityGlowMix = smoothstep(-150.0, 150.0, vWorldPos.x);
                vec3 cityGlow = mix(vec3(0.1, 0.3, 0.8), vec3(0.7, 0.1, 0.9), cityGlowMix);
                neonReflection += cityGlow * 0.45 * wetness3;
                
                outgoingLight += neonReflection;
                
                #include <output_fragment>
                `,
                );

                // Store shader reference for uniform updates
                this.groundShader = shader;
            };
        }

        // Need customProgramCacheKey to prevent shader caching issues (WebGL only)
        if (!this.isWebGPU) {
            wetAsphaltMaterial.customProgramCacheKey = () => 'neon-district-wet-asphalt';
        }

        // MeshPhysicalMaterial works well for both WebGL and WebGPU
        // The clearcoat + envMapIntensity already provides a good wet look
        // The onBeforeCompile shader injection (puddles/ripples) only works for WebGL

        this.ground = new THREE.Mesh(groundGeometry, wetAsphaltMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.set(0, 0, -2000);
        this.ground.receiveShadow = true; // Receive shadows from buildings/storefronts
        this.ground.userData.material = wetAsphaltMaterial;
        this.scene.add(this.ground);
        this.groundMaterial = wetAsphaltMaterial;

        // AAA PHASE 1: parent the reflector's target to the ground so the reflection
        // plane = the road. The ground is rotated -90deg on X, so the target's local
        // +Z maps to world +Y (upward-facing mirror). Added before freeze so
        // updateMatrixWorld(true) bakes the target's world matrix once.
        if (this.groundReflector) {
            this.ground.add(this.groundReflector.target);
        }
        this.freezeStaticObject(this.ground);

        // Subtle warm spotlight - skip for WebGPU to keep light count low
        if (!this.isWebGPU) {
            const spotLight = new THREE.SpotLight(0xffaa55, 5, 300, Math.PI / 4, 0.5, 1);
            spotLight.position.set(0, 120, -100);
            spotLight.target.position.set(0, 0, -180);
            this.scene.add(spotLight);
            this.scene.add(spotLight.target);
        }

        // Note: Street lanterns are created separately in Phase 5 of progressive loading

        // Add road markings for detail
        this.createRoadMarkings();

        // Add city glow lights
        // this.createCityGlowLights(); // Removed - visible light dots
    }

    createRoadMarkings() {
        // ═══════════════════════════════════════════════════════════════════════
        // HIGH-RES CENTER LINE - Procedural canvas texture like summer grass
        // ═══════════════════════════════════════════════════════════════════════
        const texSize = 512;
        const canvas = document.createElement('canvas');
        canvas.width = texSize;
        canvas.height = texSize;
        const ctx = canvas.getContext('2d');

        // Base yellow with gradient variation
        const gradient = ctx.createLinearGradient(0, 0, texSize, 0);
        gradient.addColorStop(0, '#cc9900');
        gradient.addColorStop(0.3, '#ffcc00');
        gradient.addColorStop(0.5, '#ffdd22');
        gradient.addColorStop(0.7, '#ffcc00');
        gradient.addColorStop(1, '#cc9900');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, texSize, texSize);

        // Add wear/aging patterns
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * texSize;
            const y = Math.random() * texSize;
            const w = 2 + Math.random() * 6;
            const h = 10 + Math.random() * 30;

            // Darker worn patches
            const darkness = 0.7 + Math.random() * 0.3;
            ctx.fillStyle = `rgba(80, 60, 0, ${1 - darkness})`;
            ctx.fillRect(x, y, w, h);
        }

        // Add subtle edge roughness
        for (let y = 0; y < texSize; y += 2) {
            const edgeVariation = Math.random() * 8;
            // Left edge
            ctx.fillStyle = 'rgba(20, 15, 10, 0.4)';
            ctx.fillRect(0, y, edgeVariation, 2);
            // Right edge
            ctx.fillRect(texSize - edgeVariation, y, edgeVariation, 2);
        }

        // Add paint splatter/texture
        for (let i = 0; i < 100; i++) {
            const x = 20 + Math.random() * (texSize - 40);
            const y = Math.random() * texSize;
            const radius = 1 + Math.random() * 3;

            // Brighter paint spots
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 230, 100, ${0.3 + Math.random() * 0.4})`;
            ctx.fill();
        }

        // Create texture with proper filtering for smooth distance rendering
        const lineTexture = new THREE.CanvasTexture(canvas);
        lineTexture.wrapS = THREE.RepeatWrapping;
        lineTexture.wrapT = THREE.RepeatWrapping;
        lineTexture.repeat.set(1, 36); // Less repetition for smoother look

        // CRITICAL: Proper mipmapping and filtering for smooth distance
        lineTexture.generateMipmaps = true;
        lineTexture.minFilter = THREE.LinearMipmapLinearFilter; // Trilinear filtering
        lineTexture.magFilter = THREE.LinearFilter;
        if (this.renderer?.capabilities?.getMaxAnisotropy) {
            const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
            lineTexture.anisotropy = Math.min(maxAniso, 8);
        }

        const lineGeometry = new THREE.PlaneGeometry(4, 12000); // Extended to match longer road
        const lineMaterial = this.createBasicMaterial({
            map: lineTexture,
            transparent: true,
            opacity: 0.55,
        });
        const centerLine = new THREE.Mesh(lineGeometry, lineMaterial);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.set(0, 2, -2000); // Shifted back to cover mega tower
        this.scene.add(centerLine);
        this.freezeStaticObject(centerLine);

        // REMOVED: Circular mesh puddles - now using SHADER-BASED FBM puddles only
        // This creates organic, natural shapes instead of obvious round circles

        console.log('[NeonDistrict] Road markings created (high-res texture)');
    }

    createDistantCityLayers() {
        // Create a backdrop of simple geometry to fill the horizon void

        // Layer 1: Dense silhouettes just behind the main corridor (z: -3000 to -4000)
        // Layer 2: Sparse tall towers in the far back (z: -4000 to -6000)

        const geometry = new THREE.BoxGeometry(1, 1, 1);
        let material;
        if (this.isWebGPU) {
            const bottomColor = vec3(0.01, 0.005, 0.02);
            const topColor = vec3(0.05, 0.02, 0.08);
            const heightT = smoothstep(float(200.0), float(1800.0), positionWorld.y);
            material = new THREE.MeshBasicNodeMaterial();
            material.colorNode = mix(bottomColor, topColor, heightT);
            material.opacityNode = float(0.55);
            material.emissiveNode = vec3(0.0);
            material.transparent = true;
            material.depthWrite = false;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uColorBottom: { value: new THREE.Color(0x030008) },
                    uColorTop: { value: new THREE.Color(0x0a0416) },
                    uMinY: { value: 200.0 },
                    uMaxY: { value: 1800.0 },
                    uOpacity: { value: 0.55 },
                },
                vertexShader: `
                    varying float vWorldY;
                    void main() {
                        vec4 worldPos = modelMatrix * vec4(position, 1.0);
                        vWorldY = worldPos.y;
                        gl_Position = projectionMatrix * viewMatrix * worldPos;
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColorBottom;
                    uniform vec3 uColorTop;
                    uniform float uMinY;
                    uniform float uMaxY;
                    uniform float uOpacity;
                    varying float vWorldY;
                    void main() {
                        float t = smoothstep(uMinY, uMaxY, vWorldY);
                        vec3 color = mix(uColorBottom, uColorTop, t);
                        gl_FragColor = vec4(color, uOpacity);
                    }
                `,
                transparent: true,
                depthWrite: false,
            });
        }

        const count = 140;
        const mesh = new THREE.InstancedMesh(geometry, material, count);

        const dummy = new THREE.Object3D();
        let idx = 0;

        for (let i = 0; i < count; i++) {
            // WIDER distribution to fill side gaps
            const x = (Math.random() - 0.5) * 4000;

            // Deep distance
            const z = -4500 - Math.random() * 4500;

            const w = 120 + Math.random() * 260;
            const h = 400 + Math.random() * 1400; // Tall
            const d = 120 + Math.random() * 260;

            // Avoid the very center where the Mega Tower sits (x: -150 to 150)
            if (Math.abs(x) < 300) continue;

            dummy.position.set(x, h / 2, z);
            dummy.scale.set(w, h, d);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx++, dummy.matrix);
        }

        mesh.count = idx;
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        this.freezeStaticObject(mesh);

        // Add a few "hero" distant lights (simple sprites)
        this.createDistantLights();
    }

    createMoon() {
        // Skip moon if noMoon flag is set
        if (this.featureFlags?.noMoon) {
            console.log('[NeonDistrict] Moon disabled via noMoon flag');
            this.godrayBaseIntensity = 0;
            return;
        }

        // AAA Phase 4a: large enough for the visible disc plus a wide corona halo.
        const geometry = new THREE.CircleGeometry(2200, 96);

        let material;
        if (this.isWebGPU || this.isWebGL) {
            const moonMaterial = createMoonNodeMaterial();
            material = moonMaterial.material;
            this.moonUniforms = moonMaterial.uniforms;
        } else {
            // Custom shader fallback for the hero moon: bright disc, corona, banding.
            material = new THREE.ShaderMaterial({
                uniforms: {
                    color1: { value: new THREE.Color(0xff2bb0) },
                    color2: { value: new THREE.Color(0x35e8ff) },
                    haloColor: { value: new THREE.Color(0x9b3bff) },
                    uTime: { value: 0 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 color1;
                    uniform vec3 color2;
                    uniform vec3 haloColor;
                    uniform float uTime;
                    varying vec2 vUv;

                    float hash(vec2 p) {
                        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                    }

                    float noise(vec2 p) {
                        vec2 i = floor(p);
                        vec2 f = fract(p);
                        vec2 u = f * f * (3.0 - 2.0 * f);
                        float a = hash(i);
                        float b = hash(i + vec2(1.0, 0.0));
                        float c = hash(i + vec2(0.0, 1.0));
                        float d = hash(i + vec2(1.0, 1.0));
                        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                    }
                    
                    void main() {
                        float r = distance(vUv, vec2(0.5)) * 2.0;
                        float discMask = 1.0 - smoothstep(0.52, 0.58, r);
                        float haloCore = 1.0 - smoothstep(0.46, 1.0, r);
                        float halo = pow(haloCore, 2.3) * (0.85 + sin(uTime * 0.4) * 0.06);

                        vec3 grad = mix(color1, color2, vUv.y);
                        float bands = sin(vUv.y * 70.0) * 0.06 + 0.94;
                        float craters = noise(vUv * 7.0 + 13.0) * 0.22
                            + noise(vUv * 18.0 - 5.0) * 0.12
                            + 0.7;
                        float rim = smoothstep(0.30, 0.55, r) * 0.6;
                        vec3 disc = grad * bands * craters + grad * rim;
                        vec3 finalColor = disc * discMask * 1.35 + haloColor * halo;
                        float alpha = clamp(discMask + halo, 0.0, 1.0);

                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false, // Render behind everything opaque
                blending: THREE.AdditiveBlending,
            });
            this.moonUniforms = material.uniforms;
        }

        const moon = new THREE.Mesh(geometry, material);

        // Position: Far background, slightly lower
        // Mega Tower is at z=-4000. We want this BEHIND it.
        moon.position.set(-2500, 2700, -6000);

        // Face camera
        moon.lookAt(0, 50, 0);

        this.scene.add(moon);
        this.freezeStaticObject(moon);
        this.moon = moon;
        // AAA Phase 2b: anchor the volumetric god-rays to the moon.
        this.moonWorldPosition.copy(moon.position);
        console.log('[NeonDistrict] Cyber Moon created');
    }

    createCloudStrataFallbackMaterial(params = {}) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uTint: { value: params.tint ?? new THREE.Color(0x7a2da0) },
                uSpeed: { value: params.speed ?? 0.012 },
                uOpacity: { value: params.opacity ?? 0.3 },
                uScale: { value: params.scale ?? 1.0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uTint;
                uniform float uSpeed;
                uniform float uOpacity;
                uniform float uScale;
                varying vec2 vUv;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                }

                float fbm(vec2 p) {
                    float n = noise(p);
                    n += noise(p * 2.0 + 17.0) * 0.5;
                    n += noise(p * 4.0 + 31.0) * 0.25;
                    n += noise(p * 8.0 + 53.0) * 0.125;
                    return n / 1.875;
                }

                void main() {
                    vec2 p = vec2(vUv.x * 5.0 * uScale + uTime * uSpeed, vUv.y * 2.0);
                    float n = fbm(p);
                    float n2 = fbm(p * 2.0 + vec2(7.3, 2.1));
                    float cloud = smoothstep(0.42, 0.85, n * 0.7 + n2 * 0.3);
                    float vfade = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
                    float density = cloud * vfade;
                    gl_FragColor = vec4(uTint * density * 1.4, density * uOpacity);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
    }

    createSkyStrata() {
        if (this.featureFlags?.noSky || this.featureFlags?.noClouds) {
            return;
        }
        if (this.skyStrata?.length) {
            return;
        }

        const strataCount = this.qualityPreset?.skyStrataCount ?? 0;
        if (strataCount <= 0) {
            return;
        }

        const configs = [
            {
                position: new THREE.Vector3(-500, 2550, -6100),
                size: [8500, 1200],
                tint: new THREE.Color(0x7a2da0),
                speed: 0.010,
                opacity: 0.34,
                scale: 0.9,
                roll: -0.035,
            },
            {
                position: new THREE.Vector3(900, 3100, -7000),
                size: [9400, 1050],
                tint: new THREE.Color(0x214e7d),
                speed: -0.007,
                opacity: 0.26,
                scale: 1.15,
                roll: 0.045,
            },
            {
                position: new THREE.Vector3(-1200, 2100, -5600),
                size: [7200, 780],
                tint: new THREE.Color(0xb22a7d),
                speed: 0.014,
                opacity: 0.18,
                scale: 1.35,
                roll: 0.02,
            },
        ];

        for (let i = 0; i < Math.min(strataCount, configs.length); i++) {
            const cfg = configs[i];
            const geometry = new THREE.PlaneGeometry(cfg.size[0], cfg.size[1], 1, 1);
            let material;
            let uniforms = null;

            if (this.isWebGPU || this.isWebGL) {
                const materialInfo = createCloudStrataNodeMaterial({
                    tint: cfg.tint,
                    speed: cfg.speed,
                    opacity: cfg.opacity,
                    scale: cfg.scale,
                });
                material = materialInfo.material;
                uniforms = materialInfo.uniforms;
            } else {
                material = this.createCloudStrataFallbackMaterial(cfg);
                uniforms = material.uniforms;
            }

            const strata = new THREE.Mesh(geometry, material);
            strata.position.copy(cfg.position);
            strata.lookAt(0, 120, 40);
            strata.rotateZ(cfg.roll);
            strata.renderOrder = -12 + i;

            this.scene.add(strata);
            this.freezeStaticObject(strata);
            this.skyStrata.push(strata);
            if (uniforms) {
                this.skyStrataUniforms.push(uniforms);
            }
        }

        console.log(`[NeonDistrict] Sky smog strata created (${this.skyStrata.length})`);
    }

    /**
     * AAA Phase 4c — distant sheet-lightning. A broad emissive plane behind the
     * skyline whose intensity is pulsed from JS to silently flash the far sky,
     * backlighting the smog strata. Triggers ambiently and on Tetris (4-line) clears.
     */
    createSkyFlash() {
        if (this.featureFlags?.noSky || this.featureFlags?.noClouds) return;
        if (!(this.isWebGPU || this.isWebGL)) return; // node material covers both backends
        if (this.skyFlash) return;

        const geometry = new THREE.PlaneGeometry(18000, 7000, 1, 1);
        const { material, uniforms } = createSkyFlashNodeMaterial();
        const flash = new THREE.Mesh(geometry, material);
        flash.position.set(0, 2400, -8200); // behind the skyline cylinder
        flash.renderOrder = -20; // draw before the strata/buildings
        this.scene.add(flash);
        this.freezeStaticObject(flash);
        this.skyFlash = flash;
        this.skyFlashUniform = uniforms?.uFlash ?? null;
    }

    /**
     * Pulse the sheet-lightning. `amp` is the peak intensity; a quick secondary
     * flicker is scheduled for the characteristic lightning double-flash.
     */
    triggerSkyFlash(amp = 1.0) {
        if (!this.skyFlash) return;
        this.skyFlashIntensity = Math.max(this.skyFlashIntensity, amp);
        this.skyFlashPulse2At = 0.07 + Math.random() * 0.06;
        this.skyFlashPulse2Amp = amp * (0.45 + Math.random() * 0.35);
    }

    updateSkyFlash(delta) {
        if (!this.skyFlash) return;

        // Fast exponential decay of the current flash.
        this.skyFlashIntensity *= Math.exp(-delta * 6.0);

        // Ambient scheduling — an occasional silent flash on the horizon.
        this.skyFlashTimer -= delta;
        if (this.skyFlashTimer <= 0) {
            this.triggerSkyFlash(0.45 + Math.random() * 0.45);
            this.skyFlashTimer = 9 + Math.random() * 17; // next in 9–26s
        }

        // Secondary double-flash flicker.
        if (this.skyFlashPulse2At > 0) {
            this.skyFlashPulse2At -= delta;
            if (this.skyFlashPulse2At <= 0) {
                this.skyFlashIntensity = Math.max(this.skyFlashIntensity, this.skyFlashPulse2Amp);
                this.skyFlashPulse2At = 0;
            }
        }

        const v = Math.min(this.skyFlashIntensity, 1.5);
        if (this.skyFlashUniform) {
            this.skyFlashUniform.value = v;
        }
    }

    /**
     * Creates a panoramic skyline cylinder to surround the city
     * This fills the void with distant building silhouettes and lights
     */
    createDistantSkyline() {
        // Massive cylinder to surround the entire scene - TALLER as requested
        const quality = this.currentQualityName || 'High';
        const radialSegments = quality === 'Minimal'
            ? 16
            : quality === 'Low'
                ? 24
                : quality === 'Medium'
                    ? 32
                    : 64;
        const geometry = new THREE.CylinderGeometry(4500, 4500, 5000, radialSegments, 1, true);

        let material;
        if (this.isWebGPU) {
            material = createSkylineNodeMaterial().material;
        } else {
            // Procedural city texture shader
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor1: { value: new THREE.Color(0x020005) }, // Almost black base
                    uColor2: { value: new THREE.Color(0x050010) }, // Very dark top
                    uWindowColor: { value: new THREE.Color(0x401060) }, // Dim purple/pink windows (darker)
                },
                vertexShader: `
                    varying vec2 vUv;
                    varying vec3 vWorldPosition;
                    void main() {
                        vUv = uv;
                        vec4 worldPos = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPos.xyz;
                        gl_Position = projectionMatrix * viewMatrix * worldPos;
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor1;
                    uniform vec3 uColor2;
                    uniform vec3 uWindowColor;
                    varying vec2 vUv;
                    varying vec3 vWorldPosition;

                    // Pseudo-random
                    float rand(vec2 co) {
                        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                    }

                    void main() {
                        // Mask area behind Mega Tower
                        // Mega Tower is at Z=-4000, X=150. We clear the skyline behind it.
                        if (vWorldPosition.z < -3000.0 && abs(vWorldPosition.x) < 2000.0) discard;

                        // Create skyscraper silhouettes
                        // Grid for buildings
                        float buildingWidth = 0.02; // How wide each distant building is
                        float bIndex = floor(vUv.x / buildingWidth);
                        
                        // Random height for each building segment
                        float bHeight = 0.2 + rand(vec2(bIndex, 0.0)) * 0.4;
                        
                        // Second layer of buildings (offset)
                        float bIndex2 = floor((vUv.x + 0.01) / (buildingWidth * 0.8));
                        float bHeight2 = 0.15 + rand(vec2(bIndex2, 1.0)) * 0.5;
                        
                        // Combine silhouettes
                        float isBuilding = step(vUv.y, bHeight) + step(vUv.y, bHeight2);
                        
                        // Discard sky (let background sky gradient show through)
                        if (isBuilding < 0.5) discard;
                        
                        // Windows - PRECISE PINHEAD PATTERN
                        // Lower frequency grid to reduce shimmer during camera motion
                        vec2 windowScale = vec2(300.0, 200.0);
                        vec2 windowGrid = fract(vUv * windowScale);
                        float isWindow = step(0.3, windowGrid.x) * step(0.3, windowGrid.y);
                        
                        // Randomly light up windows - SPARSE
                        float windowNoise = rand(floor(vUv * windowScale));
                        float lightsOn = step(0.9, windowNoise) * isWindow; // ~10% on
                        
                        // Fade windows at bottom and top
                        lightsOn *= smoothstep(0.0, 0.2, vUv.y);
                        
                        vec3 finalColor = mix(uColor1, uColor2, vUv.y);
                        finalColor += uWindowColor * lightsOn * 1.6; // Glowy windows

                        gl_FragColor = vec4(finalColor, 1.0);
                    }
                `,
                side: THREE.BackSide, // Render inside of cylinder
                transparent: true,
                depthWrite: false, // Render behind everything
            });
        }

        const skyline = new THREE.Mesh(geometry, material);
        skyline.position.y = 1000; // Shift up (center at 1000, so 5000 height goes -1500 to +3500)
        this.scene.add(skyline);
        this.freezeStaticObject(skyline);
        console.log('[NeonDistrict] Distant skyline created');
    }

    createSearchlights() {
        this.searchlights = [];
        const quality = this.currentQualityName || 'High';
        const isMinimal = quality === 'Minimal';
        const isLow = quality === 'Low' || isMinimal;
        const coneSegments = isMinimal ? 8 : isLow ? 12 : quality === 'Medium' ? 16 : 24;
        const lightCount = isMinimal ? 1 : isLow ? 2 : quality === 'Medium' ? 4 : 6;
        const coneGeom = new THREE.ConeGeometry(50, 4000, coneSegments, 1, true);
        coneGeom.translate(0, 2000, 0); // Pivot at bottom

        let material;
        if (this.isWebGPU) {
            material = createSearchlightNodeMaterial().material;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0xaaccff) },
                },
                vertexShader: `
                    varying float vHeight;
                    void main() {
                        vHeight = position.y / 4000.0;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    varying float vHeight;
                    void main() {
                        // Fade out at top and sharp fade at edges -> "beam" look
                        float alpha = (1.0 - vHeight) * 0.15; // Subtle
                        gl_FragColor = vec4(uColor, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
        }

        // Create searchlights based on quality level
        for (let i = 0; i < lightCount; i++) {
            const mesh = new THREE.Mesh(coneGeom, material);
            // Position around the city outskirts
            const angle = (i / lightCount) * Math.PI * 2;
            const radius = 1200 + Math.random() * 800; // Farther out
            mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius - 1000);

            // Random rotation parameters
            mesh.userData = {
                phase: Math.random() * 10,
                speed: 0.3 + Math.random() * 0.4,
                tiltX: 0.1 + Math.random() * 0.2,
                tiltZ: 0.1 + Math.random() * 0.2,
            };

            this.scene.add(mesh);
            this.searchlights.push(mesh);
        }
    }

    updateSearchlights(delta) {
        if (!this.searchlights) return;
        this.searchlightUpdateAccumulator += delta;
        if (this.searchlightUpdateAccumulator < this.searchlightUpdateInterval) return;
        this.searchlightUpdateAccumulator = 0;
        const { time } = this;
        this.searchlights.forEach((light) => {
            // Sweep motion
            const t = time * light.userData.speed + light.userData.phase;
            light.rotation.z = Math.sin(t) * light.userData.tiltZ;
            light.rotation.x = Math.cos(t * 0.7) * light.userData.tiltX;
        });
    }

    createDistantLights() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];

        for (let i = 0; i < 200; i++) {
            const x = (Math.random() - 0.5) * 3000;
            if (Math.abs(x) < 200) continue; // Skip center

            const y = Math.random() * 1500;
            const z = -3500 - Math.random() * 2000;

            positions.push(x, y, z);

            const color = new THREE.Color();
            color.setHSL(Math.random(), 0.8, 0.5);
            colors.push(color.r, color.g, color.b);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 40,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0.6,
            transparent: true,
        });

        const points = new THREE.Points(geometry, material);
        this.scene.add(points);
    }

    // Ground-level city glow lights - Coming from building sides
    createCityGlowLights() {
        // Lights positioned at building edges, shining down onto street
        const glowPositions = [
            // LEFT SIDE (buildings at x ~ -30 to -50)
            {
                x: -35, y: 20, z: 20, color: 0xff00ff, intensity: 60,
            }, // Magenta
            {
                x: -40, y: 15, z: -30, color: 0x00ffff, intensity: 55,
            }, // Cyan
            {
                x: -38, y: 25, z: -80, color: 0xaa00ff, intensity: 50,
            }, // Purple
            {
                x: -42, y: 18, z: -130, color: 0xff00aa, intensity: 45,
            }, // Pink
            {
                x: -36, y: 22, z: -180, color: 0x8800ff, intensity: 40,
            }, // Deep purple
            {
                x: -45, y: 20, z: -250, color: 0x00ff88, intensity: 35,
            }, // Cyan-green
            {
                x: -38, y: 16, z: -320, color: 0xff66ff, intensity: 30,
            }, // Light magenta

            // RIGHT SIDE (buildings at x ~ 30 to 50)
            {
                x: 38, y: 18, z: 10, color: 0x00ffff, intensity: 60,
            }, // Cyan
            {
                x: 42, y: 22, z: -50, color: 0xff00ff, intensity: 55,
            }, // Magenta
            {
                x: 36, y: 15, z: -100, color: 0x00ff88, intensity: 50,
            }, // Green-cyan
            {
                x: 45, y: 25, z: -160, color: 0xaa00ff, intensity: 45,
            }, // Purple
            {
                x: 40, y: 18, z: -220, color: 0xff00aa, intensity: 40,
            }, // Pink
            {
                x: 35, y: 20, z: -280, color: 0x8800ff, intensity: 35,
            }, // Deep purple
            {
                x: 48, y: 16, z: -350, color: 0x66ffff, intensity: 30,
            }, // Light cyan
        ];

        glowPositions.forEach(({
            x, y, z, color, intensity,
        }) => {
            const light = new THREE.PointLight(color, intensity, 120);
            light.position.set(x, y, z);
            light.decay = 1.8;
            this.scene.add(light);
        });

        console.log('[NeonDistrict] Added building-side neon lights');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Neon Signs and Holographic Ads
    // ─────────────────────────────────────────────────────────────────────────

    async createNeonSigns() {
        this.neonSigns = [];
        const CHUNK_SIZE = 3; // Small chunks to avoid ANY lag during gameplay

        // Process buildings in chunks for non-blocking sign creation
        for (let i = 0; i < this.buildings.length; i += CHUNK_SIZE) {
            if (!this.isActive) return;

            const chunk = this.buildings.slice(i, i + CHUNK_SIZE);
            chunk.forEach((building) => {
                // 80% of buildings have at least one sign
                if (Math.random() > 0.8) return;

                // Add 1-3 signs per building
                const signCount = 1 + Math.floor(Math.random() * 3);
                for (let j = 0; j < signCount; j++) {
                    const type = Math.random();
                    if (type < 0.4) {
                        this.createNeonShape(building);
                    } else if (type < 0.7) {
                        this.createNeonBanner(building);
                    } else {
                        this.createNeonStrip(building);
                    }
                }
            });

            // Wait for idle time - doesn't compete with gameplay
            if (i + CHUNK_SIZE < this.buildings.length) {
                await this.deferToIdleTime();
            }
        }

        // SynthCity textured billboards - positioned on buildings
        const smallBillboards = [];
        const largeBillboards = [];
        const addBillboard = (x, y, z, isLarge) => {
            const width = isLarge ? 120 + Math.random() * 60 : 50 + Math.random() * 30;
            const height = isLarge ? 80 + Math.random() * 40 : 35 + Math.random() * 20;
            const rotationY = x > 0 ? Math.PI / 2 : -Math.PI / 2;
            const lodTier = this.determineBillboardLODTier(x, z);
            const entry = {
                x,
                y,
                z,
                width,
                height,
                rotationY,
                lodTier,
            };
            if (isLarge) {
                largeBillboards.push(entry);
            } else {
                smallBillboards.push(entry);
            }
        };

        // LEFT side billboards
        addBillboard(-300, 350, -500, true);
        addBillboard(0, 450, -700, true);
        addBillboard(-200, 280, -350, false);
        addBillboard(-380, 360, -550, true);
        addBillboard(-180, 400, -650, false);
        addBillboard(-450, 420, -500, true);
        addBillboard(-250, 320, -250, true); // Closer foreground
        addBillboard(-350, 480, -750, true); // Higher back
        addBillboard(-150, 200, -200, false); // Low foreground
        addBillboard(-420, 300, -400, false); // Mid-left

        // RIGHT side billboards (ensure both sides have ads)
        addBillboard(300, 320, -400, true);
        addBillboard(250, 380, -550, false);
        addBillboard(350, 280, -300, true);
        addBillboard(280, 450, -600, false);
        addBillboard(220, 250, -200, true); // Closer foreground
        addBillboard(380, 420, -700, true); // Higher back
        addBillboard(150, 180, -150, false); // Low foreground
        addBillboard(420, 350, -450, false); // Mid-right

        const smallAtlas = this.assets?.getAdAtlasInfo('small');
        const largeAtlas = this.assets?.getAdAtlasInfo('large');
        if (smallAtlas && smallBillboards.length) {
            this.createSynthCityBillboardInstances(smallBillboards, smallAtlas, false);
        } else {
            smallBillboards.forEach((b) => this.createSynthCityBillboard(b.x, b.y, b.z, false));
        }
        if (largeAtlas && largeBillboards.length) {
            this.createSynthCityBillboardInstances(largeBillboards, largeAtlas, true);
        } else {
            largeBillboards.forEach((b) => this.createSynthCityBillboard(b.x, b.y, b.z, true));
        }

        // Holographic billboards - pushed further back (z < -900)
        // Holographic billboards - REMOVED per user request
        /*
        this.createHolographicBillboard(400, 350, -1000);
        this.createHolographicBillboard(300, 450, -1100);
        this.createHolographicBillboard(150, 500, -1200);
        this.createHolographicBillboard(450, 320, -950);
        this.createHolographicBillboard(-350, 400, -1050);
        this.createHolographicBillboard(-200, 480, -1150);
        */

        // Add floating neon strips in the air
        // this.createFloatingNeonElements(); // Removed floating rings and lines per user request
        // Add smoke/steam effects
        this.createSmokeEffects();

        this.neonSigns.forEach((sign) => {
            if (sign.userData?.isBillboard) return;
            this.freezeStaticObject(sign);
        });
    }

    createSynthCityBillboardInstances(instances, atlasInfo, isLarge) {
        if (!atlasInfo?.texture || !instances.length) return;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const cols = atlasInfo.cols;
        const rows = atlasInfo.rows;
        const scaleX = 1 / cols;
        const scaleY = 1 / rows;
        const atlasCount = isLarge ? 18 : 5;
        const emissiveIntensity = this.assets?.adsEmissiveIntensity ?? 0.35;

        const uvOffsets = new Float32Array(instances.length * 2);
        const uvScales = new Float32Array(instances.length * 2);
        const flickerSpeeds = new Float32Array(instances.length);
        const flickerPhases = new Float32Array(instances.length);
        const flickerAmounts = new Float32Array(instances.length);

        for (let i = 0; i < instances.length; i++) {
            const texIndex = Math.floor(Math.random() * atlasCount);
            const col = texIndex % cols;
            const row = Math.floor(texIndex / cols);
            uvOffsets[i * 2] = col * scaleX;
            uvOffsets[i * 2 + 1] = row * scaleY;
            uvScales[i * 2] = scaleX;
            uvScales[i * 2 + 1] = scaleY;
            flickerSpeeds[i] = 1 + Math.random() * 3;
            flickerPhases[i] = Math.random() * 10;
            flickerAmounts[i] = 0.1;
        }

        geometry.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(uvOffsets, 2));
        geometry.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(uvScales, 2));
        geometry.setAttribute('aFlickerSpeed', new THREE.InstancedBufferAttribute(flickerSpeeds, 1));
        geometry.setAttribute('aFlickerPhase', new THREE.InstancedBufferAttribute(flickerPhases, 1));
        geometry.setAttribute('aFlickerAmount', new THREE.InstancedBufferAttribute(flickerAmounts, 1));

        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            const uTime = uniform(0);
            const uvScaleAttr = attribute('aUvScale');
            const uvOffsetAttr = attribute('aUvOffset');
            const flickerSpeed = attribute('aFlickerSpeed');
            const flickerPhase = attribute('aFlickerPhase');
            const flickerAmount = attribute('aFlickerAmount');
            const atlasUv = uv().mul(uvScaleAttr).add(uvOffsetAttr);
            const baseTex = uniformTexture(atlasInfo.texture).sample(atlasUv).rgb;
            const flicker = sin(uTime.mul(flickerSpeed).add(flickerPhase)).mul(flickerAmount).add(float(0.7));
            material = new THREE.MeshBasicNodeMaterial();
            material.colorNode = baseTex.mul(flicker);
            material.emissiveNode = baseTex.mul(float(emissiveIntensity)).mul(flicker);
            material.side = THREE.DoubleSide;
            uniforms = { uTime };
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uAtlas: { value: atlasInfo.texture },
                },
                vertexShader: `
                    attribute vec2 aUvOffset;
                    attribute vec2 aUvScale;
                    attribute float aFlickerSpeed;
                    attribute float aFlickerPhase;
                    attribute float aFlickerAmount;
                    attribute mat4 instanceMatrix;
                    varying vec2 vUv;
                    varying vec3 vFlicker;
                    void main() {
                        vUv = uv * aUvScale + aUvOffset;
                        vFlicker = vec3(aFlickerSpeed, aFlickerPhase, aFlickerAmount);
                        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D uAtlas;
                    uniform float uTime;
                    varying vec2 vUv;
                    varying vec3 vFlicker;
                    void main() {
                        vec4 tex = texture2D(uAtlas, vUv);
                        float flicker = sin(uTime * vFlicker.x + vFlicker.y) * vFlicker.z + 0.7;
                        vec3 color = tex.rgb * flicker;
                        gl_FragColor = vec4(color, tex.a);
                    }
                `,
                transparent: false,
                side: THREE.DoubleSide,
                defines: {
                    USE_INSTANCING: '',
                },
            });
            uniforms = material.uniforms;
        }

        const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        mesh.frustumCulled = false;
        const dummy = new THREE.Object3D();

        instances.forEach((inst, i) => {
            dummy.position.set(inst.x, inst.y, inst.z);
            dummy.rotation.y = inst.rotationY;
            dummy.scale.set(inst.width, inst.height, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);

            if (!this.featureFlags?.noBillboardLights && inst.lodTier < 2) {
                const intensity = inst.lodTier === 0 ? 2.0 : 1.0;
                const range = inst.lodTier === 0 ? 120 : 80;
                const light = new THREE.PointLight(0xffffff, intensity, range);
                light.position.set(inst.x, inst.y, inst.z);
                this.scene.add(light);
                this.billboardLights.push(light);
            }
        });

        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        this.patchMrtMaterialsForObject(mesh);

        if (isLarge) {
            this.billboardInstances.large = mesh;
            this.billboardInstanceUniforms.large = uniforms;
        } else {
            this.billboardInstances.small = mesh;
            this.billboardInstanceUniforms.small = uniforms;
        }
        if (uniforms?.uTime) {
            this.instancedBillboardUniforms.push(uniforms);
        }
    }

    queueAdInstance(building, width, depth, adWidth, adHeight, adY, isLarge) {
        if (!building) return;
        const dummy = this._adInstanceDummy || (this._adInstanceDummy = new THREE.Object3D());
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(adWidth, adHeight, 1);
        this.placeBillboardFacingStreet(building, dummy, width, depth, adY);
        dummy.updateMatrix();
        building.updateMatrixWorld(true);
        const worldMatrix = new THREE.Matrix4().multiplyMatrices(building.matrixWorld, dummy.matrix);
        const bucket = isLarge ? this.adInstanceBuckets.large : this.adInstanceBuckets.small;
        bucket.push({
            matrix: worldMatrix,
            flickerSpeed: 1 + Math.random() * 3,
            flickerPhase: Math.random() * 10,
            flickerAmount: 0.1,
        });
    }

    flushAdInstanceBatches() {
        const smallAtlas = this.assets?.getAdAtlasInfo('small');
        const largeAtlas = this.assets?.getAdAtlasInfo('large');
        if (smallAtlas && this.adInstanceBuckets.small.length) {
            this.adInstanceMeshes.small = this.createAdInstanceMesh(this.adInstanceBuckets.small, smallAtlas, false);
        }
        if (largeAtlas && this.adInstanceBuckets.large.length) {
            this.adInstanceMeshes.large = this.createAdInstanceMesh(this.adInstanceBuckets.large, largeAtlas, true);
        }
        this.adInstanceBuckets.small = [];
        this.adInstanceBuckets.large = [];
    }

    createAdInstanceMesh(instances, atlasInfo, isLarge) {
        if (!atlasInfo?.texture || !instances.length) return null;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const cols = atlasInfo.cols;
        const rows = atlasInfo.rows;
        const scaleX = 1 / cols;
        const scaleY = 1 / rows;
        const atlasCount = isLarge ? 18 : 5;
        const emissiveIntensity = this.assets?.adsEmissiveIntensity ?? 0.35;

        const uvOffsets = new Float32Array(instances.length * 2);
        const uvScales = new Float32Array(instances.length * 2);
        const flickerSpeeds = new Float32Array(instances.length);
        const flickerPhases = new Float32Array(instances.length);
        const flickerAmounts = new Float32Array(instances.length);

        for (let i = 0; i < instances.length; i++) {
            const texIndex = Math.floor(Math.random() * atlasCount);
            const col = texIndex % cols;
            const row = Math.floor(texIndex / cols);
            uvOffsets[i * 2] = col * scaleX;
            uvOffsets[i * 2 + 1] = row * scaleY;
            uvScales[i * 2] = scaleX;
            uvScales[i * 2 + 1] = scaleY;
            flickerSpeeds[i] = instances[i].flickerSpeed;
            flickerPhases[i] = instances[i].flickerPhase;
            flickerAmounts[i] = instances[i].flickerAmount;
        }

        geometry.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(uvOffsets, 2));
        geometry.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(uvScales, 2));
        geometry.setAttribute('aFlickerSpeed', new THREE.InstancedBufferAttribute(flickerSpeeds, 1));
        geometry.setAttribute('aFlickerPhase', new THREE.InstancedBufferAttribute(flickerPhases, 1));
        geometry.setAttribute('aFlickerAmount', new THREE.InstancedBufferAttribute(flickerAmounts, 1));

        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            const uTime = uniform(0);
            const uvScaleAttr = attribute('aUvScale');
            const uvOffsetAttr = attribute('aUvOffset');
            const flickerSpeed = attribute('aFlickerSpeed');
            const flickerPhase = attribute('aFlickerPhase');
            const flickerAmount = attribute('aFlickerAmount');
            const atlasUv = uv().mul(uvScaleAttr).add(uvOffsetAttr);
            const baseTex = uniformTexture(atlasInfo.texture).sample(atlasUv).rgb;
            const flicker = sin(uTime.mul(flickerSpeed).add(flickerPhase)).mul(flickerAmount).add(float(0.7));
            material = new THREE.MeshBasicNodeMaterial();
            material.colorNode = baseTex.mul(flicker);
            material.emissiveNode = baseTex.mul(float(emissiveIntensity)).mul(flicker);
            material.side = THREE.DoubleSide;
            uniforms = { uTime };
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uAtlas: { value: atlasInfo.texture },
                },
                vertexShader: `
                    attribute vec2 aUvOffset;
                    attribute vec2 aUvScale;
                    attribute float aFlickerSpeed;
                    attribute float aFlickerPhase;
                    attribute float aFlickerAmount;
                    attribute mat4 instanceMatrix;
                    varying vec2 vUv;
                    varying vec3 vFlicker;
                    void main() {
                        vUv = uv * aUvScale + aUvOffset;
                        vFlicker = vec3(aFlickerSpeed, aFlickerPhase, aFlickerAmount);
                        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D uAtlas;
                    uniform float uTime;
                    varying vec2 vUv;
                    varying vec3 vFlicker;
                    void main() {
                        vec4 tex = texture2D(uAtlas, vUv);
                        float flicker = sin(uTime * vFlicker.x + vFlicker.y) * vFlicker.z + 0.7;
                        vec3 color = tex.rgb * flicker;
                        gl_FragColor = vec4(color, tex.a);
                    }
                `,
                transparent: false,
                side: THREE.DoubleSide,
                defines: {
                    USE_INSTANCING: '',
                },
            });
            uniforms = material.uniforms;
        }

        const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        mesh.frustumCulled = false;
        instances.forEach((inst, i) => {
            mesh.setMatrixAt(i, inst.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
        this.patchMrtMaterialsForObject(mesh);

        if (isLarge) {
            this.billboardInstanceUniforms.large = uniforms;
        } else {
            this.billboardInstanceUniforms.small = uniforms;
        }
        if (uniforms?.uTime) {
            this.instancedBillboardUniforms.push(uniforms);
        }

        return mesh;
    }

    /**
     * Create a billboard using SynthCity's ad textures
     */
    createSynthCityBillboard(x, y, z, isLarge = false) {
        const material = isLarge
            ? this.assets?.getRandomLargeAdMaterial()
            : this.assets?.getRandomAdMaterial();

        if (!material) {
            // Fallback to holographic
            this.createHolographicBillboard(x, y, z);
            return;
        }

        const width = isLarge ? 120 + Math.random() * 60 : 50 + Math.random() * 30;
        const height = isLarge ? 80 + Math.random() * 40 : 35 + Math.random() * 20;
        const geometry = new THREE.PlaneGeometry(width, height);

        const billboard = new THREE.Mesh(geometry, material);
        billboard.position.set(x, y, z);
        // Face the road: right side (x>0) faces left (+90°), left side (x<0) faces right (-90°)
        billboard.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
        billboard.userData.lodTier = this.determineBillboardLODTier(x, z);

        // Add glow light based on ad
        if (!this.featureFlags?.noBillboardLights && billboard.userData.lodTier < 2) {
            const intensity = billboard.userData.lodTier === 0 ? 2.0 : 1.0;
            const range = billboard.userData.lodTier === 0 ? 120 : 80;
            const light = new THREE.PointLight(0xffffff, intensity, range);
            billboard.add(light);
        }

        // Store for flicker animation
        billboard.userData.flickerSpeed = 1 + Math.random() * 3;
        billboard.userData.flickerPhase = Math.random() * 10;
        billboard.userData.flickerAmount = 0.1;

        this.neonSigns.push(billboard);
        this.scene.add(billboard);
    }

    /**
     * Create smoke/steam effects using SynthCity textures
     */
    createSmokeEffects() {
        // Add smoke billboards near buildings
        for (let i = 0; i < 8; i++) {
            const material = this.assets?.getRandomSmokeMaterial();
            if (!material) continue;

            const size = 40 + Math.random() * 60;
            const geometry = new THREE.PlaneGeometry(size, size * 1.5);

            const smoke = new THREE.Mesh(geometry, material);
            smoke.position.set(
                (Math.random() - 0.5) * 400,
                200 + Math.random() * 300,
                -200 - Math.random() * 600,
            );

            // Store for billboard (face camera) animation
            smoke.userData.isBillboard = true;
            smoke.userData.rotationSpeed = 0.001 + Math.random() * 0.002;
            smoke.userData.lodTier = this.determineBillboardLODTier(smoke.position.x, smoke.position.z);

            this.registerBillboard(smoke);
            this.neonSigns.push(smoke);
            this.scene.add(smoke);
        }

        // Add volumetric spotlight beams
        this.createSpotlightBeams();
    }

    /**
     * Create volumetric spotlight beams streaming down between buildings
     */
    createSpotlightBeams() {
        // Create cone-shaped light beams
        for (let i = 0; i < 6; i++) {
            // Cone geometry for light beam
            const beamHeight = 150 + Math.random() * 200;
            const beamRadius = 30 + Math.random() * 40;
            const geometry = new THREE.ConeGeometry(beamRadius, beamHeight, 16, 1, true);

            // Volumetric light material
            const colors = [0xaa00ff, 0xff00ff, 0x8866ff, 0xcc00ff, 0x00ffff];
            const color = colors[Math.floor(Math.random() * colors.length)];

            const material = this.createBasicMaterial({
                color,
                transparent: true,
                opacity: 0.08,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const beam = new THREE.Mesh(geometry, material);

            // Position beams at various heights pointing down
            beam.position.set(
                (Math.random() - 0.5) * 400,
                300 + Math.random() * 300,
                -300 - Math.random() * 600,
            );

            // Point downward with slight random tilt
            beam.rotation.x = Math.PI + (Math.random() - 0.5) * 0.3;
            beam.rotation.z = (Math.random() - 0.5) * 0.2;

            // Store for animation
            beam.userData.isSpotlight = true;
            beam.userData.pulseSpeed = 0.5 + Math.random() * 0.5;
            beam.userData.pulsePhase = Math.random() * Math.PI * 2;
            beam.userData.baseOpacity = material.opacity;

            this.neonSigns.push(beam);
            this.scene.add(beam);
        }

        console.log('[NeonDistrict] Added volumetric spotlight beams');
    }

    createNeonStrip(building) {
        // Horizontal neon accent strip
        const w = 30 + Math.random() * 50;
        const h = 3 + Math.random() * 5;
        const geometry = new THREE.PlaneGeometry(w, h);

        // Purple-heavy color palette
        const colors = [0xaa00ff, 0xff00ff, 0x8800ff, 0xcc00ff, 0xff00aa, 0x6600ff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = this.createBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);
        this.attachSignToBuilding(building, sign, color);
    }

    createFloatingNeonElements() {
        // Add floating neon rings and lines throughout the scene
        const purpleColors = [0xaa00ff, 0xff00ff, 0x8800ff, 0xcc00ff, 0x6600ff, 0x9933ff];

        // Floating rings
        for (let i = 0; i < 15; i++) {
            const geometry = new THREE.TorusGeometry(5 + Math.random() * 15, 0.8, 8, 32);
            const color = purpleColors[Math.floor(Math.random() * purpleColors.length)];
            const material = this.createBasicMaterial({
                color,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending,
            });

            const ring = new THREE.Mesh(geometry, material);
            ring.position.set(
                (Math.random() - 0.5) * 600,
                100 + Math.random() * 400,
                -200 - Math.random() * 800,
            );
            ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

            // Add glow light
            if (!this.featureFlags?.noBillboardLights) {
                const light = new THREE.PointLight(color, 1.5, 60);
                ring.add(light);
            }

            ring.userData.floatSpeed = 0.3 + Math.random() * 0.5;
            ring.userData.floatOffset = Math.random() * 100;
            this.neonSigns.push(ring);
            this.scene.add(ring);
        }

        // Floating neon lines/tubes
        for (let i = 0; i < 20; i++) {
            const length = 20 + Math.random() * 80;
            const geometry = new THREE.CylinderGeometry(0.5, 0.5, length, 8);
            const color = purpleColors[Math.floor(Math.random() * purpleColors.length)];
            const material = this.createBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
            });

            const tube = new THREE.Mesh(geometry, material);
            tube.position.set(
                (Math.random() - 0.5) * 500,
                80 + Math.random() * 350,
                -100 - Math.random() * 700,
            );
            tube.rotation.set(
                Math.random() * Math.PI * 0.3,
                Math.random() * Math.PI,
                Math.random() * Math.PI * 0.5,
            );

            this.neonSigns.push(tube);
            this.scene.add(tube);
        }
    }

    createNeonShape(building) {
        // ... (The previous shape logic moved here) ...
        const shapeType = Math.floor(Math.random() * 4);
        let geometry;
        let scale = 1.0;

        switch (shapeType) {
            case 0: geometry = new THREE.TorusGeometry(8, 1.5, 8, 24); break;
            case 1: geometry = new THREE.ConeGeometry(10, 3, 3); scale = 1.2; break;
            case 2: geometry = new THREE.BoxGeometry(3, 40, 3); break;
            case 3: geometry = new THREE.SphereGeometry(6, 16, 16); break;
        }

        // Purple-dominant neon colors
        const colors = [0xff00ff, 0xaa00ff, 0x8800ff, 0xcc00ff, 0xff00aa, 0x6600ff, 0x9933ff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = this.createBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);
        sign.scale.set(scale, scale, scale);

        this.attachSignToBuilding(building, sign, color);
    }

    createNeonBanner(building) {
        // Vertical Text Banner
        const w = 15 + Math.random() * 10;
        const h = 40 + Math.random() * 40;
        const geometry = new THREE.PlaneGeometry(w, h);

        // Purple-biased hue (0.75-0.95 is purple/magenta range)
        const hue = 0.75 + Math.random() * 0.2;
        const color = new THREE.Color().setHSL(hue, 1.0, 0.55);
        const texture = this.generateNeonTexture(); // Use cached texture

        const material = this.createBasicMaterial({
            map: texture,
            color, // Tint the white texture with color

            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const sign = new THREE.Mesh(geometry, material);
        this.attachSignToBuilding(building, sign, color.getHex());
    }

    attachSignToBuilding(building, sign, colorHex) {
        // Position
        const buildingPos = building.position; // Usually 0,0,0 local? No, world pos for standard?
        // Wait, standard buildings are MESHES added to SCENE?
        // In createBuilding: building.position.set(x, 0, z); this.scene.add(building);
        // Correct.

        const yPos = 50 + Math.random() * 200;

        // Offset logic
        // We need approximate bounds of the building.
        // It's tricky with complex towers. Rough assumption: 50 width, 50 depth
        const offset = 40 + Math.random() * 10;
        const face = Math.floor(Math.random() * 4);

        // World space positioning relative to building center
        const bx = building.position.x;
        const bz = building.position.z;

        if (face === 0) { sign.position.set(bx, yPos, bz + offset); sign.rotation.y = 0; } else if (face === 1) { sign.position.set(bx, yPos, bz - offset); sign.rotation.y = Math.PI; } else if (face === 2) { sign.position.set(bx + offset, yPos, bz); sign.rotation.y = Math.PI / 2; } else { sign.position.set(bx - offset, yPos, bz); sign.rotation.y = -Math.PI / 2; }

        this.scene.add(sign);
        this.neonSigns.push(sign);

        // Lights removed for performance (Pure Bloom)
        sign.userData.baseColor = colorHex; // Store base color for reflections
        sign.userData.lodTier = building.userData?.lodTier ?? 0;

        // Flicker
        sign.userData.flickerSpeed = 2 + Math.random() * 8;
        sign.userData.flickerPhase = Math.random() * 10;
        sign.userData.flickerAmount = 0.3;
    }

    generateNeonTexture() {
        // Initialize cache if needed
        if (!this.neonCache) this.neonCache = {};

        const words = ['BAR', 'HOTEL', 'OPEN', 'DATA', 'TECH', 'ZONE', 'LIVE', 'SEX', 'XXX', 'GIRLS', 'BOYS', 'CLUB'];
        const text = words[Math.floor(Math.random() * words.length)];

        // Check cache
        if (this.neonCache[text]) {
            return this.neonCache[text];
        }

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Black background (for additive blending or simple tinting)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 128, 256);

        // Border - WHITE for tinting
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 120, 248);

        // Text settings
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Rotate text
        ctx.save();
        ctx.translate(64, 128);
        ctx.rotate(-Math.PI / 2);
        ctx.font = 'bold 40px Arial';
        ctx.fillText(text, 0, 0);
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);

        // Cache it
        this.neonCache[text] = texture;
        return texture;
    }

    getMegaTowerTexture(lite = false) {
        if (lite) {
            if (this.megaTowerTextureLite) return this.megaTowerTextureLite;
        } else if (this.megaTowerTexture) {
            return this.megaTowerTexture;
        }
        if (typeof document === 'undefined') return null;

        const canvas = document.createElement('canvas');
        canvas.width = lite ? 96 : 128;
        canvas.height = lite ? 384 : 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Dark base
        ctx.fillStyle = '#100018';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const cols = lite ? 10 : 12;
        const rows = lite ? 60 : 80;
        const cellW = canvas.width / cols;
        const cellH = canvas.height / rows;
        const padX = cellW * (lite ? 0.26 : 0.22);
        const padY = cellH * (lite ? 0.26 : 0.22);
        const windowColors = ['#ff00ff', '#aa00ff', '#cc00ff', '#00ffff'];
        const density = lite ? 0.1 : 0.18;
        const brightnessMin = lite ? 0.45 : 0.6;
        const brightnessMax = lite ? 0.8 : 1.1;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (Math.random() < density) {
                    const color = windowColors[Math.floor(Math.random() * windowColors.length)];
                    const intensity = brightnessMin + Math.random() * (brightnessMax - brightnessMin);
                    ctx.globalAlpha = intensity;
                    ctx.fillStyle = color;
                    ctx.fillRect(
                        x * cellW + padX,
                        y * cellH + padY,
                        cellW - padX * 2,
                        cellH - padY * 2,
                    );
                }
            }
        }

        ctx.globalAlpha = 1.0;

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 2);
        if (this.renderer?.capabilities?.getMaxAnisotropy) {
            const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
            texture.anisotropy = Math.min(maxAniso, 8);
        }

        if (lite) {
            this.megaTowerTextureLite = texture;
        } else {
            this.megaTowerTexture = texture;
        }
        return texture;
    }

    createHolographicBillboardOnBuilding(building, x, y, z, isLeft, faceCamera = false) {
        // OPTIMIZED: Smaller size for better FPS (was 100-200 x 60-140)
        const width = 60 + Math.random() * 40;
        const height = 40 + Math.random() * 30;

        // Purple color pairs for holographic effect
        const colorPairs = [
            [0xff00ff, 0x8800ff], // Magenta to purple
            [0xaa00ff, 0xff00aa], // Purple to pink
            [0xcc00ff, 0x6600ff], // Bright purple to violet
        ];
        const pair = colorPairs[Math.floor(Math.random() * colorPairs.length)];

        // OPTIMIZED: Simplified shader - removed scanlines and flicker for better FPS
        const geometry = new THREE.PlaneGeometry(width, height);
        let material;
        let hologramUniforms = null;
        if (this.isWebGPU) {
            const hologram = createHologramNodeMaterial({
                color1: new THREE.Color(pair[0]),
                color2: new THREE.Color(pair[1]),
            });
            material = hologram.material;
            hologramUniforms = hologram.uniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor1: { value: new THREE.Color(pair[0]) },
                    uColor2: { value: new THREE.Color(pair[1]) },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform vec3 uColor1;
                    uniform vec3 uColor2;
                    varying vec2 vUv;

                    void main() {
                        // Simple animated gradient (single sin call)
                        float gradient = sin(vUv.y * 6.0 + uTime) * 0.5 + 0.5;
                        vec3 color = mix(uColor1, uColor2, gradient);

                        // Simple edge fade
                        float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                        edge *= smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

                        gl_FragColor = vec4(color, 0.7 * edge);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
        }

        const billboard = new THREE.Mesh(geometry, material);
        billboard.position.set(x, y, z);
        if (hologramUniforms) {
            billboard.userData.hologramUniforms = hologramUniforms;
        }
        billboard.userData.lodTier = building.userData?.lodTier ?? 0;

        if (faceCamera) {
            // Face the camera (toward +Z direction)
            // Camera is at z=40. Billboard should face forward (toward camera).
            billboard.rotation.y = 0;
        } else {
            // Face the street
            // For Right Building (!isLeft): Attached to -X face. Needs to face -X. Rotation = +PI/2.
            // For Left Building (isLeft): Attached to +X face. Needs to face +X. Rotation = -PI/2.
            billboard.rotation.y = isLeft ? -Math.PI / 2 : Math.PI / 2;
        }

        this.neonSigns.push(billboard);
        building.add(billboard); // Add as child of building
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rain Particle System
    // ─────────────────────────────────────────────────────────────────────────

    createRainStreakTexture() {
        if (this.rainStreakTexture) return this.rainStreakTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 128;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Main streak gradient (thin core)
        const coreX = canvas.width * 0.5;
        const coreW = canvas.width * 0.2;
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
        grad.addColorStop(0.15, 'rgba(255, 255, 255, 0.25)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.75)');
        grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.2)');
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(coreX - coreW * 0.5, 0, coreW, canvas.height);

        // Soft droplet head
        const headGrad = ctx.createRadialGradient(
            coreX,
            canvas.height * 0.18,
            0,
            coreX,
            canvas.height * 0.18,
            canvas.width * 0.35,
        );
        headGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.85)');
        headGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.arc(coreX, canvas.height * 0.18, canvas.width * 0.25, 0, Math.PI * 2);
        ctx.fill();

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        this.rainStreakTexture = texture;
        return texture;
    }

    createRain() {
        const particleCount = this.qualityPreset.rainParticles;
        if (particleCount <= 0) return;

        // ===== CAMERA-RELATIVE RAIN (inspired by demo-2023-rain-puddle) =====
        // Rain spawns in a volume around the camera and follows it

        // Configuration for rain volume around camera
        this.rainConfig = {
            // Volume size around camera
            spreadX: 80,      // ±40 units in X
            spreadY: 60,      // 60 units tall (from camera.y - 5 to camera.y + 55)
            spreadZ: 120,     // ±60 units in Z (more depth for perspective)
            // Fall speed
            fallSpeed: 45,    // Units per second
            // Reset threshold (below camera)
            resetBelow: -10,
        };

        const rainTexture = this.createRainStreakTexture();

        // Subtle but visible rain streaks
        const rainGeometry = new THREE.PlaneGeometry(0.06, 0.8);

        const rainMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,  // white base; per-instance colour (6a) does the tinting
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        if (rainTexture) {
            rainMaterial.map = rainTexture;
            rainMaterial.alphaMap = rainTexture;
        }

        const rainMesh = new THREE.InstancedMesh(rainGeometry, rainMaterial, particleCount);
        rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        rainMesh.frustumCulled = false;
        rainMesh.renderOrder = 100; // Render on top

        // Initialize rain data - positions are OFFSETS from camera
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);

        const camera = this.camera;
        const camX = camera?.position.x ?? 0;
        const camY = camera?.position.y ?? 4;
        const camZ = camera?.position.z ?? 40;
        const cfg = this.rainConfig;

        // AAA Phase 6a: tint each streak by the neon zone it falls through (left
        // facades skew magenta/pink, right skew cyan, occasional amber) so the rain
        // reads as lit by the city instead of a uniform blue-white sheet.
        const _rainCol = new THREE.Color();
        const zoneTint = (x) => {
            const r = Math.random();
            if (x < -12 && r < 0.5) return [1.0, 0.45, 0.82];   // left neon → magenta/pink
            if (x > 12 && r < 0.5) return [0.42, 0.9, 1.0];     // right neon → cyan
            if (r < 0.1) return [1.0, 0.74, 0.4];               // occasional amber
            return [0.82, 0.9, 1.0];                            // cool blue-white default
        };

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            // Random position in volume around camera
            positions[i3] = camX + (Math.random() - 0.5) * cfg.spreadX;
            positions[i3 + 1] = camY + (Math.random() - 0.2) * cfg.spreadY;
            positions[i3 + 2] = camZ + (Math.random() - 0.5) * cfg.spreadZ;

            velocities[i] = cfg.fallSpeed * (0.8 + Math.random() * 0.4);
            sizes[i] = 0.4 + Math.random() * 0.5;

            const [cr, cg, cb] = zoneTint(positions[i3] - camX);
            _rainCol.setRGB(cr, cg, cb);
            rainMesh.setColorAt(i, _rainCol);
        }
        if (rainMesh.instanceColor) rainMesh.instanceColor.needsUpdate = true;

        this.rainMaterial = rainMaterial;
        this.rainUniforms = null;
        this.rainParticles = rainMesh;
        this.rainInstanceData = {
            positions,
            velocities,
            sizes,
        };
        this.rainInstanceDummy = this.rainInstanceDummy || new THREE.Object3D();

        // Initialize transforms
        const dummy = this.rainInstanceDummy;
        if (camera) {
            dummy.quaternion.copy(camera.quaternion);
        }
        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            dummy.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
            dummy.scale.set(sizes[i] * 0.7, sizes[i] * 1.8, 1)
            dummy.updateMatrix();
            rainMesh.setMatrixAt(i, dummy.matrix);
        }
        rainMesh.instanceMatrix.needsUpdate = true;

        this.scene.add(rainMesh);

        // Ground splash particles
        const splashCount = Math.floor(particleCount * 0.45);
        const splashGeometry = new THREE.BufferGeometry();
        const splashPositions = new Float32Array(splashCount * 3);
        const splashPhases = new Float32Array(splashCount);
        const splashColors = new Float32Array(splashCount * 3); // AAA Phase 6c

        for (let i = 0; i < splashCount; i++) {
            const sx = (Math.random() - 0.5) * 1200;
            splashPositions[i * 3] = sx;
            splashPositions[i * 3 + 1] = 0.5;
            splashPositions[i * 3 + 2] = (Math.random() - 0.5) * 2000 - 400;
            splashPhases[i] = Math.random() * 6.28;

            // 6c: splashes catch the colour of the neon overhead (zone by world-X).
            const r = Math.random();
            let cr = 0.85; let cg = 0.93; let cb = 1.0; // cool default
            if (sx < -120 && r < 0.55) { cr = 1.0; cg = 0.5; cb = 0.85; }       // left → magenta
            else if (sx > 120 && r < 0.55) { cr = 0.5; cg = 0.92; cb = 1.0; }   // right → cyan
            else if (r < 0.12) { cr = 1.0; cg = 0.78; cb = 0.45; }              // amber
            splashColors[i * 3] = cr;
            splashColors[i * 3 + 1] = cg;
            splashColors[i * 3 + 2] = cb;
        }

        splashGeometry.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
        splashGeometry.setAttribute('aPhase', new THREE.BufferAttribute(splashPhases, 1));
        splashGeometry.setAttribute('aColor', new THREE.BufferAttribute(splashColors, 3));

        if (this.isWebGPU) {
            const splash = createSplashNodeMaterial();
            this.splashMaterial = splash.material;
            this.splashUniforms = splash.uniforms;
        } else {
            // WebGL splash shader
            this.splashMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(0xccddff) },
                },
                vertexShader: `
                    attribute float aPhase;
                    attribute vec3 aColor;
                    uniform float uTime;
                    varying float vLife;
                    varying vec3 vColor;
                    void main() {
                        vec3 pos = position;
                        float cycle = mod(uTime * 6.0 + aPhase, 6.28);
                        vLife = max(0.0, sin(cycle));
                        vColor = aColor;
                        pos.y += vLife * 2.0;
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        gl_PointSize = vLife * 6.0 * (300.0 / -mvPosition.z);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    varying float vLife;
                    varying vec3 vColor;
                    void main() {
                        vec2 center = gl_PointCoord - vec2(0.5);
                        float dist = length(center) * 2.0;
                        float alpha = exp(-dist * dist * 6.0);
                        alpha *= 0.35 * vLife;
                        gl_FragColor = vec4(uColor * vColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.splashUniforms = this.splashMaterial.uniforms;
        }
        this.splashParticles = new THREE.Points(splashGeometry, this.splashMaterial);
        this.scene.add(this.splashParticles);

        console.log(`[NeonDistrict] Created camera-relative rain with ${particleCount} drops`);
    }

    updateRain(delta = 0.016) {
        // Camera-relative rain system (inspired by demo-2023-rain-puddle)
        if (!this.rainParticles?.isInstancedMesh || !this.rainInstanceData || !this.camera) {
            // Update splash uniforms
            if (this.splashUniforms?.uTime) {
                this.splashUniforms.uTime.value = this.time;
            } else if (this.splashMaterial?.uniforms) {
                this.splashMaterial.uniforms.uTime.value = this.time;
            }
            return;
        }

        // PHASE 3: Rain update throttling for performance
        // High quality: 60fps, Medium/Low: 30fps
        const rainUpdateRate = (this.currentQualityName === 'High' || this.currentQualityName === 'Ultra' || this.currentQualityName === 'Extreme')
            ? 60.0 : 30.0;
        const rainUpdateInterval = 1.0 / rainUpdateRate;

        if (!this.rainUpdateAccumulator) this.rainUpdateAccumulator = 0;
        this.rainUpdateAccumulator += delta;

        // Skip update if not enough time has passed
        if (this.rainUpdateAccumulator < rainUpdateInterval) {
            return;
        }

        // Use accumulated time for smoother motion
        const updateDelta = this.rainUpdateAccumulator;
        this.rainUpdateAccumulator = 0;

        const { positions, velocities, sizes } = this.rainInstanceData;
        const mesh = this.rainParticles;
        const dummy = this.rainInstanceDummy || (this.rainInstanceDummy = new THREE.Object3D());
        const camera = this.camera;
        const cfg = this.rainConfig;

        const camX = camera.position.x;
        const camY = camera.position.y;
        const camZ = camera.position.z;

        const fallSpeed = (cfg?.fallSpeed ?? 25) * (this.rainIntensity ?? 1.0);
        const resetBelow = camY + (cfg?.resetBelow ?? -10);
        const spreadX = cfg?.spreadX ?? 80;
        const spreadY = cfg?.spreadY ?? 60;
        const spreadZ = cfg?.spreadZ ?? 120;

        let stride = Math.max(1, this.rainUpdateStride || 1);
        if (this.slowFrameCount > 0) {
            stride = Math.min(stride * 2, 6);
        }
        const cursor = this.rainUpdateCursor || 0;
        this.rainUpdateCursor = (cursor + 1) % stride;
        const particleDelta = updateDelta * stride;

        dummy.quaternion.copy(camera.quaternion);

        for (let i = cursor; i < velocities.length; i += stride) {
            const i3 = i * 3;

            // Fall down (use accumulated delta for smooth motion)
            positions[i3 + 1] -= velocities[i] * particleDelta;

            // Reset when below threshold - respawn near camera
            if (positions[i3 + 1] < resetBelow) {
                positions[i3] = camX + (Math.random() - 0.5) * spreadX;
                positions[i3 + 1] = camY + (Math.random() * 0.8 + 0.2) * spreadY; // Reset to top
                positions[i3 + 2] = camZ + (Math.random() - 0.5) * spreadZ;
                velocities[i] = fallSpeed * (0.8 + Math.random() * 0.4);
            }

            // Set position and billboard to face camera
            dummy.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
            dummy.scale.set(sizes[i] * 0.7, sizes[i] * 1.8, 1)
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }

        mesh.instanceMatrix.needsUpdate = true;

        // Update material opacity based on intensity
        if (this.rainMaterial) {
            const intensity = this.rainIntensity ?? 1.0;
            this.rainMaterial.opacity = 0.35 + 0.25 * Math.min(intensity, 2.0);
        }

        // Update splash uniforms
        if (this.splashUniforms?.uTime) {
            this.splashUniforms.uTime.value = this.time;
        } else if (this.splashMaterial?.uniforms) {
            this.splashMaterial.uniforms.uTime.value = this.time;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Flying Vehicles (Spinners)
    // ─────────────────────────────────────────────────────────────────────────

    // OPTIMIZED: Merged Geometry for Wires
    createOverheadWires() {
        // Find left and right buildings
        const leftBuildings = this.buildings.filter((b) => b.position.x < 0);
        const rightBuildings = this.buildings.filter((b) => b.position.x > 0);

        const tubes = []; // Collect geometries

        leftBuildings.forEach((leftB) => {
            if (Math.random() > 0.4) return; // Not every building

            // Find partner
            const rightB = rightBuildings.find((b) => Math.abs(b.position.z - leftB.position.z) < 100);

            if (rightB) {
                // Connection points
                const h1 = 100 + Math.random() * 200; // Height on left
                const h2 = 100 + Math.random() * 200; // Height on right

                const p1 = new THREE.Vector3(leftB.position.x, h1, leftB.position.z);
                const p2 = new THREE.Vector3(rightB.position.x, h2, rightB.position.z);

                // Catenary sag (middle point is lower)
                const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                mid.y -= 20 + Math.random() * 30; // Sag amount

                const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);

                // Create geometry
                const geometry = new THREE.TubeGeometry(curve, 10, 0.3, 4, false);
                tubes.push(geometry);

                // Chance for a second parallel wire
                if (Math.random() > 0.5) {
                    const offset = new THREE.Vector3(0, -2, 0);
                    const p1b = p1.clone().add(offset);
                    const p2b = p2.clone().add(offset);
                    const midb = mid.clone().add(offset);
                    const curveB = new THREE.QuadraticBezierCurve3(p1b, midb, p2b);
                    const geomB = new THREE.TubeGeometry(curveB, 10, 0.3, 4, false);
                    tubes.push(geomB);
                }
            }
        });

        if (tubes.length > 0) {
            const mergedGeom = mergeGeometries(tubes);
            const wireMaterial = this.createBasicMaterial({ color: 0x111111 });
            const mesh = new THREE.Mesh(mergedGeom, wireMaterial);
            this.scene.add(mesh);
            console.log(`[NeonDistrict] Created merged overhead wires (${tubes.length} segments)`);
        }
    }

    updateFlyingVehicles(delta) {
        if (!this.vehicleData || !this.vehicleInstances) return;

        const dummy = this.vehicleHelper;
        const count = this.vehicleData.length;
        const range = this.vehicleRange || 2500;

        // PERF: Reuse matrices instead of cloning (avoids ~800+ allocations/frame)
        const bodyMatrix = this._vehicleBodyMatrix || (this._vehicleBodyMatrix = new THREE.Matrix4());
        const partWorld = this._vehiclePartMatrix || (this._vehiclePartMatrix = new THREE.Matrix4());

        // PERF: Helper function hoisted outside loop (avoids closure creation per vehicle)
        const setPart = (instMesh, index, relX, relY, relZ, relRotX = 0, relRotY = 0, relRotZ = 0) => {
            dummy.position.set(relX, relY, relZ);
            dummy.rotation.set(relRotX, relRotY, relRotZ);
            dummy.updateMatrix();
            partWorld.copy(bodyMatrix).multiply(dummy.matrix);
            instMesh.setMatrixAt(index, partWorld);
        };

        for (let i = 0; i < count; i++) {
            const data = this.vehicleData[i];

            // 1. UPDATE STATE
            const dirX = data.dirX ?? 0;
            const dirZ = data.dirZ ?? 1;
            data.x += dirX * data.speed * delta;
            data.z += dirZ * data.speed * delta;

            const wrapRange = data.wrapRange || range;
            if (data.multiDirection) {
                if (data.x > wrapRange && dirX > 0) data.x = -wrapRange;
                if (data.x < -wrapRange && dirX < 0) data.x = wrapRange;
                if (data.z > wrapRange && dirZ > 0) data.z = -wrapRange;
                if (data.z < -wrapRange && dirZ < 0) data.z = wrapRange;
            } else {
                // Loop logic (Wider range for high speed)
                if (data.z > range && dirZ > 0) data.z = -range;
                if (data.z < -range && dirZ < 0) data.z = range;
            }

            // Wobble calculation
            const time = this.time + data.wobbleOffset;
            let xOff = 0;
            let yOff = 0;

            const wobbleProfile = data.wobbleProfile
                || (data.lane <= 1 ? 'low' : (data.lane <= 3 ? 'mid' : 'high'));

            if (wobbleProfile === 'low') {
                // Tighter wobble for low/mid
                xOff = Math.sin(time * 0.5) * data.wobbleX;
                yOff = Math.sin(time * 1.0) * 5;
            } else if (wobbleProfile === 'mid') {
                // Wide sweeping drift for high/skyway
                xOff = Math.cos(time * 0.2) * data.wobbleX;
                yOff = Math.sin(time * 0.3) * 20;
            } else {
                // Orbital: very slow drift
                xOff = Math.cos(time * 0.1) * data.wobbleX;
                yOff = Math.sin(time * 0.2) * 50;
            }

            // Current position
            const posX = data.x + xOff;
            const posY = data.y + yOff;
            const posZ = data.z;

            // 2. UPDATE INSTANCES
            dummy.position.set(posX, posY, posZ);
            const heading = Math.atan2(dirX, dirZ);
            dummy.rotation.set(0, heading, 0);

            // Bank into turns
            if (data.lane > 1) {
                const bank = (data.lane === 4) ? 0.05 : 0.2;
                dummy.rotation.z = -Math.cos(time * 0.2) * bank;
            }

            dummy.updateMatrix();
            bodyMatrix.copy(dummy.matrix);
            this.vehicleInstances.body.setMatrixAt(i, bodyMatrix);

            // Canopy: 0, 2, 3, rotX=PI
            setPart(this.vehicleInstances.canopy, i, 0, 2, 3, Math.PI);

            // Engines (Left/Right)
            setPart(this.vehicleInstances.engine, i * 2, -6, -1, -2, Math.PI / 2);
            setPart(this.vehicleInstances.engine, i * 2 + 1, 6, -1, -2, Math.PI / 2);

            // Headlights
            setPart(this.vehicleInstances.headlight, i * 2, -3, 0, 10, 0);
            setPart(this.vehicleInstances.headlight, i * 2 + 1, 3, 0, 10, 0);

            // Tail lights
            setPart(this.vehicleInstances.tailLight, i * 2, -3, 0, -10, 0, Math.PI);
            setPart(this.vehicleInstances.tailLight, i * 2 + 1, 3, 0, -10, 0, Math.PI);

            // Exhausts (Cyan OR Orange)
            if (data.exhaustType === 'cyan') {
                setPart(this.vehicleInstances.exhaustCyan, i * 2, -6, -1, -6, 0);
                setPart(this.vehicleInstances.exhaustCyan, i * 2 + 1, 6, -1, -6, 0);
            } else {
                setPart(this.vehicleInstances.exhaustOrange, i * 2, -6, -1, -6, 0);
                setPart(this.vehicleInstances.exhaustOrange, i * 2 + 1, 6, -1, -6, 0);
            }
        }

        // Mark for update
        this.vehicleInstances.body.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.canopy.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.engine.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.headlight.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.tailLight.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.exhaustCyan.instanceMatrix.needsUpdate = true;
        this.vehicleInstances.exhaustOrange.instanceMatrix.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ground Traffic — driving cars on the street (companion to the flying cars).
    // GPU-instanced: a dark reflective body + a pair of headlights + a pair of
    // taillights + a soft underglow pool. Cars drive in lanes along Z; oncoming
    // cars show headlights, receding cars show taillights — and all of it reflects
    // in the wet road for free via the Phase 1 planar reflector.
    // ─────────────────────────────────────────────────────────────────────────
    createGroundTraffic() {
        if (this.featureFlags?.noGroundTraffic || this.featureFlags?.noVehicles) return;
        if (this.groundCarInstances) return;

        const countMap = {
            Extreme: 26, Ultra: 18, High: 12, Medium: 6, Low: 3, Minimal: 0,
        };
        const count = countMap[this.currentQualityName] ?? 8;
        if (count <= 0) return;

        // ── Shared geometry ──────────────────────────────────────────────────
        // Sleek low-poly "spinner"-style body: low+wide chassis, a raised mid
        // shoulder, a tapered nose and a small rear deck/spoiler — merged into one
        // mesh. Forward = +Z. (Research: low-poly cyberpunk cars read best with a
        // low wedge silhouette, defined wheels, and a glass greenhouse.)
        // Origin sits on the road (y=0); wheels (r=1.8) touch the ground.
        const chassis = new THREE.BoxGeometry(9.6, 2.4, 25);
        chassis.translate(0, 2.4, 0);
        const shoulder = new THREE.BoxGeometry(9.2, 1.5, 17);
        shoulder.translate(0, 3.9, -0.5);
        const nose = new THREE.BoxGeometry(7.4, 1.3, 6);
        nose.translate(0, 2.2, 11.0);
        const rearDeck = new THREE.BoxGeometry(9.0, 1.1, 5.5);
        rearDeck.translate(0, 3.95, -10.5);
        const spoiler = new THREE.BoxGeometry(9.4, 0.35, 1.3);
        spoiler.translate(0, 4.75, -12.6);
        const bodyGeo = mergeGeometries([chassis, shoulder, nose, rearDeck, spoiler]);

        // Glass greenhouse — a flattened half-dome (sleeker than a box cabin).
        const canopyGeo = new THREE.SphereGeometry(1, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2);
        canopyGeo.scale(4.0, 2.0, 5.2);
        canopyGeo.translate(0, 3.9, -0.5);

        // Wheel — cylinder laid on its side (axis along X so it rolls along Z).
        const wheelGeo = new THREE.CylinderGeometry(1.8, 1.8, 1.6, 14);
        wheelGeo.rotateZ(Math.PI / 2);

        const headGeo = new THREE.CircleGeometry(1.05, 10);          // faces +Z (front)
        const tailGeo = new THREE.CircleGeometry(0.95, 10);
        tailGeo.rotateY(Math.PI);                                    // faces -Z (rear)
        const glowGeo = new THREE.PlaneGeometry(16, 32);
        glowGeo.rotateX(-Math.PI / 2);                               // flat on the road

        // ── Shared materials (node, MRT-safe) ────────────────────────────────
        // Glossy car paint: clearcoat over a metallic base so it mirrors the neon
        // city. White base × per-car instanceColor (set below) = varied paint.
        const bodyMat = new THREE.MeshPhysicalNodeMaterial({
            color: 0xffffff, roughness: 0.32, metalness: 0.55,
            clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.1,
        });
        bodyMat.emissiveNode = vec3(0.0, 0.0, 0.0);

        // Dark tinted reflective glass for the greenhouse.
        const canopyMat = new THREE.MeshPhysicalNodeMaterial({
            color: 0x04060c, roughness: 0.07, metalness: 0.5,
            clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.4,
        });
        canopyMat.emissiveNode = this.colorToVec3(0x0a1830).mul(float(0.25));

        // Matte dark tyres.
        const wheelMat = new THREE.MeshStandardNodeMaterial({
            color: 0x0a0a0e, roughness: 0.75, metalness: 0.15,
        });
        wheelMat.emissiveNode = vec3(0.0, 0.0, 0.0);

        const headMat = new THREE.MeshBasicNodeMaterial({
            color: 0xfff2d2, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        headMat.emissiveNode = this.colorToVec3(0xfff2d2).mul(float(1.6));

        const tailMat = new THREE.MeshBasicNodeMaterial({
            color: 0xff2233, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        tailMat.emissiveNode = this.colorToVec3(0xff2233).mul(float(1.2));

        // Soft radial light pool (not a hard rectangle) via a UV falloff.
        const glowMat = new THREE.MeshBasicNodeMaterial({
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const gFall = smoothstep(1.0, 0.0, uv().sub(0.5).length().mul(2.0));
        const gColor = this.colorToVec3(0x6fb4ff).mul(gFall);
        glowMat.colorNode = gColor;
        glowMat.opacityNode = gFall.mul(float(0.34));
        glowMat.emissiveNode = gColor.mul(float(0.5));

        // AAA 6d — volumetric headlight beam cone, additive, fading along its
        // length so it reads as headlights cutting through the fog. Heavier fill,
        // so gated to Ultra/Extreme (or ?ndHeadlightCones to force).
        this.groundConesEnabled = (this.currentQualityName === 'Ultra'
            || this.currentQualityName === 'Extreme'
            || this.featureFlags?.forceHeadlightCones)
            && !this.featureFlags?.noHeadlightCones;
        let coneGeo = null;
        let coneMat = null;
        if (this.groundConesEnabled) {
            coneGeo = new THREE.ConeGeometry(3.4, 22, 18, 1, true);
            coneGeo.translate(0, 11, 0);          // apex → origin (the headlight)
            coneGeo.rotateX(-Math.PI / 2);        // widen toward +Z (forward)
            coneMat = new THREE.MeshBasicNodeMaterial({
                transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            });
            const beamZ = positionLocal.z.div(22.0).max(0.0).min(1.0); // 0 at car → 1 far
            const beam = float(1.0).sub(beamZ).pow(1.6).mul(smoothstep(0.0, 0.05, beamZ));
            const beamCol = vec3(1.0, 0.92, 0.72);
            coneMat.colorNode = beamCol.mul(beam);
            coneMat.opacityNode = beam.mul(float(0.16));
            coneMat.emissiveNode = beamCol.mul(beam).mul(float(0.4));
        }

        const mk = (geo, mat, n) => {
            const m = new THREE.InstancedMesh(geo, mat, n);
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.frustumCulled = false;
            m.renderOrder = 1;
            this.scene.add(m);
            return m;
        };

        this.groundCarInstances = {
            body: mk(bodyGeo, bodyMat, count),
            canopy: mk(canopyGeo, canopyMat, count),
            wheel: mk(wheelGeo, wheelMat, count * 4),
            head: mk(headGeo, headMat, count * 2),
            tail: mk(tailGeo, tailMat, count * 2),
            glow: mk(glowGeo, glowMat, count),
            ...(this.groundConesEnabled ? { cone: mk(coneGeo, coneMat, count) } : {}),
        };

        // Per-car paint: mostly dark metallics, a vivid cyberpunk minority.
        const paints = [
            0x14151c, 0x101018, 0x1a1420, 0x0e1418, 0x181018, // dark (×5 weight)
            0xb3186d, 0x1f9ad6, 0x18b39a, 0x7a2dd6, 0xd64b2d, // neon (magenta/cyan/teal/violet/orange)
        ];
        const _paint = new THREE.Color();
        for (let i = 0; i < count; i++) {
            const hex = Math.random() < 0.62
                ? paints[Math.floor(Math.random() * 5)]            // dark
                : paints[5 + Math.floor(Math.random() * 5)];       // neon
            _paint.setHex(hex);
            this.groundCarInstances.body.setColorAt(i, _paint);
        }
        if (this.groundCarInstances.body.instanceColor) {
            this.groundCarInstances.body.instanceColor.needsUpdate = true;
        }

        this.groundCarDummy = new THREE.Object3D();
        this.groundCarLightDummy = new THREE.Object3D();
        this._groundCarV = new THREE.Vector3();

        // ── Lanes: two oncoming (travel +Z), two receding (travel -Z) ─────────
        const lanes = [
            { x: -56, dir: 1 }, { x: -22, dir: 1 },
            { x: 22, dir: -1 }, { x: 56, dir: -1 },
        ];
        this.groundCarRange = { min: -2500, max: 130 };
        this.groundCarMinGap = 46;          // car length (~25) + buffer; no overlap
        this.groundCarLanes = lanes.map(() => []); // car indices grouped per lane
        // Keep cars well inside the ~±90 street corridor (buildings start at ±140).
        const laneClamp = 80;
        this.groundCarData = [];
        const span = this.groundCarRange.max - this.groundCarRange.min;
        for (let i = 0; i < count; i++) {
            const laneId = i % lanes.length;
            const lane = lanes[laneId];
            const x = Math.max(-laneClamp, Math.min(laneClamp, lane.x + (Math.random() - 0.5) * 7));
            this.groundCarData.push({
                x,
                z: this.groundCarRange.min + Math.random() * span,
                dir: lane.dir,
                speed: 55 + Math.random() * 75,
                scale: 0.9 + Math.random() * 0.35,
                laneId,
            });
            this.groundCarLanes[laneId].push(i);
        }

        this.updateGroundTraffic(0); // seed transforms before first render
        console.log(`[NeonDistrict] Ground traffic created (${count} cars)`);
    }

    updateGroundTraffic(delta) {
        const inst = this.groundCarInstances;
        const data = this.groundCarData;
        if (!inst || !data) return;

        const dummy = this.groundCarDummy;
        const light = this.groundCarLightDummy;
        const v = this._groundCarV;
        const { min, max } = this.groundCarRange;
        const span = max - min;
        const minGap = this.groundCarMinGap ?? 46;

        // ── Pass 1: advance + wrap ───────────────────────────────────────────
        for (let i = 0; i < data.length; i++) {
            const car = data[i];
            car.z += car.dir * car.speed * delta;
            if (car.dir > 0 && car.z > max) car.z -= span;
            else if (car.dir < 0 && car.z < min) car.z += span;
        }

        // ── Pass 2: per-lane car-following (no overtaking / no overlap) ───────
        // Forward coordinate f = dir·z (larger = further ahead). Sort each lane
        // front-to-back and clamp every car to stay ≥ minGap behind the one ahead.
        const laneGroups = this.groundCarLanes;
        if (laneGroups) {
            for (let L = 0; L < laneGroups.length; L++) {
                const lane = laneGroups[L];
                if (lane.length < 2) continue;
                lane.sort((a, b) => (data[b].dir * data[b].z) - (data[a].dir * data[a].z));
                for (let k = 1; k < lane.length; k++) {
                    const ahead = data[lane[k - 1]];
                    const cur = data[lane[k]];
                    const maxF = ahead.dir * ahead.z - minGap;
                    if (cur.dir * cur.z > maxF) {
                        cur.z = maxF * cur.dir; // dir = ±1 → z = f·dir
                    }
                }
            }
        }

        // ── Pass 3: build instance transforms ────────────────────────────────
        for (let i = 0; i < data.length; i++) {
            const car = data[i];
            const rotY = car.dir > 0 ? 0 : Math.PI;
            dummy.position.set(car.x, 0, car.z); // origin on the road
            dummy.rotation.set(0, rotY, 0);
            dummy.scale.setScalar(car.scale);
            dummy.updateMatrix();
            dummy.updateMatrixWorld(true);
            inst.body.setMatrixAt(i, dummy.matrix);
            inst.canopy.setMatrixAt(i, dummy.matrix); // greenhouse baked at cabin offset

            // Underglow pool on the road, centred under the car.
            light.position.set(car.x, 0.35, car.z);
            light.rotation.set(0, 0, 0);
            light.scale.setScalar(car.scale);
            light.updateMatrix();
            inst.glow.setMatrixAt(i, light.matrix);

            // Parts placed in the car's local frame (wheels, lights).
            const place = (mesh, idx, lx, ly, lz, faceRot) => {
                v.set(lx, ly, lz);
                dummy.localToWorld(v);
                light.position.copy(v);
                light.rotation.set(0, rotY + faceRot, 0);
                light.scale.setScalar(car.scale);
                light.updateMatrix();
                mesh.setMatrixAt(idx, light.matrix);
            };
            // Four wheels (r=1.8 → centre y=1.8 touches road).
            place(inst.wheel, i * 4, -4.6, 1.8, 7.6, 0);
            place(inst.wheel, i * 4 + 1, 4.6, 1.8, 7.6, 0);
            place(inst.wheel, i * 4 + 2, -4.6, 1.8, -7.6, 0);
            place(inst.wheel, i * 4 + 3, 4.6, 1.8, -7.6, 0);
            // Head/tail light pairs.
            place(inst.head, i * 2, -3.0, 2.3, 13.6, 0);
            place(inst.head, i * 2 + 1, 3.0, 2.3, 13.6, 0);
            place(inst.tail, i * 2, -3.3, 3.1, -13.0, 0);
            place(inst.tail, i * 2 + 1, 3.3, 3.1, -13.0, 0);
            // Headlight beam cone projecting forward from the front (6d).
            if (inst.cone) place(inst.cone, i, 0, 2.2, 13.0, 0);
        }

        inst.body.instanceMatrix.needsUpdate = true;
        inst.canopy.instanceMatrix.needsUpdate = true;
        inst.wheel.instanceMatrix.needsUpdate = true;
        inst.head.instanceMatrix.needsUpdate = true;
        inst.tail.instanceMatrix.needsUpdate = true;
        inst.glow.instanceMatrix.needsUpdate = true;
        if (inst.cone) inst.cone.instanceMatrix.needsUpdate = true;
    }

    enableVehicleGpuInstancing(count) {
        if (!this.vehicleInstances || !this.vehicleData?.length) return false;

        const profileValue = (profile) => {
            if (profile === 'high') return 2;
            if (profile === 'mid') return 1;
            return 0;
        };

        const singleCount = count;
        const doubleCount = count * 2;

        const flight0 = new Float32Array(singleCount * 4);
        const flight1 = new Float32Array(singleCount * 4);
        const flight2 = new Float32Array(singleCount * 4);
        const flight3Body = new Float32Array(singleCount * 4);
        const flight3Canopy = new Float32Array(singleCount * 4);

        const flight0_2 = new Float32Array(doubleCount * 4);
        const flight1_2 = new Float32Array(doubleCount * 4);
        const flight2_2 = new Float32Array(doubleCount * 4);
        const flight3Engine = new Float32Array(doubleCount * 4);
        const flight3Headlight = new Float32Array(doubleCount * 4);
        const flight3Tail = new Float32Array(doubleCount * 4);
        const flight3Exhaust = new Float32Array(doubleCount * 4);

        const exhaustMaskCyan = new Float32Array(doubleCount);
        const exhaustMaskOrange = new Float32Array(doubleCount);

        const setVec4 = (array, index, x, y, z, w) => {
            const i = index * 4;
            array[i] = x;
            array[i + 1] = y;
            array[i + 2] = z;
            array[i + 3] = w;
        };

        for (let i = 0; i < count; i++) {
            const data = this.vehicleData[i];
            const headingValue = Math.atan2(data.dirX ?? 0, data.dirZ ?? 1);
            const profile = profileValue(data.wobbleProfile || (data.lane <= 1 ? 'low' : (data.lane <= 3 ? 'mid' : 'high')));
            const bank = data.lane > 1 ? (data.lane === 4 ? 0.05 : 0.2) : 0.0;
            const wrap = data.wrapRange || this.vehicleRange || 2500;
            const multiDirection = data.multiDirection ? 1 : 0;
            const dirX = data.dirX ?? 0;
            const dirZ = data.dirZ ?? 1;

            setVec4(flight0, i, data.x, data.y, data.z, data.speed);
            setVec4(flight1, i, dirX, dirZ, data.wobbleX, data.wobbleOffset);
            setVec4(flight2, i, profile, bank, wrap, multiDirection);
            setVec4(flight3Body, i, 0, 0, 0, headingValue);
            setVec4(flight3Canopy, i, 0, 2, 3, headingValue);

            const leftIndex = i * 2;
            const rightIndex = leftIndex + 1;

            for (let j = 0; j < 2; j++) {
                const targetIndex = leftIndex + j;
                setVec4(flight0_2, targetIndex, data.x, data.y, data.z, data.speed);
                setVec4(flight1_2, targetIndex, dirX, dirZ, data.wobbleX, data.wobbleOffset);
                setVec4(flight2_2, targetIndex, profile, bank, wrap, multiDirection);
            }

            setVec4(flight3Engine, leftIndex, -6, -1, -2, headingValue);
            setVec4(flight3Engine, rightIndex, 6, -1, -2, headingValue);
            setVec4(flight3Headlight, leftIndex, -3, 0, 10, headingValue);
            setVec4(flight3Headlight, rightIndex, 3, 0, 10, headingValue);
            setVec4(flight3Tail, leftIndex, -3, 0, -10, headingValue);
            setVec4(flight3Tail, rightIndex, 3, 0, -10, headingValue);
            setVec4(flight3Exhaust, leftIndex, -6, -1, -6, headingValue);
            setVec4(flight3Exhaust, rightIndex, 6, -1, -6, headingValue);

            const isCyan = data.exhaustType === 'cyan';
            const cyanValue = isCyan ? 1 : 0;
            const orangeValue = isCyan ? 0 : 1;
            exhaustMaskCyan[leftIndex] = cyanValue;
            exhaustMaskCyan[rightIndex] = cyanValue;
            exhaustMaskOrange[leftIndex] = orangeValue;
            exhaustMaskOrange[rightIndex] = orangeValue;
        }

        const applyAttributes = (mesh, data, isDouble) => {
            const geometry = mesh.geometry;
            geometry.setAttribute('aFlight0', new THREE.InstancedBufferAttribute(data.flight0, 4));
            geometry.setAttribute('aFlight1', new THREE.InstancedBufferAttribute(data.flight1, 4));
            geometry.setAttribute('aFlight2', new THREE.InstancedBufferAttribute(data.flight2, 4));
            geometry.setAttribute('aFlight3', new THREE.InstancedBufferAttribute(data.flight3, 4));
            geometry.attributes.aFlight0.needsUpdate = true;
            geometry.attributes.aFlight1.needsUpdate = true;
            geometry.attributes.aFlight2.needsUpdate = true;
            geometry.attributes.aFlight3.needsUpdate = true;

            if (mesh.instanceMatrix) {
                mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
                mesh.frustumCulled = false;
                const identity = this._vehicleIdentityMatrix || (this._vehicleIdentityMatrix = new THREE.Matrix4());
                const meshCount = mesh.count ?? (isDouble ? doubleCount : singleCount);
                for (let i = 0; i < meshCount; i++) {
                    mesh.setMatrixAt(i, identity);
                }
                mesh.instanceMatrix.needsUpdate = true;
            } else if (mesh.geometry?.instanceCount === undefined) {
                mesh.geometry.instanceCount = isDouble ? doubleCount : singleCount;
            }
        };

        const singleDataBody = {
            flight0,
            flight1,
            flight2,
            flight3: flight3Body,
        };
        const singleDataCanopy = {
            flight0,
            flight1,
            flight2,
            flight3: flight3Canopy,
        };
        const doubleDataEngine = {
            flight0: flight0_2,
            flight1: flight1_2,
            flight2: flight2_2,
            flight3: flight3Engine,
        };
        const doubleDataHeadlight = {
            flight0: flight0_2,
            flight1: flight1_2,
            flight2: flight2_2,
            flight3: flight3Headlight,
        };
        const doubleDataTail = {
            flight0: flight0_2,
            flight1: flight1_2,
            flight2: flight2_2,
            flight3: flight3Tail,
        };
        const doubleDataExhaust = {
            flight0: flight0_2,
            flight1: flight1_2,
            flight2: flight2_2,
            flight3: flight3Exhaust,
        };

        const { positionNode, normalNode } = this.getVehicleNodeTransforms();
        const applyNodes = (material) => {
            if (!material) return;
            material.positionNode = positionNode;
            material.normalNode = normalNode;
            material.needsUpdate = true;
        };

        const resources = this.spinnerResources;
        applyNodes(resources?.bodyMaterial);
        applyNodes(resources?.canopyMaterial);
        applyNodes(resources?.engineMaterial);
        applyNodes(resources?.exhaustCyanMaterial);
        applyNodes(resources?.exhaustOrangeMaterial);
        applyNodes(resources?.headlightMaterial);
        applyNodes(resources?.tailMaterial);

        const exhaustMaskNode = attribute('aExhaustMask');
        const exhaustOpacity = float(0.9);
        if (resources?.exhaustCyanMaterial) {
            resources.exhaustCyanMaterial.opacityNode = exhaustMaskNode.mul(exhaustOpacity);
            resources.exhaustCyanMaterial.needsUpdate = true;
        }
        if (resources?.exhaustOrangeMaterial) {
            resources.exhaustOrangeMaterial.opacityNode = exhaustMaskNode.mul(exhaustOpacity);
            resources.exhaustOrangeMaterial.needsUpdate = true;
        }

        applyAttributes(this.vehicleInstances.body, singleDataBody, false);
        applyAttributes(this.vehicleInstances.canopy, singleDataCanopy, false);
        applyAttributes(this.vehicleInstances.engine, doubleDataEngine, true);
        applyAttributes(this.vehicleInstances.headlight, doubleDataHeadlight, true);
        applyAttributes(this.vehicleInstances.tailLight, doubleDataTail, true);
        applyAttributes(this.vehicleInstances.exhaustCyan, doubleDataExhaust, true);
        applyAttributes(this.vehicleInstances.exhaustOrange, doubleDataExhaust, true);

        this.vehicleInstances.exhaustCyan.geometry.setAttribute(
            'aExhaustMask',
            new THREE.InstancedBufferAttribute(exhaustMaskCyan, 1),
        );
        this.vehicleInstances.exhaustOrange.geometry.setAttribute(
            'aExhaustMask',
            new THREE.InstancedBufferAttribute(exhaustMaskOrange, 1),
        );
        this.vehicleInstances.exhaustCyan.geometry.attributes.aExhaustMask.needsUpdate = true;
        this.vehicleInstances.exhaustOrange.geometry.attributes.aExhaustMask.needsUpdate = true;

        this.vehicleGPUDriven = true;
        return true;
    }

    // OPTIMIZED: InstancedMesh for Flying Vehicles
    createFlyingVehicles() {
        // Use Quality Preset
        const count = this.qualityPreset.flyingVehicles;
        if (count <= 0) return;

        this.buildFlightCollisionBounds();

        const altitudeBands = [
            {
                xRange: 90, yMin: 40, yMax: 220, wobbleX: 20, profile: 'low', weight: 2,
            },
            {
                xRange: 260, yMin: 200, yMax: 520, wobbleX: 30, profile: 'low', weight: 2,
            },
            {
                xRange: 260, yMin: 520, yMax: 820, wobbleX: 38, profile: 'mid', weight: 2,
            },
            {
                xRange: 600, yMin: 450, yMax: 850, wobbleX: 45, profile: 'mid', weight: 3,
            },
            {
                xRange: 1000, yMin: 700, yMax: 1200, wobbleX: 70, profile: 'mid', weight: 2,
            },
            {
                xRange: 1700, yMin: 1000, yMax: 1700, wobbleX: 120, profile: 'high', weight: 2,
            },
            {
                xRange: 2600, yMin: 1500, yMax: 2400, wobbleX: 180, profile: 'high', weight: 1,
            },
            {
                xRange: 3500, yMin: 2000, yMax: 3000, wobbleX: 220, profile: 'high', weight: 1,
            },
        ];

        const totalWeight = altitudeBands.reduce((sum, band) => sum + band.weight, 0);
        const pickAltitudeBand = () => {
            let roll = Math.random() * totalWeight;
            for (let i = 0; i < altitudeBands.length; i++) {
                roll -= altitudeBands[i].weight;
                if (roll <= 0) return altitudeBands[i];
            }
            return altitudeBands[altitudeBands.length - 1];
        };

        this.initSpinnerResources();
        const r = this.spinnerResources;

        // Create Instance Meshes
        // We use one InstancedMesh per material/geometry type
        const useGpuInstances = this.isWebGPU;
        const createInst = (geom, mat, limit) => {
            if (useGpuInstances) {
                const instancedGeometry = new THREE.InstancedBufferGeometry().copy(geom);
                instancedGeometry.instanceCount = limit;
                const mesh = new THREE.Mesh(instancedGeometry, mat);
                mesh.frustumCulled = false;
                this.scene.add(mesh);
                return mesh;
            }

            const mesh = new THREE.InstancedMesh(geom, mat, limit);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.scene.add(mesh);
            return mesh;
        };

        this.vehicleInstances = {
            body: createInst(r.bodyGeometry, r.bodyMaterial, count),
            canopy: createInst(r.canopyGeometry, r.canopyMaterial, count),
            engine: createInst(r.engineGeometry, r.engineMaterial, count * 2), // 2 per car
            exhaustCyan: createInst(r.exhaustCyanGeometry, r.exhaustCyanMaterial, count * 2),
            exhaustOrange: createInst(r.exhaustOrangeGeometry, r.exhaustOrangeMaterial, count * 2),
            headlight: createInst(r.headlightGeometry, r.headlightMaterial, count * 2),
            tailLight: createInst(r.tailGeometry, r.tailMaterial, count * 2),
        };

        // Data array to store state
        this.vehicleData = [];
        this.vehicleHelper = new THREE.Object3D(); // Reuse for matrix calc

        for (let i = 0; i < count; i++) {
            // STATE Logic (Lane, Speed, etc)
            // 5 LAYERS OF TRAFFIC
            const lane = i % 5;
            let x; let y; let
                z;
            const altitudeBand = pickAltitudeBand();

            const clearPos = this.getClearFlightPosition(
                { min: -altitudeBand.xRange, max: altitudeBand.xRange },
                { min: altitudeBand.yMin, max: altitudeBand.yMax },
                altitudeBand.wobbleX,
            );
            x = clearPos.x;
            y = clearPos.y;

            const allowMultiDirection = altitudeBand.profile === 'high' && Math.random() > 0.3;
            const baseRange = this.vehicleRange || 2500;
            const wrapRange = allowMultiDirection ? baseRange * 1.4 : baseRange;

            z = (Math.random() - 0.5) * (allowMultiDirection ? wrapRange * 2 : 5000); // Wider Z spread
            let dirX = 0;
            let dirZ = (i % 2 === 0) ? 1 : -1;
            if (allowMultiDirection) {
                const headings = [
                    0,
                    Math.PI / 2,
                    Math.PI,
                    -Math.PI / 2,
                    Math.PI / 4,
                    -Math.PI / 4,
                    (3 * Math.PI) / 4,
                    (-3 * Math.PI) / 4,
                ];
                const baseHeading = headings[Math.floor(Math.random() * headings.length)];
                const heading = baseHeading + (Math.random() - 0.5) * 0.3;
                dirX = Math.sin(heading);
                dirZ = Math.cos(heading);
            }

            // Higher layers move faster
            let speedBase = 120;
            let speedVariance = 100;
            if (lane === 3) {
                speedBase = 220;
                speedVariance = 80;
            }
            if (lane === 4) {
                speedBase = 320; // Reduced max speed for fastest lane
                speedVariance = 60;
            }

            const speed = speedBase + Math.random() * speedVariance;
            const wobbleOffset = Math.random() * 100;

            // Assign exhaust color (Cyan or Orange)
            const exhaustType = Math.random() > 0.5 ? 'cyan' : 'orange';

            this.vehicleData.push({
                x,
                y,
                z,
                dirX,
                dirZ,
                speed,
                lane,
                wobbleOffset,
                exhaustType,
                wobbleX: altitudeBand.wobbleX,
                wobbleProfile: altitudeBand.profile,
                multiDirection: allowMultiDirection,
                wrapRange: allowMultiDirection ? wrapRange : this.vehicleRange,
            });
        }

        console.log(`[NeonDistrict] Created ${count} flying vehicles across 5 layers`);

        const gpuEnabled = this.isWebGPU && this.enableVehicleGpuInstancing(count);
        if (!gpuEnabled && this.vehicleInstances?.body?.isInstancedMesh) {
            // Initial update to place them (CPU fallback)
            this.updateFlyingVehicles(0);
        }
    }

    /**
     * Initialize shared geometries and materials for spinners (called once)
     */
    initSpinnerResources() {
        if (this.spinnerResources) return;

        // Sleeker spinner hull (merged): tapered nose, raised mid, flat belly, short
        // tail. Kept ~20 long (z ±10) / ~8 wide / ~4 tall so the engine, light and
        // canopy offsets baked into the GPU flight attributes still line up.
        const sBelly = new THREE.BoxGeometry(7.4, 1.7, 18);
        sBelly.translate(0, -0.7, 0);
        const sMid = new THREE.BoxGeometry(7.0, 2.0, 13);
        sMid.translate(0, 0.8, -0.5);
        const sNose = new THREE.BoxGeometry(4.4, 1.5, 6);
        sNose.translate(0, 0.0, 8.4);
        const sTail = new THREE.BoxGeometry(6.0, 1.7, 4);
        sTail.translate(0, 0.4, -8.6);
        const bodyGeometry = mergeGeometries([sBelly, sMid, sNose, sTail]);

        this.spinnerResources = {
            // Geometries (shared across all spinners)
            bodyGeometry,
            canopyGeometry: new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            engineGeometry: new THREE.CylinderGeometry(2, 1.4, 8, 10),
            exhaustCyanGeometry: new THREE.CircleGeometry(2.4, 12),
            exhaustOrangeGeometry: new THREE.CircleGeometry(2.4, 12),
            headlightGeometry: new THREE.CircleGeometry(1.2, 10),
            tailGeometry: new THREE.CircleGeometry(0.95, 10),
            navGeometry: new THREE.SphereGeometry(0.5, 6, 6),

            // Materials (shared across all spinners) — glossy reflective hull.
            bodyMaterial: new THREE.MeshStandardNodeMaterial({
                color: 0x1c1d28,
                roughness: 0.22,
                metalness: 0.78,
                emissive: 0x0a0b16,
                emissiveIntensity: 0.3,
            }),
            // Dark tinted glass greenhouse with a faintly lit cockpit.
            canopyMaterial: new THREE.MeshStandardNodeMaterial({
                color: 0x06080f,
                roughness: 0.06,
                metalness: 0.55,
                transparent: true,
                opacity: 0.6,
            }),
            engineMaterial: new THREE.MeshStandardNodeMaterial({
                color: 0x282834,
                roughness: 0.26,
                metalness: 0.82,
            }),
            exhaustCyanMaterial: new THREE.MeshBasicNodeMaterial({
                color: 0x33ffff,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
            }),
            exhaustOrangeMaterial: new THREE.MeshBasicNodeMaterial({
                color: 0xff7a1a,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
            }),
            headlightMaterial: new THREE.MeshBasicNodeMaterial({
                color: 0xfff2cc,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
            }),
            tailMaterial: new THREE.MeshBasicNodeMaterial({
                color: 0xff0033,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
            }),
            navMaterial: new THREE.MeshBasicNodeMaterial({ color: 0x00ff00 }),
        };

        // Ensure emissive outputs for MRT
        this.spinnerResources.bodyMaterial.emissiveNode = this.makeEmissiveNode(0x0a0b16, 0.3);
        // Faint cyan interior glow read through the tinted glass.
        this.spinnerResources.canopyMaterial.emissiveNode = this.colorToVec3(0x123a5c).mul(float(0.5));
        this.spinnerResources.engineMaterial.emissiveNode = vec3(0.0, 0.0, 0.0);
        this.spinnerResources.exhaustCyanMaterial.emissiveNode = this.colorToVec3(0x33ffff).mul(float(1.6));
        this.spinnerResources.exhaustOrangeMaterial.emissiveNode = this.colorToVec3(0xff7a1a).mul(float(1.6));
        this.spinnerResources.headlightMaterial.emissiveNode = this.colorToVec3(0xfff2cc).mul(float(1.4));
        this.spinnerResources.tailMaterial.emissiveNode = this.colorToVec3(0xff0033).mul(float(1.2));
        this.spinnerResources.navMaterial.emissiveNode = this.colorToVec3(0x00ff00);

        this.spinnerResources.canopyGeometry.rotateX(Math.PI);
        this.spinnerResources.engineGeometry.rotateX(Math.PI / 2);
        this.spinnerResources.tailGeometry.rotateY(Math.PI);
    }

    // Cyberpunk Spinner - detailed flying vehicle (uses shared resources)

    updateGroundReflections() {
        if (!this.groundUniforms) return;

        // PERF: Cache arrays to avoid allocation per call (Phase 0 optimization)
        if (!this._groundReflectionPositions) {
            this._groundReflectionPositions = [];
            this._groundReflectionColors = [];
            this._groundReflectionWorldPos = new THREE.Vector3();
            for (let i = 0; i < 8; i++) {
                this._groundReflectionPositions.push(new THREE.Vector3());
                this._groundReflectionColors.push(new THREE.Color());
            }
        }

        // Collect all neon signs with lights, sorted by Z (closer to camera first)
        const activeSigns = this.neonSigns
            .filter((s) => s.userData.light && s.userData.baseColor)
            .sort((a, b) => b.position.z - a.position.z)
            .slice(0, 8);

        const positions = this._groundReflectionPositions;
        const colors = this._groundReflectionColors;

        for (let i = 0; i < 8; i++) {
            if (i < activeSigns.length) {
                const sign = activeSigns[i];
                // Get WORLD position of the sign (not local)
                sign.getWorldPosition(positions[i]);

                // Boost color brightness for more visible reflections
                colors[i].set(sign.userData.baseColor || 0xffffff);
            } else {
                positions[i].set(0, 1000, 0);
                colors[i].set(0x000000);
            }
        }

        this.groundUniforms.uLightPositions.value = positions;
        this.groundUniforms.uLightColors.value = colors;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Create PURPLE NEON environment map procedurally (no golden HDR)
        this.createPurpleEnvironmentMap();
        // Add scene lights
        this.setupSceneLighting();
    }

    createPurpleEnvironmentMap() {
        // Create a purple/cyan gradient cube map for neon reflections
        const size = 128;

        const createFace = (topColor, bottomColor) => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, size);
            gradient.addColorStop(0, topColor);
            gradient.addColorStop(0.5, '#330066');
            gradient.addColorStop(1, bottomColor);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);

            // Add some neon spots
            for (let i = 0; i < 8; i++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const r = 5 + Math.random() * 15;
                const spotGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
                const colors = ['#ff00ff', '#00ffff', '#aa00ff', '#ff00aa'];
                spotGrad.addColorStop(0, colors[i % 4]);
                spotGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = spotGrad;
                ctx.fillRect(0, 0, size, size);
            }

            return canvas;
        };

        // Create 6 faces of cube map with purple/cyan neon colors
        const faces = [
            createFace('#ff00ff', '#00ffff'), // +x (right)
            createFace('#aa00ff', '#00ff88'), // -x (left)
            createFace('#8800ff', '#330066'), // +y (top)
            createFace('#330066', '#110022'), // -y (bottom)
            createFace('#ff00aa', '#0088ff'), // +z (front)
            createFace('#00ffff', '#ff00ff'), // -z (back)
        ];

        const cubeTexture = new THREE.CubeTexture(faces);
        cubeTexture.needsUpdate = true;

        // Process for PBR reflections
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        const envMap = pmremGenerator.fromCubemap(cubeTexture).texture;

        this.scene.environment = envMap;

        // Apply env map to ground for wet reflections
        if (this.groundMaterial) {
            this.groundMaterial.envMap = envMap;
            // Balanced intensity - reflections visible but asphalt stays dark
            this.groundMaterial.envMapIntensity = 0.9;
            this.groundMaterial.needsUpdate = true;
        }

        pmremGenerator.dispose();
        this.proceduralEnvMap = envMap;
        console.log('[NeonDistrict] Purple neon environment map created');

        // AAA PHASE 1b: asynchronously upgrade to a real (tinted) city HDRI so the
        // wet street reflects an actual skyline at grazing angles / off-screen, where
        // the planar reflector can't reach. The procedural cube above stays as the
        // instant + WebGL fallback.
        this.upgradeEnvironmentToHDR();
    }

    /**
     * AAA Phase 1b — Replace the procedural 128px purple cube environment with the
     * real shanghai_bund HDRI, tinted cool/purple and darkened so it matches the
     * cyberpunk palette instead of its native warm-golden look. Non-blocking; on any
     * failure (or ?ndNoHdrEnv / non-WebGPU) the procedural env is kept.
     */
    upgradeEnvironmentToHDR() {
        if (!this.isWebGPU) return;
        if (this.featureFlags?.noHdrEnv) return;
        if (typeof HDRLoader !== 'function') return;

        const loader = new HDRLoader();
        loader.setDataType(THREE.FloatType); // float RGBA so we can tint the pixels
        loader.load(
            './textures/neon-district/shanghai_bund_2k.hdr',
            (texture) => {
                if (!this.isActive || !this.scene || !this.renderer) {
                    texture?.dispose?.();
                    return;
                }
                let pmrem = null;
                try {
                    // Tint toward cool cyberpunk purple + darken (HDR is warm by default)
                    const data = texture.image?.data;
                    if (data && data.length) {
                        const rMul = 0.55;
                        const gMul = 0.48;
                        const bMul = 0.95;
                        const exposure = 0.8;
                        for (let i = 0; i < data.length; i += 4) {
                            data[i] *= rMul * exposure;
                            data[i + 1] *= gMul * exposure;
                            data[i + 2] *= bMul * exposure;
                        }
                        texture.needsUpdate = true;
                    }

                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    pmrem = new THREE.PMREMGenerator(this.renderer);
                    pmrem.compileEquirectangularShader();
                    const hdrEnv = pmrem.fromEquirectangular(texture).texture;

                    const previousEnv = this.scene.environment;
                    this.scene.environment = hdrEnv;
                    this.hdrEnvMap = hdrEnv;

                    if (this.groundMaterial) {
                        this.groundMaterial.envMap = hdrEnv;
                        this.groundMaterial.envMapIntensity = 0.7;
                        this.groundMaterial.needsUpdate = true;
                    }

                    // Dispose the now-unused procedural cube PMREM
                    if (previousEnv && previousEnv === this.proceduralEnvMap && previousEnv.dispose) {
                        previousEnv.dispose();
                        this.proceduralEnvMap = null;
                    }
                    console.log('[NeonDistrict] HDR environment applied (tinted purple)');
                } catch (e) {
                    console.warn('[NeonDistrict] HDR env upgrade failed, keeping procedural env:', e);
                } finally {
                    texture?.dispose?.();
                    pmrem?.dispose?.();
                }
            },
            undefined,
            (err) => {
                console.warn('[NeonDistrict] HDR env load failed, keeping procedural env:', err);
            },
        );
    }

    setupSceneLighting() {
        // ═══════════════════════════════════════════════════════════════════════════
        // SCENE LIGHTING - Night with visible buildings
        // ═══════════════════════════════════════════════════════════════════════════

        const isWebGPU = this.isWebGPU;
        // Ambient light - balanced for dark but reflective scene
        const ambientLight = new THREE.AmbientLight(0x334466, isWebGPU ? 0.3 : 0.35);
        this.scene.add(ambientLight);

        // Main directional light - Top-down Moonlight (softer shadows)
        const dirLight = new THREE.DirectionalLight(0xaaccff, 0.8);
        dirLight.position.set(100, 500, 100); // High up to avoid blocking view with shadows

        // Enable shadow casting
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 4096; // High res for sharp building edges
        dirLight.shadow.mapSize.height = 4096;

        // Shadow camera frustum - covers the street area
        dirLight.shadow.camera.near = 10;
        dirLight.shadow.camera.far = 1500;
        dirLight.shadow.camera.left = -800;
        dirLight.shadow.camera.right = 800;
        dirLight.shadow.camera.top = 800;
        dirLight.shadow.camera.bottom = -800;

        // Soft shadow settings
        dirLight.shadow.bias = -0.0005;
        dirLight.shadow.normalBias = 0.05; // Prevent acne

        this.scene.add(dirLight);
        this.mainShadowLight = dirLight; // Store reference

        // Secondary fill light for better building visibility from camera
        if (isWebGPU) {
            const fillLight = new THREE.DirectionalLight(0x556699, 0.15);
            fillLight.position.set(-0.5, 0.5, 1);
            this.scene.add(fillLight);
        } else {
            const fillLight = new THREE.DirectionalLight(0x6666aa, 0.25);
            fillLight.position.set(-0.5, 0.5, 1);
            this.scene.add(fillLight);
        }

        // Hemisphere light for sky/ground gradient
        const hemiLight = new THREE.HemisphereLight(0x4455aa, 0x222233, isWebGPU ? 0.36 : 0.45);
        this.scene.add(hemiLight);

        // Purple-heavy point lights for neon atmosphere - OPTIMIZED: Reduced count
        const lightPositions = isWebGPU
            ? [
                { pos: [-200, 200, -300], color: 0x8800ff, intensity: 4.5 },
                { pos: [280, 250, -500], color: 0xaa00ff, intensity: 4.0 },
            ]
            : [
                { pos: [-200, 200, -300], color: 0x8800ff, intensity: 5.5 },
                { pos: [280, 250, -500], color: 0xaa00ff, intensity: 5.0 },
                { pos: [100, 80, 100], color: 0x6600ff, intensity: 4.5 },
                { pos: [-180, 150, 50], color: 0xff00ff, intensity: 5.5 },
            ];

        lightPositions.forEach(({ pos, color, intensity }) => {
            const light = new THREE.PointLight(color, intensity, 1000);
            light.position.set(...pos);
            this.scene.add(light);
        });

        console.log('[NeonDistrict] Lighting configured - brighter for visible buildings');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (this.featureFlags?.noPost) {
            if (this.post) {
                this.post.dispose();
                this.post = null;
            }
            if (this.composer) {
                this.composer.dispose();
                this.composer = null;
            }
            this.bloomPass = null;
            console.log('[NeonDistrict] Debug: post-processing disabled');
            return;
        }

        if (!this.qualityPreset.enablePostProcessing) {
            console.log('[NeonDistrict] Post-processing disabled for this quality level');
            return;
        }

        if (this.isWebGPU) {
            this.composer = null;
            this.bloomPass = null;

            const pixelRatio = this.getRenderPixelRatio();
            const postScale = this.getPostProcessingScale();
            const renderTargetWidth = Math.max(1, Math.floor(window.innerWidth * pixelRatio * postScale));
            const renderTargetHeight = Math.max(1, Math.floor(window.innerHeight * pixelRatio * postScale));
            const useMRT = this.shouldUseMrt();

            // PHASE 1 OPTIMIZATION: Quality-adaptive bloom resolution
            // High+ keeps high resolution bloom (0.8), Medium/Low scales down for performance
            // No visual change at same quality level
            // PERF: More aggressive bloom downsample for significant FPS gains
            // Bloom at lower resolution is barely noticeable but saves 5-10% FPS
            let bloomDownsample = 0.7; // Default for High (was 0.8)
            if (this.currentQualityName === 'Extreme' || this.currentQualityName === 'Ultra') {
                bloomDownsample = 0.75;
            } else if (this.currentQualityName === 'Medium') {
                bloomDownsample = 0.5;  // Was 0.6
            } else if (this.currentQualityName === 'Low' || this.currentQualityName === 'Minimal') {
                bloomDownsample = 0.4;  // Was 0.5
            }

            // AAA Phase 2: god-rays gated to High+ (post only runs on High+ anyway).
            // Need MRT for the emissive buffer the rays sample.
            const godraysEnabled = useMRT && !this.featureFlags?.noGodrays;
            const godrayIntensityMap = { Extreme: 0.6, Ultra: 0.5, High: 0.4 };
            const godrayIntensity = godrayIntensityMap[this.currentQualityName] ?? 0.4;
            this.godrayBaseIntensity = godraysEnabled ? godrayIntensity : 0.0;
            const fogDisabled = this.featureFlags?.noFog;

            // AAA Phase 3: cinematic post. CA + grade + grain are cheap (High+).
            // The heavier multi-tap DOF + anamorphic default to Ultra/Extreme,
            // overridable on any tier with ?ndCinematic.
            const isUltraPlus = this.currentQualityName === 'Ultra' || this.currentQualityName === 'Extreme';
            const cinematicHeavy = (isUltraPlus || this.featureFlags?.forceCinematic);
            const dofEnabled = cinematicHeavy && !this.featureFlags?.noDof;
            const anamorphicEnabled = cinematicHeavy && useMRT && !this.featureFlags?.noAnamorphic;
            const gradeEnabled = !this.featureFlags?.noGrade;
            const caBase = this.featureFlags?.noGrade ? 0.0 : 0.0016;
            const grainBase = this.featureFlags?.noGrade ? 0.0 : 0.022;
            // 6b rain-on-lens: Ultra/Extreme by default (or ?ndLensDrops), gated off
            // by ?ndNoLensDrops. Amount is driven by rain intensity each frame.
            const lensDropsEnabled = (isUltraPlus || this.featureFlags?.forceLensDrops)
                && !this.featureFlags?.noLensDrops;
            this.lensDropletBase = lensDropsEnabled ? 0.45 : 0.0;

            this.post = new NeonDistrictPost(this.renderer, this.scene, this.camera, {
                bloomStrength: this.qualityPreset.bloomStrength,
                bloomRadius: this.qualityPreset.bloomRadius,
                bloomThreshold: this.qualityPreset.bloomThreshold || 0.2,
                vignetteDarkness: VignetteShader.uniforms.darkness.value,
                vignetteOffset: VignetteShader.uniforms.offset.value,
                chromaticAberration: 0.002,
                grainAmount: 0.025,
                bloomDownsample, // Phase 1: Quality-adaptive (0.8 High+, 0.6 Med, 0.5 Low)
                fogColor: this.fogSettings?.color,
                fogColorFar: this.fogSettings?.colorFar,
                fogNear: this.fogSettings?.near,
                fogFar: this.fogSettings?.far,
                fogDensity: fogDisabled ? 0.0 : this.fogSettings?.density,
                fogBloomAttenuation: this.fogSettings?.bloomAttenuation,
                fogHeightBase: this.fogSettings?.heightBase,
                fogHeightTop: this.fogSettings?.heightTop,
                fogHeightFloor: this.fogSettings?.heightFloor,
                enableGodrays: godraysEnabled,
                godrayIntensity,
                // Phase 3 cinematic stack
                aberration: caBase,
                grainIntensity: grainBase,
                enableDOF: dofEnabled,
                dofFocus: 0.32,
                dofRange: 2.0,
                dofStrength: 0.85,
                dofMaxRadius: 0.0045,
                enableAnamorphic: anamorphicEnabled,
                anamorphicIntensity: anamorphicEnabled ? 0.5 : 0.0,
                enableGrade: gradeEnabled,
                saturationAmount: 1.12,
                contrast: 1.06,
                enableLensDroplets: lensDropsEnabled,
                useMRT,
            });
            this.post.setSize(renderTargetWidth, renderTargetHeight);
            if (useMRT) {
                this.patchMrtMaterialsForObject(this.scene);
            } else {
                console.warn('[NeonDistrict] WebGPU MRT disabled; using full-scene bloom to avoid pipeline errors.');
            }

            console.log(
                `[NeonDistrict] WebGPU post-processing configured at ${renderTargetWidth}x${renderTargetHeight} (${pixelRatio}x, ${postScale} scale)`,
            );
            return;
        }

        if (this.post) {
            this.post.dispose();
            this.post = null;
        }

        // WebGL fallback post-processing
        // Create high-resolution render target that accounts for device pixel ratio
        const pixelRatio = this.getRenderPixelRatio();
        const postScale = this.getPostProcessingScale();
        const renderTargetWidth = Math.max(1, Math.floor(window.innerWidth * pixelRatio * postScale));
        const renderTargetHeight = Math.max(1, Math.floor(window.innerHeight * pixelRatio * postScale));

        const renderTarget = new THREE.WebGLRenderTarget(renderTargetWidth, renderTargetHeight, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType, // Better color precision for HDR bloom
        });

        this.composer = new EffectComposer(this.renderer, renderTarget);

        // Render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom pass - using high-resolution dimensions
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(renderTargetWidth, renderTargetHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            this.qualityPreset.bloomThreshold || 0.4,
        );
        this.composer.addPass(this.bloomPass);

        // Vignette pass
        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log(
            `[NeonDistrict] Post-processing configured at ${renderTargetWidth}x${renderTargetHeight} (${pixelRatio}x, ${postScale} scale)`,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners - Gameplay Effects
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        // Piece lock - subtle neon glow pulse
        const onPieceLock = () => {
            // Subtle bloom/glow boost
            this.lightPulseIntensity = 0.3;
            this.bloomBoost = 0.25;
        };
        eventBus.on(EVENTS.PIECE_LOCK, onPieceLock);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.PIECE_LOCK, onPieceLock));

        // Line clear - lightning flash
        const onLineClear = (data) => {
            const lineCount = data?.lines || 1;
            this.lightPulseIntensity = 0.8 + lineCount * 0.2;
            this.bloomBoost = 0.5 + lineCount * 0.1;
            this.rainIntensity = 1.5 + lineCount * 0.3;
            // AAA Phase 7a: reactive dolly-push down the canyon, bigger per line.
            this.triggerCameraPush(7 + lineCount * 4);
            // AAA Phase 4c/7a: a Tetris (4-line) cracks distant sheet-lightning,
            // pushes harder and widens the lens for a brief dolly-zoom.
            if (lineCount >= 4) {
                this.triggerSkyFlash(1.0);
                this.triggerCameraPush(26);
                this.triggerFovPulse(5);
            }
        };
        eventBus.on(EVENTS.LINES_CLEARED, onLineClear);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.LINES_CLEARED, onLineClear));

        // Combo - tiered cyberpunk effects
        const onCombo = (data) => {
            const combo = data?.combo || data?.comboCount || 1;
            this.triggerComboEffects(combo);
        };
        eventBus.on(EVENTS.COMBO, onCombo);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.COMBO, onCombo));

        // Pointer handler
        const pointerMoveHandler = (e) => {
            if (this.isActive) {
                this.targetPointerX = (e.clientX / window.innerWidth) * 2 - 1;
                this.targetPointerY = -(e.clientY / window.innerHeight) * 2 + 1;
            }
        };
        window.addEventListener('pointermove', pointerMoveHandler);
        this.eventUnsubscribers.push(() => window.removeEventListener('pointermove', pointerMoveHandler));

        // Resize handler
        const onResize = () => this.handleResize();
        window.addEventListener('resize', onResize);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', onResize));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Combo Effects System - Tiered Cyberpunk Effects
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * AAA Phase 7a — push the camera forward down the canyon. `amount` is in world
     * units; the push eases back to rest in updateCameraSway. Stacks by taking the
     * strongest pending push.
     */
    triggerCameraPush(amount) {
        const a = Math.abs(amount);
        this.cameraDollyZ = Math.min(this.cameraDollyZ || 0, -a);
    }

    /** AAA Phase 7a — transient FOV widen (dolly-zoom), in degrees. */
    triggerFovPulse(amount) {
        this.cameraFovPulse = Math.max(this.cameraFovPulse || 0, amount);
    }

    triggerComboEffects(combo) {
        const comboFxScale = this.getComboFxScale();
        if (comboFxScale <= 0) return;

        // === TIER 1: All combos (1+) ===
        // Bloom/glow boost scales with combo
        this.lightPulseIntensity = Math.min(0.5 + combo * 0.15, 1.2) * comboFxScale;
        this.bloomBoost = Math.min(0.4 + combo * 0.12, 1.0) * comboFxScale;

        // AAA Phase 7a: bigger combos nudge the camera forward (saturation ramp +
        // aberration ride the shared bloomBoost decay in the animation loop).
        if (combo >= 3) {
            this.triggerCameraPush(Math.min(6 + combo * 2, 22) * comboFxScale);
        }

        // Rain intensifies
        this.rainIntensity = Math.min(1.5 + combo * 0.2, 3.0);

        // Spawn neon sparks (scales with combo)
        const sparkCount = Math.min(Math.round(combo * 6 * comboFxScale), Math.round(30 * comboFxScale));
        this.spawnComboSparks(sparkCount, combo, comboFxScale);

        // EXTRA edge sparks - specifically on screen edges where they're visible
        this.spawnEdgeSparks(combo, comboFxScale);

        // === TIER 2: Medium combos (3+) ===
        if (combo >= 3 && comboFxScale >= 0.6) {
            // Neon sign surge - all signs flare brighter
            this.triggerNeonSignSurge(combo);
        }

        // === TIER 3: High combos (5+) ===
        if (combo >= 5 && comboFxScale >= 0.8) {
            // Lightning arc between buildings
            this.spawnLightningArc(combo);

            // Holographic glitch wave
            this.triggerGlitchWave(combo);
        }
    }

    spawnComboSparks(count, combo, comboFxScale = 1) {
        if (!this.scene) return;

        // Cyberpunk neon colors - bright and saturated
        const neonColors = [
            0x00ffff, // Electric cyan
            0xff00ff, // Hot magenta
            0xffff00, // Acid yellow
            0xff00aa, // Pink neon
            0x00ff66, // Toxic green
            0xaa00ff, // Purple neon
            0xffffff, // White hot
        ];

        // Spawn MORE sparks across the ENTIRE visible screen
        const actualCount = Math.max(1, Math.floor(count * 2 * comboFxScale));

        for (let i = 0; i < actualCount; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // BIAS toward left and right EDGES - avoid center where game board is
            let spawnX;
            if (Math.random() > 0.3) {
                // 70% chance: spawn on edges (left or right side)
                const side = Math.random() > 0.5 ? 1 : -1;
                spawnX = side * (200 + Math.random() * 400); // 200-600 units from center
            } else {
                // 30% chance: full width (some will appear behind board)
                spawnX = (Math.random() - 0.5) * 1000;
            }
            const spawnY = Math.random() * 350; // Full height from ground to sky
            const spawnZ = 100 - Math.random() * 500; // Closer to camera for visibility

            // LARGER sparks for better visibility
            const sparkSize = (2 + Math.random() * 3) * (0.7 + comboFxScale * 0.6);
            const spark = this.getSparkMesh();
            spark.position.set(spawnX, spawnY, spawnZ);
            spark.scale.setScalar(sparkSize);
            spark.material.color.setHex(color);
            spark.material.opacity = 1.0;

            // Velocity - dynamic burst with variety
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.3) * Math.PI;
            const speed = 20 + Math.random() * 40 + combo * 8;

            spark.userData = {
                vx: Math.cos(angle) * Math.cos(elevation) * speed,
                vy: Math.sin(elevation) * speed + 10,
                vz: Math.sin(angle) * Math.cos(elevation) * speed * 0.5, // Less Z movement
                life: 1.0,
                decay: 0.008 + Math.random() * 0.01, // Slower decay = longer visibility
                gravity: -40, // Gentler gravity
                color,
                baseSize: sparkSize,
                poolType: 'spark',
            };

            this.scene.add(spark);
            this.pieceLockSparks.push(spark);
        }
    }

    // Spawn sparks SPECIFICALLY on the far left and right edges of the screen
    spawnEdgeSparks(combo, comboFxScale = 1) {
        if (!this.scene) return;

        // Bright neon colors for visibility
        const neonColors = [
            0x00ffff, // Electric cyan
            0xff00ff, // Hot magenta
            0xffff00, // Acid yellow
            0x00ff66, // Toxic green
            0xffffff, // White hot
        ];

        // More sparks for higher combos
        const count = Math.max(1, Math.floor((15 + combo * 8) * comboFxScale));

        for (let i = 0; i < count; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // ONLY spawn on far LEFT or RIGHT edges
            const side = Math.random() > 0.5 ? 1 : -1;
            const spawnX = side * (350 + Math.random() * 300); // 350-650 units from center (far edges)
            const spawnY = Math.random() * 400; // Full height
            const spawnZ = 150 - Math.random() * 300; // Closer to camera for maximum visibility

            // LARGER, brighter sparks for edges
            const sparkSize = (3 + Math.random() * 4) * (0.7 + comboFxScale * 0.6);
            const spark = this.getSparkMesh();
            spark.position.set(spawnX, spawnY, spawnZ);
            spark.scale.setScalar(sparkSize);
            spark.material.color.setHex(color);
            spark.material.opacity = 1.0;

            // Velocity - burst mostly laterally (stay on edges)
            const angle = side > 0 ? Math.random() * Math.PI - Math.PI / 2 : Math.random() * Math.PI + Math.PI / 2;
            const speed = 15 + Math.random() * 30;

            spark.userData = {
                vx: Math.cos(angle) * speed * 0.5, // Less horizontal movement to stay on edge
                vy: (Math.random() - 0.3) * speed + 10, // Mostly upward
                vz: 0, // No depth movement
                life: 1.0,
                decay: 0.006 + Math.random() * 0.008, // Extra slow decay
                gravity: -30, // Gentle gravity
                color,
                baseSize: sparkSize,
                poolType: 'spark',
            };

            this.scene.add(spark);
            this.pieceLockSparks.push(spark);
        }
    }

    triggerNeonSignSurge(combo) {
        // Temporarily boost all neon sign brightness
        this.neonSignSurgeIntensity = Math.min(0.5 + combo * 0.1, 1.0);
        this.neonSignSurgeTime = 0;
    }

    spawnLightningArc(combo) {
        if (!this.scene || this.buildings.length < 2) return;

        // Spawn multiple lightning arcs for high combos, spread across the scene
        const arcCount = Math.min(1 + Math.floor((combo - 4) / 2), 3);

        for (let arc = 0; arc < arcCount; arc++) {
            // Find two buildings at similar Z depth for this arc
            const leftBuildings = this.buildings.filter((b) => b.position.x < 0);
            const rightBuildings = this.buildings.filter((b) => b.position.x > 0);

            if (leftBuildings.length === 0 || rightBuildings.length === 0) return;

            const leftB = leftBuildings[Math.floor(Math.random() * leftBuildings.length)];

            // Find a right building at similar Z depth for more natural arc
            const sameDepthBuildings = rightBuildings.filter((b) => Math.abs(b.position.z - leftB.position.z) < 200);
            const rightB = sameDepthBuildings.length > 0
                ? sameDepthBuildings[Math.floor(Math.random() * sameDepthBuildings.length)]
                : rightBuildings[Math.floor(Math.random() * rightBuildings.length)];

            // Arc points - full height range
            const startY = 50 + Math.random() * 250;
            const endY = 50 + Math.random() * 250;

            // Use averaged Z for the arc to stay in the building corridor
            const arcZ = (leftB.position.z + rightB.position.z) / 2;

            const start = new THREE.Vector3(
                leftB.position.x + 20,
                startY,
                arcZ + (Math.random() - 0.5) * 50,
            );
            const end = new THREE.Vector3(
                rightB.position.x - 20,
                endY,
                arcZ + (Math.random() - 0.5) * 50,
            );

            // Create lightning bolt with jagged segments
            this.createLightningBolt(start, end, combo);
        }
    }

    createLightningBolt(start, end, combo) {
        if (!this.scene) return;

        const points = [start.clone()];
        const segments = 8 + Math.floor(combo * 2);
        const direction = end.clone().sub(start);

        // Create jagged path
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const point = start.clone().lerp(end, t);

            // Add random displacement (perpendicular jitter)
            const jitter = 15 + combo * 3;
            point.x += (Math.random() - 0.5) * jitter;
            point.y += (Math.random() - 0.5) * jitter;
            point.z += (Math.random() - 0.5) * jitter * 0.5;

            points.push(point);
        }
        points.push(end.clone());

        // Create geometry from points
        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        // Electric blue/white color
        const colors = [0x88ffff, 0xffffff, 0xaaffff, 0x00ffff];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const material = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 1.0,
            linewidth: 2,
            blending: THREE.AdditiveBlending,
        });

        const lightning = new THREE.Line(geometry, material);
        lightning.userData = {
            life: 1.0,
            decay: 0.06, // Fast fade
            isLightning: true,
        };

        this.scene.add(lightning);
        this.pieceLockSparks.push(lightning);

        // Create glow at both ends
        this.createSparkFlash(start.x, start.y, start.z, color);
        this.createSparkFlash(end.x, end.y, end.z, color);

        // Spawn branch lightning (for high combos)
        if (combo >= 7 && Math.random() > 0.5) {
            const midPoint = points[Math.floor(points.length / 2)];
            const branchEnd = new THREE.Vector3(
                midPoint.x + (Math.random() - 0.5) * 100,
                midPoint.y - 30 - Math.random() * 50,
                midPoint.z + (Math.random() - 0.5) * 50,
            );
            this.createLightningBolt(midPoint, branchEnd, Math.floor(combo / 2));
        }
    }

    triggerGlitchWave(combo) {
        if (!this.scene) return;

        // Create a horizontal "glitch band" plane that sweeps across
        const height = 3 + combo * 0.5;
        const geometry = new THREE.PlaneGeometry(600, height);

        // Glitch colors - electric interference
        const glitchColors = [0x00ffff, 0xff00ff, 0xffff00, 0x00ff00];
        const color = glitchColors[Math.floor(Math.random() * glitchColors.length)];

        const material = this.createBasicMaterial({
            color,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const glitchWave = new THREE.Mesh(geometry, material);

        // Position on LEFT or RIGHT side - avoid center where game board is
        const side = Math.random() > 0.5 ? 1 : -1;
        const randomX = side * (150 + Math.random() * 200); // 150-350 units from center
        const randomZ = -50 - Math.random() * 400;
        glitchWave.position.set(randomX, 400, randomZ);
        glitchWave.rotation.x = Math.PI / 2; // Horizontal

        glitchWave.userData = {
            life: 1.0,
            decay: 0.025,
            isGlitchWave: true,
            sweepSpeed: 300 + combo * 50,
            startY: 400,
        };

        this.scene.add(glitchWave);
        this.pieceLockSparks.push(glitchWave);
    }

    handleResize() {
        if (!this.isActive) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.applyRenderScale(true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Piece Lock Effect - Cyberpunk Neon Sparks
    // ─────────────────────────────────────────────────────────────────────────

    spawnPieceLockSparks() {
        if (!this.scene) return;
        if (this.featureFlags?.noSparks) return;

        // Cyberpunk neon colors matching the theme palette
        const neonColors = [
            0x00ffff, // Electric cyan
            0xff00ff, // Hot magenta
            0xffff00, // Acid yellow
            0xff00aa, // Pink neon
            0x00ff66, // Toxic green
            0xaa00ff, // Purple neon
        ];

        // Spawn location - spread across the ENTIRE visible city area
        const spawnX = (Math.random() - 0.5) * 800; // Full city width
        const spawnY = 10 + Math.random() * 300; // Full height range
        const spawnZ = 50 - Math.random() * 600; // From foreground to deep background

        // Create 8-15 sparks per piece lock
        const sparkCount = 8 + Math.floor(Math.random() * 8);

        for (let i = 0; i < sparkCount; i++) {
            const color = neonColors[Math.floor(Math.random() * neonColors.length)];

            // Spark geometry - small glowing point
            const sparkSize = 0.8 + Math.random() * 0.8;
            const spark = this.getSparkMesh();
            spark.material.color.setHex(color);
            spark.material.opacity = 1.0;
            spark.scale.setScalar(sparkSize);

            // Initial position with slight spread
            spark.position.set(
                spawnX + (Math.random() - 0.5) * 10,
                spawnY + (Math.random() - 0.5) * 10,
                spawnZ + (Math.random() - 0.5) * 10,
            );

            // Velocity - burst outward in all directions
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.3) * Math.PI; // Bias upward
            const speed = 40 + Math.random() * 60;

            spark.userData = {
                vx: Math.cos(angle) * Math.cos(elevation) * speed,
                vy: Math.sin(elevation) * speed + 20, // Upward bias
                vz: Math.sin(angle) * Math.cos(elevation) * speed,
                life: 1.0,
                decay: 0.015 + Math.random() * 0.02,
                gravity: -80, // Gravity pulls sparks down
                color,
                poolType: 'spark',
            };

            this.scene.add(spark);
            this.pieceLockSparks.push(spark);
        }

        // Also create a brief flash/glow at spawn point
        this.createSparkFlash(spawnX, spawnY, spawnZ, neonColors[Math.floor(Math.random() * neonColors.length)]);
    }

    createSparkFlash(x, y, z, color) {
        if (!this.scene) return;

        // Create a larger, quickly fading glow sphere
        const flash = this.getSparkMesh();
        flash.material.color.setHex(color);
        flash.material.opacity = 0.8;
        flash.scale.setScalar(8);
        flash.position.set(x, y, z);

        flash.userData = {
            life: 1.0,
            decay: 0.08, // Fast decay for quick flash
            isFlash: true,
            poolType: 'spark',
        };

        this.scene.add(flash);
        this.pieceLockSparks.push(flash);
    }

    updatePieceLockSparks(delta) {
        if (this.featureFlags?.noSparks) return;
        for (let i = this.pieceLockSparks.length - 1; i >= 0; i--) {
            const spark = this.pieceLockSparks[i];

            // Decay life
            spark.userData.life -= spark.userData.decay;

            if (spark.userData.life <= 0) {
                // Remove dead spark
                const poolType = spark.userData.poolType;
                this.scene.remove(spark);
                if (poolType === 'spark') {
                    this.releaseSparkMesh(spark);
                } else {
                    if (spark.geometry) spark.geometry.dispose();
                    if (spark.material) spark.material.dispose();
                }
                this.pieceLockSparks.splice(i, 1);
                continue;
            }

            // Update opacity based on life
            spark.material.opacity = spark.userData.life;

            if (spark.userData.isLightning) {
                // Lightning just fades - no movement
                continue;
            }

            if (spark.userData.isGlitchWave) {
                // Glitch wave sweeps down the screen
                spark.position.y -= spark.userData.sweepSpeed * delta;

                // Add some horizontal jitter for glitch effect
                spark.position.x = (Math.random() - 0.5) * 10;

                continue;
            }

            if (spark.userData.isFlash) {
                // Flash grows and fades
                const scale = 1 + (1 - spark.userData.life) * 2;
                spark.scale.setScalar(scale);
            } else {
                // Regular spark - apply physics
                spark.userData.vy += spark.userData.gravity * delta;

                spark.position.x += spark.userData.vx * delta;
                spark.position.y += spark.userData.vy * delta;
                spark.position.z += spark.userData.vz * delta;

                // Friction/drag
                spark.userData.vx *= 0.98;
                spark.userData.vz *= 0.98;

                // Shrink as it dies
                const lifeScale = 0.3 + spark.userData.life * 0.7;
                spark.scale.setScalar(lifeScale);

                // Trail effect - stretch based on velocity
                const speed = Math.sqrt(
                    spark.userData.vx ** 2
                    + spark.userData.vy ** 2
                    + spark.userData.vz ** 2,
                );
                if (speed > 20) {
                    spark.scale.y = 1 + speed * 0.01;
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        if (this.clock?.start) this.clock.start();
        this.cameraDriftSeed = Math.random() * Math.PI * 2;
        this.cameraSway.set(0, 0, 0);
        this.cameraLookTarget.copy(this.cameraBaseLookAt);
        this.cameraCurrentLookTarget.copy(this.cameraBaseLookAt);
        this.cameraRollOffset = 0;

        // PERF: Track frame timing for adaptive quality
        let lastFrameTime = 0;
        let skipNextRender = false;
        let consecutiveSlowFrames = 0;

        const animate = () => {
            if (!this.isActive) {
                this.isAnimating = false;
                return;
            }

            let mark = this.profileStart();
            const animId = requestAnimationFrame(animate);
            this.registerAnimation(animId);

            // Skip render during shader prewarm to avoid compilation stalls
            if (this.isPrewarming) {
                this.profileEnd();
                return;
            }

            let delta = this.clock.getDelta();

            // PERF: Clamp delta to prevent huge time jumps (e.g., after tab switch)
            // Max delta of 100ms (10fps floor) prevents physics/animation explosions
            delta = Math.min(delta, 0.1);

            // PERF: Adaptive frame skipping based on sustained lag
            if (lastFrameTime > 100) {
                consecutiveSlowFrames++;
                // After 3+ consecutive slow frames, skip render to let GPU recover
                if (consecutiveSlowFrames >= 3 || lastFrameTime > 500) {
                    skipNextRender = true;
                    consecutiveSlowFrames = 0;
                }
            } else {
                consecutiveSlowFrames = 0;
            }

            const frameStart = performance.now();
            this.time += delta;
            this.updateDynamicResolution(delta);
            this.updateBaselineStats(delta);
            this.updatePerformanceGuards(delta);
            mark = this.profileStep('frame:init', mark);

            // Camera sway - gentle floating drift
            this.updateCameraSway(delta);
            mark = this.profileStep('camera', mark);

            if (this.vehicleNodeUniforms?.uTime) {
                this.vehicleNodeUniforms.uTime.value = this.time;
            }

            // Update sky shader
            if (this.sky?.material?.uniforms?.uTime) {
                this.sky.material.uniforms.uTime.value = this.time;
            }
            if (this.moonUniforms?.uTime) {
                this.moonUniforms.uTime.value = this.time;
            }
            if (this.skyStrataUniforms?.length) {
                this.skyStrataUniforms.forEach((uniforms) => {
                    if (uniforms?.uTime) {
                        uniforms.uTime.value = this.time;
                    }
                });
            }
            // AAA Phase 4c: drive the distant sheet-lightning.
            if (this.skyFlash) {
                this.updateSkyFlash(delta);
            }

            if (this.buildingUniforms) {
                this.buildingUniforms.uTime.value = this.time;
            }
            if (this.buildingUniformsLOD1) {
                this.buildingUniformsLOD1.uTime.value = this.time;
            }
            if (this.buildingUniformsLOD2) {
                this.buildingUniformsLOD2.uTime.value = this.time;
            }

            if (!this.featureFlags?.noStars) {
                // PERF: Starfield throttling - 15fps for rotation, 20fps for uniforms
                // Stars move so slowly that lower update rates are imperceptible
                if (!this.starfieldUpdateAccum) this.starfieldUpdateAccum = 0;
                if (!this.starUniformUpdateAccum) this.starUniformUpdateAccum = 0;
                this.starfieldUpdateAccum += delta;
                this.starUniformUpdateAccum += delta;

                const starfieldRotationInterval = 1.0 / 15.0; // 15fps (was 30fps)
                const starUniformInterval = 1.0 / 20.0; // 20fps for twinkle

                // Throttled uniform update (twinkle animation)
                if (this.starUniformUpdateAccum >= starUniformInterval) {
                    this.starUniformUpdateAccum = 0;
                    if (this.starUniforms?.uTime) {
                        this.starUniforms.uTime.value = this.time;
                    } else if (this.starfield?.material?.uniforms?.uTime) {
                        this.starfield.material.uniforms.uTime.value = this.time;
                    }
                }

                // Throttled rotation update
                if (this.starfield && this.starfieldUpdateAccum >= starfieldRotationInterval) {
                    this.starfieldUpdateAccum = 0;
                    this.starfield.rotation.y = this.time * 0.002;
                    this.starfield.rotation.z = this.time * 0.001;
                }
            }
            mark = this.profileStep('stars', mark);

            // PHASE 2: Ground uniform batching - combine all ground updates
            // Skip updates if delta is tiny (<16ms floor = ~60fps)
            const shouldUpdateGround = delta >= 0.016;

            if (shouldUpdateGround) {
                // Update ground uniforms (for ripples and reflections)
                if (this.groundUniforms?.uTime) {
                    this.groundUniforms.uTime.value = this.time;
                }
                if (this.groundUniforms?.uCameraPos?.value) {
                    this.groundUniforms.uCameraPos.value.copy(this.camera.position);
                }
                // WebGPU: Also update wetGroundUniforms directly (TSL materials)
                if (this.wetGroundUniforms?.uTime) {
                    this.wetGroundUniforms.uTime.value = this.time;
                }
                if (this.wetGroundUniforms?.uRainIntensity) {
                    this.wetGroundUniforms.uRainIntensity.value = this.rainIntensity ?? 1.0;
                }
            }
            mark = this.profileStep('ground', mark);


            // Animate Mega Tower Shader (Color Drift)
            if (this.megaTowerUniforms?.uTime) {
                this.megaTowerUniforms.uTime.value = this.time;
            } else if (this.megaTowerMaterial?.uniforms?.uTime) {
                this.megaTowerMaterial.uniforms.uTime.value = this.time;
            }
            if (this.megaTowerOverlayUniforms?.uTime) {
                this.megaTowerOverlayUniforms.uTime.value = this.time;
            } else if (this.megaTowerOverlayMaterial?.uniforms?.uTime) {
                this.megaTowerOverlayMaterial.uniforms.uTime.value = this.time;
            }

            // Update searchlights
            if (!this.featureFlags?.noSearchlights) {
                this.updateSearchlights(delta);
            }
            mark = this.profileStep('searchlights', mark);

            // Update rain
            if (!this.featureFlags?.noRain) {
                this.updateRain(delta);
            }
            mark = this.profileStep('rain', mark);

            // Update camera-facing billboards at a throttled cadence
            this.updateBillboards(delta);
            mark = this.profileStep('billboards', mark);

            this.updateInstancedBillboardsTime();

            // Update flying vehicles
            const skipHeavy = delta > this.slowFrameThreshold;
            if (!skipHeavy && !this.featureFlags?.noVehicles
                && this.vehicleData && this.vehicleInstances && !this.vehicleGPUDriven
                && this.vehicleInstances.body?.isInstancedMesh) {
                this.vehicleUpdateAccumulator += delta;
                if (this.vehicleUpdateAccumulator >= this.vehicleUpdateInterval) {
                    const step = this.vehicleUpdateAccumulator;
                    this.vehicleUpdateAccumulator = 0;
                    this.updateFlyingVehicles(step);
                }
            }
            // Ground traffic — smooth linear motion, update every frame (cheap).
            if (!skipHeavy && this.groundCarInstances) {
                this.updateGroundTraffic(delta);
            }
            mark = this.profileStep('vehicles', mark);

            // Update neon signs (flicker)
            if (!skipHeavy && !this.featureFlags?.noSigns) {
                this.updateNeonSigns();
            }
            mark = this.profileStep('neon', mark);

            // Update blinking lights
            if (!skipHeavy) {
                this.updateBlinkingLights();
            }
            mark = this.profileStep('blink', mark);

            // Update VHS billboards (time + texture cycling)
            if (!skipHeavy && this.vhsBillboards?.length) {
                this.vhsUpdateAccumulator += delta;
                if (this.vhsUpdateAccumulator >= this.vhsUpdateInterval) {
                    const step = this.vhsUpdateAccumulator;
                    this.vhsUpdateAccumulator = 0;
                    this.updateVHSBillboards(step);
                }
            }
            mark = this.profileStep('vhs', mark);

            // Update piece lock sparks
            if (!skipHeavy && !this.featureFlags?.noSparks) {
                this.updatePieceLockSparks(delta);
            }
            mark = this.profileStep('sparks', mark);

            // Decay effects
            this.lightPulseIntensity *= 0.95;
            this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, 1.0, delta * 2);

            // Decay neon sign surge
            this.neonSignSurgeIntensity *= 0.92;

            // PERF: Only update bloom when boost is active (avoid per-frame updateParams calls)
            if (this.bloomBoost > 0.001) {
                this.bloomBoost *= 0.93;
                if (this.bloomPass) {
                    this.bloomPass.strength = this.qualityPreset.bloomStrength + this.bloomBoost;
                } else if (this.post) {
                    this.post.updateParams({
                        bloomStrength: this.qualityPreset.bloomStrength + this.bloomBoost,
                        // AAA Phase 7a: ramp the filmic grade's saturation with the boost
                        // so combos/clears punch the colour, easing back on the same decay.
                        saturationAmount: this.baseSaturationAmount + Math.min(this.bloomBoost, 1.0) * 0.4,
                    });
                    // AAA Phase 3c: combos/line-clears briefly push chromatic aberration
                    // for a visible "glitch" distortion, riding the same decay as bloom.
                    if (this.post.setAberrationBoost) {
                        this.post.setAberrationBoost(Math.min(this.bloomBoost, 1.0) * 0.004);
                    }
                }
            } else {
                this.bloomBoost = 0;
                if (this.post?.setAberrationBoost && this.aberrationBoostActive) {
                    this.post.setAberrationBoost(0);
                    this.post.updateParams({ saturationAmount: this.baseSaturationAmount });
                    this.aberrationBoostActive = false;
                }
            }
            if (this.bloomBoost > 0.001) this.aberrationBoostActive = true;

            if (this.post) {
                this.post.updateTime(this.time);
                // AAA Phase 2b: project the moon to screen space so the god-ray
                // shafts radiate from it as the camera sways.
                if (this.post.enableGodrays && this.camera) {
                    _moonProjVec.copy(this.moonWorldPosition).project(this.camera);
                    this.moonScreen.set(
                        (_moonProjVec.x + 1) * 0.5,
                        (_moonProjVec.y + 1) * 0.5,
                    );
                    // Fade rays out when the moon is behind the camera (z > 1 in NDC)
                    const behind = _moonProjVec.z > 1.0;
                    this.post.updateGodrays(this.moonScreen, behind ? 0.0 : this.godrayBaseIntensity);
                }
                // AAA 6b: more beads on the lens the harder it's raining.
                if (this.post.enableLensDroplets && this.post.setLensDroplets) {
                    const rainF = Math.min(Math.max((this.rainIntensity ?? 1.3) / 1.5, 0.5), 1.6);
                    this.post.setLensDroplets((this.lensDropletBase ?? 0) * rainF);
                }
            }
            mark = this.profileStep('pre-render', mark);

            // Render (skip if previous frame was too slow to allow GPU catch-up)
            const renderStart = performance.now();
            if (!skipNextRender) {
                // DEBUG: Skip post-processing if ?noPost=1 to test performance
                const skipPost = this.featureFlags?.noPost;
                if (this.post && !skipPost) {
                    this.post.render();
                } else if (this.composer && !skipPost) {
                    this.composer.render();
                } else {
                    this.renderer.render(this.scene, this.camera);
                }
            }
            skipNextRender = false;
            const renderTime = performance.now() - renderStart;
            this.profileStep('render', mark);

            // Track frame time for next iteration
            lastFrameTime = performance.now() - frameStart;

            const runtimePerfLog = this.debugEnabled || this.profileEnabled;
            if (runtimePerfLog) {
                // Frame time tracking for diagnostics
                if (!this._frameTimeHistory) {
                    this._frameTimeHistory = [];
                    this._frameCount = 0;
                    this._lastFpsLog = performance.now();
                }
                this._frameCount++;
                this._frameTimeHistory.push(lastFrameTime);
                if (this._frameTimeHistory.length > 60) this._frameTimeHistory.shift();

                // Log first 10 frames individually to see warmup pattern
                if (this._frameCount <= 10) {
                    console.log(`[NeonDistrict][Frame ${this._frameCount}] ${lastFrameTime.toFixed(0)}ms (render: ${renderTime.toFixed(0)}ms)`);
                }

                // Log average FPS every 5 seconds
                const now = performance.now();
                if (now - this._lastFpsLog > 5000 && this._frameTimeHistory.length > 0) {
                    this._lastFpsLog = now;
                    const avgMs = this._frameTimeHistory.reduce((a, b) => a + b, 0) / this._frameTimeHistory.length;
                    const avgFps = 1000 / avgMs;
                    const minMs = Math.min(...this._frameTimeHistory);
                    const maxMs = Math.max(...this._frameTimeHistory);
                    console.log(`[NeonDistrict][FPS] avg=${avgFps.toFixed(1)} (${avgMs.toFixed(0)}ms) min=${minMs.toFixed(0)}ms max=${maxMs.toFixed(0)}ms`);
                }

                // DEBUG: Log slow frames with detailed breakdown (throttled to 1/sec)
                if (lastFrameTime > 40) {
                    if (!this._lastSlowLog || now - this._lastSlowLog > 1000) {
                        this._lastSlowLog = now;
                        const marks = this.profileMarks || [];
                        const breakdown = marks.map((m) => `${m.label}:${m.ms.toFixed(0)}`).join(' ');
                        console.warn(`[NeonDistrict][SLOW FRAME] total=${lastFrameTime.toFixed(0)}ms render=${renderTime.toFixed(0)}ms | ${breakdown}`);
                    }
                }
            }

            this.profileEnd();
        };

        animate();
    }

    /**
     * Updates camera with gentle floating drift motion.
     * Uses multiple sine waves at different frequencies for organic, non-repetitive movement.
     */
    updateCameraSway(deltaSeconds = 1 / 60) {
        if (!this.camera) return;

        const dt = Number.isFinite(deltaSeconds) ? Math.max(0.001, deltaSeconds) : (1 / 60);
        const t = this.time;
        const cinematicTime = t + this.cameraDriftSeed;
        const amp = this.cameraSwayAmplitude;
        const spd = this.cameraSwaySpeed;

        // Vertical sway: Strictly positive (up from base)
        // Map sine from [-1, 1] to [0, 1] then scale
        // Phase shifted to -PI/2 so at t=0, sin is -1, making swayY = 0 (start at street)
        const rawY = Math.sin(t * spd.y - Math.PI / 2);
        const normalizedY = rawY * 0.5 + 0.5;
        const topHoldFactor = THREE.MathUtils.smoothstep(normalizedY, 0.88, 1.0);
        const heldNormalizedY = THREE.MathUtils.lerp(normalizedY, 1.0, topHoldFactor * 0.7);
        const swayY = heldNormalizedY * (amp.y * 180.0);

        this.cameraSway.set(
            Math.sin(cinematicTime * spd.x) * amp.x * 0.55
            + Math.sin(cinematicTime * spd.x * 0.55 + 1.3) * amp.x * 0.22,
            0,
            Math.sin(cinematicTime * spd.z + 1.0) * amp.z * 0.5
            + Math.cos(cinematicTime * spd.z * 0.5 + 0.2) * amp.z * 0.25,
        );

        const subtleOrbitX = Math.sin(cinematicTime * spd.x * 0.4 + 0.5) * amp.x * 0.2;
        const subtleDollyZ = Math.sin(cinematicTime * spd.z * 0.35 + 0.7) * amp.z * 0.35;

        // AAA Phase 7a: reactive dolly-push down the canyon, easing back to rest.
        this.cameraDollyZ *= Math.exp(-dt * 3.2);
        if (Math.abs(this.cameraDollyZ) < 0.01) this.cameraDollyZ = 0;

        const targetX = this.cameraBasePosition.x + this.cameraSway.x + subtleOrbitX;
        const targetY = Math.max(this.cameraBasePosition.y, this.cameraBasePosition.y + swayY);
        const targetZ = this.cameraBasePosition.z + this.cameraSway.z + subtleDollyZ + this.cameraDollyZ;

        // AAA Phase 7a: transient FOV widen (dolly-zoom) on big clears. Only touch the
        // projection matrix while the pulse is active — it's removed for perf otherwise.
        this.cameraFovPulse *= Math.exp(-dt * 4.0);
        if (Math.abs(this.cameraFovPulse) > 0.02) {
            this.camera.fov = this.cameraBaseFov + this.cameraFovPulse;
            this.camera.updateProjectionMatrix();
            this._fovDirty = true;
        } else if (this._fovDirty) {
            this.cameraFovPulse = 0;
            this.camera.fov = this.cameraBaseFov;
            this.camera.updateProjectionMatrix();
            this._fovDirty = false;
        }

        // Pointer parallax integration
        this.currentPointerX = this.currentPointerX || 0;
        this.currentPointerY = this.currentPointerY || 0;
        this.targetPointerX = this.targetPointerX || 0;
        this.targetPointerY = this.targetPointerY || 0;

        this.currentPointerX += (this.targetPointerX - this.currentPointerX) * dt * 1.5;
        this.currentPointerY += (this.targetPointerY - this.currentPointerY) * dt * 1.5;

        const parallaxX = this.currentPointerX * 45.0; // Increased city peek
        const parallaxY = this.currentPointerY * 20.0;

        const lateralLerp = THREE.MathUtils.clamp(dt * 1.35, 0.03, 0.16);
        const movingUp = targetY >= this.camera.position.y;
        const verticalLerp = THREE.MathUtils.clamp(dt * (movingUp ? 1.45 : 0.78), 0.02, movingUp ? 0.18 : 0.1);
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX + parallaxX, lateralLerp);
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY + parallaxY, verticalLerp);
        this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetZ, lateralLerp);

        // LookAt sway - subtle view-target drift and smoothed tracking
        const topStraightFactor = THREE.MathUtils.smoothstep(heldNormalizedY, 0.9, 0.995);
        const lookDriftDamp = 1.0 - topStraightFactor * 0.65;
        const lookSwayX = Math.sin(cinematicTime * 0.1 + 0.8) * this.cameraLookAtSway.x * 0.45 * lookDriftDamp;
        const lookSwayY = Math.sin(cinematicTime * 0.14 + 1.5) * this.cameraLookAtSway.y * 0.4 * lookDriftDamp;

        // Peak nod: when near the top, tilt up towards the moon.
        const peakThreshold = 0.6;
        const peakFactor = Math.max(0, (heldNormalizedY - peakThreshold) / (1.0 - peakThreshold));
        const peakNod = peakFactor * peakFactor * 180;

        const lookTargetX = this.cameraBaseLookAt.x + lookSwayX + Math.sin(cinematicTime * 0.19 + 0.3) * 6 + this.currentPointerX * 80.0;
        const baseLookTargetY = this.cameraBaseLookAt.y
            + lookSwayY
            + (swayY * 0.48)
            + peakNod
            + Math.sin(cinematicTime * 0.23 + 0.9) * 3
            + this.currentPointerY * 35.0;
        const straightLookY = targetY + 26;
        const lookTargetY = THREE.MathUtils.lerp(baseLookTargetY, straightLookY, topStraightFactor);
        const lookTargetZ = this.cameraBaseLookAt.z + Math.sin(cinematicTime * 0.16 + 0.7) * 8;

        this.cameraLookTarget.set(lookTargetX, lookTargetY, lookTargetZ);
        const lookLerp = THREE.MathUtils.clamp(dt * 1.8, 0.04, 0.2);
        this.cameraCurrentLookTarget.lerp(this.cameraLookTarget, lookLerp);
        this.camera.lookAt(this.cameraCurrentLookTarget);

        const baseRoll = Math.sin(cinematicTime * 0.11 + 0.5) * 0.003
            + Math.sin(cinematicTime * 0.27) * 0.002;
        const driftRoll = THREE.MathUtils.clamp(this.cameraSway.x / Math.max(1, amp.x * 8), -1, 1) * 0.003;
        const targetRoll = THREE.MathUtils.clamp(baseRoll + driftRoll, -0.012, 0.012);
        this.cameraRollOffset = THREE.MathUtils.lerp(
            this.cameraRollOffset,
            targetRoll,
            THREE.MathUtils.clamp(dt * 1.6, 0.03, 0.18),
        );
        this.camera.rotation.z = THREE.MathUtils.lerp(
            this.camera.rotation.z,
            this.cameraRollOffset,
            THREE.MathUtils.clamp(dt * 1.8, 0.04, 0.2),
        );

        // PERF: FOV breathing removed - updateProjectionMatrix() is expensive
        // The camera position sway already provides organic movement
    }

    /**
     * Updates VHS billboards - shader time, texture cycling, and glitch effects
     */
    updateVHSBillboards(delta) {
        if (this.featureFlags?.noVhsSwitch) {
            this.vhsBillboards.forEach((billboard) => {
                const uniforms = billboard.userData?.vhsUniforms || billboard.material?.uniforms;
                if (!uniforms) return;
                if (uniforms.uTime) uniforms.uTime.value = this.time;
                if (uniforms.uMixFactor) uniforms.uMixFactor.value = 0.0;
                if (uniforms.uGlitchIntensity) uniforms.uGlitchIntensity.value = 0.0;
            });
            return;
        }

        const cameraPos = this.camera?.position || this.cameraBasePosition;
        const lodScale = this.lodScale || 1.0;
        const midDist = this.signLodConfig.midDistance * lodScale;
        const farDist = this.signLodConfig.farDistance * lodScale;
        const midDistSq = midDist * midDist;
        const farDistSq = farDist * farDist;

        this.vhsBillboards.forEach((billboard) => {
            const uniforms = billboard.userData?.vhsUniforms || billboard.material?.uniforms;
            if (!uniforms) return;
            const data = billboard.userData;

            // Update shader time
            if (uniforms.uTime) uniforms.uTime.value = this.time;

            if (!data.worldPos) {
                data.worldPos = new THREE.Vector3();
                data.worldPosCached = false;
            }
            if (!data.worldPosCached) {
                billboard.getWorldPosition(data.worldPos);
                data.worldPosCached = true;
            }
            const dx = data.worldPos.x - cameraPos.x;
            const dz = data.worldPos.z - cameraPos.z;
            const distSq = dx * dx + dz * dz;
            const lodTier = data.lodTier ?? 0;
            const isFar = lodTier >= 2 || distSq > farDistSq;
            const isMid = lodTier >= 1 || distSq > midDistSq;
            if (isFar || isMid) {
                if (uniforms.uMixFactor) uniforms.uMixFactor.value = 0.0;
                if (uniforms.uGlitchIntensity) uniforms.uGlitchIntensity.value = 0.0;
                if (data.inTransition) data.inTransition = false;
                return;
            }

            // Progress cycle timer
            data.cycleProgress += delta;

            // Check if we should start a transition
            if (data.cycleProgress >= data.cycleTime && !data.inTransition) {
                data.inTransition = true;
                data.transitionStart = data.cycleProgress;
            }

            // Handle transition
            if (data.inTransition) {
                const transitionProgress = (data.cycleProgress - data.transitionStart) / data.transitionDuration;

                if (transitionProgress >= 1.0) {
                    // Transition complete - swap textures and reset
                    data.inTransition = false;
                    data.cycleProgress = 0;

                    // Swap textures
                    const tex1 = uniforms.uTexture1 || uniforms.tex1;
                    const tex2 = uniforms.uTexture2 || uniforms.tex2;
                    if (tex1 && tex2) {
                        const temp = tex1.value;
                        tex1.value = tex2.value;
                        tex2.value = temp;
                    }

                    // Get a new random texture for next cycle
                    const newIndex = Math.floor(Math.random() * 14) + 1;
                    const padNum = (n) => n.toString().padStart(2, '0');
                    const newTex = this.assets?.getTexture(`ads_large_${padNum(newIndex)}`);
                    const tex2Target = uniforms.uTexture2 || uniforms.tex2;
                    if (newTex && tex2Target) tex2Target.value = newTex;

                    if (uniforms.uMixFactor) uniforms.uMixFactor.value = 0.0;
                    if (uniforms.uGlitchIntensity) uniforms.uGlitchIntensity.value = 0.0;
                } else {
                    // During transition - animate mix and glitch
                    if (uniforms.uMixFactor) uniforms.uMixFactor.value = transitionProgress;

                    // Glitch peaks in the middle of transition
                    const glitchCurve = Math.sin(transitionProgress * Math.PI);
                    if (uniforms.uGlitchIntensity) uniforms.uGlitchIntensity.value = glitchCurve * 1.5;
                }
            } else {
                // Occasional random glitch even when not transitioning
                if (Math.random() < 0.002) {
                    if (uniforms.uGlitchIntensity) uniforms.uGlitchIntensity.value = 0.3 + Math.random() * 0.5;
                } else {
                    if (uniforms.uGlitchIntensity) uniforms.uGlitchIntensity.value *= 0.9; // Quick decay
                }
            }
        });
    }

    updateNeonSigns() {
        const totalSigns = this.neonSigns.length;
        if (!totalSigns) return;

        // Throttle: update at a lower cadence based on quality
        const interval = this.neonSignUpdateInterval || 3;
        this.signUpdateCounter = (this.signUpdateCounter + 1) % interval;
        if (this.signUpdateCounter !== 0) return;

        // Reuse vector for distance checks (avoid allocations)
        const worldPos = this._signWorldPos || (this._signWorldPos = new THREE.Vector3());
        const cameraPos = this.camera?.position || this.cameraBasePosition;
        const lodScale = this.lodScale || 1.0;
        const midDist = this.signLodConfig.midDistance * lodScale;
        const farDist = this.signLodConfig.farDistance * lodScale;
        const midDistSq = midDist * midDist;
        const farDistSq = farDist * farDist;

        const batchSize = Math.min(totalSigns, this.neonSignBatchSize || 150);
        const start = this.signUpdateCursor || 0;
        const end = Math.min(start + batchSize, totalSigns);

        for (let i = start; i < end; i++) {
            const sign = this.neonSigns[i];
            // Distance culling - skip signs too far from camera to notice flicker
            if (!sign.userData) sign.userData = {};
            const signData = sign.userData;
            if (!signData.worldPos) {
                signData.worldPos = new THREE.Vector3();
                signData.worldPosCached = false;
            }
            if (!signData.worldPosCached) {
                sign.getWorldPosition(signData.worldPos);
                signData.worldPosCached = true;
            }
            worldPos.copy(signData.worldPos);

            const dx = worldPos.x - cameraPos.x;
            const dz = worldPos.z - cameraPos.z;
            const distSq = dx * dx + dz * dz;
            if (distSq > farDistSq) continue;

            const lodTier = signData.lodTier ?? 0;
            const isMidTier = lodTier >= 1 || distSq > midDistSq;
            if (isMidTier) {
                if (sign.userData?.hologramUniforms?.uTime) {
                    sign.userData.hologramUniforms.uTime.value = this.time;
                } else if (sign.material.uniforms?.uTime) {
                    sign.material.uniforms.uTime.value = this.time;
                }
                continue;
            }

            if (sign.userData.flickerPhase !== undefined) {
                // Simple flicker effect
                const flicker = Math.sin(this.time * sign.userData.flickerSpeed + sign.userData.flickerPhase);
                const { flickerAmount } = sign.userData;

                if (sign.material.opacity !== undefined) {
                    // Include combo surge intensity for dramatic flare during combos
                    const surgeBoost = this.neonSignSurgeIntensity * 0.4;
                    sign.material.opacity = Math.min(
                        0.7 + flicker * flickerAmount + this.lightPulseIntensity * 0.3 + surgeBoost,
                        1.0,
                    );
                }
            }

            // Update holographic billboard shaders
            if (sign.userData?.hologramUniforms?.uTime) {
                sign.userData.hologramUniforms.uTime.value = this.time;
            } else if (sign.material.uniforms?.uTime) {
                sign.material.uniforms.uTime.value = this.time;
            }

            // Animated ad material switching (like SynthCity)
            // PERF: Disabled for WebGPU - material switching triggers shader compilation stalls
            if (!this.isWebGPU && !this.featureFlags?.noAdSwitch && sign.userData.isAd && sign.userData.switches) {
                sign.userData.switchCounter++;
                if (sign.userData.switchCounter > sign.userData.switchInterval) {
                    sign.userData.switchCounter = 0;
                    // Switch to a random ad material
                    const newMat = sign.userData.isLarge
                        ? this.assets?.getRandomLargeAdMaterial()
                        : this.assets?.getRandomAdMaterial();
                    if (newMat) {
                        sign.material = newMat;
                    }
                }
            }

            // Spotlight beam pulse animation
            if (sign.userData.isSpotlight && sign.material.opacity !== undefined) {
                const pulse = Math.sin(this.time * sign.userData.pulseSpeed + sign.userData.pulsePhase);
                sign.material.opacity = sign.userData.baseOpacity * (0.7 + pulse * 0.3);
            }
        }

        this.signUpdateCursor = end >= totalSigns ? 0 : end;
    }

    updateBlinkingLights() {
        // Throttle to 15Hz (every 4th frame) - blinking doesn't need 60Hz precision
        this.blinkUpdateCounter = (this.blinkUpdateCounter + 1) % 4;
        if (this.blinkUpdateCounter !== 0) return;

        const cameraPos = this.camera?.position || this.cameraBasePosition;
        const lodScale = this.lodScale || 1.0;
        const farDist = this.signLodConfig.farDistance * lodScale;
        const farDistSq = farDist * farDist;

        this.streetLights.forEach((light) => {
            // OPTIMIZED: InstancedMesh processing for lanterns
            if (light.isInstancedMesh && light.userData.instances) {
                const dummy = this._lanternDummy || (this._lanternDummy = new THREE.Object3D());

                // Update every instance
                light.userData.instances.forEach((data, i) => {
                    // Capture base Y if not set
                    // Note: for instanced mesh we need to trust the data.y is the base

                    // Gentle sine wave float
                    const floatY = Math.sin(this.time * data.floatSpeed + data.floatOffset);

                    dummy.position.set(data.x, data.y + floatY * 2.5, data.z);
                    dummy.updateMatrix();
                    light.setMatrixAt(i, dummy.matrix);
                });

                light.instanceMatrix.needsUpdate = true;
                return;
            }

            // Type 1: Blinking rooftop beacon
            if (light.userData.blinkPhase !== undefined) {
                const data = light.userData || (light.userData = {});
                if (!data.worldPos) {
                    data.worldPos = new THREE.Vector3();
                    data.worldPosCached = false;
                }
                if (!data.worldPosCached) {
                    light.getWorldPosition(data.worldPos);
                    data.worldPosCached = true;
                }
                const dx = data.worldPos.x - cameraPos.x;
                const dz = data.worldPos.z - cameraPos.z;
                if ((dx * dx + dz * dz) > farDistSq) return;

                const alpha = this.computeBlinkAlpha(light, this.time);
                if (light.isLight) {
                    if (light.userData.baseIntensity === undefined) {
                        light.userData.baseIntensity = light.intensity;
                    }
                    light.intensity = light.userData.baseIntensity * alpha;
                    light.visible = alpha > 0.02;
                } else {
                    light.visible = alpha > 0.05;
                }
            }
            // Type 2: Floating Lantern (Individual - Legacy or Fallback)
            else if (light.userData.floatSpeed !== undefined) {
                // Capture base Y if not set
                if (light.userData.initialY === undefined) {
                    light.userData.initialY = light.position.y;
                }

                // Gentle sine wave float
                const floatY = Math.sin(this.time * light.userData.floatSpeed + light.userData.floatOffset);
                light.position.y = light.userData.initialY + floatY * 2.5;

                // Subtle rotation
                light.rotation.y += 0.02; // Increased to compensate for throttling
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stopLegacyMusicSource() {
        if (this.musicSource && typeof this.musicSource.stop === 'function') {
            try {
                this.musicSource.stop();
            } catch {
                // Source may already be stopped/disposed.
            }
        }
        this.musicSource = null;
    }

    stop() {
        console.log('[NeonDistrict] Stopping...');

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.isAnimating = false;
        if (this.clock?.stop) this.clock.stop();
        this.stopLegacyMusicSource();

        super.stop();
    }

    resume() {
        console.log('[NeonDistrict] resume() called');
        const resumed = super.resume();
        if (!resumed) return false;

        if (!this.renderer || !this.scene || !this.camera) {
            return false;
        }

        const container = document.getElementById('neon-district-theme');
        if (container && this.renderer.domElement && !this.renderer.domElement.parentNode) {
            container.appendChild(this.renderer.domElement);
        }

        this.applyRenderScale(true);
        this.startAnimation();
        return true;
    }

    cleanup() {
        console.log('[NeonDistrict] Cleaning up...');
        this.stopLegacyMusicSource();

        // Dispose geometries and materials
        this.buildings.forEach((building) => {
            building.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        });

        this.outerBuildingInstances.forEach((mesh) => {
            if (this.scene) {
                this.scene.remove(mesh);
            }
        });
        this.outerBuildingInstances = [];

        if (this.outerBuildingGeometry) {
            this.outerBuildingGeometry.dispose();
            this.outerBuildingGeometry = null;
        }

        this.hlodMeshes.forEach((mesh) => {
            if (this.scene) {
                this.scene.remove(mesh);
            }
            if (mesh.geometry) mesh.geometry.dispose();
        });
        this.hlodMeshes = [];

        if (this.tier2InstanceMesh) {
            if (this.scene) {
                this.scene.remove(this.tier2InstanceMesh);
            }
            this.tier2InstanceMesh = null;
        }

        if (this.tier2InstanceGeometry) {
            this.tier2InstanceGeometry.dispose();
            this.tier2InstanceGeometry = null;
        }
        this.tier2Bounds = [];

        this.rooftopBatchMeshes.forEach((mesh) => {
            if (mesh.geometry) mesh.geometry.dispose();
        });
        this.rooftopBatchMeshes = [];

        if (this.rooftopMaterials) {
            Object.values(this.rooftopMaterials).forEach((material) => {
                if (material && material.dispose) material.dispose();
            });
            this.rooftopMaterials = null;
        }
        this.rooftopPropsBatched = false;

        if (this.rooftopBeaconGeometry) {
            this.rooftopBeaconGeometry.dispose();
            this.rooftopBeaconGeometry = null;
        }

        if (this.rooftopBeaconMaterial) {
            this.rooftopBeaconMaterial.dispose();
            this.rooftopBeaconMaterial = null;
        }

        this.freeStandingBeacons.forEach((beacon) => {
            if (this.scene) {
                this.scene.remove(beacon);
            }
            if (beacon.geometry) beacon.geometry.dispose();
            if (beacon.material) beacon.material.dispose();
        });
        this.freeStandingBeacons = [];

        this.neonSigns.forEach((sign) => {
            if (sign.geometry) sign.geometry.dispose();
            if (sign.material) sign.material.dispose();
        });

        this.billboardLights.forEach((light) => {
            if (this.scene) {
                this.scene.remove(light);
            }
        });
        this.billboardLights = [];

        Object.values(this.billboardInstances).forEach((mesh) => {
            if (mesh && this.scene) this.scene.remove(mesh);
            if (mesh?.geometry) mesh.geometry.dispose();
            if (mesh?.material) mesh.material.dispose();
        });
        this.billboardInstances = { small: null, large: null };

        Object.values(this.adInstanceMeshes).forEach((mesh) => {
            if (mesh && this.scene) this.scene.remove(mesh);
            if (mesh?.geometry) mesh.geometry.dispose();
            if (mesh?.material) mesh.material.dispose();
        });
        this.adInstanceMeshes = { small: null, large: null };
        this.instancedBillboardUniforms = [];

        if (this.rainParticles) {
            this.rainParticles.geometry.dispose();
            this.rainParticles.material.dispose();
        }
        if (this.rainForegroundParticles) {
            this.rainForegroundParticles.geometry.dispose();
            this.rainForegroundParticles.material.dispose();
        }

        if (this.rainStreakTexture) {
            this.rainStreakTexture.dispose();
            this.rainStreakTexture = null;
        }
        this.rainInstanceData = null;
        this.rainInstanceDummy = null;
        this.rainForegroundInstanceData = null;
        this.rainForegroundMaterial = null;

        if (this.splashParticles) {
            this.splashParticles.geometry.dispose();
            this.splashParticles.material.dispose();
        }

        // Clear shader material references
        this.rainMaterial = null;
        this.splashMaterial = null;

        // Dispose piece lock sparks
        this.pieceLockSparks.forEach((spark) => {
            if (spark.userData?.poolType === 'spark') {
                if (spark.material) spark.material.dispose();
            } else {
                if (spark.geometry) spark.geometry.dispose();
                if (spark.material) spark.material.dispose();
            }
        });
        this.pieceLockSparks = [];
        this.sparkPool.forEach((spark) => {
            if (spark.material) spark.material.dispose();
        });
        this.sparkPool = [];
        if (this.sparkGeometry) {
            this.sparkGeometry.dispose();
            this.sparkGeometry = null;
        }

        this.flyingVehicles.forEach((vehicle) => {
            vehicle.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });

        // Dispose shared spinner resources
        if (this.spinnerResources) {
            Object.values(this.spinnerResources).forEach((resource) => {
                if (resource && typeof resource.dispose === 'function') {
                    resource.dispose();
                }
            });
            this.spinnerResources = null;
        }

        // Dispose ground-traffic instances (driving cars)
        if (this.groundCarInstances) {
            Object.values(this.groundCarInstances).forEach((mesh) => {
                if (!mesh) return;
                if (this.scene) this.scene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) mesh.material.dispose();
            });
            this.groundCarInstances = null;
            this.groundCarData = null;
            this.groundCarLanes = null;
        }

        if (this.sky) {
            if (this.scene) this.scene.remove(this.sky);
            this.sky.geometry.dispose();
            this.sky.material.dispose();
            this.sky = null;
        }

        if (this.moon) {
            if (this.scene) this.scene.remove(this.moon);
            this.moon.geometry.dispose();
            this.moon.material.dispose();
            this.moon = null;
            this.moonUniforms = null;
        }

        this.skyStrata.forEach((strata) => {
            if (this.scene) this.scene.remove(strata);
            if (strata.geometry) strata.geometry.dispose();
            if (strata.material) strata.material.dispose();
        });
        this.skyStrata = [];
        this.skyStrataUniforms = [];

        // AAA Phase 4c: dispose sheet-lightning
        if (this.skyFlash) {
            if (this.scene) this.scene.remove(this.skyFlash);
            if (this.skyFlash.geometry) this.skyFlash.geometry.dispose();
            if (this.skyFlash.material) this.skyFlash.material.dispose();
            this.skyFlash = null;
            this.skyFlashUniform = null;
        }

        if (this.starfield) {
            if (this.scene) this.scene.remove(this.starfield);
            this.starfield.geometry.dispose();
            this.starfield.material.dispose();
            this.starfield = null;
        }

        // Clear arrays
        this.buildings = [];
        this.neonSigns = [];
        this.flyingVehicles = [];
        this.streetLights = [];
        this.adInstanceBuckets = { small: [], large: [] };
        this.instancedBillboardUniforms = [];

        // AAA Phase 1: dispose wet-street reflection resources
        if (this.groundReflector) {
            if (this.scene && this.groundReflector.target?.parent) {
                this.groundReflector.target.parent.remove(this.groundReflector.target);
            }
            if (this.groundReflector.dispose) this.groundReflector.dispose();
            this.groundReflector = null;
        }
        if (this.scene) this.scene.environment = null;
        if (this.hdrEnvMap?.dispose) this.hdrEnvMap.dispose();
        this.hdrEnvMap = null;
        if (this.proceduralEnvMap?.dispose) this.proceduralEnvMap.dispose();
        this.proceduralEnvMap = null;

        // Dispose composer
        if (this.composer) {
            // this.composer.dispose(); // Moved to stop()
            // this.composer = null; // Moved to stop()
        }

        if (this.post) {
            this.post.dispose();
            this.post = null;
        }

        // Dispose renderer
        if (this.renderer) {
            // this.disposeRenderer(this.renderer, { nullInstance: false }); // Moved to stop()
            // this.renderer = null; // Moved to stop()
        }

        // Dispose SynthCity assets
        if (this.assets) {
            this.assets.dispose();
            this.assets = null;
        }

        this.scene = null;
        this.camera = null;
        this.sceneInitialized = false;
        this.isCreatingScene = false;
        this.isAnimating = false;
        this.backgroundLoadPromise = null;
        this.prewarmPromise = null;
        this.prewarmRequested = false;
        this.prewarmEnabled = false;
        this.syncLoadEnabled = false;

        super.cleanup();
        console.log('[NeonDistrict] Cleanup complete');
    }
}
