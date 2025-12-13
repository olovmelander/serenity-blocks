/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ SUNSET THEME - Three.js 3D Edition ✧
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A stunning 3D sunset/sunrise experience with:
 * - Dynamic day-night cycle with magical golden hour colors
 * - Glowing 3D sun with corona effects
 * - Volumetric god rays
 * - Twinkling starfield that appears at night
 * - Floating ambient particles
 * - Gentle camera drift
 * - Lock piece and combo effects
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SUNSET_TETROMINOS } from './sunset-tetrominos.js';
import {
    skyVertexShader,
    skyFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    starVertexShader,
    starFragmentShader,
    godRayVertexShader,
    godRayFragmentShader,
    particleVertexShader,
    particleFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
    flareVertexShader,
    flareFragmentShader,
    horizonVertexShader,
    horizonFragmentShader,
    moonVertexShader,
    moonFragmentShader,
} from './sunset-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = {
    Extreme: {
        starCount: 4000,
        particleCount: 300,
        godRaySegments: 64,
        enablePostEffects: true,
    },
    Ultra: {
        starCount: 3000,
        particleCount: 200,
        godRaySegments: 48,
        enablePostEffects: true,
    },
    High: {
        starCount: 2000,
        particleCount: 150,
        godRaySegments: 32,
        enablePostEffects: true,
    },
    Medium: {
        starCount: 1200,
        particleCount: 100,
        godRaySegments: 24,
        enablePostEffects: true,
    },
    Low: {
        starCount: 600,
        particleCount: 50,
        godRaySegments: 16,
        enablePostEffects: false,
    },
    Minimal: {
        starCount: 300,
        particleCount: 25,
        godRaySegments: 12,
        enablePostEffects: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palette - Warm sunset tones
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = {
    // Dawn colors (early morning)
    dawn: {
        top: new THREE.Color(0x1a1a3e),    // Deep purple-blue
        mid: new THREE.Color(0xff6b8a),    // Rose pink
        bottom: new THREE.Color(0xffb347), // Warm orange
    },
    // Day colors (midday)
    day: {
        top: new THREE.Color(0x87ceeb),    // Sky blue
        mid: new THREE.Color(0xffecd2),    // Soft cream
        bottom: new THREE.Color(0xffd89b), // Golden glow
    },
    // Sunset colors (golden hour)
    sunset: {
        top: new THREE.Color(0x2d1b4e),    // Deep purple
        mid: new THREE.Color(0xff4500),    // Orange-red
        bottom: new THREE.Color(0xffd700), // Golden yellow
    },
    // Night colors
    night: {
        top: new THREE.Color(0x0a0a1a),    // Deep night blue
        mid: new THREE.Color(0x1a1a2e),    // Dark purple
        bottom: new THREE.Color(0x2d1b4e), // Purple horizon
    },
    // Sun colors
    sun: {
        core: new THREE.Color(0xffffff),     // Bright white core
        corona: new THREE.Color(0xffdd44),   // Golden corona
        edge: new THREE.Color(0xff6b1a),     // Orange edge
    },
    // God ray color
    godRays: new THREE.Color(0xffcc66),
    // Particle colors (embers/dust)
    particles: [
        new THREE.Color(0xffd700), // Gold
        new THREE.Color(0xff8c00), // Dark orange
        new THREE.Color(0xff6b6b), // Soft red
        new THREE.Color(0xffb347), // Light orange
    ],
    // Horizon
    horizon: {
        day: new THREE.Color(0x4a3728),   // Warm brown
        night: new THREE.Color(0x1a1a2e), // Dark blue
    },
    // Moon colors for night
    moon: {
        core: new THREE.Color(0xf5f5dc),    // Beige/cream moon
        glow: new THREE.Color(0xd4c4a8),    // Soft warm glow
        halo: new THREE.Color(0x6b5b4f),    // Subtle outer halo
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class SunsetTheme extends BaseTheme {
    constructor() {
        super('sunset');
        this.eventUnsubscribers = [];

        // Three.js core components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.sky = null;
        this.sun = null;
        this.sunGlowLayers = [];
        this.godRays = null;
        this.stars = null;
        this.particles = null;
        this.horizon = null;
        this.moon = null;
        this.moonGlowLayers = [];

        // Effects
        this.shockwaves = [];
        this.celestialFlares = [];

        // Moon position (opposite of sun)
        this.moonPosition = new THREE.Vector3(0, -30, -50);

        // Day-night cycle state
        this.dayProgress = 0.55; // Start at golden hour (0.5-0.75 is sunset)
        this.cycleSpeed = 0.005; // Full cycle takes ~200 seconds

        // Camera animation
        this.baseCameraPos = new THREE.Vector3(0, 0, 30);

        // Shared uniforms
        this.uniforms = {
            time: { value: 0 },
            dayProgress: { value: 0.55 },
            sunIntensity: { value: 1.0 },
        };

        // Sun position (moves based on day progress)
        this.sunPosition = new THREE.Vector3(0, 5, -50);

        // Quality settings
        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
        this.qualityChangeHandler = null;
    }

    getTetrominoConfig() {
        return SUNSET_TETROMINOS;
    }

    getCurrentQualityLevel() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!QUALITY_PRESETS[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = QUALITY_PRESETS[quality];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[Sunset3D] Initializing Three.js scene...');

        const container = document.getElementById('sunset-theme');
        if (!container) {
            console.error('[Sunset3D] Container not found');
            return;
        }

        // Clear any existing content
        container.innerHTML = '';

        // Apply quality settings
        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        this.setupQualityListener();

        // Initialize renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        container.appendChild(this.renderer.domElement);

        // Setup scene
        this.scene = new THREE.Scene();

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        this.camera.position.copy(this.baseCameraPos);
        this.camera.lookAt(0, 0, 0);

        // Main group for drifting elements
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create all scene elements
        this.createSky();
        this.createSun();
        this.createGodRays();
        this.createMoon();  // Beautiful moon for night
        this.createStars();
        this.createParticles();
        this.createHorizon();
        this.setupLighting();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.clock.start();
        this.animate();

        console.log('[Sunset3D] Scene initialized with', this.currentQuality, 'quality');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sky Dome
    // ─────────────────────────────────────────────────────────────────────────

    createSky() {
        const geometry = new THREE.SphereGeometry(500, 32, 32);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uDayProgress: this.uniforms.dayProgress,
                uSunPosition: { value: this.sunPosition },
            },
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            side: THREE.BackSide,
            depthWrite: false,
        });

        this.sky = new THREE.Mesh(geometry, material);
        this.scene.add(this.sky);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sun with Glow Layers
    // ─────────────────────────────────────────────────────────────────────────

    createSun() {
        // Main sun sphere
        const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
        const sunMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uIntensity: this.uniforms.sunIntensity,
                uCoreColor: { value: PALETTE.sun.core },
                uCoronaColor: { value: PALETTE.sun.corona },
                uEdgeColor: { value: PALETTE.sun.edge },
            },
            vertexShader: sunVertexShader,
            fragmentShader: sunFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sun.position.copy(this.sunPosition);
        this.mainGroup.add(this.sun);

        // Add glow layers (sprites)
        const glowTexture = this.createGlowTexture();
        const glowLayers = [
            { scale: 30, opacity: 0.6, color: PALETTE.sun.corona },
            { scale: 50, opacity: 0.35, color: PALETTE.sun.edge },
            { scale: 80, opacity: 0.15, color: new THREE.Color(0xff6600) },
        ];

        glowLayers.forEach((layer) => {
            const spriteMaterial = new THREE.SpriteMaterial({
                map: glowTexture,
                color: layer.color,
                transparent: true,
                opacity: layer.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(layer.scale, layer.scale, 1);
            sprite.position.copy(this.sunPosition);
            this.mainGroup.add(sprite);
            this.sunGlowLayers.push(sprite);
        });
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 220, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 150, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        return new THREE.CanvasTexture(canvas);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // God Rays
    // ─────────────────────────────────────────────────────────────────────────

    createGodRays() {
        const geometry = new THREE.PlaneGeometry(60, 60, 1, 1);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uIntensity: this.uniforms.sunIntensity,
                uColor: { value: PALETTE.godRays },
            },
            vertexShader: godRayVertexShader,
            fragmentShader: godRayFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.godRays = new THREE.Mesh(geometry, material);
        this.godRays.position.copy(this.sunPosition);
        this.godRays.position.z += 1; // Slightly in front of sun
        this.mainGroup.add(this.godRays);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield
    // ─────────────────────────────────────────────────────────────────────────

    createStars() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Star colors - whites, pale blues, pale yellows
        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xffeedd),
            new THREE.Color(0xddddff),
            new THREE.Color(0xffffee),
        ];

        for (let i = 0; i < count; i++) {
            // Spread stars on a hemisphere above
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.8); // Upper portion
            const radius = 300 + Math.random() * 100;

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.cos(phi) + 50; // Bias upward
            positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            sizes[i] = 0.5 + Math.random() * 2.0;
            phases[i] = Math.random() * Math.PI * 2;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uDayProgress: this.uniforms.dayProgress,
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.stars = new THREE.Points(geometry, material);
        this.scene.add(this.stars); // Stars in background scene
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles (dust motes, embers)
    // ─────────────────────────────────────────────────────────────────────────

    createParticles() {
        const count = this.activePreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Spread particles in view
            positions[i * 3] = (Math.random() - 0.5) * 80;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 60 - 10;

            sizes[i] = 1 + Math.random() * 3;
            phases[i] = Math.random();

            const color = PALETTE.particles[Math.floor(Math.random() * PALETTE.particles.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.particles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.particles);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Horizon
    // ─────────────────────────────────────────────────────────────────────────

    createHorizon() {
        const geometry = new THREE.PlaneGeometry(400, 100, 1, 1);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uDayProgress: this.uniforms.dayProgress,
                uDayColor: { value: PALETTE.horizon.day },
                uNightColor: { value: PALETTE.horizon.night },
            },
            vertexShader: horizonVertexShader,
            fragmentShader: horizonFragmentShader,
            transparent: true,
            depthWrite: false,
        });

        this.horizon = new THREE.Mesh(geometry, material);
        this.horizon.position.set(0, -30, -80);
        this.horizon.rotation.x = -0.1;
        this.mainGroup.add(this.horizon);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Moon - Beautiful glowing moon for night
    // ─────────────────────────────────────────────────────────────────────────

    createMoon() {
        // Create moon sphere with crater shader
        const moonGeometry = new THREE.SphereGeometry(8, 48, 48);
        const moonMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uOpacity: { value: 0 },  // Start hidden, fade in at night
            },
            vertexShader: moonVertexShader,
            fragmentShader: moonFragmentShader,
            transparent: true,
            depthWrite: false,
        });

        this.moon = new THREE.Mesh(moonGeometry, moonMaterial);
        this.moon.position.copy(this.moonPosition);
        this.mainGroup.add(this.moon);

        // Create glow layers for moon
        const glowTexture = this.createMoonGlowTexture();
        const glowLayers = [
            { scale: 22, opacity: 0.4, color: PALETTE.moon.core },
            { scale: 38, opacity: 0.2, color: PALETTE.moon.glow },
            { scale: 60, opacity: 0.08, color: PALETTE.moon.halo },
        ];

        glowLayers.forEach((layer, index) => {
            const spriteMaterial = new THREE.SpriteMaterial({
                map: glowTexture,
                color: layer.color,
                transparent: true,
                opacity: 0,  // Start hidden
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(layer.scale, layer.scale, 1);
            sprite.position.copy(this.moonPosition);
            sprite.userData = { baseOpacity: layer.opacity, index };
            this.mainGroup.add(sprite);
            this.moonGlowLayers.push(sprite);
        });
    }

    createMoonGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(245, 245, 220, 1)');    // Beige center
        gradient.addColorStop(0.3, 'rgba(212, 196, 168, 0.6)'); // Soft glow
        gradient.addColorStop(0.6, 'rgba(107, 91, 79, 0.2)');   // Subtle halo
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        return new THREE.CanvasTexture(canvas);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Warm ambient light
        const ambient = new THREE.AmbientLight(0xffd89b, 0.3);
        this.scene.add(ambient);

        // Sun directional light
        const sunLight = new THREE.DirectionalLight(0xffcc66, 0.8);
        sunLight.position.copy(this.sunPosition);
        this.scene.add(sunLight);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        // Update uniforms
        this.uniforms.time.value = elapsed;

        // Progress day-night cycle
        this.dayProgress = (this.dayProgress + this.cycleSpeed * delta) % 1.0;
        this.uniforms.dayProgress.value = this.dayProgress;

        // Update sun position based on day progress
        this.updateSunPosition();

        // Decay sun intensity back to normal
        if (this.uniforms.sunIntensity.value > 1.0) {
            this.uniforms.sunIntensity.value = THREE.MathUtils.lerp(
                this.uniforms.sunIntensity.value,
                1.0,
                delta * 2.0
            );
        }

        // Camera drift
        this.updateCameraDrift(elapsed);

        // Update effects
        this.updateShockwaves(delta);
        this.updateCelestialFlares(delta);

        // Rotate stars slowly
        if (this.stars) {
            this.stars.rotation.y = elapsed * 0.005;
        }

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    updateSunPosition() {
        // Sun traces a proper arc across the sky and below the horizon
        // The arc goes from east (dawn) to west (sunset) and dips below at night
        // dayProgress: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1 = midnight

        const angle = this.dayProgress * Math.PI * 2 - Math.PI * 0.5;
        const x = Math.cos(angle) * 50;  // Horizontal sweep

        // Y position: peaks at noon (dayProgress=0.5), dips far below at night
        // Using sin of angle gives us: -1 at midnight, +1 at noon
        // Scale and offset so: noon = +30, midnight = -60 (well below horizon at -30)
        const y = Math.sin(angle) * 45 - 10;

        this.sunPosition.set(x, y, -50);

        // Update sun mesh and glow layers
        if (this.sun) {
            this.sun.position.copy(this.sunPosition);
        }
        this.sunGlowLayers.forEach((sprite) => {
            sprite.position.copy(this.sunPosition);
        });
        if (this.godRays) {
            this.godRays.position.copy(this.sunPosition);
            this.godRays.position.z += 1;
        }

        // Update sky shader uniform
        if (this.sky?.material?.uniforms?.uSunPosition) {
            this.sky.material.uniforms.uSunPosition.value.copy(this.sunPosition);
        }

        // Calculate sun visibility - fades as it approaches horizon
        // Horizon is around Y = -30, fade starts at Y = 0
        const sunVisibility = THREE.MathUtils.clamp((y + 30) / 40, 0, 1);

        if (this.sun) {
            this.sun.material.opacity = sunVisibility;
            this.sun.visible = sunVisibility > 0.01;
        }
        this.sunGlowLayers.forEach((sprite) => {
            const baseOpacity = sprite.userData?.baseOpacity || 0.5;
            sprite.material.opacity = baseOpacity * sunVisibility;
        });
        if (this.godRays) {
            this.godRays.material.uniforms.uIntensity.value = sunVisibility;
            this.godRays.visible = sunVisibility > 0.05;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Moon - rises from bottom during deep night
        // Moon appears later than sun disappears, peaking around midnight
        // ─────────────────────────────────────────────────────────────────────

        // Moon angle: offset so it peaks at midnight (dayProgress = 0 or 1)
        // When dayProgress = 0 (midnight), moonAngle should give max Y
        const moonAngle = (this.dayProgress + 0.5) * Math.PI * 2 - Math.PI * 0.5;
        const moonX = Math.cos(moonAngle) * 35;

        // Moon Y: starts much lower (-80), peaks at +25 around midnight
        // This makes the moon rise from below the screen
        const moonY = Math.sin(moonAngle) * 50 - 25;

        this.moonPosition.set(moonX, moonY, -70);

        // Moon visibility - only visible when above horizon AND sun is down
        // Horizon is around Y = -30
        const moonAboveHorizon = THREE.MathUtils.clamp((moonY + 35) / 50, 0, 1);
        const sunDown = 1 - sunVisibility;
        const moonVisibility = sunDown * moonAboveHorizon;

        if (this.moon) {
            this.moon.position.copy(this.moonPosition);
            // Update shader uniform for opacity
            if (this.moon.material.uniforms?.uOpacity) {
                this.moon.material.uniforms.uOpacity.value = moonVisibility * 0.95;
            }
            this.moon.visible = moonVisibility > 0.01;
        }
        this.moonGlowLayers.forEach((sprite) => {
            sprite.position.copy(this.moonPosition);
            const baseOpacity = sprite.userData?.baseOpacity || 0.3;
            sprite.material.opacity = baseOpacity * moonVisibility;
        });
    }

    updateCameraDrift(elapsed) {
        if (!this.camera) return;

        // "Smart" organic floating motion using Sum of Sines
        // Combines multiple non-harmonic frequencies to avoid obvious repetition
        const t = elapsed * 0.15; // Global speed factor

        // X Axis: Wide gentle drift + subtle variation
        const floatX =
            Math.sin(t * 1.0) * 1.5 +      // Primary sway (was 2.5)
            Math.cos(t * 0.42) * 0.8 +     // Secondary drift (was 1.5)
            Math.sin(t * 2.3) * 0.2;       // Subtle jitter (was 0.3)

        // Y Axis: Breathing vertical motion
        const floatY =
            Math.cos(t * 0.85) * 0.8 +     // Primary breathe (was 1.5)
            Math.sin(t * 0.31) * 0.5 +     // Secondary drift (was 1.0)
            Math.cos(t * 1.7) * 0.1;       // Subtle bob (was 0.2)

        // Z Axis: Depth breathing
        const floatZ =
            Math.sin(t * 0.55) * 0.8 +     // Primary push/pull (was 1.5)
            Math.cos(t * 1.3) * 0.3;       // Secondary variation (was 0.5)

        this.camera.position.x = this.baseCameraPos.x + floatX;
        this.camera.position.y = this.baseCameraPos.y + floatY;
        this.camera.position.z = this.baseCameraPos.z + floatZ;

        // Smart LookAt: Target moves slightly out of phase to create "stabilized" feel
        const targetX = Math.sin(t * 0.7 + 1.0) * 1.5 + Math.cos(t * 0.2) * 1.0;
        const targetY = Math.cos(t * 0.6 + 0.5) * 1.0 + Math.sin(t * 0.3) * 0.8;

        this.camera.lookAt(targetX, targetY, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effects: Shockwaves (Combo)
    // ─────────────────────────────────────────────────────────────────────────

    createShockwave(intensity, position = this.sunPosition, color = PALETTE.particles[0]) {
        const geometry = new THREE.RingGeometry(0.5, 1.0, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 1.0 },
                uColor: { value: new THREE.Color(color) },
            },
            vertexShader: shockwaveVertexShader,
            fragmentShader: shockwaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.position.copy(position);
        wave.position.z += 5;
        wave.rotation.x = Math.random() * 0.3;
        wave.rotation.y = Math.random() * 0.3;

        wave.userData = {
            speed: 15 + intensity * 5,
            life: 1.0,
            maxLife: 1.0,
        };

        this.mainGroup.add(wave);
        this.shockwaves.push(wave);
    }

    updateShockwaves(delta) {
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.userData.life -= delta;

            // Expand
            const expansion = wave.userData.speed * delta;
            wave.scale.x += expansion;
            wave.scale.y += expansion;

            // Fade
            wave.material.uniforms.uOpacity.value = wave.userData.life / wave.userData.maxLife;

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effects: Celestial Flares (Piece Lock)
    // ─────────────────────────────────────────────────────────────────────────

    createCelestialFlare(position = this.sunPosition, color = PALETTE.particles[0]) {
        const particleCount = 30;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const phases = new Float32Array(particleCount);

        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        for (let i = 0; i < particleCount; i++) {
            // Start at source position
            positions[i * 3] = position.x + (Math.random() - 0.5) * 4;
            positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 4;
            positions[i * 3 + 2] = position.z + 5;

            phases[i] = Math.random();

            const speed = 10 + Math.random() * 15;
            const spread = 0.5;
            velocities.push({
                x: dirX * speed + (Math.random() - 0.5) * spread * speed,
                y: dirY * speed + (Math.random() - 0.5) * spread * speed,
                z: (Math.random() - 0.5) * 5,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.PointsMaterial({
            color: new THREE.Color(color),
            size: 3,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const flare = new THREE.Points(geometry, material);
        flare.userData = {
            velocities,
            life: 0.8,
            maxLife: 0.8,
        };

        this.mainGroup.add(flare);
        this.celestialFlares.push(flare);
    }

    updateCelestialFlares(delta) {
        for (let i = this.celestialFlares.length - 1; i >= 0; i--) {
            const flare = this.celestialFlares[i];
            flare.userData.life -= delta;

            const positions = flare.geometry.attributes.position.array;
            const velocities = flare.userData.velocities;

            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * delta;
                positions[j * 3 + 1] += velocities[j].y * delta;
                positions[j * 3 + 2] += velocities[j].z * delta;
            }
            flare.geometry.attributes.position.needsUpdate = true;

            // Fade
            flare.material.opacity = flare.userData.life / flare.userData.maxLife;

            if (flare.userData.life <= 0) {
                this.mainGroup.remove(flare);
                flare.geometry.dispose();
                flare.material.dispose();
                this.celestialFlares.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            this.onLineClear(data.lineCount);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            this.onCombo(data.comboCount);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (!this.isActive) return;
            this.onPieceLock();
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        const { isSun, position, color } = this.getActiveCelestialBody();

        // Boost intensity
        if (isSun) {
            this.uniforms.sunIntensity.value += lineCount * 0.3;
        } else if (this.moon && this.moon.material.uniforms?.uOpacity) {
            // Pulse moon opacity
            this.moon.material.uniforms.uOpacity.value += 0.3;
        }

        // Create shockwave for multi-line clears
        if (lineCount >= 2) {
            this.createShockwave(lineCount, position, color);
        }
    }

    onCombo(comboCount) {
        if (comboCount >= 2) {
            const { isSun, position, color } = this.getActiveCelestialBody();

            if (isSun) {
                this.uniforms.sunIntensity.value += 0.2;
            } else if (this.moon && this.moon.material.uniforms?.uOpacity) {
                this.moon.material.uniforms.uOpacity.value += 0.2;
            }

            this.createShockwave(comboCount * 0.5, position, color);
        }
    }

    onPieceLock() {
        const { isSun, position, color } = this.getActiveCelestialBody();

        // Small pulse
        if (isSun) {
            this.uniforms.sunIntensity.value += 0.1;
        } else if (this.moon && this.moon.material.uniforms?.uOpacity) {
            this.moon.material.uniforms.uOpacity.value += 0.1;
        }

        // Celestial flare burst
        this.createCelestialFlare(position, color);
    }

    // Helper to determine whether effects should happen on Sun or Moon
    getActiveCelestialBody() {
        // Sun is dominant during day (0.2 - 0.8)
        // Moon is dominant at night
        const isSun = this.dayProgress > 0.2 && this.dayProgress < 0.8;

        if (isSun) {
            return {
                isSun: true,
                position: this.sunPosition,
                color: PALETTE.particles[0], // Gold/Orange
            };
        } else {
            return {
                isSun: false,
                position: this.moonPosition,
                color: 0xd4c4a8, // Moon glow color
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Quality & Resize
    // ─────────────────────────────────────────────────────────────────────────

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (newQuality && newQuality !== this.currentQuality) {
                this.applyQualityPreset(newQuality);
            }
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        super.stop();

        this.teardownQualityListener();
        window.removeEventListener('resize', this.onWindowResize.bind(this));

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Unsubscribe event listeners
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Dispose shockwaves
        this.shockwaves.forEach((wave) => {
            this.mainGroup?.remove(wave);
            wave.geometry?.dispose();
            wave.material?.dispose();
        });
        this.shockwaves = [];

        // Dispose solar flares
        this.celestialFlares.forEach((flare) => {
            this.mainGroup?.remove(flare);
            flare.geometry?.dispose();
            flare.material?.dispose();
        });
        this.celestialFlares = [];

        // Dispose sun glow layers
        this.sunGlowLayers.forEach((sprite) => {
            this.mainGroup?.remove(sprite);
            sprite.material?.dispose();
        });
        this.sunGlowLayers = [];

        // Dispose moon glow layers
        this.moonGlowLayers.forEach((sprite) => {
            this.mainGroup?.remove(sprite);
            sprite.material?.dispose();
        });
        this.moonGlowLayers = [];

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('sunset-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Dispose all scene objects
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

        // Null references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.sky = null;
        this.sun = null;
        this.moon = null;
        this.godRays = null;
        this.stars = null;
        this.particles = null;
        this.horizon = null;

        console.log('[Sunset3D] Theme stopped and cleaned up');
    }
}
