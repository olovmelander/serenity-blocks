import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SUPERNOVA_TETROMINOS } from './supernova-tetrominos.js';
import { coreVertexShader, coreFragmentShader, shockwaveVertexShader, shockwaveFragmentShader, particleFragmentShader } from './supernova-shaders.js';

export default class SupernovaTheme extends BaseTheme {
    constructor() {
        super('supernova');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mainGroup = null; // Container for drifting elements
        this.coreMesh = null;
        this.starSystem = null;
        this.shockwaves = [];
        this.flares = []; // Solar flares
        this.particles = null;

        // Animation loop
        this.animationFrame = null;
        this.clock = new THREE.Clock();

        // State
        this.uniforms = {
            time: { value: 0 },
            coreIntensity: { value: 1.0 },
            coreColorPrimary: { value: new THREE.Color(0xFF0033) }, // Deep Nebula Red
            coreColorSecondary: { value: new THREE.Color(0xFFD700) }, // Solar Gold
            coreColorTertiary: { value: new THREE.Color(0x0088FF) }, // Electric Blue (Outer)
        };

        // Theme palette for random effects
        this.palette = [
            new THREE.Color(0xFF3333), // Red
            new THREE.Color(0x0088FF), // Blue
            new THREE.Color(0xFFAA00), // Gold
            new THREE.Color(0x00FF88), // Mint
            new THREE.Color(0xFF00FF), // Magenta
            new THREE.Color(0x00FFFF)  // Cyan
        ];
    }

    getRandomThemeColor() {
        return this.palette[Math.floor(Math.random() * this.palette.length)];
    }

    async createScene() {
        console.log('[Supernova] Initializing Three.js scene...');

        const container = document.getElementById('supernova-theme');
        if (!container) {
            console.error('[Supernova] Container not found');
            return;
        }

        // Clean up previous elements if any (fallback)
        container.innerHTML = '';

        // -- Setup Scene --
        this.scene = new THREE.Scene();
        // Deep space fog
        this.scene.fog = new THREE.FogExp2(0x050011, 0.002);

        // -- Setup Camera --
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 20;

        // -- Setup Renderer --
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: this.getAntialiasEnabled(),
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);

        // -- Create Elements --
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        this.createCore();
        this.createStars(); // Stars stay in root scene (background)
        this.createNebulaParticles();
        this.setupLighting();

        // -- Setup Listeners --
        this.setupEventListeners();
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // -- Start Loop --
        this.animate();

        console.log('[Supernova] Scene initialized.');
    }

    createCore() {
        const geometry = new THREE.SphereGeometry(3, 64, 64);

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
            transparent: true,
            side: THREE.FrontSide,
            blending: THREE.AdditiveBlending
        });

        this.coreMesh = new THREE.Mesh(geometry, material);
        this.mainGroup.add(this.coreMesh);

        // Add a simple glow sprite behind/around the core for extra bloom
        const spriteMaterial = new THREE.SpriteMaterial({
            map: this.createGlowTexture(),
            color: 0xffaa00, // Golden-orange glow
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false // Prevent writing to depth buffer to avoid sorting issues
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(16, 16, 1); // Slightly larger
        this.coreMesh.add(sprite); // Attach to core so it moves with it
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64; // Increased resolution
        canvas.height = 64;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 100, 100, 0.8)'); // Red center
        gradient.addColorStop(0.3, 'rgba(255, 0, 255, 0.3)'); // Magenta mid
        gradient.addColorStop(0.6, 'rgba(0, 100, 255, 0.15)'); // Blue outer
        gradient.addColorStop(1, 'rgba(0,0,0,0)'); // Transparency at edge
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    createStars() {
        const starsGeometry = new THREE.BufferGeometry();
        const starsCount = 2000;

        const posArray = new Float32Array(starsCount * 3);
        const colorArray = new Float32Array(starsCount * 3);

        const colors = [
            new THREE.Color(0xFF3333), // Red
            new THREE.Color(0x0088FF), // Blue
            new THREE.Color(0xFFAA00), // Gold
            new THREE.Color(0x00FF88)  // Mint/Green hint from image
        ];

        for (let i = 0; i < starsCount * 3; i += 3) {
            // Spread stars in a wide volume
            posArray[i] = (Math.random() - 0.5) * 100;   // x
            posArray[i + 1] = (Math.random() - 0.5) * 100; // y
            posArray[i + 2] = (Math.random() - 0.5) * 80 - 10; // z (mostly behind)

            const color = colors[Math.floor(Math.random() * colors.length)];
            colorArray[i] = color.r;
            colorArray[i + 1] = color.g;
            colorArray[i + 2] = color.b;
        }

        starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        starsGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

        const material = new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.starSystem = new THREE.Points(starsGeometry, material);
        this.scene.add(this.starSystem);
    }

    createNebulaParticles() {
        const particleCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const randoms = new Float32Array(particleCount); // For phase offset

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            // Orbiting ring shape
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 10;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = (Math.random() - 0.5) * 2; // Flattened disc
            positions[i3 + 2] = Math.sin(angle) * radius;

            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        // Use a simple shader-like material for particles
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                color: { value: new THREE.Color(0x00FFFF) }, // Cyan particles (shockwave debris)
                opacity: { value: 0.6 }
            },
            vertexShader: `
                uniform float time;
                attribute float aRandom;
                varying float vAlpha;
                void main() {
                    vec3 pos = position;
                    // Orbit rotation
                    float angle = time * 0.1 * (1.0 + aRandom);
                    float s = sin(angle);
                    float c = cos(angle);
                    vec3 rotatedPos = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
                    
                    // Gentle floatiness
                    rotatedPos.y += sin(time + aRandom * 10.0) * 0.5;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Size attenuation
                    gl_PointSize = (4.0 * aRandom + 2.0) * (20.0 / -mvPosition.z);
                    
                    vAlpha = 0.5 + 0.5 * sin(time * 2.0 + aRandom * 10.0);
                }
            `,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, material);
        this.mainGroup.add(this.particles);
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x404040, 1.0); // Soft purple ambient
        this.scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xff6600, 2, 80);
        pointLight.position.set(0, 0, 0); // Light from the core
        this.mainGroup.add(pointLight); // Light moves with the core
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsedTime;

        // Rotate stars slowly
        if (this.starSystem) {
            this.starSystem.rotation.y = elapsedTime * 0.02;
            this.starSystem.rotation.z = elapsedTime * 0.005;
        }

        // Pulse core intensity decay
        if (this.uniforms.coreIntensity.value > 1.0) {
            this.uniforms.coreIntensity.value = THREE.MathUtils.lerp(this.uniforms.coreIntensity.value, 1.0, delta * 2.0);
        }

        // Subtle drift for the core group
        if (this.mainGroup) {
            // Slow, complex figure-8-like drift
            const time = elapsedTime * 0.15; // Very slow
            this.mainGroup.position.x = Math.sin(time) * 3.0 + Math.cos(time * 0.7) * 1.5;
            this.mainGroup.position.y = Math.cos(time * 0.8) * 2.0 + Math.sin(time * 0.4) * 1.0;

            // Also gently rotate the whole group
            this.mainGroup.rotation.z = Math.sin(time * 0.2) * 0.1;
        }

        // Update shockwaves and flares
        this.updateShockwaves(delta);
        this.updateFlares(delta);

        this.renderer.render(this.scene, this.camera);
    }

    updateShockwaves(delta) {
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.scale.addScalar(wave.userData.speed * delta);
            wave.userData.life -= delta;

            // Fade out
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
        const geometry = new THREE.TorusGeometry(3.5, 0.1, 8, 50);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: this.uniforms.time,
                opacity: { value: 1.0 },
                color: { value: this.getRandomThemeColor() } // Random palette color
            },
            vertexShader: shockwaveVertexShader,
            fragmentShader: shockwaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.random() * Math.PI; // Random orientation
        wave.rotation.y = Math.random() * Math.PI;

        wave.userData = {
            speed: 5.0 + intensity * 2.0,
            life: 1.0,
            maxLife: 1.0
        };

        this.mainGroup.add(wave);
        this.shockwaves.push(wave);
    }

    createSolarFlare() {
        if (!this.mainGroup) return;

        const particleCount = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        // Pick a random direction for the burst
        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        for (let i = 0; i < particleCount; i++) {
            // Start near core surface
            positions[i * 3] = dirX * 2.0 + (Math.random() - 0.5);
            positions[i * 3 + 1] = dirY * 2.0 + (Math.random() - 0.5);
            positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;

            // Explosion velocity
            const speed = 5.0 + Math.random() * 10.0;
            const spread = 0.5;
            velocities.push({
                x: dirX * speed + (Math.random() - 0.5) * spread,
                y: dirY * speed + (Math.random() - 0.5) * spread,
                z: (Math.random() - 0.5) * spread * 2.0
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: this.getRandomThemeColor(), // Random palette color
            size: 0.4,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending
        });

        const flare = new THREE.Points(geometry, material);
        flare.userData = {
            velocities: velocities,
            life: 0.6, // Short life
            maxLife: 0.6
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

            // Move particles
            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * delta;
                positions[j * 3 + 1] += velocities[j].y * delta;
                positions[j * 3 + 2] += velocities[j].z * delta;
            }
            flare.geometry.attributes.position.needsUpdate = true;

            // Fade out
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
        // Line Clear
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) this.onLineClear(data.lineCount);
        });

        // Combo
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) this.onCombo(data.comboCount);
        });

        // Piece Lock
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) this.onPieceLock(data.piece);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(count) {
        // Boost core intensity
        this.uniforms.coreIntensity.value += count * 0.5;
        // Create shockwave
        this.createShockwave(count);
    }

    onCombo(count) {
        if (count > 1) {
            this.uniforms.coreIntensity.value += 0.3;
            // Create a faster expanding wave for combos
            this.createShockwave(count * 0.5);
        }
    }

    onPieceLock(piece) {
        // Tiny pulse
        this.uniforms.coreIntensity.value += 0.2;
        // Directional solar flare
        this.createSolarFlare();
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

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('supernova-theme');
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
        this.shockwaves = [];
        this.flares = [];
    }

    getTetrominoConfig() {
        return SUPERNOVA_TETROMINOS;
    }
}
