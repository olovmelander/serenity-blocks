/**
 * Shifting Sands Theme - ARRAKIS (Three.js 3D)
 * Inspired by Dune - Harsh desert planet with twin moons, spice particles, and sand smoke
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BaseTheme } from '../base-theme.js';
import { SHIFTING_SANDS_TETROMINOS } from './shifting-sands-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    skyVertexShader,
    skyFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    duneVertexShader,
    duneFragmentShader,
    spiceVertexShader,
    spiceFragmentShader,
    heatShimmerShader,
    sandSmokeVertexShader,
    sandSmokeFragmentShader,
} from './shifting-sands-shaders.js';


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
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
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
        const u = this.fade(x), v = this.fade(y), w = this.fade(z);
        const A = this.perm[X] + Y, AA = this.perm[A] + Z, AB = this.perm[A + 1] + Z;
        const B = this.perm[X + 1] + Y, BA = this.perm[B] + Z, BB = this.perm[B + 1] + Z;
        return this.lerp(
            this.lerp(
                this.lerp(this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z), u),
                this.lerp(this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z), u), v
            ),
            this.lerp(
                this.lerp(this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1), u),
                this.lerp(this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1), u), v
            ), w
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

        // Scene elements
        this.sky = null;
        this.stars = null;
        this.moonSprites = [];  // Twin moons of Arrakis
        this.dunes = null;
        this.distantMountains = null;
        this.spiceParticles = null;
        this.dustHaze = null;
        this.sandSmoke = null;  // Volumetric sand smoke

        // DUNE-specific elements
        this.blueGlowOverlay = null; // Blue-within-blue glow effect

        // Post-processing
        this.composer = null;
        this.heatShimmerPass = null;

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
            blueGlowIntensity: { value: 0 },       // Blue-within-blue glow
            wormHeatIntensity: { value: 0 },       // Underground heat effect
        };

        // Procedural Generation Config - Larger, more dramatic Arrakis dunes
        this.terrainConfig = {
            noiseScale: {
                dunes: 0.003,      // Larger wavelength for massive dunes
                secondary: 0.012,
                detail: 0.08
            },
            heightScale: {
                dunes: 45,         // Taller dunes
                secondary: 15,
                detail: 3
            },
            duneDirection: Math.PI * 0.2  // Prevailing wind direction
        };

        this.noiseGenerator = new PerlinNoise(Math.random());

        this.targetWindStrength = 0.5;

        // ARRAKIS COLOR PALETTE - Harsh Desert Tones
        this.palette = {
            // Sky - harsh orange/amber sunset tones
            skyTop: new THREE.Color(0x1a0a05),      // Deep dark brown-black
            skyMid: new THREE.Color(0x4a2010),      // Burnt orange
            skyBottom: new THREE.Color(0x8b4513),   // Saddle brown
            skyHorizon: new THREE.Color(0xd4a574),  // Desert tan

            // Sand - golden Arrakis tones
            sandA: new THREE.Color(0x3d2814),       // Deep shadow (cool brown)
            sandB: new THREE.Color(0xc4a35a),       // Golden sand (warm)
            sandC: new THREE.Color(0xf5deb3),       // Wheat highlights

            // Sand Smoke
            sandSmoke: new THREE.Color(0xc4a35a),

            // Twin Moons
            moonPrimary: new THREE.Color(0xffeedd), // Warm white (primary moon)
            moonSecondary: new THREE.Color(0xccbbaa), // Slightly dimmer (secondary)
            moonGlow: new THREE.Color(0xffccaa),
            moonHalo: new THREE.Color(0xffaa77),

            // Spice
            spiceCore: new THREE.Color(0xff6600),   // Bright orange
            spiceGlow: new THREE.Color(0xff9933),   // Amber
            spiceParticle: new THREE.Color(0xffaa44),

            // Distant Mountains
            rockDark: new THREE.Color(0x2d1a10),
            rockMid: new THREE.Color(0x5a4020),

            // Atmosphere
            fog: new THREE.Color(0x3d2814),         // Dusty brown
            haze: new THREE.Color(0x8b6914),        // Golden haze
            dustStorm: new THREE.Color(0xc4a35a),   // Storm color
        };

        // Quality presets - Arrakis elements (OPTIMIZED particle counts)
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                starCount: 300, duneRes: 64, spiceParticleCount: 400, dustParticleCount: 150,
                sandSmokeCount: 20, enableHeatShimmer: false, enableComboEffects: false
            },
            Low: {
                starCount: 500, duneRes: 96, spiceParticleCount: 800, dustParticleCount: 300,
                sandSmokeCount: 35, enableHeatShimmer: false, enableComboEffects: true
            },
            Medium: {
                starCount: 800, duneRes: 128, spiceParticleCount: 1500, dustParticleCount: 450,
                sandSmokeCount: 60, enableHeatShimmer: true, enableComboEffects: true
            },
            High: {
                starCount: 1200, duneRes: 196, spiceParticleCount: 2000, dustParticleCount: 600,
                sandSmokeCount: 100, enableHeatShimmer: true, enableComboEffects: true
            },
            Ultra: {
                starCount: 2000, duneRes: 256, spiceParticleCount: 3000, dustParticleCount: 800,
                sandSmokeCount: 150, enableHeatShimmer: true, enableComboEffects: true
            },
            Extreme: {
                starCount: 3000, duneRes: 350, spiceParticleCount: 5000, dustParticleCount: 1000,
                sandSmokeCount: 250, enableHeatShimmer: true, enableComboEffects: true
            },
        };

        this.activePreset = this.qualityPresets.High;
        this.qualityChangeHandler = null;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
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
        this.createStars();

        // Rebuild spice particles
        if (this.spiceParticles) {
            this.scene.remove(this.spiceParticles);
            this.spiceParticles.geometry.dispose();
            this.spiceParticles.material.dispose();
        }
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
        this.createSandSmoke();

        // Rebuild dunes if resolution changed significantly
        if (this.dunes) {
            this.scene.remove(this.dunes);
            this.dunes.geometry.dispose();
            this.dunes.material.dispose();
            this.createDunes();
        }

        // Toggle heat shimmer based on quality
        if (this.heatShimmerPass) {
            this.heatShimmerPass.enabled = this.activePreset.enableHeatShimmer;
        }
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

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: this.getAntialiasEnabled(), powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setClearColor(this.palette.skyTop);
        container.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(this.palette.fog.getHex(), 0.0012);

        // Cameraconst
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 65, 180);
        this.camera.lookAt(0, 0, 0);

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create Arrakis Elements
        this.createSky();
        this.createStars();
        this.createTwinMoons();          // Twin moons of Arrakis
        this.createDistantMountains();   // New Distant Dunes Horizon
        this.createDunes();              // Vast procedural desert
        this.createSpiceParticles();     // The spice must flow
        this.createDustHaze();           // Atmospheric dust
        this.createSandSmoke();          // Volumetric sand smoke

        // DUNE-specific effects
        this.createBlueGlowOverlay();    // Blue-within-blue effect

        this.setupLighting();
        this.setupPostProcessing();      // Heat shimmer effect

        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.clock.start();
        this.animate();
    }

    createSky() {
        const skyGeometry = new THREE.SphereGeometry(600, 32, 32);
        const skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTopColor: { value: this.palette.skyTop },
                uMidColor: { value: this.palette.skyMid },
                uBottomColor: { value: this.palette.skyBottom },
                uHorizonColor: { value: this.palette.skyHorizon },
                uMoonGlowIntensity: this.uniforms.moonGlowIntensity,
                uMoonPosition: { value: new THREE.Vector3(100, 80, -50) },
                uMoonColor: { value: this.palette.moonGlow },
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.BackSide,
            depthWrite: false,
        });
        this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
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

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: this.uniforms.time },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.stars = new THREE.Points(geometry, material);
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
                color: color,
                transparent: true,
                opacity: opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false
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
            { z: -250, color: this.palette.rockMid, scaleX: 0.005, scaleY: 40, offsetY: -5 },
            { z: -350, color: this.palette.rockDark, scaleX: 0.003, scaleY: 60, offsetY: -10 },
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
                fog: true
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
        let h2 = this.noiseGenerator.noise(x * this.terrainConfig.noiseScale.secondary, z * this.terrainConfig.noiseScale.secondary + 100);
        h += h2 * this.terrainConfig.heightScale.secondary;

        // 3. Fine detail - sand ripples
        let h3 = this.noiseGenerator.noise(x * this.terrainConfig.noiseScale.detail, z * this.terrainConfig.noiseScale.detail);
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

        // Journey-style Material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uColorA: { value: this.palette.sandA },
                uColorB: { value: this.palette.sandB },
                uColorC: { value: this.palette.sandC },
                uMoonDirection: { value: new THREE.Vector3(0.5, 0.6, -0.3).normalize() },
                uFogColor: { value: this.palette.fog },
                uFogNear: { value: 200 },
                uFogFar: { value: 600 },
            },
            vertexShader: duneVertexShader,
            fragmentShader: duneFragmentShader,
        });

        this.dunes = new THREE.Mesh(geometry, material);
        this.scene.add(this.dunes);
    }

    // --- SPICE PARTICLES - The spice must flow ---
    createSpiceParticles() {
        const count = this.activePreset.spiceParticleCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Spread across the desert
            positions[i * 3] = (Math.random() - 0.5) * 800;
            positions[i * 3 + 1] = -15 + Math.random() * 80;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 800;

            phases[i] = Math.random();
            sizes[i] = 2 + Math.random() * 6;

            // Orange/amber spice colors
            const col = new THREE.Color().lerpColors(
                this.palette.spiceParticle,
                this.palette.spiceCore,
                Math.random()
            );
            colors[i * 3] = col.r;
            colors[i * 3 + 1] = col.g;
            colors[i * 3 + 2] = col.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uWindStrength: this.uniforms.windStrength,
                uSpiceIntensity: this.uniforms.spiceIntensity,
            },
            vertexShader: spiceVertexShader,
            fragmentShader: spiceFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spiceParticles = new THREE.Points(geometry, material);
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
        const count = this.activePreset.sandSmokeCount;
        if (count === 0) return;

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const sizes = [];
        const randoms = [];

        for (let i = 0; i < count; i++) {
            // Spread across the view
            const x = (Math.random() - 0.5) * 2000;  // Tighter X spread
            const y = 0; // Height set by shader
            const z = -2000 + Math.random() * 2800; // -2000 to +800 coverage

            positions.push(x, y, z);
            sizes.push(700 + Math.random() * 500); // Larger particles for better coverage
            randoms.push(Math.random());
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('random', new THREE.Float32BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                color: { value: this.palette.sandSmoke },
                windStrength: this.uniforms.windStrength,
            },
            vertexShader: sandSmokeVertexShader,
            fragmentShader: sandSmokeFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending, // Silky blending
        });

        this.sandSmoke = new THREE.Points(geometry, material);
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
        const overlayMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uIntensity: this.uniforms.blueGlowIntensity,
                uTime: this.uniforms.time,
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uIntensity;
                uniform float uTime;
                varying vec2 vUv;
                
                void main() {
                    // Radial gradient from edges
                    vec2 center = vUv - 0.5;
                    float dist = length(center);
                    float vignette = smoothstep(0.2, 0.7, dist);
                    
                    // Blue-within-blue color (Fremen eyes)
                    vec3 spiceBlue = vec3(0.1, 0.3, 0.8);
                    vec3 deepBlue = vec3(0.05, 0.15, 0.5);
                    
                    // Pulsing effect
                    float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
                    vec3 blueColor = mix(deepBlue, spiceBlue, pulse);
                    
                    float alpha = uIntensity * vignette * 0.4;
                    
                    gl_FragColor = vec4(blueColor, alpha);
                }
            `,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.blueGlowOverlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
        this.blueGlowOverlay.renderOrder = 100; // Render last
        this.blueGlowOverlay.frustumCulled = false;
        this.scene.add(this.blueGlowOverlay);
    }

    // --- POST-PROCESSING: Heat Shimmer ---
    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // Heat shimmer distortion
        const heatShimmerPass = new ShaderPass({
            uniforms: {
                tDiffuse: { value: null },
                uTime: this.uniforms.time,
                uStrength: this.uniforms.heatShimmerStrength,
                uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: heatShimmerShader,
        });

        this.heatShimmerPass = heatShimmerPass;
        this.heatShimmerPass.enabled = this.activePreset.enableHeatShimmer;
        this.composer.addPass(heatShimmerPass);
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
        if (!this.isActive) return;
        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // Smooth Wind
        this.uniforms.windStrength.value += (this.targetWindStrength - this.uniforms.windStrength.value) * 0.02;
        this.targetWindStrength += (0.5 - this.targetWindStrength) * 0.005;

        // Decay spice intensity back to normal
        this.uniforms.spiceIntensity.value += (1.0 - this.uniforms.spiceIntensity.value) * 0.01;
        this.uniforms.dustDensity.value += (0.3 - this.uniforms.dustDensity.value) * 0.02;

        // Decay blue glow and worm heat back to normal
        this.uniforms.blueGlowIntensity.value *= 0.95;
        this.uniforms.wormHeatIntensity.value += (0 - this.uniforms.wormHeatIntensity.value) * 0.02;

        // Boost heat shimmer based on worm activity
        const baseShimmer = 0.006;
        const wormHeatBoost = this.uniforms.wormHeatIntensity.value * 0.015;
        this.uniforms.heatShimmerStrength.value = baseShimmer + wormHeatBoost;

        // Camera Sway + Shake - Enhanced for cinematic feel
        if (this.camera) {
            // Multi-layered organic motion
            let camX = this.baseCameraPos.x
                + Math.sin(elapsed * 0.08) * 12        // Slow side-to-side sweep
                + Math.sin(elapsed * 0.23) * 4;        // Faster subtle drift

            let camY = this.baseCameraPos.y
                + Math.cos(elapsed * 0.05) * 3         // Gentle vertical bob
                + Math.sin(elapsed * 0.17) * 1.5;      // Secondary bob

            let camZ = this.baseCameraPos.z
                + Math.sin(elapsed * 0.11) * 8         // Slow forward/back drift
                + Math.cos(elapsed * 0.31) * 3;        // Faster subtle pulse

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

        // Update DUNE effects (worm tracking)
        this.updateWormEffects(elapsed, delta);

        // Update effects
        this.updateShockwaves(delta);
        this.updateSpiceBlows(delta);

        // Render with post-processing if enabled
        if (this.composer && this.activePreset.enableHeatShimmer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    onWindowResize() {
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);

            // Update composer
            if (this.composer) {
                this.composer.setSize(window.innerWidth, window.innerHeight);
            }

            // Update heat shimmer resolution uniform
            if (this.heatShimmerPass) {
                this.heatShimmerPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
            }
        }
    }

    // --- EVENTS ---
    setupEventListeners() {
        const sub = (evt, fn) => this.eventUnsubscribers.push(eventBus.on(evt, d => {
            const s = window.settings;
            if (this.isActive && s?.backgroundComboEffects !== false) fn(d);
        }));

        sub(EVENTS.LINE_CLEAR, d => this.onLineClear(d.lineCount));
        sub(EVENTS.COMBO, d => this.onCombo(d.comboCount));
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
            this.uniforms.moonGlowIntensity.value += 0.5;
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
        // Calculate worm position (must match shader logic)
        const wormSpeed = 30.0;
        const wormCycleLength = 2000.0;
        const wormCycleTime = wormCycleLength / wormSpeed;
        const currentCycle = Math.floor(elapsed / wormCycleTime);
        const wormHeadZ = (elapsed * wormSpeed % wormCycleLength) - 1000.0;

        // Pseudo-random path per cycle
        const cycleHash = (Math.sin(currentCycle * 12.9898) * 43758.5453) % 1;
        const cycleHash2 = (Math.sin(currentCycle * 78.233 + 1.0) * 43758.5453) % 1;
        const wormPathBaseX = (Math.abs(cycleHash) - 0.5) * 200.0;
        const wormPathSlope = (Math.abs(cycleHash2) - 0.5) * 0.6;
        const wormHeadX = wormPathBaseX + wormHeadZ * wormPathSlope;

        // Get approximate terrain height at worm head
        const wormHeadY = this.getTerrainHeight(wormHeadX, wormHeadZ) + 5;

        // Worm position is now tracked for heat shimmer and future effects
        // (wormHeadX, wormHeadY, wormHeadZ) is available for use
    }

    // Dust storm effect
    triggerDustStorm() {
        this.uniforms.dustDensity.value = 1.0;
        this.uniforms.heatShimmerStrength.value = 0.01;
    }

    // Spice blow particle burst
    createSpiceBlow(intensity) {
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
                x: (Math.random() - 0.5) * 30,
                y: 10 + Math.random() * 20,
                z: (Math.random() - 0.5) * 30,
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
            velocities: velocities,
            positions: positions,
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
            const velocities = blow.userData.velocities;

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
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.eventUnsubscribers.forEach(u => u());

        // Cleanup effects
        this.shockwaves.forEach(s => {
            this.scene?.remove(s);
            s.geometry?.dispose();
            s.material?.dispose();
        });
        this.shockwaves = [];

        this.spiceBlows.forEach(b => {
            this.scene?.remove(b);
            b.geometry?.dispose();
            b.material?.dispose();
        });
        this.spiceBlows = [];

        // Cleanup DUNE effects
        if (this.blueGlowOverlay) {
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

        // Cleanup composer
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const c = document.getElementById('shifting-sands-theme');
            if (c && c.contains(this.renderer.domElement)) c.removeChild(this.renderer.domElement);
        }
        this.scene = null;
    }

    stop() { if (this.isActive) this.dispose(); super.stop(); }
    cleanup() { this.stop(); super.cleanup(); }
    getTetrominoConfig() { return SHIFTING_SANDS_TETROMINOS; }
}
