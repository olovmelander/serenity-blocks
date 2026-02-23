import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SKY_CHILDREN_V2_TETROMINOS } from './sky-children-v2-tetrominos.js';
import {
    createSkyAtmosphereMaterial,
    createTerrainMaterial,
    createMountainMaterial,
    createCottonCloudMaterial,
    createCliffMaterial,
} from '../shared/sky-core/sky-core-materials.js';
import { createSkyTerrainField } from '../shared/sky-core/sky-core-terrain-field.js';
import {
    createGrassSystem,
    createFlowerSystem,
    createMoteSystem,
    createWindLinesSystem,
    updateVegetation,
    disposeVegetation,
} from '../shared/sky-core/sky-core-vegetation.js';
import { SkyCorePost } from '../shared/sky-core/sky-core-post.js';
import {
    getSkyV2QualityPreset,
    listSkyV2QualityPresets,
    normalizeSkyV2QualityTier,
    resolveSkyV2TierFromEffectQuality,
} from '../shared/sky-core/sky-core-quality.js';

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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
        noCompute: readBool('skyV2NoCompute', 'noCompute'),
        debug: readBool('skyV2Debug'),
        usePost: false,
        useMRT: false,
        useCompute: false,
    };
}

export default class SkyChildrenV2Theme extends BaseTheme {
    constructor(themeName = 'sky-children-v2') {
        super(themeName);

        this.flags = parseSkyV2Flags();
        this.eventUnsubscribers = [];
        this.clock = new THREE.Clock();
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

        this.qualityTier = normalizeSkyV2QualityTier(
            resolveSkyV2TierFromEffectQuality(this.getGraphicsQuality()),
            'high',
        );
        this.qualityPreset = getSkyV2QualityPreset(this.qualityTier);
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
        const requested = resolveSkyV2TierFromEffectQuality(this.getGraphicsQuality());
        this.qualityTier = normalizeSkyV2QualityTier(requested, this.qualityTier || 'high');
        this.qualityPreset = getSkyV2QualityPreset(this.qualityTier);
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

    async createScene() {
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

        const rendererReady = await this.initRenderer(container);
        if (!rendererReady) {
            console.error('[SkyChildrenV2] Unable to initialize renderer.');
            return;
        }

        this.buildScene();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.handleResize();

        this.performance.lastFrameNow = performance.now();
        this.clock.start();
        this.startAnimation();

        // Defer vegetation so the first frame (mountains, sky, terrain) renders immediately
        if (this._vegetationCallbackId !== null) {
            clearTimeout(this._vegetationCallbackId);
        }
        this._vegetationCallbackId = setTimeout(() => {
            this._vegetationCallbackId = null;
            if (this.scene && this.terrainField) {
                this.createVegetation();
                this.syncCarpetDebug();
            }
        }, 0);

        this.installDebugHelpers();
        this.installCompatibilityHelpers();

        console.log(
            `[SkyChildrenV2] Scene ready (${this.isWebGPU ? 'WebGPU' : 'WebGL'} | tier=${this.qualityTier})`,
        );
    }

    async initRenderer(container) {
        const antialias = this.getAntialiasEnabled();
        const forceWebGL = this.flags.forceWebGL === true;
        const adapterOptions = getWebGPUAdapterOptions();
        let renderer = null;

        if (!forceWebGL) {
            try {
                const webgpuRenderer = new WEBGPU.WebGPURenderer({
                    antialias,
                    forceWebGL: false,
                    powerPreference: adapterOptions?.powerPreference,
                });
                await webgpuRenderer.init();
                renderer = webgpuRenderer;
            } catch (error) {
                console.warn('[SkyChildrenV2] WebGPU init failed, trying fallback:', error);
            }
        }

        if (!renderer) {
            try {
                const webgpuFallbackRenderer = new WEBGPU.WebGPURenderer({
                    antialias,
                    forceWebGL: true,
                });
                await webgpuFallbackRenderer.init();
                renderer = webgpuFallbackRenderer;
            } catch (fallbackError) {
                console.warn('[SkyChildrenV2] WebGPURenderer forceWebGL fallback failed:', fallbackError);
            }
        }

        if (!renderer) {
            try {
                renderer = new THREE.WebGLRenderer({ antialias, alpha: true });
            } catch (error) {
                console.error('[SkyChildrenV2] No renderer backend available:', error);
                return false;
            }
        }

        this.renderer = renderer;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;
        this.capabilities = {
            isWebGPU: this.isWebGPU,
            maxColorAttachments: renderer?.capabilities?.maxColorAttachments ?? 1,
            supportsMRT: this.isWebGPU && (renderer?.capabilities?.maxColorAttachments ?? 1) > 1,
        };

        this.flags.usePost = !this.flags.noPost && this.qualityPreset?.post?.enabled !== false;
        this.flags.useMRT = this.flags.usePost
            && !this.flags.noMRT
            && this.capabilities.supportsMRT;
        this.flags.useCompute = this.isWebGPU && !this.flags.noCompute;

        if (this.isWebGPU && typeof renderer.onDeviceLost === 'function') {
            renderer.onDeviceLost = (info) => {
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

    buildScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xb8d0df, this.qualityPreset.fogDensity);

        this.camera = new THREE.PerspectiveCamera(
            56,
            window.innerWidth / Math.max(window.innerHeight, 1),
            0.06,
            1400,
        );
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraTarget);

        this.uniformSets = [];

        this.createLighting();
        this.createSkyDome();
        this.createTerrainField();
        this.createTerrain();
        this.createMountains();
        this.createClouds();
        // Vegetation is deferred — see createScene()
        this.syncPathDebug();
        this.syncCarpetDebug();
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

    createVegetation() {
        this.vegetation.grass = createGrassSystem(this.scene, this.terrainField, {
            ...this.qualityPreset,
            terrainSize: this.terrainSize,
            sunDirection: this.sunDirection,
            antialias: this.getAntialiasEnabled(),
        });

        this.vegetation.flowers = createFlowerSystem(this.scene, this.terrainField, {
            ...this.qualityPreset,
            terrainSize: this.terrainSize,
            sunDirection: this.sunDirection,
            antialias: this.getAntialiasEnabled(),
            flowerPalettePreset: this.flowerPalettePreset,
            flowerCarpetStrength: this.flowerCarpetStrength,
            flowerGroundLiftHead: this.flowerGroundLiftHead,
            flowerGroundLiftStem: this.flowerGroundLiftStem,
            flowerSlopeLift: this.flowerSlopeLift,
        });

        this.vegetation.motes = createMoteSystem(this.scene, {
            ...this.qualityPreset,
            terrainSize: this.terrainSize,
            moteCount: this.qualityPreset.grassInstances ? this.qualityPreset.grassInstances * 0.05 : 400,
        });

        this.vegetation.wind = createWindLinesSystem(this.scene, {
            ...this.qualityPreset,
            terrainSize: this.terrainSize,
            windLineCount: this.qualityPreset.grassInstances ? this.qualityPreset.grassInstances * 0.005 : 30,
        });
    }

    createSkyDome() {
        // Significantly deepened sky gradient to lower sky exposure
        const skyRuntime = createSkyAtmosphereMaterial({
            sunDirection: this.sunDirection,
            topColor: new THREE.Color(0x28476b), // Deeper blue
            midColor: new THREE.Color(0x695e87), // Richer purple
            horizonColor: new THREE.Color(0xd1a486), // Warmer, dimmer horizon
            cloudTint: new THREE.Color(0xded0d2), // Dimmer background clouds
        });

        const geometry = new THREE.SphereGeometry(980, 64, 32);
        const sky = new THREE.Mesh(geometry, skyRuntime.material);
        sky.frustumCulled = false;

        this.skyMesh = sky;
        this.skyUniforms = skyRuntime.uniforms;
        this.scene.add(sky);
        this.uniformSets.push(skyRuntime.uniforms);
    }

    createTerrainField() {
        this.terrainField = createSkyTerrainField({
            size: this.terrainSize,
            minHeight: -110, // Much deeper valleys
            maxHeight: 140,  // Much higher rolling hills
            pathWidth: 79,
            pathDepth: 8.9,
            shoulderLift: 6.4,
            pathCenterOffset: -18,
            pathNearSoftening: 0.6,
            nearSofteningStart: 52,
            nearSofteningEnd: 236,
            valleyStrength: 14.8, // Drastically stronger valley carving
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

    createTerrain() {
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

        const segments = this.qualityPreset.terrainSegments;
        const geometry = new THREE.PlaneGeometry(this.terrainSize, this.terrainSize, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const { position } = geometry.attributes;
        const pathMasks = new Float32Array(position.count);
        const valleyMasks = new Float32Array(position.count);
        const curvatures = new Float32Array(position.count);
        for (let i = 0; i < position.count; i += 1) {
            const x = position.getX(i);
            const z = position.getZ(i);
            position.setY(i, this.sampleTerrainHeight(x, z));
            pathMasks[i] = this.terrainField?.samplePathMask(x, z) ?? 0;
            valleyMasks[i] = this.terrainField?.sampleValleyMask(x, z) ?? 0;
            curvatures[i] = this.terrainField?.sampleCurvature(x, z) ?? 0;
        }
        position.needsUpdate = true;
        geometry.setAttribute('aPathMask', new THREE.Float32BufferAttribute(pathMasks, 1));
        geometry.setAttribute('aValleyMask', new THREE.Float32BufferAttribute(valleyMasks, 1));
        geometry.setAttribute('aCurvature', new THREE.Float32BufferAttribute(curvatures, 1));
        geometry.computeVertexNormals();

        const terrainRuntime = createTerrainMaterial({
            nearColor: new THREE.Color(0xb2cc7a), // Vibrant warm green
            farColor: new THREE.Color(0x9dcb78), // Warmer mid-distance
            ridgeColor: new THREE.Color(0xe6ff99), // Brighter sun-hit ridges
            pathTint: new THREE.Color(0xcfc3a2),
            valleyTint: new THREE.Color(0x4a8a4f), // Deeper shadows in valleys
            crestTint: new THREE.Color(0xffe6b3), // Warmer rim light catching the crests
            fogColor: new THREE.Color(0xcba8dc), // Deeper lilac fog
            fogNear: 90, // Bring fog closer to blend the harsh horizon
            fogFar: 380,
            farCoverageStrength: this.qualityPreset.farCoverageStrength ?? 0.56,
            flowerFarTintStrength: this.qualityPreset.flowerFarTintStrength ?? 0.42,
            sunDirection: this.sunDirection,
        });

        const terrain = new THREE.Mesh(geometry, terrainRuntime.material);
        terrain.receiveShadow = false;

        this.terrainMesh = terrain;
        this.terrainMaterialUniforms = terrainRuntime.uniforms;
        this.scene.add(terrain);

        const underlay = new THREE.Mesh(
            new THREE.PlaneGeometry(this.terrainSize * 2.1, this.terrainSize * 2.1, 1, 1),
            new THREE.MeshBasicMaterial({ color: 0x3f6f47 }),
        );
        underlay.rotation.x = -Math.PI / 2;
        underlay.position.y = (this.terrainField?.config?.minHeight ?? -110) - 56;
        underlay.renderOrder = -2;
        this.terrainUnderlayMesh = underlay;
        this.scene.add(underlay);

        const skirtRuntime = createCliffMaterial({
            shadowColor: new THREE.Color(0x345b3d), // Blend with underlay
            midColor: new THREE.Color(0x5a7a58),
            highlightColor: new THREE.Color(0x9cb894),
            fogColor: new THREE.Color(0xcba8dc),
            fogNear: 60,
            fogFar: 300,
            sunDirection: this.sunDirection
        });

        const skirt = new THREE.Mesh(
            this.createTerrainSkirtGeometry(Math.max(32, Math.floor(segments * 0.5))),
            skirtRuntime.material
        );
        skirt.renderOrder = -1;
        this.terrainSkirtMesh = skirt;
        this.scene.add(skirt);

        this.uniformSets.push(terrainRuntime.uniforms);
        this.uniformSets.push(skirtRuntime.uniforms);
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
            const apexMask = Math.pow(Math.max(0, 1 - yNorm), 0.55);

            // Large-scale asymmetric body warping (low-freq, high-amplitude)
            const b = fbm(x * 0.005 + seed * 1.7, z * 0.005 + seed * 2.3, 2);
            const bodyDisplace = (b - 0.5) * height * 0.42
                * apexMask * Math.pow(Math.sin(yNorm * Math.PI), 0.65);

            // Sharp vertical ridges running up the slopes
            const r = ridgeN(x * 0.014 + seed * 4.7, z * 0.014 + seed * 6.1);
            const ridgeDisplace = r * r * height * 0.20 * apexMask * Math.pow(1 - yNorm, 0.35);

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

    createMountains() {
        if (this.mountainGroup) {
            this.scene.remove(this.mountainGroup);
            this.disposeObject3D(this.mountainGroup);
            this.mountainGroup = null;
        }

        const runtime = createMountainMaterial({
            shadowColor: new THREE.Color(0x3d3252), // Deep purple-shadow crevices
            midColor: new THREE.Color(0x7a718e),    // Cool grey-purple rock face
            highlightColor: new THREE.Color(0xbcb8cc), // Pale grey lit rock
            peakColor: new THREE.Color(0xd4d0e0),   // Lighter exposed rock at summits
            rimColor: new THREE.Color(0xffe6a3),    // Warm golden rim from sun
            atmosphereColor: new THREE.Color(0xcba8dc),
            fogNear: 80,
            fogFar: 360,
            sunDirection: this.sunDirection,
        });

        const group = new THREE.Group();
        const mountainCount = this.qualityPreset.mountainMeshes;
        const arcStart = -1.0;
        const arcEnd = 1.0;

        for (let i = 0; i < mountainCount; i += 1) {
            const t = mountainCount <= 1 ? 0.5 : i / (mountainCount - 1);
            const angle = arcStart + (arcEnd - arcStart) * t;

            const radius = 280 + Math.random() * 180; // Massive wide bases
            const height = 480 + Math.random() * 260; // Towering peaks
            const geometry = new THREE.ConeGeometry(radius, height, 80, 48, true); // Much higher poly for ridges
            this.distortMountainGeometry(geometry, (i + 1) * 3.14);

            const mountain = new THREE.Mesh(geometry, runtime.material);
            const distance = 550 + Math.random() * 180; // Pushed even further back
            mountain.position.set(
                Math.sin(angle) * distance,
                -70 + (Math.random() - 0.5) * 50, // Deep anchor
                -Math.cos(angle) * distance - 240,
            );
            mountain.rotation.y = (Math.random() - 0.5) * 0.6;
            mountain.scale.set(
                1.4 + Math.random() * 0.6,
                1.2 + Math.random() * 0.5,
                1.4 + Math.random() * 0.6,
            );
            group.add(mountain);
        }

        const heroGeometry = new THREE.ConeGeometry(460, 920, 110, 64, true); // Behemoth centerpiece
        this.distortMountainGeometry(heroGeometry, 12.7);
        const heroPeak = new THREE.Mesh(heroGeometry, runtime.material);
        heroPeak.position.set(0, -90, -850);
        heroPeak.scale.set(1.6, 1.4, 1.6);
        group.add(heroPeak);

        const wingConfigs = [
            {
                x: -780, y: -65, z: -620, radius: 360, height: 680, seed: 21.4, rotY: -0.45,
            },
            {
                x: 820, y: -70, z: -650, radius: 410, height: 740, seed: 24.1, rotY: 0.38,
            },
        ];
        wingConfigs.forEach((config) => {
            const wingGeometry = new THREE.ConeGeometry(config.radius, config.height, 80, 48, true);
            this.distortMountainGeometry(wingGeometry, config.seed);
            const wing = new THREE.Mesh(wingGeometry, runtime.material);
            wing.position.set(config.x, config.y, config.z);
            wing.rotation.y = config.rotY;
            wing.scale.set(1.5, 1.3, 1.5);
            group.add(wing);
        });

        this.mountainGroup = group;
        this.scene.add(group);
        this.uniformSets.push(runtime.uniforms);
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
        if (this.cloudGroup) {
            this.scene.remove(this.cloudGroup);
            this.disposeObject3D(this.cloudGroup);
            this.cloudGroup = null;
            this.cloudRuntime = [];
        }

        const cloudRuntime = createCottonCloudMaterial({
            litColor: new THREE.Color(0xfffbef),
            shadowColor: new THREE.Color(0xbaabdc),
            rimColor: new THREE.Color(0xffeacc),
            opacity: 0.85,
            sunDirection: this.sunDirection,
        });

        const group = new THREE.Group();
        const clusterCount = this.qualityPreset.cloudClusters;
        const basePuffs = this.qualityPreset.cloudPuffsPerCluster;

        for (let i = 0; i < clusterCount; i += 1) {
            const cluster = new THREE.Group();
            const puffCount = basePuffs + Math.floor(Math.random() * 3);

            for (let j = 0; j < puffCount; j += 1) {
                const puff = new THREE.Mesh(
                    new THREE.SphereGeometry(1, 24, 16),
                    cloudRuntime.material,
                );

                const centerBiasX = (Math.random() - 0.5) * 4.8;
                const centerBiasZ = (Math.random() - 0.5) * 4.2;
                puff.position.set(
                    centerBiasX,
                    (Math.random() - 0.5) * 0.75 - Math.abs(centerBiasX * 0.15),
                    centerBiasZ,
                );
                const puffScale = 3.2 + Math.random() * 5.4 - (Math.abs(centerBiasX) * 0.3);
                puff.scale.set(
                    puffScale * (1.1 + Math.random() * 0.3),
                    puffScale * (0.85 + Math.random() * 0.25), // Increased Y scale for rounder clouds
                    puffScale * (1.1 + Math.random() * 0.3),
                );

                cluster.add(puff);
            }

            cluster.position.set(
                (Math.random() - 0.5) * 440,
                72 + Math.random() * 78,
                -260 + Math.random() * 340,
            );
            const clusterScale = 1.8 + Math.random() * 2.7;
            cluster.scale.setScalar(clusterScale);
            cluster.userData = {
                driftSpeed: 0.36 + Math.random() * 1.1,
                driftSpan: 360 + Math.random() * 120,
                baseY: cluster.position.y,
                bobPhase: Math.random() * Math.PI * 2,
                bobAmp: 0.5 + Math.random() * 1.4,
            };

            group.add(cluster);
            this.cloudRuntime.push(cluster);
        }

        this.cloudGroup = group;
        this.scene.add(group);
        this.uniformSets.push(cloudRuntime.uniforms);
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

        const antialias = this.getAntialiasEnabled();
        const grass = createGrassSystem(this.scene, this.terrainField, {
            terrainSize: this.terrainSize,
            grassNearCount: this.qualityPreset.grassNearCount ?? this.qualityPreset.grassInstances ?? 9000,
            grassMidCount: this.qualityPreset.grassMidCount
                ?? Math.floor((this.qualityPreset.grassInstances ?? 9000) * 0.65),
            sunDirection: this.sunDirection,
            fogColor: new THREE.Color(0xb8d0df),
            fogNear: 88,
            fogFar: 360,
            windStrength: 0.92,
            antialias,
        });

        const flowers = createFlowerSystem(this.scene, this.terrainField, {
            terrainSize: this.terrainSize,
            flowerAnchorCount: this.qualityPreset.flowerAnchorCount
                ?? Math.floor((this.qualityPreset.flowerNearCount ?? 1800) * 0.25),
            flowerAnchorMin: this.qualityPreset.flowerAnchorMin
                ?? Math.floor((this.qualityPreset.flowerAnchorCount ?? 1800) * 0.4),
            flowerAnchorCellSize: this.qualityPreset.flowerAnchorCellSize ?? 8,
            // Match grass-like coverage so flowers remain visible in the foreground too.
            flowerDepthMin: -this.terrainSize * 0.42,
            flowerDepthMax: this.terrainSize * 0.56,
            flowerHeadsCount: this.qualityPreset.flowerHeadsCount
                ?? this.qualityPreset.flowerNearCount
                ?? this.qualityPreset.flowerInstances
                ?? 1800,
            flowerStemsCount: this.qualityPreset.flowerStemsCount
                ?? Math.floor((this.qualityPreset.flowerNearCount ?? 1800) * 1.25),
            flowerWhiteShareMax: this.qualityPreset.flowerWhiteShareMax ?? 0.1,
            flowerCarpetStrength: this.flowerCarpetStrength
                ?? this.qualityPreset.flowerCarpetStrength
                ?? 1.0,
            flowerGroundLiftHead: this.flowerGroundLiftHead,
            flowerGroundLiftStem: this.flowerGroundLiftStem,
            flowerSlopeLift: this.flowerSlopeLift,
            flowerPalettePreset: this.flowerPalettePreset,
            sunDirection: this.sunDirection,
            fogColor: new THREE.Color(0xb8d0df),
            fogNear: 86,
            fogFar: 340,
            windStrength: 0.68,
            antialias,
        });

        this.vegetation = { grass, flowers };
        this.grassMesh = grass?.nearMesh || null;
        this.flowerMesh = flowers?.headMesh || flowers?.mesh || null;

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
        const coverage10 = diagnostics.coverage10 ?? 0;
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
                `[SkyChildrenV2] Flower anchors below tier minimum (${anchors} < ${anchorMin}) on tier=${this.qualityTier}`,
                this.flowerDiagnosticsState,
            );
        }

        if (coveragePrimary < coverageTarget) {
            console.warn(
                `[SkyChildrenV2] Flower carpet coverage below target (${coveragePrimary.toFixed(3)} < ${coverageTarget.toFixed(3)})`,
                this.flowerDiagnosticsState,
            );
        }

        if (coverage20 < coverage20Target) {
            console.warn(
                `[SkyChildrenV2] Dense flower coverage too low (${coverage20.toFixed(3)} < ${coverage20Target.toFixed(3)})`,
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
        this.postComposer = new SkyCorePost(this.renderer, this.scene, this.camera, {
            useMRT: this.flags.useMRT,
            useBloom: true,
            resolutionScale: clamp(this.dynamicResolutionScale, 0.5, 1),
            bloomStrength: postPreset.bloomStrength,
            bloomRadius: postPreset.bloomRadius,
            bloomThreshold: postPreset.bloomThreshold,
            exposure: postPreset.exposure,
            contrast: postPreset.contrast,
            saturation: postPreset.saturation,
            vignetteDarkness: postPreset.vignetteDarkness,
            grainStrength: postPreset.grainStrength,
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
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.COMBO, (payload = {}) => {
            const comboCount = Number(payload.comboCount) || 1;
            if (comboCount <= 1) return;
            this.runtime.comboEnergyTarget = clamp(this.runtime.comboEnergyTarget + comboCount * 0.14, 0, 3);
            this.runtime.windTarget = clamp(this.runtime.windTarget + comboCount * 0.1, 0.74, 3.0);
        }));

        this.eventUnsubscribers.push(eventBus.on(EVENTS.PIECE_LOCK, () => {
            this.runtime.eventEnergyTarget = clamp(this.runtime.eventEnergyTarget + 0.07, 0, 3);
        }));
    }

    handleSettingsChanged() {
        const requestedTier = resolveSkyV2TierFromEffectQuality(this.getGraphicsQuality());
        this.setQualityTier(requestedTier, { rebuild: true });
    }

    setQualityTier(tier, options = {}) {
        const normalized = normalizeSkyV2QualityTier(tier, this.qualityTier);
        if (normalized === this.qualityTier && options.rebuild !== true) {
            return false;
        }

        this.qualityTier = normalized;
        this.qualityPreset = getSkyV2QualityPreset(normalized);
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
            && !this.flags.noMRT
            && this.capabilities.supportsMRT;

        this.applyRendererScale();
        this.applyVegetationDensityScale();

        if (options.rebuild === true && this.scene) {
            this.uniformSets = this.skyUniforms ? [this.skyUniforms] : [];
            this.createTerrainField();
            this.createTerrain();
            this.createMountains();
            this.createClouds();
            this.createVegetation();
            this.syncPathDebug();
            this.syncCarpetDebug();
            this.setupPostProcessing();
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
            cluster.position.y = clamp(cluster.position.y, 56, 160);
        }
    }

    updateCamera() {
        // Continuous slow forward movement
        const forwardSpeed = 3.5; // units per second
        this.cameraBasePosition.z -= forwardSpeed * 0.016; // rough delta estimation for base progression

        // Wrap camera back to start if it goes too far to create an infinite loop feel
        if (this.cameraBasePosition.z < -200) {
            this.cameraBasePosition.z = 240;
        }

        const swayX = Math.sin(this.runtime.time * 0.11 + this.runtime.cameraPhaseX) * 12.0; // Wider sway
        const swayY = Math.sin(this.runtime.time * 0.15 + this.runtime.cameraPhaseY) * 2.5;

        const nextX = this.cameraBasePosition.x + swayX;
        const nextZ = this.cameraBasePosition.z;
        const baseY = this.cameraBasePosition.y + swayY;

        const groundHere = this.sampleTerrainHeight(nextX, nextZ);
        const groundAhead = this.sampleTerrainHeight(nextX * 0.72, nextZ - 34);
        const minClearanceY = Math.max(groundHere + 8.5, groundAhead + 7.0);
        const nextY = Math.max(baseY, minClearanceY);

        this.camera.position.set(nextX, nextY, nextZ);
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

        // Make the camera look target drift lazily to lead the eye
        const targetDriftX = Math.sin(this.runtime.time * 0.08) * 40;
        const lookPosX = this.cameraTarget.x + targetDriftX;
        // Keep target slightly ahead of current Z
        const lookPosZ = nextZ - 120;

        const targetY = Math.max(
            this.cameraTarget.y,
            this.sampleTerrainHeight(lookPosX, lookPosZ) + 4.2,
        );

        // Smoothly interpolate current look target to prevent snapping on wrap
        if (!this._currentLookAt) this._currentLookAt = new THREE.Vector3(lookPosX, targetY, lookPosZ);
        this._currentLookAt.lerp(new THREE.Vector3(lookPosX, targetY, lookPosZ), 0.05);

        this.camera.lookAt(this._currentLookAt);
    }

    updateSunDirection() {
        const yaw = -0.56 + Math.sin(this.runtime.time * 0.047) * 0.16;
        const lift = 0.42 + Math.sin(this.runtime.time * 0.072) * 0.05;

        this.sunDirection.set(
            Math.sin(yaw),
            lift,
            -Math.cos(yaw),
        ).normalize();

        if (this.keyLight) {
            this.keyLight.position.copy(this.sunDirection).multiplyScalar(260);
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
        let nextFlowerDensity = this.flowerDensityScale;
        let nextGrassDensity = this.grassDensityScale;

        if (avgFrameMs > targetFrameMs + 3.0 || frameMs > targetFrameMs + 5.0) {
            if (nextFlowerDensity > 0.62) {
                nextFlowerDensity -= 0.1;
            } else if (nextGrassDensity > 0.72) {
                nextGrassDensity -= 0.08;
            } else {
                nextScale -= this.qualityPreset.adaptiveDownRate ?? 0.03;
            }
        } else if (avgFrameMs < targetFrameMs - 1.2) {
            if (nextScale < (this.qualityPreset.adaptiveMaxScale ?? 1.0) - 0.01) {
                nextScale += this.qualityPreset.adaptiveUpRate ?? 0.02;
            } else if (nextGrassDensity < 1.0) {
                nextGrassDensity += 0.05;
            } else if (nextFlowerDensity < 1.0) {
                nextFlowerDensity += 0.06;
            } else {
                nextFlowerDensity += 0.02;
            }
        }

        nextScale = clamp(
            nextScale,
            this.qualityPreset.adaptiveMinScale ?? 0.56,
            this.qualityPreset.adaptiveMaxScale ?? 1.0,
        );
        const flowerDensityFloor = this.flowerVisibilityGatePassed
            ? 0.4
            : this.flowerDensityValidationFloor;
        nextFlowerDensity = clamp(nextFlowerDensity, flowerDensityFloor, 1.35);
        nextGrassDensity = clamp(nextGrassDensity, 0.5, 1.3);

        if (
            Math.abs(nextFlowerDensity - this.flowerDensityScale) > 0.02
            || Math.abs(nextGrassDensity - this.grassDensityScale) > 0.02
        ) {
            this.flowerDensityScale = nextFlowerDensity;
            this.grassDensityScale = nextGrassDensity;
            this.applyVegetationDensityScale();
        }

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
                this.postComposer.update({
                    time: this.runtime.time,
                });
                this.postComposer.render(deltaSeconds);
                const postMs = performance.now() - start;
                this.recordPerformanceSample(postMs, 'post');
                return;
            }

            if (typeof this.renderer.renderAsync === 'function') {
                if (this.renderAsyncInFlight) return;
                this.renderAsyncInFlight = true;
                this.renderer.renderAsync(this.scene, this.camera)
                    .catch((error) => {
                        console.warn('[SkyChildrenV2] renderAsync failed:', error);
                        this.requestWebGLFallback('render-async-failure', error);
                    })
                    .finally(() => {
                        this.renderAsyncInFlight = false;
                    });
                return;
            }

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

            this.updateSunDirection();
            this.updateUniforms();
            this.updateCloudDrift(deltaSeconds);
            this.updateCamera();

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
            tiers: () => listSkyV2QualityPresets(),
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
            tiers: () => listSkyV2QualityPresets(),
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
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this._vegetationCallbackId !== null) {
            clearTimeout(this._vegetationCallbackId);
            this._vegetationCallbackId = null;
        }

        this.eventUnsubscribers.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') unsubscribe();
        });
        this.eventUnsubscribers = [];

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
            this.renderer.dispose?.();
            if (this.renderer.domElement?.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
            this.renderer = null;
        }

        this.camera = null;
        this.skyMesh = null;
        this.terrainMesh = null;
        this.terrainUnderlayMesh = null;
        this.terrainSkirtMesh = null;
        this.terrainField = null;
        this.terrainMaterialUniforms = null;
        this.mountainGroup = null;
        this.cloudGroup = null;
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
