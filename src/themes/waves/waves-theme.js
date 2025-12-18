/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ WAVES - Inside the Surf Barrel ✧
 *  A Three.js Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Realistic water barrel using luminous-tides quality ocean shader.
 * Curved wave geometry wraps around you creating the barrel effect.
 * Camera positioned inside looking toward the bright barrel opening.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { WAVES_TETROMINOS } from './waves-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        waveSegments: 256,
        sprayCount: 2000,
        bloomStrength: 0.55,
        bloomRadius: 0.6,
        enablePostProcessing: true,
    },
    Ultra: {
        waveSegments: 192,
        sprayCount: 1500,
        bloomStrength: 0.5,
        bloomRadius: 0.55,
        enablePostProcessing: true,
    },
    High: {
        waveSegments: 128,
        sprayCount: 1000,
        bloomStrength: 0.45,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    Medium: {
        waveSegments: 96,
        sprayCount: 600,
        bloomStrength: 0.4,
        bloomRadius: 0.45,
        enablePostProcessing: true,
    },
    Low: {
        waveSegments: 64,
        sprayCount: 300,
        bloomStrength: 0.35,
        bloomRadius: 0.4,
        enablePostProcessing: false,
    },
    Minimal: {
        waveSegments: 48,
        sprayCount: 150,
        bloomStrength: 0.3,
        bloomRadius: 0.35,
        enablePostProcessing: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
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
            float vig = smoothstep(offset, offset - 0.8, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Realistic Ocean Water Shader (adapted from luminous-tides)
// Applied to barrel geometry to create surf tunnel effect
// ─────────────────────────────────────────────────────────────────────────────
const WaterBarrelShader = {
    uniforms: {
        uTime: { value: 0 },
        // Ocean colors - tropical surf
        uDeepColor: { value: new THREE.Color(0x001520) },
        uMidColor: { value: new THREE.Color(0x004455) },
        uSurfaceColor: { value: new THREE.Color(0x008899) },
        uCrestColor: { value: new THREE.Color(0x44ddcc) },
        uFoamColor: { value: new THREE.Color(0xddffff) },
        // Wave parameters
        uWaveIntensity: { value: 1.0 },
        uWaveSpeed: { value: 0.6 },
        // Lighting
        uGlowIntensity: { value: 0.0 },
        uCausticsIntensity: { value: 0.4 },
        // Barrel shape
        uBarrelRadius: { value: 10.0 },
    },
    vertexShader: `
        uniform float uTime;
        uniform float uWaveIntensity;
        uniform float uWaveSpeed;
        uniform float uBarrelRadius;
        
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        varying float vElevation;
        varying float vBarrelAngle;
        
        // Perlin noise
        vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
        
        float cnoise(vec3 P) {
            vec3 Pi0 = floor(P);
            vec3 Pi1 = Pi0 + vec3(1.0);
            Pi0 = mod(Pi0, 289.0);
            Pi1 = mod(Pi1, 289.0);
            vec3 Pf0 = fract(P);
            vec3 Pf1 = Pf0 - vec3(1.0);
            vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
            vec4 iy = vec4(Pi0.yy, Pi1.yy);
            vec4 iz0 = Pi0.zzzz;
            vec4 iz1 = Pi1.zzzz;
            vec4 ixy = permute(permute(ix) + iy);
            vec4 ixy0 = permute(ixy + iz0);
            vec4 ixy1 = permute(ixy + iz1);
            vec4 gx0 = ixy0 / 7.0;
            vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
            gx0 = fract(gx0);
            vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
            vec4 sz0 = step(gz0, vec4(0.0));
            gx0 -= sz0 * (step(0.0, gx0) - 0.5);
            gy0 -= sz0 * (step(0.0, gy0) - 0.5);
            vec4 gx1 = ixy1 / 7.0;
            vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
            gx1 = fract(gx1);
            vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
            vec4 sz1 = step(gz1, vec4(0.0));
            gx1 -= sz1 * (step(0.0, gx1) - 0.5);
            gy1 -= sz1 * (step(0.0, gy1) - 0.5);
            vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
            vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
            vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
            vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
            vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
            vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
            vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
            vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
            vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
            g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
            vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
            g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
            float n000 = dot(g000, Pf0);
            float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
            float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
            float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
            float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
            float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
            float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
            float n111 = dot(g111, Pf1);
            vec3 fade_xyz = fade(Pf0);
            vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
            vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
            float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
            return 2.2 * n_xyz;
        }
        
        // Gerstner wave for realistic water motion
        vec3 gerstnerWave(vec2 direction, float steepness, float wavelength, vec3 p, float time) {
            float k = 6.28318 / wavelength;
            float c = sqrt(9.8 / k);
            vec2 d = normalize(direction);
            float f = k * (dot(d, p.xz) - c * time);
            float a = steepness / k;
            return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
        }
        
        void main() {
            vUv = uv;
            vec3 pos = position;
            
            float time = uTime * uWaveSpeed;
            
            // Store original angle for color variation
            vBarrelAngle = atan(pos.y, pos.x);
            
            // Apply Gerstner waves along the barrel surface
            vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
            vec3 waveOffset = vec3(0.0);
            
            // Large rolling waves - reduced steepness for smoother look
            waveOffset += gerstnerWave(vec2(1.0, 0.3), 0.25, 20.0, worldPos, time);
            waveOffset += gerstnerWave(vec2(0.7, 0.7), 0.18, 15.0, worldPos, time * 1.1);
            
            // Secondary swells
            waveOffset += gerstnerWave(vec2(-0.4, 0.9), 0.12, 11.0, worldPos, time * 0.9);
            waveOffset += gerstnerWave(vec2(0.9, -0.2), 0.08, 8.0, worldPos, time * 0.85);
            
            // Small detail waves - reduced for less visible banding
            waveOffset += gerstnerWave(vec2(0.5, 0.5), 0.05, 5.0, worldPos, time * 1.2);
            
            // Perlin noise for surface detail - lower frequency for smoother appearance
            float noise = cnoise(vec3(worldPos.xz * 0.15, time * 0.3)) * 0.2;
            noise += cnoise(vec3(worldPos.xz * 0.08, time * 0.25)) * 0.15;
            
            // Apply displacement along the surface normal
            float totalDisplacement = (waveOffset.y + noise) * uWaveIntensity;
            vElevation = totalDisplacement;
            
            // Displace the vertex
            pos += normal * totalDisplacement * 0.8;
            pos.x += waveOffset.x * 0.3;
            pos.z += waveOffset.z * 0.3;
            
            vPosition = pos;
            vNormal = normal;
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uMidColor;
        uniform vec3 uSurfaceColor;
        uniform vec3 uCrestColor;
        uniform vec3 uFoamColor;
        uniform float uGlowIntensity;
        uniform float uCausticsIntensity;
        
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        varying float vElevation;
        varying float vBarrelAngle;
        
        // Simplex noise for caustics
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
        
        float snoise(vec2 v) {
            const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
            vec2 i = floor(v + dot(v, C.yy));
            vec2 x0 = v - i + dot(i, C.xx);
            vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod289(i);
            vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
            vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
            m = m*m; m = m*m;
            vec3 x = 2.0 * fract(p * C.www) - 1.0;
            vec3 h = abs(x) - 0.5;
            vec3 ox = floor(x + 0.5);
            vec3 a0 = x - ox;
            m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
            vec3 g;
            g.x = a0.x * x0.x + h.x * x0.y;
            g.yz = a0.yz * x12.xz + h.yz * x12.yw;
            return 130.0 * dot(m, g);
        }
        
        void main() {
            // Color based on position in barrel and wave height
            float heightFactor = clamp(vElevation * 2.0 + 0.5, 0.0, 1.0);
            float depthFactor = clamp((vPosition.z + 30.0) / 60.0, 0.0, 1.0);
            
            // Gradient: deep -> mid -> surface -> crest
            vec3 color = mix(uDeepColor, uMidColor, depthFactor * 0.7);
            color = mix(color, uSurfaceColor, depthFactor);
            color = mix(color, uCrestColor, heightFactor * 0.6);
            
            // Lighting from barrel opening
            vec3 lightDir = normalize(vec3(0.0, 0.2, 1.0));
            vec3 viewDir = normalize(cameraPosition - vPosition);
            
            // Diffuse
            float diffuse = max(dot(vWorldNormal, lightDir), 0.0);
            diffuse = pow(diffuse, 0.6) * 0.5 + 0.4;
            
            // Specular highlights (wet surface look)
            vec3 halfDir = normalize(lightDir + viewDir);
            float specular = pow(max(dot(vWorldNormal, halfDir), 0.0), 64.0);
            
            // Fresnel (glassy water edge)
            float fresnel = pow(1.0 - max(dot(vWorldNormal, viewDir), 0.0), 3.0);
            
            // Caustics - lower frequency for smoother water look
            vec2 causticsUV = vPosition.xz * 0.3 + vPosition.y * 0.1;
            float c1 = snoise(causticsUV + uTime * 0.25);
            float c2 = snoise(causticsUV * 1.3 - uTime * 0.2);
            float c3 = snoise(causticsUV * 0.8 + uTime * 0.3);
            float caustics = (c1 + c2 + c3) * 0.33;
            caustics = pow(max(caustics, 0.0), 2.5) * uCausticsIntensity * 0.5 * depthFactor;
            
            // Foam at wave crests - lower frequency
            float foamNoise = snoise(vPosition.xz * 1.5 + uTime * 0.15);
            float foam = smoothstep(0.4, 0.7, vElevation) * (foamNoise * 0.3 + 0.5);
            
            // Sub-surface scattering (light through water)
            float sss = pow(max(dot(-viewDir, lightDir), 0.0), 4.0) * 0.25;
            sss *= depthFactor;
            
            // Combine lighting
            color *= diffuse;
            color += vec3(1.0) * specular * 0.6;
            color += uCrestColor * fresnel * 0.4;
            color += uCrestColor * caustics;
            color += uSurfaceColor * sss;
            color = mix(color, uFoamColor, foam * 0.5);
            
            // Glow from game events
            color += uCrestColor * uGlowIntensity * 0.4;
            
            // Depth fade toward exit
            float exitGlow = pow(depthFactor, 2.5) * 0.3;
            color += vec3(0.7, 0.9, 1.0) * exitGlow;
            
            gl_FragColor = vec4(color, 0.94);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Spray/Mist Shader
// ─────────────────────────────────────────────────────────────────────────────
const SprayShader = {
    uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        attribute float aSpeed;
        uniform float uTime;
        varying float vAlpha;
        
        void main() {
            vec3 pos = position;
            float t = uTime * aSpeed + aPhase;
            
            // Drift motion
            pos.z += t * 2.0;
            pos.x += sin(t * 2.0 + aPhase) * 0.3;
            pos.y += cos(t * 1.5 + aPhase) * 0.2;
            
            // Loop
            pos.z = mod(pos.z + 40.0, 80.0) - 40.0;
            
            vAlpha = 0.3 + 0.2 * sin(t * 3.0);
            
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;
            gl_PointSize = aSize * (80.0 / -mvPos.z);
            gl_PointSize = clamp(gl_PointSize, 1.0, 12.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        
        void main() {
            float dist = length(gl_PointCoord - 0.5) * 2.0;
            if(dist > 1.0) discard;
            float alpha = (1.0 - dist * dist) * vAlpha;
            gl_FragColor = vec4(uColor, alpha * 0.4);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class WavesTheme extends BaseTheme {
    constructor() {
        super('waves');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.barrel = null;
        this.barrelMaterial = null;
        this.spray = null;
        this.sprayMaterial = null;
        this.exitGlow = null;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.animationFrameId = null;

        // Game state
        this.glowIntensity = 0;
        this.targetGlowIntensity = 0;
        this.waveIntensity = 1.0;
        this.targetWaveIntensity = 1.0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[Waves] Surf barrel theme constructed');
    }

    getTetrominoConfig() {
        return WAVES_TETROMINOS;
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
        console.log('[Waves] Creating surf barrel scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('waves-theme');
        if (!container) {
            console.error('[Waves] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createBarrel();
        this.createExitGlow();
        this.createSpray();
        this.setupLighting();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[Waves] Scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x001015, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x002233, 0.015);

        // Camera INSIDE the barrel, looking toward exit
        this.camera = new THREE.PerspectiveCamera(95, width / height, 0.1, 150);
        this.camera.position.set(0, 0, -25);
        this.camera.lookAt(0, 0, 40);

        console.log('[Waves] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Barrel - Full 360° cylinder surrounding the camera
    // ─────────────────────────────────────────────────────────────────────────

    createBarrel() {
        const segments = this.qualityPreset.waveSegments;

        // Full 360 degree cylinder - completely surrounds camera
        const geometry = new THREE.CylinderGeometry(
            10,     // radius top
            10,     // radius bottom
            80,     // length
            segments,
            segments / 2,
            true    // open ended (so we see exit light)
        );

        // Rotate so it extends along Z axis (forward)
        geometry.rotateX(Math.PI / 2);

        this.barrelMaterial = new THREE.ShaderMaterial({
            uniforms: { ...WaterBarrelShader.uniforms },
            vertexShader: WaterBarrelShader.vertexShader,
            fragmentShader: WaterBarrelShader.fragmentShader,
            side: THREE.BackSide, // Render inside of cylinder
            transparent: true,
        });

        this.barrel = new THREE.Mesh(geometry, this.barrelMaterial);
        this.barrel.position.set(0, 0, 0);
        this.scene.add(this.barrel);

        console.log('[Waves] Barrel created - full 360 degree cylinder');
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Exit Glow - Bright light at barrel opening
    // ─────────────────────────────────────────────────────────────────────────

    createExitGlow() {
        const geometry = new THREE.PlaneGeometry(40, 40);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uInnerColor: { value: new THREE.Color(0xffffff) },
                uOuterColor: { value: new THREE.Color(0x66ddff) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uInnerColor;
                uniform vec3 uOuterColor;
                varying vec2 vUv;
                void main() {
                    float dist = length(vUv - 0.5) * 2.0;
                    vec3 color = mix(uInnerColor, uOuterColor, dist);
                    float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                    alpha *= 0.85;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.exitGlow = new THREE.Mesh(geometry, material);
        this.exitGlow.position.set(5, 2, 45);
        this.exitGlow.rotation.y = -0.1;
        this.scene.add(this.exitGlow);

        console.log('[Waves] Exit glow created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Spray Particles
    // ─────────────────────────────────────────────────────────────────────────

    createSpray() {
        const count = this.qualityPreset.sprayCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Distribute inside barrel area
            const angle = Math.random() * Math.PI * 1.5 + Math.PI * 0.25;
            const radius = 2 + Math.random() * 9;
            const z = (Math.random() - 0.5) * 60;

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.sin(angle) * radius;
            positions[i3 + 2] = z;

            sizes[i] = 2 + Math.random() * 5;
            phases[i] = Math.random() * Math.PI * 2;
            speeds[i] = 0.2 + Math.random() * 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        this.sprayMaterial = new THREE.ShaderMaterial({
            uniforms: { ...SprayShader.uniforms },
            vertexShader: SprayShader.vertexShader,
            fragmentShader: SprayShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spray = new THREE.Points(geometry, this.sprayMaterial);
        this.scene.add(this.spray);

        console.log('[Waves] Spray created -', count, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Ambient underwater
        const ambient = new THREE.AmbientLight(0x224455, 0.3);
        this.scene.add(ambient);

        // Light from barrel exit
        const exitLight = new THREE.PointLight(0xaaeeff, 1.2, 80);
        exitLight.position.set(5, 5, 50);
        this.scene.add(exitLight);

        // Light from above (through water)
        const topLight = new THREE.DirectionalLight(0x66aacc, 0.4);
        topLight.position.set(0, 20, 0);
        this.scene.add(topLight);

        // Fill light
        const fill = new THREE.PointLight(0x003344, 0.3, 40);
        fill.position.set(0, 0, -20);
        this.scene.add(fill);

        console.log('[Waves] Lighting setup');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.75
        );
        this.composer.addPass(this.bloomPass);

        const vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(vignettePass);

        console.log('[Waves] Post-processing setup');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        this.teardownEventListeners();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);

        this.handleResize = () => {
            if (!this.isActive || !this.renderer) return;
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
            if (this.composer) this.composer.setSize(width, height);
        };
        window.addEventListener('resize', this.handleResize);
    }

    teardownEventListeners() {
        this.eventUnsubscribers.forEach((unsub) => {
            try { unsub?.(); } catch (e) { /* ignore */ }
        });
        this.eventUnsubscribers = [];
        if (this.handleResize) {
            window.removeEventListener('resize', this.handleResize);
            this.handleResize = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Events
    // ─────────────────────────────────────────────────────────────────────────

    onPieceLock() {
        this.targetGlowIntensity = Math.min(this.targetGlowIntensity + 0.1, 0.5);
    }

    onLineClear(lineCount) {
        this.targetWaveIntensity = Math.min(1.0 + lineCount * 0.3, 2.5);
        this.targetGlowIntensity = Math.min(0.3 + lineCount * 0.2, 1.0);
    }

    onCombo(comboCount) {
        if (comboCount >= 3) {
            this.targetWaveIntensity = Math.min(1.5 + comboCount * 0.15, 3.0);
        }
        if (comboCount >= 5) {
            this.targetGlowIntensity = Math.min(0.5 + comboCount * 0.1, 1.5);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            // Smooth interpolation
            this.glowIntensity += (this.targetGlowIntensity - this.glowIntensity) * delta * 3;
            this.targetGlowIntensity *= 0.97;

            this.waveIntensity += (this.targetWaveIntensity - this.waveIntensity) * delta * 2;
            this.targetWaveIntensity += (1.0 - this.targetWaveIntensity) * delta * 0.4;

            // Gentle camera sway
            this.camera.position.x = Math.sin(this.time * 0.3) * 0.8;
            this.camera.position.y = Math.sin(this.time * 0.4) * 0.5;

            // Update shaders
            if (this.barrelMaterial) {
                this.barrelMaterial.uniforms.uTime.value = this.time;
                this.barrelMaterial.uniforms.uWaveIntensity.value = this.waveIntensity;
                this.barrelMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;
            }


            if (this.sprayMaterial) {
                this.sprayMaterial.uniforms.uTime.value = this.time;
            }

            // Render
            if (this.composer) {
                this.composer.render(delta);
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    cleanup() {
        console.log('[Waves] Cleaning up...');

        this.teardownEventListeners();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.barrel) {
            this.barrel.geometry.dispose();
            this.barrelMaterial?.dispose();
            this.scene.remove(this.barrel);
        }


        if (this.exitGlow) {
            this.exitGlow.geometry.dispose();
            this.exitGlow.material.dispose();
            this.scene.remove(this.exitGlow);
        }

        if (this.spray) {
            this.spray.geometry.dispose();
            this.sprayMaterial?.dispose();
            this.scene.remove(this.spray);
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.barrel = null;
        this.barrelMaterial = null;
        this.exitGlow = null;
        this.spray = null;
        this.sprayMaterial = null;
        this.bloomPass = null;

        super.cleanup();

        console.log('[Waves] Cleanup complete');
    }
}
