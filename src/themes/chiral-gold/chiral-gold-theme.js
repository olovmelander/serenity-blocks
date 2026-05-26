/* eslint-disable max-lines */
/**
 * Chiral Gold Theme - WebGPU first, WebGL fallback.
 * Tetris Effect-inspired reactive choreography with a dark gold void aesthetic.
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { mrt, vec3 } from 'three/tsl';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { CHIRAL_GOLD_TETROMINOS } from './chiral-gold-tetrominos.js';
import { ChiralGoldPost } from './chiral-gold-post.js';
import {
    ChiralGoldDustCompute,
    ChiralGoldBurstCompute,
    ChiralGoldWispCompute,
} from './chiral-gold-compute.js';
import {
    createBurstSparkNodeMaterial,
    createGoldDustNodeMaterial,
    createLightBeamNodeMaterial,
    createStrandNodeMaterial,
    createWispNodeMaterial,
} from './chiral-gold-materials.js';
import {
    ChiralGoldChromaticShader,
    ChiralGoldFilmGrainShader,
    ChiralGoldVignetteShader,
    burstSparkFragmentShader,
    burstSparkVertexShader,
    goldDustFragmentShader,
    goldDustVertexShader,
    strandFragmentShader,
    strandVertexShader,
    wispFragmentShader,
    wispVertexShader,
} from './chiral-gold-shaders.js';
import { clamp } from '@utils/helpers.js';

function createSeededRandom(seed) {
    if (!Number.isFinite(seed)) return () => Math.random();
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state <= 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function parseChiralGoldFlags() {
    const defaults = {
        forceWebGL: false,
        noCompute: false,
        noMRT: false,
        noPost: false,
        debug: false,
        seed: null,
        usePost: false,
        useMRT: false,
        useCompute: false,
    };

    if (typeof window === 'undefined') {
        return defaults;
    }

    const params = new URLSearchParams(window.location.search);
    const readBool = (...keys) => keys.some((key) => {
        if (!params.has(key)) return false;
        const value = params.get(key);
        if (value === null || value === '') return true;
        const normalized = value.toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    });
    const readNumber = (...keys) => {
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (!params.has(key)) continue;
            const value = params.get(key);
            if (value === null || value === '') continue;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric;
        }
        return null;
    };

    const seed = readNumber('chiralGoldSeed', 'seed');

    return {
        ...defaults,
        forceWebGL: readBool('forceWebGL'),
        noCompute: readBool('chiralGoldNoCompute', 'noCompute'),
        noMRT: readBool('chiralGoldNoMRT', 'noMRT'),
        noPost: readBool('chiralGoldNoPost', 'noPost'),
        debug: readBool('chiralGoldDebug', 'debug'),
        seed: Number.isFinite(seed) ? seed : null,
    };
}

const QUALITY_PRESETS = {
    Extreme: {
        goldDustCount: 30000,
        burstSparkCount: 50000,
        wispCount: 1000,
        strandCount: 6,
        strandParticles: 4200,
        lightBeamCount: 4,
        bloomStrength: 0.85,
        bloomRadius: 0.6,
        enableCompute: true,
        enablePostProcessing: true,
        enableFilmGrain: true,
        enableChromaticAberr: true,
        enableVolumetricBeams: true,
        cpuBurstPoolSize: 16,
        cpuBurstParticles: 2600,
    },
    Ultra: {
        goldDustCount: 20000,
        burstSparkCount: 36000,
        wispCount: 700,
        strandCount: 4,
        strandParticles: 3200,
        lightBeamCount: 3,
        bloomStrength: 0.75,
        bloomRadius: 0.55,
        enableCompute: true,
        enablePostProcessing: true,
        enableFilmGrain: true,
        enableChromaticAberr: true,
        enableVolumetricBeams: true,
        cpuBurstPoolSize: 14,
        cpuBurstParticles: 2400,
    },
    High: {
        goldDustCount: 12000,
        burstSparkCount: 26000,
        wispCount: 500,
        strandCount: 3,
        strandParticles: 2600,
        lightBeamCount: 2,
        bloomStrength: 0.65,
        bloomRadius: 0.5,
        enableCompute: true,
        enablePostProcessing: true,
        enableFilmGrain: true,
        enableChromaticAberr: true,
        enableVolumetricBeams: true,
        cpuBurstPoolSize: 12,
        cpuBurstParticles: 2200,
    },
    Medium: {
        goldDustCount: 7000,
        burstSparkCount: 16000,
        wispCount: 300,
        strandCount: 2,
        strandParticles: 1800,
        lightBeamCount: 0,
        bloomStrength: 0.5,
        bloomRadius: 0.4,
        enableCompute: true,
        enablePostProcessing: true,
        enableFilmGrain: false,
        enableChromaticAberr: false,
        enableVolumetricBeams: false,
        cpuBurstPoolSize: 10,
        cpuBurstParticles: 2000,
    },
    Low: {
        goldDustCount: 3000,
        burstSparkCount: 0,
        wispCount: 150,
        strandCount: 0,
        strandParticles: 0,
        lightBeamCount: 0,
        bloomStrength: 0.25,
        bloomRadius: 0.24,
        enableCompute: false,
        enablePostProcessing: false,
        enableFilmGrain: false,
        enableChromaticAberr: false,
        enableVolumetricBeams: false,
        cpuBurstPoolSize: 6,
        cpuBurstParticles: 900,
    },
    Minimal: {
        goldDustCount: 1500,
        burstSparkCount: 0,
        wispCount: 0,
        strandCount: 0,
        strandParticles: 0,
        lightBeamCount: 0,
        bloomStrength: 0.2,
        bloomRadius: 0.2,
        enableCompute: false,
        enablePostProcessing: false,
        enableFilmGrain: false,
        enableChromaticAberr: false,
        enableVolumetricBeams: false,
        cpuBurstPoolSize: 3,
        cpuBurstParticles: 400,
    },
};

export default class ChiralGoldTheme extends BaseTheme {
    constructor() {
        super('chiral-gold');

        this.flags = parseChiralGoldFlags();
        this.random = createSeededRandom(this.flags.seed);
        this.animationFrameId = null;
        this.resizeHandler = null;
        this.deferredTimeouts = new Set();
        this.deferredTaskId = 0;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.isWebGPU = false;
        this.isWebGL = false;

        this.capabilities = {
            isWebGPU: false,
            maxColorAttachments: 0,
            supportsCompute: false,
            supportsPost: false,
        };

        this.clock = new THREE.Clock();
        this.time = 0;
        this.deviceLossRecoveryInProgress = false;

        this.qualityPreset = QUALITY_PRESETS.High;
        this.currentQualityLevel = 'High';

        this.composer = null;
        this.postProcessing = null;
        this.bloomPass = null;
        this.chromaticPass = null;
        this.filmGrainPass = null;

        this.dustCompute = null;
        this.dustPoints = null;
        this.dustUniforms = null;

        this.burstCompute = null;
        this.burstPoints = null;
        this.burstUniforms = null;
        this.burstPools = [];
        this.burstPoolIndex = 0;
        this.burstCpuConfig = null;

        this.wispCompute = null;
        this.wispPoints = null;
        this.wispUniforms = null;
        this.wispCpuState = null;

        this.strands = [];
        this.tempStrandSegments = [];
        this.beams = [];
        this.shockwaves = [];

        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        this.reactiveEnvelope = {
            pulse: 0,
            bloom: 0,
            spark: 0,
            dust: 0,
            strand: 0,
            shake: 0,
            chroma: 0,
        };

        this.audioChannels = {
            pulse: 0,
            flow: 0,
            spark: 0,
            atmosphere: 0,
        };

        this.comboFlashIntensity = 0;
        this.dustEventBoost = 0;
        this.beatPulse = 0;
        this.wispJolt = 0;
        this.colorTemperatureBoost = 0;
        this.formationState = 0;
        this.formationProgress = 0;
        this.formationDuration = 0;
        this.formationTimer = 0;
        this.strandUnwind = 0;
        this.beamFlash = 0;

        this.cameraBasePosition = new THREE.Vector3(0, 0, 1520);
        this.cameraTarget = new THREE.Vector3(0, 0, 0);
        this.cameraShake = new THREE.Vector3();
        this.cameraDrift = new THREE.Vector3();
        this.cameraDriftVelocity = new THREE.Vector3();
        this.cameraRoll = 0;
        this.cameraRollTarget = 0;
        this.cameraAudioSway = new THREE.Vector3();
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;
        this.cameraLookNudgeY = 0;
        this.cameraZoomNudgeZ = 0;
        this.eventAnchors = [];
        this.heroBurstEnvelope = 0;
        this.peripheralBurstEnvelope = 0;
        this.burstSparkBoost = 0;
        this.burstDebugStats = {
            lastBurstDepth: null,
            heroBurstCount: 0,
            peripheralBurstCount: 0,
            centerGuardRejections: 0,
        };
        this.burstDebugLogTimer = 0;
        this.debugApiRegistered = false;

        this.frameTimes = [];
        this.frameMetricsTimer = 0;
        this.performanceGate = {
            highP95BreachSamples: 0,
            rejected: false,
            lastRejectReason: null,
        };

        this.compileStats = {
            status: 'idle',
            durationMs: 0,
            message: null,
        };

        this.lastMrtDowngrade = null;

        this.backgroundEnvelope = null;
    }

    getTetrominoConfig() {
        return CHIRAL_GOLD_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.graphicsQuality) {
            return normalizeQuality(window.settings.graphicsQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        const normalizedQuality = QUALITY_PRESETS[quality] ? quality : 'High';
        this.currentQualityLevel = normalizedQuality;
        this.qualityPreset = QUALITY_PRESETS[normalizedQuality];
    }

    rand() {
        return this.random ? this.random() : Math.random();
    }

    refreshFlagsForScene() {
        const previous = this.flags || {};
        const parsed = parseChiralGoldFlags();
        parsed.forceWebGL = parsed.forceWebGL || previous.forceWebGL === true;
        parsed.noCompute = parsed.noCompute || previous.noCompute === true;
        parsed.noMRT = parsed.noMRT || previous.noMRT === true;
        parsed.noPost = parsed.noPost || previous.noPost === true;
        parsed.debug = parsed.debug || previous.debug === true;
        if (!Number.isFinite(parsed.seed) && Number.isFinite(previous.seed)) {
            parsed.seed = previous.seed;
        }
        this.flags = parsed;
    }

    initializeDeterministicState() {
        this.random = createSeededRandom(this.flags.seed);
        this.time = 0;
    }

    projectNdcToPlane(ndcX, ndcY, planeZ = 0) {
        if (!this.camera) return null;

        const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
        ndc.unproject(this.camera);
        const direction = ndc.sub(this.camera.position);
        if (Math.abs(direction.z) < 0.00001) return null;

        const t = (planeZ - this.camera.position.z) / direction.z;
        if (!Number.isFinite(t)) return null;

        return this.camera.position.clone().add(direction.multiplyScalar(t));
    }

    getOriginFromPiece(piece) {
        if (!piece?.shape || !Array.isArray(piece.shape)) {
            return this.projectNdcToPlane(0.0, 0.0, 0.0);
        }

        let sumX = 0;
        let sumY = 0;
        let cells = 0;
        piece.shape.forEach((row, localY) => {
            row.forEach((value, localX) => {
                if (!value) return;
                sumX += (piece.x ?? 4) + localX + 0.5;
                sumY += (piece.y ?? 10) + localY + 0.5;
                cells += 1;
            });
        });

        const centerX = cells > 0 ? sumX / cells : 4.5;
        const centerY = cells > 0 ? sumY / cells : 10.0;
        const ndcX = -0.20 + (centerX / 9.0) * 0.40;
        const ndcY = 0.36 - (centerY / 19.0) * 0.72;
        return this.projectNdcToPlane(ndcX, ndcY, 0.0);
    }

    updateCompositionLayout() {
        if (!this.camera || typeof window === 'undefined') return;

        const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
        const edgeX = clamp(0.72 + (aspect - 1.0) * 0.06, 0.68, 0.88);
        const edgeY = clamp(0.72 + (1.0 / Math.max(0.75, aspect) - 0.72) * 0.22, 0.62, 0.86);

        const anchorSpecs = [
            [-edgeX, 0.34, 80],
            [edgeX, 0.34, 80],
            [-edgeX * 0.94, -0.22, -20],
            [edgeX * 0.94, -0.22, -20],
            [-edgeX * 0.8, 0.72, -220],
            [edgeX * 0.8, 0.72, -220],
            [0.0, edgeY, -260],
            [0.0, -edgeY * 0.9, -220],
        ];

        this.eventAnchors = anchorSpecs
            .map(([x, y, z]) => this.projectNdcToPlane(x, y, z))
            .filter(Boolean);
    }

    applySceneComposition() {
        if (typeof window === 'undefined') return;

        const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
        // Agressive aspect-ratio compensation for screen flooding (Tetris Effect style)
        const dustScaleX = clamp(2.5 + (aspect - 1.0) * 0.1, 2.5, 4.0);
        const dustScaleY = clamp(2.5 + (1 / Math.max(0.8, aspect) - 0.75) * 0.1, 2.5, 4.0);

        if (this.dustPoints) {
            this.dustPoints.scale.set(dustScaleX, dustScaleY, 1.05);
        }

        if (this.wispPoints) {
            this.wispPoints.scale.set(dustScaleX * 0.97, dustScaleY * 1.04, 1.06);
        }

        if (this.burstPoints) {
            this.burstPoints.scale.set(dustScaleX * 1.04, dustScaleY * 1.02, 1.0);
        }

        if (Array.isArray(this.burstPools)) {
            this.burstPools.forEach((points) => {
                points.scale.set(dustScaleX * 1.04, dustScaleY * 1.02, 1.0);
            });
        }
    }

    projectWorldToNdc(worldPosition) {
        if (!this.camera || !worldPosition?.isVector3) return null;
        const ndc = worldPosition.clone().project(this.camera);
        if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
        return ndc;
    }

    getBurstOrigin(profile = 'peripheral', options = {}) {
        const intensity = Number.isFinite(options.intensity) ? options.intensity : 1.0;
        const index = Number.isFinite(options.index) ? options.index : 0;
        const centerGuardEnabled = options.centerGuard !== false;
        const maxRetries = 3;

        const resolveAnchor = () => {
            if (!Array.isArray(this.eventAnchors) || this.eventAnchors.length === 0) {
                return null;
            }
            const anchorIndex = Math.abs(Math.floor(index)) % this.eventAnchors.length;
            return this.eventAnchors[anchorIndex].clone();
        };

        const buildCandidate = () => {
            const clampedIntensity = clamp(intensity, 0.2, 3.0);
            if (profile === 'hero_close') {
                const x = ((this.rand() - 0.5) * 960) + (this.rand() - 0.5) * (50 + clampedIntensity * 120);
                const y = ((this.rand() - 0.5) * 880) + (this.rand() - 0.5) * (38 + clampedIntensity * 100);
                return new THREE.Vector3(
                    clamp(x, -600, 600),
                    clamp(y, -500, 500),
                    760 + this.rand() * 420,
                );
            }

            const anchor = resolveAnchor();
            if (profile === 'shockwave') {
                const fallback = new THREE.Vector3(
                    (this.rand() < 0.5 ? -1 : 1) * (620 + this.rand() * 640),
                    (this.rand() - 0.5) * 680,
                    -120 + this.rand() * 380,
                );
                const origin = anchor || fallback;
                const jitter = 110 + clampedIntensity * 80;
                origin.x += (this.rand() - 0.5) * jitter * 1.15;
                origin.y += (this.rand() - 0.5) * jitter * 0.95;
                origin.z = -120 + this.rand() * 380;
                return origin;
            }

            const fallback = new THREE.Vector3(
                (this.rand() < 0.5 ? -1 : 1) * (760 + this.rand() * 900),
                (this.rand() - 0.5) * 820,
                120 + this.rand() * 400,
            );
            const origin = anchor || fallback;
            const jitter = 210 + clampedIntensity * 220;
            origin.x += (this.rand() - 0.5) * jitter * 1.2;
            origin.y += (this.rand() - 0.5) * jitter * 1.0;
            origin.z = 120 + this.rand() * 400;
            return origin;
        };

        let bestCandidate = null;
        let bestScore = -Infinity;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            const candidate = buildCandidate();
            if (!candidate) continue;
            if (!centerGuardEnabled || !this.camera) {
                return candidate;
            }

            const ndc = this.projectWorldToNdc(candidate);
            if (!ndc) {
                return candidate;
            }

            const centerMargin = Math.max(Math.abs(ndc.x) - 0.23, Math.abs(ndc.y) - 0.36);
            if (centerMargin > bestScore) {
                bestScore = centerMargin;
                bestCandidate = candidate;
            }

            const insideCenterSafety = Math.abs(ndc.x) < 0.23 && Math.abs(ndc.y) < 0.36;
            if (!insideCenterSafety) {
                return candidate;
            }
            this.burstDebugStats.centerGuardRejections += 1;
        }

        return bestCandidate || buildCandidate() || new THREE.Vector3(0, 0, 220);
    }

    getEventOrigin(options = {}) {
        const {
            intensity = 1.0,
            index = 0,
            includeCenter = false,
        } = options;

        const profile = includeCenter && this.rand() < 0.45 ? 'hero_close' : 'peripheral';
        return this.getBurstOrigin(profile, {
            intensity,
            index,
            centerGuard: options.centerGuard !== false,
        });
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    applyMrtPatchToMaterial(material) {
        if (!this.isWebGPU || !this.flags.useMRT || !material) return true;

        const materials = Array.isArray(material) ? material : [material];
        const zeroEmissive = vec3(0.0, 0.0, 0.0);

        for (let i = 0; i < materials.length; i += 1) {
            const entry = materials[i];
            if (!entry || !this.isNodeMaterial(entry)) {
                return false;
            }
        }

        materials.forEach((entry) => {
            const hadEmissiveNode = Boolean(entry.emissiveNode);
            if (!entry.userData) entry.userData = {};
            if (typeof entry.userData.emitsBloom !== 'boolean') {
                entry.userData.emitsBloom = hadEmissiveNode;
            }
            if (!entry.userData.mrtRole) {
                entry.userData.mrtRole = hadEmissiveNode ? 'auto-emissive' : 'auto-zero-emissive';
            }

            if (!entry.emissiveNode) {
                entry.emissiveNode = zeroEmissive;
            }
            entry.mrtNode = mrt({ emissive: entry.emissiveNode || zeroEmissive });
            entry.needsUpdate = true;
        });

        return true;
    }

    clearSceneMrtNodes() {
        if (!this.scene) return;

        const visited = new Set();
        const clearMaterial = (material) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach(clearMaterial);
                return;
            }
            if (visited.has(material) || !this.isNodeMaterial(material)) return;
            visited.add(material);
            material.mrtNode = null;
            material.needsUpdate = true;
        };

        this.scene.traverse((child) => {
            if (child.material) clearMaterial(child.material);
        });
    }

    disableMrtRuntime(reason, details = null, options = {}) {
        if (!this.isWebGPU) return;
        const { rebuildPost = true } = options;
        const wasEnabled = this.flags.useMRT === true;

        this.flags.useMRT = false;
        this.flags.noMRT = true;
        this.lastMrtDowngrade = {
            reason,
            details,
            at: new Date().toISOString(),
        };

        this.clearSceneMrtNodes();

        if (wasEnabled) {
            console.warn('[ChiralGold] MRT fail-safe downgrade applied:', this.lastMrtDowngrade);
        }

        if (rebuildPost && this.postProcessing && this.flags.usePost && !this.flags.noPost) {
            this.setupPostProcessing();
            this.configureRendererColorPipeline();
        }
    }

    ensureMrtMaterials() {
        if (!this.isWebGPU || !this.scene || !this.flags.useMRT) return;

        const seen = new Set();
        const nonNode = [];

        const recordMaterial = (material, object) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach((mat) => recordMaterial(mat, object));
                return;
            }
            if (seen.has(material)) return;
            seen.add(material);

            const objectName = object?.name || object?.type || 'UnknownObject';
            const materialName = material.name || material.type || material.constructor?.name || 'UnknownMaterial';

            if (!this.isNodeMaterial(material)) {
                nonNode.push({ objectName, materialName });
                return;
            }

            if (!this.applyMrtPatchToMaterial(material)) {
                nonNode.push({ objectName, materialName });
            }
        };

        this.scene.traverse((child) => {
            if (child.material) {
                recordMaterial(child.material, child);
            }
        });

        if (nonNode.length) {
            this.disableMrtRuntime('non-node-materials-detected', { nonNode }, { rebuildPost: true });
        }
    }

    probeCapabilities() {
        if (!this.isWebGPU || !this.renderer?.backend?.isWebGPUBackend) {
            this.capabilities = {
                isWebGPU: false,
                maxColorAttachments: 0,
                supportsCompute: false,
                supportsPost: false,
            };
            return;
        }

        const device = this.renderer?.backend?.device;
        this.capabilities = {
            isWebGPU: true,
            maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
            supportsCompute: typeof this.renderer.compute === 'function',
            supportsPost: typeof THREE_WEBGPU.PostProcessing === 'function',
        };
    }

    shouldGuardMrtOnPlatform() {
        if (!this.isWebGPU || typeof navigator === 'undefined') {
            return false;
        }
        const ua = navigator.userAgent || '';
        return /Windows/i.test(ua);
    }

    updateCapabilityFlags() {
        const usePost = this.isWebGPU
            && this.capabilities?.supportsPost
            && this.qualityPreset.enablePostProcessing
            && !this.flags.noPost;

        const supportsMRT = this.capabilities?.maxColorAttachments > 1;
        const guardMRT = this.shouldGuardMrtOnPlatform();
        const useMRT = usePost && supportsMRT && !this.flags.noMRT && !guardMRT;

        const useCompute = this.isWebGPU
            && this.capabilities?.supportsCompute
            && this.qualityPreset.enableCompute !== false
            && !this.flags.noCompute;

        this.flags.usePost = usePost;
        this.flags.useMRT = useMRT;
        this.flags.useCompute = useCompute;

        this.normalizeRuntimeFeatureFlags();

        if (guardMRT && usePost && supportsMRT && !this.flags.noMRT) {
            console.log('[ChiralGold] MRT disabled on Windows WebGPU stability guard.');
        }
    }

    normalizeRuntimeFeatureFlags() {
        if (!this.isWebGPU) {
            this.flags.usePost = false;
            this.flags.useMRT = false;
            this.flags.useCompute = false;
            return;
        }

        if (this.flags.noPost || !this.flags.usePost) {
            this.flags.usePost = false;
            this.flags.useMRT = false;
        }

        if (this.flags.noMRT) {
            this.flags.useMRT = false;
        }

        if (this.flags.noCompute || this.qualityPreset.enableCompute === false || !this.capabilities?.supportsCompute) {
            this.flags.useCompute = false;
        }
    }

    configureRendererColorPipeline() {
        if (!this.renderer) return;

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        const postOwnsToneMapping = this.isWebGPU && this.flags.usePost && !!this.postProcessing;
        if (postOwnsToneMapping) {
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.toneMappingExposure = 1.0;
        } else {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.0;
        }
    }

    async precompileSceneWithTimeout() {
        if (!this.isWebGPU || !this.renderer?.compileAsync || !this.scene || !this.camera) {
            this.compileStats = {
                status: 'skipped',
                durationMs: 0,
                message: 'compileAsync unavailable or non-WebGPU path',
            };
            return;
        }

        const timeoutMs = 3000;
        const compileStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let timeoutId = null;

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('compile timeout')), timeoutMs);
                }),
            ]);

            this.compileStats = {
                status: 'success',
                durationMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - compileStartMs,
                message: null,
            };
        } catch (error) {
            this.compileStats = {
                status: 'fallback',
                durationMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - compileStartMs,
                message: error.message,
            };
            console.warn('[ChiralGold] compileAsync skipped:', error.message);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    }

    ensureThemeContainer() {
        if (typeof document === 'undefined') return null;

        let container = document.getElementById('chiral-gold-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'chiral-gold-theme';
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
            });

            if (document.body.firstChild) {
                document.body.insertBefore(container, document.body.firstChild);
            } else {
                document.body.appendChild(container);
            }
        }

        this.registerContainer(container);
        return container;
    }

    async start(webglRenderer, managers = {}) {
        this.ensureThemeContainer();
        await super.start(webglRenderer, managers);
    }

    async createScene() {
        this.cancelAnimationLoop();
        this.clearDeferredTimeouts();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.disposeRuntimeResources({ removeCanvas: true });

        this.refreshFlagsForScene();
        this.initializeDeterministicState();

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = this.ensureThemeContainer();
        if (!container) return;

        container.innerHTML = '';

        await this.initRenderer(container);
        if (!this.renderer || !this.scene || !this.camera) {
            console.error('[ChiralGold] Renderer initialization failed');
            return;
        }

        this.probeCapabilities();
        this.updateCapabilityFlags();

        try {
            this.createDustSystem();
        } catch (error) {
            console.error('[ChiralGold] Dust system init failed, using emergency fallback:', error);
            this.createEmergencyDustFallback();
        }

        try {
            this.createBurstSystem();
        } catch (error) {
            console.error('[ChiralGold] Burst system init failed:', error);
        }

        try {
            this.createWispSystem();
        } catch (error) {
            console.error('[ChiralGold] Wisp system init failed:', error);
        }

        try {
            this.createStrands();
        } catch (error) {
            console.error('[ChiralGold] Strand system init failed:', error);
        }

        try {
            this.createVolumetricBeams();
        } catch (error) {
            console.error('[ChiralGold] Beam system init failed:', error);
        }

        try {
            this.createBackgroundEnvelope();
        } catch (error) {
            console.error('[ChiralGold] Background envelope init failed:', error);
        }

        this.updateCompositionLayout();
        this.applySceneComposition();
        this.ensureMrtMaterials();
        this.setupPostProcessing();
        this.configureRendererColorPipeline();
        this.registerDebugApi();
        this.setupResizeHandler();
        this.setupEventListeners();

        await this.precompileSceneWithTimeout();
        this.startAnimation();

        container.style.transition = 'opacity 0.9s ease-in';
        container.style.visibility = 'visible';
        container.style.opacity = '1';

        console.log('[ChiralGold] Runtime capabilities', {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
            usePost: this.flags.usePost,
            useMRT: this.flags.useMRT,
            useCompute: this.flags.useCompute,
            maxColorAttachments: this.capabilities.maxColorAttachments,
            supportsCompute: this.capabilities.supportsCompute,
            supportsPost: this.capabilities.supportsPost,
            quality,
            preset: {
                goldDustCount: this.qualityPreset.goldDustCount,
                burstSparkCount: this.qualityPreset.burstSparkCount,
                wispCount: this.qualityPreset.wispCount,
                strandCount: this.qualityPreset.strandCount,
                lightBeamCount: this.qualityPreset.lightBeamCount,
            },
            flags: {
                forceWebGL: this.flags.forceWebGL,
                noPost: this.flags.noPost,
                noMRT: this.flags.noMRT,
                noCompute: this.flags.noCompute,
            },
            compile: this.compileStats,
        });
    }

    createEmergencyDustFallback() {
        if (!this.scene || this.dustPoints) return;

        const count = Math.max(240, Math.min(1400, Math.floor((this.qualityPreset.goldDustCount || 3000) * 0.25)));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        const palette = this.getGoldPalette();
        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const theta = this.rand() * Math.PI * 2;
            const radius = 2200 + this.rand() * 6000;
            const stretchX = 1.35 + this.rand() * 0.65;
            const stretchZ = 0.75 + this.rand() * 0.55;
            positions[i3] = Math.cos(theta) * radius * stretchX;
            positions[i3 + 1] = (this.rand() - 0.5) * 3500;
            positions[i3 + 2] = Math.sin(theta) * radius * stretchZ;

            const color = palette[Math.floor(this.rand() * palette.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 6,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.dustPoints = new THREE.Points(geometry, material);
        this.scene.add(this.dustPoints);
    }

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        let webgpuRenderer = null;

        if (!this.flags.forceWebGL) {
            try {
                webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                });
                await webgpuRenderer.init();
            } catch (error) {
                console.warn('[ChiralGold] WebGPU init failed, falling back to WebGL2:', error.message);
                if (webgpuRenderer) {
                    webgpuRenderer.dispose();
                    webgpuRenderer = null;
                }
            }
        }

        if (webgpuRenderer?.backend?.isWebGPUBackend === true) {
            this.renderer = webgpuRenderer;
            this.isWebGPU = true;
            this.isWebGL = false;
            this.renderer.onDeviceLost = (info) => {
                this.handleDeviceLoss(info);
            };
        } else {
            if (webgpuRenderer) {
                webgpuRenderer.dispose();
                webgpuRenderer = null;
            }

            this.renderer = new THREE.WebGLRenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
            });
            this.isWebGPU = false;
            this.isWebGL = true;
        }

        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x000000, 0.00008);

        this.camera = new THREE.PerspectiveCamera(64, width / height, 0.1, 50000);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraTarget);
        this.updateCompositionLayout();

        const key = new THREE.PointLight(0xffdd99, 1.35, 4200);
        key.position.set(420, 260, 720);
        this.scene.add(key);

        const fill = new THREE.PointLight(0x7f6527, 0.38, 3600);
        fill.position.set(-320, -180, 460);
        this.scene.add(fill);

        const ambient = new THREE.AmbientLight(0x1b1205, 0.55);
        this.scene.add(ambient);
    }

    createDustSystem() {
        if (this.dustCompute?.dispose) {
            this.dustCompute.dispose();
        }
        this.dustCompute = null;
        this.dustPoints = null;
        this.dustUniforms = null;

        const count = Math.max(0, this.qualityPreset.goldDustCount || 0);
        if (count <= 0) return;

        const canUseCompute = Boolean(
            this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute,
        );

        if (canUseCompute) {
            this.dustCompute = new ChiralGoldDustCompute(count, {
                randomFn: () => this.rand(),
                colorPalette: this.getGoldPalette(),
            });
            this.dustCompute.createComputeNode();

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

            const { material, uniforms } = createGoldDustNodeMaterial({
                isWebGPU: this.isWebGPU,
                dustCompute: this.dustCompute,
                pixelRatio: this.getEffectivePixelRatio(),
            });

            this.dustPoints = new THREE.Points(geometry, material);
            this.dustPoints.userData.uniforms = uniforms;
            this.scene.add(this.dustPoints);
            this.dustUniforms = uniforms;
            return;
        }

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const twinkles = new Float32Array(count);
        const alphas = new Float32Array(count);

        const palette = this.getGoldPalette();

        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const r = this.rand();
            const theta = this.rand() * Math.PI * 2;

            let minRadius = 3800;
            let maxRadius = 8500;
            let sizeMin = 5;
            let sizeMax = 16;
            let zDepthMin = -2000;
            let zDepthMax = 400;
            let yRange = 4200;
            if (r < 0.20) {
                minRadius = 1800;
                maxRadius = 3400;
                sizeMin = 14;
                sizeMax = 28;
                zDepthMin = -600;
                zDepthMax = 800;
                yRange = 2800;
            } else if (r < 0.55) {
                minRadius = 2900;
                maxRadius = 5200;
                sizeMin = 10;
                sizeMax = 22;
                zDepthMin = -1200;
                zDepthMax = 600;
                yRange = 3800;
            } else if (r >= 0.80) {
                // Envelope band
                minRadius = 2000;
                maxRadius = 8000;
                sizeMin = 3;
                sizeMax = 12;
                zDepthMin = -5000;
                zDepthMax = 1800;
                yRange = 4800;
            }

            const radius = minRadius + this.rand() * (maxRadius - minRadius);
            const stretchX = 1.25 + this.rand() * 0.85;
            const stretchZ = 0.72 + this.rand() * 0.6;
            const zDepth = zDepthMin + this.rand() * (zDepthMax - zDepthMin);
            positions[i3] = Math.cos(theta) * radius * stretchX;
            positions[i3 + 1] = (this.rand() - 0.5) * yRange;
            positions[i3 + 2] = Math.sin(theta) * radius * stretchZ + zDepth;

            const colorRoll = this.rand();
            let color = palette[0];
            if (colorRoll <= 0.4) color = palette[0];
            else if (colorRoll <= 0.65) color = palette[1];
            else if (colorRoll <= 0.85) color = palette[2];
            else if (colorRoll <= 0.95) color = palette[3];
            else color = palette[4];

            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = sizeMin + this.rand() * (sizeMax - sizeMin);
            twinkles[i] = this.rand();
            alphas[i] = 0.5 + this.rand() * 0.5;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
        geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

        let material;
        let uniforms = null;

        if (this.isWebGPU) {
            ({ material, uniforms } = createGoldDustNodeMaterial({
                isWebGPU: this.isWebGPU,
                pixelRatio: this.getEffectivePixelRatio(),
            }));
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPulse: { value: 0 },
                    uColorTemperature: { value: 0 },
                },
                vertexShader: goldDustVertexShader,
                fragmentShader: goldDustFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });
            uniforms = material.uniforms;
        }

        this.dustPoints = new THREE.Points(geometry, material);
        this.dustPoints.userData.uniforms = uniforms;
        this.scene.add(this.dustPoints);
        this.dustUniforms = uniforms;
    }

    createBurstSystem() {
        if (this.burstCompute?.dispose) {
            this.burstCompute.dispose();
        }
        this.burstCompute = null;
        this.burstPoints = null;
        this.burstUniforms = null;
        this.burstPools = [];
        this.burstPoolIndex = 0;
        this.burstCpuConfig = null;

        const configuredCount = Number.isFinite(this.qualityPreset.burstSparkCount)
            ? this.qualityPreset.burstSparkCount
            : 0;
        const highQualityBurstClamp = (
            this.currentQualityLevel === 'Extreme'
            || this.currentQualityLevel === 'Ultra'
            || this.currentQualityLevel === 'High'
        );

        const canUseCompute = Boolean(
            configuredCount > 0
            && this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute,
        );

        if (canUseCompute) {
            const burstCount = Math.max(5000, configuredCount);
            this.burstCompute = new ChiralGoldBurstCompute(burstCount, {
                randomFn: () => this.rand(),
                colorPalette: this.getGoldPalette(),
            });
            this.burstCompute.createComputeNode();

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(burstCount * 3), 3));

            const { material, uniforms } = createBurstSparkNodeMaterial({
                isWebGPU: this.isWebGPU,
                burstCompute: this.burstCompute,
                pixelRatio: this.getEffectivePixelRatio(),
                highQualityBurstClamp,
            });

            this.burstPoints = new THREE.Points(geometry, material);
            this.burstPoints.userData.uniforms = uniforms;
            this.scene.add(this.burstPoints);
            this.burstUniforms = uniforms;
            return;
        }

        const poolSize = this.qualityPreset.cpuBurstPoolSize || 8;
        const particlesPerPool = this.qualityPreset.cpuBurstParticles || 1800;
        this.burstCpuConfig = { poolSize, particlesPerPool };

        // Low/Minimal keep startup memory lower by allocating CPU burst pools on first use.
        if (this.currentQualityLevel === 'Low' || this.currentQualityLevel === 'Minimal') {
            return;
        }

        this.createCpuBurstPools(poolSize, particlesPerPool);
    }

    createCpuBurstPools(poolSize, particlesPerPool) {
        if (this.burstPools.length > 0) return;

        for (let p = 0; p < poolSize; p += 1) {
            const positions = new Float32Array(particlesPerPool * 3);
            const colors = new Float32Array(particlesPerPool * 3);
            const sizes = new Float32Array(particlesPerPool);
            const life = new Float32Array(particlesPerPool);
            const velocity = new Float32Array(particlesPerPool * 3);
            const maxLife = new Float32Array(particlesPerPool);

            positions.fill(-9999);
            life.fill(0);

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocity, 3));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aLife', new THREE.BufferAttribute(life, 1));

            let material;
            let uniforms = null;

            if (this.isWebGPU) {
                ({ material, uniforms } = createBurstSparkNodeMaterial({
                    isWebGPU: this.isWebGPU,
                    pixelRatio: this.getEffectivePixelRatio(),
                    highQualityBurstClamp: (
                        this.currentQualityLevel === 'Extreme'
                        || this.currentQualityLevel === 'Ultra'
                        || this.currentQualityLevel === 'High'
                    ),
                }));
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uColorTemperature: { value: 0 },
                    },
                    vertexShader: burstSparkVertexShader,
                    fragmentShader: burstSparkFragmentShader,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                });
                uniforms = material.uniforms;
            }

            const points = new THREE.Points(geometry, material);
            points.userData = {
                uniforms,
                cpuBurst: {
                    positions,
                    colors,
                    sizes,
                    life,
                    velocity,
                    maxLife,
                    active: false,
                },
            };

            this.scene.add(points);
            this.burstPools.push(points);
        }

        this.applySceneComposition();
    }

    createWispSystem() {
        if (this.wispCompute?.dispose) {
            this.wispCompute.dispose();
        }
        this.wispCompute = null;
        this.wispPoints = null;
        this.wispUniforms = null;
        this.wispCpuState = null;

        const count = Math.max(0, this.qualityPreset.wispCount || 0);
        if (count <= 0) return;

        const canUseCompute = Boolean(
            this.isWebGPU
            && this.flags.useCompute
            && this.renderer?.compute,
        );

        if (canUseCompute) {
            this.wispCompute = new ChiralGoldWispCompute(count, {
                randomFn: () => this.rand(),
                colorPalette: this.getGoldPalette(),
            });
            this.wispCompute.createComputeNode();

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

            const { material, uniforms } = createWispNodeMaterial({
                isWebGPU: this.isWebGPU,
                wispCompute: this.wispCompute,
                pixelRatio: this.getEffectivePixelRatio(),
            });

            this.wispPoints = new THREE.Points(geometry, material);
            this.wispPoints.userData.uniforms = uniforms;
            this.scene.add(this.wispPoints);
            this.wispUniforms = uniforms;
            return;
        }

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const pulse = new Float32Array(count);

        const ampX = new Float32Array(count);
        const ampY = new Float32Array(count);
        const ampZ = new Float32Array(count);
        const freqA = new Float32Array(count);
        const freqB = new Float32Array(count);
        const freqC = new Float32Array(count);
        const phase = new Float32Array(count);
        const group = new Float32Array(count);

        const palette = this.getGoldPalette();

        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            positions[i3] = (this.rand() - 0.5) * 1200;
            positions[i3 + 1] = (this.rand() - 0.5) * 900;
            positions[i3 + 2] = (this.rand() - 0.5) * 900;

            const c = palette[this.rand() < 0.65 ? 1 : 2];
            colors[i3] = c.r;
            colors[i3 + 1] = c.g;
            colors[i3 + 2] = c.b;

            sizes[i] = 60 + this.rand() * 60;
            pulse[i] = 1;

            ampX[i] = 200 + this.rand() * 600;
            ampY[i] = 140 + this.rand() * 360;
            ampZ[i] = 200 + this.rand() * 600;
            freqA[i] = 0.6 + Math.floor(this.rand() * 3) * 0.5 + this.rand() * 0.15;
            freqB[i] = 0.6 + Math.floor(this.rand() * 3) * 0.5 + this.rand() * 0.15;
            freqC[i] = 0.6 + Math.floor(this.rand() * 3) * 0.5 + this.rand() * 0.15;
            phase[i] = this.rand() * Math.PI * 2;
            group[i] = this.rand();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 1));

        let material;
        let uniforms = null;

        if (this.isWebGPU) {
            ({ material, uniforms } = createWispNodeMaterial({
                isWebGPU: this.isWebGPU,
                pixelRatio: this.getEffectivePixelRatio(),
            }));
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uBeatPulse: { value: 0 },
                    uColorTemperature: { value: 0 },
                },
                vertexShader: wispVertexShader,
                fragmentShader: wispFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            uniforms = material.uniforms;
        }

        this.wispCpuState = {
            positions,
            pulse,
            ampX,
            ampY,
            ampZ,
            freqA,
            freqB,
            freqC,
            phase,
            group,
        };

        this.wispPoints = new THREE.Points(geometry, material);
        this.wispPoints.userData.uniforms = uniforms;
        this.scene.add(this.wispPoints);
        this.wispUniforms = uniforms;
    }

    createStrands() {
        this.strands.forEach((strand) => {
            if (strand.parent) strand.parent.remove(strand);
            strand.geometry?.dispose?.();
            strand.material?.dispose?.();
        });
        this.strands = [];

        const strandCount = Math.max(0, this.qualityPreset.strandCount || 0);
        if (strandCount <= 0) return;

        for (let s = 0; s < strandCount; s += 1) {
            const count = Math.max(1600, this.qualityPreset.strandParticles || 2400);
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const phases = new Float32Array(count);
            const paramT = new Float32Array(count);

            const colorA = new THREE.Color(0xFFE57F); // Brilliant warm gold
            const colorB = new THREE.Color(0xD28E00); // Deep copper bronze

            // Alternate sides: left side for first half, right side for second half of strands
            const isLeft = s < Math.ceil(strandCount / 2);
            const side = isLeft ? -1.0 : 1.0;
            // Alternate winding direction to interlace CW and CCW strands
            const windingDirection = (s % 2 === 0) ? 1.0 : -1.0;

            const turns = 10.0 + (s % 2) * 2.0; // tight spirals
            const pitch = 380 + s * 12;

            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                const t = (i / Math.max(1, count - 1)) * Math.PI * turns;
                const radius = 240.0 + 60.0 * Math.sin(t * 0.32);

                // Initialize spiral relative to local origin
                positions[i3] = Math.cos(windingDirection * t) * radius;
                positions[i3 + 1] = (i / count - 0.5) * pitch * 7.5;
                positions[i3 + 2] = Math.sin(windingDirection * t) * radius;

                const c = colorA.clone().lerp(colorB, (i / count) * 0.55 + (s / strandCount) * 0.45);
                colors[i3] = c.r;
                colors[i3 + 1] = c.g;
                colors[i3 + 2] = c.b;

                sizes[i] = 4.2 + this.rand() * 4.8;
                phases[i] = this.rand();
                paramT[i] = t;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geometry.setAttribute('aT', new THREE.BufferAttribute(paramT, 1));

            let material;
            let uniforms = null;

            if (this.isWebGPU) {
                ({ material, uniforms } = createStrandNodeMaterial({
                    isWebGPU: this.isWebGPU,
                    pixelRatio: this.getEffectivePixelRatio(),
                }));
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uIntensity: { value: 0 },
                        uColorTemperature: { value: 0 },
                    },
                    vertexShader: strandVertexShader,
                    fragmentShader: strandFragmentShader,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    vertexColors: true,
                });
                uniforms = material.uniforms;
            }

            const points = new THREE.Points(geometry, material);
            points.userData.uniforms = uniforms;
            points.userData.basePositions = positions.slice(0);
            points.userData.phase = this.rand() * Math.PI * 2;
            points.userData.spin = (s % 2 === 0 ? 0.08 : -0.08) * (1.0 + this.rand() * 0.25);
            points.userData.windingDirection = windingDirection;
            points.userData.side = side;
            points.userData.drift = new THREE.Vector3(
                (this.rand() - 0.5) * 32,
                (this.rand() - 0.5) * 16,
                (this.rand() - 0.5) * 24,
            );
            points.userData.paramT = paramT;

            points.position.set(
                side * 1050 + (this.rand() - 0.5) * 120, // Frame the board at the sides
                (this.rand() - 0.5) * 220,
                -140 + (this.rand() - 0.5) * 380,
            );
            points.userData.home = points.position.clone();
            points.userData.bounds = new THREE.Vector3(3400, 2000, 2800);

            this.scene.add(points);
            this.strands.push(points);
        }
    }

    createTemporaryStrandSegment(options = {}) {
        if (!this.scene) return;
        if (this.currentQualityLevel === 'Low' || this.currentQualityLevel === 'Minimal') return;

        const comboCount = Number.isFinite(options.comboCount) ? options.comboCount : 0;
        const particleCount = Math.floor(
            clamp(
                Number.isFinite(options.particleCount)
                    ? options.particleCount
                    : (260 + comboCount * 44),
                180,
                860,
            ),
        );
        const life = Number.isFinite(options.life) ? options.life : (2.1 + this.rand() * 1.1);
        const intensity = clamp(Number.isFinite(options.intensity) ? options.intensity : 1.0, 0.4, 2.4);

        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const phases = new Float32Array(particleCount);
        const paramT = new Float32Array(particleCount);

        const colorA = new THREE.Color(0xffefb1);
        const colorB = new THREE.Color(0xffc640);
        const turns = 2.6 + this.rand() * 2.1;
        const baseRadius = 58 + this.rand() * 110;
        const pitch = 170 + this.rand() * 240;

        for (let i = 0; i < particleCount; i += 1) {
            const i3 = i * 3;
            const t = (i / Math.max(1, particleCount - 1)) * Math.PI * turns;
            const radius = baseRadius * (0.84 + 0.28 * Math.sin(t * 0.55 + comboCount * 0.18));
            positions[i3] = Math.cos(t) * radius;
            positions[i3 + 1] = (i / particleCount - 0.5) * pitch * 2.0;
            positions[i3 + 2] = Math.sin(t) * radius;

            const c = colorA.clone().lerp(colorB, i / Math.max(1, particleCount - 1));
            colors[i3] = c.r;
            colors[i3 + 1] = c.g;
            colors[i3 + 2] = c.b;

            sizes[i] = 3.2 + this.rand() * 4.6;
            phases[i] = this.rand();
            paramT[i] = t;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aT', new THREE.BufferAttribute(paramT, 1));

        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            ({ material, uniforms } = createStrandNodeMaterial({
                isWebGPU: this.isWebGPU,
                pixelRatio: this.getEffectivePixelRatio(),
            }));
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uIntensity: { value: 0 },
                    uColorTemperature: { value: 0 },
                },
                vertexShader: strandVertexShader,
                fragmentShader: strandFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });
            uniforms = material.uniforms;
        }

        const points = new THREE.Points(geometry, material);
        const origin = options.origin?.isVector3
            ? options.origin.clone()
            : this.getBurstOrigin('peripheral', {
                intensity: 0.9 + comboCount * 0.06,
                index: this.deferredTaskId + Math.floor(this.rand() * 100),
            });
        points.position.copy(origin);
        points.userData.uniforms = uniforms;
        points.userData.basePositions = positions.slice(0);
        points.userData.paramT = paramT;
        points.userData.life = life;
        points.userData.maxLife = life;
        points.userData.spin = (this.rand() - 0.5) * (0.55 + intensity * 0.2);
        points.userData.scatter = 70 + this.rand() * 140 + intensity * 70;
        points.userData.drift = new THREE.Vector3(
            (this.rand() - 0.5) * (160 + intensity * 70),
            (this.rand() - 0.5) * (95 + intensity * 35),
            (this.rand() - 0.5) * (140 + intensity * 60),
        );
        points.userData.intensity = intensity;
        points.userData.tempSegment = true;

        this.scene.add(points);
        this.tempStrandSegments.push(points);
    }

    disposeTemporaryStrandSegment(points) {
        if (!points) return;
        if (points.parent) points.parent.remove(points);
        points.geometry?.dispose?.();
        points.material?.dispose?.();
    }

    createVolumetricBeams() {
        this.beams.forEach((beam) => {
            if (beam.mesh.parent) beam.mesh.parent.remove(beam.mesh);
            beam.mesh.geometry?.dispose?.();
            beam.mesh.material?.dispose?.();
        });
        this.beams = [];

        if (!this.qualityPreset.enableVolumetricBeams) return;
        const beamCount = Math.max(0, this.qualityPreset.lightBeamCount || 0);
        if (beamCount <= 0) return;

        for (let i = 0; i < beamCount; i += 1) {
            const geometry = new THREE.PlaneGeometry(260 + this.rand() * 160, 3000, 1, 1);
            let material;
            let uniforms;

            if (this.isWebGPU) {
                ({ material, uniforms } = createLightBeamNodeMaterial({
                    opacity: 0.24 + this.rand() * 0.15,
                    color: new THREE.Color(0xFFCC66),
                }));
            } else {
                material = new THREE.MeshBasicMaterial({
                    color: 0xFFCC66,
                    transparent: true,
                    opacity: 0.22,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
                uniforms = null;
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                (this.rand() - 0.5) * 2200,
                (this.rand() - 0.5) * 520,
                (this.rand() - 0.5) * 2000,
            );
            mesh.rotation.set(
                (this.rand() - 0.5) * 0.2,
                this.rand() * Math.PI * 2,
                (this.rand() - 0.5) * 0.2,
            );

            this.scene.add(mesh);
            this.beams.push({
                mesh,
                uniforms,
                baseOpacity: 0.18 + this.rand() * 0.12,
                baseSpeed: 0.02 + this.rand() * 0.04,
                wobblePhase: this.rand() * Math.PI * 2,
            });
        }
    }

    createBackgroundEnvelope() {
        if (this.backgroundEnvelope) {
            if (this.backgroundEnvelope.parent) this.backgroundEnvelope.parent.remove(this.backgroundEnvelope);
            this.backgroundEnvelope.geometry?.dispose?.();
            this.backgroundEnvelope.material?.dispose?.();
            this.backgroundEnvelope = null;
        }

        const count = Math.floor((this.qualityPreset.goldDustCount ?? 5000) * 0.35);
        if (count <= 0) return;

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const palette = this.getGoldPalette();

        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            // Uniform sphere distribution: fills every screen direction
            const radius = 2000 + this.rand() * 6000;
            const phi = Math.acos(2 * this.rand() - 1);
            const theta = this.rand() * Math.PI * 2;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            const col = palette[Math.floor(this.rand() * Math.min(palette.length, 5))];
            colors[i3] = (col?.r ?? 0.7) * 0.6;
            colors[i3 + 1] = (col?.g ?? 0.55) * 0.6;
            colors[i3 + 2] = (col?.b ?? 0.1) * 0.6;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 4.5,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.38,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.backgroundEnvelope = new THREE.Points(geometry, material);
        this.backgroundEnvelope.userData.parallax = 0.45;
        this.scene.add(this.backgroundEnvelope);
    }

    setupPostProcessing() {
        this.disposePostProcessingStack();

        if (this.flags.noPost || !this.qualityPreset.enablePostProcessing) {
            this.flags.usePost = false;
            this.flags.useMRT = false;
            return;
        }

        if (this.isWebGPU) {
            if (!this.flags.usePost) {
                this.flags.useMRT = false;
                return;
            }

            try {
                this.postProcessing = new ChiralGoldPost(this.renderer, this.scene, this.camera, {
                    useMRT: this.flags.useMRT,
                    bloomStrength: this.flags.useMRT
                        ? this.qualityPreset.bloomStrength
                        : this.qualityPreset.bloomStrength * 0.45,
                    bloomRadius: this.qualityPreset.bloomRadius,
                    bloomThreshold: this.flags.useMRT ? 0.0 : 0.88,
                    chromaticStrength: this.qualityPreset.enableChromaticAberr ? 0.003 : 0.0,
                    filmGrain: this.qualityPreset.enableFilmGrain ? 0.015 : 0.0,
                    vignetteDarkness: 0.9,
                    vignetteOffset: 1.1,
                    saturation: 0.85,
                    contrast: 1.1,
                    blackFloor: 0.08,
                });
                this.postProcessing.setSize(window.innerWidth, window.innerHeight);
            } catch (error) {
                console.warn('[ChiralGold] WebGPU post failed:', error.message);
                this.postProcessing = null;
                this.flags.usePost = false;
                this.flags.useMRT = false;
            }
            return;
        }

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.15,
        );
        this.composer.addPass(this.bloomPass);

        if (this.qualityPreset.enableChromaticAberr) {
            this.chromaticPass = new ShaderPass(ChiralGoldChromaticShader);
            this.composer.addPass(this.chromaticPass);
        }

        this.composer.addPass(new ShaderPass(ChiralGoldVignetteShader));

        if (this.qualityPreset.enableFilmGrain) {
            this.filmGrainPass = new ShaderPass(ChiralGoldFilmGrainShader);
            this.composer.addPass(this.filmGrainPass);
        }
    }

    disposePostProcessingStack() {
        if (this.postProcessing?.dispose) {
            this.postProcessing.dispose();
        }
        this.postProcessing = null;

        if (this.composer?.dispose) {
            this.composer.dispose();
        }
        this.composer = null;
        this.bloomPass = null;
        this.chromaticPass = null;
        this.filmGrainPass = null;
    }

    startAnimation() {
        this.cancelAnimationLoop();
        this.clock.start();
        this.animate();
    }

    cancelAnimationLoop() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    animate() {
        if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;

        this.animationFrameId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(this.animationFrameId);

        const frameStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

        const measuredDelta = this.clock.getDelta();
        const delta = Math.min(measuredDelta, 0.05);
        this.time += delta;

        this.runDeferredTimeouts();

        const analysis = this.audioManager?.getAudioAnalysis
            ? this.audioManager.getAudioAnalysis(delta)
            : {
                bassEnergy: 0,
                midEnergy: 0,
                trebleEnergy: 0,
                overallEnergy: 0,
                beatDetected: false,
            };

        this.updateAudioChannels(analysis, delta);
        this.updateReactiveEnvelope(delta);
        this.updateFormationState(delta);

        this.comboFlashIntensity = Math.max(0, this.comboFlashIntensity - delta * 1.7);
        this.dustEventBoost = Math.max(0, this.dustEventBoost - delta * 3.2);
        this.beatPulse = Math.max(0, this.beatPulse - delta * 2.2);
        this.wispJolt = Math.max(0, this.wispJolt - delta * 1.8);
        this.beamFlash = Math.max(0, this.beamFlash - delta * 2.4);
        this.colorTemperatureBoost = Math.max(0, this.colorTemperatureBoost - delta * 0.42);
        this.burstSparkBoost = Math.max(0, this.burstSparkBoost - delta * 3.8);

        if (analysis.beatDetected) {
            this.beatPulse = Math.min(1.0, this.beatPulse + 0.45);
        }
        // Bass-slam trigger: catch strong bass events the beat detector may miss
        if ((analysis.bassEnergy ?? 0) > 0.6 && this.beatPulse < 0.25) {
            this.beatPulse = Math.min(1.0, this.beatPulse + (analysis.bassEnergy ?? 0) * 0.28);
        }

        this.updateDust(delta, analysis);
        this.updateBurst(delta, analysis);
        this.updateWisps(delta, analysis);
        this.updateStrands(delta, analysis);
        this.updateTemporaryStrands(delta, analysis);
        this.updateBeams(delta, analysis);
        this.updateShockwaves(delta);
        this.updateCamera(delta, analysis);

        // Background envelope parallax tracking — follows camera at 45% of its motion
        if (this.backgroundEnvelope && this.camera) {
            const parallax = this.backgroundEnvelope.userData.parallax ?? 0.45;
            this.backgroundEnvelope.position.set(
                this.camera.position.x * parallax,
                this.camera.position.y * parallax,
                this.camera.position.z * parallax,
            );
            this.backgroundEnvelope.rotation.y = this.time * 0.001;
        }

        // Continuous audio bloom boost — scene glows with the music
        const audioBloomBoost = this.audioChannels.atmosphere * 0.15 + this.audioChannels.pulse * 0.12;
        const bloomStrength = clamp(
            this.qualityPreset.bloomStrength
            + this.reactiveEnvelope.bloom * 0.3
            + audioBloomBoost,
            0,
            1.2,
        );

        // Chromatic aberration — bass + beat driven for physical punch sensation
        const chromaticStrength = this.qualityPreset.enableChromaticAberr
            ? clamp(
                0.003
                + this.reactiveEnvelope.chroma * 0.007
                + this.audioChannels.pulse * 0.003
                + this.beatPulse * 0.004,
                0,
                0.014,
            )
            : 0;

        // Dynamic vignette: opens during intense moments (Tetris Effect signature technique)
        const vignetteOpenness = clamp(
            this.audioChannels.atmosphere * 0.3 + this.beatPulse * 0.15,
            0,
            0.4,
        );
        const vignetteDarkness = 0.9 - vignetteOpenness;
        const vignetteOffset = 1.1 + vignetteOpenness * 0.3;

        if (this.postProcessing && this.flags.usePost) {
            this.postProcessing.update({
                time: this.time,
                bloomStrength,
                bloomBoost: this.reactiveEnvelope.bloom + audioBloomBoost,
                chromaticStrength,
                filmGrain: this.qualityPreset.enableFilmGrain ? 0.015 : 0,
                vignetteDarkness,
                vignetteOffset,
            });
        }

        if (this.bloomPass) {
            const boost = this.reactiveEnvelope.bloom * 0.6
                + this.audioChannels.atmosphere * 0.3
                + this.audioChannels.pulse * 0.2;
            this.bloomPass.strength = clamp(this.qualityPreset.bloomStrength * (1 + boost), 0, 1.2);
        }

        if (this.chromaticPass?.uniforms?.uIntensity) {
            this.chromaticPass.uniforms.uIntensity.value = chromaticStrength;
        }

        if (this.filmGrainPass?.uniforms) {
            this.filmGrainPass.uniforms.uTime.value = this.time;
            this.filmGrainPass.uniforms.uStrength.value = this.qualityPreset.enableFilmGrain ? 0.015 : 0;
        }

        this.renderFrame();

        const frameEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.recordFrameMetrics(frameEndMs - frameStartMs);
    }

    updateAudioChannels(analysis, delta) {
        const shape = (value, gain, power = 0.84) => {
            const boosted = clamp(value * gain, 0, 1);
            return Math.pow(boosted, power);
        };

        const smooth = (current, target, attack, release) => {
            const rate = target > current ? attack : release;
            return THREE.MathUtils.lerp(current, target, clamp(delta * rate, 0, 1));
        };

        const musicPlaying = this.audioManager?.isMusicPlaying
            ? this.audioManager.isMusicPlaying()
            : true;
        const noAudioBaseline = musicPlaying
            ? 0
            : (0.04 + ((Math.sin(this.time * 0.75) * 0.5 + 0.5) * 0.04));

        const bassReactive = shape(analysis.bassEnergy, 1.4, 0.92);
        const midReactive = shape(analysis.midEnergy, 1.2, 0.9);
        const trebleReactive = shape(analysis.trebleEnergy, 1.5, 0.88);
        const overallReactive = shape(analysis.overallEnergy, 1.1, 0.94);

        const pulseTarget = Math.max(bassReactive, noAudioBaseline * 0.95);
        const flowTarget = Math.max(midReactive, noAudioBaseline * 0.7);
        const sparkEnergy = Math.max(trebleReactive, noAudioBaseline * 0.45);
        const atmosphereTarget = Math.max(overallReactive, noAudioBaseline * 0.8);

        this.audioChannels.pulse = smooth(this.audioChannels.pulse, pulseTarget, 5.5, 2.8);
        this.audioChannels.flow = smooth(this.audioChannels.flow, flowTarget, 4.8, 2.4);

        const sparkTarget = clamp((analysis.beatDetected ? 1.0 : 0.0) * 0.5 + sparkEnergy * 0.4, 0, 1);
        this.audioChannels.spark = smooth(this.audioChannels.spark, sparkTarget, 7.0, 3.2);

        this.audioChannels.atmosphere = smooth(this.audioChannels.atmosphere, atmosphereTarget, 3.5, 1.8);
    }

    updateReactiveEnvelope(delta) {
        const decay = {
            pulse: 1.8,
            bloom: 1.5,
            spark: 2.0,
            dust: 1.6,
            strand: 1.4,
            shake: 3.0,
            chroma: 2.4,
        };

        Object.keys(this.reactiveEnvelope).forEach((key) => {
            this.reactiveEnvelope[key] *= Math.exp(-decay[key] * delta);
            if (this.reactiveEnvelope[key] < 0.002) this.reactiveEnvelope[key] = 0;
        });
    }

    updateFormationState(delta) {
        if (this.formationState <= 0 || this.formationDuration <= 0) {
            this.formationProgress = 0;
            return;
        }

        this.formationTimer += delta;
        this.formationProgress = clamp(this.formationTimer / this.formationDuration, 0, 1);

        if (this.formationProgress >= 1) {
            this.formationState = 0;
            this.formationProgress = 0;
            this.formationTimer = 0;
            this.formationDuration = 0;
        }
    }

    updateDust(delta, analysis) {
        const pulseEnergy = clamp(this.audioChannels.pulse, 0, 1.3);
        const flowEnergy = clamp(this.audioChannels.flow, 0, 1.3);
        const atmosphereEnergy = clamp(this.audioChannels.atmosphere, 0, 1.35);
        const colorTemperature = this.getColorTemperatureValue();

        if (this.dustCompute?.computeNode && this.renderer?.compute && this.flags.useCompute) {
            this.dustCompute.update({
                delta,
                time: this.time,
                bass: clamp(pulseEnergy * 0.85, 0, 1.0),
                mid: clamp(flowEnergy * 0.8, 0, 1.0),
                energy: clamp(atmosphereEnergy * 0.8, 0, 1.0),
                beatPulse: clamp(this.beatPulse * 0.7 + this.audioChannels.spark * 0.15, 0, 0.85),
                formationState: this.formationState,
                formationProgress: this.formationProgress,
            });
            this.renderer.compute(this.dustCompute.computeNode);
        }

        if (!this.dustPoints) return;
        const uniforms = this.dustPoints.userData?.uniforms || this.dustUniforms;

        if (uniforms?.uTime) uniforms.uTime.value = this.time;
        if (uniforms?.uPulse) uniforms.uPulse.value = this.reactiveEnvelope.pulse + pulseEnergy * 0.7;
        if (uniforms?.uBass) uniforms.uBass.value = clamp(pulseEnergy * 0.75, 0, 1.0);
        if (uniforms?.uEventBoost) {
            uniforms.uEventBoost.value = clamp(
                this.dustEventBoost + this.reactiveEnvelope.dust + this.audioChannels.spark * 0.12,
                0,
                1.2,
            );
        }
        if (uniforms?.uColorTemperature) {
            uniforms.uColorTemperature.value = colorTemperature;
        }

        if (this.isWebGL && uniforms?.uPulse) {
            uniforms.uPulse.value = clamp(
                this.reactiveEnvelope.pulse + pulseEnergy * 0.55 + analysis.bassEnergy * 0.2,
                0,
                1.0,
            );
        }
    }

    updateBurst(delta) {
        const peripheralDecayRate = 3.4;
        const heroDecayRate = peripheralDecayRate * 1.15;
        this.heroBurstEnvelope = Math.max(0, this.heroBurstEnvelope - delta * heroDecayRate);
        this.peripheralBurstEnvelope = Math.max(0, this.peripheralBurstEnvelope - delta * peripheralDecayRate);

        const sparkUniformBoost = clamp(
            this.reactiveEnvelope.spark + this.audioChannels.spark + this.burstSparkBoost,
            0,
            1.8,
        );
        const burstSizeBoost = this.currentQualityLevel === 'Minimal'
            ? 0
            : clamp(this.heroBurstEnvelope + this.peripheralBurstEnvelope * 0.25, 0, 0.75);
        const colorTemperature = this.getColorTemperatureValue();

        if (this.burstCompute?.computeNode && this.renderer?.compute && this.flags.useCompute) {
            this.burstCompute.update({
                delta,
                time: this.time,
                flowBlend: 0.22 + this.audioChannels.flow * 0.3,
            });
            this.renderer.compute(this.burstCompute.computeNode);
        }

        if (this.burstPoints?.userData?.uniforms) {
            const { uniforms } = this.burstPoints.userData;
            if (uniforms.uTime) uniforms.uTime.value = this.time;
            if (uniforms.uSparkBoost) {
                uniforms.uSparkBoost.value = sparkUniformBoost;
            }
            if (uniforms.uBurstSizeBoost) {
                uniforms.uBurstSizeBoost.value = burstSizeBoost;
            }
            if (uniforms.uColorTemperature) {
                uniforms.uColorTemperature.value = colorTemperature;
            }
        }

        this.updateBurstCpu(delta, sparkUniformBoost, burstSizeBoost, colorTemperature);
        this.logBurstEffectsDebug(delta);
    }

    updateBurstCpu(delta, sparkUniformBoost = 0, burstSizeBoost = 0, colorTemperature = 0) {
        if (!Array.isArray(this.burstPools) || this.burstPools.length === 0) return;

        for (let p = 0; p < this.burstPools.length; p += 1) {
            const points = this.burstPools[p];
            const state = points?.userData?.cpuBurst;
            const uniforms = points?.userData?.uniforms;
            if (!state) continue;

            if (uniforms?.uTime) uniforms.uTime.value = this.time;
            if (uniforms?.uSparkBoost) uniforms.uSparkBoost.value = sparkUniformBoost;
            if (uniforms?.uBurstSizeBoost) uniforms.uBurstSizeBoost.value = burstSizeBoost;
            if (uniforms?.uColorTemperature) uniforms.uColorTemperature.value = colorTemperature;

            let activeCount = 0;
            for (let i = 0; i < state.life.length; i += 1) {
                const life = state.life[i];
                if (life <= 0) continue;

                const i3 = i * 3;
                const nextLife = Math.max(0, life - delta / Math.max(0.4, state.maxLife[i]));
                state.life[i] = nextLife;

                if (nextLife <= 0.001) {
                    state.positions[i3 + 2] = -9999;
                    continue;
                }

                activeCount += 1;

                const decel = Math.max(0.25, 1.0 - Math.pow(1.0 - nextLife, 1.5));
                state.velocity[i3 + 1] += -8.0 * delta;
                state.positions[i3] += state.velocity[i3] * delta * decel;
                state.positions[i3 + 1] += state.velocity[i3 + 1] * delta * decel;
                state.positions[i3 + 2] += state.velocity[i3 + 2] * delta * decel;
            }

            state.active = activeCount > 0;

            if (activeCount > 0) {
                points.geometry.attributes.position.needsUpdate = true;
                points.geometry.attributes.aLife.needsUpdate = true;
                points.geometry.attributes.aVelocity.needsUpdate = true;
            }
        }
    }

    updateWisps(delta, analysis) {
        if (this.wispCompute?.computeNode && this.renderer?.compute && this.flags.useCompute) {
            const wispPulse = clamp(this.beatPulse + this.wispJolt * 0.65, 0, 1);
            this.wispCompute.update({
                time: this.time,
                delta,
                treble: this.audioChannels.spark,
                mid: this.audioChannels.flow,
                beatPulse: wispPulse,
            });
            this.renderer.compute(this.wispCompute.computeNode);
        }

        if (this.wispCpuState && this.wispPoints?.geometry?.attributes?.position) {
            const { positions, pulse, ampX, ampY, ampZ, freqA, freqB, freqC, phase, group } = this.wispCpuState;
            const count = pulse.length;

            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                const t = this.time * 0.4 * (1 + this.audioChannels.spark * 0.3);

                const lx = ampX[i] * Math.sin(t * freqA[i] + phase[i]);
                const ly = ampY[i] * Math.sin(t * freqB[i] + phase[i] * 0.7);
                const lz = ampZ[i] * Math.sin(t * freqC[i] + phase[i] * 1.3);

                let ax = 0;
                let ay = 0;
                let az = 0;
                if (group[i] < 0.25) {
                    ax = Math.sin(t * 0.14) * 640;
                    ay = Math.cos(t * 0.12) * 240;
                    az = Math.cos(t * 0.16) * 520;
                } else if (group[i] < 0.5) {
                    ax = Math.cos(t * 0.11) * 580;
                    ay = Math.sin(t * 0.13) * 260;
                    az = Math.sin(t * 0.17) * 600;
                } else if (group[i] < 0.75) {
                    ax = Math.sin(t * 0.18 + 1.2) * 520;
                    ay = Math.cos(t * 0.10 + 0.8) * 300;
                    az = Math.cos(t * 0.15 + 2.0) * 560;
                } else {
                    ax = Math.cos(t * 0.16 + 2.1) * 620;
                    ay = Math.sin(t * 0.11 + 1.7) * 220;
                    az = Math.sin(t * 0.14 + 0.5) * 500;
                }

                const cohesion = 0.22 + this.audioChannels.flow * 0.4;
                let px = THREE.MathUtils.lerp(lx, ax, cohesion);
                let py = THREE.MathUtils.lerp(ly, ay, cohesion);
                let pz = THREE.MathUtils.lerp(lz, az, cohesion);

                const beatScale = 1 + this.beatPulse * 0.18 + this.wispJolt * 0.1;
                px *= beatScale;
                py *= beatScale;
                pz *= beatScale;

                positions[i3] = px;
                positions[i3 + 1] = py;
                positions[i3 + 2] = pz;

                pulse[i] = 1 + this.beatPulse * 0.22 + this.wispJolt * 0.12;
            }

            this.wispPoints.geometry.attributes.position.needsUpdate = true;
            this.wispPoints.geometry.attributes.aPulse.needsUpdate = true;
        }

        const uniforms = this.wispPoints?.userData?.uniforms || this.wispUniforms;
        if (!uniforms) return;

        const colorTemperature = this.getColorTemperatureValue();
        if (uniforms.uTime) uniforms.uTime.value = this.time;
        if (uniforms.uTreble) uniforms.uTreble.value = this.audioChannels.spark;
        if (uniforms.uBeatPulse) uniforms.uBeatPulse.value = clamp(this.beatPulse + this.wispJolt * 0.65, 0, 1);
        if (uniforms.uColorTemperature) uniforms.uColorTemperature.value = colorTemperature;

        if (this.isWebGL && uniforms.uBeatPulse) {
            uniforms.uBeatPulse.value = this.beatPulse;
        }
    }

    updateStrands(delta, analysis) {
        if (!Array.isArray(this.strands) || this.strands.length === 0) return;

        const intensity = clamp(this.reactiveEnvelope.strand + this.audioChannels.flow * 0.8, 0, 1.3);
        const unwind = clamp(this.strandUnwind, 0, 1);
        const colorTemperature = this.getColorTemperatureValue();

        for (let i = 0; i < this.strands.length; i += 1) {
            const strand = this.strands[i];
            const uniforms = strand?.userData?.uniforms;
            const basePositions = strand?.userData?.basePositions;
            const paramT = strand?.userData?.paramT;

            if (!strand || !basePositions || !paramT) continue;

            strand.rotation.y += delta * (strand.userData.spin * 0.4 + this.audioChannels.flow * 0.08);
            strand.position.addScaledVector(strand.userData.drift, delta * (0.3 + this.audioChannels.atmosphere * 0.1));
            const home = strand.userData.home;
            if (home) {
                strand.position.lerp(home, clamp(delta * 0.08, 0, 0.2));
            }

            const bounds = strand.userData.bounds || new THREE.Vector3(3200, 1800, 2600);
            if (Math.abs(strand.position.x) > bounds.x) {
                strand.position.x = THREE.MathUtils.clamp(strand.position.x, -bounds.x, bounds.x);
                strand.userData.drift.x *= -1;
            }
            if (Math.abs(strand.position.y) > bounds.y) {
                strand.position.y = THREE.MathUtils.clamp(strand.position.y, -bounds.y, bounds.y);
                strand.userData.drift.y *= -1;
            }
            if (Math.abs(strand.position.z) > bounds.z) {
                strand.position.z = THREE.MathUtils.clamp(strand.position.z, -bounds.z, bounds.z);
                strand.userData.drift.z *= -1;
            }

            const positions = strand.geometry.attributes.position.array;
            // Radial swells reacting to bass and mids (using smoothed channels)
            const radiusScale = 1 + this.audioChannels.flow * 0.05 + this.audioChannels.pulse * 0.07 + unwind * 0.35;
            const scatter = unwind * 95;
            const direction = strand.userData.windingDirection || 1.0;

            // Travel speed reacts to treble transients, amplitude reactive to beatPulse
            const rippleSpeed = 22.0 + this.audioChannels.spark * 12.0;
            const rippleFreq = 3.6;
            const rippleAmp = this.audioChannels.spark * 8.0 + this.audioChannels.flow * 4.0 + this.beatPulse * 5.0;

            // Winding twist reacts to treble and bass (using smoothed channels)
            const twistAmp = this.audioChannels.flow * 0.15 + this.audioChannels.pulse * 0.05;

            for (let p = 0; p < paramT.length; p += 1) {
                const i3 = p * 3;
                const t = paramT[p] + this.time * (0.06 + this.audioChannels.flow * 0.08);
                const baseX = basePositions[i3];
                const baseY = basePositions[i3 + 1];
                const baseZ = basePositions[i3 + 2];

                const radial = Math.sqrt(baseX * baseX + baseZ * baseZ);
                const angle = Math.atan2(baseZ, baseX);
                const undulate = 1 + Math.sin(this.time * 0.32 + p * 0.012 + i * 1.1) * 0.08;

                // Torsion twisting phase shift along the strand height
                const twist = twistAmp * Math.sin(paramT[p] * 1.5 - this.time * 2.5);

                const musicRipple = Math.sin(paramT[p] * rippleFreq - this.time * rippleSpeed) * rippleAmp;

                positions[i3] = Math.cos(angle + direction * this.time * 0.12 + twist) * (radial * radiusScale * undulate + musicRipple)
                    + Math.sin(t * 0.3) * scatter;
                positions[i3 + 1] = baseY + Math.sin(this.time * 0.24 + p * 0.02) * 15 + Math.cos(t * 0.25) * scatter * 0.38;
                positions[i3 + 2] = Math.sin(angle + direction * this.time * 0.12 + twist) * (radial * radiusScale * undulate + musicRipple)
                    + Math.cos(t * 0.3) * scatter;
            }

            strand.geometry.attributes.position.needsUpdate = true;

            if (uniforms?.uTime) uniforms.uTime.value = this.time;
            if (uniforms?.uIntensity) uniforms.uIntensity.value = intensity;
            if (uniforms?.uColorTemperature) uniforms.uColorTemperature.value = colorTemperature;
        }

        this.strandUnwind = Math.max(0, this.strandUnwind - delta * 0.55);
    }

    updateTemporaryStrands(delta, analysis) {
        if (!Array.isArray(this.tempStrandSegments) || this.tempStrandSegments.length === 0) return;

        const colorTemperature = this.getColorTemperatureValue();
        for (let i = this.tempStrandSegments.length - 1; i >= 0; i -= 1) {
            const segment = this.tempStrandSegments[i];
            const geometry = segment?.geometry;
            const positionsAttr = geometry?.attributes?.position;
            const basePositions = segment?.userData?.basePositions;
            const paramT = segment?.userData?.paramT;
            if (!segment || !positionsAttr || !basePositions || !paramT) {
                this.disposeTemporaryStrandSegment(segment);
                this.tempStrandSegments.splice(i, 1);
                continue;
            }

            segment.userData.life -= delta;
            const lifeNorm = clamp(segment.userData.life / Math.max(0.001, segment.userData.maxLife), 0, 1);
            if (lifeNorm <= 0) {
                this.disposeTemporaryStrandSegment(segment);
                this.tempStrandSegments.splice(i, 1);
                continue;
            }

            const positions = positionsAttr.array;
            const scatter = (segment.userData.scatter || 110) * (1.0 - lifeNorm);
            const pulse = 1.0 + this.audioChannels.flow * 0.35 + this.reactiveEnvelope.strand * 0.25;
            const driftScale = 0.55 + (1.0 - lifeNorm) * 0.9;
            segment.position.addScaledVector(segment.userData.drift, delta * driftScale);
            segment.rotation.y += delta * segment.userData.spin * 0.4;

            for (let p = 0; p < paramT.length; p += 1) {
                const i3 = p * 3;
                const t = paramT[p] + this.time * (0.08 + this.audioChannels.flow * 0.15);
                const baseX = basePositions[i3];
                const baseY = basePositions[i3 + 1];
                const baseZ = basePositions[i3 + 2];

                const wave = Math.sin(t * 0.4 + p * 0.01 + this.time * 0.2);
                positions[i3] = baseX * pulse + Math.sin(t * 0.5) * scatter * 0.55;
                positions[i3 + 1] = baseY + wave * scatter * 0.36 + Math.cos(t * 0.2) * 16;
                positions[i3 + 2] = baseZ * pulse + Math.cos(t * 0.45) * scatter * 0.55;
            }

            positionsAttr.needsUpdate = true;

            const uniforms = segment.userData.uniforms;
            if (uniforms?.uTime) uniforms.uTime.value = this.time;
            if (uniforms?.uIntensity) {
                uniforms.uIntensity.value = clamp(
                    segment.userData.intensity * (0.45 + lifeNorm * 0.85 + analysis.midEnergy * 0.4),
                    0,
                    1.45,
                );
            }
            if (uniforms?.uColorTemperature) {
                uniforms.uColorTemperature.value = clamp(colorTemperature + (1.0 - lifeNorm) * 0.24, 0, 1.0);
            }
        }
    }

    updateBeams(delta, analysis) {
        if (!Array.isArray(this.beams) || this.beams.length === 0) return;
        const bassEnergy = clamp(Math.max(this.audioChannels.pulse, analysis.bassEnergy), 0, 1.2);

        for (let i = 0; i < this.beams.length; i += 1) {
            const beam = this.beams[i];
            const mesh = beam.mesh;
            const speed = beam.baseSpeed * (1 + this.beamFlash * 2.1 + this.reactiveEnvelope.strand * 1.0);
            mesh.rotation.y += delta * speed;
            mesh.rotation.x = Math.sin(this.time * 0.4 + beam.wobblePhase) * 0.08;
            mesh.rotation.z = Math.cos(this.time * 0.35 + beam.wobblePhase * 1.3) * 0.08;

            const opacity = beam.baseOpacity * (0.42 + bassEnergy * 0.78) + this.beamFlash * 0.25;
            if (beam.uniforms?.uOpacity) {
                beam.uniforms.uOpacity.value = clamp(opacity, 0, 1);
            } else if (mesh.material) {
                mesh.material.opacity = clamp(opacity, 0, 1);
            }
        }
    }

    updateShockwaves(delta) {
        for (let i = this.shockwaves.length - 1; i >= 0; i -= 1) {
            const wave = this.shockwaves[i];
            if (!wave?.mesh) continue;

            wave.life -= delta;
            wave.mesh.scale.multiplyScalar(1 + delta * wave.expandSpeed);

            const alpha = clamp(wave.life / wave.maxLife, 0, 1) * wave.baseOpacity;
            if (wave.uniforms?.uOpacity) {
                wave.uniforms.uOpacity.value = alpha;
            } else if (wave.mesh.material) {
                wave.mesh.material.opacity = alpha;
            }

            if (wave.life <= 0) {
                if (wave.mesh.parent) wave.mesh.parent.remove(wave.mesh);
                wave.mesh.geometry?.dispose?.();
                wave.mesh.material?.dispose?.();
                this.shockwaves.splice(i, 1);
            }
        }
    }

    updateCamera(delta, analysis) {
        if (!this.camera) return;

        // --- Decay nudges each frame ---
        this.cameraLookNudgeY = THREE.MathUtils.lerp(this.cameraLookNudgeY, 0, delta * 4.0);
        this.cameraZoomNudgeZ = THREE.MathUtils.lerp(this.cameraZoomNudgeZ, 0, delta * 3.0);

        // --- Cinematic time layers (overlapping periods prevent repetition) ---
        const ct1 = this.time * 0.04;   // ~157s period — primary slow orbit
        const ct2 = this.time * 0.027;  // ~233s period — secondary drift
        const ct3 = this.time * 0.017;  // ~370s period — ultra-slow sweep

        // --- Lissajous orbit with three frequency layers ---
        const orbitX = Math.sin(ct1) * 220
            + Math.cos(ct2 * 1.3 + 0.8) * 140
            + Math.sin(ct3 * 0.7) * 80;
        const orbitY = Math.cos(ct1 * 0.85) * 150
            + Math.sin(ct2 * 1.1 + 1.4) * 90
            + Math.cos(ct3 * 0.5 + 2.1) * 55;

        // --- Z-breathing with long-period depth sweeps (Framing board closer) ---
        const breatheZ = this.cameraBasePosition.z - 180
            + Math.sin(ct1 * 0.5) * 300
            + Math.sin(ct2 * 0.35 + 1.0) * 180
            + Math.sin(ct3 * 0.25) * 100;

        // --- Organic handheld camera drift / breathing cadence ---
        const breathT = this.time * 1.35; // ~4.6s breathing period
        const breathX = Math.sin(breathT) * 18.0 + Math.cos(breathT * 0.6) * 8.0;
        const breathY = Math.cos(breathT * 1.1) * 15.0 + Math.sin(breathT * 0.4) * 6.0;
        const breathZ = Math.sin(breathT * 0.8) * 35.0;

        // --- Smooth wandering drift (Brownian-like inertia) ---
        const driftForce = 12;
        const driftDamping = 0.92;
        const driftLimit = 160;
        this.cameraDriftVelocity.x += (Math.sin(ct2 * 2.1 + 0.3) * driftForce
            + Math.cos(ct3 * 1.7) * driftForce * 0.6) * delta;
        this.cameraDriftVelocity.y += (Math.cos(ct2 * 1.8 + 1.9) * driftForce * 0.7
            + Math.sin(ct3 * 1.3 + 0.7) * driftForce * 0.4) * delta;
        this.cameraDriftVelocity.z += (Math.sin(ct2 * 1.4 + 2.5) * driftForce * 0.5) * delta;
        this.cameraDriftVelocity.multiplyScalar(Math.pow(driftDamping, delta * 60));
        this.cameraDrift.add(this.cameraDriftVelocity.clone().multiplyScalar(delta));
        this.cameraDrift.clampScalar(-driftLimit, driftLimit);

        // --- Smoothed audio sway (gentle, interpolated response to music) ---
        const swayTargetX = (this.audioChannels.flow ?? 0) * 45 * Math.sin(ct1 * 1.6);
        const swayTargetY = (this.audioChannels.pulse ?? 0) * 30 * Math.cos(ct1 * 1.2);
        const swayTargetZ = (this.audioChannels.atmosphere ?? 0) * 25;
        const swaySmooth = clamp(delta * 1.8, 0, 0.15);
        this.cameraAudioSway.x += (swayTargetX - this.cameraAudioSway.x) * swaySmooth;
        this.cameraAudioSway.y += (swayTargetY - this.cameraAudioSway.y) * swaySmooth;
        this.cameraAudioSway.z += (swayTargetZ - this.cameraAudioSway.z) * swaySmooth;

        // --- Audio-reactive depth pull (smoothed & amplified for heavy drops) ---
        const audioPush = (analysis.bassEnergy ?? 0) * 85 + (analysis.overallEnergy ?? 0) * 45 + this.beatPulse * 65;

        // --- Camera shake (event-driven only) ---
        const shakeAmp = clamp(this.reactiveEnvelope.shake * 50, 0, 50);
        this.cameraShake.set(
            (Math.random() - 0.5) * shakeAmp,
            (Math.random() - 0.5) * shakeAmp,
            (Math.random() - 0.5) * shakeAmp * 0.5,
        );

        // --- Smooth pointer tracking (frame-rate independent damping) ---
        const lerpFactor = clamp(delta * 2.2, 0.0, 0.15);
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, lerpFactor);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, lerpFactor);

        const parallaxX = this.smoothedPointerX * 180.0;
        const parallaxY = -this.smoothedPointerY * 110.0;

        // --- Compose final camera position ---
        this.camera.position.set(
            this.cameraBasePosition.x + orbitX + this.cameraDrift.x
                + this.cameraAudioSway.x + this.cameraShake.x + parallaxX + breathX,
            this.cameraBasePosition.y + orbitY + this.cameraDrift.y
                + this.cameraAudioSway.y + this.cameraShake.y + parallaxY + breathY,
            breatheZ - audioPush + this.cameraDrift.z
                + this.cameraAudioSway.z + this.cameraShake.z + breathZ + this.cameraZoomNudgeZ,
        );

        // --- Look-target drift (parallax-offset, never stares at dead center) ---
        const lookOffsetX = Math.sin(ct1 * 0.6) * 90 + Math.cos(ct2 * 0.8 + 1.5) * 50 + parallaxX * 0.45;
        const lookOffsetY = Math.cos(ct1 * 0.5 + 0.7) * 55
            + Math.sin(ct2 * 0.65) * 30
            + (analysis.overallEnergy ?? 0) * 8
            + this.comboFlashIntensity * 12
            + parallaxY * 0.45
            + this.cameraLookNudgeY;

        this.camera.lookAt(
            this.cameraTarget.x + lookOffsetX,
            this.cameraTarget.y + lookOffsetY,
            this.cameraTarget.z,
        );

        // --- Cinematic roll tilt (banking into the orbit direction) ---
        const orbitVelX = Math.cos(ct1) * 220 * 0.04
            - Math.sin(ct2 * 1.3 + 0.8) * 140 * 0.027 * 1.3;
        this.cameraRollTarget = clamp(orbitVelX * -0.0004, -0.035, 0.035);
        this.cameraRoll += (this.cameraRollTarget - this.cameraRoll) * clamp(delta * 1.2, 0, 0.1);
        this.camera.rotation.z += this.cameraRoll;
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;

        this.renderer.clear();

        if (this.isWebGPU) {
            if (this.postProcessing && this.flags.usePost) {
                this.postProcessing.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }
            return;
        }

        if (this.composer && this.qualityPreset.enablePostProcessing && !this.flags.noPost) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    setupResizeHandler() {
        this.removeResizeListener();
        this.resizeHandler = () => this.onWindowResize();
        window.addEventListener('resize', this.resizeHandler);
    }

    removeResizeListener() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    onWindowResize() {
        if (!this.renderer || !this.camera) return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);

        this.composer?.setSize?.(width, height);
        this.postProcessing?.setSize?.(width, height);
        this.updateCompositionLayout();
        this.applySceneComposition();
    }

    registerDeferredTimeout(callback, delayMs) {
        const normalizedDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
        const task = {
            executeAt: this.time + normalizedDelayMs / 1000,
            callback,
            id: `deferred-${this.deferredTaskId}`,
        };
        this.deferredTaskId += 1;
        this.deferredTimeouts.add(task);
        return task.id;
    }

    runDeferredTimeouts() {
        if (!this.deferredTimeouts.size) return;

        const due = [];
        this.deferredTimeouts.forEach((task) => {
            if (!task || typeof task.callback !== 'function') {
                this.deferredTimeouts.delete(task);
                return;
            }
            if (this.time >= task.executeAt) {
                due.push(task);
            }
        });

        due.sort((a, b) => a.executeAt - b.executeAt);
        due.forEach((task) => {
            this.deferredTimeouts.delete(task);
            try {
                task.callback();
            } catch (error) {
                console.warn('[ChiralGold] Deferred callback failed:', error);
            }
        });
    }

    clearDeferredTimeouts() {
        this.deferredTimeouts.clear();
    }

    pushReactiveEnvelope(values = {}) {
        Object.entries(values).forEach(([key, value]) => {
            if (!(key in this.reactiveEnvelope)) return;
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return;
            this.reactiveEnvelope[key] = Math.min((this.reactiveEnvelope[key] || 0) + numericValue, 1.0);
        });
    }

    getChoreographyCaps() {
        switch (this.currentQualityLevel) {
            case 'Extreme':
            case 'Ultra':
            case 'High':
                return {
                    eventScale: 1.0,
                    maxBurstPulses: 4,
                    maxTrailBursts: 2,
                    maxShockwaves: 4,
                    maxExtraShockwaves: 3,
                    allowAdvancedScreenFx: true,
                    allowFormation: true,
                    allowBeamFlash: true,
                    allowStrandUnwind: true,
                };
            case 'Medium':
                return {
                    eventScale: 0.82,
                    maxBurstPulses: 2,
                    maxTrailBursts: 1,
                    maxShockwaves: 3,
                    maxExtraShockwaves: 1,
                    allowAdvancedScreenFx: false,
                    allowFormation: true,
                    allowBeamFlash: false,
                    allowStrandUnwind: true,
                };
            case 'Low':
                return {
                    eventScale: 0.62,
                    maxBurstPulses: 1,
                    maxTrailBursts: 0,
                    maxShockwaves: 2,
                    maxExtraShockwaves: 0,
                    allowAdvancedScreenFx: false,
                    allowFormation: false,
                    allowBeamFlash: false,
                    allowStrandUnwind: false,
                };
            case 'Minimal':
                return {
                    eventScale: 0.5,
                    maxBurstPulses: 1,
                    maxTrailBursts: 0,
                    maxShockwaves: 1,
                    maxExtraShockwaves: 0,
                    allowAdvancedScreenFx: false,
                    allowFormation: false,
                    allowBeamFlash: false,
                    allowStrandUnwind: false,
                };
            default:
                return {
                    eventScale: 1.0,
                    maxBurstPulses: 3,
                    maxTrailBursts: 1,
                    maxShockwaves: 3,
                    maxExtraShockwaves: 1,
                    allowAdvancedScreenFx: true,
                    allowFormation: true,
                    allowBeamFlash: true,
                    allowStrandUnwind: true,
                };
        }
    }

    getPeripheralBurstFanOut() {
        switch (this.currentQualityLevel) {
            case 'Extreme':
            case 'Ultra':
            case 'High':
                return 2;
            case 'Medium':
                return 1;
            case 'Low':
            case 'Minimal':
            default:
                return 0;
        }
    }

    getTempStrandBurstCount(comboCount = 0) {
        if (this.currentQualityLevel === 'Low' || this.currentQualityLevel === 'Minimal') {
            return 0;
        }

        let count = comboCount >= 10 ? 4 : comboCount >= 7 ? 3 : 2;
        if (this.currentQualityLevel === 'Medium') {
            count = Math.min(count, 2);
        }
        return count;
    }

    getColorTemperatureValue() {
        const reactive = this.reactiveEnvelope.spark * 0.16 + this.audioChannels.spark * 0.08;
        // Continuous audio heat: scene warms from gold toward white during intense passages
        const energyHeat = this.audioChannels.atmosphere * 0.25;
        const bassHeat = this.audioChannels.pulse * 0.12;
        if (this.currentQualityLevel === 'Minimal') {
            return clamp(this.colorTemperatureBoost * 0.35 + reactive * 0.25, 0, 0.35);
        }
        return clamp(this.colorTemperatureBoost + reactive + energyHeat + bassHeat, 0, 1.0);
    }

    setupEventListeners() {
        this.clearEventSubscriptions();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock(data);
            }
        });

        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
    }

    clearEventSubscriptions() {
        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.warn('[ChiralGold] Failed to unsubscribe event listener:', error);
            }
        });
        this.eventUnsubscribers = [];
    }

    handlePieceLock(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const piece = detail.piece;

        const caps = this.getChoreographyCaps();
        const eventScale = caps.eventScale;
        this.dustEventBoost = Math.min(this.dustEventBoost + 0.36 * eventScale, 2.0);
        this.wispJolt = Math.min(this.wispJolt + 0.18 * eventScale, 1.0);
        this.pushReactiveEnvelope({
            pulse: 0.08 * eventScale,
            dust: 0.14 * eventScale,
            bloom: 0.04 * eventScale,
            spark: 0.03 * eventScale,
            shake: 0.07 * eventScale,
        });

        this.cameraLookNudgeY = -18.0 * eventScale;

        const lockOrigin3D = this.getOriginFromPiece(piece);
        if (lockOrigin3D) {
            // Localized subtle golden burst at the exact locking location
            const lockIntensity = (0.32 + eventScale * 0.16) * (caps.allowAdvancedScreenFx ? 1.0 : 0.84);
            this.triggerBurst(lockIntensity, 0, {
                profile: 'lock_burst',
                origin: lockOrigin3D,
                sizeMultiplier: 0.45,
                velocityMultiplier: 0.35,
                sparkBoost: 0.08 * eventScale,
                lifeMultiplier: 0.45,
            });

            // Localized thin expanding ring centered on the locked piece
            if (caps.maxShockwaves > 0) {
                this.createShockwave({
                    radius: 12.0,
                    tube: 0.32,
                    life: 0.85,
                    opacity: 0.14 * eventScale,
                    speed: 1.8,
                    origin: lockOrigin3D,
                });
            }
        }
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;
        const caps = this.getChoreographyCaps();
        const eventScale = caps.eventScale;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
            this.pushReactiveEnvelope({
                pulse: Math.min(0.05 + comboCount * 0.05, 0.5) * eventScale,
                bloom: Math.min(0.04 + comboCount * 0.05, 0.55) * eventScale,
                spark: Math.min(0.05 + comboCount * 0.06, 0.6) * eventScale,
                dust: Math.min(0.04 + comboCount * 0.05, 0.5) * eventScale,
                strand: Math.min(0.05 + comboCount * 0.04, 0.45) * eventScale,
                chroma: caps.allowAdvancedScreenFx
                    ? Math.min(0.02 + comboCount * 0.03, 0.35) * eventScale
                    : 0,
            });

            if (caps.allowStrandUnwind) {
                this.strandUnwind = Math.min(this.strandUnwind + comboCount * 0.06 * eventScale, 1.0);
            }
            if (caps.allowBeamFlash) {
                this.beamFlash = Math.min(this.beamFlash + comboCount * 0.08 * eventScale, 1.0);
            }
            if (comboCount >= 4) {
                const heatTarget = clamp((0.12 + comboCount * 0.09) * eventScale, 0, 0.95);
                this.colorTemperatureBoost = Math.max(this.colorTemperatureBoost, heatTarget);
            }
        }
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;
        const caps = this.getChoreographyCaps();
        const eventScale = caps.eventScale;

        this.cameraLookNudgeY = -90.0 * eventScale;
        this.cameraZoomNudgeZ = -160.0 * eventScale;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        const comboMultiplier = Math.min(1 + comboCount * 0.25, 2.5);

        this.pushReactiveEnvelope({
            pulse: Math.min(0.15 + lineCount * 0.1 + comboCount * 0.08, 1.0) * eventScale,
            bloom: Math.min(0.05 + lineCount * 0.08 + comboCount * 0.06, 1.0) * eventScale,
            spark: Math.min(0.14 + comboCount * 0.12, 1.0) * eventScale,
            dust: Math.min(0.12 + comboCount * 0.1, 1.0) * eventScale,
            strand: Math.min(0.08 + comboCount * 0.06, 1.0) * eventScale,
            shake: caps.allowAdvancedScreenFx && comboCount >= 6
                ? Math.min(0.2 + comboCount * 0.08, 1.0) * eventScale
                : 0,
            chroma: caps.allowAdvancedScreenFx && comboCount >= 6
                ? Math.min(0.06 + comboCount * 0.05, 0.9) * eventScale
                : 0,
        });

        this.comboFlashIntensity = caps.allowAdvancedScreenFx && comboCount >= 6
            ? Math.min(1.0, this.comboFlashIntensity + 0.45 + comboCount * 0.04)
            : this.comboFlashIntensity;

        this.dustEventBoost = Math.min(
            this.dustEventBoost + (0.45 + comboCount * 0.08) * eventScale,
            2.0,
        );
        if (comboCount >= 3) {
            const lineHeatBoost = clamp((0.18 + comboCount * 0.08) * eventScale, 0, 1.0);
            this.colorTemperatureBoost = Math.max(this.colorTemperatureBoost, lineHeatBoost);
        }

        let burstsToTrigger = 1;
        if (comboCount >= 10) burstsToTrigger = 4;
        else if (comboCount >= 8) burstsToTrigger = 3;
        else if (comboCount >= 4) burstsToTrigger = 2;
        burstsToTrigger = Math.min(burstsToTrigger, caps.maxBurstPulses);

        const extraTrailBursts = Math.min(comboCount >= 6 ? 2 : 0, caps.maxTrailBursts);
        const peripheralFanOut = this.getPeripheralBurstFanOut();
        const heroAmplification = this.currentQualityLevel !== 'Minimal';

        const fireBurstPulse = (pulseIndex, intensity, { trail = false } = {}) => {
            const heroIntensity = intensity * (trail ? 0.95 : 1.05);
            const heroSparkBoost = clamp(
                (0.34 + comboCount * 0.035) * (trail ? 0.82 : 1.0),
                0,
                0.95,
            );
            this.triggerBurst(heroIntensity, comboCount, {
                profile: 'hero_close',
                origin: this.getBurstOrigin('hero_close', {
                    intensity: 0.88 + comboCount * 0.08,
                    index: pulseIndex * 5 + 1,
                }),
                sizeMultiplier: heroAmplification ? (trail ? 1.45 : 1.6) : 1.0,
                velocityMultiplier: heroAmplification ? (trail ? 1.14 : 1.2) : 1.0,
                sparkBoost: heroSparkBoost,
                lifeMultiplier: 0.87,
            });

            for (let fan = 0; fan < peripheralFanOut; fan += 1) {
                const fanScale = 0.74 + fan * 0.14;
                this.triggerBurst(intensity * fanScale, comboCount, {
                    profile: 'peripheral',
                    origin: this.getBurstOrigin('peripheral', {
                        intensity: 0.8 + comboCount * 0.07,
                        index: pulseIndex * 5 + 2 + fan,
                    }),
                    sizeMultiplier: 1.0,
                    velocityMultiplier: 1.0,
                    sparkBoost: clamp(0.16 + comboCount * 0.02, 0, 0.7),
                    lifeMultiplier: 1.0,
                });
            }
        };

        for (let s = 0; s < burstsToTrigger; s += 1) {
            const runBurst = () => {
                const burstIntensity = Math.min(
                    1.0 + comboCount * 0.14 + s * 0.08 + this.reactiveEnvelope.spark * 0.7,
                    2.25,
                ) * comboMultiplier * (0.55 + eventScale * 0.45);
                fireBurstPulse(s, burstIntensity);
            };

            if (s === 0) runBurst();
            else this.registerDeferredTimeout(runBurst, s * 150);
        }

        for (let t = 0; t < extraTrailBursts; t += 1) {
            this.registerDeferredTimeout(() => {
                const trailingIntensity = Math.min(
                    (1.4 + comboCount * 0.05 + t * 0.08) * (0.6 + eventScale * 0.4),
                    2.1,
                );
                fireBurstPulse(20 + t, trailingIntensity, { trail: true });
            }, 320 + t * 140);
        }

        const baseShockwaves = Math.min(
            lineCount + Math.floor(comboCount / 2),
            caps.maxShockwaves,
        );
        for (let i = 0; i < baseShockwaves; i += 1) {
            this.registerDeferredTimeout(() => {
                this.createShockwave({
                    radius: 34 + i * 7,
                    tube: 1.6 + i * 0.15,
                    life: 1.8,
                    opacity: 0.42 * eventScale,
                    speed: 3.3 + i * 0.2,
                    origin: this.getBurstOrigin('shockwave', {
                        intensity: 0.72 + comboCount * 0.06,
                        index: 40 + i,
                    }),
                });
            }, i * 100);
        }

        if (comboCount >= 6) {
            const extraShockwaves = Math.min(
                caps.maxExtraShockwaves,
                Math.floor(comboCount / 3),
            );
            for (let i = 0; i < extraShockwaves; i += 1) {
                this.registerDeferredTimeout(() => {
                    this.createShockwave({
                        radius: 68 + i * 14,
                        tube: 2.0,
                        life: 1.4,
                        opacity: 0.36 * eventScale,
                        speed: 4.2,
                        origin: this.getBurstOrigin('shockwave', {
                            intensity: 0.96 + comboCount * 0.08,
                            index: 60 + i,
                        }),
                    });
                }, 220 + i * 120);
            }
        }

        if (caps.allowBeamFlash && comboCount >= 4) {
            this.beamFlash = Math.min(1.0, this.beamFlash + 0.55 * eventScale);
        }

        if (caps.allowStrandUnwind && comboCount >= 3) {
            this.strandUnwind = Math.min(1.0, this.strandUnwind + 0.6 * eventScale);
        }

        if (comboCount >= 3) {
            const tempSegmentBursts = this.getTempStrandBurstCount(comboCount);
            for (let i = 0; i < tempSegmentBursts; i += 1) {
                this.registerDeferredTimeout(() => {
                    this.createTemporaryStrandSegment({
                        comboCount,
                        intensity: 0.8 + comboCount * 0.12 + i * 0.15,
                        life: 2.0 + this.rand() * 1.0,
                        origin: this.getBurstOrigin('peripheral', {
                            intensity: 0.8 + comboCount * 0.1,
                            index: 92 + i,
                        }),
                    });
                }, i * 110);
            }
        }
        // Spawn grid-line dissolve particles for the cleared rows
        const clearedRows = detail.clearedRows || [];
        if (Array.isArray(clearedRows) && clearedRows.length > 0) {
            const totalRows = Math.max(20, Math.max(...clearedRows) + 1);
            clearedRows.forEach((y) => {
                for (let colIdx = 0; colIdx < 5; colIdx++) {
                    const ndcX = -0.20 + colIdx * 0.10;
                    const ndcY = 0.36 - (y / (totalRows - 1)) * 0.72;
                    const origin3D = this.projectNdcToPlane(ndcX, ndcY, 0.0);
                    if (origin3D) {
                        const burstIntensity = Math.min(
                            1.2 + comboCount * 0.12 + this.reactiveEnvelope.spark * 0.6,
                            2.4,
                        ) * (0.65 + eventScale * 0.35);
                        
                        this.triggerBurst(burstIntensity, comboCount, {
                            profile: 'dissolve',
                            origin: origin3D,
                            sizeMultiplier: 1.1,
                            velocityMultiplier: 1.0,
                            sparkBoost: clamp(0.22 + comboCount * 0.04, 0, 0.95),
                            lifeMultiplier: 0.85,
                        });
                    }
                }
            });
        }

        if (caps.allowFormation) {
            if (comboCount >= 10) {
                this.setFormation(3, 4.8);
            } else if (comboCount >= 7) {
                this.setFormation(2, 1.8);
            } else if (comboCount >= 4) {
                this.setFormation(1, 2.0);
            }
        }
    }

    triggerBurst(intensity, comboCount = 0, originOrOptions = null) {
        const options = originOrOptions?.isVector3
            ? { origin: originOrOptions }
            : (originOrOptions || {});
        const profile = typeof options.profile === 'string' ? options.profile : 'peripheral';
        const isMinimal = this.currentQualityLevel === 'Minimal';

        const burstOrigin = options.origin?.isVector3
            ? options.origin
            : this.getBurstOrigin(profile, {
                intensity,
                index: comboCount,
            });

        const defaultSizeMultiplier = profile === 'hero_close' ? 1.6 : 1.0;
        const defaultVelocityMultiplier = profile === 'hero_close' ? 1.2 : 1.0;
        const sizeMultiplier = Number.isFinite(options.sizeMultiplier)
            ? Math.max(0.35, options.sizeMultiplier)
            : defaultSizeMultiplier;
        const velocityMultiplier = Number.isFinite(options.velocityMultiplier)
            ? Math.max(0.35, options.velocityMultiplier)
            : defaultVelocityMultiplier;
        const sparkBoost = Number.isFinite(options.sparkBoost)
            ? Math.max(0, options.sparkBoost)
            : 0;
        const lifeMultiplier = Number.isFinite(options.lifeMultiplier)
            ? Math.max(0.35, options.lifeMultiplier)
            : (profile === 'hero_close' ? 0.87 : 1.0);

        const effectiveSizeMultiplier = isMinimal ? Math.min(sizeMultiplier, 1.0) : sizeMultiplier;
        const effectiveVelocityMultiplier = isMinimal ? Math.min(velocityMultiplier, 1.0) : velocityMultiplier;

        if (burstOrigin?.isVector3 && this.camera?.position) {
            this.burstDebugStats.lastBurstDepth = Math.max(0, this.camera.position.z - burstOrigin.z);
        }

        if (profile === 'hero_close') {
            this.burstDebugStats.heroBurstCount += 1;
            if (!isMinimal) {
                const heroContribution = clamp(
                    (effectiveSizeMultiplier - 1.0) * 0.56 + sparkBoost * 0.35,
                    0,
                    0.75,
                );
                this.heroBurstEnvelope = Math.min(0.75, Math.max(this.heroBurstEnvelope, heroContribution));
            }
        } else if (profile === 'peripheral') {
            this.burstDebugStats.peripheralBurstCount += 1;
            if (!isMinimal) {
                const peripheralContribution = clamp(
                    (effectiveSizeMultiplier - 1.0) * 0.4 + sparkBoost * 0.22,
                    0,
                    0.35,
                );
                this.peripheralBurstEnvelope = Math.min(
                    0.55,
                    Math.max(this.peripheralBurstEnvelope, peripheralContribution),
                );
            }
        }
        this.burstSparkBoost = Math.max(this.burstSparkBoost, sparkBoost);

        if (this.burstCompute?.computeNode) {
            this.burstCompute.triggerBurst(this.time, intensity, burstOrigin, comboCount, {
                profile,
                sizeMultiplier: effectiveSizeMultiplier,
                velocityMultiplier: effectiveVelocityMultiplier,
                sparkBoost,
                lifeMultiplier,
            });
            return;
        }

        if (this.burstPools.length === 0 && this.burstCpuConfig) {
            this.createCpuBurstPools(this.burstCpuConfig.poolSize, this.burstCpuConfig.particlesPerPool);
        }

        if (!Array.isArray(this.burstPools) || this.burstPools.length === 0) return;

        // Scan for an idle pool (one with no active particles) — this ensures
        // previous combo bursts keep playing instead of being overwritten.
        let pool = null;
        for (let scan = 0; scan < this.burstPools.length; scan++) {
            const idx = (this.burstPoolIndex + scan) % this.burstPools.length;
            const candidate = this.burstPools[idx];
            const candidateState = candidate?.userData?.cpuBurst;
            if (candidateState && !candidateState.active) {
                pool = candidate;
                this.burstPoolIndex = (idx + 1) % this.burstPools.length;
                break;
            }
        }
        // If no idle pool is found, skip this burst so old particles accumulate.
        if (!pool) return;

        const state = pool.userData.cpuBurst;

        const batchMin = Math.max(120, Math.floor(state.life.length * 0.08));
        const batchMax = Math.max(batchMin, Math.floor(state.life.length * 0.26));
        const normalizedIntensity = clamp((intensity - 0.75) / 1.5, 0, 1);
        const baseBatch = Math.floor(batchMin + (batchMax - batchMin) * normalizedIntensity);
        const targetBatch = profile === 'lock_burst' ? Math.floor(baseBatch * 0.35) : baseBatch;

        const palette = this.getGoldPalette();

        for (let i = 0; i < targetBatch; i += 1) {
            const index = (i + Math.floor(this.rand() * state.life.length)) % state.life.length;
            const i3 = index * 3;
            const spawnJitter = profile === 'hero_close' ? 12 : (profile === 'lock_burst' ? 4 : (profile === 'dissolve' ? 8 : 20));

            const patternRoll = this.rand();
            let vx = 0;
            let vy = 0;
            let vz = 0;

            if (profile === 'lock_burst') {
                const theta = this.rand() * Math.PI * 2;
                const phi = Math.acos(2 * this.rand() - 1);
                const sinPhi = Math.sin(phi);
                const speed = (35 + this.rand() * 35) * intensity * effectiveVelocityMultiplier;
                vx = sinPhi * Math.cos(theta) * speed;
                vy = sinPhi * Math.sin(theta) * speed;
                vz = Math.cos(phi) * speed;
            } else if (profile === 'dissolve') {
                const isLeftOrigin = burstOrigin.x < 0;
                const sideDir = isLeftOrigin ? -1.0 : 1.0;
                vx = (sideDir * (220.0 + this.rand() * 260.0) + (this.rand() - 0.5) * 60.0) * intensity * effectiveVelocityMultiplier;
                vy = (this.rand() - 0.5) * 120.0 * effectiveVelocityMultiplier;
                vz = (this.rand() - 0.5) * 90.0 * effectiveVelocityMultiplier;
            } else if (patternRoll < 0.6) {
                const theta = this.rand() * Math.PI * 2;
                const phi = Math.acos(2 * this.rand() - 1);
                const sinPhi = Math.sin(phi);
                const speed = (60 + this.rand() * 60) * intensity * effectiveVelocityMultiplier;
                vx = sinPhi * Math.cos(theta) * speed;
                vy = sinPhi * Math.sin(theta) * speed;
                vz = Math.cos(phi) * speed;
            } else if (patternRoll < 0.85) {
                const angle = this.rand() * Math.PI * 2;
                const tangentialSpeed = (80 + comboCount * 15) * effectiveVelocityMultiplier;
                const outwardSpeed = (40 + comboCount * 8) * effectiveVelocityMultiplier;
                vx = (-Math.sin(angle) * tangentialSpeed + Math.cos(angle) * outwardSpeed) * (0.7 + this.rand() * 0.6);
                vz = (Math.cos(angle) * tangentialSpeed + Math.sin(angle) * outwardSpeed) * (0.7 + this.rand() * 0.6);
                vy = (Math.sin(angle * 2.0) * 25 + 20 + this.rand() * 30) * effectiveVelocityMultiplier;
            } else {
                const streakSpeed = (200 + this.rand() * 150) * effectiveVelocityMultiplier;
                vx = (this.rand() - 0.5) * 40 * effectiveVelocityMultiplier;
                vy = (this.rand() - 0.5) * 40 * effectiveVelocityMultiplier;
                vz = streakSpeed;
            }

            state.positions[i3] = burstOrigin.x + (this.rand() - 0.5) * spawnJitter;
            state.positions[i3 + 1] = burstOrigin.y + (this.rand() - 0.5) * spawnJitter;
            state.positions[i3 + 2] = burstOrigin.z + (this.rand() - 0.5) * spawnJitter;

            state.velocity[i3] = vx;
            state.velocity[i3 + 1] = vy;
            state.velocity[i3 + 2] = vz;

            state.life[index] = 1.0;
            state.maxLife[index] = (2 + this.rand() * 2) * lifeMultiplier;
            state.sizes[index] = Math.min(
                220,
                Math.max(4, (4 + this.rand() * 110) * effectiveSizeMultiplier * (1.0 + sparkBoost * 0.32)),
            );

            const colorRoll = this.rand();
            let color = palette[1];
            if (colorRoll > 0.6 && colorRoll <= 0.85) color = palette[2];
            else if (colorRoll > 0.85) color = palette[3];

            state.colors[i3] = color.r;
            state.colors[i3 + 1] = color.g;
            state.colors[i3 + 2] = color.b;
        }

        state.active = true;
        pool.geometry.attributes.position.needsUpdate = true;
        pool.geometry.attributes.aVelocity.needsUpdate = true;
        pool.geometry.attributes.aLife.needsUpdate = true;
        pool.geometry.attributes.aSize.needsUpdate = true;
        pool.geometry.attributes.aColor.needsUpdate = true;
    }

    setFormation(state, duration) {
        if (this.qualityPreset.enableCompute === false || this.flags.useCompute === false) {
            this.formationState = 0;
            this.formationProgress = 0;
            return;
        }

        if (this.currentQualityLevel === 'Low' || this.currentQualityLevel === 'Minimal') {
            this.formationState = 0;
            this.formationProgress = 0;
            return;
        }

        let nextState = state;
        let nextDuration = duration;
        if (this.currentQualityLevel === 'Medium') {
            if (nextState === 3) {
                nextState = 2;
            }
            nextDuration *= 0.8;
        }

        this.formationState = nextState;
        this.formationDuration = nextDuration;
        this.formationTimer = 0;
        this.formationProgress = 0;
    }

    createShockwave(options = {}) {
        const radius = options.radius ?? 30;
        const tube = options.tube ?? 1.6;
        const life = options.life ?? 1.8;
        const opacity = options.opacity ?? 0.4;
        const speed = options.speed ?? 3.2;
        const origin = options.origin?.isVector3
            ? options.origin
            : this.getBurstOrigin('shockwave', {
                intensity: 0.7,
            });

        const geometry = new THREE.TorusGeometry(radius, tube, 8, 64);

        let material;
        let uniforms = null;
        if (this.isWebGPU) {
            ({ material, uniforms } = createLightBeamNodeMaterial({
                opacity,
                color: new THREE.Color(0xFFD46B),
            }));
        } else {
            material = new THREE.MeshBasicMaterial({
                color: 0xFFD46B,
                transparent: true,
                opacity,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(origin);
        mesh.rotation.x = Math.PI / 2 + (this.rand() - 0.5) * 0.22;
        mesh.rotation.y = this.rand() * Math.PI * 2;

        this.scene.add(mesh);
        this.shockwaves.push({
            mesh,
            uniforms,
            life,
            maxLife: life,
            baseOpacity: opacity,
            expandSpeed: speed,
        });
    }

    recordFrameMetrics(frameMs) {
        if (!Number.isFinite(frameMs) || frameMs <= 0) return;

        this.frameTimes.push(frameMs);
        if (this.frameTimes.length > 6000) {
            this.frameTimes.shift();
        }

        this.frameMetricsTimer += 1;
        if (this.frameMetricsTimer % 300 !== 0 || this.frameTimes.length < 120) {
            return;
        }

        const sorted = [...this.frameTimes].sort((a, b) => a - b);
        const readPct = (p) => {
            const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
            return sorted[idx];
        };

        const p50 = readPct(0.5);
        const p95 = readPct(0.95);
        const p99 = readPct(0.99);
        this.evaluatePerformanceGate(p95);

        if (!this.flags.debug) {
            return;
        }

        console.log('[ChiralGold] Frame metrics', {
            p50Ms: Number(p50.toFixed(2)),
            p95Ms: Number(p95.toFixed(2)),
            p99Ms: Number(p99.toFixed(2)),
            fpsApproxP95: Number((1000 / Math.max(0.001, p95)).toFixed(1)),
            drawCalls: this.renderer?.info?.render?.calls ?? 0,
            points: this.renderer?.info?.render?.points ?? 0,
            particles: {
                dust: this.qualityPreset.goldDustCount,
                burstCompute: this.burstCompute?.count ?? 0,
                burstCpuPools: this.burstPools.length,
                burstCpuConfigured: this.burstCpuConfig
                    ? this.burstCpuConfig.poolSize * this.burstCpuConfig.particlesPerPool
                    : 0,
                wisps: this.qualityPreset.wispCount,
                strands: this.strands.length,
                tempStrands: this.tempStrandSegments.length,
                beams: this.beams.length,
                shockwaves: this.shockwaves.length,
            },
        });
    }

    evaluatePerformanceGate(p95) {
        if (!Number.isFinite(p95)) return;
        const isHighProfile = this.currentQualityLevel === 'High';

        if (!isHighProfile) {
            this.performanceGate.highP95BreachSamples = 0;
            return;
        }

        if (p95 > 20.0) {
            this.performanceGate.highP95BreachSamples += 1;
        } else {
            this.performanceGate.highP95BreachSamples = Math.max(0, this.performanceGate.highP95BreachSamples - 1);
        }

        if (this.performanceGate.rejected || this.performanceGate.highP95BreachSamples < 3) {
            return;
        }

        this.performanceGate.rejected = true;
        this.performanceGate.lastRejectReason = `High preset rejected: sustained p95 ${p95.toFixed(2)}ms > 20ms`;
        console.error('[ChiralGold] Performance gate reject:', {
            reason: this.performanceGate.lastRejectReason,
            action: 'Disabling post-processing and MRT for runtime stability.',
        });

        this.flags.noPost = true;
        this.flags.usePost = false;
        this.flags.useMRT = false;
        this.reactiveEnvelope.bloom = Math.min(this.reactiveEnvelope.bloom, 0.2);

        this.disposePostProcessingStack();
        this.configureRendererColorPipeline();
    }

    getBurstEffectsSnapshot() {
        const lastBurstDepth = this.burstDebugStats.lastBurstDepth;
        return {
            lastBurstDepth: Number.isFinite(lastBurstDepth) ? Number(lastBurstDepth.toFixed(2)) : null,
            heroBurstCount: this.burstDebugStats.heroBurstCount,
            peripheralBurstCount: this.burstDebugStats.peripheralBurstCount,
            centerGuardRejections: this.burstDebugStats.centerGuardRejections,
            heroBurstEnvelope: Number(this.heroBurstEnvelope.toFixed(3)),
            peripheralBurstEnvelope: Number(this.peripheralBurstEnvelope.toFixed(3)),
            colorTemperature: Number(this.getColorTemperatureValue().toFixed(3)),
            tempStrands: this.tempStrandSegments.length,
        };
    }

    logBurstEffectsDebug(delta) {
        if (!this.flags.debug) return;
        this.burstDebugLogTimer += delta;
        if (this.burstDebugLogTimer < 5) return;
        this.burstDebugLogTimer = 0;
        console.log('[ChiralGold] Burst effects', this.getBurstEffectsSnapshot());
    }

    registerDebugApi() {
        if (typeof window === 'undefined') return;
        if (!window.chiralGoldDebug) window.chiralGoldDebug = {};
        window.chiralGoldDebug.effects = () => this.getBurstEffectsSnapshot();
        this.debugApiRegistered = true;
    }

    clearDebugApi() {
        if (typeof window === 'undefined' || !this.debugApiRegistered || !window.chiralGoldDebug) {
            return;
        }
        if (window.chiralGoldDebug.effects) {
            delete window.chiralGoldDebug.effects;
        }
        if (Object.keys(window.chiralGoldDebug).length === 0) {
            delete window.chiralGoldDebug;
        }
        this.debugApiRegistered = false;
    }

    setupPostEventBoosts() {
        // Reserved for future tuning hooks.
    }

    clearTempEffects() {
        this.shockwaves.forEach((wave) => {
            if (wave.mesh?.parent) wave.mesh.parent.remove(wave.mesh);
            wave.mesh?.geometry?.dispose?.();
            wave.mesh?.material?.dispose?.();
        });
        this.shockwaves = [];

        this.tempStrandSegments.forEach((segment) => {
            this.disposeTemporaryStrandSegment(segment);
        });
        this.tempStrandSegments = [];
    }

    getGoldPalette() {
        if (this.currentQualityLevel === 'Minimal') {
            return [
                new THREE.Color(0x8f6e18),
                new THREE.Color(0xd3a824),
                new THREE.Color(0xf0d47a),
                new THREE.Color(0xa67b27),
                new THREE.Color(0xffe7ad),
            ];
        }

        return [
            new THREE.Color(0xB8860B),
            new THREE.Color(0xFFD700),
            new THREE.Color(0xFFF8DC),
            new THREE.Color(0xB87333),
            new THREE.Color(0xFFFFFF),
        ];
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

    disposeComputeResources() {
        this.dustCompute?.dispose?.();
        this.burstCompute?.dispose?.();
        this.wispCompute?.dispose?.();

        this.dustCompute = null;
        this.burstCompute = null;
        this.wispCompute = null;
    }

    disposeRendererResources(removeCanvas = true) {
        if (!this.renderer) return;

        this.renderer.onDeviceLost = null;
        const { domElement } = this.renderer;
        try {
            this.renderer.dispose();
        } catch (error) {
            console.warn('[ChiralGold] renderer dispose failed:', error);
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
        this.chromaticPass = null;
        this.filmGrainPass = null;

        this.dustPoints = null;
        this.dustUniforms = null;
        this.burstPoints = null;
        this.burstUniforms = null;
        this.burstPools = [];
        this.burstCpuConfig = null;

        this.wispPoints = null;
        this.wispUniforms = null;
        this.wispCpuState = null;

        this.strands = [];
        this.tempStrandSegments = [];
        this.beams = [];
        this.shockwaves = [];
        this.backgroundEnvelope = null;

        this.pendingComboCount = 0;
        this.comboFlashIntensity = 0;
        this.dustEventBoost = 0;
        this.beatPulse = 0;
        this.wispJolt = 0;
        this.colorTemperatureBoost = 0;
        this.formationState = 0;
        this.formationProgress = 0;
        this.formationTimer = 0;
        this.formationDuration = 0;
        this.strandUnwind = 0;
        this.beamFlash = 0;

        this.reactiveEnvelope = {
            pulse: 0,
            bloom: 0,
            spark: 0,
            dust: 0,
            strand: 0,
            shake: 0,
            chroma: 0,
        };

        this.audioChannels = {
            pulse: 0,
            flow: 0,
            spark: 0,
            atmosphere: 0,
        };

        this.frameTimes = [];
        this.frameMetricsTimer = 0;
        this.performanceGate = {
            highP95BreachSamples: 0,
            rejected: false,
            lastRejectReason: null,
        };
        this.deferredTaskId = 0;
        this.eventAnchors = [];
        this.heroBurstEnvelope = 0;
        this.peripheralBurstEnvelope = 0;
        this.burstSparkBoost = 0;
        this.burstDebugStats = {
            lastBurstDepth: null,
            heroBurstCount: 0,
            peripheralBurstCount: 0,
            centerGuardRejections: 0,
        };
        this.burstDebugLogTimer = 0;
        this.clearDebugApi();

        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            isWebGPU: false,
            maxColorAttachments: 0,
            supportsCompute: false,
            supportsPost: false,
        };
    }

    disposeRuntimeResources({ removeCanvas = true } = {}) {
        this.disposePostProcessingStack();
        this.clearTempEffects();
        this.disposeComputeResources();
        this.disposeSceneResources();
        this.disposeRendererResources(removeCanvas);
        this.resetRuntimeReferences();
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        console.error('[ChiralGold] WebGPU device lost:', info);

        try {
            this.cancelAnimationLoop();
            this.clearDeferredTimeouts();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.disposeRuntimeResources({ removeCanvas: true });

            this.flags.forceWebGL = true;
            this.flags.noCompute = true;
            this.flags.noMRT = true;

            await this.createScene();
            console.log('[ChiralGold] Recovery complete: running on WebGL fallback.');
        } catch (error) {
            console.error('[ChiralGold] Device-loss recovery failed:', error);
            this.isActive = false;
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    stop() {
        this.cancelAnimationLoop();
        this.clock.stop();
        this.clearDeferredTimeouts();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.disposeRuntimeResources({ removeCanvas: true });
        super.stop();
    }
}
