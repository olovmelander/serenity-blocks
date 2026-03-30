/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🔥 PYRESTORM 🔥
 *  A 3D Volcanic Hellscape Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Immersive volcanic environment with:
 * - Flowing lava ocean with procedural crust/core dynamics
 * - Volcanic mountain silhouettes with rim lighting
 * - GPU-driven ember and ash particle systems
 * - Atmospheric smoke and heat haze
 * - Lightning effects on high combos
 * - Dynamic intensity scaling based on gameplay
 *
 * Inspired by volcanic hellscapes and the original 2D Pyrestorm theme.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { PYRESTORM_TETROMINOS } from './pyrestorm-tetrominos.js';
import {
    LAVA_VERTEX_SHADER,
    LAVA_FRAGMENT_SHADER,
    EMBER_VERTEX_SHADER,
    EMBER_FRAGMENT_SHADER,
    SMOKE_VERTEX_SHADER,
    SMOKE_FRAGMENT_SHADER,
    SKY_VERTEX_SHADER,
    SKY_FRAGMENT_SHADER,
    MOUNTAIN_VERTEX_SHADER,
    MOUNTAIN_FRAGMENT_SHADER,
    HEAT_DISTORTION_SHADER,
    VIGNETTE_SHADER,
    SMOKE_PLUME_VERTEX_SHADER,
    SMOKE_PLUME_FRAGMENT_SHADER,
    LAVA_BUBBLES_VERTEX_SHADER,
    LAVA_BUBBLES_FRAGMENT_SHADER,
    GOD_RAYS_VERTEX_SHADER,
    GOD_RAYS_FRAGMENT_SHADER,
    // Epic Background Effects
    STORM_CLOUDS_VERTEX_SHADER,
    STORM_CLOUDS_FRAGMENT_SHADER,
    INFERNAL_AURORA_VERTEX_SHADER,
    INFERNAL_AURORA_FRAGMENT_SHADER,
    DISTANT_VOLCANO_VERTEX_SHADER,
    DISTANT_VOLCANO_FRAGMENT_SHADER,
    ERUPTION_PARTICLE_VERTEX_SHADER,
    ERUPTION_PARTICLE_FRAGMENT_SHADER,
} from './pyrestorm-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        emberCount: 50000,
        smokeCount: 5000,
        ashCount: 10000,
        terrainSegments: 256,
        lavaDetail: 128,
        bloomStrength: 0.6,
        bloomRadius: 0.4,
        bloomThreshold: 0.5,
        enableBloom: true,
        enableHeatDistortion: true,
        enableShadows: true,
        mountainDetail: 64,
        enableSmokePlume: true,
        smokePlumeSegments: 48,
        enableLavaBubbles: true,
        enableGodRays: true,
        godRaySegments: 64,
        // Epic Background
        enableStormClouds: true,
        enableInfernalAurora: true,
        enableDistantVolcanos: true,
        distantVolcanoCount: 5,
        auroraRibbonCount: 3,
    },
    Ultra: {
        emberCount: 30000,
        smokeCount: 3000,
        ashCount: 6000,
        terrainSegments: 192,
        lavaDetail: 96,
        bloomStrength: 0.5,
        bloomRadius: 0.35,
        bloomThreshold: 0.55,
        enableBloom: true,
        enableHeatDistortion: true,
        enableShadows: true,
        mountainDetail: 48,
        enableSmokePlume: true,
        smokePlumeSegments: 40,
        enableLavaBubbles: true,
        enableGodRays: true,
        godRaySegments: 48,
        // Epic Background
        enableStormClouds: true,
        enableInfernalAurora: true,
        enableDistantVolcanos: true,
        distantVolcanoCount: 4,
        auroraRibbonCount: 3,
    },
    High: {
        emberCount: 15000,
        smokeCount: 2000,
        ashCount: 3000,
        terrainSegments: 128,
        lavaDetail: 64,
        bloomStrength: 0.4,
        bloomRadius: 0.3,
        bloomThreshold: 0.6,
        enableBloom: true,
        enableHeatDistortion: true,
        enableShadows: false,
        mountainDetail: 32,
        enableSmokePlume: true,
        smokePlumeSegments: 32,
        enableLavaBubbles: true,
        enableGodRays: true,
        godRaySegments: 32,
        // Epic Background
        enableStormClouds: true,
        enableInfernalAurora: true,
        enableDistantVolcanos: true,
        distantVolcanoCount: 3,
        auroraRibbonCount: 2,
    },
    Medium: {
        emberCount: 8000,
        smokeCount: 60,
        ashCount: 1500,
        terrainSegments: 64,
        lavaDetail: 48,
        bloomStrength: 0.7,
        bloomRadius: 0.3,
        bloomThreshold: 0.4,
        enableBloom: true,
        enableHeatDistortion: false,
        enableShadows: false,
        mountainDetail: 24,
        enableSmokePlume: true,
        smokePlumeSegments: 24,
        enableLavaBubbles: true,
        enableGodRays: false,
        godRaySegments: 24,
        // Epic Background
        enableStormClouds: true,
        enableInfernalAurora: true,
        enableDistantVolcanos: true,
        distantVolcanoCount: 2,
        auroraRibbonCount: 2,
    },
    Low: {
        emberCount: 3000,
        smokeCount: 30,
        ashCount: 500,
        terrainSegments: 32,
        lavaDetail: 32,
        bloomStrength: 0.4,
        bloomRadius: 0.2,
        bloomThreshold: 0.5,
        enableBloom: false,
        enableHeatDistortion: false,
        enableShadows: false,
        mountainDetail: 16,
        enableSmokePlume: true,
        smokePlumeSegments: 16,
        enableLavaBubbles: false,
        enableGodRays: false,
        godRaySegments: 16,
        // Epic Background
        enableStormClouds: true,
        enableInfernalAurora: false,
        enableDistantVolcanos: true,
        distantVolcanoCount: 2,
        auroraRibbonCount: 1,
    },
    Minimum: {
        emberCount: 1000,
        smokeCount: 15,
        ashCount: 200,
        terrainSegments: 16,
        lavaDetail: 16,
        bloomStrength: 0.0,
        bloomRadius: 0.0,
        bloomThreshold: 1.0,
        enableBloom: false,
        enableHeatDistortion: false,
        enableShadows: false,
        mountainDetail: 8,
        enableSmokePlume: false,
        smokePlumeSegments: 8,
        enableLavaBubbles: false,
        enableGodRays: false,
        godRaySegments: 8,
        // Epic Background
        enableStormClouds: false,
        enableInfernalAurora: false,
        enableDistantVolcanos: true,
        distantVolcanoCount: 2,
        auroraRibbonCount: 0,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class PyrestormTheme extends BaseTheme {
    constructor() {
        super('pyrestorm');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.bloomPass = null;
        this.heatPass = null;

        // Scene elements
        this.lavaPlane = null;
        this.groundPlane = null;
        this.volcanoTerrain = null;
        this.mountains = [];
        this.emberSystem = null;
        this.smokeSystem = null;
        this.ashSystem = null;
        this.skybox = null;
        this.lightningBolts = [];

        // New visual effects
        this.smokePlume = null;
        this.lavaBubbles = null;
        this.godRays = null;

        // Epic Background Effects
        this.stormClouds = null;
        this.infernalAuroras = []; // Multiple aurora ribbons
        this.distantVolcanos = []; // Array of distant volcano meshes
        this.eruptionPhases = []; // Track eruption animation per volcano
        this.horizonRing = null; // Horizon ring with fading edge

        // Lighting
        this.ambientLight = null;
        this.lavaLight = null;
        this.flashLight = null;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        // Effects state
        this.intensity = 0; // 0-1, rises with gameplay activity
        this.shake = 0; // Screen shake intensity
        this.lightningFlash = 0; // Lightning flash intensity
        this.comboCount = 0;
        this.surgeIntensity = 0; // Lava surge effect
        this.lavaPulse = 0; // Brief lava glow on piece lock

        // Camera - positioned to see volcano from elevated side angle
        this.cameraBasePosition = new THREE.Vector3(0, 350, 1000);
        this.cameraLookAt = new THREE.Vector3(0, 200, 0);
        this.cameraBreathSpeed = 0.12;
        this.cameraBreathAmplitude = { x: 12, y: 8, z: 8 };

        // Geysers
        this.geysers = [];
        this.maxGeysers = 5;

        console.log('[Pyrestorm] 🔥 Theme constructed');
    }

    getTetrominoConfig() {
        return PYRESTORM_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        console.log(`[Pyrestorm] Applied ${quality} quality preset`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────
    async createScene() {
        console.log('[Pyrestorm] 🔥 Creating volcanic hellscape...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('pyrestorm-theme');
        if (!container) {
            console.error('[Pyrestorm] Container not found');
            return;
        }

        // Phase 1: Core rendering pipeline
        this.initRenderer(container);

        this.createSkybox();
        this.setupLighting();

        // Phase 2: Environment
        this.createLavaOcean();
        this.createVolcanoTerrain(); // Outer volcano slopes
        this.createMountains();
        this.createSurroundings(); // New alien environment

        // Phase 3: Particles
        this.createEmberSystem();
        this.createExplosionSystem();
        this.createAshSystem();

        // Phase 3.5: Visual Effects
        this.createSmokePlume();
        this.createLavaBubbles();
        this.createGodRays();

        // Phase 3.6: Epic Background Effects 🔥
        this.createStormClouds();
        this.createInfernalAurora();
        this.createDistantVolcanos();

        // Phase 4: Post-processing
        this.setupPostProcessing();

        // Phase 5: Event listeners
        this.setupEventListeners();

        // Start animation
        this.startAnimation();

        console.log('[Pyrestorm] 🔥 Scene creation complete');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer Setup
    // ─────────────────────────────────────────────────────────────────────────
    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });

        this.renderer.setClearColor(0x050000, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio(2));
        this.renderer.setSize(width, height);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.7; // Reduced to prevent overexposure

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        // Camera setup - looking down at lava from elevated position
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraLookAt);

        // Handle resize
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);

        console.log('[Pyrestorm] Renderer initialized');
    }

    handleResize() {
        if (!this.renderer || !this.camera) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Skybox
    // ─────────────────────────────────────────────────────────────────────────
    createSkybox() {
        const geometry = new THREE.SphereGeometry(15000, 32, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
            },
            vertexShader: SKY_VERTEX_SHADER,
            fragmentShader: SKY_FRAGMENT_SHADER,
            side: THREE.BackSide,
        });

        this.skybox = new THREE.Mesh(geometry, material);
        this.scene.add(this.skybox);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────
    setupLighting() {
        // Dim ambient
        this.ambientLight = new THREE.AmbientLight(0x1a0500, 0.3);
        this.scene.add(this.ambientLight);

        // Lava glow from below
        this.lavaLight = new THREE.DirectionalLight(0xff4500, 1.5);
        this.lavaLight.position.set(0, -50, 0);
        this.scene.add(this.lavaLight);

        // Dynamic flash light for lightning
        this.flashLight = new THREE.PointLight(0xffffcc, 0, 2000);
        this.flashLight.position.set(0, 500, 0);
        this.scene.add(this.flashLight);

        // Rim lighting for atmosphere
        const rimLight = new THREE.DirectionalLight(0xff2200, 0.5);
        rimLight.position.set(0, 100, -500);
        this.scene.add(rimLight);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lava Lake (Crater Floor)
    // ─────────────────────────────────────────────────────────────────────────
    createLavaOcean() {
        const segments = this.qualityPreset.lavaDetail;
        // Lava lake sized to fit inside crater (crater floor radius ~250)
        const geometry = new THREE.CircleGeometry(220, segments);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uWaveHeight: { value: 5 },
                uWaveSpeed: { value: 0.3 },
                uCrustThreshold: { value: 0.55 },
                uLavaPulse: { value: 0 },
                uCoreColor: { value: new THREE.Color(1.0, 0.3, 0.0) },
                uCrustColor: { value: new THREE.Color(0.08, 0.03, 0.01) },
                uFlowSpeed: { value: 0.15 },
            },
            vertexShader: LAVA_VERTEX_SHADER,
            fragmentShader: LAVA_FRAGMENT_SHADER,
            side: THREE.DoubleSide,
        });

        this.lavaPlane = new THREE.Mesh(geometry, material);
        this.lavaPlane.position.y = 155; // Inside crater (volcano at y=-150 + crater floor at 300 = 150)
        this.lavaPlane.frustumCulled = false;
        this.scene.add(this.lavaPlane);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Volcano Terrain (Cone shape rising from ground with crater at top)
    // ─────────────────────────────────────────────────────────────────────────
    createVolcanoTerrain() {
        const segments = Math.max(48, this.qualityPreset.lavaDetail);

        // ===== GROUND PLANE =====
        const groundGeometry = new THREE.PlaneGeometry(40000, 40000, 48, 48);
        groundGeometry.rotateX(-Math.PI / 2);

        const groundPositions = groundGeometry.attributes.position.array;
        for (let i = 0; i < groundPositions.length; i += 3) {
            const x = groundPositions[i];
            const z = groundPositions[i + 2];
            const noise = Math.sin(x * 0.005) * Math.cos(z * 0.005) * 20;
            groundPositions[i + 1] = noise - 150;
        }
        groundGeometry.computeVertexNormals();

        const groundMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uLavaPulse: { value: 0 },
                uRimColor: { value: new THREE.Color(0.2, 0.05, 0.0) },
            },
            vertexShader: MOUNTAIN_VERTEX_SHADER,
            fragmentShader: MOUNTAIN_FRAGMENT_SHADER,
            side: THREE.DoubleSide,
        });

        this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        this.groundPlane.frustumCulled = false;
        this.scene.add(this.groundPlane);

        // ===== VOLCANO WITH CRATER (LatheGeometry from profile) =====
        // Define volcano cross-section profile: base -> slope -> rim -> crater floor
        const volcanoHeight = 350;
        const baseRadius = 900;
        const rimRadius = 300;
        const craterFloorRadius = 250;
        const craterDepth = 50;

        const points = [];
        // Start from center of crater floor
        points.push(new THREE.Vector2(0, volcanoHeight - craterDepth));
        points.push(new THREE.Vector2(craterFloorRadius * 0.3, volcanoHeight - craterDepth));
        points.push(new THREE.Vector2(craterFloorRadius * 0.6, volcanoHeight - craterDepth + 5));
        points.push(new THREE.Vector2(craterFloorRadius, volcanoHeight - craterDepth + 10));
        // Crater inner wall rising to rim
        points.push(new THREE.Vector2(rimRadius, volcanoHeight));
        // Outer slope going down to base
        points.push(new THREE.Vector2(baseRadius * 0.5, volcanoHeight * 0.5));
        points.push(new THREE.Vector2(baseRadius * 0.75, volcanoHeight * 0.25));
        points.push(new THREE.Vector2(baseRadius, 0));

        const volcanoGeometry = new THREE.LatheGeometry(points, segments);

        // Add noise displacement for rocky surface
        const volcanoPositions = volcanoGeometry.attributes.position.array;
        for (let i = 0; i < volcanoPositions.length; i += 3) {
            const x = volcanoPositions[i];
            const y = volcanoPositions[i + 1];
            const z = volcanoPositions[i + 2];

            const noise = Math.sin(x * 0.015) * Math.cos(z * 0.015) * 15;
            const fineNoise = Math.sin(x * 0.04 + z * 0.04) * 8;

            // Don't displace crater floor too much
            const dist = Math.sqrt(x * x + z * z);
            if (dist > craterFloorRadius * 0.8) {
                volcanoPositions[i + 1] += noise + fineNoise;
            }
        }
        volcanoGeometry.computeVertexNormals();

        const volcanoMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uLavaPulse: { value: 0 },
                uRimColor: { value: new THREE.Color(0.4, 0.1, 0.0) },
            },
            vertexShader: MOUNTAIN_VERTEX_SHADER,
            fragmentShader: MOUNTAIN_FRAGMENT_SHADER,
            side: THREE.DoubleSide,
        });

        this.volcanoTerrain = new THREE.Mesh(volcanoGeometry, volcanoMaterial);
        this.volcanoTerrain.position.y = -150; // Position so base is at ground level
        this.volcanoTerrain.frustumCulled = false;
        this.scene.add(this.volcanoTerrain);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Crater Rim Mountains
    // ─────────────────────────────────────────────────────────────────────────
    createMountains() {
        const peakCount = 16; // Peaks around the rim
        const detail = this.qualityPreset.mountainDetail;
        const craterRadius = 600; // Distance from center

        for (let i = 0; i < peakCount; i++) {
            const angle = (i / peakCount) * Math.PI * 2;
            const radiusVariation = 0.85 + Math.random() * 0.3;
            const distance = craterRadius * radiusVariation;

            const x = Math.cos(angle) * distance;
            const z = Math.sin(angle) * distance;

            // Jagged peaks pointing inward and upward
            const width = 150 + Math.random() * 100;
            const height = 200 + Math.random() * 300;

            const geometry = this.createCraterPeakGeometry(width, height, detail);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uIntensity: { value: 0 },
                    uLavaPulse: { value: 0 },
                    uRimColor: { value: new THREE.Color(1.0, 0.3, 0.05) },
                },
                vertexShader: MOUNTAIN_VERTEX_SHADER,
                fragmentShader: MOUNTAIN_FRAGMENT_SHADER,
                side: THREE.DoubleSide,
            });

            const mountain = new THREE.Mesh(geometry, material);
            mountain.position.set(x, -50, z); // Base at crater floor level
            // Face slightly inward toward crater center
            mountain.rotation.y = angle + Math.PI + (Math.random() - 0.5) * 0.3;

            this.scene.add(mountain);
            this.mountains.push(mountain);
        }

        // Add outer ring of distant mountains
        this.createOuterMountains();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Alien Surroundings (Instanced Spires + Horizon)
    // ─────────────────────────────────────────────────────────────────────────
    createSurroundings() {
        // 1. Instanced Basalt Spires (Low Poly Fields)
        const spireCount = 3000;
        const spireGeo = new THREE.ConeGeometry(30, 120, 4); // Sharp pyramid
        spireGeo.translate(0, 60, 0); // Pivot at bottom
        spireGeo.computeVertexNormals();

        const spireMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uLavaPulse: { value: 0 },
                uRimColor: { value: new THREE.Color(0.5, 0.2, 0.05) },
            },
            vertexShader: MOUNTAIN_VERTEX_SHADER,
            fragmentShader: MOUNTAIN_FRAGMENT_SHADER,
        });

        const styles = new THREE.InstancedMesh(spireGeo, spireMat, spireCount);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < spireCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 1100 + Math.random() ** 2 * 8000; // Biased towards center (1100-9100)

            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            // Height Noise interaction (optional, simpler to just place on ground y=-150)
            const y = -150;

            dummy.position.set(x, y, z);

            // Randomize jaggedness
            const heavy = Math.random() > 0.9; // Occasional giant monolith
            const scale = heavy ? 2.0 + Math.random() * 3.0 : 0.5 + Math.random() * 1.5;

            dummy.scale.set(scale, scale * (0.8 + Math.random()), scale);
            dummy.rotation.x = (Math.random() - 0.5) * 0.3; // Slight tilt
            dummy.rotation.z = (Math.random() - 0.5) * 0.3;
            dummy.rotation.y = Math.random() * Math.PI * 2;

            dummy.updateMatrix();
            styles.setMatrixAt(i, dummy.matrix);
        }
        styles.instanceMatrix.needsUpdate = true;
        styles.frustumCulled = false;
        this.mountains.push(styles); // Add to update list for uniforms
        this.scene.add(styles);

        // 2. Horizon Ring (Silhouette)
        // Pushed far back to R=12000 to avoid "Wall" effect
        const horizonGeo = new THREE.CylinderGeometry(12000, 12000, 2500, 64, 8, true);
        const pos = horizonGeo.attributes.position;
        const uvs = horizonGeo.attributes.uv;

        // Displace top edge to look like mountains with more variation
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const angle = Math.atan2(z, x);

            if (y > 0) { // Top vertices
                // Multi-frequency noise for more organic peaks
                const noise1 = Math.sin(angle * 12) * Math.cos(angle * 35) * 400;
                const noise2 = Math.sin(angle * 25 + 1.5) * 200;
                const noise3 = Math.cos(angle * 50) * 100;
                const randomJag = (Math.random() - 0.5) * 300;
                pos.setY(i, 800 + noise1 + noise2 + noise3 + randomJag);
            } else {
                pos.setY(i, -800); // Bottom below ground
            }
        }
        horizonGeo.computeVertexNormals();

        const horizonMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x601008) }, // Darker magma red
                bottomColor: { value: new THREE.Color(0x050000) }, // Black Bottom
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                
                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float uTime;
                
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                
                // Simple noise for edge variation
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
                    // Base gradient
                    vec3 color = mix(bottomColor, topColor, smoothstep(0.0, 0.6, vUv.y));
                    
                    // Add slight atmospheric glow near top
                    float glowFactor = smoothstep(0.5, 0.9, vUv.y);
                    color += vec3(0.15, 0.05, 0.02) * glowFactor;
                    
                    // Alpha fade at top edge with noise for irregular fadeout
                    float angle = atan(vWorldPosition.z, vWorldPosition.x);
                    float edgeNoise = noise(vec2(angle * 8.0, vUv.y * 2.0)) * 0.15;
                    float edgeNoise2 = noise(vec2(angle * 20.0, vUv.y * 5.0)) * 0.1;
                    
                    // Fade starts at 70% height, fully transparent at top
                    float alpha = 1.0 - smoothstep(0.6 - edgeNoise, 0.95 + edgeNoise2, vUv.y);
                    
                    // Also fade at the very bottom
                    alpha *= smoothstep(0.0, 0.1, vUv.y);
                    
                    if (alpha < 0.01) discard;
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            side: THREE.BackSide, // Visible from inside
            transparent: true,
            depthWrite: false,
        });

        this.horizonRing = new THREE.Mesh(horizonGeo, horizonMat);
        this.horizonRing.position.y = -500;
        this.scene.add(this.horizonRing);
    }

    createOuterMountains() {
        const outerCount = 12;
        const detail = Math.max(8, this.qualityPreset.mountainDetail / 2);
        const outerRadius = 2500;

        for (let i = 0; i < outerCount; i++) {
            const angle = (i / outerCount) * Math.PI * 2 + Math.PI / outerCount;
            const distance = outerRadius + Math.random() * 300;

            const x = Math.cos(angle) * distance;
            const z = Math.sin(angle) * distance;

            const width = 300 + Math.random() * 200;
            const height = 150 + Math.random() * 200;

            const geometry = this.createMountainGeometry(width, height, detail);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uIntensity: { value: 0 },
                    uLavaPulse: { value: 0 },
                    uRimColor: { value: new THREE.Color(0.5, 0.1, 0.0) },
                },
                vertexShader: MOUNTAIN_VERTEX_SHADER,
                fragmentShader: MOUNTAIN_FRAGMENT_SHADER,
            });

            const mountain = new THREE.Mesh(geometry, material);
            mountain.position.set(x, -80, z);
            mountain.rotation.y = Math.random() * Math.PI * 2;

            this.scene.add(mountain);
            this.mountains.push(mountain);
        }
    }

    createCraterPeakGeometry(width, height, segments) {
        // Create a jagged, spiky peak geometry
        const geometry = new THREE.ConeGeometry(width * 0.5, height, segments, 4);
        const positions = geometry.attributes.position.array;

        // Add noise displacement for jagged look
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];

            // Skip the tip
            if (y < height * 0.4) {
                const noise = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 30;
                const jag = (Math.random() - 0.5) * 40;
                positions[i] += noise + jag;
                positions[i + 2] += noise * 0.5 + jag;
            }
        }

        geometry.computeVertexNormals();
        return geometry;
    }

    createMountainGeometry(width, height, segments) {
        const vertices = [];
        const indices = [];

        // Simple procedural mountain shape
        for (let z = 0; z <= segments; z++) {
            for (let x = 0; x <= segments; x++) {
                const u = x / segments;
                const v = z / segments;

                const px = (u - 0.5) * width;
                const pz = (v - 0.5) * width * 0.6;

                // Mountain profile: peak in center
                const distFromCenter = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2;
                const mountainFactor = Math.max(0, 1 - distFromCenter);
                const peakNoise = Math.sin(u * 15) * Math.cos(v * 12) * 0.1;
                const py = mountainFactor * mountainFactor * height * (1 + peakNoise);

                vertices.push(px, py, pz);
            }
        }

        // Indices
        for (let z = 0; z < segments; z++) {
            for (let x = 0; x < segments; x++) {
                const a = z * (segments + 1) + x;
                const b = a + 1;
                const c = a + segments + 1;
                const d = c + 1;

                indices.push(a, b, c);
                indices.push(b, d, c);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ember Particle System
    // ─────────────────────────────────────────────────────────────────────────
    createEmberSystem() {
        const count = this.qualityPreset.emberCount;

        const positions = new Float32Array(count * 3);
        const lifes = new Float32Array(count);
        const randoms = new Float32Array(count);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            this.initEmber(i, positions, lifes, randoms, speeds);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lifes, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 30 },
                uIntensity: { value: 0 },
            },
            vertexShader: EMBER_VERTEX_SHADER,
            fragmentShader: EMBER_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.emberSystem = new THREE.Points(geometry, material);
        this.scene.add(this.emberSystem);

        // Store for updates
        this.emberData = {
            positions, lifes, randoms, speeds, count,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Explosion System (Physics-based glowing rocks)
    // ─────────────────────────────────────────────────────────────────────────
    createExplosionSystem() {
        const count = 15000; // Massively increased pool for dramatic eruptions

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const lifes = new Float32Array(count);
        const sizes = new Float32Array(count);

        // Initialize invisible
        lifes.fill(0);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Shader for glowing rocks
        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: { value: new THREE.TextureLoader().load(`${this.assetBase}/textures/sprites/spark1.png`) },
            },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;
                void main() {
                    // Procedural Soft Circle (No Texture Dependency)
                    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                    float r = dot(cxy, cxy);
                    if (r > 1.0) discard;
                    float alpha = pow(1.0 - r, 2.0); // Soft glow

                    // Safety Color Fallback: If vColor is black, use Orange
                    vec3 col = vColor;
                    if (length(col) < 0.1) col = vec3(1.0, 0.5, 0.0);
                    
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            vertexColors: true,
        });

        this.explosionSystem = new THREE.Points(geometry, material);
        this.explosionSystem.frustumCulled = false;
        this.scene.add(this.explosionSystem);

        this.explosionData = {
            positions, velocities, colors, lifes, sizes, count,
        };
    }

    triggerVolcanicExplosion(intensity = 1) {
        if (!this.explosionData) return;

        const {
            positions, velocities, colors, lifes, sizes, count,
        } = this.explosionData;
        let spawned = 0;
        const spawnCount = Math.min(count, 1000 + intensity * 600); // 1000 to ~4000 particles

        // Crater position (Origin)
        // Crater position (Origin) -> Lowered to fit crater
        const origin = new THREE.Vector3(0, 50, 0);

        for (let i = 0; i < count; i++) {
            if (lifes[i] <= 0) {
                const i3 = i * 3;

                // Reset Position to crater volume (Wider)
                const r = Math.random() * 200;
                const theta = Math.random() * Math.PI * 2;
                positions[i3] = origin.x + Math.cos(theta) * r;
                positions[i3 + 1] = origin.y + (Math.random() - 0.5) * 20;
                positions[i3 + 2] = origin.z + Math.sin(theta) * r;

                // Explosive Velocity - MASSIVE WIDE ARCS
                // Use spherical coordinates for direction
                const angle = Math.random() * Math.PI * 2; // Horizontal angle (0-360)
                // Elevation: Wide arcs (10 to 60 degrees)
                const elevation = 0.2 + Math.random() * 0.9;

                // Huge velocity magnitude - Higher for more epic flight
                const velocityMag = 1500 + Math.random() * 3000 * intensity;

                // Convert spherical to cartesian
                // y = r * sin(elevation)
                // h = r * cos(elevation) -> x=h*cos(angle), z=h*sin(angle)
                const hSpeed = Math.cos(elevation) * velocityMag;

                velocities[i3] = Math.cos(angle) * hSpeed;
                velocities[i3 + 1] = Math.sin(elevation) * velocityMag;
                velocities[i3 + 2] = Math.sin(angle) * hSpeed;

                // Color - Bright white/yellow core -> cools to red
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.5 + Math.random() * 0.5; // Orange/Yellow
                colors[i3 + 2] = 0.0; // No Blue for fire

                // Life: longer duration for sweeping arcs
                lifes[i] = 4.0 + Math.random() * 6.0;
                sizes[i] = 60 + Math.random() * 80; // Bigger chunks for visibility

                // Debug log removed

                // Removed overwrite

                spawned++;
                if (spawned >= spawnCount) break;
            }
        }

        // Massive Screenshake
        this.shakeIntensity = Math.min(4.0, this.shakeIntensity + 1.0 * intensity);
    }

    updateExplosions(dt) {
        if (!this.explosionData) return;

        const {
            positions, velocities, colors, lifes, sizes, count,
        } = this.explosionData;
        const posAttr = this.explosionSystem.geometry.attributes.position;
        const colorAttr = this.explosionSystem.geometry.attributes.color;

        let needsUpdate = false;
        const gravity = -700; // Lighter gravity for more cinematic, sweeping arcs
        const floorY = 0;

        for (let i = 0; i < count; i++) {
            if (lifes[i] > 0) {
                const i3 = i * 3;

                // Physics
                velocities[i3 + 1] += gravity * dt;

                positions[i3] += velocities[i3] * dt;
                positions[i3 + 1] += velocities[i3 + 1] * dt;
                positions[i3 + 2] += velocities[i3 + 2] * dt;

                // Ground collision
                if (positions[i3 + 1] < floorY) {
                    positions[i3 + 1] = floorY;
                    velocities[i3 + 1] *= -0.5; // Bounce
                    if (Math.abs(velocities[i3 + 1]) < 50) velocities[i3 + 1] = 0;
                    velocities[i3] *= 0.8; // Friction
                    velocities[i3 + 2] *= 0.8;
                }

                // Life decay
                lifes[i] -= dt;
                if (lifes[i] <= 0) {
                    lifes[i] = 0;
                    positions[i3 + 1] = -1000; // Hide
                } else {
                    // Color cooling (Redder as it cools)
                    colors[i3 + 1] *= 0.99; // Less green -> more red/orange
                }

                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            posAttr.needsUpdate = true;
            colorAttr.needsUpdate = true;
            this.explosionSystem.geometry.attributes.size.needsUpdate = true;
        }
    }

    initEmber(index, positions, lifes, randoms, speeds) {
        const i3 = index * 3;

        // Spawn within crater lava lake area (radius ~250)
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 250;
        positions[i3] = Math.cos(angle) * radius;
        positions[i3 + 1] = 40 + Math.random() * 10; // Crater lava level
        positions[i3 + 2] = Math.sin(angle) * radius;

        lifes[index] = Math.random();
        randoms[index] = Math.random();
        speeds[index] = 30 + Math.random() * 50;
    }

    updateEmbers(dt) {
        if (!this.emberSystem || !this.emberData) return;

        const {
            positions, lifes, randoms, speeds, count,
        } = this.emberData;
        const posAttr = this.emberSystem.geometry.getAttribute('position');
        const lifeAttr = this.emberSystem.geometry.getAttribute('aLife');

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Update life
            lifes[i] -= dt * (0.1 + randoms[i] * 0.1);

            if (lifes[i] <= 0) {
                // Respawn
                this.initEmber(i, positions, lifes, randoms, speeds);
            } else {
                // Update position - rise with some turbulence
                const turbX = Math.sin(this.time * 2 + i * 0.1) * 5;
                const turbZ = Math.cos(this.time * 1.5 + i * 0.15) * 5;

                positions[i3] += turbX * dt;
                positions[i3 + 1] += speeds[i] * (1 + this.intensity * 0.5) * dt;
                positions[i3 + 2] += turbZ * dt;
            }
        }

        posAttr.array = positions;
        posAttr.needsUpdate = true;
        lifeAttr.array = lifes;
        lifeAttr.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ash Particle System
    // ─────────────────────────────────────────────────────────────────────────
    createAshSystem() {
        const count = this.qualityPreset.ashCount;

        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 2000;
            positions[i * 3 + 1] = Math.random() * 500;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 2000;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x333333,
            size: 3,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.ashSystem = new THREE.Points(geometry, material);
        this.scene.add(this.ashSystem);

        this.ashPositions = positions;
    }

    updateAsh(dt) {
        if (!this.ashSystem || !this.ashPositions) return;

        const positions = this.ashPositions;
        const posAttr = this.ashSystem.geometry.getAttribute('position');

        for (let i = 0; i < positions.length / 3; i++) {
            const i3 = i * 3;

            // Slow fall
            positions[i3 + 1] -= 5 * dt;

            // Drift
            positions[i3] += Math.sin(this.time + i) * 0.5;
            positions[i3 + 2] += Math.cos(this.time * 0.7 + i) * 0.5;

            // Respawn at top if fallen
            if (positions[i3 + 1] < -10) {
                positions[i3 + 1] = 500;
            }
        }

        posAttr.array = positions;
        posAttr.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Volumetric Smoke Plume
    // ─────────────────────────────────────────────────────────────────────────
    createSmokePlume() {
        if (!this.qualityPreset.enableSmokePlume) return;

        const segments = this.qualityPreset.smokePlumeSegments;
        const plumeHeight = 800;
        const baseRadius = 80;

        // Create a cylinder for the smoke plume
        const geometry = new THREE.CylinderGeometry(
            baseRadius * 3, // top radius (wider)
            baseRadius, // bottom radius
            plumeHeight,
            segments,
            segments,
            true, // open ended
        );

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uLavaGlowColor: { value: new THREE.Color(1.0, 0.4, 0.1) },
                uSmokeColor: { value: new THREE.Color(0.08, 0.05, 0.03) },
            },
            vertexShader: SMOKE_PLUME_VERTEX_SHADER,
            fragmentShader: SMOKE_PLUME_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending,
        });

        this.smokePlume = new THREE.Mesh(geometry, material);
        this.smokePlume.position.set(0, 155 + plumeHeight / 2, 0); // Position above crater
        this.smokePlume.frustumCulled = false;
        this.scene.add(this.smokePlume);

        console.log('[Pyrestorm] Smoke plume created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lava Bubbles Overlay
    // ─────────────────────────────────────────────────────────────────────────
    createLavaBubbles() {
        if (!this.qualityPreset.enableLavaBubbles) return;

        const segments = this.qualityPreset.lavaDetail;
        // Slightly smaller than lava plane, positioned just above
        const geometry = new THREE.CircleGeometry(210, segments);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uCoreColor: { value: new THREE.Color(1.0, 0.5, 0.1) },
            },
            vertexShader: LAVA_BUBBLES_VERTEX_SHADER,
            fragmentShader: LAVA_BUBBLES_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.lavaBubbles = new THREE.Mesh(geometry, material);
        this.lavaBubbles.position.y = 156; // Just above lava surface
        this.lavaBubbles.frustumCulled = false;
        this.scene.add(this.lavaBubbles);

        console.log('[Pyrestorm] Lava bubbles created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // God Rays / Volumetric Light Shafts
    // ─────────────────────────────────────────────────────────────────────────
    createGodRays() {
        if (!this.qualityPreset.enableGodRays) return;

        const segments = this.qualityPreset.godRaySegments;
        const rayHeight = 500;
        const baseRadius = 200;

        // Create an inverted cone for the rays (wider at top)
        const geometry = new THREE.ConeGeometry(
            baseRadius * 2, // base radius
            rayHeight,
            segments,
            1,
            true, // open ended
        );

        // Flip it so the wide part is at the top
        geometry.rotateX(Math.PI);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uRayColor: { value: new THREE.Color(1.0, 0.5, 0.2) },
                uRayDensity: { value: 12.0 }, // Number of ray segments
            },
            vertexShader: GOD_RAYS_VERTEX_SHADER,
            fragmentShader: GOD_RAYS_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        this.godRays = new THREE.Mesh(geometry, material);
        this.godRays.position.set(0, 155 + rayHeight / 2, 0); // Position above crater
        this.godRays.frustumCulled = false;
        this.scene.add(this.godRays);

        console.log('[Pyrestorm] God rays created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Epic Background: Pyroclastic Storm Clouds
    // Roiling storm clouds with internal lightning and lava glow
    // ─────────────────────────────────────────────────────────────────────────
    createStormClouds() {
        if (!this.qualityPreset.enableStormClouds) return;

        // Create a large dome for the storm clouds
        const geometry = new THREE.SphereGeometry(12000, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 0 },
                uLightningFlash: { value: 0 },
                uGlowColor: { value: new THREE.Color(1.0, 0.3, 0.05) }, // Lava glow
                uCloudColor: { value: new THREE.Color(0.15, 0.05, 0.03) }, // Dark smoke
            },
            vertexShader: STORM_CLOUDS_VERTEX_SHADER,
            fragmentShader: STORM_CLOUDS_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.NormalBlending,
        });

        this.stormClouds = new THREE.Mesh(geometry, material);
        this.stormClouds.position.y = 500; // Elevated above the scene
        this.stormClouds.frustumCulled = false;
        this.scene.add(this.stormClouds);

        console.log('[Pyrestorm] 🌩️ Storm clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Epic Background: Infernal Aurora (Fire Ribbons)
    // Flowing ribbons of fire dancing across the sky
    // ─────────────────────────────────────────────────────────────────────────
    createInfernalAurora() {
        if (!this.qualityPreset.enableInfernalAurora) return;

        const ribbonCount = this.qualityPreset.auroraRibbonCount;

        for (let i = 0; i < ribbonCount; i++) {
            // Create a wide, thin plane for each ribbon
            const width = 15000;
            const height = 400 + Math.random() * 200;
            const segments = 64;

            const geometry = new THREE.PlaneGeometry(width, height, segments, 4);

            // Random angle for each ribbon
            const angle = (i / ribbonCount) * Math.PI * 0.6 - Math.PI * 0.3;

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: i * 1.5 }, // Phase offset for variety
                    uIntensity: { value: 0 },
                    uColor1: { value: new THREE.Color(0.6, 0.05, 0.02) }, // Deep red
                    uColor2: { value: new THREE.Color(1.0, 0.3, 0.0) }, // Orange
                    uColor3: { value: new THREE.Color(1.0, 0.7, 0.2) }, // Gold
                },
                vertexShader: INFERNAL_AURORA_VERTEX_SHADER,
                fragmentShader: INFERNAL_AURORA_FRAGMENT_SHADER,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });

            const aurora = new THREE.Mesh(geometry, material);

            // Position high in the sky with varying heights
            const baseHeight = 2500 + i * 300 + Math.random() * 200;
            aurora.position.set(0, baseHeight, -3000 - i * 500);
            aurora.rotation.x = -0.3 - Math.random() * 0.2; // Tilt slightly
            aurora.rotation.y = angle;
            aurora.frustumCulled = false;

            this.scene.add(aurora);
            this.infernalAuroras.push(aurora);
        }

        console.log(`[Pyrestorm] 🔥 ${ribbonCount} infernal aurora ribbons created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Epic Background: Distant Erupting Volcanos
    // Secondary volcanos on the horizon with periodic eruptions
    // ─────────────────────────────────────────────────────────────────────────
    createDistantVolcanos() {
        if (!this.qualityPreset.enableDistantVolcanos) return;

        const volcanoCount = this.qualityPreset.distantVolcanoCount;
        const horizonDistance = 8000;

        for (let i = 0; i < volcanoCount; i++) {
            // Distribute around the horizon
            const angle = (i / volcanoCount) * Math.PI * 1.5 - Math.PI * 0.75; // 270 degrees arc
            const distance = horizonDistance + Math.random() * 2000;

            const x = Math.sin(angle) * distance;
            const z = Math.cos(angle) * distance;

            // Create volcano silhouette using a cone
            const baseWidth = 800 + Math.random() * 600;
            const peakHeight = 600 + Math.random() * 800;

            const geometry = new THREE.ConeGeometry(
                baseWidth,
                peakHeight,
                16,
                8,
                true, // open ended
            );

            // Add some irregularity to the volcano shape
            const positions = geometry.attributes.position.array;
            for (let j = 0; j < positions.length; j += 3) {
                const py = positions[j + 1];
                if (py > -peakHeight * 0.4) { // Not at the very bottom
                    const noise = (Math.random() - 0.5) * baseWidth * 0.15;
                    positions[j] += noise;
                    positions[j + 2] += noise * 0.5;
                }
            }
            geometry.computeVertexNormals();

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: i * 2.0 }, // Offset for variety
                    uIntensity: { value: 0 },
                    uEruptionPhase: { value: 0.3 + Math.random() * 0.7 }, // Initial eruption state
                    uSilhouetteColor: { value: new THREE.Color(0.03, 0.01, 0.01) }, // Dark silhouette
                    uLavaColor: { value: new THREE.Color(1.0, 0.3, 0.0) }, // Flowing lava
                    uGlowColor: { value: new THREE.Color(1.0, 0.5, 0.1) }, // Crater glow
                },
                vertexShader: DISTANT_VOLCANO_VERTEX_SHADER,
                fragmentShader: DISTANT_VOLCANO_FRAGMENT_SHADER,
                transparent: true,
                side: THREE.DoubleSide,
            });

            const volcano = new THREE.Mesh(geometry, material);
            volcano.position.set(x, -100, z); // Positioned at horizon
            volcano.frustumCulled = false;

            this.scene.add(volcano);
            this.distantVolcanos.push(volcano);

            // Initialize eruption phase with different timings
            this.eruptionPhases.push({
                phase: Math.random(),
                speed: 0.2 + Math.random() * 0.3,
                active: Math.random() > 0.3, // 70% chance of active eruption
            });
        }

        console.log(`[Pyrestorm] 🌋 ${volcanoCount} distant volcanos created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────
    setupPostProcessing() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);

        // Render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom
        if (this.qualityPreset.enableBloom) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.qualityPreset.bloomStrength,
                this.qualityPreset.bloomRadius,
                this.qualityPreset.bloomThreshold,
            );
            this.composer.addPass(this.bloomPass);
        }

        // Heat distortion
        if (this.qualityPreset.enableHeatDistortion) {
            this.heatPass = new ShaderPass(HEAT_DISTORTION_SHADER);
            this.composer.addPass(this.heatPass);
        }

        // Vignette
        const vignettePass = new ShaderPass(VIGNETTE_SHADER);
        vignettePass.renderToScreen = true;
        this.composer.addPass(vignettePass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────
    setupEventListeners() {
        // Line clear
        const onLineClear = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            const count = data.lines || data.count || 1;

            this.intensity = Math.min(1, this.intensity + 0.15 * count);
            this.shake += count * 3;
            this.surgeIntensity = Math.min(2, this.surgeIntensity + count * 0.3);

            // Trigger explosion instead of geyser for massive effect
            this.triggerVolcanicExplosion(Math.min(3, count * 0.5));
        });
        this.eventUnsubscribers.push(onLineClear);

        // Combo
        const onCombo = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            const count = data.combo || data.count || 0;
            this.comboCount = count;

            if (count > 0) {
                this.intensity = Math.min(1, this.intensity + 0.1 * count);
                this.shake += count * 2;

                // Trigger massive eruption
                this.triggerVolcanicExplosion(Math.min(5, count * 0.8));

                // Lightning on high combos
                if (count > 2) {
                    this.triggerLightning(count);
                }
            }
        });
        this.eventUnsubscribers.push(onCombo);

        // Piece Lock - subtle lava pulse across the world
        const onPieceLock = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (!this.isActive) return;
            // Trigger a subtle lava pulse
            this.lavaPulse = Math.min(1, this.lavaPulse + 0.4);
        });
        this.eventUnsubscribers.push(onPieceLock);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effects
    // ─────────────────────────────────────────────────────────────────────────
    spawnGeyser(strength) {
        if (this.geysers.length >= this.maxGeysers) return;

        const x = (Math.random() - 0.5) * 500;
        const z = (Math.random() - 0.5) * 500;

        // Simple visual: spawn extra embers at geyser location
        if (this.emberData) {
            const { positions, lifes, speeds } = this.emberData;
            const burstCount = strength * 20;

            for (let i = 0; i < Math.min(burstCount, 100); i++) {
                const idx = Math.floor(Math.random() * this.emberData.count);
                const i3 = idx * 3;

                positions[i3] = x + (Math.random() - 0.5) * 50;
                positions[i3 + 1] = 0;
                positions[i3 + 2] = z + (Math.random() - 0.5) * 50;

                lifes[idx] = 1.0;
                speeds[idx] = 80 + Math.random() * 60;
            }
        }
    }

    triggerLightning(combo) {
        this.lightningFlash = 0.5 + Math.min(0.4, combo * 0.08);
        this.shake += 5 + combo;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────
    startAnimation() {
        this.isActive = true;
        this.clock.start();
        this.animate();
    }

    animate = () => {
        if (!this.isActive) return;

        const dt = Math.min(this.clock.getDelta(), 0.1);
        this.time += dt;

        this.update(dt);
        this.render();

        this.animationFrameId = requestAnimationFrame(this.animate);
        this.registerAnimation(this.animationFrameId);
    };

    update(dt) {
        // Decay effects
        this.intensity = Math.max(0, this.intensity - dt * 0.1);
        this.shake = Math.max(0, this.shake - dt * 15);
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 8);
        this.surgeIntensity = Math.max(0, this.surgeIntensity - dt * 0.5);
        this.lavaPulse = Math.max(0, this.lavaPulse - dt * 2.5); // Fast decay for snappy pulse

        // Cinematic Camera Hover (Randomized Orbit)
        // Oscillate with wider sweeps to see around the game board
        const angleParam = this.time * 0.12;
        const orbitAngle = Math.sin(angleParam) * 0.6 // Wide sweep (+/- 34 deg)
            + Math.cos(angleParam * 0.5) * 0.2; // Natural secondary drift

        const currentRadius = 1100
            + Math.sin(this.time * 0.15) * 80
            + Math.cos(this.time * 0.09) * 50;

        const currentHeight = 380
            + Math.sin(this.time * 0.11) * 60
            + Math.cos(this.time * 0.2) * 40;

        this.camera.position.x = Math.sin(orbitAngle) * currentRadius;
        this.camera.position.z = Math.cos(orbitAngle) * currentRadius;
        this.camera.position.y = currentHeight;

        // Screen shake interaction
        if (this.shake > 0) {
            this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
            this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
            this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.6;
        }

        // DYNAMIC OFF-CENTER FRAMING
        // Slowly drift the look-at point horizontally so the volcano
        // spends more time peeking from the left/right of the game board.
        const focusDrift = Math.sin(this.time * 0.15) * 200;
        const targetFocus = this.cameraLookAt.clone();
        targetFocus.x += focusDrift;

        this.camera.lookAt(targetFocus);

        // Update uniforms
        if (this.lavaPlane) {
            const mat = this.lavaPlane.material;
            mat.uniforms.uTime.value = this.time;
            mat.uniforms.uIntensity.value = this.intensity + this.surgeIntensity * 0.5;
            mat.uniforms.uCrustThreshold.value = 0.55 - this.surgeIntensity * 0.1;
            mat.uniforms.uLavaPulse.value = this.lavaPulse;
        }

        if (this.skybox) {
            this.skybox.material.uniforms.uTime.value = this.time;
            this.skybox.material.uniforms.uIntensity.value = this.intensity;
        }

        this.mountains.forEach((m) => {
            if (m.material.uniforms) {
                m.material.uniforms.uTime.value = this.time;
                m.material.uniforms.uIntensity.value = this.intensity;
                if (m.material.uniforms.uLavaPulse) {
                    m.material.uniforms.uLavaPulse.value = this.lavaPulse;
                }
            }
        });

        if (this.groundPlane) {
            this.groundPlane.material.uniforms.uTime.value = this.time;
            this.groundPlane.material.uniforms.uIntensity.value = this.intensity;
            this.groundPlane.material.uniforms.uLavaPulse.value = this.lavaPulse;
        }

        if (this.volcanoTerrain) {
            this.volcanoTerrain.material.uniforms.uTime.value = this.time;
            this.volcanoTerrain.material.uniforms.uIntensity.value = this.intensity;
            this.volcanoTerrain.material.uniforms.uLavaPulse.value = this.lavaPulse;
        }

        if (this.emberSystem) {
            this.emberSystem.material.uniforms.uTime.value = this.time;
            this.emberSystem.material.uniforms.uIntensity.value = this.intensity;
        }

        // Update new visual effects
        if (this.smokePlume) {
            this.smokePlume.material.uniforms.uTime.value = this.time;
            this.smokePlume.material.uniforms.uIntensity.value = this.intensity + this.surgeIntensity * 0.3;
        }

        if (this.lavaBubbles) {
            this.lavaBubbles.material.uniforms.uTime.value = this.time;
            this.lavaBubbles.material.uniforms.uIntensity.value = this.intensity + this.surgeIntensity * 0.5;
        }

        if (this.godRays) {
            this.godRays.material.uniforms.uTime.value = this.time;
            this.godRays.material.uniforms.uIntensity.value = this.intensity + this.surgeIntensity * 0.4;
        }

        // Update Epic Background Effects 🔥

        // Storm Clouds - sync lightning flash
        if (this.stormClouds) {
            this.stormClouds.material.uniforms.uTime.value = this.time;
            this.stormClouds.material.uniforms.uIntensity.value = this.intensity;
            this.stormClouds.material.uniforms.uLightningFlash.value = this.lightningFlash;
        }

        // Infernal Aurora - flowing fire ribbons
        this.infernalAuroras.forEach((aurora, index) => {
            aurora.material.uniforms.uTime.value = this.time + index * 1.5;
            aurora.material.uniforms.uIntensity.value = this.intensity;
        });

        // Distant Volcanos - animated eruptions
        this.distantVolcanos.forEach((volcano, index) => {
            volcano.material.uniforms.uTime.value = this.time;
            volcano.material.uniforms.uIntensity.value = this.intensity;

            // Animate eruption phases
            if (this.eruptionPhases[index]) {
                const eruption = this.eruptionPhases[index];

                // Pulsing eruption cycle
                eruption.phase += dt * eruption.speed;
                if (eruption.phase > 1) {
                    eruption.phase = 0;
                    eruption.active = Math.random() > 0.2; // 80% chance to stay active
                    eruption.speed = 0.15 + Math.random() * 0.35;
                }

                // Create pulsing eruption effect
                const eruptionValue = eruption.active
                    ? 0.5 + Math.sin(eruption.phase * Math.PI * 2) * 0.5
                    : 0.1;

                volcano.material.uniforms.uEruptionPhase.value = eruptionValue;
            }
        });

        // Horizon Ring - update time for potential animation
        if (this.horizonRing) {
            this.horizonRing.material.uniforms.uTime.value = this.time;
        }

        // Update particles
        this.updateEmbers(dt);
        this.updateExplosions(dt);
        this.updateAsh(dt);

        // Post-processing uniforms
        if (this.heatPass) {
            this.heatPass.uniforms.uTime.value = this.time;
            this.heatPass.uniforms.uIntensity.value = this.intensity;
        }

        // Lightning flash
        this.flashLight.intensity = this.lightningFlash * 5;

        // Lava light pulsing
        const pulse = Math.sin(this.time * 2) * 0.3 + 1.0;
        this.lavaLight.intensity = 1.5 * pulse * (1 + this.intensity * 0.5);
    }

    render() {
        if (this.composer) {
            this.composer.render();
        } else if (this.renderer) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────
    stop() {
        this.isActive = false;

        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];

        // Remove resize listener
        window.removeEventListener('resize', this.handleResize);

        // Dispose Three.js resources
        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((m) => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        if (this.composer) {
            this.composer.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
        }

        super.stop();
        console.log('[Pyrestorm] 🔥 Theme stopped');
    }
}
