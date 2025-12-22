/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🔥 CINDER DRIFT 🔥
 *  A 3D Volcanic Fire Theme with Multiple Floating Ember Cores
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Design: Multiple glowing ember spheres of different sizes drifting through
 * space like floating lava globules, with rising ember particles.
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CINDER_DRIFT_TETROMINOS } from './cinder-drift-tetrominos.js';
import {
    coreVertexShader,
    coreFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
    emberParticleVertexShader,
    emberParticleFragmentShader,
} from './cinder-drift-shaders.js';

export default class CinderDriftTheme extends BaseTheme {
    constructor() {
        super('cinder-drift');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.cores = []; // Array of ember core objects
        this.emberParticles = null;
        this.shockwaves = [];
        this.flares = [];

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // Uniforms
        this.uniforms = {
            time: { value: 0 },
            coreIntensity: { value: 1.0 },
            coreColorPrimary: { value: new THREE.Color(0xFF4400) },
            coreColorSecondary: { value: new THREE.Color(0x8B0000) },
            coreColorTertiary: { value: new THREE.Color(0xFFDD66) },
        };

        // Theme palette
        this.palette = [
            new THREE.Color(0xFF4400),
            new THREE.Color(0xFF6600),
            new THREE.Color(0xFFAA00),
            new THREE.Color(0xFF2200),
            new THREE.Color(0xFFDD44),
        ];
    }

    getTetrominoConfig() {
        return CINDER_DRIFT_TETROMINOS;
    }

    getRandomThemeColor() {
        return this.palette[Math.floor(Math.random() * this.palette.length)];
    }

    async createScene() {
        console.log('[CinderDrift] Initializing Three.js scene...');

        const container = document.getElementById('cinder-drift-theme');
        if (!container) {
            console.error('[CinderDrift] Container not found');
            return;
        }

        container.innerHTML = '';

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0400, 0.006);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.z = 60;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setClearColor(0x080402, 1);
        container.appendChild(this.renderer.domElement);

        // Main group
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create elements
        this.createMultipleCores();
        this.createEmberParticles();
        this.createBackgroundEmbers();
        this.setupLighting();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.animate();

        console.log('[CinderDrift] Scene initialized with', this.cores.length, 'ember cores.');
    }

    createMultipleCores() {
        // Configuration for multiple cores spread across the FULL screen with wide drift
        const coreConfigs = [
            { size: 4.0, position: [0, 0, -5], driftSpeed: 0.06, driftRadius: 35, phase: 0 },
            { size: 2.5, position: [40, 15, -10], driftSpeed: 0.08, driftRadius: 40, phase: 1.5 },
            { size: 2.0, position: [-40, -15, -8], driftSpeed: 0.07, driftRadius: 38, phase: 3.0 },
            { size: 3.0, position: [30, -20, 0], driftSpeed: 0.065, driftRadius: 32, phase: 4.5 },
            { size: 1.8, position: [-35, 25, -5], driftSpeed: 0.09, driftRadius: 30, phase: 2.0 },
            { size: 1.2, position: [50, -10, -15], driftSpeed: 0.10, driftRadius: 28, phase: 5.0 },
            { size: 1.5, position: [-50, 8, -12], driftSpeed: 0.085, driftRadius: 35, phase: 0.8 },
            { size: 2.2, position: [15, 30, -8], driftSpeed: 0.075, driftRadius: 40, phase: 3.5 },
            { size: 1.0, position: [-25, -28, -6], driftSpeed: 0.11, driftRadius: 25, phase: 4.0 },
        ];

        const glowTexture = this.createGlowTexture();

        coreConfigs.forEach((config, index) => {
            // Create core mesh
            const geometry = new THREE.SphereGeometry(config.size, 48, 48);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    intensity: this.uniforms.coreIntensity,
                    colorPrimary: this.uniforms.coreColorPrimary,
                    colorSecondary: this.uniforms.coreColorSecondary,
                    colorTertiary: this.uniforms.coreColorTertiary,
                },
                vertexShader: coreVertexShader,
                fragmentShader: coreFragmentShader,
                transparent: false,
                side: THREE.FrontSide,
            });

            const coreMesh = new THREE.Mesh(geometry, material);
            coreMesh.position.set(...config.position);

            // Create glow sprites for this core
            const glowScale = config.size;

            // Inner glow
            const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: 0xFFAA00,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            innerGlow.scale.set(glowScale * 3.5, glowScale * 3.5, 1);
            coreMesh.add(innerGlow);

            // Outer glow
            const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: 0xFF4400,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            outerGlow.scale.set(glowScale * 5.5, glowScale * 5.5, 1);
            coreMesh.add(outerGlow);

            // Red halo
            const haloGlow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowTexture,
                color: 0x660000,
                transparent: true,
                opacity: 0.35,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }));
            haloGlow.scale.set(glowScale * 7.5, glowScale * 7.5, 1);
            coreMesh.add(haloGlow);

            // Point light for each core
            const light = new THREE.PointLight(0xFF4400, config.size * 0.5, config.size * 15);
            coreMesh.add(light);

            // Store core data
            this.cores.push({
                mesh: coreMesh,
                config,
                glows: [innerGlow, outerGlow, haloGlow],
                light,
                basePosition: new THREE.Vector3(...config.position),
            });

            this.mainGroup.add(coreMesh);
        });
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 200, 100, 1.0)');
        gradient.addColorStop(0.2, 'rgba(255, 120, 50, 0.8)');
        gradient.addColorStop(0.4, 'rgba(200, 50, 20, 0.4)');
        gradient.addColorStop(0.7, 'rgba(100, 20, 10, 0.15)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        return new THREE.CanvasTexture(canvas);
    }

    createEmberParticles() {
        const particleCount = 1000;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Spread across the scene
            positions[i3] = (Math.random() - 0.5) * 40;
            positions[i3 + 1] = (Math.random() - 0.5) * 30 - 5;
            positions[i3 + 2] = (Math.random() - 0.5) * 30;

            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
            },
            vertexShader: emberParticleVertexShader,
            fragmentShader: emberParticleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.emberParticles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.emberParticles);
    }

    createBackgroundEmbers() {
        const count = 500;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        const emberColors = [
            new THREE.Color(0xFF4400),
            new THREE.Color(0xFF6600),
            new THREE.Color(0xFFAA00),
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            positions[i3] = (Math.random() - 0.5) * 100;
            positions[i3 + 1] = (Math.random() - 0.5) * 80;
            positions[i3 + 2] = (Math.random() - 0.5) * 60 - 30;

            const color = emberColors[Math.floor(Math.random() * emberColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
        });

        const bgEmbers = new THREE.Points(geometry, material);
        this.scene.add(bgEmbers);
        this.backgroundEmbers = bgEmbers;
    }

    setupLighting() {
        // Warm ambient
        const ambientLight = new THREE.AmbientLight(0x200800, 0.4);
        this.scene.add(ambientLight);
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsedTime;

        // Slow camera orbit for parallax depth (independent of cores)
        if (this.camera) {
            const cameraTime = elapsedTime * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 20; // Wide horizontal sway
            const orbitRadiusY = 15;  // Vertical sway range
            const orbitRadiusZ = 12;  // Depth breathing

            // Orbital sway - creates parallax with background embers
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX +
                Math.cos(cameraTime * 0.7) * orbitRadiusX * 0.4;
            this.camera.position.y = Math.cos(cameraTime * 0.8) * orbitRadiusY +
                Math.sin(cameraTime * 0.5) * orbitRadiusY * 0.3;
            this.camera.position.z = 60 + Math.sin(cameraTime * 0.6) * orbitRadiusZ;

            // LookAt drift for dynamic framing
            const lookOffsetX = Math.sin(cameraTime * 0.4) * 8;
            const lookOffsetY = Math.cos(cameraTime * 0.5) * 6;
            this.camera.lookAt(lookOffsetX, lookOffsetY, 0);
        }

        // Animate each core with unique drift pattern
        this.cores.forEach((core) => {
            const { mesh, config, glows, light, basePosition } = core;
            const t = elapsedTime * config.driftSpeed + config.phase;

            // Lissajous curve drift pattern for organic movement
            const driftX = Math.sin(t) * Math.cos(t * 0.7) * config.driftRadius;
            const driftY = Math.sin(t * 0.8) * Math.cos(t * 0.5) * config.driftRadius * 0.7;
            const driftZ = Math.cos(t * 0.6) * Math.sin(t * 0.9) * config.driftRadius * 0.5;

            mesh.position.x = basePosition.x + driftX;
            mesh.position.y = basePosition.y + driftY;
            mesh.position.z = basePosition.z + driftZ;

            // Slow rotation
            mesh.rotation.y = t * 0.1;
            mesh.rotation.x = Math.sin(t * 0.3) * 0.2;

            // Pulse glow based on intensity
            const pulseScale = 1.0 + (this.uniforms.coreIntensity.value - 1.0) * 0.3;
            const baseScales = [config.size * 3.5, config.size * 5.5, config.size * 7.5];
            glows.forEach((glow, i) => {
                glow.scale.setScalar(baseScales[i] * pulseScale);
            });

            // Flicker light
            light.intensity = config.size * 0.5 * (1 + Math.sin(elapsedTime * 5 + config.phase) * 0.2) *
                this.uniforms.coreIntensity.value;
        });

        // Background rotation
        if (this.backgroundEmbers) {
            this.backgroundEmbers.rotation.y = elapsedTime * 0.015;
            this.backgroundEmbers.rotation.x = elapsedTime * 0.003;
        }

        // Intensity decay
        if (this.uniforms.coreIntensity.value > 1.0) {
            this.uniforms.coreIntensity.value = THREE.MathUtils.lerp(
                this.uniforms.coreIntensity.value,
                1.0,
                delta * 1.5
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
            }

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    createShockwave(coreIndex = 0) {
        const core = this.cores[coreIndex] || this.cores[0];
        if (!core) return;

        const geometry = new THREE.TorusGeometry(core.config.size * 1.2, 0.1, 8, 50);
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
        wave.position.copy(core.mesh.position);
        wave.rotation.x = Math.random() * Math.PI;
        wave.rotation.y = Math.random() * Math.PI;

        wave.userData = {
            speed: 5.0,
            life: 0.8,
            maxLife: 0.8,
        };

        this.mainGroup.add(wave);
        this.shockwaves.push(wave);
    }

    createFlare(coreIndex = 0) {
        const core = this.cores[coreIndex] || this.cores[0];
        if (!core) return;

        const particleCount = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = core.mesh.position.x + dirX * core.config.size;
            positions[i * 3 + 1] = core.mesh.position.y + dirY * core.config.size;
            positions[i * 3 + 2] = core.mesh.position.z + (Math.random() - 0.5);

            const speed = 5.0 + Math.random() * 8.0;
            velocities.push({
                x: dirX * speed + (Math.random() - 0.5) * 2,
                y: dirY * speed + (Math.random() - 0.5) * 2,
                z: (Math.random() - 0.5) * 2,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: this.getRandomThemeColor(),
            size: 0.4,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
        });

        const flare = new THREE.Points(geometry, material);
        flare.userData = {
            velocities,
            life: 0.6,
            maxLife: 0.6,
        };

        this.mainGroup.add(flare);
        this.flares.push(flare);
    }

    updateFlares(delta) {
        for (let i = this.flares.length - 1; i >= 0; i--) {
            const flare = this.flares[i];
            const positions = flare.geometry.attributes.position.array;
            const velocities = flare.userData.velocities;

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
                this.onLineClear(data.lineCount || data.lines || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount || data.combo || 1);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(count) {
        this.uniforms.coreIntensity.value += count * 0.4;
        // Trigger shockwaves from random cores
        const numWaves = Math.min(count, this.cores.length);
        for (let i = 0; i < numWaves; i++) {
            const coreIndex = Math.floor(Math.random() * this.cores.length);
            setTimeout(() => this.createShockwave(coreIndex), i * 100);
        }
    }

    onCombo(count) {
        if (count > 1) {
            this.uniforms.coreIntensity.value += 0.3;
            this.createShockwave(Math.floor(Math.random() * this.cores.length));
        }
    }

    onPieceLock() {
        this.uniforms.coreIntensity.value += 0.1;
        const coreIndex = Math.floor(Math.random() * this.cores.length);
        this.createFlare(coreIndex);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    resize(width, height) {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    stop() {
        if (!this.isActive) return;

        this.eventUnsubscribers.forEach((u) => u());
        this.eventUnsubscribers = [];

        super.stop();
    }

    cleanup() {
        this.stop();

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
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
        }

        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('cinder-drift-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.cores = [];

        super.cleanup();
        console.log('[CinderDrift] Cleanup complete');
    }
}
