/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NIMBUS VEIL THEME - Three.js 3D Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A serene, atmospheric 3D theme featuring ethereal clouds drifting through
 * a mysterious void with spiritual, heavenly feeling.
 *
 * Visual elements:
 * - Volumetric 3D clouds with soft fbm noise textures
 * - Floating dust particles in 3D space
 * - Background starfield for infinite depth
 * - Dynamic lighting with subtle god rays
 * - Bloom post-processing for ethereal glow
 * - Lock effect: Heavenly light burst
 * - Combo effect: Ethereal pulse waves
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { NIMBUS_VEIL_TETROMINOS } from './nimbus-veil-tetrominos.js';
import {
    cloudVertexShader,
    cloudFragmentShader,
    dustVertexShader,
    dustFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    pulseVertexShader,
    pulseFragmentShader,
    mistVertexShader,
    mistFragmentShader,
    lightBurstVertexShader,
    lightBurstFragmentShader,
    sparkleVertexShader,
    sparkleFragmentShader,
} from './nimbus-veil-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────

const QUALITY_PRESETS = {
    Minimal: {
        cloudCount: 4,
        dustCount: 200,
        starCount: 300,
        mistCount: 2,
        enableBloom: false,
        bloomStrength: 0.4,
        maxPulseWaves: 2,
        maxSparkles: 20,
    },
    Low: {
        cloudCount: 6,
        dustCount: 350,
        starCount: 500,
        mistCount: 3,
        enableBloom: true,
        bloomStrength: 0.5,
        maxPulseWaves: 3,
        maxSparkles: 35,
    },
    Medium: {
        cloudCount: 8,
        dustCount: 500,
        starCount: 800,
        mistCount: 4,
        enableBloom: true,
        bloomStrength: 0.6,
        maxPulseWaves: 4,
        maxSparkles: 50,
    },
    High: {
        cloudCount: 10,
        dustCount: 700,
        starCount: 1200,
        mistCount: 5,
        enableBloom: true,
        bloomStrength: 0.7,
        maxPulseWaves: 5,
        maxSparkles: 70,
    },
    Ultra: {
        cloudCount: 12,
        dustCount: 1000,
        starCount: 1800,
        mistCount: 6,
        enableBloom: true,
        bloomStrength: 0.8,
        maxPulseWaves: 6,
        maxSparkles: 100,
    },
    Extreme: {
        cloudCount: 15,
        dustCount: 1500,
        starCount: 2500,
        mistCount: 8,
        enableBloom: true,
        bloomStrength: 0.9,
        maxPulseWaves: 8,
        maxSparkles: 150,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class NimbusVeilTheme extends BaseTheme {
    constructor() {
        super('nimbus-veil');

        // Three.js components
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.clouds = [];
        this.cloudMaterials = [];
        this.dustParticles = null;
        this.dustMaterial = null;
        this.stars = null;
        this.starsMaterial = null;
        this.mistSprites = [];
        this.mistMaterials = [];
        this.pulseWaves = [];
        this.lightBurst = null;
        this.lightBurstMaterial = null;
        this.sparkles = null;
        this.sparkleData = [];

        // Animation state
        this.clock = new THREE.Clock();
        this.time = 0;
        this.animationFrameId = null;

        // Effect state
        this.cloudGlowIntensity = 0;
        this.targetCloudGlow = 0;
        this.lightBurstProgress = -1;
        this.bloomBoost = 0;
        this.particleBurstIntensity = 0; // For particle movement on events
        this.particleBurstDecay = 0.95;

        // Wind simulation
        this.windDirection = new THREE.Vector2(1, 0.2);
        this.windStrength = 0.3;
        this.windChangeTimer = 0;

        // Event handlers
        this.eventUnsubscribers = [];

        // Quality
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[NimbusVeil] Theme constructed');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[NimbusVeil] Creating 3D scene...');

        // Apply quality preset
        const quality = this.getGraphicsQuality();
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;

        // Create container
        let container = document.getElementById('nimbus-veil-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'nimbus-veil-theme';
            container.className = 'theme-container';
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
                pointerEvents: 'none',
                opacity: '0',
            });
            document.body.insertBefore(container, document.body.firstChild);
        }
        this.container = container;

        // Initialize Three.js
        this.initRenderer();
        this.initScene();
        this.initCamera();

        // Create scene elements
        this.createBackgroundStars();
        this.createClouds();
        this.createDustParticles();
        this.createMistSprites();
        this.createLightBurst();
        this.setupLighting();

        // Post-processing
        if (this.qualityPreset.enableBloom) {
            this.setupPostProcessing();
        }

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.animate();

        // Fade in
        container.style.transition = 'opacity 1s ease-in';
        container.style.opacity = '1';

        console.log('[NimbusVeil] Scene created successfully');
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setClearColor(0x0a0a12, 1);
        this.container.appendChild(this.renderer.domElement);
    }

    initScene() {
        this.scene = new THREE.Scene();
        // Deep atmospheric fog
        this.scene.fog = new THREE.FogExp2(0x0a0a12, 0.015);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            500,
        );
        this.camera.position.set(0, 0, 30);
        this.camera.lookAt(0, 0, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Elements
    // ─────────────────────────────────────────────────────────────────────────

    createBackgroundStars() {
        const count = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            // Sphere distribution far back
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 100 + Math.random() * 150;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = -50 - Math.random() * 200; // Behind camera

            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        this.starsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 3.0 },
            },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.stars = new THREE.Points(geometry, this.starsMaterial);
        this.scene.add(this.stars);
    }

    createClouds() {
        const count = this.qualityPreset.cloudCount;

        for (let i = 0; i < count; i++) {
            // Cloud billboard plane
            const size = 15 + Math.random() * 20;
            const geometry = new THREE.PlaneGeometry(size, size);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0.4 + Math.random() * 0.3 },
                    uColor: { value: new THREE.Color(0.95, 0.97, 1.0) },
                    uNoiseScale: { value: 2.0 + Math.random() * 1.5 },
                    uSoftness: { value: 0.3 + Math.random() * 0.4 },
                },
                vertexShader: cloudVertexShader,
                fragmentShader: cloudFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending,
            });

            const cloud = new THREE.Mesh(geometry, material);

            // Position clouds in 3D space
            cloud.position.set(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 40,
                -10 - Math.random() * 40,
            );

            // Random rotation
            cloud.rotation.z = Math.random() * Math.PI;

            // Store animation data
            cloud.userData = {
                baseX: cloud.position.x,
                baseY: cloud.position.y,
                speedX: 0.2 + Math.random() * 0.4,
                speedY: (Math.random() - 0.5) * 0.1,
                swaySpeed: 0.1 + Math.random() * 0.2,
                swayAmplitude: 2 + Math.random() * 3,
                baseOpacity: material.uniforms.uOpacity.value,
            };

            this.clouds.push(cloud);
            this.cloudMaterials.push(material);
            this.scene.add(cloud);
        }
    }

    createDustParticles() {
        const count = this.qualityPreset.dustCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = (Math.random() - 0.5) * 60;
            positions[i3 + 2] = (Math.random() - 0.5) * 60 - 10;

            randoms[i] = Math.random();
            phases[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        this.dustMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSize: { value: 4.0 },
                uIntensity: { value: 1.0 },
            },
            vertexShader: dustVertexShader,
            fragmentShader: dustFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.dustParticles = new THREE.Points(geometry, this.dustMaterial);
        this.scene.add(this.dustParticles);
    }

    createMistSprites() {
        const count = this.qualityPreset.mistCount;

        for (let i = 0; i < count; i++) {
            const size = 30 + Math.random() * 40;
            const geometry = new THREE.PlaneGeometry(size, size);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0.08 + Math.random() * 0.08 },
                },
                vertexShader: mistVertexShader,
                fragmentShader: mistFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });

            const mist = new THREE.Mesh(geometry, material);

            mist.position.set(
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 30,
                -5 - Math.random() * 25,
            );

            mist.userData = {
                baseX: mist.position.x,
                speedX: 0.1 + Math.random() * 0.2,
            };

            this.mistSprites.push(mist);
            this.mistMaterials.push(material);
            this.scene.add(mist);
        }
    }

    createLightBurst() {
        const geometry = new THREE.PlaneGeometry(60, 60);

        this.lightBurstMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uIntensity: { value: 1.0 },
            },
            vertexShader: lightBurstVertexShader,
            fragmentShader: lightBurstFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.lightBurst = new THREE.Mesh(geometry, this.lightBurstMaterial);
        this.lightBurst.position.z = 10;
        this.lightBurst.visible = false;
        this.scene.add(this.lightBurst);
    }

    setupLighting() {
        // Subtle ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
        this.scene.add(ambientLight);

        // Main directional light (moon-like)
        const directionalLight = new THREE.DirectionalLight(0xeeeeff, 0.3);
        directionalLight.position.set(10, 20, 30);
        this.scene.add(directionalLight);

        // Subtle point light for center glow
        this.centerLight = new THREE.PointLight(0xffffff, 0.2, 50);
        this.centerLight.position.set(0, 0, 10);
        this.scene.add(this.centerLight);
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.4,
            0.85,
        );
        this.bloomPass = bloomPass;
        this.composer.addPass(bloomPass);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────────────────

    animate() {
        if (!this.isActive) return;

        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        this.time += delta;

        // Update shader uniforms
        this.updateUniforms();

        // Animate clouds
        this.animateClouds(delta);

        // Animate dust particles
        this.animateDustParticles(delta);

        // Animate mist
        this.animateMist(delta);

        // Update wind
        this.updateWind(delta);

        // Animate effects
        this.animateEffects(delta);

        // Update camera subtle movement
        this.animateCamera(delta);

        // Render
        if (this.composer && this.qualityPreset.enableBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateUniforms() {
        // Stars
        if (this.starsMaterial) {
            this.starsMaterial.uniforms.uTime.value = this.time;
        }

        // Dust
        if (this.dustMaterial) {
            this.dustMaterial.uniforms.uTime.value = this.time;
            this.dustMaterial.uniforms.uIntensity.value = 1.0 + this.cloudGlowIntensity * 0.5;
        }

        // Clouds - only update time, opacity is handled in animateClouds with edge fade
        this.cloudMaterials.forEach((mat, i) => {
            mat.uniforms.uTime.value = this.time + i * 10;
        });

        // Mist
        this.mistMaterials.forEach((mat) => {
            mat.uniforms.uTime.value = this.time;
        });
    }

    animateClouds(delta) {
        const windX = this.windDirection.x * this.windStrength;
        const windY = this.windDirection.y * this.windStrength;

        // Edge boundaries for wrap-around
        const edgeX = 60;
        const edgeY = 30;
        const fadeZone = 15; // Start fading this far from edge

        this.clouds.forEach((cloud, i) => {
            const data = cloud.userData;
            const material = this.cloudMaterials[i];

            // Drift with wind
            cloud.position.x += (data.speedX + windX) * delta * 2;
            cloud.position.y += (data.speedY + windY) * delta;

            // Gentle sway
            cloud.position.y += Math.sin(this.time * data.swaySpeed) * data.swayAmplitude * delta * 0.5;

            // Wrap around with seamless repositioning
            if (cloud.position.x > edgeX) {
                cloud.position.x = -edgeX;
            }
            if (cloud.position.y > edgeY) {
                cloud.position.y = -edgeY;
            } else if (cloud.position.y < -edgeY) {
                cloud.position.y = edgeY;
            }

            // Edge fade - clouds fade near edges to prevent popping
            let edgeFade = 1.0;

            // Horizontal edge fade
            const absX = Math.abs(cloud.position.x);
            if (absX > edgeX - fadeZone) {
                edgeFade *= 1.0 - (absX - (edgeX - fadeZone)) / fadeZone;
            }

            // Vertical edge fade
            const absY = Math.abs(cloud.position.y);
            if (absY > edgeY - fadeZone) {
                edgeFade *= 1.0 - (absY - (edgeY - fadeZone)) / fadeZone;
            }

            // Clamp fade value
            edgeFade = Math.max(0, Math.min(1, edgeFade));

            // Apply edge fade to opacity (combined with glow effect)
            material.uniforms.uOpacity.value = (data.baseOpacity + this.cloudGlowIntensity * 0.3) * edgeFade;

            // Subtle rotation
            cloud.rotation.z += delta * 0.02;

            // Billboard toward camera
            cloud.lookAt(this.camera.position);
        });
    }

    animateDustParticles(delta) {
        if (!this.dustParticles) return;

        const positions = this.dustParticles.geometry.attributes.position.array;
        const count = positions.length / 3;

        // Particle burst effect - scatter particles outward from center
        const burstStrength = this.particleBurstIntensity;
        const hasBurst = burstStrength > 0.01;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const x = positions[i3];
            const y = positions[i3 + 1];

            // Drift with wind
            positions[i3] += this.windDirection.x * this.windStrength * delta * 0.5;
            positions[i3 + 1] += this.windDirection.y * this.windStrength * delta * 0.3;

            // Gentle wander
            positions[i3] += Math.sin(this.time * 0.5 + i * 0.1) * delta * 0.3;
            positions[i3 + 1] += Math.cos(this.time * 0.4 + i * 0.15) * delta * 0.2;

            // Burst effect - particles scatter outward from center
            if (hasBurst) {
                const dist = Math.sqrt(x * x + y * y) + 0.1; // Avoid division by zero
                const normalX = x / dist;
                const normalY = y / dist;

                // Particles further from center move faster
                const burstSpeed = burstStrength * (5 + dist * 0.1) * delta;
                positions[i3] += normalX * burstSpeed;
                positions[i3 + 1] += normalY * burstSpeed * 0.6;
            }

            // Wrap around
            if (positions[i3] > 50) positions[i3] = -50;
            if (positions[i3] < -50) positions[i3] = 50;
            if (positions[i3 + 1] > 30) positions[i3 + 1] = -30;
            if (positions[i3 + 1] < -30) positions[i3 + 1] = 30;
        }

        // Decay burst intensity
        this.particleBurstIntensity *= this.particleBurstDecay;

        this.dustParticles.geometry.attributes.position.needsUpdate = true;
    }

    animateMist(delta) {
        this.mistSprites.forEach((mist) => {
            const data = mist.userData;

            mist.position.x += data.speedX * delta;

            if (mist.position.x > 40) {
                mist.position.x = -40;
            }

            // Billboard
            mist.lookAt(this.camera.position);
        });
    }

    updateWind(delta) {
        this.windChangeTimer += delta;

        if (this.windChangeTimer > 8) {
            this.windChangeTimer = 0;
            // Gradually shift wind direction
            this.windDirection.x = 0.8 + Math.random() * 0.4;
            this.windDirection.y = (Math.random() - 0.5) * 0.4;
            this.windStrength = 0.2 + Math.random() * 0.3;
        }
    }

    animateEffects(delta) {
        // Cloud glow decay
        this.cloudGlowIntensity = THREE.MathUtils.lerp(
            this.cloudGlowIntensity,
            this.targetCloudGlow,
            delta * 3,
        );
        this.targetCloudGlow *= 0.95;

        // Light burst animation
        if (this.lightBurstProgress >= 0) {
            this.lightBurstProgress += delta * 2;
            this.lightBurstMaterial.uniforms.uProgress.value = this.lightBurstProgress;

            if (this.lightBurstProgress >= 1) {
                this.lightBurstProgress = -1;
                this.lightBurst.visible = false;
            }
        }

        // Bloom boost decay
        if (this.bloomPass && this.bloomBoost > 0) {
            this.bloomPass.strength = this.qualityPreset.bloomStrength + this.bloomBoost;
            this.bloomBoost *= 0.95;
        } else if (this.bloomPass) {
            this.bloomPass.strength = this.qualityPreset.bloomStrength;
        }

        // Center light from effects
        if (this.centerLight) {
            this.centerLight.intensity = 0.2 + this.cloudGlowIntensity * 0.5;
        }

        // Update pulse waves
        this.updatePulseWaves(delta);
    }

    animateCamera(delta) {
        // Subtle camera drift for atmosphere
        const driftX = Math.sin(this.time * 0.1) * 0.5;
        const driftY = Math.cos(this.time * 0.08) * 0.3;

        this.camera.position.x = driftX;
        this.camera.position.y = driftY;
        this.camera.lookAt(0, 0, -10);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pulse Wave Effects
    // ─────────────────────────────────────────────────────────────────────────

    createPulseWave(intensity = 1.0) {
        if (this.pulseWaves.length >= this.qualityPreset.maxPulseWaves) {
            // Remove oldest
            const oldest = this.pulseWaves.shift();
            this.scene.remove(oldest);
            oldest.geometry.dispose();
            oldest.material.dispose();
        }

        const geometry = new THREE.PlaneGeometry(80, 80);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uOpacity: { value: 0.6 * intensity },
                uColor: { value: new THREE.Color(0.9, 0.95, 1.0) },
            },
            vertexShader: pulseVertexShader,
            fragmentShader: pulseFragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.position.z = 5;
        wave.userData = { progress: 0, lifetime: 1.5 };

        this.pulseWaves.push(wave);
        this.scene.add(wave);
    }

    updatePulseWaves(delta) {
        for (let i = this.pulseWaves.length - 1; i >= 0; i--) {
            const wave = this.pulseWaves[i];
            wave.userData.progress += delta / wave.userData.lifetime;
            wave.material.uniforms.uProgress.value = wave.userData.progress;

            if (wave.userData.progress >= 1) {
                this.scene.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.pulseWaves.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Event Effects
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const settings = window.settings || {};

        // Line Clear
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount);
            }
        });

        // Combo
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount);
            }
        });

        // Piece Lock
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        console.log(`[NimbusVeil] Line clear: ${lineCount}`);

        // Subtle cloud glow (reduced brightness)
        this.targetCloudGlow = Math.min(lineCount * 0.2, 0.7);

        // Create pulse waves (reduced opacity)
        const waveCount = Math.min(lineCount, 3);
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => this.createPulseWave(0.35), i * 150);
        }

        // Bloom boost (reduced)
        this.bloomBoost = Math.min(lineCount * 0.08, 0.25);
    }

    onCombo(comboCount) {
        if (comboCount < 2) return;

        console.log(`[NimbusVeil] Combo: ${comboCount}`);

        // Progressive cloud intensity (reduced brightness)
        this.targetCloudGlow = Math.min(0.15 + comboCount * 0.1, 0.6);

        // Multiple ethereal pulse waves (reduced opacity)
        const waveCount = Math.min(Math.floor(comboCount / 2) + 1, 4);
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                this.createPulseWave(0.25 + comboCount * 0.05);
            }, i * 100);
        }

        // Bloom intensifies with combos (reduced)
        this.bloomBoost = Math.min(comboCount * 0.04, 0.2);

        // Particle burst - stronger with higher combos
        this.particleBurstIntensity = Math.min(2.0 + comboCount * 0.5, 5.0);
    }

    onPieceLock(piece) {
        // Heavenly light burst effect (reduced intensity)
        this.lightBurst.visible = true;
        this.lightBurstProgress = 0;
        this.lightBurstMaterial.uniforms.uIntensity.value = 0.25;

        // Subtle cloud glow (reduced)
        this.targetCloudGlow = Math.max(this.targetCloudGlow, 0.08);

        // Small bloom pulse (reduced)
        this.bloomBoost = Math.max(this.bloomBoost, 0.05);

        // Particle burst on piece lock
        this.particleBurstIntensity = Math.max(this.particleBurstIntensity, 1.5);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize & Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    stop() {
        super.stop();

        window.removeEventListener('resize', this.onWindowResize.bind(this));

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Unsubscribe events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Dispose pulse waves
        this.pulseWaves.forEach((wave) => {
            this.scene.remove(wave);
            wave.geometry.dispose();
            wave.material.dispose();
        });
        this.pulseWaves = [];

        // Dispose Three.js resources
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.container && this.renderer.domElement.parentNode === this.container) {
                this.container.removeChild(this.renderer.domElement);
            }
            this.renderer = null;
        }

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
            this.scene = null;
        }

        this.camera = null;
        this.clouds = [];
        this.cloudMaterials = [];
        this.dustParticles = null;
        this.dustMaterial = null;
        this.stars = null;
        this.starsMaterial = null;
        this.mistSprites = [];
        this.mistMaterials = [];
        this.lightBurst = null;
        this.lightBurstMaterial = null;

        console.log('[NimbusVeil] Theme stopped and cleaned up');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tetromino Config
    // ─────────────────────────────────────────────────────────────────────────

    getTetrominoConfig() {
        return NIMBUS_VEIL_TETROMINOS;
    }
}
