import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { AURORA_TETROMINOS } from './aurora-tetrominos.js';
import {
    auroraCurtainVertexShader,
    auroraCurtainFragmentShader,
    starVertexShader,
    starFragmentShader,
    nebulaVertexShader,
    nebulaFragmentShader,
    shootingStarVertexShader,
    shootingStarFragmentShader,
    pulseWaveVertexShader,
    pulseWaveFragmentShader,
    auroraSparkVertexShader,
    auroraSparkFragmentShader,
} from './aurora-shaders.js';

/**
 * Aurora Theme - Three.js 3D Edition
 *
 * Features:
 * - Immersive 3D aurora borealis with flowing green curtains
 * - Deep space background with twinkling stars
 * - Nebula ambient particles
 * - Shooting stars on combos
 * - Dynamic lighting and atmospheric effects
 */
export default class AuroraTheme extends BaseTheme {
    constructor() {
        super('aurora');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null; // Container for drifting elements
        this.auroraCurtains = [];
        this.starSystem = null;
        this.nebulaParticles = null;
        this.shootingStars = [];
        this.pulseWaves = [];
        this.auroraSparks = []; // Pool of spark particle systems
        this.auroraSparkIndex = 0; // Cycle through pool

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // Uniforms
        this.uniforms = {
            time: { value: 0 },
            intensity: { value: 1.0 },
            comboWave: { value: 0.0 },
        };

        // Aurora color palette - Deep greens with cyan/violet accents
        this.auroraColors = {
            primary: new THREE.Color(0x00ff6a), // Vibrant emerald green
            secondary: new THREE.Color(0x00e5ff), // Electric cyan
            tertiary: new THREE.Color(0xaa66ff), // Soft violet
        };

        // Quality settings
        this.qualityPresets = {
            Minimum: {
                starCount: 500, curtainLayers: 2, nebulaCount: 50, auroraSparks: 800,
            },
            Low: {
                starCount: 800, curtainLayers: 3, nebulaCount: 80, auroraSparks: 1200,
            },
            Medium: {
                starCount: 1200, curtainLayers: 4, nebulaCount: 120, auroraSparks: 1800,
            },
            High: {
                starCount: 2000, curtainLayers: 5, nebulaCount: 180, auroraSparks: 2500,
            },
            Ultra: {
                starCount: 3000, curtainLayers: 6, nebulaCount: 250, auroraSparks: 3500,
            },
            Extreme: {
                starCount: 4000, curtainLayers: 7, nebulaCount: 350, auroraSparks: 5000,
            },
        };
        this.currentQuality = 'High';
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        console.log('[Aurora3D] Initializing Three.js scene...');

        const container = document.getElementById('aurora-theme');
        if (!container) {
            console.error('[Aurora3D] Container not found');
            return;
        }

        container.innerHTML = '';
        this.currentQuality = this.getGraphicsQuality();
        const preset = this.qualityPresets[this.currentQuality] || this.qualityPresets.High;

        // Setup Scene
        this.scene = new THREE.Scene();
        // Deep space atmosphere - dark greenish-black
        this.scene.background = new THREE.Color(0x000a05);
        this.scene.fog = new THREE.FogExp2(0x001a10, 0.008);

        // Setup Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000,
        );
        this.camera.position.set(0, -5, 15);
        this.camera.lookAt(0, 5, 0);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);

        // Create main group for drifting
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create all elements
        this.createStars(preset.starCount);
        this.createAuroraCurtains(preset.curtainLayers);
        this.createNebulaParticles(preset.nebulaCount);
        this.createAuroraSparks(preset.auroraSparks);
        this.setupLighting();

        // Event listeners
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start animation
        this.animate();

        console.log(`[Aurora3D] Scene initialized with ${this.currentQuality} quality.`);
    }

    createStars(count) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Star color palette - whites, pale blues, pale greens
        const starColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xaaddff), // Pale blue
            new THREE.Color(0xddffdd), // Pale green
            new THREE.Color(0xffffee), // Warm white
            new THREE.Color(0xbbffee), // Cyan tint
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread stars in a wide dome/hemisphere around camera
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.6; // Upper hemisphere mostly
            const radius = 40 + Math.random() * 60;

            positions[i3] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[i3 + 1] = Math.cos(phi) * radius * 0.8 + 10; // Bias upward
            positions[i3 + 2] = Math.sin(phi) * Math.sin(theta) * radius - 20;

            sizes[i] = Math.random() * 2.0 + 0.5;
            phases[i] = Math.random() * Math.PI * 2;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.starSystem = new THREE.Points(geometry, material);
        this.scene.add(this.starSystem); // Stars in background, not in mainGroup
    }

    createAuroraCurtains(layerCount) {
        // Clear existing curtains
        this.auroraCurtains.forEach((c) => {
            this.mainGroup.remove(c);
            c.geometry.dispose();
            c.material.dispose();
        });
        this.auroraCurtains = [];

        for (let i = 0; i < layerCount; i++) {
            const t = i / (layerCount - 1 || 1);

            // Create a wide, tall plane for each curtain
            const width = 60 + t * 20;
            const height = 25 + t * 10;
            const geometry = new THREE.PlaneGeometry(width, height, 80, 40);

            // Vary colors per layer
            const primaryHue = 0.38 + t * 0.08; // Green varying to cyan
            const primary = new THREE.Color().setHSL(primaryHue, 0.9, 0.5);
            const secondary = new THREE.Color().setHSL(primaryHue + 0.1, 0.85, 0.55);
            const tertiary = new THREE.Color().setHSL(0.75 - t * 0.1, 0.7, 0.6); // Purple

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    intensity: this.uniforms.intensity,
                    comboWave: this.uniforms.comboWave,
                    waveSpeed: { value: 0.3 + t * 0.2 },
                    waveAmplitude: { value: 2.0 + t * 1.0 },
                    layerOffset: { value: i * 3.0 },
                    colorPrimary: { value: primary },
                    colorSecondary: { value: secondary },
                    colorTertiary: { value: tertiary },
                },
                vertexShader: auroraCurtainVertexShader,
                fragmentShader: auroraCurtainFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });

            const curtain = new THREE.Mesh(geometry, material);

            // Position layers at different depths and heights
            const zPos = -5 - i * 8;
            const yPos = 8 + i * 3;
            const xOffset = (Math.random() - 0.5) * 10;

            curtain.position.set(xOffset, yPos, zPos);
            curtain.rotation.x = -0.2 - t * 0.1; // Slight tilt

            this.mainGroup.add(curtain);
            this.auroraCurtains.push(curtain);
        }
    }

    createNebulaParticles(count) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread around the aurora area
            positions[i3] = (Math.random() - 0.5) * 80;
            positions[i3 + 1] = Math.random() * 30 + 5;
            positions[i3 + 2] = (Math.random() - 0.5) * 60 - 10;

            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                color: { value: new THREE.Color(0x88ffaa) }, // Soft green glow
            },
            vertexShader: nebulaVertexShader,
            fragmentShader: nebulaFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.nebulaParticles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.nebulaParticles);
    }

    setupLighting() {
        // Ambient light - deep space blue
        const ambient = new THREE.AmbientLight(0x1a2a40, 0.5);
        this.scene.add(ambient);

        // Aurora glow light
        const auroraLight = new THREE.PointLight(0x00ff88, 1.5, 60);
        auroraLight.position.set(0, 15, -10);
        this.mainGroup.add(auroraLight);

        // Secondary light for depth
        const secondaryLight = new THREE.PointLight(0x00ccff, 0.8, 40);
        secondaryLight.position.set(-15, 20, -20);
        this.mainGroup.add(secondaryLight);
    }

    createAuroraSparks(totalCount) {
        // Pool of particle systems for overlapping bursts
        const poolSize = 6;
        const countPerSystem = Math.floor(totalCount / poolSize);

        // Green/cyan aurora color palette
        const colorOptions = [
            new THREE.Color(0x00ff66), // Vibrant emerald
            new THREE.Color(0x44ffaa), // Mint green
            new THREE.Color(0x00ffcc), // Cyan-green
            new THREE.Color(0x88ff88), // Light green
            new THREE.Color(0x00dd88), // Deep green
        ];

        for (let p = 0; p < poolSize; p++) {
            const geometry = new THREE.BufferGeometry();

            const thetas = new Float32Array(countPerSystem);
            const phis = new Float32Array(countPerSystem);
            const radii = new Float32Array(countPerSystem);
            const randoms = new Float32Array(countPerSystem);
            const colors = new Float32Array(countPerSystem * 3);
            const positions = new Float32Array(countPerSystem * 3);
            const origins = new Float32Array(countPerSystem * 3);

            for (let i = 0; i < countPerSystem; i++) {
                // Distribute particles across aurora area
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                thetas[i] = theta;
                phis[i] = phi;
                radii[i] = 1.0; // Not used for spherical origin
                randoms[i] = Math.random();

                // Origin points spread across aurora viewing area
                const originX = (Math.random() - 0.5) * 50;
                const originY = 5 + Math.random() * 20;
                const originZ = -5 - Math.random() * 25;

                origins[i * 3] = originX;
                origins[i * 3 + 1] = originY;
                origins[i * 3 + 2] = originZ;

                // Color selection
                const c = colorOptions[Math.floor(Math.random() * colorOptions.length)];
                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                positions[i * 3] = originX;
                positions[i * 3 + 1] = originY;
                positions[i * 3 + 2] = originZ;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aTheta', new THREE.BufferAttribute(thetas, 1));
            geometry.setAttribute('aPhi', new THREE.BufferAttribute(phis, 1));
            geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: this.uniforms.time,
                    uPulseTimer: { value: -100.0 },
                },
                vertexShader: auroraSparkVertexShader,
                fragmentShader: auroraSparkFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const sparks = new THREE.Points(geometry, material);
            this.mainGroup.add(sparks);
            this.auroraSparks.push(sparks);
        }

        console.log(`[Aurora3D] Aurora sparks pool created with ${poolSize} systems, ${countPerSystem} particles each`);
    }

    triggerAuroraSparks() {
        // Trigger the next spark system in the pool
        if (this.auroraSparks.length === 0) return;

        const sparks = this.auroraSparks[this.auroraSparkIndex];
        if (sparks && sparks.material.uniforms) {
            sparks.material.uniforms.uPulseTimer.value = 0.0;
        }

        // Cycle to next system in pool
        this.auroraSparkIndex = (this.auroraSparkIndex + 1) % this.auroraSparks.length;
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsedTime;

        // Slow star rotation
        if (this.starSystem) {
            this.starSystem.rotation.y = elapsedTime * 0.005;
            this.starSystem.rotation.z = Math.sin(elapsedTime * 0.02) * 0.02;
        }

        // Subtle drift for main group
        if (this.mainGroup) {
            const driftTime = elapsedTime * 0.08;
            this.mainGroup.position.x = Math.sin(driftTime) * 1.5;
            this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.8;
            this.mainGroup.rotation.z = Math.sin(driftTime * 0.3) * 0.02;
        }

        // Slow camera orbit for parallax depth (matches other themes)
        if (this.camera) {
            const cameraTime = elapsedTime * 0.06; // Slow but noticeable orbit
            const orbitRadiusX = 8; // Wide horizontal sway
            const orbitRadiusY = 6; // Vertical sway range
            const orbitRadiusZ = 5; // Depth breathing

            // Orbital sway - creates parallax with starfield/aurora
            this.camera.position.x = Math.sin(cameraTime) * orbitRadiusX
                + Math.cos(cameraTime * 0.7) * orbitRadiusX * 0.4;
            this.camera.position.y = -5 + Math.cos(cameraTime * 0.8) * orbitRadiusY
                + Math.sin(cameraTime * 0.5) * orbitRadiusY * 0.3;
            this.camera.position.z = 15 + Math.sin(cameraTime * 0.6) * orbitRadiusZ;

            // LookAt drift for dynamic framing
            const lookOffsetX = Math.sin(cameraTime * 0.4) * 4;
            const lookOffsetY = 5 + Math.cos(cameraTime * 0.5) * 3;
            const lookOffsetZ = -5 + Math.sin(cameraTime * 0.3) * 3;
            this.camera.lookAt(lookOffsetX, lookOffsetY, lookOffsetZ);
        }

        // Decay intensity back to baseline
        if (this.uniforms.intensity.value > 1.0) {
            this.uniforms.intensity.value = THREE.MathUtils.lerp(
                this.uniforms.intensity.value,
                1.0,
                delta * 1.5,
            );
        }

        // Decay combo wave back to zero
        if (this.uniforms.comboWave.value > 0.0) {
            this.uniforms.comboWave.value = THREE.MathUtils.lerp(
                this.uniforms.comboWave.value,
                0.0,
                delta * 2.0,
            );
            if (this.uniforms.comboWave.value < 0.01) {
                this.uniforms.comboWave.value = 0.0;
            }
        }

        // Update shooting stars
        this.updateShootingStars(delta);

        // Update pulse waves
        this.updatePulseWaves(delta);

        // Update aurora sparks pool (slower progression)
        for (const sparks of this.auroraSparks) {
            if (sparks && sparks.material.uniforms) {
                // Progress pulse timer (slower for gentler effect)
                if (sparks.material.uniforms.uPulseTimer.value > -50.0) {
                    sparks.material.uniforms.uPulseTimer.value += delta * 5.0;

                    // Reset when animation completes
                    if (sparks.material.uniforms.uPulseTimer.value > 65.0) {
                        sparks.material.uniforms.uPulseTimer.value = -100.0;
                    }
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    createShootingStar() {
        const trailLength = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(trailLength * 3);
        const progress = new Float32Array(trailLength);

        // Random start position in upper area
        const startX = (Math.random() - 0.5) * 60;
        const startY = 20 + Math.random() * 15;
        const startZ = -10 - Math.random() * 20;

        // Random direction (downward diagonal)
        const dirX = (Math.random() - 0.5) * 2 - 0.5;
        const dirY = -1 - Math.random() * 0.5;
        const dirZ = (Math.random() - 0.5);

        for (let i = 0; i < trailLength; i++) {
            positions[i * 3] = startX;
            positions[i * 3 + 1] = startY;
            positions[i * 3 + 2] = startZ;
            progress[i] = i / trailLength;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xaaffdd) }, // Pale green-white
                opacity: { value: 1.0 },
            },
            vertexShader: shootingStarVertexShader,
            fragmentShader: shootingStarFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const star = new THREE.Points(geometry, material);
        star.userData = {
            direction: new THREE.Vector3(dirX, dirY, dirZ).normalize(),
            speed: 30 + Math.random() * 20,
            life: 1.5,
            maxLife: 1.5,
            headPosition: new THREE.Vector3(startX, startY, startZ),
        };

        this.scene.add(star);
        this.shootingStars.push(star);
    }

    updateShootingStars(delta) {
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            const data = star.userData;

            data.life -= delta;

            // Move the head
            data.headPosition.addScaledVector(data.direction, data.speed * delta);

            // Update trail positions (shift down, add new head)
            const positions = star.geometry.attributes.position.array;
            const trailLength = positions.length / 3;

            // Shift existing points
            for (let j = trailLength - 1; j > 0; j--) {
                positions[j * 3] = positions[(j - 1) * 3];
                positions[j * 3 + 1] = positions[(j - 1) * 3 + 1];
                positions[j * 3 + 2] = positions[(j - 1) * 3 + 2];
            }

            // Set new head position
            positions[0] = data.headPosition.x;
            positions[1] = data.headPosition.y;
            positions[2] = data.headPosition.z;

            star.geometry.attributes.position.needsUpdate = true;

            // Fade out
            star.material.uniforms.opacity.value = data.life / data.maxLife;

            // Remove if dead
            if (data.life <= 0) {
                this.scene.remove(star);
                star.geometry.dispose();
                star.material.dispose();
                this.shootingStars.splice(i, 1);
            }
        }
    }

    createPulseWave(intensity) {
        const geometry = new THREE.TorusGeometry(5, 0.3, 8, 64);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                opacity: { value: 0.8 },
                color: { value: new THREE.Color(0x00ffaa) },
            },
            vertexShader: pulseWaveVertexShader,
            fragmentShader: pulseWaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.position.set(0, 10, -15);
        wave.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;

        wave.userData = {
            speed: 4 + intensity * 1.5,
            life: 2.0,
            maxLife: 2.0,
        };

        this.mainGroup.add(wave);
        this.pulseWaves.push(wave);
    }

    updatePulseWaves(delta) {
        for (let i = this.pulseWaves.length - 1; i >= 0; i--) {
            const wave = this.pulseWaves[i];
            const data = wave.userData;

            data.life -= delta;

            // Expand
            const expansion = data.speed * delta;
            wave.scale.x += expansion * 0.5;
            wave.scale.y += expansion * 0.5;
            wave.scale.z += expansion * 0.3;

            // Fade out
            wave.material.uniforms.opacity.value = (data.life / data.maxLife) * 0.6;

            if (data.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.pulseWaves.splice(i, 1);
            }
        }
    }

    setupEventListeners() {
        // Line Clear - aurora intensifies
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            this.uniforms.intensity.value += data.lineCount * 0.3;
            if (data.lineCount >= 2) {
                this.createPulseWave(data.lineCount);
            }
        });

        // Combo - aurora sway, shooting stars, and aurora spark explosions
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            this.uniforms.intensity.value += 0.2;

            // Trigger aurora sway/wave effect
            this.uniforms.comboWave.value = Math.min(1.0, 0.3 + data.comboCount * 0.15);

            if (data.comboCount >= 2) {
                this.createShootingStar();
                // Trigger aurora spark explosion
                this.triggerAuroraSparks();
            }
            if (data.comboCount >= 4) {
                this.createShootingStar(); // Extra shooting star for big combos
                this.triggerAuroraSparks(); // Extra spark explosion for big combos
            }
        });

        // Piece Lock - subtle shimmer
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (!this.isActive) return;
            this.uniforms.intensity.value += 0.08;
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
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

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Cleanup shooting stars
        this.shootingStars.forEach((star) => {
            this.scene.remove(star);
            star.geometry.dispose();
            star.material.dispose();
        });
        this.shootingStars = [];

        // Cleanup pulse waves
        this.pulseWaves.forEach((wave) => {
            this.mainGroup.remove(wave);
            wave.geometry.dispose();
            wave.material.dispose();
        });
        this.pulseWaves = [];

        // Cleanup aurora sparks pool
        this.auroraSparks.forEach((sparks) => {
            this.mainGroup.remove(sparks);
            sparks.geometry.dispose();
            sparks.material.dispose();
        });
        this.auroraSparks = [];

        // Cleanup renderer
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('aurora-theme');
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

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null;
        this.auroraCurtains = [];
        this.starSystem = null;
        this.nebulaParticles = null;
    }

    getTetrominoConfig() {
        return AURORA_TETROMINOS;
    }
}
