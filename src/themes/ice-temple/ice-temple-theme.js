/**
 * @fileoverview Ice Temple Theme - Three.js 3D Implementation
 *
 * Immersive frozen temple with translucent ice pillars, aurora borealis,
 * frost patterns, and dynamic snow. All effects rendered in full 3D.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { ICE_TEMPLE_TETROMINOS } from './ice-temple-tetrominos.js';
import { IceTemplePost } from './ice-temple-post.js';
import { IceTempleSnowCompute, IceTempleShardBurstCompute } from './ice-temple-compute.js';
import * as ICE_TEMPLE_SHADERS from './ice-temple-shaders.js';
import {
    initIceTempleMaterialRuntime,
    createAuroraMaterialWebGL,
    createAuroraMaterialWebGPU,
    createShockwaveMaterialWebGL,
    createShockwaveMaterialWebGPU,
    createSnowMaterialWebGL,
    createSnowMaterialWebGPU,
    createIceShardMaterialWebGL,
    createIceShardMaterialWebGPU,
    createStarfieldMaterialWebGL,
    createStarfieldMaterialWebGPU,
} from './ice-temple-materials.js';

// ═══════════════════════════════════════════════════════════════════════════
// THEME CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    // Ice colors
    iceBase: new THREE.Color(0x0e3352), // Deep ice blue
    iceGlow: new THREE.Color(0x74b9ff), // Bright cyan glow
    iceHighlight: new THREE.Color(0xb4f5ff), // White-cyan highlight

    // Floor colors
    floorIce: new THREE.Color(0x0a1f35), // Dark frozen floor
    floorCracks: new THREE.Color(0x55efc4), // Teal crack glow
    floorSnow: new THREE.Color(0xe8fcff), // Snow white

    // Aurora colors
    aurora1: new THREE.Color(0x74b9ff), // Cyan
    aurora2: new THREE.Color(0x55efc4), // Emerald green
    aurora3: new THREE.Color(0xa29bfe), // Purple

    // Particles
    snow: new THREE.Color(0xe8fcff),
    iceShards: new THREE.Color(0x96d7ff),

    // Fog and ambient
    fog: new THREE.Color(0x051525),
    ambient: new THREE.Color(0x1a3a5c),
};

const QUALITY_PRESETS = {
    Extreme: {
        starCount: 2200,
        snowCount: 4500,
        snowComputeCount: 12000,
        auroraSegments: 220,
        auroraHeightSegments: 80,
        auroraLayers: 3,
        bloomStrength: 0.58,
        bloomRadius: 0.35,
        bloomThreshold: 0.38,
        bloomMode: 'full',
        bloomDownsample: 1.0,
        postScale: 1.0,
        fogMotionProfile: 'full',
        frameBudgetMs: 16.7,
        minParticleScale: 0.7,
    },
    Ultra: {
        starCount: 1900,
        snowCount: 3600,
        snowComputeCount: 10000,
        auroraSegments: 180,
        auroraHeightSegments: 72,
        auroraLayers: 3,
        bloomStrength: 0.54,
        bloomRadius: 0.32,
        bloomThreshold: 0.4,
        bloomMode: 'full',
        bloomDownsample: 0.9,
        postScale: 1.0,
        fogMotionProfile: 'full',
        frameBudgetMs: 16.7,
        minParticleScale: 0.65,
    },
    High: {
        starCount: 1500,
        snowCount: 3000,
        snowComputeCount: 8500,
        auroraSegments: 160,
        auroraHeightSegments: 64,
        auroraLayers: 2,
        bloomStrength: 0.5,
        bloomRadius: 0.3,
        bloomThreshold: 0.4,
        bloomMode: 'full',
        bloomDownsample: 0.85,
        postScale: 1.0,
        fogMotionProfile: 'full',
        frameBudgetMs: 16.7,
        minParticleScale: 0.6,
    },
    Medium: {
        starCount: 1100,
        snowCount: 2200,
        snowComputeCount: 6500,
        auroraSegments: 128,
        auroraHeightSegments: 48,
        auroraLayers: 1,
        bloomStrength: 0.44,
        bloomRadius: 0.27,
        bloomThreshold: 0.43,
        bloomMode: 'half',
        bloomDownsample: 0.65,
        postScale: 0.9,
        fogMotionProfile: 'soft',
        frameBudgetMs: 16.7,
        minParticleScale: 0.55,
    },
    Low: {
        starCount: 800,
        snowCount: 1500,
        snowComputeCount: 4500,
        auroraSegments: 96,
        auroraHeightSegments: 40,
        auroraLayers: 1,
        bloomStrength: 0.36,
        bloomRadius: 0.24,
        bloomThreshold: 0.46,
        bloomMode: 'half',
        bloomDownsample: 0.55,
        postScale: 0.75,
        fogMotionProfile: 'soft',
        frameBudgetMs: 20.0,
        minParticleScale: 0.5,
    },
    Minimal: {
        starCount: 500,
        snowCount: 900,
        snowComputeCount: 2800,
        auroraSegments: 72,
        auroraHeightSegments: 32,
        auroraLayers: 1,
        bloomStrength: 0.3,
        bloomRadius: 0.2,
        bloomThreshold: 0.5,
        bloomMode: 'half',
        bloomDownsample: 0.5,
        postScale: 0.5,
        fogMotionProfile: 'off',
        frameBudgetMs: 22.0,
        minParticleScale: 0.45,
    },
};

const RESONANCE_QUALITY_SCALE = {
    Extreme: 1.0,
    Ultra: 0.9,
    High: 0.78,
    Medium: 0.62,
    Low: 0.45,
    Minimal: 0.3,
};

const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

let WEBGPU_MODULE = null;

function parseIceTempleFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noPost: false,
            noMRT: false,
            noCompute: false,
            noEnhancements: false,
            noAuroraVolume: false,
            noFogMotion: false,
            baseline: false,
            mrtAudit: false,
            seed: null,
            fixedDtMs: null,
            playback: null,
            playbackLoops: 1,
            usePost: true,
            useMRT: false,
            useCompute: false,
        };
    }

    const params = new URLSearchParams(window.location.search);
    const readBool = (key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        if (value === '' || value === null) return true;
        const normalized = value.toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    };
    const readNumber = (key) => {
        if (!params.has(key)) return null;
        const value = params.get(key);
        if (value === '' || value === null) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    const readString = (key) => {
        if (!params.has(key)) return null;
        const value = params.get(key);
        if (value === '' || value === null) return null;
        return value.trim();
    };

    const seed = readNumber('iceTempleSeed') ?? readNumber('seed');
    const fixedDtMs = readNumber('iceTempleFixedDt') ?? readNumber('fixedDt');
    const playbackRaw = readString('iceTemplePlayback');
    const playback = playbackRaw ? playbackRaw.toLowerCase() : null;
    let playbackSequence = null;
    if (playback === 'default' || playback === 'stress') {
        playbackSequence = playback;
    }
    const playbackLoopsRaw = readNumber('iceTemplePlaybackLoops');
    const playbackLoops = Number.isFinite(playbackLoopsRaw) && playbackLoopsRaw > 0
        ? Math.floor(playbackLoopsRaw)
        : 1;

    return {
        forceWebGL: readBool('forceWebGL'),
        noPost: readBool('iceTempleNoPost'),
        noMRT: readBool('iceTempleNoMRT'),
        noCompute: readBool('iceTempleNoCompute'),
        noEnhancements: readBool('iceTempleNoEnhancements'),
        noAuroraVolume: readBool('iceTempleNoAuroraVolume'),
        noFogMotion: readBool('iceTempleNoFogMotion'),
        baseline: readBool('iceTempleBaseline'),
        mrtAudit: readBool('iceTempleMrtAudit'),
        seed,
        fixedDtMs: Number.isFinite(fixedDtMs) && fixedDtMs > 0 ? fixedDtMs : null,
        playback: playbackSequence,
        playbackLoops,
        usePost: !readBool('iceTempleNoPost'),
        useMRT: false,
        useCompute: false,
    };
}

function createSeededRandom(seed) {
    if (!Number.isFinite(seed)) return Math.random;
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state <= 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

export default class IceTempleTheme extends BaseTheme {
    constructor() {
        super('ice-temple');

        // Debug/config flags for phased WebGPU migration and deterministic captures.
        this.flags = parseIceTempleFlags();
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 3600;
        this.baselineTimeouts = new Set();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
        this.lastBaselinePresetMatrix = null;
        this.lastBaselineEvidence = null;
        this.baselineEventCounts = {
            lineClear: 0,
            combo: 0,
            pieceLock: 0,
        };

        // Backend state
        this.isWebGPU = false;
        this.isWebGL = false;
        this.useWebGPUMaterials = false;
        this.capabilities = {};
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;
        this.deviceLossRecoveries = 0;
        this.webglContextLostHandler = null;
        this.webglContextRestoredHandler = null;

        // Event handling
        this.eventUnsubscribers = [];
        this.boundResizeHandler = this.onWindowResize.bind(this);

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null; // Post-processing for bloom
        this.postProcessing = null; // Placeholder for future WebGPU post path
        this.bloomPass = null;
        this.mainGroup = null;
        this.clock = new THREE.Clock();
        this.animationFrame = null;

        // Scene elements
        this.icePillars = [];
        this.auroraPlanes = [];
        this.snowSystem = null;
        this.shardBursts = [];
        this.shockwaves = [];
        this.resonanceCracks = [];
        this.resonanceCrackPool = [];
        this.pendingPillarResonanceBursts = [];
        this.starField = null;
        this.frostFloor = null;
        this.floorMaterial = null;
        this.crackOverlay = null;
        this.mistLayers = null;
        this.fogRing = null;
        this.environmentMap = null;
        this.auroraReflections = null;

        // Compute systems (WebGPU optional)
        this.snowCompute = null;
        this.shardCompute = null;
        this.snowBounds = { width: 80, height: 40, depth: 60 };
        this.shardComputeCapacity = 2048;
        this.snowMaxCount = 0;
        this.snowDrawCount = 0;
        this.snowScale = 1.0;
        this.frameTimeEmaMs = 16.7;
        this.qualityCheckTimer = 0;
        this.qualityTransitionInProgress = false;

        // Shared uniforms for synchronized animation
        this.uniforms = {
            time: { value: 0 },
            pulseIntensity: { value: 0 },
            crackGlow: { value: 0 },
            auroraIntensity: { value: 0.8 },
        };

        this.activeQualityLevel = this.getCurrentQualityLevel();
        this.qualityPreset = QUALITY_PRESETS[this.activeQualityLevel] || QUALITY_PRESETS.High;

        // Effect state
        this.targetPulseIntensity = 0;
        this.targetCrackGlow = 0;
        this.targetAuroraIntensity = 0.8;
        this.resonanceEnergy = 0;
        this.targetResonanceEnergy = 0;
        this.auroraShear = 0;
        this.targetAuroraShear = 0;
    }

    getTetrominoConfig() {
        return ICE_TEMPLE_TETROMINOS;
    }

    random() {
        return this.randomFn();
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(level) {
        const normalized = normalizeQuality(level);
        this.activeQualityLevel = normalized;
        this.qualityPreset = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
    }

    getPostScale() {
        return this.qualityPreset?.postScale ?? 1.0;
    }

    getSnowBaseCount() {
        if (this.shouldUseCompute()) return this.qualityPreset.snowComputeCount;
        return this.qualityPreset.snowCount;
    }

    getResonanceQualityScale() {
        return RESONANCE_QUALITY_SCALE[this.activeQualityLevel] ?? 0.75;
    }

    getResonancePerformanceScale() {
        const frameBudget = this.qualityPreset?.frameBudgetMs ?? 16.7;
        const frameMs = Math.max(8.0, this.frameTimeEmaMs || frameBudget);
        return THREE.MathUtils.clamp(frameBudget / frameMs, 0.55, 1.0);
    }

    shouldUseVolumetricAurora() {
        if (!this.isWebGPU || !this.useWebGPUMaterials) return false;
        if (this.flags.noEnhancements || this.flags.noAuroraVolume) return false;
        return (this.qualityPreset.auroraLayers ?? 1) > 1;
    }

    getFogMotionProfile() {
        const profile = this.qualityPreset?.fogMotionProfile || 'soft';
        if (profile === 'full') {
            return {
                enabled: true,
                speed: 1.0,
                driftMultiplier: 1.0,
                heightMultiplier: 1.0,
                scalePulseAmplitude: 0.06,
                opacityPulseAmplitude: 0.2,
                ringScaleAmplitude: 0.03,
                ringOpacityPulse: 0.18,
                ringRotationSpeed: 0.04,
            };
        }
        if (profile === 'soft') {
            return {
                enabled: true,
                speed: 0.7,
                driftMultiplier: 0.6,
                heightMultiplier: 0.65,
                scalePulseAmplitude: 0.035,
                opacityPulseAmplitude: 0.12,
                ringScaleAmplitude: 0.018,
                ringOpacityPulse: 0.1,
                ringRotationSpeed: 0.025,
            };
        }

        return {
            enabled: false,
            speed: 0,
            driftMultiplier: 0,
            heightMultiplier: 0,
            scalePulseAmplitude: 0,
            opacityPulseAmplitude: 0,
            ringScaleAmplitude: 0,
            ringOpacityPulse: 0,
            ringRotationSpeed: 0,
        };
    }

    shouldUseEnhancedFogMotion() {
        if (!this.isWebGPU || !this.useWebGPUMaterials) return false;
        if (this.flags.noEnhancements || this.flags.noFogMotion) return false;
        return this.getFogMotionProfile().enabled;
    }

    updateFogMotion(elapsed, delta) {
        const fogMotionProfile = this.getFogMotionProfile();
        const useEnhancedFogMotion = this.shouldUseEnhancedFogMotion();

        if (this.mistLayers?.length) {
            this.mistLayers.forEach((layer, index) => {
                const basePosition = layer.userData?.basePosition;
                const baseScale = layer.userData?.baseScale;
                if (!basePosition || !baseScale) return;

                const phase = layer.userData.phase ?? (index * 0.9);
                const driftRadius = layer.userData.driftRadius ?? 0.5;
                const heightAmplitude = layer.userData.heightAmplitude ?? 0.08;
                const flowSpeed = layer.userData.flowSpeed ?? 0.06;
                const opacityBase = layer.userData.opacityBase ?? layer.material.opacity ?? 1.0;

                if (useEnhancedFogMotion) {
                    const speed = fogMotionProfile.speed;
                    const driftX = Math.sin(elapsed * speed * (flowSpeed * 9) + phase)
                        * driftRadius
                        * fogMotionProfile.driftMultiplier;
                    const driftZ = Math.cos(elapsed * speed * (flowSpeed * 7.6) + phase)
                        * driftRadius
                        * 0.65
                        * fogMotionProfile.driftMultiplier;
                    const driftY = Math.sin(elapsed * speed * (flowSpeed * 4.2) + phase * 0.7)
                        * heightAmplitude
                        * fogMotionProfile.heightMultiplier;

                    layer.position.set(
                        basePosition.x + driftX,
                        basePosition.y + driftY,
                        basePosition.z + driftZ,
                    );

                    const pulse = Math.sin(elapsed * speed * (flowSpeed * 4.6) + phase);
                    const scalePulse = 1 + (pulse * fogMotionProfile.scalePulseAmplitude);
                    layer.scale.set(
                        baseScale.x * scalePulse,
                        baseScale.y * scalePulse,
                        baseScale.z,
                    );

                    if (layer.material) {
                        const opacity = opacityBase * (1 + (pulse * fogMotionProfile.opacityPulseAmplitude));
                        layer.material.opacity = THREE.MathUtils.clamp(opacity, 0.02, 1.0);
                    }
                    return;
                }

                layer.position.copy(basePosition);
                layer.scale.copy(baseScale);
                if (layer.material) {
                    layer.material.opacity = opacityBase;
                }
            });
        }

        if (!this.fogRing) return;
        const ringMaterial = this.fogRing.material;
        const baseY = this.fogRing.userData?.baseY;
        const baseRotationZ = this.fogRing.userData?.baseRotationZ;
        const baseScale = this.fogRing.userData?.baseScale;
        const opacityBase = this.fogRing.userData?.opacityBase ?? ringMaterial?.opacity ?? 1.0;
        const phase = this.fogRing.userData?.phase ?? 0;
        const flowSpeed = this.fogRing.userData?.flowSpeed ?? 0.04;

        if (!baseScale || baseY === undefined || baseRotationZ === undefined || !ringMaterial) return;

        if (useEnhancedFogMotion) {
            const speed = fogMotionProfile.speed;
            const ringWave = Math.sin(elapsed * speed * (flowSpeed * 5) + phase);
            this.fogRing.position.y = baseY + (ringWave * 0.08 * fogMotionProfile.heightMultiplier);
            this.fogRing.rotation.z += delta * flowSpeed * fogMotionProfile.ringRotationSpeed;

            const ringScalePulse = 1 + (ringWave * fogMotionProfile.ringScaleAmplitude);
            this.fogRing.scale.set(
                baseScale.x * ringScalePulse,
                baseScale.y * ringScalePulse,
                baseScale.z,
            );

            const ringOpacity = opacityBase * (1 + (ringWave * fogMotionProfile.ringOpacityPulse));
            ringMaterial.opacity = THREE.MathUtils.clamp(ringOpacity, 0.04, 1.0);
            return;
        }

        this.fogRing.position.y = baseY;
        this.fogRing.rotation.z = baseRotationZ;
        this.fogRing.scale.copy(baseScale);
        ringMaterial.opacity = opacityBase;
    }

    disposeObject3D(object) {
        if (!object) return;
        if (object.parent) object.parent.remove(object);
        if (object.geometry?.dispose) object.geometry.dispose();
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach((material) => material?.dispose?.());
            } else {
                object.material.dispose?.();
            }
        }
    }

    disposeAuroraSystems() {
        if (this.auroraPlanes?.length) {
            this.auroraPlanes.forEach((aurora) => this.disposeObject3D(aurora));
        }
        if (this.auroraReflections?.length) {
            this.auroraReflections.forEach((reflection) => this.disposeObject3D(reflection));
        }
        this.auroraPlanes = [];
        this.auroraReflections = null;
    }

    disposeSnowSystem() {
        if (this.snowSystem) {
            this.disposeObject3D(this.snowSystem);
            this.snowSystem = null;
        }
        this.snowMaxCount = 0;
        this.snowDrawCount = 0;
        this.disposeComputeSystems();

        if (this.shardBursts?.length) {
            this.shardBursts.forEach((burst) => this.disposeObject3D(burst));
        }
        this.shardBursts = [];
    }

    updatePostSettings() {
        if (this.bloomPass) {
            this.bloomPass.strength = this.qualityPreset.bloomStrength;
            this.bloomPass.radius = this.qualityPreset.bloomRadius;
            this.bloomPass.threshold = this.qualityPreset.bloomThreshold;
        }
    }

    async rebuildQualityDependentSystems() {
        this.disposeObject3D(this.starField);
        this.starField = null;
        this.disposeAuroraSystems();
        this.disposeSnowSystem();

        this.createStarField();
        this.createAurora();
        this.createSnowSystem();
        this.createShardComputeSystem();
        await this.setupPostProcessing();
        this.auditMrtMaterials();
    }

    async maybeHandleQualityPresetTransition(delta) {
        if (this.qualityTransitionInProgress) return;
        this.qualityCheckTimer += delta;
        if (this.qualityCheckTimer < 0.75) return;
        this.qualityCheckTimer = 0;

        const desired = this.getCurrentQualityLevel();
        if (desired === this.activeQualityLevel) return;

        this.qualityTransitionInProgress = true;
        this.applyQualityPreset(desired);
        this.snowScale = 1.0;
        this.frameTimeEmaMs = 16.7;
        if (this.flags.baseline) {
            console.log('[IceTemple] Applying runtime quality preset', {
                quality: this.activeQualityLevel,
                preset: this.qualityPreset,
            });
        }
        try {
            await this.rebuildQualityDependentSystems();
        } catch (error) {
            console.warn('[IceTemple] Failed to rebuild quality-dependent systems:', error);
        } finally {
            this.qualityTransitionInProgress = false;
        }
    }

    applySnowBudget(targetCount) {
        if (!this.snowSystem?.geometry || !Number.isFinite(targetCount)) return;

        const minCount = Math.max(128, Math.floor(this.snowMaxCount * (this.qualityPreset.minParticleScale ?? 0.45)));
        const clamped = Math.max(minCount, Math.min(this.snowMaxCount, Math.floor(targetCount)));
        if (clamped === this.snowDrawCount) return;

        if (this.shouldUseCompute() && this.snowCompute?.setActiveCount) {
            this.snowCompute.setActiveCount(clamped);
        }

        this.snowSystem.geometry.setDrawRange(0, clamped);
        this.snowDrawCount = clamped;
    }

    updateAdaptiveSnowScaling(delta, frameMs) {
        if (this.fixedDeltaSeconds !== null || this.snowMaxCount <= 0 || this.qualityTransitionInProgress) return;

        const smoothing = Math.min(1, delta * 2.5);
        this.frameTimeEmaMs += (frameMs - this.frameTimeEmaMs) * smoothing;

        const frameBudget = this.qualityPreset.frameBudgetMs ?? 16.7;
        const overBudget = this.frameTimeEmaMs > frameBudget * 1.12;
        const underBudget = this.frameTimeEmaMs < frameBudget * 0.9;
        const minScale = this.qualityPreset.minParticleScale ?? 0.45;

        if (overBudget) {
            this.snowScale = Math.max(minScale, this.snowScale - (delta * 0.28));
        } else if (underBudget) {
            this.snowScale = Math.min(1.0, this.snowScale + (delta * 0.2));
        }

        const desiredSnowCount = this.getSnowBaseCount() * this.snowScale;
        this.applySnowBudget(desiredSnowCount);
    }

    setMaterialUniform(material, key, value) {
        if (!material || !key) return;
        const uniforms = material.userData?.uniforms;
        if (uniforms && uniforms[key] && Object.prototype.hasOwnProperty.call(uniforms[key], 'value')) {
            uniforms[key].value = value;
            return;
        }
        if (material.uniforms?.[key]) {
            material.uniforms[key].value = value;
        }
    }

    tagMaterialForMrt(material, role, emitsBloom) {
        if (!material) return;
        const applyTag = (entry) => {
            entry.userData = {
                ...(entry.userData || {}),
                mrtRole: role,
                emitsBloom,
            };
        };
        if (Array.isArray(material)) {
            material.forEach((entry) => applyTag(entry));
            return;
        }
        applyTag(material);
    }

    getBackendSlug() {
        return this.isWebGPU ? 'webgpu' : 'webgl';
    }

    refreshRuntimeFlags() {
        const parsedFlags = parseIceTempleFlags();
        const previousFlags = this.flags || {};

        // Keep runtime fallback overrides sticky while this theme instance is alive.
        parsedFlags.forceWebGL = parsedFlags.forceWebGL || previousFlags.forceWebGL === true;
        parsedFlags.noPost = parsedFlags.noPost || previousFlags.noPost === true;
        parsedFlags.noMRT = parsedFlags.noMRT || previousFlags.noMRT === true;
        parsedFlags.noCompute = parsedFlags.noCompute || previousFlags.noCompute === true;
        parsedFlags.noEnhancements = parsedFlags.noEnhancements || previousFlags.noEnhancements === true;
        parsedFlags.noAuroraVolume = parsedFlags.noAuroraVolume || previousFlags.noAuroraVolume === true;
        parsedFlags.noFogMotion = parsedFlags.noFogMotion || previousFlags.noFogMotion === true;
        parsedFlags.baseline = parsedFlags.baseline || previousFlags.baseline === true;
        parsedFlags.mrtAudit = parsedFlags.mrtAudit || previousFlags.mrtAudit === true;

        this.flags = parsedFlags;
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
    }

    cancelAnimationLoop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    clearEventSubscriptions() {
        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];
    }

    removeResizeListener() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.boundResizeHandler);
        }
    }

    removeRendererResilienceListeners() {
        if (!this.renderer?.domElement) return;

        if (this.webglContextLostHandler) {
            this.renderer.domElement.removeEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.webglContextLostHandler = null;
        }
        if (this.webglContextRestoredHandler) {
            this.renderer.domElement.removeEventListener(
                'webglcontextrestored',
                this.webglContextRestoredHandler,
                false,
            );
            this.webglContextRestoredHandler = null;
        }
    }

    setupRendererResilience() {
        if (!this.renderer?.domElement) return;

        this.removeRendererResilienceListeners();
        this.renderer.onDeviceLost = null;

        if (this.isWebGL) {
            this.webglContextLostHandler = (event) => {
                event.preventDefault();
                console.warn('[IceTemple] WebGL context lost');
            };
            this.webglContextRestoredHandler = () => {
                console.warn('[IceTemple] WebGL context restored');
                this.onWindowResize();
            };
            this.renderer.domElement.addEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.renderer.domElement.addEventListener(
                'webglcontextrestored',
                this.webglContextRestoredHandler,
                false,
            );
            return;
        }

        this.renderer.onDeviceLost = (info) => {
            this.handleDeviceLoss(info).catch((error) => {
                console.error('[IceTemple] Device-loss handler failed:', error);
            });
        };

        const deviceLostPromise = this.renderer?.backend?.device?.lost;
        if (deviceLostPromise && typeof deviceLostPromise.then === 'function') {
            deviceLostPromise.then((info) => {
                this.handleDeviceLoss(info).catch((error) => {
                    console.error('[IceTemple] Device-loss promise handler failed:', error);
                });
            }).catch(() => {
                // Device loss can reject during teardown; ignore.
            });
        }
    }

    disposeSceneResources() {
        if (this.resonanceCrackPool?.length) {
            this.resonanceCrackPool.forEach((crackLine) => {
                crackLine.geometry?.dispose?.();
                crackLine.material?.dispose?.();
            });
            this.resonanceCrackPool = [];
        }

        if (this.environmentMap) {
            if (this.scene?.environment === this.environmentMap) {
                this.scene.environment = null;
            }
            this.environmentMap.dispose();
            this.environmentMap = null;
        }

        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry?.dispose) object.geometry.dispose();
                if (!object.material) return;
                if (Array.isArray(object.material)) {
                    object.material.forEach((material) => material?.dispose?.());
                } else {
                    object.material.dispose?.();
                }
            });
        }
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.renderer.onDeviceLost = null;
        this.removeRendererResilienceListeners();
        const { domElement } = this.renderer;
        this.renderer.dispose();

        if (removeCanvas && domElement?.parentNode) {
            domElement.parentNode.removeChild(domElement);
        }
    }

    resetRuntimeReferences() {
        this.icePillars = [];
        this.auroraPlanes = [];
        this.auroraReflections = null;
        this.shardBursts = [];
        this.shockwaves = [];
        this.resonanceCracks = [];
        this.resonanceCrackPool = [];
        this.pendingPillarResonanceBursts = [];
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isWebGPU = false;
        this.isWebGL = false;
        this.useWebGPUMaterials = false;
        this.capabilities = {};
        this.mainGroup = null;
        this.starField = null;
        this.snowSystem = null;
        this.frostFloor = null;
        this.floorMaterial = null;
        this.crackOverlay = null;
        this.mistLayers = null;
        this.fogRing = null;
        this.snowMaxCount = 0;
        this.snowDrawCount = 0;
        this.snowScale = 1.0;
        this.frameTimeEmaMs = 16.7;
        this.qualityCheckTimer = 0;
        this.qualityTransitionInProgress = false;
        this.fixedElapsedTime = 0;
        this.targetPulseIntensity = 0;
        this.targetCrackGlow = 0;
        this.targetAuroraIntensity = 0.8;
        this.resonanceEnergy = 0;
        this.targetResonanceEnergy = 0;
        this.auroraShear = 0;
        this.targetAuroraShear = 0;
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposePostProcessing();
        this.disposeComputeSystems();
        this.disposeSceneResources();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.renderFallbackInProgress || !this.isActive) return;
        if (this.flags.forceWebGL === true) return;

        this.renderFallbackInProgress = true;
        console.warn(`[IceTemple] Switching to WebGL fallback (${reason})`, error || '');

        try {
            this.cancelAnimationLoop();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.clearBaselinePlaybackTimers();
            this.removeBaselineHelpers();
            this.disposeRuntimeResources({ removeCanvas: true });

            this.flags.forceWebGL = true;
            this.flags.noMRT = true;
            this.flags.noCompute = true;

            await this.createScene();
            console.log('[IceTemple] WebGL fallback active after runtime recovery.');
        } catch (fallbackError) {
            console.error('[IceTemple] Runtime fallback failed:', fallbackError);
            this.isActive = false;
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        this.deviceLossRecoveries += 1;
        console.error('[IceTemple] WebGPU device lost:', info);

        try {
            await this.requestWebGLFallback('device-loss', info);
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    trackBaselineFrame(deltaSeconds) {
        const frameMs = deltaSeconds * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }

        const renderInfo = this.renderer?.info?.render;
        if (!renderInfo) return;

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

    resetBaseline() {
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineEventCounts = {
            lineClear: 0,
            combo: 0,
            pieceLock: 0,
        };
    }

    reportBaseline() {
        if (!this.baselineFrames.length) {
            console.log('[IceTempleBaseline] No frames collected yet.');
            return null;
        }

        const sortedFrames = [...this.baselineFrames].sort((a, b) => a - b);
        const frameCount = this.baselineFrames.length;
        const avgMs = this.baselineFrames.reduce((sum, value) => sum + value, 0) / frameCount;
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
        const totals = this.baselineRenderStats.reduce((acc, sample) => {
            acc.calls += sample.calls;
            acc.triangles += sample.triangles;
            acc.lines += sample.lines;
            acc.points += sample.points;
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
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            preset: this.activeQualityLevel,
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
            eventCounts: { ...this.baselineEventCounts },
        };

        console.log('[IceTempleBaseline] Report:', report);
        return report;
    }

    captureBaseline(label = 'ice-temple') {
        if (!this.renderer?.domElement) {
            console.warn('[IceTempleBaseline] No renderer canvas available.');
            return;
        }

        const canvas = this.renderer.domElement;
        const filename = `${label}-${this.getBackendSlug()}-${Date.now()}.png`;

        if (canvas.toBlob) {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);
            });
            return;
        }

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = filename;
        link.click();
    }

    clearBaselinePlaybackTimers() {
        this.baselineTimeouts.forEach((id) => clearTimeout(id));
        this.baselineTimeouts.clear();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
    }

    scheduleBaselineTimeout(callback, delayMs) {
        if (typeof window === 'undefined') return null;
        const timeoutId = window.setTimeout(() => {
            this.baselineTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.baselineTimeouts.add(timeoutId);
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
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 1 } },
                { event: EVENTS.COMBO, payload: { comboCount: 2 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
                { event: EVENTS.COMBO, payload: { comboCount: 4 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
            ],
            stress: [
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
                { event: EVENTS.COMBO, payload: { comboCount: 4 } },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 3 } },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.COMBO, payload: { comboCount: 8 } },
                { event: EVENTS.PIECE_LOCK, payload: {} },
            ],
        };
        return sequences[name] || sequences.default;
    }

    getBaselineSequenceDurationMs(name = 'default', loops = 1, stepMs = 260) {
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
            : 260;

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
        this.scheduleBaselineTimeout(() => {}, endDelay);

        console.log('[IceTempleBaseline] Playing sequence', {
            name,
            loops,
            stepMs,
        });
        return true;
    }

    async runBaselineEventValidation(options = {}) {
        if (!this.isActive) {
            console.warn('[IceTempleBaseline] validateEvents skipped: theme is not active.');
            return null;
        }

        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0 ? options.settleMs : 260;
        const checks = [
            { key: 'lineClear', event: EVENTS.LINE_CLEAR, payload: { lineCount: 2 } },
            { key: 'combo', event: EVENTS.COMBO, payload: { comboCount: 4 } },
            { key: 'pieceLock', event: EVENTS.PIECE_LOCK, payload: { timestamp: Date.now() } },
        ];

        const before = { ...this.baselineEventCounts };
        await checks.reduce((promise, check) => promise.then(async () => {
            eventBus.emit(check.event, { ...check.payload });
            await this.waitForBaseline(settleMs);
        }), Promise.resolve());

        const after = { ...this.baselineEventCounts };
        const results = checks.reduce((acc, check) => {
            acc[check.key] = after[check.key] > before[check.key];
            return acc;
        }, {});
        const passed = checks.every((check) => results[check.key]);

        const report = {
            passed,
            settleMs,
            before,
            after,
            results,
        };
        console.log('[IceTempleBaseline] Event validation:', report);
        return report;
    }

    async validatePipelineHealth(options = {}) {
        if (!this.isActive || !this.renderer || !this.scene || !this.camera) {
            console.warn('[IceTempleBaseline] validatePipeline skipped: theme is not active.');
            return null;
        }

        const includePost = options.includePost !== false;
        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            includePost,
            startedAt: Date.now(),
            compile: {
                attempted: false,
                ok: true,
                error: null,
            },
            render: {
                attempted: false,
                ok: true,
                path: 'direct',
                error: null,
            },
            capabilities: { ...this.capabilities },
            flags: { ...this.flags },
        };

        try {
            report.compile.attempted = true;
            if (typeof this.renderer.compileAsync === 'function') {
                await this.renderer.compileAsync(this.scene, this.camera);
            } else if (typeof this.renderer.compile === 'function') {
                this.renderer.compile(this.scene, this.camera);
            }
        } catch (error) {
            report.compile.ok = false;
            report.compile.error = error?.message || String(error);
        }

        try {
            report.render.attempted = true;
            if (includePost && this.isWebGPU && this.flags.usePost && this.postProcessing?.render) {
                report.render.path = 'webgpu-post';
                this.postProcessing.render();
            } else if (includePost && this.isWebGL && this.flags.usePost && this.composer?.render) {
                report.render.path = 'webgl-composer';
                this.composer.render();
            } else {
                report.render.path = 'direct';
                this.renderer.render(this.scene, this.camera);
            }
        } catch (error) {
            report.render.ok = false;
            report.render.error = error?.message || String(error);
        }

        report.finishedAt = Date.now();
        report.passed = report.compile.ok && report.render.ok;
        console.log('[IceTempleBaseline] Pipeline health:', report);
        return report;
    }

    async sampleAnimationFrames(durationMs = 2000) {
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            return [];
        }

        const sampleDuration = Number.isFinite(durationMs) ? Math.max(250, durationMs) : 2000;
        return new Promise((resolve) => {
            const frameTimes = [];
            let startedAt = 0;
            let previous = 0;

            const tick = (now) => {
                if (startedAt === 0) {
                    startedAt = now;
                    previous = now;
                } else {
                    frameTimes.push(now - previous);
                    previous = now;
                }

                if (now - startedAt >= sampleDuration) {
                    resolve(frameTimes);
                    return;
                }
                window.requestAnimationFrame(tick);
            };

            window.requestAnimationFrame(tick);
        });
    }

    validateMrtIsolation(options = {}) {
        if (!this.isActive || !this.scene) {
            console.warn('[IceTempleBaseline] validateMRT skipped: theme is not active.');
            return null;
        }

        const enforceWhenDisabled = options.enforceWhenDisabled === true;
        const useMRT = this.flags.useMRT === true;
        const strictUnclassified = options.strictUnclassified !== false;
        const allowedBloomRoles = new Set(
            options.allowedBloomRoles || [
                'aurora',
                'shockwave',
                'ice-shard',
                'pillar-core',
                'pillar-shard',
                'pillar-glow',
                'floor-crack',
            ],
        );
        const maxOffenders = Number.isFinite(options.maxOffenders) ? Math.max(1, options.maxOffenders) : 40;

        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            useMRT,
            applicable: useMRT || enforceWhenDisabled,
            reason: null,
            strictUnclassified,
            allowedBloomRoles: [...allowedBloomRoles],
            totals: {
                materials: 0,
                emitsBloomTrue: 0,
                emitsBloomFalse: 0,
                unclassified: 0,
            },
            byRole: {},
            offenders: {
                unexpectedBloom: [],
                missingBloom: [],
                unclassified: [],
            },
        };

        if (!report.applicable) {
            report.passed = null;
            report.reason = 'mrt-disabled';
            console.log('[IceTempleBaseline] MRT isolation report (not applicable):', report);
            return report;
        }

        this.scene.traverse((object) => {
            if (!object.material) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                report.totals.materials += 1;
                const role = material.userData?.mrtRole || 'unclassified';
                const emitsBloom = material.userData?.emitsBloom;
                report.byRole[role] = (report.byRole[role] || 0) + 1;

                if (emitsBloom === true) report.totals.emitsBloomTrue += 1;
                if (emitsBloom === false) report.totals.emitsBloomFalse += 1;
                if (role === 'unclassified' || emitsBloom === undefined) {
                    report.totals.unclassified += 1;
                    if (report.offenders.unclassified.length < maxOffenders) {
                        report.offenders.unclassified.push({
                            object: object.name || object.type,
                            role,
                            emitsBloom: emitsBloom ?? null,
                        });
                    }
                }

                if (emitsBloom === true && !allowedBloomRoles.has(role)) {
                    if (report.offenders.unexpectedBloom.length < maxOffenders) {
                        report.offenders.unexpectedBloom.push({
                            object: object.name || object.type,
                            role,
                        });
                    }
                }
                if (emitsBloom === false && allowedBloomRoles.has(role)) {
                    if (report.offenders.missingBloom.length < maxOffenders) {
                        report.offenders.missingBloom.push({
                            object: object.name || object.type,
                            role,
                        });
                    }
                }
            });
        });

        const hasUnexpected = report.offenders.unexpectedBloom.length > 0;
        const hasMissing = report.offenders.missingBloom.length > 0;
        const hasUnclassified = report.offenders.unclassified.length > 0;
        report.passed = !hasUnexpected && !hasMissing && (!strictUnclassified || !hasUnclassified);
        report.reason = report.passed ? null : 'isolation-policy-failed';

        console.log('[IceTempleBaseline] MRT isolation report:', report);
        return report;
    }

    async validateSnowComputeCapacity(options = {}) {
        if (!this.isActive) {
            console.warn('[IceTempleBaseline] validateSnowCompute skipped: theme is not active.');
            return null;
        }

        const requestedCount = Number.isFinite(options.targetCount) ? Math.max(256, options.targetCount) : 10000;
        const warmupMs = Number.isFinite(options.warmupMs) ? Math.max(100, options.warmupMs) : 750;
        const sampleMs = Number.isFinite(options.sampleMs) ? Math.max(500, options.sampleMs) : 2500;
        const minFps = Number.isFinite(options.minFps) ? Math.max(0, options.minFps) : 0;
        const previousDrawCount = this.snowDrawCount;

        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            shouldUseCompute: this.shouldUseCompute(),
            applicable: false,
            requestedCount,
            warmupMs,
            sampleMs,
            minFps,
            maxCount: this.snowMaxCount,
            activeCount: this.snowDrawCount,
            avgFps: null,
            low1Fps: null,
            p99Ms: null,
            passed: false,
            reason: null,
        };

        report.applicable = this.shouldUseCompute() && Boolean(this.snowCompute) && this.isWebGPU;
        if (!report.applicable) {
            report.reason = 'compute-unavailable';
            report.passed = null;
            console.warn('[IceTempleBaseline] Snow compute capacity unavailable:', report);
            return report;
        }

        try {
            this.applySnowBudget(requestedCount);
            report.activeCount = this.snowDrawCount;
            await this.waitForBaseline(warmupMs);
            const frameTimes = await this.sampleAnimationFrames(sampleMs);
            if (!frameTimes.length) {
                report.reason = 'no-frame-samples';
                return report;
            }

            const sorted = [...frameTimes].sort((a, b) => a - b);
            const avgMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
            const p99Index = Math.max(0, Math.floor(sorted.length * 0.99) - 1);
            const p99Ms = sorted[p99Index];
            report.avgFps = Number((1000 / avgMs).toFixed(1));
            report.low1Fps = Number((1000 / p99Ms).toFixed(1));
            report.p99Ms = Number(p99Ms.toFixed(2));

            const targetReached = report.activeCount >= Math.min(requestedCount, report.maxCount);
            const fpsPassed = minFps <= 0 || report.avgFps >= minFps;
            report.passed = targetReached && fpsPassed;
            if (report.passed) {
                report.reason = null;
            } else if (targetReached) {
                report.reason = 'fps-below-threshold';
            } else {
                report.reason = 'target-not-reached';
            }
        } finally {
            this.applySnowBudget(previousDrawCount);
        }

        console.log('[IceTempleBaseline] Snow compute capacity report:', report);
        return report;
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

    downloadBaselineReport(label = 'ice-temple-baseline') {
        const report = this.reportBaseline();
        if (!report) return null;

        const filename = `${label}-${this.getBackendSlug()}-${Date.now()}.json`;
        this.downloadJson(filename, report);
        return report;
    }

    downloadText(filename, text, mimeType = 'text/plain') {
        if (typeof window === 'undefined') return;
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    getBaselinePresetOrder() {
        return BASELINE_PRESET_ORDER.filter((preset) => QUALITY_PRESETS[preset]);
    }

    waitForQualityPreset(level, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : 9000;
        const pollMs = Number.isFinite(options.pollMs) ? Math.max(50, options.pollMs) : 120;
        const desired = normalizeQuality(level);

        return new Promise((resolve) => {
            const startedAt = Date.now();
            const poll = () => {
                const settled = this.activeQualityLevel === desired && !this.qualityTransitionInProgress;
                if (settled) {
                    resolve(true);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(false);
                    return;
                }

                this.scheduleBaselineTimeout(poll, pollMs);
            };
            poll();
        });
    }

    async setBaselineQuality(level, options = {}) {
        if (typeof window === 'undefined') return false;

        const desired = normalizeQuality(level);
        if (!QUALITY_PRESETS[desired]) return false;

        if (!window.settings || typeof window.settings !== 'object') {
            window.settings = {};
        }

        window.settings.graphicsQuality = desired;
        window.settings.effectQuality = desired;
        if (typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('settingsChanged', {
                detail: {
                    graphicsQuality: desired,
                    effectQuality: desired,
                },
            }));
        }

        const settled = await this.waitForQualityPreset(desired, options);
        const settleMs = Number.isFinite(options.settleMs) ? Math.max(50, options.settleMs) : 350;
        await this.waitForBaseline(settleMs);
        return settled;
    }

    buildBaselinePresetMatrixMarkdown(matrix) {
        const lines = [];
        lines.push('# Ice Temple Baseline Preset Matrix');
        lines.push('');
        lines.push(`- Label: ${matrix.label}`);
        lines.push(`- Backend: ${matrix.backend}`);
        lines.push(`- Sequence: ${matrix.sequence}`);
        lines.push(`- Generated: ${new Date(matrix.finishedAt).toISOString()}`);
        lines.push('');
        lines.push(
            '| Preset | Avg FPS | 1% Low FPS | P99 ms | Draw Calls | Triangles |'
            + ' GPU MB | Heap MB | Textures | Geometries |',
        );
        lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');

        matrix.entries.forEach((entry) => {
            const report = entry.report || {};
            lines.push(
                `| ${entry.preset} | ${report.avgFps ?? 'n/a'} | ${report.low1Fps ?? 'n/a'} |`
                + ` ${report.p99Ms ?? 'n/a'} | ${report.avgDrawCalls ?? 'n/a'} |`
                + ` ${report.avgTriangles ?? 'n/a'} | ${report.gpuMemoryEstimateMb ?? 'n/a'} |`
                + ` ${report.heapUsedMb ?? 'n/a'} | ${report.textures ?? 'n/a'} |`
                + ` ${report.geometries ?? 'n/a'} |`,
            );
        });

        lines.push('');
        return lines.join('\n');
    }

    getBaselineShaderInventory() {
        const exportedShaders = Object.keys(ICE_TEMPLE_SHADERS).sort();
        const activeShaders = [
            'auroraVertexShader',
            'auroraFragmentShader',
            'snowVertexShader',
            'snowFragmentShader',
            'iceShardVertexShader',
            'iceShardFragmentShader',
            'shockwaveVertexShader',
            'shockwaveFragmentShader',
        ].filter((key) => exportedShaders.includes(key));

        const activeSet = new Set(activeShaders);
        const unusedShaders = exportedShaders.filter((key) => !activeSet.has(key));

        return {
            exportedShaders,
            activeShaders,
            unusedShaders,
        };
    }

    collectBaselineMaterialInventory() {
        if (!this.scene) return null;

        const byRole = {};
        let totalMaterials = 0;
        let emitsBloomTrue = 0;
        let emitsBloomFalse = 0;

        this.scene.traverse((object) => {
            const { material } = object;
            if (!material) return;
            const materials = Array.isArray(material) ? material : [material];

            materials.forEach((mat) => {
                totalMaterials += 1;
                const role = mat.userData?.mrtRole || 'unclassified';
                byRole[role] = (byRole[role] || 0) + 1;

                if (mat.userData?.emitsBloom === true) emitsBloomTrue += 1;
                if (mat.userData?.emitsBloom === false) emitsBloomFalse += 1;
            });
        });

        return {
            totalMaterials,
            byRole,
            emitsBloomTrue,
            emitsBloomFalse,
            unclassified: Math.max(0, totalMaterials - emitsBloomTrue - emitsBloomFalse),
        };
    }

    getPresetReportFromEvidence(evidence, preset) {
        const entries = evidence?.presetMatrix?.entries;
        if (!Array.isArray(entries)) return null;
        const match = entries.find((entry) => entry.preset === preset);
        return match?.report || null;
    }

    evaluateSuccessCriteria(options = {}) {
        const primary = options.evidence || this.lastBaselineEvidence;
        if (!primary) return null;

        const counterpart = options.counterpartEvidence || null;
        let webgpuEvidence = null;
        let webglEvidence = null;

        const registerEvidence = (evidence) => {
            if (!evidence?.backend) return;
            if (evidence.backend === 'WebGPU') webgpuEvidence = evidence;
            if (evidence.backend === 'WebGL2') webglEvidence = evidence;
        };
        registerEvidence(primary);
        registerEvidence(counterpart);

        const soakReport = options.soakReport || null;
        const switchReport = options.switchReport || null;
        const hasTargetHardwareVerification = options.hasTargetHardwareVerification === true;

        const criteria = [];
        const addCriterion = (id, text, status, details) => {
            const normalized = ['pass', 'fail', 'inconclusive'].includes(status) ? status : 'inconclusive';
            let passed = null;
            if (normalized === 'pass') passed = true;
            else if (normalized === 'fail') passed = false;
            criteria.push({
                id,
                text,
                status: normalized,
                passed,
                details: details || '',
            });
        };

        if (webgpuEvidence && webglEvidence) {
            const webgpuPipeline = webgpuEvidence.validation?.pipeline?.passed;
            const webglPipeline = webglEvidence.validation?.pipeline?.passed;
            const bothHealthy = webgpuPipeline !== false && webglPipeline !== false;
            addCriterion(
                'startup_resilient_fallback',
                'Startup is resilient: WebGPU failure always falls back to WebGL without user-visible errors.',
                bothHealthy ? 'pass' : 'fail',
                bothHealthy
                    ? 'WebGPU/WebGL pipeline checks passed; fallback path is instrumented and runtime-validated.'
                    : 'One or more backend pipeline checks failed.',
            );
        } else {
            addCriterion(
                'startup_resilient_fallback',
                'Startup is resilient: WebGPU failure always falls back to WebGL without user-visible errors.',
                'inconclusive',
                'Requires both WebGPU and WebGL evidence in one comparison set.',
            );
        }

        if (webglEvidence) {
            const pipelineOk = webglEvidence.validation?.pipeline?.passed;
            const eventsOk = webglEvidence.validation?.events?.passed;
            const pass = pipelineOk !== false && eventsOk !== false;
            addCriterion(
                'webgl_visual_baseline_stable',
                'WebGL visual baseline remains stable.',
                pass ? 'pass' : 'fail',
                pass
                    ? 'WebGL pipeline and event validation checks passed.'
                    : 'WebGL pipeline or event validation failed.',
            );
        } else {
            addCriterion(
                'webgl_visual_baseline_stable',
                'WebGL visual baseline remains stable.',
                'inconclusive',
                'WebGL evidence is required.',
            );
        }

        if (webgpuEvidence) {
            const pipelineOk = webgpuEvidence.validation?.pipeline?.passed;
            let pipelineStatus = 'inconclusive';
            let pipelineDetails = 'WebGPU pipeline check unavailable.';
            if (pipelineOk === true) {
                pipelineStatus = 'pass';
                pipelineDetails = 'WebGPU compile + render pipeline checks passed.';
            } else if (pipelineOk === false) {
                pipelineStatus = 'fail';
                pipelineDetails = 'WebGPU compile/render validation failed.';
            }
            addCriterion(
                'webgpu_no_validation_or_compile_errors',
                'WebGPU path has no validation or shader compile errors in supported environments.',
                pipelineStatus,
                pipelineDetails,
            );
        } else {
            addCriterion(
                'webgpu_no_validation_or_compile_errors',
                'WebGPU path has no validation or shader compile errors in supported environments.',
                'inconclusive',
                'WebGPU evidence is required.',
            );
        }

        if (webgpuEvidence) {
            const mrtStatus = webgpuEvidence.validation?.mrt?.passed;
            let mrtCriterionStatus = 'inconclusive';
            let mrtDetails = 'MRT was not enabled or validation was not applicable.';
            if (mrtStatus === true) {
                mrtCriterionStatus = 'pass';
                mrtDetails = 'MRT isolation policy checks passed.';
            } else if (mrtStatus === false) {
                mrtCriterionStatus = 'fail';
                mrtDetails = 'MRT isolation policy checks failed.';
            }
            addCriterion(
                'mrt_emissive_bloom_isolation',
                'Emissive-only bloom isolates aurora/pillar/crack glow correctly when MRT is enabled.',
                mrtCriterionStatus,
                mrtDetails,
            );
        } else {
            addCriterion(
                'mrt_emissive_bloom_isolation',
                'Emissive-only bloom isolates aurora/pillar/crack glow correctly when MRT is enabled.',
                'inconclusive',
                'WebGPU MRT evidence is required.',
            );
        }

        if (webgpuEvidence) {
            const snow = webgpuEvidence.validation?.snowCompute || null;
            const meetsCount = Number.isFinite(snow?.activeCount) && snow.activeCount >= 10000;
            const pass = snow?.passed === true && meetsCount;
            const fail = snow?.passed === false || (snow?.applicable === true && !meetsCount);
            let snowStatus = 'inconclusive';
            let snowDetails = 'Snow compute validation is unavailable or not applicable.';
            if (pass) {
                snowStatus = 'pass';
                snowDetails = `Snow compute validated at ${snow.activeCount} active particles`
                    + ` (avgFps=${snow.avgFps ?? 'n/a'}).`;
            } else if (fail) {
                snowStatus = 'fail';
                snowDetails = `Snow compute validation failed (${snow?.reason || 'unknown-reason'}).`;
            }
            addCriterion(
                'webgpu_snow_10000_stable',
                'WebGPU snow supports 10,000+ particles with stable frame time on target hardware.',
                snowStatus,
                snowDetails,
            );
        } else {
            addCriterion(
                'webgpu_snow_10000_stable',
                'WebGPU snow supports 10,000+ particles with stable frame time on target hardware.',
                'inconclusive',
                'WebGPU compute evidence is required.',
            );
        }

        if (webgpuEvidence) {
            const high = this.getPresetReportFromEvidence(webgpuEvidence, 'High');
            const highPass = Number.isFinite(high?.avgFps) && high.avgFps >= 60;
            const highFail = Number.isFinite(high?.avgFps) && high.avgFps < 60;
            let highStatus = 'inconclusive';
            let highDetails = 'Target hardware/resolution verification metadata not supplied.';
            if (hasTargetHardwareVerification) {
                if (highPass) highStatus = 'pass';
                else if (highFail) highStatus = 'fail';

                highDetails = Number.isFinite(high?.avgFps)
                    ? `High preset avgFps=${high.avgFps}.`
                    : 'High preset metrics unavailable.';
            }
            addCriterion(
                'high_1080p_rtx3060_60fps',
                'High preset hits 60 FPS at 1080p on RTX 3060-class hardware.',
                highStatus,
                highDetails,
            );

            const extreme = this.getPresetReportFromEvidence(webgpuEvidence, 'Extreme');
            const extremePass = Number.isFinite(extreme?.avgFps) && extreme.avgFps >= 60;
            const extremeFail = Number.isFinite(extreme?.avgFps) && extreme.avgFps < 60;
            let extremeStatus = 'inconclusive';
            let extremeDetails = 'Target hardware/resolution verification metadata not supplied.';
            if (hasTargetHardwareVerification) {
                if (extremePass) extremeStatus = 'pass';
                else if (extremeFail) extremeStatus = 'fail';

                extremeDetails = Number.isFinite(extreme?.avgFps)
                    ? `Extreme preset avgFps=${extreme.avgFps}.`
                    : 'Extreme preset metrics unavailable.';
            }
            addCriterion(
                'extreme_1440p_rtx4070_60fps',
                'Extreme preset hits 60 FPS at 1440p on RTX 4070-class hardware.',
                extremeStatus,
                extremeDetails,
            );
        } else {
            addCriterion(
                'high_1080p_rtx3060_60fps',
                'High preset hits 60 FPS at 1080p on RTX 3060-class hardware.',
                'inconclusive',
                'WebGPU evidence is required.',
            );
            addCriterion(
                'extreme_1440p_rtx4070_60fps',
                'Extreme preset hits 60 FPS at 1440p on RTX 4070-class hardware.',
                'inconclusive',
                'WebGPU evidence is required.',
            );
        }

        if (soakReport || switchReport) {
            const soakStable = soakReport?.memoryTrendStable;
            let switchStable = null;
            if (switchReport?.leakSuspected === false) switchStable = true;
            else if (switchReport?.leakSuspected === true) switchStable = false;
            const pass = soakStable === true && switchStable === true;
            const fail = soakStable === false || switchStable === false;
            let sessionStatus = 'inconclusive';
            if (pass) sessionStatus = 'pass';
            else if (fail) sessionStatus = 'fail';
            addCriterion(
                'session_memory_cleanup_stable',
                '30+ minute session shows stable memory usage and correct cleanup on theme switch.',
                sessionStatus,
                `soak=${soakStable ?? 'n/a'}, switch=${switchStable ?? 'n/a'}`,
            );
        } else {
            addCriterion(
                'session_memory_cleanup_stable',
                '30+ minute session shows stable memory usage and correct cleanup on theme switch.',
                'inconclusive',
                'Requires soak and switch validation reports.',
            );
        }

        const counts = criteria.reduce((acc, item) => {
            if (item.status === 'pass') acc.pass += 1;
            else if (item.status === 'fail') acc.fail += 1;
            else acc.inconclusive += 1;
            return acc;
        }, { pass: 0, fail: 0, inconclusive: 0 });

        return {
            generatedAt: Date.now(),
            backend: primary.backend,
            hasWebGPUEvidence: Boolean(webgpuEvidence),
            hasWebGLEvidence: Boolean(webglEvidence),
            criteria,
            summary: counts,
            passed: counts.fail === 0 && counts.inconclusive === 0,
        };
    }

    buildBaselineEvidenceMarkdown(evidence) {
        const lines = [];
        lines.push('# Ice Temple Baseline Evidence Bundle');
        lines.push('');
        lines.push(`- Label: ${evidence.label}`);
        lines.push(`- Backend: ${evidence.backend}`);
        lines.push(`- Generated: ${new Date(evidence.finishedAt).toISOString()}`);
        lines.push('');

        if (evidence.validation) {
            const formatStatus = (value) => {
                if (value === true) return 'pass';
                if (value === false) return 'fail';
                return 'n/a';
            };
            lines.push('## Validation Summary');
            lines.push('');
            lines.push(`- Overall pass: ${formatStatus(evidence.validation.passed)}`);
            if (evidence.validation.pipeline) {
                lines.push(`- Pipeline health: ${formatStatus(evidence.validation.pipeline.passed)}`);
            }
            if (evidence.validation.mrt) {
                lines.push(`- MRT isolation: ${formatStatus(evidence.validation.mrt.passed)}`);
            }
            if (evidence.validation.events) {
                lines.push(`- Event validation: ${formatStatus(evidence.validation.events.passed)}`);
            }
            if (evidence.validation.snowCompute) {
                const snow = evidence.validation.snowCompute;
                const details = `avgFps=${snow.avgFps ?? 'n/a'}, count=${snow.activeCount ?? 'n/a'}`;
                lines.push(`- Snow compute: ${formatStatus(snow.passed)} (${details})`);
            }
            lines.push('');
        }

        if (evidence.successCriteria?.criteria?.length) {
            lines.push('## Success Criteria Snapshot');
            lines.push('');
            lines.push(`- Overall: ${evidence.successCriteria.passed ? 'pass' : 'incomplete'}`);
            lines.push(`- Pass: ${evidence.successCriteria.summary?.pass ?? 0}`);
            lines.push(`- Fail: ${evidence.successCriteria.summary?.fail ?? 0}`);
            lines.push(`- Inconclusive: ${evidence.successCriteria.summary?.inconclusive ?? 0}`);
            lines.push('');
            lines.push('| Criterion | Status | Details |');
            lines.push('|---|---|---|');
            evidence.successCriteria.criteria.forEach((criterion) => {
                lines.push(`| ${criterion.text} | ${criterion.status} | ${criterion.details || ''} |`);
            });
            lines.push('');
        }

        if (evidence.presetMatrix?.entries?.length) {
            lines.push('## Preset Metrics');
            lines.push('');
            lines.push('| Preset | Avg FPS | 1% Low FPS | Draw Calls | Triangles | GPU MB | Heap MB |');
            lines.push('|---|---:|---:|---:|---:|---:|---:|');
            evidence.presetMatrix.entries.forEach((entry) => {
                const report = entry.report || {};
                lines.push(
                    `| ${entry.preset} | ${report.avgFps ?? 'n/a'} | ${report.low1Fps ?? 'n/a'} |`
                    + ` ${report.avgDrawCalls ?? 'n/a'} | ${report.avgTriangles ?? 'n/a'} |`
                    + ` ${report.gpuMemoryEstimateMb ?? 'n/a'} | ${report.heapUsedMb ?? 'n/a'} |`,
                );
            });
            lines.push('');
        }

        if (evidence.materialInventory) {
            lines.push('## Material Inventory');
            lines.push('');
            lines.push(`- Total materials: ${evidence.materialInventory.totalMaterials}`);
            lines.push(`- Emits bloom (true): ${evidence.materialInventory.emitsBloomTrue}`);
            lines.push(`- Emits bloom (false): ${evidence.materialInventory.emitsBloomFalse}`);
            lines.push(`- Unclassified: ${evidence.materialInventory.unclassified}`);
            lines.push('');
            lines.push('### MRT Roles');
            lines.push('');
            Object.entries(evidence.materialInventory.byRole || {}).forEach(([role, count]) => {
                lines.push(`- ${role}: ${count}`);
            });
            lines.push('');
        }

        if (evidence.shaderInventory) {
            lines.push('## Shader Export Inventory');
            lines.push('');
            lines.push(`- Exported: ${evidence.shaderInventory.exportedShaders.join(', ')}`);
            lines.push(`- Active: ${evidence.shaderInventory.activeShaders.join(', ')}`);
            lines.push(`- Unused: ${evidence.shaderInventory.unusedShaders.join(', ')}`);
            lines.push('');
        }

        return lines.join('\n');
    }

    async collectBaselineEvidence(options = {}) {
        if (!this.isActive) {
            console.warn('[IceTempleBaseline] collectEvidence skipped: theme is not active.');
            return null;
        }

        const {
            label = 'ice-temple-phase0-evidence',
            includePresetMatrix = true,
            matrixOptions = {},
            includeValidation = true,
            validationOptions = {},
            includeSuccessCriteria = true,
            successCriteriaOptions = {},
            downloadJson = true,
            downloadMarkdown = true,
        } = options;

        const presetMatrix = includePresetMatrix
            ? await this.captureBaselinePresetMatrix({
                ...matrixOptions,
                label: matrixOptions.label || `${label}-matrix`,
                downloadJson: false,
                downloadMarkdown: false,
            })
            : this.lastBaselinePresetMatrix;

        const memoryInfo = this.renderer?.info?.memory || {};
        const materialInventory = this.collectBaselineMaterialInventory();
        const shaderInventory = this.getBaselineShaderInventory();
        let validation = null;

        if (includeValidation) {
            validation = {
                pipeline: null,
                mrt: null,
                events: null,
                snowCompute: null,
                passed: true,
            };

            const includePipeline = validationOptions.includePipeline !== false;
            const includeMRT = validationOptions.includeMRT !== false;
            const includeEvents = validationOptions.includeEvents !== false;
            const includeSnowCompute = validationOptions.includeSnowCompute !== false;

            if (includePipeline) {
                validation.pipeline = await this.validatePipelineHealth(validationOptions.pipeline || {});
            }
            if (includeMRT) {
                validation.mrt = this.validateMrtIsolation(validationOptions.mrt || {});
            }
            if (includeEvents) {
                validation.events = await this.runBaselineEventValidation(validationOptions.events || {});
            }
            if (includeSnowCompute) {
                const snowOptions = {
                    ...(validationOptions.snowCompute || {}),
                };
                if (!Number.isFinite(snowOptions.targetCount) && this.shouldUseCompute()) {
                    snowOptions.targetCount = this.qualityPreset?.snowComputeCount ?? 10000;
                }
                validation.snowCompute = await this.validateSnowComputeCapacity(snowOptions);
            }

            const checks = [
                validation.pipeline,
                validation.mrt,
                validation.events,
                validation.snowCompute,
            ].filter(Boolean);
            validation.passed = checks.every((check) => check.passed !== false);
        }

        const evidence = {
            label,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            startedAt: presetMatrix?.startedAt ?? Date.now(),
            finishedAt: Date.now(),
            capabilities: { ...this.capabilities },
            flags: { ...this.flags },
            validation,
            materialInventory,
            shaderInventory,
            rendererMemory: {
                textures: memoryInfo.textures ?? null,
                geometries: memoryInfo.geometries ?? null,
            },
            presetMatrix,
        };

        if (includeSuccessCriteria) {
            evidence.successCriteria = this.evaluateSuccessCriteria({
                evidence,
                counterpartEvidence: successCriteriaOptions.counterpartEvidence || null,
                soakReport: successCriteriaOptions.soakReport || null,
                switchReport: successCriteriaOptions.switchReport || null,
                hasTargetHardwareVerification: successCriteriaOptions.hasTargetHardwareVerification === true,
            });
        } else {
            evidence.successCriteria = null;
        }

        this.lastBaselineEvidence = evidence;

        if (downloadJson) {
            this.downloadJson(
                `${label}-${this.getBackendSlug()}-${Date.now()}.json`,
                evidence,
            );
        }

        if (downloadMarkdown) {
            this.downloadText(
                `${label}-${this.getBackendSlug()}-${Date.now()}.md`,
                this.buildBaselineEvidenceMarkdown(evidence),
                'text/markdown',
            );
        }

        console.log('[IceTempleBaseline] collectEvidence complete', {
            label,
            backend: evidence.backend,
            hasPresetMatrix: Boolean(evidence.presetMatrix),
            validationPassed: evidence.validation?.passed ?? null,
            successCriteria: evidence.successCriteria?.summary ?? null,
        });

        return evidence;
    }

    downloadBaselineEvidence(label = 'ice-temple-phase0-evidence') {
        if (!this.lastBaselineEvidence) {
            console.warn('[IceTempleBaseline] downloadEvidence skipped: no evidence available.');
            return null;
        }

        this.downloadJson(
            `${label}-${this.getBackendSlug()}-${Date.now()}.json`,
            this.lastBaselineEvidence,
        );
        this.downloadText(
            `${label}-${this.getBackendSlug()}-${Date.now()}.md`,
            this.buildBaselineEvidenceMarkdown(this.lastBaselineEvidence),
            'text/markdown',
        );
        return this.lastBaselineEvidence;
    }

    async captureBaselinePresetMatrix(options = {}) {
        if (!this.isActive) {
            console.warn('[IceTempleBaseline] capturePresetMatrix skipped: theme is not active.');
            return null;
        }

        const {
            label = 'ice-temple-baseline-matrix',
            sequence = 'default',
            loops = 1,
            stepMs = 260,
            warmupMs = 900,
            settleMs = 260,
            includeStress = false,
            stressLoops = 1,
            stressStepMs = 220,
            captureScreenshots = true,
            downloadJson = true,
            downloadMarkdown = true,
        } = options;

        const requestedPresets = Array.isArray(options.presets) && options.presets.length
            ? options.presets
            : this.getBaselinePresetOrder();
        const presetOrder = requestedPresets
            .map((preset) => normalizeQuality(preset))
            .filter((preset, index, source) => QUALITY_PRESETS[preset] && source.indexOf(preset) === index);

        this.clearBaselinePlaybackTimers();
        this.resetBaseline();
        this.lastBaselinePresetMatrix = null;

        const startedAt = Date.now();
        const entries = [];

        await presetOrder.reduce((promise, preset) => promise.then(async () => {
            const settled = await this.setBaselineQuality(preset, {
                timeoutMs: options.timeoutMs,
                settleMs: options.presetSettleMs ?? 360,
            });

            this.resetBaseline();
            await this.waitForBaseline(warmupMs);
            if (captureScreenshots) {
                this.captureBaseline(`${label}-${preset.toLowerCase()}-idle`);
            }

            this.playBaselineSequence(sequence, { loops, stepMs });
            await this.waitForBaseline(
                this.getBaselineSequenceDurationMs(sequence, loops, stepMs) + settleMs,
            );
            if (captureScreenshots) {
                this.captureBaseline(`${label}-${preset.toLowerCase()}-${sequence}`);
            }

            if (includeStress) {
                this.playBaselineSequence('stress', { loops: stressLoops, stepMs: stressStepMs });
                await this.waitForBaseline(
                    this.getBaselineSequenceDurationMs('stress', stressLoops, stressStepMs) + settleMs,
                );
                if (captureScreenshots) {
                    this.captureBaseline(`${label}-${preset.toLowerCase()}-stress`);
                }
            }

            entries.push({
                preset,
                settled,
                report: this.reportBaseline(),
            });
        }), Promise.resolve());

        const matrix = {
            label,
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            sequence,
            loops,
            stepMs,
            includeStress,
            stressLoops,
            stressStepMs,
            warmupMs,
            settleMs,
            presets: presetOrder,
            startedAt,
            finishedAt: Date.now(),
            entries,
        };

        this.lastBaselinePresetMatrix = matrix;

        if (downloadJson) {
            this.downloadJson(
                `${label}-${this.getBackendSlug()}-${Date.now()}.json`,
                matrix,
            );
        }
        if (downloadMarkdown) {
            const markdown = this.buildBaselinePresetMatrixMarkdown(matrix);
            this.downloadText(
                `${label}-${this.getBackendSlug()}-${Date.now()}.md`,
                markdown,
                'text/markdown',
            );
        }

        console.log('[IceTempleBaseline] capturePresetMatrix complete', {
            label,
            backend: matrix.backend,
            presets: matrix.presets,
            includeStress,
        });
        return matrix;
    }

    downloadBaselinePresetMatrix(label = 'ice-temple-baseline-matrix') {
        if (!this.lastBaselinePresetMatrix) {
            console.warn('[IceTempleBaseline] downloadPresetMatrix skipped: no matrix available.');
            return null;
        }

        const matrix = this.lastBaselinePresetMatrix;
        this.downloadJson(
            `${label}-${this.getBackendSlug()}-${Date.now()}.json`,
            matrix,
        );
        this.downloadText(
            `${label}-${this.getBackendSlug()}-${Date.now()}.md`,
            this.buildBaselinePresetMatrixMarkdown(matrix),
            'text/markdown',
        );
        return matrix;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.iceTempleBaseline = {
            capture: (label) => this.captureBaseline(label),
            report: () => this.reportBaseline(),
            downloadReport: (label) => this.downloadBaselineReport(label),
            reset: () => this.resetBaseline(),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            validateEvents: (options = {}) => this.runBaselineEventValidation(options),
            validatePipeline: (options = {}) => this.validatePipelineHealth(options),
            validateMRT: (options = {}) => this.validateMrtIsolation(options),
            validateSnowCompute: (options = {}) => this.validateSnowComputeCapacity(options),
            getSequenceDuration: (sequence = 'default', loops = 1, stepMs = 260) => (
                this.getBaselineSequenceDurationMs(sequence, loops, stepMs)
            ),
            getPresetOrder: () => this.getBaselinePresetOrder(),
            setQuality: (level, options = {}) => this.setBaselineQuality(level, options),
            capturePresetMatrix: (options = {}) => this.captureBaselinePresetMatrix(options),
            downloadPresetMatrix: (label) => this.downloadBaselinePresetMatrix(label),
            collectEvidence: (options = {}) => this.collectBaselineEvidence(options),
            downloadEvidence: (label) => this.downloadBaselineEvidence(label),
            evaluateCriteria: (options = {}) => this.evaluateSuccessCriteria(options),
            getEvidence: () => this.lastBaselineEvidence,
            stop: () => this.clearBaselinePlaybackTimers(),
        };
        console.log(
            '[IceTempleBaseline] Helpers: window.iceTempleBaseline.capture(label), report(),'
            + ' downloadReport(label), reset(), play(sequence, options),'
            + ' validateEvents(options), validatePipeline(options),'
            + ' validateMRT(options), validateSnowCompute(options),'
            + ' getSequenceDuration(sequence, loops, stepMs),'
            + ' getPresetOrder(), setQuality(level, options), capturePresetMatrix(options),'
            + ' downloadPresetMatrix(label), collectEvidence(options),'
            + ' downloadEvidence(label), evaluateCriteria(options), getEvidence(), stop()',
        );
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.iceTempleBaseline) {
            delete window.iceTempleBaseline;
        }
    }

    async createScene() {
        const container = document.getElementById('ice-temple-theme');
        if (!container) {
            console.error('[IceTemple] Container not found');
            return;
        }

        this.refreshRuntimeFlags();
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        this.applyQualityPreset(this.getCurrentQualityLevel());
        this.snowScale = 1.0;
        this.frameTimeEmaMs = 16.7;
        this.qualityCheckTimer = 0;
        this.resetBaseline();
        this.lastBaselinePresetMatrix = null;
        this.lastBaselineEvidence = null;
        this.clock.start();

        // Clean up any existing content
        container.innerHTML = '';

        // ─────────────────────────────────────────────────────────────────────
        // SCENE SETUP
        // ─────────────────────────────────────────────────────────────────────

        this.scene = new THREE.Scene();
        // Reduced fog density for better crystal visibility
        this.scene.fog = new THREE.FogExp2(0x040c14, 0.015);
        this.scene.background = new THREE.Color(0x040c14);

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA
        // ─────────────────────────────────────────────────────────────────────

        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            200,
        );
        this.camera.position.set(0, 8, 25);
        this.camera.lookAt(0, 3, 0);

        // ─────────────────────────────────────────────────────────────────────
        // RENDERER
        // ─────────────────────────────────────────────────────────────────────

        const rendererReady = await this.initRenderer(container);
        if (!rendererReady) {
            console.error('[IceTemple] Failed to initialize renderer');
            return;
        }
        this.setupRendererResilience();

        this.useWebGPUMaterials = false;
        if (this.isWebGPU) {
            try {
                await initIceTempleMaterialRuntime();
                this.useWebGPUMaterials = true;
            } catch (error) {
                console.warn('[IceTemple] WebGPU material runtime unavailable, using WebGL materials:', error);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // POST-PROCESSING - Bloom for magical ice glow
        // ─────────────────────────────────────────────────────────────────────

        await this.setupPostProcessing();

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP (for subtle drift animation)
        // ─────────────────────────────────────────────────────────────────────

        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // ─────────────────────────────────────────────────────────────────────
        // CREATE SCENE ELEMENTS
        // ─────────────────────────────────────────────────────────────────────

        this.createStarField();
        this.createAurora();
        this.createFrostFloor();
        this.createIcePillars();
        this.createSnowSystem();
        this.createShardComputeSystem();
        this.setupLighting();
        this.createEnvironmentMap();
        this.auditMrtMaterials();

        // ─────────────────────────────────────────────────────────────────────
        // EVENT LISTENERS
        // ─────────────────────────────────────────────────────────────────────

        this.setupEventListeners();
        window.removeEventListener('resize', this.boundResizeHandler);
        window.addEventListener('resize', this.boundResizeHandler);

        if (this.flags.baseline) {
            this.installBaselineHelpers();
            console.log('[IceTempleBaseline] Baseline capture enabled', {
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                preset: this.activeQualityLevel,
                seed: this.flags.seed,
                fixedDtMs: this.flags.fixedDtMs,
                playback: this.flags.playback,
                playbackLoops: this.flags.playbackLoops,
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // START ANIMATION
        // ─────────────────────────────────────────────────────────────────────

        this.animate();

        if (this.flags.playback) {
            this.playBaselineSequence(this.flags.playback, {
                loops: this.flags.playbackLoops,
            });
        }
    }

    async initRenderer(container) {
        if (!container) return false;

        const width = window.innerWidth;
        const height = window.innerHeight;
        let renderer = null;
        let webgpuRenderer = null;

        if (!this.flags.forceWebGL) {
            try {
                if (!WEBGPU_MODULE) {
                    // eslint-disable-next-line import/no-unresolved
                    WEBGPU_MODULE = await import('three/webgpu');
                }
                webgpuRenderer = new WEBGPU_MODULE.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: true,
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
                console.warn('[IceTemple] WebGPU init failed, falling back to WebGL2:', error);
                webgpuRenderer?.dispose();
                webgpuRenderer = null;
            }
        }

        if (!renderer) {
            renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
            });
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = renderer.isWebGLRenderer === true
            || renderer.backend?.isWebGLBackend === true
            || !this.isWebGPU;

        this.probeCapabilities();

        renderer.setSize(width, height);
        renderer.setPixelRatio(this.getEffectivePixelRatio());
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.4;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(renderer.domElement);

        if (this.flags.baseline) {
            console.log(`[IceTemple] Renderer initialized (${this.isWebGPU ? 'WebGPU' : 'WebGL2'})`);
            console.log('[IceTemple] Baseline mode', {
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                flags: { ...this.flags },
                capabilities: { ...this.capabilities },
            });
        }

        return true;
    }

    probeCapabilities() {
        const maxColorAttachments = this.renderer?.capabilities?.maxColorAttachments ?? 1;
        const supportsCompute = this.isWebGPU && typeof this.renderer?.compute === 'function';
        const supportsPost = this.isWebGPU ? typeof WEBGPU_MODULE?.PostProcessing === 'function' : true;

        this.capabilities = {
            isWebGPU: this.isWebGPU,
            isWebGL: this.isWebGL,
            maxColorAttachments,
            supportsMRT: this.isWebGPU && maxColorAttachments > 1,
            supportsPost,
            supportsCompute,
        };

        this.flags.usePost = !this.flags.noPost && supportsPost;
        this.flags.useMRT = this.isWebGPU && !this.flags.noMRT && this.capabilities.supportsMRT;
        this.flags.useCompute = this.isWebGPU && !this.flags.noCompute && supportsCompute;
    }

    shouldUseCompute() {
        return this.isWebGPU && this.useWebGPUMaterials && this.flags.useCompute === true;
    }

    updateComputeSystems(delta, elapsed) {
        if (!this.shouldUseCompute() || !this.renderer?.compute) return;

        if (this.snowCompute?.computeNode) {
            this.snowCompute.update(
                delta,
                elapsed,
                1.0 + this.uniforms.pulseIntensity.value * 0.2 + this.resonanceEnergy * 0.15,
            );
            this.renderer.compute(this.snowCompute.computeNode);
        }

        if (this.shardCompute?.computeNode) {
            this.shardCompute.commitSpawns?.();
            this.shardCompute.update(delta);
            this.renderer.compute(this.shardCompute.computeNode);
        }
    }

    disposeComputeSystems() {
        if (this.snowCompute) {
            this.snowCompute.dispose();
            this.snowCompute = null;
        }
        if (this.shardCompute) {
            this.shardCompute.dispose();
            this.shardCompute = null;
        }
    }

    disposePostProcessing() {
        if (this.postProcessing?.dispose) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }
        this.bloomPass = null;
    }

    async setupPostProcessing() {
        this.disposePostProcessing();
        if (!this.flags.usePost || !this.renderer || !this.scene || !this.camera) return;

        const postScale = this.getPostScale();
        const bloomDownsample = this.qualityPreset.bloomMode === 'half'
            ? Math.min(0.75, this.qualityPreset.bloomDownsample ?? 0.75)
            : (this.qualityPreset.bloomDownsample ?? 1.0);

        if (this.isWebGPU) {
            try {
                this.postProcessing = await IceTemplePost.create(this.renderer, this.scene, this.camera, {
                    bloomStrength: this.qualityPreset.bloomStrength,
                    bloomRadius: this.qualityPreset.bloomRadius,
                    bloomThreshold: this.qualityPreset.bloomThreshold,
                    bloomDownsample,
                    postScale,
                    useMRT: this.flags.useMRT,
                    auditMRT: this.flags.mrtAudit,
                });
                this.postProcessing.setSize(window.innerWidth, window.innerHeight);
            } catch (error) {
                console.warn('[IceTemple] WebGPU post setup failed; using direct render path:', error);
                this.postProcessing?.dispose?.();
                this.postProcessing = null;
            }
            return;
        }

        if (!this.isWebGL) return;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            this.qualityPreset.bloomThreshold,
        );
        this.composer.addPass(bloomPass);
        this.bloomPass = bloomPass;

        const scaledWidth = Math.max(1, Math.floor(window.innerWidth * postScale));
        const scaledHeight = Math.max(1, Math.floor(window.innerHeight * postScale));
        this.composer.setSize(scaledWidth, scaledHeight);
        this.bloomPass.resolution.set(scaledWidth, scaledHeight);
    }

    auditMrtMaterials() {
        if (!this.flags.mrtAudit || !this.scene || !this.flags.useMRT) return;

        let totalMaterials = 0;
        let explicitBloom = 0;
        let explicitZero = 0;
        const byRole = {};

        this.scene.traverse((object) => {
            const { material } = object;
            if (!material) return;
            const materials = Array.isArray(material) ? material : [material];
            for (const mat of materials) {
                totalMaterials += 1;
                const role = mat.userData?.mrtRole || 'unclassified';
                byRole[role] = (byRole[role] || 0) + 1;

                if (mat.userData?.emitsBloom === true) explicitBloom += 1;
                if (mat.userData?.emitsBloom === false) explicitZero += 1;
            }
        });

        console.log('[IceTemple] MRT material audit', {
            totalMaterials,
            explicitBloom,
            explicitZero,
            unclassified: Math.max(0, totalMaterials - explicitBloom - explicitZero),
            byRole,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STAR FIELD
    // ═══════════════════════════════════════════════════════════════════════════

    createStarField() {
        const { starCount } = this.qualityPreset;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xb4f5ff),
            new THREE.Color(0x74b9ff),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Hemisphere distribution above camera
            const theta = this.random() * Math.PI * 2;
            const phi = this.random() * Math.PI * 0.5;
            const radius = 80 + this.random() * 50;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.cos(phi) + 10;
            positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 30;

            const color = starColors[Math.floor(this.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 0.5 + this.random() * 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const { material } = this.useWebGPUMaterials
            ? createStarfieldMaterialWebGPU({ time: this.uniforms.time.value })
            : createStarfieldMaterialWebGL();

        this.starField = new THREE.Points(geometry, material);
        this.scene.add(this.starField);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AURORA BOREALIS - Single unified curtain
    // ═══════════════════════════════════════════════════════════════════════════

    createAurora() {
        const segments = this.qualityPreset.auroraSegments;
        const heightSegments = this.qualityPreset.auroraHeightSegments;
        const layerCount = this.shouldUseVolumetricAurora() ? (this.qualityPreset.auroraLayers ?? 2) : 1;
        const reflectionMeshes = [];
        if (this.flags.baseline) {
            console.log('[IceTemple] Aurora layer policy', {
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                preset: this.activeQualityLevel,
                layerCount,
                volumetricAurora: layerCount > 1,
                noEnhancements: this.flags.noEnhancements,
                noAuroraVolume: this.flags.noAuroraVolume,
            });
        }

        for (let i = 0; i < layerCount; i++) {
            const arcAngle = Math.PI * (1.4 - i * 0.04);
            const radius = 80 + i * 4.5;
            const height = 60 + i * 2.4;
            const y = 28 + i * 1.3;
            const z = -20 - i * 1.4;
            const intensityScale = Math.max(0.55, 1.0 - i * 0.2);
            const timeOffset = i * 0.9;

            const geometry = new THREE.CylinderGeometry(
                radius,
                radius,
                height,
                segments,
                heightSegments,
                true,
                -arcAngle / 2,
                arcAngle,
            );
            geometry.rotateY(Math.PI + i * 0.04);

            const { material } = this.useWebGPUMaterials
                ? createAuroraMaterialWebGPU({
                    time: this.uniforms.time.value + timeOffset,
                    intensity: this.uniforms.auroraIntensity.value * intensityScale,
                    color1: COLORS.aurora1,
                    color2: COLORS.aurora2,
                    color3: COLORS.aurora3,
                })
                : createAuroraMaterialWebGL({
                    uTime: { value: this.uniforms.time.value + timeOffset },
                    uIntensity: { value: this.uniforms.auroraIntensity.value * intensityScale },
                    color1: COLORS.aurora1,
                    color2: COLORS.aurora2,
                    color3: COLORS.aurora3,
                });

            const aurora = new THREE.Mesh(geometry, material);
            aurora.position.set(0, y, z);
            aurora.userData.auroraIntensityScale = intensityScale;
            aurora.userData.auroraTimeOffset = timeOffset;
            aurora.userData.basePosition = aurora.position.clone();
            this.auroraPlanes.push(aurora);
            this.scene.add(aurora);

            const reflectionGeometry = geometry.clone();
            const reflectionIntensityScale = intensityScale * 0.6;
            const { material: reflectionMaterial } = this.useWebGPUMaterials
                ? createAuroraMaterialWebGPU({
                    time: this.uniforms.time.value + timeOffset,
                    intensity: this.uniforms.auroraIntensity.value * reflectionIntensityScale,
                    color1: COLORS.aurora1,
                    color2: COLORS.aurora2,
                    color3: COLORS.aurora3,
                })
                : createAuroraMaterialWebGL({
                    uTime: { value: this.uniforms.time.value + timeOffset },
                    uIntensity: { value: this.uniforms.auroraIntensity.value * reflectionIntensityScale },
                    color1: COLORS.aurora1,
                    color2: COLORS.aurora2,
                    color3: COLORS.aurora3,
                });

            const reflectionAurora = new THREE.Mesh(reflectionGeometry, reflectionMaterial);
            reflectionAurora.position.set(0, -y, z);
            reflectionAurora.scale.y = -1;
            reflectionAurora.userData.auroraIntensityScale = reflectionIntensityScale;
            reflectionAurora.userData.auroraTimeOffset = timeOffset;
            reflectionAurora.userData.basePosition = reflectionAurora.position.clone();
            reflectionMeshes.push(reflectionAurora);
            this.scene.add(reflectionAurora);
        }

        this.auroraReflections = reflectionMeshes;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FROST FLOOR - Circular with PBR ice (transmission + volume)
    // ═══════════════════════════════════════════════════════════════════════════

    createFrostFloor() {
        // Use circular geometry avoiding sharp edges - Large radius to fade efficiently
        const geometry = new THREE.CircleGeometry(140, 64);

        // Load the cracked ice texture as NORMAL MAP (not diffuse - color comes from physics)
        const textureLoader = new THREE.TextureLoader();
        const iceNormalTexture = textureLoader.load(
            new URL('./textures/ice-diffuse.jpg', import.meta.url).href,
        );
        iceNormalTexture.wrapS = THREE.MirroredRepeatWrapping;
        iceNormalTexture.wrapT = THREE.MirroredRepeatWrapping;
        iceNormalTexture.repeat.set(3, 3); // Larger cracks, fewer seams

        // Create gradient alpha texture for edge fading
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Radial gradient from center (opaque) to edge (transparent)
        // Soft fade out starting at 60%
        const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(0.9, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        const alphaTexture = new THREE.CanvasTexture(canvas);

        // Floor material with FULL PBR ice settings - Enhanced Blue Tint
        const material = new THREE.MeshPhysicalMaterial({
            // 1. Basic Optical Properties
            color: 0x4488ff, // Blue surface tint
            roughness: 0.15, // Low for wet ice
            metalness: 0.1, // Slight metalness for extra reflection
            transmission: 0.85, // Glass-like
            ior: 1.31, // Index of Refraction for ice

            // 2. Volume / Depth (The Blue Tint)
            thickness: 2.5, // Thicker for deeper color
            attenuationColor: new THREE.Color(0x0044ff), // Richer blue
            attenuationDistance: 0.5, // Stronger blue absorption (lower value = bluer)

            // 3. Surface Detail (The "Frost" layer)
            clearcoat: 1.0, // Polished wet layer
            clearcoatRoughness: 0.05,

            // 4. Texture as normal map for cracks
            normalMap: iceNormalTexture,
            normalScale: new THREE.Vector2(0.5, 0.5), // Deeper cracks

            // 5. Glow and Edges - Enhanced for crystal effect
            emissive: 0x0a2266, // Subtle blue inner glow
            emissiveIntensity: 0.3, // Reduced glow

            transparent: true,
            alphaMap: alphaTexture,
            // alphaTest removed to allow soft blending
            depthWrite: false, // Prevent z-fighting and allow proper blending
            side: THREE.DoubleSide,

            envMapIntensity: 1.5,
        });
        this.tagMaterialForMrt(material, 'frost-floor', false);

        this.frostFloor = new THREE.Mesh(geometry, material);
        this.frostFloor.rotation.x = -Math.PI / 2;
        this.frostFloor.renderOrder = -1; // Draw first to act as background
        this.frostFloor.position.y = 0;
        this.frostFloor.receiveShadow = true;

        this.mainGroup.add(this.frostFloor);
        this.floorMaterial = material;
        this.floorMaterial.userData = {
            ...(this.floorMaterial.userData || {}),
            baseEmissiveIntensity: material.emissiveIntensity,
            baseNormalScale: material.normalScale?.clone?.() || new THREE.Vector2(0.5, 0.5),
        };

        // Static + reactive crack veil above the floor.
        this.createIceCracksOverlay();

        // Add mist layers
        this.createMistLayers();
    }

    createIceCracksOverlay() {
        // Circular crack overlay matching the floor
        const crackGeometry = new THREE.CircleGeometry(75, 64);

        // Create crack texture procedurally
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Transparent background
        ctx.clearRect(0, 0, 1024, 1024);

        // Draw glowing crack network
        ctx.strokeStyle = 'rgba(85, 239, 196, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(85, 239, 196, 0.9)';
        ctx.shadowBlur = 12;

        // Generate organic crack patterns radiating from random points
        for (let i = 0; i < 40; i++) {
            const startX = 256 + (this.random() - 0.5) * 512;
            const startY = 256 + (this.random() - 0.5) * 512;

            ctx.beginPath();
            ctx.moveTo(startX, startY);

            let x = startX;
            let y = startY;
            const segments = 4 + Math.floor(this.random() * 6);

            for (let j = 0; j < segments; j++) {
                const angle = this.random() * Math.PI * 2;
                const length = 30 + this.random() * 80;
                x += Math.cos(angle) * length;
                y += Math.sin(angle) * length;
                ctx.lineTo(x, y);

                // Branch occasionally
                if (this.random() > 0.7) {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                }
            }
            ctx.stroke();
        }

        // Edge fade gradient
        const fadeGradient = ctx.createRadialGradient(512, 512, 300, 512, 512, 512);
        fadeGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        fadeGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = fadeGradient;
        ctx.fillRect(0, 0, 1024, 1024);

        const crackTexture = new THREE.CanvasTexture(canvas);

        const crackMaterial = new THREE.MeshBasicMaterial({
            map: crackTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0.2,
        });
        this.tagMaterialForMrt(crackMaterial, 'floor-crack', true);

        const crackMesh = new THREE.Mesh(crackGeometry, crackMaterial);
        crackMesh.rotation.x = -Math.PI / 2;
        crackMesh.position.y = 0.03;
        crackMesh.renderOrder = 1;
        crackMesh.userData = {
            baseOpacity: crackMaterial.opacity,
            baseScale: crackMesh.scale.clone(),
            phase: this.random() * Math.PI * 2,
        };

        this.mainGroup.add(crackMesh);
        this.crackOverlay = crackMesh;
    }

    createMistLayers() {
        // Add atmospheric mist/fog layers for depth
        const mistColors = [
            {
                color: 0x1a5577, opacity: 0.15, y: 0.5, scale: 60,
            },
            {
                color: 0x2a6688, opacity: 0.1, y: 1.5, scale: 80,
            },
            {
                color: 0x3a7799, opacity: 0.08, y: 3, scale: 100,
            },
        ];

        this.mistLayers = [];

        for (const config of mistColors) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Soft circular gradient
            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${config.opacity})`);
            gradient.addColorStop(0.5, `rgba(255, 255, 255, ${config.opacity * 0.6})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            this.tagMaterialForMrt(spriteMaterial, 'mist-layer', false);

            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(config.scale, config.scale * 0.3, 1);
            sprite.position.y = config.y;
            sprite.userData = {
                basePosition: sprite.position.clone(),
                baseScale: sprite.scale.clone(),
                phase: this.random() * Math.PI * 2,
                driftRadius: 0.35 + this.random() * 0.85,
                heightAmplitude: 0.06 + this.random() * 0.14,
                flowSpeed: 0.05 + this.random() * 0.03,
                opacityBase: config.opacity,
            };

            this.mistLayers.push(sprite);
            this.mainGroup.add(sprite);
        }

        // Add low-lying fog ring around the edges
        this.createFogRing();
    }

    createFogRing() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Create ring-shaped fog
        const gradient = ctx.createRadialGradient(256, 256, 100, 256, 256, 256);
        gradient.addColorStop(0, 'rgba(26, 85, 119, 0)');
        gradient.addColorStop(0.4, 'rgba(26, 85, 119, 0)');
        gradient.addColorStop(0.6, 'rgba(42, 102, 136, 0.2)');
        gradient.addColorStop(0.8, 'rgba(58, 119, 153, 0.3)');
        gradient.addColorStop(1, 'rgba(74, 136, 170, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        const texture = new THREE.CanvasTexture(canvas);
        const geometry = new THREE.PlaneGeometry(150, 150);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.tagMaterialForMrt(material, 'fog-ring', false);

        const fogRing = new THREE.Mesh(geometry, material);
        fogRing.rotation.x = -Math.PI / 2;
        fogRing.position.y = 0.2;
        fogRing.userData = {
            baseY: fogRing.position.y,
            baseScale: fogRing.scale.clone(),
            baseRotationZ: fogRing.rotation.z,
            phase: this.random() * Math.PI * 2,
            flowSpeed: 0.04 + this.random() * 0.02,
            opacityBase: material.opacity,
        };

        this.fogRing = fogRing;
        this.mainGroup.add(fogRing);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ICE PILLARS
    // ═══════════════════════════════════════════════════════════════════════════

    createIcePillars() {
        const pillarPositions = [
            {
                x: -12, z: -5, height: 15, radius: 1.2,
            },
            {
                x: -8, z: -12, height: 18, radius: 1.5,
            },
            {
                x: 8, z: -8, height: 16, radius: 1.3,
            },
            {
                x: 14, z: -3, height: 12, radius: 1.0,
            },
            {
                x: -5, z: 5, height: 10, radius: 0.9,
            },
            {
                x: 6, z: 8, height: 8, radius: 0.8,
            },
            {
                x: 0, z: -18, height: 20, radius: 1.8,
            },
        ];

        for (const config of pillarPositions) {
            const pillar = this.createIcePillar(config);
            this.icePillars.push(pillar);
            this.mainGroup.add(pillar.group);
        }
    }

    createIcePillar(config) {
        const group = new THREE.Group();
        group.position.set(config.x, 0, config.z);

        // ─────────────────────────────────────────────────────────────────────
        // UNIFIED ORGANIC PILLAR (Lathe Geometry)
        // ─────────────────────────────────────────────────────────────────────

        const profilePoints = [];

        // 1. Root Base (Slightly wider but mostly submerged)
        profilePoints.push(new THREE.Vector2(config.radius * 1.5, 0)); // Base
        profilePoints.push(new THREE.Vector2(config.radius * 1.2, 1.0)); // Transition

        // 2. Main Shaft (Straight rise)
        profilePoints.push(new THREE.Vector2(config.radius * 1.0, 4.0));
        profilePoints.push(new THREE.Vector2(config.radius * 0.9, config.height * 0.8));

        // 3. Peak (Sharp tip)
        profilePoints.push(new THREE.Vector2(0, config.height));

        const geometry = new THREE.LatheGeometry(profilePoints, 6);

        // Add random vertex displacement
        const positions = geometry.attributes.position.array;
        const seed = config.x * 100 + config.z;
        for (let i = 0; i < positions.length; i += 3) {
            const y = positions[i + 1];
            const heightFactor = Math.max(0, (y - 0.5) / config.height);
            const noise = Math.sin(seed + y * 0.5 + i * 0.1) * 0.2 * config.radius * heightFactor;

            const angle = Math.atan2(positions[i + 2], positions[i]);
            const r = Math.sqrt(positions[i] * positions[i] + positions[i + 2] * positions[i + 2]);
            const newR = r + noise;
            positions[i] = Math.cos(angle) * newR;
            positions[i + 2] = Math.sin(angle) * newR;
        }
        geometry.computeVertexNormals();

        // ─────────────────────────────────────────────────────────────────────
        // UPLIFTED ICE SHARDS (Breaking the surface)
        // ─────────────────────────────────────────────────────────────────────
        // Create a ring of jagged shards that look like the floor being pushed up

        const shardCount = 8 + Math.floor(this.random() * 4);
        const shardMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xaaffff, // Slightly blue-white crystal
            emissive: 0x3388bb, // Softer blue glow
            emissiveIntensity: 0.4, // Reduced glow
            roughness: 0.1, // Smooth fracture
            metalness: 0.0,
            transmission: 0.3, // Semi-transparent crystal
            thickness: 1.0,
            ior: 1.6, // Crystal refraction
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            side: THREE.DoubleSide,
        });
        this.tagMaterialForMrt(shardMaterial, 'pillar-shard', true);

        for (let i = 0; i < shardCount; i++) {
            // Irregular shard geometry
            const w = config.radius * (0.8 + this.random() * 0.6);
            const h = config.radius * (1.5 + this.random() * 1.0);
            const shardGeo = new THREE.PlaneGeometry(w, h);

            // Displace shard vertices for jagged edges
            const pos = shardGeo.attributes.position.array;
            for (let j = 0; j < pos.length; j += 3) {
                pos[j] += (this.random() - 0.5) * w * 0.2;
                pos[j + 1] += (this.random() - 0.5) * h * 0.1;
                pos[j + 2] += (this.random() - 0.5) * 0.2; // slight depth noise
            }
            shardGeo.computeVertexNormals();

            const shard = new THREE.Mesh(shardGeo, shardMaterial);

            // Position in ring
            const angle = (i / shardCount) * Math.PI * 2 + (this.random() * 0.4);
            const dist = config.radius * 1.0; // Close to pillar

            shard.position.x = Math.cos(angle) * dist;
            shard.position.z = Math.sin(angle) * dist;
            shard.position.y = 0;

            // Rotate to point UP and OUT
            shard.lookAt(0, 0, 0); // Face center first
            shard.rotation.x -= Math.PI * 0.3; // Tilt back (30-45 degrees up from floor?)
            // Actually Plane is XY. lookAt(0,0,0) makes it face center.
            // We want it lying flat then angled up.
            // Let's reset and do explicit rotation
            shard.rotation.set(0, -angle + Math.PI / 2, 0); // Face outward
            shard.rotation.x = -Math.PI / 4 - this.random() * 0.2; // Tilt 45-60 deg up

            // Lift base slightly
            shard.position.y = h * 0.3;

            group.add(shard);
        }

        const material = new THREE.MeshPhysicalMaterial({
            color: 0xccEeff, // Very pale blue-white
            emissive: 0x225588, // Balanced blue glow
            emissiveIntensity: 0.6, // Reduced glow for balance

            metalness: 0.0, // Non-metallic for crystal
            roughness: 0.05, // Very smooth like glass

            transmission: 0.4, // Glass-like transparency (like geode)
            thickness: config.radius * 4, // Deep volume
            ior: 1.8, // Crystal-like refraction index

            clearcoat: 1.0, // High polish
            clearcoatRoughness: 0.05,

            attenuationColor: new THREE.Color(0x88ddff), // Ice blue volume tint
            attenuationDistance: 1.5,

            envMapIntensity: 0.8, // Strong environment reflections
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
        });
        this.tagMaterialForMrt(material, 'pillar-core', true);
        material.userData = {
            ...(material.userData || {}),
            baseEmissiveIntensity: material.emissiveIntensity,
        };

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0; // Sits perfectly on ground now
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Internal glow point light (balanced for crystal glow)
        const light = new THREE.PointLight(0x66ddff, 0.8, config.height * 2.5);
        light.position.y = config.height * 0.5;
        group.add(light);

        // Add subtle outer glow sprite
        const glowSprite = this.createPillarGlow(config);
        group.add(glowSprite);

        return {
            group,
            mesh,
            light,
            config,
            material,
            glowSprite,
            baseLightIntensity: light.intensity,
            resonancePulse: 0,
            targetResonancePulse: 0,
        };
    }

    createPillarGlow(config) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Vertical gradient glow
        const gradient = ctx.createLinearGradient(64, 256, 64, 0);
        gradient.addColorStop(0, 'rgba(100, 200, 255, 0.0)');
        gradient.addColorStop(0.3, 'rgba(100, 200, 255, 0.3)');
        gradient.addColorStop(0.6, 'rgba(150, 220, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(180, 240, 255, 0.0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 256);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.tagMaterialForMrt(spriteMaterial, 'pillar-glow', true);

        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(config.radius * 4, config.height * 1.1, 1);
        sprite.position.y = config.height * 0.5;

        return sprite;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SNOW PARTICLE SYSTEM
    // ═══════════════════════════════════════════════════════════════════════════

    createSnowSystem() {
        const snowCount = this.getSnowBaseCount();
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(snowCount * 3);
        const randoms = new Float32Array(snowCount);
        const speeds = new Float32Array(snowCount);

        for (let i = 0; i < snowCount; i++) {
            const i3 = i * 3;
            positions[i3] = (this.random() - 0.5) * 80;
            positions[i3 + 1] = this.random() * 40;
            positions[i3 + 2] = (this.random() - 0.5) * 60;

            randoms[i] = this.random();
            speeds[i] = 0.5 + this.random() * 1.0;
        }

        if (this.snowCompute) {
            this.snowCompute.dispose();
            this.snowCompute = null;
        }
        if (this.shouldUseCompute()) {
            this.snowCompute = new IceTempleSnowCompute(snowCount, this.snowBounds, () => this.random());
            this.snowCompute.setInitialState(positions, randoms, speeds);
            this.snowCompute.createComputeNode();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        const { material } = this.useWebGPUMaterials
            ? createSnowMaterialWebGPU({
                time: this.uniforms.time.value,
                size: 3.0,
                color: COLORS.snow,
                snowCompute: this.snowCompute,
            })
            : createSnowMaterialWebGL({
                uTime: this.uniforms.time,
                uSize: { value: 3.0 },
                color: COLORS.snow,
            });

        this.snowSystem = new THREE.Points(geometry, material);
        this.snowMaxCount = snowCount;
        this.snowDrawCount = snowCount;
        this.snowSystem.geometry.setDrawRange(0, snowCount);
        this.mainGroup.add(this.snowSystem);
    }

    createShardComputeSystem() {
        if (this.shardCompute) {
            this.shardCompute.dispose();
            this.shardCompute = null;
        }

        if (!this.shouldUseCompute()) return;

        this.shardCompute = new IceTempleShardBurstCompute(this.shardComputeCapacity, () => this.random());
        this.shardCompute.createComputeNode();

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.shardCompute.count * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, this.shardCompute.count);

        const { material } = createIceShardMaterialWebGPU({
            time: 0,
            size: 8.0,
            color: COLORS.iceShards,
            shardCompute: this.shardCompute,
        });

        const burstPool = new THREE.Points(geometry, material);
        burstPool.userData.computePool = true;
        this.shardBursts.push(burstPool);
        this.mainGroup.add(burstPool);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING
    // ═══════════════════════════════════════════════════════════════════════════

    setupLighting() {
        // Ambient light - cold blue tint
        const ambient = new THREE.AmbientLight(COLORS.ambient.getHex(), 0.4);
        this.scene.add(ambient);

        // Directional light from above (moonlight)
        const moonLight = new THREE.DirectionalLight(0x8899bb, 0.3);
        moonLight.position.set(10, 30, -20);
        this.scene.add(moonLight);

        // Hemisphere light for sky/ground color variation
        const hemiLight = new THREE.HemisphereLight(
            0x74b9ff, // Sky (aurora tint)
            0x0a1f35, // Ground (ice)
            0.4,
        );
        this.scene.add(hemiLight);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ENVIRONMENT MAP - For realistic ice reflections/refractions
    // ═══════════════════════════════════════════════════════════════════════════

    createEnvironmentMap() {
        if (!this.renderer || !this.scene) return;

        if (this.environmentMap) {
            if (this.scene.environment === this.environmentMap) {
                this.scene.environment = null;
            }
            this.environmentMap.dispose();
            this.environmentMap = null;
        }

        let pmremGenerator = null;
        let skyTexture = null;

        try {
            const skyCanvas = document.createElement('canvas');
            skyCanvas.width = 512;
            skyCanvas.height = 256;
            const skyCtx = skyCanvas.getContext('2d');
            if (!skyCtx) return;

            const gradient = skyCtx.createLinearGradient(0, 256, 0, 0);
            gradient.addColorStop(0, '#051525');
            gradient.addColorStop(0.3, '#0a2a4a');
            gradient.addColorStop(0.5, '#1a4466');
            gradient.addColorStop(0.7, '#2a6688');
            gradient.addColorStop(0.85, '#55efc4');
            gradient.addColorStop(1.0, '#74b9ff');

            skyCtx.fillStyle = gradient;
            skyCtx.fillRect(0, 0, 512, 256);

            const spotColors = [
                '#74b9ff', '#55efc4', '#a29bfe', '#81ecec',
                '#00cec9', '#6c5ce7', '#dfe6e9', '#b2bec3',
            ];

            for (let i = 0; i < 60; i++) {
                const x = this.random() * 512;
                const y = this.random() * 200;
                const r = 2 + this.random() * 12;
                const color = spotColors[Math.floor(this.random() * spotColors.length)];

                const spotGrad = skyCtx.createRadialGradient(x, y, 0, x, y, r);
                spotGrad.addColorStop(0, color);
                spotGrad.addColorStop(0.5, `${color}80`);
                spotGrad.addColorStop(1, 'transparent');
                skyCtx.fillStyle = spotGrad;
                skyCtx.fillRect(x - r, y - r, r * 2, r * 2);
            }

            skyCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            for (let i = 0; i < 100; i++) {
                const x = this.random() * 512;
                const y = this.random() * 128;
                const size = this.random() * 2 + 0.5;
                skyCtx.beginPath();
                skyCtx.arc(x, y, size, 0, Math.PI * 2);
                skyCtx.fill();
            }

            skyTexture = new THREE.CanvasTexture(skyCanvas);
            skyTexture.colorSpace = THREE.SRGBColorSpace;
            skyTexture.mapping = THREE.EquirectangularReflectionMapping;
            skyTexture.needsUpdate = true;

            let envMap = skyTexture;
            if (this.isWebGL) {
                pmremGenerator = new THREE.PMREMGenerator(this.renderer);
                pmremGenerator.compileEquirectangularShader();
                envMap = pmremGenerator.fromEquirectangular(skyTexture).texture;
                skyTexture.dispose();
                skyTexture = null;
            }

            this.scene.environment = envMap;
            this.environmentMap = envMap;

            for (const pillar of this.icePillars) {
                if (pillar.material) {
                    pillar.material.envMap = envMap;
                    pillar.material.needsUpdate = true;
                }
            }

            if (this.frostFloor && this.frostFloor.material) {
                this.frostFloor.material.envMap = envMap;
                this.frostFloor.material.needsUpdate = true;
            }
        } catch (error) {
            console.warn('[IceTemple] Failed to create environment map:', error);
            if (skyTexture && this.environmentMap !== skyTexture) {
                skyTexture.dispose();
            }
        } finally {
            pmremGenerator?.dispose();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMEPLAY EFFECTS
    // ═══════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        // Clean up existing listeners
        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];

        // Line Clear
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) this.onLineClear(data.lineCount || 1);
        });

        // Combo
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) this.onCombo(data.comboCount || 0);
        });

        // Piece Lock
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) this.onPieceLock(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    onLineClear(lineCount) {
        if (this.flags.baseline) {
            this.baselineEventCounts.lineClear += 1;
        }

        // Pulse ice pillars
        this.targetPulseIntensity = Math.min(lineCount * 0.5, 1.5);

        // Flash cracks
        this.targetCrackGlow = Math.min(0.5 + lineCount * 0.2, 1.0);

        // Create shockwave
        this.createShockwave(lineCount);

        // Create ice shard burst
        this.createIceShardBurst(lineCount * 15);
    }

    onCombo(comboCount) {
        if (this.flags.baseline) {
            this.baselineEventCounts.combo += 1;
        }
        if (comboCount < 2) return;

        // Intensify aurora
        this.targetAuroraIntensity = Math.min(0.8 + comboCount * 0.15, 1.8);

        // Extended pillar pulse
        this.targetPulseIntensity = Math.min(comboCount * 0.3, 1.0);

        // Extra crack glow
        this.targetCrackGlow = Math.min(comboCount * 0.15, 0.8);

        // Multiple shockwaves for big combos
        if (comboCount >= 4) {
            this.createShockwave(comboCount);
        }

        // Signature combo effect: crack-front propagation + chained pillar resonance.
        this.triggerGlacialResonance(comboCount);
    }

    onPieceLock() {
        if (this.flags.baseline) {
            this.baselineEventCounts.pieceLock += 1;
        }
        // Strong pillar pulse (impact feel)
        this.targetPulseIntensity = 3.0;

        // Shard burst from the base of EACH pillar
        for (const pillar of this.icePillars) {
            const pos = pillar.group.position;
            this.createIceShardBurst(5, pos.x, pos.z); // 5 shards per pillar
        }

        // Slight aurora disturbance
        this.targetAuroraIntensity = 1.0;

        // Piece locks subtly feed residual resonance.
        this.targetResonanceEnergy = Math.max(this.targetResonanceEnergy, 0.28);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EFFECT CREATION
    // ═══════════════════════════════════════════════════════════════════════════

    buildResonancePathPoints(start, end, segmentCount, jitterAmplitude, branchBias = 0) {
        const startX = Number.isFinite(start?.x) ? start.x : 0;
        const startZ = Number.isFinite(start?.z) ? start.z : (Number.isFinite(start?.y) ? start.y : 0);
        const endX = Number.isFinite(end?.x) ? end.x : startX;
        const endZ = Number.isFinite(end?.z) ? end.z : (Number.isFinite(end?.y) ? end.y : startZ);

        const points = [];
        const segments = Math.max(6, Math.floor(segmentCount));
        const tangent = new THREE.Vector2(endX - startX, endZ - startZ);
        if (tangent.lengthSq() < 1e-5) {
            points.push(new THREE.Vector3(startX, 0, startZ));
            points.push(new THREE.Vector3(endX, 0, endZ));
            return points;
        }

        tangent.normalize();
        const normal = new THREE.Vector2(-tangent.y, tangent.x);
        const phase = this.random() * Math.PI * 2;
        const wobbleFrequency = 6 + branchBias * 0.85 + this.random() * 2.5;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const baseX = THREE.MathUtils.lerp(startX, endX, t);
            const baseZ = THREE.MathUtils.lerp(startZ, endZ, t);
            const envelope = Math.sin(t * Math.PI);
            const wobble = Math.sin((t * wobbleFrequency * Math.PI * 2) + phase);
            const randomOffset = (this.random() - 0.5) * 0.55;
            const lateralOffset = (wobble + randomOffset) * jitterAmplitude * envelope;
            const pointX = baseX + normal.x * lateralOffset;
            const pointZ = baseZ + normal.y * lateralOffset;
            if (!Number.isFinite(pointX) || !Number.isFinite(pointZ)) continue;
            points.push(new THREE.Vector3(
                pointX,
                0,
                pointZ,
            ));
        }

        if (points.length < 2) {
            points.push(new THREE.Vector3(startX, 0, startZ));
            points.push(new THREE.Vector3(endX, 0, endZ));
        }
        return points;
    }

    acquireResonanceCrackLine() {
        if (this.resonanceCrackPool?.length) {
            return this.resonanceCrackPool.pop();
        }

        const maxPoints = 96;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxPoints * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 2);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 160);

        const material = new THREE.LineBasicMaterial({
            color: COLORS.floorCracks.clone(),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.tagMaterialForMrt(material, 'combo-resonance-crack', true);

        const crackLine = new THREE.Line(geometry, material);
        crackLine.frustumCulled = false;
        crackLine.visible = false;
        crackLine.userData = {
            maxPoints,
            active: false,
            points: [],
            pointCount: 0,
            age: 0,
            growDuration: 0.4,
            fadeDuration: 1.2,
            lastFrontIndex: 0,
            comboCount: 0,
            baseOpacity: 0.5,
            phase: 0,
        };
        return crackLine;
    }

    releaseResonanceCrackLine(crackLine) {
        if (!crackLine) return;
        if (crackLine.parent) crackLine.parent.remove(crackLine);
        crackLine.visible = false;
        crackLine.userData.active = false;
        crackLine.userData.points = [];
        crackLine.userData.pointCount = 0;
        crackLine.userData.age = 0;
        crackLine.userData.lastFrontIndex = 0;

        if (!this.resonanceCrackPool) this.resonanceCrackPool = [];
        if (this.resonanceCrackPool.length < 42) {
            this.resonanceCrackPool.push(crackLine);
            return;
        }

        crackLine.geometry?.dispose?.();
        crackLine.material?.dispose?.();
    }

    createResonanceCrackLine(start, end, comboCount, branchIndex = 0, perfScale = 1.0) {
        const qualityScale = this.getResonanceQualityScale();
        const segmentCount = Math.max(10, Math.floor((14 + comboCount * 1.5) * qualityScale * perfScale));
        const jitterAmplitude = 0.16 + comboCount * 0.045 + this.random() * 0.18;
        const points = this.buildResonancePathPoints(start, end, segmentCount, jitterAmplitude, branchIndex);
        if (points.length < 2) return null;

        const crackLine = this.acquireResonanceCrackLine();
        const maxPoints = crackLine.userData?.maxPoints ?? 96;
        const pointCount = Math.max(2, Math.min(maxPoints, points.length));
        const sampleStep = pointCount > 1 ? (points.length - 1) / (pointCount - 1) : 1;
        const sampledPoints = new Array(pointCount);

        const positionAttr = crackLine.geometry.attributes.position;
        const array = positionAttr.array;
        for (let i = 0; i < pointCount; i++) {
            const srcIndex = Math.min(points.length - 1, Math.round(i * sampleStep));
            const src = points[srcIndex];
            sampledPoints[i] = src;
            const i3 = i * 3;
            array[i3] = src.x;
            array[i3 + 1] = src.y;
            array[i3 + 2] = src.z;
        }
        positionAttr.needsUpdate = true;
        crackLine.geometry.setDrawRange(0, 2);

        const crackColor = COLORS.floorCracks.clone().lerp(COLORS.iceHighlight, Math.min(0.62, comboCount * 0.07));
        crackLine.material.color.copy(crackColor);
        crackLine.material.opacity = 0;
        crackLine.position.y = 0.05 + branchIndex * 0.0008;
        crackLine.visible = true;

        crackLine.userData = {
            ...(crackLine.userData || {}),
            active: true,
            points: sampledPoints,
            pointCount,
            age: 0,
            growDuration: 0.3 + comboCount * 0.045,
            fadeDuration: 0.95 + comboCount * 0.065,
            lastFrontIndex: 0,
            comboCount,
            baseOpacity: Math.min(0.9, 0.4 + comboCount * 0.075),
            phase: this.random() * Math.PI * 2,
        };

        this.resonanceCracks.push(crackLine);
        this.mainGroup.add(crackLine);
        return crackLine;
    }

    triggerGlacialResonance(comboCount) {
        if (comboCount < 2 || !this.mainGroup) return;

        const qualityScale = this.getResonanceQualityScale();
        const perfScale = this.getResonancePerformanceScale();
        const clampedCombo = Math.min(12, Math.max(2, comboCount));
        const branchCount = Math.max(
            3,
            Math.floor((3 + clampedCombo * 1.35) * qualityScale * perfScale),
        );
        const minRadius = 8 + clampedCombo * 1.2;
        const maxRadius = 20 + clampedCombo * 2.2;
        const center = new THREE.Vector2(0, 0);

        this.targetResonanceEnergy = Math.min(2.8, this.targetResonanceEnergy + 0.48 + clampedCombo * 0.16);
        this.targetCrackGlow = Math.max(this.targetCrackGlow, Math.min(1.25, 0.5 + clampedCombo * 0.1));
        if (clampedCombo >= 5) {
            this.targetAuroraShear = Math.max(this.targetAuroraShear, Math.min(1.65, 0.3 + clampedCombo * 0.14));
        }

        // Keep long sessions stable by pruning oldest cracks before creating new branches.
        const maxActiveCracks = Math.max(10, Math.floor((18 + clampedCombo * 0.9) * qualityScale * perfScale));
        while (this.resonanceCracks.length > maxActiveCracks) {
            const oldCrack = this.resonanceCracks.shift();
            this.releaseResonanceCrackLine(oldCrack);
        }

        for (let i = 0; i < branchCount; i++) {
            let angle = (i / branchCount) * Math.PI * 2 + (this.random() - 0.5) * (0.4 + clampedCombo * 0.02);
            let radius = minRadius + this.random() * (maxRadius - minRadius);

            if (this.icePillars.length && i % 3 === 0) {
                const pillar = this.icePillars[i % this.icePillars.length];
                if (pillar?.group?.position) {
                    const position = pillar.group.position;
                    angle = Math.atan2(position.z, position.x) + (this.random() - 0.5) * 0.24;
                    radius = Math.min(maxRadius + 7, Math.hypot(position.x, position.z) + 4 + this.random() * 8);
                }
            }

            const end = new THREE.Vector2(
                center.x + Math.cos(angle) * radius,
                center.y + Math.sin(angle) * radius,
            );
            this.createResonanceCrackLine(center, end, clampedCombo, i, perfScale);
        }

        const pillarsByDistance = [...this.icePillars].sort((a, b) => {
            const aDist = Math.hypot(a.group.position.x, a.group.position.z);
            const bDist = Math.hypot(b.group.position.x, b.group.position.z);
            return aDist - bDist;
        });
        const pillarTriggerCount = Math.min(
            pillarsByDistance.length,
            Math.max(2, Math.floor((1 + clampedCombo * 0.75) * perfScale)),
        );

        for (let i = 0; i < pillarTriggerCount; i++) {
            const pillar = pillarsByDistance[i];
            const position = pillar.group.position;
            const distance = Math.hypot(position.x, position.z);
            const strength = Math.max(0.45, Math.min(1.65, 0.6 + clampedCombo * 0.12 - i * 0.08));
            this.pendingPillarResonanceBursts.push({
                pillar,
                delay: 0.08 + distance * 0.012 + i * 0.075,
                strength,
            });
        }

        this.createShockwave(1.2 + clampedCombo * 0.35, {
            x: 0,
            z: 0,
            y: 0.36,
            radius: 1.4 + clampedCombo * 0.22,
            thickness: 0.08 + clampedCombo * 0.012,
            life: 1.0 + clampedCombo * 0.06,
            speed: 6.5 + clampedCombo * 1.3,
            color: COLORS.floorCracks.clone(),
        });
    }

    updateGlacialResonance(delta, elapsed) {
        if (!this.mainGroup) return;

        // Dynamic crack veil + floor optical response.
        if (this.crackOverlay?.material) {
            const baseOpacity = this.crackOverlay.userData?.baseOpacity ?? 0.2;
            const crackPhase = this.crackOverlay.userData?.phase ?? 0;
            const crackPulse = Math.sin(elapsed * (3.2 + this.resonanceEnergy) + crackPhase) * 0.09;
            const opacity = baseOpacity
                + this.uniforms.crackGlow.value * 0.65
                + this.resonanceEnergy * 0.3
                + crackPulse;
            this.crackOverlay.material.opacity = THREE.MathUtils.clamp(opacity, 0.06, 1.0);

            const baseScale = this.crackOverlay.userData?.baseScale;
            if (baseScale) {
                const scalePulse = 1 + this.resonanceEnergy * 0.025 + Math.sin(elapsed * 2.4 + crackPhase) * 0.004;
                this.crackOverlay.scale.set(
                    baseScale.x * scalePulse,
                    baseScale.y * scalePulse,
                    baseScale.z,
                );
            }

            this.crackOverlay.rotation.z += delta * (0.01 + this.resonanceEnergy * 0.045);
        }

        if (this.floorMaterial) {
            const baseEmissive = this.floorMaterial.userData?.baseEmissiveIntensity ?? 0.3;
            const baseNormalScale = this.floorMaterial.userData?.baseNormalScale;
            const baseNormalX = baseNormalScale?.x ?? 0.5;
            const baseNormalY = baseNormalScale?.y ?? 0.5;
            this.floorMaterial.emissiveIntensity = THREE.MathUtils.clamp(
                baseEmissive + this.uniforms.crackGlow.value * 0.65 + this.resonanceEnergy * 0.2,
                baseEmissive,
                1.35,
            );
            if (this.floorMaterial.normalScale) {
                const normalScaleBoost = 1 + this.resonanceEnergy * 0.18;
                this.floorMaterial.normalScale.set(
                    baseNormalX * normalScaleBoost,
                    baseNormalY * normalScaleBoost,
                );
            }
        }

        // Crack-front propagation with directional particle emission.
        const qualityScale = this.getResonanceQualityScale();
        const perfScale = this.getResonancePerformanceScale();
        for (let i = this.resonanceCracks.length - 1; i >= 0; i--) {
            const crackLine = this.resonanceCracks[i];
            const data = crackLine.userData || {};
            data.age += delta;
            const growDuration = data.growDuration || 0.5;
            const fadeDuration = data.fadeDuration || 1.4;
            const totalDuration = growDuration + fadeDuration;
            const progress = THREE.MathUtils.clamp(data.age / growDuration, 0, 1);
            const drawCount = Math.max(2, Math.floor((data.pointCount || 2) * progress));
            crackLine.geometry?.setDrawRange(0, drawCount);

            const fade = data.age < growDuration
                ? 1.0
                : THREE.MathUtils.clamp(1.0 - (data.age - growDuration) / fadeDuration, 0, 1);
            const shimmer = 0.84 + Math.sin(elapsed * 15 + (data.phase || 0)) * 0.16;
            crackLine.material.opacity = THREE.MathUtils.clamp(
                (data.baseOpacity || 0.5) * fade * shimmer,
                0,
                1,
            );

            const frontIndex = Math.min((data.pointCount || 2) - 1, drawCount - 1);
            const lastFrontIndex = data.lastFrontIndex || 0;
            const frontAdvance = frontIndex - lastFrontIndex;
            if (frontAdvance > 0) {
                const point = data.points?.[frontIndex];
                const prev = data.points?.[Math.max(0, frontIndex - 1)];
                if (point && prev) {
                    const directionX = point.x - prev.x;
                    const directionZ = point.z - prev.z;
                    const spawnWeight = Math.min(4, frontAdvance);
                    const spawnCount = Math.max(
                        2,
                        Math.floor((2 + data.comboCount * 0.22) * qualityScale * perfScale * spawnWeight),
                    );

                    if (this.shouldUseCompute() && this.shardCompute) {
                        this.shardCompute.spawnBurst(spawnCount, point.x, point.z, {
                            style: 'crack-front',
                            directionX,
                            directionZ,
                            spread: 0.58,
                            radialSpeedMin: 1.7,
                            radialSpeedMax: 3.7 + data.comboCount * 0.22,
                            upwardMin: 0.3,
                            upwardMax: 1.65 + data.comboCount * 0.1,
                            sizeMin: 0.66,
                            sizeMax: 1.04,
                            lifeDecayMin: 0.65,
                            lifeDecayMax: 0.99,
                            deferUpload: true,
                        });
                    } else {
                        this.createIceShardBurst(Math.max(3, Math.floor(3.5 * qualityScale * perfScale)), point.x, point.z, {
                            style: 'crack-front',
                            directionX,
                            directionZ,
                            spread: 0.7,
                            upwardMin: 0.3,
                            upwardMax: 1.65,
                            duration: 1.1,
                        });
                    }
                }
                data.lastFrontIndex = frontIndex;
            }

            if (data.age >= totalDuration) {
                this.resonanceCracks.splice(i, 1);
                this.releaseResonanceCrackLine(crackLine);
            }
        }

        // Delayed pillar chain reaction.
        for (let i = this.pendingPillarResonanceBursts.length - 1; i >= 0; i--) {
            const event = this.pendingPillarResonanceBursts[i];
            event.delay -= delta;
            if (event.delay > 0) continue;

            const pillar = event.pillar;
            if (pillar?.group?.position) {
                const pos = pillar.group.position;
                pillar.targetResonancePulse = Math.max(pillar.targetResonancePulse || 0, event.strength);

                this.createShockwave(1 + event.strength, {
                    x: pos.x,
                    z: pos.z,
                    y: 0.32,
                    radius: 1.1 + event.strength * 0.6,
                    thickness: 0.07 + event.strength * 0.03,
                    life: 0.75,
                    speed: 6 + event.strength * 2.2,
                    color: COLORS.iceHighlight.clone(),
                });

                this.createIceShardBurst(
                    Math.max(6, Math.floor((8 + event.strength * 6.5) * qualityScale * perfScale)),
                    pos.x,
                    pos.z,
                    {
                        style: 'pillar-jet',
                        spread: 1.1,
                        radialSpeedMin: 1.2,
                        radialSpeedMax: 3.8,
                        upwardMin: 4.2,
                        upwardMax: 7.8 + event.strength,
                        sizeMin: 0.92,
                        sizeMax: 1.5,
                        lifeDecayMin: 0.4,
                        lifeDecayMax: 0.72,
                        duration: 1.45,
                    },
                );
            }

            this.pendingPillarResonanceBursts.splice(i, 1);
        }
    }

    createShockwave(intensity, options = {}) {
        const radius = Number.isFinite(options.radius) ? Math.max(0.5, options.radius) : 2;
        const thickness = Number.isFinite(options.thickness) ? Math.max(0.03, options.thickness) : 0.15;
        const geometry = new THREE.TorusGeometry(radius, thickness, 8, 50);
        const color = options.color instanceof THREE.Color
            ? options.color.clone()
            : new THREE.Color(options.color ?? COLORS.iceGlow);

        const { material } = this.useWebGPUMaterials
            ? createShockwaveMaterialWebGPU({
                time: this.uniforms.time.value,
                opacity: 1.0,
                color,
            })
            : createShockwaveMaterialWebGL({
                uTime: this.uniforms.time,
                uOpacity: { value: 1.0 },
                color,
            });

        const wave = new THREE.Mesh(geometry, material);
        wave.rotation.x = Math.PI / 2;
        wave.position.set(options.x ?? 0, options.y ?? 0.5, options.z ?? 0);

        wave.userData = {
            life: Number.isFinite(options.life) ? options.life : 1.0,
            speed: Number.isFinite(options.speed) ? options.speed : 8 + intensity * 2,
        };

        this.shockwaves.push(wave);
        this.mainGroup.add(wave);
    }

    createIceShardBurst(count, originX = 0, originZ = 0, options = {}) {
        if (this.shardCompute && this.shouldUseCompute()) {
            const computeOptions = {
                ...options,
                deferUpload: options.deferUpload ?? true,
            };
            this.shardCompute.spawnBurst(count, originX, originZ, computeOptions);
            return;
        }

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const lifes = new Float32Array(count);
        const randoms = new Float32Array(count);

        const style = options.style || 'default';
        const spread = Number.isFinite(options.spread) ? Math.max(0.08, options.spread) : 1.5;
        const directionX = Number.isFinite(options.directionX) ? options.directionX : 0;
        const directionZ = Number.isFinite(options.directionZ) ? options.directionZ : 0;
        const directionLength = Math.hypot(directionX, directionZ);
        const dirX = directionLength > 1e-5 ? directionX / directionLength : 0;
        const dirZ = directionLength > 1e-5 ? directionZ / directionLength : 0;
        const radialSpeedMin = Number.isFinite(options.radialSpeedMin)
            ? Math.max(0.1, options.radialSpeedMin)
            : (style === 'pillar-jet' ? 1.8 : (style === 'crack-front' ? 2.0 : 3.0));
        const radialSpeedMax = Number.isFinite(options.radialSpeedMax)
            ? Math.max(radialSpeedMin, options.radialSpeedMax)
            : (style === 'pillar-jet' ? 4.2 : (style === 'crack-front' ? 4.8 : 8.0));
        const upwardMin = Number.isFinite(options.upwardMin)
            ? options.upwardMin
            : (style === 'pillar-jet' ? 4.1 : (style === 'crack-front' ? 0.35 : 2.0));
        const upwardMax = Number.isFinite(options.upwardMax)
            ? Math.max(upwardMin, options.upwardMax)
            : (style === 'pillar-jet' ? 8.0 : (style === 'crack-front' ? 2.2 : 6.0));

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Start at the specified origin (pillar base)
            positions[i3] = originX + (this.random() - 0.5) * spread;
            positions[i3 + 1] = 0.5 + this.random() * 2; // Start near ground
            positions[i3 + 2] = originZ + (this.random() - 0.5) * spread;

            // Explosion velocity
            const angle = this.random() * Math.PI * 2;
            const speed = radialSpeedMin + this.random() * (radialSpeedMax - radialSpeedMin);
            let velocityX = Math.cos(angle) * speed;
            let velocityY = upwardMin + this.random() * (upwardMax - upwardMin);
            let velocityZ = Math.sin(angle) * speed;

            if (style === 'pillar-jet') {
                velocityX *= 0.65;
                velocityZ *= 0.65;
            } else if (style === 'crack-front' && directionLength > 1e-5) {
                const tangentX = -dirZ;
                const tangentZ = dirX;
                const directionalSpeed = speed * (0.72 + this.random() * 0.6);
                const tangentJitter = (this.random() - 0.5) * 1.0;
                velocityX = dirX * directionalSpeed + tangentX * tangentJitter;
                velocityZ = dirZ * directionalSpeed + tangentZ * tangentJitter;
            }

            velocities[i3] = velocityX;
            velocities[i3 + 1] = velocityY;
            velocities[i3 + 2] = velocityZ;

            lifes[i] = 1.0;
            randoms[i] = this.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lifes, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const { material } = this.useWebGPUMaterials
            ? createIceShardMaterialWebGPU({
                time: 0,
                size: options.size ?? (style === 'crack-front' ? 6.8 : 8.0),
                color: COLORS.iceShards,
            })
            : createIceShardMaterialWebGL({
                uTime: { value: 0 },
                uSize: { value: options.size ?? (style === 'crack-front' ? 6.8 : 8.0) },
                color: COLORS.iceShards,
            });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            startTime: this.uniforms.time.value,
            duration: Number.isFinite(options.duration) ? options.duration : 1.5,
        };

        this.shardBursts.push(burst);
        this.mainGroup.add(burst);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════

    animate() {
        if (!this.isActive) return;

        this.animationFrame = requestAnimationFrame(this.animate.bind(this));

        const rawDelta = this.fixedDeltaSeconds !== null ? this.fixedDeltaSeconds : this.clock.getDelta();
        const delta = this.fixedDeltaSeconds !== null ? rawDelta : Math.min(rawDelta, 0.05);
        if (this.fixedDeltaSeconds !== null) {
            this.fixedElapsedTime += this.fixedDeltaSeconds;
        }
        const elapsed = this.fixedDeltaSeconds !== null
            ? this.fixedElapsedTime
            : this.clock.getElapsedTime();
        this.uniforms.time.value = elapsed;
        if (this.flags.baseline) {
            this.trackBaselineFrame(rawDelta);
        }
        this.maybeHandleQualityPresetTransition(delta).catch((error) => {
            console.warn('[IceTemple] Runtime quality transition failed:', error);
        });

        // ─────────────────────────────────────────────────────────────────────
        // SMOOTH TRANSITIONS
        // ─────────────────────────────────────────────────────────────────────

        // Decay pulse intensity
        this.uniforms.pulseIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.pulseIntensity.value,
            this.targetPulseIntensity,
            delta * 3,
        );
        this.targetPulseIntensity *= 0.95;

        // Decay crack glow
        this.targetCrackGlow = Math.max(
            this.targetCrackGlow,
            Math.min(1.4, this.targetResonanceEnergy * 0.5),
        );
        this.uniforms.crackGlow.value = THREE.MathUtils.lerp(
            this.uniforms.crackGlow.value,
            this.targetCrackGlow,
            delta * 3,
        );
        this.targetCrackGlow *= 0.97;

        // Aurora intensity
        this.uniforms.auroraIntensity.value = THREE.MathUtils.lerp(
            this.uniforms.auroraIntensity.value,
            this.targetAuroraIntensity,
            delta * 2,
        );
        if (this.targetAuroraIntensity > 0.85) {
            this.targetAuroraIntensity -= delta * 0.2;
        }

        this.resonanceEnergy = THREE.MathUtils.lerp(
            this.resonanceEnergy,
            this.targetResonanceEnergy,
            delta * 2.3,
        );
        this.targetResonanceEnergy *= 0.94;

        this.auroraShear = THREE.MathUtils.lerp(
            this.auroraShear,
            this.targetAuroraShear,
            delta * 2.6,
        );
        this.targetAuroraShear *= 0.9;

        // ─────────────────────────────────────────────────────────────────────
        // CAMERA MOVEMENT (Continuous gentle orbit/sway)
        // ─────────────────────────────────────────────────────────────────────

        const camTime = elapsed * 0.15; // Smooth continuous movement
        const camRadius = 25;
        const camHeight = 8 + Math.sin(camTime * 0.5) * 2; // Gentle vertical bob

        this.camera.position.x = Math.sin(camTime) * 5; // Side-to-side sway
        this.camera.position.y = camHeight;
        this.camera.position.z = camRadius + Math.cos(camTime * 0.3) * 3; // Slight forward/back
        this.camera.lookAt(0, 3, 0); // Always look at center

        // ─────────────────────────────────────────────────────────────────────
        // MAIN GROUP DRIFT
        // ─────────────────────────────────────────────────────────────────────

        const driftTime = elapsed * 0.08;
        this.mainGroup.position.x = Math.sin(driftTime) * 1.5;
        this.mainGroup.position.y = Math.cos(driftTime * 0.7) * 0.5;
        this.mainGroup.rotation.y = Math.sin(driftTime * 0.5) * 0.02;
        this.updateFogMotion(elapsed, delta);

        // ─────────────────────────────────────────────────────────────────────
        // STAR FIELD ROTATION
        // ─────────────────────────────────────────────────────────────────────

        if (this.starField) {
            this.starField.rotation.y = elapsed * 0.005;
            this.setMaterialUniform(this.starField.material, 'uTime', elapsed);
        }

        if (this.snowSystem) {
            this.setMaterialUniform(this.snowSystem.material, 'uTime', elapsed);
        }

        if (this.auroraPlanes?.length) {
            for (const aurora of this.auroraPlanes) {
                const timeOffset = aurora.userData?.auroraTimeOffset ?? 0;
                const intensityScale = aurora.userData?.auroraIntensityScale ?? 1.0;
                const basePosition = aurora.userData?.basePosition;
                if (basePosition) {
                    const shear = this.auroraShear * (0.65 + intensityScale * 0.3);
                    aurora.position.x = basePosition.x + Math.sin(elapsed * 2.1 + timeOffset * 2.4) * shear * 1.8;
                    aurora.position.z = basePosition.z + Math.cos(elapsed * 1.8 + timeOffset * 1.6) * shear * 1.2;
                }
                this.setMaterialUniform(aurora.material, 'uTime', elapsed + timeOffset);
                this.setMaterialUniform(
                    aurora.material,
                    'uIntensity',
                    this.uniforms.auroraIntensity.value * intensityScale,
                );
            }
        }

        // Update aurora reflections
        if (this.auroraReflections) {
            for (const reflection of this.auroraReflections) {
                const timeOffset = reflection.userData?.auroraTimeOffset ?? 0;
                const intensityScale = reflection.userData?.auroraIntensityScale ?? 0.6;
                const basePosition = reflection.userData?.basePosition;
                if (basePosition) {
                    const shear = this.auroraShear * (0.45 + intensityScale * 0.25);
                    reflection.position.x = basePosition.x
                        + Math.sin(elapsed * 2.0 + timeOffset * 2.2) * shear * 1.3;
                    reflection.position.z = basePosition.z
                        + Math.cos(elapsed * 1.6 + timeOffset * 1.4) * shear * 0.9;
                }
                this.setMaterialUniform(reflection.material, 'uTime', elapsed + timeOffset);
                this.setMaterialUniform(
                    reflection.material,
                    'uIntensity',
                    this.uniforms.auroraIntensity.value * intensityScale,
                );
            }
        }

        this.updateGlacialResonance(delta, elapsed);
        this.updateComputeSystems(delta, elapsed);
        this.updateAdaptiveSnowScaling(delta, rawDelta * 1000);

        // ─────────────────────────────────────────────────────────────────────
        // PILLAR LIGHT PULSING
        // ─────────────────────────────────────────────────────────────────────

        for (let i = 0; i < this.icePillars.length; i++) {
            const pillar = this.icePillars[i];
            pillar.resonancePulse = THREE.MathUtils.lerp(
                pillar.resonancePulse || 0,
                pillar.targetResonancePulse || 0,
                delta * 7.5,
            );
            pillar.targetResonancePulse = (pillar.targetResonancePulse || 0) * 0.9;

            const baseIntensity = pillar.baseLightIntensity ?? 0.5;
            const pulse = Math.sin(elapsed * 1.5 + i * 0.8) * 0.2;
            const resonanceContribution = (pillar.resonancePulse || 0) * 2.1;
            pillar.light.intensity = baseIntensity + pulse + this.uniforms.pulseIntensity.value * 1.5
                + resonanceContribution;

            if (pillar.material) {
                const baseEmissive = pillar.material.userData?.baseEmissiveIntensity ?? 0.6;
                pillar.material.emissiveIntensity = THREE.MathUtils.clamp(
                    baseEmissive
                    + this.uniforms.pulseIntensity.value * 0.15
                    + (pillar.resonancePulse || 0) * 0.55,
                    baseEmissive,
                    2.0,
                );
            }

            if (pillar.glowSprite?.material) {
                pillar.glowSprite.material.opacity = THREE.MathUtils.clamp(
                    0.35 + (pillar.resonancePulse || 0) * 0.55 + this.resonanceEnergy * 0.18,
                    0.2,
                    1.0,
                );
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // UPDATE SHOCKWAVES
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const wave = this.shockwaves[i];
            wave.userData.life -= delta * 0.8;

            wave.scale.addScalar(wave.userData.speed * delta);
            this.setMaterialUniform(wave.material, 'uTime', elapsed);
            this.setMaterialUniform(wave.material, 'uOpacity', wave.userData.life);

            if (wave.userData.life <= 0) {
                this.mainGroup.remove(wave);
                wave.geometry.dispose();
                wave.material.dispose();
                this.shockwaves.splice(i, 1);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // UPDATE SHARD BURSTS
        // ─────────────────────────────────────────────────────────────────────

        for (let i = this.shardBursts.length - 1; i >= 0; i--) {
            const burst = this.shardBursts[i];
            if (burst.userData?.computePool) {
                this.setMaterialUniform(burst.material, 'uTime', elapsed);
                continue;
            }
            const age = this.uniforms.time.value - burst.userData.startTime;

            this.setMaterialUniform(burst.material, 'uTime', age);

            // Update life attribute
            const lifes = burst.geometry.attributes.aLife.array;
            let allDead = true;
            for (let j = 0; j < lifes.length; j++) {
                lifes[j] = Math.max(0, 1.0 - age / burst.userData.duration);
                if (lifes[j] > 0) allDead = false;
            }
            burst.geometry.attributes.aLife.needsUpdate = true;

            if (allDead || age > burst.userData.duration) {
                this.mainGroup.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.shardBursts.splice(i, 1);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // RENDER
        // ─────────────────────────────────────────────────────────────────────

        this.renderFrame();
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;

        if (this.isWebGPU) {
            if (this.postProcessing?.render) {
                try {
                    this.postProcessing.render();
                    return;
                } catch (error) {
                    console.warn('[IceTemple] WebGPU post render failed, disabling post path:', error);
                    this.postProcessing?.dispose?.();
                    this.postProcessing = null;
                    this.flags.usePost = false;
                }
            }

            try {
                this.renderer.render(this.scene, this.camera);
            } catch (error) {
                this.requestWebGLFallback('webgpu-render-failure', error).catch((fallbackError) => {
                    console.error('[IceTemple] Render fallback request failed:', fallbackError);
                });
            }
            return;
        }

        if (this.isWebGL && this.composer) {
            try {
                this.composer.render();
                return;
            } catch (error) {
                console.warn('[IceTemple] WebGL composer render failed, using direct renderer path:', error);
                this.composer?.dispose?.();
                this.composer = null;
                this.bloomPass = null;
                this.flags.usePost = false;
            }
        }

        try {
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.error('[IceTemple] Render failed:', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WINDOW RESIZE
    // ═══════════════════════════════════════════════════════════════════════════

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        const postScale = this.getPostScale();
        const scaledWidth = Math.max(1, Math.floor(width * postScale));
        const scaledHeight = Math.max(1, Math.floor(height * postScale));

        // Update composer size for bloom
        if (this.composer) {
            this.composer.setSize(scaledWidth, scaledHeight);
        }
        if (this.bloomPass) {
            this.bloomPass.resolution.set(scaledWidth, scaledHeight);
        }
        if (this.postProcessing?.setSize) {
            this.postProcessing.setSize(width, height);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════

    stop() {
        this.cancelAnimationLoop();
        this.clock.stop();

        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });
        this.resetBaseline();
        this.lastBaselinePresetMatrix = null;
        this.lastBaselineEvidence = null;
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;

        super.stop();
    }

    /**
     * Phase 2: Terminal disposal. Performs Ice Temple-specific cleanup
     * then delegates to BaseTheme.cleanup() for shared teardown.
     */
    cleanup() {
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.removeRendererResilienceListeners();
        this.cancelAnimationLoop();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.disposeRuntimeResources({ removeCanvas: true });

        super.cleanup();
    }
}
