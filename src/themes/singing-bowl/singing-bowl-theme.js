/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SINGING BOWL THEME - Three.js 3D Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A deeply calming, meditative 3D experience featuring:
 * - Beautiful brass/bronze singing bowl with realistic metallic shading
 * - Gently undulating water surface inside the bowl
 * - 3D sound ripples emanating outward from the bowl
 * - Floating luminous motes rising like incense smoke
 * - Soft atmospheric lighting with bloom
 * - Subtle camera breathing movement
 * - Resonant lock piece and combo effects
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SINGING_BOWL_TETROMINOS } from './singing-bowl-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: { particleCount: 200, bloomStrength: 0.7, bloomRadius: 0.6, enablePost: true, rippleDetail: 64 },
    Ultra: { particleCount: 160, bloomStrength: 0.65, bloomRadius: 0.55, enablePost: true, rippleDetail: 48 },
    High: { particleCount: 120, bloomStrength: 0.6, bloomRadius: 0.5, enablePost: true, rippleDetail: 32 },
    Medium: { particleCount: 80, bloomStrength: 0.5, bloomRadius: 0.4, enablePost: true, rippleDetail: 24 },
    Low: { particleCount: 50, bloomStrength: 0.4, bloomRadius: 0.35, enablePost: false, rippleDetail: 16 },
    Minimal: { particleCount: 30, bloomStrength: 0.3, bloomRadius: 0.3, enablePost: false, rippleDetail: 12 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palette - Tranquil, warm brass and soft lavender tones
// ─────────────────────────────────────────────────────────────────────────────
const PALETTE = {
    bowlBrass: new THREE.Color(0xb8956d),
    bowlBrassLight: new THREE.Color(0xd4b896),
    bowlBrassDark: new THREE.Color(0x6b5344),
    waterDeep: new THREE.Color(0x1a1225),
    waterSurface: new THREE.Color(0x2d2040),
    rippleGlow: new THREE.Color(0xc8b4dc),
    moteColor: new THREE.Color(0xdcc8f0),
    ambientPurple: new THREE.Color(0x2a1a35),
    glowLavender: new THREE.Color(0xb4a0c8),
    glowTeal: new THREE.Color(0xa0dcc8),
};

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

// Singing Bowl Metallic Shader - Warm brass with subtle reflections
const BowlShader = {
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying vec2 vUv;
        varying float vFresnel;

        void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            vUv = uv;

            // Fresnel for rim lighting
            float fresnel = 1.0 - max(0.0, dot(vNormal, vViewDir));
            vFresnel = pow(fresnel, 2.5);

            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uPulseIntensity;
        uniform vec3 uBrassColor;
        uniform vec3 uBrassLight;
        uniform vec3 uBrassDark;

        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying vec2 vUv;
        varying float vFresnel;

        void main() {
            // Base brass color with height variation
            float heightFactor = smoothstep(-1.0, 1.5, vWorldPosition.y);
            vec3 baseColor = mix(uBrassDark, uBrassColor, heightFactor);

            // Subtle surface variation (hammered texture feel)
            float variation = sin(vUv.x * 60.0) * sin(vUv.y * 40.0 + vWorldPosition.y * 5.0) * 0.08;
            baseColor += vec3(variation);

            // Soft directional lighting
            vec3 lightDir1 = normalize(vec3(0.5, 1.0, 0.3));
            vec3 lightDir2 = normalize(vec3(-0.3, 0.5, -0.5));

            float diff1 = max(0.0, dot(vNormal, lightDir1));
            float diff2 = max(0.0, dot(vNormal, lightDir2)) * 0.4;

            // Specular highlights
            vec3 halfDir1 = normalize(lightDir1 + vViewDir);
            float spec1 = pow(max(0.0, dot(vNormal, halfDir1)), 32.0) * 0.6;

            vec3 halfDir2 = normalize(lightDir2 + vViewDir);
            float spec2 = pow(max(0.0, dot(vNormal, halfDir2)), 24.0) * 0.3;

            // Combine lighting
            vec3 color = baseColor * (0.3 + diff1 * 0.5 + diff2 * 0.2);
            color += uBrassLight * (spec1 + spec2);

            // Warm rim glow
            color += uBrassLight * vFresnel * 0.4;

            // Pulse effect from gameplay
            float pulse = 1.0 + uPulseIntensity * 0.5 * sin(uTime * 8.0);
            color *= pulse;

            // Subtle glow on pulse
            color += vec3(0.8, 0.6, 0.4) * uPulseIntensity * 0.3;

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

// Water Surface Shader - Gentle undulations with reflections
const WaterShader = {
    vertexShader: `
        uniform float uTime;
        uniform float uRippleIntensity;

        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vDistFromCenter;

        void main() {
            vUv = uv;

            vec3 pos = position;
            vDistFromCenter = length(pos.xz);

            // Gentle waves
            float wave1 = sin(pos.x * 3.0 + uTime * 1.2) * cos(pos.z * 2.5 + uTime * 0.8) * 0.015;
            float wave2 = sin(pos.x * 5.0 - uTime * 1.5) * sin(pos.z * 4.0 + uTime * 1.0) * 0.008;

            // Ripple waves from center
            float rippleDist = length(pos.xz);
            float ripple = sin(rippleDist * 8.0 - uTime * 4.0) * 0.02 * uRippleIntensity;
            ripple *= smoothstep(2.0, 0.0, rippleDist);

            pos.y += wave1 + wave2 + ripple;

            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPosition = worldPos.xyz;
            vNormal = normalMatrix * normal;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uSurfaceColor;
        uniform float uReflectionStrength;

        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vDistFromCenter;

        void main() {
            // Depth-based color
            float depth = smoothstep(0.0, 1.5, vDistFromCenter);
            vec3 color = mix(uSurfaceColor, uDeepColor, depth);

            // Shimmer highlights
            float shimmer = sin(vUv.x * 30.0 + uTime * 2.0) * sin(vUv.y * 25.0 - uTime * 1.5);
            shimmer = max(0.0, shimmer) * 0.15;

            // Center glow
            float centerGlow = smoothstep(1.5, 0.0, vDistFromCenter) * 0.3;

            // Reflection simulation
            float refl = pow(1.0 - max(0.0, dot(normalize(vNormal), vec3(0.0, 1.0, 0.0))), 3.0);
            refl *= uReflectionStrength;

            color += vec3(0.7, 0.6, 0.9) * shimmer;
            color += vec3(0.6, 0.5, 0.8) * centerGlow;
            color += vec3(0.8, 0.7, 0.9) * refl * 0.2;

            // Subtle pulsing
            float pulse = 0.95 + 0.05 * sin(uTime * 0.5);

            gl_FragColor = vec4(color * pulse, 0.92);
        }
    `
};

// 3D Ripple Ring Shader
const RippleShader = {
    vertexShader: `
        varying vec2 vUv;
        varying float vRadius;

        void main() {
            vUv = uv;
            vRadius = length(position.xz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uOpacity;
        uniform float uProgress;
        uniform vec3 uColor;

        varying vec2 vUv;
        varying float vRadius;

        void main() {
            // Ring shape
            float ringWidth = 0.15;
            float targetRadius = uProgress;
            float dist = abs(vRadius - targetRadius);
            float ring = smoothstep(ringWidth, 0.0, dist);

            // Fade with progress
            float fade = 1.0 - uProgress;

            // Inner glow
            float glow = smoothstep(targetRadius, 0.0, vRadius) * 0.3 * fade;

            float alpha = (ring + glow) * uOpacity * fade;

            gl_FragColor = vec4(uColor, alpha);
        }
    `
};

// Floating Mote Particle Shader
const MoteShader = {
    vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        attribute float aSpeed;
        attribute vec3 aColor;

        uniform float uTime;

        varying float vAlpha;
        varying vec3 vColor;

        void main() {
            vec3 pos = position;

            // Gentle rising motion with drift
            float time = uTime * aSpeed * 0.3;
            pos.y += mod(time + aPhase * 50.0, 40.0) - 5.0;
            pos.x += sin(time * 0.8 + aPhase * 6.28) * 0.8;
            pos.z += cos(time * 0.6 + aPhase * 4.0) * 0.6;

            // Lifecycle - fade in/out based on height
            float normalizedY = (pos.y + 5.0) / 40.0;
            vAlpha = sin(normalizedY * 3.14159) * 0.8;
            vAlpha *= 0.6 + 0.4 * sin(uTime * 2.0 + aPhase * 6.28);

            vColor = aColor;

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = aSize * (180.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float dist = length(coord);
            if (dist > 0.5) discard;

            // Soft glow
            float glow = 1.0 - smoothstep(0.0, 0.5, dist);
            glow = pow(glow, 1.5);

            gl_FragColor = vec4(vColor * glow * 1.5, vAlpha * glow);
        }
    `
};

// Background Gradient Shader
const BackgroundShader = {
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

            // Deep purple gradient
            vec3 topColor = vec3(0.05, 0.03, 0.08);
            vec3 midColor = vec3(0.1, 0.06, 0.14);
            vec3 bottomColor = vec3(0.06, 0.04, 0.1);

            vec3 color;
            if (y > 0.0) {
                color = mix(midColor, topColor, smoothstep(0.0, 0.8, y));
            } else {
                color = mix(midColor, bottomColor, smoothstep(0.0, -0.6, y));
            }

            // Subtle aurora-like wisps
            float angle = atan(vWorldPos.x, vWorldPos.z);
            float wisp = sin(angle * 3.0 + y * 5.0 + uTime * 0.1);
            wisp = pow(max(0.0, wisp), 4.0) * 0.04;
            wisp *= smoothstep(-0.3, 0.2, y) * smoothstep(0.7, 0.3, y);

            color += vec3(0.3, 0.2, 0.5) * wisp;

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme Class
// ─────────────────────────────────────────────────────────────────────────────

export default class SingingBowlTheme extends BaseTheme {
    constructor() {
        super('singing-bowl');
        this.eventUnsubscribers = [];

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;
        this.bowl = null;
        this.bowlInner = null;
        this.waterSurface = null;
        this.motes = null;
        this.backgroundSphere = null;
        this.ripples = [];

        // Animation
        this.animationFrame = null;
        this.clock = new THREE.Clock();
        this.cameraBasePosition = new THREE.Vector3(0, 3, 8);
        this.cameraLookAt = new THREE.Vector3(0, 0.5, 0);

        // State
        this.uniforms = {
            time: { value: 0 },
            pulseIntensity: { value: 0 },
            rippleIntensity: { value: 0 },
            reflectionStrength: { value: 0.5 },
        };

        this.currentQuality = 'High';
        this.activePreset = QUALITY_PRESETS.High;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        console.log('[SingingBowl] Initializing Three.js scene...');

        const container = document.getElementById('singing-bowl-theme');
        if (!container) {
            console.error('[SingingBowl] Container not found');
            return;
        }

        // Set quality
        const quality = this.getGraphicsQuality();
        this.activePreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        this.currentQuality = quality;

        // Clean up existing content
        container.innerHTML = '';

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0612, 0.04);

        // Camera - positioned to view the bowl from a gentle angle
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraLookAt);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        container.appendChild(this.renderer.domElement);

        // Post-processing with bloom
        if (this.activePreset.enablePost) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));

            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                this.activePreset.bloomStrength,
                this.activePreset.bloomRadius,
                0.85
            );
            this.composer.addPass(bloomPass);
            this.bloomPass = bloomPass;
        }

        // Main group for subtle movement
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Create all scene elements
        this.createBackground();
        this.createSingingBowl();
        this.createWaterSurface();
        this.createMotes();
        this.setupLighting();

        // Event listeners
        this.setupEventListeners();
        this.boundOnResize = this.onWindowResize.bind(this);
        window.addEventListener('resize', this.boundOnResize);

        // Start animation
        this.animate();

        console.log('[SingingBowl] 3D Scene initialized');
    }

    createBackground() {
        const bgGeo = new THREE.SphereGeometry(50, 32, 24);
        const bgMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
            },
            vertexShader: BackgroundShader.vertexShader,
            fragmentShader: BackgroundShader.fragmentShader,
            side: THREE.BackSide,
            fog: false,
        });
        this.backgroundSphere = new THREE.Mesh(bgGeo, bgMat);
        this.scene.add(this.backgroundSphere);
    }

    createSingingBowl() {
        // Create bowl using lathe geometry for authentic shape
        const bowlProfile = [];
        const segments = 32;

        // Bowl profile curve - wider at top, curved sides, flat bottom
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            let x, y;

            if (t < 0.1) {
                // Flat bottom
                x = t * 12;
                y = 0;
            } else if (t < 0.85) {
                // Curved sides
                const curveT = (t - 0.1) / 0.75;
                const angle = curveT * Math.PI * 0.5;
                x = 1.2 + Math.sin(angle) * 0.8;
                y = curveT * 1.4;
            } else {
                // Rim flare
                const rimT = (t - 0.85) / 0.15;
                x = 2.0 + rimT * 0.15;
                y = 1.4 + rimT * 0.08;
            }

            bowlProfile.push(new THREE.Vector2(x, y));
        }

        const bowlGeo = new THREE.LatheGeometry(bowlProfile, 64);

        const bowlMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uPulseIntensity: this.uniforms.pulseIntensity,
                uBrassColor: { value: PALETTE.bowlBrass },
                uBrassLight: { value: PALETTE.bowlBrassLight },
                uBrassDark: { value: PALETTE.bowlBrassDark },
            },
            vertexShader: BowlShader.vertexShader,
            fragmentShader: BowlShader.fragmentShader,
            side: THREE.DoubleSide,
        });

        this.bowl = new THREE.Mesh(bowlGeo, bowlMat);
        this.bowl.position.y = -0.5;
        this.mainGroup.add(this.bowl);

        // Create inner bowl surface (darker, for depth)
        const innerProfile = bowlProfile.map(p => new THREE.Vector2(p.x * 0.95, p.y));
        const innerGeo = new THREE.LatheGeometry(innerProfile, 64);

        const innerMat = new THREE.MeshStandardMaterial({
            color: PALETTE.bowlBrassDark,
            roughness: 0.6,
            metalness: 0.8,
            side: THREE.BackSide,
        });

        this.bowlInner = new THREE.Mesh(innerGeo, innerMat);
        this.bowlInner.position.y = -0.5;
        this.mainGroup.add(this.bowlInner);

        // Add decorative ring around rim
        const rimGeo = new THREE.TorusGeometry(2.1, 0.05, 8, 64);
        const rimMat = new THREE.MeshStandardMaterial({
            color: PALETTE.bowlBrassLight,
            roughness: 0.3,
            metalness: 0.9,
            emissive: PALETTE.bowlBrass,
            emissiveIntensity: 0.1,
        });
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.98;
        this.mainGroup.add(rim);
    }

    createWaterSurface() {
        const waterGeo = new THREE.CircleGeometry(1.9, 64);

        const waterMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
                uRippleIntensity: this.uniforms.rippleIntensity,
                uDeepColor: { value: PALETTE.waterDeep },
                uSurfaceColor: { value: PALETTE.waterSurface },
                uReflectionStrength: this.uniforms.reflectionStrength,
            },
            vertexShader: WaterShader.vertexShader,
            fragmentShader: WaterShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
        });

        this.waterSurface = new THREE.Mesh(waterGeo, waterMat);
        this.waterSurface.rotation.x = -Math.PI / 2;
        this.waterSurface.position.y = 0.6;
        this.mainGroup.add(this.waterSurface);
    }

    createMotes() {
        const count = this.activePreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const speeds = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        // Mote colors - soft lavenders, teals, and warm whites
        const moteColors = [
            PALETTE.moteColor,
            PALETTE.glowLavender,
            PALETTE.glowTeal,
            new THREE.Color(0xfff8e8), // Warm white
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Distribute around and above the bowl
            const angle = Math.random() * Math.PI * 2;
            const radius = 0.5 + Math.random() * 3;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.random() * 5 - 1;
            positions[i3 + 2] = Math.sin(angle) * radius;

            sizes[i] = 3 + Math.random() * 6;
            phases[i] = Math.random();
            speeds[i] = 0.3 + Math.random() * 0.8;

            const color = moteColors[Math.floor(Math.random() * moteColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: this.uniforms.time,
            },
            vertexShader: MoteShader.vertexShader,
            fragmentShader: MoteShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.motes = new THREE.Points(geometry, material);
        this.mainGroup.add(this.motes);
    }

    setupLighting() {
        // Soft purple ambient
        const ambient = new THREE.AmbientLight(0x2a1a3a, 0.6);
        this.scene.add(ambient);

        // Main warm light from above-front
        const mainLight = new THREE.DirectionalLight(0xffeedd, 0.8);
        mainLight.position.set(2, 5, 3);
        this.scene.add(mainLight);

        // Fill light from the side with lavender tint
        const fillLight = new THREE.DirectionalLight(0xc8b4dc, 0.4);
        fillLight.position.set(-3, 2, -1);
        this.scene.add(fillLight);

        // Soft glow from below (reflecting off water)
        const bottomLight = new THREE.PointLight(0x8060a0, 0.5, 10);
        bottomLight.position.set(0, 0.5, 0);
        this.mainGroup.add(bottomLight);

        // Rim light for bowl edge definition
        const rimLight = new THREE.SpotLight(0xffd4aa, 0.6, 15, Math.PI / 4, 0.5);
        rimLight.position.set(-2, 3, -2);
        rimLight.target.position.set(0, 0.5, 0);
        this.scene.add(rimLight);
        this.scene.add(rimLight.target);
    }

    createRipple(intensity = 1) {
        const rippleGeo = new THREE.RingGeometry(0.1, 3, this.activePreset.rippleDetail);

        const rippleMat = new THREE.ShaderMaterial({
            uniforms: {
                uOpacity: { value: 0.8 * intensity },
                uProgress: { value: 0 },
                uColor: { value: PALETTE.rippleGlow.clone() },
            },
            vertexShader: RippleShader.vertexShader,
            fragmentShader: RippleShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const ripple = new THREE.Mesh(rippleGeo, rippleMat);
        ripple.rotation.x = -Math.PI / 2;
        ripple.position.y = 0.65;
        ripple.userData = {
            progress: 0,
            speed: 0.8 + intensity * 0.3,
            maxProgress: 1.0,
        };

        this.mainGroup.add(ripple);
        this.ripples.push(ripple);
    }

    createBurstParticles(count, intensity) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const velocities = [];
        const colors = [];

        const burstColors = [PALETTE.moteColor, PALETTE.glowLavender, PALETTE.glowTeal];

        for (let i = 0; i < count; i++) {
            // Start from bowl center
            positions.push(0, 0.8, 0);

            // Burst outward and upward
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 3 * intensity;
            const upward = 1 + Math.random() * 2;

            velocities.push(
                Math.cos(angle) * speed,
                upward * speed * 0.5,
                Math.sin(angle) * speed
            );

            const color = burstColors[Math.floor(Math.random() * burstColors.length)];
            colors.push(color.r, color.g, color.b);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.08 + intensity * 0.02,
            vertexColors: true,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            velocities,
            life: 1.0,
            decay: 0.015,
        };

        this.mainGroup.add(burst);

        if (!this.bursts) this.bursts = [];
        this.bursts.push(burst);
    }

    setupEventListeners() {
        const settings = typeof window !== 'undefined' ? window.settings : null;

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount || 1);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount || data.count || 1);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (settings?.backgroundComboEffects !== false) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onPieceLock() {
        // Gentle bowl resonance
        this.uniforms.pulseIntensity.value = 0.3;
        this.uniforms.rippleIntensity.value = 0.5;

        // Small ripple
        this.createRipple(0.4);
    }

    onLineClear(lineCount) {
        // Stronger resonance based on lines cleared
        const intensity = 0.4 + lineCount * 0.2;
        this.uniforms.pulseIntensity.value = intensity;
        this.uniforms.rippleIntensity.value = 0.7 + lineCount * 0.1;
        this.uniforms.reflectionStrength.value = 0.6 + lineCount * 0.1;

        // Create ripples
        for (let i = 0; i < lineCount; i++) {
            setTimeout(() => this.createRipple(intensity), i * 150);
        }

        // Particle burst for multi-line clears
        if (lineCount >= 2) {
            this.createBurstParticles(15 + lineCount * 8, lineCount * 0.5);
        }
    }

    onCombo(comboCount) {
        // Intense bowl resonance
        const intensity = Math.min(1.0, 0.5 + comboCount * 0.15);
        this.uniforms.pulseIntensity.value = intensity;
        this.uniforms.rippleIntensity.value = 1.0;
        this.uniforms.reflectionStrength.value = 0.8;

        // Multiple ripples
        const rippleCount = Math.min(comboCount + 1, 5);
        for (let i = 0; i < rippleCount; i++) {
            setTimeout(() => this.createRipple(intensity), i * 100);
        }

        // Particle burst
        this.createBurstParticles(20 + comboCount * 10, intensity);

        // Bloom pulse for high combos
        if (this.bloomPass && comboCount >= 3) {
            this.bloomPass.strength = this.activePreset.bloomStrength + comboCount * 0.1;
        }
    }

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;

        // Subtle camera breathing movement
        const breatheSpeed = 0.15;
        const breatheAmount = 0.3;
        this.camera.position.x = this.cameraBasePosition.x + Math.sin(elapsed * breatheSpeed) * breatheAmount;
        this.camera.position.y = this.cameraBasePosition.y + Math.cos(elapsed * breatheSpeed * 0.7) * breatheAmount * 0.5;
        this.camera.position.z = this.cameraBasePosition.z + Math.sin(elapsed * breatheSpeed * 0.5) * breatheAmount * 0.3;
        this.camera.lookAt(this.cameraLookAt);

        // Gentle main group sway
        if (this.mainGroup) {
            this.mainGroup.rotation.y = Math.sin(elapsed * 0.1) * 0.02;
        }

        // Decay effects
        if (this.uniforms.pulseIntensity.value > 0) {
            this.uniforms.pulseIntensity.value *= 0.95;
            if (this.uniforms.pulseIntensity.value < 0.01) {
                this.uniforms.pulseIntensity.value = 0;
            }
        }

        if (this.uniforms.rippleIntensity.value > 0) {
            this.uniforms.rippleIntensity.value *= 0.97;
        }

        if (this.uniforms.reflectionStrength.value > 0.5) {
            this.uniforms.reflectionStrength.value = 0.5 + (this.uniforms.reflectionStrength.value - 0.5) * 0.98;
        }

        // Decay bloom back to normal
        if (this.bloomPass && this.bloomPass.strength > this.activePreset.bloomStrength) {
            this.bloomPass.strength *= 0.98;
            if (this.bloomPass.strength < this.activePreset.bloomStrength + 0.01) {
                this.bloomPass.strength = this.activePreset.bloomStrength;
            }
        }

        // Update ripples
        this.updateRipples(delta);

        // Update burst particles
        this.updateBursts(delta);

        // Render
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateRipples(delta) {
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const ripple = this.ripples[i];
            ripple.userData.progress += delta * ripple.userData.speed;

            if (ripple.material.uniforms) {
                ripple.material.uniforms.uProgress.value = ripple.userData.progress;
            }

            // Scale the ripple outward
            const scale = 1 + ripple.userData.progress * 2;
            ripple.scale.set(scale, scale, 1);

            if (ripple.userData.progress >= ripple.userData.maxProgress) {
                this.mainGroup.remove(ripple);
                ripple.geometry.dispose();
                ripple.material.dispose();
                this.ripples.splice(i, 1);
            }
        }
    }

    updateBursts(delta) {
        if (!this.bursts) return;

        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const burst = this.bursts[i];
            const positions = burst.geometry.attributes.position.array;
            const velocities = burst.userData.velocities;

            burst.userData.life -= burst.userData.decay;

            // Move particles
            for (let j = 0; j < positions.length / 3; j++) {
                positions[j * 3] += velocities[j * 3] * delta;
                positions[j * 3 + 1] += velocities[j * 3 + 1] * delta;
                positions[j * 3 + 2] += velocities[j * 3 + 2] * delta;

                // Gravity and drag
                velocities[j * 3 + 1] -= 2 * delta;
                velocities[j * 3] *= 0.98;
                velocities[j * 3 + 2] *= 0.98;
            }
            burst.geometry.attributes.position.needsUpdate = true;

            // Fade out
            burst.material.opacity = burst.userData.life;

            if (burst.userData.life <= 0) {
                this.mainGroup.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.bursts.splice(i, 1);
            }
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    stop() {
        console.log('[SingingBowl] Stopping theme...');

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.boundOnResize) {
            window.removeEventListener('resize', this.boundOnResize);
        }

        // Cleanup Three.js
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('singing-bowl-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.composer) {
            this.composer.dispose();
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

        // Clear references
        this.ripples = [];
        this.bursts = [];
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.mainGroup = null;
        this.bowl = null;
        this.bowlInner = null;
        this.waterSurface = null;
        this.motes = null;
        this.backgroundSphere = null;
        this.bloomPass = null;

        super.stop();
    }

    getTetrominoConfig() {
        return SINGING_BOWL_TETROMINOS;
    }
}
