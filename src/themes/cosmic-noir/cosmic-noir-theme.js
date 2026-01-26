/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌑 COSMIC NOIR 🌑
 *  A Stunning 3D Cosmic Noir Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Deep 3D Starfield with twinkling grayscale stars
 * - 3D Black Planet sphere with subtle surface texture and silver rim glow
 * - Multiple glow layers around the planet for ethereal noir atmosphere
 * - Drifting nebula clouds at varying depths (grayscale)
 * - Floating noir particles throughout 3D space
 * - Gameplay effects: cosmic waves, void pulses, stellar dust
 * - Post-processing: Bloom + Vignette for cinematic noir depth
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { COSMIC_NOIR_TETROMINOS } from './cosmic-noir-tetrominos.js';
import {
    planetVertexShader,
    planetFragmentShader,
    waveVertexShader,
    waveFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    starVertexShader,
    starFragmentShader,
    atmosphereVertexShader,
    atmosphereFragmentShader,
    voidSparkVertexShader,
    voidSparkFragmentShader,
    ChromaticAberrationShader,
    nebulaVertexShader,
    nebulaFragmentShader,
} from './cosmic-noir-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 80000,
        nebulaCount: 25,
        ambientParticles: 400,
        voidSparks: 24000,
        bloomStrength: 0.5,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        planetDetail: 64,
        glowLayers: 8,
    },
    Ultra: {
        starCount: 50000,
        nebulaCount: 20,
        ambientParticles: 300,
        voidSparks: 18000,
        bloomStrength: 0.45,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        planetDetail: 56,
        glowLayers: 7,
    },
    High: {
        starCount: 30000,
        nebulaCount: 15,
        ambientParticles: 200,
        voidSparks: 15000,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        enablePostProcessing: true,
        planetDetail: 48,
        glowLayers: 6,
    },
    Medium: {
        starCount: 15000,
        nebulaCount: 10,
        ambientParticles: 120,
        voidSparks: 10000,
        bloomStrength: 0.35,
        bloomRadius: 0.3,
        enablePostProcessing: true,
        planetDetail: 36,
        glowLayers: 5,
    },
    Low: {
        starCount: 8000,
        nebulaCount: 6,
        ambientParticles: 60,
        voidSparks: 6000,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        enablePostProcessing: false,
        planetDetail: 24,
        glowLayers: 4,
    },
    Minimal: {
        starCount: 4000,
        nebulaCount: 4,
        ambientParticles: 30,
        voidSparks: 3500,
        bloomStrength: 0.2,
        bloomRadius: 0.2,
        enablePostProcessing: false,
        planetDetail: 16,
        glowLayers: 3,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.8 },
        offset: { value: 1.2 },
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
            float vig = smoothstep(offset, offset - 0.7, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class CosmicNoirTheme extends BaseTheme {
    constructor() {
        super('cosmic-noir');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.planet = null;
        this.planetGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.atmosphere = null;
        this.cosmicWaves = [];
        this.voidSparks = []; // Pool of particle systems for overlapping bursts
        this.voidSparkIndex = 0; // Cycle through available systems

        // Effect states
        this.planetPulseIntensity = 0;
        this.starEventBoost = 0; // Flash stars on events
        this.planetGlowIntensity = 1.0;
        this.comboMultiplier = 1.0;
        this.gasExplosionTimer = -10.0; // Timer for atmosphere gas explosion
        this.gasExplosionIntensity = 0.0; // Intensity based on combo

        // Planet drift animation (Lissajous curves for organic movement)
        this.planetPhaseX = Math.random() * Math.PI * 2;
        this.planetPhaseY = Math.random() * Math.PI * 2;
        this.planetPhaseX2 = Math.random() * Math.PI * 2;
        this.planetPhaseY2 = Math.random() * Math.PI * 2;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingComboCount = 0;

        console.log('[CosmicNoir] Theme constructed');
    }

    getTetrominoConfig() {
        return COSMIC_NOIR_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    async createScene() {
        console.log('[CosmicNoir] Creating stunning 3D cosmic noir scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('cosmic-noir-theme');
        if (!container) {
            console.error('[CosmicNoir] Container not found');
            return;
        }

        // Clear any existing content (old canvas)
        container.innerHTML = '';

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaClouds();
        this.createPlanet();
        this.createAtmosphere();
        // Ambient particles removed for cleaner noir star aesthetic
        this.createVoidSparks();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[CosmicNoir] Scene created successfully');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x000000, 1); // Pure black background
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020202, 0.0006); // Very dark, subtle fog

        // Camera positioned for depth
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000);
        this.camera.position.set(0, 0, 1200);
        this.camera.lookAt(0, 0, 0);

        // Very subtle lighting - noir aesthetic
        const planetLight = new THREE.PointLight(0x888888, 1.5, 2500);
        planetLight.position.set(300, 200, 500);
        this.scene.add(planetLight);

        // Dim ambient
        const ambientLight = new THREE.AmbientLight(0x080808, 0.3);
        this.scene.add(ambientLight);

        // Resize handler
        window.addEventListener('resize', this.onWindowResize.bind(this));

        console.log('[CosmicNoir] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Deep 3D grayscale stars
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2); // phase + speed
        const brightness = new Float32Array(starCount);

        // Grayscale star colors - pure noir palette
        const starColors = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xf0f0f0), // Near white
            new THREE.Color(0xe0e0e0), // Light gray
            new THREE.Color(0xd0d0d0), // Medium-light gray
            new THREE.Color(0xc0c0c8), // Silver tint
            new THREE.Color(0xb0b0b8), // Cooler silver
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // FIXED: Use Spherical Distribution to prevent black voids on rotation
            // Stars are now placed in a full 360-degree sphere around the origin
            const radius = 2000 + Math.random() * 8000; // Deep depth range
            const theta = Math.random() * Math.PI * 2; // Horizontal angle
            const phi = Math.acos(2 * Math.random() - 1); // Vertical angle (acos for uniform sphere)

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            // Color - grayscale noir palette
            const colorIndex = Math.floor(Math.random() * starColors.length);
            const color = starColors[colorIndex];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Larger sizes for atmospheric appearance
            sizes[i] = 20 + Math.random() * 40;

            // Twinkle: phase offset, varied speed (0.8 to 2.5 Hz)
            twinkleData[i2] = Math.random() * Math.PI * 2; // phase
            twinkleData[i2 + 1] = 0.8 + Math.random() * 1.7; // speed

            brightness[i] = 0.3 + Math.random() * 0.7;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uEventBoost: { value: 0 },
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[CosmicNoir] Starfield created with', starCount, 'atmospheric stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Grayscale/silver clouds at varying depths
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/cosmic-noir/';

        const textures = [
            textureLoader.load(`${texturePath}nebula-noir-1.png`),
            textureLoader.load(`${texturePath}nebula-noir-2.png`),
            textureLoader.load(`${texturePath}nebula-noir-3.png`),
        ];

        textures.forEach((t) => {
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
        });

        // Configure nebula planes at different depths
        const nebulaConfigs = [
            // Deep background layer (Parallax factor low)
            {
                texture: textures[0], size: 6000, z: -4500, opacity: 0.25, speed: 0.00008,
            },
            {
                texture: textures[1], size: 7000, z: -4000, opacity: 0.2, speed: 0.0001,
            },
            // Mid layer
            {
                texture: textures[2], size: 5000, z: -3000, opacity: 0.15, speed: 0.00015,
            },
            {
                texture: textures[0], size: 5500, z: -2500, opacity: 0.12, speed: 0.0002,
            },
        ];

        this.nebulaClouds = [];

        nebulaConfigs.forEach((config) => {
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: config.texture },
                    uOpacity: { value: config.opacity },
                    uPulse: { value: 0 },
                },
                vertexShader: nebulaVertexShader,
                fragmentShader: nebulaFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const mesh = new THREE.Mesh(geometry, material);
            // Random position spread
            mesh.position.x = (Math.random() - 0.5) * 2000;
            mesh.position.y = (Math.random() - 0.5) * 1000;
            mesh.position.z = config.z;
            mesh.rotation.z = Math.random() * Math.PI * 2;

            mesh.userData = {
                driftSpeed: config.speed,
                baseOpacity: config.opacity,
                pulsePhase: Math.random() * Math.PI * 2,
            };

            this.nebulaClouds.push(mesh);
            this.scene.add(mesh);
        });

        console.log('[CosmicNoir] Nebula clouds created with high-def textures');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Black Planet - 3D Sphere with subtle texture and silver glow
    // ─────────────────────────────────────────────────────────────────────────

    createPlanet() {
        const planetSize = 280;

        // Create planet group for drifting
        this.planetGroup = new THREE.Group();
        this.scene.add(this.planetGroup);

        // Load Planet Texture
        const textureLoader = new THREE.TextureLoader();
        const planetTexture = textureLoader.load('./textures/2k_haumea_fictional_black.png');
        planetTexture.wrapS = THREE.ClampToEdgeWrapping;
        planetTexture.wrapT = THREE.ClampToEdgeWrapping;

        // Planet sphere with shader material
        const geometry = new THREE.SphereGeometry(planetSize, this.qualityPreset.planetDetail, this.qualityPreset.planetDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulseIntensity: { value: 0 },
                uGlowIntensity: { value: 1.0 },
                uMap: { value: planetTexture },
                uSunDirection: { value: new THREE.Vector3(0.6, 0.4, 0.7).normalize() }, // Cinematic side lighting
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
        });

        this.planet = new THREE.Mesh(geometry, material);
        this.planet.renderOrder = 100;
        this.planetGroup.add(this.planet);

        // Create glow layers around the planet
        this.createPlanetGlowLayers(planetSize);

        console.log('[CosmicNoir] 3D Black Planet created with texture');
    }

    createPlanetGlowLayers(planetSize) {
        const glowConfigs = [];
        const layerCount = this.qualityPreset.glowLayers;

        for (let i = 0; i < layerCount; i++) {
            const sizeMult = 1.25 + i * 0.22;
            const opacity = 0.25 - i * 0.03;
            glowConfigs.push({
                size: planetSize * sizeMult,
                color: i < 3 ? 0x666666 : (i < 5 ? 0x444444 : 0x222222), // Grayscale glow
                opacity: Math.max(0.04, opacity),
                z: -5 * (i + 1),
            });
        }

        for (const config of glowConfigs) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            gradient.addColorStop(0.15, 'rgba(220, 220, 230, 0.5)');
            gradient.addColorStop(0.4, 'rgba(150, 150, 160, 0.25)');
            gradient.addColorStop(0.7, 'rgba(80, 80, 90, 0.1)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(geometry, material);
            glow.position.set(0, 0, config.z);
            glow.renderOrder = 50;
            glow.userData.baseOpacity = config.opacity;
            this.planetGlowLayers.push(glow);
            this.planetGroup.add(glow);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating grayscale particles
    // ─────────────────────────────────────────────────────────────────────────

    // Ambient particles method removed

    // ─────────────────────────────────────────────────────────────────────────
    // Atmosphere - Volumetric gas shell with explosion support
    // ─────────────────────────────────────────────────────────────────────────

    createAtmosphere() {
        // Create an atmosphere slightly larger than the planet
        const planetSize = 280;
        const atmosphereSize = planetSize * 1.25;

        const geometry = new THREE.SphereGeometry(atmosphereSize, 64, 64);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulseIntensity: { value: 0 },
                uExplosionTimer: { value: -10.0 },
                uExplosionIntensity: { value: 0 },
            },
            vertexShader: atmosphereVertexShader,
            fragmentShader: atmosphereFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.FrontSide, // Render outside only
        });

        this.atmosphere = new THREE.Mesh(geometry, material);
        this.atmosphere.renderOrder = 101; // Render after planet

        this.planetGroup.add(this.atmosphere);

        console.log('[CosmicNoir] Atmosphere shell created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Void Sparks - Explosive silver/gray burst from planet surface outward
    // Creates a pool of particle systems to allow overlapping bursts
    // ─────────────────────────────────────────────────────────────────────────

    createVoidSparks() {
        const poolSize = 24; // Increased number of overlapping bursts allowed
        const countPerSystem = Math.floor(this.qualityPreset.voidSparks / 3);

        const planetRadius = 180; // Start at planet surface

        // Color palette for void sparks - silver/gray noir aesthetic
        const colorOptions = [
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xe0e0e8), // Light silver
            new THREE.Color(0xc0c0c8), // Medium silver
            new THREE.Color(0xa0a0b0), // Gray silver
            new THREE.Color(0x9090a0), // Darker silver
        ];

        for (let p = 0; p < poolSize; p++) {
            const geometry = new THREE.BufferGeometry();

            const thetas = new Float32Array(countPerSystem);
            const phis = new Float32Array(countPerSystem);
            const radii = new Float32Array(countPerSystem);
            const randoms = new Float32Array(countPerSystem);
            const colors = new Float32Array(countPerSystem * 3);
            const positions = new Float32Array(countPerSystem * 3);

            for (let i = 0; i < countPerSystem; i++) {
                // Distribute particles evenly on planet surface
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                thetas[i] = theta;
                phis[i] = phi;
                radii[i] = planetRadius;
                randoms[i] = Math.random();

                // Color selection - mostly white/silver with some gray
                const colorType = Math.random();
                let c;
                if (colorType > 0.5) c = colorOptions[0]; // White
                else if (colorType > 0.3) c = colorOptions[1]; // Light silver
                else if (colorType > 0.15) c = colorOptions[2]; // Medium silver
                else if (colorType > 0.05) c = colorOptions[3]; // Gray silver
                else c = colorOptions[4]; // Darker silver

                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = 0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aTheta', new THREE.BufferAttribute(thetas, 1));
            geometry.setAttribute('aPhi', new THREE.BufferAttribute(phis, 1));
            geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    uPulseTimer: { value: -100.0 },
                },
                vertexShader: voidSparkVertexShader,
                fragmentShader: voidSparkFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const sparks = new THREE.Points(geometry, material);
            this.planetGroup.add(sparks);
            this.voidSparks.push(sparks);
        }

        console.log('[CosmicNoir] Void sparks pool created with', poolSize, 'systems,', countPerSystem, 'particles each');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) {
            console.log('[CosmicNoir] Post-processing disabled for quality level');
            return;
        }

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.15,
        );
        this.composer.addPass(bloomPass);

        // Chromatic Aberration for cinematic effect
        const chromaticPass = new ShaderPass(ChromaticAberrationShader);
        chromaticPass.uniforms.uIntensity.value = 0.004;
        this.composer.addPass(chromaticPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[CosmicNoir] Post-processing configured (with chromatic aberration)');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        this.animate();
    }

    animate() {
        if (!this.isActive) return;

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);

        const delta = this.clock.getDelta();
        this.time += delta;

        // Update shader uniforms
        if (this.planet && this.planet.material.uniforms) {
            this.planet.material.uniforms.uTime.value = this.time;
            this.planet.material.uniforms.uPulseIntensity.value = this.planetPulseIntensity;
            this.planet.material.uniforms.uGlowIntensity.value = this.planetGlowIntensity;

            // Spin planet around own axis
            this.planet.rotation.y += delta * 0.05; // Slow, majestic rotation
        }

        if (this.starfield && this.starfield.material.uniforms) {
            this.starfield.material.uniforms.uTime.value = this.time;
            this.starfield.material.uniforms.uEventBoost.value = this.starEventBoost;
        }

        if (this.ambientParticles && this.ambientParticles.material.uniforms) {
            this.ambientParticles.material.uniforms.uTime.value = this.time;
        }

        // Update atmosphere shader
        if (this.atmosphere && this.atmosphere.material.uniforms) {
            this.atmosphere.material.uniforms.uTime.value = this.time;
            this.atmosphere.material.uniforms.uPulseIntensity.value = this.planetPulseIntensity;

            // Update gas explosion timer
            if (this.gasExplosionTimer > -5.0) {
                this.gasExplosionTimer += delta;
                this.atmosphere.material.uniforms.uExplosionTimer.value = this.gasExplosionTimer;
                this.atmosphere.material.uniforms.uExplosionIntensity.value = this.gasExplosionIntensity;

                // Reset after explosion completes
                if (this.gasExplosionTimer > 5.0) {
                    this.gasExplosionTimer = -10.0;
                    this.gasExplosionIntensity = 0;
                }
            }
        }

        // Update all void spark systems in the pool
        for (const sparks of this.voidSparks) {
            if (sparks && sparks.material.uniforms) {
                sparks.material.uniforms.time.value = this.time;

                // Update pulse wave
                if (sparks.material.uniforms.uPulseTimer.value > -50.0) {
                    // Move wave outwards - speed increased for more explosive look
                    sparks.material.uniforms.uPulseTimer.value += delta * 18.0;

                    // Turn off when wave completes
                    if (sparks.material.uniforms.uPulseTimer.value > 85.0) {
                        sparks.material.uniforms.uPulseTimer.value = -100.0;
                    }
                }
            }
        }

        // Slow drift planet across entire screen (Lissajous curves for organic movement)
        if (this.planetGroup) {
            const driftX = Math.sin(this.time * 0.025 + this.planetPhaseX) * 550
                + Math.cos(this.time * 0.018 + this.planetPhaseX2) * 250;
            const driftY = Math.cos(this.time * 0.02 + this.planetPhaseY) * 350
                + Math.sin(this.time * 0.012 + this.planetPhaseY2) * 150;

            this.planetGroup.position.x = driftX;
            this.planetGroup.position.y = driftY;

            // Gentle rotation
            this.planetGroup.rotation.z = Math.sin(this.time * 0.008) * 0.04;
        }

        // Slow camera orbit for parallax depth (independent of planet)
        if (this.camera) {
            const cameraTime = this.time * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 400; // Wide horizontal sway
            const orbitRadiusY = 300; // Vertical sway range
            const orbitRadiusZ = 200; // Depth breathing

            // Orbital sway - creates parallax with starfield/nebula
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX
                + Math.cos(cameraTime * 0.7) * orbitRadiusX * 0.4;
            this.camera.position.y = Math.cos(cameraTime * 0.8) * orbitRadiusY
                + Math.sin(cameraTime * 0.5) * orbitRadiusY * 0.3;
            this.camera.position.z = 1200 + Math.sin(cameraTime * 0.6) * orbitRadiusZ;

            // LookAt drift for dynamic framing (not following planet)
            const lookOffsetX = Math.sin(cameraTime * 0.4) * 150;
            const lookOffsetY = Math.cos(cameraTime * 0.5) * 100;
            this.camera.lookAt(lookOffsetX, lookOffsetY, 0);
        }

        // Pulse glow layers with planet pulse intensity
        const glowPulse = Math.sin(this.time * 1.5) * 0.12 + 1.0;
        for (const glow of this.planetGlowLayers) {
            const pulse = (1 + this.planetPulseIntensity * 0.4) * glowPulse;
            glow.material.opacity = glow.userData.baseOpacity * pulse;
        }

        // Nebula drift and pulse
        // Nebula drift and pulse (synced with camera for seamless coverage)
        for (const cloud of this.nebulaClouds) {
            // Move nebulas with camera so they always cover the view
            // Plus gentle drift for atmosphere
            cloud.userData.driftOffset = (cloud.userData.driftOffset || 0) + cloud.userData.driftSpeed * 50;
            if (cloud.userData.driftOffset > 6000) cloud.userData.driftOffset = -6000;

            // Sync base position with camera, add drift offset
            cloud.position.x = (this.camera?.position.x || 0) * 0.3 + cloud.userData.driftOffset;
            cloud.position.y = (this.camera?.position.y || 0) * 0.2;

            cloud.userData.pulsePhase += 0.003;
            // Pulse: -1 to 1 for subtle breathing
            const pulse = Math.sin(cloud.userData.pulsePhase);

            if (cloud.material.uniforms) {
                cloud.material.uniforms.uPulse.value = pulse + (this.planetPulseIntensity * 2.0); // React to gameplay
            }
        }

        // Starfield follows camera (appears at infinite distance)
        if (this.starfield && this.camera) {
            // Position starfield at camera location so stars are always visible
            this.starfield.position.copy(this.camera.position);

            // Slowly rotate starfield for subtle animation
            this.starfield.rotation.y = this.time * 0.003;
            this.starfield.rotation.z = this.time * 0.001;
        }

        // Decay pulse intensity
        if (this.planetPulseIntensity > 0) {
            this.planetPulseIntensity *= 0.94;
            if (this.planetPulseIntensity < 0.01) this.planetPulseIntensity = 0;
        }

        if (this.starEventBoost > 0) {
            this.starEventBoost *= 0.92; // Fast decay for quick flash
            if (this.starEventBoost < 0.01) this.starEventBoost = 0;
        }

        // Update cosmic waves
        this.updateCosmicWaves(delta);

        // Render
        this.renderer.clear();
        if (this.composer && this.qualityPreset.enablePostProcessing) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cosmic Waves - Expanding silver/gray torus rings
    // ─────────────────────────────────────────────────────────────────────────

    createCosmicWave(intensity) {
        const geometry = new THREE.TorusGeometry(30, 2, 8, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: this.time },
                uOpacity: { value: 1.0 },
                uColor: { value: new THREE.Color(0x888888) }, // Gray wave
            },
            vertexShader: waveVertexShader,
            fragmentShader: waveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.random() * Math.PI * 0.3;
        wave.rotation.y = Math.random() * Math.PI * 2;

        wave.userData = {
            speed: 70 + intensity * 18,
            life: 1.0,
            maxLife: 1.0,
        };

        this.planetGroup.add(wave);
        this.cosmicWaves.push(wave);
    }

    updateCosmicWaves(delta) {
        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];
            wave.scale.addScalar(wave.userData.speed * delta * 0.1);
            wave.userData.life -= delta * 0.7;

            if (wave.material.uniforms) {
                wave.material.uniforms.uOpacity.value = wave.userData.life;
            }

            if (wave.userData.life <= 0) {
                this.planetGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.cosmicWaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Void Orbs - Glowing particles drifting outward
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    handlePieceLock() {
        this.planetPulseIntensity = Math.min(this.planetPulseIntensity + 0.12, 0.45);
        this.starEventBoost = 2.0; // Strong flash on lock
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    onLineClear(lineCount, comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 2.5);
        this.planetPulseIntensity = Math.min(0.5 + comboCount * 0.18, 1.3);

        // === COMBO EFFECTS: Void Sparks + Gas Explosion ===
        if (comboCount >= 2 && this.voidSparks.length > 0) {
            // Calculate how many systems to trigger based on combo
            let systemsToTrigger = 1;
            if (comboCount >= 8) systemsToTrigger = 3;
            else if (comboCount >= 4) systemsToTrigger = 2;

            for (let s = 0; s < systemsToTrigger; s++) {
                // Find an inactive spark system (one that has finished animating)
                let sparkSystem = null;
                for (let i = 0; i < this.voidSparks.length; i++) {
                    const idx = (this.voidSparkIndex + i) % this.voidSparks.length;
                    const candidate = this.voidSparks[idx];
                    if (candidate && candidate.material.uniforms) {
                        const timer = candidate.material.uniforms.uPulseTimer.value;
                        if (timer < -50.0 || timer > 85.0) {
                            sparkSystem = candidate;
                            this.voidSparkIndex = (idx + 1) % this.voidSparks.length;
                            break;
                        }
                    }
                }

                // If all systems are active, fallback to the oldest one (cycle through)
                if (!sparkSystem) {
                    sparkSystem = this.voidSparks[this.voidSparkIndex];
                    this.voidSparkIndex = (this.voidSparkIndex + 1) % this.voidSparks.length;
                }

                // Trigger the spark burst with a slight delay for staggered effect
                if (sparkSystem && sparkSystem.material.uniforms) {
                    if (s === 0) {
                        sparkSystem.material.uniforms.uPulseTimer.value = 0.0;
                    } else {
                        // Small offset for subsequent systems
                        setTimeout(() => {
                            if (sparkSystem && sparkSystem.material.uniforms) {
                                sparkSystem.material.uniforms.uPulseTimer.value = 0.0;
                            }
                        }, s * 150);
                    }
                }
            }

            // Trigger gas explosion on atmosphere
            this.gasExplosionTimer = 0.0;
            this.gasExplosionIntensity = Math.min(0.5 + comboCount * 0.15, 1.2);
        }

        // Create cosmic waves
        const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), 4);
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => this.createCosmicWave(comboCount), i * 100);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        window.removeEventListener('resize', this.onWindowResize.bind(this));

        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('cosmic-noir-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose scene objects
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

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.planet = null;
        this.planetGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.atmosphere = null;
        this.cosmicWaves = [];
        this.voidSparks = [];
        this.voidSparkIndex = 0;

        super.stop();
    }
}
