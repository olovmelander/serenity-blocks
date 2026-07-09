/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🌙 MOONRISE SUMMIT 🌙
 *  AAA cinematic alpine moonrise — rebuild v3 (Misty Lake pattern)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Architecture:
 *    - ShaderMaterial throughout (Misty Lake-proven pattern)
 *    - WebGLRenderer (WebGPURenderer is incompatible with ShaderMaterial-based
 *      EffectComposer chain — verified at runtime)
 *    - EffectComposer + UnrealBloomPass(threshold 0.4) + Ghibli grade pass
 *    - FogExp2 atmospheric depth
 *    - 3-plane moon (disc + anamorphic streak + halo) — Switch-style focal
 *    - Layered ridges (PlaneGeometry with fbm silhouette)
 *    - Gentle wave water with vertical moon reflection strip
 *    - Aurora ribbon, drifting clouds, mist layers, dense star canopy
 *    - Camera positioned below focal — viewer gaze sweeps upward
 *
 *  Event reactivity:
 *    - LINE_CLEAR → moon pulse + shooting stars + lake highlight
 *    - COMBO → aurora intensity + horizon warm shift + mountain rim
 *    - PIECE_LOCK → lake ripple + occasional star flash
 */

import * as THREE from 'three';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { MOONRISE_SUMMIT_TETROMINOS } from './moonrise-summit-tetrominos.js';

import {
    skyVertexShader, skyFragmentShader,
    starsVertexShader, starsFragmentShader,
    auroraVertexShader, auroraFragmentShader,
    cloudVertexShader, cloudFragmentShader,
    mountainVertexShader, mountainFragmentShader,
    moonVertexShader, moonFragmentShader,
    moonStreakVertexShader, moonStreakFragmentShader,
    moonHaloVertexShader, moonHaloFragmentShader,
    waterVertexShader, waterFragmentShader,
    mistVertexShader, mistFragmentShader,
    godRayVertexShader, godRayFragmentShader,
    shootingStarVertexShader, shootingStarFragmentShader,
} from './moonrise-summit-shaders.js';

import { MoonriseSummitPost } from './moonrise-summit-post.js';
import {
    ShootingStarPool, LakeRippleDriver, MoonPulseDriver, EnvelopeDriver,
} from './moonrise-summit-compute.js';

// ────────────────────────────────────────────────────────────────────────────
// Palette
// ────────────────────────────────────────────────────────────────────────────

const COLORS = {
    skyZenith: new THREE.Color(0x06091f),
    skyMid: new THREE.Color(0x142147),
    skyHorizon: new THREE.Color(0x2c3a64),
    warmGlow: new THREE.Color(0x6a3a4a),
    mistColor: new THREE.Color(0x3c4a6a),
    fogColor: new THREE.Color(0x0e1428),
    mountainFar: new THREE.Color(0x2a3458),
    mountainMid: new THREE.Color(0x1f2a4a),
    mountainNear: new THREE.Color(0x18223a),
    mountainShoulder: new THREE.Color(0x0e152a),
    snowColor: new THREE.Color(0xeaf2ff),
    rimColor: new THREE.Color(0xc6d8ff),
    moonColor: new THREE.Color(0xf6efd8),
    moonHalo: new THREE.Color(0xb8c6f0),
    moonReflection: new THREE.Color(0xf4ecd0),
    waterDeep: new THREE.Color(0x07101f),
    waterShallow: new THREE.Color(0x1b2a4a),
    auroraA: new THREE.Color(0x6fb3ff),
    auroraB: new THREE.Color(0x8d7bff),
    cloudDark: new THREE.Color(0x182238),
    cloudLit: new THREE.Color(0x9eb4d8),
    rayColor: new THREE.Color(0xb8d0ff),
    shootingStar: new THREE.Color(0xeaf2ff),
};

// World positions (camera at (0, 4.5, 30) looking at (0, 13, -50))
const MOON_WORLD_POS = new THREE.Vector3(11, 28, -75);
const CAMERA_BASE = new THREE.Vector3(0, 4.5, 30);
const CAMERA_LOOK = new THREE.Vector3(0, 13, -50);
const LAKE_Y = -2;

// UI custom properties
const THEME_CSS_VARS = {
    '--theme-accent': '#a8c4ff',
    '--theme-accent-soft': 'rgba(168, 196, 255, 0.35)',
    '--theme-panel-bg': 'rgba(14, 20, 36, 0.78)',
    '--theme-panel-border': 'rgba(168, 196, 255, 0.28)',
    '--theme-panel-glow': '0 0 24px rgba(168, 196, 255, 0.18)',
    '--theme-text-primary': '#e8eeff',
    '--theme-text-secondary': '#9aa8c4',
    '--lock-ripple-border-color': 'rgba(168, 196, 255, 0.7)',
    '--lock-ripple-shadow-color': 'rgba(168, 196, 255, 0.5)',
};

// Quality presets
const QUALITY_PRESETS = {
    Minimal: {
        starCount: 1000,
        mistLayers: 1,
        cloudCount: 2,
        waterSegs: [64, 32],
        bloomEnabled: false,
        bloomStrength: 0.3,
        enableAurora: false,
        enableGodRays: false,
        shootingPool: 4,
        vignette: 0.4,
        grain: 0.0,
        ca: 0.0,
        pixelRatioCap: 1.25,
        cameraBreathe: 0.0,
    },
    Low: {
        starCount: 1800,
        mistLayers: 2,
        cloudCount: 2,
        waterSegs: [96, 48],
        bloomEnabled: true,
        bloomStrength: 0.35,
        enableAurora: false,
        enableGodRays: false,
        shootingPool: 6,
        vignette: 0.42,
        grain: 0.012,
        ca: 0.0,
        pixelRatioCap: 1.5,
        cameraBreathe: 0.0,
    },
    Medium: {
        starCount: 2800,
        mistLayers: 2,
        cloudCount: 3,
        waterSegs: [128, 64],
        bloomEnabled: true,
        bloomStrength: 0.42,
        enableAurora: true,
        enableGodRays: false,
        shootingPool: 8,
        vignette: 0.43,
        grain: 0.018,
        ca: 0.0005,
        pixelRatioCap: 1.75,
        cameraBreathe: 0.18,
    },
    High: {
        starCount: 3500,
        mistLayers: 3,
        cloudCount: 3,
        waterSegs: [192, 96],
        bloomEnabled: true,
        bloomStrength: 0.5,
        enableAurora: true,
        enableGodRays: true,
        shootingPool: 10,
        vignette: 0.45,
        grain: 0.022,
        ca: 0.0008,
        pixelRatioCap: 2.0,
        cameraBreathe: 0.22,
    },
    Ultra: {
        starCount: 4500,
        mistLayers: 3,
        cloudCount: 4,
        waterSegs: [224, 112],
        bloomEnabled: true,
        bloomStrength: 0.6,
        enableAurora: true,
        enableGodRays: true,
        shootingPool: 14,
        vignette: 0.46,
        grain: 0.026,
        ca: 0.001,
        pixelRatioCap: 2.0,
        cameraBreathe: 0.26,
    },
    Extreme: {
        starCount: 5500,
        mistLayers: 4,
        cloudCount: 5,
        waterSegs: [256, 128],
        bloomEnabled: true,
        bloomStrength: 0.7,
        enableAurora: true,
        enableGodRays: true,
        shootingPool: 16,
        vignette: 0.48,
        grain: 0.03,
        ca: 0.0014,
        pixelRatioCap: 2.0,
        cameraBreathe: 0.3,
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Theme class
// ────────────────────────────────────────────────────────────────────────────

export default class MoonriseSummitTheme extends BaseTheme {
    constructor() {
        super('moonrise-summit');
        this.resourceProfile = 'heavy-gpu';

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.post = null;
        this.clock = new THREE.Clock();
        this.elapsed = 0;
        this.isWebGPU = false;

        // Scene groups & meshes
        this.mainGroup = null;
        this.skyMesh = null;
        this.starsMesh = null;
        this.auroraMeshes = [];
        this.cloudMeshes = [];
        this.mountainMeshes = [];
        this.moonDisc = null;
        this.moonStreak = null;
        this.moonHalo = null;
        this.lakeMesh = null;
        this.mistMeshes = [];
        this.godRayMesh = null;
        this.shootingPool = null;

        // Materials (for runtime uniform updates)
        this.materials = {
            sky: null,
            stars: null,
            aurora: [],
            cloud: [],
            mountain: [],
            moon: null,
            moonStreak: null,
            moonHalo: null,
            water: null,
            mist: [],
            godRay: null,
            shootingStar: null,
        };

        // Event drivers
        this.lakeRipple = new LakeRippleDriver({ damping: 3.5, maxAmp: 0.7 });
        this.moonPulse = new MoonPulseDriver({ rampUp: 3.5, rampDown: 1.0 });
        this.aurora = new EnvelopeDriver({ attack: 1.4, release: 0.35, maxAmp: 1.2 });
        this.horizonShift = new EnvelopeDriver({ attack: 1.0, release: 0.3, maxAmp: 0.6 });
        this.mountainRim = new EnvelopeDriver({ attack: 1.8, release: 0.4, maxAmp: 0.4 });

        // Pointer parallax
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;
        this.parallaxEnabled = true;
        this.cameraBreatheEnabled = true;
        this._reducedMotionMQ = null;
        this._reducedMotionHandler = null;

        // Event subscribers
        this.eventUnsubscribers = [];
        this.qualityChangeHandler = null;
        this._cssVarsApplied = false;

        // Quality
        this.currentQuality = 'High';
        this.preset = QUALITY_PRESETS.High;

        // Shooting star pacing
        this._nextShootingStarTime = 0;
        this._animate = null;
    }

    // ── Quality preset ────────────────────────────────────────────────────
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality, { rebuild = false } = {}) {
        let normalized = quality;
        if (!QUALITY_PRESETS[normalized]) {
            console.warn(`[MoonriseSummit] Unknown quality "${quality}", defaulting to High`);
            normalized = 'High';
        }
        this.currentQuality = normalized;
        this.preset = QUALITY_PRESETS[normalized];
        if (rebuild && this.scene) {
            this._rebuildQualityDependent();
        }
    }

    _rebuildQualityDependent() {
        // Rebuild star field if count changed
        if (this.starsMesh?.userData?.count !== this.preset.starCount) {
            this._disposeStars();
            this._createStars();
        }
        if (this.mistMeshes.length !== this.preset.mistLayers) {
            this._disposeMist();
            this._createMist();
        }
        if (this.cloudMeshes.length !== this.preset.cloudCount) {
            this._disposeClouds();
            this._createClouds();
        }
        if (this.shootingPool) {
            this.shootingPool.setMax(this.preset.shootingPool);
        }
        if (this.post) {
            this.post.updateParams({
                bloomStrength: this.preset.bloomStrength,
                vignette: this.preset.vignette,
                grain: this.preset.grain,
                ca: this.preset.ca,
            });
        }
        if (this.godRayMesh) {
            this.godRayMesh.visible = this.preset.enableGodRays;
        }
        for (const m of this.auroraMeshes) {
            m.visible = this.preset.enableAurora;
        }
        if (this.renderer) {
            const ratio = Math.min(
                this.getEffectivePixelRatio(this.preset.pixelRatioCap),
                this.preset.pixelRatioCap,
            );
            this.renderer.setPixelRatio(ratio);
        }
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;
            this.applyQualityPreset(newQuality, { rebuild: true });
        };
        this.registerEventListener(window, 'settingsChanged', this.qualityChangeHandler);
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────
    async createScene() {
        if (typeof document === 'undefined') return;
        const container = document.getElementById('moonrise-summit-theme');
        if (!container) {
            console.error('[MoonriseSummit] Container #moonrise-summit-theme not found');
            return;
        }

        this._applyCssVars();
        this._hideLegacyChildren(container);
        this.applyQualityPreset(this.getGraphicsQuality());
        this._detectReducedMotion();

        await this._initRenderer(container);
        if (!this.renderer) return;

        this._buildScene();
        this._setupPost();
        this._setupEvents();
        this._setupPointerParallax();
        this._setupResize();
        this._startAnimation();
        this._scheduleNextShootingStar(2.5 + Math.random() * 4);

        console.log('[MoonriseSummit] Scene ready (WebGL2)');
    }

    async _initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const antialias = this.getAntialiasEnabled();

        // WebGLRenderer-only path. WebGPURenderer is incompatible with
        // ShaderMaterial-based EffectComposer chain — verified at runtime.
        const renderer = new THREE.WebGLRenderer({
            antialias,
            alpha: true,
            powerPreference: 'high-performance',
        });

        this.renderer = renderer;
        this.isWebGPU = false;

        const ratio = Math.min(
            this.getEffectivePixelRatio(this.preset.pixelRatioCap),
            this.preset.pixelRatioCap,
        );
        renderer.setPixelRatio(ratio);
        renderer.setSize(width, height);
        renderer.setClearColor(COLORS.fogColor.getHex(), 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.85;
        renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:none;';
        container.appendChild(renderer.domElement);
        this.registerContainer(container);

        // Scene + camera
        this.scene = new THREE.Scene();
        this.scene.background = COLORS.fogColor.clone();
        this.scene.fog = new THREE.FogExp2(COLORS.fogColor.getHex(), 0.0042);

        const aspect = width / height;
        this.camera = new THREE.PerspectiveCamera(this._aspectFov(aspect), aspect, 0.1, 1200);
        this.camera.position.copy(CAMERA_BASE);
        this.camera.lookAt(CAMERA_LOOK);
    }

    _aspectFov(aspect) {
        const fov = 52 + Math.max(0, (1.0 - aspect)) * 20;
        return Math.min(76, Math.max(48, fov));
    }

    // ── Scene build ───────────────────────────────────────────────────────
    _buildScene() {
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        this._createSky();
        this._createStars();
        this._createAurora();
        this._createClouds();
        this._createMountains();
        this._createMoon();
        this._createLake();
        this._createGodRays();
        this._createMist();
        this._createShootingPool();
    }

    _createSky() {
        const geometry = new THREE.PlaneGeometry(420, 200);
        this.materials.sky = new THREE.ShaderMaterial({
            uniforms: {
                uZenithColor: { value: COLORS.skyZenith },
                uMidColor: { value: COLORS.skyMid },
                uHorizonColor: { value: COLORS.skyHorizon },
                uWarmGlow: { value: COLORS.warmGlow },
                uWarmStrength: { value: 0.35 },
                uTime: { value: 0 },
                uHorizonShift: { value: 0 },
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: false,
        });
        this.skyMesh = new THREE.Mesh(geometry, this.materials.sky);
        this.skyMesh.position.set(0, 40, -180);
        this.skyMesh.renderOrder = -10;
        this.mainGroup.add(this.skyMesh);
    }

    _createStars() {
        const count = this.preset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const randoms = new Float32Array(count);
        const brights = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const c = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            // Distribute on a hemispherical shell (upper) plus light scatter
            const r = 260 + Math.random() * 60;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.85 + 0.1); // bias upper
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = Math.abs(r * Math.cos(phi)) + 8;
            positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 80;

            randoms[i] = Math.random();
            brights[i] = 0.45 + Math.random() * 0.85;
            sizes[i] = 1.0 + Math.random() * 2.8;

            // Mostly cool white, occasional warm amber
            const choice = Math.random();
            if (choice < 0.82) {
                c.setHSL(0.6, 0.06, 0.85 + Math.random() * 0.15);
            } else if (choice < 0.96) {
                c.setHSL(0.6, 0.3, 0.75 + Math.random() * 0.15);
            } else {
                c.setHSL(0.08, 0.45, 0.72 + Math.random() * 0.1);
            }
            colors[i3] = c.r;
            colors[i3 + 1] = c.g;
            colors[i3 + 2] = c.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brights, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        this.materials.stars = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 2.5 },
            },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
        });
        this.starsMesh = new THREE.Points(geometry, this.materials.stars);
        this.starsMesh.frustumCulled = false;
        this.starsMesh.renderOrder = -5;
        this.starsMesh.userData.count = count;
        this.mainGroup.add(this.starsMesh);
    }

    _createAurora() {
        const configs = [
            {
                z: -150, y: 38, scale: 1.0, intensity: 0.5,
            },
            {
                z: -135, y: 32, scale: 0.7, intensity: 0.35,
            },
        ];
        for (const cfg of configs) {
            const geometry = new THREE.PlaneGeometry(280, 50);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor1: { value: COLORS.auroraA },
                    uColor2: { value: COLORS.auroraB },
                    uIntensity: { value: cfg.intensity },
                },
                vertexShader: auroraVertexShader,
                fragmentShader: auroraFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                fog: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, cfg.y, cfg.z);
            mesh.scale.setScalar(cfg.scale);
            mesh.renderOrder = -3;
            mesh.visible = this.preset.enableAurora;
            this.auroraMeshes.push(mesh);
            this.materials.aurora.push(material);
            this.mainGroup.add(mesh);
        }
    }

    _createClouds() {
        const count = this.preset.cloudCount;
        for (let i = 0; i < count; i++) {
            const w = 60 + Math.random() * 50;
            const h = 14 + Math.random() * 8;
            const geometry = new THREE.PlaneGeometry(w, h);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uDarkColor: { value: COLORS.cloudDark },
                    uLitColor: { value: COLORS.cloudLit },
                    uOpacity: { value: 0.55 + Math.random() * 0.25 },
                    uScroll: { value: 0.8 + Math.random() * 0.6 },
                    uMoonSide: { value: 0.55 + Math.random() * 0.2 },
                },
                vertexShader: cloudVertexShader,
                fragmentShader: cloudFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                fog: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            const x = -50 + Math.random() * 100;
            const y = 16 + Math.random() * 18;
            const z = -90 - Math.random() * 50;
            mesh.position.set(x, y, z);
            mesh.userData.baseX = x;
            mesh.userData.drift = 0.6 + Math.random() * 0.8;
            mesh.userData.driftDir = Math.random() < 0.5 ? -1 : 1;
            mesh.renderOrder = -2;
            this.cloudMeshes.push(mesh);
            this.materials.cloud.push(material);
            this.mainGroup.add(mesh);
        }
    }

    _createMountains() {
        const layerConfigs = [
            {
                z: -100,
                scale: 1.0,
                fogAmount: 0.55,
                color: COLORS.mountainFar,
                snowLine: 0.62,
                rim: 0.85,
                layer: 0,
                w: 320,
                h: 90,
                y: 4,
            },
            {
                z: -68,
                scale: 1.0,
                fogAmount: 0.38,
                color: COLORS.mountainMid,
                snowLine: 0.55,
                rim: 1.0,
                layer: 1,
                w: 250,
                h: 80,
                y: 1,
            },
            {
                z: -45,
                scale: 1.0,
                fogAmount: 0.22,
                color: COLORS.mountainNear,
                snowLine: 0.55,
                rim: 0.95,
                layer: 2,
                w: 200,
                h: 65,
                y: -1,
            },
            {
                z: -25,
                scale: 1.0,
                fogAmount: 0.12,
                color: COLORS.mountainShoulder,
                snowLine: 0.7,
                rim: 0.6,
                layer: 3,
                w: 150,
                h: 50,
                y: -3,
            },
        ];

        layerConfigs.forEach((cfg) => {
            const geometry = new THREE.PlaneGeometry(cfg.w, cfg.h);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uBaseColor: { value: cfg.color },
                    uTopColor: { value: cfg.color.clone().lerp(COLORS.rimColor, 0.12) },
                    uSnowColor: { value: COLORS.snowColor },
                    uFogColor: { value: COLORS.fogColor },
                    uFogAmount: { value: cfg.fogAmount },
                    uLayer: { value: cfg.layer },
                    uSnowLine: { value: cfg.snowLine },
                    uRimStrength: { value: cfg.rim },
                    uTime: { value: 0 },
                },
                vertexShader: mountainVertexShader,
                fragmentShader: mountainFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                fog: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, cfg.y, cfg.z);
            mesh.scale.set(cfg.scale, cfg.scale, 1);
            mesh.renderOrder = cfg.layer;
            this.mountainMeshes.push(mesh);
            this.materials.mountain.push(material);
            this.mainGroup.add(mesh);
        });
    }

    _createMoon() {
        // Inner disc — sized to read as ~10% of screen height at typical FOV
        const discGeom = new THREE.PlaneGeometry(22, 22);
        this.materials.moon = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uMoonColor: { value: COLORS.moonColor },
                uHaloColor: { value: COLORS.moonHalo },
                uGlowIntensity: { value: 0 },
            },
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        this.moonDisc = new THREE.Mesh(discGeom, this.materials.moon);
        this.moonDisc.position.copy(MOON_WORLD_POS);
        this.moonDisc.renderOrder = 6;
        this.mainGroup.add(this.moonDisc);

        // Anamorphic horizontal streak — Switch-game cinematic touch
        const streakGeom = new THREE.PlaneGeometry(56, 3);
        this.materials.moonStreak = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: COLORS.moonColor },
                uTime: { value: 0 },
                uGlowIntensity: { value: 0 },
            },
            vertexShader: moonStreakVertexShader,
            fragmentShader: moonStreakFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        this.moonStreak = new THREE.Mesh(streakGeom, this.materials.moonStreak);
        this.moonStreak.position.copy(MOON_WORLD_POS);
        this.moonStreak.renderOrder = 5;
        this.mainGroup.add(this.moonStreak);

        // Outer halo (atmospheric bleed)
        const haloGeom = new THREE.PlaneGeometry(55, 55);
        this.materials.moonHalo = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: COLORS.moonHalo },
                uWarm: { value: COLORS.warmGlow.clone().multiplyScalar(0.8) },
                uIntensity: { value: 0.55 },
                uGlowIntensity: { value: 0 },
                uTime: { value: 0 },
            },
            vertexShader: moonHaloVertexShader,
            fragmentShader: moonHaloFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        this.moonHalo = new THREE.Mesh(haloGeom, this.materials.moonHalo);
        this.moonHalo.position.copy(MOON_WORLD_POS);
        this.moonHalo.position.z -= 1;
        this.moonHalo.renderOrder = 4;
        this.mainGroup.add(this.moonHalo);
    }

    _createLake() {
        const [segX, segY] = this.preset.waterSegs;
        const geometry = new THREE.PlaneGeometry(200, 140, segX, segY);
        geometry.rotateX(-Math.PI / 2);

        // Moon-strip horizontal projection in lake-local UV space
        const moonUv = this._projectMoonLakeUv();

        this.materials.water = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uDeepColor: { value: COLORS.waterDeep },
                uShallowColor: { value: COLORS.waterShallow },
                uMoonReflection: { value: COLORS.moonReflection },
                uMoonGlow: { value: 1.0 },
                uGlowIntensity: { value: 0 },
                uRippleAmp: { value: 0 },
                uMoonPosition: { value: moonUv },
            },
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            fog: false,
        });
        this.lakeMesh = new THREE.Mesh(geometry, this.materials.water);
        this.lakeMesh.position.set(0, LAKE_Y, -30);
        this.lakeMesh.renderOrder = 7;
        this.mainGroup.add(this.lakeMesh);
    }

    _projectMoonLakeUv() {
        // Lake X spans [-100, 100] in world. Moon X = 11, so normalized to lake-local UV:
        const uvX = THREE.MathUtils.clamp((MOON_WORLD_POS.x + 100) / 200, 0.1, 0.9);
        return new THREE.Vector2(uvX, 0.85); // moon is high in lake-uv space
    }

    _createGodRays() {
        const geometry = new THREE.PlaneGeometry(60, 90);
        this.materials.godRay = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uRayColor: { value: COLORS.rayColor },
                uIntensity: { value: 0.7 },
            },
            vertexShader: godRayVertexShader,
            fragmentShader: godRayFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        this.godRayMesh = new THREE.Mesh(geometry, this.materials.godRay);
        this.godRayMesh.position.set(MOON_WORLD_POS.x, MOON_WORLD_POS.y - 15, MOON_WORLD_POS.z + 5);
        this.godRayMesh.renderOrder = 8;
        this.godRayMesh.visible = this.preset.enableGodRays;
        this.mainGroup.add(this.godRayMesh);
    }

    _createMist() {
        const layers = [
            {
                y: LAKE_Y + 1.5, z: -18, w: 220, h: 28, opacity: 0.7, scroll: 1.0,
            },
            {
                y: LAKE_Y + 3.5, z: -38, w: 280, h: 40, opacity: 0.55, scroll: 0.7,
            },
            {
                y: LAKE_Y + 6, z: -58, w: 320, h: 50, opacity: 0.4, scroll: 0.5,
            },
            {
                y: LAKE_Y + 8, z: -82, w: 360, h: 60, opacity: 0.3, scroll: 0.4,
            },
        ];
        const count = this.preset.mistLayers;
        for (let i = 0; i < count; i++) {
            const cfg = layers[i] ?? layers[layers.length - 1];
            const geometry = new THREE.PlaneGeometry(cfg.w, cfg.h);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uMistColor: { value: COLORS.mistColor },
                    uOpacity: { value: cfg.opacity },
                    uScroll: { value: cfg.scroll },
                },
                vertexShader: mistVertexShader,
                fragmentShader: mistFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                fog: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, cfg.y, cfg.z);
            mesh.renderOrder = 9 + i;
            this.mistMeshes.push(mesh);
            this.materials.mist.push(material);
            this.mainGroup.add(mesh);
        }
    }

    _createShootingPool() {
        this.materials.shootingStar = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: COLORS.shootingStar } },
            vertexShader: shootingStarVertexShader,
            fragmentShader: shootingStarFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        this.shootingPool = new ShootingStarPool(
            this.mainGroup,
            this.materials.shootingStar,
            this.preset.shootingPool,
        );
    }

    _setupPost() {
        if (!this.preset.bloomEnabled) return;
        this.post = new MoonriseSummitPost(this.renderer, this.scene, this.camera, {
            bloomStrength: this.preset.bloomStrength,
            bloomRadius: 0.6,
            bloomThreshold: 0.85,
            vignette: this.preset.vignette,
            grain: this.preset.grain,
            ca: this.preset.ca,
        });
    }

    // ── Events / reactivity ──────────────────────────────────────────────
    _setupEvents() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (!this.isActive || !(settings?.backgroundComboEffects === true)) return;
            this._onLineClear(data?.lineCount ?? 1);
        });
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (!this.isActive || !(settings?.backgroundComboEffects === true)) return;
            this._onCombo(data?.comboCount ?? 1);
        });
        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (!this.isActive || !(settings?.backgroundComboEffects === true)) return;
            this._onPieceLock();
        });
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, lockUnsub);
        this.setupQualityListener();
    }

    _onLineClear(lineCount) {
        const n = Math.max(1, Math.min(4, lineCount));
        this.moonPulse.impulse(0.4 + n * 0.18);
        this.lakeRipple.impulse(0.3 + n * 0.12);
        this.mountainRim.impulse(0.18 + n * 0.06);
        this.aurora.impulse(0.15 + n * 0.05);
        const spawnCount = Math.min(1 + n, 4);
        for (let i = 0; i < spawnCount; i++) {
            const delay = i * 150;
            setTimeout(() => {
                if (!this.isActive) return;
                this.shootingPool?.spawn({
                    origin: new THREE.Vector3(
                        MOON_WORLD_POS.x - 15 + Math.random() * 30,
                        MOON_WORLD_POS.y - 6 + Math.random() * 12,
                        MOON_WORLD_POS.z - 5 - Math.random() * 12,
                    ),
                    spreadX: 16,
                    spreadY: 8,
                });
            }, delay);
        }
    }

    _onCombo(comboCount) {
        const c = Math.max(1, Math.min(10, comboCount));
        this.aurora.impulse(0.3 + c * 0.06);
        this.horizonShift.impulse(0.15 + c * 0.04);
        this.mountainRim.impulse(0.15 + c * 0.04);
    }

    _onPieceLock() {
        if (Math.random() < 0.35) {
            this.lakeRipple.impulse(0.08);
        }
    }

    _scheduleNextShootingStar(seconds) {
        this._nextShootingStarTime = this.elapsed + seconds;
    }

    // ── Pointer / motion ──────────────────────────────────────────────────
    _setupPointerParallax() {
        if (typeof window === 'undefined') return;
        if (this._reducedMotion) this.parallaxEnabled = false;
        const handler = (e) => {
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        this.registerEventListener(window, 'pointermove', handler);
    }

    _detectReducedMotion() {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        this._reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = this._reducedMotionMQ.matches;
        this._reducedMotionHandler = () => {
            this._reducedMotion = this._reducedMotionMQ.matches;
            this.parallaxEnabled = !this._reducedMotion;
            this.cameraBreatheEnabled = !this._reducedMotion;
        };
        if (this._reducedMotionMQ.addEventListener) {
            this._reducedMotionMQ.addEventListener('change', this._reducedMotionHandler);
        }
    }

    // ── Resize ────────────────────────────────────────────────────────────
    _setupResize() {
        if (typeof window === 'undefined') return;
        const handler = () => this._onResize();
        this.registerEventListener(window, 'resize', handler);
        const visHandler = () => {
            this.isPaused = document.hidden;
        };
        this.registerEventListener(document, 'visibilitychange', visHandler);
    }

    _onResize() {
        if (!this.renderer || !this.camera) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspect = width / height;
        this.camera.aspect = aspect;
        this.camera.fov = this._aspectFov(aspect);
        this.camera.updateProjectionMatrix();
        const ratio = Math.min(
            this.getEffectivePixelRatio(this.preset.pixelRatioCap),
            this.preset.pixelRatioCap,
        );
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(width, height);
        if (this.post) this.post.setSize(width, height);
    }

    // ── Animation loop ────────────────────────────────────────────────────
    _startAnimation() {
        this.clock.start();
        this._animate = this.safeAnimate(() => this._renderFrame());
        this._animate();
    }

    _renderFrame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.elapsed += dt;
        const t = this.elapsed;

        // Drivers
        const pulse = this.moonPulse.update(dt);
        const ripple = this.lakeRipple.update(dt);
        const aurora = this.aurora.update(dt);
        const horizon = this.horizonShift.update(dt);
        const rim = this.mountainRim.update(dt);

        // Pointer smoothing
        const k = Math.min(dt * 3.0, 1.0);
        this.smoothedPointerX += (this.pointerX - this.smoothedPointerX) * k;
        this.smoothedPointerY += (this.pointerY - this.smoothedPointerY) * k;

        // Camera parallax + breathe
        if (this.camera) {
            const px = this.parallaxEnabled ? this.smoothedPointerX * 1.6 : 0;
            const py = this.parallaxEnabled ? -this.smoothedPointerY * 0.7 : 0;
            const breathe = this.cameraBreatheEnabled
                ? Math.sin(t * 0.18) * this.preset.cameraBreathe
                : 0;
            const swayX = this.cameraBreatheEnabled
                ? Math.sin(t * 0.09) * this.preset.cameraBreathe * 0.6
                : 0;
            this.camera.position.x = CAMERA_BASE.x + px + swayX;
            this.camera.position.y = CAMERA_BASE.y + py + breathe;
            this.camera.position.z = CAMERA_BASE.z;
            this.camera.lookAt(
                CAMERA_LOOK.x + px * 0.3,
                CAMERA_LOOK.y + py * 0.25,
                CAMERA_LOOK.z,
            );
        }

        // Uniforms
        if (this.materials.sky) {
            this.materials.sky.uniforms.uTime.value = t;
            this.materials.sky.uniforms.uHorizonShift.value = horizon;
        }
        if (this.materials.stars) {
            this.materials.stars.uniforms.uTime.value = t;
        }
        for (const m of this.materials.aurora) {
            m.uniforms.uTime.value = t;
            m.uniforms.uIntensity.value = 0.35 + aurora * 0.9;
        }
        for (const m of this.materials.cloud) {
            m.uniforms.uTime.value = t;
        }
        for (const m of this.materials.mountain) {
            m.uniforms.uTime.value = t;
            const baseRim = m.uniforms.uRimStrength.value;
            // Smoothly nudge rim strength on combos (clamp so it doesn't accumulate)
            m.uniforms.uRimStrength.value = baseRim * (1.0 + rim * 0.25);
        }
        if (this.materials.moon) {
            this.materials.moon.uniforms.uTime.value = t;
            this.materials.moon.uniforms.uGlowIntensity.value = pulse;
        }
        if (this.materials.moonStreak) {
            this.materials.moonStreak.uniforms.uTime.value = t;
            this.materials.moonStreak.uniforms.uGlowIntensity.value = pulse;
        }
        if (this.materials.moonHalo) {
            this.materials.moonHalo.uniforms.uTime.value = t;
            this.materials.moonHalo.uniforms.uGlowIntensity.value = pulse;
        }
        if (this.materials.water) {
            this.materials.water.uniforms.uTime.value = t;
            this.materials.water.uniforms.uRippleAmp.value = ripple;
            this.materials.water.uniforms.uGlowIntensity.value = pulse * 0.6;
        }
        for (const m of this.materials.mist) {
            m.uniforms.uTime.value = t;
        }
        if (this.materials.godRay) {
            this.materials.godRay.uniforms.uTime.value = t;
        }

        // Restore mountain rim to base values (so the per-frame multiplier
        // doesn't compound infinitely). Re-apply on next frame from rim envelope.
        for (let i = 0; i < this.materials.mountain.length; i++) {
            const m = this.materials.mountain[i];
            const baseRim = m.userData?.baseRim ?? null;
            if (baseRim === null) {
                m.userData = m.userData || {};
                m.userData.baseRim = m.uniforms.uRimStrength.value / Math.max(1e-6, 1.0 + rim * 0.25);
            } else {
                m.uniforms.uRimStrength.value = baseRim * (1.0 + rim * 0.25);
            }
        }

        // Make moon planes billboard to camera
        if (this.moonDisc) this.moonDisc.lookAt(this.camera.position);
        if (this.moonStreak) this.moonStreak.lookAt(this.camera.position);
        if (this.moonHalo) this.moonHalo.lookAt(this.camera.position);
        if (this.godRayMesh) this.godRayMesh.lookAt(this.camera.position);

        // Aurora soft sway
        for (let i = 0; i < this.auroraMeshes.length; i++) {
            const m = this.auroraMeshes[i];
            m.position.x = Math.sin(t * 0.08 + i * 1.3) * 3;
        }

        // Cloud drift
        for (let i = 0; i < this.cloudMeshes.length; i++) {
            const m = this.cloudMeshes[i];
            const drift = m.userData.drift * m.userData.driftDir;
            m.position.x = m.userData.baseX + Math.sin(t * 0.05 + i) * 12 + drift * t * 0.4;
            if (m.position.x > 90) m.position.x -= 180;
            else if (m.position.x < -90) m.position.x += 180;
        }

        // Ambient shooting star
        if (this.elapsed > this._nextShootingStarTime) {
            this.shootingPool?.spawn({
                origin: new THREE.Vector3(
                    MOON_WORLD_POS.x - 30 + Math.random() * 50,
                    MOON_WORLD_POS.y - 8 + Math.random() * 14,
                    MOON_WORLD_POS.z - 5 - Math.random() * 25,
                ),
                spreadX: 35,
                spreadY: 15,
            });
            const min = this.preset.starCount > 3000 ? 5 : 9;
            const max = this.preset.starCount > 3000 ? 12 : 20;
            this._scheduleNextShootingStar(min + Math.random() * (max - min));
        }

        this.shootingPool?.update(dt);

        if (this.post) {
            this.post.updateTime(t);
            this.post.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ── UI CSS variables ──────────────────────────────────────────────────
    _applyCssVars() {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        for (const [k, v] of Object.entries(THEME_CSS_VARS)) {
            root.style.setProperty(k, v);
        }
        this._cssVarsApplied = true;
    }

    _clearCssVars() {
        if (!this._cssVarsApplied || typeof document === 'undefined') return;
        const root = document.documentElement;
        for (const k of Object.keys(THEME_CSS_VARS)) {
            root.style.removeProperty(k);
        }
        this._cssVarsApplied = false;
    }

    _hideLegacyChildren(container) {
        const legacy = ['moonrise-sky', 'moonrise-stars', 'moonrise-shooting-stars',
            'moonrise-moon-aura', 'moonrise-clouds', 'moonrise-mountains', 'moonrise-peak-glow'];
        for (const id of legacy) {
            const el = container.querySelector(`#${id}`);
            if (el) el.style.display = 'none';
        }
        const moon = container.querySelector('.moonrise-moon');
        if (moon) moon.style.display = 'none';
    }

    // ── Stop / cleanup ────────────────────────────────────────────────────
    stop() {
        this.eventUnsubscribers.forEach((unsub) => { try { unsub(); } catch (e) { /* ignore */ } });
        this.eventUnsubscribers = [];
        if (this._reducedMotionMQ && this._reducedMotionHandler
            && this._reducedMotionMQ.removeEventListener) {
            this._reducedMotionMQ.removeEventListener('change', this._reducedMotionHandler);
        }
        this._clearCssVars();
        const container = document.getElementById('moonrise-summit-theme');
        if (container) {
            container.querySelectorAll('[id^="moonrise-"], .moonrise-moon').forEach((el) => {
                el.style.removeProperty('display');
            });
        }
        super.stop();
    }

    _disposeStars() {
        if (!this.starsMesh) return;
        if (this.starsMesh.parent) this.starsMesh.parent.remove(this.starsMesh);
        this.starsMesh.geometry?.dispose();
        this.starsMesh.material?.dispose();
        this.starsMesh = null;
        this.materials.stars = null;
    }

    _disposeMist() {
        for (const m of this.mistMeshes) {
            if (m.parent) m.parent.remove(m);
            m.geometry?.dispose();
            m.material?.dispose();
        }
        this.mistMeshes = [];
        this.materials.mist = [];
    }

    _disposeClouds() {
        for (const m of this.cloudMeshes) {
            if (m.parent) m.parent.remove(m);
            m.geometry?.dispose();
            m.material?.dispose();
        }
        this.cloudMeshes = [];
        this.materials.cloud = [];
    }

    cleanup() {
        if (this.shootingPool) {
            this.shootingPool.dispose();
            this.shootingPool = null;
        }
        if (this.post) {
            this.post.dispose();
            this.post = null;
        }
        if (this.scene) {
            this.disposeThreeJSGroup(this.scene);
            this.scene = null;
        }
        if (this.renderer) {
            const { domElement } = this.renderer;
            try { this.renderer.dispose?.(); } catch (e) { /* ignore */ }
            if (domElement?.parentNode) domElement.parentNode.removeChild(domElement);
            this.renderer = null;
        }
        this.camera = null;
        this.mainGroup = null;
        this.skyMesh = null;
        this.starsMesh = null;
        this.auroraMeshes = [];
        this.cloudMeshes = [];
        this.mountainMeshes = [];
        this.moonDisc = this.moonStreak = this.moonHalo = null;
        this.lakeMesh = null;
        this.mistMeshes = [];
        this.godRayMesh = null;
        this.materials = {
            sky: null,
            stars: null,
            aurora: [],
            cloud: [],
            mountain: [],
            moon: null,
            moonStreak: null,
            moonHalo: null,
            water: null,
            mist: [],
            godRay: null,
            shootingStar: null,
        };
        super.cleanup();
    }

    getTetrominoConfig() {
        return MOONRISE_SUMMIT_TETROMINOS;
    }
}
