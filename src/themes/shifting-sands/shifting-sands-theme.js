/**
 * Shifting Sands Theme - ARRAKIS (Three.js 3D)
 * Inspired by Dune - Harsh desert planet with twin moons, spice particles, and sand smoke
 */

// WebGPU renderer with automatic WebGL2 fallback
import * as THREE from 'three/webgpu';
// NOTE: EffectComposer removed - post-processing will be migrated to TSL in Phase 6
// import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
// import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
// import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BaseTheme } from '../base-theme.js';
import { SHIFTING_SANDS_TETROMINOS } from './shifting-sands-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { WormTrailCompute, SpiceParticleCompute, SandSmokeCompute } from './shifting-sands-compute.js';
import {
    createDuneMaterial,
    createSpiceMaterial,
    createSkyMaterial,
    createStarsMaterial,
    createSandSmokeMaterial,
    createBlueGlowMaterial,
} from './shifting-sands-materials.js';
import { ShiftingSandsPost } from './shifting-sands-post.js';

// --- Perlin Noise Implementation ---
class PerlinNoise {
    constructor(seed = Math.random()) {
        this.perm = new Array(512);
        this.gradP = new Array(512);
        const p = new Array(256);
        for (let i = 0; i < 256; i++) p[i] = Math.floor(seed * 10000 + i) % 256;
        this.gradients = [
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
        ];
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
            this.gradP[i] = this.gradients[this.perm[i] % 12];
        }
    }

    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

    lerp(a, b, t) { return (1 - t) * a + t * b; }

    grad(hash, x, y, z) {
        const g = this.gradP[hash];
        return g[0] * x + g[1] * y + g[2] * z;
    }

    noise(x, y, z = 0) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        const u = this.fade(x); const v = this.fade(y); const
            w = this.fade(z);
        const A = this.perm[X] + Y; const AA = this.perm[A] + Z; const
            AB = this.perm[A + 1] + Z;
        const B = this.perm[X + 1] + Y; const BA = this.perm[B] + Z; const
            BB = this.perm[B + 1] + Z;
        return this.lerp(
            this.lerp(
                this.lerp(this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z), u),
                this.lerp(this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z), u),
                v,
            ),
            this.lerp(
                this.lerp(this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1), u),
                this.lerp(this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1), u),
                v,
            ),
            w,
        );
    }
}

export default class ShiftingSandsTheme extends BaseTheme {
    constructor() {
        super('shifting-sands');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // WebGPU/WebGL backend tracking
        this.isWebGPU = false;
        this.isWebGL = false;

        // GPU Compute shaders (WebGPU only)
        this.wormTrailCompute = null;

        // Worm position (updated by compute shader or CPU fallback)
        this.wormPosition = { x: 0, y: 0, z: 0 };

        // TSL Materials (Phase 3+)
        this.duneMaterial = null;
        this.spiceMaterial = null;
        this.skyMaterial = null;
        this.starsMaterial = null;
        this.sandSmokeMaterial = null;
        this.blueGlowMaterial = null;

        // GPU Compute for particles (Phase 4)
        this.spiceCompute = null;
        this.spicePositionBuffer = null;
        this.sandSmokeCompute = null;
        this.sandSmokePositionBuffer = null; // Reused for positions
        this.sandSmokeLifeBuffer = null; // New: Life (opacity)

        // Scene elements
        this.sky = null;
        this.stars = null;
        this.moonSprites = []; // Twin moons of Arrakis
        this.dunes = null;
        this.distantMountains = null;
        this.spiceParticles = null;
        this.dustHaze = null;
        this.sandSmoke = null; // Volumetric sand smoke

        // DUNE-specific elements
        this.blueGlowOverlay = null; // Blue-within-blue glow effect

        // Post-processing
        this.composer = null;
        this.heatShimmerPass = null;
        this.postProcessing = null;

        // Effect elements
        this.shockwaves = [];
        this.spiceBlows = [];
        this.circleTexture = null; // Reusable circular particle texture

        // Camera shake
        this.cameraShake = { intensity: 0, duration: 0 };
        this.baseCameraPos = new THREE.Vector3(0, 65, 180);

        // Animation uniforms
        this.uniforms = {
            time: { value: 0 },
            windStrength: { value: 0.5 },
            moonGlowIntensity: { value: 1.0 },
            spiceIntensity: { value: 1.0 },
            dustDensity: { value: 0.3 },
            heatShimmerStrength: { value: 0.006 }, // Boosted from 0.003
            blueGlowIntensity: { value: 0 }, // Blue-within-blue glow
            wormHeatIntensity: { value: 0 }, // Underground heat effect
        };

        // Art-direction knobs for final smoke tuning (can be edited at runtime):
        // window.shiftingSandsSmokeArtDirection = { density: 1.0, lead: 1.0 }
        const sharedSmokeArt = typeof window !== 'undefined'
            ? window.shiftingSandsSmokeArtDirection
            : null;
        this.smokeArtDirection = (sharedSmokeArt && typeof sharedSmokeArt === 'object')
            ? sharedSmokeArt
            : { density: 1.0, lead: 1.62 };
        if (typeof window !== 'undefined') {
            window.shiftingSandsSmokeArtDirection = this.smokeArtDirection;
        }

        // Procedural Generation Config - Larger, more dramatic Arrakis dunes
        this.terrainConfig = {
            noiseScale: {
                dunes: 0.003, // Larger wavelength for massive dunes
                secondary: 0.012,
                detail: 0.08,
            },
            heightScale: {
                dunes: 45, // Taller dunes
                secondary: 15,
                detail: 3,
            },
            duneDirection: Math.PI * 0.2, // Prevailing wind direction
        };

        this.noiseGenerator = new PerlinNoise(Math.random());

        this.targetWindStrength = 0.5;

        // ARRAKIS COLOR PALETTE - Dusk desert tones
        this.palette = {
            // Sky - harsh orange/amber sunset tones
            skyTop: new THREE.Color(0x1c0504), // Deep red-brown (richer)
            skyMid: new THREE.Color(0x4a0f09), // Saturated red mid
            skyBottom: new THREE.Color(0x6b1b0e), // Warmer terracotta
            skyHorizon: new THREE.Color(0xa13a1f), // Red-orange haze

            // Sand - evening Arrakis tones with stronger shadow separation
            sandA: new THREE.Color(0x22140b), // Deep umber shadow
            sandB: new THREE.Color(0x8d582b), // Burnt dune midtone
            sandC: new THREE.Color(0xbe8348), // Sunset-lit crest highlight

            // Sand Smoke
            sandSmoke: new THREE.Color(0x9f6f3b),

            // Twin Moons
            moonPrimary: new THREE.Color(0xffeedd), // Warm white (primary moon)
            moonSecondary: new THREE.Color(0xccbbaa), // Slightly dimmer (secondary)
            moonGlow: new THREE.Color(0xffccaa),
            moonHalo: new THREE.Color(0xffaa77),

            // Spice
            spiceCore: new THREE.Color(0xff6600), // Bright orange
            spiceGlow: new THREE.Color(0xff9933), // Amber
            spiceParticle: new THREE.Color(0xffaa44),

            // Distant Mountains
            rockDark: new THREE.Color(0x2d1a10),
            rockMid: new THREE.Color(0x5a4020),

            // Atmosphere
            fog: new THREE.Color(0x34160f), // Deeper red-brown fog
            haze: new THREE.Color(0x734220), // Dimmer evening haze
            dustStorm: new THREE.Color(0x9e7644), // Dusk storm color
        };

        // Quality presets - Arrakis elements (OPTIMIZED particle counts)
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                starCount: 300,
                duneRes: 64,
                spiceParticleCount: 400,
                dustParticleCount: 150,
                sandSmokeCount: 0,
                enableHeatShimmer: false,
                enableComboEffects: false,
            },
            Low: {
                starCount: 500,
                duneRes: 96,
                spiceParticleCount: 800,
                dustParticleCount: 300,
                sandSmokeCount: 80,
                enableHeatShimmer: false,
                enableComboEffects: true,
            },
            Medium: {
                starCount: 800,
                duneRes: 128,
                spiceParticleCount: 1500,
                dustParticleCount: 450,
                sandSmokeCount: 140,
                enableHeatShimmer: true,
                enableComboEffects: true,
            },
            High: {
                starCount: 1200,
                duneRes: 196,
                spiceParticleCount: 2000,
                dustParticleCount: 600,
                sandSmokeCount: 220,
                enableHeatShimmer: true,
                enableComboEffects: true,
            },
            Ultra: {
                starCount: 2000,
                duneRes: 256,
                spiceParticleCount: 3000,
                dustParticleCount: 800,
                sandSmokeCount: 320,
                enableHeatShimmer: true,
                enableComboEffects: true,
            },
            Extreme: {
                starCount: 3000,
                duneRes: 350,
                spiceParticleCount: 5000,
                dustParticleCount: 1000,
                sandSmokeCount: 420,
                enableHeatShimmer: true,
                enableComboEffects: true,
            },
        };

        this.activePreset = this.qualityPresets.High;
        this.qualityChangeHandler = null;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    getSmokeDensityKnob() {
        const raw = Number(this.smokeArtDirection?.density);
        if (!Number.isFinite(raw)) return 1.0;
        return THREE.MathUtils.clamp(raw, 0.4, 1.8);
    }

    getSmokeLeadKnob() {
        const raw = Number(this.smokeArtDirection?.lead);
        if (!Number.isFinite(raw)) return 1.0;
        return THREE.MathUtils.clamp(raw, 0.5, 1.8);
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        if (this.isActive && this.scene) this.rebuildQualityDependentElements();
    }

    rebuildQualityDependentElements() {
        // Rebuild stars
        if (this.stars) {
            this.mainGroup.remove(this.stars);
            this.stars.geometry.dispose();
            this.stars.material.dispose();
        }
        this.starsMaterial = null;
        this.createStars();

        // Rebuild spice particles (Phase 4: includes compute cleanup)
        if (this.spiceParticles) {
            this.scene.remove(this.spiceParticles);
            this.spiceParticles.geometry.dispose();
            this.spiceParticles.material.dispose();
        }
        if (this.spiceCompute) {
            this.spiceCompute.dispose();
            this.spiceCompute = null;
        }
        if (this.spiceMaterial) {
            this.spiceMaterial = null;
        }
        this.spicePositionBuffer = null;
        this.createSpiceParticles();

        // Rebuild dust haze
        if (this.dustHaze) {
            this.scene.remove(this.dustHaze);
            this.dustHaze.geometry.dispose();
            this.dustHaze.material.dispose();
        }
        this.createDustHaze();

        // Rebuild sand smoke
        if (this.sandSmoke) {
            this.scene.remove(this.sandSmoke);
            this.sandSmoke.geometry.dispose();
            this.sandSmoke.material.dispose();
        }
        if (this.sandSmokeCompute) {
            this.sandSmokeCompute.dispose();
            this.sandSmokeCompute = null;
        }
        this.sandSmokeMaterial = null;
        this.sandSmokePositionBuffer = null;
        this.sandSmokeLifeBuffer = null;
        this.createSandSmoke();

        // Rebuild dunes if resolution changed significantly
        if (this.dunes) {
            this.scene.remove(this.dunes);
            this.dunes.geometry.dispose();
            this.dunes.material.dispose();
            this.createDunes();
        }

        // Rebuild post-processing (TSL)
        this.setupPostProcessing();
    }

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (newQuality && newQuality !== this.currentQuality) this.applyQualityPreset(newQuality);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        const container = document.getElementById('shifting-sands-theme');
        if (!container) return;
        container.innerHTML = '';

        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // Create WebGPU renderer with automatic WebGL2 fallback
        this.renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
            // forceWebGL: true, // QA: uncomment to force WebGL2 backend for testing fallback
        });

        try {
            // WebGPURenderer handles WebGPU -> WebGL2 fallback internally
            await this.renderer.init();
        } catch (error) {
            console.error('[ShiftingSands] Renderer init failed (no fallback available):', error);
            return;
        }

        // Track which backend is active
        this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = this.renderer.backend?.isWebGLBackend === true;
        // Debug: console.log(`[ShiftingSands] Backend: ${this.isWebGPU ? 'WebGPU' : 'WebGL2'}`);

        // Initialize GPU compute shaders (WebGPU only)
        this.wormTrailCompute = new WormTrailCompute();
        if (this.isWebGPU) {
            this.wormTrailCompute.createComputeNode();
        }

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setClearColor(this.palette.skyTop);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.86;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(this.palette.fog.getHex(), 0.0012);

        // Camera
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 5, 4000);
        this.camera.position.set(0, 65, 180);
        this.camera.lookAt(0, 0, 0);

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create Arrakis Elements
        this.createSky();
        this.createStars();
        this.createTwinMoons(); // Twin moons of Arrakis
        this.createDistantMountains(); // New Distant Dunes Horizon
        this.createDunes(); // Vast procedural desert
        this.createSpiceParticles(); // The spice must flow
        this.createDustHaze(); // Atmospheric dust
        this.createSandSmoke(); // Volumetric sand smoke

        // DUNE-specific effects
        this.createBlueGlowOverlay(); // Blue-within-blue effect

        this.setupLighting();
        // TSL-based post-processing (Phase 6)
        this.setupPostProcessing();

        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.clock.start();
        this.animate();
    }

    createSky() {
        const skyGeometry = new THREE.SphereGeometry(600, 32, 32);
        this.skyMaterial = createSkyMaterial({
            topColor: this.palette.skyTop,
            midColor: this.palette.skyMid,
            bottomColor: this.palette.skyBottom,
            horizonColor: this.palette.skyHorizon,
            moonPosition: new THREE.Vector3(100, 80, -50),
            moonColor: this.palette.moonGlow,
            moonGlowIntensity: this.uniforms.moonGlowIntensity.value,
        });
        this.sky = new THREE.Mesh(skyGeometry, this.skyMaterial.material);
        this.scene.add(this.sky);
    }

    createStars() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.8);
            const radius = 400 + Math.random() * 50;
            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.cos(phi);
            positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
            sizes[i] = 0.8 + Math.random() * 1.5;
            phases[i] = Math.random();
            const col = new THREE.Color().setHSL(Math.random() * 0.2 + 0.1, 0.8, 0.9);
            colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        this.starsMaterial = createStarsMaterial();
        this.stars = new THREE.Points(geometry, this.starsMaterial.material);
        this.mainGroup.add(this.stars);
    }

    createTwinMoons() {
        // Arrakis has two moons - create both with glow layers
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, 'rgba(255,255,240,1)');
        g.addColorStop(0.15, 'rgba(255,230,200,0.9)');
        g.addColorStop(0.4, 'rgba(255,200,150,0.4)');
        g.addColorStop(0.7, 'rgba(255,180,100,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);
        const moonTex = new THREE.CanvasTexture(canvas);

        const makeMoonSprite = (scale, opacity, color, position) => {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({
                map: moonTex,
                color,
                transparent: true,
                opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            s.scale.set(scale, scale, 1);
            s.position.copy(position);
            this.mainGroup.add(s);
            this.moonSprites.push(s);
            return s;
        };

        // Primary moon (larger, upper-left)
        const moon1Pos = new THREE.Vector3(-80, 70, -150);
        makeMoonSprite(18, 1.0, this.palette.moonPrimary, moon1Pos);
        makeMoonSprite(35, 0.5, this.palette.moonGlow, moon1Pos);
        makeMoonSprite(60, 0.2, this.palette.moonHalo, moon1Pos);

        // Secondary moon (smaller, upper-right)
        const moon2Pos = new THREE.Vector3(100, 55, -180);
        makeMoonSprite(10, 0.9, this.palette.moonSecondary, moon2Pos);
        makeMoonSprite(20, 0.4, this.palette.moonGlow, moon2Pos);
        makeMoonSprite(35, 0.15, this.palette.moonHalo, moon2Pos);
    }

    // --- DISTANT HORIZON: Rolling Dunes/Mountains ---
    createDistantMountains() {
        this.distantMountains = new THREE.Group();

        // Create layered distant dunes resembling mountains
        const layers = [
            {
                z: -250, color: this.palette.rockMid, scaleX: 0.005, scaleY: 40, offsetY: -5,
            },
            {
                z: -350, color: this.palette.rockDark, scaleX: 0.003, scaleY: 60, offsetY: -10,
            },
        ];

        layers.forEach((layer) => {
            const width = 1200;
            const segments = 100;
            const shape = new THREE.Shape();
            shape.moveTo(-width / 2, -50); // Bottom left

            for (let i = 0; i <= segments; i++) {
                const x = (i / segments) * width - width / 2;
                // Soft rolling noise for dunes
                const h = this.noiseGenerator.noise(x * layer.scaleX, layer.z * 0.01) * layer.scaleY;

                // Add secondary detail
                const h2 = this.noiseGenerator.noise(x * layer.scaleX * 4, layer.z * 0.01) * layer.scaleY * 0.2;

                shape.lineTo(x, Math.max(0, h + h2) + layer.offsetY);
            }

            shape.lineTo(width / 2, -50); // Bottom right
            shape.lineTo(-width / 2, -50); // Close shape

            const geometry = new THREE.ShapeGeometry(shape);
            const material = new THREE.MeshBasicMaterial({
                color: layer.color,
                transparent: true,
                opacity: 0.9,
                fog: true,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.z = layer.z;
            this.distantMountains.add(mesh);
        });

        this.scene.add(this.distantMountains);
    }

    // --- PROCEDURAL DUNE GENERATION (Arrakis - No Oasis) ---
    getTerrainHeight(x, z) {
        const dir = this.terrainConfig.duneDirection;
        // Rotate coords for directional dunes (wind-carved appearance)
        const rx = x * Math.cos(dir) + z * Math.sin(dir);
        const rz = -x * Math.sin(dir) + z * Math.cos(dir);

        // 1. Massive primary dunes - sharp ridgelines
        let h = this.noiseGenerator.noise(rx * this.terrainConfig.noiseScale.dunes, rz * this.terrainConfig.noiseScale.dunes);
        h = Math.abs(h * 2 - 1); // Sharp ridges like wind-carved dunes
        h *= this.terrainConfig.heightScale.dunes;

        // 2. Secondary shape - rolling hills
        const h2 = this.noiseGenerator.noise(x * this.terrainConfig.noiseScale.secondary, z * this.terrainConfig.noiseScale.secondary + 100);
        h += h2 * this.terrainConfig.heightScale.secondary;

        // 3. Fine detail - sand ripples
        const h3 = this.noiseGenerator.noise(x * this.terrainConfig.noiseScale.detail, z * this.terrainConfig.noiseScale.detail);
        h += h3 * this.terrainConfig.heightScale.detail;

        // 4. Asymmetric dune profiles (windward vs slip face)
        const windwardFactor = Math.sin(rx * 0.02) * 0.3 + 0.7;
        h *= windwardFactor;

        return h - 20; // Base height offset (lower to show more sky)
    }

    createDunes() {
        const size = 800;
        const res = this.activePreset.duneRes;
        const geometry = new THREE.PlaneGeometry(size, size, res, res);
        geometry.rotateX(-Math.PI / 2);

        const pos = geometry.attributes.position;
        // Apply heightmap
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            pos.setY(i, this.getTerrainHeight(x, z));
        }
        geometry.computeVertexNormals();

        // TSL-based Journey-style Material (Phase 3)
        // Uses node materials that work on both WebGPU and WebGL2 backends
        this.duneMaterial = createDuneMaterial({
            colorA: this.palette.sandA,
            colorB: this.palette.sandB,
            colorC: this.palette.sandC,
            fogColor: this.palette.fog,
            fogNear: 200,
            fogFar: 600,
            moonDirection: new THREE.Vector3(0.8, 0.26, -0.52).normalize(),
            wormTrailCompute: this.wormTrailCompute,
            isWebGPU: this.isWebGPU,
        });

        this.dunes = new THREE.Mesh(geometry, this.duneMaterial.material);
        this.scene.add(this.dunes);
    }

    // --- SPICE PARTICLES - The spice must flow ---
    createSpiceParticles() {
        const count = this.activePreset.spiceParticleCount;

        // Initialize spice compute shader (Phase 4)
        this.spiceCompute = new SpiceParticleCompute(count);
        if (this.isWebGPU) {
            this.spiceCompute.createComputeNode();
        }

        const geometry = new THREE.BufferGeometry();

        // Use position data from compute system (initialized with random positions)
        const positionData = this.spiceCompute.getPositionData();
        const velocityData = this.spiceCompute.getVelocityData();

        // Extract xyz positions from vec4 buffer (x, y, z, life)
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = positionData[i * 4];
            positions[i * 3 + 1] = positionData[i * 4 + 1];
            positions[i * 3 + 2] = positionData[i * 4 + 2];
            phases[i] = velocityData[i * 4 + 3]; // Phase is in velocity.w
        }

        // Generate sizes and colors
        const sizes = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            sizes[i] = 2 + Math.random() * 6;

            // Orange/amber spice colors
            const col = new THREE.Color().lerpColors(
                this.palette.spiceParticle,
                this.palette.spiceCore,
                Math.random(),
            );
            colors[i * 3] = col.r;
            colors[i * 3 + 1] = col.g;
            colors[i * 3 + 2] = col.b;
        }

        // Store position buffer reference for CPU updates
        this.spicePositionBuffer = new THREE.BufferAttribute(positions, 3);
        geometry.setAttribute('position', this.spicePositionBuffer);
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        // TSL-based spice material (Phase 4)
        this.spiceMaterial = createSpiceMaterial({
            isWebGPU: this.isWebGPU,
            spiceCompute: this.spiceCompute,
        });

        this.spiceParticles = new THREE.Points(geometry, this.spiceMaterial.material);
        this.scene.add(this.spiceParticles);
    }

    // --- DUST HAZE - Atmospheric particles ---
    createDustHaze() {
        const count = this.activePreset.dustParticleCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 900;
            positions[i * 3 + 1] = -20 + Math.random() * 100;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 900;
            phases[i] = Math.random();
            sizes[i] = 1 + Math.random() * 3;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            color: this.palette.haze,
            size: 2,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.dustHaze = new THREE.Points(geometry, material);
        this.scene.add(this.dustHaze);
    }

    // --- SAND SMOKE - Volumetric Silky Sand ---
    createSandSmoke() {
        const requestedCount = this.activePreset.sandSmokeCount;
        // Billboard quads have significantly higher fill-rate cost than points.
        // Windows D3D WebGPU is more prone to device hangs when overdraw is extreme.
        const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
        const webgpuSmokeCap = isWindows ? 320 : 480;
        const count = this.isWebGPU
            ? Math.min(requestedCount, webgpuSmokeCap)
            : requestedCount;
        if (count === 0) return;

        // Initialize sand smoke compute (Phase 5)
        this.sandSmokeCompute = new SandSmokeCompute(count, this.wormTrailCompute, {
            leadScale: this.getSmokeLeadKnob(),
        });
        if (this.isWebGPU) {
            this.sandSmokeCompute.createComputeNode();
        }

        this.sandSmokeMaterial = createSandSmokeMaterial({
            color: this.palette.sandSmoke,
            isWebGPU: this.isWebGPU,
            sandSmokeCompute: this.sandSmokeCompute,
            opacity: 0.45,
        });

        if (this.isWebGPU) {
            // WebGPU: Use InstancedMesh for Massive Billboard Clouds
            // Scaled Quads > Points
            const geometry = new THREE.PlaneGeometry(1, 1);

            this.sandSmoke = new THREE.InstancedMesh(geometry, this.sandSmokeMaterial.material, count);
            // InstancedMesh defaults to zero matrices; initialize to identity so vertex positions are valid.
            const identity = new THREE.Matrix4();
            for (let i = 0; i < count; i++) {
                this.sandSmoke.setMatrixAt(i, identity);
            }
            this.sandSmoke.instanceMatrix.needsUpdate = true;
            this.sandSmoke.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            this.sandSmoke.frustumCulled = false;
        } else {
            // WebGL fallback: points with CPU-updated attributes
            const geometry = new THREE.BufferGeometry();
            const stateData = this.sandSmokeCompute.getStateData();

            const positions = new Float32Array(count * 3);
            const lifes = new Float32Array(count);
            const randoms = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const i8 = i * 8;
                positions[i * 3] = stateData[i8];
                positions[i * 3 + 1] = stateData[i8 + 1];
                positions[i * 3 + 2] = stateData[i8 + 2];
                lifes[i] = stateData[i8 + 3];
                randoms[i] = stateData[i8 + 7];
            }

            this.sandSmokePositionBuffer = new THREE.BufferAttribute(positions, 3);
            this.sandSmokeLifeBuffer = new THREE.BufferAttribute(lifes, 1);

            geometry.setAttribute('position', this.sandSmokePositionBuffer);
            geometry.setAttribute('aLife', this.sandSmokeLifeBuffer);
            geometry.setAttribute('aRand', new THREE.BufferAttribute(randoms, 1));

            this.sandSmokeMaterial = createSandSmokeMaterial({
                color: this.palette.sandSmoke,
                isWebGPU: false,
                sandSmokeCompute: null,
                opacity: 0.45,
            });

            this.sandSmoke = new THREE.Points(geometry, this.sandSmokeMaterial.material);
        }
        // CRITICAL: Disable frustum culling because shader moves particles FAR outside original bounds
        this.sandSmoke.frustumCulled = false;

        // Render AFTER opaque terrain to appear in front when close
        this.sandSmoke.renderOrder = 10;
        this.scene.add(this.sandSmoke);
    }

    // --- BLUE GLOW OVERLAY: Blue-within-blue Fremen eyes effect ---
    createBlueGlowOverlay() {
        // Full-screen overlay that pulses blue during events
        const overlayGeometry = new THREE.PlaneGeometry(2, 2);
        this.blueGlowMaterial = createBlueGlowMaterial({
            intensity: this.uniforms.blueGlowIntensity.value,
        });

        this.blueGlowOverlay = new THREE.Mesh(overlayGeometry, this.blueGlowMaterial.material);
        this.blueGlowOverlay.renderOrder = 100; // Render last
        this.blueGlowOverlay.frustumCulled = false;
        this.blueGlowOverlay.position.z = -1;
        if (this.camera) {
            this.camera.add(this.blueGlowOverlay);
            this.scene.add(this.camera);
            this.updateBlueGlowScale();
        } else {
            this.scene.add(this.blueGlowOverlay);
        }
    }

    updateBlueGlowScale() {
        if (!this.camera || !this.blueGlowOverlay) return;
        const distance = 1;
        const height = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * distance;
        const width = height * this.camera.aspect;
        this.blueGlowOverlay.scale.set(width, height, 1);
    }

    // --- POST-PROCESSING: Heat Shimmer ---
    // NOTE: Disabled for Phase 1 WebGPU migration
    // EffectComposer does not work with WebGPURenderer
    // Will be re-implemented in Phase 6 using TSL-based PostProcessing class
    setupPostProcessing() {
        // Dispose previous post-processing
        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }

        // Create post-processing only when needed
        if (!this.activePreset.enableHeatShimmer && !this.isWebGPU) {
            return;
        }

        this.postProcessing = new ShiftingSandsPost(this.renderer, this.scene, this.camera, {
            heatShimmerStrength: this.uniforms.heatShimmerStrength.value,
            bloomStrength: 0.26,
            bloomRadius: 0.24,
            bloomThreshold: 0.34,
            godRaysIntensity: this.isWebGPU ? 0.35 : 0.0, // Phase 9: WebGPU-only enhancement
            moon1: new THREE.Vector2(0.3, 0.8),
            moon2: new THREE.Vector2(0.7, 0.7),
        });

        this.postProcessing.setSize(window.innerWidth, window.innerHeight);
    }

    setupLighting() {
        // Warm amber ambient for Arrakis
        const amb = new THREE.AmbientLight(0x3d2814, 0.5);
        this.scene.add(amb);

        // Primary moon light (warm white)
        const moon1 = new THREE.DirectionalLight(0xffeedd, 0.6);
        moon1.position.set(-80, 70, -150);
        this.scene.add(moon1);

        // Secondary moon light (dimmer)
        const moon2 = new THREE.DirectionalLight(0xccbbaa, 0.3);
        moon2.position.set(100, 55, -180);
        this.scene.add(moon2);

        // Subtle orange rim light from horizon
        const horizonLight = new THREE.HemisphereLight(0xd4a574, 0x3d2814, 0.4);
        this.scene.add(horizonLight);
    }

    animate() {
        // Use setAnimationLoop for WebGPU compatibility
        this.renderer.setAnimationLoop(() => {
            if (!this.isActive) {
                this.renderer.setAnimationLoop(null);
                return;
            }

            const delta = this.clock.getDelta();
            const elapsed = this.clock.getElapsedTime();
            this.uniforms.time.value = elapsed;

            // Smooth Wind
            this.uniforms.windStrength.value += (this.targetWindStrength - this.uniforms.windStrength.value) * 0.02;
            this.targetWindStrength += (0.5 - this.targetWindStrength) * 0.005;

            // Decay spice intensity back to normal
            this.uniforms.spiceIntensity.value += (1.0 - this.uniforms.spiceIntensity.value) * 0.01;
            this.uniforms.dustDensity.value += (0.3 - this.uniforms.dustDensity.value) * 0.02;

            // Decay moon glow back to baseline to avoid sky washout during combos
            const baseMoonGlow = 1.0;
            const maxMoonGlow = 1.6;
            this.uniforms.moonGlowIntensity.value = Math.min(
                maxMoonGlow,
                this.uniforms.moonGlowIntensity.value,
            );
            this.uniforms.moonGlowIntensity.value +=
                (baseMoonGlow - this.uniforms.moonGlowIntensity.value) * 0.02;

            // Decay blue glow and worm heat back to normal
            this.uniforms.blueGlowIntensity.value *= 0.95;
            this.uniforms.wormHeatIntensity.value += (0 - this.uniforms.wormHeatIntensity.value) * 0.02;

            // Boost heat shimmer based on worm activity
            const baseShimmer = 0.006;
            const wormHeatBoost = this.uniforms.wormHeatIntensity.value * 0.015;
            this.uniforms.heatShimmerStrength.value = baseShimmer + wormHeatBoost;

            // Dispatch compute shaders (WebGPU only) or run CPU fallback
            if (this.wormTrailCompute) {
                if (this.isWebGPU && this.wormTrailCompute.computeNode) {
                    // GPU compute path - Worm Trail
                    this.wormTrailCompute.update(elapsed);
                    this.renderer.compute(this.wormTrailCompute.computeNode);
                }
                // Always update CPU state for gameplay/CPU effects
                this.wormTrailCompute.updateCPU(elapsed);
            }

            // Spice particle compute (Phase 4)
            if (this.spiceCompute) {
                const windStrength = this.uniforms.windStrength.value;
                const spiceIntensity = this.uniforms.spiceIntensity.value;

                if (this.isWebGPU && this.spiceCompute.computeNode) {
                    // GPU compute path - Spice Particles
                    this.spiceCompute.update(elapsed, windStrength, spiceIntensity);
                    this.renderer.compute(this.spiceCompute.computeNode);
                } else {
                    // CPU fallback path - update positions on CPU
                    this.spiceCompute.updateCPU(elapsed, windStrength, spiceIntensity);

                    // Sync CPU-updated positions to geometry buffer
                    if (this.spicePositionBuffer && this.spiceCompute.getPositionData()) {
                        const posData = this.spiceCompute.getPositionData();
                        const positions = this.spicePositionBuffer.array;
                        for (let i = 0; i < this.spiceCompute.count; i++) {
                            positions[i * 3] = posData[i * 4];
                            positions[i * 3 + 1] = posData[i * 4 + 1];
                            positions[i * 3 + 2] = posData[i * 4 + 2];
                        }
                        this.spicePositionBuffer.needsUpdate = true;
                    }
                }
            }

            // Sand smoke compute (Phase 5)
            if (this.sandSmokeCompute) {
                const windStrength = this.uniforms.windStrength.value;
                this.sandSmokeCompute.setLeadScale(this.getSmokeLeadKnob());

                if (this.isWebGPU && this.sandSmokeCompute.computeNode) {
                    this.sandSmokeCompute.update(elapsed, windStrength);
                    this.renderer.compute(this.sandSmokeCompute.computeNode);
                } else {
                    this.sandSmokeCompute.updateCPU(elapsed, windStrength);

                    // Sync CPU-updated positions and life to geometry
                    if (this.sandSmokePositionBuffer && this.sandSmokeCompute.getStateData()) {
                        const state = this.sandSmokeCompute.getStateData();
                        const positions = this.sandSmokePositionBuffer.array;
                        const lifes = this.sandSmokeLifeBuffer?.array;

                        for (let i = 0; i < this.sandSmokeCompute.count; i++) {
                            const i8 = i * 8;
                            positions[i * 3] = state[i8];
                            positions[i * 3 + 1] = state[i8 + 1];
                            positions[i * 3 + 2] = state[i8 + 2];
                            if (lifes) lifes[i] = state[i8 + 3];
                        }
                        this.sandSmokePositionBuffer.needsUpdate = true;
                        if (this.sandSmokeLifeBuffer) this.sandSmokeLifeBuffer.needsUpdate = true;
                    }
                }
            }

            // Camera Sway + Shake - Enhanced for cinematic feel
            if (this.camera) {
                // Multi-layered organic motion
                let camX = this.baseCameraPos.x
                    + Math.sin(elapsed * 0.08) * 12 // Slow side-to-side sweep
                    + Math.sin(elapsed * 0.23) * 4; // Faster subtle drift

                let camY = this.baseCameraPos.y
                    + Math.cos(elapsed * 0.05) * 3 // Gentle vertical bob
                    + Math.sin(elapsed * 0.17) * 1.5; // Secondary bob

                let camZ = this.baseCameraPos.z
                    + Math.sin(elapsed * 0.11) * 8 // Slow forward/back drift
                    + Math.cos(elapsed * 0.31) * 3; // Faster subtle pulse

                // Apply camera shake
                if (this.cameraShake.duration > 0) {
                    this.cameraShake.duration -= delta;
                    const shake = this.cameraShake.intensity * (this.cameraShake.duration / 0.5);
                    camX += (Math.random() - 0.5) * shake * 2;
                    camY += (Math.random() - 0.5) * shake * 1.5;
                    camZ += (Math.random() - 0.5) * shake;
                }

                this.camera.position.set(camX, camY, camZ);

                // Subtle look target drift for extra dynamism
                const lookX = Math.sin(elapsed * 0.06) * 5;
                const lookY = Math.cos(elapsed * 0.04) * 2;
                this.camera.lookAt(lookX, lookY, 0);
            }

            // Update twin moons (subtle pulse)
            this.moonSprites.forEach((sprite, i) => {
                const pulse = 1 + Math.sin(elapsed * 0.5 + i * 0.3) * 0.05;
                sprite.material.opacity = sprite.userData?.baseOpacity * pulse || sprite.material.opacity;
            });

            // Update sky/stars materials (Phase 7)
            if (this.skyMaterial?.uniforms?.uMoonGlowIntensity) {
                this.skyMaterial.uniforms.uMoonGlowIntensity.value = this.uniforms.moonGlowIntensity.value;
            }
            if (this.starsMaterial) {
                this.starsMaterial.update(elapsed);
            }

            // Update blue glow overlay (Phase 7)
            if (this.blueGlowMaterial) {
                this.blueGlowMaterial.update(elapsed, this.uniforms.blueGlowIntensity.value);
            }

            // Update DUNE effects (worm tracking)
            this.updateWormEffects(elapsed, delta);

            // Update TSL dune material (Phase 3)
            if (this.duneMaterial) {
                const wormState = this.wormTrailCompute?.getCPUState();
                this.duneMaterial.update(elapsed, wormState, this.isWebGPU ? 1 : 0);
            }

            // Update TSL spice material (Phase 4)
            if (this.spiceMaterial) {
                this.spiceMaterial.update(
                    elapsed,
                    this.uniforms.windStrength.value,
                    this.uniforms.spiceIntensity.value
                );
            }

            if (this.sandSmokeMaterial) {
                const smokeDensity = this.getSmokeDensityKnob();
                const smokeOpacityBase = 0.11 + this.uniforms.dustDensity.value * 0.08;
                const smokeOpacity = THREE.MathUtils.clamp(smokeOpacityBase * smokeDensity, 0.02, 0.32);
                this.sandSmokeMaterial.update(elapsed, smokeOpacity);
            }

            // Update effects
            this.updateShockwaves(delta);
            this.updateSpiceBlows(delta);

            // Render scene with optional post-processing
            if (this.postProcessing) {
                const heatStrength = this.activePreset.enableHeatShimmer
                    ? this.uniforms.heatShimmerStrength.value
                    : 0;
                this.postProcessing.update(elapsed, heatStrength, {
                    godRaysIntensity: this.isWebGPU ? 0.35 : 0.0,
                });
                this.postProcessing.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        });
    }

    onWindowResize() {
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);

            if (this.postProcessing) {
                this.postProcessing.setSize(window.innerWidth, window.innerHeight);
            }

            this.updateBlueGlowScale();
        }
    }

    // --- EVENTS ---
    setupEventListeners() {
        const sub = (evt, fn) => this.eventUnsubscribers.push(eventBus.on(evt, (d) => {
            const s = window.settings;
            if (this.isActive && s?.backgroundComboEffects !== false) fn(d);
        }));

        sub(EVENTS.LINE_CLEAR, (d) => this.onLineClear(d.lineCount));
        sub(EVENTS.COMBO, (d) => this.onCombo(d.comboCount));
        sub(EVENTS.PIECE_LOCK, () => this.onPieceLock());
    }

    // --- DRAMATIC ARRAKIS EVENT REACTIONS ---

    onLineClear(cnt) {
        if (!this.activePreset.enableComboEffects) return;

        // Intense wind surge
        this.targetWindStrength = Math.min(3.0, this.uniforms.windStrength.value + cnt * 0.6);

        // Spice blow burst
        this.createSpiceBlow(cnt);

        // Increase dust density temporarily
        this.uniforms.dustDensity.value = Math.min(1.0, this.uniforms.dustDensity.value + cnt * 0.15);

        // Screen shake
        this.triggerCameraShake(cnt * 0.5, 0.3);

        // Underground worm heat effect
        this.uniforms.wormHeatIntensity.value = Math.min(1.0, this.uniforms.wormHeatIntensity.value + cnt * 0.3);

        // Tetris (4-line clear) - MAXIMUM DRAMA + BLUE GLOW
        if (cnt >= 4) {
            this.triggerDustStorm();
            this.uniforms.moonGlowIntensity.value = Math.min(
                1.6,
                this.uniforms.moonGlowIntensity.value + 0.25,
            );
            this.uniforms.blueGlowIntensity.value = 1.0; // Full blue glow!
        }
    }

    onCombo(cnt) {
        if (!this.activePreset.enableComboEffects) return;

        // Wind intensifies with combo
        if (cnt > 1) this.targetWindStrength += 0.3;

        // Spice glow pulses
        this.uniforms.spiceIntensity.value = Math.min(3.0, 1.0 + cnt * 0.4);

        // Camera rumble (worm activity)
        if (cnt >= 2) {
            this.triggerCameraShake(cnt * 0.3, 0.2);
            this.uniforms.wormHeatIntensity.value += 0.2; // Worm activity!
            // Combo burst - 20x particles + more motion
            this.createSpiceBlow(cnt * 100, { speedScale: 2.4 });
        }

        // Combo 3+ - Blue glow (rings removed)
        if (cnt >= 3) {
            this.uniforms.blueGlowIntensity.value = Math.min(1.0, cnt * 0.25); // Subtle blue
        }
    }

    onPieceLock() {
        // Enhanced lock effect: Spice flash + shake
        this.uniforms.spiceIntensity.value += 0.8;
        this.triggerCameraShake(0.2, 0.15);
    }

    // Trigger camera shake
    triggerCameraShake(intensity, duration) {
        this.cameraShake.intensity = Math.max(this.cameraShake.intensity, intensity);
        this.cameraShake.duration = Math.max(this.cameraShake.duration, duration);
    }

    // --- UPDATE WORM EFFECTS (eruption, spice trail) ---
    updateWormEffects(elapsed, delta) {
        // Get worm position from compute shader (GPU) or CPU fallback
        // The wormTrailCompute now centralizes all worm calculations
        if (!this.wormTrailCompute) return;

        const wormState = this.wormTrailCompute.getCPUState();
        const wormHeadX = wormState.headX;
        const wormHeadZ = wormState.headZ;

        // Get approximate terrain height at worm head
        const wormHeadY = this.getTerrainHeight(wormHeadX, wormHeadZ) + 5;

        // Store worm position for use by other effects (future phases)
        // This data is now shared via the compute buffer for GPU shaders
        // and via getCPUState() for CPU-based effects
        this.wormPosition = { x: wormHeadX, y: wormHeadY, z: wormHeadZ };
    }

    // Dust storm effect
    triggerDustStorm() {
        this.uniforms.dustDensity.value = 1.0;
        this.uniforms.heatShimmerStrength.value = 0.01;
    }

    // Spice blow particle burst
    createSpiceBlow(intensity, options = {}) {
        const speedScale = options.speedScale ?? 1.0;
        const particleCount = 50 * intensity;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        const centerX = (Math.random() - 0.5) * 100;
        const centerZ = (Math.random() - 0.5) * 100;
        const centerY = this.getTerrainHeight(centerX, centerZ) + 5;

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = centerX + (Math.random() - 0.5) * 10;
            positions[i * 3 + 1] = centerY;
            positions[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 10;

            velocities.push({
                x: (Math.random() - 0.5) * 30 * speedScale,
                y: (10 + Math.random() * 20) * speedScale,
                z: (Math.random() - 0.5) * 30 * speedScale,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Create circular particle texture
        if (!this.circleTexture) {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
            gradient.addColorStop(0, 'rgba(255,255,255,1)');
            gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 32, 32);
            this.circleTexture = new THREE.CanvasTexture(canvas);
        }

        const material = new THREE.PointsMaterial({
            map: this.circleTexture,
            color: this.palette.spiceCore,
            size: 4,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const spiceBlow = new THREE.Points(geometry, material);
        spiceBlow.userData = {
            life: 2.0,
            velocities,
            positions,
        };

        this.scene.add(spiceBlow);
        this.spiceBlows.push(spiceBlow);
    }

    // Update shockwaves (sand swirls, dust storms)
    updateShockwaves(dt) {
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const s = this.shockwaves[i];
            s.userData.life -= dt;

            if (s.userData.type === 'dustStorm') {
                s.scale.multiplyScalar(1.08);
                s.material.opacity = s.userData.life * 0.3;
            } else {
                s.scale.multiplyScalar(1.05);
                s.material.opacity = s.userData.life * 0.4;
                s.rotation.z += dt * 3;
            }

            if (s.userData.life <= 0) {
                this.scene.remove(s);
                s.geometry.dispose();
                s.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    // Update spice blow particles
    updateSpiceBlows(dt) {
        for (let i = this.spiceBlows.length - 1; i >= 0; i--) {
            const blow = this.spiceBlows[i];
            blow.userData.life -= dt;

            const positions = blow.geometry.attributes.position.array;
            const { velocities } = blow.userData;

            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * dt;
                positions[j * 3 + 1] += velocities[j].y * dt;
                positions[j * 3 + 2] += velocities[j].z * dt;

                // Gravity
                velocities[j].y -= 15 * dt;
            }

            blow.geometry.attributes.position.needsUpdate = true;
            blow.material.opacity = blow.userData.life * 0.5;

            if (blow.userData.life <= 0) {
                this.scene.remove(blow);
                blow.geometry.dispose();
                blow.material.dispose();
                this.spiceBlows.splice(i, 1);
            }
        }
    }

    dispose() {
        // super.dispose(); // BaseTheme does not have dispose
        window.removeEventListener('resize', this.onWindowResize);
        this.teardownQualityListener();

        // Stop animation loop (WebGPU uses setAnimationLoop instead of requestAnimationFrame)
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
        }

        this.eventUnsubscribers.forEach((u) => u());

        // Cleanup effects
        this.shockwaves.forEach((s) => {
            this.scene?.remove(s);
            s.geometry?.dispose();
            s.material?.dispose();
        });
        this.shockwaves = [];

        this.spiceBlows.forEach((b) => {
            this.scene?.remove(b);
            b.geometry?.dispose();
            b.material?.dispose();
        });
        this.spiceBlows = [];

        // Cleanup DUNE effects
        if (this.blueGlowOverlay) {
            this.camera?.remove(this.blueGlowOverlay);
            this.scene?.remove(this.blueGlowOverlay);
            this.blueGlowOverlay.geometry?.dispose();
            this.blueGlowOverlay.material?.dispose();
            this.blueGlowOverlay = null;
        }

        // Cleanup textures
        if (this.circleTexture) {
            this.circleTexture.dispose();
            this.circleTexture = null;
        }

        // Cleanup post-processing
        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }

        // Cleanup compute shaders
        if (this.wormTrailCompute) {
            this.wormTrailCompute.dispose();
            this.wormTrailCompute = null;
        }

        // Cleanup TSL materials
        if (this.duneMaterial) {
            this.duneMaterial.material?.dispose();
            this.duneMaterial = null;
        }

        if (this.spiceMaterial) {
            this.spiceMaterial.material?.dispose();
            this.spiceMaterial = null;
        }

        if (this.skyMaterial) {
            this.skyMaterial.material?.dispose();
            this.skyMaterial = null;
        }

        if (this.starsMaterial) {
            this.starsMaterial.material?.dispose();
            this.starsMaterial = null;
        }

        if (this.sandSmokeMaterial) {
            this.sandSmokeMaterial.material?.dispose();
            this.sandSmokeMaterial = null;
        }

        if (this.blueGlowMaterial) {
            this.blueGlowMaterial.material?.dispose();
            this.blueGlowMaterial = null;
        }

        // Cleanup spice compute (Phase 4)
        if (this.spiceCompute) {
            this.spiceCompute.dispose();
            this.spiceCompute = null;
        }
        this.spicePositionBuffer = null;

        // Cleanup sand smoke compute (Phase 5)
        if (this.sandSmokeCompute) {
            this.sandSmokeCompute.dispose();
            this.sandSmokeCompute = null;
        }
        this.sandSmokePositionBuffer = null;
        this.sandSmokeLifeBuffer = null;

        // Cleanup Three.js renderer
        if (this.renderer) {
            this.renderer.dispose();
            const c = document.getElementById('shifting-sands-theme');
            if (c && c.contains(this.renderer.domElement)) c.removeChild(this.renderer.domElement);
        }

        // Reset backend tracking
        this.isWebGPU = false;
        this.isWebGL = false;
        this.scene = null;
    }

    stop() { if (this.isActive) this.dispose(); super.stop(); }

    cleanup() { this.stop(); super.cleanup(); }

    getTetrominoConfig() { return SHIFTING_SANDS_TETROMINOS; }
}
