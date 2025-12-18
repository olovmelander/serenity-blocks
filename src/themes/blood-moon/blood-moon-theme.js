/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌑 BLOOD MOON 🌑
 *  A Stunning 3D Blood Moon Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Deep 3D Starfield with twinkling white and red stars
 * - 3D Blood Moon sphere with procedural craters and pulsing crimson glow
 * - Multiple glow layers around the moon for intense atmosphere
 * - Drifting nebula clouds at varying depths
 * - Floating crimson particles throughout 3D space
 * - Gameplay effects: blood waves, crimson lightning, soul orbs
 * - Post-processing: Bloom + Vignette for atmospheric depth
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BLOOD_MOON_TETROMINOS } from './blood-moon-tetrominos.js';
import {
    moonVertexShader,
    moonFragmentShader,
    waveVertexShader,
    waveFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    starVertexShader,
    starFragmentShader,
} from './blood-moon-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 6000,
        nebulaCount: 25,
        ambientParticles: 400,
        bloomStrength: 0.6,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        moonDetail: 64,
        glowLayers: 8,
    },
    Ultra: {
        starCount: 5000,
        nebulaCount: 20,
        ambientParticles: 300,
        bloomStrength: 0.55,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        moonDetail: 56,
        glowLayers: 7,
    },
    High: {
        starCount: 4000,
        nebulaCount: 15,
        ambientParticles: 200,
        bloomStrength: 0.5,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        moonDetail: 48,
        glowLayers: 6,
    },
    Medium: {
        starCount: 2500,
        nebulaCount: 10,
        ambientParticles: 120,
        bloomStrength: 0.4,
        bloomRadius: 0.35,
        enablePostProcessing: true,
        moonDetail: 36,
        glowLayers: 5,
    },
    Low: {
        starCount: 1500,
        nebulaCount: 6,
        ambientParticles: 60,
        bloomStrength: 0.3,
        bloomRadius: 0.3,
        enablePostProcessing: false,
        moonDetail: 24,
        glowLayers: 4,
    },
    Minimal: {
        starCount: 800,
        nebulaCount: 4,
        ambientParticles: 30,
        bloomStrength: 0.25,
        bloomRadius: 0.25,
        enablePostProcessing: false,
        moonDetail: 16,
        glowLayers: 3,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.7 },
        offset: { value: 1.3 },
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
export default class BloodMoonTheme extends BaseTheme {
    constructor() {
        super('blood-moon');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.moon = null;
        this.moonGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.ambientParticles = null;
        this.moonGlowLayers = [];
        this.bloodWaves = [];
        this.soulOrbs = [];

        // Effect states
        this.moonPulseIntensity = 0;
        this.moonGlowIntensity = 1.0;
        this.comboMultiplier = 1.0;

        // Moon drift animation
        this.moonPhaseX = Math.random() * Math.PI * 2;
        this.moonPhaseY = Math.random() * Math.PI * 2;
        this.moonPhaseX2 = Math.random() * Math.PI * 2;
        this.moonPhaseY2 = Math.random() * Math.PI * 2;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.pendingComboCount = 0;

        console.log('[BloodMoon] Theme constructed');
    }

    getTetrominoConfig() {
        return BLOOD_MOON_TETROMINOS;
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
        console.log('[BloodMoon] Creating stunning 3D blood moon scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('blood-moon-theme');
        if (!container) {
            console.error('[BloodMoon] Container not found');
            return;
        }

        // Clear any existing content (old canvas)
        container.innerHTML = '';

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaClouds();
        this.createMoon();
        this.createAmbientParticles();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[BloodMoon] Scene created successfully');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x050005, 1); // Deep crimson-black
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0208, 0.0008); // Crimson fog

        // Camera positioned for depth
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000);
        this.camera.position.set(0, 0, 1200);
        this.camera.lookAt(0, 0, 0);

        // Crimson lighting from moon
        const moonLight = new THREE.PointLight(0xcc1a2e, 2, 3000);
        moonLight.position.set(0, 0, 0);
        this.scene.add(moonLight);

        // Subtle ambient
        const ambientLight = new THREE.AmbientLight(0x150508, 0.4);
        this.scene.add(ambientLight);

        // Resize handler
        window.addEventListener('resize', this.onWindowResize.bind(this));

        console.log('[BloodMoon] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Deep 3D stars with white and red tinting
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const phases = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xffeedd), // Warm white
            new THREE.Color(0xffcccc), // Light pink
            new THREE.Color(0xff9999), // Pink
            new THREE.Color(0xff6666), // Red tint
            new THREE.Color(0xcc3333), // Deep red
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Spread stars across a large 3D sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 1500 + Math.random() * 5000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 2000;

            // Color - mostly white with some red-tinted
            const colorIndex = Math.random() > 0.7
                ? Math.floor(2 + Math.random() * 4) // Red tints
                : Math.floor(Math.random() * 2); // White
            const color = starColors[colorIndex];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1.0 + Math.random() * 3.0;
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
        console.log('[BloodMoon] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Crimson/burgundy clouds at varying depths
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const cloudCount = this.qualityPreset.nebulaCount;

        for (let i = 0; i < cloudCount; i++) {
            const size = 800 + Math.random() * 1500;

            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Crimson/burgundy color palette
            const colorType = Math.random();
            let hue, sat, light;
            if (colorType < 0.4) {
                hue = 350 + Math.random() * 20; // Deep red
                sat = 70 + Math.random() * 20;
                light = 15 + Math.random() * 10;
            } else if (colorType < 0.7) {
                hue = 330 + Math.random() * 20; // Crimson
                sat = 60 + Math.random() * 25;
                light = 12 + Math.random() * 8;
            } else {
                hue = 310 + Math.random() * 20; // Dark magenta
                sat = 50 + Math.random() * 30;
                light = 10 + Math.random() * 10;
            }

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, 0.15)`);
            gradient.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.08)`);
            gradient.addColorStop(0.7, `hsla(${hue}, ${sat}%, ${light}%, 0.03)`);
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
                driftSpeed: 0.0001 + Math.random() * 0.0002,
                pulsePhase: Math.random() * Math.PI * 2,
                baseOpacity: material.opacity,
            };

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        }

        console.log('[BloodMoon] Nebula clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blood Moon - 3D Sphere with craters and intense glow
    // ─────────────────────────────────────────────────────────────────────────

    createMoon() {
        const moonSize = 180;

        // Create moon group for drifting
        this.moonGroup = new THREE.Group();
        this.scene.add(this.moonGroup);

        // Moon sphere with shader material
        const geometry = new THREE.SphereGeometry(moonSize, this.qualityPreset.moonDetail, this.qualityPreset.moonDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPulseIntensity: { value: 0 },
                uGlowIntensity: { value: 1.0 },
            },
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
        });

        this.moon = new THREE.Mesh(geometry, material);
        this.moon.renderOrder = 100;
        this.moonGroup.add(this.moon);

        // Create glow layers around the moon
        this.createMoonGlowLayers(moonSize);

        console.log('[BloodMoon] 3D Blood Moon created');
    }

    createMoonGlowLayers(moonSize) {
        const glowConfigs = [];
        const layerCount = this.qualityPreset.glowLayers;

        for (let i = 0; i < layerCount; i++) {
            const sizeMult = 1.3 + i * 0.25;
            const opacity = 0.35 - i * 0.04;
            glowConfigs.push({
                size: moonSize * sizeMult,
                color: i < 3 ? 0xcc1a2e : (i < 5 ? 0x8a0f1e : 0x500a12),
                opacity: Math.max(0.05, opacity),
                z: -5 * (i + 1),
            });
        }

        for (const config of glowConfigs) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.15, 'rgba(255, 200, 200, 0.8)');
            gradient.addColorStop(0.4, 'rgba(255, 100, 100, 0.4)');
            gradient.addColorStop(0.7, 'rgba(255, 50, 50, 0.15)');
            gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
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
            this.moonGlowLayers.push(glow);
            this.moonGroup.add(glow);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating crimson particles
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const particleCount = this.qualityPreset.ambientParticles;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            // Orbit around moon area
            const angle = Math.random() * Math.PI * 2;
            const radius = 200 + Math.random() * 600;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = (Math.random() - 0.5) * 400;
            positions[i3 + 2] = Math.sin(angle) * radius - 100;

            randoms[i] = Math.random();
            sizes[i] = 3.0 + Math.random() * 6.0;
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
        this.moonGroup.add(this.ambientParticles);

        console.log('[BloodMoon] Ambient particles created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) {
            console.log('[BloodMoon] Post-processing disabled for quality level');
            return;
        }

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.2
        );
        this.composer.addPass(bloomPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[BloodMoon] Post-processing configured');
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
        if (this.moon && this.moon.material.uniforms) {
            this.moon.material.uniforms.uTime.value = this.time;
            this.moon.material.uniforms.uPulseIntensity.value = this.moonPulseIntensity;
            this.moon.material.uniforms.uGlowIntensity.value = this.moonGlowIntensity;
        }

        if (this.starfield && this.starfield.material.uniforms) {
            this.starfield.material.uniforms.uTime.value = this.time;
        }

        if (this.ambientParticles && this.ambientParticles.material.uniforms) {
            this.ambientParticles.material.uniforms.uTime.value = this.time;
        }

        // Slow drift moon across scene
        if (this.moonGroup) {
            const driftX = Math.sin(this.time * 0.03 + this.moonPhaseX) * 200 +
                Math.cos(this.time * 0.02 + this.moonPhaseX2) * 100;
            const driftY = Math.cos(this.time * 0.025 + this.moonPhaseY) * 120 +
                Math.sin(this.time * 0.015 + this.moonPhaseY2) * 60;

            this.moonGroup.position.x = driftX;
            this.moonGroup.position.y = driftY + 50;

            // Gentle rotation
            this.moonGroup.rotation.z = Math.sin(this.time * 0.01) * 0.05;
        }

        // Pulse glow layers with moon pulse intensity
        const glowPulse = Math.sin(this.time * 2.0) * 0.15 + 1.0;
        for (const glow of this.moonGlowLayers) {
            const pulse = (1 + this.moonPulseIntensity * 0.5) * glowPulse;
            glow.material.opacity = glow.userData.baseOpacity * pulse;
        }

        // Nebula drift and pulse
        for (const cloud of this.nebulaClouds) {
            cloud.position.x += cloud.userData.driftSpeed * 50;
            if (cloud.position.x > 2500) cloud.position.x = -2500;

            cloud.userData.pulsePhase += 0.005;
            const pulse = Math.sin(cloud.userData.pulsePhase) * 0.2 + 1.0;
            cloud.material.opacity = cloud.userData.baseOpacity * pulse;
        }

        // Slowly rotate starfield
        if (this.starfield) {
            this.starfield.rotation.y = this.time * 0.005;
            this.starfield.rotation.z = this.time * 0.002;
        }

        // Decay pulse intensity
        if (this.moonPulseIntensity > 0) {
            this.moonPulseIntensity *= 0.95;
            if (this.moonPulseIntensity < 0.01) this.moonPulseIntensity = 0;
        }

        // Update blood waves
        this.updateBloodWaves(delta);

        // Update soul orbs
        this.updateSoulOrbs(delta);

        // Render
        this.renderer.clear();
        if (this.composer && this.qualityPreset.enablePostProcessing) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blood Waves - Expanding crimson torus rings
    // ─────────────────────────────────────────────────────────────────────────

    createBloodWave(intensity) {
        const geometry = new THREE.TorusGeometry(30, 2, 8, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: this.time },
                uOpacity: { value: 1.0 },
                uColor: { value: new THREE.Color(0xcc1a2e) },
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
            speed: 80 + intensity * 20,
            life: 1.0,
            maxLife: 1.0,
        };

        this.moonGroup.add(wave);
        this.bloodWaves.push(wave);
    }

    updateBloodWaves(delta) {
        for (let i = this.bloodWaves.length - 1; i >= 0; i--) {
            const wave = this.bloodWaves[i];
            wave.scale.addScalar(wave.userData.speed * delta * 0.1);
            wave.userData.life -= delta * 0.8;

            if (wave.material.uniforms) {
                wave.material.uniforms.uOpacity.value = wave.userData.life;
            }

            if (wave.userData.life <= 0) {
                this.moonGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.bloodWaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Soul Orbs - Glowing particles rising upward
    // ─────────────────────────────────────────────────────────────────────────

    createSoulOrb() {
        const geometry = new THREE.SphereGeometry(4 + Math.random() * 4, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff4060,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });

        const orb = new THREE.Mesh(geometry, material);
        orb.position.x = (Math.random() - 0.5) * 300;
        orb.position.y = -200;
        orb.position.z = (Math.random() - 0.5) * 200;

        orb.userData = {
            velocityY: 30 + Math.random() * 40,
            velocityX: (Math.random() - 0.5) * 10,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
        };

        this.moonGroup.add(orb);
        this.soulOrbs.push(orb);
    }

    updateSoulOrbs(delta) {
        for (let i = this.soulOrbs.length - 1; i >= 0; i--) {
            const orb = this.soulOrbs[i];
            orb.position.y += orb.userData.velocityY * delta;
            orb.position.x += orb.userData.velocityX * delta;
            orb.userData.life -= delta * 0.3;

            // Pulse
            orb.userData.pulsePhase += delta * 5;
            const pulse = Math.sin(orb.userData.pulsePhase) * 0.3 + 0.7;
            orb.material.opacity = orb.userData.life * pulse;

            if (orb.userData.life <= 0 || orb.position.y > 300) {
                this.moonGroup.remove(orb);
                orb.geometry.dispose();
                orb.material.dispose();
                this.soulOrbs.splice(i, 1);
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
        this.moonPulseIntensity = Math.min(this.moonPulseIntensity + 0.15, 0.5);
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
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.moonPulseIntensity = Math.min(0.6 + comboCount * 0.2, 1.5);

        // Create blood waves
        const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), 4);
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => this.createBloodWave(comboCount), i * 100);
        }

        // Create soul orbs for combos
        if (comboCount >= 2) {
            const orbCount = Math.min(comboCount * 2, 10);
            for (let i = 0; i < orbCount; i++) {
                setTimeout(() => this.createSoulOrb(), i * 50);
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
            const container = document.getElementById('blood-moon-theme');
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
        this.moon = null;
        this.moonGroup = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.moonGlowLayers = [];
        this.bloodWaves = [];
        this.soulOrbs = [];
        this.ambientParticles = null;

        super.stop();
    }
}
