/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ STELLAR DRIFT ✧
 *  A 3D Space Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Directly inspired by Andromeda's architecture:
 * - Camera at z=1450, y=100
 * - Central planet (size 500) with glow planes
 * - Front meteor field (500 meteors, z=500-1400)
 * - Scrolling background planes at z=-520
 * - Post-processing with vignette
 *
 * All code and shaders are original.
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { STELLAR_DRIFT_TETROMINOS } from './stellar-drift-tetrominos.js';
import { StellarDriftPost } from './stellar-drift-post.js';
import {
    createStellarStarfieldMaterial,
    createStellarPlanetMaterial,
    createStellarPlanetRingMaterial,
    createStellarGlowPlaneMaterial,
    createStellarBloodMoonNebulaMaterial,
    createStellarNebulaMaterial,
    createStellarDustRingMaterial,
    createStellarAmbientParticlesMaterial,
    createStellarNebulaBurstMaterial,
    createStellarCelestialBodyMaterial,
    createStellarShockwaveRingMaterial,
    createStellarShootingStarMaterial,
    createStellarMeteorMaterial,
} from './stellar-drift-materials.js';
import {
    StellarAmbientParticleCompute,
    StellarDustRingCompute,
    StellarNebulaBurstCompute,
} from './stellar-drift-compute.js';

// ─────────────────────────────────────────────────────────────────────────────
// Debug Flags + Deterministic Helpers (Phase 0)
// ─────────────────────────────────────────────────────────────────────────────

function parseStellarFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noPost: false,
            noMRT: false,
            noCompute: false,
            mrtAudit: false,
            noDrs: false,
            noVolume: false,
            baseline: false,
            seed: null,
            fixedDeltaMs: null,
            playback: null,
            playbackLoops: 1,
        };
    }

    const params = new URLSearchParams(window.location.search);
    const hasFlag = (name) => params.has(name)
        || params.get(name) === '1'
        || params.get(name) === 'true';

    const seedValue = Number(params.get('stellarSeed') || params.get('seed'));
    const fixedDeltaValue = Number(params.get('stellarFixedDt') || params.get('fixedDt'));
    const playbackValue = params.get('stellarPlayback');
    const playbackLoopsValue = Number(params.get('stellarPlaybackLoops'));

    return {
        forceWebGL: hasFlag('forceWebGL'),
        noPost: hasFlag('stellarNoPost'),
        noMRT: hasFlag('stellarNoMRT'),
        noCompute: hasFlag('stellarNoCompute'),
        mrtAudit: hasFlag('stellarMrtAudit'),
        noDrs: hasFlag('stellarNoDrs'),
        noVolume: hasFlag('stellarNoVolume'),
        baseline: hasFlag('stellarBaseline'),
        seed: Number.isFinite(seedValue) ? seedValue : null,
        fixedDeltaMs: Number.isFinite(fixedDeltaValue) && fixedDeltaValue > 0 ? fixedDeltaValue : null,
        playback: playbackValue && playbackValue.trim() ? playbackValue.trim() : null,
        playbackLoops: Number.isFinite(playbackLoopsValue) && playbackLoopsValue > 0
            ? Math.floor(playbackLoopsValue)
            : 1,
    };
}

function createSeededRandom(seed) {
    if (!Number.isFinite(seed)) return Math.random;
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state === 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

const STELLAR_BLOOD_MOON_NEBULA_SCALE = 1.8;
const STELLAR_BLOOD_MOON_NEBULA_WRAP = 6000 * STELLAR_BLOOD_MOON_NEBULA_SCALE;
const STELLAR_BLOOD_MOON_PALETTES = [
    {
        name: 'gold-cream',
        shadow: '#3b1f00',
        body: '#d99c1e',
        glow: '#f8f2c9',
    },
    {
        name: 'teal-mint',
        shadow: '#062730',
        body: '#25c4c2',
        glow: '#d5fff5',
    },
    {
        name: 'violet-lilac',
        shadow: '#1c123c',
        body: '#8256ff',
        glow: '#efe1ff',
    },
    {
        name: 'magenta-rose',
        shadow: '#2c0f24',
        body: '#d8489a',
        glow: '#ffd8f4',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets (matching Andromeda scale)
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        planetDetail: 64,
        meteorCount: 500,
        dustRingParticleCount: 4200,
        ambientParticleCount: 780,
        nebulaBurstCapacity: 32000,
        maxBurstParticlesPerNebula: 1900,
        bloomStrength: 0.3,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    Ultra: {
        planetDetail: 48,
        meteorCount: 400,
        dustRingParticleCount: 3600,
        ambientParticleCount: 660,
        nebulaBurstCapacity: 26000,
        maxBurstParticlesPerNebula: 1600,
        bloomStrength: 0.28,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    High: {
        planetDetail: 32,
        meteorCount: 300,
        dustRingParticleCount: 3000,
        ambientParticleCount: 520,
        nebulaBurstCapacity: 20000,
        maxBurstParticlesPerNebula: 1250,
        bloomStrength: 0.25,
        bloomRadius: 0.4,
        enablePostProcessing: true,
    },
    Medium: {
        planetDetail: 24,
        meteorCount: 200,
        dustRingParticleCount: 2400,
        ambientParticleCount: 420,
        nebulaBurstCapacity: 15000,
        maxBurstParticlesPerNebula: 920,
        bloomStrength: 0.28,
        bloomRadius: 0.4,
        enablePostProcessing: true,
    },
    Low: {
        planetDetail: 16,
        meteorCount: 100,
        dustRingParticleCount: 1500,
        ambientParticleCount: 280,
        nebulaBurstCapacity: 9800,
        maxBurstParticlesPerNebula: 620,
        bloomStrength: 0.22,
        bloomRadius: 0.3,
        enablePostProcessing: false,
    },
    Minimal: {
        planetDetail: 12,
        meteorCount: 50,
        dustRingParticleCount: 900,
        ambientParticleCount: 180,
        nebulaBurstCapacity: 6400,
        maxBurstParticlesPerNebula: 420,
        bloomStrength: 0.18,
        bloomRadius: 0.3,
        enablePostProcessing: false,
    },
};

const QUALITY_BUDGETS = {
    Extreme: {
        maxDrawCalls: 620,
        maxPostCostMs: 4.9,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.76,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.03,
        adaptiveUpRate: 0.024,
        minResolutionScale: 0.74,
        maxResolutionScale: 1.0,
        baseResolutionScale: 1.0,
        minEffectScale: 0.56,
        compileTimeoutMs: 4200,
    },
    Ultra: {
        maxDrawCalls: 560,
        maxPostCostMs: 4.5,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.72,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.032,
        adaptiveUpRate: 0.022,
        minResolutionScale: 0.7,
        maxResolutionScale: 1.0,
        baseResolutionScale: 0.98,
        minEffectScale: 0.54,
        compileTimeoutMs: 3900,
    },
    High: {
        maxDrawCalls: 480,
        maxPostCostMs: 4.0,
        targetFrameMs: 16.7,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.68,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.035,
        adaptiveUpRate: 0.02,
        minResolutionScale: 0.66,
        maxResolutionScale: 1.0,
        baseResolutionScale: 0.95,
        minEffectScale: 0.5,
        compileTimeoutMs: 3600,
    },
    Medium: {
        maxDrawCalls: 390,
        maxPostCostMs: 3.3,
        targetFrameMs: 17.4,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.62,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.04,
        adaptiveUpRate: 0.018,
        minResolutionScale: 0.6,
        maxResolutionScale: 0.95,
        baseResolutionScale: 0.9,
        minEffectScale: 0.44,
        compileTimeoutMs: 3200,
    },
    Low: {
        maxDrawCalls: 280,
        maxPostCostMs: 2.7,
        targetFrameMs: 18.9,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.57,
        adaptiveMaxScale: 0.95,
        adaptiveDownRate: 0.043,
        adaptiveUpRate: 0.016,
        minResolutionScale: 0.54,
        maxResolutionScale: 0.86,
        baseResolutionScale: 0.82,
        minEffectScale: 0.36,
        compileTimeoutMs: 2800,
    },
    Minimal: {
        maxDrawCalls: 220,
        maxPostCostMs: 2.3,
        targetFrameMs: 20.0,
        adaptiveEnabled: true,
        adaptiveMinScale: 0.52,
        adaptiveMaxScale: 0.9,
        adaptiveDownRate: 0.046,
        adaptiveUpRate: 0.014,
        minResolutionScale: 0.5,
        maxResolutionScale: 0.8,
        baseResolutionScale: 0.74,
        minEffectScale: 0.3,
        compileTimeoutMs: 2400,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 },
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
            float vig = smoothstep(offset, offset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Chromatic Aberration Shader (High-Speed Warp Effect)
// ─────────────────────────────────────────────────────────────────────────────
const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        intensity: { value: 0.0 },
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
        uniform float intensity;
        varying vec2 vUv;
        
        void main() {
            vec2 dir = vUv - 0.5;
            float dist = length(dir);
            vec2 offset = dir * dist * intensity * 0.02;
            
            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;
            
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Radial Speed Lines Shader (Motion Trails Effect)
// ─────────────────────────────────────────────────────────────────────────────
const RadialSpeedLinesShader = {
    uniforms: {
        tDiffuse: { value: null },
        intensity: { value: 0.0 },
        time: { value: 0.0 },
        center: { value: new THREE.Vector2(0.5, 0.5) },
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
        uniform float intensity;
        uniform float time;
        uniform vec2 center;
        varying vec2 vUv;
        
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            if (intensity > 0.01) {
                // Radial blur / zoom effect
                vec2 dir = vUv - center;
                float dist = length(dir);
                vec2 normDir = normalize(dir);
                
                // Sample along the radial direction for motion blur
                vec4 sum = texel;
                float samples = 8.0;
                float blurAmount = intensity * 0.03 * dist;
                
                for (float i = 1.0; i <= 8.0; i++) {
                    float t = i / samples;
                    vec2 offset = normDir * blurAmount * t;
                    sum += texture2D(tDiffuse, vUv - offset) * (1.0 - t * 0.3);
                }
                
                texel = sum / (samples * 0.7 + 1.0);
                
                // Add subtle speed lines
                float angle = atan(dir.y, dir.x);
                float speedLine = sin(angle * 60.0 + time * 10.0) * 0.5 + 0.5;
                speedLine = pow(speedLine, 8.0) * intensity * 0.15 * dist;
                texel.rgb += vec3(speedLine);
            }
            
            gl_FragColor = texel;
        }
    `,
};

const ColorGradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        exposure: { value: 0.99 },
        contrast: { value: 1.08 },
        saturation: { value: 1.06 },
        ditherStrength: { value: 0.0016 },
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
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform float ditherStrength;
        varying vec2 vUv;

        void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb * exposure;

            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, saturation);
            color = (color - 0.5) * contrast + 0.5;

            float noise = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
            color += (noise - 0.5) * ditherStrength;

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class StellarDriftTheme extends BaseTheme {
    constructor() {
        super('stellar-drift');

        this.flags = parseStellarFlags();
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.fixedElapsed = 0;
        this.simulationTimeScale = 0.12;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null; // WebGL post stack
        this.postProcessing = null; // WebGPU post stack
        this.bloomPass = null;
        this.vignettePass = null;
        this.chromaticPass = null;
        this.radialSpeedPass = null;
        this.colorGradePass = null;
        this.animationFrameId = null;
        this.resizeHandler = null;
        this.webglContextLostHandler = null;
        this.webglContextRestoredHandler = null;
        this.themeTimeouts = new Set();
        this.isWebGPU = false;
        this.isWebGL = false;
        this.deviceLossRecoveryInProgress = false;
        this.deviceLossRecoveries = 0;
        this.renderFallbackInProgress = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            maxColorAttachments: 1,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
            post: false,
            mrt: false,
            compute: false,
        };

        // Scene elements
        this.planet = null;
        this.smallGlow = null;
        this.bigGlow = null;
        this.backgroundPlanes = [];
        this.meteors = [];
        this.meteorInstancedMesh = null;
        this.meteorMatrixDummy = new THREE.Object3D();
        this.nebulaClouds = [];
        this.nebulaMeshes = [];
        this.nebulaStacks = [];
        this.nebulaPalette = null;
        this.secondaryBodies = [];
        this.depthHazeLayers = [];
        this.ambientParticles = null;
        this.dustRing = null;
        this.ambientParticleCompute = null;
        this.dustRingCompute = null;
        this.nebulaBurstCompute = null;
        this.nebulaBurstPool = null;
        this.starfield = null;
        this.heroRingSystem = null;
        this.heroRingMaterialData = [];
        this.starfieldMaterialData = null;
        this.planetMaterialData = null;
        this.dustRingMaterialData = null;
        this.ambientParticlesMaterialData = null;
        this.nebulaBurstMaterialData = null;
        this.meteorLight = null;
        this.meteorLightTarget = null;
        this.ambientLight = null;
        this.keyLight = null;
        this.crashMeteorGeometryCache = null;

        // Effect arrays for 3D gameplay effects
        this.shockwaveRings = [];
        this.shootingStars = [];
        this.cometEvents = [];
        this.crashMeteors = [];
        this.impactFlashes = [];
        this.auroraEvents = [];
        this.starTwinkleIntensity = 0;
        this.dustRingPulse = 0; // Smooth dust ring expansion
        this.bloomPulseIntensity = 0; // Smooth bloom boost
        this.nebulaBoostIntensity = 0; // Smooth nebula brightness
        this.glowSurgeIntensity = 0; // Smooth planet glow surge
        this.meteorActivity = 0; // Dynamic meteor spin speed based on APM
        this.nebulaPulse = 0; // Pulse intensity for nebulas
        this.heroRingGlitterIntensity = 0;
        this.planetLightningIntensity = 0;
        this.cameraSway = new THREE.Vector3(0, 0, 0); // Gentle camera motion
        this.cameraBasePosition = new THREE.Vector3(0, 100, 1450);
        this.cameraLookTarget = new THREE.Vector3(0, 0, 0);
        this.cameraCurrentLookTarget = new THREE.Vector3(0, 0, 0);
        this.cameraLookOffset = new THREE.Vector3(0, 0, 0);
        this.cameraRollOffset = 0;
        this.cameraDriftSeed = this.rand() * Math.PI * 2;
        this.focalCorridorHalfWidth = 1050;
        this.lightningFlashCap = 0.88;
        this.auroraPulse = 0;

        this.reactiveState = {
            twinkle: 0,
            dust: 0,
            bloom: 0,
            nebula: 0,
            pulse: 0,
            glow: 0,
            ringGlitter: 0,
            lightning: 0,
            aurora: 0,
            comet: 0,
            meteor: 0,
        };
        this.reactiveTarget = {
            twinkle: 0,
            dust: 0,
            bloom: 0,
            nebula: 0,
            pulse: 0,
            glow: 0,
            ringGlitter: 0,
            lightning: 0,
            aurora: 0,
            comet: 0,
            meteor: 0,
        };
        this.reactiveCaps = {
            twinkle: 1.4,
            dust: 0.38,
            bloom: 0.75,
            nebula: 0.72,
            pulse: 1.2,
            glow: 0.62,
            ringGlitter: 0.84,
            lightning: this.lightningFlashCap,
            aurora: 0.72,
            comet: 0.72,
            meteor: 5.0,
        };

        // WARP SPEED EFFECTS - Tunnel Vision & Motion Trails
        this.baseFOV = 75;
        this.currentFOV = 75;
        this.targetFOV = 75;
        this.cameraShake = new THREE.Vector3(0, 0, 0);
        this.chromaticIntensity = 0; // Chromatic aberration strength
        this.radialBlurIntensity = 0; // Radial motion blur strength
        this.warpSpeed = 0; // Current warp speed (0-1)
        this.targetWarpSpeed = 0; // Target warp speed
        this.starTrailIntensity = 0; // Star elongation intensity
        this.speedLineOpacity = 0; // Speed line visibility

        // Nebula Particle Bursts
        this.nebulaBursts = [];
        this.nebulaColors = [
            new THREE.Color(0x00FF88), // Emerald
            new THREE.Color(0xFFAA00), // Gold/Orange
            new THREE.Color(0x6633FF), // Deep Purple
            new THREE.Color(0xFF3366), // Red/Magenta
            new THREE.Color(0x00FFFF), // Cyan/Teal
            new THREE.Color(0x3344FF), // Indigo
            new THREE.Color(0xFF0044), // Crimson
            new THREE.Color(0xFFCC00), // Amber
            new THREE.Color(0xCCCCFF), // Silver/Ghost
        ];
        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;
        this.planetPhaseOffset = this.rand() * Math.PI * 2; // Random starting position for planet

        // Baseline instrumentation (Phase 0)
        this.baselineMaxFrames = 2400;
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineTimeouts = new Set();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };

        // State
        this.glowIntensity = 0.5;
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.activeQualityLevel = 'High';
        this.performanceBudget = { ...QUALITY_BUDGETS.High };
        this.adaptiveScalerState = {
            frameTimeEmaMs: this.performanceBudget.targetFrameMs,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: 1,
            resolutionScale: this.performanceBudget.baseResolutionScale,
            baseResolutionScale: this.performanceBudget.baseResolutionScale,
            effectScale: 1,
        };
        this.lastRenderPath = 'none';
        this.lastPostCostMs = 0;
        this.qualitySyncAccumulator = 0;

        console.log('[StellarDrift] Theme constructed');
    }

    getTetrominoConfig() {
        return STELLAR_DRIFT_TETROMINOS;
    }

    rand() {
        return this.random();
    }

    getBackendLabel() {
        return this.isWebGPU ? 'WebGPU' : 'WebGL2';
    }

    getBackendSlug() {
        return this.isWebGPU ? 'webgpu' : 'webgl2';
    }

    refreshRuntimeFlags() {
        const parsedFlags = parseStellarFlags();
        const previousFlags = this.flags || {};

        // Keep runtime overrides sticky (used for device-loss fallback).
        parsedFlags.forceWebGL = parsedFlags.forceWebGL || previousFlags.forceWebGL === true;
        parsedFlags.noPost = parsedFlags.noPost || previousFlags.noPost === true;
        parsedFlags.noMRT = parsedFlags.noMRT || previousFlags.noMRT === true;
        parsedFlags.noCompute = parsedFlags.noCompute || previousFlags.noCompute === true;
        parsedFlags.mrtAudit = parsedFlags.mrtAudit || previousFlags.mrtAudit === true;
        parsedFlags.noDrs = parsedFlags.noDrs || previousFlags.noDrs === true;
        parsedFlags.noVolume = parsedFlags.noVolume || previousFlags.noVolume === true;

        this.flags = parsedFlags;
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.fixedElapsed = 0;
        this.time = 0;
    }

    shouldForceWebGL() {
        return this.flags.forceWebGL === true;
    }

    shouldUseCompute() {
        return this.isWebGPU
            && this.capabilities.compute === true
            && this.flags.useCompute === true;
    }

    getNebulaBurstCapacity() {
        return this.qualityPreset?.nebulaBurstCapacity ?? 16000;
    }

    getNebulaBackdropLayerCount() {
        switch (this.activeQualityLevel) {
        case 'Extreme':
        case 'Ultra':
        case 'High':
            return 3;
        case 'Medium':
            return 2;
        default:
            return 1;
        }
    }

    getBurstParticlesPerNebulaBudget() {
        const baseCap = this.qualityPreset?.maxBurstParticlesPerNebula ?? 900;
        const fallbackScale = this.shouldUseCompute() ? 1.0 : 0.72;
        return Math.max(120, Math.floor(baseCap * fallbackScale));
    }

    enforceFocalCorridor(xValue, focalX = 0, preferredSide = 1) {
        const corridorMin = focalX - this.focalCorridorHalfWidth;
        const corridorMax = focalX + this.focalCorridorHalfWidth;
        if (xValue < corridorMin || xValue > corridorMax) {
            return xValue;
        }
        const side = preferredSide >= 0 ? 1 : -1;
        return side > 0 ? corridorMax : corridorMin;
    }

    resetReactiveEnvelope() {
        Object.keys(this.reactiveState).forEach((channel) => {
            this.reactiveState[channel] = 0;
            this.reactiveTarget[channel] = 0;
        });
        this.starTwinkleIntensity = 0;
        this.dustRingPulse = 0;
        this.bloomPulseIntensity = 0;
        this.nebulaBoostIntensity = 0;
        this.nebulaPulse = 0;
        this.glowSurgeIntensity = 0;
        this.heroRingGlitterIntensity = 0;
        this.planetLightningIntensity = 0;
        this.auroraPulse = 0;
        this.meteorActivity = 0;
    }

    pushReactiveEnvelope(boosts = {}) {
        Object.keys(this.reactiveState).forEach((channel) => {
            const amount = Number.isFinite(boosts[channel]) ? boosts[channel] : 0;
            if (amount <= 0) return;
            const cap = this.reactiveCaps[channel] ?? 1;
            this.reactiveTarget[channel] = THREE.MathUtils.clamp(
                this.reactiveTarget[channel] + amount,
                0,
                cap,
            );
        });
    }

    updateReactiveEnvelope(deltaSeconds) {
        const attackRates = {
            twinkle: 8.0,
            dust: 7.5,
            bloom: 6.2,
            nebula: 4.8,
            pulse: 5.3,
            glow: 5.6,
            ringGlitter: 6.0,
            lightning: 11.5,
            aurora: 4.2,
            comet: 5.0,
            meteor: 4.4,
        };
        const decayRates = {
            twinkle: 1.6,
            dust: 2.1,
            bloom: 1.45,
            nebula: 0.95,
            pulse: 1.0,
            glow: 0.95,
            ringGlitter: 1.08,
            lightning: 4.4,
            aurora: 0.48,
            comet: 0.92,
            meteor: 0.58,
        };

        Object.keys(this.reactiveState).forEach((channel) => {
            const attack = Math.min(1, (attackRates[channel] ?? 5) * deltaSeconds);
            this.reactiveState[channel] += (this.reactiveTarget[channel] - this.reactiveState[channel]) * attack;
            this.reactiveTarget[channel] = Math.max(
                0,
                this.reactiveTarget[channel] - (decayRates[channel] ?? 1) * deltaSeconds,
            );
        });

        this.starTwinkleIntensity = this.reactiveState.twinkle;
        this.dustRingPulse = this.reactiveState.dust;
        this.bloomPulseIntensity = this.reactiveState.bloom;
        this.nebulaBoostIntensity = this.reactiveState.nebula;
        this.nebulaPulse = this.reactiveState.pulse;
        this.glowSurgeIntensity = this.reactiveState.glow;
        this.heroRingGlitterIntensity = this.reactiveState.ringGlitter;
        this.planetLightningIntensity = THREE.MathUtils.clamp(
            this.reactiveState.lightning,
            0,
            this.lightningFlashCap,
        );
        this.auroraPulse = this.reactiveState.aurora;
        this.meteorActivity = this.reactiveState.meteor;
    }

    triggerPlanetLightning(intensity = 0.25) {
        const clamped = THREE.MathUtils.clamp(intensity, 0, this.lightningFlashCap);
        if (clamped <= 0) return;
        this.pushReactiveEnvelope({ lightning: clamped });
    }

    getReactiveEventBudgets() {
        const detail = this.qualityPreset?.planetDetail ?? 24;
        if (detail >= 48) {
            return { maxAuroras: 4, maxComets: 3, maxCrashMeteors: 3 };
        }
        if (detail >= 32) {
            return { maxAuroras: 3, maxComets: 2, maxCrashMeteors: 2 };
        }
        if (detail >= 24) {
            return { maxAuroras: 2, maxComets: 1, maxCrashMeteors: 2 };
        }
        if (detail >= 16) {
            return { maxAuroras: 0, maxComets: 0, maxCrashMeteors: 1 };
        }
        return { maxAuroras: 0, maxComets: 0, maxCrashMeteors: 1 };
    }

    getCrashMeteorComplexityScale() {
        const detail = this.qualityPreset?.planetDetail ?? 24;
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;

        let detailScale = 1;
        if (detail < 48) detailScale = 0.92;
        if (detail < 32) detailScale = 0.8;
        if (detail < 24) detailScale = 0.66;
        if (detail < 16) detailScale = 0.5;

        const targetFrameMs = this.performanceBudget?.targetFrameMs ?? 16.7;
        const frameTimeEmaMs = this.adaptiveScalerState?.frameTimeEmaMs ?? targetFrameMs;
        const framePressure = Math.max(0, (frameTimeEmaMs - targetFrameMs) / Math.max(1, targetFrameMs));
        const pressureScale = framePressure > 0
            ? THREE.MathUtils.clamp(1 - framePressure * 0.52, 0.42, 1)
            : 1;

        return THREE.MathUtils.clamp(effectScale * detailScale * pressureScale, 0.35, 1);
    }

    getCrashMeteorSpawnProfile(intensity = 0.5) {
        const complexityScale = this.getCrashMeteorComplexityScale();
        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.8);

        return {
            complexityScale,
            radiusScale: THREE.MathUtils.lerp(0.82, 1, complexityScale),
            trailSegments: Math.max(12, Math.floor((22 + clampedIntensity * 12) * complexityScale)),
            fragmentCount: complexityScale >= 0.5
                ? Math.max(1, Math.floor((3 + this.rand() * 4) * complexityScale))
                : 0,
            fireSpriteCount: complexityScale >= 0.58
                ? Math.max(4, Math.floor((9 + clampedIntensity * 8) * complexityScale))
                : 0,
            smokeSpriteCount: complexityScale >= 0.54
                ? Math.max(5, Math.floor((10 + clampedIntensity * 10) * complexityScale))
                : 0,
        };
    }

    getRandomUnitVector() {
        const z = this.rand() * 2 - 1;
        const theta = this.rand() * Math.PI * 2;
        const radial = Math.sqrt(Math.max(0, 1 - z * z));
        return new THREE.Vector3(
            Math.cos(theta) * radial,
            Math.sin(theta) * radial,
            z,
        );
    }

    getCrashMeteorApproachDirection(impactNormal) {
        const randomDirection = this.getRandomUnitVector();
        const outwardBias = impactNormal?.isVector3
            ? impactNormal.clone().normalize()
            : this.getRandomUnitVector();
        const approachDirection = randomDirection
            .multiplyScalar(0.76 + this.rand() * 0.5)
            .addScaledVector(outwardBias, 0.52 + this.rand() * 0.58);

        if (approachDirection.lengthSq() < 0.0001) {
            approachDirection.copy(outwardBias);
        }

        if (Math.abs(approachDirection.z) < 0.18) {
            const zBias = 0.22 + this.rand() * 0.34;
            approachDirection.z += this.rand() < 0.5 ? -zBias : zBias;
        }

        return approachDirection.normalize();
    }

    getCrashMeteorGeometryCache() {
        if (this.crashMeteorGeometryCache) return this.crashMeteorGeometryCache;

        const coreTemplates = [];
        const fragmentTemplates = [];
        const coreIntensities = [0.42, 0.66, 0.92, 1.15, 1.4];
        const fragmentIntensities = [0.5, 0.82, 1.1];

        coreIntensities.forEach((templateIntensity) => {
            const geometry = this.createCrashMeteorCoreGeometry(1, templateIntensity);
            geometry.computeBoundingSphere();
            coreTemplates.push(geometry);
        });
        fragmentIntensities.forEach((templateIntensity) => {
            const geometry = this.createCrashMeteorCoreGeometry(1, templateIntensity);
            geometry.computeBoundingSphere();
            fragmentTemplates.push(geometry);
        });

        this.crashMeteorGeometryCache = {
            coreTemplates,
            fragmentTemplates,
        };
        return this.crashMeteorGeometryCache;
    }

    disposeCrashMeteorGeometryCache() {
        if (!this.crashMeteorGeometryCache) return;
        this.crashMeteorGeometryCache.coreTemplates?.forEach((geometry) => geometry?.dispose?.());
        this.crashMeteorGeometryCache.fragmentTemplates?.forEach((geometry) => geometry?.dispose?.());
        this.crashMeteorGeometryCache = null;
    }

    shouldAllowCinematicEvents() {
        if (!this.isActive || !this.scene) return false;
        if (typeof window !== 'undefined' && window.settings?.backgroundComboEffects === false) return false;
        if (this.warpSpeed > 0.9 || this.radialBlurIntensity > 1.2) return false;

        const budgets = this.getReactiveEventBudgets();
        return budgets.maxAuroras > 0 || budgets.maxComets > 0 || budgets.maxCrashMeteors > 0;
    }

    trySpawnReactiveAurora(intensity = 0.45) {
        if (!this.shouldAllowCinematicEvents()) return false;

        const budgets = this.getReactiveEventBudgets();
        if (budgets.maxAuroras <= 0 || this.auroraEvents.length >= budgets.maxAuroras) {
            return false;
        }

        const width = 3600 + this.rand() * 2000;
        const height = 780 + this.rand() * 420;
        const baseOpacity = 0.05 + intensity * 0.08;
        const hue = 168 + this.rand() * 130;
        const tintColor = new THREE.Color().setHSL((hue % 360) / 360, 0.78, 0.58);
        const texture = this.createDepthHazeTexture({
            hue,
            saturation: 84,
            lightness: 50,
            alpha: 0.2 + intensity * 0.16,
            vivid: true,
        });
        const geometry = new THREE.PlaneGeometry(width, height);
        const materialData = createStellarNebulaMaterial({
            isWebGPU: this.isWebGPU,
            variant: 'haze',
            nebulaTexture: texture,
            opacity: baseOpacity,
            tintColor,
            flowStrength: 0.05 + intensity * 0.02,
            detailStrength: 0.92 + intensity * 0.16,
            densityThreshold: 0.32,
            emissiveGain: 0.12 + intensity * 0.1,
            edgeSoftness: 1.46,
            phaseSeed: this.rand() * 100,
        });

        const aurora = new THREE.Mesh(geometry, materialData.material);
        aurora.userData.materialData = materialData;
        aurora.position.set(
            (this.rand() - 0.5) * 2600,
            850 + this.rand() * 500,
            -6200 - this.rand() * 2200,
        );
        aurora.rotation.x = -0.26 - this.rand() * 0.24;
        aurora.rotation.z = (this.rand() - 0.5) * 0.24;
        aurora.renderOrder = -1700 - this.auroraEvents.length;
        this.scene.add(aurora);

        this.auroraEvents.push({
            mesh: aurora,
            life: 1,
            decayRate: 0.085 + this.rand() * 0.03,
            driftX: (this.rand() - 0.5) * 18,
            bobPhase: this.rand() * Math.PI * 2,
            bobSpeed: 0.25 + this.rand() * 0.2,
            bobAmplitude: 20 + this.rand() * 24,
            baseOpacity,
            pulseGain: 0.4 + intensity * 0.65,
        });

        return true;
    }

    trySpawnReactiveComet(intensity = 0.45) {
        if (!this.shouldAllowCinematicEvents()) return false;

        const budgets = this.getReactiveEventBudgets();
        if (budgets.maxComets <= 0 || this.cometEvents.length >= budgets.maxComets) {
            return false;
        }

        const fromLeft = this.rand() < 0.5;
        const geometry = new THREE.CylinderGeometry(0, 4 + intensity * 3, 170 + intensity * 120, 8);
        const cometColor = new THREE.Color().setHSL(0.54 + this.rand() * 0.08, 0.82, 0.78);
        const materialData = createStellarShootingStarMaterial({
            isWebGPU: this.isWebGPU,
            color: cometColor,
            opacity: 0.95,
        });

        const comet = new THREE.Mesh(geometry, materialData.material);
        comet.userData.materialData = materialData;
        comet.position.set(
            fromLeft ? -3200 : 3200,
            -240 + (this.rand() - 0.5) * 940,
            -2400 - this.rand() * 1500,
        );
        comet.rotation.z = fromLeft ? -Math.PI * 0.33 : Math.PI * 0.33;
        comet.renderOrder = 1040;

        comet.userData.velocity = new THREE.Vector3(
            fromLeft ? (52 + intensity * 40 + this.rand() * 18) : -(52 + intensity * 40 + this.rand() * 18),
            -6 + this.rand() * 12,
            20 + intensity * 18,
        );
        comet.userData.life = 1;
        comet.userData.decay = 0.52 + this.rand() * 0.16;

        this.scene.add(comet);
        this.cometEvents.push(comet);
        return true;
    }

    disposeComputeSystems() {
        if (this.ambientParticleCompute) {
            this.ambientParticleCompute.dispose();
            this.ambientParticleCompute = null;
        }
        if (this.dustRingCompute) {
            this.dustRingCompute.dispose();
            this.dustRingCompute = null;
        }
        if (this.nebulaBurstCompute) {
            this.nebulaBurstCompute.dispose();
            this.nebulaBurstCompute = null;
        }
        if (this.nebulaBurstPool) {
            this.scene?.remove(this.nebulaBurstPool);
            this.nebulaBurstPool.geometry?.dispose?.();
            this.nebulaBurstPool.material?.dispose?.();
            this.nebulaBurstPool = null;
        }
        this.nebulaBurstMaterialData = null;
    }

    setupNebulaBurstComputePool() {
        if (!this.shouldUseCompute() || !this.scene) return false;
        if (this.nebulaBurstCompute?.computeNode && this.nebulaBurstPool) return true;

        try {
            const capacity = this.getNebulaBurstCapacity();
            const burstCompute = new StellarNebulaBurstCompute(capacity, () => this.rand());
            burstCompute.createComputeNode();

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));

            const materialData = createStellarNebulaBurstMaterial({
                isWebGPU: this.isWebGPU,
                burstCompute,
            });

            const pool = new THREE.Points(geometry, materialData.material);
            pool.userData.materialData = materialData;
            pool.renderOrder = 1200;

            this.nebulaBurstCompute = burstCompute;
            this.nebulaBurstMaterialData = materialData;
            this.nebulaBurstPool = pool;
            this.scene.add(pool);

            console.log(`[StellarDrift] Nebula burst compute pool ready (capacity: ${capacity})`);
            return true;
        } catch (error) {
            console.warn('[StellarDrift] Nebula burst compute init failed; using CPU bursts.', error);
            this.nebulaBurstCompute?.dispose?.();
            this.nebulaBurstCompute = null;
            this.nebulaBurstMaterialData = null;
            this.nebulaBurstPool = null;
            return false;
        }
    }

    updateComputeSystems(deltaSeconds) {
        if (!this.shouldUseCompute() || !this.renderer?.compute) return;

        try {
            if (this.ambientParticleCompute?.computeNode) {
                this.ambientParticleCompute.update(deltaSeconds, this.time, {
                    driftScale: 1.0 + this.warpSpeed * 0.35,
                });
                this.renderer.compute(this.ambientParticleCompute.computeNode);
            }

            if (this.dustRingCompute?.computeNode) {
                this.dustRingCompute.update(deltaSeconds, {
                    speedScale: 1.0 + this.dustRingPulse * 3.0 + this.warpSpeed * 0.4,
                });
                this.renderer.compute(this.dustRingCompute.computeNode);
            }

            if (this.nebulaBurstCompute?.computeNode) {
                const drag = THREE.MathUtils.clamp(
                    0.9962 + this.nebulaPulse * 0.0007 - this.warpSpeed * 0.0014,
                    0.992,
                    0.9972,
                );
                this.nebulaBurstCompute.update(deltaSeconds, {
                    drag,
                    turbulence: 0.32 + this.nebulaPulse * 0.62 + this.nebulaBoostIntensity * 0.18,
                });
                this.renderer.compute(this.nebulaBurstCompute.computeNode);
            }
        } catch (error) {
            console.warn('[StellarDrift] Compute update failed; disabling compute path.', error);
            this.disposeComputeSystems();
            this.capabilities.compute = false;
            this.flags.useCompute = false;
        }
    }

    probeCapabilities() {
        const maxColorAttachments = this.renderer?.capabilities?.maxColorAttachments ?? 1;
        const supportsPost = this.isWebGPU
            ? typeof THREE_WEBGPU.PostProcessing === 'function'
            : true;
        const supportsMRT = this.isWebGPU && maxColorAttachments > 1;
        const supportsCompute = this.isWebGPU && typeof this.renderer?.compute === 'function';

        // Hardware class detection for budget tuning
        const hardwareClass = this.detectHardwareClass();

        this.capabilities = {
            webgpu: this.isWebGPU,
            webgl: this.isWebGL,
            maxColorAttachments,
            supportsPost,
            supportsMRT,
            supportsCompute,
            post: !this.flags.noPost && this.qualityPreset.enablePostProcessing && supportsPost,
            mrt: !this.flags.noMRT && supportsMRT,
            compute: !this.flags.noCompute && supportsCompute,
            hardwareClass,
        };

        this.flags.usePost = this.capabilities.post;
        this.flags.useMRT = this.capabilities.mrt;
        this.flags.useCompute = this.capabilities.compute;

        console.log('[StellarDrift] Capabilities detected:', {
            backend: this.getBackendLabel(),
            hardwareClass: hardwareClass.tier,
            gpu: hardwareClass.gpu,
            post: this.capabilities.post,
            mrt: this.capabilities.mrt,
            compute: this.capabilities.compute,
        });
    }

    detectHardwareClass() {
        const info = this.renderer?.info || {};
        const gl = this.renderer?.getContext?.();
        let gpu = 'unknown';
        let vendor = 'unknown';
        let tier = 'medium'; // Default tier

        // Try WebGL debug extension
        if (gl) {
            const debugInfo = gl.getExtension?.('WEBGL_debug_renderer_info');
            if (debugInfo) {
                gpu = gl.getParameter?.(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
                vendor = gl.getParameter?.(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown';
            }
        }

        // Try WebGPU adapter info
        if (this.isWebGPU && this.renderer?.backend?.adapter) {
            const adapter = this.renderer.backend.adapter;
            if (adapter.info) {
                gpu = adapter.info.device || adapter.info.description || gpu;
                vendor = adapter.info.vendor || vendor;
            }
        }

        const gpuLower = gpu.toLowerCase();
        const vendorLower = vendor.toLowerCase();

        // Tier classification based on known GPU patterns
        const highEndPatterns = [
            'rtx 30', 'rtx 40', 'rtx 50',
            'rx 6', 'rx 7',
            'm1 pro', 'm1 max', 'm1 ultra', 'm2', 'm3', 'm4',
            'a770', 'arc a7',
            'geforce 30', 'geforce 40',
        ];
        const midRangePatterns = [
            'rtx 20', 'gtx 16', 'gtx 10',
            'rx 5', 'rx 580', 'rx 590',
            'm1',
            'intel iris', 'iris xe',
            'arc a5', 'arc a3',
        ];
        const lowEndPatterns = [
            'intel hd', 'intel uhd',
            'geforce mx', 'gt 7', 'gt 10',
            'radeon vega', 'radeon graphics',
            'mali', 'adreno', 'powervr',
        ];

        const matchesAny = (patterns) => patterns.some((p) => gpuLower.includes(p) || vendorLower.includes(p));

        if (matchesAny(highEndPatterns)) {
            tier = 'high';
        } else if (matchesAny(lowEndPatterns)) {
            tier = 'low';
        } else if (matchesAny(midRangePatterns)) {
            tier = 'medium';
        }

        return { gpu, vendor, tier };
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (this.isWebGPU && this.capabilities.post) {
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1.0;
            return;
        }

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;

        return Boolean(
            material.isMeshBasicNodeMaterial
            || material.isMeshStandardNodeMaterial
            || material.isMeshPhysicalNodeMaterial
            || material.isMeshPhongNodeMaterial
            || material.isPointsNodeMaterial
            || material.isSpriteNodeMaterial
            || material.isLineBasicNodeMaterial
            || material.type?.includes?.('NodeMaterial'),
        );
    }

    auditMrtMaterials() {
        if (!this.isWebGPU || !this.capabilities.mrt || !this.scene) return;

        const nonNode = [];
        let totalMaterials = 0;
        let nodeMaterials = 0;
        let missingEmissiveNode = 0;
        let missingIntentTag = 0;
        let nonBloomWithoutZeroEnforcement = 0;
        let zeroEmissiveTagged = 0;
        let bloomEmissiveTagged = 0;

        this.scene.traverse((object) => {
            if (!object.material) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];

            materials.forEach((material) => {
                totalMaterials += 1;
                if (!this.isNodeMaterial(material)) {
                    nonNode.push({
                        name: object.name || object.type || 'object',
                        materialType: material?.type || 'unknown',
                    });
                    return;
                }

                nodeMaterials += 1;
                if (material.emissiveNode === undefined || material.emissiveNode === null) {
                    missingEmissiveNode += 1;
                }
                if (typeof material.userData?.emitsBloom !== 'boolean') {
                    missingIntentTag += 1;
                } else if (material.userData.emitsBloom) {
                    bloomEmissiveTagged += 1;
                } else {
                    zeroEmissiveTagged += 1;
                    if (material.userData?.zeroEmissiveEnforced !== true) {
                        nonBloomWithoutZeroEnforcement += 1;
                    }
                }
            });
        });

        if (this.flags.mrtAudit) {
            console.log('[StellarDrift] MRT material audit', {
                totalMaterials,
                nodeMaterials,
                nonNodeCount: nonNode.length,
                missingEmissiveNode,
                missingIntentTag,
                nonBloomWithoutZeroEnforcement,
                bloomEmissiveTagged,
                zeroEmissiveTagged,
            });
        }

        const hasMrtReadinessIssues = nonNode.length > 0
            || missingEmissiveNode > 0
            || missingIntentTag > 0
            || nonBloomWithoutZeroEnforcement > 0;

        if (hasMrtReadinessIssues) {
            this.capabilities.mrt = false;
            this.flags.useMRT = false;
            console.warn('[StellarDrift] MRT disabled due to material readiness issues.', {
                nonNode: nonNode.slice(0, 10),
                missingEmissiveNode,
                missingIntentTag,
                nonBloomWithoutZeroEnforcement,
            });
        }
    }

    scheduleThemeTimeout(callback, delayMs) {
        if (typeof window === 'undefined') return null;
        const timeoutId = window.setTimeout(() => {
            this.themeTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.themeTimeouts.add(timeoutId);
        return timeoutId;
    }

    clearThemeTimeouts() {
        this.themeTimeouts.forEach((id) => clearTimeout(id));
        this.themeTimeouts.clear();
        this.baselineTimeouts.clear();
    }

    cancelAnimationLoop() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    clearEventSubscriptions() {
        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];
    }

    removeResizeListener() {
        if (this.resizeHandler && typeof window !== 'undefined') {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    removeRendererResilienceListeners() {
        if (!this.renderer?.domElement) return;

        if (this.webglContextLostHandler) {
            this.renderer.domElement.removeEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.webglContextLostHandler = null;
        }
        if (this.webglContextRestoredHandler) {
            this.renderer.domElement.removeEventListener('webglcontextrestored', this.webglContextRestoredHandler, false);
            this.webglContextRestoredHandler = null;
        }
    }

    setupRendererResilience() {
        if (!this.renderer?.domElement) return;

        if (this.isWebGL) {
            this.webglContextLostHandler = (event) => {
                event.preventDefault();
                console.warn('[StellarDrift] WebGL context lost');
            };
            this.webglContextRestoredHandler = () => {
                console.warn('[StellarDrift] WebGL context restored');
                this.resize(window.innerWidth, window.innerHeight);
            };
            this.renderer.domElement.addEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.renderer.domElement.addEventListener('webglcontextrestored', this.webglContextRestoredHandler, false);
            return;
        }

        this.renderer.onDeviceLost = (info) => {
            this.handleDeviceLoss(info);
        };
        const deviceLostPromise = this.renderer?.backend?.device?.lost;
        if (deviceLostPromise && typeof deviceLostPromise.then === 'function') {
            deviceLostPromise.then((info) => {
                this.handleDeviceLoss(info);
            }).catch(() => {
                // Device-loss promise may reject during teardown; ignore.
            });
        }
    }

    disposePostProcessingStack() {
        if (this.postProcessing?.dispose) {
            try {
                this.postProcessing.dispose();
            } catch (error) {
                console.warn('[StellarDrift] postProcessing dispose failed:', error);
            }
        }
        this.postProcessing = null;

        if (this.composer?.dispose) {
            try {
                this.composer.dispose();
            } catch (error) {
                console.warn('[StellarDrift] composer dispose failed:', error);
            }
        }
        this.composer = null;
        this.bloomPass = null;
        this.vignettePass = null;
        this.chromaticPass = null;
        this.radialSpeedPass = null;
        this.colorGradePass = null;
    }

    disposeMaterialTextures(material, disposedTextures) {
        if (!material) return;

        const textureKeys = [
            'map',
            'alphaMap',
            'aoMap',
            'bumpMap',
            'displacementMap',
            'emissiveMap',
            'envMap',
            'lightMap',
            'metalnessMap',
            'normalMap',
            'roughnessMap',
            'specularMap',
            'gradientMap',
            'clearcoatMap',
            'clearcoatNormalMap',
            'clearcoatRoughnessMap',
            'sheenColorMap',
            'sheenRoughnessMap',
            'transmissionMap',
            'thicknessMap',
            'iridescenceMap',
            'iridescenceThicknessMap',
            'anisotropyMap',
            'matcap',
        ];

        textureKeys.forEach((key) => {
            const texture = material[key];
            if (texture?.isTexture && !disposedTextures.has(texture.uuid)) {
                disposedTextures.add(texture.uuid);
                texture.dispose();
            }
        });
    }

    disposeSceneResources() {
        if (!this.scene) return;

        const disposedTextures = new Set();
        const backgroundTexture = this.scene.background;
        if (backgroundTexture?.isTexture && !disposedTextures.has(backgroundTexture.uuid)) {
            disposedTextures.add(backgroundTexture.uuid);
            backgroundTexture.dispose();
        }
        const environmentTexture = this.scene.environment;
        if (environmentTexture?.isTexture && !disposedTextures.has(environmentTexture.uuid)) {
            disposedTextures.add(environmentTexture.uuid);
            environmentTexture.dispose();
        }

        this.scene.traverse((object) => {
            if (object.geometry?.dispose) {
                object.geometry.dispose();
            }
            if (!object.material) return;

            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                this.disposeMaterialTextures(material, disposedTextures);
                material?.dispose?.();
            });
        });
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.renderer.onDeviceLost = null;
        this.removeRendererResilienceListeners();
        const domElement = this.renderer.domElement;
        try {
            this.renderer.dispose();
        } catch (error) {
            console.warn('[StellarDrift] renderer dispose failed:', error);
        }

        if (removeCanvas && domElement?.parentNode) {
            domElement.parentNode.removeChild(domElement);
        }
        this.renderer = null;
    }

    resetRuntimeReferences() {
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.bloomPass = null;
        this.vignettePass = null;
        this.chromaticPass = null;
        this.radialSpeedPass = null;
        this.planet = null;
        this.smallGlow = null;
        this.bigGlow = null;
        this.backgroundPlanes = [];
        this.meteors = [];
        this.meteorInstancedMesh = null;
        this.meteorMatrixDummy = null;
        this.nebulaClouds = [];
        this.nebulaMeshes = [];
        this.nebulaStacks = [];
        this.nebulaPalette = null;
        this.secondaryBodies = [];
        this.depthHazeLayers = [];
        this.ambientParticles = null;
        this.dustRing = null;
        this.ambientParticleCompute = null;
        this.dustRingCompute = null;
        this.nebulaBurstCompute = null;
        this.nebulaBurstPool = null;
        this.starfield = null;
        this.heroRingSystem = null;
        this.heroRingMaterialData = [];
        this.starfieldMaterialData = null;
        this.planetMaterialData = null;
        this.dustRingMaterialData = null;
        this.ambientParticlesMaterialData = null;
        this.nebulaBurstMaterialData = null;
        this.meteorLight = null;
        this.meteorLightTarget = null;
        this.ambientLight = null;
        this.keyLight = null;
        this.crashMeteorGeometryCache = null;
        this.nebulaBursts = [];
        this.shockwaveRings = [];
        this.shootingStars = [];
        this.cometEvents = [];
        this.crashMeteors = [];
        this.impactFlashes = [];
        this.auroraEvents = [];
        this.heroRingGlitterIntensity = 0;
        this.planetLightningIntensity = 0;
        this.auroraPulse = 0;
        this.cameraSway.set(0, 0, 0);
        this.cameraShake.set(0, 0, 0);
        this.cameraLookTarget.set(0, 0, 0);
        this.cameraCurrentLookTarget.set(0, 0, 0);
        this.cameraLookOffset.set(0, 0, 0);
        this.cameraRollOffset = 0;
        this.cameraDriftSeed = this.rand() * Math.PI * 2;
        this.animationFrameId = null;
        this.time = 0;
        this.fixedElapsed = 0;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            maxColorAttachments: 1,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
            post: false,
            mrt: false,
            compute: false,
        };
        this._roundParticleTexture = null;
        this._starTexture = null;
        this._glowTexture = null;
        this.performanceBudget = { ...QUALITY_BUDGETS.High };
        this.activeQualityLevel = 'High';
        this.resetAdaptiveScalerState();
        this.resetReactiveEnvelope();
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposeComputeSystems();
        this.disposeCrashMeteorGeometryCache();
        this.disposePostProcessingStack();
        this.disposeSceneResources();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.renderFallbackInProgress || !this.isActive) return;
        if (this.shouldForceWebGL()) return;

        this.renderFallbackInProgress = true;
        console.warn(`[StellarDrift] Switching to WebGL fallback (${reason})`, error || '');

        try {
            this.cancelAnimationLoop();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.clearThemeTimeouts();
            this.clearBaselinePlaybackTimers();
            this.removeBaselineHelpers();
            this.disposeRuntimeResources({ removeCanvas: true });

            this.flags.forceWebGL = true;
            this.flags.noMRT = true;
            this.flags.noCompute = true;
            await this.createScene();
            console.log('[StellarDrift] WebGL fallback active after runtime recovery.');
        } catch (fallbackError) {
            console.error('[StellarDrift] Runtime fallback failed:', fallbackError);
            this.isActive = false;
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        this.deviceLossRecoveries += 1;
        console.error('[StellarDrift] WebGPU device lost:', info);

        try {
            await this.requestWebGLFallback('device-loss', info);
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    resolveQualityBudget(quality) {
        const normalized = normalizeQuality(quality);
        const budget = {
            ...(QUALITY_BUDGETS[normalized] || QUALITY_BUDGETS.High),
        };

        const devicePixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        if (devicePixelRatio > 1.6) {
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 0.94);
            budget.maxResolutionScale = Math.min(budget.maxResolutionScale, 0.98);
        }

        if (this.isWebGL) {
            budget.maxPostCostMs *= 0.82;
            budget.targetFrameMs += 0.9;
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 0.9);
            budget.maxResolutionScale = Math.min(budget.maxResolutionScale, 0.94);
            budget.minEffectScale = Math.min(budget.minEffectScale, 0.52);
        }

        if (!this.capabilities.compute || this.flags.noCompute) {
            budget.minEffectScale = Math.min(budget.minEffectScale, 0.5);
        }

        if (this.flags.noDrs) {
            budget.adaptiveEnabled = false;
            budget.baseResolutionScale = Math.min(budget.baseResolutionScale, 1.0);
        }

        return budget;
    }

    resetAdaptiveScalerState() {
        const targetFrameMs = this.performanceBudget?.targetFrameMs ?? 16.7;
        const baseResolutionScale = this.performanceBudget?.baseResolutionScale ?? 1;
        this.adaptiveScalerState = {
            frameTimeEmaMs: targetFrameMs,
            drawCallEma: 0,
            postCostEmaMs: 0,
            qualityScale: 1,
            resolutionScale: baseResolutionScale,
            baseResolutionScale,
            effectScale: 1,
        };
        this.lastRenderPath = 'none';
        this.lastPostCostMs = 0;
        this.qualitySyncAccumulator = 0;
    }

    updateReactiveCapsByQuality() {
        const detail = this.qualityPreset?.planetDetail ?? 24;
        const detailScale = THREE.MathUtils.clamp(detail / 32, 0.55, 1.3);
        this.reactiveCaps = {
            twinkle: 1.2 * detailScale,
            dust: 0.34 * detailScale,
            bloom: 0.7 * detailScale,
            nebula: 0.66 * detailScale,
            pulse: 1.05 * detailScale,
            glow: 0.56 * detailScale,
            ringGlitter: 0.8 * detailScale,
            lightning: this.lightningFlashCap,
            aurora: 0.68 * detailScale,
            comet: 0.68 * detailScale,
            meteor: 5.0,
        };
    }

    getRendererPixelRatio(maxRatio = 1.5) {
        const baseRatio = this.getEffectivePixelRatio(maxRatio);
        const resolutionScale = this.adaptiveScalerState?.resolutionScale ?? 1;
        return THREE.MathUtils.clamp(baseRatio * resolutionScale, 0.35, maxRatio);
    }

    applyAdaptiveScalerState() {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRendererPixelRatio(1.5);

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height);

        const starfieldUniforms = this.starfieldMaterialData?.uniforms || this.starfield?.material?.uniforms;
        if (starfieldUniforms?.uPixelRatio) {
            starfieldUniforms.uPixelRatio.value = pixelRatio;
        }

        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
        if (this.isWebGPU && this.postProcessing) {
            this.postProcessing.update({
                bloomDownsample: THREE.MathUtils.clamp(0.6 + effectScale * 0.22, 0.58, 0.86),
            });
            this.postProcessing.setSize(width, height);
        } else if (this.isWebGL && this.composer) {
            this.composer.setSize(width, height);
            if (this.bloomPass?.resolution) {
                this.bloomPass.resolution.set(width, height);
            }
        }
    }

    updateAdaptiveScaler(frameMs) {
        if (!Number.isFinite(frameMs) || frameMs <= 0 || !this.renderer) return;

        const state = this.adaptiveScalerState;
        const budget = this.performanceBudget;
        if (!state || !budget) return;

        state.frameTimeEmaMs = state.frameTimeEmaMs * 0.92 + frameMs * 0.08;

        const drawCalls = this.renderer?.info?.render?.calls;
        if (Number.isFinite(drawCalls)) {
            state.drawCallEma = state.drawCallEma * 0.9 + drawCalls * 0.1;
        }
        state.postCostEmaMs = state.postCostEmaMs * 0.88 + this.lastPostCostMs * 0.12;

        if (!budget.adaptiveEnabled || this.flags.noDrs) return;

        let pressure = 0;
        const frameOverrun = (state.frameTimeEmaMs - budget.targetFrameMs) / Math.max(1, budget.targetFrameMs);
        if (frameOverrun > 0) {
            pressure += frameOverrun;
        } else {
            pressure += frameOverrun * 0.4;
        }
        if (budget.maxDrawCalls && state.drawCallEma > budget.maxDrawCalls) {
            pressure += ((state.drawCallEma - budget.maxDrawCalls) / budget.maxDrawCalls) * 0.75;
        }
        if (budget.maxPostCostMs && state.postCostEmaMs > budget.maxPostCostMs) {
            pressure += ((state.postCostEmaMs - budget.maxPostCostMs) / budget.maxPostCostMs) * 0.6;
        }

        if (pressure > 0) {
            state.qualityScale = THREE.MathUtils.clamp(
                state.qualityScale - budget.adaptiveDownRate * Math.min(1.8, pressure),
                budget.adaptiveMinScale,
                budget.adaptiveMaxScale,
            );
        } else {
            state.qualityScale = THREE.MathUtils.clamp(
                state.qualityScale + budget.adaptiveUpRate,
                budget.adaptiveMinScale,
                budget.adaptiveMaxScale,
            );
        }

        const targetResolutionScale = THREE.MathUtils.clamp(
            state.baseResolutionScale * state.qualityScale,
            budget.minResolutionScale,
            budget.maxResolutionScale,
        );
        const targetEffectScale = THREE.MathUtils.clamp(
            0.56 + state.qualityScale * 0.52,
            budget.minEffectScale,
            1.0,
        );

        const previousResolutionScale = state.resolutionScale;
        const previousEffectScale = state.effectScale;
        state.resolutionScale = THREE.MathUtils.lerp(state.resolutionScale, targetResolutionScale, 0.16);
        state.effectScale = THREE.MathUtils.lerp(state.effectScale, targetEffectScale, 0.14);

        if (Math.abs(previousResolutionScale - state.resolutionScale) > 0.01
            || Math.abs(previousEffectScale - state.effectScale) > 0.015) {
            this.applyAdaptiveScalerState();
        }
    }

    getRuntimeBudgetSnapshot() {
        return {
            quality: this.activeQualityLevel,
            budget: {
                targetFrameMs: this.performanceBudget?.targetFrameMs ?? null,
                maxDrawCalls: this.performanceBudget?.maxDrawCalls ?? null,
                maxPostCostMs: this.performanceBudget?.maxPostCostMs ?? null,
            },
            scaler: {
                frameTimeEmaMs: Number((this.adaptiveScalerState?.frameTimeEmaMs ?? 0).toFixed(3)),
                drawCallEma: Number((this.adaptiveScalerState?.drawCallEma ?? 0).toFixed(2)),
                postCostEmaMs: Number((this.adaptiveScalerState?.postCostEmaMs ?? 0).toFixed(3)),
                qualityScale: Number((this.adaptiveScalerState?.qualityScale ?? 1).toFixed(3)),
                resolutionScale: Number((this.adaptiveScalerState?.resolutionScale ?? 1).toFixed(3)),
                effectScale: Number((this.adaptiveScalerState?.effectScale ?? 1).toFixed(3)),
            },
            renderPath: this.lastRenderPath,
            lastPostCostMs: Number((this.lastPostCostMs ?? 0).toFixed(3)),
        };
    }

    applyQualityPreset(quality) {
        const normalized = normalizeQuality(quality);
        this.activeQualityLevel = normalized;
        this.qualityPreset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
        this.performanceBudget = this.resolveQualityBudget(normalized);
        this.resetAdaptiveScalerState();
        this.updateReactiveCapsByQuality();
        console.log('[StellarDrift] Applied quality profile', this.getRuntimeBudgetSnapshot());
    }

    applyRuntimeQualityProfile(quality) {
        const normalized = normalizeQuality(quality);
        if (normalized === this.activeQualityLevel) return false;

        this.applyQualityPreset(normalized);
        this.probeCapabilities();
        this.configureRendererColorPipeline();
        this.setupPostProcessing();

        if (typeof window !== 'undefined') {
            this.resize(window.innerWidth, window.innerHeight);
        }

        console.log('[StellarDrift] Runtime quality switched', this.getRuntimeBudgetSnapshot());
        return true;
    }

    async precompileSceneWithTimeout() {
        if (!this.renderer?.compileAsync || !this.scene || !this.camera) return false;

        const timeoutMs = this.performanceBudget?.compileTimeoutMs ?? 3200;
        let timeoutId = null;

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(new Error(`compileAsync timeout after ${timeoutMs}ms`));
                    }, timeoutMs);
                }),
            ]);
            console.log('[StellarDrift] compileAsync warmup complete', {
                timeoutMs,
                backend: this.getBackendLabel(),
            });
            return true;
        } catch (error) {
            console.warn('[StellarDrift] compileAsync warmup skipped/fallback:', error);
            return false;
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }

    async runQualitySwitchStress(options = {}) {
        if (!this.isActive) return null;

        const sequence = Array.isArray(options.sequence) && options.sequence.length
            ? options.sequence
            : ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme', 'High'];
        const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 1300;
        const snapshots = [];

        for (const quality of sequence) {
            this.applyRuntimeQualityProfile(quality);
            await this.waitForBaseline(settleMs);
            snapshots.push(this.getRuntimeBudgetSnapshot());
        }

        console.log('[StellarDrift] Runtime quality stress-switch complete', {
            sequence,
            settleMs,
            finalQuality: this.activeQualityLevel,
        });
        return {
            sequence,
            settleMs,
            finalQuality: this.activeQualityLevel,
            snapshots,
        };
    }

    /**
     * Phase 8: Validation Matrix Runner
     * Tests all capability/flag permutations to validate fallback paths.
     * Run in console: stellarBaseline.runValidation()
     */
    async runValidationMatrix(options = {}) {
        const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 2000;
        const runFrames = Number.isFinite(options.frames) ? options.frames : 120;
        const results = [];

        // Define validation permutations
        const permutations = [
            { name: 'WebGPU Full', flags: {} },
            { name: 'WebGPU No Compute', flags: { noCompute: true } },
            { name: 'WebGPU No MRT', flags: { noMRT: true } },
            { name: 'WebGPU No Post', flags: { noPost: true } },
            { name: 'WebGPU No DRS', flags: { noDrs: true } },
            { name: 'WebGPU Minimal (no MRT/compute/post)', flags: { noMRT: true, noCompute: true, noPost: true } },
        ];

        console.log('[StellarDrift] Starting validation matrix...', { permutations: permutations.length, settleMs, runFrames });

        for (const perm of permutations) {
            try {
                // Apply flag overrides
                Object.keys(perm.flags).forEach((key) => {
                    this.flags[key] = perm.flags[key];
                });

                // Re-probe capabilities with new flags
                this.probeCapabilities();

                // Wait for frames to run
                await this.waitForBaseline(settleMs);

                // Collect metrics
                const snapshot = this.getRuntimeBudgetSnapshot();
                const memEstimate = this.renderer?.info?.memory?.geometries ?? 0;

                results.push({
                    name: perm.name,
                    flags: perm.flags,
                    success: true,
                    renderPath: snapshot.renderPath,
                    capabilities: { ...this.capabilities },
                    metrics: {
                        avgFrameMs: snapshot.scaler.frameTimeEmaMs,
                        drawCalls: snapshot.scaler.drawCallEma,
                        postCostMs: snapshot.scaler.postCostMs,
                        memoryGeometries: memEstimate,
                    },
                });

                console.log(`[StellarDrift] Validation "${perm.name}": PASS`, snapshot);
            } catch (error) {
                results.push({
                    name: perm.name,
                    flags: perm.flags,
                    success: false,
                    error: error.message || String(error),
                });
                console.error(`[StellarDrift] Validation "${perm.name}": FAIL`, error);
            }
        }

        // Reset flags to defaults
        this.refreshRuntimeFlags();
        this.probeCapabilities();

        const summary = {
            total: results.length,
            passed: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };

        console.log('[StellarDrift] Validation matrix complete:', summary);
        return summary;
    }

    /**
     * Phase 8: Theme switch soak test
     * Cycles between theme states to detect resource leaks.
     */
    async runThemeSwitchSoak(options = {}) {
        const cycles = Number.isFinite(options.cycles) ? options.cycles : 10;
        const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 500;
        const results = [];

        console.log(`[StellarDrift] Starting theme-switch soak test: ${cycles} cycles`);

        for (let i = 0; i < cycles; i++) {
            try {
                // Simulate stop
                this.stop();
                await new Promise((r) => setTimeout(r, delayMs));

                // Simulate restart (re-init)
                await this.createScene();
                await new Promise((r) => setTimeout(r, delayMs));

                const memInfo = {
                    geometries: this.renderer?.info?.memory?.geometries ?? 0,
                    textures: this.renderer?.info?.memory?.textures ?? 0,
                };

                results.push({ cycle: i + 1, success: true, memory: memInfo });
            } catch (error) {
                results.push({ cycle: i + 1, success: false, error: error.message });
            }
        }

        const summary = {
            cycles,
            passed: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            memoryTrend: results.filter((r) => r.memory).map((r) => r.memory),
            results,
        };

        console.log('[StellarDrift] Theme-switch soak complete:', summary);
        return summary;
    }

    async createScene() {
        console.log('[StellarDrift] Creating Andromeda-style scene...');

        this.refreshRuntimeFlags();
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearThemeTimeouts();
        this.resetBaseline();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('stellar-drift-theme');
        if (!container) {
            console.error('[StellarDrift] Container not found');
            return;
        }

        const rendererReady = await this.initRenderer(container);
        if (!rendererReady || !this.renderer || !this.scene || !this.camera) {
            console.error('[StellarDrift] Renderer initialization failed.');
            return;
        }

        this.probeCapabilities();
        this.performanceBudget = this.resolveQualityBudget(this.activeQualityLevel);
        this.resetAdaptiveScalerState();
        this.configureRendererColorPipeline();
        this.setupRendererResilience();

        console.log('[StellarDrift] Runtime capabilities', {
            backend: this.getBackendLabel(),
            post: this.capabilities.post,
            mrt: this.capabilities.mrt,
            compute: this.capabilities.compute,
            maxColorAttachments: this.capabilities.maxColorAttachments,
            simulationBudget: {
                dustRingParticleCount: this.qualityPreset.dustRingParticleCount,
                ambientParticleCount: this.qualityPreset.ambientParticleCount,
                nebulaBurstCapacity: this.getNebulaBurstCapacity(),
                maxBurstParticlesPerNebula: this.getBurstParticlesPerNebulaBudget(),
            },
            runtimeBudget: this.getRuntimeBudgetSnapshot(),
        });

        this.resetReactiveEnvelope();

        this.createStarfield(); // 3D point stars
        // this.createNebulaClouds();   // REMOVED: Replaced by volumetric backdrop
        // this.createOrbitingParticles(); // REMOVED: User request
        this.createNebulaBackdrop(); // Blood Moon-style hero nebula masses
        this.createPlanet();
        this.createSecondaryBodies();
        this.createDustRing(); // Dust ring around planet
        this.createAmbientParticles(); // Floating ambient sparkles
        this.createMeteorField();
        this.getCrashMeteorGeometryCache(); // Prebuild crash-meteor geometry templates to avoid spawn hitching.
        this.setupNebulaBurstComputePool();
        this.auditMrtMaterials();
        this.setupPostProcessing();
        this.resize(window.innerWidth, window.innerHeight);
        await this.precompileSceneWithTimeout();
        this.setupEventListeners();
        this.clock.start();
        this.startAnimation();

        if (this.flags.baseline) {
            this.installBaselineHelpers();
            console.log('[StellarBaseline] Baseline capture enabled', {
                backend: this.getBackendLabel(),
                seed: this.flags.seed,
                fixedDeltaMs: this.flags.fixedDeltaMs,
                capabilities: { ...this.capabilities },
            });
        }

        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, {
                loops: this.flags.playbackLoops,
            });
        }

        console.log('[StellarDrift] Scene created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera (Matching Andromeda exactly)
    // ─────────────────────────────────────────────────────────────────────────

    async initRenderer(container) {
        if (!container || typeof window === 'undefined') return false;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const preserveDrawingBuffer = this.flags.baseline === true;
        let renderer = null;
        let webgpuRenderer = null;

        if (!this.shouldForceWebGL()) {
            try {
                webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    preserveDrawingBuffer,
                    forceWebGL: false,
                });
                await webgpuRenderer.init();
                if (webgpuRenderer.backend?.isWebGPUBackend === true) {
                    renderer = webgpuRenderer;
                } else {
                    webgpuRenderer.dispose();
                    webgpuRenderer = null;
                }
            } catch (error) {
                console.warn('[StellarDrift] WebGPU init failed, falling back to WebGL2:', error);
                webgpuRenderer?.dispose();
                webgpuRenderer = null;
            }
        }

        if (!renderer) {
            try {
                renderer = new THREE.WebGLRenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    preserveDrawingBuffer,
                });
            } catch (error) {
                console.error('[StellarDrift] WebGL renderer initialization failed:', error);
                return false;
            }
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = renderer.isWebGLRenderer === true
            || renderer.backend?.isWebGLBackend === true
            || !this.isWebGPU;

        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;

        const staleCanvas = container.querySelector('#stellar-drift-renderer');
        if (staleCanvas && staleCanvas.parentNode === container) {
            container.removeChild(staleCanvas);
        }
        this.renderer.domElement.id = 'stellar-drift-renderer';
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // ANDROMEDA CAMERA: z=1450, y=100, looking at origin
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000000);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(0, 0, 0);
        this.cameraSway.set(0, 0, 0);
        this.cameraShake.set(0, 0, 0);
        this.cameraLookOffset.set(0, 0, 0);
        this.cameraLookTarget.set(0, 0, 0);
        this.cameraCurrentLookTarget.set(0, 0, 0);
        this.cameraRollOffset = 0;
        this.cameraDriftSeed = this.rand() * Math.PI * 2;

        // Spotlight for meteors (reduced intensity)
        this.meteorLight = new THREE.SpotLight(0xffffff, 2, 3000);
        this.meteorLightTarget = new THREE.Object3D();
        this.meteorLight.position.set(0, 300, 200);
        this.meteorLightTarget.position.set(0, 0, 0);
        this.meteorLight.target = this.meteorLightTarget;
        this.scene.add(this.meteorLight);
        this.scene.add(this.meteorLightTarget);

        // Ambient light
        this.ambientLight = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(this.ambientLight);

        // Directional light
        this.keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
        this.keyLight.position.set(0, 100, 500);
        this.scene.add(this.keyLight);

        console.log('[StellarDrift] Camera at z=1450, y=100 with improved lighting');
        console.log(`[StellarDrift] Renderer initialized (${this.getBackendLabel()})`);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Thousands of 3D point stars
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkleData = new Float32Array(starCount * 2);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xfff8f0),
            new THREE.Color(0xf0f0ff),
            new THREE.Color(0xfff0f0),
            new THREE.Color(0xc8e0ff),
            new THREE.Color(0xfffff0),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const theta = this.rand() * Math.PI * 2;
            const phi = Math.acos(2 * this.rand() - 1);
            const radius = 3000 + this.rand() * 3000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = (radius * Math.cos(phi)) - 6000;

            const color = starColors[Math.floor(this.rand() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            // Larger, more visible stars
            sizes[i] = 35 + this.rand() * 50;
            // Gentle twinkle - cycles every 8-20 seconds
            twinkleData[i2] = this.rand() * Math.PI * 2;
            twinkleData[i2 + 1] = 1.5 + this.rand() * 2.5; // Balanced speed
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));

        const materialData = createStellarStarfieldMaterial({
            isWebGPU: this.isWebGPU,
            pixelRatio: this.renderer.getPixelRatio(),
            starTexture: this.getStarTexture(),
        });
        this.starfieldMaterialData = materialData;

        this.starfield = new THREE.Points(geometry, materialData.material);
        this.starfield.renderOrder = -3200;
        this.scene.add(this.starfield);
        console.log('[StellarDrift] Starfield created with', starCount, this.isWebGPU ? 'TSL stars' : 'shader stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Colorful space clouds
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const cloudCount = 30; // More clouds for richer atmosphere

        for (let i = 0; i < cloudCount; i++) {
            const size = 2000 + this.rand() * 2500; // Larger clouds

            // Create soft radial gradient texture
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // VIBRANT Galaxy colors
            const colorType = this.rand();
            let hue; let sat; let
                light;
            if (colorType < 0.3) { // Electric Teal/Cyan
                hue = 180 + this.rand() * 30;
                sat = 90;
                light = 45;
            } else if (colorType < 0.6) { // Hot Pink/Magenta
                hue = 320 + this.rand() * 40;
                sat = 95;
                light = 50;
            } else if (colorType < 0.85) { // Deep Purple/Violet
                hue = 270 + this.rand() * 30;
                sat = 85;
                light = 40;
            } else { // Golden/Orange hints
                hue = 30 + this.rand() * 20;
                sat = 80;
                light = 45;
            }

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, 0.2)`);
            gradient.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.1)`);
            gradient.addColorStop(0.7, `hsla(${hue}, ${sat}%, ${light}%, 0.03)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(size, size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const cloud = new THREE.Mesh(geometry, material);

            // Spread across the whole sky
            cloud.position.x = (this.rand() - 0.5) * 5000;
            cloud.position.y = (this.rand() - 0.5) * 2500;
            cloud.position.z = -800 - this.rand() * 1500; // Layered depth

            cloud.rotation.z = this.rand() * Math.PI;

            this.nebulaClouds.push(cloud); // Store for animation
            this.scene.add(cloud);
        }

        // Add EDGE nebulas - specifically positioned at screen corners/edges
        const edgePositions = [
            { x: -2200, y: 800 }, // Top-left
            { x: 2200, y: 800 }, // Top-right
            { x: -2200, y: -600 }, // Bottom-left
            { x: 2200, y: -600 }, // Bottom-right
            { x: -2500, y: 0 }, // Left center
            { x: 2500, y: 0 }, // Right center
        ];

        edgePositions.forEach((pos) => {
            const size = 2500 + this.rand() * 1500;
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Random vibrant color for edge nebulas
            const hue = this.rand() > 0.5 ? 320 + this.rand() * 40 : 180 + this.rand() * 40;
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, 85%, 45%, 0.3)`); // Brighter for edges
            gradient.addColorStop(0.5, `hsla(${hue}, 80%, 40%, 0.15)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(size, size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const cloud = new THREE.Mesh(geometry, material);
            cloud.position.x = pos.x + (this.rand() - 0.5) * 400;
            cloud.position.y = pos.y + (this.rand() - 0.5) * 300;
            cloud.position.z = -600 - this.rand() * 800;
            cloud.rotation.z = this.rand() * Math.PI;
            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        });

        console.log('[StellarDrift] Vibrant Nebula clouds created with edge lights');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orbiting Particles (Supernova Style)
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Orbiting Particles (REMOVED)
    // ─────────────────────────────────────────────────────────────────────────

    // createOrbitingParticles() { ... }

    // ─────────────────────────────────────────────────────────────────────────
    // Background (Two scrolling planes at z=-520, like Andromeda)
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Hero Nebula Backdrop - Direct Blood Moon nebula port with fixed palette ramps
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaBackdrop() {
        const textureLoader = new THREE.TextureLoader();
        const texturePath = './textures/blood-moon/';
        const textures = [
            textureLoader.load(`${texturePath}nebula-red-1.png`),
            textureLoader.load(`${texturePath}nebula-red-2.png`),
            textureLoader.load(`${texturePath}nebula-red-3.png`),
        ];

        textures.forEach((texture) => {
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
        });

        const paletteStartIndex = Math.floor(this.rand() * STELLAR_BLOOD_MOON_PALETTES.length);
        const selectedPalettes = Array.from({ length: 3 }, (_, index) => {
            const palettePreset = STELLAR_BLOOD_MOON_PALETTES[
                (paletteStartIndex + index) % STELLAR_BLOOD_MOON_PALETTES.length
            ] || STELLAR_BLOOD_MOON_PALETTES[0];

            return {
                name: palettePreset.name,
                shadow: new THREE.Color(palettePreset.shadow),
                body: new THREE.Color(palettePreset.body),
                glow: new THREE.Color(palettePreset.glow),
            };
        });

        this.nebulaPalette = {
            families: selectedPalettes.map((palette) => palette.name),
            warm: selectedPalettes[0].body.clone(),
            cool: selectedPalettes[1].body.clone(),
            accent: selectedPalettes[2].body.clone(),
            shadow: selectedPalettes[0].shadow.clone(),
            body: selectedPalettes[0].body.clone(),
            glow: selectedPalettes[0].glow.clone(),
        };

        const planeConfigs = [
            {
                texture: textures[0],
                size: 6000 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                z: -4500 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                opacity: 0.30,
                speed: 0.00010 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                layerRole: 'body',
                driftOffset: 0,
                offsetY: 0,
                rotation: 0.12,
            },
            {
                texture: textures[1],
                size: 7000 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                z: -4000 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                opacity: 0.25,
                speed: 0.00015 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                layerRole: 'body',
                driftOffset: 150 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                offsetY: 60 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                rotation: -0.28,
            },
            {
                texture: textures[2],
                size: 5000 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                z: -3000 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                opacity: 0.20,
                speed: 0.00020 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                layerRole: 'filament',
                driftOffset: -110 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                offsetY: -80 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                rotation: 0.52,
            },
            {
                texture: textures[0],
                size: 5500 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                z: -2500 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                opacity: 0.15,
                speed: 0.00025 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                layerRole: 'glow',
                driftOffset: 220 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                offsetY: 110 * STELLAR_BLOOD_MOON_NEBULA_SCALE,
                rotation: -0.08,
            },
        ];
        const massConfigs = [
            {
                clusterRole: 'hero-left',
                palette: selectedPalettes[0],
                paletteGroup: selectedPalettes[0].name,
                offsetX: -5800,
                offsetY: 560,
                scale: 0.56,
                depthOffset: -900,
                opacityMultiplier: 0.78,
                renderOrderBase: -2140,
            },
            {
                clusterRole: 'hero-center',
                palette: selectedPalettes[1],
                paletteGroup: selectedPalettes[1].name,
                offsetX: 0,
                offsetY: 1240,
                scale: 0.78,
                depthOffset: -2200,
                opacityMultiplier: 0.94,
                renderOrderBase: -2240,
            },
            {
                clusterRole: 'hero-right',
                palette: selectedPalettes[2],
                paletteGroup: selectedPalettes[2].name,
                offsetX: 6000,
                offsetY: 600,
                scale: 0.58,
                depthOffset: -950,
                opacityMultiplier: 0.78,
                renderOrderBase: -2340,
            },
        ];
        const cameraX = this.camera?.position?.x ?? this.cameraBasePosition.x;
        const cameraY = this.camera?.position?.y ?? this.cameraBasePosition.y;

        this.nebulaClouds = [];
        this.nebulaMeshes = [];
        this.nebulaStacks = [];
        this.depthHazeLayers = [];

        massConfigs.forEach((massConfig, massIndex) => {
            planeConfigs.forEach((config, layerIndex) => {
                const geometry = new THREE.PlaneGeometry(
                    config.size * massConfig.scale,
                    config.size * massConfig.scale,
                );
                const materialData = createStellarBloodMoonNebulaMaterial({
                    isWebGPU: this.isWebGPU,
                    nebulaTexture: config.texture,
                    opacity: config.opacity * massConfig.opacityMultiplier,
                    palette: massConfig.palette,
                });

                const mesh = new THREE.Mesh(geometry, materialData.material);
                const driftOffset = config.driftOffset * massConfig.scale;
                const baseZ = config.z + massConfig.depthOffset;
                const offsetY = massConfig.offsetY + config.offsetY * massConfig.scale;

                mesh.position.set(
                    cameraX * 0.3 + driftOffset + massConfig.offsetX,
                    cameraY * 0.2 + offsetY,
                    baseZ,
                );
                mesh.rotation.z = config.rotation;
                mesh.renderOrder = massConfig.renderOrderBase + layerIndex;
                mesh.userData.materialData = materialData;
                mesh.userData.color = massConfig.palette.body.clone();
                mesh.userData.baseOpacity = config.opacity * massConfig.opacityMultiplier;
                mesh.userData.driftSpeed = config.speed;
                mesh.userData.driftOffset = driftOffset;
                mesh.userData.pulsePhase = this.rand() * Math.PI * 2;
                mesh.userData.pulseScale = 1.0;
                mesh.userData.stackId = massIndex;
                mesh.userData.layerRole = config.layerRole;
                mesh.userData.clusterRole = massConfig.clusterRole;
                mesh.userData.paletteGroup = massConfig.paletteGroup;
                mesh.userData.baseAnchor = new THREE.Vector3(massConfig.offsetX, offsetY, baseZ);
                mesh.userData.parallaxFactor = 0.0;
                mesh.userData.flowSeed = this.rand() * 100 + massIndex * 17.3 + layerIndex * 5.1;
                mesh.userData.massOffsetX = massConfig.offsetX;
                mesh.userData.massOffsetY = offsetY;
                mesh.userData.baseZ = baseZ;
                mesh.userData.wrapBoundary = STELLAR_BLOOD_MOON_NEBULA_WRAP;
                mesh.userData.totalWidth = STELLAR_BLOOD_MOON_NEBULA_WRAP * 2;
                mesh.userData.isBurstAnchor = layerIndex === 0;

                this.nebulaClouds.push(mesh);
                this.nebulaMeshes.push(mesh);
                this.scene.add(mesh);
            });
        });

        console.log(
            '[StellarDrift] Blood Moon nebula port created',
            {
                palettes: selectedPalettes.map((palette) => palette.name),
                masses: massConfigs.length,
                planesPerMass: planeConfigs.length,
            },
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Planet - Pink/Salmon Gas Giant with Flowing Bands
    // ─────────────────────────────────────────────────────────────────────────

    getRoundParticleTexture() {
        if (this._roundParticleTexture) return this._roundParticleTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);

        this._roundParticleTexture = new THREE.CanvasTexture(canvas);
        return this._roundParticleTexture;
    }

    getStarTexture() {
        if (this._starTexture) return this._starTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const center = 64;

        // Clear canvas
        ctx.clearRect(0, 0, 128, 128);

        // Outer soft glow halo - smooth circular falloff
        const outerGlow = ctx.createRadialGradient(center, center, 0, center, center, 64);
        outerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
        outerGlow.addColorStop(0.15, 'rgba(255, 255, 255, 0.15)');
        outerGlow.addColorStop(0.35, 'rgba(255, 255, 255, 0.06)');
        outerGlow.addColorStop(0.6, 'rgba(255, 255, 255, 0.02)');
        outerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = outerGlow;
        ctx.fillRect(0, 0, 128, 128);

        // Bright core - circular with soft edges
        const coreGlow = ctx.createRadialGradient(center, center, 0, center, center, 20);
        coreGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
        coreGlow.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)');
        coreGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
        coreGlow.addColorStop(0.8, 'rgba(255, 255, 255, 0.1)');
        coreGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = coreGlow;
        ctx.fillRect(0, 0, 128, 128);

        this._starTexture = new THREE.CanvasTexture(canvas);
        return this._starTexture;
    }

    getGlowTexture() {
        if (this._glowTexture) return this._glowTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        this._glowTexture = new THREE.CanvasTexture(canvas);
        return this._glowTexture;
    }

    createNebulaBurst(nebulaMesh, particleCount = 30) {
        // Get nebula's current world position and scale
        const pos = new THREE.Vector3();
        nebulaMesh.getWorldPosition(pos);
        const scale = (nebulaMesh.geometry.parameters?.width || 50000) * (nebulaMesh.scale?.x || 1);

        // Use color directly from mesh (synced to texture)
        const color = nebulaMesh.userData.color
            || nebulaMesh.parent?.userData?.color
            || new THREE.Color(0xFFFFFF);

        if (this.nebulaBurstCompute?.computeNode && this.nebulaBurstPool) {
            this.nebulaBurstCompute.spawnBurst(particleCount, pos, color, scale, 7.2);
            return;
        }

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const uvs = new Float32Array(particleCount * 2);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            const i2 = i * 2;
            // Spawn across the FULL nebula area
            const spreadX = (this.rand() - 0.5) * scale * 0.8;
            const spreadY = (this.rand() - 0.5) * scale * 0.5;

            positions[i * 3] = pos.x + spreadX;
            positions[i * 3 + 1] = pos.y + spreadY;
            positions[i * 3 + 2] = pos.z + 3000 + this.rand() * 2000; // In front of nebula

            // Velocity: Shoot toward camera with dramatic spread
            const speed = 80 + this.rand() * 80; // FAST shooting particles
            velocities.push({
                x: (this.rand() - 0.5) * 35, // More lateral spread
                y: (this.rand() - 0.5) * 35,
                z: speed, // Toward camera
            });
            uvs[i2] = 0.5;
            uvs[i2 + 1] = 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        const material = new THREE.PointsMaterial({
            color,
            map: this.getRoundParticleTexture(), // USE ROUND TEXTURE
            size: 200 + this.rand() * 150, // Balanced size for visibility
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            velocities,
            life: 8.0, // EVEN LONGER LIFE (was 5.0)
            maxLife: 8.0,
        };

        this.scene.add(burst);
        this.nebulaBursts.push(burst);
    }

    burstAllVisibleNebulas(particlesPerNebula) {
        this.nebulaMeshes.forEach((nebula) => {
            if (!nebula.userData?.isBurstAnchor) return;
            this.createNebulaBurst(nebula, particlesPerNebula);
        });
    }

    loadStellarSurfaceTexture(texturePath, {
        wrapS = THREE.ClampToEdgeWrapping,
        wrapT = THREE.ClampToEdgeWrapping,
        anisotropy = 8,
    } = {}) {
        const texture = new THREE.TextureLoader().load(texturePath);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = wrapS;
        texture.wrapT = wrapT;

        const maxAnisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? anisotropy;
        texture.anisotropy = Math.max(1, Math.min(anisotropy, maxAnisotropy));

        return texture;
    }

    createPlanet() {
        const planetSize = 500;

        const geometry = new THREE.SphereGeometry(planetSize, this.qualityPreset.planetDetail, this.qualityPreset.planetDetail);

        const jupiterTexture = this.loadStellarSurfaceTexture('./textures/2k_jupiter.jpg');
        const materialData = createStellarPlanetMaterial({
            isWebGPU: this.isWebGPU,
            planetTexture: jupiterTexture,
        });
        this.planetMaterialData = materialData;

        this.planet = new THREE.Mesh(geometry, materialData.material);
        this.planet.position.set(0, 0, 0);
        this.planet.renderOrder = 500;
        this.scene.add(this.planet);

        // Inner pink glow (tight around planet)
        this.createGlowPlane(planetSize * 2.3, 0xff88aa, 0.35, -10, 0, 'small');

        // Outer atmospheric glow (larger, softer)
        this.createGlowPlane(planetSize * 3.5, 0xff6699, 0.25, -20, 0, 'big');

        this.createHeroRingSystem(planetSize);

        console.log('[StellarDrift] Pink gas giant planet created');
    }

    createHeroRingSystem(planetSize = 500) {
        const ringGroup = new THREE.Group();
        ringGroup.position.set(0, 0, 0);
        ringGroup.rotation.x = Math.PI * 0.5;
        ringGroup.rotation.z = 0.24;

        const primaryInner = planetSize * 1.28;
        const primaryOuter = planetSize * 2.52;
        const primaryGeometry = new THREE.RingGeometry(primaryInner, primaryOuter, 164, 1);
        const primaryMaterialData = createStellarPlanetRingMaterial({
            isWebGPU: this.isWebGPU,
            colorInner: 0xe9ddff,
            colorOuter: 0xaf95dc,
            opacity: 0.19,
            innerRadius: primaryInner,
            outerRadius: primaryOuter,
            mrtRole: 'hero-planet-ring-primary',
        });
        const primaryRing = new THREE.Mesh(primaryGeometry, primaryMaterialData.material);
        primaryRing.userData.materialData = primaryMaterialData;
        primaryRing.renderOrder = 362;
        ringGroup.add(primaryRing);

        const outerInner = planetSize * 1.72;
        const outerOuter = planetSize * 3.08;
        const outerGeometry = new THREE.RingGeometry(outerInner, outerOuter, 160, 1);
        const outerMaterialData = createStellarPlanetRingMaterial({
            isWebGPU: this.isWebGPU,
            colorInner: 0xbcc9ff,
            colorOuter: 0x728fd0,
            opacity: 0.12,
            innerRadius: outerInner,
            outerRadius: outerOuter,
            mrtRole: 'hero-planet-ring-outer',
        });
        const outerRing = new THREE.Mesh(outerGeometry, outerMaterialData.material);
        outerRing.userData.materialData = outerMaterialData;
        outerRing.rotation.z = 0.08;
        outerRing.renderOrder = 361;
        ringGroup.add(outerRing);

        this.heroRingSystem = ringGroup;
        this.heroRingMaterialData = [primaryMaterialData, outerMaterialData];
        this.scene.add(ringGroup);
    }

    createGlowPlane(size, color, opacity, zPos, yPos, name) {
        const geometry = new THREE.PlaneGeometry(size, size);
        const materialData = createStellarGlowPlaneMaterial({
            isWebGPU: this.isWebGPU,
            glowTexture: this.getGlowTexture(),
            color,
            opacity,
        });
        const plane = new THREE.Mesh(geometry, materialData.material);
        plane.position.set(0, yPos, zPos);
        plane.userData.materialData = materialData;
        this.scene.add(plane);

        if (name === 'small') {
            this.smallGlow = plane;
        } else {
            this.bigGlow = plane;
        }
    }

    createDepthHazeTexture(config = {}) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return new THREE.CanvasTexture(canvas);
        }

        const centerX = 256 + (this.rand() - 0.5) * 44;
        const centerY = 256 + (this.rand() - 0.5) * 44;
        const vivid = config.vivid === true;
        const alpha = config.alpha ?? (vivid ? 0.2 : 0.11);

        ctx.clearRect(0, 0, 512, 512);
        ctx.globalCompositeOperation = 'lighter';

        const drawBlob = (x, y, radius, innerAlpha, hueOffset = 0) => {
            const gradient = ctx.createRadialGradient(x, y, radius * 0.06, x, y, radius);
            if (vivid) {
                const hue = config.hue ?? (180 + this.rand() * 160);
                const saturation = config.saturation ?? 78;
                const lightness = config.lightness ?? 42;
                gradient.addColorStop(
                    0,
                    `hsla(${hue + hueOffset}, ${Math.min(100, saturation + 8)}%, ${Math.min(72, lightness + 10)}%, ${innerAlpha})`,
                );
                gradient.addColorStop(
                    0.42,
                    `hsla(${hue + hueOffset * 0.5}, ${Math.max(18, saturation - 6)}%, ${Math.max(12, lightness - 2)}%, ${innerAlpha * 0.48})`,
                );
                gradient.addColorStop(
                    0.8,
                    `hsla(${hue + hueOffset}, ${Math.max(12, saturation - 16)}%, ${Math.max(8, lightness - 12)}%, ${innerAlpha * 0.12})`,
                );
            } else {
                gradient.addColorStop(0, `rgba(255, 255, 255, ${innerAlpha})`);
                gradient.addColorStop(0.34, `rgba(198, 204, 226, ${innerAlpha * 0.46})`);
                gradient.addColorStop(0.72, `rgba(62, 70, 92, ${innerAlpha * 0.08})`);
            }
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        };

        const lobeCount = vivid ? 5 + Math.floor(this.rand() * 3) : 4 + Math.floor(this.rand() * 2);
        for (let i = 0; i < lobeCount; i += 1) {
            const angle = (i / lobeCount) * Math.PI * 2 + this.rand() * 0.65;
            const distance = vivid ? 18 + this.rand() * 92 : 26 + this.rand() * 72;
            const radius = vivid ? 130 + this.rand() * 120 : 118 + this.rand() * 90;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            const hueOffset = vivid ? (this.rand() - 0.5) * 26 : 0;
            drawBlob(x, y, radius, alpha * (vivid ? (0.72 + this.rand() * 0.42) : (0.62 + this.rand() * 0.22)), hueOffset);
        }

        const wispCount = vivid ? 8 + Math.floor(this.rand() * 5) : 5 + Math.floor(this.rand() * 3);
        for (let i = 0; i < wispCount; i += 1) {
            const angle = this.rand() * Math.PI * 2;
            const distance = vivid ? 70 + this.rand() * 150 : 58 + this.rand() * 96;
            const radius = vivid ? 54 + this.rand() * 84 : 42 + this.rand() * 58;
            drawBlob(
                centerX + Math.cos(angle) * distance,
                centerY + Math.sin(angle) * distance,
                radius,
                alpha * (vivid ? (0.18 + this.rand() * 0.14) : (0.1 + this.rand() * 0.08)),
                vivid ? (this.rand() - 0.5) * 38 : 0,
            );
        }

        ctx.globalCompositeOperation = 'destination-out';
        const voidCount = vivid ? 3 + Math.floor(this.rand() * 3) : 4 + Math.floor(this.rand() * 2);
        for (let i = 0; i < voidCount; i += 1) {
            const angle = this.rand() * Math.PI * 2;
            const distance = this.rand() * 110;
            const radius = vivid ? 52 + this.rand() * 92 : 46 + this.rand() * 66;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            const carve = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
            carve.addColorStop(0, `rgba(0, 0, 0, ${vivid ? (0.34 + this.rand() * 0.2) : (0.42 + this.rand() * 0.16)})`);
            carve.addColorStop(0.72, vivid ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.08)');
            carve.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = carve;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }

        ctx.globalCompositeOperation = 'destination-in';
        const edgeFade = ctx.createRadialGradient(256, 256, vivid ? 36 : 48, 256, 256, vivid ? 244 : 228);
        edgeFade.addColorStop(0, 'rgba(255, 255, 255, 1)');
        edgeFade.addColorStop(vivid ? 0.58 : 0.52, vivid ? 'rgba(255, 255, 255, 0.82)' : 'rgba(255, 255, 255, 0.76)');
        edgeFade.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = edgeFade;
        ctx.fillRect(0, 0, 512, 512);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createSecondaryBodies() {
        this.secondaryBodies = [];

        // Solar System Scope textures (CC BY 4.0): https://www.solarsystemscope.com/textures/
        const saturnTexture = this.loadStellarSurfaceTexture('./textures/stellar-drift/2k_saturn.jpg');
        const moonTexture = this.loadStellarSurfaceTexture('./textures/stellar-drift/2k_moon.jpg');
        const marsTexture = this.loadStellarSurfaceTexture('./textures/stellar-drift/2k_mars.jpg');

        const createBody = (config) => {
            const geometry = new THREE.SphereGeometry(
                config.radius,
                Math.max(16, this.qualityPreset.planetDetail / 1.6),
                Math.max(12, this.qualityPreset.planetDetail / 1.6),
            );
            const materialData = createStellarCelestialBodyMaterial({
                isWebGPU: this.isWebGPU,
                color: config.color,
                emissiveColor: config.emissiveColor,
                emissiveStrength: config.emissiveStrength,
                roughness: config.roughness,
                metalness: config.metalness,
                surfaceTexture: config.surfaceTexture,
                mrtRole: config.mrtRole,
            });
            const mesh = new THREE.Mesh(geometry, materialData.material);
            mesh.userData.materialData = materialData;
            mesh.renderOrder = config.renderOrder ?? 360;
            this.scene.add(mesh);

            const driftPhase = this.rand() * Math.PI * 2;
            this.secondaryBodies.push({
                mesh,
                basePosition: config.position.clone(),
                driftX: config.driftX ?? 50,
                driftY: config.driftY ?? 30,
                driftZ: config.driftZ ?? 25,
                driftSpeed: config.driftSpeed ?? 0.08,
                driftPhase,
                rotationSpeed: config.rotationSpeed ?? 0.00035,
                focalSide: Math.sign(config.position.x) || 1,
            });
        };

        const ringedPlanetPosition = new THREE.Vector3(1780, 460, -2800);
        const ringedGroup = new THREE.Group();
        ringedGroup.position.copy(ringedPlanetPosition);

        const ringedPlanetGeometry = new THREE.SphereGeometry(
            250,
            Math.max(18, this.qualityPreset.planetDetail / 1.4),
            Math.max(14, this.qualityPreset.planetDetail / 1.4),
        );
        const ringedPlanetMaterialData = createStellarCelestialBodyMaterial({
            isWebGPU: this.isWebGPU,
            color: 0xf4e2c4,
            emissiveColor: 0xe8caa6,
            emissiveStrength: 0.03,
            roughness: 0.72,
            metalness: 0.08,
            surfaceTexture: saturnTexture,
            mrtRole: 'secondary-ringed-planet',
        });
        const ringedPlanet = new THREE.Mesh(ringedPlanetGeometry, ringedPlanetMaterialData.material);
        ringedPlanet.userData.materialData = ringedPlanetMaterialData;
        ringedPlanet.renderOrder = 355;
        ringedGroup.add(ringedPlanet);

        const ringGeometry = new THREE.RingGeometry(320, 520, 96);
        const ringMaterialData = createStellarPlanetRingMaterial({
            isWebGPU: this.isWebGPU,
            colorInner: 0xf2dfb0,
            colorOuter: 0xb89c72,
            opacity: 0.18,
            innerRadius: 320,
            outerRadius: 520,
            mrtRole: 'secondary-ringed-planet-ring',
        });
        const ringMesh = new THREE.Mesh(ringGeometry, ringMaterialData.material);
        ringMesh.userData.materialData = ringMaterialData;
        ringMesh.rotation.x = Math.PI * 0.42;
        ringMesh.rotation.z = 0.22;
        ringMesh.renderOrder = 356;
        ringedGroup.add(ringMesh);

        this.scene.add(ringedGroup);
        this.secondaryBodies.push({
            mesh: ringedGroup,
            basePosition: ringedPlanetPosition.clone(),
            driftX: 65,
            driftY: 40,
            driftZ: 30,
            driftSpeed: 0.06,
            driftPhase: this.rand() * Math.PI * 2,
            rotationSpeed: 0.00024,
            focalSide: 1,
        });

        createBody({
            radius: 130,
            color: 0xf2f4ff,
            emissiveColor: 0xe5edff,
            emissiveStrength: 0.025,
            roughness: 0.34,
            metalness: 0.14,
            surfaceTexture: moonTexture,
            position: new THREE.Vector3(-1700, -300, -2300),
            driftX: 54,
            driftY: 34,
            driftZ: 20,
            driftSpeed: 0.085,
            rotationSpeed: 0.00042,
            mrtRole: 'secondary-ice-moon',
            renderOrder: 354,
        });

        createBody({
            radius: 170,
            color: 0xf8d8c0,
            emissiveColor: 0x8c4f34,
            emissiveStrength: 0.006,
            roughness: 0.9,
            metalness: 0.04,
            surfaceTexture: marsTexture,
            position: new THREE.Vector3(2140, -530, -4200),
            driftX: 44,
            driftY: 26,
            driftZ: 32,
            driftSpeed: 0.05,
            rotationSpeed: 0.0003,
            mrtRole: 'secondary-rocky-body',
            renderOrder: 352,
        });

        console.log('[StellarDrift] Secondary celestial bodies created');
    }

    createDepthHazeLayers() {
        this.depthHazeLayers = [];
        const palette = this.nebulaPalette || {
            warm: new THREE.Color(0xff8855),
            cool: new THREE.Color(0x7ea0ff),
            accent: new THREE.Color(0x86739e),
        };
        const muteSupportColor = (sourceColor, saturationScale = 0.26, lightness = 0.3) => {
            const hsl = { h: 0, s: 0, l: 0 };
            sourceColor.getHSL(hsl);
            return new THREE.Color().setHSL(
                hsl.h,
                THREE.MathUtils.clamp(hsl.s * saturationScale, 0.05, 0.36),
                lightness,
            );
        };

        const hazeConfigs = [
            {
                basePosition: new THREE.Vector3(-3320, 940, -17600),
                size: 11200,
                opacity: 0.062,
                tintColor: muteSupportColor(palette.warm, 0.24, 0.28),
                driftRange: 160,
                parallaxFactor: 0.06,
                detailStrength: 0.74,
                densityThreshold: 0.58,
                flowStrength: 0.024,
                emissiveGain: 0.018,
                rotation: -0.18,
            },
            {
                basePosition: new THREE.Vector3(2720, 1680, -22200),
                size: 12400,
                opacity: 0.042,
                tintColor: muteSupportColor(palette.cool, 0.22, 0.31),
                driftRange: 130,
                parallaxFactor: 0.038,
                detailStrength: 0.82,
                densityThreshold: 0.6,
                flowStrength: 0.022,
                emissiveGain: 0.016,
                rotation: 0.26,
            },
            {
                basePosition: new THREE.Vector3(3180, -1120, -24800),
                size: 9600,
                opacity: 0.036,
                tintColor: muteSupportColor(palette.accent, 0.2, 0.29),
                driftRange: 110,
                parallaxFactor: 0.03,
                detailStrength: 0.78,
                densityThreshold: 0.62,
                flowStrength: 0.02,
                emissiveGain: 0.014,
                rotation: -0.08,
            },
        ];

        hazeConfigs.forEach((config, index) => {
            const phaseSeed = this.rand() * 100 + index * 19.4;
            const texture = this.createDepthHazeTexture({
                alpha: config.opacity,
            });
            const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.56);
            const materialData = createStellarNebulaMaterial({
                isWebGPU: this.isWebGPU,
                variant: 'haze',
                nebulaTexture: texture,
                opacity: config.opacity,
                tintColor: config.tintColor,
                flowStrength: config.flowStrength,
                detailStrength: config.detailStrength,
                densityThreshold: config.densityThreshold,
                emissiveGain: config.emissiveGain,
                edgeSoftness: 1.44,
                phaseSeed,
            });

            const mesh = new THREE.Mesh(geometry, materialData.material);
            mesh.userData.materialData = materialData;
            mesh.position.copy(config.basePosition);
            mesh.rotation.z = config.rotation;
            mesh.renderOrder = -2600 - index;
            mesh.userData.color = config.tintColor;
            mesh.userData.baseOpacity = config.opacity;
            mesh.userData.baseEmissiveGain = config.emissiveGain;
            mesh.userData.baseFlowStrength = config.flowStrength;
            mesh.userData.baseDetailStrength = config.detailStrength;
            mesh.userData.baseDensityThreshold = config.densityThreshold;
            mesh.userData.pulseScale = 0.12 + index * 0.05;
            mesh.userData.flowSeed = phaseSeed;
            mesh.userData.baseRotation = config.rotation;
            mesh.userData.rotationSpeed = 0.11 + index * 0.03;
            mesh.userData.rotationAmplitude = 0.014 + index * 0.004;
            this.scene.add(mesh);

            this.depthHazeLayers.push({
                mesh,
                basePosition: config.basePosition.clone(),
                driftRange: config.driftRange,
                parallaxFactor: config.parallaxFactor,
                driftPhase: this.rand() * Math.PI * 2,
                driftSpeed: 0.018 + this.rand() * 0.012,
                focalSide: Math.sign(config.basePosition.x) || 1,
            });
        });

        console.log('[StellarDrift] Depth haze layers created as dark support veils');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dust Ring - Subtle ring of particles around planet
    // ─────────────────────────────────────────────────────────────────────────

    createDustRing() {
        // Ring of millions of tiny particles (simulated with fewer for performance)
        const particleCount = this.qualityPreset.dustRingParticleCount || 3000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const radii = new Float32Array(particleCount);
        const angles = new Float32Array(particleCount);
        const yBases = new Float32Array(particleCount);
        const angularSpeeds = new Float32Array(particleCount);

        const ringColor = new THREE.Color(0xffaaee); // Pinkish
        const ringColorOuter = new THREE.Color(0xaa88cc); // Purpleish

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // Ring distribution
            const angle = this.rand() * Math.PI * 2;
            // Radius: Planet is 500. Ring from 600 to 1200
            const radius = 600 + this.rand() ** 2 * 600;

            // Flattened ring
            const x = Math.cos(angle) * radius;
            const z = (Math.sin(angle) * radius) * 0.2; // Tilt/flatten
            const y = (this.rand() - 0.5) * 40; // Thin layer vertical variation

            positions[i3] = x;
            positions[i3 + 1] = y + z * 0.5; // Tilt
            positions[i3 + 2] = z * 2.0;
            radii[i] = radius;
            angles[i] = angle;
            yBases[i] = y;
            angularSpeeds[i] = 0.16 + this.rand() * 0.24;

            // Color variation based on radius
            const color = radius < 800 ? ringColor : ringColorOuter;
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        this.dustRingCompute = null;
        if (this.shouldUseCompute()) {
            try {
                this.dustRingCompute = new StellarDustRingCompute(particleCount, () => this.rand());
                this.dustRingCompute.setInitialState(positions, radii, angles, yBases, angularSpeeds);
                this.dustRingCompute.createComputeNode();
            } catch (error) {
                console.warn('[StellarDrift] Dust ring compute init failed; using CPU fallback.', error);
                this.dustRingCompute?.dispose?.();
                this.dustRingCompute = null;
            }
        }

        const materialData = createStellarDustRingMaterial({
            isWebGPU: this.isWebGPU,
            size: 2,
            opacity: 0.6,
            dustCompute: this.dustRingCompute,
        });
        this.dustRingMaterialData = materialData;

        this.dustRing = new THREE.Points(geometry, materialData.material);
        this.dustRing.userData.materialData = materialData;
        // Tilt the whole ring slightly
        this.dustRing.rotation.z = 0.2;
        this.dustRing.rotation.x = 0.3;

        this.scene.add(this.dustRing);
        console.log(`[StellarDrift] Dust ring created (${particleCount} particles)`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating sparkles across the screen
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const particleCount = this.qualityPreset.ambientParticleCount || 500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const randoms = new Float32Array(particleCount);

        const particleColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xffaaee), // Pink
            new THREE.Color(0xaaddff), // Light Blue
            new THREE.Color(0xddaaff), // Light Purple
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Spread across entire visible area
            positions[i3] = (this.rand() - 0.5) * 4000;
            positions[i3 + 1] = (this.rand() - 0.5) * 2000;
            positions[i3 + 2] = (this.rand() - 0.5) * 2000 - 500;

            const color = particleColors[Math.floor(this.rand() * particleColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1 + this.rand() * 2;
            randoms[i] = this.rand();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.ambientParticleCompute = null;
        if (this.shouldUseCompute()) {
            try {
                this.ambientParticleCompute = new StellarAmbientParticleCompute(
                    particleCount,
                    {
                        xMin: -2000,
                        xMax: 2000,
                        yMin: -1000,
                        yMax: 1000,
                        zMin: -1500,
                        zMax: 600,
                    },
                    () => this.rand(),
                );
                this.ambientParticleCompute.setInitialState(positions, randoms, sizes);
                this.ambientParticleCompute.createComputeNode();
            } catch (error) {
                console.warn('[StellarDrift] Ambient compute init failed; using CPU fallback.', error);
                this.ambientParticleCompute?.dispose?.();
                this.ambientParticleCompute = null;
            }
        }

        const materialData = createStellarAmbientParticlesMaterial({
            isWebGPU: this.isWebGPU,
            size: 2,
            opacity: 0.6,
            ambientCompute: this.ambientParticleCompute,
        });
        this.ambientParticlesMaterialData = materialData;

        this.ambientParticles = new THREE.Points(geometry, materialData.material);
        this.ambientParticles.userData.materialData = materialData;
        this.scene.add(this.ambientParticles);
        console.log(`[StellarDrift] Ambient particles created (${particleCount} particles)`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Meteor Field - Dark Silhouettes (like reference image)
    // ─────────────────────────────────────────────────────────────────────────

    createMeteorField() {
        const count = this.qualityPreset.meteorCount;
        const materialData = createStellarMeteorMaterial({
            isWebGPU: this.isWebGPU,
        });
        const material = materialData.material;

        // Instanced mesh migration (Phase 5): one geometry/material, per-instance transforms.
        const meteorGeometry = new THREE.IcosahedronGeometry(10, 0);
        const vertexPositions = meteorGeometry.attributes.position;
        const randomize = 2.5;
        for (let i = 0; i < vertexPositions.count; i++) {
            vertexPositions.setXYZ(
                i,
                vertexPositions.getX(i) + (this.rand() - 0.5) * randomize,
                vertexPositions.getY(i) + (this.rand() - 0.5) * randomize,
                vertexPositions.getZ(i) + (this.rand() - 0.5) * randomize,
            );
        }
        meteorGeometry.computeVertexNormals();

        const instancedMesh = new THREE.InstancedMesh(meteorGeometry, material, count);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instancedMesh.frustumCulled = false;
        instancedMesh.userData.materialData = materialData;

        this.meteors = [];
        if (!this.meteorMatrixDummy) {
            this.meteorMatrixDummy = new THREE.Object3D();
        }
        const meteorDummy = this.meteorMatrixDummy;

        for (let i = 0; i < count; i++) {
            // Ring/Belt Distribution (Natural curve matching reference)
            const angle = (this.rand() - 0.5) * 3.5; // Wide arc (~200 degrees)
            const radius = 600 + this.rand() * 600; // Reduced max radius (600-1200) to keep away from camera

            const baseX = Math.sin(angle) * radius;
            const baseZ = Math.cos(angle) * radius;

            // Vertical spread (lower down as requested)
            const beltTilt = baseZ * 0.15; // Increased tilt
            const yBase = (this.rand() - 0.5) * 150 - 200 + beltTilt; // Much lower (-200)

            // Define animation properties
            const speed = -(this.rand() * 0.2 + 0.1) * 0.002; // Reduced base speed (was 0.005)
            const scale = (5 + this.rand() * 15) / 10;
            const rotation = {
                x: this.rand() * Math.PI * 2,
                y: this.rand() * Math.PI * 2,
                z: this.rand() * Math.PI * 2,
            };

            this.meteors.push({
                angle,
                radius,
                speed,
                yBase,
                scale,
                rotation,
                // Rotation (tumbling)
                rotationSpeed: {
                    x: this.rand() * 0.002 + 0.002, // Reduced rotation speed
                    y: this.rand() * 0.002 + 0.002,
                    z: this.rand() * 0.002 + 0.002,
                },
            });

            meteorDummy.position.set(baseX, yBase, baseZ);
            meteorDummy.rotation.set(rotation.x, rotation.y, rotation.z);
            meteorDummy.scale.setScalar(scale);
            meteorDummy.updateMatrix();
            instancedMesh.setMatrixAt(i, meteorDummy.matrix);
        }

        instancedMesh.instanceMatrix.needsUpdate = true;
        this.meteorInstancedMesh = instancedMesh;
        this.scene.add(instancedMesh);

        console.log(`[StellarDrift] ${count} meteors created (instanced)`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        this.disposePostProcessingStack();

        if (!this.qualityPreset.enablePostProcessing || !this.capabilities.post) {
            return;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;
        const effectScale = this.adaptiveScalerState?.effectScale ?? 1;

        if (this.isWebGPU) {
            try {
                const useMRT = this.capabilities.mrt;
                this.postProcessing = new StellarDriftPost(
                    this.renderer,
                    this.scene,
                    this.camera,
                    {
                        useMRT,
                        bloomStrength: this.qualityPreset.bloomStrength,
                        bloomRadius: this.qualityPreset.bloomRadius,
                        bloomThreshold: 0.66,
                        chromaticStrength: 0.0,
                        vignetteOffset: 1.1,
                        vignetteDarkness: 0.2,
                        speedLineIntensity: 0.0,
                        exposure: 0.96,
                        contrast: 1.12,
                        saturation: 1.02,
                        bloomDownsample: THREE.MathUtils.clamp(0.6 + effectScale * 0.22, 0.58, 0.86),
                    },
                );
                this.postProcessing.setSize(width, height);
                console.log(`[StellarDrift] WebGPU post-processing ready (MRT: ${useMRT})`);
            } catch (error) {
                console.warn('[StellarDrift] WebGPU post setup failed. Falling back to direct rendering:', error);
                this.capabilities.post = false;
                this.flags.usePost = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
            }
            return;
        }

        try {
            this.composer = new EffectComposer(this.renderer);

            const renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);

            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(width, height),
                this.qualityPreset.bloomStrength,
                this.qualityPreset.bloomRadius,
                0.66,
            );
            this.composer.addPass(this.bloomPass);

            // Vignette Pass (dynamic darkness for tunnel vision)
            this.vignettePass = new ShaderPass(VignetteShader);
            this.vignettePass.uniforms.darkness.value = 0.2;
            this.vignettePass.uniforms.offset.value = 1.1;
            this.composer.addPass(this.vignettePass);

            // WARP EFFECTS: Chromatic Aberration (color fringing at edges during warp)
            this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
            this.chromaticPass.uniforms.intensity.value = 0;
            this.composer.addPass(this.chromaticPass);

            // WARP EFFECTS: Radial Speed Lines (motion blur/trails during warp)
            this.radialSpeedPass = new ShaderPass(RadialSpeedLinesShader);
            this.radialSpeedPass.uniforms.intensity.value = 0;
            this.radialSpeedPass.uniforms.time.value = 0;
            this.composer.addPass(this.radialSpeedPass);

            this.colorGradePass = new ShaderPass(ColorGradeShader);
            this.colorGradePass.uniforms.exposure.value = 0.96;
            this.colorGradePass.uniforms.contrast.value = 1.12;
            this.colorGradePass.uniforms.saturation.value = 1.02;
            this.composer.addPass(this.colorGradePass);
        } catch (error) {
            console.warn('[StellarDrift] Post-processing setup failed. Falling back to direct rendering:', error);
            this.capabilities.post = false;
            this.flags.usePost = false;
            this.disposePostProcessingStack();
            this.configureRendererColorPipeline();
            return;
        }

        console.log('[StellarDrift] Post-processing with warp effects initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.triggerLockEffect();
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.triggerComboEffect(data.comboCount);
            }
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        this.eventUnsubscribers.push(lockUnsub, comboUnsub);
    }

    triggerCameraPulse(intensity = 0.2, {
        lateralBias = 0,
        verticalBias = 0,
        depthBias = 0,
        rollBias = 0,
    } = {}) {
        const clamped = THREE.MathUtils.clamp(intensity, 0, 2.0);
        if (clamped <= 0) return;

        const lateralKick = (this.rand() - 0.5) * (18 + clamped * 26) + lateralBias;
        const verticalKick = (this.rand() - 0.5) * (14 + clamped * 20) + verticalBias;
        const depthKick = -(6 + clamped * 16 + this.rand() * 8) + depthBias;

        this.cameraShake.x += lateralKick;
        this.cameraShake.y += verticalKick;
        this.cameraShake.z += depthKick;

        this.cameraLookOffset.x += lateralKick * 0.16;
        this.cameraLookOffset.y += verticalKick * 0.12;
        this.cameraLookOffset.z += depthKick * 0.04;

        this.cameraRollOffset = THREE.MathUtils.clamp(
            this.cameraRollOffset + (lateralKick * 0.0012) + rollBias,
            -0.24,
            0.24,
        );
    }

    updateCinematicCamera(deltaSeconds, planetX = 0, planetY = 0) {
        if (!this.camera) return;

        const dt = Number.isFinite(deltaSeconds) ? Math.max(0.001, deltaSeconds) : (1 / 60);
        const dt60 = THREE.MathUtils.clamp(dt * 60, 0.25, 2.2);

        this.cameraShake.multiplyScalar(0.88 ** dt60);
        this.cameraLookOffset.multiplyScalar(0.9 ** dt60);
        this.cameraRollOffset *= 0.86 ** dt60;

        const warp = THREE.MathUtils.clamp(this.warpSpeed, 0, 1);
        const cinematicTime = this.time * 8.5 + this.cameraDriftSeed;
        const reactiveLift = this.auroraPulse * 0.45 + this.reactiveState.comet * 0.35;

        this.cameraSway.set(
            Math.sin(cinematicTime * 1.2) * (7 + warp * 10),
            Math.cos(cinematicTime * 0.95 + 0.7) * (5 + reactiveLift * 12),
            Math.sin(cinematicTime * 0.72 + 1.1) * (11 + warp * 16),
        );

        const followX = planetX * (0.2 + warp * 0.12);
        const followY = planetY * (0.16 + warp * 0.08);

        const orbitX = Math.sin(cinematicTime * 0.28) * (92 + warp * 90)
            + Math.sin(cinematicTime * 0.61 + 1.2) * (58 + reactiveLift * 42);
        const orbitY = Math.cos(cinematicTime * 0.23 + 0.6) * (52 + reactiveLift * 28)
            + Math.sin(cinematicTime * 0.47) * 24;
        const dollyWave = Math.sin(cinematicTime * 0.17 + 0.4) * 44
            + Math.cos(cinematicTime * 0.33) * 21;
        const warpDolly = -warp * (220 + this.radialBlurIntensity * 58);

        const targetX = this.cameraBasePosition.x + followX + orbitX + this.cameraSway.x + this.cameraShake.x;
        const targetY = this.cameraBasePosition.y + followY + orbitY + this.cameraSway.y + this.cameraShake.y;
        const targetZ = this.cameraBasePosition.z + dollyWave + warpDolly + this.cameraSway.z + this.cameraShake.z;

        const positionLerp = THREE.MathUtils.clamp(dt * (2.3 + warp * 2.5), 0.05, 0.34);
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, positionLerp);
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, positionLerp);
        this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetZ, positionLerp);

        const lookTargetX = planetX * (0.78 + warp * 0.14)
            + Math.sin(cinematicTime * 0.34) * 96
            + this.cameraLookOffset.x;
        const lookTargetY = planetY * (0.74 + warp * 0.1)
            + Math.cos(cinematicTime * 0.27 + 0.4) * 38
            + this.cameraLookOffset.y;
        const lookTargetZ = Math.sin(cinematicTime * 0.21) * 24 + this.cameraLookOffset.z;

        this.cameraLookTarget.set(lookTargetX, lookTargetY, lookTargetZ);
        const lookLerp = THREE.MathUtils.clamp(dt * (2.8 + warp * 2.8), 0.06, 0.38);
        this.cameraCurrentLookTarget.lerp(this.cameraLookTarget, lookLerp);
        this.camera.lookAt(this.cameraCurrentLookTarget);

        const targetRoll = THREE.MathUtils.clamp(
            this.cameraRollOffset
            + this.cameraShake.x * 0.0016
            + Math.sin(cinematicTime * 0.4) * 0.012
            + warp * 0.02,
            -0.18,
            0.18,
        );
        const rollLerp = THREE.MathUtils.clamp(dt * (3.0 + warp * 1.8), 0.08, 0.42);
        this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, targetRoll, rollLerp);
    }

    updateCinematicLighting(planetX = 0, planetY = 0) {
        const lightTime = this.time * 7.0;
        const pulse = this.bloomPulseIntensity * 0.7 + this.auroraPulse * 0.35 + this.warpSpeed * 0.25;

        if (this.meteorLight) {
            this.meteorLight.position.set(
                planetX * 0.22 + Math.sin(lightTime * 0.43) * 420,
                320 + Math.cos(lightTime * 0.71) * 120 + planetY * 0.18,
                280 + Math.sin(lightTime * 0.33 + 1.3) * 260,
            );
            this.meteorLight.intensity = 1.55 + pulse * 1.25;
            this.meteorLight.angle = THREE.MathUtils.lerp(
                this.meteorLight.angle,
                0.36 - this.warpSpeed * 0.08,
                0.08,
            );
        }

        if (this.meteorLightTarget) {
            this.meteorLightTarget.position.set(planetX * 0.72, planetY * 0.64, -40);
            this.meteorLightTarget.updateMatrixWorld();
        }

        if (this.keyLight) {
            this.keyLight.position.set(
                -260 + Math.sin(lightTime * 0.27) * 260,
                120 + Math.cos(lightTime * 0.41) * 90,
                420 + Math.sin(lightTime * 0.22 + 0.6) * 180,
            );
            this.keyLight.intensity = 0.82 + pulse * 0.38;
        }

        if (this.ambientLight) {
            this.ambientLight.intensity = THREE.MathUtils.clamp(
                0.44 + pulse * 0.18 - this.warpSpeed * 0.08,
                0.28,
                0.72,
            );
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 3D PIECE LOCK EFFECTS - Smooth interpolation (no harsh setTimeout)
    // ─────────────────────────────────────────────────────────────────────────

    triggerLockEffect() {
        this.pushReactiveEnvelope({
            twinkle: 0.82,
            dust: 0.18,
            bloom: 0.22,
            pulse: 0.12,
            glow: 0.1,
            ringGlitter: 0.14,
            lightning: 0.05,
            aurora: 0.03,
            comet: 0.02,
            meteor: 0.72,
        });

        this.triggerCameraPulse(0.14, {
            depthBias: -2.5 - this.rand() * 3.5,
            rollBias: (this.rand() - 0.5) * 0.01,
        });

        if (this.rand() > 0.76) {
            this.triggerPlanetLightning(0.18);
        }
    }

    createShockwaveRing(options = {}) {
        const {
            position = null,
            speed = 0.08,
            scale = 1.0,
            color = 0xffaa66,
            opacity = 0.6,
        } = options;

        // Create a 3D ring geometry that expands outward from the planet
        const geometry = new THREE.RingGeometry(450, 480, 64);
        const materialData = createStellarShockwaveRingMaterial({
            isWebGPU: this.isWebGPU,
            color,
            opacity,
        });
        const ring = new THREE.Mesh(geometry, materialData.material);
        if (position?.isVector3) {
            ring.position.copy(position);
        } else {
            ring.position.set(0, 0, 50); // Slightly in front of planet
        }
        ring.scale.set(scale, scale, scale);
        ring.userData.speed = speed; // Expansion speed
        ring.userData.materialData = materialData;

        this.scene.add(ring);
        this.shockwaveRings.push(ring);
    }

    createCrashMeteorCoreGeometry(radius, intensity = 0.5) {
        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.8);
        const detail = clampedIntensity > 1.05 ? 2 : 1;
        const geometry = new THREE.IcosahedronGeometry(radius, detail);
        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        const normal = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            normal.copy(vertex).normalize();

            const ridgedNoise = Math.sin(
                normal.x * 12.73
                + normal.y * 21.17
                + normal.z * 17.41
                + clampedIntensity * 3.2,
            );
            const cellularNoise = Math.sin(
                normal.x * 31.9
                + Math.cos(normal.y * 28.7)
                + normal.z * 26.5,
            );
            const roughness = (ridgedNoise * 0.65 + cellularNoise * 0.35) * (0.11 + clampedIntensity * 0.07);
            const headBias = THREE.MathUtils.smoothstep(normal.y, -0.25, 1.0);
            const rearBias = THREE.MathUtils.smoothstep(-normal.y, -0.1, 1.0);
            const craterMask = Math.max(
                0,
                Math.sin(normal.x * 53.2 + normal.z * 47.6 + normal.y * 19.7 + 0.7),
            ) * 0.05;

            const axialStretch = 1 + headBias * (0.22 + clampedIntensity * 0.14) - rearBias * 0.14;
            const scale = Math.max(0.5, axialStretch * (1 + roughness - craterMask));

            vertex.multiplyScalar(scale);
            vertex.x *= 0.92 + headBias * 0.18;
            vertex.z *= 0.88 + headBias * 0.14;

            positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }

        geometry.computeVertexNormals();
        return geometry;
    }

    createMeteorImpactBurst(position, intensity = 0.5, options = {}) {
        if (!position?.isVector3) return;

        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.8);
        const complexityScale = this.getCrashMeteorComplexityScale();
        const particleCount = Math.max(
            42,
            Math.floor((96 + clampedIntensity * 120) * complexityScale),
        );
        const burstColor = new THREE.Color().setHSL(0.08, 0.9, 0.68);

        const surfaceNormal = options.surfaceNormal?.isVector3
            ? options.surfaceNormal.clone().normalize()
            : new THREE.Vector3(0, 0, 1);
        const incomingDirection = options.incomingDirection?.isVector3
            ? options.incomingDirection.clone().normalize()
            : surfaceNormal.clone().negate();
        const reboundDirection = incomingDirection.clone().negate();

        if (this.nebulaBurstCompute?.computeNode && this.nebulaBurstPool) {
            const spread = (880 + clampedIntensity * 420) * (0.86 + complexityScale * 0.22);
            this.nebulaBurstCompute.spawnBurst(
                particleCount,
                position,
                burstColor,
                spread,
                (6.8 + clampedIntensity * 2.0) * (0.88 + complexityScale * 0.2),
            );
            return;
        }

        const tangentSeed = Math.abs(surfaceNormal.y) > 0.82
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 1, 0);
        const tangentA = new THREE.Vector3().crossVectors(surfaceNormal, tangentSeed).normalize();
        const tangentB = new THREE.Vector3().crossVectors(surfaceNormal, tangentA).normalize();

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const uvs = new Float32Array(particleCount * 2);
        const velocities = [];
        const direction = new THREE.Vector3();
        const lateralVector = new THREE.Vector3();
        const normalVector = new THREE.Vector3();
        const reboundVector = new THREE.Vector3();

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const theta = this.rand() * Math.PI * 2;
            const lateralSpread = 0.44 + this.rand() * 0.7;
            const lift = 18 + this.rand() * (72 + clampedIntensity * 34);

            lateralVector
                .copy(tangentA)
                .multiplyScalar(Math.cos(theta) * lateralSpread)
                .addScaledVector(tangentB, Math.sin(theta) * lateralSpread);
            normalVector.copy(surfaceNormal).multiplyScalar(0.52 + this.rand() * 0.42);
            reboundVector.copy(reboundDirection).multiplyScalar(0.24 + this.rand() * 0.26);
            direction.copy(normalVector).add(lateralVector).add(reboundVector).normalize();

            const speed = 28 + this.rand() * (44 + clampedIntensity * 28);

            positions[i3] = position.x + surfaceNormal.x * lift + lateralVector.x * 42;
            positions[i3 + 1] = position.y + surfaceNormal.y * lift + lateralVector.y * 42;
            positions[i3 + 2] = position.z + surfaceNormal.z * lift + lateralVector.z * 42;
            uvs[i2] = 0.5;
            uvs[i2 + 1] = 0.5;

            velocities.push({
                x: direction.x * speed,
                y: direction.y * speed,
                z: direction.z * speed,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        const baseSize = (160 + clampedIntensity * 110) * (0.82 + complexityScale * 0.28);
        const material = new THREE.PointsMaterial({
            color: burstColor,
            map: this.getGlowTexture(),
            size: baseSize,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            velocities,
            life: 1.72 + clampedIntensity * 0.9,
            maxLife: 1.72 + clampedIntensity * 0.9,
            decay: 0.017,
            drag: 0.986,
            baseSize,
            growRate: 1.32 + clampedIntensity * 1.0,
            gravity: {
                x: -surfaceNormal.x * 0.28,
                y: -surfaceNormal.y * 0.28 - 0.16,
                z: -surfaceNormal.z * 0.28,
            },
        };
        this.scene.add(burst);
        this.nebulaBursts.push(burst);
    }

    createMeteorImpactShards(position, surfaceNormal, incomingDirection, intensity = 0.5) {
        if (!position?.isVector3) return;

        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.8);
        const complexityScale = this.getCrashMeteorComplexityScale();
        const normal = surfaceNormal?.isVector3 ? surfaceNormal.clone().normalize() : new THREE.Vector3(0, 0, 1);
        const incoming = incomingDirection?.isVector3
            ? incomingDirection.clone().normalize()
            : normal.clone().negate();

        const shardCount = Math.max(
            12,
            Math.floor((26 + clampedIntensity * 40) * complexityScale),
        );
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(shardCount * 3);
        const uvs = new Float32Array(shardCount * 2);
        const velocities = [];

        const tangentSeed = Math.abs(normal.y) > 0.78 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const tangentA = new THREE.Vector3().crossVectors(normal, tangentSeed).normalize();
        const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
        const rebound = incoming.clone().negate();
        const direction = new THREE.Vector3();

        for (let i = 0; i < shardCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const theta = this.rand() * Math.PI * 2;
            const lateral = 0.25 + this.rand() * 0.5;
            const speed = 52 + this.rand() * (42 + clampedIntensity * 30);

            direction
                .copy(normal)
                .multiplyScalar(0.46 + this.rand() * 0.35)
                .addScaledVector(tangentA, Math.cos(theta) * lateral)
                .addScaledVector(tangentB, Math.sin(theta) * lateral)
                .addScaledVector(rebound, 0.18 + this.rand() * 0.2)
                .normalize();

            positions[i3] = position.x + normal.x * (22 + this.rand() * 40);
            positions[i3 + 1] = position.y + normal.y * (22 + this.rand() * 40);
            positions[i3 + 2] = position.z + normal.z * (22 + this.rand() * 40);
            uvs[i2] = 0.5;
            uvs[i2 + 1] = 0.5;

            velocities.push({
                x: direction.x * speed,
                y: direction.y * speed,
                z: direction.z * speed,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        const baseSize = (84 + clampedIntensity * 44) * (0.8 + complexityScale * 0.24);
        const material = new THREE.PointsMaterial({
            color: new THREE.Color().setHSL(0.11, 0.95, 0.66),
            map: this.getRoundParticleTexture(),
            size: baseSize,
            transparent: true,
            opacity: 0.96,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const shards = new THREE.Points(geometry, material);
        shards.userData = {
            velocities,
            life: 1.02 + clampedIntensity * 0.5,
            maxLife: 1.02 + clampedIntensity * 0.5,
            decay: 0.032,
            drag: 0.978,
            baseSize,
            growRate: 0.48 + clampedIntensity * 0.28,
            gravity: {
                x: -normal.x * 0.5,
                y: -normal.y * 0.5 - 0.3,
                z: -normal.z * 0.5,
            },
        };
        this.scene.add(shards);
        this.nebulaBursts.push(shards);
    }

    createMeteorImpactSmokeCloud(position, surfaceNormal, intensity = 0.5) {
        if (!position?.isVector3) return;

        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.8);
        const complexityScale = this.getCrashMeteorComplexityScale();
        const normal = surfaceNormal?.isVector3 ? surfaceNormal.clone().normalize() : new THREE.Vector3(0, 0, 1);
        const plumeCount = Math.max(
            18,
            Math.floor((52 + clampedIntensity * 86) * complexityScale),
        );
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(plumeCount * 3);
        const uvs = new Float32Array(plumeCount * 2);
        const velocities = [];

        const tangentSeed = Math.abs(normal.y) > 0.82 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const tangentA = new THREE.Vector3().crossVectors(normal, tangentSeed).normalize();
        const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
        const direction = new THREE.Vector3();

        for (let i = 0; i < plumeCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const theta = this.rand() * Math.PI * 2;
            const lateral = 0.3 + this.rand() * 0.88;
            const lift = 18 + this.rand() * (90 + clampedIntensity * 55);

            direction
                .copy(normal)
                .multiplyScalar(0.62 + this.rand() * 0.5)
                .addScaledVector(tangentA, Math.cos(theta) * lateral)
                .addScaledVector(tangentB, Math.sin(theta) * lateral)
                .normalize();

            const speed = 8 + this.rand() * (16 + clampedIntensity * 18);
            positions[i3] = position.x + direction.x * (12 + this.rand() * 28);
            positions[i3 + 1] = position.y + normal.y * lift * 0.24 + direction.y * (12 + this.rand() * 28);
            positions[i3 + 2] = position.z + direction.z * (12 + this.rand() * 28);
            uvs[i2] = 0.5;
            uvs[i2 + 1] = 0.5;

            velocities.push({
                x: direction.x * speed,
                y: direction.y * speed + 2 + clampedIntensity * 2.8,
                z: direction.z * speed,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        const baseSize = (260 + clampedIntensity * 188) * (0.84 + complexityScale * 0.24);
        const material = new THREE.PointsMaterial({
            color: new THREE.Color(0x6a564d),
            map: this.getRoundParticleTexture(),
            size: baseSize,
            transparent: true,
            opacity: 0.5 + clampedIntensity * 0.2,
            blending: THREE.NormalBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const smoke = new THREE.Points(geometry, material);
        smoke.userData = {
            velocities,
            life: 2.6 + clampedIntensity * 1.2,
            maxLife: 2.6 + clampedIntensity * 1.2,
            decay: 0.0088,
            drag: 0.994,
            baseSize,
            growRate: 3.0 + clampedIntensity * 1.9,
            gravity: {
                x: normal.x * 0.08,
                y: 0.32 + normal.y * 0.24,
                z: normal.z * 0.08,
            },
        };

        this.scene.add(smoke);
        this.nebulaBursts.push(smoke);
    }

    playCrashImpactBang(intensity = 0.5) {
        if (typeof window === 'undefined') return;
        const soundManager = window.app?.soundManager;
        if (!soundManager) return;

        soundManager.playGarbageSend?.();

        if (intensity > 0.72) {
            this.scheduleThemeTimeout(() => {
                soundManager.playDrop?.();
            }, 55);
        }
    }

    createImpactFlash(position, intensity = 0.5) {
        if (!position?.isVector3 || !this.scene) return;

        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.7);
        const material = new THREE.SpriteMaterial({
            map: this.getGlowTexture(),
            color: new THREE.Color().setHSL(0.09, 0.92, 0.68),
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.renderOrder = 1315;

        const startScale = 286 + clampedIntensity * 258;
        const maxScale = startScale * (3.1 + clampedIntensity * 1.12);
        sprite.scale.set(startScale, startScale, 1);

        this.scene.add(sprite);
        this.impactFlashes.push({
            sprite,
            life: 0,
            duration: 0.52 + clampedIntensity * 0.36,
            startScale,
            maxScale,
        });
    }

    updateImpactFlashes(deltaSeconds) {
        if (!this.impactFlashes.length) return;

        const dt = Number.isFinite(deltaSeconds) ? Math.max(0.001, deltaSeconds) : (1 / 60);
        this.impactFlashes = this.impactFlashes.filter((flashData) => {
            flashData.life += dt;
            const progress = flashData.life / flashData.duration;

            if (progress >= 1) {
                this.scene?.remove(flashData.sprite);
                flashData.sprite.material?.dispose?.();
                return false;
            }

            const burstCurve = progress < 0.16
                ? THREE.MathUtils.clamp(progress / 0.16, 0, 1)
                : Math.max(0, 1 - ((progress - 0.16) / 0.84));
            const alphaExponent = progress < 0.16 ? 0.45 : 1.7;
            const alpha = (burstCurve ** alphaExponent) * 1.15;
            const scale = THREE.MathUtils.lerp(
                flashData.startScale,
                flashData.maxScale,
                progress ** 0.58,
            );

            flashData.sprite.material.opacity = alpha;
            flashData.sprite.scale.set(scale, scale, 1);
            return true;
        });
    }

    removeCrashMeteor(meteorData) {
        if (!meteorData) return;

        if (meteorData.trail) {
            this.scene?.remove(meteorData.trail);
        }
        if (meteorData.smokeTrail) {
            this.scene?.remove(meteorData.smokeTrail);
        }
        meteorData.trailGeometry?.dispose?.();
        meteorData.trailMaterial?.dispose?.();
        meteorData.smokeTrailMaterial?.dispose?.();

        if (!meteorData.mesh) return;
        this.scene?.remove(meteorData.mesh);

        if (!meteorData.coreMesh?.userData?.sharedCrashGeom) {
            meteorData.coreMesh?.geometry?.dispose?.();
        }
        meteorData.coreMesh?.material?.dispose?.();
        if (!meteorData.glowMesh?.userData?.sharedCrashGeom) {
            meteorData.glowMesh?.geometry?.dispose?.();
        }
        meteorData.glowMesh?.material?.dispose?.();
        meteorData.tailMesh?.geometry?.dispose?.();
        meteorData.tailMesh?.material?.dispose?.();
        meteorData.plasmaTailMesh?.geometry?.dispose?.();
        meteorData.plasmaTailMesh?.material?.dispose?.();
        meteorData.smokeTailMesh?.geometry?.dispose?.();
        meteorData.smokeTailMesh?.material?.dispose?.();
        if (Array.isArray(meteorData.crustFragments)) {
            meteorData.crustFragments.forEach((fragmentData) => {
                if (!fragmentData.mesh?.userData?.sharedCrashGeom) {
                    fragmentData.mesh?.geometry?.dispose?.();
                }
            });
        }
        meteorData.fragmentMaterialData?.material?.dispose?.();
        if (Array.isArray(meteorData.fireTrailSprites)) {
            meteorData.fireTrailSprites.forEach((spriteData) => {
                spriteData.sprite?.material?.dispose?.();
            });
        }
        if (Array.isArray(meteorData.smokeTrailSprites)) {
            meteorData.smokeTrailSprites.forEach((spriteData) => {
                spriteData.sprite?.material?.dispose?.();
            });
        }
        // Sprite geometries are shared internally; only dispose sprite material.
        meteorData.headFlash?.material?.dispose?.();
    }

    triggerCrashMeteorImpact(meteorData, impactPosition, intensity = 0.45) {
        if (!impactPosition?.isVector3) return;

        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.1, 1.6);
        const explosionScale = 1.4 + clampedIntensity * 0.36;
        const impactPoint = impactPosition.clone();
        impactPoint.z += 20;
        let surfaceNormal = new THREE.Vector3(0, 0, 1);
        if (meteorData?.impactNormal?.isVector3) {
            surfaceNormal = meteorData.impactNormal.clone().normalize();
        } else if (meteorData?.targetOffset?.isVector3) {
            surfaceNormal = meteorData.targetOffset.clone().normalize();
        }
        const incomingDirection = meteorData?.velocity?.isVector3
            ? meteorData.velocity.clone().normalize()
            : surfaceNormal.clone().negate();

        this.createShockwaveRing({
            position: impactPoint,
            scale: (0.86 + clampedIntensity * 1.06) * explosionScale,
            speed: 0.15 + clampedIntensity * 0.1,
            opacity: 0.82 + clampedIntensity * 0.2,
            color: 0xffb173,
        });
        this.createMeteorImpactBurst(impactPoint, clampedIntensity * 1.75, {
            surfaceNormal,
            incomingDirection,
        });
        this.createMeteorImpactShards(impactPoint, surfaceNormal, incomingDirection, clampedIntensity * 1.35);
        this.createMeteorImpactSmokeCloud(impactPoint, surfaceNormal, clampedIntensity * 1.52);
        this.createImpactFlash(impactPoint, clampedIntensity * 2.0);
        if (clampedIntensity > 0.9) {
            this.createShockwaveRing({
                position: impactPoint,
                scale: (0.74 + clampedIntensity * 0.68) * explosionScale,
                speed: 0.19 + clampedIntensity * 0.1,
                opacity: 0.66 + clampedIntensity * 0.25,
                color: 0xffd1a2,
            });
        }
        if (clampedIntensity > 0.55) {
            this.createShockwaveRing({
                position: impactPoint.clone().addScaledVector(surfaceNormal, 8),
                scale: (0.58 + clampedIntensity * 0.52) * explosionScale,
                speed: 0.23 + clampedIntensity * 0.1,
                opacity: 0.56 + clampedIntensity * 0.24,
                color: 0xffe3bf,
            });
        }
        if (clampedIntensity > 0.4) {
            const tangentSeed = Math.abs(surfaceNormal.y) > 0.82 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
            const tangentA = new THREE.Vector3().crossVectors(surfaceNormal, tangentSeed).normalize();
            const tangentB = new THREE.Vector3().crossVectors(surfaceNormal, tangentA).normalize();
            const followupBursts = clampedIntensity > 1.05 ? 3 : 2;

            for (let i = 0; i < followupBursts; i++) {
                this.scheduleThemeTimeout(() => {
                    if (!this.isActive || !this.scene) return;
                    const ringAngle = this.rand() * Math.PI * 2;
                    const lateralRange = 28 + clampedIntensity * 38;
                    const secondaryPoint = impactPoint
                        .clone()
                        .addScaledVector(surfaceNormal, 8 + clampedIntensity * 11 + i * 3)
                        .addScaledVector(tangentA, Math.cos(ringAngle) * lateralRange)
                        .addScaledVector(tangentB, Math.sin(ringAngle) * lateralRange);
                    const burstStrength = clampedIntensity * (0.95 - i * 0.16);

                    this.createMeteorImpactBurst(secondaryPoint, burstStrength, {
                        surfaceNormal,
                        incomingDirection,
                    });
                    this.createMeteorImpactSmokeCloud(secondaryPoint, surfaceNormal, burstStrength * 0.86);
                    this.createImpactFlash(secondaryPoint, burstStrength * 0.86);
                }, 68 + i * 58);
            }
        }
        this.playCrashImpactBang(clampedIntensity);

        this.pushReactiveEnvelope({
            twinkle: 0.26 + clampedIntensity * 0.36,
            dust: 0.22 + clampedIntensity * 0.36,
            bloom: 0.34 + clampedIntensity * 0.52,
            nebula: 0.16 + clampedIntensity * 0.28,
            pulse: 0.24 + clampedIntensity * 0.4,
            glow: 0.22 + clampedIntensity * 0.32,
            ringGlitter: 0.2 + clampedIntensity * 0.4,
            lightning: 0.18 + clampedIntensity * 0.48,
            meteor: 0.54 + clampedIntensity * 1.26,
        });
        this.triggerPlanetLightning(0.28 + clampedIntensity * 0.58);

        const lateral = meteorData?.velocity?.x ?? (this.rand() - 0.5) * 24;
        const vertical = meteorData?.velocity?.y ?? (this.rand() - 0.5) * 18;
        this.triggerCameraPulse(0.54 + clampedIntensity * 0.92, {
            lateralBias: lateral * 0.11,
            verticalBias: vertical * 0.1,
            depthBias: -20 - clampedIntensity * 26,
            rollBias: THREE.MathUtils.clamp(lateral * 0.00035, -0.06, 0.06),
        });
    }

    trySpawnCrashMeteor(intensity = 0.4) {
        if (!this.isActive || !this.scene || !this.planet) return false;
        if (typeof window !== 'undefined' && window.settings?.backgroundComboEffects === false) return false;

        const budgets = this.getReactiveEventBudgets();
        if (this.crashMeteors.length >= (budgets.maxCrashMeteors ?? 3)) return false;

        const targetFrameMs = this.performanceBudget?.targetFrameMs ?? 16.7;
        const frameTimeEmaMs = this.adaptiveScalerState?.frameTimeEmaMs ?? targetFrameMs;
        if (frameTimeEmaMs > targetFrameMs * 1.28 && this.crashMeteors.length > 0) return false;

        const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.15, 1.7);
        const spawnProfile = this.getCrashMeteorSpawnProfile(clampedIntensity);
        const meteorRadius = (6 + clampedIntensity * 4.5 + this.rand() * 2.5) * spawnProfile.radiusScale;
        const geometryCache = this.getCrashMeteorGeometryCache();

        const mesh = new THREE.Group();
        mesh.renderOrder = 1035;

        const coreGeometry = geometryCache.coreTemplates[
            Math.floor(this.rand() * geometryCache.coreTemplates.length)
        ] || geometryCache.coreTemplates[0];
        const coreMaterialData = createStellarMeteorMaterial({ isWebGPU: this.isWebGPU });
        const coreMesh = new THREE.Mesh(coreGeometry, coreMaterialData.material);
        coreMesh.userData.materialData = coreMaterialData;
        coreMesh.userData.sharedCrashGeom = true;
        coreMesh.scale.setScalar(meteorRadius);
        coreMesh.renderOrder = 1037;
        mesh.add(coreMesh);

        const crustFragments = [];
        let fragmentMaterialData = null;
        const fragmentCount = spawnProfile.fragmentCount;
        if (fragmentCount > 0) {
            fragmentMaterialData = createStellarMeteorMaterial({ isWebGPU: this.isWebGPU });
        }
        for (let i = 0; i < fragmentCount; i++) {
            const fragmentRadius = meteorRadius * (0.18 + this.rand() * 0.32);
            const fragmentGeometry = geometryCache.fragmentTemplates[
                Math.floor(this.rand() * geometryCache.fragmentTemplates.length)
            ] || geometryCache.fragmentTemplates[0];
            const fragmentMesh = new THREE.Mesh(fragmentGeometry, fragmentMaterialData.material);
            fragmentMesh.userData.sharedCrashGeom = true;
            fragmentMesh.scale.setScalar(fragmentRadius);
            fragmentMesh.renderOrder = 1037;

            const fragmentDirection = new THREE.Vector3(
                (this.rand() - 0.5) * 1.6,
                (this.rand() - 0.5) * 1.8 + 0.35,
                (this.rand() - 0.5) * 1.6,
            ).normalize();
            fragmentMesh.position.copy(
                fragmentDirection.multiplyScalar(meteorRadius * (0.28 + this.rand() * 0.42)),
            );
            fragmentMesh.rotation.set(
                this.rand() * Math.PI * 2,
                this.rand() * Math.PI * 2,
                this.rand() * Math.PI * 2,
            );
            mesh.add(fragmentMesh);

            crustFragments.push({
                mesh: fragmentMesh,
                materialData: fragmentMaterialData,
                spin: new THREE.Vector3(
                    (this.rand() - 0.5) * 0.2,
                    (this.rand() - 0.5) * 0.22,
                    (this.rand() - 0.5) * 0.18,
                ),
            });
        }

        const glowGeometry = coreGeometry;
        const glowMaterialData = createStellarShootingStarMaterial({
            isWebGPU: this.isWebGPU,
            color: new THREE.Color(0xffbb76),
            opacity: 0.22 + clampedIntensity * 0.16,
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterialData.material);
        glowMesh.userData.materialData = glowMaterialData;
        glowMesh.userData.sharedCrashGeom = true;
        glowMesh.scale.set(
            meteorRadius * (1.14 + clampedIntensity * 0.08),
            meteorRadius * (1.1 + clampedIntensity * 0.06),
            meteorRadius * (1.14 + clampedIntensity * 0.08),
        );
        glowMesh.renderOrder = 1038;
        mesh.add(glowMesh);

        const tailLength = meteorRadius * (8.8 + clampedIntensity * 4.4);
        const tailGeometry = new THREE.CylinderGeometry(
            meteorRadius * (0.18 + clampedIntensity * 0.06),
            meteorRadius * (0.9 + clampedIntensity * 0.16),
            tailLength,
            16,
            1,
            true,
        );
        const tailMaterialData = createStellarShootingStarMaterial({
            isWebGPU: this.isWebGPU,
            color: new THREE.Color(0xff9a4a),
            opacity: 0.14 + clampedIntensity * 0.06,
        });
        const tailMesh = new THREE.Mesh(tailGeometry, tailMaterialData.material);
        tailMesh.userData.materialData = tailMaterialData;
        tailMesh.position.y = -tailLength * 0.46;
        tailMesh.renderOrder = 1033;
        mesh.add(tailMesh);

        const plasmaTailGeometry = new THREE.ConeGeometry(
            meteorRadius * (0.58 + clampedIntensity * 0.1),
            tailLength * 0.86,
            14,
            1,
            true,
        );
        const plasmaTailMaterialData = createStellarShootingStarMaterial({
            isWebGPU: this.isWebGPU,
            color: new THREE.Color(0xffc98a),
            opacity: 0.1 + clampedIntensity * 0.05,
        });
        const plasmaTailMesh = new THREE.Mesh(plasmaTailGeometry, plasmaTailMaterialData.material);
        plasmaTailMesh.userData.materialData = plasmaTailMaterialData;
        plasmaTailMesh.position.y = -tailLength * 0.42;
        plasmaTailMesh.renderOrder = 1034;
        mesh.add(plasmaTailMesh);

        const smokeTailGeometry = new THREE.CylinderGeometry(
            meteorRadius * (0.72 + clampedIntensity * 0.16),
            meteorRadius * (1.56 + clampedIntensity * 0.32),
            tailLength * 1.08,
            14,
            1,
            true,
        );
        const smokeTailMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0x8a6553),
            transparent: true,
            opacity: 0.1 + clampedIntensity * 0.08,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const smokeTailMesh = new THREE.Mesh(smokeTailGeometry, smokeTailMaterial);
        smokeTailMesh.position.y = -tailLength * 0.6;
        smokeTailMesh.renderOrder = 1032;
        mesh.add(smokeTailMesh);

        const headFlashMaterial = new THREE.SpriteMaterial({
            map: this.getGlowTexture(),
            color: new THREE.Color(0xffd0a8),
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const headFlash = new THREE.Sprite(headFlashMaterial);
        const headScale = meteorRadius * (3.0 + clampedIntensity * 0.8);
        headFlash.scale.set(headScale, headScale, 1);
        headFlash.renderOrder = 1040;
        mesh.add(headFlash);

        const fireTrailSprites = [];
        const fireSpriteCount = spawnProfile.fireSpriteCount;
        for (let i = 0; i < fireSpriteCount; i++) {
            const fireMaterial = new THREE.SpriteMaterial({
                map: this.getGlowTexture(),
                color: new THREE.Color().setHSL(0.07 + this.rand() * 0.06, 0.92, 0.62 + this.rand() * 0.1),
                transparent: true,
                opacity: 0.35 + this.rand() * 0.34,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const fireSprite = new THREE.Sprite(fireMaterial);
            fireSprite.renderOrder = 1036;
            mesh.add(fireSprite);
            fireTrailSprites.push({
                sprite: fireSprite,
                lane: i / Math.max(1, fireSpriteCount - 1),
                baseScale: meteorRadius * (0.95 + this.rand() * 1.35),
                swirlRadius: meteorRadius * (0.18 + this.rand() * 0.42),
                phase: this.rand() * Math.PI * 2,
                speed: 1.2 + this.rand() * 2.6,
                opacity: fireMaterial.opacity,
            });
        }

        const smokeTrailSprites = [];
        const smokeSpriteCount = spawnProfile.smokeSpriteCount;
        for (let i = 0; i < smokeSpriteCount; i++) {
            const smokeMaterial = new THREE.SpriteMaterial({
                map: this.getRoundParticleTexture(),
                color: new THREE.Color(0x6b5a50),
                transparent: true,
                opacity: 0.16 + this.rand() * 0.24,
                blending: THREE.NormalBlending,
                depthWrite: false,
            });
            const smokeSprite = new THREE.Sprite(smokeMaterial);
            smokeSprite.renderOrder = 1032;
            mesh.add(smokeSprite);
            smokeTrailSprites.push({
                sprite: smokeSprite,
                lane: i / Math.max(1, smokeSpriteCount - 1),
                baseScale: meteorRadius * (1.8 + this.rand() * 2.4),
                swirlRadius: meteorRadius * (0.34 + this.rand() * 0.6),
                phase: this.rand() * Math.PI * 2,
                speed: 0.5 + this.rand() * 1.6,
                opacity: smokeMaterial.opacity,
            });
        }

        const planetPosition = this.planet.position.clone();
        const impactNormal = new THREE.Vector3(
            (this.rand() - 0.5) * 1.6,
            (this.rand() - 0.5) * 1.4,
            0.22 + (this.rand() - 0.5) * 1.3,
        ).normalize();
        const targetOffset = impactNormal.clone().multiplyScalar(430 + this.rand() * 120);
        const targetPosition = planetPosition.clone().add(targetOffset);

        const approachDirection = this.getCrashMeteorApproachDirection(impactNormal);

        const spawnDistance = 980 + this.rand() * 860;
        const spawnPosition = targetPosition.clone().addScaledVector(approachDirection, spawnDistance);
        const basisUp = Math.abs(approachDirection.y) > 0.82
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 1, 0);
        const tangentA = new THREE.Vector3().crossVectors(approachDirection, basisUp);
        if (tangentA.lengthSq() < 0.0001) tangentA.set(1, 0, 0);
        tangentA.normalize();
        const tangentB = new THREE.Vector3().crossVectors(approachDirection, tangentA).normalize();
        const lateralSpread = spawnDistance * (0.2 + this.rand() * 0.3);
        const verticalSpread = spawnDistance * (0.12 + this.rand() * 0.24);
        spawnPosition
            .addScaledVector(tangentA, (this.rand() - 0.5) * lateralSpread)
            .addScaledVector(tangentB, (this.rand() - 0.5) * verticalSpread)
            .add(new THREE.Vector3(
                (this.rand() - 0.5) * 170,
                (this.rand() - 0.5) * 220,
                (this.rand() - 0.5) * 420,
            ));

        spawnPosition.z = THREE.MathUtils.clamp(spawnPosition.z, -1750, 1250);
        mesh.position.copy(spawnPosition);

        const speed = 560 + clampedIntensity * 430 + this.rand() * 210;
        const initialAim = targetPosition.clone().add(new THREE.Vector3(
            (this.rand() - 0.5) * 240,
            (this.rand() - 0.5) * 240,
            (this.rand() - 0.5) * 170,
        ));
        const velocity = initialAim.sub(spawnPosition).normalize().multiplyScalar(speed);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), velocity.clone().normalize());

        const trailSegments = spawnProfile.trailSegments;
        const trailPositions = new Float32Array(trailSegments * 3);
        const trailColors = new Float32Array(trailSegments * 3);
        for (let i = 0; i < trailSegments; i++) {
            const i3 = i * 3;
            trailPositions[i3] = spawnPosition.x;
            trailPositions[i3 + 1] = spawnPosition.y;
            trailPositions[i3 + 2] = spawnPosition.z;
            const t = i / Math.max(1, trailSegments - 1);
            const fade = (1 - t) ** 1.62;
            trailColors[i3] = fade;
            trailColors[i3 + 1] = 0.58 * fade;
            trailColors[i3 + 2] = 0.16 * fade;
        }

        const trailGeometry = new THREE.BufferGeometry();
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
        const trailUvs = new Float32Array(trailSegments * 2);
        for (let i = 0; i < trailSegments; i++) {
            const i2 = i * 2;
            trailUvs[i2] = 0.5;
            trailUvs[i2 + 1] = 0.5;
        }
        trailGeometry.setAttribute('uv', new THREE.BufferAttribute(trailUvs, 2));
        const trailBaseSize = meteorRadius * (3.0 + clampedIntensity * 1.35);
        const trailMaterial = new THREE.PointsMaterial({
            map: this.getGlowTexture(),
            size: trailBaseSize,
            transparent: true,
            opacity: 0.82 + clampedIntensity * 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
            vertexColors: true,
        });
        const trail = new THREE.Points(trailGeometry, trailMaterial);
        trail.renderOrder = 1031;
        this.scene.add(trail);

        const smokeTrailBaseSize = trailBaseSize * (2.2 + clampedIntensity * 0.5);
        const smokeTrailMaterial = new THREE.PointsMaterial({
            map: this.getRoundParticleTexture(),
            color: new THREE.Color(0x766255),
            size: smokeTrailBaseSize,
            transparent: true,
            opacity: 0.26 + clampedIntensity * 0.12,
            blending: THREE.NormalBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });
        const smokeTrail = new THREE.Points(trailGeometry, smokeTrailMaterial);
        smokeTrail.renderOrder = 1030;
        this.scene.add(smokeTrail);

        const rotationSpeed = new THREE.Vector3(
            (this.rand() - 0.5) * 0.12,
            (this.rand() - 0.5) * 0.14,
            (this.rand() - 0.5) * 0.1,
        );
        const maxLife = 2.55 + this.rand() * 1.05;

        this.scene.add(mesh);
        this.crashMeteors.push({
            mesh,
            coreMesh,
            coreMaterialData,
            crustFragments,
            fragmentMaterialData,
            glowMesh,
            glowMaterialData,
            tailMesh,
            tailMaterialData,
            plasmaTailMesh,
            plasmaTailMaterialData,
            smokeTailMesh,
            smokeTailBaseOpacity: smokeTailMaterial.opacity,
            trail,
            smokeTrail,
            trailGeometry,
            trailMaterial,
            smokeTrailMaterial,
            trailPositions,
            trailSegments,
            trailBaseSize,
            trailBaseOpacity: trailMaterial.opacity,
            smokeTrailBaseSize,
            headFlash,
            headScale,
            fireTrailSprites,
            smokeTrailSprites,
            velocity,
            speed,
            life: maxLife,
            maxLife,
            homing: 0.08 + clampedIntensity * 0.1,
            complexityScale: spawnProfile.complexityScale,
            spriteUpdateStride: spawnProfile.complexityScale < 0.62 ? 2 : 1,
            rotationSpeed,
            targetOffset,
            impactNormal,
            impactRadius: 46 + meteorRadius * 0.74,
            intensity: clampedIntensity,
            pulsePhase: this.rand() * Math.PI * 2,
            meteorRadius,
        });

        return true;
    }

    updateCrashMeteors(deltaSeconds, planetX = 0, planetY = 0) {
        if (!this.crashMeteors.length) return;

        const dt = Number.isFinite(deltaSeconds) ? Math.max(0.001, deltaSeconds) : (1 / 60);
        const dt60 = THREE.MathUtils.clamp(dt * 60, 0.25, 2.6);
        const targetPosition = new THREE.Vector3();
        const desiredVelocity = new THREE.Vector3();
        const velocityDirection = new THREE.Vector3();
        const upAxis = new THREE.Vector3(0, 1, 0);

        this.crashMeteors = this.crashMeteors.filter((meteorData) => {
            meteorData.life -= dt;
            targetPosition.set(planetX, planetY, 0).add(meteorData.targetOffset);

            desiredVelocity.copy(targetPosition).sub(meteorData.mesh.position);
            const distanceToTarget = desiredVelocity.length();

            if (distanceToTarget > 0.0001) {
                desiredVelocity.normalize().multiplyScalar(meteorData.speed * (1 + this.warpSpeed * 0.22));
                const homingLerp = THREE.MathUtils.clamp(meteorData.homing * dt60, 0.03, 0.24);
                meteorData.velocity.lerp(desiredVelocity, homingLerp);
            }

            meteorData.mesh.position.addScaledVector(meteorData.velocity, dt);
            velocityDirection.copy(meteorData.velocity);
            if (velocityDirection.lengthSq() < 0.0001) {
                velocityDirection.copy(targetPosition).sub(meteorData.mesh.position);
            }
            if (velocityDirection.lengthSq() > 0.0001) {
                velocityDirection.normalize();
                meteorData.mesh.quaternion.setFromUnitVectors(upAxis, velocityDirection);
            } else {
                velocityDirection.set(0, 1, 0);
            }

            meteorData.coreMesh.rotation.x += meteorData.rotationSpeed.x * dt60;
            meteorData.coreMesh.rotation.y += meteorData.rotationSpeed.y * dt60;
            meteorData.coreMesh.rotation.z += meteorData.rotationSpeed.z * dt60;
            if (Array.isArray(meteorData.crustFragments)) {
                meteorData.crustFragments.forEach((fragmentData) => {
                    fragmentData.mesh.rotation.x += fragmentData.spin.x * dt60;
                    fragmentData.mesh.rotation.y += fragmentData.spin.y * dt60;
                    fragmentData.mesh.rotation.z += fragmentData.spin.z * dt60;
                });
            }

            const glowUniforms = meteorData.glowMaterialData?.uniforms
                || meteorData.glowMesh?.userData?.materialData?.uniforms
                || meteorData.glowMesh?.material?.uniforms;
            const lifeNorm = THREE.MathUtils.clamp(
                meteorData.life / Math.max(0.001, meteorData.maxLife || 3.2),
                0,
                1,
            );
            const pulse = 0.74 + Math.sin(this.time * 34 + meteorData.pulsePhase) * 0.26;
            if (glowUniforms?.uOpacity) {
                glowUniforms.uOpacity.value = THREE.MathUtils.clamp((0.42 + pulse * 0.46) * lifeNorm, 0, 1);
            } else if (meteorData.glowMesh?.material && 'opacity' in meteorData.glowMesh.material) {
                meteorData.glowMesh.material.opacity = THREE.MathUtils.clamp((0.42 + pulse * 0.46) * lifeNorm, 0, 1);
            }
            const shellScale = 1.08 + pulse * 0.22 + (1 - lifeNorm) * 0.16;
            meteorData.glowMesh.scale.set(shellScale, shellScale, shellScale);

            const tailUniforms = meteorData.tailMaterialData?.uniforms
                || meteorData.tailMesh?.userData?.materialData?.uniforms
                || meteorData.tailMesh?.material?.uniforms;
            const tailOpacity = THREE.MathUtils.clamp(
                (0.06 + pulse * 0.12) * (0.45 + lifeNorm * 0.42),
                0,
                0.26,
            );
            if (tailUniforms?.uOpacity) {
                tailUniforms.uOpacity.value = tailOpacity;
            } else if (meteorData.tailMesh?.material && 'opacity' in meteorData.tailMesh.material) {
                meteorData.tailMesh.material.opacity = tailOpacity;
            }
            const tailScale = 0.96 + pulse * 0.5 + (1 - lifeNorm) * 0.22;
            meteorData.tailMesh.scale.set(tailScale, 1.04 + (1 - lifeNorm) * 0.3, tailScale);

            const plasmaUniforms = meteorData.plasmaTailMaterialData?.uniforms
                || meteorData.plasmaTailMesh?.userData?.materialData?.uniforms
                || meteorData.plasmaTailMesh?.material?.uniforms;
            const plasmaOpacity = THREE.MathUtils.clamp(
                (0.04 + pulse * 0.09) * (0.4 + lifeNorm * 0.36),
                0,
                0.2,
            );
            if (plasmaUniforms?.uOpacity) {
                plasmaUniforms.uOpacity.value = plasmaOpacity;
            } else if (meteorData.plasmaTailMesh?.material && 'opacity' in meteorData.plasmaTailMesh.material) {
                meteorData.plasmaTailMesh.material.opacity = plasmaOpacity;
            }
            const plasmaScale = 0.9 + pulse * 0.34 + (1 - lifeNorm) * 0.2;
            meteorData.plasmaTailMesh.scale.set(plasmaScale, 1.02 + (1 - lifeNorm) * 0.24, plasmaScale);

            if (meteorData.smokeTailMesh?.material && 'opacity' in meteorData.smokeTailMesh.material) {
                meteorData.smokeTailMesh.material.opacity = THREE.MathUtils.clamp(
                    meteorData.smokeTailBaseOpacity * (0.62 + lifeNorm * 0.72),
                    0,
                    0.7,
                );
                const smokeScale = 1.02 + (1 - lifeNorm) * 0.56 + Math.sin(this.time * 3.1 + meteorData.pulsePhase) * 0.06;
                meteorData.smokeTailMesh.scale.set(smokeScale, 1.08 + (1 - lifeNorm) * 0.62, smokeScale);
            }

            if (meteorData.headFlash?.material) {
                meteorData.headFlash.material.opacity = THREE.MathUtils.clamp(0.55 + pulse * 0.45, 0, 1);
                const flashScale = meteorData.headScale * (0.86 + pulse * 0.42);
                meteorData.headFlash.scale.set(flashScale, flashScale, 1);
            }

            if (Array.isArray(meteorData.fireTrailSprites) && meteorData.fireTrailSprites.length > 0) {
                meteorData.fireTrailSprites.forEach((fireData, idx) => {
                    if (meteorData.spriteUpdateStride > 1 && idx % meteorData.spriteUpdateStride !== 0) return;
                    const lane = fireData.lane;
                    const swirl = this.time * (9.2 + fireData.speed * 2.8) + fireData.phase + idx * 0.2;
                    const radius = fireData.swirlRadius * (0.65 + lane * 0.9 + (1 - lifeNorm) * 0.34);
                    const rear = meteorData.meteorRadius * (0.95 + lane * 5.7 + (1 - lifeNorm) * 1.8);
                    const localX = Math.cos(swirl) * radius;
                    const localZ = Math.sin(swirl) * radius * (0.9 + 0.2 * Math.sin(swirl * 0.6));
                    const localY = -rear - Math.sin(swirl * 0.45) * meteorData.meteorRadius * 0.22;

                    fireData.sprite.position.set(localX, localY, localZ);
                    fireData.sprite.material.opacity = THREE.MathUtils.clamp(
                        fireData.opacity * (0.52 + pulse * 0.52) * (0.45 + lifeNorm * 0.72),
                        0,
                        1,
                    );
                    const fireScale = fireData.baseScale
                        * (1.0 + lane * 1.2 + (1 - lifeNorm) * 0.42 + pulse * 0.25);
                    fireData.sprite.scale.set(fireScale, fireScale, 1);
                });
            }

            if (Array.isArray(meteorData.smokeTrailSprites) && meteorData.smokeTrailSprites.length > 0) {
                meteorData.smokeTrailSprites.forEach((smokeData, idx) => {
                    if (meteorData.spriteUpdateStride > 1 && idx % meteorData.spriteUpdateStride !== 0) return;
                    const lane = smokeData.lane;
                    const swirl = this.time * (3.8 + smokeData.speed * 1.9) + smokeData.phase + idx * 0.14;
                    const radius = smokeData.swirlRadius * (0.84 + lane * 1.35 + (1 - lifeNorm) * 0.92);
                    const rear = meteorData.meteorRadius * (2.6 + lane * 9.0 + (1 - lifeNorm) * 4.2);
                    const localX = Math.cos(swirl) * radius;
                    const localZ = Math.sin(swirl) * radius * (0.84 + 0.34 * Math.sin(swirl * 0.4));
                    const localY = -rear - Math.sin(swirl * 0.26) * meteorData.meteorRadius * 0.34;

                    smokeData.sprite.position.set(localX, localY, localZ);
                    smokeData.sprite.material.opacity = THREE.MathUtils.clamp(
                        smokeData.opacity * (0.54 + (1 - lifeNorm) * 0.66) * (0.5 + pulse * 0.28),
                        0,
                        0.7,
                    );
                    const smokeScale = smokeData.baseScale
                        * (1.0 + lane * 2.05 + (1 - lifeNorm) * 1.28 + pulse * 0.14);
                    smokeData.sprite.scale.set(smokeScale, smokeScale, 1);
                });
            }

            if (meteorData.trailPositions && meteorData.trailGeometry?.attributes?.position) {
                const trailPositions = meteorData.trailPositions;
                for (let i = meteorData.trailSegments - 1; i >= 1; i--) {
                    const i3 = i * 3;
                    const prev3 = (i - 1) * 3;
                    trailPositions[i3] = trailPositions[prev3];
                    trailPositions[i3 + 1] = trailPositions[prev3 + 1];
                    trailPositions[i3 + 2] = trailPositions[prev3 + 2];
                }
                const headOffset = meteorData.meteorRadius * 0.42;
                trailPositions[0] = meteorData.mesh.position.x - velocityDirection.x * headOffset;
                trailPositions[1] = meteorData.mesh.position.y - velocityDirection.y * headOffset;
                trailPositions[2] = meteorData.mesh.position.z - velocityDirection.z * headOffset;
                meteorData.trailGeometry.attributes.position.needsUpdate = true;

                if (meteorData.trailMaterial) {
                    meteorData.trailMaterial.opacity = THREE.MathUtils.clamp(
                        meteorData.trailBaseOpacity * (0.54 + pulse * 0.46) * (0.5 + lifeNorm * 0.62),
                        0,
                        1,
                    );
                    meteorData.trailMaterial.size = meteorData.trailBaseSize * (0.88 + pulse * 0.28);
                }
                if (meteorData.smokeTrailMaterial) {
                    meteorData.smokeTrailMaterial.opacity = THREE.MathUtils.clamp(
                        (0.18 + (1 - lifeNorm) * 0.24) * (0.72 + pulse * 0.2),
                        0,
                        0.76,
                    );
                    meteorData.smokeTrailMaterial.size = meteorData.smokeTrailBaseSize * (
                        0.92 + (1 - lifeNorm) * 0.9 + pulse * 0.14
                    );
                }
            }

            const shouldImpact = distanceToTarget <= meteorData.impactRadius;
            const outOfBounds = Math.abs(meteorData.mesh.position.x) > 5200
                || Math.abs(meteorData.mesh.position.y) > 3600
                || meteorData.mesh.position.z < -2600
                || meteorData.mesh.position.z > 1700;

            if (shouldImpact) {
                this.triggerCrashMeteorImpact(meteorData, targetPosition, meteorData.intensity);
                this.removeCrashMeteor(meteorData);
                return false;
            }
            if (meteorData.life <= 0 || outOfBounds) {
                this.removeCrashMeteor(meteorData);
                return false;
            }

            return true;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3D COMBO EFFECTS - Smooth interpolation (no harsh setTimeout)
    // ─────────────────────────────────────────────────────────────────────────

    triggerComboEffect(comboCount) {
        const safeCombo = Number.isFinite(comboCount) ? Math.max(0, comboCount) : 0;
        const comboIntensity = THREE.MathUtils.clamp(safeCombo / 10, 0, 1.5);

        // 1. SHOOTING STARS - More with higher combos (staggered smoothly)
        const starCount = Math.min(safeCombo + 1, 5);
        for (let i = 0; i < starCount; i++) {
            this.scheduleThemeTimeout(() => this.createShootingStar(), i * 150); // Slightly more spread out
        }

        // 1.5. IMPACT METEORS - Dramatic, lower-count crashes inspired by Wolfhour pacing.
        if (safeCombo >= 5) {
            const crashMeteorCount = safeCombo >= 9 ? 2 : 1;
            const extraMeteorChance = safeCombo >= 11 ? 0.85 : 0.62;
            for (let i = 0; i < crashMeteorCount; i++) {
                if (i > 0 && this.rand() > extraMeteorChance) continue;
                this.scheduleThemeTimeout(() => {
                    const jitter = (this.rand() - 0.5) * 0.14;
                    this.trySpawnCrashMeteor(0.34 + comboIntensity * 0.62 + i * 0.06 + jitter);
                }, 110 + i * 280);
            }
        }

        // 2. Unified reactive envelope channels (shared attack/decay curves with hard caps).
        this.pushReactiveEnvelope({
            twinkle: 0.34 + comboIntensity * 0.62,
            dust: 0.08 + comboIntensity * 0.26,
            bloom: 0.14 + comboIntensity * 0.46,
            nebula: 0.22 + comboIntensity * 0.44,
            pulse: 0.24 + comboIntensity * 0.72,
            glow: 0.16 + comboIntensity * 0.36,
            ringGlitter: 0.14 + comboIntensity * 0.52,
            lightning: (safeCombo >= 4 ? 0.12 : 0.04) + comboIntensity * 0.35,
            aurora: (safeCombo >= 5 ? 0.1 : 0.02) + comboIntensity * 0.28,
            comet: (safeCombo >= 6 ? 0.08 : 0.01) + comboIntensity * 0.24,
            meteor: 0.28 + comboIntensity * 1.05,
        });

        // 6. NEBULA PARTICLE BURSTS - ALL nebulas burst simultaneously
        const requestedParticlesPerNebula = (20 + safeCombo * 8) * 10;
        const particlesPerNebula = Math.min(
            requestedParticlesPerNebula,
            this.getBurstParticlesPerNebulaBudget(),
        );
        this.burstAllVisibleNebulas(particlesPerNebula);

        // ═══════════════════════════════════════════════════════════════════════
        // 7. WARP SPEED EFFECTS - Tunnel Vision & Motion Trails
        // The intensity scales with combo count for an escalating rush
        // ═══════════════════════════════════════════════════════════════════════

        if (safeCombo >= 8) {
            // MAXIMUM WARP - Intense tunnel vision, heavy chromatic aberration
            this.targetWarpSpeed = 1.0;
            this.targetFOV = this.baseFOV - 25; // Dramatic narrow FOV
            this.chromaticIntensity = 2.0; // Strong color fringing
            this.radialBlurIntensity = 1.5; // Heavy motion blur
            this.starTrailIntensity = 1.0; // Full star trails
            this.createShockwaveRing(); // Big shockwave
        } else if (safeCombo >= 5) {
            // HIGH WARP - Strong effects
            this.targetWarpSpeed = 0.7;
            this.targetFOV = this.baseFOV - 15;
            this.chromaticIntensity = 1.2;
            this.radialBlurIntensity = 1.0;
            this.starTrailIntensity = 0.7;
        } else if (safeCombo >= 3) {
            // MEDIUM WARP - Noticeable effects
            this.targetWarpSpeed = 0.4;
            this.targetFOV = this.baseFOV - 8;
            this.chromaticIntensity = 0.6;
            this.radialBlurIntensity = 0.5;
            this.starTrailIntensity = 0.4;
        } else {
            // LOW WARP - Subtle hint of speed
            this.targetWarpSpeed = 0.2;
            this.targetFOV = this.baseFOV - 3;
            this.chromaticIntensity = 0.2;
            this.radialBlurIntensity = 0.2;
            this.starTrailIntensity = 0.2;
        }

        if (safeCombo >= 4) {
            this.triggerPlanetLightning(0.22 + comboIntensity * 0.58);
        }

        if (safeCombo >= 5) {
            this.trySpawnReactiveAurora(0.36 + comboIntensity * 0.42);
        }
        if (safeCombo >= 6) {
            this.trySpawnReactiveComet(0.3 + comboIntensity * 0.46);
        }

        // Camera pulse intensity scales with combo and feeds cinematic rig.
        const shakeStrength = Math.min(safeCombo * 3, 25);
        this.triggerCameraPulse(0.2 + comboIntensity * 0.75, {
            lateralBias: (this.rand() - 0.5) * shakeStrength,
            verticalBias: (this.rand() - 0.5) * shakeStrength * 0.8,
            depthBias: -safeCombo * (1.2 + this.rand() * 0.7),
            rollBias: (this.rand() - 0.5) * comboIntensity * 0.03,
        });
    }

    createShootingStar() {
        // Create a 3D shooting star with a trail
        const geometry = new THREE.CylinderGeometry(0, 3, 80, 8);
        const materialData = createStellarShootingStarMaterial({
            isWebGPU: this.isWebGPU,
            color: 0xffffff,
            opacity: 1.0,
        });
        const star = new THREE.Mesh(geometry, materialData.material);
        star.userData.materialData = materialData;

        // Random start position at screen edge
        const side = this.rand();
        if (side < 0.5) {
            // Start from left
            star.position.set(-2500, (this.rand() - 0.5) * 1500, -500 + this.rand() * 500);
            star.userData.velocity = { x: 40 + this.rand() * 20, y: -10 + this.rand() * 20, z: 0 };
        } else {
            // Start from right
            star.position.set(2500, (this.rand() - 0.5) * 1500, -500 + this.rand() * 500);
            star.userData.velocity = { x: -(40 + this.rand() * 20), y: -10 + this.rand() * 20, z: 0 };
        }

        // Rotate to face direction of travel
        star.rotation.z = Math.atan2(star.userData.velocity.y, star.userData.velocity.x) - Math.PI / 2;

        star.userData.life = 1.0;
        this.scene.add(star);
        this.shootingStars.push(star);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        if (!this.isActive) return;

        // Sound set activation handled by theme-linked settings

        this.planetPhaseOffset = this.rand() * Math.PI * 2;
        this.cameraDriftSeed = this.rand() * Math.PI * 2;
        this.cameraSway.set(0, 0, 0);
        this.cameraShake.set(0, 0, 0);
        this.cameraLookOffset.set(0, 0, 0);
        this.cameraLookTarget.set(0, 0, 0);
        this.cameraCurrentLookTarget.set(0, 0, 0);
        this.cameraRollOffset = 0;

        const animate = () => {
            if (!this.isActive) return;

            const measuredDelta = this.clock.getDelta();
            const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : measuredDelta;
            if (this.fixedDeltaSeconds !== null) {
                this.fixedElapsed += rawDelta;
                this.time = this.fixedElapsed * this.simulationTimeScale;
            } else {
                this.time += 0.002;
            }

            this.updateReactiveEnvelope(rawDelta);
            this.qualitySyncAccumulator += rawDelta;
            if (this.qualitySyncAccumulator >= 1.0) {
                this.qualitySyncAccumulator = 0;
                const runtimeQuality = this.getCurrentQualityLevel();
                if (runtimeQuality !== this.activeQualityLevel) {
                    this.applyRuntimeQualityProfile(runtimeQuality);
                }
            }

            const planetUniforms = this.planetMaterialData?.uniforms || this.planet?.material?.uniforms;
            if (planetUniforms?.uTime) {
                planetUniforms.uTime.value = this.time;
            }
            if (planetUniforms?.uBandIntensity) {
                planetUniforms.uBandIntensity.value = 0.38 + this.nebulaPulse * 0.24;
            }
            if (planetUniforms?.uScatterIntensity) {
                planetUniforms.uScatterIntensity.value = 0.34 + this.auroraPulse * 0.36;
            }
            if (planetUniforms?.uLightningFlash) {
                planetUniforms.uLightningFlash.value = this.planetLightningIntensity;
            }

            // Nebula drift/uniform updates are handled in the dedicated
            // "Update Nebula Uniforms" block later in this frame.

            // Update Orbiting Particles Shader (REMOVED)
            // if (this.orbitingParticles?.material?.uniforms) {
            //     this.orbitingParticles.material.uniforms.uTime.value = this.time;
            // }

            // ═══════════════════════════════════════════════════════════════════════
            // WARP SPEED STATE UPDATE - Smooth interpolation and decay
            // ═══════════════════════════════════════════════════════════════════════

            // Smooth warp speed interpolation
            this.warpSpeed += (this.targetWarpSpeed - this.warpSpeed) * 0.08;
            if (this.targetWarpSpeed < 0.01) {
                this.targetWarpSpeed = 0;
            }

            // Decay warp target over time (auto-return to normal)
            this.targetWarpSpeed *= 0.985;

            // Smooth FOV interpolation (tunnel vision effect)
            this.currentFOV += (this.targetFOV - this.currentFOV) * 0.06;
            if (Math.abs(this.targetFOV - this.baseFOV) > 0.01) {
                // Auto-return FOV to base when not in warp
                this.targetFOV += (this.baseFOV - this.targetFOV) * 0.015;
            }

            // Update camera FOV
            if (this.camera && Math.abs(this.camera.fov - this.currentFOV) > 0.1) {
                this.camera.fov = this.currentFOV;
                this.camera.updateProjectionMatrix();
            }

            // Decay chromatic aberration and radial blur
            this.chromaticIntensity *= 0.93;
            this.radialBlurIntensity *= 0.92;
            this.starTrailIntensity *= 0.94;
            if (this.chromaticIntensity < 0.01) this.chromaticIntensity = 0;
            if (this.radialBlurIntensity < 0.01) this.radialBlurIntensity = 0;
            if (this.starTrailIntensity < 0.01) this.starTrailIntensity = 0;

            // PLANET DRIFT: Move planet to different screen positions
            let planetX = 0;
            let planetY = 0;
            if (this.planet) {
                this.planet.rotation.y += 0.001; // Visible spin

                // Large orbit so planet appears on different sides of the screen
                // Use phase offset for random starting position
                planetX = Math.sin(this.time * 0.03 + this.planetPhaseOffset) * 600;
                planetY = Math.cos(this.time * 0.025 + this.planetPhaseOffset) * 350;
                this.planet.position.x = planetX;
                this.planet.position.y = planetY;

                // Also move the glow planes with the planet
                if (this.smallGlow) {
                    this.smallGlow.position.x = planetX;
                    this.smallGlow.position.y = planetY;
                }
                if (this.bigGlow) {
                    this.bigGlow.position.x = planetX;
                    this.bigGlow.position.y = planetY;
                }
                if (this.heroRingSystem) {
                    this.heroRingSystem.position.x = planetX;
                    this.heroRingSystem.position.y = planetY;
                    this.heroRingSystem.rotation.z += 0.00035;
                }
            }

            this.updateCinematicCamera(rawDelta, planetX, planetY);
            this.updateCinematicLighting(planetX, planetY);
            const cameraX = this.camera?.position?.x ?? this.cameraBasePosition.x;
            const cameraY = this.camera?.position?.y ?? this.cameraBasePosition.y;
            const cameraZ = this.camera?.position?.z ?? this.cameraBasePosition.z;

            // Keep secondary composition anchored away from the hero-planet corridor.
            this.secondaryBodies.forEach((bodyData) => {
                const phase = this.time * bodyData.driftSpeed + bodyData.driftPhase;
                let nextX = bodyData.basePosition.x + Math.sin(phase) * bodyData.driftX;
                nextX = this.enforceFocalCorridor(nextX, planetX, bodyData.focalSide);
                const nextY = bodyData.basePosition.y + Math.cos(phase * 0.8) * bodyData.driftY;
                const nextZ = bodyData.basePosition.z + Math.sin(phase * 0.6) * bodyData.driftZ;

                bodyData.mesh.position.set(nextX, nextY, nextZ);
                bodyData.mesh.rotation.y += bodyData.rotationSpeed;
                bodyData.mesh.rotation.x += bodyData.rotationSpeed * 0.35;
            });

            this.depthHazeLayers.forEach((haze) => {
                const phase = this.time * haze.driftSpeed + haze.driftPhase;
                const parallaxX = (cameraX - this.cameraBasePosition.x) * haze.parallaxFactor;
                const parallaxY = (cameraY - this.cameraBasePosition.y) * haze.parallaxFactor * 0.8;
                const parallaxZ = (cameraZ - this.cameraBasePosition.z) * haze.parallaxFactor * 0.3;
                let nextX = haze.basePosition.x + parallaxX + Math.sin(phase) * haze.driftRange;
                nextX = this.enforceFocalCorridor(nextX, planetX, haze.focalSide);
                const nextY = haze.basePosition.y
                    + parallaxY
                    + Math.cos(phase * 0.8) * (haze.driftRange * 0.18);
                const nextZ = haze.basePosition.z
                    + parallaxZ
                    + Math.sin(phase * 0.55) * (haze.driftRange * 0.22);

                haze.mesh.position.x = nextX;
                haze.mesh.position.y = nextY;
                haze.mesh.position.z = nextZ;
                haze.mesh.rotation.z = haze.mesh.userData.baseRotation
                    + Math.sin(this.time * haze.mesh.userData.rotationSpeed + haze.mesh.userData.flowSeed)
                        * haze.mesh.userData.rotationAmplitude;

                const hazeUniforms = haze.mesh.userData?.materialData?.uniforms || haze.mesh.material?.uniforms;
                if (hazeUniforms?.uTime) {
                    hazeUniforms.uTime.value = this.time * 0.7;
                }
                if (hazeUniforms?.uPulse) {
                    const hazePulse = Math.sin(this.time * 0.22 + haze.mesh.userData.flowSeed) * 0.04;
                    hazeUniforms.uPulse.value = this.nebulaPulse * haze.mesh.userData.pulseScale * 0.45 + hazePulse;
                }
                if (hazeUniforms?.uEmissiveGain) {
                    hazeUniforms.uEmissiveGain.value = haze.mesh.userData.baseEmissiveGain
                        * (1 + this.nebulaBoostIntensity * 0.18);
                }
                if (hazeUniforms?.uFlowStrength) {
                    hazeUniforms.uFlowStrength.value = haze.mesh.userData.baseFlowStrength
                        * (1 + this.nebulaPulse * 0.18 + this.nebulaBoostIntensity * 0.08);
                }
                if (hazeUniforms?.uDetailStrength) {
                    hazeUniforms.uDetailStrength.value = haze.mesh.userData.baseDetailStrength
                        * (1 + this.nebulaPulse * 0.06);
                }
                if (hazeUniforms?.uDensityThreshold) {
                    hazeUniforms.uDensityThreshold.value = THREE.MathUtils.clamp(
                        haze.mesh.userData.baseDensityThreshold - this.nebulaPulse * 0.01,
                        0.36,
                        0.78,
                    );
                }
                if (hazeUniforms?.uOpacity) {
                    hazeUniforms.uOpacity.value = haze.mesh.userData.baseOpacity
                        * (0.98 + this.nebulaBoostIntensity * 0.03);
                }
            });

            // ─────────────────────────────────────────────────────────────────
            // DYNAMIC METEOR ACTIVITY
            // Speed multiplier: 1.0 (base) up to ~5.0 (fastest, was ~8.5)
            const speedMultiplier = 1.0 + (this.meteorActivity * 0.8);

            // Move meteors (Rotate around PLANET position)
            if (this.meteorInstancedMesh && this.meteors.length > 0) {
                const meteorDummy = this.meteorMatrixDummy || (this.meteorMatrixDummy = new THREE.Object3D());
                for (let i = 0; i < this.meteors.length; i++) {
                    const m = this.meteors[i];

                    // Orbital rotation
                    m.angle += m.speed * speedMultiplier;

                    // Update position relative to planet's current position
                    const x = planetX + Math.sin(m.angle) * m.radius;
                    const z = Math.cos(m.angle) * m.radius;
                    const y = planetY + m.yBase + Math.sin(m.angle * 2.0 + this.time) * 10;

                    // Tumble rotation
                    m.rotation.x -= m.rotationSpeed.x * speedMultiplier;
                    m.rotation.y -= m.rotationSpeed.y * speedMultiplier;
                    m.rotation.z -= m.rotationSpeed.z * speedMultiplier;

                    meteorDummy.position.set(x, y, z);
                    meteorDummy.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
                    meteorDummy.scale.setScalar(m.scale);
                    meteorDummy.updateMatrix();
                    this.meteorInstancedMesh.setMatrixAt(i, meteorDummy.matrix);
                }
                this.meteorInstancedMesh.instanceMatrix.needsUpdate = true;
            }

            // Combo-spawned crash meteors home into the hero planet and impact.
            this.updateCrashMeteors(rawDelta, planetX, planetY);
            this.updateImpactFlashes(rawDelta);

            // Animate ambient particles (very gentle drift - reduced speed to prevent jitter)
            if (this.ambientParticles) {
                if (!this.ambientParticleCompute?.computeNode) {
                    const positions = this.ambientParticles.geometry.attributes.position.array;
                    for (let i = 0; i < positions.length; i += 3) {
                        positions[i] += 0.01; // Much slower drift
                        if (positions[i] > 2000) positions[i] = -2000; // Wrap around
                    }
                    this.ambientParticles.geometry.attributes.position.needsUpdate = true;
                }

                const ambientUniforms = this.ambientParticlesMaterialData?.uniforms
                    || this.ambientParticles.userData?.materialData?.uniforms
                    || this.ambientParticles.material?.uniforms;
                if (ambientUniforms?.uTime) {
                    ambientUniforms.uTime.value = this.time;
                }
            }

            // Starfield twinkling
            const starfieldUniforms = this.starfieldMaterialData?.uniforms || this.starfield?.material?.uniforms;
            if (this.starfield && starfieldUniforms) {
                if (starfieldUniforms.uTime) {
                    starfieldUniforms.uTime.value = this.time;
                }
                if (starfieldUniforms.uEventBoost) {
                    starfieldUniforms.uEventBoost.value = this.starTwinkleIntensity;
                }
                if (starfieldUniforms.uWarpSpeed) {
                    starfieldUniforms.uWarpSpeed.value = Math.min(
                        1.25,
                        (this.starTrailIntensity + this.reactiveState.comet * 0.25)
                        * (this.adaptiveScalerState?.effectScale ?? 1),
                    );
                }

                this.starfield.rotation.y = Math.sin(this.time * 0.02 + this.cameraDriftSeed) * 0.08
                    + cameraX * 0.00006;
                this.starfield.rotation.x = Math.cos(this.time * 0.015 + this.cameraDriftSeed * 0.5) * 0.045;
            }

            // SMOOTH DUST RING PULSE - Gradual scale decay
            if (this.dustRing) {
                const scale = 1 + this.dustRingPulse;
                this.dustRing.scale.set(scale, scale, scale);
                const dustUniforms = this.dustRingMaterialData?.uniforms
                    || this.dustRing.userData?.materialData?.uniforms
                    || this.dustRing.material?.uniforms;
                if (dustUniforms?.uPulse) {
                    dustUniforms.uPulse.value = this.dustRingPulse;
                }
            }

            this.heroRingMaterialData.forEach((materialData) => {
                const uniforms = materialData?.uniforms;
                if (!uniforms) return;
                if (uniforms.uTime) {
                    uniforms.uTime.value = this.time;
                }
                if (uniforms.uGlitter) {
                    uniforms.uGlitter.value = this.heroRingGlitterIntensity;
                }
            });

            // SMOOTH BLOOM PULSE - Gradual bloom decay (boosted during warp)
            const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
            const warpBloomBoost = this.warpSpeed * 0.1 + this.reactiveState.comet * 0.06;
            const nebulaBloomBoost = this.nebulaBoostIntensity * 0.05;
            const dynamicBloomStrength = this.qualityPreset.bloomStrength
                * (1 + this.bloomPulseIntensity + warpBloomBoost + nebulaBloomBoost)
                * effectScale;
            const bloomThreshold = THREE.MathUtils.clamp(
                0.67 - this.nebulaBoostIntensity * 0.015,
                0.63,
                0.67,
            );

            if (this.bloomPass) {
                this.bloomPass.strength = dynamicBloomStrength;
                this.bloomPass.threshold = bloomThreshold;
            }
            if (this.colorGradePass) {
                this.colorGradePass.uniforms.exposure.value = 0.96;
                this.colorGradePass.uniforms.contrast.value = 1.12;
                this.colorGradePass.uniforms.saturation.value = 1.02;
            }

            // ═══════════════════════════════════════════════════════════════════════
            // WARP POST-PROCESSING EFFECTS - Tunnel Vision & Motion Trails
            // ═══════════════════════════════════════════════════════════════════════

            // Dynamic Vignette (tunnel vision - darker edges during warp)
            if (this.vignettePass) {
                const baseDarkness = 0.4;
                const warpDarkness = this.warpSpeed * 0.5; // Up to 0.9 total at max warp
                this.vignettePass.uniforms.darkness.value = baseDarkness + warpDarkness;

                // Tighten the vignette offset for more tunnel effect
                const baseOffset = 1.1;
                const warpOffset = this.warpSpeed * 0.3; // Smaller offset = tighter tunnel
                this.vignettePass.uniforms.offset.value = baseOffset - warpOffset;
            }

            // Chromatic Aberration (color fringing at edges)
            if (this.chromaticPass) {
                this.chromaticPass.uniforms.intensity.value = this.chromaticIntensity;
            }

            // Radial Speed Lines (motion blur / zoom effect)
            if (this.radialSpeedPass) {
                this.radialSpeedPass.uniforms.intensity.value = this.radialBlurIntensity;
                this.radialSpeedPass.uniforms.time.value = this.time * 50; // Fast animation
            }

            if (this.isWebGPU && this.postProcessing?.update) {
                const baseDarkness = 0.4;
                const warpDarkness = this.warpSpeed * 0.5;
                const baseOffset = 1.1;
                const warpOffset = this.warpSpeed * 0.3;
                const chromaticStrength = Math.min(this.chromaticIntensity * 0.0035 * effectScale, 0.01);
                const speedLineIntensity = Math.min(this.radialBlurIntensity * 0.35 * effectScale, 0.75);

                this.postProcessing.update({
                    bloomStrength: dynamicBloomStrength,
                    bloomRadius: this.qualityPreset.bloomRadius,
                    bloomThreshold,
                    chromaticStrength,
                    vignetteDarkness: baseDarkness + warpDarkness,
                    vignetteOffset: baseOffset - warpOffset,
                    speedLineIntensity,
                    time: this.time * 50,
                    exposure: 0.96,
                    contrast: 1.12,
                    saturation: 1.02,
                });
            }

            // Update Nebula Uniforms (Pulse + Time)
            this.nebulaClouds.forEach((cloud) => {
                cloud.userData.driftOffset += cloud.userData.driftSpeed * 50;
                if (cloud.userData.driftOffset > cloud.userData.wrapBoundary) {
                    cloud.userData.driftOffset = -cloud.userData.wrapBoundary;
                }

                cloud.position.x = cameraX * 0.3
                    + cloud.userData.driftOffset
                    + cloud.userData.massOffsetX;
                cloud.position.y = cameraY * 0.2 + cloud.userData.massOffsetY;
                cloud.position.z = cloud.userData.baseZ;
                cloud.userData.pulsePhase += 0.005;

                const nebulaUniforms = cloud.userData?.materialData?.uniforms || cloud.material?.uniforms;
                if (!nebulaUniforms) return;

                if (nebulaUniforms.uTime) {
                    nebulaUniforms.uTime.value = this.time;
                }
                if (nebulaUniforms.uPulse) {
                    nebulaUniforms.uPulse.value = Math.sin(cloud.userData.pulsePhase)
                        + this.nebulaPulse * 2.0 * cloud.userData.pulseScale;
                }
            });

            // DYNAMIC PLANET GLOW COLOR
            // Matches the shader's hue shift (speed 0.05)
            // Base Mars Hue: ~20 degrees (0.05 turn)
            const hueShift = (this.time * 0.05) / (Math.PI * 2); // Convert rad to turns
            const currentHue = (0.05 + hueShift) % 1.0;

            if (this.smallGlow) {
                const glowScale = 1 + this.glowSurgeIntensity;
                this.smallGlow.scale.set(glowScale, glowScale, 1);
                const glowMaterialData = this.smallGlow.userData?.materialData;
                if (glowMaterialData?.uniforms?.uColor?.value?.setHSL) {
                    glowMaterialData.uniforms.uColor.value.setHSL(currentHue, 0.9, 0.6);
                } else if (this.smallGlow.material?.color?.setHSL) {
                    this.smallGlow.material.color.setHSL(currentHue, 0.9, 0.6);
                }
            }
            if (this.bigGlow) {
                const bigScale = 1 + this.glowSurgeIntensity * 0.5;
                this.bigGlow.scale.set(bigScale, bigScale, 1);
                const glowMaterialData = this.bigGlow.userData?.materialData;
                if (glowMaterialData?.uniforms?.uColor?.value?.setHSL) {
                    glowMaterialData.uniforms.uColor.value.setHSL(currentHue, 0.8, 0.5);
                } else if (this.bigGlow.material?.color?.setHSL) {
                    this.bigGlow.material.color.setHSL(currentHue, 0.8, 0.5);
                }
            }

            if (planetUniforms?.uPulse) {
                planetUniforms.uPulse.value = this.glowSurgeIntensity;
            }

            // Aurora ribbons are budget-gated and fade with deterministic decay.
            this.auroraEvents = this.auroraEvents.filter((aurora) => {
                aurora.life -= rawDelta * aurora.decayRate;
                if (aurora.life <= 0) {
                    this.scene.remove(aurora.mesh);
                    const auroraUniforms = aurora.mesh.userData?.materialData?.uniforms
                        || aurora.mesh.material?.uniforms;
                    const auroraTexture = auroraUniforms?.uMap?.value
                        || auroraUniforms?.tDiffuse?.value
                        || aurora.mesh.material?.map;
                    auroraTexture?.dispose?.();
                    aurora.mesh.geometry.dispose();
                    aurora.mesh.material.dispose();
                    return false;
                }

                aurora.mesh.position.x += aurora.driftX * rawDelta * 60;
                aurora.mesh.position.y += Math.sin(this.time * aurora.bobSpeed + aurora.bobPhase)
                    * aurora.bobAmplitude * rawDelta;

                const auroraUniforms = aurora.mesh.userData?.materialData?.uniforms
                    || aurora.mesh.material?.uniforms;
                if (auroraUniforms?.uTime) {
                    auroraUniforms.uTime.value = this.time * 0.6 + aurora.bobPhase;
                }
                const lifePulse = Math.sin(Math.max(0, aurora.life) * Math.PI);
                if (auroraUniforms?.uPulse) {
                    auroraUniforms.uPulse.value = lifePulse * aurora.pulseGain + this.auroraPulse * 0.35;
                }
                if (auroraUniforms?.uOpacity) {
                    auroraUniforms.uOpacity.value = aurora.baseOpacity
                        * (0.55 + lifePulse * 0.65 + this.auroraPulse * 0.2);
                } else if (aurora.mesh.material && 'opacity' in aurora.mesh.material) {
                    aurora.mesh.material.opacity = aurora.baseOpacity
                        * (0.55 + lifePulse * 0.65 + this.auroraPulse * 0.2);
                }

                return true;
            });

            // Comets add punctuation at higher combos while staying capped by budgets.
            this.cometEvents = this.cometEvents.filter((comet) => {
                const velocity = comet.userData.velocity;
                const deltaScale = rawDelta * 60;
                comet.position.x += velocity.x * deltaScale;
                comet.position.y += velocity.y * deltaScale;
                comet.position.z += velocity.z * deltaScale;
                comet.userData.life -= rawDelta * comet.userData.decay;

                const cometMaterialData = comet.userData?.materialData;
                const cometUniforms = cometMaterialData?.uniforms || comet.material?.uniforms;
                const clampedLife = Math.max(0, comet.userData.life);
                if (cometUniforms?.uOpacity) {
                    cometUniforms.uOpacity.value = clampedLife;
                } else if (comet.material && 'opacity' in comet.material) {
                    comet.material.opacity = clampedLife;
                }

                const outOfBounds = Math.abs(comet.position.x) > 3800 || comet.position.z > 1600;
                if (clampedLife <= 0 || outOfBounds) {
                    this.scene.remove(comet);
                    comet.geometry.dispose();
                    comet.material.dispose();
                    return false;
                }
                return true;
            });

            // Animate shockwave rings (if any exist)
            this.shockwaveRings = this.shockwaveRings.filter((ring) => {
                ring.scale.x += ring.userData.speed;
                ring.scale.y += ring.userData.speed;
                const ringMaterialData = ring.userData?.materialData;
                const ringUniforms = ringMaterialData?.uniforms || ring.material?.uniforms;
                const currentOpacity = ringUniforms?.uOpacity
                    ? ringUniforms.uOpacity.value
                    : ring.material.opacity;
                const nextOpacity = currentOpacity - 0.015;

                if (ringUniforms?.uOpacity) {
                    ringUniforms.uOpacity.value = nextOpacity;
                } else {
                    ring.material.opacity = nextOpacity;
                }

                if (nextOpacity <= 0) {
                    this.scene.remove(ring);
                    ring.geometry.dispose();
                    ring.material.dispose();
                    return false;
                }
                return true;
            });

            // Animate shooting stars (if any exist)
            this.shootingStars = this.shootingStars.filter((star) => {
                star.position.x += star.userData.velocity.x;
                star.position.y += star.userData.velocity.y;
                star.position.z += star.userData.velocity.z;
                star.userData.life -= 0.015; // Slower fade for smoother effect
                const starMaterialData = star.userData?.materialData;
                const starUniforms = starMaterialData?.uniforms || star.material?.uniforms;
                if (starUniforms?.uOpacity) {
                    starUniforms.uOpacity.value = star.userData.life;
                } else {
                    star.material.opacity = star.userData.life;
                }
                if (star.userData.life <= 0) {
                    this.scene.remove(star);
                    star.geometry.dispose();
                    star.material.dispose();
                    return false;
                }
                return true;
            });

            // Animate nebula particle bursts
            this.nebulaBursts = this.nebulaBursts.filter((burst) => {
                const positions = burst.geometry.attributes.position.array;
                const { velocities } = burst.userData;
                const deltaScale = THREE.MathUtils.clamp(rawDelta * 60, 0.35, 2.4);
                const gravity = burst.userData.gravity ?? null;
                const drag = Number.isFinite(burst.userData.drag) ? burst.userData.drag : null;

                // Move particles
                for (let j = 0; j < velocities.length; j++) {
                    if (gravity) {
                        velocities[j].x += gravity.x * deltaScale;
                        velocities[j].y += gravity.y * deltaScale;
                        velocities[j].z += gravity.z * deltaScale;
                    }
                    if (drag) {
                        const dragScale = drag ** deltaScale;
                        velocities[j].x *= dragScale;
                        velocities[j].y *= dragScale;
                        velocities[j].z *= dragScale;
                    }

                    positions[j * 3] += velocities[j].x * deltaScale;
                    positions[j * 3 + 1] += velocities[j].y * deltaScale;
                    positions[j * 3 + 2] += velocities[j].z * deltaScale;
                }
                burst.geometry.attributes.position.needsUpdate = true;

                // Fade out
                const decay = Number.isFinite(burst.userData.decay) ? burst.userData.decay : 0.02;
                burst.userData.life -= decay * deltaScale;
                const lifeNorm = Math.max(0, burst.userData.life / Math.max(0.0001, burst.userData.maxLife || 1));

                if (
                    burst.material
                    && 'size' in burst.material
                    && Number.isFinite(burst.userData.baseSize)
                ) {
                    const growRate = Number.isFinite(burst.userData.growRate) ? burst.userData.growRate : 0;
                    burst.material.size = burst.userData.baseSize * (1 + (1 - lifeNorm) * growRate);
                }

                burst.material.opacity = lifeNorm;

                // Cleanup
                if (burst.userData.life <= 0) {
                    this.scene.remove(burst);
                    burst.geometry.dispose();
                    burst.material.dispose();
                    return false;
                }
                return true;
            });

            this.updateAdaptiveScaler(rawDelta * 1000);
            this.updateComputeSystems(rawDelta);
            this.renderFrame();

            if (this.flags.baseline) {
                this.trackBaselineFrame(measuredDelta);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;
        const nowMs = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

        if (this.isWebGPU) {
            if (this.capabilities.post && this.postProcessing?.render) {
                try {
                    const postStart = nowMs();
                    this.postProcessing.render();
                    this.lastPostCostMs = nowMs() - postStart;
                    this.lastRenderPath = 'webgpu-post';
                    return;
                } catch (error) {
                    console.warn('[StellarDrift] WebGPU post render failed. Falling back:', error);
                    this.capabilities.post = false;
                    this.flags.usePost = false;
                    this.disposePostProcessingStack();
                    this.configureRendererColorPipeline();
                }
            }

            try {
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
                this.lastPostCostMs = 0;
                this.lastRenderPath = 'webgpu-direct';
            } catch (error) {
                void this.requestWebGLFallback('webgpu-render-failure', error);
            }
            return;
        }

        if (this.composer && this.qualityPreset.enablePostProcessing && this.capabilities.post) {
            try {
                const postStart = nowMs();
                this.renderer.clear();
                this.composer.render();
                this.lastPostCostMs = nowMs() - postStart;
                this.lastRenderPath = 'webgl-composer';
                return;
            } catch (error) {
                console.warn('[StellarDrift] WebGL composer render failed. Falling back to direct render:', error);
                this.capabilities.post = false;
                this.flags.usePost = false;
                this.disposePostProcessingStack();
                this.configureRendererColorPipeline();
            }
        }

        try {
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            this.lastPostCostMs = 0;
            this.lastRenderPath = 'webgl-direct';
        } catch (error) {
            console.error('[StellarDrift] Render failed:', error);
        }
    }

    trackBaselineFrame(deltaSeconds) {
        const frameMs = deltaSeconds * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }

        const renderInfo = this.renderer?.info?.render;
        if (renderInfo) {
            this.baselineRenderStats.push({
                calls: renderInfo.calls || 0,
                triangles: renderInfo.triangles || 0,
                lines: renderInfo.lines || 0,
                points: renderInfo.points || 0,
            });
            if (this.baselineRenderStats.length > this.baselineMaxFrames) {
                this.baselineRenderStats.shift();
            }
        }
    }

    resetBaseline() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
    }

    reportBaseline() {
        if (!this.baselineFrames.length) {
            console.log('[StellarBaseline] No frames collected yet.');
            return null;
        }

        const sortedFrames = [...this.baselineFrames].sort((a, b) => a - b);
        const frameCount = this.baselineFrames.length;
        const avgMs = this.baselineFrames.reduce((sum, v) => sum + v, 0) / frameCount;
        const avgFps = 1000 / avgMs;
        const varianceMs2 = this.baselineFrames.reduce((sum, frameMs) => {
            const diff = frameMs - avgMs;
            return sum + diff * diff;
        }, 0) / frameCount;
        const stdDevMs = Math.sqrt(varianceMs2);
        const p99Index = Math.max(0, Math.floor(sortedFrames.length * 0.99) - 1);
        const p99Ms = sortedFrames[p99Index];
        const low1Fps = 1000 / p99Ms;
        const renderSamples = this.baselineRenderStats.length || 1;
        const totals = this.baselineRenderStats.reduce((acc, s) => {
            acc.calls += s.calls;
            acc.triangles += s.triangles;
            acc.lines += s.lines;
            acc.points += s.points;
            return acc;
        }, {
            calls: 0,
            triangles: 0,
            lines: 0,
            points: 0,
        });

        const memoryInfo = this.renderer?.info?.memory || {};
        const heapMb = (typeof performance !== 'undefined' && performance.memory?.usedJSHeapSize)
            ? performance.memory.usedJSHeapSize / (1024 * 1024)
            : null;
        const gpuEstimateMb = (memoryInfo.textures !== undefined || memoryInfo.geometries !== undefined)
            ? Number((((memoryInfo.textures ?? 0) * 1.5) + ((memoryInfo.geometries ?? 0) * 0.25)).toFixed(1))
            : null;

        const report = {
            backend: this.getBackendLabel(),
            preset: this.getCurrentQualityLevel(),
            frames: frameCount,
            avgFps: Number(avgFps.toFixed(1)),
            p99Ms: Number(p99Ms.toFixed(2)),
            low1Fps: Number(low1Fps.toFixed(1)),
            frameTimeStdDevMs: Number(stdDevMs.toFixed(3)),
            frameTimeVarianceMs2: Number(varianceMs2.toFixed(4)),
            avgDrawCalls: Number((totals.calls / renderSamples).toFixed(1)),
            avgTriangles: Number((totals.triangles / renderSamples).toFixed(0)),
            avgLines: Number((totals.lines / renderSamples).toFixed(0)),
            avgPoints: Number((totals.points / renderSamples).toFixed(0)),
            textures: memoryInfo.textures ?? null,
            geometries: memoryInfo.geometries ?? null,
            gpuMemoryEstimateMb: gpuEstimateMb,
            heapUsedMb: heapMb !== null ? Number(heapMb.toFixed(1)) : null,
            capabilities: { ...this.capabilities },
            flags: { ...this.flags },
            sequence: { ...this.baselineSequenceStats },
        };

        console.log('[StellarBaseline] Report:', report);
        return report;
    }

    captureBaseline(label = 'stellar') {
        if (!this.renderer?.domElement) {
            console.warn('[StellarBaseline] No renderer canvas available.');
            return;
        }

        const canvas = this.renderer.domElement;
        const name = `${label}-${this.getBackendSlug()}-${Date.now()}.png`;
        if (canvas.toBlob) {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                link.click();
                URL.revokeObjectURL(url);
            });
        } else {
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = name;
            link.click();
        }
    }

    clearBaselinePlaybackTimers() {
        this.baselineTimeouts.forEach((id) => {
            clearTimeout(id);
            this.themeTimeouts.delete(id);
        });
        this.baselineTimeouts.clear();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
    }

    scheduleBaselineTimeout(callback, delayMs) {
        let timeoutId = null;
        timeoutId = this.scheduleThemeTimeout(() => {
            this.baselineTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        if (timeoutId !== null) {
            this.baselineTimeouts.add(timeoutId);
        }
        return timeoutId;
    }

    waitForBaseline(delayMs) {
        return new Promise((resolve) => {
            this.scheduleBaselineTimeout(resolve, delayMs);
        });
    }

    getBaselineSequence(name = 'default') {
        const sequences = {
            default: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 2 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 4 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
            ],
            stress: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 5 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 8 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 10 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.COMBO, payload: { comboCount: 12 } },
            ],
        };
        return sequences[name] || sequences.default;
    }

    getBaselineSequenceDurationMs(name = 'default', loops = 1, stepMs = 320) {
        const sequence = this.getBaselineSequence(name);
        return sequence.length * loops * stepMs + 50;
    }

    playBaselineSequence(name = 'default', options = {}) {
        if (typeof window === 'undefined') return false;

        const sequence = this.getBaselineSequence(name);
        const loops = Number.isFinite(options.loops) && options.loops > 0
            ? Math.floor(options.loops)
            : this.flags.playbackLoops;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0
            ? options.stepMs
            : 320;

        this.clearBaselinePlaybackTimers();
        this.baselineSequenceStats = {
            sequence: name,
            loops,
            startedAt: Date.now(),
        };

        for (let loop = 0; loop < loops; loop++) {
            sequence.forEach((step, index) => {
                const delayMs = (loop * sequence.length + index) * stepMs;
                this.scheduleBaselineTimeout(() => {
                    if (!this.isActive) return;
                    const { event, payload: stepPayload } = step;
                    let payload = stepPayload;
                    if (payload && typeof payload === 'object') {
                        payload = { ...payload };
                    }
                    if (event === EVENTS.PIECE_LOCK) {
                        payload = { ...(payload || {}), timestamp: delayMs };
                    }
                    eventBus.emit(event, payload);
                }, delayMs);
            });
        }

        const endDelay = sequence.length * loops * stepMs + 50;
        this.scheduleBaselineTimeout(() => { }, endDelay);

        console.log('[StellarBaseline] Playing sequence', {
            name,
            loops,
            stepMs,
        });
        return true;
    }

    downloadJson(filename, payload) {
        if (typeof window === 'undefined') return;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    downloadBaselineReport(label = 'stellar-baseline') {
        const report = this.reportBaseline();
        if (!report) return null;
        const filename = `${label}-${this.getBackendSlug()}-${Date.now()}.json`;
        this.downloadJson(filename, report);
        return report;
    }

    async captureBaselinePack(options = {}) {
        const {
            label = 'stellar-pack',
            stepMs = 320,
            warmupMs = 1200,
            settleMs = 280,
            defaultLoops = 2,
            stressLoops = 2,
            downloadReport = true,
        } = options;

        if (!this.isActive) {
            console.warn('[StellarBaseline] capturePack skipped: theme is not active.');
            return null;
        }

        this.clearBaselinePlaybackTimers();
        this.resetBaseline();

        await this.waitForBaseline(warmupMs);
        this.captureBaseline(`${label}-idle`);

        this.playBaselineSequence('default', { loops: defaultLoops, stepMs });
        await this.waitForBaseline(this.getBaselineSequenceDurationMs('default', defaultLoops, stepMs) + settleMs);
        this.captureBaseline(`${label}-default`);

        this.playBaselineSequence('stress', { loops: stressLoops, stepMs });
        await this.waitForBaseline(this.getBaselineSequenceDurationMs('stress', stressLoops, stepMs) + settleMs);
        this.captureBaseline(`${label}-stress`);

        const report = this.reportBaseline();
        if (downloadReport && report) {
            const filename = `${label}-${this.getBackendSlug()}-${Date.now()}.json`;
            this.downloadJson(filename, report);
        }

        console.log('[StellarBaseline] capturePack complete', {
            label,
            defaultLoops,
            stressLoops,
            stepMs,
        });
        return report;
    }

    async captureReadabilityAnchors(options = {}) {
        const {
            label = 'stellar-readability',
            settleMs = 300,
            includeReport = true,
        } = options;

        if (!this.isActive) {
            console.warn('[StellarBaseline] captureReadability skipped: theme is not active.');
            return null;
        }

        this.clearBaselinePlaybackTimers();

        const anchors = [
            { id: 'piece-lock', event: EVENTS.PIECE_LOCK, payload: { timestamp: 1111 } },
            { id: 'combo-3', event: EVENTS.COMBO, payload: { comboCount: 3 } },
            { id: 'combo-6', event: EVENTS.COMBO, payload: { comboCount: 6 } },
            { id: 'combo-8', event: EVENTS.COMBO, payload: { comboCount: 8 } },
            { id: 'combo-10', event: EVENTS.COMBO, payload: { comboCount: 10 } },
        ];

        await anchors.reduce((promise, anchor) => promise.then(async () => {
            eventBus.emit(anchor.event, { ...anchor.payload });
            await this.waitForBaseline(settleMs);
            this.captureBaseline(`${label}-${anchor.id}`);
        }), Promise.resolve());

        const report = includeReport ? this.reportBaseline() : null;
        console.log('[StellarBaseline] captureReadability complete', {
            label,
            anchors: anchors.map((a) => a.id),
        });
        return report;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.stellarBaseline = {
            capture: (label) => this.captureBaseline(label),
            report: () => this.reportBaseline(),
            downloadReport: (label) => this.downloadBaselineReport(label),
            reset: () => this.resetBaseline(),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            capturePack: (options = {}) => this.captureBaselinePack(options),
            captureReadability: (options = {}) => this.captureReadabilityAnchors(options),
            stressQualitySwitch: (options = {}) => this.runQualitySwitchStress(options),
            // Phase 8: Validation helpers
            runValidation: (options = {}) => this.runValidationMatrix(options),
            soakTest: (options = {}) => this.runThemeSwitchSoak(options),
            getCapabilities: () => ({ ...this.capabilities }),
            stop: () => this.clearBaselinePlaybackTimers(),
        };
        console.log('[StellarBaseline] Helpers: capture(label), report(), downloadReport(label), reset(), play(sequence, options), capturePack(options), captureReadability(options), stressQualitySwitch(options), runValidation(options), soakTest(options), getCapabilities(), stop()');
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.stellarBaseline) {
            delete window.stellarBaseline;
        }
    }

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        if (this.renderer) {
            const pixelRatio = this.getRendererPixelRatio(1.5);
            this.renderer.setPixelRatio(pixelRatio);
            this.renderer.setSize(width, height);
            const starfieldUniforms = this.starfieldMaterialData?.uniforms || this.starfield?.material?.uniforms;
            if (starfieldUniforms?.uPixelRatio) {
                starfieldUniforms.uPixelRatio.value = pixelRatio;
            }
        }
        if (this.postProcessing?.setSize) {
            const effectScale = this.adaptiveScalerState?.effectScale ?? 1;
            this.postProcessing.update({
                bloomDownsample: THREE.MathUtils.clamp(0.6 + effectScale * 0.22, 0.58, 0.86),
            });
            this.postProcessing.setSize(width, height);
        }
        if (this.composer) this.composer.setSize(width, height);
        if (this.bloomPass?.resolution) {
            this.bloomPass.resolution.set(width, height);
        }
    }

    stop() {
        this.cancelAnimationLoop();
        this.clock.stop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearThemeTimeouts();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;
        super.stop();
    }

    cleanup() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.clearThemeTimeouts();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();

        super.cleanup();
    }
}
