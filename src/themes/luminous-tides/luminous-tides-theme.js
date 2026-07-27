/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ LUMINOUS TIDES - Premium 3D Bioluminescent Ocean ✧
 *  A Three.js Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Realistic 3D ocean with Gerstner wave vertex displacement
 * - Bioluminescent glow effects using custom shaders
 * - Dynamic underwater lighting and caustics
 * - Floating bioluminescent particles (plankton)
 * - Atmospheric fog and depth effects
 * - Post-processing: Bloom, Vignette
 * - Responsive game event reactions
 *
 * Inspired by:
 * - Three.js Water techniques
 * - Gerstner/Trochoidal wave algorithms
 * - Deep ocean bioluminescence
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { LUMINOUS_TIDES_TETROMINOS } from './luminous-tides-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        waterSegments: 256,
        particleCount: 2000,
        planktonCount: 800,
        bloomStrength: 0.6,
        bloomRadius: 0.8,
        enablePostProcessing: true,
        enableCaustics: true,
    },
    Ultra: {
        waterSegments: 192,
        particleCount: 1500,
        planktonCount: 600,
        bloomStrength: 0.55,
        bloomRadius: 0.7,
        enablePostProcessing: true,
        enableCaustics: true,
    },
    High: {
        waterSegments: 128,
        particleCount: 1000,
        planktonCount: 400,
        bloomStrength: 0.5,
        bloomRadius: 0.6,
        enablePostProcessing: true,
        enableCaustics: true,
    },
    Medium: {
        waterSegments: 96,
        particleCount: 600,
        planktonCount: 250,
        bloomStrength: 0.45,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        enableCaustics: false,
    },
    Low: {
        waterSegments: 64,
        particleCount: 300,
        planktonCount: 100,
        bloomStrength: 0.4,
        bloomRadius: 0.4,
        enablePostProcessing: false,
        enableCaustics: false,
    },
    Minimal: {
        waterSegments: 48,
        particleCount: 150,
        planktonCount: 50,
        bloomStrength: 0.3,
        bloomRadius: 0.3,
        enablePostProcessing: false,
        enableCaustics: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.6 },
        offset: { value: 1.2 },
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
            float vig = smoothstep(offset, offset - 0.7, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Gerstner Wave Water Shader
// ─────────────────────────────────────────────────────────────────────────────
const OceanShader = {
    uniforms: {
        uTime: { value: 0 },
        uDepthColor: { value: new THREE.Color(0x000a14) },
        uSurfaceColor: { value: new THREE.Color(0x0a3050) },
        uGlowColor: { value: new THREE.Color(0x00ffff) },
        uFoamColor: { value: new THREE.Color(0x40e0d0) },
        uBigWavesElevation: { value: 0.15 },
        uBigWavesFrequency: { value: new THREE.Vector2(3.0, 1.5) },
        uBigWavesSpeed: { value: 0.75 },
        uSmallWavesElevation: { value: 0.1 },
        uSmallWavesFrequency: { value: 3.0 },
        uSmallWavesSpeed: { value: 0.15 },
        uSmallWavesIterations: { value: 3 },
        uDepthOffset: { value: 0.08 },
        uDepthMultiplier: { value: 4.0 },
        uColorOffset: { value: 0.25 },
        uColorMultiplier: { value: 3.0 },
        uGlowIntensity: { value: 0.0 },
        uGlowWave: { value: new THREE.Vector3(0.5, 0.5, 0.0) },
        uCausticsIntensity: { value: 0.3 },
        uAmbientLight: { value: 0.15 },
        uFogNear: { value: 1.0 },
        uFogFar: { value: 12.0 },
        uFogColor: { value: new THREE.Color(0x000408) },
    },
    vertexShader: `
        uniform float uTime;
        uniform float uBigWavesElevation;
        uniform vec2 uBigWavesFrequency;
        uniform float uBigWavesSpeed;
        uniform float uSmallWavesElevation;
        uniform float uSmallWavesFrequency;
        uniform float uSmallWavesSpeed;
        uniform int uSmallWavesIterations;
        
        varying float vElevation;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;
        
        // Classic Perlin 3D Noise
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
        
        // Gerstner Wave Function
        vec3 gerstnerWave(vec2 direction, float steepness, float wavelength, vec3 p, inout vec3 tangent, inout vec3 binormal) {
            float k = 2.0 * 3.14159265 / wavelength;
            float c = sqrt(9.8 / k);
            vec2 d = normalize(direction);
            float f = k * (dot(d, p.xz) - c * uTime * uBigWavesSpeed);
            float a = steepness / k;
            
            tangent += vec3(
                -d.x * d.x * (steepness * sin(f)),
                d.x * (steepness * cos(f)),
                -d.x * d.y * (steepness * sin(f))
            );
            binormal += vec3(
                -d.x * d.y * (steepness * sin(f)),
                d.y * (steepness * cos(f)),
                -d.y * d.y * (steepness * sin(f))
            );
            
            return vec3(
                d.x * (a * cos(f)),
                a * sin(f),
                d.y * (a * cos(f))
            );
        }
        
        void main() {
            vUv = uv;
            vec4 modelPosition = modelMatrix * vec4(position, 1.0);
            
            vec3 tangent = vec3(1.0, 0.0, 0.0);
            vec3 binormal = vec3(0.0, 0.0, 1.0);
            vec3 p = modelPosition.xyz;
            
            // 8 layered Gerstner waves for ultra-realistic rolling ocean
            vec3 waveOffset = vec3(0.0);
            
            // Primary swell - large rolling waves moving diagonally across screen
            waveOffset += gerstnerWave(vec2(1.0, 0.6), 0.35, 25.0, p, tangent, binormal);
            waveOffset += gerstnerWave(vec2(0.8, 1.0), 0.30, 18.0, p, tangent, binormal);
            
            // Secondary swells - crossing waves for complexity
            waveOffset += gerstnerWave(vec2(-0.5, 0.9), 0.22, 12.0, p, tangent, binormal);
            waveOffset += gerstnerWave(vec2(0.9, -0.3), 0.18, 9.0, p, tangent, binormal);
            
            // Medium waves - add texture and detail
            waveOffset += gerstnerWave(vec2(0.6, 0.8), 0.14, 6.0, p, tangent, binormal);
            waveOffset += gerstnerWave(vec2(-0.7, 0.5), 0.10, 4.5, p, tangent, binormal);
            
            // Small ripples - fine detail
            waveOffset += gerstnerWave(vec2(0.4, -0.6), 0.06, 3.0, p, tangent, binormal);
            waveOffset += gerstnerWave(vec2(-0.3, -0.8), 0.04, 2.0, p, tangent, binormal);
            
            modelPosition.xyz += waveOffset * uBigWavesElevation;
            
            // Small waves (detail noise) - reduced for cleaner look
            float smallWaves = 0.0;
            for(int i = 0; i < 3; i++) {
                if(i >= uSmallWavesIterations) break;
                float freq = uSmallWavesFrequency * pow(2.0, float(i));
                float amp = 1.0 / pow(2.0, float(i) + 1.5);
                smallWaves += cnoise(vec3(
                    modelPosition.xz * freq * 0.3,
                    uTime * uSmallWavesSpeed
                )) * amp;
            }
            
            modelPosition.y += smallWaves * uSmallWavesElevation * 0.5;
            
            // Calculate proper normal from tangent and binormal
            vec3 normal = normalize(cross(binormal, tangent));
            
            vElevation = modelPosition.y;
            vNormal = normalize(normalMatrix * normal);
            vPosition = modelPosition.xyz;
            
            vec4 viewPosition = viewMatrix * modelPosition;
            gl_Position = projectionMatrix * viewPosition;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uDepthColor;
        uniform vec3 uSurfaceColor;
        uniform vec3 uGlowColor;
        uniform vec3 uFoamColor;
        uniform float uDepthOffset;
        uniform float uDepthMultiplier;
        uniform float uColorOffset;
        uniform float uColorMultiplier;
        uniform float uGlowIntensity;
        uniform vec3 uGlowWave;
        uniform float uCausticsIntensity;
        uniform float uAmbientLight;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform vec3 uFogColor;
        
        varying float vElevation;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;
        
        // Simplex noise for caustics
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
        
        float snoise(vec2 v) {
            const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                               -0.577350269189626, 0.024390243902439);
            vec2 i  = floor(v + dot(v, C.yy));
            vec2 x0 = v - i + dot(i, C.xx);
            vec2 i1;
            i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod289(i);
            vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                + i.x + vec3(0.0, i1.x, 1.0));
            vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                dot(x12.zw,x12.zw)), 0.0);
            m = m*m;
            m = m*m;
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
            // Base color from elevation
            float mixStrength = (vElevation + uColorOffset) * uColorMultiplier;
            mixStrength = clamp(mixStrength, 0.0, 1.0);
            vec3 color = mix(uDepthColor, uSurfaceColor, mixStrength);
            
            // Lighting
            vec3 lightDir = normalize(vec3(0.3, 1.0, 0.5));
            float diffuse = max(dot(vNormal, lightDir), 0.0);
            diffuse = pow(diffuse, 0.6) * 0.5 + uAmbientLight;
            
            // Specular highlights
            vec3 viewDir = normalize(cameraPosition - vPosition);
            vec3 halfDir = normalize(lightDir + viewDir);
            float specular = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
            
            // Fresnel effect (rim lighting)
            float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
            
            // Caustics pattern
            float caustics = 0.0;
            if(uCausticsIntensity > 0.0) {
                vec2 causticsUV = vPosition.xz * 1.5;
                float c1 = snoise(causticsUV + uTime * 0.3);
                float c2 = snoise(causticsUV * 1.5 - uTime * 0.2);
                float c3 = snoise(causticsUV * 2.0 + uTime * 0.4);
                caustics = (c1 + c2 + c3) * 0.33;
                caustics = pow(max(caustics, 0.0), 2.0) * uCausticsIntensity;
            }
            
            // Bioluminescent glow wave
            float glowDist = length(vPosition.xz - uGlowWave.xy);
            float glowWave = smoothstep(uGlowWave.z + 2.0, uGlowWave.z, glowDist);
            glowWave *= uGlowIntensity;
            
            // Additional ambient bioluminescence
            float bioLum = snoise(vPosition.xz * 0.5 + uTime * 0.1) * 0.5 + 0.5;
            bioLum = pow(bioLum, 3.0) * 0.3;
            
            // Combine lighting
            color *= diffuse;
            color += vec3(specular) * 0.6;
            color += uGlowColor * (glowWave + bioLum * uGlowIntensity * 0.5);
            color += uGlowColor * caustics;
            color += uSurfaceColor * fresnel * 0.3;
            
            // Depth fog
            float depth = gl_FragCoord.z / gl_FragCoord.w;
            float fogFactor = smoothstep(uFogNear, uFogFar, depth);
            color = mix(color, uFogColor, fogFactor * 0.5);
            
            gl_FragColor = vec4(color, 0.92);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Bioluminescent Plankton Shader
// ─────────────────────────────────────────────────────────────────────────────
const PlanktonShader = {
    uniforms: {
        uTime: { value: 0 },
        uGlowColor: { value: new THREE.Color(0x00ffff) },
        uIntensityBoost: { value: 0.0 },
    },
    vertexShader: `
        attribute float aScale;
        attribute float aPhase;
        uniform float uTime;
        varying float vPhase;
        varying float vScale;
        
        void main() {
            vPhase = aPhase;
            vScale = aScale;
            
            vec4 modelPosition = modelMatrix * vec4(position, 1.0);
            
            // Gentle floating motion
            modelPosition.y += sin(uTime * 0.5 + aPhase) * 0.05;
            modelPosition.x += sin(uTime * 0.3 + aPhase * 2.0) * 0.03;
            modelPosition.z += cos(uTime * 0.4 + aPhase * 1.5) * 0.03;
            
            vec4 viewPosition = viewMatrix * modelPosition;
            gl_Position = projectionMatrix * viewPosition;
            
            // Size attenuation
            gl_PointSize = aScale * (300.0 / -viewPosition.z);
            gl_PointSize = clamp(gl_PointSize, 1.0, 15.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uGlowColor;
        uniform float uIntensityBoost;
        varying float vPhase;
        varying float vScale;
        
        void main() {
            // Circular point with soft edges
            float dist = length(gl_PointCoord - 0.5) * 2.0;
            if(dist > 1.0) discard;
            
            float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
            
            // Pulsing glow
            float pulse = sin(uTime * 2.0 + vPhase * 6.28) * 0.3 + 0.7;
            pulse += uIntensityBoost * 0.5;
            
            vec3 color = uGlowColor * pulse;
            
            // Add white core
            float core = 1.0 - smoothstep(0.0, 0.3, dist);
            color += vec3(1.0) * core * 0.5;
            
            gl_FragColor = vec4(color, alpha * 0.8 * pulse);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class LuminousTidesTheme extends BaseTheme {
    constructor() {
        super('luminous-tides');
        this.resourceProfile = 'heavy-gpu';

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.water = null;
        this.waterMaterial = null;
        this.plankton = null;
        this.planktonMaterial = null;
        this.ambientParticles = null;
        this.underwaterLight = null;

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // Game event state
        this.glowIntensity = 0;
        this.targetGlowIntensity = 0;
        this.glowWavePosition = new THREE.Vector3(0, 0, 0);
        this.glowWaveRadius = 0;
        this.bloomBoost = 0;

        // Wave boost for combos
        this.waveElevationBoost = 0;
        this.targetWaveElevationBoost = 0;
        this.baseWaveElevation = 0.15; // Calm waves normally, combos boost them up
        this.baseBigWavesSpeed = 0.75;

        // Particle texture (cached)
        this.particleTexture = null;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        // Ambient wave system
        this.ambientWaveTimer = 0;
        this.AMBIENT_WAVE_INTERVAL = 12.0;

        console.log('[LuminousTides] Three.js theme constructed');
    }

    getTetrominoConfig() {
        return LUMINOUS_TIDES_TETROMINOS;
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
        console.log('[LuminousTides] Creating 3D ocean scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('luminous-tides-theme');
        if (!container) {
            console.error('[LuminousTides] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createOceanSurface();
        this.createUnderwaterEnvironment();
        this.createPlankton();
        this.createAmbientParticles();
        this.setupLighting();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[LuminousTides] 3D scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x000408, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000810, 0.08);

        // Camera positioned above water looking down at an angle
        this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
        this.camera.position.set(0, 3, 6);
        this.camera.lookAt(0, -0.5, 0);

        console.log('[LuminousTides] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ocean Surface with Gerstner Waves
    // ─────────────────────────────────────────────────────────────────────────

    createOceanSurface() {
        const segments = this.qualityPreset.waterSegments;
        const geometry = new THREE.PlaneGeometry(100, 100, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        this.waterMaterial = new THREE.ShaderMaterial({
            uniforms: { ...OceanShader.uniforms },
            vertexShader: OceanShader.vertexShader,
            fragmentShader: OceanShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true,
        });

        this.water = new THREE.Mesh(geometry, this.waterMaterial);
        this.water.position.y = 0;
        this.scene.add(this.water);

        console.log('[LuminousTides] Ocean surface created with', segments, 'segments');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Underwater Environment
    // ─────────────────────────────────────────────────────────────────────────

    createUnderwaterEnvironment() {
        // Create a deep underwater plane for depth
        const underwaterGeometry = new THREE.PlaneGeometry(200, 200);
        underwaterGeometry.rotateX(-Math.PI / 2);

        const underwaterMaterial = new THREE.MeshStandardMaterial({
            color: 0x000408,
            roughness: 1,
            metalness: 0,
            transparent: true,
            opacity: 0.9,
        });

        const underwaterPlane = new THREE.Mesh(underwaterGeometry, underwaterMaterial);
        underwaterPlane.position.y = -5;
        this.scene.add(underwaterPlane);

        // Add volumetric light rays (represented as subtle planes)
        const rayCount = 5;
        for (let i = 0; i < rayCount; i++) {
            const rayGeometry = new THREE.PlaneGeometry(0.5, 8);
            const rayMaterial = new THREE.MeshBasicMaterial({
                color: 0x003344,
                transparent: true,
                opacity: 0.1,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });

            const ray = new THREE.Mesh(rayGeometry, rayMaterial);
            ray.position.set(
                (Math.random() - 0.5) * 15,
                -2,
                (Math.random() - 0.5) * 15,
            );
            ray.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
            ray.rotation.z = Math.random() * Math.PI;
            this.scene.add(ray);
        }

        console.log('[LuminousTides] Underwater environment created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bioluminescent Plankton
    // ─────────────────────────────────────────────────────────────────────────

    createPlankton() {
        const count = this.qualityPreset.planktonCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const scales = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread around under the water surface
            positions[i3] = (Math.random() - 0.5) * 18;
            positions[i3 + 1] = -0.5 - Math.random() * 4;
            positions[i3 + 2] = (Math.random() - 0.5) * 18;

            scales[i] = 3 + Math.random() * 5;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        this.planktonMaterial = new THREE.ShaderMaterial({
            uniforms: { ...PlanktonShader.uniforms },
            vertexShader: PlanktonShader.vertexShader,
            fragmentShader: PlanktonShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.plankton = new THREE.Points(geometry, this.planktonMaterial);
        this.scene.add(this.plankton);

        console.log('[LuminousTides] Plankton created with', count, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Create Circular Glow Texture for Particles
    // ─────────────────────────────────────────────────────────────────────────

    createParticleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Create radial gradient for soft circular glow
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(200, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(100, 200, 255, 0.4)');
        gradient.addColorStop(0.8, 'rgba(50, 150, 200, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 100, 150, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Floating Particles (Circular Glowing Orbs)
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const count = this.qualityPreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        // Beautiful bioluminescent color palette
        const colorPalette = [
            new THREE.Color(0x00ffff), // Bright cyan
            new THREE.Color(0x40ffcc), // Aqua mint
            new THREE.Color(0x80ffff), // Light cyan
            new THREE.Color(0x00ccff), // Ocean blue
            new THREE.Color(0x66ffdd), // Seafoam
            new THREE.Color(0x00ffaa), // Teal green
            new THREE.Color(0x88ddff), // Sky blue
        ];

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Spread particles in 3D space around the ocean
            positions[i3] = (Math.random() - 0.5) * 22;
            positions[i3 + 1] = Math.random() * 3 - 2; // Mostly below water surface
            positions[i3 + 2] = (Math.random() - 0.5) * 22;

            // Random color from palette
            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Varied sizes for depth and interest
            sizes[i] = 0.08 + Math.random() * 0.15;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Create or reuse circular glow texture
        if (!this.particleTexture) {
            this.particleTexture = this.createParticleTexture();
        }

        const material = new THREE.PointsMaterial({
            size: 0.2,
            map: this.particleTexture,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
            depthWrite: false,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.scene.add(this.ambientParticles);

        console.log('[LuminousTides] Glowing orb particles created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting Setup
    // ─────────────────────────────────────────────────────────────────────────

    setupLighting() {
        // Ambient light (dim deep sea)
        const ambientLight = new THREE.AmbientLight(0x001020, 0.3);
        this.scene.add(ambientLight);

        // Directional light (moonlight from above)
        const moonLight = new THREE.DirectionalLight(0x4488aa, 0.5);
        moonLight.position.set(2, 10, 3);
        this.scene.add(moonLight);

        // Point light for underwater glow effects
        this.underwaterLight = new THREE.PointLight(0x00ffff, 0, 8);
        this.underwaterLight.position.set(0, -1, 0);
        this.scene.add(this.underwaterLight);

        // Hemisphere light for subtle ambient variation
        const hemiLight = new THREE.HemisphereLight(0x0044aa, 0x000208, 0.4);
        this.scene.add(hemiLight);

        console.log('[LuminousTides] Lighting setup complete');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) {
            console.log('[LuminousTides] Post-processing disabled for quality level');
            return;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.composer = new EffectComposer(this.renderer);

        // Render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Bloom pass for bioluminescence
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.3,
        );
        this.composer.addPass(this.bloomPass);

        // Vignette pass
        this.vignettePass = new ShaderPass(VignetteShader);
        this.composer.addPass(this.vignettePass);

        console.log('[LuminousTides] Post-processing setup complete');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        console.log('[LuminousTides] Setting up event listeners');

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

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
        console.log('[LuminousTides] Event listeners set up');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Event Reactions
    // ─────────────────────────────────────────────────────────────────────────

    onLineClear(lineCount) {
        if (lineCount >= 4) {
            // Tetris! Massive bioluminescent burst
            this.triggerGlowWave(0, 0, 1.0, 6);
            this.targetGlowIntensity = 1.0;
            this.bloomBoost = 0.5;
        } else if (lineCount >= 2) {
            // Multi-line: Large glow
            this.triggerGlowWave(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                0.6,
                4,
            );
            this.targetGlowIntensity = 0.6;
            this.bloomBoost = 0.3;
        } else {
            // Single line: Small pulse
            this.triggerGlowWave(
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 6,
                0.3,
                2,
            );
            this.targetGlowIntensity = 0.3;
            this.bloomBoost = 0.15;
        }
    }

    onCombo(comboCount) {
        const intensity = Math.min(0.4 + comboCount * 0.15, 1.2);
        this.triggerGlowWave(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5,
            intensity,
            3 + comboCount * 0.5,
        );
        this.targetGlowIntensity = intensity;
        this.bloomBoost = 0.2 + comboCount * 0.05;

        // Boost wave height dramatically for combos - creates stormy seas!
        // Higher boost and it ACCUMULATES with each combo hit
        const comboBoost = 0.15 + comboCount * 0.12;
        this.targetWaveElevationBoost = Math.min(
            this.targetWaveElevationBoost + comboBoost,
            1.2, // Much higher cap for truly stormy waves
        );
    }

    onPieceLock() {
        // Create visible luminous blue glow on every piece lock
        const x = (Math.random() - 0.5) * 8;
        const z = (Math.random() - 0.5) * 8;

        // Strong bioluminescent glow effect
        this.triggerGlowWave(x, z, 0.4, 3.0);
        this.targetGlowIntensity = Math.max(this.targetGlowIntensity, 0.35);

        // Add bloom boost for extra luminosity
        this.bloomBoost = Math.max(this.bloomBoost, 0.15);

        // Tiny wave boost for constant subtle motion
        this.targetWaveElevationBoost = Math.max(this.targetWaveElevationBoost, 0.03);
    }

    triggerGlowWave(x, z, intensity, radius) {
        // Smoothly blend glow position toward new location (don't jump)
        this.glowWavePosition.x += (x - this.glowWavePosition.x) * 0.3;
        this.glowWavePosition.y += (z - this.glowWavePosition.y) * 0.3;

        // Don't reset radius - let it keep expanding for continuous glow
        // Radius naturally expands in animation loop

        // ADD to target intensity for gentle accumulation effect
        this.targetGlowIntensity += intensity * 0.2;
        // Cap at moderate maximum so it doesn't get too bright
        this.targetGlowIntensity = Math.min(this.targetGlowIntensity, 0.8);

        // Update glow wave position in shader (smooth blend)
        if (this.waterMaterial) {
            this.waterMaterial.uniforms.uGlowWave.value.set(
                this.glowWavePosition.x,
                this.glowWavePosition.y,
                this.glowWaveRadius,
            );
        }

        // Boost light intensity - gentle accumulation
        if (this.underwaterLight) {
            // Smoothly move light toward new position
            this.underwaterLight.position.x += (x - this.underwaterLight.position.x) * 0.3;
            this.underwaterLight.position.z += (z - this.underwaterLight.position.z) * 0.3;
            // Add to existing intensity (moderate amount)
            this.underwaterLight.intensity += intensity * 0.5;
            this.underwaterLight.intensity = Math.min(this.underwaterLight.intensity, 1.5);
        }
    }

    createAmbientWave() {
        // Random subtle glow event
        const x = (Math.random() - 0.5) * 12;
        const z = (Math.random() - 0.5) * 12;
        this.triggerGlowWave(x, z, 0.2, 2);
        this.targetGlowIntensity = 0.2;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            // Ambient wave timer
            this.ambientWaveTimer += delta;
            if (this.ambientWaveTimer >= this.AMBIENT_WAVE_INTERVAL) {
                this.ambientWaveTimer = 0;
                this.createAmbientWave();
            }

            // Update water shader
            if (this.waterMaterial) {
                this.waterMaterial.uniforms.uTime.value = this.time;

                // Ultra-smooth glow interpolation - natural breathing effect
                this.glowIntensity += (this.targetGlowIntensity - this.glowIntensity) * delta * 0.25;
                this.targetGlowIntensity *= 0.993; // Fade back to normal

                this.waterMaterial.uniforms.uGlowIntensity.value = this.glowIntensity;

                // Expand glow wave radius very slowly
                this.glowWaveRadius += delta * 0.3;
                this.waterMaterial.uniforms.uGlowWave.value.z = this.glowWaveRadius;

                // Handle wave elevation boost (for combos creating stormy waves)
                // Slow interpolation - waves build gradually
                this.waveElevationBoost += (this.targetWaveElevationBoost - this.waveElevationBoost) * delta * 0.05;

                // Decay back to calm - storms fade over several seconds
                this.targetWaveElevationBoost *= 0.997;

                // Apply boosted wave elevation
                const currentElevation = this.baseWaveElevation + this.waveElevationBoost;
                this.waterMaterial.uniforms.uBigWavesElevation.value = currentElevation;

                // Gradual speed change during storms
                const speedBoost = 1.0 + this.waveElevationBoost * 2.0;
                this.waterMaterial.uniforms.uBigWavesSpeed.value = this.baseBigWavesSpeed * speedBoost;
            }

            // Update plankton shader
            if (this.planktonMaterial) {
                this.planktonMaterial.uniforms.uTime.value = this.time;
                this.planktonMaterial.uniforms.uIntensityBoost.value = this.glowIntensity;
            }

            // Animate underwater light - very slow decay for persistent glow
            if (this.underwaterLight) {
                this.underwaterLight.intensity *= 0.998;
            }

            // Animate ambient particles (gentle float)
            if (this.ambientParticles) {
                const positions = this.ambientParticles.geometry.attributes.position.array;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i + 1] += Math.sin(this.time * 0.5 + i) * 0.001;
                }
                this.ambientParticles.geometry.attributes.position.needsUpdate = true;
            }

            // Update bloom boost - ultra smooth
            if (this.bloomPass) {
                const targetStrength = this.qualityPreset.bloomStrength + this.bloomBoost;
                this.bloomPass.strength += (targetStrength - this.bloomPass.strength) * delta * 0.3;
                this.bloomBoost *= 0.9985; // Very gradual bloom decay
            }

            // Mouse parallax camera (base at 0,3,6 looking at 0,-0.5,0)
            if (this.camera) {
                this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 2.2);
                this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 2.2);
                const parallaxX = this.smoothedPointerX * 0.6;
                const parallaxY = -this.smoothedPointerY * 0.3;
                this.camera.position.x = parallaxX;
                this.camera.position.y = 3 + parallaxY;
                this.camera.lookAt(parallaxX * 0.4, -0.5 + parallaxY * 0.4, 0);
            }

            // Render
            if (this.composer) {
                this.composer.render();
            } else if (this.renderer) {
                this.renderer.render(this.scene, this.camera);
            }

            const animId = requestAnimationFrame(animate);
            this.registerAnimation(animId);
        };

        const animId = requestAnimationFrame(animate);
        this.registerAnimation(animId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle Methods
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        console.log('[LuminousTides] stop() called');

        super.stop();

        // Unsubscribe from events
        this.clearEventUnsubscribers();

        console.log('[LuminousTides] Stopped');
    }

    releaseInactiveResources() {
        // Dispose of theme-owned geometry/material references before the shared scene is released
        if (this.water) {
            this.water.geometry.dispose();
            this.waterMaterial.dispose();
        }

        if (this.plankton) {
            this.plankton.geometry.dispose();
            this.planktonMaterial.dispose();
        }

        if (this.ambientParticles) {
            this.ambientParticles.geometry.dispose();
            this.ambientParticles.material.dispose();
        }

        this.water = null;
        this.waterMaterial = null;
        this.plankton = null;
        this.planktonMaterial = null;
        this.ambientParticles = null;

        super.releaseInactiveResources();
    }

    cleanup() {
        console.log('[LuminousTides] cleanup() called');

        super.cleanup();
        console.log('[LuminousTides] Cleaned up');
    }

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        if (this.renderer) {
            this.renderer.setSize(width, height);
        }

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    update() {
        // Animation loop handles updates
    }
}
