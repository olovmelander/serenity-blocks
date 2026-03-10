/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ELECTRIC DREAMS THEME - Three.js 3D Lava Lamp Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A premium lava lamp experience with floating, morphing blobs across the screen.
 * Features:
 * - 3D blob meshes with custom glow shaders
 * - Authentic lava lamp physics - viscous, organic floating
 * - Dynamic lighting and subsurface scattering effect
 * - Bloom post-processing for premium glow
 * - Full-screen blob movement
 * - Performance-optimized Three.js rendering
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { ELECTRIC_DREAMS_TETROMINOS } from './electric-dreams-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        blobCount: 18, particleCount: 200, bloomStrength: 0.8, enablePost: true,
    },
    Ultra: {
        blobCount: 14, particleCount: 150, bloomStrength: 0.7, enablePost: true,
    },
    High: {
        blobCount: 12, particleCount: 100, bloomStrength: 0.6, enablePost: true,
    },
    Medium: {
        blobCount: 8, particleCount: 60, bloomStrength: 0.5, enablePost: true,
    },
    Low: {
        blobCount: 6, particleCount: 40, bloomStrength: 0.4, enablePost: false,
    },
    Minimal: {
        blobCount: 4, particleCount: 20, bloomStrength: 0.3, enablePost: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palette - Premium Lava Lamp Colors
// ─────────────────────────────────────────────────────────────────────────────
const BLOB_COLORS = [
    new THREE.Color(0x00ffcc), // Electric Cyan
    new THREE.Color(0xff00ff), // Neon Magenta
    new THREE.Color(0x00ff88), // Acid Green
    new THREE.Color(0xff6600), // Hot Orange
    new THREE.Color(0x0088ff), // Electric Blue
    new THREE.Color(0xffcc00), // Amber Gold
    new THREE.Color(0xff0066), // Hot Pink
    new THREE.Color(0x8800ff), // Electric Purple
];

// ─────────────────────────────────────────────────────────────────────────────
// Blob Shader - Subsurface Scattering & Glow
// ─────────────────────────────────────────────────────────────────────────────
const BlobShader = {
    uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x00ffcc) },
        uPulseIntensity: { value: 0 },
        uMorphFactor: { value: 0 },
    },
    vertexShader: `
        uniform float uTime;
        uniform float uMorphFactor;
        
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vNoise;
        
        // Simplex-like noise for deformation
        float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        
        float noise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            
            return mix(
                mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                    mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                    mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        
        // Fractal Brownian Motion for more organic shapes
        float fbm(vec3 p) {
            float value = 0.0;
            float amplitude = 0.5;
            float frequency = 1.0;
            for (int i = 0; i < 4; i++) {
                value += amplitude * noise(p * frequency);
                amplitude *= 0.5;
                frequency *= 2.0;
            }
            return value;
        }
        
        void main() {
            // Morphing deformation
            vec3 pos = position;
            
            // Multi-layer organic deformation
            float slowTime = uTime * 0.15;
            
            // Primary large-scale morphing
            float n1 = fbm(pos * 0.8 + slowTime * 0.3);
            // Secondary smaller detail
            float n2 = noise(pos * 2.0 + slowTime * 0.5) * 0.5;
            // Tertiary fine detail
            float n3 = noise(pos * 4.0 - slowTime * 0.2) * 0.25;
            
            float totalNoise = n1 + n2 + n3;
            
            // Displacement based on morph factor - much stronger effect
            float displacement = totalNoise * 0.25 * (0.5 + uMorphFactor * 1.5);
            
            // Gentle breathing/pulsing
            float breathe = sin(uTime * 0.4) * 0.04 + sin(uTime * 0.23) * 0.02;
            
            pos += normal * (displacement + breathe);
            
            // Recalculate normal after displacement (approximation)
            vNormal = normalize(normalMatrix * normal);
            
            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            vNoise = totalNoise;
            
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uPulseIntensity;
        
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vNoise;
        
        void main() {
            // Subsurface scattering simulation
            float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
            float sss = pow(rim, 2.0);
            
            // Core glow - softer center
            float coreGlow = 0.5 + 0.2 * (1.0 - rim);
            
            // Pulsing - subtle
            float pulse = 1.0 + sin(uTime * 1.5) * 0.05 * (1.0 + uPulseIntensity * 0.3);
            
            // Internal light variation
            float internalLight = 0.7 + vNoise * 0.2;
            
            // Fresnel rim highlight - reduced
            float fresnel = pow(rim, 3.0);
            
            // Combine with reduced multipliers
            vec3 baseColor = uColor * internalLight * pulse;
            vec3 rimColor = vec3(1.0) * fresnel * 0.3;
            vec3 sssColor = uColor * sss * 0.2;
            
            vec3 finalColor = baseColor * coreGlow + rimColor + sssColor;
            
            // Boost during combo - much more subtle
            finalColor *= (1.0 + uPulseIntensity * 0.15);
            
            gl_FragColor = vec4(finalColor, 0.97);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Particle Shader - Electric Sparks
// ─────────────────────────────────────────────────────────────────────────────
const SparkShader = {
    uniforms: {
        uTime: { value: 0 },
        uComboIntensity: { value: 0 },
        uComboSpeedBoost: { value: 1 },
        uComboSizeBoost: { value: 1 },
    },
    vertexShader: `
        attribute float size;
        attribute float phase;
        attribute vec3 color;
        
        uniform float uTime;
        uniform float uComboIntensity;
        uniform float uComboSpeedBoost;
        uniform float uComboSizeBoost;
        
        varying vec3 vColor;
        varying float vAlpha;
        varying float vComboGlow;
        
        void main() {
            vColor = color;
            vComboGlow = uComboIntensity;
            
            vec3 pos = position;
            
            // Speed scales with combo!
            float speed = 0.1 * uComboSpeedBoost;
            float t = mod(uTime * speed + phase, 1.0);
            
            // Larger movement during combo
            float moveMult = 1.0 + uComboIntensity * 0.5;
            pos.y += (t * 60.0 - 30.0) * moveMult;
            pos.x += sin(uTime * 0.5 * uComboSpeedBoost + phase * 10.0) * 5.0 * moveMult;
            pos.z += cos(uTime * 0.3 * uComboSpeedBoost + phase * 8.0) * 3.0 * moveMult;
            
            // Explosive scatter during combo
            if (uComboIntensity > 0.1) {
                float scatter = uComboIntensity * 3.0;
                pos.x += sin(phase * 50.0 + uTime * 2.0) * scatter;
                pos.y += cos(phase * 40.0 + uTime * 1.5) * scatter;
                pos.z += sin(phase * 30.0 + uTime * 1.8) * scatter * 0.5;
            }
            
            // Alpha - slightly brighter during combo
            vAlpha = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.75, t);
            vAlpha *= (1.0 + uComboIntensity * 0.5); // Subtle brightness boost
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            
            // Size boost during combo!
            float comboSize = size * uComboSizeBoost;
            gl_PointSize = comboSize * (400.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vComboGlow;
        
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float dist = length(coord);
            if (dist > 0.5) discard;
            
            // Soft glow
            float glow = 1.0 - smoothstep(0.0, 0.5, dist);
            glow = pow(glow, 2.0 - vComboGlow * 0.3); // Subtle softer falloff during combo
            
            // Slight color shift during combo - less white flash
            vec3 finalColor = mix(vColor, vec3(1.0), vComboGlow * 0.2);
            
            // Moderate brightness multiplier during combo
            float brightness = 1.2 + vComboGlow * 0.6;
            
            gl_FragColor = vec4(finalColor * glow * brightness, vAlpha * glow);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class ElectricDreamsTheme extends BaseTheme {
    constructor() {
        super('electric-dreams');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.time = 0;

        this.blobs = [];
        this.sparks = null;
        this.backgroundMesh = null;
        this.screenBounds = { width: 30, height: 20 };

        this.pulseIntensity = 0;
        this.targetPulse = 0;
        this.glowFlash = 0; // Immediate flash effect
        this.targetBloom = 0.6; // Dynamic bloom target
        this.baseBloomStrength = 0.6;

        // Combo-specific dramatic effects
        this.comboIntensity = 0; // Current combo effect strength
        this.comboColorFlash = 0; // White/bright color overlay
        this.comboScaleBoost = 0; // Blob size expansion
        this.comboSpeedBoost = 0; // Movement speed multiplier

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
    }

    getTetrominoConfig() {
        return ELECTRIC_DREAMS_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        console.log(`⚡ Electric Dreams: Applying ${quality} preset`);
    }

    async createScene() {
        if (typeof document === 'undefined') return;

        this.applyQualityPreset(this.getCurrentQualityLevel());

        const container = document.getElementById('electric-dreams-theme');
        if (!container) {
            console.error('⚡ Electric Dreams: Container not found');
            return;
        }

        this.initRenderer(container);
        this.createBackground();
        this.createBlobs();
        this.createSparkSystem();
        this.setupLighting();
        this.setupPostProcessing();
        this.setupEventListeners();

        console.log('⚡ Electric Dreams: Scene created with', this.blobs.length, 'blobs');
        this.startAnimation();
    }

    initRenderer(container) {
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0015, 0.002);

        // Camera positioned for full screen blobs
        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
        this.camera.position.set(0, 0, 50);
        this.camera.lookAt(0, 0, 0);

        // Calculate screen bounds
        this.screenBounds = this.calculateScreenBounds();
    }

    calculateScreenBounds() {
        const vFov = this.camera.fov * Math.PI / 180;
        const height = 2 * Math.tan(vFov / 2) * this.camera.position.z;
        const width = height * this.camera.aspect;
        return { width: width * 0.55, height: height * 0.55 };
    }

    createBackground() {
        const bgGeo = new THREE.SphereGeometry(200, 32, 24);
        const bgMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vWorldPos;
                
                void main() {
                    float y = normalize(vWorldPos).y;
                    
                    // Near-black background with very subtle color
                    vec3 deepPurple = vec3(0.01, 0.0, 0.02);
                    vec3 darkBlue = vec3(0.0, 0.005, 0.02);
                    vec3 pureBlack = vec3(0.005, 0.002, 0.01);
                    
                    vec3 color = mix(pureBlack, deepPurple, smoothstep(-1.0, 0.0, y) * 0.3);
                    color = mix(color, darkBlue, smoothstep(0.0, 1.0, y) * 0.2);
                    
                    // Very subtle animated nebula
                    float nebula = sin(y * 5.0 + uTime * 0.08) * cos(normalize(vWorldPos).x * 3.0 + uTime * 0.1);
                    nebula = pow(max(0.0, nebula), 10.0) * 0.02;
                    color += vec3(0.05, 0.0, 0.08) * nebula;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            fog: false,
        });
        this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
        this.scene.add(this.backgroundMesh);
    }

    createBlobs() {
        const count = this.qualityPreset.blobCount;

        for (let i = 0; i < count; i++) {
            this.createBlob(i);
        }
    }

    createBlob(index) {
        // Varied sizes
        const scale = 2.5 + Math.random() * 4.5;

        // Higher detail sphere for smooth morphing
        const geo = new THREE.IcosahedronGeometry(scale, 5);

        // Clone shader uniforms for each blob
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: BLOB_COLORS[index % BLOB_COLORS.length].clone() },
                uPulseIntensity: { value: 0 },
                uMorphFactor: { value: 0 },
            },
            vertexShader: BlobShader.vertexShader,
            fragmentShader: BlobShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
        });

        const blob = new THREE.Mesh(geo, mat);

        // Random position across full screen with depth
        const bounds = this.screenBounds;
        blob.position.set(
            (Math.random() - 0.5) * bounds.width * 2,
            (Math.random() - 0.5) * bounds.height * 2,
            (Math.random() - 0.5) * 30 - 5,
        );

        // Weightless drift physics - each blob has unique movement pattern
        const blobData = {
            mesh: blob,
            scale,
            // Unique phase offsets for each axis (creates unique paths)
            phaseX: Math.random() * Math.PI * 2,
            phaseY: Math.random() * Math.PI * 2,
            phaseZ: Math.random() * Math.PI * 2,
            // Unique frequencies for dreamy non-repeating motion
            freqX: 0.15 + Math.random() * 0.2,
            freqY: 0.12 + Math.random() * 0.18,
            freqZ: 0.1 + Math.random() * 0.15,
            // Amplitude of drift in each direction
            ampX: 0.5 + Math.random() * 0.6,
            ampY: 0.4 + Math.random() * 0.5,
            ampZ: 0.25 + Math.random() * 0.35,
            // Secondary wave for complex motion
            freq2X: 0.05 + Math.random() * 0.08,
            freq2Y: 0.04 + Math.random() * 0.06,
            // Rotation speeds (very slow)
            rotSpeedX: (Math.random() - 0.5) * 0.002,
            rotSpeedY: (Math.random() - 0.5) * 0.003,
            rotSpeedZ: (Math.random() - 0.5) * 0.001,
            // Morph intensity unique to each blob
            morphBase: 0.3 + Math.random() * 0.4,
            morphPhase: Math.random() * Math.PI * 2,
            // Scale pulsing
            scalePhase: Math.random() * Math.PI * 2,
            baseScale: scale,
        };

        this.scene.add(blob);
        this.blobs.push(blobData);
    }

    createSparkSystem() {
        const count = this.qualityPreset.particleCount;

        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        const bounds = this.screenBounds;
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * bounds.width * 2;
            positions[i * 3 + 1] = (Math.random() - 0.5) * bounds.height * 2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 40;

            sizes[i] = 3 + Math.random() * 6;
            phases[i] = Math.random();

            const color = BLOB_COLORS[Math.floor(Math.random() * BLOB_COLORS.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uComboIntensity: { value: 0 },
                uComboSpeedBoost: { value: 1 },
                uComboSizeBoost: { value: 1 },
            },
            vertexShader: SparkShader.vertexShader,
            fragmentShader: SparkShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sparks = new THREE.Points(geo, mat);
        this.scene.add(this.sparks);
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x201030, 0.4);
        this.scene.add(ambient);

        // Main point light in center
        const coreLight = new THREE.PointLight(0x00ffcc, 0.8, 80);
        coreLight.position.set(0, 0, 10);
        this.scene.add(coreLight);
        this.coreLight = coreLight;

        // Rim lights
        const rim1 = new THREE.PointLight(0xff00ff, 0.3, 60);
        rim1.position.set(-25, 10, 20);
        this.scene.add(rim1);

        const rim2 = new THREE.PointLight(0x0088ff, 0.3, 60);
        rim2.position.set(25, -10, 20);
        this.scene.add(rim2);
    }

    setupPostProcessing() {
        if (!this.qualityPreset.enablePost) return;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.5,
            0.15,
        );
        this.composer.addPass(bloomPass);
        this.bloomPass = bloomPass;
    }

    setupEventListeners() {
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive) {
                // Quick flash on piece lock
                this.targetPulse = Math.min(this.targetPulse + 0.3, 1.0);
                this.glowFlash = 0.6;
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                const count = data?.comboCount || 1;

                // === DRAMATIC COMBO EFFECTS ===
                // Intensity scales with combo count
                this.comboIntensity = Math.min(0.5 + count * 0.25, 2.0);

                // White color flash - blobs briefly flash bright
                this.comboColorFlash = Math.min(0.4 + count * 0.15, 1.0);

                // Scale explosion - blobs grow dramatically
                this.comboScaleBoost = Math.min(0.3 + count * 0.15, 1.0);

                // Speed boost - blobs move faster during combo
                this.comboSpeedBoost = Math.min(1.0 + count * 0.5, 3.0);

                // Strong glow
                this.targetPulse = Math.min(0.8 + count * 0.3, 2.5);
                this.glowFlash = Math.min(0.8 + count * 0.4, 2.0);

                // Massive bloom boost
                if (this.bloomPass) {
                    this.targetBloom = Math.min(1.2 + count * 0.3, 2.5);
                }
            }
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                const lines = data?.lineCount || 1;

                // Line clears also trigger dramatic effects (especially for Tetris)
                const intensity = lines === 4 ? 1.5 : lines * 0.3; // Tetris = big boom

                this.comboIntensity = Math.max(this.comboIntensity, intensity);
                this.comboColorFlash = Math.min(this.comboColorFlash + lines * 0.15, 1.0);
                this.comboScaleBoost = Math.min(this.comboScaleBoost + lines * 0.1, 0.8);

                this.targetPulse = Math.min(this.targetPulse + lines * 0.4, 2.5);
                this.glowFlash = Math.min(0.5 + lines * 0.3, 1.8);

                if (this.bloomPass) {
                    this.targetBloom = Math.min(1.0 + lines * 0.25, 2.0);
                }
            }
        });

        this.eventUnsubscribers.push(pieceLockUnsub, comboUnsub, lineClearUnsub);

        if (!this.boundResizeHandler) {
            this.boundResizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        }
        window.addEventListener('resize', this.boundResizeHandler);
    }

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            // Decay pulse intensity - smooth feel
            this.pulseIntensity += (this.targetPulse - this.pulseIntensity) * 0.05;
            this.targetPulse *= 0.99;

            // Decay glow flash quickly (for immediate pop effect)
            this.glowFlash *= 0.92;

            // === DECAY COMBO EFFECTS ===
            this.comboIntensity *= 0.97; // Slower decay for sustained effect
            this.comboColorFlash *= 0.94; // Medium decay for color flash
            this.comboScaleBoost *= 0.96; // Slow decay for scale
            this.comboSpeedBoost = 1.0 + (this.comboSpeedBoost - 1.0) * 0.95; // Decay back to 1.0

            // Animate bloom strength - responds to combo
            if (this.bloomPass) {
                const comboBloomBoost = this.comboIntensity * 0.4;
                const targetBloom = this.baseBloomStrength + this.glowFlash * 0.5 + comboBloomBoost;
                this.bloomPass.strength += (targetBloom - this.bloomPass.strength) * 0.08;
                // Decay targetBloom back to base
                this.targetBloom += (this.baseBloomStrength - this.targetBloom) * 0.02;
            }

            // Update blobs with lava lamp physics
            this.updateBlobs();

            // Update spark particles - with combo effects!
            if (this.sparks) {
                this.sparks.material.uniforms.uTime.value = this.time;
                this.sparks.material.uniforms.uComboIntensity.value = this.comboIntensity;
                this.sparks.material.uniforms.uComboSpeedBoost.value = this.comboSpeedBoost;
                this.sparks.material.uniforms.uComboSizeBoost.value = 1.0 + this.comboScaleBoost * 1.5; // Up to 2.5x size
            }

            // Update background
            if (this.backgroundMesh) {
                this.backgroundMesh.material.uniforms.uTime.value = this.time;
            }

            // Update core light - responds strongly to combos
            if (this.coreLight) {
                const hue = (this.time * 0.03) % 1;
                // Flash to white during combo
                const saturation = Math.max(0.3, 0.8 - this.comboColorFlash * 0.5);
                const lightness = 0.5 + this.glowFlash * 0.3 + this.comboColorFlash * 0.4;
                this.coreLight.color.setHSL(hue, saturation, Math.min(lightness, 1.0));
                // Strong intensity boost during combo
                this.coreLight.intensity = 0.6 + this.pulseIntensity * 0.6 + this.glowFlash * 1.5 + this.comboIntensity * 2.0;
            }

            // Render
            if (this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            const animId = requestAnimationFrame(animate);
            this.registerAnimation(animId);
        };
        requestAnimationFrame(animate);
    }

    updateBlobs() {
        const bounds = this.screenBounds;
        const t = this.time;

        // === PROXIMITY DETECTION - Calculate interaction between blobs ===
        // First pass: calculate proximity influence for each blob
        for (let i = 0; i < this.blobs.length; i++) {
            this.blobs[i].proximityBoost = 0;
            this.blobs[i].nearestDir = { x: 0, y: 0, z: 0 };
        }

        for (let i = 0; i < this.blobs.length; i++) {
            for (let j = i + 1; j < this.blobs.length; j++) {
                const blobA = this.blobs[i];
                const blobB = this.blobs[j];
                const meshA = blobA.mesh;
                const meshB = blobB.mesh;

                // Calculate distance between blob centers
                const dx = meshB.position.x - meshA.position.x;
                const dy = meshB.position.y - meshA.position.y;
                const dz = meshB.position.z - meshA.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                // Combined radii (with scale factor)
                const combinedRadii = (blobA.scale + blobB.scale) * 1.5;

                // === SOFT REPULSION at very close range (prevents sticking) ===
                const minDist = combinedRadii * 0.6; // Minimum comfortable distance
                if (dist < minDist && dist > 0.1) {
                    const repelStrength = (minDist - dist) / minDist * 0.02;
                    const invDist = 1 / dist;
                    // Push blobs apart
                    meshA.position.x -= dx * invDist * repelStrength;
                    meshA.position.y -= dy * invDist * repelStrength;
                    meshA.position.z -= dz * invDist * repelStrength;
                    meshB.position.x += dx * invDist * repelStrength;
                    meshB.position.y += dy * invDist * repelStrength;
                    meshB.position.z += dz * invDist * repelStrength;
                }

                // If within interaction range (extended for better merging)
                if (dist < combinedRadii * 2.5) {
                    // Proximity factor: 1 when touching, 0 when far
                    const proximity = Math.max(0, 1 - dist / (combinedRadii * 2.5));
                    const proximityPow = proximity ** 1.5; // Smoother falloff

                    // Add morph boost to both blobs (capped to prevent overexposure)
                    const boost = Math.min(proximityPow * 1.0, 0.8);
                    blobA.proximityBoost += boost;
                    blobB.proximityBoost += boost;

                    // Store direction to nearest blob (for bulge effect)
                    // Only attract when in merge zone, not when too close
                    if (dist > minDist) {
                        const invDist = 1 / (dist + 0.1);
                        blobA.nearestDir.x += dx * invDist * proximity * 0.5;
                        blobA.nearestDir.y += dy * invDist * proximity * 0.5;
                        blobA.nearestDir.z += dz * invDist * proximity * 0.5;
                        blobB.nearestDir.x -= dx * invDist * proximity * 0.5;
                        blobB.nearestDir.y -= dy * invDist * proximity * 0.5;
                        blobB.nearestDir.z -= dz * invDist * proximity * 0.5;
                    }
                }
            }
        }

        // Second pass: update blob positions and shaders
        for (let i = 0; i < this.blobs.length; i++) {
            const blob = this.blobs[i];
            const { mesh } = blob;

            // === WEIGHTLESS 3D DRIFT ===
            // Using layered sine waves for organic, non-repeating paths
            // Each axis has its own frequency and phase for unique trajectories

            // Primary drift motion
            const driftX = Math.sin(t * blob.freqX + blob.phaseX) * blob.ampX
                + Math.sin(t * blob.freq2X + blob.phaseX * 1.7) * blob.ampX * 0.5;
            const driftY = Math.sin(t * blob.freqY + blob.phaseY) * blob.ampY
                + Math.cos(t * blob.freq2Y + blob.phaseY * 1.3) * blob.ampY * 0.4;
            const driftZ = Math.sin(t * blob.freqZ + blob.phaseZ) * blob.ampZ
                + Math.cos(t * blob.freqZ * 0.7 + blob.phaseZ * 2.1) * blob.ampZ * 0.3;

            // Apply drift incrementally - SPEED BOOST during combo!
            const baseSmoothing = 0.008;
            const smoothing = baseSmoothing * this.comboSpeedBoost;
            mesh.position.x += driftX * smoothing;
            mesh.position.y += driftY * smoothing;
            mesh.position.z += driftZ * smoothing;

            // === ATTRACTION TOWARD NEARBY BLOBS ===
            // Blobs attract when close (creates merging feel)
            if (blob.proximityBoost > 0.05) {
                const attractStrength = 0.002;
                mesh.position.x += blob.nearestDir.x * attractStrength * blob.proximityBoost;
                mesh.position.y += blob.nearestDir.y * attractStrength * blob.proximityBoost;
                mesh.position.z += blob.nearestDir.z * attractStrength * blob.proximityBoost;
            }

            // === SOFT BOUNDARY - Gentle attraction back to center ===
            const boundaryStrength = 0.0008;
            const margin = blob.scale;

            if (Math.abs(mesh.position.x) > bounds.width + margin) {
                mesh.position.x -= Math.sign(mesh.position.x) * boundaryStrength * 50;
            }
            if (Math.abs(mesh.position.y) > bounds.height + margin) {
                mesh.position.y -= Math.sign(mesh.position.y) * boundaryStrength * 50;
            }
            if (mesh.position.z < -25) {
                mesh.position.z += boundaryStrength * 30;
            } else if (mesh.position.z > 10) {
                mesh.position.z -= boundaryStrength * 30;
            }

            // === ORGANIC SCALE PULSING ===
            // Scale up when near other blobs + DRAMATIC COMBO EXPANSION
            const proximityScale = 1.0 + blob.proximityBoost * 0.25;
            const comboScale = 1.0 + this.comboScaleBoost * 0.5; // Up to 50% larger during combo
            const scalePulse = (1.0 + Math.sin(t * 0.3 + blob.scalePhase) * 0.08
                + Math.sin(t * 0.17 + blob.scalePhase * 1.5) * 0.05) * proximityScale * comboScale;
            mesh.scale.setScalar(scalePulse);

            // === SLOW TUMBLING ROTATION ===
            // Faster rotation during combo
            const rotBoost = 1.0 + this.comboIntensity * 2.0;
            mesh.rotation.x += blob.rotSpeedX * rotBoost;
            mesh.rotation.y += blob.rotSpeedY * rotBoost;
            mesh.rotation.z += blob.rotSpeedZ * rotBoost;

            // === MORPHING ===
            // BOOST morph intensity during combo
            const morphWave = Math.sin(t * 0.5 + blob.morphPhase) * 0.5 + 0.5;
            const baseMorph = blob.morphBase * (0.7 + morphWave * 0.6);
            const proximityMorph = Math.min(blob.proximityBoost * 1.5, 1.2);
            const comboMorph = this.comboIntensity * 0.8; // Extra morph during combo
            const morphIntensity = baseMorph + proximityMorph + comboMorph;

            // === UPDATE SHADER UNIFORMS ===
            mesh.material.uniforms.uTime.value = t + blob.phaseX;

            // Total glow = pulse + proximity + flash + COMBO COLOR FLASH
            const totalGlow = Math.min(
                this.pulseIntensity
                + blob.proximityBoost * 0.3
                + this.glowFlash * 0.8
                + this.comboColorFlash * 1.5 // Strong color flash during combo
                + this.comboIntensity * 0.5,
                2.5, // Higher cap for dramatic effect
            );
            mesh.material.uniforms.uPulseIntensity.value = totalGlow;
            mesh.material.uniforms.uMorphFactor.value = morphIntensity + this.pulseIntensity * 0.2 + this.glowFlash * 0.3;
        }
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);

        this.screenBounds = this.calculateScreenBounds();

        if (this.composer) {
            this.composer.setSize(w, h);
        }
    }

    stop() {
        super.stop();

        this.eventUnsubscribers.forEach((unsub) => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];

        if (this.boundResizeHandler) {
            window.removeEventListener('resize', this.boundResizeHandler);
        }
    }

    cleanup() {
        this.stop();

        // Dispose blobs
        for (const blob of this.blobs) {
            blob.mesh.geometry.dispose();
            blob.mesh.material.dispose();
            this.scene.remove(blob.mesh);
        }
        this.blobs = [];

        // Dispose sparks
        if (this.sparks) {
            this.sparks.geometry.dispose();
            this.sparks.material.dispose();
            this.scene.remove(this.sparks);
        }

        // Dispose background
        if (this.backgroundMesh) {
            this.backgroundMesh.geometry.dispose();
            this.backgroundMesh.material.dispose();
            this.scene.remove(this.backgroundMesh);
        }

        // Dispose renderer
        if (this.renderer) this.renderer.dispose();
        if (this.composer) this.composer.dispose();

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;

        super.cleanup();
    }
}
