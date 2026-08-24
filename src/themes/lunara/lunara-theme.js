/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Lunara Theme — Twin-Moon Crystal Planet (WebGPU AAA rework).
 *
 * A cinematic alien night-side scene rendered through Three.js + WebGPU
 * (with WebGL2 fallback). Twin moons (large violet primary + small red/pink
 * companion) hang above a crystal-spire valley filled with bioluminescent
 * flora, drifting motes, and volumetric haze.
 *
 * See docs/LUNARA_WEBGPU_UPGRADE_PLAN.md for the full design intent.
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { LUNARA_TETROMINOS } from './lunara-tetrominos.js';
import { compileGroupThroughPost } from '../../rendering/odyssey/warmup/post-target-compile.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import {
    createLunaraSkyMaterialWebGPU,
    createLunaraSkyMaterialWebGL,
    createLunaraStarMaterialWebGPU,
    createLunaraStarMaterialWebGL,
    createLunaraAuroraMaterialWebGPU,
    createLunaraAuroraMaterialWebGL,
    createLunaraMoonMaterialWebGPU,
    createLunaraMoonMaterialWebGL,
    createLunaraMoonHaloMaterialWebGPU,
    createLunaraMoonHaloMaterialWebGL,
    createLunaraAtmosphereMaterialWebGPU,
    createLunaraAtmosphereMaterialWebGL,
    createLunaraRingMaterialWebGPU,
    createLunaraRingMaterialWebGL,
    createLunaraMountainMaterialWebGPU,
    createLunaraMountainMaterialWebGL,
    createLunaraCrystalMaterialWebGPU,
    createLunaraCrystalMaterialWebGL,
    createLunaraCausticMaterialWebGPU,
    createLunaraCausticMaterialWebGL,
    createLunaraFloraMaterialWebGPU,
    createLunaraFloraMaterialWebGL,
    createLunaraMoteMaterialWebGPU,
    createLunaraMoteMaterialWebGL,
    createLunaraFogMaterialWebGPU,
    createLunaraFogMaterialWebGL,
    createLunaraGroundMaterialWebGPU,
    createLunaraGroundMaterialWebGL,
} from './lunara-materials.js';
import { LunaraPost } from './lunara-post.js';
import { LunaraMoteCompute } from './lunara-compute.js';
import { LunaraReactionParticles } from './lunara-reaction-particles.js';
import {
    createLunaraDetailTextureSet,
    disposeLunaraDetailTextureSet,
    loadLunaraHdriEnvironment,
} from './lunara-assets.js';

const QUALITY_PRESETS = {
    Minimal: {
        pixelRatioCap: 0.5,
        postResolutionScale: 0.42,
        minPostResolutionScale: 0.34,
        starCount: 450,
        crystalCount: 24,
        rockCount: 16,
        floraCount: 0,
        horizonLightCount: 8,
        moteCount: 0,
        reactionParticleCount: 0,
        reactionHeroShardCount: 0,
        reactionRibbonCount: 0,
        fogCards: 1,
        nebulaCards: 1,
        lightShafts: 1,
        bloomStrength: 0.32,
        bloomRadius: 0.32,
        bloomThreshold: 0.4,
        bloomDownsample: 0.24,
        useCompute: false,
        useMRT: false,
    },
    Low: {
        pixelRatioCap: 0.54,
        postResolutionScale: 0.46,
        minPostResolutionScale: 0.36,
        starCount: 750,
        crystalCount: 36,
        rockCount: 30,
        floraCount: 18,
        horizonLightCount: 16,
        moteCount: 800,
        reactionParticleCount: 260,
        reactionHeroShardCount: 32,
        reactionRibbonCount: 4,
        fogCards: 2,
        nebulaCards: 1,
        lightShafts: 1,
        bloomStrength: 0.38,
        bloomRadius: 0.34,
        bloomThreshold: 0.39,
        bloomDownsample: 0.25,
        useCompute: true,
        useMRT: false,
    },
    Medium: {
        pixelRatioCap: 0.58,
        postResolutionScale: 0.48,
        minPostResolutionScale: 0.38,
        starCount: 900,
        crystalCount: 48,
        rockCount: 38,
        floraCount: 32,
        horizonLightCount: 18,
        moteCount: 1100,
        reactionParticleCount: 520,
        reactionHeroShardCount: 56,
        reactionRibbonCount: 6,
        fogCards: 2,
        nebulaCards: 2,
        lightShafts: 1,
        bloomStrength: 0.44,
        bloomRadius: 0.38,
        bloomThreshold: 0.38,
        bloomDownsample: 0.3,
        useCompute: true,
        useMRT: false,
    },
    High: {
        pixelRatioCap: 0.62,
        postResolutionScale: 0.5,
        minPostResolutionScale: 0.36,
        starCount: 900,
        crystalCount: 48,
        rockCount: 34,
        floraCount: 36,
        horizonLightCount: 16,
        moteCount: 900,
        reactionParticleCount: 900,
        reactionHeroShardCount: 96,
        reactionRibbonCount: 10,
        fogCards: 1,
        nebulaCards: 2,
        lightShafts: 1,
        bloomStrength: 0.42,
        bloomRadius: 0.42,
        bloomThreshold: 0.42,
        bloomDownsample: 0.28,
        useCompute: true,
        useMRT: false,
    },
    Ultra: {
        pixelRatioCap: 1.12,
        postResolutionScale: 0.82,
        minPostResolutionScale: 0.62,
        starCount: 1900,
        crystalCount: 105,
        rockCount: 90,
        floraCount: 110,
        horizonLightCount: 48,
        moteCount: 3000,
        reactionParticleCount: 1400,
        reactionHeroShardCount: 144,
        reactionRibbonCount: 14,
        fogCards: 3,
        nebulaCards: 4,
        lightShafts: 3,
        bloomStrength: 0.46,
        bloomRadius: 0.46,
        bloomThreshold: 0.41,
        bloomDownsample: 0.58,
        useCompute: true,
        useMRT: true,
    },
    Extreme: {
        pixelRatioCap: 1.24,
        postResolutionScale: 0.9,
        minPostResolutionScale: 0.68,
        starCount: 2300,
        crystalCount: 135,
        rockCount: 115,
        floraCount: 145,
        horizonLightCount: 64,
        moteCount: 4000,
        reactionParticleCount: 1900,
        reactionHeroShardCount: 208,
        reactionRibbonCount: 18,
        fogCards: 3,
        nebulaCards: 5,
        lightShafts: 3,
        bloomStrength: 0.48,
        bloomRadius: 0.48,
        bloomThreshold: 0.4,
        bloomDownsample: 0.68,
        useCompute: true,
        useMRT: true,
    },
};

const LEGACY_DOM_CHILDREN = [
    'lunara-sky',
    'lunara-stars',
    'lunara-aurora',
    'lunara-planets',
    'lunara-mountains-distant',
    'lunara-mountains-mid',
    'lunara-forest-left',
    'lunara-forest-right',
    'lunara-snowfield',
    'lunara-fog',
    'lunara-grain',
];

const CELESTIAL_DEPTH_ANCHOR = new THREE.Vector3(0, 7.4, 42);
const MOON_DEPTH_MULTIPLIER = 5.0;
const DISTANT_PLANET_DEPTH_MULTIPLIER = 2.0;

function pushCelestialDepth(basePosition, depthMultiplier) {
    return CELESTIAL_DEPTH_ANCHOR.clone()
        .add(basePosition.clone().sub(CELESTIAL_DEPTH_ANCHOR).multiplyScalar(depthMultiplier));
}

const PRIMARY_MOON_BASE_POS = new THREE.Vector3(-72, 82, -360);
const COMPANION_MOON_BASE_POS = new THREE.Vector3(23, 74, -348);
const DISTANT_PLANET_BASE_POS = new THREE.Vector3(330, 118, -1700);
const PRIMARY_MOON_POS = pushCelestialDepth(PRIMARY_MOON_BASE_POS, MOON_DEPTH_MULTIPLIER);
const COMPANION_MOON_POS = pushCelestialDepth(COMPANION_MOON_BASE_POS, MOON_DEPTH_MULTIPLIER);
const DISTANT_PLANET_POS = pushCelestialDepth(DISTANT_PLANET_BASE_POS, DISTANT_PLANET_DEPTH_MULTIPLIER);
const COMPANION_ORBIT_DX = COMPANION_MOON_POS.x - PRIMARY_MOON_POS.x;
const COMPANION_ORBIT_DY = COMPANION_MOON_POS.y - PRIMARY_MOON_POS.y;
const COMPANION_ORBIT_DZ = COMPANION_MOON_POS.z - PRIMARY_MOON_POS.z;
const COMPANION_ORBIT_RADIUS = Math.hypot(COMPANION_ORBIT_DX, COMPANION_ORBIT_DY);
const COMPANION_ORBIT_INITIAL_PHASE = Math.atan2(COMPANION_ORBIT_DY, COMPANION_ORBIT_DX);
const COMPANION_ORBIT_DEPTH_RADIUS = Math.max(1, COMPANION_ORBIT_RADIUS * 1.1);
const COMPANION_ORBIT_DEPTH_PHASE = Math.asin(
    Math.max(-1, Math.min(1, COMPANION_ORBIT_DZ / COMPANION_ORBIT_DEPTH_RADIUS)),
) - COMPANION_ORBIT_INITIAL_PHASE;
const COMPANION_ORBIT_SPEED = 0.065;
const COMPANION_HALO_DEPTH_OFFSET = 4 * MOON_DEPTH_MULTIPLIER;

function setCompanionMoonOrbitPosition(target, time = 0) {
    const phase = COMPANION_ORBIT_INITIAL_PHASE + time * COMPANION_ORBIT_SPEED;
    target.set(
        PRIMARY_MOON_POS.x + Math.cos(phase) * COMPANION_ORBIT_RADIUS,
        PRIMARY_MOON_POS.y + Math.sin(phase) * COMPANION_ORBIT_RADIUS,
        PRIMARY_MOON_POS.z + Math.sin(phase + COMPANION_ORBIT_DEPTH_PHASE) * COMPANION_ORBIT_DEPTH_RADIUS,
    );
    return target;
}

const CRYSTAL_CLUSTER_CENTERS = [
    // Near-foreground framing clusters — close to camera in the lower corners
    // so a few hero spires bracket the composition and add depth.
    {
        x: -30, z: 26, spreadX: 6, spreadZ: 5, weight: 1.7, hero: true, foreground: true,
    },
    {
        x: 34, z: 22, spreadX: 7, spreadZ: 5, weight: 1.6, hero: true, foreground: true,
    },
    {
        x: -34, z: 8, spreadX: 7, spreadZ: 7, weight: 1.55, hero: true,
    },
    {
        x: 38, z: 1, spreadX: 8, spreadZ: 8, weight: 1.45, hero: true,
    },
    {
        x: -58, z: -24, spreadX: 10, spreadZ: 8, weight: 1.35, hero: true,
    },
    {
        x: 62, z: -32, spreadX: 12, spreadZ: 10, weight: 1.25, hero: true,
    },
    {
        x: -38, z: -72, spreadX: 16, spreadZ: 15, weight: 1.05,
    },
    {
        x: 42, z: -82, spreadX: 18, spreadZ: 14, weight: 1.0,
    },
    {
        x: -80, z: -112, spreadX: 24, spreadZ: 18, weight: 0.8,
    },
    {
        x: 84, z: -126, spreadX: 26, spreadZ: 22, weight: 0.85,
    },
    {
        x: -22, z: -156, spreadX: 30, spreadZ: 20, weight: 0.6,
    },
    {
        x: 30, z: -174, spreadX: 34, spreadZ: 24, weight: 0.55,
    },
];

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

function triangleNoise(value) {
    return Math.abs((value % 2) - 1);
}

function shouldForceWebGL() {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('forceWebGL') === '1' || params.get('lunaraForceWebGL') === '1';
}

function makeSeededRandom(seed) {
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state <= 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function addPointSpriteUv(geometry, count) {
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        uvs[i * 2 + 0] = 0.5;
        uvs[i * 2 + 1] = 0.5;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

export default class LunaraTheme extends BaseTheme {
    constructor() {
        super('lunara');
        this.resourceProfile = 'heavy-gpu';

        this.activeQualityLevel = 'High';
        this.preset = QUALITY_PRESETS.High;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.cameraTarget = new THREE.Vector3(0, 7.2, -190);
        this.clock = new THREE.Clock();
        this.time = 0;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            maxColorAttachments: 1,
            useMRT: false,
            useCompute: false,
        };
        this.performanceState = {
            frameCount: 0,
            frameTimeEmaMs: 16.67,
            postResolutionScale: this.preset.postResolutionScale ?? 1,
            targetPostResolutionScale: this.preset.postResolutionScale ?? 1,
            minPostResolutionScale: this.preset.minPostResolutionScale ?? 0.65,
            lastAdjustmentTime: -Infinity,
        };

        this.post = null;
        this.environmentMap = null;
        this.hdriEnvironmentMap = null;
        this.cancelHdriLoad = null;
        this.detailTextures = null;
        this.boundResizeHandler = this.onResize.bind(this);
        this.eventUnsubscribers = [];

        // Scene elements
        this.skyMaterial = null;
        this.starMaterial = null;
        this.starPoints = null;
        this.moonPrimaryMaterial = null;
        this.moonCompanionMaterial = null;
        this.moonPrimaryMesh = null;
        this.moonCompanionMesh = null;
        this.moonPrimaryHalo = null;
        this.moonCompanionHalo = null;
        this.moonPrimaryHaloMaterial = null;
        this.moonCompanionHaloMaterial = null;
        this.moonPrimaryAtmosphere = null;
        this.moonCompanionAtmosphere = null;
        this.moonAtmospheres = [];
        this.moonAtmosphereMaterials = [];
        this.companionOrbitPosition = new THREE.Vector3();
        this.distantPlanet = null;
        this.distantPlanetMaterial = null;
        this.distantPlanetRing = null;
        this.mountainsDistant = null;
        this.mountainsMid = null;
        this.mountainsNear = null;
        this.mountainLayers = [];
        this.crystalCluster = null;
        this.crystalMeshes = [];
        this.crystalMaterial = null;
        this.crystalMaterials = [];
        this.causticMeshes = [];
        this.causticMaterials = [];
        this.rockField = null;
        this.rockMaterial = null;
        this.valleyStream = null;
        this.valleyStreamMaterial = null;
        this.floraSprites = [];
        this.floraMaterial = null;
        this.floraBulbMeshes = [];
        this.floraBulbMaterials = [];
        this.horizonLights = [];
        this.horizonLightMaterials = [];
        this.motesPoints = null;
        this.moteMaterial = null;
        this.moteCompute = null;
        this.moteCpuFallback = null;
        this.nebulaClouds = [];
        this.auroraMeshes = [];
        this.auroraMaterials = [];
        this.lightShafts = [];
        this.fogCardMaterials = [];
        this.groundMesh = null;
        this.groundMaterial = null;
        this.baseVeinStrength = undefined;
        this.shockwaves = [];
        this.reactionFx = null;

        this.directionalPrimary = null;
        this.directionalCompanion = null;

        // Pointer tracking
        this.targetPointerX = 0;
        this.targetPointerY = 0;
        this.currentPointerX = 0;
        this.currentPointerY = 0;
        this.boundPointerMoveHandler = this.onPointerMove.bind(this);

        // Reactive state
        this.comboEnergy = 0;
        this.comboFlash = 0;
        this.haloPulse = 0;
        this.postBloomPulse = 0;
        this.postExposurePulse = 0;
        this.postVignettePulse = 0;
        this.postTintPulse = 0;
        this.baseCameraFov = 57;
        this.cameraImpulse = {
            shakeAmp: 0,
            shakeRemainingMs: 0,
            shakeDurationMs: 1,
            shakePhase: 0,
            fovOffset: 0,
            dolly: 0,
        };
    }

    async init() {
        // Lazy creation in createScene().
    }

    getTetrominoConfig() {
        return LUNARA_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(level) {
        const normalized = normalizeQuality(level);
        this.activeQualityLevel = normalized;
        this.preset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
        this.resetPerformanceState();
    }

    resetPerformanceState() {
        const targetScale = this.preset.postResolutionScale ?? 1;
        this.performanceState = {
            frameCount: 0,
            frameTimeEmaMs: 16.67,
            postResolutionScale: targetScale,
            targetPostResolutionScale: targetScale,
            minPostResolutionScale: this.preset.minPostResolutionScale ?? Math.min(targetScale, 0.65),
            lastAdjustmentTime: -Infinity,
        };
    }

    getRendererPixelRatio() {
        return this.getEffectivePixelRatio(this.preset.pixelRatioCap ?? 1.0, 'theme');
    }

    shouldUseDetailTextures() {
        return this.activeQualityLevel === 'Ultra' || this.activeQualityLevel === 'Extreme';
    }

    // -----------------------------------------------------------------------
    // Scene creation
    // -----------------------------------------------------------------------

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        this.applyQualityPreset(this.getCurrentQualityLevel());

        const themeContainer = document.getElementById('lunara-theme');
        if (!themeContainer) {
            console.warn('[LunaraTheme] #lunara-theme container missing');
            return;
        }
        this.hideLegacyDom();

        const created = await this.initRenderer(themeContainer, ownerGeneration);
        if (!created) return;

        this.detailTextures = this.shouldUseDetailTextures() ? createLunaraDetailTextureSet() : null;
        this.createScenePrimitives();
        await this.setupEnvironment();
        this.createSky();
        this.createStarfield();
        this.createNebulaClouds();
        this.createAurora();
        this.createMoons();
        this.createDistantPlanet();
        this.createMountains();
        this.createGround();
        this.createValleyStream();
        this.createRockField();
        this.createCrystals();
        this.createFlora();
        this.createHorizonLights();
        this.createMotes();
        this.createFogCards();
        this.createGroundFog();
        this.createMoonLightShafts();
        this.createLights();
        this.createReactionFx();
        this.setupPost();
        this.setupEvents();
        this.attachResizeListener();
        await this.warmPipelines();
        if (ownerGeneration !== this.lifecycleGeneration) return;
        this.startAnimationLoop();
    }

    hideLegacyDom() {
        for (const id of LEGACY_DOM_CHILDREN) {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = 'none';
                el.innerHTML = '';
            }
        }
    }

    showLegacyDom() {
        for (const id of LEGACY_DOM_CHILDREN) {
            const el = document.getElementById(id);
            if (el) el.style.removeProperty('display');
        }
    }

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const force = shouldForceWebGL();
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;
        let renderer = null;

        if (!force) {
            try {
                renderer = new WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    forceWebGL: false,
                });
                await this.initializeRendererCandidate(renderer, {
                    label: 'Lunara WebGPU renderer init',
                    ownerGeneration,
                });
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose?.();
                    renderer = null;
                }
            } catch (error) {
                if (!ownsLifecycle()) return false;
                console.warn('[LunaraTheme] WebGPU init failed, using WebGL2 fallback:', error);
                renderer?.dispose?.();
                renderer = null;
            }
        }

        if (!renderer) {
            if (!ownsLifecycle()) return false;
            try {
                renderer = new THREE.WebGLRenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    powerPreference: 'high-performance',
                });
            } catch (error) {
                console.error('[LunaraTheme] No renderer backend available:', error);
                return false;
            }
        }

        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = !this.isWebGPU;

        const maxColorAttachments = renderer.capabilities?.maxColorAttachments ?? 1;
        this.capabilities = {
            webgpu: this.isWebGPU,
            maxColorAttachments,
            useMRT: this.isWebGPU && maxColorAttachments > 1 && this.preset.useMRT === true,
            useCompute: this.isWebGPU
                && (typeof renderer.computeAsync === 'function' || typeof renderer.compute === 'function')
                && this.preset.useCompute === true,
        };

        renderer.setClearColor(0x07051a, 1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.92;
        renderer.setPixelRatio(this.getRendererPixelRatio());
        renderer.setSize(width, height, false);

        renderer.domElement.id = 'lunara-renderer';
        renderer.domElement.style.cssText = (
            'position:absolute;top:0;left:0;width:100%;height:100%;'
            + 'z-index:1;pointer-events:none;'
        );
        container.appendChild(renderer.domElement);

        const backendLabel = this.isWebGPU ? 'WebGPU' : 'WebGL2';
        console.log(
            `[LunaraTheme] Renderer ready (${backendLabel}; `
            + `MRT=${this.capabilities.useMRT}; compute=${this.capabilities.useCompute})`,
        );
        return true;
    }

    createScenePrimitives() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x07051a);
        this.scene.fog = new THREE.FogExp2(0x211034, 0.00325);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(57, aspect, 0.1, 4000);
        this.baseCameraFov = this.camera.fov;
        this.camera.position.set(0, 7.4, 42);
        this.camera.lookAt(this.cameraTarget);
    }

    async setupEnvironment() {
        // Procedural IBL: build a small gradient sky dome (plus bright moon
        // emitters) and pre-filter it into an environment map so crystals, rocks
        // and ground pick up plausible reflections. Best-effort — guarded so a
        // backend without PMREM support simply renders without IBL.
        //
        // The WebGL `three` PMREMGenerator cannot render an env scene on the
        // WebGPU renderer (its cube-render path touches WebGL-only internals →
        // "reading 'buffers'"), so pick the generator + materials that match the
        // active backend, and use the async path on WebGPU (pipelines compile
        // asynchronously, so the synchronous fromScene yields a blank cube).
        try {
            const PMREMGeneratorClass = this.isWebGPU ? WEBGPU.PMREMGenerator : THREE.PMREMGenerator;
            const makeBasic = (params) => (this.isWebGPU
                ? Object.assign(new WEBGPU.MeshBasicNodeMaterial(), params)
                : new THREE.MeshBasicMaterial(params));

            const pmrem = new PMREMGeneratorClass(this.renderer);
            const envScene = new THREE.Scene();

            const domeRadius = 40;
            const domeGeo = new THREE.SphereGeometry(domeRadius, 32, 16);
            const colors = [];
            const pos = domeGeo.attributes.position;
            const top = new THREE.Color(0x05031a);
            const midC = new THREE.Color(0x2a0e54);
            const horiz = new THREE.Color(0x5a2a78);
            const tmpCol = new THREE.Color();
            for (let i = 0; i < pos.count; i++) {
                const y = pos.getY(i) / domeRadius;
                if (y > 0) tmpCol.copy(midC).lerp(top, Math.min(1, y));
                else tmpCol.copy(midC).lerp(horiz, Math.min(1, -y));
                colors.push(tmpCol.r, tmpCol.g, tmpCol.b);
            }
            domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const domeMat = makeBasic({ side: THREE.BackSide, vertexColors: true });
            const dome = new THREE.Mesh(domeGeo, domeMat);
            envScene.add(dome);

            const m1Geo = new THREE.SphereGeometry(3.2, 16, 12);
            const m1Mat = makeBasic({ color: new THREE.Color(0xc79bff) });
            const m1 = new THREE.Mesh(m1Geo, m1Mat);
            m1.position.set(-12, 10, -20);
            envScene.add(m1);
            const m2Geo = new THREE.SphereGeometry(1.7, 12, 8);
            const m2Mat = makeBasic({ color: new THREE.Color(0xff86ad) });
            const m2 = new THREE.Mesh(m2Geo, m2Mat);
            m2.position.set(9, 8, -18);
            envScene.add(m2);

            // renderer.init() was already awaited in initRenderer, so the sync
            // fromScene is valid on both backends (fromSceneAsync is deprecated).
            const rt = pmrem.fromScene(envScene, 0.04);
            if (rt?.texture) {
                this.environmentMap = rt.texture;
                if (this.scene) this.scene.environment = rt.texture;
            }

            domeGeo.dispose();
            domeMat.dispose();
            m1Geo.dispose();
            m1Mat.dispose();
            m2Geo.dispose();
            m2Mat.dispose();
            pmrem.dispose();
        } catch (error) {
            console.warn('[LunaraTheme] IBL environment setup skipped:', error);
            this.environmentMap = null;
        }

        this.cancelHdriLoad = loadLunaraHdriEnvironment(this.renderer, this.scene, (environment) => {
            this.hdriEnvironmentMap = environment;
        });
    }

    createSky() {
        const geometry = new THREE.SphereGeometry(2400, 48, 32);
        const factory = this.isWebGPU ? createLunaraSkyMaterialWebGPU : createLunaraSkyMaterialWebGL;
        const { material } = factory({
            zenith: new THREE.Color(0x030214),
            mid: new THREE.Color(0x1b0742),
            horizon: new THREE.Color(0x431a5e),
            horizonWarm: new THREE.Color(0x8f3866), // deeper rose so the band doesn't blow to white
            nebula: new THREE.Color(0xb6a1ff),
            nebulaIntensity: 0.26,
        });
        this.skyMaterial = material;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
    }

    createStarfield() {
        const count = this.preset.starCount;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const twinkleSpeeds = new Float32Array(count);
        const spikes = new Float32Array(count);

        const rng = makeSeededRandom(8423);
        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xc6cfff),
            new THREE.Color(0xffd2f2),
            new THREE.Color(0xc8a4ff),
            new THREE.Color(0x9fe8ff), // cool cyan for variety
        ];

        // Cheap CPU clustering field so stars form constellations/voids instead
        // of a uniform spray (mirrors the GPU value-noise look).
        const clusterField = (x, y, z) => {
            const a = Math.sin(x * 1.7 + y * 2.3 + z * 1.1) * 0.5 + 0.5;
            const b = Math.sin(x * 4.1 - y * 1.3 + z * 3.7) * 0.5 + 0.5;
            const c = Math.sin(x * 8.6 + y * 5.2 - z * 2.4) * 0.5 + 0.5;
            return a * 0.5 + b * 0.32 + c * 0.18;
        };

        for (let i = 0; i < count; i++) {
            // Distribute across an upper hemisphere with accept/reject clustering.
            let dx; let dy; let dz; let len; let nx; let ny; let nz;
            let tries = 0;
            do {
                dx = rng() * 2 - 1;
                dy = rng() * 1.6 - 0.05;
                dz = rng() * 2 - 1;
                len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                nx = dx / (len || 1);
                ny = dy / (len || 1);
                nz = dz / (len || 1);
                tries += 1;
                const density = clusterField(nx * 3.2, ny * 3.2, nz * 3.2);
                if (rng() < 0.28 + 0.72 * density) break;
            } while (len < 0.1 || tries < 4);

            const r = 1500 + rng() * 350;
            positions[i * 3 + 0] = nx * r;
            positions[i * 3 + 1] = ny * r;
            positions[i * 3 + 2] = nz * r;

            const palette = starColors[Math.floor(rng() * starColors.length)];
            const tint = 0.7 + rng() * 0.3;

            // ~3.5% hero stars: brighter, whiter, with diffraction spikes.
            const isHero = rng() < 0.035;
            spikes[i] = isHero ? 1.0 : 0.0;
            const boost = isHero ? 1.35 : 1.0;
            colors[i * 3 + 0] = Math.min(1, palette.r * tint * boost);
            colors[i * 3 + 1] = Math.min(1, palette.g * tint * boost);
            colors[i * 3 + 2] = Math.min(1, palette.b * tint * boost);

            sizes[i] = isHero ? 2.6 + rng() * 2.4 : 0.9 + rng() * 2.0;
            phases[i] = rng() * Math.PI * 2;
            twinkleSpeeds[i] = 0.6 + rng() * 1.4;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
        geometry.setAttribute('aSpike', new THREE.BufferAttribute(spikes, 1));
        addPointSpriteUv(geometry, count);

        const factory = this.isWebGPU ? createLunaraStarMaterialWebGPU : createLunaraStarMaterialWebGL;
        const { material } = factory();
        this.starMaterial = material;
        this.starPoints = new THREE.Points(geometry, material);
        this.starPoints.frustumCulled = false;
        this.scene.add(this.starPoints);
    }

    createAurora() {
        const level = this.activeQualityLevel;
        if (level === 'Minimal' || level === 'Low') return;

        const specs = [
            {
                x: -150,
                y: 150,
                z: -560,
                w: 460,
                h: 280,
                rot: -0.16,
                low: 0x32ffc4,
                high: 0xb45cff,
                opacity: 0.14,
            },
            {
                x: 190,
                y: 178,
                z: -610,
                w: 540,
                h: 300,
                rot: 0.12,
                low: 0x46e6ff,
                high: 0xff6ad0,
                opacity: 0.10,
            },
            {
                x: 30,
                y: 214,
                z: -680,
                w: 660,
                h: 250,
                rot: -0.05,
                low: 0x5effb0,
                high: 0xc77bff,
                opacity: 0.075,
            },
        ];
        const count = level === 'Medium' || level === 'High' ? 1 : specs.length;
        const factory = this.isWebGPU ? createLunaraAuroraMaterialWebGPU : createLunaraAuroraMaterialWebGL;

        for (let i = 0; i < count; i++) {
            const spec = specs[i];
            const geo = new THREE.PlaneGeometry(spec.w, spec.h, 1, 1);
            const { material } = factory({
                colorLow: new THREE.Color(spec.low),
                colorHigh: new THREE.Color(spec.high),
                opacity: spec.opacity,
            });
            this.auroraMaterials.push(material);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(spec.x, spec.y, spec.z);
            mesh.rotation.z = spec.rot;
            mesh.renderOrder = -3;
            mesh.frustumCulled = false;
            this.auroraMeshes.push(mesh);
            this.scene.add(mesh);
        }
    }

    createNebulaClouds() {
        const count = this.preset.nebulaCards ?? 0;
        if (count <= 0) return;

        const factory = this.isWebGPU ? createLunaraFogMaterialWebGPU : createLunaraFogMaterialWebGL;
        const rng = makeSeededRandom(62041);
        const colors = [
            new THREE.Color(0xc38cff),
            new THREE.Color(0xff70cf),
            new THREE.Color(0x7966ff),
            new THREE.Color(0x84ddff),
        ];

        for (let i = 0; i < count; i++) {
            const isMilkyBand = i === 0;
            const width = isMilkyBand ? 980 : 360 + rng() * 240;
            const height = isMilkyBand ? 190 : 90 + rng() * 120;
            const geo = new THREE.PlaneGeometry(width, height, 1, 1);
            const tint = colors[i % colors.length].clone().lerp(new THREE.Color(0xffffff), rng() * 0.18);
            const { material } = factory({
                color: tint,
                opacity: isMilkyBand ? 0.105 : 0.055 + rng() * 0.04,
                scroll: new THREE.Vector2(0.004 + rng() * 0.006, 0.002 + rng() * 0.004),
            });
            this.fogCardMaterials.push(material);

            const mesh = new THREE.Mesh(geo, material);
            const x = isMilkyBand ? 150 : -260 + rng() * 520;
            const y = isMilkyBand ? 112 : 72 + rng() * 120;
            const z = isMilkyBand ? -520 : -430 - rng() * 180;
            mesh.position.set(x, y, z);
            mesh.rotation.z = isMilkyBand ? -0.42 : -0.7 + rng() * 1.4;
            mesh.renderOrder = -2 + i * 0.01;
            mesh.frustumCulled = false;
            this.nebulaClouds.push(mesh);
            this.scene.add(mesh);
        }
    }

    createMoons() {
        const moonGeo = new THREE.SphereGeometry(1, 64, 48);

        // Load surface textures from public/textures (Solar System Scope 2K maps)
        const textureLoader = new THREE.TextureLoader();
        const moonSurfaceTex = textureLoader.load('./textures/2k_moon.jpg');
        const marsSurfaceTex = textureLoader.load('./textures/2k_mars.jpg');

        // Configure textures for spherical mapping
        const maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
        for (const tex of [moonSurfaceTex, marsSurfaceTex]) {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            tex.anisotropy = maxAniso;
        }

        // Primary — deep purple moon (lunar surface texture, purple-tinted)
        const primaryRadius = 42 * MOON_DEPTH_MULTIPLIER;
        const primaryFactory = this.isWebGPU ? createLunaraMoonMaterialWebGPU : createLunaraMoonMaterialWebGL;
        const primary = primaryFactory({
            surfaceMap: moonSurfaceTex,
            color: new THREE.Color(0x341071), // deep purple highlands
            shade: new THREE.Color(0x0a031c), // near-black dark side
            mariaColor: new THREE.Color(0x160645), // dark purple maria
            rimColor: new THREE.Color(0xb45cff), // violet atmospheric rim
            lightDir: new THREE.Vector3(0.6, 0.25, 1.0),
            emissive: 0.16,
        });
        this.moonPrimaryMaterial = primary.material;
        const primaryMesh = new THREE.Mesh(moonGeo, primary.material);
        primaryMesh.scale.setScalar(primaryRadius);
        primaryMesh.position.copy(PRIMARY_MOON_POS);
        primaryMesh.frustumCulled = false;
        this.moonPrimaryMesh = primaryMesh;
        this.scene.add(primaryMesh);

        // Companion — blood red moon (mars surface texture, red-tinted)
        const companionRadius = 19.5 * MOON_DEPTH_MULTIPLIER;
        const companion = primaryFactory({
            surfaceMap: marsSurfaceTex,
            color: new THREE.Color(0xbd235a), // warm magenta highlands
            shade: new THREE.Color(0x210515), // near-black dark side
            mariaColor: new THREE.Color(0x511033), // dark crimson maria
            rimColor: new THREE.Color(0xff5faa), // pink atmospheric rim
            lightDir: new THREE.Vector3(-0.5, 0.2, 1.0),
            emissive: 0.18,
        });
        this.moonCompanionMaterial = companion.material;
        const companionMesh = new THREE.Mesh(moonGeo, companion.material);
        companionMesh.scale.setScalar(companionRadius);
        setCompanionMoonOrbitPosition(companionMesh.position, 0);
        companionMesh.frustumCulled = false;
        this.moonCompanionMesh = companionMesh;
        this.scene.add(companionMesh);

        // Atmospheric scattering shells — true 3D limb glow hugging each disc.
        const atmoFactory = this.isWebGPU
            ? createLunaraAtmosphereMaterialWebGPU
            : createLunaraAtmosphereMaterialWebGL;
        const addAtmosphere = (moonMesh, radius, color, intensity) => {
            const atmo = atmoFactory({ color, power: 3.0, intensity });
            this.moonAtmosphereMaterials.push(atmo.material);
            const shell = new THREE.Mesh(moonGeo, atmo.material);
            shell.scale.setScalar(radius * 1.16);
            shell.position.copy(moonMesh.position);
            shell.frustumCulled = false;
            shell.renderOrder = 0;
            this.moonAtmospheres.push(shell);
            this.scene.add(shell);
            return shell;
        };
        this.moonPrimaryAtmosphere = addAtmosphere(primaryMesh, primaryRadius, new THREE.Color(0x9a5cff), 1.05);
        this.moonCompanionAtmosphere = addAtmosphere(companionMesh, companionRadius, new THREE.Color(0xff5f9e), 1.0);

        // Halos — matching deep purple and blood red
        const haloFactory = this.isWebGPU ? createLunaraMoonHaloMaterialWebGPU : createLunaraMoonHaloMaterialWebGL;
        const haloGeo = new THREE.PlaneGeometry(1, 1);

        const primaryHalo = haloFactory({
            color: new THREE.Color(0x8e42ff), // deep violet halo
            opacity: 0.58,
            power: 3.0,
        });
        this.moonPrimaryHaloMaterial = primaryHalo.material;
        this.moonPrimaryHalo = new THREE.Mesh(haloGeo, primaryHalo.material);
        this.moonPrimaryHalo.scale.setScalar(primaryRadius * 2.28);
        this.moonPrimaryHalo.position.copy(PRIMARY_MOON_POS);
        this.moonPrimaryHalo.position.z -= 3 * MOON_DEPTH_MULTIPLIER;
        this.moonPrimaryHalo.renderOrder = -1;
        this.moonPrimaryHalo.frustumCulled = false;
        this.scene.add(this.moonPrimaryHalo);

        const companionHalo = haloFactory({
            color: new THREE.Color(0xff4a9a), // pink-red halo
            opacity: 0.52,
            power: 3.0,
        });
        this.moonCompanionHaloMaterial = companionHalo.material;
        this.moonCompanionHalo = new THREE.Mesh(haloGeo, companionHalo.material);
        this.moonCompanionHalo.scale.setScalar(companionRadius * 2.18);
        this.moonCompanionHalo.position.copy(companionMesh.position);
        this.moonCompanionHalo.position.z -= COMPANION_HALO_DEPTH_OFFSET;
        this.moonCompanionHalo.renderOrder = -1;
        this.moonCompanionHalo.frustumCulled = false;
        this.scene.add(this.moonCompanionHalo);
    }

    createDistantPlanet() {
        if (this.activeQualityLevel === 'Minimal' || this.activeQualityLevel === 'Low') return;

        const loader = new THREE.TextureLoader();
        const maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
        const bodyTex = loader.load('./textures/2k_saturn.jpg');
        bodyTex.colorSpace = THREE.SRGBColorSpace;
        bodyTex.wrapS = THREE.RepeatWrapping;
        bodyTex.wrapT = THREE.ClampToEdgeWrapping;
        bodyTex.minFilter = THREE.LinearMipmapLinearFilter;
        bodyTex.magFilter = THREE.LinearFilter;
        bodyTex.generateMipmaps = true;
        bodyTex.anisotropy = maxAniso;

        const ringTex = loader.load('./textures/2k_saturn_ring_alpha.png');
        ringTex.colorSpace = THREE.SRGBColorSpace;
        ringTex.wrapS = THREE.ClampToEdgeWrapping;
        ringTex.wrapT = THREE.ClampToEdgeWrapping;
        ringTex.anisotropy = maxAniso;

        const radius = 72 * DISTANT_PLANET_DEPTH_MULTIPLIER;
        const pos = DISTANT_PLANET_POS;

        // Reuse the moon material (texture + terminator + rim) tinted gas-giant gold.
        const bodyFactory = this.isWebGPU ? createLunaraMoonMaterialWebGPU : createLunaraMoonMaterialWebGL;
        const body = bodyFactory({
            surfaceMap: bodyTex,
            color: new THREE.Color(0xe6d6a6),
            shade: new THREE.Color(0x140f06),
            mariaColor: new THREE.Color(0xb89b5e),
            rimColor: new THREE.Color(0xffe7b0),
            lightDir: new THREE.Vector3(0.55, 0.25, 1.0),
            emissive: 0.055,
        });
        this.distantPlanetMaterial = body.material;
        const sphereGeo = new THREE.SphereGeometry(1, 48, 36);
        const mesh = new THREE.Mesh(sphereGeo, body.material);
        mesh.scale.setScalar(radius);
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        mesh.renderOrder = -1;
        this.distantPlanet = mesh;
        this.scene.add(mesh);

        // Ring — flat disc sampling the radial alpha strip.
        const ringFactory = this.isWebGPU ? createLunaraRingMaterialWebGPU : createLunaraRingMaterialWebGL;
        const innerR = radius * 1.32;
        const outerR = radius * 2.35;
        const ringGeo = new THREE.PlaneGeometry(outerR * 2, outerR * 2, 1, 1);
        const ring = ringFactory({
            map: ringTex,
            color: new THREE.Color(0xece0c0),
            opacity: 0.34,
            innerRadius: innerR,
            outerRadius: outerR,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ring.material);
        ringMesh.position.copy(pos);
        ringMesh.rotation.x = -1.12; // tilt the ring plane toward camera
        ringMesh.rotation.z = 0.26;
        ringMesh.frustumCulled = false;
        ringMesh.renderOrder = -1;
        this.distantPlanetRing = ringMesh;
        this.scene.add(ringMesh);
    }

    buildRidgeGeometry(seed, segments, baseHeight, peakHeight, frequency, options = {}) {
        const rng = makeSeededRandom(seed);
        const width = options.width ?? 900;
        const floor = options.floor ?? -10;
        const spireCount = options.spireCount ?? 10;
        const spireSharpness = options.spireSharpness ?? 1.6;
        const points = segments + 1;
        const depth = options.depth ?? 36; // ridge thickness in Z (gives silhouette)
        const positions = [];
        const indices = [];

        const spires = [];
        for (let i = 0; i < spireCount; i++) {
            let center = rng() * 2 - 1;
            if (options.spireAvoidWidth && Math.abs(center) < options.spireAvoidWidth) {
                const sign = center < 0 ? -1 : 1;
                center = sign * (options.spireAvoidWidth + rng() * (1 - options.spireAvoidWidth));
            }
            spires.push({
                center,
                width: 0.025 + rng() * 0.09,
                height: peakHeight * (0.4 + rng() * 1.55),
            });
        }

        const heights = new Float32Array(points);
        for (let i = 0; i < points; i++) {
            const x = (i / segments) * 2 - 1;
            const noise1 = Math.sin(x * frequency + seed * 0.013) * 0.5;
            const noise2 = Math.sin(x * frequency * 2.4 + seed * 0.041) * 0.25;
            const noise3 = Math.sin(x * frequency * 5.1 + seed * 0.077) * 0.12;
            const terraced = (triangleNoise(x * frequency * 1.7 + seed * 0.009) - 0.5) * 0.25;
            const jitter = (rng() - 0.5) * 0.4;
            let spireLift = 0;
            for (const spire of spires) {
                const dist = Math.abs(x - spire.center) / spire.width;
                if (dist < 1) {
                    spireLift += (1 - dist) ** spireSharpness * spire.height;
                }
            }
            const valleyGap = options.valleyGapWidth
                ? Math.exp(-((x / options.valleyGapWidth) ** 2)) * (options.valleyGapDepth ?? 0)
                : 0;
            heights[i] = baseHeight
                + (noise1 + noise2 + noise3 + terraced + jitter) * peakHeight
                + spireLift
                - valleyGap;
        }

        // Build a tent/prism ridge (3 verts per column: peak, front base, back
        // base) instead of a flat 2-row wall. Peaks are jittered in Z so the
        // silhouette overlaps itself, and the front/back faces give the material
        // real normals to catch moon rim-light — killing the cardboard look.
        for (let i = 0; i < points; i++) {
            const x = ((i / segments) - 0.5) * width;
            const top = heights[i];
            const zc = Math.sin(i * 0.7 + seed * 0.05) * depth * 0.28
                + (triangleNoise(i * 0.13 + seed * 0.03) - 0.5) * depth * 0.55;
            // peak
            positions.push(x, top, zc);
            // front base
            positions.push(x, floor, zc + depth * 0.5);
            // back base
            positions.push(x, floor, zc - depth * 0.5);
        }

        for (let i = 0; i < segments; i++) {
            const p0 = i * 3;
            const f0 = p0 + 1;
            const bk0 = p0 + 2;
            const p1 = (i + 1) * 3;
            const f1 = p1 + 1;
            const bk1 = p1 + 2;
            // front faces (toward camera)
            indices.push(p0, f0, p1, p1, f0, f1);
            // back faces (reverse winding)
            indices.push(p1, bk0, p0, p1, bk1, bk0);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();
        return geom;
    }

    createMountains() {
        const mountainFactory = this.isWebGPU ? createLunaraMountainMaterialWebGPU : createLunaraMountainMaterialWebGL;

        const layers = [
            {
                key: 'mountainsDistant',
                seed: 13371,
                segments: 120,
                baseHeight: 30,
                peakHeight: 9,
                frequency: 5.8,
                z: -330,
                y: -7.5,
                color: 0x32185a,
                haze: 0x8a5bcb,
                hazeAmount: 0.78,
                width: 1150,
                depth: 90,
                spireCount: 8,
                valleyGapWidth: 0.16,
                valleyGapDepth: 7,
            },
            {
                key: 'mountainsMid',
                seed: 74212,
                segments: 132,
                baseHeight: 24,
                peakHeight: 14,
                frequency: 4.7,
                z: -225,
                y: -6.0,
                color: 0x261247,
                haze: 0x6b35a3,
                hazeAmount: 0.56,
                width: 980,
                depth: 64,
                spireCount: 14,
                valleyGapWidth: 0.32,
                valleyGapDepth: 26,
                spireAvoidWidth: 0.18,
            },
            {
                key: 'mountainsNear',
                seed: 44191,
                segments: 110,
                baseHeight: 15,
                peakHeight: 17,
                frequency: 3.9,
                z: -138,
                y: -5.2,
                color: 0x180b2f,
                haze: 0x4d1d7f,
                hazeAmount: 0.34,
                width: 760,
                depth: 46,
                spireCount: 16,
                valleyGapWidth: 0.42,
                valleyGapDepth: 42,
                spireAvoidWidth: 0.26,
            },
        ];

        for (const layer of layers) {
            const geom = this.buildRidgeGeometry(
                layer.seed,
                layer.segments,
                layer.baseHeight,
                layer.peakHeight,
                layer.frequency,
                {
                    width: layer.width,
                    floor: -18,
                    depth: layer.depth,
                    spireCount: layer.spireCount,
                    spireSharpness: layer.key === 'mountainsNear' ? 1.25 : 1.7,
                    valleyGapWidth: layer.valleyGapWidth,
                    valleyGapDepth: layer.valleyGapDepth,
                    spireAvoidWidth: layer.spireAvoidWidth,
                },
            );
            const mat = mountainFactory({
                color: new THREE.Color(layer.color),
                haze: new THREE.Color(layer.haze),
                hazeAmount: layer.hazeAmount,
                lightDir: PRIMARY_MOON_POS.clone().normalize(),
                detailMap: this.detailTextures?.mountain?.detail,
                detailScale: layer.key === 'mountainsNear' ? 0.018 : 0.012,
                detailStrength: layer.key === 'mountainsNear' ? 0.12 : 0.075,
            });
            const mesh = new THREE.Mesh(geom, mat.material);
            mesh.position.set(0, layer.y, layer.z);
            mesh.renderOrder = -1;
            this[layer.key] = mesh;
            this.mountainLayers.push(mesh);
            this.scene.add(mesh);
        }
    }

    sampleTerrainRelief(x, z) {
        const far = smoothstep(0, 1, clamp01((-z - 4) / 190));
        const valleyWidth = 20 + far * 34;
        const valley = Math.exp(-((x / valleyWidth) ** 2));
        const sideLift = clamp01((Math.abs(x) - 20) / 105) ** 1.45 * (1.0 + far * 2.7);
        const ripple = Math.sin(x * 0.043 + z * 0.026) * 0.55
            + Math.cos(z * 0.047 - x * 0.013) * 0.46
            + Math.sin((x + z) * 0.021) * 0.32
            + (triangleNoise(x * 0.031 - z * 0.018) - 0.5) * 0.28;
        const valleyCut = valley * (0.85 + far * 0.5);
        const mineralShelves = (1 - valley) ** 2.0 * Math.sin((Math.abs(x) + -z) * 0.036) * 0.22;
        return ripple + sideLift + mineralShelves - valleyCut;
    }

    sampleTerrainHeight(x, z) {
        return -3.45 + this.sampleTerrainRelief(x, z);
    }

    buildCrystalGeometry(options = {}) {
        const sides = options.sides ?? 7;
        const height = options.height ?? 3.6;
        const asymmetry = options.asymmetry ?? 0.18;
        const baseRadius = options.baseRadius ?? 0.72;
        const shoulderRadius = options.shoulderRadius ?? 0.56;
        const neckRadius = options.neckRadius ?? 0.32;
        const rng = makeSeededRandom(options.seed ?? 1207);

        const y0 = -height * 0.48;
        const y1 = -height * 0.08;
        const y2 = height * 0.28;
        const y3 = height * 0.52;
        const positions = [];
        const indices = [];
        const phase = rng() * Math.PI * 2;

        const addRing = (y, radius, twist = 0) => {
            const ring = [];
            for (let i = 0; i < sides; i++) {
                const a = phase + twist + (i / sides) * Math.PI * 2;
                const chip = 0.86 + rng() * 0.25;
                const skewX = Math.sin(y * 1.7 + i * 0.9) * asymmetry;
                const skewZ = Math.cos(y * 1.3 + i * 0.7) * asymmetry;
                positions.push(
                    Math.cos(a) * radius * chip + skewX,
                    y,
                    Math.sin(a) * radius * (0.72 + rng() * 0.18) + skewZ,
                );
                ring.push((positions.length / 3) - 1);
            }
            return ring;
        };

        const base = addRing(y0, baseRadius, 0);
        const shoulder = addRing(y1, shoulderRadius, 0.17);
        const neck = addRing(y2, neckRadius, -0.08);
        const apexOffsetX = (rng() - 0.5) * asymmetry * 1.8;
        const apexOffsetZ = (rng() - 0.5) * asymmetry * 1.4;
        positions.push(apexOffsetX, y3, apexOffsetZ);
        const apex = (positions.length / 3) - 1;
        positions.push(0, y0 - height * 0.03, 0);
        const baseCenter = (positions.length / 3) - 1;

        const connectRings = (a, b) => {
            for (let i = 0; i < sides; i++) {
                const next = (i + 1) % sides;
                indices.push(a[i], b[i], a[next]);
                indices.push(a[next], b[i], b[next]);
            }
        };
        connectRings(base, shoulder);
        connectRings(shoulder, neck);
        for (let i = 0; i < sides; i++) {
            const next = (i + 1) % sides;
            indices.push(neck[i], apex, neck[next]);
            indices.push(baseCenter, base[next], base[i]);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setIndex(indices);
        // Faceted (flat) normals so the spires read as cut crystal, not a smooth
        // cone. toNonIndexed() unwelds shared verts; computeVertexNormals then
        // yields per-face normals.
        const finalGeom = options.faceted === false ? geom : geom.toNonIndexed();
        finalGeom.computeVertexNormals();
        finalGeom.computeBoundingSphere();
        return finalGeom;
    }

    buildRockGeometry(seed = 9917) {
        const geom = new THREE.DodecahedronGeometry(1, 1);
        const pos = geom.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            const lift = 0.72 + Math.sin(i * 12.989 + seed) * 0.14;
            const spread = 0.88 + Math.cos(i * 5.113 + seed * 0.11) * 0.18;
            pos.setXYZ(i, x * spread, y * lift, z * (0.8 + Math.sin(i * 3.77) * 0.16));
        }
        pos.needsUpdate = true;
        geom.computeVertexNormals();
        geom.computeBoundingSphere();
        return geom;
    }

    createRockField() {
        const count = this.preset.rockCount ?? 0;
        if (count <= 0) return;

        const material = this.isWebGPU
            ? new WEBGPU.MeshStandardNodeMaterial()
            : new THREE.MeshStandardMaterial();
        material.color = new THREE.Color(0x21113d);
        material.roughness = 0.76;
        material.metalness = 0.2;
        material.fog = true;
        material.vertexColors = true;
        if (this.detailTextures?.rock?.normal) {
            material.normalMap = this.detailTextures.rock.normal;
            material.normalScale = new THREE.Vector2(0.22, 0.22);
        }
        if (this.detailTextures?.rock?.roughness) {
            material.roughnessMap = this.detailTextures.rock.roughness;
        }
        material.envMapIntensity = 0.42;
        if (material.emissive) {
            material.emissive.set(0x261050);
            material.emissiveIntensity = 0.18;
        }
        this.rockMaterial = material;

        const geom = this.buildRockGeometry(22193);
        const mesh = new THREE.InstancedMesh(geom, material, count);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        mesh.frustumCulled = false;

        const tmp = new THREE.Object3D();
        const color = new THREE.Color();
        const rng = makeSeededRandom(39191);
        for (let i = 0; i < count; i++) {
            const z = -10 - rng() ** 1.25 * 190;
            const far = clamp01((-z - 10) / 190);
            const side = rng() < 0.5 ? -1 : 1;
            const lane = 20 + far * 14;
            const x = side * (lane + rng() * (84 + far * 70));
            const y = this.sampleTerrainHeight(x, z);
            const nearScale = 1.2 - far * 0.55;
            const sx = (1.2 + rng() * 3.8) * nearScale;
            const sy = (0.28 + rng() * 0.95) * nearScale;
            const sz = (0.8 + rng() * 3.2) * nearScale;

            tmp.position.set(x, y + sy * 0.42, z);
            tmp.rotation.set((rng() - 0.5) * 0.38, rng() * Math.PI * 2, (rng() - 0.5) * 0.28);
            tmp.scale.set(sx, sy, sz);
            tmp.updateMatrix();
            mesh.setMatrixAt(i, tmp.matrix);

            color.setHex(rng() < 0.18 ? 0x3a1a68 : 0x21113d);
            color.lerp(new THREE.Color(0x6240a0), far * 0.18);
            mesh.setColorAt(i, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        this.rockField = mesh;
        this.scene.add(mesh);
    }

    pickCrystalCluster(rng, includeHero = true) {
        const candidates = includeHero
            ? CRYSTAL_CLUSTER_CENTERS
            : CRYSTAL_CLUSTER_CENTERS.filter((center) => !center.hero);
        const total = candidates.reduce((sum, center) => sum + center.weight, 0);
        let pick = rng() * total;
        for (const center of candidates) {
            pick -= center.weight;
            if (pick <= 0) return center;
        }
        return candidates[candidates.length - 1];
    }

    placeCrystalInstance(mesh, index, rng, options = {}) {
        const tmp = options.tmp ?? new THREE.Object3D();
        const cluster = options.cluster ?? this.pickCrystalCluster(rng, options.includeHero !== false);
        const gaussian = () => (rng() + rng() + rng()) / 3 - 0.5;
        let x = cluster.x + gaussian() * cluster.spreadX * 2.2;
        const z = cluster.z + gaussian() * cluster.spreadZ * 2.2;

        if (options.forceSidePath && Math.abs(x) < 16) {
            x += (x < 0 ? -1 : 1) * (16 + rng() * 20);
        }
        if (Math.abs(x) < 18 && z > -150) {
            x = (x < 0 ? -1 : 1) * (18 + rng() * 22);
        }

        const far = clamp01((-z - 18) / 178);
        const near = 1 - far;

        // Stature variety: a good fraction become short stubs so a cluster reads
        // as a mixed-height clump rather than a uniform "picket fence" of spires.
        const isStub = rng() < (options.stubChance ?? 0.42);
        const statureMul = isStub ? 0.26 + rng() * 0.36 : 0.82 + rng() * 0.42;

        const baseScale = (options.baseScale ?? 0.55) + rng() * (options.baseScaleJitter ?? 0.85);
        const heightScale = ((options.heightScale ?? 1.35)
            + rng() * (options.heightJitter ?? 3.8)
            + (cluster.hero ? near * 2.2 : near * 0.75)) * statureMul;
        // Stubs are chunkier; tall ones can be slender → silhouette contrast.
        const widthBias = isStub ? 1.2 + rng() * 0.55 : 0.58 + rng() * 0.5;
        const widthScale = baseScale * (options.widthMultiplier ?? widthBias);
        const y = this.sampleTerrainHeight(x, z);
        const lean = options.lean ?? 0.32;
        const sink = options.sink ?? 0.08;
        // Asymmetric, stub-amplified lean so they don't all tilt by the same hair.
        const leanMul = isStub ? 2.1 : 1.0;
        const leanX = (rng() - 0.5) * lean * leanMul;
        const leanZ = (rng() - 0.5) * lean * leanMul;

        tmp.position.set(x, y + heightScale * 1.58 - sink, z);
        tmp.rotation.set(leanX, rng() * Math.PI * 2, leanZ);
        tmp.scale.set(widthScale, heightScale, widthScale * (0.82 + rng() * 0.36));
        tmp.updateMatrix();
        mesh.setMatrixAt(index, tmp.matrix);

        if (mesh.setColorAt) {
            const color = new THREE.Color(0x8b61e8);
            const cyanChance = rng();
            if (cyanChance < 0.16) color.set(0x76dfff);
            else if (cyanChance < 0.34) color.set(0xd486ff);
            else if (cyanChance < 0.48) color.set(0xff72d1);
            color.lerp(new THREE.Color(0x351463), far * 0.42);
            mesh.setColorAt(index, color);
        }
    }

    createCrystals() {
        const factory = this.isWebGPU ? createLunaraCrystalMaterialWebGPU : createLunaraCrystalMaterialWebGL;
        const fastCrystals = this.isWebGPU
            && this.activeQualityLevel !== 'Ultra'
            && this.activeQualityLevel !== 'Extreme';
        const main = factory({
            color: new THREE.Color(0x835be0),
            emissive: new THREE.Color(0xd1a0ff),
            emissiveStrength: fastCrystals ? 0.86 : 1.0,
            opacity: 0.84,
            roughness: fastCrystals ? 0.18 : 0.1,
            metalness: fastCrystals ? 0.06 : 0.1,
            envMapIntensity: fastCrystals ? 0.82 : 1.3,
            fast: fastCrystals,
        });
        // True refraction is heavy; gate hero transmission to WebGPU + top presets.
        const allowTransmission = this.isWebGPU
            && (this.activeQualityLevel === 'Ultra' || this.activeQualityLevel === 'Extreme');
        const hero = factory({
            color: new THREE.Color(0xa486ff),
            emissive: new THREE.Color(0xcfaeff),
            emissiveStrength: fastCrystals ? 0.92 : 1.05,
            opacity: 0.76,
            roughness: fastCrystals ? 0.14 : 0.06,
            metalness: allowTransmission ? 0.0 : 0.16,
            envMapIntensity: fastCrystals ? 0.9 : 1.3,
            useTransmission: allowTransmission,
            transmission: 0.9,
            ior: 1.8,
            thickness: 3.0,
            fast: fastCrystals,
        });
        const shard = factory({
            color: new THREE.Color(0x6d47c8),
            emissive: new THREE.Color(0x7cf2ff),
            emissiveStrength: fastCrystals ? 0.72 : 0.84,
            opacity: 0.8,
            roughness: fastCrystals ? 0.2 : 0.12,
            metalness: 0.08,
            envMapIntensity: fastCrystals ? 0.72 : 1.3,
            fast: fastCrystals,
        });
        this.crystalMaterial = main.material;
        this.crystalMaterials = [main.material, hero.material, shard.material];
        // Record base emissive strength so combo surges can modulate relative to it.
        for (const mat of this.crystalMaterials) {
            const u = mat.userData?.uniforms?.uEmissiveStrength;
            if (u) mat.userData.baseEmissiveStrength = u.value;
        }

        const total = this.preset.crystalCount;
        const heroCount = Math.max(10, Math.floor(total * 0.23));
        const shardCount = Math.max(10, Math.floor(total * 0.25));
        const mainCount = Math.max(1, total - heroCount - shardCount);

        const makeMesh = (geom, material, count) => {
            const mesh = new THREE.InstancedMesh(geom, material, count);
            mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            mesh.frustumCulled = false;
            return mesh;
        };

        const mainMesh = makeMesh(
            this.buildCrystalGeometry({
                seed: 9321, sides: 7, height: 3.8, asymmetry: 0.2,
            }),
            main.material,
            mainCount,
        );
        const heroMesh = makeMesh(
            this.buildCrystalGeometry({
                seed: 4489,
                sides: 6,
                height: 4.6,
                asymmetry: 0.26,
                baseRadius: 0.78,
                shoulderRadius: 0.64,
                neckRadius: 0.34,
            }),
            hero.material,
            heroCount,
        );
        const shardMesh = makeMesh(
            this.buildCrystalGeometry({
                seed: 7757,
                sides: 5,
                height: 2.8,
                asymmetry: 0.34,
                baseRadius: 0.48,
                shoulderRadius: 0.42,
                neckRadius: 0.24,
            }),
            shard.material,
            shardCount,
        );

        const tmp = new THREE.Object3D();
        const rng = makeSeededRandom(91713);

        for (let i = 0; i < mainCount; i++) {
            this.placeCrystalInstance(mainMesh, i, rng, {
                tmp,
                includeHero: true,
                forceSidePath: true,
                baseScale: 0.38,
                baseScaleJitter: 0.82,
                heightScale: 0.95,
                heightJitter: 3.1,
                lean: 0.34,
            });
        }

        const heroClusters = CRYSTAL_CLUSTER_CENTERS.filter((cluster) => cluster.hero);
        for (let i = 0; i < heroCount; i++) {
            const cluster = heroClusters[i % heroClusters.length];
            const foreground = cluster.foreground === true;
            this.placeCrystalInstance(heroMesh, i, rng, {
                tmp,
                cluster,
                baseScale: foreground ? 0.54 : 0.68,
                baseScaleJitter: foreground ? 0.64 : 0.86,
                heightScale: foreground ? 1.38 : 1.9,
                heightJitter: foreground ? 2.25 : 3.65,
                lean: 0.24,
                sink: 0.18,
            });
        }

        for (let i = 0; i < shardCount; i++) {
            this.placeCrystalInstance(shardMesh, i, rng, {
                tmp,
                includeHero: true,
                forceSidePath: false,
                baseScale: 0.22,
                baseScaleJitter: 0.42,
                heightScale: 0.45,
                heightJitter: 1.9,
                lean: 0.7,
                widthMultiplier: 0.58,
            });
        }

        for (const mesh of [mainMesh, heroMesh, shardMesh]) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            this.crystalMeshes.push(mesh);
            this.scene.add(mesh);
        }
        this.crystalCluster = mainMesh;

        this.createCrystalCaustics(heroClusters);
    }

    createCrystalCaustics(heroClusters) {
        if (this.activeQualityLevel === 'Minimal' || this.activeQualityLevel === 'Low') return;

        const factory = this.isWebGPU
            ? createLunaraCausticMaterialWebGPU
            : createLunaraCausticMaterialWebGL;

        for (const cluster of heroClusters) {
            const { material } = factory({
                color: new THREE.Color(0x9be0ff),
                opacity: 0.3,
            });
            material.userData.baseCausticOpacity = material.userData?.uniforms?.uOpacity?.value ?? 0.4;
            this.causticMaterials.push(material);
            const size = 20 + cluster.spreadX + cluster.spreadZ;
            const geo = new THREE.PlaneGeometry(size, size);
            const mesh = new THREE.Mesh(geo, material);
            const gy = this.sampleTerrainHeight(cluster.x, cluster.z) + 0.12;
            mesh.position.set(cluster.x, gy, cluster.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.renderOrder = 2;
            mesh.frustumCulled = false;
            this.causticMeshes.push(mesh);
            this.scene.add(mesh);
        }
    }

    createFlora() {
        const count = this.preset.floraCount;
        if (count <= 0) return;

        const factory = this.isWebGPU ? createLunaraFloraMaterialWebGPU : createLunaraFloraMaterialWebGL;
        const { material } = factory({
            colorCore: new THREE.Color(0x80ffd4),
            colorEdge: new THREE.Color(0x40e8c0),
        });
        this.floraMaterial = material;

        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);
        const rng = makeSeededRandom(55177);
        for (let i = 0; i < count; i++) {
            const cluster = this.pickCrystalCluster(rng, true);
            const aroundCrystals = rng() < 0.72;
            let x = aroundCrystals
                ? cluster.x + (rng() + rng() - 1) * cluster.spreadX * 1.6
                : (rng() < 0.5 ? -1 : 1) * (24 + rng() * 82);
            const z = aroundCrystals
                ? cluster.z + (rng() + rng() - 1) * cluster.spreadZ * 1.5
                : -18 - rng() * 130;
            if (Math.abs(x) < 20) {
                x = (x < 0 ? -1 : 1) * (20 + rng() * 24);
            }
            positions[i * 3 + 0] = x;
            positions[i * 3 + 1] = this.sampleTerrainHeight(x, z) + 0.28 + rng() * 0.45;
            positions[i * 3 + 2] = z;
            phases[i] = rng() * Math.PI * 2;
            sizes[i] = 1.0 + rng() * 2.9;
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        addPointSpriteUv(geom, count);

        if (this.isWebGPU) {
            // WebGPU uses a point-sprite node material for soft bioluminescent discs.
            const points = new THREE.Points(geom, material);
            points.frustumCulled = false;
            this.floraSprites.push(points);
            this.scene.add(points);
        } else {
            // WebGL: use Points with sprite-like additive shader.
            const points = new THREE.Points(geom, material);
            points.frustumCulled = false;
            this.floraSprites.push(points);
            this.scene.add(points);
        }

        this.createFloraBulbs(count);
    }

    createFloraBulbs(sourceCount) {
        if (this.activeQualityLevel === 'Minimal' || this.activeQualityLevel === 'Low') return;

        const count = Math.min(42, Math.max(12, Math.floor(sourceCount * 0.28)));
        const bulbMaterial = this.isWebGPU
            ? new WEBGPU.MeshStandardNodeMaterial()
            : new THREE.MeshStandardMaterial();
        bulbMaterial.color = new THREE.Color(0x7dffe0);
        bulbMaterial.roughness = 0.18;
        bulbMaterial.metalness = 0.05;
        bulbMaterial.vertexColors = true;
        bulbMaterial.envMapIntensity = 0.75;
        if (bulbMaterial.emissive) {
            bulbMaterial.emissive.set(0x55ffd8);
            bulbMaterial.emissiveIntensity = 0.72;
            bulbMaterial.userData.baseEmissiveIntensity = bulbMaterial.emissiveIntensity;
        }

        const stemMaterial = this.isWebGPU
            ? new WEBGPU.MeshStandardNodeMaterial()
            : new THREE.MeshStandardMaterial();
        stemMaterial.color = new THREE.Color(0x173a48);
        stemMaterial.roughness = 0.82;
        stemMaterial.metalness = 0.04;
        stemMaterial.vertexColors = true;
        stemMaterial.envMapIntensity = 0.28;
        if (stemMaterial.emissive) {
            stemMaterial.emissive.set(0x12394c);
            stemMaterial.emissiveIntensity = 0.18;
            stemMaterial.userData.baseEmissiveIntensity = stemMaterial.emissiveIntensity;
        }

        const bulbGeo = new THREE.SphereGeometry(0.36, 14, 10);
        const stemGeo = new THREE.CylinderGeometry(0.035, 0.06, 1, 6);
        const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMaterial, count);
        const stemMesh = new THREE.InstancedMesh(stemGeo, stemMaterial, count);
        bulbMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        stemMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        bulbMesh.frustumCulled = false;
        stemMesh.frustumCulled = false;

        const heroClusters = CRYSTAL_CLUSTER_CENTERS.filter((cluster) => cluster.hero);
        const tmp = new THREE.Object3D();
        const color = new THREE.Color();
        const rng = makeSeededRandom(78131);

        for (let i = 0; i < count; i++) {
            const cluster = heroClusters[i % heroClusters.length];
            const spreadX = cluster.spreadX * (cluster.foreground ? 2.4 : 1.9);
            const spreadZ = cluster.spreadZ * (cluster.foreground ? 2.0 : 1.6);
            let x = cluster.x + (rng() + rng() - 1) * spreadX;
            const z = cluster.z + (rng() + rng() - 1) * spreadZ;
            if (Math.abs(x) < 22) x = (x < 0 ? -1 : 1) * (22 + rng() * 18);

            const groundY = this.sampleTerrainHeight(x, z);
            const far = clamp01((-z - 12) / 170);
            const stemHeight = (0.85 + rng() * 2.1) * (1.15 - far * 0.35);
            const sway = (rng() - 0.5) * 0.38;
            const yaw = rng() * Math.PI * 2;

            tmp.position.set(x, groundY + stemHeight * 0.5, z);
            tmp.rotation.set(sway * 0.2, yaw, sway);
            tmp.scale.setScalar(1);
            tmp.scale.y = stemHeight;
            tmp.updateMatrix();
            stemMesh.setMatrixAt(i, tmp.matrix);

            const bulbScale = (0.72 + rng() * 0.78) * (1.12 - far * 0.36);
            tmp.position.set(
                x + Math.sin(yaw) * stemHeight * 0.14,
                groundY + stemHeight + 0.08,
                z + Math.cos(yaw) * stemHeight * 0.14,
            );
            tmp.rotation.set(sway * 0.35, yaw, -sway * 0.25);
            tmp.scale.set(bulbScale * 0.78, bulbScale * 1.28, bulbScale * 0.72);
            tmp.updateMatrix();
            bulbMesh.setMatrixAt(i, tmp.matrix);

            color.set(rng() < 0.22 ? 0xff77d6 : 0x76ffe2);
            color.lerp(new THREE.Color(0x9274ff), rng() * 0.28 + far * 0.12);
            bulbMesh.setColorAt(i, color);
            stemMesh.setColorAt(i, new THREE.Color(0x164356).lerp(color, 0.12));
        }

        bulbMesh.instanceMatrix.needsUpdate = true;
        stemMesh.instanceMatrix.needsUpdate = true;
        if (bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true;
        if (stemMesh.instanceColor) stemMesh.instanceColor.needsUpdate = true;

        this.floraBulbMeshes.push(stemMesh, bulbMesh);
        this.floraBulbMaterials.push(stemMaterial, bulbMaterial);
        this.scene.add(stemMesh);
        this.scene.add(bulbMesh);
    }

    createHorizonLights() {
        const count = this.preset.horizonLightCount ?? 0;
        if (count <= 0) return;

        const makeLightCloud = (seed, color, offset) => {
            const lightCount = Math.max(1, Math.floor(count * 0.5));
            const positions = new Float32Array(lightCount * 3);
            const phases = new Float32Array(lightCount);
            const sizes = new Float32Array(lightCount);
            const rng = makeSeededRandom(seed);
            for (let i = 0; i < lightCount; i++) {
                const z = -82 - rng() * 128;
                const side = rng() < 0.5 ? -1 : 1;
                const x = side * (18 + rng() * 112) + Math.sin(i * 1.73 + offset) * 8;
                positions[i * 3 + 0] = x;
                positions[i * 3 + 1] = this.sampleTerrainHeight(x, z) + 0.7 + rng() * 2.8;
                positions[i * 3 + 2] = z;
                phases[i] = rng() * Math.PI * 2;
                sizes[i] = 2.4 + rng() * 5.8;
            }

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            addPointSpriteUv(geom, lightCount);
            const factory = this.isWebGPU ? createLunaraMoteMaterialWebGPU : createLunaraMoteMaterialWebGL;
            const { material } = factory({ color });
            this.horizonLightMaterials.push(material);
            const points = new THREE.Points(geom, material);
            points.frustumCulled = false;
            this.horizonLights.push(points);
            this.scene.add(points);
        };

        makeLightCloud(77231, new THREE.Color(0x78fff0), 0);
        makeLightCloud(88411, new THREE.Color(0xff73dd), 2.4);
    }

    createMotes() {
        const count = this.preset.moteCount;
        if (count <= 0) return;

        const factory = this.isWebGPU ? createLunaraMoteMaterialWebGPU : createLunaraMoteMaterialWebGL;
        const { material } = factory({});
        this.moteMaterial = material;

        if (this.capabilities.useCompute) {
            try {
                this.moteCompute = new LunaraMoteCompute(count, {
                    width: 220, height: 80, depth: 240,
                });

                const geom = new THREE.BufferGeometry();
                // Position attribute is driven by the storage buffer at draw time.
                const positionStorage = this.moteCompute.getPositionBuffer();
                geom.setAttribute('position', positionStorage);
                const phases = new Float32Array(count);
                const sizes = new Float32Array(count);
                const rng = makeSeededRandom(31199);
                for (let i = 0; i < count; i++) {
                    phases[i] = rng() * Math.PI * 2;
                    sizes[i] = 0.9 + rng() * 1.7;
                }
                geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
                geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
                addPointSpriteUv(geom, count);

                const points = new THREE.Points(geom, material);
                points.position.z = -80;
                points.frustumCulled = false;
                this.motesPoints = points;
                this.scene.add(points);
                return;
            } catch (error) {
                console.warn('[LunaraTheme] Compute mote setup failed, falling back to CPU:', error);
                this.moteCompute?.dispose?.();
                this.moteCompute = null;
            }
        }

        // CPU fallback: smaller count, random-walk update in animate loop.
        const cpuCount = Math.min(count, this.isWebGPU ? count : Math.floor(count * 0.5));
        const positions = new Float32Array(cpuCount * 3);
        const velocities = new Float32Array(cpuCount * 3);
        const phases = new Float32Array(cpuCount);
        const sizes = new Float32Array(cpuCount);
        const rng = makeSeededRandom(31199);
        for (let i = 0; i < cpuCount; i++) {
            positions[i * 3 + 0] = (rng() - 0.5) * 220;
            positions[i * 3 + 1] = (rng() - 0.5) * 80;
            positions[i * 3 + 2] = (rng() - 0.5) * 240;
            velocities[i * 3 + 0] = (rng() - 0.5) * 0.4;
            velocities[i * 3 + 1] = 0.4 + rng() * 0.6;
            velocities[i * 3 + 2] = (rng() - 0.5) * 0.3;
            phases[i] = rng() * Math.PI * 2;
            sizes[i] = 0.9 + rng() * 1.7;
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        addPointSpriteUv(geom, cpuCount);
        const points = new THREE.Points(geom, material);
        points.position.z = -80;
        points.frustumCulled = false;
        this.motesPoints = points;
        this.moteCpuFallback = {
            positions,
            velocities,
            geom,
            count: cpuCount,
        };
        this.scene.add(points);
    }

    createFogCards() {
        const count = this.preset.fogCards;
        if (count <= 0) return;

        const geo = new THREE.PlaneGeometry(360, 80);
        const factory = this.isWebGPU ? createLunaraFogMaterialWebGPU : createLunaraFogMaterialWebGL;

        for (let i = 0; i < count; i++) {
            const t = i / Math.max(1, count - 1);
            const z = -42 - t * 158;
            const opacity = 0.095 + (1 - t) * 0.075;
            const { material } = factory({
                color: new THREE.Color().setHSL(0.78 - t * 0.05, 0.5, 0.55),
                opacity,
                scroll: new THREE.Vector2(0.02 + i * 0.015, 0.008 + i * 0.004),
            });
            this.fogCardMaterials.push(material);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set((i % 2 === 0 ? -18 : 18) * t, -2 + i * 0.6, z);
            mesh.renderOrder = 5 + i;
            this.scene.add(mesh);
        }
    }

    createGroundFog() {
        const level = this.activeQualityLevel;
        if (level === 'Minimal' || level === 'Low') return;

        const factory = this.isWebGPU ? createLunaraFogMaterialWebGPU : createLunaraFogMaterialWebGL;
        const specs = [
            {
                x: -34, y: -2.2, z: -60, w: 330, h: 190, color: 0x7a5cff, opacity: 0.07, sx: 0.012, sy: 0.006,
            },
            {
                x: 58, y: -1.4, z: -110, w: 430, h: 240, color: 0x9a6bff, opacity: 0.074, sx: 0.009, sy: 0.005,
            },
            {
                x: -72, y: -0.6, z: -150, w: 500, h: 280, color: 0x5fd8ff, opacity: 0.052, sx: 0.007, sy: 0.004,
            },
        ];
        const count = level === 'Medium' ? 2 : specs.length;

        for (let i = 0; i < count; i++) {
            const s = specs[i];
            const geo = new THREE.PlaneGeometry(s.w, s.h);
            const { material } = factory({
                color: new THREE.Color(s.color),
                opacity: s.opacity,
                scroll: new THREE.Vector2(s.sx, s.sy),
            });
            this.fogCardMaterials.push(material);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(s.x, s.y, s.z);
            mesh.rotation.x = -Math.PI / 2 + 0.08; // near-flat ground mist
            mesh.renderOrder = 3;
            mesh.frustumCulled = false;
            this.scene.add(mesh);
        }
    }

    createMoonLightShafts() {
        const count = this.preset.lightShafts ?? 0;
        if (count <= 0) return;

        const factory = this.isWebGPU ? createLunaraFogMaterialWebGPU : createLunaraFogMaterialWebGL;
        const specs = [
            {
                x: -18, y: 34, z: -118, w: 92, h: 210, rot: -0.18, color: 0xb779ff, opacity: 0.07,
            },
            {
                x: 24, y: 23, z: -104, w: 62, h: 150, rot: 0.24, color: 0xff6aa8, opacity: 0.055,
            },
            {
                x: -76, y: 24, z: -70, w: 48, h: 130, rot: -0.34, color: 0x7ddfff, opacity: 0.035,
            },
        ];

        for (let i = 0; i < Math.min(count, specs.length); i++) {
            const spec = specs[i];
            const geo = new THREE.PlaneGeometry(spec.w, spec.h, 1, 1);
            const { material } = factory({
                color: new THREE.Color(spec.color),
                opacity: spec.opacity,
                scroll: new THREE.Vector2(0.006 + i * 0.002, 0.012 + i * 0.003),
            });
            this.fogCardMaterials.push(material);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(spec.x, spec.y, spec.z);
            mesh.rotation.z = spec.rot;
            mesh.renderOrder = 4 + i * 0.1;
            mesh.frustumCulled = false;
            this.lightShafts.push(mesh);
            this.scene.add(mesh);
        }
    }

    createGround() {
        const factory = this.isWebGPU ? createLunaraGroundMaterialWebGPU : createLunaraGroundMaterialWebGL;

        // Matte alien mineral valley (no normal map — the old water-normal made
        // the foreground read as an ocean). Micro-relief comes from the FBM tone
        // + emissive vein network in the material itself.
        const { material } = factory({
            color: new THREE.Color(0x231048),
            veinColor: new THREE.Color(0xc19dff),
            veinStrength: 0.28,
            detailMap: this.detailTextures?.ground?.detail,
            normalMap: this.detailTextures?.ground?.normal,
            roughnessMap: this.detailTextures?.ground?.roughness,
            detailScale: 0.035,
            detailStrength: 0.16,
        });
        this.groundMaterial = material;
        this.baseVeinStrength = material.userData?.uniforms?.uVeinStrength?.value ?? 0.28;

        const segments = ['Ultra', 'Extreme'].includes(this.activeQualityLevel) ? 140 : 96;
        const geo = new THREE.PlaneGeometry(900, 900, segments, segments);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = -pos.getY(i);
            const h = this.sampleTerrainRelief(x, z);
            pos.setZ(i, h);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = -3.5;
        mesh.receiveShadow = false;
        this.groundMesh = mesh;
        this.scene.add(mesh);
    }

    createValleyStream() {
        const rows = ['Ultra', 'Extreme'].includes(this.activeQualityLevel) ? 120 : 88;
        const cols = 5;
        const positions = [];
        const colors = [];
        const indices = [];
        const edgeColor = new THREE.Color(0x27114e);
        const violetColor = new THREE.Color(0x7f52ff);
        const cyanColor = new THREE.Color(0x72f7ff);

        for (let i = 0; i <= rows; i++) {
            const t = i / rows;
            const z = 24 - t * 254;
            const far = clamp01((-z + 6) / 230);
            const centerX = Math.sin(t * 6.2 + 0.35) * (2.6 + far * 8.0)
                + Math.sin(t * 17.5) * 1.4;
            const width = 5.6 + far * 15.5 + Math.sin(t * 9.0 + 1.2) * 1.3;

            for (let j = 0; j < cols; j++) {
                const side = (j / (cols - 1)) * 2 - 1;
                const shoulder = Math.sign(side) * (Math.abs(side) ** 1.18);
                const x = centerX + shoulder * width;
                const bankLift = Math.abs(side) ** 1.6 * (0.12 + far * 0.18);
                const y = this.sampleTerrainHeight(x, z) + 0.075 + bankLift;
                positions.push(x, y, z);

                const centerGlow = 1 - Math.min(1, Math.abs(side));
                const color = edgeColor.clone().lerp(violetColor, 0.35 + centerGlow * 0.45);
                color.lerp(cyanColor, centerGlow * (0.22 + Math.sin(t * 19.0) * 0.06));
                color.lerp(new THREE.Color(0x12091f), far * 0.12);
                colors.push(color.r, color.g, color.b);
            }
        }

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols - 1; j++) {
                const a = i * cols + j;
                const b = a + 1;
                const c = a + cols;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        const material = this.isWebGPU
            ? new WEBGPU.MeshStandardNodeMaterial()
            : new THREE.MeshStandardMaterial();
        material.color = new THREE.Color(0x2c155d);
        material.roughness = 0.38;
        material.metalness = 0.2;
        material.vertexColors = true;
        material.transparent = true;
        material.opacity = 0.62;
        material.depthWrite = true;
        material.fog = true;
        if (material.emissive) {
            material.emissive.set(0x7048ff);
            material.emissiveIntensity = 0.075;
        }

        const mesh = new THREE.Mesh(geo, material);
        mesh.renderOrder = 1;
        mesh.frustumCulled = false;
        this.valleyStream = mesh;
        this.valleyStreamMaterial = material;
        this.scene.add(mesh);
    }

    createLights() {
        const ambient = new THREE.AmbientLight(0x3c2a93, 0.5);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0x8a69e2, 0x1c082c, 0.52);
        this.scene.add(hemi);

        const primary = new THREE.DirectionalLight(0xdac0ff, 1.48);
        const dirP = PRIMARY_MOON_POS.clone().normalize();
        primary.position.copy(dirP).multiplyScalar(50);
        this.scene.add(primary);
        this.directionalPrimary = primary;

        const companion = new THREE.DirectionalLight(0xff72ad, 0.7);
        const dirC = setCompanionMoonOrbitPosition(new THREE.Vector3(), 0).normalize();
        companion.position.copy(dirC).multiplyScalar(50);
        this.scene.add(companion);
        this.directionalCompanion = companion;

        const cyanGlow = new THREE.PointLight(0x61fff0, 1.7, 96, 2.0);
        cyanGlow.position.set(-36, 4.8, 5);
        this.scene.add(cyanGlow);

        const magentaGlow = new THREE.PointLight(0xff5ed4, 1.35, 90, 2.0);
        magentaGlow.position.set(40, 4.6, -1);
        this.scene.add(magentaGlow);

        const valleyGlow = new THREE.PointLight(0x8f65ff, 0.55, 120, 2.4);
        valleyGlow.position.set(0, 1.4, -42);
        this.scene.add(valleyGlow);
    }

    createReactionFx() {
        if (!this.scene) return;
        this.reactionFx?.dispose?.();
        this.reactionFx = new LunaraReactionParticles({
            scene: this.scene,
            renderer: this.renderer,
            isWebGPU: this.isWebGPU,
            useCompute: this.capabilities.useCompute,
            quality: this.activeQualityLevel,
            preset: this.preset,
            terrainSampler: (x, z) => this.sampleTerrainHeight(x, z),
            getCamera: () => this.camera,
            getPrimaryMoonPosition: () => this.moonPrimaryMesh?.position ?? PRIMARY_MOON_POS,
            getCompanionMoonPosition: () => this.moonCompanionMesh?.position ?? COMPANION_MOON_POS,
            primaryMoonRadius: 42 * MOON_DEPTH_MULTIPLIER,
            companionMoonRadius: 19.5 * MOON_DEPTH_MULTIPLIER,
        });
        this.reactionFx.init();
    }

    setupPost() {
        try {
            const dualBloom = this.capabilities.useMRT
                && (this.activeQualityLevel === 'Ultra' || this.activeQualityLevel === 'Extreme');
            this.post = new LunaraPost(this.renderer, this.scene, this.camera, {
                useMRT: this.capabilities.useMRT,
                dualBloom,
                resolutionScale: this.performanceState.postResolutionScale,
                bloomStrength: this.preset.bloomStrength,
                bloomRadius: this.preset.bloomRadius,
                bloomThreshold: this.preset.bloomThreshold,
                bloomDownsample: this.preset.bloomDownsample,
                exposure: 0.98,
                contrast: 1.08,
                saturation: 1.16,
                tintStrength: 0.14,
                vignetteOffset: 1.05,
                vignetteDarkness: 0.28,
                grainStrength: 0.0028,
            });
            this.post.setSize(window.innerWidth, window.innerHeight);
        } catch (error) {
            console.warn('[LunaraTheme] Post initialization failed, using direct render:', error);
            this.post = null;
        }
    }

    // -----------------------------------------------------------------------
    // Frame loop
    // -----------------------------------------------------------------------

    /**
     * Warm the pipelines before the loop starts.
     *
     * MEASURED 2026-08-24 (docs/THEME_FLEET_SWEEP_2026-08.md Part B): lunara created 73 pipelines
     * and warmed none of them — 0 async, 73 sync — so 5,194 ms of GPU compile landed after the
     * switch had already resolved, third-worst in the 61-theme fleet. `createScene` went straight
     * from building materials to `startAnimationLoop`, and there is no `compileAsync` anywhere in
     * this theme.
     *
     * Bound through `compileGroupThroughPost` rather than a bare `renderer.compileAsync`: an
     * unbound call builds states keyed to a render context the post pass never looks up, because
     * r185's deferred build loop reads the live `renderer.getMRT()` per object. The recipe holds
     * the scene-pass target and MRT bound across the whole await. Zero imports, duck-typed.
     */
    async warmPipelines() {
        if (!this.renderer?.compileAsync || !this.scene || !this.camera) return;
        const scenePass = this.post?.scenePass ?? null;
        try {
            if (scenePass?.renderTarget) {
                // `PassNode.setup()` runs on the first `postProcessing.render()`, which has not
                // happened yet, so the target still carries RenderTarget defaults while the live
                // pass will take `renderer.samples`. The WebGPU pipeline cache key hashes sample
                // count, so warming against the wrong one produces pipelines that all miss on the
                // first live frame. Mirrors PassNode.js:765-767.
                scenePass.renderTarget.samples = this.renderer.samples;
                scenePass.renderTarget.texture.type = this.renderer.getOutputBufferType();
                await compileGroupThroughPost(
                    this.renderer,
                    this.post,
                    this.scene,
                    this.camera,
                    this.scene,
                    false,
                );
            } else {
                // No post stack means the theme renders straight to the canvas, so an unbound
                // compile is the correct binding rather than a missing one.
                await this.renderer.compileAsync(this.scene, this.camera);
            }
        } catch (error) {
            console.warn('[Lunara] Pipeline precompile was incomplete:', error);
        }
    }

    startAnimationLoop() {
        const animate = this.safeAnimate(() => {
            const delta = this.clock.getDelta();
            this.time += delta;
            this.update(delta);
            this.renderFrame();
            this.updateAdaptivePerformance(delta * 1000);
        });
        animate();
    }

    updateAdaptivePerformance(frameMs) {
        if (!this.post || !this.performanceState || typeof window === 'undefined') return;
        if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) return;

        const state = this.performanceState;
        const maxScale = state.targetPostResolutionScale ?? this.preset.postResolutionScale ?? 1;
        const minScale = Math.min(maxScale, state.minPostResolutionScale ?? 0.65);
        if (maxScale <= minScale) return;

        const alpha = 0.065;
        state.frameTimeEmaMs = state.frameCount === 0
            ? frameMs
            : state.frameTimeEmaMs * (1 - alpha) + frameMs * alpha;
        state.frameCount += 1;

        if (state.frameCount < 24) return;
        if (this.time - state.lastAdjustmentTime < 1.5) return;

        let nextScale = state.postResolutionScale;
        if (state.frameTimeEmaMs > 23.5) {
            nextScale = Math.max(minScale, nextScale - 0.07);
        } else if (state.frameTimeEmaMs > 18.8) {
            nextScale = Math.max(minScale, nextScale - 0.04);
        } else if (state.frameTimeEmaMs < 15.5 && nextScale < maxScale) {
            nextScale = Math.min(maxScale, nextScale + 0.02);
        }

        const rounded = Number(nextScale.toFixed(3));
        if (Math.abs(rounded - state.postResolutionScale) < 0.01) return;

        state.postResolutionScale = rounded;
        state.lastAdjustmentTime = this.time;
        this.post.resolutionScale = rounded;
        this.post.setSize(window.innerWidth, window.innerHeight);
    }

    updateCompanionMoonOrbit() {
        setCompanionMoonOrbitPosition(this.companionOrbitPosition, this.time);
        if (this.moonCompanionMesh) {
            this.moonCompanionMesh.position.copy(this.companionOrbitPosition);
        }
        if (this.moonCompanionAtmosphere) {
            this.moonCompanionAtmosphere.position.copy(this.companionOrbitPosition);
        }
        if (this.moonCompanionHalo) {
            this.moonCompanionHalo.position.copy(this.companionOrbitPosition);
            this.moonCompanionHalo.position.z -= COMPANION_HALO_DEPTH_OFFSET;
        }
        if (this.directionalCompanion) {
            this.directionalCompanion.position.copy(this.companionOrbitPosition).normalize().multiplyScalar(50);
        }
    }

    prefersReducedMotion() {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    shouldRunBackgroundEffects() {
        if (typeof window === 'undefined') return true;
        return window.settings?.backgroundComboEffects !== false;
    }

    pushCameraImpulse({
        shake = 0,
        durationMs = 140,
        fov = 0,
        dolly = 0,
    } = {}) {
        if (this.prefersReducedMotion()) return;
        const impulse = this.cameraImpulse;
        if (shake > impulse.shakeAmp) {
            impulse.shakeAmp = Math.min(0.12, shake);
            impulse.shakeRemainingMs = Math.max(16, durationMs);
            impulse.shakeDurationMs = Math.max(16, durationMs);
        }
        if (Math.abs(fov) > Math.abs(impulse.fovOffset)) {
            impulse.fovOffset = THREE.MathUtils.clamp(fov, -1.6, 0.45);
        }
        if (dolly > impulse.dolly) {
            impulse.dolly = Math.min(0.18, dolly);
        }
    }

    updateCameraImpulse(deltaSeconds) {
        const impulse = this.cameraImpulse;
        const out = {
            shakeX: 0,
            shakeY: 0,
            dolly: impulse.dolly,
            fovOffset: impulse.fovOffset,
        };

        if (impulse.shakeRemainingMs > 0 && impulse.shakeAmp > 0) {
            impulse.shakePhase += deltaSeconds * 58;
            const life = clamp01(impulse.shakeRemainingMs / Math.max(1, impulse.shakeDurationMs));
            const amp = impulse.shakeAmp * life * life;
            out.shakeX = (Math.sin(impulse.shakePhase * 1.27) + Math.sin(impulse.shakePhase * 2.11) * 0.35) * amp;
            out.shakeY = (Math.cos(impulse.shakePhase * 1.61) + Math.sin(impulse.shakePhase * 2.73) * 0.22) * amp * 0.72;
            impulse.shakeRemainingMs = Math.max(0, impulse.shakeRemainingMs - deltaSeconds * 1000);
            if (impulse.shakeRemainingMs === 0) impulse.shakeAmp = 0;
        }

        const fovDecay = 1 - Math.exp(-9.5 * deltaSeconds);
        const dollyDecay = 1 - Math.exp(-7.0 * deltaSeconds);
        impulse.fovOffset += (0 - impulse.fovOffset) * fovDecay;
        impulse.dolly += (0 - impulse.dolly) * dollyDecay;
        return out;
    }

    update(deltaSeconds) {
        // Decay reactive energies
        this.comboEnergy = Math.max(0, this.comboEnergy - deltaSeconds * 0.3);
        this.comboFlash = Math.max(0, this.comboFlash - deltaSeconds * 1.4);
        this.haloPulse = Math.max(0, this.haloPulse - deltaSeconds * 1.6);
        this.postBloomPulse = Math.max(0, this.postBloomPulse - deltaSeconds * 1.45);
        this.postExposurePulse = Math.max(0, this.postExposurePulse - deltaSeconds * 2.25);
        this.postVignettePulse = Math.max(0, this.postVignettePulse - deltaSeconds * 2.0);
        this.postTintPulse = Math.max(0, this.postTintPulse - deltaSeconds * 1.7);

        // Subtle camera breathing with parallax
        if (this.camera) {
            const cameraImpulse = this.updateCameraImpulse(deltaSeconds);
            // Slower lerp for a heavier, more cinematic feel
            this.currentPointerX += (this.targetPointerX - this.currentPointerX) * deltaSeconds * 1.5;
            this.currentPointerY += (this.targetPointerY - this.currentPointerY) * deltaSeconds * 1.5;

            // Automatic wide panning so the camera is never static even when hands-off
            const autoPanX = Math.sin(this.time * 0.012) * 6.0;
            const autoPanY = Math.sin(this.time * 0.017) * 2.5;
            const autoPanZ = (Math.cos(this.time * 0.008) - 1.0) * 18.0;

            // Combine pointer parallax, auto-pan, and breathing float
            const totalPanX = this.currentPointerX * 14.0 + autoPanX; // Increased from 8.0
            const totalPanY = this.currentPointerY * 7.0 + autoPanY; // Increased from 4.0
            const totalPanZ = autoPanZ;

            // Organic, multi-frequency floating — lower amplitude than before so
            // it reads as a stable handheld push-in, not a floaty bob.
            const floatX = Math.sin(this.time * 0.05) * 2.4 + Math.cos(this.time * 0.02) * 1.7;
            const floatY = Math.sin(this.time * 0.07) * 1.4 + Math.cos(this.time * 0.035) * 1.0;
            const floatZ = Math.sin(this.time * 0.041) * 2.2 + Math.cos(this.time * 0.025) * 1.5;

            // Slow cinematic dolly: a long, eased push toward the moon gap that
            // parallaxes the layered mountains/planets convincingly.
            const dolly = (Math.sin(this.time * 0.022) * 0.5 + 0.5) * 14.0;

            this.camera.position.x = totalPanX + floatX;
            this.camera.position.y = 7.4 + totalPanY + floatY;
            this.camera.position.z = 42 + totalPanZ + floatZ - dolly;
            this.camera.position.x += cameraImpulse.shakeX;
            this.camera.position.y += cameraImpulse.shakeY;
            this.camera.position.z -= cameraImpulse.dolly * 14.0;

            const targetFov = this.baseCameraFov + cameraImpulse.fovOffset;
            if (Math.abs(this.camera.fov - targetFov) > 0.01) {
                this.camera.fov = targetFov;
                this.camera.updateProjectionMatrix();
            }

            // Shift look-at target to amplify depth perspective
            const lookTarget = this.cameraTarget.clone();
            lookTarget.x += this.currentPointerX * 25.0 + autoPanX * 2.5;
            lookTarget.y += this.currentPointerY * 12.0 + autoPanY * 2.5;
            this.camera.lookAt(lookTarget);

            // Subtle camera roll for a natural floating tilt (reduced for stability)
            this.camera.rotateZ(Math.sin(this.time * 0.03) * 0.009 + Math.cos(this.time * 0.014) * 0.006);
        }

        const updateUTime = (mat) => {
            const u = mat?.userData?.uniforms?.uTime;
            if (u) u.value = this.time;
        };
        updateUTime(this.skyMaterial);
        updateUTime(this.starMaterial);
        updateUTime(this.moonPrimaryMaterial);
        updateUTime(this.moonCompanionMaterial);
        updateUTime(this.moonPrimaryHaloMaterial);
        updateUTime(this.moonCompanionHaloMaterial);
        updateUTime(this.crystalMaterial);
        for (const material of this.crystalMaterials) updateUTime(material);
        for (const material of this.causticMaterials) updateUTime(material);
        updateUTime(this.floraMaterial);
        for (const material of this.floraBulbMaterials) {
            const base = material.userData?.baseEmissiveIntensity;
            if (base !== undefined && material.emissive) {
                const pulse = 1.0 + Math.sin(this.time * 1.15) * 0.08
                    + this.comboEnergy * 0.28
                    + this.comboFlash * 0.22;
                material.emissiveIntensity = base * pulse;
            }
        }

        // Crystal resonance: emissive surges with combo energy/flash.
        const crystalSurge = 1.0 + this.comboEnergy * 0.7 + this.comboFlash * 1.1;
        for (const material of this.crystalMaterials) {
            const u = material.userData?.uniforms?.uEmissiveStrength;
            const base = material.userData?.baseEmissiveStrength;
            if (u && base !== undefined) u.value = base * crystalSurge;
        }
        // Ground vein network brightens with the same energy.
        if (this.groundMaterial) {
            const u = this.groundMaterial.userData?.uniforms?.uVeinStrength;
            if (u && this.baseVeinStrength !== undefined) {
                u.value = this.baseVeinStrength * (1.0 + this.comboEnergy * 1.4 + this.comboFlash * 1.8);
            }
        }
        // Caustic pools pulse on the beat too.
        for (const material of this.causticMaterials) {
            const u = material.userData?.uniforms?.uOpacity;
            const base = material.userData?.baseCausticOpacity;
            if (u && base !== undefined) u.value = base * (1.0 + this.comboFlash * 1.5);
        }
        updateUTime(this.moteMaterial);
        updateUTime(this.groundMaterial);
        for (const material of this.horizonLightMaterials) updateUTime(material);
        for (const fog of this.fogCardMaterials) updateUTime(fog);
        for (const aurora of this.auroraMaterials) {
            updateUTime(aurora);
            const surge = aurora.userData?.uniforms?.uSurge;
            if (surge) surge.value = this.comboEnergy * 0.6 + this.comboFlash * 0.9;
        }

        this.updateCompanionMoonOrbit();

        if (this.moonPrimaryMesh) {
            this.moonPrimaryMesh.rotation.y = this.time * 0.012;
            this.moonPrimaryMesh.rotation.z = Math.sin(this.time * 0.03) * 0.02;
        }
        if (this.moonCompanionMesh) {
            this.moonCompanionMesh.rotation.y = -this.time * 0.018;
            this.moonCompanionMesh.rotation.z = Math.sin(this.time * 0.04) * 0.025;
        }
        if (this.starPoints) {
            this.starPoints.rotation.y = this.time * 0.002;
        }
        if (this.distantPlanet) {
            this.distantPlanet.rotation.y = this.time * 0.006;
        }
        updateUTime(this.distantPlanetMaterial);

        // Halo pulse modulation
        if (this.moonPrimaryHaloMaterial) {
            const opacityU = this.moonPrimaryHaloMaterial.userData?.uniforms?.uOpacity;
            if (opacityU) opacityU.value = 0.55 + this.haloPulse * 0.4;
        }
        if (this.moonCompanionHaloMaterial) {
            const opacityU = this.moonCompanionHaloMaterial.userData?.uniforms?.uOpacity;
            if (opacityU) opacityU.value = 0.5 + this.haloPulse * 0.45;
        }

        // Halo billboarding to camera
        if (this.moonPrimaryHalo && this.camera) {
            this.moonPrimaryHalo.lookAt(this.camera.position);
        }
        if (this.moonCompanionHalo && this.camera) {
            this.moonCompanionHalo.lookAt(this.camera.position);
        }

        // CPU mote fallback animation
        if (this.moteCpuFallback) {
            const {
                positions,
                velocities,
                geom,
                count,
            } = this.moteCpuFallback;
            const halfW = 110;
            const halfH = 40;
            const halfD = 120;
            for (let i = 0; i < count; i++) {
                const ix = i * 3;
                const driftX = Math.sin(this.time * 0.6 + i * 0.13) * 0.04;
                const driftZ = Math.cos(this.time * 0.45 + i * 0.07) * 0.03;
                positions[ix + 0] += velocities[ix + 0] * deltaSeconds + driftX;
                positions[ix + 1] += velocities[ix + 1] * deltaSeconds;
                positions[ix + 2] += velocities[ix + 2] * deltaSeconds + driftZ;
                const oob = positions[ix + 1] > halfH
                    || Math.abs(positions[ix + 0]) > halfW
                    || Math.abs(positions[ix + 2]) > halfD;
                if (oob) {
                    positions[ix + 0] = (Math.random() - 0.5) * halfW * 2;
                    positions[ix + 1] = -halfH;
                    positions[ix + 2] = (Math.random() - 0.5) * halfD * 2;
                }
            }
            geom.attributes.position.needsUpdate = true;
        }

        // Compute mote update
        if (this.moteCompute) {
            this.moteCompute.update(deltaSeconds, this.time);
            const drift = 1.0 + this.comboEnergy * 0.5;
            this.moteCompute.setDrift(drift);
        }
        if (this.reactionFx) {
            this.reactionFx.update(deltaSeconds, this.time);
        }

        // Active shockwave updates
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const sw = this.shockwaves[i];
            sw.elapsed += deltaSeconds;
            const progress = Math.min(1, sw.elapsed / sw.duration);
            const u = sw.material.userData?.uniforms;
            if (u?.uProgress) u.uProgress.value = progress;
            if (progress >= 1) {
                this.scene.remove(sw.mesh);
                sw.mesh.geometry.dispose();
                sw.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }

        // Reactive bloom strength
        if (this.post) {
            const target = this.preset.bloomStrength
                + this.comboEnergy * 0.25
                + this.comboFlash * 0.15
                + this.postBloomPulse * 0.16;
            this.post.update({
                time: this.time,
                bloomStrength: target,
                exposure: 0.98 + this.postExposurePulse * 0.05,
                vignetteDarkness: 0.28 + this.postVignettePulse * 0.08,
                tintStrength: 0.14 + this.postTintPulse * 0.045,
            });
        }
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;

        try {
            if (this.moteCompute && this.capabilities.useCompute) {
                if (typeof this.renderer.compute === 'function') {
                    this.renderer.compute(this.moteCompute.computeNode);
                } else {
                    this.renderer.computeAsync(this.moteCompute.computeNode);
                }
            }
            if (this.post) {
                this.post.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        } catch (error) {
            console.error('[LunaraTheme] Render error:', error);
        }
    }

    // -----------------------------------------------------------------------
    // Reactive events
    // -----------------------------------------------------------------------

    onPointerMove(event) {
        if (typeof window === 'undefined') return;
        this.targetPointerX = (event.clientX / window.innerWidth) * 2 - 1;
        this.targetPointerY = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    setupEvents() {
        this.teardownEvents();
        const on = (event, handler) => {
            const unsub = eventBus.on(event, handler);
            this.eventUnsubscribers.push(unsub);
        };
        on(EVENTS.LINE_CLEAR, (payload) => this.handleLineClear(payload));
        on(EVENTS.COMBO, (payload) => this.handleCombo(payload));
        on(EVENTS.PIECE_LOCK, (payload) => this.handlePieceLock(payload));

        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', this.boundPointerMoveHandler);
        }
    }

    teardownEvents() {
        for (const unsub of this.eventUnsubscribers) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this.eventUnsubscribers = [];

        if (typeof window !== 'undefined' && this.boundPointerMoveHandler) {
            window.removeEventListener('pointermove', this.boundPointerMoveHandler);
        }
    }

    handlePieceLock(payload) {
        if (!this.shouldRunBackgroundEffects()) return;
        this.haloPulse = Math.min(1, this.haloPulse + 0.4);
        this.postBloomPulse = Math.min(1, this.postBloomPulse + 0.1);
        this.postVignettePulse = Math.min(1, this.postVignettePulse + 0.12);
        this.reactionFx?.triggerPieceLock(payload);
        this.pushCameraImpulse({ shake: 0.025, durationMs: 120, fov: -0.45 });
    }

    handleCombo(payload) {
        if (!this.shouldRunBackgroundEffects()) return;
        const detail = payload?.detail || payload || {};
        const combo = detail.comboCount ?? detail.combo ?? detail.count ?? 0;
        if (combo >= 1) {
            this.comboEnergy = Math.min(1, this.comboEnergy + 0.15 + combo * 0.04);
            this.comboFlash = Math.min(1, this.comboFlash + 0.25);
            this.haloPulse = Math.min(1, this.haloPulse + 0.5);
            this.postBloomPulse = Math.min(1, this.postBloomPulse + 0.12 + combo * 0.025);
            this.postExposurePulse = Math.min(1, this.postExposurePulse + 0.08 + combo * 0.012);
            this.postTintPulse = Math.min(1, this.postTintPulse + 0.12);
            this.reactionFx?.triggerCombo(detail);
            if (combo >= 7) {
                this.pushCameraImpulse({
                    shake: 0.075,
                    durationMs: 340,
                    fov: -1.4,
                    dolly: 0.16,
                });
            } else if (combo >= 4) {
                this.pushCameraImpulse({
                    shake: 0.04,
                    durationMs: 190,
                    dolly: 0.08,
                });
            }
        }
    }

    handleLineClear(payload) {
        if (!this.shouldRunBackgroundEffects()) return;
        const detail = payload?.detail || payload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        this.comboEnergy = Math.min(1, this.comboEnergy + 0.2 + lineCount * 0.06);
        this.comboFlash = Math.min(1, this.comboFlash + 0.4);
        this.haloPulse = Math.min(1, this.haloPulse + 0.6);
        this.postBloomPulse = Math.min(1, this.postBloomPulse + 0.18 + lineCount * 0.07);
        this.postExposurePulse = Math.min(1, this.postExposurePulse + 0.12 + lineCount * 0.025);
        this.postVignettePulse = Math.min(1, this.postVignettePulse + 0.18 + lineCount * 0.03);
        this.postTintPulse = Math.min(1, this.postTintPulse + 0.12 + lineCount * 0.025);
        this.reactionFx?.triggerLineClear(detail);
        if (lineCount >= 4) {
            this.pushCameraImpulse({
                shake: 0.095,
                durationMs: 360,
                fov: -1.1,
                dolly: 0.12,
            });
        } else if (lineCount >= 2) {
            this.pushCameraImpulse({
                shake: 0.04 + lineCount * 0.01,
                durationMs: 180,
            });
        }
    }

    spawnShockwave(lineCount) {
        this.reactionFx?.triggerLineClear({ lineCount });
    }

    spawnGroundRipple() {
        // Rings are pooled inside LunaraReactionParticles.
    }

    // -----------------------------------------------------------------------
    // Resize / cleanup
    // -----------------------------------------------------------------------

    attachResizeListener() {
        if (typeof window === 'undefined') return;
        window.addEventListener('resize', this.boundResizeHandler);
    }

    removeResizeListener() {
        if (typeof window === 'undefined') return;
        window.removeEventListener('resize', this.boundResizeHandler);
    }

    onResize() {
        if (!this.renderer || !this.camera) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getRendererPixelRatio());
        this.renderer.setSize(w, h, false);
        if (this.post) this.post.setSize(w, h);
    }

    stop() {
        this.teardownEvents();
        this.removeResizeListener();

        if (this.cancelHdriLoad) {
            this.cancelHdriLoad();
            this.cancelHdriLoad = null;
        }
        if (this.hdriEnvironmentMap) {
            if (this.hdriEnvironmentMap !== this.environmentMap) {
                this.hdriEnvironmentMap.dispose?.();
            }
            this.hdriEnvironmentMap = null;
        }
        if (this.detailTextures) {
            disposeLunaraDetailTextureSet(this.detailTextures);
            this.detailTextures = null;
        }

        if (this.reactionFx?.dispose) {
            this.reactionFx.dispose();
            this.reactionFx = null;
        }
        if (this.scene) {
            this.disposeThreeJSGroup(this.scene);
            this.scene = null;
        }
        if (this.post?.dispose) {
            this.post.dispose();
            this.post = null;
        }
        if (this.moteCompute?.dispose) {
            this.moteCompute.dispose();
            this.moteCompute = null;
        }
        this.moteCpuFallback = null;

        if (this.environmentMap) {
            this.environmentMap.dispose?.();
            this.environmentMap = null;
        }

        if (this.renderer) {
            const dom = this.renderer.domElement;
            if (typeof this.renderer.dispose === 'function') this.disposeRenderer(this.renderer, { nullInstance: false });
            if (dom?.parentNode) dom.parentNode.removeChild(dom);
            this.renderer = null;
        }
        this.camera = null;

        this.skyMaterial = null;
        this.starMaterial = null;
        this.starPoints = null;
        this.moonPrimaryMaterial = null;
        this.moonCompanionMaterial = null;
        this.moonPrimaryMesh = null;
        this.moonCompanionMesh = null;
        this.moonPrimaryHalo = null;
        this.moonCompanionHalo = null;
        this.moonPrimaryHaloMaterial = null;
        this.moonCompanionHaloMaterial = null;
        this.moonPrimaryAtmosphere = null;
        this.moonCompanionAtmosphere = null;
        this.mountainsDistant = null;
        this.mountainsMid = null;
        this.mountainsNear = null;
        this.mountainLayers = [];
        this.crystalCluster = null;
        this.crystalMeshes = [];
        this.crystalMaterial = null;
        this.crystalMaterials = [];
        this.rockField = null;
        this.rockMaterial = null;
        this.valleyStream = null;
        this.valleyStreamMaterial = null;
        this.floraSprites = [];
        this.floraMaterial = null;
        this.floraBulbMeshes = [];
        this.floraBulbMaterials = [];
        this.horizonLights = [];
        this.horizonLightMaterials = [];
        this.motesPoints = null;
        this.moteMaterial = null;
        this.nebulaClouds = [];
        this.lightShafts = [];
        this.fogCardMaterials = [];
        this.groundMesh = null;
        this.groundMaterial = null;
        this.baseVeinStrength = undefined;
        this.moonAtmospheres = [];
        this.moonAtmosphereMaterials = [];
        this.distantPlanet = null;
        this.distantPlanetMaterial = null;
        this.distantPlanetRing = null;
        this.causticMeshes = [];
        this.causticMaterials = [];
        this.auroraMeshes = [];
        this.auroraMaterials = [];
        this.shockwaves = [];
        this.reactionFx = null;
        this.directionalPrimary = null;
        this.directionalCompanion = null;
        this.companionOrbitPosition.set(0, 0, 0);

        this.showLegacyDom();
        super.stop();
    }
}
