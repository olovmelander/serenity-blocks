import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { ASTRAL_WEAVE_TETROMINOS } from './astral-weave-tetrominos.js';
import {
    ribbonVertexShader,
    ribbonFragmentShader,
    weaveParticleVertexShader,
    weaveParticleFragmentShader,
    starsVertexShader,
    starsFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    pulseVertexShader,
    pulseFragmentShader,
    dustVertexShader,
    dustFragmentShader
} from './astral-weave-shaders.js';

/**
 * Astral Weave Theme - An immersive 3D cosmic weave experience
 * 
 * Features:
 * - Central glowing nexus where energy converges
 * - Multiple flowing energy ribbons weaving through space
 * - Thousands of particles flowing along the weave pattern
 * - Deep background starfield with twinkling
 * - Volumetric nebula clouds
 * - Dynamic game event effects (pulses, particle bursts)
 * - Slow drift animation for immersive depth
 */
export default class AstralWeaveTheme extends BaseTheme {
    constructor() {
        super('astral-weave');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.nexusSprites = [];
        this.energyRibbons = [];
        this.weaveParticles = null;
        this.backgroundStars = null;
        this.nebulaClouds = [];
        this.cosmicDust = null;
        this.pulseWaves = [];

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // Uniforms for shader animation
        this.uniforms = {
            time: { value: 0 },
            intensity: { value: 1.0 }
        };

        // Cosmic color palette - Ethereal cyans, magentas, purples, golds
        this.palette = {
            cyan: new THREE.Color(0x00FFFF),
            magenta: new THREE.Color(0xFF00FF),
            purple: new THREE.Color(0x9933FF),
            gold: new THREE.Color(0xFFD700),
            green: new THREE.Color(0x00FF88),
            pink: new THREE.Color(0xFF66AA),
            blue: new THREE.Color(0x3399FF),
            white: new THREE.Color(0xFFFFFF)
        };

        this.tetrominoConfig = ASTRAL_WEAVE_TETROMINOS;
    }

    getRandomColor() {
        const colors = Object.values(this.palette);
        return colors[Math.floor(Math.random() * colors.length)];
    }

    async createScene() {
        console.log('[AstralWeave] Initializing Three.js scene...');

        // Create container if needed
        let container = document.getElementById('astral-weave-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'astral-weave-theme';
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
                transition: 'opacity 0.5s ease-in-out',
            });
            document.body.appendChild(container);
            this.registerContainer(container);
            container.offsetHeight;
            container.classList.add('active');
            container.style.opacity = '1';
        } else {
            container.innerHTML = '';
        }

        // Setup Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050015, 0.012);

        // Setup Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.z = 30;
        this.camera.position.y = 5;
        this.camera.lookAt(0, 0, 0);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Create Main Group for Drifting
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create Scene Elements
        this.createNexusCore();
        this.createEnergyRibbons();
        this.createWeaveParticles();
        this.createBackgroundStars();
        this.createNebulaClouds();
        this.createCosmicDust();
        this.setupLighting();

        // Event Listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start Animation
        this.animate();

        console.log('[AstralWeave] Scene initialized.');
    }

    createNexusCore() {
        // Central nexus where energy converges - layered glow sprites
        this.nexusSprites = [];

        const glowTexture = this.createGlowTexture();

        // Inner bright white/cyan core
        const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xFFFFFF,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        innerGlow.scale.set(4, 4, 1);
        this.mainGroup.add(innerGlow);
        this.nexusSprites.push(innerGlow);

        // Cyan mid glow
        const midGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0x00FFFF,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        midGlow.scale.set(8, 8, 1);
        this.mainGroup.add(midGlow);
        this.nexusSprites.push(midGlow);

        // Magenta outer glow
        const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xFF00FF,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        outerGlow.scale.set(14, 14, 1);
        this.mainGroup.add(outerGlow);
        this.nexusSprites.push(outerGlow);

        // Purple diffuse halo
        const haloGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0x6633FF,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        haloGlow.scale.set(22, 22, 1);
        this.mainGroup.add(haloGlow);
        this.nexusSprites.push(haloGlow);
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.1, 'rgba(200, 255, 255, 0.9)');
        gradient.addColorStop(0.3, 'rgba(150, 200, 255, 0.5)');
        gradient.addColorStop(0.5, 'rgba(100, 150, 255, 0.25)');
        gradient.addColorStop(0.7, 'rgba(80, 100, 200, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        return new THREE.CanvasTexture(canvas);
    }

    createEnergyRibbons() {
        // Create multiple flowing energy ribbons emanating from the nexus
        const ribbonConfigs = [
            { angle: 0, color: [this.palette.cyan, this.palette.magenta, this.palette.gold] },
            { angle: Math.PI * 0.5, color: [this.palette.magenta, this.palette.purple, this.palette.cyan] },
            { angle: Math.PI, color: [this.palette.purple, this.palette.cyan, this.palette.green] },
            { angle: Math.PI * 1.5, color: [this.palette.gold, this.palette.magenta, this.palette.purple] },
            { angle: Math.PI * 0.25, color: [this.palette.green, this.palette.cyan, this.palette.white] },
            { angle: Math.PI * 0.75, color: [this.palette.pink, this.palette.purple, this.palette.cyan] },
            { angle: Math.PI * 1.25, color: [this.palette.blue, this.palette.cyan, this.palette.magenta] },
            { angle: Math.PI * 1.75, color: [this.palette.cyan, this.palette.gold, this.palette.pink] },
        ];

        ribbonConfigs.forEach((config, index) => {
            // Create a curved path from center outward
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(
                    Math.cos(config.angle) * 5 + Math.sin(config.angle + index) * 2,
                    Math.sin(index * 0.5) * 3,
                    Math.sin(config.angle) * 5
                ),
                new THREE.Vector3(
                    Math.cos(config.angle) * 12 + Math.cos(config.angle + index * 0.7) * 4,
                    Math.sin(index * 0.8 + 1) * 5,
                    Math.sin(config.angle) * 12 + Math.sin(config.angle + index * 0.5) * 3
                ),
                new THREE.Vector3(
                    Math.cos(config.angle) * 22 + Math.sin(config.angle + index * 0.3) * 6,
                    Math.cos(index * 0.6) * 4,
                    Math.sin(config.angle) * 22 + Math.cos(config.angle + index * 0.4) * 5
                ),
            ]);

            // Create ribbon geometry from curve
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, 0.15 + index * 0.02, 8, false);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    intensity: this.uniforms.intensity,
                    flowSpeed: { value: 1.5 + index * 0.2 },
                    waveIntensity: { value: 0.3 + index * 0.05 },
                    colorA: { value: config.color[0] },
                    colorB: { value: config.color[1] },
                    colorC: { value: config.color[2] }
                },
                vertexShader: ribbonVertexShader,
                fragmentShader: ribbonFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });

            const ribbon = new THREE.Mesh(tubeGeometry, material);
            ribbon.userData.baseAngle = config.angle;
            ribbon.userData.index = index;

            this.mainGroup.add(ribbon);
            this.energyRibbons.push(ribbon);
        });
    }

    createWeaveParticles() {
        // Particles that flow along the weave pattern
        const particleCount = 4000;
        const geometry = new THREE.BufferGeometry();

        const angles = new Float32Array(particleCount);
        const radii = new Float32Array(particleCount);
        const speeds = new Float32Array(particleCount);
        const randoms = new Float32Array(particleCount);
        const colors = new Float32Array(particleCount * 3);
        const positions = new Float32Array(particleCount * 3);

        const colorOptions = [
            this.palette.cyan,
            this.palette.magenta,
            this.palette.purple,
            this.palette.gold,
            this.palette.white
        ];

        for (let i = 0; i < particleCount; i++) {
            angles[i] = Math.random() * Math.PI * 2;
            radii[i] = 2 + Math.pow(Math.random(), 0.6) * 20;
            speeds[i] = 0.5 + Math.random() * 1.0;
            randoms[i] = Math.random();

            const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
            const brightness = 0.7 + Math.random() * 0.3;
            colors[i * 3] = color.r * brightness;
            colors[i * 3 + 1] = color.g * brightness;
            colors[i * 3 + 2] = color.b * brightness;

            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
        geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time
            },
            vertexShader: weaveParticleVertexShader,
            fragmentShader: weaveParticleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.weaveParticles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.weaveParticles);
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
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 50 + Math.random() * 80;

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
                time: this.uniforms.time
            },
            vertexShader: starsVertexShader,
            fragmentShader: starsFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.backgroundStars = new THREE.Points(geometry, material);
        this.scene.add(this.backgroundStars);
    }

    createNebulaClouds() {
        const nebulaConfigs = [
            { position: [-10, 3, -20], scale: 18, colorA: 0x00FFFF, colorB: 0xFF00FF, opacity: 0.25 },
            { position: [12, -2, -22], scale: 20, colorA: 0x9933FF, colorB: 0x00FFFF, opacity: 0.2 },
            { position: [0, 6, -28], scale: 25, colorA: 0xFF00FF, colorB: 0x6633FF, opacity: 0.18 },
            { position: [-15, -5, -25], scale: 16, colorA: 0xFFD700, colorB: 0xFF00FF, opacity: 0.22 },
        ];

        nebulaConfigs.forEach((config, index) => {
            const geometry = new THREE.PlaneGeometry(config.scale, config.scale);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    opacity: { value: config.opacity },
                    colorA: { value: new THREE.Color(config.colorA) },
                    colorB: { value: new THREE.Color(config.colorB) }
                },
                vertexShader: nebulaVertexShader,
                fragmentShader: nebulaFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            const cloud = new THREE.Mesh(geometry, material);
            cloud.position.set(...config.position);
            cloud.rotation.z = Math.random() * Math.PI;

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        });
    }

    createCosmicDust() {
        const dustCount = 300;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(dustCount * 3);
        const randoms = new Float32Array(dustCount);
        const sizes = new Float32Array(dustCount);

        for (let i = 0; i < dustCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 20;

            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
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
                color: { value: this.palette.cyan }
            },
            vertexShader: dustVertexShader,
            fragmentShader: dustFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.cosmicDust = new THREE.Points(geometry, material);
        this.mainGroup.add(this.cosmicDust);
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x202050, 0.5);
        this.scene.add(ambientLight);

        // Central nexus light
        const pointLight = new THREE.PointLight(0x00FFFF, 2, 50);
        pointLight.position.set(0, 0, 0);
        this.mainGroup.add(pointLight);

        // Secondary colored lights
        const magentaLight = new THREE.PointLight(0xFF00FF, 1, 40);
        magentaLight.position.set(10, 5, -5);
        this.mainGroup.add(magentaLight);

        const purpleLight = new THREE.PointLight(0x9933FF, 0.8, 35);
        purpleLight.position.set(-10, -3, 5);
        this.mainGroup.add(purpleLight);
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsedTime;

        // Camera orbit for dynamic view
        if (this.camera) {
            const cameraTime = elapsedTime * 0.06;
            const orbitRadius = 28;

            this.camera.position.x = Math.sin(cameraTime) * orbitRadius * 0.25;
            this.camera.position.y = 5 + Math.sin(cameraTime * 0.7) * 4;
            this.camera.position.z = 30 + Math.cos(cameraTime) * 6;

            const lookAtOffset = Math.sin(cameraTime * 0.5) * 2;
            this.camera.lookAt(lookAtOffset, 0, 0);
        }

        // Rotate background stars slowly
        if (this.backgroundStars) {
            this.backgroundStars.rotation.y = elapsedTime * 0.008;
            this.backgroundStars.rotation.x = elapsedTime * 0.002;
        }

        // Pulse nexus core based on intensity
        if (this.nexusSprites && this.nexusSprites.length > 0) {
            const pulseScale = 1.0 + (this.uniforms.intensity.value - 1.0) * 0.3;
            this.nexusSprites.forEach((sprite, i) => {
                const baseScale = [4, 8, 14, 22][i];
                sprite.scale.setScalar(baseScale * pulseScale);
            });
        }

        // Main group drift - large floating motion across the screen
        if (this.mainGroup) {
            const driftTime = elapsedTime * 0.05; // Slower, more graceful movement
            // Large figure-8 / lissajous pattern across the screen
            this.mainGroup.position.x = Math.sin(driftTime) * 12 + Math.cos(driftTime * 0.7) * 6;
            this.mainGroup.position.y = Math.cos(driftTime * 0.8) * 8 + Math.sin(driftTime * 0.5) * 4;
            this.mainGroup.position.z = Math.sin(driftTime * 0.6) * 5; // Also drift in depth
            this.mainGroup.rotation.y = elapsedTime * 0.015;
            this.mainGroup.rotation.z = Math.sin(driftTime * 0.3) * 0.04;
        }

        // Nebula cloud animation
        this.nebulaClouds.forEach((cloud, i) => {
            cloud.rotation.z += delta * 0.008 * (i % 2 === 0 ? 1 : -1);
        });

        // Intensity decay
        if (this.uniforms.intensity.value > 1.0) {
            this.uniforms.intensity.value = THREE.MathUtils.lerp(
                this.uniforms.intensity.value,
                1.0,
                delta * 2.0
            );
        }

        // Update pulse waves
        this.updatePulseWaves(delta);

        this.renderer.render(this.scene, this.camera);
    }

    updatePulseWaves(delta) {
        for (let i = this.pulseWaves.length - 1; i >= 0; i--) {
            const wave = this.pulseWaves[i];
            wave.scale.addScalar(wave.userData.speed * delta);
            wave.userData.life -= delta;

            if (wave.material.uniforms) {
                wave.material.uniforms.opacity.value = wave.userData.life / wave.userData.maxLife;
            }

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                if (wave.geometry) wave.geometry.dispose();
                if (wave.material) wave.material.dispose();
                this.pulseWaves.splice(i, 1);
            }
        }
    }

    createPulseWave(intensity) {
        const geometry = new THREE.TorusGeometry(2, 0.08, 8, 50);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                opacity: { value: 1.0 },
                color: { value: this.getRandomColor() }
            },
            vertexShader: pulseVertexShader,
            fragmentShader: pulseFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.random() * Math.PI;
        wave.rotation.y = Math.random() * Math.PI;

        wave.userData = {
            speed: 4.0 + intensity * 2.0,
            life: 1.2,
            maxLife: 1.2
        };

        this.mainGroup.add(wave);
        this.pulseWaves.push(wave);
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

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(count) {
        this.uniforms.intensity.value += count * 0.4;
        this.createPulseWave(count);

        if (count >= 4) {
            this.createPulseWave(count * 0.6);
            this.createPulseWave(count * 0.4);
        }
    }

    onCombo(count) {
        if (count > 1) {
            this.uniforms.intensity.value += 0.25;
            this.createPulseWave(count * 0.4);
        }
    }

    onPieceLock() {
        this.uniforms.intensity.value += 0.12;
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    dispose() {
        super.dispose();

        window.removeEventListener('resize', this.onWindowResize.bind(this));

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Cleanup pulse waves
        this.pulseWaves.forEach(wave => {
            this.mainGroup.remove(wave);
            if (wave.geometry) wave.geometry.dispose();
            if (wave.material) wave.material.dispose();
        });
        this.pulseWaves = [];

        // Cleanup renderer
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('astral-weave-theme');
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
                        object.material.forEach(m => m.dispose());
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
        this.nexusSprites = [];
        this.energyRibbons = [];
        this.weaveParticles = null;
        this.backgroundStars = null;
        this.nebulaClouds = [];
        this.cosmicDust = null;
    }

    getTetrominoConfig() {
        return ASTRAL_WEAVE_TETROMINOS;
    }
}
