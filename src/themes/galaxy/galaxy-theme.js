import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { COLS } from '../../core/constants.js';
import { GALAXY_TETROMINOS } from './galaxy-tetrominos.js';
import {
    spiralVertexShader,
    spiralFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
    dustVertexShader,
    dustFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    sparkVertexShader,
    sparkFragmentShader,
} from './galaxy-shaders.js';

/**
 * Galaxy Theme - An immersive 3D cosmic experience using Three.js
 *
 * Features:
 * - Central spiral galaxy with glowing core
 * - Thousands of stars in spiral arm formation
 * - Deep background starfield with twinkling
 * - Volumetric nebula clouds
 * - Floating cosmic dust particles
 * - Dynamic game event effects (shockwaves, particle bursts)
 * - Slow drift animation for immersive depth
 */
export default class GalaxyTheme extends BaseTheme {
    constructor() {
        super('galaxy');
        this.eventUnsubscribers = [];
        this.boundResizeHandler = this.onWindowResize.bind(this);
        this.effectTimeouts = new Set();

        this.cameraBasePosition = { x: 0, y: 4, z: 17 };
        this.cameraMotion = {
            horizontal: 4.5,
            vertical: 1.8,
            depth: 8.5,
            lookAtX: 1.5,
        };

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null; // Container for drifting elements
        this.coreSprites = [];
        this.spiralStars = null;
        this.backgroundStars = null;
        this.nebulaClouds = [];
        this.cosmicDust = null;
        this.shockwaves = [];
        this.flares = [];
        this.spiralSparks = null;
        this.coreLight = null;

        // Multiple stacking pulse waves
        this.MAX_PULSES = 8;
        this.pulseSlots = Array(this.MAX_PULSES).fill(null).map(() => ({ active: false, timer: -100.0 }));
        this.currentPulseSlot = 0;
        this.lastAccentSide = 1;

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // Uniforms for shader animation
        this.uniforms = {
            time: { value: 0 },
            coreIntensity: { value: 1.0 },
            coreColorPrimary: { value: new THREE.Color(0xFF33CC) }, // Magenta/Pink
            coreColorSecondary: { value: new THREE.Color(0x3399FF) }, // Bright Blue
            coreColorTertiary: { value: new THREE.Color(0x9933FF) }, // Purple
            uLockGlow: { value: 0.0 },
            uLockSparkle: { value: 0.0 },
            uLockStarBoost: { value: 0.0 },
            uLockDustBoost: { value: 0.0 },
            uLockNebulaBoost: { value: 0.0 },
            uLockDirection: { value: new THREE.Vector3(0, 0, 0) },
        };

        this.lockFx = {
            core: 0,
            haloLight: 0,
            arms: 0,
            sparkle: 0,
            stars: 0,
            nebula: 0,
            dust: 0,
            parallax: 0,
            accent: 0,
            direction: new THREE.Vector3(0, 0, 0),
        };
        this.lockFxCaps = {
            core: 1.0,
            haloLight: 1.0,
            arms: 1.0,
            sparkle: 1.0,
            stars: 1.0,
            nebula: 1.0,
            dust: 1.0,
            parallax: 1.0,
            accent: 1.0,
        };
        this.lockFxDecay = {
            core: 6.5,
            haloLight: 8.0,
            arms: 5.5,
            sparkle: 10.0,
            stars: 7.0,
            nebula: 5.2,
            dust: 5.6,
            parallax: 12.0,
            accent: 9.5,
        };
        this.coreLightBaseIntensity = 2.0;
        this.baseCoreOpacities = [0.95, 0.8, 0.5, 0.3];
        this.baseCoreScales = [5, 10, 18, 25];

        // Theme palette for effects
        this.palette = [
            new THREE.Color(0xFF33CC), // Magenta
            new THREE.Color(0x3399FF), // Blue
            new THREE.Color(0x9933FF), // Purple
            new THREE.Color(0xFF66AA), // Pink
            new THREE.Color(0x66CCFF), // Cyan
            new THREE.Color(0xFFFFFF), // White
        ];
    }

    scheduleEffectTimeout(callback, delayMs = 0) {
        const timeoutId = window.setTimeout(() => {
            this.effectTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.effectTimeouts.add(timeoutId);
        return timeoutId;
    }

    clearEffectTimeouts() {
        this.effectTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.effectTimeouts.clear();
    }

    getRandomThemeColor() {
        return this.palette[Math.floor(Math.random() * this.palette.length)];
    }

    async createScene() {
        console.log('[Galaxy] Initializing Three.js scene...');

        const container = document.getElementById('galaxy-theme');
        if (!container) {
            console.error('[Galaxy] Container not found');
            return;
        }

        // Clean up any existing content
        container.innerHTML = '';

        // -- Setup Scene --
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050011, 0.008);

        // -- Setup Camera --
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000,
        );
        this.camera.position.set(
            this.cameraBasePosition.x,
            this.cameraBasePosition.y,
            this.cameraBasePosition.z,
        );
        this.camera.lookAt(0, 0, 0);

        // -- Setup Renderer --
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);

        // -- Create Main Group for Drifting --
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // -- Create Scene Elements --
        this.createGalaxyCore();
        this.createSpiralArms();
        this.createSpiralSparks();
        this.createBackgroundStars();
        this.createNebulaClouds();
        this.createCosmicDust();
        this.setupLighting();

        // -- Event Listeners --
        this.setupEventListeners();
        window.addEventListener('resize', this.boundResizeHandler);

        // -- Start Animation --
        this.animate();

        console.log('[Galaxy] Scene initialized.');
    }

    createGalaxyCore() {
        // Create multiple layered glow sprites for a diffuse, bright center
        // No solid sphere - just pure glow like in real galaxy images

        this.coreSprites = [];

        // Inner bright white/pink core glow
        const coreGlowTexture = this.createCoreGlowTexture();

        // Layer 1: Bright white/pink center
        const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: coreGlowTexture,
            color: 0xFFFFFF,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        innerGlow.scale.set(5, 5, 1);
        innerGlow.userData = { baseScale: 5, baseOpacity: 0.95 };
        this.mainGroup.add(innerGlow);
        this.coreSprites.push(innerGlow);

        // Layer 2: Pink/magenta mid glow
        const midGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: coreGlowTexture,
            color: 0xFF66CC,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        midGlow.scale.set(10, 10, 1);
        midGlow.userData = { baseScale: 10, baseOpacity: 0.8 };
        this.mainGroup.add(midGlow);
        this.coreSprites.push(midGlow);

        // Layer 3: Purple outer glow
        const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: coreGlowTexture,
            color: 0x9933FF,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        outerGlow.scale.set(18, 18, 1);
        outerGlow.userData = { baseScale: 18, baseOpacity: 0.5 };
        this.mainGroup.add(outerGlow);
        this.coreSprites.push(outerGlow);

        // Layer 4: Blue diffuse halo
        const haloGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: coreGlowTexture,
            color: 0x3366FF,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        haloGlow.scale.set(25, 25, 1);
        haloGlow.userData = { baseScale: 25, baseOpacity: 0.3 };
        this.mainGroup.add(haloGlow);
        this.coreSprites.push(haloGlow);

        // Tilt the main group to show galaxy at an angle (like the reference)
        this.mainGroup.rotation.x = 0.6; // Tilt forward
        this.mainGroup.rotation.z = -0.2; // Slight rotation
    }

    createCoreGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Soft radial gradient for glow
        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.1, 'rgba(255, 220, 255, 0.9)');
        gradient.addColorStop(0.3, 'rgba(255, 150, 220, 0.5)');
        gradient.addColorStop(0.5, 'rgba(200, 100, 255, 0.25)');
        gradient.addColorStop(0.7, 'rgba(100, 80, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        return new THREE.CanvasTexture(canvas);
    }

    createGlowTexture() {
        // Keep for compatibility with effects
        return this.createCoreGlowTexture();
    }

    createSpiralArms() {
        // More particles for denser spiral arms like in reference
        const particleCount = 16000;
        const geometry = new THREE.BufferGeometry();

        const angles = new Float32Array(particleCount);
        const radii = new Float32Array(particleCount);
        const randoms = new Float32Array(particleCount);
        const colors = new Float32Array(particleCount * 3);
        const positions = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            // Create 2 main spiral arms with some secondary structure
            const arm = i % 2;
            const baseAngle = arm * Math.PI;

            // Radius distribution - exponential falloff from center
            const t = Math.random();
            const radius = 0.5 + t ** 0.4 * 16; // Start closer to center

            // Spiral tightness increases with radius
            const spiralOffset = radius * 0.35;

            // Add randomness/spread to make arms fuzzy
            const spreadAngle = (Math.random() - 0.5) * (0.3 + radius * 0.02);

            angles[i] = baseAngle + spiralOffset + spreadAngle;
            radii[i] = radius;
            randoms[i] = Math.random();

            // Color gradient: white/pink center → magenta mid → purple/blue outer
            const colorT = Math.min(radius / 14, 1.0);
            let color;
            if (colorT < 0.2) {
                // Inner: bright white/pink
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0xFFFFFF),
                    new THREE.Color(0xFFAADD),
                    colorT / 0.2,
                );
            } else if (colorT < 0.5) {
                // Mid: pink to magenta
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0xFFAADD),
                    new THREE.Color(0xCC44FF),
                    (colorT - 0.2) / 0.3,
                );
            } else {
                // Outer: magenta to purple/blue
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0xCC44FF),
                    new THREE.Color(0x6633CC),
                    (colorT - 0.5) / 0.5,
                );
            }

            // Add some brightness variation
            const brightness = 0.7 + Math.random() * 0.3;
            colors[i * 3] = color.r * brightness;
            colors[i * 3 + 1] = color.g * brightness;
            colors[i * 3 + 2] = color.b * brightness;

            // Placeholder positions
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
        geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        // Create array of pulse timers for stacking effect
        const pulseTimers = new Array(this.MAX_PULSES).fill(-100.0);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                spiralTightness: { value: 0.5 },
                coreIntensity: this.uniforms.coreIntensity,
                uPulseTimers: { value: pulseTimers },
                uPulseCount: { value: this.MAX_PULSES },
                uLockGlow: this.uniforms.uLockGlow,
                uLockDirection: this.uniforms.uLockDirection,
            },
            vertexShader: spiralVertexShader,
            fragmentShader: spiralFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.spiralStars = new THREE.Points(geometry, material);
        this.mainGroup.add(this.spiralStars);
    }

    createSpiralSparks() {
        // More particles for impressive combo effects
        const count = 100000;
        const geometry = new THREE.BufferGeometry();

        const angles = new Float32Array(count);
        const radii = new Float32Array(count);
        const randoms = new Float32Array(count);
        const randomDirs = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Similar distribution to stars so they emerge from the arms
            const arm = i % 2;
            const baseAngle = arm * Math.PI;

            // Random radius logic
            const t = Math.random();
            const radius = 0.5 + t ** 0.4 * 16;

            const spiralOffset = radius * 0.35;
            const spreadAngle = (Math.random() - 0.5) * (0.3 + radius * 0.02);

            angles[i] = baseAngle + spiralOffset + spreadAngle;
            radii[i] = radius;
            randoms[i] = Math.random();

            // Random Direction for shooting out
            // We want mostly outward but with chaos
            const rTheta = Math.random() * Math.PI * 2;
            const rPhi = Math.random() * Math.PI;
            randomDirs[i * 3] = Math.sin(rPhi) * Math.cos(rTheta);
            randomDirs[i * 3 + 1] = Math.sin(rPhi) * Math.sin(rTheta);
            randomDirs[i * 3 + 2] = Math.cos(rPhi);

            // Colors: mix of hot white, cyan, and pink
            const colorType = Math.random();
            let c = new THREE.Color(0xFFFFFF); // White hot
            if (colorType > 0.6) c = new THREE.Color(0x33FFFF); // Cyan
            else if (colorType > 0.3) c = new THREE.Color(0xFF33CC); // Pink

            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;

            // Zero pos (handled in vertex shader)
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
        geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aRandomDir', new THREE.BufferAttribute(randomDirs, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        // Create array of pulse timers for stacking effect
        const pulseTimers = new Array(this.MAX_PULSES).fill(-100.0);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                spiralTightness: { value: 0.5 },
                uPulseTimers: { value: pulseTimers },
                uPulseCount: { value: this.MAX_PULSES },
                uLockSparkle: this.uniforms.uLockSparkle,
                uLockDirection: this.uniforms.uLockDirection,
            },
            vertexShader: sparkVertexShader,
            fragmentShader: sparkFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.spiralSparks = new THREE.Points(geometry, material);
        this.mainGroup.add(this.spiralSparks);
    }

    createBackgroundStars() {
        const starCount = 3000;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(starCount * 3);
        const randoms = new Float32Array(starCount);
        const colors = new Float32Array(starCount * 3);

        const colorOptions = [
            new THREE.Color(0xFFFFFF),
            new THREE.Color(0xCCDDFF),
            new THREE.Color(0xFFCCFF),
            new THREE.Color(0xCCFFFF),
            new THREE.Color(0xFFFFCC),
        ];

        for (let i = 0; i < starCount; i++) {
            // Distribute in a large sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 40 + Math.random() * 60;

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = radius * Math.cos(phi);

            randoms[i] = Math.random();

            const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                uLockStarBoost: this.uniforms.uLockStarBoost,
                uLockDirection: this.uniforms.uLockDirection,
            },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.backgroundStars = new THREE.Points(geometry, material);
        this.scene.add(this.backgroundStars);
    }

    createNebulaClouds() {
        const nebulaConfigs = [
            {
                position: [-8, 3, -15], scale: 15, colorA: 0xFF33CC, colorB: 0x9933FF, opacity: 0.3,
            },
            {
                position: [10, -2, -18], scale: 18, colorA: 0x3399FF, colorB: 0x66CCFF, opacity: 0.25,
            },
            {
                position: [0, 5, -25], scale: 22, colorA: 0x9933FF, colorB: 0x3399FF, opacity: 0.2,
            },
            {
                position: [-12, -4, -20], scale: 14, colorA: 0xFF66AA, colorB: 0xFF33CC, opacity: 0.25,
            },
        ];

        nebulaConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.scale, config.scale);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    opacity: { value: config.opacity },
                    colorA: { value: new THREE.Color(config.colorA) },
                    colorB: { value: new THREE.Color(config.colorB) },
                    uLockNebulaBoost: this.uniforms.uLockNebulaBoost,
                    uLockDirection: this.uniforms.uLockDirection,
                },
                vertexShader: nebulaVertexShader,
                fragmentShader: nebulaFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const cloud = new THREE.Mesh(geometry, material);
            cloud.position.set(...config.position);
            cloud.rotation.z = Math.random() * Math.PI;

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        });
    }

    createCosmicDust() {
        const dustCount = 200;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(dustCount * 3);
        const randoms = new Float32Array(dustCount);
        const sizes = new Float32Array(dustCount);

        for (let i = 0; i < dustCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 15;

            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 4;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            randoms[i] = Math.random();
            sizes[i] = 2 + Math.random() * 4;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                color: { value: new THREE.Color(0x66CCFF) },
                uLockDustBoost: this.uniforms.uLockDustBoost,
                uLockDirection: this.uniforms.uLockDirection,
            },
            vertexShader: dustVertexShader,
            fragmentShader: dustFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.cosmicDust = new THREE.Points(geometry, material);
        this.mainGroup.add(this.cosmicDust);
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x202040, 0.5);
        this.scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xFF66CC, this.coreLightBaseIntensity, 50);
        pointLight.position.set(0, 0, 0);
        this.mainGroup.add(pointLight);
        this.coreLight = pointLight;
    }

    addLockFx(changes) {
        Object.entries(changes).forEach(([key, amount]) => {
            if (!(key in this.lockFx) || !Number.isFinite(amount)) return;
            const cap = this.lockFxCaps[key] ?? 1.0;
            this.lockFx[key] = Math.min(cap, this.lockFx[key] + amount);
        });
    }

    updateLockFx(delta) {
        Object.entries(this.lockFxDecay).forEach(([key, decay]) => {
            const current = this.lockFx[key];
            if (current <= 0.0001) {
                this.lockFx[key] = 0;
                return;
            }

            const eased = 1.0 - Math.exp(-decay * delta);
            this.lockFx[key] = THREE.MathUtils.lerp(current, 0, eased);
            if (this.lockFx[key] < 0.001) {
                this.lockFx[key] = 0;
            }
        });
    }

    hasActiveComboPulse() {
        return this.pulseSlots.some((slot) => slot.active && slot.timer >= 0.0 && slot.timer <= 120.0);
    }

    syncLockUniforms(comboScale = 1.0) {
        this.uniforms.uLockGlow.value = Math.min(1.0, (this.lockFx.arms + this.lockFx.accent * 0.08) * comboScale);
        this.uniforms.uLockSparkle.value = Math.min(1.0, this.lockFx.sparkle * comboScale);
        this.uniforms.uLockStarBoost.value = Math.min(1.0, (this.lockFx.stars + this.lockFx.accent * 0.12) * comboScale);
        this.uniforms.uLockDustBoost.value = Math.min(1.0, this.lockFx.dust * comboScale);
        this.uniforms.uLockNebulaBoost.value = Math.min(1.0, this.lockFx.nebula * comboScale);
        this.uniforms.uLockDirection.value.copy(this.lockFx.direction);
    }

    computeLockDirection(piece) {
        if (!piece?.shape || !Array.isArray(piece.shape) || !Number.isFinite(piece.x)) {
            return new THREE.Vector3(0, 0, 0);
        }

        let sumX = 0;
        let count = 0;

        for (let row = 0; row < piece.shape.length; row++) {
            const shapeRow = piece.shape[row];
            if (!Array.isArray(shapeRow)) continue;

            for (let col = 0; col < shapeRow.length; col++) {
                if (!shapeRow[col]) continue;
                sumX += piece.x + col + 0.5;
                count += 1;
            }
        }

        if (count === 0) {
            return new THREE.Vector3(0, 0, 0);
        }

        const centroidX = sumX / count;
        const bias = THREE.MathUtils.clamp((centroidX / COLS) * 2.0 - 1.0, -1.0, 1.0);

        if (Math.abs(bias) < 0.05) {
            return new THREE.Vector3(0, 0, 0);
        }

        // Encode side and strength in the same vector so shaders can keep the response global
        // while still biasing one side of the galaxy more strongly.
        return new THREE.Vector3(bias, 0, 0);
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsedTime;

        this.updateLockFx(delta);

        // Update Multiple Pulse Waves before syncing lock uniforms so combo dominance is current.
        if (this.spiralStars) {
            const pulseTimers = this.spiralStars.material.uniforms.uPulseTimers.value;

            for (let i = 0; i < this.MAX_PULSES; i++) {
                const slot = this.pulseSlots[i];
                if (slot.active) {
                    slot.timer += delta * 8.0;

                    if (slot.timer > 120.0) {
                        slot.active = false;
                        slot.timer = -100.0;
                    }
                }

                pulseTimers[i] = slot.timer;
            }

            if (this.spiralSparks) {
                const sparkTimers = this.spiralSparks.material.uniforms.uPulseTimers.value;
                for (let i = 0; i < this.MAX_PULSES; i++) {
                    sparkTimers[i] = pulseTimers[i];
                }
            }
        }

        const comboLockScale = this.hasActiveComboPulse() ? 0.6 : 1.0;
        this.syncLockUniforms(comboLockScale);
        const lockDirection = this.uniforms.uLockDirection.value;
        const parallax = this.lockFx.parallax * comboLockScale;

        // Slow camera orbit/drift for immersive effect
        if (this.camera) {
            const cameraTime = elapsedTime * 0.08; // Very slow orbit
            const baseX = Math.sin(cameraTime) * this.cameraMotion.horizontal;
            const baseY = this.cameraBasePosition.y
                + Math.sin(cameraTime * 0.7) * this.cameraMotion.vertical;
            const baseZ = this.cameraBasePosition.z
                + Math.cos(cameraTime) * this.cameraMotion.depth;

            // Smooth pointer tracking (frame-rate independent damping)
            this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 2.2);
            this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 2.2);
            const mouseParallaxX = this.smoothedPointerX * 4.0;
            const mouseParallaxY = -this.smoothedPointerY * 2.0;

            this.camera.position.x = baseX + lockDirection.x * 0.32 * parallax + mouseParallaxX;
            this.camera.position.y = baseY + Math.abs(lockDirection.x) * 0.05 * parallax + mouseParallaxY;
            this.camera.position.z = baseZ - 0.45 * parallax;

            const lookAtOffset = Math.sin(cameraTime * 0.5) * this.cameraMotion.lookAtX;
            this.camera.lookAt(
                lookAtOffset + lockDirection.x * 0.28 * parallax + mouseParallaxX * 0.4,
                0.03 * parallax + mouseParallaxY * 0.4,
                0,
            );
        }

        // Rotate background stars slowly
        if (this.backgroundStars) {
            this.backgroundStars.rotation.y = elapsedTime * 0.01;
            this.backgroundStars.rotation.x = elapsedTime * 0.003;
        }

        // Pulse core glow intensity based on coreIntensity uniform
        if (this.coreSprites && this.coreSprites.length > 0) {
            const pulseScale = 1.0 + (this.uniforms.coreIntensity.value - 1.0) * 0.3;
            const haloBoost = this.lockFx.haloLight * comboLockScale;
            const coreBoost = this.lockFx.core * comboLockScale;
            this.coreSprites.forEach((sprite, i) => {
                const baseScale = sprite.userData?.baseScale ?? this.baseCoreScales[i] ?? 1;
                const baseOpacity = sprite.userData?.baseOpacity ?? this.baseCoreOpacities[i] ?? 0.5;
                const layerBoost = i === 0
                    ? 1.0 + coreBoost * 0.04
                    : 1.0 + haloBoost * (0.025 + i * 0.015);
                sprite.scale.setScalar(baseScale * pulseScale * layerBoost);
                sprite.material.opacity = Math.min(1.0, baseOpacity + haloBoost * (0.03 + i * 0.015));
            });
        }

        if (this.coreLight) {
            const haloBoost = this.lockFx.haloLight * comboLockScale;
            const accentBoost = this.lockFx.accent * comboLockScale;
            this.coreLight.intensity = this.coreLightBaseIntensity + haloBoost * 0.25 + accentBoost * 0.06;
        }

        // Main group drift (figure-8 pattern)
        if (this.mainGroup) {
            const driftTime = elapsedTime * 0.1;
            this.mainGroup.position.x = Math.sin(driftTime) * 2 + Math.cos(driftTime * 0.7) * 1;
            this.mainGroup.position.y = Math.cos(driftTime * 0.8) * 1.5 + Math.sin(driftTime * 0.5) * 0.5;
            this.mainGroup.rotation.z = Math.sin(driftTime * 0.3) * 0.05;
        }

        // Nebula cloud animation
        this.nebulaClouds.forEach((cloud, i) => {
            cloud.rotation.z += delta * 0.01 * (i % 2 === 0 ? 1 : -1);
        });

        // Core intensity decay
        if (this.uniforms.coreIntensity.value > 1.0) {
            this.uniforms.coreIntensity.value = THREE.MathUtils.lerp(
                this.uniforms.coreIntensity.value,
                1.0,
                delta * 2.0,
            );
        }

        // Update effects
        this.updateShockwaves(delta);
        this.updateFlares(delta);

        this.renderer.render(this.scene, this.camera);
    }

    updateShockwaves(delta) {
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.scale.addScalar(wave.userData.speed * delta);
            wave.userData.life -= delta;

            if (wave.material.uniforms) {
                wave.material.uniforms.opacity.value = wave.userData.life / wave.userData.maxLife;
            } else {
                wave.material.opacity = wave.userData.life / wave.userData.maxLife;
            }

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                if (wave.geometry) wave.geometry.dispose();
                if (wave.material) wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    createShockwave(intensity) {
        const geometry = new THREE.TorusGeometry(2, 0.08, 8, 50);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                opacity: { value: 1.0 },
                color: { value: this.getRandomThemeColor() },
            },
            vertexShader: shockwaveVertexShader,
            fragmentShader: shockwaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.random() * Math.PI;
        wave.rotation.y = Math.random() * Math.PI;

        wave.userData = {
            speed: 4.0 + intensity * 2.0,
            life: 1.2,
            maxLife: 1.2,
        };

        this.mainGroup.add(wave);
        this.shockwaves.push(wave);
    }

    createSolarFlare() {
        if (!this.mainGroup) return;

        const particleCount = 25;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = dirX * 1.5 + (Math.random() - 0.5) * 0.5;
            positions[i * 3 + 1] = dirY * 1.5 + (Math.random() - 0.5) * 0.5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 1.0;

            const speed = 4.0 + Math.random() * 8.0;
            velocities.push({
                x: dirX * speed + (Math.random() - 0.5) * 2,
                y: dirY * speed + (Math.random() - 0.5) * 2,
                z: (Math.random() - 0.5) * 2,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: this.getRandomThemeColor(),
            size: 0.3,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
        });

        const flare = new THREE.Points(geometry, material);
        flare.userData = {
            velocities,
            life: 0.8,
            maxLife: 0.8,
        };

        this.mainGroup.add(flare);
        this.flares.push(flare);
    }

    createLockAccentFlare(direction) {
        if (!this.mainGroup) return;

        const particleCount = 8 + Math.floor(Math.random() * 5);
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        let angle;
        if (direction.lengthSq() > 0.0001) {
            angle = direction.x >= 0 ? 0 : Math.PI;
        } else {
            this.lastAccentSide *= -1;
            angle = this.lastAccentSide > 0 ? 0 : Math.PI;
        }
        angle += (Math.random() - 0.5) * 0.35;

        const radius = 6 + Math.random() * 3;
        const baseX = Math.cos(angle) * radius;
        const baseZ = Math.sin(angle) * radius;
        const baseY = (Math.random() - 0.5) * 0.45;

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = baseX + (Math.random() - 0.5) * 0.35;
            positions[i * 3 + 1] = baseY + (Math.random() - 0.5) * 0.2;
            positions[i * 3 + 2] = baseZ + (Math.random() - 0.5) * 0.35;

            const speed = 1.6 + Math.random() * 1.8;
            velocities.push({
                x: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.2,
                y: (Math.random() - 0.5) * 0.8,
                z: Math.sin(angle) * speed + (Math.random() - 0.5) * 1.2,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: new THREE.Color(0xCCF4FF),
            size: 0.18,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const flare = new THREE.Points(geometry, material);
        const life = 0.35 + Math.random() * 0.1;
        flare.userData = {
            velocities,
            life,
            maxLife: life,
        };

        this.mainGroup.add(flare);
        this.flares.push(flare);
    }

    updateFlares(delta) {
        for (let i = this.flares.length - 1; i >= 0; i--) {
            const flare = this.flares[i];
            const positions = flare.geometry.attributes.position.array;
            const { velocities } = flare.userData;

            flare.userData.life -= delta;

            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * delta;
                positions[j * 3 + 1] += velocities[j].y * delta;
                positions[j * 3 + 2] += velocities[j].z * delta;
            }
            flare.geometry.attributes.position.needsUpdate = true;

            flare.material.opacity = flare.userData.life / flare.userData.maxLife;

            if (flare.userData.life <= 0) {
                this.mainGroup.remove(flare);
                flare.geometry.dispose();
                flare.material.dispose();
                this.flares.splice(i, 1);
            }
        }
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock(data);
            }
        });

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
    }

    onLineClear(count) {
        this.uniforms.coreIntensity.value += count * 0.4;
        // this.createShockwave(count);

        if (count >= 4) {
            // Tetris - extra effects
            // this.createShockwave(count * 0.5);
            for (let i = 0; i < 3; i++) {
                this.scheduleEffectTimeout(() => this.createSolarFlare(), i * 100);
            }
        }
    }

    onCombo(count) {
        if (count > 1) {
            this.uniforms.coreIntensity.value += 0.25;
            // this.createShockwave(count * 0.4);

            // Add a new Pulse Wave (stacking, in strict slots)
            if (this.spiralStars) {
                // Use next slot in circular buffer
                const slotIdx = this.currentPulseSlot;
                this.pulseSlots[slotIdx].active = true;
                this.pulseSlots[slotIdx].timer = 0.0;

                // Advance pointer
                this.currentPulseSlot = (this.currentPulseSlot + 1) % this.MAX_PULSES;
            }
        }
        if (count >= 4) {
            this.createSolarFlare();
        }
    }

    onPieceLock(data) {
        const direction = this.computeLockDirection(data?.piece);
        this.lockFx.direction.copy(direction);
        this.uniforms.uLockDirection.value.copy(direction);

        if (this.uniforms.coreIntensity.value < 1.35) {
            this.uniforms.coreIntensity.value = Math.min(1.35, this.uniforms.coreIntensity.value + 0.1);
        }

        this.addLockFx({
            core: 0.8,
            haloLight: 0.9,
            arms: 1.0,
            sparkle: 0.95,
            stars: 0.9,
            nebula: 0.85,
            dust: 0.9,
            parallax: 1.0,
            accent: 1.0,
        });

        this.createLockAccentFlare(direction);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    dispose() {
        this.clearEffectTimeouts();

        window.removeEventListener('resize', this.boundResizeHandler);

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Cleanup Three.js
        if (this.renderer) {
            this.disposeRenderer(this.renderer, { nullInstance: false });
            const container = document.getElementById('galaxy-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        // Traverse and dispose scene objects
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
        this.mainGroup = null;
        this.coreLight = null;
        this.coreSprites = [];
        this.spiralStars = null;
        this.backgroundStars = null;
        this.nebulaClouds = [];
        this.cosmicDust = null;
        this.shockwaves = [];
        this.flares = [];
        Object.keys(this.lockFxDecay).forEach((key) => {
            this.lockFx[key] = 0;
        });
        this.lockFx.direction.set(0, 0, 0);
        this.syncLockUniforms(1.0);
    }

    cleanup() {
        if (this.cleanupComplete) return;

        try {
            this.dispose();
        } finally {
            // BaseTheme owns the canonical terminal lifecycle contract. Keep
            // this in finally so its safety nets run even if legacy disposal
            // encounters an already-lost renderer or scene resource.
            super.cleanup();
        }
    }

    getTetrominoConfig() {
        return GALAXY_TETROMINOS;
    }
}
