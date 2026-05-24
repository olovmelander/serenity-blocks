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
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import {
    createLunaraSkyMaterialWebGPU,
    createLunaraSkyMaterialWebGL,
    createLunaraStarMaterialWebGPU,
    createLunaraStarMaterialWebGL,
    createLunaraMoonMaterialWebGPU,
    createLunaraMoonMaterialWebGL,
    createLunaraMoonHaloMaterialWebGPU,
    createLunaraMoonHaloMaterialWebGL,
    createLunaraMountainMaterialWebGPU,
    createLunaraMountainMaterialWebGL,
    createLunaraCrystalMaterialWebGPU,
    createLunaraCrystalMaterialWebGL,
    createLunaraFloraMaterialWebGPU,
    createLunaraFloraMaterialWebGL,
    createLunaraMoteMaterialWebGPU,
    createLunaraMoteMaterialWebGL,
    createLunaraFogMaterialWebGPU,
    createLunaraFogMaterialWebGL,
    createLunaraGroundMaterialWebGPU,
    createLunaraGroundMaterialWebGL,
    createLunaraShockwaveMaterialWebGPU,
    createLunaraShockwaveMaterialWebGL,
} from './lunara-materials.js';
import { LunaraPost } from './lunara-post.js';
import { LunaraMoteCompute } from './lunara-compute.js';

const QUALITY_PRESETS = {
    Minimal: {
        starCount: 600,
        crystalCount: 30,
        rockCount: 24,
        floraCount: 0,
        horizonLightCount: 12,
        moteCount: 0,
        fogCards: 1,
        nebulaCards: 1,
        lightShafts: 1,
        bloomStrength: 0.32,
        bloomRadius: 0.32,
        bloomThreshold: 0.4,
        bloomDownsample: 0.45,
        useCompute: false,
        useMRT: false,
    },
    Low: {
        starCount: 1000,
        crystalCount: 50,
        rockCount: 44,
        floraCount: 30,
        horizonLightCount: 24,
        moteCount: 1500,
        fogCards: 2,
        nebulaCards: 2,
        lightShafts: 1,
        bloomStrength: 0.42,
        bloomRadius: 0.36,
        bloomThreshold: 0.36,
        bloomDownsample: 0.55,
        useCompute: true,
        useMRT: false,
    },
    Medium: {
        starCount: 1500,
        crystalCount: 80,
        rockCount: 68,
        floraCount: 60,
        horizonLightCount: 36,
        moteCount: 2800,
        fogCards: 3,
        nebulaCards: 3,
        lightShafts: 2,
        bloomStrength: 0.5,
        bloomRadius: 0.4,
        bloomThreshold: 0.34,
        bloomDownsample: 0.65,
        useCompute: true,
        useMRT: false,
    },
    High: {
        starCount: 2000,
        crystalCount: 110,
        rockCount: 92,
        floraCount: 100,
        horizonLightCount: 52,
        moteCount: 2800,
        fogCards: 3,
        nebulaCards: 4,
        lightShafts: 2,
        bloomStrength: 0.46,
        bloomRadius: 0.44,
        bloomThreshold: 0.4,
        bloomDownsample: 0.75,
        useCompute: true,
        useMRT: true,
    },
    Ultra: {
        starCount: 2400,
        crystalCount: 140,
        rockCount: 120,
        floraCount: 140,
        horizonLightCount: 70,
        moteCount: 4300,
        fogCards: 4,
        nebulaCards: 5,
        lightShafts: 3,
        bloomStrength: 0.5,
        bloomRadius: 0.48,
        bloomThreshold: 0.38,
        bloomDownsample: 0.85,
        useCompute: true,
        useMRT: true,
    },
    Extreme: {
        starCount: 2800,
        crystalCount: 170,
        rockCount: 150,
        floraCount: 180,
        horizonLightCount: 88,
        moteCount: 5600,
        fogCards: 4,
        nebulaCards: 6,
        lightShafts: 3,
        bloomStrength: 0.54,
        bloomRadius: 0.5,
        bloomThreshold: 0.36,
        bloomDownsample: 1.0,
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

const PRIMARY_MOON_POS = new THREE.Vector3(-46, 57, -212);
const COMPANION_MOON_POS = new THREE.Vector3(14, 49, -200);

const CRYSTAL_CLUSTER_CENTERS = [
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

        this.post = null;
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
        this.horizonLights = [];
        this.horizonLightMaterials = [];
        this.motesPoints = null;
        this.moteMaterial = null;
        this.moteCompute = null;
        this.moteCpuFallback = null;
        this.nebulaClouds = [];
        this.lightShafts = [];
        this.fogCardMaterials = [];
        this.groundMesh = null;
        this.groundMaterial = null;
        this.shockwaves = [];

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
    }

    // -----------------------------------------------------------------------
    // Scene creation
    // -----------------------------------------------------------------------

    async createScene() {
        this.applyQualityPreset(this.getCurrentQualityLevel());

        const themeContainer = document.getElementById('lunara-theme');
        if (!themeContainer) {
            console.warn('[LunaraTheme] #lunara-theme container missing');
            return;
        }
        this.hideLegacyDom();

        const created = await this.initRenderer(themeContainer);
        if (!created) return;

        this.createScenePrimitives();
        this.createSky();
        this.createStarfield();
        this.createNebulaClouds();
        this.createMoons();
        this.createMountains();
        this.createGround();
        this.createValleyStream();
        this.createRockField();
        this.createCrystals();
        this.createFlora();
        this.createHorizonLights();
        this.createMotes();
        this.createFogCards();
        this.createMoonLightShafts();
        this.createLights();
        this.setupPost();
        this.setupEvents();
        this.attachResizeListener();
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

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const force = shouldForceWebGL();
        let renderer = null;

        if (!force) {
            try {
                renderer = new WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    forceWebGL: false,
                });
                await renderer.init();
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose?.();
                    renderer = null;
                }
            } catch (error) {
                console.warn('[LunaraTheme] WebGPU init failed, using WebGL2 fallback:', error);
                renderer?.dispose?.();
                renderer = null;
            }
        }

        if (!renderer) {
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
        renderer.setPixelRatio(this.getEffectivePixelRatio(2));
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
        this.camera.position.set(0, 7.4, 42);
        this.camera.lookAt(this.cameraTarget);
    }

    createSky() {
        const geometry = new THREE.SphereGeometry(2400, 48, 32);
        const factory = this.isWebGPU ? createLunaraSkyMaterialWebGPU : createLunaraSkyMaterialWebGL;
        const { material } = factory({
            zenith: new THREE.Color(0x030214),
            mid: new THREE.Color(0x1b0742),
            horizon: new THREE.Color(0x542071),
            horizonWarm: new THREE.Color(0xd24a92),
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

        const rng = makeSeededRandom(8423);
        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xc6cfff),
            new THREE.Color(0xffd2f2),
            new THREE.Color(0xc8a4ff),
        ];

        for (let i = 0; i < count; i++) {
            // Distribute across an upper hemisphere (y > -0.05) at radius 1500.
            let dx; let dy; let dz; let len;
            do {
                dx = rng() * 2 - 1;
                dy = rng() * 1.6 - 0.05;
                dz = rng() * 2 - 1;
                len = Math.sqrt(dx * dx + dy * dy + dz * dz);
            } while (len < 0.1);
            const r = 1500 + rng() * 350;
            positions[i * 3 + 0] = (dx / len) * r;
            positions[i * 3 + 1] = (dy / len) * r;
            positions[i * 3 + 2] = (dz / len) * r;

            const palette = starColors[Math.floor(rng() * starColors.length)];
            const tint = 0.7 + rng() * 0.3;
            colors[i * 3 + 0] = palette.r * tint;
            colors[i * 3 + 1] = palette.g * tint;
            colors[i * 3 + 2] = palette.b * tint;

            sizes[i] = 0.9 + rng() * 2.4;
            phases[i] = rng() * Math.PI * 2;
            twinkleSpeeds[i] = 0.6 + rng() * 1.4;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));

        const factory = this.isWebGPU ? createLunaraStarMaterialWebGPU : createLunaraStarMaterialWebGL;
        const { material } = factory();
        this.starMaterial = material;
        this.starPoints = new THREE.Points(geometry, material);
        this.starPoints.frustumCulled = false;
        this.scene.add(this.starPoints);
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
        for (const tex of [moonSurfaceTex, marsSurfaceTex]) {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
        }

        // Primary — deep purple moon (lunar surface texture, purple-tinted)
        const primaryRadius = 42;
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
        const companionRadius = 19.5;
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
        companionMesh.position.copy(COMPANION_MOON_POS);
        companionMesh.frustumCulled = false;
        this.moonCompanionMesh = companionMesh;
        this.scene.add(companionMesh);

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
        this.moonPrimaryHalo.position.z += 1; // slightly behind moon? Actually closer to camera works for billboard
        this.moonPrimaryHalo.position.z -= 4;
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
        this.moonCompanionHalo.position.copy(COMPANION_MOON_POS);
        this.moonCompanionHalo.position.z -= 4;
        this.moonCompanionHalo.renderOrder = -1;
        this.moonCompanionHalo.frustumCulled = false;
        this.scene.add(this.moonCompanionHalo);
    }

    buildRidgeGeometry(seed, segments, baseHeight, peakHeight, frequency, options = {}) {
        const rng = makeSeededRandom(seed);
        const width = options.width ?? 900;
        const floor = options.floor ?? -10;
        const spireCount = options.spireCount ?? 10;
        const spireSharpness = options.spireSharpness ?? 1.6;
        const points = segments + 1;
        const positions = new Float32Array(points * 2 * 3);
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

        for (let i = 0; i < points; i++) {
            const x = ((i / segments) - 0.5) * width;
            const top = heights[i];
            // Top vertex
            positions[i * 6 + 0] = x;
            positions[i * 6 + 1] = top;
            positions[i * 6 + 2] = 0;
            // Bottom vertex
            positions[i * 6 + 3] = x;
            positions[i * 6 + 4] = floor;
            positions[i * 6 + 5] = 0;
        }

        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, b, c);
            indices.push(b, d, c);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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
        geom.computeVertexNormals();
        geom.computeBoundingSphere();
        return geom;
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

        const far = clamp01((-z - 18) / 178);
        const near = 1 - far;
        const baseScale = (options.baseScale ?? 0.55) + rng() * (options.baseScaleJitter ?? 0.85);
        const heightScale = (options.heightScale ?? 1.35)
            + rng() * (options.heightJitter ?? 3.8)
            + (cluster.hero ? near * 2.2 : near * 0.75);
        const widthScale = baseScale * (options.widthMultiplier ?? (0.72 + rng() * 0.42));
        const y = this.sampleTerrainHeight(x, z);
        const lean = options.lean ?? 0.32;
        const sink = options.sink ?? 0.08;

        tmp.position.set(x, y + heightScale * 1.58 - sink, z);
        tmp.rotation.set(
            (rng() - 0.5) * lean,
            rng() * Math.PI * 2,
            (rng() - 0.5) * lean,
        );
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
        const main = factory({
            color: new THREE.Color(0x835be0),
            emissive: new THREE.Color(0xd1a0ff),
            emissiveStrength: 1.0,
            opacity: 0.84,
            roughness: 0.1,
            metalness: 0.1,
        });
        const hero = factory({
            color: new THREE.Color(0xb392ff),
            emissive: new THREE.Color(0xdcc0ff),
            emissiveStrength: 1.42,
            opacity: 0.82,
            roughness: 0.06,
            metalness: 0.16,
        });
        const shard = factory({
            color: new THREE.Color(0x6d47c8),
            emissive: new THREE.Color(0x7cf2ff),
            emissiveStrength: 0.84,
            opacity: 0.8,
            roughness: 0.12,
            metalness: 0.08,
        });
        this.crystalMaterial = main.material;
        this.crystalMaterials = [main.material, hero.material, shard.material];

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
            this.placeCrystalInstance(heroMesh, i, rng, {
                tmp,
                cluster,
                baseScale: 0.72,
                baseScaleJitter: 0.95,
                heightScale: 2.05,
                heightJitter: 4.35,
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
            const x = aroundCrystals
                ? cluster.x + (rng() + rng() - 1) * cluster.spreadX * 1.6
                : (rng() < 0.5 ? -1 : 1) * (10 + rng() * 70);
            const z = aroundCrystals
                ? cluster.z + (rng() + rng() - 1) * cluster.spreadZ * 1.5
                : -18 - rng() * 130;
            positions[i * 3 + 0] = x;
            positions[i * 3 + 1] = this.sampleTerrainHeight(x, z) + 0.28 + rng() * 0.45;
            positions[i * 3 + 2] = z;
            phases[i] = rng() * Math.PI * 2;
            sizes[i] = 1.4 + rng() * 3.8;
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

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
            const opacity = 0.18 + (1 - t) * 0.15;
            const { material } = factory({
                color: new THREE.Color().setHSL(0.78 - t * 0.05, 0.5, 0.55),
                opacity,
                scroll: new THREE.Vector2(0.02 + i * 0.015, 0.008 + i * 0.004),
            });
            this.fogCardMaterials.push(material);
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(0, -2 + i * 0.6, z);
            mesh.renderOrder = 5 + i;
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
        const { material } = factory({
            color: new THREE.Color(0x231048),
            veinColor: new THREE.Color(0xc19dff),
            veinStrength: 0.28,
        });
        this.groundMaterial = material;

        const segments = ['Ultra', 'Extreme'].includes(this.activeQualityLevel) ? 112 : 88;
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
        material.opacity = 0.74;
        material.depthWrite = true;
        material.fog = true;
        if (material.emissive) {
            material.emissive.set(0x7048ff);
            material.emissiveIntensity = 0.1;
        }

        const mesh = new THREE.Mesh(geo, material);
        mesh.renderOrder = 1;
        mesh.frustumCulled = false;
        this.valleyStream = mesh;
        this.valleyStreamMaterial = material;
        this.scene.add(mesh);
    }

    createLights() {
        const ambient = new THREE.AmbientLight(0x3c2a93, 0.64);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0x8a69e2, 0x1c082c, 0.58);
        this.scene.add(hemi);

        const primary = new THREE.DirectionalLight(0xdac0ff, 1.36);
        const dirP = PRIMARY_MOON_POS.clone().normalize();
        primary.position.copy(dirP).multiplyScalar(50);
        this.scene.add(primary);
        this.directionalPrimary = primary;

        const companion = new THREE.DirectionalLight(0xff72ad, 0.82);
        const dirC = COMPANION_MOON_POS.clone().normalize();
        companion.position.copy(dirC).multiplyScalar(50);
        this.scene.add(companion);
        this.directionalCompanion = companion;

        const cyanGlow = new THREE.PointLight(0x61fff0, 1.7, 96, 2.0);
        cyanGlow.position.set(-36, 4.8, 5);
        this.scene.add(cyanGlow);

        const magentaGlow = new THREE.PointLight(0xff5ed4, 1.35, 90, 2.0);
        magentaGlow.position.set(40, 4.6, -1);
        this.scene.add(magentaGlow);

        const valleyGlow = new THREE.PointLight(0x8f65ff, 0.78, 120, 2.4);
        valleyGlow.position.set(0, 1.4, -42);
        this.scene.add(valleyGlow);
    }

    setupPost() {
        try {
            this.post = new LunaraPost(this.renderer, this.scene, this.camera, {
                useMRT: this.capabilities.useMRT,
                bloomStrength: this.preset.bloomStrength,
                bloomRadius: this.preset.bloomRadius,
                bloomThreshold: this.preset.bloomThreshold,
                bloomDownsample: this.preset.bloomDownsample,
                exposure: 0.98,
                contrast: 1.08,
                saturation: 1.16,
                tintStrength: 0.14,
                vignetteOffset: 1.08,
                vignetteDarkness: 0.22,
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

    startAnimationLoop() {
        const animate = this.safeAnimate(() => {
            const delta = this.clock.getDelta();
            this.time += delta;
            this.update(delta);
            this.renderFrame();
        });
        animate();
    }

    update(deltaSeconds) {
        // Decay reactive energies
        this.comboEnergy = Math.max(0, this.comboEnergy - deltaSeconds * 0.3);
        this.comboFlash = Math.max(0, this.comboFlash - deltaSeconds * 1.4);
        this.haloPulse = Math.max(0, this.haloPulse - deltaSeconds * 1.6);

        // Subtle camera breathing with parallax
        if (this.camera) {
            // Slower lerp for a heavier, more cinematic feel
            this.currentPointerX += (this.targetPointerX - this.currentPointerX) * deltaSeconds * 1.5;
            this.currentPointerY += (this.targetPointerY - this.currentPointerY) * deltaSeconds * 1.5;

            // Automatic wide panning so the camera is never static even when hands-off
            const autoPanX = Math.sin(this.time * 0.012) * 6.0;
            const autoPanY = Math.sin(this.time * 0.017) * 2.5;
            const autoPanZ = (Math.cos(this.time * 0.008) - 1.0) * 18.0;

            // Combine pointer parallax, auto-pan, and breathing float
            const totalPanX = this.currentPointerX * 14.0 + autoPanX; // Increased from 8.0
            const totalPanY = this.currentPointerY * 7.0 + autoPanY;  // Increased from 4.0
            const totalPanZ = autoPanZ;

            // Organic, multi-frequency floating and breathing movements
            const floatX = Math.sin(this.time * 0.05) * 3.5 + Math.cos(this.time * 0.02) * 2.5;
            const floatY = Math.sin(this.time * 0.07) * 2.2 + Math.cos(this.time * 0.035) * 1.5;
            const floatZ = Math.sin(this.time * 0.041) * 3.2 + Math.cos(this.time * 0.025) * 2.2;

            this.camera.position.x = totalPanX + floatX;
            this.camera.position.y = 7.4 + totalPanY + floatY;
            this.camera.position.z = 42 + totalPanZ + floatZ;
            
            // Shift look-at target to amplify depth perspective
            const lookTarget = this.cameraTarget.clone();
            lookTarget.x += this.currentPointerX * 25.0 + autoPanX * 2.5;
            lookTarget.y += this.currentPointerY * 12.0 + autoPanY * 2.5;
            this.camera.lookAt(lookTarget);

            // Subtle camera roll for a natural floating tilt
            this.camera.rotateZ(Math.sin(this.time * 0.03) * 0.015 + Math.cos(this.time * 0.014) * 0.01);
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
        updateUTime(this.floraMaterial);
        updateUTime(this.moteMaterial);
        updateUTime(this.groundMaterial);
        for (const material of this.horizonLightMaterials) updateUTime(material);
        for (const fog of this.fogCardMaterials) updateUTime(fog);

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
            const target = this.preset.bloomStrength + this.comboEnergy * 0.25 + this.comboFlash * 0.15;
            this.post.update({ time: this.time, bloomStrength: target });
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
        on(EVENTS.PIECE_LOCK, () => this.handlePieceLock());

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

    handlePieceLock() {
        this.haloPulse = Math.min(1, this.haloPulse + 0.4);
    }

    handleCombo(payload) {
        const detail = payload?.detail || payload || {};
        const combo = detail.comboCount ?? detail.combo ?? detail.count ?? 0;
        if (combo >= 1) {
            this.comboEnergy = Math.min(1, this.comboEnergy + 0.15 + combo * 0.04);
            this.comboFlash = Math.min(1, this.comboFlash + 0.25);
            this.haloPulse = Math.min(1, this.haloPulse + 0.5);
        }
    }

    handleLineClear(payload) {
        const detail = payload?.detail || payload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        this.comboEnergy = Math.min(1, this.comboEnergy + 0.2 + lineCount * 0.06);
        this.comboFlash = Math.min(1, this.comboFlash + 0.4);
        this.haloPulse = Math.min(1, this.haloPulse + 0.6);
        this.spawnShockwave(lineCount);
    }

    spawnShockwave(lineCount) {
        if (!this.scene) return;
        const factory = this.isWebGPU ? createLunaraShockwaveMaterialWebGPU : createLunaraShockwaveMaterialWebGL;
        const color = lineCount >= 4
            ? new THREE.Color(0xff7ad8)
            : new THREE.Color(0xc78cff);
        const { material } = factory({ color, opacity: 0.9 + Math.min(lineCount, 4) * 0.1 });

        const radius = 18 + lineCount * 6;
        const geo = new THREE.PlaneGeometry(radius, radius);
        const mesh = new THREE.Mesh(geo, material);
        // Place it between primary and companion moons
        const between = PRIMARY_MOON_POS.clone().lerp(COMPANION_MOON_POS, 0.5);
        between.z += 6;
        mesh.position.copy(between);
        mesh.renderOrder = 2;
        if (this.camera) mesh.lookAt(this.camera.position);
        this.scene.add(mesh);

        this.shockwaves.push({
            mesh,
            material,
            elapsed: 0,
            duration: 1.4,
        });
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
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(2));
        this.renderer.setSize(w, h, false);
        if (this.post) this.post.setSize(w, h);
    }

    stop() {
        this.teardownEvents();
        this.removeResizeListener();

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

        if (this.renderer) {
            const dom = this.renderer.domElement;
            if (typeof this.renderer.dispose === 'function') this.renderer.dispose();
            if (dom?.parentNode) dom.parentNode.removeChild(dom);
            this.renderer = null;
        }

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
        this.horizonLights = [];
        this.horizonLightMaterials = [];
        this.motesPoints = null;
        this.moteMaterial = null;
        this.nebulaClouds = [];
        this.lightShafts = [];
        this.fogCardMaterials = [];
        this.groundMesh = null;
        this.groundMaterial = null;
        this.shockwaves = [];

        this.showLegacyDom();
        super.stop();
    }
}
