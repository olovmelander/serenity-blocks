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
    FilmGrainShader,
} from './cosmic-noir-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 8000,
        nebulaCount: 25,
        ambientParticles: 400,
        voidSparks: 2500,
        bloomStrength: 0.5,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        planetDetail: 64,
        glowLayers: 8,
    },
    Ultra: {
        starCount: 6000,
        nebulaCount: 20,
        ambientParticles: 300,
        voidSparks: 2000,
        bloomStrength: 0.45,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        planetDetail: 56,
        glowLayers: 7,
    },
    High: {
        starCount: 5000,
        nebulaCount: 15,
        ambientParticles: 200,
        voidSparks: 1500,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        enablePostProcessing: true,
        planetDetail: 48,
        glowLayers: 6,
    },
    Medium: {
        starCount: 3000,
        nebulaCount: 10,
        ambientParticles: 120,
        voidSparks: 1000,
        bloomStrength: 0.35,
        bloomRadius: 0.3,
        enablePostProcessing: true,
        planetDetail: 36,
        glowLayers: 5,
    },
    Low: {
        starCount: 1800,
        nebulaCount: 6,
        ambientParticles: 60,
        voidSparks: 600,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        enablePostProcessing: false,
        planetDetail: 24,
        glowLayers: 4,
    },
    Minimal: {
        starCount: 1000,
        nebulaCount: 4,
        ambientParticles: 30,
        voidSparks: 400,
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
        this.ambientParticles = null;
        this.planetGlowLayers = [];
        this.atmosphere = null;
        this.cosmicWaves = [];
        this.voidOrbs = [];
        this.voidSparks = []; // Pool of particle systems for overlapping bursts
        this.voidSparkIndex = 0; // Cycle through available systems

        // Effect states
        this.planetPulseIntensity = 0;
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
        this.createAmbientParticles();
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
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const phases = new Float32Array(starCount);

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

            // Spread stars across a large 3D sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 1500 + Math.random() * 5500;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 2000;

            // Color - mostly white with some silver-tinted
            const colorIndex = Math.floor(Math.random() * starColors.length);
            const color = starColors[colorIndex];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 4.0 + Math.random() * 6.0;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
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
        console.log('[CosmicNoir] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Grayscale/silver clouds at varying depths
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const cloudCount = this.qualityPreset.nebulaCount;

        for (let i = 0; i < cloudCount; i++) {
            const size = 800 + Math.random() * 1500;

            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Grayscale color palette for noir aesthetic
            const brightness = 15 + Math.random() * 25; // Very dark
            const alpha = 0.06 + Math.random() * 0.08; // Very subtle

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `rgba(${brightness + 10}, ${brightness + 10}, ${brightness + 15}, ${alpha})`);
            gradient.addColorStop(0.4, `rgba(${brightness}, ${brightness}, ${brightness + 5}, ${alpha * 0.5})`);
            gradient.addColorStop(0.7, `rgba(${brightness - 5}, ${brightness - 5}, ${brightness}, ${alpha * 0.2})`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(size, size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const cloud = new THREE.Mesh(geometry, material);

            // Spread at varying depths for parallax
            cloud.position.x = (Math.random() - 0.5) * 4000;
            cloud.position.y = (Math.random() - 0.5) * 2500;
            cloud.position.z = -500 - Math.random() * 2500;
            cloud.rotation.z = Math.random() * Math.PI;

            // Store animation properties
            cloud.userData = {
                driftSpeed: 0.00005 + Math.random() * 0.0001,
                pulsePhase: Math.random() * Math.PI * 2,
                baseOpacity: material.opacity,
            };

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        }

        console.log('[CosmicNoir] Nebula clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Black Planet - 3D Sphere with subtle texture and silver glow
    // ─────────────────────────────────────────────────────────────────────────

    createPlanet() {
        const planetSize = 180;

        // Create planet group for drifting
        this.planetGroup = new THREE.Group();
        this.scene.add(this.planetGroup);

        // Planet sphere with shader material
        const geometry = new THREE.SphereGeometry(planetSize, this.qualityPreset.planetDetail, this.qualityPreset.planetDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulseIntensity: { value: 0 },
                uGlowIntensity: { value: 1.0 },
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
        });

        this.planet = new THREE.Mesh(geometry, material);
        this.planet.renderOrder = 100;
        this.planetGroup.add(this.planet);

        // Create glow layers around the planet
        this.createPlanetGlowLayers(planetSize);

        console.log('[CosmicNoir] 3D Black Planet created');
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

    createAmbientParticles() {
        const particleCount = this.qualityPreset.ambientParticles;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            // Orbit around planet area
            const angle = Math.random() * Math.PI * 2;
            const radius = 200 + Math.random() * 600;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = (Math.random() - 0.5) * 400;
            positions[i3 + 2] = Math.sin(angle) * radius - 100;

            randoms[i] = Math.random();
            sizes[i] = 10.0 + Math.random() * 20.0; // Large, prominent particles
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.planetGroup.add(this.ambientParticles);

        console.log('[CosmicNoir] Ambient particles created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Atmosphere - Volumetric gas shell with explosion support
    // ─────────────────────────────────────────────────────────────────────────

    createAtmosphere() {
        // Create an atmosphere slightly larger than the planet
        const planetSize = 180;
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
        const poolSize = 6; // Number of overlapping bursts allowed
        const countPerSystem = Math.floor(this.qualityPreset.voidSparks / 2);

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
            0.15
        );
        this.composer.addPass(bloomPass);

        // Chromatic Aberration for cinematic effect
        const chromaticPass = new ShaderPass(ChromaticAberrationShader);
        chromaticPass.uniforms.uIntensity.value = 0.004;
        this.composer.addPass(chromaticPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        // Film Grain for noir cinema aesthetic
        this.filmGrainPass = new ShaderPass(FilmGrainShader);
        this.filmGrainPass.uniforms.uIntensity.value = 0.06;
        this.composer.addPass(this.filmGrainPass);

        console.log('[CosmicNoir] Post-processing configured (with chromatic aberration and film grain)');
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
        }

        if (this.starfield && this.starfield.material.uniforms) {
            this.starfield.material.uniforms.uTime.value = this.time;
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
                    // Move wave outwards
                    sparks.material.uniforms.uPulseTimer.value += delta * 12.0;

                    // Turn off when wave completes
                    if (sparks.material.uniforms.uPulseTimer.value > 75.0) {
                        sparks.material.uniforms.uPulseTimer.value = -100.0;
                    }
                }
            }
        }

        // Update film grain time
        if (this.filmGrainPass && this.filmGrainPass.uniforms) {
            this.filmGrainPass.uniforms.uTime.value = this.time;
        }

        // Slow drift planet across entire screen (Lissajous curves for organic movement)
        if (this.planetGroup) {
            const driftX = Math.sin(this.time * 0.025 + this.planetPhaseX) * 550 +
                Math.cos(this.time * 0.018 + this.planetPhaseX2) * 250;
            const driftY = Math.cos(this.time * 0.02 + this.planetPhaseY) * 350 +
                Math.sin(this.time * 0.012 + this.planetPhaseY2) * 150;

            this.planetGroup.position.x = driftX;
            this.planetGroup.position.y = driftY;

            // Gentle rotation
            this.planetGroup.rotation.z = Math.sin(this.time * 0.008) * 0.04;
        }

        // Slow camera orbit for parallax depth (independent of planet)
        if (this.camera) {
            const cameraTime = this.time * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 400; // Wide horizontal sway
            const orbitRadiusY = 300;  // Vertical sway range
            const orbitRadiusZ = 200;  // Depth breathing

            // Orbital sway - creates parallax with starfield/nebula
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX +
                Math.cos(cameraTime * 0.7) * orbitRadiusX * 0.4;
            this.camera.position.y = Math.cos(cameraTime * 0.8) * orbitRadiusY +
                Math.sin(cameraTime * 0.5) * orbitRadiusY * 0.3;
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
        for (const cloud of this.nebulaClouds) {
            cloud.position.x += cloud.userData.driftSpeed * 50;
            if (cloud.position.x > 2500) cloud.position.x = -2500;

            cloud.userData.pulsePhase += 0.003;
            const pulse = Math.sin(cloud.userData.pulsePhase) * 0.15 + 1.0;
            cloud.material.opacity = cloud.userData.baseOpacity * pulse;
        }

        // Slowly rotate starfield
        if (this.starfield) {
            this.starfield.rotation.y = this.time * 0.003;
            this.starfield.rotation.z = this.time * 0.001;
        }

        // Decay pulse intensity
        if (this.planetPulseIntensity > 0) {
            this.planetPulseIntensity *= 0.94;
            if (this.planetPulseIntensity < 0.01) this.planetPulseIntensity = 0;
        }

        // Update cosmic waves
        this.updateCosmicWaves(delta);

        // Update void orbs
        this.updateVoidOrbs(delta);

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

    createVoidOrb() {
        const geometry = new THREE.SphereGeometry(3 + Math.random() * 3, 8, 8);
        const brightness = 0.5 + Math.random() * 0.4;
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(brightness, brightness, brightness + 0.05),
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
        });

        const orb = new THREE.Mesh(geometry, material);
        orb.position.x = (Math.random() - 0.5) * 300;
        orb.position.y = -180;
        orb.position.z = (Math.random() - 0.5) * 200;

        orb.userData = {
            velocityY: 25 + Math.random() * 35,
            velocityX: (Math.random() - 0.5) * 8,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
        };

        this.planetGroup.add(orb);
        this.voidOrbs.push(orb);
    }

    updateVoidOrbs(delta) {
        for (let i = this.voidOrbs.length - 1; i >= 0; i--) {
            const orb = this.voidOrbs[i];
            orb.position.y += orb.userData.velocityY * delta;
            orb.position.x += orb.userData.velocityX * delta;
            orb.userData.life -= delta * 0.25;

            // Pulse
            orb.userData.pulsePhase += delta * 4;
            const pulse = Math.sin(orb.userData.pulsePhase) * 0.25 + 0.75;
            orb.material.opacity = orb.userData.life * pulse;

            if (orb.userData.life <= 0 || orb.position.y > 280) {
                this.planetGroup.remove(orb);
                orb.geometry.dispose();
                orb.material.dispose();
                this.voidOrbs.splice(i, 1);
            }
        }
    }

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
            // Trigger void spark burst - cycle through pool
            const sparks = this.voidSparks[this.voidSparkIndex];
            if (sparks && sparks.material.uniforms) {
                sparks.material.uniforms.uPulseTimer.value = 0.0;
            }
            // Cycle to next system in pool
            this.voidSparkIndex = (this.voidSparkIndex + 1) % this.voidSparks.length;

            // Trigger gas explosion on atmosphere
            this.gasExplosionTimer = 0.0;
            this.gasExplosionIntensity = Math.min(0.5 + comboCount * 0.15, 1.2);
        }

        // Create cosmic waves
        const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), 4);
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => this.createCosmicWave(comboCount), i * 100);
        }

        // Create void orbs for combos
        if (comboCount >= 2) {
            const orbCount = Math.min(comboCount * 2, 8);
            for (let i = 0; i < orbCount; i++) {
                setTimeout(() => this.createVoidOrb(), i * 50);
            }
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
        this.filmGrainPass = null;
        this.planet = null;
        this.planetGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.planetGlowLayers = [];
        this.atmosphere = null;
        this.cosmicWaves = [];
        this.voidOrbs = [];
        this.voidSparks = [];
        this.voidSparkIndex = 0;
        this.ambientParticles = null;

        super.stop();
    }
}
